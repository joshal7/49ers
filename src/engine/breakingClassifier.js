/**
 * Breaking News, Live In-Game Priority, 48h Post-Game Injury Follow-Up,
 * Wire Deduplication & Single-Attribution Text Cleaner
 */

import {
  corroborateAndAnnotateWireStream,
  resolveReporterFromNameOrHandle
} from './beatAttributionEngine.js';

export const SHORT_TWEET_FULL_TEXT_LIMIT = 320;

const IN_GAME_INJURY_RETURN_REGEX =
  /\b(questionable to return|probable to return|doubtful to return|ruled out for the rest|out for the rest of the game|will not return|did not return|cleared to return|back in the game|returning to the game|returned to the game|headed to the locker room|going to the locker room|went to the locker room|blue medical tent|medical tent|evaluated for a concussion|concussion evaluation|carted off|limped off|limping off|helped off the field|helped off|walked off with trainers|with athletic trainers|examined by trainers|examined on the sideline|left the game|exited the game|left sunday'?s game|exited sunday'?s game|in-game injury|injury update)\b/i;

const POST_GAME_INJURY_FOLLOWUP_REGEX =
  /\b(suffered a|sustained a|exited (?:sunday|monday|thursday|saturday|the game)|left (?:sunday|monday|thursday|saturday|the game)|did not return|underwent an mri|scheduled for an mri|\bmri\b|\bx-rays?\b|ct scan|tests showed|initial tests|believed to have avoided|feared to have|day-to-day|week-to-week|high-ankle|sprain|strain|concussion protocol|torn acl|torn achilles|torn pectoral|meniscus|fracture|out multiple weeks|out several weeks|shanahan (?:said|noted|confirmed|announced)[\s\S]{0,65}\b(?:injury|ankle|knee|foot|back|shoulder|hamstring|calf|quad|groin|rib|wrist|hand|concussion|mri|day-to-day|week-to-week))\b/i;

