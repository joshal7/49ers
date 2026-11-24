/**
 * Canonical Shared 32-Team Playoff Monte Carlo & League Seasonal Pipeline
 *
 * Single source of truth used by:
 *   - `scripts/fetch-live-49ers-data.mjs` (`49ers.joshal.com` -> `data/seasonal.json`)
 *   - `scripts/fetch-team-data.mjs` (31 other franchises -> `data/teams/<slug>/seasonal.json`)
 *   - `scripts/refresh-all-nfl-teams.mjs` (unified 32-team orchestrator & fast `--seasonal-only` resync)
 *
 * Performance & Latency Design:
 *   - Computes 32-team injury spread adjustments, Hierarchical Bayesian Iterative SRS + MOV-Elo
 *     power ratings, and the 10,000-iteration conference Monte Carlo baselines ONCE per conference
 *     (2 x 10k instead of 32 x 10k = 16x speedup with bit-for-bit identical probabilities).
 *   - Produces an identical, calibrated `PLAYOFF_MODEL_VERSION` (`2026.2-hb-srs-qb`) `playoffPicture`
 *     schema across ALL 32 teams so `49ers.joshal.com` and the other 31 `<team>.joshal.com` sites
 *     can never drift apart on Monte Carlo calibration, completed/remaining games, or injury priors.
 */

import fs from 'node:fs';
import path from 'node:path';
import {
  ALL_NFL_TEAMS,
  NFL_DIVISIONS,
  normalizeAnyTeamAbbr
} from '../../src/config/teamRegistry.js';
import {
  PLAYOFF_MODEL_VERSION,
  canonicalPlayoffGameKey,
  computeCalibratedTeamPowerRating,
  computeLeaguePowerRatings,
  computePreseasonPriorsFromHistory,
  computeRootingGuideLeverage,
  estimateTeamInjurySpreadAdjustments,
  reconcileAndDedupePlayoffGames,
  runPlayoffMonteCarlo
} from '../../src/engine/playoffMonteCarlo.js';
import { extractLiveScoreboardMap } from '../../src/engine/teamDeepDiveEngine.js';

const UA_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  Accept: 'application/json, text/plain, */*'
};

const TEAM_BY_ABBR = new Map(ALL_NFL_TEAMS.map(t => [normalizeAnyTeamAbbr(t.abbr), t]));

const ESPN_TEAM_NICK_TO_ABBR = new Map([
  ['49ers', 'SF'], ['seahawks', 'SEA'], ['rams', 'LAR'], ['cardinals', 'ARI'],
  ['lions', 'DET'], ['vikings', 'MIN'], ['packers', 'GB'], ['bears', 'CHI'],
  ['eagles', 'PHI'], ['cowboys', 'DAL'], ['giants', 'NYG'], ['commanders', 'WAS'],
  ['buccaneers', 'TB'], ['saints', 'NO'], ['falcons', 'ATL'], ['panthers', 'CAR'],
  ['bills', 'BUF'], ['dolphins', 'MIA'], ['patriots', 'NE'], ['jets', 'NYJ'],
  ['ravens', 'BAL'], ['bengals', 'CIN'], ['browns', 'CLE'], ['steelers', 'PIT'],
  ['texans', 'HOU'], ['colts', 'IND'], ['jaguars', 'JAX'], ['titans', 'TEN'],
  ['broncos', 'DEN'], ['chiefs', 'KC'], ['raiders', 'LV'], ['chargers', 'LAC']
]);

export function getTeamDataDir(rootDir, team) {
  const abbr = normalizeAnyTeamAbbr(team?.abbr || 'SF');
  if (abbr === 'SF') return path.join(rootDir, 'data');
  const slug = team?.slug || TEAM_BY_ABBR.get(abbr)?.slug || abbr.toLowerCase();
  return path.join(rootDir, 'data', 'teams', slug);
}

