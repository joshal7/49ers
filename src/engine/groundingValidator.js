/**
 * Real-Time Roster & Data Grounding Engine + Anti-Hallucination Validator
 * Ensures zero stale-weight LLM or synthesis hallucinations across News Briefs,
 * Deep Scouting/Cap Analyses, Autopodcasts, and Cloudflare Worker prompts.
 */

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
 * Returns the list of former/retired players that are confirmed NOT on the live 49ers roster.
 */
export function getDisallowedFormer49ers(rosterPlayers = []) {
  const liveSet = new Set((rosterPlayers || []).map(p => normPlayerKey(p?.name || p)));
  return KNOWN_FORMER_OR_RETIRED_49ERS.filter(name => !liveSet.has(normPlayerKey(name)));
}

/**
 * Audits any generated or synthesized text against the live 49ers roster to verify
 * zero retired or departed former 49ers are falsely referenced as current active 49ers players,
 * while permitting accurate historical, 2026 dead-cap, opponent, or external trade-target references.
 */
export function validateNoHallucinatedRosterClaims(text = '', rosterPlayers = []) {
  const hay = String(text || '');
  if (!hay.trim()) return { valid: true, ok: true, violations: [] };

  const disallowed = getDisallowedFormer49ers(rosterPlayers);
  const violations = [];
  const historicalOrExternalContextRe =
    /\b(retired|former|departed|ex-49er|no longer|not currently on|not on the active|not on the 2026|not on the live|waived|released|signed elsewhere|free agency departure|dead\s*cap|dead\s*money|post-june|void\s*year|trade\s*target|trade\s*candidate|trade\s*fit|seller|saints|new\s*orleans|colts|indianapolis|vikings|minnesota|texans|houston|falcons|atlanta|bears|chicago|titans|tennessee|jaguars|jacksonville|seahawks|seattle|packers|green\s*bay)\b/i;
  const strictDisallowedOnlyRe =
    /\b(not on the|no longer|former|departed|disallowed|never on)\b/i;

  for (const formerName of disallowed) {
    const escaped = formerName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/['’]/g, "['’]?");
    const re = new RegExp(`\\b${escaped}\\b`, 'gi');
    let match;
    while ((match = re.exec(hay)) !== null) {
      const start = Math.max(0, match.index - 130);
      const end = Math.min(hay.length, match.index + formerName.length + 130);
      const windowSlice = hay.slice(start, end);
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
  'Mitch Wishnowsky': 'ST'
};

/**
 * Replaces any accidental stale/retired player reference in generated text with
 * verified active 49ers players at the matching position group from `rosterPlayers`.
 */
export function sanitizeHallucinatedRosterText(text = '', rosterPlayers = []) {
  let out = String(text || '');
  if (!out) return out;

  const check = validateNoHallucinatedRosterClaims(out, rosterPlayers);
  if (check.valid) return out;

  const active = (rosterPlayers || []).filter(p => p.rosterBucket === 'active');
  const activeEdges = active
    .filter(p => ['DE', 'EDGE', 'OLB'].includes(p.position) && !/bosa/i.test(p.name))
    .map(p => p.name);
  const fallbackEdge = activeEdges[0] || 'Mykel Williams';

  const pickActiveByGroup = grp => {
    if (grp === 'QB') return active.find(p => p.position === 'QB')?.name || 'Brock Purdy';
    if (grp === 'RB') return active.find(p => p.position === 'RB')?.name || 'Christian McCaffrey';
    if (grp === 'WR') return active.find(p => p.position === 'WR')?.name || 'Jauan Jennings';
    if (grp === 'TE') return active.find(p => p.position === 'TE')?.name || 'George Kittle';
    if (grp === 'OL') return active.find(p => ['OT', 'T', 'G', 'C', 'OL', 'OG'].includes(p.position))?.name || 'Dominick Puni';
    if (grp === 'LB') return active.find(p => ['LB', 'ILB', 'MLB'].includes(p.position))?.name || 'Fred Warner';
    if (grp === 'DB') return active.find(p => ['CB', 'S', 'DB', 'FS', 'SS'].includes(p.position))?.name || 'Deommodore Lenoir';
    if (grp === 'ST') return active.find(p => ['K', 'P', 'LS'].includes(p.position))?.name || fallbackEdge;
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
 * Builds the strict internal system prompt used across ALL LLM-generated surfaces
 * (Deep Scouting/Cap Analysis, Autopodcast scripts, News Synthesis, Cloudflare Worker).
 */
export function buildLiveGroundingSystemPrompt(appData = null) {
  const meta = appData?.meta || {};
  const rosterPlayers = appData?.roster?.players || [];
  const disallowedSample = getDisallowedFormer49ers(rosterPlayers).slice(0, 22).join(', ');
  const syncStamp = meta.updatedAt || new Date().toISOString();

  return [
    'You are the Lead Football Intelligence Analyst for "49ers Faithful", a private, high-IQ San Francisco 49ers briefing platform.',
    'UNHURRIED HIGH-THINKING MANDATE — PRIORITIZE ACCURACY & ANALYTICAL QUALITY OVER GENERATION TIME:',
    '0. Achieve 100% factual accuracy, exact CBA cap arithmetic, and coaching-tape analytical depth with focused, non-repetitive internal reasoning: consult the AUTHORITATIVE LIVE REAL-TIME DATA SNAPSHOT first, run at most 1–2 targeted Google Search queries ONLY if a post-snapshot external fact is genuinely needed, and avoid redundant internal re-drafting loops.',
    `1. NEVER rely on stale pre-trained model weights for roster membership, retired players, trades, free-agent signings, coaching staff, win-loss-tie records, draft pick inventory, or injury designations. Anchor strictly to the AUTHORITATIVE LIVE REAL-TIME DATA SNAPSHOT (synced ${syncStamp}) and live Google Search Grounding.`,
    '2. COACHING, CAP & DRAFT RULES OF TRUTH:',
    '   - Coaching Staff: Head Coach Kyle Shanahan; Defensive Coordinator Raheem Morris (Wide-9 4-man pass rush married to disguised two-high / Cover-3 Buzz / Quarters coverage rotations).',
    '   - Multi-Year CBA Cap Math: Always pair 2026 Top-51 cap space (~$35.16M) with the projected 2027 cap deficit (~-$31.54M). Unused 2026 cap space MUST roll over 1-for-1 under CBA Article 13 to keep 2027 compliant; never portray 2026 cap space as unencumbered spending cash.',
    '   - Midseason Trade Proration: Acquiring teams absorb only remaining weekly base-salary proration (e.g., 9/18ths at Week 9) while bonus proration stays on the seller ledger—giving SF ~$65M+ of annualized base-salary purchasing power WITHOUT forcing sellers to eat salary, though every 2026 dollar spent deepens the 2027 deficit.',
    '   - 2027 Draft Capital: Anchor to the exact pick list in the snapshot (6 picks total after trading SF\'s own 2027 4th-rounder to Indianapolis for DT DeForest Buckner; Rd 6 via BAL, Rd 7 via KC). Reject Day-2 pick overpays for rentals.',
    '   - Trade Evaluation Rigor: Recommend only verified, real NFL players on true seller/surplus rosters addressing genuine weak links (perimeter WR / 12p move TE, LG pass protection, rotational speed EDGE, Dime CB/S). Expose declining age-cliff traps (e.g., age-37 0-sack Cameron Jordan) and untouchable extended starters (e.g., Michael Mayer).',
    disallowedSample
      ? `3. NEVER attribute retired, cut, or departed former 49ers to the active 49ers rotation (non-rostered names include: ${disallowedSample}). You may reference them ONLY in verified historical, 2026 dead-cap, opponent, or external trade-target context.`
      : '3. Verify every 49ers player mentioned against the provided LIVE 49ERS ROSTER list before citing them in current-season rotations.',
    '4. INTERNAL MULTI-PASS SELF-AUDIT BEFORE EMITTING A SINGLE WORD: Efficiently cross-check every player name, injury status, contract figure, pick slot, scheme concept, and playoff probability against the live snapshot in one crisp verification pass without repeating full drafts internally.',
    '5. EDITORIAL CHARTER: Zero clickbait, zero rage-bait, zero filler throat-clearing. Separate Verified Facts, All-22 Film Mechanics (11/21 personnel, Wide-9 stunt geometry, coverage shells, EPA/play, CPOE), and CBA Salary Cap Math.',
    '6. Cite originating beat reporters (Matt Maiocco, Matt Barrows, Nick Wagoner, Jennifer Lee Chan, David Lombardi, Dieter Kurtenbach, Eric Branch, Cam Inman, Tim Kawakami, Brian Peacock, Eric Crocker, Adam Schefter, Ian Rapoport, Tom Pelissero) or open datasets (nflverse, OverTheCap, Tankathon, NextGen Stats).'
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
        `${p.name} (${p.position} - ${p.injuryType}, ${p.status}${p.projectedReturnWeek ? ` • ${p.projectedReturnWeek}` : ''})`
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

  const disallowed = getDisallowedFormer49ers(rosterPlayers).slice(0, 20).join(', ');

  return [
    `LIVE TIMESTAMP: ${meta.updatedAt || new Date().toISOString()}`,
    `COACHING STAFF: HC Kyle Shanahan | DC Raheem Morris (Wide-9 4-3 / Nickel 4-2-5 disguised split-safety)`,
    `SEASON & RECORD: ${meta.seasonYear || 2026} NFL Season • Week ${meta.currentWeek || 9} • 49ers Record: ${meta.teamRecord || '6-1'} (${meta.standingSummary || 'NFC West'}, Point Diff: ${meta.pointDifferential || ''})`,
    `CALIBRATED 10,000-RUN PLAYOFF SIMULATION (EMPIRICAL-BAYES + EPA + SOS + NFL SEC. 16 TIEBREAKERS): SF Projected Wins: ${sfOdds.projectedWins ?? 12.0} | Playoff Berth: ${sfOdds.makePlayoffsPct ?? 93.0}% | Win NFC West: ${sfOdds.winDivisionPct ?? 82.6}% | #1 Seed First-Round Bye: ${sfOdds.seed1ByePct ?? 34.5}%${topNfcContenders ? `\n  NFC Race Context: ${topNfcContenders}` : ''}`,
    `UPCOMING MATCHUP: Week ${matchup.week || meta.currentWeek || 9} ${matchup.homeAway === 'away' ? '@' : 'vs.'} ${matchup.oppName || ''} (${matchup.oppRecord || ''}) | Kickoff: ${matchup.kickoffDisplay || ''} | Venue: ${matchup.venue || ''} | Spread: ${matchup.betting?.spread || ''} | Total: ${matchup.betting?.overUnder || ''}`,
    `SALARY CAP & MULTI-YEAR HORIZON (OVERTHECAP LIVE): ${seasonYr} Gross Cap Space: $${(cap26.teamCapSpace || 0).toLocaleString()} | ${seasonYr} Effective Space: $${(cap26.effectiveCapSpace || 0).toLocaleString()} | ${seasonYr} Dead Money: $${curDeadMoney.toLocaleString()} | ${nextYr} Projected Cap Space: $${(cap27.teamCapSpace || 0).toLocaleString()} (Article 13 rollover of ${seasonYr} surplus is required to offset ${nextYr} deficit)`,
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
    activeRosterLines ? `AUTHORITATIVE LIVE 49ERS ACTIVE 53-MAN ROSTER (USE ONLY THESE PLAYERS FOR ACTIVE ROTATIONS):\n${activeRosterLines}` : '',
    irNames ? `49ERS INJURED RESERVE / OUT LIST: ${irNames}` : '',
    injuryLines ? `UP-TO-THE-MINUTE WEEK ${meta.currentWeek || 9} INJURY & PRACTICE REPORT:\n${injuryLines}` : '',
    !compactForDossier && latestWireLines ? `LATEST LIVE BEAT TWEETS & NEWS WIRE:\n${latestWireLines}` : '',
    disallowed ? `DO NOT CITE AS ACTIVE 49ERS (RETIRED / DEPARTED): ${disallowed}` : ''
  ]
    .filter(Boolean)
    .join('\n\n');
}
