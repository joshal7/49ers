#!/usr/bin/env node
/**
 * Builds the clean Cloudflare Pages Advanced Mode bundle (`dist-canary/`)
 * for `lions.joshal.com` (Lions One Pride) & `bills.joshal.com` (Bills Mafia).
 *
 * Includes ONLY the clean static PWA shell, `src/`, canary team assets, canary JSON feeds,
 * `_worker.js` (rewritten import paths from `worker/canary-worker.js`), and `_routes.json`
 * so static JS/CSS/SVG/PNG are served from Cloudflare Pages CDN with 0 Functions invocations.
 */

import fs from 'node:fs';
import path from 'node:path';
import { CANARY_TEAM_SLUGS } from '../src/config/teamRegistry.js';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const DIST = path.join(ROOT, 'dist-canary');

function copyRecursive(src, dest) {
  if (!fs.existsSync(src)) return;
  const stat = fs.statSync(src);
  if (stat.isDirectory()) {
    fs.mkdirSync(dest, { recursive: true });
    for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
      if (entry.name === '.DS_Store') continue;
      copyRecursive(path.join(src, entry.name), path.join(dest, entry.name));
    }
  } else {
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(src, dest);
  }
}

export function buildCanaryPagesDist() {
  fs.rmSync(DIST, { recursive: true, force: true });
  fs.mkdirSync(DIST, { recursive: true });

  // 1. Core PWA shell files
  for (const rel of ['index.html', 'manifest.json', 'sw.js', 'apple-touch-icon.png']) {
    copyRecursive(path.join(ROOT, rel), path.join(DIST, rel));
  }

  // 2. Shared frontend modules & team assets
  copyRecursive(path.join(ROOT, 'src'), path.join(DIST, 'src'));
  for (const slug of CANARY_TEAM_SLUGS) {
    copyRecursive(path.join(ROOT, 'assets', 'teams', slug), path.join(DIST, 'assets', 'teams', slug));
  }
  for (const sfAsset of ['sf-crest.svg', 'app-icon.svg']) {
    copyRecursive(path.join(ROOT, 'assets', sfAsset), path.join(DIST, 'assets', sfAsset));
  }

  // 3. League + canary team live JSON data + 49ers A/B canary (`49ers2.joshal.com`) full data & studio `.m4a` podcasts
  const rootDataDir = path.join(ROOT, 'data');
  for (const entry of fs.readdirSync(rootDataDir, { withFileTypes: true })) {
    if (entry.isFile() && entry.name.endsWith('.json')) {
      copyRecursive(path.join(rootDataDir, entry.name), path.join(DIST, 'data', entry.name));
    }
  }
  copyRecursive(path.join(rootDataDir, 'podcasts'), path.join(DIST, 'data', 'podcasts'));
  copyRecursive(path.join(rootDataDir, 'league'), path.join(DIST, 'data', 'league'));
  for (const slug of CANARY_TEAM_SLUGS) {
    copyRecursive(path.join(rootDataDir, 'teams', slug), path.join(DIST, 'data', 'teams', slug));
  }

  // 4. Cloudflare Pages Advanced Mode `_worker.js` (rewriting `../src/` -> `./src/`)
  const workerSrc = fs.readFileSync(path.join(ROOT, 'worker', 'canary-worker.js'), 'utf8');
  const pagesWorkerSrc = workerSrc.replace(/from\s+['"]\.\.\/src\//g, "from './src/");
  fs.writeFileSync(path.join(DIST, '_worker.js'), pagesWorkerSrc, 'utf8');

  // 5. `_routes.json` so static JS/CSS/images AND `/data/*` JSON bypass Functions (unlimited free static CDN!)
  const routesJson = {
    version: 1,
    include: ['/', '/index.html', '/manifest.json', '/apple-touch-icon.png', '/api/*'],
    exclude: []
  };
  fs.writeFileSync(path.join(DIST, '_routes.json'), JSON.stringify(routesJson, null, 2) + '\n', 'utf8');

  // 6. `_headers` for fresh 60s JSON caching + CORS on `/data/*` with 0 Functions invocations
  const headersTxt = [
    '/data/*',
    '  Cache-Control: public, max-age=60, stale-while-revalidate=300',
    '  Access-Control-Allow-Origin: *',
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
  return { distDir: DIST, fileCount, totalBytes };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const res = buildCanaryPagesDist();
  console.log(
    `[build:canary] Built dist-canary/ (${res.fileCount} files, ${(res.totalBytes / 1024 / 1024).toFixed(2)} MB) ready for Cloudflare Pages.`
  );
}
