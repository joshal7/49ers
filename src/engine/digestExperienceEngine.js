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
  isUrgentBreakingBadge,
  stripRedundantAuthorBoilerplate
} from './breakingClassifier.js';
import {
  formatWireSourceDisplayName,
  sanitizeExternalUrl
} from './linkIntegrity.js';
import { resolveOriginalTweetUrl } from './beatAttributionEngine.js';

export const NEWS_SORT_MODES = [
  { key: 'top', label: 'Top', shortLabel: 'Top', title: 'Highest-impact stories, breaking updates & corroborated scoops (Default)' },
  { key: 'latest', label: 'Latest', shortLabel: 'Latest', title: 'Strict chronological wire (newest first)' }
];

export const VALID_NEWS_SORT_MODES = new Set(['top', 'latest']);

export const DEFAULT_PUSH_ALERT_PREFS = {
  enabled: false,
  channels: {
    tier1Breaking: true,
    dailyBriefReady: true,
    practiceDowngrades: false
  },
  subscribedAt: null,
  endpoint: ''
};

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

export function computeTopSignalScore(item = {}, nowMs = Date.now()) {
  const pubMs = getItemTimestampMs(item);
  const ageHours = pubMs > 0 ? Math.max(0, (nowMs - pubMs) / 3_600_000) : 72;
  const storyRank = Number(item.storyRank);
  const baseSignal = Number.isFinite(storyRank) && storyRank > 0
    ? storyRank
    : computeNewsSalienceScore(item) * 2.2;
  const relatedCount = item.confirmingReports?.length || 0;
  const corroborationBonus = item._isLowSalienceRoundupCluster
    ? 0
    : item.clusterKind === 'similar'
      ? Math.min(12, relatedCount * 3.5)
      : Math.min(28, relatedCount * 8);
  const urgentBonus = isUrgentBreakingBadge(item.breakingBadge) ? 35 : 0;
  // Gentle 60-hour half-life so top stories/film breakdowns of the cycle dominate while stale multi-day items decay cleanly
  const gentleDecay = Math.pow(0.5, Math.max(0, ageHours - 6) / 60);
  return (baseSignal + corroborationBonus + urgentBonus) * gentleDecay;
}

export function compareLatestNewsItems(a = {}, b = {}) {
  const aLiveInj = a?.isInGameInjury && isUrgentBreakingBadge(a?.breakingBadge) ? 1 : 0;
  const bLiveInj = b?.isInGameInjury && isUrgentBreakingBadge(b?.breakingBadge) ? 1 : 0;
  if (aLiveInj !== bLiveInj) return bLiveInj - aLiveInj;
  return getItemTimestampMs(b) - getItemTimestampMs(a);
}

