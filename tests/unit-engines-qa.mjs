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
  partitionCompletedTradesByWindow,
  normalizeScheduleGameItem,
  resolveCompleteScheduleModel
} from '../src/engine/seasonStateMachine.js';
import {
  JARGON_GLOSSARY,
  getJargonEntry,
  jargonInfoIcon,
  annotateJargonPlainText
} from '../src/engine/jargonGlossary.js';
import {
  BIG_BOARD_QUICK_POS_PILLS,
  BIG_BOARD_OFFENSE_POSITIONS,
  BIG_BOARD_DEFENSE_POSITIONS,
  BIG_BOARD_INDIVIDUAL_POSITIONS,
  normalizeBigBoardProspect,
  queryBigBoardProspects,
  parseBigBoardUrlParams,
  buildBigBoardUrlSearch
} from '../src/engine/draftBigBoardEngine.js';
import {
  ROSTER_SORT_FIELDS,
  extractPlayerSortNameParts,
  comparePlayersByFirstName,
  comparePlayersByLastName,
  normalizeRosterSort,
  renderRosterCapViewHtml
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
  analyzeTeamTransactions,
  resolveAuthoritativeRosterPlayerStatus
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
  filterNewsByUserPrefs,
  computeNewsSalienceScore
} from '../src/engine/antiFluffFilter.js';
import {
  extractBeatAttributionFromText,
  corroborateAndAnnotateWireStream,
  buildXBeatListSearchUrl,
  buildXPlayerScoopSearchUrl,
  getReporterTrustTier,
  MAX_X_SEARCH_RAW_QUERY_LENGTH
} from '../src/engine/beatAttributionEngine.js';
import {
  buildClusteredNewsBriefs,
  buildFrontOfficeCapBlueprint,
  buildTradeDeadlineWarRoom,
  buildDraftPrep2027AndCombine,
  build2026DraftAndUdfaClass
} from '../scripts/lib/seasonalContentBuilder.mjs';
import { parseOverTheCapHtml } from '../scripts/lib/otcParser.mjs';
import {
  hydrateLiveEspnOverlay,
  reconcileLiveEspnSfRosterAndDepthChart,
  hydrateLiveBlueskyBeatWire,
  hydrateLiveEspnRapidBreakingDesk,
  hydrateLiveMultiSourceBeatWire
} from '../src/services/dataService.js';
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
  isUrgentBreakingBadge,
  classifyNewsItemCategory,
  classifyBreakingItem,
  computeWireStoryRank,
  sortNewsWithBreakingPriority,
  formatTweetBodyForDisplay,
  is49ersGameLiveWindow,
  resolveGameNewsContext,
  deduplicateAndGroupWireItems,
  balanceFeedTopSalience,
  stripRedundantAuthorBoilerplate,
  isRedundantProfileSelfLink,
  isPreGamePlayAvailabilityItem,
  isStaleCompletedGameAvailabilityItem,
  filterOutCompletedGameAvailabilityItems,
  isCompletedGameAvailabilityCluster,
  isActiveInGameAvailabilityCluster,
  filterAndCleanSynthesisClusters,
  isSalientCapOrContractItem,
  isStalePriorGameVideo,
  filterFreshVideosForCurrentSlate,
  isBreakingItemCoveredInBrief,
  partitionBreakingNewsAboveBrief
} from '../src/engine/breakingClassifier.js';
import {
  evaluateGameDayWindow,
  isBeforeWeeklyPracticeWindow,
  classifyRosterUnit,
  extractWireGameDaySignals,
  buildTeamGameDayRosterModel,
  resolveGameDayInjuryRows,
  resolveEarlyWeekRolloverInput,
  rolloverPracticeReportForUpcomingWeek
} from '../src/engine/gameDayRosterEngine.js';
import {
  NEWS_NAV_CLUSTERS,
  VALID_NEWS_CATEGORIES,
  renderNewsViewHtml,
  renderDailyTopNewsBriefHtml
} from '../src/views/newsView.js';
import { renderHomeDashboardHtml } from '../src/views/homeView.js';
import {
  DAILY_NEWS_BRIEF_PEAK_HOUR_PT,
  getDailyNewsBriefCycleKey,
  selectTopNewsBriefSourceCandidates,
  buildDailyTopNewsBriefPrompt,
  parseAndSanitizeDailyTopNewsBrief,
  buildDeterministicDailyTopNewsBrief
} from '../src/services/aiWorkerClient.js';
import { renderSettingsSheetHtml } from '../src/views/settingsArchiveView.js';
import {
  buildNativePodcastAppHref,
  AI_STUDIO_DIRECT_KEY_URL,
  AI_STUDIO_RATE_LIMIT_URL,
  renderGeminiApiKeyStepByStepGuideHtml,
  renderAudioAiViewHtml
} from '../src/views/audioAiView.js';
import { SEASON_NAV_CLUSTERS, renderSeasonMatchupViewHtml } from '../src/views/seasonMatchupView.js';
import {
  humanizeNflTextForTts,
  computeConversationalTurnDynamics,
  selectBestBrowserVoices,
  trimAndFadeTurnPcm,
  conditionTurnVoicePcm,
  masterPodcastEpisodePcm
} from '../src/engine/podcastSpeechEngine.js';

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

