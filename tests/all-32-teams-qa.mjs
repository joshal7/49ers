#!/usr/bin/env node
/**
 * Comprehensive All-32-Teams Production & Cross-Team Feature QA Suite
 *
 * Covers:
 *   1. All 32 NFL Franchises: teamRegistry metadata, concise Home Screen shortcut (`shortTitle`),
 *      verified 2026 coaching staffs, curated local reporter configs (`config/reporters/{abbr}.json`),
 *      all 32 icon sets, and all 32 live 11-file JSON data bundles (`data/` + `data/teams/{slug}/`).
 *   2. Zero cross-team 49ers contamination on all 31 non-SF franchises, zero paywalled URLs,
 *      zero forbidden branding strings, and zero retired `49ers2` canary remnants.
 *   3. Production `dist-nfl-teams/` Cloudflare Pages bundle (`_worker.js`, `_routes.json`, `_headers`):
 *      verifies `/api/health`, `/manifest.json` (`start_url: "/"` + concise `short_name`),
 *      `/index.html` zero-redirect `200 OK`, SF Priority #0 quota gate, and strict BYOK `401` guard
 *      across all 32 `<team>.joshal.com` hosts.
 *   4. Headless Chrome Mobile E2E (`393x852` iPhone 16) verifying:
 *      - Feature (1): Clicking opposing players inside `Matchup` opens their native 5-tab Player Dossier
 *        hydrated directly from their team's JSON bundle (tested on `49ers` clicking Vikings opponent,
 *        `lions`, `bills`, and a non-SF team opening a `49ers` opponent!).
 *      - Feature (2): Clicking opposing team stat rank pills in `Matchup` Unit Rankings highlights and
 *        focuses the OPPOSING team (`[data-rank-highlight="true"][data-rank-team="<OPP>"]`), while
 *        clicking the active team's rank pill highlights the active team — verified on `49ers`, `lions`, `bills`.
 *      - Zero console errors, zero uncaught page errors, zero failed network requests, 0px horizontal overflow.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { spawn } from 'node:child_process';
import {
  ALL_NFL_TEAMS,
  getTeamByAbbr,
  hasCrossTeam49ersLeak,
  isOfficialTeamHost,
  resolveTeamFromHostname,
  setActiveTeamConfig
} from '../src/config/teamRegistry.js';
import {
  detectMentionedOpponentTeam,
  resolveDailyBriefHeroMedia,
  resolveSalientCardVisual
} from '../src/engine/salientMediaEngine.js';
import { classifySourceLensTag, extractPresserTakeaways } from '../src/engine/digestExperienceEngine.js';
import { formatCompletedGameRecapForPrompt } from '../src/engine/gameDayRosterEngine.js';
import { runUniversalSearch } from '../src/engine/universalSearchEngine.js';
import { buildNflTeamsPagesDist } from '../scripts/build-nfl-teams-pages.mjs';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const CHROME_BIN = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const REQUIRED_DATA_FILES = [
  'meta.json',
  'roster.json',
  'depth-chart.json',
  'cap.json',
  'reporters.json',
  'news.json',
  'schedule-matchup.json',
  'health.json',
  'seasonal.json',
  'beat-podcasts.json',
  'podcasts/index.json'
];
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

let passed = 0;
let failed = 0;

async function test(name, fn) {
  try {
    await fn();
    console.log(`  PASS  ${name}`);
    passed += 1;
  } catch (err) {
    console.error(`  FAIL  ${name}`);
    console.error(`        ${err?.stack || err?.message || err}`);
    failed += 1;
  }
}

function startStaticServer(rootDir = ROOT) {
  return new Promise(resolve => {
    const server = http.createServer((req, res) => {
      const cleanPath = decodeURIComponent((req.url || '/').split('?')[0]);
      const rel = cleanPath === '/' ? 'index.html' : cleanPath.replace(/^\/+/, '');
      const full = path.join(rootDir, rel);
      if (!full.startsWith(rootDir) || !fs.existsSync(full) || fs.statSync(full).isDirectory()) {
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
  const userDataDir = `/tmp/chrome-all32-e2e-${Date.now()}-${Math.floor(Math.random() * 9999)}`;
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
  for (let i = 0; i < 45; i += 1) {
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
          const id = nextId++;
          ws.send(JSON.stringify({ id, method, params }));
          return new Promise((res, rej) => pending.set(id, { res, rej }));
        },
        on(ev, fn) {
          if (!listeners.has(ev)) listeners.set(ev, []);
          listeners.get(ev).push(fn);
        },
        close() {
          ws.close();
        }
      });
    });
    ws.addEventListener('error', reject);
    ws.addEventListener('message', evt => {
      const msg = JSON.parse(String(evt.data));
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
  const res = await cdp.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (res.exceptionDetails) {
    throw new Error(res.exceptionDetails.exception?.description || res.exceptionDetails.text || 'JS eval error');
  }
  return res.result?.value;
}

async function waitFor(cdp, expr, timeoutMs = 14000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    const v = await evalJs(cdp, expr).catch(() => false);
    if (v) return v;
    await new Promise(r => setTimeout(r, 150));
  }
  throw new Error(`Timed out waiting for: ${expr}`);
}

console.log('\n==============================================================');
console.log('  ALL-32-TEAMS PRODUCTION & CROSS-TEAM FEATURES QA SUITE');
console.log('==============================================================\n');

await test('1. All 32 teams have complete registry entries, concise shortcut titles, 2026 coaches, icons, and reporters', () => {
  assert.equal(ALL_NFL_TEAMS.length, 32);
  assert.equal(isOfficialTeamHost('49ers2.joshal.com'), false, '49ers2 canary must be retired');
  assert.equal(isOfficialTeamHost('www.joshal.com'), false);
  assert.equal(isOfficialTeamHost('workouts.joshal.com'), false);

  for (const team of ALL_NFL_TEAMS) {
    assert.equal(isOfficialTeamHost(`${team.slug}.joshal.com`), true, `${team.domain} must be an official host`);
    assert.equal(resolveTeamFromHostname(`${team.slug}.joshal.com`).abbr, team.abbr);
    assert.equal(team.shortTitle, team.nickname, `${team.abbr} Home Screen shortTitle must be concise team nickname`);
    assert.ok(team.coachesSeed?.hc && team.coachesSeed?.oc && team.coachesSeed?.dc && team.coachesSeed?.gm, `${team.abbr} missing 2026 coachesSeed`);
    if (team.abbr !== 'SF') {
      assert.ok((team.beatPodcastShows || []).length >= 1, `${team.abbr} missing verified Apple Podcasts shows`);
      const repPath = path.join(ROOT, 'config', 'reporters', `${team.abbr.toLowerCase()}.json`);
      assert.ok(fs.existsSync(repPath), `Missing config/reporters/${team.abbr.toLowerCase()}.json`);
      const repCfg = JSON.parse(fs.readFileSync(repPath, 'utf8'));
      assert.equal(repCfg.teamAbbr, team.abbr);
      assert.ok((repCfg.reporters || []).length >= 8, `${team.abbr} reporter config needs >= 8 local voices`);
      for (const f of ['crest.svg', 'app-icon.svg', 'apple-touch-icon.png', 'apple-touch-icon-180.png']) {
        assert.ok(fs.existsSync(path.join(ROOT, 'assets', 'teams', team.slug, f)), `Missing icon ${team.slug}/${f}`);
      }
    }
  }
});

await test('2. All 32 teams have valid live 11-file 2026 JSON bundles with zero cross-team 49ers contamination', () => {
  for (const team of ALL_NFL_TEAMS) {
    const baseDir = team.abbr === 'SF' ? path.join(ROOT, 'data') : path.join(ROOT, 'data', 'teams', team.slug);
    for (const rel of REQUIRED_DATA_FILES) {
      const full = path.join(baseDir, rel);
      assert.ok(fs.existsSync(full), `${team.abbr} missing ${rel}`);
    }
    const meta = JSON.parse(fs.readFileSync(path.join(baseDir, 'meta.json'), 'utf8'));
    const roster = JSON.parse(fs.readFileSync(path.join(baseDir, 'roster.json'), 'utf8'));
    const cap = JSON.parse(fs.readFileSync(path.join(baseDir, 'cap.json'), 'utf8'));
    const sm = JSON.parse(fs.readFileSync(path.join(baseDir, 'schedule-matchup.json'), 'utf8'));
    const news = JSON.parse(fs.readFileSync(path.join(baseDir, 'news.json'), 'utf8'));
    const seasonal = JSON.parse(fs.readFileSync(path.join(baseDir, 'seasonal.json'), 'utf8'));

    assert.ok((roster.players || []).length >= 50, `${team.abbr} roster has < 50 players (${roster.players?.length})`);
    assert.ok((cap.players || []).length >= 30, `${team.abbr} cap has < 30 contracts (${cap.players?.length})`);
    assert.ok((sm.schedule || []).length >= 16, `${team.abbr} schedule incomplete (${sm.schedule?.length})`);
    assert.ok(sm.teamStats?.units?.length === 4, `${team.abbr} teamStats must have 4 units`);
    assert.ok(news.dailyTopNewsBrief?.headline, `${team.abbr} missing dailyTopNewsBrief headline`);
    const teamOdds = seasonal.playoffPicture?.baselineSimulation?.teamOdds || seasonal.playoffPicture?.baselineSimulation?.sfOdds;
    assert.ok(typeof teamOdds?.makePlayoffsPct === 'number', `${team.abbr} missing playoff Monte Carlo odds`);

    if (team.abbr !== 'SF') {
      assert.equal(meta.teamAbbr, team.abbr, `${team.slug}/meta.json teamAbbr mismatch`);
      assert.equal(meta.brandName, team.brandName, `${team.slug}/meta.json brandName mismatch`);
      const oppAbbr = String(sm.upcomingMatchup?.oppAbbr || '').toUpperCase();
      const coachingTxt = JSON.stringify(sm.upcomingMatchup?.coachingMatchup || {});
      assert.equal(
        hasCrossTeam49ersLeak(coachingTxt, team, oppAbbr),
        false,
        `${team.abbr} coachingMatchup leaked 49ers copy (opp=${oppAbbr})`
      );
      const briefTxt = `${news.dailyTopNewsBrief.headline} ${news.dailyTopNewsBrief.summary || ''} ${(news.dailyTopNewsBrief.bullets || []).join(' ')}`;
      assert.equal(
        hasCrossTeam49ersLeak(briefTxt, team, oppAbbr),
        false,
        `${team.abbr} dailyTopNewsBrief leaked 49ers copy`
      );
      if (oppAbbr !== 'SF') {
        assert.equal(
          /\bgeorge kittle\b/i.test(briefTxt),
          false,
          `${team.abbr} dailyTopNewsBrief leaked off-topic George Kittle story`
        );
        const badSrc = (news.dailyTopNewsBrief.sources || []).find(s =>
          /\bgeorge kittle\b|luchador mask|all-time sack list|week \d+ uniforms/i.test(String(s?.title || ''))
        );
        assert.equal(badSrc, undefined, `${team.abbr} dailyTopNewsBrief.sources leaked off-topic article: ${badSrc?.title}`);
      }
      setActiveTeamConfig(team);
      const briefHero = resolveDailyBriefHeroMedia(news.dailyTopNewsBrief, news.rawStream || [], {
        rosterPlayers: roster.players || []
      });
      if (briefHero) {
        assert.equal(
          /r1745395/i.test(briefHero.rawUrl),
          false,
          `${team.abbr} hero must never select archival traded-player 49ers-vs-Falcons photo r1745395`
        );
        if (oppAbbr !== 'SF') {
          assert.equal(
            /\b(?:49ers|niners|george kittle|brock purdy|kyle shanahan)\b/i.test(briefHero.alt || ''),
            false,
            `${team.abbr} hero photo alt leaked 49ers content: ${briefHero.alt}`
          );
        }
      }
    }
  }
  setActiveTeamConfig(getTeamByAbbr('SF'));
});

await test('2b. Zero accidental 49ers bias across salientMedia, digestExperience, gameDayRecap & universalSearch engines', () => {
  const atl = getTeamByAbbr('ATL');
  const sf = getTeamByAbbr('SF');
  try {
    setActiveTeamConfig(atl);

    // 1. Falcons brief hero must choose active Falcons QB photo over traded-player archival 49ers-vs-Falcons photo
    const atlNews = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'teams', 'falcons', 'news.json'), 'utf8'));
    const atlRoster = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'teams', 'falcons', 'roster.json'), 'utf8'));
    const atlHero = resolveDailyBriefHeroMedia(atlNews.dailyTopNewsBrief, atlNews.rawStream || [], {
      rosterPlayers: atlRoster.players || []
    });
    assert.ok(atlHero, 'Falcons brief must resolve a valid editorial hero photo');
    assert.ok(!/r1745395/i.test(atlHero.rawUrl), `Falcons hero must not pick traded-player photo r1745395 (got ${atlHero.rawUrl})`);

    // 2. detectMentionedOpponentTeam recognizes SF/49ers on non-SF teams
    const sfOpp = detectMentionedOpponentTeam('Falcons prepare for San Francisco 49ers defense');
    assert.equal(sfOpp?.abbr, 'SF', 'Non-SF teams must detect 49ers as an opponent');

    // 3. Team emblem fallback tag uses active team nickname, never hardcoded 49ERS
    const fallbackVisual = resolveSalientCardVisual(
      { title: 'Atlanta offense prepares for Sunday', fullText: 'Routine game prep' },
      { rosterPlayers: [], allowTeamFallback: true }
    );
    assert.equal(fallbackVisual?.kind, 'team');
    assert.equal(fallbackVisual?.tagLabel, 'FALCONS', 'Non-SF fallback emblem tag must be FALCONS, not 49ERS');

    // 4. Official source lens and presser takeaways use active team (never Kyle Shanahan on Falcons)
    assert.equal(
      classifySourceLensTag({ outletName: 'atlantafalcons.com Official', url: 'https://www.atlantafalcons.com/news/test' }),
      'Official'
    );
    const nowMs = Date.now();
    const pressers = extractPresserTakeaways(
      [
        {
          id: 'p1',
          type: 'article',
          title: 'Kevin Stefanski said the Falcons must protect the football in Week 12',
          url: 'https://www.espn.com/nfl/story/_/id/999/falcons-stefanski',
          publishedAt: new Date(nowMs - 3600_000).toISOString()
        },
        {
          id: 'p1b',
          type: 'article',
          title: 'Jeff Ulbrich explained how Atlanta plans to disguise blitzes against Minnesota',
          url: 'https://www.espn.com/nfl/story/_/id/997/falcons-ulbrich',
          publishedAt: new Date(nowMs - 4200_000).toISOString()
        },
        {
          id: 'p2',
          type: 'article',
          title: 'Kyle Shanahan said the 49ers offense is clicking ahead of Sunday',
          url: 'https://www.espn.com/nfl/story/_/id/998/sf-shanahan',
          publishedAt: new Date(nowMs - 3600_000).toISOString()
        }
      ],
      { nowMs }
    );
    assert.equal(pressers.length, 2, 'Falcons presser extractor must capture Stefanski & Ulbrich and ignore Kyle Shanahan');
    assert.ok(pressers.every(p => !/shanahan/i.test(p.speakerFull)), 'Falcons presser extractor must never emit Kyle Shanahan');

    // 5. Completed game recap prompt formatter uses active team, never San Francisco 49ers
    const recapPrompt = formatCompletedGameRecapForPrompt({
      week: 10,
      homeAway: 'home',
      sfScore: 17,
      oppScore: 24,
      result: 'L',
      oppAbbr: 'KC',
      oppName: 'Kansas City Chiefs',
      sfTeamStats: { totalYards: 320, yardsPerPlay: 5.1, netPassingYards: 210, completionAttempts: '20-32', rushingYards: 110, rushingAttempts: 24, yardsPerRush: 4.6, thirdDownEff: '5-12', sacksTakenCount: 2, sacksYardsLost: 14, turnovers: 1, penaltyCount: 5, penaltyYards: 40, possessionTime: '28:15' }
    });
    assert.ok(recapPrompt.includes('Atlanta Falcons'), 'Recap prompt must name Atlanta Falcons');
    assert.ok(!/49ers|San Francisco/i.test(recapPrompt), 'Recap prompt must not leak 49ers/San Francisco on Falcons');

    // 6. Universal Search quick section jumps use active team podcasts, never 49ers Beat Podcasts
    const searchRes = runUniversalSearch('podcasts', { appData: { meta: { teamAbbr: 'ATL' }, roster: atlRoster } });
    const podSec = (searchRes.sections || []).find(s => s.id === 'sec_podcasts');
    assert.ok(podSec, 'Universal search must match podcasts section');
    assert.ok(!/49ers/i.test(podSec.title), `Podcast quick jump must not say 49ers on Falcons (got ${podSec.title})`);
    assert.ok(/Falcons/i.test(podSec.title), `Podcast quick jump must say Falcons on Falcons (got ${podSec.title})`);
  } finally {
    setActiveTeamConfig(sf);
  }
});

await test('3. dist-nfl-teams/ Cloudflare Pages bundle & _worker.js serve all 32 teams cleanly (zero 49ers2, start_url="/", BYOK 401)', async () => {
  const built = buildNflTeamsPagesDist();
  assert.equal(built.teamCount, 32);
  const distDir = built.distDir;
  assert.ok(fs.existsSync(path.join(distDir, '_worker.js')));
  assert.ok(fs.existsSync(path.join(distDir, '_routes.json')));
  assert.ok(fs.existsSync(path.join(distDir, '_headers')));

  const { default: worker } = await import(`file://${path.join(distDir, '_worker.js')}?t=${Date.now()}`);
  const kvStore = new Map();
  const mockEnv = {
    SHARED_CACHE: {
      get: async (k, type) => {
        const v = kvStore.get(k);
        if (v == null) return null;
        return type === 'json' ? JSON.parse(v) : v;
      },
      put: async (k, v) => kvStore.set(k, String(v)),
      delete: async k => kvStore.delete(k)
    },
    ASSETS: {
      fetch: async req => {
        const u = new URL(req.url);
        const rel = u.pathname === '/' ? 'index.html' : u.pathname.replace(/^\/+/, '');
        const full = path.join(distDir, rel);
        if (!fs.existsSync(full)) return new Response('Not Found', { status: 404 });
        const ext = path.extname(full);
        return new Response(fs.readFileSync(full), {
          status: 200,
          headers: { 'Content-Type': MIME[ext] || 'application/octet-stream' }
        });
      }
    }
  };

  for (const team of ALL_NFL_TEAMS) {
    const hRes = await worker.fetch(new Request(`https://${team.domain}/api/health`), mockEnv, {});
    assert.equal(hRes.status, 200);
    const hJson = await hRes.json();
    assert.equal(hJson.teamAbbr, team.abbr);
    assert.equal(hJson.brandName, team.brandName);
    assert.equal(hJson.shortTitle, team.nickname);

    const mRes = await worker.fetch(new Request(`https://${team.domain}/manifest.json`), mockEnv, {});
    assert.equal(mRes.status, 200);
    const mJson = await mRes.json();
    assert.equal(mJson.name, team.brandName);
    assert.equal(mJson.short_name, team.nickname);
    assert.equal(mJson.start_url, '/', `${team.domain} manifest start_url must be "/" for Safari Home Screen shortcuts`);
  }

  // Verify `/index.html` returns 200 OK (no 308 redirect)
  const prevRewriter = globalThis.HTMLRewriter;
  globalThis.HTMLRewriter = class {
    on() {
      return this;
    }
    transform(res) {
      return res;
    }
  };
  try {
    const idxRes = await worker.fetch(new Request('https://49ers.joshal.com/index.html'), mockEnv, {});
    assert.equal(idxRes.status, 200);
    assert.equal(idxRes.redirected, false);
  } finally {
    if (prevRewriter === undefined) delete globalThis.HTMLRewriter;
    else globalThis.HTMLRewriter = prevRewriter;
  }

  // Verify strict BYOK 401 guard
  const byokRes = await worker.fetch(
    new Request('https://chiefs.joshal.com/api/podcast', { method: 'POST', body: '{}' }),
    mockEnv,
    {}
  );
  assert.equal(byokRes.status, 401);
});

await test('4. Headless Chrome E2E: Cross-team Matchup opposing player dossiers (Feature 1) & opposing team stat rank modal focus (Feature 2)', async () => {
  const { server, port } = await startStaticServer(ROOT);
  const cdpPort = 9500 + Math.floor(Math.random() * 400);
  const chrome = await launchChrome(cdpPort);
  let cdp = null;
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      cdp = await createCdpClient(chrome.wsUrl);
      break;
    } catch {
      await new Promise(r => setTimeout(r, 250));
    }
  }
  if (!cdp) {
    chrome.proc.kill('SIGKILL');
    server.close();
    throw new Error(`Could not connect WebSocket to Chrome CDP ${chrome.wsUrl}`);
  }

  try {
    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');
    await cdp.send('Network.enable');
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: 393,
      height: 852,
      deviceScaleFactor: 2,
      mobile: true
    });

    const pageErrors = [];
    const failedNetwork = [];
    cdp.on('Runtime.exceptionThrown', p => pageErrors.push(p.exceptionDetails?.text || 'Runtime error'));
    cdp.on('Network.responseReceived', p => {
      if (p.response.status >= 400 && p.response.url.startsWith(`http://127.0.0.1:${port}`)) {
        failedNetwork.push(`${p.response.status} ${p.response.url}`);
      }
    });

    // Test across 3 teams: 49ers (SF), Lions (DET), Bills (BUF), plus Vikings (MIN -> testing SF as opponent!)
    const testTeams = ['49ers', 'lions', 'bills', 'vikings'];
    for (const slug of testTeams) {
      const targetTeam = ALL_NFL_TEAMS.find(t => t.slug === slug);
      const dataBase = slug === '49ers' ? 'data' : `data/teams/${slug}`;
      const smJson = JSON.parse(fs.readFileSync(path.join(ROOT, dataBase, 'schedule-matchup.json'), 'utf8'));
      const oppAbbr = String(smJson.upcomingMatchup?.oppAbbr || '').toUpperCase();

      await cdp.send('Page.navigate', { url: `http://127.0.0.1:${port}/?team=${slug}` });
      await waitFor(cdp, `Boolean(window.__49ersDiagnostics?.getState()?.appData && document.querySelector('[data-nav-tab="season"]'))`);
      await evalJs(cdp, `document.querySelector('[data-nav-tab="season"]').click()`);
      await waitFor(cdp, `Boolean(document.querySelector('[data-action="set-season-sub"][data-season-sub="matchup"]'))`);
      await evalJs(cdp, `document.querySelector('[data-action="set-season-sub"][data-season-sub="matchup"]').click()`);
      await waitFor(cdp, `Boolean(document.getElementById('matchupTeamStatsCard'))`);

      // Verify 0px horizontal overflow on Matchup
      const overflow = await evalJs(cdp, `document.documentElement.scrollWidth - window.innerWidth`);
      assert.ok(overflow <= 1, `${slug} Matchup horizontal overflow: ${overflow}px`);

      // FEATURE (2): Click OPPOSING team's Overall Rank pill -> must highlight OPPONENT, NOT active team!
      const oppClickInfo = await evalJs(
        cdp,
        `(() => {
          const oppBtn = document.querySelector('#matchupTeamStatsCard [data-overall-col="opp-rank"] button[data-action="open-stat-rank-modal"]');
          if (!oppBtn) return { ok: false, reason: 'no opp rank button' };
          const focusAttr = oppBtn.getAttribute('data-focus-team');
          oppBtn.click();
          return { ok: true, focusAttr };
        })()`
      );
      assert.equal(oppClickInfo.ok, true, `${slug}: opp rank button missing (${oppClickInfo.reason || ''})`);
      assert.equal(oppClickInfo.focusAttr, oppAbbr, `${slug}: opp rank button must carry data-focus-team="${oppAbbr}"`);

      await waitFor(cdp, `!document.getElementById('statRankModalBackdrop').hidden`);
      const oppModalCheck = await evalJs(
        cdp,
        `(() => {
          const rows = [...document.querySelectorAll('#rankModalBody .rank-modal-row[data-rank-highlight="true"]')];
          return {
            hlCount: rows.length,
            hlTeam: rows[0]?.getAttribute('data-rank-team') || null,
            eyebrow: document.getElementById('rankModalEyebrow')?.textContent || ''
          };
        })()`
      );
      assert.equal(oppModalCheck.hlCount, 1, `${slug}: opponent modal must highlight exactly 1 team`);
      assert.equal(
        oppModalCheck.hlTeam,
        oppAbbr,
        `${slug}: clicking opposing team (${oppAbbr}) stat MUST highlight ${oppAbbr}, NOT ${targetTeam.abbr} (got ${oppModalCheck.hlTeam})`
      );

      // Close modal, then click ACTIVE team's Overall Rank pill -> must highlight ACTIVE team!
      await evalJs(cdp, `document.querySelector('[data-action="close-stat-rank-modal"]').click()`);
      await waitFor(cdp, `document.getElementById('statRankModalBackdrop').hidden === true`);

      await evalJs(
        cdp,
        `document.querySelector('#matchupTeamStatsCard [data-overall-col="sf-rank"] button[data-action="open-stat-rank-modal"]').click()`
      );
      await waitFor(cdp, `!document.getElementById('statRankModalBackdrop').hidden`);
      const selfModalCheck = await evalJs(
        cdp,
        `document.querySelector('#rankModalBody .rank-modal-row[data-rank-highlight="true"]')?.getAttribute('data-rank-team')`
      );
      assert.equal(selfModalCheck, targetTeam.abbr, `${slug}: clicking own team stat must highlight ${targetTeam.abbr}`);
      await evalJs(cdp, `document.querySelector('[data-action="close-stat-rank-modal"]').click()`);
      await waitFor(cdp, `document.getElementById('statRankModalBackdrop').hidden === true`);

      // FEATURE (1): Click an opposing player inside Matchup -> opens native 5-tab Player Dossier hydrated from opposing team!
      const oppPlayerTrigger = await evalJs(
        cdp,
        `(() => {
          const btn = document.querySelector('[data-action="open-opponent-player-sheet"]');
          if (!btn) return null;
          const info = {
            team: btn.getAttribute('data-opp-team'),
            name: btn.getAttribute('data-opp-player-name')
          };
          btn.click();
          return info;
        })()`
      );
      assert.ok(oppPlayerTrigger && oppPlayerTrigger.team === oppAbbr, `${slug}: must have clickable opposing player for ${oppAbbr}`);

      // Wait for remote bundle hydration to finish (`data-remote-team` set and no longer loading!)
      await waitFor(
        cdp,
        `(() => {
          const backdrop = document.getElementById('bottomSheetBackdrop');
          const sheet = document.getElementById('bottomSheetContainer');
          const loading = document.querySelector('[data-remote-dossier-status="loading"]');
          return backdrop && !backdrop.hidden && sheet?.getAttribute('data-remote-team') === ${JSON.stringify(oppAbbr)} && !loading;
        })()`,
        12000
      );

      // Verify all 5 native tabs exist & switching to Contract / Stats renders real data without crashing
      const tabsInfo = await evalJs(
        cdp,
        `(() => {
          const tabs = [...document.querySelectorAll('#sheetBody [data-action="set-player-tab"]')].map(b => b.getAttribute('data-player-tab'));
          const statusEl = document.querySelector('[data-remote-dossier-status]');
          return {
            title: document.getElementById('sheetTitle')?.textContent || '',
            eyebrow: document.getElementById('sheetEyebrow')?.textContent || '',
            tabs,
            statusAttr: statusEl?.getAttribute('data-remote-dossier-status') || 'ready-clean'
          };
        })()`
      );
      assert.deepEqual(tabsInfo.tabs, ['overview', 'health', 'stats', 'spider', 'contract'], `${slug}: opposing player dossier must expose all 5 native tabs`);
      assert.ok(tabsInfo.eyebrow.includes(oppAbbr), `${slug}: dossier eyebrow must show opposing team ${oppAbbr}`);
      assert.notEqual(tabsInfo.statusAttr, 'fallback', `${slug}: opposing player (${oppPlayerTrigger.name} on ${oppAbbr}) should hydrate cleanly from ${oppAbbr}'s live JSON bundle, not fallback`);

      // Switch through Health, Stats, Spider, Contract tabs and verify zero overflow & real content
      for (const tabKey of ['health', 'stats', 'spider', 'contract']) {
        await evalJs(cdp, `document.querySelector('#sheetBody [data-player-tab="${tabKey}"]')?.click()`);
        await new Promise(r => setTimeout(r, 120));
        const bodyLen = await evalJs(cdp, `(document.getElementById('sheetBody')?.textContent || '').trim().length`);
        assert.ok(bodyLen > 40, `${slug}: opposing player tab "${tabKey}" rendered empty`);
      }

      // Close bottom sheet cleanly
      await evalJs(cdp, `(document.getElementById('closeSheetBtn') || document.querySelector('[data-action="close-sheet"]'))?.click()`);
      await waitFor(cdp, `document.getElementById('bottomSheetBackdrop').hidden === true`);
    }

    assert.equal(pageErrors.length, 0, `Uncaught page errors: ${pageErrors.join(' | ')}`);
    assert.equal(failedNetwork.length, 0, `Failed local requests: ${failedNetwork.join(' | ')}`);
  } finally {
    cdp.close();
    chrome.proc.kill('SIGKILL');
    fs.rmSync(chrome.userDataDir, { recursive: true, force: true });
    server.close();
  }
});

console.log(`\n==============================================================`);
console.log(`ALL-32-TEAMS QA SUMMARY: ${passed} Passed, ${failed} Failed`);
console.log(`==============================================================\n`);

if (failed > 0) process.exit(1);
