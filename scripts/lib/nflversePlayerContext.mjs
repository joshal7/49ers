/**
 * Shared Stage-1 nflverse League-Wide Player Context Loader
 *
 * Fetches all league-wide nflverse datasets ONCE per pipeline run (zero per-team duplication):
 * - `players.csv.gz` (gsis_id, pfr_id, espn_id, otc_id, draft_year/round/pick, college, height/weight)
 * - `combine.csv.gz` (8,900+ NFL Combine records → MockDraftable-style spider percentiles & comps)
 * - `stats_player_reg_{seasonYear..seasonYear-3}.csv.gz` + `stats_player_week_{seasonYear}.csv.gz`
 * - `snap_counts_{seasonYear}.csv.gz`
 * - `nextgen_stats/ngs_{passing,receiving,rushing}.csv.gz`
 * - `pfr_advstats/advstats_{season,week}_{pass,rush,rec,def}.csv.gz`
 * - `espn_data/qbr_{season,week}_level.csv.gz`
 * - `draft_picks/draft_picks.csv.gz`
 * - `injuries/injuries_{seasonYear}.csv.gz`
 */

import zlib from 'node:zlib';
import { getTeamByAbbr, normalizeAnyTeamAbbr } from '../../src/config/teamRegistry.js';
import { windDegreesToCompass, wmoCodeToShortCondition } from '../../src/config/nflStadiums.js';
import {
  aggregateEspnQbr2026,
  aggregateWeeklyNgsStats2026,
  aggregateWeeklyPfrAdvStats2026
} from '../../src/engine/statsLeaderboardEngine.js';
import { buildCombineIndexer } from './combineSpider.mjs';

const NFLVERSE_BASE = 'https://github.com/nflverse/nflverse-data/releases/download';
const UA_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  Accept: '*/*'
};

export function normPlayerName(name = '') {
  return String(name || '')
    .toLowerCase()
    .replace(/\b(jr|sr|ii|iii|iv|v)\b\.?/g, '')
    .replace(/[^a-z0-9]/g, '')
    .trim();
}

function num(v, decimals = null) {
  if (v === null || v === undefined || v === '' || v === 'NA' || v === 'NaN') return 0;
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  return decimals !== null ? Number(n.toFixed(decimals)) : n;
}

export function parseCsv(text = '') {
  if (!text || typeof text !== 'string') return [];
  const rows = [];
  let headers = null;
  let field = '';
  let row = [];
  let inQuotes = false;

  const commitRow = () => {
    if (row.length === 1 && row[0] === '') {
      row = [];
      return;
    }
    if (!headers) {
      headers = row.map(h => h.replace(/^\uFEFF/, '').trim());
    } else {
      const obj = {};
      for (let i = 0; i < headers.length; i += 1) {
        obj[headers[i]] = row[i] !== undefined ? row[i] : '';
      }
      rows.push(obj);
    }
    row = [];
  };

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      row.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i += 1;
      row.push(field);
      field = '';
      commitRow();
    } else {
      field += ch;
    }
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    commitRow();
  }
  return rows;
}

const MAX_CONCURRENT_CSV = 6;
let activeCsvFetches = 0;
const csvWaitQueue = [];

async function acquireCsvSlot() {
  if (activeCsvFetches < MAX_CONCURRENT_CSV) {
    activeCsvFetches += 1;
    return;
  }
  await new Promise(resolve => csvWaitQueue.push(resolve));
}

function releaseCsvSlot() {
  const next = csvWaitQueue.shift();
  if (next) next();
  else activeCsvFetches = Math.max(0, activeCsvFetches - 1);
}

async function fetchCsv(url, retries = 2) {
  await acquireCsvSlot();
  try {
    let lastErr;
    for (let attempt = 0; attempt <= retries; attempt += 1) {
      try {
        const res = await fetch(url, {
          headers: UA_HEADERS,
          redirect: 'follow',
          signal: AbortSignal.timeout(45000)
        });
        if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
        const buf = Buffer.from(await res.arrayBuffer());
        const isGzip = url.endsWith('.gz') || (buf.length >= 2 && buf[0] === 0x1f && buf[1] === 0x8b);
        const text = isGzip ? zlib.gunzipSync(buf).toString('utf8') : buf.toString('utf8');
        return parseCsv(text);
      } catch (err) {
        lastErr = err;
        if (attempt < retries) {
          await new Promise(r => setTimeout(r, 900 * (attempt + 1)));
        }
      }
    }
    throw lastErr;
  } finally {
    releaseCsvSlot();
  }
}

async function fetchCsvWithFallback(primaryUrl, fallbackUrl = null) {
  try {
    return await fetchCsv(primaryUrl, 2);
  } catch (err) {
    if (fallbackUrl) {
      try {
        return await fetchCsv(fallbackUrl, 1);
      } catch {
        // swallow secondary fallback failure
      }
    }
    console.warn(`[stage-1/nflverse] Optional CSV unavailable (${primaryUrl}): ${err?.message || err}`);
    return [];
  }
}

/**
 * Estimates 4-year rookie contract value by overall pick slot (2026 NFL CBA rookie wage scale)
 * when OverTheCap contract totals are not yet populated for a rookie pick.
 */
export function estimate4YrRookieContractByPick(overallPick = 200) {
  const p = Math.max(1, Math.min(262, Number(overallPick) || 200));
  if (p === 1) return 44_500_000;
  if (p <= 5) return Math.round(44_500_000 - (p - 1) * 3_100_000);
  if (p <= 10) return Math.round(32_000_000 - (p - 5) * 1_900_000);
  if (p <= 20) return Math.round(22_500_000 - (p - 10) * 650_000);
  if (p <= 32) return Math.round(16_000_000 - (p - 20) * 260_000);
  if (p <= 64) return Math.round(11_400_000 - (p - 32) * 145_000);
  if (p <= 100) return Math.round(6_700_000 - (p - 64) * 36_000);
  if (p <= 140) return Math.round(5_350_000 - (p - 100) * 20_000);
  if (p <= 220) return Math.round(4_550_000 - (p - 140) * 6_500);
  return 4_020_000;
}

/**
 * Loads and pre-indexes ALL league-wide nflverse datasets once in Stage 1.
 */
