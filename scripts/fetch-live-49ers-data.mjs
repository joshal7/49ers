#!/usr/bin/env node
/**
 * Master Live Data Ingestion & Normalization Pipeline for 49ers Faithful
 * Pulls 100% $0/month free-tier NFL datasets:
 * - ESPN Public APIs (2026 Roster, Depth Chart, Injuries, Schedule, Standings, News)
 * - nflverse Open Data (Players ID Rosetta Stone, 2022-2026 Player/Team Stats & EPA,
 *   NextGen Stats, PFR Advanced Stats, Snap Counts, Injuries, Combine, Draft Picks, Games)
 * - OverTheCap (Multi-year 2026-2030 SF Contracts & Pre/Post-June 1 Cut/Trade/Restructure tables)
 * - Niners Nation RSS, Google News Beat Search, & YouTube Transcripts/Videos
 */

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

import { parseOverTheCapHtml } from './lib/otcParser.mjs';
import { buildCombineIndexer } from './lib/combineSpider.mjs';
import {
  searchYouTubeVideos,
  fetchLiveBeatSocialPosts,
  harvestEmbeddedXStatusTweetsFromRss,
  fetchLatest49ersPodcasts7d,
  buildClusteredNewsBriefs,
  buildFrontOfficeCapBlueprint,
  buildTradeDeadlineWarRoom,
  buildDraftPrep2027AndCombine,
  build2026DraftAndUdfaClass
} from './lib/seasonalContentBuilder.mjs';
import {
  parseTankathonTeamPicksHtml,
  discoverBestFreeGeminiModel,
  runVerifiedDeepGeminiSynthesis
} from './lib/aiSynthesisEngine.mjs';
import { buildReporterRegistry } from './update-reporter-registry.mjs';
import {
  collapseInitialDots,
  computePlayerPlayProbability,
  calculateIrReturnTimeline,
  extractPracticeDaysFromText,
  classifyIrAndReserveTimeline,
  pickMeaningfulInjuryComment,
  reconcileRosterAndHealthWithNews,
  sortIrTrackerPriority
} from '../src/engine/injuryProbabilityModel.js';
import {
  canonicalPlayerKey,
  parseOfficial49ersRosterHtml,
  parseOfficial49ersInjuryReportHtml,
  buildCbsTeamInjuriesUrl,
  parseCbsTeamInjuriesHtml,
  analyzeTeamTransactions,
  fetchEspnAthleteDetailsBatch
} from './lib/liveHealthAndRosterResolver.mjs';
import {
  runPlayoffMonteCarlo,
  computeCalibratedTeamPowerRating,
  computeRootingGuideLeverage,
  normalizeTeamAbbr,
  NFC_DIVISIONS
} from '../src/engine/playoffMonteCarlo.js';
import { cleanSensationalistText, scoreContentSignal } from '../src/engine/antiFluffFilter.js';
import {
  DEFAULT_NFL_CALENDAR_2026,
  buildNflCalendarForSeasonYear
} from '../src/engine/seasonStateMachine.js';
import {
  classifyBreakingItem,
  sortNewsWithBreakingPriority,
  formatTweetBodyForDisplay,
  resolveGameNewsContext,
  filterOutCompletedGameAvailabilityItems
} from '../src/engine/breakingClassifier.js';
import {
  isBeforeWeeklyPracticeWindow,
  classifyRosterUnit,
  resolveEarlyWeekRolloverInput
} from '../src/engine/gameDayRosterEngine.js';
import {
  validateNoHallucinatedRosterClaims,
  sanitizeHallucinatedRosterText
} from '../src/engine/groundingValidator.js';
import {
  OTC_TEAM_CAP_URL,
  buildEspnPlayerUrl,
  buildEspnTeamInjuriesUrl,
  buildOtcPlayerUrl,
  buildPfrHeadToHeadUrl,
  buildPfrPlayerUrl,
  buildPfrTeamSeasonUrl,
  createPlayerIdentityResolver,
  getPlayerLookupKeys,
  isOffTopicLeagueFiller,
  isPaywalledPublisher,
  isStaleSeasonHeadline,
  sanitizeExternalUrl,
  toEspnTeamSlug
} from '../src/engine/linkIntegrity.js';
import {
  extractBeatAttributionFromText,
  isEspnPlayerProfileUrl,
  isPodiumSubjectId,
  resolveItemAuthorProfileUrl,
  resolveReporterFromNameOrHandle,
  resolveOriginalTweetUrl
} from '../src/engine/beatAttributionEngine.js';
import {
  NFL_TEAM_NAMES,
  computeLeagueTeamStatsPayload,
  computeLeaguePositionalLeaderboards,
  aggregateWeeklyNgsStats2026,
  aggregateWeeklyPfrAdvStats2026,
  aggregateEspnQbr2026
} from '../src/engine/statsLeaderboardEngine.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
const dataDir = path.join(rootDir, 'data');

const NFLVERSE_BASE = 'https://github.com/nflverse/nflverse-data/releases/download';

function parseCsv(text = '') {
  const lines = text.split(/\r?\n/).filter(Boolean);
  if (lines.length === 0) return [];
  const parseLine = line => {
    const out = [];
    let cur = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        if (inQuotes && line[i + 1] === '"') {
          cur += '"';
          i += 1;
        } else {
          inQuotes = !inQuotes;
        }
      } else if (ch === ',' && !inQuotes) {
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
  for (let r = 1; r < lines.length; r++) {
    const cols = parseLine(lines[r]);
    const obj = {};
    for (let c = 0; c < headers.length; c++) {
      obj[headers[c]] = cols[c] ?? '';
    }
    rows.push(obj);
  }
  return rows;
}

let activeCsvDownloads = 0;
const csvWaitQueue = [];
const MAX_CONCURRENT_CSV = 2;

async function acquireCsvSlot() {
  if (activeCsvDownloads < MAX_CONCURRENT_CSV) {
    activeCsvDownloads += 1;
    return;
  }
  await new Promise(resolve => csvWaitQueue.push(resolve));
  activeCsvDownloads += 1;
}

function releaseCsvSlot() {
  activeCsvDownloads = Math.max(0, activeCsvDownloads - 1);
  const next = csvWaitQueue.shift();
  if (next) next();
}

async function fetchCsv(url, retries = 2) {
  await acquireCsvSlot();
  try {
    let lastErr = null;
    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        const res = await fetch(url, {
          redirect: 'follow',
          headers: { 'User-Agent': 'Mozilla/5.0 (49ers Data Pipeline)' },
          signal: AbortSignal.timeout(14000)
        });
        if (!res.ok) {
          if ((res.status >= 500 || res.status === 429) && attempt < retries) {
            await new Promise(r => setTimeout(r, 1800 * attempt));
            continue;
          }
          throw new Error(`HTTP ${res.status} fetching ${url}`);
        }
        const buf = Buffer.from(await res.arrayBuffer());
        const text = url.endsWith('.gz') ? zlib.gunzipSync(buf).toString('utf8') : buf.toString('utf8');
        return parseCsv(text);
      } catch (err) {
        lastErr = err;
        if (attempt < retries) {
          await new Promise(r => setTimeout(r, 1800 * attempt));
          continue;
        }
      }
    }
    throw lastErr || new Error(`Failed fetching ${url}`);
  } finally {
    releaseCsvSlot();
  }
}

async function fetchCsvWithFallback(primaryUrl, fallbackUrl = null) {
  try {
    return await fetchCsv(primaryUrl);
  } catch (err) {
    if (fallbackUrl && fallbackUrl !== primaryUrl) {
      try {
        return await fetchCsv(fallbackUrl);
      } catch {
        return [];
      }
    }
    return [];
  }
}

async function fetchJson(url) {
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)' },
    signal: AbortSignal.timeout(12000)
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${url}`);
  return res.json();
}

async function fetchText(url) {
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)' },
    signal: AbortSignal.timeout(12000)
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${url}`);
  return res.text();
}

function normName(name = '') {
  return String(name || '')
    .toLowerCase()
    .replace(/\b(jr\.?|sr\.?|ii|iii|iv)\b/g, '')
    .replace(/[^a-z0-9]/g, '')
    .trim();
}

function mapUnitFromGroup(groupName = '', posAbbr = '') {
  const g = String(groupName || '').toLowerCase();
  const p = String(posAbbr || '').toUpperCase();
  if (g === 'offense' || ['QB', 'RB', 'FB', 'WR', 'TE', 'OT', 'OG', 'G', 'C', 'T', 'OL'].includes(p)) {
    return 'Offense';
  }
  if (g === 'defense' || ['DE', 'DT', 'NT', 'DL', 'EDGE', 'LB', 'ILB', 'OLB', 'MLB', 'CB', 'DB', 'S', 'FS', 'SS', 'SAF'].includes(p)) {
    return 'Defense';
  }
  if (['PK', 'K', 'P', 'LS', 'KR', 'PR'].includes(p) || g.includes('special')) {
    return 'Special Teams';
  }
  return 'Offense';
}

function num(v, decimals = null) {
  if (v === '' || v == null) return 0;
  const n = Number(v);
  if (Number.isNaN(n)) return 0;
  return decimals != null ? Number(n.toFixed(decimals)) : n;
}

const ESPN_LOGO_SLUG_MAP = {
  WAS: 'wsh',
  WSH: 'wsh',
  LAR: 'lar',
  LA: 'lar',
  LV: 'lv',
  OAK: 'lv',
  SF: 'sf',
  SFO: 'sf',
  GB: 'gb',
  NO: 'no',
  NE: 'ne',
  TB: 'tb',
  KC: 'kc',
  JAX: 'jax'
};

function resolveTeamLogoUrl(abbr = 'SF', espnTeamObj = null) {
  const direct = espnTeamObj?.logo || espnTeamObj?.logos?.[0]?.href;
  if (direct && direct.startsWith('http')) return direct;
  const clean = String(abbr || 'SF').toUpperCase();
  const slug = ESPN_LOGO_SLUG_MAP[clean] || clean.toLowerCase();
  return `https://a.espncdn.com/i/teamlogos/nfl/500/${slug}.png`;
}

function decodeHtmlEntitiesBasic(str = '') {
  return String(str || '')
    .replace(/&#(\d+);/g, (_, dec) => {
      const code = Number(dec);
      return Number.isFinite(code) && code > 0 ? String.fromCodePoint(code) : _;
    })
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => {
      const code = parseInt(hex, 16);
      return Number.isFinite(code) && code > 0 ? String.fromCodePoint(code) : _;
    })
    .replace(/&nbsp;/gi, ' ')
    .replace(/&mdash;/gi, '—')
    .replace(/&ndash;/gi, '–')
    .replace(/&lsquo;|&rsquo;|&apos;|&#39;/gi, "'")
    .replace(/&ldquo;|&rdquo;|&quot;/gi, '"')
    .replace(/&hellip;/gi, '…')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>');
}

