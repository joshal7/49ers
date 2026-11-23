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
  ALL_NFL_TEAM_ENTRIES,
  resolveNflTeamMeta,
  mergeRemoteAndLocalOpponentPlayer
} from '../src/services/remoteTeamDossierService.js';
import { renderPlayerDossierSheetHtml } from '../src/views/playerSheetView.js';
import {
  ALL_NFL_TEAMS,
  CANARY_TEAM_SLUGS,
  buildDeterministicCoachingMatchup,
  computeContrastRatio,
  getTeamByAbbr,
  getTeamBySlug,
  getTeamCoaches,
  hasCrossTeam49ersLeak,
  isOfficialTeamHost,
  resolveTeamFromHostname,
  setActiveTeamConfig
} from '../src/config/teamRegistry.js';
import {
  buildAuthoritativeLiveContextSnapshot,
  buildBalancedLeagueComparisonBlock,
  describeSpreadCalibration,
  sanitizeHallucinatedRosterText
} from '../src/engine/groundingValidator.js';
import {
  getDeepAnalysisStage2SystemPrompt,
  getDeepResearchStage1SystemPrompt,
  getNotebookLmStage2SystemPrompt
} from '../src/engine/geminiStudioPrompts.js';
import { resolveCompleteScheduleModel } from '../src/engine/seasonStateMachine.js';
import {
  buildDailyMatchupIntelPrompt,
  parseAndSanitizeDailyMatchupIntel
} from '../src/services/aiWorkerClient.js';
import { renderSeasonMatchupViewHtml } from '../src/views/seasonMatchupView.js';
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
import {
  buildTeamTradeWindow,
  parseClubTransactionsTradesHtml,
  parseNflverseTradesCsv,
  parseTradeSentenceForTeam
} from '../scripts/lib/teamTradeIntelligence.mjs';
import { resolveLiveFranchiseHistoryForOpponent } from '../src/services/dataService.js';
import {
  buildFranchiseHeadToHeadHistory,
  buildScheduleH2hByOpponentMap
} from '../scripts/lib/nflversePlayerContext.mjs';
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

    // If Google Search Grounding hits 429/403 quota on free tier, retry SAME gemini-4-hydrogen XHIGH without tools (no 502)
    let fallbackCalls = 0;
    globalThis.fetch = async (url, init = {}) => {
      const body = JSON.parse(init.body || '{}');
      fallbackCalls += 1;
      if (Array.isArray(body.tools) && body.tools.length > 0) {
        return new Response(JSON.stringify({ error: { message: 'Search grounding quota exceeded' } }), { status: 429 });
      }
      return new Response(
        JSON.stringify({ candidates: [{ content: { parts: [{ text: sampleAiPayload }] } }] }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    };
    const fallbackResp = await canaryWorker.fetch(
      new Request('https://49ers2.joshal.com/api/matchup-intel?team=SF', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ teamAbbr: 'SF', seasonYear: 2026, week: 14, oppAbbr: 'ARI', datePt: '2026-11-25', prompt: 'fallback test' })
      }),
      mockEnv,
      {}
    );
    const fallbackJson = await fallbackResp.json();
    assert.equal(fallbackResp.status, 200, '429 on google_search must fall back cleanly to same-model direct snapshot call');
    assert.equal(fallbackJson.modelUsed, 'gemini-4-hydrogen');
    assert.equal(fallbackJson.grounded, false);
    assert.equal(fallbackCalls, 2, 'Should try search once then same-model direct once');

    // If Google Search Grounding times out / throws AbortError, retry SAME gemini-4-hydrogen XHIGH without downgrading model
    let timeoutCalls = 0;
    globalThis.fetch = async (url, init = {}) => {
      const body = JSON.parse(init.body || '{}');
      timeoutCalls += 1;
      if (Array.isArray(body.tools) && body.tools.length > 0) {
        throw new Error('The operation was aborted due to timeout');
      }
      return new Response(
        JSON.stringify({ candidates: [{ content: { parts: [{ text: sampleAiPayload }] } }] }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    };
    const timeoutResp = await canaryWorker.fetch(
      new Request('https://49ers2.joshal.com/api/matchup-intel?team=SF', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ teamAbbr: 'SF', seasonYear: 2026, week: 15, oppAbbr: 'TEN', datePt: '2026-11-26', prompt: 'timeout fallback test' })
      }),
      mockEnv,
      {}
    );
    const timeoutJson = await timeoutResp.json();
    assert.equal(timeoutResp.status, 200);
    assert.equal(timeoutJson.modelUsed, 'gemini-4-hydrogen', 'Search timeout must stay on gemini-4-hydrogen instead of downgrading');
    assert.equal(timeoutCalls, 2);

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
    assert.equal(kvStore.has('matchup_intel_v6:SF:2026:wk13:LAR:2026-11-24'), false, 'Non-JSON response must never poison shared KV');

    // Cross-team SF-contaminated AI JSON on Bills vs. Chiefs must NEVER be written into shared KV!
    const poisonedBillsPayload = JSON.stringify({
      coachingMatchup: {
        headline: "Kyle Shanahan & DC Raheem Morris vs. Kansas City Chiefs Staff (Levi's Stadium)",
        summary: "Week 12 two-sided coordinator chess match pitting Kyle Shanahan's attack against Kansas City Chiefs.",
        bullets: [
          'Pass-Game Efficiency & Coverage Shell Delta: Shanahan uses condensed splits against Kansas City Chiefs.',
          'Trench Run-Fit & Two-Way Leverage: Raheem Morris leans on light-box run fits.',
          'Red-Zone Execution: San Francisco 49ers red-zone efficiency vs Kansas City Chiefs.'
        ]
      },
      keyMatchupsMatrix: []
    });
    globalThis.fetch = async () =>
      new Response(
        JSON.stringify({ candidates: [{ content: { parts: [{ text: poisonedBillsPayload }] } }] }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    const poisonedRes = await canaryWorker.fetch(
      new Request('https://bills.joshal.com/api/matchup-intel?team=BUF', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ teamAbbr: 'BUF', seasonYear: 2026, week: 12, oppAbbr: 'KC', datePt: '2026-11-22', prompt: 'bills kc test' })
      }),
      mockEnv,
      {}
    );
    assert.equal(poisonedRes.status, 200);
    const poisonedKeys = [...kvStore.keys()].filter(k => k.includes('matchup_intel_v6:BUF:2026:wk12:KC'));
    assert.equal(poisonedKeys.length, 0, 'SF-contaminated Bills vs KC payload must NEVER be cached in shared KV');
  } finally {
    globalThis.window = origWindow;
    globalThis.__PLATFORM_API_ENABLED__ = origPlatformFlag;
    globalThis.localStorage = origLocalStorage;
    globalThis.fetch = origFetch;
  }
});