export async function loadSharedNflversePlayerContext(seasonYear = 2026) {
  const prevSeasonYear = seasonYear - 1;
  console.log(`[stage-1/nflverse] Loading shared league-wide player, combine, stats, snap, NGS, PFR, QBR & draft datasets (${seasonYear})...`);

  const [
    nflPlayers,
    statsPlayerCurrent,
    statsPlayerWeekCurrent,
    statsPlayerPrev1,
    statsPlayerPrev2,
    statsPlayerPrev3,
    ngsPassing,
    ngsReceiving,
    ngsRushing,
    pfrPass,
    pfrPassWeekCurrent,
    pfrRush,
    pfrRushWeekCurrent,
    pfrRec,
    pfrRecWeekCurrent,
    pfrDef,
    pfrDefWeekCurrent,
    qbrSeasonRows,
    qbrWeekRows,
    snapsCurrent,
    injuriesCurrent,
    combineRows,
    draftPicksRows,
    gamesRows
  ] = await Promise.all([
    fetchCsvWithFallback(`${NFLVERSE_BASE}/players/players.csv.gz`, `${NFLVERSE_BASE}/players/players.csv`),
    fetchCsvWithFallback(`${NFLVERSE_BASE}/stats_player/stats_player_reg_${seasonYear}.csv.gz`),
    fetchCsvWithFallback(`${NFLVERSE_BASE}/stats_player/stats_player_week_${seasonYear}.csv.gz`),
    fetchCsvWithFallback(`${NFLVERSE_BASE}/stats_player/stats_player_reg_${seasonYear - 1}.csv.gz`),
    fetchCsvWithFallback(`${NFLVERSE_BASE}/stats_player/stats_player_reg_${seasonYear - 2}.csv.gz`),
    fetchCsvWithFallback(`${NFLVERSE_BASE}/stats_player/stats_player_reg_${seasonYear - 3}.csv.gz`),
    fetchCsvWithFallback(`${NFLVERSE_BASE}/nextgen_stats/ngs_passing.csv.gz`, `${NFLVERSE_BASE}/nextgen_stats/ngs_passing.csv`),
    fetchCsvWithFallback(`${NFLVERSE_BASE}/nextgen_stats/ngs_receiving.csv.gz`, `${NFLVERSE_BASE}/nextgen_stats/ngs_receiving.csv`),
    fetchCsvWithFallback(`${NFLVERSE_BASE}/nextgen_stats/ngs_rushing.csv.gz`, `${NFLVERSE_BASE}/nextgen_stats/ngs_rushing.csv`),
    fetchCsvWithFallback(`${NFLVERSE_BASE}/pfr_advstats/advstats_season_pass.csv.gz`, `${NFLVERSE_BASE}/pfr_advstats/advstats_season_pass.csv`),
    fetchCsvWithFallback(`${NFLVERSE_BASE}/pfr_advstats/advstats_week_pass_${seasonYear}.csv.gz`, `${NFLVERSE_BASE}/pfr_advstats/advstats_week_pass_${prevSeasonYear}.csv.gz`),
    fetchCsvWithFallback(`${NFLVERSE_BASE}/pfr_advstats/advstats_season_rush.csv.gz`, `${NFLVERSE_BASE}/pfr_advstats/advstats_season_rush.csv`),
    fetchCsvWithFallback(`${NFLVERSE_BASE}/pfr_advstats/advstats_week_rush_${seasonYear}.csv.gz`, `${NFLVERSE_BASE}/pfr_advstats/advstats_week_rush_${prevSeasonYear}.csv.gz`),
    fetchCsvWithFallback(`${NFLVERSE_BASE}/pfr_advstats/advstats_season_rec.csv.gz`, `${NFLVERSE_BASE}/pfr_advstats/advstats_season_rec.csv`),
    fetchCsvWithFallback(`${NFLVERSE_BASE}/pfr_advstats/advstats_week_rec_${seasonYear}.csv.gz`, `${NFLVERSE_BASE}/pfr_advstats/advstats_week_rec_${prevSeasonYear}.csv.gz`),
    fetchCsvWithFallback(`${NFLVERSE_BASE}/pfr_advstats/advstats_season_def.csv.gz`, `${NFLVERSE_BASE}/pfr_advstats/advstats_season_def.csv`),
    fetchCsvWithFallback(`${NFLVERSE_BASE}/pfr_advstats/advstats_week_def_${seasonYear}.csv.gz`, `${NFLVERSE_BASE}/pfr_advstats/advstats_week_def_${prevSeasonYear}.csv.gz`),
    fetchCsvWithFallback(`${NFLVERSE_BASE}/espn_data/qbr_season_level.csv.gz`, `${NFLVERSE_BASE}/espn_data/qbr_season_level.csv`),
    fetchCsvWithFallback(`${NFLVERSE_BASE}/espn_data/qbr_week_level.csv.gz`, `${NFLVERSE_BASE}/espn_data/qbr_week_level.csv`),
    fetchCsvWithFallback(
      `${NFLVERSE_BASE}/snap_counts/snap_counts_${seasonYear}.csv.gz`,
      `${NFLVERSE_BASE}/snap_counts/snap_counts_${prevSeasonYear}.csv.gz`
    ),
    fetchCsvWithFallback(`${NFLVERSE_BASE}/injuries/injuries_${seasonYear}.csv.gz`),
    fetchCsvWithFallback(`${NFLVERSE_BASE}/combine/combine.csv.gz`, `${NFLVERSE_BASE}/combine/combine.csv`),
    fetchCsvWithFallback(`${NFLVERSE_BASE}/draft_picks/draft_picks.csv.gz`, `${NFLVERSE_BASE}/draft_picks/draft_picks.csv`),
    fetchCsvWithFallback(
      `${NFLVERSE_BASE}/schedules/games.csv.gz`,
      'https://raw.githubusercontent.com/nflverse/nfldata/master/data/games.csv'
    )
  ]);

  // 1. Combine Spider Chart Indexer (MockDraftable 0–100th positional percentiles + RAS + Comps)
  const { buildPlayerSpiderProfile } = buildCombineIndexer(combineRows);

  // 2. Index 4-season player stats by GSIS ID & normalized name
  const seasonStatsByGsis = new Map();
  const seasonStatsByName = new Map();
  for (const [yr, dataset] of [
    [seasonYear, statsPlayerCurrent],
    [seasonYear - 1, statsPlayerPrev1],
    [seasonYear - 2, statsPlayerPrev2],
    [seasonYear - 3, statsPlayerPrev3]
  ]) {
    for (const row of dataset) {
      const entry = {
        season: yr,
        team: normalizeAnyTeamAbbr(row.recent_team || '') || row.recent_team || '',
        games: num(row.games),
        passing: {
          completions: num(row.completions),
          attempts: num(row.attempts),
          yards: num(row.passing_yards),
          tds: num(row.passing_tds),
          ints: num(row.passing_interceptions),
          sacks: num(row.sacks_suffered),
          epa: num(row.passing_epa, 2),
          cpoe: num(row.passing_cpoe, 2),
          airYards: num(row.passing_air_yards),
          yac: num(row.passing_yards_after_catch),
          firstDowns: num(row.passing_first_downs)
        },
        rushing: {
          carries: num(row.carries),
          yards: num(row.rushing_yards),
          tds: num(row.rushing_tds),
          epa: num(row.rushing_epa, 2),
          firstDowns: num(row.rushing_first_downs),
          explosive10Plus: num(row.rushing_10),
          fumblesLost: num(row.rushing_fumbles_lost)
        },
        receiving: {
          receptions: num(row.receptions),
          targets: num(row.targets),
          yards: num(row.receiving_yards),
          tds: num(row.receiving_tds),
          epa: num(row.receiving_epa, 2),
          yac: num(row.receiving_yards_after_catch),
          airYards: num(row.receiving_air_yards),
          targetSharePct: num(Number(row.target_share || 0) * 100, 1),
          airYardsSharePct: num(Number(row.air_yards_share || 0) * 100, 1),
          wopr: num(row.wopr, 2),
          racr: num(row.racr, 2),
          firstDowns: num(row.receiving_first_downs)
        },
        defense: {
          soloTackles: num(row.def_tackles_solo),
          assistTackles: num(row.def_tackle_assists) + num(row.def_tackles_with_assist),
          totalTackles: num(row.def_tackles_solo) + num(row.def_tackle_assists) + num(row.def_tackles_with_assist),
          tfl: num(row.def_tackles_for_loss),
          sacks: num(row.def_sacks, 1),
          qbHits: num(row.def_qb_hits),
          ints: num(row.def_interceptions),
          passDefended: num(row.def_pass_defended),
          forcedFumbles: num(row.def_fumbles_forced)
        },
        kicking: {
          fgMade: num(row.fg_made),
          fgAtt: num(row.fg_att),
          fgPct: num(Number(row.fg_pct || 0) * 100, 1),
          fgLong: num(row.fg_long),
          patMade: num(row.pat_made),
          patAtt: num(row.pat_att),
          punts: num(row.pt_att),
          puntYards: num(row.pt_yards),
          puntInside20: num(row.pt_inside_20)
        }
      };

      if (row.player_id) {
        if (!seasonStatsByGsis.has(row.player_id)) seasonStatsByGsis.set(row.player_id, []);
        seasonStatsByGsis.get(row.player_id).push(entry);
      }
      const nk = normPlayerName(row.player_display_name || row.player_name);
      if (nk) {
        if (!seasonStatsByName.has(nk)) seasonStatsByName.set(nk, []);
        seasonStatsByName.get(nk).push(entry);
      }
    }
  }

  // 3. ESPN Total QBR, NextGen Stats, PFR Advanced Stats
  const qbrAgg = aggregateEspnQbr2026({
    qbrSeason: qbrSeasonRows,
    qbrWeek: qbrWeekRows,
    seasonYear
  });
  const ngsAgg = aggregateWeeklyNgsStats2026({
    ngsPassing,
    ngsReceiving,
    ngsRushing,
    seasonYear
  });
  const pfrAdvAgg = aggregateWeeklyPfrAdvStats2026({
    pfrPassSeason: pfrPass,
    pfrRushSeason: pfrRush,
    pfrRecSeason: pfrRec,
    pfrDefSeason: pfrDef,
    pfrPassWeek: pfrPassWeekCurrent,
    pfrRushWeek: pfrRushWeekCurrent,
    pfrRecWeek: pfrRecWeekCurrent,
    pfrDefWeek: pfrDefWeekCurrent,
    statsPlayerWeek: statsPlayerWeekCurrent,
    nflPlayers,
    seasonYear
  });

  // 4. Aggregate 2026 Regular-Season Snap Counts (both per-team and all-teams for mid-season trades)
  const snapsByTeamAndPfr = new Map();
  const snapsByTeamAndName = new Map();
  const snapsAllTeamsByPfr = new Map();
  const snapsAllTeamsByName = new Map();
  const seenAllSnapGames = new Set();
  const seenTeamSnapGames = new Set();

  for (const s of snapsCurrent) {
    if (s.game_type && s.game_type !== 'REG') continue;
    const pfrKey = s.pfr_player_id || '';
    const nk = normPlayerName(s.player);
    const idKey = pfrKey || nk;
    if (!idKey) continue;

    const allDedupKey = `${idKey}::${s.game_id || s.week || ''}`;
    if (!seenAllSnapGames.has(allDedupKey)) {
      seenAllSnapGames.add(allDedupKey);
      const allCur = snapsAllTeamsByPfr.get(idKey) || {
        games: 0,
        offSnaps: 0,
        offPctSum: 0,
        defSnaps: 0,
        defPctSum: 0,
        stSnaps: 0,
        stPctSum: 0
      };
      allCur.games += 1;
      allCur.offSnaps += num(s.offense_snaps);
      allCur.offPctSum += num(s.offense_pct);
      allCur.defSnaps += num(s.defense_snaps);
      allCur.defPctSum += num(s.defense_pct);
      allCur.stSnaps += num(s.st_snaps);
      allCur.stPctSum += num(s.st_pct);
      snapsAllTeamsByPfr.set(idKey, allCur);
      if (nk) snapsAllTeamsByName.set(nk, allCur);
    }

    const teamAbbr = normalizeAnyTeamAbbr(s.team || '');
    if (!teamAbbr) continue;
    const teamDedupKey = `${teamAbbr}::${idKey}::${s.game_id || s.week || ''}`;
    if (seenTeamSnapGames.has(teamDedupKey)) continue;
    seenTeamSnapGames.add(teamDedupKey);

    if (!snapsByTeamAndPfr.has(teamAbbr)) snapsByTeamAndPfr.set(teamAbbr, new Map());
    if (!snapsByTeamAndName.has(teamAbbr)) snapsByTeamAndName.set(teamAbbr, new Map());
    const tPfrMap = snapsByTeamAndPfr.get(teamAbbr);
    const tNameMap = snapsByTeamAndName.get(teamAbbr);
    const cur = tPfrMap.get(idKey) || {
      games: 0,
      offSnaps: 0,
      offPctSum: 0,
      defSnaps: 0,
      defPctSum: 0,
      stSnaps: 0,
      stPctSum: 0
    };
    cur.games += 1;
    cur.offSnaps += num(s.offense_snaps);
    cur.offPctSum += num(s.offense_pct);
    cur.defSnaps += num(s.defense_snaps);
    cur.defPctSum += num(s.defense_pct);
    cur.stSnaps += num(s.st_snaps);
    cur.stPctSum += num(s.st_pct);
    tPfrMap.set(idKey, cur);
    if (nk) tNameMap.set(nk, cur);
  }

  // 5. Index weekly injuries by teamAbbr -> normName -> weekly history array
  const weeklyInjByTeamAndName = new Map();
  for (const row of injuriesCurrent) {
    const teamAbbr = normalizeAnyTeamAbbr(row.team || '');
    const nk = normPlayerName(row.full_name);
    if (!teamAbbr || !nk) continue;
    if (!weeklyInjByTeamAndName.has(teamAbbr)) weeklyInjByTeamAndName.set(teamAbbr, new Map());
    const teamMap = weeklyInjByTeamAndName.get(teamAbbr);
    if (!teamMap.has(nk)) teamMap.set(nk, []);
    teamMap.get(nk).push({
      week: num(row.week),
      injury: row.report_primary_injury || row.practice_primary_injury || '',
      gameStatus: row.report_status || '',
      practiceStatus: row.practice_status || ''
    });
  }

  // 6. Index draft picks for current seasonYear by drafting teamAbbr
  const draftPicksByTeam = new Map();
  const draftPickByPfrId = new Map();
  const draftPickByNameYear = new Map();
  for (const dp of draftPicksRows) {
    const yr = Number(dp.season || 0);
    const rd = Number(dp.round || 0);
    const pk = Number(dp.pick || 0);
    if (!yr || !rd || !pk) continue;
    const teamAbbr = normalizeAnyTeamAbbr(dp.team || '');
    const normObj = {
      season: yr,
      round: rd,
      pick: pk,
      team: teamAbbr,
      name: String(dp.pfr_player_name || dp.player_name || '').trim(),
      pfrId: String(dp.pfr_player_id || '').trim() || null,
      gsisId: String(dp.gsis_id || '').trim() || null,
      position: String(dp.position || '').trim() || 'ATH',
      college: String(dp.college || '').trim() || '',
      age: Number(dp.age) || null
    };
    if (normObj.pfrId) draftPickByPfrId.set(normObj.pfrId, normObj);
    const nk = normPlayerName(normObj.name);
    if (nk) draftPickByNameYear.set(`${nk}:${yr}`, normObj);
    if (yr === seasonYear && teamAbbr) {
      if (!draftPicksByTeam.has(teamAbbr)) draftPicksByTeam.set(teamAbbr, []);
      draftPicksByTeam.get(teamAbbr).push(normObj);
    }
  }
  for (const list of draftPicksByTeam.values()) {
    list.sort((a, b) => a.pick - b.pick);
  }

  const weeklyPlayerLogsIndex = buildWeeklyPlayerLogsIndex({
    statsPlayerWeek: statsPlayerWeekCurrent,
    snapsCurrent,
    gamesRows,
    seasonYear
  });

  console.log(
    `[stage-1/nflverse] Loaded players=${nflPlayers.length}, combine=${combineRows.length}, stats${seasonYear}=${statsPlayerCurrent.length}, snaps${seasonYear}=${snapsCurrent.length}, draftPicks=${draftPicksRows.length}, games=${gamesRows.length}, pfrMaxWk=${pfrAdvAgg.maxChartedWeek || 0}`
  );

  return {
    seasonYear,
    nflPlayers,
    gamesRows,
    statsPlayerCurrent,
    statsPlayerWeekCurrent,
    snapsCurrent,
    combineRowsCount: combineRows.length,
    buildPlayerSpiderProfile,
    seasonStatsByGsis,
    seasonStatsByName,
    ...qbrAgg,
    ...ngsAgg,
    ...pfrAdvAgg,
    snapsByTeamAndPfr,
    snapsByTeamAndName,
    snapsAllTeamsByPfr,
    snapsAllTeamsByName,
    weeklyPlayerLogsIndex,
    weeklyInjByTeamAndName,
    draftPicksByTeam,
    draftPickByPfrId,
    draftPickByNameYear
  };
}

