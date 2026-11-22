#!/usr/bin/env node
/**
 * Headless Chrome Mobile E2E QA for Canary Multi-Tenant Sites (`?team=lions` & `?team=bills`)
 * Verifies real browser rendering across portrait (393x852 iPhone 16), ultra-narrow (320x640) & landscape (852x393):
 *  - Dynamic branding (`Lions One Pride` / `Bills Mafia`), crest SVG, dark & light themes
 *  - All 5 bottom tabs (`Home`, `News & Film`, `Game & Season`, `Roster & Cap`, `Audio & AI`) + Settings
 *  - Zero console errors, zero uncaught page errors, zero 404/network failures, 0px horizontal overflow
 *  - Zero stale `"49ers"` leakage on Lions One Pride and Bills Mafia primary headings/titles
 */

import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const CHROME_BIN = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp'
};

function startStaticServer() {
  return new Promise(resolve => {
    const server = http.createServer((req, res) => {
      const cleanPath = decodeURIComponent((req.url || '/').split('?')[0]);
      const rel = cleanPath === '/' ? 'index.html' : cleanPath.replace(/^\/+/, '');
      const full = path.join(ROOT, rel);
      if (!full.startsWith(ROOT) || !fs.existsSync(full) || fs.statSync(full).isDirectory()) {
        res.writeHead(404);
        res.end('Not Found');
        return;
      }
      const ext = path.extname(full).toLowerCase();
      res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
      fs.createReadStream(full).pipe(res);
    });
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({ server, port });
    });
  });
}

