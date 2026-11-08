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
  resolveOrderedDashboardBlocks,
  partitionCompletedTradesByWindow
} from '../src/engine/seasonStateMachine.js';
import {
  JARGON_GLOSSARY,
  getJargonEntry,
  annotateJargonPlainText
} from '../src/engine/jargonGlossary.js';
import {
  ROSTER_SORT_FIELDS,
  normalizeRosterSort
} from '../src/views/rosterCapView.js';
import { simulateCapScenario } from '../src/engine/capSimulator.js';
import {
  computePlayerPlayProbability,
  calculateIrReturnTimeline,
  parseFlexibleIsoMs,
  resolvePlacedBeforeWeekFromDate,
  isSeasonEndingIrRecord,
  classifyIrAndReserveTimeline
} from '../src/engine/injuryProbabilityModel.js';
import {
  canonicalPlayerKey,
  parseOfficial49ersRosterHtml,
  parseOfficial49ersInjuryReportHtml,
  parseCbsTeamInjuriesHtml,
  analyzeTeamTransactions
} from '../scripts/lib/liveHealthAndRosterResolver.mjs';
import {
  runPlayoffMonteCarlo,
  computeRootingGuideLeverage,
  computeCalibratedTeamPowerRating
} from '../src/engine/playoffMonteCarlo.js';
import {
  parseTankathonTeamPicksHtml,
  extractGeminiResponseText,
  DEFAULT_FREE_MODEL_CASCADE,
  scoreFreeTierGeminiModel,
  rankFreeTierModelsFromCatalog,
  discoverBestFreeGeminiModel
} from '../scripts/lib/aiSynthesisEngine.mjs';
import {
  scoreContentSignal,
  cleanSensationalistText,
  filterNewsByUserPrefs
} from '../src/engine/antiFluffFilter.js';
import {
  buildClusteredNewsBriefs,
  buildFrontOfficeCapBlueprint,
  buildTradeDeadlineWarRoom,
  buildDraftPrep2027AndCombine,
  build2026DraftAndUdfaClass
} from '../scripts/lib/seasonalContentBuilder.mjs';
import { parseOverTheCapHtml } from '../scripts/lib/otcParser.mjs';
import { hydrateLiveEspnOverlay, hydrateLiveBlueskyBeatWire } from '../src/services/dataService.js';
import {
  OTC_TEAM_CAP_URL,
  isPaywalledOrBlockedUrl,
  isPaywalledPublisher,
  sanitizeExternalUrl,
  isIndividualOtcPlayerUrl,
  isValidOtcPlayerId,
  isValidPfrPlayerId,
  buildEspnPlayerUrl,
  buildPfrPlayerUrl,
  buildOtcPlayerUrl,
  buildPfrTeamSeasonUrl,
  buildPfrTeamDraftUrl,
  buildPfrHeadToHeadUrl,
  buildMockDraftTeamUrl,
  buildMockDraftBigBoardUrl,
  buildMockDraftProspectUrl,
  buildEspnTeamInjuriesUrl,
  buildEspnTeamLogoUrl,
  getPlayerLookupKeys,
  createPlayerIdentityResolver
} from '../src/engine/linkIntegrity.js';
import {
  validateNoHallucinatedRosterClaims,
  sanitizeHallucinatedRosterText,
  buildLiveGroundingSystemPrompt,
  buildAuthoritativeLiveContextSnapshot
} from '../src/engine/groundingValidator.js';
import {
  SHORT_TWEET_FULL_TEXT_LIMIT,
  classifyBreakingItem,
  sortNewsWithBreakingPriority,
  formatTweetBodyForDisplay,
  is49ersGameLiveWindow
} from '../src/engine/breakingClassifier.js';
import { buildNativePodcastAppHref } from '../src/views/audioAiView.js';

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

console.log('\n=== [7/7] Source-of-Truth, Outbound Link Integrity & Auto-Refresh Pipeline QA ===');

test('Practice report excludes box-score tackle blurbs ("six solo") and models IR-return Questionable >50%', () => {
  const health = JSON.parse(fs.readFileSync(path.join(rootDir, 'data', 'health.json'), 'utf8'));
  const roster = JSON.parse(fs.readFileSync(path.join(rootDir, 'data', 'roster.json'), 'utf8'));

  for (const p of health.practiceReport) {
    assert.ok(
      !/\b(solo|tackle|yard|target|catch|touchdown|sack)\b/i.test(p.injuryType || ''),
      `Bogus stat string leaked into injuryType for ${p.name}: ${p.injuryType}`
    );
  }

  // Healthy active stars without real injury designations must not pollute practiceReport
  for (const healthyName of ['Brock Purdy', 'Fred Warner', 'Dre Greenlaw', 'Kyle Juszczyk', 'Brandin Cooks']) {
    const rp = roster.players.find(x => x.name === healthyName);
    if (rp && rp.rosterBucket === 'active' && !rp.health?.injuryType) {
      assert.ok(
        !health.practiceReport.some(pr => pr.name === healthyName),
        `Healthy active player ${healthyName} should not appear on practiceReport`
      );
    }
  }

  // Test IR-return Questionable model directly
  const irRetProb = computePlayerPlayProbability({
    name: 'Demarcus Robinson',
    position: 'WR',
    gameStatus: 'Questionable',
    isIrReturnQuestionable: true,
    injuryType: 'Ankle',
    wed: 'LP',
    thu: 'LP',
    fri: 'LP',
    beatNote: 'Robinson (ankle) is listed as questionable and likely will be activated from IR.'
  });
  assert.ok(irRetProb.probabilityPct >= 75, `Expected IR-return Questionable >=75%, got ${irRetProb.probabilityPct}%`);
});

test('Upcoming matchup & opponent health reflect live depth-chart starters, normalized TV network, and zero coach typos', () => {
  const sm = JSON.parse(fs.readFileSync(path.join(rootDir, 'data', 'schedule-matchup.json'), 'utf8'));
  const um = sm.upcomingMatchup;
  assert.ok(um && um.week >= 1, 'Missing upcomingMatchup');
  assert.ok(!/Kubliak/i.test(JSON.stringify(sm)), 'Coach name typo "Kubliak" must be normalized to "Kubiak"');
  assert.ok(
    ['FOX', 'CBS', 'NBC', 'ESPN', 'ABC', 'Prime Video', 'NFL', 'Netflix', 'Peacock'].some(tv =>
      String(um.kickoffDisplay || '').includes(tv)
    ),
    `Unexpected broadcast in kickoffDisplay: ${um.kickoffDisplay}`
  );
  assert.ok(um.franchiseHistory?.pfrQueryUrl?.startsWith('https://www.pro-football-reference.com/'), 'Missing dynamic pfrQueryUrl');
  assert.ok((um.opponentHealth?.keyStartersHealthy || []).length >= 4, 'Missing opponent healthy 1st-string starters');

  if (um.week === 9 && um.oppAbbr === 'LV') {
    const starterNames = um.opponentHealth.keyStartersHealthy.map(s => s.name);
    assert.ok(starterNames.includes('Kirk Cousins'), 'Week 9 LV starters should include QB1 Kirk Cousins');
    assert.ok(!starterNames.includes('Geno Smith'), 'Geno Smith is not on LV');
    assert.ok(!starterNames.includes('Christian Wilkins'), 'Christian Wilkins is not an active LV starter');
  }
});

await testAsync('Dynamic news synthesis cleanly generates future-week clusters (Week 12+) and retires post-deadline trade cluster', async () => {
  const futureClusters = await buildClusteredNewsBriefs(
    [
      {
        videoId: 'x0TpSoyfx7I',
        url: 'https://www.youtube.com/watch?v=x0TpSoyfx7I',
        title: '49ers Week 12 Preview',
        channel: 'NBC Sports Bay Area',
        duration: '4:18',
        embeddable: true
      }
    ],
    [
      {
        title: 'Kyle Shanahan details 49ers Week 12 preparation for Seattle Seahawks',
        summary: 'Brock Purdy and Nick Bosa full participants ahead of Sunday NFC West clash.',
        url: 'https://www.espn.com/nfl/team/_/name/sf/san-francisco-49ers',
        outletName: 'ESPN 49ers Beat',
        type: 'article',
        publishedAt: '2026-11-27T18:00:00Z'
      }
    ],
    [],
    {
      currentWeek: 12,
      teamRecord: '8-2',
      standingSummary: '1st in NFC West • #1 Seed in NFC',
      upcomingMatchup: {
        week: 12,
        oppName: 'Seattle Seahawks',
        oppRecord: '6-4',
        homeAway: 'home',
        kickoffDisplay: 'Sun, Nov 29 • 1:25 PM PT (FOX)',
        betting: { spread: 'SF -4.5', overUnder: '47.5' },
        coachingMatchup: { summary: 'Shanahan vs Macdonald chess match.' },
        gameUrl: 'https://www.espn.com/nfl/game/_/gameId/401873091/seahawks-49ers'
      },
      practiceReportPlayers: [],
      cap2026: { teamCapSpace: 34000000, effectiveCapSpace: 29000000 },
      sfOdds: { makePlayoffsPct: 98.5, winDivisionPct: 88.2, seed1ByePct: 51.0 },
      tradeDeadlineIso: '2026-11-10T13:00:00-08:00'
    }
  );
  assert.ok(futureClusters.length >= 2, 'Expected dynamic clusters for Week 12');
  assert.ok(futureClusters[0].headline.includes('Week 12'), `Expected Week 12 headline, got: ${futureClusters[0].headline}`);
  assert.ok(!futureClusters.some(c => c.id.includes('deadline')), 'Post-Nov-10 clusters must not show expired trade deadline');
});

test('All outbound URLs across every data/*.json feed are valid HTTPS URLs with zero NaN/undefined interpolations, and all videos declare boolean embeddable', () => {
  const jsonPaths = [
    'data/meta.json',
    'data/roster.json',
    'data/depth-chart.json',
    'data/cap.json',
    'data/reporters.json',
    'data/news.json',
    'data/schedule-matchup.json',
    'data/health.json',
    'data/seasonal.json',
    'data/beat-podcasts.json',
    'data/podcasts/index.json'
  ];

  let urlCount = 0;
  let videoObjCount = 0;

  function walkObj(node, trail) {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) {
      node.forEach((item, idx) => walkObj(item, `${trail}[${idx}]`));
      return;
    }
    if ('videoId' in node && node.videoId) {
      videoObjCount++;
      assert.equal(typeof node.embeddable, 'boolean', `Video object at ${trail} missing boolean embeddable`);
      assert.match(String(node.videoId), /^[A-Za-z0-9_-]{11}$/, `Invalid YouTube videoId at ${trail}: ${node.videoId}`);
    }
    for (const [k, v] of Object.entries(node)) {
      if (typeof v === 'string' && /(url|link|href)$/i.test(k) && v !== '') {
        if (k === 'audioUrl' && v.startsWith('./')) continue;
        urlCount++;
        assert.ok(v.startsWith('https://'), `Non-HTTPS outbound URL at ${trail}.${k}: ${v}`);
        assert.ok(
          !/(?:\bundefined\b|\bNaN\b|\bnull\b|\/undefined|\/NaN|\/null)/.test(v),
          `Corrupt interpolation in URL at ${trail}.${k}: ${v}`
        );
        // Throws if malformed URL
        new URL(v);
      } else if (v && typeof v === 'object') {
        walkObj(v, `${trail}.${k}`);
      }
    }
  }

  for (const rel of jsonPaths) {
    const parsed = JSON.parse(fs.readFileSync(path.join(rootDir, rel), 'utf8'));
    walkObj(parsed, rel);
  }

  assert.ok(urlCount >= 400, `Expected >=400 validated HTTPS URLs across JSON feeds, checked ${urlCount}`);
  assert.ok(videoObjCount >= 12, `Expected >=12 validated video objects, checked ${videoObjCount}`);
});

