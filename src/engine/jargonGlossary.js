/**
 * NFL Film, Analytics, Scouting & CBA Salary Cap Jargon Glossary
 * Powers subtle inline quick-bubble explanations across 49ers Faithful views.
 */

export const JARGON_GLOSSARY = {
  epa: {
    term: 'EPA (Expected Points Added)',
    category: 'Analytics',
    definition:
      'Measures how much a play changes a team’s expected scoring value based on down, distance, and field position. Positive EPA on offense (and negative EPA allowed on defense) indicates above-average efficiency.'
  },
  cpoe: {
    term: 'CPOE (Completion % Over Expected)',
    category: 'Analytics',
    definition:
      'Compares a quarterback’s actual completion rate to expected completion probability given target depth, receiver separation, pass rush proximity, and sideline tightness.'
  },
  yac: {
    term: 'YAC (Yards After Catch)',
    category: 'Analytics',
    definition:
      'Receiving yardage gained after the ball is secured. A staple of Kyle Shanahan’s spacing concepts designed to hit receivers in stride away from leverage.'
  },
  wopr: {
    term: 'WOPR (Weighted Opportunity Rating)',
    category: 'Analytics',
    definition:
      'Combines a pass catcher’s share of team targets (1.5x weight) and share of team air yards (0.7x weight) to quantify true focal-point volume in the passing offense.'
  },
  racr: {
    term: 'RACR (Receiver Air Conversion Ratio)',
    category: 'Analytics',
    definition:
      'Total receiving yards divided by total targeted air yards. Evaluates how efficiently air-yard opportunities convert into real yardage via catch rate and YAC.'
  },
  ryoe: {
    term: 'RYOE (Rushing Yards Over Expected)',
    category: 'Analytics',
    definition:
      'Next Gen Stats metric measuring rushing yards gained above or below what an average back would produce given blocker/defender tracking coordinates and speeds at handoff.'
  },
  ras: {
    term: 'RAS (Relative Athletic Score)',
    category: 'Scouting',
    definition:
      '0.00-to-10.00 composite score normalizing a prospect’s height, weight, speed, explosion, and agility drills against historical NFL Combine athletes at the same position.'
  },
  dadot: {
    term: 'DADOT (Defensive Avg Depth of Target)',
    category: 'Analytics',
    definition:
      'Average air-yard distance downfield of passes thrown into a defender’s coverage area.'
  },
  yprr: {
    term: 'YPRR (Yards Per Route Run)',
    category: 'Analytics',
    definition:
      'Total receiving yards divided by pass routes run. Isolates per-route separation and efficiency independent of team pass volume or run-blocking snaps.'
  },
  pbwr: {
    term: 'PBWR (Pass Block Win Rate)',
    category: 'Analytics',
    definition:
      'Player-tracking trench metric measuring the percentage of pass-rush snaps an offensive lineman sustains his block for at least 2.5 seconds.'
  },
  rswr: {
    term: 'RSWR (Run Stop Win Rate)',
    category: 'Analytics',
    definition:
      'Player-tracking trench metric measuring how often a defender beats his run block, disrupts the point of attack, or contains the edge within 2.5 seconds.'
  },
  sov: {
    term: 'SOV (Strength of Victory)',
    category: 'Analytics',
    definition:
      'Official NFL tiebreaker (Step 5 in division, Step 4 in Wild Card) equal to the combined won-lost-tied percentage of all opponents a team has defeated.'
  },
  sos: {
    term: 'SOS (Strength of Schedule)',
    category: 'Analytics',
    definition:
      'Official NFL tiebreaker equal to the combined won-lost-tied percentage of all 17 opponents on a team’s regular-season schedule.'
  },
  article_13: {
    term: 'CBA Article 13 (Cap Rollover)',
    category: 'Salary Cap / CBA',
    definition:
      'NFL Collective Bargaining Agreement rule allowing clubs to carry over 100% of unused prior-year salary cap room dollar-for-dollar onto next season’s adjusted cap ceiling.'
  },
  concussion_protocol: {
    term: 'NFL 5-Step Concussion Protocol',
    category: 'Health & Roster',
    definition:
      'Mandatory NFL/NFLPA 5-phase return-to-participation progression requiring symptom-free exercise, full football practice, and Independent Neurological Consultant (INC) clearance before game action.'
  },
  tfl: {
    term: 'TFL (Tackle for Loss)',
    category: 'Film & Box',
    definition:
      'Solo or assisted tackle of a runner or receiver behind the line of scrimmage (excluding sacks).'
  },
  monte_carlo: {
    term: 'Monte Carlo Simulation',
    category: 'Analytics',
    definition:
      'Simulates the remaining NFL schedule thousands of times using team power ratings and tiebreaker rules to estimate exact playoff, division, and #1 seed probabilities.'
  },
  jet_motion: {
    term: 'Jet Motion',
    category: 'Scheme & Film',
    definition:
      'Fast pre-snap lateral motion across the formation timed near the snap, forcing linebackers and safeties to declare coverage rules, bump gaps, and respect perimeter leverage.'
  },
  orbit_motion: {
    term: 'Orbit Motion',
    category: 'Scheme & Film',
    definition:
      'Pre-snap motion where a skill player loops behind the quarterback/backfield rather than in front, creating instant perimeter numbers or swinging coverage leverage.'
  },
  inside_zone: {
    term: 'Inside Zone',
    category: 'Scheme & Film',
    definition:
      'Core run concept where offensive linemen step in unison to create vertical double-teams up to linebackers while the back reads interior defensive tackle leverage to hit between the tackles or cut back.'
  },
  outside_zone: {
    term: 'Outside Zone / Wide Zone',
    category: 'Scheme & Film',
    definition:
      'Signature Shanahan run scheme: linemen reach-block horizontally to stretch the defensive front sideline-to-sideline while the runner presses the edge and makes a one-cut vertical plant.'
  },
  duo: {
    term: 'Duo',
    category: 'Scheme & Film',
    definition:
      'Downhill gap-style run without pulling linemen ("power without a puller"), generating multiple vertical double-teams at the point of attack while the RB reads the playside linebacker.'
  },
  play_action: {
    term: 'Play-Action',
    category: 'Scheme & Film',
    definition:
      'Pass play marrying run-blocking demeanor and a backfield run fake to pull second-level linebackers forward, opening intermediate throwing windows behind them.'
  },
  boot: {
    term: 'Boot / Bootleg',
    category: 'Scheme & Film',
    definition:
      'Play-action rollout where the quarterback fakes an outside/wide-zone run one way and rolls out opposite with high-low flood levels (flat, intermediate crosser, deep corner/post).'
  },
  personnel_21: {
    term: '21 Personnel',
    category: 'Scheme & Film',
    definition:
      'Offensive grouping with 2 Running Backs (RB + FB Kyle Juszczyk), 1 Tight End, and 2 Wide Receivers. Forces defenses to choose between heavy base personnel or lighter nickel.'
  },
  personnel_12: {
    term: '12 Personnel',
    category: 'Scheme & Film',
    definition:
      'Offensive grouping with 1 Running Back, 2 Tight Ends, and 2 Wide Receivers, creating versatile run-surface edges and play-action seams.'
  },
  personnel_11: {
    term: '11 Personnel',
    category: 'Scheme & Film',
    definition:
      'Offensive grouping with 1 Running Back, 1 Tight End, and 3 Wide Receivers — the NFL’s primary spread/passing personnel package.'
  },
  personnel_22: {
    term: '22 Personnel',
    category: 'Scheme & Film',
    definition:
      'Heavy offensive grouping with 2 Running Backs, 2 Tight Ends, and 1 Wide Receiver, typically deployed in short-yardage, goal-line, or four-minute situations.'
  },
  wide_9: {
    term: 'Wide-9 Alignment',
    category: 'Scheme & Film',
    definition:
      'Defensive line technique aligning edge rushers well outside the tight end/offensive tackle shoulder at a steep pass-rush angle to maximize upfield burst and isolate tackles in space.'
  },
  three_tech: {
    term: '3-Technique (3-Tech)',
    category: 'Scheme & Film',
    definition:
      'Interior defensive lineman aligned on the outside shoulder of the offensive guard (B-gap), serving as the primary interior one-gap penetrator and pass-rush engine.'
  },
  one_tech: {
    term: '1-Technique (1-Tech)',
    category: 'Scheme & Film',
    definition:
      'Interior nose tackle aligned on the shoulder of the center in the A-gap, tasked with absorbing double-teams and controlling interior run gaps.'
  },
  two_i: {
    term: '2i-Technique (2i)',
    category: 'Scheme & Film',
    definition:
      'Interior defensive tackle aligned on the inside shoulder of the offensive guard, pinching the A-gap to disrupt center-guard combo blocks.'
  },
  stunt: {
    term: 'DL Stunt / Twist',
    category: 'Scheme & Film',
    definition:
      'Coordinated pass-rush exchange (such as T-E or E-T) where one defensive lineman crashes to occupy two blockers while a teammate loops behind into the vacated pass-rush lane.'
  },
  sim_pressure: {
    term: 'Simulated Pressure (Sim Pressure)',
    category: 'Scheme & Film',
    definition:
      'Four-man rush disguised as a blitz: a linebacker, slot defender, or safety rushes while a defensive lineman drops into coverage, stressing protection rules without sacrificing seven coverage defenders.'
  },
  chip: {
    term: 'Chip Help',
    category: 'Scheme & Film',
    definition:
      'Pass-protection assist where a tight end or running back strikes an edge rusher’s outside rib/hip before releasing into a route, slowing upfield rush timing for the offensive tackle.'
  },
  cover_3: {
    term: 'Cover 3',
    category: 'Scheme & Film',
    definition:
      'Single-high safety zone shell dividing the deep field into three 1/3 zones (two outside corners + free safety) with four underneath zone defenders.'
  },
  quarters: {
    term: 'Quarters (Cover 4)',
    category: 'Scheme & Film',
    definition:
      'Two-high safety shell dividing the deep field into four 1/4 zones (often with pattern-match rules), capping vertical shots while safeties trigger downhill against the run.'
  },
  two_high: {
    term: 'Two-High Shell',
    category: 'Scheme & Film',
    definition:
      'Defensive pre/post-snap structure featuring two deep safeties splitting the field, designed to limit explosive vertical passes and disguise post-snap rotations.'
  },
  single_high: {
    term: 'Single-High Shell',
    category: 'Scheme & Film',
    definition:
      'Defensive structure with one deep centerfield safety and an extra defender rotated down into the box or intermediate rob zone (Cover 1 or Cover 3).'
  },
  press_zone: {
    term: 'Press-Zone',
    category: 'Scheme & Film',
    definition:
      'Cornerback technique showing tight press alignment at the line of scrimmage to disrupt route timing before bailing or matching into zone coverage.'
  },
  nickel: {
    term: 'Nickel Defense',
    category: 'Scheme & Film',
    definition:
      'Sub-package defense replacing a base linebacker with a fifth defensive back (slot/nickel corner) to match 3-WR or spread TE formations.'
  },
  dime: {
    term: 'Dime Defense',
    category: 'Scheme & Film',
    definition:
      'Passing-down sub-package with six defensive backs on the field, trading run bulk for extra coverage speed against long-yardage passing looks.'
  },
  top_51: {
    term: 'Top-51 Rule',
    category: 'Salary Cap / CBA',
    definition:
      'During the NFL offseason, only a team’s 51 highest cap charges (plus prorated bonuses and dead money) count against the salary cap; in-season, all 53 active roster, IR, PUP, and PS contracts count.'
  },
  gross_cap_space: {
    term: 'Team Cap Space (Gross Space)',
    category: 'Salary Cap / CBA',
    definition:
      'Total adjusted salary cap ceiling minus current cap liabilities (active contracts, reserve lists, and dead money) before reserving space for unsigned draft picks or full 53-man expansion.'
  },
  effective_cap_space: {
    term: 'Effective Cap Space',
    category: 'Salary Cap / CBA',
    definition:
      'OverTheCap’s practical spending power metric: Team Cap Space adjusted for minimum-salary contracts needed to reach 51 players and net cap space required to sign the incoming draft class.'
  },
  dead_money: {
    term: 'Dead Cap / Dead Money',
    category: 'Salary Cap / CBA',
    definition:
      'Salary cap charge for a player no longer on the roster, caused by unamortized prorated signing/option bonuses accelerating onto the cap plus any remaining guaranteed salary.'
  },
  prorated_bonus: {
    term: 'Prorated Bonus',
    category: 'Salary Cap / CBA',
    definition:
      'Cash paid upfront (signing, restructure, or option bonus) whose salary cap charge is spread evenly across the length of the contract up to a maximum of 5 seasons under the NFL CBA.'
  },
  option_bonus: {
    term: 'Option Bonus',
    category: 'Salary Cap / CBA',
    definition:
      'Scheduled bonus triggered when a team exercises a contract option year; treated like a signing bonus for cap accounting and prorated evenly across up to 5 contract/void years.'
  },
  current_yr_bonuses: {
    term: 'Current Year Bonuses (Non-Prorated)',
    category: 'Salary Cap / CBA',
    definition:
      'Combined non-prorated bonuses counting wholly in the current league year: regular roster bonuses, Likely-To-Be-Earned (LTBE) per-game active bonuses, workout bonuses, and other incentives.'
  },
  guaranteed_salary: {
    term: 'Guaranteed Salary',
    category: 'Salary Cap / CBA',
    definition:
      'Portion of a player’s current-year base salary or roster bonus guaranteed for skill, injury, and salary cap. Cutting a player does not erase guaranteed salary unless offset language applies.'
  },
  void_years: {
    term: 'Void Years',
    category: 'Salary Cap / CBA',
    definition:
      'Dummy contract years added to the end of a deal that automatically void prior to free agency, used to spread signing or option bonus proration over up to 5 years before accelerating when the deal voids.'
  },
  post_june_1: {
    term: 'Post-June 1 Cut / Trade',
    category: 'Salary Cap / CBA',
    definition:
      'CBA rule keeping only the current year’s prorated bonus on this year’s cap while deferring remaining future years’ unamortized bonus acceleration to next season’s dead cap (max 2 early Post-June 1 cut designations per offseason).'
  },
  pre_june_1: {
    term: 'Pre-June 1 Cut / Trade',
    category: 'Salary Cap / CBA',
    definition:
      'Standard release or trade before June 1 where 100% of remaining unamortized signing/option bonus proration from all future contract years accelerates onto the current season’s dead cap immediately.'
  },
  restructure: {
    term: 'Contract Restructure',
    category: 'Salary Cap / CBA',
    definition:
      'Converts current-year base salary or roster bonus down to the veteran minimum and pays the difference as a signing/option bonus prorated across remaining contract and void years (up to 5 years), creating instant cap room at the cost of higher future cap hits.'
  },
  rollover: {
    term: 'Salary Cap Rollover',
    category: 'Salary Cap / CBA',
    definition:
      'Under the NFL CBA, 100% of a team’s unused salary cap space at the end of a regular season carries forward to raise its adjusted team salary cap ceiling in the following league year.'
  },
  rich_hill: {
    term: 'Rich Hill Trade Value Chart',
    category: 'Scouting',
    definition:
      'Modern empirical NFL draft pick valuation scale (1,000 pts for #1 overall) calibrated to actual modern NFL draft-day trades rather than the older 1990s Jimmy Johnson chart.'
  },
  udfa: {
    term: 'UDFA (Undrafted Free Agent)',
    category: 'Scouting',
    definition:
      'Rookie prospect not selected across the 7 rounds of the NFL Draft who signs a 3-year rookie free-agent contract, often lured by guaranteed base-salary commitments and depth-chart path.'
  },
  ir: {
    term: 'IR (Injured Reserve & 21-Day Window)',
    category: 'Health & Roster',
    definition:
      'Players placed on Injured Reserve in-season (or designated to return at final cuts) must miss at least 4 regular-season games (excluding bye weeks). Opening their return window starts a 21-day practice period to activate them to the 53-man roster.'
  },
  pup: {
    term: 'PUP (Physically Unable to Perform)',
    category: 'Health & Roster',
    definition:
      'Reserve list for football-related injuries sustained before training camp begins; players on Reserve/PUP miss at least the first 4 games of the season.'
  },
  dnp: {
    term: 'DNP (Did Not Participate)',
    category: 'Health & Roster',
    definition:
      'Official NFL practice report designation indicating a player took zero team practice reps on that day (due to injury rehab or scheduled veteran rest).'
  },
  lp: {
    term: 'LP (Limited Participation)',
    category: 'Health & Roster',
    definition:
      'Official NFL practice report designation indicating a player completed less than 100% of their normal team practice workload.'
  },
  fp: {
    term: 'FP (Full Participation)',
    category: 'Health & Roster',
    definition:
      'Official NFL practice report designation indicating a player completed 100% of their normal practice reps.'
  },
  nir: {
    term: 'NIR (Not Injury Related)',
    category: 'Health & Roster',
    definition:
      'Official practice report tag indicating a player missed or limited reps for scheduled veteran rest or personal reasons rather than a physical injury.'
  },
  gtd: {
    term: 'GTD (Game-Time Decision)',
    category: 'Health & Roster',
    definition:
      'Questionable player whose active/inactive status will be finalized after pre-game warmups 90 minutes prior to kickoff.'
  },
  explosive_plays: {
    term: 'Explosive Plays (20+ Pass / 10+ Rush)',
    category: 'Analytics',
    definition:
      'Completions gaining 20+ yards or rushing attempts gaining 10+ yards. Drives drive-scoring probability in Kyle Shanahan’s play-action and wide-zone offense.'
  },
  sack_rate: {
    term: 'Sacks Allowed Rate',
    category: 'Analytics',
    definition:
      'Percentage of quarterback dropbacks resulting in a sack (Sacks / [Pass Attempts + Sacks]). Reflects combined offensive line pass protection and quarterback pocket movement.'
  },
  ny_pa: {
    term: 'Net Yards Per Pass Attempt (NY/A)',
    category: 'Analytics',
    definition:
      'Passing yards minus sack yardage lost, divided by (pass attempts + sacks taken) — capturing true per-dropback passing yardage efficiency.'
  },
  takeaways: {
    term: 'Defensive Takeaways (INT + FR)',
    category: 'Film & Box',
    definition:
      'Combined defensive interceptions and opponent fumble recoveries per game, one of the strongest single-game win-probability swings in football.'
  }
};