// Only include post-1999 franchise relocations present in nflverse games.csv (1999–present).
// Never alias IND->BAL or TEN->HOU (BAL Ravens & HOU Texans are distinct active franchises since 1996/2002).
const MODERN_FRANCHISE_RELOCATION_ALIASES = {
  LV: ['LV', 'OAK'],
  LAR: ['LAR', 'LA', 'STL'],
  LAC: ['LAC', 'SD'],
  WAS: ['WAS', 'WSH']
};

const HISTORIC_PFR_OVERRIDES = {
  OAK: 'rai',
  STL: 'ram',
  LA: 'ram',
  SD: 'sdg',
  WSH: 'was'
};

function getPfrCodeForHistoricalTeam(abbr = '') {
  const up = String(abbr || '').trim().toUpperCase();
  if (HISTORIC_PFR_OVERRIDES[up]) return HISTORIC_PFR_OVERRIDES[up];
  const norm = normalizeAnyTeamAbbr(up);
  return getTeamByAbbr(norm)?.pfrAbbr || up.toLowerCase();
}

function getModernFranchiseCodeSet(abbr = '') {
  const norm = normalizeAnyTeamAbbr(abbr);
  return new Set(MODERN_FRANCHISE_RELOCATION_ALIASES[norm] || [norm]);
}

