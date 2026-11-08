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
    chronicParts: ['hamstring', 'calf'],
    archetypeNote: 'Veteran X-receiver toughness prior; routinely manages Wednesday reps but requires soft-tissue sprint clearance.'
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

const SOFT_TISSUE_KEYWORDS = ['hamstring', 'calf', 'groin', 'quad', 'achilles', 'oblique', 'high ankle'];
const MINOR_PAIN_TOLERANCE_KEYWORDS = ['finger', 'thumb', 'hand', 'wrist', 'rib', 'shoulder', 'nose', 'illness'];

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
  const beatNote = String(input.beatNote || input.comment || '').toLowerCase();

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

  // 1. Check IR / Reserve Return Window Activation (e.g., 21-day practice window opened + officially Questionable)
  const isIrReturnQuestionable =
    (rosterBucket === 'ir' ||
      rosterBucket === 'injuredreserveorout' ||
      statusRaw === 'ir' ||
      statusRaw === 'injured reserve') &&
    (beatNote.includes('listed as questionable') ||
      beatNote.includes('questionable for sunday') ||
      beatNote.includes('questionable ahead of') ||
      beatNote.includes('likely will be activated') ||
      beatNote.includes('expected to be activated')) &&
    !beatNote.includes('ruled out') &&
    !beatNote.includes('will miss');

  // 2. Hard Roster / Official Ruling Exclusions
  if (
    !isIrReturnQuestionable &&
    (rosterBucket === 'ir' ||
      rosterBucket === 'injuredreserveorout' ||
      rosterBucket === 'pup' ||
      rosterBucket === 'suspended' ||
      statusRaw === 'out' ||
      statusRaw === 'ir' ||
      statusRaw === 'injured reserve' ||
      statusRaw === 'suspended' ||
      beatNote.includes('ruled out') ||
      beatNote.includes('will miss ') ||
      beatNote.includes('placed on injured reserve') ||
      beatNote.includes('looking to get reinstated'))
  ) {
    factors.push('Officially inactive (Out / Reserve / Reinstatement pending)');
    return {
      probabilityPct: 0,
      tier: 'OUT',
      badgeLabel: '0% • Out',
      priorUsed: prior,
      factors
    };
  }

  if (isIrReturnQuestionable) {
    factors.push('21-day IR practice window active; officially listed Questionable for activation');
    if (beatNote.includes('likely will be activated') || beatNote.includes('expected to be activated')) {
      factors.push('Coaching staff signaled likely roster activation ahead of kickoff');
    }
  }

  const wed = normalizePracticeCode(input.wed, injuryType);
  const thu = normalizePracticeCode(input.thu, injuryType);
  const fri = normalizePracticeCode(input.fri, injuryType);

  // Healthy / Unlisted Active Player
  if (
    !injuryType &&
    !statusRaw &&
    wed === 'NONE' &&
    thu === 'NONE' &&
    fri === 'NONE' &&
    !beatNote.includes('questionable') &&
    !beatNote.includes('doubtful')
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

  if (isPureVetRest && statusRaw !== 'doubtful') {
    factors.push(`Habitual Veteran Rest prior (${name || 'Veteran'} maintenance schedule)`);
    return {
      probabilityPct: 98,
      tier: 'ACTIVE',
      badgeLabel: '98% • Vet Rest (Full Go)',
      priorUsed: prior,
      factors
    };
  }

  // 4. Base Probability from Game Designation or Practice Progression
  let prob = 0.78;

  if (statusRaw === 'doubtful') {
    prob = 0.10 + (prior.questionablePlayRate - 0.78) * 0.25;
    factors.push('Official Doubtful tag (NFL historical base ~10–14%)');
  } else if (
    statusRaw === 'active' ||
    statusRaw === 'healthy' ||
    beatNote.includes('does not have a designation') ||
    beatNote.includes("doesn't have a designation") ||
    beatNote.includes('does not carry an official injury designation') ||
    beatNote.includes('no injury designation') ||
    beatNote.includes('good to go') ||
    beatNote.includes('set to return') ||
    beatNote.includes('prepared to return')
  ) {
    prob = 0.95;
    factors.push('Cleared without restrictive game-day designation');
  } else {
    // Derive base from Wed/Thu/Fri practice progression
    if (fri === 'FP') {
      prob = 0.93;
      factors.push('Logged Full Participation (FP) on Friday');
    } else if (fri === 'LP') {
      if (wed === 'DNP' && thu === 'DNP') {
        prob = 0.56;
        factors.push('Late-week salvage (DNP/DNP/LP); requires pre-game warmup clearance');
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
      // Mid-week (before Friday report is finalized)
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
      } else if (statusRaw === 'questionable') {
        prob = prior.questionablePlayRate;
        factors.push(
          `Questionable tag adjusted by player career prior (${Math.round(prior.questionablePlayRate * 100)}%)`
        );
      }
    }
  }

  // 5. Player-Specific Toughness vs. Chronic Body-Part Adjustment
  const matchesChronicPart = prior.chronicParts.some(part => injuryLower.includes(part.toLowerCase()));
  if (matchesChronicPart && prob < 0.93) {
    if (name === 'Trent Williams' && injuryLower.includes('ankle') && fri !== 'FP') {
      prob = Math.min(prob, prior.acuteAnklePlayRate || 0.56);
      factors.push('Trent Williams acute ankle adjustment (historically lower active rate than NIR-Rest)');
    } else {
      prob -= 0.07;
      factors.push(`Matches player's documented chronic history (${injuryType})`);
    }
  } else if (prior.questionablePlayRate >= 0.88 && prob >= 0.45 && prob < 0.93) {
    prob += 0.05;
    factors.push('High pain-tolerance / toughness prior (+5% boost)');
  }

  // 6. Injury Biomechanics Modifier (Soft-tissue speed risk vs upper-extremity pain management)
  if (SOFT_TISSUE_KEYWORDS.some(k => injuryLower.includes(k)) && prob < 0.92) {
    prob -= 0.05;
    factors.push(`Soft-tissue re-aggravation caution (${injuryType})`);
  } else if (MINOR_PAIN_TOLERANCE_KEYWORDS.some(k => injuryLower.includes(k)) && prob >= 0.50 && prob < 0.95) {
    prob += 0.04;
    factors.push(`Manageable pain-tolerance injury profile (${injuryType})`);
  }

  // 7. Beat Context Refinements
  if (beatNote.includes('long shot') || beatNote.includes('unlikely to play')) {
    prob = Math.min(prob, 0.22);
    factors.push('Beat consensus: unlikely / long shot for kickoff');
  } else if (beatNote.includes('game-time decision') || beatNote.includes('50-50')) {
    prob = Math.max(0.42, Math.min(0.64, prob));
    factors.push('Coaching/beat note: true pre-game warmup decision');
  } else if (
    beatNote.includes('expected to play') ||
    beatNote.includes('on track to play') ||
    beatNote.includes('likely will be activated') ||
    beatNote.includes('expected to be activated')
  ) {
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
