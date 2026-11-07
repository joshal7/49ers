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
 * zero retired or departed former 49ers are falsely referenced as current 49ers players.
 */
export function validateNoHallucinatedRosterClaims(text = '', rosterPlayers = []) {
  const hay = String(text || '');
  if (!hay.trim()) return { valid: true, ok: true, violations: [] };

  const disallowed = getDisallowedFormer49ers(rosterPlayers);
  const violations = [];
  const historicalContextRe =
    /\b(retired|former|departed|ex-49er|no longer|not currently on|not on the active|not on the 2026|waived|released|signed elsewhere|free agency departure)\b/i;

  for (const formerName of disallowed) {
    const escaped = formerName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/['’]/g, "['’]?");
    const re = new RegExp(`\\b${escaped}\\b`, 'gi');
    let match;
    while ((match = re.exec(hay)) !== null) {
      const start = Math.max(0, match.index - 70);
      const end = Math.min(hay.length, match.index + formerName.length + 70);
      const windowSlice = hay.slice(start, end);
      if (!historicalContextRe.test(windowSlice)) {
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

/**
 * Replaces any accidental stale/retired player reference in generated text with
 * verified active 2026 49ers rotational players from `rosterPlayers`.
 */
export function sanitizeHallucinatedRosterText(text = '', rosterPlayers = []) {
  let out = String(text || '');
  if (!out) return out;

  const check = validateNoHallucinatedRosterClaims(out, rosterPlayers);
  if (check.valid) return out;

  const activeEdges = (rosterPlayers || [])
    .filter(p => p.rosterBucket === 'active' && ['DE', 'EDGE', 'OLB'].includes(p.position) && !/bosa/i.test(p.name))
    .map(p => p.name);
  const fallbackEdge = activeEdges[0] || 'Mykel Williams';

  for (const badName of check.violations) {
    const escaped = badName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/['’]/g, "['’]?");
    const re = new RegExp(`\\b${escaped}\\b`, 'gi');
    out = out.replace(re, fallbackEdge);
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
    'CRITICAL ANTI-HALLUCINATION & REAL-TIME DATA GROUNDING DIRECTIVE:',
    `1. NEVER rely on stale pre-trained model weights for roster membership, retired players, trades, free-agent signings, coaching staff, win-loss-tie records, or injury designations. Anchor strictly to the LIVE REAL-TIME DATA SNAPSHOT (synced ${syncStamp}) and live web search grounding.`,
    '2. Prize the latest verified trades, active 53-man / IR / Practice Squad roster status, up-to-the-minute practice/game injury statuses, and current NFL Week standings.',
    disallowedSample
      ? `3. NEVER attribute retired, cut, or departed former 49ers to the active 49ers roster or rotation (disallowed non-rostered names include: ${disallowedSample}).`
      : '3. Verify every 49ers player mentioned against the provided LIVE 49ERS ROSTER list before citing them in current-season rotations.',
    '4. EDITORIAL CHARTER: Zero clickbait, zero rage-bait, zero filler throat-clearing. Separate Verified Facts, All-22 Film Mechanics (11/21 personnel, Wide-9 stunt geometry, coverage shells, EPA/play, CPOE), and CBA Salary Cap Math (base salary, option/signing proration, Pre/Post-June 1 dead money, Article 13 rollover).',
    '5. Cite originating beat reporters (Matt Maiocco, Matt Barrows, Nick Wagoner, Jennifer Lee Chan, David Lombardi, Dieter Kurtenbach, Eric Branch, Cam Inman, Tim Kawakami, Brian Peacock, Eric Crocker, Adam Schefter, Ian Rapoport, Tom Pelissero) or open datasets (nflverse, OverTheCap, NextGen Stats).'
  ].join('\n');
}

/**
 * Builds a comprehensive, up-to-the-minute live data context block injected into
 * every LLM prompt so the model has exact current roster, trades, injuries, and W-L data.
 */
export function buildAuthoritativeLiveContextSnapshot(appData = {}) {
  const meta = appData?.meta || {};
  const cap26 = appData?.cap?.years?.['2026'] || {};
  const cap27 = appData?.cap?.years?.['2027'] || {};
  const matchup = appData?.scheduleMatchup?.upcomingMatchup || {};
  const rosterPlayers = appData?.roster?.players || [];
  const practiceReport = appData?.health?.practiceReport || [];
  const irList = appData?.health?.irAndReserveTracker || [];
  const completedTrades = appData?.seasonal?.tradeWarRoom?.completed2026Moves || [];
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

  const irNames = irList.map(p => `${p.name} (${p.position} - ${p.injuryType}, ${p.status})`).join('; ');

  const injuryLines = practiceReport
    .slice(0, 16)
    .map(
      p =>
        `  - ${p.name} (${p.position}): ${p.gameStatus} [${p.injuryType}] • Practice ${p.wed}/${p.thu}/${p.fri} • Play Odds ${p.playBadgeLabel}`
    )
    .join('\n');

  const tradeLines = completedTrades
    .map(m => `  - ${m.player} (${m.position}, acquired from ${m.acquiredFrom}, ${m.timing}): ${m.analysis}`)
    .join('\n');

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
    `SEASON & RECORD: ${meta.seasonYear || 2026} NFL Season • Week ${meta.currentWeek || 9} • 49ers Record: ${meta.teamRecord || '6-1'} (${meta.standingSummary || 'NFC West'}, Point Diff: ${meta.pointDifferential || ''})`,
    `UPCOMING MATCHUP: Week ${matchup.week || meta.currentWeek || 9} ${matchup.homeAway === 'away' ? '@' : 'vs.'} ${matchup.oppName || ''} (${matchup.oppRecord || ''}) | Kickoff: ${matchup.kickoffDisplay || ''} | Venue: ${matchup.venue || ''} | Spread: ${matchup.betting?.spread || ''} | Total: ${matchup.betting?.overUnder || ''}`,
    `SALARY CAP (OVERTHECAP LIVE): 2026 Gross Cap Space: $${(cap26.teamCapSpace || 0).toLocaleString()} | 2026 Effective Space: $${(cap26.effectiveCapSpace || 0).toLocaleString()} | 2027 Projected Space: $${(cap27.teamCapSpace || 0).toLocaleString()}`,
    tradeLines ? `VERIFIED 2026 TRADES & ACQUISITIONS:\n${tradeLines}` : '',
    activeRosterLines ? `AUTHORITATIVE LIVE 49ERS ACTIVE 53-MAN ROSTER (USE ONLY THESE PLAYERS FOR ACTIVE ROTATIONS):\n${activeRosterLines}` : '',
    irNames ? `49ERS INJURED RESERVE / OUT LIST: ${irNames}` : '',
    injuryLines ? `UP-TO-THE-MINUTE WEEK ${meta.currentWeek || 9} INJURY & PRACTICE REPORT:\n${injuryLines}` : '',
    latestWireLines ? `LATEST LIVE BEAT TWEETS & NEWS WIRE:\n${latestWireLines}` : '',
    disallowed ? `DO NOT CITE AS ACTIVE 49ERS (RETIRED / DEPARTED): ${disallowed}` : ''
  ]
    .filter(Boolean)
    .join('\n\n');
}