function formatRecentRecordSummary(games = []) {
  if (!games.length) return '';
  let wins = 0;
  let losses = 0;
  let ties = 0;
  for (const g of games) {
    if (g.tied || g.result === 'T') ties += 1;
    else if (g.sfWon || g.result === 'W') wins += 1;
    else losses += 1;
  }
  const rec = ties > 0 ? `${wins}-${losses}-${ties}` : `${wins}-${losses}`;
  return `${rec} in last ${games.length} meeting${games.length === 1 ? '' : 's'}`;
}

function buildLastMeetingNote(lastMeeting, teamAbbr, oppAbbr) {
  if (!lastMeeting) return 'First recent meeting on the current schedule cycle.';
  const otSuffix = lastMeeting.overtime ? ' in OT' : '';
  const outcomePhrase =
    lastMeeting.tied || lastMeeting.result === 'T'
      ? `Tied ${lastMeeting.scoreDisplay}`
      : lastMeeting.sfWon || lastMeeting.result === 'W'
        ? `${teamAbbr} won ${lastMeeting.scoreDisplay}`
        : `${oppAbbr} won ${lastMeeting.scoreDisplay}`;
  return `Most recent meeting (${lastMeeting.date}): ${outcomePhrase}${otSuffix} (${lastMeeting.venue}).`;
}

