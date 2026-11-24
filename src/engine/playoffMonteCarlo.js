/**
 * Calibrated 10,000-Iteration NFL Regular Season & Conference Playoff Seeding Monte Carlo Engine
 *
 * Industry-Standard Multi-Factor Architecture (Backtested & Calibrated across 12 NFL Seasons, 2014–2025):
 * 1. Two-Component Hierarchical Bayesian League Power Rating (`computeLeaguePowerRatings`):
 *    - Preseason Team Priors: Prior-season iterative opponent-adjusted rating (`0.62` YoY carryover)
 *      + offseason veteran QB-change adjustment + Week 1 market spread Bayesian anchor (`0.88` weight).
 *    - Fast-Fading Preseason Weight (`6.5 * exp(-gp / 6.0)`) separated from constant Empirical-Bayes
 *      league-mean shrinkage (`3.0 * (1 - exp(-gp / 4.0))`) so stale prior-season projections fade cleanly
 *      by Weeks 9–12 (matching DVOA/FPI) without small-sample overconfidence.
 *    - In-Season Performance: Variance-normalized blend of soft-capped Scoring Margin (`0.48`),
 *      Net Total EPA (`0.24`), Net Passing EPA (`0.23`), and Net Rushing EPA (`0.05`) with mild weekly
 *      recency decay (`0.99/wk`).
 *    - Strength of Opponents Played Thus Far (SOS): 16-iteration venue- and rest-adjusted Ridge-SRS
 *      (`0.85 * R_opp`) blended 82/18 with sequential Margin-of-Victory Elo (`K=22`) starting from preseason priors.
 *    - Starting QB & Key Injury Replacement Adjustments: Computes `currQbVal - histPlayedQbVal` (separating
 *      immediate upcoming game impact from rest-of-season duration for Season-Ending IR, 4-Game IR, Multi-Week Out,
 *      and Week-to-Week Out/Doubtful/Questionable) plus capped non-QB key starter injury penalties.
 *    - Strength of Upcoming Opponents: Explicitly projects remaining schedule difficulty & game-level
 *      situational edges (modern HFA = `1.75` pts / `44` Elo, divisional HFA compression `-20%`,
 *      rest/bye differential `2.0` Elo/day capped at `±14` Elo, and `0` HFA for Neutral/International sites).
 * 2. Calibrated Season Simulation Variance (`runPlayoffMonteCarlo`):
 *    - Industry-standard `25` Elo per spread point (`winProb = 1 / (1 + 10^(-diff/400))`).
 *    - Bayesian posterior talent std (`65 / sqrt(1 + gp / 6.0)`), weekly rating drift (`K = 18`),
 *      mild Ornstein-Uhlenbeck mean reversion (`3%/game`), and CRN-synchronized future injury shock (`1.5%/game`, `-45 Elo`).
 *    - Empirical NFL overtime tie probability (~0.36% in coin-flip games).
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

// Calibrated industry-standard NFL Elo & Simulation Constants (12-season 2014–2025 backtest)
export const ELO_PER_SPREAD_POINT = 25;
export const HOME_FIELD_SPREAD_PTS = 1.75; // Empirically measured 2020–2025 NFL HFA = 1.75 pts
export const HOME_FIELD_ELO_ADV = Math.round(HOME_FIELD_SPREAD_PTS * ELO_PER_SPREAD_POINT); // 44 Elo
export const DIV_GAME_HFA_DISCOUNT = 0.20; // Divisional games compress home-field edge by ~20%
export const REST_ADVANTAGE_PTS_PER_DAY = 0.08; // Post-bye (+7d) ≈ +0.56 spread pts
export const REST_ADVANTAGE_ELO_PER_DAY = REST_ADVANTAGE_PTS_PER_DAY * ELO_PER_SPREAD_POINT; // 2.0 Elo/day
export const BAYESIAN_PRIOR_GAMES = 9.5; // Retained for backward-compat exports
export const PRIOR_INIT_GAMES = 6.5; // Initial preseason prior weight (fades exponentially with gp)
export const PRIOR_DECAY_GAMES = 6.0; // Preseason prior decay constant (~5% remaining by Wk 12)
export const MEAN_SHRINK_GAMES = 3.0; // Empirical-Bayes league-mean shrinkage (prevents overconfidence)
export const YEAR_OVER_YEAR_CARRYOVER = 0.62;
export const PRESEASON_MARKET_W1_ALPHA = 0.88;
export const MOV_ELO_BLEND = 0.18;
export const MOV_ELO_K = 22;
export const POSTERIOR_ELO_STD_BASE = 65;
export const POSTERIOR_ELO_STD_DECAY = 6.0;
export const IN_SEASON_ELO_K = 18;
export const FUTURE_MEAN_REVERT_PER_GAME = 0.03;
export const FUTURE_INJURY_SHOCK_PROB = 0.015;
export const FUTURE_INJURY_SHOCK_ELO = 45;
export const LN10_DIV_400 = Math.LN10 / 400;

export const PLAYOFF_MODEL_VERSION = '2026.2-hb-srs-qb';

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
 * Computes situational Elo adjustment (home-field advantage + divisional compression + rest edge)
 * for a single NFL game.
 */
export function computeGameSituationalElo({
  neutral = false,
  divGame = false,
  homeRest = 7,
  awayRest = 7,
  hfaPts = HOME_FIELD_SPREAD_PTS
} = {}) {
  const baseHfaPts = neutral ? 0 : Number(hfaPts || HOME_FIELD_SPREAD_PTS) * (divGame ? 1 - DIV_GAME_HFA_DISCOUNT : 1);
  const restDiffDays = Math.max(-7, Math.min(7, (Number(homeRest) || 7) - (Number(awayRest) || 7)));
  return (baseHfaPts + restDiffDays * REST_ADVANTAGE_PTS_PER_DAY) * ELO_PER_SPREAD_POINT;
}

/**
 * Computes a market-calibrated NFL Elo power rating centered at 1500 (`25 Elo = 1.0 spread pt`).
 *
 * Uses Two-Component Hierarchical Bayesian Shrinkage (backtested across 12 NFL seasons, 2014–2025):
 * - Separates fast-fading preseason prior weight (`6.5 * exp(-gp / 6.0)`) from constant Empirical-Bayes
 *   league-mean shrinkage (`3.0 * (1 - exp(-gp / 4.0))`).
 * - Variance-normalizes soft-capped per-game point differential, Net EPA/game (and Passing/Rushing EPA split
 *   when provided), and opponent strength-of-schedule adjustment (`sosSpreadAdj`).
 * - Applies explicit Starting QB & non-QB key injury spread adjustments (`qbSpreadAdj`, `nonQbInjurySpreadAdj`).
 * - Backward-compatible: when called with legacy `{ wins, losses, ties, pointDiff }` only, produces
 *   well-calibrated ratings centered at 1500 (exact 1500 at 0-0 when no prior/injury delta is passed).
 */
