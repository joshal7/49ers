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
import { buildNflPortalDist, getGroupedPortalTeams } from '../scripts/build-nfl-portal.mjs';

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

  await test('Static build produces index.html, manifest, favicon, apple-touch-icon, _headers & 32 team icons', () => {
    for (const rel of ['index.html', 'manifest.json', 'nfl-icon.svg', 'apple-touch-icon.png', '_headers']) {
      assert.ok(fs.existsSync(path.join(distDir, rel)), `Missing ${rel}`);
    }
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

  await test('HTML contains all 32 team links (https://<slug>.joshal.com) and zero disallowed phrasing', () => {
    for (const team of ALL_NFL_TEAMS) {
      assert.ok(html.includes(`href="https://${team.slug}.joshal.com"`), `Missing link for ${team.slug}`);
      assert.ok(html.includes(team.brandName), `Missing brandName ${team.brandName}`);
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
      { name: 'iPhone SE (375x667)', width: 375, height: 667, mobile: true, singleScreen: true, shot: 'iphone-se-dark.png' },
      { name: 'iPhone 16 Safari Bar (393x660)', width: 393, height: 660, mobile: true, singleScreen: true, shot: 'iphone16-safari-dark.png' },
      { name: 'iPhone 16 (393x852)', width: 393, height: 852, mobile: true, singleScreen: true, shot: 'iphone16-dark.png' },
      { name: 'iPhone 16 Pro (402x874)', width: 402, height: 874, mobile: true, singleScreen: true },
      { name: 'iPhone 16 Pro Max (430x932)', width: 430, height: 932, mobile: true, singleScreen: true },
      { name: 'iPhone 16 Landscape (852x393)', width: 852, height: 393, mobile: true, singleScreen: false },
      { name: 'Desktop (1280x800)', width: 1280, height: 800, mobile: false, singleScreen: true, shot: 'desktop-dark.png' }
    ];

    if (SCREENSHOT_DIR) fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });

    for (const vp of viewports) {
      await test(`Viewport ${vp.name}: layout, 32 icons, 0px overflow${vp.singleScreen ? ' & 1-screen fit' : ''}`, async () => {
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
          const clippedNames = tiles.filter(t => {
            const name = t.querySelector('.team-name');
            return name && (name.scrollHeight > name.clientHeight + 2 || name.scrollWidth > name.clientWidth + 2);
          }).map(t => t.dataset.team);
          const outOfBounds = tiles.filter(t => {
            const r = t.getBoundingClientRect();
            return r.right > window.innerWidth + 1 || r.left < -1 || r.bottom > window.innerHeight + 1;
          }).map(t => ({ team: t.dataset.team, bottom: Math.round(t.getBoundingClientRect().bottom), vh: window.innerHeight }));
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
            tileCount: tiles.length,
            imgCount: imgs.length,
            brokenImgs,
            clippedNames,
            outOfBounds,
            divOrder
          };
        })()`);

        assert.equal(metrics.tileCount, 32, 'Expected 32 team tiles');
        assert.equal(metrics.imgCount, 32, 'Expected 32 team logos');
        assert.deepEqual(metrics.brokenImgs, [], `Broken images: ${metrics.brokenImgs.join(', ')}`);
        assert.ok(metrics.nfcRight <= metrics.afcLeft + 1, `NFC (${metrics.nfcRight}) should be left of AFC (${metrics.afcLeft})`);
        assert.deepEqual(metrics.divOrder.NFC, ['North', 'South', 'East', 'West']);
        assert.deepEqual(metrics.divOrder.AFC, ['North', 'South', 'East', 'West']);
        assert.ok(
          metrics.scrollWidth <= metrics.innerWidth,
          `Horizontal overflow: scrollWidth=${metrics.scrollWidth} > innerWidth=${metrics.innerWidth}`
        );
        assert.deepEqual(metrics.clippedNames, [], `Clipped team names: ${metrics.clippedNames.join(', ')}`);
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
        document.getElementById('themeToggle').click();
        const after = document.documentElement.getAttribute('data-theme');
        const meta = document.getElementById('metaThemeColor').getAttribute('content');
        const stored = localStorage.getItem('nfl_joshal_theme_v1');
        return { before, after, meta, stored };
      })()`);
      assert.equal(res.before, 'dark');
      assert.equal(res.after, 'light');
      assert.equal(res.meta, '#F5F6FA');
      assert.equal(res.stored, 'light');

      if (SCREENSHOT_DIR) {
        await new Promise(r => setTimeout(r, 220));
        const shot = await cdp.send('Page.captureScreenshot', { format: 'png' });
        fs.writeFileSync(path.join(SCREENSHOT_DIR, 'iphone16-light.png'), Buffer.from(shot.data, 'base64'));
      }
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
