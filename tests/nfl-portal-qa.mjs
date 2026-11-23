#!/usr/bin/env node
/**
 * Comprehensive QA Suite for the permanent `nfl.joshal.com` landing page (`dist-nfl/`).
 *
 * Verifies:
 *   1. Exact 2-column structure (`NFC` left, `AFC` right) with `North`, `South`, `East`, `West` under each.
 *   2. Exact 32 teams alphabetized inside each division with JOSHAL icons + fanbase names + `https://<slug>.joshal.com` links.
 *   3. Single-screen iPhone fit (`scrollHeight <= innerHeight`, 0px horizontal overflow, all 32 tiles inside viewport)
 *      across iPhone SE (`375x667`), iPhone 16 Safari (`393x660`), iPhone 16 (`393x852`),
 *      iPhone 16 Pro (`402x874`), iPhone 16 Pro Max (`430x932`), and Desktop (`1280x800`), plus clean landscape (`852x393`).
 *   4. All 32 icons load (`complete && naturalWidth > 0`), light/dark theme toggle persists,
 *      zero console errors, zero page errors, and zero network/404 errors.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { ALL_NFL_TEAMS } from '../src/config/teamRegistry.js';
import {
  buildKeySyncVaultHtml,
  buildNflPortalDist,
  getGroupedPortalTeams,
  getKeySyncAllowedOrigins
} from '../scripts/build-nfl-portal.mjs';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const CHROME_BIN = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png'
};

const screenshotArg = process.argv.find(a => a.startsWith('--screenshots='));
const SCREENSHOT_DIR = screenshotArg ? screenshotArg.replace('--screenshots=', '') : '';

let passed = 0;
let failed = 0;

async function test(name, fn) {
  try {
    await fn();
    passed += 1;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    failed += 1;
    console.error(`  ✗ ${name}\n    ${err?.stack || err}`);
  }
}

function startDistServer(distDir) {
  return new Promise(resolve => {
    const server = http.createServer((req, res) => {
      const cleanPath = decodeURIComponent((req.url || '/').split('?')[0]);
      const rel = cleanPath === '/' ? 'index.html' : cleanPath.replace(/^\/+/, '');
      const full = path.join(distDir, rel);
      if (!full.startsWith(distDir) || !fs.existsSync(full) || fs.statSync(full).isDirectory()) {
        res.writeHead(404);
        res.end('Not Found');
        return;
      }
      const ext = path.extname(full).toLowerCase();
      res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
      fs.createReadStream(full).pipe(res);
    });
    server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port }));
  });
}

async function launchChrome(port) {
  const userDataDir = `/tmp/chrome-nfl-portal-qa-${Date.now()}-${Math.floor(Math.random() * 9999)}`;
  const proc = spawn(
    CHROME_BIN,
    [
      '--headless=new',
      `--remote-debugging-port=${port}`,
      `--user-data-dir=${userDataDir}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-gpu',
      '--disable-background-networking',
      '--no-sandbox',
      'about:blank'
    ],
    { stdio: 'ignore' }
  );
  for (let i = 0; i < 40; i += 1) {
    try {
      const r = await fetch(`http://127.0.0.1:${port}/json/list`);
      if (r.ok) {
        const list = await r.json();
        const page = list.find(x => x.type === 'page' && x.webSocketDebuggerUrl);
        if (page) return { proc, wsUrl: page.webSocketDebuggerUrl, userDataDir };
      }
    } catch {}
    await new Promise(r => setTimeout(r, 150));
  }
  proc.kill('SIGKILL');
  throw new Error('Failed to launch Headless Chrome CDP');
}

function createCdpClient(wsUrl) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    let nextId = 1;
    const pending = new Map();
    const listeners = new Map();
    ws.addEventListener('open', () => {
      resolve({
        send(method, params = {}) {
          return new Promise((res, rej) => {
            const id = nextId++;
            pending.set(id, { res, rej });
            ws.send(JSON.stringify({ id, method, params }));
          });
        },
        on(event, fn) {
          if (!listeners.has(event)) listeners.set(event, []);
          listeners.get(event).push(fn);
        },
        close() {
          try { ws.close(); } catch {}
        }
      });
    });
    ws.addEventListener('error', reject);
    ws.addEventListener('message', ev => {
      const msg = JSON.parse(String(ev.data));
      if (msg.id && pending.has(msg.id)) {
        const { res, rej } = pending.get(msg.id);
        pending.delete(msg.id);
        if (msg.error) rej(new Error(msg.error.message || JSON.stringify(msg.error)));
        else res(msg.result);
      } else if (msg.method && listeners.has(msg.method)) {
        for (const fn of listeners.get(msg.method)) fn(msg.params);
      }
    });
  });
}

async function evalJs(cdp, expression) {
  const res = await cdp.send('Runtime.evaluate', {
    expression,
    returnByValue: true,
    awaitPromise: true
  });
  if (res.exceptionDetails) {
    throw new Error(res.exceptionDetails.text || JSON.stringify(res.exceptionDetails));
  }
  return res.result?.value;
}

async function main() {
  console.log('\n=== NFL Portal (nfl.joshal.com) QA Suite ===');
  const built = buildNflPortalDist();
  const distDir = built.distDir;
  const html = fs.readFileSync(path.join(distDir, 'index.html'), 'utf8');

  await test('Static build produces index.html, manifest, oval crest, flagship app icon, apple-touch-icon, _headers & 32 team icons', () => {
    for (const rel of ['index.html', 'manifest.json', 'nfl-crest.svg', 'nfl-icon.svg', 'apple-touch-icon.png', '_headers']) {
      assert.ok(fs.existsSync(path.join(distDir, rel)), `Missing ${rel}`);
    }
    const crestSvg = fs.readFileSync(path.join(distDir, 'nfl-crest.svg'), 'utf8');
    assert.ok(crestSvg.includes('<ellipse'), 'nfl-crest.svg must use oval medallion geometry');
    assert.ok(crestSvg.includes('viewBox="0 0 460 272"'), 'nfl-crest.svg must match per-team 460x272 oval crest ratio');

    const appIconSvg = fs.readFileSync(path.join(distDir, 'nfl-icon.svg'), 'utf8');
    assert.ok(appIconSvg.includes('<ellipse cx="256" cy="212"'), 'nfl-icon.svg must match standard JOSHAL oval medallion geometry');
    assert.ok(appIconSvg.includes('JOSHAL'), 'nfl-icon.svg must include JOSHAL studio wordmark');

    const touchPng = fs.readFileSync(path.join(distDir, 'apple-touch-icon.png'));
    assert.ok(touchPng.length > 10000, `apple-touch-icon.png too small: ${touchPng.length}B`);
    assert.equal(touchPng[0], 0x89, 'Invalid PNG header for apple-touch-icon.png');
    assert.equal(touchPng[1], 0x50);

    for (const team of ALL_NFL_TEAMS) {
      const p = path.join(distDir, 'icons', `${team.slug}.png`);
      assert.ok(fs.existsSync(p), `Missing icon for ${team.slug}`);
      const buf = fs.readFileSync(p);
      assert.ok(buf.length > 5000, `Icon too small for ${team.slug}: ${buf.length}B`);
      assert.equal(buf[0], 0x89, `Invalid PNG header for ${team.slug}`);
      assert.equal(buf[1], 0x50);
    }
  });

  await test('Grouped structure has NFC & AFC, North/South/East/West order, and alphabetized teams', () => {
    const grouped = getGroupedPortalTeams();
    assert.deepEqual(grouped.map(g => g.conference), ['NFC', 'AFC']);
    let total = 0;
    for (const conf of grouped) {
      assert.deepEqual(conf.divisions.map(d => d.name), ['North', 'South', 'East', 'West']);
      for (const div of conf.divisions) {
        assert.equal(div.teams.length, 4, `${div.fullDiv} should have 4 teams`);
        const nicks = div.teams.map(t => t.nickname);
        const sorted = [...nicks].sort((a, b) => a.localeCompare(b, 'en', { sensitivity: 'base' }));
        assert.deepEqual(nicks, sorted, `${div.fullDiv} not alphabetized: ${nicks.join(', ')}`);
        total += div.teams.length;
      }
    }
    assert.equal(total, 32);
  });

  await test('HTML contains NFL Team Hub header (zero nfl.joshal.com in topbar), all 32 team links, accessible labels, zero visible team names & zero disallowed phrasing', () => {
    assert.ok(!html.includes('class="team-name"'), 'Visible .team-name labels must be removed');
    assert.ok(!html.includes('class="brand-badge"'), 'Legacy rectangular .brand-badge must be replaced by oval crest');
    assert.ok(!html.includes('class="brand-domain"'), 'Redundant domain text must be removed from topbar');
    assert.ok(html.includes('<h1 class="brand-title">NFL Team Hub</h1>'), 'Expected "NFL Team Hub" heading in topbar');
    assert.ok(html.includes('src="./nfl-crest.svg?v='), 'Expected oval nfl-crest.svg in topbar');
    for (const team of ALL_NFL_TEAMS) {
      assert.ok(html.includes(`href="https://${team.slug}.joshal.com"`), `Missing link for ${team.slug}`);
      assert.ok(html.includes(`alt="${team.brandName}"`), `Missing accessible alt for ${team.brandName}`);
    }
    assert.ok(!/nerd\s*hq|the\s+nerd\s+edge/i.test(html), 'Disallowed branding string detected');
  });

  const { server, port } = await startDistServer(distDir);
  const debugPort = 9300 + Math.floor(Math.random() * 400);
  const chrome = await launchChrome(debugPort);
  const cdp = await createCdpClient(chrome.wsUrl);
  const baseUrl = `http://127.0.0.1:${port}/`;

  try {
    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');
    await cdp.send('Network.enable');

    const consoleErrors = [];
    const pageErrors = [];
    const failedResponses = [];

    cdp.on('Runtime.consoleAPICalled', ev => {
      if (ev.type === 'error') consoleErrors.push(ev.args?.map(a => a.value || a.description).join(' '));
    });
    cdp.on('Runtime.exceptionThrown', ev => {
      pageErrors.push(ev.exceptionDetails?.text || 'Uncaught exception');
    });
    cdp.on('Network.responseReceived', ev => {
      if (ev.response.status >= 400) failedResponses.push(`${ev.response.status} ${ev.response.url}`);
    });

    const viewports = [
      { name: 'iPhone SE (375x667)', width: 375, height: 667, mobile: true, singleScreen: true, minLogoPx: 44, shot: 'iphone-se-dark-v2.png' },
      { name: 'iPhone 16 Safari Bar (393x660)', width: 393, height: 660, mobile: true, singleScreen: true, minLogoPx: 44, shot: 'iphone16-safari-dark-v2.png' },
      { name: 'iPhone 16 (393x852)', width: 393, height: 852, mobile: true, singleScreen: true, minLogoPx: 58, shot: 'iphone16-dark-v2.png' },
      { name: 'iPhone 16 Pro (402x874)', width: 402, height: 874, mobile: true, singleScreen: true, minLogoPx: 60 },
      { name: 'iPhone 16 Pro Max (430x932)', width: 430, height: 932, mobile: true, singleScreen: true, minLogoPx: 64 },
      { name: 'iPhone 16 Landscape (852x393)', width: 852, height: 393, mobile: true, singleScreen: false, minLogoPx: 56 },
      { name: 'Desktop (1280x800)', width: 1280, height: 800, mobile: false, singleScreen: true, minLogoPx: 82, shot: 'desktop-dark-v2.png' }
    ];

    if (SCREENSHOT_DIR) fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });

    for (const vp of viewports) {
      await test(`Viewport ${vp.name}: large readable logos, whitespace balance, 0px overflow${vp.singleScreen ? ' & 1-screen fit' : ''}`, async () => {
        await cdp.send('Emulation.setDeviceMetricsOverride', {
          width: vp.width,
          height: vp.height,
          deviceScaleFactor: vp.mobile ? 2 : 1,
          mobile: vp.mobile
        });
        await cdp.send('Page.navigate', { url: baseUrl });
        await new Promise(r => setTimeout(r, 450));

        const metrics = await evalJs(cdp, `(() => {
          const doc = document.documentElement;
          const nfc = document.querySelector('[data-conference="NFC"]');
          const afc = document.querySelector('[data-conference="AFC"]');
          const nfcRect = nfc.getBoundingClientRect();
          const afcRect = afc.getBoundingClientRect();
          const tiles = Array.from(document.querySelectorAll('.team-tile'));
          const imgs = Array.from(document.querySelectorAll('.team-logo'));
          const brokenImgs = imgs.filter(img => !img.complete || img.naturalWidth === 0).map(i => i.src);
          const textCount = document.querySelectorAll('.team-name').length;
          const logoSizes = imgs.map(i => Math.round(i.getBoundingClientRect().width));
          const minRenderedLogo = Math.min(...logoSizes);
          const outOfBounds = tiles.filter(t => {
            const r = t.getBoundingClientRect();
            return r.right > window.innerWidth + 1 || r.left < -1 || r.bottom > window.innerHeight + 1;
          }).map(t => ({ team: t.dataset.team, bottom: Math.round(t.getBoundingClientRect().bottom), vh: window.innerHeight }));
          let minSiblingGap = Infinity;
          for (const grid of document.querySelectorAll('.team-grid')) {
            const boxes = Array.from(grid.querySelectorAll('.logo-wrap')).map(el => el.getBoundingClientRect());
            for (let i = 0; i < boxes.length; i++) {
              for (let j = i + 1; j < boxes.length; j++) {
                const a = boxes[i];
                const b = boxes[j];
                const dx = Math.max(0, b.left - a.right, a.left - b.right);
                const dy = Math.max(0, b.top - a.bottom, a.top - b.bottom);
                const gap = Math.max(dx, dy);
                if (gap < minSiblingGap) minSiblingGap = gap;
              }
            }
          }
          const topbarEl = document.querySelector('.topbar');
          const topbarText = (topbarEl?.textContent || '').trim();
          const topbarStyle = topbarEl ? window.getComputedStyle(topbarEl) : null;
          const topbarRect = topbarEl ? topbarEl.getBoundingClientRect() : null;
          const bodyStyle = window.getComputedStyle(document.body);
          const confEl = document.querySelector('.conferences');
          const confRect = confEl ? confEl.getBoundingClientRect() : null;
          const crestEl = document.querySelector('.brand-crest');
          const crestRect = crestEl ? crestEl.getBoundingClientRect() : null;
          const crestLoaded = Boolean(crestEl && crestEl.complete && crestEl.naturalWidth > 0);
          const divOrder = {};
          for (const c of ['NFC', 'AFC']) {
            divOrder[c] = Array.from(document.querySelectorAll('[data-conference="' + c + '"] .div-title')).map(el => el.textContent.trim());
          }
          return {
            innerWidth: window.innerWidth,
            innerHeight: window.innerHeight,
            scrollWidth: doc.scrollWidth,
            scrollHeight: doc.scrollHeight,
            nfcRight: nfcRect.right,
            afcLeft: afcRect.left,
            topbarText,
            topbarPosition: topbarStyle?.position || '',
            topbarBg: topbarStyle?.backgroundColor || '',
            topbarBackdrop: topbarStyle?.backdropFilter || 'none',
            topbarTop: topbarRect ? Math.round(topbarRect.top) : -1,
            topbarBottom: topbarRect ? Math.round(topbarRect.bottom) : -1,
            topbarWidth: topbarRect ? Math.round(topbarRect.width) : 0,
            confTop: confRect ? Math.round(confRect.top) : -1,
            bodyBgAttachment: bodyStyle?.backgroundAttachment || '',
            crestLoaded,
            crestWidth: crestRect ? Math.round(crestRect.width) : 0,
            crestHeight: crestRect ? Math.round(crestRect.height) : 0,
            tileCount: tiles.length,
            imgCount: imgs.length,
            textCount,
            minRenderedLogo,
            minSiblingGap: Math.round(minSiblingGap),
            brokenImgs,
            outOfBounds,
            divOrder
          };
        })()`);

        assert.equal(metrics.topbarText, 'NFL Team Hub', `Unexpected topbar text: "${metrics.topbarText}"`);
        assert.ok(!/joshal\.com/i.test(metrics.topbarText), `Topbar must not display redundant domain: "${metrics.topbarText}"`);
        assert.equal(metrics.topbarPosition, 'fixed', `Portal .topbar must be position:fixed to eliminate iOS 26 top-edge frost (got ${metrics.topbarPosition})`);
        assert.equal(metrics.topbarTop, 0, `Portal .topbar must sit flush at top:0 (got ${metrics.topbarTop})`);
        assert.ok(metrics.topbarWidth >= metrics.innerWidth - 1, `Portal .topbar must span full viewport width (${metrics.topbarWidth} < ${metrics.innerWidth})`);
        assert.ok(
          metrics.topbarBg && !/rgba\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*,\s*0(?:\.0+)?\s*\)|transparent/i.test(metrics.topbarBg),
          `Portal .topbar must have solid opaque background-color (got "${metrics.topbarBg}")`
        );
        assert.equal(metrics.topbarBackdrop, 'none', `Portal .topbar must disable backdrop-filter (got "${metrics.topbarBackdrop}")`);
        assert.ok(metrics.bodyBgAttachment !== 'fixed', `Portal body must not use background-attachment:fixed (got "${metrics.bodyBgAttachment}")`);
        assert.ok(
          metrics.confTop >= metrics.topbarBottom,
          `Portal .conferences (top=${metrics.confTop}) must clear fixed .topbar (bottom=${metrics.topbarBottom})`
        );
        assert.ok(metrics.crestLoaded, 'Oval .brand-crest SVG failed to load');
        assert.ok(metrics.crestWidth > metrics.crestHeight && metrics.crestWidth >= 32, `Crest should be crisp horizontal oval (${metrics.crestWidth}x${metrics.crestHeight})`);
        assert.equal(metrics.tileCount, 32, 'Expected 32 team tiles');
        assert.equal(metrics.imgCount, 32, 'Expected 32 team logos');
        assert.equal(metrics.textCount, 0, 'Expected zero visible team name elements');
        assert.deepEqual(metrics.brokenImgs, [], `Broken images: ${metrics.brokenImgs.join(', ')}`);
        assert.ok(
          metrics.minRenderedLogo >= vp.minLogoPx,
          `Logo too small (${metrics.minRenderedLogo}px < ${vp.minLogoPx}px)`
        );
        assert.ok(
          metrics.minSiblingGap >= 5,
          `Logos too crowded (min gap=${metrics.minSiblingGap}px < 5px)`
        );
        assert.ok(metrics.nfcRight <= metrics.afcLeft + 1, `NFC (${metrics.nfcRight}) should be left of AFC (${metrics.afcLeft})`);
        assert.deepEqual(metrics.divOrder.NFC, ['North', 'South', 'East', 'West']);
        assert.deepEqual(metrics.divOrder.AFC, ['North', 'South', 'East', 'West']);
        assert.ok(
          metrics.scrollWidth <= metrics.innerWidth,
          `Horizontal overflow: scrollWidth=${metrics.scrollWidth} > innerWidth=${metrics.innerWidth}`
        );
        if (vp.singleScreen) {
          assert.ok(
            metrics.scrollHeight <= metrics.innerHeight,
            `Vertical overflow on single-screen viewport: scrollHeight=${metrics.scrollHeight} > innerHeight=${metrics.innerHeight}`
          );
          assert.deepEqual(
            metrics.outOfBounds,
            [],
            `Tiles outside single screen: ${JSON.stringify(metrics.outOfBounds)}`
          );
        }

        if (SCREENSHOT_DIR && vp.shot) {
          const shot = await cdp.send('Page.captureScreenshot', { format: 'png' });
          fs.writeFileSync(path.join(SCREENSHOT_DIR, vp.shot), Buffer.from(shot.data, 'base64'));
        }
      });
    }

    await test('Light/Dark theme toggle updates DOM, meta theme-color, and persists in localStorage', async () => {
      await cdp.send('Emulation.setDeviceMetricsOverride', {
        width: 393,
        height: 852,
        deviceScaleFactor: 2,
        mobile: true
      });
      await cdp.send('Page.navigate', { url: baseUrl });
      await new Promise(r => setTimeout(r, 300));
      const res = await evalJs(cdp, `(() => {
        const before = document.documentElement.getAttribute('data-theme');
        const statusBefore = document.getElementById('metaStatusBarStyle')?.getAttribute('content');
        document.getElementById('themeToggle').click();
        const after = document.documentElement.getAttribute('data-theme');
        const meta = document.getElementById('metaThemeColor').getAttribute('content');
        const statusAfter = document.getElementById('metaStatusBarStyle')?.getAttribute('content');
        const stored = localStorage.getItem('nfl_joshal_theme_v1');
        return { before, statusBefore, after, meta, statusAfter, stored };
      })()`);
      assert.equal(res.before, 'dark');
      assert.equal(res.statusBefore, 'black', 'Dark portal status bar must use opaque "black" (never black-translucent)');
      assert.equal(res.after, 'light');
      assert.equal(res.meta, '#F5F6FA');
      assert.equal(res.statusAfter, 'default', 'Light portal status bar must use opaque "default" (matching team apps)');
      assert.equal(res.stored, 'light');

      // Verify portal HTML never regresses to `black-translucent` and keeps SW URL synced with `src/app.js`
      const portalHtml = fs.readFileSync(path.join(built.distDir, 'index.html'), 'utf8');
      assert.equal(
        portalHtml.includes('black-translucent'),
        false,
        'nfl.joshal.com must NEVER use apple-mobile-web-app-status-bar-style="black-translucent" (causes iOS 26 half-frosted top edge blur)'
      );
      assert.ok(portalHtml.includes('name="mobile-web-app-capable" content="yes"'));
      const appJs = fs.readFileSync(path.join(ROOT, 'src', 'app.js'), 'utf8');
      const swMatch = appJs.match(/\.register\(\s*['"](\.\/sw\.js(?:\?v=\d+)?)['"]/);
      assert.ok(swMatch && portalHtml.includes(swMatch[1]), `Portal SW register URL must stay auto-synced with src/app.js (${swMatch?.[1]})`);

      if (SCREENSHOT_DIR) {
        await new Promise(r => setTimeout(r, 220));
        const shot = await cdp.send('Page.captureScreenshot', { format: 'png' });
        fs.writeFileSync(path.join(SCREENSHOT_DIR, 'iphone16-light.png'), Buffer.from(shot.data, 'base64'));
      }
    });

    await test('dist-nfl/key-sync.html & _headers enforce strict 32-team allowlist + CSP (zero SmugMug/www leakage)', () => {
      const vaultHtmlPath = path.join(ROOT, 'dist-nfl', 'key-sync.html');
      const headersPath = path.join(ROOT, 'dist-nfl', '_headers');
      assert.ok(fs.existsSync(vaultHtmlPath), 'dist-nfl/key-sync.html must be generated');
      const vaultHtml = fs.readFileSync(vaultHtmlPath, 'utf8');
      const headersTxt = fs.readFileSync(headersPath, 'utf8');
      const allowedOrigins = getKeySyncAllowedOrigins();
      assert.equal(allowedOrigins.length, 33, 'Must allowlist all 32 teams + nfl');
      for (const origin of allowedOrigins) {
        assert.ok(vaultHtml.includes(origin), `key-sync.html must allowlist ${origin}`);
        assert.ok(headersTxt.includes(origin), `_headers CSP frame-ancestors must allowlist ${origin}`);
      }
      assert.ok(!vaultHtml.includes('www.joshal.com'), 'key-sync.html must NEVER allowlist www.joshal.com');
      assert.ok(!vaultHtml.includes('workouts.joshal.com'), 'key-sync.html must NEVER allowlist workouts.joshal.com');
      assert.ok(!headersTxt.includes('www.joshal.com'), '_headers must NEVER allowlist www.joshal.com');
      assert.ok(
        headersTxt.includes('\n/key-sync\n') &&
          headersTxt.includes("Content-Security-Policy: default-src 'none'; script-src 'unsafe-inline'; frame-ancestors"),
        '_headers must hermetically seal both /key-sync and /key-sync.html with default-src none + strict frame-ancestors'
      );
    });

    await test('Cross-Origin Chrome E2E: API key entered on Team Origin A syncs automatically to Team Origin B, rejects unallowlisted origins, and propagates clear tombstones', async () => {
      const sharedStoreJs = fs.readFileSync(path.join(ROOT, 'src', 'services', 'sharedApiKeyStore.js'), 'utf8');
      const makeTeamHarnessServer = () =>
        new Promise(resolve => {
          const s = http.createServer((req, res) => {
            if (req.url === '/sharedApiKeyStore.js') {
              res.writeHead(200, { 'Content-Type': 'application/javascript; charset=utf-8' });
              res.end(sharedStoreJs);
              return;
            }
            res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
            res.end('<!DOCTYPE html><html><head><meta name="referrer" content="no-referrer"></head><body>Team Harness</body></html>');
          });
          s.listen(0, '127.0.0.1', () => resolve({ server: s, port: s.address().port }));
        });

      const srvA = await makeTeamHarnessServer();
      const srvB = await makeTeamHarnessServer();
      const srvEvil = await makeTeamHarnessServer();
      const originA = `http://127.0.0.1:${srvA.port}`;
      const originB = `http://127.0.0.1:${srvB.port}`;
      const originEvil = `http://127.0.0.1:${srvEvil.port}`;

      const vaultHtml = buildKeySyncVaultHtml({ extraAllowedOrigins: [originA, originB] });
      const srvVault = await new Promise(resolve => {
        const s = http.createServer((req, res) => {
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end(vaultHtml);
        });
        s.listen(0, '127.0.0.1', () => resolve({ server: s, port: s.address().port }));
      });
      const vaultUrl = `http://127.0.0.1:${srvVault.port}/key-sync.html`;

      try {
        // 1. Origin A (e.g. lions.joshal.com) publishes API key to cross-origin vault
        await cdp.send('Page.navigate', { url: originA });
        await new Promise(r => setTimeout(r, 200));
        const pubRes = await evalJs(
          cdp,
          `(async () => {
            const mod = await import('/sharedApiKeyStore.js');
            mod.resetSharedVaultClientForTests();
            return await mod.publishSharedGeminiApiKey(
              { apiKey: 'AIzaCrossOriginOneTimeKey32', verifiedModel: 'gemini-4-hydrogen' },
              { vaultUrlOverride: ${JSON.stringify(vaultUrl)} }
            );
          })()`
        );
        assert.equal(pubRes.apiKey, 'AIzaCrossOriginOneTimeKey32');

        // 2. Origin B (e.g. bills.joshal.com — DIFFERENT origin, completely empty localStorage!) syncs automatically
        await cdp.send('Page.navigate', { url: originB });
        await new Promise(r => setTimeout(r, 200));
        const syncB = await evalJs(
          cdp,
          `(async () => {
            localStorage.clear();
            const mod = await import('/sharedApiKeyStore.js');
            mod.resetSharedVaultClientForTests();
            const prefs = { geminiApiKey: '', verifiedGeminiModel: '', geminiApiKeyUpdatedAt: 0 };
            const res = await mod.syncPrefsWithSharedGeminiKeyVault(prefs, { vaultUrlOverride: ${JSON.stringify(vaultUrl)} });
            return { res, prefs };
          })()`
        );
        assert.equal(syncB.res.vaultChecked, true);
        assert.equal(syncB.res.action, 'apply_shared');
        assert.equal(syncB.prefs.geminiApiKey, 'AIzaCrossOriginOneTimeKey32');
        assert.equal(syncB.prefs.verifiedGeminiModel, 'gemini-4-hydrogen');

        // 3. Unallowlisted Origin Evil (e.g. www.joshal.com / third party) gets ZERO key from vault!
        await cdp.send('Page.navigate', { url: originEvil });
        await new Promise(r => setTimeout(r, 200));
        const syncEvil = await evalJs(
          cdp,
          `(async () => {
            localStorage.clear();
            const mod = await import('/sharedApiKeyStore.js');
            mod.resetSharedVaultClientForTests();
            const prefs = { geminiApiKey: '', verifiedGeminiModel: '', geminiApiKeyUpdatedAt: 0 };
            const res = await mod.syncPrefsWithSharedGeminiKeyVault(prefs, {
              vaultUrlOverride: ${JSON.stringify(vaultUrl)},
              timeoutMs: 850
            });
            return { res, prefs };
          })()`
        );
        assert.equal(syncEvil.prefs.geminiApiKey, '', 'Unallowlisted origin must NEVER receive API key');

        // 4. Origin B clears API key (writes tombstone to vault)
        await cdp.send('Page.navigate', { url: originB });
        await new Promise(r => setTimeout(r, 200));
        await evalJs(
          cdp,
          `(async () => {
            const mod = await import('/sharedApiKeyStore.js');
            mod.resetSharedVaultClientForTests();
            return await mod.publishClearedSharedGeminiApiKey({}, { vaultUrlOverride: ${JSON.stringify(vaultUrl)} });
          })()`
        );

        // 5. Origin A (which previously had the key locally) syncs and cleanly clears — zero zombie resurrection!
        await cdp.send('Page.navigate', { url: originA });
        await new Promise(r => setTimeout(r, 200));
        const syncAAfterClear = await evalJs(
          cdp,
          `(async () => {
            const mod = await import('/sharedApiKeyStore.js');
            mod.resetSharedVaultClientForTests();
            const prefs = {
              geminiApiKey: 'AIzaCrossOriginOneTimeKey32',
              verifiedGeminiModel: 'gemini-4-hydrogen',
              geminiApiKeyUpdatedAt: ${pubRes.updatedAt}
            };
            const res = await mod.syncPrefsWithSharedGeminiKeyVault(prefs, { vaultUrlOverride: ${JSON.stringify(vaultUrl)} });
            return { res, prefs };
          })()`
        );
        assert.equal(syncAAfterClear.res.action, 'apply_clear');
        assert.equal(syncAAfterClear.prefs.geminiApiKey, '', 'Origin A must clear key when cleared on Origin B');
      } finally {
        srvA.server.close();
        srvB.server.close();
        srvEvil.server.close();
        srvVault.server.close();
      }
    });

    await test('Standalone Safari & Chrome Pseudo-App Mode: rewrites all 32 team links to same-origin ./?team=<slug> while preserving https://<slug>.joshal.com in normal browser tabs', async () => {
      // 1. Verify manifest has standalone scope & 512x512 PNG icon for Chrome/Safari PWA installability
      const manifest = JSON.parse(fs.readFileSync(path.join(built.distDir, 'manifest.json'), 'utf8'));
      assert.equal(manifest.display, 'standalone');
      assert.equal(manifest.start_url, '/');
      assert.equal(manifest.scope, '/');
      assert.ok(
        manifest.icons.some(ic => ic.sizes === '512x512' && ic.type === 'image/png'),
        'manifest.json must include a 512x512 PNG icon for full Chrome Android/Desktop standalone installability'
      );
      assert.ok(fs.existsSync(path.join(built.distDir, 'nfl-icon-512.png')), 'nfl-icon-512.png missing from dist-nfl');

      // 2. Normal browser tab: links stay canonical https://<slug>.joshal.com
      await cdp.send('Page.navigate', { url: baseUrl });
      await new Promise(r => setTimeout(r, 250));
      const normalCheck = await evalJs(
        cdp,
        `(() => {
          sessionStorage.clear();
          const tiles = [...document.querySelectorAll('a.team-tile')];
          return {
            standaloneAttr: document.documentElement.getAttribute('data-standalone-app'),
            allExternal: tiles.every(t => t.getAttribute('href') === 'https://' + t.dataset.team + '.joshal.com'),
            allHaveHubAttr: tiles.every(t => t.getAttribute('data-hub-href') === './?team=' + t.dataset.team)
          };
        })()`
      );
      assert.equal(normalCheck.standaloneAttr, null);
      assert.equal(normalCheck.allExternal, true);
      assert.equal(normalCheck.allHaveHubAttr, true);

      // 3. Simulate iOS Safari Home Screen App (`navigator.standalone === true`) on fresh document load
      const safariScript = await cdp.send('Page.addScriptToEvaluateOnNewDocument', {
        source: `Object.defineProperty(navigator, 'standalone', { value: true, configurable: true });`
      });
      try {
        await cdp.send('Page.navigate', { url: `${baseUrl}?safari_standalone_check=1` });
        await new Promise(r => setTimeout(r, 250));
        const safariCheck = await evalJs(
          cdp,
          `(() => {
            const tiles = [...document.querySelectorAll('a.team-tile')];
            return {
              standaloneAttr: document.documentElement.getAttribute('data-standalone-app'),
              sessionFlag: sessionStorage.getItem('nfl_hub_standalone_session_v1'),
              count: tiles.length,
              allSameOriginHub: tiles.every(t => t.getAttribute('href') === './?team=' + t.dataset.team),
              lionsHref: document.querySelector('a.team-tile[data-team="lions"]')?.getAttribute('href'),
              billsHref: document.querySelector('a.team-tile[data-team="bills"]')?.getAttribute('href'),
              ninersHref: document.querySelector('a.team-tile[data-team="49ers"]')?.getAttribute('href')
            };
          })()`
        );
        assert.equal(safariCheck.standaloneAttr, 'true');
        assert.equal(safariCheck.sessionFlag, '1');
        assert.equal(safariCheck.count, 32);
        assert.equal(safariCheck.allSameOriginHub, true, 'All 32 tiles must point to ./?team=<slug> in Safari standalone mode');
        assert.equal(safariCheck.lionsHref, './?team=lions');
        assert.equal(safariCheck.billsHref, './?team=bills');
        assert.equal(safariCheck.ninersHref, './?team=49ers');
      } finally {
        await cdp.send('Page.removeScriptToEvaluateOnNewDocument', { identifier: safariScript.identifier });
      }

      // 4. Simulate Chrome Installed Pseudo-App (`matchMedia('(display-mode: standalone)').matches === true`)
      const chromeScript = await cdp.send('Page.addScriptToEvaluateOnNewDocument', {
        source: `
          sessionStorage.clear();
          const origMM = window.matchMedia.bind(window);
          window.matchMedia = q => q.includes('display-mode: standalone')
            ? { matches: true, media: q, addEventListener(){}, removeEventListener(){}, addListener(){}, removeListener(){} }
            : origMM(q);
        `
      });
      try {
        await cdp.send('Page.navigate', { url: `${baseUrl}?chrome_standalone_check=1` });
        await new Promise(r => setTimeout(r, 250));
        const chromeCheck = await evalJs(
          cdp,
          `(() => {
            const tiles = [...document.querySelectorAll('a.team-tile')];
            return {
              standaloneAttr: document.documentElement.getAttribute('data-standalone-app'),
              allSameOriginHub: tiles.every(t => t.getAttribute('href') === './?team=' + t.dataset.team)
            };
          })()`
        );
        assert.equal(chromeCheck.standaloneAttr, 'true');
        assert.equal(chromeCheck.allSameOriginHub, true, 'All 32 tiles must point to ./?team=<slug> in Chrome standalone mode');
      } finally {
        await cdp.send('Page.removeScriptToEvaluateOnNewDocument', { identifier: chromeScript.identifier });
      }
    });

    await test('Portal `#nfl_ks=` Hash Handoff E2E: consumes incoming key, strips URL hash immediately, and attaches transient handoff on normal-browser team tile click', async () => {
      const { encodeSharedKeyHashToken, SHARED_GEMINI_KEY_STORAGE_KEY, SHARED_KEY_HASH_PARAM } = await import(
        '../src/services/sharedApiKeyStore.js'
      );
      const token = encodeSharedKeyHashToken({
        v: 1,
        k: 'AIzaPortalHandoffE2EKey77',
        m: 'gemini-4-hydrogen',
        t: 1700009000000,
        c: 0
      });
      await evalJs(cdp, `sessionStorage.clear(); localStorage.clear();`);
      await cdp.send('Page.navigate', { url: `${baseUrl}#${SHARED_KEY_HASH_PARAM}=${token}` });
      await new Promise(r => setTimeout(r, 350));

      const afterArrival = await evalJs(
        cdp,
        `(() => {
          const storedRaw = localStorage.getItem(${JSON.stringify(SHARED_GEMINI_KEY_STORAGE_KEY)});
          const stored = storedRaw ? JSON.parse(storedRaw) : null;
          const bearsTile = document.querySelector('a.team-tile[data-team="bears"]');
          const staticHrefBefore = bearsTile ? bearsTile.getAttribute('href') : '';
          let clickedHref = '';
          if (bearsTile) {
            document.addEventListener('click', ev => {
              if (ev.target && ev.target.closest && ev.target.closest('a.team-tile[data-team="bears"]')) {
                clickedHref = bearsTile.getAttribute('href') || '';
                ev.preventDefault();
              }
            }, { once: true });
            bearsTile.click();
          }
          return {
            currentHash: window.location.hash,
            storedKey: stored?.k || '',
            storedModel: stored?.m || '',
            staticHrefBefore,
            clickedHref
          };
        })()`
      );

      assert.equal(afterArrival.currentHash, '', 'Portal must immediately strip #nfl_ks= from window.location.hash');
      assert.equal(afterArrival.storedKey, 'AIzaPortalHandoffE2EKey77');
      assert.equal(afterArrival.storedModel, 'gemini-4-hydrogen');
      assert.equal(afterArrival.staticHrefBefore, 'https://bears.joshal.com', 'Static DOM href must stay clean before click');
      assert.ok(
        afterArrival.clickedHref.startsWith(`https://bears.joshal.com/#${SHARED_KEY_HASH_PARAM}=`),
        `Expected transient #nfl_ks= handoff on click, got: ${afterArrival.clickedHref}`
      );

      // Verify href reverts cleanly after the 250ms tick
      await new Promise(r => setTimeout(r, 320));
      const revertedHref = await evalJs(
        cdp,
        `document.querySelector('a.team-tile[data-team="bears"]')?.getAttribute('href') || ''`
      );
      assert.equal(revertedHref, 'https://bears.joshal.com', 'Tile href must revert to clean canonical URL after click');
    });

    await test('Zero console errors, zero uncaught page errors, zero 404/network failures', () => {
      assert.deepEqual(consoleErrors, [], `Console errors: ${consoleErrors.join('; ')}`);
      assert.deepEqual(pageErrors, [], `Page errors: ${pageErrors.join('; ')}`);
      assert.deepEqual(failedResponses, [], `Failed requests: ${failedResponses.join('; ')}`);
    });
  } finally {
    cdp.close();
    chrome.proc.kill('SIGKILL');
    fs.rmSync(chrome.userDataDir, { recursive: true, force: true });
    server.close();
  }

  console.log(`\nNFL Portal QA complete: ${passed} passed, ${failed} failed.`);
  if (failed > 0) process.exit(1);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
