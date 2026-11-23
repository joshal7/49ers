/**
 * Calibrated 10,000-Iteration NFL Regular Season & NFC Playoff Seeding Monte Carlo Engine
 *
 * Key Statistical & NFL Rulebook Design:
 * 1. Empirical-Bayes Regressed Power Rating (`computeCalibratedTeamPowerRating`):
 *    - Blends soft-capped scoring margin/game, net offensive+defensive EPA/game,
 *      clutch W-L record signal, and opponent strength-of-schedule adjustment.
 *    - Applies Bayesian small-sample shrinkage (`gp / (gp + 9.5)`) toward the 1500 league
 *      prior so early/mid-season 6-1 or 1-6 records are never over-extrapolated into
 *      unrealistic 85%+ per-game win probabilities.
 *    - Scales at 22 Elo points per 1.0 NFL spread point (`winProb = 1 / (1 + 10^(-diff/400))`).
 * 2. Modern NFL Game Simulation:
 *    - Home-Field Advantage = 36 Elo (~1.65 spread points), 0 Elo for International/Neutral games.
 *    - Includes empirical NFL overtime tie probability (~0.35% in coin-flip games).
 * 3. Official NFL Rulebook Multi-Team (2-Club & 3+ Club) Tiebreakers with Step-1 Restart:
 *    - Division: H2H (combined among tied clubs) -> Division Win% -> Common Games ->
 *      Conference Win% -> Strength of Victory (SOV) -> Strength of Schedule (SOS) -> Point Diff.
 *    - Wild Card & #1 Seed: Reduce to 1 club per division -> H2H (2-club direct, or 3+ club
 *      complete sweep / swept-by-all rule) -> Conference Win% -> Common Games (min 4) ->
 *      Strength of Victory (SOV) -> Strength of Schedule (SOS) -> Point Diff.
 */

export const NFC_DIVISIONS = {
  SF: 'NFC West',
  SEA: 'NFC West',
  LAR: 'NFC West',
  ARI: 'NFC West',
  DET: 'NFC North',
  MIN: 'NFC North',
  GB: 'NFC North',
  CHI: 'NFC North',
  PHI: 'NFC East',
  DAL: 'NFC East',
  NYG: 'NFC East',
  WAS: 'NFC East',
  TB: 'NFC South',
  NO: 'NFC South',
  ATL: 'NFC South',
  CAR: 'NFC South'
};

export const AFC_DIVISIONS = {
  BUF: 'AFC East',
  MIA: 'AFC East',
  NE: 'AFC East',
  NYJ: 'AFC East',
  BAL: 'AFC North',
  CIN: 'AFC North',
  CLE: 'AFC North',
  PIT: 'AFC North',
  HOU: 'AFC South',
  IND: 'AFC South',
  JAX: 'AFC South',
  TEN: 'AFC South',
  DEN: 'AFC West',
  KC: 'AFC West',
  LV: 'AFC West',
  LAC: 'AFC West'
};

export const ALL_NFL_DIVISIONS = { ...NFC_DIVISIONS, ...AFC_DIVISIONS };
export const NFC_DIVISION_NAMES = ['NFC West', 'NFC North', 'NFC East', 'NFC South'];
export const AFC_DIVISION_NAMES = ['AFC East', 'AFC North', 'AFC South', 'AFC West'];

const ALL_NFC_TEAMS = Object.keys(NFC_DIVISIONS);
const ALL_AFC_TEAMS = Object.keys(AFC_DIVISIONS);

export function getConferenceForTeam(abbr = 'SF') {
  const norm = normalizeTeamAbbr(abbr);
  return AFC_DIVISIONS[norm] ? 'AFC' : 'NFC';
}

// Modern post-2020 NFL Home-Field Advantage (~1.65 points on 22-Elo/pt scale)
export const HOME_FIELD_ELO_ADV = 36;
export const ELO_PER_SPREAD_POINT = 22;
export const BAYESIAN_PRIOR_GAMES = 9.5;
export const IN_SEASON_ELO_K = 18;
export const LN10_DIV_400 = Math.LN10 / 400;

/**
 * Deterministic fast PRNG (Mulberry32) so identical scenarios produce reproducible percentages.
 */
