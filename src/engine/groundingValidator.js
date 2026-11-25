/**
 * Real-Time Roster & Data Grounding Engine + Anti-Hallucination Validator
 * Ensures zero stale-weight LLM or synthesis hallucinations across News Briefs,
 * Deep Scouting/Cap Analyses, Autopodcasts, and Cloudflare Worker prompts.
 */

import { KNOWN_FORMER_49ERS_COACHES } from './linkIntegrity.js';
import { getActiveTeamConfig, getTeamCoaches, resolveTeamConfig } from '../config/teamRegistry.js';

function normPlayerKey(name = '') {
  return String(name || '')
    .toLowerCase()
    .replace(/\b(jr\.?|sr\.?|ii|iii|iv)\b/g, '')
    .replace(/[^a-z0-9]/g, '')
    .trim();
}

/**
 * Retired or departed former 49ers that pre-2026 LLM weights frequently hallucinate
 * onto the current active 49ers rotation. Dynamically cross-checked against the live
 * `rosterPlayers` array so any player actually on the active/IR/PS roster is ALWAYS allowed.
 */
export const KNOWN_FORMER_OR_RETIRED_49ERS = [
  'Bryce Huff',
  'Javon Hargrave',
  'Charvarius Ward',
  'Talanoa Hufanga',
  'Aaron Banks',
  'Leonard Floyd',
  'Maliek Collins',
  'Jordan Mason',
  'Elijah Mitchell',
  'Jauan Jennings',
  'Arik Armstead',
  'Chase Young',
  'Randy Gregory',
  'Clelin Ferrell',
  'Sebastian Joseph-Day',
  'Javon Kinlaw',
  'Ambry Thomas',
  'Isaiah Oliver',
  'Tashaun Gipson',
  'Logan Ryan',
  'Rock Ya-Sin',
  'Isaac Yiadom',
  'De\'Vondre Campbell',
  'Oren Burks',
  'Demetrius Flannigan-Fowles',
  'Jaylon Moore',
  'Jon Feliciano',
  'Spencer Burford',
  'Ray-Ray McCloud',
  'Ronnie Bell',
  'Danny Gray',
  'Chris Conley',
  'Mitch Wishnowsky',
  'Taybor Pepper',
  'Jake Moody',
  'Sam Darnold',
  'Joshua Dobbs',
  'Brandon Allen',
  'Trey Lance',
  'Jimmy Garoppolo'
];

/**
 * Returns the list of former/retired players that are confirmed NOT on the live team roster.
 * For `SF`, uses the hand-verified 49ers list plus any auto-derived `departedPlayers`.
 * For other NFL teams (`DET`, `BUF`, etc.), uses the team's auto-derived `departedPlayers`.
 */
export function getDisallowedFormerPlayers(rosterPlayers = [], options = {}) {
  const team = resolveTeamConfig(options?.team || getActiveTeamConfig());
  const liveSet = new Set((rosterPlayers || []).map(p => normPlayerKey(p?.name || p)));
  const extraDeparted = Array.isArray(options?.departedPlayers)
    ? options.departedPlayers.map(p => (typeof p === 'string' ? p : p?.name)).filter(Boolean)
    : [];
  const baseList =
    team.abbr === 'SF'
      ? [...new Set([...KNOWN_FORMER_OR_RETIRED_49ERS, ...extraDeparted])]
      : [...new Set(extraDeparted)];
  return baseList.filter(name => !liveSet.has(normPlayerKey(name)));
}

export function getDisallowedFormer49ers(rosterPlayers = []) {
  const liveSet = new Set((rosterPlayers || []).map(p => normPlayerKey(p?.name || p)));
  return KNOWN_FORMER_OR_RETIRED_49ERS.filter(name => !liveSet.has(normPlayerKey(name)));
}

/**
 * Audits any generated or synthesized text against the live 49ers roster to verify
 * zero retired or departed former 49ers are falsely referenced as current active 49ers players,
 * while permitting accurate historical, 2026 dead-cap, opponent, or external trade-target references.
 */