const KEY_SYNONYMS = {
  dead_cap: 'dead_money',
  '11_personnel': 'personnel_11',
  '12_personnel': 'personnel_12',
  '21_personnel': 'personnel_21',
  '22_personnel': 'personnel_22'
};

/**
 * Phrase-to-key patterns for automatic subtle jargon linking in prose.
 * Sorted longest-first at compile time so multi-word phrases win cleanly over substrings.
 */
const PHRASE_ALIASES = [
  ['Effective Cap Space', 'effective_cap_space'],
  ['effective cap space', 'effective_cap_space'],
  ['Team Cap Space', 'gross_cap_space'],
  ['Gross Cap Space', 'gross_cap_space'],
  ['gross cap space', 'gross_cap_space'],
  ['Post-June 1', 'post_june_1'],
  ['post-June 1', 'post_june_1'],
  ['Pre-June 1', 'pre_june_1'],
  ['pre-June 1', 'pre_june_1'],
  ['Prorated Bonus', 'prorated_bonus'],
  ['prorated bonus', 'prorated_bonus'],
  ['prorated bonuses', 'prorated_bonus'],
  ['Option Bonus', 'option_bonus'],
  ['option bonus', 'option_bonus'],
  ['Guaranteed Salary', 'guaranteed_salary'],
  ['guaranteed salary', 'guaranteed_salary'],
  ['Void Years', 'void_years'],
  ['void years', 'void_years'],
  ['void year', 'void_years'],
  ['Dead Money', 'dead_money'],
  ['dead money', 'dead_money'],
  ['Dead Cap', 'dead_money'],
  ['dead cap', 'dead_money'],
  ['Top-51', 'top_51'],
  ['Top 51', 'top_51'],
  ['Rich Hill', 'rich_hill'],
  ['Monte Carlo', 'monte_carlo'],
  ['simulated pressure', 'sim_pressure'],
  ['sim pressure', 'sim_pressure'],
  ['Sim Pressure', 'sim_pressure'],
  ['outside zone', 'outside_zone'],
  ['Outside Zone', 'outside_zone'],
  ['wide zone', 'outside_zone'],
  ['Wide Zone', 'outside_zone'],
  ['inside zone', 'inside_zone'],
  ['Inside Zone', 'inside_zone'],
  ['jet motion', 'jet_motion'],
  ['Jet motion', 'jet_motion'],
  ['Jet Motion', 'jet_motion'],
  ['orbit motion', 'orbit_motion'],
  ['Orbit Motion', 'orbit_motion'],
  ['play-action', 'play_action'],
  ['Play-Action', 'play_action'],
  ['Play-action', 'play_action'],
  ['play action', 'play_action'],
  ['naked boot', 'boot'],
  ['bootleg', 'boot'],
  ['Bootleg', 'boot'],
  ['21 personnel', 'personnel_21'],
  ['21 Personnel', 'personnel_21'],
  ['21-personnel', 'personnel_21'],
  ['12 personnel', 'personnel_12'],
  ['12 Personnel', 'personnel_12'],
  ['12-personnel', 'personnel_12'],
  ['11 personnel', 'personnel_11'],
  ['11 Personnel', 'personnel_11'],
  ['11-personnel', 'personnel_11'],
  ['22 personnel', 'personnel_22'],
  ['22 Personnel', 'personnel_22'],
  ['Wide-9', 'wide_9'],
  ['wide-9', 'wide_9'],
  ['3-technique', 'three_tech'],
  ['3-Technique', 'three_tech'],
  ['3-tech', 'three_tech'],
  ['3-Tech', 'three_tech'],
  ['1-technique', 'one_tech'],
  ['1-tech', 'one_tech'],
  ['1-Tech', 'one_tech'],
  ['2i-technique', 'two_i'],
  ['2i-tech', 'two_i'],
  ['2i', 'two_i'],
  ['T-E stunt', 'stunt'],
  ['E-T stunt', 'stunt'],
  ['stunts', 'stunt'],
  ['stunt', 'stunt'],
  ['chip help', 'chip'],
  ['Cover 3', 'cover_3'],
  ['Cover-3', 'cover_3'],
  ['Cover 4', 'quarters'],
  ['Quarters', 'quarters'],
  ['two-high', 'two_high'],
  ['Two-High', 'two_high'],
  ['2-high', 'two_high'],
  ['single-high', 'single_high'],
  ['Single-High', 'single_high'],
  ['1-high', 'single_high'],
  ['press-zone', 'press_zone'],
  ['Press-Zone', 'press_zone'],
  ['big nickel', 'nickel'],
  ['Big Nickel', 'nickel'],
  ['EPA/play', 'epa'],
  ['EPA/Play', 'epa'],
  ['EPA/db', 'epa'],
  ['EPA', 'epa'],
  ['CPOE', 'cpoe'],
  ['WOPR', 'wopr'],
  ['RACR', 'racr'],
  ['RYOE', 'ryoe'],
  ['DADOT', 'dadot'],
  ['YPRR', 'yprr'],
  ['PBWR', 'pbwr'],
  ['RSWR', 'rswr'],
  ['SOV', 'sov'],
  ['SOS', 'sos'],
  ['Article 13', 'article_13'],
  ['concussion protocol', 'concussion_protocol'],
  ['Concussion Protocol', 'concussion_protocol'],
  ['YAC', 'yac'],
  ['RAS', 'ras'],
  ['TFL', 'tfl'],
  ['UDFAs', 'udfa'],
  ['UDFA', 'udfa'],
  ['21-day practice window', 'ir'],
  ['21-day return window', 'ir'],
  ['Injured Reserve', 'ir'],
  ['game-time decision', 'gtd'],
  ['Game-Time Decision', 'gtd'],
  ['GTD', 'gtd'],
  ['DNP', 'dnp'],
  ['LP', 'lp'],
  ['FP', 'fp'],
  ['NIR', 'nir'],
  ['PUP', 'pup'],
  ['Duo', 'duo'],
  ['Explosive Plays', 'explosive_plays'],
  ['explosive plays', 'explosive_plays'],
  ['Sacks Allowed Rate', 'sack_rate'],
  ['Net Yards / Pass Att', 'ny_pa'],
  ['Def. Takeaways', 'takeaways']
];

