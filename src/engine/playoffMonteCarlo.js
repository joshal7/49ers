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
  'NFC West': ['SF', 'SEA', 'LAR', 'ARI'],
  'NFC North': ['DET', 'MIN', 'GB', 'CHI'],
  'NFC East': ['PHI', 'DAL', 'NYG', 'WAS'],
  'NFC South': ['TB', 'NO', 'ATL', 'CAR']
};

const ALL_AFC_TEAMS = [
  'BUF', 'MIA', 'NE', 'NYJ',
  'BAL', 'CIN', 'CLE', 'PIT',
  'HOU', 'IND', 'JAX', 'TEN',
  'DEN', 'KC', 'LV', 'LAC'
];

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
  netEpaPerGame = null,
  sosSpreadAdj = 0
} = {}) {
  const gp = Math.max(0, Number(wins || 0) + Number(losses || 0) + Number(ties || 0));
  if (gp === 0) return 1500;

  const winPct = (Number(wins || 0) + 0.5 * Number(ties || 0)) / gp;
  const rawPdGm = Number(pointDiff || 0) / gp;
  const cappedPdGm = Math.tanh(rawPdGm / 15) * 15;
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
    nfcTeams = [],
    afcPowerRatings = {},
    afcStandings = {},
    completedGames = [],
    remainingGames = [],
    forcedWinners = {},
    iterations = 10000,
    seed = 492026
  } = config;

  if (!Array.isArray(nfcTeams) || nfcTeams.length === 0) {
    return { iterations: 0, sfOdds: null, allTeamOdds: [] };
  }

  const rand = mulberry32(seed);
  const nTeams = nfcTeams.length; // 16 NFC clubs (indices 0..15)

  // Build unified 32-team index space: 0..nTeams-1 = NFC, nTeams..31 = AFC
  const abbrToIdx = new Map();
  nfcTeams.forEach((t, idx) => abbrToIdx.set(normalizeTeamAbbr(t.abbr), idx));
  let nextIdx = nTeams;
  for (const afcAbbr of ALL_AFC_TEAMS) {
    const norm = normalizeTeamAbbr(afcAbbr);
    if (!abbrToIdx.has(norm)) abbrToIdx.set(norm, nextIdx++);
  }
  const totalTeams = nextIdx; // 32

  const divIndexOf = new Int8Array(nTeams);
  const divNames = Object.keys(NFC_DIVISIONS);
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

  nfcTeams.forEach((t, i) => {
    const dIdx = Math.max(0, divNames.indexOf(t.division));
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
        netEpaPerGame: t.netEpaPerGame ?? null
      });
  });

  for (const [abbr, idx] of abbrToIdx.entries()) {
    if (idx < nTeams) continue;
    const afcRec = afcStandings[abbr] || null;
    elo[idx] = afcPowerRatings[abbr] || 1500;
    if (afcRec) {
      baseW[idx] = afcRec.wins || 0;
      baseL[idx] = afcRec.losses || 0;
      baseT[idx] = afcRec.ties || 0;
    }
  }

  // Pre-compute baseline H2H & opponent game counts across all 32 teams (stride = 32)
  // For NFC club i (0..15) and opponent opp (0..31):
  //   h2hPts[i * 32 + opp] stores 2 * wins + 1 * ties against `opp` (integer half-wins for exact arithmetic!)
  //   h2hGames[i * 32 + opp] stores games played against `opp`
  //   h2hBeatWins[i * 32 + opp] stores integer wins by `i` over `opp` (for Strength of Victory)
  const STRIDE = 32;
  const baseH2hPts = new Uint8Array(nTeams * STRIDE);
  const baseH2hGames = new Uint8Array(nTeams * STRIDE);
  const baseH2hBeatWins = new Uint8Array(nTeams * STRIDE);

  // Track AFC wins/losses from completedGames if afcStandings wasn't explicitly supplied
  const hasExplicitAfcStandings = Object.keys(afcStandings || {}).length > 0;

  for (const cg of completedGames) {
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

  // Pre-compile remaining games involving at least one valid team, sorted chronologically by week
  const sortedRemGames = [...remainingGames].sort((a, b) => Number(a.week || 0) - Number(b.week || 0));
  const compiledGames = [];
  for (const g of sortedRemGames) {
    const hAbbr = normalizeTeamAbbr(g.home);
    const aAbbr = normalizeTeamAbbr(g.away);
    const hi = abbrToIdx.get(hAbbr);
    const ai = abbrToIdx.get(aAbbr);
    if (hi === undefined || ai === undefined) continue;
    if (hi >= nTeams && ai >= nTeams) continue;

    const bothNfc = hi < nTeams && ai < nTeams;
    const sameDiv = bothNfc && divIndexOf[hi] === divIndexOf[ai];
    const hfa = g.neutral ? 0 : HOME_FIELD_ELO_ADV;

    let forcedCode = 0; // 0 = simulate, 1 = HOME, 2 = AWAY, 3 = TIE
    const fw = forcedWinners[g.id];
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
    let weightedWins = 0;
    let totalVictories = 0;
    for (let opp = 0; opp < totalTeams; opp++) {
      const bw = h2hBeatWins[baseOff + opp];
      if (bw > 0) {
        weightedWins += bw * oppWinPct[opp];
        totalVictories += bw;
      }
    }
    return totalVictories > 0 ? weightedWins / totalVictories : 0;
  }

  function computeStrengthOfSchedule(c) {
    const baseOff = c * STRIDE;
    let weightedGames = 0;
    let totalGames = 0;
    for (let opp = 0; opp < totalTeams; opp++) {
      const gm = h2hGames[baseOff + opp];
      if (gm > 0) {
        weightedGames += gm * oppWinPct[opp];
        totalGames += gm;
      }
    }
    return totalGames > 0 ? weightedGames / totalGames : 0.5;
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

      let outcome; // 1 = HOME, 2 = AWAY, 3 = TIE
      if (g.forcedCode !== 0) {
        outcome = g.forcedCode;
      } else {
        const pTie = 0.0036 * 4 * pHomeRaw * (1 - pHomeRaw);
        const pHomeWin = pHomeRaw * (1 - pTie);
        const u = rand();
        outcome = u < pHomeWin ? 1 : u < pHomeWin + pTie ? 3 : 2;
      }

      // Dynamic weekly Elo update (captures hot/cold streaks & injury shocks across remaining weeks)
      const actualHome = outcome === 1 ? 1.0 : outcome === 2 ? 0.0 : 0.5;
      const deltaElo = IN_SEASON_ELO_K * (actualHome - pHomeRaw);
      simElo[hi] += deltaElo;
      simElo[ai] -= deltaElo;

      if (outcome === 1) {
        w[hi]++;
        l[ai]++;
        const margin = Math.max(1, Math.round(Math.abs(expectedMargin) + rand() * 9));
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
        const margin = Math.max(1, Math.round(Math.abs(-expectedMargin) + rand() * 9));
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

  const allTeamOdds = nfcTeams.map((t, i) => {
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
      division: t.division,
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

  const sfOdds = allTeamOdds.find(x => normalizeTeamAbbr(x.abbr) === 'SF') || allTeamOdds[0];

  return {
    iterations,
    sfOdds,
    allTeamOdds
  };
}

/**
 * Computes Rooting Guide leverage for upcoming NFL games by measuring the marginal swing in
 * SF #1 Seed Bye %, SF NFC West Division %, and SF Playoff Berth % if HOME wins vs AWAY wins.
 * Supports either `(baseConfig, maxCountNumber)` or `(baseConfig, targetWeekGamesArray)`.
 */
export function computeRootingGuideLeverage(baseConfig, targetOrMaxCount = 12) {
  const nfcSet = new Set((baseConfig?.nfcTeams || []).map(t => normalizeTeamAbbr(t.abbr)));
  let candidateGames = [];
  let maxOut = 12;

  if (Array.isArray(targetOrMaxCount)) {
    candidateGames = targetOrMaxCount;
    maxOut = targetOrMaxCount.length || 12;
  } else {
    maxOut = Math.max(1, Number(targetOrMaxCount) || 12);
    const rem = Array.isArray(baseConfig?.remainingGames) ? baseConfig.remainingGames : [];
    const sortedWeeks = [...new Set(rem.map(g => Number(g.week || 0)).filter(Boolean))].sort(
      (a, b) => a - b
    );
    const nextTwoWeeks = new Set(sortedWeeks.slice(0, 2));
    candidateGames = rem.filter(g => {
      const h = normalizeTeamAbbr(g.home);
      const a = normalizeTeamAbbr(g.away);
      return nextTwoWeeks.has(Number(g.week)) && (nfcSet.has(h) || nfcSet.has(a));
    });
  }

  const results = [];
  for (const g of candidateGames) {
    const home = normalizeTeamAbbr(g.home);
    const away = normalizeTeamAbbr(g.away);
    const homeSim = runPlayoffMonteCarlo({
      ...baseConfig,
      forcedWinners: { ...(baseConfig.forcedWinners || {}), [g.id]: 'HOME' },
      iterations: 2500,
      seed: 777
    });
    const awaySim = runPlayoffMonteCarlo({
      ...baseConfig,
      forcedWinners: { ...(baseConfig.forcedWinners || {}), [g.id]: 'AWAY' },
      iterations: 2500,
      seed: 777
    });

    const homeSf = homeSim.sfOdds;
    const awaySf = awaySim.sfOdds;
    if (!homeSf || !awaySf) continue;

    const byeSwingHome = homeSf.seed1ByePct - awaySf.seed1ByePct;
    const divSwingHome = homeSf.winDivisionPct - awaySf.winDivisionPct;
    const playSwingHome = homeSf.makePlayoffsPct - awaySf.makePlayoffsPct;

    const is49ersGame = home === 'SF' || away === 'SF';
    const compositeHomeEdge = is49ersGame
      ? home === 'SF'
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
      primaryMetric = 'NFC West';
      primaryDeltaPct = divSwing;
    }
    if (playSwing > primaryDeltaPct) {
      primaryMetric = 'Playoff Berth';
      primaryDeltaPct = playSwing;
    }
    const maxSwingPct = Math.max(byeSwing, divSwing, playSwing);

    results.push({
      gameId: g.id,
      week: g.week,
      matchupLabel: `${away} @ ${home}`,
      away,
      home,
      is49ersGame,
      recommendedWinner: rootSide,
      rootForTeam: rootFor,
      rootAgainstTeam: rootAgainst,
      rootFor,
      rootSide,
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

  return results
    .sort((a, b) => b.maxSwingPct - a.maxSwingPct || b.totalLeverageScore - a.totalLeverageScore)
    .slice(0, maxOut);
}
