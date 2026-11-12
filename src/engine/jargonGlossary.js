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
  qbr: {
    term: 'Total QBR (Quarterback Rating)',
    category: 'Analytics',
    definition:
      'ESPN’s 0–100 efficiency metric (50.0 is NFL average) measuring a quarterback’s total contribution to winning across passes, scrambles/designed runs, sacks, and penalties—weighted by game leverage (EPA per QB play) and opponent defensive strength.'
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
  consensus_big_board: {
    term: 'Consensus Big Board (Wisdom of the Crowd)',
    category: 'Scouting',
    definition:
      'Multi-board prospect composite pioneered by Arif Hasan (Wide Left) and NFL Mock Draft Database. Empirical multi-year NFL Draft studies show aggregating independent scouting boards achieves ~80%+ draft-capital alignment and outperforms any single evaluator by canceling individual blind spots while exposing prospect rank polarization.'
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
  availability_index: {
    term: 'Team Availability Index (0–100)',
    category: 'Health & Availability Model',
    definition:
      'Snap- and probability-weighted 0–100 lineup health score across the 22 offensive and defensive starters plus key rotational depth and Injured Reserve attrition. Starts at 100 and deducts expected snap-weighted value lost to Out, Doubtful, Questionable/GTD, and IR players (82–100 = Near Full Strength, 68–81 = Moderately Banged Up, <68 = Heavily Depleted).'
  },
  starters_cleared: {
    term: 'Starters Cleared (X/22)',
    category: 'Health & Availability Model',
    definition:
      'Counts how many of a team’s 22 primary offensive and defensive starters are currently off the injury report without an unresolved Out, Doubtful, or Questionable game designation.'
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
  },
  overall_offense_rank: {
    term: 'Overall Offense Composite Score (0–100%)',
    category: 'Composite Methodology',
    definition:
      'Weighted 32-team composite normalized to a 0%–100% scale: Offensive EPA / Play (40%), Points / Game (30%), Total Yards / Game (15%), and 3rd Down Conversion % (15%). Each component is min-max normalized (0% to 100%) across all 32 NFL clubs so both scoring output and down-to-down efficiency are captured.'
  },
  overall_defense_rank: {
    term: 'Overall Defense Composite Score (0–100%)',
    category: 'Composite Methodology',
    definition:
      'Weighted 32-team composite normalized to a 0%–100% scale: Defensive EPA / Play Allowed (40%), Points Allowed / Game (30%), Total Yards Allowed / Game (15%), and 3rd Down Conversion % Allowed (15%). Each component is min-max normalized (0% to 100%, lower allowed = higher %) across all 32 NFL clubs.'
  },
  overall_st_rank: {
    term: 'Overall Special Teams Composite Score (0–100%)',
    category: 'Composite Methodology',
    definition:
      'Weighted 32-team composite normalized to a 0%–100% scale: Field Goal % (35%), Net Punt Average (30%), Kickoff Return Average (20%), and Punt Return Average (15%), min-max normalized across all 32 NFL clubs to measure kicking accuracy and hidden-yardage field position.'
  },
  overall_margin_rank: {
    term: 'Overall Team Margin Composite Score (0–100%)',
    category: 'Composite Methodology',
    definition:
      'Weighted 32-team composite normalized to a 0%–100% scale: Point Differential / Game (40%), Net EPA / Play [Offense minus Defense] (35%), and Turnover Differential / Game (25%) — the three strongest team-level indicators of championship contention.'
  },
  turnover_diff: {
    term: 'Turnover Differential (+/-)',
    category: 'Film & Box',
    definition:
      'Defensive and special-teams takeaways (interceptions + opponent fumble recoveries) minus offensive giveaways (interceptions thrown + fumbles lost).'
  },
  net_epa: {
    term: 'Net EPA / Play (Offense − Defense)',
    category: 'Analytics',
    definition:
      'Offensive EPA per play minus Defensive EPA per play allowed. Positive values indicate a team out-executes opponents on a play-by-play expected-points basis.'
  },
  adot: {
    term: 'aDOT (Average Depth of Target)',
    category: 'Analytics',
    definition:
      'Average air-yard distance downfield from the line of scrimmage on all targeted passes (completions and incompletions).'
  },
  passer_rating: {
    term: 'NFL Passer Rating',
    category: 'Film & Box',
    definition:
      'Traditional 0.0-to-158.3 NFL passing efficiency formula weighting completion percentage, yards per attempt, touchdowns per attempt, and interceptions per attempt.'
  },
  a_b_gap: {
    term: 'A- & B-Gaps (Interior Trench Lanes)',
    category: 'Scheme & Film',
    definition:
      'The four interior trench lanes flanking the center (A-gaps, center-to-guard) and guards (B-gaps, guard-to-tackle). Anchoring the A- and B-gaps denies downhill interior runs, eliminates internal QB step-up lanes, and keeps linebackers clean from climbing blockers.'
  },
  a_gap: {
    term: 'A-Gap',
    category: 'Scheme & Film',
    definition:
      'Interior trench lane directly between the center and either offensive guard (left or right). Controlling the A-gaps stops immediate inside runs and collapses pocket depth in the quarterback’s face.'
  },
  b_gap: {
    term: 'B-Gap',
    category: 'Scheme & Film',
    definition:
      'Interior trench lane between the offensive guard and offensive tackle—primary alignment and penetration lane for 3-technique defensive tackles.'
  },
  c_gap: {
    term: 'C-Gap',
    category: 'Scheme & Film',
    definition:
      'Off-tackle trench lane between the offensive tackle and an inline tight end (or the open outside edge when no tight end is attached).'
  },
  between_the_numbers: {
    term: 'Between the Numbers',
    category: 'Scheme & Film',
    definition:
      'Central ~30-yard field corridor inside the painted yard-line numbers (12 yards from each sideline). Throws between the numbers demand rhythm anticipation and vertical layering between linebackers and safeties.'
  },
  outside_the_numbers: {
    term: 'Outside the Numbers',
    category: 'Scheme & Film',
    definition:
      'The 12-yard perimeter alleys between the painted yard-line numbers and either sideline, where X/Z receivers work isolation go-balls, comebacks, outs, and back-shoulder throws.'
  },
  between_the_hashes: {
    term: 'Between the Hashes',
    category: 'Scheme & Film',
    definition:
      'The 18.5-foot central spine of the NFL field between the inbound hash marks. Spacing seams and option routes between the hashes stretches middle-hook linebackers and split safeties horizontally.'
  },
  honey_hole: {
    term: 'Zone Coverage Honey-Hole',
    category: 'Scheme & Film',
    definition:
      'Soft intermediate void in zone coverage—either the 15–22 yard sideline window behind a flat corner and in front of a deep safety (Cover 2), or the 12–22 yard seam pocket behind underneath hook/curl linebackers and in front of bailing safeties.'
  },
  hook_curl: {
    term: 'Hook / Curl Defenders & Zones',
    category: 'Scheme & Film',
    definition:
      'Underneath intermediate zone defenders (typically inside linebackers or strong safeties) dropping 8–14 yards deep between the hash marks and numbers to wall off digs, crossers, and curl routes.'
  },
  curl_flat: {
    term: 'Curl / Flat Defender',
    category: 'Scheme & Film',
    definition:
      'Underneath perimeter zone defender (outside linebacker, nickel apex, or rolled-down safety in Cover 3) put in high-low conflict: sinking under a 12-yard curl/out before rallying downhill to tackle a quick flat throw.'
  },
  choice_dagger: {
    term: 'Choice & Dagger Route Concepts',
    category: 'Scheme & Film',
    definition:
      'Middle-field zone and man beaters pairing a vertical seam clear-out + 15-yard inward-breaking Dagger dig behind linebackers with an underneath Choice/Option route breaking opposite the hook defender’s leverage.'
  },
  choice_route: {
    term: 'Choice / Option Route',
    category: 'Scheme & Film',
    definition:
      'Isolating route (run by RBs like Christian McCaffrey or slot technicians like Keenan Allen) where the receiver reads the defender’s hip leverage post-snap to break out, break in, or sit down in an open zone void.'
  },
  dagger: {
    term: 'Dagger Concept',
    category: 'Scheme & Film',
    definition:
      'Two-man middle-field pass combo: the inside receiver runs a vertical clear-out route to lift deep safeties while the outside receiver snaps off a sharp 14–16 yard dig route into the vacated intermediate window.'
  },
  pin_and_pull: {
    term: 'Pin-and-Pull',
    category: 'Scheme & Film',
    definition:
      'Perimeter run scheme combining angle down-blocks and pullers: linemen or tight ends with outside leverage "pin" interior defenders inside while uncovered linemen "pull" around the edge to lead the back into space.'
  },
  counter: {
    term: 'Counter Run Scheme',
    category: 'Scheme & Film',
    definition:
      'Misdirection gap-scheme run where the back steps counter first while two backside blockers (Guard + Tackle in GT Counter, or Guard + TE/FB in GH Counter) pull across the formation to kick out the edge defender and wrap up to the playside linebacker.'
  },
  gap_scheme: {
    term: 'Gap-Scheme Run Blocking',
    category: 'Scheme & Film',
    definition:
      'Downhill run family (Counter, Power, Pin-and-Pull, Trap) using angle down-blocks to wall off interior defenders and pulling linemen to lead through a designated gap, contrasting with lateral Zone blocking.'
  },
  tampa_2: {
    term: 'Tampa-2 Coverage',
    category: 'Scheme & Film',
    definition:
      'Modified Cover-2 zone shell where the middle linebacker sprints deep down the central seam ("running the pole") between two deep half-field safeties, closing vertical post/seam windows while opening underneath checkdowns.'
  },
  cover_2: {
    term: 'Cover 2',
    category: 'Scheme & Film',
    definition:
      'Zone structure pairing two deep half-field safeties with five underneath zone defenders (including squat flat corners), strong against perimeter quick game while vulnerable down the deep middle seam or sideline honey-hole.'
  },
  cover_6: {
    term: 'Cover 6 (Quarter-Quarter-Half)',
    category: 'Scheme & Film',
    definition:
      'Split-field two-high coverage playing Quarters (Cover 4) to the passing strength and Cover 2 (deep half safety + squat flat corner) to the boundary/weak side.'
  },
  robber: {
    term: 'Robber / Cover-3 Buzz',
    category: 'Scheme & Film',
    definition:
      'Disguised post-snap coverage rotation where one safety spins down into the intermediate middle ("robbing" crossers, digs, and slants) while the other safety rotates to deep centerfield.'
  },
  cloud_trap: {
    term: 'Cloud / Cover-2 Trap',
    category: 'Scheme & Film',
    definition:
      'Disguised perimeter zone look where the outside corner squats aggressively in the flat—baiting the quarterback into throwing a quick out or hitch before jumping it—while the safety caps vertical routes over the top.'
  },
  spot_drop: {
    term: 'Spot-Drop Zone (Landmark Drops)',
    category: 'Scheme & Film',
    definition:
      'Zone coverage style where defenders sink to fixed field landmarks with eyes on the quarterback to rally and tackle the catch, rather than converting to man-like pattern-match rules.'
  },
  pattern_match: {
    term: 'Pattern-Match Zone',
    category: 'Scheme & Film',
    definition:
      'Hybrid zone coverage where defenders read receiver release distributions post-snap and match routes tightly like man coverage within their assigned zone quadrants.'
  },
  split_safety: {
    term: 'Split-Safety Disguise',
    category: 'Scheme & Film',
    definition:
      'Pre-snap defensive alignment showing two deep safeties at balanced depth (~12 yards) to conceal whether the secondary will play Quarters/Cover 2/Cover 6 or spin post-snap into single-high Cover 3/Robber.'
  },
  condensed_splits: {
    term: 'Condensed / Reduced Splits',
    category: 'Scheme & Film',
    definition:
      'Offensive alignment tucking wide receivers tight near the offensive tackle/tight end core, giving receivers a true two-way release, creating natural traffic against man coverage, and setting up crack/pin angles in the run game.'
  },
  combo_block: {
    term: 'Combo Block',
    category: 'Scheme & Film',
    definition:
      'Trench run/play-action technique where two adjacent linemen initially double-team and displace a defensive tackle together before one climbs vertically to seal the playside linebacker.'
  },
  slide_protection: {
    term: 'Slide / Half-Slide Protection',
    category: 'Scheme & Film',
    definition:
      'Pass-protection rule where the center and playside linemen step laterally in unison to wall off interior gaps and stunts as a zone unit while backside blockers work man-to-man.'
  },
  check_release: {
    term: 'Check-Release',
    category: 'Scheme & Film',
    definition:
      'Dual-purpose RB or TE pass-play assignment: scan or chip an assigned pass rusher/blitzer first, then leak out into an underneath flat or hook outlet if the defender drops.'
  },
  high_low: {
    term: 'High-Low Conflict',
    category: 'Scheme & Film',
    definition:
      'Route-spacing principle placing two receivers at different vertical depths in a single zone defender’s area so whichever route he defends, the other opens up.'
  },
  seam_over: {
    term: 'Seam / Deep Over Route',
    category: 'Scheme & Film',
    definition:
      'Staple Shanahan play-action route: stemming vertically up the interior seam before breaking across the field at 16–22 yards behind linebackers and in front of deep safeties.'
  },
  texas_route: {
    term: 'Angle / Texas Route',
    category: 'Scheme & Film',
    definition:
      'Backfield route where the RB or FB widens toward the flat to widen the linebacker’s leverage before planting sharply back inside at 5–7 yards over the middle.'
  },
  back_shoulder: {
    term: 'Back-Shoulder Throw',
    category: 'Scheme & Film',
    definition:
      'Boundary vertical pass intentionally placed behind and outside the receiver’s back hip so he can adjust before a trailing cornerback whose eyes are turned away from the ball.'
  },
  route_stem: {
    term: 'Route Stem (Top of the Stem)',
    category: 'Scheme & Film',
    definition:
      'Initial vertical release phase of a pass route used to eat a defender’s cushion and threaten deep leverage right before snapping off at the breakpoint.'
  },
  bracket_coverage: {
    term: 'Bracket Coverage',
    category: 'Scheme & Film',
    definition:
      'Coordinated two-defender double coverage (inside-out or high-low) shading an opponent’s primary receiving weapon on money downs.'
  },
  hot_read: {
    term: 'Hot Read / Sight Adjustment',
    category: 'Scheme & Film',
    definition:
      'Built-in quick route and quarterback throw triggered automatically when a defense brings one more blitzer than the protection scheme can block.'
  },
  four_man_rush: {
    term: 'Four-Man Rush',
    category: 'Scheme & Film',
    definition:
      'Generating quarterback pressure strictly with four rushers (via Wide-9 speed, interior push, or stunts) while keeping seven defenders in pass coverage.'
  },
  box_count: {
    term: 'Light Box vs. Stacked Box',
    category: 'Scheme & Film',
    definition:
      'Count of defenders aligned near the line of scrimmage: a Light Box (6 or fewer defenders, standard in two-high shells) favors offense blocker math, while a Stacked Box (8+ defenders) drops an extra safety down to stop the run.'
  },
  personnel_13: {
    term: '13 Personnel',
    category: 'Scheme & Film',
    definition:
      'Heavy offensive grouping with 1 Running Back, 3 Tight Ends, and 1 Wide Receiver, creating extra run-blocking edges and max-protect play-action looks.'
  },
  personnel_multi: {
    term: 'Heavy Multi-Back / Multi-TE Personnel (12/21)',
    category: 'Scheme & Film',
    definition:
      'Cycling between 12 personnel (1 RB, 2 TE, 2 WR) and 21 personnel (2 RB/FB, 1 TE, 2 WR) to force defenses into heavier base lineups that can be stressed horizontally via motion and play-action.'
  },
  all_22: {
    term: 'All-22 Coaches Film',
    category: 'Scheme & Film',
    definition:
      'Overhead sideline and end-zone stadium camera angles showing all 22 players, safety shells, route stems, and blocking mechanics simultaneously.'
  },
  one_two_i: {
    term: '1 / 2i-Technique (Nose / Shade DT)',
    category: 'Depth Chart & Alignment',
    definition:
      'Interior defensive tackle aligned either on the center’s outside shoulder (1-technique) or the guard’s inside shoulder (2i-technique) in the A-gap, tasked with absorbing double-teams, controlling interior run gaps, and collapsing pocket depth.'
  },
  base_4_3: {
    term: '4-3 Base Defense',
    category: 'Depth Chart & Alignment',
    definition:
      'Defensive front featuring 4 defensive linemen (two Wide-9 ends, a 1/2i nose tackle, and a 3-tech DT), 3 off-ball linebackers (SAM, MIKE, WILL), and 4 defensive backs, primarily deployed against heavy 21/12/22 run personnel.'
  },
  nickel_4_2_5: {
    term: '4-2-5 Nickel Defense',
    category: 'Depth Chart & Alignment',
    definition:
      'Primary modern NFL sub-package (~70% of defensive snaps): 4 defensive linemen, 2 off-ball linebackers (MIKE + WILL), and 5 defensive backs (two outside corners, two safeties, and a slot Nickel CB replacing the SAM linebacker).'
  },
  nickel_cb: {
    term: 'Nickel / Slot Cornerback (NB)',
    category: 'Depth Chart & Alignment',
    definition:
      'Fifth defensive back aligned inside over the slot receiver or detached tight end in 4-2-5 Nickel; must handle two-way slot route releases, perimeter run force, and apex blitzes.'
  },
  x_receiver: {
    term: 'X-Receiver (Split End)',
    category: 'Depth Chart & Alignment',
    definition:
      'Outside perimeter wide receiver tethered on the line of scrimmage (typically opposite the tight end); often isolated single-side where he must beat press coverage off the snap without pre-snap motion.'
  },
  z_receiver: {
    term: 'Z-Receiver (Flanker)',
    category: 'Depth Chart & Alignment',
    definition:
      'Movement wide receiver aligned off the line of scrimmage; free to run pre-snap jet/orbit motion, condensed bunches, and high-YAC in-breaking routes in Kyle Shanahan’s offense.'
  },
  slot_wr: {
    term: 'SLWR (Slot Wide Receiver)',
    category: 'Depth Chart & Alignment',
    definition:
      'Inside wide receiver aligned between the offensive tackle and perimeter receiver in 11 personnel (3-WR sets), operating with a two-way go against nickels, safeties, and linebackers.'
  },
  y_tight_end: {
    term: 'Y-Tight End (In-Line Tight End)',
    category: 'Depth Chart & Alignment',
    definition:
      'Primary tight end attached to the offensive tackle on the line of scrimmage (George Kittle role), anchoring C-gap run blocking and play-action pass protection while threatening vertical seams.'
  },
  fullback: {
    term: 'FB (Fullback / Move-Back)',
    category: 'Depth Chart & Alignment',
    definition:
      'Hybrid lead blocker and versatile chess piece in 21 personnel (Kyle Juszczyk role) used to insert extra run gaps, chip Wide-9 edge rushers, and detach to the slot or boundary to create coverage mismatches.'
  },
  will_lb: {
    term: 'WILL Linebacker (Weakside LB)',
    category: 'Depth Chart & Alignment',
    definition:
      'Off-ball linebacker aligned away from the offensive tight end / passing strength, protected by the 3-technique DT to chase sideline-to-sideline and cover backs and tight ends in space.'
  },
  mike_lb: {
    term: 'MIKE Linebacker (Middle LB)',
    category: 'Depth Chart & Alignment',
    definition:
      'Defensive quarterback ("green dot" helmet communicator, Fred Warner role) aligned centrally to set front strength, fit interior run gaps, and carry deep middle seams in Tampa-2 and pattern-match zones.'
  },
  sam_lb: {
    term: 'SAM Linebacker (Strongside LB)',
    category: 'Depth Chart & Alignment',
    definition:
      'Third linebacker on the field in Base 4-3 defense aligned to the tight-end strength side to set C/D-gap run edges and jam tight ends; subbed off for the Nickel CB in 4-2-5.'
  },
  strong_safety: {
    term: 'SS (Strong Safety)',
    category: 'Depth Chart & Alignment',
    definition:
      'Safety versatile enough to rotate down into the box or curl/flat as an extra run defender and tight-end cover man while playing half-field or quarters deep in two-high shells.'
  },
  free_safety: {
    term: 'FS (Free Safety)',
    category: 'Depth Chart & Alignment',
    definition:
      'Deep-ranging safety responsible for post/centerfield range in single-high shells and split-field vertical landmarks in two-high Quarters and Cover 2.'
  },
  long_snapper: {
    term: 'LS (Long Snapper)',
    category: 'Depth Chart & Alignment',
    definition:
      'Specialist snapping 7–8 yards to the holder on field goals/PATs and 14–15 yards to the punter with precise spiral rotation (~0.70s punt snap velocity) before covering downfield.'
  },
  punt_returner: {
    term: 'PR (Punt Returner)',
    category: 'Depth Chart & Alignment',
    definition:
      'Special-teams ball carrier tracking hang-time punts in traffic to decide between fair catch, bounce-away poison calls, or vertical hidden-yardage returns.'
  },
  kick_returner: {
    term: 'KR (Kick Returner)',
    category: 'Depth Chart & Alignment',
    definition:
      'Special-teams returner fielding kickoffs inside the NFL Dynamic Kickoff landing zone (goal line to 20-yard line) before coverage and return fronts converge.'
  }
};

const KEY_SYNONYMS = {
  dead_cap: 'dead_money',
  '11_personnel': 'personnel_11',
  '12_personnel': 'personnel_12',
  '13_personnel': 'personnel_13',
  '21_personnel': 'personnel_21',
  '22_personnel': 'personnel_22',
  ab_gap: 'a_b_gap',
  option_route: 'choice_route',
  over_route: 'seam_over',
  angle_route: 'texas_route',
  cover_4: 'quarters'
};

/**
 * Phrase-to-key patterns for automatic subtle jargon linking in prose.
 * Sorted longest-first at compile time so multi-word phrases win cleanly over substrings.
 */
const PHRASE_ALIASES = [
  ['Effective Cap Space', 'effective_cap_space'],
  ['Team Cap Space', 'gross_cap_space'],
  ['Gross Cap Space', 'gross_cap_space'],
  ['Post-June 1', 'post_june_1'],
  ['Pre-June 1', 'pre_june_1'],
  ['Prorated Bonus', 'prorated_bonus'],
  ['prorated bonuses', 'prorated_bonus'],
  ['Option Bonus', 'option_bonus'],
  ['Guaranteed Salary', 'guaranteed_salary'],
  ['Void Years', 'void_years'],
  ['void year', 'void_years'],
  ['Dead Money', 'dead_money'],
  ['Dead Cap', 'dead_money'],
  ['Top-51', 'top_51'],
  ['Top 51', 'top_51'],
  ['Rich Hill', 'rich_hill'],
  ['Monte Carlo', 'monte_carlo'],
  ['A- and B-gaps', 'a_b_gap'],
  ['A- and B- gaps', 'a_b_gap'],
  ['A- and B-gap', 'a_b_gap'],
  ['A & B gaps', 'a_b_gap'],
  ['A and B gaps', 'a_b_gap'],
  ['A/B-gaps', 'a_b_gap'],
  ['A/B-gap', 'a_b_gap'],
  ['A/B gaps', 'a_b_gap'],
  ['A/B gap', 'a_b_gap'],
  ['A-gaps', 'a_gap'],
  ['A-gap', 'a_gap'],
  ['A gap', 'a_gap'],
  ['B-gaps', 'b_gap'],
  ['B-gap', 'b_gap'],
  ['B gap', 'b_gap'],
  ['C-gaps', 'c_gap'],
  ['C-gap', 'c_gap'],
  ['C gap', 'c_gap'],
  ['between the numbers', 'between_the_numbers'],
  ['outside the numbers', 'outside_the_numbers'],
  ['between the hashes', 'between_the_hashes'],
  ['honey-hole', 'honey_hole'],
  ['honey hole', 'honey_hole'],
  ['hole shot', 'honey_hole'],
  ['hook/curl linebackers', 'hook_curl'],
  ['hook/curl linebacker', 'hook_curl'],
  ['hook/curl zones', 'hook_curl'],
  ['hook/curl zone', 'hook_curl'],
  ['seam & hook zones', 'hook_curl'],
  ['hook/curl', 'hook_curl'],
  ['hook-to-curl', 'hook_curl'],
  ['middle-hook', 'hook_curl'],
  ['hook zones', 'hook_curl'],
  ['hook zone', 'hook_curl'],
  ['curl/flat defenders', 'curl_flat'],
  ['curl/flat defender', 'curl_flat'],
  ['curl/flat zones', 'curl_flat'],
  ['curl/flat zone', 'curl_flat'],
  ['curl/flat', 'curl_flat'],
  ['curl-to-flat', 'curl_flat'],
  ['choice/dagger concepts', 'choice_dagger'],
  ['choice/dagger', 'choice_dagger'],
  ['choice & dagger', 'choice_dagger'],
  ['choice routes', 'choice_route'],
  ['choice route', 'choice_route'],
  ['option routes', 'choice_route'],
  ['option route', 'choice_route'],
  ['option-route', 'choice_route'],
  ['dagger concepts', 'dagger'],
  ['dagger concept', 'dagger'],
  ['dagger route', 'dagger'],
  ['dagger', 'dagger'],
  ['pin-and-pull', 'pin_and_pull'],
  ['pin-and-pul', 'pin_and_pull'],
  ['pin & pull', 'pin_and_pull'],
  ['GT counter', 'counter'],
  ['GH counter', 'counter'],
  ['counter run', 'counter'],
  ['counter', 'counter'],
  ['gap-scheme', 'gap_scheme'],
  ['gap schemes', 'gap_scheme'],
  ['gap scheme', 'gap_scheme'],
  ['Tampa-2', 'tampa_2'],
  ['Tampa 2', 'tampa_2'],
  ['Cover 4 Quarters', 'quarters'],
  ['Cover 4/6', 'cover_6'],
  ['Cover 6', 'cover_6'],
  ['Cover-6', 'cover_6'],
  ['Cover 2', 'cover_2'],
  ['Cover-2', 'cover_2'],
  ['Cover-3 Buzz', 'robber'],
  ['Robber', 'robber'],
  ['cloud-trap', 'cloud_trap'],
  ['Cover-2 Trap', 'cloud_trap'],
  ['trap coverage', 'cloud_trap'],
  ['spot-drop zone', 'spot_drop'],
  ['spot-drop', 'spot_drop'],
  ['landmark drops', 'spot_drop'],
  ['pattern-match', 'pattern_match'],
  ['match Quarters', 'pattern_match'],
  ['split-safety rotations', 'split_safety'],
  ['split-safety', 'split_safety'],
  ['condensed splits', 'condensed_splits'],
  ['condenses splits', 'condensed_splits'],
  ['reduced splits', 'condensed_splits'],
  ['combo-blocks', 'combo_block'],
  ['combo-block', 'combo_block'],
  ['combo blocks', 'combo_block'],
  ['combo block', 'combo_block'],
  ['double-teams', 'combo_block'],
  ['double-team', 'combo_block'],
  ['slide protection', 'slide_protection'],
  ['half-slide', 'slide_protection'],
  ['check-release', 'check_release'],
  ['chip releases', 'check_release'],
  ['chip release', 'check_release'],
  ['play-action chips', 'check_release'],
  ['high-low conflict', 'high_low'],
  ['high-low', 'high_low'],
  ['seam/over routes', 'seam_over'],
  ['seam/over', 'seam_over'],
  ['deep over', 'seam_over'],
  ['over routes', 'seam_over'],
  ['over route', 'seam_over'],
  ['seam routes', 'seam_over'],
  ['seam route', 'seam_over'],
  ['angle/Texas routes', 'texas_route'],
  ['angle/Texas', 'texas_route'],
  ['Texas routes', 'texas_route'],
  ['Texas-route', 'texas_route'],
  ['Texas route', 'texas_route'],
  ['angle routes', 'texas_route'],
  ['angle route', 'texas_route'],
  ['back-shoulder fades', 'back_shoulder'],
  ['back-shoulder fade', 'back_shoulder'],
  ['back-shoulder', 'back_shoulder'],
  ['top of the stem', 'route_stem'],
  ['route stem', 'route_stem'],
  ['bracket coverage', 'bracket_coverage'],
  ['brackets', 'bracket_coverage'],
  ['sight adjustments', 'hot_read'],
  ['sight adjustment', 'hot_read'],
  ['sight adjust', 'hot_read'],
  ['hot read', 'hot_read'],
  ['four-man rush', 'four_man_rush'],
  ['4-man rush', 'four_man_rush'],
  ['light boxes', 'box_count'],
  ['light box', 'box_count'],
  ['stacked box', 'box_count'],
  ['8-man box', 'box_count'],
  ['All-22', 'all_22'],
  ['simulated pressure', 'sim_pressure'],
  ['sim pressures', 'sim_pressure'],
  ['sim pressure', 'sim_pressure'],
  ['outside-zone', 'outside_zone'],
  ['outside zone', 'outside_zone'],
  ['wide-zone', 'outside_zone'],
  ['wide zone', 'outside_zone'],
  ['inside-zone', 'inside_zone'],
  ['inside zone', 'inside_zone'],
  ['jet motion', 'jet_motion'],
  ['orbit motion', 'orbit_motion'],
  ['play-action', 'play_action'],
  ['play action', 'play_action'],
  ['naked boot', 'boot'],
  ['bootleg', 'boot'],
  ['boot flood', 'boot'],
  ['12/21 red-zone personnel', 'personnel_multi'],
  ['12/21 personnel', 'personnel_multi'],
  ['21/11-personnel', 'personnel_multi'],
  ['12/21', 'personnel_multi'],
  ['21 personnel', 'personnel_21'],
  ['21-personnel', 'personnel_21'],
  ['21 Pers', 'personnel_21'],
  ['13 personnel', 'personnel_13'],
  ['13-personnel', 'personnel_13'],
  ['12 personnel', 'personnel_12'],
  ['12-personnel', 'personnel_12'],
  ['11 personnel', 'personnel_11'],
  ['11-personnel', 'personnel_11'],
  ['11 Pers', 'personnel_11'],
  ['22 personnel', 'personnel_22'],
  ['22-personnel', 'personnel_22'],
  ['Nickel 4-2-5', 'nickel_4_2_5'],
  ['4-2-5', 'nickel_4_2_5'],
  ['Base 4-3', 'base_4_3'],
  ['NICKEL CB', 'nickel_cb'],
  ['Nickel CB', 'nickel_cb'],
  ['WILL LB', 'will_lb'],
  ['MIKE LB', 'mike_lb'],
  ['SAM LB', 'sam_lb'],
  ['SLWR', 'slot_wr'],
  ['Wide-9', 'wide_9'],
  ['Wide 9', 'wide_9'],
  ['1/2i-technique', 'one_two_i'],
  ['1/2i-tech', 'one_two_i'],
  ['1/2i', 'one_two_i'],
  ['3-technique', 'three_tech'],
  ['3-tech', 'three_tech'],
  ['1-technique', 'one_tech'],
  ['1-tech', 'one_tech'],
  ['2i-technique', 'two_i'],
  ['2i-tech', 'two_i'],
  ['2i', 'two_i'],
  ['T-E stunts', 'stunt'],
  ['T-E stunt', 'stunt'],
  ['E-T stunts', 'stunt'],
  ['E-T stunt', 'stunt'],
  ['stunts', 'stunt'],
  ['stunt', 'stunt'],
  ['chip help', 'chip'],
  ['Cover 3', 'cover_3'],
  ['Cover-3', 'cover_3'],
  ['Cover 4', 'quarters'],
  ['Cover-4', 'quarters'],
  ['Quarters', 'quarters'],
  ['two-high shells', 'two_high'],
  ['two-high shell', 'two_high'],
  ['two-high', 'two_high'],
  ['2-high', 'two_high'],
  ['single-high', 'single_high'],
  ['1-high', 'single_high'],
  ['press-zone', 'press_zone'],
  ['big nickel', 'nickel'],
  ['nickel packages', 'nickel'],
  ['nickel', 'nickel'],
  ['dime packages', 'dime'],
  ['EPA/play', 'epa'],
  ['EPA/db', 'epa'],
  ['EPA/gm', 'epa'],
  ['EPA', 'epa'],
  ['CPOE', 'cpoe'],
  ['Total QBR', 'qbr'],
  ['QBR', 'qbr'],
  ['WOPR', 'wopr'],
  ['RACR', 'racr'],
  ['RYOE/Att', 'ryoe'],
  ['RYOE/att', 'ryoe'],
  ['RYOE', 'ryoe'],
  ['DADOT', 'dadot'],
  ['YPRR', 'yprr'],
  ['PBWR', 'pbwr'],
  ['RSWR', 'rswr'],
  ['SOV', 'sov'],
  ['SOS', 'sos'],
  ['Article 13', 'article_13'],
  ['concussion protocol', 'concussion_protocol'],
  ['YAC', 'yac'],
  ['RAS', 'ras'],
  ['TFL', 'tfl'],
  ['UDFAs', 'udfa'],
  ['UDFA', 'udfa'],
  ['21-day practice window', 'ir'],
  ['21-day return window', 'ir'],
  ['Injured Reserve', 'ir'],
  ['game-time decision', 'gtd'],
  ['GTD', 'gtd'],
  ['DNP', 'dnp'],
  ['LP', 'lp'],
  ['FP', 'fp'],
  ['NIR', 'nir'],
  ['PUP', 'pup'],
  ['Duo', 'duo'],
  ['Explosive Plays', 'explosive_plays'],
  ['Sacks Allowed Rate', 'sack_rate'],
  ['Net Yards / Pass Att', 'ny_pa'],
  ['Def. Takeaways', 'takeaways']
];

const STRICT_UPPERCASE_ACRONYMS = new Set([
  'EPA',
  'CPOE',
  'QBR',
  'WOPR',
  'RACR',
  'RYOE',
  'DADOT',
  'YPRR',
  'PBWR',
  'RSWR',
  'SOV',
  'SOS',
  'YAC',
  'RAS',
  'TFL',
  'UDFA',
  'UDFAs',
  'GTD',
  'DNP',
  'LP',
  'FP',
  'NIR',
  'PUP',
  'IR'
]);

const SORTED_ALIASES = [...PHRASE_ALIASES].sort((a, b) => b[0].length - a[0].length);
const ALIAS_TO_KEY = new Map(SORTED_ALIASES.map(([p, k]) => [p.toLowerCase(), k]));
const ALIAS_CANONICAL_BY_LOWER = new Map(SORTED_ALIASES.map(([p]) => [p.toLowerCase(), p]));

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const JARGON_REGEX = new RegExp(
  `(?<![A-Za-z0-9_])(${SORTED_ALIASES.map(([p]) => escapeRegex(p)).join('|')})(?![A-Za-z0-9_])`,
  'gi'
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
export function annotateJargonPlainText(rawText, { maxTerms = 16, seenKeys = null } = {}) {
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

    const lower = phrase.toLowerCase();
    const canonical = ALIAS_CANONICAL_BY_LOWER.get(lower);
    const acronymMismatch = canonical && STRICT_UPPERCASE_ACRONYMS.has(canonical) && phrase !== canonical;
    const insideUrl = /https?:\/\/\S*$/i.test(text.slice(0, mStart));

    const key = !acronymMismatch && !insideUrl ? ALIAS_TO_KEY.get(lower) : null;
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