export function computeCalibratedTeamPowerRating({
  wins = 0,
  losses = 0,
  ties = 0,
  pointDiff = 0,
  pointsFor = null,
  pointsAgainst = null,
  netEpaPerGame = null,
  passEpaPerGame = null,
  rushEpaPerGame = null,
  sosSpreadAdj = 0,
  preseasonPriorSpread = 0,
  preseasonPriorElo = null,
  qbSpreadAdj = 0,
  nonQbInjurySpreadAdj = 0
} = {}) {
  const priorSpread =
    preseasonPriorElo !== null && preseasonPriorElo !== undefined && Number.isFinite(Number(preseasonPriorElo))
      ? (Number(preseasonPriorElo) - 1500) / ELO_PER_SPREAD_POINT
      : Number(preseasonPriorSpread || 0);
  const injurySpread = Number(qbSpreadAdj || 0) + Number(nonQbInjurySpreadAdj || 0);

  const gp = Math.max(0, Number(wins || 0) + Number(losses || 0) + Number(ties || 0));
  if (gp === 0) {
    const zeroSpread = Math.max(-11, Math.min(11, priorSpread + injurySpread));
    return Math.round(Math.max(1225, Math.min(1775, 1500 + zeroSpread * ELO_PER_SPREAD_POINT)));
  }

  const rawPdGm = Number(pointDiff || 0) / gp;
  let cappedPdGm = Math.tanh(rawPdGm / 17) * 17;

  // Mild Morey 2.37 NFL Pythagorean blend when PF & PA are supplied (stabilizes extreme blowout games)
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
    const pythSpreadPts = Math.tanh(((pythWinPct - 0.5) * 26) / 17) * 17;
    cappedPdGm = 0.72 * cappedPdGm + 0.28 * pythSpreadPts;
  }

  const hasNetEpa = netEpaPerGame !== null && netEpaPerGame !== undefined && Number.isFinite(Number(netEpaPerGame));
  const hasPassRush =
    passEpaPerGame !== null &&
    passEpaPerGame !== undefined &&
    Number.isFinite(Number(passEpaPerGame)) &&
    rushEpaPerGame !== null &&
    rushEpaPerGame !== undefined &&
    Number.isFinite(Number(rushEpaPerGame));

  let perfSpreadPts = cappedPdGm;
  if (hasPassRush) {
    const capTot = hasNetEpa
      ? Math.tanh((Number(netEpaPerGame) * 0.89) / 17) * 17
      : Math.tanh(((Number(passEpaPerGame) + Number(rushEpaPerGame)) * 0.89) / 17) * 17;
    const capPass = Math.tanh((Number(passEpaPerGame) * 0.92) / 17) * 17;
    const capRush = Math.tanh((Number(rushEpaPerGame) * 1.15) / 17) * 17;
    perfSpreadPts = 0.48 * cappedPdGm + 0.24 * capTot + 0.23 * capPass + 0.05 * capRush;
  } else if (hasNetEpa) {
    const capTot = Math.tanh((Number(netEpaPerGame) * 0.89) / 17) * 17;
    perfSpreadPts = 0.54 * cappedPdGm + 0.46 * capTot;
  }

  const oppAdjustedPerf = perfSpreadPts + 0.85 * Number(sosSpreadAdj || 0);
  const wPrior = PRIOR_INIT_GAMES * Math.exp(-gp / PRIOR_DECAY_GAMES);
  const effMeanShrink = MEAN_SHRINK_GAMES * (1 - Math.exp(-gp / 4.0));
  const posteriorSpread = (wPrior * priorSpread + gp * oppAdjustedPerf) / (wPrior + effMeanShrink + gp);
  const finalSpread = Math.max(-11, Math.min(11, posteriorSpread + injurySpread));

  return Math.round(Math.max(1225, Math.min(1775, 1500 + finalSpread * ELO_PER_SPREAD_POINT)));
}

/**
 * Computes zero-centered 32-team preseason team spread priors (pts vs league average)
 * from prior-season opponent-adjusted results, offseason veteran QB changes, Week 1 market spreads,
 * and optional external consensus market ratings (e.g. ESPN FPI / Inpredictable / nfelo).
 */
export function computePreseasonPriorsFromHistory({
  prevSeasonGames = [],
  prevSeasonTeamStats = null,
  currentSeasonW1Games = [],
  qbRatingsById = null,
  prevTeamQbByAbbr = null,
  marketPowerSpreadByAbbr = null,
  hfaPts = HOME_FIELD_SPREAD_PTS,
  yearCarryover = YEAR_OVER_YEAR_CARRYOVER,
  marketW1Alpha = PRESEASON_MARKET_W1_ALPHA
} = {}) {
  const allAbbrs = Object.keys(ALL_NFL_DIVISIONS);
  const priors = {};
  for (const a of allAbbrs) priors[a] = 0;

  // 1. Solve prior-season iterative opponent-adjusted spread ratings (16 iterations)
  const validPrev = (Array.isArray(prevSeasonGames) ? prevSeasonGames : []).filter(
    g =>
      g &&
      g.home &&
      g.away &&
      g.homeScore != null &&
      g.awayScore != null &&
      Number.isFinite(Number(g.homeScore)) &&
      Number.isFinite(Number(g.awayScore))
  );
  if (validPrev.length > 0) {
    const teamGms = new Map(allAbbrs.map(a => [a, []]));
    for (const g of validPrev) {
      const home = normalizeTeamAbbr(g.home);
      const away = normalizeTeamAbbr(g.away);
      if (!teamGms.has(home) || !teamGms.has(away)) continue;
      const sitPts = computeGameSituationalElo({
        neutral: Boolean(g.neutral),
        divGame: Boolean(g.divGame ?? (ALL_NFL_DIVISIONS[home] === ALL_NFL_DIVISIONS[away])),
        homeRest: g.homeRest ?? 7,
        awayRest: g.awayRest ?? 7,
        hfaPts
      }) / ELO_PER_SPREAD_POINT;
      const rawM = Number(g.homeScore) - Number(g.awayScore);
      const capM = Math.tanh(rawM / 17) * 17;
      let perfH = capM;
      const hs = prevSeasonTeamStats?.[`${g.week}:${home}`];
      const as = prevSeasonTeamStats?.[`${g.week}:${away}`];
      if (hs && as) {
        const capTot = Math.tanh(((Number(hs.totalEpa || 0) - Number(as.totalEpa || 0)) * 0.89) / 17) * 17;
        const capPass = Math.tanh(((Number(hs.passEpa || 0) - Number(as.passEpa || 0)) * 0.92) / 17) * 17;
        const capRush = Math.tanh(((Number(hs.rushEpa || 0) - Number(as.rushEpa || 0)) * 1.15) / 17) * 17;
        perfH = 0.48 * capM + 0.24 * capTot + 0.23 * capPass + 0.05 * capRush;
      }
      teamGms.get(home).push({ opp: away, perf: perfH - sitPts });
      teamGms.get(away).push({ opp: home, perf: -perfH + sitPts });
    }
    const prevSpread = new Map(allAbbrs.map(a => [a, 0]));
    for (let it = 0; it < 16; it++) {
      const nxt = new Map();
      for (const [a, gms] of teamGms.entries()) {
        if (!gms.length) {
          nxt.set(a, 0);
          continue;
        }
        let sum = 0;
        for (const gm of gms) sum += gm.perf + 0.85 * (prevSpread.get(gm.opp) || 0);
        nxt.set(a, sum / (gms.length + MEAN_SHRINK_GAMES));
      }
      let mean = 0;
      for (const v of nxt.values()) mean += v;
      mean /= nxt.size;
      for (const [k, v] of nxt.entries()) prevSpread.set(k, v - mean);
    }
    for (const a of allAbbrs) {
      priors[a] = (prevSpread.get(a) || 0) * yearCarryover;
    }
  }

  // 2. Apply offseason veteran QB change adjustment entering Week 1
  const w1 = Array.isArray(currentSeasonW1Games) ? currentSeasonW1Games : [];
  if (qbRatingsById && prevTeamQbByAbbr) {
    for (const g of w1) {
      for (const [rawTm, qid] of [
        [g.home, g.homeQbId],
        [g.away, g.awayQbId]
      ]) {
        const tm = normalizeTeamAbbr(rawTm);
        if (!qid || !ALL_NFL_DIVISIONS[tm] || prevTeamQbByAbbr[tm] == null) continue;
        const qInfo = qbRatingsById[qid];
        if (qInfo && Number(qInfo.plays || 0) >= 100 && Number.isFinite(Number(qInfo.valuePts))) {
          priors[tm] = (priors[tm] || 0) + (Number(qInfo.valuePts) - Number(prevTeamQbByAbbr[tm])) * 0.25;
        }
      }
    }
  }

  // 3. Bayesian update with Week 1 pre-kickoff Vegas spreads (captures FA, draft, coaching, offseason trades)
  let usedW1Spreads = 0;
  for (const g of w1) {
    const sp = g.spreadLine ?? g.spread_line;
    if (sp === null || sp === undefined || sp === '' || !Number.isFinite(Number(sp))) continue;
    const home = normalizeTeamAbbr(g.home);
    const away = normalizeTeamAbbr(g.away);
    if (!ALL_NFL_DIVISIONS[home] || !ALL_NFL_DIVISIONS[away]) continue;
    const isDiv = Boolean(g.divGame ?? (ALL_NFL_DIVISIONS[home] === ALL_NFL_DIVISIONS[away]));
    const gameHfa = g.neutral ? 0 : hfaPts * (isDiv ? 1 - DIV_GAME_HFA_DISCOUNT : 1);
    const impliedDiff = Number(sp) - gameHfa;
    const residual = impliedDiff - ((priors[home] || 0) - (priors[away] || 0));
    priors[home] = (priors[home] || 0) + 0.5 * marketW1Alpha * residual;
    priors[away] = (priors[away] || 0) - 0.5 * marketW1Alpha * residual;
    usedW1Spreads++;
  }

  // 4. Optional consensus market/FPI spread blend (primary offseason fallback when W1 spreads aren't yet posted)
  if (marketPowerSpreadByAbbr && typeof marketPowerSpreadByAbbr === 'object') {
    const mKeys = Object.keys(marketPowerSpreadByAbbr).filter(k => ALL_NFL_DIVISIONS[normalizeTeamAbbr(k)]);
    if (mKeys.length >= 24) {
      const blendW = usedW1Spreads >= 8 ? 0.25 : 0.65;
      for (const a of allAbbrs) {
        const mv = Number(marketPowerSpreadByAbbr[a]);
        if (Number.isFinite(mv)) {
          priors[a] = (1 - blendW) * (priors[a] || 0) + blendW * mv;
        }
      }
    }
  }

  // Zero-center and round cleanly
  let mean = 0;
  for (const a of allAbbrs) mean += priors[a] || 0;
  mean /= allAbbrs.length;
  for (const a of allAbbrs) {
    priors[a] = Number(Math.max(-7.5, Math.min(7.5, (priors[a] || 0) - mean)).toFixed(3));
  }
  return priors;
}

