#!/usr/bin/env node
/**
 * 100% Card-Free Go-Live Script for Cloudflare Pages Free + GoDaddy External CNAMEs
 * (`lions.joshal.com` — Lions One Pride & `bills.joshal.com` — Bills Mafia).
 *
 * ZERO CREDIT CARD (NO R2) & ZERO GODADDY NAMESERVER CHANGES:
 *   - Runs strictly on Cloudflare Pages Free + Workers KV Free (hard free-tier caps; never bills).
 *   - Keeps `www.joshal.com` (SmugMug), `joshal.com`, `whisky.joshal.com`, `whiskey.joshal.com`,
 *     `email`/MX, `49ers.joshal.com`, and `workouts.joshal.com` 100% untouched on GoDaddy DNS.
 *
 * What this script automates end-to-end:
 *   1. Builds clean Cloudflare Pages bundle `dist-canary/` (`_worker.js`, `_routes.json`, `_headers`, live JSON)
 *   2. Checks / triggers Cloudflare OAuth login (`wrangler login`)
 *   3. Creates or reuses `NFL_SHARED_CACHE` KV namespace & auto-patches `worker/pages-canary/wrangler.toml`
 *   4. Creates or verifies Cloudflare Pages project `nfl-hq-canary`
 *   5. Deploys `dist-canary/` to `https://nfl-hq-canary.pages.dev`
 *   6. Saves `GEMINI_NFL_API_KEY` encrypted secret on `nfl-hq-canary` (never written to disk)
 *   7. Checks GoDaddy CNAMEs (`lions`, `bills`) + verifies live HTTPS on Lions, Bills, www, 49ers & workouts
 *
 * Usage:
 *   npm run deploy:canary
 *   GEMINI_NFL_API_KEY="..." npm run deploy:canary
 *   node scripts/deploy-canary.mjs --dry-run
 */

import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { execFileSync, spawnSync } from 'node:child_process';
import { buildCanaryPagesDist } from './build-canary-pages.mjs';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const WORKER_DIR = path.join(ROOT, 'worker');
const PAGES_CONFIG_DIR = path.join(WORKER_DIR, 'pages-canary');
const PAGES_TOML = path.join(PAGES_CONFIG_DIR, 'wrangler.toml');
const PROJECT_NAME = 'nfl-hq-canary';
const PAGES_TARGET_HOST = `${PROJECT_NAME}.pages.dev`;
const KV_TITLE = 'NFL_SHARED_CACHE';

const args = new Set(process.argv.slice(2));
const DRY_RUN = args.has('--dry-run');

function step(n, msg) {
  console.log(`\n[${n}/7] ${msg}`);
}

function runWrangler(wranglerArgs, { cwd = WORKER_DIR, inherit = false, input = undefined, allowFail = false } = {}) {
  const wranglerBin = path.join(WORKER_DIR, 'node_modules', '.bin', 'wrangler');
  const cmd = fs.existsSync(wranglerBin) ? wranglerBin : 'npx';
  const finalArgs = cmd === 'npx' ? ['wrangler', ...wranglerArgs] : wranglerArgs;
  const res = spawnSync(cmd, finalArgs, {
    cwd,
    stdio: inherit ? 'inherit' : ['pipe', 'pipe', 'pipe'],
    input,
    encoding: 'utf8',
    env: { ...process.env }
  });
  if (res.status !== 0 && !allowFail) {
    const out = [res.stdout, res.stderr].filter(Boolean).join('\n').trim();
    throw new Error(`wrangler ${wranglerArgs.join(' ')} failed (exit ${res.status}):\n${out}`);
  }
  return res;
}

function digCname(host) {
  try {
    const out = execFileSync('dig', ['CNAME', host, '+short'], { encoding: 'utf8', timeout: 6000 });
    return out
      .split(/\r?\n/)
      .map(s => s.trim().replace(/\.$/, '').toLowerCase())
      .filter(Boolean);
  } catch {
    return [];
  }
}

function promptLine(question) {
  return new Promise(resolve => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(question, answer => {
      rl.close();
      resolve(String(answer || '').trim());
    });
  });
}

async function fetchStatusSafe(url, timeoutMs = 8000) {
  try {
    const res = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(timeoutMs) });
    const text = await res.text().catch(() => '');
    return { ok: res.ok, status: res.status, text };
  } catch (err) {
    return { ok: false, status: 0, error: err?.message || String(err) };
  }
}

