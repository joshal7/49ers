/**
 * Player-Specific NFL Injury Play-Likelihood (%) & IR Return Window Engine
 *
 * Incorporates:
 * 1. Official NFL game designations (Out / IR / Doubtful / Questionable / Unspecified)
 * 2. Wed -> Thu -> Fri practice participation trajectories (including mid-week downgrade detection)
 * 3. Player-specific historical priors (49ers + League/Opponent Starters + Experience/Snap-Share priors):
 *    - Habitual Veteran Rest profiles (e.g., Trent Williams, DeForest Buckner, Christian McCaffrey, Kolton Miller)
 *    - Career "Plays Through Questionable" toughness conversion rate (Fred Warner, Maxx Crosby, George Kittle, etc.)
 *    - Chronic soft-tissue / body-part recurrence history
 * 4. Injury-type sports medicine ramp-up priors (high-ankle vs low-ankle, hamstring/calf vs finger/rib)
 * 5. Beat-report podium & side-field observation signals
 * 6. NFL CBA 4-Game IR Minimum Calculator (explicitly excluding Bye Weeks from the 4-game count!)
 */

import {
  AMBIGUOUS_PLAYER_SURNAMES,
  decodeHtmlEntities,
  stripHtmlAndDecodeEntities,
  isPaywalledPublisher,
  sanitizeExternalUrl,
  buildEspnPlayerNewsAnchorUrl
} from './linkIntegrity.js';
import { getActiveTeamConfig, resolveTeamConfig } from '../config/teamRegistry.js';
import {
  extractBeatAttributionFromText,
  isBlueskyPostUrl,
  isDirectSocialPostUrl,
  isDirectXStatusUrl,
  resolveItemAuthorProfileUrl,
  resolveOriginalTweetUrl,
  resolveReporterFromNameOrHandle
} from './beatAttributionEngine.js';
import {
  classifyBreakingItem,
  computeWireStoryRank,
  enforceSingleBreakingInjuryPerPlayer,
  isStaleCompletedGameAvailabilityItem,
  isUrgentBreakingBadge,
  resolveGameNewsContext
} from './breakingClassifier.js';
import { isItemAllowedByUserPrefs } from './antiFluffFilter.js';
import {
  compareLatestNewsItems,
  computeTopSignalScore,
  normalizeNewsSortMode
} from './digestExperienceEngine.js';

export const CURATED_49ERS_PLAYER_PRIORS = {
  'Trent Williams': {
    isVeteranRestHabitual: true,
    usualRestDays: ['Wed', 'Thu'],
    questionablePlayRate: 0.86,
    acuteAnklePlayRate: 0.56,
    chronicParts: ['ankle'],
    archetypeNote: 'Habitual Wed/Thu veteran rest; suits up at ~98% when NIR-Rest, but historically cautious with acute high/low ankle sprains.'
  },
  'George Kittle': {
    isVeteranRestHabitual: true,
    usualRestDays: ['Wed'],
    questionablePlayRate: 0.89,
    chronicParts: ['ribs', 'hamstring', 'groin'],
    archetypeNote: 'Elite "plays through Questionable" toughness prior (89% career active rate when tagged Questionable/LP).'
  },
  'Fred Warner': {
    isVeteranRestHabitual: false,
    questionablePlayRate: 0.96,
    chronicParts: [],
    archetypeNote: 'Ironman prior — has played through fractured ankle/foot tags; missed almost zero games due to Questionable tags.'
  },
  'Nick Bosa': {
    isVeteranRestHabitual: true,
    usualRestDays: ['Wed'],
    questionablePlayRate: 0.85,
    chronicParts: ['hip', 'oblique', 'groin'],
    archetypeNote: 'Regularly takes lighter Wednesday load; high active conversion once cleared for Thursday/Friday pass-rush reps.'
  },
  'Christian McCaffrey': {
    isVeteranRestHabitual: true,
    usualRestDays: ['Wed'],
    questionablePlayRate: 0.82,
    chronicParts: ['calf', 'achilles', 'oblique'],
    archetypeNote: 'Scheduled Wednesday maintenance workload; high vigilance on calf/Achilles tightness.'
  },
  'DeForest Buckner': {
    isVeteranRestHabitual: true,
    usualRestDays: ['Wed'],
    questionablePlayRate: 0.91,
    chronicParts: ['back', 'ankle'],
    archetypeNote: 'Veteran interior ironman; routinely logs Wednesday veteran rest and plays heavy snap shares on Sunday.'
  },
  'Brock Purdy': {
    isVeteranRestHabitual: false,
    questionablePlayRate: 0.88,
    chronicParts: ['shoulder', 'elbow'],
    archetypeNote: 'High availability prior; rarely misses starts if throwing full velocity by Thursday.'
  },
  'Kyle Juszczyk': {
    isVeteranRestHabitual: false,
    questionablePlayRate: 0.95,
    chronicParts: [],
    archetypeNote: 'Extreme durability prior; routinely plays through hand/finger/shoulder tags.'
  },
  'Deommodore Lenoir': {
    isVeteranRestHabitual: false,
    questionablePlayRate: 0.92,
    chronicParts: [],
    archetypeNote: 'High snap durability across boundary and slot corner alignments.'
  },
  'Brandon Aiyuk': {
    isVeteranRestHabitual: false,
    questionablePlayRate: 0.72,
    chronicParts: ['knee'],
    archetypeNote: 'Multi-ligament knee recovery + roster/contract reinstatement holdout status.'
  },
  'Ricky Pearsall': {
    isVeteranRestHabitual: false,
    questionablePlayRate: 0.76,
    chronicParts: ['hamstring', 'shoulder'],
    archetypeNote: 'Speed receiver profile; requires Friday high-speed GPS clearance on soft-tissue tags.'
  },
  'Jauan Jennings': {
    isVeteranRestHabitual: false,
    questionablePlayRate: 0.81,
    chronicParts: ['hip', 'ankle'],
    archetypeNote: 'Physical blocker/slot receiver who frequently plays through mid-week Limited tags.'
  },
  'Mike Evans': {
    isVeteranRestHabitual: true,
    usualRestDays: ['Wed'],
    questionablePlayRate: 0.84,
    chronicParts: ['hamstring', 'calf', 'achilles'],
    archetypeNote: 'Veteran X-receiver toughness prior; routinely manages Wednesday reps but requires soft-tissue/Achilles sprint clearance.'
  },
  'Deebo Samuel Sr.': {
    isVeteranRestHabitual: true,
    usualRestDays: ['Wed'],
    questionablePlayRate: 0.79,
    chronicParts: ['hamstring', 'shoulder', 'calf', 'rib'],
    archetypeNote: 'High-contact YAC style; plays through upper-body pain tags (~86%) with extra caution on lower-body soft tissue.'
  },
  'Osa Odighizuwa': {
    isVeteranRestHabitual: false,
    questionablePlayRate: 0.91,
    chronicParts: [],
    archetypeNote: 'Durable interior 3-technique with high consecutive-start track record.'
  },
  'Mykel Williams': {
    isVeteranRestHabitual: false,
    questionablePlayRate: 0.83,
    chronicParts: ['ankle'],
    archetypeNote: 'Power edge defender; steady active conversion when logging Thursday/Friday individual pass-rush periods.'
  }
};

export const CURATED_OPPONENT_PLAYER_PRIORS = {
  'Maxx Crosby': {
    isVeteranRestHabitual: true,
    usualRestDays: ['Wed'],
    questionablePlayRate: 0.95,
    chronicParts: ['knee', 'ankle'],
    archetypeNote: 'Legendary NFL ironman prior (~95% active on Questionable tags); routinely plays 95%+ defensive snaps through knee/ankle maintenance.'
  },
  'Kolton Miller': {
    isVeteranRestHabitual: true,
    usualRestDays: ['Wed'],
    questionablePlayRate: 0.85,
    chronicParts: ['shoulder', 'ankle'],
    archetypeNote: 'Veteran blindside tackle; frequently utilizes Wednesday maintenance reps and converts Friday LP sessions.'
  },
  'Brock Bowers': {
    isVeteranRestHabitual: false,
    questionablePlayRate: 0.90,
    chronicParts: [],
    archetypeNote: 'High-snap focal-point tight end with high active conversion on minor mid-week tags.'
  },
  'Kirk Cousins': {
    isVeteranRestHabitual: true,
    usualRestDays: ['Wed'],
    questionablePlayRate: 0.90,
    chronicParts: ['achilles', 'rib'],
    archetypeNote: 'High career pocket durability prior; rarely misses starts outside major structural injury.'
  },
  'Christian Wilkins': {
    isVeteranRestHabitual: false,
    questionablePlayRate: 0.84,
    chronicParts: ['foot'],
    archetypeNote: 'High-motor interior defender; foot/Jones-fracture history warrants careful late-week load monitoring.'
  },
  'Tyler Linderbaum': {
    isVeteranRestHabitual: false,
    questionablePlayRate: 0.89,
    chronicParts: ['neck', 'ankle'],
    archetypeNote: 'Durable zone-scheme center with strong active conversion when practicing Friday.'
  },
  'Dak Prescott': {
    isVeteranRestHabitual: true,
    usualRestDays: ['Wed'],
    questionablePlayRate: 0.87,
    chronicParts: ['hamstring', 'ankle', 'calf'],
    archetypeNote: 'Veteran franchise QB; plays through upper-extremity soreness while lower-body soft-tissue tags carry elevated caution.'
  },
  'CeeDee Lamb': {
    isVeteranRestHabitual: true,
    usualRestDays: ['Wed'],
    questionablePlayRate: 0.90,
    chronicParts: ['shoulder', 'ankle'],
    archetypeNote: 'High-volume alpha WR with strong track record of suiting up through Questionable/LP tags.'
  },
  'Micah Parsons': {
    isVeteranRestHabitual: true,
    usualRestDays: ['Wed'],
    questionablePlayRate: 0.91,
    chronicParts: ['ankle'],
    archetypeNote: 'Explosive pass rusher who regularly manages mid-week reps and plays high-leverage third-down snaps.'
  },
  'Matthew Stafford': {
    isVeteranRestHabitual: true,
    usualRestDays: ['Wed'],
    questionablePlayRate: 0.93,
    chronicParts: ['back', 'thumb', 'rib'],
    archetypeNote: 'Elite QB pain-tolerance prior; historically plays through rib, thumb, and back Questionable tags.'
  },
  'Puka Nacua': {
    isVeteranRestHabitual: false,
    questionablePlayRate: 0.85,
    chronicParts: ['knee'],
    archetypeNote: 'Physical contested-catch WR; plays through minor knee/shoulder tags once cleared for Friday reps.'
  },
  'Devon Witherspoon': {
    isVeteranRestHabitual: false,
    questionablePlayRate: 0.88,
    chronicParts: ['hip'],
    archetypeNote: 'High-energy nickel/boundary DB with strong Questionable-to-Active conversion.'
  },
  'Jaxon Smith-Njigba': {
    isVeteranRestHabitual: false,
    questionablePlayRate: 0.88,
    chronicParts: ['wrist'],
    archetypeNote: 'Durable slot/Z separator with reliable weekly availability.'
  },
  'Trey McBride': {
    isVeteranRestHabitual: false,
    questionablePlayRate: 0.91,
    chronicParts: ['rib'],
    archetypeNote: 'Tough inline/move TE who consistently converts Limited weeks into heavy Sunday snap shares.'
  },
  'Kyler Murray': {
    isVeteranRestHabitual: false,
    questionablePlayRate: 0.83,
    chronicParts: ['knee', 'hamstring', 'ankle'],
    archetypeNote: 'Dual-threat QB; rushing workload can be scaled when managing lower-extremity tags.'
  },
  'Jared Goff': {
    isVeteranRestHabitual: false,
    questionablePlayRate: 0.94,
    chronicParts: [],
    archetypeNote: 'Pocket ironman QB with elite consecutive-start availability.'
  },
  'Amon-Ra St. Brown': {
    isVeteranRestHabitual: true,
    usualRestDays: ['Wed'],
    questionablePlayRate: 0.93,
    chronicParts: ['ankle', 'oblique'],
    archetypeNote: 'Elite slot toughness prior; frequently rests Wednesday and plays full snap count Sunday.'
  }
};

export const CURATED_NFL_PLAYER_PRIORS = {
  ...CURATED_OPPONENT_PLAYER_PRIORS,
  ...CURATED_49ERS_PLAYER_PRIORS
};

const SOFT_TISSUE_KEYWORDS = ['hamstring', 'calf', 'groin', 'quad', 'achilles', 'oblique', 'adductor', 'hip flexor'];
const HIGH_CAUTION_STRUCTURAL_KEYWORDS = [
  'high ankle',
  'high-ankle',
  'syndesmosis',
  'turf toe',
  'lisfranc',
  'mcl',
  'pcl',
  'meniscus',
  'pectoral'
];
const MINOR_PAIN_TOLERANCE_KEYWORDS = ['finger', 'thumb', 'hand', 'wrist', 'rib', 'shoulder', 'nose', 'illness'];

function escapeRegexLiteral(str = '') {
  return String(str).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Collapses dotted two-letter initials (`C.J.` / `C. J.` / `T.J.` / `A.J.`) into dotless initials (`CJ` / `TJ` / `AJ`)
 * while leaving all other words untouched so `"C.J. West"` and `"CJ West"` match identically.
 */
export function collapseInitialDots(raw = '') {
  return String(raw || '')
    .replace(/\b([A-Za-z])\.\s*([A-Za-z])\.(?=\s|$|[^A-Za-z])/g, '$1$2')
    .replace(/\b([A-Za-z])\.(?=\s+[A-Za-z]\b)/g, '$1');
}

/**
 * Detects bare status tokens (`"out"`, `"inactive"`, `"questionable"`, `"n/a"`) that ESPN `/injuries`
 * occasionally emits during early-week rollover in place of real medical/beat prose.
 */
export function isBareStatusPlaceholderComment(raw = '') {
  const s = String(raw || '').trim();
  if (!s) return true;
  if (/^(?:out|inactive|questionable|doubtful|active|healthy|injured reserve|ir|pup|n\/a|-|none)\.?$/i.test(s)) {
    return true;
  }
  return s.length < 10 && !s.includes(' ');
}

export function pickMeaningfulInjuryComment(...candidates) {
  for (const c of candidates) {
    const trimmed = String(c || '').trim();
    if (trimmed && !isBareStatusPlaceholderComment(trimmed)) return trimmed;
  }
  for (const c of candidates) {
    const trimmed = String(c || '').trim();
    if (trimmed) return trimmed;
  }
  return '';
}

function stripGenerationalSuffix(name = '') {
  return String(name || '')
    .replace(/,?\s+\b(?:jr\.?|sr\.?|ii|iii|iv|v)\b\.?$/i, '')
    .trim();
}

const AMBIGUOUS_CLAUSE_SURNAMES = AMBIGUOUS_PLAYER_SURNAMES;

const POS_GROUP_BY_TOKEN = {
  qb: 'QB',
  rb: 'RB',
  fb: 'RB',
  wr: 'WR',
  te: 'TE',
  lt: 'OL',
  lg: 'OL',
  c: 'OL',
  rg: 'OL',
  rt: 'OL',
  ot: 'OL',
  og: 'OL',
  ol: 'OL',
  t: 'OL',
  g: 'OL',
  dt: 'DL',
  de: 'DL',
  dl: 'DL',
  nt: 'DL',
  edge: 'DL',
  lb: 'LB',
  ilb: 'LB',
  olb: 'LB',
  mlb: 'LB',
  cb: 'DB',
  nb: 'DB',
  db: 'DB',
  s: 'DB',
  fs: 'DB',
  ss: 'DB',
  saf: 'DB',
  k: 'ST',
  pk: 'ST',
  p: 'ST',
  ls: 'ST'
};

function arePositionTokensCompatible(clausePosToken = '', playerPosition = '') {
  const g1 = POS_GROUP_BY_TOKEN[String(clausePosToken || '').toLowerCase().replace(/s$/, '')];
  const g2 = POS_GROUP_BY_TOKEN[String(playerPosition || '').toLowerCase()];
  if (!g1 || !g2) return true;
  if (g1 === g2) return true;
  // OLB/EDGE hybrid compatibility
  if ((g1 === 'LB' && String(playerPosition).toUpperCase() === 'DE') || (g1 === 'DL' && String(playerPosition).toUpperCase() === 'OLB')) {
    return true;
  }
  return false;
}

const NON_FIRST_NAME_STOPWORDS = new Set([
  'qb', 'qbs', 'rb', 'rbs', 'fb', 'fbs', 'wr', 'wrs', 'te', 'tes',
  'lt', 'lg', 'c', 'rg', 'rt', 'ot', 'ots', 'og', 'ogs', 'ol',
  'dt', 'dts', 'de', 'des', 'dl', 'dls', 'nt', 'nts', 'edge',
  'lb', 'lbs', 'ilb', 'olb', 'mlb', 'cb', 'cbs', 'nb', 'db', 'dbs', 's', 'fs', 'ss', 'saf', 'safs',
  'k', 'pk', 'p', 'ls',
  'coach', 'per', 'for', 'from', 'with', 'without', 'that', 'while', 'whereas', 'although', 'though',
  'and', 'or', 'but', 'neither', 'either', 'nor', 'both', 'get', 'got', 'have', 'had', 'has',
  'expecting', 'expect', 'expects', 'expected', 'said', 'says', 'veteran', 'veterans',
  'rookie', 'rookies', 'starter', 'starters', 'backup', 'fellow', 'wideout', 'wideouts',
  'receiver', 'receivers', 'corner', 'corners', 'cornerback', 'cornerbacks', 'tackle', 'tackles',
  'guard', 'guards', 'center', 'linebacker', 'linebackers', 'safety', 'safeties',
  'defender', 'defenders', 'lineman', 'linemen', 'rusher', 'back', 'backs', 'end', 'ends',
  'missing', 'limited', 'full', 'not', 'no', 'after', 'before', 'since', 'until', 'when', 'if', 'as',
  'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday',
  'today', 'yesterday', 'tomorrow', 'practice', 'status', 'update', 'report', 'niners', 'francisco'
]);

const PLAYER_CLAUSE_MATCHER_CACHE = new Map();

function getCompiledPlayerClauseMatcher(rawPlayer) {
  let cached = PLAYER_CLAUSE_MATCHER_CACHE.get(rawPlayer);
  if (cached) return cached;
  if (PLAYER_CLAUSE_MATCHER_CACHE.size >= 512) {
    PLAYER_CLAUSE_MATCHER_CACHE.clear();
  }
  const fullStripped = stripGenerationalSuffix(rawPlayer);
  const fullCollapsed = collapseInitialDots(fullStripped).toLowerCase();
  const fullRawLower = fullStripped.toLowerCase();
  const isDeebo = /^deebo samuel\b/i.test(fullStripped);
  const isCmc = /^christian mccaffrey$/i.test(fullStripped);
  const parts = fullCollapsed.split(/\s+/).filter(Boolean);
  const rawParts = fullStripped.split(/\s+/).filter(Boolean);
  const surname = parts[parts.length - 1] || '';
  const rawSurname = rawParts[rawParts.length - 1] || surname;
  const targetFirst = (parts[0] || '').replace(/\./g, '');

  const fullRawRe =
    fullRawLower.length >= 4
      ? new RegExp(`(?<![a-z0-9])${escapeRegexLiteral(fullRawLower)}(?![a-z0-9])`, 'i')
      : null;
  const fullCollapsedRe =
    fullCollapsed.length >= 4
      ? new RegExp(`(?<![a-z0-9])${escapeRegexLiteral(fullCollapsed)}(?![a-z0-9])`, 'i')
      : null;
  const capBeforePattern =
    surname.length >= 4
      ? `\\b((?:[A-Z]\\.){1,3}|[A-Z][A-Za-z'-]*[A-Za-z])\\s+${escapeRegexLiteral(rawSurname)}\\b`
      : '';
  const posPrefixRe =
    surname.length >= 4
      ? new RegExp(
          `\\b(qb|rb|fb|wr|te|lt|lg|c|rg|rt|ot|og|ol|dt|de|dl|edge|nt|lb|ilb|olb|mlb|cb|nb|db|s|fs|ss|saf)s?\\s+${escapeRegexLiteral(surname)}\\b`,
          'i'
        )
      : null;
  const injParenRe =
    surname.length >= 4
      ? new RegExp(`\\b${escapeRegexLiteral(surname)}\\s*\\([a-z /,-]{3,28}\\)`, 'i')
      : null;
  const surnameStandaloneRe =
    surname.length >= 4 && !AMBIGUOUS_CLAUSE_SURNAMES.has(surname)
      ? new RegExp(`\\b${escapeRegexLiteral(surname)}\\b`, 'i')
      : null;

  cached = {
    fullStripped,
    fullCollapsed,
    fullRawLower,
    isDeebo,
    isCmc,
    surname,
    rawSurname,
    targetFirst,
    fullRawRe,
    fullCollapsedRe,
    capBeforePattern,
    posPrefixRe,
    injParenRe,
    surnameStandaloneRe
  };
  PLAYER_CLAUSE_MATCHER_CACHE.set(rawPlayer, cached);
  return cached;
}

/**
 * Checks whether a single clause/sentence mentions `playerName` (handling dotted/dotless initials like
 * `C.J. West` <-> `CJ West`, suffixes like `Deebo Samuel Sr.` <-> `Deebo Samuel`, nicknames like `Deebo` / `CMC`,
 * position-disambiguated shared surnames like `LT Williams` vs `DE Williams`, and unambiguous surnames when `allowSurname` is enabled).
 */
export function doesClauseMentionPlayer(
  clauseText = '',
  playerName = '',
  { allowSurname = true, playerPosition = '', sharedSurnames = null, isPrimaryOwner = false } = {}
) {
  const rawClause = String(clauseText || '').replace(/[’‘]/g, "'");
  const rawPlayer = String(playerName || '').replace(/[’‘]/g, "'").trim();
  if (!rawClause || !rawPlayer) return false;

  const matcher = getCompiledPlayerClauseMatcher(rawPlayer);
  const rawClauseLower = rawClause.toLowerCase();

  // Fast substring bailout: if neither the surname nor nickname token appears anywhere in the clause, skip regexes
  if (
    matcher.surname.length >= 3 &&
    !rawClauseLower.includes(matcher.surname) &&
    !(matcher.isDeebo && rawClauseLower.includes('deebo')) &&
    !(matcher.isCmc && rawClauseLower.includes('cmc'))
  ) {
    return false;
  }

  const clauseNorm = collapseInitialDots(rawClause).toLowerCase();

  if (matcher.fullRawRe && matcher.fullRawRe.test(rawClauseLower)) {
    return true;
  }
  if (matcher.fullCollapsedRe && matcher.fullCollapsedRe.test(clauseNorm)) {
    return true;
  }
  if (matcher.isDeebo && /\bdeebo\b/i.test(clauseNorm)) {
    return true;
  }
  if (matcher.isCmc && /\bcmc\b/i.test(clauseNorm)) {
    return true;
  }

  if (allowSurname && matcher.surname.length >= 4) {
    const { surname, targetFirst } = matcher;

    // Guard 1: Reject immediately if every occurrence of `<CapitalizedWord> <Surname>` in `rawClause`
    // is a DIFFERENT person's first name (e.g., "LT Trent Williams (shoulder)" must NEVER match "Mykel Williams"!)
    const capBeforeMatches = [...rawClause.matchAll(new RegExp(matcher.capBeforePattern, 'g'))];
    if (capBeforeMatches.length > 0) {
      let sawConflictingFirstName = false;
      let sawMatchingOrNeutral = false;
      for (const cm of capBeforeMatches) {
        const foundFirst = collapseInitialDots(cm[1]).toLowerCase().replace(/\./g, '');
        if (NON_FIRST_NAME_STOPWORDS.has(foundFirst) || foundFirst === targetFirst) {
          sawMatchingOrNeutral = true;
        } else {
          sawConflictingFirstName = true;
        }
      }
      if (sawConflictingFirstName && !sawMatchingOrNeutral) {
        return false;
      }
    }

    const isSharedRosterSurname = Boolean(sharedSurnames instanceof Set && sharedSurnames.has(surname));

    // Check explicit position-prefixed mention (e.g., "LT Williams", "CBs Green", "DT West")
    const posPrefixMatch = matcher.posPrefixRe ? clauseNorm.match(matcher.posPrefixRe) : null;
    if (posPrefixMatch) {
      if (!playerPosition || arePositionTokensCompatible(posPrefixMatch[1], playerPosition)) {
        return true;
      }
      return false;
    }

    // Check injury-parenthetical mention (e.g., "Green (back)", "West (knee)", or owner-scoped "Williams (shoulder)")
    if (matcher.injParenRe && matcher.injParenRe.test(clauseNorm)) {
      if (!isSharedRosterSurname || isPrimaryOwner) {
        return true;
      }
      return false;
    }

    if (matcher.surnameStandaloneRe && (!isSharedRosterSurname || isPrimaryOwner)) {
      if (matcher.surnameStandaloneRe.test(clauseNorm)) {
        return true;
      }
    }
  }
  return false;
}

const CURATED_PRIOR_PLAYER_NAMES = Object.keys(CURATED_NFL_PLAYER_PRIORS);
const CANDIDATE_ROSTER_ENTRIES_CACHE = new WeakMap();
let EMPTY_ROSTER_CANDIDATE_ENTRIES = null;

function buildCandidatePlayerEntries(rosterPlayerNames) {
  const seen = new Set();
  const entries = [];
  const pushName = raw => {
    if (!raw) return;
    const stripped = stripGenerationalSuffix(raw);
    const strippedLower = stripped.toLowerCase();
    if (!strippedLower || seen.has(strippedLower)) return;
    seen.add(strippedLower);
    const surname =
      collapseInitialDots(stripped)
        .toLowerCase()
        .split(/\s+/)
        .filter(Boolean)
        .pop() || '';
    entries.push({ name: raw, strippedLower, surname });
  };
  for (const n of CURATED_PRIOR_PLAYER_NAMES) pushName(n);
  if (Array.isArray(rosterPlayerNames)) {
    for (const n of rosterPlayerNames) pushName(n);
  }
  return entries;
}

function getCachedCandidatePlayerEntries(rosterPlayerNames) {
  if (!Array.isArray(rosterPlayerNames) || rosterPlayerNames.length === 0) {
    if (!EMPTY_ROSTER_CANDIDATE_ENTRIES) {
      EMPTY_ROSTER_CANDIDATE_ENTRIES = buildCandidatePlayerEntries([]);
    }
    return EMPTY_ROSTER_CANDIDATE_ENTRIES;
  }
  let cached = CANDIDATE_ROSTER_ENTRIES_CACHE.get(rosterPlayerNames);
  if (!cached) {
    cached = buildCandidatePlayerEntries(rosterPlayerNames);
    CANDIDATE_ROSTER_ENTRIES_CACHE.set(rosterPlayerNames, cached);
  }
  return cached;
}

const SCOPE_NON_PLAYER_PAIRS = new Set([
  'san francisco', 'las vegas', 'vegas raiders', 'dallas cowboys', 'los angeles', 'angeles rams', 'angeles chargers',
  'green bay', 'bay packers', 'tampa bay', 'bay buccaneers', 'new orleans', 'orleans saints', 'new england',
  'england patriots', 'new york', 'york giants', 'york jets', 'kansas city', 'city chiefs', 'minnesota vikings',
  'seattle seahawks', 'arizona cardinals', 'atlanta falcons', 'detroit lions', 'chicago bears', 'philadelphia eagles',
  'washington commanders', 'carolina panthers', 'buffalo bills', 'miami dolphins', 'baltimore ravens',
  'cincinnati bengals', 'cleveland browns', 'pittsburgh steelers', 'houston texans', 'indianapolis colts',
  'jacksonville jaguars', 'tennessee titans', 'denver broncos', 'mexico city', 'super bowl', 'pro bowl', 'all pro',
  'kyle shanahan', 'john lynch', 'raheem morris', 'klay kubiak', 'chris foerster', 'kris kocurek',
  'robert saleh', 'kevin oconnell', "kevin o'connell", 'sean mcvay', 'mike macdonald',
  'dan campbell', 'matt lafleur', 'matt barrows', 'matt maiocco', 'nick wagoner', 'david lombardi', 'cam inman',
  'eric branch', 'vic tafur', 'sam warren', 'noah furtado', 'jennifer lee', 'lee chan', 'adam schefter',
  'ian rapoport', 'tom pelissero', 'mike garafolo', 'jeremy fowler', 'david bonilla', 'kyle posey', 'patrick holloway',
  'injured reserve', 'practice squad', 'head coach', 'medical staff', 'athletic trainers', 'blue tent', 'medical tent',
  'bay area', 'nfl network', 'the athletic', 'niners nation', 'niners wire', 'sports illustrated'
]);

/**
 * Scopes multi-sentence / multi-player beat notes or tweets to ONLY the clauses pertaining to `targetPlayerName`,
 * preventing cross-player signal bleed (e.g., `"Shanahan said he's hopeful to get Deebo Samuel and CJ West back
 * to practice on Wednesday. The team is not expecting Mike Evans this week."`).
 */
export function scopeBeatTextToPlayer(rawText = '', targetPlayerName = '', rosterPlayerNames = []) {
  const text = String(rawText || '')
    .replace(/\[([A-Za-z]{1,4})\]\s+(?=[A-Z])/g, '$1 ')
    .trim();
  const target = String(targetPlayerName || '').trim();
  if (!text || !target) return text;

  const sentences = text
    .split(/(?<=[.!?])\s+|\s*[;\n]+\s*|\b(?=[Ww]hile\s+[A-Z]|[Ww]hereas\s+[A-Z]|[Mm]eanwhile,?\s+|[Oo]n the plus side\b|[Ii]n any case,?\s+)/)
    .map(s => s.trim())
    .filter(Boolean);

  const targetStripped = stripGenerationalSuffix(target);
  const targetStrippedLower = targetStripped.toLowerCase();
  const targetCollapsed = collapseInitialDots(targetStripped).toLowerCase();
  const targetParts = targetCollapsed.split(/\s+/).filter(Boolean);
  const targetSurname = targetParts[targetParts.length - 1] || '';
  const targetRawSurname = (targetStripped.split(/\s+/).filter(Boolean).pop() || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const capSurnameRe =
    targetRawSurname && targetSurname.length >= 4
      ? new RegExp(`(?<![A-Za-z0-9])${targetRawSurname}(?:['’]s)?(?![A-Za-z0-9])`)
      : null;
  const diffFirstSurnameRe =
    targetRawSurname && targetSurname.length >= 4
      ? new RegExp(`\\b((?:[A-Z]\\.){1,3}|[A-Z][A-Za-z'-]*[A-Za-z])\\s+${targetRawSurname}\\b`, 'g')
      : null;

  const candidateOthers = getCachedCandidatePlayerEntries(rosterPlayerNames);

  const doesClauseMentionContextualTargetSurname = clause => {
    if (!capSurnameRe) return false;
    // Match capitalized surname ("Green left...", "Green's back...") once target full name has already been introduced,
    // while strictly rejecting team/place/idiom phrases ("Green Bay", "Green Wave", "Green Room", "NFC West", "AFC West")
    if (!capSurnameRe.test(clause)) return false;
    if (
      /\b(?:Green\s+(?:Bay|Wave|Room|Light|Zone|Berets?)|(?:NFC|AFC)\s+(?:West|North|South|East)|West\s+(?:Coast|Virginia)|White\s+House|New\s+York|Long\s+(?:Island|Beach|Snapper))\b/.test(
        clause
      )
    ) {
      const strippedPlaces = clause.replace(
        /\b(?:Green\s+(?:Bay|Wave|Room|Light|Zone|Berets?)|(?:NFC|AFC)\s+(?:West|North|South|East)|West\s+(?:Coast|Virginia)|White\s+House|New\s+York|Long\s+(?:Island|Beach|Snapper))\b/g,
        ' '
      );
      if (!capSurnameRe.test(strippedPlaces)) return false;
    }
    // Reject if preceded by a different capitalized first name (e.g. "A.J. Green" or "Quinnen Williams")
    const diffFirstMatch = [...clause.matchAll(diffFirstSurnameRe)];
    if (diffFirstMatch.length > 0) {
      const targetFirst = (targetParts[0] || '').replace(/\./g, '');
      const hasValidOrNeutral = diffFirstMatch.some(m => {
        const f = collapseInitialDots(m[1]).toLowerCase().replace(/\./g, '');
        return f === targetFirst || NON_FIRST_NAME_STOPWORDS.has(f);
      });
      if (!hasValidOrNeutral) return false;
    }
    return true;
  };

  const mentionsOtherNamedPlayer = clause => {
    // Fast check for explicit teammate transition phrases or other roster names
    if (/\bfellow\s+(?:wr|rb|te|cb|dt|de|dl|lb|ol|ot|s|qb)s?\b/i.test(clause) && !doesClauseMentionPlayer(clause, target)) {
      return true;
    }
    for (const other of candidateOthers) {
      if (other.strippedLower === targetStrippedLower) continue;
      const allowOtherSurname = Boolean(other.surname && other.surname !== targetSurname);
      if (doesClauseMentionPlayer(clause, other.name, { allowSurname: allowOtherSurname })) return true;
    }
    // Also detect capitalized "First Last (injury)" or "WR First Last" for non-target players
    const explicitOtherMatches = [
      ...clause.matchAll(/\b([A-Z][a-z'.-]+\s+[A-Z][a-z'.-]+)\s*(?:\([a-zA-Z /,-]{3,24}\))?/g)
    ];
    for (const m of explicitOtherMatches) {
      const pair = collapseInitialDots(m[1]).toLowerCase();
      if (SCOPE_NON_PLAYER_PAIRS.has(pair)) continue;
      if (pair !== targetCollapsed && !targetCollapsed.includes(pair) && !pair.includes(targetCollapsed)) {
        if (/\([a-z /,-]{3,24}\)|\b(?:wr|rb|te|cb|dt|de|lb|qb|ot|saf)\b/i.test(m[0]) || /\b(?:expecting|ruled out|is inactive|was inactive|sidelined|placed on|need surgery|requires surgery|miss)\b/i.test(clause)) {
          return true;
        }
      }
    }
    return false;
  };

  const FINITE_CLAUSE_PREDICATE_RE =
    /\b(?:is|was|are|were|has|had|left|exited|departed|suffered|sustained|missed|practiced|returned|played|ruled|remains|can['’]?t|cannot|won['’]?t|will|didn['’]?t|did\s+not|battled|dealing|sat\s+out|logged|upgraded|downgraded|aggravated)\b/i;

  const splitIndependentPlayerCommaClauses = segment => {
    // Only split comma-separated independent clauses when BOTH sides have their own finite verb predicate
    // and the right side starts with a capitalized player/position subject (preserving shared-predicate lists
    // like "hopeful to get Deebo Samuel, Trent Williams, and CJ West back to practice on Wednesday").
    if (!segment.includes(',')) return [segment];
    const commaBoundaryRe =
      /,\s+(?=(?:and\s+)?(?:(?:fellow|WR|RB|FB|CB|DT|DE|DL|LB|TE|QB|OT|OG|OL|S|DB|K|P)\s+)?[A-Z][a-zA-Z'.-]+)/g;
    const cuts = [0];
    let m;
    while ((m = commaBoundaryRe.exec(segment)) !== null) {
      const prevStart = cuts[cuts.length - 1];
      const leftPart = segment.slice(prevStart, m.index).trim();
      const rightStart = m.index + m[0].length;
      const rightFull = segment.slice(rightStart).trim();
      const rightNextComma = rightFull.indexOf(',');
      const rightHead = rightNextComma >= 0 ? rightFull.slice(0, rightNextComma) : rightFull;
      if (FINITE_CLAUSE_PREDICATE_RE.test(leftPart) && FINITE_CLAUSE_PREDICATE_RE.test(rightHead)) {
        cuts.push(rightStart);
      }
    }
    if (cuts.length === 1) return [segment];
    const out = [];
    for (let i = 0; i < cuts.length; i++) {
      const start = cuts[i];
      const end = i + 1 < cuts.length ? cuts[i + 1] : segment.length;
      const piece = segment.slice(start, end).replace(/,\s*$/, '').trim();
      if (piece) out.push(piece);
    }
    return out.length > 0 ? out : [segment];
  };

  const kept = [];
  let activeSubjectIsTarget = false;
  let anyTargetMentioned = false;

  for (const sent of sentences) {
    // Also split compound contrast clauses, trailing participial impact clauses ("..., boosting hopes for Brock Purdy's offense"),
    // teammate-reaction clauses ("Brock Purdy, Trent Williams, and George Kittle react to Mike Evans' return to practice"),
    // & independent multi-player comma clauses when different players are on each side
    const contrastParts = sent
      .split(
        /,\s*(?=(?:(?:[Ww]hile|[Ww]hereas|[Bb]ut|[Tt]hough|[Aa]lthough)\s+(?:(?:fellow|WR|RB|CB|DT|DE|LB|TE|QB|OT|OL|DL|S)\s+)?[A-Z]|(?:boosting|helping|giving|opening|leaving|affecting|impacting|forcing|allowing|benefiting|hurting|creating|putting|keeping)\b))/
      )
      .flatMap(seg =>
        seg.split(
          /\s+(?=(?:react(?:s|ed|ing)?\s+to|weigh(?:s|ed|ing)?\s+in\s+on|share(?:s|d|ing)?\s+(?:their\s+|his\s+)?thoughts\s+on|comment(?:s|ed|ing)?\s+on|speak(?:s|ing)?\s+(?:on|about)|talk(?:s|ed|ing)?\s+about|discuss(?:es|ed|ing)?\s+(?:the\s+)?(?:impact|return|recovery|injury|status|absence|comeback)\s+of)\b)/i
        )
      )
      .map(p => p.trim())
      .filter(Boolean);
    const parts = contrastParts.flatMap(splitIndependentPlayerCommaClauses);

    for (const clause of parts) {
      const hasTarget =
        doesClauseMentionPlayer(clause, target) ||
        (anyTargetMentioned && doesClauseMentionContextualTargetSurname(clause));

      if (hasTarget) {
        kept.push(clause);
        activeSubjectIsTarget = true;
        anyTargetMentioned = true;
      } else if (activeSubjectIsTarget) {
        const isTeammateConsolationBackRef =
          /\b(?:hug(?:s|ged|ging)?|consol(?:e|es|ed|ing)|embrac(?:e|es|ed|ing)|check(?:s|ed|ing)?\s+on|encourag(?:e|es|ed|ing)|pray(?:s|ed|ing)?\s+for|gathered\s+around|walked\s+over\s+to|came\s+over\s+to)\b[\s\S]{0,36}\b(?:him|his)\b/i.test(
            clause
          );
        if (isTeammateConsolationBackRef) {
          // Teammate consolation referring back to our injured target ("Trent Williams walked over to hug him"):
          // keep `activeSubjectIsTarget = true` so subsequent injury-detail sentences stay scoped to target!
        } else if (mentionsOtherNamedPlayer(clause)) {
          activeSubjectIsTarget = false;
        } else {
          kept.push(clause);
        }
      }
    }
  }

  if (anyTargetMentioned) {
    const seenClauses = new Set();
    const dedupedKept = [];
    for (const c of kept) {
      const normKey = c.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 64);
      if (!normKey || seenClauses.has(normKey)) continue;
      seenClauses.add(normKey);
      dedupedKept.push(c.replace(/\s*\.\.(?!\.)\s*/g, '. '));
    }
    return dedupedKept.join(' ').replace(/\s+/g, ' ').trim();
  }
  // If no competing player was named anywhere in `text`, preserve `text` (standalone single-player note)
  const anyOtherAnywhere = sentences.some(s => mentionsOtherNamedPlayer(s));
  return anyOtherAnywhere ? '' : text.replace(/\s*\.\.(?!\.)\s*/g, '. ').replace(/\s+/g, ' ').trim();
}

function hasAffirmativeRuledOutSignal(beatNote = '') {
  if (!beatNote) return false;
  if (/\bplaced on injured reserve\b/i.test(beatNote)) return true;
  if (/\bruled out\b/i.test(beatNote) && !/\b(?:not|n't|hasn't been|has not been|haven't|never|neither\b[^.;]{0,45})\s*(?:been\s+)?ruled out\b/i.test(beatNote)) {
    return true;
  }
  if (
    /\b(?:will not|won't)\s+play\b/i.test(beatNote) &&
    !/\b(?:if he|whether he)\s+(?:will not|won't)\s+play\b/i.test(beatNote)
  ) {
    return true;
  }
  if (
    /\bwill miss\s+/i.test(beatNote) &&
    !/\b(?:neither\b[^.;]{0,50}\bwill miss|(?:unlikely|doubtful|not|never)\b[^.;]{0,28}\bwill miss|won't miss|will not miss)\b/i.test(
      beatNote
    )
  ) {
    return true;
  }
  return false;
}

function stripInitialAndHonorificDots(str = '') {
  return collapseInitialDots(String(str || '')).replace(/\b(jr|sr|st|vs)\./gi, '$1');
}

export function hasWindowDefinitelyNotOpeningSignal(beatNote = '') {
  if (!beatNote) return false;
  const norm = stripInitialAndHonorificDots(beatNote);
  return (
    /\b(?:(?:will not|won't|is not going to|isn't going to|are not going to|aren't going to|not going to|aren't|isn't|do not plan to|don't plan to|does not plan to|doesn't plan to|not expected to|isn't expected to|no plans to|decided against|opted against)\s+open(?:ing)?\b[^.;]{0,58}\b(?:21-day|practice|return|ir|injured reserve)?\s*window|(?:21-day|practice|return)\s+window\s+(?:will not|won't|is not going to|isn't going to|is not expected to|isn't expected to)\s+(?:be\s+)?open(?:ed)?|not\s+(?:yet\s+)?ready\s+to\s+(?:open\b[^.;]{0,36}\bwindow|return\s+to\s+practice))\b/i.test(
      norm
    )
  );
}

export function hasDefiniteIrNonActivationOrWindowClosedSignal(beatNote = '') {
  if (!beatNote) return false;
  const norm = stripInitialAndHonorificDots(beatNote);
  if (hasWindowDefinitelyNotOpeningSignal(norm)) return true;
  if (hasAffirmativeRuledOutSignal(norm)) return true;
  // Guard against conditional "if he isn't activated" / "would need to be activated"
  if (
    /\b(?:(?:will not|won't|is not going to|isn't going to|are not going to|aren't going to|not going to|aren't|isn't|do not plan to|don't plan to|does not plan to|doesn't plan to|no plans to|decided not to|opted not to)\s+(?:be\s+)?activat(?:e|ed|ing)\b|(?:was not|wasn't|were not|weren't|did not|didn't)\s+activat(?:e|ed)\b|(?:aren't|isn't|not)\s+yet\s+ready\s+to\s+activate\b|not\s+(?:yet\s+)?ready\s+to\s+return\s+to\s+(?:game\s+action|practice)|(?:remains?|remaining|staying|will stay|will remain)\s+on\s+(?:the\s+)?(?:injured\s+reserve|ir\b|pup\b)|(?:will\s+have\s+to\s+wait|needs?|giving\s+him)\s+(?:at\s+least\s+)?another\s+week\b|holding\s+him\s+out\s+(?:this\s+week|for\s+week|on\s+(?:sunday|monday|thursday|saturday))|(?:not|n't|isn't|no\s+longer)\s+(?:expected\s+to\s+(?:be\s+activated|play|suit\s+up)\s*(?:this\s+week|in\s+week\s*\d+|sunday|monday|thursday|saturday|against|versus|vs)?|expecting\b[^.;]{0,40}\bthis\s+week))\b/i.test(
      norm
    ) &&
    !/\b(?:if|unless|whether)\s+(?:he|they|the\s+team|the\s+49ers)\s+(?:is\s+not|isn't|wasn't|aren't|don't|won't)\s+(?:be\s+)?activat/i.test(
      norm
    )
  ) {
    return true;
  }
  if (
    /\bnot\s+activated\b/i.test(norm) &&
    !/\b(?:if|unless|whether)\b[^.;]{0,28}\bnot\s+activated\b/i.test(norm)
  ) {
    return true;
  }
  return false;
}

const ET_CALENDAR_FORMATTER = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  weekday: 'short',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23'
});

function extractEtDayMeta(epochMs) {
  const parts = ET_CALENDAR_FORMATTER.formatToParts(new Date(epochMs));
  let year = 1970;
  let month = 1;
  let day = 1;
  let weekday = 'Sun';
  let hour = 0;
  let minute = 0;
  for (const p of parts) {
    if (p.type === 'year') year = Number(p.value);
    else if (p.type === 'month') month = Number(p.value);
    else if (p.type === 'day') day = Number(p.value);
    else if (p.type === 'weekday') weekday = p.value;
    else if (p.type === 'hour') hour = Number(p.value) % 24;
    else if (p.type === 'minute') minute = Number(p.value);
  }
  return {
    year,
    month,
    day,
    weekday,
    hour,
    minute,
    dayIndex: Math.floor(Date.UTC(year, month - 1, day) / 86_400_000),
    minutesOfDay: hour * 60 + minute
  };
}

function etWallClockToEpochMs(year, month, day, hour = 16, minute = 0) {
  const targetDayIndex = Math.floor(Date.UTC(year, month - 1, day) / 86_400_000);
  const targetMinutes = hour * 60 + minute;
  const guessUtc = Date.UTC(year, month - 1, day, hour + 5, minute, 0);
  const obs = extractEtDayMeta(guessUtc);
  const deltaMinutes = (targetDayIndex - obs.dayIndex) * 1440 + (targetMinutes - obs.minutesOfDay);
  return guessUtc + deltaMinutes * 60_000;
}

/**
 * Returns the number of calendar days before kickoff when Practice Day 1 opens in the NFL:
 *  - Wednesday special games (e.g. Christmas Day) -> 2 days prior (Monday)
 *  - Thursday Night / Thanksgiving & Black Friday / International Friday games -> 3 days prior (Monday / Tuesday)
 *  - Saturday, Sunday & Monday Night games -> 4 days prior (Tuesday / Wednesday / Thursday)
 */
export function getPracticeReportLeadDays(kickoffWeekday = 'Sun') {
  if (kickoffWeekday === 'Wed') return 2;
  if (kickoffWeekday === 'Thu' || kickoffWeekday === 'Fri') return 3;
  return 4;
}

/**
 * Evaluates whether a club's weekly NFL CBA 53-man IR/PUP activation deadline (4:00 PM ET on
 * Saturday for Sunday games, Friday for Saturday games, game-day 4:00 PM ET for prime-time
 * Thursday/Monday/Friday games, or day-before 4:00 PM ET for daytime weekday games, always
 * capped at `kickoff - 90m`) has passed for the active upcoming game, as well as the 21-day
 * window stage (`1..3`) and expiration.
 */
export function evaluateWeeklyIrActivationWindow({
  kickoffIso = '',
  designatedDateIso = '',
  nowMs = Date.now(),
  schedule = [],
  seasonConcluded = false
} = {}) {
  const ts = Number.isFinite(nowMs) ? nowMs : Date.now();
  const desigMs = parseFlexibleIsoMs(designatedDateIso);
  const windowDaysElapsed =
    desigMs !== null && ts >= desigMs ? (ts - desigMs) / 86_400_000 : null;
  const is21DayWindowExpired = windowDaysElapsed !== null && windowDaysElapsed >= 21.5;

  let koMs = kickoffIso ? Date.parse(kickoffIso) : NaN;
  const maxPostKickoffGameMs = 5.25 * 3_600_000;
  const matchedKoGame =
    Number.isFinite(koMs) && Array.isArray(schedule) && schedule.length > 0
      ? schedule.find(g => {
          if (!g) return false;
          const gMs = Date.parse(g.dateIso || g.kickoffIso || '');
          return Number.isFinite(gMs) && Math.abs(gMs - koMs) < 18 * 3_600_000;
        }) || null
      : null;
  const koGameStatusStr = String(matchedKoGame?.statusDetail || '');
  const koGameStateLower = String(matchedKoGame?.statusState || '').toLowerCase();
  const koGameAlreadyCompleted = Boolean(
    matchedKoGame?.completed || koGameStateLower === 'post' || /\bfinal\b/i.test(koGameStatusStr)
  );
  const koGameIsLiveOrDelayed =
    !koGameAlreadyCompleted &&
    (koGameStateLower === 'in' ||
      Boolean(matchedKoGame?.isLive) ||
      /\b(1st|2nd|3rd|4th|q[1-4]|halftime|in progress|ot|overtime|delayed|weather delay|lightning delay|suspended)\b/i.test(
        koGameStatusStr
      ));
  const effectiveMaxPostKickoffMs = koGameIsLiveOrDelayed ? 10 * 3_600_000 : maxPostKickoffGameMs;

  // If the supplied `kickoffIso` has already concluded (`completed === true` at 0m post-whistle or >5.25h post-kickoff
  // when NOT explicitly live/OT/delayed), immediately advance to the next unplayed non-bye game in `schedule`.
  if (
    (!Number.isFinite(koMs) || koGameAlreadyCompleted || ts > koMs + effectiveMaxPostKickoffMs) &&
    Array.isArray(schedule) &&
    schedule.length > 0
  ) {
    const nextGame = schedule
      .filter(g => g && !g.completed && !g.isByeWeek && !g.opponent?.isTbd)
      .map(g => ({ g, ms: Date.parse(g.dateIso || g.kickoffIso || '') }))
      .filter(x => Number.isFinite(x.ms) && ts <= x.ms + maxPostKickoffGameMs)
      .sort((a, b) => a.ms - b.ms)[0];
    if (nextGame) {
      koMs = nextGame.ms;
    } else if (koGameAlreadyCompleted || (Number.isFinite(koMs) && ts > koMs + effectiveMaxPostKickoffMs)) {
      koMs = NaN;
    }
  }

  const stageRefMs = Number.isFinite(koMs) && koMs > ts ? koMs : ts;
  const stageDays =
    desigMs !== null && stageRefMs >= desigMs ? (stageRefMs - desigMs) / 86_400_000 : null;
  const stageThreshold2 = Number.isFinite(koMs) ? 7.5 : 6.5;
  const stageThreshold3 = Number.isFinite(koMs) ? 14.5 : 13.5;
  const windowWeekStage =
    stageDays === null
      ? null
      : stageDays >= stageThreshold3
        ? 3
        : stageDays >= stageThreshold2
          ? 2
          : 1;

  if (!Number.isFinite(koMs)) {
    return {
      hasMissedWeeklyDeadline: false,
      isSeasonConcluded: Boolean(seasonConcluded),
      deadlineMs: null,
      deadlineIso: null,
      kickoffMs: null,
      windowDaysElapsed,
      windowWeekStage,
      is21DayWindowExpired
    };
  }

  const koEt = extractEtDayMeta(koMs);
  // Sunday & Saturday games lock the day before at 4:00 PM ET; prime-time weekday games (kickoff >= 6:00 PM ET)
  // lock on game day at 4:00 PM ET; daytime weekday games (e.g. Thanksgiving / Black Friday afternoon) lock day before at 4:00 PM ET.
  const offsetDaysEt =
    koEt.weekday === 'Sun' || koEt.weekday === 'Sat' || koEt.hour < 18 ? -1 : 0;
  const targetDayUtc = new Date(Date.UTC(koEt.year, koEt.month - 1, koEt.day + offsetDaysEt));
  const rawDeadlineMs = etWallClockToEpochMs(
    targetDayUtc.getUTCFullYear(),
    targetDayUtc.getUTCMonth() + 1,
    targetDayUtc.getUTCDate(),
    16,
    0
  );
  const deadlineMs = Math.min(rawDeadlineMs, koMs - 90 * 60_000);

  // Missed weekly activation window holds from 4:00 PM ET deadline through final whistle (`completed`, `koMs + 5.25h`, or up to `10h` when explicitly live/OT/delayed).
  const hasMissedWeeklyDeadline = ts >= deadlineMs && ts <= koMs + effectiveMaxPostKickoffMs;

  return {
    hasMissedWeeklyDeadline,
    isSeasonConcluded: Boolean(seasonConcluded),
    deadlineMs,
    deadlineIso: new Date(deadlineMs).toISOString(),
    kickoffMs: koMs,
    windowDaysElapsed,
    windowWeekStage,
    is21DayWindowExpired
  };
}

const NFL_MASCOT_OR_CITY_TOKENS_RE =
  /\b(cardinals|arizona|falcons|atlanta|ravens|baltimore|bills|buffalo|panthers|carolina|bears|chicago|bengals|cincinnati|browns|cleveland|cowboys|dallas|broncos|denver|lions|detroit|packers|green bay|texans|houston|colts|indianapolis|jaguars|jacksonville|chiefs|kansas city|raiders|las vegas|chargers|rams|dolphins|miami|vikings|minnesota|patriots|new england|saints|new orleans|giants|jets|eagles|philadelphia|steelers|pittsburgh|49ers|niners|san francisco|seahawks|seattle|buccaneers|tampa bay|titans|tennessee|commanders|washington)\b/i;

/**
 * Strips prior-week Saturday non-activation carryover clauses (e.g., Week 10 `"won't be activated ahead of Sunday's
 * Week 10 clash against the Cowboys"` once Week 10 is completed and Week 11 vs. Vikings has begun, or `"Since he wasn't
 * activated Saturday... next chance to do so is Sunday against Dallas"` during Dallas week) while preserving prior-week
 * practice ramp-up facts (`"upgraded to a full practice session Friday"`, `"trio of full practices"`).
 */
export function sanitizeIrBeatNoteForCurrentWeek(
  rawNote = '',
  {
    currentWeek = null,
    upcomingOppName = '',
    upcomingOppAbbr = '',
    blurbDateIso = null,
    lastCompletedGameKickoffMs = null,
    hasCurrentWeekPractice = false
  } = {}
) {
  const text = String(rawNote || '').trim();
  if (!text) return '';

  const curWk = Number.isFinite(Number(currentWeek)) && Number(currentWeek) > 0 ? Number(currentWeek) : null;
  const oppLower = `${upcomingOppName || ''} ${upcomingOppAbbr || ''}`.toLowerCase().trim();
  const oppTokens = oppLower
    .split(/[^a-z0-9]+/)
    .filter(tok => tok.length >= 4 && tok !== 'football' && tok !== 'team');

  const blurbMs = parseFlexibleIsoMs(blurbDateIso);
  const allWkMentions = [...text.toLowerCase().matchAll(/\bweek\s*(\d{1,2})\b/gi)].map(m => Number(m[1]));
  const leadOpponentMatch = text
    .toLowerCase()
    .match(/\b(?:against|versus|vs\.?|to\s+face|tilt\s+against|clash\s+against|at)\s+(?:the\s+)?([a-z]+(?:\s+[a-z]+)?)\b/i);
  const leadOpponentChunk = leadOpponentMatch ? leadOpponentMatch[1] : '';
  const wholeNoteNamesPriorWeek =
    curWk !== null && allWkMentions.length > 0 && allWkMentions.every(w => w < curWk);
  const wholeNoteNamesDifferentTeam =
    Boolean(leadOpponentChunk && NFL_MASCOT_OR_CITY_TOKENS_RE.test(leadOpponentChunk)) &&
    oppTokens.length > 0 &&
    !oppTokens.some(tok => leadOpponentChunk.includes(tok) || text.toLowerCase().includes(tok));

  const blurbPredatesCurrentWeek =
    wholeNoteNamesPriorWeek ||
    wholeNoteNamesDifferentTeam ||
    (blurbMs !== null &&
      Number.isFinite(lastCompletedGameKickoffMs) &&
      lastCompletedGameKickoffMs > 0 &&
      blurbMs < lastCompletedGameKickoffMs);

  // Check if the full note explicitly points to the CURRENT week/opponent as the "next chance"
  const nextChanceMatch = text.match(/\bnext\s+(?:chance|opportunity)\s+[^.!?]{0,80}/i);
  const nextChanceLower = nextChanceMatch ? nextChanceMatch[0].toLowerCase() : '';
  const nextChanceTargetsCurrentOpp =
    Boolean(nextChanceLower) &&
    (oppTokens.some(tok => nextChanceLower.includes(tok)) ||
      (curWk !== null && new RegExp(`\\bweek\\s*${curWk}\\b`, 'i').test(nextChanceLower)));

  const sentences = text
    .split(/(?<=[.!?])\s+/)
    .map(s => s.trim())
    .filter(Boolean);

  const kept = [];
  for (const sent of sentences) {
    if (!hasDefiniteIrNonActivationOrWindowClosedSignal(sent)) {
      kept.push(sent);
      continue;
    }

    const sentLower = sent.toLowerCase();
    const wkMentions = [...sentLower.matchAll(/\bweek\s*(\d{1,2})\b/gi)].map(m => Number(m[1]));
    const citesStrictlyPriorWeek =
      curWk !== null && wkMentions.length > 0 && wkMentions.every(w => w < curWk);
    const citesCurrentOrFutureWeek =
      curWk !== null && wkMentions.some(w => w >= curWk);

    // Check if the sentence names a specific opponent that does NOT match the current upcoming opponent
    const oppPhraseMatch = sentLower.match(
      /\b(?:against|versus|vs\.?|to\s+face|tilt\s+against|clash\s+against|matchup\s+with)\s+(?:the\s+)?([a-z]+(?:\s+[a-z]+)?)\b/i
    );
    const namedTeamChunk = oppPhraseMatch ? oppPhraseMatch[1] : '';
    const namesSpecificTeam = Boolean(namedTeamChunk && NFL_MASCOT_OR_CITY_TOKENS_RE.test(namedTeamChunk));
    const namesDifferentTeam =
      namesSpecificTeam &&
      oppTokens.length > 0 &&
      !oppTokens.some(tok => namedTeamChunk.includes(tok) || sentLower.includes(tok));

    const isPastSaturdayNonActivation =
      /\b(?:wasn't|was\s+not|weren't|were\s+not|didn't|did\s+not)\s+activat(?:e|ed)\b/i.test(sentLower);
    const citesPriorFridayOrSaturdayWhileUnpracticed =
      !hasCurrentWeekPractice &&
      /\b(?:upgraded\s+to\s+a\s+full\s+practice\s+session\s+friday|full\s+practices\s+this\s+week|wasn't\s+activated\s+saturday)\b/i.test(
        sentLower
      );

    const isStalePriorWeekNonActivation =
      citesStrictlyPriorWeek ||
      namesDifferentTeam ||
      nextChanceTargetsCurrentOpp ||
      citesPriorFridayOrSaturdayWhileUnpracticed ||
      (blurbPredatesCurrentWeek && !citesCurrentOrFutureWeek && !/\b(?:next\s+several\s+weeks|multiple\s+weeks|december)\b/i.test(sentLower)) ||
      (hasCurrentWeekPractice && isPastSaturdayNonActivation && !citesCurrentOrFutureWeek);

    if (isStalePriorWeekNonActivation) {
      // Preserve any practice progression half of a compound sentence (e.g., "He upgraded to a full practice session Friday after being limited Wednesday and Thursday, but the 49ers aren't yet ready to activate him.")
      const strippedRuling = sent
        .replace(/,?\s*\b(?:but|though|although|however)\s+[^.!?]*\b(?:activat\w*|return\s+to\s+game\s+action|wait\s+[^.!?]*week)[^.!?]*/gi, '.')
        .trim();
      if (
        strippedRuling &&
        strippedRuling !== sent &&
        !hasDefiniteIrNonActivationOrWindowClosedSignal(strippedRuling) &&
        /\b(?:full\s+practice|limited|practice\s+window)\b/i.test(strippedRuling)
      ) {
        kept.push(strippedRuling);
      }
      continue;
    }

    kept.push(sent);
  }

  return kept.join(' ').trim();
}

/**
 * Deterministically detects whether an Injured Reserve / Reserve-PUP player remains inside an active
 * 21-day practice window across multi-week rollovers (even when ESPN's team transactions endpoint
 * resets to `[]` at the start of a new league week), anchored strictly to:
 *   1) Official / Tier-1 beat reports within the trailing 21 days announcing the 21-day practice window opening, OR
 *   2) `IR-R` / `PUP-R` status combined with post-4-game-minimum `weeklyHistory` practice (`LP`/`FP` at
 *      `week >= earliestEligibleWeek` within trailing 3 weeks) or explicit multi-session 21-day window practice prose.
 * Never opens a window from `IR-R` alone (which NFL clubs also assign to preseason cutdown IR-DTR players).
 */
export function detectOpen21DayIrWindowFromHistory({
  playerName = '',
  rosterBucket = 'ir',
  isSeasonEnding = false,
  fantasyStatusAbbr = '',
  earliestEligibleWeek = null,
  weeklyHistory = [],
  beatNote = '',
  newsItems = [],
  rosterPlayerNames = [],
  currentWeek = 1,
  nowMs = Date.now()
} = {}) {
  const bucket = String(rosterBucket || '').toLowerCase();
  if ((bucket !== 'ir' && bucket !== 'pup') || isSeasonEnding) {
    return { isOpen: false, designatedDateIso: null, leadNote: '' };
  }

  const noteStr = String(beatNote || '').trim();
  if (
    /\b(out for (?:the )?(?:\d{4} )?season|miss the entire|done for the (?:year|season)|for the rest of the (?:year|season)|season-ending|without a designation to return|21-day (?:practice )?window expired|reverted to season-ending)\b/i.test(
      noteStr
    )
  ) {
    return { isOpen: false, designatedDateIso: null, leadNote: '' };
  }

  const ts = Number.isFinite(nowMs) ? nowMs : Date.now();
  const minWindowMs = ts - 21 * 86_400_000;
  let openedAtMs = null;
  let leadNote = '';

  if (playerName && Array.isArray(newsItems) && newsItems.length > 0) {
    const sharedSet = computeSharedRosterSurnames(rosterPlayerNames.map(nm => ({ name: nm })));
    const chronItems = [];
    for (const item of newsItems) {
      if (!item || item.isClickbait || item.type === 'video') continue;
      const pubMs = parseFlexibleIsoMs(item.publishedAt);
      if (pubMs === null || pubMs < minWindowMs || pubMs > ts + 3_600_000) continue;
      const fullBody = [item.fullText || item.title || item.headline || '', item.summary || '']
        .filter(Boolean)
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim();
      if (!fullBody) continue;
      const trustTier = Number(item.trustTier || 2);
      const hasInlineTier1 = VERIFIED_TIER1_REPORTER_NAMES_RE.test(
        `${item.author || ''} ${item.reporterName || ''} ${fullBody}`
      );
      const isOfficial =
        (typeof item.outletId === 'string' && /_official$/i.test(item.outletId)) ||
        item.wireSource === 'official_transactions' ||
        item.wireSource === 'espn_player_wire' ||
        item.wireSource === 'rotowire_rss';
      if (trustTier > 1 && !hasInlineTier1 && !isOfficial) continue;
      if (!doesClauseMentionPlayer(fullBody, playerName, { allowSurname: true, sharedSurnames: sharedSet })) {
        continue;
      }
      chronItems.push({ pubMs, fullBody });
    }
    chronItems.sort((a, b) => a.pubMs - b.pubMs);

    for (const { pubMs, fullBody } of chronItems) {
      const scoped = scopeBeatTextToPlayer(fullBody, playerName, rosterPlayerNames);
      if (!scoped) continue;
      const normScoped = stripInitialAndHonorificDots(scoped);
      if (
        /\b(?:placed\b[^.;]{0,55}\bon\s+(?:the\s+)?injured\s+reserve|season-ending|out\s+for\s+the\s+season|activated\b[^.;]{0,70}\bfrom\s+(?:the\s+)?(?:injured\s+reserve|ir\b|pup\b))\b/i.test(
          normScoped
        ) &&
        !/\b(?:not|n't|wasn't|didn't|won't|if|whether|since)\b[^.;]{0,28}\bactivated\b/i.test(normScoped) &&
        !/\bhas\s+been\s+on\s+(?:ir|injured\s+reserve)\s+since\b/i.test(normScoped)
      ) {
        openedAtMs = null;
        leadNote = '';
        continue;
      }
      if (
        /\b(?:designated\b[^.;]{0,80}\b(?:to|for)\s+return\s+from|opened\s+(?:the\s+|his\s+)?(?:[a-z0-9' -]{0,36}\s+)?(?:21-day\s+|injured\s+reserve\s+|ir\s+|pup\s+)?practice\s+window|21-day\s+(?:practice\s+)?window\s+(?:has\s+been\s+|was\s+|is\s+)?opened)\b/i.test(
          normScoped
        ) &&
        !/\b(?:not|n't|could|might|may|hopeful\s+to|plan\s+to|expect\s+to|won't|will\s+not|aren't|isn't)\s+(?:be\s+)?open/i.test(
          normScoped
        ) &&
        !hasWindowDefinitelyNotOpeningSignal(normScoped)
      ) {
        if (openedAtMs === null) {
          openedAtMs = pubMs;
          leadNote = scoped;
        }
      }
    }
  }

  if (openedAtMs !== null) {
    return {
      isOpen: true,
      designatedDateIso: new Date(openedAtMs).toISOString(),
      leadNote
    };
  }

  const abbrUpper = String(fantasyStatusAbbr || '').toUpperCase();
  const curWk = Number(currentWeek || 1);
  const minEligWk = Number.isFinite(Number(earliestEligibleWeek)) && Number(earliestEligibleWeek) > 0
    ? Number(earliestEligibleWeek)
    : 1;

  const hasRecentPostMinimumPractice =
    (abbrUpper === 'IR-R' || abbrUpper === 'PUP-R') &&
    curWk >= minEligWk &&
    Array.isArray(weeklyHistory) &&
    weeklyHistory.some(h => {
      const wk = Number(h?.week || 0);
      return (
        wk >= minEligWk &&
        curWk - wk >= 0 &&
        curWk - wk <= 3 &&
        /\b(?:limited|full|^lp$|^fp$)\b/i.test(String(h?.practiceStatus || '').trim())
      );
    });

  const hasExplicitOpenWindowProse =
    curWk >= minEligWk &&
    !hasWindowDefinitelyNotOpeningSignal(noteStr) &&
    !/\bnot\s+(?:yet\s+)?ready\s+to\s+return\s+to\s+practice\b/i.test(noteStr) &&
    (/\b(?:had\s+his\s+21-day\s+practice\s+window\s+opened|21-day\s+practice\s+window\s+(?:was\s+|is\s+|has\s+been\s+)?opened)\b/i.test(
      noteStr
    ) ||
      ((abbrUpper === 'IR-R' || abbrUpper === 'PUP-R') &&
        /\b(?:upgraded\s+to\s+a\s+full\s+practice\s+session\s+friday|trio\s+of\s+(?:full|limited)\s+practices|three\s+(?:full|limited)\s+practices)\b/i.test(
          noteStr
        )));

  if (hasRecentPostMinimumPractice || hasExplicitOpenWindowProse) {
    return {
      isOpen: true,
      designatedDateIso: null,
      leadNote: ''
    };
  }

  return { isOpen: false, designatedDateIso: null, leadNote: '' };
}

function hasNegativePlayConsensusSignal(beatNote = '') {
  if (!beatNote) return false;
  return /\b(?:long shot|unlikely to (?:play|suit up|be activated|be ready|go)|(?:not|n't|no longer|hardly)\s+(?:expected to (?:play|suit up|be ready|be activated)|expecting\b[^.;]{0,42}\b(?:this week|to play|to be ready|to suit up)|on track to (?:play|suit up)|likely to (?:play|be activated)|good to go)|(?:not\s+traveling|won['’]?t\s+travel|will\s+not\s+travel|not\s+making\s+the\s+trip|hospitalized|admitted\s+to\s+(?:a|the)\s+hospital))\b/i.test(
    beatNote
  );
}

export function hasTrendingDownwardSignal(beatNote = '') {
  if (!beatNote) return false;
  const norm = stripInitialAndHonorificDots(beatNote);
  const setbackScrubbed = norm.replace(
    /\b(?:no|without\s+(?:a|any)|avoid(?:ed|ing)?\s+(?:a|any)|didn['’]?t\s+(?:suffer|have)\s+(?:a|any)|not\s+(?:a|any))\s+setbacks?\b/gi,
    'clear'
  );
  return /\b(?:trending\s+(?:down(?:ward)?|in\s+the\s+wrong\s+direction|toward\s+(?:missing|sitting\s+out|being\s+out|not\s+playing|being\s+inactive))|(?:moving|heading|pointing)\s+in\s+the\s+wrong\s+direction|(?:not|less|no\s+longer)\s+(?:optimistic|encouraged|confident|promising)|pessimistic|not\s+looking\s+(?:good|promising|great)|(?:doesn['’]?t|does\s+not)\s+(?:look|seem)\s+(?:good|promising|likely)|(?:facing|faces?)\s+an?\s+uphill\s+battle|uphill\s+battle\s+to\s+(?:play|suit\s+up|go|be\s+ready)|leaning\s+toward\s+(?:missing|sitting\s+out|not\s+playing|holding\s+him\s+out|sitting)|(?:suffered|had|experienced|dealt\s+with)\s+a\s+setback|setback\s+(?:at|in|during)\s+practice|re-?aggravat(?:ed|ing)|tweaked\s+(?:his|the)\b[^.;]{0,30}\b(?:again|at\s+practice|in\s+practice)|feeling\s+worse|hard\s+to\s+see\s+him\s+(?:playing|suiting\s+up)|(?:will|going\s+to)\s+be\s+tough\s+for\s+him\s+to\s+play|slim\s+chance|added\s+to\s+(?:the\s+)?injury\s+report\s+(?:friday|saturday|late)|downgraded\s+to\s+(?:questionable|doubtful)|not\s+trending\s+(?:up(?:ward)?|in\s+the\s+right\s+direction))\b/i.test(
    setbackScrubbed
  );
}

export function hasTrendingUpwardSignal(beatNote = '') {
  if (
    !beatNote ||
    hasNegativePlayConsensusSignal(beatNote) ||
    hasTrendingDownwardSignal(beatNote) ||
    hasDefiniteIrNonActivationOrWindowClosedSignal(beatNote)
  ) {
    return false;
  }
  const norm = stripInitialAndHonorificDots(beatNote);
  if (
    /\b(?:if|whether|unless)\s+(?:he|they)\s+(?:is|are|were)\s+(?:trending|optimistic|feeling\s+better)\b/i.test(norm)
  ) {
    return false;
  }
  return /\b(?:trending\s+(?:up(?:ward)?|in\s+the\s+right\s+direction|toward\s+(?:playing|suiting\s+up|returning|being\s+active|being\s+available|making\s+(?:his\s+)?return))|(?:moving|heading|pointing)\s+in\s+the\s+right\s+direction|pointing\s+toward\s+(?:playing|suiting\s+up|returning)|optimistic\s+(?:about|that|he(?:['’]?ll|\s+will|\s+can)|to\s+(?:play|suit\s+up|go|return))|encouraged\s+(?:by|about)|encouraging\s+signs?|leaning\s+toward\s+(?:playing|suiting\s+up|being\s+active|going)|(?:has|have|looking\s+like)\s+a\s+(?:good|strong|solid|realistic|decent)\s+chance\s+(?:(?:to|of|at)\s+(?:play|playing|suit|suiting|return|returning|be(?:ing)?\s+(?:available|active))|(?:that\s+)?he(?:\s+will|['’]?ll|\s+can)?\s+(?:play|suit\s+up|return|be\s+(?:available|active)))|(?:good|decent)\s+chance\s+(?:he\s+)?(?:plays|suits\s+up|returns|will\s+(?:play|suit\s+up|return|be\s+available))|making\s+(?:good|solid|steady|encouraging|significant)\s+progress|expect(?:s|ed|ing)?\b[^.;]{0,36}\bto\s+make\s+progress|progressing\s+well|feeling\s+(?:much\s+|a\s+lot\s+)?better|looks?\s+(?:good|promising|like\s+he(?:['’]?ll|\s+will)\s+(?:play|suit\s+up|go))|confident\b[^.;]{0,36}\b(?:play|suit\s+up|good\s+to\s+go|ready|available))\b/i.test(
    norm
  );
}

const OBSERVED_PRACTICE_RETURN_NEGATION_RE =
  /\b(?:not\s+practicing|isn['’]?t\s+practicing|wasn['’]?t\s+practicing|did\s+not\s+practice|didn['’]?t\s+practice|did\s+not\s+participate|didn['’]?t\s+participate|non-participant|not\s+participating|no\s+practice\s+for|won['’]?t\s+practice|will\s+not\s+practice|missed\s+(?:(?:wednesday|thursday|friday|today)['’]?s\s+)?practice|held\s+out\s+of\s+(?:(?:wednesday|thursday|friday|today)['’]?s\s+)?practice|was\s+an\s+observer|observer\s+(?:for|at)|watching\s+from\s+the\s+sideline|(?:not|n['’]?t|never)\s+(?:suited\s+up|in\s+uniform|back\s+(?:at|on|in)\s+(?:the\s+)?practice|return(?:ed|ing)?\s+to\s+(?:the\s+)?practice)|(?:hasn['’]?t|has\s+not|yet\s+to)\s+return(?:ed)?\s+to\s+(?:the\s+)?practice)\b/i;

const OBSERVED_PRACTICE_RETURN_SPECULATIVE_RE =
  /\b(?:assuming\b|if\s+(?:he|they|[a-z'.-]{2,20})\s+(?:is|are|can|could|manages?|logs?|practices?|participates?|returns?|suits?\s+up)|whether\s+(?:he|they|[a-z'.-]{2,20})|unless\s+(?:he|they)|there['’]?s\s+a\s+chance|chance\s+(?:to|of|at|he|they)\b|hoping\b[^.;]{0,55}\bpractice|hopes?\b[^.;]{0,55}\bpractice|hopeful\b[^.;]{0,55}\bpractice|expect(?:s|ed|ing)?\b[^.;]{0,65}\b(?:back\s+(?:at|to|in)\s+practice|to\s+practice|return\s+to\s+practice)|on\s+track\s+to\s+(?:return\s+to\s+practice|practice|be\s+back\s+(?:at|to)\s+practice)|plan(?:s|ning)?\s+to\b[^.;]{0,45}\bpractice|scheduled\s+to|slated\s+to|projected\s+to|trying\s+to|looking\s+to|aiming\s+to|needs?\s+to|(?:could|might|may|would|should)\s+(?:be\s+(?:a\s+)?(?:limited|full)|log|practice|participate|return\s+to\s+practice|suit\s+up)|will\s+(?:likely\s+|probably\s+)?(?:practice|participate|return\s+to\s+practice|be\s+(?:a\s+)?(?:limited|full)|log))\b/i;

const OBSERVED_PRACTICE_RETURN_FACTUAL_RE =
  /\b(?:limited\s+(?:today\s+)?(?:at|in)\s+[a-z'’]*\s*practice|limited\s+practice\s+participant|limited\s+participant|practiced\s+(?:on\s+a\s+limited\s+basis|in\s+a\s+limited\s+(?:capacity|role))|upgraded\s+to\s+(?:a\s+)?(?:limited|full)|back\s+(?:on\s+the\s+practice\s+field|at\s+practice|in\s+practice)|returned\s+to\s+(?:the\s+)?practice(?:\s+field)?|practiced\s+(?:in\s+full|fully|today|wednesday|thursday|friday)|full\s+participant|(?:is|was|spotted)\s+(?:suited\s+up\s+for|in\s+uniform\s+(?:at|for)|participating\s+in|taking\s+part\s+in|back\s+on\s+the\s+(?:practice\s+)?field\s+for)\s+(?:[a-z0-9'’ -]{0,28}\s+)?practice|\b(?:is|was|spotted)\s+practicing\s+(?:today|wednesday|thursday|friday|at\s+practice|in\s+practice|on\s+the\s+side\s*lines?|on\s+the\s+side\s+field|with\s+(?:the\s+team|teammates))|\bpracticing\s+(?:today|wednesday|thursday|friday|on\s+the\s+side\s*lines?)\b)\b/i;

/**
 * Detects factual, non-speculative, present/past-tense beat observations of a player actively
 * returning to on-field or sideline practice (e.g., "is suited up for Thursday's practice",
 * "Mike Evans returned to practice", "practicing today / on the sideline") evaluated sentence-by-sentence
 * so a conditional follow-up sentence ("Assuming he logs a limited practice...") never erases a factual lead.
 */
export function hasObservedPracticeReturnSignal(beatNote = '') {
  if (!beatNote || hasNegativePlayConsensusSignal(beatNote) || hasDefiniteIrNonActivationOrWindowClosedSignal(beatNote)) {
    return false;
  }
  const norm = stripInitialAndHonorificDots(beatNote);
  const sentences = norm
    .split(/(?:[.!?]+|\n+)/)
    .map(s => s.trim())
    .filter(Boolean);
  for (const sent of sentences) {
    if (OBSERVED_PRACTICE_RETURN_NEGATION_RE.test(sent)) continue;
    if (OBSERVED_PRACTICE_RETURN_SPECULATIVE_RE.test(sent)) continue;
    if (OBSERVED_PRACTICE_RETURN_FACTUAL_RE.test(sent)) {
      return true;
    }
  }
  return false;
}

function hasNegativePracticeExpectationSignal(beatNote = '') {
  if (!beatNote) return false;
  return /\b(?:unlikely to (?:participate in |take part in )?practice|(?:not|n't)\s+expected to (?:participate in |take part in )?practice|won't (?:take part in |participate in )?practice|will not (?:participate in |take part in )?practice|questionable at best|still on hold)\b/i.test(
    beatNote
  );
}

function hasExpectedPracticeReturnSignal(beatNote = '') {
  if (!beatNote || hasNegativePlayConsensusSignal(beatNote) || hasNegativePracticeExpectationSignal(beatNote) || hasWindowDefinitelyNotOpeningSignal(beatNote)) {
    return false;
  }
  // Reject vague/speculative phrasing ("getting close", "could return", "might practice")
  // and explicitly hedged uncertainty ("not sure yet", "would only go so far", "see if he can", "if <player> is able to practice")
  if (
    /\b(?:could|might|may|possibly|perhaps|wonder if|getting close)\b[^.;]{0,28}\b(?:return|back|practice|open)\b/i.test(beatNote) ||
    /\b(?:not sure yet|would only go so far|see if he can|if [a-z'. -]{1,28} (?:is able|can|manages) to practice)\b/i.test(beatNote)
  ) {
    return false;
  }
  return /\b(?:hopeful to (?:get|have)\b[^.;]{0,55}\bback (?:to|at) practice|expect(?:s|ed|ing)?\b[^.;]{0,55}\b(?:to be )?back (?:to|at) practice|expect(?:s|ed|ing)?\s+to\s+practice|on track to return to practice|hopes? to have\b[^.;]{0,45}\b(?:back )?at practice|expected back\b[^.;]{0,25}(?:at practice|wednesday|this week)|(?:plan|plans|planning|expect|expects|expecting|set|slated)\s+to\s+open\b[^.;]{0,55}\bpractice window)\b/i.test(
    beatNote
  );
}

function hasAffirmativePlayOrActivationSignal(beatNote = '') {
  if (!beatNote || hasNegativePlayConsensusSignal(beatNote) || hasTrendingDownwardSignal(beatNote) || hasDefiniteIrNonActivationOrWindowClosedSignal(beatNote)) return false;
  if (/\b(?:if|whether|unless|assuming)\s+(?:he|they)\s+(?:is|are|were)\s+(?:good to go|ready to go|able to play)\b/i.test(beatNote)) {
    return false;
  }
  return /\b(?:expected to play|on track to play|expected to suit up|plan(?:s|ning)? to play|set to play|will play\s+(?:sunday|monday|thursday|saturday|today|in\s+week|against|versus|vs\.?)|(?:good|ready)\s+to\s+go(?:\s+(?:for|on|sunday|monday|thursday|saturday|today|against|vs\.?))?|likely will be activated|expected to be activated|on track to be activated|good chance to be activated|plan(?:s|ning)? to activate)\b/i.test(
    beatNote
  );
}

const VERIFIED_TIER1_REPORTER_NAMES_RE =
  /\b(matt barrows|matt maiocco|nick wagoner|david lombardi|cam inman|eric branch|vic tafur|jennifer lee chan|sam warren|noah furtado|harrison rich|adam schefter|ian rapoport|tom pelissero|mike garafolo|jeremy fowler|dianna russini|jay glazer|albert breer|briana jeannel)\b/i;

const SPECULATIVE_CLAUSE_GUARD_RE =
  /\b(could activate|might activate|could return|might return|wonder if|speculat|rumor|my guess|would make sense|should consider|shouldn't rush|why the 49ers|if he (?:can't|cannot|is forced|misses)|candidates? to (?:see|draw|replace)|in line for more|fantasy|waiver wire|start\/sit|lineup)\b/i;

function canonicalReporterDedupeKey(item = {}, clauseText = '') {
  const inlineMatch = String(clauseText || item?.fullText || item?.title || '').match(VERIFIED_TIER1_REPORTER_NAMES_RE);
  if (inlineMatch) {
    return inlineMatch[1].toLowerCase().replace(/\s+/g, '_');
  }
  const linkedUrl = String(item?.externalUrl || item?.url || '')
    .toLowerCase()
    .replace(/^https?:\/\/(?:www\.)?/, '')
    .replace(/[?#].*$/, '')
    .replace(/\/+$/, '');
  if (linkedUrl && !linkedUrl.startsWith('bsky.app/') && !linkedUrl.startsWith('x.com/') && !linkedUrl.startsWith('twitter.com/')) {
    return `url_${linkedUrl}`;
  }
  if (item?.reporterId && !/^(?:kyle_shanahan|john_lynch|49ers_beat)$/i.test(item.reporterId)) {
    return String(item.reporterId).toLowerCase();
  }
  const authorClean = String(item?.author || item?.reporterName || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '');
  if (authorClean && !/^(?:kyle_shanahan|john_lynch|espn|49ers_beat_wire|rotowire_nfl_beat)$/.test(authorClean)) {
    return authorClean;
  }
  return String(item?.outletId || item?.wireSource || item?.id || 'wire').toLowerCase();
}

/**
 * Assembles the complete deduplicated text body for `item` pertaining to `playerName` / `playerId`,
 * including `externalTitle` / `externalDescription` (social link cards), `playerSnippet`,
 * `playerSnippets[playerId]`, and any cross-referenced `playerSnippets` entry that explicitly names
 * `playerName` in full (e.g., `"Prysock went in for Renardo Green after Green left with a back injury"`).
 */
export function assemblePlayerNewsItemText(item = {}, playerName = '', playerId = '') {
  if (!item || typeof item !== 'object') {
    return { primaryLead: '', secondaryText: '', fullBody: '' };
  }
  const pidStr = playerId != null ? String(playerId) : '';
  const primaryLead = String(item.fullText || item.title || item.headline || '').trim();
  const extraParts = [
    item.summary,
    item.externalTitle,
    item.externalDescription,
    item.playerSnippet,
    pidStr && item.playerSnippets ? item.playerSnippets[pidStr] : ''
  ];
  if (playerName && item.playerSnippets && typeof item.playerSnippets === 'object') {
    for (const [k, v] of Object.entries(item.playerSnippets)) {
      if (k === pidStr || !v) continue;
      if (doesClauseMentionPlayer(String(v), playerName, { allowSurname: false })) {
        extraParts.push(v);
      }
    }
  }
  const seenPrefixes = new Set();
  if (primaryLead) {
    seenPrefixes.add(primaryLead.toLowerCase().replace(/\s+/g, ' ').slice(0, 36));
  }
  const dedupedSecondary = [];
  for (const rawPart of extraParts) {
    const cleanPart = String(rawPart || '').trim();
    if (!cleanPart) continue;
    const prefix = cleanPart.toLowerCase().replace(/\s+/g, ' ').slice(0, 36);
    if (prefix && seenPrefixes.has(prefix)) continue;
    if (primaryLead && primaryLead.toLowerCase().includes(prefix) && prefix.length >= 24) continue;
    if (prefix) seenPrefixes.add(prefix);
    dedupedSecondary.push(cleanPart);
  }
  const ensureSentenceTerminal = seg => {
    const cleaned = String(seg || '')
      .replace(/\s*\.\.(?!\.)\s*/g, '. ')
      .replace(/\s+/g, ' ')
      .trim();
    if (!cleaned) return '';
    return /[.!?:"”’)]$/.test(cleaned) ? cleaned : `${cleaned}.`;
  };
  const secondaryText = dedupedSecondary.map(ensureSentenceTerminal).filter(Boolean).join(' ').trim();
  const fullBody = [ensureSentenceTerminal(primaryLead), secondaryText]
    .filter(Boolean)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
  return { primaryLead, secondaryText, fullBody };
}

/**
 * Extracts a clean canonical NFL injury body-part/diagnosis label from player-scoped medical prose,
 * guarding homonyms (`back`, `hand`, `foot`, `hip`, `neck`) against non-medical football idioms.
 */
export function extractInjuryBodyPartFromProse(rawText = '', fallbackInjury = '') {
  const text = String(rawText || '').trim();
  if (!text) return String(fallbackInjury || '').trim();

  // 1. Explicit parenthetical body-part tag: e.g. "Green (back)", "Evans (Achilles)", "West (knee)"
  const parenMatches = [...text.matchAll(/\(\s*([a-zA-Z][a-zA-Z /,-]{2,26})\s*\)/g)];
  for (const pm of parenMatches) {
    const cand = pm[1].trim();
    if (
      /\b(?:back|lower back|upper back|lower[- ]leg|upper[- ]leg|right\s+leg|left\s+leg|leg|fibula|tibia|hamstring|achilles|high[- ]ankle|ankle|meniscus|mcl|acl|pcl|knee|shoulder|pectoral|pec|groin|adductor|calf|quad|quadriceps|hip|oblique|rib|ribs|wrist|thumb|hand|finger|elbow|neck|concussion|foot|turf toe|toe|collarbone|clavicle|shin|illness)\b/i.test(
        cand
      ) &&
      !/\b(?:solo|tackle|yard|target|catch|carry|touchdown|sack|int|fumble|paywall)\b/i.test(cand)
    ) {
      if (/^achilles$/i.test(cand)) return 'Achilles';
      if (/^mcl$/i.test(cand)) return 'Knee - MCL';
      if (/^pcl$/i.test(cand)) return 'Knee - PCL';
      if (/^acl$/i.test(cand)) return 'Knee - ACL';
      if (/^lower[- ]leg$/i.test(cand)) return 'Lower Leg';
      return cand.charAt(0).toUpperCase() + cand.slice(1);
    }
  }

  // 2. Specific compound & high-precision medical diagnoses
  if (/\bconcussion\b/i.test(text)) return 'Concussion';
  if (/\bachilles\b/i.test(text)) return 'Achilles';
  if (/\bhigh[- ]ankle\b/i.test(text)) return 'High Ankle';
  if (/\bmeniscus\b/i.test(text)) return 'Knee - Meniscus';
  if (/\bmcl\b/i.test(text)) return 'Knee - MCL';
  if (/\bpcl\b/i.test(text)) return 'Knee - PCL';
  if (/\bacl\b/i.test(text)) return 'Knee - ACL';
  if (/\bturf\s+toe\b/i.test(text)) return 'Toe';
  if (/\bpectoral\b|\bpec\s+(?:injury|tear|strain)\b/i.test(text)) return 'Pectoral';
  if (/\bhamstring\b/i.test(text)) return 'Hamstring';
  if (/\bquadriceps\b|\bquad\s+(?:injury|strain|contusion|issue|tightness)\b/i.test(text)) return 'Quadriceps';
  if (/\bgroin\b|\badductor\b/i.test(text)) return 'Groin';
  if (/\bcalf\b/i.test(text)) return 'Calf';
  if (/\boblique\b/i.test(text)) return 'Oblique';
  if (/\bcollarbone\b|\bclavicle\b/i.test(text)) return 'Collarbone';
  if (/\bfibula\b|\btibia\b|\blower[- ]leg\b/i.test(text)) return 'Lower Leg';
  if (
    /\b(?:right\s+|left\s+|upper\s+)?leg\s+(?:injur\w*|fracture|break|cast|splint|brace|wrap|issue|pain|soreness|strain|rolled|trapped|deformed)\b|\b(?:air\s*cast|cast|splint)\s+(?:(?:placed|put|going|fitted|applied)\s+)?(?:on|around|over)\s+(?:his\s+)?(?:right\s+|left\s+|lower\s+|upper\s+)?leg\b|\b(?:injured|hurt|broke|fractured|grabbing|clutching|rolled\s+up\s+on)\s+(?:at\s+)?(?:his\s+)?(?:right\s+|left\s+|lower\s+|upper\s+)?leg\b|\b(?:left|exited|carted\s+off|out)\s+(?:[\w' -]{0,24}\s+)?(?:with|w\/)\s*(?:a|an|his)\s+(?:right\s+|left\s+|lower\s+|upper\s+)?leg\b/i.test(
      text
    )
  ) {
    return 'Leg';
  }
  if (/\bshin\b/i.test(text)) return 'Shin';
  if (/\bankle\b/i.test(text)) return 'Ankle';
  if (/\bknee\b|\bpatellar\b/i.test(text)) return 'Knee';
  if (/\bshoulder\b/i.test(text)) return 'Shoulder';
  if (/\bwrist\b/i.test(text)) return 'Wrist';
  if (/\bthumb\b/i.test(text)) return 'Thumb';
  if (/\belbow\b/i.test(text)) return 'Elbow';
  if (/\bribs?\s+(?:injury|fracture|cartilage|issue|soreness|bruise)\b|\b(?:injured|hurt|bruised|fractured)\s+(?:his\s+)?ribs?\b/i.test(text)) {
    return 'Ribs';
  }
  if (
    /\b(?:lower\s+|upper\s+)?back\s+(?:injur\w*|spasms?|tightness|stiffness|pain|soreness|issue|problem|strain|flare[- ]?up|aggravation)\b|\b(?:left|exited|departed|dealing|playing|finish(?:\s+[\w' -]{0,20})?)\s+(?:[\w' -]{0,28}\s+)?(?:with|w\/)\s*(?:a|an|his|the(?:\s+same)?)\s+(?:lower\s+|upper\s+)?back\b|\b(?:injured|hurt|aggravated|re-aggravated|tweaked)\s+(?:his\s+)?(?:lower\s+|upper\s+)?back\b/i.test(
      text
    )
  ) {
    return 'Back';
  }
  if (
    /\bfoot\s+(?:injur\w*|sprain|fracture|strain|soreness|issue|surgery)\b|\b(?:left|exited|finish(?:\s+[\w' -]{0,20})?)\s+(?:with|w\/)\s*(?:a|an|his|the(?:\s+same)?)\s+foot\b|\b(?:injured|hurt|aggravated)\s+(?:his\s+)?foot\b/i.test(
      text
    )
  ) {
    return 'Foot';
  }
  if (
    /\bhip\s+(?:injur\w*|flexor|pointer|strain|soreness|issue|tightness)\b|\b(?:left|exited|finish(?:\s+[\w' -]{0,20})?)\s+(?:with|w\/)\s*(?:a|an|his|the(?:\s+same)?)\s+hip\b|\b(?:injured|hurt|aggravated)\s+(?:his\s+)?hip\b/i.test(
      text
    )
  ) {
    return 'Hip';
  }
  if (
    /\bhand\s+(?:injur\w*|fracture|surgery|issue|sprain)\b|\b(?:left|exited|finish(?:\s+[\w' -]{0,20})?)\s+(?:with|w\/)\s*(?:a|an|his)\s+hand\b|\b(?:injured|hurt|broke|fractured)\s+(?:his\s+)?hand\b/i.test(
      text
    )
  ) {
    return 'Hand';
  }
  if (/\bfinger\s+(?:injur\w*|fracture|dislocation|issue)\b|\b(?:injured|hurt|dislocated|broke)\s+(?:his\s+|a\s+)?finger\b/i.test(text)) {
    return 'Finger';
  }
  if (/\bneck\s+(?:injur\w*|stinger|spasms?|strain|soreness|issue)\b|\b(?:injured|hurt)\s+(?:his\s+)?neck\b/i.test(text)) {
    return 'Neck';
  }
  if (/\btoe\s+(?:injur\w*|fracture|sprain|issue)\b|\b(?:injured|hurt)\s+(?:his\s+)?toe\b/i.test(text)) {
    return 'Toe';
  }
  if (/\billness\b/i.test(text)) return 'Illness';

  return String(fallbackInjury || '').trim();
}

/**
 * Evaluates recent news/beat items for a specific player using:
 *  1. Strict post-prior-game recency window (`windowStartMs`, plus `lastCompletedGameKickoffMs` for in-game/post-game acute exits)
 *  2. Clause-level per-player scoping (`scopeBeatTextToPlayer`) so multi-player tweets never cross-contaminate
 *  3. Source reliability weighting + speculation rejection (`trustTier >= 3` or speculative modals = 0 weight)
 *  4. Reporter & canonical-article-URL deduplication (so promo link-tweets or echoes count once, not 2-3x)
 *  5. Return-to-game chronological cancellation (so brief Q1 blue-tent visits followed by returning to play never false-positive)
 *  6. Diminishing-returns Bayesian confidence `1 - Π(1 - w_i)` so one speculative note never overcorrects
 */
const NEWS_ITEM_SIGNAL_CACHE = new WeakMap();

function getNewsItemSignalFastMeta(item) {
  const pubKey = String(item.publishedAt || '');
  const leadStr = String(item.fullText || item.title || item.headline || '');
  const snipCount = item.playerSnippets && typeof item.playerSnippets === 'object' ? Object.keys(item.playerSnippets).length : 0;
  const mpCount = Array.isArray(item.mentionedPlayers) ? item.mentionedPlayers.length : 0;
  const cached = NEWS_ITEM_SIGNAL_CACHE.get(item);
  if (
    cached &&
    cached.pubKey === pubKey &&
    cached.leadLen === leadStr.length &&
    cached.snipCount === snipCount &&
    cached.mpCount === mpCount
  ) {
    return cached;
  }
  const pubMs = parseFlexibleIsoMs(pubKey);
  const snipVals =
    snipCount > 0 ? Object.values(item.playerSnippets).filter(Boolean).join(' ') : '';
  const rawHaystackLower = `${leadStr} ${item.summary || ''} ${item.externalTitle || ''} ${item.externalDescription || ''} ${item.playerSnippet || ''} ${snipVals}`
    .replace(/[’‘]/g, "'")
    .toLowerCase();
  const mentionedSet =
    mpCount > 0
      ? new Set(item.mentionedPlayers.map(mp => stripGenerationalSuffix(mp?.name || '').toLowerCase()).filter(Boolean))
      : null;
  const meta = { pubKey, leadLen: leadStr.length, snipCount, mpCount, pubMs, rawHaystackLower, mentionedSet };
  NEWS_ITEM_SIGNAL_CACHE.set(item, meta);
  return meta;
}

export function evaluateCorroboratedNewsInjurySignal({
  playerName = '',
  playerId = '',
  rosterBucket = 'active',
  newsItems = [],
  rosterPlayerNames = [],
  sharedSurnames = null,
  nowMs = Date.now(),
  windowStartMs = null,
  lastCompletedGameKickoffMs = null,
  lastCompletedWeek = null,
  priorWeekInjuryType = ''
} = {}) {
  const empty = {
    hasSignal: false,
    signalType: null,
    direction: 0,
    confidence: 0,
    corroboratingCount: 0,
    hasCoachOrGmQuote: false,
    hasOfficialTxDesignation: false,
    hasOfficialActivationFromIr: false,
    hasWindowNotOpeningSignal: false,
    hasObservedPracticeReturn: false,
    observedPracticeReturnPubMs: 0,
    observedPracticeReturnText: '',
    inferredInjuryType: '',
    exitedWithoutReturn: false,
    isAggravation: false,
    isMultiWeekOrSurgery: false,
    latestPubMs: 0,
    leadClause: '',
    reporters: []
  };
  if (!playerName || !Array.isArray(newsItems) || newsItems.length === 0) return empty;

  const fiveDaysAgoMs = nowMs - 5 * 86_400_000;
  const postGameMinMs =
    Number.isFinite(windowStartMs) && windowStartMs > 0 ? Math.max(fiveDaysAgoMs, windowStartMs) : fiveDaysAgoMs;
  const inGameKickoffMinMs =
    Number.isFinite(lastCompletedGameKickoffMs) && lastCompletedGameKickoffMs > 0
      ? Math.max(fiveDaysAgoMs, lastCompletedGameKickoffMs + 5 * 60_000)
      : postGameMinMs;
  const scanFloorMs = Math.min(postGameMinMs, inGameKickoffMinMs);
  const completedWkNum =
    Number.isFinite(Number(lastCompletedWeek)) && Number(lastCompletedWeek) >= 1 ? Number(lastCompletedWeek) : null;

  const observationsByReporter = new Map();
  let hasOfficialTxDesignation = false;
  let hasOfficialActivationFromIr = false;
  let hasWindowNotOpeningSignal = false;
  let latestReturnToGameMs = 0;

  const sharedSet =
    sharedSurnames instanceof Set
      ? sharedSurnames
      : computeSharedRosterSurnames(rosterPlayerNames.map(nm => ({ name: nm })));
  const targetStrippedLower = stripGenerationalSuffix(playerName).toLowerCase();
  const targetMatcher = getCompiledPlayerClauseMatcher(String(playerName || '').replace(/[’‘]/g, "'").trim());

  for (const item of newsItems) {
    if (!item || item.isClickbait || item.type === 'video') continue;
    const itemMeta = getNewsItemSignalFastMeta(item);
    const pubMs = itemMeta.pubMs;
    if (pubMs === null || pubMs < scanFloorMs || pubMs > nowMs + 3_600_000) continue;

    const inMentionedList = Boolean(itemMeta.mentionedSet && itemMeta.mentionedSet.has(targetStrippedLower));
    if (
      !inMentionedList &&
      targetMatcher.surname.length >= 3 &&
      !itemMeta.rawHaystackLower.includes(targetMatcher.surname) &&
      !(targetMatcher.isDeebo && itemMeta.rawHaystackLower.includes('deebo')) &&
      !(targetMatcher.isCmc && itemMeta.rawHaystackLower.includes('cmc'))
    ) {
      continue;
    }

    const { fullBody } = assemblePlayerNewsItemText(item, playerName, playerId);
    if (!fullBody) continue;

    // Must actually mention this player (via structured mentionedPlayers or text match),
    // while strictly isolating `espn_pwire_<ownerId>_*` single-player blurbs to their owning player unless full-named!
    const itemIdStr = String(item.id || '');
    const pwireOwnerId = itemIdStr.startsWith('espn_pwire_')
      ? itemIdStr.split('_')[2] || ''
      : item.wireSource === 'espn_player_wire' && item.primaryPlayer?.id
        ? String(item.primaryPlayer.id)
        : '';
    const isPwireOwner = Boolean(pwireOwnerId && playerId && pwireOwnerId === String(playerId));
    const allowSurnameForSignal = !pwireOwnerId || isPwireOwner || inMentionedList;
    if (
      !inMentionedList &&
      !doesClauseMentionPlayer(fullBody, playerName, {
        allowSurname: allowSurnameForSignal,
        sharedSurnames: sharedSet,
        isPrimaryOwner: isPwireOwner
      })
    ) {
      continue;
    }

    const trustTierProbe = Number(item.trustTier || 2);
    const hasInlineTier1Probe = VERIFIED_TIER1_REPORTER_NAMES_RE.test(
      `${item.author || ''} ${item.reporterName || ''} ${fullBody}`
    );
    const isOfficialSourceProbe = /_official$/i.test(String(item.outletId || '')) || item.wireSource === 'official_transactions';
    const isTrustedWireProbe = item.wireSource === 'espn_player_wire' || item.wireSource === 'rotowire_rss';

    const scoped = scopeBeatTextToPlayer(fullBody, playerName, rosterPlayerNames);
    if (!scoped) continue;

    // Check official @49ers transaction wire or verified Tier-1 beat report for immediate 21-day return designation or 53-man IR activation
    if (
      pubMs >= postGameMinMs &&
      (isOfficialSourceProbe || trustTierProbe <= 1 || hasInlineTier1Probe) &&
      doesClauseMentionPlayer(fullBody, playerName)
    ) {
      const normScopedWin = stripInitialAndHonorificDots(scoped);
      if (
        /\b(?:designated\b[^.;]{0,80}\b(?:to|for)\s+return|opened\s+(?:the\s+|his\s+)?(?:[a-z0-9' -]{0,36}\s+)?(?:21-day\s+|injured\s+reserve\s+|ir\s+|pup\s+)?practice\s+window|21-day\s+(?:practice\s+)?window\s+(?:has\s+been\s+|was\s+|is\s+)?opened)\b/i.test(
          normScopedWin
        ) &&
        !/\b(?:not|n't|could|might|may|hopeful to|plan to|expect to|won't|will not|aren't|isn't)\s+(?:be\s+)?open/i.test(normScopedWin) &&
        !hasWindowDefinitelyNotOpeningSignal(normScopedWin)
      ) {
        hasOfficialTxDesignation = true;
      }
      if (
        /\bactivated\b[^.;]{0,70}\bfrom\s+(?:the\s+)?(?:injured\s+reserve|ir\b|pup\b)\b/i.test(normScopedWin) &&
        !/\b(?:not|n't|wasn't|didn't|won't|if|whether|could|might|may|expected\s+to\s+be|likely\s+to\s+be)\b[^.;]{0,25}\bactivated\b/i.test(
          normScopedWin
        )
      ) {
        hasOfficialActivationFromIr = true;
      }
    }

    // Speculation & low-credibility guard: reject blogs/opinion/rumors unless directly citing a verified Tier-1 beat reporter
    const trustTier = trustTierProbe;
    const hasInlineTier1 = hasInlineTier1Probe;
    const isOfficialSource = isOfficialSourceProbe;
    if (trustTier >= 3 && !hasInlineTier1 && !isOfficialSource && !isTrustedWireProbe) {
      continue;
    }

    // Detect if the player briefly visited the medical tent / sideline and RETURNED to the game unscathed.
    // Guard conditional/future next-game phrases ("will determine if he's cleared to return to action Sunday")
    // so midweek practice-return reports are NEVER discarded as in-game tent visits!
    const returnedToGameUnscathed =
      /\b(?:returned\s+(?:to\s+(?:the\s+game|action|play|the\s+field)|after\s+(?:a\s+)?(?:brief\s+)?(?:stint|trip|visit)\s+in\s+the\s+(?:blue\s+)?(?:medical\s+)?tent)|came\s+back\s+in(?:to\s+the\s+game)?|back\s+in\s+the\s+(?:game|lineup|huddle)|(?:was|is|has\s+been)\s+cleared\s+to\s+return(?!\s+(?:to\s+practice|for\s+(?:sunday|monday|thursday|saturday|week\s*\d+|next\s+week)))|did(?:n['’]?t|\s+not)\s+miss\s+a\s+snap)\b/i.test(
        scoped
      ) &&
      !/\b(?:if|whether|unless|determine\s+(?:if|whether)|could\s+be|might\s+be|may\s+be|expected\s+to\s+be|likely\s+to\s+be|hoping\s+to\s+be)\s+(?:he(?:'s|\s+is|\s+will\s+be)?\s+)?cleared\s+to\s+return\b/i.test(
        scoped
      ) &&
      !/\bcleared\s+to\s+return\s+(?:to\s+action\s+)?(?:on\s+)?(?:sunday|monday|thursday|saturday|next\s+week|week\s*\d+|versus|vs\.?|against)\b/i.test(
        scoped
      ) &&
      !/\b(?:did(?:n['’]?t|\s+not)\s+return|will\s+not\s+return|won['’]?t\s+return|left\s+again|re-aggravat|ruled\s+out\s+for\s+the\s+(?:rest|remainder))\b/i.test(
        scoped
      );
    if (returnedToGameUnscathed) {
      if (pubMs > latestReturnToGameMs) latestReturnToGameMs = pubMs;
      continue;
    }

    const activeCoachTeam = getActiveTeamConfig();
    const activeHc = String(activeCoachTeam?.coachesSeed?.hc || '').trim();
    const activeGm = String(activeCoachTeam?.coachesSeed?.gm || '').trim();
    const activeCoachNames = [
      activeHc,
      activeHc.split(/\s+/).slice(-1)[0],
      activeGm,
      activeGm.split(/\s+/).slice(-1)[0]
    ]
      .filter(n => n && n.length >= 4)
      .map(n => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    const coachLeaderPat = [
      'kyle shanahan',
      'coach shanahan',
      'shanahan',
      'head coach',
      'john lynch',
      'gm john lynch',
      ...activeCoachNames,
      'coach\\s+[a-z][a-z\'.-]{1,18}(?:\\s+[a-z][a-z\'.-]{1,18})?'
    ].join('|');
    const hasCoachQuote =
      new RegExp(
        `\\b(?:${coachLeaderPat})\\b[^.]{0,80}\\b(?:said|says|relayed|explained|announced|indicated|noted|told|expects?|hopeful|optimistic|encouraged|provided|revealed|reveals|confirms?|confirmed|ruled|rules|stated|shared|added|called)\\b|\\bper (?:head )?coach\\b`,
        'i'
      ).test(scoped) ||
      (new RegExp(
        `\\b(?:${coachLeaderPat})\\s+(?:said|confirms?|confirmed|ruled|provided\\s+an?\\s+injury\\s+update|reveals\\s+latest)\\b`,
        'i'
      ).test(fullBody) &&
        !SPECULATIVE_CLAUSE_GUARD_RE.test(scoped));

    if (!hasCoachQuote && SPECULATIVE_CLAUSE_GUARD_RE.test(scoped)) {
      continue;
    }

    // Sanitize historical week references ("issue he suffered in Week 9" when completedWkNum === 10) before acute-injury matching
    const sanitizedScopedForAcute = scoped.replace(
      /\b(?:sustained|suffered|picked\s+up|injured[\s\S]{0,24}?)\s+(?:back\s+)?in\s+week\s*(\d{1,2})\b/gi,
      (m, wkStr) => {
        const refWk = Number(wkStr);
        if (completedWkNum && Number.isFinite(refWk) && refWk < completedWkNum) {
          return 'prior week history';
        }
        return m;
      }
    );

    const hasNonReturnPhrase =
      /\b(?:did(?:n['’]?t|\s+not)\s+return|will\s+not\s+return|won['’]?t\s+return|unable\s+to\s+finish\s+(?:(?:sunday|monday|thursday|saturday|today|tonight|the|week\s*\d+)(?:['’]s)?\s+)?(?:game|contest|win|loss|matchup)|did(?:n['’]?t|\s+not)\s+finish\s+(?:(?:sunday|monday|thursday|saturday|today|tonight|the|week\s*\d+)(?:['’]s)?\s+)?(?:game|contest)|ruled\s+out\s+for\s+the\s+(?:rest|remainder)\s+of|out\s+for\s+the\s+(?:rest|remainder|game|night|day|season|year)(?:\s+of\s+(?:the|sunday|monday|thursday|saturday))?|done\s+for\s+the\s+(?:game|night|day|season|year)|season-ending)\b/i.test(
        sanitizedScopedForAcute
      ) && !/\breturn\s+(?:any\s+)?(?:punts?|kicks?|kickoffs?)\b/i.test(sanitizedScopedForAcute);

    const hasGameExitWithInjuryPhrase =
      /\b(?:left|exited|departed|forced\s+out(?:\s+of)?|unable\s+to\s+finish)\s+(?:(?:sunday|monday|thursday|saturday|today|tonight|the|week\s*\d+)(?:['’]s)?\s+(?:game|win|loss|victory|defeat|contest|matchup|tilt)(?:\s+(?:over|against|vs\.?)\s+[a-z .'-]{2,28})?\s+)?(?:(?:early|in\s+the\s+(?:first|second|third|fourth|1st|2nd|3rd|4th)\s+(?:half|quarter))\s+)?(?:with|w\/)\s*(?:a|an|his|the(?:\s+same)?)\s+[a-z -]{3,28}/i.test(
        sanitizedScopedForAcute
      ) ||
      /\b(?:exited|left\s+(?:sunday|monday|thursday|saturday|the)(?:['’]s)?\s+(?:game|win|loss|victory|defeat|contest|matchup|tilt)|forced\s+out\s+of\s+(?:sunday|monday|thursday|saturday|the)(?:['’]s)?\s+(?:game|contest)|limped\s+(?:off|to\s+the\s+locker\s+room)|carted\s+(?:off|to|away|from|back|into|down)|(?:onto|on|into)\s+(?:a|the)\s+(?:medical\s+)?cart|loaded\s+onto\s+(?:a|the)\s+(?:medical\s+)?cart|cart\s+(?:is\s+)?(?:coming\s+)?out|air\s*cast|splint\b|(?:headed|went|walked|taken|limped|helped|escorted)\s+(?:off\s+)?(?:to\s+the\s+locker\s+room|(?:into|to|down)\s+the\s+tunnel))\b/i.test(
        sanitizedScopedForAcute
      );

    const hasAcuteDiagnosisOrPodiumUpdate =
      /\b(?:(?:suffered|sustained|aggravated|re-aggravated)\s+(?:a|an|his|the\s+same)\s+(?:apparent\s+|possible\s+|suspected\s+|severe\s+|gruesome\s+|high[- ]ankle\s+|low[- ]ankle\s+|lower[- ]leg\s+|upper[- ]leg\s+|[a-z-]+\s+){0,2}(?:injur\w*|sprain\w*|strain\w*|tear|fracture|concussion|spasms?|back|hamstring|ankle|knee|leg|fibula|tibia|shin|shoulder|foot|groin|calf|quad\w*|achilles|hip|rib\w*|wrist|thumb|hand|elbow|neck|pectoral|oblique)|apparent\s+aggravation|(?:underwent|undergoing|scheduled\s+for|will\s+(?:have|undergo))\s+(?:an?\s+)?(?:mri|x-rays?|ct\s+scan|surgery)|evaluated\s+for\s+a\s+concussion|entered\s+(?:the\s+)?concussion\s+protocol)\b/i.test(
        sanitizedScopedForAcute
      ) ||
      (pubMs >= postGameMinMs &&
        /\b(?:only\s+(?:one\s+on\s+the\s+report(?:\s+today)?|reported\s+injury|injury|thing)\s+(?:we\s+had\s+)?(?:out\s+of|from)\s+(?:(?:sunday|monday|thursday|saturday|the)(?:['’]s)?\s+)?game|was\s+the\s+only\s+reported\s+injury\s+from\s+(?:kyle\s+)?shanahan|(?:shanahan|head\s+coach)[\s\S]{0,42}\bprovided\s+an?\s+injury\s+update\s+on)\b/i.test(
          sanitizedScopedForAcute
        ));

    const hasMidGameTentOrReturnCheck =
      pubMs < postGameMinMs &&
      /\b(?:questionable\s+to\s+return|doubtful\s+to\s+return|air\s*cast|cart\s+(?:is\s+)?(?:coming\s+)?out|loaded\s+onto\s+(?:a|the)\s+(?:medical\s+)?cart|rolled\s+up\s+on|(?:down|staying\s+down|remained\s+down)\s+on\s+(?:the\s+)?(?:field|turf|grass))\b/i.test(
        sanitizedScopedForAcute
      );

    const isSustainedInGameInjury =
      rosterBucket === 'active' &&
      (hasGameExitWithInjuryPhrase || hasNonReturnPhrase || hasAcuteDiagnosisOrPodiumUpdate || hasMidGameTentOrReturnCheck);

    // Non-in-game signals strictly require `pubMs >= postGameMinMs` so pre-kickoff Week N status tweets never leak into Week N+1!
    if (!isSustainedInGameInjury && pubMs < postGameMinMs) {
      continue;
    }

    let signalType = null;
    let direction = 0;

    const hasObservedNonPractice =
      pubMs >= postGameMinMs &&
      /\b(?:not practicing(?:\s+today)?|did not practice|didn't practice|did not participate|didn't participate|non-participant|not participating|no practice for|missed\s+(?:(?:wednesday|thursday|friday|today)['’]?s\s+)?practice|held out of\s+(?:(?:wednesday|thursday|friday|today)['’]?s\s+)?practice|was an observer|observer for|watching from the sideline)\b/i.test(
        scoped
      );
    const hasObservedPracticeReturn =
      pubMs >= postGameMinMs &&
      !hasObservedNonPractice &&
      hasObservedPracticeReturnSignal(scoped);
    const hasLateSetbackPhrase =
      pubMs >= postGameMinMs &&
      !/\b(?:no|without\s+(?:a|any)|avoid(?:ed|ing)?\s+(?:a|any)|didn['’]?t\s+(?:suffer|have)\s+(?:a|any))\s+(?:late[- ]week\s+|new\s+)?setbacks?\b/i.test(
        scoped
      ) &&
      /\b(?:(?:suffered|had|experienced|dealt\s+with|dealing\s+with|after|following)\s+(?:a|an)\s+(?:late[- ]week\s+|practice\s+|friday\s+|saturday\s+|minor\s+|new\s+)?setback|late[- ]week\s+setback|setback\s+(?:at|in|during)\s+practice|re-?aggravat(?:ed|ing)|tweaked\s+(?:his|the)\b[^.;]{0,30}\b(?:again|at\s+practice|in\s+practice)|added\s+to\s+(?:the\s+)?injury\s+report\s+(?:friday|saturday|late)|downgraded\s+to\s+(?:questionable|doubtful))\b/i.test(
        scoped
      );

    if (rosterBucket === 'ir' && hasWindowDefinitelyNotOpeningSignal(scoped)) {
      signalType = 'WINDOW_NOT_OPENING_THIS_WEEK';
      direction = -1.0;
      hasWindowNotOpeningSignal = true;
    } else if (rosterBucket === 'ir' && hasDefiniteIrNonActivationOrWindowClosedSignal(scoped)) {
      signalType = 'IR_NOT_ACTIVATING_THIS_WEEK';
      direction = -1.0;
    } else if (pubMs >= postGameMinMs && hasAffirmativeRuledOutSignal(scoped)) {
      signalType = 'RULED_OUT_WEEK';
      direction = -1.0;
    } else if (pubMs >= postGameMinMs && hasClearedConcussionProtocolSignal(scoped)) {
      signalType = 'CLEARED_CONCUSSION_PROTOCOL';
      direction = 0.92;
    } else if (pubMs >= postGameMinMs && hasNegativePlayConsensusSignal(scoped)) {
      signalType = 'UNLIKELY_THIS_WEEK';
      direction = -0.82;
    } else if (pubMs >= postGameMinMs && hasTrendingDownwardSignal(scoped)) {
      signalType = 'TRENDING_DOWNWARD';
      direction = hasLateSetbackPhrase ? -0.74 : -0.64;
    } else if (hasObservedNonPractice) {
      signalType = 'OBSERVED_DNP_PRACTICE';
      direction = -0.62;
    } else if (pubMs >= postGameMinMs && hasNegativePracticeExpectationSignal(scoped)) {
      signalType = 'UNLIKELY_WEDNESDAY_PRACTICE';
      direction = -0.58;
    } else if (pubMs >= postGameMinMs && hasAffirmativePlayOrActivationSignal(scoped)) {
      signalType = 'EXPECTED_TO_PLAY';
      direction = 0.80;
    } else if (pubMs >= postGameMinMs && hasTrendingUpwardSignal(scoped)) {
      signalType = 'TRENDING_UPWARD';
      direction = 0.56;
    } else if (hasObservedPracticeReturn) {
      signalType = 'OBSERVED_PRACTICE_RETURN';
      direction = 0.66;
    } else if (pubMs >= postGameMinMs && hasExpectedPracticeReturnSignal(scoped)) {
      signalType = 'EXPECTED_PRACTICE_RETURN';
      direction = 0.58;
    } else if (isSustainedInGameInjury) {
      signalType = 'SUSTAINED_IN_GAME_INJURY';
      direction = -0.45;
    } else if (
      rosterBucket === 'active' &&
      /\b(?:considered\s+day[-\s]+to[-\s]+day|is\s+(?:again\s+|still\s+)?day[-\s]+to[-\s]+day|neither has been ruled out|hasn't been ruled out|has not been ruled out)\b/i.test(
        scoped
      )
    ) {
      signalType = 'DAY_TO_DAY';
      direction = 0.25;
    }

    if (!signalType) continue;

    const extractedInj = extractInjuryBodyPartFromProse(scoped, priorWeekInjuryType);
    const obsExitedNoReturn = Boolean(hasGameExitWithInjuryPhrase || hasNonReturnPhrase);
    const obsIsAggravation =
      /\b(?:aggravat\w*|re-aggravat\w*|same\s+[a-z-]+\s+injury|already\s+playing\s+hurt)\b/i.test(scoped) ||
      Boolean(
        priorWeekInjuryType &&
          extractedInj &&
          extractedInj.toLowerCase().split(/[ -]/)[0] === priorWeekInjuryType.toLowerCase().split(/[ -]/)[0]
      );
    const obsIsMultiWeekOrSurgery =
      /\b(?:requires?\s+surgery|undergo(?:ing)?\s+surgery|scheduled\s+for\s+surgery|candidate\s+for\s+(?:injured\s+reserve|ir\b)|out\s+(?:multiple|several|[2-9]|two|three|four)\s+weeks|miss\s+(?:multiple|several|[2-9]|two|three|four)\s+weeks|high[- ]ankle\s+sprain|fracture[d]?|torn|broken)\b/i.test(
        sanitizedScopedForAcute
      ) && !/\b(?:doesn['’]?t|does\s+not|will\s+not|won['’]?t|avoided)\s+(?:require\s+|need\s+)?surgery\b/i.test(sanitizedScopedForAcute);

    let baseWeight = 0.18;
    if (isOfficialSource || isTrustedWireProbe) {
      baseWeight = signalType === 'SUSTAINED_IN_GAME_INJURY' ? 0.85 : 0.90;
    } else if (trustTier <= 1 || hasInlineTier1) {
      baseWeight =
        signalType === 'SUSTAINED_IN_GAME_INJURY'
          ? hasCoachQuote
            ? 0.72
            : 0.62
          : hasCoachQuote
            ? 0.60
            : 0.40;
    } else if (trustTier === 2) {
      baseWeight =
        signalType === 'SUSTAINED_IN_GAME_INJURY'
          ? hasCoachQuote
            ? 0.48
            : obsExitedNoReturn
              ? 0.34
              : 0.22
          : hasCoachQuote
            ? 0.36
            : 0.18;
    }

    const repKey = canonicalReporterDedupeKey(item, fullBody);
    const prev = observationsByReporter.get(repKey);
    if (!prev || pubMs > prev.pubMs || (pubMs === prev.pubMs && baseWeight > prev.weight)) {
      const samePolarityAsPrev = prev && Math.sign(prev.direction) === Math.sign(direction);
      const preferNewClause =
        !samePolarityAsPrev ||
        (hasCoachQuote && !prev.hasCoachQuote) ||
        (Boolean(extractedInj) && !prev.inferredInjuryType) ||
        (!prev.hasCoachQuote && scoped.length > (prev.scopedClause || '').length);
      observationsByReporter.set(repKey, {
        repKey,
        reporterLabel: item.author || item.reporterName || item.outletName || `${getActiveTeamConfig().nickname} Beat`,
        signalType: samePolarityAsPrev && prev.weight > baseWeight ? prev.signalType : signalType,
        direction: samePolarityAsPrev && Math.abs(prev.direction) > Math.abs(direction) ? prev.direction : direction,
        weight: samePolarityAsPrev ? Math.max(baseWeight, prev.weight) : baseWeight,
        hasCoachQuote: samePolarityAsPrev ? Boolean(hasCoachQuote || prev.hasCoachQuote) : hasCoachQuote,
        inferredInjuryType: extractedInj || (samePolarityAsPrev ? prev.inferredInjuryType : '') || '',
        exitedWithoutReturn: samePolarityAsPrev ? Boolean(obsExitedNoReturn || prev.exitedWithoutReturn) : obsExitedNoReturn,
        isAggravation: samePolarityAsPrev ? Boolean(obsIsAggravation || prev.isAggravation) : obsIsAggravation,
        hasLateSetback: samePolarityAsPrev ? Boolean(hasLateSetbackPhrase || prev.hasLateSetback) : hasLateSetbackPhrase,
        hasObservedPracticeReturn: samePolarityAsPrev
          ? Boolean(hasObservedPracticeReturn || prev.hasObservedPracticeReturn)
          : Boolean(hasObservedPracticeReturn),
        isMultiWeekOrSurgery: samePolarityAsPrev
          ? Boolean(obsIsMultiWeekOrSurgery || prev.isMultiWeekOrSurgery)
          : obsIsMultiWeekOrSurgery,
        isMidGameTentOnly: Boolean(hasMidGameTentOrReturnCheck && !hasGameExitWithInjuryPhrase && !hasNonReturnPhrase),
        pubMs,
        scopedClause: preferNewClause ? scoped : prev.scopedClause
      });
    }
  }

  // Prune any mid-game "questionable to return" observation that was superseded by a later return-to-game report!
  if (latestReturnToGameMs > 0) {
    for (const [rk, obs] of observationsByReporter.entries()) {
      if (obs.signalType === 'SUSTAINED_IN_GAME_INJURY' && obs.pubMs <= latestReturnToGameMs + 10 * 60_000) {
        observationsByReporter.delete(rk);
      }
    }
  }

  const obsList = [...observationsByReporter.values()].sort((a, b) => b.pubMs - a.pubMs);
  if (obsList.length === 0) {
    if (hasOfficialActivationFromIr) {
      return {
        ...empty,
        hasSignal: true,
        signalType: 'OFFICIAL_IR_ACTIVATED',
        direction: 0.95,
        confidence: 0.96,
        hasOfficialActivationFromIr: true
      };
    }
    return hasOfficialTxDesignation
      ? { ...empty, hasSignal: true, signalType: 'OFFICIAL_IR_WINDOW_OPEN', direction: 0.65, confidence: 0.95, hasOfficialTxDesignation: true }
      : empty;
  }

  const newestPubMs = obsList[0].pubMs;
  const newestSign = Math.sign(obsList[0].direction);
  const newestObsType = obsList[0].signalType;
  const hasNewerPositivePracticeProgression =
    newestSign > 0 &&
    (obsList[0].hasObservedPracticeReturn ||
      newestObsType === 'OBSERVED_PRACTICE_RETURN' ||
      newestObsType === 'TRENDING_UPWARD' ||
      newestObsType === 'EXPECTED_TO_PLAY' ||
      newestObsType === 'CLEARED_CONCUSSION_PROTOCOL');
  const hasNewerNegativePracticeShift =
    newestSign < 0 &&
    (newestObsType === 'OBSERVED_DNP_PRACTICE' ||
      newestObsType === 'TRENDING_DOWNWARD' ||
      newestObsType === 'UNLIKELY_THIS_WEEK' ||
      newestObsType === 'RULED_OUT_WEEK');

  // Decay older reports (>6h older) if newer reporting has reversed polarity (e.g., Sun exit -> Wed "practiced in full / expected to play").
  // Across distinct practice days (>12h apart), a prior-day DNP followed by a next-day observed return to practice
  // (or vice versa) is a chronological progression rather than conflicting reporting, so heavily supersede the prior-day state.
  let posRemaining = 1.0;
  let negRemaining = 1.0;
  let weightedDirSum = 0;
  let totalWeight = 0;

  for (const obs of obsList) {
    let effW = obs.weight;
    const ageBehindNewestMs = newestPubMs - obs.pubMs;
    if (ageBehindNewestMs > 6 * 3_600_000 && Math.sign(obs.direction) !== newestSign) {
      const isPriorDaySupersededPracticeState =
        ageBehindNewestMs > 12 * 3_600_000 &&
        ((hasNewerPositivePracticeProgression &&
          (obs.signalType === 'OBSERVED_DNP_PRACTICE' || obs.signalType === 'UNLIKELY_WEDNESDAY_PRACTICE')) ||
          (hasNewerNegativePracticeShift &&
            (obs.signalType === 'OBSERVED_PRACTICE_RETURN' || obs.signalType === 'EXPECTED_PRACTICE_RETURN')));
      effW *= isPriorDaySupersededPracticeState ? 0.04 : 0.25;
    }
    weightedDirSum += obs.direction * effW;
    totalWeight += effW;
    if (obs.direction > 0) {
      posRemaining *= 1 - Math.min(0.65, effW);
    } else if (obs.direction < 0) {
      negRemaining *= 1 - Math.min(0.65, effW);
    }
  }

  const netDirection = totalWeight > 0 ? weightedDirSum / totalWeight : 0;
  const dominantSign = Math.sign(netDirection);
  const rawConf = dominantSign >= 0 ? 1 - posRemaining : 1 - negRemaining;
  const opposingConf = dominantSign >= 0 ? 1 - negRemaining : 1 - posRemaining;
  const confidence = Math.max(0, Math.min(0.94, rawConf - opposingConf * 0.65));

  // Pick dominant signalType matching net polarity (decaying stale >24h same-polarity notes so fresh Sat trend/ruling leads!)
  const matchingObs = obsList.filter(o => Math.sign(o.direction) === dominantSign);
  const obsLeadRank = o => {
    const recencyMult = Math.pow(0.5, Math.max(0, newestPubMs - o.pubMs) / (24 * 3_600_000));
    const trendOrRulingBoost =
      o.signalType === 'RULED_OUT_WEEK' ||
      o.signalType === 'CLEARED_CONCUSSION_PROTOCOL' ||
      o.signalType === 'UNLIKELY_THIS_WEEK' ||
      o.signalType === 'EXPECTED_TO_PLAY' ||
      o.signalType === 'TRENDING_DOWNWARD' ||
      o.signalType === 'TRENDING_UPWARD'
        ? 0.12
        : 0;
    return (
      (Math.abs(o.direction) * o.weight +
        trendOrRulingBoost +
        (o.inferredInjuryType ? 0.06 : 0) +
        (o.hasCoachQuote ? 0.05 : 0)) *
      recencyMult
    );
  };
  const primaryObs =
    matchingObs.sort((a, b) => obsLeadRank(b) - obsLeadRank(a) || b.pubMs - a.pubMs)[0] || obsList[0];

  const bestInferredInj =
    primaryObs.inferredInjuryType ||
    matchingObs.find(o => o.inferredInjuryType)?.inferredInjuryType ||
    priorWeekInjuryType ||
    '';

  const latestObservedPracticeReturnObs =
    matchingObs
      .filter(o => o.hasObservedPracticeReturn || o.signalType === 'OBSERVED_PRACTICE_RETURN')
      .sort((a, b) => b.pubMs - a.pubMs)[0] || null;

  return {
    hasSignal: confidence >= 0.12 || hasOfficialTxDesignation || hasOfficialActivationFromIr,
    signalType: primaryObs.signalType,
    direction: Number(netDirection.toFixed(3)),
    confidence: Number(confidence.toFixed(3)),
    corroboratingCount: matchingObs.length,
    hasCoachOrGmQuote: matchingObs.some(o => o.hasCoachQuote),
    hasOfficialTxDesignation,
    hasOfficialActivationFromIr,
    hasWindowNotOpeningSignal:
      hasWindowNotOpeningSignal &&
      (primaryObs.signalType === 'WINDOW_NOT_OPENING_THIS_WEEK' || dominantSign < 0),
    hasObservedPracticeReturn: Boolean(latestObservedPracticeReturnObs && dominantSign > 0),
    observedPracticeReturnPubMs: latestObservedPracticeReturnObs ? latestObservedPracticeReturnObs.pubMs : 0,
    observedPracticeReturnText: latestObservedPracticeReturnObs ? latestObservedPracticeReturnObs.scopedClause || '' : '',
    inferredInjuryType: bestInferredInj,
    exitedWithoutReturn: matchingObs.some(o => o.exitedWithoutReturn),
    isAggravation: matchingObs.some(o => o.isAggravation),
    hasLateSetback: matchingObs.some(o => o.hasLateSetback),
    isMultiWeekOrSurgery: matchingObs.some(o => o.isMultiWeekOrSurgery),
    latestPubMs: newestPubMs,
    leadClause: primaryObs.scopedClause,
    reporters: matchingObs.map(o => o.reporterLabel)
  };
}

/**
 * Computes prior-week missed-game streak and whether the player logged practice participation
 * (`LP` or `FP`) vs `DNP` during the prior week, anchored to 2024–2026 NFL empirical rollover rates
 * (Missed game + Prior LP/FP = 51.8%–67% vs Missed game + Prior DNP = 30.4%–38%).
 */
export function derivePriorWeekAbsenceProfile({
  weeklyHistory = [],
  currentWeek = null,
  byeWeek = 8,
  rawStatus = '',
  beatNote = ''
} = {}) {
  const stLower = String(rawStatus || '').toLowerCase().trim();
  const noteLower = String(beatNote || '').toLowerCase();
  let missedPriorGame = false;
  let consecutiveMissedGames = 0;
  let priorWeekPracticed = null;

  if (Array.isArray(weeklyHistory) && weeklyHistory.length > 0 && Number.isFinite(Number(currentWeek))) {
    const curWk = Number(currentWeek);
    const byWk = new Map();
    for (const h of weeklyHistory) {
      const w = Number(h?.week);
      if (w >= 1 && w < curWk) byWk.set(w, h);
    }
    let probeWk = curWk - 1;
    if (probeWk === Number(byeWeek)) probeWk -= 1;

    while (probeWk >= 1) {
      if (probeWk === Number(byeWeek)) {
        probeWk -= 1;
        continue;
      }
      const entry = byWk.get(probeWk);
      const gs = String(entry?.gameStatus || '').toLowerCase();
      if (entry && (gs === 'out' || gs === 'inactive' || gs === 'doubtful')) {
        consecutiveMissedGames += 1;
        if (missedPriorGame === false) {
          missedPriorGame = true;
          const ps = String(entry.practiceStatus || '').toLowerCase();
          if (ps.includes('limited') || ps.includes('full') || ps === 'lp' || ps === 'fp') {
            priorWeekPracticed = true;
          } else if (ps.includes('did not') || ps === 'dnp') {
            priorWeekPracticed = false;
          }
        }
        probeWk -= 1;
      } else {
        break;
      }
    }
  }

  if (
    !missedPriorGame &&
    (stLower === 'out' ||
      stLower === 'inactive' ||
      /\b(?:sidelined previously|missed (?:sunday|monday|thursday|saturday|last week|week \d+)|missed (?:the (?:[a-z0-9'.-]+ )?)?(?:last|past) (?:two|three|four|five|six|\d+) (?:games|contests|matchups)|has missed (?:the )?(?:last|past )?(?:two|three|four|five|six|\d+) (?:consecutive |straight )?(?:games|contests|matchups)|missing (?:a |his )?(?:second|third|fourth|fifth) (?:straight|consecutive)|miss his (?:second|third|fourth|fifth) (?:straight|consecutive)|staying behind|stayed behind|hasn't played since|has not played since|for the first time since week \d+)\b/i.test(
        noteLower
      ))
  ) {
    missedPriorGame = true;
    consecutiveMissedGames = Math.max(1, consecutiveMissedGames);
  }

  const streakWordMap = {
    two: 2, second: 2,
    three: 3, third: 3,
    four: 4, fourth: 4,
    five: 5, fifth: 5,
    six: 6, sixth: 6
  };
  const streakMatch = noteLower.match(
    /\b(?:(second|third|fourth|fifth|sixth)\s+(?:straight|consecutive)|(?:last|past)\s+(two|three|four|five|six|\d+)\s+(?:games|contests|matchups)|(two|three|four|five|six|\d+)\s+(?:consecutive|straight)\s+(?:games|contests|matchups))\b/i
  );
  if (streakMatch) {
    const tok = (streakMatch[1] || streakMatch[2] || streakMatch[3] || '').toLowerCase();
    const parsedCnt = streakWordMap[tok] || Number(tok) || 2;
    consecutiveMissedGames = Math.max(parsedCnt, consecutiveMissedGames);
  } else if (/\bconsecutive\s+(?:games|contests)\b/i.test(noteLower)) {
    consecutiveMissedGames = Math.max(2, consecutiveMissedGames);
  }

  if (priorWeekPracticed === null && missedPriorGame) {
    if (/\b(?:trio of limited practices|limited practices during the week|limited all week|practiced on a limited basis)\b/i.test(noteLower)) {
      priorWeekPracticed = true;
    } else if (
      /\b(?:hasn't been able to practice|has not been able to practice|trio of '?dnps?'?|logging '?dnps?'? last week|did not practice all week|not practicing in any capacity|hasn't practiced|has not practiced|without practicing)\b/i.test(
        noteLower
      )
    ) {
      priorWeekPracticed = false;
    }
  }

  return {
    missedPriorGame,
    consecutiveMissedGames,
    priorWeekPracticed
  };
}

function hasClearedConcussionProtocolSignal(beatNote = '') {
  if (!beatNote) return false;
  return (
    /\b(?:cleared|exited|passed|out of)\s+(?:the\s+)?(?:nfl'?s?\s+)?concussion protocol\b/i.test(beatNote) &&
    !/\b(?:not|n't|yet to be|hasn't|has not)\s+(?:cleared|exited|passed)\b/i.test(beatNote)
  );
}

/**
 * Normalizes a single day's practice string into a canonical code:
 * 'FP' | 'LP' | 'DNP_REST' | 'DNP' | 'NONE'
 */
export function normalizePracticeCode(rawText = '', injuryType = '') {
  const s = String(rawText || '').toLowerCase().trim();
  if (!s || s === '-' || s === 'n/a') return 'NONE';
  if (s === 'fp' || s.includes('full')) return 'FP';
  if (s === 'lp' || s.includes('limited')) return 'LP';
  if (
    s === 'vet rest' ||
    s === 'rest' ||
    s === 'dnp_rest' ||
    s.includes('rest') ||
    isRestOrPersonalInjuryLabel(injuryType)
  ) {
    return 'DNP_REST';
  }
  if (s === 'dnp' || s.includes('did not') || s.includes('out')) return 'DNP';
  return 'NONE';
}

const PT_WEEKDAY_FORMATTER = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/Los_Angeles',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  weekday: 'short',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23'
});

function extractPtDayMeta(epochMs) {
  const parts = PT_WEEKDAY_FORMATTER.formatToParts(new Date(epochMs));
  let year = 1970;
  let month = 1;
  let day = 1;
  let weekday = 'Sun';
  let hour = 0;
  let minute = 0;
  for (const p of parts) {
    if (p.type === 'year') year = Number(p.value);
    else if (p.type === 'month') month = Number(p.value);
    else if (p.type === 'day') day = Number(p.value);
    else if (p.type === 'weekday') weekday = p.value;
    else if (p.type === 'hour') hour = Number(p.value) % 24;
    else if (p.type === 'minute') minute = Number(p.value);
  }
  return {
    year,
    month,
    day,
    weekday,
    dayIndex: Math.floor(Date.UTC(year, month - 1, day) / 86_400_000),
    minutesOfDay: hour * 60 + minute
  };
}

/**
 * Parses Wednesday / Thursday / Friday practice participation codes from official nflverse status,
 * slash notation (`DNP/LP/FP`), and prose beat/injury wire comments (used identically for 49ers & Opponents).
 * When `kickoffIso` is provided, never fabricates future practice days (`thu`/`fri`) that have not yet occurred
 * or invents `LP` from bare `"questionable"` placeholder strings!
 */
export function extractPracticeDaysFromText({
  statusRaw = '',
  injuryType = '',
  shortComment = '',
  longComment = '',
  nflversePracticeStatus = '',
  kickoffIso = '',
  nowMs = Date.now(),
  allowHeuristicFill = true
} = {}) {
  const combined = `${shortComment || ''} ${longComment || ''}`.trim();
  const lower = combined.toLowerCase();
  const stLower = String(statusRaw || '').toLowerCase().trim();
  const isRest =
    isRestOrPersonalInjuryLabel(injuryType) ||
    (!injuryType && /\b(?:vet(?:eran)?\s+rest|resting\s+player|not\s+injury\s+related)\b/.test(lower));

  const slashMatch = combined.match(/\b(DNP|LP|FP)\s*\/\s*(DNP|LP|FP)\s*\/\s*(DNP|LP|FP)\b/i);
  if (slashMatch) {
    return {
      wed: slashMatch[1].toUpperCase(),
      thu: slashMatch[2].toUpperCase(),
      fri: slashMatch[3].toUpperCase()
    };
  }

  const koMs = kickoffIso ? Date.parse(kickoffIso) : NaN;
  const koWeekday = Number.isFinite(koMs) ? extractPtDayMeta(koMs).weekday : 'Sun';
  const mapDayWordToCanonicalSlot = dayWord => {
    const wd = String(dayWord || '').slice(0, 3).toLowerCase();
    if (koWeekday === 'Wed') {
      if (wd === 'mon') return 'wed';
      if (wd === 'tue') return 'thu';
      return null;
    }
    if (koWeekday === 'Thu') {
      if (wd === 'mon') return 'wed';
      if (wd === 'tue') return 'thu';
      if (wd === 'wed') return 'fri';
      return null;
    }
    if (koWeekday === 'Fri' || koWeekday === 'Sat') {
      if (wd === 'tue') return 'wed';
      if (wd === 'wed') return 'thu';
      if (wd === 'thu') return 'fri';
      return null;
    }
    if (koWeekday === 'Mon') {
      if (wd === 'thu') return 'wed';
      if (wd === 'fri') return 'thu';
      if (wd === 'sat') return 'fri';
      return null;
    }
    if (wd === 'wed') return 'wed';
    if (wd === 'thu') return 'thu';
    if (wd === 'fri') return 'fri';
    return null;
  };

  const DAY_WORD_SRC = 'mon(?:day)?|tue(?:s(?:day)?)?|wed(?:nesday)?|thu(?:rs?(?:day)?)?|fri(?:day)?|sat(?:urday)?';

  const SPECULATIVE_SEG_GUARD_RE = new RegExp(
    `\\b(?:assuming\\b|if\\s+(?:he|they|[a-z'.-]{2,20})\\s+(?:is|are|can|could|manages?|logs?|practices?|participates?|gets?|remains?)|whether\\s+(?:he|they|[a-z'.-]{2,20})|unless\\s+(?:he|they)|provided\\s+(?:that\\s+)?(?:he|they)|barring\\s+a\\s+setback|at\\s+least\\s+a\\s+(?:limited|full)|(?:is|are|be|being)\\s+able\\s+to\\s+(?:log|practice|participate|return|get)|there['’]?s\\s+a\\s+chance|chance\\s+(?:to|of|at|he|they)\\b|unlikely\\s+to\\s+be|likely\\s+to\\s+be|more\\s+than\\s+a|opportunities\\s+to|opportunity\\s+to|hoping\\s+to\\s+(?:be|log|practice|get|return)|hope(?:s|ful)?\\s+to|expect(?:s|ed|ing)?\\s+to\\s+(?:be|log|practice|participate|return|miss)|projected\\s+to|slated\\s+to|scheduled\\s+to|in\\s+line\\s+to|poised\\s+to|looking\\s+to|aiming\\s+to|trying\\s+to|needs?\\s+to\\s+(?:log|practice|participate|be)|(?:could|might|may|would|should)\\s+(?:be\\s+a|log|practice|participate|return\\s+to|miss|sit\\s+out)|plan(?:s|ning)?\\s+to\\s+(?:practice|participate|log)|will\\s+(?:likely\\s+|probably\\s+)?(?:need\\s+to\\s+|have\\s+to\\s+)?(?:practice|participate|be\\s+limited|be\\s+full|log\\s+(?:a|at\\s+least)|not\\s+practice|miss|sit\\s+out)(?:\\s+(?:in|on|at|a|at\\s+least|${DAY_WORD_SRC}))?)\\b`,
    'i'
  );

  const DNP_SEG_RE = new RegExp(
    `\\b(?:did not practice|didn['’]?t practice|did not participate|didn['’]?t participate|not practicing|not participating|non-participant|no practice|was an observer|observer (?:for|at)|sidelined\\s+(?:at|for|in|from|on|${DAY_WORD_SRC})|(?:sat|sitting)\\s+out|held out(?:\\s+of)?|absent\\s+from|missed\\s+(?:(?:${DAY_WORD_SRC}|all\\s+three|consecutive|another|[\\w' -]{0,28})\\s+)?practices?|missed\\s+(?:(?:${DAY_WORD_SRC})(?:['’]?s)?\\s+)?(?:sessions?|walkthroughs?)|missing\\s+(?:(?:${DAY_WORD_SRC}|[\\w' -]{0,24})\\s+)?practices?)\\b`,
    'i'
  );

  const LP_SEG_RE = new RegExp(
    `\\b(?:limited\\s+(?:practice\\s+)?participant|limited\\s+participation|limited\\s+practice|limited\\s+session|limited\\s+(?:in|at|on|during)\\s+(?:[\\w' -]{0,24})?(?:practice|session|${DAY_WORD_SRC})|(?:was|were|remained|being|stayed)\\s+limited|upgraded\\s+to\\s+(?:a\\s+)?limited|returned\\s+to\\s+limited|logged\\s+a\\s+(?:limited|capped)\\s+(?:session|practice)|practiced\\s+(?:in\\s+a\\s+limited\\s+(?:capacity|role)|on\\s+a\\s+limited\\s+basis)|(?:^|[\\s,(;])limited(?=\\s+(?:${DAY_WORD_SRC})\\b))\\b`,
    'i'
  );

  const FP_SEG_RE = new RegExp(
    `\\b(?:full\\s+(?:practice\\s+)?participant|full\\s+participation|full\\s+practice|full\\s+session|full\\s+go\\s+(?:at|in|on|${DAY_WORD_SRC})|practiced\\s+in\\s+full|practiced\\s+fully|practiced\\s+without\\s+(?:limitations|restrictions)|upgraded\\s+to\\s+(?:a\\s+)?full|logged\\s+a\\s+full\\s+(?:session|practice)|(?:^|[\\s,(;])full(?=\\s+(?:${DAY_WORD_SRC})\\b))\\b`,
    'i'
  );

  // Split multi-day practice prose into isolated clauses so "did not practice Wednesday, limited Thursday, full Friday"
  // or "upgraded to full Friday after being limited Wednesday and Thursday" never bleeds codes across days!
  const segments = lower
    .split(
      /[.;!\n]+|,\s*|\b(?:but|while|whereas|before|after|then|following|prior\s+to)\b|\band\s+(?=(?:was\s+|were\s+|is\s+|has\s+been\s+|remained\s+|being\s+)?(?:did\s+not|didn['’]?t|not\s+practic|not\s+participat|missed|missing|held\s+out|sat\s+out|sidelined|limited|full|practiced|logged|upgraded|downgraded|returned))/i
    )
    .map(s => s.trim())
    .filter(Boolean);

  const dayMatchRe = new RegExp(`\\b(${DAY_WORD_SRC})\\b`, 'gi');
  const slots = { wed: null, thu: null, fri: null };
  for (const seg of segments) {
    if (SPECULATIVE_SEG_GUARD_RE.test(seg)) continue;

    let segCode = null;
    if (DNP_SEG_RE.test(seg)) {
      segCode = isRest ? 'Vet Rest' : 'DNP';
    } else if (FP_SEG_RE.test(seg)) {
      segCode = 'FP';
    } else if (LP_SEG_RE.test(seg)) {
      segCode = 'LP';
    }
    if (!segCode) continue;

    if (/\bwed(?:nesday)?\s+(?:through|thru|-)\s+fri(?:day)?\b|\bmon(?:day)?\s+(?:through|thru|-)\s+wed(?:nesday)?\b|\bthu(?:rs?(?:day)?)?\s+(?:through|thru|-)\s+sat(?:urday)?\b/i.test(seg)) {
      slots.wed = slots.wed || segCode;
      slots.thu = slots.thu || segCode;
      slots.fri = slots.fri || segCode;
      continue;
    }

    const dayMatches = [...seg.matchAll(dayMatchRe)];
    for (const dm of dayMatches) {
      const targetSlot = mapDayWordToCanonicalSlot(dm[1]);
      if (targetSlot && !slots[targetSlot]) {
        slots[targetSlot] = segCode;
      }
    }
  }

  let { wed, thu, fri } = slots;

  if (/did not practice all week|missed all three practices|missing practice all week|trio of '?dnps?'?/i.test(lower)) {
    wed = wed || 'DNP';
    thu = thu || 'DNP';
    fri = fri || 'DNP';
  } else if (/limited (?:participant )?(?:in practice )?all week|limited wednesday through friday|three limited (?:sessions|practices)|trio of limited practices/i.test(lower)) {
    wed = wed || 'LP';
    thu = thu || 'LP';
    fri = fri || 'LP';
  } else if (/full participant all week|practiced in full all week|trio of full practices|three full practices/i.test(lower)) {
    wed = wed || 'FP';
    thu = thu || 'FP';
    fri = fri || 'FP';
  }

  // Calendar-aware future-day guard when upcoming `kickoffIso` is supplied
  const ts = Number.isFinite(nowMs) ? nowMs : Date.now();
  if (Number.isFinite(koMs) && ts < koMs) {
    const koPt = extractPtDayMeta(koMs);
    const nowPt = extractPtDayMeta(ts);
    const leadDays = getPracticeReportLeadDays(koPt.weekday); // Practice Day 1 = leadDays before game
    const daysUntilGame = koPt.dayIndex - nowPt.dayIndex;

    // Practice Day 1 (e.g. Wednesday for Sun game): Thu & Fri have not happened yet!
    if (daysUntilGame >= leadDays) {
      return {
        wed: daysUntilGame === leadDays ? wed || '-' : '-',
        thu: '-',
        fri: '-'
      };
    }
    // Practice Day 2 (e.g. Thursday for Sun game): Fri has not happened yet!
    if (daysUntilGame === leadDays - 1) {
      return {
        wed: wed || '-',
        thu: thu || '-',
        fri: '-'
      };
    }
    // Practice Day 3+ (Friday/Saturday/Sunday) with bare status token ("questionable") and zero prose: do not invent LP/LP/LP
    if (!wed && !thu && !fri && isBareStatusPlaceholderComment(combined) && !nflversePracticeStatus) {
      if (stLower === 'out' || stLower === 'injured reserve' || stLower === 'ir') {
        return { wed: 'DNP', thu: 'DNP', fri: 'DNP' };
      }
      if (stLower === 'doubtful') {
        return { wed: 'DNP', thu: 'DNP', fri: 'DNP' };
      }
      return { wed: '-', thu: '-', fri: '-' };
    }
  }

  const nflPrac = normalizePracticeCode(nflversePracticeStatus, injuryType);
  if (nflPrac !== 'NONE' && !fri) {
    fri = nflPrac === 'DNP_REST' ? 'Vet Rest' : nflPrac;
  }

  if (!allowHeuristicFill) {
    return {
      wed: wed || '-',
      thu: thu || '-',
      fri: fri || '-'
    };
  }

  if (!wed && !thu && !fri) {
    if (stLower === 'out' || stLower === 'injured reserve' || stLower === 'ir' || /ruled out|placed on injured reserve/i.test(lower)) {
      return { wed: 'DNP', thu: 'DNP', fri: 'DNP' };
    }
    if (stLower === 'doubtful') {
      return { wed: 'DNP', thu: 'DNP', fri: /limited/i.test(lower) ? 'LP' : 'DNP' };
    }
    if (
      stLower === 'active' ||
      /does not have a designation|doesn't have a designation|no injury designation|cleared to play/i.test(lower)
    ) {
      return { wed: isRest ? 'Vet Rest' : 'LP', thu: 'FP', fri: 'FP' };
    }
    if (isBareStatusPlaceholderComment(combined) && !nflversePracticeStatus) {
      return { wed: '-', thu: '-', fri: '-' };
    }
    return { wed: isRest ? 'Vet Rest' : 'LP', thu: 'LP', fri: 'LP' };
  }

  // Fill remaining slots sensibly from observed trajectory once final report window has arrived
  if (!wed) wed = thu || fri || 'LP';
  if (!thu) thu = fri || wed || 'LP';
  if (!fri) {
    if (stLower === 'out' || /ruled out/i.test(lower)) fri = 'DNP';
    else if (
      stLower === 'active' ||
      /does not have a designation|doesn't have a designation|no injury designation/i.test(lower)
    ) {
      fri = 'FP';
    } else {
      fri = thu;
    }
  }

  return { wed, thu, fri };
}

const FUTURE_PRACTICE_EXPECTATION_GUARD_RE =
  /\b(?:assuming\b|if\s+(?:he|they|[a-z'.-]{2,20})\s+(?:is|are|can|could|manages?|logs?|practices?|participates?|gets?)|whether\s+(?:he|they|[a-z'.-]{2,20})|at\s+least\s+a\s+(?:limited|full)|(?:is|are|be|being)\s+able\s+to\s+(?:log|practice|participate|return)|there['’]?s\s+a\s+chance|chance\s+(?:to|of|at|he|they)\b|expect(?:s|ed|ing)?\b[^.;]{0,55}\b(?:back|at|to)\s+practice|hopeful\b[^.;]{0,55}\bpractice|hopes?\s+to\b[^.;]{0,45}\bpractice|plan(?:s|ning)?\s+to\s+(?:practice|open|participate|log)|will\s+(?:likely\s+|probably\s+)?(?:practice|be\s+limited|be\s+full|log\s+(?:a|at\s+least)|not\s+practice)\s+(?:wednesday|thursday|friday|tomorrow|in|on|at|a)|should\s+(?:give|provide|shed)\b[^.;]{0,55}\b(?:report|context|insight)|worth\s+(?:keeping\s+an\s+eye|monitoring)\b[^.;]{0,65}\bpractice|unlikely\s+to\s+(?:participate\s+in\s+|be\b[^.;]{0,40}\b)?(?:practice|participant)|(?:appears?|seems?)\s+(?:unlikely|likely)\s+to\s+be\b|(?:anything|nothing)\s+more\s+than\s+a\s+limited|opportunities\s+to\s+practice|(?:could|might|may|would|should)\s+(?:return\s+to\s+practice|practice|log\s+(?:a|at\s+least)|be\s+(?:a\s+)?(?:limited|full)))\b/i;

const SIDE_FIELD_REHAB_OBSERVATION_RE =
  /\b(?:spotted\s+(?:running|sprinting|jogging|working|cutting|throwing|catching)|working\s+(?:on\s+(?:a|the)\s+(?:side|rehab)\s+field|with\s+trainers)|on\s+the\s+(?:side\s*lines?|side\s+field|rehab\s+field)|running\s+(?:on\s+the\s+side|routes\s+on\s+the\s+side|sprints))s?\b/i;

/**
 * Resolves which weekly practice column (`'wed' | 'thu' | 'fri'`) a beat report or official update
 * pertains to, regardless of which timezone (PT, ET, CT, London, Melbourne, Mexico City) the team is practicing in.
 */
export function resolvePracticeSlotFromReportTiming({
  text = '',
  publishedAtMs = null,
  kickoffIso = '',
  seasonYear = 2026
} = {}) {
  const lower = String(text || '').toLowerCase();
  const koMs = kickoffIso ? Date.parse(kickoffIso) : NaN;
  const koWeekday = Number.isFinite(koMs) ? extractPtDayMeta(koMs).weekday : 'Sun';

  // Map explicit weekday mention in text to canonical slot (wed / thu / fri)
  const mapWeekdayNameToSlot = wd => {
    if (koWeekday === 'Wed') {
      if (wd === 'mon') return 'wed';
      if (wd === 'tue') return 'thu';
    } else if (koWeekday === 'Thu') {
      if (wd === 'mon') return 'wed';
      if (wd === 'tue') return 'thu';
      if (wd === 'wed') return 'fri';
    } else if (koWeekday === 'Fri' || koWeekday === 'Sat') {
      if (wd === 'tue') return 'wed';
      if (wd === 'wed') return 'thu';
      if (wd === 'thu') return 'fri';
    } else if (koWeekday === 'Mon') {
      if (wd === 'thu') return 'wed';
      if (wd === 'fri') return 'thu';
      if (wd === 'sat') return 'fri';
    } else {
      if (wd === 'wed') return 'wed';
      if (wd === 'thu') return 'thu';
      if (wd === 'fri') return 'fri';
    }
    return null;
  };

  // Ignore game-day references like "Sunday's game" / "Monday's presser" when looking for practice weekday
  const practiceDayMatch = lower.match(
    /\b(?:practice[d]?|particip(?:at(?:e|ed|ing|ion)|ants?)|limited|session|report|dnp|non-participants?|observer|sidelined|sat out)\b[^.;]{0,36}?\b(wednesday|thursday|friday|monday|tuesday|saturday)\b|\b(wednesday|thursday|friday|monday|tuesday|saturday)(?:'s)?\s+(?:practice|session|walkthrough|injury report|pre[- ]practice)/i
  );
  const matchedDayWord = (practiceDayMatch?.[1] || practiceDayMatch?.[2] || '').slice(0, 3).toLowerCase();
  if (matchedDayWord) {
    const slot = mapWeekdayNameToSlot(matchedDayWord);
    if (slot) return slot;
  }

  // Check explicit MM/DD date stamp in beat report (e.g. "#49ers pre practice report 11/11")
  const mmddMatch = lower.match(/\b(0?[1-9]|1[0-2])\/(0?[1-9]|[12]\d|3[01])\b/);
  if (mmddMatch && Number.isFinite(koMs)) {
    const mNum = Number(mmddMatch[1]);
    const dNum = Number(mmddMatch[2]);
    const koPt = extractPtDayMeta(koMs);
    const yr = mNum >= 8 ? Number(seasonYear) || koPt.year : (Number(seasonYear) || koPt.year) + (koPt.month <= 2 ? 0 : 1);
    const stampDayIdx = Math.floor(Date.UTC(yr, mNum - 1, dNum) / 86_400_000);
    const leadDays = getPracticeReportLeadDays(koPt.weekday);
    const diff = koPt.dayIndex - stampDayIdx;
    if (diff === leadDays) return 'wed';
    if (diff === leadDays - 1) return 'thu';
    if (diff === leadDays - 2) return 'fri';
  }

  // Fallback to UTC timestamp offset before kickoff (timezone-agnostic: covers Melbourne, London, ET, CT, PT!)
  if (Number.isFinite(publishedAtMs) && Number.isFinite(koMs) && publishedAtMs < koMs) {
    const koPt = extractPtDayMeta(koMs);
    const pubPt = extractPtDayMeta(publishedAtMs);
    const leadDays = getPracticeReportLeadDays(koPt.weekday);
    const dayDiffPt = koPt.dayIndex - pubPt.dayIndex;
    if (dayDiffPt === leadDays) return 'wed';
    if (dayDiffPt === leadDays - 1) return 'thu';
    if (dayDiffPt === leadDays - 2) return 'fri';
    // International date-line tolerance (e.g., Melbourne Wednesday afternoon = Tuesday evening PT)
    const hoursBeforeKo = (koMs - publishedAtMs) / 3_600_000;
    if (leadDays === 4 && hoursBeforeKo >= 88 && hoursBeforeKo <= 116) return 'wed';
  }

  return null;
}

function computeSharedRosterSurnames(players = []) {
  const counts = new Map();
  for (const p of players || []) {
    const nm = typeof p === 'string' ? p : p?.name || '';
    const stripped = collapseInitialDots(stripGenerationalSuffix(nm)).toLowerCase();
    const parts = stripped.split(/\s+/).filter(Boolean);
    const surname = parts[parts.length - 1] || '';
    if (surname.length >= 3) {
      counts.set(surname, (counts.get(surname) || 0) + 1);
    }
  }
  const shared = new Set();
  for (const [s, cnt] of counts.entries()) {
    if (cnt >= 2) shared.add(s);
  }
  return shared;
}

export function isRestOrPersonalInjuryLabel(label = '') {
  const s = String(label || '').trim();
  if (!s) return false;
  if (!/not injury related|\bnir\b|resting player|\brest\b|personal|coach'?s decision/i.test(s)) {
    return false;
  }
  // Compound labels like "Neck, Not injury related - resting player" or "Knee / NIR - Rest" contain a real medical injury!
  const medicalRemainder = s
    .replace(/\bnot\s+injury\s+related(?:\s*[-–—:,]\s*(?:resting\s+player|veteran\s+rest|vet\s+rest|rest|personal|other))?/gi, '')
    .replace(/\bnir\s*[-–—:]?\s*(?:veteran\s+rest|vet\s+rest|resting\s+player|rest|personal|other)?/gi, '')
    .replace(/\b(?:veteran\s+rest|vet\s+rest|resting\s+player|rest|personal|coach'?s\s+decision|other)\b/gi, '')
    .replace(/[\s,/|–—-]+/g, '')
    .trim();
  return medicalRemainder.length === 0;
}

/**
 * Returns true ONLY when the injury listing is strictly an illness (optionally paired with NIR/Rest),
 * and false for compound orthopedic/neurological listings like "Ankle, Illness" or "Concussion, Illness".
 */
export function isPureIllnessLabel(label = '') {
  const s = String(label || '').trim();
  if (!s) return false;
  if (!/\b(?:illness|flu|influenza|stomach\s+bug|viral|virus|migraine|respiratory|non-covid)\b/i.test(s)) {
    return false;
  }
  const remainder = s
    .replace(/\bnon[-\s]?covid(?:\s+illness)?\b/gi, '')
    .replace(/\b(?:illness|flu|influenza|stomach\s+bug|stomach|viral|virus|migraine|respiratory)\b/gi, '')
    .replace(/\bnot\s+injury\s+related(?:\s*[-–—:,]\s*(?:resting\s+player|veteran\s+rest|vet\s+rest|rest|personal|other))?/gi, '')
    .replace(/\bnir\s*[-–—:]?\s*(?:veteran\s+rest|vet\s+rest|resting\s+player|rest|personal|other)?/gi, '')
    .replace(/\b(?:veteran\s+rest|vet\s+rest|resting\s+player|rest|personal|other)\b/gi, '')
    .replace(/[\s,/|–—-]+/g, '')
    .trim();
  return remainder.length === 0;
}

function stripHtmlTagsBasic(html = '') {
  return stripHtmlAndDecodeEntities(html);
}

export function canonicalInjuryPlayerKey(rawName = '') {
  const k = String(rawName || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\b(jr|sr|ii|iii|iv|v)\b\.?/g, '')
    .replace(/[^a-z0-9]/g, '');
  if (k === 'ogbonniaokoronkwo') return 'ogbookoronkwo';
  return k;
}

function normalizeOfficialPracticeCellShared(
  rawCell = '',
  injuryText = '',
  { allowVetRest = true, laterDayHasActivity = false } = {}
) {
  const c = String(rawCell || '').trim().toUpperCase();
  if (!c || c === '-' || c === '—') return '-';
  // In NFL GSIS injury tables, `(-)` on an earlier practice day when a later day has DNP/LP/FP means
  // the player was NOT on the injury report that day (practiced in full prior to a midweek injury/illness).
  if (c === '(-)') {
    return laterDayHasActivity ? 'FP' : '-';
  }
  if (c === 'DNP' && allowVetRest && isRestOrPersonalInjuryLabel(injuryText)) {
    return 'Vet Rest';
  }
  if (c === 'FP' || c === 'FULL') return 'FP';
  if (c === 'LP' || c === 'LIMITED') return 'LP';
  if (c === 'DNP') return 'DNP';
  return rawCell.trim();
}

function formatCleanOfficialInjuryLabel(rawInjury = '') {
  const trimmed = String(rawInjury || '').trim();
  if (!trimmed) return '';
  // Replace verbose NFL GSIS NIR phrases in-place so compound labels like "Neck, Not injury related - resting player"
  // preserve the real medical body part ("Neck, NIR - Rest") instead of discarding it!
  return trimmed
    .replace(/\bnot\s+injury\s+related\s*[-–—:]\s*personal\b/gi, 'NIR - Personal')
    .replace(/\bnot\s+injury\s+related\s*[-–—:]\s*(?:resting\s+player|veteran\s+rest|vet\s+rest|rest)\b/gi, 'NIR - Rest')
    .replace(/\bnir\s*[-–—:]\s*personal\b/gi, 'NIR - Personal')
    .replace(/\bnir\s*[-–—:]\s*(?:resting\s+player|veteran\s+rest|vet\s+rest|rest)\b/gi, 'NIR - Rest')
    .replace(/\s*,\s*/g, ', ')
    .replace(/([A-Za-z])\s*\/\s*([A-Za-z])/g, '$1 / $2')
    .trim();
}

function normalizeOfficialGameStatusShared(rawStatus = '') {
  const s = String(rawStatus || '').trim().toUpperCase();
  if (!s || s === 'UNSPECIFIED' || s === '(-)' || s === '-' || s === '—') return '';
  if (s.includes('QUESTIONABLE')) return 'Questionable';
  if (s.includes('DOUBTFUL')) return 'Doubtful';
  if (s.includes('OUT')) return 'Out';
  return '';
}

/**
 * Shared Node + Browser parser for `https://www.49ers.com/team/injury-report/`
 * (CORS-enabled `access-control-allow-origin: *` on NFL CDN), returning authoritative
 * Wed / Thu / Fri participation & game statuses for BOTH the San Francisco 49ers and the weekly Opponent.
 */
export function parseOfficialClubInjuryReportHtml(html = '', oppTeamName = '', teamInput = null) {
  return parseOfficial49ersInjuryReportHtml(html, oppTeamName, teamInput);
}

export function parseOfficial49ersInjuryReportHtml(html = '', oppTeamName = '', teamInput = null) {
  const activeTeam = resolveTeamConfig(teamInput || getActiveTeamConfig());
  const teamFullLower = activeTeam.fullName.toLowerCase();
  const teamNickLower = activeTeam.nickname.toLowerCase();
  const sfByKey = new Map();
  const oppByKey = new Map();
  if (!html || typeof html !== 'string') {
    return {
      hasSfReport: false,
      hasOppReport: false,
      hasSfGameDesignations: false,
      hasOppGameDesignations: false,
      reportMatchesCurrentOpponent: false,
      sfByKey,
      oppByKey
    };
  }

  const oppLower = String(oppTeamName || '').toLowerCase();
  const oppMascot = oppLower.split(/\s+/).filter(Boolean).pop() || '';
  const tableRegex = /<table[\s\S]*?<\/table>/gi;
  const candidateTables = [];
  let match;

  const PRACTICE_DAY_HDR_RE = /^(?:mon|tue|wed|thu|fri|sat)$/;

  while ((match = tableRegex.exec(html)) !== null) {
    const tableHtml = match[0];
    const precedingContext = stripHtmlTagsBasic(html.slice(Math.max(0, match.index - 650), match.index)).toLowerCase();
    const headers = [
      ...(tableHtml.match(/<thead[\s\S]*?<\/thead>/i)?.[0] || '').matchAll(/<th[^>]*>([\s\S]*?)<\/th>/gi)
    ].map(m => stripHtmlTagsBasic(m[1]).toLowerCase());

    const dayColIndices = headers.reduce((acc, h, idx) => {
      if (PRACTICE_DAY_HDR_RE.test(h)) acc.push(idx);
      return acc;
    }, []);
    if (!headers.includes('player') || dayColIndices.length === 0) {
      continue;
    }
    candidateTables.push({ tableHtml, precedingContext, headers, dayColIndices });
  }

  if (candidateTables.length === 0) {
    return {
      hasSfReport: false,
      hasOppReport: false,
      hasSfGameDesignations: false,
      hasOppGameDesignations: false,
      reportMatchesCurrentOpponent: false,
      sfByKey,
      oppByKey
    };
  }

  const reportMatchesCurrentOpponent =
    !oppMascot || candidateTables.some(t => t.precedingContext.includes(oppMascot));
  if (!reportMatchesCurrentOpponent) {
    return {
      hasSfReport: false,
      hasOppReport: false,
      hasSfGameDesignations: false,
      hasOppGameDesignations: false,
      reportMatchesCurrentOpponent: false,
      sfByKey,
      oppByKey
    };
  }

  let tableIdx = 0;
  for (const { tableHtml, precedingContext, headers, dayColIndices } of candidateTables) {
    const isSf =
      (precedingContext.includes(teamFullLower) || precedingContext.includes(teamNickLower)) &&
      (!oppMascot || precedingContext.lastIndexOf(teamNickLower) > precedingContext.lastIndexOf(oppMascot));
    const targetMap = isSf || (tableIdx === 0 && !oppMascot) ? sfByKey : oppByKey;
    tableIdx += 1;

    const pIdx = headers.indexOf('player');
    const posIdx = headers.indexOf('position');
    const injIdx = headers.indexOf('injury');
    // Map practice day columns positionally in table order (handles Sun Wed/Thu/Fri, MNF Thu/Fri/Sat, TNF Mon/Tue/Wed, Sat Tue/Wed/Thu!)
    const slot1Idx = dayColIndices[0] ?? -1;
    const slot2Idx = dayColIndices[1] ?? -1;
    const slot3Idx = dayColIndices[2] ?? -1;
    const gsIdx = headers.findIndex(h => h.includes('status'));

    const tbody = tableHtml.match(/<tbody[\s\S]*?<\/tbody>/i)?.[0] || '';
    for (const rowMatch of tbody.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)) {
      const cells = [...rowMatch[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map(c => stripHtmlTagsBasic(c[1]));
      const playerName = cells[pIdx] || '';
      const key = canonicalInjuryPlayerKey(playerName);
      if (!key) continue;

      const rawInjury = injIdx >= 0 ? cells[injIdx] || '' : '';
      const cleanInjury = formatCleanOfficialInjuryLabel(rawInjury);
      const normGameStatus = gsIdx >= 0 ? normalizeOfficialGameStatusShared(cells[gsIdx]) : '';

      const c1 = slot1Idx >= 0 ? cells[slot1Idx] : '-';
      const c2 = slot2Idx >= 0 ? cells[slot2Idx] : '-';
      const c3 = slot3Idx >= 0 ? cells[slot3Idx] : '-';

      const isActiveCell = v => {
        const up = String(v || '').trim().toUpperCase();
        return up === 'DNP' || up === 'LP' || up === 'LIMITED' || up === 'FP' || up === 'FULL';
      };
      const hasMidweekLp = /^(?:LP|LIMITED)$/i.test(String(c2 || '').trim()) || /^(?:LP|LIMITED)$/i.test(String(c3 || '').trim());
      const hasRestrictiveStatus = Boolean(normGameStatus && ['Questionable', 'Doubtful', 'Out'].includes(normGameStatus));
      // NFL CMS only displays `injury[0]` ("Not injury related - resting player") even when a player develops a
      // Thursday/Friday injury ("Shoulder") and is designated Questionable: never label a post-LP Friday DNP as Vet Rest!
      const allowThuRest = !hasRestrictiveStatus && !/^(?:LP|LIMITED)$/i.test(String(c1 || '').trim());
      const allowFriRest = !hasRestrictiveStatus && !hasMidweekLp;

      targetMap.set(key, {
        name: playerName,
        position: posIdx >= 0 ? cells[posIdx] || '' : '',
        injuryType: cleanInjury,
        wed: normalizeOfficialPracticeCellShared(c1, rawInjury, {
          allowVetRest: normGameStatus !== 'Out' && normGameStatus !== 'Doubtful',
          laterDayHasActivity: isActiveCell(c2) || isActiveCell(c3)
        }),
        thu: normalizeOfficialPracticeCellShared(c2, rawInjury, {
          allowVetRest: allowThuRest,
          laterDayHasActivity: isActiveCell(c3)
        }),
        fri: normalizeOfficialPracticeCellShared(c3, rawInjury, {
          allowVetRest: allowFriRest,
          laterDayHasActivity: false
        }),
        gameStatus: normGameStatus
      });
    }
  }

  const hasSfGameDesignations = [...sfByKey.values()].some(r => Boolean(r.gameStatus));
  const hasOppGameDesignations = [...oppByKey.values()].some(r => Boolean(r.gameStatus));

  return {
    hasSfReport: sfByKey.size > 0,
    hasOppReport: oppByKey.size > 0,
    hasSfGameDesignations,
    hasOppGameDesignations,
    reportMatchesCurrentOpponent: true,
    sfByKey,
    oppByKey
  };
}

/**
 * Reconciles an official 49ers.com weekly injury report row's `gameStatus` against live ESPN status
 * and practice participation without ever auto-clearing a non-Rest Friday DNP or clobbering a live
 * Saturday ESPN downgrade (`Out` / `Doubtful`) back to Friday's `Questionable` / `Active`.
 */
export function resolveOfficialReportGameStatus({
  offRec = null,
  teamHasGameDesignations = false,
  existingStatus = '',
  effectiveInjuryType = '',
  hasSecondaryMedical = false,
  isPureRest = false,
  espnHasDowngradeProse = false
} = {}) {
  if (!offRec) return existingStatus || 'Questionable';
  const prevL = String(existingStatus || '').trim().toLowerCase();
  const offSt = String(offRec.gameStatus || '').trim();
  const offL = offSt.toLowerCase();

  const severity = s => (s === 'out' ? 4 : s === 'doubtful' ? 3 : s === 'questionable' ? 2 : 1);
  const practicedEarlierInWeek =
    offRec.wed === 'LP' || offRec.wed === 'FP' || offRec.thu === 'LP' || offRec.thu === 'FP';
  const practicedFinalDay = Boolean(offRec.fri && offRec.fri !== '-');
  const finalDayIsDnp = offRec.fri === 'DNP';

  if (offSt) {
    if (
      (prevL === 'out' || prevL === 'doubtful') &&
      severity(prevL) > severity(offL) &&
      (practicedFinalDay || teamHasGameDesignations || espnHasDowngradeProse)
    ) {
      return prevL === 'out' ? 'Out' : 'Doubtful';
    }
    return offSt;
  }

  if (
    !hasSecondaryMedical &&
    (isPureRest ||
      offRec.wed === 'Vet Rest' ||
      offRec.thu === 'Vet Rest' ||
      offRec.fri === 'Vet Rest' ||
      isRestOrPersonalInjuryLabel(effectiveInjuryType || offRec.injuryType || ''))
  ) {
    if (espnHasDowngradeProse && ['out', 'doubtful', 'questionable'].includes(prevL)) {
      return prevL === 'out' ? 'Out' : prevL === 'doubtful' ? 'Doubtful' : 'Questionable';
    }
    return 'Active';
  }

  if (practicedFinalDay && teamHasGameDesignations) {
    if (finalDayIsDnp) {
      if (prevL === 'out') return 'Out';
      if (prevL === 'doubtful') return 'Doubtful';
      return 'Questionable';
    }
    if (prevL === 'out') return 'Out';
    if (prevL === 'doubtful') return 'Doubtful';
    if (espnHasDowngradeProse && prevL === 'questionable') return 'Questionable';
    return 'Active';
  }

  if (offRec.fri === 'FP' && !espnHasDowngradeProse && prevL !== 'out' && prevL !== 'doubtful') {
    return 'Active';
  }

  if (prevL === 'out' && !practicedEarlierInWeek && offRec.fri !== 'LP' && offRec.fri !== 'FP') {
    return 'Out';
  }
  if (prevL === 'doubtful') return 'Doubtful';
  return 'Questionable';
}

function extractParentheticalInjuryForPlayer(text = '', playerName = '', sharedSurnames = null) {
  if (!text || !playerName) return '';
  const stripped = stripGenerationalSuffix(playerName);
  const surname = stripped.split(/\s+/).filter(Boolean).pop() || '';
  const surnameNorm = collapseInitialDots(surname).toLowerCase();
  const canUseSurname = !(sharedSurnames instanceof Set && sharedSurnames.has(surnameNorm));
  const candidates = [stripped, collapseInitialDots(stripped), canUseSurname ? surname : ''].filter(
    s => s && s.length >= 3
  );
  for (const token of candidates) {
    const m = String(text).match(
      new RegExp(`\\b${escapeRegexLiteral(token)}\\s*\\(([a-zA-Z /,-]{3,28})\\)`, 'i')
    );
    if (m?.[1]) {
      const raw = m[1].trim();
      if (!/\b(?:solo|tackle|yard|target|catch|carry|touchdown|sack|int|fumble|ir|out|q|questionable)\b/i.test(raw)) {
        return raw.charAt(0).toUpperCase() + raw.slice(1);
      }
    }
  }
  return '';
}

/**
 * Deterministically extracts live current-week practice participation (`DNP` / `LP` / `FP` / `Vet Rest`),
 * newly surfaced active-roster injuries, side-field rehab observations, and 21-day IR window openings
 * directly from live beat tweets, ESPN Player Wire, RotoWire, and official transactions.
 *
 * Processes items chronologically (oldest -> newest) so afternoon official practice reports seamlessly
 * refine or supersede noon open-media warmup observations.
 */
export function extractLivePracticeParticipationFromWire({
  newsItems = [],
  rosterPlayers = [],
  kickoffIso = '',
  lastCompletedGameEndMs = 0,
  nowMs = Date.now(),
  seasonYear = 2026
} = {}) {
  const updatesByPlayerId = new Map();
  const fullReportObservedSlots = new Set();
  updatesByPlayerId._fullReportObservedSlots = fullReportObservedSlots;
  if (!Array.isArray(newsItems) || newsItems.length === 0 || !Array.isArray(rosterPlayers) || rosterPlayers.length === 0) {
    return updatesByPlayerId;
  }

  const sharedRosterSurnames = computeSharedRosterSurnames(rosterPlayers);
  const minMs = Math.max(nowMs - 6 * 86_400_000, Number(lastCompletedGameEndMs) || 0);
  const eligibleItems = [];

  for (const item of newsItems) {
    if (!item || item.isClickbait || item.type === 'video') continue;
    const pubMs = parseFlexibleIsoMs(item.publishedAt);
    if (pubMs === null || pubMs < minMs || pubMs > nowMs + 3_600_000) continue;

    const fullBody = [item.fullText || item.title || item.headline || '', item.summary || '']
      .filter(Boolean)
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (!fullBody) continue;

    const trustTier = Number(item.trustTier || 2);
    const hasInlineTier1 = VERIFIED_TIER1_REPORTER_NAMES_RE.test(
      `${item.author || ''} ${item.reporterName || ''} ${fullBody}`
    );
    const isOfficial = /_official$/i.test(String(item.outletId || '')) || item.wireSource === 'official_transactions';
    const isPlayerWire = item.wireSource === 'espn_player_wire' || item.wireSource === 'rotowire_rss' || item.wireSource === 'bsky_mirror';
    if (trustTier >= 3 && !hasInlineTier1 && !isOfficial && !isPlayerWire) continue;

    const itemIdStr = String(item.id || '');
    const primaryOwnerId = itemIdStr.startsWith('espn_pwire_')
      ? itemIdStr.split('_')[2] || ''
      : item.wireSource === 'espn_player_wire' && item.primaryPlayer?.id
        ? String(item.primaryPlayer.id)
        : '';

    eligibleItems.push({ item, pubMs, fullBody, isOfficial, primaryOwnerId, priorityRank: isOfficial ? 2 : 1 });
  }

  // Chronological order (oldest -> newest) so official ~3-4pm report overwrites ~1pm pre-practice media viewing if changed
  eligibleItems.sort((a, b) => a.pubMs - b.pubMs || a.priorityRank - b.priorityRank);

  const ensureEntry = p => {
    if (!updatesByPlayerId.has(p.id)) {
      updatesByPlayerId.set(p.id, {
        playerId: p.id,
        wed: null,
        thu: null,
        fri: null,
        slotPubMs: { wed: 0, thu: 0, fri: 0 },
        injuryType: '',
        openedPracticeWindow: false,
        hasSideFieldRehab: false,
        latestNote: '',
        latestPubMs: 0
      });
    }
    return updatesByPlayerId.get(p.id);
  };

  const koMsForGuard = kickoffIso ? Date.parse(kickoffIso) : NaN;
  const koLeadDays = Number.isFinite(koMsForGuard)
    ? getPracticeReportLeadDays(extractPtDayMeta(koMsForGuard).weekday)
    : 4;

  const isSlotCausallyValid = (slot, pubMs) => {
    if (!slot) return false;
    if (Number.isFinite(koMsForGuard)) {
      const refMs = Number.isFinite(pubMs) && pubMs > 0 ? Math.min(pubMs, nowMs) : nowMs;
      if (refMs < koMsForGuard) {
        const hoursBeforeKo = (koMsForGuard - refMs) / 3_600_000;
        if (slot === 'wed' && hoursBeforeKo > koLeadDays * 24 + 18) return false;
        if (slot === 'thu' && hoursBeforeKo > (koLeadDays - 1) * 24 + 16) return false;
        if (slot === 'fri' && hoursBeforeKo > (koLeadDays - 2) * 24 + 16) return false;
      }
    }
    return true;
  };

  const recordSlotCode = (p, slot, code, injHint, noteText, pubMs, sideField = false) => {
    if (!p || !slot || !code) return;
    if (!isSlotCausallyValid(slot, pubMs)) return;
    const rec = ensureEntry(p);
    const effPub = Number.isFinite(pubMs) ? pubMs : 0;
    const prevSlotPub = rec.slotPubMs?.[slot] || 0;
    if (rec[slot] && effPub > 0 && prevSlotPub > 0 && effPub < prevSlotPub) {
      return;
    }
    const hasNonRestMedicalHint = Boolean(injHint && !isRestOrPersonalInjuryLabel(injHint));
    const isRest =
      !hasNonRestMedicalHint &&
      (isRestOrPersonalInjuryLabel(injHint) || isRestOrPersonalInjuryLabel(p.health?.injuryType));
    const finalCode = code === 'DNP' && isRest ? 'Vet Rest' : code;
    rec[slot] = finalCode;
    if (rec.slotPubMs && effPub >= prevSlotPub) {
      rec.slotPubMs[slot] = effPub;
    }
    if (injHint && (!rec.injuryType || (isRestOrPersonalInjuryLabel(rec.injuryType) && hasNonRestMedicalHint))) {
      rec.injuryType = injHint;
    }
    if (sideField) rec.hasSideFieldRehab = true;
    if (pubMs >= rec.latestPubMs && noteText) {
      rec.latestPubMs = pubMs;
      rec.latestNote = noteText;
    }
  };

  const matchPlayersInSegment = (segmentText, { allowSurname = true, primaryOwnerId = '' } = {}) => {
    const matched = [];
    for (const p of rosterPlayers) {
      const pidStr = String(p.id || '');
      const isPrimaryOwner = Boolean(primaryOwnerId && pidStr === primaryOwnerId);
      // For single-player `espn_pwire_<ownerId>_*` blurbs, only the owning player may match via surname!
      const effectiveAllowSurname = primaryOwnerId ? isPrimaryOwner && allowSurname : allowSurname;
      if (
        doesClauseMentionPlayer(segmentText, p.name, {
          allowSurname: effectiveAllowSurname,
          playerPosition: p.position || '',
          sharedSurnames: sharedRosterSurnames,
          isPrimaryOwner
        })
      ) {
        matched.push(p);
      }
    }
    return matched;
  };

  const POS_LIST_LOOKAHEAD =
    '(?:qb|rb|fb|wr|te|ol|ot|og|lt|lg|c|rg|rt|dl|dt|de|edge|nt|lb|ilb|olb|mlb|cb|nb|db|s|fs|ss|saf|k|pk|p|ls)s?\\s+[A-Z]';
  const STRUCTURED_HEADER_TOKEN_RE = new RegExp(
    `\\b(not partic?ipating|did not participate|did not practice|non-participants?|dnp\\s*:|no practice(?:\\s+for)?\\s*(?::|(?=${POS_LIST_LOOKAHEAD}))|limited(?:\\s+participants?|\\s+participation)?\\s*(?::|(?=${POS_LIST_LOOKAHEAD}))|lp\\s*:|full(?:\\s+participants?|\\s+participation)?\\s*(?::|(?=${POS_LIST_LOOKAHEAD}))|fp\\s*:)`,
    'gi'
  );

  for (const { fullBody, pubMs, primaryOwnerId } of eligibleItems) {
    const slot = resolvePracticeSlotFromReportTiming({
      text: fullBody,
      publishedAtMs: pubMs,
      kickoffIso,
      seasonYear
    });

    // 1. Check 21-day IR practice window openings regardless of slot
    if (
      /\b(?:designated\b[^.]{0,80}\bto return from (?:injured reserve|the pup list)|opened (?:the )?(?:[a-z']+s? )?(?:21-day |injured reserve |ir |pup )?practice window)\b/i.test(
        fullBody
      ) &&
      !/\b(?:could|might|may|hopeful to|plan(?:s|ning)? to|expect(?:s|ed|ing)? to)\s+open\b/i.test(fullBody)
    ) {
      const winSentences = fullBody.split(/(?<=[.!?])\s+/);
      for (const ws of winSentences) {
        if (
          /\b(?:designated\b[^.]{0,80}\bto return|opened (?:the )?(?:[a-z']+s? )?(?:21-day |injured reserve |ir |pup )?practice window)\b/i.test(
            ws
          )
        ) {
          for (const p of matchPlayersInSegment(ws, { primaryOwnerId })) {
            const rec = ensureEntry(p);
            rec.openedPracticeWindow = true;
            const inj = extractParentheticalInjuryForPlayer(ws, p.name, sharedRosterSurnames);
            if (inj && !rec.injuryType) rec.injuryType = inj;
          }
        }
      }
    }

    if (!slot) continue;

    // 2. Check structured beat practice-report list format (e.g., "49ers/Vikings participation report No practice WR ...")
    const activeTeamPr = getActiveTeamConfig();
    const prTeamPat = [activeTeamPr?.nickname, activeTeamPr?.city, ...(activeTeamPr?.abbr === 'SF' ? ['niners'] : [])]
      .filter(Boolean)
      .map(s => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
      .join('|');
    const isOfficialParticipationSummary =
      new RegExp(`\\b#?(?:${prTeamPat || '49ers'})\\b[\\s\\S]{0,42}\\b(?:participation|injury|practice)\\s+report\\b`, 'i').test(
        fullBody
      ) && !/\bpre[- ]practice\b/i.test(fullBody);
    const headerMatches = [...fullBody.matchAll(STRUCTURED_HEADER_TOKEN_RE)];
    if (headerMatches.length >= 2 || (headerMatches.length === 1 && isOfficialParticipationSummary)) {
      let matchedStructuredCount = 0;
      for (let idx = 0; idx < headerMatches.length; idx++) {
        const hdrRaw = headerMatches[idx][0].toLowerCase();
        const segStart = headerMatches[idx].index + headerMatches[idx][0].length;
        const segEnd = idx + 1 < headerMatches.length ? headerMatches[idx + 1].index : fullBody.length;
        const segBody = fullBody.slice(segStart, segEnd).trim();
        let segCode = null;
        if (/^(?:full|fp)/.test(hdrRaw)) segCode = 'FP';
        else if (/^(?:limited|lp)/.test(hdrRaw)) segCode = 'LP';
        else segCode = 'DNP';

        for (const p of matchPlayersInSegment(segBody, { primaryOwnerId })) {
          const inj = extractParentheticalInjuryForPlayer(segBody, p.name, sharedRosterSurnames);
          recordSlotCode(p, slot, segCode, inj, fullBody, pubMs, false);
          matchedStructuredCount += 1;
        }
      }
      if (isOfficialParticipationSummary && matchedStructuredCount >= 2 && isSlotCausallyValid(slot, pubMs)) {
        fullReportObservedSlots.add(slot);
        updatesByPlayerId._latestFullReportPubMs = Math.max(
          updatesByPlayerId._latestFullReportPubMs || 0,
          Number.isFinite(pubMs) ? pubMs : 0
        );
      }
      continue;
    }

    // 3. Clause-by-clause prose parsing (with pronoun carryover from immediately preceding single-player sentence!)
    const sentences = fullBody
      .split(/(?<=[.!?])\s+|\s*[;\n]+\s*/)
      .map(s => s.trim())
      .filter(Boolean);

    let prevSolePlayer = null;

    for (const sent of sentences) {
      const sentPlayers = matchPlayersInSegment(sent, { primaryOwnerId });
      const subClauses = sent
        .split(/,\s*(?=(?:while|whereas|but|though|although)\s+)/i)
        .map(c => c.trim())
        .filter(Boolean);

      const hasSideFieldInSent = SIDE_FIELD_REHAB_OBSERVATION_RE.test(sent);

      for (const clause of subClauses) {
        if (FUTURE_PRACTICE_EXPECTATION_GUARD_RE.test(clause)) continue;

        let clausePlayers = matchPlayersInSegment(clause, { primaryOwnerId });
        if (
          prevSolePlayer &&
          /^(?:he|the (?:rookie|veteran|wideout|receiver|cornerback|defender|lineman|linebacker|tight end|running back))\b/i.test(
            clause
          ) &&
          !clausePlayers.some(cp => cp.id === prevSolePlayer.id)
        ) {
          clausePlayers = [prevSolePlayer, ...clausePlayers];
        }
        if (clausePlayers.length === 0) continue;

        // Determine explicit observed participation code in this clause
        const clauseSlotOverride =
          resolvePracticeSlotFromReportTiming({
            text: clause,
            publishedAtMs: null,
            kickoffIso,
            seasonYear
          }) || slot;

        const isDnpClause =
          /\b(?:not practicing(?:\s+today)?|are not practicing|is not practicing|did not practice|didn['’]?t practice|did not participate|didn['’]?t participate|not partic?ipating|non-participant|no practice for|missed\s+(?:(?:monday|tuesday|wednesday|thursday|friday|saturday|today)(?:['’]?s)?\s+)?practice|held out of\s+(?:(?:monday|tuesday|wednesday|thursday|friday|saturday|today)(?:['’]?s)?\s+)?practice|absent from\s+(?:(?:monday|tuesday|wednesday|thursday|friday|saturday|today)(?:['’]?s)?\s+)?practice|was an observer|observer for|sat out\s+(?:practice|monday|tuesday|wednesday|thursday|friday|saturday|today)|sidelined\s+(?:at|for|in)\s+practice)\b/i.test(
            clause
          );
        const isLpClause =
          !isDnpClause &&
          /\b(?:is limited(?:\s+today)?(?:\s+at|\s+in)?\s*practice|was (?:a )?limited(?:\s+practice)?\s*participant|was limited\s+(?:in|at|on|monday|tuesday|wednesday|thursday|friday|saturday|today)|limited\s+in\s+(?:monday|tuesday|wednesday|thursday|friday|saturday|today)(?:['’]?s)?\s*practice|limited\s+(?:practice\s+)?participant|limited\s+participation|practiced\s+(?:on\s+a\s+limited\s+basis|in\s+a\s+limited\s+(?:capacity|role))|upgraded\s+to\s+(?:a\s+)?limited|returned\s+to\s+limited\s+practice|logged\s+a\s+(?:limited|capped)\s+(?:session|practice)|limited\s+today\s+at\s+practice)\b/i.test(
            clause
          );
        const isFpClause =
          !isDnpClause &&
          !isLpClause &&
          /\b(?:full\s+(?:practice\s+)?participant|practiced\s+in\s+full|practiced\s+fully|practiced\s+without\s+(?:limitations|restrictions)|upgraded\s+to\s+(?:a\s+)?full\s+(?:practice|session|participant)|logged\s+a\s+full\s+(?:session|practice)|full\s+participation\s+(?:in|at|on)|was\s+a\s+full\s+participant|full\s+go\s+at\s+practice)\b/i.test(
            clause
          );

        const code = isDnpClause ? 'DNP' : isLpClause ? 'LP' : isFpClause ? 'FP' : null;
        if (code) {
          for (const cp of clausePlayers) {
            const ownerAllowed = Boolean(primaryOwnerId && String(cp.id || '') === primaryOwnerId);
            const inj =
              extractParentheticalInjuryForPlayer(
                clause,
                cp.name,
                ownerAllowed ? null : sharedRosterSurnames
              ) ||
              extractParentheticalInjuryForPlayer(
                sent,
                cp.name,
                ownerAllowed ? null : sharedRosterSurnames
              );
            recordSlotCode(
              cp,
              clauseSlotOverride,
              code,
              inj,
              sent,
              pubMs,
              code === 'DNP' && hasSideFieldInSent
            );
          }
        } else if (hasSideFieldInSent && clausePlayers.length === 1) {
          const rec = ensureEntry(clausePlayers[0]);
          rec.hasSideFieldRehab = true;
        }
      }

      if (sentPlayers.length === 1) {
        prevSolePlayer = sentPlayers[0];
      } else if (sentPlayers.length > 1) {
        prevSolePlayer = null;
      }
    }
  }

  return updatesByPlayerId;
}

function buildRoleInformedDefaultPrior({ position = '', experienceYears = null, snapPct = null } = {}) {
  const posUpper = String(position || '').toUpperCase();
  const exp = Number(experienceYears);
  const snaps = Number(snapPct);
  const isHighSnapStarter = Number.isFinite(snaps) && snaps >= 70;
  const isExperiencedVet = Number.isFinite(exp) && exp >= 7;

  if (isExperiencedVet && isHighSnapStarter) {
    return {
      isVeteranRestHabitual: true,
      usualRestDays: ['Wed'],
      questionablePlayRate: 0.84,
      chronicParts: [],
      archetypeNote: `Veteran starter profile (${exp}th NFL season, ${Math.round(snaps)}% snap share) — elevated Questionable active conversion (84%) & Wednesday maintenance tolerance.`
    };
  }
  if (isHighSnapStarter) {
    return {
      isVeteranRestHabitual: false,
      usualRestDays: [],
      questionablePlayRate: 0.82,
      chronicParts: [],
      archetypeNote: `Every-down starter workload (${Math.round(snaps)}% snaps) — 82% active conversion baseline when logging Limited Friday reps.`
    };
  }
  if (['WR', 'CB', 'RB'].includes(posUpper)) {
    return {
      isVeteranRestHabitual: false,
      usualRestDays: [],
      questionablePlayRate: 0.76,
      chronicParts: [],
      archetypeNote: `Perimeter speed/cut position (${posUpper}) — requires full deceleration/burst clearance on lower-body tags (76% Questionable baseline).`
    };
  }
  if (['OL', 'OT', 'OG', 'G', 'C', 'T', 'DT', 'DL', 'NT', 'LB', 'ILB', 'MLB'].includes(posUpper)) {
    return {
      isVeteranRestHabitual: isExperiencedVet,
      usualRestDays: isExperiencedVet ? ['Wed'] : [],
      questionablePlayRate: 0.81,
      chronicParts: [],
      archetypeNote: `Trench/box position (${posUpper}) — historically higher active rate through braced upper-body & ankle soreness (81% baseline).`
    };
  }
  return {
    isVeteranRestHabitual: false,
    usualRestDays: [],
    questionablePlayRate: 0.78,
    chronicParts: [],
    archetypeNote: 'Standard NFL positional availability baseline (78% Questionable conversion).'
  };
}

/**
 * Computes projected next-game Play Likelihood (%) and explanatory factors for a player.
 */
export function computePlayerPlayProbability(input = {}) {
  const name = String(input.name || '').trim();
  const statusRaw = String(input.gameStatus || input.status || '').toLowerCase().trim();
  const rosterBucket = String(input.rosterBucket || 'active').toLowerCase();
  const injuryType = String(input.injuryType || '').trim();
  const injuryLower = injuryType.toLowerCase();
  const rawBeatInput = String(input.beatNote || input.comment || '');
  const scopedBeat = name ? scopeBeatTextToPlayer(rawBeatInput, name, input.rosterPlayerNames || []) : rawBeatInput;
  const beatNote = scopedBeat.toLowerCase();
  const fullBeatLower = rawBeatInput.toLowerCase();
  const newsSig = input.corroboratedNewsSignal?.hasSignal ? input.corroboratedNewsSignal : null;

  const roleDefaultPrior = buildRoleInformedDefaultPrior({
    position: input.position,
    experienceYears: input.experienceYears,
    snapPct: input.snapPct
  });

  const prior = {
    ...roleDefaultPrior,
    ...(CURATED_NFL_PLAYER_PRIORS[name] || {}),
    ...(input.customPrior || {})
  };

  const factors = [];

  // 1. Hard Roster / Official Ruling Flags & IR Return Window Activation
  const isSeasonEndingFlag =
    Boolean(input.isSeasonEnding) ||
    statusRaw.includes('season-ending') ||
    statusRaw.includes('out for season') ||
    /\b(out for (?:the )?(?:\d{4} )?season|miss the entire|done for the (?:year|season)|for the rest of the (?:year|season)|season-ending|without a designation to return|spend the entire (?:\d{4} )?season|stay on (?:the (?:team's )?)?(?:ir|injured reserve) (?:list )?for the (?:year|season))\b/i.test(
      beatNote || fullBeatLower
    );
  const isRosterExemptionFlag =
    String(input.fantasyStatusAbbr || '').toUpperCase() === 'RESERVE-EX' ||
    statusRaw.includes('roster exemption') ||
    /\b(?:granted a [a-z0-9 -]*roster exemption|two-week (?:unpaid )?roster exemption)\b/i.test(beatNote || fullBeatLower);
  const isReinstatementFlag =
    !isRosterExemptionFlag &&
    (beatNote.includes('looking to get reinstated') ||
      statusRaw.includes('left squad') ||
      statusRaw.includes('reinstatement'));

  const isIrBucketOrStatus =
    rosterBucket === 'ir' ||
    rosterBucket === 'injuredreserveorout' ||
    rosterBucket === 'pup' ||
    statusRaw === 'ir' ||
    statusRaw === 'injured reserve' ||
    statusRaw.includes('injured reserve') ||
    statusRaw.includes('21-day window') ||
    statusRaw.includes('ir return window') ||
    statusRaw.includes('reserve / pup') ||
    statusRaw === 'pup';

  const wed = normalizePracticeCode(input.wed, injuryType);
  const thu = normalizePracticeCode(input.thu, injuryType);
  const fri = normalizePracticeCode(input.fri, injuryType);
  const hasObservedPracticeThisWeek = wed !== 'NONE' || thu !== 'NONE' || fri !== 'NONE';
  const hasMidWeekActivePractice =
    fri === 'NONE' && (wed === 'LP' || wed === 'FP' || thu === 'LP' || thu === 'FP');
  const hasAnyActiveIrPracticeThisWeek =
    wed === 'LP' || wed === 'FP' || thu === 'LP' || thu === 'FP' || fri === 'LP' || fri === 'FP';

  // Sanitize prior-week Saturday non-activation carryover clauses for IR returners before checking current-week rulings
  const currentWeekIrNote = isIrBucketOrStatus
    ? sanitizeIrBeatNoteForCurrentWeek(scopedBeat, {
        currentWeek: input.currentWeek,
        upcomingOppName: input.upcomingOppName || '',
        upcomingOppAbbr: input.upcomingOppAbbr || '',
        blurbDateIso: input.blurbDateIso || null,
        lastCompletedGameKickoffMs: input.lastCompletedGameKickoffMs ?? null,
        hasCurrentWeekPractice: hasAnyActiveIrPracticeThisWeek
      }).toLowerCase()
    : beatNote;

  const beatNoteSignalsQuestionableActivation =
    !hasNegativePlayConsensusSignal(currentWeekIrNote) &&
    (currentWeekIrNote.includes('listed as questionable') ||
      currentWeekIrNote.includes('questionable for sunday') ||
      currentWeekIrNote.includes('questionable ahead of') ||
      hasAffirmativePlayOrActivationSignal(currentWeekIrNote));

  const affirmativeRuledOut =
    Boolean(newsSig && newsSig.signalType === 'RULED_OUT_WEEK' && newsSig.confidence >= 0.6) ||
    (!hasMidWeekActivePractice && hasAffirmativeRuledOutSignal(isIrBucketOrStatus ? currentWeekIrNote : beatNote));

  const irWindowEval = isIrBucketOrStatus
    ? evaluateWeeklyIrActivationWindow({
        kickoffIso: input.kickoffIso || '',
        designatedDateIso: input.designatedDateIso || '',
        nowMs: input.nowMs ?? Date.now(),
        schedule: input.schedule || [],
        seasonConcluded: Boolean(input.seasonConcluded)
      })
    : {
        hasMissedWeeklyDeadline: false,
        isSeasonConcluded: false,
        windowWeekStage: null,
        is21DayWindowExpired: false
      };

  const hasOpenIr21DayWindow =
    Boolean(input.isPracticeWindowOpen) ||
    Boolean(input.isIrReturnQuestionable) ||
    statusRaw.includes('21-day window open') ||
    statusRaw.includes('ir return window') ||
    (isIrBucketOrStatus &&
      !hasWindowDefinitelyNotOpeningSignal(currentWeekIrNote) &&
      (statusRaw === 'questionable' ||
        beatNoteSignalsQuestionableActivation ||
        hasAnyActiveIrPracticeThisWeek ||
        /\b(?:opened\s+(?:the\s+|his\s+|[a-z']+s?\s+)?(?:21-day\s+|injured\s+reserve\s+|ir\s+|pup\s+)?practice\s+window|designated\b[^.;]{0,65}\bto\s+return\s+from)\b/i.test(
          currentWeekIrNote
        )));

  const newsRulesOutIrThisWeek =
    isIrBucketOrStatus &&
    (hasDefiniteIrNonActivationOrWindowClosedSignal(currentWeekIrNote) ||
      Boolean(
        newsSig &&
          (newsSig.signalType === 'IR_NOT_ACTIVATING_THIS_WEEK' ||
            newsSig.signalType === 'WINDOW_NOT_OPENING_THIS_WEEK' ||
            newsSig.signalType === 'RULED_OUT_WEEK') &&
          newsSig.confidence >= 0.35
      ));

  const missedWeeklyIrWindow =
    isIrBucketOrStatus &&
    !input.activatedToActiveRoster &&
    (Boolean(input.missedActivationWindow) ||
      irWindowEval.isSeasonConcluded ||
      irWindowEval.hasMissedWeeklyDeadline ||
      irWindowEval.is21DayWindowExpired);

  // Active 21-day IR/PUP return candidate who MAY get activated and play this week (`% GTD > 0`)
  const isIrReturnQuestionable =
    !isSeasonEndingFlag &&
    !isRosterExemptionFlag &&
    !isReinstatementFlag &&
    rosterBucket !== 'suspended' &&
    statusRaw !== 'suspended' &&
    statusRaw !== 'out' &&
    !affirmativeRuledOut &&
    !newsRulesOutIrThisWeek &&
    !missedWeeklyIrWindow &&
    (Boolean(input.isIrReturnQuestionable) || (isIrBucketOrStatus && hasOpenIr21DayWindow));

  // Practice Squad players are NOT on the 53-man active game-day roster unless elevated/signed
  if (rosterBucket === 'practice_squad' && !input.activatedToActiveRoster) {
    const isPsInjured =
      statusRaw.includes('injured') ||
      statusRaw.includes('ps/ir') ||
      statusRaw === 'practice squad / injured';
    return {
      probabilityPct: 0,
      tier: 'PRACTICE_SQUAD',
      badgeLabel: isPsInjured ? '0% • PS (Injured)' : '0% • Prac. Squad',
      priorUsed: prior,
      factors: [
        isPsInjured
          ? 'On Practice Squad / Injured list — ineligible for game day'
          : 'On Practice Squad — ineligible for game day unless elevated to the 53-man active roster'
      ]
    };
  }

  if (
    !isIrReturnQuestionable &&
    (isSeasonEndingFlag ||
      isRosterExemptionFlag ||
      isReinstatementFlag ||
      isIrBucketOrStatus ||
      rosterBucket === 'suspended' ||
      statusRaw === 'out' ||
      statusRaw === 'suspended' ||
      affirmativeRuledOut)
  ) {
    let badgeLabel = '0% • Out';
    if (isSeasonEndingFlag) {
      badgeLabel = '0% • Out for Season';
      factors.push('Season-ending Injured Reserve — ineligible to return this season');
    } else if (isRosterExemptionFlag) {
      badgeLabel = '0% • Roster Exemption';
      factors.push('Two-week NFL roster exemption — not on 53-man active game-day roster');
    } else if (isReinstatementFlag) {
      badgeLabel = '0% • Reinstatement';
      factors.push('Reserve / Left Squad — requires formal NFL & club reinstatement');
    } else if (rosterBucket === 'suspended' || statusRaw === 'suspended') {
      badgeLabel = '0% • Suspended';
      factors.push('Reserve / Suspended — ineligible until suspension concludes');
    } else if (isIrBucketOrStatus) {
      const isPupReserve =
        rosterBucket === 'pup' || statusRaw === 'pup' || statusRaw.includes('physically unable') || statusRaw.includes('reserve / pup');
      badgeLabel = isPupReserve ? '0% • Reserve/PUP' : '0% • IR';
      if (irWindowEval.isSeasonConcluded) {
        factors.push(`${getActiveTeamConfig().nickname} season concluded — remains on Injured Reserve entering offseason`);
      } else if (irWindowEval.is21DayWindowExpired) {
        factors.push('21-day IR practice window expired without 53-man roster activation');
      } else if (missedWeeklyIrWindow) {
        factors.push('Missed weekly NFL 53-man IR activation deadline — remains on Injured Reserve for this game');
      } else if (
        hasWindowDefinitelyNotOpeningSignal(currentWeekIrNote) ||
        newsSig?.signalType === 'WINDOW_NOT_OPENING_THIS_WEEK' ||
        newsSig?.hasWindowNotOpeningSignal
      ) {
        factors.push('Coaching/beat report indicates 21-day practice window will not be opened this week');
      } else if (newsRulesOutIrThisWeek || statusRaw === 'out' || affirmativeRuledOut) {
        factors.push('Coaching/beat report confirms player will not be activated from IR this week');
      } else if (isPupReserve) {
        factors.push('Reserve / Physically Unable to Perform — 21-day window required before activation');
      } else {
        factors.push('On Injured Reserve — 21-day practice window not yet opened');
      }
    } else {
      factors.push('Officially ruled Out on weekly game status report');
    }

    return {
      probabilityPct: 0,
      tier: 'OUT',
      badgeLabel,
      priorUsed: prior,
      factors
    };
  }

  // Dedicated Joint Probability Model for Open 21-Day IR/PUP Window Candidates: P(Activated to 53-Man Roster ∩ Plays)
  if (isIrBucketOrStatus && isIrReturnQuestionable) {
    const curWkNum = Number.isFinite(Number(input.currentWeek)) ? Number(input.currentWeek) : null;
    const minEligWkNum =
      Number.isFinite(Number(input.earliestEligibleWeek)) && Number(input.earliestEligibleWeek) > 0
        ? Number(input.earliestEligibleWeek)
        : 1;
    const priorWindowPracticeEntries =
      curWkNum !== null && Array.isArray(input.weeklyHistory)
        ? input.weeklyHistory.filter(h => {
            const wk = Number(h?.week || 0);
            return (
              wk >= minEligWkNum &&
              wk < curWkNum &&
              curWkNum - wk <= 3 &&
              /\b(?:limited|full|^lp$|^fp$)\b/i.test(String(h?.practiceStatus || '').trim())
            );
          })
        : [];
    const distinctPriorWindowWeeks = new Set(priorWindowPracticeEntries.map(h => Number(h.week))).size;
    const historyStage =
      distinctPriorWindowWeeks >= 2 ? 3 : distinctPriorWindowWeeks === 1 ? 2 : null;
    const lastWindowHistEntry =
      priorWindowPracticeEntries.sort((a, b) => Number(b.week) - Number(a.week))[0] || null;

    const inferredStage =
      irWindowEval.windowWeekStage ||
      historyStage ||
      (/\b(?:third\s+week|final\s+week|ample\s+time\s+to\s+activate)\b/i.test(fullBeatLower)
        ? 3
        : /\b(?:second\s+week|trio\s+of\s+(?:full|limited)\s+practices|three\s+(?:full|limited)\s+practices|wasn't\s+activated\s+saturday|upgraded\s+to\s+a\s+full\s+practice\s+session\s+friday)\b/i.test(
              fullBeatLower
            )
          ? 2
          : 1);

    const hasOfficialQTag =
      statusRaw === 'questionable' ||
      Boolean(input.isIrReturnQuestionable && statusRaw === 'questionable') ||
      /\b(?:listed\s+as\s+questionable|questionable\s+for\s+(?:sunday|monday|thursday|saturday)|questionable\s+ahead\s+of)\b/i.test(
        currentWeekIrNote
      );

    let irProb = 0.52;
    if (statusRaw === 'doubtful') {
      irProb = 0.14;
      factors.push('21-day IR window open, but tagged Doubtful on weekly status report (~14% activation odds)');
    } else if (fri === 'FP') {
      irProb = (inferredStage >= 3 ? 0.80 : inferredStage === 2 ? 0.76 : 0.68) + (hasOfficialQTag ? 0.04 : 0);
      factors.push(`21-day IR window open (Week ${inferredStage} ramp); logged Full Participation (FP) on Friday`);
    } else if (fri === 'LP') {
      if (wed === 'DNP' && thu === 'DNP') {
        irProb = 0.36;
        factors.push('21-day IR window open; first Limited session on Friday after Wed/Thu DNP');
      } else {
        irProb =
          (inferredStage >= 3 ? 0.68 : inferredStage === 2 ? 0.62 : 0.56) +
          (hasOfficialQTag ? 0.08 : 0) +
          (prior.questionablePlayRate - 0.78) * 0.35;
        factors.push(
          `21-day IR window open (Week ${inferredStage} ramp); Friday Limited (LP)${hasOfficialQTag ? ' + official Questionable tag' : ''}`
        );
      }
    } else if (fri === 'DNP') {
      irProb = 0.12;
      factors.push('21-day IR window open, but Friday DNP sharply lowers weekly 53-man activation likelihood');
    } else if (thu === 'FP') {
      irProb = inferredStage >= 3 ? 0.80 : inferredStage === 2 ? 0.76 : 0.68;
      factors.push(`21-day IR window open (Week ${inferredStage} ramp); logged Full Participation (FP) on Thursday`);
    } else if (thu === 'DNP' && (wed === 'LP' || wed === 'FP')) {
      irProb = 0.26;
      factors.push('21-day IR window setback alert: downgraded to Thursday DNP after practicing Wednesday');
    } else if (thu === 'LP') {
      irProb =
        wed === 'DNP'
          ? inferredStage >= 2
            ? 0.56
            : 0.48
          : inferredStage >= 3
            ? 0.68
            : inferredStage === 2
              ? 0.62
              : 0.54;
      factors.push(`21-day IR window open (Week ${inferredStage} ramp); logging Limited Participation (LP)`);
    } else if (wed === 'DNP' && thu === 'DNP') {
      irProb = 0.18;
      factors.push('21-day IR window open, but consecutive Wed/Thu DNPs');
    } else if (wed === 'FP') {
      irProb = inferredStage >= 3 ? 0.78 : inferredStage === 2 ? 0.74 : 0.65;
      factors.push(`21-day IR window open (Week ${inferredStage} ramp); Full Participation (FP) on Wednesday`);
    } else if (wed === 'LP') {
      irProb = inferredStage >= 3 ? 0.66 : inferredStage === 2 ? 0.60 : 0.52;
      factors.push(`21-day IR window open (Week ${inferredStage} ramp); returned to Limited Participation (LP) Wednesday`);
    } else if (wed === 'DNP') {
      irProb = 0.24;
      factors.push('21-day IR window open; Did Not Participate (DNP) on Wednesday');
    } else {
      // Early-week pre-practice rollover (Mon/Tue/Wed AM) with open 21-day practice window
      irProb = inferredStage >= 3 ? 0.62 : inferredStage === 2 ? 0.54 : 0.44;
      if (/\b(?:trio\s+of\s+full\s+practices|three\s+full\s+practices)\b/i.test(fullBeatLower)) {
        irProb += 0.12;
        factors.push(`21-day IR window open (Week ${inferredStage}); completed three Full Practices last week`);
      } else if (/\bupgraded\s+to\s+a\s+full\s+practice\s+session\s+friday\b/i.test(fullBeatLower)) {
        irProb += 0.08;
        factors.push(`21-day IR window open (Week ${inferredStage}); upgraded to Friday Full Practice last week`);
      } else if (/\b(?:three\s+limited\s+practices|trio\s+of\s+limited\s+practices)\b/i.test(fullBeatLower)) {
        irProb += 0.05;
        factors.push(`21-day IR window open (Week ${inferredStage}); logged three Limited sessions last week`);
      } else if (lastWindowHistEntry && /\bfull|^fp$/i.test(String(lastWindowHistEntry.practiceStatus || '').trim())) {
        irProb += 0.08;
        factors.push(`21-day IR window open (Week ${inferredStage}); logged Full Participation in prior week's ramp`);
      } else if (lastWindowHistEntry && /\blimited|^lp$/i.test(String(lastWindowHistEntry.practiceStatus || '').trim())) {
        irProb += 0.04;
        factors.push(`21-day IR window open (Week ${inferredStage}); logged Limited Participation in prior week's ramp`);
      } else {
        factors.push(`21-day IR practice window open (Week ${inferredStage}); awaiting current-week practice ramp`);
      }
    }

    if ((Number(input.snapPct) >= 55 || Boolean(input.isStarter)) && irProb >= 0.30) {
      irProb += 0.03;
      factors.push('Starter / core rotational role increases 53-man roster activation priority (+3%)');
    }

    const matchesIrChronic = prior.chronicParts.some(part => injuryLower.includes(part.toLowerCase()));
    if (HIGH_CAUTION_STRUCTURAL_KEYWORDS.some(k => injuryLower.includes(k)) && fri !== 'FP' && thu !== 'FP') {
      irProb -= 0.05;
      factors.push(`Structural joint/surgery ramp-up caution (${injuryType})`);
    } else if ((SOFT_TISSUE_KEYWORDS.some(k => injuryLower.includes(k)) || matchesIrChronic) && fri !== 'FP') {
      irProb -= 0.04;
      factors.push(`Soft-tissue / recurrence ramp-up caution (${injuryType})`);
    } else if (MINOR_PAIN_TOLERANCE_KEYWORDS.some(k => injuryLower.includes(k)) && irProb >= 0.45) {
      irProb += 0.03;
    }

    if (newsSig) {
      const conf = newsSig.confidence;
      const srcLabel =
        newsSig.corroboratingCount >= 2
          ? `${newsSig.corroboratingCount} corroborated reports`
          : newsSig.hasCoachOrGmQuote
            ? 'coaching staff report'
            : 'beat report';
      if (newsSig.signalType === 'UNLIKELY_THIS_WEEK') {
        const blend = Math.min(0.86, conf * 0.94);
        irProb = Math.min(irProb, irProb * (1 - blend) + 0.20 * blend);
        factors.push(`Coaching/beat consensus (${srcLabel}): unlikely to be activated this week`);
      } else if (newsSig.signalType === 'TRENDING_DOWNWARD') {
        const target = newsSig.hasLateSetback ? 0.24 : 0.34;
        const blend = Math.min(0.80, conf * 0.86);
        irProb = Math.min(irProb, irProb * (1 - blend) + target * blend);
        factors.push(`Coaching/beat trend (${srcLabel}): trending downward for activation this week`);
      } else if (newsSig.signalType === 'EXPECTED_TO_PLAY') {
        const blend = Math.min(0.88, conf * 0.92);
        irProb = Math.max(irProb, irProb * (1 - blend) + 0.82 * blend);
        factors.push(`Coaching/beat consensus (${srcLabel}): expected to be activated from IR`);
      } else if (newsSig.signalType === 'TRENDING_UPWARD') {
        const target = Math.min(0.80, Math.max(irProb + 0.08, 0.72));
        const blend = Math.min(0.76, conf * 0.82);
        irProb = Math.max(irProb, irProb * (1 - blend) + target * blend);
        factors.push(`Coaching/beat trend (${srcLabel}): trending upward toward IR activation`);
      } else if (newsSig.signalType === 'OBSERVED_DNP_PRACTICE' && !hasObservedPracticeThisWeek) {
        irProb = Math.min(irProb, 0.24);
        factors.push(`Beat practice observation (${srcLabel}): did not practice today`);
      } else if (newsSig.signalType === 'OBSERVED_PRACTICE_RETURN' && !hasObservedPracticeThisWeek) {
        irProb = Math.max(irProb, 0.54);
        factors.push(`Beat practice observation (${srcLabel}): practicing in 21-day window`);
      }
    } else if (hasNegativePlayConsensusSignal(currentWeekIrNote)) {
      irProb = Math.min(irProb, 0.22);
      factors.push('Beat consensus: long shot to be activated this week');
    } else if (hasTrendingDownwardSignal(currentWeekIrNote)) {
      irProb = Math.min(irProb, Math.max(0.24, irProb - 0.16));
      factors.push('Beat trend: trending downward / setback caution for activation');
    } else if (hasAffirmativePlayOrActivationSignal(currentWeekIrNote)) {
      irProb = Math.max(irProb, 0.80);
      factors.push('Coaching/beat consensus: expected to be activated ahead of game');
    } else if (hasTrendingUpwardSignal(currentWeekIrNote)) {
      irProb = Math.max(irProb, Math.min(0.78, irProb + 0.08));
      factors.push('Beat trend: trending upward toward IR activation');
    }

    factors.push('Requires formal 53-man roster activation prior to weekly NFL transaction deadline');

    // Cap unactivated IR candidates at 84% (`GTD`) until formally activated onto the 53-man active roster
    const irPct = Math.max(1, Math.min(84, Math.round(irProb * 100)));
    const irTier = irPct >= 50 ? 'FIFTY_FIFTY' : irPct >= 20 ? 'UNLIKELY' : 'DOUBTFUL';
    return {
      probabilityPct: irPct,
      tier: irTier,
      badgeLabel: `${irPct}% • ${formatPlayTierLabel(irTier)}`,
      priorUsed: prior,
      factors
    };
  }

  if (isIrReturnQuestionable) {
    factors.push('21-day IR practice window active; officially listed Questionable for activation');
    if (
      !hasNegativePlayConsensusSignal(beatNote) &&
      (beatNote.includes('likely will be activated') || beatNote.includes('expected to be activated'))
    ) {
      factors.push('Coaching staff signaled likely roster activation ahead of kickoff');
    }
  }

  // Healthy / Unlisted Active Player
  if (
    !injuryType &&
    !statusRaw &&
    !hasObservedPracticeThisWeek &&
    !beatNote.includes('questionable') &&
    !beatNote.includes('doubtful') &&
    !hasNegativePlayConsensusSignal(beatNote) &&
    !(newsSig && newsSig.direction < 0)
  ) {
    return {
      probabilityPct: 99,
      tier: 'ACTIVE',
      badgeLabel: '99% • Full Go',
      priorUsed: prior,
      factors: ['Off injury report; full active status']
    };
  }

  // 3. Veteran Rest Pattern Check (e.g., Trent Williams / Nick Bosa / CMC / Buckner / Crosby / Kolton Miller)
  // Strictly requires NO restrictive game designation (Questionable/Doubtful/Out), NO real body-part injury,
  // and NO Limited/DNP medical injury progression later in the week (e.g. Trent Williams Shoulder Thu LP -> Fri DNP = NOT Vet Rest!).
  const hasRealMedicalInjury =
    Boolean(injuryLower) &&
    !isRestOrPersonalInjuryLabel(injuryLower) &&
    !/^(?:cleared|none|healthy|active)\b/i.test(injuryLower);
  const hasMidOrLateWeekMedicalLimit =
    thu === 'LP' ||
    fri === 'LP' ||
    (thu === 'DNP' && (wed === 'LP' || wed === 'FP' || hasRealMedicalInjury)) ||
    (fri === 'DNP' && (wed === 'LP' || wed === 'FP' || thu === 'LP' || thu === 'FP' || hasRealMedicalInjury || statusRaw === 'questionable'));
  const hasRestrictiveDesignation =
    statusRaw === 'questionable' || statusRaw === 'doubtful' || statusRaw === 'out';

  const isPureVetRest =
    !hasRestrictiveDesignation &&
    !hasRealMedicalInjury &&
    !hasMidOrLateWeekMedicalLimit &&
    (injuryLower.includes('rest') ||
      injuryLower.includes('not injury related') ||
      (prior.isVeteranRestHabitual &&
        (wed === 'DNP_REST' || (wed === 'DNP' && (thu === 'FP' || fri === 'FP') && !injuryType))));

  if (isPureVetRest && !hasNegativePlayConsensusSignal(beatNote)) {
    factors.push(`Habitual Veteran Rest prior (${name || 'Veteran'} maintenance schedule)`);
    return {
      probabilityPct: 98,
      tier: 'ACTIVE',
      badgeLabel: '98% • Vet Rest (Full Go)',
      priorUsed: prior,
      factors
    };
  }

  const isConcussion =
    injuryLower.includes('concussion') || /\bconcussion protocol\b/i.test(beatNote);
  const clearedConcussion =
    hasClearedConcussionProtocolSignal(beatNote) ||
    Boolean(newsSig && newsSig.signalType === 'CLEARED_CONCUSSION_PROTOCOL' && newsSig.confidence >= 0.4) ||
    hasClearedConcussionProtocolSignal(newsSig?.leadClause || '');

  const priorAbsence = derivePriorWeekAbsenceProfile({
    weeklyHistory: input.weeklyHistory,
    currentWeek: input.currentWeek,
    byeWeek: input.byeWeek,
    rawStatus: input.priorWeekStatus || '',
    beatNote
  });
  const missedPriorGame =
    input.missedPriorGame != null ? Boolean(input.missedPriorGame) : priorAbsence.missedPriorGame;
  const consecutiveMissedGames =
    input.consecutiveMissedGames != null
      ? Number(input.consecutiveMissedGames) || 0
      : priorAbsence.consecutiveMissedGames;
  const priorWeekPracticed =
    input.priorWeekPracticed != null ? input.priorWeekPracticed : priorAbsence.priorWeekPracticed;
  const exitedPriorGameWithoutReturn =
    !missedPriorGame &&
    (Boolean(input.exitedPriorGameWithoutReturn) ||
      Boolean(newsSig?.exitedWithoutReturn) ||
      (/\b(?:exited\s+previous\s+game|unable\s+to\s+finish\s+(?:[\w' -]{0,20}\s+)?(?:game|contest)|did(?:n['’]?t|\s+not)\s+return|will\s+not\s+return|won['’]?t\s+return|(?:left|exited)\s+(?:[\w' -]{0,36}\s+)?(?:with|w\/)\s*(?:a|an|his|the(?:\s+same)?)\s+[a-z-]+)/i.test(
        beatNote
      ) &&
        !/\breturn\s+(?:any\s+)?(?:punts?|kicks?|kickoffs?)\b/i.test(beatNote)));
  const sustainedInLastGame =
    Boolean(input.sustainedInLastGame) ||
    exitedPriorGameWithoutReturn ||
    Boolean(newsSig && newsSig.signalType === 'SUSTAINED_IN_GAME_INJURY') ||
    (!missedPriorGame &&
      /\b(?:considered\s+day[-\s]+to[-\s]+day|is\s+(?:again\s+|still\s+)?day[-\s]+to[-\s]+day|has not been ruled out|hasn't been ruled out)\b/i.test(
        beatNote
      ));

  const priorCompletedWeekNum = (() => {
    const cw = Number(input.currentWeek || 0);
    if (!Number.isFinite(cw) || cw <= 1) return null;
    const bw = Number(input.byeWeek || 8);
    return cw - 1 === bw ? cw - 2 : cw - 1;
  })();
  const priorSameInjuryRecurrence = (() => {
    if (isConcussion || !injuryLower || isRestOrPersonalInjuryLabel(injuryLower)) return false;
    const primaryBodyToken = injuryLower.split(/[ ,/-]+/).filter(Boolean)[0] || '';
    if (!primaryBodyToken || primaryBodyToken.length < 3) return false;
    if (Boolean(newsSig?.isAggravation) || /\b(?:aggravat\w*|re-aggravat\w*|same\s+[a-z-]+\s+injury|already\s+playing\s+hurt)\b/i.test(beatNote)) {
      return true;
    }
    if (Array.isArray(input.weeklyHistory) && priorCompletedWeekNum && priorCompletedWeekNum >= 1) {
      return input.weeklyHistory.some(h => {
        const w = Number(h?.week || 0);
        if (w < Math.max(1, priorCompletedWeekNum - 1) || w > priorCompletedWeekNum) return false;
        const histInj = String(h?.injury || '').toLowerCase();
        return histInj.includes(primaryBodyToken);
      });
    }
    return false;
  })();

  // 4. Base Probability from Game Designation, NFL 5-Step Concussion Protocol, Illness Recovery Curve, or Practice Progression
  let prob = 0.78;
  const isPureIllness = !isConcussion && isPureIllnessLabel(injuryType);

  if (statusRaw === 'doubtful') {
    prob = 0.10 + (prior.questionablePlayRate - 0.78) * 0.25;
    factors.push('Official Doubtful tag (NFL historical base ~10–14%)');
  } else if (
    statusRaw !== 'questionable' &&
    !hasNegativePlayConsensusSignal(beatNote) &&
    !(newsSig && newsSig.direction < 0) &&
    (statusRaw === 'active' ||
      statusRaw === 'healthy' ||
      statusRaw.includes('no designation') ||
      statusRaw.includes('cleared') ||
      beatNote.includes('does not have a designation') ||
      beatNote.includes("doesn't have a designation") ||
      beatNote.includes('does not carry an official injury designation') ||
      beatNote.includes('no injury designation') ||
      beatNote.includes('good to go') ||
      beatNote.includes('set to return') ||
      beatNote.includes('prepared to return'))
  ) {
    prob = 0.95;
    factors.push('Cleared without restrictive game-day designation');
  } else if (isConcussion) {
    // Official NFL/NFLPA 5-Step Return-to-Participation Protocol:
    // Step 4 = non-contact football drills (LP); Step 5 = Full Football Activity (FP) + Independent Neurological Consultant (INC) clearance.
    if (clearedConcussion || fri === 'FP') {
      prob = 0.93;
      factors.push('Cleared Step-5 full-contact practice / NFL Concussion Protocol gate');
    } else if (fri === 'DNP') {
      prob = 0.06;
      factors.push('NFL Concussion Protocol: Friday DNP rarely clears Step-5 Independent Neurological exam (<7%)');
    } else if (fri === 'LP') {
      if (wed === 'DNP' && thu === 'DNP') {
        prob = 0.24;
        factors.push('NFL Concussion Protocol: first Limited non-contact session on Friday leaves narrow INC clearance window');
      } else {
        prob = 0.36;
        factors.push('NFL Concussion Protocol: Friday Limited (Step-4 non-contact); requires Saturday/pre-game Independent Neurological Consultant clearance');
      }
    } else if (thu === 'FP' || wed === 'FP') {
      prob = 0.86;
      factors.push('Logged mid-week Full Participation in NFL Concussion Protocol progression');
    } else if (thu === 'LP' || wed === 'LP') {
      prob = 0.44;
      factors.push('Mid-week Step-4 Limited non-contact participation in NFL Concussion Protocol');
    } else {
      prob = 0.18;
      factors.push('Remains in early stages of NFL 5-Step Concussion Protocol');
    }
  } else if (isPureIllness) {
    // Empirical NFL Illness Recovery Model:
    // Unlike orthopedic soft-tissue/structural setbacks, NFL teams routinely isolate sick players mid-week (Thu/Fri DNP)
    // to prevent locker-room contagion; historical active rates remain ~70–85% for Thu illness DNP and ~60–70% for Fri illness DNP
    // (dropping toward ~50% only for 3-day Wed–Fri DNPs or multi-week systemic absences).
    if (fri === 'FP') {
      prob = 0.95;
      factors.push('Logged Full Participation (FP) on Friday following illness');
    } else if (fri === 'LP') {
      if (wed === 'DNP' && thu === 'DNP') {
        prob = 0.82;
        factors.push('Returned to Friday Limited (LP) after Wed/Thu illness DNPs; strong weekend recovery trend');
      } else if (wed === 'FP' || thu === 'FP') {
        prob = 0.82;
        factors.push('Late-week mild illness (Friday Limited); high historical NFL play rate');
      } else {
        prob = 0.88;
        factors.push('Friday Limited (LP) with illness; NFL players overwhelmingly suit up');
      }
    } else if (fri === 'DNP') {
      if (wed === 'DNP' && thu === 'DNP') {
        prob = 0.50;
        factors.push('Missed Wed–Fri practices with persistent illness; true game-time decision (~50% NFL active rate)');
      } else {
        prob = 0.62;
        factors.push('Missed Friday practice with illness (team isolation/recovery protocol; ~60–70% NFL active rate pending pre-game hydration)');
      }
    } else {
      if (thu === 'FP') {
        prob = 0.94;
        factors.push('Logged Full Participation (FP) on Thursday following illness');
      } else if (thu === 'DNP' && (wed === 'LP' || wed === 'FP' || wed === 'NONE')) {
        prob = 0.74;
        factors.push(
          wed === 'NONE'
            ? 'Added Thursday DNP with illness (team isolation/recovery protocol with 72h to kickoff; ~70–78% NFL play rate)'
            : 'Missed Thursday practice with illness (team isolation/recovery protocol with 72h to kickoff; ~70–78% NFL play rate)'
        );
      } else if (thu === 'LP' && wed === 'FP') {
        prob = 0.80;
        factors.push('Mid-week illness downgrade (Wed FP -> Thu LP); high historical NFL play rate');
      } else if (thu === 'LP' && wed === 'DNP') {
        prob = 0.88;
        factors.push('Positive illness recovery ramp (Wed DNP -> Thu LP)');
      } else if (thu === 'LP') {
        prob = 0.86;
        factors.push('Thursday Limited Participation (LP) with illness');
      } else if (wed === 'DNP' && thu === 'DNP') {
        prob = 0.68;
        factors.push('Consecutive Wed/Thu illness DNPs; awaiting Friday clearance with 72h recovery window');
      } else if (wed === 'FP' && thu === 'NONE') {
        prob = 0.94;
        factors.push('Full Participation (FP) logged on Wednesday despite illness');
      } else if (wed === 'LP' && thu === 'NONE') {
        prob = 0.86;
        factors.push('Wednesday Limited Participation (LP) with illness');
      } else if (wed === 'DNP' && thu === 'NONE') {
        prob = 0.80;
        factors.push('Wednesday illness DNP (rest/isolation); high historical NFL play rate with 4 days until kickoff');
      } else {
        prob = 0.84;
        factors.push('Listed with illness ahead of practice week; strong historical NFL active rate');
      }
    }
    if (missedPriorGame && fri !== 'FP' && thu !== 'FP') {
      prob = Math.max(0.26, prob - 0.18);
      factors.push('Multi-week illness absence (missed prior game); elevated systemic recovery caution');
    }
  } else {
    // Derive base from Wed/Thu/Fri practice progression (including trajectory directionality & multi-game absence ramps)
    const missedCntLabel = consecutiveMissedGames > 1 ? `${consecutiveMissedGames}-game` : 'prior-game';
    const priorAdj = (prior.questionablePlayRate - 0.78) * 0.35;
    const hasCombinedRestTag =
      hasRealMedicalInjury &&
      /\b(?:not\s+injury\s+related|nir\s*-\s*rest|resting\s+player|vet(?:eran)?\s+rest)\b/i.test(injuryLower);

  const isActiveHealthyBaselineAddition =
    rosterBucket === 'active' &&
    !Boolean(input.isPracticeWindowOpen) &&
    !Boolean(input.isIrReturnQuestionable) &&
    !missedPriorGame;

  if (fri === 'FP') {
    prob = 0.93;
    factors.push('Logged Full Participation (FP) on Friday');
  } else if (fri === 'LP') {
    if (wed === 'DNP' && thu === 'DNP') {
      if (missedPriorGame) {
        prob = priorWeekPracticed === true ? 0.50 : consecutiveMissedGames >= 2 ? 0.42 : 0.48;
        factors.push(
          `Late-week salvage (DNP/DNP/LP) following ${missedCntLabel} absence; requires pre-game warmup clearance`
        );
      } else {
        prob = 0.56;
        factors.push('Late-week salvage (DNP/DNP/LP); requires pre-game warmup clearance');
      }
    } else if (wed === 'FP' || thu === 'FP') {
      prob = Math.max(0.35, prior.questionablePlayRate - 0.14);
      factors.push('Late-week practice downgrade (FP earlier in week -> Friday LP); elevated flare-up caution');
    } else if (wed === 'NONE' && thu === 'NONE' && isActiveHealthyBaselineAddition) {
      prob = Math.max(0.50, prior.questionablePlayRate - 0.12);
      factors.push(
        `Late-week injury addition (added Friday Limited after clean Wed–Thu; base prior ${Math.round(prior.questionablePlayRate * 100)}%)`
      );
    } else if (wed === 'NONE' && thu === 'LP' && isActiveHealthyBaselineAddition) {
      prob = Math.max(0.56, prior.questionablePlayRate - 0.04);
      factors.push('Consecutive Thu/Fri Limited (LP -> LP) following mid-week Thursday injury addition');
    } else if (wed === 'DNP' && thu === 'LP') {
      if (missedPriorGame) {
        const baseTwoLp =
          priorWeekPracticed === true
            ? consecutiveMissedGames >= 2
              ? 0.74
              : 0.78
            : consecutiveMissedGames >= 2
              ? 0.66
              : 0.72;
        prob = baseTwoLp + priorAdj;
        factors.push(
          `Consecutive Thu/Fri Limited (Wed DNP -> Thu LP -> Fri LP) following ${missedCntLabel} absence${
            priorWeekPracticed === false ? ' without prior practice' : ''
          }`
        );
      } else {
        prob = Math.min(0.89, prior.questionablePlayRate + 0.03);
        factors.push(
          `Positive upward rehab ramp (Wed DNP -> Thu LP -> Fri LP; base prior ${Math.round(prior.questionablePlayRate * 100)}%)`
        );
      }
    } else {
      if (missedPriorGame) {
        prob =
          priorWeekPracticed === true
            ? Math.max(0.68, prior.questionablePlayRate - (consecutiveMissedGames >= 2 ? 0.05 : 0.02))
            : Math.max(0.62, (consecutiveMissedGames >= 2 ? 0.72 : 0.76) + priorAdj);
        factors.push(
          `Friday Limited (LP) following ${missedCntLabel} absence${
            priorWeekPracticed === false ? ' without prior practice' : ''
          } (base prior ${Math.round(prior.questionablePlayRate * 100)}%)`
        );
      } else {
        prob = prior.questionablePlayRate;
        factors.push(
          `Friday Limited (LP) — anchored to player Questionable play prior (${Math.round(prior.questionablePlayRate * 100)}%)`
        );
      }
    }
  } else if (fri === 'DNP') {
    if (wed === 'DNP_REST' && thu === 'LP') {
      prob = 0.32;
      factors.push('Held out of Friday practice (DNP) with injury after Thursday Limited session');
    } else if (wed === 'LP' || thu === 'LP' || wed === 'FP' || thu === 'FP') {
      prob = 0.16;
      factors.push('Mid-week setback alert: downgraded to Friday DNP after practicing earlier in week');
    } else if (wed === 'NONE' && thu === 'NONE' && isActiveHealthyBaselineAddition) {
      prob = 0.20;
      factors.push('Late-week injury addition (added Friday DNP after clean Wed–Thu; ~75–80% NFL inactive rate)');
    } else {
      prob = 0.08;
      factors.push('DNP across entire practice week (rarely activated without Friday practice reps)');
    }
  } else {
    // Mid-week or Early-week pre-practice (before Friday report is finalized)
    if (thu === 'FP') {
      prob = 0.92;
      factors.push('Logged Full Participation (FP) on Thursday');
    } else if (thu === 'DNP' && (wed === 'LP' || wed === 'FP')) {
      prob = 0.34;
      factors.push('Mid-week setback alert: downgraded to Thursday DNP after practicing Wednesday');
    } else if (thu === 'DNP' && wed === 'NONE' && isActiveHealthyBaselineAddition) {
      prob = 0.34;
      factors.push('Mid-week injury addition (added Thursday DNP after clean Wednesday); elevated game-day risk');
    } else if (thu === 'LP' && wed === 'FP') {
      prob = Math.max(0.46, prior.questionablePlayRate - 0.14);
      factors.push('Mid-week downgrade (Wed FP -> Thu LP); monitoring Friday clearance');
    } else if (thu === 'LP' && wed === 'DNP') {
      if (prior.isVeteranRestHabitual && !missedPriorGame) {
        prob = 0.85;
        factors.push('Expected veteran ramp-up (Wed maintenance -> Thu LP)');
      } else if (missedPriorGame) {
        // Returning from multi-game absence with a single Thu LP after Wed DNP still requires 24h Friday load response check!
        const firstLpBase =
          priorWeekPracticed === true
            ? consecutiveMissedGames >= 2
              ? 0.64
              : 0.68
            : consecutiveMissedGames >= 3
              ? 0.54
              : consecutiveMissedGames === 2
                ? 0.57
                : 0.62;
        prob = firstLpBase + priorAdj;
        factors.push(
          `First Limited session (Wed DNP -> Thu LP) following ${missedCntLabel} absence${
            priorWeekPracticed === false ? ' without prior practice' : ''
          } — awaiting Friday load response`
        );
      } else {
        prob = Math.min(0.84, prior.questionablePlayRate - 0.02);
        factors.push(
          `Positive upward rehab ramp (Wed DNP -> Thu LP; player prior ${Math.round(prior.questionablePlayRate * 100)}%)`
        );
      }
    } else if (thu === 'LP' && wed === 'NONE' && isActiveHealthyBaselineAddition) {
      prob = Math.max(0.56, prior.questionablePlayRate - 0.08);
      factors.push(
        `Mid-week injury addition (added Thursday Limited after clean Wednesday; awaiting Friday response)`
      );
    } else if (thu === 'LP') {
        if (missedPriorGame) {
          const thuLpBase =
            wed === 'LP'
              ? priorWeekPracticed === true
                ? consecutiveMissedGames >= 2
                  ? 0.72
                  : 0.76
                : consecutiveMissedGames >= 2
                  ? 0.68
                  : 0.72
              : priorWeekPracticed === true
                ? consecutiveMissedGames >= 2
                  ? 0.66
                  : 0.70
                : consecutiveMissedGames >= 2
                  ? 0.60
                  : 0.65;
          prob = thuLpBase + priorAdj;
          factors.push(
            wed === 'LP'
              ? `Consecutive Wed/Thu Limited (LP -> LP) following ${missedCntLabel} absence`
              : `Thursday Limited Participation (LP) following ${missedCntLabel} absence — awaiting Friday response`
          );
        } else {
          prob = prior.questionablePlayRate;
          factors.push(
            `Thursday Limited Participation (LP); player toughness prior = ${Math.round(prior.questionablePlayRate * 100)}%`
          );
        }
      } else if (wed === 'DNP' && thu === 'DNP') {
        prob = missedPriorGame
          ? 0.22
          : prior.isVeteranRestHabitual && !sustainedInLastGame
            ? 0.52
            : 0.28;
        factors.push('Consecutive Wed/Thu DNPs');
      } else if (wed === 'FP' && thu === 'NONE') {
        prob = 0.91;
        factors.push('Full Participation (FP) logged on Wednesday');
      } else if (wed === 'LP' && thu === 'NONE') {
        if (missedPriorGame) {
          prob =
            priorWeekPracticed === true
              ? Math.max(0.68, prior.questionablePlayRate - (consecutiveMissedGames >= 2 ? 0.05 : 0.03))
              : (consecutiveMissedGames >= 2 ? 0.66 : 0.70) + priorAdj;
          factors.push(
            `Returned to Limited Participation (LP) on Wednesday following ${missedCntLabel} absence`
          );
        } else {
          prob = prior.questionablePlayRate;
          factors.push(
            `Wednesday Limited Participation (LP); player toughness prior = ${Math.round(prior.questionablePlayRate * 100)}%`
          );
        }
      } else if (wed === 'DNP' && thu === 'NONE') {
        if (missedPriorGame) {
          prob = 0.28 + (prior.questionablePlayRate - 0.78) * 0.25;
          factors.push('Did Not Participate (DNP) on Wednesday; remains sidelined from practice');
        } else if (hasCombinedRestTag) {
          prob = prior.isVeteranRestHabitual && !sustainedInLastGame ? 0.64 : 0.56;
          factors.push(
            `Did Not Participate (DNP) on Wednesday with combined medical + veteran rest tag (${injuryType}); awaiting Thursday participation`
          );
        } else if (prior.isVeteranRestHabitual && !sustainedInLastGame) {
          prob = 0.56;
          factors.push('Did Not Participate (DNP) on Wednesday (veteran maintenance profile, awaiting Thursday workload)');
        } else {
          prob = 0.36 + (prior.questionablePlayRate - 0.78) * 0.35;
          factors.push('Did Not Participate (DNP) on Wednesday');
        }
        if (Boolean(input.hasSideFieldRehab) || SIDE_FIELD_REHAB_OBSERVATION_RE.test(beatNote)) {
          prob += 0.03;
          factors.push('Spotted working/running on side rehab field during practice (+3%)');
        }
      } else if (wed === 'DNP_REST' && thu === 'NONE') {
        prob = prior.isVeteranRestHabitual && !missedPriorGame ? 0.68 : 0.58;
        factors.push(
          `Wednesday rest/non-participation alongside active medical tag (${injuryType || statusRaw || 'reported'}); awaiting Thursday participation`
        );
      } else if ((statusRaw === 'questionable' || isIrReturnQuestionable) && !hasObservedPracticeThisWeek) {
        // Early-week pre-practice rollover (Mon/Tue/Wed AM before first practice report):
        // Calibrated to 2024–2026 NFL empirical next-game rates (Missed + Prior DNP = 33.7%; Missed + Prior LP/FP = 51.8%–67%; Active Day-to-Day = 74%–82%)
        if (!isIrReturnQuestionable && missedPriorGame) {
          if (priorWeekPracticed === true) {
            prob = 0.72 + (prior.questionablePlayRate - 0.78) * 0.45;
            factors.push('Missed prior game after logging Limited/Full practices — positive recovery ramp');
          } else {
            const missedCnt = Math.max(1, consecutiveMissedGames || 1);
            prob = (missedCnt >= 2 ? 0.48 : 0.44) + (prior.questionablePlayRate - 0.78) * 0.35;
            factors.push(
              `Missed ${missedCnt > 1 ? `${missedCnt} consecutive games` : 'prior game'} without practice participation — awaiting Wednesday report`
            );
          }
        } else if (!isIrReturnQuestionable && exitedPriorGameWithoutReturn) {
          prob = Math.min(0.74, prior.questionablePlayRate - 0.08);
          factors.push(
            'Exited prior game with injury and did not return — awaiting Wednesday practice evaluation'
          );
        } else if (!isIrReturnQuestionable && sustainedInLastGame) {
          prob = Math.min(0.82, prior.questionablePlayRate - 0.04);
          factors.push(
            `Active in prior game; day-to-day evaluation ahead of Wednesday practice (base prior ${Math.round(prior.questionablePlayRate * 100)}%)`
          );
        } else {
          prob = prior.questionablePlayRate;
          factors.push(
            `Questionable tag adjusted by player career prior (${Math.round(prior.questionablePlayRate * 100)}%)`
          );
        }
      }
    }
  }

  // 5. Player-Specific Toughness vs. Chronic Body-Part Adjustment (never overrides neurological protocol)
  const loggedActivePracticeReps =
    wed === 'LP' || wed === 'FP' || thu === 'LP' || thu === 'FP' || fri === 'LP' || fri === 'FP';
  const matchesChronicPart = prior.chronicParts.some(part => injuryLower.includes(part.toLowerCase()));
  let appliedChronicDeduction = false;
  let totalMedicalDeduction = 0;
  if (!isConcussion && matchesChronicPart && prob < 0.93) {
    if (name === 'Trent Williams' && injuryLower.includes('ankle') && fri !== 'FP') {
      const beforeTw = prob;
      prob = Math.min(prob, prior.acuteAnklePlayRate || 0.56);
      totalMedicalDeduction += Math.max(0, beforeTw - prob);
      factors.push('Trent Williams acute ankle adjustment (historically lower active rate than NIR-Rest)');
      appliedChronicDeduction = true;
    } else {
      prob -= 0.06;
      totalMedicalDeduction += 0.06;
      appliedChronicDeduction = true;
      factors.push(`Matches player's documented chronic history (${injuryType})`);
    }
  } else if (
    !isConcussion &&
    priorSameInjuryRecurrence &&
    sustainedInLastGame &&
    prob < 0.92 &&
    fri !== 'FP'
  ) {
    prob -= 0.06;
    totalMedicalDeduction += 0.06;
    appliedChronicDeduction = true;
    factors.push(`In-game aggravation / recurrence of prior-week ${injuryType} injury (-6% caution)`);
  } else if (
    !isConcussion &&
    !isPureIllness &&
    loggedActivePracticeReps &&
    prior.questionablePlayRate >= 0.88 &&
    prob >= 0.45 &&
    prob < 0.93
  ) {
    prob += 0.04;
    factors.push('High pain-tolerance / toughness prior (+4% boost)');
  }

  if (!hasObservedPracticeThisWeek && statusRaw === 'questionable' && !isIrReturnQuestionable) {
    prob = Math.min(prob, 0.84);
  }

  // 6. Injury Biomechanics Modifier (High-caution structural joint vs soft-tissue speed risk vs pain management)
  // Caps combined chronic + soft-tissue deduction at -8% total so returning LP soft-tissue players aren't double-penalized
  if (!isConcussion && !isPureIllness && HIGH_CAUTION_STRUCTURAL_KEYWORDS.some(k => injuryLower.includes(k)) && fri !== 'FP' && prob < 0.92) {
    const ded = appliedChronicDeduction ? 0.04 : 0.08;
    prob -= ded;
    totalMedicalDeduction += ded;
    factors.push(`High-caution structural joint/ligament stability profile (${injuryType})`);
  } else if (!isConcussion && !isPureIllness && SOFT_TISSUE_KEYWORDS.some(k => injuryLower.includes(k)) && prob < 0.92) {
    const ded = appliedChronicDeduction ? 0.02 : 0.05;
    prob -= ded;
    totalMedicalDeduction += ded;
    factors.push(`Soft-tissue re-aggravation caution (${injuryType})`);
  } else if (!isConcussion && !isPureIllness && MINOR_PAIN_TOLERANCE_KEYWORDS.some(k => injuryLower.includes(k)) && prob >= 0.50 && prob < 0.95) {
    prob += 0.04;
    factors.push(`Manageable pain-tolerance injury profile (${injuryType})`);
  }

  // Helper for verified next-day pre-report practice return (e.g., Wed official DNP, official Thu report pending,
  // but non-speculative beat observation confirms player suited up / returned to practice on Thursday).
  const hasOnlyDnpSoFar = hasObservedPracticeThisWeek && !loggedActivePracticeReps && (wed === 'DNP' || thu === 'DNP');
  const canApplyNextDayPreReportPracticeReturn = ({ obsMs = 0, obsText = '' } = {}) => {
    if (!hasOnlyDnpSoFar || fri !== 'NONE' || statusRaw === 'out' || statusRaw === 'doubtful') {
      return false;
    }
    const textStr = String(obsText || '');
    const koMsCheck = input.kickoffIso ? Date.parse(input.kickoffIso) : NaN;
    if (wed === 'DNP' && thu === 'NONE') {
      if (/\bwednesday\b/i.test(textStr) && !/\b(?:thursday|friday|today)\b/i.test(textStr)) {
        return false;
      }
      if (Number.isFinite(koMsCheck) && Number.isFinite(obsMs) && obsMs > 0) {
        const koPt = extractPtDayMeta(koMsCheck);
        const obsPt = extractPtDayMeta(obsMs);
        const leadDays = getPracticeReportLeadDays(koPt.weekday);
        const wedDayIndex = koPt.dayIndex - leadDays;
        return obsPt.dayIndex > wedDayIndex || /\bthursday\b/i.test(textStr);
      }
      return true;
    }
    if (thu === 'DNP' && fri === 'NONE') {
      if (/\b(?:wednesday|thursday)\b/i.test(textStr) && !/\b(?:friday|today)\b/i.test(textStr)) {
        return false;
      }
      if (Number.isFinite(koMsCheck) && Number.isFinite(obsMs) && obsMs > 0) {
        const koPt = extractPtDayMeta(koMsCheck);
        const obsPt = extractPtDayMeta(obsMs);
        const leadDays = getPracticeReportLeadDays(koPt.weekday);
        const thuDayIndex = koPt.dayIndex - (leadDays - 1);
        return obsPt.dayIndex > thuDayIndex || /\bfriday\b/i.test(textStr);
      }
      return /\bfriday\b/i.test(textStr);
    }
    return false;
  };

  const computePreReportPracticeReturnTarget = () => {
    const priorAdjLocal = (prior.questionablePlayRate - 0.78) * 0.35;
    let nextOfficialLpEquiv;
    if (wed === 'DNP' && thu === 'NONE') {
      if (missedPriorGame) {
        const baseLp =
          priorWeekPracticed === true
            ? consecutiveMissedGames >= 2
              ? 0.64
              : 0.68
            : consecutiveMissedGames >= 3
              ? 0.54
              : consecutiveMissedGames === 2
                ? 0.57
                : 0.62;
        nextOfficialLpEquiv = baseLp + priorAdjLocal - totalMedicalDeduction;
      } else {
        nextOfficialLpEquiv = Math.min(0.84, prior.questionablePlayRate - 0.02) - totalMedicalDeduction;
      }
    } else {
      // Wed DNP + Thu DNP -> Friday pre-report practice return stays strictly below official DNP/DNP/LP
      if (missedPriorGame) {
        const baseFriLp = priorWeekPracticed === true ? 0.50 : consecutiveMissedGames >= 2 ? 0.42 : 0.48;
        nextOfficialLpEquiv = baseFriLp - totalMedicalDeduction;
      } else {
        nextOfficialLpEquiv = 0.56 - totalMedicalDeduction;
      }
    }
    const maxPreReportCap = Math.max(prob, nextOfficialLpEquiv - 0.05);
    return Math.min(maxPreReportCap, prob + 0.22);
  };

  let appliedPreReportPracticeReturn = false;

  // 7. Trust-Weighted Corroborated News & Beat Context Refinements (Negation-Aware, Bounded Against Overreaction)
  if (newsSig) {
    const conf = newsSig.confidence;
    const srcLabel =
      newsSig.corroboratingCount >= 2
        ? `${newsSig.corroboratingCount} corroborated reports`
        : newsSig.hasCoachOrGmQuote
          ? 'coaching staff report'
          : 'beat report';

    if (newsSig.signalType === 'CLEARED_CONCUSSION_PROTOCOL') {
      prob = Math.max(prob, 0.93);
      factors.push(`Medical clearance (${srcLabel}): cleared NFL Concussion Protocol`);
    } else if (newsSig.signalType === 'UNLIKELY_THIS_WEEK' && ((fri !== 'FP' && thu !== 'FP') || newsSig.hasLateSetback)) {
      const blend = Math.min(0.86, conf * 0.94);
      prob = Math.min(prob, prob * (1 - blend) + 0.18 * blend);
      factors.push(`Coaching/beat consensus (${srcLabel}): not expected to play this week`);
    } else if (newsSig.signalType === 'TRENDING_DOWNWARD' && (fri !== 'FP' || newsSig.hasLateSetback || statusRaw === 'questionable')) {
      const downTarget = newsSig.hasLateSetback
        ? Math.min(prob, 0.24)
        : Math.max(0.26, Math.min(0.46, prob - 0.24));
      const blend = newsSig.hasLateSetback
        ? Math.min(0.88, Math.max(conf * 1.25, 0.68))
        : Math.min(0.82, Math.max(conf * 1.0, 0.44));
      prob = Math.min(prob, prob * (1 - blend) + downTarget * blend);
      factors.push(
        `Coaching/beat trend (${srcLabel}): ${newsSig.hasLateSetback ? 'late setback / downgraded outlook' : 'trending downward for game day'}`
      );
    } else if (newsSig.signalType === 'OBSERVED_DNP_PRACTICE' && !hasObservedPracticeThisWeek) {
      const dnpTarget = missedPriorGame ? 0.28 : 0.38;
      const blend = Math.min(0.88, conf * 0.92);
      prob = Math.min(prob, prob * (1 - blend) + dnpTarget * blend);
      factors.push(`Beat practice observation (${srcLabel}): did not practice today`);
    } else if (newsSig.signalType === 'UNLIKELY_WEDNESDAY_PRACTICE' && !hasObservedPracticeThisWeek) {
      const blend = Math.min(0.78, conf * 0.85);
      prob = Math.min(prob, prob * (1 - blend) + 0.24 * blend);
      factors.push(`Early-week update (${srcLabel}): unlikely to practice Wednesday / questionable at best`);
    } else if (newsSig.signalType === 'OBSERVED_PRACTICE_RETURN' && !hasObservedPracticeThisWeek) {
      const lpTarget = Math.max(0.64, prior.questionablePlayRate - (missedPriorGame ? 0.08 : 0.02));
      const blend = Math.min(0.88, conf * 0.92);
      prob = Math.max(prob, prob * (1 - blend) + lpTarget * blend);
      factors.push(`Beat practice observation (${srcLabel}): returned to on-field practice`);
    } else if (
      !newsSig.hasLateSetback &&
      (newsSig.signalType === 'OBSERVED_PRACTICE_RETURN' ||
        (newsSig.signalType === 'TRENDING_UPWARD' && newsSig.hasObservedPracticeReturn)) &&
      canApplyNextDayPreReportPracticeReturn({
        obsMs: newsSig.observedPracticeReturnPubMs || newsSig.latestPubMs || 0,
        obsText: newsSig.observedPracticeReturnText || newsSig.leadClause || ''
      })
    ) {
      const preTarget = computePreReportPracticeReturnTarget();
      const blend = Math.min(0.88, Math.max(0.55, conf * 0.92));
      if (preTarget > prob) {
        prob = prob * (1 - blend) + preTarget * blend;
        appliedPreReportPracticeReturn = true;
      }
      factors.push(`Beat practice observation (${srcLabel}): returned to on-field practice ahead of official report`);
    } else if (newsSig.signalType === 'EXPECTED_PRACTICE_RETURN' && !hasObservedPracticeThisWeek) {
      const returnTarget = Math.min(0.66, 0.64 + (prior.questionablePlayRate - 0.78) * 0.35);
      const blend = Math.min(0.84, conf * 0.90);
      if (returnTarget > prob) {
        prob = prob * (1 - blend) + returnTarget * blend;
      }
      factors.push(`Coaching/beat update (${srcLabel}): expected back at practice Wednesday (pending Wed–Fri workload)`);
    } else if (newsSig.signalType === 'EXPECTED_TO_PLAY') {
      const corroboratedHighConf = conf >= 0.65 && fri !== 'DNP' && statusRaw !== 'doubtful';
      const targetCap = statusRaw === 'questionable' ? (corroboratedHighConf ? 0.88 : 0.84) : 0.88;
      const blend = Math.min(0.88, conf * 0.92);
      prob = Math.max(prob, prob * (1 - blend) + targetCap * blend);
      if (statusRaw === 'questionable' && hasAffirmativePlayOrActivationSignal(beatNote)) {
        prob = Math.max(prob, 0.78);
      }
      if (statusRaw === 'questionable') prob = Math.min(prob, corroboratedHighConf ? 0.88 : 0.84);
      factors.push(`Beat/podium consensus (${srcLabel}): on track to suit up`);
    } else if (newsSig.signalType === 'TRENDING_UPWARD' && statusRaw !== 'doubtful' && fri !== 'DNP') {
      let upTarget;
      if (hasOnlyDnpSoFar) {
        upTarget =
          wed === 'DNP' && thu === 'DNP'
            ? Math.min(0.36, prob + 0.10)
            : Math.min(missedPriorGame ? 0.44 : 0.56, prob + 0.18);
      } else if (!hasObservedPracticeThisWeek) {
        upTarget =
          missedPriorGame && priorWeekPracticed !== true
            ? Math.min(0.62, prob + 0.14)
            : Math.min(0.76, Math.max(prob + 0.14, 0.64));
      } else if (missedPriorGame && priorWeekPracticed !== true && thu !== 'FP' && fri !== 'FP') {
        upTarget = Math.min(0.76, prob + 0.10);
      } else {
        upTarget = Math.min(0.86, Math.max(prob + 0.10, prior.questionablePlayRate + 0.04));
      }
      const blend = Math.min(0.78, conf * 0.84);
      if (upTarget > prob) {
        prob = prob * (1 - blend) + upTarget * blend;
      }
      factors.push(`Coaching/beat trend (${srcLabel}): trending upward / optimistic to suit up`);
    } else if (newsSig.signalType === 'SUSTAINED_IN_GAME_INJURY' && !hasObservedPracticeThisWeek) {
      if (newsSig.isMultiWeekOrSurgery) {
        const blend = Math.min(0.88, conf * 0.94);
        prob = Math.min(prob, prob * (1 - blend) + 0.14 * blend);
        factors.push(`Post-game diagnosis (${srcLabel}): multi-week / surgical timeline`);
      } else {
        const exitCap = priorSameInjuryRecurrence ? 0.68 : newsSig.exitedWithoutReturn ? 0.74 : 0.80;
        prob = Math.min(prob, exitCap);
        if (!factors.some(f => /Exited prior game|Active in prior game/i.test(f))) {
          factors.push(`Post-game update (${srcLabel}): exited prior game with ${injuryType || 'injury'}`);
        }
      }
    } else if (newsSig.signalType === 'DAY_TO_DAY' && !hasObservedPracticeThisWeek) {
      prob = Math.min(0.82, Math.max(prob, 0.70 + (prior.questionablePlayRate - 0.78) * 0.55));
      factors.push(`Coaching update (${srcLabel}): considered day-to-day ahead of Wednesday practice`);
    }
  } else if (hasNegativePlayConsensusSignal(beatNote)) {
    prob = Math.min(prob, 0.20);
    factors.push('Beat consensus: unlikely / not expected to suit up');
  } else if (hasTrendingDownwardSignal(beatNote) && (fri !== 'FP' || /\b(?:setback|re-?aggravat|downgraded|added to)\b/i.test(beatNote))) {
    prob = Math.min(prob, Math.max(0.28, prob - 0.18));
    factors.push('Beat trend: trending downward / setback caution ahead of game');
  } else if (!hasObservedPracticeThisWeek && hasNegativePracticeExpectationSignal(beatNote)) {
    prob = Math.min(prob, 0.30);
    factors.push('Early-week beat note: unlikely to practice Wednesday / questionable at best');
  } else if (
    beatNote.includes('questionable at best') ||
    (!hasObservedPracticeThisWeek &&
      /\b(hasn't been able to practice|has not been able to practice|yet to return to practice)\b/i.test(beatNote))
  ) {
    prob = Math.min(prob, 0.48);
    factors.push('Has not yet returned to practice following multi-week injury absence');
  } else if (!hasObservedPracticeThisWeek && hasExpectedPracticeReturnSignal(beatNote)) {
    prob = Math.max(prob, Math.min(0.62, prob + 0.16));
    factors.push('Coaching/beat note: expected back at practice Wednesday (pending Wed–Fri workload)');
  } else if (beatNote.includes('game-time decision') || beatNote.includes('50-50')) {
    prob = Math.max(0.42, Math.min(0.64, prob));
    factors.push('Coaching/beat note: true pre-game warmup decision');
  } else if (hasAffirmativePlayOrActivationSignal(beatNote)) {
    prob = statusRaw === 'questionable' ? Math.min(0.84, Math.max(prob, 0.78)) : Math.max(prob, 0.84);
    factors.push('Beat/podium consensus: on track to suit up');
  } else if (
    hasObservedPracticeReturnSignal(beatNote) &&
    canApplyNextDayPreReportPracticeReturn({
      obsMs: parseFlexibleIsoMs(input.blurbDateIso) || 0,
      obsText: beatNote
    })
  ) {
    const preTarget = computePreReportPracticeReturnTarget();
    const blend = 0.74;
    if (preTarget > prob) {
      prob = prob * (1 - blend) + preTarget * blend;
      appliedPreReportPracticeReturn = true;
    }
    factors.push('Beat practice observation: returned to on-field practice ahead of official report');
  } else if (hasTrendingUpwardSignal(beatNote) && statusRaw !== 'doubtful' && fri !== 'DNP') {
    const cap = hasOnlyDnpSoFar
      ? missedPriorGame
        ? 0.42
        : 0.54
      : !hasObservedPracticeThisWeek
        ? missedPriorGame && priorWeekPracticed !== true
          ? 0.60
          : 0.72
        : missedPriorGame && priorWeekPracticed !== true && thu !== 'FP' && fri !== 'FP'
          ? 0.74
          : 0.85;
    prob = Math.max(prob, Math.min(cap, prob + 0.08));
    factors.push('Coaching/beat trend: trending upward / making progress ahead of game');
  }

  const pct = Math.max(1, Math.min(99, Math.round(prob * 100)));
  let tier = 'QUESTIONABLE';
  if (pct >= 85) tier = 'LIKELY';
  else if (pct >= 50) tier = 'FIFTY_FIFTY';
  else if (pct >= 20) tier = 'UNLIKELY';
  else tier = 'DOUBTFUL';

  return {
    probabilityPct: pct,
    tier,
    badgeLabel: `${pct}% • ${formatPlayTierLabel(tier)}`,
    priorUsed: prior,
    factors,
    appliedPreReportPracticeReturn
  };
}

export function formatPlayTierLabel(tier) {
  switch (tier) {
    case 'ACTIVE':
      return 'Full Go';
    case 'LIKELY':
      return 'Cleared';
    case 'FIFTY_FIFTY':
      return 'GTD';
    case 'UNLIKELY':
      return 'Long Shot';
    case 'DOUBTFUL':
      return 'Doubtful';
    case 'OUT':
      return 'Out';
    default:
      return 'GTD';
  }
}

/**
 * Stable week/opponent-scoped snapshot key for an opposing team injury-report row.
 * Namespacing by `oppAbbr` ensures prior-week opponent snapshots never collide with the current opponent.
 */
export function canonicalOpponentHealthSnapshotKey(row = {}, oppAbbr = '') {
  const abbr = String(oppAbbr || 'OPP')
    .trim()
    .toUpperCase();
  const rawId = String(
    row?.id ||
      row?.playerId ||
      (String(row?.espnUrl || '').match(/\/id\/(\d+)/)?.[1] || '')
  ).trim();
  if (rawId) return `${abbr}:${rawId}`;
  const nameKey = canonicalInjuryPlayerKey(row?.name || '');
  return nameKey ? `${abbr}:${nameKey}` : '';
}

/**
 * Returns true when an active player was NOT on Wednesday's injury report (healthy 99% baseline)
 * and was newly added on Thursday (`-/LP/-`, `-/DNP/-`) or Friday (`-/-/LP`, `-/-/DNP`).
 * Strictly excludes IR 21-day window openings, players who missed the prior game, and NIR/Vet Rest.
 */
export function isMidWeekHealthyAdditionRow(row = {}) {
  if (!row || !row.name) return false;
  if (/in \(active\)|out \(inactive\)/i.test(String(row.playBadgeLabel || ''))) return false;
  if (
    row.rosterBucket === 'ir' ||
    row.rosterBucket === 'suspended' ||
    Boolean(row.isIrReturnWindow) ||
    Boolean(row.isPracticeWindowOpen) ||
    Boolean(row.isIrReturnQuestionable) ||
    Boolean(row.missedPriorGame)
  ) {
    return false;
  }
  if (isRestOrPersonalInjuryLabel(row.injuryType || '')) return false;
  const w = String(row.wed ?? '').trim();
  const t = String(row.thu ?? '').trim();
  const f = String(row.fri ?? '').trim();
  const hasWed = Boolean(w) && w !== '-' && w !== '—';
  const hasThu = Boolean(t) && t !== '-' && t !== '—';
  const hasFri = Boolean(f) && f !== '-' && f !== '—';
  if (hasWed) return false;
  if (hasThu && !hasFri && !/^vet\s*rest$|^rest$/i.test(t)) return true;
  if (!hasThu && hasFri && !/^vet\s*rest$|^rest$/i.test(f)) return true;
  return false;
}

/**
 * Deterministically computes the prior practice day's play probability for an opposing team injury-report row
 * so multi-day upgrades/downgrades (e.g. FP->LP, LP->FP, DNP->LP), mid-week healthy additions (-/LP/- vs 99%),
 * and pre-report return lifts display exact trajectory + % delta chips immediately on first load (parity with 49ers Health).
 */
export function computeOpponentPriorDayPlayProbability(
  oppRow = {},
  { currentWeek = null, kickoffIso = '', nowMs = Date.now(), rosterPlayerNames = [] } = {}
) {
  if (!oppRow || !oppRow.name) return null;
  if (/in \(active\)|out \(inactive\)/i.test(String(oppRow.playBadgeLabel || ''))) return null;
  const w = oppRow.wed && oppRow.wed !== '-' && oppRow.wed !== '—' ? oppRow.wed : '-';
  const t = oppRow.thu && oppRow.thu !== '-' && oppRow.thu !== '—' ? oppRow.thu : '-';
  const f = oppRow.fri && oppRow.fri !== '-' && oppRow.fri !== '—' ? oppRow.fri : '-';
  const filledCount = [w, t, f].filter(v => v !== '-').length;
  if (filledCount === 1 && isMidWeekHealthyAdditionRow(oppRow)) {
    return 99;
  }
  const isSingleDayPreReportReturn = filledCount === 1 && Boolean(oppRow.hasPreReportPracticeReturn);
  if (filledCount < 2 && !isSingleDayPreReportReturn) return null;

  const prevW = w;
  const prevT = isSingleDayPreReportReturn ? t : f !== '-' ? t : '-';
  const prevF = '-';
  const hadPriorRestriction =
    /^(?:dnp|lp|limited|did not)/i.test(prevW) || /^(?:dnp|lp|limited|did not)/i.test(prevT);
  const rawSt = String(oppRow.gameStatus || '');
  const cleanSt =
    rawSt === 'No Designation (Cleared)'
      ? 'Active'
      : rawSt === 'IR Return Window (Q)'
        ? 'Questionable'
        : rawSt || 'Questionable';
  const priorStatus = oppRow.isIrReturnQuestionable
    ? 'Questionable'
    : hadPriorRestriction && /^(?:active|no designation|cleared|out|doubtful)/i.test(cleanSt)
      ? 'Questionable'
      : cleanSt;

  const priorCalc = computePlayerPlayProbability({
    name: oppRow.name,
    position: oppRow.position || 'ATH',
    snapPct: oppRow.snapPct ?? null,
    gameStatus: priorStatus,
    rosterBucket: oppRow.isIrReturnQuestionable ? 'ir' : 'active',
    isIrReturnQuestionable: Boolean(oppRow.isIrReturnQuestionable),
    injuryType: oppRow.injuryType || '',
    wed: prevW,
    thu: prevT,
    fri: prevF,
    beatNote: '',
    kickoffIso,
    nowMs,
    currentWeek,
    rosterPlayerNames
  });
  return Number.isFinite(priorCalc?.probabilityPct) ? priorCalc.probabilityPct : null;
}

/**
 * Computes the earliest eligible NFL return week from Injured Reserve (IR) / PUP.
 * Crucial NFL Rule: A player placed on IR with a designation to return must miss a minimum
 * of FOUR (4) GAMES — Bye weeks do NOT count toward the 4-game requirement!
 *
 * @param {number} placedBeforeWeek - First NFL week missed on IR (e.g., placed ahead of Week 5 -> 5)
 * @param {number} teamByeWeek - Team's Bye Week (e.g., 8 for 2026 49ers)
 * @param {number} [estimatedRecoveryGames=4] - Sports-medicine estimated games needed
 */
export function calculateIrReturnTimeline(placedBeforeWeek, teamByeWeek = 8, estimatedRecoveryGames = 4) {
  const startWeek = Math.max(1, Number(placedBeforeWeek || 1));
  let gamesMissed = 0;
  let wk = startWeek;
  const missedWeeks = [];

  while (gamesMissed < 4 && wk <= 22) {
    if (wk !== teamByeWeek) {
      gamesMissed += 1;
      missedWeeks.push(wk);
    }
    wk += 1;
  }
  if (wk === teamByeWeek) wk += 1;
  const earliestEligibleWeek = wk;

  let recGames = 0;
  let projWk = startWeek;
  const needed = Math.max(4, Number(estimatedRecoveryGames || 4));
  while (recGames < needed && projWk <= 22) {
    if (projWk !== teamByeWeek) {
      recGames += 1;
    }
    projWk += 1;
  }
  if (projWk === teamByeWeek) projWk += 1;

  return {
    placedBeforeWeek: startWeek,
    missedGameWeeks: missedWeeks,
    earliestEligibleWeek,
    projectedReturnWeek: projWk,
    byeWeekExcluded: startWeek <= teamByeWeek && projWk > teamByeWeek
  };
}

/**
 * Safely parses YYYY-MM-DD or full ISO-8601 timestamps (including +00:00 offsets) into epoch ms.
 * Prevents the `NaN` bug caused by blindly appending `T12:00:00Z` to full ISO timestamps.
 */
export function parseFlexibleIsoMs(rawIso) {
  if (!rawIso) return null;
  const s = String(rawIso).trim();
  if (!s) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    const ms = Date.parse(`${s}T12:00:00Z`);
    return Number.isNaN(ms) ? null : ms;
  }
  const ms = Date.parse(s);
  return Number.isNaN(ms) ? null : ms;
}

/**
 * Builds an 18-week NFL calendar lookup (interpolating any missing Bye week Sunday) from schedule events.
 */
function buildNormalizedNflWeekTimeline(scheduleEvents = []) {
  const byWeek = new Map();
  for (const ev of scheduleEvents || []) {
    const wk = Number(ev?.week?.number ?? ev?.week ?? 0);
    const ms = parseFlexibleIsoMs(ev?.date || ev?.dateIso);
    if (wk >= 1 && wk <= 18 && ms !== null && !byWeek.has(wk)) {
      byWeek.set(wk, ms);
    }
  }
  if (byWeek.size === 0) return [];

  // Propagate forward and backward at +7d/-7d cadence so single Bye weeks and multi-week gaps are both filled
  for (let w = 2; w <= 18; w++) {
    if (!byWeek.has(w) && byWeek.has(w - 1)) {
      byWeek.set(w, byWeek.get(w - 1) + 7 * 86_400_000);
    }
  }
  for (let w = 17; w >= 1; w--) {
    if (!byWeek.has(w) && byWeek.has(w + 1)) {
      byWeek.set(w, byWeek.get(w + 1) - 7 * 86_400_000);
    }
  }

  return [...byWeek.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([week, ms]) => ({ week, ms }));
}

/**
 * Resolves the first NFL regular-season week missed (`placedBeforeWeek`, 1..18)
 * from an official transaction or injury placement date.
 */
export function resolvePlacedBeforeWeekFromDate(placedDateIso, scheduleEvents = [], fallbackWeek = 1) {
  const placedMs = parseFlexibleIsoMs(placedDateIso);
  const timeline = buildNormalizedNflWeekTimeline(scheduleEvents);
  if (placedMs === null || timeline.length === 0) {
    return Math.max(1, Math.min(18, Number(fallbackWeek) || 1));
  }

  // Allow up to 12h grace so game-day/Saturday placements resolve to that week's game
  for (const item of timeline) {
    if (placedMs <= item.ms + 12 * 3_600_000) {
      return item.week;
    }
  }
  return timeline[timeline.length - 1].week;
}

const SEASON_ENDING_PROSE_REGEX =
  /\b(out for (?:the )?(?:\d{4} )?season|miss the entire|done for the (?:year|season)|for the rest of the (?:year|season)|season-ending|without a designation to return|spend the entire (?:\d{4} )?season|stay on (?:the (?:team's )?)?(?:ir|injured reserve) (?:list )?for the (?:year|season)|placed on season-ending|ending (?:his|their) (?:\d{4} )?(?:rookie )?season)\b/i;

/**
 * Determines whether an IR/Reserve record is season-ending using 3 deterministic NFL/CBA signals:
 *  1. Verified medical/beat/transaction prose ("out for the season", "season-ending", "without a designation to return", etc.)
 *  2. ESPN post-Super-Bowl returnDate sentinel (`>= Feb 1` of `seasonYear + 1`, e.g. `2027-02-15`)
 *  3. NFL CBA Preseason IR rule: placed/reverted to IR between May 1 and Aug 24 (prior to final 53-man cutdowns)
 *     without an active return designation (`IR-R` / `PUP-R` / 21-day window) or CBS expected return week.
 */
export function isSeasonEndingIrRecord({
  statusRaw = '',
  fantasyStatusAbbr = '',
  returnDateIso = null,
  placedDateIso = null,
  beatNote = '',
  txNote = '',
  cbsStatusText = '',
  isDesignatedToReturnOpen = false,
  seasonYear = 2026
} = {}) {
  if (isDesignatedToReturnOpen) return false;
  const stLower = String(statusRaw || '').toLowerCase();
  const combinedProse = `${beatNote || ''} ${txNote || ''}`;
  if (
    stLower.includes('left squad') ||
    stLower.includes('roster exemption') ||
    stLower.includes('suspended') ||
    String(fantasyStatusAbbr || '').toUpperCase() === 'RESERVE-EX' ||
    /looking to get reinstated|two-week (?:unpaid )?roster exemption|granted a [a-z0-9 -]*roster exemption/i.test(combinedProse)
  ) {
    return false;
  }

  if (SEASON_ENDING_PROSE_REGEX.test(combinedProse)) {
    return true;
  }

  const returnMs = parseFlexibleIsoMs(returnDateIso);
  const postSeasonSentinelMs = Date.UTC(Number(seasonYear) + 1, 1, 1); // Feb 1 of next calendar year
  if (returnMs !== null && returnMs >= postSeasonSentinelMs) {
    return true;
  }

  const placedMs = parseFlexibleIsoMs(placedDateIso);
  const preseasonStartMs = Date.UTC(Number(seasonYear), 4, 1); // May 1
  const preCutdownCutoffMs = Date.UTC(Number(seasonYear), 7, 24, 23, 59, 59); // Aug 24 (pre-cutdown)
  const abbrUpper = String(fantasyStatusAbbr || '').toUpperCase();
  const hasReturnTag = abbrUpper === 'IR-R' || abbrUpper === 'PUP-R' || /expected return/i.test(cbsStatusText || '');

  if (
    placedMs !== null &&
    placedMs >= preseasonStartMs &&
    placedMs <= preCutdownCutoffMs &&
    !hasReturnTag &&
    !stLower.includes('physically unable') &&
    abbrUpper !== 'PUP'
  ) {
    return true;
  }

  return false;
}

/**
 * Classifies an IR / PUP / Reserve player's return eligibility, 4-game CBA minimum timeline,
 * projected return label, and grounded factual note — with ZERO synthetic modulo math or fake rehab notes.
 */
export function classifyIrAndReserveTimeline({
  statusRaw = 'Injured Reserve',
  fantasyStatusAbbr = '',
  injuryType = 'Undisclosed',
  injuryDetail = '',
  returnDateIso = null,
  placedDateIso = null,
  txPlacedDateIso = null,
  designatedDateIso = null,
  beatNote = '',
  txNote = '',
  cbsStatusText = '',
  isDesignatedToReturnOpen = false,
  isActivated = false,
  currentWeek = 1,
  byeWeek = 8,
  seasonYear = 2026,
  scheduleEvents = [],
  corroboratedNewsSignal = null
} = {}) {
  const cleanInj = String(injuryType || 'Undisclosed').trim() || 'Undisclosed';
  const cleanDetail = String(injuryDetail || '').trim();
  const fullInjuryType =
    cleanDetail &&
    !cleanInj.toLowerCase().includes(cleanDetail.toLowerCase()) &&
    !/^(unspecified|undisclosed|not\s*specified|none)$/i.test(cleanDetail)
      ? `${cleanInj} (${cleanDetail})`
      : cleanInj;

  const stLower = String(statusRaw || '').toLowerCase();
  const combinedNote = String(beatNote || '').trim();
  const abbrUpper = String(fantasyStatusAbbr || '').toUpperCase();

  // 1. Reserve / Roster Exemption, Reserve / Left Squad, or Reserve / Suspended
  const isRosterExemption =
    abbrUpper === 'RESERVE-EX' ||
    stLower.includes('roster exemption') ||
    /\b(?:granted a [a-z0-9 -]*roster exemption|two-week (?:unpaid )?roster exemption)\b/i.test(combinedNote);
  const isLeftSquad =
    !isRosterExemption &&
    (stLower.includes('left squad') || /looking to get reinstated/i.test(combinedNote));
  const isSuspended = stLower.includes('suspended') || abbrUpper === 'SUSP';

  if (isRosterExemption || isLeftSquad || isSuspended) {
    const expMatch = isRosterExemption
      ? combinedNote.match(
          /\b(?:until|expires?\s+(?:monday,?\s*|tuesday,?\s*)?)((?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z.]*\s+\d{1,2})\b/i
        )
      : null;
    const expShort = expMatch ? expMatch[1].replace(/\./g, '') : '';

    return {
      status: isRosterExemption
        ? 'Reserve / Roster Exemption'
        : isLeftSquad
          ? 'Reserve / Left Squad'
          : 'Reserve / Suspended',
      injuryType: isRosterExemption
        ? 'Roster Exemption'
        : isLeftSquad
          ? 'Reserve / Left Squad'
          : 'Suspension',
      isSeasonEnding: false,
      isPracticeWindowOpen: false,
      isPracticeWindowExpected: false,
      placedBeforeWeek: 1,
      earliestEligibleWeek: null,
      missedGameWeeks: [],
      projectedReturnWeek: isRosterExemption
        ? expShort
          ? `Exemption Thru ${expShort}`
          : '2-Wk Roster Exemption'
        : isLeftSquad
          ? 'Reinstatement Pending'
          : 'Suspension Window',
      byeWeekNote: isRosterExemption
        ? 'Two-week NFL roster exemption following reinstatement'
        : isLeftSquad
          ? 'Reserve/Left Squad — requires formal NFL & club reinstatement'
          : 'Reserve/Suspended — ineligible until league reinstatement',
      beatNote:
        combinedNote ||
        (isRosterExemption
          ? 'Reinstated under a two-week NFL roster exemption; does not count against the 53-man active roster.'
          : isLeftSquad
            ? 'On Reserve/Left Squad list; requires formal club and league reinstatement before returning to active roster.'
            : 'On Reserve/Suspended list.')
    };
  }

  // 2. Season-Ending IR Check
  const effectivePlacedIso = txPlacedDateIso || placedDateIso;
  const seasonEnding = isSeasonEndingIrRecord({
    statusRaw,
    fantasyStatusAbbr,
    returnDateIso,
    placedDateIso: effectivePlacedIso,
    beatNote: combinedNote,
    txNote,
    cbsStatusText,
    isDesignatedToReturnOpen,
    seasonYear
  });

  const timeline = buildNormalizedNflWeekTimeline(scheduleEvents);
  const cbsWkMatch = String(cbsStatusText || '').match(/Expected Return\s*-\s*Week\s*(\d{1,2})/i);
  const cbsWeek = cbsWkMatch ? Number(cbsWkMatch[1]) : null;

  // Resolve `placedBeforeWeek` without letting a late-season blurb timestamp masquerade as IR placement date
  let placedBeforeWeek = 1;
  if (txPlacedDateIso) {
    placedBeforeWeek = resolvePlacedBeforeWeekFromDate(txPlacedDateIso, scheduleEvents, currentWeek);
  } else if (/opened the (?:regular )?season on (?:injured reserve|ir\b|pup\b|the pup list)/i.test(combinedNote)) {
    placedBeforeWeek = 1;
  } else if (placedDateIso) {
    placedBeforeWeek = resolvePlacedBeforeWeekFromDate(placedDateIso, scheduleEvents, currentWeek);
    // CBA invariant: if 21-day return window was opened ahead of `desigWk`, player MUST have missed >=4 games prior to `desigWk`
    if (isDesignatedToReturnOpen) {
      const desigWk = designatedDateIso
        ? resolvePlacedBeforeWeekFromDate(designatedDateIso, scheduleEvents, currentWeek)
        : Number(currentWeek) || 1;
      while (
        placedBeforeWeek > 1 &&
        calculateIrReturnTimeline(placedBeforeWeek, byeWeek, 4).earliestEligibleWeek > desigWk
      ) {
        placedBeforeWeek -= 1;
      }
    } else if (
      (cbsWeek !== null &&
        (!/placed .* on (?:injured reserve|ir\b)/i.test(combinedNote) ||
          /\b(?:placed on (?:injured reserve|ir\b) in (?:early |mid-|late )?(?:august|september|october)|nearing his return|practice window)\b/i.test(
            combinedNote
          ))) ||
      /\b(?:placed on (?:injured reserve|ir\b) in (?:early |mid-|late )?(?:august|september|october)|nearing his return|plan(?:s|ning)? to open\b[^.]{0,45}\bpractice window)\b/i.test(
        combinedNote
      )
    ) {
      const anchorWk = cbsWeek !== null ? cbsWeek : Number(currentWeek) || 1;
      // Blurb date is a mid-rehab status update rather than original IR placement date
      while (
        placedBeforeWeek > 1 &&
        calculateIrReturnTimeline(placedBeforeWeek, byeWeek, 4).earliestEligibleWeek > anchorWk
      ) {
        placedBeforeWeek -= 1;
      }
    }
  }

  if (seasonEnding) {
    let factualNote = combinedNote;
    if (!factualNote) {
      const placedMs = parseFlexibleIsoMs(effectivePlacedIso);
      const placedFmt = placedMs
        ? new Date(placedMs).toLocaleDateString('en-US', {
            month: 'short',
            day: 'numeric',
            year: 'numeric',
            timeZone: 'America/Los_Angeles'
          })
        : `${seasonYear} preseason`;
      factualNote = `Placed on Injured Reserve (${fullInjuryType}) on ${placedFmt}; ineligible to return in ${seasonYear} under NFL CBA rules.`;
    }
    return {
      status: 'Season-Ending IR',
      injuryType: fullInjuryType,
      isSeasonEnding: true,
      isPracticeWindowOpen: false,
      isPracticeWindowExpected: false,
      placedBeforeWeek,
      earliestEligibleWeek: null,
      missedGameWeeks: [],
      projectedReturnWeek: 'Out for Season',
      byeWeekNote: `Season-ending IR — ineligible to return in ${seasonYear}`,
      beatNote: factualNote
    };
  }

  // 3. Return-Eligible IR / Reserve-PUP Calculation
  const isPup =
    abbrUpper === 'PUP-R' ||
    abbrUpper === 'PUP' ||
    stLower.includes('physically unable') ||
    stLower === 'reserve / pup';

  const statusLabel = isPup
    ? 'Reserve / PUP'
    : isDesignatedToReturnOpen && !isActivated
      ? 'IR — 21-Day Window Open'
      : abbrUpper === 'IR-R'
        ? 'Injured Reserve (Designated)'
        : 'Injured Reserve';

  const irCalc = calculateIrReturnTimeline(placedBeforeWeek, byeWeek, 4);
  const earliestWk = irCalc.earliestEligibleWeek;

  let espnWeek = null;
  let espnDateShort = '';
  const returnMs = parseFlexibleIsoMs(returnDateIso);
  if (returnMs !== null && timeline.length > 0) {
    const matchedEv =
      timeline.find(item => item.ms >= returnMs - 36 * 3_600_000) || null;
    if (matchedEv) {
      espnWeek = matchedEv.week;
      espnDateShort = new Date(matchedEv.ms).toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        timeZone: 'America/Los_Angeles'
      });
    }
  }

  const formatTargetWeek = wkNum => {
    const ev = timeline.find(item => item.week === wkNum);
    const dtLabel = ev
      ? new Date(ev.ms).toLocaleDateString('en-US', {
          month: 'short',
          day: 'numeric',
          timeZone: 'America/Los_Angeles'
        })
      : '';
    return dtLabel ? `Est. Week ${wkNum} (${dtLabel})` : `Est. Week ${wkNum}`;
  };

  let projectedReturnWeek = '';
  let isPracticeWindowExpected = false;
  const curWk = Number(currentWeek) || 1;
  const rawEstWeek = Math.max(cbsWeek || 0, espnWeek || 0);
  const explicitWindowNotOpening =
    hasWindowDefinitelyNotOpeningSignal(combinedNote) ||
    Boolean(corroboratedNewsSignal?.hasWindowNotOpeningSignal) ||
    corroboratedNewsSignal?.signalType === 'WINDOW_NOT_OPENING_THIS_WEEK';
  const effectiveOpenWindow = Boolean(isDesignatedToReturnOpen) && !/\bnot\s+(?:yet\s+)?ready\s+to\s+return\s+to\s+practice\b/i.test(combinedNote);
  const hasCrediblePracticeReturnNews =
    !explicitWindowNotOpening &&
    Boolean(corroboratedNewsSignal?.hasSignal) &&
    (corroboratedNewsSignal.signalType === 'EXPECTED_PRACTICE_RETURN' ||
      corroboratedNewsSignal.signalType === 'EXPECTED_TO_PLAY') &&
    corroboratedNewsSignal.confidence >= 0.55 &&
    earliestWk <= curWk + 1;

  const finalStatusLabel =
    isPup
      ? 'Reserve / PUP'
      : effectiveOpenWindow && !isActivated
        ? 'IR — 21-Day Window Open'
        : abbrUpper === 'IR-R'
          ? 'Injured Reserve (Designated)'
          : 'Injured Reserve';

  if (effectiveOpenWindow) {
    // 21-day practice window IS open; ignore "wasn't activated Saturday" notes written before the completed prior week's game
    const lastPlayedEv = [...timeline].reverse().find(item => item.week < curWk);
    const blurbMs = parseFlexibleIsoMs(placedDateIso);
    const blurbPredatesCurrentWeek = Boolean(lastPlayedEv && blurbMs !== null && blurbMs < lastPlayedEv.ms);
    const ruledOutCurrentWeek =
      (!blurbPredatesCurrentWeek &&
        /not activated|didn't activate|did not activate|won't be activated|aren't activating|remains on injured reserve|ruled out|will not play|wait at least another week/i.test(
          combinedNote
        )) ||
      (cbsWeek !== null && cbsWeek > curWk);
    const minOpenWk = ruledOutCurrentWeek ? Math.max(curWk + 1, earliestWk) : Math.max(curWk, earliestWk);
    const targetWk = Math.max(minOpenWk, rawEstWeek);
    if (targetWk === byeWeek) {
      projectedReturnWeek = formatTargetWeek(targetWk + 1);
    } else if (targetWk === curWk && !ruledOutCurrentWeek) {
      projectedReturnWeek = espnDateShort
        ? `Week ${curWk} Activation Window (${espnDateShort})`
        : `Week ${curWk} Activation Window`;
    } else {
      projectedReturnWeek = formatTargetWeek(targetWk);
    }
  } else if (hasCrediblePracticeReturnNews) {
    // Corroborated coaching/Tier-1 beat report expects player's 21-day practice window to open this week:
    // Empirical NFL/49ers IR ramp-up spans 1–2 weeks from window opening (Week N–N+1), never overpromising instant activation.
    isPracticeWindowExpected = true;
    let winWk1 = Math.max(curWk, earliestWk);
    if (winWk1 === byeWeek) winWk1 += 1;
    let winWk2 = winWk1 + 1;
    if (winWk2 === byeWeek) winWk2 += 1;
    projectedReturnWeek =
      winWk1 < 18 && winWk2 <= 18
        ? `Est. Week ${winWk1}–${winWk2} (Window Expected)`
        : `Est. Week ${Math.min(18, winWk1)} (Window Expected)`;
  } else if (rawEstWeek > curWk) {
    // Concrete future week beyond currentWeek (e.g., Stribling Wk 13, Kirk Wk 13, Okuayinonu Wk 15)
    let targetWk = Math.max(rawEstWeek, earliestWk);
    if (targetWk === byeWeek) targetWk += 1;
    projectedReturnWeek = formatTargetWeek(targetWk);
  } else if (earliestWk > curWk) {
    // Recently placed on IR; 4-game minimum extends past currentWeek
    projectedReturnWeek = formatTargetWeek(earliestWk);
  } else {
    // ESPN rolling current-week trap: 4-game minimum has elapsed, but 21-day practice window has NOT been opened
    projectedReturnWeek = 'TBD (21d Window Not Open)';
  }

  const byeWeekNote = irCalc.byeWeekExcluded
    ? `Week ${byeWeek} Bye excluded from NFL 4-game minimum count`
    : '4-game NFL minimum requirement';

  const factualFallback = effectiveOpenWindow
    ? `21-day practice window opened; eligible for 53-man roster activation (${fullInjuryType}).`
    : isPracticeWindowExpected
      ? `4-game minimum satisfied on ${finalStatusLabel} (${fullInjuryType}); coaching staff expects 21-day practice window to open in Week ${curWk}.`
      : earliestWk <= curWk
        ? `4-game minimum satisfied on ${finalStatusLabel} (${fullInjuryType}); awaiting 21-day practice window designation.`
        : `Placed on ${finalStatusLabel} (${fullInjuryType}) ahead of Week ${placedBeforeWeek}; must miss at least 4 games (earliest eligible Week ${earliestWk}).`;

  let resolvedBeatNote = combinedNote || factualFallback;
  if (isPracticeWindowExpected && corroboratedNewsSignal?.leadClause) {
    const lead = String(corroboratedNewsSignal.leadClause).trim();
    if (lead && !resolvedBeatNote.toLowerCase().includes(lead.toLowerCase().slice(0, 28))) {
      resolvedBeatNote = combinedNote ? `${lead} ${combinedNote}` : lead;
    }
  }

  return {
    status: finalStatusLabel,
    injuryType: fullInjuryType,
    isSeasonEnding: false,
    isPracticeWindowOpen: effectiveOpenWindow,
    isPracticeWindowExpected,
    placedBeforeWeek,
    earliestEligibleWeek: earliestWk,
    missedGameWeeks: irCalc.missedGameWeeks,
    projectedReturnWeek,
    byeWeekNote,
    beatNote: resolvedBeatNote
  };
}

export function sortIrTrackerPriority(entry = {}) {
  if (entry.isPracticeWindowOpen) return 1;
  const wkMatch = String(entry.projectedReturnWeek || '').match(/Week\s*(\d{1,2})/i);
  if (!entry.isSeasonEnding && entry.isPracticeWindowExpected && wkMatch) {
    return 5 + Number(wkMatch[1]);
  }
  if (!entry.isSeasonEnding && wkMatch) return 10 + Number(wkMatch[1]);
  if (!entry.isSeasonEnding && /TBD/i.test(entry.projectedReturnWeek || '')) return 40;
  if (!entry.isSeasonEnding) return 50;
  return 100;
}

/**
 * Shared deterministic reconciler aligning `roster.players[*].health`, `health.practiceReport`,
 * `health.irAndReserveTracker`, and `depthChart.units` with corroborated, trust-weighted post-game
 * coaching/beat news & live official transactions — without overreacting to single/speculative tweets.
 */
export function reconcileRosterAndHealthWithNews(appData = {}, { nowMs = Date.now() } = {}) {
  const rosterPlayers = appData?.roster?.players;
  if (!Array.isArray(rosterPlayers) || rosterPlayers.length === 0) return false;

  const baseCurrentWeek = Number(
    appData?.health?.week ||
      appData?.scheduleMatchup?.upcomingMatchup?.week ||
      appData?.meta?.currentWeek ||
      1
  );
  const byeWeek = Number(appData?.health?.byeWeek || 8);
  const schedule = appData?.scheduleMatchup?.schedule || [];

  const rawUpcomingKickoffIso =
    appData?.scheduleMatchup?.upcomingMatchup?.kickoffIso ||
    appData?.scheduleMatchup?.upcomingMatchup?.dateIso ||
    schedule.find(g => g && !g.completed && !g.isByeWeek)?.dateIso ||
    '';
  const rawUpcomingMs = parseFlexibleIsoMs(rawUpcomingKickoffIso);
  const matchedUpcomingGame =
    rawUpcomingMs !== null
      ? schedule.find(g => {
          if (!g) return false;
          const gMs = parseFlexibleIsoMs(g.dateIso || g.kickoffIso);
          return gMs !== null && Math.abs(gMs - rawUpcomingMs) < 18 * 3_600_000;
        }) || null
      : null;
  const umObj = appData?.scheduleMatchup?.upcomingMatchup || {};
  const umStDetail = `${matchedUpcomingGame?.statusDetail || ''} ${umObj.statusDetail || ''}`;
  const umExplicitCompleted = Boolean(
    umObj.completed ||
      matchedUpcomingGame?.completed ||
      String(umObj.liveState || '').toLowerCase() === 'post' ||
      String(matchedUpcomingGame?.statusState || '').toLowerCase() === 'post' ||
      /\bfinal\b/i.test(umStDetail)
  );
  const umLiveOrDelayed =
    !umExplicitCompleted &&
    (String(umObj.liveState || '').toLowerCase() === 'in' ||
      Boolean(umObj.isGameInProgress) ||
      String(matchedUpcomingGame?.statusState || '').toLowerCase() === 'in' ||
      Boolean(matchedUpcomingGame?.isLive) ||
      /\b(1st|2nd|3rd|4th|q[1-4]|halftime|in progress|ot|overtime|delayed|weather delay|lightning delay|suspended)\b/i.test(
        umStDetail
      ));
  const upcomingMaxClockMs = umLiveOrDelayed ? 10 * 3_600_000 : 5.25 * 3_600_000;
  const upcomingHasConcludedByClock =
    umExplicitCompleted || (rawUpcomingMs !== null && nowMs > rawUpcomingMs + upcomingMaxClockMs);
  const seasonConcluded = Boolean(appData?.scheduleMatchup?.upcomingMatchup?.seasonConcluded);

  // If the static upcomingMatchup has already concluded by wall-clock time (e.g. Monday morning before static refresh),
  // resolve the next unplayed schedule game for weekly IR activation deadlines and opponent scoping!
  const nextScheduleGame = upcomingHasConcludedByClock
    ? schedule
        .filter(g => g && !g.completed && !g.isByeWeek && !g.opponent?.isTbd)
        .map(g => ({ g, ms: parseFlexibleIsoMs(g.dateIso || g.kickoffIso) }))
        .filter(x => x.ms !== null && nowMs <= x.ms + 5.25 * 3_600_000)
        .sort((a, b) => a.ms - b.ms)[0]?.g || null
    : null;

  const currentWeek = nextScheduleGame?.week ? Number(nextScheduleGame.week) : baseCurrentWeek;
  const upcomingKickoffIso = nextScheduleGame
    ? nextScheduleGame.dateIso || nextScheduleGame.kickoffIso || rawUpcomingKickoffIso
    : rawUpcomingKickoffIso;
  const upcomingOppName = nextScheduleGame
    ? nextScheduleGame.opponent?.name || nextScheduleGame.oppName || ''
    : appData?.scheduleMatchup?.upcomingMatchup?.oppName || '';
  const upcomingOppAbbr = nextScheduleGame
    ? nextScheduleGame.opponent?.abbr || nextScheduleGame.oppAbbr || ''
    : appData?.scheduleMatchup?.upcomingMatchup?.oppAbbr || '';

  // Post-prior-game cutoff: only news published AFTER the most recently completed game can adjust upcoming-week health
  const completedGames = schedule
    .filter(g => (g?.completed || (upcomingHasConcludedByClock && Number(g?.week) === baseCurrentWeek)) && (g.dateIso || g.kickoffIso))
    .map(g => parseFlexibleIsoMs(g.dateIso || g.kickoffIso))
    .filter(ms => ms !== null)
    .sort((a, b) => b - a);
  const lastCompletedGameKickoffMs = completedGames.length > 0 ? completedGames[0] : null;
  const lastCompletedGameEndMs =
    lastCompletedGameKickoffMs !== null ? lastCompletedGameKickoffMs + 3 * 3_600_000 : nowMs - 4.5 * 86_400_000;

  const seasonYear = Number(appData?.meta?.seasonYear || 2026);
  const rawStream = Array.isArray(appData?.news?.rawStream) ? appData.news.rawStream : [];
  const rosterPlayerNames = rosterPlayers.map(p => p?.name).filter(Boolean);
  const sharedRosterSurnames = computeSharedRosterSurnames(rosterPlayers);

  // Pre-filter `rawStream` once for the 5-day / post-prior-game injury signal window instead of re-scanning all 350+ items 87 times
  const preScanFiveDaysAgoMs = nowMs - 5 * 86_400_000;
  const preScanPostGameMinMs =
    Number.isFinite(lastCompletedGameEndMs) && lastCompletedGameEndMs > 0
      ? Math.max(preScanFiveDaysAgoMs, lastCompletedGameEndMs)
      : preScanFiveDaysAgoMs;
  const preScanInGameMinMs =
    Number.isFinite(lastCompletedGameKickoffMs) && lastCompletedGameKickoffMs > 0
      ? Math.max(preScanFiveDaysAgoMs, lastCompletedGameKickoffMs + 5 * 60_000)
      : preScanPostGameMinMs;
  const preScanFloorMs = Math.min(preScanPostGameMinMs, preScanInGameMinMs);
  const eligibleSignalRawStream = [];
  for (const srcItem of rawStream) {
    if (!srcItem || srcItem.isClickbait || srcItem.type === 'video') continue;
    const pubMs = parseFlexibleIsoMs(srcItem.publishedAt);
    if (pubMs === null || pubMs < preScanFloorMs || pubMs > nowMs + 3_600_000) continue;
    eligibleSignalRawStream.push(srcItem);
  }

  // Gather deduplicated current-week wire + player-mention pool once for live practice report extraction
  const globalWirePool = [];
  const globalSeenKeys = new Set();
  for (const srcItem of [
    ...rawStream,
    ...rosterPlayers.flatMap(rp => (Array.isArray(rp?.recentNews) ? rp.recentNews : []))
  ]) {
    if (!srcItem) continue;
    const gk = String(srcItem.id || srcItem.url || srcItem.fullText || srcItem.title || srcItem.headline || '')
      .toLowerCase()
      .slice(0, 110);
    if (!gk || globalSeenKeys.has(gk)) continue;
    globalSeenKeys.add(gk);
    globalWirePool.push(srcItem);
  }

  const liveWirePracticeMap = extractLivePracticeParticipationFromWire({
    newsItems: globalWirePool,
    rosterPlayers,
    kickoffIso: upcomingKickoffIso,
    lastCompletedGameEndMs,
    nowMs,
    seasonYear
  });
  const fullReportObservedSlots = liveWirePracticeMap._fullReportObservedSlots || new Set();

  let mutated = false;

  for (const p of rosterPlayers) {
    if (!p?.health || !p.name) continue;

    // Combine pre-filtered recent rawStream + player's own recentNews, deduplicated by URL/headline prefix
    const combinedNews = [];
    const seenKeys = new Set();
    for (const srcItem of [...eligibleSignalRawStream, ...(Array.isArray(p.recentNews) ? p.recentNews : [])]) {
      if (!srcItem) continue;
      const k = String(srcItem.url || srcItem.id || srcItem.fullText || srcItem.title || srcItem.headline || '')
        .toLowerCase()
        .slice(0, 96);
      if (!k || seenKeys.has(k)) continue;
      seenKeys.add(k);
      combinedNews.push(srcItem);
    }

    const wirePrac = liveWirePracticeMap.get(p.id) || null;
    let practiceChanged = Boolean(p.health._practiceRestoredFromCache);
    if (p.health._practiceRestoredFromCache) {
      delete p.health._practiceRestoredFromCache;
    }
    if (wirePrac) {
      if (!p.health._slotPubMs || typeof p.health._slotPubMs !== 'object') {
        p.health._slotPubMs = { wed: 0, thu: 0, fri: 0 };
      }
      for (const slot of ['wed', 'thu', 'fri']) {
        const candSlotVal = wirePrac[slot];
        const candSlotMs = wirePrac.slotPubMs?.[slot] || 0;
        const prevSlotMs = p.health._slotPubMs[slot] || 0;
        // Never let an earlier open-media beat tweet overwrite an authoritative `49ers.com` official practice cell!
        const isOfficialProtected = Boolean(p.health._officialSlots?.[slot]) && p.health[slot] && p.health[slot] !== '-';
        if (
          candSlotVal &&
          !isOfficialProtected &&
          (!p.health[slot] ||
            p.health[slot] === '-' ||
            (candSlotMs > 0 && candSlotMs > prevSlotMs && p.health[slot] !== candSlotVal))
        ) {
          p.health[slot] = candSlotVal;
          if (candSlotMs > 0) p.health._slotPubMs[slot] = candSlotMs;
          practiceChanged = true;
          mutated = true;
        }
      }
      if (wirePrac.hasSideFieldRehab && !p.health.hasSideFieldRehab) {
        p.health.hasSideFieldRehab = true;
        practiceChanged = true;
        mutated = true;
      }
      if (
        wirePrac.injuryType &&
        (!p.health.injuryType ||
          p.health.injuryType === 'Undisclosed' ||
          (!isRestOrPersonalInjuryLabel(wirePrac.injuryType) && isRestOrPersonalInjuryLabel(p.health.injuryType)))
      ) {
        p.health.injuryType = wirePrac.injuryType;
        practiceChanged = true;
        mutated = true;
      }
      // Newly surfaced active-roster injury on Wednesday/Thursday/Friday beat practice report
      if (
        p.rosterBucket === 'active' &&
        !p.health.isOnPracticeReport &&
        (wirePrac.wed === 'DNP' || wirePrac.wed === 'LP' || wirePrac.thu === 'DNP' || wirePrac.thu === 'LP' || wirePrac.fri === 'DNP' || wirePrac.fri === 'LP')
      ) {
        p.health.isOnPracticeReport = true;
        if (!p.health.status || p.health.status === 'Active') {
          p.health.status = 'Questionable';
        }
        practiceChanged = true;
        mutated = true;
      }
      // If a Wednesday Vet Rest player develops a Thursday LP/DNP medical injury (e.g. Trent Williams shoulder, Dre Greenlaw knee),
      // transition mid-week status from Active to Questionable until Friday clearance!
      if (
        p.rosterBucket === 'active' &&
        p.health.isOnPracticeReport &&
        !isRestOrPersonalInjuryLabel(p.health.injuryType) &&
        (p.health.thu === 'LP' || p.health.thu === 'DNP') &&
        (!p.health.fri || p.health.fri === '-') &&
        (!p.health.status || p.health.status === 'Active')
      ) {
        p.health.status = 'Questionable';
        practiceChanged = true;
        mutated = true;
      }
    }

    // NFL Personnel Report Continuity Rule: once a full-team official participation report ("49ers participation report")
    // has posted for Thu or Fri listing all DNP and Limited players, any remaining prior-day reportee (e.g. Wed Vet Rest or Wed FP)
    // who was not listed as DNP or Limited and is not ruled Out practiced in Full (FP)!
    const isTrackedWeeklyReportee =
      Boolean(p.health.isOnPracticeReport) || (p.rosterBucket === 'ir' && Boolean(p.health.isPracticeWindowOpen));
    const isRuledOutStatus = /^(?:out|inactive)\b/i.test(String(p.health.status || '').trim());
    if (isTrackedWeeklyReportee && !isRuledOutStatus) {
      if (
        fullReportObservedSlots.has('thu') &&
        p.health.wed &&
        p.health.wed !== '-' &&
        (!p.health.thu || p.health.thu === '-')
      ) {
        p.health.thu = 'FP';
        practiceChanged = true;
        mutated = true;
      }
      if (
        fullReportObservedSlots.has('fri') &&
        ((p.health.wed && p.health.wed !== '-') || (p.health.thu && p.health.thu !== '-')) &&
        (!p.health.fri || p.health.fri === '-')
      ) {
        p.health.fri = 'FP';
        practiceChanged = true;
        mutated = true;
      }
    }

    const priorCompletedWeek = currentWeek > 1 ? (currentWeek - 1 === byeWeek ? currentWeek - 2 : currentWeek - 1) : null;
    const priorWeekHistEntry = priorCompletedWeek
      ? (p.health.weeklyHistory2026 || []).find(h => Number(h?.week) === priorCompletedWeek) || null
      : null;
    const priorWeekInjuryType = String(priorWeekHistEntry?.injury || '').trim();

    const newsSig = evaluateCorroboratedNewsInjurySignal({
      playerName: p.name,
      playerId: p.id,
      rosterBucket: p.rosterBucket,
      newsItems: combinedNews,
      rosterPlayerNames,
      sharedSurnames: sharedRosterSurnames,
      nowMs,
      windowStartMs: lastCompletedGameEndMs,
      lastCompletedGameKickoffMs,
      lastCompletedWeek: priorCompletedWeek,
      priorWeekInjuryType
    });

    if (p.rosterBucket === 'ir' || p.rosterBucket === 'suspended') {
      if (p.health.isSeasonEnding) continue;

      // Live 53-man IR activation on transaction wire ("activated <Player> from injured reserve")
      if (newsSig.hasOfficialActivationFromIr && p.rosterBucket === 'ir') {
        p.rosterBucket = 'active';
        p.health.isPracticeWindowOpen = false;
        p.health.isPracticeWindowExpected = false;
        p.health.isIrReturnQuestionable = false;
        p.health.isOnPracticeReport = false;
        p.health.status = 'Active';
        p.health.playProbabilityPct = 95;
        p.health.playTier = 'ACTIVE';
        p.health.playBadgeLabel = '95% • Full Go';
        p.health.factors = ['Officially activated from Injured Reserve onto 53-man active roster'];
        mutated = true;
        continue;
      }

      const persisted21dWindow =
        !p.health.isPracticeWindowOpen && p.rosterBucket === 'ir'
          ? detectOpen21DayIrWindowFromHistory({
              playerName: p.name,
              rosterBucket: p.rosterBucket,
              isSeasonEnding: Boolean(p.health.isSeasonEnding),
              fantasyStatusAbbr: p.health.fantasyStatusAbbr || '',
              earliestEligibleWeek: p.health.earliestEligibleWeek ?? null,
              weeklyHistory: p.health.weeklyHistory2026 || [],
              beatNote: pickMeaningfulInjuryComment(
                p.health.irBeatNote,
                p.health.longComment,
                p.health.shortComment
              ),
              newsItems: combinedNews,
              rosterPlayerNames,
              currentWeek,
              nowMs
            })
          : { isOpen: false, designatedDateIso: null, leadNote: '' };

      if (
        (newsSig.hasOfficialTxDesignation || wirePrac?.openedPracticeWindow || persisted21dWindow.isOpen) &&
        !p.health.isPracticeWindowOpen
      ) {
        p.health.isPracticeWindowOpen = true;
        p.health.isPracticeWindowExpected = false;
        p.health.status = 'IR — 21-Day Window Open';
        p.health.projectedReturnWeek = `Week ${currentWeek} Activation Window`;
        if (!p.health.designatedDateIso && persisted21dWindow.designatedDateIso) {
          p.health.designatedDateIso = persisted21dWindow.designatedDateIso;
        }
        const leadNoteToPrepend = wirePrac?.latestNote || persisted21dWindow.leadNote || '';
        if (leadNoteToPrepend) {
          const lead = String(leadNoteToPrepend).trim();
          const existingIrNote = String(p.health.irBeatNote || p.health.longComment || '').trim();
          if (lead && !existingIrNote.toLowerCase().includes(lead.toLowerCase().slice(0, 28))) {
            p.health.irBeatNote = existingIrNote ? `${lead} ${existingIrNote}` : lead;
          }
        }
        mutated = true;
      } else if (
        p.health.isPracticeWindowOpen &&
        /^Week\s+(\d+)\s+Activation Window/i.test(String(p.health.projectedReturnWeek || '')) &&
        Number(String(p.health.projectedReturnWeek).match(/^Week\s+(\d+)/i)?.[1] || 0) < currentWeek
      ) {
        p.health.projectedReturnWeek = `Week ${currentWeek} Activation Window`;
        mutated = true;
      } else if (
        !p.health.isPracticeWindowOpen &&
        (newsSig.hasWindowNotOpeningSignal ||
          newsSig.signalType === 'WINDOW_NOT_OPENING_THIS_WEEK' ||
          hasWindowDefinitelyNotOpeningSignal(p.health.irBeatNote || p.health.longComment || ''))
      ) {
        if (p.health.isPracticeWindowExpected || /Window Expected/i.test(String(p.health.projectedReturnWeek || ''))) {
          p.health.isPracticeWindowExpected = false;
          const earliestWk = Number(p.health.earliestEligibleWeek || 1);
          p.health.projectedReturnWeek =
            earliestWk > currentWeek ? `Est. Week ${earliestWk}` : 'TBD (21d Window Not Open)';
          mutated = true;
        }
      } else if (
        !p.health.isPracticeWindowOpen &&
        newsSig.hasSignal &&
        (newsSig.signalType === 'EXPECTED_PRACTICE_RETURN' || newsSig.signalType === 'EXPECTED_TO_PLAY') &&
        newsSig.confidence >= 0.55
      ) {
        const earliestWk = Number(p.health.earliestEligibleWeek || 1);
        const curProj = String(p.health.projectedReturnWeek || '');
        const hasLaterConcreteTarget =
          /^Est\.\s+Week\s+(\d+)/i.test(curProj) &&
          !/Window Expected/i.test(curProj) &&
          Number(curProj.match(/Week\s+(\d+)/i)?.[1] || 0) > baseCurrentWeek + 1;

        if (earliestWk <= baseCurrentWeek + 1 && !hasLaterConcreteTarget) {
          let winWk1 = Math.max(baseCurrentWeek, earliestWk);
          if (winWk1 === byeWeek) winWk1 += 1;
          let winWk2 = winWk1 + 1;
          if (winWk2 === byeWeek) winWk2 += 1;
          const nextProj =
            winWk1 < 18 && winWk2 <= 18
              ? `Est. Week ${winWk1}–${winWk2} (Window Expected)`
              : `Est. Week ${Math.min(18, winWk1)} (Window Expected)`;

          if (p.health.projectedReturnWeek !== nextProj || !p.health.isPracticeWindowExpected) {
            p.health.projectedReturnWeek = nextProj;
            p.health.isPracticeWindowExpected = true;
            mutated = true;
          }
          if (newsSig.leadClause) {
            const lead = String(newsSig.leadClause).trim();
            const existingIrNote = String(p.health.irBeatNote || p.health.longComment || p.health.shortComment || '').trim();
            if (lead && !existingIrNote.toLowerCase().includes(lead.toLowerCase().slice(0, 28))) {
              p.health.irBeatNote = existingIrNote ? `${lead} ${existingIrNote}` : lead;
              mutated = true;
            }
          }
        }
      }

      // Compute activation + play probability for return-eligible IR/PUP players (especially open 21-day windows!)
      if (
        p.rosterBucket === 'ir' &&
        (p.health.isPracticeWindowOpen ||
          p.health.isIrReturnQuestionable ||
          (p.health.playProbabilityPct || 0) > 0 ||
          practiceChanged ||
          newsSig.hasSignal)
      ) {
        const irCombinedBeat = pickMeaningfulInjuryComment(
          wirePrac?.latestNote,
          newsSig.leadClause,
          p.health.irBeatNote,
          p.health.longComment,
          p.health.shortComment
        );
        const irPlayProb = computePlayerPlayProbability({
          name: p.name,
          position: p.position,
          experienceYears: p.experienceYears ?? null,
          snapPct: p.primarySnapPct ?? null,
          gameStatus: p.health.status,
          rosterBucket: p.rosterBucket,
          isPracticeWindowOpen: Boolean(p.health.isPracticeWindowOpen),
          isIrReturnQuestionable: Boolean(p.health.isIrReturnQuestionable),
          isSeasonEnding: false,
          fantasyStatusAbbr: p.health.fantasyStatusAbbr || '',
          injuryType: p.health.injuryType || '',
          wed: p.health.wed,
          thu: p.health.thu,
          fri: p.health.fri,
          hasSideFieldRehab: Boolean(p.health.hasSideFieldRehab),
          beatNote: irCombinedBeat,
          designatedDateIso: p.health.designatedDateIso || '',
          kickoffIso: upcomingKickoffIso,
          nowMs,
          schedule,
          seasonConcluded,
          weeklyHistory: p.health.weeklyHistory2026 || [],
          earliestEligibleWeek: p.health.earliestEligibleWeek ?? null,
          currentWeek,
          byeWeek,
          upcomingOppName,
          upcomingOppAbbr,
          blurbDateIso: p.health.blurbDateIso || null,
          lastCompletedGameKickoffMs,
          rosterPlayerNames,
          corroboratedNewsSignal: newsSig
        });

        const nextOnPracticeReport = Boolean(p.health.isPracticeWindowOpen && irPlayProb.probabilityPct > 0);
        if (
          p.health.playProbabilityPct !== irPlayProb.probabilityPct ||
          p.health.playBadgeLabel !== irPlayProb.badgeLabel ||
          Boolean(p.health.isOnPracticeReport) !== nextOnPracticeReport
        ) {
          mutated = true;
        }
        p.health.playProbabilityPct = irPlayProb.probabilityPct;
        p.health.playTier = irPlayProb.tier;
        p.health.playBadgeLabel = irPlayProb.badgeLabel;
        p.health.factors = irPlayProb.factors;
        p.health.isOnPracticeReport = nextOnPracticeReport;
        if (!nextOnPracticeReport && p.health.isIrReturnQuestionable) {
          p.health.isIrReturnQuestionable = false;
          if (/Questionable/i.test(String(p.health.status || '')) && p.health.isPracticeWindowOpen) {
            p.health.status = 'IR — 21-Day Window Open';
          }
        }
      }
      continue;
    }

    if (p.rosterBucket === 'practice_squad') {
      const psProb = computePlayerPlayProbability({
        name: p.name,
        position: p.position,
        experienceYears: p.experienceYears ?? null,
        snapPct: p.primarySnapPct ?? 0,
        gameStatus: p.health.status,
        rosterBucket: 'practice_squad'
      });
      if (
        p.health.playProbabilityPct !== psProb.probabilityPct ||
        p.health.playBadgeLabel !== psProb.badgeLabel ||
        p.health.playTier !== psProb.tier ||
        p.health.isOnPracticeReport ||
        !p.health.status ||
        /^(?:active|practice_squad|out)$/i.test(String(p.health.status).trim())
      ) {
        p.health.status = 'Practice Squad';
        p.health.isOnPracticeReport = false;
        p.health.playProbabilityPct = psProb.probabilityPct;
        p.health.playTier = psProb.tier;
        p.health.playBadgeLabel = psProb.badgeLabel;
        p.health.factors = psProb.factors;
        if (!p.health.archetypeNote && psProb.priorUsed?.archetypeNote) {
          p.health.archetypeNote = psProb.priorUsed.archetypeNote;
        }
        mutated = true;
      }
      continue;
    }

    // Promote active-roster players who sustained a corroborated in-game / post-game / mid-week injury in beat/podium news
    // before ESPN `/injuries` or `49ers.com` posts their weekly designation (unless a newer current-week official team
    // participation report has already published and omitted them as a healthy full participant!).
    const latestFullReportMs = Number(liveWirePracticeMap._latestFullReportPubMs || 0);
    const isPostGameOrPrePracticeSignal =
      newsSig.signalType === 'SUSTAINED_IN_GAME_INJURY' ||
      newsSig.signalType === 'UNLIKELY_WEDNESDAY_PRACTICE' ||
      newsSig.signalType === 'DAY_TO_DAY';
    const supersededByNewerOfficialReport =
      (Boolean(appData.health?._hasLiveOfficialCurrentWeekSfReport) &&
        (isPostGameOrPrePracticeSignal ||
          (latestFullReportMs > 0 && (newsSig.latestPubMs || 0) <= latestFullReportMs))) ||
      (fullReportObservedSlots.size > 0 && latestFullReportMs > 0 && (newsSig.latestPubMs || 0) <= latestFullReportMs);
    const shouldPromoteActivePlayerFromNews =
      p.rosterBucket === 'active' &&
      !p.health.isOnPracticeReport &&
      !appData.health?.gameDayRoster?.isActive &&
      !supersededByNewerOfficialReport &&
      newsSig.hasSignal &&
      newsSig.confidence >= 0.42 &&
      (newsSig.signalType === 'SUSTAINED_IN_GAME_INJURY' ||
        newsSig.signalType === 'RULED_OUT_WEEK' ||
        newsSig.signalType === 'UNLIKELY_THIS_WEEK' ||
        newsSig.signalType === 'UNLIKELY_WEDNESDAY_PRACTICE' ||
        (newsSig.signalType === 'TRENDING_DOWNWARD' && (newsSig.hasLateSetback || Boolean(newsSig.inferredInjuryType))) ||
        (newsSig.signalType === 'DAY_TO_DAY' && Boolean(newsSig.inferredInjuryType)));

    if (shouldPromoteActivePlayerFromNews) {
      p.health.isOnPracticeReport = true;
      p.health.sustainedInLastGame = newsSig.signalType === 'SUSTAINED_IN_GAME_INJURY';
      p.health.exitedPriorGameWithoutReturn = Boolean(newsSig.exitedWithoutReturn);
      const resolvedInj =
        p.health.injuryType || newsSig.inferredInjuryType || priorWeekInjuryType || 'Undisclosed';
      p.health.injuryType = resolvedInj;
      p.health.status =
        newsSig.signalType === 'RULED_OUT_WEEK' && newsSig.confidence >= 0.6
          ? 'Out'
          : newsSig.isMultiWeekOrSurgery
            ? 'Doubtful'
            : 'Questionable';
      if (newsSig.leadClause) {
        p.health.shortComment = newsSig.leadClause;
        p.health.longComment = newsSig.leadClause;
      }
      mutated = true;
    }

    if (p.rosterBucket === 'active' && p.health.isOnPracticeReport) {
      if (newsSig.signalType === 'SUSTAINED_IN_GAME_INJURY' && newsSig.confidence >= 0.42) {
        p.health.sustainedInLastGame = true;
        if (newsSig.exitedWithoutReturn) p.health.exitedPriorGameWithoutReturn = true;
        if ((!p.health.injuryType || p.health.injuryType === 'Undisclosed') && (newsSig.inferredInjuryType || priorWeekInjuryType)) {
          p.health.injuryType = newsSig.inferredInjuryType || priorWeekInjuryType;
          mutated = true;
        }
      }
      // Upgrade bare status placeholder comments ("inactive", "out", "questionable") or stale pregame clearance notes with verified injury/beat context
      const bestLeadNote = wirePrac?.latestNote || newsSig.leadClause || '';
      const hasStalePregameClearanceComment =
        Boolean(p.health.sustainedInLastGame) &&
        /\b(?:is active for (?:sunday|monday|thursday|saturday)|given the green light to play|cleared by medical staff to play)\b/i.test(
          `${p.health.shortComment || ''} ${p.health.longComment || ''}`
        );
      if ((isBareStatusPlaceholderComment(p.health.longComment) || hasStalePregameClearanceComment) && bestLeadNote) {
        p.health.longComment = bestLeadNote;
        if (isBareStatusPlaceholderComment(p.health.shortComment) || hasStalePregameClearanceComment) {
          p.health.shortComment = bestLeadNote;
        }
        mutated = true;
      }

      const rawStatusLower = String(p.health.status || '').toLowerCase();
      const isEarlyPrePractice =
        (p.health.wed === '-' || !p.health.wed) &&
        (p.health.thu === '-' || !p.health.thu) &&
        (p.health.fri === '-' || !p.health.fri);

      const hasPreReportPracticeNote =
        hasObservedPracticeReturnSignal(p.health.shortComment || '') ||
        hasObservedPracticeReturnSignal(p.health.longComment || '');

      if (
        practiceChanged ||
        newsSig.hasSignal ||
        hasPreReportPracticeNote ||
        (isEarlyPrePractice && rawStatusLower === 'questionable')
      ) {
        const combinedComment = pickMeaningfulInjuryComment(p.health.longComment, p.health.shortComment);
        // Strip prior-game availability rulings if we are in early-week pre-practice rollover
        const noteForModel =
          isEarlyPrePractice && rawStatusLower !== 'out'
            ? combinedComment.replace(
                /\b(is inactive|was inactive|officially inactive|ruled out|will not play|won't play|is out for|will miss (?:his |a )?[a-z0-9 -]*(?:game|contest|matchup|tilt|clash)|missing (?:a |his )?[a-z0-9 -]*(?:game|contest|matchup|tilt|clash)|miss(?:ing)? (?:sunday|monday|thursday|saturday)'?s?|inactive (?:sunday|monday|thursday|saturday)|inactive for (?:sunday|monday|thursday|saturday))\b/gi,
                'sidelined previously'
              )
            : combinedComment;

        const playProb = computePlayerPlayProbability({
          name: p.name,
          position: p.position,
          experienceYears: p.experienceYears ?? null,
          snapPct: p.primarySnapPct ?? null,
          gameStatus: p.health.status,
          rosterBucket: p.rosterBucket,
          isIrReturnQuestionable: Boolean(p.health.isIrReturnQuestionable),
          isSeasonEnding: Boolean(p.health.isSeasonEnding),
          sustainedInLastGame: Boolean(p.health.sustainedInLastGame),
          exitedPriorGameWithoutReturn: Boolean(p.health.exitedPriorGameWithoutReturn),
          fantasyStatusAbbr: p.health.fantasyStatusAbbr || '',
          injuryType: p.health.injuryType || '',
          wed: p.health.wed,
          thu: p.health.thu,
          fri: p.health.fri,
          hasSideFieldRehab: Boolean(p.health.hasSideFieldRehab),
          beatNote: noteForModel,
          kickoffIso: upcomingKickoffIso,
          nowMs,
          blurbDateIso: p.health.blurbDateIso || null,
          weeklyHistory: p.health.weeklyHistory2026 || [],
          currentWeek,
          byeWeek,
          rosterPlayerNames,
          corroboratedNewsSignal: newsSig
        });

        if (!appData.health?.gameDayRoster?.isActive) {
          if (
            newsSig.signalType === 'RULED_OUT_WEEK' &&
            newsSig.confidence >= 0.6 &&
            playProb.probabilityPct === 0 &&
            p.health.status !== 'Out'
          ) {
            p.health.status = 'Out';
            mutated = true;
          }
          if (
            p.health.playProbabilityPct !== playProb.probabilityPct ||
            p.health.playBadgeLabel !== playProb.badgeLabel
          ) {
            mutated = true;
          }
          p.health.playProbabilityPct = playProb.probabilityPct;
          p.health.playTier = playProb.tier;
          p.health.playBadgeLabel = playProb.badgeLabel;
          p.health.factors = playProb.factors;
          p.health.hasPreReportPracticeReturn = Boolean(playProb.appliedPreReportPracticeReturn);
        } else if (Array.isArray(appData.health?._preGamePracticeReport)) {
          const preRow = appData.health._preGamePracticeReport.find(
            r => String(r.playerId || '') === String(p.id) || canonicalInjuryPlayerKey(r.name) === canonicalInjuryPlayerKey(p.name)
          );
          if (preRow) {
            if (p.health.wed && p.health.wed !== '-' && preRow.wed !== p.health.wed) {
              preRow.wed = p.health.wed;
              mutated = true;
            }
            if (p.health.thu && p.health.thu !== '-' && preRow.thu !== p.health.thu) {
              preRow.thu = p.health.thu;
              mutated = true;
            }
            if (p.health.fri && p.health.fri !== '-' && preRow.fri !== p.health.fri) {
              preRow.fri = p.health.fri;
              mutated = true;
            }
            if (p.health.injuryType && !isRestOrPersonalInjuryLabel(p.health.injuryType)) {
              preRow.injuryType = p.health.injuryType;
            }
            preRow.playProbabilityPct = playProb.probabilityPct;
            preRow.playTier = playProb.tier;
            preRow.playBadgeLabel = playProb.badgeLabel;
            preRow.factors = playProb.factors;
          }
        }
      }
    }
  }

  // Synchronize `appData.health` tables unless inside an active [T-90m, Final) game-day roster lock
  if (appData.health && !appData.health.gameDayRoster?.isActive) {
    // Only blank W/T/F when strictly prior to Practice Day 1 AND zero current-week practice reports have arrived!
    const koMs = upcomingKickoffIso ? Date.parse(upcomingKickoffIso) : NaN;
    const isCalendarBeforePractice = (() => {
      if (!Number.isFinite(koMs) || nowMs >= koMs) return false;
      const koPt = extractPtDayMeta(koMs);
      const nowPt = extractPtDayMeta(nowMs);
      const leadDays = getPracticeReportLeadDays(koPt.weekday);
      const diff = koPt.dayIndex - nowPt.dayIndex;
      if (diff > leadDays) return true;
      if (diff === leadDays) return nowPt.minutesOfDay < 12 * 60 + 15;
      return false;
    })();
    const hasObservedCurrentWeekPractice =
      liveWirePracticeMap.size > 0 ||
      rosterPlayers.some(
        rp =>
          rp.health?.isOnPracticeReport &&
          ((rp.health.wed && rp.health.wed !== '-') ||
            (rp.health.thu && rp.health.thu !== '-') ||
            (rp.health.fri && rp.health.fri !== '-'))
      );
    const shouldBlankEarlyWeek = isCalendarBeforePractice && !hasObservedCurrentWeekPractice;

    const prevReportSig = Array.isArray(appData.health.practiceReport)
      ? appData.health.practiceReport.map(r => `${r.playerId || r.name}:${r.playProbabilityPct}:${r.wed}:${r.thu}:${r.fri}:${r.injuryType}`).join('|')
      : '';

    const isSfMidWeekHealthyAdd = p => {
      if (shouldBlankEarlyWeek) return false;
      const refNote = pickMeaningfulInjuryComment(p.health.longComment, p.health.shortComment, p.health.irBeatNote);
      const priorAbs = derivePriorWeekAbsenceProfile({
        weeklyHistory: p.health.weeklyHistory2026 || [],
        currentWeek,
        byeWeek,
        beatNote: refNote
      });
      return isMidWeekHealthyAdditionRow({
        name: p.name,
        rosterBucket: p.rosterBucket || 'active',
        isIrReturnWindow: p.rosterBucket === 'ir' && Boolean(p.health.isPracticeWindowOpen),
        isPracticeWindowOpen: Boolean(p.health.isPracticeWindowOpen),
        isIrReturnQuestionable: Boolean(p.health.isIrReturnQuestionable),
        missedPriorGame: priorAbs.missedPriorGame,
        injuryType: p.health.injuryType || '',
        wed: p.health.wed || '-',
        thu: p.health.thu || '-',
        fri: p.health.fri || '-',
        playBadgeLabel: p.health.playBadgeLabel || ''
      });
    };

    const computePriorDayProb = p => {
      if (shouldBlankEarlyWeek) return null;
      const w = p.health.wed && p.health.wed !== '-' ? p.health.wed : '-';
      const t = p.health.thu && p.health.thu !== '-' ? p.health.thu : '-';
      const f = p.health.fri && p.health.fri !== '-' ? p.health.fri : '-';
      const filledCount = [w, t, f].filter(v => v !== '-').length;
      if (filledCount === 1 && isSfMidWeekHealthyAdd(p)) {
        return 99;
      }
      const isSingleDayPreReportReturn = filledCount === 1 && Boolean(p.health.hasPreReportPracticeReturn);
      if (filledCount < 2 && !isSingleDayPreReportReturn) return null;
      const prevW = w;
      const prevT = isSingleDayPreReportReturn ? t : f !== '-' ? t : '-';
      const prevF = '-';
      const hadPriorRestriction =
        /^(?:dnp|lp|limited|did not)/i.test(prevW) || /^(?:dnp|lp|limited|did not)/i.test(prevT);
      const rawSt = String(p.health.status || '');
      const priorStatus =
        p.rosterBucket === 'ir'
          ? rawSt || 'IR — 21-Day Window Open'
          : hadPriorRestriction && /^(?:active|no designation|cleared|out|doubtful)/i.test(rawSt)
            ? 'Questionable'
            : rawSt || 'Questionable';
      const refNote = pickMeaningfulInjuryComment(p.health.longComment, p.health.shortComment, p.health.irBeatNote);
      const priorAbs = derivePriorWeekAbsenceProfile({
        weeklyHistory: p.health.weeklyHistory2026 || [],
        currentWeek,
        byeWeek,
        beatNote: refNote
      });
      const priorCalc = computePlayerPlayProbability({
        name: p.name,
        position: p.position,
        experienceYears: p.experienceYears ?? null,
        snapPct: p.primarySnapPct ?? null,
        gameStatus: priorStatus,
        rosterBucket: p.rosterBucket || 'active',
        isPracticeWindowOpen: Boolean(p.health.isPracticeWindowOpen),
        isIrReturnQuestionable: Boolean(p.health.isIrReturnQuestionable),
        isSeasonEnding: Boolean(p.health.isSeasonEnding),
        sustainedInLastGame: Boolean(p.health.sustainedInLastGame),
        exitedPriorGameWithoutReturn: Boolean(p.health.exitedPriorGameWithoutReturn),
        missedPriorGame: priorAbs.missedPriorGame,
        consecutiveMissedGames: priorAbs.consecutiveMissedGames,
        priorWeekPracticed: priorAbs.priorWeekPracticed,
        fantasyStatusAbbr: p.health.fantasyStatusAbbr || '',
        injuryType: p.health.injuryType || '',
        wed: prevW,
        thu: prevT,
        fri: prevF,
        hasSideFieldRehab: Boolean(p.health.hasSideFieldRehab),
        beatNote: '',
        designatedDateIso: p.health.designatedDateIso || '',
        kickoffIso: upcomingKickoffIso,
        nowMs,
        schedule,
        seasonConcluded,
        weeklyHistory: p.health.weeklyHistory2026 || [],
        earliestEligibleWeek: p.health.earliestEligibleWeek ?? null,
        currentWeek,
        byeWeek,
        upcomingOppName,
        upcomingOppAbbr,
        blurbDateIso: p.health.blurbDateIso || null,
        lastCompletedGameKickoffMs,
        rosterPlayerNames
      });
      return Number.isFinite(priorCalc?.probabilityPct) ? priorCalc.probabilityPct : null;
    };

    appData.health.practiceReport = rosterPlayers
      .filter(p => p.health?.isOnPracticeReport)
      .sort(
        (a, b) =>
          (a.health.playProbabilityPct ?? 99) - (b.health.playProbabilityPct ?? 99) ||
          (b.capHit2026 || 0) - (a.capHit2026 || 0)
      )
      .map(p => {
        const wedVal = shouldBlankEarlyWeek ? '-' : p.health.wed || '-';
        const thuVal = shouldBlankEarlyWeek ? '-' : p.health.thu || '-';
        const friVal = shouldBlankEarlyWeek ? '-' : p.health.fri || '-';
        const filledSlots = [wedVal, thuVal, friVal].filter(v => v !== '-').length;
        return {
          playerId: p.id,
          name: p.name,
          position: p.position,
          jersey: p.jersey,
          headshotUrl: p.headshotUrl || '',
          rosterBucket: p.rosterBucket || 'active',
          isIrReturnWindow: p.rosterBucket === 'ir' && Boolean(p.health.isPracticeWindowOpen),
          sustainedInLastGame: Boolean(p.health.sustainedInLastGame),
          wed: wedVal,
          thu: thuVal,
          fri: friVal,
          injuryType:
            p.health.injuryType ||
            (p.health.wed === 'Vet Rest' ? 'NIR - Veteran Rest' : 'Cleared — No Designation'),
          gameStatus: p.health.status,
          playProbabilityPct: p.health.playProbabilityPct,
          priorDayPlayProbabilityPct: computePriorDayProb(p),
          hasPreReportPracticeReturnDelta: Boolean(!shouldBlankEarlyWeek && filledSlots === 1 && p.health.hasPreReportPracticeReturn),
          isMidWeekAdditionDelta: Boolean(filledSlots === 1 && isSfMidWeekHealthyAdd(p)),
          playBadgeLabel: p.health.playBadgeLabel,
          archetypeNote: p.health.archetypeNote || '',
          factors: p.health.factors || [],
          beatComment: pickMeaningfulInjuryComment(p.health.longComment, p.health.shortComment, p.health.irBeatNote)
        };
      });

    const nextReportSig = appData.health.practiceReport
      .map(r => `${r.playerId || r.name}:${r.playProbabilityPct}:${r.wed}:${r.thu}:${r.fri}:${r.injuryType}`)
      .join('|');
    if (nextReportSig !== prevReportSig) {
      mutated = true;
    }

    if (Array.isArray(appData.health.irAndReserveTracker)) {
      appData.health.irAndReserveTracker = rosterPlayers
        .filter(p => p.rosterBucket === 'ir' || p.rosterBucket === 'suspended')
        .map(p => ({
          playerId: p.id,
          name: p.name,
          position: p.position,
          jersey: p.jersey,
          headshotUrl: p.headshotUrl || '',
          injuryType: p.health.injuryType || 'Undisclosed',
          status: p.health.isIrReturnQuestionable
            ? 'IR — 21-Day Window Open (Questionable)'
            : p.health.status || 'Injured Reserve',
          isSeasonEnding: Boolean(p.health.isSeasonEnding),
          isPracticeWindowOpen: Boolean(p.health.isPracticeWindowOpen),
          isPracticeWindowExpected: Boolean(p.health.isPracticeWindowExpected),
          wed: shouldBlankEarlyWeek ? '-' : p.health.wed || '-',
          thu: shouldBlankEarlyWeek ? '-' : p.health.thu || '-',
          fri: shouldBlankEarlyWeek ? '-' : p.health.fri || '-',
          placedBeforeWeek: p.health.placedBeforeWeek ?? 1,
          earliestEligibleWeek: p.health.earliestEligibleWeek ?? null,
          projectedReturnWeek: p.health.projectedReturnWeek || 'TBD',
          byeWeekNote: p.health.byeWeekNote || '4-game NFL minimum requirement',
          playProbabilityPct: p.health.playProbabilityPct ?? 0,
          playBadgeLabel:
            p.health.playBadgeLabel ||
            (p.health.isSeasonEnding
              ? '0% • Out for Season'
              : p.rosterBucket === 'suspended'
                ? '0% • Suspended'
                : '0% • IR'),
          beatNote: pickMeaningfulInjuryComment(p.health.irBeatNote, p.health.longComment, p.health.shortComment)
        }))
        .sort((a, b) => sortIrTrackerPriority(a) - sortIrTrackerPriority(b) || a.name.localeCompare(b.name));
    }
  }

  // Synchronize Upcoming Opponent Injury Report, Practice Participation, Trending News & IR 21-Day Windows
  const oppHealth = appData?.scheduleMatchup?.upcomingMatchup?.opponentHealth;
  if (oppHealth && !oppHealth.gameDayRoster?.isActive) {
    const oppWirePool = [];
    const seenOppWireKeys = new Set();
    const oppWireSources = [
      ...(Array.isArray(appData._oppNewsWire) ? appData._oppNewsWire : []),
      ...(Array.isArray(appData.liveGameDay?.oppWireItems) ? appData.liveGameDay.oppWireItems : []),
      ...eligibleSignalRawStream
    ];
    for (const srcItem of oppWireSources) {
      if (!srcItem || srcItem.isClickbait || srcItem.type === 'video') continue;
      const pubMs = parseFlexibleIsoMs(srcItem.publishedAt);
      if (pubMs === null || pubMs < preScanFloorMs || pubMs > nowMs + 3_600_000) continue;
      const gk = String(srcItem.id || srcItem.url || srcItem.fullText || srcItem.title || srcItem.headline || '')
        .toLowerCase()
        .slice(0, 110);
      if (!gk || seenOppWireKeys.has(gk)) continue;
      seenOppWireKeys.add(gk);
      oppWirePool.push(srcItem);
    }

    const oppRosterPool = [];
    const seenOppPoolKeys = new Set();
    for (const candidate of [
      ...(Array.isArray(oppHealth.injuryReport) ? oppHealth.injuryReport : []),
      ...(Array.isArray(oppHealth.activeRoster) ? oppHealth.activeRoster : []),
      ...(Array.isArray(oppHealth.keyStartersHealthy) ? oppHealth.keyStartersHealthy : [])
    ]) {
      const k = canonicalInjuryPlayerKey(candidate?.name || '');
      if (!k || seenOppPoolKeys.has(k)) continue;
      seenOppPoolKeys.add(k);
      const rawId = String(
        candidate.id ||
          candidate.playerId ||
          (String(candidate.espnUrl || '').match(/\/id\/(\d+)/)?.[1] || '') ||
          k
      );
      oppRosterPool.push({
        id: rawId,
        name: candidate.name,
        position: candidate.position || 'ATH',
        health: { injuryType: candidate.injuryType || '' }
      });
    }
    const oppPlayerNames = oppRosterPool.map(p => p.name).filter(Boolean);
    const oppSharedSurnames = computeSharedRosterSurnames(oppRosterPool);

    const oppLivePracMap =
      oppWirePool.length > 0 && oppRosterPool.length > 0
        ? extractLivePracticeParticipationFromWire({
            newsItems: oppWirePool,
            rosterPlayers: oppRosterPool,
            kickoffIso: upcomingKickoffIso,
            lastCompletedGameEndMs,
            nowMs,
            seasonYear
          })
        : new Map();
    const oppPracByKey = new Map();
    for (const oppP of oppRosterPool) {
      const pr = oppLivePracMap.get(oppP.id);
      if (pr) oppPracByKey.set(canonicalInjuryPlayerKey(oppP.name), pr);
    }

    if (Array.isArray(oppHealth.injuryReport) && oppWirePool.length > 0) {
      const priorOppCompletedWk = currentWeek > 1 ? currentWeek - 1 : null;
      for (const oppRow of oppHealth.injuryReport) {
        if (!oppRow?.name || oppRow.rosterBucket === 'ir' || oppRow.isIrReturnWindow) continue;
        const rowKey = canonicalInjuryPlayerKey(oppRow.name);
        const oppPid = String(
          oppRow.id ||
            oppRow.playerId ||
            (String(oppRow.espnUrl || '').match(/\/id\/(\d+)/)?.[1] || '')
        );
        const wirePrac = oppPracByKey.get(rowKey) || null;
        let oppPracChanged = false;
        if (wirePrac) {
          if (!oppRow._slotPubMs || typeof oppRow._slotPubMs !== 'object') {
            oppRow._slotPubMs = { wed: 0, thu: 0, fri: 0 };
          }
          for (const slot of ['wed', 'thu', 'fri']) {
            const candVal = wirePrac[slot];
            const candMs = wirePrac.slotPubMs?.[slot] || 0;
            const prevMs = oppRow._slotPubMs[slot] || 0;
            const isOffProt = Boolean(oppRow._officialSlots?.[slot]) && oppRow[slot] && oppRow[slot] !== '-';
            if (
              candVal &&
              !isOffProt &&
              (!oppRow[slot] || oppRow[slot] === '-' || (candMs > 0 && candMs > prevMs && oppRow[slot] !== candVal))
            ) {
              oppRow[slot] = candVal;
              if (candMs > 0) oppRow._slotPubMs[slot] = candMs;
              oppPracChanged = true;
              mutated = true;
            }
          }
          if (
            wirePrac.injuryType &&
            (!oppRow.injuryType ||
              oppRow.injuryType === 'Undisclosed' ||
              (!isRestOrPersonalInjuryLabel(wirePrac.injuryType) && isRestOrPersonalInjuryLabel(oppRow.injuryType)))
          ) {
            oppRow.injuryType = wirePrac.injuryType;
            oppPracChanged = true;
            mutated = true;
          }
        }

        const oppNewsSig = evaluateCorroboratedNewsInjurySignal({
          playerName: oppRow.name,
          playerId: oppPid,
          rosterBucket: oppRow.isIrReturnQuestionable ? 'ir' : 'active',
          newsItems: oppWirePool,
          rosterPlayerNames: oppPlayerNames,
          sharedSurnames: oppSharedSurnames,
          nowMs,
          windowStartMs: lastCompletedGameEndMs,
          lastCompletedGameKickoffMs,
          lastCompletedWeek: priorOppCompletedWk,
          priorWeekInjuryType: oppRow.injuryType || ''
        });

        const bestOppNote = wirePrac?.latestNote || oppNewsSig.leadClause || '';
        if (bestOppNote && isBareStatusPlaceholderComment(oppRow.longComment)) {
          oppRow.longComment = bestOppNote;
          if (isBareStatusPlaceholderComment(oppRow.shortComment)) {
            oppRow.shortComment = bestOppNote;
          }
          mutated = true;
        }

        if (oppPracChanged || oppNewsSig.hasSignal) {
          const stClean =
            oppRow.gameStatus === 'No Designation (Cleared)'
              ? 'Active'
              : oppRow.gameStatus === 'IR Return Window (Q)'
                ? 'Questionable'
                : oppRow.gameStatus || 'Questionable';
          const isOppEarlyPre =
            (oppRow.wed === '-' || !oppRow.wed) &&
            (oppRow.thu === '-' || !oppRow.thu) &&
            (oppRow.fri === '-' || !oppRow.fri);
          const oppCombinedNote = pickMeaningfulInjuryComment(oppRow.longComment, oppRow.shortComment);
          const oppNoteForModel =
            isOppEarlyPre && stClean.toLowerCase() !== 'out'
              ? oppCombinedNote.replace(
                  /\b(is inactive|was inactive|officially inactive|ruled out|will not play|won't play|is out for|will miss (?:his |a )?[a-z0-9 -]*(?:game|contest|matchup|tilt|clash)|missing (?:a |his )?[a-z0-9 -]*(?:game|contest|matchup|tilt|clash)|miss(?:ing)? (?:sunday|monday|thursday|saturday)'?s?|inactive (?:sunday|monday|thursday|saturday)|inactive for (?:sunday|monday|thursday|saturday))\b/gi,
                  'sidelined previously'
                )
              : oppCombinedNote;

          const oppProb = computePlayerPlayProbability({
            name: oppRow.name,
            position: oppRow.position || 'ATH',
            snapPct: oppRow.snapPct ?? null,
            gameStatus: stClean,
            rosterBucket: oppRow.isIrReturnQuestionable ? 'ir' : 'active',
            isIrReturnQuestionable: Boolean(oppRow.isIrReturnQuestionable),
            injuryType: oppRow.injuryType || '',
            wed: oppRow.wed || '-',
            thu: oppRow.thu || '-',
            fri: oppRow.fri || '-',
            beatNote: oppNoteForModel,
            kickoffIso: upcomingKickoffIso,
            nowMs,
            blurbDateIso: oppRow.blurbDateIso || null,
            currentWeek,
            rosterPlayerNames: oppPlayerNames,
            corroboratedNewsSignal: oppNewsSig
          });

          if (
            oppNewsSig.signalType === 'RULED_OUT_WEEK' &&
            oppNewsSig.confidence >= 0.6 &&
            oppProb.probabilityPct === 0 &&
            oppRow.gameStatus !== 'Out'
          ) {
            oppRow.gameStatus = 'Out';
            mutated = true;
          }
          if (
            oppRow.playProbabilityPct !== oppProb.probabilityPct ||
            oppRow.playBadgeLabel !== oppProb.badgeLabel
          ) {
            mutated = true;
          }
          oppRow.playProbabilityPct = oppProb.probabilityPct;
          oppRow.playTier = oppProb.tier;
          oppRow.playBadgeLabel = oppProb.badgeLabel;
          oppRow.factors = oppProb.factors || [];
          oppRow.hasPreReportPracticeReturn = Boolean(oppProb.appliedPreReportPracticeReturn);
        }
      }

      // Promote newly injured/downgraded active opponent starters surfaced by corroborated insider/RotoWire news
      const existingOppReportKeys = new Set(oppHealth.injuryReport.map(r => canonicalInjuryPlayerKey(r?.name || '')));
      const oppActiveCandidates = [
        ...(Array.isArray(oppHealth.keyStartersHealthy) ? oppHealth.keyStartersHealthy : []),
        ...(Array.isArray(oppHealth.activeRoster) ? oppHealth.activeRoster : [])
      ];
      const promotedOppKeys = new Set();
      for (const cand of oppActiveCandidates) {
        const ck = canonicalInjuryPlayerKey(cand?.name || '');
        if (!ck || existingOppReportKeys.has(ck) || promotedOppKeys.has(ck)) continue;
        const candPid = String(cand.id || cand.playerId || (String(cand.espnUrl || '').match(/\/id\/(\d+)/)?.[1] || ''));
        const candSig = evaluateCorroboratedNewsInjurySignal({
          playerName: cand.name,
          playerId: candPid,
          rosterBucket: 'active',
          newsItems: oppWirePool,
          rosterPlayerNames: oppPlayerNames,
          sharedSurnames: oppSharedSurnames,
          nowMs,
          windowStartMs: lastCompletedGameEndMs,
          lastCompletedGameKickoffMs,
          lastCompletedWeek: priorOppCompletedWk
        });
        const shouldPromoteOpp =
          candSig.hasSignal &&
          candSig.confidence >= 0.48 &&
          (candSig.signalType === 'RULED_OUT_WEEK' ||
            candSig.signalType === 'UNLIKELY_THIS_WEEK' ||
            (candSig.signalType === 'TRENDING_DOWNWARD' && (candSig.hasLateSetback || Boolean(candSig.inferredInjuryType))) ||
            (candSig.signalType === 'SUSTAINED_IN_GAME_INJURY' && Boolean(candSig.inferredInjuryType)));
        if (!shouldPromoteOpp) continue;

        const wirePrac = oppPracByKey.get(ck) || null;
        const newSt =
          candSig.signalType === 'RULED_OUT_WEEK' && candSig.confidence >= 0.6
            ? 'Out'
            : candSig.isMultiWeekOrSurgery
              ? 'Doubtful'
              : 'Questionable';
        const newInj = wirePrac?.injuryType || candSig.inferredInjuryType || 'Undisclosed';
        const newWed = wirePrac?.wed || '-';
        const newThu = wirePrac?.thu || '-';
        const newFri = wirePrac?.fri || '-';
        const newProb = computePlayerPlayProbability({
          name: cand.name,
          position: cand.position || 'ATH',
          snapPct: cand.snapPct ?? null,
          gameStatus: newSt,
          rosterBucket: 'active',
          injuryType: newInj,
          wed: newWed,
          thu: newThu,
          fri: newFri,
          beatNote: candSig.leadClause || '',
          currentWeek,
          rosterPlayerNames: oppPlayerNames,
          corroboratedNewsSignal: candSig
        });
        oppHealth.injuryReport.push({
          id: candPid || undefined,
          name: cand.name,
          position: cand.position || 'ATH',
          unit: cand.unit || 'Active',
          jersey: cand.jersey ?? null,
          headshotUrl: cand.headshotUrl || '',
          espnUrl: cand.espnUrl || '',
          snapPct: cand.snapPct ?? null,
          wed: newWed,
          thu: newThu,
          fri: newFri,
          injuryType: newInj,
          gameStatus: newSt,
          shortComment: candSig.leadClause || '',
          longComment: candSig.leadClause || '',
          isStarter: cand.isStarter !== false,
          isIrReturnQuestionable: false,
          playProbabilityPct: newProb.probabilityPct,
          playTier: newProb.tier,
          playBadgeLabel: newProb.badgeLabel,
          factors: newProb.factors || [],
          archetypeNote: newProb.priorUsed?.archetypeNote || ''
        });
        promotedOppKeys.add(ck);
        existingOppReportKeys.add(ck);
        mutated = true;
      }
      if (promotedOppKeys.size > 0 && Array.isArray(oppHealth.keyStartersHealthy)) {
        oppHealth.keyStartersHealthy = oppHealth.keyStartersHealthy.filter(
          st => !promotedOppKeys.has(canonicalInjuryPlayerKey(st?.name || ''))
        );
      }
    }

    // Populate deterministic prior-day play probabilities on ALL opponent injury report rows
    // (even when oppWirePool is empty / offline) for parity with 49ers Health +/- % delta chips.
    if (Array.isArray(oppHealth.injuryReport)) {
      for (const oppRow of oppHealth.injuryReport) {
        if (!oppRow || !oppRow.name) continue;
        const filledOppSlots = [oppRow.wed, oppRow.thu, oppRow.fri].filter(
          v => v && v !== '-' && v !== '—'
        ).length;
        oppRow.priorDayPlayProbabilityPct = computeOpponentPriorDayPlayProbability(oppRow, {
          currentWeek,
          kickoffIso: upcomingKickoffIso,
          nowMs,
          rosterPlayerNames: oppPlayerNames
        });
        oppRow.hasPreReportPracticeReturnDelta = Boolean(
          filledOppSlots === 1 && oppRow.hasPreReportPracticeReturn
        );
        oppRow.isMidWeekAdditionDelta = Boolean(
          filledOppSlots === 1 && isMidWeekHealthyAdditionRow(oppRow)
        );
      }
    }

    if (Array.isArray(oppHealth.irReserve)) {
      for (const oppIr of oppHealth.irReserve) {
        if (!oppIr || oppIr.isSeasonEnding) continue;
        if (/\bnot\s+(?:yet\s+)?ready\s+to\s+return\s+to\s+practice\b/i.test(String(oppIr.beatNote || ''))) {
          if (oppIr.isPracticeWindowOpen) {
            oppIr.isPracticeWindowOpen = false;
            oppIr.status = 'Injured Reserve';
            if (/Activation Window/i.test(String(oppIr.projectedReturnWeek || ''))) {
              oppIr.projectedReturnWeek = 'TBD (21d Window Not Open)';
            }
            mutated = true;
          }
        }
        const oppIrSig =
          oppWirePool.length > 0
            ? evaluateCorroboratedNewsInjurySignal({
                playerName: oppIr.name,
                rosterBucket: 'ir',
                newsItems: oppWirePool,
                rosterPlayerNames: oppPlayerNames,
                sharedSurnames: oppSharedSurnames,
                nowMs,
                windowStartMs: lastCompletedGameEndMs,
                lastCompletedGameKickoffMs
              })
            : null;
        if (oppIrSig?.hasOfficialTxDesignation && !oppIr.isPracticeWindowOpen) {
          oppIr.isPracticeWindowOpen = true;
          oppIr.status = 'IR — 21-Day Window Open';
          oppIr.projectedReturnWeek = `Week ${currentWeek} Activation Window`;
          mutated = true;
        }
        if (oppIr.isPracticeWindowOpen || (oppIr.playProbabilityPct || 0) > 0) {
          const oppIrProb = computePlayerPlayProbability({
            name: oppIr.name,
            position: oppIr.position || 'ATH',
            snapPct: oppIr.snapPct ?? null,
            gameStatus: oppIr.status || 'Injured Reserve',
            rosterBucket: 'ir',
            isPracticeWindowOpen: Boolean(oppIr.isPracticeWindowOpen),
            isSeasonEnding: false,
            injuryType: oppIr.injuryType || '',
            wed: oppIr.wed || '-',
            thu: oppIr.thu || '-',
            fri: oppIr.fri || '-',
            beatNote: oppIr.beatNote || '',
            designatedDateIso: oppIr.designatedDateIso || '',
            kickoffIso: upcomingKickoffIso,
            nowMs,
            schedule,
            currentWeek,
            upcomingOppName: resolveTeamConfig(appData?.meta?.teamAbbr || getActiveTeamConfig()).fullName,
            upcomingOppAbbr: resolveTeamConfig(appData?.meta?.teamAbbr || getActiveTeamConfig()).abbr,
            lastCompletedGameKickoffMs,
            corroboratedNewsSignal: oppIrSig
          });
          if (
            oppIr.playProbabilityPct !== oppIrProb.probabilityPct ||
            oppIr.playBadgeLabel !== oppIrProb.badgeLabel
          ) {
            oppIr.playProbabilityPct = oppIrProb.probabilityPct;
            oppIr.playBadgeLabel = oppIrProb.badgeLabel;
            mutated = true;
          }
          if (Array.isArray(oppHealth.injuryReport)) {
            const oppIrKey = canonicalInjuryPlayerKey(oppIr.name);
            const existingIdx = oppHealth.injuryReport.findIndex(
              r => canonicalInjuryPlayerKey(r?.name) === oppIrKey
            );
            if (oppIr.isPracticeWindowOpen && oppIrProb.probabilityPct > 0) {
              const irInjRow = {
                ...(existingIdx >= 0 ? oppHealth.injuryReport[existingIdx] : {}),
                name: oppIr.name,
                position: oppIr.position || 'ATH',
                jersey: oppIr.jersey ?? null,
                headshotUrl: oppIr.headshotUrl || '',
                espnUrl: oppIr.espnUrl || '',
                snapPct: oppIr.snapPct ?? null,
                rosterBucket: 'ir',
                isPracticeWindowOpen: true,
                isIrReturnWindow: true,
                isIrReturnQuestionable: true,
                wed: oppIr.wed || '-',
                thu: oppIr.thu || '-',
                fri: oppIr.fri || '-',
                injuryType: oppIr.injuryType || 'Injured Reserve',
                gameStatus: oppIr.status || 'IR — 21-Day Window Open',
                shortComment: oppIr.beatNote || '',
                longComment: oppIr.beatNote || '',
                playProbabilityPct: oppIrProb.probabilityPct,
                playTier: oppIrProb.tier,
                playBadgeLabel: oppIrProb.badgeLabel,
                factors: oppIrProb.factors || []
              };
              if (existingIdx >= 0) {
                oppHealth.injuryReport[existingIdx] = irInjRow;
              } else {
                oppHealth.injuryReport.push(irInjRow);
                mutated = true;
              }
            } else if (
              existingIdx >= 0 &&
              (oppHealth.injuryReport[existingIdx]?.rosterBucket === 'ir' ||
                oppHealth.injuryReport[existingIdx]?.isIrReturnWindow ||
                oppHealth.injuryReport[existingIdx]?.isPracticeWindowOpen)
            ) {
              oppHealth.injuryReport.splice(existingIdx, 1);
              mutated = true;
            }
          }
        }
      }
    }
    if (Array.isArray(oppHealth.injuryReport)) {
      oppHealth.injuryReport.sort((a, b) => (a.playProbabilityPct ?? 99) - (b.playProbabilityPct ?? 99));
    }
    if (oppHealth.summary) {
      oppHealth.summary = computeTeamHealthSummary({
        injuryReport: oppHealth.injuryReport || [],
        irReserve: oppHealth.irReserve || [],
        totalStarters: oppHealth.summary.totalStarters || 22
      });
    }
  }

  // Keep Projected Active Depth Chart synchronized with updated play probabilities
  if (Array.isArray(appData?.depthChart?.units)) {
    const byId = new Map(rosterPlayers.map(p => [String(p.id), p]));
    for (const unit of appData.depthChart.units) {
      for (const row of unit.rows || []) {
        if (!Array.isArray(row.baselineChain)) continue;
        row.baselineChain = row.baselineChain.map(entry => {
          const rp = byId.get(String(entry.playerId));
          if (!rp?.health) return entry;
          const prob = rp.health.playProbabilityPct ?? entry.playProbabilityPct ?? 95;
          const isAvailable =
            prob >= 40 &&
            (rp.rosterBucket === 'active' ||
              Boolean(rp.health.isIrReturnQuestionable) ||
              Boolean(rp.health.isPracticeWindowOpen));
          return {
            ...entry,
            playProbabilityPct: prob,
            statusBadge: rp.health.playBadgeLabel || entry.statusBadge,
            isAvailable
          };
        });
        row.projectedActiveChain = [
          ...row.baselineChain.filter(x => x.isAvailable).map(({ demotedDueToInjury: _d, ...rest }) => rest),
          ...row.baselineChain.filter(x => !x.isAvailable).map(x => ({ ...x, demotedDueToInjury: true }))
        ];
        row.starterPromoted =
          row.baselineChain.length > 1 &&
          row.projectedActiveChain[0]?.playerId !== row.baselineChain[0]?.playerId;
      }
    }
  }

  return mutated;
}

const SPECIAL_TEAMS_ONLY_POSITIONS = new Set(['PK', 'K', 'P', 'LS', 'H', 'KR', 'PR']);

/**
 * Canonical predicate determining whether an active/injured player counts among a club's
 * 22 offensive & defensive starters (shared between scorecard summary math and table row tags).
 */
export function isEffectiveOffDefStarter(player = {}) {
  if (!player || typeof player !== 'object') return false;
  const pos = String(player.position || '').trim().toUpperCase();
  const unit = String(player.unit || '').trim().toLowerCase();
  if (SPECIAL_TEAMS_ONLY_POSITIONS.has(pos) || unit === 'special teams') {
    return false;
  }

  const snap = Number.isFinite(Number(player.snapPct)) && player.snapPct !== null ? Number(player.snapPct) : null;
  if (player.isStarter === true) {
    // Guard against return specialists (e.g. KR1/PR1 WR4 with <35% offensive snaps) being tagged starter via ST depth chart
    if (snap !== null && snap > 0 && snap < 35 && ['WR', 'RB', 'CB', 'DB', 'S'].includes(pos)) {
      return false;
    }
    return true;
  }

  if (snap !== null && snap >= 58) return true;
  if (/\b(?:starter|pro bowl|all-pro|wr1|wr2|qb1|rb1|te1|cb1|lt|rt)\b/i.test(String(player.archetypeNote || ''))) {
    return true;
  }
  return false;
}

/**
 * Selects up to 11 Offensive + 11 Defensive = 22 true starters from an ESPN depth chart payload,
 * excluding Special Teams returners/specialists and resolving 12th-personnel ties (e.g. FB vs WR3, NT vs NB) by snap share.
 */
export function select22OffDefStartersFromDepthChart(depthChartArr = [], getSnapPctByNormKey = null, normFn = null) {
  const norm =
    typeof normFn === 'function'
      ? normFn
      : s =>
          String(s || '')
            .toLowerCase()
            .replace(/\b(?:jr\.?|sr\.?|ii|iii|iv|v)\b/g, '')
            .replace(/[^a-z0-9]/g, '')
            .trim();

  const offSlotPriority = ['qb', 'rb', 'wr1', 'wr2', 'te', 'lt', 'lg', 'c', 'rg', 'rt', 'wr3', 'fb', 'dh'];
  const defSlotPriority = ['lde', 'rde', 'ldt', 'rdt', 'wlb', 'mlb', 'lilb', 'rilb', 'lcb', 'rcb', 'ss', 'fs', 'nb', 'slb', 'nt', 'db'];

  const offCandidates = new Map();
  const defCandidates = new Map();

  for (const dc of depthChartArr || []) {
    const dcNameLower = String(dc?.name || '').toLowerCase();
    if (dcNameLower.includes('special')) continue;
    const positions = dc?.positions || {};

    for (const [slotKeyRaw, posObj] of Object.entries(positions)) {
      const slotKey = String(slotKeyRaw || '').toLowerCase().trim();
      if (/^(?:pk|k|p|ls|h|pr|kr)\b/.test(slotKey)) continue;
      const starterName = posObj?.athletes?.[0]?.displayName || posObj?.athletes?.[0]?.fullName || '';
      const nk = norm(starterName);
      if (!nk) continue;

      const snapPct = typeof getSnapPctByNormKey === 'function' ? getSnapPctByNormKey(nk) : null;
      const isDef =
        dcNameLower.includes('def') ||
        /^(?:l|r)?(?:de|dt|nt|lb|ilb|olb|wlb|mlb|slb|cb|ss|fs|nb|db)$/i.test(slotKey);

      if (isDef) {
        const prio = defSlotPriority.indexOf(slotKey);
        const prev = defCandidates.get(nk);
        const rankOrder = prio === -1 ? 99 : prio;
        if (!prev || rankOrder < prev.rankOrder) {
          defCandidates.set(nk, { nk, slotKey, snapPct, rankOrder });
        }
      } else {
        const prio = offSlotPriority.indexOf(slotKey);
        const prev = offCandidates.get(nk);
        const rankOrder = prio === -1 ? 99 : prio;
        if (!prev || rankOrder < prev.rankOrder) {
          offCandidates.set(nk, { nk, slotKey, snapPct, rankOrder });
        }
      }
    }
  }

  const pickTop11 = (candMap, coreLimit = 10) => {
    const all = [...candMap.values()].sort((a, b) => a.rankOrder - b.rankOrder);
    if (all.length <= 11) return new Set(all.map(x => x.nk));
    const locked = all.slice(0, coreLimit);
    const flex = all
      .slice(coreLimit)
      .sort((a, b) => (b.snapPct ?? -1) - (a.snapPct ?? -1) || a.rankOrder - b.rankOrder)
      .slice(0, 11 - locked.length);
    return new Set([...locked, ...flex].map(x => x.nk));
  };

  const offStarterNames = pickTop11(offCandidates, 10);
  const defStarterNames = pickTop11(defCandidates, 9);
  const allStarterNames = new Set([...offStarterNames, ...defStarterNames]);
  return {
    allStarterNames,
    offStarterNames,
    defStarterNames
  };
}

/**
 * Deterministically computes the 4-card Team Health Scorecard summary from live injury & IR lists
 * so Availability Index, Starters Cleared (X/22), Questionable/Doubtful, and Ruled Out/IR are 100% consistent
 * across build-time data generation, live client ESPN overlays, and Game-Day [T-90m, Final) windows.
 */
export function computeTeamHealthSummary({
  injuryReport = [],
  irReserve = [],
  totalStarters = 22
} = {}) {
  const safeTotalStarters = Math.max(22, Number(totalStarters) || 22);
  const reportList = Array.isArray(injuryReport) ? injuryReport : [];
  const irList = Array.isArray(irReserve) ? irReserve : [];

  let ruledOutCount = 0;
  let doubtfulCount = 0;
  let longShotCount = 0;
  let doubtfulOrLongShotCount = 0;
  let gtdCount = 0;
  let clearedCount = 0;

  let startersOutCount = 0;
  let startersDoubtfulOnlyCount = 0;
  let startersLongShotCount = 0;
  let startersDoubtfulCount = 0;
  let startersQuestionableCount = 0;

  let starterAbsencePenalty = 0;
  let rotationAbsencePenalty = 0;

  const seenNames = new Set();
  for (const row of reportList) {
    const key = String(row?.name || '')
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '');
    if (key && seenNames.has(key)) continue;
    if (key) seenNames.add(key);

    const prob = Number.isFinite(Number(row?.playProbabilityPct)) ? Number(row.playProbabilityPct) : 50;
    const statusStr = String(row?.gameStatus || '').trim();
    const tierStr = String(row?.playTier || row?.tier || '').toUpperCase();
    const isHealthyScratchRow =
      Boolean(row?.isHealthyScratch) ||
      tierStr === 'HEALTHY_SCRATCH' ||
      /\b(?:healthy\s+scratch|coach'?s?\s+decision)\b/i.test(statusStr);
    if (isHealthyScratchRow) {
      continue;
    }
    const isIrWindowRow =
      row?.rosterBucket === 'ir' ||
      Boolean(row?.isIrReturnWindow) ||
      Boolean(row?.isIrReturnQuestionable) ||
      /\b(?:ir\b|injured\s+reserve|21-day\s+window|ir\s+return\s+window)\b/i.test(statusStr);
    const isStarter = !isIrWindowRow && isEffectiveOffDefStarter(row);

    const isCleared =
      /^(?:active|in\b|no designation|cleared)/i.test(statusStr) ||
      (prob >= 85 && !/^(?:out|inactive|doubtful|ir)/i.test(statusStr));
    const isOut = !isCleared && (prob === 0 || /^(?:out|inactive)\b/i.test(statusStr));
    const isDoubtfulOnly = !isCleared && !isOut && prob < 20;
    const isLongShot = !isCleared && !isOut && !isDoubtfulOnly && prob < 50;
    const isGtd = !isCleared && !isOut && !isDoubtfulOnly && !isLongShot;

    if (isCleared) {
      clearedCount += 1;
    } else if (isOut) {
      ruledOutCount += 1;
      if (isStarter) startersOutCount += 1;
    } else if (isDoubtfulOnly) {
      doubtfulCount += 1;
      doubtfulOrLongShotCount += 1;
      if (isStarter) {
        startersDoubtfulOnlyCount += 1;
        startersDoubtfulCount += 1;
      }
    } else if (isLongShot) {
      longShotCount += 1;
      doubtfulOrLongShotCount += 1;
      if (isStarter) {
        startersLongShotCount += 1;
        startersDoubtfulCount += 1;
      }
    } else if (isGtd) {
      gtdCount += 1;
      if (isStarter) startersQuestionableCount += 1;
    }

    if (!isCleared) {
      const missProb = Math.max(0, Math.min(1, (100 - prob) / 100));
      if (isStarter) {
        starterAbsencePenalty += missProb * 4.4;
      } else {
        const snapWeight = Number(row?.snapPct || 0) >= 30 ? 1.35 : 0.85;
        rotationAbsencePenalty += missProb * snapWeight;
      }
    }
  }

  const startersUnresolvedCount = startersOutCount + startersDoubtfulCount + startersQuestionableCount;
  const activeStartersHealthy = Math.max(
    0,
    safeTotalStarters - Math.min(safeTotalStarters, startersUnresolvedCount)
  );
  const questionableOrDoubtfulCount = doubtfulOrLongShotCount + gtdCount;

  const irCount = irList.length;
  const irOpenWindowCount = irList.filter(ir => Boolean(ir?.isPracticeWindowOpen)).length;
  const irSeasonEndingCount = irList.filter(ir => Boolean(ir?.isSeasonEnding)).length;

  let rawIrPenalty = 0;
  for (const ir of irList) {
    const irKey = String(ir?.name || '')
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '');
    if (irKey && seenNames.has(irKey)) continue;
    const snap = Number(ir?.snapPct || 0);
    if (snap >= 50) rawIrPenalty += 3.2;
    else if (snap >= 25) rawIrPenalty += 1.7;
    else rawIrPenalty += 0.65;
  }
  const irPenalty = Math.min(14, rawIrPenalty);

  const totalAttrition = starterAbsencePenalty + rotationAbsencePenalty + irPenalty;
  const overallAvailabilityScore =
    totalAttrition <= 0.2
      ? 100
      : Math.max(50, Math.min(99, Math.round(100 - totalAttrition)));

  return {
    overallAvailabilityScore,
    activeStartersHealthy,
    totalStarters: safeTotalStarters,
    startersOutCount,
    startersDoubtfulOnlyCount,
    startersLongShotCount,
    startersDoubtfulCount,
    startersQuestionableCount,
    startersGtdCount: startersQuestionableCount,
    startersUnresolvedCount,
    ruledOutCount,
    doubtfulCount,
    longShotCount,
    doubtfulOrLongShotCount,
    gtdCount,
    questionableOrDoubtfulCount,
    clearedCount,
    irCount,
    irOpenWindowCount,
    irSeasonEndingCount
  };
}

/**
 * Returns true if a health object or practice-report row represents a non-injury Veteran Rest / NIR day
 * rather than an actual medical injury.
 */
export function isPureVeteranRestEntry(healthOrRow = {}) {
  if (!healthOrRow || typeof healthOrRow !== 'object') return false;
  const inj = String(healthOrRow.injuryType || '').trim().toLowerCase();
  const st = String(healthOrRow.gameStatus || healthOrRow.status || '').trim().toLowerCase();
  if (/coach'?s decision|personal/i.test(inj)) {
    return true;
  }
  const hasRestrictiveStatus = st === 'questionable' || st === 'doubtful' || st === 'out';
  const hasMidOrLateWeekLp =
    healthOrRow.thu === 'LP' || healthOrRow.fri === 'LP' || (healthOrRow.thu === 'LP' && healthOrRow.fri === 'DNP');
  if (hasRestrictiveStatus || hasMidOrLateWeekLp) {
    return false;
  }
  if (/not injury related|nir\s*-?\s*(?:veteran\s*)?rest|^rest$|^veteran rest$/i.test(inj)) {
    return true;
  }
  if (!inj && healthOrRow.wed === 'Vet Rest') {
    return true;
  }
  return false;
}

/**
 * Determines whether a player qualifies for the "Injury News" card under `Health`:
 *  1. Any active-roster (or IR-return Questionable) player who is genuinely injured / on the weekly Injury Report
 *     (excluding healthy `NIR - Rest` maintenance days), OR
 *  2. Any player on IR / PUP predicted to return within the next 2–3 weeks (`isPracticeWindowOpen`,
 *     `isPracticeWindowExpected`, or `projectedReturnWeek` within `currentWeek .. currentWeek + 3`).
 */
export function isPlayerEligibleForInjuryNews(player = null, { currentWeek = 1, byeWeek = 8 } = {}) {
  if (!player || typeof player !== 'object') return false;
  const h = player.health || {};
  if (isPureVeteranRestEntry(h)) return false;

  const bucket = String(player.rosterBucket || 'active').toLowerCase();
  const stLower = String(h.status || h.gameStatus || '').trim().toLowerCase();
  const injClean = String(h.injuryType || '').trim();
  const curWk = Math.max(1, Number(currentWeek) || 1);
  const byeWk = Number(byeWeek) || 8;

  // Exclude non-injury reserve lists (Suspended, Left Squad, pure Roster Exemption)
  if (
    bucket === 'suspended' ||
    stLower.includes('suspended') ||
    stLower.includes('left squad') ||
    stLower.includes('roster exemption')
  ) {
    return false;
  }

  // IR / Reserve-PUP return horizon check (must NOT be season-ending, must project within next 2–3 weeks)
  if (bucket === 'ir' || stLower.includes('injured reserve') || stLower === 'ir' || stLower.includes('reserve / pup')) {
    if (h.isSeasonEnding || /out for (?:the )?season|season-ending/i.test(stLower)) {
      return false;
    }
    if (h.isPracticeWindowOpen || h.isPracticeWindowExpected || h.isIrReturnQuestionable) {
      return true;
    }
    const projStr = String(h.projectedReturnWeek || '').trim();
    const wkMatch = projStr.match(/Week\s*(\d{1,2})/i);
    if (wkMatch) {
      const targetWk = Number(wkMatch[1]);
      if (Number.isFinite(targetWk) && targetWk >= curWk) {
        const byeBetween = byeWk > curWk && byeWk < targetWk ? 1 : 0;
        const gameWeeksAway = targetWk - curWk - byeBetween;
        if (targetWk - curWk <= 3 || gameWeeksAway <= 3) {
          return true;
        }
      }
    }
    return false;
  }

  if (/healthy scratch|coach'?s decision/i.test(injClean)) {
    return false;
  }

  if (Boolean(h.isInGameInjury || h.isInGameReturned)) {
    return true;
  }

  // Active / Practice Squad player: eligible when genuinely injured or listed on weekly injury report
  if (Boolean(h.isOnPracticeReport)) {
    return (
      Boolean(injClean && !/^cleared\s*[—-]\s*no designation$/i.test(injClean)) ||
      stLower.startsWith('out') ||
      stLower.startsWith('doubtful') ||
      stLower.startsWith('questionable')
    );
  }
  if (
    stLower.startsWith('out') ||
    stLower.startsWith('doubtful') ||
    stLower.startsWith('questionable') ||
    stLower === 'inactive'
  ) {
    return true;
  }
  if (injClean && !/^(?:none|healthy|active|cleared\s*[—-]\s*no designation)$/i.test(injClean)) {
    return true;
  }
  return false;
}

const NON_MEDICAL_FOOTBALL_IDIOM_STRIP_RE =
  /\b(?:injury[- ](?:plagued|riddled|depleted|decimated|ravaged|hit|marred)|massive\s+injury\s+wave|injury\s+(?:wave|bug|front|luck|crisis|woes)|despite\s+(?:a\s+(?:carousel|rash|string|wave)\s+of\s+[^.!?]{0,45})?\binjur(?:y|ies)\b|(?:carousel|group|corps|room)\s+of\s+(?:receivers|wideouts|linemen|corners|backs)[^.!?]{0,45}\binjur\w*|without\s+(?:any\s+|another\s+)?(?:massive\s+)?injur\w*|keep\s+(?:them|him|her|players|veterans|starters|everyone)\s+healthy|(?:get|stay|remain|getting|staying|keeping)\s+healthy|emerged\s+relatively\s+healthy|seemed\s+like\s+he\s+was\s+hurt[\s\S]{0,75}assuming\s+not|discuss\s+[^.!?]{0,45}\binjuries\b|had\s+the\s+same\s+injury\s+last\s+(?:season|year)|leaned\s+his\s+(?:left\s+|right\s+)?shoulder\s+into|over\s+his\s+(?:left\s+|right\s+)?shoulder|chip\s+on\s+his\s+shoulder|took\s+a\s+knee|taking\s+a\s+knee|on\s+one\s+knee|fumble\s+recover\w*|recover\s+an\s+onside\s+kick|clear(?:ed|s|ing)?\s+the\s+(?:path|pocket|lane|way)|elevat(?:e|ed|ing)\s+his\s+(?:game|play))\b/gi;

const INJURY_NEWS_TOPIC_RELEVANCE_RE =
  /(?:\(\s*(?:back|lower\s+back|upper\s+back|lower[- ]leg|upper[- ]leg|right\s+leg|left\s+leg|leg|fibula|tibia|shin|foot|hip|neck|hand|knee|ankle|shoulder|rib|ribs|calf|quad|quadriceps|groin|adductor|wrist|thumb|elbow|toe|pectoral|pec|oblique|collarbone|clavicle|concussion|illness)\s*\)|\b(?:injur(?:y|ed|ies)|(?:limited|full|non-?|did\s+not|didn['’]?t|no|missed|missing|return(?:ed|ing)?\s+to|back\s+(?:at|in|to|on\s+the)|at\s+today['’]?s|in\s+(?:wednesday|thursday|friday|today)['’]?s)\s*(?:practice[d]?|practicing|participant|participation|session|walk-?through)|participat(?:e|ed|ing|ion)\s+in\s+(?:[\w' -]{0,18}\s+)?practice|walk-?through\s+but\s+not\s+practice|practice\s+(?:report|window|status|participation)|not\s+participating|full\s+go|(?:good|ready)\s+to\s+(?:go|play)|expected\s+to\s+(?:play|suit\s+up|miss|be\s+activated)|on\s+track\s+to\s+(?:play|suit\s+up|be\s+activated)|plan(?:s|ning)?\s+to\s+play|set\s+to\s+play|game-time\s+decision|no\s+(?:official\s+)?injury\s+designation|without\s+an?\s+(?:official\s+)?(?:injury\s+)?designation|side\s*lines?\s+with\s+trainers|spotted\s+(?:running|sprinting|working|jogging|cutting|throwing)|side\s+field|rehab\s+field|rehab(?:bing)?|working\s+with\s+trainers|walked\s+off\s+with\s+trainers|examined\s+by\s+trainers|(?:trainers|medical\s+staff)\s+(?:are\s+)?(?:out|rushing|attending|tending|checking|looking\s+at|examining|surrounding|working\s+on)|being\s+tended\s+to|tended\s+to\s+by\s+trainers|medical\s+attention|non-contact|walking\s+boot|air\s*cast|in\s+a\s+cast|cast\s+on\s+his|crutches|splint\b|immobiliz\w*|towel\s+over\s+his\s+head|brace|observer|(?:headed|going|went|walked|limped|helped|carted|taken|escorted)\s+(?:off\s+)?(?:to\s+the\s+locker\s+room|(?:into|to|down)\s+the\s+tunnel)|carted(?:\s+(?:off|away|to|from|into|down|back))?|(?:onto|on|into)\s+(?:a|the)\s+(?:medical\s+)?cart|loaded\s+onto\s+(?:a|the)\s+(?:medical\s+)?cart|cart\s+(?:is\s+)?(?:coming|comes|came|rolling|rolled|heading|headed)?\s*out|(?:bringing|brought|bring|calling|called|motion(?:ed|ing)?|wav(?:ed|ing)?)\s+(?:out\s+the\s+|for\s+the\s+)cart|medical\s+cart|medical\s+tent|blue\s+tent|being\s+evaluated|evaluated\s+for|being\s+checked|(?:down|staying\s+down|remained\s+down|still\s+down)\s+on\s+(?:the\s+)?(?:field|turf|grass)|went\s+down\s+(?:hard|clutching|grabbing|holding|with|on\s+the\s+play|after\s+getting\s+rolled)|rolled\s+up\s+on|(?:grabbing|clutching)\s+(?:at\s+)?his\s+(?:right\s+|left\s+|lower\s+|upper\s+)?(?:leg|ankle|knee|foot|shoulder|arm|wrist|hand|hip|back|rib|ribs)|in\s+(?:a\s+lot\s+of\s+|visible\s+|significant\s+)?pain|gruesome\s+(?:[a-z-]+\s+)?injur\w*|season-ending|\bmri\b|x-rays?|ct\s+scan|surgery|surgical|(?:passed|failed)\s+(?:his|a|the)\s+physical|concussion|protocol|hamstring|achilles|tendinitis|ankle|high-ankle|meniscus|\bmcl\b|\bpcl\b|\bacl\b|turf\s+toe|lower[- ]leg\b|upper[- ]leg\b|(?:right\s+|left\s+)?leg\s+(?:injur\w*|fracture|break|cast|splint|brace|wrap|issue|pain|soreness|strain|rolled|trapped|deformed)|fibula|tibia|shin\b|collarbone|clavicle|broken\s+(?:leg|ankle|foot|arm|collarbone|rib|ribs|wrist|hand|thumb|finger|bone|fibula|tibia)|(?:lower\s+|upper\s+)?back\s+(?:injur\w*|spasms?|tightness|issue|pain|strain)|left\s+with\s+(?:his|a|an|the(?:\s+same)?)\s+(?:lower\s+|upper\s+)?back|foot\s+(?:injur\w*|sprain|fracture|issue|pain)|battled\s+a\s+bad\s+(?:foot|ankle|knee|leg|back|shoulder|hamstring|hip|hand|wrist)|fresh\s+off\s+a\s+(?:hamstring|ankle|knee|leg|groin|calf|shoulder|back|foot|concussion)|(?:were|was|is|been|still|playing|already|got)\s+hurt\b|hurt\s+(?:his|your)\s+(?:shoulder|back|ankle|knee|leg|foot|hamstring|groin|calf|hand|wrist|neck|hip|elbow|rib|ribs)|shoulder\s+(?:injur\w*|sprain|strain|harness|brace|surgery|issue|soreness)|knee\s+(?:injur\w*|sprain|brace|surgery|swelling|soreness|issue)|groin|adductor|calf|quadriceps|quad\s+(?:injur\w*|strain|contusion|issue)|hip\s+(?:injur\w*|pointer|flexor|issue|strain)|oblique|pectoral|ribs?\s+(?:injur\w*|fracture|cartilage|issue)|wrist\s+(?:injur\w*|sprain|fracture|cast|brace|issue)|hand\s+(?:injur\w*|fracture|surgery|cast)|thumb\s+(?:injur\w*|sprain|fracture|surgery)|neck\s+(?:injur\w*|stinger|spasms?|issue)|elbow\s+(?:injur\w*|sprain|brace|issue)|illness|sprain\w*|strain\w*|tear|torn|fracture[d]?|dislocated|day[-\s]+to[-\s]+day|week[-\s]+to[-\s]+week|questionable|doubtful|ruled\s+out|downgraded\s+to\s+out|out\s+for\s+(?:the\s+(?:rest|remainder|game|night|day|season|year)|tonight|today)|done\s+for\s+(?:the\s+)?(?:game|night|day|season|year)|(?:left|exited)\s+(?:the|tonight['’]?s|sunday['’]?s|monday['’]?s|thursday['’]?s|saturday['’]?s|today['’]?s)\s+(?:game|contest|matchup)|inactives?|injured\s+reserve|\bir\b|\bpup\b|21-day|designated\s+(?:for|to)\s+return|activated\s+from|setback|aggravat\w*|fully\s+heals?\b|heal(?:ing|ed)\b|act(?:ing)?\s+up\s+again|recovery\s+(?:is\s+progressing|from|timeline|process)|['’]s\s+recovery\b|recuperat\w*|return(?:ed|ing)?\s+(?:from\s+(?:an?\s+|his\s+)?(?:injur\w*|ir\b|achilles|hamstring|ankle|knee|leg)|to\s+(?:action|the\s+field|(?:the\s+|sunday['’]?s\s+|monday['’]?s\s+|thursday['’]?s\s+|saturday['’]?s\s+)?game))|unable\s+to\s+finish\s+(?:[\w' -]{0,16}\s+)?game|did(?:n['’]?t|\s+not)\s+return|will\s+not\s+return|won['’]?t\s+return|shaken\s+up|limped\s+off|limping\s+off|helped\s+off|sidelined|capped\s+session)\b)/i;

function sanitizeTextForPlayerHealthCheck(text = '') {
  return String(text || '').replace(NON_MEDICAL_FOOTBALL_IDIOM_STRIP_RE, ' ');
}

const INJURY_REHAB_COLOR_DETAIL_RE =
  /\b(spotted\s+(?:running|sprinting|jogging|working|cutting|throwing|catching)|on\s+the\s+(?:side\s*lines?|side\s+field|rehab\s+field)|working\s+(?:on\s+(?:a|the)\s+(?:side|rehab)\s+field|with\s+trainers)|running\s+(?:on\s+the\s+side|routes|sprints)|cutting|individual\s+drills|indy\s+drills|team\s+drills|7-on-7|11-on-11|in\s+cleats|in\s+pads|with\s+a\s+helmet|without\s+a\s+(?:brace|boot|limp)|walking\s+boot|blue\s+non-contact|non-contact\s+jersey|was\s+an\s+observer|moving\s+well|full\s+speed|capped\s+session|for\s+the\s+first\s+time\s+since|making\s+solid\s+progress)\b/i;

const INJURY_CONTRASTIVE_COLOR_RE =
  /\b(?:(?:didn't|did\s+not|not)\s+practic(?:e|ing)[^.;]{0,35}\b(?:but|though|although|however)\b|\b(?:but|though|although)\s+(?:was\s+)?(?:spotted|seen|working|running|sprinting)|that\s+explains\s+why|considering\s+he\s+logged)\b/i;

const INJURY_MEDICAL_DIAGNOSTIC_OR_QUOTE_RE =
  /\b(\bmri\b|x-rays?|ct\s+scan|surgery|meniscus|high-ankle|concussion\s+protocol|(?:head\s+coach|coach\s+[a-z'.-]+|[a-z'.-]{4,})\s+(?:said|noted|revealed|relayed|confirmed|indicated|announced|provided)|(?:left|unable\s+to\s+finish[\s\S]{0,18})\s+(?:with|w\/)\s*(?:a|an|his|the\s+same)\s+[a-z-]+\s+injury|said\s+(?:monday|wednesday|thursday|friday|after)|day[-\s]+to[-\s]+day|week[-\s]+to[-\s]+week|21-day\s+practice\s+window|opened\s+(?:the\s+|his\s+|[a-z']+s?\s+)?(?:21-day\s+|injured\s+reserve\s+|ir\s+)?practice\s+window|designated\b[^.;]{0,55}\bto\s+return|not\s+expecting\b[^.;]{0,45}\bthis\s+week)\b/i;

const INJURY_STATUS_MILESTONE_RE =
  /\b(opened\s+(?:the\s+|his\s+|[a-z']+s?\s+)?(?:21-day\s+|injured\s+reserve\s+|ir\s+)?practice\s+window|designated\b[^.;]{0,55}\bto\s+return|activated\s+from|placed\s+on\s+(?:injured\s+reserve|ir\b)|back\s+on\s+the\s+practice\s+field|returned\s+to\s+(?:on-field\s+)?practice|cleared\s+(?:the\s+)?concussion\s+protocol|suffered\s+a\s+setback|aggravated|ruled\s+out|downgraded\s+to\s+out|out\s+for\s+(?:the\s+(?:rest|remainder|game|night|day|season|year)|tonight|today)|done\s+for\s+(?:the\s+)?(?:game|night|day|season|year)|questionable\s+to\s+return|doubtful\s+to\s+return|will\s+not\s+return|won['’]?t\s+return|air\s*cast|carted(?:\s+(?:off|away|to|from|into|down|back))?|(?:onto|on|into)\s+(?:a|the)\s+(?:medical\s+)?cart|cart\s+(?:is\s+)?(?:coming\s+)?out|locker\s+room|tunnel|blue\s+(?:medical\s+)?tent|medical\s+tent|returned\s+to\s+(?:the\s+|tonight['’]?s\s+)?(?:game|action)|cleared\s+to\s+return)\b/i;

const PLAYER_LONG_TERM_OR_IR_TIMELINE_RE =
  /\b(injured\s+reserve|\bir\b|21-day|practice\s+window|designate[sd]?\s+[\s\S]{0,28}return|season-ending|out\s+for\s+(?:the\s+)?(?:rest\s+of\s+(?:the\s+)?)?(?:\d{4}\s+)?season|done\s+for\s+the\s+(?:season|year)|air\s*cast|fibula|tibia|surgery|surgical|torn\s+(?:acl|achilles|pectoral|meniscus|patellar)|fracture|broken|out\s+(?:multiple|several|[2-9]|two|three|four)\s+weeks|miss\s+(?:multiple|several|[2-9]|two|three|four)\s+weeks|high-ankle\s+sprain)\b/i;

const COMPLETED_GAME_AVAILABILITY_BLURB_RE =
  /\b(won['’]?t\s+play|will\s+not\s+play|ruled\s+out|expected\s+to\s+play|game-time\s+decision|inactives?\b|officially\s+(?:active|inactive)|declared\s+inactive|among\s+.*inactives|before\s+[a-z]+\s+game|game\s+status\s+vs\.?\s+[a-z]{2,12}|still\s+missing\s+starters|did\s+not\s+practice|didn['’]?t\s+practice|doesn['’]?t\s+practice|not\s+practicing|not\s+seen\s+at\s+(?:#?[a-z0-9]+\s+)?practice|seen\s+but\s+not\s+part(?:i)?cipating|pre\s+practice\s+report|participation\s+report|no\s+practice|did\s+not\s+participate\s+in\s+(?:wednesday|thursday|friday|today)['’]?s?\s+practice|limited\s+(?:in|at)\s+(?:wednesday|thursday|friday|today)['’]?s?\s+practice|observer\s+for\s+(?:wednesday|thursday|friday)['’]?s?\s+session|ahead\s+of\s+(?:sunday|monday|thursday|saturday|week\s+\d+)['’]?s?\s*(?:game|tilt|matchup|contest|clash)?|ahead\s+of\s+(?:sunday|monday|thursday|saturday)['’]?s?\s+game\s+(?:at|against|vs\.?)|ahead\s+of\s+(?:sunday['’]?s\s+)?[a-z]+\s+game|available\s+for\s+(?:sunday|monday|thursday|saturday)['’]?s?\s+(?:game|tilt|matchup|contest)|questionable\s+for\s+(?:sunday|monday|thursday|saturday)|doubtful\s+for\s+(?:sunday|monday|thursday|saturday)|ruled\s+out\s+for\s+(?:sunday|monday|thursday|saturday)|suit\s+up\s+(?:sunday|monday|thursday|saturday|versus|vs\.?|against)|(?:good|ready|confident[\s\S]{0,45}good)\s+to\s+(?:go|play)|in\s+order\s+to\s+play|hinting\s+at\s+some\s+good\s+news|continue\s+to\s+miss\s+practice|miss\s+second\s+consecutive\s+practice)\b/i;

const PRIOR_WEEK_SIDELINE_TENT_RE =
  /\b(questionable\s+to\s+return|doubtful\s+to\s+return|will\s+not\s+return|no\s+announced\s+injury\s+yet|into\s+the\s+blue\s+tent|blue\s+medical\s+tent|medical\s+tent|limping\s+towards\s+the\s+bench|sitting\s+on\s+the\s+bench)\b/i;

const FANTASY_OR_BETTING_FLUFF_RE =
  /\b(fantasy\s+managers|waiver\s+wire|start\/sit|draftkings|fanduel|parlay|over\/under\s+prop)\b/i;

const OVERVIEW_ON_FIELD_SUBSTANCE_RE =
  /\b(all-22|all 22|film|tape|epa|cpoe|qbr|pff|pass[- ]block|run[- ]block|pressure|sack|touchdown|passing tds|rushing tds|receiving|interception|pick-six|milestone|nfl record|franchise record|hall of fame|\bhof\b|snap count|snap share|extension|restructure|activated|21-day|practice window|designated to return|wide-9|two-high|red-zone|third-down)\b/i;

const OVERVIEW_TRIVIA_OR_BEEF_RE =
  /\b(beef|squashed|feud|all good now|temporary jersey|jersey no\.|gifts him no\.|freely gave[\s\S]{0,30}no\.\s*\d+|off the field)\b/i;

const OVERVIEW_MOCK_DRAFT_RE =
  /\b(mock draft|3-round|7-round|way-too-early|draft simulator)\b/i;

/**
 * Shared candidate validation & general-news enrichment helper used by BOTH
 * `computeOverviewMentionRankScore` (`Overview -> Recent Mentions`) and
 * `computeInjuryNewsRankScore` (`Health -> Injury News`).
 *
 * Ensures owner isolation, age bounds, player mention & clause scoping, completed-game pruning,
 * and shared `breakingClassifier` (`classifyBreakingItem` + `computeWireStoryRank`) +
 * `digestExperienceEngine` (`computeTopSignalScore`) enrichment stay 100% unified with `News & Film`.
 */
function evaluatePlayerNewsCandidateGuard(
  item = {},
  {
    player = null,
    rosterPlayerNames = [],
    nowMs = Date.now(),
    maxAgeDays = 7,
    lastCompletedKickoffMs = null,
    appData = null,
    gameContext = null,
    requireScopedClause = false
  } = {}
) {
  if (!item || !player?.name || item.isClickbait) return null;

  // Enforce strict primary-owner isolation on ESPN/RotoWire player bio blurbs (`espn_pwire_<ownerId>_*`)
  const itemIdStr = String(item.id || '');
  const playerIdStr = String(player.id || '');
  if (itemIdStr.startsWith('espn_pwire_')) {
    const ownerId = itemIdStr.split('_')[2] || '';
    if (ownerId && /^\d+$/.test(ownerId) && /^\d+$/.test(playerIdStr) && ownerId !== playerIdStr) {
      return null;
    }
  }
  if (
    item.primaryPlayer?.id &&
    /^\d+$/.test(String(item.primaryPlayer.id)) &&
    /^\d+$/.test(playerIdStr) &&
    String(item.primaryPlayer.id) !== playerIdStr &&
    item.wireSource === 'espn_player_wire'
  ) {
    return null;
  }

  const pubMs = parseFlexibleIsoMs(item.publishedAt);
  if (pubMs === null) return null;
  const ageHours = Math.max(0, (nowMs - pubMs) / 3_600_000);
  if (ageHours > maxAgeDays * 24 || pubMs > nowMs + 3_600_000) return null;

  const playerSpecificSnippet = String(
    item.playerSnippet || item.playerSnippets?.[playerIdStr] || ''
  ).trim();
  const { primaryLead, secondaryText, fullBody } = assemblePlayerNewsItemText(
    item,
    player.name,
    player.id
  );
  if (!fullBody || fullBody.length < 14) return null;

  // Strict text mention verification (eliminates false-positive general NFL articles & homonyms)
  if (!doesClauseMentionPlayer(fullBody, player.name, { allowSurname: true })) {
    return null;
  }

  const scoped = scopeBeatTextToPlayer(fullBody, player.name, rosterPlayerNames);
  if (requireScopedClause && !scoped) return null;
  const checkScope = scoped || playerSpecificSnippet || fullBody;

  // Scope long-term/IR exemption strictly to THIS player's clause so another player's IR window
  // never leaks stale pre-game DNP blurbs onto this player's card
  const hasLongTermOrIrTimeline = PLAYER_LONG_TERM_OR_IR_TIMELINE_RE.test(checkScope);
  if (!hasLongTermOrIrTimeline && appData && isStaleCompletedGameAvailabilityItem(item, appData, nowMs)) {
    return null;
  }

  const ctx = gameContext || (appData ? resolveGameNewsContext(appData, nowMs) : null);
  const effectiveCompletedKoMs = Number.isFinite(lastCompletedKickoffMs)
    ? lastCompletedKickoffMs
    : ctx?.latestCompletedKickoffMs ?? null;

  // Prune pre-completed-game practice/status blurbs and prior-week sideline blue-tent/return tweets
  if (
    Number.isFinite(effectiveCompletedKoMs) &&
    pubMs < effectiveCompletedKoMs + 20 * 60_000 &&
    !hasLongTermOrIrTimeline
  ) {
    const isCompletedGameAvail = COMPLETED_GAME_AVAILABILITY_BLURB_RE.test(fullBody);
    const isPriorWeekTent =
      pubMs < effectiveCompletedKoMs - 2 * 3_600_000 && PRIOR_WEEK_SIDELINE_TENT_RE.test(fullBody);
    if (isCompletedGameAvail || isPriorWeekTent) {
      return null;
    }
  }

  if (FANTASY_OR_BETTING_FLUFF_RE.test(checkScope) || FANTASY_OR_BETTING_FLUFF_RE.test(fullBody)) {
    return null;
  }

  const cls = classifyBreakingItem(
    {
      ...item,
      title: item.title || item.headline || primaryLead,
      summary: secondaryText
    },
    nowMs,
    ctx
  );
  if (cls.isStalePreGameAvailability || (cls.breakingPriority || 0) < 0) {
    return null;
  }

  return {
    primaryLead,
    secondaryText,
    fullBody,
    scoped,
    checkScope,
    pubMs,
    ageHours,
    ctx,
    effectiveCompletedKoMs,
    hasLongTermOrIrTimeline,
    cls
  };
}

function buildUnifiedWireEnrichedItem(
  item = {},
  cls = {},
  fullBody = '',
  nowMs = Date.now(),
  ctx = null,
  { suppressBreaking = false } = {}
) {
  const repEntry = resolveReporterFromNameOrHandle(
    item.reporterId || item.author || item.reporterName || item.authorHandle
  );
  const resolvedTier =
    Number(item.trustTier) ||
    repEntry?.trustTier ||
    (VERIFIED_TIER1_REPORTER_NAMES_RE.test(fullBody) ? 1 : 2);
  const isOfficial =
    item.outletId === '49ers_official' ||
    /_official$/i.test(String(item.outletId || '')) ||
    item.wireSource === 'official_transactions';
  const trustTier = isOfficial ? 1 : resolvedTier;

  const enriched = suppressBreaking
    ? {
        ...item,
        trustTier,
        storyTier: 'standard',
        isBreaking: false,
        isUrgentBreaking: false,
        isInGameInjury: false,
        breakingPriority: 0,
        breakingBadge: null
      }
    : {
        ...item,
        trustTier,
        storyTier: item.storyTier || cls.storyTier || 'standard',
        isBreaking: item.isBreaking ?? cls.isBreaking,
        isUrgentBreaking: item.isUrgentBreaking ?? cls.isUrgentBreaking,
        isInGameInjury: item.isInGameInjury ?? cls.isInGameInjury,
        breakingPriority: item.breakingPriority ?? cls.breakingPriority,
        breakingBadge: item.breakingBadge ?? cls.breakingBadge
      };

  const wireRankRaw = computeWireStoryRank(enriched, nowMs, ctx);
  const safeWireRank = Math.max(0, Number.isFinite(wireRankRaw) ? wireRankRaw : 0);
  enriched.storyRank = safeWireRank;
  const topSignalScore = computeTopSignalScore(enriched, nowMs);
  return { enriched, storyRank: safeWireRank, topSignalScore };
}

function resolveLastCompletedKickoffMs(appData = null, gameCtx = null) {
  const schedule = appData?.scheduleMatchup?.schedule || [];
  const completedKickoffs = schedule
    .filter(g => g?.completed && (g.dateIso || g.kickoffIso))
    .map(g => parseFlexibleIsoMs(g.dateIso || g.kickoffIso))
    .filter(ms => ms !== null)
    .sort((a, b) => b - a);
  return completedKickoffs.length > 0 ? completedKickoffs[0] : gameCtx?.latestCompletedKickoffMs ?? null;
}

/**
 * Shared candidate collection, unified `isItemAllowedByUserPrefs` source filtering, direct X-link
 * resolution, paywall blocking, canonical URL/lead deduplication, and player-scoped snippet
 * extraction used by BOTH `rankPlayerInjuryNews` and `rankPlayerOverviewMentions`.
 */
function collectScoredPlayerCandidates(
  player,
  { rawStream = [], appData = null, userPrefs = null, reportersById = null, nowMs = Date.now() },
  scoreCandidateFn,
  { requireSanitizedInjurySnippet = false } = {}
) {
  const candidateTypePriority = it => {
    // Prefer direct reporter X posts & rich standalone articles/videos over Bluesky mirrors or bare promo link-tweets
    const isPromoLinkTweet =
      (it?.type === 'tweet' || it?.type === 'social') &&
      Boolean(it?.externalUrl) &&
      /\bread:\s*$/i.test(String(it?.fullText || it?.title || '').trim());
    if (isPromoLinkTweet) return 3;
    if (isDirectXStatusUrl(it?.url)) return 0;
    if (isBlueskyPostUrl(it?.url)) return 2;
    return 1;
  };

  const combinedCandidates = [
    ...(Array.isArray(rawStream) ? rawStream : []),
    ...(Array.isArray(appData?.news?.rawStream) ? appData.news.rawStream : []),
    ...(Array.isArray(player.recentNews) ? player.recentNews : [])
  ].sort((a, b) => candidateTypePriority(a) - candidateTypePriority(b));

  const directPosts = combinedCandidates.filter(
    it =>
      (it?.type === 'tweet' || it?.type === 'social') &&
      isDirectSocialPostUrl(String(it?.url || ''))
  );

  const precomputedPrefSets =
    userPrefs && typeof userPrefs === 'object'
      ? {
          disabledReporters: new Set(userPrefs.disabledReporterIds || []),
          disabledOutlets: new Set(userPrefs.disabledOutlets || [])
        }
      : null;

  const normCanonUrl = u =>
    String(u || '')
      .toLowerCase()
      .replace(/^https?:\/\/(?:www\.)?/, '')
      .replace(/[?#].*$/, '')
      .replace(/\/+$/, '');

  const seenLeadKeys = new Set();
  const seenCanonUrls = new Set();
  const scored = [];
  const pidStr = String(player.id || '');

  for (const cand of combinedCandidates) {
    if (!cand || !isItemAllowedByUserPrefs(cand, reportersById, userPrefs, precomputedPrefSets)) {
      continue;
    }

    const isVid = cand.type === 'video';
    const isTw =
      !isVid &&
      (cand.type === 'tweet' || cand.type === 'social' || isBlueskyPostUrl(String(cand.url || '')));
    const rawUrl = isTw
      ? resolveOriginalTweetUrl(
          {
            ...cand,
            type: 'tweet',
            primaryPlayer: { name: player.name },
            title: cand.title || cand.headline || ''
          },
          directPosts
        )
      : cand.url;
    const safeUrl = sanitizeExternalUrl(rawUrl, null);
    if (!safeUrl || isPaywalledPublisher(cand.outletName, safeUrl)) continue;

    const leadKey = String(cand.fullText || cand.title || cand.headline || '')
      .toLowerCase()
      .replace(/https?:\/\/\S+/g, '')
      .replace(/[^a-z0-9]/g, '')
      .slice(0, 72);
    if (!leadKey || seenLeadKeys.has(leadKey)) continue;

    const urlCanon = !safeUrl.includes('#:~:text=') ? normCanonUrl(safeUrl) : '';
    const extCanon = cand.externalUrl ? normCanonUrl(cand.externalUrl) : '';
    if (urlCanon && seenCanonUrls.has(urlCanon)) continue;
    if (extCanon && seenCanonUrls.has(extCanon)) continue;

    const candWithResolvedUrl = safeUrl !== cand.url ? { ...cand, url: safeUrl } : cand;
    const rankMeta = scoreCandidateFn(candWithResolvedUrl);
    if (!rankMeta) continue;

    seenLeadKeys.add(leadKey);
    if (urlCanon) seenCanonUrls.add(urlCanon);
    if (extCanon) seenCanonUrls.add(extCanon);

    const rawAuthor = cand.author || cand.reporterName || cand.outletName || `${getActiveTeamConfig().nickname} Beat`;
    const authorName = String(rawAuthor).trim().toUpperCase() === 'NFL' ? 'NFL Official' : rawAuthor;
    const authorProfileUrl = sanitizeExternalUrl(
      resolveItemAuthorProfileUrl(cand, safeUrl),
      safeUrl
    );

    const testSnippetHealth = txt =>
      INJURY_NEWS_TOPIC_RELEVANCE_RE.test(
        requireSanitizedInjurySnippet ? sanitizeTextForPlayerHealthCheck(txt) : txt
      );

    const crossSnippetText =
      cand.playerSnippets && typeof cand.playerSnippets === 'object'
        ? Object.entries(cand.playerSnippets)
            .filter(
              ([k, v]) =>
                k !== pidStr &&
                v &&
                doesClauseMentionPlayer(String(v), player.name, { allowSurname: false })
            )
            .map(([, v]) => String(v).trim())
            .find(s => testSnippetHealth(s)) || ''
        : '';
    const directSnippetText = String(cand.playerSnippet || cand.playerSnippets?.[pidStr] || '').trim();
    const playerSnippetText =
      directSnippetText && testSnippetHealth(directSnippetText)
        ? directSnippetText
        : crossSnippetText || directSnippetText;
    const resolvedSummaryRaw =
      !isTw &&
      !isVid &&
      playerSnippetText &&
      (!cand.summary ||
        !doesClauseMentionPlayer(cand.summary, player.name, { allowSurname: true }) ||
        (testSnippetHealth(playerSnippetText) && !testSnippetHealth(cand.summary)))
        ? playerSnippetText
        : cand.summary || cand.externalDescription || '';
    const resolvedSummary = String(resolvedSummaryRaw || '')
      .replace(/^\s*\(Photo by [^)]+\)\s*(?:\|\s*(?:Getty\s+Images|USA\s+TODAY\s+Sports|AP\s+Photo|Imagn\s+Images)\s*)?/i, '')
      .trim();

    const clsMeta = rankMeta.classifiedMeta || {};
    scored.push({
      ...cand,
      type: isVid ? 'video' : isTw ? 'tweet' : 'article',
      headline: cand.headline || cand.title || '',
      title: cand.title || cand.headline || '',
      summary: resolvedSummary,
      fullText: isTw ? cand.fullText || cand.title || cand.headline || '' : cand.fullText || null,
      author: authorName,
      authorProfileUrl,
      url: safeUrl,
      isBreaking: Boolean(clsMeta.isBreaking ?? cand.isBreaking),
      isUrgentBreaking: Boolean(clsMeta.isUrgentBreaking ?? cand.isUrgentBreaking),
      isInGameInjury: Boolean(clsMeta.isInGameInjury ?? cand.isInGameInjury),
      breakingBadge: clsMeta.breakingBadge ?? cand.breakingBadge ?? null,
      storyTier: clsMeta.storyTier || cand.storyTier || 'standard',
      storyRank: clsMeta.storyRank ?? cand.storyRank ?? 0,
      _rankMeta: rankMeta
    });
  }

  return scored;
}

/**
 * Computes a deterministic Joint Recency + Medical Salience score for a candidate injury tweet,
 * video, or article pertaining to `player`. Anchors to the shared general-news `StoryRank` /
 * `computeTopSignalScore` foundation (authority, corroboration, X-first, Kickoff Epoch Wall,
 * live in-game boosts) and layers injury-specific rehab/medical/superseded-practice logic on top.
 */
export function computeInjuryNewsRankScore(
  item = {},
  {
    player = null,
    rosterPlayerNames = [],
    nowMs = Date.now(),
    maxAgeDays = 8,
    lastCompletedKickoffMs = null,
    hasObservedPracticeThisWeek = false,
    appData = null,
    gameContext = null
  } = {}
) {
  const guard = evaluatePlayerNewsCandidateGuard(item, {
    player,
    rosterPlayerNames,
    nowMs,
    maxAgeDays,
    lastCompletedKickoffMs,
    appData,
    gameContext,
    requireScopedClause: true
  });
  if (!guard) return null;

  const { fullBody, scoped, checkScope, pubMs, ageHours, ctx, effectiveCompletedKoMs, hasLongTermOrIrTimeline, cls } =
    guard;
  if (fullBody.length < 15) return null;

  const sanitizedHealthScope = sanitizeTextForPlayerHealthCheck(checkScope);
  if (!INJURY_NEWS_TOPIC_RELEVANCE_RE.test(sanitizedHealthScope)) {
    return null;
  }
  // Reject generic press-conference / transcript topic lists ("discusses key injuries, Brock Purdy, Keenan Allen...")
  // when there is zero player-specific medical, body-part, practice, or status substance in the scoped clause.
  const isGenericPresserTopicList =
    /\b(?:transcripts?:|press\s+conference|presser|shares\s+(?:49ers\s+)?injury\s+updates|discusses\s+(?:key\s+)?injuries\s*,)/i.test(
      fullBody
    ) &&
    !/\b(?:ankle|knee|leg|lower[- ]leg|fibula|tibia|shin|hamstring|groin|calf|achilles|foot|toe|back|shoulder|elbow|wrist|hand|thumb|rib|chest|neck|hip|quad|concussion|adductor|oblique|pectoral|collarbone|illness|air\s*cast|carted|cart|dnp|limited|did not practice|practiced|sidelined|ruled out|questionable|doubtful|injured reserve|\bir\b|21-day|mri|surgery|sprain|strain|tear|fracture|setback|rehab|trending\s+(?:up|down))\b/i.test(
      sanitizedHealthScope
    );
  if (isGenericPresserTopicList) {
    return null;
  }

  // 1. Shared General-News Foundation (`computeWireStoryRank` + `computeTopSignalScore`):
  //    Inherits authority tiers, corroboration velocity, rewrite-aggregator demotion, X-first priority,
  //    Kickoff Epoch Wall, and live in-game injury overrides from the app-wide News engine!
  const { enriched, topSignalScore } = buildUnifiedWireEnrichedItem(item, cls, fullBody, nowMs, ctx);
  const sharedNewsAnchor = Math.min(90, Math.max(0, topSignalScore)) * 0.42;

  // 2. Steep Medical Recency Curve (0..54 pts, 5.5-hour half-life) + pre-kickoff demotion
  const injPreKickoffDemote =
    Number.isFinite(effectiveCompletedKoMs) &&
    nowMs - effectiveCompletedKoMs <= 72 * 3_600_000 &&
    pubMs < effectiveCompletedKoMs - 10 * 60_000 &&
    !hasLongTermOrIrTimeline;
  const recencyScore = 54 * Math.pow(0.5, ageHours / 5.5) * (injPreKickoffDemote ? 0.35 : 1);

  // 3. Observational Side-Field & Rehab Progression Color (0..28 pts, 30h half-life)
  const salienceAgeDecay = Math.pow(0.5, ageHours / 30);
  let colorScore = 0;
  if (INJURY_REHAB_COLOR_DETAIL_RE.test(checkScope)) {
    colorScore += 24;
  }
  if (INJURY_CONTRASTIVE_COLOR_RE.test(checkScope) || INJURY_CONTRASTIVE_COLOR_RE.test(fullBody)) {
    colorScore += 6;
  }
  colorScore = Math.min(28, colorScore) * salienceAgeDecay * (injPreKickoffDemote ? 0.35 : 1);

  // 4. Medical Diagnostic / Coaching Quote / Timeline Detail (0..20 pts, age-decayed)
  let medicalScore = 0;
  if (INJURY_MEDICAL_DIAGNOSTIC_OR_QUOTE_RE.test(checkScope)) {
    medicalScore += 18;
  }
  if (
    player.health?.injuryType &&
    checkScope.toLowerCase().includes(String(player.health.injuryType).split(/[ ,/-]/)[0].toLowerCase())
  ) {
    medicalScore += 3;
  }
  medicalScore = Math.min(20, medicalScore) * salienceAgeDecay;

  // 5. Status Milestone / Late-Week Game-Availability Scoop vs Routine Participation (0..22 pts)
  const isLateWeekAvailabilityScoop =
    /\b(?:(?:confident|optimistic)[\s\S]{0,65}\b(?:good to go|will play|ready to go|able to play)|(?:good|ready)\s+to\s+go\s+for\s+(?:sunday|monday|thursday|saturday|week\s+\d+)|expected\s+to\s+(?:play|suit\s+up|be\s+activated|miss)|on\s+track\s+to\s+(?:play|suit\s+up)|did\s+not\s+elevate\s+any[\s\S]{0,30}practice[- ]squad|no\s+(?:official\s+)?injury\s+designation|does\s+not\s+(?:have|carry)\s+an?\s+(?:official\s+)?(?:injury\s+)?designation|officially\s+(?:active|inactive)|unlikely\s+to\s+(?:play|suit\s+up)|game-time\s+decision)\b/i.test(
      `${checkScope} ${fullBody}`
    );
  let milestoneScore = 0;
  if (enriched.isInGameInjury && ageHours <= 8) {
    milestoneScore = 24 * Math.pow(0.5, ageHours / 12);
  } else if (isLateWeekAvailabilityScoop) {
    milestoneScore = 22 * Math.pow(0.5, ageHours / 36);
  } else if (INJURY_STATUS_MILESTONE_RE.test(checkScope)) {
    milestoneScore = 16 * salienceAgeDecay;
  } else if (
    /\b(limited\s+(?:practice\s+)?participant|limited\s+today|did\s+not\s+practice|didn't\s+practice|not\s+practicing|no\s+practice\s+for|not\s+participating|full\s+participant|practiced\s+in\s+full)\b/i.test(
      fullBody
    )
  ) {
    milestoneScore = 10 * salienceAgeDecay;
  }

  // 6. Single-Player Focus Specificity (-8..+6 pts)
  // Demote articles/videos whose headline explicitly spotlights a DIFFERENT player (by full name) without naming `player`
  // (e.g., a Mike Evans-headlined article briefly mentioning Renardo Green in the body), so direct player reports rank #1
  // while keeping the roundup available when no direct items exist.
  const rawHeadline = String(item.title || item.headline || '').trim();
  const isNonTweetWithHeadline = item.type !== 'tweet' && rawHeadline.length > 0;
  const headlineMentionsTarget =
    isNonTweetWithHeadline && doesClauseMentionPlayer(rawHeadline, player.name, { allowSurname: true });
  const targetCanonKey = canonicalInjuryPlayerKey(player.name);
  const headlineNamesOtherPlayer =
    isNonTweetWithHeadline &&
    !headlineMentionsTarget &&
    (Array.isArray(item.mentionedPlayers) ? item.mentionedPlayers : [])
      .map(mp => (typeof mp === 'string' ? mp : mp?.name || ''))
      .concat(rosterPlayerNames)
      .some(
        otherName =>
          otherName &&
          canonicalInjuryPlayerKey(otherName) !== targetCanonKey &&
          doesClauseMentionPlayer(rawHeadline, otherName, { allowSurname: false })
      );
  const focusRatio = scoped ? scoped.length / Math.max(1, fullBody.length) : 0.4;
  const mentionedCnt = Array.isArray(item.mentionedPlayers) ? item.mentionedPlayers.length : 1;
  const focusScore = headlineNamesOtherPlayer
    ? -8
    : focusRatio >= 0.5 && mentionedCnt <= 3
      ? 6
      : mentionedCnt >= 5
        ? -4
        : 2;

  // 7. Superseded Earlier-Practice-Day & Pre-Practice Expectation Penalties
  const friLogged = Boolean(player.health?.fri && player.health.fri !== '-');
  const thuLogged = Boolean(player.health?.thu && player.health.thu !== '-');
  const citesOnlyWedOrThuPractice =
    /\b(?:wednesday|thursday)(?:['’]s)?\s+(?:practice|session|injury\s+report)|(?:in|at|for|missed|during)\s+(?:wednesday|thursday)(?:['’]s)?\s+(?:practice|session)|two\s+more\s+opportunities\s+to\s+practice\b/i.test(
      fullBody
    ) && !/\bfriday\b/i.test(fullBody);
  const citesOnlyWedPractice =
    /\bwednesday(?:['’]s)?\s+(?:practice|session|injury\s+report)|(?:in|at|for|missed|during)\s+wednesday(?:['’]s)?\s+(?:practice|session)|two\s+more\s+opportunities\s+to\s+practice\b/i.test(
      fullBody
    ) && !/\b(?:thursday|friday)\b/i.test(fullBody);

  let supersededPenalty = 0;
  if (friLogged && ageHours > 18 && citesOnlyWedOrThuPractice) {
    supersededPenalty = -30;
  } else if (thuLogged && ageHours > 16 && citesOnlyWedPractice) {
    supersededPenalty = -26;
  } else if (
    hasObservedPracticeThisWeek &&
    ageHours > 10 &&
    FUTURE_PRACTICE_EXPECTATION_GUARD_RE.test(checkScope) &&
    !INJURY_REHAB_COLOR_DETAIL_RE.test(checkScope) &&
    milestoneScore < 6
  ) {
    supersededPenalty = -18;
  }

  const totalScore = Number(
    (
      sharedNewsAnchor +
      recencyScore +
      colorScore +
      medicalScore +
      milestoneScore +
      focusScore +
      supersededPenalty
    ).toFixed(2)
  );

  return {
    totalScore,
    sharedNewsAnchor: Number(sharedNewsAnchor.toFixed(2)),
    recencyScore: Number(recencyScore.toFixed(2)),
    salienceScore: Number((sharedNewsAnchor + colorScore + medicalScore + milestoneScore + focusScore).toFixed(2)),
    hasRehabColor: colorScore >= 20,
    ageHours: Number(ageHours.toFixed(2)),
    scopedText: checkScope,
    classifiedMeta: enriched
  };
}

/**
 * Returns the deduplicated, Recency + Medical Salience stack-ranked list of injury & recovery
 * tweets, videos, and articles for `player`.
 */
export function rankPlayerInjuryNews(
  player = null,
  {
    rawStream = [],
    appData = null,
    userPrefs = null,
    reportersById = null,
    nowMs = Date.now(),
    maxAgeDays = 8,
    maxItems = 25,
    includeFallbackCard = true
  } = {}
) {
  if (!player?.name) return [];
  const h = player.health || {};
  const rosterPlayers = appData?.roster?.players || [];
  const rosterPlayerNames = rosterPlayers.map(rp => rp?.name).filter(Boolean);
  const gameCtx = appData ? resolveGameNewsContext(appData, nowMs) : null;
  const lastCompletedKickoffMs = resolveLastCompletedKickoffMs(appData, gameCtx);
  const hasObservedPracticeThisWeek =
    (h.wed && h.wed !== '-') || (h.thu && h.thu !== '-') || (h.fri && h.fri !== '-');

  const scored = collectScoredPlayerCandidates(
    player,
    { rawStream, appData, userPrefs, reportersById, nowMs },
    cand =>
      computeInjuryNewsRankScore(cand, {
        player,
        rosterPlayerNames,
        nowMs,
        maxAgeDays,
        lastCompletedKickoffMs,
        hasObservedPracticeThisWeek,
        appData,
        gameContext: gameCtx
      }),
    { requireSanitizedInjurySnippet: true }
  ).map(item => {
    const meta = item._rankMeta;
    const { _rankMeta, ...cleanItem } = item;
    return {
      ...cleanItem,
      injuryRankScore: meta.totalScore,
      injurySalienceScore: meta.salienceScore,
      hasRehabColor: meta.hasRehabColor
    };
  });

  // Ensure at most ONE breaking injury update for this player keeps urgent breaking status & top-pinning
  const enforcedScored = enforceSingleBreakingInjuryPerPlayer(scored, {
    nowMs,
    rosterPlayers: Array.isArray(appData?.roster?.players) ? appData.roster.players : player ? [player] : []
  });

  // Sort by live in-game urgent pin -> Joint Recency + Medical Salience score desc -> newest timestamp
  enforcedScored.sort((a, b) => {
    const aLive = a?.isInGameInjury && isUrgentBreakingBadge(a?.breakingBadge) ? 1 : 0;
    const bLive = b?.isInGameInjury && isUrgentBreakingBadge(b?.breakingBadge) ? 1 : 0;
    if (aLive !== bLive) return bLive - aLive;
    return (
      b.injuryRankScore - a.injuryRankScore ||
      (parseFlexibleIsoMs(b.publishedAt) || 0) - (parseFlexibleIsoMs(a.publishedAt) || 0)
    );
  });

  // Consolidate only bare multi-player dry practice-report list tweets into `confirmingReports`
  // while keeping every distinct tweet, video, and article visible in the player's Health list!
  const deduped = [];
  for (const item of enforcedScored) {
    const itemMs = parseFlexibleIsoMs(item.publishedAt) || 0;
    const itemText = `${item.fullText || ''} ${item.title || ''} ${item.summary || ''}`.toLowerCase();
    const bucketTag =
      item.type === 'tweet' &&
      !item.videoStreamUrl &&
      !item.videoId &&
      !INJURY_REHAB_COLOR_DETAIL_RE.test(itemText) &&
      item.wireSource !== 'espn_player_wire' &&
      /\b(pre\s+practice\s+report|practice\s+report\s*:\s*not\s+participating|not\s+participating\s+(?:wr|rb|cb|dl|dt|de|lb|ol|ot|te|qb|s)|no\s+practice\s+for\s+.*or)\b/.test(
        itemText
      )
        ? 'multi_player_practice_list'
        : null;

    if (bucketTag) {
      const existingLead = deduped.find(d => {
        if (d._injuryDedupTag !== bucketTag) return false;
        const dMs = parseFlexibleIsoMs(d.publishedAt) || 0;
        return Math.abs(dMs - itemMs) <= 14 * 3_600_000;
      });
      if (existingLead) {
        if (!Array.isArray(existingLead.confirmingReports)) existingLead.confirmingReports = [];
        if (
          !existingLead.confirmingReports.some(
            cr => (cr.author || '').toLowerCase() === (item.author || '').toLowerCase()
          ) &&
          (existingLead.author || '').toLowerCase() !== (item.author || '').toLowerCase()
        ) {
          existingLead.confirmingReports.push(item);
        }
        continue;
      }
    }

    deduped.push({
      ...item,
      _injuryDedupTag: bucketTag,
      confirmingReports: Array.isArray(item.confirmingReports) ? [...item.confirmingReports] : []
    });
    if (deduped.length >= maxItems) break;
  }

  // Clean fallback: if an injured player has no matched stream card in the feed yet,
  // synthesize a grounded beat/medical update card from their verified ESPN/RotoWire/49ers.com injury note
  if (deduped.length === 0 && includeFallbackCard) {
    const activeTeamInj = resolveTeamConfig(appData?.meta?.teamAbbr || getActiveTeamConfig());
    const teamNickInj = activeTeamInj?.nickname || 'NFL';
    const clubInjUrl = activeTeamInj?.clubInjuryUrl || `https://www.${activeTeamInj?.clubDomain || 'nfl.com'}/team/injury-report/`;
    const fallbackProse = pickMeaningfulInjuryComment(h.irBeatNote, h.longComment, h.shortComment, player.beatComment);
    if (fallbackProse && !isBareStatusPlaceholderComment(fallbackProse)) {
      const parsedAttr = extractBeatAttributionFromText(fallbackProse, {
        reporterId: null,
        reporterName: `${teamNickInj} Beat & Medical Desk`,
        outletId: 'espn',
        outletName: `ESPN / ${teamNickInj} Beat`
      });
      const hasEspnId = /^\d+$/.test(String(player.id || ''));
      const fallbackUrl = sanitizeExternalUrl(
        hasEspnId
          ? buildEspnPlayerNewsAnchorUrl(player.id, player.name, fallbackProse)
          : player.espnUrl || clubInjUrl,
        clubInjUrl
      );
      const authorProfile = sanitizeExternalUrl(
        parsedAttr.xUrl || parsedAttr.authorProfileUrl || fallbackUrl,
        fallbackUrl
      );
      deduped.push({
        id: `inj_fallback_${player.id || player.name}`,
        type: 'article',
        wireSource: 'espn_player_wire',
        title: fallbackProse,
        headline: fallbackProse,
        fullText: null,
        isFullTweet: false,
        summary: '',
        author: parsedAttr.author || `${teamNickInj} Beat & Medical Desk`,
        authorHandle: parsedAttr.authorHandle || '',
        authorProfileUrl: authorProfile,
        outletName: parsedAttr.outletName || 'ESPN Injury Wire',
        publishedAt: appData?.health?.updatedAt || appData?.meta?.updatedAt || new Date(nowMs).toISOString(),
        url: fallbackUrl,
        injuryRankScore: 50,
        injurySalienceScore: 25,
        hasRehabColor: INJURY_REHAB_COLOR_DETAIL_RE.test(fallbackProse),
        confirmingReports: []
      });
    }
  }

  return deduped;
}

/**
 * Computes a unified player-centric `Top` score for `Overview -> Recent Mentions (7d)` by directly
 * building on the app-wide `News & Film` `Top` algorithm (`computeWireStoryRank` + `computeTopSignalScore`)
 * and layering ONLY player-focus relevance & noise modifiers on top—so general news improvements
 * automatically lift both `News & Film` and Player Card `Recent Mentions`.
 */
export function computeOverviewMentionRankScore(
  item = {},
  {
    player = null,
    rosterPlayerNames = [],
    nowMs = Date.now(),
    maxAgeDays = 7,
    lastCompletedKickoffMs = null,
    appData = null,
    gameContext = null
  } = {}
) {
  const guard = evaluatePlayerNewsCandidateGuard(item, {
    player,
    rosterPlayerNames,
    nowMs,
    maxAgeDays,
    lastCompletedKickoffMs,
    appData,
    gameContext,
    requireScopedClause: false
  });
  if (!guard) return null;

  const { primaryLead: primaryText, secondaryText, fullBody, scoped, checkScope, ageHours, ctx, cls } = guard;

  // 1. Primary Subject vs. Secondary Ripple Mention Multiplier
  const leadClause = (primaryText.split(/[.;!?\n]/)[0] || primaryText).trim();
  const inLeadClause = doesClauseMentionPlayer(leadClause, player.name, { allowSurname: true });
  const mentionedCnt = Array.isArray(item.mentionedPlayers) ? item.mentionedPlayers.length : 1;
  const isSoleSubjectInSummary =
    !inLeadClause &&
    mentionedCnt === 1 &&
    Boolean(secondaryText) &&
    doesClauseMentionPlayer(secondaryText, player.name, { allowSurname: true });
  const isPrimaryPlayerFocus = inLeadClause || isSoleSubjectInSummary;
  const isOtherPlayerTransactionLead =
    !isPrimaryPlayerFocus &&
    /\b(trade[sd]?\s+for|completing\s+a\s+trade|acquir(?:e|ed|ing)|designate[sd]?|opened\s+the\s+practice\s+window\s+for|signed|waived)\b/i.test(
      leadClause
    );
  const focusRatio = scoped ? scoped.length / Math.max(1, fullBody.length) : 0.45;

  // 2. Shared App-Wide `News & Film` `Top` Foundation (`computeWireStoryRank` + `computeTopSignalScore`)
  //    Suppress breaking/tier boosts when the headline is actually another player's transaction.
  const { enriched, topSignalScore } = buildUnifiedWireEnrichedItem(item, cls, fullBody, nowMs, ctx, {
    suppressBreaking: isOtherPlayerTransactionLead
  });

  let focusMult = 0.68;
  if (isPrimaryPlayerFocus || enriched.isInGameInjury) {
    focusMult = (focusRatio >= 0.55 || isSoleSubjectInSummary) && mentionedCnt <= 2 ? 1.35 : 1.18;
  } else if (isOtherPlayerTransactionLead) {
    focusMult = 0.32;
  } else if (mentionedCnt >= 5) {
    focusMult = 0.55;
  }

  // 3. Player-Card Substance & Noise Modifiers (mock drafts / trivia demoted; film/milestone/rehab lifted)
  const hasFootballOrMedicalSubstance =
    INJURY_REHAB_COLOR_DETAIL_RE.test(checkScope) ||
    INJURY_MEDICAL_DIAGNOSTIC_OR_QUOTE_RE.test(checkScope) ||
    INJURY_STATUS_MILESTONE_RE.test(checkScope) ||
    OVERVIEW_ON_FIELD_SUBSTANCE_RE.test(checkScope) ||
    /\b(\d+\s+snaps|starting\s+(?:defense|offense)|matched\s+up\s+against|targets|tackles|yards|pass\s+breakups?|left\s+with\s+a|exited\s+with|suffered\s+a|sustained\s+a|injury\s+update)\b/i.test(
      checkScope
    );

  let substanceMult = 1.0;
  if (OVERVIEW_MOCK_DRAFT_RE.test(fullBody)) {
    substanceMult = 0.25;
  } else if (OVERVIEW_TRIVIA_OR_BEEF_RE.test(fullBody)) {
    substanceMult = 0.55;
  } else if (hasFootballOrMedicalSubstance) {
    substanceMult = isPrimaryPlayerFocus ? 1.24 : 1.08;
  }

  // Keep live in-game injuries strictly pinned above standard chatter on this player's card
  const urgentInGameFloor = enriched.isInGameInjury && ageHours <= 6 ? 120 : 0;
  const totalScore = Number((urgentInGameFloor + topSignalScore * focusMult * substanceMult).toFixed(4));

  return {
    totalScore,
    topSignalScore: Number(topSignalScore.toFixed(4)),
    focusMult,
    substanceMult,
    ageHours: Number(ageHours.toFixed(2)),
    isOtherPlayerTransactionLead,
    classifiedMeta: enriched
  };
}

/**
 * Stack-ranks (or chronologically sorts via `sortMode: 'top' | 'latest'`), link-verifies, and
 * deduplicates `Overview -> Recent Mentions (7d)` for `player`, sharing the unified `News & Film`
 * user-prefs, `StoryRank` / `computeTopSignalScore`, and `compareLatestNewsItems` primitives.
 */
export function rankPlayerOverviewMentions(
  player = null,
  {
    rawStream = [],
    appData = null,
    userPrefs = null,
    reportersById = null,
    nowMs = Date.now(),
    maxAgeDays = 7,
    maxItems = 10,
    sortMode = 'top'
  } = {}
) {
  if (!player?.name) return [];
  const activeSort = normalizeNewsSortMode(sortMode);
  const rosterPlayers = appData?.roster?.players || [];
  const rosterPlayerNames = rosterPlayers.map(rp => rp?.name).filter(Boolean);
  const gameCtx = appData ? resolveGameNewsContext(appData, nowMs) : null;
  const lastCompletedKickoffMs = resolveLastCompletedKickoffMs(appData, gameCtx);

  const scored = collectScoredPlayerCandidates(
    player,
    { rawStream, appData, userPrefs, reportersById, nowMs },
    cand =>
      computeOverviewMentionRankScore(cand, {
        player,
        rosterPlayerNames,
        nowMs,
        maxAgeDays,
        lastCompletedKickoffMs,
        appData,
        gameContext: gameCtx
      }),
    { requireSanitizedInjurySnippet: false }
  ).map(item => {
    const meta = item._rankMeta;
    const { _rankMeta, ...cleanItem } = item;
    return {
      ...cleanItem,
      overviewRankScore: meta.totalScore
    };
  });

  // Always pick the highest-ranked lead card first when collapsing duplicate echoes
  scored.sort(
    (a, b) =>
      b.overviewRankScore - a.overviewRankScore ||
      (parseFlexibleIsoMs(b.publishedAt) || 0) - (parseFlexibleIsoMs(a.publishedAt) || 0)
  );

  // Consolidate same-day duplicate quote/status echoes across the full 7d pool BEFORE sorting/slicing
  // so toggling `Top` <-> `Latest` operates on the exact same deduplicated pool and never drops fresh items!
  const deduped = [];
  for (const item of scored) {
    const itemMs = parseFlexibleIsoMs(item.publishedAt) || 0;
    const itemText = `${item.fullText || ''} ${item.title || ''} ${item.summary || ''}`.toLowerCase();
    const echoTag = OVERVIEW_TRIVIA_OR_BEEF_RE.test(itemText)
      ? /\bbeef|squashed|feud|all good now\b/.test(itemText)
        ? 'quote_beef'
        : /\bjersey|no\.\s*\d+\b/.test(itemText)
          ? 'quote_jersey'
          : null
      : !INJURY_REHAB_COLOR_DETAIL_RE.test(itemText) &&
          item.wireSource !== 'espn_player_wire' &&
          /\b(pre\s+practice\s+report|not\s+participating\s+wr|no\s+practice\s+for\s+.*or)\b/.test(itemText)
        ? 'multi_player_practice_list'
        : null;

    if (echoTag) {
      const existingLead = deduped.find(d => {
        if (d._overviewEchoTag !== echoTag) return false;
        const dMs = parseFlexibleIsoMs(d.publishedAt) || 0;
        return Math.abs(dMs - itemMs) <= 24 * 3_600_000;
      });
      if (existingLead) {
        if (!Array.isArray(existingLead.confirmingReports)) existingLead.confirmingReports = [];
        if (
          !existingLead.confirmingReports.some(cr => cr.url === item.url) &&
          existingLead.url !== item.url
        ) {
          existingLead.confirmingReports.push(item);
        }
        continue;
      }
    }

    deduped.push({
      ...item,
      _overviewEchoTag: echoTag,
      confirmingReports: Array.isArray(item.confirmingReports) ? [...item.confirmingReports] : []
    });
  }

  const enforcedDeduped = enforceSingleBreakingInjuryPerPlayer(deduped, {
    nowMs,
    rosterPlayers: Array.isArray(appData?.roster?.players) ? appData.roster.players : player ? [player] : []
  });

  if (activeSort === 'latest') {
    enforcedDeduped.sort(compareLatestNewsItems);
  } else {
    enforcedDeduped.sort((a, b) => {
      const aLive = a?.isInGameInjury && isUrgentBreakingBadge(a?.breakingBadge) ? 1 : 0;
      const bLive = b?.isInGameInjury && isUrgentBreakingBadge(b?.breakingBadge) ? 1 : 0;
      if (aLive !== bLive) return bLive - aLive;
      const diff = (b.overviewRankScore || 0) - (a.overviewRankScore || 0);
      if (diff !== 0) return diff;
      return (parseFlexibleIsoMs(b.publishedAt) || 0) - (parseFlexibleIsoMs(a.publishedAt) || 0);
    });
  }

  return enforcedDeduped.slice(0, maxItems);
}

/**
 * Builds the sorted list of entries for the `Game & Season -> Health -> Injury News` card:
 *  - Includes every genuinely injured player on the weekly Injury Report (excluding healthy `NIR - Rest` maintenance entries)
 *  - Sorted strictly from LOWEST to HIGHEST Play Likelihood (`playProbabilityPct` asc)
 *  - Attaches the single top-ranked (`#1` Recency + Salience) tweet or article per injured player
 */
export function buildTeamInjuryNewsFeed(
  appData = {},
  { userPrefs = null, reportersById = null, nowMs = Date.now(), injuryRowsOverride = null } = {}
) {
  const rosterPlayers = Array.isArray(appData?.roster?.players) ? appData.roster.players : [];
  const byId = new Map(rosterPlayers.map(p => [String(p.id), p]));
  const byNorm = new Map(
    rosterPlayers.map(p => [
      String(p.name || '')
        .toLowerCase()
        .replace(/\b(?:jr\.?|sr\.?|ii|iii|iv|v)\b/g, '')
        .replace(/[^a-z0-9]/g, ''),
      p
    ])
  );

  const reportRows = Array.isArray(injuryRowsOverride)
    ? injuryRowsOverride
    : Array.isArray(appData?.health?.practiceReport)
      ? appData.health.practiceReport
      : [];

  const rawStream = Array.isArray(appData?.news?.rawStream) ? appData.news.rawStream : [];
  const entries = [];
  const seenPlayerIds = new Set();

  for (const row of reportRows) {
    if (!row || isPureVeteranRestEntry(row)) continue;
    const injClean = String(row.injuryType || '').trim();
    if (/healthy scratch|coach'?s decision/i.test(injClean)) continue;
    if (/^cleared\s*[—-]\s*no designation$/i.test(injClean) && Number(row.playProbabilityPct ?? 99) >= 90) {
      continue;
    }

    const normKey = String(row.name || '')
      .toLowerCase()
      .replace(/\b(?:jr\.?|sr\.?|ii|iii|iv|v)\b/g, '')
      .replace(/[^a-z0-9]/g, '');
    const rp = (row.playerId && byId.get(String(row.playerId))) || byNorm.get(normKey) || null;
    const pid = String(row.playerId || rp?.id || normKey);
    if (!pid || seenPlayerIds.has(pid)) continue;
    seenPlayerIds.add(pid);

    const effectivePlayer = rp
      ? {
          ...rp,
          beatComment: row.beatComment || '',
          health: {
            ...(rp.health || {}),
            isInGameInjury: Boolean(row.isInGameInjury),
            isInGameReturned: Boolean(row.isInGameReturned),
            wed: row.wed ?? rp.health?.wed ?? '-',
            thu: row.thu ?? rp.health?.thu ?? '-',
            fri: row.fri ?? rp.health?.fri ?? '-',
            injuryType: row.injuryType || rp.health?.injuryType || '',
            status: row.gameStatus || rp.health?.status || '',
            playProbabilityPct: row.playProbabilityPct ?? rp.health?.playProbabilityPct ?? 50,
            playBadgeLabel: row.playBadgeLabel || rp.health?.playBadgeLabel || ''
          }
        }
      : {
          id: row.playerId || '',
          name: row.name,
          position: row.position || 'ATH',
          jersey: row.jersey ?? null,
          headshotUrl: row.headshotUrl || '',
          rosterBucket: 'active',
          beatComment: row.beatComment || '',
          health: {
            isInGameInjury: Boolean(row.isInGameInjury),
            isInGameReturned: Boolean(row.isInGameReturned),
            injuryType: row.injuryType || '',
            status: row.gameStatus || 'Questionable',
            wed: row.wed || '-',
            thu: row.thu || '-',
            fri: row.fri || '-',
            longComment: row.beatComment || '',
            shortComment: row.beatComment || '',
            playProbabilityPct: row.playProbabilityPct ?? 50,
            playBadgeLabel: row.playBadgeLabel || ''
          }
        };

    const rankedNews = rankPlayerInjuryNews(effectivePlayer, {
      rawStream,
      appData,
      userPrefs,
      reportersById,
      nowMs,
      maxAgeDays: 8,
      maxItems: 1
    });

    let topItem = rankedNews[0] || null;
    if ((row.isInGameInjury || row.isInGameReturned) && row.inGameLatestItem) {
      const inGamePubMs = Date.parse(row.inGameLatestItem.publishedAt || '') || 0;
      const topPubMs = topItem ? Date.parse(topItem.publishedAt || '') || 0 : 0;
      if (!topItem || inGamePubMs >= topPubMs) {
        topItem = row.inGameLatestItem;
      }
    }

    if (topItem) {
      entries.push({
        playerId: rp?.id || row.playerId || '',
        name: effectivePlayer.name,
        position: effectivePlayer.position,
        jersey: effectivePlayer.jersey,
        headshotUrl: effectivePlayer.headshotUrl || '',
        injuryType: row.injuryType || effectivePlayer.health?.injuryType || '',
        playProbabilityPct: Number(row.playProbabilityPct ?? effectivePlayer.health?.playProbabilityPct ?? 50),
        playBadgeLabel: row.playBadgeLabel || effectivePlayer.health?.playBadgeLabel || '',
        capHit2026: Number(rp?.capHit2026 || 0),
        isInGameInjury: Boolean(row.isInGameInjury),
        isInGameReturned: Boolean(row.isInGameReturned),
        topItem
      });
    }
  }

  // Strictly sort from lowest to highest play likelihood (tie-break by cap/starter weight)
  entries.sort(
    (a, b) =>
      a.playProbabilityPct - b.playProbabilityPct ||
      b.capHit2026 - a.capHit2026 ||
      a.name.localeCompare(b.name)
  );

  return entries;
}
