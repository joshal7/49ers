#!/usr/bin/env node
/**
 * Multi-Tenant Canary QA Suite (`lions.joshal.com` & `bills.joshal.com`)
 * Verifies 32-team registry, WCAG contrast, AFC+NFC Monte Carlo, timezone brief rollovers,
 * Worker BYOK 401 lock + SF Priority #0 quota reservation, explicit non-wildcard DNS safety,
 * iOS PNG icon integrity, and live DET + BUF 11-file datasets.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  ALL_NFL_TEAMS,
  CANARY_TEAM_SLUGS,
  computeContrastRatio,
  getTeamByAbbr,
  getTeamBySlug,
  isOfficialTeamHost,
  resolveTeamFromHostname,
  setActiveTeamConfig
} from '../src/config/teamRegistry.js';
import {
  computeRootingGuideLeverage,
  runPlayoffMonteCarlo
} from '../src/engine/playoffMonteCarlo.js';
import { resolveNewsBriefCycleState } from '../src/engine/breakingClassifier.js';
import {
  buildXBeatListSearchUrl,
  configureBeatAttributionForTeam,
  extractBeatAttributionFromText,
  getReporterDirectoryEntry,
  resolveReporterFromNameOrHandle
} from '../src/engine/beatAttributionEngine.js';
import { isPaywalledPublisher } from '../src/engine/linkIntegrity.js';
import canaryWorker from '../worker/canary-worker.js';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
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

console.log('\n=== Multi-Tenant Canary QA Suite (Lions One Pride & Bills Mafia) ===');

await test('32-Team Registry completeness, uniqueness, timezones & SF legacy storage preservation', () => {
  assert.equal(ALL_NFL_TEAMS.length, 32, 'Expected 32 NFL teams');
  const slugs = new Set(ALL_NFL_TEAMS.map(t => t.slug));
  const espnIds = new Set(ALL_NFL_TEAMS.map(t => t.espnId));
  const otcSlugs = new Set(ALL_NFL_TEAMS.map(t => t.otcSlug));
  assert.equal(slugs.size, 32);
  assert.equal(espnIds.size, 32);
  assert.equal(otcSlugs.size, 32);

  const sf = getTeamByAbbr('SF');
  assert.equal(sf.brandName, '49ers Faithful');
  assert.equal(sf.shortTitle, '49ers');
  assert.equal(sf.priorityTier, 'vip');
  assert.equal(sf.storageKeys.prefs, 'joshal_49ers_hq_prefs_v1');
  assert.equal(sf.storageKeys.podcastCache, '49ers-podcast-studio-audio-v1');

  const det = getTeamByAbbr('DET');
  assert.equal(det.brandName, 'Lions One Pride');
  assert.equal(det.shortTitle, 'Lions');
  assert.equal(det.conference, 'NFC');
  assert.equal(det.division, 'NFC North');
  assert.equal(det.timezone, 'America/Detroit');
  assert.equal(det.storageKeys.prefs, 'joshal_lions_hq_prefs_v1');

  const buf = getTeamByAbbr('BUF');
  assert.equal(buf.brandName, 'Bills Mafia');
  assert.equal(buf.shortTitle, 'Bills');
  assert.equal(buf.conference, 'AFC');
  assert.equal(buf.division, 'AFC East');
  assert.equal(buf.timezone, 'America/New_York');
  assert.equal(buf.storageKeys.prefs, 'joshal_bills_hq_prefs_v1');

  const ari = getTeamByAbbr('ARI');
  assert.equal(ari.timezone, 'America/Phoenix', 'Arizona must use non-DST America/Phoenix');
});

await test('All 32 NFL franchises carry their exact fanbase brand name (home title & website name)', () => {
  const expectedBrands = {
    ARI: 'Cardinals Red Sea',
    ATL: 'Falcons Rise Up',
    BAL: 'Ravens Flock',
    BUF: 'Bills Mafia',
    CAR: 'Keep Pounding',
    CHI: 'Da Bears',
    CIN: 'Bengals Who Dey',
    CLE: 'Browns Dawg Pound',
    DAL: 'Cowboys Nation',
    DEN: 'Broncos Country',
    DET: 'Lions One Pride',
    GB: 'Go Pack Go',
    HOU: 'H-Town Texans',
    IND: 'Colts Nation',
    JAX: 'Jags DUUUVAL',
    KC: 'Chiefs Kingdom',
    LV: 'Raider Nation',
    LAC: 'Chargers Bolt Up',
    LAR: 'Rams House',
    MIA: 'Fins Up',
    MIN: 'Vikings Skol',
    NE: 'Pats Nation',
    NO: 'Saints Who Dat',
    NYG: 'Giants Big Blue',
    NYJ: 'Jets Gang Green',
    PHI: 'Fly Eagles Fly',
    PIT: 'Steeler Nation',
    SF: '49ers Faithful',
    SEA: 'Seahawks 12s',
    TB: 'Bucs Krewe',
    TEN: 'Titan Up',
    WAS: 'Hail Washington'
  };
  assert.equal(Object.keys(expectedBrands).length, 32);
  for (const [abbr, expectedName] of Object.entries(expectedBrands)) {
    const team = getTeamByAbbr(abbr);
    assert.equal(team.brandName, expectedName, `${abbr} expected brandName "${expectedName}", got "${team.brandName}"`);
    assert.equal(team.shortTitle, team.nickname, `${abbr} home-screen shortTitle should be team name "${team.nickname}", got "${team.shortTitle}"`);
  }
});

await test('WCAG AA (>= 4.5:1) color contrast across all 31 non-SF dark & light team themes', () => {
  for (const t of ALL_NFL_TEAMS) {
    if (t.abbr === 'SF') continue;
    const dPri = computeContrastRatio(t.themes.dark.primaryBright, t.themes.dark.bgElevated);
    const dSec = computeContrastRatio(t.themes.dark.secondaryBright, t.themes.dark.bgElevated);
    const lPri = computeContrastRatio(t.themes.light.primary, t.themes.light.bgElevated);
    const lSec = computeContrastRatio(t.themes.light.secondary, t.themes.light.bgElevated);
    assert.ok(dPri >= 4.5, `${t.abbr} dark primary contrast ${dPri} < 4.5`);
    assert.ok(dSec >= 4.5, `${t.abbr} dark secondary contrast ${dSec} < 4.5`);
    assert.ok(lPri >= 4.5, `${t.abbr} light primary contrast ${lPri} < 4.5`);
    assert.ok(lSec >= 4.5, `${t.abbr} light secondary contrast ${lSec} < 4.5`);
  }
});

await test('Hostname resolution isolates NFL subdomains & never matches workouts.joshal.com', () => {
  assert.equal(resolveTeamFromHostname('lions.joshal.com').abbr, 'DET');
  assert.equal(resolveTeamFromHostname('bills.joshal.com').abbr, 'BUF');
  assert.equal(resolveTeamFromHostname('49ers.joshal.com').abbr, 'SF');
  assert.equal(resolveTeamFromHostname('49ers2.joshal.com').abbr, 'SF');
  assert.equal(resolveTeamFromHostname('49ers2.joshal.com').priorityTier, 'vip');
  assert.equal(resolveTeamFromHostname('localhost', '?team=bills').abbr, 'BUF');
  assert.equal(resolveTeamFromHostname('localhost', '?team=lions').abbr, 'DET');
  assert.equal(resolveTeamFromHostname('localhost', '?team=49ers2').abbr, 'SF');
  assert.equal(isOfficialTeamHost('lions.joshal.com'), true);
  assert.equal(isOfficialTeamHost('bills.joshal.com'), true);
  assert.equal(isOfficialTeamHost('49ers2.joshal.com'), true);
  assert.equal(isOfficialTeamHost('workouts.joshal.com'), false, 'workouts.joshal.com must NEVER be intercepted');
  assert.equal(isOfficialTeamHost('futureapp.joshal.com'), false);
});

await test('wrangler.canary.toml explicitly binds ONLY lions.joshal.com & bills.joshal.com (zero wildcard, zero 49ers/workouts)', () => {
  const toml = fs.readFileSync(path.join(ROOT, 'worker', 'wrangler.canary.toml'), 'utf8');
  assert.ok(toml.includes('pattern = "lions.joshal.com"'), 'Must bind lions.joshal.com');
  assert.ok(toml.includes('pattern = "bills.joshal.com"'), 'Must bind bills.joshal.com');
  assert.ok(!toml.includes('*.joshal.com'), 'Must NOT bind catch-all wildcard *.joshal.com');
  assert.ok(!toml.includes('pattern = "49ers.joshal.com"'), 'Must NOT touch 49ers.joshal.com during canary');
  assert.ok(!toml.includes('pattern = "workouts.joshal.com"'), 'Must NOT touch workouts.joshal.com');

  const ignore = fs.readFileSync(path.join(ROOT, '.assetsignore'), 'utf8');
  for (const excluded of ['.git', 'node_modules', 'worker', 'scripts', 'tests', 'data/podcasts/*.m4a']) {
    assert.ok(ignore.includes(excluded), `.assetsignore must exclude ${excluded}`);
  }

  const pagesToml = fs.readFileSync(path.join(ROOT, 'worker', 'pages-canary', 'wrangler.toml'), 'utf8');
  assert.ok(pagesToml.includes('name = "nfl-hq-canary"'), 'Pages config must name nfl-hq-canary');
  assert.ok(pagesToml.includes('pages_build_output_dir = "../../dist-canary"'), 'Pages config must target dist-canary');
  assert.ok(!pagesToml.includes('[triggers]'), 'Pages config must NOT declare unsupported Workers cron triggers');
  assert.ok(!pagesToml.includes('[[r2_buckets]]'), 'Card-free Pages config must NOT require paid/card-gated R2');
});

await test('Cloudflare Pages bundle (dist-canary/_worker.js + _routes.json + _headers) builds & executes cleanly', async () => {
  const { buildCanaryPagesDist } = await import('../scripts/build-canary-pages.mjs');
  const built = buildCanaryPagesDist();
  assert.ok(built.fileCount >= 60, `Expected >= 60 files in dist-canary/, got ${built.fileCount}`);
  const routes = JSON.parse(fs.readFileSync(path.join(built.distDir, '_routes.json'), 'utf8'));
  assert.ok(routes.include.includes('/') && routes.include.includes('/api/*'));
  assert.ok(!routes.include.includes('/data/*'), '/data/* should serve directly from free Pages static CDN (0 Functions calls)');
  const headers = fs.readFileSync(path.join(built.distDir, '_headers'), 'utf8');
  assert.ok(headers.includes('/data/*') && headers.includes('Access-Control-Allow-Origin: *'));
  assert.ok(!fs.existsSync(path.join(built.distDir, 'node_modules')), 'dist-canary must not include node_modules');
  assert.ok(!fs.existsSync(path.join(built.distDir, 'worker')), 'dist-canary must not include worker/');
  // Verify 49ers2.joshal.com apples-to-apples 49ers data + studio .m4a podcasts exist in dist-canary/
  assert.ok(fs.existsSync(path.join(built.distDir, 'data', 'meta.json')), 'dist-canary missing 49ers data/meta.json');
  assert.ok(fs.existsSync(path.join(built.distDir, 'data', 'roster.json')), 'dist-canary missing 49ers data/roster.json');
  assert.ok(fs.existsSync(path.join(built.distDir, 'data', 'podcasts', 'index.json')), 'dist-canary missing 49ers podcasts/index.json');

  const pagesWorker = (await import(`file://${path.join(built.distDir, '_worker.js')}?t=${Date.now()}`)).default;
  const lionsRes = await pagesWorker.fetch(new Request('https://lions.joshal.com/manifest.json'), {}, {});
  const lionsJson = await lionsRes.json();
  assert.equal(lionsJson.name, 'Lions One Pride');
  const billsRes = await pagesWorker.fetch(new Request('https://bills.joshal.com/manifest.json'), {}, {});
  const billsJson = await billsRes.json();
  assert.equal(billsJson.name, 'Bills Mafia');
  const sf2HealthRes = await pagesWorker.fetch(new Request('https://49ers2.joshal.com/api/health'), {}, {});
  const sf2Health = await sf2HealthRes.json();
  assert.equal(sf2Health.brandName, '49ers Faithful');
  assert.equal(sf2Health.teamAbbr, 'SF');
  assert.equal(sf2Health.priorityTier, 'vip');
  assert.equal(sf2Health.isAbCanary, true);
});

await test('Timezone-local 5:00 PM brief cutoff rolls ET teams (DET/BUF) 3 hours before PT (SF)', () => {
  // 2026-11-22 22:15 UTC = 5:15 PM EST (past 5pm ET) / 2:15 PM PST (before 5pm PT)
  const sampleMs = Date.parse('2026-11-22T22:15:00Z');
  const detCycle = resolveNewsBriefCycleState(sampleMs, { meta: { teamAbbr: 'DET' } }, 17);
  const bufCycle = resolveNewsBriefCycleState(sampleMs, { meta: { teamAbbr: 'BUF' } }, 17);
  const sfCycle = resolveNewsBriefCycleState(sampleMs, { meta: { teamAbbr: 'SF' } }, 17);
  assert.equal(detCycle.activeCycleKey, '2026-11-22@17ET');
  assert.equal(bufCycle.activeCycleKey, '2026-11-22@17ET');
  assert.equal(sfCycle.activeCycleKey, '2026-11-21@17PT');
});

await test('Canary Worker: dynamic manifest, team health, BYOK 401 lock & SF Priority #0 Quota Reservation', async () => {
  const kvStore = new Map();
  const mockEnv = {
    SHARED_CACHE: {
      async get(k, type) {
        const v = kvStore.get(k);
        if (v == null) return null;
        return type === 'json' ? JSON.parse(v) : v;
      },
      async put(k, v) {
        kvStore.set(k, String(v));
      },
      async delete(k) {
        kvStore.delete(k);
      }
    },
    GEMINI_NFL_API_KEY: ''
  };

  // Dynamic manifests (full fanbase brand in `name`, concise team nickname in `short_name` for iOS/Android home screen)
  const detManifestRes = await canaryWorker.fetch(new Request('https://lions.joshal.com/manifest.json'), mockEnv, {});
  const detManifest = await detManifestRes.json();
  assert.equal(detManifest.name, 'Lions One Pride');
  assert.equal(detManifest.short_name, 'Lions');

  const bufManifestRes = await canaryWorker.fetch(new Request('https://bills.joshal.com/manifest.json'), mockEnv, {});
  const bufManifest = await bufManifestRes.json();
  assert.equal(bufManifest.name, 'Bills Mafia');
  assert.equal(bufManifest.short_name, 'Bills');

  const sf2ManifestRes = await canaryWorker.fetch(new Request('https://49ers2.joshal.com/manifest.json'), mockEnv, {});
  const sf2Manifest = await sf2ManifestRes.json();
  assert.equal(sf2Manifest.name, '49ers Faithful');
  assert.equal(sf2Manifest.short_name, '49ers');

  // Strict BYOK 401 lock on /api/podcast and /api/analyze
  const podRes = await canaryWorker.fetch(
    new Request('https://lions.joshal.com/api/podcast', { method: 'POST', body: '{}' }),
    mockEnv,
    {}
  );
  assert.equal(podRes.status, 401, 'Public /api/podcast must return 401 (BYOK only)');
  const anaRes = await canaryWorker.fetch(
    new Request('https://bills.joshal.com/api/analyze', { method: 'POST', body: '{}' }),
    mockEnv,
    {}
  );
  assert.equal(anaRes.status, 401, 'Public /api/analyze must return 401 (BYOK only)');

  // Priority #0 SF Quota Reservation: set usage to 42 (= 48 budget - 6 reserved for SF)
  const dayKey = `quota:nfl:${new Date().toISOString().slice(0, 10)}`;
  kvStore.set(dayKey, '42');
  const blockedDetRes = await canaryWorker.fetch(
    new Request('https://lions.joshal.com/api/daily-news-brief', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cycleKey: 'test-q', prompt: 'test brief' })
    }),
    mockEnv,
    {}
  );
  assert.equal(blockedDetRes.status, 429, 'Non-SF team must stop before touching SF reserved quota');

  // Meanwhile 49ers2.joshal.com (VIP Priority #0) MUST pass the 42-call non-SF gate (hits 503 missing key instead of 429 quota block!)
  const vipSf2Res = await canaryWorker.fetch(
    new Request('https://49ers2.joshal.com/api/daily-news-brief', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cycleKey: 'test-q', prompt: 'test brief' })
    }),
    mockEnv,
    {}
  );
  assert.notEqual(vipSf2Res.status, 429, '49ers2.joshal.com must inherit SF Priority #0 reserved quota');
});

for (const slug of CANARY_TEAM_SLUGS) {
  const team = getTeamBySlug(slug);

  await test(`${team.brandName} (${team.abbr}): custom SVG crests & full-bleed iOS PNG icons exist`, () => {
    const dir = path.join(ROOT, 'assets', 'teams', slug);
    for (const f of ['crest.svg', 'app-icon.svg', 'apple-touch-icon.png', 'apple-touch-icon-180.png']) {
      const p = path.join(dir, f);
      assert.ok(fs.existsSync(p), `Missing ${p}`);
      const buf = fs.readFileSync(p);
      assert.ok(buf.length > 2000, `${p} unexpectedly small (${buf.length}B)`);
      if (f.endsWith('.png')) {
        assert.equal(buf[0], 0x89);
        assert.equal(buf[1], 0x50);
        assert.equal(buf[2], 0x4e);
        assert.equal(buf[3], 0x47);
      }
    }
  });

  await test(`${team.brandName} (${team.abbr}): all 11 live 2026 JSON feeds valid, conference-accurate & paywall-free`, () => {
    const dir = path.join(ROOT, 'data', 'teams', slug);
    const readJson = rel => JSON.parse(fs.readFileSync(path.join(dir, rel), 'utf8'));

    const meta = readJson('meta.json');
    const roster = readJson('roster.json');
    const depth = readJson('depth-chart.json');
    const cap = readJson('cap.json');
    const health = readJson('health.json');
    const news = readJson('news.json');
    const sched = readJson('schedule-matchup.json');
    const seasonal = readJson('seasonal.json');
    const reporters = readJson('reporters.json');
    const beatPods = readJson('beat-podcasts.json');
    const podIdx = readJson('podcasts/index.json');

    assert.equal(meta.teamAbbr, team.abbr);
    assert.ok(meta.teamRecord && /^\d+-\d+/.test(meta.teamRecord), `Invalid record ${meta.teamRecord}`);
    assert.ok(meta.standingSummary.includes(team.division), `Standing summary missing ${team.division}: ${meta.standingSummary}`);
    assert.ok(meta.coaches?.hc && meta.coaches?.gm, 'Missing live coaching staff');

    assert.ok(Array.isArray(roster.players) && roster.players.length >= 50, `Roster too small (${roster.players?.length})`);
    assert.ok(Array.isArray(roster.departedPlayers) && roster.departedPlayers.length >= 3, 'Missing auto-derived departedPlayers');
    assert.ok(Array.isArray(depth.units) && depth.units.length >= 2, 'Depth chart missing units');

    assert.ok(cap.years?.['2026'] && cap.years?.['2027'], 'Cap missing 2026/2027 years');
    assert.ok(Array.isArray(cap.players) && cap.players.length >= 30, `Cap players too low (${cap.players?.length})`);

    assert.ok(Array.isArray(health.practiceReport), 'Missing health.practiceReport');
    assert.ok(Array.isArray(sched.schedule) && sched.schedule.length >= 17, `Schedule too short (${sched.schedule?.length})`);
    assert.ok(sched.teamStats?.units?.length === 4, 'Expected 4 teamStat units');
    assert.ok(sched.teamStats.units[0].title.includes(team.nickname), `Unit title should mention ${team.nickname}`);

    // Verify AFC (Bills) vs NFC (Lions) Monte Carlo conference parity!
    const pp = seasonal.playoffPicture;
    assert.equal(pp.baselineSimulation.conference, team.conference);
    assert.equal(pp.baselineSimulation.targetTeam, team.abbr);
    assert.equal(pp.baselineSimulation.allTeamOdds.length, 16);
    assert.ok(pp.baselineSimulation.allTeamOdds.every(t => t.division.startsWith(team.conference)));

    // Re-run Monte Carlo + Rooting Leverage directly to verify live determinism
    const rerun = runPlayoffMonteCarlo({ ...pp.simulatorInputs, iterations: 1000, seed: 42 });
    assert.equal(rerun.conference, team.conference);
    assert.equal(rerun.teamOdds.abbr, team.abbr);
    const lev = computeRootingGuideLeverage(pp.simulatorInputs, 4);
    assert.ok(Array.isArray(lev) && lev.length > 0);

    // Reporters & Direct X Beat Lists
    assert.ok(reporters.reporters.length >= 35, `Expected >= 35 reporters, got ${reporters.reporters.length}`);
    setActiveTeamConfig(team);
    configureBeatAttributionForTeam(team, reporters, meta.coaches);
    const insidersUrl = buildXBeatListSearchUrl('insiders', { reporters: reporters.reporters, team, coaches: meta.coaches });
    assert.ok(decodeURIComponent(insidersUrl).includes(team.nickname), `Insiders X query should scope to ${team.nickname}`);
    assert.ok(!decodeURIComponent(insidersUrl).includes('49ers'), 'Non-SF X query must NOT reference 49ers');

    // News & Daily Brief & Beat Podcasts
    assert.ok(Array.isArray(news.rawStream) && news.rawStream.length >= 10, `News stream too small (${news.rawStream?.length})`);
    assert.ok(news.dailyTopNewsBrief?.headline && news.dailyTopNewsBrief.bullets?.length >= 2, 'Missing dailyTopNewsBrief');
    for (const it of news.rawStream) {
      assert.ok(!isPaywalledPublisher(it.url), `Paywalled URL leaked into ${slug}: ${it.url}`);
    }
    assert.ok(Array.isArray(beatPods.shows) && beatPods.shows.length >= 4, 'Missing beat podcast shows');
    assert.ok(Array.isArray(podIdx.episodes), 'Missing podcasts/index.json episodes array');
  });
}

await test('All 32 teams configure official club video RSS as plural /rss/videos (never 404 /rss/video)', () => {
  for (const team of ALL_NFL_TEAMS) {
    assert.ok(Array.isArray(team.clubRssUrls) && team.clubRssUrls.length >= 2, `${team.abbr}: missing clubRssUrls`);
    assert.ok(team.clubRssUrls[0].endsWith('/rss/news'), `${team.abbr}: unexpected news RSS ${team.clubRssUrls[0]}`);
    assert.ok(
      team.clubRssUrls[1].endsWith('/rss/videos'),
      `${team.abbr}: video RSS must end with plural /rss/videos, got ${team.clubRssUrls[1]}`
    );
  }
});

await test('configureBeatAttributionForTeam preserves built-in SF reporter outletName, credibilityScore, aliases & non-podium @49ers handle', () => {
  const sfReporters = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'reporters.json'), 'utf8'));
  setActiveTeamConfig('SF');
  configureBeatAttributionForTeam('SF', sfReporters, { hc: 'Kyle Shanahan', gm: 'John Lynch' });

  const barrows = getReporterDirectoryEntry('matt_barrows');
  assert.equal(barrows?.outletName, 'The Athletic', 'Matt Barrows outletName must not be wiped on SF configure');
  assert.equal(barrows?.credibilityScore, 98, 'Matt Barrows credibilityScore must remain 98');

  const maiocco = getReporterDirectoryEntry('matt_maiocco');
  assert.equal(maiocco?.outletName, 'NBC Sports Bay Area');
  assert.equal(maiocco?.credibilityScore, 98);

  const florio = resolveReporterFromNameOrHandle('Mike Florio');
  assert.equal(florio?.id, 'mike_florio', 'Built-in aliases (Mike Florio -> mike_florio) must survive configure');

  const sfHandleOwner = resolveReporterFromNameOrHandle('@49ers');
  assert.equal(sfHandleOwner?.id, '49ers_news', 'Podium subject Kyle Shanahan must not overwrite @49ers official handle');

  // Verify wire attribution does NOT fall back to rewrite aggregator outletName (which would drop StoryRank!)
  const attr = extractBeatAttributionFromText(
    '49ers wide receiver Mike Evans questionable for SNF showdown vs. Vikings; per Matt Barrows',
    { reporterName: '49ers Webzone', outletId: '49ers_webzone', outletName: '49ers Webzone' }
  );
  assert.equal(attr.reporterId, 'matt_barrows');
  assert.equal(attr.outletName, 'The Athletic', 'Must retain The Athletic instead of falling back to 49ers Webzone');
  assert.equal(attr.credibilityScore, 98);

  // Also verify non-SF reporters (Lions) populate outletName & credibilityScore from reporters.json
  const detReporters = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'teams', 'lions', 'reporters.json'), 'utf8'));
  configureBeatAttributionForTeam('DET', detReporters, { hc: 'Dan Campbell', gm: 'Brad Holmes' });
  const birkett = getReporterDirectoryEntry('dave_birkett');
  assert.equal(birkett?.outletName, 'Detroit Free Press');
  assert.ok(birkett?.credibilityScore >= 95, `Expected Dave Birkett credibilityScore >= 95, got ${birkett?.credibilityScore}`);
});

await test('Canary Matchup Intel & Daily Brief: platform API works without BYOK key + Worker uses Gemini 4 Hydrogen XHIGH with Google Search Grounding', async () => {
  const {
    resolveReadOnlyPlatformApiBase,
    refreshDailyMatchupIntelIfDue,
    clearDailyMatchupIntelAttemptLock
  } = await import('../src/services/aiWorkerClient.js');

  // 1. resolveReadOnlyPlatformApiBase enables built-in Pages API on 49ers2, lions & bills (never on GitHub Pages 49ers.joshal.com)
  const origWindow = globalThis.window;
  const origPlatformFlag = globalThis.__PLATFORM_API_ENABLED__;
  const origLocalStorage = globalThis.localStorage;
  const origFetch = globalThis.fetch;

  const lsMap = new Map();
  globalThis.localStorage = {
    getItem: k => (lsMap.has(k) ? lsMap.get(k) : null),
    setItem: (k, v) => lsMap.set(k, String(v)),
    removeItem: k => lsMap.delete(k)
  };

  try {
    globalThis.__PLATFORM_API_ENABLED__ = false;
    for (const host of ['49ers2.joshal.com', 'lions.joshal.com', 'bills.joshal.com']) {
      globalThis.window = { location: { hostname: host, protocol: 'https:', origin: `https://${host}`, search: '' } };
      assert.equal(resolveReadOnlyPlatformApiBase({}), `https://${host}`, `${host} should resolve built-in read-only API base`);
    }
    globalThis.window = { location: { hostname: '49ers.joshal.com', protocol: 'https:', origin: 'https://49ers.joshal.com', search: '' } };
    assert.equal(resolveReadOnlyPlatformApiBase({}), '', '49ers.joshal.com (GitHub Pages) must NOT assume built-in /api/*');

    // 2. Worker /api/matchup-intel uses gemini-4-hydrogen + XHIGH + google_search grounding + SF daily KV + in-flight 202 lock + rejects KV poisoning
    const kvStore = new Map();
    const mockEnv = {
      SHARED_CACHE: {
        async get(k, type) {
          const v = kvStore.get(k);
          if (v == null) return null;
          return type === 'json' ? JSON.parse(v) : v;
        },
        async put(k, v) { kvStore.set(k, String(v)); },
        async delete(k) { kvStore.delete(k); }
      },
      GEMINI_NFL_API_KEY: 'test-key-matchup-qa'
    };

    const sampleAiPayload = JSON.stringify({
      coachingMatchup: {
        headline: "Kyle Shanahan & DC Raheem Morris vs. Minnesota Vikings HC Kevin O'Connell, OC Wes Phillips, DC Brian Flores",
        summary: 'Grounded Week 11 scheme clash pitting San Francisco #1 offensive EPA against Brian Flores #1 defensive EPA and simulated pressure packages.',
        bullets: [
          'Pass-Game Efficiency & Coverage Shell Delta: Shanahan condensed splits and motion attack Minnesota disguised Quarters and Cover 6 rotations.',
          'Run-Scheme vs. Box Math: San Francisco top-ranked zone and gap run game tests Flores light boxes and downhill overhang triggers.',
          'Third-Down & Red-Zone Leverage: San Francisco red-zone touchdown efficiency meets Minnesota league-leading sack rate and pressure fronts.',
          'Special Teams & Venue Factors: Mexico City altitude and field-position margins amplify every punting and field-goal sequence.'
        ]
      },
      keyMatchupsMatrix: [
        {
          phaseTag: 'PASS PROTECTION',
          unitMatchup: 'SF Interior OL vs. MIN Blitz Packages',
          advantage: 'MIN Heavy Edge',
          sfPlayers: ['Dominick Puni', 'Jake Brendel'],
          statComparison: 'SF: 8.32 NY/PA (#1) | MIN: 12.2% Sack Rate (#1)',
          tacticalDetail: 'Dominick Puni and Jake Brendel must sort double-A-gap mugged looks against Dallas Turner and Andrew Van Ginkel without surrendering quick interior pressure.',
          filmTell: 'Watch Minnesota mug both A-gaps with linebackers before dropping one into robber coverage.'
        },
        {
          phaseTag: 'PERIMETER PASSING',
          unitMatchup: 'SF WRs vs. MIN CBs',
          advantage: 'Even Star Clash',
          sfPlayers: ['Keenan Allen', 'Mike Evans'],
          statComparison: 'SF: +5.4% CPOE (#1) | MIN: #2 Pass Defense',
          tacticalDetail: 'With injury designations monitoring perimeter speed, Keenan Allen must win option routes inside against Byron Murphy Jr. and tight intermediate windows.',
          filmTell: 'Observe whether Murphy plays trail technique with safety help over the top on third downs.'
        },
        {
          phaseTag: 'GROUND ATTACK',
          unitMatchup: 'Christian McCaffrey vs. MIN Front Seven',
          advantage: 'SF Edge',
          sfPlayers: ['Christian McCaffrey'],
          statComparison: 'SF: +42.93 Rush EPA (#1) | MIN: #5 Rush Defense',
          tacticalDetail: 'Christian McCaffrey stretches horizontal edges and attacks flat leverages as a receiver to stress Minnesota aggressive edge rushers out of vertical lanes.',
          filmTell: 'Look for 21-personnel motion to identify Bear fronts before outside-zone tosses.'
        },
        {
          phaseTag: 'DEFENSIVE SECONDARY',
          unitMatchup: 'SF Secondary vs. Justin Jefferson',
          advantage: 'MIN Edge',
          sfPlayers: ['Deommodore Lenoir', 'Renardo Green'],
          statComparison: 'SF: #20 Pass Defense | MIN: Justin Jefferson',
          tacticalDetail: 'San Francisco cornerbacks must maintain disciplined cloud leverage and safety capping against Justin Jefferson intermediate crossers and deep digs.',
          filmTell: 'Watch whether Lenoir aligns inside in nickel and receives safety bracket help over Jefferson.'
        }
      ]
    });

    const capturedGeminiReqs = [];
    globalThis.fetch = async (url, init = {}) => {
      const u = String(url);
      if (u.includes('generativelanguage.googleapis.com')) {
        capturedGeminiReqs.push({ url: u, body: JSON.parse(init.body || '{}') });
        return new Response(
          JSON.stringify({ candidates: [{ content: { parts: [{ text: sampleAiPayload }] } }] }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
      if (u.startsWith('https://49ers2.joshal.com/api/matchup-intel')) {
        return canaryWorker.fetch(new Request(u, { method: init.method, headers: init.headers, body: init.body }), mockEnv, {});
      }
      throw new Error(`Unexpected fetch in QA: ${u}`);
    };

    // Client refreshDailyMatchupIntelIfDue with EMPTY prefs (no personal geminiApiKey) on 49ers2.joshal.com
    globalThis.window = { location: { hostname: '49ers2.joshal.com', protocol: 'https:', origin: 'https://49ers2.joshal.com', search: '' } };
    globalThis.__PLATFORM_API_ENABLED__ = true;
    clearDailyMatchupIntelAttemptLock();

    const sfSchedule = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'schedule-matchup.json'), 'utf8'));
    const sfRoster = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'roster.json'), 'utf8'));
    const sfMeta = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'meta.json'), 'utf8'));
    const testAppData = {
      meta: { ...sfMeta, teamAbbr: 'SF' },
      roster: sfRoster,
      scheduleMatchup: JSON.parse(JSON.stringify(sfSchedule))
    };

    const res = await refreshDailyMatchupIntelIfDue({
      appData: testAppData,
      prefs: {},
      nowMs: Date.parse('2026-11-22T20:00:00Z')
    });
    assert.equal(res.updated, true, `Expected Matchup Intel to update without BYOK key, got ${JSON.stringify(res)}`);
    assert.equal(res.modelUsed, 'gemini-4-hydrogen');
    assert.equal(testAppData.scheduleMatchup.upcomingMatchup.aiMatchupMeta?.datePt, '2026-11-22');
    assert.equal(capturedGeminiReqs.length, 1, 'Expected exactly 1 Gemini API call');
    assert.ok(capturedGeminiReqs[0].url.includes('models/gemini-4-hydrogen:generateContent'));
    assert.deepEqual(capturedGeminiReqs[0].body.generationConfig?.thinkingConfig, { thinkingLevel: 'XHIGH' });
    assert.deepEqual(capturedGeminiReqs[0].body.tools, [{ google_search: {} }], 'Canary worker MUST pass live google_search grounding');
    assert.ok(
      String(capturedGeminiReqs[0].body.systemInstruction?.parts?.[0]?.text || '').includes('Kyle Shanahan'),
      'Canary worker MUST prepend SF editorial grounding prompt'
    );

    // Second request hits SF daily KV cache (0 extra Gemini calls)
    const cachedRes = await (
      await canaryWorker.fetch(
        new Request('https://49ers2.joshal.com/api/matchup-intel?team=SF', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            teamAbbr: 'SF',
            seasonYear: 2026,
            week: testAppData.scheduleMatchup.upcomingMatchup.week,
            oppAbbr: testAppData.scheduleMatchup.upcomingMatchup.oppAbbr,
            datePt: '2026-11-22',
            prompt: 'cached read'
          })
        }),
        mockEnv,
        {}
      )
    ).json();
    assert.equal(cachedRes.cached, true, 'Second request on same PT day should hit KV cache');
    assert.equal(capturedGeminiReqs.length, 1, 'KV cache hit must not invoke Gemini again');

    // In-flight lock returns HTTP 202 and does NOT lock browser out permanently
    kvStore.set('lock:matchup:SF:2026:wk12:SEA:2026-11-23', '1');
    const lockResp = await canaryWorker.fetch(
      new Request('https://49ers2.joshal.com/api/matchup-intel?team=SF', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ teamAbbr: 'SF', seasonYear: 2026, week: 12, oppAbbr: 'SEA', datePt: '2026-11-23', prompt: 'test' })
      }),
      mockEnv,
      {}
    );
    assert.equal(lockResp.status, 202, 'Active in-flight matchup lock must return HTTP 202');

    // Non-JSON Gemini text must NOT poison shared KV cache
    globalThis.fetch = async () =>
      new Response(
        JSON.stringify({ candidates: [{ content: { parts: [{ text: 'Pong. Not JSON.' }] } }] }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    const nonJsonResp = await canaryWorker.fetch(
      new Request('https://49ers2.joshal.com/api/matchup-intel?team=SF', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ teamAbbr: 'SF', seasonYear: 2026, week: 13, oppAbbr: 'LAR', datePt: '2026-11-24', prompt: 'ping' })
      }),
      mockEnv,
      {}
    );
    assert.equal(nonJsonResp.status, 200);
    assert.equal(kvStore.has('matchup_intel_v5:SF:2026:wk13:LAR:2026-11-24'), false, 'Non-JSON response must never poison shared KV');
  } finally {
    globalThis.window = origWindow;
    globalThis.__PLATFORM_API_ENABLED__ = origPlatformFlag;
    globalThis.localStorage = origLocalStorage;
    globalThis.fetch = origFetch;
  }
});

// Restore default SF active team singleton
setActiveTeamConfig('SF');

console.log(`\n======================================================`);
console.log(`CANARY MULTI-TEAM QA SUMMARY: ${passed} Passed, ${failed} Failed`);
console.log(`======================================================\n`);
if (failed > 0) process.exit(1);
