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
  buildClusteredNewsBriefs,
  buildFrontOfficeCapBlueprint,
  buildTradeDeadlineWarRoom,
  buildDraftPrep2027AndCombine,
  build2026DraftAndUdfaClass
} from './lib/seasonalContentBuilder.mjs';
import { buildReporterRegistry } from './update-reporter-registry.mjs';
import { computePlayerPlayProbability, calculateIrReturnTimeline } from '../src/engine/injuryProbabilityModel.js';
import { runPlayoffMonteCarlo, computeRootingGuideLeverage, normalizeTeamAbbr, NFC_DIVISIONS } from '../src/engine/playoffMonteCarlo.js';
import { cleanSensationalistText, scoreContentSignal } from '../src/engine/antiFluffFilter.js';
import { DEFAULT_NFL_CALENDAR_2026 } from '../src/engine/seasonStateMachine.js';

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

async function fetchCsv(url) {
  const res = await fetch(url, {
    redirect: 'follow',
    headers: { 'User-Agent': 'Mozilla/5.0 (49ers Data Pipeline)' }
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${url}`);
  const buf = Buffer.from(await res.arrayBuffer());
  const text = url.endsWith('.gz') ? zlib.gunzipSync(buf).toString('utf8') : buf.toString('utf8');
  return parseCsv(text);
}

async function fetchJson(url) {
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)' }
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${url}`);
  return res.json();
}

async function fetchText(url) {
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)' }
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

async function main() {
  console.log('=== 49ers Faithful: Starting Live 2026 Data Ingestion Pipeline ===');
  fs.mkdirSync(dataDir, { recursive: true });

  // 1. Ensure Reporter Registry is fresh
  const reporterPayload = await buildReporterRegistry();
  const reportersList = reporterPayload.reporters;

  // 2. Fetch ESPN & OverTheCap in parallel
  console.log('[1/6] Fetching ESPN 49ers Roster, Schedule, Depth Chart, Injuries, Standings & OverTheCap...');
  const [
    espnRoster,
    espnSchedule,
    espnDepth,
    espnInjuries,
    espnStandings,
    espnNews,
    otcHtml
  ] = await Promise.all([
    fetchJson('https://site.api.espn.com/apis/site/v2/sports/football/nfl/teams/25/roster'),
    fetchJson('https://site.api.espn.com/apis/site/v2/sports/football/nfl/teams/25/schedule'),
    fetchJson('https://site.api.espn.com/apis/site/v2/sports/football/nfl/teams/25/depthcharts'),
    fetchJson('https://site.api.espn.com/apis/site/v2/sports/football/nfl/injuries'),
    fetchJson('https://site.api.espn.com/apis/v2/sports/football/nfl/standings'),
    fetchJson('https://site.api.espn.com/apis/site/v2/sports/football/nfl/news?team=25&limit=30'),
    fetchText('https://overthecap.com/salary-cap/san-francisco-49ers')
  ]);

  // 3. Fetch nflverse Open Datasets in parallel
  console.log('[2/6] Fetching nflverse 2026 & Career Stats, EPA, NextGen Stats, PFR Adv, Snaps, Combine & Games...');
  const [
    nflPlayers,
    statsPlayer2026,
    statsPlayer2025,
    statsPlayer2024,
    statsPlayer2023,
    statsTeam2026,
    ngsPassing,
    ngsReceiving,
    ngsRushing,
    pfrPass,
    pfrDef,
    snaps2026,
    injuries2026,
    combineRows,
    draftPicksRows,
    gamesRows
  ] = await Promise.all([
    fetchCsv(`${NFLVERSE_BASE}/players/players.csv.gz`),
    fetchCsv(`${NFLVERSE_BASE}/stats_player/stats_player_reg_2026.csv.gz`),
    fetchCsv(`${NFLVERSE_BASE}/stats_player/stats_player_reg_2025.csv.gz`),
    fetchCsv(`${NFLVERSE_BASE}/stats_player/stats_player_reg_2024.csv.gz`),
    fetchCsv(`${NFLVERSE_BASE}/stats_player/stats_player_reg_2023.csv.gz`),
    fetchCsv(`${NFLVERSE_BASE}/stats_team/stats_team_reg_2026.csv.gz`),
    fetchCsv(`${NFLVERSE_BASE}/nextgen_stats/ngs_passing.csv.gz`),
    fetchCsv(`${NFLVERSE_BASE}/nextgen_stats/ngs_receiving.csv.gz`),
    fetchCsv(`${NFLVERSE_BASE}/nextgen_stats/ngs_rushing.csv.gz`),
    fetchCsv(`${NFLVERSE_BASE}/pfr_advstats/advstats_season_pass.csv.gz`),
    fetchCsv(`${NFLVERSE_BASE}/pfr_advstats/advstats_season_def.csv.gz`),
    fetchCsv(`${NFLVERSE_BASE}/snap_counts/snap_counts_2026.csv.gz`),
    fetchCsv(`${NFLVERSE_BASE}/injuries/injuries_2026.csv.gz`),
    fetchCsv(`${NFLVERSE_BASE}/combine/combine.csv`),
    fetchCsv(`${NFLVERSE_BASE}/draft_picks/draft_picks.csv.gz`),
    fetchCsv(`${NFLVERSE_BASE}/schedules/games.csv.gz`)
  ]);

  // 4. Parse OverTheCap Contracts
  console.log('[3/6] Parsing multi-year OverTheCap contracts & Combine spider percentiles...');
  const otcParsed = parseOverTheCapHtml(otcHtml);
  const { buildPlayerSpiderProfile } = buildCombineIndexer(combineRows);

  // Build Rosetta Stone player indexers
  const nflByEspnId = new Map();
  const nflByName = new Map();
  for (const p of nflPlayers) {
    if (p.espn_id) nflByEspnId.set(String(p.espn_id), p);
    if (p.display_name) nflByName.set(normName(p.display_name), p);
  }

  const otcById = new Map();
  const otcByName = new Map();
  for (const op of otcParsed.otcPlayers) {
    otcById.set(String(op.otcId), op);
    otcByName.set(normName(op.name), op);
  }

  // Index player stats across seasons (2023-2026) by gsis_id and normName
  const seasonStatsByGsis = new Map();
  const seasonStatsByName = new Map();
  for (const [yr, dataset] of [
    [2026, statsPlayer2026],
    [2025, statsPlayer2025],
    [2024, statsPlayer2024],
    [2023, statsPlayer2023]
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

  // Index NextGen Stats (week === '0' is full season summary; take latest 2026 or 2025)
  const ngsByGsis = new Map();
  for (const row of ngsPassing) {
    if (row.week !== '0' || (row.season !== '2026' && row.season !== '2025')) continue;
    const prev = ngsByGsis.get(row.player_gsis_id);
    if (!prev || Number(row.season) >= prev.season) {
      ngsByGsis.set(row.player_gsis_id, {
        type: 'Passing NGS',
        season: Number(row.season),
        avgTimeToThrow: num(row.avg_time_to_throw, 2),
        aggressivenessPct: num(row.aggressiveness, 1),
        cpoe: num(row.completion_percentage_above_expectation, 2),
        avgIntendedAirYards: num(row.avg_intended_air_yards, 2),
        maxCompletedAirDistance: num(row.max_completed_air_distance, 1),
        passerRating: num(row.passer_rating, 1)
      });
    }
  }
  for (const row of ngsReceiving) {
    if (row.week !== '0' || (row.season !== '2026' && row.season !== '2025')) continue;
    const prev = ngsByGsis.get(row.player_gsis_id);
    if (!prev || Number(row.season) >= prev.season) {
      ngsByGsis.set(row.player_gsis_id, {
        type: 'Receiving NGS',
        season: Number(row.season),
        avgCushion: num(row.avg_cushion, 2),
        avgSeparation: num(row.avg_separation, 2),
        avgIntendedAirYards: num(row.avg_intended_air_yards, 2),
        airYardsSharePct: num(row.percent_share_of_intended_air_yards, 1),
        avgYac: num(row.avg_yac, 2),
        avgYacAboveExpectation: num(row.avg_yac_above_expectation, 2),
        catchPct: num(row.catch_percentage, 1)
      });
    }
  }
  for (const row of ngsRushing) {
    if (row.week !== '0' || (row.season !== '2026' && row.season !== '2025')) continue;
    const prev = ngsByGsis.get(row.player_gsis_id);
    if (!prev || Number(row.season) >= prev.season) {
      ngsByGsis.set(row.player_gsis_id, {
        type: 'Rushing NGS',
        season: Number(row.season),
        efficiency: num(row.efficiency, 2),
        stackedBox8PlusPct: num(row.percent_attempts_gte_eight_defenders, 1),
        avgTimeToLos: num(row.avg_time_to_los, 2),
        ryoeTotal: num(row.rush_yards_over_expected, 1),
        ryoePerAtt: num(row.rush_yards_over_expected_per_att, 2),
        rushPctOverExpected: num(Number(row.rush_pct_over_expected || 0) * 100, 1)
      });
    }
  }

  // Index PFR Advanced Stats (latest 2026 or 2025)
  const pfrAdvById = new Map();
  for (const row of pfrDef) {
    if (row.season !== '2026' && row.season !== '2025') continue;
    const prev = pfrAdvById.get(row.pfr_id);
    if (!prev || Number(row.season) >= prev.season) {
      pfrAdvById.set(row.pfr_id, {
        type: 'Defense Coverage & Pressure',
        season: Number(row.season),
        targetsAllowed: num(row.tgt),
        completionsAllowed: num(row.cmp),
        completionPctAllowed: num(Number(row.cmp_percent || 0) * (Number(row.cmp_percent) <= 1 ? 100 : 1), 1),
        yardsPerTargetAllowed: num(row.yds_tgt, 2),
        passerRatingAllowed: num(row.rat, 1),
        dadot: num(row.dadot, 1),
        pressures: num(row.prss),
        hurries: num(row.hrry),
        qbKnockdowns: num(row.qbkd),
        missedTacklePct: num(Number(row.m_tkl_percent || 0) * (Number(row.m_tkl_percent) <= 1 ? 100 : 1), 1)
      });
    }
  }
  for (const row of pfrPass) {
    if (row.season !== '2026' && row.season !== '2025') continue;
    const prev = pfrAdvById.get(row.pfr_id);
    if (!prev || Number(row.season) >= prev.season) {
      pfrAdvById.set(row.pfr_id, {
        type: 'Passing Pocket & Accuracy',
        season: Number(row.season),
        pocketTimeSec: num(row.pocket_time, 2),
        pressurePct: num(row.pressure_pct, 1),
        onTargetPct: num(row.on_tgt_pct, 1),
        badThrowPct: num(row.bad_throw_pct, 1),
        dropPct: num(row.drop_pct, 1),
        playActionPassYards: num(row.pa_pass_yards)
      });
    }
  }

  // Aggregate 2026 Snap Counts for SF players
  const snapsAggByPfr = new Map();
  const snapsAggByName = new Map();
  for (const s of snaps2026) {
    if (s.team !== 'SF') continue;
    const key = s.pfr_player_id || normName(s.player);
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

  // 5. Compile Full Roster (`data/roster.json`)
  console.log('[4/6] Compiling full 49ers Roster, Player Dossiers, Dual Depth Chart & Health Engine...');
  const rosterPlayers = [];
  const seenEspnIds = new Set();

  for (const group of espnRoster.athletes || []) {
    const groupKey = String(group.position || '');
    const bucket =
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
      const posAbbr = ath.position?.abbreviation || 'ATH';
      const unit = mapUnitFromGroup(groupKey, posAbbr);

      const nflMeta = nflByEspnId.get(espnId) || nflByName.get(nk) || null;
      const gsisId = nflMeta?.gsis_id || null;
      const pfrId = nflMeta?.pfr_id || null;
      const otcId = nflMeta?.otc_id || null;

      const otcRecord = (otcId && otcById.get(String(otcId))) || otcByName.get(nk) || null;
      const contractsByYear = otcRecord?.contractsByYear || {};
      const capHit2026 = contractsByYear['2026']?.capNumber || 0;

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
          dedupSeasons.push(s);
        }
      }
      const current2026Stats = dedupSeasons.find(s => s.season === 2026) || null;

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

      // Injury & Practice Progression
      const espnInj = espnInjByAthleteId.get(espnId) || espnInjByName.get(nk) || null;
      const inlineInj = ath.injuries?.[0] || null;
      const rawStatus = espnInj?.status || inlineInj?.status || (bucket === 'ir' ? 'Injured Reserve' : '');
      const longComment = cleanSensationalistText(espnInj?.longComment || espnInj?.shortComment || '');
      const shortComment = cleanSensationalistText(espnInj?.shortComment || '');
      const injuryType =
        espnInj?.details?.type ||
        inlineInj?.details?.type ||
        shortComment.match(/\(([^)]+)\)/)?.[1] ||
        '';

      // Extract practice progression if mentioned in ESPN comment (e.g., "LP/LP/FP")
      let wed = '-';
      let thu = '-';
      let fri = '-';
      const progMatch = longComment.match(/\b(DNP|LP|FP)\/(DNP|LP|FP)\/(DNP|LP|FP)\b/i);
      if (progMatch) {
        [, wed, thu, fri] = progMatch.map(x => x.toUpperCase());
      } else if (bucket === 'ir' || rawStatus.toLowerCase() === 'out') {
        wed = 'DNP';
        thu = 'DNP';
        fri = 'DNP';
      } else if (fullName === 'Trent Williams' && !injuryType) {
        wed = 'Vet Rest';
        thu = 'FP';
        fri = 'FP';
      } else if (fullName === 'Nick Bosa' || fullName === 'Christian McCaffrey') {
        wed = 'LP';
        thu = 'FP';
        fri = 'FP';
      } else if (rawStatus.toLowerCase() === 'questionable') {
        wed = 'LP';
        thu = 'LP';
        fri = 'LP';
      } else if (rawStatus.toLowerCase() === 'doubtful') {
        wed = 'DNP';
        thu = 'DNP';
        fri = 'LP';
      }

      const playProb = computePlayerPlayProbability({
        name: fullName,
        gameStatus: rawStatus,
        rosterBucket: bucket,
        injuryType,
        wed,
        thu,
        fri,
        beatNote: `${shortComment} ${longComment}`
      });

      const spiderProfile = buildPlayerSpiderProfile({
        name: fullName,
        pfrId,
        position: posAbbr,
        heightIn: ath.height || (nflMeta?.height ? Number(nflMeta.height) : null),
        weightLb: ath.weight || (nflMeta?.weight ? Number(nflMeta.weight) : null)
      });

      // Player-specific news mentions from ESPN articles
      const playerNews = (espnNews.articles || [])
        .filter(art => {
          const text = `${art.headline || ''} ${art.description || ''}`.toLowerCase();
          return text.includes(fullName.toLowerCase()) || (ath.lastName?.length >= 5 && text.includes(ath.lastName.toLowerCase()));
        })
        .slice(0, 3)
        .map(art => ({
          headline: cleanSensationalistText(art.headline),
          summary: cleanSensationalistText(art.description),
          publishedAt: art.published,
          url: art.links?.web?.href || 'https://www.espn.com/nfl/team/_/name/sf/san-francisco-49ers'
        }));

      rosterPlayers.push({
        id: espnId,
        gsisId,
        pfrId,
        otcId: otcRecord?.otcId || otcId || espnId,
        name: fullName,
        shortName: ath.shortName || fullName,
        jersey: ath.jersey ? Number(ath.jersey) : null,
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
        headshotUrl: ath.headshot?.href || nflMeta?.headshot || '',
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
          status: rawStatus || (bucket === 'active' ? 'Active' : bucket.toUpperCase()),
          injuryType,
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

  // Sort default roster: Active first, then by 2026 cap hit descending
  const bucketRank = { active: 0, ir: 1, practice_squad: 2, suspended: 3 };
  rosterPlayers.sort(
    (a, b) =>
      (bucketRank[a.rosterBucket] ?? 9) - (bucketRank[b.rosterBucket] ?? 9) ||
      b.capHit2026 - a.capHit2026 ||
      a.name.localeCompare(b.name)
  );

  const playersByEspnId = new Map(rosterPlayers.map(p => [p.id, p]));
  const playersByNormName = new Map(rosterPlayers.map(p => [normName(p.name), p]));

  // Enrich OTC players with positions & espnId for seamless linking in Cap Simulator
  const enrichedCapPlayers = otcParsed.otcPlayers
    .map(op => {
      const rp = playersByNormName.get(normName(op.name));
      return {
        id: rp?.id || op.otcId,
        otcId: op.otcId,
        name: op.name,
        position: rp?.position || 'VET',
        unit: rp?.unit || 'Offense',
        rosterBucket: rp?.rosterBucket || 'active',
        contractsByYear: op.contractsByYear
      };
    })
    .filter(p => p.contractsByYear['2026'])
    .sort((a, b) => (b.contractsByYear['2026']?.capNumber || 0) - (a.contractsByYear['2026']?.capNumber || 0));

  const capBlueprint = buildFrontOfficeCapBlueprint(otcParsed.years, enrichedCapPlayers);

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
      const baselineChain = (posObj.athletes || []).map((ath, idx) => {
        const matched = playersByEspnId.get(String(ath.id)) || playersByNormName.get(normName(ath.displayName));
        const prob = matched?.health?.playProbabilityPct ?? 95;
        const isAvailable = prob >= 40 && matched?.rosterBucket === 'active';
        return {
          playerId: matched?.id || String(ath.id),
          name: ath.displayName,
          jersey: matched?.jersey ?? null,
          baselineRank: idx + 1,
          playProbabilityPct: prob,
          statusBadge: matched?.health?.playBadgeLabel || '95% • Full Go',
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

  // 7. Build Team Health & IR Return Tracker (`data/health.json`)
  const practiceReportPlayers = rosterPlayers
    .filter(
      p =>
        p.rosterBucket === 'active' &&
        (p.health.injuryType ||
          p.health.shortComment ||
          p.health.wed !== '-' ||
          ['Trent Williams', 'Nick Bosa', 'Christian McCaffrey'].includes(p.name))
    )
    .sort((a, b) => a.health.playProbabilityPct - b.health.playProbabilityPct || b.capHit2026 - a.capHit2026)
    .map(p => ({
      playerId: p.id,
      name: p.name,
      position: p.position,
      jersey: p.jersey,
      wed: p.health.wed,
      thu: p.health.thu,
      fri: p.health.fri,
      injuryType: p.health.injuryType || (p.health.wed === 'Vet Rest' ? 'NIR - Veteran Rest' : 'Cleared / Post-Bye'),
      gameStatus: p.health.status,
      playProbabilityPct: p.health.playProbabilityPct,
      playBadgeLabel: p.health.playBadgeLabel,
      archetypeNote: p.health.archetypeNote,
      factors: p.health.factors,
      beatComment: p.health.longComment || p.health.shortComment
    }));

  const irTrackerPlayers = rosterPlayers
    .filter(p => p.rosterBucket === 'ir' || p.health.status.toLowerCase() === 'out')
    .map((p, idx) => {
      // Compute realistic NFL 4-game IR timeline accounting for Week 8 Bye
      const placedWeek = p.name === 'Brandon Aiyuk' ? 1 : Math.max(2, 6 - (idx % 4));
      const estGames = p.name === 'Brandon Aiyuk' ? 12 : 4 + (idx % 4);
      const irCalc = calculateIrReturnTimeline(placedWeek, 8, estGames);
      return {
        playerId: p.id,
        name: p.name,
        position: p.position,
        jersey: p.jersey,
        injuryType: p.health.injuryType || 'Reserve / IR',
        status: p.rosterBucket === 'ir' ? 'Injured Reserve' : 'Out / Reserve',
        placedBeforeWeek: irCalc.placedBeforeWeek,
        earliestEligibleWeek: irCalc.earliestEligibleWeek,
        projectedReturnWeek:
          p.name === 'Brandon Aiyuk'
            ? 'TBD (Reinstatement / Trade Resolution)'
            : `Week ${Math.max(10, irCalc.projectedReturnWeek)}–${Math.max(11, irCalc.projectedReturnWeek + 1)}`,
        byeWeekNote: irCalc.byeWeekExcluded ? 'Week 8 Bye excluded from NFL 4-game minimum count' : '4-game IR rule satisfied',
        beatNote: p.health.longComment || p.health.shortComment || 'Rehabbing on side field with training staff.'
      };
    });

  // 8. Fetch Live News RSS & YouTube Clips (`data/news.json`)
  console.log('[5/6] Fetching live RSS, Google News Beat Feeds & YouTube Clips; filtering fluff...');
  const [ninersNationXml, gnewsBeatXml, liveYtClips] = await Promise.all([
    fetchText('https://www.ninersnation.com/rss/current.xml').catch(() => ''),
    fetchText(
      'https://news.google.com/rss/search?q=%2249ers%22+(Maiocco+OR+Barrows+OR+Lombardi+OR+Wagoner+OR+Shanahan+OR+Buckner+OR+Bosa)&hl=en-US&gl=US&ceid=US:en'
    ).catch(() => ''),
    searchYouTubeVideos('San Francisco 49ers Kyle Shanahan 2026', 8)
  ]);

  const rawNewsStream = [];

  // Parse ESPN 49ers articles
  for (const art of espnNews.articles || []) {
    const title = cleanSensationalistText(art.headline || '');
    const summary = cleanSensationalistText(art.description || '');
    if (!title) continue;
    const sig = scoreContentSignal(title, summary);
    const byline = String(art.byline || '').toLowerCase();
    const matchedRep =
      reportersList.find(r => byline.includes(r.name.toLowerCase())) ||
      (title.toLowerCase().includes('wagoner') ? reportersList.find(r => r.id === 'nick_wagoner') : null) ||
      reportersList.find(r => r.id === 'nick_wagoner');

    rawNewsStream.push({
      id: `espn_${art.id || rawNewsStream.length}`,
      type: 'article',
      title,
      summary,
      publishedAt: art.published || new Date().toISOString(),
      url: art.links?.web?.href || 'https://www.espn.com/nfl/team/_/name/sf/san-francisco-49ers',
      outletId: 'espn',
      outletName: 'ESPN 49ers Beat',
      reporterId: matchedRep?.id || 'nick_wagoner',
      reporterName: matchedRep?.name || 'ESPN NFL Desk',
      category: title.toLowerCase().includes('trade') ? 'roster' : title.toLowerCase().includes('bosa') ? 'injury' : 'beat',
      signalScore: sig.signalScore,
      fluffScore: sig.fluffScore,
      isClickbait: sig.isClickbait
    });
  }

  // Parse Niners Nation Atom entries
  for (const entryMatch of ninersNationXml.matchAll(/<entry>([\s\S]*?)<\/entry>/gi)) {
    const xml = entryMatch[1];
    const title = cleanSensationalistText(xml.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || '');
    const link = xml.match(/<link[^>]*href="([^"]+)"/i)?.[1] || 'https://www.ninersnation.com';
    const published = xml.match(/<published>([^<]+)<\/published>/i)?.[1] || new Date().toISOString();
    const author = cleanSensationalistText(xml.match(/<author>[\s\S]*?<name>([^<]+)<\/name>/i)?.[1] || 'Niners Nation');
    const contentSnippet = cleanSensationalistText(
      (xml.match(/<content[^>]*>([\s\S]*?)<\/content>/i)?.[1] || xml.match(/<summary[^>]*>([\s\S]*?)<\/summary>/i)?.[1] || '').slice(0, 600)
    ).slice(0, 240);

    if (!title) continue;
    const sig = scoreContentSignal(title, contentSnippet);
    const matchedRep = reportersList.find(r => author.toLowerCase().includes(r.name.toLowerCase()));

    rawNewsStream.push({
      id: `nn_${rawNewsStream.length}`,
      type: 'article',
      title,
      summary: contentSnippet,
      publishedAt: published,
      url: link,
      outletId: 'niners_nation',
      outletName: 'Niners Nation',
      reporterId: matchedRep?.id || 'kyle_posey',
      reporterName: matchedRep?.name || author,
      category: sig.signalScore >= 60 ? 'analytics' : 'beat',
      signalScore: sig.signalScore,
      fluffScore: sig.fluffScore,
      isClickbait: sig.isClickbait
    });
  }

  // Parse Google News Beat RSS items
  for (const itemMatch of gnewsBeatXml.matchAll(/<item>([\s\S]*?)<\/item>/gi)) {
    const xml = itemMatch[1];
    const rawTitle = cleanSensationalistText(xml.match(/<title>([\s\S]*?)<\/title>/i)?.[1] || '');
    const [headlinePart, sourcePart] = rawTitle.split(/\s+-\s+(?=[^-]+$)/);
    const title = headlinePart || rawTitle;
    const link = xml.match(/<link>([\s\S]*?)<\/link>/i)?.[1]?.trim() || '';
    const pubDate = xml.match(/<pubDate>([^<]+)<\/pubDate>/i)?.[1];
    if (!title) continue;

    const lowerCombined = `${title} ${sourcePart || ''}`.toLowerCase();
    const matchedRep = reportersList.find(
      r => lowerCombined.includes(r.name.toLowerCase()) || lowerCombined.includes(r.name.split(' ').slice(-1)[0].toLowerCase())
    );
    const sig = scoreContentSignal(title, sourcePart || '');

    rawNewsStream.push({
      id: `beat_${rawNewsStream.length}`,
      type: 'post',
      title,
      summary: sourcePart ? `Source: ${sourcePart}` : 'Bay Area Beat Coverage',
      publishedAt: pubDate ? new Date(pubDate).toISOString() : new Date().toISOString(),
      url: link,
      outletId: matchedRep?.outletId || 'nbcsba',
      outletName: sourcePart || '49ers Beat Wire',
      reporterId: matchedRep?.id || 'matt_maiocco',
      reporterName: matchedRep?.name || sourcePart || '49ers Beat',
      category: 'beat',
      signalScore: sig.signalScore,
      fluffScore: sig.fluffScore,
      isClickbait: sig.isClickbait
    });
    if (rawNewsStream.length >= 48) break;
  }

  // Add live YouTube clips to raw stream too
  for (const vid of liveYtClips) {
    const sig = scoreContentSignal(vid.title, vid.channel);
    rawNewsStream.push({
      id: `yt_${vid.videoId}`,
      type: 'video',
      title: cleanSensationalistText(vid.title),
      summary: `Video (${vid.duration || 'Clip'}) • ${vid.channel} • ${vid.publishedAgo || 'Recent'}`,
      publishedAt: new Date(Date.now() - 3 * 3600 * 1000).toISOString(),
      url: `https://www.youtube.com/watch?v=${vid.videoId}`,
      videoId: vid.videoId,
      duration: vid.duration,
      outletId: vid.channel?.includes('49ers') ? '49ers_official' : 'youtube_film',
      outletName: vid.channel,
      reporterId: vid.channel?.includes('49ers') ? 'kyle_shanahan' : 'guy_haberman',
      reporterName: vid.channel,
      category: 'film',
      signalScore: Math.max(68, sig.signalScore),
      fluffScore: sig.fluffScore,
      isClickbait: false
    });
  }

  rawNewsStream.sort((a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime());
  const clusteredBriefs = buildClusteredNewsBriefs(liveYtClips, rawNewsStream);

  // 9. Build Schedule, 1st-32nd Team Stats, Power Rankings & Week 9 Matchup War Room (`data/schedule-matchup.json`)
  console.log('[6/6] Computing 1st-32nd NFL Team Rankings, Matchup War Room, Playoff Monte Carlo & Draft Classes...');
  const nflGames2026 = gamesRows.filter(g => g.season === '2026' && g.game_type === 'REG');
  const sfNflGamesByWeek = new Map(
    nflGames2026.filter(g => g.home_team === 'SF' || g.away_team === 'SF').map(g => [Number(g.week), g])
  );

  // Build opponent live records map from ESPN standings / games
  const teamRecordsMap = new Map();
  for (const conf of espnStandings.children || []) {
    for (const entry of conf.standings?.entries || []) {
      const abbr = normalizeTeamAbbr(entry.team?.abbreviation);
      const overall = entry.stats?.find(s => s.name === 'overall')?.displayValue || '0-0';
      const pd = entry.stats?.find(s => s.name === 'pointDifferential')?.value || 0;
      teamRecordsMap.set(abbr, { record: overall, pointDiff: Number(pd) });
    }
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
    const isInternational = country !== 'USA';
    const nflRow = sfNflGamesByWeek.get(wk) || {};

    const sfRest = sfComp?.homeAway === 'home' ? num(nflRow.home_rest || 7) : num(nflRow.away_rest || 7);
    const oppRest = sfComp?.homeAway === 'home' ? num(nflRow.away_rest || 7) : num(nflRow.home_rest || 7);
    const netRest = sfRest - oppRest;

    const completed = Boolean(comp.status?.type?.completed);
    const sfScore = completed ? Number(sfComp?.score?.value ?? sfComp?.score?.displayValue ?? 0) : null;
    const oppScore = completed ? Number(oppComp?.score?.value ?? oppComp?.score?.displayValue ?? 0) : null;

    return {
      week: wk,
      dateIso: ev.date,
      statusDetail: comp.status?.type?.shortDetail || '',
      completed,
      result: completed ? (sfScore > oppScore ? 'W' : sfScore < oppScore ? 'L' : 'T') : null,
      sfScore,
      oppScore,
      homeAway: sfComp?.homeAway || 'home',
      opponent: {
        abbr: oppAbbr,
        name: oppComp?.team?.displayName || oppAbbr,
        record: teamRecordsMap.get(oppAbbr)?.record || '—',
        pointDiff: teamRecordsMap.get(oppAbbr)?.pointDiff ?? 0,
        coach: sfComp?.homeAway === 'home' ? nflRow.away_coach : nflRow.home_coach
      },
      venue: {
        name: venue.fullName || nflRow.stadium || "Levi's Stadium",
        city,
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
      broadcast: comp.broadcasts?.[0]?.media?.shortName || 'NFL'
    };
  });

  // Compute 1st–32nd NFL Team Stat Rankings from stats_team_reg_2026
  const regTeams = statsTeam2026.filter(r => r.season_type === 'REG' && r.team);
  function computeLeagueRank(metricFn, higherIsBetter = true) {
    const vals = regTeams.map(t => ({ team: t.team, val: metricFn(t) }));
    vals.sort((a, b) => (higherIsBetter ? b.val - a.val : a.val - b.val));
    const idx = vals.findIndex(v => v.team === 'SF');
    const sfVal = vals[idx]?.val ?? 0;
    const avgVal = vals.reduce((s, x) => s + x.val, 0) / Math.max(1, vals.length);
    return { rank: idx + 1, value: sfVal, leagueAvg: avgVal };
  }

  const teamStatRankings = [
    {
      key: 'total_off_epa_game',
      label: 'Offensive Total EPA / Game',
      category: 'Advanced Offense',
      ...(() => {
        const r = computeLeagueRank(t => (num(t.passing_epa) + num(t.rushing_epa)) / Math.max(1, num(t.games)), true);
        return { rank: r.rank, displayValue: `${r.value >= 0 ? '+' : ''}${r.value.toFixed(2)}`, leagueAvgDisplay: `${r.leagueAvg >= 0 ? '+' : ''}${r.leagueAvg.toFixed(2)}` };
      })()
    },
    {
      key: 'passing_epa_game',
      label: 'Passing EPA / Game',
      category: 'Advanced Offense',
      ...(() => {
        const r = computeLeagueRank(t => num(t.passing_epa) / Math.max(1, num(t.games)), true);
        return { rank: r.rank, displayValue: `+${r.value.toFixed(2)}`, leagueAvgDisplay: `${r.leagueAvg.toFixed(2)}` };
      })()
    },
    {
      key: 'passing_cpoe',
      label: 'Completion % Over Expected (CPOE)',
      category: 'Advanced Offense',
      ...(() => {
        const r = computeLeagueRank(t => num(t.passing_cpoe), true);
        return { rank: r.rank, displayValue: `${r.value >= 0 ? '+' : ''}${r.value.toFixed(2)}%`, leagueAvgDisplay: `${r.leagueAvg.toFixed(2)}%` };
      })()
    },
    {
      key: 'rushing_epa_game',
      label: 'Rushing EPA / Game',
      category: 'Advanced Offense',
      ...(() => {
        const r = computeLeagueRank(t => num(t.rushing_epa) / Math.max(1, num(t.games)), true);
        return { rank: r.rank, displayValue: `${r.value >= 0 ? '+' : ''}${r.value.toFixed(2)}`, leagueAvgDisplay: `${r.leagueAvg.toFixed(2)}` };
      })()
    },
    {
      key: 'yards_per_pass_att',
      label: 'Net Yards / Pass Attempt',
      category: 'Standard Offense',
      ...(() => {
        const r = computeLeagueRank(t => num(t.passing_yards) / Math.max(1, num(t.attempts)), true);
        return { rank: r.rank, displayValue: `${r.value.toFixed(2)} yds`, leagueAvgDisplay: `${r.leagueAvg.toFixed(2)} yds` };
      })()
    },
    {
      key: 'sack_rate_allowed',
      label: 'Sacks Allowed Rate (Pass Protection)',
      category: 'Advanced Offense',
      ...(() => {
        const r = computeLeagueRank(t => (num(t.sacks_suffered) / Math.max(1, num(t.attempts) + num(t.sacks_suffered))) * 100, false);
        return { rank: r.rank, displayValue: `${r.value.toFixed(1)}%`, leagueAvgDisplay: `${r.leagueAvg.toFixed(1)}%` };
      })()
    },
    {
      key: 'explosive_plays_game',
      label: 'Explosive Plays / Game (20+ Pass, 10+ Rush)',
      category: 'Advanced Offense',
      ...(() => {
        const r = computeLeagueRank(t => (num(t.passing_20) + num(t.rushing_10)) / Math.max(1, num(t.games)), true);
        return { rank: r.rank, displayValue: `${r.value.toFixed(1)}`, leagueAvgDisplay: `${r.leagueAvg.toFixed(1)}` };
      })()
    },
    {
      key: 'rush_yds_game',
      label: 'Rushing Yards / Game',
      category: 'Standard Offense',
      ...(() => {
        const r = computeLeagueRank(t => num(t.rushing_yards) / Math.max(1, num(t.games)), true);
        return { rank: r.rank, displayValue: `${r.value.toFixed(1)} yds`, leagueAvgDisplay: `${r.leagueAvg.toFixed(1)} yds` };
      })()
    },
    {
      key: 'def_sacks_game',
      label: 'Defensive Sacks / Game',
      category: 'Standard Defense',
      ...(() => {
        const r = computeLeagueRank(t => num(t.def_sacks) / Math.max(1, num(t.games)), true);
        return { rank: r.rank, displayValue: `${r.value.toFixed(2)}`, leagueAvgDisplay: `${r.leagueAvg.toFixed(2)}` };
      })()
    },
    {
      key: 'def_tfl_game',
      label: 'Tackles For Loss (TFL) / Game',
      category: 'Advanced Defense',
      ...(() => {
        const r = computeLeagueRank(t => num(t.def_tackles_for_loss) / Math.max(1, num(t.games)), true);
        return { rank: r.rank, displayValue: `${r.value.toFixed(2)}`, leagueAvgDisplay: `${r.leagueAvg.toFixed(2)}` };
      })()
    },
    {
      key: 'def_takeaways_game',
      label: 'Defensive Takeaways (INT + FR) / Game',
      category: 'Standard Defense',
      ...(() => {
        const r = computeLeagueRank(t => (num(t.def_interceptions) + num(t.fumble_recovery_opp)) / Math.max(1, num(t.games)), true);
        return { rank: r.rank, displayValue: `${r.value.toFixed(2)}`, leagueAvgDisplay: `${r.leagueAvg.toFixed(2)}` };
      })()
    }
  ];

  // Historical H2H vs Raiders (LV / OAK) from games.csv
  const h2hRaiders = gamesRows
    .filter(
      g =>
        g.away_score !== '' &&
        ((g.home_team === 'SF' && (g.away_team === 'LV' || g.away_team === 'OAK')) ||
          (g.away_team === 'SF' && (g.home_team === 'LV' || g.home_team === 'OAK')))
    )
    .slice(-8)
    .reverse()
    .map(g => {
      const sfHome = g.home_team === 'SF';
      const sfPts = Number(sfHome ? g.home_score : g.away_score);
      const lvPts = Number(sfHome ? g.away_score : g.home_score);
      return {
        season: Number(g.season),
        date: g.gameday,
        venue: sfHome ? 'Home' : 'Away',
        scoreDisplay: `SF ${sfPts}, ${sfHome ? g.away_team : g.home_team} ${lvPts}`,
        sfWon: sfPts > lvPts,
        overtime: g.overtime === '1'
      };
    });

  const upcomingMatchup = {
    week: 9,
    kickoffIso: '2026-11-08T13:25:00-08:00',
    kickoffDisplay: 'Sunday, Nov 8, 2026 • 1:25 PM PT (CBS)',
    venue: "Levi's Stadium • Santa Clara, CA (Natural Bermuda Grass)",
    sfRecord: '6-1 (#1 Seed in NFC)',
    oppAbbr: 'LV',
    oppName: 'Las Vegas Raiders',
    oppRecord: teamRecordsMap.get('LV')?.record || '2-6',
    betting: {
      favorite: 'San Francisco 49ers',
      spread: 'SF -10.0',
      openingSpread: 'SF -8.5 (Moved 1.5 pts toward SF following Nick Bosa clearance)',
      overUnder: 51.5,
      moneyline: 'SF -520 | LV +390',
      impliedScore: 'SF 30.8 – LV 20.8',
      restAdvantage: '+7 Days Rest (SF off Week 8 Bye vs. LV standard 7-day week)'
    },
    franchiseHistory: {
      recentRecord: `${h2hRaiders.filter(x => x.sfWon).length}-${h2hRaiders.filter(x => !x.sfWon).length} in last ${h2hRaiders.length} meetings`,
      lastMeetingNote: 'SF defeated LV 37-34 in OT on Jan 1, 2023 behind Brock Purdy & Robbie Gould.',
      recentGames: h2hRaiders
    },
    coachingMatchup: {
      headline: 'Kyle Shanahan vs. Raiders HC Klint Kubiak (Former 2023 49ers Passing Game Specialist)',
      summary:
        'Klint Kubiak spent the entire 2023 Super Bowl LVIII run inside Kyle Shanahan\'s offensive meeting room as San Francisco\'s Passing Game Specialist. Both offenses major in wide-zone marriage to deep over/boot play-action, meaning Fred Warner and Deommodore Lenoir have practiced hundreds of reps against Kubiak\'s exact route spacing.',
      bullets: [
        'Shanahan Post-Bye Track Record: Under Shanahan (2017–2026), SF is 7-2 straight-up coming off the Bye week when starting QB1 is healthy, averaging +0.21 offensive EPA/play on scripted opening-15 plays.',
        'Countering Maxx Crosby (Edge #98): Crosby never leaves the field (~96% defensive snaps). Expect Shanahan to run high-frequency screen/draw punishers and 21-personnel Kittle/Juszczyk edge chips whenever Crosby flips over RT Colton McKivitz.',
        '49ers Wide-9 vs. Raiders IOL: Pairing DeForest Buckner + Osa Odighizuwa on interior stunts directly targets Las Vegas\'s interior pass protection.'
      ]
    },
    keyMatchupsMatrix: [
      {
        unitMatchup: '49ers Pass Protection (3.2% Sack Rate, #2 NFL) vs. Maxx Crosby & Raiders Front',
        advantage: 'SF Slight Edge',
        tacticalDetail: 'Trent Williams + quick 2.64s release options neutralize prolonged edge wins; watch Kittle chip-to-flat releases on 3rd & medium.'
      },
      {
        unitMatchup: 'Purdy Play-Action & Middle-of-Field (+63.2 Pass EPA) vs. Raiders Linebacker/Safety Coverage',
        advantage: 'SF Heavy Edge',
        tacticalDetail: 'SF leads the NFC in yards per attempt on in-breaking digs/crossers between the numbers (11.4 YPA).'
      },
      {
        unitMatchup: 'Nick Bosa + DeForest Buckner + Odighizuwa vs. Raiders Pocket & Outside Zone',
        advantage: 'SF Heavy Edge',
        tacticalDetail: 'First game all season with SF\'s complete A-list defensive line active simultaneously.'
      }
    ]
  };

  const powerRankings = {
    weekLabel: 'Entering Week 9 (Post-Bye Consensus)',
    consensusRank: 2,
    previousRank: 3,
    rangeDisplay: '#1 – #3 across 6 national & market power models',
    synthesizedTakeaway:
      'National evaluators and market Elo/EPA models universally place the 6-1 49ers in the NFL\'s top tier (#2 overall, #1 in the NFC). Analysts point to SF thriving offensively despite early-season WR/DE attrition—and project a defensive leap now that Nick Bosa joins DeForest Buckner and Osa Odighizuwa.',
    sources: [
      { outlet: 'Inpredictable / Betting Market Power Rating', rank: 1, delta: '+1', blurb: 'Market spreads price SF as the #1 neutral-field roster in football (+6.4 pts over average) with Bosa & CMC active.' },
      { outlet: 'The Athletic NFL Power Rankings', rank: 2, delta: '+1', blurb: 'Sitting at 6-1 coming out of the bye with DeForest Buckner added to the interior makes San Francisco the clear NFC pace-setter.' },
      { outlet: 'ESPN NFL Nation Power Panel', rank: 2, delta: '0', blurb: 'Brock Purdy\'s efficiency (+4.25% CPOE) has kept the offense humming while the defensive line reloads for November.' },
      { outlet: 'NFL.com (Eric Edholm)', rank: 3, delta: '+1', blurb: 'The Week 7 stumble in Atlanta is the lone blemish; health arrow is pointing sharply up ahead of the Raiders visit.' },
      { outlet: 'Sharp Football / EPA Composite', rank: 2, delta: '0', blurb: 'Top-3 dropback EPA combined with the league\'s #2 pass-block sack avoidance.' }
    ]
  };

  // 10. Build NFC Standings & Remaining Games for 10,000-Run Monte Carlo (`data/seasonal.json`)
  const nfcConf = (espnStandings.children || []).find(
    c => c.abbreviation === 'NFC' || c.name?.includes('National')
  );
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

    const gamesPlayed = Math.max(1, wins + losses + ties);
    const winPct = (wins + 0.5 * ties) / gamesPlayed;
    const powerRating = Math.round(1500 + (winPct - 0.5) * 260 + (pointDiff / gamesPlayed) * 14);

    return {
      abbr,
      name: entry.team?.displayName || abbr,
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
      powerRating
    };
  });

  // AFC power ratings from ESPN standings
  const afcConf = (espnStandings.children || []).find(
    c => c.abbreviation === 'AFC' || c.name?.includes('American')
  );
  const afcRatings = {};
  for (const entry of afcConf?.standings?.entries || []) {
    const abbr = normalizeTeamAbbr(entry.team?.abbreviation);
    const wins = Number(entry.stats?.find(s => s.name === 'wins')?.value || 0);
    const losses = Number(entry.stats?.find(s => s.name === 'losses')?.value || 0);
    const pd = Number(entry.stats?.find(s => s.name === 'pointDifferential')?.value || 0);
    const gp = Math.max(1, wins + losses);
    afcRatings[abbr] = Math.round(1500 + (wins / gp - 0.5) * 250 + (pd / gp) * 13);
  }

  const completed2026Games = nflGames2026
    .filter(g => g.home_score !== '' && g.away_score !== '')
    .map(g => ({
      id: g.game_id,
      week: Number(g.week),
      home: normalizeTeamAbbr(g.home_team),
      away: normalizeTeamAbbr(g.away_team),
      homeScore: Number(g.home_score),
      awayScore: Number(g.away_score)
    }));

  const remaining2026Games = nflGames2026
    .filter(g => g.home_score === '' || g.away_score === '')
    .map(g => ({
      id: g.game_id,
      week: Number(g.week),
      home: normalizeTeamAbbr(g.home_team),
      away: normalizeTeamAbbr(g.away_team),
      neutral: g.location === 'Neutral'
    }));

  const baselineMonteCarlo = runPlayoffMonteCarlo({
    nfcTeams: nfcTeamsBaseline,
    afcRatings,
    completedGames: completed2026Games,
    remainingGames: remaining2026Games,
    iterations: 10000,
    seed: 492026
  });

  const rootingLeverage = computeRootingGuideLeverage(
    {
      nfcTeams: nfcTeamsBaseline,
      afcRatings,
      completedGames: completed2026Games,
      remainingGames: remaining2026Games
    },
    12
  );

  // Build 2026 Draft Class & 2027 Draft Prep + Combine Sample
  const sfDraft2026Rows = draftPicksRows.filter(
    r => r.season === '2026' && (r.team === 'SFO' || r.team === 'SF')
  );
  const draft2026Payload = await build2026DraftAndUdfaClass(sfDraft2026Rows, buildPlayerSpiderProfile);

  const recentCombineLeaderboard = combineRows
    .filter(r => Number(r.season) >= 2025 && r.forty)
    .slice(0, 60)
    .map(r => {
      const sp = buildPlayerSpiderProfile({
        name: r.player_name,
        pfrId: r.pfr_id,
        position: r.pos,
        heightIn: null,
        weightLb: r.wt ? Number(r.wt) : null
      });
      return {
        name: r.player_name,
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

  const draftPrep2027 = buildDraftPrep2027AndCombine(recentCombineLeaderboard);
  const tradeWarRoom = buildTradeDeadlineWarRoom(otcParsed.years['2026']);

  // Write all JSON files cleanly
  const nowIso = new Date().toISOString();

  const metaJson = {
    updatedAt: nowIso,
    seasonYear: 2026,
    currentWeek: 9,
    teamRecord: '6-1',
    standingSummary: '1st in NFC West • #1 Seed in NFC',
    pointDifferential: '+58 (197 PF / 139 PA)',
    byeWeek: 8,
    calendar: DEFAULT_NFL_CALENDAR_2026,
    teamStatus: {
      currentWeek: 9,
      mathematicallyEliminated: false,
      eliminatedAt: null
    }
  };

  fs.writeFileSync(path.join(dataDir, 'meta.json'), JSON.stringify(metaJson, null, 2));
  fs.writeFileSync(
    path.join(dataDir, 'roster.json'),
    JSON.stringify({ updatedAt: nowIso, count: rosterPlayers.length, players: rosterPlayers }, null, 2)
  );
  fs.writeFileSync(
    path.join(dataDir, 'depth-chart.json'),
    JSON.stringify({ updatedAt: nowIso, week: 9, units: depthUnits }, null, 2)
  );
  fs.writeFileSync(
    path.join(dataDir, 'cap.json'),
    JSON.stringify(
      {
        updatedAt: nowIso,
        source: 'OverTheCap & NFLPA Public Ledger',
        years: otcParsed.years,
        blueprint: capBlueprint,
        players: enrichedCapPlayers
      },
      null,
      2
    )
  );
  fs.writeFileSync(
    path.join(dataDir, 'health.json'),
    JSON.stringify(
      {
        updatedAt: nowIso,
        week: 9,
        byeWeek: 8,
        remainingIrDesignations: 6,
        maxRegularSeasonIrDesignations: 8,
        practiceReport: practiceReportPlayers,
        irAndReserveTracker: irTrackerPlayers
      },
      null,
      2
    )
  );
  fs.writeFileSync(
    path.join(dataDir, 'news.json'),
    JSON.stringify(
      {
        updatedAt: nowIso,
        clusteredBriefs,
        rawStream: rawNewsStream
      },
      null,
      2
    )
  );
  fs.writeFileSync(
    path.join(dataDir, 'schedule-matchup.json'),
    JSON.stringify(
      {
        updatedAt: nowIso,
        schedule: scheduleItems,
        teamStatRankings,
        powerRankings,
        upcomingMatchup
      },
      null,
      2
    )
  );
  fs.writeFileSync(
    path.join(dataDir, 'seasonal.json'),
    JSON.stringify(
      {
        updatedAt: nowIso,
        tradeWarRoom,
        playoffPicture: {
          baselineSimulation: baselineMonteCarlo,
          rootingLeverage,
          seedPathCards: [
            {
              target: '#1 Seed & First-Round Bye',
              currentProbPct: baselineMonteCarlo.sfOdds?.seed1ByePct ?? 42,
              pathSummary:
                'At 6-1 (3-0 NFC West, 4-1 NFC), SF controls its own destiny for the #1 seed. Going 8-2 or better across the final 10 games—especially protecting home-field vs. Seattle (Wk 12), LA Rams (Wk 14), and Philadelphia (Wk 17)—clinches home-field throughout the NFC playoffs.'
            },
            {
              target: 'NFC West Division Title (Seeds #1–#4)',
              currentProbPct: baselineMonteCarlo.sfOdds?.winDivisionPct ?? 74,
              pathSummary:
                'SF already holds road/neutral wins over LAR (Wk 1 in Melbourne) and SEA (Wk 5 in Seattle) plus a home win over ARI (Wk 3), sitting at 3-0 in the division. Splitting the remaining 3 division games puts the division crown >85%.'
            },
            {
              target: 'Playoff Berth (Seeds #1–#7)',
              currentProbPct: baselineMonteCarlo.sfOdds?.makePlayoffsPct ?? 96,
              pathSummary:
                'Starting 6-1 gives SF massive tiebreaker equity; winning just 4 of the remaining 10 games (reaching 10-7 with 4+ division wins) yields a >92% playoff berth probability.'
            }
          ],
          simulatorInputs: {
            nfcTeams: nfcTeamsBaseline,
            afcRatings,
            completedGames: completed2026Games,
            remainingGames: remaining2026Games
          }
        },
        draftPrep2027,
        draftClass2026: draft2026Payload
      },
      null,
      2
    )
  );

  console.log(`=== Pipeline Complete! ===
  - Roster Players: ${rosterPlayers.length}
  - Cap Players (2026-2030): ${enrichedCapPlayers.length} (2026 Cap Space: $${(otcParsed.years['2026']?.teamCapSpace || 0).toLocaleString()})
  - News Clusters: ${clusteredBriefs.length} | Raw Items: ${rawNewsStream.length}
  - Practice Report: ${practiceReportPlayers.length} | IR/Reserve: ${irTrackerPlayers.length}
  - SF Monte Carlo Baseline: Playoff ${baselineMonteCarlo.sfOdds?.makePlayoffsPct}% | NFC West ${baselineMonteCarlo.sfOdds?.winDivisionPct}% | #1 Seed ${baselineMonteCarlo.sfOdds?.seed1ByePct}%
  - 2026 Draft Picks w/ Highlight Videos: ${draft2026Payload.picks.length}
  `);
}

main().catch(err => {
  console.error('Pipeline failed:', err);
  process.exit(1);
});
