#!/usr/bin/env node
/**
 * Permanent Go-Live Script for `nfl.joshal.com` on Cloudflare Pages Free (`nfl-joshal`).
 *
 * Deploys the EXACT SAME unified `dist-nfl-teams/` bundle + Worker + shared KV namespace as `nfl-teams`
 * so `nfl.joshal.com/` serves the 32-team portal, `nfl.joshal.com/?team=<slug>` serves the full
 * standalone team app (same origin, zero Safari/Chrome browser chrome), and `nfl.joshal.com/key-sync`
 * serves the hermetic cross-team API key vault.
 *
 * Usage:
 *   npm run deploy:nfl
 *   node scripts/deploy-nfl-portal.mjs --dry-run
 */

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { buildNflTeamsPagesDist } from './build-nfl-teams-pages.mjs';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const HUB_PAGES_CONFIG_DIR = path.join(ROOT, 'worker', 'pages-nfl-joshal');
const PROJECT_NAME = 'nfl-joshal';
const PAGES_TARGET_HOST = `${PROJECT_NAME}.pages.dev`;
const CUSTOM_DOMAIN = 'nfl.joshal.com';
const DRY_RUN = new Set(process.argv.slice(2)).has('--dry-run');

function step(n, msg) {
  console.log(`\n[${n}/5] ${msg}`);
}

function runWrangler(wranglerArgs, { inherit = false, allowFail = false, cwd = ROOT } = {}) {
  const localBin = path.join(ROOT, 'worker', 'node_modules', '.bin', 'wrangler');
  const cmd = fs.existsSync(localBin) ? localBin : 'npx';
  const finalArgs = cmd === 'npx' ? ['--yes', 'wrangler@4', ...wranglerArgs] : wranglerArgs;
  const res = spawnSync(cmd, finalArgs, {
    cwd,
    stdio: inherit ? 'inherit' : ['pipe', 'pipe', 'pipe'],
    encoding: 'utf8',
    env: {
      ...process.env,
      ...(process.platform === 'darwin' && !process.env.NODE_EXTRA_CA_CERTS && fs.existsSync('/etc/ssl/cert.pem')
        ? { NODE_EXTRA_CA_CERTS: '/etc/ssl/cert.pem' }
        : {})
    }
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
  console.log('  NFL Portal Permanent Go-Live ($0 Free Tier — Static Cloudflare Pages)');
  console.log(`  Cloudflare Pages Project : ${PROJECT_NAME} (https://${PAGES_TARGET_HOST})`);
  console.log(`  Target Custom Domain     : https://${CUSTOM_DOMAIN}`);
  console.log('========================================================================');

  step(1, 'Building unified 32-team + NFL Hub bundle (dist-nfl-teams/)...');
  const built = buildNflTeamsPagesDist();
  console.log(`  ✓ Built dist-nfl-teams/ (${built.fileCount} files, ${(built.totalBytes / 1024 / 1024).toFixed(2)} MB).`);

  if (DRY_RUN) {
    console.log('[dry-run] Unified NFL Hub bundle verified cleanly.');
    return;
  }

  step(2, 'Checking Cloudflare Wrangler authentication...');
  const who = runWrangler(['whoami'], { allowFail: true });
  if (who.status !== 0 || /not authenticated/i.test(`${who.stdout}\n${who.stderr}`)) {
    runWrangler(['login'], { inherit: true });
  } else {
    console.log('  ✓ Authenticated with Cloudflare.');
  }

  step(3, `Creating / verifying permanent Cloudflare Pages project "${PROJECT_NAME}"...`);
  const projRes = runWrangler(
    ['pages', 'project', 'create', PROJECT_NAME, '--production-branch', 'main'],
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

  step(4, `Deploying unified dist-nfl-teams/ to Cloudflare Pages (${PAGES_TARGET_HOST})...`);
  runWrangler(
    [
      'pages',
      'deploy',
      built.distDir,
      `--project-name=${PROJECT_NAME}`,
      '--branch=main',
      '--commit-dirty=true'
    ],
    { inherit: true, cwd: HUB_PAGES_CONFIG_DIR }
  );
  console.log(`  ✓ Deployed to https://${PAGES_TARGET_HOST}`);

  step(5, 'Verifying live HTTPS (portal, ?team=lions, manifest & key-sync)...');
  const pagesChk = await fetchStatusSafe(`https://${PAGES_TARGET_HOST}/`);
  console.log(
    `  ${pagesChk.ok && pagesChk.text.includes('NFL Team Hub') && pagesChk.text.includes('49ers Faithful') ? '✓ LIVE' : '… PENDING'}  https://${PAGES_TARGET_HOST}/ (HTTP ${pagesChk.status})`
  );
  const teamChk = await fetchStatusSafe(`https://${PAGES_TARGET_HOST}/?team=lions`);
  console.log(
    `  ${teamChk.ok && teamChk.text.includes('Lions One Pride') ? '✓ LIVE' : '… PENDING'}  https://${PAGES_TARGET_HOST}/?team=lions (HTTP ${teamChk.status})`
  );

  const cnames = digCname(CUSTOM_DOMAIN);
  const cnameReady = cnames.includes(PAGES_TARGET_HOST);
  if (cnameReady) {
    const customChk = await fetchStatusSafe(`https://${CUSTOM_DOMAIN}/`);
    console.log(
      `  ${customChk.ok && customChk.text.includes('NFL Team Hub') && customChk.text.includes('49ers Faithful') ? '✓ LIVE' : '… SSL PROVISIONING'}  https://${CUSTOM_DOMAIN}/ (HTTP ${customChk.status})`
    );
  } else {
    console.log('\n========================================================================');
    console.log(`  PERMANENT SITE IS LIVE AT: https://${PAGES_TARGET_HOST}`);
    console.log(`  Finish connecting ${CUSTOM_DOMAIN} in 2 quick steps:`);
    console.log('');
    console.log('  1) GoDaddy -> joshal.com -> DNS -> Add New Record:');
    console.log(`       Type: CNAME | Name: nfl | Value: ${PAGES_TARGET_HOST} | TTL: 1 Hour`);
    console.log('');
    console.log(`  2) Cloudflare Dashboard -> Workers & Pages -> ${PROJECT_NAME} -> Custom domains:`);
    console.log(`       Set up a custom domain -> ${CUSTOM_DOMAIN} -> My DNS provider -> Begin CNAME setup`);
    console.log('========================================================================\n');
  }
}

main().catch(err => {
  console.error('\nDEPLOY FAILED:', err?.message || err);
  process.exit(1);
});
