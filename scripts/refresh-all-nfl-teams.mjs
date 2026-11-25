#!/usr/bin/env node
/**
 * Unified 32-Team NFL Live Data Ingestion & Synchronization Orchestrator
 *
 * Single canonical pipeline entry point for ALL 32 NFL franchises (`49ers.joshal.com` through
 * `vikings.joshal.com` + `nfl.joshal.com`).
 *
 * Modes:
 *   - Default (no mode flag): Full 32-team refresh:
 *       1. Refreshes all 32 teams identically (`data/*.json` for SF + `data/teams/<slug>/*.json`
 *          for all 31 other teams) via `scripts/fetch-live-data.mjs` in parallel isolated child
 *          processes (`--concurrency=4`, zero singleton cross-team contamination, ~3.5x faster).
 *       2. Runs the canonical 32-team seasonal/playoff synchronization pass so ALL 32 teams
 *          (including SF) finish with identical `PLAYOFF_MODEL_VERSION`, `completedGames`,
 *          `remainingGames`, `preseasonPriors`, and 32-team `injuryAdjustmentsByTeam`.
 *   - `--seasonal-only`: Ultra-fast (~5-8s) synchronized Playoff Monte Carlo & standings resync
 *       across ALL 32 teams (`data/seasonal.json` + all 31 `data/teams/<slug>/seasonal.json`).
 *   - `--sf-fast`: Fast SF full refresh + `<8s` 32-team `--seasonal-only` sync (keeps high-frequency
 *       30-minute SF ticks fast with zero latency penalty while keeping all 32 teams' playoff/standings synced).
 *   - `--power-rankings-only`: Fast 32-team Power Rankings resync across SF + all 31 other teams.
 *   - `--teams=sf,det,kc`: Targeted refresh for a comma-separated subset of teams (including `sf`).
 *   - `--concurrency=N`: Parallel worker shards for non-SF teams (default: 4, clamped 1..6).
 *   - `--force-brief`: Forces fresh Gemini daily brief synthesis where API key is present.
 */

import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { ALL_NFL_TEAMS, resolveTeamConfig } from '../src/config/teamRegistry.js';
import { syncAll32TeamsSeasonalPlayoffData } from './lib/leaguePlayoffPipeline.mjs';
import {
  fetchLeaguePowerRankingsPayloads,
  fetchLivePowerRankings
} from './lib/powerRankingsFetcher.mjs';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');

const BASE_ENV = {
  ...process.env,
  ...(process.platform === 'darwin' && !process.env.NODE_EXTRA_CA_CERTS && fs.existsSync('/etc/ssl/cert.pem')
    ? { NODE_EXTRA_CA_CERTS: '/etc/ssl/cert.pem' }
    : {})
};

function spawnNodeScript(scriptPath, args = [], { label = '', env = BASE_ENV } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [scriptPath, ...args], {
      cwd: ROOT,
      env,
      stdio: 'inherit'
    });
    child.on('error', err => reject(err));
    child.on('close', code => {
      if (code === 0) resolve({ code: 0, label });
      else reject(new Error(`${label || path.basename(scriptPath)} exited with code ${code}`));
    });
  });
}

function chunkIntoShards(items, shardCount) {
  const count = Math.max(1, Math.min(shardCount, items.length));
  const shards = Array.from({ length: count }, () => []);
  items.forEach((item, idx) => {
    shards[idx % count].push(item);
  });
  return shards.filter(s => s.length > 0);
}

async function runTeamsInParallelShards(teams, { concurrency = 4, extraArgs = [] } = {}) {
  if (!teams.length) return;
  const shards = chunkIntoShards(teams, concurrency);
  console.log(
    `[all-32] Launching ${shards.length} isolated worker shard(s) for ${teams.length} NFL team(s) via scripts/fetch-live-data.mjs (concurrency=${concurrency})...`
  );
  const fetchLiveScript = path.join(ROOT, 'scripts', 'fetch-live-data.mjs');
  const results = await Promise.allSettled(
    shards.map((shard, idx) => {
      const slugs = shard.map(t => t.abbr).join(',');
      return spawnNodeScript(
        fetchLiveScript,
        [`--teams=${slugs}`, ...extraArgs],
        { label: `shard-${idx + 1}(${slugs})` }
      );
    })
  );
  const rejected = results.filter(r => r.status === 'rejected');
  if (rejected.length > 0) {
    throw new Error(
      `${rejected.length}/${shards.length} worker shard(s) failed: ${rejected
        .map(r => r.reason?.message || r.reason)
        .join('; ')}`
    );
  }
}