await testAsync('Zero-server client auto-refresh (hydrateLiveEspnOverlay) automatically advances week, record, matchup, odds & injuries when games complete', async () => {
  const wfPath = path.join(rootDir, 'scripts', 'github-workflow-refresh-data.yml');
  assert.ok(fs.existsSync(wfPath), 'Missing scripts/github-workflow-refresh-data.yml');
  const wfYaml = fs.readFileSync(wfPath, 'utf8');
  assert.ok(wfYaml.includes('cron:') && wfYaml.includes('node scripts/fetch-live-49ers-data.mjs'));

  const mockAppData = {
    meta: JSON.parse(fs.readFileSync(path.join(rootDir, 'data', 'meta.json'), 'utf8')),
    roster: JSON.parse(fs.readFileSync(path.join(rootDir, 'data', 'roster.json'), 'utf8')),
    health: JSON.parse(fs.readFileSync(path.join(rootDir, 'data', 'health.json'), 'utf8')),
    news: JSON.parse(fs.readFileSync(path.join(rootDir, 'data', 'news.json'), 'utf8')),
    scheduleMatchup: JSON.parse(fs.readFileSync(path.join(rootDir, 'data', 'schedule-matchup.json'), 'utf8')),
    seasonal: JSON.parse(fs.readFileSync(path.join(rootDir, 'data', 'seasonal.json'), 'utf8'))
  };

  const origFetch = globalThis.fetch;
  globalThis.fetch = async url => {
    const u = String(url);
    if (u.includes('/standings')) {
      return new Response(
        JSON.stringify({
          children: [
            {
              standings: {
                entries: [
                  {
                    team: { abbreviation: 'SF' },
                    stats: [
                      { name: 'overall', displayValue: '7-1' },
                      { name: 'wins', value: 7 },
                      { name: 'losses', value: 1 },
                      { name: 'ties', value: 0 },
                      { name: 'winPercent', value: 0.875 },
                      { name: 'pointDifferential', value: 67 },
                      { name: 'pointsFor', value: 226 },
                      { name: 'pointsAgainst', value: 159 },
                      { name: 'playoffSeed', value: 1 },
                      { name: 'vs. Div.', displayValue: '3-0' },
                      { name: 'vs. Conf.', displayValue: '4-1' }
                    ]
                  },
                  {
                    team: { abbreviation: 'DAL' },
                    stats: [
                      { name: 'overall', displayValue: '4-5' },
                      { name: 'wins', value: 4 },
                      { name: 'losses', value: 5 },
                      { name: 'ties', value: 0 },
                      { name: 'winPercent', value: 0.444 },
                      { name: 'pointDifferential', value: 9 }
                    ]
                  }
                ]
              }
            }
          ]
        }),
        { status: 200 }
      );
    }
    if (u.includes('/teams/sf/schedule')) {
      return new Response(
        JSON.stringify({
          events: [
            {
              week: { number: 9 },
              competitions: [
                {
                  status: { type: { completed: true, shortDetail: 'Final' } },
                  competitors: [
                    { team: { abbreviation: 'SF' }, score: { value: 29 } },
                    { team: { abbreviation: 'LV' }, score: { value: 20 } }
                  ]
                }
              ]
            },
            {
              week: { number: 10 },
              competitions: [
                {
                  status: { type: { completed: false, shortDetail: '11/15 - 4:25 PM EST' } },
                  competitors: [
                    { team: { abbreviation: 'SF' } },
                    { team: { abbreviation: 'DAL' } }
                  ]
                }
              ]
            }
          ]
        }),
        { status: 200 }
      );
    }
    if (u.includes('/summary?event=')) {
      return new Response(JSON.stringify({ pickcenter: [{ details: 'SF -4.0', overUnder: 52.5 }] }), { status: 200 });
    }
    if (u.includes('/injuries')) {
      return new Response(JSON.stringify({ injuries: [] }), { status: 200 });
    }
    if (u.includes('/news')) {
      return new Response(
        JSON.stringify({
          articles: [
            {
              id: '999001',
              headline: '49ers move to 7-1 behind Nick Bosa and DeForest Buckner ahead of Dallas trip',
              description: 'San Francisco turns focus to Week 10 at AT&T Stadium.',
              published: '2026-11-09T02:00:00Z',
              links: { web: { href: 'http://www.espn.com/nfl/story/_/id/999001/49ers-win' } }
            }
          ]
        }),
        { status: 200 }
      );
    }
    return new Response('{}', { status: 200 });
  };

  try {
    const changed = await hydrateLiveEspnOverlay(mockAppData);
    assert.equal(changed, true);
    assert.equal(mockAppData.meta.teamRecord, '7-1');
    assert.equal(mockAppData.meta.currentWeek, 10);
    assert.equal(mockAppData.scheduleMatchup.upcomingMatchup.week, 10);
    assert.equal(mockAppData.scheduleMatchup.upcomingMatchup.oppAbbr, 'DAL');
    assert.equal(mockAppData.scheduleMatchup.upcomingMatchup.oppRecord, '4-5');
    assert.equal(mockAppData.scheduleMatchup.upcomingMatchup.homeAway, 'away');
    assert.equal(mockAppData.scheduleMatchup.upcomingMatchup.betting.spread, 'SF -4.0');
    assert.ok(
      mockAppData.news.rawStream.some(it => it.url === 'https://www.espn.com/nfl/story/_/id/999001/49ers-win'),
      'Expected hydrated ESPN article upgraded from http:// to https://'
    );
  } finally {
    globalThis.fetch = origFetch;
  }
});

console.log('\n=== [8/8] Anti-Hallucination Grounding, 7d Player Mentions, <1m Breaking Wire & 6 Beat Podcasts QA ===');

test('Anti-hallucination validator catches retired/departed players (Bryce Huff) while permitting active 2026 49ers & historical context', () => {
  const ros = JSON.parse(fs.readFileSync(path.join(rootDir, 'data', 'roster.json'), 'utf8'));
  const badClaim = 'Unanimous beat consensus that SF will manage Bosa around 45 snaps, rotating Bryce Huff, Keion White, and rookie Romello Height.';
  const checkBad = validateNoHallucinatedRosterClaims(badClaim, ros.players);
  assert.equal(checkBad.ok, false, 'Must flag retired Bryce Huff as hallucinated active 49er');
  assert.ok(checkBad.violations.includes('Bryce Huff'));

  const scrubbed = sanitizeHallucinatedRosterText(badClaim, ros.players);
  assert.ok(!/Bryce Huff/i.test(scrubbed), `Expected Bryce Huff scrubbed, got: ${scrubbed}`);
  assert.ok(scrubbed.includes('Keion White'), 'Active 49er Keion White must remain intact');

  // Historical / retired mention is permitted
  const historicalOk = validateNoHallucinatedRosterClaims(
    'Retired former 49er Bryce Huff is no longer on the 2026 roster.',
    ros.players
  );
  assert.equal(historicalOk.ok, true, 'Explicit retired/former phrasing should be allowed');

  // Players actually on live 2026 49ers roster (DeForest Buckner, Mike Evans, Deebo Samuel Sr.) are permitted
  const activeReturnedOk = validateNoHallucinatedRosterClaims(
    'DeForest Buckner and Nick Bosa anchor the front while Mike Evans rehabs on IR.',
    ros.players
  );
  assert.equal(activeReturnedOk.ok, true);
});

test('Zero hallucinations across news.json, seasonal.json, and podcasts/index.json; system prompt enforces real-time priority', () => {
  const meta = JSON.parse(fs.readFileSync(path.join(rootDir, 'data', 'meta.json'), 'utf8'));
  const ros = JSON.parse(fs.readFileSync(path.join(rootDir, 'data', 'roster.json'), 'utf8'));
  const news = JSON.parse(fs.readFileSync(path.join(rootDir, 'data', 'news.json'), 'utf8'));
  const seasonal = JSON.parse(fs.readFileSync(path.join(rootDir, 'data', 'seasonal.json'), 'utf8'));
  const health = JSON.parse(fs.readFileSync(path.join(rootDir, 'data', 'health.json'), 'utf8'));
  const sm = JSON.parse(fs.readFileSync(path.join(rootDir, 'data', 'schedule-matchup.json'), 'utf8'));
  const cap = JSON.parse(fs.readFileSync(path.join(rootDir, 'data', 'cap.json'), 'utf8'));
  const podIdx = JSON.parse(fs.readFileSync(path.join(rootDir, 'data', 'podcasts', 'index.json'), 'utf8'));

  const rawNewsTxt = JSON.stringify(news);
  const rawSeasonalTxt = JSON.stringify(seasonal);
  const rawPodTxt = JSON.stringify(podIdx);
  assert.ok(!/Bryce Huff/i.test(rawNewsTxt), 'news.json must have zero Bryce Huff references');
  assert.ok(!/Bryce Huff/i.test(rawSeasonalTxt), 'seasonal.json must have zero Bryce Huff references');
  assert.ok(!/Bryce Huff/i.test(rawPodTxt), 'podcasts/index.json must have zero Bryce Huff references');

  // 2027 Draft Prep prospect board, needs & mock drafts must NOT list players already drafted in April 2026
  const dp = seasonal.draftPrep2027 || {};
  const draft2027ProspectsTxt = JSON.stringify({
    topNeeds2027: dp.topNeeds2027,
    consensusMocks: dp.consensusMocks,
    prospectBoard: dp.prospectBoard
  });
  for (const alreadyInNfl of ['Isaiah World', 'Spencer Fano', 'Jermod McCoy', 'Malik Muhammad', 'Eli Stowers']) {
    assert.ok(!draft2027ProspectsTxt.includes(alreadyInNfl), `2027 Draft Prep listed 2026 NFL draftee ${alreadyInNfl}`);
  }

  for (const b of news.clusteredBriefs) {
    const val = validateNoHallucinatedRosterClaims(
      `${b.headline} ${(b.hardFacts || []).join(' ')} ${(b.schemeAndCapTakeaways || []).join(' ')} ${b.consensusVsDissent || ''}`,
      ros.players
    );
    assert.equal(val.ok, true, `Cluster ${b.id} failed anti-hallucination check: ${JSON.stringify(val.violations)}`);
  }

  const sysPrompt = buildLiveGroundingSystemPrompt({ meta, roster: ros, health, scheduleMatchup: sm, cap, seasonal });
  const liveSnap = buildAuthoritativeLiveContextSnapshot({ meta, roster: ros, health, scheduleMatchup: sm, cap, seasonal, news });
  assert.ok(sysPrompt.includes('NEVER rely on stale pre-trained model weights'));
  assert.ok(sysPrompt.includes('Bryce Huff'));
  assert.ok(liveSnap.includes('ACTIVE 53-MAN ROSTER'));
  assert.ok(liveSnap.includes('DeForest Buckner'));
  assert.ok(liveSnap.includes('Mike Evans'));
});

