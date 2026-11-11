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
  'james'
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
    .split(/(?<=[.!?])\s+|\s*[;\n]+\s*|\b(?=while\s+[A-Z]|whereas\s+[A-Z]|meanwhile,?\s+|on the plus side\b|in any case,?\s+)/i)
    .map(s => s.trim())
    .filter(Boolean);

  if (sentences.length <= 1) {
    // Check intra-sentence contrast ("Samuel is expected back, while Mike Evans is unlikely")
    const subClauses = text
      .split(/,\s*(?:while|whereas|but|though|although)\s+/i)
      .map(s => s.trim())
      .filter(Boolean);
    if (subClauses.length <= 1) return text;
    const matchedSub = subClauses.filter(c => doesClauseMentionPlayer(c, target));
    return matchedSub.length > 0 ? matchedSub.join('. ') : text;
  }

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
      .split(/,\s*(?=(?:while|whereas|but|though)\s+(?:fellow\s+|wr\s+|rb\s+|cb\s+|dt\s+|de\s+|lb\s+|te\s+)?[A-Z])/i)
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

    // Check official @49ers transaction wire for immediate 21-day return designation
    if (
      (item.wireSource === 'official_transactions' || item.outletId === '49ers_official') &&
      /\b(?:designated\b[^.]{0,80}\bto return from (?:injured reserve|the pup list)|opened the (?:injured reserve|pup) practice window)\b/i.test(
        fullBody
      ) &&
      doesClauseMentionPlayer(fullBody, playerName)
    ) {
      hasOfficialTxDesignation = true;
    }

    const scoped = scopeBeatTextToPlayer(fullBody, playerName, rosterPlayerNames);
    if (!scoped) continue;

    // Speculation & low-credibility guard: reject blogs/opinion/rumors unless directly citing a verified Tier-1 beat reporter
    const trustTier = Number(item.trustTier || 2);
    const hasInlineTier1 = VERIFIED_TIER1_REPORTER_NAMES_RE.test(fullBody);
    const isOfficialSource = item.outletId === '49ers_official' || item.wireSource === 'official_transactions';
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

    if (hasAffirmativeRuledOutSignal(scoped)) {
      signalType = 'RULED_OUT_WEEK';
      direction = -1.0;
    } else if (hasNegativePlayConsensusSignal(scoped)) {
      signalType = 'UNLIKELY_THIS_WEEK';
      direction = -0.82;
    } else if (hasNegativePracticeExpectationSignal(scoped)) {
      signalType = 'UNLIKELY_WEDNESDAY_PRACTICE';
      direction = -0.58;
    } else if (hasAffirmativePlayOrActivationSignal(scoped)) {
      signalType = 'EXPECTED_TO_PLAY';
      direction = 0.80;
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

/**
 * Parses Wednesday / Thursday / Friday practice participation codes from official nflverse status,
 * slash notation (`DNP/LP/FP`), and prose beat/injury wire comments (used identically for 49ers & Opponents).
 */
export function extractPracticeDaysFromText({
  statusRaw = '',
  injuryType = '',
  shortComment = '',
  longComment = '',
  nflversePracticeStatus = ''
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
      "(did not practice|didn't practice|non-participant|sidelined|sat out|limited participant|limited participation|limited practice|limited session|limited in practice|limited on|was limited|full participant|full participation|full practice|practiced in full|full session)";
    const m1 = lower.match(new RegExp(`${statusExpr}[^.;]{0,48}${dayRegex}`, 'i'));
    const m2 = lower.match(new RegExp(`${dayRegex}[^.;]{0,36}${statusExpr}`, 'i'));
    const phrase = (m1?.[1] || m2?.[1] || '').toLowerCase();
    if (!phrase) return null;
    if (phrase.includes('full')) return 'FP';
    if (phrase.includes('limited')) return 'LP';
    if (
      phrase.includes('did not') ||
      phrase.includes("didn't") ||
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

  if (/did not practice all week|missed all three practices|missing practice all week/i.test(lower)) {
    wed = wed || 'DNP';
    thu = thu || 'DNP';
    fri = fri || 'DNP';
  } else if (/limited (?:participant )?(?:in practice )?all week|limited wednesday through friday|three limited sessions/i.test(lower)) {
    wed = wed || 'LP';
    thu = thu || 'LP';
    fri = fri || 'LP';
  } else if (/full participant all week|practiced in full all week/i.test(lower)) {
    wed = wed || 'FP';
    thu = thu || 'FP';
    fri = fri || 'FP';
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
    return { wed: isRest ? 'Vet Rest' : 'LP', thu: 'LP', fri: 'LP' };
  }

  // Fill remaining slots sensibly from observed trajectory
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

  const affirmativeRuledOut =
    hasAffirmativeRuledOutSignal(beatNote) ||
    Boolean(newsSig && newsSig.signalType === 'RULED_OUT_WEEK' && newsSig.confidence >= 0.6);

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

  const wed = normalizePracticeCode(input.wed, injuryType);
  const thu = normalizePracticeCode(input.thu, injuryType);
  const fri = normalizePracticeCode(input.fri, injuryType);
  const hasObservedPracticeThisWeek = wed !== 'NONE' || thu !== 'NONE' || fri !== 'NONE';

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
      if (thu === 'FP' || wed === 'FP') {
        prob = 0.91;
        factors.push('Full Participation logged in mid-week session');
      } else if (thu === 'LP' && wed === 'DNP' && prior.isVeteranRestHabitual) {
        prob = 0.87;
        factors.push('Expected veteran ramp-up (Wed rest -> Thu LP)');
      } else if (thu === 'DNP' && (wed === 'LP' || wed === 'FP')) {
        prob = 0.38;
        factors.push('Mid-week downgrade (practiced Wednesday, DNP Thursday)');
      } else if (thu === 'LP' || wed === 'LP') {
        prob = prior.questionablePlayRate;
        factors.push(
          `Mid-week Limited Participation; player toughness prior = ${Math.round(prior.questionablePlayRate * 100)}%`
        );
      } else if (wed === 'DNP' && thu === 'DNP') {
        prob = prior.isVeteranRestHabitual ? 0.62 : 0.30;
        factors.push('Consecutive Wed/Thu DNPs');
      } else if (wed === 'DNP' && thu === 'NONE') {
        prob = prior.isVeteranRestHabitual ? 0.68 : 0.36;
        factors.push('Did Not Participate (DNP) on Wednesday');
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
  const matchesChronicPart = prior.chronicParts.some(part => injuryLower.includes(part.toLowerCase()));
  if (!isConcussion && matchesChronicPart && prob < 0.93) {
    if (name === 'Trent Williams' && injuryLower.includes('ankle') && fri !== 'FP') {
      prob = Math.min(prob, prior.acuteAnklePlayRate || 0.56);
      factors.push('Trent Williams acute ankle adjustment (historically lower active rate than NIR-Rest)');
    } else {
      prob -= 0.07;
      factors.push(`Matches player's documented chronic history (${injuryType})`);
    }
  } else if (
    !isConcussion &&
    hasObservedPracticeThisWeek &&
    prior.questionablePlayRate >= 0.88 &&
    prob >= 0.45 &&
    prob < 0.93
  ) {
    prob += 0.05;
    factors.push('High pain-tolerance / toughness prior (+5% boost)');
  }

  if (!hasObservedPracticeThisWeek && statusRaw === 'questionable' && !isIrReturnQuestionable) {
    prob = Math.min(prob, 0.84);
  }

  // 6. Injury Biomechanics Modifier (High-caution structural joint vs soft-tissue speed risk vs pain management)
  if (!isConcussion && HIGH_CAUTION_STRUCTURAL_KEYWORDS.some(k => injuryLower.includes(k)) && fri !== 'FP' && prob < 0.92) {
    prob -= 0.08;
    factors.push(`High-caution structural joint/ligament stability profile (${injuryType})`);
  } else if (!isConcussion && SOFT_TISSUE_KEYWORDS.some(k => injuryLower.includes(k)) && prob < 0.92) {
    prob -= 0.05;
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

    if (newsSig.signalType === 'UNLIKELY_THIS_WEEK') {
      const blend = Math.min(0.86, conf * 0.94);
      prob = Math.min(prob, prob * (1 - blend) + 0.18 * blend);
      factors.push(`Coaching/beat consensus (${srcLabel}): not expected to play this week`);
    } else if (newsSig.signalType === 'UNLIKELY_WEDNESDAY_PRACTICE' && !hasObservedPracticeThisWeek) {
      const blend = Math.min(0.78, conf * 0.85);
      prob = Math.min(prob, prob * (1 - blend) + 0.24 * blend);
      factors.push(`Early-week update (${srcLabel}): unlikely to practice Wednesday / questionable at best`);
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
      return 'Probable';
    case 'FIFTY_FIFTY':
      return 'True GTD';
    case 'UNLIKELY':
      return 'Long Shot';
    case 'DOUBTFUL':
      return 'Doubtful';
    case 'OUT':
      return 'Out';
    default:
      return 'Questionable';
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

  const rawStream = Array.isArray(appData?.news?.rawStream) ? appData.news.rawStream : [];
  const rosterPlayerNames = rosterPlayers.map(p => p?.name).filter(Boolean);
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

      if (newsSig.hasOfficialTxDesignation && !p.health.isPracticeWindowOpen) {
        p.health.isPracticeWindowOpen = true;
        p.health.isPracticeWindowExpected = false;
        p.health.status = 'IR — 21-Day Window Open';
        p.health.projectedReturnWeek = `Week ${currentWeek} Activation Window`;
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
      // Upgrade bare status placeholder comments ("inactive", "out") with verified injury/beat context
      if (isBareStatusPlaceholderComment(p.health.longComment) && newsSig.leadClause) {
        p.health.longComment = newsSig.leadClause;
        if (isBareStatusPlaceholderComment(p.health.shortComment)) {
          p.health.shortComment = newsSig.leadClause;
        }
        mutated = true;
      }

      const rawStatusLower = String(p.health.status || '').toLowerCase();
      const isEarlyPrePractice =
        (p.health.wed === '-' || !p.health.wed) &&
        (p.health.thu === '-' || !p.health.thu) &&
        (p.health.fri === '-' || !p.health.fri);

      if (newsSig.hasSignal || (isEarlyPrePractice && rawStatusLower === 'questionable')) {
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
    const isEarlyWk =
      Array.isArray(appData.health.practiceReport) &&
      appData.health.practiceReport.length > 0 &&
      appData.health.practiceReport.every(r => r.wed === '-' && r.thu === '-' && r.fri === '-');

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
        wed: isEarlyWk ? '-' : p.health.wed || '-',
        thu: isEarlyWk ? '-' : p.health.thu || '-',
        fri: isEarlyWk ? '-' : p.health.fri || '-',
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
  let doubtfulOrLongShotCount = 0;
  let gtdCount = 0;
  let clearedCount = 0;

  let startersOutCount = 0;
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
      (prob >= 88 && !/^(?:out|inactive|doubtful|questionable|ir)/i.test(statusStr));
    const isOut = !isCleared && (prob === 0 || /^(?:out|inactive)\b/i.test(statusStr));
    const isDoubtful = !isCleared && !isOut && (prob < 50 || /\bdoubtful\b/i.test(statusStr));
    const isGtd = !isCleared && !isOut && !isDoubtful;

    if (isCleared) {
      clearedCount += 1;
    } else if (isOut) {
      ruledOutCount += 1;
      if (isStarter) startersOutCount += 1;
    } else if (isDoubtful) {
      doubtfulOrLongShotCount += 1;
      if (isStarter) startersDoubtfulCount += 1;
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
    startersDoubtfulCount,
    startersQuestionableCount,
    startersUnresolvedCount,
    ruledOutCount,
    doubtfulOrLongShotCount,
    gtdCount,
    questionableOrDoubtfulCount,
    clearedCount,
    irCount,
    irOpenWindowCount,
    irSeasonEndingCount
  };
}
