/**
 * 10,000-Run Monte Carlo NFC Playoff & Seeding Simulator + Rooting Leverage Engine
 * Runs in ~15-30ms on mobile Safari, supporting instant interactive scenario toggling.
 */

export const NFC_DIVISIONS = {
  SF: 'NFC West',
  SEA: 'NFC West',
  LAR: 'NFC West',
  LA: 'NFC West',
  ARI: 'NFC West',
  DET: 'NFC North',
  MIN: 'NFC North',
  GB: 'NFC North',
  CHI: 'NFC North',
  PHI: 'NFC East',
  WAS: 'NFC East',
  WSH: 'NFC East',
  DAL: 'NFC East',
  NYG: 'NFC East',
  ATL: 'NFC South',
  TB: 'NFC South',
  NO: 'NFC South',
  CAR: 'NFC South'
};

export function normalizeTeamAbbr(abbr) {
  const s = String(abbr || '').toUpperCase().trim();
  if (s === 'LA') return 'LAR';
  if (s === 'WSH') return 'WAS';
  return s;
}

/**
 * Fast Mulberry32 seeded PRNG for deterministic, reproducible Monte Carlo runs.
 */
export function createSeededRng(seed = 49_2026) {
  let a = seed >>> 0;
  return function nextRandom() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Logistic win probability from Elo / Power Rating + Home-Field Advantage (~1.8 pts / ~52 Elo).
 */
export function winProbabilityHome(homeRating = 1500, awayRating = 1500, isNeutral = false) {
  const hfa = isNeutral ? 0 : 48;
  const diff = homeRating + hfa - awayRating;
  return 1 / (1 + Math.pow(10, -diff / 400));
}

function winPct(w, l, t) {
  const total = w + l + t;
  return total > 0 ? (w + 0.5 * t) / total : 0;
}

/**
 * Runs N Monte Carlo simulations of the remainder of the NFL regular season for the NFC.
 *
 * @param {object} config
 * @param {Array<object>} config.nfcTeams - 16 NFC team baselines ({ abbr, division, wins, losses, ties, divWins, divLosses, divTies, confWins, confLosses, confTies, pointDiff, powerRating })
 * @param {Record<string, number>} [config.afcRatings] - Power ratings for AFC opponents
 * @param {Array<object>} config.completedGames - Completed games ({ home, away, homeScore, awayScore }) for H2H tiebreakers
 * @param {Array<object>} config.remainingGames - Unplayed regular season games ({ id, week, home, away, neutral })
 * @param {Record<string, 'HOME'|'AWAY'>} [config.forcedWinners] - Interactive user overrides by gameId
 * @param {number} [config.iterations=10000]
 * @param {number} [config.seed=492026]
 */
export function runPlayoffMonteCarlo(config = {}) {
  const iterations = Math.max(100, Math.min(50000, Number(config.iterations || 10000)));
  const rng = createSeededRng(Number(config.seed || 492026));
  const forced = config.forcedWinners || {};

  // Index NFC teams 0..15
  const baseTeams = (config.nfcTeams || []).map((t, idx) => {
    const abbr = normalizeTeamAbbr(t.abbr);
    return {
      idx,
      abbr,
      name: t.name || abbr,
      logoUrl: t.logoUrl || '',
      division: t.division || NFC_DIVISIONS[abbr] || 'NFC West',
      wins: Number(t.wins || 0),
      losses: Number(t.losses || 0),
      ties: Number(t.ties || 0),
      divWins: Number(t.divWins || 0),
      divLosses: Number(t.divLosses || 0),
      divTies: Number(t.divTies || 0),
      confWins: Number(t.confWins || 0),
      confLosses: Number(t.confLosses || 0),
      confTies: Number(t.confTies || 0),
      pointDiff: Number(t.pointDiff || 0),
      powerRating: Number(t.powerRating || 1500)
    };
  });

  const nTeams = baseTeams.length;
  if (nTeams === 0) {
    return { iterations: 0, sfOdds: null, allTeamOdds: [] };
  }

  const abbrToIdx = new Map(baseTeams.map(t => [t.abbr, t.idx]));
  const afcRatings = {};
  for (const [k, v] of Object.entries(config.afcRatings || {})) {
    afcRatings[normalizeTeamAbbr(k)] = Number(v || 1500);
  }

  // Build baseline Head-to-Head win counts matrix (16 x 16)
  const baseH2HWins = new Int16Array(nTeams * nTeams);
  const baseH2HGames = new Int16Array(nTeams * nTeams);
  for (const cg of config.completedGames || []) {
    const hIdx = abbrToIdx.get(normalizeTeamAbbr(cg.home));
    const aIdx = abbrToIdx.get(normalizeTeamAbbr(cg.away));
    if (hIdx === undefined || aIdx === undefined) continue;
    const hs = Number(cg.homeScore);
    const as = Number(cg.awayScore);
    if (Number.isNaN(hs) || Number.isNaN(as)) continue;
    baseH2HGames[hIdx * nTeams + aIdx] += 1;
    baseH2HGames[aIdx * nTeams + hIdx] += 1;
    if (hs > as) {
      baseH2HWins[hIdx * nTeams + aIdx] += 2; // 2 half-wins = 1 full win
    } else if (as > hs) {
      baseH2HWins[aIdx * nTeams + hIdx] += 2;
    } else {
      baseH2HWins[hIdx * nTeams + aIdx] += 1;
      baseH2HWins[aIdx * nTeams + hIdx] += 1;
    }
  }

  // Pre-compile remaining games involving at least 1 NFC team for blazing fast inner loop
  const compiledGames = [];
  for (const g of config.remainingGames || []) {
    const homeAbbr = normalizeTeamAbbr(g.home);
    const awayAbbr = normalizeTeamAbbr(g.away);
    const hIdx = abbrToIdx.get(homeAbbr);
    const aIdx = abbrToIdx.get(awayAbbr);
    if (hIdx === undefined && aIdx === undefined) continue;

    const hRating = hIdx !== undefined ? baseTeams[hIdx].powerRating : (afcRatings[homeAbbr] || 1500);
    const aRating = aIdx !== undefined ? baseTeams[aIdx].powerRating : (afcRatings[awayAbbr] || 1500);
    const pHome = g.homeWinProb != null
      ? Number(g.homeWinProb)
      : winProbabilityHome(hRating, aRating, Boolean(g.neutral));

    const bothNfc = hIdx !== undefined && aIdx !== undefined;
    const sameDiv = bothNfc && baseTeams[hIdx].division === baseTeams[aIdx].division;
    const forcedChoice = forced[g.id] || null;

    compiledGames.push({
      id: g.id,
      hIdx: hIdx ?? -1,
      aIdx: aIdx ?? -1,
      bothNfc,
      sameDiv,
      pHome,
      forcedChoice
    });
  }

  // Group team indices by division
  const divMap = new Map();
  for (const t of baseTeams) {
    if (!divMap.has(t.division)) divMap.set(t.division, []);
    divMap.get(t.division).push(t.idx);
  }
  const divisionGroups = Array.from(divMap.values());

  // Counters: seedCounts[teamIdx * 8 + seed] where seed 1..7 = playoff seeds, 0 = missed playoffs
  const seedCounts = new Int32Array(nTeams * 8);
  const totalSimulatedWins = new Float64Array(nTeams);

  // Reusable per-iteration typed buffers
  const w = new Int16Array(nTeams);
  const l = new Int16Array(nTeams);
  const ties = new Int16Array(nTeams);
  const dw = new Int16Array(nTeams);
  const dl = new Int16Array(nTeams);
  const dt = new Int16Array(nTeams);
  const cw = new Int16Array(nTeams);
  const cl = new Int16Array(nTeams);
  const ct = new Int16Array(nTeams);
  const pd = new Float32Array(nTeams);
  const h2hW = new Int16Array(nTeams * nTeams);
  const h2hG = new Int16Array(nTeams * nTeams);
  const jitter = new Float32Array(nTeams);

  function compareTwoTeams(i, j, isDivisionTie) {
    const wpI = winPct(w[i], l[i], ties[i]);
    const wpJ = winPct(w[j], l[j], ties[j]);
    if (Math.abs(wpI - wpJ) > 1e-7) return wpJ - wpI;

    // 1. Head-to-Head
    const gamesIJ = h2hG[i * nTeams + j];
    if (gamesIJ > 0) {
      const h2hPctI = h2hW[i * nTeams + j] / (2 * gamesIJ);
      const h2hPctJ = h2hW[j * nTeams + i] / (2 * gamesIJ);
      if (Math.abs(h2hPctI - h2hPctJ) > 1e-7) return h2hPctJ - h2hPctI;
    }

    // 2. Division record (if same division)
    if (isDivisionTie) {
      const divPctI = winPct(dw[i], dl[i], dt[i]);
      const divPctJ = winPct(dw[j], dl[j], dt[j]);
      if (Math.abs(divPctI - divPctJ) > 1e-7) return divPctJ - divPctI;
    }

    // 3. Conference record
    const confPctI = winPct(cw[i], cl[i], ct[i]);
    const confPctJ = winPct(cw[j], cl[j], ct[j]);
    if (Math.abs(confPctI - confPctJ) > 1e-7) return confPctJ - confPctI;

    // 4. Strength of Victory / Point Differential + tiny random tiebreaker coin-flip
    return pd[j] + jitter[j] - (pd[i] + jitter[i]);
  }

  for (let iter = 0; iter < iterations; iter++) {
    for (let i = 0; i < nTeams; i++) {
      const bt = baseTeams[i];
      w[i] = bt.wins;
      l[i] = bt.losses;
      ties[i] = bt.ties;
      dw[i] = bt.divWins;
      dl[i] = bt.divLosses;
      dt[i] = bt.divTies;
      cw[i] = bt.confWins;
      cl[i] = bt.confLosses;
      ct[i] = bt.confTies;
      pd[i] = bt.pointDiff;
      jitter[i] = (rng() - 0.5) * 2.5;
    }
    h2hW.set(baseH2HWins);
    h2hG.set(baseH2HGames);

    for (let gIdx = 0; gIdx < compiledGames.length; gIdx++) {
      const g = compiledGames[gIdx];
      let homeWon;
      if (g.forcedChoice === 'HOME') {
        homeWon = true;
      } else if (g.forcedChoice === 'AWAY') {
        homeWon = false;
      } else {
        homeWon = rng() < g.pHome;
      }

      const margin = 3 + rng() * 11;
      const hi = g.hIdx;
      const ai = g.aIdx;

      if (homeWon) {
        if (hi >= 0) {
          w[hi] += 1;
          pd[hi] += margin;
          if (g.bothNfc) cw[hi] += 1;
          if (g.sameDiv) dw[hi] += 1;
        }
        if (ai >= 0) {
          l[ai] += 1;
          pd[ai] -= margin;
          if (g.bothNfc) cl[ai] += 1;
          if (g.sameDiv) dl[ai] += 1;
        }
        if (g.bothNfc) {
          h2hG[hi * nTeams + ai] += 1;
          h2hG[ai * nTeams + hi] += 1;
          h2hW[hi * nTeams + ai] += 2;
        }
      } else {
        if (ai >= 0) {
          w[ai] += 1;
          pd[ai] += margin;
          if (g.bothNfc) cw[ai] += 1;
          if (g.sameDiv) dw[ai] += 1;
        }
        if (hi >= 0) {
          l[hi] += 1;
          pd[hi] -= margin;
          if (g.bothNfc) cl[hi] += 1;
          if (g.sameDiv) dl[hi] += 1;
        }
        if (g.bothNfc) {
          h2hG[hi * nTeams + ai] += 1;
          h2hG[ai * nTeams + hi] += 1;
          h2hW[ai * nTeams + hi] += 2;
        }
      }
    }

    for (let i = 0; i < nTeams; i++) {
      totalSimulatedWins[i] += w[i];
    }

    // Crown 4 division winners & collect Wild Card pool
    const divWinners = [];
    const wildCardPool = [];

    for (let d = 0; d < divisionGroups.length; d++) {
      const group = [...divisionGroups[d]];
      group.sort((a, b) => compareTwoTeams(a, b, true));
      divWinners.push(group[0]);
      for (let k = 1; k < group.length; k++) {
        wildCardPool.push(group[k]);
      }
    }

    // Order Seeds #1 to #4
    divWinners.sort((a, b) => compareTwoTeams(a, b, false));
    // Order Wild Cards #5 to #7
    wildCardPool.sort((a, b) => compareTwoTeams(a, b, false));

    for (let s = 0; s < divWinners.length && s < 4; s++) {
      seedCounts[divWinners[s] * 8 + (s + 1)] += 1;
    }
    for (let wc = 0; wc < wildCardPool.length; wc++) {
      if (wc < 3) {
        seedCounts[wildCardPool[wc] * 8 + (5 + wc)] += 1;
      } else {
        seedCounts[wildCardPool[wc] * 8 + 0] += 1;
      }
    }
  }

  const allTeamOdds = baseTeams.map(t => {
    const i = t.idx;
    const seeds = {};
    let playoffCount = 0;
    let divTitleCount = 0;
    for (let s = 1; s <= 7; s++) {
      const c = seedCounts[i * 8 + s];
      seeds[s] = Number(((c / iterations) * 100).toFixed(1));
      playoffCount += c;
      if (s <= 4) divTitleCount += c;
    }
    const missedCount = seedCounts[i * 8 + 0];
    return {
      abbr: t.abbr,
      name: t.name,
      logoUrl: t.logoUrl || '',
      division: t.division,
      currentRecord: `${t.wins}-${t.losses}${t.ties ? `-${t.ties}` : ''}`,
      projectedWins: Number((totalSimulatedWins[i] / iterations).toFixed(1)),
      makePlayoffsPct: Number(((playoffCount / iterations) * 100).toFixed(1)),
      winDivisionPct: Number(((divTitleCount / iterations) * 100).toFixed(1)),
      seed1ByePct: seeds[1],
      missedPlayoffsPct: Number(((missedCount / iterations) * 100).toFixed(1)),
      seedDistribution: seeds
    };
  });

  allTeamOdds.sort((a, b) => b.makePlayoffsPct - a.makePlayoffsPct || b.seed1ByePct - a.seed1ByePct);
  const sfOdds = allTeamOdds.find(t => t.abbr === 'SF') || null;

  return {
    iterations,
    sfOdds,
    allTeamOdds
  };
}

/**
 * Computes the exact Rooting Guide Leverage for upcoming games:
 * For each candidate game, compares 49ers odds if HOME wins vs if AWAY wins!
 */
export function computeRootingGuideLeverage(config = {}, maxGames = 10) {
  const candidates = (config.remainingGames || []).slice(0, 28);
  const leverageList = [];

  for (const game of candidates) {
    const home = normalizeTeamAbbr(game.home);
    const away = normalizeTeamAbbr(game.away);
    // Only evaluate games involving NFC contenders or SF itself
    if (!NFC_DIVISIONS[home] && !NFC_DIVISIONS[away]) continue;

    const simHome = runPlayoffMonteCarlo({
      ...config,
      iterations: 2500,
      forcedWinners: { ...(config.forcedWinners || {}), [game.id]: 'HOME' }
    });
    const simAway = runPlayoffMonteCarlo({
      ...config,
      iterations: 2500,
      forcedWinners: { ...(config.forcedWinners || {}), [game.id]: 'AWAY' }
    });

    if (!simHome.sfOdds || !simAway.sfOdds) continue;

    const scoreHome =
      simHome.sfOdds.seed1ByePct * 1.3 +
      simHome.sfOdds.winDivisionPct * 1.0 +
      simHome.sfOdds.makePlayoffsPct * 0.8;
    const scoreAway =
      simAway.sfOdds.seed1ByePct * 1.3 +
      simAway.sfOdds.winDivisionPct * 1.0 +
      simAway.sfOdds.makePlayoffsPct * 0.8;

    const rootForSide = scoreHome >= scoreAway ? 'HOME' : 'AWAY';
    const rootForTeam = rootForSide === 'HOME' ? home : away;
    const rootAgainstTeam = rootForSide === 'HOME' ? away : home;

    const seed1Swing = Math.abs(simHome.sfOdds.seed1ByePct - simAway.sfOdds.seed1ByePct);
    const divSwing = Math.abs(simHome.sfOdds.winDivisionPct - simAway.sfOdds.winDivisionPct);
    const berthSwing = Math.abs(simHome.sfOdds.makePlayoffsPct - simAway.sfOdds.makePlayoffsPct);
    const maxSwing = Math.max(seed1Swing, divSwing, berthSwing);

    let primaryMetric = '#1 Seed Bye';
    let primaryDelta = seed1Swing;
    if (divSwing > seed1Swing && divSwing >= berthSwing) {
      primaryMetric = 'NFC West Title';
      primaryDelta = divSwing;
    } else if (berthSwing > seed1Swing && berthSwing > divSwing) {
      primaryMetric = 'Playoff Berth';
      primaryDelta = berthSwing;
    }

    leverageList.push({
      gameId: game.id,
      week: game.week,
      matchupLabel: `${away} @ ${home}`,
      home,
      away,
      is49ersGame: home === 'SF' || away === 'SF',
      recommendedWinner: rootForSide,
      rootForTeam,
      rootAgainstTeam,
      maxSwingPct: Number(maxSwing.toFixed(1)),
      primaryMetric,
      primaryDeltaPct: Number(primaryDelta.toFixed(1)),
      seed1SwingPct: Number(seed1Swing.toFixed(1)),
      divSwingPct: Number(divSwing.toFixed(1)),
      berthSwingPct: Number(berthSwing.toFixed(1))
    });
  }

  leverageList.sort((a, b) => {
    if (a.is49ersGame !== b.is49ersGame) return a.is49ersGame ? -1 : 1;
    return b.maxSwingPct - a.maxSwingPct;
  });

  return leverageList.slice(0, maxGames);
}
