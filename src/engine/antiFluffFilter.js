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
  /\b(destroys|obliterates|eviscerates|humiliates|claps back|rips into)\b/i,
  /\bfans are (furious|livid|losing their minds|melting down)\b/i,
  /\bsocial media (erupts|goes wild|is losing it)\b/i,
  /\bunfollowed.*instagram\b/i,
  /\bcryptic\s+(post|tweet|message|emoji)\b/i,
  /\bblockbuster\s+mock\s+trade\s+sends\b/i,
  /\b(?:wild|insane|massive|crazy)\s+(?:mock\s+)?trade\s+(?:proposal|idea|pitch|scenario)\b/i,
  /\bmock\s+trade\s+(?:proposal|idea|pitch)\b/i,
  /\burges?\s+(?:the\s+)?(?:49ers|niners|shanahan|lynch)\s+to\s+(?:bench|trade|cut|move on from)\b/i,
  /\b(?:twitter|x|nfl\s+world)\s+reacts\s+to\b/i,
  /\bpanic\s+button\b/i,
  /\bis\s+it\s+time\s+to\s+(fire|bench)\b/i,
  /\bhot\s+seat\b/i,
  /!{2,}|\?{2,}/
];

const ANALYTICAL_SIGNAL_PATTERNS = [
  /\b(epa|cpoe|dvoa|success rate|pressure rate|win rate|pbwr|rswr|ryoe|yac|yprr|target share|wopr|adot|dadot|ras|separation|explosive play rate)\b/i,
  /\b(11 personnel|12 personnel|21 personnel|22 personnel|wide-9|nickel|dime|quarters|cover [12346]|two-high|single-high|sim pressure|stunt|duo|outside zone|play-action|motion rate|box count|neutral script|early-down|red-zone)\b/i,
  /\b(cap hit|dead money|dead cap|restructure|void year|post-june 1|pre-june 1|prorat|option bonus|base salary|sixth-round|comp pick|article 13|top-51|fifth-year option|franchise tag|practice squad elevation)\b/i,
  /\b(dnp|limited participation|full participation|injured reserve|practice window|21-day|questionable|doubtful|concussion protocol|syndesmosis)\b/i,
  /\b(all-22|film|tape|snap count|snaps|pass block|run block)\b/i
];

const PRIMARY_BEAT_REPORTER_IDS = new Set([
  'matt_maiocco',
  'matt_barrows',
  'nick_wagoner',
  'david_lombardi',
  'eric_branch',
  'vic_tafur',
  'adam_schefter',
  'ian_rapoport',
  'tom_pelissero',
  'field_yates',
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
      fluffScore += 28;
      matchedFlags.push(m[0]);
    }
  }

  // Penalize excessive ALL-CAPS shouting words (5+ uppercase letters, excluding NFL/analytics/outlet acronyms)
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
    'PFF'
  ]);
  const shoutWords = (title.match(/\b[A-Z]{5,}\b/g) || []).filter(w => !allowedAcronyms.has(w));
  if (shoutWords.length >= 1) {
    fluffScore += shoutWords.length * 18;
    matchedFlags.push(`ALL-CAPS: ${shoutWords.join(', ')}`);
  }

  let signalScore = 35; // neutral beat report baseline
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

  fluffScore = Math.min(100, fluffScore);
  signalScore = Math.min(100, signalScore);

  return {
    fluffScore,
    signalScore,
    isClickbait: fluffScore >= 45 && signalScore < 55,
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
    .replace(/\s*(Subscribe|Click here|Follow us on|Download the app).*$/i, '')
    .replace(/!{2,}/g, '.')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Filters news items and clustered briefs according to user preferences:
 * - disabledReporterIds: Set/Array of reporter IDs muted by user
 * - disabledOutlets: Set/Array of outlet IDs muted by user
 * - muteHotTakePersonalities: boolean
 * - strictAnalyticsFilmOnly: boolean
 */
export function filterNewsByUserPrefs(items = [], reportersById = new Map(), userPrefs = {}) {
  const disabledReporters = new Set(userPrefs.disabledReporterIds || []);
  const disabledOutlets = new Set(userPrefs.disabledOutlets || []);
  const muteHotTakes = Boolean(userPrefs.muteHotTakePersonalities);
  const strictAnalytics = Boolean(userPrefs.strictAnalyticsFilmOnly);

  return items.filter(item => {
    // Check outlet filter
    if (item.outletId && disabledOutlets.has(item.outletId)) {
      return false;
    }

    // For clustered briefs with multiple cited reporters, keep brief as long as AT LEAST ONE cited reporter is enabled
    if (Array.isArray(item.citedReporterIds) && item.citedReporterIds.length > 0) {
      const activeCitations = item.citedReporterIds.filter(rid => {
        if (disabledReporters.has(rid)) return false;
        const rep = reportersById.get(rid);
        if (muteHotTakes && rep?.styleTag === 'opinion-hot-take') return false;
        return true;
      });
      if (activeCitations.length === 0) return false;
    } else if (item.reporterId) {
      if (disabledReporters.has(item.reporterId)) return false;
      const rep = reportersById.get(item.reporterId);
      if (muteHotTakes && rep?.styleTag === 'opinion-hot-take') return false;
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

    // Always drop items flagged as clickbait
    if (item.isClickbait) return false;

    return true;
  });
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
  const trustTier = Number(item.trustTier) || repObj?.trustTier || dirEntry?.trustTier || (PRIMARY_BEAT_REPORTER_IDS.has(repId) ? 1 : 2);
  const isAcuteInjuryScoop =
    Boolean(item.isInGameInjury || item.isFirstMoverInjuryScoop) ||
    isAcuteInjuryOrAvailabilityScoop(`${title} ${body}`);

  if ((repObj?.styleTag === 'opinion-hot-take' || trustTier === 3) && !isAcuteInjuryScoop) {
    salience -= 12;
  } else if (trustTier === 1 || repObj?.styleTag === 'analytics-film' || repObj?.tier === 1 || PRIMARY_BEAT_REPORTER_IDS.has(repId)) {
    salience += 11;
  } else if (trustTier === 2) {
    salience += 4;
  }

  const corroboration =
    Number(item.synthesizedFromCount) ||
    Number(item.corroborationCount) ||
    (Array.isArray(item.corroboratedBy) ? item.corroboratedBy.length + 1 : 0) ||
    (Array.isArray(item.citedReporterIds) ? item.citedReporterIds.length : 0) ||
    (Array.isArray(item.mentionedPlayers) && item.mentionedPlayers.length > 0 ? 2 : 1);
  salience += Math.min(14, Math.max(0, corroboration - 1) * 3);

  if (item.isInGameInjury) salience += 24;
  else if (item.isFirstMoverInjuryScoop) salience += 18;
  else if (item.isBreaking) salience += 14;

  const pubMs = item.publishedAt ? new Date(item.publishedAt).getTime() : NaN;
  if (Number.isFinite(pubMs) && halfLifeHours > 0) {
    const ageHours = Math.max(0, (nowMs - pubMs) / 3_600_000);
    const decayFactor = Math.pow(0.5, ageHours / halfLifeHours);
    salience = salience * (0.68 + 0.32 * decayFactor);
  }

  return Math.max(0, Math.min(100, Math.round(salience * 10) / 10));
}
