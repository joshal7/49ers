#!/usr/bin/env node
/**
 * One-Command Card-Free Production Deployment for ALL 32 NFL Team Sites (`nfl-teams.pages.dev`).
 *
 * Usage:
 *   NODE_EXTRA_CA_CERTS=/etc/ssl/cert.pem node scripts/deploy-nfl-teams.mjs
 *   NODE_EXTRA_CA_CERTS=/etc/ssl/cert.pem GEMINI_NFL_API_KEY="..." node scripts/deploy-nfl-teams.mjs
 *
 * Options:
 *   --skip-fetch   Deploy existing `data/` and `data/teams/*` without re-fetching feeds
 */

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { buildNflTeamsPagesDist } from './build-nfl-teams-pages.mjs';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const WORKER_DIR = path.join(ROOT, 'worker');
const PAGES_CONFIG_DIR = path.join(ROOT, 'worker', 'pages-nfl-teams');
const HUB_PAGES_CONFIG_DIR = path.join(ROOT, 'worker', 'pages-nfl-joshal');
const PROJECT_NAME = 'nfl-teams';
const HUB_PROJECT_NAME = 'nfl-joshal';
const PAGES_TARGET_HOST = `${PROJECT_NAME}.pages.dev`;
const HUB_TARGET_HOST = `${HUB_PROJECT_NAME}.pages.dev`;

const WRANGLER_BIN = fs.existsSync(path.join(WORKER_DIR, 'node_modules', '.bin', 'wrangler'))
  ? path.join(WORKER_DIR, 'node_modules', '.bin', 'wrangler')
  : 'npx';

const BASE_ENV = {
  ...process.env,
  ...(process.platform === 'darwin' && !process.env.NODE_EXTRA_CA_CERTS && fs.existsSync('/etc/ssl/cert.pem')
    ? { NODE_EXTRA_CA_CERTS: '/etc/ssl/cert.pem' }
    : {})
};

function run(cmd, args, opts = {}) {
  const res = spawnSync(cmd, args, {
    cwd: opts.cwd || ROOT,
    env: BASE_ENV,
    stdio: opts.capture ? ['pipe', 'pipe', 'pipe'] : 'inherit',
    input: opts.input,
    encoding: 'utf8'
  });
  return res;
}

function wranglerArgs(args) {
  return WRANGLER_BIN === 'npx' ? ['--yes', 'wrangler@4', ...args] : args;
}

