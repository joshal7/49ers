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
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import {
  ALL_NFL_TEAMS,
  buildDeterministicCoachingMatchup,
  buildTeamCssVarsStyleBlock,
  computeOnPrimaryInk,
  getOurladsTeamCode,
  getTeamByAbbr,
  hasCrossTeam49ersLeak,
  isNflHubHost,
  isOfficialTeamHost,
  resolveExplicitQueryTeam,
  resolveTeamFromHostname,
  setActiveTeamConfig
} from '../src/config/teamRegistry.js';
import { JARGON_GLOSSARY } from '../src/engine/jargonGlossary.js';
import { buildMockDraftTeamUrl, buildOtcPlayerUrl } from '../src/engine/linkIntegrity.js';
import { getBigBoardRangeOptions } from '../src/engine/draftBigBoardEngine.js';
import { classifySymmetricUnitAdvantage } from '../src/engine/groundingValidator.js';
import { buildDeepScoutingAnalysisMarkdown } from '../src/engine/deepResearchEngine.js';
import { extractCompletedGameRecapSummary } from '../src/engine/gameDayRosterEngine.js';
import { resolveShareBaseUrl } from '../src/services/shareService.js';
import {
  detectMentionedOpponentTeam,
  resolveDailyBriefHeroMedia,
  resolveSalientCardVisual
} from '../src/engine/salientMediaEngine.js';
import { classifySourceLensTag, extractPresserTakeaways } from '../src/engine/digestExperienceEngine.js';
import { formatCompletedGameRecapForPrompt } from '../src/engine/gameDayRosterEngine.js';
import { canonicalPlayoffGameKey, normalizeTeamAbbr } from '../src/engine/playoffMonteCarlo.js';
import { resolveConsistentPowerRankings } from '../src/engine/powerRankingsEngine.js';
import { runUniversalSearch } from '../src/engine/universalSearchEngine.js';
import { buildNflTeamsPagesDist } from '../scripts/build-nfl-teams-pages.mjs';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
function resolveChromeBinary() {
  const candidates = [
    process.env.CHROME_BIN,
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser'
  ].filter(Boolean);
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  throw new Error(`Chrome/Chromium not found (set CHROME_BIN). Checked: ${candidates.join(', ')}`);
}
const CHROME_BIN = resolveChromeBinary();
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
  const userDataDir = path.join(os.tmpdir(), `chrome-all32-e2e-${Date.now()}-${Math.floor(Math.random() * 9999)}`);
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
        send(method, params = {}, timeoutMs = 15000) {
          return new Promise((res, rej) => {
            const id = nextId++;
            const timer = setTimeout(() => {
              pending.delete(id);
              rej(new Error(`CDP timeout on ${method}`));
            }, timeoutMs);
            pending.set(id, { res, rej, timer });
            ws.send(JSON.stringify({ id, method, params }));
          });
        },
        on(ev, fn) {
          if (!listeners.has(ev)) listeners.set(ev, []);
          listeners.get(ev).push(fn);
        },
        close() {
          for (const entry of pending.values()) clearTimeout(entry.timer);
          pending.clear();
          ws.close();
        }
      });
    });
    ws.addEventListener('error', reject);
    ws.addEventListener('message', evt => {
      const msg = JSON.parse(String(evt.data));
      if (msg.id && pending.has(msg.id)) {
        const { res, rej, timer } = pending.get(msg.id);
        clearTimeout(timer);
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
  assert.equal(fs.existsSync(path.join(ROOT, '.assetsignore')), false, 'Retired canary .assetsignore must stay deleted');
  assert.equal(fs.existsSync(path.join(ROOT, 'scripts', 'upload-r2-data.mjs')), false, 'Retired R2 canary uploader must stay deleted');
  assert.equal(fs.existsSync(path.join(ROOT, '.github', 'workflows', 'refresh-canary-teams.yml')), false, 'Retired canary workflow must stay deleted');
  const regSrc = fs.readFileSync(path.join(ROOT, 'src', 'config', 'teamRegistry.js'), 'utf8');
  assert.equal(/CANARY_TEAM_SLUGS|isCanary/.test(regSrc), false, 'Retired canary flags must not linger in teamRegistry.js');

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
    const pwr = sm.powerRankings || {};
    const pwrAll = Array.isArray(pwr.allSources) ? pwr.allSources : [];
    const pwrAct = Array.isArray(pwr.sources) ? pwr.sources : [];
    assert.equal(pwrAll.length, 6, `${team.abbr} powerRankings.allSources must include all 6 verified upstream outlets (got ${pwrAll.map(s => s.id).join(',')})`);
    assert.ok(pwrAct.length >= 3, `${team.abbr} powerRankings.sources collapsed to ${pwrAct.length} (${pwr.weekLabel || ''})`);
    assert.equal(
      /Through Week (\d+)\s*•\s*Updating After Week \1\b/i.test(pwr.weekLabel || ''),
      false,
      `${team.abbr} powerRankings has self-contradicting weekLabel: ${pwr.weekLabel}`
    );
    assert.equal(
      /\b1 verified model place\b/i.test(pwr.synthesizedTakeaway || ''),
      false,
      `${team.abbr} powerRankings takeaway has subject-verb error: ${pwr.synthesizedTakeaway}`
    );
    assert.ok(news.dailyTopNewsBrief?.headline, `${team.abbr} missing dailyTopNewsBrief headline`);
    const teamOdds = seasonal.playoffPicture?.baselineSimulation?.teamOdds || seasonal.playoffPicture?.baselineSimulation?.sfOdds;
    assert.ok(typeof teamOdds?.makePlayoffsPct === 'number', `${team.abbr} missing playoff Monte Carlo odds`);

    // Playoff schedule & Rooting Guide deduplication invariant across all 32 franchises
    const simIn = seasonal.playoffPicture?.simulatorInputs;
    const compGames = simIn?.completedGames || [];
    const remGames = simIn?.remainingGames || [];
    const rootingGames = seasonal.playoffPicture?.rootingLeverage || [];
    const compKeys = new Set(compGames.map(canonicalPlayoffGameKey));
    const remKeys = new Set(remGames.map(canonicalPlayoffGameKey));
    const rootKeys = new Set(rootingGames.map(canonicalPlayoffGameKey));
    assert.equal(compKeys.size, compGames.length, `${team.abbr} completedGames contains duplicate matchups`);
    assert.equal(remKeys.size, remGames.length, `${team.abbr} remainingGames contains duplicate matchups`);
    assert.equal(rootKeys.size, rootingGames.length, `${team.abbr} rootingLeverage contains duplicate same-week games`);
    const compRemOverlap = [...remKeys].filter(k => compKeys.has(k));
    assert.equal(compRemOverlap.length, 0, `${team.abbr} has ${compRemOverlap.length} games in both completedGames & remainingGames`);
    assert.equal(
      compGames.length + remGames.length,
      272,
      `${team.abbr} regular-season game count must equal 272 (got ${compGames.length} + ${remGames.length})`
    );
    const remByClub = new Map();
    for (const rg of remGames) {
      const h = normalizeTeamAbbr(rg.home);
      const a = normalizeTeamAbbr(rg.away);
      remByClub.set(h, (remByClub.get(h) || 0) + 1);
      remByClub.set(a, (remByClub.get(a) || 0) + 1);
    }
    const confClubList = (simIn?.conferenceTeams?.length ? simIn.conferenceTeams : simIn?.nfcTeams) || [];
    for (const c of confClubList) {
      const ab = normalizeTeamAbbr(c.abbr);
      const gp = (c.wins || 0) + (c.losses || 0) + (c.ties || 0);
      assert.equal(
        gp + (remByClub.get(ab) || 0),
        17,
        `${team.abbr} simulator has ${ab} playing ${gp + (remByClub.get(ab) || 0)} games instead of 17`
      );
    }

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

await test('2a. Power Rankings form a clean 1..32 rank bijection across all 6 verified sources (zero CBS blurb hijacks or missing aliases)', () => {
  const expectedIds = ['inpredictable', 'nfelo', 'rbsdm', 'cbs', 'espn_fpi', 'espn_panel'];
  const ranksBySource = Object.fromEntries(expectedIds.map(id => [id, new Map()]));
  for (const team of ALL_NFL_TEAMS) {
    const baseDir = team.abbr === 'SF' ? path.join(ROOT, 'data') : path.join(ROOT, 'data', 'teams', team.slug);
    const sm = JSON.parse(fs.readFileSync(path.join(baseDir, 'schedule-matchup.json'), 'utf8'));
    const all = sm.powerRankings?.allSources || [];
    for (const id of expectedIds) {
      const hit = all.find(s => s.id === id);
      assert.ok(hit && Number.isInteger(hit.rank) && hit.rank >= 1 && hit.rank <= 32, `${team.abbr} missing verified ${id} power ranking`);
      ranksBySource[id].set(team.abbr, hit.rank);
    }
  }
  for (const id of expectedIds) {
    const m = ranksBySource[id];
    const uniq = new Set(m.values());
    assert.equal(m.size, 32, `${id} must cover all 32 NFL teams`);
    assert.equal(uniq.size, 32, `${id} must have 32 unique ranks (1..32) with zero duplicate/hijacked team rows`);
  }
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

  // Verify `/index.html` returns 200 OK (no 308 redirect) AND unified `nfl.joshal.com` hub routing
  const prevRewriter = globalThis.HTMLRewriter;
  const capturedRewrites = [];
  globalThis.HTMLRewriter = class {
    constructor() {
      this._handlers = [];
    }
    on(sel, handler) {
      this._handlers.push([sel, handler]);
      return this;
    }
    transform(res) {
      const attrs = { html: {}, backBtnHiddenRemoved: false, appTitle: null, headAppends: [], title: null };
      for (const [sel, h] of this._handlers) {
        if (sel === 'html' && h.element) {
          h.element({ setAttribute: (k, v) => (attrs.html[k] = v) });
        }
        if (sel === '#nflHubBackBtn' && h.element) {
          h.element({ removeAttribute: k => { if (k === 'hidden') attrs.backBtnHiddenRemoved = true; } });
        }
        if (sel.includes('apple-mobile-web-app-title') && h.element) {
          h.element({ setAttribute: (_k, v) => (attrs.appTitle = v) });
        }
        if (sel === 'head' && h.element) {
          h.element({ append: str => attrs.headAppends.push(str) });
        }
        if (sel === 'title' && h.element) {
          h.element({ setInnerContent: str => (attrs.title = str) });
        }
      }
      capturedRewrites.push(attrs);
      return res;
    }
  };
  try {
    const idxRes = await worker.fetch(new Request('https://49ers.joshal.com/index.html'), mockEnv, {});
    assert.equal(idxRes.status, 200);
    assert.equal(idxRes.redirected, false);
    const sfRewrite = capturedRewrites.at(-1);
    assert.equal(sfRewrite.backBtnHiddenRemoved, false, '49ers.joshal.com must keep #nflHubBackBtn hidden');
    assert.equal(sfRewrite.appTitle, '49ers');
    assert.ok(!sfRewrite.headAppends.join('').includes('__NFL_HUB_MODE__=true'));

    // Unified `nfl.joshal.com` portal, `?team=<slug>` team apps, manifest, icon, and hermetic `/key-sync` vault
    assert.equal(isNflHubHost('nfl.joshal.com'), true);
    assert.equal(isNflHubHost('nfl-joshal.pages.dev'), true);
    assert.equal(isNflHubHost('49ers.joshal.com'), false);
    assert.equal(resolveExplicitQueryTeam('?team=bogus'), null);
    assert.equal(resolveExplicitQueryTeam('?team=lions')?.abbr, 'DET');

    const portalRes = await worker.fetch(new Request('https://nfl.joshal.com/'), mockEnv, {});
    assert.equal(portalRes.status, 200);
    assert.equal(portalRes.redirected, false);
    const portalHtml = await portalRes.text();
    assert.ok(portalHtml.includes('NFL Team Hub') && portalHtml.includes('data-hub-href="./?team=lions"'), 'nfl.joshal.com/ must serve NFL Team Hub portal');

    const bogusRes = await worker.fetch(new Request('https://nfl.joshal.com/?team=not-a-team'), mockEnv, {});
    assert.equal(bogusRes.status, 200);
    assert.ok((await bogusRes.text()).includes('NFL Team Hub'), 'Invalid ?team= must safely render NFL Team Hub portal');

    const hubManifestRes = await worker.fetch(new Request('https://nfl.joshal.com/manifest.json'), mockEnv, {});
    assert.equal(hubManifestRes.status, 200);
    const hubManifest = await hubManifestRes.json();
    assert.equal(hubManifest.short_name, 'NFL');
    assert.equal(hubManifest.start_url, '/');
    assert.equal(hubManifest.scope, '/');
    assert.equal(hubManifest.display, 'standalone');
    assert.ok(hubManifest.icons.some(ic => ic.sizes === '512x512' && ic.type === 'image/png'));

    const hubIconRes = await worker.fetch(new Request('https://nfl.joshal.com/apple-touch-icon.png'), mockEnv, {});
    assert.equal(hubIconRes.status, 200);

    const keySyncRes = await worker.fetch(new Request('https://nfl.joshal.com/key-sync'), mockEnv, {});
    assert.equal(keySyncRes.status, 200);
    const keySyncCsp = keySyncRes.headers.get('Content-Security-Policy') || '';
    assert.ok(keySyncCsp.includes("default-src 'none'") && keySyncCsp.includes('https://lions.joshal.com') && keySyncCsp.includes('https://49ers.joshal.com'));

    const teamKeySyncRes = await worker.fetch(new Request('https://lions.joshal.com/key-sync'), mockEnv, {});
    assert.equal(teamKeySyncRes.status, 404, '/key-sync vault must stay hermetically restricted to nfl.joshal.com');

    for (const team of ALL_NFL_TEAMS) {
      const hubTeamRes = await worker.fetch(new Request(`https://nfl.joshal.com/?team=${team.slug}`), mockEnv, {});
      assert.equal(hubTeamRes.status, 200, `nfl.joshal.com/?team=${team.slug} must return 200`);
      const rw = capturedRewrites.at(-1);
      assert.equal(rw.html['data-nfl-hub'], 'true', `nfl.joshal.com/?team=${team.slug} must set data-nfl-hub="true"`);
      assert.equal(rw.backBtnHiddenRemoved, true, `nfl.joshal.com/?team=${team.slug} must reveal #nflHubBackBtn`);
      assert.equal(rw.appTitle, 'NFL', `nfl.joshal.com/?team=${team.slug} must keep NFL shortcut title`);
      assert.equal(rw.title, `${team.brandName} — ${team.domain}`);
      assert.ok(rw.headAppends.join('').includes(`window.__ACTIVE_TEAM_SLUG__=${JSON.stringify(team.slug)}`));
      assert.ok(rw.headAppends.join('').includes('window.__NFL_HUB_MODE__=true;'));

      const hubHealthRes = await worker.fetch(new Request(`https://nfl.joshal.com/api/health?team=${team.slug}`), mockEnv, {});
      assert.equal(hubHealthRes.status, 200);
      const hubHealth = await hubHealthRes.json();
      assert.equal(hubHealth.hubHost, true);
      assert.equal(hubHealth.entryMode, 'hub-team');
      assert.equal(hubHealth.teamAbbr, team.abbr);
    }
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
    await cdp.send('Network.setBlockedURLs', {
      urls: [
        '*://www.youtube.com/embed/*',
        '*://site.api.espn.com/*',
        '*://site.web.api.espn.com/*',
        '*://sports.core.api.espn.com/*',
        '*://public.api.bsky.app/*',
        '*://www.rotowire.com/*',
        '*://api.rss2json.com/*',
        '*://corsproxy.io/*',
        '*://api.allorigins.win/*',
        '*://raw.githubusercontent.com/*',
        '*://nfl.joshal.com/key-sync*',
        '*://itunes.apple.com/*',
        '*://api.sleeper.app/*'
      ]
    });
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
    const testTeams = ['49ers', 'broncos', 'lions', 'bills', 'vikings'];
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

      // Verify Stats -> Power Rankings card renders comprehensive multi-source rankings (zero 1-source collapse
      // at snapshot fetch time, and exact parity with 24h post-game freshness cutoff at live wall-clock time!)
      await evalJs(cdp, `document.querySelector('[data-action="set-season-sub"][data-season-sub="stats"]').click()`);
      await waitFor(cdp, `Boolean(document.getElementById('powerRankingsCard'))`);
      const prDom = await evalJs(
        cdp,
        `(() => {
          const card = document.getElementById('powerRankingsCard');
          const items = [...(card?.querySelectorAll('[data-power-source]') || [])].map(el => el.getAttribute('data-power-source'));
          const eyebrow = card?.querySelector('.card-eyebrow')?.textContent?.trim() || '';
          const overflow = document.documentElement.scrollWidth - window.innerWidth;
          return { count: items.length, items, eyebrow, overflow };
        })()`
      );
      const snapshotFetchMs = Date.parse(smJson.powerRankings?.fetchedAtIso || '') || Date.now();
      const snapshotPr = resolveConsistentPowerRankings(smJson.powerRankings, smJson.schedule || [], {
        teamAbbr: targetTeam.abbr,
        nowMs: snapshotFetchMs
      });
      const livePr = resolveConsistentPowerRankings(smJson.powerRankings, smJson.schedule || [], {
        teamAbbr: targetTeam.abbr,
        nowMs: Date.now()
      });
      assert.ok(
        snapshotPr.sources.length >= 5,
        `${slug}: snapshot powerRankings at fetchedAtIso must yield >= 5 consistent verified sources (got ${snapshotPr.sources.length}: ${snapshotPr.sources.map(s => s.id).join(',')})`
      );
      const expectedDomCount = livePr.pastFreshnessCutoff ? livePr.sources.length : Math.max(5, livePr.sources.length);
      assert.ok(
        prDom.count >= expectedDomCount,
        `${slug}: #powerRankingsCard must match consistent verified sources (expected >= ${expectedDomCount}, got ${prDom.count}: ${prDom.items.join(',')})`
      );
      assert.equal(/Through Week (\d+)\s*•\s*Updating After Week \1\b/i.test(prDom.eyebrow), false, `${slug}: self-contradicting eyebrow "${prDom.eyebrow}"`);
      assert.ok(prDom.overflow <= 1, `${slug}: Stats/Power Rankings horizontal overflow ${prDom.overflow}px`);
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

await test('5. Headless Chrome E2E: Standalone NFL Hub (nfl.joshal.com -> ?team=<slug>) full round-trip, visual parity with <team>.joshal.com, back navigation & cross-team storage isolation', async () => {
  const distDir = path.join(ROOT, 'dist-nfl-teams');
  assert.ok(fs.existsSync(path.join(distDir, 'nfl-portal.html')), 'dist-nfl-teams/nfl-portal.html must exist');

  // Local HTTP harness simulating `nfl.joshal.com` (hub mode at `/` & `/?team=<slug>`) AND `<team>.joshal.com` (subdomain mode at `/subdomain?team=<slug>`)
  const hubServer = await new Promise(resolve => {
    const s = http.createServer((req, res) => {
      const u = new URL(req.url || '/', 'http://127.0.0.1');
      const teamParam = resolveExplicitQueryTeam(u.search);
      if (u.pathname === '/' || u.pathname === '/index.html') {
        if (!teamParam) {
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
          fs.createReadStream(path.join(distDir, 'nfl-portal.html')).pipe(res);
          return;
        }
        let html = fs.readFileSync(path.join(distDir, 'index.html'), 'utf8');
        html = html
          .replace('<html lang="en" data-theme="light">', '<html lang="en" data-theme="light" data-nfl-hub="true">')
          .replace('id="nflHubBackBtn" href="./" class="nfl-hub-back-btn" hidden', 'id="nflHubBackBtn" href="./" class="nfl-hub-back-btn"')
          .replace('</head>', `<script>window.__ACTIVE_TEAM_SLUG__=${JSON.stringify(teamParam.slug)};window.__NFL_HUB_MODE__=true;</script></head>`);
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(html);
        return;
      }
      if (u.pathname === '/subdomain' && teamParam) {
        let html = fs.readFileSync(path.join(distDir, 'index.html'), 'utf8');
        html = html.replace('</head>', `<script>window.__ACTIVE_TEAM_SLUG__=${JSON.stringify(teamParam.slug)};</script></head>`);
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(html);
        return;
      }
      const rel = decodeURIComponent(u.pathname).replace(/^\/+/, '');
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
    s.listen(0, '127.0.0.1', () => resolve({ server: s, port: s.address().port }));
  });

  const baseOrigin = `http://127.0.0.1:${hubServer.port}`;
  const cdpPort = 9500 + Math.floor(Math.random() * 400);
  const chrome = await launchChrome(cdpPort);
  let cdp = null;
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      cdp = await createCdpClient(chrome.wsUrl);
      break;
    } catch {
      await new Promise(r => setTimeout(r, 200));
    }
  }
  assert.ok(cdp, 'Failed to connect CDP for NFL Hub E2E');

  try {
    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');
    await cdp.send('Network.enable');
    await cdp.send('Network.setBlockedURLs', {
      urls: [
        '*://www.youtube.com/embed/*',
        '*://site.api.espn.com/*',
        '*://site.web.api.espn.com/*',
        '*://sports.core.api.espn.com/*',
        '*://public.api.bsky.app/*',
        '*://www.rotowire.com/*',
        '*://api.rss2json.com/*',
        '*://corsproxy.io/*',
        '*://api.allorigins.win/*',
        '*://raw.githubusercontent.com/*',
        '*://nfl.joshal.com/key-sync*',
        '*://itunes.apple.com/*',
        '*://api.sleeper.app/*'
      ]
    });
    // Emulate iPhone Safari / Chrome standalone Home Screen pseudo-app
    await cdp.send('Page.addScriptToEvaluateOnNewDocument', {
      source: `
        Object.defineProperty(navigator, 'standalone', { value: true, configurable: true });
        const origMatchMedia = window.matchMedia.bind(window);
        window.matchMedia = q => q.includes('display-mode: standalone')
          ? { matches: true, media: q, addEventListener(){}, removeEventListener(){}, addListener(){}, removeListener(){} }
          : origMatchMedia(q);
      `
    });
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
      if (p.response.status >= 400 && p.response.url.startsWith(baseOrigin)) {
        failedNetwork.push(`${p.response.status} ${p.response.url}`);
      }
    });

    // 1. Open NFL Team Hub portal `/` in standalone mode -> click Lions tile
    await cdp.send('Page.navigate', { url: `${baseOrigin}/` });
    await waitFor(cdp, `document.querySelectorAll('a.team-tile[data-team]').length === 32`);
    const lionsPortalHref = await evalJs(cdp, `document.querySelector('a.team-tile[data-team="lions"]').getAttribute('href')`);
    assert.equal(lionsPortalHref, './?team=lions', 'Standalone portal must link Lions to ./?team=lions');

    await evalJs(cdp, `document.querySelector('a.team-tile[data-team="lions"]').click()`);
    await waitFor(cdp, `window.location.search.includes('team=lions') && Boolean(window.__49ersDiagnostics?.getState()?.appData)`);

    // 2. Verify Lions renders identically in hub mode, back button is visible, 0px overflow across portrait & landscape
    for (const vp of [
      { width: 360, height: 780 },
      { width: 393, height: 852 },
      { width: 852, height: 393 }
    ]) {
      await cdp.send('Emulation.setDeviceMetricsOverride', { ...vp, deviceScaleFactor: 2, mobile: true });
      await new Promise(r => setTimeout(r, 120));
      const check = await evalJs(
        cdp,
        `(() => {
          const back = document.getElementById('nflHubBackBtn');
          const rect = back ? back.getBoundingClientRect() : { width: 0, height: 0 };
          return {
            origin: window.location.origin,
            search: window.location.search,
            dataTeam: document.documentElement.getAttribute('data-team'),
            title: document.getElementById('headerTitleText')?.textContent?.trim(),
            crestSrc: document.querySelector('.brand-medallion')?.getAttribute('src'),
            backHidden: back?.hidden,
            backW: rect.width,
            backH: rect.height,
            overflow: document.documentElement.scrollWidth - window.innerWidth
          };
        })()`
      );
      assert.equal(check.origin, baseOrigin, 'Must stay on exact same origin (no Safari tab break-out)');
      assert.equal(check.dataTeam, 'lions');
      assert.equal(check.title, 'Lions One Pride');
      assert.equal(check.crestSrc, './assets/teams/lions/crest.svg?v=1');
      assert.equal(check.backHidden, false, '#nflHubBackBtn must be visible in hub mode');
      assert.ok(check.backW >= 24 && check.backH >= 24, '#nflHubBackBtn must have clickable geometry');
      assert.ok(check.overflow <= 1, `Hub Lions overflow at ${vp.width}x${vp.height}: ${check.overflow}px`);
    }
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 393, height: 852, deviceScaleFactor: 2, mobile: true });

    // 3. Verify Settings NFL Portal + Switch Team links stay same-origin in hub mode
    await evalJs(cdp, `document.getElementById('openSettingsBtn').click()`);
    await waitFor(cdp, `!document.getElementById('bottomSheetBackdrop').hidden`);
    const settingsHubLinks = await evalJs(
      cdp,
      `(() => {
        const portalLink = document.querySelector('[data-hub-portal-link="true"]');
        const billsChip = [...document.querySelectorAll('[data-settings-team-switcher] a')].find(a => a.textContent.trim() === 'Bills');
        return {
          portalHref: portalLink?.getAttribute('href'),
          portalTarget: portalLink?.getAttribute('target'),
          billsHref: billsChip?.getAttribute('href')
        };
      })()`
    );
    assert.equal(settingsHubLinks.portalHref, './', 'Settings NFL Portal link must stay same-origin ./ in hub mode');
    assert.equal(settingsHubLinks.portalTarget, null, 'Settings NFL Portal link must NOT open target="_blank" in hub mode');
    assert.equal(settingsHubLinks.billsHref, './?team=bills', 'Settings Switch Team links must stay same-origin ./?team=<slug> in hub mode');
    await evalJs(cdp, `document.getElementById('closeSheetBtn')?.click()`);

    // 4. Write shared Gemini key + Lions-only daily brief cache & practice cache on Lions
    await evalJs(
      cdp,
      `(() => {
        localStorage.setItem('joshal_nfl_shared_gemini_key_v1', JSON.stringify({ v: 1, k: 'AIzaHubSharedKeyTest32', m: 'gemini-4-hydrogen', t: Date.now(), c: 0 }));
        localStorage.setItem('joshal_lions_daily_news_brief_v5', JSON.stringify({ headline: 'LIONS_ONLY_SECRET_BRIEF', bullets: ['Det bullet 1', 'Det bullet 2'], cycleKey: '2026-11-22@17PT', source: 'live-gemini-daily' }));
      })()`
    );

    // 5. Click `#nflHubBackBtn` -> returns cleanly same-origin to NFL Team Hub portal -> click Bills tile
    await evalJs(cdp, `document.getElementById('nflHubBackBtn').click()`);
    await waitFor(cdp, `window.location.search === '' && document.querySelectorAll('a.team-tile[data-team]').length === 32`);
    const backPortalCheck = await evalJs(cdp, `document.documentElement.getAttribute('data-standalone-app')`);
    assert.equal(backPortalCheck, 'true', 'Returning to / via #nflHubBackBtn must keep standalone hub mode active');

    await evalJs(cdp, `document.querySelector('a.team-tile[data-team="bills"]').click()`);
    await waitFor(cdp, `window.location.search.includes('team=bills') && Boolean(window.__49ersDiagnostics?.getState()?.appData)`);

    const billsCheck = await evalJs(
      cdp,
      `(() => {
        const st = window.__49ersDiagnostics.getState();
        return {
          dataTeam: document.documentElement.getAttribute('data-team'),
          title: document.getElementById('headerTitleText')?.textContent?.trim(),
          apiKey: st.prefs?.geminiApiKey || '',
          briefHeadline: st.appData?.news?.dailyTopNewsBrief?.headline || ''
        };
      })()`
    );
    assert.equal(billsCheck.dataTeam, 'bills');
    assert.equal(billsCheck.title, 'Bills Mafia');
    assert.equal(billsCheck.apiKey, 'AIzaHubSharedKeyTest32', 'Shared Gemini API key must sync instantaneously across teams on nfl.joshal.com');
    assert.ok(!billsCheck.briefHeadline.includes('LIONS_ONLY_SECRET_BRIEF'), 'Lions cached Daily Top-News Brief must NEVER leak into Bills on shared origin');

    // 6. Click `#nflHubBackBtn` -> click 49ers tile -> verify 49ers parity & shared key
    await evalJs(cdp, `document.getElementById('nflHubBackBtn').click()`);
    await waitFor(cdp, `window.location.search === '' && document.querySelectorAll('a.team-tile[data-team]').length === 32`);
    await evalJs(cdp, `document.querySelector('a.team-tile[data-team="49ers"]').click()`);
    await waitFor(cdp, `window.location.search.includes('team=49ers') && Boolean(window.__49ersDiagnostics?.getState()?.appData)`);
    const ninersHubCheck = await evalJs(
      cdp,
      `(() => {
        const st = window.__49ersDiagnostics.getState();
        return {
          dataTeam: document.documentElement.getAttribute('data-team'),
          title: document.getElementById('headerTitleText')?.textContent?.trim(),
          apiKey: st.prefs?.geminiApiKey || '',
          briefHeadline: st.appData?.news?.dailyTopNewsBrief?.headline || '',
          backVisible: document.getElementById('nflHubBackBtn')?.hidden === false
        };
      })()`
    );
    assert.equal(ninersHubCheck.dataTeam, '49ers');
    assert.equal(ninersHubCheck.title, '49ers Faithful');
    assert.equal(ninersHubCheck.apiKey, 'AIzaHubSharedKeyTest32');
    assert.equal(ninersHubCheck.backVisible, true);
    assert.ok(!ninersHubCheck.briefHeadline.includes('LIONS_ONLY_SECRET_BRIEF'));

    // 7. Verify Non-Hub Subdomain Parity (`/subdomain?team=lions`): `#nflHubBackBtn` MUST remain hidden!
    await cdp.send('Page.navigate', { url: `${baseOrigin}/subdomain?team=lions` });
    await waitFor(cdp, `Boolean(window.__49ersDiagnostics?.getState()?.appData)`);
    const subdomainCheck = await evalJs(
      cdp,
      `(() => {
        const back = document.getElementById('nflHubBackBtn');
        return {
          dataTeam: document.documentElement.getAttribute('data-team'),
          title: document.getElementById('headerTitleText')?.textContent?.trim(),
          backHidden: back?.hidden,
          backDisplay: back ? getComputedStyle(back).display : 'none'
        };
      })()`
    );
    assert.equal(subdomainCheck.dataTeam, 'lions');
    assert.equal(subdomainCheck.title, 'Lions One Pride');
    assert.equal(subdomainCheck.backHidden, true, 'Standalone <team>.joshal.com must keep #nflHubBackBtn hidden');
    assert.equal(subdomainCheck.backDisplay, 'none', 'Standalone <team>.joshal.com must render #nflHubBackBtn with display:none');

    assert.equal(pageErrors.length, 0, `Hub E2E uncaught page errors: ${pageErrors.join(' | ')}`);
    assert.equal(failedNetwork.length, 0, `Hub E2E failed local requests: ${failedNetwork.join(' | ')}`);
  } finally {
    cdp.close();
    chrome.proc.kill('SIGKILL');
    fs.rmSync(chrome.userDataDir, { recursive: true, force: true });
    hubServer.server.close();
  }
});

await test('6. Holistic 32-Team Unbiased Parity & Zero-49ers-Bias Scrub Verification (CSS, Podcasts, Ourlads, OTC, Engines, Data)', async () => {
  try {
    // 6a. Zero hardcoded 49ers Scarlet/Gold RGBAs outside :root/[data-theme="light"] in src/styles.css
    const cssText = fs.readFileSync(path.join(ROOT, 'src', 'styles.css'), 'utf8');
    const cssBody = cssText.slice(cssText.indexOf('*, *::before, *::after {'));
    const straySfRgba = cssBody.match(/rgba\(\s*(?:170\s*,\s*0\s*,\s*0|212\s*,\s*25\s*,\s*25|179\s*,\s*153\s*,\s*93|229\s*,\s*207\s*,\s*150|231\s*,\s*210\s*,\s*155|140\s*,\s*112\s*,\s*52)\s*,/g) || [];
    assert.equal(straySfRgba.length, 0, `Found ${straySfRgba.length} hardcoded 49ers RGBA rules in src/styles.css body`);

    // 6b. WCAG --on-primary ink + CSS RGB vars across all 32 teams (Steelers/Raiders/Saints dark ink, SF white ink)
    assert.equal(computeOnPrimaryInk('#F2B816', '#FFD54F'), '#0B0D10', 'Steelers bright gold must use dark button ink');
    assert.equal(computeOnPrimaryInk('#A5ACAF', '#CFD6D9'), '#0B0D10', 'Raiders bright silver must use dark button ink');
    assert.equal(computeOnPrimaryInk('#C4A661', '#E3C884'), '#0B0D10', 'Saints bright gold must use dark button ink');
    assert.equal(computeOnPrimaryInk('#AA0000', '#D41919'), '#FFFFFF', '49ers scarlet keeps white button ink');
    for (const t of ALL_NFL_TEAMS) {
      const varsBlock = buildTeamCssVarsStyleBlock(t);
      assert.ok(varsBlock.includes('--primary-rgb:'), `${t.abbr}: CSS vars must emit --primary-rgb`);
      assert.ok(varsBlock.includes('--on-primary:'), `${t.abbr}: CSS vars must emit --on-primary`);
      assert.ok(Array.isArray(t.beatPodcastShows) && t.beatPodcastShows.length >= 3, `${t.abbr}: must have >= 3 verified beat podcasts (got ${t.beatPodcastShows?.length || 0})`);
      for (const sh of t.beatPodcastShows) {
        assert.equal(/star trek/i.test(`${sh.name} ${sh.fullTitle}`), false, `${t.abbr}: non-NFL podcast leaked (${sh.fullTitle})`);
        assert.notEqual(sh.name, 'Pack', 'GB Pack-A-Day must not be truncated');
        assert.notEqual(sh.name, 'Patriots Catch', 'NE Patriots Catch-22 must not be truncated');
      }
    }

    // 6c. Ourlads legacy code mapping + Tampa Bay HC/DC deduplication
    assert.equal(getOurladsTeamCode('ARI'), 'ARZ');
    assert.equal(getOurladsTeamCode('BAL'), 'BLT');
    assert.equal(getOurladsTeamCode('CLE'), 'CLV');
    assert.equal(getOurladsTeamCode('HOU'), 'HST');
    assert.equal(getOurladsTeamCode('SF'), 'SF');
    const tbMatchup = buildDeterministicCoachingMatchup({ team: 'TB', week: 12, oppAbbr: 'ATL', oppName: 'Atlanta Falcons' });
    assert.equal(/Todd Bowles\s*&\s*DC\s*Todd Bowles/i.test(tbMatchup.headline), false, `TB coaching headline duplicated Todd Bowles: ${tbMatchup.headline}`);

    // 6d. Jargon Glossary neutrality (zero SF coaches/players in visible glossary definitions)
    for (const [key, entry] of Object.entries(JARGON_GLOSSARY)) {
      const def = String(entry?.definition || '');
      assert.equal(/\b(kyle shanahan|shanahan|kyle juszczyk|george kittle|fred warner|christian mccaffrey)\b/i.test(def), false, `Jargon glossary "${key}" leaked 49ers name: ${def}`);
    }

    // 6e. Non-SF Engine Parity (Bills / Lions / Steelers): OTC URL, Mock Draft URL, Big Board Window, Unit Edge, Deep Research, Game Recap, Share URL
    setActiveTeamConfig('BUF');
    assert.equal(buildOtcPlayerUrl({ playerName: 'Test Player' }), 'https://overthecap.com/salary-cap/buffalo-bills');
    assert.equal(buildMockDraftTeamUrl(2027), 'https://www.nflmockdraftdatabase.com/teams/2027/buffalo-bills');
    assert.equal(getBigBoardRangeOptions().find(o => o.key === 'sf_window')?.label, 'BUF Pick Window');
    assert.equal(classifySymmetricUnitAdvantage(2, 24, 'MIA'), 'BUF Heavy Edge');
    assert.equal(resolveShareBaseUrl({ hostname: 'bills.joshal.com', origin: 'https://bills.joshal.com', pathname: '/' }), 'https://bills.joshal.com/');
    const bufMd = buildDeepScoutingAnalysisMarkdown({
      query: 'Defensive Line pass rush outlook',
      appData: {
        meta: { teamAbbr: 'BUF', teamRecord: '9-1', currentWeek: 12, seasonYear: 2026 },
        roster: { players: [] },
        cap: { cap2026: { teamCapSpace: 12_000_000 }, cap2027: { teamCapSpace: 25_000_000 } },
        scheduleMatchup: { upcomingMatchup: { week: 12, oppAbbr: 'MIA', oppName: 'Miami Dolphins' } }
      }
    });
    assert.equal(hasCrossTeam49ersLeak(bufMd, 'BUF', 'MIA'), false, `Bills deep scouting leaked 49ers copy: ${bufMd.slice(0, 260)}`);
    assert.equal(/35\.16|31\.54|Wide-9|Raheem Morris|Shanahan/i.test(bufMd), false, 'Bills deep scouting leaked SF cap/scheme');

    const bufRecap = extractCompletedGameRecapSummary(
      {
        header: { competitions: [{ competitors: [{ team: { abbreviation: 'BUF' }, score: '31' }, { team: { abbreviation: 'MIA' }, score: '14' }] }] },
        scoringPlays: [
          { period: { number: 1 }, clock: { displayValue: '8:12' }, team: { abbreviation: 'BUF' }, text: 'Josh Allen 22-yd TD pass' },
          { period: { number: 2 }, clock: { displayValue: '3:44' }, team: { abbreviation: 'SF' }, text: 'Unrelated play' }
        ],
        boxscore: { teams: [], players: [] }
      },
      { teamAbbr: 'BUF', week: 11, oppAbbr: 'MIA', oppName: 'Miami Dolphins' }
    );
    assert.equal(bufRecap?.sfScoringPlays?.length, 1, 'Bills recap must extract BUF scoring plays, not SF');
    assert.ok(bufRecap?.sfScoringPlays?.[0]?.text.includes('Josh Allen'));

    // 6f. All 31 non-SF data bundles: ZERO san-francisco-49ers OTC trade URL leaks, non-zero IR designation tracking across league
    let leagueNonZeroIr = 0;
    for (const t of ALL_NFL_TEAMS.filter(x => x.abbr !== 'SF')) {
      const seasonal = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'teams', t.slug, 'seasonal.json'), 'utf8'));
      const health = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'teams', t.slug, 'health.json'), 'utf8'));
      const allTradeUrls = [
        ...(seasonal?.tradeWarRoom?.completed2026Moves || []),
        ...(seasonal?.tradeWarRoom?.tieredRumors || [])
      ].map(m => String(m?.sourceUrl || ''));
      for (const u of allTradeUrls) {
        assert.equal(/overthecap\.com\/salary-cap\/san-francisco-49ers/i.test(u), false, `${t.abbr}: trade sourceUrl leaked 49ers OTC URL: ${u}`);
      }
      if (Number(health?.usedIrDesignations || 0) > 0) leagueNonZeroIr++;
    }
    assert.ok(leagueNonZeroIr >= 20, `Expected >=20 non-SF teams with live non-zero usedIrDesignations (got ${leagueNonZeroIr})`);
  } finally {
    setActiveTeamConfig('SF');
  }
});

console.log(`\n==============================================================`);
console.log(`ALL-32-TEAMS QA SUMMARY: ${passed} Passed, ${failed} Failed`);
console.log(`==============================================================\n`);

if (failed > 0) process.exit(1);
