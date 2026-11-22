#!/usr/bin/env node
/**
 * Option 1 One-Command Automated Go-Live Script for Cloudflare Pages + GoDaddy External DNS
 * (`lions.joshal.com` — Lions One Pride & `bills.joshal.com` — Bills Mafia).
 *
 * ZERO GODADDY NAMESERVER CHANGES:
 *   - Keeps `www.joshal.com` (SmugMug), `joshal.com`, `whisky.joshal.com`, `whiskey.joshal.com`,
 *     `email`/MX, `49ers.joshal.com`, and `workouts.joshal.com` 100% untouched on GoDaddy DNS!
 *
 * What this script automates end-to-end:
 *   1. Builds clean Cloudflare Pages bundle `dist-canary/` (`_worker.js` + `_routes.json` + assets)
 *   2. Checks / triggers Cloudflare OAuth login (`wrangler login`)
 *   3. Creates or reuses `NFL_SHARED_CACHE` KV namespace & auto-patches `worker/pages-canary/wrangler.toml`
 *   4. Creates or reuses `nfl-data-public` R2 bucket (Free Tier)
 *   5. Creates or verifies Cloudflare Pages project `nfl-hq-canary`
 *   6. Deploys `dist-canary/` to `https://nfl-hq-canary.pages.dev`
 *   7. Saves `GEMINI_NFL_API_KEY` encrypted secret on `nfl-hq-canary` (never written to disk)
 *   8. Uploads all 23 live 2026 JSON feeds for DET & BUF directly into R2 via wrangler OAuth
 *   9. Checks GoDaddy CNAMEs (`lions`, `bills`) + verifies live HTTPS on Lions, Bills, www, 49ers & workouts
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
const R2_BUCKET = 'nfl-data-public';
const KV_TITLE = 'NFL_SHARED_CACHE';

const args = new Set(process.argv.slice(2));
const DRY_RUN = args.has('--dry-run');
const SKIP_R2_UPLOAD = args.has('--skip-r2-upload');

function step(n, msg) {
  console.log(`\n[${n}/9] ${msg}`);
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

function walkJsonFiles(dir) {
  if (!fs.existsSync(dir)) return [];
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walkJsonFiles(abs));
    else if (entry.name.endsWith('.json')) out.push(abs);
  }
  return out;
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
  console.log('  NFL Canary Go-Live (Option 1: Cloudflare Pages + GoDaddy CNAMEs)');
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
    const workerOut = path.join(built.distDir, '_worker.js');
    const routesOut = path.join(built.distDir, '_routes.json');
    if (!fs.existsSync(workerOut) || !fs.existsSync(routesOut)) {
      throw new Error('Missing _worker.js or _routes.json in dist-canary/');
    }
    const jsonFiles = [
      ...walkJsonFiles(path.join(ROOT, 'data', 'league')),
      ...walkJsonFiles(path.join(ROOT, 'data', 'teams', 'lions')),
      ...walkJsonFiles(path.join(ROOT, 'data', 'teams', 'bills'))
    ];
    console.log(`[dry-run] Verified Pages bundle, _worker.js, _routes.json, and ${jsonFiles.length} R2 JSON feeds.`);
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
  step(3, `Provisioning / verifying KV namespace "${KV_TITLE}"...`);
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

  // 4. Provision / reuse R2 bucket `nfl-data-public`
  step(4, `Provisioning / verifying R2 bucket "${R2_BUCKET}"...`);
  const r2Res = runWrangler(['r2', 'bucket', 'create', R2_BUCKET], { allowFail: true });
  const r2Out = `${r2Res.stdout}\n${r2Res.stderr}`;
  if (r2Res.status === 0) {
    console.log(`  ✓ Created R2 bucket ${R2_BUCKET}.`);
  } else if (/already exists/i.test(r2Out)) {
    console.log(`  ✓ Reusing existing R2 bucket ${R2_BUCKET}.`);
  } else if (/enable r2/i.test(r2Out)) {
    console.error('\n  ONE-TIME CLICK NEEDED: Enable Cloudflare R2 (Free tier: 10 GB/mo free) once:');
    console.error('    https://dash.cloudflare.com -> R2 Object Storage -> click "Get Started" / Enable');
    console.error('  Then re-run `npm run deploy:canary`.');
    process.exit(3);
  } else {
    throw new Error(`R2 bucket check failed:\n${r2Out}`);
  }

  // 5. Create or verify Cloudflare Pages project `nfl-hq-canary`
  step(5, `Creating / verifying Cloudflare Pages project "${PROJECT_NAME}"...`);
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

  // 6. Deploy `dist-canary/` to Cloudflare Pages
  step(6, `Deploying dist-canary/ to Cloudflare Pages (${PAGES_TARGET_HOST})...`);
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

  // 7. Configure encrypted `GEMINI_NFL_API_KEY` secret on Cloudflare Pages
  step(7, `Checking GEMINI_NFL_API_KEY secret on Pages project "${PROJECT_NAME}"...`);
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

  // 8. Upload live 2026 JSON feeds directly into R2 via Wrangler OAuth
  step(8, `Uploading live 2026 JSON feeds to R2 bucket "${R2_BUCKET}"...`);
  if (SKIP_R2_UPLOAD) {
    console.log('  - Skipped R2 upload (--skip-r2-upload).');
  } else {
    const jsonFiles = [
      ...walkJsonFiles(path.join(ROOT, 'data', 'league')),
      ...walkJsonFiles(path.join(ROOT, 'data', 'teams', 'lions')),
      ...walkJsonFiles(path.join(ROOT, 'data', 'teams', 'bills'))
    ];
    let uploaded = 0;
    for (const abs of jsonFiles) {
      const key = path.relative(ROOT, abs).replace(/\\/g, '/');
      runWrangler([
        'r2',
        'object',
        'put',
        `${R2_BUCKET}/${key}`,
        '--file',
        abs,
        '--content-type',
        'application/json; charset=utf-8',
        '--remote'
      ]);
      uploaded += 1;
      process.stdout.write(`\r  Uploaded ${uploaded}/${jsonFiles.length} JSON files to R2...`);
    }
    console.log(`\n  ✓ Uploaded all ${uploaded} live JSON feeds to R2.`);
  }

  // 9. Check GoDaddy CNAMEs & verify live HTTPS sites (including untouched existing sites)
  step(9, 'Checking GoDaddy CNAMEs & verifying live HTTPS endpoints...');
  const lionsCname = digCname('lions.joshal.com');
  const billsCname = digCname('bills.joshal.com');
  const lionsLinked = lionsCname.includes(PAGES_TARGET_HOST);
  const billsLinked = billsCname.includes(PAGES_TARGET_HOST);

  const existingChecks = [
    { url: `https://${PAGES_TARGET_HOST}/api/health?team=lions`, expect: 'Lions One Pride' },
    { url: `https://${PAGES_TARGET_HOST}/api/health?team=bills`, expect: 'Bills Mafia' },
    { url: 'https://www.joshal.com/', expect: '' },
    { url: 'https://49ers.joshal.com/', expect: '49ers Faithful' },
    { url: 'https://workouts.joshal.com/', expect: '' }
  ];
  if (lionsLinked) {
    existingChecks.unshift({ url: 'https://lions.joshal.com/api/health', expect: 'Lions One Pride' });
  }
  if (billsLinked) {
    existingChecks.unshift({ url: 'https://bills.joshal.com/api/health', expect: 'Bills Mafia' });
  }

  for (const chk of existingChecks) {
    const res = await fetchStatusSafe(chk.url);
    const okLabel = res.ok && (!chk.expect || res.text.includes(chk.expect)) ? '✓ LIVE' : '… PENDING';
    console.log(`  ${okLabel}  ${chk.url} (HTTP ${res.status})`);
  }

  if (!lionsLinked || !billsLinked) {
    console.log('\n========================================================================');
    console.log('  CLOUDFLARE PAGES IS LIVE! Final 2-minute step to connect domains:');
    console.log('  (Your GoDaddy nameservers, SmugMug, whisky, email, 49ers & workouts stay untouched)');
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
    console.log('  GO-LIVE COMPLETE!');
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
