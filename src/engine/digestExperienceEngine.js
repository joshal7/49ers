/**
 * High-Signal Information Digestion & Experience Engine
 *
 * Powers:
 * 1. "Since You Last Visited" Catch-Up Watermark & Read/Seen State
 * 2. Universal Instant Search (Players, News & Film, Podcasts & AI, Quick Section Jumps)
 * 3. 2-Mode News Feed Sorting (`top` default | `latest`) & Auto-Derived Topic/Player Chips
 * 4. Chronological "Full Coverage" Story Timeline & Source-Lens Tagging (`Beat` / `National` / `Film` / `Official`)
 * 5. Directional Delta Cues (Practice Trajectory `DNP→LP ↑`, Play-Prob Shifts, Rank `▲/▼`, Playoff Odds Deltas)
 * 6. Auto-Distilled "Presser Takeaways & Key Quotes" Extractor (Shanahan / Lynch / Coordinators / Captains)
 * 7. Reading-Time / Effort Cues & Inline Chart/Media Preview Detection
 * 8. Quiet, Opt-In Web Push Alert Channel Definitions & Payload Helpers
 */

import { computeNewsSalienceScore } from './antiFluffFilter.js';
import {
  isOfficialGameDayInactivesAnnouncement,
  isPreGamePlayAvailabilityItem,
  isStaleCompletedGameAvailabilityItem,
  isUrgentBreakingBadge,
  stripRedundantAuthorBoilerplate
} from './breakingClassifier.js';
import {
  formatWireSourceDisplayName,
  sanitizeExternalUrl
} from './linkIntegrity.js';
import { resolveOriginalTweetUrl } from './beatAttributionEngine.js';
import { getActiveTeamConfig } from '../config/teamRegistry.js';

export const NEWS_SORT_MODES = [
  { key: 'top', label: 'Top', shortLabel: 'Top', title: 'Highest-impact stories, breaking updates & corroborated scoops (Default)' },
  { key: 'latest', label: 'Latest', shortLabel: 'Latest', title: 'Strict chronological wire (newest first)' }
];

export const VALID_NEWS_SORT_MODES = new Set(['top', 'latest']);

export function normalizeNewsSortMode(raw = 'top') {
  const s = String(raw || 'top').toLowerCase().trim();
  return VALID_NEWS_SORT_MODES.has(s) ? s : 'top';
}

/* ============================================================================
 * 1. Read State & "Since You Last Visited" Catch-Up Watermark
 * ============================================================================ */

export function getItemReadKey(item = {}) {
  if (!item || typeof item !== 'object') return '';
  if (item.id && String(item.id).trim()) return String(item.id).trim();
  const u = String(item.url || item.externalUrl || '')
    .trim()
    .toLowerCase()
    .replace(/\/+$/, '');
  return u;
}

export function isItemRead(item, readKeysSet) {
  if (!item || !(readKeysSet instanceof Set) || readKeysSet.size === 0) return false;
  const key = getItemReadKey(item);
  if (key && readKeysSet.has(key)) return true;
  const altUrl = String(item.url || '')
    .trim()
    .toLowerCase()
    .replace(/\/+$/, '');
  if (altUrl && readKeysSet.has(altUrl)) return true;
  return false;
}