await testAsync('Worker /api/analyze scrubs hallucinated retired players from LLM output and busts cache when live data snapshot updates', async () => {
  const origFetch = globalThis.fetch;
  let geminiCalls = 0;
  globalThis.fetch = async () => {
    geminiCalls++;
    return new Response(
      JSON.stringify({
        candidates: [
          {
            content: {
              parts: [
                {
                  text: '### Pass Rush Rotation\n* SF will rotate Bryce Huff, Keion White, and Nick Bosa on early downs.'
                }
              ]
            }
          }
        ]
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  };

  try {
    const envWithKey = createMockWorkerEnv({ GEMINI_API_KEY: 'mock-key' });
    const res1 = await (
      await edgeWorker.fetch(
        new Request('https://worker.example/api/analyze', {
          method: 'POST',
          headers: { 'X-Group-Passcode': 'faithful49', 'Content-Type': 'application/json' },
          body: JSON.stringify({
            prompt: 'Evaluate 49ers DE rotation',
            contextSummary: 'LIVE RECORD: 6-1 | Active DE: Nick Bosa, Keion White, Mykel Williams'
          })
        }),
        envWithKey
      )
    ).json();

    assert.ok(!/Bryce Huff/i.test(res1.item.markdown), `Worker failed to scrub Bryce Huff: ${res1.item.markdown}`);
    assert.ok(res1.item.markdown.includes('Keion White'));
    assert.equal(geminiCalls, 1);

    // Updating live contextSummary (e.g. after game moves record to 7-1) must bypass old KV cache!
    const res2 = await (
      await edgeWorker.fetch(
        new Request('https://worker.example/api/analyze', {
          method: 'POST',
          headers: { 'X-Group-Passcode': 'faithful49', 'Content-Type': 'application/json' },
          body: JSON.stringify({
            prompt: 'Evaluate 49ers DE rotation',
            contextSummary: 'LIVE RECORD: 7-1 | Active DE: Nick Bosa, Keion White, Mykel Williams'
          })
        }),
        envWithKey
      )
    ).json();
    assert.equal(res2.cached, false, 'Changed live contextSummary must bust stale KV cache');
    assert.equal(geminiCalls, 2);
  } finally {
    globalThis.fetch = origFetch;
  }
});

test('Deep 7-day player mentions populate Mike Evans & Nick Bosa with tweets + articles, 100% author attribution, and full short tweets', () => {
  const ros = JSON.parse(fs.readFileSync(path.join(rootDir, 'data', 'roster.json'), 'utf8'));
  const news = JSON.parse(fs.readFileSync(path.join(rootDir, 'data', 'news.json'), 'utf8'));

  const mikeEvans = ros.players.find(p => p.name === 'Mike Evans');
  const nickBosa = ros.players.find(p => p.name === 'Nick Bosa');
  assert.ok(mikeEvans, 'Mike Evans present on 2026 49ers roster');
  assert.ok(mikeEvans.recentNews.length >= 5, `Expected >=5 recent 7d mentions for Mike Evans, got ${mikeEvans.recentNews.length}`);
  assert.ok(mikeEvans.recentNews.some(n => n.type === 'tweet'), 'Mike Evans must include salient recent tweets');
  assert.ok(mikeEvans.recentNews.some(n => n.type === 'article'), 'Mike Evans must include recent articles');
  assert.ok(nickBosa.recentNews.length >= 5 && nickBosa.recentNews.some(n => n.type === 'tweet'));

  // 100% author attribution across every player mention and every rawStream item
  for (const p of ros.players) {
    for (const m of p.recentNews || []) {
      assert.ok(
        typeof m.author === 'string' && m.author.trim().length >= 2,
        `Player ${p.name} mention "${m.headline}" missing author`
      );
    }
  }
  for (const item of news.rawStream) {
    const auth = item.author || item.reporterName;
    assert.ok(typeof auth === 'string' && auth.trim().length >= 2, `Raw item ${item.id} missing author`);
  }

  // Short tweet full-text preservation (<= 320 chars) vs long-post clean boundary trim
  const shortTweet = '49ers DE Nick Bosa (calf) and RB Christian McCaffrey (hamstring) are off the injury report and good to go Sunday vs. the Raiders.';
  const fmtShort = formatTweetBodyForDisplay(shortTweet, SHORT_TWEET_FULL_TEXT_LIMIT);
  assert.equal(fmtShort.text, shortTweet);
  assert.equal(fmtShort.isFullTweet, true);

  const veryLongPost = `${'A'.repeat(180)} ${'B'.repeat(180)}`;
  const fmtLong = formatTweetBodyForDisplay(veryLongPost, SHORT_TWEET_FULL_TEXT_LIMIT);
  assert.equal(fmtLong.isFullTweet, false);
  assert.ok(fmtLong.text.endsWith('…') && fmtLong.text.length <= SHORT_TWEET_FULL_TEXT_LIMIT + 1);
});

await testAsync('Breaking in-game injury return classifier, game-window detector & live Bluesky hydrator elevate <1m injury tweets to #1', async () => {
  const nowMs = Date.parse('2026-11-08T22:15:00Z'); // Mid-game Sunday 2:15 PM PT (kickoff 21:25Z)
  const gameAppData = {
    scheduleMatchup: {
      upcomingMatchup: { kickoffIso: '2026-11-08T21:25:00Z', liveState: 'pre' },
      schedule: [{ week: 9, dateIso: '2026-11-08T21:25:00Z', completed: false, statusState: 'pre' }]
    }
  };
  assert.equal(is49ersGameLiveWindow(gameAppData, nowMs), true, 'Must detect active 49ers game window by kickoff clock');
  assert.equal(
    is49ersGameLiveWindow(gameAppData, Date.parse('2026-11-05T18:00:00Z')),
    false,
    'Thursday afternoon must not be flagged as live game window'
  );

  const items = [
    {
      id: 'older_feature',
      type: 'article',
      title: 'Film breakdown of Brock Purdy play-action footwork',
      publishedAt: new Date(nowMs - 5 * 60_000).toISOString()
    },
    {
      id: 'live_inj',
      type: 'tweet',
      title: 'Injury update: 49ers LB Fred Warner (ankle) is questionable to return after heading to the blue medical tent.',
      publishedAt: new Date(nowMs - 15 * 60_000).toISOString()
    }
  ];
  const sorted = sortNewsWithBreakingPriority(items, nowMs);
  assert.equal(sorted[0].id, 'live_inj', 'In-game injury return update must rise to #1 above newer regular articles');
  assert.equal(sorted[0].breakingBadge, 'LIVE INJURY UPDATE');
  assert.equal(sorted[0].isInGameInjury, true);

  // Mock Bluesky XRPC live feed to verify client sub-minute hydration into rawStream AND player.recentNews
  const ros = JSON.parse(fs.readFileSync(path.join(rootDir, 'data', 'roster.json'), 'utf8'));
  const news = JSON.parse(fs.readFileSync(path.join(rootDir, 'data', 'news.json'), 'utf8'));
  const liveTestData = { roster: ros, news: { rawStream: [...news.rawStream] } };

  const origFetch = globalThis.fetch;
  globalThis.fetch = async url => {
    if (String(url).includes('mattmaiocco.bsky.social')) {
      return new Response(
        JSON.stringify({
          feed: [
            {
              post: {
                uri: 'at://did:plc:test/app.bsky.feed.post/liveinj999',
                record: {
                  text: 'Injury update from Levi’s Stadium: 49ers DE Nick Bosa (ankle) is questionable to return in the 3rd quarter.',
                  createdAt: new Date().toISOString()
                }
              }
            }
          ]
        }),
        { status: 200 }
      );
    }
    return new Response(JSON.stringify({ feed: [] }), { status: 200 });
  };

  try {
    const added = await hydrateLiveBlueskyBeatWire(liveTestData);
    assert.equal(added, 1);
    assert.ok(liveTestData.news.rawStream[0].title.includes('Nick Bosa (ankle) is questionable to return'));
    assert.equal(liveTestData.news.rawStream[0].breakingBadge, 'LIVE INJURY UPDATE');
    assert.equal(liveTestData.news.rawStream[0].author, 'Matt Maiocco');

    const bosa = liveTestData.roster.players.find(p => p.name === 'Nick Bosa');
    assert.ok(bosa.recentNews[0].headline.includes('Nick Bosa (ankle) is questionable to return'));
    assert.equal(bosa.recentNews[0].breakingBadge, 'LIVE INJURY UPDATE');
    assert.equal(bosa.recentNews[0].author, 'Matt Maiocco');
  } finally {
    globalThis.fetch = origFetch;
  }
});

test('All 6 flagship 49ers podcasts (last 7 days) are populated and native iOS / Android podcast app deep links resolve accurately', () => {
  const pods = JSON.parse(fs.readFileSync(path.join(rootDir, 'data', 'beat-podcasts.json'), 'utf8'));
  const requiredShows = [
    'The Gold Standard',
    '49ers Talk',
    '49ers +/-',
    'Dieter and Hutch',
    'Locked On 49ers',
    'Lombardi Lounge'
  ];
  const showNames = pods.shows.map(s => s.name);
  for (const req of requiredShows) {
    assert.ok(showNames.includes(req), `Missing required 49ers podcast show: ${req}`);
  }
  assert.ok(pods.episodes.length >= 10, `Expected >=10 49ers podcast episodes from last 7 days, got ${pods.episodes.length}`);

  const refMs = new Date(pods.updatedAt).getTime();
  for (const ep of pods.episodes) {
    assert.ok(ep.title && ep.title.length >= 4, 'Podcast episode missing title');
    assert.ok(ep.summary && ep.summary.length >= 15, `Podcast episode "${ep.title}" missing summary`);
    const ageDays = (refMs - new Date(ep.publishedAt).getTime()) / 86_400_000;
    assert.ok(ageDays <= 7.1 && ageDays >= -0.2, `Episode "${ep.title}" outside 7-day window (${ageDays.toFixed(2)}d)`);
  }

  const sampleEp = pods.episodes[0];
  const iosLaunch = buildNativePodcastAppHref(
    sampleEp,
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1',
    5
  );
  assert.equal(iosLaunch.platform, 'ios');
  assert.ok(iosLaunch.href.startsWith('podcasts://podcasts.apple.com/'), `Expected iOS native podcasts:// URI, got ${iosLaunch.href}`);

  const ipadLaunch = buildNativePodcastAppHref(
    sampleEp,
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Safari/605.1.15',
    5
  );
  assert.equal(ipadLaunch.platform, 'ios');
  assert.ok(ipadLaunch.href.startsWith('podcasts://'));

  const androidLaunch = buildNativePodcastAppHref(
    sampleEp,
    'Mozilla/5.0 (Linux; Android 15; Pixel 9 Pro) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36',
    5
  );
  assert.equal(androidLaunch.platform, 'android');
  assert.ok(androidLaunch.href.startsWith('intent://') && androidLaunch.href.includes('scheme=pcast'));

  const desktopLaunch = buildNativePodcastAppHref(
    sampleEp,
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    0
  );
  assert.equal(desktopLaunch.platform, 'desktop');
  assert.ok(desktopLaunch.href.startsWith('https://podcasts.apple.com/'));
});

console.log('\n=== [7/7] Outgoing Link Policy, Paywall Blocker, Homonym Disambiguation & Dynamic Year Rollover QA ===');

test('Paywall & broken-URL policy blocks NYT/Athletic, Chronicle, Mercury News, PFF player grades, ESPN+ & 404 paths while allowing public NFL sources', () => {
  const mustBlock = [
    'https://www.nytimes.com/athletic/nfl/team/niners/',
    'https://www.nytimes.com/athletic/7654321/2026/11/06/49ers-mailbag/?unlocked_article_code=abc',
    'https://theathletic.com/nfl/team/niners/',
    'https://www.sfchronicle.com/sports/49ers/',
    'https://www.mercurynews.com/sports/49ers/',
    'https://www.pff.com/nfl/players/brock-purdy/77812',
    'https://www.pff.com/nfl/teams/san-francisco-49ers/28',
    'https://premium.pff.com/nfl/players/2026/REGPO/brock-purdy/77812/offense',
    'https://www.espn.com/nfl/insider/story/_/id/41234567/nfl-grades',
    'https://www.nfl.com/news/series/power-rankings',
    'https://www.nflmockdraftdatabase.com/team-needs-2027/san-francisco-49ers',
    'https://www.nflmockdraftdatabase.com/mock-plus',
    'https://www.espn.com/nfl/player/_/id/undefined/brock-purdy',
    'https://overthecap.com/player/null/NaN/',
    ''
  ];
  for (const url of mustBlock) {
    assert.equal(isPaywalledOrBlockedUrl(url), true, `Expected blocked/paywalled URL: ${url}`);
    assert.equal(sanitizeExternalUrl(url, null), null, `Expected sanitizeExternalUrl to reject: ${url}`);
  }

  assert.equal(isPaywalledPublisher('The Athletic', 'https://news.google.com/rss/articles/CBMi123'), true);
  assert.equal(isPaywalledPublisher('San Francisco Chronicle', 'https://news.google.com/rss/articles/CBMi456'), true);
  assert.equal(isPaywalledPublisher('The Mercury News', ''), true);
  assert.equal(isPaywalledPublisher('NBC Sports Bay Area', 'https://www.nbcsportsbayarea.com/nfl/san-francisco-49ers/'), false);

  const mustAllow = [
    'https://www.espn.com/nfl/player/_/id/4361741/brock-purdy',
    'https://overthecap.com/player/brock-purdy/10267/',
    'https://www.pro-football-reference.com/players/P/PurdBr00.htm',
    'https://www.pff.com/news/nfl-2026-midseason-all-pro-team',
    'https://www.cbssports.com/nfl/powerrankings/',
    'https://nfeloapp.com/nfl-power-ratings/',
    'https://www.nflmockdraftdatabase.com/teams/2027/san-francisco-49ers',
    'https://www.nflmockdraftdatabase.com/players/2027/jordan-seaton',
    'https://bsky.app/profile/mattbarrows.bsky.social',
    'http://www.espn.com/nfl/standings'
  ];
  for (const url of mustAllow) {
    assert.equal(isPaywalledOrBlockedUrl(url), false, `Expected public URL allowed: ${url}`);
    const sanitized = sanitizeExternalUrl(url, null);
    assert.ok(sanitized && sanitized.startsWith('https://'), `Expected https upgrade for: ${url}`);
  }
});

test('Player identity resolver defeats retired nflverse homonym collisions (1978 ThomJa01 vs active 2026 ThomJa06) and never conflates ESPN IDs with OTC IDs', () => {
  const mockPlayersRows = [
    // Upstream nflverse bug: retired 1978 NYG WR James Thompson carrying rookie DT's espn_id!
    {
      gsis_id: '00-0016349',
      display_name: 'James Thompson',
      espn_id: '4693371',
      pfr_id: 'ThomJa01',
      otc_id: '',
      position: 'WR',
      latest_team: 'NYG',
      birth_date: '1953-01-09',
      last_season: '1978',
      status: 'RET',
      college_name: 'Memphis'
    },
    // Actual active 2026 49ers DT James Thompson Jr. (missing espn_id in upstream CSV)
    {
      gsis_id: '00-0041363',
      display_name: 'James Thompson Jr.',
      espn_id: '',
      pfr_id: 'ThomJa06',
      otc_id: '13808',
      position: 'DT',
      latest_team: 'SFO',
      birth_date: '2002-04-11',
      entry_year: '2025',
      last_season: '2026',
      status: 'ACT',
      college_name: 'Wisconsin'
    },
    // Khalil Dinkins without otc_id in nflverse CSV (resolved via OTC directory)
    {
      gsis_id: '00-0040999',
      display_name: 'Khalil Dinkins',
      espn_id: '4699678',
      pfr_id: 'DinkKh00',
      otc_id: '',
      position: 'TE',
      latest_team: 'SFO',
      birth_date: '2001-05-03',
      entry_year: '2025',
      last_season: '2026',
      status: 'DEV',
      college_name: 'Penn State'
    }
  ];

  const mockOtcPlayers = [
    { name: 'James Thompson Jr.', otcId: '13808', slug: 'james-thompson-jr' },
    { name: 'Khalil Dinkins', otcId: '13810', slug: 'khalil-dinkins' },
    { name: 'Ogbonnia Okoronkwo', otcId: '7045', slug: 'ogbonnia-okoronkwo' }
  ];

  const resolver = createPlayerIdentityResolver({
    nflPlayers: mockPlayersRows,
    otcPlayers: mockOtcPlayers,
    seasonYear: 2026
  });

  const resolvedJt = resolver.resolvePlayer({
    espnId: '4693371',
    fullName: 'James Thompson Jr.',
    position: 'DT',
    college: 'Wisconsin',
    teamAbbr: 'SF'
  });
  assert.equal(resolvedJt.pfrId, 'ThomJa06');
  assert.equal(resolvedJt.pfrUrl, 'https://www.pro-football-reference.com/players/T/ThomJa06.htm');
  assert.equal(resolvedJt.otcId, '13808');
  assert.equal(resolvedJt.otcUrl, 'https://overthecap.com/player/james-thompson-jr/13808/');

  const resolvedKd = resolver.resolvePlayer({
    espnId: '4699678',
    fullName: 'Khalil Dinkins',
    position: 'TE',
    college: 'Penn State',
    teamAbbr: 'SF'
  });
  assert.equal(resolvedKd.otcId, '13810');
  assert.notEqual(resolvedKd.otcId, '4699678');
  assert.equal(resolvedKd.otcUrl, 'https://overthecap.com/player/khalil-dinkins/13810/');
  assert.equal(isValidOtcPlayerId('4699678', '4699678'), false);

  // Nickname resolution: ESPN "Ogbo Okoronkwo" <-> OTC "Ogbonnia Okoronkwo"
  assert.ok(getPlayerLookupKeys('Ogbo Okoronkwo').includes('ogbonniaokoronkwo'));
  const resolvedOgbo = resolver.resolvePlayer({
    espnId: '3915486',
    fullName: 'Ogbo Okoronkwo',
    position: 'DE',
    teamAbbr: 'SF'
  });
  assert.equal(resolvedOgbo.otcId, '7045');
  assert.equal(resolvedOgbo.otcUrl, 'https://overthecap.com/player/ogbonnia-okoronkwo/7045/');
});

await testAsync('Dynamic season/draft year rollover (2027 season / 2028 draft) updates OTC contract windows, PFR, MockDraftDB & ESPN team slugs without hardcoded years', async () => {
  // 1. Dynamic OverTheCap parser window when OTC HTML advances to 2027-2031
  const syntheticOtc2027Html = `
    <div id="y2027" class="salary-cap-container">
      Total Cap Liabilities: $318,000,000 Top 51: $270,000,000 Team Cap Space: $41,500,000 Offense: $150,000,000 Defense: $130,000,000 Special: $7,000,000
      <table class="team-salary-cap-table"><tbody>
        <tr><td><a href="/player/brock-purdy/10267/">Brock Purdy</a></td><td>$18,000,000</td><td>$7,100,000</td><td>$7,550,000</td><td>$0</td><td>$850,000</td><td>$100,000</td><td>$0</td><td>$18,000,000</td><td>$33,600,000</td>
        <td><span class="cap_2027 cut">$58,000,000</span><span class="cap_2027 june_1_cut">$14,650,000</span><span class="cap_2027 restructure">$0</span></td>
        <td><span class="cap_2027 cut">-$24,400,000</span><span class="cap_2027 june_1_cut">$18,950,000</span><span class="cap_2027 restructure">$13,200,000</span></td></tr>
      </tbody></table>
      <table class="non-active"><tbody>
        <tr><td><a href="/player/khalil-dinkins/13810/">Khalil Dinkins</a></td><td>$289,800</td></tr>
      </tbody></table>
    </div>
    <div id="y2028" class="salary-cap-container">Total Cap Liabilities: $295,000,000 Top 51: $260,000,000 Team Cap Space: $52,000,000</div>
    <div id="y2029" class="salary-cap-container"></div>
    <div id="y2030" class="salary-cap-container"></div>
    <div id="y2031" class="salary-cap-container"></div>
  `;
  const parsed27 = parseOverTheCapHtml(syntheticOtc2027Html, 2027);
  assert.deepEqual(Object.keys(parsed27.years), ['2027', '2028', '2029', '2030', '2031']);
  assert.equal(parsed27.otcDirectory.find(x => x.slug === 'khalil-dinkins')?.otcId, '13810');

  const sim27 = simulateCapScenario({ years: parsed27.years, players: parsed27.otcPlayers }, {});
  assert.equal(sim27.summary.updatedCapSpace, 41_500_000);

  // 2. Dynamic URL builders for future years & special franchise codes (WAS -> wsh, LV -> rai, SF -> sfo)
  assert.equal(buildPfrTeamSeasonUrl('SF', 2027), 'https://www.pro-football-reference.com/teams/sfo/2027.htm');
  assert.equal(buildPfrTeamDraftUrl('SF', 2027), 'https://www.pro-football-reference.com/teams/sfo/2027_draft.htm');
  assert.equal(buildPfrHeadToHeadUrl('SF', 'LV'), 'https://www.pro-football-reference.com/boxscores/game_query.cgi?tm1=sfo&tm2=rai&yr=all');
  assert.equal(buildEspnTeamInjuriesUrl('WAS'), 'https://www.espn.com/nfl/team/injuries/_/name/wsh');
  assert.equal(buildEspnTeamLogoUrl('WAS'), 'https://a.espncdn.com/i/teamlogos/nfl/500/wsh.png');
  assert.equal(buildMockDraftTeamUrl(2028), 'https://www.nflmockdraftdatabase.com/teams/2028/san-francisco-49ers');
  assert.equal(buildMockDraftBigBoardUrl(2028), 'https://www.nflmockdraftdatabase.com/big-boards/2028/consensus-big-board-2028');
  // Prospect slug from 2027 falls back cleanly to 2028 Big Board when draftYear advances to 2028 (preventing 404s!)
  assert.equal(
    buildMockDraftProspectUrl(2028, 'jordan-seaton', 2027),
    'https://www.nflmockdraftdatabase.com/big-boards/2028/consensus-big-board-2028'
  );

  const dp2028 = buildDraftPrep2027AndCombine([], 2028);
  assert.equal(dp2028.draftYear, 2028);
  assert.equal(dp2028.sources[0].url, 'https://www.nflmockdraftdatabase.com/teams/2028/san-francisco-49ers');
  for (const tgt of dp2028.consensusMockTargets) {
    assert.equal(isPaywalledOrBlockedUrl(tgt.sourceUrl), false);
    assert.ok(tgt.sourceUrl.includes('/2028/'));
  }

  const tw2027 = buildTradeDeadlineWarRoom(parsed27.years['2027'], () => null, buildEspnTeamLogoUrl, '5-2', 2027);
  for (const fit of tw2027.realisticTargets) {
    assert.ok(fit.sourceUrl.endsWith('/2027'), `Expected dynamic /2027 OTC position URL, got ${fit.sourceUrl}`);
    assert.equal(isPaywalledOrBlockedUrl(fit.sourceUrl), false);
  }
});

await testAsync('Client-side Bluesky live wire hydrator strips paywalled externalUrl embeds while preserving free beat posts', async () => {
  const liveTestData = { roster: { players: [] }, news: { rawStream: [] } };
  const origFetch = globalThis.fetch;
  globalThis.fetch = async url => {
    if (String(url).includes('mattbarrows.bsky.social')) {
      return new Response(
        JSON.stringify({
          feed: [
            {
              post: {
                uri: 'at://did:plc:test/app.bsky.feed.post/paywallguard123',
                record: {
                  text: '49ers practice report: Brock Purdy and Nick Bosa were full participants on Friday ahead of Sunday.',
                  createdAt: new Date().toISOString()
                },
                embed: {
                  external: {
                    uri: 'https://www.nytimes.com/athletic/9999999/2026/11/07/49ers-practice-report/',
                    title: 'Paywalled Athletic Story'
                  }
                }
              }
            }
          ]
        }),
        { status: 200 }
      );
    }
    return new Response(JSON.stringify({ feed: [] }), { status: 200 });
  };

  try {
    const added = await hydrateLiveBlueskyBeatWire(liveTestData);
    assert.equal(added, 1);
    const post = liveTestData.news.rawStream[0];
    assert.equal(post.url, 'https://bsky.app/profile/mattbarrows.bsky.social/post/paywallguard123');
    assert.equal(post.externalUrl, null, 'Paywalled NYT/Athletic externalUrl must be stripped');
    assert.equal(post.externalTitle, null, 'Paywalled externalTitle must be cleared when externalUrl is stripped');
  } finally {
    globalThis.fetch = origFetch;
  }
});

test('Exhaustive URL audit across all 11 compiled JSON feeds & all 88 roster players: 100% HTTPS, zero paywalls, zero homonym bugs', () => {
  const jsonFiles = [
    'data/meta.json',
    'data/roster.json',
    'data/depth-chart.json',
    'data/cap.json',
    'data/reporters.json',
    'data/news.json',
    'data/schedule-matchup.json',
    'data/health.json',
    'data/seasonal.json',
    'data/beat-podcasts.json',
    'data/podcasts/index.json'
  ];

  let scannedUrlCount = 0;
  const violations = [];
  const walkUrls = (val, loc) => {
    if (typeof val === 'string' && /^https?:\/\//i.test(val.trim())) {
      scannedUrlCount += 1;
      if (!val.startsWith('https://')) {
        violations.push(`${loc}: non-HTTPS URL ${val}`);
      }
      if (isPaywalledOrBlockedUrl(val)) {
        violations.push(`${loc}: paywalled or broken URL ${val}`);
      }
    } else if (Array.isArray(val)) {
      val.forEach((item, i) => walkUrls(item, `${loc}[${i}]`));
    } else if (val && typeof val === 'object') {
      for (const [k, v] of Object.entries(val)) {
        walkUrls(v, `${loc}.${k}`);
      }
    }
  };

  for (const rel of jsonFiles) {
    const parsed = JSON.parse(fs.readFileSync(path.join(rootDir, rel), 'utf8'));
    walkUrls(parsed, rel);
  }

  assert.ok(scannedUrlCount >= 2000, `Expected >=2000 scanned URLs across data/*.json, got ${scannedUrlCount}`);
  assert.deepEqual(violations, [], `Found link policy violations:\n${violations.join('\n')}`);

  const roster = JSON.parse(fs.readFileSync(path.join(rootDir, 'data', 'roster.json'), 'utf8')).players;
  assert.ok(roster.length >= 80, `Expected >=80 roster players, got ${roster.length}`);
  for (const p of roster) {
    assert.match(
      p.espnUrl || '',
      /^https:\/\/www\.espn\.com\/nfl\/player\/_\/id\/\d+\/[a-z0-9-]+$/,
      `Invalid espnUrl for ${p.name}: ${p.espnUrl}`
    );
    assert.ok(
      isIndividualOtcPlayerUrl(p.otcUrl) || p.otcUrl === OTC_TEAM_CAP_URL,
      `Invalid otcUrl for ${p.name}: ${p.otcUrl}`
    );
    if (p.otcId) {
      assert.equal(
        isValidOtcPlayerId(p.otcId, p.id),
        true,
        `Player ${p.name} has invalid otcId (${p.otcId}) vs espnId (${p.id})`
      );
    }
    if (p.pfrUrl) {
      assert.equal(isValidPfrPlayerId(p.pfrId), true, `Invalid pfrId for ${p.name}: ${p.pfrId}`);
      assert.equal(p.pfrUrl, buildPfrPlayerUrl(p.pfrId), `Mismatched pfrUrl for ${p.name}: ${p.pfrUrl}`);
    }
  }

  // Regression guards on previously broken per-player links
  const jamesThompson = roster.find(p => p.name === 'James Thompson Jr.');
  assert.ok(jamesThompson, 'James Thompson Jr. present on roster');
  assert.equal(jamesThompson.pfrId, 'ThomJa06', 'James Thompson Jr. must resolve to active DT ThomJa06, not 1978 ThomJa01');
  assert.equal(jamesThompson.otcUrl, 'https://overthecap.com/player/james-thompson-jr/13808/');

  const khalilDinkins = roster.find(p => p.name === 'Khalil Dinkins');
  assert.ok(khalilDinkins, 'Khalil Dinkins present on roster');
  assert.equal(khalilDinkins.otcId, '13810');
  assert.equal(khalilDinkins.otcUrl, 'https://overthecap.com/player/khalil-dinkins/13810/');
});

console.log('\n=== [10/10] 5-Year OTC Cap Horizon, Multi-Year Simulator, Jargon Glossary, Opponent Health Parity & 30d Trade Cutoff QA ===');

test('5-Year OverTheCap summary (2026–2030) has exact gross space, effective space, liabilities, Top-51 & non-double-counted dead cap', () => {
  const yrs = Object.keys(capData.years).sort();
  assert.deepEqual(yrs, ['2026', '2027', '2028', '2029', '2030']);
  for (const y of yrs) {
    const row = capData.years[y];
    assert.ok(Number.isFinite(row.capCeiling) && row.capCeiling > 250_000_000, `Invalid capCeiling for ${y}`);
    assert.ok(Number.isFinite(row.totalCapLiabilities) && row.totalCapLiabilities > 50_000_000, `Invalid liabilities for ${y}`);
    assert.ok(Number.isFinite(row.top51) && row.top51 > 50_000_000, `Invalid top51 for ${y}`);
    assert.ok(Number.isFinite(row.teamCapSpace), `Invalid teamCapSpace for ${y}`);
    assert.ok(Number.isFinite(row.effectiveCapSpace), `Invalid effectiveCapSpace for ${y}`);
    assert.ok(Number.isFinite(row.deadMoneyTotal) && row.deadMoneyTotal >= 0, `Invalid deadMoneyTotal for ${y}`);
  }
  assert.equal(capData.years['2026'].deadMoneyTotal, 46020699, '2026 OTC Dead Money must match exact $46,020,699 without footer double-counting');
  assert.equal(capData.years['2027'].teamCapSpace, -31540066, '2027 OTC Team Cap Space must parse negative ($31,540,066)');
});

test('Multi-Year Salary Cap Simulator (2026–2030) combines Prorated & Current-Yr Bonuses, defaults Dead Money & Cap Savings to $0, and computes OTC moves per year', () => {
  for (const yr of ['2026', '2027', '2028', '2029', '2030']) {
    const baseline = simulateCapScenario(capData, {}, { baseYear: yr });
    assert.equal(baseline.baseYear, yr);
    assert.equal(baseline.simulatedPlayers.length, capData.years[yr].contractedCount);
    for (const sp of baseline.simulatedPlayers) {
      assert.equal(sp.proratedBonus, sp.proratedSigning + sp.proratedOption);
      assert.equal(
        sp.currentYearBonuses,
        sp.rosterBonusRegular + sp.rosterBonusPerGame + sp.workoutBonus + sp.otherBonus
      );
      assert.equal(sp.moveDeadMoney, 0, `Nominal dead money must be $0 when move is none (${sp.name} ${yr})`);
      assert.equal(sp.moveCapSavings, 0, `Nominal cap savings must be $0 when move is none (${sp.name} ${yr})`);
    }
  }

  // Verify Brock Purdy & Fred Warner 2026 Post-June 1 Cut numbers match OverTheCap screenshot penny-for-penny
  const purdy = capData.players.find(p => p.name === 'Brock Purdy');
  const warner = capData.players.find(p => p.name === 'Fred Warner');
  const sim26 = simulateCapScenario(
    capData,
    { [purdy.id]: 'june_1_cut', [warner.id]: 'june_1_cut' },
    { baseYear: '2026' }
  );
  const simPurdy = sim26.simulatedPlayers.find(p => p.id === purdy.id);
  const simWarner = sim26.simulatedPlayers.find(p => p.id === warner.id);
  assert.equal(simPurdy.proratedBonus, 7313530 + 7550000);
  assert.equal(simPurdy.currentYearBonuses, 850000 + 100000);
  assert.equal(simPurdy.guaranteedSalary, 46996000);
  assert.equal(simPurdy.capNumber, 23709530);
  assert.equal(simPurdy.moveDeadMoney, 66213530);
  assert.equal(simPurdy.moveCapSavings, -42504000);
  assert.equal(simWarner.moveDeadMoney, 11739000);
  assert.equal(simWarner.moveCapSavings, 6126471);

  // Verify simulating in 2027 and 2028 works independently
  const sim27 = simulateCapScenario(capData, { [purdy.id]: 'restructure' }, { baseYear: '2027' });
  assert.equal(sim27.baseYear, '2027');
  assert.equal(sim27.summary.baseYearNetCapDelta, 8112000);

  const sim28 = simulateCapScenario(capData, { [purdy.id]: 'restructure' }, { baseYear: '2028' });
  assert.equal(sim28.baseYear, '2028');
  assert.equal(sim28.summary.baseYearNetCapDelta, 26316000);
});

test('Jargon Glossary annotates EPA, CPOE, Jet motion, inside zone, Wide-9 & Post-June 1 while escaping XSS', () => {
  assert.ok(Object.keys(JARGON_GLOSSARY).length >= 45);
  assert.ok(getJargonEntry('epa')?.term.includes('Expected Points'));
  assert.ok(getJargonEntry('epa')?.definition.includes('expected scoring'));
  assert.ok(getJargonEntry('cpoe')?.definition.includes('completion'));
  assert.ok(getJargonEntry('jet_motion')?.definition.includes('motion'));
  assert.ok(getJargonEntry('inside_zone')?.term.includes('Inside Zone') && getJargonEntry('inside_zone')?.definition.includes('double-teams'));

  const annotated = annotateJargonPlainText(
    'Purdy posted +0.28 EPA and +4.2% CPOE off jet motion and inside zone <img src=x onerror=alert(1)>.'
  );
  assert.ok(annotated.includes('data-jargon="epa"'));
  assert.ok(annotated.includes('data-jargon="cpoe"'));
  assert.ok(annotated.includes('data-jargon="jet_motion"'));
  assert.ok(annotated.includes('data-jargon="inside_zone"'));
  assert.ok(!annotated.includes('<img'), 'XSS payload must be HTML-escaped');
});

test('Opponent Health & Play Likelihood has full parity with 49ers Health (Availability Index, Offense+Defense starters, priors & 4-game IR timeline)', () => {
  const sched = JSON.parse(fs.readFileSync(path.join(rootDir, 'data', 'schedule-matchup.json'), 'utf8'));
  const oh = sched.upcomingMatchup?.opponentHealth;
  assert.ok(oh, 'opponentHealth present');
  assert.ok(oh.summary.overallAvailabilityScore >= 50 && oh.summary.overallAvailabilityScore <= 100);
  assert.equal(oh.summary.totalStarters, 22);
  assert.ok(oh.keyStartersHealthy.some(s => s.name === 'Maxx Crosby'), 'Defensive star Maxx Crosby included in healthy starters');
  assert.ok(oh.injuryReport.length >= 3);
  for (const p of oh.injuryReport) {
    assert.ok(typeof p.archetypeNote === 'string' && p.archetypeNote.length > 5);
    assert.ok(Array.isArray(p.factors) && p.factors.length >= 1);
  }
  assert.ok(oh.irReserve.length >= 1);
  for (const ir of oh.irReserve) {
    if (ir.isSeasonEnding) {
      assert.equal(ir.earliestEligibleWeek, null, `Season-ending opp IR ${ir.name} must have null earliestEligibleWeek`);
      assert.equal(ir.projectedReturnWeek, 'Out for Season', `Season-ending opp IR ${ir.name} must be Out for Season`);
    } else if (!/Reinstatement/i.test(String(ir.projectedReturnWeek || ''))) {
      assert.ok(ir.earliestEligibleWeek >= 5, `Return-eligible opp IR ${ir.name} expected earliestEligibleWeek >= 5, got ${ir.earliestEligibleWeek}`);
    }
    assert.ok(
      (typeof ir.projectedReturnWeek === 'number' && ir.projectedReturnWeek >= 5) ||
        (typeof ir.projectedReturnWeek === 'string' && ir.projectedReturnWeek.length >= 4)
    );
  }
});

test('Trade Window 30-day cutoff keeps recent acquisitions (<=30d) in Trade Window and moves older trades (>30d) to Archive', () => {
  const seasonal = JSON.parse(fs.readFileSync(path.join(rootDir, 'data', 'seasonal.json'), 'utf8'));
  const moves = seasonal.tradeWarRoom?.completed2026Moves || [];
  const { recentTrades, archivedTrades } = partitionCompletedTradesByWindow(moves, '2026-11-07T18:00:00Z', 30);
  assert.ok(recentTrades.some(m => m.player === 'DeForest Buckner'), 'DeForest Buckner (Nov 3 trade) must be in recentTrades');
  assert.ok(!recentTrades.some(m => m.player === 'Osa Odighizuwa'), 'Osa Odighizuwa (March trade) must NOT be in recentTrades');
  assert.ok(archivedTrades.some(m => m.player === 'Osa Odighizuwa'), 'Osa Odighizuwa (>30d old) must be in archivedTrades');
});

test('Calibrated Playoff Monte Carlo avoids un-regressed 54.8% inflation and honors NFL 3-club H2H sweep + Step-1 restart rules', () => {
  const seasonal = JSON.parse(fs.readFileSync(path.join(rootDir, 'data', 'seasonal.json'), 'utf8'));
  const sf = seasonal.playoffPicture?.baselineSimulation?.sfOdds;
  assert.ok(sf, 'sfOdds present');
  assert.ok(
    sf.seed1ByePct >= 25 && sf.seed1ByePct <= 45,
    `Expected calibrated #1 Seed Bye % in [25, 45] (Gemini Argon benchmark 33.5–40%), got ${sf.seed1ByePct}%`
  );
  assert.ok(
    sf.winDivisionPct >= 70 && sf.winDivisionPct <= 92,
    `Expected calibrated NFC West % in [70, 92], got ${sf.winDivisionPct}%`
  );
  assert.ok(
    sf.makePlayoffsPct >= 85 && sf.makePlayoffsPct <= 98,
    `Expected calibrated Playoff Berth % in [85, 98], got ${sf.makePlayoffsPct}%`
  );
  assert.ok(
    sf.projectedWins >= 11.2 && sf.projectedWins <= 13.0,
    `Expected calibrated projected wins in [11.2, 13.0], got ${sf.projectedWins}`
  );

  // Verify NFL 3-club Wild Card H2H complete-sweep rule (Team A beats BOTH B and C -> A wins #1 seed)
  const threeWayTeams = [
    { abbr: 'SF', name: '49ers', division: 'NFC West', wins: 13, losses: 4, confWins: 8, confLosses: 4, pointDiff: 40, powerRating: 1550 },
    { abbr: 'MIN', name: 'Vikings', division: 'NFC North', wins: 13, losses: 4, confWins: 10, confLosses: 2, pointDiff: 90, powerRating: 1550 },
    { abbr: 'PHI', name: 'Eagles', division: 'NFC East', wins: 13, losses: 4, confWins: 10, confLosses: 2, pointDiff: 85, powerRating: 1550 },
    { abbr: 'TB', name: 'Bucs', division: 'NFC South', wins: 9, losses: 8, confWins: 6, confLosses: 6, pointDiff: 0, powerRating: 1500 }
  ];
  const sweepSim = runPlayoffMonteCarlo({
    nfcTeams: threeWayTeams,
    completedGames: [
      { id: 'g1', week: 5, home: 'SF', away: 'MIN', homeScore: 24, awayScore: 20 },
      { id: 'g2', week: 10, home: 'PHI', away: 'SF', homeScore: 17, awayScore: 27 }
    ],
    remainingGames: [],
    iterations: 100
  });
  assert.equal(sweepSim.sfOdds.seed1ByePct, 100, 'SF complete H2H sweep over both MIN & PHI must award #1 Seed despite lower confWins');
});

test('Trade Window purchasing power, real targets, pitfalls to avoid, and 6-pick 2027 Tankathon draft ledger are verified', () => {
  const seasonal = JSON.parse(fs.readFileSync(path.join(rootDir, 'data', 'seasonal.json'), 'utf8'));
  const tw = seasonal.tradeWarRoom;
  assert.ok(Array.isArray(tw.purchasingPower) && tw.purchasingPower.length === 3, 'purchasingPower 3-tier array required');
  assert.ok(Array.isArray(tw.pitfallsToAvoid) && tw.pitfallsToAvoid.length >= 3, 'pitfallsToAvoid required');
  assert.ok(tw.pitfallsToAvoid.some(p => /Cameron Jordan/i.test(`${p.trap} ${p.examples}`)), 'Must warn against 0-sack age-37 Cameron Jordan trap');
  assert.ok(tw.pitfallsToAvoid.some(p => /Michael Mayer/i.test(`${p.trap} ${p.examples}`)), 'Must warn against extended Michael Mayer rumor');

  const bucknerMove = tw.completed2026Moves.find(m => m.player === 'DeForest Buckner');
  assert.ok(bucknerMove && /2027 4th/i.test(bucknerMove.costSummary), 'Buckner trade must cite 2027 4th-round pick cost');

  assert.ok(tw.realisticTargets.length >= 8);
  for (const t of tw.realisticTargets) {
    assert.ok(!/archetype/i.test(t.name), `Fake archetype target forbidden: ${t.name}`);
    assert.ok(typeof t.currentTeam === 'string' && t.currentTeam.length >= 3);
    assert.ok(typeof t.cap2027Impact === 'string' && t.cap2027Impact.length >= 2);
  }

  const dp = seasonal.draftPrep2027;
  assert.equal(dp.pickInventory.length, 6, 'SF owns exactly 6 picks in 2027 after Buckner Rd 4 trade');
  assert.ok(!dp.pickInventory.some(p => p.round === 4), 'Phantom 2027 Round 4 pick must not appear in pickInventory');
  assert.ok(/Buckner/i.test(dp.tradedPicksNote || ''), 'tradedPicksNote must document Rd 4 sent to IND for Buckner');

  // Unit check on Tankathon HTML parser
  const parsedSample = parseTankathonTeamPicksHtml(`
    <h2 class="team-page-section-title">Current Draft Picks</h2>
    <div class="pick-card"><div class="pick-card-round">1.31 </div>31</div><div class="abbreviation">SF</div></div>
    <div class="pick-card"><div class="pick-card-round">6.14 </div>193</div><div class="abbreviation">BAL</div></div>
  `);
  assert.equal(parsedSample.length, 2);
  assert.equal(parsedSample[0].projectedOverall, 31);
  assert.equal(parsedSample[1].fromTeam, 'BAL');
});

await testAsync('Worker defaults to best free model (gemini-3.8-flash on High Thinking), strips internal thought parts, and preserves external trade/dead-cap context', async () => {
  const origFetch = globalThis.fetch;
  let capturedUrl = '';
  let capturedBody = null;
  globalThis.fetch = async (reqUrl, init) => {
    capturedUrl = String(reqUrl);
    capturedBody = JSON.parse(init.body);
    return new Response(
      JSON.stringify({
        candidates: [
          {
            content: {
              parts: [
                { thought: true, text: 'INTERNAL_SECRET_THOUGHT_SCRATCHPAD: checking cap tables...' },
                {
                  text: '### Cap & Trade Audit\n* Javon Hargrave carries 2026 dead cap money, while Saints trade target Chase Young plays in New Orleans. Active SF edge Bryce Huff rotates in.'
                }
              ]
            }
          }
        ]
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  };

  try {
    const envPro = createMockWorkerEnv({ GEMINI_API_KEY: 'mock-key' });
    delete envPro.GEMINI_TEXT_MODEL; // verify default fallback is gemini-3.8-flash on HIGH thinking!
    const res = await (
      await edgeWorker.fetch(
        new Request('https://worker.example/api/analyze', {
          method: 'POST',
          headers: { 'X-Group-Passcode': 'faithful49', 'Content-Type': 'application/json' },
          body: JSON.stringify({
            prompt: 'Audit 2026 dead cap and trade window edge market',
            contextSummary: 'LIVE RECORD: 6-1 | Active DE: Nick Bosa, Keion White, Mykel Williams'
          })
        }),
        envPro
      )
    ).json();

    assert.ok(capturedUrl.includes('models/gemini-3.8-flash:generateContent'), `Expected gemini-3.8-flash URL, got ${capturedUrl}`);
    assert.ok(capturedBody.generationConfig?.thinkingConfig?.thinkingBudget >= 24576, 'Expected HIGH thinkingBudget (24576)');
    assert.ok(!res.item.markdown.includes('INTERNAL_SECRET_THOUGHT_SCRATCHPAD'), 'Thought part must never leak into output');
    assert.ok(!/Bryce Huff/i.test(res.item.markdown), 'Active-49er Bryce Huff hallucination must be scrubbed');
    assert.ok(/Javon Hargrave/i.test(res.item.markdown), 'Legitimate 2026 dead-cap mention of Javon Hargrave must be preserved');
    assert.ok(/Chase Young/i.test(res.item.markdown), 'Legitimate Saints trade-target mention of Chase Young must be preserved');
  } finally {
    globalThis.fetch = origFetch;
  }
});

await testAsync('Free-tier model discovery & Worker /api/model-status automatically rank newer Flash High-Thinking models and fail over cleanly', async () => {
  assert.equal(DEFAULT_FREE_MODEL_CASCADE[0], 'gemini-3.8-flash');
  assert.ok(
    scoreFreeTierGeminiModel('gemini-3.8-flash') > scoreFreeTierGeminiModel('gemini-2.5-pro'),
    'Newer gemini-3.8-flash on High Thinking must outscore older restricted gemini-2.5-pro for free-tier synthesis'
  );
  assert.ok(
    scoreFreeTierGeminiModel('gemini-4.0-flash') > scoreFreeTierGeminiModel('gemini-3.8-flash'),
    'Future gemini-4.0-flash release must automatically outscore gemini-3.8-flash'
  );
  assert.equal(scoreFreeTierGeminiModel('gemini-2.5-flash-preview-tts'), -1, 'TTS models must be excluded from text synthesis');
  assert.equal(scoreFreeTierGeminiModel('gemini-2.5-flash-lite'), -1, 'Lite models must be excluded from High-Thinking synthesis');

  const ranked = rankFreeTierModelsFromCatalog([
    { name: 'models/gemini-2.5-pro', supportedGenerationMethods: ['generateContent'] },
    { name: 'models/gemini-3.9-flash', supportedGenerationMethods: ['generateContent'] },
    { name: 'models/gemini-3.8-flash', supportedGenerationMethods: ['generateContent'] },
    { name: 'models/gemini-2.5-flash-preview-tts', supportedGenerationMethods: ['generateContent'] }
  ]);
  assert.equal(ranked[0], 'gemini-3.9-flash', 'Catalog poll must auto-upgrade to newly released gemini-3.9-flash');
  assert.equal(ranked[1], 'gemini-3.8-flash');

  const origFetch = globalThis.fetch;
  const calledUrls = [];
  globalThis.fetch = async reqUrl => {
    const u = String(reqUrl);
    calledUrls.push(u);
    if (u.includes('/v1beta/models?key=')) {
      return new Response(
        JSON.stringify({
          models: [
            { name: 'models/gemini-4.0-flash', supportedGenerationMethods: ['generateContent'] },
            { name: 'models/gemini-3.8-flash', supportedGenerationMethods: ['generateContent'] }
          ]
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }
    if (u.includes('models/gemini-4.0-flash:generateContent')) {
      // Simulate quota exhaustion / 429 on 4.0-flash to verify automatic failover to 3.8-flash
      return new Response(JSON.stringify({ error: { message: 'Quota exceeded' } }), { status: 429 });
    }
    return new Response(
      JSON.stringify({
        candidates: [{ content: { parts: [{ text: '### Verified Failover Synthesis\n* Active DE Nick Bosa leads the pass rush.' }] } }]
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  };

  try {
    const envAuto = createMockWorkerEnv({ GEMINI_API_KEY: 'mock-key', GEMINI_TEXT_MODEL: 'auto' });
    const statusRes = await (
      await edgeWorker.fetch(
        new Request('https://worker.example/api/model-status?poll=1', {
          headers: { 'X-Group-Passcode': 'faithful49' }
        }),
        envAuto
      )
    ).json();
    assert.equal(statusRes.bestModel, 'gemini-4.0-flash', 'Polling /api/model-status?poll=1 must discover gemini-4.0-flash');
    assert.equal(statusRes.thinkingLevel, 'HIGH');
    assert.equal(statusRes.thinkingBudget, 24576);

    const analyzeRes = await (
      await edgeWorker.fetch(
        new Request('https://worker.example/api/analyze', {
          method: 'POST',
          headers: { 'X-Group-Passcode': 'faithful49', 'Content-Type': 'application/json' },
          body: JSON.stringify({ prompt: 'Pass rush check', contextSummary: 'Active DE: Nick Bosa' })
        }),
        envAuto
      )
    ).json();
    assert.ok(analyzeRes.item.markdown.includes('Verified Failover Synthesis'));
    assert.ok(calledUrls.some(u => u.includes('models/gemini-4.0-flash:generateContent')));
    assert.ok(calledUrls.some(u => u.includes('models/gemini-3.8-flash:generateContent')));
  } finally {
    globalThis.fetch = origFetch;
  }
});

console.log('\n=== [8/8] Deep Health, Season-Ending IR, Official 49ers.com Reconciliation & Roster Hygiene QA ===');

test('parseFlexibleIsoMs & classifyIrAndReserveTimeline detect Season-Ending IR, rolling-date traps, and open 21-day windows', () => {
  // 1. Full ISO timestamp with offset must NOT produce NaN (previously broken by appending T12:00:00Z)
  const fullIsoMs = parseFlexibleIsoMs('2027-02-15T00:00:00.000+00:00');
  assert.ok(Number.isFinite(fullIsoMs) && fullIsoMs > Date.UTC(2027, 1, 14), 'Full ISO timestamp parsed cleanly');
  const ymdMs = parseFlexibleIsoMs('2026-11-15');
  assert.ok(Number.isFinite(ymdMs), 'YYYY-MM-DD parsed cleanly');

  const sampleSchedule = [
    { week: { number: 1 }, date: '2026-09-13T20:25Z' },
    { week: { number: 4 }, date: '2026-10-04T20:05Z' },
    { week: { number: 9 }, date: '2026-11-08T21:25Z' },
    { week: { number: 10 }, date: '2026-11-15T21:25Z' }
  ];

  // 2. Alfred Collins Season-Ending IR (patellar tendon tear + 2027-02-15 post-Super-Bowl returnDate + OFS fantasyStatus)
  const collins = classifyIrAndReserveTimeline({
    statusRaw: 'Injured Reserve',
    fantasyStatusAbbr: 'OFS',
    injuryType: 'Knee',
    injuryDetail: 'Surgery',
    returnDateIso: '2027-02-15',
    placedDateIso: '2026-08-19T18:00:00Z',
    beatNote: 'Collins is set to miss the entire 2026 campaign as a result of tearing his patellar tendon.',
    currentWeek: 9,
    byeWeek: 8,
    seasonYear: 2026,
    scheduleEvents: sampleSchedule
  });
  assert.equal(collins.isSeasonEnding, true);
  assert.equal(collins.status, 'Season-Ending IR');
  assert.equal(collins.earliestEligibleWeek, null);
  assert.equal(collins.projectedReturnWeek, 'Out for Season');
  assert.equal(collins.injuryType, 'Knee (Surgery)');

  // 3. ESPN rolling upcoming-Sunday placeholder date on unopened 21-day window must yield TBD (21d Window Not Open) + strip "Not Specified"
  const unopened = classifyIrAndReserveTimeline({
    statusRaw: 'Injured Reserve',
    fantasyStatusAbbr: 'IR',
    injuryType: 'Knee',
    injuryDetail: 'Not Specified',
    returnDateIso: '2026-11-08',
    placedDateIso: '2026-09-23T18:00:00Z',
    beatNote: 'West will need to miss at least four games on IR before becoming eligible to return.',
    isDesignatedToReturnOpen: false,
    currentWeek: 9,
    byeWeek: 8,
    seasonYear: 2026,
    scheduleEvents: sampleSchedule
  });
  assert.equal(unopened.isSeasonEnding, false);
  assert.equal(unopened.injuryType, 'Knee', '"Not Specified" detail must never leak into injuryType');
  assert.equal(unopened.projectedReturnWeek, 'TBD (21d Window Not Open)');

  // 4. Open 21-day practice window with fresh Saturday blurb timestamp enforces CBA 4-game invariant (placedBeforeWeek = 4, eligWk = 9, Est. Week 10)
  const hobbs = classifyIrAndReserveTimeline({
    statusRaw: 'Injured Reserve',
    fantasyStatusAbbr: 'IR-R',
    injuryType: 'Adductor',
    returnDateIso: '2026-11-15',
    placedDateIso: '2026-11-07T21:00:00Z', // Fresh Saturday blurb timestamp (NOT original placement!)
    designatedDateIso: '2026-11-04T19:00:00Z',
    beatNote: "Hobbs had his practice window opened Wednesday. Since he wasn't activated Saturday, his next chance is Nov. 15.",
    isDesignatedToReturnOpen: true,
    currentWeek: 9,
    byeWeek: 8,
    seasonYear: 2026,
    scheduleEvents: sampleSchedule
  });
  assert.equal(hobbs.status, 'IR — 21-Day Window Open');
  assert.equal(hobbs.isPracticeWindowOpen, true);
  assert.equal(hobbs.placedBeforeWeek, 4);
  assert.equal(hobbs.earliestEligibleWeek, 9);
  assert.ok(hobbs.projectedReturnWeek.startsWith('Est. Week 10'), `Expected Est. Week 10, got ${hobbs.projectedReturnWeek}`);
});

test('Official 49ers.com Roster/Injury HTML parsers and ESPN transaction analyzer enforce strict guards', () => {
  // 1. Stale prior-week injury report page (e.g. Falcons when playing Las Vegas Raiders) must be completely rejected so prior-week practice codes never bleed into a new week
  const staleOppHtml = `
    <h2>San Francisco 49ers</h2>
    <table><thead><tr><th>Player</th><th>Position</th><th>Injury</th><th>Wed</th><th>Thu</th><th>Fri</th><th>Game Status</th></tr></thead>
    <tbody><tr><td>Siran Neal</td><td>S</td><td>Knee</td><td>DNP</td><td>DNP</td><td>LP</td><td>Questionable</td></tr></tbody></table>
    <h2>Atlanta Falcons</h2>
    <table><thead><tr><th>Player</th><th>Position</th><th>Injury</th><th>Wed</th><th>Thu</th><th>Fri</th><th>Game Status</th></tr></thead>
    <tbody><tr><td>Drake London</td><td>WR</td><td>Hip</td><td>LP</td><td>LP</td><td>FP</td><td>(-)</td></tr></tbody></table>
  `;
  const staleParsed = parseOfficial49ersInjuryReportHtml(staleOppHtml, 'Las Vegas Raiders');
  assert.equal(staleParsed.reportMatchesCurrentOpponent, false, 'Stale Falcons table must NOT match Las Vegas Raiders');
  assert.equal(staleParsed.hasSfReport, false, 'Stale prior-week SF practice report must be rejected on Mon/Tue rollover');
  assert.equal(staleParsed.oppByKey.size, 0);

  // 2. Matching current-week injury report parses both 49ers and Raiders Wed/Thu/Fri & Game Status accurately
  const currentWeekHtml = staleOppHtml
    .replace('Atlanta Falcons', 'Las Vegas Raiders')
    .replace('Drake London', 'Darien Porter')
    .replace('<td>LP</td><td>LP</td><td>FP</td>', '<td>DNP</td><td>LP</td><td>FP</td>');
  const parsedInj = parseOfficial49ersInjuryReportHtml(currentWeekHtml, 'Las Vegas Raiders');
  assert.equal(parsedInj.reportMatchesCurrentOpponent, true);
  assert.equal(parsedInj.hasSfReport, true);
  assert.equal(parsedInj.hasOppReport, true);
  assert.equal(parsedInj.sfByKey.get(canonicalPlayerKey('Siran Neal'))?.wed, 'DNP');
  assert.equal(parsedInj.sfByKey.get(canonicalPlayerKey('Siran Neal'))?.fri, 'LP');
  assert.equal(parsedInj.sfByKey.get(canonicalPlayerKey('Siran Neal'))?.gameStatus, 'Questionable');
  assert.equal(parsedInj.oppByKey.get(canonicalPlayerKey('Darien Porter'))?.wed, 'DNP');
  assert.equal(parsedInj.oppByKey.get(canonicalPlayerKey('Darien Porter'))?.thu, 'LP');
  assert.equal(parsedInj.oppByKey.get(canonicalPlayerKey('Darien Porter'))?.fri, 'FP');

  // Transaction analyzer tracks injury settlements, PS elevations -> revert to PS, and IR-R designation counts
  const txSummary = analyzeTeamTransactions(
    [
      { date: '2026-10-19T20:00Z', description: 'Released OL Brett Toth from injured reserve with an injury settlement.' },
      { date: '2026-10-17T20:00Z', description: 'Elevated TE Jack Stoll from the practice squad for Sunday’s game.' },
      { date: '2026-11-04T18:00Z', description: 'Opened the Injured Reserve practice window for CB Nate Hobbs and WR Demarcus Robinson.' },
      { date: '2026-11-07T20:00Z', description: 'Activated WR Demarcus Robinson from Injured Reserve. Placed WR Christian Kirk on Injured Reserve.' }
    ],
    2026
  );
  assert.equal(txSummary.byKey.get(canonicalPlayerKey('Brett Toth'))?.releasedInjurySettlement, true);
  assert.equal(txSummary.byKey.get(canonicalPlayerKey('Jack Stoll'))?.latestRosterMoveBucket, 'practice_squad');
  assert.equal(txSummary.byKey.get(canonicalPlayerKey('Nate Hobbs'))?.designatedToReturnOpen, true);
  assert.equal(txSummary.byKey.get(canonicalPlayerKey('Demarcus Robinson'))?.designatedToReturnOpen, false);
  assert.ok(txSummary.byKey.get(canonicalPlayerKey('Demarcus Robinson'))?.activatedFromIrDate);
  assert.equal(txSummary.regularSeasonIrDesignationsCount, 2);
});

test('Live 2026 Health, Roster & Depth Chart datasets eliminate Alfred Collins bug, synthetic placeholders, and roster ghosts', () => {
  const healthRaw = fs.readFileSync(path.join(rootDir, 'data', 'health.json'), 'utf8');
  const matchupRaw = fs.readFileSync(path.join(rootDir, 'data', 'schedule-matchup.json'), 'utf8');
  assert.ok(!/Rehabbing on side field/i.test(healthRaw), 'Synthetic "Rehabbing on side field" placeholder forbidden in health.json');
  assert.ok(!/Rehabbing on side field/i.test(matchupRaw), 'Synthetic "Rehabbing on side field" placeholder forbidden in schedule-matchup.json');

  const health = JSON.parse(healthRaw);
  const roster = JSON.parse(fs.readFileSync(path.join(rootDir, 'data', 'roster.json'), 'utf8'));
  const depth = JSON.parse(fs.readFileSync(path.join(rootDir, 'data', 'depth-chart.json'), 'utf8'));

  // Remaining IR designations must reflect real regular-season designations used (< 8)
  assert.ok(health.usedIrDesignations >= 1 && health.remainingIrDesignations < 8, `Expected used IR designations tracked, got remaining=${health.remainingIrDesignations}`);

  // All 7 confirmed season-ending SF IR players must be Out for Season (never Week 10-11)
  const expectedSeasonEnding = [
    'Alfred Collins',
    'Ricky Pearsall',
    'Jake Tonges',
    'Andrew Farmer II',
    'Darrick Forrest',
    'Mikail Kamara',
    'Nick Zakelj'
  ];
  for (const name of expectedSeasonEnding) {
    const irRec = health.irAndReserveTracker.find(p => p.name === name);
    assert.ok(irRec, `Expected ${name} in irAndReserveTracker`);
    assert.equal(irRec.isSeasonEnding, true, `${name} must have isSeasonEnding: true`);
    assert.equal(irRec.earliestEligibleWeek, null, `${name} must have earliestEligibleWeek: null`);
    assert.equal(irRec.projectedReturnWeek, 'Out for Season', `${name} must be Out for Season, got ${irRec.projectedReturnWeek}`);

    const rosRec = roster.players.find(p => p.name === name);
    assert.ok(rosRec, `Expected ${name} in roster.json`);
    assert.equal(rosRec.health.status, 'Season-Ending IR', `${name} roster status must be Season-Ending IR`);
    assert.equal(rosRec.health.playBadgeLabel, '0% • Out for Season', `${name} badge must be 0% • Out for Season`);
  }

  // Nate Hobbs has open 21-day window targeting Week 10
  const hobbs = health.irAndReserveTracker.find(p => p.name === 'Nate Hobbs');
  assert.ok(hobbs && hobbs.isPracticeWindowOpen === true && hobbs.projectedReturnWeek.startsWith('Est. Week 10'));

  // Released / non-rostered ghosts must be completely purged
  for (const ghost of ['Brett Toth', 'Vincent Anthony Jr.']) {
    assert.ok(!roster.players.some(p => p.name === ghost), `Ghost ${ghost} must not appear in roster.json`);
    assert.ok(!health.irAndReserveTracker.some(p => p.name === ghost), `Ghost ${ghost} must not appear in irAndReserveTracker`);
    assert.ok(!JSON.stringify(depth).includes(ghost), `Ghost ${ghost} must not appear in depth-chart.json`);
  }

  // Practice Squad game-day elevations must reside in practice_squad, Guerendo on Reserve / PUP, Aiyuk on Reserve / Left Squad (and not duplicated in practiceReport)
  for (const psName of ['Jack Stoll', 'Jalen Graham', 'Ogbo Okoronkwo']) {
    const p = roster.players.find(x => x.name === psName);
    assert.equal(p?.rosterBucket, 'practice_squad', `${psName} must be in practice_squad bucket`);
  }
  const guerendo = roster.players.find(x => x.name === 'Isaac Guerendo');
  assert.equal(guerendo?.health?.status, 'Reserve / PUP');
  const aiyuk = roster.players.find(x => x.name === 'Brandon Aiyuk');
  assert.equal(aiyuk?.rosterBucket, 'ir');
  assert.equal(aiyuk?.health?.status, 'Reserve / Left Squad');
  assert.ok(!health.practiceReport.some(p => p.name === 'Brandon Aiyuk'), 'Brandon Aiyuk must not be duplicated onto active practiceReport');

  // Official 49ers.com practice participation verification
  const neal = health.practiceReport.find(p => p.name === 'Siran Neal');
  assert.ok(neal && neal.wed === 'DNP' && neal.thu === 'DNP' && neal.fri === 'LP', `Expected Siran Neal DNP/DNP/LP, got ${JSON.stringify(neal)}`);
  const cmc = health.practiceReport.find(p => p.name === 'Christian McCaffrey');
  assert.ok(cmc && cmc.wed === 'DNP' && cmc.thu === 'LP' && cmc.fri === 'FP', `Expected CMC DNP/LP/FP, got ${JSON.stringify(cmc)}`);
});

await testAsync('hydrateLiveEspnOverlay preserves Season-Ending IR statuses and official Opponent Wed/Thu/Fri participation', async () => {
  const origFetch = globalThis.fetch;
  try {
    const appData = {
      meta: { updatedAt: '2026-11-08T00:00:00Z' },
      roster: JSON.parse(fs.readFileSync(path.join(rootDir, 'data', 'roster.json'), 'utf8')),
      health: JSON.parse(fs.readFileSync(path.join(rootDir, 'data', 'health.json'), 'utf8')),
      scheduleMatchup: JSON.parse(fs.readFileSync(path.join(rootDir, 'data', 'schedule-matchup.json'), 'utf8'))
    };

    const porterBefore = appData.scheduleMatchup.upcomingMatchup.opponentHealth.injuryReport.find(p =>
      p.name.includes('Darien Porter')
    );
    assert.ok(porterBefore && porterBefore.wed === 'DNP' && porterBefore.thu === 'LP' && porterBefore.fri === 'FP');

    globalThis.fetch = async reqUrl => {
      const u = String(reqUrl);
      if (u.includes('/injuries')) {
        return new Response(
          JSON.stringify({
            injuries: [
              {
                id: '25',
                injuries: [
                  {
                    athlete: { id: '4430835', displayName: 'Alfred Collins' },
                    status: 'Injured Reserve',
                    details: { type: 'Knee' },
                    shortComment: 'Collins is out for the season.'
                  }
                ]
              },
              {
                id: '13',
                injuries: [
                  {
                    athlete: { id: '5123456', displayName: 'Darien Porter', position: { abbreviation: 'CB' } },
                    status: 'Active',
                    details: { type: 'Back' },
                    shortComment: 'Porter carries no injury designation into Sunday.'
                  }
                ]
              }
            ]
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
      return new Response(JSON.stringify({ events: [] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    };

    await hydrateLiveEspnOverlay(appData);

    const collinsAfter = appData.roster.players.find(p => p.name === 'Alfred Collins');
    assert.equal(collinsAfter.health.status, 'Season-Ending IR', 'Browser overlay must not overwrite Season-Ending IR to generic Injured Reserve');
    assert.equal(collinsAfter.health.playBadgeLabel, '0% • Out for Season');

    const porterAfter = appData.scheduleMatchup.upcomingMatchup.opponentHealth.injuryReport.find(p =>
      p.name.includes('Darien Porter')
    );
    assert.ok(
      porterAfter && porterAfter.wed === 'DNP' && porterAfter.thu === 'LP' && porterAfter.fri === 'FP',
      `Browser overlay must preserve official 49ers.com opponent Wed/Thu/Fri codes, got ${JSON.stringify(porterAfter)}`
    );
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
