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

import { isPaywalledPublisher, sanitizeExternalUrl, buildEspnPlayerNewsAnchorUrl } from './linkIntegrity.js';
import {
  buildXPlayerScoopSearchUrl,
  extractBeatAttributionFromText,
  isDirectSocialPostUrl,
  resolveItemAuthorProfileUrl,
  resolveOriginalTweetUrl,
  resolveReporterFromNameOrHandle
} from './beatAttributionEngine.js';

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

const AMBIGUOUS_CLAUSE_SURNAMES = new Set([
  'west',
  'green',
  'white',
  'brown',
  'black',
  'young',
  'long',
  'short',
  'hill',
  'hall',
  'king',
  'ward',
  'cook',
  'ford',
  'bell',
  'gray',
  'wood',
  'park',
  'james',
  'kirk',
  'jones',
  'allen',
  'williams',
  'robinson',
  'evans',
  'neal'
]);

/**
 * Checks whether a single clause/sentence mentions `playerName` (handling dotted/dotless initials like
 * `C.J. West` <-> `CJ West`, suffixes like `Deebo Samuel Sr.` <-> `Deebo Samuel`, nicknames like `Deebo` / `CMC`,
 * and unambiguous surnames when `allowSurname` is enabled).
 */
export function doesClauseMentionPlayer(clauseText = '', playerName = '', { allowSurname = true } = {}) {
  const rawClause = String(clauseText || '').replace(/[’‘]/g, "'");
  const rawPlayer = String(playerName || '').replace(/[’‘]/g, "'").trim();
  if (!rawClause || !rawPlayer) return false;

  const clauseNorm = collapseInitialDots(rawClause).toLowerCase();
  const fullStripped = stripGenerationalSuffix(rawPlayer);
  const fullCollapsed = collapseInitialDots(fullStripped).toLowerCase();
  const fullRawLower = fullStripped.toLowerCase();

  if (fullRawLower.length >= 4 && new RegExp(`(?<![a-z0-9])${escapeRegexLiteral(fullRawLower)}(?![a-z0-9])`, 'i').test(rawClause.toLowerCase())) {
    return true;
  }
  if (fullCollapsed.length >= 4 && new RegExp(`(?<![a-z0-9])${escapeRegexLiteral(fullCollapsed)}(?![a-z0-9])`, 'i').test(clauseNorm)) {
    return true;
  }
  if (/^deebo samuel\b/i.test(fullStripped) && /\bdeebo\b/i.test(clauseNorm)) {
    return true;
  }
  if (/^christian mccaffrey$/i.test(fullStripped) && /\bcmc\b/i.test(clauseNorm)) {
    return true;
  }

  if (allowSurname) {
    const parts = fullCollapsed.split(/\s+/).filter(Boolean);
    const surname = parts[parts.length - 1] || '';
    if (surname.length >= 4) {
      // Allow surname even for common words ONLY when followed by injury parenthetical like "West (knee)" or "Green (back)" or preceded by WR/CB/DT/LB/RB/DE/OT/QB/TE/S
      const posOrInjContextRe = new RegExp(
        `(?:\\b(?:qb|rb|fb|wr|te|ot|og|ol|dt|de|dl|nt|lb|cb|db|saf)s?\\s+${escapeRegexLiteral(surname)}\\b|\\b${escapeRegexLiteral(surname)}\\s*\\([a-z /,-]{3,28}\\))`,
        'i'
      );
      if (posOrInjContextRe.test(clauseNorm)) return true;

      if (!AMBIGUOUS_CLAUSE_SURNAMES.has(surname)) {
        // Ensure surname isn't attached to a DIFFERENT first name (e.g., "Trent Williams" vs "Mykel Williams")
        const targetFirst = parts[0] || '';
        const surnameWithPrecedingWord = clauseNorm.match(
          new RegExp(`(?:([a-z.'-]{2,})\\s+)?\\b${escapeRegexLiteral(surname)}\\b`, 'i')
        );
        if (surnameWithPrecedingWord) {
          const prevWord = (surnameWithPrecedingWord[1] || '').toLowerCase().replace(/\./g, '');
          const nonFirstNameStopwords = new Set([
            'wr', 'rb', 'qb', 'te', 'dt', 'de', 'dl', 'lb', 'cb', 'db', 'ot', 'og', 'ol', 'fb',
            'coach', 'per', 'for', 'with', 'that', 'while', 'and', 'or', 'neither', 'nor', 'get',
            'have', 'expecting', 'expect', 'said', 'veteran', 'rookie', 'starter', 'fellow', 'wideout',
            'receiver', 'cornerback', 'tackle', 'linebacker', 'safety', 'defender', 'lineman'
          ]);
          const looksLikeDifferentCapitalizedFirstName = (() => {
            const capMatch = rawClause.match(
              new RegExp(`\\b([A-Z][a-z.'-]{1,})\\s+${escapeRegexLiteral(parts[parts.length - 1])}\\b`)
            );
            if (!capMatch) return false;
            const foundFirst = collapseInitialDots(capMatch[1]).toLowerCase().replace(/\./g, '');
            if (nonFirstNameStopwords.has(foundFirst)) return false;
            return foundFirst !== targetFirst.replace(/\./g, '');
          })();
          if (!looksLikeDifferentCapitalizedFirstName) {
            return true;
          }
        }
      }
    }
  }
  return false;
}

/**
 * Scopes multi-sentence / multi-player beat notes or tweets to ONLY the clauses pertaining to `targetPlayerName`,
 * preventing cross-player signal bleed (e.g., `"Shanahan said he's hopeful to get Deebo Samuel and CJ West back
 * to practice on Wednesday. The team is not expecting Mike Evans this week."`).
 */
export function scopeBeatTextToPlayer(rawText = '', targetPlayerName = '', rosterPlayerNames = []) {
  const text = String(rawText || '').trim();
  const target = String(targetPlayerName || '').trim();
  if (!text || !target) return text;

  const sentences = text
    .split(/(?<=[.!?])\s+|\s*[;\n]+\s*|\b(?=[Ww]hile\s+[A-Z]|[Ww]hereas\s+[A-Z]|[Mm]eanwhile,?\s+|[Oo]n the plus side\b|[Ii]n any case,?\s+)/)
    .map(s => s.trim())
    .filter(Boolean);

  const candidateOthers = [
    ...new Set([
      ...Object.keys(CURATED_NFL_PLAYER_PRIORS),
      ...(rosterPlayerNames || [])
    ])
  ].filter(n => n && stripGenerationalSuffix(n).toLowerCase() !== stripGenerationalSuffix(target).toLowerCase());

  const mentionsOtherNamedPlayer = clause => {
    // Fast check for explicit teammate transition phrases or other roster names
    if (/\bfellow\s+(?:wr|rb|te|cb|dt|de|dl|lb|ol|ot|s|qb)s?\b/i.test(clause) && !doesClauseMentionPlayer(clause, target)) {
      return true;
    }
    for (const other of candidateOthers) {
      if (doesClauseMentionPlayer(clause, other, { allowSurname: false })) return true;
    }
    // Also detect capitalized "First Last (injury)" or "WR First Last" for non-target players
    const explicitOtherMatches = [
      ...clause.matchAll(/\b([A-Z][a-z'.-]+\s+[A-Z][a-z'.-]+)\s*(?:\([a-zA-Z /,-]{3,24}\))?/g)
    ];
    const targetCollapsed = collapseInitialDots(stripGenerationalSuffix(target)).toLowerCase();
    const nonPlayerPairs = new Set([
      'san francisco', 'las vegas', 'dallas cowboys', 'los angeles', 'green bay', 'tampa bay',
      'new orleans', 'new england', 'new york', 'kansas city', 'kyle shanahan', 'john lynch',
      'matt barrows', 'matt maiocco', 'nick wagoner', 'david lombardi', 'cam inman', 'eric branch',
      'vic tafur', 'sam warren', 'adam schefter', 'ian rapoport', 'tom pelissero', 'mike garafolo',
      'injured reserve', 'practice squad', 'head coach', 'bay area', 'nfl network', 'the athletic'
    ]);
    for (const m of explicitOtherMatches) {
      const pair = collapseInitialDots(m[1]).toLowerCase();
      if (nonPlayerPairs.has(pair)) continue;
      if (pair !== targetCollapsed && !targetCollapsed.includes(pair) && !pair.includes(targetCollapsed)) {
        if (/\([a-z /,-]{3,24}\)|\b(?:wr|rb|te|cb|dt|de|lb|qb|ot|saf)\b/i.test(m[0]) || /\b(?:expecting|ruled out|sidelined|placed on|need surgery|miss)\b/i.test(clause)) {
          return true;
        }
      }
    }
    return false;
  };

  const kept = [];
  let activeSubjectIsTarget = false;
  let anyTargetMentioned = false;

  for (const sent of sentences) {
    // Also split compound contrast clauses inside a sentence when different players are on each side
    const parts = sent
      .split(/,\s*(?=(?:[Ww]hile|[Ww]hereas|[Bb]ut|[Tt]hough|[Aa]lthough)\s+(?:(?:fellow|WR|RB|CB|DT|DE|LB|TE|QB|OT|OL|DL|S)\s+)?[A-Z])/)
      .map(p => p.trim())
      .filter(Boolean);

    for (const clause of parts) {
      const hasTarget = doesClauseMentionPlayer(clause, target);
      const hasOther = mentionsOtherNamedPlayer(clause);

      if (hasTarget) {
        kept.push(clause);
        activeSubjectIsTarget = true;
        anyTargetMentioned = true;
      } else if (hasOther) {
        activeSubjectIsTarget = false;
      } else if (activeSubjectIsTarget) {
        kept.push(clause);
      }
    }
  }

  if (anyTargetMentioned) {
    return kept.join(' ');
  }
  // If no competing player was named anywhere in `text`, preserve `text` (standalone single-player note)
  const anyOtherAnywhere = sentences.some(s => mentionsOtherNamedPlayer(s));
  return anyOtherAnywhere ? '' : text;
}