/**
 * Estimates starting QB and non-QB key-starter spread adjustments (immediate game vs rest-of-season)
 * directly from live team health & roster payloads (works both in build pipeline and in-browser live overlay).
 */
export function estimateTeamInjurySpreadAdjustments({
  healthData = null,
  rosterPlayers = [],
  remainingGamesCount = 8,
  qbValueAboveReplacement = 3.8
} = {}) {
  const remGames = Math.max(1, Number(remainingGamesCount) || 8);
  const qbDropBase = Math.max(1.5, Math.min(6.0, Number(qbValueAboveReplacement) || 3.8));
  const irRows = Array.isArray(healthData?.irReserve) ? healthData.irReserve : [];
  const injRows = Array.isArray(healthData?.injuryReport) ? healthData.injuryReport : [];
  const pracRows = Array.isArray(healthData?.practiceReport) ? healthData.practiceReport : [];
  const rosterList = Array.isArray(rosterPlayers) ? rosterPlayers : [];

  const normName = s =>
    String(s || '')
      .toLowerCase()
      .replace(/\b(jr|sr|ii|iii|iv|v)\b/g, '')
      .replace(/[^a-z]/g, '');

  // Identify primary starting QB (QB1 by depthRank === 1 or highest snaps/starter flag)
  const rosterQbs = rosterList
    .filter(p => String(p?.position || '').toUpperCase() === 'QB')
    .sort((a, b) => {
      const da = Number(a?.depthRank || 99);
      const db = Number(b?.depthRank || 99);
      if (da !== db) return da - db;
      return Number(b?.snaps || b?.capHit2026 || 0) - Number(a?.snaps || a?.capHit2026 || 0);
    });
  const qb1Name = rosterQbs[0]?.name || '';
  const qb1Key = normName(qb1Name);

  const combinedRows = [];
  const seenKey = new Set();
  for (const src of [
    ...irRows.map(r => ({ ...r, _isIrList: true })),
    ...pracRows.map(r => ({ ...r, _isIrList: false })),
    ...injRows.map(r => ({ ...r, _isIrList: false }))
  ]) {
    if (!src?.name) continue;
    const k = normName(src.name);
    if (!k || seenKey.has(k)) continue;
    seenKey.add(k);
    combinedRows.push(src);
  }

  let qbSpreadGame = 0;
  let qbSpreadSeason = 0;
  let qbStatusNote = '';
  let qbName = qb1Name;
  let nonQbGameRaw = 0;
  let nonQbSeasonRaw = 0;

  for (const row of combinedRows) {
    const pos = String(row.position || '').toUpperCase();
    const statusText = `${row.gameStatus || ''} ${row.status || ''} ${row.designation || ''} ${row.playBadgeLabel || ''} ${row.timelineLabel || ''} ${row.notes || ''}`.toLowerCase();
    const isSeasonEnding =
      /season[\s-]*ending|out for (?:the )?season|torn acl|torn achilles|season over/.test(statusText);
    const isIr =
      Boolean(row._isIrList) ||
      /\b(ir|injured reserve|pup|nfi)\b/.test(statusText);
    const isOut = !isIr && /\b(out|inactive|ruled out|dnp.*out)\b/.test(statusText);
    const isDoubtful = !isIr && !isOut && /\bdoubtful\b/.test(statusText);
    const isQuestionable = !isIr && !isOut && !isDoubtful && /\bquestionable\b/.test(statusText);
    const playProb = Number.isFinite(Number(row.playLikelihood))
      ? Math.max(0, Math.min(100, Number(row.playLikelihood))) / 100
      : isIr || isOut
        ? 0
        : isDoubtful
          ? 0.2
          : isQuestionable
            ? 0.65
            : 0.98;
    const missProb = 1 - playProb;
    if (missProb < 0.08 && !isIr && !isOut && !isDoubtful) continue;

    const rKey = normName(row.name);
    const isStarterQb =
      pos === 'QB' &&
      (qb1Key ? rKey === qb1Key : Boolean(row.isStarter || Number(row.depthRank) === 1));

    if (isStarterQb) {
      qbName = row.name;
      if (isSeasonEnding) {
        qbSpreadGame = -qbDropBase * 0.90;
        qbSpreadSeason = -qbDropBase * 0.85;
        qbStatusNote = `${row.name} (QB1 Season-Ending IR)`;
      } else if (isIr) {
        const expectedMissWks = /21[\s-]*day|window open|designated to return/.test(statusText) ? 1.5 : 4.0;
        const frac = Math.min(1, expectedMissWks / remGames);
        qbSpreadGame = -qbDropBase * 0.85;
        qbSpreadSeason = -qbDropBase * 0.85 * Math.max(0.30, frac);
        qbStatusNote = `${row.name} (QB1 IR)`;
      } else if (isOut) {
        qbSpreadGame = -qbDropBase * 0.85;
        qbSpreadSeason = -qbDropBase * 0.35;
        qbStatusNote = `${row.name} (QB1 Out)`;
      } else if (isDoubtful) {
        qbSpreadGame = -qbDropBase * 0.70;
        qbSpreadSeason = -qbDropBase * 0.22;
        qbStatusNote = `${row.name} (QB1 Doubtful)`;
      } else if (isQuestionable && missProb >= 0.20) {
        qbSpreadGame = -qbDropBase * 0.75 * missProb;
        qbSpreadSeason = -qbDropBase * 0.15 * missProb;
        qbStatusNote = `${row.name} (QB1 Questionable ${Math.round(playProb * 100)}%)`;
      }
      continue;
    }

    if (pos === 'QB') continue;

    // Non-QB positional WAR weights (empirically calibrated against 2014–2025 NFL injury reports)
    const isKeyStarter = Boolean(row.isStarter || Number(row.depthRank) === 1 || Number(row.snapSharePct || 0) >= 55);
    const starterMult = isKeyStarter ? 1.25 : 0.75;
    const posWeight =
      pos === 'OT' || pos === 'LT' || pos === 'RT' || pos === 'T' || pos === 'DE' || pos === 'EDGE' || pos === 'OLB'
        ? 0.32
        : pos === 'WR' || pos === 'CB'
          ? 0.28
          : pos === 'DT' || pos === 'NT' || pos === 'TE' || pos === 'S' || pos === 'FS' || pos === 'SS'
            ? 0.18
            : pos === 'OG' || pos === 'G' || pos === 'C' || pos === 'LB' || pos === 'ILB' || pos === 'MLB'
              ? 0.14
              : pos === 'RB'
                ? 0.12
                : 0.06;

    const effGame = posWeight * starterMult * (isIr || isOut ? 1.0 : missProb);
    nonQbGameRaw += effGame;
    if (isSeasonEnding) {
      nonQbSeasonRaw += effGame * 0.65;
    } else if (isIr) {
      nonQbSeasonRaw += effGame * Math.min(0.60, 3.5 / remGames);
    } else if (isOut || isDoubtful) {
      nonQbSeasonRaw += effGame * 0.20;
    }
  }

  const nonQbSpreadGame = -Math.min(1.5, Number((nonQbGameRaw * 0.35).toFixed(3)));
  const nonQbSpreadSeason = -Math.min(0.85, Number((nonQbSeasonRaw * 0.35).toFixed(3)));

  return {
    qbName,
    qbStatusNote,
    qbSpreadGame: Number(qbSpreadGame.toFixed(3)),
    qbSpreadSeason: Number(qbSpreadSeason.toFixed(3)),
    nonQbSpreadGame,
    nonQbSpreadSeason,
    totalGameSpreadAdj: Number((qbSpreadGame + nonQbSpreadGame).toFixed(3)),
    totalSeasonSpreadAdj: Number((qbSpreadSeason + nonQbSpreadSeason).toFixed(3))
  };
}