export function resolveCanonicalTeamLogoUrl(abbr, espnTeamObj = null) {
  const norm = normalizeAnyTeamAbbr(abbr || '');
  const liveLogo = espnTeamObj?.logos?.[0]?.href || espnTeamObj?.logo || '';
  if (liveLogo && /^https:\/\//i.test(liveLogo)) return liveLogo;
  const team = TEAM_BY_ABBR.get(norm);
  const espnCode = (team?.espnAbbr || norm || 'nfl').toLowerCase();
  return `https://a.espncdn.com/i/teamlogos/nfl/500/${espnCode}.png`;
}

async function fetchJsonSafe(url, timeoutMs = 10000) {
  try {
    const res = await fetch(url, { headers: UA_HEADERS, signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

async function fetchTextSafe(url, timeoutMs = 14000) {
  try {
    const res = await fetch(url, { headers: UA_HEADERS, signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) return '';
    return await res.text();
  } catch {
    return '';
  }
}

function parseSimpleCsv(text = '') {
  const lines = String(text || '').split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) return [];
  const parseLine = line => {
    const out = [];
    let cur = '';
    let inQ = false;
    for (let i = 0; i < line.length; i += 1) {
      const ch = line[i];
      if (ch === '"') {
        if (inQ && line[i + 1] === '"') {
          cur += '"';
          i += 1;
        } else {
          inQ = !inQ;
        }
      } else if (ch === ',' && !inQ) {
        out.push(cur);
        cur = '';
      } else {
        cur += ch;
      }
    }
    out.push(cur);
    return out;
  };
  const headers = parseLine(lines[0]);
  const rows = [];
  for (let i = 1; i < lines.length; i += 1) {
    const cols = parseLine(lines[i]);
    if (cols.length < 2) continue;
    const obj = {};
    for (let j = 0; j < headers.length; j += 1) {
      obj[headers[j]] = cols[j] ?? '';
    }
    rows.push(obj);
  }
  return rows;
}

function readJsonSafe(filePath) {
  try {
    if (!fs.existsSync(filePath)) return null;
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function parseWltStr(str) {
  const p = String(str || '0-0')
    .split('-')
    .map(x => Number(x) || 0);
  return { w: p[0] || 0, l: p[1] || 0, t: p[2] || 0 };
}

/**
 * Parses ESPN 32-team standings response into a normalized `Map<abbr, StandingDetail>`.
 */
export function parseEspnStandingsToMap(standingsRaw) {
  const map = new Map();
  for (const conf of standingsRaw?.children || []) {
    const confName = /american|afc/i.test(conf.name || conf.abbreviation || '') ? 'AFC' : 'NFC';
    for (const entry of conf.standings?.entries || []) {
      const abbr = normalizeAnyTeamAbbr(entry.team?.abbreviation || '');
      if (!abbr) continue;
      const getStat = n => entry.stats?.find(s => s.name === n);
      const wins = Number(getStat('wins')?.value || 0);
      const losses = Number(getStat('losses')?.value || 0);
      const ties = Number(getStat('ties')?.value || 0);
      const pf = Number(getStat('pointsFor')?.value || 0);
      const pa = Number(getStat('pointsAgainst')?.value || 0);
      const pd = Number(getStat('pointDifferential')?.value ?? (pf - pa));
      const winPct = Number(getStat('winPercent')?.value || 0);
      const seed = Number(getStat('playoffSeed')?.value || 0) || null;
      const divRec = getStat('vs. Div.')?.displayValue || getStat('divisionRecord')?.displayValue || '0-0';
      const confRec = getStat('vs. Conf.')?.displayValue || getStat('conferenceRecord')?.displayValue || '0-0';
      const homeRec = getStat('Home')?.displayValue || getStat('home')?.displayValue || '';
      const awayRec =
        getStat('Road')?.displayValue ||
        getStat('Away')?.displayValue ||
        getStat('away')?.displayValue ||
        '';
      const streak = getStat('streak')?.displayValue || '';
      const clincher = getStat('clincher')?.displayValue || '';
      const record = getStat('overall')?.displayValue || `${wins}-${losses}${ties ? `-${ties}` : ''}`;
      const teamCfg = TEAM_BY_ABBR.get(abbr);
      map.set(abbr, {
        abbr,
        name: entry.team?.displayName || teamCfg?.fullName || abbr,
        logoUrl: resolveCanonicalTeamLogoUrl(abbr, entry.team),
        conference: teamCfg?.conference || confName,
        division: teamCfg?.division || NFL_DIVISIONS[abbr] || `${confName} East`,
        wins,
        losses,
        ties,
        pf,
        pa,
        pd,
        winPct,
        seed,
        record,
        divRec,
        confRec,
        homeRec,
        awayRec,
        streak,
        clincher
      });
    }
  }
  return map;
}

/**
 * Reconciles a base 272-game league schedule with live ESPN scoreboard payloads so all 32 teams
 * observe the exact same `completedGames` and `remainingGames` with zero duplicate/stale games.
 */
export function reconcileLeagueScheduleWithScoreboards(
  baseCompleted = [],
  baseRemaining = [],
  scoreboardPayloads = []
) {
  const seeded = reconcileAndDedupePlayoffGames(baseCompleted, baseRemaining);
  const completedByKey = new Map();
  for (const g of seeded.completedGames) {
    const key = canonicalPlayoffGameKey(g) || String(g.id);
    completedByKey.set(key, g);
  }
  const remainingByKey = new Map();
  for (const g of seeded.remainingGames) {
    const key = canonicalPlayoffGameKey(g) || String(g.id);
    if (!completedByKey.has(key)) remainingByKey.set(key, g);
  }

  const liveScoresByMatchup = {};
  for (const sb of scoreboardPayloads || []) {
    if (!sb) continue;
    Object.assign(liveScoresByMatchup, extractLiveScoreboardMap(sb));
    for (const ev of sb?.events || []) {
      const comp = ev.competitions?.[0];
      if (!comp) continue;
      const homeC = (comp.competitors || []).find(c => c.homeAway === 'home');
      const awayC = (comp.competitors || []).find(c => c.homeAway === 'away');
      if (!homeC || !awayC) continue;
      const home = normalizeAnyTeamAbbr(homeC.team?.abbreviation || '');
      const away = normalizeAnyTeamAbbr(awayC.team?.abbreviation || '');
      const wk = Number(ev.week?.number || sb?.week?.number || 1);
      const fallbackId = String(ev.id || `w${wk}_${away}_${home}`);
      const key = canonicalPlayoffGameKey({ week: wk, home, away, id: fallbackId }) || fallbackId;
      const existingRem = remainingByKey.get(key);
      const existingComp = completedByKey.get(key);
      const baseMeta = existingRem || existingComp || {};
      const id = String(baseMeta.id || fallbackId);
      const completed = Boolean(comp.status?.type?.completed);
      if (completed) {
        remainingByKey.delete(key);
        completedByKey.set(key, {
          ...baseMeta,
          id,
          week: wk,
          home: baseMeta.home || home,
          away: baseMeta.away || away,
          homeScore: Number(homeC.score || 0),
          awayScore: Number(awayC.score || 0)
        });
      } else if (!completedByKey.has(key)) {
        remainingByKey.set(key, {
          ...baseMeta,
          id,
          week: wk,
          home: baseMeta.home || home,
          away: baseMeta.away || away,
          neutral: Boolean(comp.neutralSite || baseMeta.neutral)
        });
      }
    }
  }

  const reconciled = reconcileAndDedupePlayoffGames(
    [...completedByKey.values()],
    [...remainingByKey.values()]
  );
  return {
    completedGames: reconciled.completedGames,
    remainingGames: reconciled.remainingGames,
    liveScoresByMatchup
  };
}

/**
 * Computes 32-team QB1 + non-QB injury spread adjustments uniformly across all 32 teams,
 * combining each team's local `health.json` + `roster.json` (or in-memory override) with
 * live ESPN league injuries so SF and all 31 other teams share identical injury calibration.
 */
export function computeAll32TeamInjuryAdjustments({
  rootDir,
  completedGames = [],
  remainingGames = [],
  espnInjuriesRaw = null,
  qbRatingsById = null,
  currentStarterNameByTeam = {},
  inMemoryHealthByAbbr = {},
  inMemoryRosterByAbbr = {}
} = {}) {
  const remCountByTeam = new Map();
  for (const rg of remainingGames || []) {
    const h = normalizeAnyTeamAbbr(rg.home);
    const a = normalizeAnyTeamAbbr(rg.away);
    if (h) remCountByTeam.set(h, (remCountByTeam.get(h) || 0) + 1);
    if (a) remCountByTeam.set(a, (remCountByTeam.get(a) || 0) + 1);
  }
  const gpByTeam = new Map();
  for (const cg of completedGames || []) {
    const h = normalizeAnyTeamAbbr(cg.home);
    const a = normalizeAnyTeamAbbr(cg.away);
    if (h) gpByTeam.set(h, (gpByTeam.get(h) || 0) + 1);
    if (a) gpByTeam.set(a, (gpByTeam.get(a) || 0) + 1);
  }

  // Index live ESPN injuries by team abbr
  const espnHealthByAbbr = new Map();
  for (const teamEntry of espnInjuriesRaw?.injuries || []) {
    const dispLower = String(teamEntry?.displayName || '').toLowerCase();
    let abbr = null;
    for (const [nick, code] of ESPN_TEAM_NICK_TO_ABBR.entries()) {
      if (dispLower.includes(nick)) {
        abbr = code;
        break;
      }
    }
    if (!abbr) continue;
    const injList = [];
    const irList = [];
    const qbStarterName = currentStarterNameByTeam[abbr] || '';
    for (const item of teamEntry.injuries || []) {
      const nm = item.athlete?.displayName || '';
      const pos = item.athlete?.position?.abbreviation || '';
      const st = String(item.status || '');
      const row = {
        name: nm,
        position: pos,
        status: st,
        gameStatus: st,
        notes: `${item.shortComment || ''} ${item.longComment || ''}`.trim(),
        isStarter: Boolean(qbStarterName && pos === 'QB' && nm.toLowerCase() === qbStarterName.toLowerCase())
      };
      if (/injured reserve|ir|pup|nfi/i.test(st)) irList.push(row);
      else injList.push(row);
    }
    espnHealthByAbbr.set(abbr, { injuryReport: injList, irReserve: irList });
  }

  const injuryAdjustmentsByTeam = {};
  for (const team of ALL_NFL_TEAMS) {
    const abbr = normalizeAnyTeamAbbr(team.abbr);
    const teamDir = rootDir ? getTeamDataDir(rootDir, team) : null;

    let rosterPlayers = inMemoryRosterByAbbr[abbr] || null;
    if (!rosterPlayers && teamDir) {
      const rp = readJsonSafe(path.join(teamDir, 'roster.json'));
      rosterPlayers = Array.isArray(rp?.players) ? rp.players : [];
    }

    let healthData = inMemoryHealthByAbbr[abbr] || null;
    if (!healthData) {
      const espnHealth = espnHealthByAbbr.get(abbr) || null;
      const diskHealth = teamDir ? readJsonSafe(path.join(teamDir, 'health.json')) : null;
      if (diskHealth && (Array.isArray(diskHealth.practiceReport) || Array.isArray(diskHealth.irAndReserveTracker))) {
        healthData = {
          practiceReport: diskHealth.practiceReport || [],
          irReserve: diskHealth.irAndReserveTracker || diskHealth.irReserve || [],
          ...(espnHealth?.injuryReport?.length && !(diskHealth.practiceReport || []).length
            ? { injuryReport: espnHealth.injuryReport }
            : {})
        };
      } else if (espnHealth) {
        healthData = espnHealth;
      }
    }

    if (!healthData && (!rosterPlayers || rosterPlayers.length === 0)) continue;

    const adj = estimateTeamInjurySpreadAdjustments({
      healthData: healthData || {},
      rosterPlayers: rosterPlayers || [],
      remainingGamesCount: remCountByTeam.get(abbr) || 6,
      teamGamesPlayed: gpByTeam.get(abbr) ?? null,
      ...(qbRatingsById ? { qbRatingsById } : {})
    });
    if (
      abbr === 'SF' ||
      Math.abs(adj.totalGameSpreadAdj) > 0.01 ||
      Math.abs(adj.totalSeasonSpreadAdj) > 0.01 ||
      adj.qbStatusNote ||
      adj.qbName
    ) {
      injuryAdjustmentsByTeam[abbr] = adj;
    }
  }

  return injuryAdjustmentsByTeam;
}

/**
 * Builds the shared 32-team league playoff context ONCE (Hierarchical Bayesian Iterative SRS +
 * MOV-Elo ratings + 10,000-iteration NFC & AFC baseline Monte Carlo simulations).
 */
export function buildSharedLeaguePlayoffContext({
  standingsByAbbr,
  completedGames = [],
  remainingGames = [],
  preseasonPriors = {},
  weeklyTeamStats = null,
  netEpaByTeam = null,
  qbContext = null,
  injuryAdjustmentsByTeam = null,
  currentWeek = null,
  liveScoresByMatchup = {},
  logoResolver = null,
  nowIso = new Date().toISOString()
} = {}) {
  const reconciled = reconcileAndDedupePlayoffGames(completedGames, remainingGames);
  const compGames = reconciled.completedGames;
  const remGames = reconciled.remainingGames;

  const standingsMap =
    standingsByAbbr instanceof Map
      ? standingsByAbbr
      : new Map(Object.entries(standingsByAbbr || {}).map(([k, v]) => [normalizeAnyTeamAbbr(k), v]));

  const getNetEpa = abbr => {
    if (!netEpaByTeam) return null;
    if (netEpaByTeam instanceof Map) return netEpaByTeam.get(abbr) ?? null;
    return netEpaByTeam[abbr] ?? null;
  };

  const standingsObj = {};
  for (const t of ALL_NFL_TEAMS) {
    const st = standingsMap.get(t.abbr);
    if (!st) continue;
    standingsObj[t.abbr] = {
      wins: Number(st.wins || 0),
      losses: Number(st.losses || 0),
      ties: Number(st.ties || 0),
      pointDiff: Number(st.pd ?? st.pointDiff ?? 0),
      pointsFor: Number(st.pf ?? st.pointsFor ?? 0),
      pointsAgainst: Number(st.pa ?? st.pointsAgainst ?? 0),
      ...(getNetEpa(t.abbr) != null ? { netEpaPerGame: getNetEpa(t.abbr) } : {})
    };
  }

  const leaguePowerResult = computeLeaguePowerRatings({
    completedGames: compGames,
    remainingGames: remGames,
    preseasonPriors: preseasonPriors || {},
    weeklyTeamStats: weeklyTeamStats && Object.keys(weeklyTeamStats).length > 0 ? weeklyTeamStats : null,
    standingsByAbbr: standingsObj,
    ...(qbContext ? { qbContext } : {}),
    ...(injuryAdjustmentsByTeam && Object.keys(injuryAdjustmentsByTeam).length > 0
      ? { injuryAdjustmentsByTeam }
      : {}),
    ...(currentWeek != null ? { currentWeek } : {})
  });
  const leagueRatingsByAbbr = leaguePowerResult.byAbbr || {};

  const resolveLogo = (abbr, st) => {
    if (typeof logoResolver === 'function') return logoResolver(abbr, st);
    return st?.logoUrl || resolveCanonicalTeamLogoUrl(abbr);
  };

  const confTeamsByConf = { NFC: [], AFC: [] };
  const powerRatingsByConf = { NFC: {}, AFC: {} };
  const standingsByConf = { NFC: {}, AFC: {} };
  const nextGameDeltasByConf = { NFC: {}, AFC: {} };

  for (const t of ALL_NFL_TEAMS) {
    const st = standingsMap.get(t.abbr) || {
      abbr: t.abbr,
      name: t.fullName,
      wins: 0,
      losses: 0,
      ties: 0,
      pf: 0,
      pa: 0,
      pd: 0,
      record: '0-0',
      divRec: '0-0',
      confRec: '0-0',
      homeRec: '',
      awayRec: '',
      streak: '',
      clincher: '',
      seed: null
    };
    const lr = leagueRatingsByAbbr[t.abbr] || null;
    const netEpaPerGame = getNetEpa(t.abbr);
    const ratingVal =
      lr?.powerRating ??
      computeCalibratedTeamPowerRating({
        wins: Number(st.wins || 0),
        losses: Number(st.losses || 0),
        ties: Number(st.ties || 0),
        pointDiff: Number(st.pd ?? st.pointDiff ?? 0),
        pointsFor: Number(st.pf ?? st.pointsFor ?? 0),
        pointsAgainst: Number(st.pa ?? st.pointsAgainst ?? 0),
        netEpaPerGame,
        sosSpreadAdj: lr?.sosSpreadAdj ?? 0,
        preseasonPriorSpread: preseasonPriors?.[t.abbr] ?? 0
      });
    const roundedRating = Math.round(ratingVal);
    const dr = parseWltStr(st.divRec);
    const cr = parseWltStr(st.confRec);
    const conf = t.conference;

    const fullRow = {
      abbr: t.abbr,
      name: st.name || t.fullName,
      logoUrl: resolveLogo(t.abbr, st),
      division: t.division,
      wins: Number(st.wins || 0),
      losses: Number(st.losses || 0),
      ties: Number(st.ties || 0),
      divWins: dr.w,
      divLosses: dr.l,
      divTies: dr.t,
      confWins: cr.w,
      confLosses: cr.l,
      confTies: cr.t,
      divRec: st.divRec || '0-0',
      confRec: st.confRec || '0-0',
      homeRec: st.homeRec || '',
      awayRec: st.awayRec || '',
      pointsFor: Number(st.pf ?? st.pointsFor ?? 0),
      pointsAgainst: Number(st.pa ?? st.pointsAgainst ?? 0),
      pointDiff: Number(st.pd ?? st.pointDiff ?? 0),
      streak: st.streak || '',
      clincher: st.clincher || '',
      playoffSeed: st.seed ?? st.playoffSeed ?? null,
      ...(netEpaPerGame != null ? { netEpaPerGame } : {}),
      preseasonPriorSpread: lr?.preseasonPriorSpread ?? preseasonPriors?.[t.abbr] ?? 0,
      preseasonPriorElo: lr?.preseasonPriorElo ?? Math.round(1500 + (preseasonPriors?.[t.abbr] ?? 0) * 25),
      sosSpreadAdj: lr?.sosSpreadAdj ?? 0,
      remainingSosSpread: lr?.remainingSosSpread ?? 0,
      remainingSosRank: lr?.remainingSosRank ?? 16,
      qbInjuryEloAdj: lr?.qbInjuryEloAdj ?? 0,
      nonQbInjuryEloAdj: lr?.nonQbInjuryEloAdj ?? 0,
      nextGameEloDelta: lr?.nextGameEloDelta ?? 0,
      ...(lr?.qbStatusNote ? { qbStatusNote: lr.qbStatusNote } : {}),
      powerRating: roundedRating
    };

    confTeamsByConf[conf].push(fullRow);
    powerRatingsByConf[conf][t.abbr] = roundedRating;
    nextGameDeltasByConf[conf][t.abbr] = lr?.nextGameEloDelta ?? 0;
    standingsByConf[conf][t.abbr] = {
      wins: fullRow.wins,
      losses: fullRow.losses,
      ties: fullRow.ties,
      pointDiff: fullRow.pointDiff,
      pointsFor: fullRow.pointsFor,
      pointsAgainst: fullRow.pointsAgainst,
      divRec: fullRow.divRec,
      confRec: fullRow.confRec,
      homeRec: fullRow.homeRec,
      awayRec: fullRow.awayRec,
      streak: fullRow.streak,
      clincher: fullRow.clincher,
      playoffSeed: fullRow.playoffSeed,
      ...(netEpaPerGame != null ? { netEpaPerGame } : {}),
      preseasonPriorSpread: fullRow.preseasonPriorSpread,
      preseasonPriorElo: fullRow.preseasonPriorElo,
      sosSpreadAdj: fullRow.sosSpreadAdj,
      remainingSosSpread: fullRow.remainingSosSpread,
      remainingSosRank: fullRow.remainingSosRank,
      qbInjuryEloAdj: fullRow.qbInjuryEloAdj,
      nonQbInjuryEloAdj: fullRow.nonQbInjuryEloAdj,
      nextGameEloDelta: fullRow.nextGameEloDelta,
      ...(fullRow.qbStatusNote ? { qbStatusNote: fullRow.qbStatusNote } : {})
    };
  }

  // Run 10,000-iteration conference Monte Carlo ONCE for NFC and ONCE for AFC (bit-for-bit identical for every team in that conference!)
  const conferenceBaselines = {};
  for (const conf of ['NFC', 'AFC']) {
    const otherConf = conf === 'NFC' ? 'AFC' : 'NFC';
    const sim = runPlayoffMonteCarlo({
      conference: conf,
      targetTeam: conf === 'NFC' ? 'SF' : 'KC',
      conferenceTeams: confTeamsByConf[conf],
      nfcTeams: confTeamsByConf[conf],
      otherConferencePowerRatings: powerRatingsByConf[otherConf],
      afcPowerRatings: powerRatingsByConf[otherConf],
      afcRatings: powerRatingsByConf[otherConf],
      otherConferenceStandings: standingsByConf[otherConf],
      afcStandings: standingsByConf[otherConf],
      otherConferenceNextGameDeltas: nextGameDeltasByConf[otherConf],
      completedGames: compGames,
      remainingGames: remGames,
      iterations: 10000,
      seed: 492026
    });
    if (Array.isArray(sim.allTeamOdds)) {
      sim.allTeamOdds = sim.allTeamOdds.map(t => ({
        ...t,
        logoUrl: resolveLogo(t.abbr, standingsMap.get(t.abbr))
      }));
    }
    conferenceBaselines[conf] = sim;
  }

  return {
    nowIso,
    standingsMap,
    completedGames: compGames,
    remainingGames: remGames,
    preseasonPriors: preseasonPriors || {},
    weeklyTeamStats: weeklyTeamStats && Object.keys(weeklyTeamStats).length > 0 ? weeklyTeamStats : null,
    injuryAdjustmentsByTeam:
      injuryAdjustmentsByTeam && Object.keys(injuryAdjustmentsByTeam).length > 0
        ? injuryAdjustmentsByTeam
        : null,
    leagueRatingsByAbbr,
    confTeamsByConf,
    powerRatingsByConf,
    standingsByConf,
    nextGameDeltasByConf,
    conferenceBaselines,
    liveScoresByMatchup: liveScoresByMatchup || {},
    resolveLogo
  };
}

/**
 * Slices & builds the complete `playoffPicture` payload for a single franchise (`SF` or any of the
 * other 31 clubs) from the shared `leaguePlayoffCtx`.
 */
export function buildPlayoffPictureForTeam(team, leagueCtx, { sources = null } = {}) {
  const abbr = normalizeAnyTeamAbbr(team?.abbr || 'SF');
  const teamCfg = TEAM_BY_ABBR.get(abbr) || team;
  const targetConf = teamCfg.conference || 'NFC';
  const otherConf = targetConf === 'NFC' ? 'AFC' : 'NFC';

  const confSim = leagueCtx.conferenceBaselines[targetConf];
  const teamOdds =
    (confSim?.allTeamOdds || []).find(t => normalizeAnyTeamAbbr(t.abbr) === abbr) ||
    confSim?.teamOdds ||
    confSim?.sfOdds ||
    {};

  const baselineSimulation = {
    ...confSim,
    conference: targetConf,
    targetTeam: abbr,
    teamOdds,
    sfOdds: teamOdds
  };

  const simulatorInputs = {
    modelVersion: PLAYOFF_MODEL_VERSION,
    lastSimulatedAt: leagueCtx.nowIso,
    targetTeam: abbr,
    conference: targetConf,
    conferenceTeams: leagueCtx.confTeamsByConf[targetConf],
    nfcTeams: leagueCtx.confTeamsByConf[targetConf],
    otherConferencePowerRatings: leagueCtx.powerRatingsByConf[otherConf],
    afcPowerRatings: leagueCtx.powerRatingsByConf[otherConf],
    afcRatings: leagueCtx.powerRatingsByConf[otherConf],
    otherConferenceStandings: leagueCtx.standingsByConf[otherConf],
    afcStandings: leagueCtx.standingsByConf[otherConf],
    otherConferenceNextGameDeltas: leagueCtx.nextGameDeltasByConf[otherConf],
    preseasonPriors: leagueCtx.preseasonPriors || {},
    ...(leagueCtx.weeklyTeamStats ? { weeklyTeamStats: leagueCtx.weeklyTeamStats } : {}),
    ...(leagueCtx.injuryAdjustmentsByTeam
      ? { injuryAdjustmentsByTeam: leagueCtx.injuryAdjustmentsByTeam }
      : {}),
    completedGames: leagueCtx.completedGames,
    remainingGames: leagueCtx.remainingGames
  };

  const rootingLeverage = computeRootingGuideLeverage(simulatorInputs, 12).map(g => ({
    ...g,
    awayLogoUrl: leagueCtx.resolveLogo(g.away, leagueCtx.standingsMap.get(g.away)),
    homeLogoUrl: leagueCtx.resolveLogo(g.home, leagueCtx.standingsMap.get(g.home))
  }));

  const st = leagueCtx.standingsMap.get(abbr) || {
    wins: 0,
    losses: 0,
    ties: 0,
    pd: 0,
    record: '0-0',
    divRec: '0-0',
    confRec: '0-0'
  };
  const teamRemGames = (leagueCtx.remainingGames || []).filter(
    g => g.home === abbr || g.away === abbr
  ).length;
  const gp = Number(st.wins || 0) + Number(st.losses || 0) + Number(st.ties || 0);
  const seed1Pct = teamOdds.seed1ByePct ?? 0;
  const winDivPct = teamOdds.winDivisionPct ?? 0;
  const makePlayoffsPct = teamOdds.makePlayoffsPct ?? 0;
  const wcPct = teamOdds.wildCardPct ?? 0;
  const projWins = teamOdds.projectedWins ?? Number(st.wins || 0);
  const pdVal = Number(st.pd ?? st.pointDiff ?? 0);

  const seedPathCards = [
    {
      target: `#1 ${targetConf} Seed (First-Round Bye)`,
      probabilityPct: seed1Pct,
      currentProbPct: seed1Pct,
      pathSummary: `At ${st.record || `${st.wins}-${st.losses}`} (${st.divRec || '0-0'} ${teamCfg.division}, ${st.confRec || '0-0'} ${targetConf}), ${teamCfg.fullName} project to ${projWins} wins (${seed1Pct}% #1 ${targetConf} seed probability across 10,000 calibrated Hierarchical-Bayes + SRS + QB/injury simulations with ${teamRemGames} games remaining).`
    },
    {
      target: `${teamCfg.division} Division Title (Seeds #1–#4)`,
      probabilityPct: winDivPct,
      currentProbPct: winDivPct,
      pathSummary: `Sitting at ${st.record || `${st.wins}-${st.losses}`} overall and ${st.divRec || '0-0'} inside the ${teamCfg.division} (${pdVal >= 0 ? '+' : ''}${pdVal} pt diff), ${teamCfg.fullName} hold ${winDivPct}% probability to win the division and host at least one playoff game at ${teamCfg.stadium}.`
    },
    {
      target: `${targetConf} Playoff Berth (Seeds #1–#7)`,
      probabilityPct: makePlayoffsPct,
      currentProbPct: makePlayoffsPct,
      pathSummary: `With ${st.wins || 0} wins banked through ${gp} games (${st.confRec || '0-0'} ${targetConf}), ${teamCfg.fullName} project to ${makePlayoffsPct}% overall postseason odds (${wcPct}% via Wild Card seeds #5–#7).`
    }
  ];

  const resolvedSources = sources || [
    { label: 'ESPN Live NFL Standings', url: 'https://www.espn.com/nfl/standings' },
    { label: 'NFL Official Playoff Picture', url: 'https://www.nfl.com/standings/playoff-picture' },
    {
      label: `Calibrated 10k Monte Carlo (${PLAYOFF_MODEL_VERSION})`,
      url: `https://www.espn.com/nfl/team/_/name/${teamCfg.espnAbbr}/${teamCfg.otcSlug}`
    }
  ];

  return {
    sources: resolvedSources,
    baselineSimulation,
    rootingLeverage,
    seedPathCards,
    simulatorInputs,
    liveScoresByMatchup: leagueCtx.liveScoresByMatchup || {},
    lastSimulatedAt: leagueCtx.nowIso,
    modelVersion: PLAYOFF_MODEL_VERSION
  };
}

/**
 * Fast (~5-8s) synchronized seasonal/playoff resync for ALL 32 NFL teams (`data/seasonal.json` +
 * all 31 `data/teams/<slug>/seasonal.json` + `data/league/meta.json`).
 *
 * Fetches live ESPN standings, current/upcoming scoreboard weeks, and live 32-team ESPN injuries
 * ONCE, computes calibrated 32-team ratings & 2x 10,000-iteration conference Monte Carlo baselines
 * ONCE, and writes identical-model `playoffPicture` snapshots to all 32 teams atomically.
 */
export async function syncAll32TeamsSeasonalPlayoffData({
  rootDir,
  seasonYear = 2026,
  teams = ALL_NFL_TEAMS,
  nowIso = new Date().toISOString()
} = {}) {
  const t0 = Date.now();
  const [standingsRaw, espnInjuriesRaw] = await Promise.all([
    fetchJsonSafe('https://site.api.espn.com/apis/v2/sports/football/nfl/standings', 10000),
    fetchJsonSafe('https://site.api.espn.com/apis/site/v2/sports/football/nfl/injuries', 10000)
  ]);

  const standingsByAbbr = parseEspnStandingsToMap(standingsRaw);
  if (standingsByAbbr.size < 28) {
    throw new Error(`ESPN standings returned only ${standingsByAbbr.size} teams; aborting seasonal sync.`);
  }

  // Gather richest existing schedule, preseason priors & weekly stats from disk (preferring whichever has more completed games)
  const sfSeasonal = readJsonSafe(path.join(rootDir, 'data', 'seasonal.json'));
  const detSeasonal = readJsonSafe(path.join(rootDir, 'data', 'teams', 'lions', 'seasonal.json'));
  const seedCandidates = [sfSeasonal, detSeasonal].filter(Boolean);

  let baseCompleted = [];
  let baseRemaining = [];
  let preseasonPriors = {};
  let weeklyTeamStats = null;

  for (const cand of seedCandidates) {
    const si = cand?.playoffPicture?.simulatorInputs;
    if (!si) continue;
    const compLen = (si.completedGames || []).length;
    if (compLen > baseCompleted.length) {
      baseCompleted = si.completedGames || [];
      baseRemaining = si.remainingGames || [];
    }
    if (
      Object.keys(si.preseasonPriors || {}).length > Object.keys(preseasonPriors).length
    ) {
      preseasonPriors = si.preseasonPriors;
    }
    if (!weeklyTeamStats && si.weeklyTeamStats && Object.keys(si.weeklyTeamStats).length > 0) {
      weeklyTeamStats = si.weeklyTeamStats;
    }
  }

  // If schedule or 32-team preseason priors are incomplete on disk, hydrate from nflverse games.csv
  if (baseCompleted.length + baseRemaining.length < 250 || Object.keys(preseasonPriors).length < 32) {
    const gamesCsv = await fetchTextSafe(
      'https://raw.githubusercontent.com/nflverse/nfldata/master/data/games.csv',
      14000
    );
    if (gamesCsv) {
      const rows = parseSimpleCsv(gamesCsv);
      const curReg = rows.filter(r => Number(r.season) === seasonYear && r.game_type === 'REG');
      if (baseCompleted.length + baseRemaining.length < 250 && curReg.length >= 250) {
        baseCompleted = curReg
          .filter(g => g.home_score !== '' && g.away_score !== '')
          .map(g => ({
            id: g.game_id,
            week: Number(g.week),
            home: normalizeAnyTeamAbbr(g.home_team),
            away: normalizeAnyTeamAbbr(g.away_team),
            homeScore: Number(g.home_score),
            awayScore: Number(g.away_score),
            neutral: String(g.location || '').toLowerCase().includes('neutral'),
            divGame: Number(g.div_game) === 1,
            homeRest: Number(g.home_rest) || 7,
            awayRest: Number(g.away_rest) || 7
          }));
        baseRemaining = curReg
          .filter(g => g.home_score === '' || g.away_score === '')
          .map(g => ({
            id: g.game_id,
            week: Number(g.week),
            home: normalizeAnyTeamAbbr(g.home_team),
            away: normalizeAnyTeamAbbr(g.away_team),
            neutral: String(g.location || '').toLowerCase().includes('neutral'),
            divGame: Number(g.div_game) === 1,
            homeRest: Number(g.home_rest) || 7,
            awayRest: Number(g.away_rest) || 7
          }));
      }
      if (Object.keys(preseasonPriors).length < 32) {
        const prevSeasonGames = rows
          .filter(
            g =>
              Number(g.season) === seasonYear - 1 &&
              g.game_type === 'REG' &&
              g.home_score !== '' &&
              g.away_score !== ''
          )
          .map(g => ({
            week: Number(g.week),
            home: normalizeAnyTeamAbbr(g.home_team),
            away: normalizeAnyTeamAbbr(g.away_team),
            homeScore: Number(g.home_score),
            awayScore: Number(g.away_score),
            neutral: String(g.location || '').toLowerCase().includes('neutral'),
            divGame: Number(g.div_game) === 1,
            homeRest: Number(g.home_rest) || 7,
            awayRest: Number(g.away_rest) || 7
          }));
        const currentSeasonW1Games = curReg
          .filter(g => Number(g.week) === 1)
          .map(g => ({
            home: normalizeAnyTeamAbbr(g.home_team),
            away: normalizeAnyTeamAbbr(g.away_team),
            spreadLine: g.spread_line !== '' && g.spread_line !== 'NA' ? Number(g.spread_line) : null,
            neutral: String(g.location || '').toLowerCase().includes('neutral'),
            divGame: Number(g.div_game) === 1
          }));
        preseasonPriors = computePreseasonPriorsFromHistory({
          prevSeasonGames,
          currentSeasonW1Games
        });
      }
    }
  }

  // Probe ESPN scoreboard across the active week window (previous completed week through +2 upcoming weeks)
  const currentMaxGp = Math.max(
    1,
    ...[...standingsByAbbr.values()].map(s => s.wins + s.losses + s.ties)
  );
  const probeWeeks = [
    ...new Set([
      Math.max(1, currentMaxGp - 1),
      Math.max(1, currentMaxGp),
      Math.min(18, currentMaxGp + 1),
      Math.min(18, currentMaxGp + 2)
    ])
  ];
  const scoreboardPayloads = await Promise.all(
    probeWeeks.map(wk =>
      fetchJsonSafe(
        `https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?seasontype=2&week=${wk}`,
        9000
      )
    )
  );

  const { completedGames, remainingGames, liveScoresByMatchup } = reconcileLeagueScheduleWithScoreboards(
    baseCompleted,
    baseRemaining,
    scoreboardPayloads
  );

  // Extract any existing Net EPA/game from SF's seasonal snapshot so ratings retain EPA blend
  const netEpaByTeam = new Map();
  for (const t of sfSeasonal?.playoffPicture?.simulatorInputs?.nfcTeams || []) {
    if (t?.abbr && t.netEpaPerGame != null) netEpaByTeam.set(normalizeAnyTeamAbbr(t.abbr), t.netEpaPerGame);
  }
  for (const [abbr, st] of Object.entries(sfSeasonal?.playoffPicture?.simulatorInputs?.afcStandings || {})) {
    if (st?.netEpaPerGame != null) netEpaByTeam.set(normalizeAnyTeamAbbr(abbr), st.netEpaPerGame);
  }

  const injuryAdjustmentsByTeam = computeAll32TeamInjuryAdjustments({
    rootDir,
    completedGames,
    remainingGames,
    espnInjuriesRaw
  });

  const leaguePlayoffCtx = buildSharedLeaguePlayoffContext({
    standingsByAbbr,
    completedGames,
    remainingGames,
    preseasonPriors,
    weeklyTeamStats,
    netEpaByTeam: netEpaByTeam.size > 0 ? netEpaByTeam : null,
    injuryAdjustmentsByTeam,
    currentWeek: Math.min(18, currentMaxGp + 1),
    liveScoresByMatchup,
    nowIso
  });

  const updatedSummaries = [];
  for (const team of teams) {
    const teamDir = getTeamDataDir(rootDir, team);
    const seasonalPath = path.join(teamDir, 'seasonal.json');
    const existing = readJsonSafe(seasonalPath) || {};
    const playoffPicture = buildPlayoffPictureForTeam(team, leaguePlayoffCtx);
    const updatedSeasonal = {
      ...existing,
      updatedAt: nowIso,
      playoffPicture
    };
    fs.mkdirSync(teamDir, { recursive: true });
    fs.writeFileSync(seasonalPath, JSON.stringify(updatedSeasonal, null, 2));
    updatedSummaries.push({
      abbr: team.abbr,
      slug: team.slug,
      makePlayoffsPct: playoffPicture.baselineSimulation?.teamOdds?.makePlayoffsPct ?? 0,
      winDivisionPct: playoffPicture.baselineSimulation?.teamOdds?.winDivisionPct ?? 0,
      seed1ByePct: playoffPicture.baselineSimulation?.teamOdds?.seed1ByePct ?? 0
    });
  }

  // Update `data/league/meta.json` cleanly preserving existing trade counts
  const leagueMetaPath = path.join(rootDir, 'data', 'league', 'meta.json');
  const existingLeagueMeta = readJsonSafe(leagueMetaPath) || {};
  fs.mkdirSync(path.dirname(leagueMetaPath), { recursive: true });
  fs.writeFileSync(
    leagueMetaPath,
    JSON.stringify(
      {
        ...existingLeagueMeta,
        updatedAt: nowIso,
        seasonYear,
        playoffModelVersion: PLAYOFF_MODEL_VERSION,
        standingsCount: standingsByAbbr.size,
        completedLeagueGames: completedGames.length,
        remainingLeagueGames: remainingGames.length,
        syncedTeamsCount: updatedSummaries.length
      },
      null,
      2
    )
  );

  return {
    elapsedMs: Date.now() - t0,
    modelVersion: PLAYOFF_MODEL_VERSION,
    completedGames: completedGames.length,
    remainingGames: remainingGames.length,
    injuryAdjustmentsCount: Object.keys(injuryAdjustmentsByTeam).length,
    preseasonPriorsCount: Object.keys(preseasonPriors).length,
    teamsUpdated: updatedSummaries.length,
    summaries: updatedSummaries
  };
}