export function formatShortVisitTimestamp(isoStr = '', nowMs = Date.now()) {
  if (!isoStr) return '';
  const ms = Date.parse(isoStr);
  if (!Number.isFinite(ms)) return '';
  const diffMin = Math.max(0, Math.floor((nowMs - ms) / 60_000));
  if (diffMin < 60) return `${Math.max(1, diffMin)}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 10) return `${diffHr}h ago`;

  const dt = new Date(ms);
  const nowDt = new Date(nowMs);
  const tz = 'America/Los_Angeles';
  try {
    const dayFmt = new Intl.DateTimeFormat('en-US', { month: 'numeric', day: 'numeric', timeZone: tz });
    const timeFmt = new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit', timeZone: tz });
    const weekdayFmt = new Intl.DateTimeFormat('en-US', { weekday: 'short', timeZone: tz });

    const visitDay = dayFmt.format(dt);
    const todayDay = dayFmt.format(nowDt);
    const yestDay = dayFmt.format(new Date(nowMs - 86_400_000));
    const timeStr = timeFmt.format(dt);

    if (visitDay === todayDay) return `today ${timeStr}`;
    if (visitDay === yestDay) return `yesterday ${timeStr}`;
    return `${weekdayFmt.format(dt)} ${timeStr}`;
  } catch {
    return `${Math.round(diffHr)}h ago`;
  }
}

export function computeCatchUpState(
  items = [],
  { lastVisitedAt = null, readKeys = [] } = {},
  nowMs = Date.now()
) {
  const readSet = readKeys instanceof Set ? readKeys : new Set(Array.isArray(readKeys) ? readKeys : []);
  const visitMs = lastVisitedAt ? Date.parse(lastVisitedAt) : NaN;
  const list = Array.isArray(items) ? items : [];

  // Do not show a catch-up watermark on first-ever visit or if visit timestamp is invalid / > 21 days stale
  if (!Number.isFinite(visitMs) || visitMs > nowMs + 60_000 || nowMs - visitMs > 21 * 86_400_000) {
    return {
      hasWatermark: false,
      newCount: 0,
      lastVisitedAt: lastVisitedAt || null,
      lastVisitedLabel: '',
      newItemKeys: new Set(),
      watermarkInsertBeforeIdx: -1
    };
  }

  const newItemKeys = new Set();
  let newCount = 0;
  let watermarkInsertBeforeIdx = -1;

  for (let i = 0; i < list.length; i++) {
    const it = list[i];
    const pubMs = it?.publishedAt ? Date.parse(it.publishedAt) : NaN;
    const key = getItemReadKey(it);
    const isNew = Number.isFinite(pubMs) && pubMs > visitMs + 15_000 && !isItemRead(it, readSet);
    if (isNew) {
      newCount += 1;
      if (key) newItemKeys.add(key);
    } else if (watermarkInsertBeforeIdx === -1 && newCount > 0) {
      watermarkInsertBeforeIdx = i;
    }
  }

  return {
    hasWatermark: newCount > 0,
    newCount,
    lastVisitedAt,
    lastVisitedLabel: formatShortVisitTimestamp(lastVisitedAt, nowMs),
    newItemKeys,
    watermarkInsertBeforeIdx
  };
}

/* ============================================================================
 * 3. 2-Mode News Feed Sorting (`top` default | `latest`)
 *    & Auto-Generated Trending Topic / Player Filter Chips
 * ============================================================================ */

function getItemTimestampMs(item = {}) {
  const ms = item?.publishedAt ? Date.parse(item.publishedAt) : NaN;
  return Number.isFinite(ms) ? ms : 0;
}

export function computeTopSignalScore(item = {}, nowMs = Date.now(), { appData = null } = {}) {
  const storyRank = Number(item.storyRank);
  // Strictly honor stale pre-game availability demotion & negative priority/rank
  // (never fall back to positive salience when storyRank is negative or item is stale pre-game!).
  if (
    item.isStalePreGameAvailability ||
    (Number(item.breakingPriority) || 0) < 0 ||
    (Number.isFinite(storyRank) && storyRank < 0) ||
    (appData && isStaleCompletedGameAvailabilityItem(item, appData, nowMs))
  ) {
    return Number.isFinite(storyRank) && storyRank < 0 ? storyRank : -500;
  }

  const pubMs = getItemTimestampMs(item);
  const ageHours = pubMs > 0 ? Math.max(0, (nowMs - pubMs) / 3_600_000) : 72;
  const hasStoryRank = Number.isFinite(storyRank) && storyRank > 0;
  const baseSignal = hasStoryRank
    ? storyRank
    : computeNewsSalienceScore(item) * 2.2;

  const isSpeculativePreGameAvail =
    isPreGamePlayAvailabilityItem(item) && !isOfficialGameDayInactivesAnnouncement(item);

  // Scale-matched multiplicative corroboration lift that decays with age so multi-day
  // clusters never overwhelm fresh power-law decayed `storyRank` items!
  const relatedCount = item.confirmingReports?.length || 0;
  const corrFreshness = Math.pow(0.5, Math.max(0, ageHours - 3) / 30);
  const corrMultiplier =
    relatedCount <= 0 || item._isLowSalienceRoundupCluster || isSpeculativePreGameAvail
      ? 1
      : item.clusterKind === 'similar'
        ? 1 + Math.min(0.18, Math.log2(1 + relatedCount) * 0.08) * corrFreshness
        : 1 + Math.min(0.45, Math.log2(1 + relatedCount) * 0.18) * corrFreshness;

  const urgentBonus = isUrgentBreakingBadge(item.breakingBadge)
    ? Math.max(35, baseSignal * 0.5)
    : 0;

  // Speculative pre-game play/practice availability has a short 14h half-life even mid-week;
  // general stories use a gentle 60h half-life on top of `storyRank` time gravity.
  const decayHalfLife = isSpeculativePreGameAvail ? 14 : 60;
  const decayGraceHours = isSpeculativePreGameAvail ? 2 : 6;
  const gentleDecay = Math.pow(0.5, Math.max(0, ageHours - decayGraceHours) / decayHalfLife);
  return (baseSignal * corrMultiplier + urgentBonus) * gentleDecay;
}

export function compareLatestNewsItems(a = {}, b = {}) {
  const aLiveInj = a?.isInGameInjury && isUrgentBreakingBadge(a?.breakingBadge) ? 1 : 0;
  const bLiveInj = b?.isInGameInjury && isUrgentBreakingBadge(b?.breakingBadge) ? 1 : 0;
  if (aLiveInj !== bLiveInj) return bLiveInj - aLiveInj;
  return getItemTimestampMs(b) - getItemTimestampMs(a);
}

export function sortNewsFeedByMode(items = [], sortMode = 'top', { nowMs = Date.now(), appData = null } = {}) {
  const mode = normalizeNewsSortMode(sortMode);
  const list = Array.isArray(items) ? [...items] : [];
  if (list.length <= 1) return list;

  if (mode === 'latest') {
    return list.sort(compareLatestNewsItems);
  }

  // Default: 'top' (storyRank impact + freshness + scale-matched corroboration decay,
  // with live in-game urgent injuries pinned #1 and stale pre-game availability sunk to the bottom)
  const scoreOpts = appData ? { appData } : undefined;
  return list.sort((a, b) => {
    const aLiveInj = a?.isInGameInjury && isUrgentBreakingBadge(a?.breakingBadge) ? 1 : 0;
    const bLiveInj = b?.isInGameInjury && isUrgentBreakingBadge(b?.breakingBadge) ? 1 : 0;
    if (aLiveInj !== bLiveInj) return bLiveInj - aLiveInj;

    const aScore = computeTopSignalScore(a, nowMs, scoreOpts);
    const bScore = computeTopSignalScore(b, nowMs, scoreOpts);
    const aStale = aScore < 0 ? 1 : 0;
    const bStale = bScore < 0 ? 1 : 0;
    if (aStale !== bStale) return aStale - bStale;

    const diff = bScore - aScore;
    const threshold = Math.max(0.02, Math.min(0.4, Math.max(Math.abs(aScore), Math.abs(bScore)) * 0.04));
    if (Math.abs(diff) >= threshold) return diff;
    return getItemTimestampMs(b) - getItemTimestampMs(a);
  });
}

function itemMatchesTopicBucket(item = {}, topicKey = '') {
  const text = `${item.title || ''} ${item.summary || ''} ${item.fullText || ''} ${item.breakingBadge || ''}`.toLowerCase();
  if (topicKey === 'topic:injuries') {
    return (
      item.category === 'injury' ||
      /injury|injured|ir\b|practice|dnp|limited|questionable|doubtful|achilles|hamstring|knee|ankle|back|groin|concussion/i.test(text)
    );
  }
  if (topicKey === 'topic:film') {
    return (
      item.category === 'film' ||
      /\b(all-22|film|tape|epa|cpoe|wide-9|cover[- ]?[234]|quarters|trench|scheme|play-action)\b/i.test(text)
    );
  }
  if (topicKey === 'topic:cap') {
    return (
      item.category === 'cap' ||
      item.category === 'roster' ||
      /\b(cap|contract|extension|restructure|trade|signed|waived|activated|practice squad|dead money)\b/i.test(text)
    );
  }
  if (topicKey.startsWith('topic:opp:')) {
    const oppToken = topicKey.slice('topic:opp:'.length).toLowerCase();
    return oppToken.length >= 3 && text.includes(oppToken);
  }
  if (topicKey.startsWith('player:')) {
    const pid = topicKey.slice('player:'.length);
    return Array.isArray(item.mentionedPlayers) && item.mentionedPlayers.some(p => String(p?.id) === pid);
  }
  return true;
}

export function extractTrendingTopicChips(
  items = [],
  { activeCategory = 'all', appData = null, nowMs = Date.now(), maxChips = 6 } = {}
) {
  const list = Array.isArray(items) ? items : [];
  if (list.length < 4) return [];

  // Scope trending counts to recent 96h window when populated, else full visible list
  const recent = list.filter(it => {
    const ms = getItemTimestampMs(it);
    return ms > 0 && nowMs - ms <= 96 * 3_600_000;
  });
  const pool = recent.length >= 6 ? recent : list;

  const chips = [];

  // 1. Opponent / Matchup chip if upcoming opponent has >=2 mentions
  const oppFull = String(appData?.scheduleMatchup?.upcomingMatchup?.oppName || '').trim();
  const oppShort = oppFull ? oppFull.split(/\s+/).pop() : '';
  if (oppShort && oppShort.length >= 4 && !/^tbd$/i.test(oppShort)) {
    const oppKey = `topic:opp:${oppShort.toLowerCase()}`;
    const oppCount = pool.filter(it => itemMatchesTopicBucket(it, oppKey)).length;
    if (oppCount >= 2) {
      chips.push({ key: oppKey, label: oppShort, count: oppCount, kind: 'matchup' });
    }
  }

  // 2. High-signal topic chips (skip chips that duplicate the active category tab)
  const topicDefs = [
    { key: 'topic:injuries', label: 'Injuries', skipCats: [] },
    { key: 'topic:film', label: 'Film & EPA', skipCats: ['film'] },
    { key: 'topic:cap', label: 'Roster & Cap', skipCats: ['roster'] }
  ];
  for (const td of topicDefs) {
    if (td.skipCats.includes(activeCategory)) continue;
    const count = pool.filter(it => itemMatchesTopicBucket(it, td.key)).length;
    if (count >= 2 && count < pool.length) {
      chips.push({ key: td.key, label: td.label, count, kind: 'topic' });
    }
  }

  // 3. Top mentioned players (>= 2 mentions)
  const playerCounts = new Map();
  for (const it of pool) {
    const seenOnItem = new Set();
    for (const mp of it.mentionedPlayers || []) {
      const pid = mp?.id ? String(mp.id) : '';
      if (!pid || seenOnItem.has(pid)) continue;
      seenOnItem.add(pid);
      const cur = playerCounts.get(pid) || {
        id: pid,
        name: mp.name || mp.shortName || '',
        count: 0
      };
      cur.count += 1;
      playerCounts.set(pid, cur);
    }
  }

  const topPlayers = [...playerCounts.values()]
    .filter(p => p.count >= 2 && p.name)
    .sort((a, b) => b.count - a.count)
    .slice(0, 3);

  for (const tp of topPlayers) {
    const parts = tp.name.replace(/,?\s+\b(?:Jr\.?|Sr\.?|II|III|IV|V)\b\.?$/i, '').trim().split(/\s+/);
    const shortLabel = parts.length > 1 ? parts[parts.length - 1] : tp.name;
    chips.push({
      key: `player:${tp.id}`,
      label: shortLabel,
      fullLabel: tp.name,
      count: tp.count,
      kind: 'player'
    });
  }

  return chips.slice(0, maxChips);
}

export function filterItemsByTopicChip(items = [], chipKey = 'all') {
  const list = Array.isArray(items) ? items : [];
  if (!chipKey || chipKey === 'all') return list;
  return list.filter(it => itemMatchesTopicBucket(it, chipKey));
}

/* ============================================================================
 * 4. Chronological "Full Coverage" Story Timeline & Source-Lens Tagging
 * ============================================================================ */

const OFFICIAL_LENS_RE = /\b(49ers\.com|san francisco 49ers|@49ers|49ers official|official transactions)\b/i;
const NATIONAL_LENS_RE =
  /\b(schefter|rapoport|pelissero|garafolo|glazer|fowler|graziano|breer|russini|profootballtalk|pft|nfl network|nfl\.com|cbs sports|yahoo sports|fox sports|bleacher report|espn nfl|associated press)\b/i;
const FILM_LENS_RE =
  /\b(qb school|o['’]?sullivan|jonnydel|baldinger|baldy|orlovsky|solak|tice|mina kimes|film|all-22|trench|pff|next gen)\b/i;

function escapeDigestRegex(s = '') {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function getActiveOfficialLensRegex() {
  const team = getActiveTeamConfig();
  if (!team || team.abbr === 'SF') return OFFICIAL_LENS_RE;
  const parts = [
    team.clubDomain,
    team.fullName,
    team.nickname ? `${team.nickname} official` : '',
    team.nickname ? `@${team.nickname}` : '',
    'official transactions'
  ]
    .filter(Boolean)
    .map(p => escapeDigestRegex(String(p).trim()));
  return new RegExp(`(?:^|\\b|\\s)(?:${parts.join('|')})(?:\\b|$)`, 'i');
}

export function classifySourceLensTag(item = {}) {
  const hay = `${item.author || ''} ${item.reporterName || ''} ${item.outletName || ''} ${item.url || ''}`;
  if (getActiveOfficialLensRegex().test(hay) || /_official$/i.test(String(item.outletId || ''))) return 'Official';
  if (item.category === 'film' || FILM_LENS_RE.test(hay)) return 'Film';
  if (item.isNationalInsider || NATIONAL_LENS_RE.test(hay)) return 'National';
  return 'Beat';
}

export function buildStoryTimelineEntries(leadItem, confirmingReports = [], prioritizedRaw = []) {
  const rawList = [];
  if (leadItem && typeof leadItem === 'object') {
    rawList.push({ ...leadItem, _isLead: true });
  }
  for (const cr of Array.isArray(confirmingReports) ? confirmingReports : []) {
    if (cr && typeof cr === 'object') {
      rawList.push({ ...cr, _isLead: false });
    }
  }

  const seenUrls = new Set();
  const entries = [];
  for (const item of rawList) {
    const isTw = item.type === 'tweet' || item.type === 'social';
    const isVid = item.type === 'video' || Boolean(item.videoId);
    const href = isTw
      ? sanitizeExternalUrl(resolveOriginalTweetUrl(item, prioritizedRaw), '')
      : sanitizeExternalUrl(item.url, '');
    const normHref = String(href || '').replace(/\/+$/, '').toLowerCase();
    if (normHref && seenUrls.has(normHref)) continue;
    if (normHref) seenUrls.add(normHref);

    const activeTeamNick = getActiveTeamConfig()?.nickname || '49ers';
    const rawAuthor = item.author || item.reporterName || item.outletName || `${activeTeamNick} Beat`;
    const author = formatWireSourceDisplayName(rawAuthor, item);
    const body = stripRedundantAuthorBoilerplate(item.fullText || item.title || '', rawAuthor);
    const pubMs = getItemTimestampMs(item);
    entries.push({
      id: item.id || normHref,
      isLead: Boolean(item._isLead),
      author,
      lens: classifySourceLensTag(item),
      format: isVid ? 'Video' : isTw ? 'Tweet' : 'Article',
      href: href || '#',
      body,
      publishedAt: item.publishedAt || '',
      pubMs,
      rawItem: item
    });
  }

  // Chronological order: oldest -> newest so readers see how the story developed
  entries.sort((a, b) => {
    if (a.pubMs && b.pubMs && a.pubMs !== b.pubMs) return a.pubMs - b.pubMs;
    return a.isLead ? -1 : 1;
  });

  if (entries.length >= 2) {
    const spanMs = (entries[entries.length - 1].pubMs || 0) - (entries[0].pubMs || 0);
    if (spanMs >= 10 * 60_000) {
      entries[0].timelineMarker = 'First';
      entries[entries.length - 1].timelineMarker = 'Latest';
    }
  }

  return entries;
}

export function shouldShowItemAskAiButton(item = {}, confirmingCount = 0) {
  if (!item || typeof item !== 'object') return false;
  if (confirmingCount >= 1) return true;
  const isTweet = item.type === 'tweet' || item.type === 'social';
  const isVideo = item.type === 'video';
  if (item.category === 'film' || item.category === 'cap') return true;
  if (!isTweet && !isVideo) {
    const titleLen = String(item.title || '').length;
    const sumLen = String(item.summary || '').length;
    return titleLen >= 38 || sumLen >= 90 || Number(item.wordCount || 0) >= 200;
  }
  return false;
}

/* ============================================================================
 * 6. Directional Delta Cues ("What Changed?" Badges)
 * ============================================================================ */

function parsePracticeLevel(val) {
  const s = String(val ?? '').trim().toUpperCase();
  if (!s || s === '-' || s === '—' || s === 'TBD') return null;
  if (s.includes('DNP') || s.includes('DID NOT') || s === 'OUT') return 0;
  if (s.includes('LP') || s.includes('LIMITED')) return 1;
  if (s.includes('FP') || s.includes('FULL') || s.includes('REST') || s.includes('CLEARED')) return 2;
  return null;
}

function shortPracticeCode(val) {
  const s = String(val ?? '').trim().toUpperCase();
  if (s.includes('DNP') || s.includes('DID NOT')) return 'DNP';
  if (s.includes('LP') || s.includes('LIMITED')) return 'LP';
  if (s.includes('REST')) return 'Rest';
  if (s.includes('FP') || s.includes('FULL')) return 'FP';
  return s;
}

export function computePracticeTrajectoryDelta(row = {}, prevSnapshotEntry = null) {
  if (!row || typeof row !== 'object') return null;

  // Suppress stale mid-week practice trajectory / probability delta chips once a player's status
  // is resolved on game day (`0% • Out (Inactive)`, `99% • In (Active)`, `50% • QTR (In-Game)`, etc.).
  const badgeStr = String(row.badgeLabel || row.playBadgeLabel || '');
  if (
    row.isInGameInjury ||
    row.isInGameReturned ||
    /\b(?:in \(active\)|out \(inactive\)|qtr \(in-game\)|out \(in-game\)|doubtful \(in-game\)|active • gtd)/i.test(
      badgeStr
    )
  ) {
    return null;
  }

  const days = [row.wed, row.thu, row.fri]
    .map(v => ({ code: shortPracticeCode(v), level: parsePracticeLevel(v) }))
    .filter(d => d.level !== null);

  let trajectory = null;
  if (days.length >= 2) {
    const first = days[0];
    const last = days[days.length - 1];
    const pairLabel = `${first.code}→${last.code}`;
    if (last.level > first.level) {
      trajectory = {
        direction: 'up',
        arrow: '↑',
        pairLabel,
        shortLabel: `${pairLabel} ↑`,
        tone: 'positive'
      };
    } else if (last.level < first.level) {
      trajectory = {
        direction: 'down',
        arrow: '↓',
        pairLabel,
        shortLabel: `${pairLabel} ↓`,
        tone: 'danger'
      };
    }
  }

  let probDelta = null;
  const curPct = Number(row.playProbabilityPct);
  const priorDayPct =
    row.priorDayPlayProbabilityPct !== null && row.priorDayPlayProbabilityPct !== undefined
      ? Number(row.priorDayPlayProbabilityPct)
      : NaN;
  const snapPct =
    prevSnapshotEntry?.playProbabilityPct !== null && prevSnapshotEntry?.playProbabilityPct !== undefined
      ? Number(prevSnapshotEntry.playProbabilityPct)
      : NaN;

  if (Number.isFinite(curPct)) {
    if (trajectory) {
      const expectedSign = trajectory.direction === 'up' ? 1 : -1;
      const priorDayDiff = Number.isFinite(priorDayPct) ? Math.round(curPct - priorDayPct) : NaN;
      const snapDiff = Number.isFinite(snapPct) ? Math.round(curPct - snapPct) : NaN;
      let chosenDiff = NaN;
      if (Number.isFinite(priorDayDiff) && priorDayDiff !== 0 && Math.sign(priorDayDiff) === expectedSign) {
        chosenDiff = priorDayDiff;
      } else if (Number.isFinite(snapDiff) && snapDiff !== 0 && Math.sign(snapDiff) === expectedSign) {
        chosenDiff = snapDiff;
      } else if (Number.isFinite(priorDayDiff) && Math.abs(priorDayDiff) >= 5) {
        chosenDiff = priorDayDiff;
      }
      if (Number.isFinite(chosenDiff) && chosenDiff !== 0) {
        probDelta = {
          diff: chosenDiff,
          label: `${chosenDiff > 0 ? '+' : ''}${chosenDiff}%`,
          tone: chosenDiff > 0 ? 'positive' : 'danger'
        };
      }
    } else {
      const snapDiff = Number.isFinite(snapPct) ? Math.round(curPct - snapPct) : NaN;
      const priorDayDiff = Number.isFinite(priorDayPct) ? Math.round(curPct - priorDayPct) : NaN;
      const preferPreReportPrior =
        Boolean(row.hasPreReportPracticeReturnDelta) && Number.isFinite(priorDayDiff) && priorDayDiff >= 5;
      const preferMidWeekAdditionPrior =
        Boolean(row.isMidWeekAdditionDelta) && Number.isFinite(priorDayDiff) && priorDayDiff <= -5;
      const chosenDiff = preferPreReportPrior || preferMidWeekAdditionPrior
        ? priorDayDiff
        : Number.isFinite(snapDiff) && Math.abs(snapDiff) >= 5
          ? snapDiff
          : Number.isFinite(priorDayDiff) && Math.abs(priorDayDiff) >= 5
            ? priorDayDiff
            : NaN;
      if (Number.isFinite(chosenDiff)) {
        probDelta = {
          diff: chosenDiff,
          label: `${chosenDiff > 0 ? '+' : ''}${chosenDiff}%`,
          tone: chosenDiff > 0 ? 'positive' : 'danger',
          isPreReportReturn: preferPreReportPrior,
          isMidWeekAddition: preferMidWeekAdditionPrior
        };
      }
    }
  }

  if (!trajectory && !probDelta) return null;
  const compactLabel =
    trajectory && probDelta
      ? `${trajectory.arrow} ${probDelta.label}`
      : probDelta
        ? probDelta.label
        : trajectory.arrow;
  const displayLabel =
    trajectory && probDelta
      ? `${trajectory.pairLabel} ${probDelta.label}`
      : trajectory
        ? trajectory.shortLabel
        : probDelta.label;
  const tooltipLabel =
    trajectory && probDelta
      ? `${trajectory.pairLabel} (${probDelta.label})`
      : trajectory
        ? trajectory.shortLabel
        : probDelta?.isPreReportReturn
          ? `Observed practice return ahead of official report (${probDelta.label} vs prior practice day)`
          : probDelta?.isMidWeekAddition
            ? `Added to injury report mid-week (${probDelta.label} vs healthy prior day)`
            : `Play likelihood ${probDelta.label} vs prior update`;

  return {
    trajectory,
    probDelta,
    compactLabel,
    displayLabel,
    tooltipLabel,
    tone: trajectory ? trajectory.tone : probDelta.tone
  };
}

export function formatRankDeltaCue(currentRank, previousRank = null, explicitDelta = null) {
  let diff = null; // positive = improved (e.g., #5 -> #3 is +2)
  const cur = Number(currentRank);
  const prev = previousRank !== null && previousRank !== undefined && previousRank !== '' ? Number(previousRank) : NaN;

  if (Number.isFinite(cur) && Number.isFinite(prev) && cur > 0 && prev > 0) {
    diff = Math.round(prev - cur);
  } else if (explicitDelta !== null && explicitDelta !== undefined && String(explicitDelta).trim() !== '') {
    const raw = String(explicitDelta).trim();
    const m = raw.match(/^([+-]?\d+)$/);
    if (m) diff = Number(m[1]);
  }

  if (!Number.isFinite(diff) || diff === 0) return null;
  return {
    diff,
    text: diff > 0 ? `▲${diff}` : `▼${Math.abs(diff)}`,
    tone: diff > 0 ? 'positive' : 'danger'
  };
}

export function formatPlayoffOddsDeltaCue(currentPct, referencePct) {
  const cur = Number(currentPct);
  const ref = Number(referencePct);
  if (!Number.isFinite(cur) || !Number.isFinite(ref)) return null;
  const diff = Math.round((cur - ref) * 10) / 10;
  if (Math.abs(diff) < 0.2) return null;
  return {
    diff,
    text: `${diff > 0 ? '+' : ''}${diff.toFixed(1)}%`,
    tone: diff > 0 ? 'positive' : 'danger'
  };
}

/* ============================================================================
 * 9. Auto-Distilled "Presser Takeaways & Key Quotes" Strip
 * ============================================================================ */

const PRESSER_SPEAKERS = [
  { name: 'Kyle Shanahan', shortName: 'Shanahan', re: /\b(?:kyle\s+)?shanahan\b/i, rejectRe: /\bmike\s+shanahan\b/i },
  { name: 'John Lynch', shortName: 'Lynch', re: /\b(?:john\s+)?lynch\b/i, rejectRe: /\b(?:marshawn|paxton)\s+lynch\b/i },
  { name: 'Raheem Morris', shortName: 'Morris', re: /\braheem\s+morris\b/i },
  { name: 'Klay Kubiak', shortName: 'Kubiak', re: /\b(?:klay\s+)?kubiak\b/i, rejectRe: /\b(?:klint|gary)\s+kubiak\b/i },
  { name: 'Brock Purdy', shortName: 'Purdy', re: /\b(?:brock\s+)?purdy\b/i },
  { name: 'George Kittle', shortName: 'Kittle', re: /\b(?:george\s+)?kittle\b/i },
  { name: 'Fred Warner', shortName: 'Warner', re: /\b(?:fred\s+)?warner\b/i, rejectRe: /\bkurt\s+warner\b/i },
  { name: 'Nick Bosa', shortName: 'Bosa', re: /\b(?:nick\s+)?bosa\b/i, rejectRe: /\bjoey\s+bosa\b/i },
  { name: 'Christian McCaffrey', shortName: 'McCaffrey', re: /\b(?:christian\s+)?mccaffrey\b/i },
  { name: 'Trent Williams', shortName: 'T. Williams', re: /\btrent\s+williams\b/i }
];

const PRESSER_VERB_RE =
  /\b(said|says|told reporters|on\s+(?:the\s+)?podium|press conference|presser|conference call|spoke\s+(?:with|to)\s+reporters|confirmed|announced|updated|explained|noted|expects|optimistic|hopeful|ruled\s+out|day-to-day|week-to-week|addressed|discussed)\b/i;

function normalizePresserTopicFingerprint(text = '') {
  const active = getActiveTeamConfig();
  const teamStops = new Set(
    [
      'kyle', 'shanahan', 'john', 'lynch', '49ers', 'niners',
      active?.nickname,
      active?.city,
      active?.coachesSeed?.hc,
      active?.coachesSeed?.gm
    ]
      .filter(Boolean)
      .flatMap(v => String(v).toLowerCase().split(/\s+/))
      .filter(w => w.length >= 3)
  );
  return String(text || '')
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(
      w =>
        w.length >= 4 &&
        !teamStops.has(w) &&
        !/^(?:said|says|with|that|this|from|have|will|about|their|after|week|game|today|sunday|monday|wednesday|thursday|friday)$/.test(
          w
        )
    )
    .slice(0, 6);
}

const COMMON_SPEAKER_SURNAMES = new Set([
  'allen', 'brown', 'campbell', 'clark', 'davis', 'green', 'hall', 'harris', 'hill', 'johnson',
  'jones', 'king', 'lewis', 'martin', 'miller', 'moore', 'morris', 'smith', 'taylor', 'thomas',
  'walker', 'white', 'williams', 'wilson', 'wright', 'young'
]);

function getActivePresserSpeakers(team = null) {
  const active = team || getActiveTeamConfig();
  if (!active || active.abbr === 'SF') {
    return {
      speakers: PRESSER_SPEAKERS,
      leadShortNames: new Set(['Shanahan', 'Lynch']),
      colonRe: /\b(?:shanahan|lynch|morris|kubiak)\s*:/i
    };
  }
  const coaches = active.coachesSeed || {};
  const speakers = [];
  const leadShortNames = new Set();
  const colonParts = [];
  for (const [role, full] of [
    ['hc', coaches.hc],
    ['gm', coaches.gm],
    ['oc', coaches.oc],
    ['dc', coaches.dc]
  ]) {
    const clean = String(full || '').trim();
    if (!clean || /head coach|coordinator|general manager/i.test(clean)) continue;
    const parts = clean.split(/\s+/);
    const last = parts[parts.length - 1] || clean;
    const shortName = last;
    const escFull = escapeDigestRegex(clean).replace(/\\ /g, '\\s+');
    const escLast = escapeDigestRegex(last);
    const useSurname = last.length >= 5 && !COMMON_SPEAKER_SURNAMES.has(last.toLowerCase());
    speakers.push({
      name: clean,
      shortName,
      re: new RegExp(`\\b(?:${escFull}${useSurname ? `|${escLast}` : ''})\\b`, 'i')
    });
    if (role === 'hc' || role === 'gm') leadShortNames.add(shortName);
    colonParts.push(escFull);
    if (useSurname) colonParts.push(escLast);
  }
  return {
    speakers,
    leadShortNames,
    colonRe: colonParts.length > 0 ? new RegExp(`\\b(?:${colonParts.join('|')})\\s*:`, 'i') : null
  };
}

export function extractPresserTakeaways(
  rawItems = [],
  { nowMs = Date.now(), maxWindowHours = 42, maxTakeaways = 5, team = null } = {}
) {
  const list = Array.isArray(rawItems) ? rawItems : [];
  const cutoffMs = nowMs - maxWindowHours * 3_600_000;
  const activeTeam = team || getActiveTeamConfig();
  const { speakers, leadShortNames, colonRe } = getActivePresserSpeakers(activeTeam);
  const candidates = [];

  for (const item of list) {
    if (!item || item.type === 'video') continue;
    const pubMs = getItemTimestampMs(item);
    if (!pubMs || pubMs < cutoffMs) continue;

    const activeTeamNick = activeTeam?.nickname || '49ers';
    const rawAuthor = item.author || item.reporterName || item.outletName || `${activeTeamNick} Beat`;
    const rawBody = stripRedundantAuthorBoilerplate(
      item.type === 'tweet' || item.type === 'social'
        ? item.fullText || item.title || ''
        : `${item.title || ''}${item.summary ? `. ${item.summary}` : ''}`,
      rawAuthor
    ).trim();
    if (rawBody.length < 35) continue;

    const speaker = speakers.find(s => s.re.test(rawBody) && (!s.rejectRe || !s.rejectRe.test(rawBody)));
    if (!speaker) continue;

    const hasDirectQuote = /[“"][^”"]{14,}[”"]/.test(rawBody);
    const hasPresserSignal =
      PRESSER_VERB_RE.test(rawBody) ||
      Boolean(colonRe && colonRe.test(rawBody));
    if (!hasDirectQuote && !hasPresserSignal) continue;

    // Exclude clickbait / podcast promo blurbs
    if (/\b(subscribe|podcast episode|watch live|tune in|betting odds|fantasy start)\b/i.test(rawBody)) {
      continue;
    }

    const isTw = item.type === 'tweet' || item.type === 'social';
    const href = isTw
      ? sanitizeExternalUrl(resolveOriginalTweetUrl(item, list), null)
      : sanitizeExternalUrl(item.url, null);
    if (!href) continue;

    const cleanSnippet = rawBody
      .replace(/\s+/g, ' ')
      .replace(/https?:\/\/\S+/g, '')
      .trim();
    const displayText = cleanSnippet.length > 185 ? `${cleanSnippet.slice(0, 182).replace(/\s+\S*$/, '')}…` : cleanSnippet;

    const topicTag = /\b(injur|ir\b|practice|achilles|hamstring|knee|ankle|back|groin|calf|foot|concussion|day-to-day|window|return|out|questionable)\b/i.test(
      cleanSnippet
    )
      ? 'Health'
      : /\b(cap|contract|trade|sign|roster|activate|waive)\b/i.test(cleanSnippet)
        ? 'Roster'
        : /\b(offense|defense|scheme|blitz|cover|run game|pass rush|red zone|snap|play-call)\b/i.test(cleanSnippet)
          ? 'Scheme'
          : 'Podium';

    const priorityScore =
      (leadShortNames.has(speaker.shortName) ? 24 : 12) +
      (hasDirectQuote ? 14 : 0) +
      (topicTag === 'Health' || topicTag === 'Roster' ? 10 : 4) +
      Math.max(0, 14 - (nowMs - pubMs) / 3_600_000);

    candidates.push({
      id: item.id || href,
      speaker: speaker.shortName,
      speakerFull: speaker.name,
      topicTag,
      text: displayText,
      sourceAuthor: formatWireSourceDisplayName(rawAuthor, item),
      sourceUrl: href,
      publishedAt: item.publishedAt,
      pubMs,
      priorityScore,
      tokens: normalizePresserTopicFingerprint(cleanSnippet)
    });
  }

  candidates.sort((a, b) => b.priorityScore - a.priorityScore || b.pubMs - a.pubMs);

  const selected = [];
  for (const cand of candidates) {
    const isDup = selected.some(existing => {
      if (existing.speaker !== cand.speaker) return false;
      const overlap = cand.tokens.filter(t => existing.tokens.includes(t)).length;
      return overlap >= 2;
    });
    if (isDup) continue;
    selected.push(cand);
    if (selected.length >= maxTakeaways) break;
  }

  // Only surface the Presser strip when there are at least 2 distinct concrete takeaways
  return selected.length >= 2 ? selected : [];
}

/* ============================================================================
 * 10. Reading-Time / Effort Cues, Video Durations & Inline Chart/Media Preview Detection
 * ============================================================================ */

/**
 * Parses an ISO-8601 duration string (e.g. `PT31M31S`, `PT1H02M15S`, `PT54S`) into integer seconds.
 */
export function parseIso8601DurationToSeconds(iso = '') {
  const s = String(iso || '').trim().toUpperCase();
  const m = s.match(/^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?$/);
  if (!m) return 0;
  const hrs = Number(m[1] || 0);
  const mins = Number(m[2] || 0);
  const secs = Math.round(Number(m[3] || 0));
  const total = hrs * 3600 + mins * 60 + secs;
  return Number.isFinite(total) && total > 0 ? total : 0;
}

/**
 * Formats a verified video duration (seconds, ISO-8601 `PT...`, or `M:SS`/`H:MM:SS` string)
 * into a crisp display label (`0:54`, `6:20`, `31:31`, `1:02:15`). Rejects zero/placeholder strings.
 */
export function formatVideoDurationDisplay(rawDuration) {
  if (rawDuration === null || rawDuration === undefined) return '';
  if (typeof rawDuration === 'number') {
    if (!Number.isFinite(rawDuration) || rawDuration < 1) return '';
    const total = Math.round(rawDuration);
    const hrs = Math.floor(total / 3600);
    const mins = Math.floor((total % 3600) / 60);
    const secs = total % 60;
    return hrs > 0
      ? `${hrs}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`
      : `${mins}:${String(secs).padStart(2, '0')}`;
  }

  const s = String(rawDuration).trim();
  if (!s || /^(?:0|0:00|00:00|0:00:00|video|clip|gif|n\/a|tbd|—|-)$/i.test(s)) return '';

  // Pure numeric seconds string (e.g. "1891", "54")
  if (/^\d+(?:\.\d+)?$/.test(s)) {
    return formatVideoDurationDisplay(Number(s));
  }

  // ISO-8601 duration (e.g. "PT31M31S")
  if (/^PT/i.test(s)) {
    const secs = parseIso8601DurationToSeconds(s);
    return secs > 0 ? formatVideoDurationDisplay(secs) : '';
  }

  // Already formatted H:MM:SS or M:SS
  const hms = s.match(/^(\d{1,2}):(\d{2}):(\d{2})$/);
  if (hms) {
    const h = Number(hms[1]);
    const m = Number(hms[2]);
    const sec = Number(hms[3]);
    if (h === 0 && m === 0 && sec === 0) return '';
    return h > 0
      ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`
      : `${m}:${String(sec).padStart(2, '0')}`;
  }
  const ms = s.match(/^(\d{1,3}):(\d{2})$/);
  if (ms) {
    const m = Number(ms[1]);
    const sec = Number(ms[2]);
    if (m === 0 && sec === 0) return '';
    if (m >= 60) {
      return formatVideoDurationDisplay(m * 60 + sec);
    }
    return `${m}:${String(sec).padStart(2, '0')}`;
  }

  return '';
}