async function main() {
  const skipFetch = process.argv.includes('--skip-fetch');
  const geminiKey = String(process.env.GEMINI_NFL_API_KEY || '').trim();

  console.log('\n================================================================');
  console.log('  ALL-32-TEAM NFL DEPLOYMENT (100% CARD-FREE CLOUDFLARE PAGES)');
  console.log(`  Project : ${PROJECT_NAME} (${PAGES_TARGET_HOST})`);
  console.log('  Mode    : Pages Free + KV Free (ZERO R2, GoDaddy DNS untouched)');
  console.log('================================================================\n');

  if (!skipFetch) {
    console.log('[1/4] Fetching fresh live 2026 data for all 31 non-SF teams...');
    const fetchRes = run(process.execPath, [path.join(ROOT, 'scripts', 'fetch-team-data.mjs'), '--all']);
    if (fetchRes.status !== 0) {
      console.error('Data fetch failed. Fix errors above and retry.');
      process.exit(1);
    }
  } else {
    console.log('[1/4] Skipping live data fetch (--skip-fetch).');
  }

  console.log('\n[2/4] Building dist-nfl-teams/ bundle for all 32 NFL teams...');
  const built = buildNflTeamsPagesDist();
  console.log(
    `      Built ${built.fileCount} files (${(built.totalBytes / 1024 / 1024).toFixed(2)} MB) for ${built.teamCount} teams.`
  );

  console.log(`\n[3/5] Deploying dist-nfl-teams/ to Cloudflare Pages (${PROJECT_NAME} — all 32 team subdomains)...`);
  const dep = run(
    WRANGLER_BIN,
    wranglerArgs([
      'pages',
      'deploy',
      built.distDir,
      `--project-name=${PROJECT_NAME}`,
      '--branch=main',
      '--commit-dirty=true'
    ]),
    { cwd: PAGES_CONFIG_DIR }
  );
  if (dep.status !== 0) {
    console.error('Cloudflare Pages deploy failed (nfl-teams).');
    process.exit(1);
  }

  console.log(`\n[4/5] Deploying identical dist-nfl-teams/ to Cloudflare Pages (${HUB_PROJECT_NAME} — nfl.joshal.com)...`);
  const hubDep = run(
    WRANGLER_BIN,
    wranglerArgs([
      'pages',
      'deploy',
      built.distDir,
      `--project-name=${HUB_PROJECT_NAME}`,
      '--branch=main',
      '--commit-dirty=true'
    ]),
    { cwd: HUB_PAGES_CONFIG_DIR }
  );
  if (hubDep.status !== 0) {
    console.error('Cloudflare Pages deploy failed (nfl-joshal).');
    process.exit(1);
  }

  if (geminiKey) {
    console.log('\n[5/5] Syncing GEMINI_NFL_API_KEY secret to Cloudflare Pages (nfl-teams + nfl-joshal)...');
    for (const [proj, cfgDir] of [
      [PROJECT_NAME, PAGES_CONFIG_DIR],
      [HUB_PROJECT_NAME, HUB_PAGES_CONFIG_DIR]
    ]) {
      const sec = run(
        WRANGLER_BIN,
        wranglerArgs(['pages', 'secret', 'put', 'GEMINI_NFL_API_KEY', `--project-name=${proj}`]),
        { cwd: cfgDir, input: geminiKey + '\n', capture: true }
      );
      if (sec.status === 0) {
        console.log(`      GEMINI_NFL_API_KEY secret saved securely on ${proj}.`);
      } else {
        console.warn(`      Warning (${proj}): secret put returned non-zero:`, (sec.stderr || sec.stdout || '').trim());
      }
    }
  } else {
    console.log('\n[5/5] GEMINI_NFL_API_KEY not passed in env — keeping existing Cloudflare secrets unchanged.');
  }

  console.log('\nSmoke-testing nfl-teams.pages.dev & nfl-joshal.pages.dev across sample franchises...');
  for (const slug of ['49ers', 'lions', 'bills', 'chiefs', 'eagles', 'vikings']) {
    try {
      const r = await fetch(`https://${PAGES_TARGET_HOST}/api/health?team=${slug}`, {
        signal: AbortSignal.timeout(9000)
      });
      const j = r.ok ? await r.json() : null;
      console.log(`  - nfl-teams  ?team=${slug.padEnd(8)} : HTTP ${r.status} | ${j?.brandName || 'ERR'} (${j?.shortTitle || '?'})`);
    } catch (e) {
      console.log(`  - nfl-teams  ?team=${slug.padEnd(8)} : ERROR ${e.message}`);
    }
  }
  for (const [label, urlPath] of [
    ['portal /', '/'],
    ['hub 49ers', '/?team=49ers'],
    ['hub lions', '/?team=lions'],
    ['hub bills', '/?team=bills'],
    ['manifest', '/manifest.json'],
    ['key-sync', '/key-sync']
  ]) {
    try {
      const r = await fetch(`https://${HUB_TARGET_HOST}${urlPath}`, {
        redirect: 'manual',
        signal: AbortSignal.timeout(9000)
      });
      console.log(`  - nfl-joshal ${label.padEnd(14)} : HTTP ${r.status}`);
    } catch (e) {
      console.log(`  - nfl-joshal ${label.padEnd(14)} : ERROR ${e.message}`);
    }
  }
  console.log('\nDone!\n');
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
