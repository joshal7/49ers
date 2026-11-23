/**
 * Anti-Fluff / Sensationalism Classifier & Per-User Reporter/Source Filter
 * Enforces the 49ers Faithful Editorial Charter: facts, X's & O's, and cap math — zero rage-bait.
 */

import {
  isAcuteInjuryOrAvailabilityScoop,
  resolveReporterFromNameOrHandle
} from './beatAttributionEngine.js';

const CLICKBAIT_PATTERNS = [
  /\byou won'?t believe\b/i,
  /\bshock(s|ed|ing)?\s+the\s+(nfl|world|internet)\b/i,
  /\bfans are (furious|livid|losing their minds|melting down)\b/i,
  /\bsocial media (erupts|goes wild|is losing it)\b/i,
  /\bunfollowed.*instagram\b/i,
  /\bcryptic\s+(post|tweet|message|emoji)\b/i,
  /\bblockbuster\s+mock\s+trade\b/i,
  /\b(?:wild|insane|massive|crazy|blockbuster)(?:\s+(?:blockbuster|mock))?\s+trade\s+(?:proposal|idea|pitch|scenario)\b/i,
  /\bmock\s+trade\s+(?:proposal|idea|pitch)\b/i,
  /\bhypothetical\s+trade\s+(?:proposal|idea|pitch|scenario)\b/i,
  /\burges?\s+(?:the\s+)?(?:[a-z0-9]{3,16}|head coach|front office)\s+to\s+(?:bench|trade|cut|move on from)\b/i,
  /\b(?:super\s+bowl\s+lock|unstoppable\s+juggernaut|guaranteed\s+(?:win|blowout|victory))\b/i,
  /\bnobody\s+can\s+(?:beat|stop)\s+the\s+[a-z0-9]{3,16}\b/i
];