test('Roster sort fields default to Roster Number (jersey asc) and support First Name & Last Name sorting with suffix handling', () => {
  assert.equal(ROSTER_SORT_FIELDS[0].key, 'jersey');
  assert.equal(ROSTER_SORT_FIELDS[1].key, 'firstName');
  assert.equal(ROSTER_SORT_FIELDS[2].key, 'lastName');
  assert.deepEqual(normalizeRosterSort(), { field: 'jersey', dir: 'asc' });
  assert.deepEqual(normalizeRosterSort('jersey', 'desc'), { field: 'jersey', dir: 'desc' });
  assert.deepEqual(normalizeRosterSort('firstName', 'asc'), { field: 'firstName', dir: 'asc' });
  assert.deepEqual(normalizeRosterSort('lastName', 'desc'), { field: 'lastName', dir: 'desc' });
  assert.deepEqual(normalizeRosterSort('name'), { field: 'firstName', dir: 'asc' });
  assert.deepEqual(normalizeRosterSort('first_name_desc'), { field: 'firstName', dir: 'desc' });
  assert.deepEqual(normalizeRosterSort('last_name_desc'), { field: 'lastName', dir: 'desc' });
  assert.deepEqual(normalizeRosterSort('cap_desc'), { field: 'cap', dir: 'desc' });

  // Verify generational suffixes (Jr., Sr., II, III) are stripped when extracting lastName
  assert.deepEqual(extractPlayerSortNameParts('Deebo Samuel Sr.'), {
    firstName: 'Deebo',
    lastName: 'Samuel',
    fullName: 'Deebo Samuel Sr.'
  });
  assert.deepEqual(extractPlayerSortNameParts('Andrew Farmer II'), {
    firstName: 'Andrew',
    lastName: 'Farmer',
    fullName: 'Andrew Farmer II'
  });
  assert.deepEqual(extractPlayerSortNameParts('Robert Beal Jr.'), {
    firstName: 'Robert',
    lastName: 'Beal',
    fullName: 'Robert Beal Jr.'
  });

  // Verify First Name vs Last Name comparators
  const sample = [
    { name: 'Trent Williams', jersey: 71 },
    { name: 'Brock Purdy', jersey: 13 },
    { name: 'Brandon Aiyuk', jersey: 11 },
    { name: 'Robert Beal Jr.', jersey: 51 }
  ];
  const byFirst = [...sample].sort(comparePlayersByFirstName).map(p => p.name);
  assert.deepEqual(byFirst, ['Brandon Aiyuk', 'Brock Purdy', 'Robert Beal Jr.', 'Trent Williams']);

  const byLast = [...sample].sort(comparePlayersByLastName).map(p => p.name);
  assert.deepEqual(byLast, ['Brandon Aiyuk', 'Robert Beal Jr.', 'Brock Purdy', 'Trent Williams']);
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
  assert.equal(
    oppHealth.teamName,
    sm.upcomingMatchup.oppName,
    `Expected opponent health for ${sm.upcomingMatchup.oppName}, got ${oppHealth.teamName}`
  );
  assert.ok(Array.isArray(oppHealth.activeRoster) && oppHealth.activeRoster.length >= 40, 'Expected opponent activeRoster >= 40');
  assert.ok(Array.isArray(oppHealth.injuryReport) && oppHealth.injuryReport.length >= 1, 'Expected opponent injuryReport entries');
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

import edgeWorker, {
  EDITORIAL_SYSTEM_PROMPT,
  DEFAULT_AUDIO_TTS_CASCADE
} from '../worker/index.js';
import {
  PODCAST_PIPELINE_STAGES,
  ANALYSIS_PIPELINE_STAGES,
  estimateGenerationWait,
  resolveActiveHighQualityModelLabel,
  checkAndAutoUpdateBestGeminiModel
} from '../src/services/aiWorkerClient.js';
import {
  normalizeDisplayTopic,
  compileDeepResearchDossier,
  buildNotebookLmPodcastScript,
  buildDeepScoutingAnalysisMarkdown
} from '../src/engine/deepResearchEngine.js';
import {
  CANONICAL_SITE_ORIGIN,
  buildShareablePodcastUrl,
  buildShareableAnalysisUrl,
  extractIncomingSharedRoute,
  shareItemNatively
} from '../src/services/shareService.js';
import { buildSilentPlaybackCarrierWavDataUri } from '../src/components/audioPlayer.js';

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

test('Deep 7-day player mentions populate core 49ers with tweets + articles, prune stale completed-game Mike Evans won’t-play notes, and preserve 100% author attribution + full short tweets', () => {
  const ros = JSON.parse(fs.readFileSync(path.join(rootDir, 'data', 'roster.json'), 'utf8'));
  const news = JSON.parse(fs.readFileSync(path.join(rootDir, 'data', 'news.json'), 'utf8'));

  const mikeEvans = ros.players.find(p => p.name === 'Mike Evans');
  const brockPurdy = ros.players.find(p => p.name === 'Brock Purdy');
  const deeboSamuel = ros.players.find(p => p.name === 'Deebo Samuel Sr.');
  const nickBosa = ros.players.find(p => p.name === 'Nick Bosa');
  assert.ok(mikeEvans, 'Mike Evans present on 2026 49ers roster');
  assert.ok(
    !mikeEvans.recentNews.some(n => /\b(won['’]?t play|inactives?\b|before raiders game)\b/i.test(`${n.headline || ''} ${n.fullText || ''}`)),
    'Completed-game Mike Evans won’t-play / inactives notes must be pruned after Week 9 finishes'
  );
  assert.ok(brockPurdy.recentNews.length >= 5 && brockPurdy.recentNews.some(n => n.type === 'tweet') && brockPurdy.recentNews.some(n => n.type === 'article'));
  assert.ok(deeboSamuel.recentNews.length >= 5 && deeboSamuel.recentNews.some(n => n.type === 'tweet'));
  assert.ok(nickBosa.recentNews.length >= 1 && nickBosa.recentNews.some(n => n.type === 'tweet'));
  // Zero generic NFL false-positive articles (e.g. Mahomes) in any player's recentNews
  for (const p of ros.players) {
    for (const m of p.recentNews || []) {
      assert.ok(
        !/patrick and brittany mahomes/i.test(`${m.headline || ''} ${m.summary || ''}`),
        `False-positive generic NFL story leaked into ${p.name} recentNews`
      );
    }
  }

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
    assert.equal(
      post.url,
      'https://bsky.app/profile/mattbarrows.bsky.social/post/paywallguard123',
      `Expected Bluesky post permalink to be preserved directly rather than overwritten with a dead from:mattbarrows X search, got: ${post.url}`
    );
    assert.equal(post.authorProfileUrl, 'https://x.com/mattbarrows');
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
  assert.ok(
    capData.years['2027'].teamCapSpace < 0 &&
      capData.years['2027'].teamCapSpace ===
        capData.years['2027'].capCeiling - capData.years['2027'].totalCapLiabilities,
    '2027 OTC Team Cap Space must parse negative and equal capCeiling - totalCapLiabilities penny-for-penny'
  );
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
  assert.ok(oh.summary.totalStarters >= 22);
  assert.ok(oh.keyStartersHealthy.some(s => s.unit === 'Offense'), 'Offensive healthy starters included');
  assert.ok(oh.keyStartersHealthy.some(s => s.unit === 'Defense'), 'Defensive healthy starters included');
  assert.ok(oh.injuryReport.length >= 1);
  const earlyWeek = isBeforeWeeklyPracticeWindow(sched.upcomingMatchup?.kickoffIso || '');
  for (const p of oh.injuryReport) {
    assert.ok(typeof p.archetypeNote === 'string' && p.archetypeNote.length > 5);
    assert.ok(Array.isArray(p.factors) && p.factors.length >= 1);
    if (earlyWeek) {
      assert.equal(p.wed, '-', `Early-week opponent row ${p.name} must have blank wed ('-')`);
      assert.equal(p.thu, '-', `Early-week opponent row ${p.name} must have blank thu ('-')`);
      assert.equal(p.fri, '-', `Early-week opponent row ${p.name} must have blank fri ('-')`);
    }
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
  assert.ok(
    dp.pickInventory.length >= 4 && dp.pickInventory.length <= 7,
    `SF 2027 Tankathon pick inventory must reflect live draft capital (got ${dp.pickInventory.length})`
  );
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
    assert.deepEqual(capturedBody.generationConfig?.thinkingConfig, { thinkingLevel: 'HIGH' }, 'Expected Gemini 3+ HIGH thinkingLevel');
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

  // Footer/nav chrome mentioning next week's opponent must NEVER trick parser into accepting a prior-week table!
  const staleWithFooterChrome = `${staleOppHtml}\n${'<div>Schedule Chrome Filler</div>\n'.repeat(40)}<footer>Next Up: Las Vegas Raiders &amp; Dallas Cowboys</footer>`;
  const footerRejected = parseOfficial49ersInjuryReportHtml(staleWithFooterChrome, 'Dallas Cowboys');
  assert.equal(footerRejected.reportMatchesCurrentOpponent, false, 'Footer mention of Cowboys must not validate Falcons table');
  assert.equal(footerRejected.hasSfReport, false);

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
  assert.ok(hobbs && hobbs.isPracticeWindowOpen === true && /Week 10/i.test(hobbs.projectedReturnWeek));

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
  assert.match(String(aiyuk?.health?.status || ''), /^Reserve \/ (?:Left Squad|Roster Exemption)$/);
  assert.ok(!health.practiceReport.some(p => p.name === 'Brandon Aiyuk'), 'Brandon Aiyuk must not be duplicated onto active practiceReport');

  // Official 49ers.com practice participation & early-week blank W/T/F rollover verification
  const matchupJson = JSON.parse(matchupRaw);
  assert.equal(health.week, matchupJson.upcomingMatchup.week, 'health.json week must match upcomingMatchup.week');
  const sfEarlyWeek = isBeforeWeeklyPracticeWindow(matchupJson.upcomingMatchup.kickoffIso || '');
  if (sfEarlyWeek) {
    for (const row of health.practiceReport) {
      assert.equal(row.wed, '-', `Early-week SF row ${row.name} must have blank wed ('-')`);
      assert.equal(row.thu, '-', `Early-week SF row ${row.name} must have blank thu ('-')`);
      assert.equal(row.fri, '-', `Early-week SF row ${row.name} must have blank fri ('-')`);
      assert.ok(!/coach'?s decision|nir\s*-?\s*rest/i.test(row.injuryType || ''), `Non-injury scratch forbidden on upcoming week report: ${row.name}`);
    }
  } else {
    assert.ok(health.practiceReport.some(p => p.wed !== '-' || p.thu !== '-' || p.fri !== '-'));
  }
});

await testAsync('hydrateLiveEspnOverlay preserves Season-Ending IR statuses, official in-week Opponent Wed/Thu/Fri codes, and blanks W/T/F on post-game rollover', async () => {
  const origFetch = globalThis.fetch;
  try {
    const appData = {
      meta: { updatedAt: '2026-11-08T00:00:00Z' },
      roster: JSON.parse(fs.readFileSync(path.join(rootDir, 'data', 'roster.json'), 'utf8')),
      health: JSON.parse(fs.readFileSync(path.join(rootDir, 'data', 'health.json'), 'utf8')),
      scheduleMatchup: JSON.parse(fs.readFileSync(path.join(rootDir, 'data', 'schedule-matchup.json'), 'utf8'))
    };

    // Case A: Friday in-week practice window (~48h before kickoff) — preserve official Opponent Wed/Thu/Fri codes!
    const friKickoffIso = new Date(Date.now() + 48 * 3600_000).toISOString();
    appData.scheduleMatchup.upcomingMatchup.kickoffIso = friKickoffIso;
    appData.scheduleMatchup.upcomingMatchup.oppAbbr = 'LV';
    appData.scheduleMatchup.upcomingMatchup.oppName = 'Las Vegas Raiders';
    const nextUnplayed = appData.scheduleMatchup.schedule.find(g => !g.completed);
    if (nextUnplayed) {
      nextUnplayed.dateIso = friKickoffIso;
      nextUnplayed.opponent = { ...nextUnplayed.opponent, abbr: 'LV', name: 'Las Vegas Raiders' };
    }
    appData.scheduleMatchup.upcomingMatchup.opponentHealth.teamAbbr = 'LV';
    appData.scheduleMatchup.upcomingMatchup.opponentHealth.teamName = 'Las Vegas Raiders';
    appData.scheduleMatchup.upcomingMatchup.opponentHealth.injuryReport = [
      {
        name: 'Darien Porter',
        position: 'CB',
        unit: 'Defense',
        jersey: 25,
        wed: 'DNP',
        thu: 'LP',
        fri: 'FP',
        injuryType: 'Back',
        gameStatus: 'Questionable',
        playProbabilityPct: 86,
        playBadgeLabel: '86% • Likely'
      }
    ];

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
                displayName: 'Las Vegas Raiders',
                injuries: [
                  {
                    athlete: {
                      id: '5123456',
                      displayName: 'Darien Porter',
                      position: { abbreviation: 'CB' },
                      team: { abbreviation: 'LV' }
                    },
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
      `Browser overlay must preserve official 49ers.com opponent Wed/Thu/Fri codes during practice window, got ${JSON.stringify(porterAfter)}`
    );

    // Case B: Monday early-week rollover (~144h before next Sunday kickoff) — blank W/T/F to '-'!
    const nextSunIso = new Date(Date.now() + 144 * 3600_000).toISOString();
    appData.scheduleMatchup.upcomingMatchup.kickoffIso = nextSunIso;
    if (nextUnplayed) nextUnplayed.dateIso = nextSunIso;
    await hydrateLiveEspnOverlay(appData);
    const porterRolled = appData.scheduleMatchup.upcomingMatchup.opponentHealth.injuryReport.find(p =>
      p.name.includes('Darien Porter')
    );
    if (porterRolled) {
      assert.equal(porterRolled.wed, '-');
      assert.equal(porterRolled.thu, '-');
      assert.equal(porterRolled.fri, '-');
    }
  } finally {
    globalThis.fetch = origFetch;
  }
});

console.log('\n=== [9/9] Bottom Nav Swap, Two-Cluster Season Nav, Trade Banner Placement & Compact Team Stats QA ===');

test('index.html places Game & Season before Roster & Cap in the 5-tab bottom navigation bar', () => {
  const indexHtml = fs.readFileSync(path.join(rootDir, 'index.html'), 'utf8');
  const navTabMatches = [...indexHtml.matchAll(/class="nav-tab-btn[^"]*"\s+data-nav-tab="([^"]+)"/g)].map(m => m[1]);
  assert.deepEqual(navTabMatches, ['home', 'news', 'season', 'roster', 'audio']);
});

test('SEASON_NAV_CLUSTERS groups Matchup/Health/Schedule/Stats in Bar 1 and Trade/Playoffs/Draft/Draft Recap in Bar 2', () => {
  assert.equal(SEASON_NAV_CLUSTERS.length, 2);
  assert.deepEqual(
    SEASON_NAV_CLUSTERS[0].tabs.map(t => ({ key: t.key, label: t.label })),
    [
      { key: 'matchup', label: 'Matchup' },
      { key: 'health', label: 'Health' },
      { key: 'schedule', label: 'Schedule' },
      { key: 'stats', label: 'Stats' }
    ]
  );
  assert.deepEqual(
    SEASON_NAV_CLUSTERS[1].tabs.map(t => ({ key: t.key, label: t.label })),
    [
      { key: 'trade', label: 'Trade' },
      { key: 'playoffs', label: 'Playoffs' },
      { key: 'draft_prep', label: 'Draft' },
      { key: 'draft_class', label: 'Draft Recap' }
    ]
  );
});

test('Team Stats view omits Category (Advanced/Standard Offense) column while preserving all 11 NFL rankings', () => {
  const scheduleMatchup = JSON.parse(fs.readFileSync(path.join(rootDir, 'data', 'schedule-matchup.json'), 'utf8'));
  const statsHtml = renderSeasonMatchupViewHtml({
    seasonSub: 'stats',
    activePhases: ['YEAR_ROUND', 'IN_SEASON', 'TRADE_WINDOW'],
    appData: {
      meta: { seasonYear: 2026 },
      scheduleMatchup
    },
    activeVideosSet: new Set()
  });
  assert.ok(!statsHtml.includes('<th>Category</th>'), 'Team Stats table must not render Category header');
  assert.ok(!statsHtml.includes('Advanced Offense'), 'Team Stats table must hide Advanced Offense category text');
  assert.ok(!statsHtml.includes('Standard Offense'), 'Team Stats table must hide Standard Offense category text');
  assert.ok(!statsHtml.includes(' (Archive)'), 'Season sub-tabs must not append noisy (Archive) suffixes');
  for (const r of scheduleMatchup.teamStatRankings) {
    assert.ok(statsHtml.includes(r.displayValue), `Missing stat displayValue ${r.displayValue}`);
  }
});

console.log('\n=== [10/10] Natural Podcast Speech, Conversational Prosody & Broadcast DSP Mastering QA ===');

test('humanizeNflTextForTts converts NFL records, spreads, fractions, compact dollars, schemes & names into natural spoken English', () => {
  const raw =
    'The 6-1 Niners opened at SF -8.5 and steamed to SF -9.5 with a 51.5 total vs. the 4-4 Las Vegas Raiders (implied SF 30.5 – LV 21.0). With 9/18ths base proration, -$31.54M in 2027, and ~$0.79M for Adonai Mitchell, Raheem Morris lines up Osa Odighizuwa at 2i in Wide-9 against 21-personnel while Kyle Juszczyk and Brandon Aiyuk use Post-June-1 rules.';
  const spoken = humanizeNflTextForTts(raw);

  assert.ok(spoken.includes('six and one Niners'), `Expected spoken record "six and one Niners", got: ${spoken}`);
  assert.ok(spoken.includes('four and four Las Vegas Raiders'), `Expected "four and four Las Vegas Raiders", got: ${spoken}`);
  assert.ok(spoken.includes('San Francisco minus nine and a half'), `Expected spoken spread, got: ${spoken}`);
  assert.ok(spoken.includes('fifty-one and a half total'), `Expected spoken half-point total, got: ${spoken}`);
  assert.ok(
    spoken.includes('San Francisco thirty and a half to Las Vegas twenty-one'),
    `Expected spoken implied score without ".0", got: ${spoken}`
  );
  assert.ok(spoken.includes('nine eighteenths'), `Expected spoken fraction "nine eighteenths", got: ${spoken}`);
  assert.ok(spoken.includes('minus 31.54 million dollars'), `Expected spoken negative millions, got: ${spoken}`);
  assert.ok(spoken.includes('roughly 790 thousand dollars'), `Expected sub-million thousands phrasing, got: ${spoken}`);
  assert.ok(spoken.includes('Wide nine') && spoken.includes('twenty-one personnel'), `Expected spoken scheme phrasing, got: ${spoken}`);
  assert.ok(spoken.includes('Post June first'), `Expected spoken Post June first, got: ${spoken}`);
  assert.ok(
    spoken.includes('Oh-diggy-zoo-wah') && spoken.includes('Yooz-check') && spoken.includes('Eye-yook'),
    `Expected phonetic NFL pronunciations, got: ${spoken}`
  );
});

test('computeConversationalTurnDynamics tightens co-host latches and varies prosody naturally across turn lengths', () => {
  const sampleTurns = [
    { speaker: 'Marcus', text: 'Walk through that protection bind—what happens if Vegas slides the center?' },
    { speaker: 'Elena', text: 'Right, Buckner gets singled up on a guard immediately.' },
    {
      speaker: 'Marcus',
      text: 'And when you combine that interior push with Nick Bosa and Keion White on the Wide-9 edges plus Fred Warner disguising Cover-3 Buzz rotations behind the line, quarterbacks lose their hot outlet.'
    }
  ];
  const d0 = computeConversationalTurnDynamics(sampleTurns, 0);
  const d1 = computeConversationalTurnDynamics(sampleTurns, 1);
  const d2 = computeConversationalTurnDynamics(sampleTurns, 2);

  assert.equal(d0.gapAfterMs, 125, 'Quick agreement latch ("Right, ...") should use tight ~125ms gap');
  assert.equal(d1.rate, '+2%', 'Short reactive interjection should get livelier +2% rate');
  assert.equal(d2.gapAfterMs, 0, 'Final turn should have 0ms trailing inter-turn gap');
});

test('selectBestBrowserVoices prioritizes Neural/Premium/Enhanced voices and rejects robotic formant voices like Fred', () => {
  const mockVoices = [
    { name: 'Albert', lang: 'en-US', localService: true },
    { name: 'Fred', lang: 'en-US', localService: true },
    { name: 'Daniel', lang: 'en-GB', localService: true },
    { name: 'Samantha', lang: 'en-US', localService: true },
    { name: 'Evan (Enhanced)', lang: 'en-US', localService: true },
    { name: 'Ava (Premium)', lang: 'en-US', localService: true }
  ];
  const { maleVoice, femaleVoice } = selectBestBrowserVoices(mockVoices);
  assert.equal(maleVoice?.name, 'Evan (Enhanced)');
  assert.equal(femaleVoice?.name, 'Ava (Premium)');

  const onlyRoboticPlusSamantha = [
    { name: 'Fred', lang: 'en-US', localService: true },
    { name: 'Zarvox', lang: 'en-US', localService: true },
    { name: 'Samantha', lang: 'en-US', localService: true }
  ];
  const fallback = selectBestBrowserVoices(onlyRoboticPlusSamantha);
  assert.notEqual(fallback.maleVoice?.name, 'Fred');
  assert.notEqual(fallback.maleVoice?.name, 'Zarvox');
});

test('Broadcast DSP pipeline trims dead TTS silence, equalizes host loudness, and limits peaks cleanly below 0 dBFS', () => {
  const sr = 24000;
  // Simulate a turn with 200ms leading zeros, 400ms active voice wave, and 350ms trailing zeros
  const leadZeros = Math.round(sr * 0.2);
  const voiceLen = Math.round(sr * 0.4);
  const trailZeros = Math.round(sr * 0.35);
  const quietRaw = new Int16Array(leadZeros + voiceLen + trailZeros);
  const loudRaw = new Int16Array(leadZeros + voiceLen + trailZeros);
  for (let i = 0; i < voiceLen; i++) {
    const wave = Math.sin((2 * Math.PI * 210 * i) / sr);
    quietRaw[leadZeros + i] = Math.round(wave * 3200);
    loudRaw[leadZeros + i] = Math.round(wave * 9600);
  }

  const trimQ = trimAndFadeTurnPcm(quietRaw, sr);
  const trimL = trimAndFadeTurnPcm(loudRaw, sr);
  assert.ok(trimQ.length < quietRaw.length - Math.round(sr * 0.4), 'Should trim excess leading/trailing silence');

  const condQ = conditionTurnVoicePcm(trimQ, sr, 0.115);
  const condL = conditionTurnVoicePcm(trimL, sr, 0.115);
  const rms = arr => Math.sqrt(arr.reduce((s, v) => s + v * v, 0) / arr.length);
  assert.ok(
    Math.abs(rms(condQ) - rms(condL)) < 0.015,
    `Host loudness leveling should match quiet & loud turns closely: ${rms(condQ)} vs ${rms(condL)}`
  );

  const timeline = new Float64Array(condQ.length + Math.round(sr * 0.15) + condL.length);
  timeline.set(condQ, 0);
  timeline.set(condL, condQ.length + Math.round(sr * 0.15));
  // Add a hot plosive transient spike (1.35 > 0 dBFS) to verify true-peak soft limiting
  timeline[Math.floor(condQ.length / 2)] = 1.35;
  const mastered = masterPodcastEpisodePcm(timeline, sr);
  let maxAbs = 0;
  for (let i = 0; i < mastered.length; i++) {
    const a = Math.abs(mastered[i]);
    if (a > maxAbs) maxAbs = a;
  }
  assert.ok(maxAbs > 5500 && maxAbs <= 30000, `Mastered peak (${maxAbs}) should sit in clean broadcast headroom without clipping`);
});

test('Studio podcast episodes feature >=9 natural conversational turns, tight human handoffs (<=0.32s), and 96kbps AAC mastering', () => {
  const podIdx = JSON.parse(fs.readFileSync(path.join(rootDir, 'data', 'podcasts', 'index.json'), 'utf8'));
  assert.equal(podIdx.episodes.length, 3);
  for (const ep of podIdx.episodes) {
    assert.ok(ep.transcript.length >= 9, `Expected >=9 natural back-and-forth turns in ${ep.id}, got ${ep.transcript.length}`);
    for (let i = 0; i < ep.transcript.length - 1; i++) {
      const gap = Number((ep.transcript[i + 1].startSec - ep.transcript[i].endSec).toFixed(2));
      assert.ok(
        gap >= 0.1 && gap <= 0.32,
        `Expected natural conversational inter-turn gap (0.10s..0.32s) in ${ep.id} turn ${i}->${i + 1}, got ${gap}s`
      );
    }
  }
});

test('Accuracy-over-latency system prompts, 3.8+ High model ranking, Studio Pro TTS cascade & rough wait estimator', () => {
  const sysPrompt = buildLiveGroundingSystemPrompt({});
  assert.ok(
    sysPrompt.includes('UNHURRIED HIGH-THINKING MANDATE — PRIORITIZE ACCURACY & ANALYTICAL QUALITY OVER GENERATION TIME'),
    'Client grounding system prompt must explicitly prioritize accuracy & quality over generation time'
  );
  assert.ok(
    sysPrompt.includes('INTERNAL MULTI-PASS SELF-AUDIT'),
    'Client grounding system prompt must mandate internal multi-pass self-audit'
  );
  assert.ok(
    EDITORIAL_SYSTEM_PROMPT.includes('UNHURRIED HIGH-THINKING MANDATE — PRIORITIZE ACCURACY & ANALYTICAL QUALITY OVER GENERATION TIME'),
    'Worker EDITORIAL_SYSTEM_PROMPT must explicitly prioritize accuracy & quality over generation time'
  );

  // Highest-quality model ranking: 3.8+ Pro outranks 3.8 Flash when available in catalog, while 3.8 Flash outranks legacy 2.5 Pro
  assert.equal(DEFAULT_FREE_MODEL_CASCADE[0], 'gemini-3.8-flash');
  assert.ok(scoreFreeTierGeminiModel('gemini-3.8-pro') > scoreFreeTierGeminiModel('gemini-3.8-flash'));
  assert.ok(scoreFreeTierGeminiModel('gemini-3.8-flash') > scoreFreeTierGeminiModel('gemini-2.5-pro'));
  assert.deepEqual(DEFAULT_AUDIO_TTS_CASCADE, ['gemini-2.5-pro-preview-tts', 'gemini-2.5-flash-preview-tts']);

  // Clutter-free model label & rough estimated generation time scaling
  const labelInfo = resolveActiveHighQualityModelLabel({
    meta: { aiEngine: { activeModel: 'gemini-3.8-flash', thinkingLevel: 'HIGH' } }
  });
  assert.equal(labelInfo.modelId, 'gemini-3.8-flash');
  assert.equal(labelInfo.displayLabel, 'Accuracy-First');
  assert.ok(!/gemini/i.test(labelInfo.displayLabel), 'UI displayLabel must omit internal Gemini model branding');

  const cloud3 = estimateGenerationWait({
    kind: 'podcast',
    durationMinutes: 3,
    prefs: { workerBaseUrl: 'https://49ers-worker.example.workers.dev' }
  });
  const cloud8 = estimateGenerationWait({
    kind: 'podcast',
    durationMinutes: 8,
    prefs: { workerBaseUrl: 'https://49ers-worker.example.workers.dev' }
  });
  const cloud15 = estimateGenerationWait({
    kind: 'podcast',
    durationMinutes: 15,
    prefs: { workerBaseUrl: 'https://49ers-worker.example.workers.dev' }
  });
  assert.equal(cloud3.isCloud, true);
  assert.ok(cloud15.minSec > cloud8.minSec && cloud8.minSec > cloud3.minSec, 'Longer podcasts must estimate longer High-Thinking wait');
  assert.equal(cloud3.summaryText, '3 min pod • Est. 45–90 sec');
  assert.equal(cloud8.summaryText, '8 min pod • Est. 1–3 min');
  assert.equal(cloud15.summaryText, '15 min pod • Est. 2–4 min');

  const localEst = estimateGenerationWait({ kind: 'podcast', durationMinutes: 3, prefs: {} });
  assert.equal(localEst.isCloud, false);
  assert.equal(localEst.summaryText, '3 min pod • Est. 45–90 sec');
  const analysisEst = estimateGenerationWait({ kind: 'analysis', prefs: {} });
  assert.equal(analysisEst.summaryText, 'Est. 25–60 sec');
  assert.equal(PODCAST_PIPELINE_STAGES.length, 3);
  assert.equal(ANALYSIS_PIPELINE_STAGES.length, 3);
});

await testAsync('Worker /api/analyze & /api/podcast run 2-pass High-Thinking verification (verifyPass=true) and cascade Pro TTS -> Flash TTS', async () => {
  const origFetch = globalThis.fetch;
  const calledUrls = [];

  globalThis.fetch = async urlStr => {
    const u = String(urlStr);
    calledUrls.push(u);

    if (u.includes('gemini-2.5-pro-preview-tts')) {
      return new Response(JSON.stringify({ error: 'Pro TTS free quota busy' }), { status: 429 });
    }
    if (u.includes('gemini-2.5-flash-preview-tts')) {
      const dummyPcm = Buffer.alloc(480, 0).toString('base64');
      return new Response(
        JSON.stringify({
          candidates: [{ content: { parts: [{ inlineData: { data: dummyPcm } }] } }]
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }
    // Text generation calls (Pass 1 + Pass 2)
    if (calledUrls.length <= 2) {
      return new Response(
        JSON.stringify({
          candidates: [
            {
              content: {
                parts: [
                  { thought: true, text: 'Internal High-Thinking verification...' },
                  {
                    text: '### Verified 3.8 High Report\n* Brock Purdy sits at +52.1 passing EPA while SF preserves $35.16M in 2026 Top-51 space for 2027 Article 13 rollover.'
                  }
                ]
              }
            }
          ]
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }
    return new Response(
      JSON.stringify({
        candidates: [
          {
            content: {
              parts: [
                {
                  text: JSON.stringify([
                    { speaker: 'Marcus', text: "Let's break down how DeForest Buckner and Nick Bosa collapse interior slide protections." },
                    { speaker: 'Elena', text: "And remember, rolling our 35.16 million in 2026 space into 2027 under Article 13 keeps the ledger clean." }
                  ])
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
    const env = createMockWorkerEnv({ GEMINI_API_KEY: 'mock-hq-key' });

    const analyzeRes = await edgeWorker.fetch(
      new Request('https://worker.example/api/analyze', {
        method: 'POST',
        headers: { 'X-Group-Passcode': 'faithful49', 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: 'Purdy 2026 EPA & 2027 Article 13 rollover',
          verifyPass: true,
          author: 'Josh'
        })
      }),
      env
    );
    assert.equal(analyzeRes.status, 200);
    const analyzeJson = await analyzeRes.json();
    assert.equal(analyzeJson.item.modelUsed, 'gemini-3.8-flash');
    assert.equal(analyzeJson.item.thinkingLevel, 'HIGH');
    assert.equal(analyzeJson.item.qualityPriority, 'accuracy_over_latency');
    assert.equal(analyzeJson.item.verifiedPasses, 2);

    const podRes = await edgeWorker.fetch(
      new Request('https://worker.example/api/podcast', {
        method: 'POST',
        headers: { 'X-Group-Passcode': 'faithful49', 'Content-Type': 'application/json' },
        body: JSON.stringify({
          topic: 'Buckner + Bosa Wide-9 stunt geometry',
          durationMinutes: 5,
          format: 'two_host',
          verifyPass: true,
          author: 'Josh'
        })
      }),
      env
    );
    assert.equal(podRes.status, 200);
    const podJson = await podRes.json();
    assert.equal(podJson.episode.modelUsed, 'gemini-3.8-flash');
    assert.equal(podJson.episode.verifiedPasses, 2);
    assert.equal(podJson.episode.qualityPriority, 'accuracy_over_latency');
    assert.equal(podJson.episode.audioModelUsed, 'gemini-2.5-flash-preview-tts');
    assert.ok(calledUrls.some(u => u.includes('gemini-2.5-pro-preview-tts')), 'Must try Studio Pro TTS first');
    assert.ok(podJson.episode.audioUrl?.startsWith('https://worker.example/api/audio/live_'));

    // Verify R2 WAV stream has 2-channel Stereo (L+R) RIFF header for iPhone speaker compatibility
    const wavStreamRes = await edgeWorker.fetch(new Request(podJson.episode.audioUrl), env);
    assert.equal(wavStreamRes.status, 200);
    const wavBuf = Buffer.from(await wavStreamRes.arrayBuffer());
    assert.equal(wavBuf.toString('ascii', 0, 4), 'RIFF');
    assert.equal(wavBuf.readUInt16LE(22), 2, 'Worker R2 WAV must be 2-channel Stereo');
  } finally {
    globalThis.fetch = origFetch;
  }
});

test('iPhone speaker playback carrier WAV builds valid 2-channel Stereo PCM with non-zero dither', () => {
  const uri = buildSilentPlaybackCarrierWavDataUri(8000, 1);
  assert.ok(uri.startsWith('data:audio/wav;base64,'));
  const raw = Buffer.from(uri.replace('data:audio/wav;base64,', ''), 'base64');
  assert.equal(raw.toString('ascii', 0, 4), 'RIFF');
  assert.equal(raw.toString('ascii', 8, 12), 'WAVE');
  assert.equal(raw.readUInt16LE(20), 1, 'PCM format');
  assert.equal(raw.readUInt16LE(22), 2, '2-channel Stereo carrier');
  assert.equal(raw.readUInt32LE(24), 8000, '8000 Hz sample rate');
  // Verify non-zero LSB dither (±2) so iOS CoreAudio never gates the Playback audio session
  assert.equal(raw.readInt16LE(44), 2);
  assert.equal(raw.readInt16LE(46), 2);
  assert.equal(raw.readInt16LE(48), -2);
});

test('Deep Research Engine audits all 14 rostered WRs on "wide recievers" and calibrates 3m/8m NotebookLM podcast word counts', () => {
  assert.equal(normalizeDisplayTopic('wide recievers'), 'wide receivers');

  const fullAppData = {
    meta: JSON.parse(fs.readFileSync(path.join(rootDir, 'data', 'meta.json'), 'utf8')),
    roster: JSON.parse(fs.readFileSync(path.join(rootDir, 'data', 'roster.json'), 'utf8')),
    cap: JSON.parse(fs.readFileSync(path.join(rootDir, 'data', 'cap.json'), 'utf8')),
    news: JSON.parse(fs.readFileSync(path.join(rootDir, 'data', 'news.json'), 'utf8')),
    scheduleMatchup: JSON.parse(fs.readFileSync(path.join(rootDir, 'data', 'schedule-matchup.json'), 'utf8')),
    seasonal: JSON.parse(fs.readFileSync(path.join(rootDir, 'data', 'seasonal.json'), 'utf8'))
  };

  const wrDossier = compileDeepResearchDossier({ query: 'wide recievers', appData: fullAppData });
  assert.equal(wrDossier.primaryGroup?.id, 'WR');
  const totalWrs =
    wrDossier.activeHealthy.length +
    wrDossier.activeSidelined.length +
    wrDossier.irReserve.length +
    wrDossier.practiceSquad.length;
  assert.ok(totalWrs >= 12, `Expected >=12 rostered 49ers WRs in deep dossier, got ${totalWrs}`);

  const script3m = buildNotebookLmPodcastScript({
    query: 'wide recievers',
    durationMinutes: 3,
    format: 'two_host',
    appData: fullAppData,
    dossier: wrDossier
  });
  const words3m = script3m.reduce((s, t) => s + t.text.split(/\s+/).filter(Boolean).length, 0);
  assert.ok(words3m >= 380 && words3m <= 510, `Expected ~438 words for 3m pod, got ${words3m}`);
  assert.ok(script3m.length >= 10, `Expected >=10 conversational turns for 3m pod, got ${script3m.length}`);

  // Verify natural alternation between Marcus and Elena in two_host mode
  for (let i = 1; i < script3m.length; i++) {
    assert.notEqual(
      script3m[i].speaker,
      script3m[i - 1].speaker,
      `Consecutive duplicate speaker at turn ${i}`
    );
  }

  const script8m = buildNotebookLmPodcastScript({
    query: 'wide recievers',
    durationMinutes: 8,
    format: 'two_host',
    appData: fullAppData,
    dossier: wrDossier
  });
  const words8m = script8m.reduce((s, t) => s + t.text.split(/\s+/).filter(Boolean).length, 0);
  assert.ok(words8m >= 1020 && words8m <= 1320, `Expected ~1168 words for 8m pod, got ${words8m}`);

  const reportMd = buildDeepScoutingAnalysisMarkdown({
    query: 'wide recievers',
    appData: fullAppData,
    dossier: wrDossier
  });
  assert.ok(reportMd.includes('Jordan Watkins') && reportMd.includes('Ricky Pearsall'));
  assert.ok(reportMd.includes('Article 13'));
});

await testAsync('Share Service compresses custom podcasts/analyses into 49ers.joshal.com deep links and uses native navigator.share with clipboard fallback', async () => {
  const customEp = {
    id: 'custom_ep_wr_test',
    title: 'Wide Receivers',
    topic: 'wide receivers',
    format: 'Two-Host Analytical Banter',
    presetLabel: '3m On-Demand Pod',
    modelUsed: 'gemini-3.8-flash',
    createdBy: 'Josh',
    createdAt: '2026-11-08T01:00:00.000Z',
    durationSec: 184,
    audioUrl: 'blob:https://49ers.joshal.com/local-uuid',
    sourceLinks: [{ label: 'OverTheCap 49ers', url: 'https://overthecap.com/salary-cap/san-francisco-49ers' }],
    transcript: [
      { idx: 0, speaker: 'Marcus', startSec: 0, endSec: 12, text: 'Welcome in to 49ers Faithful.' },
      { idx: 1, speaker: 'Elena', startSec: 12, endSec: 26, text: 'Let us break down the wide receiver room.' }
    ]
  };

  const podShareUrl = await buildShareablePodcastUrl(customEp, {
    origin: 'https://49ers.joshal.com',
    hostname: '49ers.joshal.com',
    pathname: '/'
  });
  assert.ok(podShareUrl.startsWith(`${CANONICAL_SITE_ORIGIN}/?pod=custom_ep_wr_test#shared-pod=z.`));

  const parsedUrl = new URL(podShareUrl);
  const hydratedRoute = await extractIncomingSharedRoute(parsedUrl);
  assert.equal(hydratedRoute?.type, 'podcast');
  assert.equal(hydratedRoute?.episode?.id, 'custom_ep_wr_test');
  assert.equal(hydratedRoute?.episode?.title, 'Wide Receivers');
  assert.equal(hydratedRoute?.episode?.durationSec, 184);
  assert.equal(hydratedRoute?.episode?.audioUrl, null, 'Local blob: URL must not leak into shared payload');
  assert.equal(hydratedRoute?.episode?.transcript?.length, 2);

  // Built-in static `.m4a` episode uses short canonical query link
  const builtInUrl = await buildShareablePodcastUrl(
    { id: 'ep-week9-raiders-film', audioUrl: './data/podcasts/ep-week9-raiders-film.m4a' },
    null
  );
  assert.equal(builtInUrl, 'https://49ers.joshal.com/?pod=ep-week9-raiders-film');

  // Native Web Share API vs Clipboard fallback
  let sharedPayload = null;
  const nativeRes = await shareItemNatively({
    title: '49ers Faithful Podcast',
    text: 'Listen now:',
    url: podShareUrl,
    navigatorObj: {
      share: async data => {
        sharedPayload = data;
      }
    }
  });
  assert.equal(nativeRes.method, 'native');
  assert.equal(sharedPayload?.url, podShareUrl);

  let copiedText = '';
  const clipRes = await shareItemNatively({
    title: '49ers Faithful Podcast',
    text: 'Listen now:',
    url: podShareUrl,
    navigatorObj: {
      clipboard: {
        writeText: async t => {
          copiedText = t;
        }
      }
    }
  });
  assert.equal(clipRes.method, 'clipboard');
  assert.equal(copiedText, podShareUrl);

  // Analysis deep-link round-trip
  const reportUrl = await buildShareableAnalysisUrl(
    {
      id: 'local_analysis_wr',
      title: 'WR Cap & Film',
      category: 'Wide Receivers Deep Dive',
      createdBy: 'Josh',
      markdown: '### WR Report\n* Jordan Watkins 45% snaps'
    },
    null
  );
  const hydratedAnalysis = await extractIncomingSharedRoute(new URL(reportUrl));
  assert.equal(hydratedAnalysis?.type, 'analysis');
  assert.ok(hydratedAnalysis?.analysis?.markdown.includes('Jordan Watkins'));
});

await testAsync('Gemini Studio Prompts & Thinking Config enforce Pro-first ranking, v1beta thinkingLevel/thinkingBudget exclusivity, and anti-robotic NotebookLM TTS preparation', async () => {
  const {
    scoreBestGeminiReasoningModel,
    rankBestGeminiReasoningModels,
    buildGeminiThinkingConfig,
    prepareConversationalTextForModernNeuralTts,
    chunkTurnsForGeminiTts,
    DEEP_RESEARCH_STAGE1_SYSTEM_PROMPT,
    DEEP_ANALYSIS_STAGE2_SYSTEM_PROMPT,
    NOTEBOOKLM_PODCAST_STAGE2_SYSTEM_PROMPT,
    NOTEBOOKLM_VOICE_PROFILES
  } = await import('../src/engine/geminiStudioPrompts.js');

  // Free-Tier High-Thinking Flash models (`gemini-3.8-flash` -> `Gemini 3.8 High`, 20 RPD) strictly outrank 0/0-quota 3.1/2.5 Pro
  assert.ok(scoreBestGeminiReasoningModel('gemini-3.8-flash') > scoreBestGeminiReasoningModel('gemini-3.6-flash'));
  assert.ok(scoreBestGeminiReasoningModel('gemini-3.6-flash') > scoreBestGeminiReasoningModel('gemini-3-flash-preview'));
  assert.ok(scoreBestGeminiReasoningModel('gemini-3.8-flash') > scoreBestGeminiReasoningModel('gemini-3.1-pro-preview'));
  assert.ok(scoreBestGeminiReasoningModel('gemini-3.8-flash') > scoreBestGeminiReasoningModel('gemini-2.5-pro'));

  // Retired gemini-3-pro-preview & dated 2.5 preview checkpoints must be strictly excluded (-1) so they never trigger HTTP 404
  assert.equal(scoreBestGeminiReasoningModel('gemini-3-pro-preview'), -1, 'Retired gemini-3-pro-preview must be excluded');
  assert.equal(scoreBestGeminiReasoningModel('models/gemini-3-pro-preview'), -1, 'Retired models/gemini-3-pro-preview must be excluded');
  assert.equal(scoreBestGeminiReasoningModel('gemini-3.1-pro-preview-customtools'), -1, 'Customtools variant must be excluded');
  assert.equal(scoreBestGeminiReasoningModel('gemini-2.5-pro-preview-05-06'), -1, 'Retired dated 2.5 preview checkpoint must be excluded');
  assert.equal(scoreFreeTierGeminiModel('gemini-3-pro-preview'), -1, 'Worker free-tier scorer must also exclude retired gemini-3-pro-preview');

  const ranked = rankBestGeminiReasoningModels([
    { name: 'models/gemini-3-pro-preview', supportedGenerationMethods: ['generateContent'] },
    { name: 'models/gemini-3.8-flash', supportedGenerationMethods: ['generateContent'] },
    { name: 'models/gemini-3.6-flash', supportedGenerationMethods: ['generateContent'] },
    { name: 'models/gemini-3.1-pro-preview', supportedGenerationMethods: ['generateContent'] },
    { name: 'models/gemini-2.5-pro', supportedGenerationMethods: ['generateContent'] }
  ]);
  assert.equal(ranked[0], 'gemini-3.8-flash');
  assert.equal(ranked[1], 'gemini-3.6-flash');
  assert.equal(ranked.includes('gemini-3-pro-preview'), false, 'Ranked cascade must never include retired gemini-3-pro-preview');

  // Gemini 3.0+ uses thinkingLevel: 'HIGH' (never thinkingBudget); Gemini 2.5 uses thinkingBudget
  const cfg38 = buildGeminiThinkingConfig('gemini-3.8-pro');
  assert.deepEqual(cfg38, { thinkingLevel: 'HIGH' });
  assert.equal('thinkingBudget' in cfg38, false);

  const cfg31 = buildGeminiThinkingConfig('gemini-3.1-pro-preview');
  assert.deepEqual(cfg31, { thinkingLevel: 'HIGH' });

  const cfg25Pro = buildGeminiThinkingConfig('gemini-2.5-pro');
  assert.deepEqual(cfg25Pro, { thinkingBudget: 32768 });
  assert.equal('thinkingLevel' in cfg25Pro, false);

  const cfg25Flash = buildGeminiThinkingConfig('gemini-2.5-flash');
  assert.deepEqual(cfg25Flash, { thinkingBudget: 24576 });

  // Modern neural TTS prep cleans visual shorthand WITHOUT inserting robotic syllable hyphens
  const spoken = prepareConversationalTextForModernNeuralTts(
    "Ricky Pearsall and Kyle Juszczyk help SF -9.5 navigate -$31.54M in 2027 cap with 9/18ths proration."
  );
  assert.ok(spoken.includes('Ricky Pearsall') && spoken.includes('Kyle Juszczyk'), 'Names must stay natural without spelling-bee hyphens');
  assert.ok(!spoken.includes('Pears-ull') && !spoken.includes('Joose-check'));
  assert.ok(spoken.includes('San Francisco minus 9.5'));
  assert.ok(spoken.includes('minus 31.54 million dollars'));
  assert.ok(spoken.includes('nine eighteenths'));

  // Multi-turn chunking for Gemini Native Multi-Speaker TTS
  const longTurns = Array.from({ length: 16 }, (_, idx) => ({
    speaker: idx % 2 === 0 ? 'Marcus' : 'Elena',
    text: `Turn ${idx + 1}: ${'Detailed conversational 49ers film and cap breakdown with contractions. '.repeat(5)}`
  }));
  const chunks = chunkTurnsForGeminiTts(longTurns, 1200);
  assert.ok(chunks.length >= 3, `Expected multi-chunk split for long script, got ${chunks.length}`);
  assert.equal(chunks.reduce((sum, c) => sum + c.length, 0), 16);

  // Triple-check system prompts & voice profiles
  assert.ok(
    DEEP_RESEARCH_STAGE1_SYSTEM_PROMPT.includes(
      'THINK DEEPLY & INVESTIGATE THOROUGHLY (ACCURACY & DEPTH OVER SPEED)'
    )
  );
  assert.ok(DEEP_ANALYSIS_STAGE2_SYSTEM_PROMPT.includes('ANTI-SLOP'));
  assert.ok(NOTEBOOKLM_PODCAST_STAGE2_SYSTEM_PROMPT.includes('Google Gemini NotebookLM'));
  assert.equal(NOTEBOOKLM_VOICE_PROFILES.twoHost.Marcus, 'Puck');
  assert.equal(NOTEBOOKLM_VOICE_PROFILES.twoHost.Elena, 'Aoede');
  assert.equal(NOTEBOOKLM_VOICE_PROFILES.solo.Marcus, 'Charon');
});

await testAsync('Direct Browser 3-Stage Gemini Pipeline enforces GEMINI_KEY_REQUIRED gate, cascades on 400, and synthesizes NotebookLM Puck & Aoede audio', async () => {
  const {
    hasLiveAiConnection,
    verifyGeminiApiKey,
    runOnDemandDeepAnalysis,
    generateOnDemandAutopodcast
  } = await import('../src/services/aiWorkerClient.js');

  assert.equal(hasLiveAiConnection({}), false);
  assert.equal(hasLiveAiConnection({ geminiApiKey: 'AIzaTestKey123' }), true);
  assert.equal(hasLiveAiConnection({ workerBaseUrl: 'https://worker.example' }), true);

  // Unconnected calls must immediately throw GEMINI_KEY_REQUIRED (never a silent 1-second template!)
  await assert.rejects(
    () => runOnDemandDeepAnalysis({ prompt: 'wide receivers', prefs: {} }),
    err => err?.code === 'GEMINI_KEY_REQUIRED'
  );
  await assert.rejects(
    () => generateOnDemandAutopodcast({ topic: 'wide receivers', durationMinutes: 3, format: 'two_host', prefs: {} }),
    err => err?.code === 'GEMINI_KEY_REQUIRED'
  );

  // Test direct browser v1beta 3-stage execution + worker 3-stage deepResearchPass + solo Charon voiceConfig
  const origFetch = globalThis.fetch;
  const capturedPayloads = [];
  globalThis.fetch = async (urlStr, init) => {
    const u = String(urlStr);
    const bodyObj = init?.body ? JSON.parse(init.body) : null;
    capturedPayloads.push({ url: u, body: bodyObj });

    if (u.includes('/models?key=')) {
      return new Response(
        JSON.stringify({
          models: [
            { name: 'models/gemini-3.8-pro', supportedGenerationMethods: ['generateContent'] },
            { name: 'models/gemini-3.1-pro-preview', supportedGenerationMethods: ['generateContent'] },
            { name: 'models/gemini-2.5-pro-preview-tts', supportedGenerationMethods: ['generateContent'] }
          ]
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }
    if (u.includes('public.api.bsky.app') || u.includes('site.api.espn.com')) {
      return new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    // Simulate preview 400 on gemini-3.8-pro so cascade falls over cleanly to gemini-3.1-pro-preview!
    if (u.includes('models/gemini-3.8-pro:generateContent')) {
      return new Response(JSON.stringify({ error: { message: 'Model preview gated' } }), { status: 400 });
    }
    if (u.includes('preview-tts:generateContent')) {
      const pcm = Buffer.alloc(24000 * 4, 12); // 2 seconds of 16-bit 24kHz mono PCM
      return new Response(
        JSON.stringify({
          candidates: [{ content: { parts: [{ inlineData: { data: pcm.toString('base64') } }] } }]
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }
    const promptTxt = bodyObj?.contents?.[0]?.parts?.[0]?.text || '';
    if (promptTxt.includes('JSON array') || promptTxt.includes('DRAFT JSON DIALOGUE')) {
      return new Response(
        JSON.stringify({
          candidates: [
            {
              content: {
                parts: [
                  {
                    text: JSON.stringify([
                      { speaker: 'Marcus', text: "Look at how Jordan Watkins and Ricky Pearsall stretch quarters coverage when Purdy hits the back of his drop." },
                      { speaker: 'Elena', text: "Right, and keeping 35.16 million in 2026 cap space to roll over under Article 13 is what makes that rookie deal so valuable." },
                      { speaker: 'Marcus', text: "Exactly—you're getting vertical separation without touching your 2027 restructure levers." },
                      { speaker: 'Elena', text: "That's the whole blueprint heading into Sunday against Las Vegas." }
                    ])
                  }
                ]
              }
            }
          ]
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }
    return new Response(
      JSON.stringify({
        candidates: [
          {
            content: {
              parts: [
                {
                  text: '### Executive Thesis\nJordan Watkins and Ricky Pearsall give Brock Purdy high-efficiency intermediate spacing while preserving $35.16M in 2026 Article 13 rollover.'
                }
              ]
            },
            groundingMetadata: {
              groundingChunks: [{ web: { title: 'OverTheCap 49ers', uri: 'https://overthecap.com/salary-cap/san-francisco-49ers' } }]
            }
          }
        ]
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  };

  try {
    const verified = await verifyGeminiApiKey('AIzaMockUnitKey', 'https://mock-gemini.local/v1beta');
    assert.equal(verified.bestModel, 'gemini-3.8-pro');

    const fullAppData = {
      meta: JSON.parse(fs.readFileSync(path.join(rootDir, 'data', 'meta.json'), 'utf8')),
      roster: JSON.parse(fs.readFileSync(path.join(rootDir, 'data', 'roster.json'), 'utf8')),
      cap: JSON.parse(fs.readFileSync(path.join(rootDir, 'data', 'cap.json'), 'utf8')),
      news: JSON.parse(fs.readFileSync(path.join(rootDir, 'data', 'news.json'), 'utf8')),
      scheduleMatchup: JSON.parse(fs.readFileSync(path.join(rootDir, 'data', 'schedule-matchup.json'), 'utf8')),
      seasonal: JSON.parse(fs.readFileSync(path.join(rootDir, 'data', 'seasonal.json'), 'utf8'))
    };

    const directReport = await runOnDemandDeepAnalysis({
      prompt: 'wide receivers',
      appData: fullAppData,
      prefs: {
        geminiApiKey: 'AIzaMockUnitKey',
        geminiApiBaseUrl: 'https://mock-gemini.local/v1beta',
        authorName: 'Josh'
      }
    });
    assert.equal(directReport.modelUsed, 'gemini-3.1-pro-preview', 'Must cascade cleanly from 400 on 3.8-pro to 3.1-pro-preview');
    assert.equal(directReport.verifiedPasses, 3);
    assert.ok(directReport.markdown.includes('Jordan Watkins'));

    // Verify Gemini 3+ payload sent thinkingLevel: 'HIGH' and NEVER thinkingBudget
    const g3Call = capturedPayloads.find(c => c.url.includes('gemini-3.1-pro-preview:generateContent'));
    assert.deepEqual(g3Call?.body?.generationConfig?.thinkingConfig, { thinkingLevel: 'HIGH' });

    // Also test Worker 3-stage deepResearchPass=true + solo format voiceConfig ('Charon')
    const env = createMockWorkerEnv({ GEMINI_API_KEY: 'mock-worker-3pass-key' });
    const soloPodRes = await edgeWorker.fetch(
      new Request('https://worker.example/api/podcast', {
        method: 'POST',
        headers: { 'X-Group-Passcode': 'faithful49', 'Content-Type': 'application/json' },
        body: JSON.stringify({
          topic: 'wide receivers',
          durationMinutes: 3,
          format: 'solo',
          deepResearchPass: true,
          verifyPass: true,
          author: 'Josh'
        })
      }),
      env
    );
    assert.equal(soloPodRes.status, 200);
    const soloPodJson = await soloPodRes.json();
    assert.equal(soloPodJson.episode.verifiedPasses, 3);
    const ttsCalls = capturedPayloads.filter(c => c.url.includes('preview-tts:generateContent'));
    const lastTtsSpeechCfg = ttsCalls[ttsCalls.length - 1]?.body?.generationConfig?.speechConfig;
    assert.equal(
      lastTtsSpeechCfg?.voiceConfig?.prebuiltVoiceConfig?.voiceName,
      'Charon',
      'Solo podcast TTS must use single-speaker voiceConfig (Charon) instead of multiSpeakerVoiceConfig'
    );
  } finally {
    globalThis.fetch = origFetch;
  }
});

await testAsync('Dynamic Gemini Auto-Update selects Gemini 3.8 High (gemini-3.8-flash), migrates 0-quota Pro prefs, and gracefully handles HTTP 429 quota exhaustion', async () => {
  const {
    checkAndAutoUpdateBestGeminiModel,
    resolveActiveHighQualityModelLabel,
    runOnDemandDeepAnalysis,
    generateOnDemandAutopodcast
  } = await import('../src/services/aiWorkerClient.js');

  const origFetch = globalThis.fetch;
  try {
    const userPrefs = {
      geminiApiKey: 'AIzaMockAutoUpdateKey',
      verifiedGeminiModel: 'gemini-3.1-pro-preview'
    };

    let updatedModelReported = null;

    globalThis.fetch = async urlStr => {
      const u = String(urlStr);
      if (u.includes('/v1beta/models')) {
        return new Response(
          JSON.stringify({
            models: [
              { name: 'models/gemini-2.5-pro', supportedGenerationMethods: ['generateContent'] },
              { name: 'models/gemini-3.1-pro-preview', supportedGenerationMethods: ['generateContent'] },
              { name: 'models/gemini-3.6-flash', supportedGenerationMethods: ['generateContent'] },
              { name: 'models/gemini-3.8-flash', supportedGenerationMethods: ['generateContent'] },
              { name: 'models/gemini-3.8-flash-preview-tts', supportedGenerationMethods: ['generateContent'] }
            ]
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
      return new Response('{}', { status: 200 });
    };

    const res = await checkAndAutoUpdateBestGeminiModel(userPrefs, newModel => {
      updatedModelReported = newModel;
    });

    assert.ok(res?.ok, 'checkAndAutoUpdateBestGeminiModel should return ok: true');
    assert.equal(res.bestModel, 'gemini-3.8-flash', 'Should select Gemini 3.8 High (gemini-3.8-flash, 20 RPD Free Tier) over 0/0-quota 3.1 Pro');
    assert.equal(userPrefs.verifiedGeminiModel, 'gemini-3.8-flash', 'Should auto-update userPrefs in place');
    assert.equal(updatedModelReported, 'gemini-3.8-flash', 'Should trigger onModelUpdated callback');

    // Verify resolved label migrates modelId internally while keeping UI shortModelName clutter-free
    const label = resolveActiveHighQualityModelLabel(null, userPrefs);
    assert.equal(label.shortModelName, 'Deep Research');
    assert.equal(label.modelId, 'gemini-3.8-flash');

    // Verify stale retired gemini-3-pro-preview or 0-quota gemini-3.1-pro-preview in localStorage prefs is migrated to gemini-3.8-flash
    const migratedLabel = resolveActiveHighQualityModelLabel(null, {
      verifiedGeminiModel: 'gemini-3-pro-preview'
    });
    assert.equal(migratedLabel.modelId, 'gemini-3.8-flash');
    assert.equal(migratedLabel.shortModelName, 'Deep Research');

    // Run a second time with no new models: should NOT trigger callback
    let reTriggered = false;
    await checkAndAutoUpdateBestGeminiModel(userPrefs, () => {
      reTriggered = true;
    });
    assert.equal(reTriggered, false, 'Should not re-trigger callback if already up to date');

    // Simulate HTTP 429 quota exhaustion across all Gemini models -> verify graceful local dossier + audio synthesis fallback
    globalThis.fetch = async urlStr => {
      const u = String(urlStr);
      if (u.includes('/models?key=')) {
        return new Response(
          JSON.stringify({
            models: [{ name: 'models/gemini-3.8-flash', supportedGenerationMethods: ['generateContent'] }]
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
      if (u.includes(':generateContent')) {
        return new Response(
          JSON.stringify({
            error: {
              code: 429,
              message: 'You exceeded your current quota, please check your plan and billing details.',
              status: 'RESOURCE_EXHAUSTED'
            }
          }),
          { status: 429, headers: { 'Content-Type': 'application/json' } }
        );
      }
      return new Response('{}', { status: 200 });
    };

    const fullAppData = {
      meta: JSON.parse(fs.readFileSync(path.join(rootDir, 'data', 'meta.json'), 'utf8')),
      roster: JSON.parse(fs.readFileSync(path.join(rootDir, 'data', 'roster.json'), 'utf8')),
      cap: JSON.parse(fs.readFileSync(path.join(rootDir, 'data', 'cap.json'), 'utf8')),
      news: JSON.parse(fs.readFileSync(path.join(rootDir, 'data', 'news.json'), 'utf8')),
      scheduleMatchup: JSON.parse(fs.readFileSync(path.join(rootDir, 'data', 'schedule-matchup.json'), 'utf8')),
      seasonal: JSON.parse(fs.readFileSync(path.join(rootDir, 'data', 'seasonal.json'), 'utf8'))
    };

    const fallbackPod = await generateOnDemandAutopodcast({
      topic: 'wide receivers',
      durationMinutes: 3,
      format: 'two_host',
      appData: fullAppData,
      prefs: {
        geminiApiKey: 'AIzaQuotaExhaustedKey',
        geminiApiBaseUrl: 'https://mock-quota.local/v1beta',
        authorName: 'Josh'
      }
    });
    assert.ok(fallbackPod?.audioUrl, '429 fallback podcast must still produce a playable audioUrl');
    assert.ok(Array.isArray(fallbackPod?.transcript) && fallbackPod.transcript.length >= 4, '429 fallback podcast must include full Marcus & Elena transcript');

    const fallbackAnalysis = await runOnDemandDeepAnalysis({
      prompt: 'wide receivers',
      appData: fullAppData,
      prefs: {
        geminiApiKey: 'AIzaQuotaExhaustedKey',
        geminiApiBaseUrl: 'https://mock-quota.local/v1beta',
        authorName: 'Josh'
      }
    });
    assert.ok(fallbackAnalysis?.markdown?.includes('Executive Situational Thesis'), '429 fallback analysis must include verified 6-section scouting report');
  } finally {
    globalThis.fetch = origFetch;
  }
});

test('New-user 1-time Gemini API key step-by-step guide renders above setup box on Auto Pod & AI Analysis with direct AI Studio deep links', () => {
  assert.equal(AI_STUDIO_DIRECT_KEY_URL, 'https://aistudio.google.com/app/apikey');
  assert.equal(AI_STUDIO_RATE_LIMIT_URL, 'https://aistudio.google.com/rate-limit');
  assert.equal(sanitizeExternalUrl(AI_STUDIO_DIRECT_KEY_URL, null), AI_STUDIO_DIRECT_KEY_URL);
  assert.equal(sanitizeExternalUrl(AI_STUDIO_RATE_LIMIT_URL, null), AI_STUDIO_RATE_LIMIT_URL);

  const guideWithFocus = renderGeminiApiKeyStepByStepGuideHtml({ includeFocusButton: true });
  assert.ok(guideWithFocus.includes(AI_STUDIO_DIRECT_KEY_URL), 'Guide must deep-link straight to aistudio.google.com/app/apikey');
  assert.ok(guideWithFocus.includes(AI_STUDIO_RATE_LIMIT_URL), 'Guide must link to aistudio.google.com/rate-limit');
  assert.ok(guideWithFocus.includes('both Auto Pod &amp; AI Analysis'), 'Guide must confirm 1-time key unlocks both Auto Pod & AI Analysis');
  assert.ok(guideWithFocus.includes('data-action="focus-inline-gemini-key"'), 'Inline guide must include jump-to-paste-box button');

  const guideSettings = renderGeminiApiKeyStepByStepGuideHtml({ includeFocusButton: false });
  assert.ok(!guideSettings.includes('data-action="focus-inline-gemini-key"'), 'Settings variant omits inline jump button');

  for (const subSection of ['auto_podcast', 'deep_analysis']) {
    const collapsedHtml = renderAudioAiViewHtml({
      subSection,
      userPrefs: { geminiApiKey: '' },
      showGeminiKeyGuide: false
    });
    const bannerIdx = collapsedHtml.indexOf('data-gemini-guide-banner');
    const setupIdx = collapsedHtml.indexOf('data-gemini-setup-card="unconnected"');
    assert.ok(bannerIdx > -1 && setupIdx > -1 && bannerIdx < setupIdx, `Guide banner must render above unconnected setup box on ${subSection}`);
    assert.ok(!collapsedHtml.includes('data-gemini-guide-steps'), 'Collapsed guide hides expanded step list by default');

    const expandedHtml = renderAudioAiViewHtml({
      subSection,
      userPrefs: { geminiApiKey: '' },
      showGeminiKeyGuide: true
    });
    assert.ok(expandedHtml.includes('data-gemini-guide-steps'), `Expanded guide renders 4-step walkthrough on ${subSection}`);

    const connectedHtml = renderAudioAiViewHtml({
      subSection,
      userPrefs: { geminiApiKey: 'AIzaConnectedTestKey123456' },
      showGeminiKeyGuide: true
    });
    assert.ok(!connectedHtml.includes('data-gemini-guide-banner'), `Connected users must not see new-user guide banner on ${subSection}`);
    assert.ok(!connectedHtml.includes('data-gemini-setup-card'), `Connected users see zero setup/model clutter banner on ${subSection}`);
    assert.ok(!connectedHtml.includes('Live AI Connected') && !connectedHtml.includes('NotebookLM Voices'), 'Excess model/voice plumbing text stripped');
  }
});

console.log('\n=== [8/8] Algorithmic Precision, Statistical Calibration & Salience Audit QA ===');

test('Injury model handles beat-note negations, NFL 5-Step Concussion Protocol & late-week FP->LP downgrades', () => {
  const negatedExpected = computePlayerPlayProbability({
    name: 'Ricky Pearsall',
    gameStatus: 'Questionable',
    injuryType: 'Hamstring',
    wed: 'DNP',
    thu: 'LP',
    fri: 'LP',
    beatNote: 'Ricky Pearsall is not expected to play Sunday despite logging limited reps.'
  });
  assert.ok(
    negatedExpected.probabilityPct <= 20,
    `Negated "not expected to play" must cap <=20%, got ${negatedExpected.probabilityPct}%`
  );

  const negatedMiss = computePlayerPlayProbability({
    name: 'Nick Bosa',
    injuryType: 'Hip',
    wed: 'LP',
    thu: 'FP',
    fri: 'FP',
    beatNote: 'Neither Nick Bosa nor Fred Warner will miss Sunday against Las Vegas.'
  });
  assert.ok(
    negatedMiss.probabilityPct >= 85,
    `"Neither ... will miss" must not trigger 0% Out, got ${negatedMiss.probabilityPct}%`
  );

  // NFL 5-Step Concussion Protocol: ironman toughness prior cannot override Step-5 INC clearance
  const warnerConcussionLp = computePlayerPlayProbability({
    name: 'Fred Warner',
    gameStatus: 'Questionable',
    injuryType: 'Concussion',
    wed: 'DNP',
    thu: 'LP',
    fri: 'LP'
  });
  assert.ok(
    warnerConcussionLp.probabilityPct <= 45,
    `Concussion Friday LP without INC clearance must stay <=45%, got ${warnerConcussionLp.probabilityPct}%`
  );

  const warnerConcussionCleared = computePlayerPlayProbability({
    name: 'Fred Warner',
    gameStatus: 'Questionable',
    injuryType: 'Concussion',
    wed: 'DNP',
    thu: 'LP',
    fri: 'FP',
    beatNote: 'Fred Warner cleared the NFL concussion protocol on Friday.'
  });
  assert.ok(warnerConcussionCleared.probabilityPct >= 90);

  // Practice trajectory directionality: FP -> FP -> LP downgrade vs DNP -> LP -> LP upward ramp
  const fridayDowngrade = computePlayerPlayProbability({
    name: 'Jauan Jennings',
    gameStatus: 'Questionable',
    injuryType: 'Groin',
    wed: 'FP',
    thu: 'FP',
    fri: 'LP'
  });
  const upwardRamp = computePlayerPlayProbability({
    name: 'Jauan Jennings',
    gameStatus: 'Questionable',
    injuryType: 'Groin',
    wed: 'DNP',
    thu: 'LP',
    fri: 'LP'
  });
  assert.ok(
    fridayDowngrade.probabilityPct + 12 <= upwardRamp.probabilityPct,
    `Friday downgrade (${fridayDowngrade.probabilityPct}%) must be >=12% lower than upward ramp (${upwardRamp.probabilityPct}%)`
  );
});

await testAsync('Playoff Monte Carlo enforces truncated-normal upset margins, exact combined-record SOV, Pythagorean blend & Rooting Guide salience', async () => {
  const { sampleConditionalVictoryMargin } = await import('../src/engine/playoffMonteCarlo.js');

  // Heavy favorite (+12) winning should average a much larger margin than a 12-pt underdog (-12) pulling an upset
  const favWinMid = sampleConditionalVictoryMargin(12, 0.5);
  const dogUpsetMid = sampleConditionalVictoryMargin(-12, 0.5);
  assert.ok(favWinMid >= 13, `Expected favorite win margin >=13, got ${favWinMid}`);
  assert.ok(dogUpsetMid >= 1 && dogUpsetMid <= 7, `Expected tight underdog upset margin 1..7, got ${dogUpsetMid}`);
  assert.ok(favWinMid > dogUpsetMid + 7);

  // Morey 2.37 Pythagorean power rating blend works cleanly when pointsFor/pointsAgainst are provided
  const pythElo = computeCalibratedTeamPowerRating({
    wins: 6,
    losses: 1,
    pointDiff: 58,
    pointsFor: 205,
    pointsAgainst: 147,
    netEpaPerGame: 6.4
  });
  assert.ok(pythElo > 1540 && pythElo < 1640, `Unexpected Pythagorean Elo: ${pythElo}`);

  // Rooting Guide Leverage includes homeWinProbPct, expectedImpactScore, leverageTag & leverageReason
  const lev = computeRootingGuideLeverage(simInputs, 6);
  assert.ok(lev.length >= 3);
  for (const row of lev) {
    assert.ok(row.homeWinProbPct > 1 && row.homeWinProbPct < 99);
    assert.ok(typeof row.expectedImpactScore === 'number' && row.expectedImpactScore >= 0);
    assert.ok(row.leverageTag && row.leverageReason);
  }
});

test('Cap Simulator computes CBA Article 13 Post-Rollover 2027 net space, 2028 cut/trade deltas & Post-June 1 timing notes', () => {
  const baseSim = simulateCapScenario(capData, {});
  const expectedPostRoll =
    capData.years['2027'].teamCapSpace + Math.max(0, capData.years['2026'].teamCapSpace);
  assert.equal(baseSim.summary.updatedNextYearWithRollover, expectedPostRoll);
  assert.ok(baseSim.summary.updatedNextYearWithRollover > 0, 'SF 2026 rollover turns 2027 net balance positive');

  const purdy = capData.players.find(p => p.name === 'Brock Purdy');
  const save26 = purdy.contractsByYear['2026'].transactions.restructure.capSavings;
  const restSim = simulateCapScenario(capData, { [purdy.id]: 'restructure' });
  assert.equal(
    restSim.summary.netTwoYearHorizonDelta,
    save26 - Math.round(save26 / 4),
    'Article 13 rollover carries 100% of 2026 restructure savings while 2027 absorbs 25% proration'
  );

  // Post-June 1 single cut records cbaTimingNotes without triggering >2 rule warning, and credits 2028 cleared cap
  const candidate = capData.players.find(
    p =>
      p.contractsByYear?.['2026']?.transactions?.june_1_cut?.capSavings > 0 &&
      (p.contractsByYear?.['2028']?.capNumber || 0) > 0
  );
  if (candidate) {
    const j1Sim = simulateCapScenario(capData, { [candidate.id]: 'june_1_cut' });
    assert.equal(j1Sim.warnings.length, 0);
    assert.ok(j1Sim.cbaTimingNotes.length >= 1);
    assert.equal(j1Sim.summary.yearPlus2CapDelta, candidate.contractsByYear['2028'].capNumber);
  }
});

await testAsync('Anti-Fluff Salience Scorer & Breaking Classifier block mock-trade and media-release false positives', async () => {
  const { computeNewsSalienceScore } = await import('../src/engine/antiFluffFilter.js');
  const nowMs = Date.now();
  const recentIso = new Date(nowMs - 20 * 60_000).toISOString();

  // Media / PR "released" and "mock trade" must NOT trigger BREAKING
  const mediaRelease = classifyBreakingItem(
    { title: '49ers released Week 9 hype video and uniform schedule ahead of Sunday', publishedAt: recentIso },
    nowMs
  );
  assert.equal(mediaRelease.isBreaking, false);

  const mockTrade = classifyBreakingItem(
    { title: 'Blockbuster mock trade proposal: 49ers acquiring Myles Garrett in wild pitch', publishedAt: recentIso },
    nowMs
  );
  assert.equal(mockTrade.isBreaking, false);

  // Genuine roster transaction "released WR" and in-game medical tent DO trigger BREAKING
  const realRelease = classifyBreakingItem(
    { title: '49ers have released WR Chris Conley from the active roster per source', publishedAt: recentIso },
    nowMs
  );
  assert.equal(realRelease.isBreaking, true);

  // Acronym check: NFLPA & NBCSBA should not trigger ALL-CAPS shouting fluff penalty
  const acronymClean = scoreContentSignal(
    'NBCSBA & NFLPA ledger breakdown: 49ers carry $35.16M in Top-51 space under Article 13',
    'PBWR and YPRR splits in 21 personnel.'
  );
  assert.equal(acronymClean.fluffScore, 0);
  assert.ok(acronymClean.signalScore >= 75);

  const highSalience = computeNewsSalienceScore(
    {
      title: 'Brock Purdy posts +0.31 EPA/play vs two-high shells on All-22 film',
      reporterId: 'matt_maiocco',
      publishedAt: recentIso,
      synthesizedFromCount: 4
    },
    { nowMs }
  );
  const staleHotTake = computeNewsSalienceScore(
    {
      title: 'Why everyone is overreacting this week',
      publishedAt: new Date(nowMs - 72 * 3_600_000).toISOString()
    },
    { nowMs }
  );
  assert.ok(highSalience > staleHotTake + 35, `Expected highSalience (${highSalience}) >> staleHotTake (${staleHotTake})`);
});

await testAsync('Deep Research 4-letter surname resolution, client entity word-boundary guard, Combine Spider & word-boundary source links', async () => {
  const { parseTopicIntent, buildDeepScoutingAnalysisMarkdown } = await import('../src/engine/deepResearchEngine.js');
  const { matchPlayersClient } = await import('../src/services/dataService.js');
  const { buildCombineIndexer } = await import('../scripts/lib/combineSpider.mjs');

  const appDataBundle = {
    meta: JSON.parse(fs.readFileSync(path.join(rootDir, 'data', 'meta.json'), 'utf8')),
    roster: JSON.parse(fs.readFileSync(path.join(rootDir, 'data', 'roster.json'), 'utf8')),
    cap: JSON.parse(fs.readFileSync(path.join(rootDir, 'data', 'cap.json'), 'utf8')),
    news: JSON.parse(fs.readFileSync(path.join(rootDir, 'data', 'news.json'), 'utf8')),
    scheduleMatchup: JSON.parse(fs.readFileSync(path.join(rootDir, 'data', 'schedule-matchup.json'), 'utf8')),
    seasonal: JSON.parse(fs.readFileSync(path.join(rootDir, 'data', 'seasonal.json'), 'utf8'))
  };

  // 4-letter unique roster surnames (Bosa, Puni) resolve while English common words ("white", "west") do not
  const bosaIntent = parseTopicIntent('Bosa Wide-9 pass rush win rate', appDataBundle);
  assert.ok(bosaIntent.explicitlyNamedPlayers.some(p => p.name === 'Nick Bosa'));

  const puniIntent = parseTopicIntent('Puni run blocking at right guard', appDataBundle);
  assert.ok(puniIntent.explicitlyNamedPlayers.some(p => p.name === 'Dominick Puni'));

  const commonWordsIntent = parseTopicIntent('white jersey in NFC West', appDataBundle);
  assert.ok(!commonWordsIntent.explicitlyNamedPlayers.some(p => p.name === 'Keion White'));

  const md = buildDeepScoutingAnalysisMarkdown({ query: 'Bosa and cap rollover', appData: appDataBundle });
  assert.ok(md.includes('net 2027 post-rollover balance'), 'Markdown must surface CBA Article 13 net post-rollover balance');
  assert.ok(md.includes('Implied Score'), 'Markdown must surface Vegas implied score');

  // Client tweet entity matcher: 49ers beat post resolves unique surnames; non-SF national insider post avoids surname homonyms
  const beatMatches = matchPlayersClient(
    'Purdy connected with Kittle and Pearsall while Puni anchored RG.',
    appDataBundle.roster.players,
    12,
    { allowUniqueSurnames: true }
  );
  const beatNames = beatMatches.map(m => m.name);
  assert.ok(beatNames.includes('Brock Purdy') && beatNames.includes('George Kittle') && beatNames.includes('Dominick Puni'));

  const nationalNonSfMatches = matchPlayersClient(
    'Bills pass rusher Bosa logged two sacks on Sunday.',
    appDataBundle.roster.players,
    12,
    { allowUniqueSurnames: false }
  );
  assert.equal(nationalNonSfMatches.length, 0, 'National non-SF post must not match Nick Bosa on bare surname');

  // Combine Spider suffix normalization & position disambiguation
  const indexer = buildCombineIndexer([
    { player_name: 'Deebo Samuel', pos: 'WR', draft_year: 2019, school: 'South Carolina', ht: '5-11', wt: 214, forty: 4.48, vertical: 39.0, broad_jump: 122, cone: 7.03, shuttle: 4.14, bench: 15 },
    { player_name: 'Deebo Samuel', pos: 'DT', draft_year: 2001, school: 'State', ht: '6-3', wt: 305, forty: 5.15, vertical: 27.0, broad_jump: 102, cone: 7.80, shuttle: 4.75, bench: 28 },
    { player_name: 'AJ Brown', pos: 'WR', draft_year: 2019, school: 'Ole Miss', ht: '6-0', wt: 226, forty: 4.49, vertical: 36.5, broad_jump: 120, cone: 7.0, shuttle: 4.25, bench: 19 },
    { player_name: 'DJ Moore', pos: 'WR', draft_year: 2018, school: 'Maryland', ht: '6-0', wt: 210, forty: 4.42, vertical: 39.5, broad_jump: 132, cone: 6.95, shuttle: 4.07, bench: 15 },
    { player_name: 'Terry McLaurin', pos: 'WR', draft_year: 2019, school: 'Ohio State', ht: '6-0', wt: 208, forty: 4.35, vertical: 37.5, broad_jump: 125, cone: 7.01, shuttle: 4.15, bench: 18 },
    { player_name: 'Average Wideout', pos: 'WR', draft_year: 2020, school: 'Tech', ht: '5-10', wt: 190, forty: 4.62, vertical: 32.0, broad_jump: 114, cone: 7.22, shuttle: 4.38, bench: 11 }
  ]);
  const deeboProfile = indexer.buildPlayerSpiderProfile({
    name: 'Deebo Samuel Sr.',
    position: 'WR',
    heightIn: 71,
    weightLb: 215
  });
  assert.equal(deeboProfile.sourceType, 'NFL Combine Official', 'Suffix Sr. must still match Combine WR Deebo Samuel');
  assert.equal(deeboProfile.axes.find(a => a.key === 'forty').value, 4.48, 'Must pick WR Combine entry over homonym DT');

  // Word-boundary source-link matching in seasonalContentBuilder ('cap' must NOT match 'recap' or 'captain')
  const dynamicBriefs = await buildClusteredNewsBriefs(
    [],
    [
      {
        type: 'article',
        title: 'Week 9 game recap: team captain praises effort',
        summary: 'Full locker room recap.',
        url: 'https://www.espn.com/nfl/story/_/id/111/recap-only',
        outletName: 'ESPN',
        signalScore: 70
      },
      {
        type: 'article',
        title: '49ers salary cap rollover and Lynch contract blueprint',
        summary: 'Article 13 cap analysis.',
        url: 'https://www.espn.com/nfl/story/_/id/222/real-cap-story',
        outletName: 'ESPN',
        signalScore: 90
      }
    ],
    appDataBundle.roster.players,
    { seasonYear: 2026, currentWeek: 10, teamRecord: '7-1', upcomingMatchup: { oppAbbr: 'SEA', oppName: 'Seattle Seahawks', betting: { spread: 'SF -4.5', overUnder: 47.5 } } }
  );
  const capCluster = dynamicBriefs.find(c => c.id.startsWith('cluster_cap_horizon'));
  assert.ok(capCluster, 'Expected dynamic cap cluster for Week 10');
  assert.ok(
    !capCluster.sourceLinks.some(l => l.url.includes('recap-only')),
    '"cap" keyword must NOT match "recap" or "captain"'
  );
  assert.ok(
    capCluster.sourceLinks.some(l => l.url.includes('real-cap-story')),
    '"cap" keyword must match genuine salary cap article'
  );

  // Jargon Glossary & TTS Speech Humanizer expanded analytical/CBA/medical coverage
  for (const key of ['yprr', 'pbwr', 'rswr', 'sov', 'sos', 'article_13', 'concussion_protocol']) {
    assert.ok(getJargonEntry(key), `Missing glossary entry for ${key}`);
  }
  const annotated = annotateJargonPlainText(
    'Pearsall posted 2.4 YPRR behind 68% PBWR while Article 13 rollover and concussion protocol shape SOV.'
  );
  assert.ok(
    annotated.includes('data-jargon="yprr"') &&
      annotated.includes('data-jargon="pbwr"') &&
      annotated.includes('data-jargon="article_13"') &&
      annotated.includes('data-jargon="concussion_protocol"') &&
      annotated.includes('data-jargon="sov"'),
    `Expected inline jargon annotations for new terms, got: ${annotated}`
  );
  const spokenSample = humanizeNflTextForTts(
    'Mustapha and Guerendo give SF +$3.62M post-rollover, 2.4 YPRR, 68% PBWR, and tiebreaker SOV.'
  );
  assert.ok(
    spokenSample.includes('Moo-stah-fuh') &&
      spokenSample.includes('Guh-ren-doh') &&
      spokenSample.includes('plus 3.62 million dollars') &&
      spokenSample.includes('yards per route run') &&
      spokenSample.includes('pass block win rate') &&
      spokenSample.includes('strength of victory'),
    `Unexpected spoken humanization output: ${spokenSample}`
  );
});

await testAsync('X-Beat Attribution, Trust-Tier + First-Mover Injury Scoop Ranking & Multi-Source Live Wire QA', async () => {
  // 1. Prose & emoji-mirror X beat reporter extraction
  const wagAttr = extractBeatAttributionFromText(
    'Purdy (shoulder) practiced in full Thursday, Nick Wagoner of ESPN.com reports.'
  );
  assert.equal(wagAttr.reporterId, 'nick_wagoner');
  assert.equal(wagAttr.authorHandle, '@nwagoner');
  assert.equal(wagAttr.xUrl, 'https://x.com/nwagoner');
  assert.equal(wagAttr.trustTier, 1);

  const maioccoAttr = extractBeatAttributionFromText(
    'McCaffrey logged a full workload Friday, per Matt Maiocco of NBC Sports Bay Area.'
  );
  assert.equal(maioccoAttr.reporterId, 'matt_maiocco');
  assert.equal(maioccoAttr.authorHandle, '@MaioccoNBCS');
  assert.equal(maioccoAttr.trustTier, 1);

  const warrenAttr = extractBeatAttributionFromText(
    'Pearsall worked on a side field Wednesday, Sam Warren of The Athletic reports.'
  );
  assert.equal(warrenAttr.reporterId, 'sam_warren');
  assert.equal(warrenAttr.authorHandle, '@SamWarren_SF');
  assert.equal(warrenAttr.trustTier, 2);

  const schefterEmoji = extractBeatAttributionFromText(
    '‼️ Schefter: 49ers are activating LB Tatum Bethune from injured reserve ahead of Sunday.'
  );
  assert.equal(schefterEmoji.reporterId, 'adam_schefter');
  assert.equal(schefterEmoji.authorHandle, '@AdamSchefter');
  assert.ok(!schefterEmoji.cleanedText.includes('Schefter:'), `Expected stripped prefix, got ${schefterEmoji.cleanedText}`);

  // 2. Paywall guard allows free social/wire hosts even when reporter's employer is paywalled
  assert.equal(isPaywalledPublisher('The Athletic', 'https://x.com/mattbarrows'), false);
  assert.equal(isPaywalledPublisher('The Athletic', 'https://bsky.app/profile/mattbarrows.bsky.social/post/abc'), false);
  assert.equal(isPaywalledPublisher('San Francisco Chronicle', 'https://www.espn.com/nfl/player/_/id/4361741/brock-purdy'), false);
  assert.equal(isPaywalledPublisher('The Athletic', 'https://www.nytimes.com/athletic/12345/49ers/'), true);

  // 3. First-Mover Injury Scoop elevation (Tier-3 viable writer breaking an acute sideline injury) + Tier-1 Corroboration
  const nowMs = Date.parse('2026-11-08T18:30:00Z');
  const soloFirstMoverStream = sortNewsWithBreakingPriority(
    [
      {
        id: 'tier1_general',
        type: 'tweet',
        reporterId: 'matt_maiocco',
        author: 'Matt Maiocco',
        authorHandle: '@MaioccoNBCS',
        title: '49ers offensive line film review from Week 9 win.',
        fullText: '49ers offensive line film review from Week 9 win.',
        publishedAt: '2026-11-08T18:25:00Z'
      },
      {
        id: 'tier3_injury_scoop',
        type: 'tweet',
        reporterId: 'grant_cohn',
        author: 'Grant Cohn',
        authorHandle: '@grantcohn',
        title: 'Fred Warner just walked off with trainers during pregame warmups.',
        fullText: 'Fred Warner just walked off with trainers during pregame warmups.',
        mentionedPlayers: [{ id: '3139477', name: 'Fred Warner' }],
        publishedAt: '2026-11-08T18:20:00Z'
      }
    ],
    nowMs
  );
  assert.equal(
    soloFirstMoverStream[0].id,
    'tier3_injury_scoop',
    'First viable writer to tweet an acute sideline/warmup injury must immediately rise to #1'
  );
  assert.equal(soloFirstMoverStream[0].isFirstMoverInjuryScoop, true);

  // Once Tier-1 beat reporters corroborate the injury, Tier-1 leads while preserving firstReportedBy + corroboratedBy
  const corroboratedStream = sortNewsWithBreakingPriority(
    [
      ...soloFirstMoverStream,
      {
        id: 'tier1_injury_confirm',
        type: 'tweet',
        reporterId: 'nick_wagoner',
        author: 'Nick Wagoner',
        authorHandle: '@nwagoner',
        title: 'Fred Warner is questionable to return with an ankle injury.',
        fullText: 'Fred Warner is questionable to return with an ankle injury.',
        mentionedPlayers: [{ id: '3139477', name: 'Fred Warner' }],
        publishedAt: '2026-11-08T18:28:00Z'
      }
    ],
    nowMs
  );
  const wagConfirm = corroboratedStream.find(x => x.id === 'tier1_injury_confirm');
  const cohnOrig = corroboratedStream.find(x => x.id === 'tier3_injury_scoop');
  assert.equal(corroboratedStream[0].id, 'tier1_injury_confirm', 'Tier-1 confirmation of live in-game return status should rank #1');
  assert.equal(wagConfirm.firstReportedBy, 'Grant Cohn', 'Must preserve First-Mover credit for the writer who tweeted first');
  assert.equal(wagConfirm.corroborationCount, 2);
  assert.ok(cohnOrig.corroboratedBy?.includes('Nick Wagoner'), 'Original scoop should show Tier-1 corroboration');

  // Non-injury opinion takes still favor Tier-1 Trusted Beat over Tier-3 hot-take columnists
  const tier1BeatSalience = computeNewsSalienceScore(
    {
      title: 'Kyle Shanahan explains Wide-9 stunt mechanics and EPA efficiency',
      reporterId: 'matt_barrows',
      trustTier: getReporterTrustTier('matt_barrows'),
      publishedAt: '2026-11-08T17:00:00Z',
      signalScore: 84
    },
    { styleTag: 'factual-beat' },
    nowMs
  );
  const tier3OpinionSalience = computeNewsSalienceScore(
    {
      title: 'Why the coaching staff needs a wake-up call this month',
      reporterId: 'dieter_kurtenbach',
      trustTier: getReporterTrustTier('dieter_kurtenbach'),
      publishedAt: '2026-11-08T17:00:00Z',
      signalScore: 62
    },
    { styleTag: 'opinion-hot-take' },
    nowMs
  );
  assert.ok(tier1BeatSalience > tier3OpinionSalience + 20, 'Tier-1 factual beat must strongly outscore Tier-3 opinion');

  // 4. Live X Search URLs + Full Settings Tier 1–3 Coverage within X 500-char Query Limit
  const liveReportersJson = JSON.parse(
    fs.readFileSync(path.join(rootDir, 'data/reporters.json'), 'utf8')
  );
  const settingsReporters = liveReportersJson.reporters || [];
  const xTrustedUrl = buildXBeatListSearchUrl('trusted', { reporters: settingsReporters });
  const xFilmUrl = buildXBeatListSearchUrl('film', { reporters: settingsReporters });
  const xInjUrl = buildXBeatListSearchUrl('injuries', { reporters: settingsReporters });
  const xInsidersUrl = buildXBeatListSearchUrl('insiders', { reporters: settingsReporters });
  const xPlayerUrl = buildXPlayerScoopSearchUrl('Brock Purdy');

  for (const [label, urlStr] of [
    ['trusted', xTrustedUrl],
    ['film', xFilmUrl],
    ['injuries', xInjUrl],
    ['insiders', xInsidersUrl]
  ]) {
    assert.ok(urlStr.startsWith('https://x.com/search?q=') && urlStr.includes('f=live'), `Invalid ${label} X URL: ${urlStr}`);
    const parsedQ = new URL(urlStr).searchParams.get('q') || '';
    assert.ok(
      parsedQ.length > 10 && parsedQ.length <= MAX_X_SEARCH_RAW_QUERY_LENGTH,
      `${label} X rawQuery exceeded ${MAX_X_SEARCH_RAW_QUERY_LENGTH} chars (got ${parsedQ.length}): ${parsedQ}`
    );
  }

  const combinedDirectXQueries = ['trusted', 'film', 'insiders']
    .map(m => (new URL(buildXBeatListSearchUrl(m, { reporters: settingsReporters })).searchParams.get('q') || '').toLowerCase())
    .join(' ');
  for (const rep of settingsReporters) {
    const cleanHandle = String(rep.handle || '').replace(/^@/, '').toLowerCase();
    assert.ok(
      combinedDirectXQueries.includes(`from:${cleanHandle}`),
      `Expected Settings Tier ${rep.trustTier} reporter ${rep.name} (@${cleanHandle}) to be included in Direct X Beat Lists`
    );
  }
  const trustedQ = new URL(xTrustedUrl).searchParams.get('q') || '';
  assert.ok(
    trustedQ.includes('from:MaioccoNBCS') &&
      trustedQ.includes('from:SamWarren_SF') &&
      trustedQ.includes('from:noah_furtado') &&
      trustedQ.includes('from:dkurtenbach') &&
      trustedQ.includes('from:grantcohn'),
    `Trusted Beat must include Tier 1, Tier 2, and Tier 3 49ers beat writers from Settings: ${trustedQ}`
  );
  const mutedTrustedQ = new URL(
    buildXBeatListSearchUrl('trusted', {
      reporters: settingsReporters,
      userPrefs: { disabledReporterIds: ['grant_cohn'], muteHotTakePersonalities: true }
    })
  ).searchParams.get('q') || '';
  assert.ok(
    !mutedTrustedQ.includes('from:grantcohn') && !mutedTrustedQ.includes('from:dkurtenbach'),
    `Direct X Beat Lists must respect Settings disabledReporterIds & muteHotTakePersonalities: ${mutedTrustedQ}`
  );
  assert.ok(xInjUrl.includes('MaioccoNBCS'));
  assert.ok(xPlayerUrl.startsWith('https://x.com/search?q=') && xPlayerUrl.includes('Brock%20Purdy') && xPlayerUrl.includes('f=live'));

  // 5. Multi-source live wire orchestrator (ESPN Player Wire + RotoWire RSS + Official Transactions + Bluesky)
  const origFetch = globalThis.fetch;
  try {
    const freshIso = new Date(Date.now() - 4 * 60_000).toISOString();
    globalThis.fetch = async reqUrl => {
      const u = String(reqUrl);
      if (u.includes('apis/fantasy/v2/games/ffl/news/players?playerId=4361741')) {
        return {
          ok: true,
          json: async () => ({
            feed: [
              {
                id: 99112233,
                type: 'PlayerNews',
                published: freshIso,
                headline: 'Full go at practice',
                description: 'Purdy (shoulder) was a full participant in practice Friday, Nick Wagoner of ESPN.com reports.',
                story: 'Purdy has no game status designation for Sunday.'
              }
            ]
          })
        };
      }
      if (u.includes('apis/fantasy/v2/games/ffl/news/players')) {
        return { ok: true, json: async () => ({ feed: [] }) };
      }
      if (u.includes('rotowire.com/rss/news.php')) {
        return {
          ok: true,
          text: async () => `<?xml version="1.0"?><rss><channel><item>
            <title>George Kittle: Cleared after sideline check</title>
            <description>49ers TE George Kittle returned to the game after a brief medical tent visit, Matt Maiocco of NBC Sports Bay Area reports.</description>
            <link>https://www.rotowire.com/football/headlines/george-kittle-injury-9988</link>
            <pubDate>${new Date(Date.now() - 2 * 60_000).toUTCString()}</pubDate>
            <guid>rw-kittle-9988</guid>
          </item></channel></rss>`
        };
      }
      if (u.includes('transactions?team=25')) {
        return {
          ok: true,
          json: async () => ({
            transactions: [
              {
                date: freshIso,
                description: 'Activated WR Ricky Pearsall from injured reserve.'
              }
            ]
          })
        };
      }
      if (u.includes('mattbarrows.bsky.social')) {
        return {
          ok: true,
          json: async () => ({
            feed: [
              {
                post: {
                  uri: 'at://did:plc:barrows/app.bsky.feed.post/multisrc777',
                  record: {
                    text: '49ers defensive line rotation getting extra Wide-9 stunt reps today in Santa Clara.',
                    createdAt: freshIso
                  }
                }
              }
            ]
          })
        };
      }
      return { ok: true, json: async () => ({ feed: [] }) };
    };

    const mockAppData = {
      roster: {
        players: [
          { id: '4361741', name: 'Brock Purdy', position: 'QB', jersey: 13, rosterBucket: 'active', capHit2026: 12000000, health: { status: 'Questionable', isOnPracticeReport: true }, recentNews: [] },
          { id: '3040151', name: 'George Kittle', position: 'TE', jersey: 85, rosterBucket: 'active', capHit2026: 22000000, health: { status: 'Active' }, recentNews: [] },
          { id: '4428209', name: 'Ricky Pearsall', position: 'WR', jersey: 14, rosterBucket: 'active', capHit2026: 3500000, health: { status: 'Active' }, recentNews: [] }
        ]
      },
      news: { rawStream: [] }
    };

    const firstPass = await hydrateLiveMultiSourceBeatWire(mockAppData, { isGameLive: true });
    assert.equal(firstPass.bySource.espnPlayerWire, 1, 'Expected 1 ESPN X-Beat Player Wire item');
    assert.equal(firstPass.bySource.rotowireRss, 1, 'Expected 1 RotoWire Live RSS item');
    assert.equal(firstPass.bySource.transactions, 1, 'Expected 1 Official 49ers Transaction item');
    assert.equal(firstPass.bySource.bluesky, 1, 'Expected 1 Bluesky beat post');
    assert.equal(firstPass.totalAdded, 4);
    assert.equal(mockAppData.news.rawStream[0].isInGameInjury, true, 'Kittle medical tent return update must rank #1');
    assert.equal(mockAppData.news.rawStream[0].authorHandle, '@MaioccoNBCS');
    assert.equal(mockAppData.news.rawStream[0].authorProfileUrl, 'https://x.com/MaioccoNBCS');
    assert.ok(mockAppData.roster.players[0].recentNews.length >= 1, 'Purdy recentNews must be hydrated live');

    const secondPass = await hydrateLiveMultiSourceBeatWire(mockAppData, { isGameLive: true });
    assert.equal(secondPass.totalAdded, 0, 'Idempotent second poll must add 0 duplicate items');
  } finally {
    globalThis.fetch = origFetch;
  }
});

console.log('\n=== [11/11] Game-Day Roster [T-90m, Final), Questionable->In/Out, Post-Game Rollover, In-Game/48h News Priority & Clutter Scrub QA ===');

test('Game-Day Roster Engine activates strictly from T-90m until Final, tolerates posting delays, groups Offense->Defense->ST, and resolves Questionable->In/Out', () => {
  const koIso = '2026-11-15T21:25:00Z';
  const koMs = Date.parse(koIso);
  const baseSchedule = [
    {
      id: '401873063',
      week: 10,
      dateIso: koIso,
      completed: false,
      statusDetail: '1:25 PM PT',
      opponent: { abbr: 'DAL', name: 'Dallas Cowboys' }
    }
  ];

  // T-95m: Not yet in 90-minute window
  assert.equal(evaluateGameDayWindow(baseSchedule, null, koMs - 95 * 60_000).isActive, false);

  // T-89m: Active in 90-minute pre-game window!
  const tMinus89 = evaluateGameDayWindow(baseSchedule, null, koMs - 89 * 60_000);
  assert.equal(tMinus89.isActive, true);
  assert.equal(tMinus89.hasKickoffStarted, false);
  assert.equal(tMinus89.minutesUntilKickoff, 89);

  // Mid-game (Kickoff + 75m): Still active!
  const midGame = evaluateGameDayWindow(baseSchedule, null, koMs + 75 * 60_000);
  assert.equal(midGame.isActive, true);
  assert.equal(midGame.hasKickoffStarted, true);

  // Final (completed: true): Immediately disappears!
  const finalSchedule = [{ ...baseSchedule[0], completed: true, statusDetail: 'Final' }];
  assert.equal(evaluateGameDayWindow(finalSchedule, null, koMs + 195 * 60_000).isActive, false);

  // Build roster model: Pending at T-88m (slight posting delay) vs Official Declared once >=5 inactives post
  const sampleRoster = [
    { id: '1', name: 'Brock Purdy', position: 'QB', jersey: 13, rosterBucket: 'active', isStarter: true },
    { id: '2', name: 'Christian McCaffrey', position: 'RB', jersey: 23, rosterBucket: 'active', isStarter: true, health: { status: 'Questionable', injuryType: 'Achilles' } },
    { id: '3', name: 'Deebo Samuel Sr.', position: 'WR', jersey: 19, rosterBucket: 'active', isStarter: true, health: { status: 'Out', injuryType: 'Hamstring' } },
    { id: '4', name: 'Nick Bosa', position: 'DE', jersey: 97, rosterBucket: 'active', isStarter: true },
    { id: '5', name: 'Fred Warner', position: 'LB', jersey: 54, rosterBucket: 'active', isStarter: true },
    { id: '6', name: 'Jake Moody', position: 'PK', jersey: 4, rosterBucket: 'active', isStarter: true },
    { id: '7', name: 'Mitch Wishnowsky', position: 'P', jersey: 18, rosterBucket: 'active', isStarter: true },
    { id: '8', name: 'Siran Neal', position: 'S', jersey: 33, rosterBucket: 'active', health: { status: 'Questionable', injuryType: 'Knee' } },
    { id: '9', name: 'Upton Stout', position: 'CB', jersey: 20, rosterBucket: 'active', health: { status: 'Questionable', injuryType: 'Shoulder' } },
    { id: '10', name: 'Isaac Guerendo', position: 'RB', jersey: 31, rosterBucket: 'ir', health: { status: 'Reserve / PUP' } }
  ];
  const sampleReport = [
    { playerId: '3', name: 'Deebo Samuel Sr.', position: 'WR', jersey: 19, gameStatus: 'Out', injuryType: 'Hamstring', playProbabilityPct: 0, playBadgeLabel: '0% • Out' },
    { playerId: '2', name: 'Christian McCaffrey', position: 'RB', jersey: 23, gameStatus: 'Questionable', injuryType: 'Achilles', playProbabilityPct: 82, playBadgeLabel: '82% • Likely' },
    { playerId: '8', name: 'Siran Neal', position: 'S', jersey: 33, gameStatus: 'Questionable', injuryType: 'Knee', playProbabilityPct: 56, playBadgeLabel: '56% • GTD' },
    { playerId: '9', name: 'Upton Stout', position: 'CB', jersey: 20, gameStatus: 'Questionable', injuryType: 'Shoulder', playProbabilityPct: 78, playBadgeLabel: '78% • GTD', beatComment: 'Stout is active as an emergency backup CB and remains a game-time decision on snaps.' }
  ];

  // Delay-tolerant pending state (T-88m, before official 5-7 scratch list drops)
  const pendingModel = buildTeamGameDayRosterModel({
    teamAbbr: 'SF',
    teamName: 'San Francisco 49ers',
    is49ers: true,
    windowInfo: tMinus89,
    rosterPlayers: sampleRoster,
    injuryReportRows: sampleReport
  });
  assert.equal(pendingModel.isActive, true);
  assert.equal(pendingModel.officialPosted, false, 'Only 1 pre-declared Out should stay in Pending state before kickoff');
  assert.equal(pendingModel.inactives.length, 1);
  assert.equal(pendingModel.inactives[0].name, 'Deebo Samuel Sr.');

  // Official inactives announced via wire / live feed -> flips officialPosted=true & resolves Questionable -> In/Out!
  const wireNews = [
    {
      title: '49ers official Week 10 inactives: WR Deebo Samuel Sr., S Siran Neal, OL Spencer Burford, DL Yetur Gross-Matos, RB Jordan James.',
      publishedAt: new Date(koMs - 82 * 60_000).toISOString()
    }
  ];
  const wireSignals = extractWireGameDaySignals(wireNews, sampleRoster, koMs);
  assert.equal(wireSignals.hasOfficialListSignal, true);

  const declaredModel = buildTeamGameDayRosterModel({
    teamAbbr: 'SF',
    teamName: 'San Francisco 49ers',
    is49ers: true,
    windowInfo: tMinus89,
    rosterPlayers: sampleRoster,
    injuryReportRows: sampleReport,
    newsItems: wireNews,
    liveFeedData: {
      officialPosted: true,
      inactives: [
        { name: 'Deebo Samuel Sr.', position: 'WR', jersey: 19, reason: 'Hamstring' },
        { name: 'Siran Neal', position: 'S', jersey: 33, reason: 'Knee' },
        { name: 'Spencer Burford', position: 'OL', jersey: 74, reason: 'Healthy Scratch' },
        { name: 'Yetur Gross-Matos', position: 'DL', jersey: 94, reason: 'Healthy Scratch' },
        { name: 'Jordan James', position: 'RB', jersey: 28, reason: 'Healthy Scratch' }
      ]
    }
  });
  assert.equal(declaredModel.officialPosted, true);
  assert.equal(declaredModel.inactives.length, 5);
  assert.deepEqual(Object.keys(declaredModel.activesByUnit), ['Offense', 'Defense', 'Special Teams']);
  assert.ok(declaredModel.activesByUnit.Offense.some(p => p.name === 'Brock Purdy' && p.isActive));
  assert.ok(declaredModel.activesByUnit.Defense.some(p => p.name === 'Nick Bosa'));
  assert.ok(declaredModel.activesByUnit['Special Teams'].some(p => p.name === 'Jake Moody'));
  assert.ok(!declaredModel.activesByUnit.Defense.some(p => p.name === 'Siran Neal'), 'Declared inactive Siran Neal excluded from active roster');

  const resolvedRows = resolveGameDayInjuryRows(sampleReport, declaredModel);
  const cmcRow = resolvedRows.find(r => r.name === 'Christian McCaffrey');
  const nealRow = resolvedRows.find(r => r.name === 'Siran Neal');
  const stoutRow = resolvedRows.find(r => r.name === 'Upton Stout');
  assert.equal(cmcRow.playBadgeLabel, '99% • In (Active)', 'Active Questionable player flips to 99% • In (Active)');
  assert.equal(nealRow.playBadgeLabel, '0% • Out (Inactive)', 'Inactive Questionable player flips to 0% • Out (Inactive)');
  assert.equal(stoutRow.playBadgeLabel, 'Active • GTD', 'Explicit rare emergency/snap-limited active GTD retains Active • GTD');

  // Post-game rollover blanks W/T/F, drops Coach's Decision/Vet Rest, and converts prior-game Out to upcoming-week Questionable
  const rolled = rolloverPracticeReportForUpcomingWeek(
    [
      { name: 'Trent Williams', position: 'OT', wed: 'Vet Rest', thu: 'FP', fri: 'FP', injuryType: 'NIR - Rest', gameStatus: 'Active' },
      { name: 'Tyrus Wheat', position: 'LB', wed: 'DNP', thu: 'DNP', fri: 'DNP', injuryType: "Coach's Decision", gameStatus: 'Out', shortComment: 'inactive' },
      { name: 'Luke Schoonmaker', position: 'TE', wed: 'DNP', thu: 'DNP', fri: 'DNP', injuryType: 'Groin', gameStatus: 'Out', shortComment: 'Schoonmaker is inactive for Sunday.' }
    ],
    { clearPracticeDays: true, upcomingWeek: 10 }
  );
  assert.equal(rolled.length, 1);
  assert.equal(rolled[0].name, 'Luke Schoonmaker');
  assert.equal(rolled[0].wed, '-');
  assert.equal(rolled[0].thu, '-');
  assert.equal(rolled[0].fri, '-');
  assert.equal(rolled[0].gameStatus, 'Questionable');
  assert.ok(rolled[0].playProbabilityPct > 0, 'Prior-week Out player must receive >0% modeled play likelihood for upcoming week');
});

test('News Classifier prioritizes live in-game injuries, demotes stale pre-game Mike Evans inactive notes, prioritizes 48h post-game injury updates, groups duplicates, and strips triple attribution', () => {
  const koIso = '2026-11-08T21:25:00Z';
  const koMs = Date.parse(koIso);

  // 1. Live In-Game Context (Kickoff + 60m): In-game injury beats pre-game Mike Evans inactive report!
  const inGameSchedule = {
    scheduleMatchup: {
      schedule: [{ id: 'g9', week: 9, dateIso: koIso, completed: false, statusDetail: 'Q2 08:14' }]
    }
  };
  const inGameNow = koMs + 60 * 60_000;
  const inGameSorted = sortNewsWithBreakingPriority(
    [
      {
        id: 'pregame_evans_out',
        type: 'tweet',
        author: 'Adam Schefter',
        authorHandle: '@AdamSchefter',
        title: '49ers WR Mike Evans is officially inactive today and will not play against the Raiders.',
        fullText: '49ers WR Mike Evans is officially inactive today and will not play against the Raiders.',
        publishedAt: new Date(koMs - 75 * 60_000).toISOString()
      },
      {
        id: 'ingame_play_tweet',
        type: 'tweet',
        author: 'Matt Barrows',
        authorHandle: '@mattbarrows',
        title: 'Brock Purdy hits George Kittle up the seam for 29 yards on 3rd-and-7.',
        fullText: 'Brock Purdy hits George Kittle up the seam for 29 yards on 3rd-and-7.',
        publishedAt: new Date(koMs + 42 * 60_000).toISOString()
      },
      {
        id: 'ingame_bosa_tent',
        type: 'tweet',
        author: 'Nick Wagoner',
        authorHandle: '@nwagoner',
        title: 'Nick Bosa is in the blue medical tent and questionable to return with a hip injury.',
        fullText: 'Nick Bosa is in the blue medical tent and questionable to return with a hip injury.',
        publishedAt: new Date(koMs + 55 * 60_000).toISOString()
      }
    ],
    inGameNow,
    { appData: inGameSchedule }
  );
  assert.equal(inGameSorted[0].id, 'ingame_bosa_tent', 'Live in-game injury update must rank #1');
  assert.equal(inGameSorted[0].breakingBadge, 'LIVE INJURY UPDATE');
  assert.equal(inGameSorted[1].id, 'ingame_play_tweet', 'Live in-game beat tweet must rank #2 ahead of stale pre-game inactives');
  assert.equal(inGameSorted[2].id, 'pregame_evans_out', 'Pre-game Mike Evans inactive report must be demoted once game starts');

  // 2. 48-Hour Post-Game Context (Kickoff + 18h): Meaningful post-game MRI update ranks #1; duplicate injury echoes collapse into confirmingReports!
  const postGameSchedule = {
    scheduleMatchup: {
      schedule: [{ id: 'g9', week: 9, dateIso: koIso, completed: true, statusDetail: 'Final' }]
    }
  };
  const postGameNow = koMs + 18 * 3600_000;
  const ctx48 = resolveGameNewsContext(postGameSchedule, postGameNow);
  assert.equal(ctx48.postGame48h, true);

  const postGameSorted = sortNewsWithBreakingPriority(
    [
      {
        id: 'monday_opinion',
        type: 'article',
        author: 'Matt Maiocco',
        title: '49ers Week 9 snap count observations and NFC West standings lookahead',
        publishedAt: new Date(postGameNow - 30 * 60_000).toISOString()
      },
      {
        id: 'bosa_mri_1',
        type: 'tweet',
        author: 'Nick Wagoner',
        title: 'Kyle Shanahan said Nick Bosa MRI on his hip came back clean and he is day-to-day for Week 10.',
        fullText: 'Kyle Shanahan said Nick Bosa MRI on his hip came back clean and he is day-to-day for Week 10.',
        mentionedPlayers: [{ id: '4040605', name: 'Nick Bosa' }],
        publishedAt: new Date(postGameNow - 90 * 60_000).toISOString()
      },
      {
        id: 'bosa_mri_2',
        type: 'tweet',
        author: 'Matt Barrows',
        title: 'MRI on Nick Bosa hip showed no structural damage per Shanahan.',
        fullText: 'MRI on Nick Bosa hip showed no structural damage per Shanahan.',
        mentionedPlayers: [{ id: '4040605', name: 'Nick Bosa' }],
        publishedAt: new Date(postGameNow - 85 * 60_000).toISOString()
      }
    ],
    postGameNow,
    { appData: postGameSchedule }
  );
  assert.ok(
    ['bosa_mri_1', 'bosa_mri_2'].includes(postGameSorted[0].id),
    'Meaningful post-game MRI injury update must rank #1 within 48h window ahead of general Monday column'
  );
  const deduped = deduplicateAndGroupWireItems(postGameSorted);
  assert.equal(deduped.length, 2, 'Duplicate MRI tweet on same player/milestone must group into confirmingReports');
  assert.ok(['bosa_mri_1', 'bosa_mri_2'].includes(deduped[0].id), 'MRI update card leads the feed');
  assert.equal(deduped[0].confirmingReports?.length, 1);

  // 3. Single-attribution boilerplate cleaner & self-link guard (Mike Garafolo screenshot regression test!)
  const garafoloCleaned = stripRedundantAuthorBoilerplate(
    "McCaffrey is expected to take on a full workload Sunday against the Raiders, Mike Garafolo of NFL Network reports. McCaffrey was limited to a 52 percent snap share...",
    'Mike Garafolo'
  );
  assert.ok(!garafoloCleaned.includes('Mike Garafolo of NFL Network reports'), `Expected inline author stripped, got: ${garafoloCleaned}`);
  assert.equal(isRedundantProfileSelfLink('https://x.com/MikeGarafolo', 'https://www.espn.com/nfl/player/_/id/3117251#wire'), true);
  assert.equal(isRedundantProfileSelfLink('https://www.espn.com/nfl/story/_/id/999/real-story', 'https://x.com/MikeGarafolo/status/123'), false);

  // 4. Unified 2-row 6-filter News View (no Synthesis Briefs), Single-attribution tweet cards, and Settings Host Format
  const newsHtml = renderNewsViewHtml({
    newsCategoryFilter: 'all',
    filteredRawItems: [
      {
        id: 'garafolo_card',
        type: 'tweet',
        title: "McCaffrey is expected to take on a full workload Sunday against the Raiders, Mike Garafolo of NFL Network reports.",
        fullText: "McCaffrey is expected to take on a full workload Sunday against the Raiders, Mike Garafolo of NFL Network reports.",
        author: 'Mike Garafolo',
        authorHandle: '@MikeGarafolo',
        authorProfileUrl: 'https://x.com/MikeGarafolo',
        url: 'https://www.espn.com/nfl/player/_/id/3117251/christian-mccaffrey#wire-1',
        externalUrl: 'https://x.com/MikeGarafolo',
        externalTitle: 'Mike Garafolo (@MikeGarafolo) on X',
        publishedAt: new Date().toISOString()
      }
    ],
    reportersById: new Map(),
    userPrefs: { disabledReporterIds: [], disabledOutlets: [] },
    activeVideosSet: new Set()
  });
  assert.ok(!newsHtml.includes('data-action="set-news-mode"'), 'Synthesis Briefs / Wire mode toggle must be completely removed');
  assert.ok(!/Synthesis Briefs/i.test(newsHtml), 'Synthesis Briefs label must not render anywhere in News & Film');
  for (const expectedCat of ['all', 'tweets', 'articles', 'videos', 'film', 'roster']) {
    assert.ok(newsHtml.includes(`data-category="${expectedCat}"`), `Missing unified news filter button: ${expectedCat}`);
  }
  assert.ok(newsHtml.includes('Highlights &amp; Videos'), 'Videos filter must be titled "Highlights & Videos"');
  const garafoloCount = (newsHtml.match(/Mike Garafolo/g) || []).length;
  // Note: 1 on the tweet card itself (+ optional 1 if cited in deterministic daily brief when it's the sole item)
  const garafoloTweetCardHtml = newsHtml.split('class="brief-card')[1] || '';
  assert.equal((garafoloTweetCardHtml.match(/Mike Garafolo/g) || []).length, 1, 'Tweeter name must appear ONLY ONCE on tweet card');
  assert.ok(!newsHtml.includes('Tweet • @'), 'Redundant Tweet • @handle pill must be removed');
  assert.ok(!newsHtml.includes('Linked Story:'), 'Redundant X profile Linked Story pill must be removed');
  assert.ok(!newsHtml.includes('espn.com/nfl/player/'), 'Tweet link must NEVER point to an ESPN player profile page');
  assert.ok(newsHtml.includes('https://x.com/search?q=from%3AMikeGarafolo'), 'Legacy ESPN-bio tweet URL must upgrade to targeted X original-tweet lookup');

  // Verify live data/news.json and data/roster.json have 0 tweets pointing to espn.com/nfl/player/
  const liveNewsFeed = JSON.parse(fs.readFileSync(path.join(rootDir, 'data', 'news.json'), 'utf8'));
  const espnBioTweets = (liveNewsFeed.rawStream || []).filter(
    it => (it.type === 'tweet' || it.type === 'social') && /espn\.com\/nfl\/player\//i.test(String(it.url || ''))
  );
  assert.equal(espnBioTweets.length, 0, `Expected 0 tweets in news.json pointing to ESPN player profiles, found ${espnBioTweets.length}`);
  const directXStatusCount = (liveNewsFeed.rawStream || []).filter(
    it => it.type === 'tweet' && /^https:\/\/x\.com\/[A-Za-z0-9_]+\/status\/\d+/i.test(String(it.url || ''))
  ).length;
  assert.ok(directXStatusCount >= 5, `Expected >=5 direct x.com/<handle>/status/<id> tweets in news.json, got ${directXStatusCount}`);

  const settingsHtml = renderSettingsSheetHtml({
    userPrefs: { podFormat: 'two_host', defaultPodDurationMin: 5, disabledReporterIds: [], disabledOutlets: [] },
    reportersData: { reporters: [], outlets: [] }
  });
  assert.ok(settingsHtml.includes('data-action="set-pod-format"'), 'Host Format toggle must live inside Settings');
  assert.ok(settingsHtml.includes('id="prefPodDurationSlider"'), 'Default Podcast Length slider must live inside Settings');

  // 5. Editorial Balance QA: Injury prioritization NEVER completely excludes major non-injury breaking news
  //    (arrests / suspensions / trades), credible insider trade rumors, or fun & salient player interviews!
  const balancedNow = koMs + 16 * 3600_000; // Monday morning inside 48h post-game window

  // 5a. Major breaking non-injury news (e.g., arrest / suspension / trade) ranks #1 even during 48h post-game window
  const arrestVsInjuries = sortNewsWithBreakingPriority(
    [
      {
        id: 'inj_lenoir_mri',
        type: 'tweet',
        author: 'Nick Wagoner',
        trustTier: 1,
        category: 'injury',
        title: 'Kyle Shanahan said CB Deommodore Lenoir underwent an MRI on his foot and is day-to-day.',
        fullText: 'Kyle Shanahan said CB Deommodore Lenoir underwent an MRI on his foot and is day-to-day.',
        publishedAt: new Date(balancedNow - 45 * 60_000).toISOString()
      },
      {
        id: 'major_legal_breaking',
        type: 'tweet',
        author: 'Adam Schefter',
        trustTier: 1,
        category: 'beat',
        title: '49ers reserve defender was arrested early Monday morning and is under NFL investigation, per league source.',
        fullText: '49ers reserve defender was arrested early Monday morning and is under NFL investigation, per league source.',
        publishedAt: new Date(balancedNow - 15 * 60_000).toISOString()
      }
    ],
    balancedNow,
    { appData: postGameSchedule }
  );
  assert.equal(arrestVsInjuries[0].id, 'major_legal_breaking', 'Fresh major arrest/legal breaking news must rank #1 even in 48h post-game window');
  assert.equal(arrestVsInjuries[0].breakingBadge, 'BREAKING');

  // 5b. Credible Tier-1 trade rumor gets TRADE INTEL elevation while clickbait mock trade remains blocked
  const credibleRumorCls = classifyBreakingItem(
    {
      type: 'tweet',
      author: 'Matt Barrows',
      trustTier: 1,
      title: '49ers have held trade discussions and are making calls on edge rusher depth ahead of Tuesday’s deadline.',
      publishedAt: new Date(balancedNow - 20 * 60_000).toISOString()
    },
    balancedNow,
    ctx48
  );
  assert.equal(credibleRumorCls.isBreaking, true);
  assert.equal(credibleRumorCls.breakingBadge, 'TRADE INTEL');
  assert.ok(credibleRumorCls.breakingPriority >= 2.2, `Expected credible trade rumor priority >= 2.2, got ${credibleRumorCls.breakingPriority}`);

  const mockTradeNoise = scoreContentSignal(
    'Wild blockbuster mock trade proposal sends 3 first-round picks!!',
    'Hypothetical trade pitch for fun'
  );
  assert.equal(mockTradeNoise.isClickbait, true, 'Clickbait mock trade proposals must still be rejected');

  // 5c. Salient player 1-on-1 locker-room interview scores strong signal AND surfaces in Top 3 alongside injuries (never crowded out by 4+ injury items!)
  const interviewSignal = scoreContentSignal(
    'George Kittle 1-on-1 locker room interview: Inside DeForest Buckner’s return to San Francisco',
    'Kittle opened up about Buckner in a candid sit-down: "Having DeFo back in the huddle next to Bosa completely changes the energy in our building."'
  );
  assert.equal(interviewSignal.isClickbait, false);
  assert.ok(interviewSignal.signalScore >= 55, `Expected salient player interview signalScore >= 55, got ${interviewSignal.signalScore}`);

  const multiInjuryPlusSalientStream = sortNewsWithBreakingPriority(
    [
      {
        id: 'inj_1',
        type: 'article',
        author: 'Nick Wagoner',
        category: 'injury',
        title: 'Kyle Shanahan confirms Nick Bosa MRI clean after Week 9 win',
        publishedAt: new Date(balancedNow - 30 * 60_000).toISOString(),
        url: 'https://www.espn.com/nfl/story/_/id/1'
      },
      {
        id: 'inj_2',
        type: 'article',
        author: 'Matt Maiocco',
        category: 'injury',
        title: 'Deommodore Lenoir day-to-day after foot X-rays come back negative',
        publishedAt: new Date(balancedNow - 35 * 60_000).toISOString(),
        url: 'https://www.nbcsportsbayarea.com/nfl/2'
      },
      {
        id: 'inj_3',
        type: 'article',
        author: 'Matt Barrows',
        category: 'injury',
        title: 'Deebo Samuel hamstring strain progressing heading into Week 10',
        publishedAt: new Date(balancedNow - 40 * 60_000).toISOString(),
        url: 'https://www.espn.com/nfl/story/_/id/3'
      },
      {
        id: 'inj_4',
        type: 'article',
        author: 'David Lombardi',
        category: 'injury',
        title: 'Renardo Green back strain considered minor by Shanahan',
        publishedAt: new Date(balancedNow - 45 * 60_000).toISOString(),
        url: 'https://www.espn.com/nfl/story/_/id/4'
      },
      {
        id: 'kittle_interview',
        type: 'article',
        author: 'Matt Maiocco',
        category: 'beat',
        signalScore: interviewSignal.signalScore,
        title: 'George Kittle 1-on-1 locker room interview on DeForest Buckner’s return and Week 10 mindset',
        summary: 'Kittle opened up about Buckner in a candid sit-down: "Having DeFo back in the huddle completely changes the energy."',
        publishedAt: new Date(balancedNow - 50 * 60_000).toISOString(),
        url: 'https://www.nbcsportsbayarea.com/nfl/kittle-1on1'
      }
    ],
    balancedNow,
    { appData: postGameSchedule }
  );
  const balancedFeed = balanceFeedTopSalience(deduplicateAndGroupWireItems(multiInjuryPlusSalientStream), {
    nowMs: balancedNow,
    appData: postGameSchedule,
    maxConsecutiveInjuries: 2
  });
  assert.equal(balancedFeed.length, 5, 'All 5 stories (4 distinct injuries + 1 interview) must remain in feed');
  const top3Ids = balancedFeed.slice(0, 3).map(x => x.id);
  assert.ok(
    top3Ids.includes('kittle_interview'),
    `Salient player interview must surface in Top 3 instead of being buried behind 4 consecutive injury items; got ${JSON.stringify(top3Ids)}`
  );
});

test('Completed-game play-likelihood articles & AI synthesis briefs are demoted to bottom during game and hidden once game completes; Schedule Previous Games starts collapsed', () => {
  const wk9KoIso = '2026-11-08T21:25:00Z';
  const wk9KoMs = Date.parse(wk9KoIso);
  const wk10KoIso = '2026-11-15T21:25:00Z';

  const makeMockAppData = wk9Completed => ({
    meta: { seasonYear: 2026, currentWeek: wk9Completed ? 10 : 9, teamRecord: wk9Completed ? '7-1' : '6-1' },
    scheduleMatchup: {
      schedule: [
        {
          id: 'g1',
          week: 1,
          dateIso: '2026-09-11T00:35:00Z',
          completed: true,
          statusDetail: 'Final',
          result: 'W',
          sfScore: 27,
          oppScore: 7,
          homeAway: 'away',
          opponent: { abbr: 'LAR', name: 'Los Angeles Rams', record: '5-4' },
          venue: { name: 'Melbourne Cricket Ground', city: 'Melbourne', surface: 'Natural Grass', isInternational: true }
        },
        {
          id: 'g9',
          week: 9,
          dateIso: wk9KoIso,
          completed: wk9Completed,
          statusDetail: wk9Completed ? 'Final' : 'Q3 11:05',
          result: wk9Completed ? 'W' : null,
          sfScore: wk9Completed ? 38 : 21,
          oppScore: wk9Completed ? 17 : 10,
          homeAway: 'home',
          opponent: { abbr: 'LV', name: 'Las Vegas Raiders', record: '4-5' },
          venue: { name: "Levi's Stadium", city: 'Santa Clara', surface: 'Grass', isInternational: false }
        },
        {
          id: 'g10',
          week: 10,
          dateIso: wk10KoIso,
          completed: false,
          statusDetail: '11/15 - 4:25 PM EST',
          result: null,
          sfScore: null,
          oppScore: null,
          homeAway: 'away',
          opponent: { abbr: 'DAL', name: 'Dallas Cowboys', record: '4-5' },
          venue: { name: 'AT&T Stadium', city: 'Arlington', surface: 'Synthetic Turf', isInternational: false }
        }
      ],
      upcomingMatchup: wk9Completed
        ? { week: 10, oppAbbr: 'DAL', oppName: 'Dallas Cowboys', kickoffIso: wk10KoIso }
        : { week: 9, oppAbbr: 'LV', oppName: 'Las Vegas Raiders', kickoffIso: wk9KoIso, liveState: 'in', isGameInProgress: true }
    }
  });

  const sampleItems = [
    {
      id: 'brk_evans_wk9',
      type: 'tweet',
      author: 'Mike Garafolo',
      title: `BREAKING: Evans (Achilles), who won't play in Sunday's Week 9 game against the Raiders, appears questionable at best for next week.`,
      fullText: `Evans (Achilles), who won't play in Sunday's Week 9 game against the Raiders, appears questionable at best for next week. Christian Kirk was placed on IR on Saturday.`,
      url: 'https://x.com/MikeGarafolo/status/1999999999999999991',
      publishedAt: new Date(wk9KoMs - 6 * 3600_000).toISOString(),
      isBreaking: true,
      breakingBadge: 'BREAKING'
    },
    {
      id: 'inactives_wk9_art',
      type: 'article',
      author: '49ers.com Staff',
      title: 'Bosa, Sigle Active vs. Raiders; Inactives Week 9 #LVvsSF',
      summary: 'Take a look at players who have been ruled out for the San Francisco 49ers Week 9 matchup.',
      url: 'https://www.49ers.com/news/bosa-sigle-active-vs-raiders-inactives-week-9-lvvssf',
      publishedAt: new Date(wk9KoMs - 85 * 60_000).toISOString(),
      isBreaking: true,
      breakingBadge: 'BREAKING'
    },
    {
      id: 'normal_feature_pre',
      type: 'article',
      author: 'Matt Barrows',
      title: 'How DeForest Buckner trade reshaped the 49ers defensive room',
      summary: 'Inside the locker room reaction.',
      url: 'https://www.espn.com/nfl/story/_/id/501/buckner-room',
      publishedAt: new Date(wk9KoMs - 20 * 3600_000).toISOString()
    },
    {
      id: 'kirk_ir_tx',
      type: 'tweet',
      author: 'David Lombardi',
      title: 'The 49ers placed WR Christian Kirk (knee) on injured reserve Saturday.',
      fullText: 'The 49ers placed WR Christian Kirk (knee) on injured reserve Saturday.',
      url: 'https://x.com/LombardiHimself/status/1999999999999999992',
      publishedAt: new Date(wk9KoMs - 24 * 3600_000).toISOString()
    },
    {
      id: 'halton_postgame_inj',
      type: 'article',
      author: 'Nick Wagoner',
      title: '49ers lose DT Gracen Halton to season-ending ankle fracture',
      summary: 'Halton suffered a broken left ankle late in the fourth quarter against the Raiders.',
      url: 'https://www.espn.com/nfl/story/_/id/50428583/halton',
      publishedAt: new Date(wk9KoMs + 5 * 3600_000).toISOString()
    },
    {
      id: 'wk10_dallas_status',
      type: 'tweet',
      author: 'Matt Barrows',
      title: 'Renardo Green (back) and Deommodore Lenoir (foot) both suffered injuries today. Kyle Shanahan said neither has been ruled out for Dallas next week.',
      fullText: 'Renardo Green (back) and Deommodore Lenoir (foot) both suffered injuries today. Kyle Shanahan said neither has been ruled out for Dallas next week.',
      url: 'https://bsky.app/profile/mattbarrows.bsky.social/post/3mztrviaqec27',
      publishedAt: new Date(wk9KoMs + 4 * 3600_000).toISOString()
    }
  ];

  // A. During Week 9 Game (after kickoff): Mike Evans won't play & Inactives drop BELOW normal 0-priority feature articles!
  const inGameData = makeMockAppData(false);
  const duringGameNow = wk9KoMs + 90 * 60_000;
  const inGameRanked = sortNewsWithBreakingPriority(
    sampleItems.slice(0, 4),
    duringGameNow,
    { appData: inGameData }
  );
  const featureIdx = inGameRanked.findIndex(x => x.id === 'normal_feature_pre');
  const evansIdx = inGameRanked.findIndex(x => x.id === 'brk_evans_wk9');
  const inactIdx = inGameRanked.findIndex(x => x.id === 'inactives_wk9_art');
  assert.ok(evansIdx > featureIdx && inactIdx > featureIdx, 'Pre-game availability items must rank much lower than normal articles once game starts');
  assert.equal(inGameRanked[evansIdx].isBreaking, false);
  assert.equal(inGameRanked[evansIdx].breakingBadge, null);

  // B. After Week 9 Completes: Pre-game availability articles/tweets AND AI synthesis briefs for Week 9 are hidden!
  const postGameData = makeMockAppData(true);
  const postGameNow = wk9KoMs + 10 * 3600_000;
  assert.equal(isPreGamePlayAvailabilityItem(sampleItems[0]), true);
  assert.equal(isStaleCompletedGameAvailabilityItem(sampleItems[0], postGameData, postGameNow), true);
  assert.equal(isStaleCompletedGameAvailabilityItem(sampleItems[1], postGameData, postGameNow), true);
  assert.equal(isStaleCompletedGameAvailabilityItem(sampleItems[3], postGameData, postGameNow), false, 'Permanent IR placement must remain visible');
  assert.equal(isStaleCompletedGameAvailabilityItem(sampleItems[4], postGameData, postGameNow), false, 'Post-game season-ending injury must remain visible');
  assert.equal(isStaleCompletedGameAvailabilityItem(sampleItems[5], postGameData, postGameNow), false, 'Post-game injury + Week 10 Dallas status must remain visible');

  const postFiltered = filterOutCompletedGameAvailabilityItems(sampleItems, postGameData, postGameNow);
  assert.ok(!postFiltered.some(x => x.id === 'brk_evans_wk9' || x.id === 'inactives_wk9_art'));
  assert.equal(postFiltered.length, 4);

  // AI Synthesized Clusters & Analyses check (both in-game demotion and post-game hiding + sourceLinks/heroImage scrub)
  const sampleClusters = [
    {
      id: 'cluster_bosa_buckner_week9',
      publishedAt: new Date(wk9KoMs - 3 * 3600_000).toISOString(),
      category: 'film',
      categoryLabel: 'Trench & Health Briefing',
      headline: 'Nick Bosa & Christian McCaffrey Cleared for Week 9 vs. Raiders',
      sourceLinks: [{ title: 'Official Injury Report', url: 'https://www.49ers.com/team/injury-report/' }]
    },
    {
      id: 'cluster_matchup_wk10',
      publishedAt: new Date(wk9KoMs + 5 * 3600_000).toISOString(),
      category: 'scheme',
      categoryLabel: 'Week 10 Matchup Briefing',
      headline: 'Week 10 Preparation: 49ers (7-1) Shift Focus to Dallas Cowboys (4-5)',
      heroImageUrl: 'https://static.clubs.nfl.com/inactives-wk9.png',
      heroImageAlt: 'Bosa, Sigle Active vs. Raiders; Inactives Week 9 #LVvsSF',
      heroImageLink: 'https://www.49ers.com/news/bosa-sigle-active-vs-raiders-inactives-week-9-lvvssf',
      heroImageIsEditorial: true,
      sourceLinks: [
        {
          title: '49ers Receive Injury Update on Mike Evans Before Raiders Game',
          url: 'https://heavy.com/sports/nfl/san-francisco-49ers/mike-evans-injury-update-raiders-game/',
          publishedAt: new Date(wk9KoMs - 7 * 3600_000).toISOString()
        },
        {
          title: 'Dallas Cowboys vs. 49ers Week 10 Gamecast — ESPN',
          url: 'https://www.espn.com/nfl/game/_/gameId/401873063/49ers-cowboys'
        }
      ]
    }
  ];

  assert.equal(isActiveInGameAvailabilityCluster(sampleClusters[0], inGameData, duringGameNow), true);
  const inGameClusters = filterAndCleanSynthesisClusters([sampleClusters[0], sampleClusters[1]], inGameData, duringGameNow);
  assert.equal(inGameClusters[inGameClusters.length - 1].id, 'cluster_bosa_buckner_week9', 'Pre-game availability AI cluster must sink to bottom during live game');

  assert.equal(isCompletedGameAvailabilityCluster(sampleClusters[0], postGameData, postGameNow), true);
  assert.equal(isCompletedGameAvailabilityCluster(sampleClusters[1], postGameData, postGameNow), false);
  const postGameClusters = filterAndCleanSynthesisClusters(sampleClusters, postGameData, postGameNow);
  assert.equal(postGameClusters.length, 1, 'Completed-game availability AI cluster must be hidden after game completes');
  assert.equal(postGameClusters[0].id, 'cluster_matchup_wk10');
  assert.equal(postGameClusters[0].sourceLinks.length, 1, 'Stale Week 9 Mike Evans sourceLink must be scrubbed from Week 10 cluster');
  assert.equal(postGameClusters[0].heroImageUrl, '', 'Stale Week 9 Inactives hero graphic must be scrubbed from Week 10 cluster');

  // C. Schedule View: Previous Games box starts collapsed; default list only contains current & future games
  const schedCollapsedHtml = renderSeasonMatchupViewHtml({
    seasonSub: 'schedule',
    activePhases: ['YEAR_ROUND', 'IN_SEASON'],
    appData: postGameData,
    activeVideosSet: new Set(),
    schedulePrevExpanded: false
  });
  assert.ok(
    schedCollapsedHtml.includes('<h2 class="card-title">2026 Season</h2>') &&
      !schedCollapsedHtml.includes('Current &amp; Upcoming Slate') &&
      !schedCollapsedHtml.includes('Venue Tracker'),
    'Schedule header must be streamlined to "2026 Season" without redundant eyebrow or venue-tracker title'
  );
  assert.ok(
    schedCollapsedHtml.includes('data-schedule-previous-games') &&
      !schedCollapsedHtml.includes('data-schedule-previous-games open'),
    'Previous Games box must render and start collapsed (without open attribute)'
  );
  const prevBoxIdx = schedCollapsedHtml.indexOf('data-schedule-previous-list');
  const upcomingBoxIdx = schedCollapsedHtml.indexOf('data-schedule-upcoming-list');
  assert.ok(prevBoxIdx > -1 && upcomingBoxIdx > prevBoxIdx, 'Schedule must separate Previous Games box from Upcoming list');
  const upcomingSlice = schedCollapsedHtml.slice(upcomingBoxIdx);
  assert.ok(upcomingSlice.includes('Dallas Cowboys') && upcomingSlice.includes('WK 10'), 'Upcoming list must render Week 10 Cowboys');
  assert.ok(!upcomingSlice.includes('Las Vegas Raiders') && !upcomingSlice.includes('Los Angeles Rams'), 'Upcoming list must NOT include completed games');

  const schedExpandedHtml = renderSeasonMatchupViewHtml({
    seasonSub: 'schedule',
    activePhases: ['YEAR_ROUND', 'IN_SEASON'],
    appData: postGameData,
    activeVideosSet: new Set(),
    schedulePrevExpanded: true
  });
  assert.ok(schedExpandedHtml.includes('data-schedule-previous-games open'), 'schedulePrevExpanded=true must render open attribute');
});

test('Keenan Allen trade deadline acquisition & multi-source roster reconciliation prevent 49ers.com HTML lag from dropping new acquisitions', () => {
  // 1. Verify resolveAuthoritativeRosterPlayerStatus includes ESPN Active-53 / Depth Chart additions (Keenan Allen) when 49ers.com HTML lags
  const depthIds = new Set(['15818', '4360438']);
  const allenStatus = resolveAuthoritativeRosterPlayerStatus({
    espnId: '15818',
    fullName: 'Keenan Allen',
    groupKey: 'offense',
    espnDefaultBucket: 'active',
    offRosRec: null,
    officialRosterHasData: true,
    txRec: null,
    depthChartIds: depthIds,
    recentNewsText: "49ers trade for Colts' Keenan Allen to bolster injury-plagued WR room"
  });
  assert.equal(allenStatus.include, true, 'Keenan Allen must be included when on ESPN Active 53 & Depth Chart despite 49ers.com HTML lag');
  assert.equal(allenStatus.bucket, 'active');

  // 2. Verify uncorroborated non-active practice squad ghost (Vincent Anthony Jr.) and injury-settlement release (Brett Toth) remain excluded
  const ghostStatus = resolveAuthoritativeRosterPlayerStatus({
    espnId: '4875123',
    fullName: 'Vincent Anthony Jr.',
    groupKey: 'practiceSquad',
    espnDefaultBucket: 'practice_squad',
    offRosRec: null,
    officialRosterHasData: true,
    txRec: null,
    depthChartIds: depthIds
  });
  assert.equal(ghostStatus.include, false, 'Uncorroborated non-active PS ghost must remain excluded');

  const tothStatus = resolveAuthoritativeRosterPlayerStatus({
    espnId: '3129116',
    fullName: 'Brett Toth',
    groupKey: 'injuredReserveOrOut',
    espnDefaultBucket: 'ir',
    offRosRec: null,
    officialRosterHasData: true,
    txRec: { releasedInjurySettlement: true, latestRosterMoveBucket: 'released' },
    depthChartIds: depthIds
  });
  assert.equal(tothStatus.include, false, 'Injury-settlement release must remain excluded');

  // 3. Verify analyzeTeamTransactions parses trade acquisitions, waiver claims, left-squad reinstatements, and Ogbonnia/Ogbo Okoronkwo alias
  assert.equal(canonicalPlayerKey('Ogbonnia Okoronkwo'), canonicalPlayerKey('Ogbo Okoronkwo'));
  const txParsed = analyzeTeamTransactions(
    [
      { date: '2026-10-23T08:00Z', description: 'Released DL Ogbo Okoronkwo.' },
      { date: '2026-10-24T08:00Z', description: 'Signed DE Ogbonnia Okoronkwo to the practice squad.' },
      { date: '2026-11-09T08:00Z', description: 'Reinstated WR Brandon Aiyuk from the reserve/left squad list.' },
      { date: '2026-11-10T18:00Z', description: 'Acquired WR Keenan Allen from Indianapolis for a 2027 sixth-round draft pick.' }
    ],
    2026
  );
  assert.equal(txParsed.byKey.get(canonicalPlayerKey('Ogbo Okoronkwo'))?.latestRosterMoveBucket, 'practice_squad');
  assert.ok(txParsed.byKey.get(canonicalPlayerKey('Brandon Aiyuk'))?.reinstatedFromLeftSquadDate);
  assert.equal(txParsed.byKey.get(canonicalPlayerKey('Keenan Allen'))?.acquiredViaTrade, true);
  assert.equal(txParsed.byKey.get(canonicalPlayerKey('Keenan Allen'))?.latestRosterMoveBucket, 'active');

  // 4. Verify live data files contain Keenan Allen across Roster, Cap, Depth Chart, and Completed Trades
  const roster = JSON.parse(fs.readFileSync(path.join(rootDir, 'data', 'roster.json'), 'utf8'));
  const cap = JSON.parse(fs.readFileSync(path.join(rootDir, 'data', 'cap.json'), 'utf8'));
  const depth = JSON.parse(fs.readFileSync(path.join(rootDir, 'data', 'depth-chart.json'), 'utf8'));
  const seasonal = JSON.parse(fs.readFileSync(path.join(rootDir, 'data', 'seasonal.json'), 'utf8'));

  const allenRos = roster.players.find(p => p.name === 'Keenan Allen');
  assert.ok(allenRos, 'Keenan Allen must exist in data/roster.json');
  assert.equal(allenRos.id, '15818');
  assert.equal(allenRos.position, 'WR');
  assert.equal(allenRos.rosterBucket, 'active');
  assert.ok(allenRos.capHit2026 > 0, `Keenan Allen must have non-zero 2026 cap hit from OTC fallback, got ${allenRos.capHit2026}`);
  assert.ok(allenRos.primarySnapPct > 0, `Keenan Allen must retain 2026 regular-season snap share, got ${allenRos.primarySnapPct}%`);
  assert.ok((allenRos.stats2026?.receiving?.receptions || 0) >= 40, 'Keenan Allen 2026 receiving stats must be populated');
  assert.equal(allenRos.statProfile2026?.hasActiveStats, true, 'Keenan Allen statProfile2026 must be active');

  const allenCap = cap.players.find(p => p.name === 'Keenan Allen');
  assert.ok(allenCap && allenCap.otcId === '2227', 'Keenan Allen must appear in data/cap.json with OTC ID 2227');

  const wr3Row = depth.units[0]?.rows?.find(r => r.slotKey === 'wr3');
  assert.ok(wr3Row?.baselineChain?.some(c => c.name === 'Keenan Allen'), 'Keenan Allen must appear on 49ers depth chart (wr3)');

  const allenTrade = seasonal.tradeWarRoom?.completed2026Moves?.find(m => m.player === 'Keenan Allen');
  assert.ok(allenTrade && allenTrade.acquiredFrom === 'IND', 'Keenan Allen trade from IND must appear in completed2026Moves');

  // 5. Verify live browser client reconcileLiveEspnSfRosterAndDepthChart dynamically injects newly traded players between static builds
  const mockClientAppData = {
    roster: {
      count: 1,
      peerDirectory: {
        '00-0099999': {
          name: 'Future Trade Target',
          team: 'NYJ',
          pos: 'WR',
          espnUrl: 'https://www.espn.com/nfl/player/_/id/9999999',
          pfrUrl: 'https://www.pro-football-reference.com/players/T/TargFu00.htm',
          pfrGames: 8
        }
      },
      players: [
        { id: '4361741', name: 'Brock Purdy', position: 'QB', unit: 'Offense', rosterBucket: 'active', jersey: 13, health: { playProbabilityPct: 99, playBadgeLabel: '99% • Full Go' } }
      ]
    },
    depthChart: {
      units: [
        {
          id: '1',
          unitName: 'Offense (11 & 21 Personnel)',
          rows: [{ slotKey: 'wr1', slotLabel: 'WR (X)', baselineChain: [], projectedActiveChain: [] }]
        }
      ]
    }
  };
  const mutatedClient = reconcileLiveEspnSfRosterAndDepthChart(
    mockClientAppData,
    {
      athletes: [
        {
          position: 'offense',
          items: [{ id: '9999999', fullName: 'Future Trade Target', displayName: 'Future Trade Target', position: { abbreviation: 'WR' }, age: 26 }]
        },
        {
          position: 'practiceSquad',
          items: [{ id: '4875123', fullName: 'Vincent Anthony Jr.', displayName: 'Vincent Anthony Jr.', position: { abbreviation: 'DE' } }]
        }
      ]
    },
    {
      depthchart: [
        {
          id: '1',
          name: '3WR 1TE',
          positions: { wr1: { athletes: [{ id: '9999999', displayName: 'Future Trade Target' }] } }
        }
      ]
    },
    []
  );
  assert.equal(mutatedClient, true);
  assert.ok(mockClientAppData.roster.players.some(p => p.name === 'Future Trade Target' && p.gsisId === '00-0099999'));
  assert.ok(!mockClientAppData.roster.players.some(p => p.name === 'Vincent Anthony Jr.'), 'Client roster sync must still block known PS ghost');
  assert.equal(mockClientAppData.depthChart.units[0].rows[0].baselineChain[0]?.name, 'Future Trade Target');
});

await testAsync('Resilient fetchJsonSafe retries transient iOS Load failed socket drops and falls back to CacheStorage', async () => {
  const { fetchJsonSafe } = await import('../src/services/dataService.js');
  const origFetch = globalThis.fetch;
  const origCaches = globalThis.caches;

  try {
    // 1. Transient WebKit `TypeError: Load failed` on attempt 1 recovers automatically on attempt 2
    let calls = 0;
    globalThis.fetch = async (_url, init) => {
      calls += 1;
      if (calls === 1) {
        assert.equal(init?.cache, 'no-cache');
        throw new TypeError('Load failed');
      }
      assert.equal(init?.cache, 'default', 'Retry must allow HTTP/SW cache fallback');
      return new Response(JSON.stringify({ ok: true, recoveredOnAttempt: calls }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    };

    const recovered = await fetchJsonSafe('./data/meta.json', { maxAttempts: 3, timeoutMs: 2000, allowGithubRawFallback: false });
    assert.equal(recovered.ok, true);
    assert.equal(recovered.recoveredOnAttempt, 2);

    // 2. Total network outage falls back cleanly to CacheStorage when cached copy exists
    globalThis.fetch = async () => {
      throw new TypeError('Load failed');
    };
    globalThis.caches = {
      match: async url =>
        String(url).includes('roster.json')
          ? new Response(JSON.stringify({ players: [{ name: 'Brock Purdy' }] }), { status: 200 })
          : null
    };

    const fromCache = await fetchJsonSafe('./data/roster.json', { maxAttempts: 2, timeoutMs: 1000, allowGithubRawFallback: false });
    assert.equal(fromCache.players?.[0]?.name, 'Brock Purdy');
  } finally {
    globalThis.fetch = origFetch;
    if (origCaches === undefined) delete globalThis.caches;
    else globalThis.caches = origCaches;
  }
});

await testAsync('Opponent 4-card Health Summary accurately subtracts Doubtful/GTD starters, excludes ST returners, and defines Availability Index glossary', async () => {
  const {
    computeTeamHealthSummary,
    isEffectiveOffDefStarter,
    select22OffDefStartersFromDepthChart
  } = await import('../src/engine/injuryProbabilityModel.js');

  // Verify glossary entries for Availability Index & Starters Cleared
  const availGlossary = getJargonEntry('availability_index');
  const clearedGlossary = getJargonEntry('starters_cleared');
  assert.ok(availGlossary?.term.includes('Availability Index') && availGlossary.definition.includes('22'));
  assert.ok(clearedGlossary?.term.includes('Starters Cleared'));

  // Verify ST returners (KR/PR with <35% WR snaps like KaVontae Turpin 27%) are NOT miscounted as Off/Def starters
  assert.equal(isEffectiveOffDefStarter({ name: 'KaVontae Turpin', position: 'WR', snapPct: 27, isStarter: true }), false);
  assert.equal(isEffectiveOffDefStarter({ name: 'Brandon Aubrey', position: 'PK', snapPct: 40, isStarter: true }), false);
  assert.equal(isEffectiveOffDefStarter({ name: 'P.J. Locke', position: 'S', snapPct: 53, isStarter: true }), true);
  assert.equal(isEffectiveOffDefStarter({ name: 'Jake Ferguson', position: 'TE', snapPct: 56, isStarter: true }), true);

  // Verify depth chart selector caps at <=22 Off+Def starters and ignores Special Teams
  const mockDepth = [
    {
      name: '3WR 1TE',
      positions: {
        qb: { athletes: [{ displayName: 'Dak Prescott' }] },
        rb: { athletes: [{ displayName: 'Javonte Williams' }] },
        fb: { athletes: [{ displayName: 'Hunter Luepke' }] },
        wr1: { athletes: [{ displayName: 'CeeDee Lamb' }] },
        wr2: { athletes: [{ displayName: 'George Pickens' }] },
        wr3: { athletes: [{ displayName: 'Ryan Flournoy' }] },
        te: { athletes: [{ displayName: 'Jake Ferguson' }] },
        lt: { athletes: [{ displayName: 'Tyler Guyton' }] },
        lg: { athletes: [{ displayName: 'Tyler Smith' }] },
        c: { athletes: [{ displayName: 'Cooper Beebe' }] },
        rg: { athletes: [{ displayName: 'Tyler Booker' }] },
        rt: { athletes: [{ displayName: 'Terence Steele' }] }
      }
    },
    {
      name: 'Special Teams',
      positions: {
        pk: { athletes: [{ displayName: 'Brandon Aubrey' }] },
        kr: { athletes: [{ displayName: 'KaVontae Turpin' }] }
      }
    }
  ];
  const snapLookup = nk => (nk === 'ryanflournoy' ? 76 : nk === 'hunterluepke' ? 62 : 80);
  const selected = select22OffDefStartersFromDepthChart(mockDepth, snapLookup);
  assert.equal(selected.offStarterNames.size, 11, 'Must pick exact 11 offensive starters (resolving WR3 76% over FB 62%)');
  assert.equal(selected.allStarterNames.has('kavontaeturpin'), false, 'KR must never be marked starter');
  assert.equal(selected.allStarterNames.has('brandonaubrey'), false, 'PK must never be marked starter');

  // Verify Dallas scenario: 6 starters on injury report (3 Doubtful/Long Shot + 3 GTD) => 16/22 Starters Cleared (NEVER 22/22!)
  const dallasSummary = computeTeamHealthSummary({
    injuryReport: [
      { name: 'P.J. Locke', position: 'S', snapPct: 53, isStarter: true, gameStatus: 'Questionable', playProbabilityPct: 18 },
      { name: 'Tyler Goodson', position: 'RB', snapPct: 20, isStarter: false, gameStatus: 'Questionable', playProbabilityPct: 35 },
      { name: 'Jake Ferguson', position: 'TE', snapPct: 56, isStarter: true, gameStatus: 'Questionable', playProbabilityPct: 44 },
      { name: 'Donovan Ezeiruaku', position: 'LB', snapPct: 65, isStarter: true, gameStatus: 'Questionable', playProbabilityPct: 45 },
      { name: 'Luke Schoonmaker', position: 'TE', snapPct: 51, isStarter: false, gameStatus: 'Questionable', playProbabilityPct: 73 },
      { name: 'Joey Porter Jr.', position: 'CB', snapPct: 54, isStarter: true, gameStatus: 'Questionable', playProbabilityPct: 76 },
      { name: 'George Pickens', position: 'WR', snapPct: 78, isStarter: true, gameStatus: 'Questionable', playProbabilityPct: 77 },
      { name: 'DeMarvion Overshown', position: 'LB', snapPct: 71, isStarter: true, gameStatus: 'Questionable', playProbabilityPct: 77 }
    ],
    irReserve: [
      { name: 'Jalen Thompson', position: 'S', snapPct: 81, isPracticeWindowOpen: true },
      { name: 'Malik Davis', position: 'RB', isSeasonEnding: true }
    ],
    totalStarters: 22
  });
  assert.equal(dallasSummary.activeStartersHealthy, 16, 'Expected 16/22 starters cleared when 6 starters carry Doubtful/GTD tags');
  assert.equal(dallasSummary.startersDoubtfulCount, 3);
  assert.equal(dallasSummary.startersQuestionableCount, 3);
  assert.equal(dallasSummary.questionableOrDoubtfulCount, 8);
  assert.equal(dallasSummary.doubtfulOrLongShotCount, 4);
  assert.equal(dallasSummary.gtdCount, 4);
  assert.equal(dallasSummary.irOpenWindowCount, 1);

  // Also verify live schedule-matchup.json has 100% parity between injured starters and activeStartersHealthy
  const liveSched = JSON.parse(fs.readFileSync(path.join(rootDir, 'data', 'schedule-matchup.json'), 'utf8'));
  const liveOh = liveSched.upcomingMatchup?.opponentHealth;
  const expectedLiveSummary = computeTeamHealthSummary({
    injuryReport: liveOh?.injuryReport || [],
    irReserve: liveOh?.irReserve || [],
    totalStarters: liveOh?.summary?.totalStarters || 22
  });
  assert.equal(liveOh.summary.activeStartersHealthy, expectedLiveSummary.activeStartersHealthy);
});

await testAsync('3-Stage AI Analysis & Auto Podcast timer allocator progresses across all 3 bars and fits 3m pod in 1 TTS pass', async () => {
  const { computeLiveStageProgressState } = await import('../src/services/aiWorkerClient.js');
  const { chunkTurnsForGeminiTts } = await import('../src/engine/geminiStudioPrompts.js');

  // Analysis timer spends appreciable time across Step 1 (0-10s), Step 2 (10-24s), and Step 3 (24s+)
  const aStep1 = computeLiveStageProgressState({ kind: 'analysis', elapsedMs: 5000 });
  const aStep2 = computeLiveStageProgressState({ kind: 'analysis', elapsedMs: 16000 });
  const aStep3 = computeLiveStageProgressState({ kind: 'analysis', elapsedMs: 28000 });
  assert.equal(aStep1.stepIdx, 1);
  assert.ok(aStep1.stagePercents[0] >= 40 && aStep1.stagePercents[1] === 0);
  assert.equal(aStep2.stepIdx, 2);
  assert.ok(aStep2.stagePercents[0] === 100 && aStep2.stagePercents[1] > 30 && aStep2.stagePercents[2] === 0);
  assert.equal(aStep3.stepIdx, 3);
  assert.ok(aStep3.stagePercents[0] === 100 && aStep3.stagePercents[1] === 100 && aStep3.stagePercents[2] > 15);
  assert.ok(aStep3.percent > aStep2.percent && aStep2.percent > aStep1.percent);

  // Podcast timer spans Step 1 -> Step 2 during Research+Script, holds Step 2 until TTS starts, then advances Step 3
  const pStep1 = computeLiveStageProgressState({ kind: 'podcast', durationMinutes: 3, elapsedMs: 5000, allowAutoStage3: false });
  const pStep2 = computeLiveStageProgressState({ kind: 'podcast', durationMinutes: 3, elapsedMs: 22000, allowAutoStage3: false });
  const pStep3 = computeLiveStageProgressState({
    kind: 'podcast',
    durationMinutes: 3,
    elapsedMs: 36000,
    phaseFloor: 3,
    phase3ElapsedMs: 10000,
    ttsSubPercent: 48,
    allowAutoStage3: false
  });
  assert.equal(pStep1.stepIdx, 1);
  assert.equal(pStep2.stepIdx, 2);
  assert.equal(pStep3.stepIdx, 3);
  assert.ok(pStep3.stagePercents[2] >= 48 && pStep3.stageElapsedSec[2] === 10);

  // Verify a 3-minute (~420 word) two-host podcast fits inside ONE single 3800-char Gemini Multi-Speaker TTS block
  const threeMinTurns = Array.from({ length: 18 }, (_, i) => ({
    speaker: i % 2 === 0 ? 'Marcus' : 'Elena',
    text: "Let's look at how Keenan Allen gives Brock Purdy a veteran option route winner over the middle on third down."
  }));
  const blocks3m = chunkTurnsForGeminiTts(threeMinTurns, 3800);
  assert.equal(blocks3m.length, 1, `Expected 3-minute podcast (~400 words) to synthesize in 1 single TTS pass, got ${blocks3m.length}`);
});

test('Schedule includes Preseason (PRE 1..3), hides all past games in Previous Games bar, and handles all Postseason qualification & round-by-round states', () => {
  const liveSm = JSON.parse(fs.readFileSync(path.join(rootDir, 'data', 'schedule-matchup.json'), 'utf8'));
  const liveMeta = JSON.parse(fs.readFileSync(path.join(rootDir, 'data', 'meta.json'), 'utf8'));
  const liveSeasonal = JSON.parse(fs.readFileSync(path.join(rootDir, 'data', 'seasonal.json'), 'utf8'));

  // 1. Live schedule-matchup.json contains all 3 2026 Preseason games (PRE 1..3) + 17 Regular Season games
  const preGamesInFile = (liveSm.schedule || []).filter(g => g.seasonType === 'PRE');
  const regGamesInFile = (liveSm.schedule || []).filter(g => (g.seasonType || 'REG') === 'REG');
  assert.equal(preGamesInFile.length, 3, 'Expected 3 Preseason games in data/schedule-matchup.json');
  assert.deepEqual(
    preGamesInFile.map(g => g.weekLabel),
    ['PRE 1', 'PRE 2', 'PRE 3'],
    'Preseason games must carry PRE 1, PRE 2, PRE 3 labels'
  );
  assert.ok(preGamesInFile.every(g => g.completed && g.week < 0), '2026 Preseason games must be completed with negative week numbers');
  assert.equal(regGamesInFile.length, 17, 'Expected 17 Regular Season games in data/schedule-matchup.json');

  // 2. Scenario A: Uncertainty for making playoffs (0% < makePlayoffsPct < 99.95%, unclinched)
  //    - Completed Preseason + Completed Regular Season games are hidden inside the collapsed Previous Games bar
  //    - Zero premature Postseason game rows appear in Upcoming
  //    - Postseason Qualification Tracker renders with live probabilities
  const unclinchedAppData = {
    meta: { ...liveMeta, seasonYear: 2026, currentWeek: 10 },
    scheduleMatchup: liveSm,
    seasonal: {
      playoffPicture: {
        baselineSimulation: {
          sfOdds: { makePlayoffsPct: 68.4, winDivisionPct: 44.2, seed1ByePct: 14.5 }
        }
      }
    }
  };
  const unclinchedModel = resolveCompleteScheduleModel(unclinchedAppData);
  assert.equal(unclinchedModel.preseasonGames.length, 3);
  assert.equal(unclinchedModel.postseasonGames.length, 0, 'Unclinched team must not have premature postseason game rows');
  assert.equal(unclinchedModel.postseasonStatus.state, 'UNCLINCHED_IN_HUNT');
  assert.ok(
    unclinchedModel.previousGames.some(g => g.seasonType === 'PRE' && g.weekLabel === 'PRE 1') &&
      unclinchedModel.previousGames.some(g => g.seasonType === 'REG' && g.week === 1),
    'Both completed Preseason and completed Regular Season games must be in previousGames'
  );
  assert.ok(
    unclinchedModel.upcomingGames.every(g => !g.completed && g.seasonType === 'REG'),
    'Upcoming games while unclinched must only contain unplayed regular-season games'
  );

  const unclinchedHtml = renderSeasonMatchupViewHtml({
    seasonSub: 'schedule',
    activePhases: ['YEAR_ROUND', 'IN_SEASON'],
    appData: unclinchedAppData,
    activeVideosSet: new Set(),
    schedulePrevExpanded: false
  });
  assert.ok(
    unclinchedHtml.includes('data-schedule-previous-games') &&
      !unclinchedHtml.includes('data-schedule-previous-games open'),
    'Previous Games bar must start collapsed'
  );
  assert.ok(unclinchedHtml.includes('2-1 Pre'), 'Previous Games summary must display 2-1 Pre badge alongside regular-season record');
  assert.ok(unclinchedHtml.includes('PRE 1–3 • Wk 1–9'), 'Previous Games summary must show PRE 1–3 • Wk 1–9 range');
  assert.ok(unclinchedHtml.includes('data-schedule-postseason-tracker="unclinched"'), 'Unclinched state must render Postseason Qualification Tracker');
  assert.ok(unclinchedHtml.includes('68.4% Playoff Odds'));
  const unclinchedUpcomingSlice = unclinchedHtml.slice(unclinchedHtml.indexOf('data-schedule-upcoming-list'));
  assert.ok(!unclinchedUpcomingSlice.includes('Tennessee Titans') && !unclinchedUpcomingSlice.includes('PRE 1'), 'Completed Preseason games must be hidden inside Previous Games bar, never in Upcoming');

  // 3. Scenario B: Mathematically Eliminated (makePlayoffsPct = 0%) -> Zero postseason games and no unclinched tracker
  const eliminatedModel = resolveCompleteScheduleModel({
    meta: { seasonYear: 2026, currentWeek: 18, teamStatus: { mathematicallyEliminated: true } },
    scheduleMatchup: liveSm,
    seasonal: { playoffPicture: { baselineSimulation: { sfOdds: { makePlayoffsPct: 0, winDivisionPct: 0, seed1ByePct: 0 } } } }
  });
  assert.equal(eliminatedModel.postseasonGames.length, 0);
  assert.equal(eliminatedModel.postseasonStatus.state, 'ELIMINATED');

  // 4. Scenario C: Clinched Playoff Spot, Entry Round (1st-Round Bye vs. Wild Card) & Opponent Still Unknown
  const clinchedRoundTbdData = {
    meta: { seasonYear: 2026, currentWeek: 16, teamStatus: { clinchedPlayoffs: true } },
    scheduleMatchup: liveSm,
    seasonal: {
      playoffPicture: {
        baselineSimulation: {
          sfOdds: { makePlayoffsPct: 100, winDivisionPct: 88.5, seed1ByePct: 41.2 }
        }
      }
    }
  };
  const roundTbdModel = resolveCompleteScheduleModel(clinchedRoundTbdData);
  assert.equal(roundTbdModel.postseasonGames.length, 1);
  assert.equal(roundTbdModel.postseasonGames[0].postseasonRound, 'QUALIFIED_TBD');
  assert.equal(roundTbdModel.postseasonGames[0].opponent.name, 'NFC Playoff Opponent (TBD)');
  assert.equal(roundTbdModel.postseasonStatus.state, 'CLINCHED_ROUND_TBD');
  const roundTbdHtml = renderSeasonMatchupViewHtml({
    seasonSub: 'schedule',
    activePhases: ['YEAR_ROUND', 'IN_SEASON', 'PLAYOFF_PUSH'],
    appData: clinchedRoundTbdData,
    activeVideosSet: new Set()
  });
  assert.ok(roundTbdHtml.includes('data-postseason-state="clinched_round_tbd"'));
  assert.ok(roundTbdHtml.includes('NFC Playoff Opponent (TBD)'));

  // 5. Scenario D: Clinched Playoff Spot in Wild Card Round, Opponent Unknown (Division Winner Home vs. Wild Card Road vs. Venue TBD)
  const clinchedDivWcModel = resolveCompleteScheduleModel({
    meta: { seasonYear: 2026, currentWeek: 17, teamStatus: { clinchedDivision: true } },
    scheduleMatchup: liveSm,
    seasonal: {
      playoffPicture: {
        baselineSimulation: { sfOdds: { makePlayoffsPct: 100, winDivisionPct: 100, seed1ByePct: 0 } }
      }
    }
  });
  assert.equal(clinchedDivWcModel.postseasonGames.length, 1);
  assert.equal(clinchedDivWcModel.postseasonGames[0].postseasonRound, 'WC');
  assert.equal(clinchedDivWcModel.postseasonGames[0].homeAway, 'home');
  assert.equal(clinchedDivWcModel.postseasonGames[0].venue.name, "Levi's Stadium");
  assert.equal(clinchedDivWcModel.postseasonGames[0].opponent.name, 'NFC Wild Card Opponent (TBD)');

  const clinchedRoadWcModel = resolveCompleteScheduleModel({
    meta: { seasonYear: 2026, currentWeek: 18, playoffSeed: 6, teamStatus: { clinchedPlayoffs: true, clinchedWildCardOnly: true } },
    scheduleMatchup: liveSm,
    seasonal: {
      playoffPicture: {
        baselineSimulation: { sfOdds: { makePlayoffsPct: 100, winDivisionPct: 0, seed1ByePct: 0 } }
      }
    }
  });
  assert.equal(clinchedRoadWcModel.postseasonGames.length, 1);
  assert.equal(clinchedRoadWcModel.postseasonGames[0].postseasonRound, 'WC');
  assert.equal(clinchedRoadWcModel.postseasonGames[0].homeAway, 'away');
  assert.equal(clinchedRoadWcModel.postseasonGames[0].opponent.name, 'NFC Division Winner (TBD)');

  // 6. Scenario E: Clinched #1 NFC Seed First-Round Bye (Before Wild Card Weekend vs. After Wild Card Weekend)
  const allRegDoneSched = liveSm.schedule.map(g => ({
    ...g,
    completed: true,
    result: g.result || 'W',
    sfScore: g.sfScore ?? 28,
    oppScore: g.oppScore ?? 17
  }));
  const seed1ByePreWcData = {
    meta: {
      seasonYear: 2026,
      currentWeek: 19,
      nowMs: '2027-01-12T18:00:00Z',
      teamStatus: { clinchedSeed1Bye: true, wildCardRoundCompleted: false }
    },
    scheduleMatchup: { ...liveSm, schedule: allRegDoneSched },
    seasonal: {
      playoffPicture: {
        baselineSimulation: { sfOdds: { makePlayoffsPct: 100, winDivisionPct: 100, seed1ByePct: 100 } }
      }
    }
  };
  const byePreWcModel = resolveCompleteScheduleModel(seed1ByePreWcData);
  assert.equal(byePreWcModel.postseasonStatus.state, 'CLINCHED_FIRST_ROUND_BYE');
  assert.equal(byePreWcModel.postseasonGames.length, 2, 'Must include both WC BYE and automatic DIV qualification');
  assert.equal(byePreWcModel.postseasonGames[0].postseasonRound, 'WC_BYE');
  assert.equal(byePreWcModel.postseasonGames[0].isByeWeek, true);
  assert.equal(byePreWcModel.postseasonGames[0].completed, false);
  assert.equal(byePreWcModel.postseasonGames[1].postseasonRound, 'DIV');
  assert.equal(byePreWcModel.postseasonGames[1].homeAway, 'home');
  assert.equal(byePreWcModel.postseasonGames[1].venue.name, "Levi's Stadium");
  assert.equal(byePreWcModel.postseasonGames[1].opponent.name, 'Lowest Remaining NFC Seed (TBD)');

  const byePreWcHtml = renderSeasonMatchupViewHtml({
    seasonSub: 'schedule',
    activePhases: ['YEAR_ROUND', 'IN_SEASON'],
    appData: seed1ByePreWcData,
    activeVideosSet: new Set()
  });
  const byeUpcomingSlice = byePreWcHtml.slice(byePreWcHtml.indexOf('data-schedule-upcoming-list'));
  assert.ok(byeUpcomingSlice.includes('WC BYE') && byeUpcomingSlice.includes('First-Round Playoff Bye (#1 NFC Seed)'));
  assert.ok(byeUpcomingSlice.includes('Lowest Remaining NFC Seed (TBD)') && byeUpcomingSlice.includes('Next Up'));

  // Once Wild Card Weekend completes, WC BYE moves into Previous Games bar and DIV is at the top of Upcoming!
  const seed1ByePostWcData = {
    ...seed1ByePreWcData,
    meta: {
      ...seed1ByePreWcData.meta,
      nowMs: '2027-01-20T18:00:00Z',
      teamStatus: { clinchedSeed1Bye: true, wildCardRoundCompleted: true }
    }
  };
  const byePostWcModel = resolveCompleteScheduleModel(seed1ByePostWcData);
  assert.ok(
    byePostWcModel.previousGames.some(g => g.postseasonRound === 'WC_BYE' && g.completed),
    'Completed Wild Card Bye must move into previousGames'
  );
  assert.equal(byePostWcModel.upcomingGames.length, 1);
  assert.equal(byePostWcModel.upcomingGames[0].postseasonRound, 'DIV');

  // 7. Scenario F: Round-by-Round Postseason Progression (WC Win -> DIV -> NFC CHAMP -> SUPER BOWL, then Loss)
  // Step 1: 49ers win Wild Card vs. GB -> WC moves to previousGames, DIV arises in upcomingGames with Opponent TBD
  const afterWcWinData = {
    meta: { seasonYear: 2026, currentWeek: 20, playoffSeed: 2 },
    scheduleMatchup: {
      ...liveSm,
      schedule: [
        ...allRegDoneSched,
        {
          id: 'post_2026_wc_gb',
          seasonType: 'POST',
          postseasonRound: 'WC',
          week: 19,
          dateIso: '2027-01-17T21:30:00Z',
          completed: true,
          result: 'W',
          sfScore: 31,
          oppScore: 20,
          homeAway: 'home',
          opponent: { abbr: 'GB', name: 'Green Bay Packers', record: '10-7' },
          venue: { name: "Levi's Stadium", city: 'Santa Clara', surface: 'Natural Grass' }
        }
      ]
    }
  };
  const afterWcWinModel = resolveCompleteScheduleModel(afterWcWinData);
  assert.ok(afterWcWinModel.previousGames.some(g => g.postseasonRound === 'WC' && g.result === 'W'));
  assert.equal(afterWcWinModel.upcomingGames.length, 1);
  assert.equal(afterWcWinModel.upcomingGames[0].postseasonRound, 'DIV');
  assert.equal(afterWcWinModel.upcomingGames[0].opponent.name, 'NFC Divisional Opponent (TBD)');

  // Step 2: 49ers win Divisional vs. DET -> DIV moves to previousGames, NFC CHAMP arises in upcomingGames
  const afterDivWinData = {
    meta: { seasonYear: 2026, currentWeek: 21, teamStatus: { clinchedSeed1Bye: true } },
    scheduleMatchup: {
      ...liveSm,
      schedule: [
        ...allRegDoneSched,
        {
          id: 'post_2026_div_det',
          seasonType: 'POST',
          postseasonRound: 'DIV',
          week: 20,
          dateIso: '2027-01-24T21:30:00Z',
          completed: true,
          result: 'W',
          sfScore: 34,
          oppScore: 24,
          homeAway: 'home',
          opponent: { abbr: 'DET', name: 'Detroit Lions', record: '12-5' },
          venue: { name: "Levi's Stadium", city: 'Santa Clara', surface: 'Natural Grass' }
        }
      ]
    }
  };
  const afterDivWinModel = resolveCompleteScheduleModel(afterDivWinData);
  assert.ok(afterDivWinModel.previousGames.some(g => g.postseasonRound === 'DIV' && g.result === 'W'));
  assert.equal(afterDivWinModel.upcomingGames.length, 1);
  assert.equal(afterDivWinModel.upcomingGames[0].postseasonRound, 'CON');
  assert.equal(afterDivWinModel.upcomingGames[0].weekLabel, 'NFC CHAMP');
  assert.equal(afterDivWinModel.upcomingGames[0].homeAway, 'home');
  assert.equal(afterDivWinModel.upcomingGames[0].opponent.name, 'NFC Championship Opponent (TBD)');

  // Step 3: 49ers win NFC Championship vs. PHI -> CON moves to previousGames, SUPER BOWL arises in upcomingGames
  const afterConWinData = {
    meta: { seasonYear: 2026, currentWeek: 22, teamStatus: { clinchedSeed1Bye: true } },
    scheduleMatchup: {
      ...liveSm,
      schedule: [
        ...afterDivWinData.scheduleMatchup.schedule,
        {
          id: 'post_2026_con_phi',
          seasonType: 'POST',
          postseasonRound: 'CON',
          week: 21,
          dateIso: '2027-01-31T23:30:00Z',
          completed: true,
          result: 'W',
          sfScore: 28,
          oppScore: 21,
          homeAway: 'home',
          opponent: { abbr: 'PHI', name: 'Philadelphia Eagles', record: '13-4' },
          venue: { name: "Levi's Stadium", city: 'Santa Clara', surface: 'Natural Grass' }
        }
      ]
    }
  };
  const afterConWinModel = resolveCompleteScheduleModel(afterConWinData);
  assert.ok(afterConWinModel.previousGames.some(g => g.postseasonRound === 'CON' && g.result === 'W'));
  assert.equal(afterConWinModel.upcomingGames.length, 1);
  assert.equal(afterConWinModel.upcomingGames[0].postseasonRound, 'SB');
  assert.equal(afterConWinModel.upcomingGames[0].weekLabel, 'SUPER BOWL');
  assert.equal(afterConWinModel.upcomingGames[0].opponent.name, 'AFC Champion (TBD)');

  // Step 4: If 49ers lose a postseason round (e.g. Divisional loss), zero further rounds are synthesized
  const afterDivLossData = {
    meta: { seasonYear: 2026, currentWeek: 20, teamStatus: { clinchedSeed1Bye: true } },
    scheduleMatchup: {
      ...liveSm,
      schedule: [
        ...allRegDoneSched,
        {
          id: 'post_2026_div_loss',
          seasonType: 'POST',
          postseasonRound: 'DIV',
          week: 20,
          dateIso: '2027-01-24T21:30:00Z',
          completed: true,
          result: 'L',
          sfScore: 20,
          oppScore: 23,
          homeAway: 'home',
          opponent: { abbr: 'DET', name: 'Detroit Lions', record: '12-5' },
          venue: { name: "Levi's Stadium", city: 'Santa Clara', surface: 'Natural Grass' }
        }
      ]
    }
  };
  const afterDivLossModel = resolveCompleteScheduleModel(afterDivLossData);
  assert.equal(afterDivLossModel.upcomingGames.length, 0, 'Postseason loss must stop any subsequent round synthesis');
  assert.equal(afterDivLossModel.postseasonStatus.state, 'POSTSEASON_ELIMINATED');
});

await testAsync('Schedule Gamecast scoping, Rooting Guide week grouping, 4-color Play-Likelihood nomenclature (GTD/Long Shot/Doubtful/Cleared), Scorecard parity & in-depth Coaching/Key Matchups', async () => {
  const { playProbBadgeClass } = await import('../src/views/uiHelpers.js');
  const { formatPlayTierLabel } = await import('../src/engine/injuryProbabilityModel.js');

  // 1. Verify 4-color numerical range mapping & nomenclature (Red 0-19%, Orange 20-49%, Yellow 50-84%, Green 85-99%)
  assert.equal(playProbBadgeClass(0), 'badge-danger');
  assert.equal(playProbBadgeClass(18), 'badge-danger');
  assert.equal(playProbBadgeClass(19), 'badge-danger');
  assert.equal(playProbBadgeClass(20), 'badge-orange');
  assert.equal(playProbBadgeClass(35), 'badge-orange');
  assert.equal(playProbBadgeClass(44), 'badge-orange');
  assert.equal(playProbBadgeClass(45), 'badge-orange');
  assert.equal(playProbBadgeClass(49), 'badge-orange');
  assert.equal(playProbBadgeClass(50), 'badge-warning');
  assert.equal(playProbBadgeClass(73), 'badge-warning');
  assert.equal(playProbBadgeClass(84), 'badge-warning');
  assert.equal(playProbBadgeClass(85), 'badge-positive');
  assert.equal(playProbBadgeClass(95), 'badge-positive');
  assert.equal(playProbBadgeClass(99), 'badge-positive');

  assert.equal(formatPlayTierLabel('OUT'), 'Out');
  assert.equal(formatPlayTierLabel('DOUBTFUL'), 'Doubtful');
  assert.equal(formatPlayTierLabel('UNLIKELY'), 'Long Shot');
  assert.equal(formatPlayTierLabel('FIFTY_FIFTY'), 'GTD');
  assert.equal(formatPlayTierLabel('LIKELY'), 'Cleared');
  assert.equal(formatPlayTierLabel('ACTIVE'), 'Full Go');

  // 2. Verify ZERO occurrences of "True GTD" across all data files and src/
  for (const rel of ['data/health.json', 'data/roster.json', 'data/schedule-matchup.json', 'data/depth-chart.json']) {
    const txt = fs.readFileSync(path.join(rootDir, rel), 'utf8');
    assert.ok(!txt.includes('True GTD'), `Found leftover "True GTD" in ${rel}`);
  }

  // 3. Verify Schedule removes Gamecast links from all future games except the immediate upcoming game
  const liveSm = JSON.parse(fs.readFileSync(path.join(rootDir, 'data', 'schedule-matchup.json'), 'utf8'));
  const liveMeta = JSON.parse(fs.readFileSync(path.join(rootDir, 'data', 'meta.json'), 'utf8'));
  const liveSeasonal = JSON.parse(fs.readFileSync(path.join(rootDir, 'data', 'seasonal.json'), 'utf8'));
  const liveHealth = JSON.parse(fs.readFileSync(path.join(rootDir, 'data', 'health.json'), 'utf8'));
  const liveRoster = JSON.parse(fs.readFileSync(path.join(rootDir, 'data', 'roster.json'), 'utf8'));

  const fullAppData = {
    meta: liveMeta,
    scheduleMatchup: liveSm,
    seasonal: liveSeasonal,
    health: liveHealth,
    roster: liveRoster
  };

  const schedHtml = renderSeasonMatchupViewHtml({
    seasonSub: 'schedule',
    activePhases: ['YEAR_ROUND', 'IN_SEASON'],
    appData: fullAppData,
    activeVideosSet: new Set()
  });
  const upcomingSlice = schedHtml.slice(schedHtml.indexOf('data-schedule-upcoming-list'));
  const gamecastMatches = upcomingSlice.match(/>Gamecast</g) || [];
  assert.equal(gamecastMatches.length, 1, `Expected exactly 1 Gamecast link in Upcoming schedule (only the immediate upcoming game), got ${gamecastMatches.length}`);
  const prevSlice = schedHtml.slice(0, schedHtml.indexOf('data-schedule-upcoming-list'));
  assert.ok(prevSlice.includes('>Box Score<'), 'Completed games in Previous Games bar must retain Box Score links');

  // 4. Verify Rooting Guide groups by week in cards and collapses the week after next
  const playoffsHtml = renderSeasonMatchupViewHtml({
    seasonSub: 'playoffs',
    activePhases: ['YEAR_ROUND', 'IN_SEASON', 'PLAYOFF_PUSH'],
    appData: fullAppData,
    activeVideosSet: new Set()
  });
  assert.ok(playoffsHtml.includes('data-rooting-guide-weeks'), 'Rooting Guide must group games into week cards');
  assert.ok(playoffsHtml.includes('data-rooting-week="10"'), 'Rooting Guide must render Week 10 card');
  assert.ok(
    playoffsHtml.includes('details class="subcard-panel rooting-week-card rooting-week-collapsible" data-rooting-week="11" data-rooting-next-week>'),
    'Week after next (Week 11) must be an expandable collapsed <details> card'
  );

  // 5. Verify Matchup View: Availability Index dotted link (no "What this means"), live scorecard parity + deterministic 1 Doubtful · 2 Long Shot · 3 GTD breakout, no redundant Questionable under injuries, Coaching OC/DC & bold headers, and 5 detailed Key Matchups
  const matchupHtml = renderSeasonMatchupViewHtml({
    seasonSub: 'matchup',
    activePhases: ['YEAR_ROUND', 'IN_SEASON'],
    appData: fullAppData,
    activeVideosSet: new Set()
  });
  assert.ok(
    matchupHtml.includes('data-jargon="availability_index"') &&
      matchupHtml.includes('>Availability Index</span>') &&
      !matchupHtml.includes('What this means'),
    'Availability Index must be a dotted glossary link and "What this means" must be removed'
  );
  assert.ok(
    matchupHtml.includes('<div class="kpi-label">Injured</div>'),
    'Lower-left card must show Injured label'
  );
  const oppTableSlice = matchupHtml.slice(
    matchupHtml.indexOf('data-health-table="opp"'),
    matchupHtml.indexOf('DAL Beat Notes') > -1 ? matchupHtml.indexOf('DAL Beat Notes') : matchupHtml.length
  );
  assert.ok(
    !oppTableSlice.includes('>Questionable<'),
    'Opponent Practice Participation table must not show redundant "Questionable" sub-line under every injury'
  );
  // Verify 4-color badge mapping on every live opponent injury row
  for (const r of liveSm.upcomingMatchup?.opponentHealth?.injuryReport || []) {
    const pct = Number(r.playProbabilityPct ?? 50);
    if (pct > 0 && pct < 20) {
      assert.ok(oppTableSlice.includes(`badge-danger mono">${r.playBadgeLabel}`), `Expected danger badge for ${r.name} (${r.playBadgeLabel})`);
    } else if (pct >= 20 && pct < 50) {
      assert.ok(oppTableSlice.includes(`badge-orange mono">${r.playBadgeLabel}`), `Expected orange badge for ${r.name} (${r.playBadgeLabel})`);
    } else if (pct >= 50 && pct < 85) {
      assert.ok(oppTableSlice.includes(`badge-warning mono">${r.playBadgeLabel}`), `Expected warning badge for ${r.name} (${r.playBadgeLabel})`);
    }
  }
  // Deterministic fixture check verifying exact `1 Doubtful · 2 Long Shot · 3 GTD` & `(1 Doubtful · 3 Long Shot · 6 GTD)` scorecard sub-note formatting
  const syntheticScorecardAppData = {
    ...fullAppData,
    scheduleMatchup: {
      ...liveSm,
      upcomingMatchup: {
        ...liveSm.upcomingMatchup,
        opponentHealth: {
          ...liveSm.upcomingMatchup.opponentHealth,
          injuryReport: [
            { name: 'Starter D1', position: 'WR', isStarter: true, snapPct: 80, gameStatus: 'Doubtful', playProbabilityPct: 18, playBadgeLabel: '18% • Doubtful' },
            { name: 'Starter LS1', position: 'TE', isStarter: true, snapPct: 82, gameStatus: 'Questionable', playProbabilityPct: 35, playBadgeLabel: '35% • Long Shot' },
            { name: 'Starter LS2', position: 'CB', isStarter: true, snapPct: 88, gameStatus: 'Questionable', playProbabilityPct: 44, playBadgeLabel: '44% • Long Shot' },
            { name: 'Depth LS3', position: 'WR', isStarter: false, snapPct: 22, gameStatus: 'Questionable', playProbabilityPct: 45, playBadgeLabel: '45% • Long Shot' },
            { name: 'Starter GTD1', position: 'OT', isStarter: true, snapPct: 90, gameStatus: 'Questionable', playProbabilityPct: 73, playBadgeLabel: '73% • GTD' },
            { name: 'Starter GTD2', position: 'LB', isStarter: true, snapPct: 78, gameStatus: 'Questionable', playProbabilityPct: 76, playBadgeLabel: '76% • GTD' },
            { name: 'Starter GTD3', position: 'DE', isStarter: true, snapPct: 75, gameStatus: 'Questionable', playProbabilityPct: 79, playBadgeLabel: '79% • GTD' },
            { name: 'Depth GTD4', position: 'RB', isStarter: false, snapPct: 20, gameStatus: 'Questionable', playProbabilityPct: 72, playBadgeLabel: '72% • GTD' },
            { name: 'Depth GTD5', position: 'TE', isStarter: false, snapPct: 18, gameStatus: 'Questionable', playProbabilityPct: 74, playBadgeLabel: '74% • GTD' },
            { name: 'Depth GTD6', position: 'CB', isStarter: false, snapPct: 15, gameStatus: 'Questionable', playProbabilityPct: 75, playBadgeLabel: '75% • GTD' }
          ]
        }
      }
    }
  };
  const syntheticMatchupHtml = renderSeasonMatchupViewHtml({
    seasonSub: 'matchup',
    activePhases: ['YEAR_ROUND', 'IN_SEASON'],
    appData: syntheticScorecardAppData,
    activeVideosSet: new Set()
  });
  assert.ok(
    syntheticMatchupHtml.includes('1 Doubtful · 2 Long Shot · 3 GTD'),
    'Starters Cleared sub-note must break out 1 Doubtful · 2 Long Shot · 3 GTD'
  );
  assert.ok(
    syntheticMatchupHtml.includes('<div class="kpi-label">Injured</div>') &&
      syntheticMatchupHtml.includes('(1 Doubtful · 3 Long Shot · 6 GTD)'),
    'Lower-left card must show Injured 10 and (1 Doubtful · 3 Long Shot · 6 GTD)'
  );
  assert.ok(
    matchupHtml.includes('OC Klayton Adams') && matchupHtml.includes('DC Matt Eberflus'),
    'Coaching Matchup headline must include salient opponent OC and DC'
  );
  assert.ok(
    matchupHtml.includes('<li><strong>Pass-Game Efficiency &amp; Coverage Shell Delta:</strong>'),
    'Coaching Matchup bullets must bold the header before the colon'
  );
  assert.equal(
    (liveSm.upcomingMatchup?.keyMatchupsMatrix || []).length,
    5,
    'Key Matchups matrix must provide 5 detailed film/scheme cards'
  );
});

await testAsync('Expanded Football Jargon Glossary, Non-Overlapping Coaching Chess vs. 5 Key Matchup Scouting Cards & 1/Day Gemini 3.8 Refresh', async () => {
  const liveSm = JSON.parse(fs.readFileSync(path.join(rootDir, 'data', 'schedule-matchup.json'), 'utf8'));
  const liveMeta = JSON.parse(fs.readFileSync(path.join(rootDir, 'data', 'meta.json'), 'utf8'));
  const liveSeasonal = JSON.parse(fs.readFileSync(path.join(rootDir, 'data', 'seasonal.json'), 'utf8'));
  const liveHealth = JSON.parse(fs.readFileSync(path.join(rootDir, 'data', 'health.json'), 'utf8'));
  const liveRoster = JSON.parse(fs.readFileSync(path.join(rootDir, 'data', 'roster.json'), 'utf8'));
  const fullAppData = {
    meta: liveMeta,
    scheduleMatchup: liveSm,
    seasonal: liveSeasonal,
    health: liveHealth,
    roster: liveRoster
  };
  const matchupHtml = renderSeasonMatchupViewHtml({
    seasonSub: 'matchup',
    activePhases: ['YEAR_ROUND', 'IN_SEASON'],
    appData: fullAppData,
    activeVideosSet: new Set()
  });

  // Verify Expanded Football Jargon Links, Non-Overlapping Coaching vs. Key Matchups & 1/Day Gemini 3.8 Refresh
  const jargonProbeHtml = annotateJargonPlainText(
    'Attack between the numbers and the honey-hole between hook/curl linebackers and curl/flat defenders on choice/dagger, while pin-and-pul, counter, and duo hit the A- and B- gaps and A/B gap vs Tampa-2 and cloud-trap.',
    { maxTerms: 25 }
  );
  for (const expectedKey of [
    'between_the_numbers',
    'honey_hole',
    'hook_curl',
    'curl_flat',
    'choice_dagger',
    'pin_and_pull',
    'counter',
    'duo',
    'a_b_gap',
    'tampa_2',
    'cloud_trap'
  ]) {
    assert.ok(
      jargonProbeHtml.includes(`data-jargon="${expectedKey}"`),
      `Expected jargon glossary link for "${expectedKey}", got: ${jargonProbeHtml}`
    );
    assert.ok(
      (getJargonEntry(expectedKey)?.definition || '').length >= 45,
      `Expected full definition for "${expectedKey}"`
    );
  }

  // Verify Coaching Matchup has zero active player-list bloat while Key Matchups has avatars, stat strips, dossier links & Broadcast Tells
  const coachCorpus = [
    liveSm.upcomingMatchup.coachingMatchup?.summary || '',
    ...(liveSm.upcomingMatchup.coachingMatchup?.bullets || [])
  ].join(' ');
  for (const playerCallout of ['Brock Purdy', 'Christian McCaffrey', 'George Kittle', 'Nick Bosa', 'DeForest Buckner', 'CeeDee Lamb', 'Dak Prescott']) {
    assert.ok(
      !coachCorpus.includes(playerCallout),
      `Coaching Matchup must stay focused on Coordinator Tendencies without duplicating player callout "${playerCallout}"`
    );
  }
  assert.ok(
    matchupHtml.includes('data-coaching-matchup-card') &&
      matchupHtml.includes('data-jargon="honey_hole"') &&
      matchupHtml.includes('data-jargon="hook_curl"') &&
      matchupHtml.includes('data-jargon="curl_flat"') &&
      matchupHtml.includes('data-jargon="choice_dagger"') &&
      matchupHtml.includes('data-jargon="pin_and_pull"') &&
      matchupHtml.includes('data-jargon="counter"') &&
      matchupHtml.includes('data-jargon="duo"') &&
      matchupHtml.includes('data-jargon="a_b_gap"'),
    'Coaching Matchup rendered HTML must annotate all core football scheme terms with interactive jargon popovers'
  );
  const statStripsCount = (matchupHtml.match(/data-matchup-stat-strip/g) || []).length;
  const filmTellsCount = (matchupHtml.match(/data-matchup-film-tell/g) || []).length;
  assert.equal(statStripsCount, 5, `Expected 5 Tale-of-the-Tape stat strips in Key Matchups, got ${statStripsCount}`);
  assert.equal(filmTellsCount, 5, `Expected 5 Broadcast Tell callouts in Key Matchups, got ${filmTellsCount}`);
  assert.ok(
    matchupHtml.includes('badge-gold mono key-matchup-adv">Even Star Clash'),
    'Even Key Matchup cards must use gold badge rather than emerald SF-edge badge'
  );

  // Verify 1/Day Live Gemini 3.8 Matchup Intel spends strictly 1 credit/day and 0 on same-day repeat calls
  const { refreshDailyMatchupIntelIfDue, getPacificDateKey } = await import('../src/services/aiWorkerClient.js');
  const origLocalStorage = globalThis.localStorage;
  const origFetchDaily = globalThis.fetch;
  try {
    const memStore = new Map();
    globalThis.localStorage = {
      getItem: k => (memStore.has(k) ? memStore.get(k) : null),
      setItem: (k, v) => memStore.set(k, String(v)),
      removeItem: k => memStore.delete(k)
    };
    let generateCalls = 0;
    globalThis.fetch = async url => {
      const u = String(url);
      if (u.includes('/models?')) {
        return new Response(
          JSON.stringify({
            models: [{ name: 'models/gemini-3.8-flash', supportedGenerationMethods: ['generateContent'] }]
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
      generateCalls += 1;
      return new Response(
        JSON.stringify({
          candidates: [
            {
              content: {
                parts: [
                  { thought: true, text: 'Evaluating Week 10 tendencies...' },
                  {
                    text: JSON.stringify({
                      coachingMatchup: liveSm.upcomingMatchup.coachingMatchup,
                      keyMatchupsMatrix: liveSm.upcomingMatchup.keyMatchupsMatrix
                    })
                  }
                ]
              }
            }
          ]
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    };

    const cloneAppData = JSON.parse(JSON.stringify(fullAppData));
    delete cloneAppData.scheduleMatchup.upcomingMatchup.aiMatchupMeta;
    const day1Ms = Date.parse('2026-11-11T18:00:00Z');
    const day1Pt = getPacificDateKey(day1Ms);

    const firstRun = await refreshDailyMatchupIntelIfDue({
      appData: cloneAppData,
      prefs: { geminiApiKey: 'AIzaDailyTestKey', geminiApiBaseUrl: 'https://mock-daily.local/v1beta' },
      nowMs: day1Ms
    });
    assert.equal(firstRun.updated, true, 'First call of PT day must synthesize daily matchup intel');
    assert.equal(firstRun.datePt, day1Pt);
    assert.equal(generateCalls, 1, 'Daily refresh must burn strictly 1 Gemini 3.8 request (1 credit)');

    const secondSameDay = await refreshDailyMatchupIntelIfDue({
      appData: cloneAppData,
      prefs: { geminiApiKey: 'AIzaDailyTestKey', geminiApiBaseUrl: 'https://mock-daily.local/v1beta' },
      nowMs: day1Ms + 3600_000
    });
    assert.equal(secondSameDay.updated, false);
    assert.equal(secondSameDay.fromCache, true);
    assert.equal(generateCalls, 1, 'Repeat call on same PT calendar day must spend 0 extra credits');

    const nextDayRun = await refreshDailyMatchupIntelIfDue({
      appData: cloneAppData,
      prefs: { geminiApiKey: 'AIzaDailyTestKey', geminiApiBaseUrl: 'https://mock-daily.local/v1beta' },
      nowMs: day1Ms + 86_400_000
    });
    assert.equal(nextDayRun.updated, true, 'Next PT calendar day must refresh matchup intel');
    assert.equal(generateCalls, 2, 'Next PT day should spend exactly 1 new credit');
  } finally {
    globalThis.localStorage = origLocalStorage;
    globalThis.fetch = origFetchDaily;
  }
});

console.log('\n=== [12/12] StoryRank Latency, Strict Breaking Precision, Google News Clustering & Film/Video Differentiation QA ===');

await testAsync('Keenan Allen trade surfaces at #1 in <1m via StoryRank + hydrateLiveEspnRapidBreakingDesk even before roster.json updates', async () => {
  const tueBreakNow = Date.parse('2026-11-10T18:40:00Z'); // Tuesday morning inside 48h post-game window!
  const wk9PostGameAppData = {
    meta: { seasonYear: 2026, currentWeek: 10, calendar: { tradeDeadlineIso: '2026-11-10T21:00:00Z' } },
    scheduleMatchup: {
      schedule: [{ id: 'g9', week: 9, dateIso: '2026-11-08T21:25:00Z', completed: true, statusDetail: 'Final' }],
      upcomingMatchup: { week: 10, oppAbbr: 'DAL', oppName: 'Dallas Cowboys', kickoffIso: '2026-11-15T21:25:00Z' }
    }
  };

  // 1. Verify ALL real-world breaking trade phrasings match Tier-1 BREAKING and outrank 48h post-game injury items at T+2m
  const phrasings = [
    'Trade! The Colts are sending six-time Pro Bowl WR Keenan Allen to the 49ers for a 2027 sixth-round pick.',
    'Colts agree to trade veteran WR Keenan Allen to 49ers for sixth-round pick.',
    "49ers trade for Colts' Keenan Allen to bolster injury-plagued WR room",
    'The 49ers are adding a WR, completing a trade for Colts WR Keenan Allen.',
    'WR Keenan Allen is heading to the 49ers from Indy for a sixth-round pick, ESPN reports.',
    'The 49ers Acquire WR Keenan Allen'
  ];
  for (const headline of phrasings) {
    const cls = classifyBreakingItem(
      { type: 'tweet', author: 'Tom Pelissero', trustTier: 1, title: headline, fullText: headline, publishedAt: new Date(tueBreakNow - 2 * 60_000).toISOString() },
      tueBreakNow,
      { appData: wk9PostGameAppData }
    );
    assert.equal(cls.isBreaking, true, `Expected BREAKING=true for "${headline}"`);
    assert.equal(cls.breakingBadge, 'BREAKING', `Expected badge=BREAKING for "${headline}"`);
    assert.ok(cls.breakingPriority >= 3.1, `Expected Tier-1 breakingPriority >= 3.1 for "${headline}", got ${cls.breakingPriority}`);
  }

  const rankedAtBreak = sortNewsWithBreakingPriority(
    [
      {
        id: 'postgame_halton_inj',
        type: 'tweet',
        author: 'Matt Maiocco',
        trustTier: 1,
        title: '49ers rookie DT Gracen Halton sustained an ankle injury Sunday against the Raiders and underwent an MRI.',
        fullText: '49ers rookie DT Gracen Halton sustained an ankle injury Sunday against the Raiders and underwent an MRI.',
        publishedAt: new Date(tueBreakNow - 50 * 60_000).toISOString()
      },
      {
        id: 'pelissero_keenan_trade',
        type: 'tweet',
        author: 'Tom Pelissero',
        trustTier: 1,
        title: 'Trade! The Colts are sending six-time Pro Bowl WR Keenan Allen to the 49ers for a 2027 sixth-round pick.',
        fullText: 'Trade! The Colts are sending six-time Pro Bowl WR Keenan Allen to the 49ers for a 2027 sixth-round pick.',
        publishedAt: new Date(tueBreakNow - 2 * 60_000).toISOString()
      }
    ],
    tueBreakNow,
    { appData: wk9PostGameAppData }
  );
  assert.equal(rankedAtBreak[0].id, 'pelissero_keenan_trade', 'New Keenan Allen trade scoop must immediately rank #1 ahead of post-game injury notes');
  assert.equal(rankedAtBreak[0].breakingBadge, 'BREAKING');

  // 2. Verify hydrateLiveEspnRapidBreakingDesk ingests external-team-to-49ers trade BEFORE player is in roster.json
  const origFetch = globalThis.fetch;
  globalThis.fetch = async url => {
    const u = String(url);
    if (u.includes('/nfl/news?limit=35')) {
      return new Response(
        JSON.stringify({
          articles: [
            {
              id: '50999901',
              headline: 'Colts agree to trade Pro Bowl WR Keenan Allen to San Francisco 49ers',
              description: 'Indianapolis sends veteran wideout Keenan Allen to San Francisco for a 2027 sixth-round pick.',
              byline: 'By Adam Schefter',
              published: new Date().toISOString(),
              links: { web: { href: 'https://www.espn.com/nfl/story/_/id/50999901/colts-trade-keenan-allen-49ers' } }
            }
          ]
        }),
        { status: 200 }
      );
    }
    return new Response(JSON.stringify({ articles: [], transactions: [] }), { status: 200 });
  };

  try {
    const mockPreRosterApp = {
      roster: { players: [{ id: '4361741', name: 'Brock Purdy', position: 'QB', jersey: 13 }] }, // Keenan Allen NOT yet on roster!
      news: {
        rawStream: [
          {
            id: 'older_beat_1',
            type: 'article',
            title: '49ers Week 10 practice lookahead',
            url: 'https://www.49ers.com/news/lookahead',
            publishedAt: new Date(Date.now() - 2 * 3600_000).toISOString()
          }
        ]
      }
    };
    const added = await hydrateLiveEspnRapidBreakingDesk(mockPreRosterApp);
    assert.equal(added, 1, 'Expected league-wide ESPN breaking desk to catch external-player trade to 49ers');
    assert.equal(mockPreRosterApp.news.rawStream[0].id, 'espn_rapid_50999901', 'External trade must rocket directly to #1');
    assert.equal(mockPreRosterApp.news.rawStream[0].breakingBadge, 'BREAKING');
  } finally {
    globalThis.fetch = origFetch;
  }
});

test('User screenshot regression: zero false-positive BREAKING wall, strict badge decay, story consolidation & side-note demotion', () => {
  const wedNow = Date.parse('2026-11-12T03:30:00Z');
  const wedAppData = {
    meta: { seasonYear: 2026, currentWeek: 10, calendar: { tradeDeadlineIso: '2026-11-10T21:00:00Z' } },
    scheduleMatchup: {
      schedule: [{ id: 'g9', week: 9, dateIso: '2026-11-08T21:25:00Z', completed: true, statusDetail: 'Final' }],
      upcomingMatchup: { week: 10, oppAbbr: 'DAL', oppName: 'Dallas Cowboys', kickoffIso: '2026-11-15T21:25:00Z' }
    }
  };

  const screenshotFeed = [
    {
      id: 'cj_west_ir_return',
      type: 'article',
      outletName: 'Pro Football Rumors',
      author: 'Pro Football Rumors',
      trustTier: 2,
      title: '49ers Designate DT CJ West For Return; Latest On Mike Evans, Deebo Samuel',
      summary: 'The 49ers made in-season trades at defensive tackle and wide receiver, acquiring DeForest Buckner and Keenan Allen.',
      mentionedPlayers: [{ id: '4686308', name: 'C.J. West' }],
      url: 'https://www.profootballrumors.com/2026/11/cj-west-return',
      publishedAt: new Date(wedNow - 3 * 3600_000).toISOString()
    },
    {
      id: 'kawakami_quote',
      type: 'tweet',
      outletName: 'The SF Standard',
      author: 'Tim Kawakami',
      trustTier: 2,
      title: 'Pretty interesting Shanahan answer when I asked if it was a tough trade market to get somebody: "Just because people are trading doesn\'t mean it\'s always the right thing, though, and sometimes a lot of people are being traded for a reason."',
      fullText: 'Pretty interesting Shanahan answer when I asked if it was a tough trade market to get somebody: "Just because people are trading doesn\'t mean it\'s always the right thing, though, and sometimes a lot of people are being traded for a reason."',
      url: 'https://bsky.app/profile/timkawakami.bsky.social/post/tk1',
      publishedAt: new Date(wedNow - 3.6 * 3600_000).toISOString()
    },
    {
      id: 'cj_west_jersey_99',
      type: 'article',
      outletName: '49ers Webzone',
      author: '49ers Webzone',
      trustTier: 2,
      title: "49ers' C.J. West reveals why he freely gave DeForest Buckner No. 99",
      summary: 'When the team traded for defensive tackle DeForest Buckner, West willingly—and freely—gave up his No. 99 jersey.',
      mentionedPlayers: [{ id: '4686308', name: 'C.J. West' }, { id: '2971282', name: 'DeForest Buckner' }],
      url: 'https://www.49erswebzone.com/articles/cj-west-99/',
      publishedAt: new Date(wedNow - 4 * 3600_000).toISOString()
    },
    {
      id: 'cohn_keenan_video',
      type: 'video',
      videoId: 'ciu3raFg6Fg',
      outletName: 'Grant Cohn',
      author: 'Grant Cohn',
      trustTier: 3,
      title: 'Kyle Shanahan Explains Why the 49ers Traded for Keenan Allen',
      summary: 'Video (13:51) • Grant Cohn • 6h ago',
      mentionedPlayers: [{ id: '15818', name: 'Keenan Allen' }],
      url: 'https://www.youtube.com/watch?v=ciu3raFg6Fg',
      publishedAt: new Date(wedNow - 6 * 3600_000).toISOString()
    },
    {
      id: 'wz_shanahan_keenan_art',
      type: 'article',
      outletName: '49ers Webzone',
      author: '49ers Webzone',
      trustTier: 2,
      title: 'Kyle Shanahan reveals what Keenan Allen brings to the 49ers after trade',
      summary: 'The San Francisco 49ers made a move ahead of Tuesday’s NFL trade deadline, acquiring wide receiver Keenan Allen.',
      mentionedPlayers: [{ id: '15818', name: 'Keenan Allen' }],
      url: 'https://www.49erswebzone.com/articles/shanahan-keenan/',
      publishedAt: new Date(wedNow - 6.5 * 3600_000).toISOString()
    },
    {
      id: 'inman_evans_expected_dnp',
      type: 'tweet',
      outletName: 'Bay Area News Group',
      author: 'Cam Inman',
      trustTier: 1,
      title: "Evans (Achilles) was listed as a non-participant in Wednesday's practice. The veteran wideout's absence Wednesday isn't surprising, having previously reported that Evans is not expected to be ready...",
      fullText: "Evans (Achilles) was listed as a non-participant in Wednesday's practice. The veteran wideout's absence Wednesday isn't surprising, with Brooke Evans having previously reported that Evans is not expected to be ready this week. Meanwhile the team added depth by acquiring Keenan Allen.",
      mentionedPlayers: [{ id: '16737', name: 'Mike Evans' }],
      url: 'https://x.com/CamInman/status/1888888888888888888',
      publishedAt: new Date(wedNow - 6.8 * 3600_000).toISOString()
    },
    {
      id: 'mac_jones_calls_1',
      type: 'article',
      outletName: 'NFL Trade Rumors',
      author: 'NFL Trade Rumors',
      trustTier: 2,
      title: "Shanahan: 'A Lot Of Teams' Called About Acquiring 49ers QB Mac Jones",
      mentionedPlayers: [{ id: '4241464', name: 'Mac Jones' }],
      url: 'https://nfltraderumors.co/mac-jones-calls/',
      publishedAt: new Date(wedNow - 7 * 3600_000).toISOString()
    },
    {
      id: 'mac_jones_calls_2',
      type: 'tweet',
      outletName: 'NBC Sports Bay Area',
      author: 'Matt Maiocco',
      trustTier: 1,
      title: "Kyle Shanahan said teams called the 49ers to inquire about Mac Jones' availability.",
      fullText: "Kyle Shanahan said teams called the 49ers to inquire about Mac Jones' availability.",
      mentionedPlayers: [{ id: '4241464', name: 'Mac Jones' }],
      url: 'https://bsky.app/profile/mattmaiocco.bsky.social/post/mj1',
      publishedAt: new Date(wedNow - 7.1 * 3600_000).toISOString()
    },
    {
      id: 'te_radar_wz',
      type: 'article',
      outletName: '49ers Webzone',
      author: '49ers Webzone',
      trustTier: 2,
      title: '49ers had 2-time Pro Bowl tight end on their trade radar',
      summary: 'The 49ers made a move ahead of Tuesday’s NFL trade deadline, acquiring wide receiver Keenan Allen.',
      url: 'https://www.49erswebzone.com/articles/te-radar/',
      publishedAt: new Date(wedNow - 11 * 3600_000).toISOString()
    },
    {
      id: 'te_radar_hvy',
      type: 'article',
      outletName: 'Heavy on 49ers',
      author: 'Heavy on 49ers',
      trustTier: 3,
      title: 'San Francisco 49ers Were Eyeing a Trade for 2-Time Pro Bowl TE: Report',
      url: 'https://heavy.com/sports/nfl/san-francisco-49ers/te-radar/',
      publishedAt: new Date(wedNow - 11.2 * 3600_000).toISOString()
    }
  ];

  const sorted = sortNewsWithBreakingPriority(screenshotFeed, wedNow, { appData: wedAppData });
  const consolidated = deduplicateAndGroupWireItems(sorted, { nowMs: wedNow });

  // 1. ONLY CJ West's fresh (3h-old) IR return designation wears BREAKING!
  const urgentItems = consolidated.filter(x => isUrgentBreakingBadge(x.breakingBadge));
  assert.equal(urgentItems.length, 1, `Expected ONLY 1 urgent BREAKING item from screenshot set, got ${urgentItems.length}`);
  assert.equal(urgentItems[0].id, 'cj_west_ir_return');
  assert.equal(consolidated[0].id, 'cj_west_ir_return', 'CJ West IR return designation must rank #1');

  // 2. Once CJ West's move is >5h old (e.g. 6h), its badge transitions cleanly from BREAKING -> ROSTER MOVE
  const sixHoursLaterCls = classifyBreakingItem(screenshotFeed[0], wedNow + 3 * 3600_000, { appData: wedAppData });
  assert.equal(sixHoursLaterCls.isBreaking, false);
  assert.equal(sixHoursLaterCls.breakingBadge, 'ROSTER MOVE');

  // 3. Zero false BREAKING badges on quotes, jersey trivia, expected Wednesday DNPs, or post-deadline retrospectives
  for (const nonBrkId of ['kawakami_quote', 'cj_west_jersey_99', 'wz_shanahan_keenan_art', 'inman_evans_expected_dnp', 'mac_jones_calls_1', 'mac_jones_calls_2', 'te_radar_wz']) {
    const hit = sorted.find(x => x.id === nonBrkId);
    assert.ok(hit && !isUrgentBreakingBadge(hit.breakingBadge), `Item ${nonBrkId} must NOT carry urgent BREAKING badge, got ${hit?.breakingBadge}`);
  }

  // 4. Redundant stories consolidate cleanly:
  //    - Grant Cohn video + Webzone article on Shanahan/Keenan Allen merge (led by Webzone article over Tier-3 vlog)
  //    - Mac Jones trade inquiry tweet + article merge
  //    - 2-time Pro Bowl TE radar Webzone + Heavy articles merge
  assert.equal(consolidated.length, 7, `Expected 10 redundant items to consolidate into 7 distinct story clusters, got ${consolidated.length}`);
  const shanahanKeenanCluster = consolidated.find(x => x.id === 'wz_shanahan_keenan_art');
  assert.ok(shanahanKeenanCluster && shanahanKeenanCluster.confirmingReports?.length === 1, 'Shanahan + Keenan Allen article & video must cluster together');

  // 5. Side notes (Mac Jones inquiries, CJ West #99 jersey, Pro Bowl TE radar) rank below real team news
  const top3Ids = consolidated.slice(0, 3).map(x => x.id);
  assert.ok(!top3Ids.includes('cj_west_jersey_99'), 'Jersey trivia must not sit in Top 3');
  assert.ok(!top3Ids.includes('te_radar_wz'), 'Retrospective TE radar must not sit in Top 3');
});

test('Film & Trench vs Videos are significantly differentiated in both engine classification and live data/news.json', () => {
  assert.equal(
    classifyNewsItemCategory({
      type: 'video',
      outletName: 'Grant Cohn',
      title: 'Kyle Shanahan Explains Why the 49ers Traded for Keenan Allen'
    }),
    'roster',
    'Podium trade reaction video must NOT be classified as film'
  );
  assert.equal(
    classifyNewsItemCategory({
      type: 'video',
      outletName: "Jonnydel's Football Academy",
      title: '49ers Playbook: SF Sinks the Raiders in the Bay'
    }),
    'film',
    'All-22 Playbook breakdown video MUST be classified as film'
  );
  assert.equal(
    classifyNewsItemCategory({
      type: 'article',
      outletName: 'Niners Nation',
      title: '49ers All-22 Film Breakdown: How Brock Purdy attacked Cover 4 out of 21 personnel (+0.34 EPA/play)'
    }),
    'film',
    'Written All-22 / EPA / coverage breakdown article MUST be classified as film'
  );

  const liveNews = JSON.parse(fs.readFileSync(path.join(rootDir, 'data', 'news.json'), 'utf8'));
  const liveMeta = JSON.parse(fs.readFileSync(path.join(rootDir, 'data', 'meta.json'), 'utf8'));
  const liveSched = JSON.parse(fs.readFileSync(path.join(rootDir, 'data', 'schedule-matchup.json'), 'utf8'));
  const appStub = { meta: liveMeta, scheduleMatchup: liveSched };
  const sortedLive = sortNewsWithBreakingPriority(
    filterOutCompletedGameAvailabilityItems(liveNews.rawStream || [], appStub),
    Date.now(),
    { appData: appStub }
  );
  const videoIds = deduplicateAndGroupWireItems(
    sortedLive.filter(x => x.type === 'video'),
    { preserveFormat: 'videos' }
  ).map(x => x.id);
  const filmIds = deduplicateAndGroupWireItems(sortedLive)
    .filter(x => x.category === 'film')
    .map(x => x.id);

  assert.ok(videoIds.length >= 3, `Expected >=3 videos in live feed, got ${videoIds.length}`);
  assert.ok(filmIds.length >= 3, `Expected >=3 Film & Trench items in live feed, got ${filmIds.length}`);
  assert.notDeepEqual(filmIds, videoIds, 'Film & Trench filter must NEVER be identical to Videos filter');
  const nonVideoFilmCount = deduplicateAndGroupWireItems(sortedLive).filter(
    x => x.category === 'film' && x.type !== 'video'
  ).length;
  assert.ok(nonVideoFilmCount >= 2, `Expected >=2 written articles/threads in Film & Trench, got ${nonVideoFilmCount}`);
});

await testAsync('Site-wide redundancy consolidation & Depth Chart scheme/alignment glossary underlines QA', async () => {
  const { renderSeasonMatchupViewHtml } = await import('../src/views/seasonMatchupView.js');
  const { renderRosterCapViewHtml } = await import('../src/views/rosterCapView.js');
  const { renderNewsViewHtml } = await import('../src/views/newsView.js');
  const { renderAudioAiViewHtml } = await import('../src/views/audioAiView.js');
  const { getJargonEntry } = await import('../src/engine/jargonGlossary.js');

  const fullAppData = {
    meta: JSON.parse(fs.readFileSync(path.join(rootDir, 'data', 'meta.json'), 'utf8')),
    scheduleMatchup: JSON.parse(fs.readFileSync(path.join(rootDir, 'data', 'schedule-matchup.json'), 'utf8')),
    seasonal: JSON.parse(fs.readFileSync(path.join(rootDir, 'data', 'seasonal.json'), 'utf8')),
    health: JSON.parse(fs.readFileSync(path.join(rootDir, 'data', 'health.json'), 'utf8')),
    roster: JSON.parse(fs.readFileSync(path.join(rootDir, 'data', 'roster.json'), 'utf8')),
    depthChart: JSON.parse(fs.readFileSync(path.join(rootDir, 'data', 'depth-chart.json'), 'utf8')),
    cap: JSON.parse(fs.readFileSync(path.join(rootDir, 'data', 'cap.json'), 'utf8')),
    news: JSON.parse(fs.readFileSync(path.join(rootDir, 'data', 'news.json'), 'utf8')),
    beatPodcasts: JSON.parse(fs.readFileSync(path.join(rootDir, 'data', 'beat-podcasts.json'), 'utf8'))
  };

  // 1. Matchup View: Zero opponent "Bye Wk" / "Bye Week", zero "Most recent meeting" above table, and non-duplicated matchup title
  const matchupHtml = renderSeasonMatchupViewHtml({
    seasonSub: 'matchup',
    activePhases: ['YEAR_ROUND', 'IN_SEASON'],
    appData: fullAppData,
    activeVideosSet: new Set()
  });
  const oppSecStart = matchupHtml.indexOf('id="opponentHealthSection"');
  const oppSecEnd = matchupHtml.indexOf('id="matchupTeamStatsCard"');
  const oppSecHtml = matchupHtml.slice(oppSecStart, oppSecEnd > oppSecStart ? oppSecEnd : undefined);
  assert.ok(!/Bye\s*Wk|Bye\s*Week/i.test(oppSecHtml), 'Opponent Health section must never display opponent Bye Week');
  assert.ok(!/Most recent meeting/i.test(matchupHtml), 'Matchup Recent Meetings must not repeat Most recent meeting above table Row 1');
  assert.ok(matchupHtml.includes('>Week ') && matchupHtml.includes(' Matchup</h2>'), 'Matchup hero card must use concise Week X Matchup heading above scoreboard');

  // 2. Playoffs View: Zero duplicate "10,000 Runs" badge & clean Rooting Guide week headers/rows
  const playoffsHtml = renderSeasonMatchupViewHtml({
    seasonSub: 'playoffs',
    activePhases: ['YEAR_ROUND', 'IN_SEASON', 'PLAYOFF_PUSH'],
    appData: fullAppData,
    activeVideosSet: new Set()
  });
  assert.ok(playoffsHtml.includes('10,000-Run'), 'Playoffs view must keep 10,000-Run Monte Carlo eyebrow');
  assert.ok(!playoffsHtml.includes('>10,000 Runs<'), 'Playoffs view must NOT repeat 10,000 Runs badge in header');
  assert.ok(!/Rooting Slate|Week \d+ Rooting Guide/.test(playoffsHtml), 'Rooting Guide week cards must not stutter Week X + Week X Rooting Slate/Guide');
  assert.ok(!/\bWk \d+:\s+[A-Z]{2,3}\s+@\s+[A-Z]{2,3}/.test(playoffsHtml), 'Rooting Guide game rows must not repeat Wk X: inside Week X card');

  // 3. Depth Chart: Zero "Pers" abbreviation ("11 Personnel" / "21 Personnel") & underlined jargon explanations for all scheme/alignment tags
  const depthHtml = renderRosterCapViewHtml({
    subTab: 'depth',
    depthMode: 'projected',
    appData: fullAppData
  });
  assert.ok(!/\b\d+\s*Pers\b/i.test(depthHtml), 'Depth Chart must spell out Personnel (zero "11 Pers" / "21 Pers" abbreviations)');
  assert.ok(depthHtml.includes('11 Personnel') && depthHtml.includes('21 Personnel'), 'Depth Chart must display 11 Personnel and 21 Personnel');
  for (const requiredJargonKey of [
    'one_two_i',
    'three_tech',
    'wide_9',
    'personnel_11',
    'personnel_21',
    'nickel_4_2_5',
    'base_4_3',
    'x_receiver',
    'z_receiver',
    'slot_wr',
    'y_tight_end',
    'fullback',
    'will_lb',
    'mike_lb',
    'sam_lb',
    'nickel_cb'
  ]) {
    const entry = getJargonEntry(requiredJargonKey);
    assert.ok(entry && entry.definition.length >= 40, `Missing or thin glossary entry for Depth Chart key "${requiredJargonKey}"`);
    assert.ok(
      depthHtml.includes(`data-jargon="${entry.key}"`),
      `Depth Chart HTML must underline and wire data-jargon="${entry.key}"`
    );
  }

  // 4. News & Audio rapid-succession count & video footer de-duplication
  const newsHtml = renderNewsViewHtml({
    appData: fullAppData,
    newsCategoryFilter: 'all',
    filteredRawItems: fullAppData.news.rawStream,
    reportersById: new Map(),
    activeVideosSet: new Set(),
    userPrefs: {}
  });
  assert.ok(newsHtml.includes('data-category="all">') && newsHtml.includes('<span>All</span>'), 'All filter tab must render cleanly without total count clutter');

  const podsHtml = renderAudioAiViewHtml({
    appData: fullAppData,
    studioSub: 'beat_podcasts',
    beatPodViewMode: 'date',
    beatPodShowFilter: 'all'
  });
  assert.ok(podsHtml.includes('<h2 class="card-title">49ers Beat Podcasts</h2>'), '49ers Beat Podcasts title must not repeat episode count under Podcasts (N) tab');
  assert.ok(podsHtml.includes('<span>All 6 Shows</span>'), 'All 6 Shows filter pill must not repeat episode count a third time');
});

test('Unified 6-Tab News Architecture, 5PM PT Daily Gemini 3.8 Flash High Top-News Brief, Breaking-Above-Brief Ordering & Disjoint Video/Cap Partitioning', () => {
  const fullAppData = {
    meta: JSON.parse(fs.readFileSync(path.join(rootDir, 'data', 'meta.json'), 'utf8')),
    roster: JSON.parse(fs.readFileSync(path.join(rootDir, 'data', 'roster.json'), 'utf8')),
    cap: JSON.parse(fs.readFileSync(path.join(rootDir, 'data', 'cap.json'), 'utf8')),
    health: JSON.parse(fs.readFileSync(path.join(rootDir, 'data', 'health.json'), 'utf8')),
    news: JSON.parse(fs.readFileSync(path.join(rootDir, 'data', 'news.json'), 'utf8')),
    scheduleMatchup: JSON.parse(fs.readFileSync(path.join(rootDir, 'data', 'schedule-matchup.json'), 'utf8')),
    seasonal: JSON.parse(fs.readFileSync(path.join(rootDir, 'data', 'seasonal.json'), 'utf8')),
    depthChart: JSON.parse(fs.readFileSync(path.join(rootDir, 'data', 'depth-chart.json'), 'utf8')),
    podcastIndex: JSON.parse(fs.readFileSync(path.join(rootDir, 'data', 'podcasts', 'index.json'), 'utf8')),
    beatPodcasts: JSON.parse(fs.readFileSync(path.join(rootDir, 'data', 'beat-podcasts.json'), 'utf8'))
  };

  // 1. Two-Row 6-Filter Bar Structure: All, Tweets, Articles | Highlights & Videos, Film & Trench, Trades & Roster
  assert.equal(NEWS_NAV_CLUSTERS.length, 2, 'Expected 2 segmented filter rows for zero-overflow mobile News navigation');
  const flatKeys = NEWS_NAV_CLUSTERS.flatMap(c => c.tabs.map(t => t.key));
  assert.deepEqual(flatKeys, ['all', 'tweets', 'articles', 'videos', 'film', 'roster']);
  assert.equal(VALID_NEWS_CATEGORIES.size, 6);

  // 2. 5:00 PM PT (17:00 America/Los_Angeles) Peak Daily News Brief Cycle Boundary
  assert.equal(DAILY_NEWS_BRIEF_PEAK_HOUR_PT, 17);
  // Nov 12, 2026 in PST (UTC-8): 16:59 PST = 2026-11-13T00:59:00Z -> still on Nov 11 @ 17PT cycle!
  const before5pmPtMs = Date.parse('2026-11-13T00:59:00Z');
  // 17:01 PST = 2026-11-13T01:01:00Z -> rolls to Nov 12 @ 17PT cycle!
  const after5pmPtMs = Date.parse('2026-11-13T01:01:00Z');
  assert.equal(getDailyNewsBriefCycleKey(before5pmPtMs), '2026-11-11@17PT');
  assert.equal(getDailyNewsBriefCycleKey(after5pmPtMs), '2026-11-12@17PT');

  // 3. Daily Top News Brief in data/news.json (~2/3 Coaching Matchup word count, inline links, upper-right age, expandable sources)
  const dailyBrief = fullAppData.news.dailyTopNewsBrief;
  assert.ok(dailyBrief && dailyBrief.headline && dailyBrief.summary, 'data/news.json must include dailyTopNewsBrief');
  assert.equal(dailyBrief.bullets.length, 3, 'Daily Top News Brief must contain 3 high-signal bullets');
  assert.ok(
    dailyBrief.wordCount >= 165 && dailyBrief.wordCount <= 275,
    `Daily Top News Brief wordCount (${dailyBrief.wordCount}) must be ~2/3 of the ~355-word Coaching Matchup`
  );
  assert.ok(dailyBrief.sources.length >= 5, `Expected >=5 sources in dailyTopNewsBrief, got ${dailyBrief.sources.length}`);

  const briefCardHtml = renderDailyTopNewsBriefHtml(dailyBrief, {
    rawStream: fullAppData.news.rawStream,
    appData: fullAppData
  });
  assert.ok(briefCardHtml.includes('data-daily-brief-age'), 'Missing tiny upper-right xxh ago age timestamp');
  assert.ok(briefCardHtml.includes('data-brief-inline-source'), 'Missing inline clickable source citations inside brief prose');
  assert.ok(briefCardHtml.includes('data-daily-brief-sources'), 'Missing expandable full source list at bottom of brief');
  assert.ok(!/<a\b[^>]*>(?:(?!<\/a>)[\s\S])*<a\b/i.test(briefCardHtml), 'Found nested <a> tags inside Daily Top News Brief HTML');

  // Verify inline source links render ONLY a small clickable link icon (zero full reporter/outlet names inside prose)
  const briefBodyBeforeDrawer = briefCardHtml.split('<details')[0];
  const inlineAnchors = [...briefBodyBeforeDrawer.matchAll(/<a\b[^>]*data-brief-inline-source[^>]*>([\s\S]*?)<\/a>/gi)];
  assert.ok(inlineAnchors.length >= 4, `Expected >=4 inline link icon pills in Daily Brief, got ${inlineAnchors.length}`);
  for (const [, innerAnchorHtml] of inlineAnchors) {
    const visibleAnchorText = innerAnchorHtml.replace(/<[^>]+>/g, '').trim();
    assert.equal(visibleAnchorText, '', `Inline link item must be icon-only without full source name text, got "${visibleAnchorText}"`);
  }
  const visibleProseOnly = briefBodyBeforeDrawer.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  assert.ok(!/\.{3}|…/.test(visibleProseOnly), `Daily Brief prose must NEVER contain truncated ellipses: "${visibleProseOnly}"`);
  assert.ok(!/\b(latest on|click here|read more|pro football rumors|adam schefter|49ers webzone)\b/i.test(visibleProseOnly), `Daily Brief prose must not contain teaser copy or inline outlet/reporter names: "${visibleProseOnly}"`);

  // Verify LLM JSON parser resolves [S#] references cleanly, rejects lazy teaser/ellipsis copy, and strips departed-player hallucinations
  const cands = selectTopNewsBriefSourceCandidates(fullAppData, 10);
  const promptText = buildDailyTopNewsBriefPrompt(fullAppData, cands);
  assert.ok(promptText.includes('~205–240 words'), 'Prompt must enforce ~2/3 Coaching Matchup word budget');
  assert.equal(
    parseAndSanitizeDailyTopNewsBrief(
      JSON.stringify({
        headline: '49ers Update',
        summary: 'Click here for the latest on Mike Evans and Deebo Samuel after acquiring Allen in...',
        bullets: [
          'Roster: Latest on Mike Evans [S1].',
          'Health: Updates on Deebo Samuel [S2].'
        ]
      }),
      cands,
      fullAppData
    ),
    null,
    'Parser must reject lazy teaser ("latest on" / "click here") or truncated brief copy'
  );
  const parsedAiBrief = parseAndSanitizeDailyTopNewsBrief(
    JSON.stringify({
      headline: '49ers Finalize Keenan Allen Trade & DeForest Buckner Cap Restructure Before Cowboys Tilt',
      summary: 'San Francisco cleared $5.2M in 2026 cap space while integrating WR Keenan Allen ([S1]) and opening DT C.J. West\'s 21-day practice window, per [Matt Maiocco](S2).',
      bullets: [
        'Trades & Cap Ledger: Paraag Marathe converted DeForest Buckner base salary into bonus proration ([NFL Trade Rumors](S1)) to preserve $39.18M in Article 13 rollover.',
        'Practice Participation: Deebo Samuel returned on a limited basis while Kyle Shanahan monitored mid-week reps ([49ers Webzone](S3)).',
        'Week 10 Matchup Prep: Brock Purdy and Fred Warner headline locker-room preparation ahead of Sunday vs. Dallas ([49ers.com](S4)).'
      ],
      citedSourceIds: ['S1', 'S2', 'S3', 'S4']
    }),
    cands,
    fullAppData
  );
  assert.ok(parsedAiBrief && parsedAiBrief.sources.length >= 4, 'Failed to parse valid Gemini 3.8 Flash High brief JSON');
  assert.ok(/\[[^\]]+\]\(https:\/\/[^)]+\)/.test(parsedAiBrief.summary), 'Expected S# citations converted to verified HTTPS links');
  assert.ok(!/\(\[|\bper\s+\[/i.test(parsedAiBrief.summary), 'Expected wrapping parens and "per " stripped around inline link icons');

  // 4. Breaking-Above-Brief Ordering Rule (Identical in News -> All AND Home)
  const nowOrderMs = Date.now();
  const coveredSrcUrl = dailyBrief.sources[0].url;
  const coveredBreakingItem = {
    id: 'covered_brk_1',
    type: 'tweet',
    title: dailyBrief.sources[0].title,
    fullText: dailyBrief.sources[0].title,
    url: coveredSrcUrl,
    author: 'Adam Schefter',
    trustTier: 1,
    isBreaking: true,
    breakingBadge: 'BREAKING',
    publishedAt: new Date(nowOrderMs - 20 * 60_000).toISOString()
  };
  const uncoveredNewBreakingItem = {
    id: 'uncovered_new_brk_1',
    type: 'tweet',
    title: 'BREAKING: 49ers sign veteran All-Pro guard Zack Martin to a 1-year deal off waivers ahead of Week 10.',
    fullText: 'BREAKING: 49ers sign veteran All-Pro guard Zack Martin to a 1-year deal off waivers ahead of Week 10.',
    url: 'https://x.com/AdamSchefter/status/9999999999999999991',
    author: 'Adam Schefter',
    trustTier: 1,
    isBreaking: true,
    breakingBadge: 'BREAKING',
    publishedAt: new Date(nowOrderMs - 5 * 60_000).toISOString()
  };
  assert.equal(isBreakingItemCoveredInBrief(coveredBreakingItem, dailyBrief), true, 'Covered breaking story must be recognized as already in brief');
  assert.equal(isBreakingItemCoveredInBrief(uncoveredNewBreakingItem, dailyBrief), false, 'Brand-new breaking story must be recognized as uncovered');

  const partCoveredOnly = partitionBreakingNewsAboveBrief([coveredBreakingItem], dailyBrief, nowOrderMs);
  assert.equal(partCoveredOnly.breakingAboveBrief.length, 0, 'Already-covered breaking news must NOT jump above Daily Brief');

  const partWithUncovered = partitionBreakingNewsAboveBrief(
    [uncoveredNewBreakingItem, coveredBreakingItem],
    dailyBrief,
    nowOrderMs
  );
  assert.equal(partWithUncovered.breakingAboveBrief.length, 1);
  assert.equal(partWithUncovered.breakingAboveBrief[0].id, 'uncovered_new_brk_1');

  // Verify BOTH News -> All AND Home render uncovered breaking news ABOVE `[data-daily-news-brief]`!
  const mockDataWithUncovered = {
    ...fullAppData,
    news: {
      ...fullAppData.news,
      rawStream: [uncoveredNewBreakingItem, ...fullAppData.news.rawStream]
    }
  };
  const newsAllWithBrkHtml = renderNewsViewHtml({
    appData: mockDataWithUncovered,
    newsCategoryFilter: 'all',
    filteredRawItems: mockDataWithUncovered.news.rawStream,
    reportersById: new Map(),
    activeVideosSet: new Set(),
    userPrefs: {}
  });
  const newsBrkPos = newsAllWithBrkHtml.indexOf('data-breaking-above-brief');
  const newsBriefPos = newsAllWithBrkHtml.indexOf('data-daily-news-brief');
  assert.ok(newsBrkPos > -1 && newsBriefPos > -1 && newsBrkPos < newsBriefPos, 'Uncovered breaking news must render ABOVE Daily Brief in News -> All');

  const seasonStateNow = evaluateSeasonState({
    now: new Date(),
    calendar: fullAppData.meta.calendar,
    teamStatus: fullAppData.meta.teamStatus
  });
  const homeWithBrkHtml = renderHomeDashboardHtml({
    orderedBlocks: resolveOrderedDashboardBlocks(seasonStateNow.activeBlocks, []),
    archivedBlocks: seasonStateNow.archivedBlocks,
    appData: mockDataWithUncovered,
    simCapResult: simulateCapScenario(fullAppData.cap, {}),
    mcSimResult: fullAppData.seasonal.playoffPicture.baselineSimulation,
    filteredRawItems: mockDataWithUncovered.news.rawStream,
    isCustomizingLayout: false
  });
  const homeBrkPos = homeWithBrkHtml.indexOf('data-breaking-above-brief');
  const homeBriefPos = homeWithBrkHtml.indexOf('data-daily-news-brief');
  assert.ok(homeBrkPos > -1 && homeBriefPos > -1 && homeBrkPos < homeBriefPos, 'Uncovered breaking news must render ABOVE Daily Brief on Home screen');

  // 5. Post-Game Stale Video Pruning, JT O'Sullivan QB School Film Classification & 0% Video Overlap
  const staleAtlantaVideo = {
    id: 'yt_stale_atl',
    type: 'video',
    videoId: 'staleAtl123',
    title: '49ers Playbook: SF Falls Flat in ATL vs Falcons',
    outletName: "Jonnydel's Football Academy",
    publishedAt: new Date(Date.now() - 16 * 86_400_000).toISOString()
  };
  const recentPriorWeekOpponentVideo = {
    id: 'yt_prior_opp',
    type: 'video',
    videoId: 'priorFalcons99',
    title: 'San Francisco 49ers vs. Atlanta Falcons Full Game Highlights',
    outletName: 'NFL',
    publishedAt: new Date(Date.now() - 9 * 86_400_000).toISOString()
  };
  const freshRaidersHighlight = {
    id: 'yt_fresh_lv',
    type: 'video',
    videoId: 'freshRaiders99',
    title: 'Las Vegas Raiders vs. San Francisco 49ers Game Highlights | Week 9',
    outletName: 'NFL',
    publishedAt: new Date(Date.now() - 2 * 86_400_000).toISOString()
  };
  assert.equal(isStalePriorGameVideo(staleAtlantaVideo, fullAppData), true, '2-week-old video must be pruned');
  assert.equal(isStalePriorGameVideo(recentPriorWeekOpponentVideo, fullAppData), true, 'Prior-opponent highlight video must be pruned after a newer game is played');
  assert.equal(isStalePriorGameVideo(freshRaidersHighlight, fullAppData), false, 'Latest completed game highlights must be preserved');

  const qbSchoolPurdyVideo = {
    id: 'yt_qbschool_purdy',
    type: 'video',
    videoId: 'qbschoolPurdy1',
    title: 'Brock Purdy Week 9 Analysis: Anticipation & Layered Throws',
    outletName: 'The QB School',
    author: "JT O'Sullivan • The QB School",
    publishedAt: new Date(Date.now() - 24 * 3_600_000).toISOString()
  };
  assert.equal(classifyNewsItemCategory(qbSchoolPurdyVideo), 'film', "JT O'Sullivan's The QB School videos of 49ers QBs must classify into Film & Trench");
  assert.equal(classifyNewsItemCategory(freshRaidersHighlight), 'beat', 'Game highlight reel must stay in Highlights & Videos (not Film & Trench)');

  // Verify 0% video duplication between rendered Highlights & Videos (`videos`) and Film & Trench (`film`)
  const videosTabHtml = renderNewsViewHtml({
    appData: fullAppData,
    newsCategoryFilter: 'videos',
    filteredRawItems: [...fullAppData.news.rawStream, qbSchoolPurdyVideo],
    reportersById: new Map(),
    activeVideosSet: new Set(),
    userPrefs: {}
  });
  const filmTabHtml = renderNewsViewHtml({
    appData: fullAppData,
    newsCategoryFilter: 'film',
    filteredRawItems: [...fullAppData.news.rawStream, qbSchoolPurdyVideo],
    reportersById: new Map(),
    activeVideosSet: new Set(),
    userPrefs: {}
  });
  const extractRenderedVidIds = html =>
    new Set(
      [...html.matchAll(/youtube\.com\/(?:watch\?v=|embed\/)([A-Za-z0-9_-]{6,15})/g)].map(m => m[1])
    );
  const hlVidIds = extractRenderedVidIds(videosTabHtml);
  const filmVidIds = extractRenderedVidIds(filmTabHtml);
  assert.ok(hlVidIds.size >= 8, `Expected >=8 distinct highlight/team videos in Highlights & Videos, got ${hlVidIds.size}`);
  assert.ok(
    videosTabHtml.includes('Player Highlights') && videosTabHtml.includes('Highlights'),
    'Highlights & Videos must render both Player Highlights cutups and full/team Game Highlights badges'
  );
  assert.ok(
    videosTabHtml.includes('Jordan Watkins') && videosTabHtml.includes('Brock Purdy') && videosTabHtml.includes('Christian McCaffrey'),
    'Highlights & Videos must surface individual player highlight cutups (e.g. Jordan Watkins, Brock Purdy, Christian McCaffrey) without collapsing them into a single card'
  );
  // Multi-week documentary titles ("Forty Niner Way: Week 7 & 9") must NOT be misclassified as stale
  assert.equal(
    isStalePriorGameVideo(
      {
        id: 'yt_49way',
        type: 'video',
        videoId: 'bgKkQX4AnHM',
        title: 'Forty Niner Way: “Back to the Bay” | Week 7 & 9 (vs. Falcons + Raiders)',
        outletName: 'San Francisco 49ers',
        publishedAt: new Date(Date.now() - 12 * 3_600_000).toISOString()
      },
      fullAppData
    ),
    false,
    'Multi-week Forty Niner Way covering latest completed week (Week 7 & 9) must be preserved'
  );
  // Verify distinct short vs long highlight videos stay separate while exact twin uploads merge
  const distinctAndTwinVideos = deduplicateAndGroupWireItems(
    [
      {
        id: 'yt_short_hl',
        type: 'video',
        videoId: 'shortHl1',
        duration: '2:20',
        title: 'Las Vegas Raiders vs. San Francisco 49ers Highlights | Week 9',
        outletName: 'San Francisco 49ers',
        publishedAt: new Date().toISOString()
      },
      {
        id: 'yt_long_hl',
        type: 'video',
        videoId: 'longHl1',
        duration: '15:15',
        title: 'Las Vegas Raiders vs. San Francisco 49ers Game Highlights | 2026 NFL Season Week 9',
        outletName: 'NFL',
        publishedAt: new Date().toISOString()
      },
      {
        id: 'yt_watkins_hl',
        type: 'video',
        videoId: 'watkinsHl1',
        duration: '1:10',
        title: 'Jordan Watkins - Highlights - San Francisco 49ers vs Las Vegas Raiders - NFL Week 9 2026',
        mentionedPlayers: [{ id: 'watkins', name: 'Jordan Watkins' }],
        outletName: 'San Francisco 49ers Fans',
        publishedAt: new Date().toISOString()
      },
      {
        id: 'yt_purdy_sf',
        type: 'video',
        videoId: 'purdySf1',
        duration: '2:59',
        title: "Brock Purdy's Best Plays from 3-TD Game vs. Raiders | Week 9",
        mentionedPlayers: [{ id: 'purdy', name: 'Brock Purdy' }],
        outletName: 'San Francisco 49ers',
        publishedAt: new Date().toISOString()
      },
      {
        id: 'yt_purdy_nfl',
        type: 'video',
        videoId: 'purdyNfl1',
        duration: '2:59',
        title: "Brock Purdy's best plays from 3-TD game vs. Raiders | Week 9",
        mentionedPlayers: [{ id: 'purdy', name: 'Brock Purdy' }],
        outletName: 'NFL',
        publishedAt: new Date().toISOString()
      }
    ],
    { preserveFormat: 'videos' }
  );
  assert.equal(
    distinctAndTwinVideos.length,
    4,
    `Expected 4 distinct playable video cards (2:20 recap, 15:15 full mashup, 1:10 Watkins clip, 2:59 Purdy clip with twin deduped), got ${distinctAndTwinVideos.length}`
  );
  assert.ok(filmVidIds.has('qbschoolPurdy1'), "Expected JT O'Sullivan QB School video in Film & Trench");
  for (const vidId of hlVidIds) {
    assert.ok(!filmVidIds.has(vidId), `Duplicate video "${vidId}" appeared in both Highlights & Videos and Film & Trench`);
  }

  // 6. Salient Cap News Folded Into Trades & Roster (No Separate AI Cap Brief)
  const capRestructureItem = {
    id: 'cap_buckner_1',
    type: 'tweet',
    title: '49ers restructured DT DeForest Buckner’s contract, converting base salary into a signing bonus to create $5.2M in 2026 salary cap space.',
    fullText: '49ers restructured DT DeForest Buckner’s contract, converting base salary into a signing bonus to create $5.2M in 2026 salary cap space.',
    author: 'Matt Maiocco',
    url: 'https://x.com/MaioccoNBCS/status/2120617948138409999',
    publishedAt: new Date(Date.now() - 2 * 3_600_000).toISOString()
  };
  assert.equal(isSalientCapOrContractItem(capRestructureItem), true);
  assert.equal(classifyNewsItemCategory(capRestructureItem), 'roster', 'Salient cap news must fold directly into Trades & Roster');
  const rosterTabHtml = renderNewsViewHtml({
    appData: fullAppData,
    newsCategoryFilter: 'roster',
    filteredRawItems: [capRestructureItem, ...fullAppData.news.rawStream],
    reportersById: new Map(),
    activeVideosSet: new Set(),
    userPrefs: {}
  });
  assert.ok(rosterTabHtml.includes('DeForest Buckner') && rosterTabHtml.includes('CAP &amp; CONTRACT'), 'Trades & Roster must surface salient cap news with CAP & CONTRACT signal badge');
  assert.ok(!rosterTabHtml.includes('data-daily-news-brief'), 'Trades & Roster must not render an AI brief');
});

test('3-Lens NFL Draft Big Board Engine: 250+ Depth, NR-at-Bottom Sorting (Asc & Desc), Delta/Spread Math, Multi-Filters, URL Sync & Tooltip-Links', () => {
  // 1. Exact Delta & Spread Math + NR handling
  const synthetic = [
    {
      name: 'Prospect A',
      pos: 'EDGE',
      school: 'Texas',
      boards: {
        consensus: { rank: 1, updated_at: '2026-11-12' },
        buzz: { rank: 1, updated_at: '2026-11-11' },
        pff: { rank: 2, updated_at: '2026-11-08' }
      }
    },
    {
      name: 'Prospect B',
      pos: 'QB',
      school: 'Oregon',
      boards: {
        consensus: { rank: 14, updated_at: '2026-11-12' },
        buzz: { rank: 5, updated_at: '2026-11-11' },
        pff: { rank: 23, updated_at: '2026-11-08' }
      }
    },
    {
      name: 'Prospect C (Early Unranked)',
      pos: 'IOL',
      school: 'Iowa',
      boards: {
        consensus: { rank: 40, updated_at: '2026-11-12' },
        buzz: { rank: null, updated_at: '2026-11-11' },
        pff: { rank: 18, updated_at: '2026-11-08' }
      }
    },
    {
      name: 'Prospect D (Late Unranked)',
      pos: 'CB',
      school: 'Georgia',
      boards: {
        consensus: { rank: 195, updated_at: '2026-11-12' },
        buzz: { rank: null, updated_at: '2026-11-11' },
        pff: { rank: null, updated_at: '2026-11-08' }
      }
    }
  ];

  const normB = normalizeBigBoardProspect(synthetic[1], 1, 2027);
  assert.equal(normB.boards.buzz.delta, 9, 'Consensus #14 vs Buzz #5 must yield +9 delta');
  assert.equal(normB.boards.pff.delta, -9, 'Consensus #14 vs PFF #23 must yield -9 delta');
  assert.equal(normB.spread, 18, 'Max(23, 14, 5) - Min(23, 14, 5) must equal 18');
  assert.equal(normB.tier, 2, 'Rank #14 must map to Tier 2 (13–32)');

  // 2. NR stays pinned to bottom on BOTH Asc and Desc, tiebreaking NR rows by Consensus Rank ASC
  const buzzAsc = queryBigBoardProspects(synthetic, { sortField: 'buzz', sortDir: 'asc' }).items;
  assert.deepEqual(
    buzzAsc.map(p => p.name),
    ['Prospect A', 'Prospect B', 'Prospect C (Early Unranked)', 'Prospect D (Late Unranked)'],
    'Buzz ASC must sort #1 -> #5 -> NR(Cons #40) -> NR(Cons #195)'
  );

  const buzzDesc = queryBigBoardProspects(synthetic, { sortField: 'buzz', sortDir: 'desc' }).items;
  assert.deepEqual(
    buzzDesc.map(p => p.name),
    ['Prospect B', 'Prospect A', 'Prospect C (Early Unranked)', 'Prospect D (Late Unranked)'],
    'Buzz DESC must sort #5 -> #1 while keeping NR rows pinned at the bottom in Consensus ASC order'
  );

  const spreadDesc = queryBigBoardProspects(synthetic, { sortField: 'spread', sortDir: 'desc' }).items;
  assert.equal(spreadDesc[0].name, 'Prospect C (Early Unranked)'); // spread 22 (40 - 18)
  assert.equal(spreadDesc[1].name, 'Prospect B'); // spread 18
  assert.equal(spreadDesc[3].name, 'Prospect D (Late Unranked)', 'Single-board null spread must stay pinned at bottom');

  // 3. Multi-select Positions, Agreement (Polarizing / Locks), Range & Ranked-Only
  const multiPos = queryBigBoardProspects(synthetic, { positions: ['QB', 'EDGE'] }).items;
  assert.equal(multiPos.length, 2);
  const polarizingOnly = queryBigBoardProspects(synthetic, { agreement: 'polarizing' }).items;
  assert.equal(polarizingOnly.length, 2);
  const locksOnly = queryBigBoardProspects(synthetic, { agreement: 'locks' }).items;
  assert.equal(locksOnly.length, 1);
  assert.equal(locksOnly[0].name, 'Prospect A');
  const buzzRankedOnly = queryBigBoardProspects(synthetic, { lens: 'buzz', sortField: 'buzz', rankedOnly: true }).items;
  assert.equal(buzzRankedOnly.length, 2, 'rankedOnly must hide NR rows on selected lens');

  // 4. Shareable URL Query Param Serialization & Parsing
  const builtQuery = buildBigBoardUrlSearch('', {
    lens: 'buzz',
    sortField: 'buzz',
    sortDir: 'asc',
    positions: ['QB', 'EDGE'],
    range: 'rd1',
    agreement: 'polarizing',
    rankedOnly: true,
    search: 'Oregon',
    includeDraftNav: true
  });
  const parsedQuery = parseBigBoardUrlParams(builtQuery);
  assert.equal(parsedQuery.hasBigBoardParams, true);
  assert.equal(parsedQuery.openDraftTab, true);
  assert.equal(parsedQuery.lens, 'buzz');
  assert.equal(parsedQuery.sortField, 'buzz');
  assert.equal(parsedQuery.sortDir, 'asc');
  assert.deepEqual(parsedQuery.positions, ['QB', 'EDGE']);
  assert.equal(parsedQuery.range, 'rd1');
  assert.equal(parsedQuery.agreement, 'polarizing');
  assert.equal(parsedQuery.rankedOnly, true);
  assert.equal(parsedQuery.search, 'Oregon');
  assert.equal(buildBigBoardUrlSearch('', {}), '', 'Default Big Board state must emit clean empty query string');

  // 5. Tooltip-Links Glossary Integrity (Buzz = Most Likely Draft Order; PFF = Most Accurate NFL Performance)
  const buzzTip = getJargonEntry('draft_buzz_edp');
  const pffTip = getJargonEntry('pff_big_board');
  const consTip = getJargonEntry('consensus_big_board');
  const srcTip = getJargonEntry('big_board_sources');
  assert.ok(buzzTip?.badge.includes('Most Likely') && /come off the NFL board|draft order/i.test(buzzTip.definition));
  assert.ok(pffTip?.badge.includes('Most Accurate') && /perform in the NFL/i.test(pffTip.definition));
  for (const tip of [consTip, buzzTip, pffTip, srcTip]) {
    assert.ok(Array.isArray(tip?.links) && tip.links.length >= 2, `Missing tooltip links on ${tip?.term}`);
    for (const l of tip.links) {
      assert.ok(l.url.startsWith('https://') && !isPaywalledOrBlockedUrl(l.url), `Invalid tooltip link: ${l.url}`);
    }
  }
  assert.ok(jargonInfoIcon('pff_big_board').includes('data-jargon="pff_big_board"'));

  // 6. Live seasonal.json 250+ Prospect Dataset Audit & Split Offense->Defense Position Filters
  assert.deepEqual(
    BIG_BOARD_QUICK_POS_PILLS.map(p => p.key),
    ['ALL', 'QB', 'RB', 'WR', 'TE', 'OL', 'DL_EDGE', 'LB', 'DB'],
    'Quick Big Board position pills must split QB/RB, WR/TE, DB/LB in strict Offense -> Defense order'
  );
  assert.deepEqual(BIG_BOARD_OFFENSE_POSITIONS, ['QB', 'RB', 'WR', 'TE', 'OT', 'IOL']);
  assert.deepEqual(BIG_BOARD_DEFENSE_POSITIONS, ['DL', 'EDGE', 'LB', 'CB', 'S']);
  assert.deepEqual(BIG_BOARD_INDIVIDUAL_POSITIONS, ['QB', 'RB', 'WR', 'TE', 'OT', 'IOL', 'DL', 'EDGE', 'LB', 'CB', 'S']);

  const liveSeasonal = JSON.parse(fs.readFileSync(path.join(rootDir, 'data', 'seasonal.json'), 'utf8'));
  const liveBb = liveSeasonal.draftPrep2027?.consensusBigBoard || [];
  assert.ok(liveBb.length >= 250, `Expected >= 250 prospects in live Big Board, got ${liveBb.length}`);
  assert.ok(liveBb.some(p => p.boards?.buzz?.rank === null), 'Live Big Board must include NR (null) late-round Buzz rows');
  assert.ok(liveBb.some(p => p.boards?.pff?.rank === null), 'Live Big Board must include NR (null) late-round PFF rows');
  assert.ok(liveBb.some(p => p.spread !== null && p.spread >= 15), 'Live Big Board must surface Polarizing (spread >= 15) prospects');

  for (const [grpKey, allowedSet] of [
    ['QB', new Set(['QB'])],
    ['RB', new Set(['RB'])],
    ['WR', new Set(['WR'])],
    ['TE', new Set(['TE'])],
    ['OL', new Set(['OT', 'IOL'])],
    ['DL_EDGE', new Set(['DL', 'EDGE'])],
    ['LB', new Set(['LB'])],
    ['DB', new Set(['CB', 'S'])]
  ]) {
    const grpRes = queryBigBoardProspects(liveBb, { posGroup: grpKey }).items;
    assert.ok(grpRes.length >= 5, `Expected >=5 prospects for split filter ${grpKey}, got ${grpRes.length}`);
    assert.ok(grpRes.every(p => allowedSet.has(p.canonicalPos)), `Split filter ${grpKey} leaked unexpected position`);
  }
});

await testAsync('Shared Podcast Hero UX & iOS Safari WASM q8 Audio Pipeline Safety', async () => {
  const { splitTurnIntoSpokenSentences } = await import('../src/workers/neuralTtsWorker.js');

  // 1. Verify neuralTtsWorker never loads 310 MB fp32 WebGPU weights that OOM-kill iOS Safari Workers
  const workerSrc = fs.readFileSync(path.join(rootDir, 'src', 'workers', 'neuralTtsWorker.js'), 'utf8');
  assert.ok(workerSrc.includes("device: 'wasm'") && workerSrc.includes("dtype: 'q8'"), 'Must use quantized WASM q8');
  assert.ok(
    !workerSrc.includes("loadWithBackend('webgpu'") && !workerSrc.includes("'fp32'"),
    'Must never attempt 310 MB fp32 WebGPU load inside mobile WebKit Worker'
  );

  // 2. Verify sentence-level micro-chunking keeps ONNX passes compact while preserving short latches
  const longTurn =
    'Right! Look at how Keenan Allen wins from the slot against two-high quarters coverage on third and medium, especially when Ricky Pearsall stretches the field vertically outside the numbers. Furthermore, under CBA Article 13 rollover rules, every dollar spent on midseason wide receiver depth reduces San Francisco’s 2027 cap cushion, which means Kyle Shanahan has to maximize veteran route discipline immediately.';
  const chunks = splitTurnIntoSpokenSentences(longTurn, 195);
  assert.ok(chunks.length >= 2 && chunks.length <= 4, `Expected 2-4 sentence chunks, got ${chunks.length}`);
  assert.ok(chunks[0].startsWith('Right! Look at how Keenan Allen'), 'Short interjection must stay latched to first sentence');
  assert.ok(chunks.every(c => c.length <= 240), `Sentence chunk exceeded compact WASM bound: ${JSON.stringify(chunks)}`);

  // 3. Verify Shared Podcast Hero renders ABOVE generator & API key box and never hijacks Create-Podcast stepper
  const sharedEp = {
    id: 'custom_ep_dad_share',
    title: 'Keenan Allen Fit in 49ers Scheme',
    topic: 'Keenan Allen Fit in 49ers Scheme',
    format: 'Two-Host Analytical Banter',
    presetLabel: '2m On-Demand Pod',
    createdBy: 'Josh',
    createdAt: '2026-11-12T01:00:00.000Z',
    durationSec: 131,
    isSharedImport: true,
    transcript: [
      { idx: 0, speaker: 'Marcus', startSec: 0, endSec: 15, text: 'Let us break down Keenan Allen in Kyle Shanahan’s offense.' },
      { idx: 1, speaker: 'Elena', startSec: 15, endSec: 32, text: 'The slot leverage and 9/18ths cap math tell the whole story.' }
    ]
  };

  const prepHtml = renderAudioAiViewHtml({
    studioSub: 'podcast',
    userPrefs: { geminiApiKey: '' },
    audioState: {
      episode: sharedEp,
      isPlaying: false,
      isBufferingAudio: true,
      isAutoPlayQueued: false,
      currentTimeSec: 0,
      durationSec: 131
    },
    sharedAudioPrep: {
      active: true,
      episodeId: sharedEp.id,
      startedAtMs: Date.now() - 4000,
      percent: 44,
      message: 'Caching studio voice weights (44% • 39 / 88 MB — 1-time download)…',
      subDetail: 'No API key required — caching stereo audio directly on this device.'
    },
    allEpisodes: [sharedEp]
  });

  const sharedHeroIdx = prepHtml.indexOf('data-podcast-ready-card="custom_ep_dad_share"');
  const genCardIdx = prepHtml.indexOf('data-podcast-generator-card');
  const keyCardIdx = prepHtml.indexOf('data-gemini-setup-card="unconnected"');
  assert.ok(
    sharedHeroIdx > -1 && genCardIdx > -1 && sharedHeroIdx < genCardIdx && sharedHeroIdx < keyCardIdx,
    'Shared Podcast Hero card must render ABOVE the Auto Podcast generator card and API key setup box'
  );
  assert.ok(prepHtml.includes('data-shared-audio-prep="active"'), 'Must render dedicated shared-audio prep progress inside hero card');
  assert.ok(prepHtml.includes('width:44%') && prepHtml.includes('>44%<'), 'Shared-audio prep bar must reflect live percentage (never frozen at 20%)');
  assert.ok(!prepHtml.includes('data-job-progress="active"'), 'Preparing shared audio must NEVER trigger "Creating Studio Podcast…" 3-step banner');
  assert.ok(!prepHtml.includes('Creating 3-Min Podcast'), 'Generator CTA button must remain idle while shared link prepares audio');
  assert.ok(prepHtml.includes('Play When Ready'), 'Primary button must invite 1-tap Play When Ready during prep');

  // 4. Verify Auto-Play Armed state and graceful Retry + Device Voice error recovery UI
  const queuedHtml = renderAudioAiViewHtml({
    studioSub: 'podcast',
    userPrefs: { geminiApiKey: '' },
    audioState: {
      episode: sharedEp,
      isPlaying: false,
      isBufferingAudio: true,
      isAutoPlayQueued: true,
      currentTimeSec: 0,
      durationSec: 131
    },
    sharedAudioPrep: {
      active: true,
      episodeId: sharedEp.id,
      startedAtMs: Date.now() - 6000,
      percent: 68,
      message: 'Synthesizing studio voices — Turn 2 of 2 (Elena)…'
    },
    allEpisodes: [sharedEp]
  });
  assert.ok(queuedHtml.includes('Auto-Play Queued…'), 'Must confirm Auto-Play Queued once user taps Play during prep');

  const errorHtml = renderAudioAiViewHtml({
    studioSub: 'podcast',
    userPrefs: { geminiApiKey: '' },
    audioState: { episode: sharedEp, isPlaying: false, isBufferingAudio: false, currentTimeSec: 0, durationSec: 131 },
    sharedAudioPrep: {
      active: false,
      episodeId: sharedEp.id,
      error: 'Network connection interrupted while caching voice weights.'
    },
    allEpisodes: [sharedEp]
  });
  assert.ok(
    errorHtml.includes('data-action="retry-shared-audio"') &&
      errorHtml.includes('data-action="play-device-voice"'),
    'Shared audio error state must expose both Retry Studio Audio and Listen Now (Device Voice) recovery actions'
  );
});

console.log(`\n======================================================`);
console.log(`UNIT & DATA QA SUMMARY: ${passed} Passed, ${failed} Failed`);
console.log(`======================================================\n`);

if (failed > 0) {
  process.exit(1);
}