const PRACTICE_WARMUP_INJURY_SCOOP_REGEX =
  /\b(not practicing|not seen at practice|working on a side field|rehab field|blue non-contact|non-contact jersey|walking boot|suffered a setback|aggravated his|underwent an mri|scheduled for an mri|high-ankle sprain|torn acl|torn achilles|torn pectoral|meniscus|21-day practice window|designated to return from|didn't activate|did not activate|game-time decision|full workload)\b/i;

const PRE_GAME_AVAILABILITY_NOISE_REGEX =
  /\b(is inactive|are inactive|officially inactive|inactives:|among .*inactives|won't play|will not play|not playing today|ruled out for (?:sunday|monday|thursday|saturday|today|tonight|week \d+)|unlikely to play|expected to play|good to go|expected to take on a full workload|full workload|game-time decision|remains on injured reserve|not activated from)\b/i;

const SPECULATIVE_OR_RETROSPECTIVE_EXCLUSION_REGEX =
  /\b(mock trade|trade proposal|trade idea|trade pitch|hypothetical|what if|flashback|on this day|\d+\s+years ago|way-too-early|mailbag|merch|promo code)\b/i;

const NON_TRANSACTION_RELEASE_REGEX =
  /\breleased\s+(?:a\s+|an\s+|their\s+|the\s+|its\s+|his\s+|her\s+|new\s+|official\s+|week\s+\d+\s+)?(?:statement|video|hype video|trailer|podcast|episode|schedule|depth chart|uniform|uniforms|jersey|renderings|report|rankings|grades|mock|list|photos|highlights|mic'd up)\b/i;

const BREAKING_ROSTER_OR_STATUS_REGEX =
  /(\bbreaking\b|just in:|per source|per sources|\btrade:|traded to|acquiring|re-acquiring|has been traded|seeking reinstatement|reinstated|activated from ir|activated off ir|activated from injured reserve|placed on injured reserve|placed on ir|game status report|officially active|officially inactive|ruled out|unlikely to play|expected to play|good to go|signed to the active roster|signed to the practice squad|elevated from the practice squad|standard elevation|\bwaived\b|has been released|have released|officially released|released from (?:ir|injured reserve|the practice squad)|\breleased\s+(?:veteran\s+|rookie\s+)?(?:qb|rb|fb|wr|te|ol|ot|og|c|dl|de|dt|nt|edge|lb|ilb|olb|cb|db|s|k|p|ls)\b)/i;

/**
 * Resolves live in-game vs. 48-hour post-game context from schedule & matchup telemetry.
 */
export function resolveGameNewsContext(appData = null, nowMs = Date.now()) {
  if (!appData || typeof appData !== 'object') {
    return {
      inGame: false,
      postGame48h: false,
      activeKickoffMs: null,
      completedKickoffMs: null,
      completedEndMs: null
    };
  }

  const ts = Number.isFinite(nowMs) ? nowMs : Date.now();
  const schedule = appData?.scheduleMatchup?.schedule || [];
  const upcoming = appData?.scheduleMatchup?.upcomingMatchup || {};

  // 1. Check if a 49ers game is currently in progress (from kickoff until completion)
  for (const g of schedule) {
    if (!g || g.completed) continue;
    const koMs = Date.parse(g.dateIso || '');
    const statusLower = String(g.statusDetail || '').toLowerCase();
    const statusIndicatesLive = /\b(q1|q2|q3|q4|1st|2nd|3rd|4th|halftime|in progress|ot|overtime)\b/.test(statusLower);
    if (
      statusIndicatesLive ||
      (Number.isFinite(koMs) && ts >= koMs && ts <= koMs + 4.75 * 3600_000)
    ) {
      return {
        inGame: true,
        postGame48h: false,
        activeKickoffMs: Number.isFinite(koMs) ? koMs : ts - 30 * 60_000,
        completedKickoffMs: null,
        completedEndMs: null
      };
    }
  }

  if (upcoming.liveState === 'in' || upcoming.isGameInProgress) {
    const upKoMs = Date.parse(upcoming.dateIso || upcoming.kickoffIso || '');
    return {
      inGame: true,
      postGame48h: false,
      activeKickoffMs: Number.isFinite(upKoMs) ? upKoMs : ts - 30 * 60_000,
      completedKickoffMs: null,
      completedEndMs: null
    };
  }

  // 2. Check if a 49ers game completed within the last 48 hours
  let latestCompleted = null;
  let latestKoMs = -Infinity;
  for (const g of schedule) {
    if (!g || !g.completed) continue;
    const koMs = Date.parse(g.dateIso || '');
    if (Number.isFinite(koMs) && koMs > latestKoMs && koMs <= ts) {
      latestKoMs = koMs;
      latestCompleted = g;
    }
  }

  if (latestCompleted && Number.isFinite(latestKoMs)) {
    const estEndMs = latestKoMs + 3.25 * 3600_000;
    const sinceEndMs = ts - estEndMs;
    if (ts >= latestKoMs + 2 * 3600_000 && sinceEndMs <= 48 * 3600_000) {
      return {
        inGame: false,
        postGame48h: true,
        activeKickoffMs: null,
        completedKickoffMs: latestKoMs,
        completedEndMs: Math.min(ts, estEndMs)
      };
    }
  }

  return {
    inGame: false,
    postGame48h: false,
    activeKickoffMs: null,
    completedKickoffMs: null,
    completedEndMs: null
  };
}

/**
 * Classifies a tweet or news item for breaking / live in-game / 48h post-game injury priority.
 */
export function classifyBreakingItem(item = {}, nowMs = Date.now(), gameContext = null) {
  const combined = `${item.title || item.headline || ''} ${item.fullText || ''} ${item.summary || ''}`.trim();
  const pubMs = item.publishedAt ? new Date(item.publishedAt).getTime() : NaN;
  const ageHours = Number.isFinite(pubMs) ? Math.max(0, (nowMs - pubMs) / 3_600_000) : 999;

  const isSpeculative = SPECULATIVE_OR_RETROSPECTIVE_EXCLUSION_REGEX.test(combined);
  const matchesInGame = !isSpeculative && IN_GAME_INJURY_RETURN_REGEX.test(combined);
  const matchesPostGameInjury = !isSpeculative && POST_GAME_INJURY_FOLLOWUP_REGEX.test(combined);
  const matchesPracticeInjuryScoop = !isSpeculative && PRACTICE_WARMUP_INJURY_SCOOP_REGEX.test(combined);
  const matchesPreGameAvailabilityNoise = PRE_GAME_AVAILABILITY_NOISE_REGEX.test(combined);
  const matchesBreaking =
    !isSpeculative &&
    !NON_TRANSACTION_RELEASE_REGEX.test(combined) &&
    BREAKING_ROSTER_OR_STATUS_REGEX.test(combined);

  // 1. LIVE IN-GAME MODE: Prioritize in-game tweets & especially in-game injuries; demote pre-game inactives/availability
  if (gameContext?.inGame && Number.isFinite(gameContext.activeKickoffMs)) {
    const koMs = gameContext.activeKickoffMs;
    const isDuringGame = Number.isFinite(pubMs) && pubMs >= koMs - 5 * 60_000;

    if (!isDuringGame || (matchesPreGameAvailabilityNoise && !matchesInGame)) {
      return {
        isBreaking: false,
        isInGameInjury: false,
        breakingPriority: matchesPreGameAvailabilityNoise ? -0.5 : 0,
        breakingBadge: null,
        ageHours
      };
    }

    if (matchesInGame || matchesPostGameInjury) {
      return {
        isBreaking: true,
        isInGameInjury: true,
        breakingPriority: 3.0,
        breakingBadge: 'LIVE INJURY UPDATE',
        ageHours
      };
    }

    if ((item.type === 'tweet' || item.type === 'social') && !isSpeculative) {
      return {
        isBreaking: true,
        isInGameInjury: false,
        breakingPriority: 2.1,
        breakingBadge: 'LIVE IN-GAME',
        ageHours
      };
    }
  }

  // 2. 48-HOUR POST-GAME MODE: Prioritize meaningful updates on in-game injuries; demote stale pre-game workload/inactive notes
  if (gameContext?.postGame48h && Number.isFinite(gameContext.completedKickoffMs)) {
    const koMs = gameContext.completedKickoffMs;
    const isPreFinishedGame = Number.isFinite(pubMs) && pubMs < koMs;

    if (isPreFinishedGame && matchesPreGameAvailabilityNoise) {
      return {
        isBreaking: false,
        isInGameInjury: false,
        breakingPriority: -0.25,
        breakingBadge: null,
        ageHours
      };
    }

    if (!isPreFinishedGame && ageHours <= 48 && (matchesInGame || matchesPostGameInjury)) {
      if (matchesInGame && ageHours <= 4) {
        return {
          isBreaking: true,
          isInGameInjury: true,
          isPostGameInjuryUpdate: true,
          breakingPriority: 3.0,
          breakingBadge: 'LIVE INJURY UPDATE',
          ageHours
        };
      }
      const hasNewDiagnosticDetail = /\b(mri|x-ray|ct scan|day-to-day|week-to-week|high-ankle|sprain|strain|placed on ir|shanahan)\b/i.test(
        combined
      );
      return {
        isBreaking: true,
        isInGameInjury: ageHours <= 6,
        isPostGameInjuryUpdate: true,
        breakingPriority: hasNewDiagnosticDetail ? 2.45 : 2.2,
        breakingBadge: 'INJURY UPDATE',
        ageHours
      };
    }
  }

  // 3. STANDARD / ALL-WEEK BREAKING CLASSIFICATION
  if (matchesInGame && ageHours <= 18) {
    return {
      isBreaking: true,
      isInGameInjury: ageHours <= 8,
      breakingPriority: ageHours <= 8 ? 2 : 1,
      breakingBadge: ageHours <= 8 ? 'LIVE INJURY UPDATE' : 'INJURY UPDATE',
      ageHours
    };
  }

  if (matchesPracticeInjuryScoop && ageHours <= 14) {
    return {
      isBreaking: true,
      isInGameInjury: false,
      breakingPriority: item.isFirstMoverInjuryScoop && ageHours <= 6 ? 1.85 : ageHours <= 8 ? 1.6 : 1,
      breakingBadge: item.isFirstMoverInjuryScoop && ageHours <= 6 ? 'INJURY SCOOP' : 'INJURY UPDATE',
      ageHours
    };
  }

  if (matchesBreaking && ageHours <= 24) {
    return {
      isBreaking: true,
      isInGameInjury: false,
      breakingPriority: ageHours <= 12 ? 1.5 : 1,
      breakingBadge: 'BREAKING',
      ageHours
    };
  }

  if (item.isBreaking && !isSpeculative && ageHours <= 24 && !gameContext?.inGame) {
    return {
      isBreaking: true,
      isInGameInjury: Boolean(item.isInGameInjury),
      breakingPriority: item.isInGameInjury ? 2 : 1,
      breakingBadge: item.breakingBadge || (item.isInGameInjury ? 'LIVE INJURY UPDATE' : 'BREAKING'),
      ageHours
    };
  }

  return {
    isBreaking: false,
    isInGameInjury: false,
    breakingPriority: 0,
    breakingBadge: null,
    ageHours
  };
}

/**
 * Sorts tweets/articles with live in-game & 48h post-game injury awareness.
 */
export function sortNewsWithBreakingPriority(
  items = [],
  nowMs = Date.now(),
  { activeWindowHours = 18, gameContext = null, appData = null } = {}
) {
  const ctx = gameContext || (appData ? resolveGameNewsContext(appData, nowMs) : null);
  const effectiveWindowHours = ctx?.postGame48h ? Math.max(48, activeWindowHours) : activeWindowHours;
  const corroborated = corroborateAndAnnotateWireStream(items, nowMs);

  return corroborated
    .map(it => {
      const cls = classifyBreakingItem(it, nowMs, ctx);
      const repEntry = resolveReporterFromNameOrHandle(it.reporterId || it.author || it.reporterName || it.authorHandle);
      const trustTier = Number(it.trustTier) || repEntry?.trustTier || 2;
      const withinWindow = cls.breakingPriority < 0 || cls.ageHours <= effectiveWindowHours;
      return {
        ...it,
        trustTier,
        isBreaking: withinWindow ? cls.isBreaking : false,
        isInGameInjury: withinWindow ? cls.isInGameInjury : false,
        isPostGameInjuryUpdate: Boolean(cls.isPostGameInjuryUpdate),
        breakingPriority: withinWindow ? cls.breakingPriority : 0,
        breakingBadge: withinWindow ? cls.breakingBadge : null
      };
    })
    .sort((a, b) => {
      const prioDiff = (b.breakingPriority || 0) - (a.breakingPriority || 0);
      if (prioDiff !== 0) return prioDiff;
      const aMs = new Date(a.publishedAt || 0).getTime() || 0;
      const bMs = new Date(b.publishedAt || 0).getTime() || 0;

      const windowMs = (a.breakingPriority || 0) > 0 ? 20 * 60_000 : 8 * 60_000;
      if (Math.abs(bMs - aMs) <= windowMs) {
        if (a.isFirstMoverInjuryScoop && !b.isFirstMoverInjuryScoop && (a.corroborationCount || 1) === 1) {
          return -1;
        }
        if (b.isFirstMoverInjuryScoop && !a.isFirstMoverInjuryScoop && (b.corroborationCount || 1) === 1) {
          return 1;
        }
        const tierDiff = (a.trustTier || 2) - (b.trustTier || 2);
        if (tierDiff !== 0) return tierDiff;
        const sigDiff = (Number(b.signalScore) || 0) - (Number(a.signalScore) || 0);
        if (Math.abs(sigDiff) >= 8) return sigDiff;
      }
      return bMs - aMs;
    });
}

function resolveInjuryMilestoneBucket(text = '') {
  const t = String(text || '').toLowerCase();
  if (/\b(placed on injured reserve|placed on ir|season-ending|activated from ir|activated off ir|21-day)\b/.test(t)) {
    return 'ir_roster_move';
  }
  if (/\b(mri|x-ray|x-rays|ct scan|tests showed|initial tests|imaging)\b/.test(t)) {
    return 'diagnostic_imaging';
  }
  if (/\b(day-to-day|week-to-week|out multiple weeks|out several weeks|miss \d+|expected to miss)\b/.test(t)) {
    return 'recovery_timeline';
  }
  if (
    /\b(questionable to return|doubtful to return|ruled out for the rest|will not return|did not return|exited|left .*game|locker room|medical tent|carted off|suffered a|sustained a)\b/.test(
      t
    )
  ) {
    return 'in_game_injury_status';
  }
  if (PRE_GAME_AVAILABILITY_NOISE_REGEX.test(t)) {
    return 'pre_game_availability';
  }
  return null;
}

/**
 * Groups repetitive injury reports on the same player & same milestone under the richest/latest card
 * (`lead.confirmingReports`) while letting genuinely new milestones (e.g. MRI results vs initial exit)
 * remain distinct top-level cards.
 */
export function deduplicateAndGroupWireItems(items = []) {
  if (!Array.isArray(items) || items.length <= 1) return items;

  const grouped = [];
  const leadByClusterKey = new Map();

  for (const item of items) {
    if (item?.type === 'video') {
      grouped.push(item);
      continue;
    }

    const text = `${item?.fullText || ''} ${item?.title || ''} ${item?.summary || ''}`.trim();
    const milestone = resolveInjuryMilestoneBucket(text);
    const primaryPlayer = item?.mentionedPlayers?.[0];
    const playerKey = primaryPlayer?.id
      ? String(primaryPlayer.id)
      : primaryPlayer?.name
        ? primaryPlayer.name.toLowerCase().replace(/[^a-z0-9]/g, '')
        : '';

    if (!milestone || !playerKey) {
      grouped.push(item);
      continue;
    }

    const clusterKey = `${playerKey}::${milestone}`;
    const existing = leadByClusterKey.get(clusterKey);
    const itemMs = Date.parse(item?.publishedAt || '') || 0;

    if (!existing) {
      const cloned = { ...item, confirmingReports: [] };
      leadByClusterKey.set(clusterKey, cloned);
      grouped.push(cloned);
      continue;
    }

    const existingMs = Date.parse(existing.publishedAt || '') || 0;
    // Only collapse reports within 36 hours of each other
    if (Math.abs(existingMs - itemMs) > 36 * 3600_000) {
      grouped.push(item);
      continue;
    }

    // Prefer keeping the richer / newer lead card on top and tucking the duplicate into confirmingReports
    const existingBodyLen = String(existing.fullText || existing.title || '').length;
    const candidateBodyLen = String(item.fullText || item.title || '').length;
    const candidateIsBetterLead =
      candidateBodyLen > existingBodyLen + 35 ||
      (itemMs > existingMs + 20 * 60_000 && candidateBodyLen >= existingBodyLen * 0.75);

    if (candidateIsBetterLead) {
      const demotedPrev = { ...existing };
      delete demotedPrev.confirmingReports;
      const priorConfirming = existing.confirmingReports || [];
      Object.assign(existing, {
        ...item,
        confirmingReports: [demotedPrev, ...priorConfirming]
      });
    } else {
      existing.confirmingReports.push(item);
    }
  }

  return grouped;
}

/**
 * Strips redundant inline wire attribution like ", Mike Garafolo of NFL Network reports."
 * when `authorName` ("Mike Garafolo") is already rendered once in the card header.
 */
export function stripRedundantAuthorBoilerplate(rawText = '', authorName = '') {
  let cleaned = String(rawText || '').trim();
  const cleanAuthor = String(authorName || '')
    .split('•')[0]
    .trim();
  if (!cleaned || !cleanAuthor || cleanAuthor.length < 4) return cleaned;

  const escapedFull = cleanAuthor.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // Remove ", Mike Garafolo of NFL Network reports." or ", per Mike Garafolo of NFL Network."
  const midClauseRegex = new RegExp(
    `,\\s*(?:per\\s+)?${escapedFull}(?:\\s+of\\s+[A-Za-z0-9 .&'-]{2,32})?\\s+(?:reports|reported|notes|writes)(?=\\.|,|;|$)`,
    'gi'
  );
  cleaned = cleaned.replace(midClauseRegex, '');

  // Remove leading "Per Mike Garafolo, " or "Mike Garafolo reports: "
  const leadClauseRegex = new RegExp(
    `^(?:per\\s+${escapedFull}(?:\\s+of\\s+[A-Za-z0-9 .&'-]{2,28})?,\\s*|${escapedFull}\\s+reports:\\s*)`,
    'i'
  );
  cleaned = cleaned.replace(leadClauseRegex, '');
  if (cleaned.length > 1) {
    cleaned = cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
  }
  return cleaned.replace(/\s+/g, ' ').trim();
}

/**
 * Returns true if `externalUrl` is just a bare social profile URL (e.g. https://x.com/MikeGarafolo)
 * or identical to `itemUrl`, preventing redundant "Linked Story: ... on X" self-link pills.
 */
export function isRedundantProfileSelfLink(externalUrl = '', itemUrl = '') {
  const ext = String(externalUrl || '').trim();
  if (!ext) return true;
  if (itemUrl && ext.toLowerCase() === String(itemUrl).trim().toLowerCase()) return true;
  if (/^https?:\/\/(?:www\.)?(?:x|twitter)\.com\/[A-Za-z0-9_]+\/?(?:\?.*)?$/i.test(ext)) {
    return true;
  }
  if (/^https?:\/\/bsky\.app\/profile\/[^/]+\/?$/i.test(ext)) {
    return true;
  }
  return false;
}

/**
 * Formats a tweet's body so short tweets (<= 320 chars) preserve 100% of their full text
 * without mid-sentence truncation, while very long posts trim cleanly at a word boundary.
 */
export function formatTweetBodyForDisplay(rawText = '', limit = SHORT_TWEET_FULL_TEXT_LIMIT) {
  const cleaned = String(rawText || '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!cleaned) {
    return { text: '', isFullTweet: true, originalLength: 0 };
  }
  if (cleaned.length <= limit) {
    return { text: cleaned, isFullTweet: true, originalLength: cleaned.length };
  }
  const sliced = cleaned.slice(0, limit - 1);
  const lastSpace = sliced.lastIndexOf(' ');
  const neat = (lastSpace > limit * 0.7 ? sliced.slice(0, lastSpace) : sliced).trim();
  return { text: `${neat}…`, isFullTweet: false, originalLength: cleaned.length };
}

/**
 * Determines whether a 49ers game is currently live or inside the immediate game-day
 * injury/inactives/post-game window (95m before kickoff through 4.5h after kickoff),
 * triggering ultra-low (<20s) tweet & game-day inactives polling latency.
 */
export function is49ersGameLiveWindow(appData = {}, now = new Date()) {
  const nowMs = now instanceof Date ? now.getTime() : Number(now);
  const schedule = appData?.scheduleMatchup?.schedule || [];
  const upcoming = appData?.scheduleMatchup?.upcomingMatchup || {};

  if (upcoming.liveState === 'in' || upcoming.isGameInProgress) {
    return true;
  }

  for (const g of schedule) {
    const statusLower = String(g.statusDetail || '').toLowerCase();
    if (/\b(q1|q2|q3|q4|1st|2nd|3rd|4th|halftime|in progress|ot|overtime)\b/.test(statusLower) && !g.completed) {
      return true;
    }
    const koMs = g.dateIso ? new Date(g.dateIso).getTime() : NaN;
    if (Number.isFinite(koMs)) {
      // 95 minutes pre-kickoff (covers 90-min official inactives + slight delays) through 4.5 hours post-kickoff
      if (nowMs >= koMs - 95 * 60_000 && nowMs <= koMs + 4.5 * 3600_000) {
        return true;
      }
    }
  }

  const upKoMs = (upcoming.dateIso || upcoming.kickoffIso) ? new Date(upcoming.dateIso || upcoming.kickoffIso).getTime() : NaN;
  if (Number.isFinite(upKoMs) && nowMs >= upKoMs - 95 * 60_000 && nowMs <= upKoMs + 4.5 * 3600_000) {
    return true;
  }

  return false;
}