const ANALYTICAL_SIGNAL_PATTERNS = [
  /\b(epa|cpoe|dvoa|success rate|pressure rate|win rate|pbwr|rswr|ryoe|yac|yprr|target share|wopr|adot|dadot|ras|separation|explosive play rate)\b/i,
  /\b(11 personnel|12 personnel|21 personnel|22 personnel|wide-9|nickel|dime|quarters|cover [12346]|two-high|single-high|sim pressure|stunt|duo|outside zone|play-action|motion rate|box count|neutral script|early-down|red-zone)\b/i,
  /\b(cap hit|dead money|dead cap|restructure|void year|post-june 1|pre-june 1|prorat|option bonus|base salary|sixth-round|comp pick|article 13|top-51|fifth-year option|franchise tag|practice squad elevation)\b/i,
  /\b(dnp|limited participation|full participation|injured reserve|practice window|21-day|questionable|doubtful|concussion protocol|syndesmosis)\b/i,
  /\b(all-22|film|tape|snap count|snaps|pass block|run block)\b/i,
  /\b(trade talks|trade discussions|in talks to acquire|fielding calls|exploring a trade|agreed to terms|contract extension|arrested|charged with|suspended|commissioner'?s exempt|under investigation)\b/i,
  /\b(1-on-1|one-on-one|sit-down|exclusive interview|locker room|opened up about|spoke candidly|mic'?d up|players'? tribune|candid interview)\b/i,
  /\b(warmups?|kickoff|crowd|raucous|big screen|boos|touchdown|\btd\b|highlight|big catch|strip-sack|interception|milestone|career-high|teammates?|rivalry|notebook|takeaways|mailbag|column|podcast|knbr|storyline)\b/i
];

const NATIONAL_PRIMARY_INSIDER_IDS = new Set([
  'adam_schefter',
  'ian_rapoport',
  'tom_pelissero',
  'field_yates'
]);

const SF_PRIMARY_BEAT_REPORTER_IDS = new Set([
  'matt_maiocco',
  'matt_barrows',
  'nick_wagoner',
  'david_lombardi',
  'eric_branch',
  'vic_tafur',
  'kyle_shanahan'
]);

/**
 * Scores a headline + body text for sensationalism vs. football signal.
 * Returns { fluffScore (0..100), signalScore (0..100), isClickbait, matchedFlags }
 */
export function scoreContentSignal(title = '', body = '') {
  const combined = `${title} ${body}`.trim();
  if (!combined) {
    return { fluffScore: 0, signalScore: 0, isClickbait: false, matchedFlags: [] };
  }

  let fluffScore = 0;
  const matchedFlags = [];
  for (const rx of CLICKBAIT_PATTERNS) {
    const m = combined.match(rx);
    if (m) {
      fluffScore += 32;
      matchedFlags.push(m[0]);
    }
  }

  // Penalize excessive ALL-CAPS shouting words (5+ uppercase letters, excluding NFL/analytics/sports excitement words)
  const allowedAcronyms = new Set([
    'NFL',
    'NFC',
    'AFC',
    'ESPN',
    'CBS',
    'NBC',
    'NFLPA',
    'NBCSBA',
    'DVOA',
    'CPOE',
    'RYOE',
    'WOPR',
    'YPRR',
    'PBWR',
    'RSWR',
    'ADOT',
    'OTAs',
    'UDFA',
    'EDGE',
    'PFF',
    'KNBR',
    'TOUCHDOWN',
    'FINAL',
    'SCORE',
    'NINERS',
    'KITTLE',
    'PURDY',
    'WARNER',
    'BOSA',
    'WATCH',
    'FIRST',
    'INTERCEPTION',
    'FUMBLE',
    'PLAYOFFS',
    'SUPER',
    'GAMEDAY',
    'KICKOFF',
    'HALFTIME',
    'OVERTIME',
    'VICTORY',
    'TRADE',
    'SIGNED',
    'ACTIVE',
    'INACTIVE',
    'UPDATE',
    'REPORT',
    'ALERT',
    'CLUTCH',
    'BREAKING'
  ]);
  const shoutWords = (title.match(/\b[A-Z]{5,}\b/g) || []).filter(w => !allowedAcronyms.has(w));
  if (shoutWords.length >= 2) {
    fluffScore += Math.min(25, shoutWords.length * 10);
    matchedFlags.push(`ALL-CAPS: ${shoutWords.join(', ')}`);
  }

  let signalScore = 40; // neutral beat & interest-story baseline
  for (const rx of ANALYTICAL_SIGNAL_PATTERNS) {
    const matches = combined.match(new RegExp(rx.source, 'gi'));
    if (matches) {
      signalScore += Math.min(25, matches.length * 10);
    }
  }
  // Numbers, percentages, dollar cap figures, and play timestamps increase factual density
  const numericFacts = combined.match(/(\$\d+(\.\d+)?[MK]?|\d+(\.\d+)?%|\b\d+-\d+\b|\b\d{1,2}:\d{2}\b)/g);
  if (numericFacts) {
    signalScore += Math.min(25, numericFacts.length * 5);
  }

  // Direct substantive player/coach quotes add genuine human & locker-room signal
  if (/[“"][^”"]{28,}[”"]/.test(combined)) {
    signalScore += 12;
  }

  fluffScore = Math.min(100, fluffScore);
  signalScore = Math.min(100, signalScore);

  return {
    fluffScore,
    signalScore,
    isClickbait: (fluffScore >= 60 && signalScore < 55) || (fluffScore >= 85 && signalScore < 65),
    matchedFlags
  };
}

/**
 * Cleans sensationalist framing or promo boilerplate from raw RSS/article blurbs.
 */
export function cleanSensationalistText(rawText = '') {
  return String(rawText || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/\b(SHOCKING|BREAKING|UNBELIEVABLE|BOMBSHELL):\s*/gi, '')
    .replace(/\s*(Subscribe|Click here|Follow us on|Download the app|Visit RotoWire\.com).*$/i, '')
    .replace(/!{2,}/g, '.')
    .replace(/\s+/g, ' ')
    .trim();
}

const PODIUM_FALLBACK_IDS = new Set(['kyle_shanahan', 'john_lynch']);

function resolveReporterMetaForPrefs(rid, item, reportersById) {
  if (rid && reportersById instanceof Map) {
    const mapped = reportersById.get(rid);
    if (mapped) return mapped;
  }
  if (rid) {
    const byId = resolveReporterFromNameOrHandle(rid);
    if (byId) return byId;
  }
  if (item) {
    const inferred = resolveReporterFromNameOrHandle(
      item.author || item.reporterName || item.authorHandle || ''
    );
    if (inferred && !PODIUM_FALLBACK_IDS.has(inferred.id)) return inferred;
  }
  return null;
}

function isHotTakeReporterMeta(rep) {
  return Boolean(rep && (rep.styleTag === 'opinion-hot-take' || rep.isHotTake));
}

/**
 * Single source of truth for per-user source, reporter, hot-take, strict-analytics, and clickbait
 * filtering shared across `News & Film`, `Home`, and Player Card (`Overview` & `Health`).
 */
export function isItemAllowedByUserPrefs(
  item = null,
  reportersById = null,
  userPrefs = null,
  precomputedSets = null
) {
  if (!item || typeof item !== 'object') return false;
  if (item.isClickbait) return false;
  if (!userPrefs || typeof userPrefs !== 'object') return true;

  const disabledReporters =
    precomputedSets?.disabledReporters || new Set(userPrefs.disabledReporterIds || []);
  const disabledOutlets =
    precomputedSets?.disabledOutlets || new Set(userPrefs.disabledOutlets || []);
  const muteHotTakes = Boolean(userPrefs.muteHotTakePersonalities);
  const strictAnalytics = Boolean(userPrefs.strictAnalyticsFilmOnly);

  const hasPrefsToCheck =
    disabledReporters.size > 0 || disabledOutlets.size > 0 || muteHotTakes || strictAnalytics;
  if (!hasPrefsToCheck) return true;

  const inferredRep =
    !item.reporterId || !item.outletId
      ? resolveReporterMetaForPrefs(item.reporterId || null, item, reportersById)
      : null;
  const resolvedOutletId = item.outletId || inferredRep?.outletId || null;

  // Check outlet filter
  if (resolvedOutletId && disabledOutlets.has(resolvedOutletId)) {
    return false;
  }

  // For clustered briefs with multiple cited reporters, keep brief as long as AT LEAST ONE cited reporter is enabled
  if (Array.isArray(item.citedReporterIds) && item.citedReporterIds.length > 0) {
    const activeCitations = item.citedReporterIds.filter(rid => {
      if (disabledReporters.has(rid)) return false;
      const rep = resolveReporterMetaForPrefs(rid, null, reportersById);
      if (muteHotTakes && isHotTakeReporterMeta(rep)) return false;
      return true;
    });
    if (activeCitations.length === 0) return false;
  } else {
    const resolvedRepId = item.reporterId || inferredRep?.id || null;
    if (resolvedRepId) {
      if (disabledReporters.has(resolvedRepId)) return false;
      const rep = resolveReporterMetaForPrefs(resolvedRepId, item, reportersById);
      if (muteHotTakes && isHotTakeReporterMeta(rep)) return false;
    }
  }

  if (strictAnalytics) {
    const cat = String(item.category || '').toLowerCase();
    const highSignal =
      cat === 'film' ||
      cat === 'cap' ||
      cat === 'analytics' ||
      cat === 'injury' ||
      cat === 'scheme' ||
      cat === 'roster' ||
      Number(item.signalScore || 65) >= 60;
    if (!highSignal) return false;
  }

  return true;
}

/**
 * Filters news items and clustered briefs according to user preferences:
 * - disabledReporterIds: Set/Array of reporter IDs muted by user
 * - disabledOutlets: Set/Array of outlet IDs muted by user
 * - muteHotTakePersonalities: boolean
 * - strictAnalyticsFilmOnly: boolean
 */
export function filterNewsByUserPrefs(items = [], reportersById = new Map(), userPrefs = {}) {
  const precomputedSets = {
    disabledReporters: new Set(userPrefs?.disabledReporterIds || []),
    disabledOutlets: new Set(userPrefs?.disabledOutlets || [])
  };
  return items.filter(item =>
    isItemAllowedByUserPrefs(item, reportersById, userPrefs, precomputedSets)
  );
}

/**
 * Computes a calibrated 0-100 salience score for ranking news items, beat posts, and synthesis sources.
 * Weighs analytical signal vs. fluff, primary beat/insider authority, multi-source corroboration,
 * breaking/injury urgency, and smooth exponential recency decay.
 */
export function computeNewsSalienceScore(
  item = {},
  { nowMs = Date.now(), reportersById = null, halfLifeHours = 18 } = {}
) {
  const title = item.headline || item.title || '';
  const body = item.fullText || item.summary || item.text || '';
  const scored =
    typeof item.signalScore === 'number' && typeof item.fluffScore === 'number'
      ? { signalScore: item.signalScore, fluffScore: item.fluffScore, isClickbait: Boolean(item.isClickbait) }
      : scoreContentSignal(title, body);

  if (scored.isClickbait || item.isClickbait) return 0;

  let salience = scored.signalScore - scored.fluffScore * 0.55;

  const repId = item.reporterId || item.citedReporterIds?.[0] || '';
  const repObj = reportersById instanceof Map && repId ? reportersById.get(repId) : null;
  const dirEntry = resolveReporterFromNameOrHandle(repId || item.author || item.reporterName || item.authorHandle);
  const isOtherTeamBeat = Boolean(dirEntry?.isOtherTeamBeat);
  const isPrimaryBeat =
    !isOtherTeamBeat &&
    (NATIONAL_PRIMARY_INSIDER_IDS.has(repId) ||
      Number(repObj?.trustTier) === 1 ||
      Number(dirEntry?.trustTier) === 1 ||
      (!dirEntry?.teamAbbr && SF_PRIMARY_BEAT_REPORTER_IDS.has(repId)) ||
      (dirEntry && !dirEntry.isOtherTeamBeat && SF_PRIMARY_BEAT_REPORTER_IDS.has(repId)));
  const trustTier = isOtherTeamBeat
    ? 3
    : Number(item.trustTier) || repObj?.trustTier || dirEntry?.trustTier || (isPrimaryBeat ? 1 : 2);
  const isAcuteInjuryScoop =
    Boolean(item.isInGameInjury || item.isFirstMoverInjuryScoop) ||
    isAcuteInjuryOrAvailabilityScoop(`${title} ${body}`);

  if (isOtherTeamBeat && !isAcuteInjuryScoop) {
    salience -= 4;
  } else if (trustTier === 1 || repObj?.styleTag === 'analytics-film' || repObj?.tier === 1 || isPrimaryBeat) {
    salience += 6;
  } else if (trustTier === 2) {
    salience += 5;
  } else if (trustTier === 3) {
    salience += 1;
  }

  if (/\b(heavy on [a-z0-9]+|heavy\.com|clutchpoints|athlon|yardbarker)\b/i.test(`${item.outletName || ''} ${item.url || ''}`)) {
    salience -= 10;
  }
  if (item.storyTier === 'side_note') {
    salience -= 8;
  }

  const corroboration =
    Number(item.synthesizedFromCount) ||
    Number(item.clusterSize) ||
    (Array.isArray(item.confirmingReports) && item.confirmingReports.length > 0 ? item.confirmingReports.length + 1 : 0) ||
    Number(item.corroborationCount) ||
    (Array.isArray(item.corroboratedBy) ? item.corroboratedBy.length + 1 : 0) ||
    (Array.isArray(item.citedReporterIds) ? item.citedReporterIds.length : 0) ||
    (Array.isArray(item.mentionedPlayers) && item.mentionedPlayers.length > 0 ? 2 : 1);
  salience += Math.min(16, Math.max(0, corroboration - 1) * 3.2);

  if (item.isInGameInjury) salience += 24;
  else if (item.breakingBadge === 'BREAKING') salience += 22;
  else if (item.isFirstMoverInjuryScoop || item.breakingBadge === 'TRADE INTEL') salience += 18;
  else if (item.breakingBadge === 'ROSTER MOVE') salience += 14;
  else if (item.breakingBadge === 'FILM & TRENCH' || item.category === 'film') salience += 11;
  else if (item.isBreaking) salience += 14;
  else if (/\b(1-on-1|one-on-one|sit-down|exclusive interview|locker room|opened up about|mic'?d up)\b/i.test(`${title} ${body}`)) {
    salience += 10;
  }

  const rawPubMs = item.publishedAt ? new Date(item.publishedAt).getTime() : NaN;
  const pubMs = Number.isFinite(rawPubMs) ? Math.min(nowMs, rawPubMs) : NaN;
  if (Number.isFinite(pubMs) && halfLifeHours > 0) {
    const ageHours = Math.max(0, (nowMs - pubMs) / 3_600_000);
    const decayFactor = Math.pow(0.5, ageHours / halfLifeHours);
    salience = salience * (0.58 + 0.42 * decayFactor);
  }

  return Math.max(0, Math.min(100, Math.round(salience * 10) / 10));
}