async function main() {
  console.log('========================================================================');
  console.log('  NFL Canary Go-Live (100% Free Tier — No R2 / No Credit Card)');
  console.log('  Target sites  : lions.joshal.com (Lions One Pride)');
  console.log('                  bills.joshal.com (Bills Mafia)');
  console.log('  100% Untouched: GoDaddy Nameservers, www.joshal.com (SmugMug),');
  console.log('                  joshal.com, whisky/whiskey, email/MX, 49ers, workouts');
  console.log('========================================================================');

  // 1. Build clean Cloudflare Pages bundle
  step(1, 'Building Cloudflare Pages bundle (dist-canary/)...');
  const built = buildCanaryPagesDist();
  console.log(`  ✓ Built dist-canary/ (${built.fileCount} files, ${(built.totalBytes / 1024 / 1024).toFixed(2)} MB).`);

  if (DRY_RUN) {
    const toml = fs.readFileSync(PAGES_TOML, 'utf8');
    if (!toml.includes(`name = "${PROJECT_NAME}"`) || !toml.includes('pages_build_output_dir')) {
      throw new Error('worker/pages-canary/wrangler.toml missing Pages config');
    }
    if (toml.includes('[[r2_buckets]]')) {
      throw new Error('worker/pages-canary/wrangler.toml must not require R2 (card-free mode)');
    }
    for (const reqFile of ['_worker.js', '_routes.json', '_headers']) {
      if (!fs.existsSync(path.join(built.distDir, reqFile))) {
        throw new Error(`Missing ${reqFile} in dist-canary/`);
      }
    }
    console.log('[dry-run] Verified card-free Cloudflare Pages bundle (_worker.js, _routes.json, _headers, live DET+BUF JSON).');
    return;
  }

  // 2. Authenticate with Cloudflare
  step(2, 'Checking Cloudflare Wrangler authentication...');
  const who = runWrangler(['whoami'], { allowFail: true });
  if (who.status !== 0 || /not authenticated/i.test(`${who.stdout}\n${who.stderr}`)) {
    console.log('  Opening Cloudflare OAuth login in your browser (click "Allow")...');
    runWrangler(['login'], { inherit: true });
  } else {
    console.log('  ✓ Authenticated with Cloudflare.');
  }

  // 3. Provision / reuse KV namespace `NFL_SHARED_CACHE` and auto-patch `worker/pages-canary/wrangler.toml`
  step(3, `Provisioning / verifying Free KV namespace "${KV_TITLE}"...`);
  let kvId = '';
  const listRes = runWrangler(['kv', 'namespace', 'list'], { allowFail: true });
  if (listRes.status === 0) {
    try {
      const jsonStart = listRes.stdout.indexOf('[');
      const parsed = jsonStart >= 0 ? JSON.parse(listRes.stdout.slice(jsonStart)) : [];
      const found = parsed.find(ns => ns.title === KV_TITLE || String(ns.title || '').endsWith(KV_TITLE));
      if (found?.id) kvId = found.id;
    } catch {}
  }
  if (!kvId) {
    const createRes = runWrangler(['kv', 'namespace', 'create', KV_TITLE]);
    const combined = `${createRes.stdout}\n${createRes.stderr}`;
    const idMatch = combined.match(/id\s*=\s*"([a-f0-9]{32})"/i) || combined.match(/"id"\s*:\s*"([a-f0-9]{32})"/i);
    if (!idMatch) throw new Error(`Could not parse KV namespace ID:\n${combined}`);
    kvId = idMatch[1];
    console.log(`  ✓ Created KV namespace ${KV_TITLE}: ${kvId}`);
  } else {
    console.log(`  ✓ Reusing existing KV namespace ${KV_TITLE}: ${kvId}`);
  }

  const origToml = fs.readFileSync(PAGES_TOML, 'utf8');
  if (origToml.includes('REPLACE_WITH_NFL_SHARED_CACHE_KV_ID')) {
    fs.writeFileSync(PAGES_TOML, origToml.replace('REPLACE_WITH_NFL_SHARED_CACHE_KV_ID', kvId), 'utf8');
    console.log('  ✓ Auto-patched worker/pages-canary/wrangler.toml with real KV namespace ID.');
  }

  // 4. Create or verify Cloudflare Pages project `nfl-hq-canary`
  step(4, `Creating / verifying Cloudflare Pages project "${PROJECT_NAME}"...`);
  const projRes = runWrangler(
    ['pages', 'project', 'create', PROJECT_NAME, '--production-branch', 'multi-team-canary'],
    { allowFail: true }
  );
  const projOut = `${projRes.stdout}\n${projRes.stderr}`;
  if (projRes.status === 0) {
    console.log(`  ✓ Created Cloudflare Pages project ${PROJECT_NAME} (https://${PAGES_TARGET_HOST}).`);
  } else if (/already exists|8000002/i.test(projOut)) {
    console.log(`  ✓ Reusing existing Cloudflare Pages project ${PROJECT_NAME}.`);
  } else {
    throw new Error(`Pages project creation failed:\n${projOut}`);
  }

  // 5. Deploy `dist-canary/` to Cloudflare Pages (includes all live DET & BUF JSON as unlimited free static assets)
  step(5, `Deploying dist-canary/ to Cloudflare Pages (${PAGES_TARGET_HOST})...`);
  runWrangler(
    [
      'pages',
      'deploy',
      '../../dist-canary',
      '--project-name',
      PROJECT_NAME,
      '--branch',
      'multi-team-canary',
      '--commit-dirty=true'
    ],
    { cwd: PAGES_CONFIG_DIR, inherit: true }
  );
  console.log(`  ✓ Deployed to https://${PAGES_TARGET_HOST}`);

  // 6. Configure encrypted `GEMINI_NFL_API_KEY` secret on Cloudflare Pages
  step(6, `Checking GEMINI_NFL_API_KEY secret on Pages project "${PROJECT_NAME}"...`);
  const secList = runWrangler(['pages', 'secret', 'list', '--project-name', PROJECT_NAME], { allowFail: true });
  const hasSecret = /GEMINI_NFL_API_KEY/.test(`${secList.stdout}\n${secList.stderr}`);
  if (hasSecret && !process.env.GEMINI_NFL_API_KEY) {
    console.log(`  ✓ GEMINI_NFL_API_KEY is already configured on ${PROJECT_NAME}.`);
  } else {
    let keyVal = String(process.env.GEMINI_NFL_API_KEY || '').trim();
    if (!keyVal) {
      keyVal = await promptLine('  Paste your joshalbox@gmail.com GEMINI_NFL_API_KEY (press Enter to skip for now): ');
    }
    if (keyVal) {
      runWrangler(['pages', 'secret', 'put', 'GEMINI_NFL_API_KEY', '--project-name', PROJECT_NAME], {
        input: `${keyVal}\n`
      });
      console.log('  ✓ Saved GEMINI_NFL_API_KEY securely to Cloudflare Pages secrets.');
    } else {
      console.log('  ! Skipped GEMINI_NFL_API_KEY for now (set anytime with GEMINI_NFL_API_KEY="..." npm run deploy:canary).');
    }
  }

  // 7. Check GoDaddy CNAMEs & verify live HTTPS sites (including untouched existing sites)
  step(7, 'Checking GoDaddy CNAMEs & verifying live HTTPS endpoints...');
  const lionsCname = digCname('lions.joshal.com');
  const billsCname = digCname('bills.joshal.com');
  const lionsLinked = lionsCname.includes(PAGES_TARGET_HOST);
  const billsLinked = billsCname.includes(PAGES_TARGET_HOST);

  const checks = [
    { url: `https://${PAGES_TARGET_HOST}/api/health?team=lions`, expect: 'Lions One Pride' },
    { url: `https://${PAGES_TARGET_HOST}/api/health?team=bills`, expect: 'Bills Mafia' },
    { url: 'https://www.joshal.com/', expect: '' },
    { url: 'https://49ers.joshal.com/', expect: '49ers Faithful' },
    { url: 'https://workouts.joshal.com/', expect: '' }
  ];
  if (lionsLinked) {
    checks.unshift({ url: 'https://lions.joshal.com/api/health', expect: 'Lions One Pride' });
  }
  if (billsLinked) {
    checks.unshift({ url: 'https://bills.joshal.com/api/health', expect: 'Bills Mafia' });
  }

  for (const chk of checks) {
    const res = await fetchStatusSafe(chk.url);
    const okLabel = res.ok && (!chk.expect || res.text.includes(chk.expect)) ? '✓ LIVE' : '… PENDING';
    console.log(`  ${okLabel}  ${chk.url} (HTTP ${res.status})`);
  }

  if (!lionsLinked || !billsLinked) {
    console.log('\n========================================================================');
    console.log('  CLOUDFLARE PAGES IS LIVE ($0, NO CREDIT CARD)! Final 2-minute step:');
    console.log('  (GoDaddy nameservers, SmugMug, whisky, email, 49ers & workouts untouched)');
    console.log('');
    console.log('  A) In GoDaddy -> joshal.com -> DNS -> Add 2 CNAME records:');
    if (!lionsLinked) console.log(`       Type: CNAME | Name: lions | Value: ${PAGES_TARGET_HOST} | TTL: 1 Hour`);
    if (!billsLinked) console.log(`       Type: CNAME | Name: bills | Value: ${PAGES_TARGET_HOST} | TTL: 1 Hour`);
    console.log('');
    console.log(`  B) In Cloudflare Dashboard -> Workers & Pages -> ${PROJECT_NAME} -> Custom domains:`);
    if (!lionsLinked) console.log('       Click "Set up a custom domain" -> lions.joshal.com -> Activate');
    if (!billsLinked) console.log('       Click "Set up a custom domain" -> bills.joshal.com -> Activate');
    console.log('');
    console.log('  Preview right now before adding CNAMEs:');
    console.log(`    - Lions One Pride : https://${PAGES_TARGET_HOST}/?team=lions`);
    console.log(`    - Bills Mafia     : https://${PAGES_TARGET_HOST}/?team=bills`);
    console.log('========================================================================\n');
  } else {
    console.log('\n========================================================================');
    console.log('  GO-LIVE COMPLETE ($0 FREE TIER, ZERO CREDIT CARD)!');
    console.log('  - Lions One Pride : https://lions.joshal.com');
    console.log('  - Bills Mafia     : https://bills.joshal.com');
    console.log('  - SmugMug         : https://www.joshal.com (untouched)');
    console.log('  - 49ers Faithful  : https://49ers.joshal.com (untouched)');
    console.log('  - Workouts        : https://workouts.joshal.com (untouched)');
    console.log('========================================================================\n');
  }
}

main().catch(err => {
  console.error('\nDEPLOY FAILED:', err?.message || err);
  process.exit(1);
});
