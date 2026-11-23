#!/usr/bin/env node
/**
 * Builds the clean Cloudflare Pages Advanced Mode bundle (`dist-nfl-teams/`)
 * for ALL 32 NFL franchise sites (`49ers.joshal.com` through `vikings.joshal.com`).
 *
 * Includes the clean static PWA shell, `src/`, ALL 32 team icon assets, ALL 32 live team
 * JSON feeds (`data/*.json` for 49ers + `data/teams/{slug}/*.json` for all 31 other teams),
 * `_worker.js` (rewritten import paths from `worker/nfl-teams-worker.js`), `_routes.json`,
 * and `_headers` so static JS/CSS/images AND `/data/*` JSON bypass Functions (unlimited free CDN!).
 */

import fs from 'node:fs';
import path from 'node:path';
import { ALL_NFL_TEAMS } from '../src/config/teamRegistry.js';
import { buildKeySyncCspHeader } from '../src/services/sharedApiKeyStore.js';
import { writeNflPortalAssetsToDir } from './build-nfl-portal.mjs';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const DIST = path.join(ROOT, 'dist-nfl-teams');

function copyRecursive(src, dest, { minifyJson = false } = {}) {
  if (!fs.existsSync(src)) return;
  const stat = fs.statSync(src);
  if (stat.isDirectory()) {
    fs.mkdirSync(dest, { recursive: true });
    for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
      if (entry.name === '.DS_Store') continue;
      copyRecursive(path.join(src, entry.name), path.join(dest, entry.name), { minifyJson });
    }
  } else {
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    if (minifyJson && dest.endsWith('.json')) {
      try {
        const parsed = JSON.parse(fs.readFileSync(src, 'utf8'));
        fs.writeFileSync(dest, JSON.stringify(parsed), 'utf8');
        return;
      } catch {}
    }
    fs.copyFileSync(src, dest);
  }
}

export function buildNflTeamsPagesDist() {
  fs.rmSync(DIST, { recursive: true, force: true });
  fs.mkdirSync(DIST, { recursive: true });

  // 1. Core PWA shell files
  for (const rel of ['index.html', 'manifest.json', 'sw.js', 'apple-touch-icon.png']) {
    copyRecursive(path.join(ROOT, rel), path.join(DIST, rel));
  }

  // 2. Shared frontend modules & ALL 32 team assets
  copyRecursive(path.join(ROOT, 'src'), path.join(DIST, 'src'));
  for (const sfAsset of ['sf-crest.svg', 'app-icon.svg']) {
    copyRecursive(path.join(ROOT, 'assets', sfAsset), path.join(DIST, 'assets', sfAsset));
  }
  const nonSfTeams = ALL_NFL_TEAMS.filter(t => t.abbr !== 'SF');
  for (const team of nonSfTeams) {
    copyRecursive(path.join(ROOT, 'assets', 'teams', team.slug), path.join(DIST, 'assets', 'teams', team.slug));
  }

  // 3. 49ers live JSON data + studio `.m4a` podcasts + league data + ALL 31 non-SF team JSON feeds (minified for fast mobile loads)
  const rootDataDir = path.join(ROOT, 'data');
  for (const entry of fs.readdirSync(rootDataDir, { withFileTypes: true })) {
    if (entry.isFile() && entry.name.endsWith('.json')) {
      copyRecursive(path.join(rootDataDir, entry.name), path.join(DIST, 'data', entry.name), { minifyJson: true });
    }
  }
  copyRecursive(path.join(rootDataDir, 'podcasts'), path.join(DIST, 'data', 'podcasts'), { minifyJson: true });
  copyRecursive(path.join(rootDataDir, 'league'), path.join(DIST, 'data', 'league'), { minifyJson: true });
  for (const team of nonSfTeams) {
    copyRecursive(path.join(rootDataDir, 'teams', team.slug), path.join(DIST, 'data', 'teams', team.slug), { minifyJson: true });
  }

  // 3b. Unified NFL Team Hub Portal (`nfl.joshal.com`) assets + hermetic `/key-sync.html` vault
  //     Shipped inside the exact same bundle so `nfl.joshal.com` and all 32 `<team>.joshal.com` hosts
  //     always run the identical codebase, live data, and Edge Worker with zero drift.
  writeNflPortalAssetsToDir(DIST, {
    portalHtmlFilename: 'nfl-portal.html',
    appleTouchIconFilename: 'nfl-apple-touch-icon.png',
    writeManifestAndHeaders: false
  });

  // 4. Cloudflare Pages Advanced Mode `_worker.js` (rewriting `../src/` -> `./src/`)
  const workerSrc = fs.readFileSync(path.join(ROOT, 'worker', 'nfl-teams-worker.js'), 'utf8');
  const pagesWorkerSrc = workerSrc.replace(/from\s+['"]\.\.\/src\//g, "from './src/");
  fs.writeFileSync(path.join(DIST, '_worker.js'), pagesWorkerSrc, 'utf8');

  // 5. `_routes.json` so static JS/CSS/images AND `/data/*` JSON bypass Functions (unlimited free static CDN!)
  const routesJson = {
    version: 1,
    include: ['/', '/index.html', '/manifest.json', '/apple-touch-icon.png', '/key-sync', '/key-sync.html', '/api/*'],
    exclude: []
  };
  fs.writeFileSync(path.join(DIST, '_routes.json'), JSON.stringify(routesJson, null, 2) + '\n', 'utf8');

  // 6. `_headers` for fresh 60s JSON caching + CORS on `/data/*`, portal icons caching & defense-in-depth key-sync CSP
  const keySyncCsp = buildKeySyncCspHeader();
  const headersTxt = [
    '/data/*',
    '  Cache-Control: public, max-age=60, stale-while-revalidate=300',
    '  Access-Control-Allow-Origin: *',
    '',
    '/icons/*',
    '  Cache-Control: public, max-age=86400, stale-while-revalidate=604800',
    '',
    '/key-sync',
    `  Content-Security-Policy: ${keySyncCsp}`,
    '  Cache-Control: public, max-age=300, stale-while-revalidate=3600',
    '',
    '/key-sync.html',
    `  Content-Security-Policy: ${keySyncCsp}`,
    '  Cache-Control: public, max-age=300, stale-while-revalidate=3600',
    ''
  ].join('\n');
  fs.writeFileSync(path.join(DIST, '_headers'), headersTxt, 'utf8');

  let fileCount = 0;
  let totalBytes = 0;
  const walk = d => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else {
        fileCount += 1;
        totalBytes += fs.statSync(p).size;
      }
    }
  };
  walk(DIST);
  return { distDir: DIST, fileCount, totalBytes, teamCount: ALL_NFL_TEAMS.length };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const res = buildNflTeamsPagesDist();
  console.log(
    `[build:nfl-teams] Built dist-nfl-teams/ for all ${res.teamCount} NFL teams (${res.fileCount} files, ${(res.totalBytes / 1024 / 1024).toFixed(2)} MB) ready for Cloudflare Pages.`
  );
}