function mulberry32(seed) {
  let a = seed >>> 0;
  return function nextRandom() {
    let t = (a += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Normalizes historical/feed team abbreviations to canonical modern NFL abbreviations.
 */
export function normalizeTeamAbbr(abbr) {
  const map = {
    LA: 'LAR',
    STL: 'LAR',
    WSH: 'WAS',
    JAC: 'JAX',
    OAK: 'LV',
    SD: 'LAC'
  };
  const clean = String(abbr || '').trim().toUpperCase();
  return map[clean] || clean;
}

/**
 * Canonical deduplication key for an NFL game across mixed feed IDs (e.g. nflverse `2026_13_MIA_DEN`
 * vs. ESPN numeric event ID `401873085`). Because two clubs can never play each other twice in the
 * same NFL week, keying by `week:sortedTeamA_sortedTeamB` collapses both identical-order duplicates
 * and neutral-site home/away discrepancies, while falling back cleanly to `id` for synthetic tests
 * that omit `week`.
 */
export function canonicalPlayoffGameKey(game) {
  if (!game || typeof game !== 'object') return null;
  const wk = Number(game.week || 0);
  const home = normalizeTeamAbbr(game.home);
  const away = normalizeTeamAbbr(game.away);
  if (wk > 0 && home && away) {
    const pair = home < away ? `${home}_${away}` : `${away}_${home}`;
    return `${wk}:${pair}`;
  }
  const id = String(game.id ?? game.gameId ?? '').trim();
  return id ? `id:${id}` : null;
}

/**
 * Reconciles and deduplicates `completedGames` and `remainingGames` so no NFL matchup is ever
 * double-counted in Monte Carlo simulations or duplicated in the Rooting Guide when nflverse and
 * live ESPN scoreboard feeds use different event ID schemes.
 */
export function reconcileAndDedupePlayoffGames(completedGames = [], remainingGames = []) {
  const completedByKey = new Map();
  const completedNoKey = [];

  for (const cg of Array.isArray(completedGames) ? completedGames : []) {
    if (!cg || typeof cg !== 'object') continue;
    const norm = {
      ...cg,
      home: normalizeTeamAbbr(cg.home),
      away: normalizeTeamAbbr(cg.away)
    };
    const key = canonicalPlayoffGameKey(norm);
    if (!key) {
      completedNoKey.push(norm);
      continue;
    }
    const existing = completedByKey.get(key);
    if (!existing) {
      completedByKey.set(key, norm);
    } else {
      const existingHasScores =
        existing.homeScore != null &&
        existing.awayScore != null &&
        Number.isFinite(Number(existing.homeScore)) &&
        Number.isFinite(Number(existing.awayScore));
      const nextHasScores =
        norm.homeScore != null &&
        norm.awayScore != null &&
        Number.isFinite(Number(norm.homeScore)) &&
        Number.isFinite(Number(norm.awayScore));
      if (!existingHasScores && nextHasScores) {
        completedByKey.set(key, { ...norm, id: existing.id || norm.id });
      }
    }
  }

  const remainingByKey = new Map();
  const remainingNoKey = [];
  const aliasIdMap = new Map();

  for (const rg of Array.isArray(remainingGames) ? remainingGames : []) {
    if (!rg || typeof rg !== 'object') continue;
    const norm = {
      ...rg,
      home: normalizeTeamAbbr(rg.home),
      away: normalizeTeamAbbr(rg.away)
    };
    const key = canonicalPlayoffGameKey(norm);
    if (key && completedByKey.has(key)) continue;
    if (!key) {
      remainingNoKey.push(norm);
      continue;
    }
    const existing = remainingByKey.get(key);
    if (!existing) {
      remainingByKey.set(key, norm);
      if (norm.id != null) {
        const cid = String(norm.id);
        aliasIdMap.set(cid, new Set([cid]));
      }
    } else {
      const canonId = String(existing.id ?? '');
      const altId = String(norm.id ?? '');
      if (canonId && altId && altId !== canonId) {
        if (!aliasIdMap.has(canonId)) aliasIdMap.set(canonId, new Set([canonId]));
        aliasIdMap.get(canonId).add(altId);
      }
      if (!existing.neutral && norm.neutral) {
        existing.neutral = true;
      }
    }
  }

  return {
    completedGames: [...completedByKey.values(), ...completedNoKey],
    remainingGames: [...remainingByKey.values(), ...remainingNoKey],
    aliasIdMap
  };
}

/**
 * Computes a market-calibrated NFL Elo power rating centered at 1500 (`22 Elo ≈ 1.0 spread pt`).
 *
 * Avoids double-counting W-L record and raw point differential without regression:
 * - Soft-caps per-game point differential via `tanh(pdGm / 15) * 15` to dampen single-game blowouts.
 * - Blends Net EPA/game (`offEpaPerGame - defEpaAllowedPerGame`) when available.
 * - Adds opponent schedule strength (`sosSpreadAdj` in points above average).
 * - Shrinks toward 0.0 spread points via empirical Bayes factor `gp / (gp + 9.5)`.
 */
export function computeCalibratedTeamPowerRating({
  wins = 0,
  losses = 0,
  ties = 0,
  pointDiff = 0,
  pointsFor = null,
  pointsAgainst = null,
  netEpaPerGame = null,
  sosSpreadAdj = 0
} = {}) {
  const gp = Math.max(0, Number(wins || 0) + Number(losses || 0) + Number(ties || 0));
  if (gp === 0) return 1500;

  const winPct = (Number(wins || 0) + 0.5 * Number(ties || 0)) / gp;
  const rawPdGm = Number(pointDiff || 0) / gp;
  let cappedPdGm = Math.tanh(rawPdGm / 15) * 15;

  // Optional Morey 2.37 NFL Pythagorean expectation blend when PF & PA are supplied
  if (
    pointsFor !== null &&
    pointsAgainst !== null &&
    Number.isFinite(Number(pointsFor)) &&
    Number.isFinite(Number(pointsAgainst)) &&
    (Number(pointsFor) > 0 || Number(pointsAgainst) > 0)
  ) {
    const pfPow = Math.pow(Math.max(1, Number(pointsFor)), 2.37);
    const paPow = Math.pow(Math.max(1, Number(pointsAgainst)), 2.37);
    const pythWinPct = pfPow / (pfPow + paPow);
    const pythSpreadPts = Math.tanh(((pythWinPct - 0.5) * 26) / 15) * 15;
    cappedPdGm = 0.65 * cappedPdGm + 0.35 * pythSpreadPts;
  }

  const hasNetEpa = netEpaPerGame !== null && netEpaPerGame !== undefined && Number.isFinite(Number(netEpaPerGame));
  const cappedEpaGm = hasNetEpa ? Math.tanh(Number(netEpaPerGame) / 15) * 15 : cappedPdGm;
  const recordSignalPts = (winPct - 0.5) * 5.5;

  const unregressedSpreadPts =
    (hasNetEpa ? 0.45 * cappedPdGm + 0.40 * cappedEpaGm + 0.15 * recordSignalPts : 0.78 * cappedPdGm + 0.22 * recordSignalPts) +
    0.55 * Number(sosSpreadAdj || 0);

  const shrinkage = gp / (gp + BAYESIAN_PRIOR_GAMES);
  const regressedSpreadPts = unregressedSpreadPts * shrinkage;

  return Math.round(Math.max(1340, Math.min(1650, 1500 + regressedSpreadPts * ELO_PER_SPREAD_POINT)));
}

/**
 * Samples a realistic positive integer victory margin conditional on the winner (`M_winner > 0`).
 * Uses a fast closed-form truncated-normal expectation approximation (`0.5 * (mu + sqrt(mu^2 + 196))`)
 * so heavy favorites win by wider margins on average (~14-18 pts) while heavy underdogs pulling an
 * upset win tight games (~1-7 pts) rather than inverted blowouts.
 */
export function sampleConditionalVictoryMargin(winnerExpectedMargin = 0, uMargin = 0.5) {
  const mu = Number(winnerExpectedMargin) || 0;
  const condMean = 0.5 * (mu + Math.sqrt(mu * mu + 196));
  const sampled = condMean + (Number(uMargin) - 0.35) * 8;
  return Math.max(1, Math.round(sampled));
}

function winProbabilityHome(homeElo, awayElo, isNeutral = false) {
  const hfa = isNeutral ? 0 : HOME_FIELD_ELO_ADV;
  const diff = homeElo + hfa - awayElo;
  return 1 / (1 + Math.pow(10, -diff / 400));
}

function calcWinPct(w, l, t) {
  const g = w + l + t;
  return g > 0 ? (w + 0.5 * t) / g : 0.5;
}

const EPS = 1e-7;

/**
 * Runs 10,000-iteration calibrated NFC regular-season & playoff-seeding simulation.
 *
 * @param {Object} config
 * @param {Array} config.nfcTeams - 16 NFC team baselines:
 *   { abbr, name, division, wins, losses, ties, divWins, divLosses, divTies, confWins, confLosses, confTies, pointDiff, powerRating }
 * @param {Object} config.afcPowerRatings - Map of AFC team abbr -> Elo rating (default 1500)
 * @param {Object} config.afcStandings - Optional map of AFC team abbr -> { wins, losses, ties }
 * @param {Array} config.completedGames - Array of completed games { home, away, homeScore, awayScore }
 * @param {Array} config.remainingGames - Array of remaining NFL games { id, week, home, away, neutral }
 * @param {Object} config.forcedWinners - Optional user scenario overrides { [gameId]: 'HOME' | 'AWAY' | 'TIE' }
 * @param {number} config.iterations - Default 10000
 * @param {number} config.seed - PRNG seed (default 492026)
 */
export function runPlayoffMonteCarlo(config = {}) {
  const {
    targetTeam = 'SF',
    conference = null,
    conferenceTeams = null,
    nfcTeams = [],
    otherConferencePowerRatings = null,
    afcPowerRatings = {},
    afcRatings = {},
    otherConferenceStandings = null,
    afcStandings = {},
    completedGames = [],
    remainingGames = [],
    forcedWinners = {},
    iterations = 10000,
    seed = 492026
  } = config;
  const targetAbbr = normalizeTeamAbbr(targetTeam || 'SF');
  const activeConf = conference
    ? String(conference).toUpperCase() === 'AFC'
      ? 'AFC'
      : 'NFC'
    : getConferenceForTeam(targetAbbr);
  const confDivMap = activeConf === 'AFC' ? AFC_DIVISIONS : NFC_DIVISIONS;
  const divNames = activeConf === 'AFC' ? AFC_DIVISION_NAMES : NFC_DIVISION_NAMES;
  const otherConfTeamList = activeConf === 'AFC' ? ALL_NFC_TEAMS : ALL_AFC_TEAMS;
  const activeConfTeams = Array.isArray(conferenceTeams) && conferenceTeams.length > 0 ? conferenceTeams : nfcTeams;
  const resolvedAfcPowerRatings =
    otherConferencePowerRatings && Object.keys(otherConferencePowerRatings).length > 0
      ? otherConferencePowerRatings
      : Object.keys(afcPowerRatings).length > 0
        ? afcPowerRatings
        : afcRatings || {};
  const resolvedOtherStandings =
    otherConferenceStandings && Object.keys(otherConferenceStandings).length > 0
      ? otherConferenceStandings
      : afcStandings || {};

  if (!Array.isArray(activeConfTeams) || activeConfTeams.length === 0) {
    return { iterations: 0, conference: activeConf, targetTeam: targetAbbr, teamOdds: null, sfOdds: null, allTeamOdds: [] };
  }

  const rand = mulberry32(seed);
  const nTeams = activeConfTeams.length; // 16 conference clubs (indices 0..15)

  // Build unified 32-team index space: 0..nTeams-1 = target conference, nTeams..31 = opposite conference
  const abbrToIdx = new Map();
  activeConfTeams.forEach((t, idx) => abbrToIdx.set(normalizeTeamAbbr(t.abbr), idx));
  let nextIdx = nTeams;
  for (const otherAbbr of otherConfTeamList) {
    const norm = normalizeTeamAbbr(otherAbbr);
    if (!abbrToIdx.has(norm)) abbrToIdx.set(norm, nextIdx++);
  }
  const totalTeams = nextIdx; // 32

  const divIndexOf = new Int8Array(nTeams);
  const divRosters = divNames.map(() => []);

  const baseW = new Int16Array(totalTeams);
  const baseL = new Int16Array(totalTeams);
  const baseT = new Int16Array(totalTeams);
  const baseDivW = new Int16Array(nTeams);
  const baseDivL = new Int16Array(nTeams);
  const baseDivT = new Int16Array(nTeams);
  const baseConfW = new Int16Array(nTeams);
  const baseConfL = new Int16Array(nTeams);
  const baseConfT = new Int16Array(nTeams);
  const basePD = new Float64Array(nTeams);
  const elo = new Float64Array(totalTeams);

  activeConfTeams.forEach((t, i) => {
    const resolvedDiv = confDivMap[normalizeTeamAbbr(t.abbr)] || t.division || divNames[0];
    const dIdx = Math.max(0, divNames.indexOf(resolvedDiv));
    divIndexOf[i] = dIdx;
    divRosters[dIdx].push(i);

    baseW[i] = t.wins || 0;
    baseL[i] = t.losses || 0;
    baseT[i] = t.ties || 0;
    baseDivW[i] = t.divWins || 0;
    baseDivL[i] = t.divLosses || 0;
    baseDivT[i] = t.divTies || 0;
    baseConfW[i] = t.confWins || 0;
    baseConfL[i] = t.confLosses || 0;
    baseConfT[i] = t.confTies || 0;
    basePD[i] = t.pointDiff || 0;
    elo[i] =
      t.powerRating ||
      computeCalibratedTeamPowerRating({
        wins: baseW[i],
        losses: baseL[i],
        ties: baseT[i],
        pointDiff: basePD[i],
        pointsFor: t.pointsFor ?? null,
        pointsAgainst: t.pointsAgainst ?? null,
        netEpaPerGame: t.netEpaPerGame ?? null
      });
  });

  for (const [abbr, idx] of abbrToIdx.entries()) {
    if (idx < nTeams) continue;
    const st = resolvedOtherStandings[abbr] || null;
    elo[idx] = Number(resolvedAfcPowerRatings[abbr]) || 1500;
    if (st) {
      baseW[idx] = st.wins || 0;
      baseL[idx] = st.losses || 0;
      baseT[idx] = st.ties || 0;
    }
  }

  // Pre-compute baseline H2H & opponent game counts across all 32 teams (stride = 32)
  // For conference club i (0..15) and opponent opp (0..31):
  //   h2hPts[i * 32 + opp] stores 2 * wins + 1 * ties against `opp` (integer half-wins for exact arithmetic!)
  //   h2hGames[i * 32 + opp] stores games played against `opp`
  //   h2hBeatWins[i * 32 + opp] stores integer wins by `i` over `opp` (for Strength of Victory)
  const STRIDE = 32;
  const baseH2hPts = new Uint8Array(nTeams * STRIDE);
  const baseH2hGames = new Uint8Array(nTeams * STRIDE);
  const baseH2hBeatWins = new Uint8Array(nTeams * STRIDE);

  // Track other-conference wins/losses from completedGames if explicit standings weren't supplied
  const hasExplicitAfcStandings = Object.keys(resolvedOtherStandings || {}).length > 0;
  const {
    completedGames: cleanCompletedGames,
    remainingGames: cleanRemainingGames,
    aliasIdMap
  } = reconcileAndDedupePlayoffGames(completedGames, remainingGames);

  for (const cg of cleanCompletedGames) {
    const hAbbr = normalizeTeamAbbr(cg.home);
    const aAbbr = normalizeTeamAbbr(cg.away);
    const hi = abbrToIdx.get(hAbbr);
    const ai = abbrToIdx.get(aAbbr);
    if (hi === undefined || ai === undefined) continue;
    const hs = Number(cg.homeScore);
    const as = Number(cg.awayScore);
    if (Number.isNaN(hs) || Number.isNaN(as)) continue;

    if (!hasExplicitAfcStandings) {
      if (hi >= nTeams) {
        if (hs > as) baseW[hi]++;
        else if (hs < as) baseL[hi]++;
        else baseT[hi]++;
      }
      if (ai >= nTeams) {
        if (as > hs) baseW[ai]++;
        else if (as < hs) baseL[ai]++;
        else baseT[ai]++;
      }
    }

    if (hi < nTeams) {
      baseH2hGames[hi * STRIDE + ai] += 1;
      if (hs > as) {
        baseH2hPts[hi * STRIDE + ai] += 2;
        baseH2hBeatWins[hi * STRIDE + ai] += 1;
      } else if (hs === as) {
        baseH2hPts[hi * STRIDE + ai] += 1;
      }
    }
    if (ai < nTeams) {
      baseH2hGames[ai * STRIDE + hi] += 1;
      if (as > hs) {
        baseH2hPts[ai * STRIDE + hi] += 2;
        baseH2hBeatWins[ai * STRIDE + hi] += 1;
      } else if (as === hs) {
        baseH2hPts[ai * STRIDE + hi] += 1;
      }
    }
  }

  // Pre-compute Bayesian posterior standard deviation in Elo points for each team
  // (~42 Elo prior std shrinking with observed games `1 / sqrt(1 + gp / 7)`, capturing true-talent & injury uncertainty)
  const posteriorEloStd = new Float64Array(totalTeams);
  for (let i = 0; i < totalTeams; i++) {
    const gp = baseW[i] + baseL[i] + baseT[i];
    posteriorEloStd[i] = 42 / Math.sqrt(1 + gp / 7);
  }

  // Pre-compile all remaining NFL games (including AFC-vs-AFC so full-season SOV/SOS tiebreakers reflect 17 games)
  const sortedRemGames = [...cleanRemainingGames].sort((a, b) => Number(a.week || 0) - Number(b.week || 0));
  const compiledGames = [];
  for (const g of sortedRemGames) {
    const hAbbr = normalizeTeamAbbr(g.home);
    const aAbbr = normalizeTeamAbbr(g.away);
    const hi = abbrToIdx.get(hAbbr);
    const ai = abbrToIdx.get(aAbbr);
    if (hi === undefined || ai === undefined) continue;

    const bothNfc = hi < nTeams && ai < nTeams;
    const sameDiv = bothNfc && divIndexOf[hi] === divIndexOf[ai];
    const hfa = g.neutral ? 0 : HOME_FIELD_ELO_ADV;

    let forcedCode = 0; // 0 = simulate, 1 = HOME, 2 = AWAY, 3 = TIE
    let fw = forcedWinners[g.id];
    if (fw === undefined && g.id != null) {
      const aliases = aliasIdMap.get(String(g.id));
      if (aliases) {
        for (const aid of aliases) {
          if (forcedWinners[aid] !== undefined) {
            fw = forcedWinners[aid];
            break;
          }
        }
      }
    }
    if (fw === 'HOME' || fw === hAbbr) forcedCode = 1;
    else if (fw === 'AWAY' || fw === aAbbr) forcedCode = 2;
    else if (fw === 'TIE') forcedCode = 3;

    compiledGames.push({
      hi,
      ai,
      bothNfc,
      sameDiv,
      hfa,
      forcedCode
    });
  }

  // Reusable simulation scratch buffers (zero heap churn inside the 10k loop)
  const simElo = new Float64Array(totalTeams);
  const w = new Int16Array(totalTeams);
  const l = new Int16Array(totalTeams);
  const t = new Int16Array(totalTeams);
  const divW = new Int16Array(nTeams);
  const divL = new Int16Array(nTeams);
  const divT = new Int16Array(nTeams);
  const confW = new Int16Array(nTeams);
  const confL = new Int16Array(nTeams);
  const confT = new Int16Array(nTeams);
  const pd = new Float64Array(nTeams);
  const h2hPts = new Uint8Array(nTeams * STRIDE);
  const h2hGames = new Uint8Array(nTeams * STRIDE);
  const h2hBeatWins = new Uint8Array(nTeams * STRIDE);
  const oppWinPct = new Float64Array(totalTeams);

  // Accumulators
  const seedCounts = Array.from({ length: nTeams }, () => new Int32Array(8)); // 1..7 seeds, 0 = missed playoffs
  const divTitleCounts = new Int32Array(nTeams);
  const winSum = new Float64Array(nTeams);

  // Helper: filter club array to those achieving the maximum metric value
  function filterBestByMetric(clubs, metricFn) {
    let bestVal = -Infinity;
    const vals = new Array(clubs.length);
    for (let i = 0; i < clubs.length; i++) {
      const v = metricFn(clubs[i]);
      vals[i] = v;
      if (v > bestVal) bestVal = v;
    }
    const winners = [];
    for (let i = 0; i < clubs.length; i++) {
      if (vals[i] >= bestVal - EPS) winners.push(clubs[i]);
    }
    return winners;
  }

  function computeCommonGamesWinPct(clubs) {
    // Identify all opponents faced by EVERY club in `clubs`
    const commonOpps = [];
    for (let opp = 0; opp < totalTeams; opp++) {
      let allPlayed = true;
      for (let i = 0; i < clubs.length; i++) {
        if (clubs[i] === opp || h2hGames[clubs[i] * STRIDE + opp] === 0) {
          allPlayed = false;
          break;
        }
      }
      if (allPlayed) commonOpps.push(opp);
    }
    if (commonOpps.length === 0) return null;

    // NFL Rulebook requires minimum of 4 common games per club
    const pcts = new Map();
    for (let i = 0; i < clubs.length; i++) {
      const c = clubs[i];
      let pts = 0;
      let gms = 0;
      const baseOff = c * STRIDE;
      for (let k = 0; k < commonOpps.length; k++) {
        const opp = commonOpps[k];
        pts += h2hPts[baseOff + opp];
        gms += h2hGames[baseOff + opp];
      }
      if (gms < 4) return null;
      pcts.set(c, pts / (2 * gms));
    }
    return pcts;
  }

  function computeStrengthOfVictory(c) {
    const baseOff = c * STRIDE;
    let combinedWinUnits = 0;
    let combinedGames = 0;
    for (let opp = 0; opp < totalTeams; opp++) {
      const bw = h2hBeatWins[baseOff + opp];
      if (bw > 0) {
        const oppGms = w[opp] + l[opp] + t[opp];
        if (oppGms > 0) {
          combinedWinUnits += bw * (w[opp] + 0.5 * t[opp]);
          combinedGames += bw * oppGms;
        } else {
          combinedWinUnits += bw * oppWinPct[opp] * 17;
          combinedGames += bw * 17;
        }
      }
    }
    return combinedGames > 0 ? combinedWinUnits / combinedGames : 0;
  }

  function computeStrengthOfSchedule(c) {
    const baseOff = c * STRIDE;
    let combinedWinUnits = 0;
    let combinedGames = 0;
    for (let opp = 0; opp < totalTeams; opp++) {
      const gm = h2hGames[baseOff + opp];
      if (gm > 0) {
        const oppGms = w[opp] + l[opp] + t[opp];
        if (oppGms > 0) {
          combinedWinUnits += gm * (w[opp] + 0.5 * t[opp]);
          combinedGames += gm * oppGms;
        } else {
          combinedWinUnits += gm * oppWinPct[opp] * 17;
          combinedGames += gm * 17;
        }
      }
    }
    return combinedGames > 0 ? combinedWinUnits / combinedGames : 0.5;
  }

  /**
   * Resolves the #1 club out of `initialClubs` within the same division using official NFL
   * Division Tiebreaker rules (with mandatory restart at Step 1 whenever subset shrinks).
   */
  function breakDivisionTie(initialClubs) {
    let clubs = filterBestByMetric(initialClubs, c => calcWinPct(w[c], l[c], t[c]));
    if (clubs.length === 1) return clubs[0];

    while (clubs.length > 1) {
      const startLen = clubs.length;

      // Step 1: Head-to-head (best W-L-T pct in games among the tied division clubs)
      const h2hBest = filterBestByMetric(clubs, c => {
        let pts = 0;
        let gms = 0;
        const off = c * STRIDE;
        for (let i = 0; i < clubs.length; i++) {
          const other = clubs[i];
          if (other === c) continue;
          pts += h2hPts[off + other];
          gms += h2hGames[off + other];
        }
        return gms > 0 ? pts / (2 * gms) : 0.5;
      });
      if (h2hBest.length === 1) return h2hBest[0];
      if (h2hBest.length < startLen) {
        clubs = h2hBest;
        continue;
      }

      // Step 2: Division W-L-T pct
      const divBest = filterBestByMetric(clubs, c => calcWinPct(divW[c], divL[c], divT[c]));
      if (divBest.length === 1) return divBest[0];
      if (divBest.length < startLen) {
        clubs = divBest;
        continue;
      }

      // Step 3: Common games W-L-T pct (min 4)
      const commonMap = computeCommonGamesWinPct(clubs);
      if (commonMap) {
        const comBest = filterBestByMetric(clubs, c => commonMap.get(c));
        if (comBest.length === 1) return comBest[0];
        if (comBest.length < startLen) {
          clubs = comBest;
          continue;
        }
      }

      // Step 4: Conference W-L-T pct
      const confBest = filterBestByMetric(clubs, c => calcWinPct(confW[c], confL[c], confT[c]));
      if (confBest.length === 1) return confBest[0];
      if (confBest.length < startLen) {
        clubs = confBest;
        continue;
      }

      // Step 5: Strength of Victory (SOV)
      const sovBest = filterBestByMetric(clubs, computeStrengthOfVictory);
      if (sovBest.length === 1) return sovBest[0];
      if (sovBest.length < startLen) {
        clubs = sovBest;
        continue;
      }

      // Step 6: Strength of Schedule (SOS)
      const sosBest = filterBestByMetric(clubs, computeStrengthOfSchedule);
      if (sosBest.length === 1) return sosBest[0];
      if (sosBest.length < startLen) {
        clubs = sosBest;
        continue;
      }

      // Step 7: Net Point Differential, then deterministic index fallback
      const pdBest = filterBestByMetric(clubs, c => pd[c]);
      return pdBest[0];
    }
    return clubs[0];
  }

  function rankDivisionClubs(roster) {
    const remaining = [...roster];
    const ordered = [];
    while (remaining.length > 1) {
      const winner = breakDivisionTie(remaining);
      ordered.push(winner);
      remaining.splice(remaining.indexOf(winner), 1);
    }
    if (remaining.length === 1) ordered.push(remaining[0]);
    return ordered;
  }

  /**
   * Resolves the #1 club across different divisions (Wild Card & Conference #1-#4 Seeding)
   * using official NFL Wild Card Tiebreaker rules (including 3+ club H2H sweep rule & Step-1 restart).
   */
  function breakConferenceTie(initialClubs) {
    // First filter to highest overall Win%
    let clubs = filterBestByMetric(initialClubs, c => calcWinPct(w[c], l[c], t[c]));
    if (clubs.length === 1) return clubs[0];

    // If multiple clubs share a division, keep only the highest-ranked club from each division
    const seenDiv = new Set();
    const divFiltered = [];
    for (let i = 0; i < clubs.length; i++) {
      const d = divIndexOf[clubs[i]];
      if (!seenDiv.has(d)) {
        const sameDivInTie = clubs.filter(x => divIndexOf[x] === d);
        divFiltered.push(sameDivInTie.length > 1 ? breakDivisionTie(sameDivInTie) : sameDivInTie[0]);
        seenDiv.add(d);
      }
    }
    clubs = divFiltered;
    if (clubs.length === 1) return clubs[0];

    while (clubs.length > 1) {
      const startLen = clubs.length;

      // Step 1: Head-to-Head
      if (clubs.length === 2) {
        const a = clubs[0];
        const b = clubs[1];
        const gm = h2hGames[a * STRIDE + b];
        if (gm > 0) {
          const aPts = h2hPts[a * STRIDE + b];
          const bPts = h2hPts[b * STRIDE + a];
          if (aPts > bPts) return a;
          if (bPts > aPts) return b;
        }
      } else {
        // 3+ clubs: Official NFL Sweep Rule — applies ONLY if one club defeated ALL others,
        // or one club lost to ALL others (eliminating that club and restarting at Step 1).
        for (let i = 0; i < clubs.length; i++) {
          const c = clubs[i];
          let beatAll = true;
          for (let j = 0; j < clubs.length; j++) {
            if (i === j) continue;
            const other = clubs[j];
            const gm = h2hGames[c * STRIDE + other];
            if (gm === 0 || h2hBeatWins[c * STRIDE + other] < gm) {
              beatAll = false;
              break;
            }
          }
          if (beatAll) return c;
        }
        const nonSweptLosers = clubs.filter(c => {
          let lostToAll = true;
          for (let j = 0; j < clubs.length; j++) {
            const other = clubs[j];
            if (other === c) continue;
            const gm = h2hGames[other * STRIDE + c];
            if (gm === 0 || h2hBeatWins[other * STRIDE + c] < gm) {
              lostToAll = false;
              break;
            }
          }
          return !lostToAll;
        });
        if (nonSweptLosers.length > 0 && nonSweptLosers.length < startLen) {
          clubs = nonSweptLosers;
          continue;
        }
      }

      // Step 2: Conference W-L-T pct
      const confBest = filterBestByMetric(clubs, c => calcWinPct(confW[c], confL[c], confT[c]));
      if (confBest.length === 1) return confBest[0];
      if (confBest.length < startLen) {
        clubs = confBest;
        continue;
      }

      // Step 3: Common games W-L-T pct (minimum of 4)
      const commonMap = computeCommonGamesWinPct(clubs);
      if (commonMap) {
        const comBest = filterBestByMetric(clubs, c => commonMap.get(c));
        if (comBest.length === 1) return comBest[0];
        if (comBest.length < startLen) {
          clubs = comBest;
          continue;
        }
      }

      // Step 4: Strength of Victory (SOV)
      const sovBest = filterBestByMetric(clubs, computeStrengthOfVictory);
      if (sovBest.length === 1) return sovBest[0];
      if (sovBest.length < startLen) {
        clubs = sovBest;
        continue;
      }

      // Step 5: Strength of Schedule (SOS)
      const sosBest = filterBestByMetric(clubs, computeStrengthOfSchedule);
      if (sosBest.length === 1) return sosBest[0];
      if (sosBest.length < startLen) {
        clubs = sosBest;
        continue;
      }

      // Step 6: Net Point Differential
      const pdBest = filterBestByMetric(clubs, c => pd[c]);
      return pdBest[0];
    }
    return clubs[0];
  }

  const nGames = compiledGames.length;

  for (let iter = 0; iter < iterations; iter++) {
    // Draw team true-talent ratings from Bayesian posterior (Irwin-Hall 3-uniform normal approx: mean 0, var 1)
    for (let i = 0; i < totalTeams; i++) {
      const z = (rand() + rand() + rand() - 1.5) * 2.0;
      simElo[i] = elo[i] + posteriorEloStd[i] * z;
    }

    w.set(baseW);
    l.set(baseL);
    t.set(baseT);
    divW.set(baseDivW);
    divL.set(baseDivL);
    divT.set(baseDivT);
    confW.set(baseConfW);
    confL.set(baseConfL);
    confT.set(baseConfT);
    pd.set(basePD);
    h2hPts.set(baseH2hPts);
    h2hGames.set(baseH2hGames);
    h2hBeatWins.set(baseH2hBeatWins);

    for (let gIdx = 0; gIdx < nGames; gIdx++) {
      const g = compiledGames[gIdx];
      const hi = g.hi;
      const ai = g.ai;
      const eloDiff = simElo[hi] + g.hfa - simElo[ai];
      const pHomeRaw = 1 / (1 + Math.exp(-eloDiff * LN10_DIV_400));
      const expectedMargin = eloDiff / ELO_PER_SPREAD_POINT;

      // Draw PRNG variates unconditionally per game (Common Random Numbers) so forcing a game winner
      // never shifts or desynchronizes the random stream for subsequent games or iterations.
      const uOutcome = rand();
      const uMargin = rand();

      let outcome; // 1 = HOME, 2 = AWAY, 3 = TIE
      if (g.forcedCode !== 0) {
        outcome = g.forcedCode;
      } else {
        const pTie = 0.0036 * 4 * pHomeRaw * (1 - pHomeRaw);
        const pHomeWin = pHomeRaw * (1 - pTie);
        outcome = uOutcome < pHomeWin ? 1 : uOutcome < pHomeWin + pTie ? 3 : 2;
      }

      // Dynamic weekly Elo update (captures hot/cold streaks & injury shocks across remaining weeks)
      const actualHome = outcome === 1 ? 1.0 : outcome === 2 ? 0.0 : 0.5;
      const deltaElo = IN_SEASON_ELO_K * (actualHome - pHomeRaw);
      simElo[hi] += deltaElo;
      simElo[ai] -= deltaElo;

      if (outcome === 1) {
        w[hi]++;
        l[ai]++;
        const margin = sampleConditionalVictoryMargin(expectedMargin, uMargin);
        if (hi < nTeams) {
          pd[hi] += margin;
          h2hGames[hi * STRIDE + ai]++;
          h2hPts[hi * STRIDE + ai] += 2;
          h2hBeatWins[hi * STRIDE + ai]++;
          if (g.bothNfc) {
            confW[hi]++;
            if (g.sameDiv) divW[hi]++;
          }
        }
        if (ai < nTeams) {
          pd[ai] -= margin;
          h2hGames[ai * STRIDE + hi]++;
          if (g.bothNfc) {
            confL[ai]++;
            if (g.sameDiv) divL[ai]++;
          }
        }
      } else if (outcome === 2) {
        w[ai]++;
        l[hi]++;
        const margin = sampleConditionalVictoryMargin(-expectedMargin, uMargin);
        if (ai < nTeams) {
          pd[ai] += margin;
          h2hGames[ai * STRIDE + hi]++;
          h2hPts[ai * STRIDE + hi] += 2;
          h2hBeatWins[ai * STRIDE + hi]++;
          if (g.bothNfc) {
            confW[ai]++;
            if (g.sameDiv) divW[ai]++;
          }
        }
        if (hi < nTeams) {
          pd[hi] -= margin;
          h2hGames[hi * STRIDE + ai]++;
          if (g.bothNfc) {
            confL[hi]++;
            if (g.sameDiv) divL[hi]++;
          }
        }
      } else {
        t[hi]++;
        t[ai]++;
        if (hi < nTeams) {
          h2hGames[hi * STRIDE + ai]++;
          h2hPts[hi * STRIDE + ai] += 1;
          if (g.bothNfc) {
            confT[hi]++;
            if (g.sameDiv) divT[hi]++;
          }
        }
        if (ai < nTeams) {
          h2hGames[ai * STRIDE + hi]++;
          h2hPts[ai * STRIDE + hi] += 1;
          if (g.bothNfc) {
            confT[ai]++;
            if (g.sameDiv) divT[ai]++;
          }
        }
      }
    }

    for (let i = 0; i < totalTeams; i++) {
      oppWinPct[i] = calcWinPct(w[i], l[i], t[i]);
    }
    for (let i = 0; i < nTeams; i++) {
      winSum[i] += w[i] + 0.5 * t[i];
    }

    // 1. Rank each of the 4 NFC divisions internally
    const divOrderByDiv = divRosters.map(roster => rankDivisionClubs(roster));
    const divWinners = [];
    for (let d = 0; d < divOrderByDiv.length; d++) {
      const winner = divOrderByDiv[d][0];
      if (winner !== undefined) {
        divWinners.push(winner);
        divTitleCounts[winner]++;
      }
    }

    // 2. Seed Division Winners (#1 through #4) one slot at a time per NFL Conference Seeding rules
    const remDivWinners = [...divWinners];
    let seedNum = 1;
    while (remDivWinners.length > 0) {
      const best = remDivWinners.length === 1 ? remDivWinners[0] : breakConferenceTie(remDivWinners);
      seedCounts[best][seedNum++]++;
      remDivWinners.splice(remDivWinners.indexOf(best), 1);
    }

    // 3. Seed Wild Cards (#5 through #7): track the highest remaining non-champion from each division
    const divCursor = [1, 1, 1, 1];
    for (let wcSeed = 5; wcSeed <= 7; wcSeed++) {
      const candidates = [];
      for (let d = 0; d < 4; d++) {
        const clubIdx = divOrderByDiv[d][divCursor[d]];
        if (clubIdx !== undefined) candidates.push(clubIdx);
      }
      if (candidates.length === 0) break;
      const chosen = candidates.length === 1 ? candidates[0] : breakConferenceTie(candidates);
      seedCounts[chosen][wcSeed]++;
      divCursor[divIndexOf[chosen]]++;
    }

    // 4. Mark non-playoff clubs
    // (Implicitly tracked via iterations - playoffCount below)
  }

  const allTeamOdds = activeConfTeams.map((t, i) => {
    const playoffTotal =
      seedCounts[i][1] +
      seedCounts[i][2] +
      seedCounts[i][3] +
      seedCounts[i][4] +
      seedCounts[i][5] +
      seedCounts[i][6] +
      seedCounts[i][7];
    const missedTotal = iterations - playoffTotal;
    const pct = c => Math.round((c / iterations) * 1000) / 10;

    return {
      abbr: t.abbr,
      name: t.name,
      logoUrl: t.logoUrl || '',
      division: confDivMap[normalizeTeamAbbr(t.abbr)] || t.division || divNames[0],
      currentRecord: `${t.wins}-${t.losses}${t.ties ? `-${t.ties}` : ''}`,
      powerRating: Math.round(elo[i]),
      projectedWins: Math.round((winSum[i] / iterations) * 10) / 10,
      makePlayoffsPct: pct(playoffTotal),
      winDivisionPct: pct(divTitleCounts[i]),
      seed1ByePct: pct(seedCounts[i][1]),
      wildCardPct: pct(seedCounts[i][5] + seedCounts[i][6] + seedCounts[i][7]),
      seedDistribution: {
        1: pct(seedCounts[i][1]),
        2: pct(seedCounts[i][2]),
        3: pct(seedCounts[i][3]),
        4: pct(seedCounts[i][4]),
        5: pct(seedCounts[i][5]),
        6: pct(seedCounts[i][6]),
        7: pct(seedCounts[i][7])
      },
      missedPlayoffsPct: pct(missedTotal)
    };
  });

  allTeamOdds.sort(
    (a, b) =>
      b.makePlayoffsPct - a.makePlayoffsPct ||
      b.seed1ByePct - a.seed1ByePct ||
      b.projectedWins - a.projectedWins
  );

  const teamOdds = allTeamOdds.find(x => normalizeTeamAbbr(x.abbr) === targetAbbr) || allTeamOdds[0];

  return {
    iterations,
    conference: activeConf,
    targetTeam: targetAbbr,
    teamOdds,
    sfOdds: teamOdds,
    allTeamOdds
  };
}

/**
 * Computes Rooting Guide leverage for upcoming NFL games by measuring the marginal swing in
 * the target club's #1 Seed Bye %, Division %, and Playoff Berth % if HOME wins vs AWAY wins.
 * Works identically for AFC (`BUF`, `NE`, `KC`, ...) and NFC (`SF`, `DET`, `PHI`, ...).
 */
export function computeRootingGuideLeverage(baseConfig, targetOrMaxCount = 12) {
  const targetAbbr = normalizeTeamAbbr(baseConfig?.targetTeam || 'SF');
  const activeConf = baseConfig?.conference
    ? String(baseConfig.conference).toUpperCase() === 'AFC'
      ? 'AFC'
      : 'NFC'
    : getConferenceForTeam(targetAbbr);
  const otherConf = activeConf === 'AFC' ? 'NFC' : 'AFC';
  const targetDivision = ALL_NFL_DIVISIONS[targetAbbr] || (activeConf === 'AFC' ? 'AFC East' : 'NFC West');
  const confTeamList =
    Array.isArray(baseConfig?.conferenceTeams) && baseConfig.conferenceTeams.length > 0
      ? baseConfig.conferenceTeams
      : baseConfig?.nfcTeams || [];
  const confSet = new Set(confTeamList.map(t => normalizeTeamAbbr(t.abbr)));
  const reconciled = reconcileAndDedupePlayoffGames(baseConfig?.completedGames, baseConfig?.remainingGames);
  const cleanBaseConfig = {
    ...baseConfig,
    completedGames: reconciled.completedGames,
    remainingGames: reconciled.remainingGames
  };
  let candidateGames = [];
  let maxOut = 12;

  if (Array.isArray(targetOrMaxCount)) {
    const dedupedCandidates = reconcileAndDedupePlayoffGames(reconciled.completedGames, targetOrMaxCount);
    candidateGames = dedupedCandidates.remainingGames;
    maxOut = candidateGames.length || 12;
  } else {
    maxOut = Math.max(1, Number(targetOrMaxCount) || 12);
    const rem = reconciled.remainingGames;
    const confRelevantRem = rem.filter(g => {
      const h = normalizeTeamAbbr(g.home);
      const a = normalizeTeamAbbr(g.away);
      return confSet.has(h) || confSet.has(a);
    });
    const sortedWeeks = [...new Set(confRelevantRem.map(g => Number(g.week || 0)).filter(Boolean))].sort(
      (a, b) => a - b
    );
    const nextTwoWeeks = new Set(sortedWeeks.slice(0, 2));
    candidateGames = confRelevantRem.filter(g => nextTwoWeeks.has(Number(g.week)));
  }

  const teamEloMap = new Map();
  for (const t of confTeamList) {
    const ab = normalizeTeamAbbr(t.abbr);
    teamEloMap.set(
      ab,
      t.powerRating ||
        computeCalibratedTeamPowerRating({
          wins: t.wins || 0,
          losses: t.losses || 0,
          ties: t.ties || 0,
          pointDiff: t.pointDiff || 0,
          pointsFor: t.pointsFor ?? null,
          pointsAgainst: t.pointsAgainst ?? null,
          netEpaPerGame: t.netEpaPerGame ?? null
        })
    );
  }
  const otherMap =
    baseConfig?.otherConferencePowerRatings || baseConfig?.afcPowerRatings || baseConfig?.afcRatings || {};
  for (const [k, v] of Object.entries(otherMap)) {
    teamEloMap.set(normalizeTeamAbbr(k), Number(v) || 1500);
  }

  const results = [];
  for (const g of candidateGames) {
    const home = normalizeTeamAbbr(g.home);
    const away = normalizeTeamAbbr(g.away);
    const homeSim = runPlayoffMonteCarlo({
      ...cleanBaseConfig,
      targetTeam: targetAbbr,
      conference: activeConf,
      forcedWinners: { ...(cleanBaseConfig.forcedWinners || {}), [g.id]: 'HOME' },
      iterations: 2500,
      seed: 777
    });
    const awaySim = runPlayoffMonteCarlo({
      ...cleanBaseConfig,
      targetTeam: targetAbbr,
      conference: activeConf,
      forcedWinners: { ...(cleanBaseConfig.forcedWinners || {}), [g.id]: 'AWAY' },
      iterations: 2500,
      seed: 777
    });

    const homeTarget = homeSim.teamOdds || homeSim.sfOdds;
    const awayTarget = awaySim.teamOdds || awaySim.sfOdds;
    if (!homeTarget || !awayTarget) continue;

    const byeSwingHome = homeTarget.seed1ByePct - awayTarget.seed1ByePct;
    const divSwingHome = homeTarget.winDivisionPct - awayTarget.winDivisionPct;
    const playSwingHome = homeTarget.makePlayoffsPct - awayTarget.makePlayoffsPct;

    const isTargetTeamGame = home === targetAbbr || away === targetAbbr;
    const compositeHomeEdge = isTargetTeamGame
      ? home === targetAbbr
        ? 1
        : -1
      : byeSwingHome * 1.2 + divSwingHome * 1.0 + playSwingHome * 0.8;

    const rootSide = compositeHomeEdge >= 0 ? 'HOME' : 'AWAY';
    const rootFor = rootSide === 'HOME' ? home : away;
    const rootAgainst = rootSide === 'HOME' ? away : home;

    const byeSwing = Math.round(Math.abs(byeSwingHome) * 10) / 10;
    const divSwing = Math.round(Math.abs(divSwingHome) * 10) / 10;
    const playSwing = Math.round(Math.abs(playSwingHome) * 10) / 10;

    let primaryMetric = '#1 Seed Bye';
    let primaryDeltaPct = byeSwing;
    if (divSwing > primaryDeltaPct) {
      primaryMetric = targetDivision;
      primaryDeltaPct = divSwing;
    }
    if (playSwing > primaryDeltaPct) {
      primaryMetric = 'Playoff Berth';
      primaryDeltaPct = playSwing;
    }
    const maxSwingPct = Math.max(byeSwing, divSwing, playSwing);

    const homeElo = teamEloMap.get(home) || 1500;
    const awayElo = teamEloMap.get(away) || 1500;
    const pHome = winProbabilityHome(homeElo, awayElo, Boolean(g.neutral));
    const homeWinProbPct = Math.round(pHome * 1000) / 10;
    const uncertaintyFactor = 4 * pHome * (1 - pHome);
    const expectedImpactScore = Math.round(maxSwingPct * (0.55 + 0.45 * uncertaintyFactor) * 10) / 10;

    const rootAgainstIsSameDiv = ALL_NFL_DIVISIONS[rootAgainst] === targetDivision;
    const rootForIsOtherConf = !confSet.has(rootFor);
    let leverageTag = 'Conf. Seeding';
    let leverageReason = `Shapes ${activeConf} conference tiebreakers for ${primaryMetric}`;
    if (isTargetTeamGame) {
      leverageTag = 'Direct Control';
      leverageReason = `${targetAbbr} head-to-head result directly controls ${targetDivision} & #1 Seed Bye trajectory`;
    } else if (rootAgainstIsSameDiv) {
      leverageTag = `${targetDivision} Race`;
      leverageReason = `Hands division rival ${rootAgainst} a loss in the ${targetDivision} crown & tiebreaker race`;
    } else if (rootForIsOtherConf && confSet.has(rootAgainst)) {
      leverageTag = 'Inter-Conf Help';
      leverageReason = `${otherConf} club ${rootFor} hands ${activeConf} contender ${rootAgainst} a loss without adding an ${activeConf} rival win`;
    } else if (primaryMetric === '#1 Seed Bye') {
      leverageTag = '#1 Bye Race';
      leverageReason = `Drops ${activeConf} top-seed contender ${rootAgainst} in the #1 Seed Bye chase`;
    } else if (maxSwingPct <= 1.2) {
      leverageTag = 'SOV / Tiebreaker';
      leverageReason = `Strengthens ${targetAbbr} Strength of Victory (SOV) & common-games tiebreaker vs. ${rootAgainst}`;
    }

    results.push({
      gameId: g.id,
      week: g.week,
      matchupLabel: `${away} @ ${home}`,
      away,
      home,
      isTeamGame: isTargetTeamGame,
      is49ersGame: isTargetTeamGame,
      recommendedWinner: rootSide,
      rootForTeam: rootFor,
      rootAgainstTeam: rootAgainst,
      rootFor,
      rootSide,
      homeWinProbPct,
      expectedImpactScore,
      leverageTag,
      leverageReason,
      maxSwingPct,
      primaryMetric,
      primaryDeltaPct,
      seed1SwingPct: byeSwing,
      divSwingPct: divSwing,
      berthSwingPct: playSwing,
      byeLeveragePct: byeSwing,
      divisionLeveragePct: divSwing,
      totalLeverageScore: Math.round((byeSwing * 1.2 + divSwing + playSwing * 0.6) * 10) / 10
    });
  }

  const sorted = results.sort(
    (a, b) =>
      b.maxSwingPct - a.maxSwingPct ||
      b.expectedImpactScore - a.expectedImpactScore ||
      b.totalLeverageScore - a.totalLeverageScore
  );

  if (!Array.isArray(targetOrMaxCount) && maxOut >= 6) {
    const distinctWeeks = [...new Set(sorted.map(r => Number(r.week || 0)).filter(Boolean))].sort(
      (a, b) => a - b
    );
    if (distinctWeeks.length >= 2) {
      const wk1 = distinctWeeks[0];
      const wk2 = distinctWeeks[1];
      const wk2Reserve = Math.min(3, Math.floor(maxOut / 4));
      const wk1Picks = sorted.filter(r => Number(r.week) === wk1).slice(0, maxOut - wk2Reserve);
      const wk2Need = Math.max(wk2Reserve, maxOut - wk1Picks.length);
      const wk2Picks = sorted.filter(r => Number(r.week) === wk2).slice(0, wk2Need);
      if (wk1Picks.length > 0 && wk2Picks.length > 0) {
        return [...wk1Picks, ...wk2Picks];
      }
    }
  }

  return sorted.slice(0, maxOut);
}

const NFL_TEAM_META_BY_ABBR = {
  ARI: { name: 'Arizona Cardinals', espnAbbr: 'ari' },
  ATL: { name: 'Atlanta Falcons', espnAbbr: 'atl' },
  BAL: { name: 'Baltimore Ravens', espnAbbr: 'bal' },
  BUF: { name: 'Buffalo Bills', espnAbbr: 'buf' },
  CAR: { name: 'Carolina Panthers', espnAbbr: 'car' },
  CHI: { name: 'Chicago Bears', espnAbbr: 'chi' },
  CIN: { name: 'Cincinnati Bengals', espnAbbr: 'cin' },
  CLE: { name: 'Cleveland Browns', espnAbbr: 'cle' },
  DAL: { name: 'Dallas Cowboys', espnAbbr: 'dal' },
  DEN: { name: 'Denver Broncos', espnAbbr: 'den' },
  DET: { name: 'Detroit Lions', espnAbbr: 'det' },
  GB: { name: 'Green Bay Packers', espnAbbr: 'gb' },
  HOU: { name: 'Houston Texans', espnAbbr: 'hou' },
  IND: { name: 'Indianapolis Colts', espnAbbr: 'ind' },
  JAX: { name: 'Jacksonville Jaguars', espnAbbr: 'jax' },
  KC: { name: 'Kansas City Chiefs', espnAbbr: 'kc' },
  LAC: { name: 'Los Angeles Chargers', espnAbbr: 'lac' },
  LAR: { name: 'Los Angeles Rams', espnAbbr: 'lar' },
  LV: { name: 'Las Vegas Raiders', espnAbbr: 'lv' },
  MIA: { name: 'Miami Dolphins', espnAbbr: 'mia' },
  MIN: { name: 'Minnesota Vikings', espnAbbr: 'min' },
  NE: { name: 'New England Patriots', espnAbbr: 'ne' },
  NO: { name: 'New Orleans Saints', espnAbbr: 'no' },
  NYG: { name: 'New York Giants', espnAbbr: 'nyg' },
  NYJ: { name: 'New York Jets', espnAbbr: 'nyj' },
  PHI: { name: 'Philadelphia Eagles', espnAbbr: 'phi' },
  PIT: { name: 'Pittsburgh Steelers', espnAbbr: 'pit' },
  SEA: { name: 'Seattle Seahawks', espnAbbr: 'sea' },
  SF: { name: 'San Francisco 49ers', espnAbbr: 'sf' },
  TB: { name: 'Tampa Bay Buccaneers', espnAbbr: 'tb' },
  TEN: { name: 'Tennessee Titans', espnAbbr: 'ten' },
  WAS: { name: 'Washington Commanders', espnAbbr: 'wsh' }
};

function fmtWltRecord(w = 0, l = 0, t = 0) {
  const wn = Number(w) || 0;
  const ln = Number(l) || 0;
  const tn = Number(t) || 0;
  return tn > 0 ? `${wn}-${ln}-${tn}` : `${wn}-${ln}`;
}

function parseWltCounts(str) {
  if (!str || typeof str !== 'string') return null;
  const m = str.trim().match(/^(\d+)\s*-\s*(\d+)(?:\s*-\s*(\d+))?$/);
  if (!m) return null;
  return { w: Number(m[1]) || 0, l: Number(m[2]) || 0, t: Number(m[3]) || 0 };
}

function calcStandingsWinPct(w = 0, l = 0, t = 0) {
  const gp = (Number(w) || 0) + (Number(l) || 0) + (Number(t) || 0);
  if (gp <= 0) return 0;
  return ((Number(w) || 0) + 0.5 * (Number(t) || 0)) / gp;
}

/**
 * Derives exact HOME, AWAY, DIV, CONF, PF, PA, STRK, and H2H records from completed regular-season games.
 */
function deriveTeamSplitsFromCompletedGames(completedGames = []) {
  const sortedGames = [...(Array.isArray(completedGames) ? completedGames : [])]
    .filter(
      g =>
        g &&
        g.home &&
        g.away &&
        g.homeScore != null &&
        g.awayScore != null &&
        Number.isFinite(Number(g.homeScore)) &&
        Number.isFinite(Number(g.awayScore))
    )
    .sort((a, b) => Number(a.week || 0) - Number(b.week || 0));

  const map = new Map();
  const h2h = new Map(); // "A|B" -> { w, l, t }
  const defeatedBy = new Map(); // abbr -> Set/Array of beaten opponents (with multiplicity)
  const opponentsOf = new Map(); // abbr -> Array of all opponents played

  const ensure = abbr => {
    if (!map.has(abbr)) {
      map.set(abbr, {
        w: 0,
        l: 0,
        t: 0,
        homeW: 0,
        homeL: 0,
        homeT: 0,
        awayW: 0,
        awayL: 0,
        awayT: 0,
        divW: 0,
        divL: 0,
        divT: 0,
        confW: 0,
        confL: 0,
        confT: 0,
        pf: 0,
        pa: 0,
        lastOutcome: '',
        streakCount: 0
      });
    }
    return map.get(abbr);
  };

  const addH2h = (a, b, res) => {
    const key = `${a}|${b}`;
    if (!h2h.has(key)) h2h.set(key, { w: 0, l: 0, t: 0 });
    const rec = h2h.get(key);
    if (res === 'W') rec.w++;
    else if (res === 'L') rec.l++;
    else rec.t++;
  };

  const pushStreak = (st, outcome) => {
    if (st.lastOutcome === outcome) {
      st.streakCount += 1;
    } else {
      st.lastOutcome = outcome;
      st.streakCount = 1;
    }
  };

  for (const g of sortedGames) {
    const home = normalizeTeamAbbr(g.home);
    const away = normalizeTeamAbbr(g.away);
    if (!ALL_NFL_DIVISIONS[home] || !ALL_NFL_DIVISIONS[away]) continue;
    const hs = Number(g.homeScore);
    const as = Number(g.awayScore);
    const hSt = ensure(home);
    const aSt = ensure(away);

    const sameConf = getConferenceForTeam(home) === getConferenceForTeam(away);
    const sameDiv = ALL_NFL_DIVISIONS[home] === ALL_NFL_DIVISIONS[away];

    hSt.pf += hs;
    hSt.pa += as;
    aSt.pf += as;
    aSt.pa += hs;

    if (!opponentsOf.has(home)) opponentsOf.set(home, []);
    if (!opponentsOf.has(away)) opponentsOf.set(away, []);
    opponentsOf.get(home).push(away);
    opponentsOf.get(away).push(home);

    if (hs > as) {
      hSt.w++;
      hSt.homeW++;
      aSt.l++;
      aSt.awayL++;
      if (sameConf) {
        hSt.confW++;
        aSt.confL++;
      }
      if (sameDiv) {
        hSt.divW++;
        aSt.divL++;
      }
      pushStreak(hSt, 'W');
      pushStreak(aSt, 'L');
      addH2h(home, away, 'W');
      addH2h(away, home, 'L');
      if (!defeatedBy.has(home)) defeatedBy.set(home, []);
      defeatedBy.get(home).push(away);
    } else if (as > hs) {
      aSt.w++;
      aSt.awayW++;
      hSt.l++;
      hSt.homeL++;
      if (sameConf) {
        aSt.confW++;
        hSt.confL++;
      }
      if (sameDiv) {
        aSt.divW++;
        hSt.divL++;
      }
      pushStreak(aSt, 'W');
      pushStreak(hSt, 'L');
      addH2h(away, home, 'W');
      addH2h(home, away, 'L');
      if (!defeatedBy.has(away)) defeatedBy.set(away, []);
      defeatedBy.get(away).push(home);
    } else {
      hSt.t++;
      hSt.homeT++;
      aSt.t++;
      aSt.awayT++;
      if (sameConf) {
        hSt.confT++;
        aSt.confT++;
      }
      if (sameDiv) {
        hSt.divT++;
        aSt.divT++;
      }
      pushStreak(hSt, 'T');
      pushStreak(aSt, 'T');
      addH2h(home, away, 'T');
      addH2h(away, home, 'T');
    }
  }

  return { splitsByAbbr: map, h2h, defeatedBy, opponentsOf };
}

/**
 * Deterministically ranks a subset of tied clubs using NFL tiebreaker steps
 * (H2H -> Division Win% (division mode) -> Conference Win% -> SOV -> SOS -> Point Diff -> PF).
 */
function rankTiedStandingsGroup(group, { isDivision = false, byAbbr, h2h, defeatedBy, opponentsOf }) {
  if (group.length <= 1) return [...group];

  const computeSov = abbr => {
    const beaten = defeatedBy.get(abbr) || [];
    if (!beaten.length) return 0;
    let sum = 0;
    for (const opp of beaten) {
      const o = byAbbr.get(opp);
      if (o) sum += o.winPct;
    }
    return sum / beaten.length;
  };
  const computeSos = abbr => {
    const opps = opponentsOf.get(abbr) || [];
    if (!opps.length) return 0;
    let sum = 0;
    for (const opp of opps) {
      const o = byAbbr.get(opp);
      if (o) sum += o.winPct;
    }
    return sum / opps.length;
  };

  const pickBestFromTied = tied => {
    let pool = [...tied];
    const narrowByMax = scoreFn => {
      let best = -Infinity;
      const scored = pool.map(t => {
        const v = scoreFn(t);
        if (v > best) best = v;
        return { t, v };
      });
      const next = scored.filter(x => Math.abs(x.v - best) <= 1e-9).map(x => x.t);
      if (next.length > 0 && next.length < pool.length) {
        pool = next;
        return true;
      }
      return false;
    };

    // 1. Head-to-Head
    if (pool.length === 2) {
      const r = h2h.get(`${pool[0].abbr}|${pool[1].abbr}`);
      if (r && r.w + r.l + r.t > 0) {
        const p0 = calcStandingsWinPct(r.w, r.l, r.t);
        const p1 = calcStandingsWinPct(r.l, r.w, r.t);
        if (Math.abs(p0 - p1) > 1e-9) {
          return p0 > p1 ? pool[0] : pool[1];
        }
      }
    } else if (pool.length >= 3) {
      if (isDivision) {
        const h2hScores = new Map();
        let anyPlayed = false;
        for (const a of pool) {
          let w = 0,
            l = 0,
            t = 0;
          for (const b of pool) {
            if (a.abbr === b.abbr) continue;
            const r = h2h.get(`${a.abbr}|${b.abbr}`);
            if (r) {
              w += r.w;
              l += r.l;
              t += r.t;
              if (r.w + r.l + r.t > 0) anyPlayed = true;
            }
          }
          h2hScores.set(a.abbr, w + l + t > 0 ? calcStandingsWinPct(w, l, t) : -1);
        }
        if (anyPlayed && ![...h2hScores.values()].includes(-1)) {
          if (narrowByMax(t => h2hScores.get(t.abbr))) {
            if (pool.length === 1) return pool[0];
          }
        }
      } else {
        // 3+ club conference/wild-card sweep check: only applies if 1 club beat ALL others
        const sweeper = pool.find(a =>
          pool.every(b => {
            if (a.abbr === b.abbr) return true;
            const r = h2h.get(`${a.abbr}|${b.abbr}`);
            return r && r.w > r.l;
          })
        );
        if (sweeper) return sweeper;
      }
    }

    // 2. Division Win % (for intra-division ties)
    if (isDivision) {
      if (narrowByMax(t => t.divWinPct) && pool.length === 1) return pool[0];
    }

    // 3. Conference Win %
    if (narrowByMax(t => t.confWinPct) && pool.length === 1) return pool[0];

    // 4. Strength of Victory
    if (narrowByMax(t => computeSov(t.abbr)) && pool.length === 1) return pool[0];

    // 5. Strength of Schedule
    if (narrowByMax(t => computeSos(t.abbr)) && pool.length === 1) return pool[0];

    // 6. Point Differential -> Points For -> Alphabetical
    if (narrowByMax(t => t.pointDiff) && pool.length === 1) return pool[0];
    if (narrowByMax(t => t.pointsFor) && pool.length === 1) return pool[0];
    return pool.sort((a, b) => a.abbr.localeCompare(b.abbr))[0];
  };

  const ordered = [];
  const rem = [...group];
  while (rem.length > 0) {
    // Group by highest Win %
    let topPct = -Infinity;
    for (const t of rem) {
      if (t.winPct > topPct) topPct = t.winPct;
    }
    const tiedTop = rem.filter(t => Math.abs(t.winPct - topPct) <= 1e-9);
    const chosen = tiedTop.length === 1 ? tiedTop[0] : pickBestFromTied(tiedTop);
    ordered.push(chosen);
    rem.splice(rem.indexOf(chosen), 1);
  }
  return ordered;
}

/**
 * Builds a simulator input configuration for the opposite conference (e.g. AFC when viewing SF,
 * or NFC when viewing BUF) so both conferences can compute live Monte Carlo playoff odds.
 */
export function buildOtherConferenceSimulatorConfig(simulatorInputs, targetConference = 'AFC') {
  if (!simulatorInputs || typeof simulatorInputs !== 'object') return null;
  const wantConf = String(targetConference || 'AFC').toUpperCase() === 'AFC' ? 'AFC' : 'NFC';
  const primaryConf =
    String(simulatorInputs.conference || '').toUpperCase() === 'AFC' ? 'AFC' : 'NFC';

  if (wantConf === primaryConf) {
    const confTeams =
      Array.isArray(simulatorInputs.conferenceTeams) && simulatorInputs.conferenceTeams.length > 0
        ? simulatorInputs.conferenceTeams
        : simulatorInputs.nfcTeams || [];
    if (!confTeams.length) return null;
    return {
      ...simulatorInputs,
      conference: primaryConf,
      targetTeam: simulatorInputs.targetTeam || confTeams[0].abbr,
      conferenceTeams: confTeams,
      nfcTeams: confTeams
    };
  }

  const primaryTeams =
    Array.isArray(simulatorInputs.conferenceTeams) && simulatorInputs.conferenceTeams.length > 0
      ? simulatorInputs.conferenceTeams
      : simulatorInputs.nfcTeams || [];
  const otherStandingsMap =
    simulatorInputs.otherConferenceStandings && Object.keys(simulatorInputs.otherConferenceStandings).length > 0
      ? simulatorInputs.otherConferenceStandings
      : simulatorInputs.afcStandings || {};
  const otherRatingsMap =
    simulatorInputs.otherConferencePowerRatings ||
    simulatorInputs.afcPowerRatings ||
    simulatorInputs.afcRatings ||
    {};

  const reconciled = reconcileAndDedupePlayoffGames(
    simulatorInputs.completedGames,
    simulatorInputs.remainingGames
  );
  const derived = deriveTeamSplitsFromCompletedGames(reconciled.completedGames);

  const wantDivMap = wantConf === 'AFC' ? AFC_DIVISIONS : NFC_DIVISIONS;
  const flippedConfTeams = Object.keys(wantDivMap).map(abbr => {
    const st = otherStandingsMap[abbr] || {};
    const d = derived.splitsByAbbr.get(abbr);
    const wins = Number(st.wins ?? d?.w ?? 0);
    const losses = Number(st.losses ?? d?.l ?? 0);
    const ties = Number(st.ties ?? d?.t ?? 0);
    const pointDiff = Number(st.pointDiff ?? (d ? d.pf - d.pa : 0));
    const parsedDiv = parseWltCounts(st.divRec);
    const parsedConf = parseWltCounts(st.confRec);
    const meta = NFL_TEAM_META_BY_ABBR[abbr] || { name: abbr, espnAbbr: abbr.toLowerCase() };
    const rating =
      Number(otherRatingsMap[abbr]) ||
      computeCalibratedTeamPowerRating({
        wins,
        losses,
        ties,
        pointDiff,
        pointsFor: st.pointsFor ?? d?.pf ?? null,
        pointsAgainst: st.pointsAgainst ?? d?.pa ?? null
      });
    return {
      abbr,
      name: st.name || meta.name,
      logoUrl: st.logoUrl || `https://a.espncdn.com/i/teamlogos/nfl/500/${meta.espnAbbr}.png`,
      division: wantDivMap[abbr],
      wins,
      losses,
      ties,
      divWins: parsedDiv?.w ?? d?.divW ?? 0,
      divLosses: parsedDiv?.l ?? d?.divL ?? 0,
      divTies: parsedDiv?.t ?? d?.divT ?? 0,
      confWins: parsedConf?.w ?? d?.confW ?? 0,
      confLosses: parsedConf?.l ?? d?.confL ?? 0,
      confTies: parsedConf?.t ?? d?.confT ?? 0,
      pointDiff,
      pointsFor: st.pointsFor ?? d?.pf ?? 0,
      pointsAgainst: st.pointsAgainst ?? d?.pa ?? 0,
      powerRating: Math.round(rating)
    };
  });

  const flippedOtherStandings = {};
  const flippedOtherRatings = {};
  for (const pt of primaryTeams) {
    const abbr = normalizeTeamAbbr(pt.abbr);
    flippedOtherStandings[abbr] = {
      wins: Number(pt.wins || 0),
      losses: Number(pt.losses || 0),
      ties: Number(pt.ties || 0),
      pointDiff: Number(pt.pointDiff || 0)
    };
    flippedOtherRatings[abbr] =
      Number(pt.powerRating) ||
      computeCalibratedTeamPowerRating({
        wins: pt.wins || 0,
        losses: pt.losses || 0,
        ties: pt.ties || 0,
        pointDiff: pt.pointDiff || 0
      });
  }

  return {
    targetTeam: flippedConfTeams[0]?.abbr || (wantConf === 'AFC' ? 'BUF' : 'SF'),
    conference: wantConf,
    conferenceTeams: flippedConfTeams,
    nfcTeams: flippedConfTeams,
    otherConferencePowerRatings: flippedOtherRatings,
    afcPowerRatings: flippedOtherRatings,
    afcRatings: flippedOtherRatings,
    otherConferenceStandings: flippedOtherStandings,
    afcStandings: flippedOtherStandings,
    completedGames: reconciled.completedGames,
    remainingGames: reconciled.remainingGames
  };
}

/**
 * Builds a complete, deterministic 32-team NFL Standings & Playoff Picture snapshot
 * (Playoff Picture #1-#16, 8 Divisions, NFC/AFC Conference, and 32-Team League)
 * combining authoritative ESPN standings splits, completed-game derivations, official NFL
 * tiebreaker seeding, and live Monte Carlo odds + simulation deltas.
 */
export function buildLeagueStandingsSnapshot(
  simulatorInputs = {},
  {
    primarySimResult = null,
    otherConfSimResult = null,
    baselinePrimarySimResult = null,
    baselineOtherConfSimResult = null
  } = {}
) {
  const reconciled = reconcileAndDedupePlayoffGames(
    simulatorInputs?.completedGames,
    simulatorInputs?.remainingGames
  );
  const derived = deriveTeamSplitsFromCompletedGames(reconciled.completedGames);

  const primaryTeams =
    Array.isArray(simulatorInputs?.conferenceTeams) && simulatorInputs.conferenceTeams.length > 0
      ? simulatorInputs.conferenceTeams
      : simulatorInputs?.nfcTeams || [];
  const primaryByAbbr = new Map(primaryTeams.map(t => [normalizeTeamAbbr(t.abbr), t]));
  const otherStandings =
    simulatorInputs?.otherConferenceStandings && Object.keys(simulatorInputs.otherConferenceStandings).length > 0
      ? simulatorInputs.otherConferenceStandings
      : simulatorInputs?.afcStandings || {};

  const oddsByAbbr = new Map();
  const baseOddsByAbbr = new Map();
  for (const sim of [primarySimResult, otherConfSimResult]) {
    for (const o of sim?.allTeamOdds || []) {
      oddsByAbbr.set(normalizeTeamAbbr(o.abbr), o);
    }
  }
  for (const bsim of [baselinePrimarySimResult, baselineOtherConfSimResult]) {
    for (const o of bsim?.allTeamOdds || []) {
      baseOddsByAbbr.set(normalizeTeamAbbr(o.abbr), o);
    }
  }

  const byAbbr = new Map();
  for (const abbr of Object.keys(ALL_NFL_DIVISIONS)) {
    const p = primaryByAbbr.get(abbr) || null;
    const o = otherStandings[abbr] || null;
    const src = p || o || {};
    const d = derived.splitsByAbbr.get(abbr) || null;
    const meta = NFL_TEAM_META_BY_ABBR[abbr] || { name: abbr, espnAbbr: abbr.toLowerCase() };
    const conf = getConferenceForTeam(abbr);
    const division = ALL_NFL_DIVISIONS[abbr];
    const divShort = division.replace(/^(?:NFC|AFC)\s+/i, '');

    const wins = Number(src.wins ?? d?.w ?? 0);
    const losses = Number(src.losses ?? d?.l ?? 0);
    const ties = Number(src.ties ?? d?.t ?? 0);
    const gp = wins + losses + ties;
    const derivedGp = d ? d.w + d.l + d.t : 0;
    const winPct = calcStandingsWinPct(wins, losses, ties);

    const parsedDiv = parseWltCounts(src.divRec);
    const divW = parsedDiv?.w ?? src.divWins ?? d?.divW ?? 0;
    const divL = parsedDiv?.l ?? src.divLosses ?? d?.divL ?? 0;
    const divT = parsedDiv?.t ?? src.divTies ?? d?.divT ?? 0;
    const divRec = src.divRec && src.divRec !== '0-0' ? src.divRec : fmtWltRecord(divW, divL, divT);

    const parsedConf = parseWltCounts(src.confRec);
    const confW = parsedConf?.w ?? src.confWins ?? d?.confW ?? 0;
    const confL = parsedConf?.l ?? src.confLosses ?? d?.confL ?? 0;
    const confT = parsedConf?.t ?? src.confTies ?? d?.confT ?? 0;
    const confRec = src.confRec && src.confRec !== '0-0' ? src.confRec : fmtWltRecord(confW, confL, confT);

    const homeRec = src.homeRec || (d ? fmtWltRecord(d.homeW, d.homeL, d.homeT) : '0-0');
    const awayRec = src.awayRec || (d ? fmtWltRecord(d.awayW, d.awayL, d.awayT) : '0-0');

    const pf = Number(
      src.pointsFor != null && (src.pointsFor > 0 || gp === 0)
        ? src.pointsFor
        : d
          ? d.pf
          : src.pointsFor || 0
    );
    const pa = Number(
      src.pointsAgainst != null && (src.pointsAgainst > 0 || gp === 0)
        ? src.pointsAgainst
        : d
          ? d.pa
          : src.pointsAgainst || 0
    );
    const pointDiff = Number(src.pointDiff ?? (d ? d.pf - d.pa : pf - pa));
    const streak =
      src.streak ||
      (d && d.lastOutcome && d.streakCount > 0 ? `${d.lastOutcome}${d.streakCount}` : gp > 0 && derivedGp === 0 ? '—' : '—');

    const simO = oddsByAbbr.get(abbr) || null;
    const baseO = baseOddsByAbbr.get(abbr) || null;
    const makePlayoffsPct = simO ? Number(simO.makePlayoffsPct ?? 0) : null;
    const winDivisionPct = simO ? Number(simO.winDivisionPct ?? 0) : null;
    const seed1ByePct = simO ? Number(simO.seed1ByePct ?? 0) : null;
    const projectedWins = simO ? Number(simO.projectedWins ?? 0) : null;

    const makePlayoffsDelta =
      simO && baseO ? Math.round((makePlayoffsPct - Number(baseO.makePlayoffsPct ?? 0)) * 10) / 10 : 0;
    const winDivisionDelta =
      simO && baseO ? Math.round((winDivisionPct - Number(baseO.winDivisionPct ?? 0)) * 10) / 10 : 0;
    const seed1ByeDelta =
      simO && baseO ? Math.round((seed1ByePct - Number(baseO.seed1ByePct ?? 0)) * 10) / 10 : 0;

    byAbbr.set(abbr, {
      abbr,
      name: src.name || meta.name,
      logoUrl: src.logoUrl || simO?.logoUrl || `https://a.espncdn.com/i/teamlogos/nfl/500/${meta.espnAbbr}.png`,
      conference: conf,
      division,
      divShort,
      wins,
      losses,
      ties,
      gp,
      record: fmtWltRecord(wins, losses, ties),
      winPct,
      winPctDisplay: winPct >= 1 ? '1.000' : winPct.toFixed(3).replace(/^0/, ''),
      divRec,
      confRec,
      divWinPct: calcStandingsWinPct(divW, divL, divT),
      confWinPct: calcStandingsWinPct(confW, confL, confT),
      homeRec,
      awayRec,
      pointsFor: pf,
      pointsAgainst: pa,
      pointDiff,
      streak,
      clincher: src.clincher || '',
      projectedWins,
      makePlayoffsPct,
      winDivisionPct,
      seed1ByePct,
      makePlayoffsDelta,
      winDivisionDelta,
      seed1ByeDelta
    });
  }

  const ctx = {
    byAbbr,
    h2h: derived.h2h,
    defeatedBy: derived.defeatedBy,
    opponentsOf: derived.opponentsOf
  };

  const divisions = {};
  for (const divName of [...NFC_DIVISION_NAMES, ...AFC_DIVISION_NAMES]) {
    const members = [...byAbbr.values()].filter(t => t.division === divName);
    const ranked = rankTiedStandingsGroup(members, { ...ctx, isDivision: true }).map((t, idx) => ({
      ...t,
      divRank: idx + 1
    }));
    divisions[divName] = ranked;
  }

  const seedConference = confName => {
    const divNames = confName === 'AFC' ? AFC_DIVISION_NAMES : NFC_DIVISION_NAMES;
    const divOrders = divNames.map(dn => divisions[dn] || []);
    const divWinners = divOrders.map(arr => arr[0]).filter(Boolean);
    const seededWinners = rankTiedStandingsGroup(divWinners, { ...ctx, isDivision: false });

    // Seed remaining 12 teams one slot at a time per official NFL procedure (highest remaining club per division competes)
    const divCursor = [1, 1, 1, 1];
    const seededNonWinners = [];
    while (seededNonWinners.length < 12) {
      const candidates = [];
      for (let d = 0; d < divOrders.length; d++) {
        const club = divOrders[d][divCursor[d]];
        if (club) candidates.push({ club, divIdx: d });
      }
      if (!candidates.length) break;
      const chosenClub =
        candidates.length === 1
          ? candidates[0].club
          : rankTiedStandingsGroup(
              candidates.map(c => c.club),
              { ...ctx, isDivision: false }
            )[0];
      const chosenEntry = candidates.find(c => c.club.abbr === chosenClub.abbr);
      seededNonWinners.push(chosenClub);
      if (chosenEntry) divCursor[chosenEntry.divIdx]++;
    }

    const combined = [...seededWinners, ...seededNonWinners];
    const seed1 = combined[0];
    const seed7 = combined[6];
    const fmtGb = (team, ref) => {
      if (!team || !ref || team.abbr === ref.abbr) return '—';
      const gb = (ref.wins - team.wins + (team.losses - ref.losses)) / 2;
      if (gb <= 0) return '—';
      return Number.isInteger(gb) ? String(gb) : gb.toFixed(1);
    };

    return combined.map((t, idx) => ({
      ...t,
      seed: idx + 1,
      isDivLeader: idx < 4,
      gamesBackFrom1: idx === 0 ? 'BYE' : fmtGb(t, seed1),
      gamesBackFrom7: fmtGb(t, seed7)
    }));
  };

  const nfcSeeded = seedConference('NFC');
  const afcSeeded = seedConference('AFC');

  const seedLookup = new Map([...nfcSeeded, ...afcSeeded].map(t => [t.abbr, t.seed]));
  const leagueRanked = [...byAbbr.values()]
    .sort(
      (a, b) =>
        b.winPct - a.winPct ||
        b.wins - a.wins ||
        b.pointDiff - a.pointDiff ||
        b.pointsFor - a.pointsFor ||
        a.abbr.localeCompare(b.abbr)
    )
    .map((t, idx) => ({
      ...t,
      leagueRank: idx + 1,
      seed: seedLookup.get(t.abbr) || null
    }));

  const buildMatchups = seeded =>
    seeded.length >= 7
      ? [
          { label: '#1 BYE', high: seeded[0], low: null },
          { label: '#2 vs #7', high: seeded[1], low: seeded[6] },
          { label: '#3 vs #6', high: seeded[2], low: seeded[5] },
          { label: '#4 vs #5', high: seeded[3], low: seeded[4] }
        ]
      : [];

  return {
    byAbbr,
    nfcSeeded,
    afcSeeded,
    divisions,
    leagueRanked,
    wildCardMatchups: {
      NFC: buildMatchups(nfcSeeded),
      AFC: buildMatchups(afcSeeded)
    }
  };
}

/**
 * Computes the top rival teams impacted by simulated Rooting Guide winner overrides
 * by comparing active Monte Carlo odds against baseline Monte Carlo odds.
 */
export function computeSimulationRivalImpacts({
  baselineSim = null,
  activeSim = null,
  otherBaselineSim = null,
  otherActiveSim = null,
  targetAbbr = 'SF',
  maxCount = 3
} = {}) {
  const normTarget = normalizeTeamAbbr(targetAbbr);
  const baseMap = new Map();
  for (const sim of [baselineSim, otherBaselineSim]) {
    for (const o of sim?.allTeamOdds || []) {
      baseMap.set(normalizeTeamAbbr(o.abbr), o);
    }
  }
  const impacts = [];
  const seen = new Set();
  for (const sim of [activeSim, otherActiveSim]) {
    for (const o of sim?.allTeamOdds || []) {
      const abbr = normalizeTeamAbbr(o.abbr);
      if (abbr === normTarget || seen.has(abbr)) continue;
      seen.add(abbr);
      const b = baseMap.get(abbr);
      if (!b) continue;
      const dPo = Math.round((Number(o.makePlayoffsPct || 0) - Number(b.makePlayoffsPct || 0)) * 10) / 10;
      const dDiv = Math.round((Number(o.winDivisionPct || 0) - Number(b.winDivisionPct || 0)) * 10) / 10;
      const dBye = Math.round((Number(o.seed1ByePct || 0) - Number(b.seed1ByePct || 0)) * 10) / 10;

      // Pick the single most meaningful swing for this rival
      let metricLabel = 'PO';
      let deltaPct = dPo;
      if (Math.abs(dBye) > Math.abs(deltaPct) + 0.5) {
        metricLabel = 'Bye';
        deltaPct = dBye;
      }
      if (Math.abs(dDiv) > Math.abs(deltaPct) + 1.0) {
        metricLabel = 'Div';
        deltaPct = dDiv;
      }
      if (Math.abs(deltaPct) >= 0.5) {
        impacts.push({
          abbr,
          metricLabel,
          deltaPct,
          magnitude: Math.abs(deltaPct),
          logoUrl: o.logoUrl || ''
        });
      }
    }
  }
  return impacts.sort((a, b) => b.magnitude - a.magnitude || a.abbr.localeCompare(b.abbr)).slice(0, maxCount);
}