/**
 * Builds verified Recent Meetings head-to-head history for ANY NFL franchise pair
 * from nflverse `schedules/games.csv` + optional live current-season `scheduleGames`.
 */
export function buildFranchiseHeadToHeadHistory(
  gamesRows = [],
  teamAbbr = 'SF',
  oppAbbr = '',
  { maxGames = 8, teamNickname = '', oppShortName = '', scheduleGames = [] } = {}
) {
  const teamNorm = normalizeAnyTeamAbbr(teamAbbr);
  const oppNorm = normalizeAnyTeamAbbr(oppAbbr);
  const teamCfg = getTeamByAbbr(teamNorm);
  const resolvedNickname = teamNickname || teamCfg?.nickname || teamNorm;

  if (!oppNorm || oppNorm === 'TBD' || oppNorm === 'BYE' || oppNorm === teamNorm) {
    return {
      allTimeRecord: `${resolvedNickname} vs. ${oppShortName || oppNorm || 'Opponent'}`,
      recentRecord: '',
      lastMeetingNote: 'Opponent not yet finalized on the current schedule cycle.',
      pfrQueryUrl: `https://www.pro-football-reference.com/teams/${teamCfg?.pfrAbbr || teamNorm.toLowerCase()}/head-to-head.htm`,
      recentGames: []
    };
  }

  const oppCfg = getTeamByAbbr(oppNorm);
  const resolvedOppShort = oppShortName || oppCfg?.nickname || oppNorm;
  const pfrQueryUrl = `https://www.pro-football-reference.com/boxscores/game_query.cgi?tm1=${teamCfg?.pfrAbbr || teamNorm.toLowerCase()}&tm2=${oppCfg?.pfrAbbr || oppNorm.toLowerCase()}&yr=all`;

  const teamCodes = getModernFranchiseCodeSet(teamNorm);
  const oppCodes = getModernFranchiseCodeSet(oppNorm);

  const byDate = new Map();

  for (const g of gamesRows || []) {
    if (!g) continue;
    const rawHomeScore = String(g.home_score ?? '').trim();
    const rawAwayScore = String(g.away_score ?? '').trim();
    if (!rawHomeScore || rawHomeScore === 'NA' || !rawAwayScore || rawAwayScore === 'NA') continue;
    const homePts = Number(rawHomeScore);
    const awayPts = Number(rawAwayScore);
    if (!Number.isFinite(homePts) || !Number.isFinite(awayPts)) continue;

    const homeTeam = String(g.home_team || '').trim().toUpperCase();
    const awayTeam = String(g.away_team || '').trim().toUpperCase();
    const isTeamHome = teamCodes.has(homeTeam) && oppCodes.has(awayTeam);
    const isTeamAway = teamCodes.has(awayTeam) && oppCodes.has(homeTeam);
    if (!isTeamHome && !isTeamAway) continue;

    const gameday = String(g.gameday || '').trim();
    if (!gameday) continue;

    const teamPts = isTeamHome ? homePts : awayPts;
    const oppPts = isTeamHome ? awayPts : homePts;
    const oppCodeRaw = isTeamHome ? awayTeam : homeTeam;
    const oppCodeDisplay = oppCodeRaw === 'LA' ? 'LAR' : oppCodeRaw === 'WSH' ? 'WAS' : oppCodeRaw;
    const espnGameId = g.espn && /^\d{6,}$/.test(String(g.espn).trim()) ? String(g.espn).trim() : '';
    const pfrBoxId = g.pfr && /^[0-9a-z]+$/i.test(String(g.pfr).trim()) ? String(g.pfr).trim() : '';
    const homePfrCode = getPfrCodeForHistoricalTeam(homeTeam);
    const dateDigits = gameday.replace(/-/g, '');
    const boxscoreUrl = espnGameId
      ? `https://www.espn.com/nfl/game/_/gameId/${espnGameId}`
      : pfrBoxId
        ? `https://www.pro-football-reference.com/boxscores/${pfrBoxId}.htm`
        : dateDigits.length === 8
          ? `https://www.pro-football-reference.com/boxscores/${dateDigits}0${homePfrCode}.htm`
          : pfrQueryUrl;

    const tied = teamPts === oppPts;
    const teamWon = teamPts > oppPts;
    byDate.set(gameday, {
      season: Number(g.season) || Number(gameday.slice(0, 4)),
      date: gameday,
      venue: g.location === 'Neutral' ? 'Neutral' : isTeamHome ? 'Home' : 'Away',
      scoreDisplay: `${teamNorm} ${teamPts}, ${oppCodeDisplay} ${oppPts}`,
      sfWon: teamWon,
      tied,
      result: tied ? 'T' : teamWon ? 'W' : 'L',
      overtime: String(g.overtime || '').trim() === '1' || Number(g.overtime) === 1,
      boxscoreUrl
    });
  }

  // Merge any completed regular/postseason current-season games from live ESPN schedule
  // that may not yet be synced in nflverse games.csv (e.g. same-day division rematch).
  for (const sg of scheduleGames || []) {
    if (!sg || !sg.completed || sg.isByeWeek) continue;
    if (String(sg.seasonType || 'REG').toUpperCase() === 'PRE') continue;
    const sgOpp = normalizeAnyTeamAbbr(sg.opponent?.abbr || '');
    if (sgOpp !== oppNorm) continue;
    const teamPts = Number(sg.sfScore);
    const oppPts = Number(sg.oppScore);
    if (!Number.isFinite(teamPts) || !Number.isFinite(oppPts)) continue;
    const dateStr = String(sg.dateIso || '').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr) || byDate.has(dateStr)) continue;

    const tied = teamPts === oppPts;
    const teamWon = teamPts > oppPts;
    const espnId = sg.id && /^\d{6,}$/.test(String(sg.id).trim()) ? String(sg.id).trim() : '';
    byDate.set(dateStr, {
      season: Number(sg.season) || Number(dateStr.slice(0, 4)),
      date: dateStr,
      venue: sg.neutralSite ? 'Neutral' : sg.homeAway === 'home' ? 'Home' : 'Away',
      scoreDisplay: `${teamNorm} ${teamPts}, ${oppNorm} ${oppPts}`,
      sfWon: teamWon,
      tied,
      result: tied ? 'T' : teamWon ? 'W' : 'L',
      overtime: /\bOT\b/i.test(String(sg.statusDetail || '')),
      boxscoreUrl: sg.gameUrl || (espnId ? `https://www.espn.com/nfl/game/_/gameId/${espnId}` : pfrQueryUrl)
    });
  }

  const recentGames = [...byDate.values()]
    .sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')))
    .slice(0, Math.max(1, maxGames));

  return {
    allTimeRecord: `${resolvedNickname} vs. ${resolvedOppShort}`,
    recentRecord: formatRecentRecordSummary(recentGames),
    lastMeetingNote: buildLastMeetingNote(recentGames[0] || null, teamNorm, oppNorm),
    pfrQueryUrl,
    recentGames
  };
}