export function sortNewsFeedByMode(items = [], sortMode = 'top', { nowMs = Date.now() } = {}) {
  const mode = normalizeNewsSortMode(sortMode);
  const list = Array.isArray(items) ? [...items] : [];
  if (list.length <= 1) return list;

  if (mode === 'latest') {
    return list.sort(compareLatestNewsItems);
  }

  // Default: 'top' (storyRank impact + freshness + corroboration decay, with live in-game urgent injuries pinned #1)
  return list.sort((a, b) => {
    const aLiveInj = a?.isInGameInjury && isUrgentBreakingBadge(a?.breakingBadge) ? 1 : 0;
    const bLiveInj = b?.isInGameInjury && isUrgentBreakingBadge(b?.breakingBadge) ? 1 : 0;
    if (aLiveInj !== bLiveInj) return bLiveInj - aLiveInj;
    const diff = computeTopSignalScore(b, nowMs) - computeTopSignalScore(a, nowMs);
    if (Math.abs(diff) >= 0.4) return diff;
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

export function classifySourceLensTag(item = {}) {
  const hay = `${item.author || ''} ${item.reporterName || ''} ${item.outletName || ''} ${item.url || ''}`;
  if (OFFICIAL_LENS_RE.test(hay)) return 'Official';
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

    const rawAuthor = item.author || item.reporterName || item.outletName || '49ers Beat';
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

  const days = [row.wed, row.thu, row.fri]
    .map(v => ({ code: shortPracticeCode(v), level: parsePracticeLevel(v) }))
    .filter(d => d.level !== null);

  let trajectory = null;
  if (days.length >= 2) {
    const first = days[0];
    const last = days[days.length - 1];
    if (last.level > first.level) {
      trajectory = {
        direction: 'up',
        arrow: '↑',
        shortLabel: `${first.code}→${last.code} ↑`,
        tone: 'positive'
      };
    } else if (last.level < first.level) {
      trajectory = {
        direction: 'down',
        arrow: '↓',
        shortLabel: `${first.code}→${last.code} ↓`,
        tone: 'danger'
      };
    }
  }

  let probDelta = null;
  const curPct = Number(row.playProbabilityPct);
  const prevPct = Number(prevSnapshotEntry?.playProbabilityPct);
  if (Number.isFinite(curPct) && Number.isFinite(prevPct)) {
    const diff = Math.round(curPct - prevPct);
    if (Math.abs(diff) >= 5) {
      probDelta = {
        diff,
        label: `${diff > 0 ? '+' : ''}${diff}%`,
        tone: diff > 0 ? 'positive' : 'danger'
      };
    }
  }

  if (!trajectory && !probDelta) return null;
  return {
    trajectory,
    probDelta,
    displayLabel: trajectory ? trajectory.shortLabel : probDelta.label,
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
  { name: 'Kyle Shanahan', shortName: 'Shanahan', re: /\b(?:kyle\s+)?shanahan\b/i },
  { name: 'John Lynch', shortName: 'Lynch', re: /\b(?:john\s+)?lynch\b/i },
  { name: 'Raheem Morris', shortName: 'Morris', re: /\b(?:raheem\s+)?morris\b/i },
  { name: 'Klay Kubiak', shortName: 'Kubiak', re: /\b(?:klay\s+)?kubiak\b/i },
  { name: 'Brock Purdy', shortName: 'Purdy', re: /\b(?:brock\s+)?purdy\b/i },
  { name: 'George Kittle', shortName: 'Kittle', re: /\b(?:george\s+)?kittle\b/i },
  { name: 'Fred Warner', shortName: 'Warner', re: /\b(?:fred\s+)?warner\b/i },
  { name: 'Nick Bosa', shortName: 'Bosa', re: /\b(?:nick\s+)?bosa\b/i },
  { name: 'Christian McCaffrey', shortName: 'McCaffrey', re: /\b(?:christian\s+)?mccaffrey\b/i },
  { name: 'Trent Williams', shortName: 'T. Williams', re: /\btrent\s+williams\b/i }
];

const PRESSER_VERB_RE =
  /\b(said|says|told reporters|on\s+(?:the\s+)?podium|press conference|presser|conference call|spoke\s+(?:with|to)\s+reporters|confirmed|announced|updated|explained|noted|expects|optimistic|hopeful|ruled\s+out|day-to-day|week-to-week|addressed|discussed)\b/i;

function normalizePresserTopicFingerprint(text = '') {
  return String(text || '')
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length >= 4 && !/^(?:kyle|shanahan|john|lynch|49ers|niners|said|says|with|that|this|from|have|will|about|their|after|week|game|today|sunday|monday|wednesday|thursday|friday)$/.test(w))
    .slice(0, 6);
}

export function extractPresserTakeaways(
  rawItems = [],
  { nowMs = Date.now(), maxWindowHours = 42, maxTakeaways = 5 } = {}
) {
  const list = Array.isArray(rawItems) ? rawItems : [];
  const cutoffMs = nowMs - maxWindowHours * 3_600_000;
  const candidates = [];

  for (const item of list) {
    if (!item || item.type === 'video') continue;
    const pubMs = getItemTimestampMs(item);
    if (!pubMs || pubMs < cutoffMs) continue;

    const rawAuthor = item.author || item.reporterName || item.outletName || '49ers Beat';
    const rawBody = stripRedundantAuthorBoilerplate(
      item.type === 'tweet' || item.type === 'social'
        ? item.fullText || item.title || ''
        : `${item.title || ''}${item.summary ? `. ${item.summary}` : ''}`,
      rawAuthor
    ).trim();
    if (rawBody.length < 35) continue;

    const speaker = PRESSER_SPEAKERS.find(s => s.re.test(rawBody));
    if (!speaker) continue;

    const hasDirectQuote = /[“"][^”"]{14,}[”"]/.test(rawBody);
    const hasPresserSignal =
      PRESSER_VERB_RE.test(rawBody) ||
      /\b(?:shanahan|lynch|morris|kubiak)\s*:/i.test(rawBody);
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

    const topicTag = /\b(injur|ir\b|practice|achilles|hamstring|knee|ankle|back|groin|day-to-day|window|return|out|questionable)\b/i.test(
      cleanSnippet
    )
      ? 'Health'
      : /\b(cap|contract|trade|sign|roster|activate|waive)\b/i.test(cleanSnippet)
        ? 'Roster'
        : /\b(offense|defense|scheme|blitz|cover|run game|pass rush|red zone|snap|play-call)\b/i.test(cleanSnippet)
          ? 'Scheme'
          : 'Podium';

    const priorityScore =
      (speaker.shortName === 'Shanahan' || speaker.shortName === 'Lynch' ? 24 : 12) +
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
 * 10. Reading-Time / Effort Cues & Inline Chart/Media Preview Detection
 * ============================================================================ */

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
 * 2. Universal Instant Search (Players, News & Film, Podcasts & AI, Sections)
 * ============================================================================ */

const QUICK_SECTION_TARGETS = [
  { id: 'sec_matchup', title: 'Upcoming Matchup & Coaching Intel', subtitle: 'Game & Season', keywords: 'matchup game preview spread coaching trenches opponent', navTab: 'season', subTab: 'matchup' },
  { id: 'sec_health', title: 'Team Health & Injury Report', subtitle: 'Game & Season', keywords: 'health injury report practice dnp lp fp ir reserve', navTab: 'season', subTab: 'health' },
  { id: 'sec_schedule', title: 'Full Season Schedule', subtitle: 'Game & Season', keywords: 'schedule calendar games bye international venue', navTab: 'season', subTab: 'schedule' },
  { id: 'sec_stats', title: 'Team Stats & Power Rankings', subtitle: 'Game & Season', keywords: 'stats rankings epa offense defense special teams power rankings', navTab: 'season', subTab: 'stats' },
  { id: 'sec_trade', title: 'Trades & Deadline Intel', subtitle: 'Game & Season', keywords: 'trade deadline rumors acquisitions needs', navTab: 'season', subTab: 'trade' },
  { id: 'sec_playoffs', title: 'Playoff Odds & Rooting Guide', subtitle: 'Game & Season', keywords: 'playoffs monte carlo seed bye rooting guide standings', navTab: 'season', subTab: 'playoffs' },
  { id: 'sec_draft', title: 'Draft Big Board & Mocks', subtitle: 'Game & Season', keywords: 'draft big board mock prospects combine pff buzz', navTab: 'season', subTab: 'draft_prep' },
  { id: 'sec_draft_recap', title: 'Draft Recap & Rookies', subtitle: 'Game & Season', keywords: 'draft recap rookies udfa spider chart', navTab: 'season', subTab: 'draft_class' },
  { id: 'sec_roster', title: '53-Man Roster Explorer', subtitle: 'Roster & Cap', keywords: 'roster players jersey ras snap share', navTab: 'roster', subTab: 'roster' },
  { id: 'sec_depth', title: 'Dual Depth Chart', subtitle: 'Roster & Cap', keywords: 'depth chart starters backups rotation', navTab: 'roster', subTab: 'depth' },
  { id: 'sec_cap', title: 'Salary Cap & Armchair GM Simulator', subtitle: 'Roster & Cap', keywords: 'salary cap overthecap dead money restructure cut rollover contract', navTab: 'roster', subTab: 'cap' },
  { id: 'sec_podcasts', title: '49ers Beat Podcasts (6 Shows)', subtitle: 'Audio & AI', keywords: 'podcasts gold standard 49ers talk locked on lombardi plus minus', navTab: 'audio', subTab: 'beat_podcasts' },
  { id: 'sec_autopod', title: 'Auto Pod Studio', subtitle: 'Audio & AI', keywords: 'autopod auto pod audio briefing studio', navTab: 'audio', subTab: 'podcast' },
  { id: 'sec_analysis', title: 'On-Demand AI Deep Analysis', subtitle: 'Audio & AI', keywords: 'ai analysis deep research scouting ask gemini', navTab: 'audio', subTab: 'analysis' }
];

function normSearchToken(s = '') {
  return String(s || '')
    .toLowerCase()
    .replace(/['’`.]/g, '')
    .trim();
}

export function runUniversalSearch(
  rawQuery = '',
  { appData = null, filteredRawItems = [], allEpisodes = [], allAnalyses = [] } = {}
) {
  const qRaw = String(rawQuery || '').trim();
  const qClean = qRaw.replace(/^#/, '');
  const qNorm = normSearchToken(qClean);

  if (!qNorm) {
    return {
      query: '',
      totalCount: 0,
      players: [],
      news: [],
      audioAndAi: [],
      sections: QUICK_SECTION_TARGETS.slice(0, 6)
    };
  }

  const tokens = qNorm.split(/\s+/).filter(Boolean);
  const matchesAllTokens = haystack => {
    const h = normSearchToken(haystack);
    return tokens.every(tok => h.includes(tok));
  };

  // 1. Players
  const players = [];
  for (const p of appData?.roster?.players || []) {
    const jerseyStr = p.jersey != null ? String(p.jersey) : '';
    const isExactJersey = /^\d{1,2}$/.test(qClean) && jerseyStr === qClean;
    const hay = `${p.name || ''} ${p.position || ''} ${p.college || ''} ${p.injuryType || ''} ${p.rosterBucket || ''} ${jerseyStr}`;
    if (isExactJersey || matchesAllTokens(hay)) {
      const nameStarts = normSearchToken(p.name).startsWith(qNorm) ? 2 : 0;
      const activeBonus = p.rosterBucket === 'active' ? 1 : 0;
      players.push({
        id: p.id,
        name: p.name,
        position: p.position,
        jersey: p.jersey,
        headshotUrl: p.headshotUrl,
        rosterBucket: p.rosterBucket,
        injuryType: p.injuryType,
        playBadgeLabel: p.playBadgeLabel,
        playProbabilityPct: p.playProbabilityPct,
        score: (isExactJersey ? 10 : 0) + nameStarts + activeBonus
      });
    }
  }
  players.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));

  // 2. News & Film
  const news = [];
  const newsSource = Array.isArray(filteredRawItems) && filteredRawItems.length > 0
    ? filteredRawItems
    : appData?.news?.rawStream || [];
  const seenNewsUrls = new Set();
  for (const it of newsSource) {
    const hay = `${it.title || ''} ${it.summary || ''} ${it.fullText || ''} ${it.author || ''} ${it.outletName || ''} ${(it.mentionedPlayers || []).map(p => p.name).join(' ')}`;
    if (!matchesAllTokens(hay)) continue;
    const isTw = it.type === 'tweet' || it.type === 'social';
    const href = isTw
      ? sanitizeExternalUrl(resolveOriginalTweetUrl(it, newsSource), null)
      : sanitizeExternalUrl(it.url, null);
    if (!href) continue;
    const normUrl = href.toLowerCase().replace(/\/+$/, '');
    if (seenNewsUrls.has(normUrl)) continue;
    seenNewsUrls.add(normUrl);
    news.push({
      id: it.id,
      type: it.type,
      category: it.category,
      title: it.title || it.fullText || '',
      author: formatWireSourceDisplayName(it.author || it.outletName || '49ers Beat', it),
      href,
      publishedAt: it.publishedAt,
      pubMs: getItemTimestampMs(it)
    });
  }
  news.sort((a, b) => b.pubMs - a.pubMs);

  // 3. Beat Podcasts, Auto Pods & AI Analyses
  const audioAndAi = [];
  for (const ep of appData?.beatPodcasts?.episodes || []) {
    if (matchesAllTokens(`${ep.title || ''} ${ep.showName || ''} ${ep.hosts || ''} ${ep.summary || ''}`)) {
      audioAndAi.push({
        kind: 'beat_podcast',
        id: ep.id || ep.title,
        title: ep.title,
        subtitle: `${ep.showName || 'Podcast'}${ep.durationDisplay ? ` • ${ep.durationDisplay}` : ''}`,
        publishedAt: ep.publishedAt,
        showId: ep.showId
      });
    }
  }
  for (const ep of allEpisodes || []) {
    if (matchesAllTokens(`${ep.title || ''} ${ep.topic || ''}`)) {
      audioAndAi.push({
        kind: 'autopod',
        id: ep.id,
        title: ep.title,
        subtitle: `Auto Pod • ${ep.presetLabel || 'Briefing'}`,
        publishedAt: ep.createdAt
      });
    }
  }
  for (const rep of allAnalyses || []) {
    if (matchesAllTokens(`${rep.title || ''} ${rep.summary || ''}`)) {
      audioAndAi.push({
        kind: 'analysis',
        id: rep.id,
        title: rep.title,
        subtitle: 'AI Deep Analysis',
        publishedAt: rep.createdAt
      });
    }
  }

  // 4. Quick Section Jumps
  const sections = QUICK_SECTION_TARGETS.filter(sec =>
    matchesAllTokens(`${sec.title} ${sec.subtitle} ${sec.keywords}`)
  );

  const topPlayers = players.slice(0, 5);
  const topNews = news.slice(0, 6);
  const topAudio = audioAndAi.slice(0, 4);
  const topSections = sections.slice(0, 4);

  return {
    query: qRaw,
    totalCount: topPlayers.length + topNews.length + topAudio.length + topSections.length,
    totalNewsMatches: news.length,
    players: topPlayers,
    news: topNews,
    audioAndAi: topAudio,
    sections: topSections
  };
}

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