export function validateNoHallucinatedRosterClaims(text = '', rosterPlayers = [], options = {}) {
  const hay = String(text || '');
  if (!hay.trim()) return { valid: true, ok: true, violations: [] };

  const team = resolveTeamConfig(options?.team || getActiveTeamConfig());
  const isSf = team.abbr === 'SF';
  const disallowed = isSf
    ? [...getDisallowedFormerPlayers(rosterPlayers, { team, departedPlayers: options?.departedPlayers }), ...KNOWN_FORMER_49ERS_COACHES]
    : getDisallowedFormerPlayers(rosterPlayers, { team, departedPlayers: options?.departedPlayers });
  if (disallowed.length === 0) return { valid: true, ok: true, violations: [] };
  const formerCoachSet = isSf ? new Set(KNOWN_FORMER_49ERS_COACHES) : new Set();
  const violations = [];
  const historicalOrExternalContextRe =
    /\b(retired|former|departed|ex-49er|no longer|not currently on|not on the active|not on the 2026|not on the live|waived|released|signed elsewhere|free agency departure|dead\s*cap|dead\s*money|post-june|void\s*year|trade\s*target|trade\s*candidate|trade\s*fit|seller|49ers|niners|san\s*francisco|patriots|new\s*england|raiders|las\s*vegas|rams|los\s*angeles|chargers|cowboys|dallas|eagles|philadelphia|commanders|washington|giants|new\s*york|jets|lions|detroit|buccaneers|tampa|panthers|carolina|cardinals|arizona|chiefs|kansas\s*city|broncos|denver|bills|buffalo|dolphins|miami|ravens|baltimore|bengals|cincinnati|browns|cleveland|steelers|pittsburgh|saints|new\s*orleans|colts|indianapolis|vikings|minnesota|texans|houston|falcons|atlanta|bears|chicago|titans|tennessee|jaguars|jacksonville|seahawks|seattle|packers|green\s*bay)\b/i;
  const strictDisallowedOnlyRe =
    /\b(not on the|no longer|former|departed|disallowed|never on|ex-49er|previously)\b/i;
  const externalTeamCoachRoleRe =
    /\b(?:titans|tennessee|texans|houston|dolphins|miami|raiders|las\s+vegas|jets|new\s+york|falcons|atlanta|saints|new\s+orleans|browns|cleveland|cardinals|arizona|panthers|carolina|bears|chicago|colts|indianapolis|jaguars|jacksonville|vikings|minnesota|seahawks|seattle|rams|los\s+angeles|chargers|chiefs|kansas\s+city|broncos|denver|bills|buffalo|patriots|new\s+england|ravens|baltimore|bengals|cincinnati|steelers|pittsburgh|cowboys|dallas|eagles|philadelphia|giants|commanders|washington|lions|detroit|packers|green\s+bay|buccaneers|tampa)\b(?:'s|’s)?\s+(?:head\s+coach|coach|hc|oc|dc|offensive\s+coordinator|defensive\s+coordinator|coordinator|staff)\b/i;

  for (const formerName of disallowed) {
    const escaped = formerName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/['’]/g, "['’]?");
    const re = new RegExp(`\\b${escaped}\\b`, 'gi');
    let match;
    while ((match = re.exec(hay)) !== null) {
      const start = Math.max(0, match.index - 130);
      const end = Math.min(hay.length, match.index + formerName.length + 130);
      const windowSlice = hay.slice(start, end);
      if (formerCoachSet.has(formerName)) {
        const isAllowedCoachMention =
          strictDisallowedOnlyRe.test(windowSlice) || externalTeamCoachRoleRe.test(windowSlice);
        if (!isAllowedCoachMention) {
          violations.push(formerName);
          break;
        }
        continue;
      }
      const allowedRe = formerName === 'Bryce Huff' ? strictDisallowedOnlyRe : historicalOrExternalContextRe;
      if (!allowedRe.test(windowSlice)) {
        violations.push(formerName);
        break;
      }
    }
  }

  const isClean = violations.length === 0;
  return {
    valid: isClean,
    ok: isClean,
    violations
  };
}

const FORMER_49ER_POSITION_GROUP = {
  'Jimmy Garoppolo': 'QB',
  'Trey Lance': 'QB',
  'Sam Darnold': 'QB',
  'Joshua Dobbs': 'QB',
  'Brandon Allen': 'QB',
  'Jordan Mason': 'RB',
  'Elijah Mitchell': 'RB',
  'Jerick McKinnon': 'RB',
  'Tyrion Davis-Price': 'RB',
  'Ray-Ray McCloud': 'WR',
  'Danny Gray': 'WR',
  'Willie Snead': 'WR',
  'Ronnie Bell': 'WR',
  'Charlie Woerner': 'TE',
  'Cameron Latu': 'TE',
  'Ross Dwelley': 'TE',
  'Aaron Banks': 'OL',
  'Jaylon Moore': 'OL',
  'Jon Feliciano': 'OL',
  "De'Vondre Campbell": 'LB',
  'Oren Burks': 'LB',
  'Azeez Al-Shaair': 'LB',
  'Demetrius Flannigan-Fowles': 'LB',
  'Charvarius Ward': 'DB',
  'Talanoa Hufanga': 'DB',
  'Tashaun Gipson': 'DB',
  'Isaiah Oliver': 'DB',
  'Ambry Thomas': 'DB',
  'Isaac Yiadom': 'DB',
  "Rock Ya-Sin": 'DB',
  'Jake Moody': 'ST',
  'Mitch Wishnowsky': 'ST',
  'Robert Saleh': 'DC',
  'Nick Sorensen': 'DC',
  'Steve Wilks': 'DC',
  'DeMeco Ryans': 'DC',
  'Mike McDaniel': 'OC',
  'Klint Kubiak': 'OC'
};

/**
 * Replaces any accidental stale/retired player reference in generated text with
 * verified active 49ers players at the matching position group from `rosterPlayers`.
 */
export function sanitizeHallucinatedRosterText(text = '', rosterPlayers = [], options = {}) {
  let out = String(text || '');
  if (!out) return out;

  const team = resolveTeamConfig(options?.team || getActiveTeamConfig());
  const check = validateNoHallucinatedRosterClaims(out, rosterPlayers, {
    team,
    departedPlayers: options?.departedPlayers
  });
  if (check.valid) return out;

  const active = (rosterPlayers || []).filter(p => p.rosterBucket === 'active');
  if (team.abbr !== 'SF') {
    const activeStarterFallback = active[0]?.name || `${team.nickname} rotation`;
    for (const badName of check.violations) {
      const escaped = badName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/['’]/g, "['’]?");
      const re = new RegExp(`\\b${escaped}\\b`, 'gi');
      out = out.replace(re, activeStarterFallback);
    }
    return out;
  }

  const activeEdges = active
    .filter(p => ['DE', 'EDGE', 'OLB'].includes(p.position) && !/bosa/i.test(p.name))
    .map(p => p.name);
  const fallbackEdge = activeEdges[0] || 'Mykel Williams';

  const pickActiveByGroup = grp => {
    if (grp === 'QB') return active.find(p => p.position === 'QB')?.name || 'Brock Purdy';
    if (grp === 'RB') return active.find(p => p.position === 'RB')?.name || 'Christian McCaffrey';
    if (grp === 'WR') return active.find(p => p.position === 'WR')?.name || 'Ricky Pearsall';
    if (grp === 'TE') return active.find(p => p.position === 'TE')?.name || 'George Kittle';
    if (grp === 'OL') return active.find(p => ['OT', 'T', 'G', 'C', 'OL', 'OG'].includes(p.position))?.name || 'Dominick Puni';
    if (grp === 'LB') return active.find(p => ['LB', 'ILB', 'MLB'].includes(p.position))?.name || 'Fred Warner';
    if (grp === 'DB') return active.find(p => ['CB', 'S', 'DB', 'FS', 'SS'].includes(p.position))?.name || 'Deommodore Lenoir';
    if (grp === 'ST') return active.find(p => ['K', 'P', 'LS'].includes(p.position))?.name || fallbackEdge;
    if (grp === 'DC') return 'Raheem Morris';
    if (grp === 'OC') return 'Klay Kubiak';
    return fallbackEdge;
  };

  for (const badName of check.violations) {
    const replacement = pickActiveByGroup(FORMER_49ER_POSITION_GROUP[badName] || 'EDGE');
    const escaped = badName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/['’]/g, "['’]?");
    const re = new RegExp(`\\b${escaped}\\b`, 'gi');
    out = out.replace(re, replacement);
  }
  return out;
}

/**
 * Parses a Vegas betting spread string (e.g. "SF -2.5", "BUF -3.5", "DET -6.5", "PK")
 * into the active team's point margin, market-implied win probability, and an explicit
 * tone-calibration directive so AI briefs, podcasts, and matchup breakdowns never over-hype
 * the team in tight or competitive games.
 */
export function describeSpreadCalibration(spreadStr = '', oppName = '', oppRecord = '', teamInput = null) {
  const team = resolveTeamConfig(teamInput || getActiveTeamConfig());
  const teamCity = team.city || 'San Francisco';
  const teamNick = team.nickname || '49ers';
  const teamAbbr = team.abbr || 'SF';
  const raw = String(spreadStr || '').trim();
  const oppLabel = oppName
    ? `${oppName}${oppRecord && oppRecord !== '—' ? ` (${oppRecord})` : ''}`
    : 'the opponent';

  if (!raw || /^(?:—|tbd|n\/a|off)$/i.test(raw)) {
    return {
      rawSpread: raw || 'TBD',
      sfMargin: null,
      impliedSfWinPct: null,
      tier: 'unknown',
      tierLabel: 'Unpriced Matchup',
      guidanceLine: `Market Spread TBD vs. ${oppLabel}: maintain an impartial, two-sided analytical lens giving equal respect to both teams' strengths, vulnerabilities, and paths to win.`
    };
  }

  let sfMargin = null;
  if (/\b(?:pk|pick|even)\b/i.test(raw)) {
    sfMargin = 0;
  } else {
    const m = raw.match(/([A-Z]{2,3})?\s*([+-]?\d+(?:\.\d+)?)/i);
    if (m) {
      const teamToken = String(m[1] || '').toUpperCase();
      const val = parseFloat(m[2]);
      if (Number.isFinite(val)) {
        const isOurToken =
          !teamToken ||
          teamToken === teamAbbr ||
          teamToken === String(team.espnAbbr || '').toUpperCase() ||
          teamToken === String(team.pfrAbbr || '').toUpperCase();
        if (isOurToken) {
          sfMargin = -val; // e.g., "BUF -3.5" -> +3.5 team margin; "BUF +3.5" -> -3.5 team margin
        } else {
          sfMargin = val; // e.g., "KC -2.5" -> -2.5 team margin
        }
      }
    }
  }

  if (sfMargin === null || !Number.isFinite(sfMargin)) {
    return {
      rawSpread: raw,
      sfMargin: null,
      impliedSfWinPct: null,
      tier: 'unknown',
      tierLabel: 'Competitive Matchup',
      guidanceLine: `Market Line (${raw}) vs. ${oppLabel}: maintain an even-handed national-analyst lens weighing both teams' unit advantages and credible paths to victory.`
    };
  }

  const impliedSfWinPct = Math.max(
    5,
    Math.min(95, Math.round(100 / (1 + Math.exp(-0.135 * sfMargin))))
  );
  const absMargin = Math.abs(sfMargin);

  let tier = 'toss_up';
  let tierLabel = 'Tight Coin-Flip / One-Score Game';
  let directive = `give roughly equal (~50/50) analytical weight to BOTH how ${teamCity} can win AND how ${oppLabel} can legitimately beat ${teamCity}; never sound effusive or treat a ${absMargin.toFixed(1).replace(/\.0$/, '')}-point line like a mismatch.`;

  if (sfMargin >= 7.0) {
    tier = 'clear_favorite';
    tierLabel = 'Clear Favorite (Still Test Failure Modes)';
    directive = `acknowledge ${teamCity}'s statistical advantage while still crediting ${oppLabel}'s best units/stars and spelling out ${teamCity}'s real failure modes and bottom-half NFL metrics.`;
  } else if (sfMargin > 3.5) {
    tier = 'moderate_favorite';
    tierLabel = 'Moderate Favorite (Competitive Test)';
    directive = `weigh ${teamCity}'s edge candidly alongside ${oppLabel}'s clearest upset script, top unit advantages, and ${teamCity}'s verified vulnerabilities.`;
  } else if (sfMargin >= -3.5) {
    tier = 'toss_up';
    tierLabel =
      sfMargin > 0
        ? 'Tight One-Score Favorite / Near Coin-Flip'
        : sfMargin < 0
          ? 'Tight One-Score Underdog / Near Coin-Flip'
          : 'True Pick-Em Coin-Flip';
    directive = `treat this strictly as a competitive one-score coin-flip (~${impliedSfWinPct}% ${teamAbbr} / ~${100 - impliedSfWinPct}% opp implied); devote roughly equal (~50/50) analytical weight to BOTH teams' strengths, vulnerabilities, and paths to win—avoid any effusive or one-sided ${teamNick} framing.`;
  } else if (sfMargin > -7.0) {
    tier = 'moderate_underdog';
    tierLabel = 'Moderate Underdog';
    directive = `candidly explain why the market favors ${oppLabel} (~${100 - impliedSfWinPct}% implied win prob) and identify the specific tactical swings ${teamCity} needs to pull the upset.`;
  } else {
    tier = 'clear_underdog';
    tierLabel = 'Clear Underdog';
    directive = `be transparent about why ${oppLabel} is heavily favored (~${100 - impliedSfWinPct}% implied win prob) and focus realistically on ${teamCity}'s narrow upset conditions.`;
  }

  return {
    rawSpread: raw,
    sfMargin,
    impliedSfWinPct,
    tier,
    tierLabel,
    guidanceLine: `Market Spread ${raw} (~${impliedSfWinPct}% implied ${teamAbbr} win prob — ${tierLabel} vs. ${oppLabel}): ${directive}`
  };
}

/**
 * Symmetric, strictly data-driven 32-team unit matchup advantage classifier.
 * Never defaults to SF-favorable labels when the opponent holds equal or superior league ranks.
 * Lower rank number = better (#1 best, #32 worst).
 */
export function classifySymmetricUnitAdvantage(
  sfRank,
  oppRank,
  oppAbbr = 'OPP',
  {
    tieLabel = 'Even Matchup',
    strengthVsStrengthLabel = 'Strength vs. Strength',
    sfEdgeLabel = null,
    sfHeavyLabel = null,
    oppEdgeLabel = null,
    oppHeavyLabel = null,
    edgeThreshold = 6,
    heavyThreshold = 14
  } = {}
) {
  const sfR = Number(sfRank);
  const oppR = Number(oppRank);
  const activeAbbr = getActiveTeamConfig()?.abbr || 'SF';
  const resolvedSfEdge = sfEdgeLabel || `${activeAbbr} Edge`;
  const resolvedSfHeavy = sfHeavyLabel || `${activeAbbr} Heavy Edge`;
  const cleanOpp = String(oppAbbr || 'OPP').toUpperCase();
  if (!Number.isFinite(sfR) || !Number.isFinite(oppR)) {
    return tieLabel;
  }
  const delta = oppR - sfR; // positive => active team ranks better; negative => opponent ranks better
  if (delta >= heavyThreshold) return resolvedSfHeavy;
  if (delta >= edgeThreshold) return resolvedSfEdge;
  if (delta <= -heavyThreshold) return oppHeavyLabel || `${cleanOpp} Heavy Edge`;
  if (delta <= -edgeThreshold) return oppEdgeLabel || `${cleanOpp} Edge`;
  if (sfR <= 8 && oppR <= 8) return strengthVsStrengthLabel;
  return tieLabel;
}

/**
 * Builds a concise, symmetric League-Wide & Opponent Comparison Context Block directly from
 * verified 32-team `teamStats`, `upcomingMatchup`, and `powerRankings` so LLMs see BOTH
 * San Francisco's flaws and the opponent's top-10 units side-by-side.
 */
export function buildBalancedLeagueComparisonBlock(appData = {}, { compact = false } = {}) {
  const team = resolveTeamConfig(appData?.meta?.teamAbbr || appData?.meta?.teamSlug || getActiveTeamConfig());
  const teamAbbr = team.abbr || 'SF';
  const teamNickUp = String(team.nickname || '49ers').toUpperCase();
  const sm = appData?.scheduleMatchup || {};
  const um = sm.upcomingMatchup || {};
  const oppAbbr = String(um.oppAbbr || '').toUpperCase();
  const oppName = um.oppName || oppAbbr || 'Opponent';
  const units = sm.teamStats?.units || [];
  const lines = [];

  // 1. Spread & Market Calibration
  if (um.oppName || um.betting?.spread) {
    const cal = describeSpreadCalibration(um.betting?.spread || '', oppName, um.oppRecord || '', team);
    lines.push(`SPREAD & TONE CALIBRATION: ${cal.guidanceLine}`);
  }

  // 2. Extract 32-team Active Team & Opponent unit ranks
  const allRows = [];
  for (const u of units) {
    for (const r of u.coreRows || []) allRows.push(r);
    for (const g of u.expandedGroups || []) {
      for (const r of g.rows || []) allRows.push(r);
    }
  }

  const sfWeaknesses = [];
  const sfStrengths = [];
  const oppAdvantages = [];
  const sfAdvantages = [];
  const seenKeys = new Set();

  for (const r of allRows) {
    if (!r?.key || seenKeys.has(r.key) || !Array.isArray(r.leaderboard)) continue;
    seenKeys.add(r.key);
    const sf = r.leaderboard.find(x => x.team === teamAbbr);
    const op = oppAbbr && oppAbbr !== 'TBD' && oppAbbr !== 'BYE'
      ? r.leaderboard.find(x => x.team === oppAbbr)
      : null;

    if (sf && Number.isFinite(Number(sf.rank))) {
      const sfRank = Number(sf.rank);
      if (sfRank >= 17) {
        sfWeaknesses.push({ label: r.label, rank: sfRank, disp: sf.disp });
      } else if (sfRank <= 8) {
        sfStrengths.push({ label: r.label, rank: sfRank, disp: sf.disp });
      }
      if (op && Number.isFinite(Number(op.rank))) {
        const oppRank = Number(op.rank);
        const diff = sfRank - oppRank; // positive => opponent ranks better than active team
        if (oppRank <= 10 || diff >= 6) {
          if (diff >= 4 || (oppRank <= 5 && diff >= 0)) {
            oppAdvantages.push({
              label: r.label,
              sfRank,
              sfDisp: sf.disp,
              oppRank,
              oppDisp: op.disp,
              diff
            });
          }
        }
        if (sfRank <= 10 && oppRank - sfRank >= 6) {
          sfAdvantages.push({
            label: r.label,
            sfRank,
            sfDisp: sf.disp,
            oppRank,
            oppDisp: op.disp,
            diff: oppRank - sfRank
          });
        }
      }
    }
  }

  sfWeaknesses.sort((a, b) => b.rank - a.rank);
  sfStrengths.sort((a, b) => a.rank - b.rank);
  oppAdvantages.sort((a, b) => b.diff - a.diff || a.oppRank - b.oppRank);
  sfAdvantages.sort((a, b) => b.diff - a.diff || a.sfRank - b.sfRank);

  const maxWeak = compact ? 8 : 10;
  const maxAdv = compact ? 7 : 10;

  if (sfWeaknesses.length > 0) {
    lines.push(
      `${teamNickUp} LEAGUE-WIDE VULNERABILITIES (BOTTOM-HALF NFL RANKS — DO NOT OMIT): ${sfWeaknesses
        .slice(0, maxWeak)
        .map(w => `${w.label} #${w.rank} (${w.disp})`)
        .join(' | ')}`
    );
  }
  if (sfStrengths.length > 0) {
    lines.push(
      `${teamNickUp} LEAGUE-WIDE STRENGTHS (TOP-8 NFL RANKS): ${sfStrengths
        .slice(0, compact ? 6 : 8)
        .map(s => `${s.label} #${s.rank} (${s.disp})`)
        .join(' | ')}`
    );
  }
  if (oppAdvantages.length > 0) {
    lines.push(
      `${oppName.toUpperCase()} MAJOR STATISTICAL ADVANTAGES OVER ${teamAbbr} (GIVE FULL CREDIT): ${oppAdvantages
        .slice(0, maxAdv)
        .map(a => `${a.label}: ${oppAbbr} #${a.oppRank} (${a.oppDisp}) vs ${teamAbbr} #${a.sfRank} (${a.sfDisp})`)
        .join(' | ')}`
    );
  }
  if (sfAdvantages.length > 0) {
    lines.push(
      `${teamNickUp} MAJOR STATISTICAL ADVANTAGES OVER ${oppAbbr}: ${sfAdvantages
        .slice(0, maxAdv)
        .map(a => `${a.label}: ${teamAbbr} #${a.sfRank} (${a.sfDisp}) vs ${oppAbbr} #${a.oppRank} (${a.oppDisp})`)
        .join(' | ')}`
    );
  }

  // 3. Opponent Healthy Stars & Key Injuries (so opponent is never invisible in podcasts/analyses)
  const oppHealthy = um.opponentHealth?.keyStartersHealthy || [];
  const oppInj = um.opponentHealth?.injuryReport || [];
  if (oppHealthy.length > 0) {
    const oppStarLine = oppHealthy
      .slice(0, compact ? 8 : 12)
      .map(
        p =>
          `${p.name} (${p.depthSlot || p.position}${p.statLine2026 ? `: ${p.statLine2026}` : ''})`
      )
      .join('; ');
    lines.push(`${oppName.toUpperCase()} KEY HEALTHY STARTERS: ${oppStarLine}`);
  }
  if (oppInj.length > 0) {
    const oppInjLine = oppInj
      .slice(0, compact ? 6 : 10)
      .map(p => `${p.name} (${p.depthSlot || p.position}, ${p.injuryType || 'Injury'}: ${p.playBadgeLabel || p.gameStatus})`)
      .join('; ');
    lines.push(`${oppName.toUpperCase()} INJURY WATCH: ${oppInjLine}`);
  }

  // 4. National Power Rankings Consensus & Skeptics
  const pr = sm.powerRankings;
  if (pr && pr.consensusRank != null && Array.isArray(pr.sources) && pr.sources.length > 0) {
    const lowEnd = [...pr.sources].sort((a, b) => Number(b.rank) - Number(a.rank))[0];
    const highEnd = [...pr.sources].sort((a, b) => Number(a.rank) - Number(b.rank))[0];
    lines.push(
      `NATIONAL POWER RANKINGS CONSENSUS: ${teamAbbr} #${pr.consensusRank} avg (${pr.rangeShort || `#${pr.consensusRank}`} across ${pr.sources.length} verified models — highest: ${highEnd?.shortName || highEnd?.outlet} #${highEnd?.rank}, most skeptical: ${lowEnd?.shortName || lowEnd?.outlet} #${lowEnd?.rank}).`
    );
  }

  return lines.join('\n');
}