async function launchChrome(port) {
  const userDataDir = `/tmp/chrome-canary-e2e-${Date.now()}-${Math.floor(Math.random() * 9999)}`;
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
    await new Promise(r => setTimeout(r, 200));
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

async function runCanaryE2eForTeam(
  cdp,
  baseUrl,
  { slug, querySlug = slug, expectedBrand, expectedShortTitle = expectedBrand, expectedDomain = `${slug}.joshal.com`, expectedCrestPart = `assets/teams/${slug}/crest.svg`, expectedDivision, expectedConf, allowSfWire = false }
) {
  const consoleErrors = [];
  const pageErrors = [];
  const localFailures = [];

  cdp.on('Runtime.exceptionThrown', p => {
    pageErrors.push(p.exceptionDetails?.text || 'Uncaught exception');
  });
  cdp.on('Console.messageAdded', p => {
    if (p.message?.level === 'error' && !/Failed to load resource|net::ERR_/i.test(p.message.text || '')) {
      consoleErrors.push(p.message.text);
    }
  });
  cdp.on('Network.responseReceived', p => {
    if (p.response?.url?.startsWith(baseUrl) && p.response.status >= 400) {
      localFailures.push(`${p.response.status} ${p.response.url}`);
    }
  });

  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width: 393,
    height: 852,
    deviceScaleFactor: 3,
    mobile: true
  });

  await cdp.send('Page.navigate', { url: `${baseUrl}/?team=${querySlug}` });
  await new Promise(r => setTimeout(r, 2400));

  const evalJs = async expr => {
    const res = await cdp.send('Runtime.evaluate', { expression: expr, returnByValue: true });
    if (res.exceptionDetails) throw new Error(res.exceptionDetails.text);
    return res.result?.value;
  };

  // 1. Verify Home Header, Title, Apple App Title, Crest & Zero Horizontal Overflow (393px & 320px)
  const homeState = await evalJs(`(() => {
    const title = document.title;
    const appleTitle = document.querySelector('meta[name="apple-mobile-web-app-title"]')?.getAttribute('content') || '';
    const appName = document.querySelector('meta[name="application-name"]')?.getAttribute('content') || '';
    const hTitle = document.getElementById('headerTitleText')?.textContent?.trim();
    const rec = document.getElementById('headerRecordPill')?.textContent?.trim();
    const sub = document.getElementById('headerSubStatus')?.textContent?.trim();
    const crest = document.querySelector('.brand-medallion')?.getAttribute('src') || '';
    const overflowPx = Math.max(0, document.documentElement.scrollWidth - window.innerWidth);
    const mainText = document.getElementById('mainView')?.innerText || '';
    return { title, appleTitle, appName, hTitle, rec, sub, crest, overflowPx, hasMainContent: mainText.length > 200 };
  })()`);

  assert.equal(homeState.hTitle, expectedBrand, `Expected header "${expectedBrand}", got "${homeState.hTitle}"`);
  assert.equal(homeState.title, `${expectedBrand} — ${expectedDomain}`, `Expected website title "${expectedBrand} — ${expectedDomain}", got "${homeState.title}"`);
  assert.equal(homeState.appleTitle, expectedShortTitle, `Expected apple-mobile-web-app-title "${expectedShortTitle}", got "${homeState.appleTitle}"`);
  assert.equal(homeState.appName, expectedShortTitle, `Expected application-name "${expectedShortTitle}", got "${homeState.appName}"`);
  assert.ok(homeState.crest.includes(expectedCrestPart), `Expected custom crest "${expectedCrestPart}" for ${querySlug}, got ${homeState.crest}`);
  assert.ok(homeState.sub.includes(expectedDivision), `Expected "${expectedDivision}" in sub-header, got "${homeState.sub}"`);
  assert.equal(homeState.overflowPx, 0, `${slug} Home portrait overflow ${homeState.overflowPx}px`);
  assert.equal(homeState.hasMainContent, true, `${slug} Home missing content`);

  // Verify 320px ultra-narrow viewport zero overflow with longer franchise brand titles
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width: 320,
    height: 640,
    deviceScaleFactor: 2,
    mobile: true
  });
  await new Promise(r => setTimeout(r, 180));
  const narrowOverflow = await evalJs(`Math.max(0, document.documentElement.scrollWidth - window.innerWidth)`);
  assert.equal(narrowOverflow, 0, `${slug} Home 320px narrow overflow ${narrowOverflow}px`);
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width: 393,
    height: 852,
    deviceScaleFactor: 3,
    mobile: true
  });
  await new Promise(r => setTimeout(r, 150));

  // 2. Navigate through News, Game & Season (Matchup, Health, Playoffs, Stats), Roster & Cap, Audio & AI
  const tabsToVisit = [
    { nav: 'news', label: 'News & Film' },
    { nav: 'season', label: 'Game & Season' },
    { nav: 'roster', label: 'Roster & Cap' },
    { nav: 'audio', label: 'Audio & AI' }
  ];
  for (const t of tabsToVisit) {
    await evalJs(`document.querySelector('.bottom-nav [data-nav-tab="${t.nav}"]')?.click()`);
    await new Promise(r => setTimeout(r, 500));
    const tabCheck = await evalJs(`({
      overflowPx: Math.max(0, document.documentElement.scrollWidth - window.innerWidth),
      text: document.getElementById('mainView')?.innerText || ''
    })`);
    assert.equal(tabCheck.overflowPx, 0, `${slug} ${t.label} portrait overflow ${tabCheck.overflowPx}px`);
    assert.ok(tabCheck.text.length > 120, `${slug} ${t.label} rendered empty`);
    if (t.nav === 'news' && !allowSfWire) {
      assert.ok(
        !/\bTim Kawakami\b|\bMatt Maiocco\b|\b49ers waived\b/i.test(tabCheck.text),
        `${querySlug} News & Film leaked 49ers live-wire beat items: ${tabCheck.text.slice(0, 260)}`
      );
    }
  }

  // 3. Visit ALL 8 Game & Season sub-tabs and verify zero overflow + AFC/NFC parity
  await evalJs(`document.querySelector('.bottom-nav [data-nav-tab="season"]')?.click()`);
  await new Promise(r => setTimeout(r, 380));
  for (const subKey of ['matchup', 'health', 'schedule', 'stats', 'trade', 'playoffs', 'draft_prep', 'draft_recap']) {
    await evalJs(`document.querySelector('[data-action="set-season-sub"][data-season-sub="${subKey}"]')?.click()`);
    await new Promise(r => setTimeout(r, 380));
    const subCheck = await evalJs(`({
      overflowPx: Math.max(0, document.documentElement.scrollWidth - window.innerWidth),
      text: document.getElementById('mainView')?.innerText || ''
    })`);
    assert.equal(subCheck.overflowPx, 0, `${slug} season/${subKey} portrait overflow ${subCheck.overflowPx}px`);
    assert.ok(subCheck.text.length > 100, `${slug} season/${subKey} rendered empty`);
    if (subKey === 'playoffs') {
      const lowerText = subCheck.text.toLowerCase();
      assert.ok(
        lowerText.includes(`win ${expectedDivision.toLowerCase()}`),
        `${slug} Playoffs missing "Win ${expectedDivision}" (errors=${JSON.stringify(pageErrors)}, text=${JSON.stringify(subCheck.text.slice(0, 320))})`
      );
      assert.ok(
        lowerText.includes(`${expectedConf.toLowerCase()} projected standings`),
        `${slug} Playoffs missing "${expectedConf} Projected Standings"`
      );
      if (!allowSfWire) {
        assert.ok(!lowerText.includes('win nfc west'), `${querySlug} Playoffs leaked "Win NFC West"`);
      }
    }
  }

  // 4. Roster, Depth Chart & Player Dossier Sheet check
  await evalJs(`document.querySelector('.bottom-nav [data-nav-tab="roster"]')?.click()`);
  await new Promise(r => setTimeout(r, 380));
  await evalJs(`document.querySelector('[data-action="set-roster-sub"][data-roster-sub="depth"]')?.click()`);
  await new Promise(r => setTimeout(r, 380));
  const depthCheck = await evalJs(`({
    overflowPx: Math.max(0, document.documentElement.scrollWidth - window.innerWidth),
    textLen: (document.getElementById('mainView')?.innerText || '').length
  })`);
  assert.equal(depthCheck.overflowPx, 0, `${slug} Depth Chart portrait overflow ${depthCheck.overflowPx}px`);
  assert.ok(depthCheck.textLen > 200, `${slug} Depth Chart rendered empty`);

  // Open a real player dossier bottom sheet and close it
  await evalJs(`document.querySelector('[data-action="set-roster-sub"][data-roster-sub="roster"]')?.click()`);
  await new Promise(r => setTimeout(r, 350));
  const openedSheet = await evalJs(`(() => {
    const trigger = document.querySelector('[data-action="open-player-sheet"][data-player-id]');
    if (!trigger) return false;
    trigger.click();
    return true;
  })()`);
  assert.equal(openedSheet, true, `${slug} Roster missing clickable player row`);
  await new Promise(r => setTimeout(r, 420));
  const sheetCheck = await evalJs(`({
    isOpen: !document.getElementById('bottomSheetBackdrop')?.hidden,
    textLen: (document.getElementById('sheetBody')?.innerText || '').length
  })`);
  assert.equal(sheetCheck.isOpen, true, `${slug} Player Dossier failed to open`);
  assert.ok(sheetCheck.textLen > 80, `${slug} Player Dossier empty`);
  await evalJs(`document.getElementById('closeSheetBtn')?.click()`);
  await new Promise(r => setTimeout(r, 250));

  // 5. Open Settings sheet: verify Team Sites switcher & toggle Dark/Light theme
  await evalJs(`document.getElementById('openSettingsBtn')?.click()`);
  await new Promise(r => setTimeout(r, 400));
  const settingsCheck = await evalJs(`({
    isOpen: !document.getElementById('bottomSheetBackdrop')?.hidden,
    overflowPx: Math.max(0, document.documentElement.scrollWidth - window.innerWidth),
    text: document.getElementById('sheetBody')?.innerText || ''
  })`);
  assert.equal(settingsCheck.isOpen, true, `${slug} Settings sheet failed to open`);
  assert.equal(settingsCheck.overflowPx, 0, `${slug} Settings portrait overflow ${settingsCheck.overflowPx}px`);
  assert.ok(settingsCheck.text.includes('Team Sites'), `${slug} Settings missing Team Sites switcher`);
  assert.ok(settingsCheck.text.includes('Lions One Pride') && settingsCheck.text.includes('Bills Mafia'), `${slug} Settings missing canary links`);
  await evalJs(`document.querySelector('#sheetBody [data-action="toggle-theme"]')?.click()`);
  await new Promise(r => setTimeout(r, 300));
  const toggledOverflow = await evalJs(`Math.max(0, document.documentElement.scrollWidth - window.innerWidth)`);
  assert.equal(toggledOverflow, 0, `${slug} Toggled theme overflow ${toggledOverflow}px`);
  await evalJs(`document.querySelector('#sheetBody [data-action="toggle-theme"]')?.click()`);
  await new Promise(r => setTimeout(r, 200));
  await evalJs(`document.getElementById('closeSheetBtn')?.click()`);
  await new Promise(r => setTimeout(r, 200));

  // 6. Landscape 852x393 Cap Simulator fit check
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width: 852,
    height: 393,
    deviceScaleFactor: 3,
    mobile: true
  });
  await evalJs(`document.querySelector('.bottom-nav [data-nav-tab="roster"]')?.click()`);
  await new Promise(r => setTimeout(r, 350));
  await evalJs(`document.querySelector('[data-action="set-roster-sub"][data-roster-sub="cap"]')?.click()`);
  await new Promise(r => setTimeout(r, 450));
  const capLandscape = await evalJs(`({
    overflowPx: Math.max(0, document.documentElement.scrollWidth - window.innerWidth),
    hasRows: document.querySelectorAll('table.cap-sim-table tbody tr').length
  })`);
  assert.equal(capLandscape.overflowPx, 0, `${slug} Cap landscape overflow ${capLandscape.overflowPx}px`);
  assert.ok(capLandscape.hasRows >= 20, `${slug} Cap table expected >=20 rows, got ${capLandscape.hasRows}`);

  assert.equal(pageErrors.length, 0, `${slug} uncaught page errors: ${pageErrors.join('; ')}`);
  assert.equal(consoleErrors.length, 0, `${slug} console errors: ${consoleErrors.join('; ')}`);
  assert.equal(localFailures.length, 0, `${slug} local 404/5xx failures: ${localFailures.join('; ')}`);

  console.log(`  ✓ ${expectedBrand} (?team=${slug}) passed full Chrome Mobile E2E (portrait + landscape, 0 overflow, 0 errors, ${expectedConf}/${expectedDivision})`);
}