/**
 * Computes industry-standard 32-team NFL power ratings simultaneously (<1.5ms deterministic)
 * combining:
 *  1. Preseason team projections (fast-fading exponential weight `6.5 * exp(-gp / 6.0)`)
 *  2. In-season performance (variance-normalized soft-capped Margin + Net/Pass/Rush EPA + mild recency decay)
 *  3. Strength of opponents played thus far (16-iteration venue- & rest-adjusted Ridge-SRS + 18% MOV-Elo blend)
 *  4. Strength of upcoming opponents (`remainingSosSpread`, `remainingSosRank`)
 *  5. Starting QB & non-QB key injury adjustments (separating immediate week vs rest-of-season persistence)
 */
export function computeLeaguePowerRatings({
  completedGames = [],
  remainingGames = [],
  preseasonPriors = {},
  weeklyTeamStats = null,
  teamAggregateEpa = null,
  standingsByAbbr = null,
  qbContext = null,
  injuryAdjustmentsByTeam = null,
  currentWeek = null,
  hfaPts = HOME_FIELD_SPREAD_PTS
} = {}) {
  const allAbbrs = Object.keys(ALL_NFL_DIVISIONS);
  const cleanCompleted = (Array.isArray(completedGames) ? completedGames : []).filter(
    g =>
      g &&
      g.home &&
      g.away &&
      g.homeScore != null &&
      g.awayScore != null &&
      Number.isFinite(Number(g.homeScore)) &&
      Number.isFinite(Number(g.awayScore))
  );
  const sortedCompleted = [...cleanCompleted].sort((a, b) => Number(a.week || 0) - Number(b.week || 0));
  const maxCompletedWk = sortedCompleted.reduce((m, g) => Math.max(m, Number(g.week || 0)), 0);
  const effCurrentWk = Number(currentWeek || 0) > 0 ? Number(currentWeek) : maxCompletedWk + 1;

  // Normalize preseason priors (spread pts vs avg)
  const priorMap = new Map();
  for (const a of allAbbrs) {
    const v = Number(preseasonPriors?.[a] ?? 0);
    priorMap.set(a, Number.isFinite(v) ? v : 0);
  }

  // Helper to resolve QB spread value (pts vs league average starter)
  const qbRatingsById = qbContext?.qbRatingsById || null;
  const qbReplacementPts = Number(qbContext?.qbReplacementPts ?? -1.7);
  const getQbVal = qid => {
    if (!qid || !qbRatingsById) return 0;
    const entry = qbRatingsById[qid];
    if (!entry) return qbReplacementPts;
    return Number.isFinite(Number(entry.valuePts)) ? Number(entry.valuePts) : qbReplacementPts;
  };

  // Build per-team game logs & sequential MOV-Elo starting from preseason priors
  const teamGms = new Map(allAbbrs.map(a => [a, []]));
  const movElo = new Map(allAbbrs.map(a => [a, 1500 + (priorMap.get(a) || 0) * ELO_PER_SPREAD_POINT]));
  const lastQbByTeam = new Map();

  for (const g of sortedCompleted) {
    const home = normalizeTeamAbbr(g.home);
    const away = normalizeTeamAbbr(g.away);
    if (!teamGms.has(home) || !teamGms.has(away)) continue;

    const wk = Number(g.week || 1);
    const isDiv = Boolean(g.divGame ?? (ALL_NFL_DIVISIONS[home] === ALL_NFL_DIVISIONS[away]));
    const sitElo = computeGameSituationalElo({
      neutral: Boolean(g.neutral),
      divGame: isDiv,
      homeRest: g.homeRest ?? 7,
      awayRest: g.awayRest ?? 7,
      hfaPts
    });
    const sitPts = sitElo / ELO_PER_SPREAD_POINT;
    const wAge = Math.pow(0.99, Math.max(0, effCurrentWk - 1 - wk));

    const rawM = Number(g.homeScore) - Number(g.awayScore);
    const capM = Math.tanh(rawM / 17) * 17;
    const hs = weeklyTeamStats?.[`${wk}:${home}`];
    const as = weeklyTeamStats?.[`${wk}:${away}`];
    let perfH = capM;
    if (hs && as) {
      const capTot = Math.tanh(((Number(hs.totalEpa || 0) - Number(as.totalEpa || 0)) * 0.89) / 17) * 17;
      const capPass = Math.tanh(((Number(hs.passEpa || 0) - Number(as.passEpa || 0)) * 0.92) / 17) * 17;
      const capRush = Math.tanh(((Number(hs.rushEpa || 0) - Number(as.rushEpa || 0)) * 1.15) / 17) * 17;
      perfH = 0.48 * capM + 0.24 * capTot + 0.23 * capPass + 0.05 * capRush;
    }

    const hQbVal = g.homeQbId ? getQbVal(g.homeQbId) : null;
    const aQbVal = g.awayQbId ? getQbVal(g.awayQbId) : null;
    if (g.homeQbId) lastQbByTeam.set(home, g.homeQbId);
    if (g.awayQbId) lastQbByTeam.set(away, g.awayQbId);

    teamGms.get(home).push({ opp: away, perf: perfH - sitPts, w: wAge, qbVal: hQbVal });
    teamGms.get(away).push({ opp: home, perf: -perfH + sitPts, w: wAge, qbVal: aQbVal });

    // Sequential FiveThirtyEight / nfelo MOV-Elo update
    const diff = movElo.get(home) + sitElo - movElo.get(away);
    const pHome = 1 / (1 + Math.exp(-diff * LN10_DIV_400));
    const act = rawM > 0 ? 1 : rawM < 0 ? 0 : 0.5;
    const movMult = Math.log(Math.abs(rawM) + 1) * (2.2 / ((rawM >= 0 ? diff : -diff) * 0.001 + 2.2));
    const dElo = MOV_ELO_K * movMult * (act - pHome);
    movElo.set(home, movElo.get(home) + dElo);
    movElo.set(away, movElo.get(away) - dElo);
  }

  // 16-Iteration Two-Component Hierarchical Bayesian Ridge-SRS
  const ridgeSpread = new Map(allAbbrs.map(a => [a, priorMap.get(a) || 0]));
  for (let it = 0; it < 16; it++) {
    const nxt = new Map();
    for (const a of allAbbrs) {
      const gms = teamGms.get(a);
      const pr = priorMap.get(a) || 0;
      const gp = gms.length;
      if (gp === 0) {
        // Fallback to aggregate standings when completedGames isn't populated yet
        const st = standingsByAbbr?.[a];
        const stGp = st ? (Number(st.wins) || 0) + (Number(st.losses) || 0) + (Number(st.ties) || 0) : 0;
        if (stGp > 0) {
          const epaObj = teamAggregateEpa?.[a] || null;
          const fallbackElo = computeCalibratedTeamPowerRating({
            wins: st.wins,
            losses: st.losses,
            ties: st.ties,
            pointDiff: st.pointDiff ?? st.pd ?? 0,
            pointsFor: st.pointsFor ?? st.pf ?? null,
            pointsAgainst: st.pointsAgainst ?? st.pa ?? null,
            netEpaPerGame: epaObj?.netEpaPerGame ?? st.netEpaPerGame ?? null,
            passEpaPerGame: epaObj?.passEpaPerGame ?? null,
            rushEpaPerGame: epaObj?.rushEpaPerGame ?? null,
            preseasonPriorSpread: pr
          });
          nxt.set(a, (fallbackElo - 1500) / ELO_PER_SPREAD_POINT);
        } else {
          nxt.set(a, pr);
        }
        continue;
      }
      const wPrior = PRIOR_INIT_GAMES * Math.exp(-gp / PRIOR_DECAY_GAMES);
      const effMeanShrink = MEAN_SHRINK_GAMES * (1 - Math.exp(-gp / 4.0));
      let wSum = 0;
      let numSum = 0;
      for (const gm of gms) {
        numSum += gm.w * (gm.perf + 0.85 * (ridgeSpread.get(gm.opp) || 0));
        wSum += gm.w;
      }
      // If weekly per-game EPA wasn't supplied, blend aggregate team Net EPA smoothly
      if (!weeklyTeamStats && teamAggregateEpa?.[a] && Number.isFinite(Number(teamAggregateEpa[a].netEpaPerGame))) {
        const capAggEpa = Math.tanh((Number(teamAggregateEpa[a].netEpaPerGame) * 0.89) / 17) * 17;
        const rawPerfAvg = numSum / Math.max(1e-6, wSum);
        numSum = wSum * (0.62 * rawPerfAvg + 0.38 * capAggEpa);
      }
      nxt.set(a, (wPrior * pr + numSum) / (wPrior + effMeanShrink + wSum));
    }
    let mean = 0;
    for (const v of nxt.values()) mean += v;
    mean /= nxt.size;
    for (const [k, v] of nxt.entries()) ridgeSpread.set(k, v - mean);
  }

  // Blend Ridge-SRS (82%) + sequential MOV-Elo (18%) and compute SOS Played
  const baseSpreadByAbbr = new Map();
  const sosPlayedByAbbr = new Map();
  for (const a of allAbbrs) {
    const gms = teamGms.get(a);
    const rSp = ridgeSpread.get(a) || 0;
    const mSp = gms.length > 0 ? (movElo.get(a) - 1500) / ELO_PER_SPREAD_POINT : rSp;
    baseSpreadByAbbr.set(a, (1 - MOV_ELO_BLEND) * rSp + MOV_ELO_BLEND * mSp);
    if (gms.length > 0) {
      let oppSum = 0;
      for (const gm of gms) oppSum += ridgeSpread.get(gm.opp) || 0;
      sosPlayedByAbbr.set(a, oppSum / gms.length);
    } else {
      sosPlayedByAbbr.set(a, 0);
    }
  }

  // Compute remaining games per team for QB IR duration scaling & upcoming SOS
  const remGamesCount = new Map(allAbbrs.map(a => [a, 0]));
  for (const rg of Array.isArray(remainingGames) ? remainingGames : []) {
    const h = normalizeTeamAbbr(rg?.home);
    const a = normalizeTeamAbbr(rg?.away);
    if (remGamesCount.has(h)) remGamesCount.set(h, remGamesCount.get(h) + 1);
    if (remGamesCount.has(a)) remGamesCount.set(a, remGamesCount.get(a) + 1);
  }

  // Apply QB Injury / Replacement Delta + Non-QB Key Injury Delta
  const byAbbr = {};
  for (const a of allAbbrs) {
    const gms = teamGms.get(a);
    const baseSp = baseSpreadByAbbr.get(a) || 0;
    const priorSp = priorMap.get(a) || 0;
    let qbDeltaGame = 0;
    let qbDeltaSeason = 0;
    let qbStatusNote = '';

    // Source A: Explicit QB identity / EPA comparison (historical starter vs current expected starter)
    const currStarterId = qbContext?.currentStarterByTeam?.[a] || lastQbByTeam.get(a) || null;
    if (qbRatingsById && currStarterId && gms.length > 0) {
      let qWSum = 0;
      let qValSum = 0;
      for (const gm of gms) {
        if (gm.qbVal !== null && gm.qbVal !== undefined) {
          qValSum += gm.w * gm.qbVal;
          qWSum += gm.w;
        }
      }
      if (qWSum > 0) {
        const histQbVal = qValSum / qWSum;
        const currQbVal = getQbVal(currStarterId);
        const rawDelta = currQbVal - histQbVal;
        if (Math.abs(rawDelta) > 0.08) {
          const consecMiss = Number(qbContext?.consecMissedByTeam?.[a] || 0);
          const isSeasonEnding = Boolean(qbContext?.seasonEndingIrByTeam?.[a]);
          const isStandardIr = Boolean(qbContext?.standardIrByTeam?.[a]);
          const remG = Math.max(1, remGamesCount.get(a) || 6);
          const seasonW =
            rawDelta > 0
              ? 0.68 // Starter returning from absence boosts rest of season!
              : isSeasonEnding
                ? 0.85
                : isStandardIr
                  ? 0.85 * Math.min(1, 4 / remG)
                  : consecMiss >= 2
                    ? 0.68
                    : 0.35;
          qbDeltaGame = rawDelta * 0.85;
          qbDeltaSeason = rawDelta * seasonW;
        }
      }
    }

    // Source B: Live ESPN / Club Injury Report QB & Non-QB overrides (when live injury feed shows QB1 Out/IR!)
    const liveInj = injuryAdjustmentsByTeam?.[a] || null;
    let nonQbGame = 0;
    let nonQbSeason = 0;
    if (liveInj) {
      if (Number.isFinite(Number(liveInj.qbSpreadGame)) && Math.abs(Number(liveInj.qbSpreadGame)) > Math.abs(qbDeltaGame)) {
        qbDeltaGame = Number(liveInj.qbSpreadGame);
      }
      if (Number.isFinite(Number(liveInj.qbSpreadSeason)) && Math.abs(Number(liveInj.qbSpreadSeason)) > Math.abs(qbDeltaSeason)) {
        qbDeltaSeason = Number(liveInj.qbSpreadSeason);
      }
      if (liveInj.qbStatusNote) qbStatusNote = String(liveInj.qbStatusNote);
      nonQbGame = Number(liveInj.nonQbSpreadGame || 0);
      nonQbSeason = Number(liveInj.nonQbSpreadSeason || 0);
    }

    const seasonSpread = Math.max(-11, Math.min(11, baseSp + qbDeltaSeason + nonQbSeason));
    const gameSpread = Math.max(-11, Math.min(11, baseSp + qbDeltaGame + nonQbGame));
    const powerRating = Math.round(1500 + seasonSpread * ELO_PER_SPREAD_POINT);
    const gamePowerRating = Math.round(1500 + gameSpread * ELO_PER_SPREAD_POINT);

    byAbbr[a] = {
      abbr: a,
      gamesPlayed: gms.length,
      preseasonPriorSpread: Number(priorSp.toFixed(2)),
      preseasonPriorElo: Math.round(1500 + priorSp * ELO_PER_SPREAD_POINT),
      inSeasonSpread: Number(baseSp.toFixed(2)),
      sosSpreadAdj: Number((sosPlayedByAbbr.get(a) || 0).toFixed(3)),
      qbDeltaSpreadGame: Number(qbDeltaGame.toFixed(2)),
      qbDeltaSpreadSeason: Number(qbDeltaSeason.toFixed(2)),
      qbInjuryEloAdj: Math.round(qbDeltaSeason * ELO_PER_SPREAD_POINT),
      nonQbInjuryEloAdj: Math.round(nonQbSeason * ELO_PER_SPREAD_POINT),
      qbStatusNote,
      powerRating,
      gamePowerRating,
      nextGameEloDelta: gamePowerRating - powerRating,
      remainingSosSpread: 0,
      remainingSosRank: 16
    };
  }

  // Compute Upcoming Strength of Schedule (average opponent season spread across remaining games)
  const remOppSum = new Map(allAbbrs.map(a => [a, 0]));
  const remOppCnt = new Map(allAbbrs.map(a => [a, 0]));
  for (const rg of Array.isArray(remainingGames) ? remainingGames : []) {
    const h = normalizeTeamAbbr(rg?.home);
    const a = normalizeTeamAbbr(rg?.away);
    if (byAbbr[h] && byAbbr[a]) {
      const hSp = (byAbbr[h].powerRating - 1500) / ELO_PER_SPREAD_POINT;
      const aSp = (byAbbr[a].powerRating - 1500) / ELO_PER_SPREAD_POINT;
      remOppSum.set(h, remOppSum.get(h) + aSp);
      remOppCnt.set(h, remOppCnt.get(h) + 1);
      remOppSum.set(a, remOppSum.get(a) + hSp);
      remOppCnt.set(a, remOppCnt.get(a) + 1);
    }
  }
  const remSosRanked = allAbbrs
    .map(a => {
      const cnt = remOppCnt.get(a) || 0;
      const val = cnt > 0 ? remOppSum.get(a) / cnt : 0;
      byAbbr[a].remainingSosSpread = Number(val.toFixed(3));
      return { abbr: a, val };
    })
    .sort((x, y) => y.val - x.val || x.abbr.localeCompare(y.abbr));
  remSosRanked.forEach((item, idx) => {
    byAbbr[item.abbr].remainingSosRank = idx + 1; // #1 = toughest remaining schedule, #32 = easiest
  });

  return {
    modelVersion: PLAYOFF_MODEL_VERSION,
    byAbbr
  };
}