/**
 * Builds the strict internal system prompt used across ALL LLM-generated surfaces
 * (Deep Scouting/Cap Analysis, Autopodcast scripts, News Synthesis, Cloudflare Worker).
 */
export function buildLiveGroundingSystemPrompt(appData = null) {
  const meta = appData?.meta || {};
  const team = resolveTeamConfig(meta.teamAbbr || meta.teamSlug || getActiveTeamConfig());
  const rosterPlayers = appData?.roster?.players || [];
  const departedPlayers = appData?.roster?.departedPlayers || [];
  const syncStamp = meta.updatedAt || new Date().toISOString();

  if (team.abbr !== 'SF') {
    const disallowedSample = getDisallowedFormerPlayers(rosterPlayers, { team, departedPlayers })
      .slice(0, 22)
      .join(', ');
    const coaches = meta.coaches || team.coachesSeed || {};
    const coachLine = [
      coaches.hc ? `Head Coach ${coaches.hc}` : null,
      coaches.oc ? `Offensive Coordinator ${coaches.oc}` : null,
      coaches.dc ? `Defensive Coordinator ${coaches.dc}` : null,
      coaches.gm ? `GM ${coaches.gm}` : null
    ]
      .filter(Boolean)
      .join('; ');
    const tendencies = meta.schemeTendencies || null;
    const tendencyNote = tendencies
      ? ` Live ${meta.seasonYear || 2026} play-calling profile: ${[
          tendencies.passRatePct != null ? `${tendencies.passRatePct}% pass rate` : null,
          tendencies.shotgunPct != null ? `${tendencies.shotgunPct}% shotgun` : null,
          tendencies.playActionPct != null ? `${tendencies.playActionPct}% play-action` : null,
          tendencies.noHuddlePct != null ? `${tendencies.noHuddlePct}% no-huddle` : null
        ]
          .filter(Boolean)
          .join(', ')}.`
      : '';
    const cap26 = appData?.cap?.years?.[String(meta.seasonYear || 2026)] || {};
    const cap27 = appData?.cap?.years?.[String(Number(meta.seasonYear || 2026) + 1)] || {};
    const topBeatNames = (appData?.reporters?.reporters || [])
      .filter(r => !r.isPodiumSubject && Number(r.trustTier || 2) === 1)
      .slice(0, 12)
      .map(r => r.name)
      .join(', ');

    return [
      `You are an independent Lead Football Intelligence Analyst for "${team.brandName}", a high-IQ ${team.fullName} briefing platform.`,
      'UNHURRIED HIGH-THINKING MANDATE — PRIORITIZE ACCURACY & ANALYTICAL QUALITY OVER GENERATION TIME:',
      '0. Achieve 100% factual accuracy, exact CBA cap arithmetic, and coaching-tape analytical depth with focused, non-repetitive internal reasoning: consult the AUTHORITATIVE LIVE REAL-TIME DATA SNAPSHOT first, run at most 1–2 targeted Google Search queries ONLY if a post-snapshot external fact is genuinely needed, and avoid redundant internal re-drafting loops.',
      `1. NEVER rely on stale pre-trained model weights for roster membership, retired players, trades, free-agent signings, coaching staff, win-loss-tie records, draft pick inventory, or injury designations. Anchor strictly to the AUTHORITATIVE LIVE REAL-TIME DATA SNAPSHOT (synced ${syncStamp}) and live Google Search Grounding.`,
      '2. COACHING, CAP & DRAFT RULES OF TRUTH:',
      `   - Coaching Staff (${meta.seasonYear || 2026} verified): ${coachLine || `Verify current ${team.fullName} coaching staff against the live snapshot.`}${tendencyNote} Never cite former coaches as still on the ${team.nickname} staff.`,
      `   - Multi-Year CBA Cap Math (WHEN CAP/CONTRACTS ARE RELEVANT): Anchor strictly to ${team.fullName}'s live OverTheCap numbers in the snapshot (${meta.seasonYear || 2026} cap space: ${cap26.capSpace != null ? `$${Number(cap26.capSpace).toFixed(2)}M` : 'see snapshot'}; ${Number(meta.seasonYear || 2026) + 1} cap space: ${cap27.capSpace != null ? `$${Number(cap27.capSpace).toFixed(2)}M` : 'see snapshot'}) under CBA Article 13 1-for-1 rollover. Do NOT shoehorn unprompted salary-cap boilerplate into injury or game recaps where no contract move occurred.`,
      `   - Draft Capital & Trades: Anchor strictly to ${team.abbr}'s exact draft pick list and completed trades in the snapshot.`,
      disallowedSample
        ? `3. NEVER attribute retired, cut, or departed former ${team.nickname} to the active ${team.nickname} rotation (non-rostered names include: ${disallowedSample}). You may reference them ONLY in verified historical, dead-cap, opponent, or external trade-target context.`
        : `3. Verify every ${team.nickname} player mentioned against the provided LIVE ${team.nickname.toUpperCase()} ROSTER list before citing them in current-season rotations.`,
      `4. FAIR, BALANCED & NON-HOMER ASSESSMENT MANDATE: Evaluate ${team.city} with the exact same sober, league-wide objectivity as an independent national NFL analyst—never as a cheerleader or team PR voice. Use third-person team references ("${team.city}", "the ${team.nickname}", "they"), not first-person fan pronouns ("we/us/our"). Always benchmark ${team.nickname} units against all 32 teams (pairing strengths with bottom-half NFL vulnerabilities), give full analytical credit to opponent coordinators, top-10 units, and star players, and calibrate matchup confidence strictly to the Vegas spread / implied win probability.`,
      '5. INTERNAL MULTI-PASS SELF-AUDIT BEFORE EMITTING A SINGLE WORD: Efficiently cross-check every player name, injury status, 32-team rank, contract figure, pick slot, scheme concept, and playoff probability against the live snapshot—and strip any homer exaggeration or one-sided matchup bias—before outputting.',
      '6. EDITORIAL CHARTER: Zero clickbait, zero rage-bait, zero homer hype, zero filler throat-clearing. Separate Verified Facts, All-22 Film Mechanics (personnel groupings, protection slides, coverage shells, EPA/play, CPOE), and CBA Salary Cap Math.',
      `7. Cite originating beat reporters (${topBeatNames || 'verified team beat reporters, Adam Schefter, Ian Rapoport, Tom Pelissero'}) or open datasets (nflverse, OverTheCap, Tankathon, NextGen Stats).`
    ].join('\n');
  }

  const disallowedSample = getDisallowedFormer49ers(rosterPlayers).slice(0, 22).join(', ');

  return [
    'You are an independent Lead Football Intelligence Analyst for "49ers Faithful", a private, high-IQ San Francisco 49ers briefing platform.',
    'UNHURRIED HIGH-THINKING MANDATE — PRIORITIZE ACCURACY & ANALYTICAL QUALITY OVER GENERATION TIME:',
    '0. Achieve 100% factual accuracy, exact CBA cap arithmetic, and coaching-tape analytical depth with focused, non-repetitive internal reasoning: consult the AUTHORITATIVE LIVE REAL-TIME DATA SNAPSHOT first, run at most 1–2 targeted Google Search queries ONLY if a post-snapshot external fact is genuinely needed, and avoid redundant internal re-drafting loops.',
    `1. NEVER rely on stale pre-trained model weights for roster membership, retired players, trades, free-agent signings, coaching staff, win-loss-tie records, draft pick inventory, or injury designations. Anchor strictly to the AUTHORITATIVE LIVE REAL-TIME DATA SNAPSHOT (synced ${syncStamp}) and live Google Search Grounding.`,
    '2. COACHING, CAP & DRAFT RULES OF TRUTH:',
    '   - Coaching Staff: Head Coach Kyle Shanahan; Offensive Coordinator Klay Kubiak; Defensive Coordinator Raheem Morris (Wide-9 4-man pass rush married to disguised two-high / Cover-3 Buzz / Quarters coverage rotations). Former 49ers coaches Robert Saleh (Titans HC), Nick Sorensen, Steve Wilks, DeMeco Ryans (Texans HC), Mike McDaniel (Dolphins HC), and Klint Kubiak (Raiders HC) are NO LONGER on the 49ers staff.',
    '   - Multi-Year CBA Cap Math (WHEN CAP/CONTRACTS ARE RELEVANT): Whenever a topic or news item actually involves salary cap, contracts, restructures, extensions, or trade/free-agency affordability, pair 2026 Top-51 cap space (~$35.16M+) with the projected 2027 cap deficit (~-$31.54M+) under CBA Article 13 1-for-1 rollover (never portray 2026 cap space as unencumbered spending cash). Do NOT shoehorn unprompted salary-cap boilerplate into game recaps, injury updates, or news summaries where no cap or contract move occurred.',
    '   - Midseason Trade Proration: Acquiring teams absorb only remaining weekly base-salary proration (e.g., 9/18ths at Week 9) while bonus proration stays on the seller ledger—giving SF ~$65M+ of annualized base-salary purchasing power WITHOUT forcing sellers to eat salary, though every 2026 dollar spent deepens the 2027 deficit.',
    '   - 2027 Draft Capital: Anchor to the exact pick list in the snapshot (6 picks total after trading SF\'s own 2027 4th-rounder to Indianapolis for DT DeForest Buckner; Rd 6 via BAL, Rd 7 via KC). Reject Day-2 pick overpays for rentals.',
    '   - Trade Evaluation Rigor: Recommend only verified, real NFL players on true seller/surplus rosters addressing genuine weak links (perimeter WR / 12p move TE, LG pass protection, rotational speed EDGE, Dime CB/S). Expose declining age-cliff traps (e.g., age-37 0-sack Cameron Jordan) and untouchable extended starters (e.g., Michael Mayer).',
    disallowedSample
      ? `3. NEVER attribute retired, cut, or departed former 49ers to the active 49ers rotation (non-rostered names include: ${disallowedSample}). You may reference them ONLY in verified historical, 2026 dead-cap, opponent, or external trade-target context.`
      : '3. Verify every 49ers player mentioned against the provided LIVE 49ERS ROSTER list before citing them in current-season rotations.',
    '4. FAIR, BALANCED & NON-HOMER ASSESSMENT MANDATE: Evaluate San Francisco with the exact same sober, league-wide objectivity as an independent national NFL analyst—never as a cheerleader or team PR voice. Use third-person team references ("San Francisco", "the 49ers", "they"), not first-person fan pronouns ("we/us/our"). Always benchmark 49ers units against all 32 teams (pairing strengths with bottom-half NFL vulnerabilities), give full analytical credit to opponent coordinators, top-10 units, and star players, and calibrate matchup confidence strictly to the Vegas spread / implied win probability (treat ±3.5-point spreads as competitive coin-flips with ~50/50 attention to both teams\' paths to victory).',
    '5. INTERNAL MULTI-PASS SELF-AUDIT BEFORE EMITTING A SINGLE WORD: Efficiently cross-check every player name, injury status, 32-team rank, contract figure, pick slot, scheme concept, and playoff probability against the live snapshot—and strip any homer exaggeration or one-sided matchup bias—before outputting.',
    '6. EDITORIAL CHARTER: Zero clickbait, zero rage-bait, zero homer hype, zero filler throat-clearing. Separate Verified Facts, All-22 Film Mechanics (11/21 personnel, Wide-9 stunt geometry, coverage shells, EPA/play, CPOE), and CBA Salary Cap Math.',
    '7. Cite originating beat reporters (Matt Maiocco, Matt Barrows, Nick Wagoner, Jennifer Lee Chan, David Lombardi, Dieter Kurtenbach, Eric Branch, Cam Inman, Tim Kawakami, Brian Peacock, Eric Crocker, Adam Schefter, Ian Rapoport, Tom Pelissero) or open datasets (nflverse, OverTheCap, Tankathon, NextGen Stats).'
  ].join('\n');
}