function hasAffirmativeRuledOutSignal(beatNote = '') {
  if (!beatNote) return false;
  if (/\bplaced on injured reserve\b/i.test(beatNote)) return true;
  if (/\bruled out\b/i.test(beatNote) && !/\b(?:not|n't|hasn't been|has not been|haven't|never|neither\b[^.;]{0,45})\s*(?:been\s+)?ruled out\b/i.test(beatNote)) {
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

function hasNegativePlayConsensusSignal(beatNote = '') {
  if (!beatNote) return false;
  return /\b(?:long shot|unlikely to (?:play|suit up|be activated)|(?:not|n't|no longer|hardly)\s+(?:expected to (?:play|suit up|be ready|be activated)|expecting\b[^.;]{0,42}\b(?:this week|to play|to be ready|to suit up)|on track to (?:play|suit up)|likely to (?:play|be activated)|good to go))\b/i.test(
    beatNote
  );
}

function hasNegativePracticeExpectationSignal(beatNote = '') {
  if (!beatNote) return false;
  return /\b(?:unlikely to (?:participate in |take part in )?practice|(?:not|n't)\s+expected to (?:participate in |take part in )?practice|won't (?:take part in |participate in )?practice|will not (?:participate in |take part in )?practice|questionable at best|still on hold)\b/i.test(
    beatNote
  );
}

function hasExpectedPracticeReturnSignal(beatNote = '') {
  if (!beatNote || hasNegativePlayConsensusSignal(beatNote) || hasNegativePracticeExpectationSignal(beatNote)) {
    return false;
  }
  // Reject vague/speculative phrasing ("getting close", "could return", "might practice")
  if (/\b(?:could|might|may|possibly|perhaps|wonder if|getting close)\b[^.;]{0,28}\b(?:return|back|practice|open)\b/i.test(beatNote)) {
    return false;
  }
  return /\b(?:hopeful to (?:get|have)\b[^.;]{0,55}\bback (?:to|at) practice|expect(?:s|ed|ing)?\b[^.;]{0,55}\b(?:to be )?back (?:to|at) practice|on track to return to practice|hopes? to have\b[^.;]{0,45}\b(?:back )?at practice|expected back\b[^.;]{0,25}(?:at practice|wednesday|this week)|(?:plan|plans|planning|expect|expects|expecting|set|slated)\s+to\s+open\b[^.;]{0,55}\bpractice window)\b/i.test(
    beatNote
  );
}

function hasAffirmativePlayOrActivationSignal(beatNote = '') {
  if (!beatNote || hasNegativePlayConsensusSignal(beatNote)) return false;
  return /\b(?:expected to play|on track to play|expected to suit up|likely will be activated|expected to be activated)\b/i.test(
    beatNote
  );
}

const VERIFIED_TIER1_REPORTER_NAMES_RE =
  /\b(matt barrows|matt maiocco|nick wagoner|david lombardi|cam inman|eric branch|vic tafur|jennifer lee chan|sam warren|noah furtado|harrison rich|adam schefter|ian rapoport|tom pelissero|mike garafolo|jeremy fowler|briana jeannel)\b/i;

const SPECULATIVE_CLAUSE_GUARD_RE =
  /\b(could activate|might activate|could return|might return|wonder if|speculat|rumor|my guess|would make sense|should consider|shouldn't rush|why the 49ers|if he (?:can't|cannot|is forced|misses)|candidates? to (?:see|draw|replace)|in line for more|fantasy|waiver wire|start\/sit|lineup)\b/i;

function canonicalReporterDedupeKey(item = {}, clauseText = '') {
  const inlineMatch = String(clauseText || item?.fullText || item?.title || '').match(VERIFIED_TIER1_REPORTER_NAMES_RE);
  if (inlineMatch) {
    return inlineMatch[1].toLowerCase().replace(/\s+/g, '_');
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
 * Evaluates recent news/beat items for a specific player using:
 *  1. Strict post-prior-game recency window (`windowStartMs`, max 5 days)
 *  2. Clause-level per-player scoping (`scopeBeatTextToPlayer`) so multi-player tweets never cross-contaminate
 *  3. Source reliability weighting + speculation rejection (`trustTier >= 3` or speculative modals = 0 weight)
 *  4. Reporter-level deduplication (so aggregator echoes of one beat writer count once, not 3x)
 *  5. Diminishing-returns Bayesian confidence `1 - Π(1 - w_i)` so one tweet never overcorrects
 */
export function evaluateCorroboratedNewsInjurySignal({
  playerName = '',
  rosterBucket = 'active',
  newsItems = [],
  rosterPlayerNames = [],
  nowMs = Date.now(),
  windowStartMs = null
} = {}) {
  const empty = {
    hasSignal: false,
    signalType: null,
    direction: 0,
    confidence: 0,
    corroboratingCount: 0,
    hasCoachOrGmQuote: false,
    hasOfficialTxDesignation: false,
    leadClause: '',
    reporters: []
  };
  if (!playerName || !Array.isArray(newsItems) || newsItems.length === 0) return empty;

  const fiveDaysAgoMs = nowMs - 5 * 86_400_000;
  const minMs = Number.isFinite(windowStartMs) && windowStartMs > 0 ? Math.max(fiveDaysAgoMs, windowStartMs) : fiveDaysAgoMs;

  const observationsByReporter = new Map();
  let hasOfficialTxDesignation = false;

  for (const item of newsItems) {
    if (!item || item.isClickbait || item.type === 'video') continue;
    const pubMs = parseFlexibleIsoMs(item.publishedAt);
    if (pubMs === null || pubMs < minMs || pubMs > nowMs + 3_600_000) continue;

    const primaryLead = String(item.fullText || item.title || item.headline || '').trim();
    const secondarySummary = String(item.summary || '').trim();
    const fullBody =
      secondarySummary &&
      (!primaryLead || !primaryLead.toLowerCase().includes(secondarySummary.toLowerCase().slice(0, 32)))
        ? [primaryLead, secondarySummary].filter(Boolean).join(' ').trim()
        : primaryLead;
    if (!fullBody) continue;

    // Must actually mention this player (via structured mentionedPlayers or text match)
    const inMentionedList =
      Array.isArray(item.mentionedPlayers) &&
      item.mentionedPlayers.some(
        mp => stripGenerationalSuffix(mp?.name || '').toLowerCase() === stripGenerationalSuffix(playerName).toLowerCase()
      );
    if (!inMentionedList && !doesClauseMentionPlayer(fullBody, playerName)) {
      continue;
    }

    // Check official @49ers transaction wire or verified Tier-1 beat report for immediate 21-day return designation
    const trustTierProbe = Number(item.trustTier || 2);
    const hasInlineTier1Probe = VERIFIED_TIER1_REPORTER_NAMES_RE.test(fullBody);
    const isOfficialSourceProbe = item.outletId === '49ers_official' || item.wireSource === 'official_transactions';
    if (
      (isOfficialSourceProbe || trustTierProbe <= 1 || hasInlineTier1Probe) &&
      /\b(?:designated\b[^.]{0,80}\bto return from (?:injured reserve|the pup list)|opened (?:the )?(?:[a-z']+s? )?(?:21-day |injured reserve |ir |pup )?practice window)\b/i.test(
        fullBody
      ) &&
      doesClauseMentionPlayer(fullBody, playerName)
    ) {
      const scopedForWindow = scopeBeatTextToPlayer(fullBody, playerName, rosterPlayerNames);
      if (
        scopedForWindow &&
        /\b(?:designated\b[^.]{0,80}\bto return|opened (?:the )?(?:[a-z']+s? )?(?:21-day |injured reserve |ir |pup )?practice window)\b/i.test(
          scopedForWindow
        ) &&
        !/\b(?:not|n't|could|might|may|hopeful to|plan to|expect to)\s+open\b/i.test(scopedForWindow)
      ) {
        hasOfficialTxDesignation = true;
      }
    }

    const scoped = scopeBeatTextToPlayer(fullBody, playerName, rosterPlayerNames);
    if (!scoped) continue;

    // Speculation & low-credibility guard: reject blogs/opinion/rumors unless directly citing a verified Tier-1 beat reporter
    const trustTier = trustTierProbe;
    const hasInlineTier1 = hasInlineTier1Probe;
    const isOfficialSource = isOfficialSourceProbe;
    if (trustTier >= 3 && !hasInlineTier1 && !isOfficialSource) {
      continue;
    }

    const hasCoachQuote =
      /\b(?:kyle shanahan|coach shanahan|shanahan|head coach|john lynch|gm john lynch)\b[^.]{0,75}\b(?:said|says|relayed|explained|announced|indicated|noted|told|expects?|hopeful)\b|\b(?:coach kyle shanahan|shanahan|john lynch)\s+said\b|\bper (?:coach )?(?:kyle )?shanahan\b/i.test(
        scoped
      ) ||
      (/\b(?:shanahan|john lynch)\s+said\b/i.test(fullBody) && !SPECULATIVE_CLAUSE_GUARD_RE.test(scoped));

    if (!hasCoachQuote && SPECULATIVE_CLAUSE_GUARD_RE.test(scoped)) {
      continue;
    }

    let signalType = null;
    let direction = 0;

    const hasObservedNonPractice =
      /\b(?:not practicing(?:\s+today)?|did not practice|didn't practice|non-participant|not participating|no practice for|was an observer|watching from the sideline)\b/i.test(
        scoped
      );
    const hasObservedPracticeReturn =
      !hasObservedNonPractice &&
      /\b(?:limited (?:today )?(?:at|in) [a-z']*\s*practice|limited practice participant|limited participant|practiced on a limited basis|back on the practice field|practiced in full|full participant)\b/i.test(
        scoped
      );

    if (hasAffirmativeRuledOutSignal(scoped)) {
      signalType = 'RULED_OUT_WEEK';
      direction = -1.0;
    } else if (hasNegativePlayConsensusSignal(scoped)) {
      signalType = 'UNLIKELY_THIS_WEEK';
      direction = -0.82;
    } else if (hasObservedNonPractice) {
      signalType = 'OBSERVED_DNP_PRACTICE';
      direction = -0.62;
    } else if (hasNegativePracticeExpectationSignal(scoped)) {
      signalType = 'UNLIKELY_WEDNESDAY_PRACTICE';
      direction = -0.58;
    } else if (hasAffirmativePlayOrActivationSignal(scoped)) {
      signalType = 'EXPECTED_TO_PLAY';
      direction = 0.80;
    } else if (hasObservedPracticeReturn) {
      signalType = 'OBSERVED_PRACTICE_RETURN';
      direction = 0.66;
    } else if (hasExpectedPracticeReturnSignal(scoped)) {
      signalType = 'EXPECTED_PRACTICE_RETURN';
      direction = 0.58;
    } else if (
      rosterBucket === 'active' &&
      /\b(?:considered day-to-day|is day-to-day|neither has been ruled out|hasn't been ruled out|has not been ruled out)\b/i.test(
        scoped
      )
    ) {
      signalType = 'DAY_TO_DAY';
      direction = 0.25;
    }

    if (!signalType) continue;

    let baseWeight = 0.18;
    if (isOfficialSource) {
      baseWeight = 0.90;
    } else if (trustTier <= 1 || hasInlineTier1) {
      baseWeight = hasCoachQuote ? 0.60 : 0.40;
    } else if (trustTier === 2) {
      baseWeight = hasCoachQuote ? 0.36 : 0.18;
    }

    const repKey = canonicalReporterDedupeKey(item, fullBody);
    const prev = observationsByReporter.get(repKey);
    if (!prev || pubMs > prev.pubMs || (pubMs === prev.pubMs && baseWeight > prev.weight)) {
      const samePolarityAsPrev = prev && Math.sign(prev.direction) === Math.sign(direction);
      observationsByReporter.set(repKey, {
        repKey,
        reporterLabel: item.author || item.reporterName || item.outletName || '49ers Beat',
        signalType: samePolarityAsPrev && prev.weight > baseWeight ? prev.signalType : signalType,
        direction: samePolarityAsPrev && Math.abs(prev.direction) > Math.abs(direction) ? prev.direction : direction,
        weight: samePolarityAsPrev ? Math.max(baseWeight, prev.weight) : baseWeight,
        hasCoachQuote: samePolarityAsPrev ? Boolean(hasCoachQuote || prev.hasCoachQuote) : hasCoachQuote,
        pubMs,
        scopedClause: samePolarityAsPrev && prev.hasCoachQuote && !hasCoachQuote ? prev.scopedClause : scoped
      });
    }
  }

  const obsList = [...observationsByReporter.values()].sort((a, b) => b.pubMs - a.pubMs);
  if (obsList.length === 0) {
    return hasOfficialTxDesignation
      ? { ...empty, hasSignal: true, signalType: 'OFFICIAL_IR_WINDOW_OPEN', direction: 0.65, confidence: 0.95, hasOfficialTxDesignation: true }
      : empty;
  }

  const newestPubMs = obsList[0].pubMs;
  const newestSign = Math.sign(obsList[0].direction);

  // Decay older reports (>6h older) if newer reporting has reversed polarity (e.g., Mon "hopeful" -> Thu "unlikely")
  let posRemaining = 1.0;
  let negRemaining = 1.0;
  let weightedDirSum = 0;
  let totalWeight = 0;

  for (const obs of obsList) {
    let effW = obs.weight;
    if (newestPubMs - obs.pubMs > 6 * 3_600_000 && Math.sign(obs.direction) !== newestSign) {
      effW *= 0.25;
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
  const confidence = Math.max(0, Math.min(0.92, rawConf - opposingConf * 0.65));

  // Pick dominant signalType matching net polarity
  const matchingObs = obsList.filter(o => Math.sign(o.direction) === dominantSign);
  const primaryObs =
    matchingObs.sort((a, b) => Math.abs(b.direction) * b.weight - Math.abs(a.direction) * a.weight || b.pubMs - a.pubMs)[0] ||
    obsList[0];

  return {
    hasSignal: confidence >= 0.12 || hasOfficialTxDesignation,
    signalType: primaryObs.signalType,
    direction: Number(netDirection.toFixed(3)),
    confidence: Number(confidence.toFixed(3)),
    corroboratingCount: matchingObs.length,
    hasCoachOrGmQuote: matchingObs.some(o => o.hasCoachQuote),
    hasOfficialTxDesignation,
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
      /\b(?:sidelined previously|missed (?:sunday|monday|thursday|saturday|last week)|missing a (?:second|third|fourth) straight|miss his (?:second|third|fourth) straight)\b/i.test(
        noteLower
      ))
  ) {
    missedPriorGame = true;
    consecutiveMissedGames = Math.max(1, consecutiveMissedGames);
  }

  if (
    /\b(?:second straight|third straight|fourth straight|consecutive (?:games|contests)|last (?:two|three|four|five) (?:games|contests))\b/i.test(
      noteLower
    )
  ) {
    consecutiveMissedGames = Math.max(2, consecutiveMissedGames);
  }

  if (priorWeekPracticed === null && missedPriorGame) {
    if (/\b(?:trio of limited practices|limited practices during the week|limited all week|practiced on a limited basis)\b/i.test(noteLower)) {
      priorWeekPracticed = true;
    } else if (
      /\b(?:hasn't been able to practice|has not been able to practice|trio of '?dnps?'?|did not practice all week|not practicing in any capacity|hasn't practiced)\b/i.test(
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
  const inj = String(injuryType || '').toLowerCase();
  if (!s || s === '-' || s === 'n/a') return 'NONE';
  if (s === 'fp' || s.includes('full')) return 'FP';
  if (s === 'lp' || s.includes('limited')) return 'LP';
  if (
    s === 'vet rest' ||
    s === 'rest' ||
    s === 'dnp_rest' ||
    s.includes('rest') ||
    inj.includes('rest') ||
    inj.includes('not injury related')
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
  nowMs = Date.now()
} = {}) {
  const combined = `${shortComment || ''} ${longComment || ''}`.trim();
  const lower = combined.toLowerCase();
  const stLower = String(statusRaw || '').toLowerCase().trim();
  const injLower = String(injuryType || '').toLowerCase().trim();
  const isRest = injLower.includes('rest') || injLower.includes('not injury related') || /\brest\b/.test(lower);

  const slashMatch = combined.match(/\b(DNP|LP|FP)\s*\/\s*(DNP|LP|FP)\s*\/\s*(DNP|LP|FP)\b/i);
  if (slashMatch) {
    return {
      wed: slashMatch[1].toUpperCase(),
      thu: slashMatch[2].toUpperCase(),
      fri: slashMatch[3].toUpperCase()
    };
  }

  const detectDay = dayRegex => {
    const statusExpr =
      "(did not practice|didn't practice|did not participate|not practicing|not participating|non-participant|no practice|was an observer|observer for|observer at|sidelined|sat out|limited practice participant|limited participant|limited participation|limited practice|limited session|limited in practice|limited at practice|limited on|was limited|practiced in a limited capacity|practiced on a limited basis|full practice participant|full participant|full participation|full practice|practiced in full|full session)";
    const m1 = lower.match(new RegExp(`${statusExpr}[^.;]{0,52}${dayRegex}`, 'i'));
    const m2 = lower.match(new RegExp(`${dayRegex}[^.;]{0,44}${statusExpr}`, 'i'));
    const fullSpan = (m1?.[0] || m2?.[0] || '').toLowerCase();
    const matchIdx = m1?.index ?? m2?.index ?? -1;
    const prefixWindow = matchIdx >= 0 ? lower.slice(Math.max(0, matchIdx - 42), matchIdx) : '';
    if (
      /\b(?:unlikely\s+to\s+be|likely\s+to\s+be|more\s+than\s+a|opportunities\s+to|opportunity\s+to|hoping\s+to\s+be|hope(?:s|ful)?\s+to|expect(?:s|ed|ing)?\s+to\s+be|could\s+be\s+a|might\s+be\s+a)\b/i.test(
        `${prefixWindow} ${fullSpan}`
      )
    ) {
      return null;
    }
    const phrase = (m1?.[1] || m2?.[1] || '').toLowerCase();
    if (!phrase) return null;
    if (phrase.includes('full')) return 'FP';
    if (phrase.includes('limited')) return 'LP';
    if (
      phrase.includes('did not') ||
      phrase.includes("didn't") ||
      phrase.includes('not practic') ||
      phrase.includes('not participat') ||
      phrase.includes('no practice') ||
      phrase.includes('observer') ||
      phrase.includes('non-') ||
      phrase.includes('sidelined') ||
      phrase.includes('sat out')
    ) {
      return isRest ? 'Vet Rest' : 'DNP';
    }
    return null;
  };

  let wed = detectDay('wednesday');
  let thu = detectDay('thursday');
  let fri = detectDay('friday');

  if (/did not practice all week|missed all three practices|missing practice all week|trio of '?dnps?'?/i.test(lower)) {
    wed = wed || 'DNP';
    thu = thu || 'DNP';
    fri = fri || 'DNP';
  } else if (/limited (?:participant )?(?:in practice )?all week|limited wednesday through friday|three limited (?:sessions|practices)|trio of limited practices/i.test(lower)) {
    wed = wed || 'LP';
    thu = thu || 'LP';
    fri = fri || 'LP';
  } else if (/full participant all week|practiced in full all week/i.test(lower)) {
    wed = wed || 'FP';
    thu = thu || 'FP';
    fri = fri || 'FP';
  }

  // Calendar-aware future-day guard when upcoming `kickoffIso` is supplied
  const koMs = kickoffIso ? Date.parse(kickoffIso) : NaN;
  const ts = Number.isFinite(nowMs) ? nowMs : Date.now();
  if (Number.isFinite(koMs) && ts < koMs) {
    const koPt = extractPtDayMeta(koMs);
    const nowPt = extractPtDayMeta(ts);
    const leadDays = koPt.weekday === 'Thu' ? 3 : 4; // Practice Day 1 = leadDays before game
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
  /\b(?:expect(?:s|ed|ing)?\b[^.;]{0,55}\b(?:back|at|to)\s+practice|hopeful\b[^.;]{0,55}\bpractice|hopes?\s+to\b[^.;]{0,45}\bpractice|plan(?:s|ning)?\s+to\s+(?:practice|open)|will\s+(?:practice|be\s+limited|not\s+practice)\s+(?:wednesday|thursday|friday|tomorrow)|should\s+(?:give|provide|shed)\b[^.;]{0,55}\b(?:report|context|insight)|worth\s+(?:keeping\s+an\s+eye|monitoring)\b[^.;]{0,65}\bpractice|unlikely\s+to\s+(?:participate\s+in\s+|be\b[^.;]{0,40}\b)?(?:practice|participant)|(?:appears?|seems?)\s+(?:unlikely|likely)\s+to\s+be\b|(?:anything|nothing)\s+more\s+than\s+a\s+limited|opportunities\s+to\s+practice|could\s+return\s+to\s+practice|might\s+practice)\b/i;

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
    if (koWeekday === 'Thu') {
      if (wd === 'mon') return 'wed';
      if (wd === 'tue') return 'thu';
      if (wd === 'wed') return 'fri';
    } else if (koWeekday === 'Sat') {
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
    /\b(?:practice[d]?|participat(?:e|ed|ing|ion)|limited|session|report|dnp|non-participant|observer|sidelined|sat out)\b[^.;]{0,36}\b(wednesday|thursday|friday|monday|tuesday|saturday)\b|\b(wednesday|thursday|friday|monday|tuesday|saturday)(?:'s)?\s+(?:practice|session|walkthrough|injury report|pre[- ]practice)/i
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
    const leadDays = koPt.weekday === 'Thu' ? 3 : 4;
    const diff = koPt.dayIndex - stampDayIdx;
    if (diff === leadDays) return 'wed';
    if (diff === leadDays - 1) return 'thu';
    if (diff === leadDays - 2) return 'fri';
  }

  // Fallback to UTC timestamp offset before kickoff (timezone-agnostic: covers Melbourne, London, ET, CT, PT!)
  if (Number.isFinite(publishedAtMs) && Number.isFinite(koMs) && publishedAtMs < koMs) {
    const koPt = extractPtDayMeta(koMs);
    const pubPt = extractPtDayMeta(publishedAtMs);
    const leadDays = koPt.weekday === 'Thu' ? 3 : 4;
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

function extractParentheticalInjuryForPlayer(text = '', playerName = '') {
  if (!text || !playerName) return '';
  const stripped = stripGenerationalSuffix(playerName);
  const surname = stripped.split(/\s+/).filter(Boolean).pop() || '';
  const candidates = [stripped, collapseInitialDots(stripped), surname].filter(s => s && s.length >= 3);
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
  if (!Array.isArray(newsItems) || newsItems.length === 0 || !Array.isArray(rosterPlayers) || rosterPlayers.length === 0) {
    return updatesByPlayerId;
  }

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
    const hasInlineTier1 = VERIFIED_TIER1_REPORTER_NAMES_RE.test(fullBody);
    const isOfficial = item.outletId === '49ers_official' || item.wireSource === 'official_transactions';
    const isPlayerWire = item.wireSource === 'espn_player_wire' || item.wireSource === 'rotowire_rss' || item.wireSource === 'bsky_mirror';
    if (trustTier >= 3 && !hasInlineTier1 && !isOfficial && !isPlayerWire) continue;

    eligibleItems.push({ item, pubMs, fullBody, isOfficial, priorityRank: isOfficial ? 2 : 1 });
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
  const koLeadDays =
    Number.isFinite(koMsForGuard) && extractPtDayMeta(koMsForGuard).weekday === 'Thu' ? 3 : 4;

  const recordSlotCode = (p, slot, code, injHint, noteText, pubMs, sideField = false) => {
    if (!p || !slot || !code) return;
    // Strict calendar causality guard: an article/tweet published before a practice day occurs
    // cannot log actual participation for that future day (allows 16h ahead-of-PT buffer for Melbourne/London)
    if (Number.isFinite(koMsForGuard)) {
      const refMs = Number.isFinite(pubMs) && pubMs > 0 ? Math.min(pubMs, nowMs) : nowMs;
      if (refMs < koMsForGuard) {
        const hoursBeforeKo = (koMsForGuard - refMs) / 3_600_000;
        if (slot === 'wed' && hoursBeforeKo > koLeadDays * 24 + 18) return;
        if (slot === 'thu' && hoursBeforeKo > (koLeadDays - 1) * 24 + 16) return;
        if (slot === 'fri' && hoursBeforeKo > (koLeadDays - 2) * 24 + 16) return;
      }
    }
    const rec = ensureEntry(p);
    const isRest =
      /not injury related|\brest\b/i.test(injHint || '') ||
      /not injury related|\brest\b/i.test(p.health?.injuryType || '');
    const finalCode = code === 'DNP' && isRest ? 'Vet Rest' : code;
    rec[slot] = finalCode;
    if (injHint && !rec.injuryType) rec.injuryType = injHint;
    if (sideField) rec.hasSideFieldRehab = true;
    if (pubMs >= rec.latestPubMs && noteText) {
      rec.latestPubMs = pubMs;
      rec.latestNote = noteText;
    }
  };

  const matchPlayersInSegment = (segmentText, { allowSurname = true } = {}) => {
    const matched = [];
    for (const p of rosterPlayers) {
      if (doesClauseMentionPlayer(segmentText, p.name, { allowSurname })) {
        matched.push(p);
      }
    }
    return matched;
  };

  const STRUCTURED_HEADER_TOKEN_RE =
    /\b(not participating|did not participate|did not practice|non-participants?|dnp\s*:|no practice(?:\s+for)?\s*:|limited(?:\s+participants?|\s+participation)?\s*(?::|(?=(?:qb|rb|fb|wr|te|ol|ot|og|dl|dt|de|nt|lb|cb|db|s|saf|k|p|ls)s?\s+[A-Z]))|lp\s*:|full(?:\s+participants?|\s+participation)?\s*(?::|(?=(?:qb|rb|fb|wr|te|ol|ot|og|dl|dt|de|nt|lb|cb|db|s|saf|k|p|ls)s?\s+[A-Z]))|fp\s*:)/gi;

  for (const { fullBody, pubMs } of eligibleItems) {
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
          for (const p of matchPlayersInSegment(ws)) {
            const rec = ensureEntry(p);
            rec.openedPracticeWindow = true;
            const inj = extractParentheticalInjuryForPlayer(ws, p.name);
            if (inj && !rec.injuryType) rec.injuryType = inj;
          }
        }
      }
    }

    if (!slot) continue;

    // 2. Check structured beat practice-report list format (e.g., "Not participating WR Mike Evans ... Limited WR Deebo Samuel ...")
    const headerMatches = [...fullBody.matchAll(STRUCTURED_HEADER_TOKEN_RE)];
    if (headerMatches.length >= 2) {
      for (let idx = 0; idx < headerMatches.length; idx++) {
        const hdrRaw = headerMatches[idx][0].toLowerCase();
        const segStart = headerMatches[idx].index + headerMatches[idx][0].length;
        const segEnd = idx + 1 < headerMatches.length ? headerMatches[idx + 1].index : fullBody.length;
        const segBody = fullBody.slice(segStart, segEnd).trim();
        let segCode = null;
        if (/^(?:full|fp)/.test(hdrRaw)) segCode = 'FP';
        else if (/^(?:limited|lp)/.test(hdrRaw)) segCode = 'LP';
        else segCode = 'DNP';

        for (const p of matchPlayersInSegment(segBody)) {
          const inj = extractParentheticalInjuryForPlayer(segBody, p.name);
          recordSlotCode(p, slot, segCode, inj, fullBody, pubMs, false);
        }
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
      const sentPlayers = matchPlayersInSegment(sent);
      const subClauses = sent
        .split(/,\s*(?=(?:while|whereas|but|though|although)\s+)/i)
        .map(c => c.trim())
        .filter(Boolean);

      const hasSideFieldInSent = SIDE_FIELD_REHAB_OBSERVATION_RE.test(sent);

      for (const clause of subClauses) {
        if (FUTURE_PRACTICE_EXPECTATION_GUARD_RE.test(clause)) continue;

        let clausePlayers = matchPlayersInSegment(clause);
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
          /\b(?:not practicing(?:\s+today)?|are not practicing|is not practicing|did not practice|didn't practice|did not participate|not participating|non-participant|no practice for|was an observer|observer for|sat out\s+(?:practice|wednesday|thursday|friday|today)|sidelined\s+(?:at|for|in)\s+practice)\b/i.test(
            clause
          );
        const isLpClause =
          !isDnpClause &&
          /\b(?:is limited(?:\s+today)?(?:\s+at|\s+in)?\s*practice|was (?:a )?limited(?:\s+practice)?\s*participant|was limited\s+(?:in|at|on|wednesday|thursday|friday|today)|limited\s+(?:practice\s+)?participant|limited\s+participation|practiced\s+(?:on\s+a\s+limited\s+basis|in\s+a\s+limited\s+capacity)|logged\s+a\s+(?:limited|capped)\s+session|limited\s+today\s+at\s+practice)\b/i.test(
            clause
          );
        const isFpClause =
          !isDnpClause &&
          !isLpClause &&
          /\b(?:full\s+(?:practice\s+)?participant|practiced\s+in\s+full|full\s+participation\s+(?:in|at|on)|was\s+a\s+full\s+participant)\b/i.test(
            clause
          );

        const code = isDnpClause ? 'DNP' : isLpClause ? 'LP' : isFpClause ? 'FP' : null;
        if (code) {
          for (const cp of clausePlayers) {
            const inj =
              extractParentheticalInjuryForPlayer(clause, cp.name) ||
              extractParentheticalInjuryForPlayer(sent, cp.name);
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
    statusRaw === 'ir' ||
    statusRaw === 'injured reserve';

  const beatNoteSignalsQuestionableActivation =
    !hasNegativePlayConsensusSignal(beatNote) &&
    (beatNote.includes('listed as questionable') ||
      beatNote.includes('questionable for sunday') ||
      beatNote.includes('questionable ahead of') ||
      hasAffirmativePlayOrActivationSignal(beatNote));

  const wed = normalizePracticeCode(input.wed, injuryType);
  const thu = normalizePracticeCode(input.thu, injuryType);
  const fri = normalizePracticeCode(input.fri, injuryType);
  const hasObservedPracticeThisWeek = wed !== 'NONE' || thu !== 'NONE' || fri !== 'NONE';
  const hasMidWeekActivePractice =
    fri === 'NONE' && (wed === 'LP' || wed === 'FP' || thu === 'LP' || thu === 'FP');

  const affirmativeRuledOut =
    !hasMidWeekActivePractice &&
    (hasAffirmativeRuledOutSignal(beatNote) ||
      Boolean(newsSig && newsSig.signalType === 'RULED_OUT_WEEK' && newsSig.confidence >= 0.6));

  // 21-day practice window opened + officially Questionable (via explicit caller flag, official Questionable tag, or beat note)
  const isIrReturnQuestionable =
    !isSeasonEndingFlag &&
    !isRosterExemptionFlag &&
    !isReinstatementFlag &&
    !affirmativeRuledOut &&
    statusRaw !== 'out' &&
    statusRaw !== 'doubtful' &&
    (Boolean(input.isIrReturnQuestionable) ||
      (isIrBucketOrStatus && (statusRaw === 'questionable' || beatNoteSignalsQuestionableActivation)));

  if (
    !isIrReturnQuestionable &&
    (isSeasonEndingFlag ||
      isRosterExemptionFlag ||
      isReinstatementFlag ||
      rosterBucket === 'ir' ||
      rosterBucket === 'injuredreserveorout' ||
      rosterBucket === 'pup' ||
      rosterBucket === 'suspended' ||
      statusRaw === 'out' ||
      statusRaw === 'ir' ||
      statusRaw === 'injured reserve' ||
      statusRaw.includes('reserve / pup') ||
      statusRaw === 'pup' ||
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
    } else if (rosterBucket === 'pup' || statusRaw === 'pup' || statusRaw.includes('physically unable')) {
      badgeLabel = '0% • Reserve/PUP';
      factors.push('Reserve / Physically Unable to Perform — 21-day window required before activation');
    } else if (
      rosterBucket === 'ir' ||
      rosterBucket === 'injuredreserveorout' ||
      statusRaw === 'ir' ||
      statusRaw.includes('injured reserve')
    ) {
      badgeLabel = '0% • IR';
      factors.push('On Injured Reserve — requires 21-day window & 53-man activation');
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
  const isPureVetRest =
    injuryLower.includes('rest') ||
    injuryLower.includes('not injury related') ||
    (prior.isVeteranRestHabitual &&
      (wed === 'DNP_REST' || (wed === 'DNP' && (thu === 'FP' || fri === 'FP') && !injuryType)));

  if (isPureVetRest && statusRaw !== 'doubtful' && !hasNegativePlayConsensusSignal(beatNote)) {
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
  const clearedConcussion = hasClearedConcussionProtocolSignal(beatNote);

  const priorAbsence = derivePriorWeekAbsenceProfile({
    weeklyHistory: input.weeklyHistory,
    currentWeek: input.currentWeek,
    byeWeek: input.byeWeek,
    rawStatus: input.priorWeekStatus || '',
    beatNote
  });
  const missedPriorGame =
    input.missedPriorGame !== undefined ? Boolean(input.missedPriorGame) : priorAbsence.missedPriorGame;
  const consecutiveMissedGames =
    input.consecutiveMissedGames !== undefined
      ? Number(input.consecutiveMissedGames) || 0
      : priorAbsence.consecutiveMissedGames;
  const priorWeekPracticed =
    input.priorWeekPracticed !== undefined ? input.priorWeekPracticed : priorAbsence.priorWeekPracticed;
  const sustainedInLastGame =
    Boolean(input.sustainedInLastGame) ||
    (!missedPriorGame && /\b(?:considered day-to-day|is day-to-day|has not been ruled out|hasn't been ruled out)\b/i.test(beatNote));

  // 4. Base Probability from Game Designation, NFL 5-Step Concussion Protocol, or Practice Progression
  let prob = 0.78;

  if (statusRaw === 'doubtful') {
    prob = 0.10 + (prior.questionablePlayRate - 0.78) * 0.25;
    factors.push('Official Doubtful tag (NFL historical base ~10–14%)');
  } else if (
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
  } else {
    // Derive base from Wed/Thu/Fri practice progression (including trajectory directionality)
    if (fri === 'FP') {
      prob = 0.93;
      factors.push('Logged Full Participation (FP) on Friday');
    } else if (fri === 'LP') {
      if (wed === 'DNP' && thu === 'DNP') {
        prob = 0.56;
        factors.push('Late-week salvage (DNP/DNP/LP); requires pre-game warmup clearance');
      } else if (wed === 'FP' || thu === 'FP') {
        prob = Math.max(0.35, prior.questionablePlayRate - 0.14);
        factors.push('Late-week practice downgrade (FP earlier in week -> Friday LP); elevated flare-up caution');
      } else if (wed === 'DNP' && thu === 'LP') {
        prob = Math.min(0.89, prior.questionablePlayRate + 0.03);
        factors.push(
          `Positive upward rehab ramp (Wed DNP -> Thu LP -> Fri LP; base prior ${Math.round(prior.questionablePlayRate * 100)}%)`
        );
      } else {
        prob = prior.questionablePlayRate;
        factors.push(
          `Friday Limited (LP) — anchored to player Questionable play prior (${Math.round(prior.questionablePlayRate * 100)}%)`
        );
      }
    } else if (fri === 'DNP') {
      if (wed === 'LP' || thu === 'LP' || wed === 'FP' || thu === 'FP') {
        prob = 0.16;
        factors.push('Mid-week setback alert: downgraded to Friday DNP after practicing earlier in week');
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
      } else if (thu === 'LP' && wed === 'FP') {
        prob = Math.max(0.46, prior.questionablePlayRate - 0.14);
        factors.push('Mid-week downgrade (Wed FP -> Thu LP); monitoring Friday clearance');
      } else if (thu === 'LP' && wed === 'DNP') {
        if (prior.isVeteranRestHabitual && !missedPriorGame) {
          prob = 0.85;
          factors.push('Expected veteran ramp-up (Wed maintenance -> Thu LP)');
        } else {
          prob = Math.min(0.84, prior.questionablePlayRate - 0.02);
          factors.push(
            `Positive upward rehab ramp (Wed DNP -> Thu LP; player prior ${Math.round(prior.questionablePlayRate * 100)}%)`
          );
        }
      } else if (thu === 'LP') {
        prob = missedPriorGame
          ? Math.max(0.62, prior.questionablePlayRate - (consecutiveMissedGames >= 2 ? 0.03 : 0.01))
          : prior.questionablePlayRate;
        factors.push(
          `Thursday Limited Participation (LP); player toughness prior = ${Math.round(prior.questionablePlayRate * 100)}%`
        );
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
          const absenceStep = consecutiveMissedGames >= 2 ? 0.05 : 0.03;
          prob = Math.max(0.64, prior.questionablePlayRate - absenceStep);
          factors.push(
            `Returned to Limited Participation (LP) on Wednesday following ${consecutiveMissedGames > 1 ? `${consecutiveMissedGames}-game` : 'prior-game'} absence`
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
  if (!isConcussion && matchesChronicPart && prob < 0.93) {
    if (name === 'Trent Williams' && injuryLower.includes('ankle') && fri !== 'FP') {
      prob = Math.min(prob, prior.acuteAnklePlayRate || 0.56);
      factors.push('Trent Williams acute ankle adjustment (historically lower active rate than NIR-Rest)');
      appliedChronicDeduction = true;
    } else {
      prob -= 0.06;
      appliedChronicDeduction = true;
      factors.push(`Matches player's documented chronic history (${injuryType})`);
    }
  } else if (
    !isConcussion &&
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
  if (!isConcussion && HIGH_CAUTION_STRUCTURAL_KEYWORDS.some(k => injuryLower.includes(k)) && fri !== 'FP' && prob < 0.92) {
    prob -= appliedChronicDeduction ? 0.04 : 0.08;
    factors.push(`High-caution structural joint/ligament stability profile (${injuryType})`);
  } else if (!isConcussion && SOFT_TISSUE_KEYWORDS.some(k => injuryLower.includes(k)) && prob < 0.92) {
    prob -= appliedChronicDeduction ? 0.02 : 0.05;
    factors.push(`Soft-tissue re-aggravation caution (${injuryType})`);
  } else if (!isConcussion && MINOR_PAIN_TOLERANCE_KEYWORDS.some(k => injuryLower.includes(k)) && prob >= 0.50 && prob < 0.95) {
    prob += 0.04;
    factors.push(`Manageable pain-tolerance injury profile (${injuryType})`);
  }

  // 7. Trust-Weighted Corroborated News & Beat Context Refinements (Negation-Aware, Bounded Against Overreaction)
  if (newsSig) {
    const conf = newsSig.confidence;
    const srcLabel =
      newsSig.corroboratingCount >= 2
        ? `${newsSig.corroboratingCount} corroborated reports`
        : newsSig.hasCoachOrGmQuote
          ? 'coaching staff report'
          : 'beat report';

    if (newsSig.signalType === 'UNLIKELY_THIS_WEEK' && fri !== 'FP' && thu !== 'FP') {
      const blend = Math.min(0.86, conf * 0.94);
      prob = Math.min(prob, prob * (1 - blend) + 0.18 * blend);
      factors.push(`Coaching/beat consensus (${srcLabel}): not expected to play this week`);
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
    } else if (newsSig.signalType === 'EXPECTED_PRACTICE_RETURN' && !hasObservedPracticeThisWeek) {
      const returnTarget = Math.min(0.66, 0.64 + (prior.questionablePlayRate - 0.78) * 0.35);
      const blend = Math.min(0.84, conf * 0.90);
      if (returnTarget > prob) {
        prob = prob * (1 - blend) + returnTarget * blend;
      }
      factors.push(`Coaching/beat update (${srcLabel}): expected back at practice Wednesday (pending Wed–Fri workload)`);
    } else if (newsSig.signalType === 'EXPECTED_TO_PLAY') {
      const blend = Math.min(0.88, conf * 0.92);
      prob = Math.max(prob, prob * (1 - blend) + 0.86 * blend);
      factors.push(`Beat/podium consensus (${srcLabel}): on track to suit up`);
    } else if (newsSig.signalType === 'DAY_TO_DAY' && !hasObservedPracticeThisWeek) {
      prob = Math.min(0.82, Math.max(prob, 0.70 + (prior.questionablePlayRate - 0.78) * 0.55));
      factors.push(`Coaching update (${srcLabel}): considered day-to-day ahead of Wednesday practice`);
    }
  } else if (hasNegativePlayConsensusSignal(beatNote)) {
    prob = Math.min(prob, 0.20);
    factors.push('Beat consensus: unlikely / not expected to suit up');
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
    prob = Math.max(prob, 0.84);
    factors.push('Beat/podium consensus: on track to suit up');
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
    factors
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
  const hasCrediblePracticeReturnNews =
    Boolean(corroboratedNewsSignal?.hasSignal) &&
    (corroboratedNewsSignal.signalType === 'EXPECTED_PRACTICE_RETURN' ||
      corroboratedNewsSignal.signalType === 'EXPECTED_TO_PLAY') &&
    corroboratedNewsSignal.confidence >= 0.55 &&
    earliestWk <= curWk + 1;

  if (isDesignatedToReturnOpen) {
    // 21-day practice window IS open; ignore "wasn't activated Saturday" notes written before the completed prior week's game
    const lastPlayedEv = [...timeline].reverse().find(item => item.week < curWk);
    const blurbMs = parseFlexibleIsoMs(placedDateIso);
    const blurbPredatesCurrentWeek = Boolean(lastPlayedEv && blurbMs !== null && blurbMs < lastPlayedEv.ms);
    const ruledOutCurrentWeek =
      (!blurbPredatesCurrentWeek &&
        /not activated|didn't activate|did not activate|remains on injured reserve|ruled out|will not play|wait at least another week/i.test(
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

  const factualFallback = isDesignatedToReturnOpen
    ? `21-day practice window opened; eligible for 53-man roster activation (${fullInjuryType}).`
    : isPracticeWindowExpected
      ? `4-game minimum satisfied on ${statusLabel} (${fullInjuryType}); coaching staff expects 21-day practice window to open in Week ${curWk}.`
      : earliestWk <= curWk
        ? `4-game minimum satisfied on ${statusLabel} (${fullInjuryType}); awaiting 21-day practice window designation.`
        : `Placed on ${statusLabel} (${fullInjuryType}) ahead of Week ${placedBeforeWeek}; must miss at least 4 games (earliest eligible Week ${earliestWk}).`;

  let resolvedBeatNote = combinedNote || factualFallback;
  if (isPracticeWindowExpected && corroboratedNewsSignal?.leadClause) {
    const lead = String(corroboratedNewsSignal.leadClause).trim();
    if (lead && !resolvedBeatNote.toLowerCase().includes(lead.toLowerCase().slice(0, 28))) {
      resolvedBeatNote = combinedNote ? `${lead} ${combinedNote}` : lead;
    }
  }

  return {
    status: statusLabel,
    injuryType: fullInjuryType,
    isSeasonEnding: false,
    isPracticeWindowOpen: Boolean(isDesignatedToReturnOpen),
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

  const currentWeek = Number(
    appData?.health?.week ||
      appData?.scheduleMatchup?.upcomingMatchup?.week ||
      appData?.meta?.currentWeek ||
      1
  );
  const byeWeek = Number(appData?.health?.byeWeek || 8);
  const schedule = appData?.scheduleMatchup?.schedule || [];

  // Post-prior-game cutoff: only news published AFTER the most recently completed game can adjust upcoming-week health
  const completedGames = schedule
    .filter(g => g?.completed && (g.dateIso || g.kickoffIso))
    .map(g => parseFlexibleIsoMs(g.dateIso || g.kickoffIso))
    .filter(ms => ms !== null)
    .sort((a, b) => b - a);
  const lastCompletedGameEndMs =
    completedGames.length > 0 ? completedGames[0] + 3 * 3_600_000 : nowMs - 4.5 * 86_400_000;

  const seasonYear = Number(appData?.meta?.seasonYear || 2026);
  const upcomingKickoffIso =
    appData?.scheduleMatchup?.upcomingMatchup?.kickoffIso ||
    appData?.scheduleMatchup?.upcomingMatchup?.dateIso ||
    schedule.find(g => g && !g.completed && !g.isByeWeek)?.dateIso ||
    '';

  const rawStream = Array.isArray(appData?.news?.rawStream) ? appData.news.rawStream : [];
  const rosterPlayerNames = rosterPlayers.map(p => p?.name).filter(Boolean);

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

  let mutated = false;

  for (const p of rosterPlayers) {
    if (!p?.health || !p.name) continue;

    // Combine rawStream + player's own recentNews, deduplicated by URL/headline prefix
    const combinedNews = [];
    const seenKeys = new Set();
    for (const srcItem of [...rawStream, ...(Array.isArray(p.recentNews) ? p.recentNews : [])]) {
      if (!srcItem) continue;
      const k = String(srcItem.url || srcItem.id || srcItem.fullText || srcItem.title || srcItem.headline || '')
        .toLowerCase()
        .slice(0, 96);
      if (!k || seenKeys.has(k)) continue;
      seenKeys.add(k);
      combinedNews.push(srcItem);
    }

    const wirePrac = liveWirePracticeMap.get(p.id) || null;
    let practiceChanged = false;
    if (wirePrac) {
      for (const slot of ['wed', 'thu', 'fri']) {
        if (wirePrac[slot] && (!p.health[slot] || p.health[slot] === '-')) {
          p.health[slot] = wirePrac[slot];
          practiceChanged = true;
          mutated = true;
        }
      }
      if (wirePrac.hasSideFieldRehab && !p.health.hasSideFieldRehab) {
        p.health.hasSideFieldRehab = true;
        practiceChanged = true;
        mutated = true;
      }
      if (wirePrac.injuryType && (!p.health.injuryType || p.health.injuryType === 'Undisclosed')) {
        p.health.injuryType = wirePrac.injuryType;
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
    }

    const newsSig = evaluateCorroboratedNewsInjurySignal({
      playerName: p.name,
      rosterBucket: p.rosterBucket,
      newsItems: combinedNews,
      rosterPlayerNames,
      nowMs,
      windowStartMs: lastCompletedGameEndMs
    });

    if (p.rosterBucket === 'ir' || p.rosterBucket === 'suspended') {
      if (p.health.isSeasonEnding) continue;

      if ((newsSig.hasOfficialTxDesignation || wirePrac?.openedPracticeWindow) && !p.health.isPracticeWindowOpen) {
        p.health.isPracticeWindowOpen = true;
        p.health.isPracticeWindowExpected = false;
        p.health.status = 'IR — 21-Day Window Open';
        p.health.projectedReturnWeek = `Week ${currentWeek} Activation Window`;
        if (wirePrac?.latestNote) {
          const lead = String(wirePrac.latestNote).trim();
          const existingIrNote = String(p.health.irBeatNote || p.health.longComment || '').trim();
          if (lead && !existingIrNote.toLowerCase().includes(lead.toLowerCase().slice(0, 28))) {
            p.health.irBeatNote = existingIrNote ? `${lead} ${existingIrNote}` : lead;
          }
        }
        mutated = true;
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
          Number(curProj.match(/Week\s+(\d+)/i)?.[1] || 0) > currentWeek + 1;

        if (earliestWk <= currentWeek + 1 && !hasLaterConcreteTarget) {
          let winWk1 = Math.max(currentWeek, earliestWk);
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
      continue;
    }

    if (p.rosterBucket === 'active' && p.health.isOnPracticeReport) {
      // Upgrade bare status placeholder comments ("inactive", "out", "questionable") with verified injury/beat context
      const bestLeadNote = wirePrac?.latestNote || newsSig.leadClause || '';
      if (isBareStatusPlaceholderComment(p.health.longComment) && bestLeadNote) {
        p.health.longComment = bestLeadNote;
        if (isBareStatusPlaceholderComment(p.health.shortComment)) {
          p.health.shortComment = bestLeadNote;
        }
        mutated = true;
      }

      const rawStatusLower = String(p.health.status || '').toLowerCase();
      const isEarlyPrePractice =
        (p.health.wed === '-' || !p.health.wed) &&
        (p.health.thu === '-' || !p.health.thu) &&
        (p.health.fri === '-' || !p.health.fri);

      if (practiceChanged || newsSig.hasSignal || (isEarlyPrePractice && rawStatusLower === 'questionable')) {
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
          fantasyStatusAbbr: p.health.fantasyStatusAbbr || '',
          injuryType: p.health.injuryType || '',
          wed: p.health.wed,
          thu: p.health.thu,
          fri: p.health.fri,
          hasSideFieldRehab: Boolean(p.health.hasSideFieldRehab),
          beatNote: noteForModel,
          weeklyHistory: p.health.weeklyHistory2026 || [],
          currentWeek,
          byeWeek,
          rosterPlayerNames,
          corroboratedNewsSignal: newsSig
        });

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
      const leadDays = koPt.weekday === 'Thu' ? 3 : 4;
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

    appData.health.practiceReport = rosterPlayers
      .filter(p => p.health?.isOnPracticeReport)
      .sort(
        (a, b) =>
          (a.health.playProbabilityPct ?? 99) - (b.health.playProbabilityPct ?? 99) ||
          (b.capHit2026 || 0) - (a.capHit2026 || 0)
      )
      .map(p => ({
        playerId: p.id,
        name: p.name,
        position: p.position,
        jersey: p.jersey,
        headshotUrl: p.headshotUrl || '',
        wed: shouldBlankEarlyWeek ? '-' : p.health.wed || '-',
        thu: shouldBlankEarlyWeek ? '-' : p.health.thu || '-',
        fri: shouldBlankEarlyWeek ? '-' : p.health.fri || '-',
        injuryType:
          p.health.injuryType ||
          (p.health.wed === 'Vet Rest' ? 'NIR - Veteran Rest' : 'Cleared — No Designation'),
        gameStatus: p.health.status,
        playProbabilityPct: p.health.playProbabilityPct,
        playBadgeLabel: p.health.playBadgeLabel,
        archetypeNote: p.health.archetypeNote || '',
        factors: p.health.factors || [],
        beatComment: pickMeaningfulInjuryComment(p.health.longComment, p.health.shortComment)
      }));

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
            ? 'IR — Designated to Return (Questionable)'
            : p.health.status || 'Injured Reserve',
          isSeasonEnding: Boolean(p.health.isSeasonEnding),
          isPracticeWindowOpen: Boolean(p.health.isPracticeWindowOpen),
          isPracticeWindowExpected: Boolean(p.health.isPracticeWindowExpected),
          placedBeforeWeek: p.health.placedBeforeWeek ?? 1,
          earliestEligibleWeek: p.health.earliestEligibleWeek ?? null,
          projectedReturnWeek: p.health.projectedReturnWeek || 'TBD',
          byeWeekNote: p.health.byeWeekNote || '4-game NFL minimum requirement',
          beatNote: pickMeaningfulInjuryComment(p.health.irBeatNote, p.health.longComment, p.health.shortComment)
        }))
        .sort((a, b) => sortIrTrackerPriority(a) - sortIrTrackerPriority(b) || a.name.localeCompare(b.name));
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
            prob >= 40 && (rp.rosterBucket === 'active' || Boolean(rp.health.isIrReturnQuestionable));
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
    const isStarter = isEffectiveOffDefStarter(row);

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
  if (/not injury related|nir\s*-?\s*(?:veteran\s*)?rest|^rest$|^veteran rest$|coach'?s decision|personal/i.test(inj)) {
    return true;
  }
  if (
    !inj &&
    healthOrRow.wed === 'Vet Rest' &&
    st !== 'out' &&
    st !== 'doubtful' &&
    st !== 'questionable'
  ) {
    return true;
  }
  return false;
}

/**
 * Determines whether a player qualifies for the "Injury News" card under `Health & Priors`:
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

  // Active / Practice Squad player: eligible when genuinely injured or listed on weekly injury report
  if (Boolean(h.isOnPracticeReport)) {
    return Boolean(injClean && !/^cleared\s*[—-]\s*no designation$/i.test(injClean)) || ['out', 'doubtful', 'questionable'].includes(stLower);
  }
  if (['out', 'doubtful', 'questionable', 'doubtful', 'inactive'].includes(stLower)) {
    return true;
  }
  if (injClean && !/^(?:none|healthy|active|cleared\s*[—-]\s*no designation)$/i.test(injClean)) {
    return true;
  }
  return false;
}

const INJURY_NEWS_TOPIC_RELEVANCE_RE =
  /\b(injur(?:y|ed|ies)|practice[d]?|practicing|participat(?:e|ed|ing|ion|ant)|limited|dnp|did not practice|didn't practice|not practicing|no practice|full go|full participant|side\s*lines?|side\s+field|rehab(?:bing)?|spotted\s+(?:running|sprinting|working|jogging|cutting|throwing)|sprinting|running\s+routes|working\s+with\s+trainers|individual\s+drills|team\s+drills|non-contact|walking\s+boot|brace|helmet\s+off|observer|locker\s+room|medical\s+tent|\bmri\b|x-rays?|ct\s+scan|surgery|surgical|concussion|protocol|hamstring|achilles|ankle|high-ankle|knee|meniscus|\bmcl\b|\bpcl\b|\bacl\b|turf\s+toe|(?:lower\s+|upper\s+)?back\s+(?:injury|spasms|tightness|issue|pain)|\(back\)|\(\s*foot\s*\)|foot\s+(?:injury|sprain|fracture|issue)|shoulder|groin|adductor|calf|quad|hip\s+(?:injury|pointer|flexor|issue)|\(hip\)|oblique|pectoral|rib|wrist|hand\s+(?:injury|fracture|surgery)|thumb|neck\s+(?:injury|stinger|spasms|issue)|\(neck\)|elbow|illness|sprain|strain|tear|torn|fracture|day-to-day|week-to-week|questionable|doubtful|ruled\s+out|inactives?|injured\s+reserve|\bir\b|\bpup\b|21-day|practice\s+window|designated\s+to\s+return|activated|setback|aggravat(?:e|ed)|clearance|cleared|healthy|recovery|recuperat|return(?:ed|ing)?\s+to\s+(?:practice|action|the\s+field)|sidelined|capped\s+session)\b/i;

const INJURY_REHAB_COLOR_DETAIL_RE =
  /\b(spotted\s+(?:running|sprinting|jogging|working|cutting|throwing|catching)|on\s+the\s+(?:side\s*lines?|side\s+field|rehab\s+field)|working\s+(?:on\s+(?:a|the)\s+(?:side|rehab)\s+field|with\s+trainers)|running\s+(?:on\s+the\s+side|routes|sprints)|cutting|individual\s+drills|indy\s+drills|team\s+drills|7-on-7|11-on-11|in\s+cleats|in\s+pads|with\s+a\s+helmet|without\s+a\s+(?:brace|boot|limp)|walking\s+boot|blue\s+non-contact|non-contact\s+jersey|was\s+an\s+observer|moving\s+well|full\s+speed|capped\s+session|for\s+the\s+first\s+time\s+since|making\s+solid\s+progress)\b/i;

const INJURY_CONTRASTIVE_COLOR_RE =
  /\b(?:(?:didn't|did\s+not|not)\s+practic(?:e|ing)[^.;]{0,35}\b(?:but|though|although|however)\b|\b(?:but|though|although)\s+(?:was\s+)?(?:spotted|seen|working|running|sprinting)|that\s+explains\s+why|considering\s+he\s+logged)\b/i;

const INJURY_MEDICAL_DIAGNOSTIC_OR_QUOTE_RE =
  /\b(\bmri\b|x-rays?|ct\s+scan|surgery|meniscus|high-ankle|concussion\s+protocol|shanahan\s+(?:said|noted|revealed|relayed|confirmed|indicated|announced)|lynch\s+(?:said|noted|confirmed)|said\s+(?:monday|wednesday|thursday|friday|after)|day-to-day|week-to-week|21-day\s+practice\s+window|opened\s+(?:the\s+|his\s+|[a-z']+s?\s+)?(?:21-day\s+|injured\s+reserve\s+|ir\s+)?practice\s+window|designated\b[^.;]{0,55}\bto\s+return|not\s+expecting\b[^.;]{0,45}\bthis\s+week)\b/i;

const INJURY_STATUS_MILESTONE_RE =
  /\b(opened\s+(?:the\s+|his\s+|[a-z']+s?\s+)?(?:21-day\s+|injured\s+reserve\s+|ir\s+)?practice\s+window|designated\b[^.;]{0,55}\bto\s+return|activated\s+from|placed\s+on\s+(?:injured\s+reserve|ir\b)|back\s+on\s+the\s+practice\s+field|returned\s+to\s+(?:on-field\s+)?practice|cleared\s+(?:the\s+)?concussion\s+protocol|suffered\s+a\s+setback|aggravated|ruled\s+out)\b/i;

/**
 * Computes a deterministic Joint Recency + Salience/Importance score for a candidate injury tweet or article
 * pertaining to `player`. Returns `null` if the item does not genuinely mention `player` or is unrelated to
 * their injury, practice participation, or recovery progression.
 */
export function computeInjuryNewsRankScore(
  item = {},
  {
    player = null,
    rosterPlayerNames = [],
    nowMs = Date.now(),
    maxAgeDays = 8,
    lastCompletedKickoffMs = null,
    hasObservedPracticeThisWeek = false
  } = {}
) {
  if (!item || !player?.name || item.isClickbait || item.type === 'video') return null;

  // Prevent another player's ESPN/RotoWire player-page blurb (`espn_pwire_<ownerId>_*`) from leaking into `player`'s Injury News
  const itemIdStr = String(item.id || '');
  if (itemIdStr.startsWith('espn_pwire_')) {
    const ownerId = itemIdStr.split('_')[2] || '';
    if (ownerId && /^\d+$/.test(ownerId) && /^\d+$/.test(String(player.id || '')) && ownerId !== String(player.id)) {
      return null;
    }
  }
  if (
    item.primaryPlayer?.id &&
    /^\d+$/.test(String(item.primaryPlayer.id)) &&
    /^\d+$/.test(String(player.id || '')) &&
    String(item.primaryPlayer.id) !== String(player.id) &&
    item.wireSource === 'espn_player_wire'
  ) {
    return null;
  }

  const pubMs = parseFlexibleIsoMs(item.publishedAt);
  if (pubMs === null) return null;
  const ageHours = Math.max(0, (nowMs - pubMs) / 3_600_000);
  if (ageHours > maxAgeDays * 24 || pubMs > nowMs + 3_600_000) return null;

  const primaryText = String(item.fullText || item.title || item.headline || '').trim();
  const secondaryText = String(item.summary || item.externalTitle || '').trim();
  const fullBody =
    secondaryText && !primaryText.toLowerCase().includes(secondaryText.toLowerCase().slice(0, 32))
      ? `${primaryText} ${secondaryText}`.trim()
      : primaryText;
  if (!fullBody || fullBody.length < 15) return null;

  // Strict text mention verification (eliminates any false-positive general NFL articles)
  if (!doesClauseMentionPlayer(fullBody, player.name, { allowSurname: true })) {
    return null;
  }

  // Filter out bare prior-completed-game active/inactive list noise while preserving diagnostic/rehab updates
  if (
    Number.isFinite(lastCompletedKickoffMs) &&
    pubMs < lastCompletedKickoffMs + 20 * 60_000 &&
    /\b(?:inactives?\s*:|is\s+officially\s+(?:active|inactive)|declared\s+inactive|among\s+.*inactives)\b/i.test(fullBody) &&
    !INJURY_REHAB_COLOR_DETAIL_RE.test(fullBody) &&
    !INJURY_MEDICAL_DIAGNOSTIC_OR_QUOTE_RE.test(fullBody)
  ) {
    return null;
  }

  const scoped = scopeBeatTextToPlayer(fullBody, player.name, rosterPlayerNames);
  const checkScope = scoped || fullBody;

  if (!INJURY_NEWS_TOPIC_RELEVANCE_RE.test(checkScope)) {
    return null;
  }
  // Reject fantasy start/sit / betting props fluff
  if (/\b(fantasy\s+managers|waiver\s+wire|start\/sit|draftkings|fanduel|parlay|over\/under\s+prop)\b/i.test(checkScope)) {
    return null;
  }

  // 1. Smooth Recency Curve (0..52 pts, 20-hour half-life) so recent updates lead while rich same-day color beats dry lists
  const recencyScore = 52 * Math.pow(0.5, ageHours / 20);

  // 2. Observational Side-Field & Rehab Progression Color (0..28 pts)
  let colorScore = 0;
  if (INJURY_REHAB_COLOR_DETAIL_RE.test(checkScope)) {
    colorScore += 24;
  }
  if (INJURY_CONTRASTIVE_COLOR_RE.test(checkScope) || INJURY_CONTRASTIVE_COLOR_RE.test(fullBody)) {
    colorScore += 6;
  }
  colorScore = Math.min(28, colorScore);

  // 3. Medical Diagnostic / Coaching Quote / Timeline Detail (0..20 pts)
  let medicalScore = 0;
  if (INJURY_MEDICAL_DIAGNOSTIC_OR_QUOTE_RE.test(checkScope)) {
    medicalScore += 18;
  }
  if (player.health?.injuryType && checkScope.toLowerCase().includes(String(player.health.injuryType).split(/[ ,/-]/)[0].toLowerCase())) {
    medicalScore += 3;
  }
  medicalScore = Math.min(20, medicalScore);

  // 4. Status Milestone vs Routine Participation (0..16 pts)
  let milestoneScore = 0;
  if (INJURY_STATUS_MILESTONE_RE.test(checkScope)) {
    milestoneScore = 16;
  } else if (
    /\b(limited\s+(?:practice\s+)?participant|limited\s+today|did\s+not\s+practice|didn't\s+practice|not\s+practicing|no\s+practice\s+for|not\s+participating|full\s+participant|practiced\s+in\s+full)\b/i.test(
       fullBody
    )
  ) {
    milestoneScore = 10;
  }

  // 5. Reporter Authority, Corroboration & Player-Focus Specificity (-4..24 pts)
  const repEntry = resolveReporterFromNameOrHandle(
    item.reporterId || item.author || item.reporterName || item.authorHandle
  );
  const effectiveTier = Number(item.trustTier) || repEntry?.trustTier || (VERIFIED_TIER1_REPORTER_NAMES_RE.test(fullBody) ? 1 : 2);
  const isOfficial = item.outletId === '49ers_official' || item.wireSource === 'official_transactions';
  let authorityScore = isOfficial || effectiveTier <= 1 ? 14 : effectiveTier === 2 ? 9 : 4;
  if (item.isFirstMoverInjuryScoop || Number(item.corroborationCount || 1) >= 2) {
    authorityScore += 4;
  }

  const focusRatio = scoped ? scoped.length / Math.max(1, fullBody.length) : 0.4;
  const mentionedCnt = Array.isArray(item.mentionedPlayers) ? item.mentionedPlayers.length : 1;
  const focusScore = focusRatio >= 0.5 && mentionedCnt <= 3 ? 6 : mentionedCnt >= 5 ? -4 : 2;

  // 6. Superseded Pre-Practice Expectation Penalty (-18 pts once actual weekly practice reps are logged)
  let supersededPenalty = 0;
  if (
    hasObservedPracticeThisWeek &&
    ageHours > 10 &&
    FUTURE_PRACTICE_EXPECTATION_GUARD_RE.test(checkScope) &&
    !INJURY_REHAB_COLOR_DETAIL_RE.test(checkScope) &&
    milestoneScore === 0
  ) {
    supersededPenalty = -18;
  }

  const totalScore = Number(
    (recencyScore + colorScore + medicalScore + milestoneScore + authorityScore + focusScore + supersededPenalty).toFixed(2)
  );

  return {
    totalScore,
    recencyScore: Number(recencyScore.toFixed(2)),
    salienceScore: Number((colorScore + medicalScore + milestoneScore + authorityScore + focusScore).toFixed(2)),
    hasRehabColor: colorScore >= 20,
    ageHours: Number(ageHours.toFixed(2)),
    scopedText: checkScope
  };
}

function isItemMutedByPrefs(item = {}, userPrefs = null, reportersById = null) {
  if (!userPrefs || typeof userPrefs !== 'object') return false;
  const disabledReps = new Set(userPrefs.disabledReporterIds || []);
  const disabledOutlets = new Set(userPrefs.disabledOutlets || []);
  if (item.reporterId && disabledReps.has(item.reporterId)) return true;
  if (item.outletId && disabledOutlets.has(item.outletId)) return true;
  if (userPrefs.muteHotTakePersonalities && item.reporterId && reportersById instanceof Map) {
    const rep = reportersById.get(item.reporterId);
    if (rep?.isHotTake) return true;
  }
  return false;
}

/**
 * Returns the deduplicated, Recency + Salience stack-ranked list of injury & recovery tweets/articles
 * for `player` over the past ~7–8 days.
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
    maxItems = 5
  } = {}
) {
  if (!player?.name) return [];
  const h = player.health || {};
  const rosterPlayers = appData?.roster?.players || [];
  const rosterPlayerNames = rosterPlayers.map(rp => rp?.name).filter(Boolean);

  const schedule = appData?.scheduleMatchup?.schedule || [];
  const completedKickoffs = schedule
    .filter(g => g?.completed && (g.dateIso || g.kickoffIso))
    .map(g => parseFlexibleIsoMs(g.dateIso || g.kickoffIso))
    .filter(ms => ms !== null)
    .sort((a, b) => b - a);
  const lastCompletedKickoffMs = completedKickoffs.length > 0 ? completedKickoffs[0] : null;

  const hasObservedPracticeThisWeek =
    (h.wed && h.wed !== '-') || (h.thu && h.thu !== '-') || (h.fri && h.fri !== '-');

  const combinedCandidates = [
    ...(Array.isArray(rawStream) ? rawStream : []),
    ...(Array.isArray(appData?.news?.rawStream) ? appData.news.rawStream : []),
    ...(Array.isArray(player.recentNews) ? player.recentNews : [])
  ];

  const directPosts = combinedCandidates.filter(
    it =>
      (it?.type === 'tweet' || it?.type === 'social') &&
      isDirectSocialPostUrl(String(it?.url || ''))
  );

  const seenExact = new Set();
  const scored = [];

  for (const cand of combinedCandidates) {
    if (!cand || isItemMutedByPrefs(cand, userPrefs, reportersById)) continue;
    const isTw = cand.type === 'tweet' || cand.type === 'social';
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
      .replace(/[^a-z0-9]/g, '')
      .slice(0, 72);
    if (!leadKey || seenExact.has(leadKey)) continue;

    const rankMeta = computeInjuryNewsRankScore(cand, {
      player,
      rosterPlayerNames,
      nowMs,
      maxAgeDays,
      lastCompletedKickoffMs,
      hasObservedPracticeThisWeek
    });
    if (!rankMeta) continue;

    seenExact.add(leadKey);
    const authorName = cand.author || cand.reporterName || cand.outletName || '49ers Beat';
    const authorProfileUrl = sanitizeExternalUrl(
      resolveItemAuthorProfileUrl(cand, safeUrl),
      safeUrl
    );

    scored.push({
      ...cand,
      type: isTw ? 'tweet' : 'article',
      headline: cand.headline || cand.title || '',
      title: cand.title || cand.headline || '',
      fullText: isTw ? cand.fullText || cand.title || cand.headline || '' : cand.fullText || null,
      author: authorName,
      authorProfileUrl,
      url: safeUrl,
      injuryRankScore: rankMeta.totalScore,
      injurySalienceScore: rankMeta.salienceScore,
      hasRehabColor: rankMeta.hasRehabColor
    });
  }

  // Sort by Joint Recency + Salience score descending (tie-break by newer timestamp)
  scored.sort(
    (a, b) =>
      b.injuryRankScore - a.injuryRankScore ||
      (parseFlexibleIsoMs(b.publishedAt) || 0) - (parseFlexibleIsoMs(a.publishedAt) || 0)
  );

  // Deduplicate same-day echoes of the exact same practice status by different wire mirrors,
  // keeping the highest-scored / richest card on top and attaching echoes into `confirmingReports`
  const deduped = [];
  for (const item of scored) {
    const itemMs = parseFlexibleIsoMs(item.publishedAt) || 0;
    const itemText = `${item.fullText || ''} ${item.title || ''} ${item.summary || ''}`.toLowerCase();
    const bucketTag = INJURY_REHAB_COLOR_DETAIL_RE.test(itemText)
      ? null // Never collapse distinct side-field rehab observation tweets into bare practice buckets!
      : /\b(21-day|practice window|designated to return|placed on injured reserve)\b/.test(itemText)
        ? 'ir_window'
        : /\b(limited|did not practice|didn't practice|not practicing|no practice|not participating|full participant)\b/.test(itemText)
          ? 'practice_status'
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
          !existingLead.confirmingReports.some(cr => (cr.author || '').toLowerCase() === (item.author || '').toLowerCase()) &&
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

  // Clean fallback: if an injured player has no matched stream card in the 8-day feed yet,
  // synthesize a grounded beat/medical update card from their verified ESPN/RotoWire/49ers.com injury note
  if (deduped.length === 0) {
    const fallbackProse = pickMeaningfulInjuryComment(h.irBeatNote, h.longComment, h.shortComment, player.beatComment);
    if (fallbackProse && !isBareStatusPlaceholderComment(fallbackProse)) {
      const parsedAttr = extractBeatAttributionFromText(fallbackProse, {
        reporterId: null,
        reporterName: '49ers Beat & Medical Desk',
        outletId: 'espn',
        outletName: 'ESPN / 49ers Beat'
      });
      const fallbackUrl =
        sanitizeExternalUrl(
          parsedAttr.viaWire
            ? buildXPlayerScoopSearchUrl(player.name)
            : player.espnUrl || 'https://www.49ers.com/team/injury-report/',
          'https://www.49ers.com/team/injury-report/'
        );
      const authorProfile = sanitizeExternalUrl(
        parsedAttr.xUrl || parsedAttr.authorProfileUrl || fallbackUrl,
        fallbackUrl
      );
      deduped.push({
        id: `inj_fallback_${player.id || player.name}`,
        type: 'tweet',
        title: fallbackProse,
        headline: fallbackProse,
        fullText: fallbackProse,
        isFullTweet: fallbackProse.length <= 320,
        summary: '',
        author: parsedAttr.author || '49ers Beat & Medical Desk',
        authorHandle: parsedAttr.authorHandle || '',
        authorProfileUrl: authorProfile,
        outletName: parsedAttr.outletName || '49ers Beat',
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

    if (rankedNews.length > 0) {
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
        topItem: rankedNews[0]
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
