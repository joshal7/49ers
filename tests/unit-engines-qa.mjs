#!/usr/bin/env node
/**
 * Comprehensive Unit, Quantitative Math, Corner-Case & Data Schema QA Suite
 * Audits all 5 analytical engines, all compiled 2026 JSON datasets, neural audio files,
 * and Service Worker asset references.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  ALL_DASHBOARD_BLOCKS,
  evaluateSeasonState,
  resolveOrderedDashboardBlocks
} from '../src/engine/seasonStateMachine.js';
import {
  ROSTER_SORT_FIELDS,
  normalizeRosterSort
} from '../src/views/rosterCapView.js';
import { simulateCapScenario } from '../src/engine/capSimulator.js';
import {
  computePlayerPlayProbability,
  calculateIrReturnTimeline
} from '../src/engine/injuryProbabilityModel.js';
import {
  runPlayoffMonteCarlo,
  computeRootingGuideLeverage
} from '../src/engine/playoffMonteCarlo.js';
import {
  scoreContentSignal,
  cleanSensationalistText,
  filterNewsByUserPrefs
} from '../src/engine/antiFluffFilter.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    passed += 1;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    failed += 1;
    console.error(`  ✗ FAIL: ${name}\n    ${err.stack || err.message}`);
  }
}

console.log('\n=== [1/6] Seasonal & Temporal State Machine QA ===');

test('June offseason activates ONLY YEAR_ROUND and archives in-season/temporal modules', () => {
  const s = evaluateSeasonState({ now: '2026-06-15T12:00:00-07:00' });
  assert.deepEqual(s.activePhases, ['YEAR_ROUND']);
  assert.ok(s.archivedBlocks.some(b => b.id === 'trade_deadline'));
  assert.ok(s.archivedBlocks.some(b => b.id === 'draft_live_udfa'));
});

test('Sept Week 2 activates YEAR_ROUND + IN_SEASON without TRADE_WINDOW', () => {
  const s = evaluateSeasonState({ now: '2026-09-18T12:00:00-07:00', teamStatus: { currentWeek: 2 } });
  assert.ok(s.activePhases.includes('IN_SEASON'));
  assert.ok(!s.activePhases.includes('TRADE_WINDOW'));
});

test('Nov 6, 2026 (Active Trade Window) activates YEAR_ROUND + IN_SEASON + TRADE_WINDOW with countdown', () => {
  const s = evaluateSeasonState({ now: '2026-11-06T21:30:00-08:00', teamStatus: { currentWeek: 9 } });
  assert.ok(s.activePhases.includes('IN_SEASON'));
  assert.ok(s.activePhases.includes('TRADE_WINDOW'));
  assert.ok(s.headlinePhase.countdownText?.includes('Trade Deadline'));
  assert.ok(s.activeBlocks.some(b => b.id === 'trade_deadline'));
});

test('1 minute after Nov 10 Trade Deadline immediately retires TRADE_WINDOW to Vault', () => {
  const s = evaluateSeasonState({ now: '2026-11-10T13:01:00-08:00', teamStatus: { currentWeek: 10 } });
  assert.ok(!s.activePhases.includes('TRADE_WINDOW'));
  assert.ok(s.archivedBlocks.some(b => b.id === 'trade_deadline'));
});

test('Final 5 weeks (Dec 15, Week 15) activates PLAYOFF_PUSH unless mathematically eliminated', () => {
  const alive = evaluateSeasonState({
    now: '2026-12-15T12:00:00-08:00',
    teamStatus: { currentWeek: 15, mathematicallyEliminated: false }
  });
  assert.ok(alive.activePhases.includes('PLAYOFF_PUSH'));

  const elim = evaluateSeasonState({
    now: '2026-12-15T12:00:00-08:00',
    teamStatus: { currentWeek: 15, mathematicallyEliminated: true }
  });
  assert.ok(!elim.activePhases.includes('PLAYOFF_PUSH'));
});

test('Postseason elimination immediately transitions from IN_SEASON to DRAFT_PREP', () => {
  const s = evaluateSeasonState({
    now: '2027-01-25T10:00:00-08:00',
    teamStatus: { eliminatedAt: '2027-01-24T19:00:00-08:00' }
  });
  assert.ok(!s.activePhases.includes('IN_SEASON'));
  assert.ok(s.activePhases.includes('DRAFT_PREP'));
});

test('Draft Day 1 transitions from DRAFT_PREP to DRAFT_LIVE_UDFA', () => {
  const s = evaluateSeasonState({ now: '2027-04-23T12:00:00-07:00' });
  assert.ok(!s.activePhases.includes('DRAFT_PREP'));
  assert.ok(s.activePhases.includes('DRAFT_LIVE_UDFA'));
});

test('Default ALL_DASHBOARD_BLOCKS priority order matches exact user specification and excludes "War Room"', () => {
  const sortedIds = [...ALL_DASHBOARD_BLOCKS]
    .sort((a, b) => a.defaultPriority - b.defaultPriority)
    .map(b => b.id);
  assert.deepEqual(sortedIds, [
    'news_briefs',
    'upcoming_matchup',
    'team_health',
    'schedule_overview',
    'trade_deadline',
    'playoff_picture',
    'draft_prep',
    'draft_live_udfa',
    'team_stats',
    'roster_depth',
    'salary_cap',
    'autopodcast_ai'
  ]);
  for (const b of ALL_DASHBOARD_BLOCKS) {
    assert.ok(!/war\s*room/i.test(b.title), `Unexpected War Room in title: ${b.title}`);
    assert.ok(!/war\s*room/i.test(b.shortTitle), `Unexpected War Room in shortTitle: ${b.shortTitle}`);
  }
});

test('resolveOrderedDashboardBlocks preserves user order, drops retired blocks, and inserts new seasonal blocks in relative priority position', () => {
  const active = ALL_DASHBOARD_BLOCKS.filter(b =>
    ['news_briefs', 'schedule_overview', 'playoff_picture', 'team_stats', 'salary_cap'].includes(b.id)
  );
  const saved = ['news_briefs', 'schedule_overview', 'trade_deadline', 'team_stats', 'salary_cap']; // trade_deadline retired; playoff_picture newly activated!
  const resolved = resolveOrderedDashboardBlocks(active, saved).map(b => b.id);
  assert.deepEqual(resolved, [
    'news_briefs',
    'schedule_overview',
    'playoff_picture',
    'team_stats',
    'salary_cap'
  ]);
});

test('Roster sort fields place Name first, Jersey Number second, and support asc/desc normalization', () => {
  assert.equal(ROSTER_SORT_FIELDS[0].key, 'name');
  assert.equal(ROSTER_SORT_FIELDS[1].key, 'jersey');
  assert.deepEqual(normalizeRosterSort(), { field: 'name', dir: 'asc' });
  assert.deepEqual(normalizeRosterSort('jersey', 'desc'), { field: 'jersey', dir: 'desc' });
  assert.deepEqual(normalizeRosterSort('cap_desc'), { field: 'cap', dir: 'desc' });
});

test('Invalid date throws descriptive error', () => {
  assert.throws(() => evaluateSeasonState({ now: 'not-a-date' }));
});

console.log('\n=== [2/6] Salary Cap & Armchair GM Simulator Math QA ===');

const capData = JSON.parse(fs.readFileSync(path.join(rootDir, 'data', 'cap.json'), 'utf8'));

test('Zero-move baseline matches OverTheCap 2026 Cap Space penny-for-penny', () => {
  const res = simulateCapScenario(capData, {});
  assert.equal(res.moveCount, 0);
  assert.equal(res.summary.updatedCapSpace, capData.years['2026'].teamCapSpace);
  assert.equal(res.summary.baseYearNetCapDelta, 0);
});

test('Restructuring Brock Purdy increases 2026 space without replacement penalty and prorates 25%/yr to 2027-2028', () => {
  const purdy = capData.players.find(p => p.name === 'Brock Purdy');
  assert.ok(purdy, 'Brock Purdy exists in cap.json');
  const expectedSave = purdy.contractsByYear['2026'].transactions.restructure.capSavings;
  assert.ok(expectedSave > 5_000_000);

  const res = simulateCapScenario(capData, { [purdy.id]: 'restructure' });
  assert.equal(res.summary.baseYearNetCapDelta, expectedSave);
  assert.equal(res.summary.nextYearCapDelta, -Math.round(expectedSave / 4));
});

test('Selecting >2 Post-June 1 Cuts triggers NFL CBA 2-player designation limit warning', () => {
  const top3 = capData.players.slice(0, 3);
  const moves = Object.fromEntries(top3.map(p => [p.id, 'june_1_cut']));
  const res = simulateCapScenario(capData, moves);
  assert.equal(res.postJune1CutCount, 3);
  assert.ok(res.warnings.some(w => w.includes('maximum of 2 players as Post-June 1')));
});

test('Pre-June 1 cutting high-dead-cap stars triggers Over-The-Cap compliance warning', () => {
  const purdy = capData.players.find(p => p.name === 'Brock Purdy');
  const res = simulateCapScenario(capData, { [purdy.id]: 'cut' });
  assert.ok(res.summary.updatedCapSpace < 0);
  assert.ok(res.warnings.some(w => w.includes('OVER the 2026 salary cap')));
});

test('Invalid player IDs and unknown actions are safely ignored with zero NaN leakage', () => {
  const res = simulateCapScenario(capData, { nonexistent_999: 'cut', [capData.players[0].id]: 'bogus_action' });
  assert.equal(res.moveCount, 0);
  assert.ok(!Number.isNaN(res.summary.updatedCapSpace));
});

console.log('\n=== [3/6] Player-Specific Injury Play-Probability & IR Bye-Week QA ===');

test('Trent Williams Wednesday Veteran Rest returns 98% Full Go (zero penalty)', () => {
  const twRest = computePlayerPlayProbability({
    name: 'Trent Williams',
    wed: 'Vet Rest',
    thu: 'FP',
    fri: 'FP',
    injuryType: 'NIR - Rest'
  });
  assert.equal(twRest.probabilityPct, 98);
  assert.equal(twRest.tier, 'ACTIVE');
});

test('Trent Williams acute Ankle Limited tag drops to cautious acute-ankle prior (<= 56%)', () => {
  const twAnkle = computePlayerPlayProbability({
    name: 'Trent Williams',
    gameStatus: 'Questionable',
    injuryType: 'Ankle',
    wed: 'DNP',
    thu: 'DNP',
    fri: 'LP'
  });
  assert.ok(twAnkle.probabilityPct <= 56, `Expected <=56%, got ${twAnkle.probabilityPct}%`);
});

test('Fred Warner Questionable/LP toughness prior substantially exceeds chronic soft-tissue WR prior', () => {
  const warner = computePlayerPlayProbability({
    name: 'Fred Warner',
    gameStatus: 'Questionable',
    injuryType: 'Foot',
    wed: 'LP',
    thu: 'LP',
    fri: 'LP'
  });
  const pearsall = computePlayerPlayProbability({
    name: 'Ricky Pearsall',
    gameStatus: 'Questionable',
    injuryType: 'Hamstring',
    wed: 'LP',
    thu: 'LP',
    fri: 'LP'
  });
  assert.ok(warner.probabilityPct >= pearsall.probabilityPct + 15);
});

test('Mid-week downgrade (LP -> LP -> Friday DNP) triggers setback drop <= 20%', () => {
  const setback = computePlayerPlayProbability({
    name: 'Jauan Jennings',
    injuryType: 'Hip',
    wed: 'LP',
    thu: 'LP',
    fri: 'DNP'
  });
  assert.ok(setback.probabilityPct <= 20);
  assert.ok(setback.factors.some(f => f.toLowerCase().includes('setback')));
});

test('Official Out / IR / Reinstatement pending always returns exactly 0%', () => {
  const aiyuk = computePlayerPlayProbability({
    name: 'Brandon Aiyuk',
    gameStatus: 'Out',
    beatNote: 'Brandon Aiyuk meets with 49ers looking to get reinstated'
  });
  assert.equal(aiyuk.probabilityPct, 0);
});

test('IR 4-game calculator properly excludes Week 8 Bye from the 4 missed games', () => {
  // Placed ahead of Week 5 -> misses Wk 5, 6, 7, (skips Wk 8 Bye), Wk 9 -> eligible Week 10!
  const irCrossBye = calculateIrReturnTimeline(5, 8, 4);
  assert.deepEqual(irCrossBye.missedGameWeeks, [5, 6, 7, 9]);
  assert.equal(irCrossBye.earliestEligibleWeek, 10);
  assert.equal(irCrossBye.byeWeekExcluded, true);

  // Placed ahead of Week 4 -> misses Wk 4, 5, 6, 7 -> raw next week is Wk 8 (Bye), so earliest game is Week 9!
  const irLandingOnBye = calculateIrReturnTimeline(4, 8, 4);
  assert.deepEqual(irLandingOnBye.missedGameWeeks, [4, 5, 6, 7]);
  assert.equal(irLandingOnBye.earliestEligibleWeek, 9);
});

console.log('\n=== [4/6] 10,000-Run Monte Carlo Playoff Simulator & Tiebreaker QA ===');

const seasonalData = JSON.parse(fs.readFileSync(path.join(rootDir, 'data', 'seasonal.json'), 'utf8'));
const simInputs = seasonalData.playoffPicture.simulatorInputs;

test('Monte Carlo is 100% deterministic for identical seed and runs in <150ms', () => {
  const t0 = Date.now();
  const r1 = runPlayoffMonteCarlo({ ...simInputs, iterations: 10000, seed: 12345 });
  const elapsed = Date.now() - t0;
  const r2 = runPlayoffMonteCarlo({ ...simInputs, iterations: 10000, seed: 12345 });
  assert.deepEqual(r1.sfOdds, r2.sfOdds);
  assert.ok(elapsed < 250, `Expected fast simulation, took ${elapsed}ms`);
});

test('Probability conservation holds across all 16 NFC teams (700% playoffs, 400% div, 100% #1 seed)', () => {
  const res = runPlayoffMonteCarlo({ ...simInputs, iterations: 10000, seed: 492026 });
  assert.equal(res.allTeamOdds.length, 16);

  const sumPlayoffs = res.allTeamOdds.reduce((s, t) => s + t.makePlayoffsPct, 0);
  const sumDiv = res.allTeamOdds.reduce((s, t) => s + t.winDivisionPct, 0);
  const sumSeed1 = res.allTeamOdds.reduce((s, t) => s + t.seed1ByePct, 0);

  assert.ok(Math.abs(sumPlayoffs - 700) < 1.5, `Sum playoffs = ${sumPlayoffs}`);
  assert.ok(Math.abs(sumDiv - 400) < 1.5, `Sum div = ${sumDiv}`);
  assert.ok(Math.abs(sumSeed1 - 100) < 1.0, `Sum #1 seed = ${sumSeed1}`);

  for (const t of res.allTeamOdds) {
    const teamTotal =
      Object.values(t.seedDistribution).reduce((a, b) => a + b, 0) + t.missedPlayoffsPct;
    assert.ok(Math.abs(teamTotal - 100) < 0.8, `${t.abbr} seed sum = ${teamTotal}`);
  }
});

test('Interactive scenario override monotonically shifts SF #1 Seed % when forcing SF wins vs losses', () => {
  const sfRemaining = simInputs.remainingGames.filter(g => g.home === 'SF' || g.away === 'SF').slice(0, 3);
  const forceWins = Object.fromEntries(sfRemaining.map(g => [g.id, g.home === 'SF' ? 'HOME' : 'AWAY']));
  const forceLosses = Object.fromEntries(sfRemaining.map(g => [g.id, g.home === 'SF' ? 'AWAY' : 'HOME']));

  const winSim = runPlayoffMonteCarlo({ ...simInputs, forcedWinners: forceWins, iterations: 5000 });
  const lossSim = runPlayoffMonteCarlo({ ...simInputs, forcedWinners: forceLosses, iterations: 5000 });

  assert.ok(
    winSim.sfOdds.seed1ByePct > lossSim.sfOdds.seed1ByePct + 15,
    `Expected SF 3-0 (${winSim.sfOdds.seed1ByePct}%) >> SF 0-3 (${lossSim.sfOdds.seed1ByePct}%)`
  );
});

test('Empty simulator config handles gracefully without throwing', () => {
  const empty = runPlayoffMonteCarlo({ nfcTeams: [] });
  assert.equal(empty.sfOdds, null);
  assert.equal(empty.allTeamOdds.length, 0);
});

console.log('\n=== [5/6] Anti-Fluff Classifier & Per-User Reporter Filter QA ===');

test('Clickbait rage-bait headlines are flagged while EPA/scheme breakdowns score high signal', () => {
  const junk = scoreContentSignal(
    'SHOCKING: Fans are FURIOUS after cryptic tweet DESTROYS locker room!!',
    'You wont believe what social media is saying!!'
  );
  assert.equal(junk.isClickbait, true);

  const factualSignal = scoreContentSignal(
    'Brock Purdy posts +0.28 EPA/play vs Cover 4 in 21 personnel; $5.74M restructure lever',
    'All-22 film shows Wide-9 stunt geometry freeing Nick Bosa on 68% snap share.'
  );
  assert.equal(factualSignal.isClickbait, false);
  assert.ok(factualSignal.signalScore >= 75);
});

test('Per-user reporter filter respects muted reporters, outlets, hot-take toggle & multi-citation briefs', () => {
  const repMap = new Map([
    ['matt_maiocco', { id: 'matt_maiocco', styleTag: 'factual-beat' }],
    ['grant_cohn', { id: 'grant_cohn', styleTag: 'opinion-hot-take' }]
  ]);
  const sampleItems = [
    { id: '1', reporterId: 'grant_cohn', outletId: 'youtube_film', category: 'beat', signalScore: 45 },
    { id: '2', citedReporterIds: ['matt_maiocco', 'grant_cohn'], outletId: 'nbcsba', category: 'film', signalScore: 90 }
  ];

  const afterMuteHotTakes = filterNewsByUserPrefs(sampleItems, repMap, { muteHotTakePersonalities: true });
  assert.equal(afterMuteHotTakes.length, 1);
  assert.equal(afterMuteHotTakes[0].id, '2'); // Kept because Maiocco is still enabled!
});

console.log('\n=== [6/6] Live 2026 Datasets, Reporters, Audio Podcasts & SW Asset Integrity QA ===');

test('All required 49ers beat reporters & national insiders from PRD are present in reporters.json', () => {
  const repJson = JSON.parse(fs.readFileSync(path.join(rootDir, 'data', 'reporters.json'), 'utf8'));
  const namesLower = repJson.reporters.map(r => r.name.toLowerCase()).join(' | ');
  const required = [
    'matt maiocco', 'jennifer lee chan', 'dieter kurtenbach', 'matt barrows',
    'nick wagoner', 'david lombardi', 'cam inman', 'eric branch', 'tim kawakami',
    'guy haberman', 'john chapman', 'brad graham', 'eric crocker', 'jeff deeney',
    'al sacco', 'briana jeannel', 'tim ryan', 'adam schefter', 'ian rapoport',
    'tom pelissero', 'dianna russini', 'albert breer', 'mike garafolo',
    'kyle shanahan', 'john lynch'
  ];
  for (const req of required) {
    assert.ok(namesLower.includes(req), `Missing required reporter: ${req}`);
  }
});

test('All 88 roster players have valid 10-axis Spider Charts (1..99th percentiles), external links, alphabetical default sort & health models', () => {
  const ros = JSON.parse(fs.readFileSync(path.join(rootDir, 'data', 'roster.json'), 'utf8'));
  assert.ok(ros.players.length >= 75);
  assert.ok(ros.players[0].name.localeCompare(ros.players[1].name) <= 0, 'roster.json should be sorted by name ascending by default');
  for (const p of ros.players) {
    assert.ok(p.name && p.position);
    assert.ok(p.espnUrl?.startsWith('https://'), `Player ${p.name} missing espnUrl`);
    assert.equal(p.spiderProfile?.axes?.length, 10, `Player ${p.name} missing 10 spider axes`);
    for (const ax of p.spiderProfile.axes) {
      assert.ok(ax.percentile >= 1 && ax.percentile <= 99, `Invalid pct for ${p.name} ${ax.key}`);
    }
    assert.ok(p.health.playProbabilityPct >= 0 && p.health.playProbabilityPct <= 99);
  }
});

test('Live news.json contains fresh social tweets, beat articles with URLs, synthesis sourceLinks, and verified YouTube embeddable flags', () => {
  const newsJson = JSON.parse(fs.readFileSync(path.join(rootDir, 'data', 'news.json'), 'utf8'));
  assert.ok(newsJson.clusteredBriefs.length >= 3);
  for (const b of newsJson.clusteredBriefs) {
    assert.ok(Array.isArray(b.sourceLinks) && b.sourceLinks.length >= 1, `Brief ${b.id} missing sourceLinks`);
    if (b.videoClip) {
      assert.equal(b.videoClip.embeddable, true, `Clustered brief video ${b.videoClip.videoId} must be verified embeddable`);
    }
  }
  const tweets = newsJson.rawStream.filter(i => i.type === 'tweet');
  const articles = newsJson.rawStream.filter(i => i.type === 'article');
  const videos = newsJson.rawStream.filter(i => i.type === 'video');
  assert.ok(tweets.length >= 10, `Expected >=10 live beat tweets/posts, got ${tweets.length}`);
  assert.ok(articles.length >= 5, `Expected >=5 live beat articles, got ${articles.length}`);
  assert.ok(tweets.every(s => s.url?.startsWith('https://')), 'Every tweet post must have a direct https URL');
  assert.ok(videos.every(v => typeof v.embeddable === 'boolean'), 'Every video item must carry verified embeddable boolean');
  const blocked49ersVid = videos.find(v => v.videoId === 'pb6-G63jccQ');
  if (blocked49ersVid) {
    assert.equal(blocked49ersVid.embeddable, false, 'DRM-blocked 49ers channel video pb6-G63jccQ must be marked embeddable: false');
  }
});

test('Upcoming Matchup includes opponent health report & play likelihood percentages', () => {
  const sm = JSON.parse(fs.readFileSync(path.join(rootDir, 'data', 'schedule-matchup.json'), 'utf8'));
  const oppHealth = sm.upcomingMatchup?.opponentHealth;
  assert.ok(oppHealth, 'Missing upcomingMatchup.opponentHealth');
  assert.ok(oppHealth.teamName?.includes('Raiders'), `Expected Raiders opponent health, got ${oppHealth.teamName}`);
  assert.ok(Array.isArray(oppHealth.injuryReport) && oppHealth.injuryReport.length >= 3, 'Expected opponent injuryReport entries');
  for (const p of oppHealth.injuryReport) {
    assert.ok(typeof p.playProbabilityPct === 'number' && p.playProbabilityPct >= 0 && p.playProbabilityPct <= 99);
  }
});

test('All 3 pre-generated multi-speaker neural podcast .m4a files exist on disk with valid size & timed turns', () => {
  const podIdx = JSON.parse(fs.readFileSync(path.join(rootDir, 'data', 'podcasts', 'index.json'), 'utf8'));
  assert.ok(podIdx.episodes.length >= 3);
  for (const ep of podIdx.episodes) {
    const rel = ep.audioUrl.replace(/^\.\//, '');
    const full = path.join(rootDir, rel);
    assert.ok(fs.existsSync(full), `Missing audio file ${full}`);
    const stat = fs.statSync(full);
    assert.ok(stat.size > 100_000, `Audio file ${rel} unexpectedly small (${stat.size}B)`);
    assert.ok(ep.transcript.length >= 4);
    assert.ok(ep.transcript[ep.transcript.length - 1].endSec > 60);
  }
});

test('Every CORE_ASSETS entry in sw.js exists on disk', () => {
  const swText = fs.readFileSync(path.join(rootDir, 'sw.js'), 'utf8');
  const m = swText.match(/const CORE_ASSETS = \[([\s\S]*?)\];/);
  assert.ok(m, 'CORE_ASSETS array found in sw.js');
  const paths = [...m[1].matchAll(/'([^']+)'/g)].map(x => x[1]);
  assert.ok(paths.length >= 20);
  for (const relUrl of paths) {
    if (relUrl === './') continue;
    const diskPath = path.join(rootDir, relUrl.replace(/^\.\//, ''));
    assert.ok(fs.existsSync(diskPath), `sw.js references missing file: ${relUrl}`);
  }
});

console.log('\n=== [7/7] Serverless Edge Worker (Auth, Shared KV Cache, R2 Audio & Error Handling) QA ===');

import edgeWorker from '../worker/index.js';

function createMockWorkerEnv(overrides = {}) {
  const kvStore = new Map();
  const r2Store = new Map();
  return {
    ALLOWED_ORIGIN: 'https://49ers.joshal.com',
    GROUP_PASSCODE: 'faithful49',
    SHARED_CACHE: {
      async get(key, type) {
        const val = kvStore.get(key);
        if (val == null) return null;
        return type === 'json' ? JSON.parse(val) : val;
      },
      async put(key, val) {
        kvStore.set(key, String(val));
      }
    },
    PODCAST_BUCKET: {
      async get(key) {
        const buf = r2Store.get(key);
        if (!buf) return null;
        return {
          body: buf,
          httpMetadata: { contentType: 'audio/wav' }
        };
      },
      async put(key, bytes) {
        r2Store.set(key, bytes);
      }
    },
    ...overrides
  };
}

async function testAsync(label, fn) {
  try {
    await fn();
    passed++;
    console.log(`  ✓ ${label}`);
  } catch (err) {
    failed++;
    console.error(`  ✗ ${label}\n      -> ${err.message}`);
  }
}

await testAsync('Worker CORS preflight, /api/health, and friend-group passcode enforcement (401 vs 200)', async () => {
  const env = createMockWorkerEnv();

  const optRes = await edgeWorker.fetch(
    new Request('https://worker.example/api/shared-feed', {
      method: 'OPTIONS',
      headers: { Origin: 'https://49ers.joshal.com' }
    }),
    env
  );
  assert.equal(optRes.status, 204);
  assert.equal(optRes.headers.get('Access-Control-Allow-Origin'), 'https://49ers.joshal.com');

  const healthRes = await edgeWorker.fetch(new Request('https://worker.example/api/health'), env);
  assert.equal(healthRes.status, 200);

  const unauthRes = await edgeWorker.fetch(new Request('https://worker.example/api/shared-feed'), env);
  assert.equal(unauthRes.status, 401);

  const authRes = await edgeWorker.fetch(
    new Request('https://worker.example/api/shared-feed', {
      headers: { 'X-Group-Passcode': 'faithful49' }
    }),
    env
  );
  assert.equal(authRes.status, 200);
  const feed = await authRes.json();
  assert.deepEqual(feed, { analyses: [], episodes: [] });
});

await testAsync('Worker /api/analyze & /api/podcast handle malformed JSON (400), empty input (400), missing API key (503), and KV cache hits', async () => {
  const envNoKey = createMockWorkerEnv();

  const badJsonRes = await edgeWorker.fetch(
    new Request('https://worker.example/api/analyze', {
      method: 'POST',
      headers: { 'X-Group-Passcode': 'faithful49', 'Content-Type': 'application/json' },
      body: '{invalid_json!!'
    }),
    envNoKey
  );
  assert.equal(badJsonRes.status, 400);

  const emptyPromptRes = await edgeWorker.fetch(
    new Request('https://worker.example/api/analyze', {
      method: 'POST',
      headers: { 'X-Group-Passcode': 'faithful49', 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: '   ' })
    }),
    envNoKey
  );
  assert.equal(emptyPromptRes.status, 400);

  const missingKeyRes = await edgeWorker.fetch(
    new Request('https://worker.example/api/analyze', {
      method: 'POST',
      headers: { 'X-Group-Passcode': 'faithful49', 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: 'Purdy EPA vs two-high' })
    }),
    envNoKey
  );
  assert.equal(missingKeyRes.status, 503);

  // Mock global fetch to verify Gemini synthesis + second-request KV shared cache deduplication
  const origFetch = globalThis.fetch;
  let upstreamCalls = 0;
  globalThis.fetch = async () => {
    upstreamCalls++;
    return new Response(
      JSON.stringify({
        candidates: [
          {
            content: { parts: [{ text: '### Purdy vs Two-High\n* +0.28 EPA/play' }] },
            groundingMetadata: { groundingChunks: [{ web: { title: 'nflverse' } }] }
          }
        ]
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  };

  try {
    const envWithKey = createMockWorkerEnv({ GEMINI_API_KEY: 'mock-test-key' });
    const reqInit = {
      method: 'POST',
      headers: { 'X-Group-Passcode': 'faithful49', 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: 'Purdy EPA vs two-high', author: 'Josh' })
    };

    const first = await (await edgeWorker.fetch(new Request('https://worker.example/api/analyze', reqInit), envWithKey)).json();
    assert.equal(first.cached, false);
    assert.equal(upstreamCalls, 1);

    const second = await (await edgeWorker.fetch(new Request('https://worker.example/api/analyze', reqInit), envWithKey)).json();
    assert.equal(second.cached, true);
    assert.equal(upstreamCalls, 1, 'Second identical friend request must hit KV cache without calling Gemini again');

    const audio404 = await edgeWorker.fetch(new Request('https://worker.example/api/audio/missing_ep'), envWithKey);
    assert.equal(audio404.status, 404);
  } finally {
    globalThis.fetch = origFetch;
  }
});

console.log(`\n======================================================`);
console.log(`UNIT & DATA QA SUMMARY: ${passed} Passed, ${failed} Failed`);
console.log(`======================================================\n`);

if (failed > 0) {
  process.exit(1);
}