/**
 * Builds a comprehensive, up-to-the-minute live data context block injected into
 * every LLM prompt so the model has exact current roster, trades, injuries, cap, picks, and calibrated playoff odds.
 */
export function buildAuthoritativeLiveContextSnapshot(appData = {}, { compactForDossier = false, includeTradeMatrix = true } = {}) {
  const meta = appData?.meta || {};
  const seasonYr = String(meta.seasonYear || 2026);
  const nextYr = String(Number(seasonYr) + 1);
  const cap26 = appData?.cap?.years?.[seasonYr] || appData?.cap?.years?.['2026'] || {};
  const cap27 = appData?.cap?.years?.[nextYr] || appData?.cap?.years?.['2027'] || {};
  const curDeadMoney = Number(cap26.deadMoneyTotal ?? cap26.deadMoney ?? 0);
  const matchup = appData?.scheduleMatchup?.upcomingMatchup || {};
  const rosterPlayers = appData?.roster?.players || [];
  const depthUnits = appData?.depthChart?.units || [];
  const practiceReport = appData?.health?.practiceReport || [];
  const irList = appData?.health?.irAndReserveTracker || [];
  const tw = appData?.seasonal?.tradeWarRoom || {};
  const completedTrades = tw.completed2026Moves || [];
  const topNeeds = tw.topNeeds || [];
  const realisticTargets = tw.realisticTargets || [];
  const pitfalls = tw.pitfallsToAvoid || [];
  const mcSim = appData?.seasonal?.playoffPicture?.baselineSimulation || {};
  const sfOdds = mcSim.sfOdds || {};
  const pickInventory = appData?.seasonal?.draftPrep2027?.pickInventory || [];
  const tradedPicksNote = appData?.seasonal?.draftPrep2027?.tradedPicksNote || '';
  const rawStream = appData?.news?.rawStream || [];

  const activeByGroup = {
    QB: [],
    'RB/FB': [],
    WR: [],
    TE: [],
    OL: [],
    'DL/EDGE': [],
    LB: [],
    DB: [],
    ST: []
  };

  for (const p of rosterPlayers) {
    if (p.rosterBucket !== 'active') continue;
    const tag = `${p.name} (${p.position}${p.jersey != null ? ` #${p.jersey}` : ''}${
      p.health?.status && p.health.status !== 'Active' ? `, ${p.health.status}` : ''
    })`;
    if (p.position === 'QB') activeByGroup.QB.push(tag);
    else if (['RB', 'FB'].includes(p.position)) activeByGroup['RB/FB'].push(tag);
    else if (p.position === 'WR') activeByGroup.WR.push(tag);
    else if (p.position === 'TE') activeByGroup.TE.push(tag);
    else if (['OT', 'T', 'G', 'C', 'OL', 'OG'].includes(p.position)) activeByGroup.OL.push(tag);
    else if (['DE', 'DT', 'DL', 'NT', 'EDGE'].includes(p.position)) activeByGroup['DL/EDGE'].push(tag);
    else if (['LB', 'ILB', 'MLB', 'OLB'].includes(p.position)) activeByGroup.LB.push(tag);
    else if (['CB', 'S', 'DB', 'FS', 'SS'].includes(p.position)) activeByGroup.DB.push(tag);
    else activeByGroup.ST.push(tag);
  }

  const activeRosterLines = Object.entries(activeByGroup)
    .filter(([, arr]) => arr.length > 0)
    .map(([grp, arr]) => `  - ${grp}: ${arr.join(', ')}`)
    .join('\n');

  const depthStarterSummary = depthUnits
    .slice(0, 2)
    .map(u => {
      const starters = (u.rows || [])
        .map(r => `${r.slotLabel || r.position}: ${r.projectedActiveChain?.[0]?.name || r.baselineChain?.[0]?.name || '—'}`)
        .join(', ');
      return `  - ${u.unitName}: ${starters}`;
    })
    .join('\n');

  const irNames = irList
    .map(
      p =>
        `${p.name} (${p.position} - ${p.injuryType}, ${p.status}${p.projectedReturnWeek ? ` • ${p.projectedReturnWeek}` : ''}${Number(p.playProbabilityPct) > 0 && p.playBadgeLabel ? ` • Activation/Play Odds: ${p.playBadgeLabel}` : ''})`
    )
    .join('; ');

  const injuryLines = practiceReport
    .slice(0, 16)
    .map(
      p =>
        `  - ${p.name} (${p.position}): ${p.gameStatus} [${p.injuryType}] • Practice ${p.wed}/${p.thu}/${p.fri} • Play Odds ${p.playBadgeLabel}`
    )
    .join('\n');

  const tradeLines = completedTrades
    .map(m => `  - ${m.player} (${m.position}, acquired from ${m.acquiredFrom}, ${m.timing}${m.costSummary || m.compensation ? ` for ${m.costSummary || m.compensation}` : ''}): ${m.analysis}`)
    .join('\n');

  const needLines = topNeeds
    .map(n => `  - [${n.urgency}] ${n.positionGroup || n.position}: ${n.epaContext || n.rationale}`)
    .join('\n');

  const targetLines = realisticTargets
    .slice(0, 8)
    .map(
      t =>
        `  - ${t.name} (${t.position}, ${t.currentTeam || t.archetype || ''}, Fit ${t.fitScore}/100): Cost ${t.projectedPickCost} | 2026 Buyer Cap ${t.acquiring2026CapHit || (t.prorated2026CapCharge != null ? `$${(t.prorated2026CapCharge / 1_000_000).toFixed(2)}M` : '—')} | 2027 Impact ${t.cap2027Impact || '—'} | ${t.fitBreakdown || t.schemeFit || ''}`
    )
    .join('\n');

  const pitfallLines = pitfalls
    .map(pf => `  - AVOID [${pf.trap || pf.category}]: ${pf.examples || pf.targetExample} — ${pf.whyAvoid || pf.reason}`)
    .join('\n');

  const pickLines = pickInventory
    .map(pk => `Rd ${pk.round}${pk.projectedOverall || pk.overall ? ` (#${pk.projectedOverall || pk.overall})` : ''} [${pk.origin}]`)
    .join(', ');

  const topNfcContenders = (mcSim.allTeamOdds || [])
    .slice(0, 5)
    .map(t => `${t.abbr} (${t.currentRecord || t.record || ''}: #1 Bye ${t.seed1ByePct}%, Div ${t.winDivisionPct}%, Playoffs ${t.makePlayoffsPct}%)`)
    .join(' | ');

  const latestWireLines = rawStream
    .slice(0, 8)
    .map(
      item =>
        `  - [${item.type?.toUpperCase() || 'NEWS'} • ${item.reporterName || item.outletName} • ${item.publishedAt}] ${item.title}`
    )
    .join('\n');

  const team = resolveTeamConfig(meta.teamAbbr || meta.teamSlug || getActiveTeamConfig());
  const coaches = getTeamCoaches(team, meta.coaches);
  const teamNickUp = String(team.nickname || '49ers').toUpperCase();
  const teamOdds = mcSim.teamOdds || mcSim.sfOdds || {};
  const departedPlayers = appData?.roster?.departedPlayers || [];
  const disallowed = getDisallowedFormerPlayers(rosterPlayers, { team, departedPlayers }).slice(0, 20).join(', ');
  const balancedLeagueBlock = buildBalancedLeagueComparisonBlock(appData, {
    compact: compactForDossier
  });
  const coachingStaffLine =
    team.abbr === 'SF'
      ? `COACHING STAFF: HC ${coaches.hc} | OC ${coaches.oc} | DC ${coaches.dc} (Wide-9 4-3 / Nickel 4-2-5 disguised split-safety)`
      : `COACHING STAFF: HC ${coaches.hc} | OC ${coaches.oc} | DC ${coaches.dc}${coaches.gm ? ` | GM ${coaches.gm}` : ''}`;

  return [
    `LIVE TIMESTAMP: ${meta.updatedAt || new Date().toISOString()}`,
    coachingStaffLine,
    `SEASON & RECORD: ${meta.seasonYear || 2026} NFL Season • Week ${meta.currentWeek || 9} • ${team.nickname} Record: ${meta.teamRecord || '—'} (${meta.standingSummary || team.division}, Point Diff: ${meta.pointDifferential || ''})`,
    `CALIBRATED 10,000-RUN PLAYOFF SIMULATION (EMPIRICAL-BAYES + EPA + SOS + NFL SEC. 16 TIEBREAKERS): ${team.abbr} Projected Wins: ${teamOdds.projectedWins ?? '—'} | Playoff Berth: ${teamOdds.makePlayoffsPct ?? '—'}% | Win ${team.division}: ${teamOdds.winDivisionPct ?? '—'}% | #1 Seed First-Round Bye: ${teamOdds.seed1ByePct ?? '—'}%${topNfcContenders ? `\n  ${team.conference} Race Context: ${topNfcContenders}` : ''}`,
    `UPCOMING MATCHUP: Week ${matchup.week || meta.currentWeek || 9} ${matchup.homeAway === 'away' ? '@' : 'vs.'} ${matchup.oppName || ''} (${matchup.oppRecord || ''}) | Kickoff: ${matchup.kickoffDisplay || ''} | Venue: ${matchup.venue || ''} | Spread: ${matchup.betting?.spread || ''} | Total: ${matchup.betting?.overUnder || ''}`,
    balancedLeagueBlock,
    `SALARY CAP & MULTI-YEAR HORIZON (OVERTHECAP LIVE): ${seasonYr} Gross Cap Space: $${(cap26.teamCapSpace || 0).toLocaleString()} | ${seasonYr} Effective Space: $${(cap26.effectiveCapSpace || 0).toLocaleString()} | ${seasonYr} Dead Money: $${curDeadMoney.toLocaleString()} | ${nextYr} Projected Cap Space: $${(cap27.teamCapSpace || 0).toLocaleString()} (Article 13 rollover applies to ${seasonYr} → ${nextYr})`,
    pickLines
      ? `${nextYr} DRAFT PICK INVENTORY (${pickInventory.length} PICKS TOTAL): ${pickLines}${tradedPicksNote ? `\n  Traded Away Note: ${tradedPicksNote}` : ''}`
      : '',
    tradeLines
      ? `VERIFIED ${seasonYr} TRADES & ACQUISITIONS:\n${
          compactForDossier
            ? completedTrades
                .map(
                  m =>
                    `  - ${m.player} (${m.position}, from ${m.acquiredFrom}, ${m.timing}${
                      m.costSummary || m.compensation ? ` for ${m.costSummary || m.compensation}` : ''
                    })`
                )
                .join('\n')
            : tradeLines
        }`
      : '',
    !compactForDossier || includeTradeMatrix ? (needLines ? `TRADE WINDOW RANKED POSITIONAL NEEDS:\n${needLines}` : '') : '',
    !compactForDossier || includeTradeMatrix ? (targetLines ? `TRADE WINDOW VERIFIED TARGET CANDIDATES:\n${targetLines}` : '') : '',
    !compactForDossier || includeTradeMatrix ? (pitfallLines ? `TRADE WINDOW PITFALLS & TRAPS TO AVOID:\n${pitfallLines}` : '') : '',
    depthStarterSummary ? `PROJECTED STARTING LINEUP SNAPSHOT:\n${depthStarterSummary}` : '',
    activeRosterLines ? `AUTHORITATIVE LIVE ${teamNickUp} ACTIVE 53-MAN ROSTER (USE ONLY THESE PLAYERS FOR ACTIVE ROTATIONS):\n${activeRosterLines}` : '',
    irNames ? `${teamNickUp} INJURED RESERVE / OUT LIST: ${irNames}` : '',
    injuryLines ? `UP-TO-THE-MINUTE WEEK ${meta.currentWeek || 9} INJURY & PRACTICE REPORT:\n${injuryLines}` : '',
    !compactForDossier && latestWireLines ? `LATEST LIVE BEAT TWEETS & NEWS WIRE:\n${latestWireLines}` : '',
    disallowed ? `DO NOT CITE AS ACTIVE ${teamNickUp} (RETIRED / DEPARTED): ${disallowed}` : ''
  ]
    .filter(Boolean)
    .join('\n\n');
}