async function main() {
  console.log('\n=== Canary Multi-Team Headless Chrome E2E QA (Lions One Pride & Bills Mafia) ===');
  const { server, port } = await startStaticServer();
  const cdpPort = 9222 + Math.floor(Math.random() * 600);
  const { proc, wsUrl, userDataDir } = await launchChrome(cdpPort);
  const cdp = await createCdpClient(wsUrl);
  try {
    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');
    await cdp.send('Console.enable');
    await cdp.send('Network.enable');

    const baseUrl = `http://127.0.0.1:${port}`;
    await runCanaryE2eForTeam(cdp, baseUrl, {
      slug: 'lions',
      expectedBrand: 'Lions One Pride',
      expectedShortTitle: 'Lions',
      expectedDivision: 'NFC North',
      expectedConf: 'NFC'
    });
    await runCanaryE2eForTeam(cdp, baseUrl, {
      slug: 'bills',
      expectedBrand: 'Bills Mafia',
      expectedShortTitle: 'Bills',
      expectedDivision: 'AFC East',
      expectedConf: 'AFC'
    });
    await runCanaryE2eForTeam(cdp, baseUrl, {
      slug: '49ers',
      querySlug: '49ers2',
      expectedBrand: '49ers Faithful',
      expectedShortTitle: '49ers',
      expectedDomain: '49ers.joshal.com',
      expectedCrestPart: 'assets/sf-crest.svg',
      expectedDivision: 'NFC West',
      expectedConf: 'NFC',
      allowSfWire: true
    });
    console.log('\n======================================================');
    console.log('CANARY E2E QA SUMMARY: ALL PASSED (0 failures)');
    console.log('======================================================\n');
  } finally {
    cdp.close();
    proc.kill('SIGKILL');
    server.close();
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
}

main().catch(err => {
  console.error('CANARY E2E FAILED:', err);
  process.exit(1);
});
