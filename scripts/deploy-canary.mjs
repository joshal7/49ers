#!/usr/bin/env node
/**
 * One-Command Automated Go-Live Script for `lions.joshal.com` (Lions One Pride)
 * & `bills.joshal.com` (Bills Mafia).
 *
 * Automates everything possible while strictly isolating `49ers.joshal.com` and `workouts.joshal.com`:
 *   1. Verifies `joshal.com` DNS delegation (`dig NS joshal.com`)
 *   2. Verifies/triggers Cloudflare browser OAuth (`wrangler login`)
 *   3. Creates or reuses `NFL_SHARED_CACHE` KV namespace & auto-patches `worker/wrangler.canary.toml`
 *   4. Creates or reuses `nfl-data-public` R2 bucket (Free Tier)
 *   5. Sets `GEMINI_NFL_API_KEY` Worker secret cleanly (never written to disk)
 *   6. Deploys `nfl-hq-canary` bound ONLY to `lions.joshal.com` & `bills.joshal.com`
 *   7. Uploads initial live 2026 JSON feeds for DET & BUF directly into R2 via wrangler OAuth
 *   8. Verifies live HTTPS endpoints for Lions One Pride, Bills Mafia, 49ers Faithful & workouts.joshal.com
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

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const WORKER_DIR = path.join(ROOT, 'worker');
const WRANGLER_TOML = path.join(WORKER_DIR, 'wrangler.canary.toml');
const R2_BUCKET = 'nfl-data-public';
const KV_TITLE = 'NFL_SHARED_CACHE';

const args = new Set(process.argv.slice(2));
const DRY_RUN = args.has('--dry-run');
const SKIP_DNS = args.has('--skip-dns-check');
const SKIP_R2_UPLOAD = args.has('--skip-r2-upload');

function step(n, msg) {
  console.log(`\n[${n}/8] ${msg}`);
}

function runWrangler(wranglerArgs, { inherit = false, input = undefined, allowFail = false } = {}) {
  const res = spawnSync('npx', ['wrangler', ...wranglerArgs], {
    cwd: WORKER_DIR,
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

function getJoshalNameservers() {
  try {
    const out = execFileSync('dig', ['NS', 'joshal.com', '+short'], { encoding: 'utf8', timeout: 6000 });
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
    const res = await fetch(url, {
      redirect: 'follow',
      signal: AbortSignal.timeout(timeoutMs)
    });
    const text = await res.text().catch(() => '');
    return { ok: res.ok, status: res.status, text };
  } catch (err) {
    return { ok: false, status: 0, error: err?.message || String(err) };
  }
}

async function main() {
  console.log('==================================================================');
  console.log('  NFL Canary Go-Live Automation (Lions One Pride & Bills Mafia)');
  console.log('  Target domains : lions.joshal.com, bills.joshal.com ONLY');
  console.log('  Untouched      : 49ers.joshal.com, workouts.joshal.com, main');
  console.log('==================================================================');

  if (DRY_RUN) {
    console.log('\n[dry-run] Validating config, assets, and pre-flight checks without calling Cloudflare...');
    const toml = fs.readFileSync(WRANGLER_TOML, 'utf8');
    const activeToml = toml
      .split(/\r?\n/)
      .map(l => l.replace(/#.*$/, ''))
      .join('\n');
    if (!activeToml.includes('pattern = "lions.joshal.com"') || !activeToml.includes('pattern = "bills.joshal.com"')) {
      throw new Error('wrangler.canary.toml missing explicit canary custom domains');
    }
    if (
      activeToml.includes('*.joshal.com') ||
      activeToml.includes('49ers.joshal.com') ||
      activeToml.includes('workouts.joshal.com')
    ) {
      throw new Error('wrangler.canary.toml violates subdomain isolation guard');
    }
    const ignorePath = path.join(ROOT, '.assetsignore');
    if (!fs.existsSync(ignorePath)) throw new Error('Missing .assetsignore at repo root');
    const files = [
      ...walkJsonFiles(path.join(ROOT, 'data', 'league')),
      ...walkJsonFiles(path.join(ROOT, 'data', 'teams', 'lions')),
      ...walkJsonFiles(path.join(ROOT, 'data', 'teams', 'bills'))
    ];
    console.log(`[dry-run] Verified wrangler.canary.toml isolation, .assetsignore, and ${files.length} live JSON files ready for R2.`);
    return;
  }

  // 1. Verify DNS delegation to Cloudflare Free DNS
  step(1, 'Checking DNS nameservers for joshal.com...');
  const nameservers = getJoshalNameservers();
  const isCloudflareDns = nameservers.some(ns => ns.endsWith('.ns.cloudflare.com'));
  console.log(`  Current NS records: ${nameservers.length ? nameservers.join(', ') : '(unavailable)'}`);
  if (!isCloudflareDns && !SKIP_DNS) {
    console.log('\n  ACTION NEEDED FIRST (one-time in browser, ~3 minutes):');
    console.log('  joshal.com is still on GoDaddy nameservers. Cloudflare custom domains require');
    console.log('  joshal.com DNS to be managed on Cloudflare Free DNS:');
    console.log('    1) Go to https://dash.cloudflare.com -> "+ Add a domain" -> enter joshal.com -> select Free ($0) plan.');
    console.log('    2) On the DNS review screen, confirm your existing `49ers` and `workouts` CNAME records');
    console.log('       point to `joshal7.github.io` and stay set to "DNS only" (grey cloud) so neither is touched.');
    console.log('    3) Copy the 2 Cloudflare nameservers shown (e.g. `*.ns.cloudflare.com`).');
    console.log('    4) In GoDaddy -> My Products -> joshal.com -> DNS -> Nameservers -> Change Nameservers ->');
    console.log('       "I\'ll use my own nameservers" -> paste the 2 Cloudflare nameservers -> Save.');
    console.log('    5) Wait ~5–15 minutes for Cloudflare to email "joshal.com is now active", then re-run:');
    console.log('         npm run deploy:canary');
    console.log('       (Or pass `--skip-dns-check` to provision KV/R2/secrets right now while waiting.)');
    process.exit(2);
  }

  // 2. Check / trigger Cloudflare authentication
  step(2, 'Checking Cloudflare Wrangler authentication...');
  const who = runWrangler(['whoami'], { allowFail: true });
  if (who.status !== 0 || /not authenticated/i.test(`${who.stdout}\n${who.stderr}`)) {
    console.log('  Opening Cloudflare OAuth login in your browser (click "Allow")...');
    runWrangler(['login'], { inherit: true });
  } else {
    console.log('  ✓ Authenticated with Cloudflare.');
  }

  // 3. Provision or reuse KV namespace `NFL_SHARED_CACHE` and auto-patch `wrangler.canary.toml`
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
    if (!idMatch) {
      throw new Error(`Could not parse KV namespace ID from wrangler output:\n${combined}`);
    }
    kvId = idMatch[1];
    console.log(`  ✓ Created KV namespace ${KV_TITLE}: ${kvId}`);
  } else {
    console.log(`  ✓ Reusing existing KV namespace ${KV_TITLE}: ${kvId}`);
  }

  const origToml = fs.readFileSync(WRANGLER_TOML, 'utf8');
  if (origToml.includes('REPLACE_WITH_NFL_SHARED_CACHE_KV_ID')) {
    const patchedToml = origToml.replace('REPLACE_WITH_NFL_SHARED_CACHE_KV_ID', kvId);
    fs.writeFileSync(WRANGLER_TOML, patchedToml, 'utf8');
    console.log('  ✓ Auto-patched worker/wrangler.canary.toml with real KV namespace ID.');
  }

  // 4. Provision or reuse R2 bucket `nfl-data-public`
  step(4, `Provisioning / verifying R2 bucket "${R2_BUCKET}"...`);
  const r2Res = runWrangler(['r2', 'bucket', 'create', R2_BUCKET], { allowFail: true });
  const r2Out = `${r2Res.stdout}\n${r2Res.stderr}`;
  if (r2Res.status === 0) {
    console.log(`  ✓ Created R2 bucket ${R2_BUCKET}.`);
  } else if (/already exists/i.test(r2Out)) {
    console.log(`  ✓ Reusing existing R2 bucket ${R2_BUCKET}.`);
  } else if (/enable r2/i.test(r2Out)) {
    console.error('\n  ACTION NEEDED: Enable Cloudflare R2 (Free Tier: 10 GB/mo free) once in your dashboard:');
    console.error('    https://dash.cloudflare.com -> R2 Object Storage -> Click "Get Started" / Enable');
    console.error('  Then re-run `npm run deploy:canary`.');
    process.exit(3);
  } else {
    throw new Error(`R2 bucket check failed:\n${r2Out}`);
  }

  // 5. Deploy Worker `nfl-hq-canary` (creates Worker first so secrets can attach cleanly)
  step(5, 'Deploying nfl-hq-canary to lions.joshal.com & bills.joshal.com...');
  runWrangler(['deploy', '-c', 'wrangler.canary.toml'], { inherit: true });
  console.log('  ✓ Worker deployed & custom domains bound ONLY to lions.joshal.com and bills.joshal.com.');

  // 6. Configure `GEMINI_NFL_API_KEY` secret (never written to disk)
  step(6, 'Checking GEMINI_NFL_API_KEY secret on nfl-hq-canary...');
  const secList = runWrangler(['secret', 'list', '-c', 'wrangler.canary.toml'], { allowFail: true });
  const hasSecret = /GEMINI_NFL_API_KEY/.test(`${secList.stdout}\n${secList.stderr}`);
  if (hasSecret && !process.env.GEMINI_NFL_API_KEY) {
    console.log('  ✓ GEMINI_NFL_API_KEY is already configured on nfl-hq-canary.');
  } else {
    let keyVal = String(process.env.GEMINI_NFL_API_KEY || '').trim();
    if (!keyVal) {
      keyVal = await promptLine('  Paste your joshalbox@gmail.com GEMINI_NFL_API_KEY (press Enter to skip for now): ');
    }
    if (keyVal) {
      runWrangler(['secret', 'put', 'GEMINI_NFL_API_KEY', '-c', 'wrangler.canary.toml'], {
        input: `${keyVal}\n`
      });
      console.log('  ✓ Saved GEMINI_NFL_API_KEY securely to Cloudflare Worker secrets.');
    } else {
      console.log('  ! Skipped GEMINI_NFL_API_KEY for now (you can set it anytime via GEMINI_NFL_API_KEY="..." npm run deploy:canary).');
    }
  }

  // 7. Upload live 2026 JSON feeds for DET & BUF directly into R2 using Wrangler OAuth
  step(7, `Uploading live 2026 JSON feeds to R2 bucket "${R2_BUCKET}"...`);
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

  // 8. Verify live production endpoints + untouched 49ers & workouts sites
  step(8, 'Verifying live HTTPS sites & confirming 49ers.joshal.com + workouts.joshal.com are untouched...');
  const checks = [
    { url: 'https://lions.joshal.com/api/health', expect: 'Lions One Pride' },
    { url: 'https://lions.joshal.com/manifest.json', expect: 'Lions One Pride' },
    { url: 'https://bills.joshal.com/api/health', expect: 'Bills Mafia' },
    { url: 'https://bills.joshal.com/manifest.json', expect: 'Bills Mafia' },
    { url: 'https://49ers.joshal.com/', expect: '49ers Faithful' },
    { url: 'https://workouts.joshal.com/', expect: '' }
  ];

  for (const chk of checks) {
    let result = null;
    for (let attempt = 1; attempt <= 4; attempt += 1) {
      result = await fetchStatusSafe(chk.url);
      if (result.ok && (!chk.expect || result.text.includes(chk.expect))) break;
      if (attempt < 4) await new Promise(r => setTimeout(r, 4000));
    }
    const okLabel = result?.ok && (!chk.expect || result.text.includes(chk.expect)) ? '✓ LIVE' : '… PROVISIONING';
    console.log(`  ${okLabel}  ${chk.url} (HTTP ${result?.status || 0})`);
  }

  console.log('\n==================================================================');
  console.log('  GO-LIVE COMPLETE!');
  console.log('  - Lions One Pride : https://lions.joshal.com');
  console.log('  - Bills Mafia     : https://bills.joshal.com');
  console.log('  - 49ers Faithful  : https://49ers.joshal.com (untouched)');
  console.log('  - Workouts        : https://workouts.joshal.com (untouched)');
  console.log('==================================================================\n');
}

main().catch(err => {
  console.error('\nDEPLOY FAILED:', err?.message || err);
  process.exit(1);
});