/**
 * Builds a single, deduplicated live context payload for interactive On-Demand AI Analysis
 * across all 32 NFL teams (~9–12 KB instead of ~26.8 KB duplicated dossier + snapshot).
 */
export function buildDeduplicatedAnalysisContext({
  appData = {},
  dossier = null,
  includeTradeMatrix = false,
  mode = 'fast'
} = {}) {
  const meta = appData?.meta || {};
  const team = resolveTeamConfig(meta.teamAbbr || meta.teamSlug || getActiveTeamConfig());
  const isDeep = String(mode || 'fast').toLowerCase() === 'deep';
  const seasonYr = String(meta.seasonYear || 2026);
  const nextYr = String(Number(seasonYr) + 1);
  const cap26 = appData?.cap?.years?.[seasonYr] || appData?.cap?.years?.['2026'] || {};
  const cap27 = appData?.cap?.years?.[nextYr] || appData?.cap?.years?.['2027'] || {};
  const curDeadMoney = Number(cap26.deadMoneyTotal ?? cap26.deadMoney ?? 0);
  const matchup = appData?.scheduleMatchup?.upcomingMatchup || {};
  const rosterPlayers = appData?.roster?.players || [];
  const practiceReport = appData?.health?.practiceReport || [];
  const irList = appData?.health?.irAndReserveTracker || [];
  const tw = appData?.seasonal?.tradeWarRoom || {};
  const mcSim = appData?.seasonal?.playoffPicture?.baselineSimulation || {};
  const teamOdds = mcSim.teamOdds || mcSim.sfOdds || {};
  const pickInventory = appData?.seasonal?.draftPrep2027?.pickInventory || [];
  const tradedPicksNote = appData?.seasonal?.draftPrep2027?.tradedPicksNote || '';

  const lines = [
    `SYNC: ${meta.updatedAt || new Date().toISOString()} | ${seasonYr} Week ${meta.currentWeek || 9} | ${team.fullName} (${meta.teamRecord || '—'}, ${meta.standingSummary || team.division}${meta.pointDifferential ? `, PtDiff ${meta.pointDifferential}` : ''})`,
    `NEXT GAME: Wk ${matchup.week || meta.currentWeek || 9} ${matchup.homeAway === 'away' ? '@' : 'vs.'} ${matchup.oppName || 'TBD'} (${matchup.oppRecord || '—'}) | ${matchup.kickoffDisplay || 'TBD'} | Spread: ${matchup.betting?.spread || 'TBD'} | O/U: ${matchup.betting?.overUnder || 'TBD'}`,
    `PLAYOFF ODDS: Proj Wins ${teamOdds.projectedWins ?? '—'} | Playoffs ${teamOdds.makePlayoffsPct ?? '—'}% | Div ${teamOdds.winDivisionPct ?? '—'}% | #1 Bye ${teamOdds.seed1ByePct ?? '—'}%`
  ];

  const balancedBlock =
    dossier?.balancedLeagueBlock || buildBalancedLeagueComparisonBlock(appData, { compact: !isDeep });
  if (balancedBlock) lines.push(balancedBlock);

  const pickLines = pickInventory
    .map(pk => `Rd${pk.round}${pk.projectedOverall || pk.overall ? `(#${pk.projectedOverall || pk.overall})` : ''}[${pk.origin}]`)
    .join(', ');
  lines.push(
    `CAP & PICKS (OTC): ${seasonYr} Space $${(cap26.teamCapSpace || 0).toLocaleString()} (Eff $${(cap26.effectiveCapSpace || 0).toLocaleString()}, Dead $${curDeadMoney.toLocaleString()}) | ${nextYr} Proj $${(cap27.teamCapSpace || 0).toLocaleString()} | ${nextYr} Picks (${pickInventory.length}): ${pickLines || 'See ledger'}${tradedPicksNote ? ` (${tradedPicksNote})` : ''}`
  );

  // Focused player dossiers (from topic intent) — emitted ONCE
  const fmtDollars = v => (v == null ? 'Min' : `${v < 0 ? '-' : ''}$${(Math.abs(v) / 1e6).toFixed(2)}M`);
  if (dossier) {
    const healthy = (dossier.activeHealthy || []).slice(0, isDeep ? 12 : 8);
    if (healthy.length > 0) {
      lines.push(
        `TOPIC FOCUS PLAYERS — ACTIVE (${healthy.length}):\n` +
          healthy
            .map(
              d =>
                `  - ${d.name} (${d.position} #${d.jersey ?? '—'}): ${d.snapPct}% snaps | ${d.healthStatus}${d.playBadge ? ` (${d.playBadge})` : ''} | ${d.statLine || 'Rotational'} | ${seasonYr} Cap ${fmtDollars(d.cap2026)}${d.cap2027 != null ? ` / ${nextYr} ${fmtDollars(d.cap2027)}` : ''}${d.beatNote ? ` | ${d.beatNote.slice(0, 140)}` : ''}`
            )
            .join('\n')
      );
    }
    const sidelined = dossier.activeSidelined || [];
    if (sidelined.length > 0) {
      lines.push(
        `TOPIC FOCUS — OUT/DOUBTFUL (${sidelined.length}):\n` +
          sidelined
            .map(d => `  - ${d.name} (${d.position}): ${d.healthStatus} (${d.injuryType || 'Injury'})${d.statLine ? ` | ${d.statLine}` : ''}${d.beatNote ? ` | ${d.beatNote.slice(0, 120)}` : ''}`)
            .join('\n')
      );
    }
    const irFocus = dossier.irReserve || [];
    if (irFocus.length > 0) {
      lines.push(
        `TOPIC FOCUS — IR/RESERVE (${irFocus.length}): ` +
          irFocus.map(d => `${d.name} (${d.position}, ${d.healthStatus}${d.injuryType ? `: ${d.injuryType}` : ''})`).join('; ')
      );
    }
    const psFocus = dossier.practiceSquad || [];
    if (psFocus.length > 0) {
      lines.push(`TOPIC FOCUS — PS DEPTH: ${psFocus.map(d => `${d.name} (${d.position})`).join(', ')}`);
    }
  }

  // Compact active 53-man name index (prevents roster hallucinations at ~1/3 the tokens)
  const activeByGrp = { QB: [], RB: [], WR: [], TE: [], OL: [], DL: [], LB: [], DB: [], ST: [] };
  for (const p of rosterPlayers) {
    if (p.rosterBucket !== 'active') continue;
    const tag = p.health?.status && p.health.status !== 'Active' ? `${p.name} [${p.health.status}]` : p.name;
    if (p.position === 'QB') activeByGrp.QB.push(tag);
    else if (['RB', 'FB'].includes(p.position)) activeByGrp.RB.push(tag);
    else if (p.position === 'WR') activeByGrp.WR.push(tag);
    else if (p.position === 'TE') activeByGrp.TE.push(tag);
    else if (['OT', 'T', 'G', 'C', 'OL', 'OG'].includes(p.position)) activeByGrp.OL.push(tag);
    else if (['DE', 'DT', 'DL', 'NT', 'EDGE'].includes(p.position)) activeByGrp.DL.push(tag);
    else if (['LB', 'ILB', 'MLB', 'OLB'].includes(p.position)) activeByGrp.LB.push(tag);
    else if (['CB', 'S', 'DB', 'FS', 'SS'].includes(p.position)) activeByGrp.DB.push(tag);
    else activeByGrp.ST.push(tag);
  }
  const activeIndex = Object.entries(activeByGrp)
    .filter(([, arr]) => arr.length > 0)
    .map(([g, arr]) => `${g}: ${arr.join(', ')}`)
    .join(' | ');
  if (activeIndex) lines.push(`ACTIVE 53-MAN ROSTER INDEX: ${activeIndex}`);

  // Compact IR & Injury Report — emitted ONCE
  if (irList.length > 0) {
    lines.push(
      `IR/RESERVE LIST: ${irList
        .slice(0, 14)
        .map(p => `${p.name} (${p.position}, ${p.injuryType || p.status}${p.projectedReturnWeek ? ` • ${p.projectedReturnWeek}` : ''})`)
        .join('; ')}`
    );
  }
  if (practiceReport.length > 0) {
    lines.push(
      `WK ${meta.currentWeek || 9} INJURY REPORT: ${practiceReport
        .slice(0, isDeep ? 14 : 10)
        .map(p => `${p.name} (${p.position}: ${p.gameStatus}, ${p.injuryType}, ${p.wed}/${p.thu}/${p.fri}, ${p.playBadgeLabel})`)
        .join('; ')}`
    );
  }

  // Completed trades (compact) + trade matrix only when trade-relevant
  const completedTrades = tw.completed2026Moves || [];
  if (completedTrades.length > 0) {
    lines.push(
      `VERIFIED ${seasonYr} TRADES: ${completedTrades
        .map(m => `${m.player} (${m.position}, from ${m.acquiredFrom}${m.costSummary || m.compensation ? ` for ${m.costSummary || m.compensation}` : ''})`)
        .join('; ')}`
    );
  }
  if (includeTradeMatrix) {
    const needs = (tw.topNeeds || []).slice(0, 5);
    if (needs.length > 0) {
      lines.push(`TRADE NEEDS: ${needs.map(n => `[${n.urgency}] ${n.positionGroup || n.position}: ${n.epaContext || n.rationale}`).join(' | ')}`);
    }
    const targets = (dossier?.relevantTradeTargets?.length ? dossier.relevantTradeTargets : tw.realisticTargets || []).slice(0, 6);
    if (targets.length > 0) {
      lines.push(
        `VERIFIED TRADE TARGETS:\n` +
          targets
            .map(
              t =>
                `  - ${t.name} (${t.position}, ${t.currentTeam || ''}, Fit ${t.fitScore}/100): Cost ${t.projectedPickCost} | 2026 Cap ${t.acquiring2026CapHit || fmtDollars(t.prorated2026CapCharge)} | ${t.fitBreakdown || t.schemeFit || ''}`
            )
            .join('\n')
      );
    }
  }

  // Top relevant beat wire items — emitted ONCE
  const wireItems = (dossier?.matchedNews || []).slice(0, isDeep ? 7 : 5);
  if (wireItems.length > 0) {
    lines.push(
      `RECENT RELEVANT BEAT WIRE:\n` +
        wireItems
          .map(n => `  - [${n.author || n.outletName || n.outlet || 'Beat'}]: ${(n.fullText || n.title || n.headline || n.text || n.summary || '').slice(0, 180)}`)
          .join('\n')
    );
  }

  return lines.join('\n\n');
}