/**
 * Precomputes compact head-to-head Recent Meetings history keyed by opponent abbr
 * for every scheduled opponent so instant post-game week rollovers never blank out.
 */
export function buildScheduleH2hByOpponentMap(
  gamesRows = [],
  teamAbbr = 'SF',
  scheduleGames = [],
  { maxGames = 8, teamNickname = '' } = {}
) {
  const teamNorm = normalizeAnyTeamAbbr(teamAbbr);
  const byOpponent = {};
  const seen = new Set();

  for (const sg of scheduleGames || []) {
    if (!sg || sg.isByeWeek) continue;
    const oppNorm = normalizeAnyTeamAbbr(sg.opponent?.abbr || '');
    if (!oppNorm || oppNorm === 'TBD' || oppNorm === 'BYE' || oppNorm === teamNorm || seen.has(oppNorm)) continue;
    seen.add(oppNorm);
    byOpponent[oppNorm] = buildFranchiseHeadToHeadHistory(gamesRows, teamNorm, oppNorm, {
      maxGames,
      teamNickname,
      oppShortName: sg.opponent?.shortName || '',
      scheduleGames
    });
  }
  return byOpponent;
}

/**
 * Builds a compact, league-wide per-player weekly log index combining nflverse
 * `stats_player_week_{seasonYear}` + `snap_counts_{seasonYear}` + `schedules/games.csv`.
 * Supports all 32 teams and preserves pre-trade weeks for mid-season trade acquisitions.
 */