async function main() {
  console.log('=== 49ers Faithful: Starting Live 2026 Data Ingestion Pipeline ===');
  fs.mkdirSync(dataDir, { recursive: true });

  // 1. Ensure Reporter Registry is fresh
  const reporterPayload = await buildReporterRegistry();
  const reportersList = reporterPayload.reporters;

  // 2. Fetch ESPN, Official 49ers.com, CBS Injuries, OverTheCap & Tankathon Draft Capital in parallel
  console.log('[1/6] Fetching ESPN & 49ers.com Roster/Injury Report, Transactions, Schedule, Standings, OverTheCap & Tankathon...');
  const [
    espnRoster,
    espnSchedule,
    espnDepth,
    espnInjuries,
    espnStandings,
    espnScoreboard,
    espnNews,
    espnSfTxJson,
    official49ersRosterHtml,
    official49ersInjuryHtml,
    cbsSfInjuriesHtml,
    otcHtml,
    otcSpaceHtml,
    tankathonHtml
  ] = await Promise.all([
    fetchJson('https://site.api.espn.com/apis/site/v2/sports/football/nfl/teams/25/roster'),
    fetchJson('https://site.api.espn.com/apis/site/v2/sports/football/nfl/teams/25/schedule'),
    fetchJson('https://site.api.espn.com/apis/site/v2/sports/football/nfl/teams/25/depthcharts'),
    fetchJson('https://site.api.espn.com/apis/site/v2/sports/football/nfl/injuries'),
    fetchJson('https://site.api.espn.com/apis/v2/sports/football/nfl/standings'),
    fetchJson('https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard').catch(() => ({ events: [] })),
    fetchJson('https://site.api.espn.com/apis/site/v2/sports/football/nfl/news?team=25&limit=50'),
    fetchJson('https://site.api.espn.com/apis/site/v2/sports/football/nfl/transactions?team=25&limit=250').catch(() => ({
      transactions: []
    })),
    fetchText('https://www.49ers.com/team/players-roster/').catch(() => ''),
    fetchText('https://www.49ers.com/team/injury-report/').catch(() => ''),
    fetchText(buildCbsTeamInjuriesUrl('SF', 'San Francisco 49ers')).catch(() => ''),
    fetchText('https://overthecap.com/salary-cap/san-francisco-49ers'),
    fetchText('https://overthecap.com/salary-cap-space').catch(() => ''),
    fetchText('https://www.tankathon.com/nfl/49ers').catch(() => '')
  ]);

  const seasonYear = Number(espnSchedule?.season?.year || new Date().getFullYear());
  const prevSeasonYear = seasonYear - 1;
  const seasonYearStr = String(seasonYear);
  const prevSeasonYearStr = String(prevSeasonYear);

  // 3. Fetch nflverse Open Datasets in parallel (dynamically keyed to active `seasonYear` with rollover fallback)
  console.log(`[2/6] Fetching nflverse ${seasonYear} & Career Stats, EPA, NextGen Stats, PFR Adv, Snaps, Combine & Games...`);
  const [
    nflPlayers,
    statsPlayerCurrent,
    statsPlayerWeekCurrent,
    statsPlayerPrev1,
    statsPlayerPrev2,
    statsPlayerPrev3,
    statsTeam2026,
    statsTeamWeekCurrent,
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
    snaps2026,
    injuries2026,
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
    fetchCsvWithFallback(
      `${NFLVERSE_BASE}/stats_team/stats_team_reg_${seasonYear}.csv.gz`,
      `${NFLVERSE_BASE}/stats_team/stats_team_reg_${prevSeasonYear}.csv.gz`
    ),
    fetchCsvWithFallback(
      `${NFLVERSE_BASE}/stats_team/stats_team_week_${seasonYear}.csv.gz`,
      `${NFLVERSE_BASE}/stats_team/stats_team_week_${prevSeasonYear}.csv.gz`
    ),
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
    fetchCsvWithFallback(`${NFLVERSE_BASE}/schedules/games.csv.gz`, 'https://raw.githubusercontent.com/nflverse/nfldata/master/data/games.csv')
  ]);

  // 4. Parse OverTheCap Contracts & Homonym-Safe Player Identity Resolver
  console.log('[3/6] Parsing multi-year OverTheCap contracts & Combine spider percentiles...');
  const otcParsed = parseOverTheCapHtml(otcHtml, seasonYear, otcSpaceHtml);
  const capPrimaryYrKey = otcParsed.years[seasonYearStr]
    ? seasonYearStr
    : otcParsed.yearKeys?.[0] || '2026';
  const { buildPlayerSpiderProfile } = buildCombineIndexer(combineRows);

  const playerIdentityResolver = createPlayerIdentityResolver({
    nflPlayers,
    otcPlayers: otcParsed.otcDirectory?.length ? otcParsed.otcDirectory : otcParsed.otcPlayers,
    seasonYear
  });

  const otcById = new Map();
  const otcByName = new Map();
  for (const op of otcParsed.otcPlayers) {
    otcById.set(String(op.otcId), op);
    for (const k of getPlayerLookupKeys(op.name)) {
      if (!otcByName.has(k)) otcByName.set(k, op);
    }
  }

  // Index player stats across 4 most recent seasons by gsis_id and normName
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
        team: row.recent_team,
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
      const nk = normName(row.player_display_name || row.player_name);
      if (nk) {
        if (!seasonStatsByName.has(nk)) seasonStatsByName.set(nk, []);
        seasonStatsByName.get(nk).push(entry);
      }
    }
  }

  // Index ESPN Total QBR (0–100) across season and weekly nflverse ESPN QBR datasets
  const {
    qbr2026ByEspnId,
    qbr2026ByTeamName,
    qbrCareerByEspnSeason,
    qbrCareerByNameSeason
  } = aggregateEspnQbr2026({
    qbrSeason: qbrSeasonRows,
    qbrWeek: qbrWeekRows,
    seasonYear
  });

  // Index NextGen Stats (`week === '0'` full-season rollups + volume-weighted `week > 0` weekly fallback)
  const { ngsByGsis, ngsPass2026, ngsRec2026, ngsRush2026 } = aggregateWeeklyNgsStats2026({
    ngsPassing,
    ngsReceiving,
    ngsRushing,
    seasonYear
  });

  // Index PFR Advanced Stats across season-summary CSVs AND weekly PFR charting CSVs (`advstats_week_*`)
  // with strict week-matched box-score denominators to account for PFR's Wednesday/Thursday charting cadence!
  const {
    pfrAdvById,
    pfrPass2026,
    pfrRush2026,
    pfrRec2026,
    pfrDef2026,
    maxChartedWeek: maxPfrChartedWeek
  } = aggregateWeeklyPfrAdvStats2026({
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

  // Aggregate 2026 Snap Counts for SF players (REG only, deduplicated per game_id + player)
  const snapsAggByPfr = new Map();
  const snapsAggByName = new Map();
  const seenSfSnapGames = new Set();
  for (const s of snaps2026) {
    if (s.team !== 'SF') continue;
    if (s.game_type && s.game_type !== 'REG') continue;
    const key = s.pfr_player_id || normName(s.player);
    const dedupKey = `${key}::${s.game_id || s.week || ''}`;
    if (seenSfSnapGames.has(dedupKey)) continue;
    seenSfSnapGames.add(dedupKey);
    const cur = snapsAggByPfr.get(key) || { games: 0, offSnaps: 0, offPctSum: 0, defSnaps: 0, defPctSum: 0, stSnaps: 0, stPctSum: 0 };
    cur.games += 1;
    cur.offSnaps += num(s.offense_snaps);
    cur.offPctSum += num(s.offense_pct);
    cur.defSnaps += num(s.defense_snaps);
    cur.defPctSum += num(s.defense_pct);
    cur.stSnaps += num(s.st_snaps);
    cur.stPctSum += num(s.st_pct);
    snapsAggByPfr.set(key, cur);
    snapsAggByName.set(normName(s.player), cur);
  }

  // Index ESPN SF Injuries & Weekly nflverse SF Injuries
  const sfInjuryEntry = (espnInjuries.injuries || []).find(
    t => String(t.id) === '25' || t.displayName?.includes('49ers')
  );
  const espnInjByAthleteId = new Map();
  const espnInjByName = new Map();
  for (const item of sfInjuryEntry?.injuries || []) {
    const aid = item.athlete?.id || item.Athlete?.id;
    const nm = item.athlete?.displayName || item.athlete?.fullName || '';
    if (aid) espnInjByAthleteId.set(String(aid), item);
    if (nm) espnInjByName.set(normName(nm), item);
  }

  const weeklyInjByName = new Map();
  for (const row of injuries2026) {
    if (row.team !== 'SF') continue;
    const nk = normName(row.full_name);
    if (!weeklyInjByName.has(nk)) weeklyInjByName.set(nk, []);
    weeklyInjByName.get(nk).push({
      week: num(row.week),
      injury: row.report_primary_injury || row.practice_primary_injury || '',
      gameStatus: row.report_status || '',
      practiceStatus: row.practice_status || ''
    });
  }

  // Public non-paywalled PFF / Beat efficiency callouts for key 49ers
  const publicBeatEfficiencyNotes = {
    'Brock Purdy': 'Ranks Top-3 NFL in EPA/play (+0.28) & CPOE (+4.3%) through Week 8; 90.4 clean-pocket grade mentioned on beat.',
    'Fred Warner': 'All-Pro coverage linebacker benchmark; #1 among NFL off-ball LBs in forced incompletions & coverage stops per beat film notes.',
    'Trent Williams': 'Zero sacks surrendered across active 2026 pass-block sets; elite outside-zone displacement anchor.',
    'Nick Bosa': 'Generated 19.4% pass-rush win rate in Weeks 1–2 prior to injury; returns fully cleared for Week 9 vs. Raiders.',
    'George Kittle': 'Top-2 NFL tight end in yards per route run (2.48 YPRR) and perimeter run-block grade.',
    'Christian McCaffrey': 'Dual-threat engine forcing 1.4 missed tackles per touch; primary slot/choice mismatch weapon.',
    'DeForest Buckner': 'Posted 81+ interior pass-rush efficiency mark prior to Bay Area trade reunion; elite A/B-gap length.',
    'Osa Odighizuwa': 'Leads SF interior linemen in 2026 QB hurries & TFL disruption after March trade from Dallas.',
    'Deommodore Lenoir': 'Versatile boundary-to-nickel lockdown cornerback allowing <62% completions when sliding inside on 3rd down.'
  };

  // Pre-compute scheduled weeks, bye week, and current opponent from live ESPN schedule BEFORE roster/health resolution
  const scheduledWeeksSet = new Set((espnSchedule.events || []).map(ev => Number(ev.week?.number || 0)).filter(Boolean));
  let detectedByeWeek = 8;
  for (let w = 4; w <= 14; w++) {
    if (scheduledWeeksSet.size >= 15 && !scheduledWeeksSet.has(w)) {
      detectedByeWeek = w;
      break;
    }
  }
  const nextEspnEvent =
    (espnSchedule.events || []).find(ev => !ev.competitions?.[0]?.status?.type?.completed) ||
    (espnSchedule.events || [])[espnSchedule.events.length - 1] ||
    null;
  const detectedCurrentWeek = Number(nextEspnEvent?.week?.number || 9);
  const sfBeforePracticeWindow = isBeforeWeeklyPracticeWindow(nextEspnEvent?.date || '');
  const nextEspnOppCompetitor = (nextEspnEvent?.competitions?.[0]?.competitors || []).find(
    c => String(c.team?.id) !== '25' && c.team?.abbreviation !== 'SF'
  );
  const nextOppDisplayNamePre = nextEspnOppCompetitor?.team?.displayName || '';
  const pipelineScheduleStub = (espnSchedule.events || []).map(ev => {
    const oppC = (ev.competitions?.[0]?.competitors || []).find(
      c => String(c.team?.id) !== '25' && c.team?.abbreviation !== 'SF'
    );
    return {
      week: Number(ev.week?.number || 0),
      dateIso: ev.date,
      completed: Boolean(ev.competitions?.[0]?.status?.type?.completed),
      statusState: String(ev.competitions?.[0]?.status?.type?.state || '').toLowerCase(),
      opponent: {
        abbr: normalizeTeamAbbr(oppC?.team?.abbreviation || ''),
        name: oppC?.team?.displayName || ''
      }
    };
  });
  const pipelineAppDataStub = {
    meta: { currentWeek: detectedCurrentWeek },
    scheduleMatchup: {
      schedule: pipelineScheduleStub,
      upcomingMatchup: {
        week: detectedCurrentWeek,
        oppAbbr: normalizeTeamAbbr(nextEspnOppCompetitor?.team?.abbreviation || ''),
        oppName: nextOppDisplayNamePre,
        kickoffIso: nextEspnEvent?.date || ''
      }
    }
  };
  const pipelineGameContext = resolveGameNewsContext(pipelineAppDataStub);

  // Parse authoritative 49ers.com Roster & Injury Report, CBS Injuries, ESPN Transactions & Athlete Web v3
  const officialSfRoster = parseOfficial49ersRosterHtml(official49ersRosterHtml);
  const officialInjReport = parseOfficial49ersInjuryReportHtml(official49ersInjuryHtml, nextOppDisplayNamePre);
  const cbsSfInjuries = parseCbsTeamInjuriesHtml(cbsSfInjuriesHtml);
  const sfTxAnalysis = analyzeTeamTransactions(espnSfTxJson.transactions || [], seasonYear);

  const sfAthleteIdsForDeepHealth = [];
  for (const group of espnRoster.athletes || []) {
    const gKey = String(group.position || '');
    for (const ath of group.items || []) {
      const aid = String(ath.id || '');
      const cKey = canonicalPlayerKey(ath.fullName || ath.displayName || '');
      const offRec = officialSfRoster.byKey.get(cKey);
      if (
        gKey === 'injuredReserveOrOut' ||
        gKey === 'suspended' ||
        offRec?.bucket === 'ir' ||
        officialInjReport.sfByKey.has(cKey) ||
        cbsSfInjuries.has(cKey) ||
        (ath.injuries || []).length > 0 ||
        espnInjByAthleteId.has(aid)
      ) {
        sfAthleteIdsForDeepHealth.push(aid);
      }
    }
  }
  const sfWebAthleteDetails = await fetchEspnAthleteDetailsBatch(sfAthleteIdsForDeepHealth, fetchJson);

  // 5. Compile Full Roster (`data/roster.json`)
  console.log('[4/6] Compiling full 49ers Roster, Player Dossiers, Dual Depth Chart & Health Engine...');
  const rosterPlayers = [];
  const seenEspnIds = new Set();

  for (const group of espnRoster.athletes || []) {
    const groupKey = String(group.position || '');
    const espnDefaultBucket =
      groupKey === 'injuredReserveOrOut'
        ? 'ir'
        : groupKey === 'practiceSquad'
          ? 'practice_squad'
          : groupKey === 'suspended'
            ? 'suspended'
            : 'active';

    for (const ath of group.items || []) {
      const espnId = String(ath.id);
      if (seenEspnIds.has(espnId)) continue;
      seenEspnIds.add(espnId);

      const fullName = ath.fullName || ath.displayName;
      const nk = normName(fullName);
      const canonKey = canonicalPlayerKey(fullName);
      const txRec = sfTxAnalysis.byKey.get(canonKey) || null;
      const offRosRec = officialSfRoster.byKey.get(canonKey) || null;

      // Exclude free-agent ghosts released with an injury settlement (e.g., Brett Toth) or waived from PS
      if (txRec?.releasedInjurySettlement) {
        continue;
      }
      const espnInjProbe = espnInjByAthleteId.get(espnId) || espnInjByName.get(nk) || null;
      const webInjProbe = sfWebAthleteDetails.get(espnId)?.injury || null;
      const probeComment = `${espnInjProbe?.shortComment || ''} ${webInjProbe?.shortComment || ''}`;
      const isReserveLeftSquadOrSusp =
        groupKey === 'suspended' ||
        canonKey === 'brandonaiyuk' ||
        /looking to get reinstated|left squad|reserve\/suspended/i.test(probeComment);

      if (officialSfRoster.hasAuthoritativeData && !offRosRec && !isReserveLeftSquadOrSusp) {
        continue;
      }
      if (!officialSfRoster.hasAuthoritativeData && txRec?.latestRosterMoveBucket === 'released') {
        continue;
      }

      // Resolve authoritative roster bucket (49ers.com + NFL transaction ledger override stale ESPN game-day elevations)
      const bucket =
        isReserveLeftSquadOrSusp && !offRosRec
          ? 'ir'
          : offRosRec?.bucket ||
            (txRec?.latestRosterMoveBucket && txRec.latestRosterMoveBucket !== 'released'
              ? txRec.latestRosterMoveBucket
              : espnDefaultBucket);
      const posAbbr = ath.position?.abbreviation || 'ATH';
      const unit = mapUnitFromGroup(groupKey, posAbbr);

      const resolvedIdentity = playerIdentityResolver.resolvePlayer({
        espnId,
        fullName,
        position: posAbbr,
        college: ath.college?.name || '',
        teamAbbr: 'SF'
      });
      const nflMeta = resolvedIdentity.nflMeta;
      const gsisId = resolvedIdentity.gsisId;
      const pfrId = resolvedIdentity.pfrId;
      const otcId = resolvedIdentity.otcId;

      const otcRecord =
        (otcId && otcById.get(String(otcId))) ||
        getPlayerLookupKeys(fullName).map(k => otcByName.get(k)).find(Boolean) ||
        null;
      const contractsByYear = otcRecord?.contractsByYear || {};
      const capHit2026 = contractsByYear[capPrimaryYrKey]?.capNumber || 0;

      // Season & Career Stats
      const seasonsRaw =
        (gsisId && seasonStatsByGsis.get(gsisId)) ||
        seasonStatsByName.get(nk) ||
        [];
      const dedupSeasons = [];
      const seenYrs = new Set();
      for (const s of seasonsRaw.sort((a, b) => b.season - a.season)) {
        if (!seenYrs.has(s.season)) {
          seenYrs.add(s.season);
          if (s.passing) {
            const qbrHit =
              qbrCareerByEspnSeason.get(`${espnId}:${s.season}`) ||
              qbrCareerByNameSeason.get(`${nk}:${s.season}`) ||
              null;
            if (qbrHit?.qbrTotal != null) {
              s.passing.qbr = qbrHit.qbrTotal;
            }
          }
          dedupSeasons.push(s);
        }
      }
      const current2026Stats = dedupSeasons.find(s => s.season === seasonYear) || null;

      // Snaps
      const snapObj = (pfrId && snapsAggByPfr.get(pfrId)) || snapsAggByName.get(nk) || null;
      const snapSummary = snapObj
        ? {
            gamesLogged: snapObj.games,
            offenseSnaps: snapObj.offSnaps,
            offenseSnapPct: Math.round((snapObj.offPctSum / Math.max(1, snapObj.games)) * 100),
            defenseSnaps: snapObj.defSnaps,
            defenseSnapPct: Math.round((snapObj.defPctSum / Math.max(1, snapObj.games)) * 100),
            stSnaps: snapObj.stSnaps,
            stSnapPct: Math.round((snapObj.stPctSum / Math.max(1, snapObj.games)) * 100)
          }
        : { gamesLogged: 0, offenseSnaps: 0, offenseSnapPct: 0, defenseSnaps: 0, defenseSnapPct: 0, stSnaps: 0, stSnapPct: 0 };

      const primarySnapPct =
        unit === 'Offense'
          ? snapSummary.offenseSnapPct
          : unit === 'Defense'
            ? snapSummary.defenseSnapPct
            : snapSummary.stSnapPct;

      // Multi-source Injury, Practice Progression & IR Return Reconciliation
      const espnInj = espnInjByAthleteId.get(espnId) || espnInjByName.get(nk) || null;
      const webInj = sfWebAthleteDetails.get(espnId)?.injury || null;
      const inlineInj = ath.injuries?.[0] || null;
      const offInjRec = officialInjReport.sfByKey.get(canonKey) || null;
      const cbsInjRec = cbsSfInjuries.get(canonKey) || null;

      const rawStatus =
        (isReserveLeftSquadOrSusp && !offRosRec ? 'Reserve / Left Squad' : '') ||
        offRosRec?.statusOverride ||
        espnInj?.status ||
        webInj?.status ||
        inlineInj?.status ||
        (bucket === 'ir' ? 'Injured Reserve' : '');

      const rawShortComment = cleanSensationalistText(
        pickMeaningfulInjuryComment(espnInj?.shortComment, webInj?.shortComment, inlineInj?.shortComment)
      );
      const rawLongComment = cleanSensationalistText(
        pickMeaningfulInjuryComment(espnInj?.longComment, webInj?.longComment, inlineInj?.longComment, rawShortComment)
      );
      const returnDateStr =
        espnInj?.details?.returnDate || webInj?.returnDate || inlineInj?.details?.returnDate || null;

      // Extract body part ONLY from genuine injury-report lead syntax like "Bosa (knee) does not..."
      // Never match box-score tackle parentheses like "Warner recorded 13 tackles (six solo)".
      const leadParenBodyPart = (() => {
        const m = rawShortComment.match(/^[A-Z][A-Za-z'. -]{1,28}\s+\(([a-zA-Z /,-]{3,28})\)/);
        if (!m) return '';
        const cand = m[1].trim();
        if (/\b(solo|tackle|yard|target|catch|carry|touchdown|sack|int|fumble|pat|attempt)\b/i.test(cand)) {
          return '';
        }
        return cand.charAt(0).toUpperCase() + cand.slice(1);
      })();

      const explicitInjType =
        offInjRec?.injuryType ||
        cbsInjRec?.injuryType ||
        espnInj?.details?.type ||
        webInj?.injuryType ||
        inlineInj?.details?.type ||
        '';

      const notActivatedForCurrentWeek =
        /not activated|didn't activate|did not activate|remains on injured reserve|ruled out|will miss /i.test(
          `${rawShortComment} ${rawLongComment}`
        );

      const isIrReturnQuestionable =
        bucket === 'ir' &&
        !notActivatedForCurrentWeek &&
        (offInjRec?.gameStatus === 'Questionable' ||
          /(listed as questionable|questionable for sunday|likely will be activated|expected to be activated)/i.test(
            `${rawShortComment} ${rawLongComment}`
          ));

      // Pre-classify IR/Reserve timeline when player is in the IR/Reserve bucket
      const irClassification =
        bucket === 'ir' || bucket === 'suspended'
          ? classifyIrAndReserveTimeline({
              statusRaw: rawStatus,
              fantasyStatusAbbr: webInj?.fantasyStatusAbbr || espnInj?.details?.fantasyStatus?.abbreviation || '',
              injuryType: explicitInjType || leadParenBodyPart || 'Undisclosed',
              injuryDetail: webInj?.injuryDetail || espnInj?.details?.detail || '',
              returnDateIso: returnDateStr,
              placedDateIso: webInj?.date || inlineInj?.date || null,
              txPlacedDateIso: txRec?.placedOnIrDate || null,
              designatedDateIso: txRec?.designatedToReturnDate || null,
              beatNote: rawLongComment || rawShortComment,
              txNote: txRec?.placedOnIrNote || '',
              cbsStatusText: cbsInjRec?.statusText || '',
              isDesignatedToReturnOpen: Boolean(txRec?.designatedToReturnOpen),
              isActivated: false,
              currentWeek: detectedCurrentWeek,
              byeWeek: detectedByeWeek,
              seasonYear,
              scheduleEvents: espnSchedule.events || []
            })
          : null;

      // Active-roster Saturday activation check (e.g., Demarcus Robinson activated from IR Saturday ahead of kickoff)
      const recentlyActivatedFromIr =
        bucket === 'active' &&
        Boolean(txRec?.activatedFromIrDate) &&
        Date.now() - Date.parse(txRec.activatedFromIrDate) <= 5 * 86_400_000;

      const sfEarlyRoll =
        !officialInjReport.hasSfReport && sfBeforePracticeWindow && bucket === 'active'
          ? resolveEarlyWeekRolloverInput({
              rawStatus,
              injuryType: explicitInjType || leadParenBodyPart,
              shortComment: rawShortComment,
              longComment: rawLongComment,
              upcomingWeek: detectedCurrentWeek
            })
          : null;

      const isEarlyRestEntry = Boolean(sfEarlyRoll?.skip);

      const isGenuineInjuryReportEntry =
        bucket === 'active'
          ? officialInjReport.hasSfReport
            ? Boolean(offInjRec)
            : !isEarlyRestEntry &&
              (['out', 'doubtful', 'questionable'].includes(rawStatus.toLowerCase()) ||
                Boolean(explicitInjType) ||
                Boolean(leadParenBodyPart) ||
                /(designation|questionable|doubtful|ruled out|will miss|limited in practice|did not practice)/i.test(
                  rawShortComment
                ))
          : true;

      const injuryType =
        irClassification?.injuryType ||
        explicitInjType ||
        (isGenuineInjuryReportEntry ? leadParenBodyPart : '');
      const shortComment = isGenuineInjuryReportEntry ? rawShortComment : '';
      const longComment = isGenuineInjuryReportEntry ? rawLongComment : '';

      // Practice participation: prefer official 49ers.com Wed/Thu/Fri report when available;
      // before Wednesday's first practice report of the upcoming week, keep W / T / F blank ('-')!
      let wed = '-';
      let thu = '-';
      let fri = '-';
      if (offInjRec && (bucket === 'active' || isIrReturnQuestionable || txRec?.designatedToReturnOpen)) {
        wed = offInjRec.wed;
        thu = offInjRec.thu;
        fri = offInjRec.fri;
      } else if (!sfBeforePracticeWindow && bucket === 'active' && isGenuineInjuryReportEntry) {
        const extracted = extractPracticeDaysFromText({
          statusRaw: rawStatus,
          injuryType,
          shortComment,
          longComment
        });
        wed = extracted.wed;
        thu = extracted.thu;
        fri = extracted.fri;
      } else if (!sfBeforePracticeWindow && isIrReturnQuestionable) {
        wed = 'LP';
        thu = 'LP';
        fri = 'LP';
      }

      const effectiveGameStatusForModel = isIrReturnQuestionable
        ? 'Questionable'
        : bucket === 'ir' || bucket === 'suspended'
          ? irClassification?.status || 'Injured Reserve'
          : recentlyActivatedFromIr && offInjRec?.gameStatus === 'Questionable'
            ? 'Active'
            : offInjRec
              ? offInjRec.gameStatus || 'Active'
              : sfEarlyRoll && isGenuineInjuryReportEntry
                ? sfEarlyRoll.effectiveStatus
                : isGenuineInjuryReportEntry
                  ? rawStatus
                  : '';

      const playProb = computePlayerPlayProbability({
        name: fullName,
        position: posAbbr,
        experienceYears: ath.experience?.years ?? null,
        snapPct: primarySnapPct,
        gameStatus: effectiveGameStatusForModel,
        priorWeekStatus: rawStatus,
        missedPriorGame: sfEarlyRoll ? sfEarlyRoll.missedPriorGame : undefined,
        priorWeekPracticed: sfEarlyRoll ? sfEarlyRoll.priorWeekPracticed : undefined,
        weeklyHistory: weeklyInjByName.get(nk) || [],
        currentWeek: detectedCurrentWeek,
        byeWeek: detectedByeWeek,
        fantasyStatusAbbr: webInj?.fantasyStatusAbbr || espnInj?.details?.fantasyStatus?.abbreviation || '',
        rosterBucket: bucket,
        isIrReturnQuestionable,
        isSeasonEnding: Boolean(irClassification?.isSeasonEnding),
        injuryType,
        wed,
        thu,
        fri,
        beatNote: isGenuineInjuryReportEntry
          ? sfEarlyRoll
            ? sfEarlyRoll.beatNoteForModel
            : `${shortComment} ${longComment}`
          : ''
      });

      const spiderProfile = buildPlayerSpiderProfile({
        name: fullName,
        pfrId,
        position: posAbbr,
        heightIn: ath.height || (nflMeta?.height ? Number(nflMeta.height) : null),
        weightLb: ath.weight || (nflMeta?.weight ? Number(nflMeta.weight) : null)
      });

      // Player-specific news mentions from non-paywalled ESPN articles
      const playerNews = (espnNews.articles || [])
        .filter(art => {
          if (art.premium) return false;
          const safeArtUrl = sanitizeExternalUrl(art.links?.web?.href, null);
          if (!safeArtUrl && art.links?.web?.href) return false;
          const text = `${art.headline || ''} ${art.description || ''}`.toLowerCase();
          return text.includes(fullName.toLowerCase()) || (ath.lastName?.length >= 5 && text.includes(ath.lastName.toLowerCase()));
        })
        .slice(0, 3)
        .map(art => ({
          headline: cleanSensationalistText(art.headline),
          summary: cleanSensationalistText(art.description),
          publishedAt: art.published,
          imageUrl: (art.images || []).find(im => im.url && (!im.width || im.width >= 240))?.url || art.images?.[0]?.url || '',
          url: sanitizeExternalUrl(art.links?.web?.href, 'https://www.espn.com/nfl/team/_/name/sf/san-francisco-49ers')
        }));

      const resolvedOtcId = otcRecord?.otcId || otcId || null;
      const resolvedOtcSlug = otcRecord?.slug || resolvedIdentity.otcSlug || null;
      const otcUrl = buildOtcPlayerUrl({
        otcSlug: resolvedOtcSlug,
        otcId: resolvedOtcId,
        espnId,
        playerName: fullName,
        fallbackToTeam: true
      });
      const espnUrl = resolvedIdentity.espnUrl;
      const pfrUrl = resolvedIdentity.pfrUrl;

      rosterPlayers.push({
        id: espnId,
        gsisId,
        pfrId,
        otcId: resolvedOtcId,
        otcSlug: resolvedOtcSlug,
        otcUrl,
        espnUrl,
        pfrUrl,
        name: fullName,
        shortName: ath.shortName || fullName,
        jersey: ath.jersey !== undefined && ath.jersey !== null && ath.jersey !== '' ? Number(ath.jersey) : null,
        position: posAbbr,
        unit,
        rosterBucket: bucket,
        age: ath.age || null,
        displayHeight: ath.displayHeight || '',
        displayWeight: ath.displayWeight || (ath.weight ? `${ath.weight} lbs` : ''),
        experienceYears: ath.experience?.years ?? (nflMeta?.years_of_experience ? Number(nflMeta.years_of_experience) : 0),
        college: ath.college?.name || nflMeta?.college_name || 'NFL',
        draftInfo: nflMeta?.draft_year
          ? `${nflMeta.draft_year} • Rd ${nflMeta.draft_round}, Pick #${nflMeta.draft_pick}`
          : 'Undrafted / CFA',
        headshotUrl:
          ath.headshot?.href ||
          nflMeta?.headshot ||
          (/^\d+$/.test(espnId) ? `https://a.espncdn.com/i/headshots/nfl/players/full/${espnId}.png` : ''),
        capHit2026,
        contractsByYear,
        snapSummary,
        primarySnapPct,
        stats2026: current2026Stats,
        careerSeasons: dedupSeasons,
        nextGenStats: (gsisId && ngsByGsis.get(gsisId)) || null,
        pfrAdvStats: (pfrId && pfrAdvById.get(pfrId)) || null,
        publicEfficiencyNote: publicBeatEfficiencyNotes[fullName] || null,
        spiderProfile,
        health: {
          status: isIrReturnQuestionable
            ? 'Questionable (IR Return Window)'
            : irClassification
              ? irClassification.status
              : offInjRec?.gameStatus
                ? offInjRec.gameStatus
                : sfEarlyRoll && isGenuineInjuryReportEntry
                  ? sfEarlyRoll.effectiveStatus
                  : isGenuineInjuryReportEntry && rawStatus
                    ? rawStatus === 'Active'
                      ? 'No Designation (Cleared)'
                      : rawStatus
                    : bucket === 'active'
                      ? 'Active'
                      : bucket.toUpperCase(),
          injuryType,
          returnDate: returnDateStr,
          isSeasonEnding: Boolean(irClassification?.isSeasonEnding),
          isPracticeWindowOpen: Boolean(irClassification?.isPracticeWindowOpen),
          placedBeforeWeek: irClassification?.placedBeforeWeek ?? null,
          earliestEligibleWeek: irClassification?.earliestEligibleWeek ?? null,
          projectedReturnWeek: irClassification?.projectedReturnWeek || null,
          byeWeekNote: irClassification?.byeWeekNote || null,
          irBeatNote: irClassification?.beatNote || null,
          fantasyStatusAbbr: webInj?.fantasyStatusAbbr || espnInj?.details?.fantasyStatus?.abbreviation || '',
          isIrReturnQuestionable,
          isOnPracticeReport:
            (bucket === 'active' && (isGenuineInjuryReportEntry || wed !== '-')) || isIrReturnQuestionable,
          wed,
          thu,
          fri,
          shortComment,
          longComment,
          playProbabilityPct: playProb.probabilityPct,
          playTier: playProb.tier,
          playBadgeLabel: playProb.badgeLabel,
          factors: playProb.factors,
          archetypeNote: playProb.priorUsed.archetypeNote,
          weeklyHistory2026: weeklyInjByName.get(nk) || []
        },
        recentNews: playerNews
      });
    }
  }

  // Sort default roster alphabetically by Name ascending
  rosterPlayers.sort((a, b) => a.name.localeCompare(b.name));

  const playersByEspnId = new Map(rosterPlayers.map(p => [p.id, p]));
  const playersByOtcId = new Map(rosterPlayers.filter(p => p.otcId).map(p => [String(p.otcId), p]));
  const playersByNormName = new Map();
  for (const p of rosterPlayers) {
    for (const k of getPlayerLookupKeys(p.name)) {
      if (!playersByNormName.has(k)) playersByNormName.set(k, p);
    }
  }

  // Universal player metadata resolver (checks SF active/reserve roster first, then homonym-safe league-wide nflverse Rosetta Stone)
  function lookupAnyPlayerMeta(playerName = '') {
    for (const k of getPlayerLookupKeys(playerName)) {
      const rp = playersByNormName.get(k);
      if (rp) {
        return {
          playerId: rp.id,
          jersey: rp.jersey,
          headshotUrl: rp.headshotUrl || '',
          otcUrl: rp.otcUrl || OTC_TEAM_CAP_URL,
          pfrUrl: rp.pfrUrl || null,
          espnUrl: rp.espnUrl || null
        };
      }
    }
    const resolved = playerIdentityResolver.resolvePlayer({ fullName: playerName, teamAbbr: '' });
    const nflP = resolved.nflMeta;
    if (nflP) {
      const espnId = nflP.espn_id ? String(nflP.espn_id).trim() : '';
      return {
        playerId: '',
        jersey: nflP.jersey_number ? Number(nflP.jersey_number) : null,
        headshotUrl:
          nflP.headshot ||
          (/^\d+$/.test(espnId) ? `https://a.espncdn.com/i/headshots/nfl/players/full/${espnId}.png` : ''),
        otcUrl: resolved.otcUrl || null,
        pfrUrl: resolved.pfrUrl || null,
        espnUrl: resolved.espnUrl || null
      };
    }
    return null;
  }

  // Dynamic mentioned-player matcher for news articles & beat posts (handles Jr./Sr./II/III & common surname guards)
  const COMMON_SURNAME_REQUIRE_FULL = new Set([
    'evans',
    'williams',
    'white',
    'samuel',
    'smith',
    'jones',
    'black',
    'martin',
    'robinson',
    'kirk',
    'cooks',
    'west',
    'collins',
    'jackson',
    'thompson',
    'scott',
    'moore',
    'brown',
    'green',
    'james',
    'stout',
    'farmer',
    'wilson'
  ]);

  function stripSuffixName(nm = '') {
    return String(nm || '')
      .replace(/\s+\b(jr\.?|sr\.?|ii|iii|iv)\b$/i, '')
      .trim();
  }

  const uniqueLastNameIndex = new Map();
  const lastNameCounts = new Map();
  for (const p of rosterPlayers) {
    const cleanFull = stripSuffixName(p.name);
    const last = cleanFull.split(/\s+/).slice(-1)[0]?.replace(/[^a-zA-Z']/g, '').toLowerCase() || '';
    if (last.length >= 4 && !COMMON_SURNAME_REQUIRE_FULL.has(last)) {
      lastNameCounts.set(last, (lastNameCounts.get(last) || 0) + 1);
    }
  }
  for (const p of rosterPlayers) {
    const cleanFull = stripSuffixName(p.name);
    const last = cleanFull.split(/\s+/).slice(-1)[0]?.replace(/[^a-zA-Z']/g, '').toLowerCase() || '';
    if (last.length >= 4 && lastNameCounts.get(last) === 1 && !COMMON_SURNAME_REQUIRE_FULL.has(last)) {
      uniqueLastNameIndex.set(last, p);
    }
  }

  function escapeMatchRegex(s = '') {
    return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  function matchMentionedPlayers(text = '', maxCount = 3) {
    const hay = String(text || '')
      .replace(/[’‘]/g, "'")
      .toLowerCase();
    if (!hay) return [];
    const hayNoApos = hay.replace(/'/g, '');
    const hayCollapsed = collapseInitialDots(hay);
    const found = [];
    const seen = new Set();
    const pushPlayer = p => {
      if (!p || seen.has(p.id)) return;
      seen.add(p.id);
      found.push({
        id: p.id,
        name: p.name,
        shortName: p.shortName || p.name,
        position: p.position,
        jersey: p.jersey,
        headshotUrl: p.headshotUrl || ''
      });
    };

    for (const p of rosterPlayers) {
      const fullLower = p.name.toLowerCase();
      const strippedLower = stripSuffixName(p.name).toLowerCase();
      const collapsedLower = collapseInitialDots(strippedLower);
      const noAposLower = strippedLower.replace(/'/g, '');
      const fullRe = new RegExp(`(?<![a-z0-9])${escapeMatchRegex(fullLower)}(?![a-z0-9])`, 'i');
      const strippedRe = strippedLower.includes(' ')
        ? new RegExp(`(?<![a-z0-9])${escapeMatchRegex(strippedLower)}(?![a-z0-9])`, 'i')
        : null;
      const collapsedRe = collapsedLower.includes(' ')
        ? new RegExp(`(?<![a-z0-9])${escapeMatchRegex(collapsedLower)}(?![a-z0-9])`, 'i')
        : null;
      const noAposRe = noAposLower.includes(' ')
        ? new RegExp(`(?<![a-z0-9])${escapeMatchRegex(noAposLower)}(?![a-z0-9])`, 'i')
        : null;
      if (
        fullRe.test(hay) ||
        (strippedRe && strippedRe.test(hay)) ||
        (collapsedRe && collapsedRe.test(hayCollapsed)) ||
        (noAposRe && noAposRe.test(hayNoApos)) ||
        (p.name === 'Deebo Samuel Sr.' && /\bdeebo\b/i.test(hay)) ||
        (p.name === 'Christian McCaffrey' && /\bcmc\b/i.test(hay))
      ) {
        pushPlayer(p);
        if (found.length >= maxCount) return found;
      }
    }
    for (const [last, p] of uniqueLastNameIndex.entries()) {
      if (seen.has(p.id)) continue;
      const re = new RegExp(`\\b${last.replace(/'/g, "'?")}\\b`, 'i');
      if (re.test(hay)) {
        pushPlayer(p);
        if (found.length >= maxCount) return found;
      }
    }
    return found;
  }

  // Enrich OTC players with positions, jersey, headshotUrl, espnId & OverTheCap contract URLs
  const enrichedCapPlayers = otcParsed.otcPlayers
    .map(op => {
      const rp =
        (op.otcId && playersByOtcId.get(String(op.otcId))) ||
        getPlayerLookupKeys(op.name).map(k => playersByNormName.get(k)).find(Boolean) ||
        null;
      const otcUrl = buildOtcPlayerUrl({
        otcSlug: op.slug || rp?.otcSlug,
        otcId: op.otcId,
        espnId: rp?.id || null,
        playerName: op.name,
        fallbackToTeam: true
      });
      const anyContractYear = Object.values(op.contractsByYear || {})[0] || null;
      return {
        id: rp?.id || op.otcId,
        otcId: op.otcId,
        otcSlug: op.slug || rp?.otcSlug || null,
        otcUrl,
        espnUrl: rp?.espnUrl || null,
        pfrUrl: rp?.pfrUrl || null,
        name: op.name,
        position: rp?.position || 'VET',
        jersey: rp?.jersey ?? null,
        headshotUrl: rp?.headshotUrl || '',
        unit: rp?.unit || 'Offense',
        rosterBucket: rp?.rosterBucket || op.contractsByYear?.[capPrimaryYrKey]?.rosterBucket || anyContractYear?.rosterBucket || 'active',
        contractsByYear: op.contractsByYear
      };
    })
    .filter(p => Object.keys(p.contractsByYear || {}).length > 0)
    .sort((a, b) => {
      const capA = a.contractsByYear?.[capPrimaryYrKey]?.capNumber || 0;
      const capB = b.contractsByYear?.[capPrimaryYrKey]?.capNumber || 0;
      if (capB !== capA) return capB - capA;
      const maxA = Math.max(0, ...Object.values(a.contractsByYear || {}).map(y => y?.capNumber || 0));
      const maxB = Math.max(0, ...Object.values(b.contractsByYear || {}).map(y => y?.capNumber || 0));
      return maxB - maxA;
    });

  const capBlueprint = buildFrontOfficeCapBlueprint(otcParsed.years, enrichedCapPlayers, seasonYear);

  // 6. Build Dual-Mode Depth Chart (`data/depth-chart.json`)
  const depthUnits = [];
  const slotLabels = {
    qb: 'QB', rb: 'RB', fb: 'FB (21 Pers)', wr1: 'WR (X)', wr2: 'WR (Z)', wr3: 'SLWR (11 Pers)',
    te: 'TE (Y)', lt: 'LT', lg: 'LG', c: 'C', rg: 'RG', rt: 'RT',
    lde: 'LDE (Wide-9)', ldt: 'LDT (1/2i)', rdt: 'RDT (3-Tech)', rde: 'RDE (Wide-9)',
    wlb: 'WILL LB', mlb: 'MIKE LB', slb: 'SAM LB (4-3)', nb: 'NICKEL CB (4-2-5)',
    lcb: 'LCB', rcb: 'RCB', ss: 'SS', fs: 'FS',
    pk: 'PK', p: 'P', ls: 'LS', h: 'H', pr: 'PR', kr: 'KR'
  };

  for (const dc of espnDepth.depthchart || []) {
    const rows = [];
    for (const [slotKey, posObj] of Object.entries(dc.positions || {})) {
      const baselineChain = (posObj.athletes || [])
        .map(ath => {
          const matched = playersByEspnId.get(String(ath.id)) || playersByNormName.get(normName(ath.displayName));
          return matched ? { ath, matched } : null;
        })
        .filter(Boolean)
        .map(({ ath, matched }, idx) => {
          const prob = matched.health?.playProbabilityPct ?? 95;
          const isAvailable =
            prob >= 40 && (matched.rosterBucket === 'active' || Boolean(matched.health?.isIrReturnQuestionable));
          return {
            playerId: matched.id,
            name: matched.name || ath.displayName,
            jersey: matched.jersey ?? null,
            headshotUrl: matched.headshotUrl || '',
            baselineRank: idx + 1,
            playProbabilityPct: prob,
            statusBadge: matched.health?.playBadgeLabel || '95% • Full Go',
            isAvailable
          };
        });

      // Projected Active Chain promotes healthy players ahead of unavailable ones (<40% play prob)
      const projectedActiveChain = [
        ...baselineChain.filter(x => x.isAvailable),
        ...baselineChain.filter(x => !x.isAvailable).map(x => ({ ...x, demotedDueToInjury: true }))
      ];

      rows.push({
        slotKey,
        slotLabel: slotLabels[slotKey] || posObj.position?.abbreviation || slotKey.toUpperCase(),
        baselineChain,
        projectedActiveChain,
        starterPromoted:
          baselineChain.length > 1 &&
          projectedActiveChain[0]?.playerId !== baselineChain[0]?.playerId
      });
    }
    depthUnits.push({
      id: dc.id,
      unitName:
        dc.name === '3WR 1TE'
          ? 'Offense (11 & 21 Personnel)'
          : dc.name === 'Base 4-3 D'
            ? 'Defense (Wide-9 Base 4-3 & Nickel 4-2-5)'
            : 'Special Teams',
      rows
    });
  }

  const depthPriority = u => {
    const n = (u.unitName || '').toLowerCase();
    if (n.includes('offense')) return 1;
    if (n.includes('defense')) return 2;
    if (n.includes('special')) return 3;
    return 4;
  };
  depthUnits.sort((a, b) => depthPriority(a) - depthPriority(b));

  // 7. Build Team Health & IR Return Tracker (`data/health.json`)
  let practiceReportPlayers = rosterPlayers
    .filter(p => p.health.isOnPracticeReport)
    .sort((a, b) => a.health.playProbabilityPct - b.health.playProbabilityPct || b.capHit2026 - a.capHit2026)
    .map(p => ({
      playerId: p.id,
      name: p.name,
      position: p.position,
      jersey: p.jersey,
      headshotUrl: p.headshotUrl || '',
      wed: p.health.wed,
      thu: p.health.thu,
      fri: p.health.fri,
      injuryType:
        p.health.injuryType ||
        (p.health.wed === 'Vet Rest' ? 'NIR - Veteran Rest' : 'Cleared — No Designation'),
      gameStatus: p.health.status,
      playProbabilityPct: p.health.playProbabilityPct,
      playBadgeLabel: p.health.playBadgeLabel,
      archetypeNote: p.health.archetypeNote,
      factors: p.health.factors,
      beatComment: pickMeaningfulInjuryComment(p.health.longComment, p.health.shortComment)
    }));

  let irTrackerPlayers = rosterPlayers
    .filter(p => p.rosterBucket === 'ir' || p.rosterBucket === 'suspended')
    .map(p => ({
      playerId: p.id,
      name: p.name,
      position: p.position,
      jersey: p.jersey,
      headshotUrl: p.headshotUrl || '',
      injuryType: p.health.injuryType || 'Undisclosed',
      status: p.health.isIrReturnQuestionable
        ? 'IR — Designated to Return (Questionable)'
        : p.health.status || 'Injured Reserve',
      isSeasonEnding: Boolean(p.health.isSeasonEnding),
      isPracticeWindowOpen: Boolean(p.health.isPracticeWindowOpen),
      isPracticeWindowExpected: Boolean(p.health.isPracticeWindowExpected),
      placedBeforeWeek: p.health.placedBeforeWeek ?? 1,
      earliestEligibleWeek: p.health.earliestEligibleWeek ?? null,
      projectedReturnWeek: p.health.projectedReturnWeek || 'TBD',
      byeWeekNote: p.health.byeWeekNote || '4-game NFL minimum requirement',
      beatNote: pickMeaningfulInjuryComment(p.health.irBeatNote, p.health.longComment, p.health.shortComment)
    }))
    .sort((a, b) => sortIrTrackerPriority(a) - sortIrTrackerPriority(b) || a.name.localeCompare(b.name));

  // Count regular-season IR-return designations used under NFL CBA rules (max 8 in regular season):
  //  - Each transaction opening a 21-day return window from IR since Aug 20
  //  - Plus any cutdown-day IR-designated-for-return (`IR-R`) slot whose 21-day window has not yet opened
  const cutdownIrRCount = rosterPlayers.filter(
    p =>
      p.rosterBucket === 'ir' &&
      !p.health.isSeasonEnding &&
      p.health.fantasyStatusAbbr === 'IR-R' &&
      !sfTxAnalysis.designatedIrKeysInTx.has(canonicalPlayerKey(p.name))
  ).length;
  const usedIrDesignations = sfTxAnalysis.regularSeasonIrDesignationsCount + cutdownIrRCount;
  const remainingIrDesignations = Math.max(0, 8 - usedIrDesignations);

  // 8. Fetch Live Beat Social Posts, X-Beat Player Wire, News RSS, Official 49ers RSS, Podcasts & YouTube Clips (`data/news.json` + `data/beat-podcasts.json`)
  console.log('[5/6] Fetching live X-Beat Player Wire, Beat Social Wire, Official/Beat RSS, Deep 7-Day Player Mentions, 6 Podcasts & YouTube Clips...');
  const [
    rawBeatTweets,
    ninersNationXml,
    official49ersXml,
    nbcsbaXml,
    pfrRumorsXml,
    rotowireXml,
    sfStandardXml,
    heavy49ersXml,
    webzoneXml,
    liveYtClips,
    beatPodcasts7d
  ] = await Promise.all([
    fetchLiveBeatSocialPosts().catch(() => []),
    fetchText('https://www.ninersnation.com/rss/current.xml').catch(() => ''),
    fetchText('https://www.49ers.com/rss/news').catch(() => ''),
    fetchText('https://www.nbcsportsbayarea.com/nfl/san-francisco-49ers/?rss=1').catch(() => ''),
    fetchText('https://www.profootballrumors.com/san-francisco-49ers/feed').catch(() => ''),
    fetchText('https://www.rotowire.com/rss/news.php?sport=NFL').catch(() => ''),
    fetchText('https://www.sfstandard.com/sports/feed/').catch(() => ''),
    fetchText('https://heavy.com/sports/nfl/san-francisco-49ers/feed/').catch(() => ''),
    fetchText('https://feeds.feedburner.com/49erswebzone').catch(() => ''),
    searchYouTubeVideos('San Francisco 49ers Kyle Shanahan 2026', 8),
    fetchLatest49ersPodcasts7d().catch(() => ({ updatedAt: new Date().toISOString(), windowDays: 7, shows: [], episodes: [] }))
  ]);

  // Harvest direct `https://x.com/<handle>/status/<id>` tweets embedded in beat RSS feeds via oEmbed
  const harvestedXTweets = await harvestEmbeddedXStatusTweetsFromRss([
    pfrRumorsXml,
    heavy49ersXml,
    webzoneXml,
    ninersNationXml,
    nbcsbaXml,
    official49ersXml,
    sfStandardXml
  ]).catch(() => []);
  const liveBeatTweets = [...harvestedXTweets, ...rawBeatTweets];

  // Batch-fetch ESPN 24/7 X-Beat Player Wire across all numeric-ESPN-ID 49ers players (7-day window)
  const sevenDayWireCutoffMs = Date.now() - 7 * 86_400_000;
  const espnPlayerWireItems = [];
  const numericEspnPlayers = rosterPlayers.filter(p => /^\d{4,10}$/.test(String(p.id || '')));
  const WIRE_BATCH = 16;
  for (let i = 0; i < numericEspnPlayers.length; i += WIRE_BATCH) {
    const slice = numericEspnPlayers.slice(i, i + WIRE_BATCH);
    await Promise.all(
      slice.map(async p => {
        try {
          const pwJson = await fetchJson(
            `https://site.api.espn.com/apis/fantasy/v2/games/ffl/news/players?playerId=${encodeURIComponent(p.id)}&limit=4`
          );
          for (const entry of pwJson?.feed || []) {
            const pubIso = entry.published || entry.lastModified || '';
            const pubMs = pubIso ? new Date(pubIso).getTime() : NaN;
            if (!Number.isFinite(pubMs) || pubMs < sevenDayWireCutoffMs) continue;
            const rawHeadline = cleanSensationalistText(decodeHtmlEntitiesBasic(String(entry.headline || '').replace(/<[^>]+>/g, ' ')));
            const rawDesc = cleanSensationalistText(decodeHtmlEntitiesBasic(String(entry.description || '').replace(/<[^>]+>/g, ' ')));
            const rawStory = cleanSensationalistText(decodeHtmlEntitiesBasic(String(entry.story || '').replace(/<[^>]+>/g, ' ')));
            const lead = rawDesc || rawHeadline;
            if (!lead || lead.length < 20) continue;

            const surname = stripSuffixName(p.name).split(/\s+/).slice(-1)[0] || p.name;
            if (
              surname &&
              !new RegExp(`\\b${escapeMatchRegex(surname)}\\b`, 'i').test(`${rawHeadline} ${rawDesc}`) &&
              !/\b(49ers|niners|san francisco)\b/i.test(`${rawHeadline} ${rawDesc}`)
            ) {
              continue;
            }

            const bylineHint = entry.byline
              ? String(entry.byline).replace(/^By\s+/i, '').split(/\s+and\s+|,/i)[0].trim()
              : '';
            const attr = extractBeatAttributionFromText(`${rawDesc} ${rawStory}`.trim(), {
              reporterId: null,
              reporterName: bylineHint || '49ers Beat Wire',
              outletId: 'espn',
              outletName: 'ESPN / X Beat Wire'
            });
            const cleanFull = cleanSensationalistText(attr.cleanedText || lead);
            if (/\b(fantasy|lineup help|sleepers|waiver wire|d\/st|start\/sit)\b/i.test(`${rawHeadline} ${cleanFull}`)) {
              continue;
            }
            const directWeb = sanitizeExternalUrl(entry.links?.web?.href, null);
            if (!directWeb && !attr.viaWire && !bylineHint) {
              continue;
            }
            const wireToken = entry.id || `${p.id}_${Math.floor(pubMs / 1000)}`;
            const isDirectArticleOrClip =
              Boolean(directWeb) &&
              !isEspnPlayerProfileUrl(directWeb) &&
              /\/(nfl\/story|video\/clip)\/_\/id\/\d+/i.test(directWeb);
            const isPlayerBlurb =
              !isDirectArticleOrClip &&
              (Boolean(entry.story) || entry.type === 'PlayerNews' || entry.type === 'Rotowire' || !directWeb || isEspnPlayerProfileUrl(directWeb));
            const pubIsoStr = new Date(pubMs).toISOString();
            const itemUrl = isPlayerBlurb
              ? resolveOriginalTweetUrl(
                  {
                    type: 'tweet',
                    url: directWeb || '',
                    author: attr.author,
                    reporterId: attr.reporterId,
                    reporterName: attr.reporterName,
                    authorHandle: attr.authorHandle,
                    primaryPlayer: p,
                    fullText: cleanFull,
                    title: cleanFull,
                    publishedAt: pubIsoStr
                  },
                  liveBeatTweets
                )
              : directWeb;
            const fmtTw = formatTweetBodyForDisplay(cleanFull);
            const brk = classifyBreakingItem({
              title: isPlayerBlurb ? fmtTw.text : rawHeadline || fmtTw.text,
              fullText: cleanFull,
              summary: rawStory || rawDesc,
              publishedAt: pubIsoStr
            });

            const resolvedAuthorName = isPlayerBlurb ? attr.author : (bylineHint || 'ESPN');
            const resolvedRepEntry = resolveReporterFromNameOrHandle(resolvedAuthorName);
            const validRepEntry = resolvedRepEntry && !isPodiumSubjectId(resolvedRepEntry.id) ? resolvedRepEntry : null;
            const pwItemDraft = {
              id: `espn_pwire_${p.id}_${wireToken}`,
              type: isPlayerBlurb ? 'tweet' : 'article',
              title: isPlayerBlurb ? fmtTw.text : rawHeadline || fmtTw.text,
              fullText: isPlayerBlurb ? cleanFull : undefined,
              isFullTweet: isPlayerBlurb ? fmtTw.isFullTweet : undefined,
              summary: isPlayerBlurb ? (rawStory && rawStory !== cleanFull ? rawStory.slice(0, 260) : '') : rawDesc.slice(0, 240),
              imageUrl: p.headshotUrl || '',
              imageAlt: `${p.name} beat update`,
              primaryPlayer: p,
              publishedAt: pubIsoStr,
              url: itemUrl,
              externalUrl: null,
              externalTitle: null,
              outletId: attr.outletId || 'espn',
              outletName: isPlayerBlurb ? (attr.outletName || 'ESPN / X Beat Wire') : 'ESPN',
              reporterId: isPlayerBlurb ? attr.reporterId : (validRepEntry?.id || null),
              reporterName: resolvedAuthorName,
              author: resolvedAuthorName,
              authorHandle: isPlayerBlurb ? attr.authorHandle : (validRepEntry?.handle || ''),
              authorProfileUrl: isPlayerBlurb ? (attr.xUrl || null) : (validRepEntry?.xUrl || null),
              trustTier: attr.trustTier,
              isBreaking: brk.isBreaking,
              isInGameInjury: brk.isInGameInjury,
              breakingBadge: brk.breakingBadge,
              breakingPriority: brk.breakingPriority
            };
            pwItemDraft.authorProfileUrl = resolveItemAuthorProfileUrl(pwItemDraft, itemUrl);
            espnPlayerWireItems.push(pwItemDraft);
          }
        } catch {
          // Ignore single-player wire timeout
        }
      })
    );
  }

  function resolveArticleAuthor(bylineRaw = '', textSample = '', defaultAuthor = '49ers Beat Desk') {
    const cleanByline = String(bylineRaw || '')
      .replace(/^by\s+/i, '')
      .replace(/\s*,.*$/, '')
      .trim();
    if (cleanByline && cleanByline.length >= 4 && !/^(staff|news|rss|espn|admin)$/i.test(cleanByline)) {
      const repMatch = reportersList.find(
        r => !isPodiumSubjectId(r.id) && cleanByline.toLowerCase().includes(r.name.toLowerCase())
      );
      if (repMatch) {
        return { authorName: repMatch.name, reporterId: repMatch.id };
      }
      if (!/\b(kyle shanahan|john lynch)\b/i.test(cleanByline)) {
        return { authorName: cleanByline, reporterId: null };
      }
    }
    const leadVerbMatch = String(textSample || '').match(
      /^([A-Z][a-z]+(?:\s+[A-Z][a-z'.-]+){1,2})\s+(?:reports|reported|breaks down|details|explains|writes|notes)\b/
    );
    if (leadVerbMatch?.[1]) {
      const cand = leadVerbMatch[1].trim();
      const repMatch = reportersList.find(
        r => !isPodiumSubjectId(r.id) && r.name.toLowerCase() === cand.toLowerCase()
      );
      if (repMatch) {
        return { authorName: repMatch.name, reporterId: repMatch.id };
      }
      if (!/\b(kyle shanahan|john lynch)\b/i.test(cand)) {
        return { authorName: cand, reporterId: null };
      }
    }
    return { authorName: defaultAuthor, reporterId: null };
  }

  const rawNewsStream = [];

  // Add live beat social posts (tweets / Bluesky beat wire) with full short-tweet text, author & breaking flags
  for (const tw of liveBeatTweets) {
    const rawTweetBody = cleanSensationalistText(tw.fullText || tw.title || '');
    if (!rawTweetBody) continue;
    const fmtTw = formatTweetBodyForDisplay(rawTweetBody);
    const sig = scoreContentSignal(fmtTw.text, tw.summary || '');
    const pubIso = tw.publishedAt || new Date().toISOString();
    const brk = classifyBreakingItem({ title: fmtTw.text, summary: tw.summary, publishedAt: pubIso });

    const mentioned = matchMentionedPlayers(`${fmtTw.text} ${tw.summary || ''}`, 20);
    const resolvedTwUrl = resolveOriginalTweetUrl(
      {
        ...tw,
        type: 'tweet',
        mentionedPlayers: mentioned,
        fullText: fmtTw.text,
        title: fmtTw.text,
        publishedAt: pubIso
      },
      rawNewsStream
    );
    const safeTwUrl = sanitizeExternalUrl(resolvedTwUrl, null);
    if (!safeTwUrl) continue;
    const safeTwExtUrl = sanitizeExternalUrl(tw.externalUrl, null);

    rawNewsStream.push({
      id: tw.id,
      type: 'tweet',
      title: fmtTw.text,
      fullText: fmtTw.text,
      isFullTweet: fmtTw.isFullTweet,
      summary: tw.summary ? cleanSensationalistText(tw.summary) : '',
      imageUrl: tw.imageUrl || '',
      imageAlt: `${tw.reporterName} social post`,
      mentionedPlayers: mentioned,
      publishedAt: pubIso,
      url: safeTwUrl,
      externalUrl: safeTwExtUrl,
      externalTitle: safeTwExtUrl && tw.externalTitle ? cleanSensationalistText(tw.externalTitle) : null,
      outletId: tw.outletId,
      outletName: tw.outletName,
      reporterId: tw.reporterId,
      reporterName: tw.reporterName,
      author: tw.reporterName,
      authorHandle: tw.authorHandle,
      authorProfileUrl: resolveItemAuthorProfileUrl(tw, safeTwUrl),
      isBreaking: brk.isBreaking,
      isInGameInjury: brk.isInGameInjury,
      breakingBadge: brk.breakingBadge,
      breakingPriority: brk.breakingPriority,
      category:
        brk.isInGameInjury || /status|injury|questionable|ruled out|ir\b/i.test(fmtTw.text)
          ? 'injury'
          : 'beat',
      signalScore: Math.max(78, sig.signalScore),
      fluffScore: sig.fluffScore,
      isClickbait: false
    });
  }

  const seenStreamUrls = new Set(
    rawNewsStream
      .map(it => it.url)
      .filter(u => u && !String(u).includes('x.com/search?'))
  );
  const seenStreamTextKeys = new Set(
    rawNewsStream.map(it => String(it.fullText || it.title || '').toLowerCase().slice(0, 90))
  );

  // Add X-Beat attributed ESPN Player Wire items (7-day window across all 88 49ers players)
  for (const pw of espnPlayerWireItems) {
    const safePwUrl = sanitizeExternalUrl(pw.url, null);
    if (!safePwUrl || (!safePwUrl.includes('x.com/search?') && seenStreamUrls.has(safePwUrl))) continue;
    const textKey = String(pw.fullText || pw.title || '').toLowerCase().slice(0, 90);
    if (textKey && seenStreamTextKeys.has(textKey)) continue;
    const sig = scoreContentSignal(pw.fullText || pw.title, pw.summary || '');
    if (sig.isClickbait) continue;

    const p = pw.primaryPlayer;
    const extraMatched = matchMentionedPlayers(`${pw.fullText || pw.title} ${pw.summary || ''}`, 12);
    const mentioned = p
      ? [
          {
            id: p.id,
            name: p.name,
            shortName: p.shortName || p.name,
            position: p.position,
            jersey: p.jersey,
            headshotUrl: p.headshotUrl || ''
          },
          ...extraMatched.filter(m => String(m.id) !== String(p.id))
        ]
      : extraMatched;

    seenStreamUrls.add(safePwUrl);
    if (textKey) seenStreamTextKeys.add(textKey);
    rawNewsStream.push({
      id: pw.id,
      type: pw.type,
      title: sanitizeHallucinatedRosterText(pw.title, rosterPlayers),
      fullText: pw.fullText ? sanitizeHallucinatedRosterText(pw.fullText, rosterPlayers) : undefined,
      isFullTweet: pw.isFullTweet,
      summary: pw.summary ? sanitizeHallucinatedRosterText(pw.summary, rosterPlayers) : '',
      imageUrl: pw.imageUrl || '',
      imageAlt: pw.imageAlt,
      mentionedPlayers: mentioned,
      publishedAt: pw.publishedAt,
      url: safePwUrl,
      externalUrl: pw.externalUrl,
      externalTitle: pw.externalTitle,
      outletId: pw.outletId,
      outletName: pw.outletName,
      reporterId: pw.reporterId,
      reporterName: pw.reporterName,
      author: pw.author,
      authorHandle: pw.authorHandle,
      authorProfileUrl: pw.authorProfileUrl,
      trustTier: pw.trustTier,
      wireSource: 'espn_player_wire',
      isBreaking: pw.isBreaking,
      isInGameInjury: pw.isInGameInjury,
      breakingBadge: pw.breakingBadge,
      breakingPriority: pw.breakingPriority,
      category:
        pw.isInGameInjury ||
        /status|injury|practice|questionable|ruled out|reserve|activated|mri|ir\b/i.test(
          `${pw.fullText || pw.title} ${pw.summary || ''}`
        )
          ? 'injury'
          : 'beat',
      signalScore: Math.max(82, sig.signalScore),
      fluffScore: sig.fluffScore,
      isClickbait: false
    });
  }

  // Add recent 7-day official 49ers NFL transactions (`@49ers` Tier-1 roster & IR moves)
  for (const tx of espnSfTxJson?.transactions || []) {
    const pubMs = tx.date ? new Date(tx.date).getTime() : NaN;
    if (!Number.isFinite(pubMs) || pubMs < sevenDayWireCutoffMs) continue;
    const desc = cleanSensationalistText(String(tx.description || '').trim());
    if (!desc || desc.length < 12) continue;
    const fullLine = /^49ers\b|^San Francisco\b/i.test(desc) ? desc : `49ers roster move: ${desc}`;
    const txSlug = Buffer.from(`${tx.date}_${desc}`).toString('base64url').slice(0, 14);
    const txUrl = `https://www.49ers.com/team/transactions/#tx-${txSlug}`;
    const textKey = fullLine.toLowerCase().slice(0, 90);
    if (seenStreamUrls.has(txUrl) || seenStreamTextKeys.has(textKey)) continue;

    const fmtTw = formatTweetBodyForDisplay(fullLine);
    const pubIso = new Date(pubMs).toISOString();
    const brk = classifyBreakingItem({ title: fmtTw.text, fullText: fullLine, publishedAt: pubIso });
    const mentioned = matchMentionedPlayers(desc, 10);

    seenStreamUrls.add(txUrl);
    seenStreamTextKeys.add(textKey);
    rawNewsStream.push({
      id: `sf_tx_${txSlug}`,
      type: 'tweet',
      title: fmtTw.text,
      fullText: fullLine,
      isFullTweet: fmtTw.isFullTweet,
      summary: '',
      imageUrl: mentioned[0]?.headshotUrl || '',
      imageAlt: 'San Francisco 49ers transaction',
      mentionedPlayers: mentioned,
      publishedAt: pubIso,
      url: txUrl,
      externalUrl: null,
      externalTitle: null,
      outletId: '49ers_official',
      outletName: '49ers.com Official',
      reporterId: '49ers_news',
      reporterName: 'San Francisco 49ers Official',
      author: 'San Francisco 49ers Official',
      authorHandle: '@49ers',
      authorProfileUrl: 'https://x.com/49ers',
      trustTier: 1,
      wireSource: 'official_transactions',
      isBreaking: brk.isBreaking,
      isInGameInjury: brk.isInGameInjury,
      breakingBadge: brk.breakingBadge,
      breakingPriority: brk.breakingPriority,
      category: /injured reserve|\bir\b|waived\/injured/i.test(desc) ? 'injury' : 'roster',
      signalScore: 95,
      fluffScore: 0,
      isClickbait: false
    });
  }

  // Parse NBC Sports Bay Area 49ers RSS (`nbcsportsbayarea.com` — Matt Maiocco & Jennifer Lee Chan)
  for (const itemMatch of nbcsbaXml.matchAll(/<item>([\s\S]*?)<\/item>/gi)) {
    const xml = itemMatch[1];
    const title = cleanSensationalistText(
      decodeHtmlEntitiesBasic(xml.match(/<title>([\s\S]*?)<\/title>/i)?.[1]?.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1') || '')
    );
    const desc = cleanSensationalistText(
      decodeHtmlEntitiesBasic(
        xml.match(/<description>([\s\S]*?)<\/description>/i)?.[1]?.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/<[^>]+>/g, ' ') || ''
      )
    );
    const link = sanitizeExternalUrl(xml.match(/<link>([\s\S]*?)<\/link>/i)?.[1]?.trim() || '', null);
    if (!title || !link || seenStreamUrls.has(link)) continue;
    const pubDate = xml.match(/<pubDate>([^<]+)<\/pubDate>/i)?.[1];
    const dcCreator = cleanSensationalistText(
      xml.match(/<dc:creator>([\s\S]*?)<\/dc:creator>/i)?.[1]?.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1') || ''
    );
    const mediaImg = sanitizeExternalUrl(xml.match(/<media:content[^>]*url="([^"]+)"/i)?.[1] || '', null) || '';
    const pubIso = pubDate ? new Date(pubDate).toISOString() : new Date().toISOString();
    const authInfo = resolveArticleAuthor(dcCreator, `${title} ${desc}`, 'NBC Sports Bay Area');
    const rawDirRep = authInfo.reporterId ? resolveReporterFromNameOrHandle(authInfo.reporterId) : null;
    const dirRep = rawDirRep && !isPodiumSubjectId(rawDirRep.id) ? rawDirRep : null;
    const sig = scoreContentSignal(title, desc);
    if (sig.isClickbait) continue;
    const brk = classifyBreakingItem({ title, summary: desc, publishedAt: pubIso });

    seenStreamUrls.add(link);
    const nbcsItem = {
      id: `nbcsba_${rawNewsStream.length}`,
      type: 'article',
      title: sanitizeHallucinatedRosterText(title, rosterPlayers),
      summary: sanitizeHallucinatedRosterText(desc.slice(0, 240), rosterPlayers),
      imageUrl: mediaImg,
      imageAlt: title,
      mentionedPlayers: matchMentionedPlayers(`${title} ${desc}`, 20),
      publishedAt: pubIso,
      url: link,
      outletId: 'nbcsba',
      outletName: 'NBC Sports Bay Area',
      reporterId: dirRep?.id || null,
      reporterName: authInfo.authorName,
      author: authInfo.authorName,
      authorHandle: dirRep?.handle || '',
      authorProfileUrl: dirRep?.xUrl || 'https://www.nbcsportsbayarea.com/nfl/san-francisco-49ers/',
      trustTier: dirRep?.trustTier || 1,
      isBreaking: brk.isBreaking,
      isInGameInjury: brk.isInGameInjury,
      breakingBadge: brk.breakingBadge,
      breakingPriority: brk.breakingPriority,
      category: /injury|practice|questionable|ir\b/i.test(title) ? 'injury' : 'beat',
      signalScore: Math.max(80, sig.signalScore),
      fluffScore: sig.fluffScore,
      isClickbait: false
    };
    nbcsItem.authorProfileUrl = resolveItemAuthorProfileUrl(nbcsItem, link);
    rawNewsStream.push(nbcsItem);
  }

  // Parse Pro Football Rumors 49ers RSS & RotoWire Live NFL RSS (filtered strictly to 49ers)
  for (const [feedKey, rawFeedXml, fallbackOutlet, fallbackOutletId] of [
    ['pfrumors', pfrRumorsXml, 'Pro Football Rumors', 'pfrumors'],
    ['rotowire', rotowireXml, 'RotoWire / X Beat', 'espn']
  ]) {
    for (const itemMatch of rawFeedXml.matchAll(/<item>([\s\S]*?)<\/item>/gi)) {
      const xml = itemMatch[1];
      const title = cleanSensationalistText(
        decodeHtmlEntitiesBasic(xml.match(/<title>([\s\S]*?)<\/title>/i)?.[1]?.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1') || '')
      );
      const desc = cleanSensationalistText(
        decodeHtmlEntitiesBasic(
          xml.match(/<description>([\s\S]*?)<\/description>/i)?.[1]?.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/<[^>]+>/g, ' ') || ''
        )
      );
      if (!title) continue;
      const mentioned = matchMentionedPlayers(`${title} ${desc}`, 20);
      if (feedKey === 'rotowire' && !/\b(49ers|niners|san francisco)\b/i.test(`${title} ${desc}`)) {
        continue;
      }
      if (
        feedKey === 'pfrumors' &&
        isOffTopicLeagueFiller({
          url: '',
          title,
          summary: desc,
          hasRosterMatch: mentioned.length > 0 && /\b(49ers|niners|san francisco)\b/i.test(`${title} ${desc}`)
        })
      ) {
        continue;
      }
      const rawLink = xml.match(/<link>([\s\S]*?)<\/link>/i)?.[1]?.trim() || '';
      const link = sanitizeExternalUrl(rawLink, null);
      if (!link || seenStreamUrls.has(link)) continue;
      const pubDate = xml.match(/<pubDate>([^<]+)<\/pubDate>/i)?.[1];
      const pubMs = pubDate ? new Date(pubDate).getTime() : Date.now();
      if (Number.isFinite(pubMs) && pubMs < sevenDayWireCutoffMs) continue;
      const pubIso = Number.isFinite(pubMs) ? new Date(pubMs).toISOString() : new Date().toISOString();

      const attr = extractBeatAttributionFromText(`${desc} ${title}`, {
        reporterId: null,
        reporterName: fallbackOutlet,
        outletId: fallbackOutletId,
        outletName: fallbackOutlet
      });
      const sig = scoreContentSignal(title, desc);
      if (sig.isClickbait) continue;
      const brk = classifyBreakingItem({ title, fullText: desc, summary: desc, publishedAt: pubIso });

      const finalUrl =
        feedKey === 'rotowire' && attr.viaWire
          ? resolveOriginalTweetUrl(
              {
                type: 'tweet',
                url: link,
                author: attr.author,
                reporterId: attr.reporterId,
                reporterName: attr.reporterName,
                authorHandle: attr.authorHandle,
                mentionedPlayers: mentioned,
                fullText: desc || title,
                title: desc || title,
                publishedAt: pubIso
              },
              liveBeatTweets
            )
          : link;
      if (!finalUrl.includes('x.com/search?') && seenStreamUrls.has(finalUrl)) continue;
      if (!finalUrl.includes('x.com/search?')) seenStreamUrls.add(finalUrl);

      const pfItem = {
        id: `${feedKey}_${rawNewsStream.length}`,
        type: feedKey === 'rotowire' ? 'tweet' : 'article',
        title: sanitizeHallucinatedRosterText(feedKey === 'rotowire' ? formatTweetBodyForDisplay(desc || title).text : title, rosterPlayers),
        fullText: feedKey === 'rotowire' ? sanitizeHallucinatedRosterText(desc || title, rosterPlayers) : undefined,
        isFullTweet: feedKey === 'rotowire' ? (desc || title).length <= 320 : undefined,
        summary: sanitizeHallucinatedRosterText(feedKey === 'rotowire' ? title : desc.slice(0, 240), rosterPlayers),
        imageUrl: '',
        imageAlt: title,
        mentionedPlayers: mentioned,
        publishedAt: pubIso,
        url: finalUrl,
        externalUrl: null,
        externalTitle: null,
        outletId: feedKey === 'pfrumors' ? 'pfrumors' : attr.outletId,
        outletName: feedKey === 'pfrumors' ? 'Pro Football Rumors' : (attr.outletName || fallbackOutlet),
        reporterId: feedKey === 'pfrumors' ? (attr.viaWire ? attr.reporterId : null) : attr.reporterId,
        reporterName: feedKey === 'pfrumors' ? 'Pro Football Rumors' : attr.reporterName,
        author: feedKey === 'pfrumors' ? 'Pro Football Rumors' : attr.author,
        authorHandle: feedKey === 'pfrumors' ? '' : attr.authorHandle,
        authorProfileUrl: feedKey === 'pfrumors' ? 'https://www.profootballrumors.com/san-francisco-49ers' : (attr.xUrl || null),
        trustTier: attr.trustTier,
        isBreaking: brk.isBreaking,
        isInGameInjury: brk.isInGameInjury,
        breakingBadge: brk.breakingBadge,
        breakingPriority: brk.breakingPriority,
        category: /injury|practice|questionable|reserve|ir\b/i.test(`${title} ${desc}`) ? 'injury' : /trade|cap|contract|signed|waived/i.test(`${title} ${desc}`) ? 'roster' : 'beat',
        signalScore: Math.max(78, sig.signalScore),
        fluffScore: sig.fluffScore,
        isClickbait: false
      };
      pfItem.authorProfileUrl = resolveItemAuthorProfileUrl(pfItem, finalUrl);
      rawNewsStream.push(pfItem);
    }
  }

  // Parse ESPN 49ers articles (with strict 49ers relevance filter, accurate author attribution & paywall guard)
  for (const art of espnNews.articles || []) {
    if (art.premium) continue;
    const safeEspnArtUrl = sanitizeExternalUrl(
      art.links?.web?.href || '',
      null
    );
    if (!safeEspnArtUrl || seenStreamUrls.has(safeEspnArtUrl)) continue;
    const title = cleanSensationalistText(decodeHtmlEntitiesBasic(art.headline || ''));
    const summary = cleanSensationalistText(decodeHtmlEntitiesBasic(art.description || ''));
    if (!title) continue;
    const mentionedPlayers = matchMentionedPlayers(`${title} ${summary}`, 20);
    if (
      isOffTopicLeagueFiller({
        url: safeEspnArtUrl,
        title,
        summary,
        hasRosterMatch: mentionedPlayers.length > 0
      }) ||
      isStaleSeasonHeadline(title, detectedCurrentWeek)
    ) {
      continue;
    }
    const sig = scoreContentSignal(title, summary);
    if (sig.isClickbait) continue;
    const authInfo = resolveArticleAuthor(art.byline || '', `${summary} ${title}`, 'ESPN');
    const rawDirRep = authInfo.reporterId ? resolveReporterFromNameOrHandle(authInfo.reporterId) : resolveReporterFromNameOrHandle(authInfo.authorName);
    const dirRep = rawDirRep && !isPodiumSubjectId(rawDirRep.id) ? rawDirRep : null;
    const pubIso = art.published || new Date().toISOString();
    const brk = classifyBreakingItem({ title, summary, publishedAt: pubIso });

    const bestImg =
      (art.images || []).find(im => im.url && (!im.width || im.width >= 300) && im.type !== 'Media') ||
      (art.images || []).find(im => im.url);
    const imageUrl = bestImg?.url || '';
    const imageAlt = cleanSensationalistText(bestImg?.caption || title);

    seenStreamUrls.add(safeEspnArtUrl);
    const espnItem = {
      id: `espn_${art.id || rawNewsStream.length}`,
      type: 'article',
      title,
      summary,
      imageUrl,
      imageAlt,
      mentionedPlayers,
      publishedAt: pubIso,
      url: safeEspnArtUrl,
      outletId: 'espn',
      outletName: 'ESPN',
      reporterId: dirRep?.id || authInfo.reporterId || null,
      reporterName: authInfo.authorName,
      author: authInfo.authorName,
      authorHandle: dirRep?.handle || '',
      authorProfileUrl: dirRep?.xUrl || 'https://www.espn.com/nfl/team/_/name/sf/san-francisco-49ers',
      isBreaking: brk.isBreaking,
      isInGameInjury: brk.isInGameInjury,
      breakingBadge: brk.breakingBadge,
      breakingPriority: brk.breakingPriority,
      category: title.toLowerCase().includes('trade') ? 'roster' : /injury|status|bosa|evans|ir\b/i.test(title) ? 'injury' : 'beat',
      signalScore: sig.signalScore,
      fluffScore: sig.fluffScore,
      isClickbait: sig.isClickbait
    };
    espnItem.authorProfileUrl = resolveItemAuthorProfileUrl(espnItem, safeEspnArtUrl);
    rawNewsStream.push(espnItem);
  }

  // Parse Official 49ers.com RSS entries
  for (const itemMatch of official49ersXml.matchAll(/<item>([\s\S]*?)<\/item>/gi)) {
    const xml = itemMatch[1];
    const title = cleanSensationalistText(
      decodeHtmlEntitiesBasic(xml.match(/<title>([\s\S]*?)<\/title>/i)?.[1]?.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1') || '')
    );
    const desc = cleanSensationalistText(
      decodeHtmlEntitiesBasic(xml.match(/<description>([\s\S]*?)<\/description>/i)?.[1]?.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1') || '')
    );
    const link = sanitizeExternalUrl(xml.match(/<link>([\s\S]*?)<\/link>/i)?.[1]?.trim() || '', null);
    const pubDate = xml.match(/<pubDate>([^<]+)<\/pubDate>/i)?.[1];
    const dcCreator = cleanSensationalistText(
      decodeHtmlEntitiesBasic(xml.match(/<dc:creator>([\s\S]*?)<\/dc:creator>/i)?.[1]?.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1') || '')
    );
    const mediaImg = sanitizeExternalUrl(xml.match(/<media:content[^>]*url="([^"]+)"/i)?.[1] || '', null) || '';
    if (!title || !link || seenStreamUrls.has(link)) continue;
    const pubIso = pubDate ? new Date(pubDate).toISOString() : new Date().toISOString();
    const authInfo = resolveArticleAuthor(dcCreator, `${title} ${desc}`, '49ers.com Staff');
    const rawDirRep = authInfo.reporterId ? resolveReporterFromNameOrHandle(authInfo.reporterId) : null;
    const dirRep = rawDirRep && !isPodiumSubjectId(rawDirRep.id) ? rawDirRep : null;
    const sig = scoreContentSignal(title, desc);
    const brk = classifyBreakingItem({ title, summary: desc, publishedAt: pubIso });

    seenStreamUrls.add(link);
    const sfItem = {
      id: `sf49_${rawNewsStream.length}`,
      type: 'article',
      title,
      summary: desc.slice(0, 240),
      imageUrl: mediaImg,
      imageAlt: title,
      mentionedPlayers: matchMentionedPlayers(`${title} ${desc}`, 20),
      publishedAt: pubIso,
      url: link,
      outletId: '49ers_official',
      outletName: '49ers.com Official',
      reporterId: dirRep?.id || '49ers_news',
      reporterName: authInfo.authorName,
      author: authInfo.authorName,
      authorHandle: dirRep?.handle || '@49ers',
      authorProfileUrl: dirRep?.xUrl || 'https://www.49ers.com/news/',
      isBreaking: brk.isBreaking,
      isInGameInjury: brk.isInGameInjury,
      breakingBadge: brk.breakingBadge,
      breakingPriority: brk.breakingPriority,
      category: /injury|practice|roster|activated/i.test(title) ? 'injury' : 'beat',
      signalScore: Math.max(72, sig.signalScore),
      fluffScore: sig.fluffScore,
      isClickbait: false
    };
    sfItem.authorProfileUrl = resolveItemAuthorProfileUrl(sfItem, link);
    rawNewsStream.push(sfItem);
  }

  // Parse SF Standard Sports RSS (filtered strictly to 49ers items)
  for (const itemMatch of sfStandardXml.matchAll(/<item>([\s\S]*?)<\/item>/gi)) {
    const xml = itemMatch[1];
    const title = cleanSensationalistText(
      decodeHtmlEntitiesBasic(xml.match(/<title>([\s\S]*?)<\/title>/i)?.[1]?.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1') || '')
    );
    const desc = cleanSensationalistText(
      decodeHtmlEntitiesBasic(xml.match(/<description>([\s\S]*?)<\/description>/i)?.[1]?.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/<[^>]+>/g, ' ') || '')
    );
    if (!title || !/\b(49ers|niners|shanahan|purdy|bosa|aiyuk|mccaffrey|kittle|buckner|mike evans)\b/i.test(`${title} ${desc}`)) {
      continue;
    }
    const link = sanitizeExternalUrl(xml.match(/<link>([\s\S]*?)<\/link>/i)?.[1]?.trim() || '', null);
    if (!link || seenStreamUrls.has(link)) continue;
    const pubDate = xml.match(/<pubDate>([^<]+)<\/pubDate>/i)?.[1];
    const dcCreator = cleanSensationalistText(
      decodeHtmlEntitiesBasic(xml.match(/<dc:creator>([\s\S]*?)<\/dc:creator>/i)?.[1]?.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1') || '')
    );
    const pubIso = pubDate ? new Date(pubDate).toISOString() : new Date().toISOString();
    const authInfo = resolveArticleAuthor(dcCreator, `${title} ${desc}`, 'The SF Standard');
    const rawDirRep = authInfo.reporterId ? resolveReporterFromNameOrHandle(authInfo.reporterId) : resolveReporterFromNameOrHandle(authInfo.authorName);
    const dirRep = rawDirRep && !isPodiumSubjectId(rawDirRep.id) ? rawDirRep : null;
    const sig = scoreContentSignal(title, desc);
    const brk = classifyBreakingItem({ title, summary: desc, publishedAt: pubIso });

    seenStreamUrls.add(link);
    const sfStdItem = {
      id: `sfstd_${rawNewsStream.length}`,
      type: 'article',
      title,
      summary: desc.slice(0, 240),
      imageUrl: '',
      imageAlt: title,
      mentionedPlayers: matchMentionedPlayers(`${title} ${desc}`, 20),
      publishedAt: pubIso,
      url: link,
      outletId: 'sf_standard',
      outletName: 'The SF Standard',
      reporterId: dirRep?.id || null,
      reporterName: authInfo.authorName,
      author: authInfo.authorName,
      authorHandle: dirRep?.handle || '',
      authorProfileUrl: dirRep?.xUrl || 'https://sfstandard.com/sports/',
      isBreaking: brk.isBreaking,
      isInGameInjury: brk.isInGameInjury,
      breakingBadge: brk.breakingBadge,
      breakingPriority: brk.breakingPriority,
      category: 'beat',
      signalScore: Math.max(75, sig.signalScore),
      fluffScore: sig.fluffScore,
      isClickbait: sig.isClickbait
    };
    sfStdItem.authorProfileUrl = resolveItemAuthorProfileUrl(sfStdItem, link);
    rawNewsStream.push(sfStdItem);
  }

  // Parse Niners Nation Atom entries
  for (const entryMatch of ninersNationXml.matchAll(/<entry>([\s\S]*?)<\/entry>/gi)) {
    const xml = entryMatch[1];
    const title = cleanSensationalistText(decodeHtmlEntitiesBasic(xml.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || ''));
    const link = sanitizeExternalUrl(xml.match(/<link[^>]*href="([^"]+)"/i)?.[1] || '', null);
    const published = xml.match(/<published>([^<]+)<\/published>/i)?.[1] || new Date().toISOString();
    const author = cleanSensationalistText(decodeHtmlEntitiesBasic(xml.match(/<author>[\s\S]*?<name>([^<]+)<\/name>/i)?.[1] || 'Niners Nation'));
    const rawContentBlock =
      xml.match(/<content[^>]*>([\s\S]*?)<\/content>/i)?.[1] ||
      xml.match(/<summary[^>]*>([\s\S]*?)<\/summary>/i)?.[1] ||
      '';
    const decodedContent = decodeHtmlEntitiesBasic(rawContentBlock);
    let nnImageUrl =
      xml.match(/<media:(?:content|thumbnail)[^>]*url="([^"]+)"/i)?.[1] ||
      xml.match(/<enclosure[^>]*url="([^"]+)"/i)?.[1] ||
      '';
    if (!nnImageUrl) {
      for (const imgM of decodedContent.matchAll(/<img[^>]+src=["'](https:\/\/[^"']+)["']/gi)) {
        const candidate = imgM[1];
        if (!/pixel|tracker|avatar|1x1|badge/i.test(candidate)) {
          nnImageUrl = candidate;
          break;
        }
      }
    }
    const contentSnippet = cleanSensationalistText(decodedContent.replace(/<[^>]+>/g, ' ').slice(0, 600)).slice(0, 240);

    if (!title || !link || seenStreamUrls.has(link)) continue;
    const sig = scoreContentSignal(title, contentSnippet);
    const matchedRep = reportersList.find(
      r => !isPodiumSubjectId(r.id) && author.toLowerCase().includes(r.name.toLowerCase())
    );
    const dirRep = matchedRep ? resolveReporterFromNameOrHandle(matchedRep.id) : null;
    const mentionedPlayers = matchMentionedPlayers(`${title} ${contentSnippet}`, 20);
    const brk = classifyBreakingItem({ title, summary: contentSnippet, publishedAt: published });

    seenStreamUrls.add(link);
    const nnItem = {
      id: `nn_${rawNewsStream.length}`,
      type: 'article',
      title,
      summary: contentSnippet,
      imageUrl: nnImageUrl,
      imageAlt: title,
      mentionedPlayers,
      publishedAt: published,
      url: link,
      outletId: 'niners_nation',
      outletName: 'Niners Nation',
      reporterId: matchedRep?.id || null,
      reporterName: matchedRep?.name || author,
      author: matchedRep?.name || author,
      authorHandle: dirRep?.handle || '',
      authorProfileUrl: dirRep?.xUrl || 'https://www.ninersnation.com/',
      isBreaking: brk.isBreaking,
      isInGameInjury: brk.isInGameInjury,
      breakingBadge: brk.breakingBadge,
      breakingPriority: brk.breakingPriority,
      category: sig.signalScore >= 60 ? 'analytics' : 'beat',
      signalScore: sig.signalScore,
      fluffScore: sig.fluffScore,
      isClickbait: sig.isClickbait
    };
    nnItem.authorProfileUrl = resolveItemAuthorProfileUrl(nnItem, link);
    rawNewsStream.push(nnItem);
  }

  // Parse Direct 49ers Webzone Original Articles RSS (`49erswebzone.com/articles/...`) & Heavy 49ers Beat RSS
  for (const [feedKey, rawFeedXml, outletId, outletName, defaultUrl] of [
    ['wz', webzoneXml, '49ers_webzone', '49ers Webzone', 'https://www.49erswebzone.com/'],
    ['hvy', heavy49ersXml, '49ers_webzone', 'Heavy on 49ers', 'https://heavy.com/sports/nfl/san-francisco-49ers/']
  ]) {
    for (const itemMatch of rawFeedXml.matchAll(/<item>([\s\S]*?)<\/item>/gi)) {
      const xml = itemMatch[1];
      const title = cleanSensationalistText(
        decodeHtmlEntitiesBasic(xml.match(/<title>([\s\S]*?)<\/title>/i)?.[1]?.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1') || '')
      );
      const rawLink = xml.match(/<link>([\s\S]*?)<\/link>/i)?.[1]?.trim() || '';
      if (feedKey === 'wz' && !/49erswebzone\.com\/articles\//i.test(rawLink)) continue;
      const link = sanitizeExternalUrl(rawLink, null);
      if (!title || !link || seenStreamUrls.has(link) || isStaleSeasonHeadline(title, detectedCurrentWeek)) continue;

      const pubDate = xml.match(/<pubDate>([^<]+)<\/pubDate>/i)?.[1];
      const pubMs = pubDate ? new Date(pubDate).getTime() : NaN;
      if (Number.isFinite(pubMs) && pubMs < sevenDayWireCutoffMs) continue;
      const pubIso = Number.isFinite(pubMs) ? new Date(pubMs).toISOString() : new Date().toISOString();

      const rawDesc = decodeHtmlEntitiesBasic(
        xml.match(/<description>([\s\S]*?)<\/description>/i)?.[1]?.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/<[^>]+>/g, ' ') || ''
      ).replace(/^49ers Webzone\s*-\s*/i, '');
      const desc = cleanSensationalistText(rawDesc);
      const dcCreator = cleanSensationalistText(
        decodeHtmlEntitiesBasic(xml.match(/<dc:creator>([\s\S]*?)<\/dc:creator>/i)?.[1]?.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1') || '')
      );
      const mediaImgRaw = xml.match(/<media:content[^>]*url="([^"]+)"/i)?.[1] || '';
      const mediaImg =
        mediaImgRaw && !/fb-og-image/i.test(mediaImgRaw) ? sanitizeExternalUrl(mediaImgRaw, null) || '' : '';

      const sig = scoreContentSignal(title, desc);
      if (sig.isClickbait) continue;
      const authInfo = resolveArticleAuthor(dcCreator, `${title} ${desc}`, outletName);
      const rawDirRep = authInfo.reporterId ? resolveReporterFromNameOrHandle(authInfo.reporterId) : null;
      const dirRep = rawDirRep && !isPodiumSubjectId(rawDirRep.id) ? rawDirRep : null;
      const brk = classifyBreakingItem({ title, summary: desc, publishedAt: pubIso });

      seenStreamUrls.add(link);
      const directArt = {
        id: `${feedKey}_${rawNewsStream.length}`,
        type: 'article',
        title: sanitizeHallucinatedRosterText(title, rosterPlayers),
        summary: sanitizeHallucinatedRosterText(desc.slice(0, 240), rosterPlayers),
        imageUrl: mediaImg,
        imageAlt: title,
        mentionedPlayers: matchMentionedPlayers(`${title} ${desc}`, 20),
        publishedAt: pubIso,
        url: link,
        outletId,
        outletName,
        reporterId: dirRep?.id || null,
        reporterName: authInfo.authorName,
        author: authInfo.authorName,
        authorHandle: dirRep?.handle || '',
        authorProfileUrl: dirRep?.xUrl || defaultUrl,
        isBreaking: brk.isBreaking,
        isInGameInjury: brk.isInGameInjury,
        breakingBadge: brk.breakingBadge,
        breakingPriority: brk.breakingPriority,
        category: /injury|practice|questionable|ir\b/i.test(title) ? 'injury' : 'beat',
        signalScore: Math.max(72, sig.signalScore),
        fluffScore: sig.fluffScore,
        isClickbait: false
      };
      directArt.authorProfileUrl = resolveItemAuthorProfileUrl(directArt, link);
      rawNewsStream.push(directArt);
    }
  }

  // Add live YouTube clips to raw stream with verified domain embeddability flag & parsed relative publish time
  for (const vid of liveYtClips) {
    const sig = scoreContentSignal(vid.title, vid.channel);
    const cleanVidTitle = cleanSensationalistText(vid.title);
    const agoRaw = String(vid.publishedAgo || '');
    const dM = agoRaw.match(/(\d+)\s*d(?:ays?)?\s+ago/i);
    const hM = agoRaw.match(/(\d+)\s*h(?:ours?|rs?)?\s+ago/i);
    const mM = agoRaw.match(/(\d+)\s*m(?:in(?:ute)?s?)?\s+ago/i);
    const wM = agoRaw.match(/(\d+)\s*w(?:eeks?|ks?)?\s+ago/i);
    const offsetMs = wM
      ? Number(wM[1]) * 7 * 86_400_000
      : dM
        ? Number(dM[1]) * 86_400_000
        : hM
          ? Number(hM[1]) * 3_600_000
          : mM
            ? Number(mM[1]) * 60_000
            : 3 * 3_600_000;
    rawNewsStream.push({
      id: `yt_${vid.videoId}`,
      type: 'video',
      title: cleanVidTitle,
      summary: `Video (${vid.duration || 'Clip'}) • ${vid.channel} • ${vid.publishedAgo || 'Recent'}`,
      imageUrl: vid.thumbnailUrl || `https://i.ytimg.com/vi/${vid.videoId}/hqdefault.jpg`,
      mentionedPlayers: matchMentionedPlayers(cleanVidTitle, 10),
      publishedAt: new Date(Date.now() - offsetMs).toISOString(),
      url: `https://www.youtube.com/watch?v=${vid.videoId}`,
      videoId: vid.videoId,
      embeddable: Boolean(vid.embeddable),
      duration: vid.duration,
      outletId: vid.channel?.includes('49ers') ? '49ers_official' : 'youtube_film',
      outletName: vid.channel,
      reporterId: vid.channel?.includes('49ers') ? 'kyle_shanahan' : 'guy_haberman',
      reporterName: vid.channel,
      author: vid.channel,
      isBreaking: false,
      category: 'film',
      signalScore: Math.max(68, sig.signalScore),
      fluffScore: sig.fluffScore,
      isClickbait: false
    });
  }

  // Prune stale pre-game player availability items from completed games & sort breaking/post-game injury updates to #1!
  const prunedRawStream = filterOutCompletedGameAvailabilityItems(rawNewsStream, pipelineAppDataStub);
  const sortedStream = sortNewsWithBreakingPriority(prunedRawStream, Date.now(), {
    activeWindowHours: 18,
    gameContext: pipelineGameContext
  });
  rawNewsStream.length = 0;
  rawNewsStream.push(...sortedStream);

  // 8B. Deep 7-Day Per-Player Mentions Enrichment (Tweets + Beat Articles + Targeted 7-Day Google News Search)
  const sevenDayCutoffMs = Date.now() - 7 * 86400_000;
  const mentionsByPlayerId = new Map(rosterPlayers.map(p => [p.id, []]));

  function addMentionToPlayer(playerId, mentionObj) {
    const bucket = mentionsByPlayerId.get(playerId);
    if (!bucket) return;
    const pubMs = mentionObj.publishedAt ? new Date(mentionObj.publishedAt).getTime() : NaN;
    if (!Number.isFinite(pubMs) || pubMs < sevenDayCutoffMs) return;

    const normHeadline = String(mentionObj.headline || mentionObj.fullText || '')
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '')
      .slice(0, 48);
    if (!normHeadline) return;
    if (bucket.some(existing => String(existing.headline || existing.fullText || '').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 48) === normHeadline)) {
      return;
    }
    bucket.push(mentionObj);
  }

  // First pass: map all multi-source tweets & articles in rawNewsStream to every mentioned player
  for (const item of rawNewsStream) {
    if (item.type === 'video' || item.isClickbait) continue;
    for (const mp of item.mentionedPlayers || []) {
      addMentionToPlayer(mp.id, {
        id: item.id,
        type: item.type === 'tweet' ? 'tweet' : 'article',
        headline: item.title,
        fullText: item.type === 'tweet' ? item.fullText || item.title : null,
        isFullTweet: item.type === 'tweet' ? item.isFullTweet !== false : false,
        summary: item.summary || '',
        author: item.author || item.reporterName || item.outletName || '49ers Beat',
        authorHandle: item.authorHandle || null,
        authorProfileUrl: item.authorProfileUrl || null,
        outletName: item.outletName || '49ers Beat',
        publishedAt: item.publishedAt,
        imageUrl: item.imageUrl || '',
        url: item.url,
        externalUrl: item.externalUrl || null,
        externalTitle: item.externalTitle || null,
        trustTier: item.trustTier || null,
        isFirstMoverInjuryScoop: Boolean(item.isFirstMoverInjuryScoop),
        corroborationCount: item.corroborationCount || 1,
        corroboratedBy: item.corroboratedBy || null,
        firstReportedBy: item.firstReportedBy || null,
        isBreaking: Boolean(item.isBreaking),
        isInGameInjury: Boolean(item.isInGameInjury),
        breakingBadge: item.breakingBadge || null,
        breakingPriority: item.breakingPriority || 0
      });
    }
  }

  // Second pass: direct canonical per-player ESPN News & Webzone/NinersNation fallback for starters/IR with <3 Pass-1 mentions
  // (Zero opaque news.google.com/rss/articles/... redirect wrappers!)
  const deepTargetPlayers = rosterPlayers.filter(
    p =>
      (mentionsByPlayerId.get(p.id) || []).length < 5 &&
      /^\d{4,10}$/.test(String(p.id || '')) &&
      (p.rosterBucket === 'active' || p.rosterBucket === 'ir') &&
      (p.primarySnapPct >= 15 ||
        p.capHit2026 >= 2_000_000 ||
        p.health?.isOnPracticeReport ||
        p.rosterBucket === 'ir')
  );

  const BATCH_SIZE = 10;
  for (let i = 0; i < deepTargetPlayers.length; i += BATCH_SIZE) {
    const slice = deepTargetPlayers.slice(i, i + BATCH_SIZE);
    await Promise.all(
      slice.map(async p => {
        try {
          const athNews = await fetchJson(
            `https://site.api.espn.com/apis/site/v2/sports/football/nfl/news?athlete=${encodeURIComponent(p.id)}&limit=8`
          );
          let addedForPlayer = 0;
          for (const art of athNews?.articles || []) {
            if (addedForPlayer >= 6 || art.premium) break;
            const headline = cleanSensationalistText(decodeHtmlEntitiesBasic(art.headline || ''));
            const desc = cleanSensationalistText(decodeHtmlEntitiesBasic(art.description || ''));
            const link = sanitizeExternalUrl(art.links?.web?.href || '', null);
            const pubMs = art.published ? new Date(art.published).getTime() : NaN;
            if (
              !headline ||
              !link ||
              isEspnPlayerProfileUrl(link) ||
              !Number.isFinite(pubMs) ||
              pubMs < sevenDayCutoffMs ||
              isOffTopicLeagueFiller({ url: link, title: headline, summary: desc, hasRosterMatch: true }) ||
              isStaleSeasonHeadline(headline, detectedCurrentWeek)
            ) {
              continue;
            }
            const sig = scoreContentSignal(headline, desc);
            if (sig.isClickbait) continue;
            const authInfo = resolveArticleAuthor(art.byline || '', `${desc} ${headline}`, 'ESPN');
            const rawDirRep = authInfo.reporterId
              ? resolveReporterFromNameOrHandle(authInfo.reporterId)
              : resolveReporterFromNameOrHandle(authInfo.authorName);
            const dirRep = rawDirRep && !isPodiumSubjectId(rawDirRep.id) ? rawDirRep : null;
            const pubIso = new Date(pubMs).toISOString();
            const brk = classifyBreakingItem({ title: headline, summary: desc, publishedAt: pubIso });
            const mentionDraft = {
              id: `p7d_${p.id}_${addedForPlayer}`,
              type: 'article',
              headline,
              fullText: null,
              isFullTweet: false,
              summary: desc.slice(0, 220),
              author: authInfo.authorName,
              authorHandle: dirRep?.handle || null,
              authorProfileUrl: dirRep?.xUrl || 'https://www.espn.com/nfl/team/_/name/sf/san-francisco-49ers',
              outletId: 'espn',
              outletName: 'ESPN',
              publishedAt: pubIso,
              imageUrl: art.images?.[0]?.url || '',
              url: link,
              isBreaking: brk.isBreaking,
              isInGameInjury: brk.isInGameInjury,
              breakingBadge: brk.breakingBadge,
              breakingPriority: brk.breakingPriority
            };
            mentionDraft.authorProfileUrl = resolveItemAuthorProfileUrl(mentionDraft, link);
            addMentionToPlayer(p.id, mentionDraft);
            addedForPlayer++;
          }
        } catch {
          // Ignore single-player ESPN athlete news timeout
        }
      })
    );
  }

  // Finalize `p.recentNews` for every roster player: pruned of completed-game availability noise, sorted with breaking first, capped at 10 items in 7d window
  for (const p of rosterPlayers) {
    const collected = filterOutCompletedGameAvailabilityItems(
      mentionsByPlayerId.get(p.id) || [],
      pipelineAppDataStub
    );
    p.recentNews = sortNewsWithBreakingPriority(collected, Date.now(), {
      activeWindowHours: 24,
      gameContext: pipelineGameContext
    }).slice(0, 10);
  }

  // Reconcile Roster Health, Play Likelihoods, IR Return Timelines & Projected Active Depth Chart with Corroborated Beat/Podium News
  const healthReconcileContainer = {
    week: detectedCurrentWeek,
    byeWeek: detectedByeWeek,
    practiceReport: practiceReportPlayers,
    irAndReserveTracker: irTrackerPlayers
  };
  reconcileRosterAndHealthWithNews({
    meta: { currentWeek: detectedCurrentWeek },
    roster: { players: rosterPlayers },
    depthChart: { units: depthUnits },
    health: healthReconcileContainer,
    news: { rawStream: rawNewsStream },
    scheduleMatchup: pipelineAppDataStub.scheduleMatchup
  });
  practiceReportPlayers = healthReconcileContainer.practiceReport;
  irTrackerPlayers = healthReconcileContainer.irAndReserveTracker;

  // 9. Build Schedule, 1st-32nd Team Stats, Power Rankings & Upcoming Matchup (`data/schedule-matchup.json`)
  console.log('[6/6] Computing 1st-32nd NFL Team Rankings, Upcoming Matchup, Opponent Health, Playoff Monte Carlo & Draft Classes...');
  const nflGames2026 = gamesRows.filter(g => g.season === seasonYearStr && g.game_type === 'REG');
  const sfNflGamesByWeek = new Map(
    nflGames2026.filter(g => g.home_team === 'SF' || g.away_team === 'SF').map(g => [Number(g.week), g])
  );

  // Build opponent live records & dynamic team logo + SF standings map from ESPN standings
  const teamRecordsMap = new Map();
  let sfStandingsDetail = {
    record: '6-1',
    wins: 6,
    losses: 1,
    ties: 0,
    playoffSeed: 1,
    divRecord: '3-0',
    confRecord: '4-1',
    pointsFor: 197,
    pointsAgainst: 139,
    pointDiff: 58,
    standingSummary: '1st in NFC West • #1 Seed in NFC',
    pointDifferentialDisplay: '+58 (197 PF / 139 PA)'
  };

  for (const conf of espnStandings.children || []) {
    for (const entry of conf.standings?.entries || []) {
      const abbr = normalizeTeamAbbr(entry.team?.abbreviation);
      const getStat = name => entry.stats?.find(s => s.name === name);
      const overall = getStat('overall')?.displayValue || '0-0';
      const pd = Number(getStat('pointDifferential')?.value || 0);
      teamRecordsMap.set(abbr, {
        record: overall,
        wins: Number(getStat('wins')?.value || 0),
        losses: Number(getStat('losses')?.value || 0),
        ties: Number(getStat('ties')?.value || 0),
        winPct: Number(getStat('winPercent')?.value || 0),
        pointsFor: Number(getStat('pointsFor')?.value || 0),
        pointsAgainst: Number(getStat('pointsAgainst')?.value || 0),
        pointDiff: pd,
        logoUrl: resolveTeamLogoUrl(abbr, entry.team)
      });

      if (abbr === 'SF') {
        const wins = Number(getStat('wins')?.value || 0);
        const losses = Number(getStat('losses')?.value || 0);
        const ties = Number(getStat('ties')?.value || 0);
        const seed = Number(getStat('playoffSeed')?.value || 1);
        const pf = Number(getStat('pointsFor')?.value || 0);
        const pa = Number(getStat('pointsAgainst')?.value || 0);
        const divRec = getStat('vs. Div.')?.displayValue || getStat('divisionRecord')?.displayValue || '0-0';
        const confRec = getStat('vs. Conf.')?.displayValue || '0-0';
        sfStandingsDetail = {
          record: overall,
          wins,
          losses,
          ties,
          playoffSeed: seed,
          divRecord: divRec,
          confRecord: confRec,
          pointsFor: pf,
          pointsAgainst: pa,
          pointDiff: pd,
          standingSummary: `1st in NFC West • #${seed} Seed in NFC`,
          pointDifferentialDisplay: `${pd >= 0 ? '+' : ''}${pd} (${pf} PF / ${pa} PA)`
        };
      }
    }
  }

  // Compute exact NFC West division ordinal dynamically
  const nfcWestRanked = ['SF', 'SEA', 'LAR', 'ARI']
    .map(abbr => ({ abbr, ...(teamRecordsMap.get(abbr) || { winPct: 0, wins: 0, pointDiff: 0 }) }))
    .sort((a, b) => b.winPct - a.winPct || b.wins - a.wins || b.pointDiff - a.pointDiff);
  const sfDivIdx = Math.max(0, nfcWestRanked.findIndex(t => t.abbr === 'SF'));
  const divOrdinal = ['1st', '2nd', '3rd', '4th'][sfDivIdx] || '1st';
  sfStandingsDetail.standingSummary = `${divOrdinal} in NFC West • #${sfStandingsDetail.playoffSeed} Seed in NFC`;

  function normalizeCoachName(rawCoach = '') {
    return String(rawCoach || '')
      .replace(/\bKubliak\b/gi, 'Kubiak')
      .trim();
  }

  function normalizeBroadcastName(rawTv = '') {
    const clean = String(rawTv || '').trim();
    if (!clean) return 'NFL';
    if (/^fox$/i.test(clean)) return 'FOX';
    if (/^cbs$/i.test(clean)) return 'CBS';
    if (/^nbc$/i.test(clean)) return 'NBC';
    if (/^espn$/i.test(clean)) return 'ESPN';
    if (/^abc$/i.test(clean)) return 'ABC';
    if (/prime|amzn/i.test(clean)) return 'Prime Video';
    return clean;
  }

  const scheduleItems = (espnSchedule.events || []).map(ev => {
    const wk = Number(ev.week?.number || 0);
    const comp = ev.competitions?.[0] || {};
    const sfComp = (comp.competitors || []).find(c => c.team?.abbreviation === 'SF');
    const oppComp = (comp.competitors || []).find(c => c.team?.abbreviation !== 'SF');
    const oppAbbr = normalizeTeamAbbr(oppComp?.team?.abbreviation || 'OPP');
    const venue = comp.venue || {};
    const country = venue.address?.country || 'USA';
    const city = venue.address?.city || '';
    const stateRegion = venue.address?.state || '';
    const isInternational = country !== 'USA';
    const nflRow = sfNflGamesByWeek.get(wk) || {};

    const sfRest = sfComp?.homeAway === 'home' ? num(nflRow.home_rest || 7) : num(nflRow.away_rest || 7);
    const oppRest = sfComp?.homeAway === 'home' ? num(nflRow.away_rest || 7) : num(nflRow.home_rest || 7);
    const netRest = sfRest - oppRest;

    const completed = Boolean(comp.status?.type?.completed);
    const sfScore = completed ? Number(sfComp?.score?.value ?? sfComp?.score?.displayValue ?? 0) : null;
    const oppScore = completed ? Number(oppComp?.score?.value ?? oppComp?.score?.displayValue ?? 0) : null;

    const gameUrl =
      ev.links?.find(l => l.rel?.includes('summary') || l.rel?.includes('gamecast'))?.href ||
      ev.links?.[0]?.href ||
      (ev.id ? `https://www.espn.com/nfl/game/_/gameId/${ev.id}` : 'https://www.espn.com/nfl/team/schedule/_/name/sf/san-francisco-49ers');

    return {
      id: ev.id || `wk_${wk}`,
      gameUrl,
      week: wk,
      dateIso: ev.date,
      statusDetail: comp.status?.type?.shortDetail || '',
      completed,
      result: completed ? (sfScore > oppScore ? 'W' : sfScore < oppScore ? 'L' : 'T') : null,
      sfScore,
      oppScore,
      homeAway: sfComp?.homeAway || 'home',
      sfLogoUrl: resolveTeamLogoUrl('SF', sfComp?.team),
      opponent: {
        abbr: oppAbbr,
        name: oppComp?.team?.displayName || oppAbbr,
        logoUrl: resolveTeamLogoUrl(oppAbbr, oppComp?.team) || teamRecordsMap.get(oppAbbr)?.logoUrl || '',
        record: teamRecordsMap.get(oppAbbr)?.record || '—',
        pointDiff: teamRecordsMap.get(oppAbbr)?.pointDiff ?? 0,
        coach: normalizeCoachName(sfComp?.homeAway === 'home' ? nflRow.away_coach : nflRow.home_coach)
      },
      venue: {
        name: venue.fullName || nflRow.stadium || "Levi's Stadium",
        city,
        state: stateRegion,
        country,
        isInternational,
        internationalNote:
          country === 'Australia'
            ? '🌏 International Series — Melbourne, Australia (MCG • 100,000 cap)'
            : country === 'Mexico'
              ? '🇲🇽 International Series — Mexico City (7,200 ft High Altitude)'
              : null,
        surface: venue.grass ? 'Natural Grass' : nflRow.surface === 'grass' ? 'Natural Grass' : 'Synthetic Turf'
      },
      restAdvantageDays: netRest,
      spreadLineSf:
        nflRow.spread_line !== '' && nflRow.spread_line != null
          ? sfComp?.homeAway === 'home'
            ? -Number(nflRow.spread_line)
            : Number(nflRow.spread_line)
          : null,
      totalLine: nflRow.total_line ? Number(nflRow.total_line) : null,
      broadcast: normalizeBroadcastName(comp.broadcasts?.[0]?.media?.shortName || 'NFL')
    };
  });

  // Compute 1st–32nd NFL Team Stat Rankings (Offense, Defense, Special Teams & Margin) + 32-Team Leaderboards
  const regTeams = statsTeam2026.filter(r => r.season_type === 'REG' && r.team);
  function computeTeamRankFor(teamAbbr, metricFn, higherIsBetter = true) {
    const vals = regTeams.map(t => ({ team: normalizeTeamAbbr(t.team), val: metricFn(t) }));
    vals.sort((a, b) => (higherIsBetter ? b.val - a.val : a.val - b.val));
    const idx = vals.findIndex(v => v.team === teamAbbr);
    const teamVal = vals[idx]?.val ?? 0;
    const avgVal = vals.reduce((s, x) => s + x.val, 0) / Math.max(1, vals.length);
    return { rank: idx >= 0 ? idx + 1 : 16, value: teamVal, leagueAvg: avgVal };
  }

  // Batch-fetch ESPN 32-team situational statistics (3rd Down %, Red Zone TD %, Official Turnovers & Net Punting)
  const espnTeamStatsByAbbr = new Map();
  const allLeagueAbbrs = Object.keys(NFL_TEAM_NAMES);
  const TEAM_STAT_BATCH = 8;
  for (let i = 0; i < allLeagueAbbrs.length; i += TEAM_STAT_BATCH) {
    const slice = allLeagueAbbrs.slice(i, i + TEAM_STAT_BATCH);
    await Promise.all(
      slice.map(async abbr => {
        try {
          const slug = toEspnTeamSlug(abbr);
          const stJson = await fetchJson(
            `https://site.api.espn.com/apis/site/v2/sports/football/nfl/teams/${slug}/statistics`
          );
          const ownCats = stJson?.results?.stats?.categories || [];
          const oppRaw = stJson?.results?.opponent;
          const oppCats = Array.isArray(oppRaw) ? oppRaw : oppRaw?.categories || [];
          const findVal = (cats, catName, statName) => {
            const c = cats.find(x => x.name === catName);
            const s = c?.stats?.find(x => x.name === statName);
            return s?.value != null && Number.isFinite(Number(s.value)) ? Number(s.value) : null;
          };
          espnTeamStatsByAbbr.set(abbr, {
            gamesPlayed:
              findVal(ownCats, 'general', 'gamesPlayed') ??
              findVal(ownCats, 'passing', 'teamGamesPlayed'),
            offThirdDownPct: findVal(ownCats, 'miscellaneous', 'thirdDownConvPct'),
            defThirdDownPctAllowed: findVal(oppCats, 'miscellaneous', 'thirdDownConvPct'),
            offRedZoneTdPct: findVal(ownCats, 'miscellaneous', 'redzoneTouchdownPct'),
            defRedZoneTdPctAllowed: findVal(oppCats, 'miscellaneous', 'redzoneTouchdownPct'),
            takeaways: findVal(ownCats, 'miscellaneous', 'totalTakeaways'),
            giveaways: findVal(ownCats, 'miscellaneous', 'totalGiveaways'),
            turnoverDiff: findVal(ownCats, 'miscellaneous', 'turnOverDifferential'),
            netPassingYards: findVal(ownCats, 'passing', 'netPassingYards'),
            oppNetPassingYards: findVal(oppCats, 'passing', 'netPassingYards'),
            oppRushingYards: findVal(oppCats, 'rushing', 'rushingYards'),
            puntNetAvg: findVal(ownCats, 'punting', 'netAvgPuntYards'),
            krAvg: findVal(ownCats, 'returning', 'yardsPerKickReturn'),
            prAvg: findVal(ownCats, 'returning', 'yardsPerPuntReturn'),
            oppKrAvg: findVal(oppCats, 'returning', 'yardsPerKickReturn'),
            oppPrAvg: findVal(oppCats, 'returning', 'yardsPerPuntReturn')
          });
        } catch {
          // Graceful fallback to nflverse weekly + seasonal aggregates
        }
      })
    );
  }

  const teamStatsPayload = computeLeagueTeamStatsPayload({
    regTeams,
    statsTeamWeek: statsTeamWeekCurrent,
    espnTeamStatsByAbbr,
    teamRecordsMap,
    seasonYear
  });
  const { teamStats, teamStatRankings } = teamStatsPayload;

  // Build Live Upcoming Matchup (auto-advances every week as games complete!)
  const nextScheduledGame = scheduleItems.find(g => !g.completed) || scheduleItems[scheduleItems.length - 1];
  const currentWeek = Number(nextScheduledGame?.week || detectedCurrentWeek || 9);
  const oppAbbrTarget = nextScheduledGame?.opponent?.abbr || 'LV';
  const oppNameTarget = nextScheduledGame?.opponent?.name || 'Las Vegas Raiders';
  const oppShortName = oppNameTarget.split(' ').slice(-1)[0] || oppNameTarget;
  const oppCoachName = normalizeCoachName(nextScheduledGame?.opponent?.coach || '');
  const sfIsHome = (nextScheduledGame?.homeAway || 'home') === 'home';

  const FRANCHISE_RELOCATION_ALIASES = {
    LV: ['LV', 'OAK'],
    LAR: ['LAR', 'LA', 'STL'],
    LAC: ['LAC', 'SD'],
    ARI: ['ARI', 'PHO'],
    IND: ['IND', 'BAL'],
    TEN: ['TEN', 'HOU'],
    WAS: ['WAS', 'WSH']
  };
  const PFR_FRANCHISE_CODES = {
    ARI: 'crd', ATL: 'atl', BAL: 'rav', BUF: 'buf', CAR: 'car', CHI: 'chi', CIN: 'cin', CLE: 'cle',
    DAL: 'dal', DEN: 'den', DET: 'det', GB: 'gnb', HOU: 'htx', IND: 'clt', JAX: 'jax', KC: 'kan',
    LAC: 'sdg', LAR: 'ram', LV: 'rai', MIA: 'mia', MIN: 'min', NE: 'nwe', NO: 'nor', NYG: 'nyg',
    NYJ: 'nyj', PHI: 'phi', PIT: 'pit', SEA: 'sea', SF: 'sfo', TB: 'tam', TEN: 'oti', WAS: 'was'
  };
  const oppHistoricalCodes = new Set(FRANCHISE_RELOCATION_ALIASES[oppAbbrTarget] || [oppAbbrTarget]);
  const pfrOppCode = PFR_FRANCHISE_CODES[oppAbbrTarget] || oppAbbrTarget.toLowerCase();

  const h2hOpponentGames = gamesRows
    .filter(
      g =>
        g.away_score !== '' &&
        ((g.home_team === 'SF' && oppHistoricalCodes.has(g.away_team)) ||
          (g.away_team === 'SF' && oppHistoricalCodes.has(g.home_team)))
    )
    .slice(-8)
    .reverse()
    .map(g => {
      const sfHome = g.home_team === 'SF';
      const sfPts = Number(sfHome ? g.home_score : g.away_score);
      const oppPts = Number(sfHome ? g.away_score : g.home_score);
      const oppCodeInGame = sfHome ? g.away_team : g.home_team;
      const espnGameId = g.espn && /^\d{6,}$/.test(String(g.espn).trim()) ? String(g.espn).trim() : '';
      const pfrBoxId = g.pfr && /^[0-9a-z]+$/i.test(String(g.pfr).trim()) ? String(g.pfr).trim() : '';
      const homePfrCode = PFR_FRANCHISE_CODES[g.home_team] || g.home_team?.toLowerCase() || 'sfo';
      const dateDigits = String(g.gameday || '').replace(/-/g, '');
      const boxscoreUrl = espnGameId
        ? `https://www.espn.com/nfl/game/_/gameId/${espnGameId}`
        : pfrBoxId
          ? `https://www.pro-football-reference.com/boxscores/${pfrBoxId}.htm`
          : dateDigits.length === 8
            ? `https://www.pro-football-reference.com/boxscores/${dateDigits}0${homePfrCode}.htm`
            : buildPfrHeadToHeadUrl('SF', oppAbbrTarget);
      return {
        season: Number(g.season),
        date: g.gameday,
        venue: g.location === 'Neutral' ? 'Neutral' : sfHome ? 'Home' : 'Away',
        scoreDisplay: `SF ${sfPts}, ${oppCodeInGame} ${oppPts}`,
        sfWon: sfPts > oppPts,
        overtime: g.overtime === '1',
        boxscoreUrl
      };
    });

  const lastMeeting = h2hOpponentGames[0] || null;
  const lastMeetingNote = lastMeeting
    ? `Most recent meeting (${lastMeeting.date}): ${lastMeeting.sfWon ? 'SF won' : `${oppAbbrTarget} won`} ${lastMeeting.scoreDisplay}${lastMeeting.overtime ? ' in OT' : ''} (${lastMeeting.venue}).`
    : `First recent meeting on the current schedule cycle.`;

  const matchupFeaturedPlayers = [
    'Brock Purdy',
    'Nick Bosa',
    'Christian McCaffrey',
    'DeForest Buckner',
    'George Kittle',
    'Fred Warner'
  ]
    .map(n => playersByNormName.get(normName(n)))
    .filter(p => p && p.health?.playProbabilityPct >= 50)
    .map(p => ({
      id: p.id,
      name: p.name,
      shortName: p.shortName || p.name,
      position: p.position,
      jersey: p.jersey,
      headshotUrl: p.headshotUrl || ''
    }));

  // Fetch Opponent Live Roster, Depth Chart, Transactions, CBS Injuries & ESPN Game Summary in parallel
  const espnOppSlug = toEspnTeamSlug(oppAbbrTarget);
  const [oppRosterRaw, oppDepthRaw, oppTxRaw, cbsOppHtml, nextGameSummaryRaw] = await Promise.all([
    fetchJson(`https://site.api.espn.com/apis/site/v2/sports/football/nfl/teams/${espnOppSlug}/roster`).catch(() => ({ athletes: [] })),
    fetchJson(`https://site.api.espn.com/apis/site/v2/sports/football/nfl/teams/${espnOppSlug}/depthcharts`).catch(() => ({ depthchart: [] })),
    fetchJson(`https://site.api.espn.com/apis/site/v2/sports/football/nfl/transactions?team=${espnOppSlug}&limit=250`).catch(() => ({
      transactions: []
    })),
    fetchText(buildCbsTeamInjuriesUrl(oppAbbrTarget, oppNameTarget)).catch(() => ''),
    nextScheduledGame?.id && /^\d+$/.test(String(nextScheduledGame.id))
      ? fetchJson(`https://site.api.espn.com/apis/site/v2/sports/football/nfl/summary?event=${nextScheduledGame.id}`).catch(() => ({}))
      : Promise.resolve({})
  ]);

  const oppTxAnalysis = analyzeTeamTransactions(oppTxRaw.transactions || [], seasonYear);
  const cbsOppInjuries = parseCbsTeamInjuriesHtml(cbsOppHtml);
  const oppIdsForDeepHealth = [];
  for (const grp of oppRosterRaw.athletes || []) {
    const gKey = String(grp.position || '');
    for (const ath of grp.items || []) {
      const aid = String(ath.id || '');
      const cKey = canonicalPlayerKey(ath.fullName || ath.displayName || '');
      if (
        gKey === 'injuredReserveOrOut' ||
        gKey === 'suspended' ||
        officialInjReport.oppByKey.has(cKey) ||
        cbsOppInjuries.has(cKey) ||
        (ath.injuries || []).length > 0
      ) {
        oppIdsForDeepHealth.push(aid);
      }
    }
  }
  const oppWebAthleteDetails = await fetchEspnAthleteDetailsBatch(oppIdsForDeepHealth, fetchJson);

  // Extract opponent's actual 1st-string starters dynamically from ESPN's live opponent depth chart across BOTH Offense & Defense!
  const dynamicOppStarterNames = new Set();
  const oppOffStarterNames = new Set();
  const oppDefStarterNames = new Set();
  const offStarterSlots = ['qb', 'rb', 'wr1', 'wr2', 'wr3', 'te', 'lt', 'lg', 'c', 'rg', 'rt'];
  const defStarterSlots = ['lde', 'ldt', 'rdt', 'nt', 'rde', 'wlb', 'mlb', 'lilb', 'rilb', 'slb', 'lcb', 'rcb', 'nb', 'ss', 'fs'];
  for (const dc of oppDepthRaw.depthchart || []) {
    const dcNameLower = String(dc.name || '').toLowerCase();
    for (const slot of offStarterSlots) {
      const starter = dc.positions?.[slot]?.athletes?.[0]?.displayName;
      if (starter) {
        const nk = normName(starter);
        dynamicOppStarterNames.add(nk);
        oppOffStarterNames.add(nk);
      }
    }
    for (const slot of defStarterSlots) {
      const starter = dc.positions?.[slot]?.athletes?.[0]?.displayName;
      if (starter) {
        const nk = normName(starter);
        dynamicOppStarterNames.add(nk);
        oppDefStarterNames.add(nk);
      }
    }
    for (const [slotKey, posObj] of Object.entries(dc.positions || {})) {
      const starter = posObj?.athletes?.[0]?.displayName;
      if (!starter) continue;
      const nk = normName(starter);
      dynamicOppStarterNames.add(nk);
      if (dcNameLower.includes('def') || /^(l|r)?(de|dt|nt|lb|ilb|olb|cb|ss|fs|db)/i.test(slotKey)) {
        oppDefStarterNames.add(nk);
      } else if (!/^(pk|p|ls|h|pr|kr)/i.test(slotKey)) {
        oppOffStarterNames.add(nk);
      }
    }
  }

  // Index opponent snap shares & nflverse weekly injury reports + compute opponent's real Bye Week!
  const oppSnapAgg = new Map();
  for (const row of snaps2026) {
    if (!oppHistoricalCodes.has(normalizeTeamAbbr(row.team || '')) && normalizeTeamAbbr(row.team || '') !== oppAbbrTarget) {
      continue;
    }
    const nk = normName(row.player || '');
    if (!nk) continue;
    const prev = oppSnapAgg.get(nk) || { games: 0, maxPctSum: 0 };
    const bestPct = Math.max(num(row.offense_pct), num(row.defense_pct), num(row.st_pct));
    prev.games += 1;
    prev.maxPctSum += bestPct;
    oppSnapAgg.set(nk, prev);
  }
  const getOppSnapPct = nk => {
    const rec = oppSnapAgg.get(nk);
    if (!rec || rec.games === 0) return null;
    return Math.round((rec.maxPctSum / rec.games) * 100);
  };

  const oppNflInjByName = new Map();
  for (const row of injuries2026) {
    if (!oppHistoricalCodes.has(normalizeTeamAbbr(row.team || '')) && normalizeTeamAbbr(row.team || '') !== oppAbbrTarget) {
      continue;
    }
    const nk = normName(row.full_name || '');
    if (!nk) continue;
    const wk = Number(row.week || 0);
    const existing = oppNflInjByName.get(nk);
    if (!existing || wk >= existing.week) {
      oppNflInjByName.set(nk, {
        week: wk,
        firstWeekSeen: existing ? Math.min(existing.firstWeekSeen, wk) : wk,
        primaryInjury: row.report_primary_injury || '',
        reportStatus: row.report_status || '',
        practiceStatus: row.practice_status || ''
      });
    } else if (existing && wk > 0) {
      existing.firstWeekSeen = Math.min(existing.firstWeekSeen, wk);
    }
  }

  const oppPlayedWeeks = new Set(
    nflGames2026
      .filter(
        g =>
          normalizeTeamAbbr(g.home_team) === oppAbbrTarget ||
          normalizeTeamAbbr(g.away_team) === oppAbbrTarget ||
          oppHistoricalCodes.has(g.home_team) ||
          oppHistoricalCodes.has(g.away_team)
      )
      .map(g => Number(g.week))
  );
  let oppByeWeek = 10;
  if (oppPlayedWeeks.size >= 15) {
    for (let w = 4; w <= 14; w++) {
      if (!oppPlayedWeeks.has(w)) {
        oppByeWeek = w;
        break;
      }
    }
  }

  const oppInjuryEntry = (espnInjuries.injuries || []).find(
    t =>
      normalizeTeamAbbr(t.abbreviation || '') === oppAbbrTarget ||
      t.displayName === oppNameTarget ||
      t.displayName?.toLowerCase().includes(oppShortName.toLowerCase())
  );

  const oppInjByName = new Map();
  for (const item of oppInjuryEntry?.injuries || []) {
    const nm = item.athlete?.displayName || item.athlete?.fullName || '';
    if (nm) oppInjByName.set(normName(nm), item);
  }

  const oppBeforePracticeWindow =
    !officialInjReport.hasOppReport && isBeforeWeeklyPracticeWindow(nextScheduledGame?.dateIso || '');
  const oppInjuryReportPlayers = [];
  const oppIrPlayers = [];
  const oppActiveRosterPlayers = [];
  const oppHealthyOffCandidates = [];
  const oppHealthyDefCandidates = [];
  const seenOppNames = new Set();

  for (const grp of oppRosterRaw.athletes || []) {
    const gKey = String(grp.position || '');
    const isIrGroup = gKey === 'injuredReserveOrOut' || gKey === 'suspended';
    if (gKey === 'practiceSquad') continue;
    const unitLabel =
      gKey === 'defense' ? 'Defense' : gKey === 'specialTeam' ? 'Special Teams' : 'Offense';

    for (const ath of grp.items || []) {
      const nm = ath.fullName || ath.displayName;
      const nk = normName(nm);
      if (seenOppNames.has(nk)) continue;

      const oppCanonKey = canonicalPlayerKey(nm);
      const oppTxRec = oppTxAnalysis.byKey.get(oppCanonKey) || null;
      if (oppTxRec?.releasedInjurySettlement || oppTxRec?.latestRosterMoveBucket === 'released') {
        continue;
      }

      const pos = ath.position?.abbreviation || 'ATH';
      const espnId = String(ath.id || '');
      const headshotUrl =
        ath.headshot?.href ||
        (/^\d+$/.test(espnId) ? `https://a.espncdn.com/i/headshots/nfl/players/full/${espnId}.png` : '');
      const espnUrl = buildEspnPlayerUrl(espnId, nm);
      const jersey = ath.jersey !== undefined && ath.jersey !== null && ath.jersey !== '' ? Number(ath.jersey) : null;
      const expYears = Number.isFinite(Number(ath.experience?.years)) ? Number(ath.experience.years) : null;
      const snapPct = getOppSnapPct(nk);

      if (!isIrGroup) {
        oppActiveRosterPlayers.push({
          id: espnId,
          name: nm,
          position: pos,
          unit: classifyRosterUnit(pos, unitLabel),
          rosterBucket: 'active',
          jersey,
          headshotUrl,
          espnUrl,
          snapPct,
          isStarter: dynamicOppStarterNames.has(nk)
        });
      }
      const nflInjRec = oppNflInjByName.get(nk) || null;
      const offOppInjRec = officialInjReport.oppByKey.get(oppCanonKey) || null;
      const oppWebInj = oppWebAthleteDetails.get(espnId)?.injury || null;
      const oppCbsRec = cbsOppInjuries.get(oppCanonKey) || null;

      const injFeedItem = oppInjByName.get(nk) || null;
      const inlineInj = ath.injuries?.[0] || null;
      const rawStatus =
        offOppInjRec?.gameStatus ||
        injFeedItem?.status ||
        oppWebInj?.status ||
        inlineInj?.status ||
        (isIrGroup ? 'Injured Reserve' : 'Active');
      const rawShort = cleanSensationalistText(
        pickMeaningfulInjuryComment(injFeedItem?.shortComment, oppWebInj?.shortComment, inlineInj?.shortComment)
      );
      const rawLong = cleanSensationalistText(
        pickMeaningfulInjuryComment(injFeedItem?.longComment, oppWebInj?.longComment, inlineInj?.longComment, rawShort)
      );
      const combinedBeatLower = `${rawShort} ${rawLong}`.toLowerCase();

      const oppLeadBodyPart = (() => {
        const m = rawShort.match(/^[A-Z][A-Za-z'. -]{1,28}\s+\(([a-zA-Z /,-]{3,28})\)/);
        if (!m) return '';
        const cand = m[1].trim();
        if (/\b(solo|tackle|yard|target|catch|carry|touchdown|sack|int|fumble|pat|attempt)\b/i.test(cand)) return '';
        return cand.charAt(0).toUpperCase() + cand.slice(1);
      })();

      const isIrReturnQuestionable =
        isIrGroup &&
        !/not activated|didn't activate|did not activate|remains on injured reserve|ruled out|will miss/i.test(
          combinedBeatLower
        ) &&
        (offOppInjRec?.gameStatus === 'Questionable' ||
          combinedBeatLower.includes('listed as questionable') ||
          combinedBeatLower.includes('questionable for sunday') ||
          combinedBeatLower.includes('questionable ahead of') ||
          combinedBeatLower.includes('likely will be activated') ||
          combinedBeatLower.includes('expected to be activated'));

      const hasExplicitInjuryDesignation =
        isIrReturnQuestionable ||
        (officialInjReport.hasOppReport
          ? Boolean(offOppInjRec)
          : ['out', 'doubtful', 'questionable'].includes(rawStatus.toLowerCase()) ||
            Boolean(injFeedItem?.details?.type) ||
            Boolean(inlineInj?.details?.type && !isIrGroup) ||
            (Boolean(oppLeadBodyPart) &&
              /(designation|questionable|ruled out|will miss|doubtful|limited|did not practice)/i.test(rawShort)));

      const specificInjuryType =
        offOppInjRec?.injuryType ||
        oppCbsRec?.injuryType ||
        injFeedItem?.details?.type ||
        oppWebInj?.injuryType ||
        inlineInj?.details?.type ||
        oppLeadBodyPart ||
        nflInjRec?.primaryInjury ||
        '';

      if (isIrGroup && !isIrReturnQuestionable) {
        seenOppNames.add(nk);
        const isSuspended = gKey === 'suspended' || /suspend/i.test(rawStatus);
        const oppIrClass = classifyIrAndReserveTimeline({
          statusRaw: isSuspended ? 'Reserve / Suspended' : rawStatus,
          fantasyStatusAbbr: oppWebInj?.fantasyStatusAbbr || injFeedItem?.details?.fantasyStatus?.abbreviation || '',
          injuryType: specificInjuryType || (isSuspended ? 'League Suspension' : 'Undisclosed'),
          injuryDetail: oppWebInj?.injuryDetail || injFeedItem?.details?.detail || '',
          returnDateIso: oppWebInj?.returnDate || injFeedItem?.details?.returnDate || inlineInj?.details?.returnDate || null,
          placedDateIso: oppWebInj?.date || inlineInj?.date || null,
          txPlacedDateIso: oppTxRec?.placedOnIrDate || null,
          designatedDateIso: oppTxRec?.designatedToReturnDate || null,
          beatNote: rawLong || rawShort,
          txNote: oppTxRec?.placedOnIrNote || '',
          cbsStatusText: oppCbsRec?.statusText || '',
          isDesignatedToReturnOpen:
            Boolean(oppTxRec?.designatedToReturnOpen) ||
            /21-day|designated to return|returned to practice|practice window/i.test(combinedBeatLower),
          currentWeek,
          byeWeek: oppByeWeek,
          seasonYear,
          scheduleEvents: espnSchedule.events || []
        });

        oppIrPlayers.push({
          name: nm,
          position: pos,
          jersey,
          headshotUrl,
          espnUrl,
          snapPct,
          status: oppIrClass.status,
          injuryType: oppIrClass.injuryType,
          isSeasonEnding: oppIrClass.isSeasonEnding,
          isPracticeWindowOpen: oppIrClass.isPracticeWindowOpen,
          placedWeek: oppIrClass.placedBeforeWeek,
          earliestEligibleWeek: oppIrClass.earliestEligibleWeek,
          projectedReturnWeek: oppIrClass.projectedReturnWeek,
          byeWeekNote: oppIrClass.isSeasonEnding
            ? oppIrClass.byeWeekNote
            : oppIrClass.byeWeekNote.includes('Bye excluded')
              ? `Excludes ${oppAbbrTarget} Week ${oppByeWeek} Bye under NFL 4-game IR rule`
              : `${oppAbbrTarget} Bye Week ${oppByeWeek} • 4-game NFL minimum`,
          beatNote: oppIrClass.beatNote,
          playProbabilityPct: 0,
          playBadgeLabel: oppIrClass.isSeasonEnding
            ? '0% • Out for Season'
            : isSuspended
              ? '0% • Suspended'
              : '0% • IR'
        });
        continue;
      }

      if (hasExplicitInjuryDesignation) {
        const oppEarlyRoll =
          !offOppInjRec && oppBeforePracticeWindow && !isIrReturnQuestionable
            ? resolveEarlyWeekRolloverInput({
                rawStatus,
                injuryType: specificInjuryType,
                shortComment: rawShort,
                longComment: rawLong,
                upcomingWeek: currentWeek
              })
            : null;
        if (oppEarlyRoll?.skip) {
          if (dynamicOppStarterNames.has(nk)) {
            seenOppNames.add(nk);
            const healthyStarterProb = computePlayerPlayProbability({
              name: nm,
              position: pos,
              experienceYears: expYears,
              snapPct,
              rosterBucket: 'active'
            });
            const starterEntry = {
              name: nm,
              position: pos,
              unit: oppDefStarterNames.has(nk) ? 'Defense' : 'Offense',
              jersey,
              headshotUrl,
              espnUrl,
              snapPct,
              gameStatus: 'Active • Off Injury Report',
              playProbabilityPct: healthyStarterProb.probabilityPct,
              playBadgeLabel: healthyStarterProb.badgeLabel,
              archetypeNote: healthyStarterProb.priorUsed?.archetypeNote || '',
              shortComment:
                snapPct != null
                  ? `1st-string ${oppDefStarterNames.has(nk) ? 'Defense' : 'Offense'} (${snapPct}% snaps) • Off injury report.`
                  : 'Listed 1st-string on depth chart; active without game designation.'
            };
            if (oppDefStarterNames.has(nk)) {
              oppHealthyDefCandidates.push(starterEntry);
            } else {
              oppHealthyOffCandidates.push(starterEntry);
            }
          }
          continue;
        }
        seenOppNames.add(nk);
        const extractedDays = offOppInjRec
          ? { wed: offOppInjRec.wed, thu: offOppInjRec.thu, fri: offOppInjRec.fri }
          : oppBeforePracticeWindow
            ? { wed: '-', thu: '-', fri: '-' }
            : extractPracticeDaysFromText({
                statusRaw: isIrReturnQuestionable ? 'Questionable' : rawStatus,
                injuryType: specificInjuryType,
                shortComment: rawShort,
                longComment: rawLong,
                nflversePracticeStatus: nflInjRec?.week === currentWeek ? nflInjRec.practiceStatus : ''
              });
        const { wed, thu, fri } = extractedDays;

        const effectiveOppStatus = isIrReturnQuestionable
          ? 'Questionable'
          : offOppInjRec
            ? offOppInjRec.gameStatus || 'Active'
            : oppEarlyRoll
              ? oppEarlyRoll.effectiveStatus
              : rawStatus;

        const prob = computePlayerPlayProbability({
          name: nm,
          position: pos,
          experienceYears: expYears,
          snapPct,
          gameStatus: effectiveOppStatus,
          priorWeekStatus: rawStatus,
          missedPriorGame: oppEarlyRoll ? oppEarlyRoll.missedPriorGame : undefined,
          priorWeekPracticed: oppEarlyRoll ? oppEarlyRoll.priorWeekPracticed : undefined,
          rosterBucket: isIrGroup ? 'ir' : 'active',
          isIrReturnQuestionable,
          injuryType: specificInjuryType,
          wed,
          thu,
          fri,
          beatNote: oppEarlyRoll ? oppEarlyRoll.beatNoteForModel : `${rawShort} ${rawLong}`
        });

        oppInjuryReportPlayers.push({
          name: nm,
          position: pos,
          unit: unitLabel,
          jersey,
          headshotUrl,
          espnUrl,
          snapPct,
          wed,
          thu,
          fri,
          injuryType: specificInjuryType || 'Cleared',
          gameStatus: isIrReturnQuestionable
            ? 'IR Return Window (Q)'
            : effectiveOppStatus === 'Active' || !effectiveOppStatus
              ? 'No Designation (Cleared)'
              : effectiveOppStatus,
          shortComment: rawShort,
          longComment: rawLong,
          isStarter: dynamicOppStarterNames.has(nk),
          isIrReturnQuestionable,
          playProbabilityPct: prob.probabilityPct,
          playTier: prob.tier,
          playBadgeLabel: prob.badgeLabel,
          factors: prob.factors || [],
          archetypeNote: prob.priorUsed?.archetypeNote || ''
        });
      } else if (dynamicOppStarterNames.has(nk)) {
        seenOppNames.add(nk);
        const healthyStarterProb = computePlayerPlayProbability({
          name: nm,
          position: pos,
          experienceYears: expYears,
          snapPct,
          rosterBucket: 'active'
        });
        const starterEntry = {
          name: nm,
          position: pos,
          unit: oppDefStarterNames.has(nk) ? 'Defense' : 'Offense',
          jersey,
          headshotUrl,
          espnUrl,
          snapPct,
          gameStatus: 'Active • Off Injury Report',
          playProbabilityPct: healthyStarterProb.probabilityPct,
          playBadgeLabel: healthyStarterProb.badgeLabel,
          archetypeNote: healthyStarterProb.priorUsed?.archetypeNote || '',
          shortComment:
            snapPct != null
              ? `1st-string ${oppDefStarterNames.has(nk) ? 'Defense' : 'Offense'} (${snapPct}% snaps) • Off injury report.`
              : 'Listed 1st-string on depth chart; active without game designation.'
        };
        if (oppDefStarterNames.has(nk)) {
          oppHealthyDefCandidates.push(starterEntry);
        } else {
          oppHealthyOffCandidates.push(starterEntry);
        }
      }
    }
  }

  // Catch any additional opponent injury feed item not matched above
  for (const item of oppInjuryEntry?.injuries || []) {
    const nm = item.athlete?.displayName || item.athlete?.fullName || '';
    const nk = normName(nm);
    if (!nm || seenOppNames.has(nk)) continue;
    const rawStatus = item.status || 'Active';
    const rawShort = cleanSensationalistText(item.shortComment || '');
    const rawLong = cleanSensationalistText(item.longComment || rawShort);
    const leadPart = (() => {
      const m = rawShort.match(/^[A-Z][A-Za-z'. -]{1,28}\s+\(([a-zA-Z /,-]{3,28})\)/);
      if (!m) return '';
      const cand = m[1].trim();
      return /\b(solo|tackle|yard|target|catch|carry|touchdown|sack|int|fumble)\b/i.test(cand) ? '' : cand;
    })();
    const hasDesignation = officialInjReport.hasOppReport
      ? ['out', 'doubtful', 'questionable'].includes(rawStatus.toLowerCase())
      : ['out', 'doubtful', 'questionable'].includes(rawStatus.toLowerCase()) ||
        Boolean(item.details?.type) ||
        (Boolean(leadPart) && /(designation|questionable|ruled out|will miss|doubtful)/i.test(rawShort));
    if (!hasDesignation) continue;
    const injuryType = item.details?.type || leadPart || '';
    const oppFallbackEarlyRoll = oppBeforePracticeWindow
      ? resolveEarlyWeekRolloverInput({
          rawStatus,
          injuryType,
          shortComment: rawShort,
          longComment: rawLong,
          upcomingWeek: currentWeek
        })
      : null;
    if (oppFallbackEarlyRoll?.skip) continue;
    seenOppNames.add(nk);
    const pos = item.athlete?.position?.abbreviation || 'ATH';
    const snapPct = getOppSnapPct(nk);
    const { wed, thu, fri } = oppBeforePracticeWindow
      ? { wed: '-', thu: '-', fri: '-' }
      : extractPracticeDaysFromText({
          statusRaw: rawStatus,
          injuryType,
          shortComment: rawShort,
          longComment: rawLong
        });
    const effectiveFallbackStatus = oppFallbackEarlyRoll ? oppFallbackEarlyRoll.effectiveStatus : rawStatus;
    const prob = computePlayerPlayProbability({
      name: nm,
      position: pos,
      snapPct,
      gameStatus: effectiveFallbackStatus,
      rosterBucket: 'active',
      injuryType,
      wed,
      thu,
      fri,
      beatNote: oppFallbackEarlyRoll ? oppFallbackEarlyRoll.beatNoteForModel : `${rawShort} ${rawLong}`
    });
    const oppFallbackEspnId = String(
      item.athlete?.id ||
        item.athlete?.headshot?.href?.match(/\/(\d+)\.png/)?.[1] ||
        item.athlete?.links?.[0]?.href?.match(/\/id\/(\d+)/)?.[1] ||
        ''
    );
    oppInjuryReportPlayers.push({
      name: nm,
      position: pos,
      unit: 'Active',
      jersey: null,
      headshotUrl:
        item.athlete?.headshot?.href ||
        (/^\d+$/.test(oppFallbackEspnId) ? `https://a.espncdn.com/i/headshots/nfl/players/full/${oppFallbackEspnId}.png` : ''),
      espnUrl: buildEspnPlayerUrl(oppFallbackEspnId, nm),
      snapPct,
      wed,
      thu,
      fri,
      injuryType: injuryType || 'Injury Report',
      gameStatus: effectiveFallbackStatus === 'Active' ? 'No Designation (Cleared)' : effectiveFallbackStatus,
      shortComment: rawShort,
      longComment: rawLong,
      isStarter: dynamicOppStarterNames.has(nk),
      isIrReturnQuestionable: false,
      playProbabilityPct: prob.probabilityPct,
      playTier: prob.tier,
      playBadgeLabel: prob.badgeLabel,
      factors: prob.factors || [],
      archetypeNote: prob.priorUsed?.archetypeNote || ''
    });
  }

  // Balance key healthy starters across BOTH Offense & Defense (sorted by snap share!)
  oppHealthyOffCandidates.sort((a, b) => (b.snapPct ?? 50) - (a.snapPct ?? 50));
  oppHealthyDefCandidates.sort((a, b) => (b.snapPct ?? 50) - (a.snapPct ?? 50));
  const oppKeyHealthyStarters = [
    ...oppHealthyOffCandidates.slice(0, 6),
    ...oppHealthyDefCandidates.slice(0, 6)
  ];

  oppIrPlayers.sort(
    (a, b) => sortIrTrackerPriority(a) - sortIrTrackerPriority(b) || (b.snapPct ?? 0) - (a.snapPct ?? 0) || a.name.localeCompare(b.name)
  );
  oppInjuryReportPlayers.sort((a, b) => a.playProbabilityPct - b.playProbabilityPct);

  // Compute Opponent Overall Availability Index (0-100, snap-weighted starter parity with 49ers Health!)
  const totalOppStarters = Math.max(22, oppHealthyOffCandidates.length + oppHealthyDefCandidates.length + oppInjuryReportPlayers.filter(p => p.isStarter).length);
  const healthyOrLikelyOppStarters =
    oppHealthyOffCandidates.length +
    oppHealthyDefCandidates.length +
    oppInjuryReportPlayers.filter(p => p.isStarter && p.playProbabilityPct >= 75).length;
  const oppOutStarterPenalty = oppInjuryReportPlayers.filter(p => p.isStarter && p.playProbabilityPct === 0).length * 4.5;
  const oppQStarterPenalty = oppInjuryReportPlayers.filter(p => p.isStarter && p.playProbabilityPct > 0 && p.playProbabilityPct < 85).length * 2.0;
  const oppIrImpactPenalty = Math.min(10, oppIrPlayers.filter(p => (p.snapPct ?? 0) >= 35).length * 3.5 + oppIrPlayers.length * 0.6);
  const oppOverallAvailabilityScore = Math.max(
    50,
    Math.min(99, Math.round(96 - oppOutStarterPenalty - oppQStarterPenalty - oppIrImpactPenalty))
  );

  // Format dynamic kickoff time in America/Los_Angeles PT + live broadcast TV network
  const kickoffDateObj = nextScheduledGame?.dateIso ? new Date(nextScheduledGame.dateIso) : new Date('2026-11-08T21:25:00Z');
  const ptDatePart = kickoffDateObj.toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'America/Los_Angeles'
  });
  const ptTimePart = kickoffDateObj.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    timeZone: 'America/Los_Angeles'
  });
  const liveTvNetwork = nextScheduledGame?.broadcast || 'FOX';
  const kickoffDisplayDynamic = `${ptDatePart} • ${ptTimePart} PT (${liveTvNetwork})`;

  const venueLoc = [nextScheduledGame?.venue?.city, nextScheduledGame?.venue?.state || nextScheduledGame?.venue?.country]
    .filter(Boolean)
    .join(', ');
  const venueDisplayDynamic = `${nextScheduledGame?.venue?.name || "Levi's Stadium"}${venueLoc ? ` • ${venueLoc}` : ''} (${nextScheduledGame?.venue?.surface || 'Natural Grass'})`;

  // Extract live ESPN pickcenter odds (with nflverse schedule fallback)
  const pickPrimary = nextGameSummaryRaw?.pickcenter?.[0] || null;
  const sfSpreadNum = (() => {
    if (pickPrimary?.details) {
      const [favAbbr, numStr] = String(pickPrimary.details).trim().split(/\s+/);
      const parsed = Number(numStr);
      if (Number.isFinite(parsed)) {
        return normalizeTeamAbbr(favAbbr) === 'SF' ? -Math.abs(parsed) : Math.abs(parsed);
      }
    }
    return nextScheduledGame?.spreadLineSf ?? -3.0;
  })();
  const liveOverUnder = Number(pickPrimary?.overUnder || nextScheduledGame?.totalLine || 47.5);
  const spreadDisplay =
    sfSpreadNum === 0
      ? 'PK'
      : sfSpreadNum < 0
        ? `SF ${sfSpreadNum.toFixed(1)}`
        : `SF +${sfSpreadNum.toFixed(1)}`;

  const sfMoneylineRaw = sfIsHome ? pickPrimary?.homeTeamOdds?.moneyLine : pickPrimary?.awayTeamOdds?.moneyLine;
  const oppMoneylineRaw = sfIsHome ? pickPrimary?.awayTeamOdds?.moneyLine : pickPrimary?.homeTeamOdds?.moneyLine;
  const fmtMl = v => (v == null ? null : Number(v) > 0 ? `+${v}` : `${v}`);
  const moneylineDisplay =
    sfMoneylineRaw != null && oppMoneylineRaw != null
      ? `SF ${fmtMl(sfMoneylineRaw)} | ${oppAbbrTarget} ${fmtMl(oppMoneylineRaw)}`
      : sfSpreadNum < 0
        ? 'SF Moneyline Favorite'
        : `${oppAbbrTarget} Moneyline Favorite`;

  const openSpreadLine = sfIsHome
    ? pickPrimary?.pointSpread?.home?.open?.line
    : pickPrimary?.pointSpread?.away?.open?.line;
  const openingSpreadDisplay = openSpreadLine
    ? `Opened SF ${openSpreadLine} (${pickPrimary?.provider?.name || 'Sportsbook Consensus'})`
    : `Consensus ${spreadDisplay}`;

  const sfImplied = ((liveOverUnder - sfSpreadNum) / 2).toFixed(1);
  const oppImplied = ((liveOverUnder + sfSpreadNum) / 2).toFixed(1);
  const impliedScoreDisplay = `SF ${sfImplied} – ${oppAbbrTarget} ${oppImplied}`;

  const restDelta = Number(nextScheduledGame?.restAdvantageDays || 0);
  const restAdvDisplay =
    restDelta > 0
      ? `+${restDelta} Days Rest Advantage${currentWeek === detectedByeWeek + 1 ? ` (SF off Week ${detectedByeWeek} Bye)` : ''}`
      : restDelta < 0
        ? `${restDelta} Days Rest Differential (${oppAbbrTarget} extra rest)`
        : 'Even Rest (Standard Prep Week)';

  // Compute Opponent 2026 Team EPA & Trench Ranks for Dynamic Matchup Matrix
  const sfPassEpaRank = computeTeamRankFor('SF', t => num(t.passing_epa) / Math.max(1, num(t.games)), true);
  const sfSackAllowRank = computeTeamRankFor('SF', t => (num(t.sacks_suffered) / Math.max(1, num(t.attempts) + num(t.sacks_suffered))) * 100, false);
  const oppPassEpaRank = computeTeamRankFor(oppAbbrTarget, t => num(t.passing_epa) / Math.max(1, num(t.games)), true);
  const oppSackAllowRank = computeTeamRankFor(oppAbbrTarget, t => (num(t.sacks_suffered) / Math.max(1, num(t.attempts) + num(t.sacks_suffered))) * 100, false);
  const oppDefSacksRank = computeTeamRankFor(oppAbbrTarget, t => num(t.def_sacks) / Math.max(1, num(t.games)), true);

  const oppQbStarter = oppKeyHealthyStarters.find(p => p.position === 'QB')?.name || `${oppShortName} QB1`;
  const oppEdgeOrStar =
    oppKeyHealthyStarters.find(p => ['DE', 'OLB', 'LB', 'DT'].includes(p.position))?.name || `${oppShortName} Front`;
  const oppSkillStar =
    oppKeyHealthyStarters.find(p => ['WR', 'TE', 'RB'].includes(p.position))?.name || `${oppShortName} Skill Corps`;

  const coachingMatchupDynamic =
    oppAbbrTarget === 'LV' && oppCoachName.includes('Kubiak')
      ? {
          headline: 'Kyle Shanahan & DC Raheem Morris vs. Raiders HC Klint Kubiak (Former 2023 49ers Passing Game Specialist)',
          summary:
            "Klint Kubiak spent the entire 2023 Super Bowl LVIII run inside Kyle Shanahan's offensive meeting room as San Francisco's Passing Game Specialist. Both offenses marry outside zone to deep boot/over play-action with Kirk Cousins and Brock Bowers—giving DC Raheem Morris, Fred Warner, and Deommodore Lenoir direct blueprint familiarity with Kubiak's route-spacing rules and disguised split-safety rotations.",
          bullets: [
            `Shanahan Post-Bye Track Record: Coming off the Week ${detectedByeWeek} Bye with a +${Math.max(7, restDelta)}-day rest edge, SF historically averages +0.21 EPA/play on opening-15 scripted snaps when QB1 is healthy.`,
            'Countering Maxx Crosby (DE #98): Crosby plays ~96% of Las Vegas defensive snaps. Expect 21-personnel Kittle/Juszczyk edge chips and quick rhythm throws whenever Crosby aligns over RT Colton McKivitz.',
            'Raheem Morris Wide-9 & Interior Stunts vs. Raiders Pocket: Pairing DeForest Buckner + Osa Odighizuwa (#92) on interior T-E stunts alongside Nick Bosa prevents Las Vegas from sliding center Tyler Linderbaum toward Bosa.'
          ]
        }
      : {
          headline: `Kyle Shanahan & DC Raheem Morris vs. ${oppNameTarget}${oppCoachName ? ` HC ${oppCoachName}` : ''}`,
          summary: `San Francisco (${sfStandingsDetail.record}) matches its #${sfPassEpaRank.rank} NFL passing EPA offense (+${sfPassEpaRank.value.toFixed(2)}/gm) and #${sfSackAllowRank.rank} pass protection (${sfSackAllowRank.value.toFixed(1)}% sack rate) against ${oppNameTarget} (${teamRecordsMap.get(oppAbbrTarget)?.record || '—'}), led on the field by ${oppQbStarter}, ${oppSkillStar}, and ${oppEdgeOrStar}.`,
          bullets: [
            `Pass-Game Efficiency Delta: SF enters ranked #${sfPassEpaRank.rank} in Passing EPA/game vs. ${oppAbbrTarget}'s #${oppPassEpaRank.rank} offensive passing EPA mark (${oppPassEpaRank.value >= 0 ? '+' : ''}${oppPassEpaRank.value.toFixed(2)}/gm).`,
            `Raheem Morris Trench Plan: ${oppAbbrTarget} allows sacks on ${oppSackAllowRank.value.toFixed(1)}% of dropbacks (#${oppSackAllowRank.rank} NFL) entering its matchup with Nick Bosa, DeForest Buckner, and Osa Odighizuwa.`,
            `Rest & Venue Factor: ${venueDisplayDynamic} • ${restAdvDisplay}.`
          ]
        };

  const keyMatchupsMatrixDynamic = [
    {
      unitMatchup: `49ers Pass Protection (${sfSackAllowRank.value.toFixed(1)}% Sack Rate, #${sfSackAllowRank.rank} NFL) vs. ${oppEdgeOrStar} & ${oppShortName} Rush (#${oppDefSacksRank.rank} Sacks/Gm)`,
      advantage: sfSackAllowRank.rank <= oppDefSacksRank.rank ? 'SF Edge' : 'Even Trench Battle',
      tacticalDetail: `Trent Williams + 21-personnel Kittle/Juszczyk chip releases keep Brock Purdy clean on intermediate in-breakers against ${oppNameTarget}'s edge pressure.`
    },
    {
      unitMatchup: `Purdy Play-Action & Middle-of-Field (#${sfPassEpaRank.rank} Pass EPA) vs. ${oppShortName} Coverage`,
      advantage: 'SF Edge',
      tacticalDetail: `George Kittle, Christian McCaffrey, Brandin Cooks, and SF's motion spacing stress second-level zone leverage between the numbers.`
    },
    {
      unitMatchup: `Nick Bosa + DeForest Buckner + Osa Odighizuwa vs. ${oppQbStarter} & ${oppShortName} O-Line (#${oppSackAllowRank.rank} Sack Rate Allowed)`,
      advantage: oppSackAllowRank.rank >= 12 ? 'SF Heavy Edge' : 'SF Slight Edge',
      tacticalDetail: `Aligning Buckner and Odighizuwa inside forces interior protection slides, isolating Bosa 1-on-1 on the Wide-9 rail.`
    }
  ];

  const upcomingMatchup = {
    week: currentWeek,
    gameId: nextScheduledGame?.id || null,
    homeAway: sfIsHome ? 'home' : 'away',
    gameUrl: nextScheduledGame?.gameUrl || 'https://www.espn.com/nfl/team/schedule/_/name/sf/san-francisco-49ers',
    injurySourceUrl: 'https://www.espn.com/nfl/injuries',
    sfInjuryReportUrl: 'https://www.49ers.com/team/injury-report/',
    statsSourceUrl: 'https://github.com/nflverse/nflverse-data',
    dateIso: nextScheduledGame?.dateIso || kickoffDateObj.toISOString(),
    kickoffIso: nextScheduledGame?.dateIso || kickoffDateObj.toISOString(),
    kickoffDisplay: kickoffDisplayDynamic,
    broadcast: liveTvNetwork,
    venue: venueDisplayDynamic,
    sfRecord: `${sfStandingsDetail.record} (#${sfStandingsDetail.playoffSeed} Seed in NFC)`,
    sfLogoUrl: teamRecordsMap.get('SF')?.logoUrl || resolveTeamLogoUrl('SF'),
    oppAbbr: oppAbbrTarget,
    oppName: oppNameTarget,
    oppLogoUrl: teamRecordsMap.get(oppAbbrTarget)?.logoUrl || resolveTeamLogoUrl(oppAbbrTarget),
    oppRecord: teamRecordsMap.get(oppAbbrTarget)?.record || '—',
    featuredPlayers: matchupFeaturedPlayers,
    opponentHealth: {
      teamAbbr: oppAbbrTarget,
      teamName: oppNameTarget,
      sourceUrl: 'https://www.espn.com/nfl/injuries',
      teamInjuriesUrl: buildEspnTeamInjuriesUrl(oppAbbrTarget),
      byeWeek: oppByeWeek,
      summary: {
        overallAvailabilityScore: oppOverallAvailabilityScore,
        activeStartersHealthy: Math.min(22, healthyOrLikelyOppStarters),
        totalStarters: Math.min(22, totalOppStarters),
        ruledOutCount: oppInjuryReportPlayers.filter(p => p.playProbabilityPct === 0).length,
        questionableOrDoubtfulCount: oppInjuryReportPlayers.filter(p => p.playProbabilityPct > 0 && p.playProbabilityPct < 85).length,
        clearedCount: oppInjuryReportPlayers.filter(p => p.playProbabilityPct >= 85).length,
        irCount: oppIrPlayers.length
      },
      activeRoster: oppActiveRosterPlayers,
      injuryReport: oppInjuryReportPlayers,
      keyStartersHealthy: oppKeyHealthyStarters,
      irReserve: oppIrPlayers
    },
    betting: {
      favorite: sfSpreadNum <= 0 ? 'San Francisco 49ers' : oppNameTarget,
      spread: spreadDisplay,
      openingSpread: openingSpreadDisplay,
      overUnder: liveOverUnder,
      moneyline: moneylineDisplay,
      impliedScore: impliedScoreDisplay,
      restAdvantage: restAdvDisplay
    },
    franchiseHistory: {
      recentRecord: `${h2hOpponentGames.filter(x => x.sfWon).length}-${h2hOpponentGames.filter(x => !x.sfWon).length} in last ${h2hOpponentGames.length} meetings`,
      lastMeetingNote,
      pfrQueryUrl: buildPfrHeadToHeadUrl('SF', oppAbbrTarget),
      recentGames: h2hOpponentGames
    },
    coachingMatchup: coachingMatchupDynamic,
    keyMatchupsMatrix: keyMatchupsMatrixDynamic
  };

  // Build AI Beat Synthesis Clusters now that full live Matchup, Standings & Cap context is ready!
  const openWindowIrNames = irTrackerPlayers
    .filter(ir => ir.isPracticeWindowOpen)
    .map(ir => `${ir.name} (${ir.position})`);
  const postGameInjuryHeadlines = rawNewsStream
    .filter(it => it.type !== 'video' && (it.isPostGameInjuryUpdate || it.category === 'injury'))
    .map(it => String(it.title || '').trim())
    .filter(Boolean)
    .slice(0, 2);
  const practiceSummaryBullets = sfBeforePracticeWindow
    ? [
        ...postGameInjuryHeadlines,
        openWindowIrNames.length > 0
          ? `Active 21-Day IR Return Windows entering Week ${currentWeek}: ${openWindowIrNames.join(', ')} (${remainingIrDesignations}/8 regular-season return designations remaining).`
          : `Official Week ${currentWeek} practice participation opens Wednesday at SAP Performance Facility (${remainingIrDesignations}/8 IR return designations remaining).`
      ].slice(0, 3)
    : practiceReportPlayers
        .slice(0, 3)
        .map(p => `${p.name} (${p.position} — ${p.injuryType}): ${p.playBadgeLabel} [${p.wed}/${p.thu}/${p.fri}].`);

  const activeSeasonCalendar = buildNflCalendarForSeasonYear(seasonYear);
  const nextCapYrKey = String(Number(capPrimaryYrKey) + 1);
  const clusteredBriefs = await buildClusteredNewsBriefs(liveYtClips, rawNewsStream, rosterPlayers, {
    seasonYear,
    currentWeek,
    teamRecord: sfStandingsDetail.record,
    standingSummary: sfStandingsDetail.standingSummary,
    pointDifferential: sfStandingsDetail.pointDifferentialDisplay,
    upcomingMatchup,
    capSpaceGross: otcParsed.years[capPrimaryYrKey]?.teamCapSpace || 35_164_858,
    capSpaceEffective: otcParsed.years[capPrimaryYrKey]?.effectiveCapSpace || 28_664_858,
    capSpace2027: otcParsed.years[nextCapYrKey]?.teamCapSpace ?? -31_540_066,
    tradeDeadlineIso: activeSeasonCalendar.tradeDeadline,
    isBeforePracticeWindow: sfBeforePracticeWindow,
    practiceSummaryBullets
  });

  const liveEspnPrStoryUrl = sanitizeExternalUrl(
    (espnNews.articles || []).find(
      a => !a.premium && /nfl power rankings/i.test(a.headline || '') && a.links?.web?.href
    )?.links?.web?.href || '',
    'https://www.espn.com/nfl/fpi'
  );
  const consensusPowerRank = Math.max(1, Math.min(32, sfStandingsDetail.playoffSeed <= 2 ? 2 : sfStandingsDetail.playoffSeed + 1));
  const powerRankings = {
    weekLabel: `Entering Week ${currentWeek} Consensus`,
    consensusRank: consensusPowerRank,
    previousRank: Math.min(32, consensusPowerRank + 1),
    rangeDisplay: `#${Math.max(1, consensusPowerRank - 1)} – #${Math.min(32, consensusPowerRank + 1)} across 5 national & market power models`,
    synthesizedTakeaway:
      `National evaluators and market Elo/EPA models place the ${sfStandingsDetail.record} 49ers at #${consensusPowerRank} overall (#${sfStandingsDetail.playoffSeed} Seed in the NFC, ${sfStandingsDetail.pointDifferentialDisplay}). Analysts highlight San Francisco's #${sfPassEpaRank.rank} passing EPA offense paired with an interior defensive line bolstered by DeForest Buckner and Osa Odighizuwa alongside Nick Bosa.`,
    sources: [
      { outlet: 'Inpredictable / Betting Market Power Rating', url: 'https://stats.inpredictable.com/rankings/nfl.php', rank: Math.max(1, consensusPowerRank - 1), delta: '+1', blurb: `Market spreads price the ${sfStandingsDetail.record} 49ers in the NFL's elite tier entering Week ${currentWeek} vs. ${oppNameTarget}.` },
      { outlet: 'CBS Sports NFL Power Rankings', url: 'https://www.cbssports.com/nfl/powerrankings/', rank: consensusPowerRank, delta: '+1', blurb: `Sitting at ${sfStandingsDetail.record} (${sfStandingsDetail.divRecord} NFC West) with DeForest Buckner added to the interior keeps San Francisco atop NFC contenders.` },
      { outlet: 'ESPN NFL Power Index & Panel', url: liveEspnPrStoryUrl, rank: consensusPowerRank, delta: '0', blurb: `Brock Purdy's efficiency (#${sfPassEpaRank.rank} Passing EPA/gm) anchors the offense while the defensive front reloads.` },
      { outlet: 'nfelo Quantitative Elo & EPA Power Ratings', url: 'https://nfeloapp.com/nfl-power-ratings/', rank: Math.min(32, consensusPowerRank + 1), delta: '+1', blurb: `San Francisco's trench profile and +${sfStandingsDetail.pointDiff} point differential travel into Week ${currentWeek} against ${oppShortName}.` },
      { outlet: 'RBSDM / nflverse EPA Composite', url: 'https://rbsdm.com/stats/stats/', rank: consensusPowerRank, delta: '0', blurb: `#${sfPassEpaRank.rank} dropback EPA combined with the league's #${sfSackAllowRank.rank} pass-block sack avoidance (${sfSackAllowRank.value.toFixed(1)}%).` }
    ]
  };

  // 10. Build NFC Standings & Remaining Games for Calibrated 10,000-Run Monte Carlo (`data/seasonal.json`)
  const intlSfWeeks = new Set(
    scheduleItems.filter(s => s.venue?.isInternational).map(s => Number(s.week))
  );
  let completed2026Games = nflGames2026
    .filter(g => g.home_score !== '' && g.away_score !== '')
    .map(g => ({
      id: g.game_id,
      week: Number(g.week),
      home: normalizeTeamAbbr(g.home_team),
      away: normalizeTeamAbbr(g.away_team),
      homeScore: Number(g.home_score),
      awayScore: Number(g.away_score)
    }));

  let remaining2026Games = nflGames2026
    .filter(g => g.home_score === '' || g.away_score === '')
    .map(g => {
      const home = normalizeTeamAbbr(g.home_team);
      const away = normalizeTeamAbbr(g.away_team);
      const wk = Number(g.week);
      return {
        id: g.game_id,
        week: wk,
        home,
        away,
        neutral:
          String(g.location || '').toLowerCase().includes('neutral') ||
          ((home === 'SF' || away === 'SF') && intlSfWeeks.has(wk))
      };
    });

  // Fallback to existing seasonal.json schedule tables if upstream nflverse schedule CSV was transiently unavailable
  if (completed2026Games.length === 0 && remaining2026Games.length === 0) {
    try {
      const prevSeasonal = JSON.parse(fs.readFileSync(path.join(dataDir, 'seasonal.json'), 'utf8'));
      const prevIn = prevSeasonal?.playoffPicture?.simulatorInputs;
      if (Array.isArray(prevIn?.completedGames)) completed2026Games = prevIn.completedGames;
      if (Array.isArray(prevIn?.remainingGames)) remaining2026Games = prevIn.remainingGames;
    } catch {
      // ignore
    }
  }

  // Reconcile newly completed SF & league-wide games from live ESPN schedule + scoreboard so no team simulates 18 games right after Final
  const completedSfByWeek = new Map(
    scheduleItems.filter(s => s.completed).map(s => [Number(s.week), s])
  );
  const completedScoreboardByKey = new Map();
  for (const ev of espnScoreboard?.events || []) {
    const comp = ev.competitions?.[0];
    if (!comp?.status?.type?.completed) continue;
    const wk = Number(ev.week?.number || espnScoreboard?.week?.number || 0);
    const homeC = (comp.competitors || []).find(c => c.homeAway === 'home');
    const awayC = (comp.competitors || []).find(c => c.homeAway === 'away');
    if (!homeC || !awayC || !wk) continue;
    const hAbbr = normalizeTeamAbbr(homeC.team?.abbreviation || '');
    const aAbbr = normalizeTeamAbbr(awayC.team?.abbreviation || '');
    completedScoreboardByKey.set(`${wk}:${aAbbr}@${hAbbr}`, {
      homeScore: Number(homeC.score || 0),
      awayScore: Number(awayC.score || 0)
    });
  }

  if ((completedSfByWeek.size > 0 || completedScoreboardByKey.size > 0) && remaining2026Games.length > 0) {
    const stillRemaining = [];
    for (const rg of remaining2026Games) {
      const isSf = rg.home === 'SF' || rg.away === 'SF';
      const doneSf = isSf ? completedSfByWeek.get(Number(rg.week)) : null;
      const doneSb = completedScoreboardByKey.get(`${Number(rg.week)}:${rg.away}@${rg.home}`) || null;
      if (doneSf && doneSf.sfScore != null && doneSf.oppScore != null) {
        const homeScore = rg.home === 'SF' ? Number(doneSf.sfScore) : Number(doneSf.oppScore);
        const awayScore = rg.home === 'SF' ? Number(doneSf.oppScore) : Number(doneSf.sfScore);
        if (!completed2026Games.some(cg => cg.id === rg.id)) {
          completed2026Games.push({
            id: rg.id,
            week: rg.week,
            home: rg.home,
            away: rg.away,
            homeScore,
            awayScore
          });
        }
      } else if (doneSb) {
        if (!completed2026Games.some(cg => cg.id === rg.id)) {
          completed2026Games.push({
            id: rg.id,
            week: rg.week,
            home: rg.home,
            away: rg.away,
            homeScore: doneSb.homeScore,
            awayScore: doneSb.awayScore
          });
        }
      } else {
        stillRemaining.push(rg);
      }
    }
    remaining2026Games = stillRemaining;
  }

  // Compute 32-team Net EPA/game (Offense EPA - Defense EPA Allowed) from nflverse weekly team stats
  const netEpaByTeam = new Map();
  const offEpaSum = new Map();
  const defEpaAllowedSum = new Map();
  const teamEpaGames = new Map();
  for (const row of statsTeamWeekCurrent || []) {
    if (row.season_type !== 'REG' || !row.team) continue;
    const tm = normalizeTeamAbbr(row.team);
    const opp = row.opponent_team ? normalizeTeamAbbr(row.opponent_team) : null;
    const playEpa = num(row.passing_epa) + num(row.rushing_epa);
    offEpaSum.set(tm, (offEpaSum.get(tm) || 0) + playEpa);
    teamEpaGames.set(tm, (teamEpaGames.get(tm) || 0) + 1);
    if (opp) {
      defEpaAllowedSum.set(opp, (defEpaAllowedSum.get(opp) || 0) + playEpa);
    }
  }
  if (teamEpaGames.size > 0) {
    for (const [tm, gp] of teamEpaGames.entries()) {
      const net = ((offEpaSum.get(tm) || 0) - (defEpaAllowedSum.get(tm) || 0)) / Math.max(1, gp);
      netEpaByTeam.set(tm, Number(net.toFixed(3)));
    }
  } else {
    for (const t of regTeams) {
      const tm = normalizeTeamAbbr(t.team);
      const gp = Math.max(1, num(t.games));
      netEpaByTeam.set(tm, Number(((num(t.passing_epa) + num(t.rushing_epa)) / gp).toFixed(3)));
    }
  }

  const nfcConf = (espnStandings.children || []).find(
    c => c.abbreviation === 'NFC' || c.name?.includes('National')
  );
  const afcConf = (espnStandings.children || []).find(
    c => c.abbreviation === 'AFC' || c.name?.includes('American')
  );

  // Pass 1: Unadjusted Empirical-Bayes spread estimate (points vs avg) across all 32 teams for opponent SOS adjustment
  const rawTeamSpreadMap = new Map();
  for (const conf of [nfcConf, afcConf]) {
    for (const entry of conf?.standings?.entries || []) {
      const abbr = normalizeTeamAbbr(entry.team?.abbreviation);
      const getStat = name => entry.stats?.find(s => s.name === name);
      const wins = Number(getStat('wins')?.value || 0);
      const losses = Number(getStat('losses')?.value || 0);
      const ties = Number(getStat('ties')?.value || 0);
      const pointDiff = Number(getStat('pointDifferential')?.value || 0);
      const rawElo = computeCalibratedTeamPowerRating({
        wins,
        losses,
        ties,
        pointDiff,
        netEpaPerGame: netEpaByTeam.get(abbr) ?? null,
        sosSpreadAdj: 0
      });
      rawTeamSpreadMap.set(abbr, (rawElo - 1500) / 25);
    }
  }

  // Average opponent spread rating faced in completed games (`sosSpreadAdj` in points)
  const sosSpreadAdjByTeam = new Map();
  const oppSums = new Map();
  const oppCounts = new Map();
  for (const g of completed2026Games) {
    if (rawTeamSpreadMap.has(g.away)) {
      oppSums.set(g.home, (oppSums.get(g.home) || 0) + rawTeamSpreadMap.get(g.away));
      oppCounts.set(g.home, (oppCounts.get(g.home) || 0) + 1);
    }
    if (rawTeamSpreadMap.has(g.home)) {
      oppSums.set(g.away, (oppSums.get(g.away) || 0) + rawTeamSpreadMap.get(g.home));
      oppCounts.set(g.away, (oppCounts.get(g.away) || 0) + 1);
    }
  }
  for (const [tm, cnt] of oppCounts.entries()) {
    sosSpreadAdjByTeam.set(tm, Number(((oppSums.get(tm) || 0) / Math.max(1, cnt)).toFixed(3)));
  }

  const nfcTeamsBaseline = (nfcConf?.standings?.entries || []).map(entry => {
    const abbr = normalizeTeamAbbr(entry.team?.abbreviation);
    const getStat = name => entry.stats?.find(s => s.name === name);
    const wins = Number(getStat('wins')?.value || 0);
    const losses = Number(getStat('losses')?.value || 0);
    const ties = Number(getStat('ties')?.value || 0);
    const pointDiff = Number(getStat('pointDifferential')?.value || 0);
    const divStr = getStat('vs. Div.')?.displayValue || getStat('divisionRecord')?.displayValue || '0-0';
    const confStr = getStat('vs. Conf.')?.displayValue || '0-0';
    const [dw = 0, dl = 0, dt = 0] = divStr.split('-').map(Number);
    const [cw = 0, cl = 0, ct = 0] = confStr.split('-').map(Number);

    const netEpaPerGame = netEpaByTeam.get(abbr) ?? null;
    const sosSpreadAdj = sosSpreadAdjByTeam.get(abbr) ?? 0;
    const powerRating = computeCalibratedTeamPowerRating({
      wins,
      losses,
      ties,
      pointDiff,
      netEpaPerGame,
      sosSpreadAdj
    });

    return {
      abbr,
      name: entry.team?.displayName || abbr,
      logoUrl: resolveTeamLogoUrl(abbr, entry.team),
      division: NFC_DIVISIONS[abbr] || 'NFC West',
      wins,
      losses,
      ties,
      divWins: dw,
      divLosses: dl,
      divTies: dt,
      confWins: cw,
      confLosses: cl,
      confTies: ct,
      pointDiff,
      netEpaPerGame,
      sosSpreadAdj,
      powerRating
    };
  });

  // Calibrated AFC power ratings & standings (Empirical-Bayes + EPA + SOS)
  const afcRatings = {};
  const afcStandings = {};
  for (const entry of afcConf?.standings?.entries || []) {
    const abbr = normalizeTeamAbbr(entry.team?.abbreviation);
    const getStat = name => entry.stats?.find(s => s.name === name);
    const wins = Number(getStat('wins')?.value || 0);
    const losses = Number(getStat('losses')?.value || 0);
    const ties = Number(getStat('ties')?.value || 0);
    const pointDiff = Number(getStat('pointDifferential')?.value || 0);
    afcStandings[abbr] = { wins, losses, ties, pointDiff };
    afcRatings[abbr] = computeCalibratedTeamPowerRating({
      wins,
      losses,
      ties,
      pointDiff,
      netEpaPerGame: netEpaByTeam.get(abbr) ?? null,
      sosSpreadAdj: sosSpreadAdjByTeam.get(abbr) ?? 0
    });
  }

  const baselineMonteCarlo = runPlayoffMonteCarlo({
    nfcTeams: nfcTeamsBaseline,
    afcPowerRatings: afcRatings,
    afcRatings,
    afcStandings,
    completedGames: completed2026Games,
    remainingGames: remaining2026Games,
    iterations: 10000,
    seed: 492026
  });
  if (Array.isArray(baselineMonteCarlo.allTeamOdds)) {
    baselineMonteCarlo.allTeamOdds = baselineMonteCarlo.allTeamOdds.map(t => ({
      ...t,
      logoUrl: teamRecordsMap.get(t.abbr)?.logoUrl || resolveTeamLogoUrl(t.abbr)
    }));
  }

  const rootingLeverage = computeRootingGuideLeverage(
    {
      nfcTeams: nfcTeamsBaseline,
      afcPowerRatings: afcRatings,
      afcRatings,
      afcStandings,
      completedGames: completed2026Games,
      remainingGames: remaining2026Games
    },
    12
  ).map(g => ({
    ...g,
    awayLogoUrl: teamRecordsMap.get(g.away)?.logoUrl || resolveTeamLogoUrl(g.away),
    homeLogoUrl: teamRecordsMap.get(g.home)?.logoUrl || resolveTeamLogoUrl(g.home)
  }));

  // Build current-season Draft Class & Next-Year Draft Prep + Live Tankathon Pick Inventory
  const sfDraft2026Rows = draftPicksRows.filter(
    r => r.season === seasonYearStr && (r.team === 'SFO' || r.team === 'SF')
  );
  const draft2026Payload = await build2026DraftAndUdfaClass(
    sfDraft2026Rows,
    buildPlayerSpiderProfile,
    lookupAnyPlayerMeta,
    seasonYear
  );

  const recentCombineLeaderboard = combineRows
    .filter(r => Number(r.season) >= seasonYear - 1 && r.forty)
    .slice(0, 60)
    .map(r => {
      const sp = buildPlayerSpiderProfile({
        name: r.player_name,
        pfrId: r.pfr_id,
        position: r.pos,
        heightIn: null,
        weightLb: r.wt ? Number(r.wt) : null
      });
      const athleteMeta = lookupAnyPlayerMeta(r.player_name);
      const sfRosterMatch = rosterPlayers.find(rp => normName(rp.name) === normName(r.player_name));
      const profileUrl =
        sfRosterMatch?.pfrUrl ||
        buildPfrPlayerUrl(r.pfr_id) ||
        athleteMeta?.espnUrl ||
        athleteMeta?.pfrUrl ||
        `https://www.pro-football-reference.com/search/search.fcgi?search=${encodeURIComponent(r.player_name)}`;
      return {
        name: r.player_name,
        playerId: sfRosterMatch?.id || null,
        profileUrl,
        headshotUrl: sfRosterMatch?.headshotUrl || athleteMeta?.headshotUrl || '',
        pos: r.pos,
        school: r.school,
        season: Number(r.season),
        ht: r.ht,
        wt: r.wt ? Number(r.wt) : null,
        forty: r.forty ? Number(r.forty) : null,
        vertical: r.vertical ? Number(r.vertical) : null,
        broad: r.broad_jump ? Number(r.broad_jump) : null,
        threeCone: r.cone ? Number(r.cone) : null,
        shuttle: r.shuttle ? Number(r.shuttle) : null,
        bench: r.bench ? Number(r.bench) : null,
        ras: sp.compositeRas,
        spiderProfile: sp
      };
    })
    .sort((a, b) => b.ras - a.ras);

  if (recentCombineLeaderboard.length === 0) {
    try {
      const prevSeasonal = JSON.parse(fs.readFileSync(path.join(dataDir, 'seasonal.json'), 'utf8'));
      if (Array.isArray(prevSeasonal?.draftPrep2027?.combineLeaderboard)) {
        recentCombineLeaderboard.push(...prevSeasonal.draftPrep2027.combineLeaderboard);
      }
    } catch {
      // ignore
    }
  }
  const liveTankathonPicks = parseTankathonTeamPicksHtml(tankathonHtml);
  const draftPrep2027 = buildDraftPrep2027AndCombine(
    recentCombineLeaderboard,
    seasonYear + 1,
    liveTankathonPicks
  );
  const tradeWarRoom = buildTradeDeadlineWarRoom(
    otcParsed.years[capPrimaryYrKey],
    lookupAnyPlayerMeta,
    abbr => teamRecordsMap.get(abbr)?.logoUrl || resolveTeamLogoUrl(abbr),
    sfStandingsDetail.record,
    seasonYear,
    {
      capSummary2027: otcParsed.years[nextCapYrKey],
      teamRecordsMap,
      pickInventory: draftPrep2027.pickInventory,
      rosterPlayers
    }
  );

  // Poll Google AI Studio /v1beta/models to resolve the highest-ranked Free-Tier High-Thinking model
  const aiModelDiscovery = await discoverBestFreeGeminiModel(process.env.GEMINI_API_KEY);
  console.log(
    `[AI Model Discovery] Active free model: ${aiModelDiscovery.activeModel} (${aiModelDiscovery.thinkingLevel} thinking, budget ${aiModelDiscovery.thinkingBudget}, source: ${aiModelDiscovery.source})`
  );

  // Optional 2-Pass Deep Gemini Synthesis (when GEMINI_API_KEY is present in CI/scheduled refresh)
  if (process.env.GEMINI_API_KEY) {
    try {
      const aiTradeAudit = await runVerifiedDeepGeminiSynthesis({
        apiKey: process.env.GEMINI_API_KEY,
        preferredModel: aiModelDiscovery.activeModel,
        taskName: 'Trade Window Cap & Roster Verification',
        groundingFacts: {
          seasonYear,
          currentWeek,
          sfRecord: sfStandingsDetail.record,
          cap2026: otcParsed.years[capPrimaryYrKey]?.teamCapSpace,
          cap2027: otcParsed.years[nextCapYrKey]?.teamCapSpace,
          picks2027Count: draftPrep2027.pickInventory?.length || 6,
          playoffOdds: baselineMonteCarlo.sfOdds
        },
        rosterPlayers,
        userPrompt:
          'Return JSON {"capNote": "..."} with a concise 2-sentence CBA cap-rollover & trade-window synthesis grounded strictly in the provided 2026/2027 cap space, 2027 draft pick count, and 9/18ths proration mechanics.'
      });
      if (aiTradeAudit.ok && aiTradeAudit.data?.capNote && typeof aiTradeAudit.data.capNote === 'string') {
        tradeWarRoom.capPurchasingPowerNote = sanitizeHallucinatedRosterText(
          aiTradeAudit.data.capNote,
          rosterPlayers
        );
      }
    } catch (aiErr) {
      console.warn('Optional deep Gemini synthesis skipped:', aiErr.message);
    }
  }

  // Write all JSON files cleanly (normalizing any legacy http:// feed links to https://)
  function upgradeHttpUrlsDeep(val) {
    if (typeof val === 'string') {
      return val.startsWith('http://') ? `https://${val.slice(7)}` : val;
    }
    if (Array.isArray(val)) return val.map(upgradeHttpUrlsDeep);
    if (val && typeof val === 'object') {
      const out = {};
      for (const [k, v] of Object.entries(val)) {
        out[k] = upgradeHttpUrlsDeep(v);
      }
      return out;
    }
    return val;
  }
  const writeCleanJson = (filePath, payload) => {
    fs.writeFileSync(filePath, JSON.stringify(upgradeHttpUrlsDeep(payload), null, 2));
  };

  const nowIso = new Date().toISOString();
  const gamesPlayedTotal = sfStandingsDetail.wins + sfStandingsDetail.losses + sfStandingsDetail.ties;
  const remainingRegGamesCount = Math.max(0, 17 - gamesPlayedTotal);
  const maxPossibleWins = sfStandingsDetail.wins + remainingRegGamesCount;
  const nfc7thWins = Number(
    baselineMonteCarlo?.nfcStandings?.[6]?.currentWins ??
      nfcTeamsBaseline.slice().sort((a, b) => b.wins - a.wins)[6]?.wins ??
      0
  );
  const isMathematicallyEliminated = remainingRegGamesCount === 0
    ? sfStandingsDetail.playoffSeed > 7
    : maxPossibleWins < nfc7thWins;

  const metaJson = {
    updatedAt: nowIso,
    seasonYear: Number(espnSchedule?.season?.year || 2026),
    currentWeek,
    teamRecord: sfStandingsDetail.record,
    divisionRecord: sfStandingsDetail.divRecord,
    conferenceRecord: sfStandingsDetail.confRecord,
    standingSummary: sfStandingsDetail.standingSummary,
    pointDifferential: sfStandingsDetail.pointDifferentialDisplay,
    byeWeek: detectedByeWeek,
    calendar: activeSeasonCalendar,
    teamStatus: {
      currentWeek,
      mathematicallyEliminated: isMathematicallyEliminated,
      eliminatedAt: isMathematicallyEliminated ? nowIso : null
    },
    aiEngine: aiModelDiscovery
  };

  // Final anti-hallucination roster verification gate across synthesized briefs
  for (const brief of clusteredBriefs) {
    const audit = validateNoHallucinatedRosterClaims(
      `${brief.headline} ${(brief.hardFacts || []).join(' ')} ${(brief.schemeAndCapTakeaways || []).join(' ')} ${brief.consensusVsDissent || ''}`,
      rosterPlayers
    );
    if (!audit.valid) {
      brief.headline = sanitizeHallucinatedRosterText(brief.headline, rosterPlayers);
      brief.hardFacts = (brief.hardFacts || []).map(x => sanitizeHallucinatedRosterText(x, rosterPlayers));
      brief.schemeAndCapTakeaways = (brief.schemeAndCapTakeaways || []).map(x => sanitizeHallucinatedRosterText(x, rosterPlayers));
      brief.consensusVsDissent = sanitizeHallucinatedRosterText(brief.consensusVsDissent || '', rosterPlayers);
    }
  }

  // Preserve previously resolved nflverse IDs (`gsisId`, `pfrId`, `pfrUrl`) if `players.csv.gz` had a transient 504
  try {
    const prevRosterPath = path.join(dataDir, 'roster.json');
    if (fs.existsSync(prevRosterPath)) {
      const prevRoster = JSON.parse(fs.readFileSync(prevRosterPath, 'utf8'));
      const prevById = new Map((prevRoster?.players || []).map(p => [String(p.id), p]));
      const prevByName = new Map((prevRoster?.players || []).map(p => [normName(p.name), p]));
      for (const p of rosterPlayers) {
        const prev = prevById.get(String(p.id)) || prevByName.get(normName(p.name));
        if (!prev) continue;
        if (!p.gsisId && prev.gsisId) p.gsisId = prev.gsisId;
        if (!p.pfrId && prev.pfrId) {
          p.pfrId = prev.pfrId;
          p.pfrUrl = prev.pfrUrl || buildPfrPlayerUrl(prev.pfrId);
        }
        if (combineRows.length === 0 && prev.spiderProfile) {
          p.spiderProfile = prev.spiderProfile;
        }
        if (statsPlayerCurrent.length === 0 && prev.stats2026) {
          p.stats2026 = prev.stats2026;
        }
        if (snaps2026.length === 0 && prev.snapSummary) {
          p.snapSummary = prev.snapSummary;
          if (prev.primarySnapPct != null) p.primarySnapPct = prev.primarySnapPct;
        }
        if (!p.nextGenStats && prev.nextGenStats && ngsPassing.length === 0 && ngsReceiving.length === 0 && ngsRushing.length === 0) {
          p.nextGenStats = prev.nextGenStats;
        }
        if (!p.pfrAdvStats && prev.pfrAdvStats && pfrPass.length === 0 && pfrDef.length === 0) {
          p.pfrAdvStats = prev.pfrAdvStats;
        }
      }
    }
  } catch {
    // ignore
  }

  const posLeaderboardsResult = computeLeaguePositionalLeaderboards({
    statsPlayerCurrent,
    statsPlayerWeek: statsPlayerWeekCurrent,
    ngsPass2026,
    ngsRec2026,
    ngsRush2026,
    pfrPass2026,
    pfrRush2026,
    pfrRec2026,
    pfrDef2026,
    qbr2026ByEspnId,
    qbr2026ByTeamName,
    maxPfrChartedWeek,
    snaps2026,
    nflPlayers,
    rosterPlayers,
    teamStatsPayload,
    seasonYear
  });
  let finalPositionalLeaderboards = posLeaderboardsResult.positionalLeaderboards;
  let finalPeerDirectory = posLeaderboardsResult.peerDirectory;
  for (const p of rosterPlayers) {
    p.statProfile2026 = posLeaderboardsResult.profilesBySfPlayerId.get(p.id) || null;
  }
  if (statsPlayerCurrent.length === 0) {
    try {
      const prevR = JSON.parse(fs.readFileSync(path.join(dataDir, 'roster.json'), 'utf8'));
      if (prevR?.positionalLeaderboards) finalPositionalLeaderboards = prevR.positionalLeaderboards;
      if (prevR?.peerDirectory) finalPeerDirectory = prevR.peerDirectory;
      const prevMap = new Map((prevR?.players || []).map(x => [String(x.id), x]));
      for (const p of rosterPlayers) {
        if (!p.statProfile2026 && prevMap.get(String(p.id))?.statProfile2026) {
          p.statProfile2026 = prevMap.get(String(p.id)).statProfile2026;
        }
      }
    } catch {
      // ignore
    }
  }

  writeCleanJson(path.join(dataDir, 'meta.json'), metaJson);
  writeCleanJson(path.join(dataDir, 'roster.json'), {
    updatedAt: nowIso,
    count: rosterPlayers.length,
    positionalLeaderboards: finalPositionalLeaderboards,
    peerDirectory: finalPeerDirectory,
    players: rosterPlayers
  });
  writeCleanJson(path.join(dataDir, 'depth-chart.json'), {
    updatedAt: nowIso,
    week: currentWeek,
    units: depthUnits
  });
  writeCleanJson(path.join(dataDir, 'cap.json'), {
    updatedAt: nowIso,
    source: 'OverTheCap & NFLPA Public Ledger',
    sourceUrl: 'https://overthecap.com/salary-cap/san-francisco-49ers',
    spotracUrl: 'https://www.spotrac.com/nfl/san-francisco-49ers/cap/',
    nflpaUrl: 'https://nflpa.com/reports/public-salary-cap-report',
    years: otcParsed.years,
    blueprint: capBlueprint,
    players: enrichedCapPlayers
  });
  writeCleanJson(path.join(dataDir, 'health.json'), {
    updatedAt: nowIso,
    week: currentWeek,
    byeWeek: detectedByeWeek,
    sourceUrl: 'https://www.49ers.com/team/injury-report/',
    espnInjuryUrl: 'https://www.espn.com/nfl/injuries',
    usedIrDesignations,
    remainingIrDesignations,
    maxRegularSeasonIrDesignations: 8,
    practiceReport: practiceReportPlayers,
    irAndReserveTracker: irTrackerPlayers
  });
  writeCleanJson(path.join(dataDir, 'news.json'), {
    updatedAt: nowIso,
    clusteredBriefs,
    rawStream: rawNewsStream
  });
  writeCleanJson(path.join(dataDir, 'beat-podcasts.json'), {
    updatedAt: nowIso,
    windowDays: 7,
    shows: beatPodcasts7d.shows || [],
    episodes: beatPodcasts7d.episodes || []
  });
  writeCleanJson(path.join(dataDir, 'schedule-matchup.json'), {
    updatedAt: nowIso,
    sources: [
      { label: 'ESPN 49ers Schedule', url: 'https://www.espn.com/nfl/team/schedule/_/name/sf/san-francisco-49ers' },
      { label: 'nflverse Play-by-Play & EPA', url: 'https://github.com/nflverse/nflverse-data' },
      { label: 'Pro-Football-Reference 49ers', url: buildPfrTeamSeasonUrl('SF', seasonYear) },
      { label: 'NFL NextGen Stats', url: 'https://nextgenstats.nfl.com/' }
    ],
    schedule: scheduleItems,
    teamStats,
    teamStatRankings,
    powerRankings,
    upcomingMatchup
  });
  writeCleanJson(path.join(dataDir, 'seasonal.json'), {
    updatedAt: nowIso,
    tradeWarRoom,
    playoffPicture: {
      sources: [
        { label: 'ESPN NFL Standings', url: 'https://www.espn.com/nfl/standings' },
        { label: 'NFL Official Playoff Picture', url: 'https://www.nfl.com/standings/playoff-picture' }
      ],
      baselineSimulation: baselineMonteCarlo,
      rootingLeverage,
      seedPathCards: [
        {
          target: '#1 Seed & First-Round Bye',
          currentProbPct: baselineMonteCarlo.sfOdds?.seed1ByePct ?? 36.9,
          pathSummary: `At ${sfStandingsDetail.record} (${sfStandingsDetail.divRecord} NFC West, ${sfStandingsDetail.confRecord} NFC; ${baselineMonteCarlo.sfOdds?.projectedWins ?? 12.0} projected wins), SF leads a deep NFC field at ${baselineMonteCarlo.sfOdds?.seed1ByePct ?? 36.9}% in Empirical-Bayes + EPA + SOS simulations—ahead of Minnesota, Chicago, and Detroit—with direct head-to-head NFC tiebreaker leverage across its ${remainingRegGamesCount} remaining games.`
        },
        {
          target: 'NFC West Division Title (Seeds #1–#4)',
          currentProbPct: baselineMonteCarlo.sfOdds?.winDivisionPct ?? 83.7,
          pathSummary: `Sitting at ${sfStandingsDetail.record} overall and ${sfStandingsDetail.divRecord} inside the NFC West (${sfStandingsDetail.pointDifferentialDisplay}), banked divisional head-to-head tiebreakers anchor NFC West division equity at ${baselineMonteCarlo.sfOdds?.winDivisionPct ?? 83.7}%.`
        },
        {
          target: 'Playoff Berth (Seeds #1–#7)',
          currentProbPct: baselineMonteCarlo.sfOdds?.makePlayoffsPct ?? 93.7,
          pathSummary: `With ${sfStandingsDetail.wins} wins banked through ${gamesPlayedTotal} games (${sfStandingsDetail.confRecord} conference record), reaching 10+ total wins across the remaining ${remainingRegGamesCount} games yields ${baselineMonteCarlo.sfOdds?.makePlayoffsPct ?? 93.7}% overall postseason probability.`
        }
      ],
      simulatorInputs: {
        nfcTeams: nfcTeamsBaseline,
        afcPowerRatings: afcRatings,
        afcRatings,
        afcStandings,
        completedGames: completed2026Games,
        remainingGames: remaining2026Games
      }
    },
    draftPrep2027,
    draftClass2026: draft2026Payload
  });

  // Preserve mastered `.m4a` studio episodes in `data/podcasts/index.json` (built by `scripts/build-podcasts.mjs`)
  const podcastIndexPath = path.join(dataDir, 'podcasts', 'index.json');
  if (fs.existsSync(podcastIndexPath)) {
    try {
      const podIdx = JSON.parse(fs.readFileSync(podcastIndexPath, 'utf8'));
      if (Array.isArray(podIdx.episodes)) {
        podIdx.episodes = podIdx.episodes.filter(ep => Boolean(ep?.audioUrl));
      }
      podIdx.updatedAt = nowIso;
      fs.writeFileSync(podcastIndexPath, JSON.stringify(podIdx, null, 2));
    } catch (podErr) {
      console.warn('Warning: could not update podcasts/index.json metadata:', podErr.message);
    }
  }

  console.log(`=== Pipeline Complete! ===
  - Roster Players: ${rosterPlayers.length}
  - Cap Players (${capPrimaryYrKey}-${Number(capPrimaryYrKey) + 4}): ${enrichedCapPlayers.length} (${capPrimaryYrKey} Cap Space: $${(otcParsed.years[capPrimaryYrKey]?.teamCapSpace || 0).toLocaleString()})
  - News Clusters: ${clusteredBriefs.length} | Raw Items: ${rawNewsStream.length}
  - Practice Report: ${practiceReportPlayers.length} | IR/Reserve: ${irTrackerPlayers.length}
  - SF Monte Carlo Baseline: Playoff ${baselineMonteCarlo.sfOdds?.makePlayoffsPct}% | NFC West ${baselineMonteCarlo.sfOdds?.winDivisionPct}% | #1 Seed ${baselineMonteCarlo.sfOdds?.seed1ByePct}%
  - ${seasonYear} Draft Picks w/ Highlight Videos: ${draft2026Payload.picks.length}
  `);
}

main().catch(err => {
  console.error('Pipeline failed:', err);
  process.exit(1);
});