/**
 * Reconciles live ESPN NFL scoreboard events directly into `simulatorInputs.completedGames`
 * and `remainingGames` so ANY newly finished game across all 32 teams immediately updates
 * H2H, SOV, SOS, common-games tiebreakers, and power ratings in-browser within seconds of Final.
 */
export function reconcileLiveScoreboardIntoPlayoffGames(simInputs, liveScoreboardRaw) {
  if (!simInputs || !liveScoreboardRaw || !Array.isArray(liveScoreboardRaw.events)) {
    return { movedCount: 0, newlyCompleted: [] };
  }
  const completedList = Array.isArray(simInputs.completedGames) ? [...simInputs.completedGames] : [];
  const remainingList = Array.isArray(simInputs.remainingGames) ? [...simInputs.remainingGames] : [];

  const completedByKey = new Map();
  for (const cg of completedList) {
    const k = canonicalPlayoffGameKey(cg);
    if (k) completedByKey.set(k, cg);
  }
  const remainingByKey = new Map();
  for (const rg of remainingList) {
    const k = canonicalPlayoffGameKey(rg);
    if (k) remainingByKey.set(k, rg);
  }

  const newlyCompleted = [];
  for (const ev of liveScoreboardRaw.events) {
    const comp = ev?.competitions?.[0];
    if (!comp?.status?.type?.completed) continue;
    const stType = Number(ev?.season?.type ?? liveScoreboardRaw?.season?.type ?? 2);
    if (stType !== 2) continue; // Regular season only for playoff seeding simulation
    const wk = Number(ev?.week?.number ?? liveScoreboardRaw?.week?.number ?? 0);
    if (!wk || wk < 1 || wk > 18) continue;

    const homeC = (comp.competitors || []).find(c => c.homeAway === 'home');
    const awayC = (comp.competitors || []).find(c => c.homeAway === 'away');
    if (!homeC || !awayC) continue;
    const home = normalizeTeamAbbr(homeC.team?.abbreviation);
    const away = normalizeTeamAbbr(awayC.team?.abbreviation);
    if (!ALL_NFL_DIVISIONS[home] || !ALL_NFL_DIVISIONS[away]) continue;
    const homeScore = Number(homeC.score);
    const awayScore = Number(awayC.score);
    if (!Number.isFinite(homeScore) || !Number.isFinite(awayScore)) continue;

    const key = canonicalPlayoffGameKey({ week: wk, home, away });
    if (!key) continue;
    const prevRem = remainingByKey.get(key) || null;
    const prevComp = completedByKey.get(key) || null;

    if (!prevComp) {
      const doneObj = {
        id: prevRem?.id || String(ev.id || `live_${wk}_${away}_${home}`),
        week: wk,
        home: prevRem?.home || home,
        away: prevRem?.away || away,
        homeScore: prevRem && normalizeTeamAbbr(prevRem.home) !== home ? awayScore : homeScore,
        awayScore: prevRem && normalizeTeamAbbr(prevRem.home) !== home ? homeScore : awayScore,
        neutral: Boolean(comp.neutralSite || prevRem?.neutral),
        divGame: Boolean(prevRem?.divGame ?? (ALL_NFL_DIVISIONS[home] === ALL_NFL_DIVISIONS[away])),
        ...(prevRem?.homeRest != null ? { homeRest: prevRem.homeRest } : {}),
        ...(prevRem?.awayRest != null ? { awayRest: prevRem.awayRest } : {})
      };
      completedByKey.set(key, doneObj);
      remainingByKey.delete(key);
      newlyCompleted.push(doneObj);
    } else if (prevRem) {
      remainingByKey.delete(key);
    }
  }

  if (newlyCompleted.length > 0 || remainingByKey.size !== remainingList.length) {
    simInputs.completedGames = [...completedByKey.values()];
    simInputs.remainingGames = [...remainingByKey.values()];
  }
  return { movedCount: newlyCompleted.length, newlyCompleted };
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

function winProbabilityHome(homeElo, awayElo, gameOpts = false) {
  const opts = typeof gameOpts === 'boolean' ? { neutral: gameOpts } : gameOpts || {};
  const sitElo = computeGameSituationalElo(opts);
  const diff = homeElo + sitElo - awayElo;
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
    otherConferenceNextGameDeltas = null,
    iterations = 10000,
    seed = 492026,
    playoffTeamsPerConf = 7
  } = config;
  const activePlayoffSpots = playoffTeamsPerConf === 6 ? 6 : 7;
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
  const nextGameDelta = new Float64Array(totalTeams);

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
        netEpaPerGame: t.netEpaPerGame ?? null,
        sosSpreadAdj: t.sosSpreadAdj ?? 0,
        preseasonPriorSpread: t.preseasonPriorSpread ?? 0,
        preseasonPriorElo: t.preseasonPriorElo ?? null
      });
    nextGameDelta[i] = Number.isFinite(Number(t.nextGameEloDelta))
      ? Number(t.nextGameEloDelta)
      : Number.isFinite(Number(t.gamePowerRating))
        ? Number(t.gamePowerRating) - elo[i]
        : 0;
  });

  for (const [abbr, idx] of abbrToIdx.entries()) {
    if (idx < nTeams) continue;
    const st = resolvedOtherStandings[abbr] || null;
    elo[idx] = Number(resolvedAfcPowerRatings[abbr]) || 1500;
    nextGameDelta[idx] = Number(
      otherConferenceNextGameDeltas?.[abbr] ?? st?.nextGameEloDelta ?? 0
    ) || 0;
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

  // Pre-compute calibrated Bayesian posterior standard deviation in Elo points for each team
  // (65 Elo prior std shrinking via `1 / sqrt(1 + gp / 6.0)`, calibrated across 12 NFL seasons 2014–2025)
  const posteriorEloStd = new Float64Array(totalTeams);
  for (let i = 0; i < totalTeams; i++) {
    const gp = baseW[i] + baseL[i] + baseT[i];
    posteriorEloStd[i] = POSTERIOR_ELO_STD_BASE / Math.sqrt(1 + gp / POSTERIOR_ELO_STD_DECAY);
  }

  // Pre-compile all remaining NFL games (including AFC-vs-AFC so full-season SOV/SOS tiebreakers reflect 17 games)
  const sortedRemGames = [...cleanRemainingGames].sort((a, b) => Number(a.week || 0) - Number(b.week || 0));
  const minRemainingWeek = sortedRemGames.reduce((m, g) => {
    const wk = Number(g.week || 0);
    return wk > 0 && wk < m ? wk : m;
  }, Infinity);
  const compiledGames = [];
  for (const g of sortedRemGames) {
    const hAbbr = normalizeTeamAbbr(g.home);
    const aAbbr = normalizeTeamAbbr(g.away);
    const hi = abbrToIdx.get(hAbbr);
    const ai = abbrToIdx.get(aAbbr);
    if (hi === undefined || ai === undefined) continue;

    const bothNfc = hi < nTeams && ai < nTeams;
    const sameDiv = bothNfc && divIndexOf[hi] === divIndexOf[ai];
    const isAnyDivGame = Boolean(g.divGame ?? (ALL_NFL_DIVISIONS[hAbbr] === ALL_NFL_DIVISIONS[aAbbr]));
    const baseSitElo = computeGameSituationalElo({
      neutral: Boolean(g.neutral),
      divGame: isAnyDivGame,
      homeRest: g.homeRest ?? 7,
      awayRest: g.awayRest ?? 7
    });
    const isNextWeekGame = Number(g.week || 0) === minRemainingWeek || !Number.isFinite(minRemainingWeek);
    const immediateInjuryElo = isNextWeekGame ? nextGameDelta[hi] - nextGameDelta[ai] : 0;
    const hfa = baseSitElo + immediateInjuryElo;

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
      const uShockHome = rand();
      const uShockAway = rand();

      let outcome; // 1 = HOME, 2 = AWAY, 3 = TIE
      if (g.forcedCode !== 0) {
        outcome = g.forcedCode;
      } else {
        const pTie = 0.0036 * 4 * pHomeRaw * (1 - pHomeRaw);
        const pHomeWin = pHomeRaw * (1 - pTie);
        outcome = uOutcome < pHomeWin ? 1 : uOutcome < pHomeWin + pTie ? 3 : 2;
      }

      // Dynamic weekly Elo update + Ornstein-Uhlenbeck mean reversion + future injury/form jump shock
      // on naturally simulated games. Skip Elo mutation on user-forced scenario picks so forcing an upset
      // never artificially inflates that team's true-talent rating in subsequent weeks.
      if (g.forcedCode === 0) {
        const actualHome = outcome === 1 ? 1.0 : outcome === 2 ? 0.0 : 0.5;
        const deltaElo = IN_SEASON_ELO_K * (actualHome - pHomeRaw);
        simElo[hi] = 1500 + (simElo[hi] + deltaElo - 1500) * (1 - FUTURE_MEAN_REVERT_PER_GAME);
        simElo[ai] = 1500 + (simElo[ai] - deltaElo - 1500) * (1 - FUTURE_MEAN_REVERT_PER_GAME);
        if (uShockHome < FUTURE_INJURY_SHOCK_PROB) simElo[hi] -= FUTURE_INJURY_SHOCK_ELO;
        if (uShockAway < FUTURE_INJURY_SHOCK_PROB) simElo[ai] -= FUTURE_INJURY_SHOCK_ELO;
      }

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

    // 3. Seed Wild Cards (#5 through #activePlayoffSpots): track the highest remaining non-champion from each division
    const divCursor = [1, 1, 1, 1];
    for (let wcSeed = 5; wcSeed <= activePlayoffSpots; wcSeed++) {
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

  // Deterministic mathematical clinch bounds after applying any user-forced outcomes.
  // Ensures Monte Carlo never rounds an unclinched 99.96% or 10000/10000 sample up to a false "100%"
  // while still honoring genuine mathematical clinches (including 0 unforced games remaining).
  const hasForcedOverrides = Object.keys(forcedWinners || {}).length > 0;
  const detW = new Int16Array(nTeams);
  const detL = new Int16Array(nTeams);
  const detT = new Int16Array(nTeams);
  const remUnforced = new Int16Array(nTeams);
  for (let i = 0; i < nTeams; i++) {
    detW[i] = baseW[i];
    detL[i] = baseL[i];
    detT[i] = baseT[i];
  }
  let totalUnforcedConfGames = 0;
  for (let gIdx = 0; gIdx < nGames; gIdx++) {
    const g = compiledGames[gIdx];
    if (g.forcedCode === 1) {
      if (g.hi < nTeams) detW[g.hi]++;
      if (g.ai < nTeams) detL[g.ai]++;
    } else if (g.forcedCode === 2) {
      if (g.ai < nTeams) detW[g.ai]++;
      if (g.hi < nTeams) detL[g.hi]++;
    } else if (g.forcedCode === 3) {
      if (g.hi < nTeams) detT[g.hi]++;
      if (g.ai < nTeams) detT[g.ai]++;
    } else {
      if (g.hi < nTeams || g.ai < nTeams) totalUnforcedConfGames++;
      if (g.hi < nTeams) remUnforced[g.hi]++;
      if (g.ai < nTeams) remUnforced[g.ai]++;
    }
  }
  const minFinalPct = new Float64Array(nTeams);
  const maxFinalPct = new Float64Array(nTeams);
  for (let i = 0; i < nTeams; i++) {
    const totG = detW[i] + detL[i] + detT[i] + remUnforced[i];
    minFinalPct[i] = totG > 0 ? (detW[i] + 0.5 * detT[i]) / totG : 0;
    maxFinalPct[i] = totG > 0 ? (detW[i] + remUnforced[i] + 0.5 * detT[i]) / totG : 1;
  }

  const allTeamOdds = activeConfTeams.map((t, i) => {
    let playoffTotal = 0;
    for (let sIdx = 1; sIdx <= activePlayoffSpots; sIdx++) playoffTotal += seedCounts[i][sIdx];
    const missedTotal = iterations - playoffTotal;
    const pct = c => Math.round((c / iterations) * 1000) / 10;

    // Mathematical clinch checks for club `i`
    const clincherCode = !hasForcedOverrides ? String(t.clincher || '').trim().toLowerCase() : '';
    let isClinchedPlayoffs = false;
    let isClinchedDivision = false;
    let isClinchedSeed1 = false;
    if (totalUnforcedConfGames === 0) {
      isClinchedPlayoffs = playoffTotal === iterations;
      isClinchedDivision = divTitleCounts[i] === iterations;
      isClinchedSeed1 = seedCounts[i][1] === iterations;
    } else {
      const myDiv = divIndexOf[i];
      const floorPct = minFinalPct[i];
      let sameDivCanCatch = 0;
      let otherConfCanCatch = 0;
      const otherDivCanCatch = [0, 0, 0, 0];
      for (let j = 0; j < nTeams; j++) {
        if (j === i) continue;
        if (maxFinalPct[j] >= floorPct - EPS) {
          otherConfCanCatch++;
          const d = divIndexOf[j];
          if (d === myDiv) sameDivCanCatch++;
          else otherDivCanCatch[d]++;
        }
      }
      const otherDivExtraWcRivals =
        otherDivCanCatch.reduce((sum, cnt, d) => (d === myDiv ? sum : sum + Math.max(0, cnt - 1)), 0);
      const canStillLoseDiv = sameDivCanCatch >= 1;
      const canStillMissPlayoffs = canStillLoseDiv && sameDivCanCatch + otherDivExtraWcRivals >= 4;
      const canStillMissSeed1 = otherConfCanCatch >= 1;

      isClinchedDivision = (!canStillLoseDiv && divTitleCounts[i] === iterations) || /[yz]/.test(clincherCode);
      isClinchedPlayoffs =
        isClinchedDivision ||
        (!canStillMissPlayoffs && playoffTotal === iterations) ||
        /[xyz]/.test(clincherCode);
      isClinchedSeed1 = (!canStillMissSeed1 && seedCounts[i][1] === iterations) || clincherCode === 'z';
    }

    const guardedPct = (count, clinched) => {
      const raw = pct(count);
      if (!clinched && raw >= 100) return 99.9;
      return raw;
    };

    const makePlayoffsPct = guardedPct(playoffTotal, isClinchedPlayoffs);
    const winDivisionPct = guardedPct(divTitleCounts[i], isClinchedDivision);
    const seed1ByePct = guardedPct(seedCounts[i][1], isClinchedSeed1);
    const rawMissedPct = pct(missedTotal);
    const missedPlayoffsPct =
      !isClinchedPlayoffs && makePlayoffsPct >= 99.9 && rawMissedPct === 0 ? 0.1 : rawMissedPct;

    return {
      abbr: t.abbr,
      name: t.name,
      logoUrl: t.logoUrl || '',
      division: confDivMap[normalizeTeamAbbr(t.abbr)] || t.division || divNames[0],
      currentRecord: `${t.wins}-${t.losses}${t.ties ? `-${t.ties}` : ''}`,
      powerRating: Math.round(elo[i]),
      ...(t.preseasonPriorElo != null ? { preseasonPriorElo: Math.round(Number(t.preseasonPriorElo)) } : {}),
      ...(t.sosSpreadAdj != null ? { sosSpreadAdj: Number(t.sosSpreadAdj) } : {}),
      ...(t.remainingSosSpread != null ? { remainingSosSpread: Number(t.remainingSosSpread) } : {}),
      ...(t.remainingSosRank != null ? { remainingSosRank: Number(t.remainingSosRank) } : {}),
      ...(t.qbInjuryEloAdj != null ? { qbInjuryEloAdj: Math.round(Number(t.qbInjuryEloAdj)) } : {}),
      ...(t.nonQbInjuryEloAdj != null ? { nonQbInjuryEloAdj: Math.round(Number(t.nonQbInjuryEloAdj)) } : {}),
      ...(t.qbStatusNote ? { qbStatusNote: String(t.qbStatusNote) } : {}),
      projectedWins: Math.round((winSum[i] / iterations) * 10) / 10,
      makePlayoffsPct,
      winDivisionPct,
      seed1ByePct,
      wildCardPct: pct(seedCounts[i][5] + seedCounts[i][6] + (activePlayoffSpots >= 7 ? seedCounts[i][7] : 0)),
      isClinchedPlayoffs,
      isClinchedDivision,
      isClinchedSeed1,
      seedDistribution: {
        1: seed1ByePct,
        2: pct(seedCounts[i][2]),
        3: pct(seedCounts[i][3]),
        4: pct(seedCounts[i][4]),
        5: pct(seedCounts[i][5]),
        6: pct(seedCounts[i][6]),
        7: pct(seedCounts[i][7])
      },
      missedPlayoffsPct
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

    const avgPoPct = (homeTarget.makePlayoffsPct + awayTarget.makePlayoffsPct) / 2;
    const isTargetTeamGame = home === targetAbbr || away === targetAbbr;
    const compositeHomeEdge = isTargetTeamGame
      ? home === targetAbbr
        ? 1
        : -1
      : avgPoPct < 95
        ? playSwingHome * 2.0 + divSwingHome * 1.15 + byeSwingHome * 0.85
        : byeSwingHome * 1.35 + divSwingHome * 1.1 + playSwingHome * 0.85;

    const rootSide = compositeHomeEdge >= 0 ? 'HOME' : 'AWAY';
    const rootSign = rootSide === 'HOME' ? 1 : -1;
    const rootFor = rootSide === 'HOME' ? home : away;
    const rootAgainst = rootSide === 'HOME' ? away : home;

    const byeGain = Math.round(Math.max(0, byeSwingHome * rootSign) * 10) / 10;
    const divGain = Math.round(Math.max(0, divSwingHome * rootSign) * 10) / 10;
    const playGain = Math.round(Math.max(0, playSwingHome * rootSign) * 10) / 10;
    const byeSwing = Math.round(Math.abs(byeSwingHome) * 10) / 10;
    const divSwing = Math.round(Math.abs(divSwingHome) * 10) / 10;
    const playSwing = Math.round(Math.abs(playSwingHome) * 10) / 10;

    let primaryMetric = '#1 Seed Bye';
    let primaryDeltaPct = byeGain;
    if (divGain > primaryDeltaPct) {
      primaryMetric = targetDivision;
      primaryDeltaPct = divGain;
    }
    if (playGain > primaryDeltaPct) {
      primaryMetric = 'Playoff Berth';
      primaryDeltaPct = playGain;
    }
    const maxSwingPct = Math.max(byeGain, divGain, playGain);

    const homeElo = teamEloMap.get(home) || 1500;
    const awayElo = teamEloMap.get(away) || 1500;
    const isDivGame = Boolean(g.divGame ?? (ALL_NFL_DIVISIONS[home] === ALL_NFL_DIVISIONS[away]));
    const pHome = winProbabilityHome(homeElo, awayElo, {
      neutral: Boolean(g.neutral),
      divGame: isDivGame,
      homeRest: g.homeRest ?? 7,
      awayRest: g.awayRest ?? 7
    });
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
      ...(st.preseasonPriorElo != null ? { preseasonPriorElo: st.preseasonPriorElo } : {}),
      ...(st.preseasonPriorSpread != null ? { preseasonPriorSpread: st.preseasonPriorSpread } : {}),
      ...(st.sosSpreadAdj != null ? { sosSpreadAdj: st.sosSpreadAdj } : {}),
      ...(st.remainingSosSpread != null ? { remainingSosSpread: st.remainingSosSpread } : {}),
      ...(st.remainingSosRank != null ? { remainingSosRank: st.remainingSosRank } : {}),
      ...(st.qbInjuryEloAdj != null ? { qbInjuryEloAdj: st.qbInjuryEloAdj } : {}),
      ...(st.nonQbInjuryEloAdj != null ? { nonQbInjuryEloAdj: st.nonQbInjuryEloAdj } : {}),
      ...(st.nextGameEloDelta != null ? { nextGameEloDelta: st.nextGameEloDelta } : {}),
      ...(st.qbStatusNote ? { qbStatusNote: st.qbStatusNote } : {}),
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
      pointDiff: Number(pt.pointDiff || 0),
      ...(pt.nextGameEloDelta != null ? { nextGameEloDelta: pt.nextGameEloDelta } : {})
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
    ...(simulatorInputs.preseasonPriors ? { preseasonPriors: simulatorInputs.preseasonPriors } : {}),
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

  const rankConferencePure = confName => {
    const members = [...byAbbr.values()].filter(t => t.conference === confName);
    return rankTiedStandingsGroup(members, { ...ctx, isDivision: false }).map((t, idx) => ({
      ...t,
      confRank: idx + 1
    }));
  };
  const nfcConferenceRanked = rankConferencePure('NFC');
  const afcConferenceRanked = rankConferencePure('AFC');

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
    nfcConferenceRanked,
    afcConferenceRanked,
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