export function buildWeeklyPlayerLogsIndex({
  statsPlayerWeek = [],
  snapsCurrent = [],
  gamesRows = [],
  seasonYear = 2026
} = {}) {
  // 1. Index current-season games for home/away, score, result, division flag, and ESPN gameId
  const gameByNflverseId = new Map();
  const gameByTeamWeek = new Map();
  for (const g of gamesRows || []) {
    if (!g || Number(g.season) !== Number(seasonYear)) continue;
    const wk = Number(g.week || 0);
    if (wk <= 0) continue;
    const home = normalizeAnyTeamAbbr(g.home_team || '');
    const away = normalizeAnyTeamAbbr(g.away_team || '');
    if (!home || !away) continue;
    const hScore = g.home_score !== '' && g.home_score !== 'NA' ? Number(g.home_score) : null;
    const aScore = g.away_score !== '' && g.away_score !== 'NA' ? Number(g.away_score) : null;
    const espnId = g.espn && /^\d{6,}$/.test(String(g.espn).trim()) ? String(g.espn).trim() : '';
    const isNeutral = String(g.location || '').toLowerCase() === 'neutral';
    const isDiv = String(g.div_game || '') === '1' || Number(g.div_game) === 1;
    const meta = { wk, home, away, hScore, aScore, espnId, isNeutral, isDiv };
    if (g.game_id) gameByNflverseId.set(String(g.game_id), meta);
    gameByTeamWeek.set(`${home}:${wk}`, meta);
    gameByTeamWeek.set(`${away}:${wk}`, meta);
  }

  function resolveGameOutcomeForTeam(teamAbbr, wk, gameId, fallbackOpp = '') {
    const g = (gameId && gameByNflverseId.get(String(gameId))) || gameByTeamWeek.get(`${teamAbbr}:${wk}`) || null;
    if (!g) {
      return {
        opp: normalizeAnyTeamAbbr(fallbackOpp || '') || String(fallbackOpp || ''),
        ha: 'home',
        res: '',
        pf: null,
        pa: null,
        div: false,
        gid: ''
      };
    }
    const isHome = g.home === teamAbbr;
    const opp = isHome ? g.away : g.home;
    const pf = isHome ? g.hScore : g.aScore;
    const pa = isHome ? g.aScore : g.hScore;
    const res =
      Number.isFinite(pf) && Number.isFinite(pa)
        ? pf > pa
          ? 'W'
          : pf < pa
            ? 'L'
            : 'T'
        : '';
    return {
      opp,
      ha: g.isNeutral ? 'neutral' : isHome ? 'home' : 'away',
      res,
      pf: Number.isFinite(pf) ? pf : null,
      pa: Number.isFinite(pa) ? pa : null,
      div: Boolean(g.isDiv),
      gid: g.espnId || ''
    };
  }

  // 2. Index weekly stats by (gsisId -> Map<wk, entry>) and (normName -> Map<wk, entry>)
  const statsByGsis = new Map();
  const statsByName = new Map();
  for (const r of statsPlayerWeek || []) {
    if (!r) continue;
    const st = String(r.season_type || 'REG').toUpperCase();
    if (st !== 'REG' && st !== 'POST') continue;
    const wk = Number(r.week || 0);
    if (wk <= 0) continue;
    const tm = normalizeAnyTeamAbbr(r.team || r.recent_team || '') || String(r.team || '');
    const gOut = resolveGameOutcomeForTeam(tm, wk, r.game_id, r.opponent_team);
    const entry = {
      wk,
      tm,
      opp: gOut.opp,
      ha: gOut.ha,
      ...(gOut.res ? { res: gOut.res } : {}),
      ...(gOut.pf !== null ? { pf: gOut.pf } : {}),
      ...(gOut.pa !== null ? { pa: gOut.pa } : {}),
      ...(gOut.div ? { div: 1 } : {}),
      ...(gOut.gid ? { gid: gOut.gid } : {})
    };

    const setIfNonZero = (k, val, dec = null) => {
      const n = num(val, dec);
      if (n !== 0) entry[k] = n;
    };
    setIfNonZero('pCmp', r.completions);
    setIfNonZero('pAtt', r.attempts);
    setIfNonZero('pYds', r.passing_yards);
    setIfNonZero('pTd', r.passing_tds);
    setIfNonZero('pInt', r.passing_interceptions);
    setIfNonZero('pSck', r.sacks_suffered);
    setIfNonZero('pEpa', r.passing_epa, 2);
    setIfNonZero('rAtt', r.carries);
    setIfNonZero('rYds', r.rushing_yards);
    setIfNonZero('rTd', r.rushing_tds);
    setIfNonZero('rEpa', r.rushing_epa, 2);
    setIfNonZero('rec', r.receptions);
    setIfNonZero('tgt', r.targets);
    setIfNonZero('recYds', r.receiving_yards);
    setIfNonZero('recTd', r.receiving_tds);
    setIfNonZero('recEpa', r.receiving_epa, 2);
    const totTkl = num(r.def_tackles_solo) + num(r.def_tackle_assists) + num(r.def_tackles_with_assist);
    if (totTkl !== 0) entry.tkl = totTkl;
    setIfNonZero('tfl', r.def_tackles_for_loss);
    setIfNonZero('sck', r.def_sacks, 1);
    setIfNonZero('qbh', r.def_qb_hits);
    setIfNonZero('dInt', r.def_interceptions);
    setIfNonZero('pd', r.def_pass_defended);
    setIfNonZero('fgM', r.fg_made);
    setIfNonZero('fgA', r.fg_att);
    setIfNonZero('fgL', r.fg_long);
    setIfNonZero('patM', r.pat_made);
    setIfNonZero('patA', r.pat_att);
    setIfNonZero('ptA', r.pt_att);
    setIfNonZero('ptY', r.pt_yards);
    setIfNonZero('pt20', r.pt_inside_20);

    const gsis = String(r.player_id || '').trim();
    if (gsis) {
      if (!statsByGsis.has(gsis)) statsByGsis.set(gsis, new Map());
      statsByGsis.get(gsis).set(wk, entry);
    }
    const nk = normPlayerName(r.player_display_name || r.player_name);
    if (nk) {
      if (!statsByName.has(nk)) statsByName.set(nk, new Map());
      // Key by team+week when using name to reduce homonym risk, plus plain week fallback
      statsByName.get(nk).set(`${tm}:${wk}`, entry);
      if (!statsByName.get(nk).has(String(wk))) statsByName.get(nk).set(String(wk), entry);
    }
  }

  // 3. Index weekly snaps by pfrId and normName
  const snapsByPfr = new Map();
  const snapsByName = new Map();
  for (const s of snapsCurrent || []) {
    if (!s) continue;
    if (s.game_type && s.game_type !== 'REG' && s.game_type !== 'POST') continue;
    const wk = Number(s.week || 0);
    if (wk <= 0) continue;
    const tm = normalizeAnyTeamAbbr(s.team || '') || String(s.team || '');
    const gOut = resolveGameOutcomeForTeam(tm, wk, s.game_id, s.opponent);
    const oSn = num(s.offense_snaps);
    const oPct = Math.round(num(s.offense_pct) * 100);
    const dSn = num(s.defense_snaps);
    const dPct = Math.round(num(s.defense_pct) * 100);
    const sSn = num(s.st_snaps);
    const sPct = Math.round(num(s.st_pct) * 100);
    if (oSn === 0 && dSn === 0 && sSn === 0 && oPct === 0 && dPct === 0 && sPct === 0) continue;

    const snapObj = {
      wk,
      tm,
      opp: gOut.opp,
      ha: gOut.ha,
      ...(gOut.res ? { res: gOut.res } : {}),
      ...(gOut.pf !== null ? { pf: gOut.pf } : {}),
      ...(gOut.pa !== null ? { pa: gOut.pa } : {}),
      ...(gOut.div ? { div: 1 } : {}),
      ...(gOut.gid ? { gid: gOut.gid } : {}),
      ...(oSn ? { oSn } : {}),
      ...(oPct ? { oPct } : {}),
      ...(dSn ? { dSn } : {}),
      ...(dPct ? { dPct } : {}),
      ...(sSn ? { sSn } : {}),
      ...(sPct ? { sPct } : {})
    };

    const pfr = String(s.pfr_player_id || '').trim();
    if (pfr) {
      if (!snapsByPfr.has(pfr)) snapsByPfr.set(pfr, new Map());
      snapsByPfr.get(pfr).set(wk, snapObj);
    }
    const nk = normPlayerName(s.player);
    if (nk) {
      if (!snapsByName.has(nk)) snapsByName.set(nk, new Map());
      snapsByName.get(nk).set(`${tm}:${wk}`, snapObj);
      if (!snapsByName.get(nk).has(String(wk))) snapsByName.get(nk).set(String(wk), snapObj);
    }
  }

  return { statsByGsis, statsByName, snapsByPfr, snapsByName };
}