async function syncPowerRankingsAll32(teams, seasonYear = 2026) {
  const sfMetaPath = path.join(ROOT, 'data', 'teams', '49ers', 'meta.json');
  const sfMeta = fs.existsSync(sfMetaPath) ? JSON.parse(fs.readFileSync(sfMetaPath, 'utf8')) : {};
  const probeWeek = Number(sfMeta.currentWeek) || 12;
  console.log(`[all-32:power] Fetching 6 league-wide power rankings sources once (week~${probeWeek})...`);
  const sharedPayloads = await fetchLeaguePowerRankingsPayloads({
    seasonYear,
    currentWeek: probeWeek
  });
  const nowMs = Date.now();
  for (const team of teams) {
    const dir = path.join(ROOT, 'data', 'teams', team.slug);
    const smPath = path.join(dir, 'schedule-matchup.json');
    const metaPath = path.join(dir, 'meta.json');
    if (!fs.existsSync(smPath)) continue;
    const sm = JSON.parse(fs.readFileSync(smPath, 'utf8'));
    const meta = fs.existsSync(metaPath) ? JSON.parse(fs.readFileSync(metaPath, 'utf8')) : {};
    const oppFull = sm?.upcomingMatchup?.oppName || '';
    const oppShort = oppFull ? oppFull.trim().split(/\s+/).pop() : null;
    const pr = await fetchLivePowerRankings({
      teamAbbr: team.abbr,
      seasonYear: Number(meta.seasonYear) || seasonYear,
      currentWeek: Number(meta.currentWeek) || probeWeek,
      schedule: sm.schedule || [],
      sfRecord: meta.teamRecord || null,
      oppShortName: oppShort,
      sharedPayloads,
      nowMs
    });
    sm.powerRankings = pr;
    fs.writeFileSync(smPath, JSON.stringify(sm, null, 2));
  }
  console.log(`[all-32:power] Synced Power Rankings across ${teams.length} teams cleanly.`);
}

async function main() {
  const t0 = Date.now();
  const args = process.argv.slice(2);
  const seasonalOnly = args.includes('--seasonal-only');
  const sfFast = args.includes('--sf-fast');
  const powerRankingsOnly = args.includes('--power-rankings-only');
  const forceBrief = args.includes('--force-brief');
  const missingOnly = args.includes('--missing-only');
  const concArg = args.find(a => a.startsWith('--concurrency='));
  // Default to concurrency=1 (single unified Stage-1 + paced Stage-2 process) so OverTheCap & X
  // never receive 4x simultaneous bursts from the same IP; callers can still pass --concurrency=N.
  const concurrency = Math.max(
    1,
    Math.min(6, Number(concArg ? concArg.split('=')[1] : process.env.TEAM_FETCH_CONCURRENCY || 1) || 1)
  );

  const teamsArg = args.find(a => a.startsWith('--teams=')) || args.find(a => a.startsWith('--team='));
  let targetTeams = ALL_NFL_TEAMS;
  if (teamsArg) {
    const rawList = teamsArg
      .replace(/^--teams?=/, '')
      .split(',')
      .map(s => s.trim())
      .filter(Boolean);
    targetTeams = rawList.map(resolveTeamConfig).filter(Boolean);
    if (targetTeams.length === 0) {
      throw new Error(`No valid NFL teams matched ${teamsArg}`);
    }
  }

  if (seasonalOnly) {
    console.log(`[all-32] Running fast synchronized seasonal/playoff resync for ${targetTeams.length} team(s)...`);
    const res = await syncAll32TeamsSeasonalPlayoffData({
      rootDir: ROOT,
      seasonYear: 2026,
      teams: targetTeams
    });
    console.log(
      `[all-32] Seasonal sync complete in ${(res.elapsedMs / 1000).toFixed(2)}s — ${res.teamsUpdated} teams synced to ${res.modelVersion} (${res.completedGames} completed / ${res.remainingGames} remaining, ${res.preseasonPriorsCount} priors, ${res.injuryAdjustmentsCount} injury profiles).`
    );
    return;
  }

  if (powerRankingsOnly) {
    await syncPowerRankingsAll32(targetTeams, 2026);
    return;
  }

  const fetchLiveScript = path.join(ROOT, 'scripts', 'fetch-live-data.mjs');

  if (sfFast) {
    console.log('[all-32:sf-fast] Step 1/2: Refreshing live 49ers feeds (data/*.json) via unified scripts/fetch-live-data.mjs...');
    await spawnNodeScript(fetchLiveScript, ['--teams=SF', ...(forceBrief ? ['--force-brief'] : [])], {
      label: 'fetch-live-data(SF)'
    });
    console.log('[all-32:sf-fast] Step 2/2: Syncing calibrated playoff seasonal.json across all 32 teams...');
    const res = await syncAll32TeamsSeasonalPlayoffData({
      rootDir: ROOT,
      seasonYear: 2026,
      teams: ALL_NFL_TEAMS
    });
    console.log(
      `[all-32:sf-fast] Done in ${((Date.now() - t0) / 1000).toFixed(1)}s (${res.teamsUpdated} teams synced to ${res.modelVersion}, ${res.completedGames} completed / ${res.remainingGames} remaining).`
    );
    return;
  }

  console.log(`[all-32] Step 1/2: Refreshing ${targetTeams.length} NFL franchise(s) identically via scripts/fetch-live-data.mjs...`);
  const extraArgs = [
    ...(forceBrief ? ['--force-brief'] : []),
    ...(missingOnly ? ['--missing-only'] : [])
  ];
  await runTeamsInParallelShards(targetTeams, { concurrency, extraArgs });

  console.log(`[all-32] Step 2/2: Running canonical synchronized 32-team seasonal/playoff pass (${targetTeams.length} teams)...`);
  const res = await syncAll32TeamsSeasonalPlayoffData({
    rootDir: ROOT,
    seasonYear: 2026,
    teams: targetTeams
  });
  console.log(
    `[all-32] All ${targetTeams.length} NFL team(s) refreshed & synchronized in ${((Date.now() - t0) / 1000).toFixed(1)}s — model=${res.modelVersion}, games=${res.completedGames}/${res.completedGames + res.remainingGames}.`
  );
}

main().catch(err => {
  console.error('[all-32] Pipeline failed:', err);
  process.exit(1);
});