export function estimateItemEffortCue(item = {}) {
  if (!item || typeof item !== 'object') return '';
  const isVideo = item.type === 'video' || Boolean(item.videoId || item.videoStreamUrl);
  if (isVideo) return ''; // Video duration already displayed cleanly

  const isTweet = item.type === 'tweet' || item.type === 'social';
  if (isTweet) {
    const body = String(item.fullText || item.title || '');
    if (/\b(?:1\/\d+|thread|🧵)\b/i.test(body) || body.length >= 340) return 'Thread';
    return '';
  }

  if (item.category === 'film') return 'Film study';
  if (item.wireSource === 'espn_player_wire' || String(item.id || '').startsWith('espn_pwire_')) {
    return 'Quick note';
  }
  const wc = Number(item.wordCount || 0);
  if (wc >= 900) return `${Math.max(4, Math.round(wc / 220))} min`;
  if (wc >= 260) return `${Math.max(2, Math.round(wc / 220))} min`;
  const textLen = `${item.title || ''} ${item.summary || ''}`.trim().length;
  if (textLen >= 220) return '3 min';
  return '2 min';
}

export function extractInlinePreviewVisual(item = {}) {
  if (!item || typeof item !== 'object') return null;
  const isVideo = item.type === 'video' || Boolean(item.videoId || item.videoStreamUrl);
  if (isVideo) return null;

  const isTweet = item.type === 'tweet' || item.type === 'social';
  const rawImg = String(item.fullImageUrl || item.imageUrl || '').trim();
  if (!rawImg || !/^https:\/\//i.test(rawImg)) return null;
  // Never treat tiny player headshots or team logos as expandable charts/photos
  if (/espncdn\.com\/i\/headshots|\/teamlogos\//i.test(rawImg)) return null;

  const isSocialMediaGraphic =
    isTweet &&
    (/cdn\.bsky\.app\/img\/feed_/i.test(rawImg) || /pbs\.twimg\.com\/media\//i.test(rawImg));

  if (!isSocialMediaGraphic) return null;

  const fullSrc = rawImg.replace('/img/feed_thumbnail/', '/img/feed_fullsize/');
  const body = `${item.title || ''} ${item.fullText || ''}`;
  const isChart = /\b(epa|cpoe|chart|graph|table|snap|target share|win rate|pff|grade|dvoa|split|rank|plot|next gen)\b/i.test(
    body
  );
  return {
    src: fullSrc,
    fallbackSrc: rawImg,
    label: isChart ? 'Expand Chart' : 'View Image',
    isChart
  };
}

/* ============================================================================
 * 2. Universal Instant Search (Delegated to universalSearchEngine.js)
 * ============================================================================ */

export {
  SEARCH_SCOPES,
  QUICK_SECTION_TARGETS,
  normalizeSearchText,
  tokenizeSearchQuery,
  damerauLevenshtein,
  buildUniversalSearchLexicon,
  suggestSpellingCorrection,
  getSearchAutocompleteSuggestions,
  matchNewsItemSearchQuery,
  highlightSearchTextHtml,
  runUniversalSearch
} from './universalSearchEngine.js';

/* ============================================================================
 * 12. Quiet Web Push Alert Helpers
 * ============================================================================ */

export function urlBase64ToUint8Array(base64String = '') {
  const clean = String(base64String || '').trim();
  if (!clean) return new Uint8Array(0);
  const padding = '='.repeat((4 - (clean.length % 4)) % 4);
  const base64 = (clean + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = typeof atob === 'function' ? atob(base64) : Buffer.from(base64, 'base64').toString('binary');
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; i++) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

export function evaluatePushSupportStatus() {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') {
    return { supported: false, reason: 'unavailable', permission: 'default', isIosBrowserTab: false };
  }
  const ua = String(navigator.userAgent || '');
  const isIos = /iPhone|iPad|iPod/i.test(ua);
  const isStandalone =
    window.matchMedia?.('(display-mode: standalone)')?.matches ||
    window.navigator.standalone === true;

  if (isIos && !isStandalone) {
    return {
      supported: false,
      reason: 'ios_requires_pwa',
      permission: typeof Notification !== 'undefined' ? Notification.permission : 'default',
      isIosBrowserTab: true
    };
  }
  const supported =
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    typeof Notification !== 'undefined';
  return {
    supported,
    reason: supported ? 'ready' : 'unsupported_browser',
    permission: typeof Notification !== 'undefined' ? Notification.permission : 'default',
    isIosBrowserTab: false
  };
}

/* ============================================================================
 * 13. Reading Position & Zero-Flicker Background Refresh Stability Helpers
 * ============================================================================ */

/**
 * Strips volatile relative-time text (e.g. `4m ago`, `2h ago`, `Sync…`) from rendered HTML
 * strictly for background no-op diffing so routine clock ticks never trigger a destructive
 * `#mainView` innerHTML wipe and image flicker.
 */
export function stripVolatileRelativeTimesFromHtml(html = '') {
  const raw = String(html || '');
  if (!raw) return '';
  return raw
    .replace(
      /(<span\b[^>]*\bdata-wire-age\b[^>]*>)([^<]*)(<\/span>)/gi,
      (_, open, inner, close) =>
        `${open}${String(inner).replace(/(?:Just now|now|Recently updated|\d+\s*[mhd]\s*ago)\s*$/i, '__AGE__')}${close}`
    )
    .replace(
      /(<span\b[^>]*\bdata-daily-brief-age\b[^>]*>)([^<]*)(<\/span>)/gi,
      '$1__AGE__$3'
    )
    .replace(
      /(<span\b[^>]*\bclass="[^"]*\bsource-row-age\b[^"]*"[^>]*>)([^<]*)(<\/span>)/gi,
      '$1__AGE__$3'
    )
    .replace(
      /(<span\b[^>]*\bclass="[^"]*\bpresser-strip-meta\b[^"]*"[^>]*>)([^<]*)(<\/span>)/gi,
      (_, open, inner, close) =>
        `${open}${String(inner).replace(/·\s*(?:Just now|now|Recently updated|\d+\s*[mhd]\s*ago)/gi, '· __AGE__')}${close}`
    )
    .replace(
      /(<button\b[^>]*\bdata-action="sync-live-wire-now"[^>]*>)([\s\S]*?)(<\/button>)/gi,
      '$1__SYNC_BTN__$3'
    )
    .replace(
      /(<span\b[^>]*\bclass="[^"]*\bcatchup-bar-text\b[^"]*"[^>]*>[\s\S]*?\bsince\s+)([^<]+)(<\/span>)/gi,
      '$1__SINCE__$3'
    );
}

/**
 * Extracts a lightweight structural snapshot of the rendered News & Film feed from HTML
 * so background polls can tell whether actual new stories or a new Daily Brief arrived
 * without parsing the full DOM.
 */
export function extractNewsFeedSnapshotFromHtml(html = '') {
  const raw = String(html || '');
  const itemKeys = [];
  const seen = new Set();
  const breakingKeys = [];
  const breakingSeen = new Set();

  const cardTagRe = /<div\b[^>]*\bclass="[^"]*\bbrief-card\b[^"]*"[^>]*>/gi;
  let m;
  while ((m = cardTagRe.exec(raw)) !== null) {
    const tag = m[0];
    const keyM = tag.match(/\bdata-read-key="([^"]+)"/i);
    if (!keyM) continue;
    const key = keyM[1];
    if (!seen.has(key)) {
      seen.add(key);
      itemKeys.push(key);
    }
    if (/\bbreaking-elevated\b/i.test(tag) && !breakingSeen.has(key)) {
      breakingSeen.add(key);
      breakingKeys.push(key);
    }
  }

  let briefSig = '';
  const briefTagM = raw.match(/<(?:section|div)\b[^>]*\bdata-daily-news-brief="([^"]*)"[^>]*>/i);
  if (briefTagM) {
    const tag = briefTagM[0];
    const id = briefTagM[1] || '';
    const genM = tag.match(/\bdata-brief-gen="([^"]*)"/i);
    const hlM = tag.match(/\bdata-brief-headline="([^"]*)"/i);
    briefSig = `${id}|${genM ? genM[1] : ''}|${hlM ? hlM[1] : ''}`;
  }

  return { itemKeys, breakingKeys, briefSig };
}