await test('Multi-team Coaching Matchup, AI Matchup Intel prompt, Spread Calibration & Season Views have ZERO 49ers hardcoding on Bills & Lions', () => {
  // 1. Deterministic Coaching Matchup for Bills vs. Chiefs & Lions vs. Bears
  const bufMatchup = buildDeterministicCoachingMatchup({
    team: 'BUF',
    week: 12,
    oppAbbr: 'KC',
    oppName: 'Kansas City Chiefs',
    oppRecord: '8-2',
    homeAway: 'home'
  });
  assert.ok(bufMatchup.headline.includes('Joe Brady'), `Expected Joe Brady in Bills headline: ${bufMatchup.headline}`);
  assert.ok(bufMatchup.headline.includes('Jim Leonhard'), `Expected Jim Leonhard in Bills headline: ${bufMatchup.headline}`);
  assert.ok(bufMatchup.headline.includes('Andy Reid'), `Expected Andy Reid in Chiefs opponent staff: ${bufMatchup.headline}`);
  assert.ok(bufMatchup.headline.includes('Highmark Stadium'), `Expected Highmark Stadium in Bills home headline: ${bufMatchup.headline}`);
  assert.equal(hasCrossTeam49ersLeak(JSON.stringify(bufMatchup), 'BUF', 'KC'), false, 'Bills vs KC coaching matchup must have zero 49ers leak');

  const detMatchup = buildDeterministicCoachingMatchup({
    team: 'DET',
    week: 12,
    oppAbbr: 'CHI',
    oppName: 'Chicago Bears',
    oppRecord: '8-2',
    homeAway: 'home'
  });
  assert.ok(detMatchup.headline.includes('Dan Campbell'), `Expected Dan Campbell in Lions headline: ${detMatchup.headline}`);
  assert.ok(detMatchup.headline.includes('Kelvin Sheppard'), `Expected Kelvin Sheppard in Lions headline: ${detMatchup.headline}`);
  assert.ok(detMatchup.headline.includes('Ben Johnson'), `Expected Ben Johnson in Bears opponent staff: ${detMatchup.headline}`);
  assert.ok(detMatchup.headline.includes('Ford Field'), `Expected Ford Field in Lions home headline: ${detMatchup.headline}`);
  assert.equal(hasCrossTeam49ersLeak(JSON.stringify(detMatchup), 'DET', 'CHI'), false, 'Lions vs CHI coaching matchup must have zero 49ers leak');

  // SF coachesSeed must be Raheem Morris (not stale Robert Saleh)
  const sfCoaches = getTeamCoaches('SF');
  assert.equal(sfCoaches.dc, 'Raheem Morris', 'SF DC coachesSeed must be Raheem Morris');

  // 2. Spread calibration parses BUF -3.5 as +3.5 BUF margin (favorite), not inverted underdog!
  const bufCal = describeSpreadCalibration('BUF -3.5', 'Kansas City Chiefs', '8-2', 'BUF');
  assert.equal(bufCal.sfMargin, 3.5, 'BUF -3.5 must parse as +3.5 Bills favorite margin');
  assert.ok(bufCal.guidanceLine.includes('BUF'), 'Spread guidance must reference BUF');
  assert.ok(!/San Francisco|49ers|\bSF\b/.test(bufCal.guidanceLine), `Spread guidance leaked SF: ${bufCal.guidanceLine}`);

  // 3. Gemini Studio Prompts for BUF & DET must have zero "Buffalo 49ers", Shanahan, or Morris
  for (const abbr of ['BUF', 'DET']) {
    const p1 = getDeepResearchStage1SystemPrompt(abbr);
    const p2 = getDeepAnalysisStage2SystemPrompt(abbr);
    const p3 = getNotebookLmStage2SystemPrompt(abbr);
    for (const [label, txt] of [['Stage1', p1], ['Stage2', p2], ['PodStage2', p3]]) {
      assert.ok(!/Kyle Shanahan|Raheem Morris|Buffalo 49ers|Detroit 49ers|49ers Faithful/i.test(txt), `${abbr} ${label} prompt leaked 49ers text`);
    }
  }

  // 4. Bills & Lions real JSON bundles: buildDailyMatchupIntelPrompt, buildBalancedLeagueComparisonBlock,
  //    buildAuthoritativeLiveContextSnapshot, parseAndSanitizeDailyMatchupIntel, resolveCompleteScheduleModel, renderSeasonMatchupViewHtml
  for (const [slug, oppAbbr, oppName] of [
    ['bills', 'KC', 'Kansas City Chiefs'],
    ['lions', 'CHI', 'Chicago Bears']
  ]) {
    const team = getTeamBySlug(slug);
    setActiveTeamConfig(team);
    const dir = path.join(ROOT, 'data', 'teams', slug);
    const readJson = rel => JSON.parse(fs.readFileSync(path.join(dir, rel), 'utf8'));
    const appData = {
      meta: readJson('meta.json'),
      roster: readJson('roster.json'),
      depthChart: readJson('depth-chart.json'),
      cap: readJson('cap.json'),
      health: readJson('health.json'),
      news: readJson('news.json'),
      scheduleMatchup: readJson('schedule-matchup.json'),
      seasonal: readJson('seasonal.json'),
      reporters: readJson('reporters.json')
    };
    // Simulate Week 12 matchup rollover vs KC / CHI
    appData.scheduleMatchup.upcomingMatchup = {
      ...appData.scheduleMatchup.upcomingMatchup,
      week: 12,
      oppAbbr,
      oppName,
      oppRecord: '8-2',
      homeAway: 'home',
      betting: { spread: `${team.abbr} -2.5`, overUnder: 48.5 },
      coachingMatchup: buildDeterministicCoachingMatchup({
        team,
        metaCoaches: appData.meta.coaches,
        week: 12,
        oppAbbr,
        oppName,
        oppRecord: '8-2',
        homeAway: 'home'
      })
    };

    const intelPrompt = buildDailyMatchupIntelPrompt(appData);
    assert.ok(intelPrompt.includes(team.fullName), `${slug} intel prompt must include ${team.fullName}`);
    assert.ok(intelPrompt.includes(`${team.abbr} Edge`), `${slug} intel prompt must use ${team.abbr} Edge`);
    assert.equal(hasCrossTeam49ersLeak(intelPrompt, team, oppAbbr), false, `${slug} intel prompt leaked 49ers/Shanahan/Morris`);
    assert.ok(!intelPrompt.includes('San Francisco 49ers'), `${slug} intel prompt must not say San Francisco 49ers`);

    const balancedBlock = buildBalancedLeagueComparisonBlock(appData, { compact: true });
    assert.ok(!/49ERS LEAGUE-WIDE|OVER SF|vs SF #/i.test(balancedBlock), `${slug} balanced block leaked SF labels`);

    const liveSnap = buildAuthoritativeLiveContextSnapshot(appData, { compactForDossier: true });
    assert.ok(liveSnap.includes(appData.meta.coaches.hc), `${slug} live snapshot must include ${appData.meta.coaches.hc}`);
    assert.ok(liveSnap.includes(team.division), `${slug} live snapshot must include ${team.division}`);
    assert.equal(hasCrossTeam49ersLeak(liveSnap, team, oppAbbr), false, `${slug} live snapshot leaked 49ers/Shanahan/Morris`);

    // Sanitizer must reject SF-contaminated response for non-SF team vs non-SF opponent
    const rejected = parseAndSanitizeDailyMatchupIntel(
      {
        coachingMatchup: {
          headline: "Kyle Shanahan & DC Raheem Morris vs. Kansas City Chiefs Staff (Levi's Stadium)",
          summary: 'Week 12 coordinator chess match pitting Kyle Shanahan and DC Raheem Morris against Kansas City Chiefs.',
          bullets: [
            'Pass-Game Efficiency & Coverage Shell Delta: Shanahan uses condensed splits and orbit motion to test coverage.',
            'Trench Run-Fit & Two-Way Leverage: Raheem Morris leans on disguised Quarters and Cover 6 shells.',
            'Situational Execution: San Francisco red-zone discipline vs opponent front seven.'
          ]
        },
        keyMatchupsMatrix: [
          { phaseTag: 'Pass', unitMatchup: 'A vs B', advantage: 'Even', tacticalDetail: 'Detailed two-sentence breakdown of pass rush leverage and route spacing here.' },
          { phaseTag: 'Run', unitMatchup: 'C vs D', advantage: 'Even', tacticalDetail: 'Detailed two-sentence breakdown of gap scheme run fits and box count leverage.' },
          { phaseTag: 'Cov', unitMatchup: 'E vs F', advantage: 'Even', tacticalDetail: 'Detailed two-sentence breakdown of outside leverage and deep safety help.' },
          { phaseTag: 'Red', unitMatchup: 'G vs H', advantage: 'Even', tacticalDetail: 'Detailed two-sentence breakdown of red zone spacing and tight end matchups.' }
        ]
      },
      appData.scheduleMatchup.upcomingMatchup,
      appData.roster.players,
      { team, oppAbbr }
    );
    assert.equal(rejected, null, `${slug} parser must reject SF-contaminated coaching matchup`);

    // Sanitizer must NOT rewrite former 49er names into 'Raheem Morris' or 'Brock Purdy' on non-SF teams
    const nonSfClean = sanitizeHallucinatedRosterText(
      'Robert Saleh and Sam Darnold visited the opponent facility.',
      appData.roster.players,
      { team }
    );
    assert.ok(!nonSfClean.includes('Raheem Morris') && !nonSfClean.includes('Brock Purdy'), `${slug} sanitizer must not inject SF names`);

    // Regular-season Bye Week must remain seasonType REG (Weeks 5..14) and NEVER trigger premature playoff clinch / homefield advantage
    const regByeItems = (appData.scheduleMatchup.schedule || []).filter(g => g.isByeWeek);
    assert.equal(regByeItems.length, 1, `${slug} schedule must contain its single regular-season bye week`);
    assert.equal(regByeItems[0].seasonType, 'REG', `${slug} regular-season bye week must be seasonType REG (never POST)`);
    assert.ok(
      Number(regByeItems[0].week) >= 5 && Number(regByeItems[0].week) <= 14,
      `${slug} regular-season bye week must be in Weeks 5..14 (got ${regByeItems[0].week})`
    );
    assert.equal(regByeItems[0].postseasonRound, undefined, `${slug} regular-season bye must not have postseasonRound`);

    const liveSchedModel = resolveCompleteScheduleModel(appData);
    const liveMakePlayoffsPct = Number(appData?.seasonal?.playoffPicture?.baselineSimulation?.sfOdds?.makePlayoffsPct ?? 0);
    if (liveMakePlayoffsPct < 99.95 && !appData?.meta?.teamStatus?.clinchedPlayoffs) {
      assert.equal(
        liveSchedModel.postseasonStatus.hasClinchedSeed1Bye,
        false,
        `${slug} unclinched (${liveMakePlayoffsPct}% playoffs) must NOT report hasClinchedSeed1Bye=true`
      );
      assert.equal(
        liveSchedModel.postseasonStatus.hasClinchedPlayoffs,
        false,
        `${slug} unclinched (${liveMakePlayoffsPct}% playoffs) must NOT report hasClinchedPlayoffs=true`
      );
      assert.equal(
        liveSchedModel.postseasonGames.length,
        0,
        `${slug} unclinched (${liveMakePlayoffsPct}% playoffs) must NOT inject premature postseason games`
      );
      const liveSchedHtml = renderSeasonMatchupViewHtml({
        appData,
        seasonSub: 'schedule',
        schedulePrevExpanded: true
      });
      assert.ok(
        !liveSchedHtml.includes('Homefield Advantage Clinched'),
        `${slug} unclinched schedule HTML must NOT display "Homefield Advantage Clinched"`
      );
      assert.ok(
        !liveSchedHtml.includes('First-Round Bye'),
        `${slug} unclinched schedule HTML must NOT display "First-Round Bye"`
      );
      assert.ok(
        liveSchedHtml.includes('data-regular-bye="true"'),
        `${slug} schedule HTML must render regular-season bye week cleanly`
      );
    }

    // Postseason schedule model for AFC Bills must use AFC + Highmark Stadium + NFC Champion (TBD)
    if (team.abbr === 'BUF') {
      const postModel = resolveCompleteScheduleModel(
        {
          ...appData,
          meta: { ...appData.meta, teamStatus: { clinchedPlayoffs: true, clinchedDivision: true, clinchedSeed1Bye: true } }
        },
        { teamOdds: { makePlayoffsPct: 100, winDivisionPct: 100, seed1ByePct: 100 } }
      );
      const postStr = JSON.stringify(postModel.postseasonGames) + JSON.stringify(postModel.postseasonStatus);
      assert.ok(postStr.includes('Highmark Stadium'), 'Bills postseason projection must use Highmark Stadium');
      assert.ok(postStr.includes('AFC'), 'Bills postseason projection must use AFC');
      assert.ok(!/Levi['’]?s Stadium|Santa Clara|NFC West|49ers/i.test(postStr), 'Bills postseason projection leaked Levi/NFC West/49ers');
    }

    // Rendered Matchup, Stats & Draft HTML must contain zero 49ers hardcoding
    const matchupHtml = renderSeasonMatchupViewHtml({ appData, seasonSubTab: 'matchup' });
    assert.ok(matchupHtml.includes(`${team.nickname} Side:`), `${slug} matchup view must say "${team.nickname} Side:"`);
    assert.ok(matchupHtml.includes(`Full ${team.nickname} Health`), `${slug} matchup view must say "Full ${team.nickname} Health"`);
    assert.ok(!matchupHtml.includes('49ers Side:'), `${slug} matchup view must NOT say "49ers Side:"`);
    assert.ok(!matchupHtml.includes('Full 49ers Health'), `${slug} matchup view must NOT say "Full 49ers Health"`);
    assert.equal(hasCrossTeam49ersLeak(matchupHtml, team, oppAbbr), false, `${slug} matchup view HTML leaked 49ers/Shanahan/Morris/Levi's`);

    const statsHtml = renderSeasonMatchupViewHtml({ appData, seasonSubTab: 'stats' });
    assert.ok(!statsHtml.includes('PFR 49ers'), `${slug} stats view must NOT say "PFR 49ers"`);

    const draftHtml = renderSeasonMatchupViewHtml({ appData, seasonSubTab: 'draft_prep' });
    assert.ok(!draftHtml.includes('49ers 1st-pick'), `${slug} draft view must NOT say "49ers 1st-pick"`);
    assert.ok(!draftHtml.includes('Shanahan / Lynch'), `${slug} draft view must NOT say "Shanahan / Lynch"`);
  }

  // Legitimate Bills vs. 49ers matchup IS allowed to reference Kyle Shanahan / Raheem Morris
  assert.equal(
    hasCrossTeam49ersLeak('Joe Brady vs. Kyle Shanahan & DC Raheem Morris', 'BUF', 'SF'),
    false,
    'Legitimate BUF vs SF matchup must NOT be flagged as a cross-team leak'
  );
  setActiveTeamConfig('SF');
});

await test('Player-Level Parity & Zero Regressions (Spider Charts, Stats, Snaps, Leaderboards, Health, Depth Chart, Draft Recap)', () => {
  for (const slug of ['lions', 'bills']) {
    const dir = path.join(ROOT, 'data', 'teams', slug);
    const roster = JSON.parse(fs.readFileSync(path.join(dir, 'roster.json'), 'utf8'));
    const health = JSON.parse(fs.readFileSync(path.join(dir, 'health.json'), 'utf8'));
    const dc = JSON.parse(fs.readFileSync(path.join(dir, 'depth-chart.json'), 'utf8'));
    const seasonal = JSON.parse(fs.readFileSync(path.join(dir, 'seasonal.json'), 'utf8'));
    const sched = JSON.parse(fs.readFileSync(path.join(dir, 'schedule-matchup.json'), 'utf8'));
    const players = roster.players || [];

    assert.ok(players.length >= 60, `${slug} roster should have >= 60 players`);
    assert.ok(
      Object.keys(roster.positionalLeaderboards || {}).length >= 100,
      `${slug} must populate >= 100 positional leaderboards`
    );
    assert.ok(
      Object.keys(roster.peerDirectory || {}).length >= 800,
      `${slug} must populate >= 800 league peers`
    );

    let withStats2026 = 0;
    let withStatProfile = 0;
    let withCareer = 0;
    let withSnaps = 0;
    let withRealDraft = 0;
    for (const p of players) {
      assert.ok(p.spiderProfile && Array.isArray(p.spiderProfile.axes) && p.spiderProfile.axes.length >= 6, `${slug} ${p.name} missing spiderProfile axes`);
      assert.ok(Number.isFinite(p.spiderProfile.compositeRas), `${slug} ${p.name} missing compositeRas`);
      assert.ok(Number.isFinite(p.health?.playProbabilityPct), `${slug} ${p.name} missing health.playProbabilityPct`);
      assert.ok(Boolean(p.health?.playBadgeLabel), `${slug} ${p.name} missing health.playBadgeLabel`);
      assert.ok(!/san-francisco-49ers/i.test(p.otcUrl || ''), `${slug} ${p.name} leaked 49ers OTC URL`);
      if (p.stats2026) withStats2026 += 1;
      if (p.statProfile2026?.hasActiveStats) withStatProfile += 1;
      if ((p.careerSeasons || []).length > 0) withCareer += 1;
      if ((p.snapSummary?.offenseSnaps || 0) + (p.snapSummary?.defenseSnaps || 0) + (p.snapSummary?.stSnaps || 0) > 0) withSnaps += 1;
      if (/^\d{4}\s*•\s*Rd\s*\d+,\s*Pick\s*#\d+/.test(p.draftInfo || '')) withRealDraft += 1;
    }
    assert.ok(withStats2026 >= 40, `${slug} expected >= 40 players with stats2026, got ${withStats2026}`);
    assert.ok(withStatProfile >= 45, `${slug} expected >= 45 players with statProfile2026, got ${withStatProfile}`);
    assert.ok(withCareer >= 50, `${slug} expected >= 50 players with careerSeasons, got ${withCareer}`);
    assert.ok(withSnaps >= 45, `${slug} expected >= 45 players with snapSummary, got ${withSnaps}`);
    assert.ok(withRealDraft >= 35, `${slug} expected >= 35 drafted players with real draftInfo, got ${withRealDraft}`);

    // Practice report & opponent health invariants (no undefined probabilities, no healthy Active fantasy recaps)
    for (const r of health.practiceReport || []) {
      assert.ok(Number.isFinite(r.playProbabilityPct), `${slug} practiceReport ${r.name} missing playProbabilityPct`);
      assert.ok(Boolean(r.playBadgeLabel), `${slug} practiceReport ${r.name} missing playBadgeLabel`);
      assert.ok(
        !(r.gameStatus === 'Active' && /^healthy$/i.test(r.injuryType || '') && r.wed === '-' && r.thu === '-' && r.fri === '-'),
        `${slug} practiceReport polluted with healthy active player ${r.name}`
      );
      assert.ok(
        !(r.gameStatus === 'Active' && r.playProbabilityPct === 0),
        `${slug} practiceReport contradiction on ${r.name}: Active yet 0% Out`
      );
    }
    for (const oppRow of sched.upcomingMatchup?.opponentHealth?.injuryReport || []) {
      assert.ok(Number.isFinite(oppRow.playProbabilityPct), `${slug} opponentHealth ${oppRow.name} missing playProbabilityPct`);
      assert.ok(Boolean(oppRow.playBadgeLabel), `${slug} opponentHealth ${oppRow.name} missing playBadgeLabel`);
    }

    // Depth chart unit naming & ordering (Special Teams must NEVER be labeled "Offense (Special Teams)")
    const unitNames = (dc.units || []).map(u => u.unitName);
    assert.ok(!unitNames.some(n => /offense\s*\(\s*special/i.test(n)), `${slug} depth chart mislabeled Special Teams as Offense`);
    const offIdx = unitNames.findIndex(n => /^Offense/i.test(n));
    const defIdx = unitNames.findIndex(n => /^Defense/i.test(n));
    const stIdx = unitNames.findIndex(n => /^Special Teams/i.test(n));
    if (offIdx >= 0 && defIdx >= 0) assert.ok(offIdx < defIdx, `${slug} Offense must precede Defense`);
    if (defIdx >= 0 && stIdx >= 0) assert.ok(defIdx < stIdx, `${slug} Defense must precede Special Teams`);

    // Draft Recap 2026 picks schema + spiderProfile
    const picks = seasonal.draftClass2026?.picks || [];
    assert.ok(picks.length >= 4, `${slug} draftClass2026 should have >= 4 picks, got ${picks.length}`);
    for (const pk of picks) {
      assert.ok(Number.isFinite(pk.round) && pk.round >= 1 && pk.round <= 7, `${slug} draft pick ${pk.name} invalid round`);
      assert.ok(Number.isFinite(pk.pick) && pk.pick >= 1 && pk.pick <= 262, `${slug} draft pick ${pk.name} missing pick number`);
      assert.ok(Boolean(pk.roleSummary), `${slug} draft pick ${pk.name} missing roleSummary`);
      assert.ok(pk.spiderProfile && pk.spiderProfile.axes?.length >= 6, `${slug} draft pick ${pk.name} missing spiderProfile`);
    }

    // Roster regression guards: OTC non-active salary recovery, zero retired ghosts, zero duplicate active jerseys,
    // zero cap.json 2026 non-active leaks, 100% consistent Practice Squad 0% badges, and non-empty archetypeNote
    const cap = JSON.parse(fs.readFileSync(path.join(dir, 'cap.json'), 'utf8'));
    const activePlayers = players.filter(p => p.rosterBucket === 'active');
    const psPlayers = players.filter(p => p.rosterBucket === 'practice_squad');
    const irPlayers = players.filter(p => p.rosterBucket === 'ir');

    assert.ok(psPlayers.length >= 10, `${slug} expected >= 10 practice squad players`);
    for (const ps of psPlayers) {
      assert.equal(ps.health?.playProbabilityPct, 0, `${slug} PS player ${ps.name} must have 0% playProbabilityPct`);
      assert.equal(ps.health?.playBadgeLabel, '0% • Prac. Squad', `${slug} PS player ${ps.name} must show 0% • Prac. Squad`);
      assert.equal(ps.health?.status, 'Practice Squad', `${slug} PS player ${ps.name} must have status "Practice Squad"`);
    }
    for (const p of players) {
      assert.ok(Boolean(p.health?.archetypeNote), `${slug} ${p.name} missing health.archetypeNote`);
    }
    const activeJerseys = new Set();
    for (const p of activePlayers) {
      if (p.jersey != null) {
        assert.ok(!activeJerseys.has(p.jersey), `${slug} duplicate Active 53 jersey #${p.jersey} (${p.name})`);
        activeJerseys.add(p.jersey);
      }
    }
    const cap26NonActive = (cap.players || []).filter(p => p.contractsByYear?.['2026'] && p.rosterBucket !== 'active');
    assert.equal(cap26NonActive.length, 0, `${slug} cap.json leaked non-active players into 2026 active cap table: ${cap26NonActive.map(p => p.name).join(', ')}`);
    assert.ok(irPlayers.every(p => p.capHit2026 > 0), `${slug} all IR players should have OTC 2026 cap charges`);

    if (slug === 'lions') {
      assert.ok(!players.some(p => p.name === 'Justin Jackson'), 'Retired 2022 ESPN ghost Justin Jackson must be purged from Lions roster');
      const harper = players.find(p => p.name === 'Thomas Harper');
      assert.ok(harper && harper.capHit2026 >= 1_000_000, `Lions Thomas Harper must have OTC salary (got ${harper?.capHit2026})`);
      const joseph = players.find(p => p.name === 'Kerby Joseph');
      assert.ok(joseph && joseph.capHit2026 >= 5_000_000, `Lions Kerby Joseph must have OTC PUP salary (got ${joseph?.capHit2026})`);
    }
    if (slug === 'bills') {
      const shavers = players.find(p => p.name === 'Tyrell Shavers');
      assert.ok(shavers && shavers.capHit2026 >= 500_000, `Bills Tyrell Shavers must have OTC PUP salary (got ${shavers?.capHit2026})`);
      assert.equal(activePlayers.filter(p => !(p.capHit2026 > 0)).length, 0, 'All 53 Bills active players must have salaries');
    }

    // Spotlight check: Jahmyr Gibbs on Lions must have full official Combine spider chart, 2026 + career stats & clean health
    if (slug === 'lions') {
      const gibbs = players.find(p => p.name === 'Jahmyr Gibbs');
      assert.ok(gibbs, 'Jahmyr Gibbs must exist on Lions roster');
      assert.equal(gibbs.pfrId, 'GibbJa01');
      assert.equal(gibbs.gsisId, '00-0039139');
      assert.equal(gibbs.otcSlug, 'jahmyr-gibbs');
      assert.equal(gibbs.draftInfo, '2023 • Rd 1, Pick #12');
      assert.equal(gibbs.spiderProfile.sourceType, 'NFL Combine Official');
      assert.ok(gibbs.primarySnapPct > 0, 'Jahmyr Gibbs primarySnapPct must be > 0');
      assert.ok(gibbs.stats2026 && gibbs.stats2026.rushing.yards > 0, 'Jahmyr Gibbs must have 2026 rushing stats');
      assert.ok(gibbs.statProfile2026?.hasActiveStats, 'Jahmyr Gibbs must have statProfile2026');
      assert.ok(gibbs.careerSeasons.length >= 4, 'Jahmyr Gibbs must have >= 4 career seasons (2023-2026)');
      assert.equal(gibbs.health.isOnPracticeReport, false, 'Healthy Jahmyr Gibbs must not be on practice report');
      assert.ok(gibbs.health.playProbabilityPct >= 95, 'Healthy Jahmyr Gibbs must have >= 95% play probability');
    }

    // Recent Meetings (franchiseHistory) must be populated on every canary team + precomputed byOpponent map
    const teamAbbrExpected = slug === 'lions' ? 'DET' : 'BUF';
    const fh = sched.upcomingMatchup?.franchiseHistory || {};
    assert.ok(
      /^\d+-\d+(?:-\d+)? in last \d+ meetings?$/.test(fh.recentRecord || ''),
      `${slug} franchiseHistory.recentRecord missing/malformed: ${JSON.stringify(fh.recentRecord)}`
    );
    assert.ok(
      Array.isArray(fh.recentGames) && fh.recentGames.length >= 4,
      `${slug} franchiseHistory.recentGames should have >= 4 historical meetings, got ${fh.recentGames?.length || 0}`
    );
    for (const g of fh.recentGames) {
      assert.ok(Number.isFinite(g.season) && g.season >= 1999, `${slug} recentGame invalid season: ${JSON.stringify(g)}`);
      assert.ok(/^\d{4}-\d{2}-\d{2}$/.test(g.date || ''), `${slug} recentGame invalid date: ${g.date}`);
      assert.ok(
        String(g.scoreDisplay || '').startsWith(`${teamAbbrExpected} `),
        `${slug} recentGame scoreDisplay must start with "${teamAbbrExpected} ", got "${g.scoreDisplay}"`
      );
      assert.ok(/^https:\/\//.test(g.boxscoreUrl || ''), `${slug} recentGame boxscoreUrl must be https: ${g.boxscoreUrl}`);
    }
    const schedOpps = new Set(
      (sched.schedule || [])
        .filter(g => !g.isByeWeek && g.opponent?.abbr && g.opponent.abbr !== 'TBD')
        .map(g => g.opponent.abbr)
    );
    assert.ok(fh.byOpponent && typeof fh.byOpponent === 'object', `${slug} franchiseHistory.byOpponent map missing`);
    for (const oppA of schedOpps) {
      assert.ok(
        fh.byOpponent[oppA] && Array.isArray(fh.byOpponent[oppA].recentGames) && fh.byOpponent[oppA].recentGames.length >= 1,
        `${slug} franchiseHistory.byOpponent[${oppA}] missing historical games`
      );
    }
  }
});

test('Cross-team native player dossiers work symmetrically for all 32 teams (including DET/BUF viewing SF or other opponents)', () => {
  assert.equal(ALL_NFL_TEAM_ENTRIES.length, 32, 'Remote dossier registry must cover all 32 NFL teams');
  // 1. On Lions (DET), viewing an SF opponent player treats SF as remote (`49ers.joshal.com`, `49ers.com Report`)
  setActiveTeamConfig('DET');
  const sfMeta = resolveNflTeamMeta('SF');
  const mergedSfOnLions = mergeRemoteAndLocalOpponentPlayer({
    remotePlayer: {
      id: '4361741',
      name: 'Brock Purdy',
      position: 'QB',
      unit: 'Offense',
      rosterBucket: 'active',
      jersey: 13,
      espnUrl: 'https://www.espn.com/nfl/player/_/id/4361741/brock-purdy',
      otcUrl: 'https://overthecap.com/player/brock-purdy/10307/',
      primarySnapPct: 98,
      health: { status: 'Active', injuryType: 'Healthy', playProbabilityPct: 99, playBadgeLabel: '99% • Cleared' }
    },
    teamMeta: sfMeta,
    activeTeamAbbr: 'DET'
  });
  assert.equal(mergedSfOnLions.teamContext.isRemoteTeam, true, 'SF must be treated as remote when active team is DET');
  const sfOnLionsOverview = renderPlayerDossierSheetHtml({
    player: mergedSfOnLions.player,
    activeTab: 'overview',
    teamContext: mergedSfOnLions.teamContext,
    remoteStatus: { state: 'ready' }
  });
  assert.ok(sfOnLionsOverview.includes('49ers.joshal.com'), 'SF remote dossier on Lions must link 49ers.joshal.com');
  const sfOnLionsHealth = renderPlayerDossierSheetHtml({
    player: mergedSfOnLions.player,
    activeTab: 'health',
    teamContext: mergedSfOnLions.teamContext,
    remoteStatus: { state: 'ready' }
  });
  assert.ok(sfOnLionsHealth.includes('49ers.com Report'), 'SF remote dossier Health on Lions must show 49ers.com Report');
  assert.ok(!sfOnLionsHealth.includes('detroitlions.com Report'), 'SF remote dossier Health on Lions must not leak Lions report');

  // 2. Live Lions & Bills Matchup views wire opposing players to open-opponent-player-sheet instead of ESPN links
  for (const [slug, abbr] of [['lions', 'DET'], ['bills', 'BUF']]) {
    setActiveTeamConfig(abbr);
    const dataDir = path.join(ROOT, 'data', 'teams', slug);
    const mockData = {
      meta: JSON.parse(fs.readFileSync(path.join(dataDir, 'meta.json'), 'utf8')),
      roster: JSON.parse(fs.readFileSync(path.join(dataDir, 'roster.json'), 'utf8')),
      health: JSON.parse(fs.readFileSync(path.join(dataDir, 'health.json'), 'utf8')),
      scheduleMatchup: JSON.parse(fs.readFileSync(path.join(dataDir, 'schedule-matchup.json'), 'utf8')),
      news: JSON.parse(fs.readFileSync(path.join(dataDir, 'news.json'), 'utf8')),
      cap: JSON.parse(fs.readFileSync(path.join(dataDir, 'cap.json'), 'utf8')),
      seasonal: JSON.parse(fs.readFileSync(path.join(dataDir, 'seasonal.json'), 'utf8'))
    };
    const matchupHtml = renderSeasonMatchupViewHtml({ subTab: 'matchup', appData: mockData, userPrefs: {} });
    const oppIdx = matchupHtml.indexOf('id="opponentHealthSection"');
    assert.ok(oppIdx >= 0, `${slug} Matchup must render #opponentHealthSection`);
    const oppSlice = matchupHtml.slice(oppIdx, oppIdx + 18000);
    assert.ok(
      oppSlice.includes('data-action="open-opponent-player-sheet"'),
      `${slug} Matchup opponent players must open native cross-team dossier sheet`
    );
    assert.ok(
      !oppSlice.includes('href="https://www.espn.com/nfl/player/'),
      `${slug} Matchup opponent players must not link directly to ESPN player pages`
    );
  }
});

await test('Multi-Team Trade Window: unit parsers + live Lions & Bills completed trades, needs, targets, pitfalls, rumors & rendered HTML', () => {
  // 1. Unit parser assertions
  const bufTeam = getTeamByAbbr('BUF');
  const detTeam = getTeamByAbbr('DET');
  const parsedIn = parseTradeSentenceForTeam(
    'Acquired DB Amani Hooker and a 2027 fifth-round draft pick from Tennessee for a 2027 second-round draft pick. Released DB A.J. Woods.',
    bufTeam,
    '2026-11-10T08:00:00Z'
  );
  assert.equal(parsedIn.direction, 'incoming');
  assert.equal(parsedIn.player, 'Amani Hooker');
  assert.equal(parsedIn.partnerAbbr, 'TEN');
  assert.match(parsedIn.costSummary, /2027 second-round/i);

  const parsedOut = parseTradeSentenceForTeam(
    'Traded center Sedrick Van Pran-Granger and a 2027 seventh-round pick (BUF) to the Indianapolis Colts for a 2027 sixth-round pick (IND).',
    bufTeam,
    '2026-08-30T16:00:00Z'
  );
  assert.equal(parsedOut.direction, 'outgoing');
  assert.equal(parsedOut.player, 'Sedrick Van Pran-Granger');
  assert.equal(parsedOut.partnerAbbr, 'IND');
  assert.match(parsedOut.costSummary, /2027 sixth-round/i);

  const clubRows = parseClubTransactionsTradesHtml(
    '<div>2026</div><div>November</div><div>11/09</div><div>The Detroit Lions acquire S Andre Cisco via trade with the New York Jets and waive TE Jackson Meeks.</div>',
    detTeam,
    2026
  );
  assert.equal(clubRows.length, 1);
  assert.equal(clubRows[0].dateIso, '2026-11-09T16:00:00Z');

  const csvDeals = parseNflverseTradesCsv(
    'trade_id,season,trade_date,gave,received,pick_season,pick_round,pick_number,conditional,pfr_id,pfr_name\n' +
      '2042,2026,2026-03-02,HOU,DET,,,,,ScruJu00,Juice Scruggs\n' +
      '2042,2026,2026-03-02,DET,HOU,,,,,MontDa01,David Montgomery\n',
    2026
  );
  assert.equal(csvDeals.length, 1);
  assert.equal(csvDeals[0].legs.length, 2);

  // Cost-preservation guard: never overwrite known cost ("David Montgomery") with "Undisclosed Draft Compensation"
  const mergedTest = buildTeamTradeWindow({
    team: detTeam,
    seasonYear: 2026,
    currentWeek: 12,
    nowIso: '2026-11-22T20:00:00Z',
    cap26: { teamCapSpace: 32_851_310 },
    cap27: { teamCapSpace: 62_075_008 },
    players: [{ id: '4361425', name: 'Juice Scruggs', position: 'G', jersey: 70, rosterBucket: 'active', primarySnapPct: 83, contractsByYear: {} }],
    clubTransactionsHtml: '<div>2026</div><div>March</div><div>03/11</div><div>The Detroit Lions acquire OL Juice Scruggs via trade with the Houston Texans.</div>',
    leagueTradeCtx: {
      leagueTrades: csvDeals,
      capRankingsByYear: { 2026: new Map(), 2027: new Map() },
      sellerCandidates: [],
      sellerTraps: [],
      nflPlayersByNorm: new Map(),
      nflPlayersByPfr: new Map(),
      statsByGsis: new Map(),
      statsByNorm: new Map()
    }
  });
  const scruggsTest = mergedTest.tradeWarRoom.completed2026Moves.find(m => m.player === 'Juice Scruggs');
  assert.ok(scruggsTest, 'Juice Scruggs must appear in merged completed moves');
  assert.match(scruggsTest.costSummary, /David Montgomery/i, 'Known trade cost must never be overwritten by Undisclosed');

  // 2. Live DET & BUF dataset + rendered Trade HTML verification
  for (const slug of ['lions', 'bills']) {
    const dir = path.join(ROOT, 'data', 'teams', slug);
    const meta = JSON.parse(fs.readFileSync(path.join(dir, 'meta.json'), 'utf8'));
    const roster = JSON.parse(fs.readFileSync(path.join(dir, 'roster.json'), 'utf8'));
    const seasonal = JSON.parse(fs.readFileSync(path.join(dir, 'seasonal.json'), 'utf8'));
    const team = getTeamBySlug(slug);
    const tw = seasonal.tradeWarRoom || {};
    const validIds = new Set((roster.players || []).map(p => String(p.id)));
    const rosterNames = new Set((roster.players || []).map(p => p.name.toLowerCase()));

    assert.ok(Array.isArray(tw.purchasingPower) && tw.purchasingPower.length === 3, `${slug} purchasingPower must have 3 cards`);
    assert.ok(Array.isArray(tw.completed2026Moves) && tw.completed2026Moves.length >= 2, `${slug} completed2026Moves must have >= 2 real 2026 trades`);
    assert.ok(Array.isArray(tw.topNeeds) && tw.topNeeds.length === 4, `${slug} topNeeds must have 4 ranked needs`);
    assert.ok(Array.isArray(tw.realisticTargets) && tw.realisticTargets.length >= 5, `${slug} realisticTargets must have >= 5 live seller targets`);
    assert.ok(Array.isArray(tw.pitfallsToAvoid) && tw.pitfallsToAvoid.length >= 2, `${slug} pitfallsToAvoid must have >= 2 traps`);
    assert.ok(Array.isArray(tw.tieredRumors) && tw.tieredRumors.length >= 3, `${slug} tieredRumors must have >= 3 grounded intel cards`);

    // Verify specific real 2026 trades
    if (slug === 'lions') {
      const cisco = tw.completed2026Moves.find(m => /Andre Cisco/i.test(m.player));
      const scruggs = tw.completed2026Moves.find(m => /Juice Scruggs/i.test(m.player));
      assert.ok(cisco && cisco.acquiredFrom === 'NYJ' && validIds.has(String(cisco.playerId)), 'Lions must include clickable Andre Cisco trade from NYJ');
      assert.ok(scruggs && scruggs.acquiredFrom === 'HOU' && /David Montgomery/i.test(scruggs.costSummary), 'Lions must include Juice Scruggs trade from HOU for David Montgomery');
    } else {
      const hooker = tw.completed2026Moves.find(m => /Amani Hooker/i.test(m.player));
      const moore = tw.completed2026Moves.find(m => /DJ Moore/i.test(m.player));
      const taron = tw.completed2026Moves.find(m => /Taron Johnson/i.test(m.player));
      assert.ok(hooker && hooker.acquiredFrom === 'TEN' && validIds.has(String(hooker.playerId)), 'Bills must include clickable Amani Hooker trade from TEN');
      assert.ok(moore && moore.acquiredFrom === 'CHI' && validIds.has(String(moore.playerId)), 'Bills must include clickable DJ Moore trade from CHI');
      assert.ok(taron && taron.direction === 'outgoing' && taron.acquiredFrom === 'LV', 'Bills must include outgoing Taron Johnson trade to LV');
    }

    for (const m of tw.completed2026Moves) {
      if (m.playerId) assert.ok(validIds.has(String(m.playerId)), `${slug} trade ${m.player} playerId must exist on roster`);
      assert.ok(String(m.sourceUrl || '').startsWith('https://'), `${slug} trade ${m.player} missing https sourceUrl`);
    }
    for (const t of tw.realisticTargets) {
      assert.notEqual(t.teamAbbr, team.abbr, `${slug} target ${t.name} must not already be on ${team.abbr}`);
      assert.ok(!rosterNames.has(t.name.toLowerCase()), `${slug} target ${t.name} must not already be on active roster`);
      assert.ok(String(t.sourceUrl || '').startsWith('https://overthecap.com/player/'), `${slug} target ${t.name} must link to OverTheCap`);
      assert.ok(!new RegExp(`via\\s+${team.abbr}\\b`, 'i').test(t.projectedPickCost), `${slug} own pick cost must not say "via ${team.abbr}"`);
    }
    for (const pf of tw.pitfallsToAvoid) {
      assert.ok(Array.isArray(pf.exampleLinks) && pf.exampleLinks.length > 0, `${slug} pitfall missing exampleLinks`);
      for (const el of pf.exampleLinks) {
        assert.ok(String(el.url || '').startsWith('https://overthecap.com/player/'), `${slug} pitfall link must point to OverTheCap`);
      }
    }
    for (const r of tw.tieredRumors) {
      assert.ok(!/\bmock draft\b/i.test(r.summary), `${slug} trade intel must not include unrelated mock draft headlines`);
    }

    // Verify rendered Trade UI HTML
    setActiveTeamConfig(team.abbr);
    const html = renderSeasonMatchupViewHtml({
      appData: { meta, roster, seasonal, scheduleMatchup: {}, health: {}, cap: {}, news: { rawStream: [] } },
      seasonSub: 'trade'
    });
    assert.ok(html.includes('Cap &amp; Draft Constraints'), `${slug} Trade UI missing Cap & Draft Constraints`);
    assert.ok(html.includes('Earlier Completed Trades'), `${slug} Trade UI missing inline Earlier Completed Trades collapsible`);
    assert.ok(!html.includes('No completed '), `${slug} Trade UI must not render empty completed-trades message`);
    assert.ok(html.includes('Targets to Avoid'), `${slug} Trade UI missing Targets to Avoid`);
    assert.ok(html.includes('Trade Intel &amp; Rumors'), `${slug} Trade UI missing Trade Intel & Rumors`);
    if (slug === 'bills') {
      assert.ok(html.includes('→') && html.includes('Return:'), 'Bills outgoing trade cards must render → and Return:');
    }
    assert.equal(hasCrossTeam49ersLeak(html, team), false, `${slug} rendered Trade UI must have zero 49ers leaks`);
  }
  setActiveTeamConfig('SF');
});

await test('buildFranchiseHeadToHeadHistory handles ties, modern relocations, zero cross-franchise conflation & rollover merge', () => {
  const synthGames = [
    // DET vs PIT tie + win
    { season: '2021', game_type: 'REG', gameday: '2021-11-14', home_team: 'PIT', home_score: '16', away_team: 'DET', away_score: '16', location: 'Home', overtime: '1', espn: '401326470', pfr: '' },
    { season: '2025', game_type: 'REG', gameday: '2025-12-21', home_team: 'DET', home_score: '27', away_team: 'PIT', away_score: '20', location: 'Home', overtime: '0', espn: '401772900', pfr: '' },
    // Relocated franchises: LV/OAK & LAR/LA/STL
    { season: '2016', game_type: 'REG', gameday: '2016-12-04', home_team: 'OAK', home_score: '38', away_team: 'BUF', away_score: '24', location: 'Home', overtime: '0', espn: '400874679', pfr: '' },
    { season: '2023', game_type: 'REG', gameday: '2023-09-17', home_team: 'BUF', home_score: '38', away_team: 'LV', away_score: '10', location: 'Home', overtime: '0', espn: '401547412', pfr: '' },
    // Cross-franchise guard: HOU Texans & BAL Ravens must NEVER pollute TEN Titans or IND Colts H2H!
    { season: '2024', game_type: 'REG', gameday: '2024-11-10', home_team: 'HOU', home_score: '23', away_team: 'DET', away_score: '26', location: 'Home', overtime: '0', espn: '401671790', pfr: '' },
    { season: '2024', game_type: 'REG', gameday: '2024-10-27', home_team: 'DET', home_score: '52', away_team: 'TEN', away_score: '14', location: 'Home', overtime: '0', espn: '401671755', pfr: '' },
    { season: '2025', game_type: 'REG', gameday: '2025-09-22', home_team: 'BAL', home_score: '30', away_team: 'DET', away_score: '38', location: 'Home', overtime: '0', espn: '401772711', pfr: '' },
    { season: '2024', game_type: 'REG', gameday: '2024-11-24', home_team: 'IND', home_score: '6', away_team: 'DET', away_score: '24', location: 'Home', overtime: '0', espn: '401671775', pfr: '' }
  ];

  // Tie formatting + rendering
  const detPit = buildFranchiseHeadToHeadHistory(synthGames, 'DET', 'PIT');
  assert.equal(detPit.recentRecord, '1-0-1 in last 2 meetings');
  assert.equal(detPit.recentGames[0].result, 'W');
  assert.equal(detPit.recentGames[1].result, 'T');
  assert.equal(detPit.recentGames[1].tied, true);
  assert.equal(detPit.recentGames[1].overtime, true);

  // Relocation alias (BUF vs LV includes OAK)
  const bufLv = buildFranchiseHeadToHeadHistory(synthGames, 'BUF', 'LV');
  assert.equal(bufLv.recentRecord, '1-1 in last 2 meetings');
  assert.equal(bufLv.recentGames[1].scoreDisplay, 'BUF 24, OAK 38');

  // Zero cross-franchise conflation (DET vs TEN excludes HOU; DET vs IND excludes BAL)
  const detTen = buildFranchiseHeadToHeadHistory(synthGames, 'DET', 'TEN');
  assert.equal(detTen.recentGames.length, 1, 'DET vs TEN must NOT include HOU Texans games');
  assert.equal(detTen.recentGames[0].scoreDisplay, 'DET 52, TEN 14');

  const detInd = buildFranchiseHeadToHeadHistory(synthGames, 'DET', 'IND');
  assert.equal(detInd.recentGames.length, 1, 'DET vs IND must NOT include BAL Ravens games');
  assert.equal(detInd.recentGames[0].scoreDisplay, 'DET 24, IND 6');

  // Client-side post-game Week N+1 rollover preserves full Recent Meetings + merges live rematch
  const byOpp = buildScheduleH2hByOpponentMap(synthGames, 'DET', [
    { week: 12, opponent: { abbr: 'TEN', shortName: 'Titans' } },
    { week: 13, opponent: { abbr: 'PIT', shortName: 'Steelers' } }
  ]);
  const rolled = resolveLiveFranchiseHistoryForOpponent(
    { ...detTen, byOpponent: byOpp },
    {
      teamAbbr: 'DET',
      teamNickname: 'Lions',
      oppAbbr: 'PIT',
      oppShortName: 'Steelers',
      scheduleGames: [
        {
          id: '401888111',
          season: 2026,
          seasonType: 'REG',
          completed: true,
          dateIso: '2026-10-18T17:00:00Z',
          homeAway: 'away',
          sfScore: 31,
          oppScore: 24,
          opponent: { abbr: 'PIT' },
          gameUrl: 'https://www.espn.com/nfl/game/_/gameId/401888111'
        }
      ]
    }
  );
  assert.equal(rolled.recentRecord, '2-0-1 in last 3 meetings');
  assert.equal(rolled.recentGames[0].date, '2026-10-18');
  assert.equal(rolled.recentGames[0].scoreDisplay, 'DET 31, PIT 24');
  assert.ok(rolled.byOpponent?.TEN, 'byOpponent map must be preserved across rollovers');

  // SeasonMatchupView renders populated Recent Meetings rows including Tie 'T' cleanly
  setActiveTeamConfig('DET');
  const lionsMatchupHtml = renderSeasonMatchupViewHtml({
    seasonSub: 'matchup',
    appData: {
      meta: { teamAbbr: 'DET', currentWeek: 13, seasonYear: 2026 },
      roster: { players: [] },
      health: { practiceReport: [], irTracker: [], week: 13 },
      scheduleMatchup: {
        schedule: [],
        upcomingMatchup: {
          week: 13,
          oppAbbr: 'PIT',
          oppName: 'Pittsburgh Steelers',
          homeAway: 'home',
          franchiseHistory: rolled,
          opponentHealth: { injuryReport: [], irReserve: [] },
          coachingMatchup: buildDeterministicCoachingMatchup({ team: getTeamByAbbr('DET'), week: 13, oppAbbr: 'PIT', oppName: 'Pittsburgh Steelers' })
        }
      }
    }
  });
  assert.ok(lionsMatchupHtml.includes('Recent Meetings (2-0-1 in last 3 meetings)'), 'Matchup HTML must show Recent Meetings record');
  assert.ok(lionsMatchupHtml.includes('<strong>T</strong> DET 16, PIT 16 (OT)'), 'Matchup HTML must render tie outcome as T');
  assert.ok(!lionsMatchupHtml.includes('historical game log available via Pro-Football-Reference above'), 'Matchup HTML must not show empty fallback when games exist');
});

await test('Multi-Team Draft Prep Above Big Board Parity (Needs, Full Pick Inventory + Comp + Rich Hill, Live Consensus Mocks, Zero SF Leaks)', async () => {
  const { parseTankathonTeamPicksHtml } = await import('../scripts/lib/aiSynthesisEngine.mjs');
  const {
    buildTradedPicksNote,
    parseMddbTeamPageHtml,
    sanitizeTeamNeutralArchetypeNote
  } = await import('../scripts/lib/teamDraftIntelBuilder.mjs');
  const { resolveFirstPickMockDatabase } = await import('../src/engine/seasonStateMachine.js');

  // 1. Unit test Tankathon parser with own, traded, and compensatory picks
  const sampleTkHtml = `
    <h2>Current Draft Picks</h2>
    <div class="pick-card"><div class="pick-card-round">1.32 </div>32</div><div class="abbreviation">BUF</div>
    <div class="pick-card"><div class="pick-card-round">4.36 Comp</div>137</div><div class="abbreviation">BUF</div>
    <div class="pick-card"><div class="pick-card-round">5.1 </div>138</div><div class="abbreviation">TEN</div>
    <h2>Mock Draft Selections</h2>
  `;
  const parsedPicks = parseTankathonTeamPicksHtml(sampleTkHtml, 'BUF');
  assert.equal(parsedPicks.length, 3, 'Tankathon parser must capture own, comp, and traded picks');
  assert.equal(parsedPicks[0].origin, 'Own Pick (Live Contender Slot)');
  assert.equal(parsedPicks[0].valueRichHill, 184);
  assert.equal(parsedPicks[1].isComp, true);
  assert.equal(parsedPicks[1].origin, 'Compensatory Pick');
  assert.ok(Number.isFinite(parsedPicks[1].valueRichHill) && parsedPicks[1].valueRichHill > 0);
  assert.equal(parsedPicks[2].origin, 'From TEN (Acquired via Trade)');
  assert.equal(parsedPicks[2].fromTeam, 'TEN');

  const note = buildTradedPicksNote({ team: { abbr: 'BUF', city: 'Buffalo', fullName: 'Buffalo Bills' }, draftYear: 2027, pickInventory: parsedPicks });
  assert.ok(note.startsWith('3 Total Picks:'), `Expected accurate count prefix, got: ${note}`);
  assert.ok(note.includes('via TEN') && note.includes('compensatory pick'), `Note must cite acquired and comp picks: ${note}`);

  // 2. Unit test archetype sanitizer strips all SF-specific coaches/players/schemes
  const dirtyNotes = [
    'Penetrating front-four disruptor built for Kris Kocurek\'s attack-style Wide-9 rotation.',
    'Prototypical Iowa wide-zone center/guard with rapid reach-block footwork to succeed Jake Brendel or upgrade Left Guard.',
    'Rangy sideline-to-sideline coverage linebacker in the Fred Warner seam-carry mold.',
    '6\'3" vertical field-stretcher with above-the-rim catch radius for Shanahan play-action shot plays.',
    '6\'7" 12-personnel matchup tight end alongside George Kittle.'
  ];
  for (const dn of dirtyNotes) {
    const clean = sanitizeTeamNeutralArchetypeNote(dn, { abbr: 'DET', nickname: 'Lions', city: 'Detroit' });
    assert.ok(!/Kocurek|Wide-9|Jake Brendel|Fred Warner|Shanahan|George Kittle|49ers|\bSF\b/i.test(clean), `Sanitizer leaked SF phrase: ${clean}`);
  }

  // 3. Unit test MDDB team parser extracts Must Address needs and clean siteName without analyst leakage
  const sampleMddb = `
    <a href="/mock-drafts/2027/espn-2027-jordan-reid?date=2026-11-18">
      <span class="font-semibold">ESPN <span class="font-normal"> By Jordan Reid</span></span>
      <div class="whitespace-nowrap">11/18/26</div>
    </a>
    <div><span class="text-base font-black">30</span>
      <a href="/colleges/2027/mississippi-state-bulldogs">Mississippi State</a>
      <a href="/players/2027/kelley-jones">Kelley Jones</a>
      <span class="font-bold bg-blue-50">CB</span>
    </div>
    <h2>2027 Team Needs</h2><div>Must Address</div><span>CB</span><span>S</span><span>EDGE</span><span>IOL</span><div>Strong Need</div>
  `;
  const parsedMddb = parseMddbTeamPageHtml(sampleMddb, { team: { abbr: 'DET', nickname: 'Lions', fullName: 'Detroit Lions' }, draftYear: 2027 });
  assert.deepEqual(parsedMddb.mustAddressNeeds, ['CB', 'S', 'EDGE', 'IOL']);
  assert.equal(parsedMddb.mockEntries.length, 1);
  assert.equal(parsedMddb.mockEntries[0].siteName, 'ESPN');
  assert.equal(parsedMddb.mockEntries[0].analyst, 'Jordan Reid');
  assert.equal(parsedMddb.mockEntries[0].projectedPick, 30);

  // 4. Live generated Bills & Lions seasonal.json & rendered Draft HTML verification
  const forbiddenDraftLeakRe = /\b(49ers|San Francisco|Shanahan|Lynch|Raheem Morris|Kris Kocurek|Wide-9|Fred Warner|Trent Williams|Jake Brendel|George Kittle|Nick Bosa|Brock Purdy|SF Fit|Mocked to SF|undefined)\b/i;

  for (const slug of ['lions', 'bills']) {
    const team = getTeamBySlug(slug);
    setActiveTeamConfig(team);
    const dir = path.join(ROOT, 'data', 'teams', slug);
    const seasonal = JSON.parse(fs.readFileSync(path.join(dir, 'seasonal.json'), 'utf8'));
    const meta = JSON.parse(fs.readFileSync(path.join(dir, 'meta.json'), 'utf8'));
    const scheduleMatchup = JSON.parse(fs.readFileSync(path.join(dir, 'schedule-matchup.json'), 'utf8'));
    const dp = seasonal.draftPrep2027;

    assert.ok(dp, `${slug} missing draftPrep2027`);
    assert.ok(Array.isArray(dp.sources) && dp.sources.length >= 3, `${slug} draftPrep2027.sources must have >= 3 links`);
    assert.equal(dp.sources[0].label, 'NFL Mock Draft Database', `${slug} first draft source must be NFL Mock Draft Database`);
    assert.ok(dp.sources[0].url.includes(`/teams/2027/${team.otcSlug}`), `${slug} MDDB URL must use /teams/2027/${team.otcSlug}, got ${dp.sources[0].url}`);
    assert.ok(!dp.sources[0].url.includes('/nfl-teams/'), `${slug} MDDB URL must NOT use broken /nfl-teams/ path`);
    assert.ok(dp.sources.some(s => /NFL Combine Tracker/i.test(s.label)), `${slug} must include NFL Combine Tracker link`);

    assert.ok(Array.isArray(dp.topNeeds2027) && dp.topNeeds2027.length === 4, `${slug} must have 4 topNeeds2027, got ${dp.topNeeds2027?.length}`);
    for (const need of dp.topNeeds2027) {
      assert.ok(need.pos && need.horizon && need.horizon.length >= 30, `${slug} need #${need.rank} incomplete`);
    }

    assert.ok(Array.isArray(dp.pickInventory) && dp.pickInventory.length >= 5, `${slug} pickInventory must have full draft picks (>=5), got ${dp.pickInventory?.length}`);
    for (const pk of dp.pickInventory) {
      assert.ok(Number.isFinite(pk.round) && pk.round >= 1 && pk.round <= 7, `${slug} invalid pick round`);
      assert.ok(Number.isFinite(pk.projectedOverall) && pk.projectedOverall >= 1 && pk.projectedOverall <= 262, `${slug} invalid overall pick`);
      assert.ok(Number.isFinite(pk.valueRichHill) && pk.valueRichHill > 0, `${slug} pick Rd ${pk.round} #${pk.projectedOverall} missing valid valueRichHill`);
      assert.ok(Boolean(pk.origin), `${slug} pick missing origin`);
    }
    assert.ok(dp.tradedPicksNote.startsWith(`${dp.pickInventory.length} Total Picks:`), `${slug} tradedPicksNote must reflect live pick count, got: ${dp.tradedPicksNote}`);
    assert.ok(!dp.tradedPicksNote.includes('3-Lens 250+ Prospect Big Board'), `${slug} tradedPicksNote must NOT be generic placeholder`);

    const resolvedMock = resolveFirstPickMockDatabase(dp.firstPickMockDatabase || [], {
      appData: { seasonal, meta },
      now: new Date(),
      draftYear: dp.draftYear,
      projectedPick: dp.pickInventory[0]?.projectedOverall,
      consensusBigBoard: dp.consensusBigBoard || []
    });
    assert.ok(resolvedMock.totalFreshSites >= 8, `${slug} Consensus Mock Draft should have >= 8 fresh sites, got ${resolvedMock.totalFreshSites}`);
    assert.ok(resolvedMock.players.length >= 4, `${slug} Consensus Mock Draft should have >= 4 projected players`);
    for (const entry of dp.firstPickMockDatabase || []) {
      assert.ok(!/\bBy\s+[A-Z]/i.test(entry.siteName || ''), `${slug} mock siteName leaked "By <Analyst>": ${entry.siteName}`);
    }

    assert.ok(Array.isArray(dp.consensusMockTargets) && dp.consensusMockTargets.length >= 3, `${slug} must have >= 3 Scheme Fit Clusters`);

    const draftHtml = renderSeasonMatchupViewHtml({ appData: { seasonal, meta, scheduleMatchup }, seasonSub: 'draft_prep' });
    assert.ok(draftHtml.includes('data-mock-db-list'), `${slug} Draft view must render populated Consensus Mock Draft list`);
    assert.ok(!draftHtml.includes('data-mock-db-empty'), `${slug} Draft view must NOT show empty mock state`);
    assert.ok(draftHtml.includes(`${team.abbr} Fit`), `${slug} Draft view must label fit scores with "${team.abbr} Fit"`);
    assert.ok(draftHtml.includes(`Mocked to ${team.abbr}`), `${slug} Draft view must label mocked prospects with "Mocked to ${team.abbr}"`);
    const leak = draftHtml.match(forbiddenDraftLeakRe);
    assert.equal(leak, null, `${slug} rendered Draft Prep HTML leaked forbidden string "${leak?.[0]}"`);
  }
  setActiveTeamConfig('SF');
});

// Restore default SF active team singleton
setActiveTeamConfig('SF');

console.log(`\n======================================================`);
console.log(`CANARY MULTI-TEAM QA SUMMARY: ${passed} Passed, ${failed} Failed`);
console.log(`======================================================\n`);
if (failed > 0) process.exit(1);