const SORTED_ALIASES = [...PHRASE_ALIASES].sort((a, b) => b[0].length - a[0].length);
const ALIAS_TO_KEY = new Map(SORTED_ALIASES.map(([p, k]) => [p.toLowerCase(), k]));

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const JARGON_REGEX = new RegExp(
  `(?<![A-Za-z0-9_/-])(${SORTED_ALIASES.map(([p]) => escapeRegex(p)).join('|')})(?![A-Za-z0-9_-])`,
  'g'
);

function escapeHtmlPlain(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function getJargonEntry(key) {
  if (!key) return null;
  const norm = String(key).trim().toLowerCase();
  if (JARGON_GLOSSARY[norm]) return { key: norm, ...JARGON_GLOSSARY[norm] };
  const syn = KEY_SYNONYMS[norm];
  if (syn && JARGON_GLOSSARY[syn]) return { key: syn, ...JARGON_GLOSSARY[syn] };
  const mapped = ALIAS_TO_KEY.get(norm) || ALIAS_TO_KEY.get(norm.replace(/[_-]+/g, ' '));
  if (mapped && JARGON_GLOSSARY[mapped]) return { key: mapped, ...JARGON_GLOSSARY[mapped] };
  return null;
}

/**
 * Wraps an explicit UI label (e.g. table column header or KPI label) with a subtle jargon bubble trigger.
 * Uses <span role="button"> so it is valid HTML everywhere without nested-<button> conflicts.
 */
export function jargonTerm(label, key) {
  const entry = getJargonEntry(key) || getJargonEntry(label);
  const safeLabel = escapeHtmlPlain(label);
  if (!entry) return safeLabel;
  return `<span class="jargon-term" role="button" tabindex="0" data-jargon="${escapeHtmlPlain(entry.key)}" aria-label="${escapeHtmlPlain(entry.term)}: tap for definition">${safeLabel}</span>`;
}

/**
 * Escapes plain text safely and wraps the first occurrence of each recognized football/cap jargon term
 * with a subtle clickable quick-bubble trigger.
 */
export function annotateJargonPlainText(rawText, { maxTerms = 8, seenKeys = null } = {}) {
  if (rawText === null || rawText === undefined) return '';
  const text = String(rawText);
  if (!text) return '';

  const used = seenKeys instanceof Set ? seenKeys : new Set();
  let count = 0;
  let lastIdx = 0;
  let out = '';

  JARGON_REGEX.lastIndex = 0;
  let match;
  while ((match = JARGON_REGEX.exec(text)) !== null) {
    const phrase = match[1];
    const mStart = match.index;
    const mEnd = mStart + phrase.length;
    out += escapeHtmlPlain(text.slice(lastIdx, mStart));

    const key = ALIAS_TO_KEY.get(phrase.toLowerCase());
    const entry = key ? JARGON_GLOSSARY[key] : null;
    if (entry && !used.has(key) && count < maxTerms) {
      used.add(key);
      count += 1;
      out += `<span class="jargon-term" role="button" tabindex="0" data-jargon="${escapeHtmlPlain(key)}" aria-label="${escapeHtmlPlain(entry.term)}: tap for definition">${escapeHtmlPlain(phrase)}</span>`;
    } else {
      out += escapeHtmlPlain(phrase);
    }
    lastIdx = mEnd;
  }

  out += escapeHtmlPlain(text.slice(lastIdx));
  return out;
}