/**
 * Merges a single player's weekly stats + weekly snap counts into a compact sorted array.
 */
export function resolvePlayerWeeklyLog(
  weeklyIndex,
  { gsisId = '', pfrId = '', name = '', teamAbbr = 'SF' } = {}
) {
  if (!weeklyIndex) return [];
  const normTeam = normalizeAnyTeamAbbr(teamAbbr || '') || teamAbbr;
  const nk = normPlayerName(name);

  // Pull stat weeks (prefer exact GSIS ID to avoid homonyms; fallback to team-matched name)
  const byWeek = new Map();
  const statMap =
    (gsisId && weeklyIndex.statsByGsis?.get(String(gsisId))) ||
    null;
  if (statMap) {
    for (const [wk, entry] of statMap.entries()) {
      byWeek.set(Number(wk), { ...entry });
    }
  } else if (nk && weeklyIndex.statsByName?.has(nk)) {
    const nmMap = weeklyIndex.statsByName.get(nk);
    for (const [k, entry] of nmMap.entries()) {
      if (k.includes(':')) {
        const [kTm, kWk] = k.split(':');
        if (kTm === normTeam) byWeek.set(Number(kWk), { ...entry });
      }
    }
    if (byWeek.size === 0) {
      for (const [k, entry] of nmMap.entries()) {
        if (!k.includes(':')) byWeek.set(Number(k), { ...entry });
      }
    }
  }

  // Merge snap weeks (prefer exact PFR ID; fallback to team-matched name)
  const snapMap = (pfrId && weeklyIndex.snapsByPfr?.get(String(pfrId))) || null;
  const applySnapEntry = sObj => {
    const wk = Number(sObj.wk);
    const existing = byWeek.get(wk);
    if (existing) {
      if (sObj.oSn) existing.oSn = sObj.oSn;
      if (sObj.oPct) existing.oPct = sObj.oPct;
      if (sObj.dSn) existing.dSn = sObj.dSn;
      if (sObj.dPct) existing.dPct = sObj.dPct;
      if (sObj.sSn) existing.sSn = sObj.sSn;
      if (sObj.sPct) existing.sPct = sObj.sPct;
      if (!existing.gid && sObj.gid) existing.gid = sObj.gid;
    } else {
      byWeek.set(wk, { ...sObj });
    }
  };

  if (snapMap) {
    for (const sObj of snapMap.values()) applySnapEntry(sObj);
  } else if (nk && weeklyIndex.snapsByName?.has(nk)) {
    const nmSnap = weeklyIndex.snapsByName.get(nk);
    let matchedTeam = false;
    for (const [k, sObj] of nmSnap.entries()) {
      if (k.includes(':') && k.startsWith(`${normTeam}:`)) {
        applySnapEntry(sObj);
        matchedTeam = true;
      }
    }
    if (!matchedTeam) {
      for (const [k, sObj] of nmSnap.entries()) {
        if (!k.includes(':')) applySnapEntry(sObj);
      }
    }
  }

  return [...byWeek.values()]
    .sort((a, b) => a.wk - b.wk)
    .map(w => {
      // Strip redundant `tm` when it matches current team to keep JSON lean
      const out = { ...w };
      if (out.tm === normTeam) delete out.tm;
      return out;
    });
}

const openMeteoCache = new Map();

/**
 * Fetches kickoff-hour outdoor weather forecast from Open-Meteo (free, zero API key, ~150ms)
 * strictly for outdoor venues within 14 days of kickoff. Returns null for indoor domes or errors.
 */
export async function fetchKickoffOutdoorWeather(kickoffIso, stadiumMeta) {
  if (!kickoffIso || !stadiumMeta || stadiumMeta.isIndoor) return null;
  const koMs = Date.parse(kickoffIso);
  if (!Number.isFinite(koMs)) return null;
  const nowMs = Date.now();
  const diffDays = (koMs - nowMs) / 86_400_000;
  // Open-Meteo forecast covers [-1d, +14d]
  if (diffDays < -1 || diffDays > 14) return null;

  const lat = Number(stadiumMeta.lat);
  const lon = Number(stadiumMeta.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;

  const targetDate = new Date(koMs);
  const targetHourIso = `${targetDate.toISOString().slice(0, 13)}:00`;
  const cacheKey = `${lat.toFixed(2)},${lon.toFixed(2)}:${targetHourIso}`;
  if (openMeteoCache.has(cacheKey)) return openMeteoCache.get(cacheKey);

  try {
    const url =
      `https://api.open-meteo.com/v1/forecast?latitude=${lat.toFixed(4)}&longitude=${lon.toFixed(4)}` +
      `&hourly=temperature_2m,wind_speed_10m,wind_direction_10m,precipitation_probability,weather_code` +
      `&temperature_unit=fahrenheit&wind_speed_unit=mph&timezone=UTC&forecast_days=16`;
    const res = await fetch(url, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(4000)
    });
    if (!res.ok) return null;
    const json = await res.json();
    const times = Array.isArray(json?.hourly?.time) ? json.hourly.time : [];
    const idx = times.indexOf(targetHourIso);
    if (idx < 0) return null;

    const tempF = Math.round(Number(json.hourly.temperature_2m?.[idx]));
    if (!Number.isFinite(tempF)) return null;
    const windMph = Math.round(Number(json.hourly.wind_speed_10m?.[idx] ?? 0));
    const windDir = windDegreesToCompass(json.hourly.wind_direction_10m?.[idx]);
    const precipPct = Math.round(Number(json.hourly.precipitation_probability?.[idx] ?? 0));
    const condition = wmoCodeToShortCondition(json.hourly.weather_code?.[idx]);

    const result = {
      indoor: false,
      tempF,
      windMph: Number.isFinite(windMph) ? windMph : null,
      windDir,
      precipPct: Number.isFinite(precipPct) ? precipPct : null,
      condition,
      altitudeFt: stadiumMeta.altitudeFt || 0,
      source: 'open-meteo',
      forecastHourUtc: targetHourIso
    };
    openMeteoCache.set(cacheKey, result);
    return result;
  } catch {
    return null;
  }
}