/**
 * Decides whether a background News & Film update should defer DOM replacement to protect
 * the user's current reading position, and computes the unobtrusive pending-updates pill state.
 */
export function evaluateNewsBackgroundUpdate({
  renderedSnapshot = null,
  nextSnapshot = null,
  scrollY = 0,
  deferScrollThresholdPx = 72,
  existingPendingKeys = [],
  existingBriefPending = false
} = {}) {
  const renderedSet = new Set(Array.isArray(renderedSnapshot?.itemKeys) ? renderedSnapshot.itemKeys : []);
  const nextKeys = Array.isArray(nextSnapshot?.itemKeys) ? nextSnapshot.itemKeys : [];
  const nextBreakingSet = new Set(Array.isArray(nextSnapshot?.breakingKeys) ? nextSnapshot.breakingKeys : []);

  const newlyAdded = [];
  for (const key of nextKeys) {
    if (key && !renderedSet.has(key)) {
      newlyAdded.push(key);
    }
  }

  const nextKeySet = new Set(nextKeys);
  const pendingKeySet = new Set();
  for (const prevPending of Array.isArray(existingPendingKeys) ? existingPendingKeys : []) {
    if (prevPending && nextKeySet.has(prevPending) && !renderedSet.has(prevPending)) {
      pendingKeySet.add(prevPending);
    }
  }
  for (const key of newlyAdded) {
    pendingKeySet.add(key);
  }
  const pendingKeys = Array.from(pendingKeySet);
  const addedCount = pendingKeys.length;
  const hasBreakingAdded = pendingKeys.some(k => nextBreakingSet.has(k));

  const prevBriefSig = String(renderedSnapshot?.briefSig || '');
  const nextBriefSig = String(nextSnapshot?.briefSig || '');
  const briefChanged = Boolean(
    existingBriefPending || (prevBriefSig && nextBriefSig && prevBriefSig !== nextBriefSig)
  );

  const safeScrollY = Number.isFinite(Number(scrollY)) ? Math.max(0, Number(scrollY)) : 0;
  const shouldDeferDomSwap = safeScrollY > deferScrollThresholdPx;
  const shouldShowPendingPill = Boolean(shouldDeferDomSwap && (addedCount > 0 || briefChanged));

  let pillLabel = '';
  if (addedCount > 0) {
    const noun = addedCount === 1 ? 'new update' : 'new updates';
    pillLabel = hasBreakingAdded ? `Breaking · ${addedCount} new` : `${addedCount} ${noun}`;
  } else if (briefChanged) {
    pillLabel = 'Top Brief updated';
  }

  return {
    addedKeys: newlyAdded,
    pendingKeys,
    addedCount,
    hasBreakingAdded,
    briefChanged,
    shouldDeferDomSwap,
    shouldShowPendingPill,
    pillLabel
  };
}

/**
 * Computes the exact window.scrollY needed to keep an anchored reading element at the same
 * viewport Y coordinate after a DOM re-render inserts, removes, or resizes content above it.
 */
export function computeScrollAnchorTargetY({
  prevAnchorTop = 0,
  nextAnchorTop = 0,
  currentScrollY = 0,
  maxScrollY = Infinity
} = {}) {
  const prevTop = Number(prevAnchorTop);
  const nextTop = Number(nextAnchorTop);
  const curY = Number(currentScrollY);
  if (!Number.isFinite(prevTop) || !Number.isFinite(nextTop) || !Number.isFinite(curY)) {
    return Math.max(0, Number.isFinite(curY) ? Math.round(curY) : 0);
  }
  const deltaY = nextTop - prevTop;
  const unclamped = Math.round(curY + deltaY);
  const hi = Number.isFinite(Number(maxScrollY)) ? Math.max(0, Math.round(Number(maxScrollY))) : Infinity;
  return Math.max(0, Math.min(hi, unclamped));
}
