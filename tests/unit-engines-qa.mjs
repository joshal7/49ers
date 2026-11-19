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
  DEFAULT_HOME_BLOCK_IDS,
  evaluateSeasonState,
  evaluateTradeDeadlineStatus,
  resolveHomeDashboardState,
  resolveOrderedDashboardBlocks,
  partitionCompletedTradesByWindow,
  normalizeScheduleGameItem,
  resolveCompleteScheduleModel
} from '../src/engine/seasonStateMachine.js';
import {
  isEditorialPhotoUrl,
  isHeadshotImageUrl,
  optimizeImageUrlForSlot,
  resolveSalientCardVisual,
  resolveDailyBriefHeroMedia,
  resolveAudioEpisodeVisual
} from '../src/engine/salientMediaEngine.js';
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
  classifyIrAndReserveTimeline,
  evaluateWeeklyIrActivationWindow,
  hasWindowDefinitelyNotOpeningSignal,
  hasDefiniteIrNonActivationOrWindowClosedSignal,
  sanitizeIrBeatNoteForCurrentWeek,
  detectOpen21DayIrWindowFromHistory,
  extractPracticeDaysFromText,
  hasTrendingDownwardSignal,
  hasTrendingUpwardSignal,
  evaluateCorroboratedNewsInjurySignal,
  resolveOfficialReportGameStatus,
  reconcileRosterAndHealthWithNews
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
  NEWS_SORT_MODES,
  normalizeNewsSortMode,
  getItemReadKey,
  isItemRead,
  computeCatchUpState,
  sortNewsFeedByMode,
  extractTrendingTopicChips,
  filterItemsByTopicChip,
  classifySourceLensTag,
  buildStoryTimelineEntries,
  shouldShowItemAskAiButton,
  computePracticeTrajectoryDelta,
  formatRankDeltaCue,
  formatPlayoffOddsDeltaCue,
  extractPresserTakeaways,
  estimateItemEffortCue,
  extractInlinePreviewVisual,
  runUniversalSearch,
  urlBase64ToUint8Array
} from '../src/engine/digestExperienceEngine.js';
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
  createPlayerIdentityResolver,
  isAllowedInlineVideoStreamUrl,
  selectBestXSyndicationMp4
} from '../src/engine/linkIntegrity.js';
import {
  validateNoHallucinatedRosterClaims,
  sanitizeHallucinatedRosterText,
  buildLiveGroundingSystemPrompt,
  buildAuthoritativeLiveContextSnapshot
} from '../src/engine/groundingValidator.js';
import {
  SHORT_TWEET_FULL_TEXT_LIMIT,
  WIRE_ARTICLE_EXCERPT_MAX_CHARS,
  WIRE_SUMMARY_EXPAND_THRESHOLD,
  WIRE_SUMMARY_PREVIEW_MAX,
  buildBoundedWireSummary,
  splitSummaryForExpandableDisplay,
  sanitizeOversizedDirectArticleSummary,
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
  extractBlueskyBestExternalLink,
  resolveTweetLinkedArticlePreview,
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
  resolveNewsBriefCycleState,
  isAppDataAwaitingLivePostGameHydration,
  isDailyBriefStaleForLiveState,
  evaluateGameDayAboveBriefWindow,
  partitionBreakingNewsAboveBrief
} from '../src/engine/breakingClassifier.js';
import {
  NFL_TEAM_OFFICIAL_RSS_URLS,
  evaluateGameDayWindow,
  isBeforeWeeklyPracticeWindow,
  classifyRosterUnit,
  discoverOfficialClubInactivesRssItem,
  parseOfficialClubInactivesArticle,
  parseRotoWireInactivesHtml,
  extractSleeperGameDaySignals,
  extractLiveInGameInjurySignals,
  extractWireGameDaySignals,
  buildTeamGameDayRosterModel,
  resolveGameDayInjuryRows,
  resolveEarlyWeekRolloverInput,
  rolloverPracticeReportForUpcomingWeek,
  extractCompletedGameRecapSummary,
  formatCompletedGameRecapForPrompt
} from '../src/engine/gameDayRosterEngine.js';
import {
  rankSecondTierGeminiFlashModels,
  extractGeminiModelFamilyKey,
  buildGeminiThinkingConfig
} from '../src/engine/geminiStudioPrompts.js';
import {
  hydrateLiveGameDayRosters,
  persistWeeklyPracticeSnapshot,
  hydrateCachedWeeklyPracticeAndInactives
} from '../src/services/dataService.js';
import { buildTeamInjuryNewsFeed } from '../src/engine/injuryProbabilityModel.js';
import {
  NEWS_NAV_CLUSTERS,
  VALID_NEWS_CATEGORIES,
  renderNewsViewHtml,
  renderDailyTopNewsBriefHtml,
  renderWireItemCardHtml
} from '../src/views/newsView.js';
import { renderInjuryNewsItemCardHtml } from '../src/views/playerSheetView.js';
import { renderHomeDashboardHtml } from '../src/views/homeView.js';
import {
  DAILY_NEWS_BRIEF_PEAK_HOUR_PT,
  getDailyNewsBriefCycleKey,
  selectTopNewsBriefSourceCandidates,
  hasActiveCapOrTransactionStoryline,
  buildDailyTopNewsBriefPrompt,
  buildDailyMatchupIntelPrompt,
  parseAndSanitizeDailyTopNewsBrief,
  buildDeterministicDailyTopNewsBrief,
  repairDailyTopNewsBriefLinks,
  hydrateCachedDailyTopNewsBrief,
  hasPendingPostGameAiBriefAttempt,
  shouldTriggerDailyTopNewsBriefRefresh
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

console.log('\n=== [1/6] Year-Round Dashboard & League-Cycle Engine QA ===');

test('All calendar dates emit tighter 6-card Home default with 0 archived blocks and zero calendar content gates', () => {
  const expectedTightHome = [
    'news_briefs',
    'upcoming_matchup',
    'team_health',
    'team_stats',
    'salary_cap',
    'autopodcast_ai'
  ];
  assert.deepEqual(DEFAULT_HOME_BLOCK_IDS, expectedTightHome);

  for (const ts of [
    '2026-06-15T12:00:00-07:00',
    '2026-09-18T12:00:00-07:00',
    '2026-11-06T21:30:00-08:00',
    '2026-11-10T13:01:00-08:00',
    '2026-12-15T12:00:00-08:00',
    '2027-01-25T10:00:00-08:00',
    '2027-04-23T12:00:00-07:00'
  ]) {
    const s = evaluateSeasonState({
      now: ts,
      teamStatus: { currentWeek: 10, mathematicallyEliminated: true }
    });
    assert.deepEqual(s.activePhases, ['YEAR_ROUND']);
    assert.deepEqual(s.activeBlocks.map(b => b.id), expectedTightHome);
    assert.equal(s.optionalBlocks.length, 6);
    assert.deepEqual(s.archivedBlocks, [], `Expected 0 archived blocks at ${ts}`);
  }
});

test('evaluateTradeDeadlineStatus provides factual pre-deadline countdown vs post-deadline horizon without gating views', () => {
  const preDeadline = evaluateTradeDeadlineStatus({ now: '2026-11-06T21:30:00-08:00' });
  assert.equal(preDeadline.isPreDeadline, true);
  assert.equal(preDeadline.isPostDeadlinePause, false);
  assert.ok(preDeadline.countdownText?.includes('Deadline:'));

  const postDeadline = evaluateTradeDeadlineStatus({ now: '2026-11-10T13:01:00-08:00' });
  assert.equal(postDeadline.isPreDeadline, false);
  assert.equal(postDeadline.isPostDeadlinePause, true);
  assert.equal(postDeadline.countdownText, null);

  const springOffseason = evaluateTradeDeadlineStatus({ now: '2027-03-15T12:00:00-07:00' });
  assert.equal(springOffseason.isPostDeadlinePause, false);
});

test('resolveHomeDashboardState supports pinning optional modules, hiding default modules, and enforcing >=1 visible floor', () => {
  const base = resolveHomeDashboardState();
  assert.equal(base.orderedBlocks.length, 6);
  assert.equal(base.optionalBlocks.length, 6);

  const customized = resolveHomeDashboardState({
    savedOrderIds: ['playoff_picture', 'news_briefs', 'upcoming_matchup', 'salary_cap', 'autopodcast_ai'],
    hiddenBlockIds: ['team_health', 'team_stats'],
    pinnedBlockIds: ['playoff_picture', 'draft_prep']
  });
  assert.deepEqual(customized.orderedBlocks.map(b => b.id), [
    'playoff_picture',
    'news_briefs',
    'upcoming_matchup',
    'draft_prep',
    'salary_cap',
    'autopodcast_ai'
  ]);

  // Hiding every block falls back safely to keeping at least 1 block visible
  const hideAll = resolveHomeDashboardState({
    hiddenBlockIds: ALL_DASHBOARD_BLOCKS.map(b => b.id)
  });
  assert.equal(hideAll.orderedBlocks.length, 1);
  assert.equal(hideAll.orderedBlocks[0].id, 'news_briefs');
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
  // Seed pre-Week-9-completion state deterministically so this test verifies Week 9 -> Week 10 rollover on any calendar week
  mockAppData.meta.currentWeek = 9;
  mockAppData.meta.teamRecord = '6-1';
  mockAppData.scheduleMatchup.upcomingMatchup.week = 9;
  mockAppData.scheduleMatchup.upcomingMatchup.oppAbbr = 'LV';
  for (const g of mockAppData.scheduleMatchup.schedule) {
    if (Number(g.week) >= 9) {
      g.completed = false;
      g.result = null;
      g.sfScore = null;
      g.oppScore = null;
    }
  }

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
  assert.ok(
    capData.years['2026'].deadMoneyTotal >= 45_000_000 &&
      capData.years['2026'].deadMoneyTotal < 75_000_000,
    `2026 OTC Dead Money (${capData.years['2026'].deadMoneyTotal}) must reflect single-counted dead cap without ~2x footer double-counting`
  );
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
  const earlyWeek = isBeforeWeeklyPracticeWindow(
    sched.upcomingMatchup?.kickoffIso || '',
    Date.parse(sched.updatedAt || '')
  );
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
    sf.seed1ByePct >= 20 && sf.seed1ByePct <= 68,
    `Expected calibrated #1 Seed Bye % in [20, 68], got ${sf.seed1ByePct}%`
  );
  assert.ok(
    sf.winDivisionPct >= 65 && sf.winDivisionPct <= 97,
    `Expected calibrated NFC West % in [65, 97], got ${sf.winDivisionPct}%`
  );
  assert.ok(
    sf.makePlayoffsPct >= 82 && sf.makePlayoffsPct <= 99.8,
    `Expected calibrated Playoff Berth % in [82, 99.8], got ${sf.makePlayoffsPct}%`
  );
  assert.ok(
    sf.projectedWins >= 11.0 && sf.projectedWins <= 14.5,
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

await testAsync('Worker live /api/analyze defaults to gemini-4-hydrogen on HIGH Thinking (while honoring explicit XHIGH), strips internal thought parts, and preserves external trade/dead-cap context', async () => {
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
    delete envPro.GEMINI_TEXT_MODEL; // verify live /api/analyze uses gemini-4-hydrogen on HIGH thinking!
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

    assert.ok(capturedUrl.includes('models/gemini-4-hydrogen:generateContent'), `Expected gemini-4-hydrogen URL, got ${capturedUrl}`);
    assert.deepEqual(capturedBody.generationConfig?.thinkingConfig, { thinkingLevel: 'HIGH' }, 'Expected live /api/analyze Gemini 4 Hydrogen HIGH thinkingLevel');
    assert.equal(res.item.modelUsed, 'gemini-4-hydrogen');
    assert.equal(res.item.thinkingLevel, 'HIGH');
    assert.ok(!res.item.markdown.includes('INTERNAL_SECRET_THOUGHT_SCRATCHPAD'), 'Thought part must never leak into output');
    assert.ok(!/Bryce Huff/i.test(res.item.markdown), 'Active-49er Bryce Huff hallucination must be scrubbed');
    assert.ok(/Javon Hargrave/i.test(res.item.markdown), 'Legitimate 2026 dead-cap mention of Javon Hargrave must be preserved');
    assert.ok(/Chase Young/i.test(res.item.markdown), 'Legitimate Saints trade-target mention of Chase Young must be preserved');
  } finally {
    globalThis.fetch = origFetch;
  }
});

await testAsync('Free-tier model discovery & Worker /api/model-status automatically rank Gemini 4 Hydrogen (XHIGH) #1 and fail over cleanly', async () => {
  assert.equal(DEFAULT_FREE_MODEL_CASCADE[0], 'gemini-4-hydrogen');
  assert.ok(
    scoreFreeTierGeminiModel('gemini-4-hydrogen') > scoreFreeTierGeminiModel('gemini-4.0-flash'),
    'gemini-4-hydrogen on XHIGH must outscore gemini-4.0-flash and all 3.x models'
  );
  assert.ok(
    scoreFreeTierGeminiModel('gemini-4-hydrogen') > scoreFreeTierGeminiModel('gemini-4-carbon') &&
      scoreFreeTierGeminiModel('gemini-4-hydrogen') > scoreFreeTierGeminiModel('gemini-4-argon'),
    'Free-Tier gemini-4-hydrogen must outscore paid-only Carbon/Argon tiers'
  );
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
  assert.equal(ranked[0], 'gemini-4-hydrogen', 'Merged fallback cascade must keep gemini-4-hydrogen at #1');
  assert.equal(ranked[1], 'gemini-3.9-flash', 'Catalog poll must rank newly released gemini-3.9-flash right behind Hydrogen');
  assert.equal(ranked[2], 'gemini-3.8-flash');

  const origFetch = globalThis.fetch;
  const calledUrls = [];
  globalThis.fetch = async reqUrl => {
    const u = String(reqUrl);
    calledUrls.push(u);
    if (u.includes('/v1beta/models?key=')) {
      return new Response(
        JSON.stringify({
          models: [
            { name: 'models/gemini-4-hydrogen', supportedGenerationMethods: ['generateContent'] },
            { name: 'models/gemini-3.8-flash', supportedGenerationMethods: ['generateContent'] }
          ]
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }
    if (u.includes('models/gemini-4-hydrogen:generateContent')) {
      // Simulate quota exhaustion / 429 on gemini-4-hydrogen to verify automatic failover to 3.8-flash
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
    assert.equal(statusRes.bestModel, 'gemini-4-hydrogen', 'Polling /api/model-status?poll=1 must discover gemini-4-hydrogen');
    assert.equal(statusRes.thinkingLevel, 'XHIGH');
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
    assert.ok(calledUrls.some(u => u.includes('models/gemini-4-hydrogen:generateContent')));
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

  // Nate Hobbs has open 21-day window targeting current week (or active on roster once activated)
  const hobbs = health.irAndReserveTracker.find(p => p.name === 'Nate Hobbs');
  const hobbsRoster = roster.players.find(p => p.name === 'Nate Hobbs');
  assert.ok(
    (hobbs && hobbs.isPracticeWindowOpen === true && /Week \d+/i.test(hobbs.projectedReturnWeek)) ||
      (hobbsRoster && hobbsRoster.rosterBucket === 'active'),
    'Nate Hobbs must either carry an active 21-day return window projection or be activated to the 53-man roster'
  );

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
  const sfEarlyWeek = isBeforeWeeklyPracticeWindow(
    matchupJson.upcomingMatchup.kickoffIso || '',
    Date.parse(health.updatedAt || '')
  );
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

  // Highest-quality Free-Tier model ranking: Gemini 4 Hydrogen (XHIGH) #1 -> 3.8 Flash (HIGH) #2 ahead of 0-quota Pro tiers
  assert.equal(DEFAULT_FREE_MODEL_CASCADE[0], 'gemini-4-hydrogen');
  assert.ok(scoreFreeTierGeminiModel('gemini-4-hydrogen') > scoreFreeTierGeminiModel('gemini-3.8-flash'));
  assert.ok(scoreFreeTierGeminiModel('gemini-3.8-flash') > scoreFreeTierGeminiModel('gemini-3.8-pro'));
  assert.ok(scoreFreeTierGeminiModel('gemini-3.8-flash') > scoreFreeTierGeminiModel('gemini-2.5-pro'));
  assert.deepEqual(DEFAULT_AUDIO_TTS_CASCADE, ['gemini-2.5-pro-preview-tts', 'gemini-2.5-flash-preview-tts']);

  // Clutter-free model label & rough estimated generation time scaling
  const labelInfo = resolveActiveHighQualityModelLabel({
    meta: { aiEngine: { activeModel: 'gemini-4-hydrogen', thinkingLevel: 'XHIGH' } }
  });
  assert.equal(labelInfo.modelId, 'gemini-4-hydrogen');
  assert.equal(labelInfo.thinkingLevel, 'XHIGH');
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
  assert.equal(cloud3.summaryText, '3 min pod • Est. 30–65 sec');
  assert.equal(cloud8.summaryText, '8 min pod • Est. 45–120 sec');
  assert.equal(cloud15.summaryText, '15 min pod • Est. 1.5–3 min');

  const localEst = estimateGenerationWait({ kind: 'podcast', durationMinutes: 3, prefs: {} });
  assert.equal(localEst.isCloud, false);
  assert.equal(localEst.summaryText, '3 min pod • Est. 30–65 sec');
  const analysisEst = estimateGenerationWait({ kind: 'analysis', prefs: {} });
  assert.equal(analysisEst.summaryText, 'Est. 15–40 sec');
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
    assert.equal(analyzeJson.item.modelUsed, 'gemini-4-hydrogen');
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
    assert.equal(podJson.episode.modelUsed, 'gemini-4-hydrogen');
    assert.equal(podJson.episode.thinkingLevel, 'HIGH');
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

await testAsync('Gemini Studio Prompts & Thinking Config enforce Gemini 4 Hydrogen (XHIGH) ranking, v1beta thinkingLevel/thinkingBudget exclusivity, and anti-robotic NotebookLM TTS preparation', async () => {
  const {
    scoreBestGeminiReasoningModel,
    rankBestGeminiReasoningModels,
    buildGeminiThinkingConfig,
    resolveGeminiThinkingLevelLabel,
    prepareConversationalTextForModernNeuralTts,
    chunkTurnsForGeminiTts,
    DEEP_RESEARCH_STAGE1_SYSTEM_PROMPT,
    DEEP_ANALYSIS_STAGE2_SYSTEM_PROMPT,
    NOTEBOOKLM_PODCAST_STAGE2_SYSTEM_PROMPT,
    NOTEBOOKLM_VOICE_PROFILES
  } = await import('../src/engine/geminiStudioPrompts.js');

  // Gemini 4 Hydrogen (`gemini-4-hydrogen` on `XHIGH`) strictly outranks 3.8 Flash/Pro, paid-only Carbon/Argon, and 0/0-quota 3.1/2.5 Pro
  assert.ok(scoreBestGeminiReasoningModel('gemini-4-hydrogen') > scoreBestGeminiReasoningModel('gemini-3.8-pro'));
  assert.ok(scoreBestGeminiReasoningModel('gemini-4-hydrogen') > scoreBestGeminiReasoningModel('gemini-3.8-flash'));
  assert.ok(scoreBestGeminiReasoningModel('gemini-4-hydrogen') > scoreBestGeminiReasoningModel('gemini-4-carbon'));
  assert.ok(scoreBestGeminiReasoningModel('gemini-4-hydrogen') > scoreBestGeminiReasoningModel('gemini-4-argon'));
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
    { name: 'models/gemini-4-hydrogen', supportedGenerationMethods: ['generateContent'] },
    { name: 'models/gemini-4-carbon', supportedGenerationMethods: ['generateContent'] },
    { name: 'models/gemini-3.8-flash', supportedGenerationMethods: ['generateContent'] },
    { name: 'models/gemini-3.6-flash', supportedGenerationMethods: ['generateContent'] },
    { name: 'models/gemini-3.1-pro-preview', supportedGenerationMethods: ['generateContent'] },
    { name: 'models/gemini-2.5-pro', supportedGenerationMethods: ['generateContent'] }
  ]);
  assert.equal(ranked[0], 'gemini-4-hydrogen');
  assert.equal(ranked[1], 'gemini-3.8-flash');
  assert.equal(ranked[2], 'gemini-3.6-flash');
  assert.equal(ranked.includes('gemini-3-pro-preview'), false, 'Ranked cascade must never include retired gemini-3-pro-preview');

  // Gemini 4 Hydrogen defaults to thinkingLevel: 'XHIGH' (scheduled) and supports 'HIGH' (live interactive); Gemini 3.x uses 'HIGH'; Gemini 2.5 uses thinkingBudget
  const cfgH = buildGeminiThinkingConfig('gemini-4-hydrogen');
  assert.deepEqual(cfgH, { thinkingLevel: 'XHIGH' });
  assert.equal('thinkingBudget' in cfgH, false);
  assert.equal(resolveGeminiThinkingLevelLabel('gemini-4-hydrogen'), 'XHIGH');

  const cfgHLive = buildGeminiThinkingConfig('gemini-4-hydrogen', null, {
    preferredThinkingLevel: 'HIGH'
  });
  assert.deepEqual(cfgHLive, { thinkingLevel: 'HIGH' });
  assert.equal('thinkingBudget' in cfgHLive, false);
  assert.equal(resolveGeminiThinkingLevelLabel('gemini-4-hydrogen', 'HIGH'), 'HIGH');
  assert.deepEqual(
    buildGeminiThinkingConfig('gemini-3.8-flash', null, { preferredThinkingLevel: 'XHIGH' }),
    { thinkingLevel: 'HIGH' }
  );

  const cfg38 = buildGeminiThinkingConfig('gemini-3.8-pro');
  assert.deepEqual(cfg38, { thinkingLevel: 'HIGH' });
  assert.equal('thinkingBudget' in cfg38, false);
  assert.equal(resolveGeminiThinkingLevelLabel('gemini-3.8-flash'), 'HIGH');

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

await testAsync('Dynamic Gemini Auto-Update selects Gemini 4 Hydrogen (XHIGH), migrates 0-quota Pro/Carbon prefs, and gracefully handles HTTP 429 quota exhaustion', async () => {
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
      verifiedGeminiModel: 'gemini-3.8-flash'
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
              { name: 'models/gemini-4-carbon', supportedGenerationMethods: ['generateContent'] },
              { name: 'models/gemini-4-hydrogen', supportedGenerationMethods: ['generateContent'] },
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
    assert.equal(res.bestModel, 'gemini-4-hydrogen', 'Should select Gemini 4 Hydrogen (gemini-4-hydrogen, XHIGH Free Tier) over 3.8-flash and 0-quota Carbon/Pro');
    assert.equal(userPrefs.verifiedGeminiModel, 'gemini-4-hydrogen', 'Should auto-update userPrefs in place');
    assert.equal(updatedModelReported, 'gemini-4-hydrogen', 'Should trigger onModelUpdated callback');

    // Verify resolved label migrates modelId internally while keeping UI shortModelName clutter-free
    const label = resolveActiveHighQualityModelLabel(null, userPrefs);
    assert.equal(label.shortModelName, 'Deep Research');
    assert.equal(label.modelId, 'gemini-4-hydrogen');
    assert.equal(label.thinkingLevel, 'XHIGH');

    // Verify stale retired gemini-3-pro-preview or 0-quota gemini-4-carbon in localStorage prefs is migrated to gemini-4-hydrogen
    const migratedLabel = resolveActiveHighQualityModelLabel(null, {
      verifiedGeminiModel: 'gemini-3-pro-preview'
    });
    assert.equal(migratedLabel.modelId, 'gemini-4-hydrogen');
    assert.equal(migratedLabel.thinkingLevel, 'XHIGH');
    assert.equal(migratedLabel.shortModelName, 'Deep Research');

    const migratedCarbon = resolveActiveHighQualityModelLabel(null, {
      verifiedGeminiModel: 'gemini-4-carbon'
    });
    assert.equal(migratedCarbon.modelId, 'gemini-4-hydrogen');
    assert.equal(migratedCarbon.thinkingLevel, 'XHIGH');

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
            models: [{ name: 'models/gemini-4-hydrogen', supportedGenerationMethods: ['generateContent'] }]
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
  const lastCompRegWeek = Math.max(
    ...liveSm.schedule
      .filter(g => (g.seasonType || 'REG') === 'REG' && g.completed && !g.isByeWeek)
      .map(g => Number(g.week))
  );
  assert.ok(unclinchedHtml.includes('2-1 Pre'), 'Previous Games summary must display 2-1 Pre badge alongside regular-season record');
  assert.ok(
    unclinchedHtml.includes(`PRE 1–3 • Wk 1–${lastCompRegWeek}`),
    `Previous Games summary must show PRE 1–3 • Wk 1–${lastCompRegWeek} range`
  );
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
  const activeRootingWk = Number(fullAppData.meta.currentWeek);
  const nextRootingWk = activeRootingWk + 1;
  assert.ok(playoffsHtml.includes('data-rooting-guide-weeks'), 'Rooting Guide must group games into week cards');
  assert.ok(
    playoffsHtml.includes(`data-rooting-week="${activeRootingWk}"`),
    `Rooting Guide must render Week ${activeRootingWk} card`
  );
  // Also verify multi-week Rooting Guide collapses the second week inside <details data-rooting-next-week>
  const twoWeekRootingAppData = {
    ...fullAppData,
    seasonal: {
      ...fullAppData.seasonal,
      playoffPicture: {
        ...fullAppData.seasonal.playoffPicture,
        rootingLeverage: [
          ...(fullAppData.seasonal.playoffPicture.rootingLeverage || []).slice(0, 2),
          {
            ...((fullAppData.seasonal.playoffPicture.rootingLeverage || [])[0] || {
              gameId: 'rg_wk_next',
              away: 'SEA',
              home: 'LAR',
              rootFor: 'SEA',
              leveragePct: 6.2
            }),
            gameId: 'rg_wk_next_synthetic',
            week: nextRootingWk
          }
        ]
      }
    }
  };
  const twoWeekPlayoffsHtml = renderSeasonMatchupViewHtml({
    seasonSub: 'playoffs',
    activePhases: ['YEAR_ROUND', 'IN_SEASON', 'PLAYOFF_PUSH'],
    appData: twoWeekRootingAppData,
    activeVideosSet: new Set()
  });
  assert.ok(
    twoWeekPlayoffsHtml.includes(
      `details class="subcard-panel rooting-week-card rooting-week-collapsible" data-rooting-week="${nextRootingWk}" data-rooting-next-week>`
    ),
    `Week after next (Week ${nextRootingWk}) must be an expandable collapsed <details> card`
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
    /\bOC\s+[A-Z][a-zA-Z'. -]+/.test(matchupHtml) && /\bDC\s+[A-Z][a-zA-Z'. -]+/.test(matchupHtml),
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

  // Verify 1/Day Live Gemini 4 Hydrogen (XHIGH) Matchup Intel spends strictly 1 credit/day and 0 on same-day repeat calls
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
    let lastMatchupReqUrl = '';
    let lastMatchupReqBody = null;
    globalThis.fetch = async (url, init) => {
      const u = String(url);
      if (u.includes('/models?')) {
        return new Response(
          JSON.stringify({
            models: [
              { name: 'models/gemini-4-hydrogen', supportedGenerationMethods: ['generateContent'] },
              { name: 'models/gemini-3.8-flash', supportedGenerationMethods: ['generateContent'] }
            ]
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
      generateCalls += 1;
      lastMatchupReqUrl = u;
      lastMatchupReqBody = init?.body ? JSON.parse(init.body) : null;
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
    assert.equal(firstRun.modelUsed, 'gemini-4-hydrogen');
    assert.ok(lastMatchupReqUrl.includes('models/gemini-4-hydrogen:generateContent'));
    assert.deepEqual(lastMatchupReqBody?.generationConfig?.thinkingConfig, { thinkingLevel: 'XHIGH' });
    assert.equal(firstRun.datePt, day1Pt);
    assert.equal(generateCalls, 1, 'Daily refresh must burn strictly 1 Gemini 4 Hydrogen request (1 credit)');

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

test('Unified 6-Tab News Architecture, 5PM PT Daily Gemini 4 Hydrogen (XHIGH) Top-News Brief, Breaking-Above-Brief Ordering & Disjoint Video/Cap Partitioning', () => {
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
  assert.ok(
    dailyBrief && dailyBrief.headline && Array.isArray(dailyBrief.bullets) && dailyBrief.bullets.length >= 3,
    'data/news.json must include dailyTopNewsBrief with headline and bullets'
  );
  assert.ok(
    dailyBrief.bullets.length >= 3 && dailyBrief.bullets.length <= 6,
    `Daily Top News Brief must contain 3–6 high-signal bullets, got ${dailyBrief.bullets.length}`
  );
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
  assert.ok(/~(185|205)–240\b/.test(promptText), 'Prompt must enforce ~2/3 Coaching Matchup word budget');
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
  assert.ok(parsedAiBrief && parsedAiBrief.sources.length >= 4, 'Failed to parse valid Gemini 4 Hydrogen XHIGH brief JSON');
  assert.equal(parsedAiBrief.modelUsed, 'gemini-4-hydrogen');
  assert.equal(parsedAiBrief.thinkingLevel, 'XHIGH');
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
    optionalBlocks: seasonStateNow.optionalBlocks,
    appData: mockDataWithUncovered,
    simCapResult: simulateCapScenario(fullAppData.cap, {}),
    mcSimResult: fullAppData.seasonal.playoffPicture.baselineSimulation,
    filteredRawItems: mockDataWithUncovered.news.rawStream,
    isCustomizingLayout: false
  });
  assert.ok(!homeWithBrkHtml.includes('in Archive'), 'Home reorder bar must never render Archive count');
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
  const completedRegGames = fullAppData.scheduleMatchup.schedule.filter(
    g => (g.seasonType || 'REG') === 'REG' && g.completed && !g.isByeWeek
  );
  const latestCompGame = completedRegGames[completedRegGames.length - 1];
  const latestCompOppName = latestCompGame?.opponent?.name || 'Dallas Cowboys';
  const latestCompWkNum = latestCompGame?.week || 10;
  const freshLatestGameHighlight = {
    id: 'yt_fresh_latest_comp',
    type: 'video',
    videoId: 'freshLatest99',
    title: `${latestCompOppName} vs. San Francisco 49ers Game Highlights | Week ${latestCompWkNum}`,
    outletName: 'NFL',
    publishedAt: new Date(Date.now() - 60 * 60_000).toISOString()
  };
  assert.equal(isStalePriorGameVideo(staleAtlantaVideo, fullAppData), true, '2-week-old video must be pruned');
  assert.equal(isStalePriorGameVideo(recentPriorWeekOpponentVideo, fullAppData), true, 'Prior-opponent highlight video must be pruned after a newer game is played');
  assert.equal(isStalePriorGameVideo(freshLatestGameHighlight, fullAppData), false, 'Latest completed game highlights must be preserved');

  const qbSchoolPurdyVideo = {
    id: 'yt_qbschool_purdy',
    type: 'video',
    videoId: 'qbschoolPurdy1',
    title: `Brock Purdy Week ${latestCompWkNum} Analysis: Anticipation & Layered Throws`,
    outletName: 'The QB School',
    author: "JT O'Sullivan • The QB School",
    publishedAt: new Date(Date.now() - 45 * 60_000).toISOString()
  };
  qbSchoolPurdyVideo.category = classifyNewsItemCategory(qbSchoolPurdyVideo);
  assert.equal(qbSchoolPurdyVideo.category, 'film', "JT O'Sullivan's The QB School videos of 49ers QBs must classify into Film & Trench");
  assert.equal(classifyNewsItemCategory(freshLatestGameHighlight), 'beat', 'Game highlight reel must stay in Highlights & Videos (not Film & Trench)');

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
  const distinctHighlightPlayers = [
    'Brock Purdy',
    'Christian McCaffrey',
    'Deebo Samuel',
    'Keenan Allen',
    'George Kittle',
    'Jordan Watkins',
    'Nick Bosa',
    'Fred Warner'
  ].filter(name => videosTabHtml.includes(name));
  assert.ok(
    distinctHighlightPlayers.length >= 3,
    `Highlights & Videos must surface >=3 individual player highlight cutups without collapsing them into a single card, got: ${distinctHighlightPlayers.join(', ')}`
  );
  // Multi-week documentary titles ("Forty Niner Way: Week 7 & 10") must NOT be misclassified as stale
  assert.equal(
    isStalePriorGameVideo(
      {
        id: 'yt_49way',
        type: 'video',
        videoId: 'bgKkQX4AnHM',
        title: `Forty Niner Way: “Back to the Bay” | Week 7 & ${latestCompWkNum} (vs. Falcons + ${latestCompOppName})`,
        outletName: 'San Francisco 49ers',
        publishedAt: new Date(Date.now() - 12 * 3_600_000).toISOString()
      },
      fullAppData
    ),
    false,
    `Multi-week Forty Niner Way covering latest completed week (Week 7 & ${latestCompWkNum}) must be preserved`
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

  // 7. Scouting Profile Link Integrity: replace stat-only ESPN/CBS college bios with written Scouting Reports & NFL.com Zierlein Profiles
  assert.equal(
    isPaywalledOrBlockedUrl('https://www.espn.com/college-football/player/_/id/4582818/jeremiah-smith'),
    true,
    'Forged ESPN Scouts Inc. draft-rank ID (45828xx) must be flagged as broken 404 URL'
  );
  const uniqueProfileSet = new Set(liveBb.map(p => p.profileUrl));
  assert.equal(uniqueProfileSet.size, liveBb.length, 'Every Big Board prospect must resolve to a distinct verified scouting URL');
  for (const p of liveBb) {
    assert.ok(
      p.profileUrl &&
        !isPaywalledOrBlockedUrl(p.profileUrl) &&
        !p.profileUrl.includes('nflmockdraftdatabase.com/players/') &&
        !p.profileUrl.includes('espn.com/college-football/player/') &&
        !p.profileUrl.includes('cbssports.com/college-football/players/') &&
        (p.profileUrl.startsWith('https://www.nfl.com/prospects/') ||
          p.profileUrl.startsWith('https://sticktothemodel.com/player/')),
      `Prospect profile must link to a written Scouting Analysis page (never stat-only ESPN/CBS bio) for ${p.name}: ${p.profileUrl}`
    );
  }
  const live2026Picks = liveSeasonal.draftClass2026?.picks || [];
  assert.ok(live2026Picks.length >= 8, 'Expected 2026 49ers Draft Class picks');
  for (const pk of live2026Picks) {
    assert.ok(
      typeof pk.nflScoutingUrl === 'string' && pk.nflScoutingUrl.startsWith('https://www.nfl.com/prospects/'),
      `Expected official NFL.com Zierlein scouting profile URL on 2026 pick ${pk.name}, got ${pk.nflScoutingUrl}`
    );
  }
});

await testAsync('Shared Podcast Hero UX & Human Studio Voice Audio Pipeline Safety', async () => {
  const { splitTurnIntoSpokenSentences } = await import('../src/workers/neuralTtsWorker.js');
  const { rankGeminiTtsModels, chunkTurnsForGeminiTts } = await import(
    '../src/engine/geminiStudioPrompts.js'
  );
  const {
    saveEpisodeAudioBlob,
    getEpisodeAudioUrl,
    deleteEpisodeAudioBlob,
    inspectWavBufferDurationSec
  } = await import('../src/services/podcastAudioStore.js');

  // 1. Verify neuralTtsWorker & sw.js: zero 15M kitten-tts-nano, zero 0:38 lead_ready truncation, preserved CacheStorage audio
  const workerSrc = fs.readFileSync(path.join(rootDir, 'src', 'workers', 'neuralTtsWorker.js'), 'utf8');
  const swSrc = fs.readFileSync(path.join(rootDir, 'sw.js'), 'utf8');
  assert.ok(workerSrc.includes("device: 'wasm'") && workerSrc.includes("dtype: 'q8'"), 'Must use quantized WASM q8');
  assert.ok(
    !workerSrc.includes("loadWithBackend('webgpu'") &&
      !workerSrc.includes("'fp32'") &&
      !workerSrc.includes('kitten-tts-nano') &&
      !workerSrc.includes('lead_ready'),
    'Must never use 310 MB fp32 WebGPU, degraded 15M kitten-tts-nano voices, or partial 0:38 lead_ready clips'
  );
  assert.ok(
    swSrc.includes('49ers-podcast-studio-audio-'),
    'sw.js activate handler must preserve 49ers-podcast-studio-audio- CacheStorage across SW upgrades'
  );

  // 2. Verify 3-minute podcast splits into 2 parallel ~90s studio blocks (~1,850 chars) & rankGeminiTtsModels spans multi-bucket TTS models
  const threeMinScript = Array.from({ length: 18 }, (_, idx) => ({
    speaker: idx % 2 === 0 ? 'Marcus' : 'Elena',
    text: 'Look at how Keenan Allen wins option routes between the numbers on third and six while preserving Article 13 cap rollover into 2027.'
  }));
  const parallelBlocks = chunkTurnsForGeminiTts(threeMinScript, 1850);
  assert.equal(parallelBlocks.length, 2, `Expected 2 parallel ~90s studio blocks for 3m pod, got ${parallelBlocks.length}`);
  assert.ok(
    parallelBlocks[0].every(t => typeof t.cleanSpokenText === 'string' && !t.cleanSpokenText.startsWith('Marcus:')),
    'cleanSpokenText must omit speaker prefix for Gemini 3.8 speechMetadata verbatim TTS'
  );

  const rankedTts = rankGeminiTtsModels([
    { name: 'models/gemini-2.5-flash-preview-tts', supportedGenerationMethods: ['generateContent'] },
    { name: 'models/gemini-3.8-flash-lite-tts', supportedGenerationMethods: ['generateContent'] },
    { name: 'models/gemini-3.8-flash-tts', supportedGenerationMethods: ['generateContent'] },
    { name: 'models/gemini-4-hydrogen-tts', supportedGenerationMethods: ['generateContent'] }
  ]);
  assert.deepEqual(rankedTts.slice(0, 4), [
    'gemini-4-hydrogen-tts',
    'gemini-3.8-flash-tts',
    'gemini-3.8-flash-lite-tts',
    'gemini-2.5-flash-preview-tts'
  ]);

  // 3. Verify Self-Healing Truncated Audio Guard (purges 0:38 partial WAV on a 3:06 episode while keeping full 3:06 WAV)
  const buildSilentStereoWavBuf = (durSec, sr = 8000) => {
    const frames = Math.round(durSec * sr);
    const dataBytes = frames * 4;
    const buf = new ArrayBuffer(44 + dataBytes);
    const dv = new DataView(buf);
    const w = (off, s) => {
      for (let i = 0; i < s.length; i++) dv.setUint8(off + i, s.charCodeAt(i));
    };
    w(0, 'RIFF');
    dv.setUint32(4, 36 + dataBytes, true);
    w(8, 'WAVE');
    w(12, 'fmt ');
    dv.setUint32(16, 16, true);
    dv.setUint16(20, 1, true);
    dv.setUint16(22, 2, true);
    dv.setUint32(24, sr, true);
    dv.setUint32(28, sr * 4, true);
    dv.setUint16(32, 4, true);
    dv.setUint16(34, 16, true);
    w(36, 'data');
    dv.setUint32(40, dataBytes, true);
    return buf;
  };
  const truncated38sBuf = buildSilentStereoWavBuf(38, 8000);
  assert.ok(Math.abs(inspectWavBufferDurationSec(truncated38sBuf) - 38) < 0.2);
  await saveEpisodeAudioBlob('test_poisoned_38s_ep', truncated38sBuf);
  const purgedResult = await getEpisodeAudioUrl('test_poisoned_38s_ep', 186);
  assert.equal(purgedResult, null, 'Truncated 0:38 WAV on a 3:06 episode must be purged automatically');

  const full186sBuf = buildSilentStereoWavBuf(186, 8000);
  await saveEpisodeAudioBlob('test_valid_186s_ep', full186sBuf);
  const validResult = await getEpisodeAudioUrl('test_valid_186s_ep', 186);
  assert.ok(validResult === null || String(validResult).startsWith('blob:'));
  await deleteEpisodeAudioBlob('test_valid_186s_ep');

  // 4. Verify sentence-level micro-chunking keeps ONNX passes compact while preserving short latches
  const longTurn =
    'Right! Look at how Keenan Allen wins from the slot against two-high quarters coverage on third and medium, especially when Ricky Pearsall stretches the field vertically outside the numbers. Furthermore, under CBA Article 13 rollover rules, every dollar spent on midseason wide receiver depth reduces San Francisco’s 2027 cap cushion, which means Kyle Shanahan has to maximize veteran route discipline immediately.';
  const chunks = splitTurnIntoSpokenSentences(longTurn, 195);
  assert.ok(chunks.length >= 2 && chunks.length <= 4, `Expected 2-4 sentence chunks, got ${chunks.length}`);
  assert.ok(chunks[0].startsWith('Right! Look at how Keenan Allen'), 'Short interjection must stay latched to first sentence');
  assert.ok(chunks.every(c => c.length <= 240), `Sentence chunk exceeded compact WASM bound: ${JSON.stringify(chunks)}`);

  // 5. Verify Shared Podcast Hero renders ABOVE generator & API key box and never hijacks Create-Podcast stepper
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
      message: 'Recording podcast with Gemini NotebookLM studio voices (Puck & Aoede)…',
      subDetail: 'Preparing full-length smooth human multi-speaker audio (~20–30 sec).'
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
      message: 'Recording podcast with Gemini NotebookLM studio voices (Puck & Aoede)…'
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
      error: 'Network connection interrupted while preparing studio voices.'
    },
    allEpisodes: [sharedEp]
  });
  assert.ok(
    errorHtml.includes('data-action="retry-shared-audio"') &&
      errorHtml.includes('data-action="play-device-voice"'),
    'Shared audio error state must expose both Retry Studio Audio and Listen Now (Device Voice) recovery actions'
  );

  // 6. Verify 2.5 -> 3.8 TTS cross-bucket failover (`speechMetadata` + RIFF `audio/wav` decoding + Puck & Aoede voices)
  const {
    synthesizeMissingEpisodeAudio,
    decodeGeminiAudioInlineDataToPcm24k
  } = await import('../src/services/aiWorkerClient.js');
  const {
    buildShareablePodcastUrl,
    extractIncomingSharedRoute,
    shareAudioFileNatively
  } = await import('../src/services/shareService.js');

  // Verify RIFF WAV 48kHz stereo -> 24kHz mono PCM decoder strips header cleanly
  const wav48kStereo = buildSilentStereoWavBuf(1, 48000);
  const wav48kView = new DataView(wav48kStereo);
  wav48kView.setInt16(44, 12000, true);
  wav48kView.setInt16(46, 12000, true);
  const decoded24k = decodeGeminiAudioInlineDataToPcm24k(
    Buffer.from(wav48kStereo).toString('base64'),
    'audio/wav'
  );
  assert.equal(decoded24k.length, 24000, '48kHz 1s stereo WAV must decode & resample to 24,000 mono samples without RIFF header');
  assert.ok(decoded24k[0] > 10000, 'First decoded sample must be real audio sample, never ASCII RIFF bytes');

  const senderKey = 'AIzaTestRelayStudioKey999';
  const shareHref = await buildShareablePodcastUrl(
    sharedEp,
    new URL('https://49ers.joshal.com/'),
    { geminiApiKey: senderKey }
  );
  assert.ok(shareHref.includes('#shared-pod=z.'), 'Must deflate shared podcast payload into #shared-pod fragment');
  assert.ok(!shareHref.includes(senderKey), 'Raw Gemini API key must never appear unmasked in shared URL');

  const incoming = await extractIncomingSharedRoute(new URL(shareHref));
  assert.equal(incoming?.episode?._sharedVoiceKey, senderKey);

  // Simulate 429 RPM on gemini-2.5-flash-preview-tts -> immediate failover to gemini-3.8-flash-tts returning audio/wav!
  const origFetch = globalThis.fetch;
  let captured38Body = null;
  try {
    globalThis.fetch = async (url, init) => {
      const u = String(url);
      if (u.includes('/models?')) {
        return new Response(
          JSON.stringify({
            models: [
              { name: 'models/gemini-2.5-flash-preview-tts', supportedGenerationMethods: ['generateContent'] },
              { name: 'models/gemini-3.8-flash-tts', supportedGenerationMethods: ['generateContent'] }
            ]
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
      if (u.includes('gemini-2.5-flash-preview-tts:generateContent')) {
        return new Response(
          JSON.stringify({ error: { message: 'RESOURCE_EXHAUSTED: requests_per_minute exceeded' } }),
          { status: 429, headers: { 'Content-Type': 'application/json' } }
        );
      }
      if (u.includes('gemini-3.8-flash-tts:generateContent')) {
        captured38Body = init?.body ? JSON.parse(init.body) : null;
        const wav24k = buildSilentStereoWavBuf(2, 24000);
        return new Response(
          JSON.stringify({
            candidates: [
              {
                content: {
                  parts: [
                    {
                      inlineData: {
                        mimeType: 'audio/wav',
                        data: Buffer.from(wav24k).toString('base64')
                      }
                    }
                  ]
                }
              }
            ]
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
      return new Response('{}', { status: 404 });
    };

    const recipientEp = { ...incoming.episode, id: 'custom_ep_recipient_38_failover' };
    const studioWavUrl = await synthesizeMissingEpisodeAudio(recipientEp, null, {
      geminiApiKey: '',
      geminiApiBaseUrl: 'https://mock-relay-38-tts.local/v1beta'
    });
    assert.ok(
      typeof studioWavUrl === 'string' && (studioWavUrl.startsWith('blob:') || studioWavUrl.startsWith('data:audio/wav')),
      `Expected real NotebookLM Stereo WAV URL via 3.8 TTS failover, got ${studioWavUrl}`
    );
    const parts38 = captured38Body?.contents?.[0]?.parts || [];
    assert.equal(parts38.length, 2, 'Gemini 3.8 TTS must receive structured turn parts');
    assert.equal(parts38[0]?.speechMetadata?.speaker, 'Marcus');
    assert.equal(parts38[1]?.speechMetadata?.speaker, 'Elena');
    assert.ok(!parts38[0]?.text?.startsWith('Marcus:'), 'Gemini 3.8 TTS turn text must omit literal speaker prefix');
    const voiceNames = (
      captured38Body?.generationConfig?.speechConfig?.multiSpeakerVoiceConfig?.speakerVoiceConfigs || []
    ).map(v => v?.voiceConfig?.prebuiltVoiceConfig?.voiceName);
    assert.deepEqual(voiceNames, ['Puck', 'Aoede']);
  } finally {
    globalThis.fetch = origFetch;
  }

  // 7. Verify native MP3 File sharing via navigator.share({ files })
  if (typeof File === 'function') {
    const mockMp3 = new File([new Uint8Array([0xff, 0xfb, 0x90, 0x64])], 'keenan-allen.mp3', {
      type: 'audio/mpeg'
    });
    let sharedFilesCount = 0;
    const fileRes = await shareAudioFileNatively({
      file: mockMp3,
      title: '49ers Faithful Podcast',
      navigatorObj: {
        canShare: data => Array.isArray(data?.files) && data.files.length === 1,
        share: async data => {
          sharedFilesCount = data?.files?.length || 0;
        }
      }
    });
    assert.equal(fileRes.method, 'native_file');
    assert.equal(sharedFilesCount, 1);
  }
});

await testAsync('Cross-surface Gemini 4 Hydrogen thinking-level split audit: XHIGH on scheduled/daily briefs & matchups, HIGH on live Auto Pod/AI Analysis/probes & XHIGH->HIGH retry resilience', async () => {
  const {
    refreshDailyTopNewsBriefIfDue,
    runOnDemandDeepAnalysis,
    generateOnDemandAutopodcast
  } = await import('../src/services/aiWorkerClient.js');
  const { extractIncomingSharedRoute, buildShareableAnalysisUrl } = await import(
    '../src/services/shareService.js'
  );
  const { discoverBestFreeGeminiModel } = await import('../scripts/lib/aiSynthesisEngine.mjs');

  // 1. Worker /api/health reports gemini-4-hydrogen + XHIGH default + HIGH live interactive
  const env = createMockWorkerEnv({ GEMINI_API_KEY: 'mock-hydrogen-key' });
  const healthJson = await (
    await edgeWorker.fetch(new Request('https://worker.example/api/health'), env)
  ).json();
  assert.equal(healthJson.defaultFreeModel, 'gemini-4-hydrogen');
  assert.equal(healthJson.thinkingLevel, 'XHIGH');
  assert.equal(healthJson.liveInteractiveThinkingLevel, 'HIGH');

  // 2. Worker /api/daily-news-brief & /api/matchup-intel target gemini-4-hydrogen with XHIGH thinkingLevel
  const origFetch = globalThis.fetch;
  const origLocalStorage = globalThis.localStorage;
  const captured = [];
  let simulateXhigh400Once = false;
  try {
    const mem = new Map();
    globalThis.localStorage = {
      getItem: k => (mem.has(k) ? mem.get(k) : null),
      setItem: (k, v) => mem.set(k, String(v)),
      removeItem: k => mem.delete(k)
    };
    globalThis.fetch = async (url, init) => {
      const u = String(url);
      const body = init?.body ? JSON.parse(init.body) : null;
      captured.push({ url: u, body });

      if (u.includes('/models?')) {
        return new Response(
          JSON.stringify({
            models: [{ name: 'models/gemini-4-hydrogen', supportedGenerationMethods: ['generateContent'] }]
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
      if (simulateXhigh400Once && body?.generationConfig?.thinkingConfig?.thinkingLevel === 'XHIGH') {
        simulateXhigh400Once = false;
        return new Response(
          JSON.stringify({ error: { message: 'INVALID_ARGUMENT: thinkingConfig XHIGH preview gate' } }),
          { status: 400, headers: { 'Content-Type': 'application/json' } }
        );
      }
      return new Response(
        JSON.stringify({
          candidates: [
            {
              content: {
                parts: [
                  { thought: true, text: 'XHIGH deep reasoning...' },
                  {
                    text: JSON.stringify({
                      headline: '49ers Week 10 Briefing: Cap Rollover & Secondary Prep',
                      summary:
                        'San Francisco (7-1) prepares for Dallas while holding $39.18M in 2026 cap room [S1] and monitoring Thursday practice participation [S2].',
                      bullets: [
                        'Trades & Cap Moves: Paraag Marathe preserves $39.18M for Article 13 rollover into 2027 [S1].',
                        'Injury & Practice Availability: DT C.J. West opened his 21-day IR window while veterans managed mid-week reps [S2].',
                        'Matchup Storylines: Kyle Shanahan and Raheem Morris game-plan around top-ranked offensive EPA [S3].'
                      ],
                      citedSourceIds: ['S1', 'S2', 'S3']
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

    const workerBriefRes = await (
      await edgeWorker.fetch(
        new Request('https://worker.example/api/daily-news-brief', {
          method: 'POST',
          headers: { 'X-Group-Passcode': 'faithful49', 'Content-Type': 'application/json' },
          body: JSON.stringify({ cycleKey: '2026-11-12@17PT', prompt: 'Synthesize daily brief' })
        }),
        env
      )
    ).json();
    assert.equal(workerBriefRes.modelUsed, 'gemini-4-hydrogen');
    assert.equal(workerBriefRes.thinkingLevel, 'XHIGH');
    assert.ok(captured[0].url.includes('models/gemini-4-hydrogen:generateContent'));
    assert.deepEqual(captured[0].body.generationConfig.thinkingConfig, { thinkingLevel: 'XHIGH' });

    const workerMatchupRes = await (
      await edgeWorker.fetch(
        new Request('https://worker.example/api/matchup-intel', {
          method: 'POST',
          headers: { 'X-Group-Passcode': 'faithful49', 'Content-Type': 'application/json' },
          body: JSON.stringify({ seasonYear: 2026, week: 10, oppAbbr: 'DAL', datePt: '2026-11-12', prompt: 'Matchup intel' })
        }),
        env
      )
    ).json();
    assert.equal(workerMatchupRes.modelUsed, 'gemini-4-hydrogen');

    // 3. Browser refreshDailyTopNewsBriefIfDue hits gemini-4-hydrogen with XHIGH
    const fullAppData = {
      meta: JSON.parse(fs.readFileSync(path.join(rootDir, 'data', 'meta.json'), 'utf8')),
      roster: JSON.parse(fs.readFileSync(path.join(rootDir, 'data', 'roster.json'), 'utf8')),
      cap: JSON.parse(fs.readFileSync(path.join(rootDir, 'data', 'cap.json'), 'utf8')),
      health: JSON.parse(fs.readFileSync(path.join(rootDir, 'data', 'health.json'), 'utf8')),
      news: JSON.parse(fs.readFileSync(path.join(rootDir, 'data', 'news.json'), 'utf8')),
      scheduleMatchup: JSON.parse(fs.readFileSync(path.join(rootDir, 'data', 'schedule-matchup.json'), 'utf8')),
      seasonal: JSON.parse(fs.readFileSync(path.join(rootDir, 'data', 'seasonal.json'), 'utf8'))
    };
    fullAppData.news.dailyTopNewsBrief.source = 'pipeline-grounded';
    captured.length = 0;

    const liveBriefRun = await refreshDailyTopNewsBriefIfDue({
      appData: fullAppData,
      prefs: { geminiApiKey: 'AIzaHydrogenBriefKey', geminiApiBaseUrl: 'https://mock-h2.local/v1beta' },
      force: true
    });
    assert.equal(liveBriefRun.updated, true);
    assert.equal(liveBriefRun.modelUsed, 'gemini-4-hydrogen');
    assert.equal(fullAppData.news.dailyTopNewsBrief.thinkingLevel, 'XHIGH');
    const briefGenCall = captured.find(c => c.url.includes('models/gemini-4-hydrogen:generateContent'));
    assert.deepEqual(briefGenCall?.body?.generationConfig?.thinkingConfig, { thinkingLevel: 'XHIGH' });

    // 4A. Verify live interactive runOnDemandDeepAnalysis defaults to Gemini 4 Hydrogen `HIGH` (fast live turnaround)
    captured.length = 0;
    const liveDefaultReport = await runOnDemandDeepAnalysis({
      prompt: 'Brock Purdy EPA live interactive',
      appData: fullAppData,
      prefs: { geminiApiKey: 'AIzaHydrogenLiveHighKey', geminiApiBaseUrl: 'https://mock-h2-live.local/v1beta' }
    });
    assert.equal(liveDefaultReport.modelUsed, 'gemini-4-hydrogen');
    assert.equal(liveDefaultReport.thinkingLevel, 'HIGH');
    const liveH2Calls = captured.filter(c => c.url.includes('models/gemini-4-hydrogen:generateContent'));
    assert.equal(liveH2Calls.length, 1);
    assert.deepEqual(liveH2Calls[0]?.body?.generationConfig?.thinkingConfig, { thinkingLevel: 'HIGH' });

    // 4B. Verify XHIGH -> HIGH retry resilience on same model when XHIGH is requested and endpoint returns 400 INVALID_ARGUMENT
    captured.length = 0;
    simulateXhigh400Once = true;
    const retryReport = await runOnDemandDeepAnalysis({
      prompt: 'Brock Purdy EPA',
      appData: fullAppData,
      prefs: { geminiApiKey: 'AIzaHydrogenRetryKey', geminiApiBaseUrl: 'https://mock-h2-retry.local/v1beta' },
      thinkingLevel: 'XHIGH'
    });
    assert.equal(retryReport.modelUsed, 'gemini-4-hydrogen');
    assert.equal(retryReport.thinkingLevel, 'HIGH');
    const h2GenCalls = captured.filter(c => c.url.includes('models/gemini-4-hydrogen:generateContent'));
    assert.ok(h2GenCalls.some(c => c.body?.generationConfig?.thinkingConfig?.thinkingLevel === 'XHIGH'));
    assert.ok(h2GenCalls.some(c => c.body?.generationConfig?.thinkingConfig?.thinkingLevel === 'HIGH'));

    // 4C. Verify live quota probe in discoverBestFreeGeminiModel uses `HIGH` (fast health check) while reporting `XHIGH` for scheduled runs
    captured.length = 0;
    const probedModelState = await discoverBestFreeGeminiModel('AIzaProbeKey', { probeQuota: true });
    assert.equal(probedModelState.activeModel, 'gemini-4-hydrogen');
    assert.equal(probedModelState.thinkingLevel, 'XHIGH');
    const probeGenCall = captured.find(c => c.url.includes('models/gemini-4-hydrogen:generateContent'));
    assert.deepEqual(probeGenCall?.body?.generationConfig?.thinkingConfig, { thinkingLevel: 'HIGH' });

    // 5. Verify shareService preserves `HIGH` on live reports and defaults legacy un-tagged payloads to `XHIGH`
    const liveShareUrl = await buildShareableAnalysisUrl(
      {
        id: 'local_analysis_live_high',
        title: 'Live Cap Dive',
        thinkingLevel: 'HIGH',
        markdown: '### Cap\n* Verified.'
      },
      new URL('https://49ers.joshal.com/')
    );
    const hydratedLive = await extractIncomingSharedRoute(new URL(liveShareUrl));
    assert.equal(hydratedLive?.analysis?.modelUsed, 'gemini-4-hydrogen');
    assert.equal(hydratedLive?.analysis?.thinkingLevel, 'HIGH');

    const shareUrl = await buildShareableAnalysisUrl(
      { id: 'local_analysis_h2', title: 'Cap Dive', markdown: '### Cap\n* Verified.' },
      new URL('https://49ers.joshal.com/')
    );
    const hydrated = await extractIncomingSharedRoute(new URL(shareUrl));
    assert.equal(hydrated?.analysis?.modelUsed, 'gemini-4-hydrogen');
    assert.equal(hydrated?.analysis?.thinkingLevel, 'XHIGH');

    // 6. Verify Hydrogen XHIGH stays #1 across transient 60s RPM 429s until daily tokens actually run out, then falls back cleanly to 3.8 HIGH
    const { scoreBestGeminiReasoningModel } = await import('../src/engine/geminiStudioPrompts.js');
    assert.ok(
      scoreBestGeminiReasoningModel('gemini-4-hydrogen') > scoreBestGeminiReasoningModel('gemini-3.8-flash') &&
        scoreBestGeminiReasoningModel('gemini-3.8-flash') > scoreBestGeminiReasoningModel('gemini-3.8-pro'),
      'Reasoning cascade must rank gemini-4-hydrogen (XHIGH) #1 -> gemini-3.8-flash (HIGH) #2 ahead of 0-quota 3.8-pro'
    );

    let h2Mode = 'transient_rpm'; // 'transient_rpm' -> 'ok' -> 'daily_exhausted'
    const failoverCalls = [];
    globalThis.fetch = async (url, init) => {
      const u = String(url);
      const body = init?.body ? JSON.parse(init.body) : null;
      failoverCalls.push({ url: u, body });

      if (u.includes('/models?key=')) {
        assert.ok(u.includes('pageSize=1000'), 'Must request pageSize=1000 so /v1beta/models never truncates Hydrogen at 50 items');
        return new Response(
          JSON.stringify({
            models: [
              { name: 'models/gemini-4-hydrogen', supportedGenerationMethods: ['generateContent'] },
              { name: 'models/gemini-3.8-pro', supportedGenerationMethods: ['generateContent'] },
              { name: 'models/gemini-3.8-flash', supportedGenerationMethods: ['generateContent'] }
            ]
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
      if (u.includes('models/gemini-4-hydrogen:generateContent')) {
        if (h2Mode === 'transient_rpm') {
          return new Response(
            JSON.stringify({ error: { message: 'RESOURCE_EXHAUSTED: requests_per_minute exceeded, please retry in 8s' } }),
            { status: 429, headers: { 'Content-Type': 'application/json' } }
          );
        }
        if (h2Mode === 'daily_exhausted') {
          return new Response(
            JSON.stringify({ error: { message: 'You exceeded your current quota (GenerateRequestsPerDayPerProjectPerModel).' } }),
            { status: 429, headers: { 'Content-Type': 'application/json' } }
          );
        }
        return new Response(
          JSON.stringify({
            candidates: [{ content: { parts: [{ text: '### Hydrogen XHIGH Report\n* Synthesized on Gemini 4 Hydrogen.' }] } }]
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
      if (u.includes('models/gemini-3.8-flash:generateContent')) {
        return new Response(
          JSON.stringify({
            candidates: [{ content: { parts: [{ text: '### 3.8 High Failover Report\n* Synthesized on Gemini 3.8 Flash High.' }] } }]
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
      return new Response('{}', { status: 404 });
    };

    const cascadePrefs = {
      geminiApiKey: 'AIzaHydrogenUntilTokensOutKey',
      geminiApiBaseUrl: 'https://mock-h2-token-budget.local/v1beta',
      verifiedGeminiModel: 'gemini-4-hydrogen'
    };

    // Call 1: Hydrogen hits temporary 60s RPM limit -> falls back to 3.8 HIGH for this call, WITHOUT permanently demoting Hydrogen!
    const run1 = await runOnDemandDeepAnalysis({ prompt: 'Nick Bosa Wide-9', appData: fullAppData, prefs: cascadePrefs });
    assert.equal(run1.modelUsed, 'gemini-3.8-flash');
    assert.equal(run1.thinkingLevel, 'HIGH');
    assert.equal(cascadePrefs.verifiedGeminiModel, 'gemini-4-hydrogen', 'Transient 60s RPM blip must NOT demote default model away from Hydrogen');

    // Call 2: 60s RPM window cleared -> MUST automatically use Gemini 4 Hydrogen (HIGH live) again!
    h2Mode = 'ok';
    const run2 = await runOnDemandDeepAnalysis({ prompt: 'Fred Warner Quarters', appData: fullAppData, prefs: cascadePrefs });
    assert.equal(run2.modelUsed, 'gemini-4-hydrogen', 'Must return to Gemini 4 Hydrogen while daily tokens remain');
    assert.equal(run2.thinkingLevel, 'HIGH');

    // Call 3: Hydrogen daily tokens run out -> falls back cleanly to 3.8 HIGH (skipping 0-quota 3.8-pro!)
    h2Mode = 'daily_exhausted';
    const run3 = await runOnDemandDeepAnalysis({ prompt: 'Trent Williams Anchor', appData: fullAppData, prefs: cascadePrefs });
    assert.equal(run3.modelUsed, 'gemini-3.8-flash');
    assert.equal(run3.thinkingLevel, 'HIGH');
    assert.equal(cascadePrefs.verifiedGeminiModel, 'gemini-3.8-flash', 'Once Hydrogen daily tokens run out, active model must shift to 3.8-flash HIGH');

    // Call 4: Subsequent call on same day goes straight to 3.8 HIGH without wasting a round-trip on exhausted Hydrogen
    failoverCalls.length = 0;
    const run4 = await runOnDemandDeepAnalysis({ prompt: 'George Kittle Seam', appData: fullAppData, prefs: cascadePrefs });
    assert.equal(run4.modelUsed, 'gemini-3.8-flash');
    assert.ok(
      !failoverCalls.some(c => c.url.includes('models/gemini-4-hydrogen:generateContent')),
      'Exhausted daily Hydrogen bucket must be skipped directly to 3.8 HIGH for the rest of the PT day'
    );
  } finally {
    globalThis.fetch = origFetch;
    globalThis.localStorage = origLocalStorage;
  }
});

await testAsync(
  'Cross-Device Brief Sync, Variable Game-Day Post-Game Cycle, T-90m All-News Promotion & Race-Condition Guards',
  async () => {
    const { refreshDailyTopNewsBriefIfDue } = await import('../src/services/aiWorkerClient.js');
    const workerModule = await import('../worker/index.js');
    const workerHandler = workerModule.default;

    // --- 1. Variable Kickoff Schedule-Aware Cycle State Machine (10 AM, 1:25 PM + OT, 5:20 PM SNF, Midnight OT, PRE/POST) ---
    const makeScheduleFixture = games => ({
      meta: { seasonYear: 2026, currentWeek: 11, teamRecord: '8-1' },
      news: { rawStream: [] },
      scheduleMatchup: { schedule: games, upcomingMatchup: {} }
    });

    // 1A. Early 10:00 AM PT East Coast Game (Sun Dec 6, 2026 @ NYG: 2026-12-06T18:00Z)
    const earlyGameData = makeScheduleFixture([
      {
        id: 'wk13_nyg',
        seasonType: 'REG',
        week: 13,
        dateIso: '2026-12-06T18:00:00Z',
        completed: false,
        opponent: { abbr: 'NYG', name: 'New York Giants' }
      }
    ]);
    // 8:00 AM PT (T-120m): before T-90m -> Saturday's 17PT cycle, not holding yet
    const earlyPre90 = resolveNewsBriefCycleState(Date.parse('2026-12-06T16:00:00Z'), earlyGameData);
    assert.equal(earlyPre90.activeCycleKey, '2026-12-05@17PT');
    assert.equal(earlyPre90.isGameDayHold, false);

    // 8:35 AM PT (T-85m): inside T-90m -> Game-Day Hold active
    const earlyT85 = resolveNewsBriefCycleState(Date.parse('2026-12-06T16:35:00Z'), earlyGameData);
    assert.equal(earlyT85.activeCycleKey, '2026-12-05@17PT');
    assert.equal(earlyT85.isGameDayHold, true);

    // 1:12 PM PT (Final whistle just blew, completedAt = 21:12Z): holds during 18m post-whistle podium buffer
    earlyGameData.scheduleMatchup.schedule[0].completed = true;
    earlyGameData.scheduleMatchup.schedule[0].completedAt = '2026-12-06T21:12:00Z';
    earlyGameData.scheduleMatchup.schedule[0].sfScore = 27;
    earlyGameData.scheduleMatchup.schedule[0].oppScore = 17;
    earlyGameData.scheduleMatchup.schedule[0].result = 'W';
    const earlyJustEnded = resolveNewsBriefCycleState(Date.parse('2026-12-06T21:15:00Z'), earlyGameData);
    assert.equal(earlyJustEnded.isGameDayHold, true, 'Must wait through brief post-whistle podium buffer before locking postgame brief');

    // 1:35 PM PT (Final + 23m): advances immediately to postgame-wk13 (well before 5 PM PT!)
    const earlyPostReady = resolveNewsBriefCycleState(Date.parse('2026-12-06T21:35:00Z'), earlyGameData);
    assert.equal(earlyPostReady.activeCycleKey, '2026-12-06@postgame-wk13');
    assert.equal(earlyPostReady.isPostGameCycle, true);

    // 6:30 PM PT Sunday evening & 9:30 AM PT Monday morning: stays on `2026-12-06@postgame-wk13` (1 brief/day), then rolls at 5:01 PM PT Monday
    assert.equal(
      getDailyNewsBriefCycleKey(Date.parse('2026-12-07T02:30:00Z'), earlyGameData),
      '2026-12-06@postgame-wk13'
    );
    assert.equal(
      getDailyNewsBriefCycleKey(Date.parse('2026-12-07T17:30:00Z'), earlyGameData),
      '2026-12-06@postgame-wk13'
    );
    assert.equal(
      getDailyNewsBriefCycleKey(Date.parse('2026-12-08T01:01:00Z'), earlyGameData),
      '2026-12-07@17PT'
    );

    // 1B. Primetime 5:20 PM PT SNF Game (Sun Nov 22, 2026 vs MIN: 2026-11-23T01:20:00Z)
    const snfData = makeScheduleFixture([
      {
        id: 'wk11_min',
        seasonType: 'REG',
        week: 11,
        dateIso: '2026-11-23T01:20:00Z',
        completed: false,
        statusState: 'pre',
        opponent: { abbr: 'MIN', name: 'Minnesota Vikings' }
      }
    ]);
    // At 5:05 PM PT (01:05Z — past 5 PM PT, 15m BEFORE kickoff!): MUST NOT fire 2026-11-22@17PT pre-game!
    const snfAt505Pm = resolveNewsBriefCycleState(Date.parse('2026-11-23T01:05:00Z'), snfData);
    assert.equal(snfAt505Pm.activeCycleKey, '2026-11-21@17PT', 'SNF game day must NOT fire premature 5PM PT brief before kickoff');
    assert.equal(snfAt505Pm.isGameDayHold, true);

    // At 7:30 PM PT mid-game (03:30Z): still holding on Saturday's brief
    snfData.scheduleMatchup.schedule[0].statusState = 'in';
    snfData.scheduleMatchup.schedule[0].statusDetail = '3rd Quarter';
    assert.equal(getDailyNewsBriefCycleKey(Date.parse('2026-11-23T03:30:00Z'), snfData), '2026-11-21@17PT');

    // Weather-delayed SNF finishing at 11:52 PM PT (2026-11-23T07:52:00Z): at 12:02 AM PT Monday (08:02Z, inside 18m buffer across midnight PT!) still holds, then at 12:15 AM PT Monday (08:15Z) resolves to `2026-11-22@postgame-wk11`!
    snfData.scheduleMatchup.schedule[0].statusState = 'post';
    snfData.scheduleMatchup.schedule[0].statusDetail = 'Final/OT';
    snfData.scheduleMatchup.schedule[0].completed = true;
    snfData.scheduleMatchup.schedule[0].completedAt = '2026-11-23T07:52:00Z';
    const snfCrossMidnightHold = resolveNewsBriefCycleState(Date.parse('2026-11-23T08:02:00Z'), snfData);
    assert.equal(snfCrossMidnightHold.isGameDayHold, true);
    const snfCrossMidnightReady = resolveNewsBriefCycleState(Date.parse('2026-11-23T08:15:00Z'), snfData);
    assert.equal(snfCrossMidnightReady.activeCycleKey, '2026-11-22@postgame-wk11');
    assert.equal(snfCrossMidnightReady.isPostGameCycle, true);

    // Preseason & Postseason cycle slug check
    const prePostData = makeScheduleFixture([
      {
        id: 'pre2',
        seasonType: 'PRE',
        preseasonWeek: 2,
        week: -2,
        dateIso: '2026-08-21T02:00:00Z',
        completed: true,
        opponent: { abbr: 'LAC', name: 'Los Angeles Chargers' }
      },
      {
        id: 'div_post',
        seasonType: 'POST',
        week: 20,
        dateIso: '2027-01-18T01:15:00Z',
        completed: true,
        opponent: { abbr: 'DET', name: 'Detroit Lions' }
      }
    ]);
    assert.equal(
      getDailyNewsBriefCycleKey(Date.parse('2026-08-21T06:00:00Z'), prePostData),
      '2026-08-20@postgame-pre2'
    );
    assert.equal(
      getDailyNewsBriefCycleKey(Date.parse('2027-01-18T05:30:00Z'), prePostData),
      '2027-01-17@postgame-post20'
    );

    // --- 2. News & Film -> "All" Game-Day [T-90m, Post-Game AI Summary) All-News-Above-Brief Promotion ---
    const koCowboysMs = Date.parse('2026-11-15T21:25:00Z'); // 1:25 PM PT Sunday
    const satBrief = {
      id: 'daily_brief_2026-11-14_17PT',
      cycleKey: '2026-11-14@17PT',
      isPostGame: false,
      gameWeek: 10,
      generatedAt: '2026-11-15T01:05:00Z',
      modelUsed: 'gemini-4-hydrogen',
      thinkingLevel: 'XHIGH',
      source: 'pipeline-gemini-daily',
      wordCount: 210,
      headline: '49ers Finalize Roster Elevations Ahead of Week 10 Trip to Dallas',
      summary: 'San Francisco elevated depth defenders ahead of Sunday kickoff [Matt Maiocco](https://x.com/MaioccoNBCS/status/2121000000000000001).',
      bullets: [
        'Practice Squad Elevations: San Francisco elevated veteran defensive depth for Sunday afternoon [Matt Maiocco](https://x.com/MaioccoNBCS/status/2121000000000000001).',
        'Secondary Status: Deommodore Lenoir and Renardo Green carry questionable designations into warmups [Nick Wagoner](https://x.com/nwagoner/status/2121000000000000002).',
        'Cap Rollover: Paraag Marathe preserves $39.18M in 2026 cap room for Article 13 rollover [Matt Barrows](https://x.com/mattbarrows/status/2121000000000000003).'
      ],
      coveredUrls: ['https://x.com/MaioccoNBCS/status/2121000000000000001'],
      coveredStoryKeys: [],
      sources: [
        {
          type: 'tweet',
          author: 'Matt Maiocco',
          outlet: 'NBC Sports Bay Area',
          title: '49ers Saturday roster elevations',
          url: 'https://x.com/MaioccoNBCS/status/2121000000000000001',
          publishedAt: '2026-11-15T00:30:00Z'
        }
      ]
    };

    const preWindowMorningItem = {
      id: 'sun_morning_pre90',
      type: 'article',
      title: 'Early Sunday keys to watching Brock Purdy against Dallas disguised coverages',
      summary: 'Film preview from Sunday morning before inactives.',
      url: 'https://www.nbcsportsbayarea.com/nfl/san-francisco-49ers/sunday-morning-film-keys/1990001/',
      outletName: 'NBC Sports Bay Area',
      author: 'Matt Maiocco',
      publishedAt: new Date(koCowboysMs - 150 * 60_000).toISOString() // T-150m (before T-90m!)
    };

    const gameDayNewItems = [1, 2, 3, 4, 5].map(idx => ({
      id: `gd_live_update_${idx}`,
      type: 'tweet',
      title: `Game-day live beat update #${idx}: Kaelon Black and Deommodore Lenoir deliver key plays vs Cowboys`,
      fullText: `Game-day live beat update #${idx}: Kaelon Black and Deommodore Lenoir deliver key plays vs Cowboys`,
      url: `https://x.com/MaioccoNBCS/status/212299000000000000${idx}`,
      outletName: 'NBC Sports Bay Area',
      author: 'Matt Maiocco',
      trustTier: 1,
      isBreaking: false, // Normal non-breaking game-day updates!
      breakingBadge: null,
      publishedAt: new Date(koCowboysMs - (85 - idx * 25) * 60_000).toISOString() // T-60m, T-35m, T-10m, +15m, +40m
    }));

    const gdAppData = {
      meta: { seasonYear: 2026, currentWeek: 10, teamRecord: '7-1' },
      roster: { players: [] },
      cap: { years: { 2026: { teamCapSpace: 39180000 }, 2027: { teamCapSpace: -36740000 } } },
      health: { practiceReport: [], irAndReserveTracker: [] },
      news: {
        dailyTopNewsBrief: satBrief,
        rawStream: [...gameDayNewItems, preWindowMorningItem]
      },
      scheduleMatchup: {
        schedule: [
          {
            id: 'wk10_dal',
            seasonType: 'REG',
            week: 10,
            dateIso: '2026-11-15T21:25:00Z',
            completed: false,
            statusState: 'in',
            statusDetail: '2nd Quarter',
            opponent: { abbr: 'DAL', name: 'Dallas Cowboys' }
          }
        ],
        upcomingMatchup: { week: 10, oppAbbr: 'DAL', oppName: 'Dallas Cowboys', dateIso: '2026-11-15T21:25:00Z' }
      }
    };

    // 2A. At T-95m (before 90-min window): standard mode — 0 non-breaking items above brief!
    const partBefore90 = partitionBreakingNewsAboveBrief(
      [preWindowMorningItem],
      satBrief,
      koCowboysMs - 95 * 60_000,
      { appData: gdAppData, promoteAllGameDayNews: true }
    );
    assert.equal(partBefore90.gameDayLiveMode, false);
    assert.equal(partBefore90.breakingAboveBrief.length, 0);

    // 2B. Mid-game (`koCowboysMs + 50m`): ALL 5 non-breaking post-T-90m items stack ABOVE the brief (newest first!), while pre-T-90m item stays BELOW!
    const midGameMs = koCowboysMs + 50 * 60_000;
    const partMidGame = partitionBreakingNewsAboveBrief(
      [...gameDayNewItems, preWindowMorningItem],
      satBrief,
      midGameMs,
      { appData: gdAppData, promoteAllGameDayNews: true }
    );
    assert.equal(partMidGame.gameDayLiveMode, true);
    assert.equal(partMidGame.breakingAboveBrief.length, 5, 'All 5 new >=T-90m items must be promoted above brief regardless of 3-item breaking cap');
    assert.equal(partMidGame.breakingAboveBrief[0].id, 'gd_live_update_5', 'Newest game-day update must sit at #1 above brief');
    assert.equal(partMidGame.remainingBelowBrief.length, 1);
    assert.equal(partMidGame.remainingBelowBrief[0].id, 'sun_morning_pre90', 'Pre-T-90m item must stay below brief');

    // Verify rendered `News & Film -> All` HTML places `[data-gameday-above-brief-banner]` and all 5 items ABOVE `[data-daily-news-brief]`
    const midGameNewsHtml = renderNewsViewHtml({
      appData: gdAppData,
      newsCategoryFilter: 'all',
      filteredRawItems: gdAppData.news.rawStream,
      activeVideosSet: new Set(),
      userPrefs: {},
      nowMs: midGameMs
    });
    const gdBannerIdx = midGameNewsHtml.indexOf('data-gameday-above-brief-banner');
    const gdBriefIdx = midGameNewsHtml.indexOf('data-daily-news-brief');
    const pre90Idx = midGameNewsHtml.indexOf('Early Sunday keys to watching Brock Purdy');
    assert.ok(gdBannerIdx > -1 && gdBriefIdx > -1 && gdBannerIdx < gdBriefIdx, 'Game-day live banner & new updates must render ABOVE summary card in All');
    assert.ok(
      midGameNewsHtml.indexOf('Game-day live beat update #5') < gdBriefIdx &&
        midGameNewsHtml.indexOf('Game-day live beat update #1') < gdBriefIdx,
      'Every post-T-90m update must render above the summary card'
    );
    assert.ok(pre90Idx > gdBriefIdx, 'Pre-T-90m story must render below the summary card');

    // 2C. Post-whistle while user's AI key is still awaiting post-game AI synthesis (`requireAiPostGameBrief: true`):
    //     Even if a deterministic fallback exists, `All` keeps promoting game-day news above brief until AI summary forms!
    gdAppData.scheduleMatchup.schedule[0].completed = true;
    gdAppData.scheduleMatchup.schedule[0].statusState = 'post';
    gdAppData.scheduleMatchup.schedule[0].statusDetail = 'Final';
    gdAppData.scheduleMatchup.schedule[0].sfScore = 46;
    gdAppData.scheduleMatchup.schedule[0].oppScore = 40;
    gdAppData.scheduleMatchup.schedule[0].result = 'W';
    const postGameMs = koCowboysMs + 4 * 3600_000;
    const detPostGameFallback = {
      ...satBrief,
      cycleKey: '2026-11-15@postgame-wk10',
      isPostGame: true,
      gameWeek: 10,
      generatedAt: new Date(postGameMs).toISOString(),
      source: 'live-deterministic-fallback',
      sources: [{ ...satBrief.sources[0], publishedAt: new Date(postGameMs - 15 * 60_000).toISOString() }]
    };
    const partAwaitingAi = partitionBreakingNewsAboveBrief(
      [...gameDayNewItems, preWindowMorningItem],
      detPostGameFallback,
      postGameMs,
      { appData: gdAppData, promoteAllGameDayNews: true, requireAiPostGameBrief: true }
    );
    assert.equal(partAwaitingAi.gameDayLiveMode, true, 'Must stay in game-day above-brief mode while post-game AI summary is still pending');

    // 2D. Post-game AI summary (`live-gemini-daily`) is generated -> IMMEDIATELY reverts to standard breaking-only logic!
    const formedPostGameAiBrief = {
      ...detPostGameFallback,
      source: 'live-gemini-daily',
      headline: '49ers Outlast Cowboys 46-40 Behind Kaelon Black Score and Deommodore Lenoir Breakups'
    };
    gdAppData.news.dailyTopNewsBrief = formedPostGameAiBrief;
    const partAfterAiFormed = partitionBreakingNewsAboveBrief(
      [...gameDayNewItems, preWindowMorningItem],
      formedPostGameAiBrief,
      postGameMs,
      { appData: gdAppData, promoteAllGameDayNews: true, requireAiPostGameBrief: true }
    );
    assert.equal(partAfterAiFormed.gameDayLiveMode, false, 'Must immediately exit game-day mode once post-game AI brief is formed');
    assert.equal(partAfterAiFormed.breakingAboveBrief.length, 0, 'Non-breaking game-day tweets must move below the new post-game summary card');
    assert.equal(partAfterAiFormed.remainingBelowBrief.length, 6);

    const postAiNewsHtml = renderNewsViewHtml({
      appData: gdAppData,
      newsCategoryFilter: 'all',
      filteredRawItems: gdAppData.news.rawStream,
      activeVideosSet: new Set(),
      userPrefs: { geminiApiKey: 'AIzaTestKey' },
      nowMs: postGameMs
    });
    assert.ok(!postAiNewsHtml.includes('data-gameday-above-brief-banner'), 'Game-day banner must disappear once post-game AI summary is generated');

    // And a brand-new post-brief BREAKING news item STILL rises above the new post-game brief under standard logic!
    const lateMondayBreaking = {
      id: 'mon_brk_after_postgame',
      type: 'tweet',
      title: 'BREAKING: 49ers sign Pro Bowl pass rusher to active 53-man roster after Cowboys win.',
      fullText: 'BREAKING: 49ers sign Pro Bowl pass rusher to active 53-man roster after Cowboys win.',
      url: 'https://x.com/AdamSchefter/status/2123888888888888888',
      author: 'Adam Schefter',
      trustTier: 1,
      isBreaking: true,
      breakingBadge: 'BREAKING',
      publishedAt: new Date(postGameMs + 20 * 60_000).toISOString()
    };
    const partPostAiWithBrk = partitionBreakingNewsAboveBrief(
      [lateMondayBreaking, ...gameDayNewItems],
      formedPostGameAiBrief,
      postGameMs + 25 * 60_000,
      { appData: gdAppData, promoteAllGameDayNews: true, requireAiPostGameBrief: true }
    );
    assert.equal(partPostAiWithBrk.gameDayLiveMode, false);
    assert.equal(partPostAiWithBrk.breakingAboveBrief.length, 1);
    assert.equal(partPostAiWithBrk.breakingAboveBrief[0].id, 'mon_brk_after_postgame');

    // --- 3. Web Screenshot Regression: Strip literal "Bold Subtopic:" & expand grouped `[S10, S12]` into icon-only link pills ---
    const mockSources12 = Array.from({ length: 12 }, (_, idx) => ({
      refId: `S${idx + 1}`,
      type: idx % 2 === 0 ? 'tweet' : 'article',
      author: 'Matt Maiocco',
      outlet: 'NBC Sports Bay Area',
      citeLabel: 'Matt Maiocco',
      title: `Verified postgame report #${idx + 1} on 49ers 46-40 win over Dallas`,
      summary: `Complete postgame sentence #${idx + 1}.`,
      fullBody: `Verified postgame report #${idx + 1} on 49ers 46-40 win over Dallas.`,
      url: `https://x.com/MaioccoNBCS/status/21231000000000000${String(idx + 1).padStart(2, '0')}`,
      publishedAt: new Date(postGameMs - 20 * 60_000).toISOString(),
      category: 'beat',
      storyKey: `story_${idx + 1}`,
      confirmingUrls: []
    }));
    const webBlemishParsed = parseAndSanitizeDailyTopNewsBrief(
      JSON.stringify({
        headline: '49ers Surge Past Cowboys Behind Kaelon Black Score and Deommodore Lenoir Masterclass',
        summary: 'San Francisco took control against Dallas as Kaelon Black capped a 25-yard touchdown run [S1, S2]. Cornerback Deommodore Lenoir keyed the defense with four passes defensed [S3].',
        bullets: [
          'Bold Subtopic: Offense Overcomes Protection Issues: San Francisco generated 244 total yards and 7.4 yards per play in the first half [S10, S12], despite surrendering four sacks [S4].',
          '**Bold Subtopic:** Lenoir Shines on Perimeter: Cornerback Deommodore Lenoir delivered four pass breakups while closing deep sideline windows [S5; S6].',
          'Midseason Additions Reinforce Roster Roll: Paraag Marathe preserves $39.18M in gross cap space for CBA Article 13 rollover against 2027 obligations [S7].'
        ],
        citedSourceIds: ['S1', 'S2', 'S3', 'S4', 'S5', 'S6', 'S7', 'S10', 'S12']
      }),
      mockSources12,
      gdAppData,
      { cycleKey: '2026-11-15@postgame-wk10', generatedAt: new Date(postGameMs).toISOString() }
    );
    assert.ok(webBlemishParsed, 'Web blemish brief must parse cleanly');
    const webRenderedHtml = renderDailyTopNewsBriefHtml(webBlemishParsed, { appData: gdAppData });
    const webVisibleText = webRenderedHtml.split('<details')[0].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
    assert.ok(!/bold subtopic/i.test(webVisibleText), `Must strip literal "Bold Subtopic:" prefix, got: ${webVisibleText}`);
    assert.ok(!/\[S\d+/i.test(webVisibleText), `Must convert grouped [S10, S12] into icon pills with zero raw [S#] text, got: ${webVisibleText}`);

    // Also verify `repairDailyTopNewsBriefLinks` heals an ALREADY-cached brief in localStorage that contained `Bold Subtopic:` and `[S10, S12]`
    const legacyPoisonedFormatting = {
      ...formedPostGameAiBrief,
      sources: mockSources12,
      bullets: [
        'Bold Subtopic: Offense Overcomes Protection Issues: San Francisco generated 244 total yards in the first half [S10, S12].',
        'Lenoir Shines: Deommodore Lenoir recorded four pass breakups [S2].'
      ]
    };
    const { brief: repairedLegacy, mutated: legacyWasMutated } = repairDailyTopNewsBriefLinks(legacyPoisonedFormatting);
    assert.equal(legacyWasMutated, true);
    assert.ok(!/bold subtopic/i.test(repairedLegacy.bullets[0]));
    assert.ok(!/\[S10/i.test(repairedLegacy.bullets[0]));
    assert.ok(repairedLegacy.bullets[0].includes('2123100000000000010') && repairedLegacy.bullets[0].includes('2123100000000000012'));

    // --- 4. Boot Race Guard + Poisoned Phone `localStorage` Eviction + Shared Worker KV Sync ---
    const origWindow = globalThis.window;
    const origLocalStorage = globalThis.localStorage;
    const origFetch = globalThis.fetch;
    const makeMemoryStorage = () => {
      const map = new Map();
      return {
        getItem: k => (map.has(k) ? map.get(k) : null),
        setItem: (k, v) => map.set(k, String(v)),
        removeItem: k => map.delete(k),
        clear: () => map.clear(),
        _map: map
      };
    };

    try {
      const phoneStorage = makeMemoryStorage();
      globalThis.localStorage = phoneStorage;
      globalThis.window = { ...(origWindow || {}), localStorage: phoneStorage };

      // 4A. Cold-boot unhydrated snapshot (`completed: false` 4.5h after kickoff, 0 post-game wire items):
      //     `refreshDailyTopNewsBriefIfDue` MUST defer without calling Gemini and without locking ATTEMPT_KEY!
      let geminiCalls = 0;
      globalThis.fetch = async url => {
        const u = String(url);
        if (u.includes('/models?')) {
          return new Response(
            JSON.stringify({
              models: [{ name: 'models/gemini-4-hydrogen', supportedGenerationMethods: ['generateContent'] }]
            }),
            { status: 200 }
          );
        }
        if (u.includes(':generateContent')) {
          geminiCalls += 1;
          return new Response(
            JSON.stringify({
              candidates: [
                {
                  content: {
                    parts: [
                      {
                        text: JSON.stringify({
                          headline: '49ers Beat Cowboys 46-40 to Reach 8-1 Heading Into Week 11',
                          summary: 'San Francisco defeated Dallas 46-40 behind Kaelon Black and Brock Purdy [S1]. Deommodore Lenoir recorded four pass breakups to seal the win [S2].',
                          bullets: [
                            'Offensive Firepower: San Francisco overcame early pressure with explosive second-half scoring drives against Dallas [S1].',
                            'Perimeter Lockdown: Deommodore Lenoir broke up four passes including a late fourth-down target [S2].',
                            'Cap Rollover & Vikings Prep: San Francisco carries $39.18M in 2026 cap space into Week 11 against Minnesota [S3].'
                          ],
                          citedSourceIds: ['S1', 'S2', 'S3']
                        })
                      }
                    ]
                  }
                }
              ]
            }),
            { status: 200 }
          );
        }
        return new Response('{}', { status: 404 });
      };

      const unhydratedColdBootData = {
        meta: { seasonYear: 2026, currentWeek: 10, teamRecord: '7-1' },
        roster: { players: [] },
        cap: { years: { 2026: { teamCapSpace: 39180000 }, 2027: { teamCapSpace: -36740000 } } },
        health: { practiceReport: [], irAndReserveTracker: [] },
        news: {
          dailyTopNewsBrief: satBrief,
          rawStream: [preWindowMorningItem] // Still Thursday/morning pre-game snapshot!
        },
        scheduleMatchup: {
          schedule: [
            {
              id: 'wk10_dal',
              seasonType: 'REG',
              week: 10,
              dateIso: '2026-11-15T21:25:00Z',
              completed: false, // Unhydrated!
              opponent: { abbr: 'DAL', name: 'Dallas Cowboys' }
            }
          ],
          upcomingMatchup: { week: 10, oppAbbr: 'DAL', oppName: 'Dallas Cowboys', dateIso: '2026-11-15T21:25:00Z' }
        }
      };

      const sun6PmMs = Date.parse('2026-11-16T02:00:00Z'); // 6:00 PM PT Sunday (4h 35m after kickoff)
      assert.equal(isAppDataAwaitingLivePostGameHydration(unhydratedColdBootData, sun6PmMs), true);
      const deferredRes = await refreshDailyTopNewsBriefIfDue({
        appData: unhydratedColdBootData,
        prefs: { geminiApiKey: 'AIzaPhoneRaceGuardKey', geminiApiBaseUrl: 'https://mock-race.local/v1beta' },
        nowMs: sun6PmMs
      });
      assert.equal(deferredRes.updated, false);
      assert.equal(deferredRes.reason, 'awaiting_live_postgame_hydration');
      assert.equal(geminiCalls, 0, 'Must NEVER call Gemini on an unhydrated pre-game snapshot after kickoff');
      assert.equal(
        phoneStorage.getItem('joshal_49ers_daily_news_brief_attempt_v5'),
        null,
        'Deferred pre-hydration check must NOT write ATTEMPT_KEY lock'
      );

      // 4B. Poisoned Phone `localStorage` Self-Healing Eviction:
      //     Simulate a phone whose `localStorage` already had the stale Sunday 6 PM PT Thursday-injury brief cached!
      const poisonedPhoneBrief = {
        id: 'daily_brief_2026-11-15_postgame-wk10',
        cycleKey: '2026-11-15@postgame-wk10',
        isPostGame: false,
        gameWeek: 10,
        generatedAt: '2026-11-16T02:00:00Z', // 6 PM PT Sunday (`15h ago`)
        modelUsed: 'gemini-4-hydrogen',
        thinkingLevel: 'XHIGH',
        source: 'live-gemini-daily',
        wordCount: 205,
        headline: 'Williams and Greenlaw Log Limited Work as 49ers Manage Injuries Ahead of Cowboys',
        summary: 'Trent Williams and Dre Greenlaw were limited Thursday ahead of Week 10 against the Cowboys [Nick Wagoner](https://x.com/nwagoner/status/2121021340950081594).',
        bullets: [
          'Thursday Practice Report: Williams and Greenlaw were limited Thursday [Nick Wagoner](https://x.com/nwagoner/status/2121021340950081594).',
          'Receiver Health: Mike Evans remained DNP Thursday ahead of Dallas [Nick Wagoner](https://x.com/nwagoner/status/2121021340950081594).'
        ],
        sources: [
          {
            type: 'tweet',
            author: 'Nick Wagoner',
            outlet: 'ESPN',
            title: 'Thursday injury report ahead of Cowboys',
            url: 'https://x.com/nwagoner/status/2121021340950081594',
            publishedAt: '2026-11-12T23:24:29.010Z' // Stale Thursday Nov 12 source!
          }
        ]
      };
      phoneStorage.setItem('joshal_49ers_daily_news_brief_v5', JSON.stringify(poisonedPhoneBrief));
      phoneStorage.setItem(
        'joshal_49ers_daily_news_brief_attempt_v5',
        JSON.stringify({ cycleKey: '2026-11-15@postgame-wk10', attemptedAt: '2026-11-16T02:00:00Z' })
      );

      // Now live ESPN + wire hydration finishes on the phone (Monday 9:03 AM PT = 2026-11-16T17:03:00Z):
      const mon903AmMs = Date.parse('2026-11-16T17:03:00Z');
      const hydratedPhoneData = {
        ...unhydratedColdBootData,
        meta: { seasonYear: 2026, currentWeek: 11, teamRecord: '8-1' },
        news: {
          dailyTopNewsBrief: poisonedPhoneBrief,
          rawStream: mockSources12.map((s, i) => ({
            id: `post_dal_${i}`,
            type: 'tweet',
            title: s.title,
            fullText: s.fullBody,
            url: s.url,
            author: s.author,
            outletName: s.outlet,
            trustTier: 1,
            publishedAt: s.publishedAt
          }))
        },
        scheduleMatchup: {
          schedule: [
            {
              id: 'wk10_dal',
              seasonType: 'REG',
              week: 10,
              dateIso: '2026-11-15T21:25:00Z',
              completed: true,
              sfScore: 46,
              oppScore: 40,
              result: 'W',
              opponent: { abbr: 'DAL', name: 'Dallas Cowboys' }
            },
            {
              id: 'wk11_min',
              seasonType: 'REG',
              week: 11,
              dateIso: '2026-11-23T01:20:00Z',
              completed: false,
              opponent: { abbr: 'MIN', name: 'Minnesota Vikings' }
            }
          ],
          upcomingMatchup: { week: 11, oppAbbr: 'MIN', oppName: 'Minnesota Vikings', dateIso: '2026-11-23T01:20:00Z' }
        }
      };

      assert.equal(isDailyBriefStaleForLiveState(poisonedPhoneBrief, hydratedPhoneData, mon903AmMs), true, 'Poisoned pre-game brief must be flagged stale after Cowboys game completed');
      const healedRes = await refreshDailyTopNewsBriefIfDue({
        appData: hydratedPhoneData,
        prefs: { geminiApiKey: 'AIzaPhoneSelfHealKey', geminiApiBaseUrl: 'https://mock-race.local/v1beta' },
        nowMs: mon903AmMs
      });
      assert.equal(healedRes.updated, true, 'Phone must evict poisoned stale cache and synthesize fresh post-Cowboys brief');
      assert.equal(geminiCalls, 1);
      assert.ok(
        hydratedPhoneData.news.dailyTopNewsBrief.headline.includes('46-40'),
        `Expected fresh post-Cowboys headline, got "${hydratedPhoneData.news.dailyTopNewsBrief.headline}"`
      );
      assert.equal(hydratedPhoneData.news.dailyTopNewsBrief.isPostGame, true);

      // 4C. Shared Cloudflare Worker KV Parity (`GET /api/daily-news-brief` + `seedRawText`):
      //     Device 1 (Web) seeds KV via direct key + workerBaseUrl; Device 2 (Phone) with both workerBaseUrl & geminiApiKey
      //     fetches the EXACT same brief from Worker KV with 0 extra Gemini calls!
      const kvMap = new Map();
      const mockWorkerEnv = {
        GROUP_PASSCODE: 'faithful25',
        SHARED_CACHE: {
          get: async (k, type) => {
            const v = kvMap.get(k);
            if (!v) return null;
            return type === 'json' ? JSON.parse(v) : v;
          },
          put: async (k, v) => {
            kvMap.set(k, String(v));
          }
        }
      };

      let device2GeminiCalls = 0;
      globalThis.fetch = async (url, init = {}) => {
        const u = String(url);
        if (u.startsWith('https://49ers-sync.workers.dev/')) {
          return edgeWorker.fetch(new Request(u, init), mockWorkerEnv);
        }
        if (u.includes('/models?')) {
          return new Response(
            JSON.stringify({
              models: [{ name: 'models/gemini-4-hydrogen', supportedGenerationMethods: ['generateContent'] }]
            }),
            { status: 200 }
          );
        }
        if (u.includes(':generateContent')) {
          device2GeminiCalls += 1;
          return new Response(
            JSON.stringify({
              candidates: [
                {
                  content: {
                    parts: [
                      {
                        text: JSON.stringify({
                          headline: 'Shared Canonical Postgame Brief Across Web and Phone (46-40 Over Dallas)',
                          summary: 'San Francisco moved to 8-1 with a 46-40 road win over Dallas [S1]. Kaelon Black and Deommodore Lenoir headlined the victory [S2].',
                          bullets: [
                            'Explosive Ground Finish: Kaelon Black powered through Dallas tacklers for a decisive 25-yard score [S1].',
                            'Secondary Coverage: Deommodore Lenoir broke up four passes in coverage [S2].',
                            'Salary Cap Rollover: Paraag Marathe maintains $39.18M in 2026 cap space entering Week 11 [S3].'
                          ],
                          citedSourceIds: ['S1', 'S2', 'S3']
                        })
                      }
                    ]
                  }
                }
              ]
            }),
            { status: 200 }
          );
        }
        return new Response('{}', { status: 404 });
      };

      // Device 1 (Web) generates and seeds Worker KV
      const webStorage = makeMemoryStorage();
      globalThis.localStorage = webStorage;
      globalThis.window = { ...(origWindow || {}), localStorage: webStorage };
      const webData = structuredClone(hydratedPhoneData);
      webData.news.dailyTopNewsBrief = null;
      const dev1Res = await refreshDailyTopNewsBriefIfDue({
        appData: webData,
        prefs: {
          workerBaseUrl: 'https://49ers-sync.workers.dev',
          groupPasscode: 'faithful25',
          geminiApiKey: 'AIzaWebDeviceKey',
          geminiApiBaseUrl: 'https://mock-dev1.local/v1beta'
        },
        nowMs: mon903AmMs
      });
      assert.equal(dev1Res.updated, true);
      assert.equal(device2GeminiCalls, 1);

      // Device 2 (Phone) opens with its OWN empty localStorage AND its own geminiApiKey + workerBaseUrl:
      // Must adopt Device 1's exact brief from Worker KV (`fromSharedWorkerCache: true`) with 0 extra Gemini calls!
      const phone2Storage = makeMemoryStorage();
      globalThis.localStorage = phone2Storage;
      globalThis.window = { ...(origWindow || {}), localStorage: phone2Storage };
      const phone2Data = structuredClone(hydratedPhoneData);
      phone2Data.news.dailyTopNewsBrief = null;
      const dev2Res = await refreshDailyTopNewsBriefIfDue({
        appData: phone2Data,
        prefs: {
          workerBaseUrl: 'https://49ers-sync.workers.dev',
          groupPasscode: 'faithful25',
          geminiApiKey: 'AIzaPhoneDeviceKey',
          geminiApiBaseUrl: 'https://mock-dev2.local/v1beta'
        },
        nowMs: mon903AmMs
      });
      assert.equal(dev2Res.updated, true);
      assert.equal(dev2Res.fromSharedWorkerCache, true, 'Second device must read shared Worker KV brief instead of generating a divergent brief');
      assert.equal(device2GeminiCalls, 1, 'Second device must spend 0 Gemini calls when Worker KV already holds the cycle brief');
      assert.equal(
        phone2Data.news.dailyTopNewsBrief.headline,
        webData.news.dailyTopNewsBrief.headline,
        'Phone and Web headlines must match 100% identically'
      );
    } finally {
      globalThis.fetch = origFetch;
      globalThis.localStorage = origLocalStorage;
      globalThis.window = origWindow;
    }
  }
);

test('Official Club Inactives RSS/Article Parser, RotoWire HTML & Sleeper Active-53 Sync resolve SF & Opponent healthy scratches + Coach Decision notes cleanly', () => {
  // Verify all 32 NFL clubs exist in NFL_TEAM_OFFICIAL_RSS_URLS
  assert.ok(Object.keys(NFL_TEAM_OFFICIAL_RSS_URLS).length >= 32);
  assert.equal(NFL_TEAM_OFFICIAL_RSS_URLS.SF, 'https://www.49ers.com/rss/news');
  assert.equal(NFL_TEAM_OFFICIAL_RSS_URLS.DAL, 'https://www.dallascowboys.com/rss/news');

  const koMs = Date.parse('2026-11-15T21:25:00Z');
  const rssSample = `
    <rss><channel>
      <item>
        <title>Bosa, Sigle Active vs. Raiders; Inactives Week 9 #LVvsSF</title>
        <link>https://www.49ers.com/news/bosa-sigle-active-vs-raiders-inactives-week-9</link>
        <pubDate>Sun, 08 Nov 2026 19:55:00 GMT</pubDate>
      </item>
      <item>
        <title>Deebo Samuel Returns, Williams Active vs. Cowboys; Inactives Week 10 #SFvsDAL</title>
        <link>https://www.49ers.com/news/deebo-samuel-returns-williams-active-vs-cowboys-inactives-week-10-sfvsdal</link>
        <pubDate>Sun, 15 Nov 2026 19:55:00 GMT</pubDate>
      </item>
    </channel></rss>
  `;
  const discovered = discoverOfficialClubInactivesRssItem(rssSample, { kickoffMs: koMs, week: 10 });
  assert.ok(discovered, 'Must discover current Week 10 inactives RSS item while rejecting Week 9');
  assert.equal(
    discovered.url,
    'https://www.49ers.com/news/deebo-samuel-returns-williams-active-vs-cowboys-inactives-week-10-sfvsdal'
  );

  // Exact unstructured Week 10 49ers.com article structure INCLUDING "Related Content" footer trap
  const wk10ArticleHtml = `
    <html><body>
      <h1>Deebo Samuel Returns, Williams Active vs. Cowboys; Inactives Week 10 #SFvsDAL</h1>
      <div>Copied!</div>
      <p>The San Francisco 49ers have finalized their inactive list ahead of their Week 10 matchup against the Dallas Cowboys.</p>
      <p>The 49ers entered Week 10 with just one player ruled out on Friday's final injury report, WR Mike Evans (Achilles), and seven players listed as questionable. On Saturday, the 49ers downgraded CB Nate Hobbs (adductor) and DL C.J. West (knee) from questionable to OUT. Both remain on Injured Reserve.</p>
      <p>The 49ers will have several key players available on Sunday, including T Trent Williams (shoulder), LB Dre Greenlaw (knee), CB Renardo Green (back), DB Deommodore Lenoir (foot), and CB Upton Stout (shoulder, neck). All five entered the matchup listed as questionable, but are active against Dallas. San Francisco will also welcome back WR Deebo Samuel Sr. Newly acquired WR Keenan Allen is also active.</p>
      <p>Here are the 49ers inactive players for Week 10 against the Dallas Cowboys:</p>
      <ul>
        <li>QB Kurtis Rourke</li>
        <li>WR Mike Evans</li>
        <li>OL Enrique Cruz Jr.</li>
        <li>LB Tatum Bethune</li>
        <li>WR Brandin Cooks</li>
      </ul>
      <div>Related Content</div>
      <a href="/news/week-9">Nick Bosa is inactive vs. Raiders; Marques Sigle ruled out</a>
    </body></html>
  `;

  const sfCandidates = [
    { id: '1', name: 'Brock Purdy', position: 'QB', jersey: 13, rosterBucket: 'active', isStarter: true },
    { id: '2', name: 'Trent Williams', position: 'OT', jersey: 71, rosterBucket: 'active', isStarter: true, injuryType: 'Shoulder', gameStatus: 'Questionable' },
    { id: '3', name: 'Dre Greenlaw', position: 'LB', jersey: 57, rosterBucket: 'active', isStarter: true, injuryType: 'Knee', gameStatus: 'Questionable' },
    { id: '4', name: 'Deebo Samuel Sr.', position: 'WR', jersey: 1, rosterBucket: 'active', isStarter: true },
    { id: '5', name: 'Nick Bosa', position: 'DE', jersey: 97, rosterBucket: 'active', isStarter: true },
    { id: '6', name: 'Kurtis Rourke', position: 'QB', jersey: 14, rosterBucket: 'active' },
    { id: '7', name: 'Mike Evans', position: 'WR', jersey: 5, rosterBucket: 'active', injuryType: 'Achilles', gameStatus: 'Out' },
    { id: '8', name: 'Enrique Cruz Jr.', position: 'OT', jersey: 69, rosterBucket: 'active' },
    { id: '9', name: 'Tatum Bethune', position: 'LB', jersey: 48, rosterBucket: 'active' },
    { id: '10', name: 'Brandin Cooks', position: 'WR', jersey: 84, rosterBucket: 'active' }
  ];

  const parsedArt = parseOfficialClubInactivesArticle(wk10ArticleHtml, sfCandidates, { week: 10 });
  assert.equal(parsedArt.officialPosted, true);
  assert.equal(parsedArt.inactives.length, 5, 'Must extract all 5 declared inactives and ignore Related Content footer Nick Bosa');
  assert.ok(!parsedArt.inactives.some(p => p.name === 'Nick Bosa'));
  assert.ok(parsedArt.activeKeys.has('trentwilliams'));
  assert.ok(parsedArt.activeKeys.has('dregreenlaw'));

  // Build SF Game-Day Roster Model + Resolve Injury Rows (no 46% GTD or 32% Long Shot leftovers!)
  const winT80 = { isActive: true, week: 10, kickoffMs: koMs, minutesUntilKickoff: 80, hasKickoffStarted: false };
  const sfReportPregame = [
    { playerId: '7', name: 'Mike Evans', position: 'WR', injuryType: 'Achilles', gameStatus: 'Questionable', playProbabilityPct: 32, playBadgeLabel: '32% • Long Shot' },
    { playerId: '2', name: 'Trent Williams', position: 'OT', injuryType: 'Shoulder', gameStatus: 'Questionable', playProbabilityPct: 46, playBadgeLabel: '46% • GTD', beatComment: 'Williams remains a game-time decision for Sunday.' },
    { playerId: '3', name: 'Dre Greenlaw', position: 'LB', injuryType: 'Knee', gameStatus: 'Questionable', playProbabilityPct: 54, playBadgeLabel: '54% • GTD' }
  ];

  const sfModel = buildTeamGameDayRosterModel({
    teamAbbr: 'SF',
    teamName: 'San Francisco 49ers',
    activeRosterPlayers: sfCandidates,
    injuryReport: sfReportPregame,
    liveFeedData: {
      officialPosted: true,
      inactives: parsedArt.inactives,
      sourceUrl: discovered.url,
      sourceLabel: '49ers.com Official'
    },
    windowState: winT80
  });

  const cooksChip = sfModel.inactives.find(p => p.name === 'Brandin Cooks');
  const evansChip = sfModel.inactives.find(p => p.name === 'Mike Evans');
  assert.equal(cooksChip.injuryType, "Healthy Scratch (Coach's Decision)");
  assert.equal(cooksChip.isHealthyScratch, true);
  assert.equal(evansChip.injuryType, 'Achilles');
  assert.equal(evansChip.isHealthyScratch, false);

  const resolvedSfRows = resolveGameDayInjuryRows(sfReportPregame, sfModel, { activeRosterPlayers: sfCandidates });
  assert.equal(resolvedSfRows.find(r => r.name === 'Mike Evans').playBadgeLabel, '0% • Out (Inactive)');
  assert.equal(
    resolvedSfRows.find(r => r.name === 'Trent Williams').playBadgeLabel,
    '99% • In (Active)',
    'Active player must flip from 46% • GTD to 99% • In (Active) even when Friday note said remains a game-time decision'
  );
  assert.equal(resolvedSfRows.find(r => r.name === 'Dre Greenlaw').playBadgeLabel, '99% • In (Active)');
  assert.ok(!resolvedSfRows.some(r => r.name === 'Brandin Cooks'), 'Non-starter healthy scratch stays in Declared Inactives card only');

  // Verify RotoWire HTML parser for Opponent (DAL) + SF
  const rwHtmlSample = `
    <div><img src="https://assets.rotowire.com/images/teamlogo/football/DAL.svg?v=12"> Dallas Cowboys</div>
    <ul class="list is-small pad-10-15">
      <li><span>OG</span><a href="/football/player/ajani-cornelius-1">Ajani Cornelius</a></li>
      <li><span>TE</span><a href="/football/player/jake-ferguson-2">Jake Ferguson</a></li>
      <li><span>S</span><a href="/football/player/pj-locke-3">P.J. Locke</a></li>
    </ul>
  `;
  const rwParsed = parseRotoWireInactivesHtml(rwHtmlSample, ['DAL']);
  assert.equal(rwParsed.DAL.length, 3);
  assert.equal(rwParsed.DAL[1].name, 'Jake Ferguson');

  // Verify Sleeper Active-53 reconciliation excludes Practice Squad while catching healthy scratches
  const sleeperSample = {
    a1: { team: 'DAL', status: 'Active', full_name: 'Jake Ferguson', position: 'TE', injury_status: 'Out' },
    a2: { team: 'DAL', status: 'Active', full_name: 'Ajani Cornelius', position: 'OL', injury_status: 'Out' },
    a3: { team: 'DAL', status: 'Active', full_name: 'P.J. Locke', position: 'S', injury_status: 'Out' },
    a4: { team: 'DAL', status: 'Active', full_name: 'DaRon Bland', position: 'CB', injury_status: null },
    ps1: { team: 'DAL', status: 'Active', full_name: 'Unlisted Practice Squadder', position: 'WR', injury_status: 'Out' }
  };
  const dalActivePool = [
    { id: 'd1', name: 'Jake Ferguson', position: 'TE', rosterBucket: 'active', isStarter: true, injuryType: 'Knee', gameStatus: 'Questionable' },
    { id: 'd2', name: 'Ajani Cornelius', position: 'OL', rosterBucket: 'active', isStarter: false },
    { id: 'd3', name: 'P.J. Locke', position: 'S', rosterBucket: 'active', isStarter: true, injuryType: 'Concussion', gameStatus: 'Out' },
    { id: 'd4', name: 'DaRon Bland', position: 'CB', rosterBucket: 'active', isStarter: true, injuryType: 'Ankle', gameStatus: 'Doubtful' }
  ];
  const slSig = extractSleeperGameDaySignals(sleeperSample, 'DAL', dalActivePool, []);
  assert.equal(slSig.officialPosted, true);
  assert.equal(slSig.inactives.length, 3);
  assert.ok(!slSig.inactives.some(x => x.name.includes('Practice Squadder')));
  assert.ok(slSig.activeKeys.has('daronbland'));
});

test('Top-Tier-Minus-1 Gemini Flash selector auto-increments as new models come out & supports LOW thinking', () => {
  // Today: gemini-4-hydrogen is #1 -> gemini-3.8-flash is #1 in Top-Minus-1!
  const todayCatalog = [
    { name: 'models/gemini-4-hydrogen', supportedGenerationMethods: ['generateContent'] },
    { name: 'models/gemini-4-hydrogen-preview', supportedGenerationMethods: ['generateContent'] },
    { name: 'models/gemini-3.8-flash', supportedGenerationMethods: ['generateContent'] },
    { name: 'models/gemini-3.6-flash', supportedGenerationMethods: ['generateContent'] }
  ];
  const todayMinusOne = rankSecondTierGeminiFlashModels(todayCatalog);
  assert.equal(todayMinusOne[0], 'gemini-3.8-flash', 'Must step down 1 tier from flagship gemini-4-hydrogen to gemini-3.8-flash');

  // Tomorrow: gemini-5-hydrogen ships -> gemini-4-hydrogen automatically becomes #1 in Top-Minus-1!
  const futureCatalog = [
    { name: 'models/gemini-5-hydrogen', supportedGenerationMethods: ['generateContent'] },
    { name: 'models/gemini-4-hydrogen', supportedGenerationMethods: ['generateContent'] },
    { name: 'models/gemini-3.8-flash', supportedGenerationMethods: ['generateContent'] }
  ];
  const futureMinusOne = rankSecondTierGeminiFlashModels(futureCatalog);
  assert.equal(futureMinusOne[0], 'gemini-4-hydrogen', 'Must auto-increment to gemini-4-hydrogen when gemini-5-hydrogen becomes top tier');
  assert.notEqual(extractGeminiModelFamilyKey('gemini-5-hydrogen'), extractGeminiModelFamilyKey('gemini-4-hydrogen'));

  // LOW thinking config check
  assert.deepEqual(buildGeminiThinkingConfig('gemini-3.8-flash', null, { preferredThinkingLevel: 'LOW' }), {
    thinkingLevel: 'LOW'
  });
  assert.deepEqual(buildGeminiThinkingConfig('gemini-2.5-flash', null, { preferredThinkingLevel: 'LOW' }), {
    thinkingBudget: 1024
  });
});

await testAsync(
  'Live In-Game Injury Lifecycle (Q2 50% QTR -> 99% Return OR 0% Out -> Post-Game Week N+1 Severity Rollover) works for both 49ers & Opponent without mutating Declared Inactives',
  async () => {
    const koIso = '2026-11-15T21:25:00Z';
    const koMs = Date.parse(koIso);
    const q2Ms = koMs + 55 * 60_000; // 2nd Quarter

    const mockAppData = {
      meta: { seasonYear: 2026, currentWeek: 10 },
      roster: {
        players: [
          {
            id: '4361741',
            name: 'Brock Purdy',
            position: 'QB',
            jersey: 13,
            rosterBucket: 'active',
            isStarter: true,
            capHit2026: 12000000,
            recentNews: [],
            health: { status: 'Active', injuryType: '', playProbabilityPct: 95, playBadgeLabel: '95% • Full Go', wed: '-', thu: '-', fri: '-' }
          },
          { id: '14', name: 'Kurtis Rourke', position: 'QB', jersey: 14, rosterBucket: 'active', recentNews: [], health: { status: 'Active', injuryType: '', playProbabilityPct: 95, playBadgeLabel: '95% • Full Go' } },
          { id: '48', name: 'Tatum Bethune', position: 'LB', jersey: 48, rosterBucket: 'active', recentNews: [], health: { status: 'Active', injuryType: '', playProbabilityPct: 95, playBadgeLabel: '95% • Full Go' } },
          { id: '84', name: 'Brandin Cooks', position: 'WR', jersey: 84, rosterBucket: 'active', recentNews: [], health: { status: 'Active', injuryType: '', playProbabilityPct: 95, playBadgeLabel: '95% • Full Go' } }
        ]
      },
      depthChart: {
        units: [
          {
            unit: 'Offense',
            rows: [
              {
                position: 'QB',
                baselineChain: [
                  { playerId: '4361741', name: 'Brock Purdy', playProbabilityPct: 95, statusBadge: '95% • Full Go', isAvailable: true }
                ],
                projectedActiveChain: []
              }
            ]
          }
        ]
      },
      health: {
        week: 10,
        byeWeek: 8,
        practiceReport: [],
        irAndReserveTracker: []
      },
      news: {
        rawStream: [
          {
            id: 'tw_purdy_qtr',
            type: 'tweet',
            title: '49ers QB Brock Purdy (right shoulder) headed to the blue medical tent and is questionable to return.',
            fullText: '49ers QB Brock Purdy (right shoulder) headed to the blue medical tent and is questionable to return.',
            author: 'Matt Maiocco',
            authorHandle: '@MaioccoNBCS',
            outletName: 'NBC Sports Bay Area',
            publishedAt: new Date(q2Ms - 60_000).toISOString(),
            url: 'https://x.com/MaioccoNBCS/status/1990000001'
          }
        ]
      },
      liveGameDay: {
        week: 10,
        sf: {
          officialPosted: true,
          inactives: [
            { name: 'Kurtis Rourke', position: 'QB', reason: 'Healthy Scratch' },
            { name: 'Tatum Bethune', position: 'LB', reason: 'Healthy Scratch' },
            { name: 'Brandin Cooks', position: 'WR', reason: 'Healthy Scratch' }
          ]
        },
        opp: {
          officialPosted: true,
          inactives: [
            { name: 'Jake Ferguson', position: 'TE', reason: 'Knee' },
            { name: 'Ajani Cornelius', position: 'OL', reason: 'Healthy Scratch' },
            { name: 'P.J. Locke', position: 'S', reason: 'Concussion' }
          ]
        },
        oppWireItems: [
          {
            id: 'opp_bland_qtr',
            type: 'tweet',
            title: "DaRon Bland (ankle) is questionable to return to Sunday's game against San Francisco.",
            fullText: "DaRon Bland (ankle) is questionable to return to Sunday's game against San Francisco.",
            author: 'Todd Archer',
            outletName: 'ESPN',
            publishedAt: new Date(q2Ms - 45_000).toISOString(),
            url: 'https://www.espn.com/nfl/injuries'
          }
        ]
      },
      scheduleMatchup: {
        schedule: [
          {
            id: '401873063',
            week: 10,
            dateIso: koIso,
            completed: false,
            statusDetail: 'Q2 06:12',
            opponent: { abbr: 'DAL', name: 'Dallas Cowboys' }
          }
        ],
        upcomingMatchup: {
          week: 10,
          gameId: '401873063',
          dateIso: koIso,
          kickoffIso: koIso,
          oppAbbr: 'DAL',
          oppName: 'Dallas Cowboys',
          opponentHealth: {
            teamAbbr: 'DAL',
            teamName: 'Dallas Cowboys',
            activeRoster: [
              { id: 'd_bland', name: 'DaRon Bland', position: 'CB', isStarter: true, rosterBucket: 'active' },
              { id: 'd_ferg', name: 'Jake Ferguson', position: 'TE', isStarter: true, rosterBucket: 'active' },
              { id: 'd_corn', name: 'Ajani Cornelius', position: 'OL', isStarter: false, rosterBucket: 'active' },
              { id: 'd_locke', name: 'P.J. Locke', position: 'S', isStarter: true, rosterBucket: 'active' }
            ],
            keyStartersHealthy: [
              { id: 'd_bland', name: 'DaRon Bland', position: 'CB', isStarter: true, playProbabilityPct: 95, playBadgeLabel: '95% • Full Go' }
            ],
            injuryReport: [],
            irReserve: [],
            summary: { totalStarters: 22 }
          }
        }
      }
    };

    const origFetch = globalThis.fetch;
    globalThis.fetch = async () => new Response('', { status: 404 });
    try {
      // Phase 1: Q2 Injury -> Purdy pops onto Health Table + Injury News + Player Card at 50% QTR, Inactives card untouched!
      await hydrateLiveGameDayRosters(mockAppData, q2Ms, { prefs: {} });
      assert.equal(mockAppData.health.gameDayRoster.inactives.length, 3, 'Declared Inactives card must NOT change on mid-game injury');
      const purdyRowQ2 = mockAppData.health.practiceReport.find(r => r.name === 'Brock Purdy');
      assert.ok(purdyRowQ2, 'Brock Purdy must dynamically appear on the 49ers Injury Report in Q2');
      assert.equal(purdyRowQ2.playProbabilityPct, 50);
      assert.equal(purdyRowQ2.playBadgeLabel, '50% • QTR (In-Game)');

      const purdyRoster = mockAppData.roster.players.find(p => p.name === 'Brock Purdy');
      assert.equal(purdyRoster.health.playProbabilityPct, 50, 'Player Sheet health must match 50% QTR');
      assert.ok(purdyRoster.recentNews.some(n => n.id === 'tw_purdy_qtr'), 'Player Sheet must receive latest injury tweet');

      const injFeedQ2 = buildTeamInjuryNewsFeed(mockAppData, { nowMs: q2Ms });
      assert.ok(injFeedQ2.some(e => e.name === 'Brock Purdy' && e.topItem.id === 'tw_purdy_qtr'), 'Purdy must appear in Injury News below Health table with latest tweet');

      // Opponent check: DaRon Bland dynamically enters DAL injury report & liveInGameInjuries at 50% QTR
      const dalHealth = mockAppData.scheduleMatchup.upcomingMatchup.opponentHealth;
      const blandRowQ2 = dalHealth.injuryReport.find(r => r.name === 'DaRon Bland');
      assert.ok(blandRowQ2 && blandRowQ2.playProbabilityPct === 50);
      assert.equal(dalHealth.liveInGameInjuries.length, 1);

      // Phase 2A: Purdy comes back in -> returns to 99% • In (Active)!
      const q3ReturnMs = koMs + 95 * 60_000;
      mockAppData.news.rawStream.unshift({
        id: 'tw_purdy_back',
        type: 'tweet',
        title: "Brock Purdy has returned to Sunday's game at quarterback for the 49ers.",
        fullText: "Brock Purdy has returned to Sunday's game at quarterback for the 49ers.",
        author: 'Matt Maiocco',
        publishedAt: new Date(q3ReturnMs - 20_000).toISOString(),
        url: 'https://x.com/MaioccoNBCS/status/1990000002'
      });
      await hydrateLiveGameDayRosters(mockAppData, q3ReturnMs, { prefs: {} });
      assert.equal(mockAppData.health.practiceReport.find(r => r.name === 'Brock Purdy').playProbabilityPct, 99);
      assert.equal(purdyRoster.health.playProbabilityPct, 99);

      // Phase 2B: Suppose instead Purdy aggravates it in Q4 and is ruled out -> drops to 0% • Out (In-Game)!
      const q4OutMs = koMs + 145 * 60_000;
      mockAppData.news.rawStream.unshift({
        id: 'tw_purdy_out',
        type: 'tweet',
        title: 'Brock Purdy (right shoulder) has been ruled out for the remainder of the game.',
        fullText: 'Brock Purdy (right shoulder) has been ruled out for the remainder of the game.',
        author: 'Nick Wagoner',
        publishedAt: new Date(q4OutMs - 15_000).toISOString(),
        url: 'https://x.com/nwagoner/status/1990000003'
      });
      await hydrateLiveGameDayRosters(mockAppData, q4OutMs, { prefs: {} });
      assert.equal(mockAppData.health.practiceReport.find(r => r.name === 'Brock Purdy').playProbabilityPct, 0);
      assert.equal(purdyRoster.health.playBadgeLabel, '0% • Out (In-Game)');

      // Phase 3: Game ends (`completed = true`) -> Immediate rollover resets Purdy from 0% in-game Out to modeled Week 11 play probability!
      mockAppData.scheduleMatchup.schedule[0].completed = true;
      mockAppData.scheduleMatchup.schedule[0].statusDetail = 'Final';
      const postGameMs = koMs + 195 * 60_000;
      await hydrateLiveGameDayRosters(mockAppData, postGameMs, { prefs: {} });

      assert.equal(mockAppData.health.gameDayRoster, null, 'Game-Day Inactives card retires immediately at Final');
      assert.equal(dalHealth.liveInGameInjuries.length, 0, 'Opponent live in-game injury card clears at Final');
      const purdyPostGame = mockAppData.health.practiceReport.find(r => r.name === 'Brock Purdy');
      assert.ok(purdyPostGame, 'Sustained in-game injury carries onto Week N+1 injury report');
      assert.ok(
        purdyPostGame.playProbabilityPct > 20 && purdyPostGame.playProbabilityPct < 90,
        `Post-game rollover must reset 0% in-game Out to modeled next-week play probability based on severity (got ${purdyPostGame.playProbabilityPct}%)`
      );
      assert.equal(purdyPostGame.wed, '-');
      assert.equal(purdyRoster.health.playProbabilityPct, purdyPostGame.playProbabilityPct);
    } finally {
      globalThis.fetch = origFetch;
    }
  }
);

test(
  'IR 21-Day Practice Window Play Probability (>0% GTD), Weekly 4:00 PM ET Activation Deadline & Non-Activation Reversion to 0% • IR',
  () => {
    const sundaySnfKickoffIso = '2026-11-23T01:20:00Z'; // Sunday Nov 22, 8:20 PM EST (Week 11 vs MIN)
    const wedOpenWindowMs = Date.parse('2026-11-18T21:00:00Z'); // Wednesday 4:00 PM EST
    const satBeforeDeadlineMs = Date.parse('2026-11-21T20:59:00Z'); // Saturday 3:59 PM EST (1m before deadline)
    const satAfterDeadlineMs = Date.parse('2026-11-21T21:01:00Z'); // Saturday 4:01 PM EST (1m past deadline)

    // 1. Weekly NFL CBA 4:00 PM ET deadline math across Sunday, TNF, MNF, and Daytime Thanksgiving slates
    const preLock = evaluateWeeklyIrActivationWindow({
      kickoffIso: sundaySnfKickoffIso,
      designatedDateIso: '2026-11-11T19:00:00Z',
      nowMs: satBeforeDeadlineMs
    });
    assert.equal(preLock.hasMissedWeeklyDeadline, false, 'Saturday 3:59 PM EST must remain inside Sunday activation window');
    assert.equal(preLock.windowWeekStage, 2, '11 days post-designation ahead of Week 11 kickoff is Window Week 2');

    const postLock = evaluateWeeklyIrActivationWindow({
      kickoffIso: sundaySnfKickoffIso,
      designatedDateIso: '2026-11-11T19:00:00Z',
      nowMs: satAfterDeadlineMs
    });
    assert.equal(postLock.hasMissedWeeklyDeadline, true, 'Saturday 4:01 PM EST must mark Sunday activation deadline missed');

    // Prime-time TNF (Thursday 8:15 PM EST = 2026-11-20T01:15:00Z) locks Thursday 4:00 PM EST (2026-11-19T21:00:00Z)
    const tnfPre = evaluateWeeklyIrActivationWindow({
      kickoffIso: '2026-11-20T01:15:00Z',
      nowMs: Date.parse('2026-11-19T20:55:00Z')
    });
    const tnfPost = evaluateWeeklyIrActivationWindow({
      kickoffIso: '2026-11-20T01:15:00Z',
      nowMs: Date.parse('2026-11-19T21:05:00Z')
    });
    assert.equal(tnfPre.hasMissedWeeklyDeadline, false);
    assert.equal(tnfPost.hasMissedWeeklyDeadline, true, 'Prime-time TNF locks Thursday at 4:00 PM ET');

    // Prime-time MNF (Monday 8:15 PM EST = 2026-11-24T01:15:00Z) locks Monday 4:00 PM EST (2026-11-23T21:00:00Z)
    const mnfPre = evaluateWeeklyIrActivationWindow({
      kickoffIso: '2026-11-24T01:15:00Z',
      nowMs: Date.parse('2026-11-23T20:55:00Z')
    });
    const mnfPost = evaluateWeeklyIrActivationWindow({
      kickoffIso: '2026-11-24T01:15:00Z',
      nowMs: Date.parse('2026-11-23T21:05:00Z')
    });
    assert.equal(mnfPre.hasMissedWeeklyDeadline, false);
    assert.equal(mnfPost.hasMissedWeeklyDeadline, true, 'Prime-time MNF locks Monday at 4:00 PM ET');

    // Daytime Thanksgiving Thursday (12:30 PM EST = 2026-11-26T17:30:00Z) locks Wednesday 4:00 PM EST (2026-11-25T21:00:00Z)
    const tgDaytimePostWed = evaluateWeeklyIrActivationWindow({
      kickoffIso: '2026-11-26T17:30:00Z',
      nowMs: Date.parse('2026-11-25T21:05:00Z')
    });
    assert.equal(tgDaytimePostWed.hasMissedWeeklyDeadline, true, 'Daytime weekday game locks day prior at 4:00 PM ET');

    // 2. Open 21-day window computes calibrated >0% play probability across ramp weeks & practice progressions (capped <=84% GTD)
    const wk1Lp = computePlayerPlayProbability({
      name: 'C.J. West',
      position: 'DT',
      rosterBucket: 'ir',
      gameStatus: 'IR — 21-Day Window Open',
      isPracticeWindowOpen: true,
      injuryType: 'Knee',
      wed: 'LP',
      thu: '-',
      fri: '-',
      designatedDateIso: '2026-11-18T18:00:00Z',
      kickoffIso: sundaySnfKickoffIso,
      nowMs: wedOpenWindowMs
    });
    const wk3Fp = computePlayerPlayProbability({
      name: 'Nate Hobbs',
      position: 'CB',
      rosterBucket: 'ir',
      gameStatus: 'Questionable',
      isPracticeWindowOpen: true,
      isIrReturnQuestionable: true,
      injuryType: 'Groin',
      wed: 'FP',
      thu: 'FP',
      fri: 'FP',
      beatNote: 'Hobbs logged three full practices and is expected to be activated ahead of Sunday.',
      designatedDateIso: '2026-11-04T18:00:00Z',
      kickoffIso: sundaySnfKickoffIso,
      nowMs: satBeforeDeadlineMs
    });
    assert.ok(wk1Lp.probabilityPct >= 45 && wk1Lp.probabilityPct <= 60, `Expected Week 1 LP IR window ~45-60%, got ${wk1Lp.probabilityPct}%`);
    assert.match(wk1Lp.badgeLabel, /% • GTD|% • Long Shot/);
    assert.ok(wk3Fp.probabilityPct > wk1Lp.probabilityPct, 'Week 3 FP/FP/FP + positive beat note must exceed Week 1 LP');
    assert.ok(wk3Fp.probabilityPct >= 75 && wk3Fp.probabilityPct <= 84, `Unactivated IR returner must cap at <=84% GTD, got ${wk3Fp.probabilityPct}%`);
    assert.equal(wk3Fp.badgeLabel, `${wk3Fp.probabilityPct}% • GTD`);

    // 3. Missing the weekly activation window immediately reverts play probability to 0% • IR
    const missedDeadline = computePlayerPlayProbability({
      name: 'Nate Hobbs',
      position: 'CB',
      rosterBucket: 'ir',
      gameStatus: 'IR — 21-Day Window Open',
      isPracticeWindowOpen: true,
      injuryType: 'Groin',
      wed: 'FP',
      thu: 'FP',
      fri: 'FP',
      designatedDateIso: '2026-11-04T18:00:00Z',
      kickoffIso: sundaySnfKickoffIso,
      nowMs: satAfterDeadlineMs
    });
    assert.equal(missedDeadline.probabilityPct, 0, 'Missing Saturday 4:00 PM ET activation window must revert IR returner to 0%');
    assert.equal(missedDeadline.badgeLabel, '0% • IR');
    assert.ok(missedDeadline.factors.some(f => /activation deadline/i.test(f)));

    // 21-day window expiration (>21.5 days without activation) also reverts to 0% • IR
    const expired21d = computePlayerPlayProbability({
      name: 'Nate Hobbs',
      position: 'CB',
      rosterBucket: 'ir',
      gameStatus: 'IR — 21-Day Window Open',
      isPracticeWindowOpen: true,
      injuryType: 'Groin',
      designatedDateIso: '2026-10-25T18:00:00Z',
      kickoffIso: sundaySnfKickoffIso,
      nowMs: wedOpenWindowMs
    });
    assert.equal(expired21d.probabilityPct, 0);
    assert.equal(expired21d.badgeLabel, '0% • IR');

    // 4. News indicating non-activation OR that 21-day window will definitely not open this week reverts to 0% • IR
    for (const ruling of [
      "Kyle Shanahan said the 49ers won't activate CJ West from injured reserve this week.",
      'West (knee) was not activated Saturday and remains on injured reserve for Week 11.',
      "Shanahan noted the team isn't yet ready to activate West ahead of Sunday's game.",
      'The 49ers will not open Christian Kirk’s 21-day practice window this week, per Matt Maiocco.'
    ]) {
      assert.equal(hasDefiniteIrNonActivationOrWindowClosedSignal(ruling), true, `Must detect ruling: ${ruling}`);
      const res = computePlayerPlayProbability({
        name: ruling.includes('Kirk') ? 'Christian Kirk' : 'C.J. West',
        position: 'DT',
        rosterBucket: 'ir',
        gameStatus: 'IR — 21-Day Window Open',
        isPracticeWindowOpen: !ruling.includes('Kirk'),
        injuryType: 'Knee',
        wed: 'LP',
        thu: 'LP',
        fri: 'FP',
        beatNote: ruling,
        kickoffIso: sundaySnfKickoffIso,
        nowMs: wedOpenWindowMs,
        currentWeek: 11,
        upcomingOppName: 'Minnesota Vikings',
        upcomingOppAbbr: 'MIN'
      });
      assert.equal(res.probabilityPct, 0, `Definite non-activation/window-closed news must revert to 0%: ${ruling}`);
      assert.equal(res.badgeLabel, '0% • IR');
    }

    // Conditional "if he isn't activated" must NOT falsely zero out open-window probability
    assert.equal(
      hasDefiniteIrNonActivationOrWindowClosedSignal('If Hobbs is not activated Saturday, he will still have one week left in his window.'),
      false
    );
    assert.equal(
      hasWindowDefinitelyNotOpeningSignal('Shanahan said the 49ers do not plan to open Nick Martin’s practice window this week.'),
      true
    );

    // 5. Game-day [T-90m, Final) resolver never promotes unactivated IR-window rows to 99% • In (Active)
    const gdRows = resolveGameDayInjuryRows(
      [
        {
          playerId: '4240542',
          name: 'Nate Hobbs',
          position: 'CB',
          rosterBucket: 'ir',
          isIrReturnWindow: true,
          isPracticeWindowOpen: true,
          gameStatus: 'IR — 21-Day Window Open',
          playProbabilityPct: 70,
          playBadgeLabel: '70% • GTD'
        }
      ],
      {
        isActive: true,
        hasConfirmedInactives: true,
        inactives: [{ name: 'Jordan Watkins', position: 'WR' }],
        activeGroups: [{ unit: 'Defense', players: [{ name: 'Renardo Green', position: 'CB' }] }]
      }
    );
    assert.equal(gdRows[0].playProbabilityPct, 0, 'Unactivated IR player on game day must resolve to 0%');
    assert.equal(gdRows[0].playBadgeLabel, '0% • IR');

    // 6. Multi-week persistence & preseason IR-R safeguard on live Week 11 data/health.json & data/roster.json
    const liveHealth = JSON.parse(fs.readFileSync(path.join(rootDir, 'data', 'health.json'), 'utf8'));
    const liveRoster = JSON.parse(fs.readFileSync(path.join(rootDir, 'data', 'roster.json'), 'utf8'));
    for (const openName of ['Nate Hobbs', 'C.J. West']) {
      const rp = liveRoster.players.find(p => p.name === openName);
      if (rp && rp.rosterBucket === 'ir' && rp.health?.isPracticeWindowOpen) {
        assert.ok(
          rp.health.playProbabilityPct > 0,
          `Live open-window IR player ${openName} must have playProbabilityPct > 0 (got ${rp.health.playProbabilityPct})`
        );
        assert.ok(
          liveHealth.practiceReport.some(r => r.name === openName && r.playProbabilityPct > 0),
          `${openName} must appear in health.practiceReport while 21d window is open and >0%`
        );
        const irTrk = liveHealth.irAndReserveTracker.find(r => r.name === openName);
        assert.ok(irTrk && irTrk.playProbabilityPct > 0, `${openName} irAndReserveTracker must expose >0% activation odds`);
      }
    }
    // Preseason cutdown IR-R (`Austen Pleasants`) with 0 post-minimum practices must stay closed at 0% • IR
    const pleasants = liveRoster.players.find(p => p.name === 'Austen Pleasants');
    if (pleasants && pleasants.rosterBucket === 'ir') {
      assert.equal(pleasants.health.isPracticeWindowOpen, false, 'Preseason IR-R without practice must not open 21d window');
      assert.equal(pleasants.health.playProbabilityPct, 0);
    }
  }
);

await testAsync(
  'Player Card rolling news adopts shared breakingClassifier timeliness (Kickoff Epoch Wall, completed-game & prior-tent pruning, playerSnippets) and focused 1m-ago refresh polls focusPlayerId first',
  async () => {
    const { rankPlayerOverviewMentions, rankPlayerInjuryNews } = await import(
      '../src/engine/injuryProbabilityModel.js'
    );
    const { hydrateLiveEspnPlayerBeatWire, hydrateLiveBlueskyBeatWire } = await import(
      '../src/services/dataService.js'
    );

    const wk10KoIso = '2026-11-15T21:25:00Z';
    const wk10KoMs = Date.parse(wk10KoIso);
    const monMorningMs = Date.parse('2026-11-16T18:00:00Z'); // ~17h after Week 10 SF @ DAL completed

    const mockAppData = {
      meta: { currentWeek: 11, updatedAt: new Date(monMorningMs).toISOString() },
      roster: {
        players: [
          {
            id: '4427325',
            name: 'Renardo Green',
            position: 'CB',
            jersey: 0,
            rosterBucket: 'active',
            capHit2026: 1_740_000,
            health: { status: 'Active', injuryType: 'Back', playProbabilityPct: 82, playBadgeLabel: '82% • GTD' },
            recentNews: []
          },
          {
            id: '4361741',
            name: 'Brock Purdy',
            position: 'QB',
            jersey: 13,
            rosterBucket: 'active',
            capHit2026: 53_000_000,
            health: { status: 'Active', injuryType: '', playProbabilityPct: 99, playBadgeLabel: '99% • Active' },
            recentNews: []
          }
        ]
      },
      scheduleMatchup: {
        schedule: [
          { week: 9, opponent: 'LV', oppName: 'Las Vegas Raiders', completed: true, dateIso: '2026-11-08T21:05:00Z' },
          { week: 10, opponent: 'DAL', oppName: 'Dallas Cowboys', completed: true, dateIso: wk10KoIso },
          { week: 11, opponent: 'SEA', oppName: 'Seattle Seahawks', completed: false, dateIso: '2026-11-22T21:05:00Z' }
        ],
        upcomingMatchup: { week: 11, opponent: 'SEA', oppName: 'Seattle Seahawks', dateIso: '2026-11-22T21:05:00Z' }
      },
      news: { rawStream: [] }
    };

    const syntheticCandidates = [
      // Stale Week 9 blue-tent tweet (7d old, prior completed game) -> MUST BE PRUNED
      {
        id: 'stale_wk9_tent',
        type: 'tweet',
        author: 'Jennifer Lee Chan',
        title: 'Renardo Green is limping towards the bench area and into the blue tent, questionable to return',
        fullText: 'Renardo Green is limping towards the bench area and into the blue tent, questionable to return',
        publishedAt: '2026-11-08T23:42:15Z',
        url: 'https://x.com/jenniferleechan/status/1987000000000000001'
      },
      // Stale pre-Week-10 Wednesday DNP blurb -> MUST BE PRUNED
      {
        id: 'stale_wk10_dnp',
        type: 'article',
        wireSource: 'espn_player_wire',
        author: 'Matt Barrows',
        title: 'Green (back) did not practice Wednesday ahead of Sunday\'s game against the Cowboys.',
        publishedAt: '2026-11-12T00:43:00Z',
        url: 'https://www.espn.com/nfl/player/_/id/4427325/renardo-green#:~:text=Wednesday'
      },
      // Stale pre-Week-10 Friday status tweet -> MUST BE PRUNED
      {
        id: 'stale_wk10_status',
        type: 'tweet',
        author: 'Jennifer Lee Chan',
        title: '#49ers game status vs DAL: Questionable CB Renardo Green (back)',
        fullText: '#49ers game status vs DAL: Questionable CB Renardo Green (back)',
        publishedAt: '2026-11-13T21:59:23Z',
        url: 'https://x.com/jenniferleechan/status/1988800000000000002'
      },
      // Pre-kickoff Saturday feature (non-availability) -> KEPT, but demoted below post-game items by Kickoff Epoch Wall
      {
        id: 'pregame_feature',
        type: 'article',
        author: 'Casey Lima',
        title: 'Renardo Green Emerging as a Key Defensive Playmaker for 49ers',
        summary: 'With four interceptions and six pass breakups, Renardo Green has excelled in coverage.',
        publishedAt: '2026-11-14T16:54:00Z',
        url: 'https://www.49erswebzone.com/articles/205141-renardo-green-emerging-defensive-playmaker/'
      },
      // Post-game Shanahan injury update (sole player in summary) -> MUST OUTRANK pregame feature
      {
        id: 'postgame_shanahan_inj',
        type: 'article',
        author: 'David Bonilla',
        title: '49ers injury update: Kyle Shanahan reveals latest after win over Cowboys',
        summary: 'The 49ers emerged relatively healthy from their 46-40 win over the Cowboys. Kyle Shanahan provided an injury update on cornerback Renardo Green.',
        mentionedPlayers: [{ id: '4427325', name: 'Renardo Green' }],
        publishedAt: '2026-11-16T02:10:00Z',
        url: 'https://www.49erswebzone.com/articles/205186-injury-update-shanahan-reveals-cowboys/'
      },
      // Monday post-game multi-player film/takeaways article with playerSnippets -> MUST USE playerSnippet & rank above pregame
      {
        id: 'monday_takeaways_snip',
        type: 'article',
        author: 'Kyle Posey',
        title: '9 Winners, 7 losers, and 1 IDK from the 49ers win over the Cowboys',
        summary: 'Brock Purdy and Christian McCaffrey carried the offense in Dallas.',
        playerSnippets: {
          '4427325': 'Prysock went in for Renardo Green after Green left with a back injury. Prysock played 28 snaps.'
        },
        mentionedPlayers: [
          { id: '4361741', name: 'Brock Purdy' },
          { id: '4427325', name: 'Renardo Green' }
        ],
        publishedAt: '2026-11-16T17:15:00Z',
        url: 'https://www.ninersnation.com/2026/11/16/49ers-cowboys-winners-losers/'
      }
    ];

    const rankedGreen = rankPlayerOverviewMentions(mockAppData.roster.players[0], {
      rawStream: syntheticCandidates,
      appData: mockAppData,
      nowMs: monMorningMs
    });
    const rankedIds = rankedGreen.map(x => x.id);
    assert.equal(rankedIds.includes('stale_wk9_tent'), false, '7d-old prior-game blue-tent tweet must be pruned');
    assert.equal(rankedIds.includes('stale_wk10_dnp'), false, 'Completed-game Wednesday DNP blurb must be pruned');
    assert.equal(rankedIds.includes('stale_wk10_status'), false, 'Completed-game Friday status list must be pruned');
    assert.ok(
      rankedIds.indexOf('monday_takeaways_snip') < rankedIds.indexOf('pregame_feature') &&
        rankedIds.indexOf('postgame_shanahan_inj') < rankedIds.indexOf('pregame_feature'),
      `Post-game injury/takeaway updates must rank above pre-kickoff Saturday feature via Kickoff Epoch Wall: ${JSON.stringify(rankedIds)}`
    );
    assert.equal(
      rankedGreen.find(x => x.id === 'monday_takeaways_snip')?.summary,
      'Prysock went in for Renardo Green after Green left with a back injury. Prysock played 28 snaps.',
      'Multi-player beat article must surface player-scoped snippet on Player Card'
    );

    // Live data verification on Renardo Green in refreshed data/roster.json + data/news.json
    const liveBundle = {
      meta: JSON.parse(fs.readFileSync(path.join(rootDir, 'data', 'meta.json'), 'utf8')),
      roster: JSON.parse(fs.readFileSync(path.join(rootDir, 'data', 'roster.json'), 'utf8')),
      news: JSON.parse(fs.readFileSync(path.join(rootDir, 'data', 'news.json'), 'utf8')),
      health: JSON.parse(fs.readFileSync(path.join(rootDir, 'data', 'health.json'), 'utf8')),
      scheduleMatchup: JSON.parse(fs.readFileSync(path.join(rootDir, 'data', 'schedule-matchup.json'), 'utf8'))
    };
    const liveGreen = liveBundle.roster.players.find(p => p.name === 'Renardo Green');
    assert.ok(liveGreen, 'Renardo Green must exist on live 49ers roster');
    const liveGreenOv = rankPlayerOverviewMentions(liveGreen, {
      rawStream: liveBundle.news.rawStream,
      appData: liveBundle
    });
    assert.ok(liveGreenOv.length >= 4, `Expected >=4 fresh Overview mentions for Renardo Green, got ${liveGreenOv.length}`);
    assert.equal(
      liveGreenOv.some(it => /into the blue tent|did not practice Wednesday/i.test(`${it.fullText || ''} ${it.headline || ''}`)),
      false,
      'Live Renardo Green Overview must not contain stale Week 9 blue-tent or pre-Week-10 Wednesday DNP blurbs'
    );
    const liveGreenInj = rankPlayerInjuryNews(liveGreen, {
      rawStream: liveBundle.news.rawStream,
      appData: liveBundle
    });
    assert.ok(liveGreenInj.length >= 1, 'Renardo Green Injury News must contain fresh injury coverage');

    // Verify focused player sync (`focusPlayerId`) polls focused player FIRST with limit=10 & Bluesky self-threads/link-descriptions work
    const origFetch = globalThis.fetch;
    const polledEspnUrls = [];
    const polledBskyUrls = [];
    try {
      globalThis.fetch = async url => {
        const u = String(url);
        if (u.includes('apis/fantasy/v2/games/ffl/news/players')) {
          polledEspnUrls.push(u);
          if (u.includes('playerId=9991234')) {
            return {
              ok: true,
              json: async () => ({
                feed: [
                  {
                    id: 777001,
                    published: new Date().toISOString(),
                    headline: 'Healthy Starter exited Sunday\'s game',
                    description: 'Healthy Starter (ankle) exited Sunday\'s game and is questionable to return, Matt Maiocco of NBC Sports Bay Area reports.',
                    type: 'Rotowire'
                  }
                ]
              })
            };
          }
          return { ok: true, json: async () => ({ feed: [] }) };
        }
        if (u.includes('public.api.bsky.app/xrpc/app.bsky.feed.getAuthorFeed')) {
          polledBskyUrls.push(u);
          if (u.includes('49erswebzone.bsky.social')) {
            return {
              ok: true,
              json: async () => ({
                feed: [
                  {
                    post: {
                      uri: 'at://did:plc:wz/app.bsky.feed.post/3testwzgreen99',
                      author: { did: 'did:plc:wz', handle: '49erswebzone.bsky.social' },
                      record: {
                        text: '#49ers postgame injury update after win\n\nRead:',
                        createdAt: new Date().toISOString()
                      },
                      embed: {
                        external: {
                          uri: 'https://www.49erswebzone.com/articles/999999-test-green-update/',
                          title: '49ers postgame injury update after win',
                          description: 'Kyle Shanahan provided a fresh postgame injury update on cornerback Renardo Green.'
                        }
                      }
                    }
                  }
                ]
              })
            };
          }
          return { ok: true, json: async () => ({ feed: [] }) };
        }
        return { ok: false, status: 404, json: async () => ({}), text: async () => '' };
      };

      const focusTestData = {
        meta: { currentWeek: 11 },
        health: { week: 11, byeWeek: 8 },
        scheduleMatchup: mockAppData.scheduleMatchup,
        roster: {
          players: [
            ...Array.from({ length: 25 }, (_, idx) => ({
              id: String(5000000 + idx),
              name: `Starter Player${idx}`,
              position: 'LB',
              jersey: idx + 1,
              rosterBucket: 'active',
              capHit2026: 20_000_000 - idx * 100_000,
              health: { status: 'Questionable', isOnPracticeReport: true, injuryType: 'Knee' },
              recentNews: []
            })),
            // Low-cap previously healthy player #26 (would NOT be in top-18 priority cohort without focusPlayerId!)
            {
              id: '9991234',
              name: 'Healthy Starter',
              position: 'CB',
              jersey: 29,
              rosterBucket: 'active',
              capHit2026: 985_000,
              health: { status: 'Active', isOnPracticeReport: false, injuryType: '' },
              recentNews: []
            },
            mockAppData.roster.players[0]
          ]
        },
        news: { rawStream: [] }
      };

      const addedFocus = await hydrateLiveEspnPlayerBeatWire(focusTestData, {
        maxPriority: 5,
        sweepBatchSize: 0,
        focusPlayerId: '9991234',
        manual: true
      });
      assert.equal(addedFocus, 1, 'Focused player wire poll must immediately ingest newly injured player update');
      assert.ok(
        polledEspnUrls[0]?.includes('playerId=9991234&limit=10'),
        `Focused player must be polled #1 with limit=10, got: ${polledEspnUrls[0]}`
      );

      const addedBsky = await hydrateLiveBlueskyBeatWire(focusTestData, { isGameLive: true, manual: true });
      assert.ok(addedBsky >= 1, 'Bluesky wire must ingest link-card post matching player via externalDescription');
      assert.ok(
        polledBskyUrls.some(u => u.includes('filter=posts_and_author_threads') && u.includes('limit=30')),
        'Bluesky wire must query posts_and_author_threads with limit=30 on manual/live sync'
      );
      const greenRecent = focusTestData.roster.players.find(p => p.id === '4427325')?.recentNews || [];
      assert.ok(
        greenRecent.some(n => String(n.externalDescription || '').includes('Renardo Green')),
        'Link-card externalDescription player match must propagate directly onto player.recentNews'
      );
    } finally {
      globalThis.fetch = origFetch;
    }
  }
);

await testAsync(
  'Inline Video Clips: no-referrer meta, HD X syndication MP4 selector, YouTube referrer override & Worker /api/video-stream relay',
  async () => {
    const indexHtml = fs.readFileSync(path.join(rootDir, 'index.html'), 'utf8');
    assert.ok(
      /<meta\s+name="referrer"\s+content="no-referrer"\s*\/?>/i.test(indexHtml),
      'index.html must include <meta name="referrer" content="no-referrer"> so video.twimg.com never rejects <video> requests with HTTP 403'
    );

    const { renderVideoEmbedOrFacade } = await import('../src/views/newsView.js');
    const ytIframeHtml = renderVideoEmbedOrFacade('yt_test', 'dsgfOdzDXxU', 0, 'Film Study', 'YouTube', true, true);
    assert.ok(
      ytIframeHtml.includes('referrerpolicy="strict-origin-when-cross-origin"'),
      'YouTube <iframe> must explicitly set referrerpolicy="strict-origin-when-cross-origin" to override document no-referrer'
    );

    const inlineMp4Html = renderVideoEmbedOrFacade('raw_kittle_clip', null, 0, 'George Kittle Clip', 'KNBR 680', true, true, {
      compactFooter: true,
      videoStreamUrl: 'https://video.twimg.com/amplify_video/2122154774003068928/vid/avc1/720x1280/QgD62E7DwhpVRO70.mp4?tag=16',
      posterUrl: 'https://pbs.twimg.com/amplify_video_thumb/2122154774003068928/img/DoASRnuL_BgnWnEv.jpg',
      externalWatchUrl: 'https://x.com/KNBR/status/2122154844400325009'
    });
    assert.ok(
      inlineMp4Html.includes('preload="auto"') &&
        inlineMp4Html.includes('data-watch-url="https://x.com/KNBR/status/2122154844400325009"') &&
        inlineMp4Html.includes('data-provider="X"'),
      'Active inline <video> must set preload="auto" and attach data-watch-url/data-provider fallback metadata'
    );

    // 1. Real X syndication payload where `video.variants` omits bitrate and `mediaDetails` carries bitrates
    const realXSyn = {
      mediaDetails: [
        {
          video_info: {
            variants: [
              { content_type: 'application/x-mpegURL', url: 'https://video.twimg.com/amplify_video/1/pl/a.m3u8' },
              { bitrate: 632000, content_type: 'video/mp4', url: 'https://video.twimg.com/amplify_video/1/vid/avc1/320x568/low.mp4' },
              { bitrate: 2176000, content_type: 'video/mp4', url: 'https://video.twimg.com/amplify_video/1/vid/avc1/720x1280/hd720.mp4' },
              { bitrate: 10368000, content_type: 'video/mp4', url: 'https://video.twimg.com/amplify_video/1/vid/avc1/1080x1920/mezz1080.mp4' }
            ]
          }
        }
      ],
      video: {
        variants: [
          { type: 'application/x-mpegURL', src: 'https://video.twimg.com/amplify_video/1/pl/a.m3u8' },
          { type: 'video/mp4', src: 'https://video.twimg.com/amplify_video/1/vid/avc1/320x568/low.mp4' },
          { type: 'video/mp4', src: 'https://video.twimg.com/amplify_video/1/vid/avc1/720x1280/hd720.mp4' },
          { type: 'video/mp4', src: 'https://video.twimg.com/amplify_video/1/vid/avc1/1080x1920/mezz1080.mp4' }
        ]
      }
    };
    assert.equal(
      selectBestXSyndicationMp4(realXSyn),
      'https://video.twimg.com/amplify_video/1/vid/avc1/720x1280/hd720.mp4',
      'Must select 720p HD <=5Mbps sweet spot rather than blurry 320x568 or 10.4Mbps cellular stall'
    );

    // 2. `video.variants`-only payload without bitrate field must still parse WxH and pick HD over variants[0]
    const noBitrateSyn = {
      video: {
        variants: [
          { type: 'video/mp4', src: 'https://video.twimg.com/amplify_video/2/vid/avc1/480x270/sd.mp4' },
          { type: 'video/mp4', src: 'https://video.twimg.com/amplify_video/2/vid/avc1/1280x720/hd.mp4' }
        ]
      }
    };
    assert.equal(
      selectBestXSyndicationMp4(noBitrateSyn),
      'https://video.twimg.com/amplify_video/2/vid/avc1/1280x720/hd.mp4'
    );

    // 3. Strict SSRF allowlist on video stream URLs
    assert.equal(isAllowedInlineVideoStreamUrl('https://video.twimg.com/amplify_video/1/vid/avc1/1280x720/hd.mp4'), true);
    assert.equal(isAllowedInlineVideoStreamUrl('https://espnmedia-cdn.akamaized.net/espn/media/clip.mp4'), true);
    assert.equal(isAllowedInlineVideoStreamUrl('http://video.twimg.com/clip.mp4'), false);
    assert.equal(isAllowedInlineVideoStreamUrl('https://evil.example.com/clip.mp4'), false);

    // 4. Worker `/api/video-stream` Range-relay strips Referer and rejects disallowed hosts
    const workerMod = (await import('../worker/index.js')).default;
    const origFetch = globalThis.fetch;
    let capturedUpstreamHeaders = null;
    try {
      globalThis.fetch = async (_url, init = {}) => {
        capturedUpstreamHeaders = init.headers || {};
        return new Response(new Uint8Array([0, 0, 0, 24]), {
          status: 206,
          headers: {
            'Content-Type': 'video/mp4',
            'Content-Range': 'bytes 0-3/1000',
            'Content-Length': '4'
          }
        });
      };

      const badReq = new Request('https://49ers-worker.example.workers.dev/api/video-stream?url=https://evil.com/a.mp4');
      const badRes = await workerMod.fetch(badReq, {});
      assert.equal(badRes.status, 400, 'Worker /api/video-stream must reject non-allowlisted hosts');

      const okReq = new Request(
        'https://49ers-worker.example.workers.dev/api/video-stream?url=' +
          encodeURIComponent('https://video.twimg.com/amplify_video/1/vid/avc1/720x1280/hd.mp4'),
        {
          headers: {
            Origin: 'https://49ers.joshal.com',
            Referer: 'https://49ers.joshal.com/',
            Range: 'bytes=0-3'
          }
        }
      );
      const okRes = await workerMod.fetch(okReq, { ALLOWED_ORIGIN: 'https://49ers.joshal.com' });
      assert.equal(okRes.status, 206);
      assert.equal(okRes.headers.get('Content-Range'), 'bytes 0-3/1000');
      assert.equal(capturedUpstreamHeaders.Range, 'bytes=0-3');
      assert.equal(capturedUpstreamHeaders.Referer, undefined, 'Worker relay must never forward Referer to video.twimg.com');
    } finally {
      globalThis.fetch = origFetch;
    }
  }
);

test(
  'Fluid AI Top News Brief v5: removes redundant summary box, eliminates literal Bold Subtopic across all prompts/renderers, gates cap boilerplate dynamically, and synthesizes full postgame box-score storylines',
  () => {
    const liveData = {
      meta: JSON.parse(fs.readFileSync(path.join(rootDir, 'data', 'meta.json'), 'utf8')),
      roster: JSON.parse(fs.readFileSync(path.join(rootDir, 'data', 'roster.json'), 'utf8')),
      cap: JSON.parse(fs.readFileSync(path.join(rootDir, 'data', 'cap.json'), 'utf8')),
      health: JSON.parse(fs.readFileSync(path.join(rootDir, 'data', 'health.json'), 'utf8')),
      news: JSON.parse(fs.readFileSync(path.join(rootDir, 'data', 'news.json'), 'utf8')),
      seasonal: JSON.parse(fs.readFileSync(path.join(rootDir, 'data', 'seasonal.json'), 'utf8')),
      scheduleMatchup: JSON.parse(fs.readFileSync(path.join(rootDir, 'data', 'schedule-matchup.json'), 'utf8'))
    };

    // 1. Redundant top summary-of-summary box is completely removed in both News -> All AND Home subcard
    const briefWithLegacySummary = {
      ...liveData.news.dailyTopNewsBrief,
      summary: 'Redundant top summary box that must never render above the bullets.'
    };
    const allCardHtml = renderDailyTopNewsBriefHtml(briefWithLegacySummary, {
      rawStream: liveData.news.rawStream,
      appData: liveData,
      asSubcard: false
    });
    const homeSubcardHtml = renderDailyTopNewsBriefHtml(briefWithLegacySummary, {
      rawStream: liveData.news.rawStream,
      appData: liveData,
      asSubcard: true
    });
    assert.ok(!allCardHtml.includes('daily-brief-summary') && !allCardHtml.includes('coaching-thesis-copy'));
    assert.ok(!homeSubcardHtml.includes('daily-brief-summary') && !homeSubcardHtml.includes('coaching-thesis-copy'));
    assert.ok(!allCardHtml.includes('Redundant top summary box'));

    // 2. Zero literal "Bold Subtopic" / "Subtopic" / "Topic Title" in prompts OR rendered HTML (structured objects & strings)
    const matchupPrompt = buildDailyMatchupIntelPrompt(liveData);
    assert.ok(!/bold subtopic/i.test(matchupPrompt), 'Matchup prompt must never contain literal "Bold Subtopic"');
    const cands = selectTopNewsBriefSourceCandidates(liveData, 18, Date.parse(liveData.meta.updatedAt));
    const briefPrompt = buildDailyTopNewsBriefPrompt(liveData, cands, Date.parse(liveData.meta.updatedAt));
    assert.ok(
      !briefPrompt.includes('"Bold Subtopic:') && !briefPrompt.includes('"Topic Title:'),
      'Brief prompt schema must use concrete subtopic examples without literal placeholder strings'
    );

    const structuredParsed = parseAndSanitizeDailyTopNewsBrief(
      JSON.stringify({
        headline: 'Offense Erupts for 584 Yards as 49ers Outlast Cowboys 46–40 to Reach 8-1',
        bullets: [
          {
            subtopic: 'Bold Subtopic: Cowboys Shootout Win',
            body: 'San Francisco moved to 8-1 (1st in NFC West) with a 46–40 road victory and 584 total yards [S1].'
          },
          {
            subtopic: 'Bold Subtopic',
            body: 'McCaffrey & Purdy Shine: Christian McCaffrey posted 223 scrimmage yards and three TDs while Brock Purdy threw for 389 yards (154.5 rating) [S2].'
          },
          'Bullet 3: **Bold Subtopic**: Defense & Trench Tape: Malik Mustapha recorded an interception, though Dallas passed for 343 yards and five scores [S3].',
          {
            subtopic: 'Looking Ahead',
            body: 'Pass protection and cornerback health headline preparations ahead of Mexico City [S4].'
          }
        ],
        citedSourceIds: ['S1', 'S2', 'S3', 'S4']
      }),
      cands,
      liveData
    );
    assert.ok(structuredParsed && structuredParsed.bullets.length === 4);
    assert.equal(structuredParsed.summary, '', 'New summary-free schema must emit empty summary string');
    const structuredHtml = renderDailyTopNewsBriefHtml(structuredParsed, { appData: liveData });
    const structuredText = structuredHtml.split('<details')[0].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
    assert.ok(!/bold subtopic|bullet 3/i.test(structuredText), `Placeholder subtopics leaked: ${structuredText}`);
    assert.ok(structuredHtml.includes('<strong>Cowboys Shootout Win:</strong>'));
    assert.ok(structuredHtml.includes('<strong>McCaffrey &amp; Purdy Shine:</strong>'));
    assert.ok(structuredHtml.includes('<strong>Defense &amp; Trench Tape:</strong>'));
    assert.ok(structuredHtml.includes('<strong>Looking Ahead:</strong>'));

    // 3. Dynamic Focus & Salary-Cap Restraint (no formulaic cap overfocus post-game or mid-week; enabled in offseason or fresh cap news)
    const postGameNowMs = Date.parse('2026-11-16T19:00:00Z');
    const postGameCapCheck = hasActiveCapOrTransactionStoryline(liveData, cands, postGameNowMs);
    assert.equal(postGameCapCheck.active, false, 'Post-game window 6 days after deadline with no cap wire must gate off cap boilerplate');
    assert.ok(briefPrompt.includes('SALARY CAP RESTRAINT'), 'Post-game prompt must explicitly restrain unprompted salary-cap filler');

    const postGameRecapBrief = liveData.news.dailyTopNewsBrief?.isPostGame
      ? liveData.news.dailyTopNewsBrief
      : buildDeterministicDailyTopNewsBrief(liveData, postGameNowMs);
    const liveBriefProse = postGameRecapBrief.bullets.join(' ');
    assert.ok(
      !/article 13|void years|\$39\.\d+m|\$35\.\d+m/i.test(liveBriefProse),
      `Post-game brief must NOT contain formulaic salary-cap rollover boilerplate: ${liveBriefProse}`
    );
    assert.ok(/584/.test(liveBriefProse), 'Post-game brief must highlight 584 total offensive yards');
    assert.ok(/McCaffrey/.test(liveBriefProse) && /223/.test(liveBriefProse), 'Post-game brief must spotlight McCaffrey 223 scrimmage yards');
    assert.ok(/Purdy/.test(liveBriefProse) && /389/.test(liveBriefProse), 'Post-game brief must spotlight Purdy 389 passing yards');
    assert.ok(/Keenan Allen/.test(liveBriefProse), 'Post-game brief must include Keenan Allen debut');
    assert.ok(/343/.test(liveBriefProse) && /Renardo Green/.test(liveBriefProse), 'Post-game brief must honestly report 343 passing yards yielded & Renardo Green injury exit');

    // Also verify non-postgame deterministic fallback meets ~165-275 word count without cap filler
    const midWeekFallback = buildDeterministicDailyTopNewsBrief(liveData, Date.parse('2026-11-17T06:45:00Z'));
    assert.ok(
      midWeekFallback.wordCount >= 165 && midWeekFallback.wordCount <= 275,
      `Mid-week deterministic brief wordCount (${midWeekFallback.wordCount}) must stay ~2/3 of Coaching Matchup`
    );
    assert.ok(
      !/article 13|void years/i.test(midWeekFallback.bullets.join(' ')),
      'Mid-week brief with no active cap wire must omit formulaic salary-cap filler'
    );

    // Offseason window (March) automatically enables salary-cap & free-agency context
    const marchOffseasonMs = Date.parse('2027-03-14T18:00:00Z');
    assert.equal(hasActiveCapOrTransactionStoryline(liveData, [], marchOffseasonMs).active, true);

    // Fresh midseason restructure wire dynamically re-enables cap context
    const restructureCands = [
      {
        refId: 'S1',
        type: 'tweet',
        title: '49ers restructured LT Trent Williams contract to clear $11.4M in 2026 salary cap space.',
        fullBody: '49ers restructured LT Trent Williams contract to clear $11.4M in 2026 salary cap space.',
        category: 'cap'
      }
    ];
    assert.equal(hasActiveCapOrTransactionStoryline(liveData, restructureCands, postGameNowMs).active, true);

    // 4. Snap-count thread deduplication: at most 1 raw snap-count list in candidate pool
    const snapCountItems = cands.filter(c => /\bsnap count\b/i.test(`${c.title} ${c.fullBody}`));
    assert.ok(snapCountItems.length <= 1, `Expected <=1 raw snap-count list in brief candidates, got ${snapCountItems.length}`);

    // 5. Previous-update freshness anchor injected when prior-cycle brief exists
    const promptWithPrior = buildDailyTopNewsBriefPrompt(liveData, cands, postGameNowMs, {
      previousBrief: {
        cycleKey: '2026-11-14@17PT',
        generatedAt: '2026-11-15T01:00:00Z',
        headline: '49ers Finalize Cowboys Travel Roster as Samuel Clears Practice Week'
      }
    });
    assert.ok(promptWithPrior.includes('PREVIOUS UPDATE') && promptWithPrior.includes('Bias decisively toward the FRESHEST news'));
  }
);

await testAsync(
  'In-game & post-game injury rollover promotes Renardo Green despite ESPN IDP lag while guarding tent returners, healthy starters, promo duplicates & teammate bleed',
  async () => {
    const {
      assemblePlayerNewsItemText,
      extractInjuryBodyPartFromProse,
      evaluateCorroboratedNewsInjurySignal,
      reconcileRosterAndHealthWithNews
    } = await import('../src/engine/injuryProbabilityModel.js');
    const { resolveEarlyWeekRolloverInput } = await import('../src/engine/gameDayRosterEngine.js');

    // 0. Live data/health.json invariant: Renardo Green (CB #0, Back) is listed cleanly on Week 11 Injury Report
    const liveHealth = JSON.parse(fs.readFileSync(path.join(rootDir, 'data', 'health.json'), 'utf8'));
    const liveGreenRow = (liveHealth.practiceReport || []).find(r => r.name === 'Renardo Green');
    assert.ok(liveGreenRow, 'Renardo Green must be present on data/health.json practiceReport');
    assert.equal(liveGreenRow.injuryType, 'Back');
    assert.ok(
      liveGreenRow.playProbabilityPct >= 60 && liveGreenRow.playProbabilityPct <= 75,
      `Expected Renardo Green playProbabilityPct in [60, 75], got ${liveGreenRow.playProbabilityPct}`
    );
    assert.ok(
      !/is active for sunday|defeated the 49ers 29 renardo|\.\./i.test(liveGreenRow.beatComment || ''),
      `Renardo Green beatComment must be clean & grammatical: ${liveGreenRow.beatComment}`
    );

    // 1. Sentence-boundary assembly & body-part extraction (including "w/his back injury" and homonym guards)
    const assembled = assemblePlayerNewsItemText(
      {
        title: '49ers vs. Cowboys Grades',
        summary: 'The Falcons defeated the 49ers 29',
        playerSnippet: 'Renardo Green left with the same back injury he dealt with all week ..',
        playerSnippets: {
          '9999': 'Ephesians Prysock went in for Renardo Green. Renardo Green left with the same back injury he dealt with all week.'
        }
      },
      'Renardo Green',
      '4427325'
    );
    assert.ok(
      assembled.fullBody.includes('29. Renardo Green'),
      `Truncated summary must terminate cleanly with a period before playerSnippet: ${assembled.fullBody}`
    );
    assert.equal(
      extractInjuryBodyPartFromProse('#49ers CB Renardo Green, who was unable to finish the game w/his back injury, is day to day.'),
      'Back'
    );
    assert.equal(
      extractInjuryBodyPartFromProse('Player returned back to the huddle and lent a hand on the drive.'),
      '',
      'Non-medical football homonyms ("back to the huddle", "lent a hand") must never false-match Back/Hand'
    );

    // 2. Simulate Monday 12:19 PM PT state: ESPN still shows stale Sunday "Green (back) is active for Sunday's game",
    //    only post-kickoff recap snippets / beat posts exist -> Green MUST be promoted onto practiceReport!
    const wk10KoMs = Date.parse('2026-11-15T21:25:00Z');
    const wk10EndMs = wk10KoMs + 3.25 * 3_600_000;
    const monMorningMs = Date.parse('2026-11-16T20:19:00Z');

    const mockAppData = {
      meta: { seasonYear: 2026, currentWeek: 11, byeWeek: 8 },
      roster: {
        players: [
          {
            id: '4427325',
            name: 'Renardo Green',
            position: 'CB',
            jersey: 0,
            rosterBucket: 'active',
            primarySnapPct: 93,
            capHit2026: 1_550_000,
            health: {
              isOnPracticeReport: false,
              status: 'Active',
              injuryType: '',
              wed: '-',
              thu: '-',
              fri: '-',
              shortComment: "Green (back) is active for Sunday's game against the Cowboys.",
              longComment: "Green (back) is active for Sunday's game against the Cowboys.",
              playProbabilityPct: 95,
              playBadgeLabel: '95% • Full Go',
              weeklyHistory2026: [{ week: 10, injury: 'Back', gameStatus: 'Questionable', practiceStatus: 'LP' }]
            }
          },
          {
            id: '4362887',
            name: 'Deommodore Lenoir',
            position: 'CB',
            jersey: 2,
            rosterBucket: 'active',
            primarySnapPct: 98,
            capHit2026: 14_200_000,
            health: {
              isOnPracticeReport: false,
              status: 'Active',
              injuryType: '',
              wed: '-',
              thu: '-',
              fri: '-',
              shortComment: "Lenoir (foot) is active for Sunday's game against the Cowboys.",
              longComment: "Lenoir (foot) is active for Sunday's game against the Cowboys.",
              playProbabilityPct: 95,
              playBadgeLabel: '95% • Full Go',
              weeklyHistory2026: [{ week: 10, injury: 'Foot', gameStatus: 'Questionable', practiceStatus: 'LP' }]
            }
          },
          {
            id: '3915416',
            name: 'Demarcus Robinson',
            position: 'WR',
            jersey: 15,
            rosterBucket: 'active',
            primarySnapPct: 64,
            capHit2026: 2_500_000,
            health: {
              isOnPracticeReport: false,
              status: 'Active',
              injuryType: '',
              wed: '-',
              thu: '-',
              fri: '-',
              shortComment: '',
              longComment: '',
              playProbabilityPct: 99,
              playBadgeLabel: '99% • Full Go',
              weeklyHistory2026: []
            }
          },
          {
            id: '4241986',
            name: 'Dominick Puni',
            position: 'G',
            jersey: 77,
            rosterBucket: 'active',
            primarySnapPct: 100,
            capHit2026: 1_300_000,
            health: {
              isOnPracticeReport: false,
              status: 'Active',
              injuryType: '',
              wed: '-',
              thu: '-',
              fri: '-',
              shortComment: '',
              longComment: '',
              playProbabilityPct: 99,
              playBadgeLabel: '99% • Full Go',
              weeklyHistory2026: []
            }
          }
        ]
      },
      health: {
        week: 11,
        byeWeek: 8,
        practiceReport: [],
        irAndReserveTracker: []
      },
      news: {
        rawStream: [
          // Pre-kickoff Week 10 clearance tweet (must NEVER promote Lenoir or Green on its own)
          {
            id: 'pregame_lenoir',
            type: 'tweet',
            author: 'Matt Maiocco',
            trustTier: 1,
            publishedAt: new Date(wk10KoMs - 60 * 60_000).toISOString(),
            fullText: 'Deommodore Lenoir (foot) and Renardo Green (back) are active today in Dallas.'
          },
          // Mid-game Q2 blue-tent tweet for Demarcus Robinson FOLLOWED by return-to-game tweet -> must cancel!
          {
            id: 'midgame_drob_tent',
            type: 'tweet',
            author: 'Matt Barrows',
            trustTier: 1,
            publishedAt: new Date(wk10KoMs + 45 * 60_000).toISOString(),
            fullText: 'WR Demarcus Robinson went into the blue medical tent and is questionable to return.'
          },
          {
            id: 'midgame_drob_back',
            type: 'tweet',
            author: 'Matt Barrows',
            trustTier: 1,
            publishedAt: new Date(wk10KoMs + 58 * 60_000).toISOString(),
            fullText: 'Demarcus Robinson has returned to the game after a brief stint in the blue medical tent.'
          },
          // Brand-new Q3 in-game exit for previously unlisted Dominick Puni (published DURING the game before wk10EndMs!)
          {
            id: 'midgame_puni_exit',
            type: 'tweet',
            author: 'Nick Wagoner',
            trustTier: 1,
            publishedAt: new Date(wk10KoMs + 115 * 60_000).toISOString(),
            fullText: '49ers RG Dominick Puni suffered an ankle injury in the third quarter and will not return.'
          },
          // Post-game recap article + social link-card promo pointing to the SAME canonical URL (must dedupe to 1 source, not 2!)
          {
            id: 'wz_green_art',
            type: 'article',
            outletId: '49ers_webzone',
            author: 'David Bonilla',
            trustTier: 2,
            url: 'https://www.49erswebzone.com/articles/199999-shanahan-injury-update/',
            publishedAt: new Date(wk10EndMs + 30 * 60_000).toISOString(),
            title: 'Kyle Shanahan provides postgame injury update',
            playerSnippets: {
              '4427325': "Kyle Shanahan said [CB] Renardo Green left with a back injury in the second half and didn't return."
            }
          },
          {
            id: 'wz_green_promo_tweet',
            type: 'tweet',
            outletId: '49ers_webzone',
            author: '49ers Webzone',
            trustTier: 2,
            url: 'https://x.com/49erswebzone/status/199999',
            externalUrl: 'https://www.49erswebzone.com/articles/199999-shanahan-injury-update/?utm_source=x',
            externalDescription: "Kyle Shanahan said Renardo Green left with a back injury in the second half and didn't return.",
            publishedAt: new Date(wk10EndMs + 32 * 60_000).toISOString(),
            fullText: 'Kyle Shanahan provides postgame injury update Read:'
          }
        ]
      },
      scheduleMatchup: {
        schedule: [
          { week: 10, completed: true, dateIso: new Date(wk10KoMs).toISOString(), opponent: { abbr: 'DAL', name: 'Dallas Cowboys' } },
          { week: 11, completed: false, dateIso: '2026-11-23T01:15:00Z', opponent: { abbr: 'MIN', name: 'Minnesota Vikings' } }
        ]
      }
    };

    // Verify URL-based canonical deduplication on wz_green_art + wz_green_promo_tweet
    const greenSig = evaluateCorroboratedNewsInjurySignal({
      playerName: 'Renardo Green',
      playerId: '4427325',
      rosterBucket: 'active',
      newsItems: mockAppData.news.rawStream,
      rosterPlayerNames: mockAppData.roster.players.map(p => p.name),
      nowMs: monMorningMs,
      windowStartMs: wk10EndMs,
      lastCompletedGameKickoffMs: wk10KoMs,
      lastCompletedWeek: 10,
      priorWeekInjuryType: 'Back'
    });
    assert.equal(greenSig.corroboratingCount, 1, 'Article + its own promo link-tweet must deduplicate to 1 source');
    assert.equal(greenSig.signalType, 'SUSTAINED_IN_GAME_INJURY');
    assert.equal(greenSig.inferredInjuryType, 'Back');
    assert.equal(greenSig.exitedWithoutReturn, true);
    assert.ok(greenSig.confidence >= 0.42);

    const didMutate = reconcileRosterAndHealthWithNews(mockAppData, { nowMs: monMorningMs });
    assert.equal(didMutate, true);

    const promotedNames = mockAppData.health.practiceReport.map(r => r.name);
    assert.ok(promotedNames.includes('Renardo Green'), 'Renardo Green must be promoted onto practiceReport');
    assert.ok(promotedNames.includes('Dominick Puni'), 'Previously unlisted Dominick Puni (in-game ankle exit) must be promoted');
    assert.ok(!promotedNames.includes('Deommodore Lenoir'), 'Healthy pregame Questionable starter Lenoir must stay OFF report');
    assert.ok(!promotedNames.includes('Demarcus Robinson'), 'Blue-tent returner Demarcus Robinson must stay OFF report');

    const puniRow = mockAppData.health.practiceReport.find(r => r.name === 'Dominick Puni');
    assert.equal(puniRow.injuryType, 'Ankle');
    assert.equal(puniRow.sustainedInLastGame, true);

    // 3. Verify Official Wednesday 49ers.com Report Supersession: once `_hasLiveOfficialCurrentWeekSfReport = true`
    //    and a player is omitted as a full participant, Sunday's exit note does NOT re-promote them!
    mockAppData.health._hasLiveOfficialCurrentWeekSfReport = true;
    for (const p of mockAppData.roster.players) {
      p.health.isOnPracticeReport = false;
      p.health.status = 'Active';
      p.health.injuryType = '';
    }
    mockAppData.health.practiceReport = [];
    reconcileRosterAndHealthWithNews(mockAppData, { nowMs: Date.parse('2026-11-18T23:30:00Z') });
    assert.equal(
      mockAppData.health.practiceReport.length,
      0,
      'Once official Wednesday 49ers.com report publishes omitting players, Sunday exit notes must not re-promote them'
    );

    // 4. Verify `resolveEarlyWeekRolloverInput` teammate clause isolation & surgery/IR-candidate Doubtful detection
    const avgRoll = resolveEarlyWeekRolloverInput({
      playerName: 'Andrew Van Ginkel',
      rawStatus: 'Questionable',
      injuryType: 'Concussion',
      shortComment: "Van Ginkel exited Sunday's loss to the Ravens with a concussion, while fellow LB Blake Cashman (concussion) is inactive.",
      longComment: '',
      upcomingWeek: 11,
      lastCompletedWeek: 10,
      playedInCompletedGame: true
    });
    assert.equal(avgRoll.skip, false);
    assert.equal(avgRoll.missedPriorGame, false, 'Teammate Blake Cashman "is inactive" must NOT bleed into Van Ginkel missedPriorGame');
    assert.equal(avgRoll.sustainedInLastGame, true);
    assert.equal(avgRoll.exitedWithoutReturn, true);

    const addisonRoll = resolveEarlyWeekRolloverInput({
      playerName: 'Jordan Addison',
      rawStatus: 'Questionable',
      injuryType: 'Foot',
      shortComment: 'Addison suffered a foot injury Sunday that requires surgery and makes him a candidate for injured reserve.',
      longComment: '',
      upcomingWeek: 11,
      lastCompletedWeek: 10,
      playedInCompletedGame: true
    });
    assert.equal(addisonRoll.skip, false);
    assert.equal(addisonRoll.effectiveStatus, 'Doubtful', 'Requires surgery / IR candidate must downgrade early-week status to Doubtful');

    const lenoirRoll = resolveEarlyWeekRolloverInput({
      playerName: 'Deommodore Lenoir',
      rawStatus: 'Active',
      injuryType: 'Foot',
      shortComment: "Lenoir (foot) is active for Sunday's game against the Cowboys.",
      longComment: '',
      upcomingWeek: 11,
      lastCompletedWeek: 10,
      playedInCompletedGame: true,
      hasPostKickoffInjurySignal: false
    });
    assert.equal(lenoirRoll.skip, true, 'Starter who suited up and finished unscathed with stale pregame active note must skip');
  }
);

await testAsync(
  'Player Dossier renames "Health & Priors" -> "Health", places Health immediately right of Overview, and surfaces full list of tweets, videos & articles on Health tab',
  async () => {
    const { renderPlayerDossierSheetHtml } = await import('../src/views/playerSheetView.js');

    const liveBundle = {
      meta: JSON.parse(fs.readFileSync(path.join(rootDir, 'data', 'meta.json'), 'utf8')),
      roster: JSON.parse(fs.readFileSync(path.join(rootDir, 'data', 'roster.json'), 'utf8')),
      news: JSON.parse(fs.readFileSync(path.join(rootDir, 'data', 'news.json'), 'utf8')),
      health: JSON.parse(fs.readFileSync(path.join(rootDir, 'data', 'health.json'), 'utf8')),
      scheduleMatchup: JSON.parse(fs.readFileSync(path.join(rootDir, 'data', 'schedule-matchup.json'), 'utf8'))
    };

    const green = liveBundle.roster.players.find(p => p.name === 'Renardo Green');
    assert.ok(green, 'Renardo Green must exist in live roster');

    // Inject a standalone health video (`type: 'video'`) alongside live tweets, video-tweets, and articles
    const streamWithMedicalVid = [
      {
        id: 'yt_green_medical_breakdown',
        type: 'video',
        videoId: 'dQw4w9WgXcQ',
        embeddable: true,
        duration: '4:12',
        author: '49ers Medical Breakdown',
        outletName: 'YouTube',
        publishedAt: new Date().toISOString(),
        url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
        title: 'Kyle Shanahan gives Renardo Green back injury update ahead of Week 11',
        summary: 'Detailed breakdown of Renardo Green back injury exit and day-to-day timeline.',
        mentionedPlayers: [{ id: green.id, name: 'Renardo Green' }]
      },
      ...liveBundle.news.rawStream
    ];

    const greenHealthHtml = renderPlayerDossierSheetHtml({
      player: green,
      activeTab: 'health',
      rawStream: streamWithMedicalVid,
      appData: liveBundle
    });

    // 1 & 2: Tab order & naming ("Overview" -> "Health" -> "Stats" -> "Spider Chart" -> "Contract")
    assert.ok(!greenHealthHtml.includes('Health &amp; Priors') && !greenHealthHtml.includes('Health & Priors'));
    assert.ok(!greenHealthHtml.includes('Stats &amp; EPA') && !greenHealthHtml.includes('Stats & EPA'));
    assert.ok(!greenHealthHtml.includes('Contract &amp; Cap') && !greenHealthHtml.includes('Contract & Cap'));
    const tabMatches = [...greenHealthHtml.matchAll(/data-player-tab="([^"]+)"[\s\S]*?<span>([^<]+)<\/span>/g)];
    assert.deepEqual(
      tabMatches.map(m => [m[1], m[2]]),
      [
        ['overview', 'Overview'],
        ['health', 'Health'],
        ['stats', 'Stats'],
        ['spider', 'Spider Chart'],
        ['contract', 'Contract']
      ],
      'Dossier tabs must be ordered Overview -> Health -> Stats -> Spider Chart -> Contract'
    );

    // 3: Full uncapped list of tweets, videos, and articles on Renardo Green's Health tab
    const cardTypes = [...greenHealthHtml.matchAll(/data-mention-type="([^"]+)"/g)].map(m => m[1]);
    assert.ok(cardTypes.length >= 7, `Expected full list (>=7) of health items for Renardo Green, got ${cardTypes.length}`);
    assert.ok(cardTypes.includes('tweet'), 'Renardo Green Health tab must include health tweets');
    assert.ok(cardTypes.includes('article'), 'Renardo Green Health tab must include health articles');
    assert.ok(cardTypes.includes('video'), 'Renardo Green Health tab must include health videos');
    assert.ok(
      greenHealthHtml.includes('data-action="play-inline-video"'),
      'Health tab video items must render playable inline video facade'
    );

    // Even if a player is currently marked Active (`isOnPracticeReport: false`, e.g. Deommodore Lenoir or unpromoted state),
    // any genuine health tweets/videos/articles about them MUST still appear on their Health tab!
    const unflaggedGreen = {
      ...green,
      health: { ...green.health, status: 'Active', injuryType: '', isOnPracticeReport: false }
    };
    const unflaggedGreenHtml = renderPlayerDossierSheetHtml({
      player: unflaggedGreen,
      activeTab: 'health',
      rawStream: liveBundle.news.rawStream,
      appData: liveBundle
    });
    assert.ok(
      unflaggedGreenHtml.includes('data-player-injury-news') &&
        [...unflaggedGreenHtml.matchAll(/data-mention-type="/g)].length >= 6,
      'Active player with genuine health tweets/videos/articles must still display full Injury News list on Health tab'
    );

    // Healthy player with zero genuine health news (Brock Purdy) still omits Injury News clutter
    const purdy = liveBundle.roster.players.find(p => p.name === 'Brock Purdy');
    const purdyHealthHtml = renderPlayerDossierSheetHtml({
      player: purdy,
      activeTab: 'health',
      rawStream: liveBundle.news.rawStream,
      appData: liveBundle
    });
    assert.ok(
      !purdyHealthHtml.includes('data-player-injury-news'),
      'Healthy player with zero health items (Brock Purdy) must not render empty/false-positive Injury News card'
    );
  }
);

await testAsync(
  'AI Matchup Intel prompt grounds full opponent depth-chart hierarchy & 2026 stats (preventing 5 OL + 1 QB from hiding WR1 Justin Jefferson behind injured depth WRs)',
  async () => {
    const { buildDailyMatchupIntelPrompt } = await import('../src/services/aiWorkerClient.js');
    const liveBundle = {
      meta: JSON.parse(fs.readFileSync(path.join(rootDir, 'data', 'meta.json'), 'utf8')),
      roster: JSON.parse(fs.readFileSync(path.join(rootDir, 'data', 'roster.json'), 'utf8')),
      health: JSON.parse(fs.readFileSync(path.join(rootDir, 'data', 'health.json'), 'utf8')),
      scheduleMatchup: JSON.parse(fs.readFileSync(path.join(rootDir, 'data', 'schedule-matchup.json'), 'utf8'))
    };

    const oh = liveBundle.scheduleMatchup.upcomingMatchup.opponentHealth;
    // Healthy starters must NOT be truncated to 12 (where 5 OL + 1 QB could squeeze out WR1/RB1)
    assert.ok(
      Array.isArray(oh.keyStartersHealthy) && oh.keyStartersHealthy.length >= 13,
      `Expected full healthy starter set (>=13) on opponentHealth.keyStartersHealthy, got ${oh.keyStartersHealthy?.length}`
    );

    const prompt = buildDailyMatchupIntelPrompt(liveBundle);
    assert.ok(
      prompt.includes('Depth-Chart Hierarchy & 2026 Production'),
      'Matchup prompt must inject explicit Opponent Depth-Chart Hierarchy & 2026 Production section'
    );
    assert.ok(
      prompt.includes('OPPONENT DEPTH-CHART ACCURACY'),
      'Matchup prompt must enforce WR1/RB1/QB1 hierarchy accuracy guardrail'
    );
    if (liveBundle.scheduleMatchup.upcomingMatchup.oppAbbr === 'MIN') {
      const wrLine = prompt.split('\n').find(l => l.includes('WRs (ordered WR1 -> depth):')) || '';
      assert.ok(
        wrLine.includes('WR1 Justin Jefferson') && wrLine.includes('Active'),
        `MIN WR hierarchy line must lead with Active WR1 Justin Jefferson + stats: ${wrLine}`
      );
      assert.ok(
        wrLine.indexOf('Justin Jefferson') < wrLine.indexOf('Jauan Jennings'),
        `Justin Jefferson must rank ahead of Jauan Jennings in MIN WR hierarchy: ${wrLine}`
      );
    }
  }
);

await testAsync(
  'QA Scrub — Bye/TBD game-window guards, offseason 90d video retention, short-week Wed/Fri practice slots & 0m post-whistle / seasonConcluded IR rules',
  async () => {
    const {
      resolveGameNewsContext,
      is49ersGameLiveWindow,
      resolveNewsBriefCycleState,
      isStalePriorGameVideo,
      filterFreshVideosForCurrentSlate
    } = await import('../src/engine/breakingClassifier.js');
    const {
      getPracticeReportLeadDays,
      resolvePracticeSlotFromReportTiming,
      evaluateWeeklyIrActivationWindow,
      computePlayerPlayProbability
    } = await import('../src/engine/injuryProbabilityModel.js');
    const { isBeforeWeeklyPracticeWindow } = await import('../src/engine/gameDayRosterEngine.js');

    // 1. Bye week & TBD postseason placeholder games never trigger false `inGame` or `isGameDayHold`
    const byeKoMs = Date.parse('2026-11-01T20:05:00Z');
    const byeAppData = {
      scheduleMatchup: {
        schedule: [
          { week: 7, dateIso: '2026-10-25T20:25:00Z', completed: true, opponent: { abbr: 'KC', name: 'Kansas City Chiefs' } },
          { week: 8, dateIso: '2026-11-01T20:05:00Z', completed: false, isByeWeek: true, opponent: { abbr: 'BYE', name: 'Bye Week' } },
          { week: 20, seasonType: 'POST', dateIso: '2027-01-24T20:00:00Z', completed: false, opponent: { abbr: 'TBD', name: 'Opponent TBD', isTbd: true } }
        ],
        upcomingMatchup: {
          week: 20,
          dateIso: '2027-01-24T20:00:00Z',
          oppAbbr: 'TBD',
          isTbd: true,
          completed: false
        }
      }
    };
    assert.equal(resolveGameNewsContext(byeAppData, byeKoMs + 30 * 60_000).inGame, false, 'Bye week must never trigger inGame');
    assert.equal(is49ersGameLiveWindow(byeAppData, byeKoMs + 30 * 60_000), false, 'Bye week must never trigger 20s game window');
    const tbdMs = Date.parse('2027-01-24T20:30:00Z');
    assert.equal(resolveGameNewsContext(byeAppData, tbdMs).inGame, false, 'TBD playoff slot must never trigger inGame');
    assert.equal(is49ersGameLiveWindow(byeAppData, tbdMs), false, 'TBD playoff slot must never trigger 20s game window');
    assert.equal(resolveNewsBriefCycleState(tbdMs, byeAppData, 17).isGameDayHold, false, 'TBD playoff slot must not hold daily brief');

    // 2. Offseason (`seasonConcluded` / >21d post-game) retains videos up to 90d & rescues Film & Trench clips
    const offseasonNowMs = Date.parse('2027-03-15T18:00:00Z');
    const offseasonAppData = {
      scheduleMatchup: {
        schedule: [{ week: 18, dateIso: '2027-01-03T21:25:00Z', completed: true, opponent: { abbr: 'SEA', name: 'Seattle Seahawks' } }],
        upcomingMatchup: { week: 18, dateIso: '2027-01-03T21:25:00Z', oppAbbr: 'SEA', completed: true, seasonConcluded: true }
      }
    };
    const fortyDayDraftVid = {
      id: 'offseason_vid_1',
      type: 'video',
      videoId: 'abc12345678',
      category: 'film',
      title: '49ers 2027 Combine & All-22 Trench Film Breakdown',
      publishedAt: new Date(offseasonNowMs - 40 * 86_400_000).toISOString()
    };
    assert.equal(
      isStalePriorGameVideo(fortyDayDraftVid, offseasonAppData, offseasonNowMs),
      false,
      'Offseason must retain 40-day-old film/Combine video instead of wiping at >16d'
    );
    const inSeasonAppData = {
      scheduleMatchup: {
        schedule: [
          { week: 10, dateIso: '2026-11-15T21:05:00Z', completed: true, opponent: { abbr: 'DAL', name: 'Dallas Cowboys' } },
          { week: 11, dateIso: '2026-11-22T18:00:00Z', completed: false, opponent: { abbr: 'MIN', name: 'Minnesota Vikings' } }
        ],
        upcomingMatchup: { week: 11, dateIso: '2026-11-22T18:00:00Z', oppAbbr: 'MIN', completed: false }
      }
    };
    const inSeasonNow = Date.parse('2026-11-18T18:00:00Z');
    const rescuePool = [
      {
        id: 'older_film_1',
        type: 'video',
        videoId: 'qbSchool111',
        category: 'film',
        title: 'Brock Purdy All-22 Anticipation Throws',
        publishedAt: new Date(inSeasonNow - 12 * 86_400_000).toISOString()
      }
    ];
    const rescued = filterFreshVideosForCurrentSlate(rescuePool, inSeasonAppData, inSeasonNow);
    assert.equal(rescued.length, 1, 'Film & Trench safety floor must rescue recent <=45d film clip when 0 film videos survived');

    // 3. Short-week Wednesday (Christmas, lead=2) & Friday (Black Friday, lead=3) practice windows
    assert.equal(getPracticeReportLeadDays('Wed'), 2);
    assert.equal(getPracticeReportLeadDays('Thu'), 3);
    assert.equal(getPracticeReportLeadDays('Fri'), 3);
    assert.equal(getPracticeReportLeadDays('Sat'), 4);
    assert.equal(getPracticeReportLeadDays('Sun'), 4);
    assert.equal(getPracticeReportLeadDays('Mon'), 4);

    const blackFridayKo = '2026-11-27T20:00:00Z'; // Friday
    assert.equal(
      isBeforeWeeklyPracticeWindow(blackFridayKo, Date.parse('2026-11-24T18:00:00Z')), // Tue 10:00 AM PT (< 12:15 PM PT)
      true
    );
    assert.equal(
      isBeforeWeeklyPracticeWindow(blackFridayKo, Date.parse('2026-11-24T21:00:00Z')), // Tue 1:00 PM PT (>= 12:15 PM PT)
      false
    );
    assert.equal(
      resolvePracticeSlotFromReportTiming({
        text: 'Trent Williams practiced in full Tuesday ahead of Friday.',
        kickoffIso: blackFridayKo,
        seasonYear: 2026
      }),
      'wed'
    );
    assert.equal(
      resolvePracticeSlotFromReportTiming({
        text: 'Fred Warner was a full participant Thursday.',
        kickoffIso: blackFridayKo,
        seasonYear: 2026
      }),
      'fri'
    );
    const christmasWedKo = '2026-12-23T21:30:00Z'; // Wednesday
    assert.equal(
      resolvePracticeSlotFromReportTiming({
        text: 'Brock Purdy was a full participant Monday.',
        kickoffIso: christmasWedKo,
        seasonYear: 2026
      }),
      'wed'
    );

    // 4. Instant 0m post-whistle (`completed === true`) IR 21-day rollover & `seasonConcluded` 0% • IR hold
    const sunKoIso = '2026-11-15T21:25:00Z';
    const nextSunKoIso = '2026-11-22T18:00:00Z';
    const zeroMinPostWhistleMs = Date.parse('2026-11-16T00:35:00Z'); // Only 3h10m post-kickoff (< 5.25h), but game is Final!
    const irWinPostWhistle = evaluateWeeklyIrActivationWindow({
      kickoffIso: sunKoIso,
      designatedDateIso: '2026-11-04T19:00:00Z',
      nowMs: zeroMinPostWhistleMs,
      schedule: [
        { week: 10, dateIso: sunKoIso, completed: true, opponent: { abbr: 'DAL' } },
        { week: 11, dateIso: nextSunKoIso, completed: false, opponent: { abbr: 'MIN' } }
      ]
    });
    assert.equal(
      irWinPostWhistle.hasMissedWeeklyDeadline,
      false,
      'Completed game at 0m post-whistle must immediately advance IR window to Week N+1 without waiting 5.25h'
    );
    assert.equal(irWinPostWhistle.kickoffMs, Date.parse(nextSunKoIso));

    const irProbSeasonOver = computePlayerPlayProbability({
      name: 'Jacob Cowing',
      position: 'WR',
      rosterBucket: 'ir',
      gameStatus: 'IR — 21-Day Window Open',
      isPracticeWindowOpen: true,
      designatedDateIso: '2026-12-28T19:00:00Z',
      kickoffIso: '2027-01-03T21:25:00Z',
      nowMs: Date.parse('2027-01-05T18:00:00Z'),
      schedule: [{ week: 18, dateIso: '2027-01-03T21:25:00Z', completed: true, opponent: { abbr: 'SEA' } }],
      seasonConcluded: true
    });
    assert.equal(irProbSeasonOver.probabilityPct, 0, 'Unactivated IR player must revert to 0% • IR once seasonConcluded is true');
    assert.equal(irProbSeasonOver.badgeLabel, '0% • IR');
  }
);

await testAsync(
  'QA Scrub — Per-team 277KB ESPN injury hydration, LIVE/FINAL Matchup scoreboards, season-concluded Matchup AI guard, Worker HTTP Range 206 + HEAD & <75ms reconcile latency',
  async () => {
    const { hydrateLiveEspnOverlay } = await import('../src/services/dataService.js');
    const { refreshDailyMatchupIntelIfDue } = await import('../src/services/aiWorkerClient.js');
    const { renderSeasonMatchupViewHtml } = await import('../src/views/seasonMatchupView.js');
    const { renderHomeDashboardHtml } = await import('../src/views/homeView.js');
    const { resolveHomeDashboardState } = await import('../src/engine/seasonStateMachine.js');
    const { reconcileRosterAndHealthWithNews } = await import('../src/engine/injuryProbabilityModel.js');
    const edgeWorker = (await import('../worker/index.js')).default;

    // 1. Latency gate on full production bundle (`reconcileRosterAndHealthWithNews` < 75ms)
    const prodBundle = {
      meta: JSON.parse(fs.readFileSync(path.join(rootDir, 'data', 'meta.json'), 'utf8')),
      roster: JSON.parse(fs.readFileSync(path.join(rootDir, 'data', 'roster.json'), 'utf8')),
      depthChart: JSON.parse(fs.readFileSync(path.join(rootDir, 'data', 'depth-chart.json'), 'utf8')),
      health: JSON.parse(fs.readFileSync(path.join(rootDir, 'data', 'health.json'), 'utf8')),
      news: JSON.parse(fs.readFileSync(path.join(rootDir, 'data', 'news.json'), 'utf8')),
      scheduleMatchup: JSON.parse(fs.readFileSync(path.join(rootDir, 'data', 'schedule-matchup.json'), 'utf8')),
      seasonal: JSON.parse(fs.readFileSync(path.join(rootDir, 'data', 'seasonal.json'), 'utf8'))
    };
    reconcileRosterAndHealthWithNews(prodBundle); // warm cache
    const t0 = performance.now();
    reconcileRosterAndHealthWithNews(prodBundle);
    const elapsedMs = performance.now() - t0;
    assert.ok(
      elapsedMs < 75,
      `reconcileRosterAndHealthWithNews must execute in <75ms on full 88-player bundle, took ${elapsedMs.toFixed(2)}ms`
    );

    // 2. Per-team ESPN `injuries?team=25` + `?team=min` query & live/seasonConcluded scoreboard sync
    const requestedUrls = [];
    const origFetch = globalThis.fetch;
    try {
      globalThis.fetch = async url => {
        const u = String(url);
        requestedUrls.push(u);
        if (u.includes('/teams/sf/schedule')) {
          return new Response(
            JSON.stringify({
              events: [
                {
                  id: '401800018',
                  date: '2027-01-03T21:25:00Z',
                  seasonType: { id: 2, type: 2 },
                  week: { number: 18 },
                  competitions: [
                    {
                      competitors: [
                        { team: { abbreviation: 'SF', displayName: 'San Francisco 49ers' }, homeAway: 'home', score: { value: 27 } },
                        { team: { abbreviation: 'SEA', displayName: 'Seattle Seahawks' }, homeAway: 'away', score: { value: 20 } }
                      ],
                      status: { type: { completed: true, state: 'post', shortDetail: 'Final' } }
                    }
                  ]
                }
              ]
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } }
          );
        }
        if (u.includes('injuries?team=25')) {
          return new Response(
            JSON.stringify({
              team: { id: '25', abbreviation: 'SF', displayName: 'San Francisco 49ers' },
              injuries: []
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } }
          );
        }
        return new Response(JSON.stringify({}), { status: 200, headers: { 'Content-Type': 'application/json' } });
      };

      const eliminatedApp = {
        meta: { seasonYear: 2026, currentWeek: 18, teamRecord: '7-10', teamStatus: { mathematicallyEliminated: true } },
        roster: { players: [] },
        health: { week: 18, practiceReport: [], irAndReserveTracker: [] },
        news: { rawStream: [], clusteredBriefs: [] },
        seasonal: { playoffPicture: { baselineSimulation: { sfOdds: { makePlayoffsPct: 0, winDivisionPct: 0, seed1ByePct: 0 } } } },
        scheduleMatchup: {
          schedule: Array.from({ length: 17 }, (_, idx) => ({
            id: idx === 16 ? '401800018' : `g_${idx + 1}`,
            seasonType: 'REG',
            week: idx >= 7 ? idx + 2 : idx + 1,
            dateIso: idx === 16 ? '2027-01-03T21:25:00Z' : '2026-10-01T20:00:00Z',
            completed: idx < 16,
            result: idx < 7 ? 'W' : idx < 16 ? 'L' : null,
            homeAway: 'home',
            opponent: { abbr: idx === 16 ? 'SEA' : 'ARI', name: idx === 16 ? 'Seattle Seahawks' : 'Arizona Cardinals' }
          })),
          upcomingMatchup: {
            week: 18,
            gameId: '401800018',
            homeAway: 'home',
            oppAbbr: 'SEA',
            oppName: 'Seattle Seahawks',
            kickoffDisplay: 'Sun, Jan 3',
            opponentHealth: { injuryReport: [], irReserve: [], keyStartersHealthy: [] },
            betting: { spread: 'SF -3.5', overUnder: 45.5, impliedScore: 'SF 24.5 – SEA 21.0' }
          }
        }
      };

      await hydrateLiveEspnOverlay(eliminatedApp);
      assert.ok(
        requestedUrls.some(u => u.includes('/nfl/injuries?team=25')) &&
          !requestedUrls.some(u => /\/nfl\/injuries$/.test(u)),
        'hydrateLiveEspnOverlay must query per-team injuries?team=25 instead of the 8.76MB league-wide /nfl/injuries endpoint'
      );
      const umAfter = eliminatedApp.scheduleMatchup.upcomingMatchup;
      assert.equal(umAfter.completed, true);
      assert.equal(umAfter.seasonConcluded, true);
      assert.equal(umAfter.sfScore, 27);
      assert.equal(umAfter.oppScore, 20);

      const matchupHtml = renderSeasonMatchupViewHtml({
        subTab: 'matchup',
        appData: eliminatedApp,
        userPrefs: {}
      });
      assert.ok(matchupHtml.includes('FINAL • 20–27'), 'Matchup scoreboard must render FINAL • Away–Home score pill');
      assert.ok(matchupHtml.includes('Season Complete'), 'Matchup eyebrow must indicate Season Complete');

      const { orderedBlocks } = resolveHomeDashboardState({});
      const homeHtml = renderHomeDashboardHtml({
        orderedBlocks,
        appData: eliminatedApp,
        userPrefs: {}
      });
      assert.ok(homeHtml.includes('FINAL • 20–27'), 'Home scoreboard must render FINAL • Away–Home score pill');

      // refreshDailyMatchupIntelIfDue must refuse to burn Gemini credits when seasonConcluded or TBD
      const skippedSeasonOver = await refreshDailyMatchupIntelIfDue({
        appData: eliminatedApp,
        prefs: { geminiApiKey: 'AIzaTestKey123' }
      });
      assert.equal(skippedSeasonOver.updated, false);
      assert.equal(skippedSeasonOver.reason, 'no_active_matchup');

      // 3. Edge Worker `/api/audio/:episodeId` HTTP Range `206` + `416` + `HEAD` & `/api/video-stream` redirect guard
      const sampleWav = new Uint8Array(256);
      sampleWav.set([0x52, 0x49, 0x46, 0x46], 0); // "RIFF"
      for (let i = 4; i < 256; i++) sampleWav[i] = i & 0xff;
      const workerEnv = {
        ALLOWED_ORIGIN: '*',
        PODCAST_BUCKET: {
          async get(key) {
            if (key !== 'episodes/ep_range_test.wav') return null;
            return { body: sampleWav, size: sampleWav.byteLength, httpMetadata: { contentType: 'audio/wav' } };
          }
        }
      };

      const headRes = await edgeWorker.fetch(
        new Request('https://worker.example/api/audio/ep_range_test', { method: 'HEAD' }),
        workerEnv
      );
      assert.equal(headRes.status, 200);
      assert.equal(headRes.headers.get('Content-Length'), '256');
      assert.equal((await headRes.arrayBuffer()).byteLength, 0);

      const rangeRes = await edgeWorker.fetch(
        new Request('https://worker.example/api/audio/ep_range_test', {
          headers: { Range: 'bytes=0-43' }
        }),
        workerEnv
      );
      assert.equal(rangeRes.status, 206, 'Byte-range GET must return 206 Partial Content for iOS Safari scrubbing');
      assert.equal(rangeRes.headers.get('Content-Range'), 'bytes 0-43/256');
      assert.equal(rangeRes.headers.get('Content-Length'), '44');
      const rangeBuf = new Uint8Array(await rangeRes.arrayBuffer());
      assert.equal(rangeBuf.byteLength, 44);
      assert.equal(Buffer.from(rangeBuf.subarray(0, 4)).toString('ascii'), 'RIFF');

      const badRangeRes = await edgeWorker.fetch(
        new Request('https://worker.example/api/audio/ep_range_test', {
          headers: { Range: 'bytes=500-600' }
        }),
        workerEnv
      );
      assert.equal(badRangeRes.status, 416);
      assert.equal(badRangeRes.headers.get('Content-Range'), 'bytes */256');

      globalThis.fetch = async () => {
        const redirected = new Response(new Uint8Array([1, 2, 3]), { status: 200 });
        Object.defineProperty(redirected, 'url', { value: 'https://evil.example.com/payload.mp4' });
        return redirected;
      };
      const redirectBlockedRes = await edgeWorker.fetch(
        new Request(
          'https://worker.example/api/video-stream?url=' +
            encodeURIComponent('https://video.twimg.com/ext_tw_video/123/pu/vid/avc1/1280x720/clip.mp4')
        ),
        workerEnv
      );
      assert.equal(redirectBlockedRes.status, 403, '/api/video-stream must reject off-allowlist upstream redirects');
    } finally {
      globalThis.fetch = origFetch;
    }
  }
);

await testAsync(
  'Ambiguous surname guard ("4-6 Weeks" != Jon Weeks, "Joey Bosa" != Nick Bosa), historical 49ers bio relevance filter & unambiguous aggregator publisher display',
  async () => {
    const {
      AMBIGUOUS_PLAYER_SURNAMES,
      formatWireSourceDisplayName,
      is49ersRelevantWireItem,
      stripAggregatorBoilerplate,
      stripHistoricalSfBioSentences
    } = await import('../src/engine/linkIntegrity.js');
    const { matchPlayersClient } = await import('../src/services/dataService.js');
    const { doesClauseMentionPlayer } = await import('../src/engine/injuryProbabilityModel.js');
    const { parseTopicIntent } = await import('../src/engine/deepResearchEngine.js');
    const { classifyNewsItemCategory } = await import('../src/engine/breakingClassifier.js');

    assert.ok(AMBIGUOUS_PLAYER_SURNAMES.has('weeks'), '"weeks" must be in AMBIGUOUS_PLAYER_SURNAMES');

    const rosterJson = JSON.parse(fs.readFileSync(path.join(rootDir, 'data', 'roster.json'), 'utf8'));
    const newsJson = JSON.parse(fs.readFileSync(path.join(rootDir, 'data', 'news.json'), 'utf8'));
    const players = rosterJson.players || [];

    // 1. "4-6 Weeks", "through ten weeks", "in recent weeks" must NEVER match Jon Weeks
    const ramsHeadline = 'Rams C Coleman Shelton Expected To Miss 4-6 Weeks With Hamstring Injury';
    const ramsBioDesc =
      'Rams C Coleman Shelton is expected to miss four to six weeks after suffering a hamstring injury in the team’s Week 10 win over the Cardinals, per PFT. Shelton, 31, originally signed on with the 49ers as an undrafted free agent out of Washington back in 2018. He was cut coming out of the preseason […] The post Rams C Coleman Shelton Expected To Miss 4-6 Weeks With Hamstring Injury appeared first on NFLTradeRumors.co.';

    assert.equal(
      matchPlayersClient(ramsHeadline, players, 12, { allowUniqueSurnames: true }).some(p => p.name === 'Jon Weeks'),
      false,
      '"4-6 Weeks" must NEVER match 49ers LS Jon Weeks'
    );
    assert.equal(
      matchPlayersClient('The NFC playoff picture is set through ten weeks.', players, 12).some(p => p.name === 'Jon Weeks'),
      false,
      '"ten weeks" must NEVER match Jon Weeks'
    );
    assert.equal(
      doesClauseMentionPlayer(ramsHeadline, 'Jon Weeks', { allowSurname: true }),
      false,
      'Injury clause matcher must reject "4-6 Weeks" for Jon Weeks'
    );
    assert.equal(
      parseTopicIntent('Expected to miss 4-6 weeks with hamstring injury', { roster: rosterJson })
        .explicitlyNamedPlayers.some(p => p.name === 'Jon Weeks'),
      false,
      'Deep Research intent parser must not match "4-6 weeks" as Jon Weeks'
    );

    // Legitimate full-name and position-prefixed Jon Weeks references MUST still match
    assert.ok(
      matchPlayersClient('2/3 Jon Weeks 10, Jordan James 8, Fred Warner 7', players, 12).some(p => p.name === 'Jon Weeks'),
      'Full name "Jon Weeks" must still match'
    );
    assert.ok(
      matchPlayersClient('49ers LS Weeks signed a one-year contract extension.', players, 12).some(p => p.name === 'Jon Weeks'),
      'Position-compatible "LS Weeks" must still match Jon Weeks'
    );
    assert.equal(
      matchPlayersClient('WR Weeks caught two touchdowns', players, 12).some(p => p.name === 'Jon Weeks'),
      false,
      'Incompatible position prefix "WR Weeks" must not match LS Jon Weeks'
    );

    // Conflicting first-name guard ("Joey Bosa" != Nick Bosa, "Kurt Warner" != Fred Warner)
    assert.equal(
      matchPlayersClient('Bills pass rusher Joey Bosa recorded two sacks.', players, 12).some(p => p.name === 'Nick Bosa'),
      false,
      '"Joey Bosa" must not match Nick Bosa'
    );
    assert.equal(
      matchPlayersClient('Hall of Famer Kurt Warner broke down Brock Purdy tape.', players, 12).some(p => p.name === 'Fred Warner'),
      false,
      '"Kurt Warner" must not match Fred Warner'
    );

    // 2. Boilerplate & historical 49ers career-bio stripping + strict national wire relevance
    const strippedFooter = stripAggregatorBoilerplate(ramsBioDesc);
    assert.ok(!/appeared first on NFLTradeRumors\.co/i.test(strippedFooter), 'WordPress aggregator footer must be stripped');
    const strippedBio = stripHistoricalSfBioSentences(ramsBioDesc);
    assert.ok(!/\b49ers\b/i.test(strippedBio), '2018 historical 49ers UDFA bio sentence must be stripped');

    assert.equal(
      is49ersRelevantWireItem({
        title: ramsHeadline,
        fullText: ramsHeadline,
        externalTitle: ramsHeadline,
        externalDescription: ramsBioDesc,
        isNationalFeed: true,
        leadRosterMatchCount: 0,
        bodyRosterMatchCount: 0
      }),
      false,
      'Rams Coleman Shelton injury with only a 2018 49ers UDFA bio mention must be rejected'
    );
    assert.equal(
      is49ersRelevantWireItem({
        title: 'Former 49ers QB Trey Lance traded to Giants',
        fullText: 'Former 49ers QB Trey Lance traded to Giants',
        isNationalFeed: true,
        leadRosterMatchCount: 0,
        bodyRosterMatchCount: 0
      }),
      false,
      'Other-team headline mentioning only "Former 49ers" must be rejected'
    );
    assert.equal(
      is49ersRelevantWireItem({
        title: 'NFC Notes: Brock Purdy, Aaron Donald, 49ers, Rams, Seahawks',
        fullText: 'NFC Notes: Brock Purdy, Aaron Donald, 49ers, Rams, Seahawks',
        isNationalFeed: true,
        leadRosterMatchCount: 1,
        bodyRosterMatchCount: 0
      }),
      true,
      'Multi-team NFC Notes explicitly featuring 49ers & Brock Purdy must pass'
    );
    assert.equal(
      is49ersRelevantWireItem({
        title: "Seahawks HC Mike Macdonald said today that Sam Darnold is on track to play next week against the 49ers following Seattle's bye.",
        fullText: "Seahawks HC Mike Macdonald said today that Sam Darnold is on track to play next week against the 49ers following Seattle's bye.",
        isNationalFeed: true,
        leadRosterMatchCount: 0,
        bodyRosterMatchCount: 0
      }),
      true,
      'Upcoming opponent QB availability explicitly naming "against the 49ers" must pass'
    );

    // 3. Publisher display disambiguation & injury-vs-trade categorization
    assert.equal(formatWireSourceDisplayName('NFL Trade Rumors'), 'NFLTradeRumors.co');
    assert.equal(formatWireSourceDisplayName('Pro Football Rumors'), 'ProFootballRumors.com');
    assert.equal(formatWireSourceDisplayName('Matt Maiocco'), 'Matt Maiocco');
    assert.equal(
      classifyNewsItemCategory({
        type: 'article',
        title: '49ers C Jake Brendel Expected To Miss 4-6 Weeks With Hamstring Injury',
        summary: strippedBio,
        outletName: 'NFL Trade Rumors'
      }),
      'injury',
      'Injury report from NFLTradeRumors.co must classify as injury, never roster/trade'
    );

    // 4. Compiled data/news.json must have zero false-positive Jon Weeks tags
    for (const it of newsJson.rawStream || []) {
      const hasJonWeeksChip = (it.mentionedPlayers || []).some(p => p.name === 'Jon Weeks');
      if (hasJonWeeksChip) {
        const hay = `${it.title || ''} ${it.fullText || ''} ${it.summary || ''} ${it.playerSnippets?.['13729'] || ''}`;
        assert.ok(
          /\b(jon\s+weeks|j\.\s*weeks|ls\s+weeks)\b/i.test(hay),
          `False-positive Jon Weeks chip remained on ${it.id}: ${it.title}`
        );
      }
    }
  }
);

await testAsync(
  'Departed coaches (Titans HC Robert Saleh / future coach departures), departed players, other-team body framing, and NFL surname homonyms never leak into 49ers wire or AI grounding',
  async () => {
    const {
      hasExplicit49ersEntity,
      is49ersRelevantWireItem,
      isOffTopicLeagueFiller,
      stripNon49ersEntityContexts
    } = await import('../src/engine/linkIntegrity.js');
    const { matchPlayersClient } = await import('../src/services/dataService.js');
    const {
      sanitizeHallucinatedRosterText,
      validateNoHallucinatedRosterClaims
    } = await import('../src/engine/groundingValidator.js');
    const { extractPresserTakeaways } = await import('../src/engine/digestExperienceEngine.js');

    const rosterJson = JSON.parse(fs.readFileSync(path.join(rootDir, 'data', 'roster.json'), 'utf8'));
    const players = rosterJson.players || [];

    // 1. Exact ProFootballTalk Titans / Cam Ward / Robert Saleh regression
    const camWardTitle = 'Cam Ward: Shift in offensive philosophy "what we all wanted"';
    const camWardBody =
      "Titans head coach Robert Saleh said earlier this week that the Titans recently shifted their offensive philosophy to put more on quarterback Cam Ward's plate over the rest of the season.";
    assert.equal(hasExplicit49ersEntity(`${camWardTitle} ${camWardBody}`), false, 'Titans HC Robert Saleh must not match as explicit 49ers entity');
    assert.equal(
      is49ersRelevantWireItem({
        title: camWardTitle,
        fullText: camWardTitle,
        externalTitle: camWardTitle,
        externalDescription: camWardBody,
        isNationalFeed: true,
        leadRosterMatchCount: 0,
        bodyRosterMatchCount: 0
      }),
      false,
      'PFT Cam Ward / Titans HC Robert Saleh article must be rejected by national wire relevance filter'
    );
    assert.equal(
      isOffTopicLeagueFiller({
        url: 'https://www.nbcsports.com/nfl/profootballtalk/rumor-mill/news/cam-ward-shift',
        title: camWardTitle,
        summary: camWardBody,
        hasRosterMatch: false
      }),
      true,
      'PFT Cam Ward / Titans HC Robert Saleh article must be classified as off-topic league filler'
    );

    // 2. General future-proof guard: even if a CURRENT 49ers coordinator is attributed to another NFL team
    const futureCoachTitle = 'Caleb Williams excited about new offensive approach';
    const futureCoachBody = 'Bears head coach Klay Kubiak said the Bears are opening up the playbook for Caleb Williams.';
    assert.equal(
      is49ersRelevantWireItem({
        title: futureCoachTitle,
        fullText: futureCoachTitle,
        summary: futureCoachBody,
        isNationalFeed: true,
        leadRosterMatchCount: 0,
        bodyRosterMatchCount: 0
      }),
      false,
      'Other-team staff attribution ("Bears head coach Klay Kubiak") must be stripped and rejected'
    );
    const appositiveCoachBody = "Raheem Morris, the Falcons' head coach, said Atlanta's defense is improving.";
    assert.equal(
      hasExplicit49ersEntity(appositiveCoachBody),
      false,
      'Appositive other-team attribution ("Raheem Morris, the Falcons\' head coach") must be stripped'
    );

    // 3. Departed players & NFL surname homonyms must NOT match active 49ers
    const jenningsTitle = 'Jauan Jennings expected to play Sunday';
    const jenningsBody = 'Patriots wide receiver Jauan Jennings returned to full practice Friday.';
    assert.equal(
      is49ersRelevantWireItem({
        title: jenningsTitle,
        fullText: jenningsTitle,
        summary: jenningsBody,
        isNationalFeed: true,
        leadRosterMatchCount: matchPlayersClient(jenningsTitle, players, 8, { allowUniqueSurnames: false }).length,
        bodyRosterMatchCount: matchPlayersClient(jenningsBody, players, 8, { allowUniqueSurnames: false }).length
      }),
      false,
      'Departed player Jauan Jennings on Patriots must be rejected'
    );
    assert.equal(
      isOffTopicLeagueFiller({
        url: 'https://www.nbcsports.com/nfl/profootballtalk/rumor-mill/news/jauan-jennings',
        title: jenningsTitle,
        summary: jenningsBody,
        hasRosterMatch: false
      }),
      true,
      'Departed player Jauan Jennings must not match hardcoded SF relevance terms'
    );
    assert.equal(
      matchPlayersClient('Patriots safety Kyle Dugger suffered an ankle injury.', players, 12, { allowUniqueSurnames: true }).length,
      0,
      'Kyle Dugger must not match 49ers LB Jaden Dugger'
    );
    assert.equal(
      matchPlayersClient('Saints RB Alvin Kamara logged a limited practice.', players, 12, { allowUniqueSurnames: true }).length,
      0,
      'Alvin Kamara must not match 49ers DE Mikail Kamara'
    );
    assert.equal(
      hasExplicit49ersEntity('Broncos legend Mike Shanahan spoke at the ceremony.'),
      false,
      'Mike Shanahan must not match Kyle Shanahan'
    );
    assert.equal(
      hasExplicit49ersEntity('Raiders OC Klint Kubiak broke down Las Vegas run concepts.'),
      false,
      'Klint Kubiak must not match Klay Kubiak'
    );
    const klintPresser = extractPresserTakeaways(
      [
        {
          id: 'klint_1',
          type: 'article',
          title: 'Raiders OC Klint Kubiak said Las Vegas wants to establish the run on Sunday.',
          url: 'https://www.nbcsports.com/nfl/profootballtalk/rumor-mill/news/klint-kubiak',
          publishedAt: new Date().toISOString()
        }
      ],
      { nowMs: Date.now() }
    );
    assert.equal(klintPresser.length, 0, 'Presser speaker detector must not misattribute Klint Kubiak to Klay Kubiak');

    // 4. Legitimate 49ers stories & hashtags MUST continue to pass
    assert.equal(hasExplicit49ersEntity('Moving on up @SAP | #FTTB'), true, '#FTTB after space/punctuation must match');
    assert.equal(hasExplicit49ersEntity('49ers DC Raheem Morris explains Wide-9 blitz package'), true, '49ers DC Raheem Morris must match');
    assert.equal(
      is49ersRelevantWireItem({
        title: 'Veteran WR draws deadline trade interest',
        summary: 'The 49ers are among three contenders checking in on the veteran receiver.',
        isNationalFeed: true,
        leadRosterMatchCount: 0,
        bodyRosterMatchCount: 0
      }),
      true,
      'League-wide headline with explicit 49ers body relevance must pass'
    );
    assert.ok(
      /Kyle Shanahan/i.test(stripNon49ersEntityContexts("Vikings coach Kevin O'Connell praised Kyle Shanahan's motion sequencing.")),
      'Stripping other-team coach name must preserve subsequent 49ers coach mentions'
    );

    // 5. Grounding validator flags departed 49ers coaches cited as current SF staff, while permitting external-team context
    const badCoachCheck = validateNoHallucinatedRosterClaims(
      "DC Robert Saleh's Wide-9 front in Santa Clara held Dallas to 3.4 yards per carry.",
      players
    );
    assert.equal(badCoachCheck.valid, false, 'Grounding validator must flag Robert Saleh cited as current 49ers DC');
    assert.ok(
      sanitizeHallucinatedRosterText("DC Robert Saleh's Wide-9 front in Santa Clara.", players).includes('Raheem Morris'),
      'Sanitizer must replace hallucinated current SF DC Robert Saleh with Raheem Morris'
    );
    const okCoachCheck = validateNoHallucinatedRosterClaims(
      '1-7 Titans (coached by former SF DC Robert Saleh) open to recouping draft picks.',
      players
    );
    assert.equal(okCoachCheck.valid, true, 'Grounding validator must allow verified Titans/former SF DC Robert Saleh mention');

    // 6. Static regression guards: neither linkIntegrity.js nor worker/index.js sfRe may contain stale saleh/jennings
    const linkIntegritySrc = fs.readFileSync(path.join(rootDir, 'src', 'engine', 'linkIntegrity.js'), 'utf8');
    const explicitBlock = linkIntegritySrc.match(/const EXPLICIT_SF_ENTITY_REGEX\s*=\s*[\s\S]*?;/);
    assert.ok(explicitBlock && !/saleh|jennings/i.test(explicitBlock[0]), 'EXPLICIT_SF_ENTITY_REGEX must not contain saleh or jennings');
    const workerSrc = fs.readFileSync(path.join(rootDir, 'worker', 'index.js'), 'utf8');
    const workerWireBlock = workerSrc.match(/const sfExplicitRe\s*=[\s\S]*?const isEdgeItem49ersRelevant/);
    assert.ok(workerWireBlock && !/saleh|jennings/i.test(workerWireBlock[0]), 'worker/index.js live-wire relevance regex must not contain saleh or jennings');
  }
);

await testAsync(
  'Early-week rollover preserves multi-week sidelined players ("chance at returning to action in Week 11") instead of falsely wiping to 95% Full Go, isolates comma-separated multi-player clauses, and preserves weeklyHistory priorWeekPracticed',
  async () => {
    const {
      computePlayerPlayProbability,
      evaluateCorroboratedNewsInjurySignal,
      scopeBeatTextToPlayer
    } = await import('../src/engine/injuryProbabilityModel.js');
    const { resolveEarlyWeekRolloverInput } = await import('../src/engine/gameDayRosterEngine.js');

    const evansShort =
      'Head coach Kyle Shanahan said Monday that the 49ers are "hoping to" have Evans (Achilles) back at practice this week, Nick Wagoner of ESPN.com reports.';
    const evansLong =
      "Evans missed the 49ers' last three games while recovering from right Achilles tendinitis, but he has a chance at returning to action in Week 11. After staying behind in the Bay Area this past weekend for the team's 46-40 win in Dallas, he's scheduled to meet back up with the 49ers this week in Colorado Springs, where the team will be holding practices at high altitude to get acclimated for Sunday's matchup with the Vikings in Mexico City. If Evans is able to practice in some capacity Wednesday through Friday and if his Achilles responds well, he'll likely be cleared to play for the first time since Week 6.";

    // 1A. Even when `playedInCompletedGame` is `null` (e.g., ESPN boxscore roster unavailable), Evans MUST NOT be skipped!
    const evansRollNull = resolveEarlyWeekRolloverInput({
      playerName: 'Mike Evans',
      rawStatus: 'Questionable',
      injuryType: 'Achilles',
      shortComment: evansShort,
      longComment: evansLong,
      upcomingWeek: 11,
      lastCompletedWeek: 10,
      blurbDateIso: '2026-11-16T22:05:00Z',
      lastCompletedGameKickoffMs: Date.parse('2026-11-15T21:25:00Z'),
      playedInCompletedGame: null,
      hasPostKickoffInjurySignal: false
    });
    assert.equal(evansRollNull.skip, false, 'Hedged "chance at returning to action in Week 11" must NEVER skip Evans to 95% Full Go');
    assert.equal(evansRollNull.effectiveStatus, 'Questionable');
    assert.equal(evansRollNull.missedPriorGame, true, '"missed the 49ers\' last three games" must set missedPriorGame=true');
    assert.equal(evansRollNull.missedPriorGameKnown, true);
    assert.equal(evansRollNull.sustainedInLastGame, false);
    assert.equal(evansRollNull.exitedWithoutReturn, false);

    // 1B. With explicit `playedInCompletedGame: false`
    const evansRollFalse = resolveEarlyWeekRolloverInput({
      playerName: 'Mike Evans',
      rawStatus: 'Questionable',
      injuryType: 'Achilles',
      shortComment: evansShort,
      longComment: evansLong,
      upcomingWeek: 11,
      lastCompletedWeek: 10,
      playedInCompletedGame: false,
      hasPostKickoffInjurySignal: false
    });
    assert.equal(evansRollFalse.skip, false);
    assert.equal(evansRollFalse.missedPriorGame, true);

    // 2. Evans Week 11 Tuesday probability stays realistic (~42% Long Shot), never 95% Full Go and zero bogus "exited prior game" factor
    const evansProb = computePlayerPlayProbability({
      name: 'Mike Evans',
      position: 'WR',
      experienceYears: 13,
      snapPct: 54,
      gameStatus: evansRollNull.effectiveStatus,
      priorWeekStatus: 'Questionable',
      missedPriorGame: evansRollNull.missedPriorGameKnown ? evansRollNull.missedPriorGame : undefined,
      priorWeekPracticed: evansRollNull.priorWeekPracticed,
      sustainedInLastGame: false,
      exitedPriorGameWithoutReturn: false,
      weeklyHistory: [
        { week: 7, injury: 'Ribs', gameStatus: 'Out', practiceStatus: 'Did Not Participate In Practice' },
        { week: 9, injury: 'Ribs', gameStatus: 'Out', practiceStatus: 'Did Not Participate In Practice' },
        { week: 10, injury: 'Achilles', gameStatus: 'Out', practiceStatus: 'Did Not Participate In Practice' }
      ],
      currentWeek: 11,
      byeWeek: 8,
      rosterBucket: 'active',
      injuryType: 'Achilles',
      wed: '-',
      thu: '-',
      fri: '-',
      beatNote: evansRollNull.beatNoteForModel
    });
    assert.ok(
      evansProb.probabilityPct >= 35 && evansProb.probabilityPct <= 50,
      `Expected Mike Evans Week 11 pre-practice probability in 35–50% Long Shot range, got ${evansProb.probabilityPct}% (${evansProb.badgeLabel})`
    );
    assert.ok(
      !evansProb.factors.some(f => /exited prior game/i.test(f)),
      `Mike Evans factors must never falsely claim exited prior game: ${JSON.stringify(evansProb.factors)}`
    );

    // 3. Passing `priorWeekPracticed: null` from rollover must NOT clobber `weeklyHistory` prior LP participation!
    const lpReturnerProb = computePlayerPlayProbability({
      name: 'Ricky Pearsall',
      position: 'WR',
      gameStatus: 'Questionable',
      missedPriorGame: true,
      priorWeekPracticed: null,
      weeklyHistory: [{ week: 10, injury: 'Shoulder', gameStatus: 'Out', practiceStatus: 'Limited Participation in Practice' }],
      currentWeek: 11,
      byeWeek: 8,
      rosterBucket: 'active',
      injuryType: 'Shoulder',
      wed: '-',
      thu: '-',
      fri: '-',
      beatNote: 'Pearsall missed Sunday and is questionable entering Week 11.'
    });
    assert.ok(
      lpReturnerProb.probabilityPct >= 65,
      `Null priorWeekPracticed must fall back to weeklyHistory LP ramp (>=65%), got ${lpReturnerProb.probabilityPct}%`
    );

    // 4. `scopeBeatTextToPlayer` isolates comma-separated independent multi-player clauses while preserving shared-predicate lists
    const multiSent =
      "Deebo is fresh off a hamstring, Renardo Green left with his back, and Mike Evans still can't get on the field.";
    const evansOnly = scopeBeatTextToPlayer(multiSent, 'Mike Evans', ['Deebo Samuel Sr.', 'Renardo Green', 'Mike Evans']);
    const greenOnly = scopeBeatTextToPlayer(multiSent, 'Renardo Green', ['Deebo Samuel Sr.', 'Renardo Green', 'Mike Evans']);
    assert.ok(!/left with his back/i.test(evansOnly), `Renardo Green exit must NOT bleed onto Mike Evans: ${evansOnly}`);
    assert.ok(/Mike Evans still can't get on the field/i.test(evansOnly), `Mike Evans clause must be preserved: ${evansOnly}`);
    assert.ok(/Renardo Green left with his back/i.test(greenOnly), `Renardo Green clause must preserve back exit: ${greenOnly}`);

    const sharedListSent =
      "Shanahan said he's hopeful to get Deebo Samuel, Trent Williams, and CJ West back to practice on Wednesday.";
    const westShared = scopeBeatTextToPlayer(sharedListSent, 'C.J. West', ['Deebo Samuel Sr.', 'Trent Williams', 'C.J. West']);
    assert.ok(
      /hopeful to get/i.test(westShared) && /back to practice on Wednesday/i.test(westShared),
      `Shared-predicate player list must remain intact for CJ West: ${westShared}`
    );

    // 5. Multi-player recap article containing Renardo Green exit must NOT generate SUSTAINED_IN_GAME_INJURY for Mike Evans
    const evansSignal = evaluateCorroboratedNewsInjurySignal({
      playerName: 'Mike Evans',
      playerId: '16737',
      rosterBucket: 'active',
      newsItems: [
        {
          id: 'nn_291',
          type: 'article',
          trustTier: 2,
          author: 'The Coach',
          publishedAt: '2026-11-16T19:01:00Z',
          title: 'We’re Firemen: The 49ers need to stay who they are',
          playerSnippets: { '16737': multiSent }
        },
        {
          id: 'wz_298',
          type: 'article',
          trustTier: 2,
          author: '49ers Webzone',
          publishedAt: '2026-11-17T00:58:45Z',
          title: 'Transcript: Kyle Shanahan shares 49ers updates',
          playerSnippets: {
            '16737': 'Do you expect to bring WR Mike Evans back to practice this week? "I\'m hoping to, just not sure yet."'
          }
        }
      ],
      rosterPlayerNames: ['Deebo Samuel Sr.', 'Renardo Green', 'Mike Evans'],
      nowMs: Date.parse('2026-11-17T23:50:00Z'),
      windowStartMs: Date.parse('2026-11-16T00:25:00Z'),
      lastCompletedGameKickoffMs: Date.parse('2026-11-15T21:25:00Z'),
      lastCompletedWeek: 10
    });
    assert.notEqual(
      evansSignal.signalType,
      'SUSTAINED_IN_GAME_INJURY',
      `Mike Evans must never get SUSTAINED_IN_GAME_INJURY from Renardo Green clause bleed (got ${evansSignal.signalType})`
    );
    assert.notEqual(
      evansSignal.signalType,
      'EXPECTED_PRACTICE_RETURN',
      `Hedged "hoping to, just not sure yet" must not fire EXPECTED_PRACTICE_RETURN (got ${evansSignal.signalType})`
    );
  }
);

await testAsync(
  'Cross-device Top News Brief parity: workflow installed, retry cooldown + Worker KV lookup recover from transient errors, no "vs." truncation or duplicate Week headline or mismatched fallback cites',
  async () => {
    const {
      extractCompleteRssSentences,
      buildDeterministicDailyTopNewsBrief,
      refreshDailyTopNewsBriefIfDue,
      shouldTriggerDailyTopNewsBriefRefresh,
      clearDailyNewsBriefAttemptLock,
      hydrateCachedDailyTopNewsBrief
    } = await import('../src/services/aiWorkerClient.js');

    // 1. Abbreviation-safe RSS sentence extraction never chops "win vs. Cowboys" into "win vs."
    assert.equal(
      extractCompleteRssSentences(
        "How explosive 49ers' offense set several NFL records in Week 10 shootout win vs. Cowboys"
      ),
      '',
      'Headline without terminal punctuation must not split on "vs." into a dangling fragment'
    );
    assert.equal(
      extractCompleteRssSentences(
        'San Francisco scored 46 points vs. Dallas. Brock Purdy threw for 389 yards and four scores'
      ),
      'San Francisco scored 46 points vs. Dallas.',
      'Complete sentence containing "vs." must be preserved intact while dropping trailing incomplete fragment'
    );

    // 2. Upgraded deterministic fallback: zero duplicate Week headline, zero canned boilerplate, zero mismatched Evans cite on opponent bullet, accurate fallback metadata
    const liveAppData = {
      meta: JSON.parse(fs.readFileSync(path.join(rootDir, 'data', 'meta.json'), 'utf8')),
      roster: JSON.parse(fs.readFileSync(path.join(rootDir, 'data', 'roster.json'), 'utf8')),
      cap: JSON.parse(fs.readFileSync(path.join(rootDir, 'data', 'cap.json'), 'utf8')),
      health: JSON.parse(fs.readFileSync(path.join(rootDir, 'data', 'health.json'), 'utf8')),
      news: JSON.parse(fs.readFileSync(path.join(rootDir, 'data', 'news.json'), 'utf8')),
      scheduleMatchup: JSON.parse(fs.readFileSync(path.join(rootDir, 'data', 'schedule-matchup.json'), 'utf8')),
      seasonal: JSON.parse(fs.readFileSync(path.join(rootDir, 'data', 'seasonal.json'), 'utf8'))
    };
    const midWeekNowMs = Date.parse(liveAppData.meta?.updatedAt || '') || Date.parse('2026-11-17T06:45:00Z');
    const fallbackBrief = buildDeterministicDailyTopNewsBrief(liveAppData, midWeekNowMs);
    assert.equal(fallbackBrief.source, 'pipeline-grounded');
    assert.equal(fallbackBrief.modelUsed, 'deterministic-grounded');
    assert.equal(fallbackBrief.thinkingLevel, 'NONE');
    assert.ok(
      !/Week\s+\d+\s+Briefing:\s*Week\s+\d+/i.test(fallbackBrief.headline),
      `Fallback headline must never duplicate Week N: "${fallbackBrief.headline}"`
    );
    const fbBody = fallbackBrief.bullets.join(' ');
    assert.ok(
      !/condensed split motion,\s*four-man pass-rush integrity/i.test(fbBody),
      `Fallback brief must not contain generic canned matchup boilerplate: ${fbBody}`
    );
    assert.ok(
      !/\bwin\s+vs\s+\[/i.test(fbBody),
      `Fallback brief must never terminate mid-phrase on "win vs": ${fbBody}`
    );
    assert.ok(
      fallbackBrief.wordCount >= 150 && fallbackBrief.wordCount <= 285,
      `Fallback brief wordCount (${fallbackBrief.wordCount}) must stay within 150–285`
    );
    const opponentBullet = fallbackBrief.bullets.find(b => /Vikings|Horizon|Outlook|Matchup/i.test(b)) || '';
    assert.ok(
      !opponentBullet.includes('/mike-evans'),
      `Opponent matchup bullet must never attach unrelated Mike Evans injury URL: ${opponentBullet}`
    );

    // 3. GitHub Actions workflow template passes GEMINI_API_KEY + WORKER_BASE_URL & pipeline preserves Bluesky-citing AI briefs
    const workflowPath = path.join(rootDir, 'scripts', 'github-workflow-refresh-data.yml');
    assert.ok(fs.existsSync(workflowPath), 'Expected scripts/github-workflow-refresh-data.yml to exist');
    const workflowText = fs.readFileSync(workflowPath, 'utf8');
    assert.ok(workflowText.includes('GEMINI_API_KEY') && workflowText.includes('WORKER_BASE_URL'));
    const pipelineSrc = fs.readFileSync(path.join(rootDir, 'scripts', 'fetch-live-49ers-data.mjs'), 'utf8');
    assert.ok(
      !pipelineSrc.includes("!JSON.stringify(prevBrief).includes('bsky.app')"),
      'Pipeline must not discard valid cached pipeline-gemini-daily briefs solely because a fallback bsky.app source is cited'
    );

    // 3B. hydrateCachedDailyTopNewsBrief auto-upgrades legacy degraded pipeline-grounded fallbacks immediately
    const degradedData = structuredClone(liveAppData);
    degradedData.news.dailyTopNewsBrief = {
      id: 'daily_brief_2026-11-16_17PT',
      cycleKey: '2026-11-16@17PT',
      generatedAt: '2026-11-17T07:08:18.488Z',
      source: 'pipeline-grounded',
      headline: '49ers (8-1) Week 11 Briefing: Week 11 Minnesota Vikings Prep',
      summary: '',
      bullets: [
        'Week 11 Matchup Keys: Kyle Shanahan and DC Raheem Morris prepare for the Minnesota Vikings with interior pass protection, condensed split motion, four-man pass-rush integrity [S1].',
        'Around the Beat: How explosive 49ers offense set several NFL records in Week 10 shootout win vs [S2].'
      ],
      sources: liveAppData.news.dailyTopNewsBrief?.sources || []
    };
    const origStoragePre = globalThis.localStorage;
    const origWindowPre = globalThis.window;
    try {
      const emptyStore = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
      globalThis.localStorage = emptyStore;
      globalThis.window = { ...(origWindowPre || {}), localStorage: emptyStore };
      const upgraded = hydrateCachedDailyTopNewsBrief(degradedData, Date.parse('2026-11-17T23:54:00Z'));
      assert.equal(upgraded, true, 'Legacy degraded pipeline-grounded fallback must auto-upgrade on hydration');
      assert.ok(
        !/Week\s+11\s+Briefing:\s*Week\s+11/i.test(degradedData.news.dailyTopNewsBrief.headline),
        `Auto-upgraded headline must not duplicate Week 11: ${degradedData.news.dailyTopNewsBrief.headline}`
      );
      assert.ok(
        !/\bwin\s+vs\s+\[/i.test(degradedData.news.dailyTopNewsBrief.bullets.join(' ')),
        'Auto-upgraded fallback must eliminate truncated "win vs" bullet'
      );
    } finally {
      globalThis.localStorage = origStoragePre;
      globalThis.window = origWindowPre;
    }

    // 4. Transient AI failure cools down (15 min) instead of permanently blacklisting 24h, AND free Worker KV check still converges immediately
    const origFetch = globalThis.fetch;
    const origStorage = globalThis.localStorage;
    const origWindow = globalThis.window;
    const memStore = new Map();
    const mockStorage = {
      getItem: k => (memStore.has(k) ? memStore.get(k) : null),
      setItem: (k, v) => memStore.set(k, String(v)),
      removeItem: k => memStore.delete(k)
    };
    try {
      globalThis.localStorage = mockStorage;
      globalThis.window = { ...(origWindow || {}), localStorage: mockStorage };

      // Calendar-proof Wednesday midday timestamp with fresh beat items so test never collides with Sunday Game-Day Hold
      const wedTestNowMs = Date.parse('2026-11-18T20:00:00Z');
      const makeRetryTestAppData = () => {
        const cloned = structuredClone(liveAppData);
        cloned.meta.updatedAt = new Date(wedTestNowMs - 5 * 60_000).toISOString();
        cloned.news.rawStream = [
          {
            id: 'retry_s1',
            type: 'article',
            author: '49ers.com Staff',
            outletName: '49ers.com',
            title: '49ers Offense Racks Up 584 Yards as McCaffrey Breaks Records Against Cowboys',
            summary: 'San Francisco improved to 8-1 behind 584 total yards from Christian McCaffrey and Brock Purdy.',
            url: 'https://www.49ers.com/news/retry-test-offense-584',
            publishedAt: new Date(wedTestNowMs - 2 * 3600_000).toISOString(),
            category: 'beat'
          },
          {
            id: 'retry_s2',
            type: 'tweet',
            author: 'Matt Barrows',
            outletName: 'The Athletic',
            title: 'Kyle Shanahan noted defensive-line fatigue in the fourth quarter after the pass rush graded well early.',
            fullText: 'Kyle Shanahan noted defensive-line fatigue in the fourth quarter after the pass rush graded well early.',
            url: 'https://x.com/mattbarrows/status/2122447687304099901',
            publishedAt: new Date(wedTestNowMs - 90 * 60_000).toISOString(),
            category: 'beat'
          },
          {
            id: 'retry_s3',
            type: 'tweet',
            author: 'Nick Wagoner',
            outletName: 'ESPN',
            title: 'Mike Evans is eyeing a return to practice from Achilles tendinitis while Renardo Green is day-to-day.',
            fullText: 'Mike Evans is eyeing a return to practice from Achilles tendinitis while Renardo Green is day-to-day.',
            url: 'https://x.com/nwagoner/status/2122447687304099902',
            publishedAt: new Date(wedTestNowMs - 45 * 60_000).toISOString(),
            category: 'injury'
          }
        ];
        cloned.news.dailyTopNewsBrief = buildDeterministicDailyTopNewsBrief(cloned, wedTestNowMs);
        return cloned;
      };

      let kvHasBrief = false;
      let failGeminiCalls = true;
      let geminiAttemptCount = 0;
      const aiBriefJson = JSON.stringify({
        headline: '49ers Address Pass-Rush Fatigue, Secondary Injuries, and Evans Return Ahead of Vikings',
        summary: '',
        bullets: [
          'Historic Cowboys Offensive Outburst: San Francisco improved to 8-1 after piling up 584 yards against Dallas behind Christian McCaffrey and Brock Purdy [S1].',
          'Fourth-Quarter Pass-Rush Fatigue: Kyle Shanahan noted the pass rush graded solidly early before defensive-line fatigue hit late [S2].',
          'Evans and Cornerback Updates: Wide receiver Mike Evans is eyeing a return to practice from Achilles tendinitis while Renardo Green is day-to-day [S3].'
        ],
        citedSourceIds: ['S1', 'S2', 'S3']
      });

      globalThis.fetch = async (url, init = {}) => {
        const u = String(url);
        const method = String(init.method || 'GET').toUpperCase();
        if (u.includes('/api/daily-news-brief') && method === 'GET') {
          if (kvHasBrief) {
            return new Response(
              JSON.stringify({
                cached: true,
                modelUsed: 'gemini-4-hydrogen',
                generatedAt: new Date(wedTestNowMs - 3600_000).toISOString(),
                rawText: aiBriefJson
              }),
              { status: 200 }
            );
          }
          return new Response(JSON.stringify({ cached: false, rawText: '' }), { status: 200 });
        }
        if (u.includes('/api/daily-news-brief') && method === 'POST') {
          return new Response(JSON.stringify({ error: 'transient 502' }), { status: 502 });
        }
        if (u.includes('/models?')) {
          return new Response(JSON.stringify({ models: [{ name: 'models/gemini-4-hydrogen', supportedGenerationMethods: ['generateContent'] }] }), { status: 200 });
        }
        if (u.includes(':generateContent')) {
          geminiAttemptCount += 1;
          if (failGeminiCalls) {
            return new Response(JSON.stringify({ error: { message: 'transient 503' } }), { status: 503 });
          }
          return new Response(
            JSON.stringify({ candidates: [{ content: { parts: [{ text: aiBriefJson }] } }] }),
            { status: 200 }
          );
        }
        return new Response('{}', { status: 404 });
      };

      const laptopData = makeRetryTestAppData();
      const laptopPrefs = {
        workerBaseUrl: 'https://49ers-sync.workers.dev',
        groupPasscode: 'faithful25',
        geminiApiKey: 'AIzaLaptopKey',
        geminiApiBaseUrl: 'https://mock-laptop.local/v1beta'
      };

      // First attempt fails transiently across cascade
      const failRes = await refreshDailyTopNewsBriefIfDue({
        appData: laptopData,
        prefs: laptopPrefs,
        nowMs: wedTestNowMs
      });
      assert.equal(failRes.updated, false);
      assert.ok(geminiAttemptCount >= 1);
      const callsAfterLaptopFail = geminiAttemptCount;

      // 4 minutes later, Mobile seeds Worker KV -> Laptop MUST adopt it via free KV GET even during 15m synthesis cooldown!
      kvHasBrief = true;
      assert.equal(
        shouldTriggerDailyTopNewsBriefRefresh(laptopData, laptopPrefs, wedTestNowMs + 4 * 60_000),
        true,
        'Device with workerBaseUrl must still re-check free Worker KV after 3m even during synthesis cooldown'
      );
      const kvAdoptRes = await refreshDailyTopNewsBriefIfDue({
        appData: laptopData,
        prefs: laptopPrefs,
        nowMs: wedTestNowMs + 4 * 60_000
      });
      assert.equal(kvAdoptRes.updated, true);
      assert.equal(kvAdoptRes.fromSharedWorkerCache, true);
      assert.equal(geminiAttemptCount, callsAfterLaptopFail, 'Adopting Worker KV brief must spend 0 extra Gemini calls');
      assert.ok(laptopData.news.dailyTopNewsBrief.headline.includes('Pass-Rush Fatigue'));

      // Also verify direct-key-only device retries cleanly after 15m cooldown (not locked out for 24h)
      memStore.clear();
      geminiAttemptCount = 0;
      failGeminiCalls = true;
      const directData = makeRetryTestAppData();
      const directPrefs = {
        geminiApiKey: 'AIzaDirectKey',
        geminiApiBaseUrl: 'https://mock-direct.local/v1beta'
      };
      const directFailRes = await refreshDailyTopNewsBriefIfDue({
        appData: directData,
        prefs: directPrefs,
        nowMs: wedTestNowMs
      });
      assert.equal(directFailRes.updated, false);
      const callsAfterDirectFail = geminiAttemptCount;
      assert.equal(
        shouldTriggerDailyTopNewsBriefRefresh(directData, directPrefs, wedTestNowMs + 5 * 60_000),
        false,
        'Direct-key device should respect 15m cooldown right after a transient failure'
      );
      assert.equal(
        shouldTriggerDailyTopNewsBriefRefresh(directData, directPrefs, wedTestNowMs + 16 * 60_000),
        true,
        'Direct-key device must retry after 15m cooldown instead of blacklisting the full 24h cycle'
      );
      failGeminiCalls = false;
      const recoveredRes = await refreshDailyTopNewsBriefIfDue({
        appData: directData,
        prefs: directPrefs,
        nowMs: wedTestNowMs + 16 * 60_000
      });
      assert.equal(recoveredRes.updated, true);
      assert.equal(geminiAttemptCount, callsAfterDirectFail + 1);

      // Verify clearDailyNewsBriefAttemptLock immediately unblocks retry when Settings are saved
      clearDailyNewsBriefAttemptLock();
      assert.equal(mockStorage.getItem('joshal_49ers_daily_news_brief_attempt_v5'), null);

      // Verify hydrateCachedDailyTopNewsBrief preserves live AI brief over a newer-timestamped pipeline-grounded fallback (same cycle: 2:00 PM PT Wed)
      const newerFallback = buildDeterministicDailyTopNewsBrief(directData, wedTestNowMs + 2 * 3600_000, {
        cycleKey: directData.news.dailyTopNewsBrief.cycleKey,
        generatedAt: new Date(wedTestNowMs + 2 * 3600_000).toISOString(),
        source: 'pipeline-grounded'
      });
      directData.news.dailyTopNewsBrief = newerFallback;
      hydrateCachedDailyTopNewsBrief(directData, wedTestNowMs + 2 * 3600_000);
      assert.equal(
        directData.news.dailyTopNewsBrief.source,
        'live-gemini-daily',
        'Cached live-gemini-daily brief must always beat a newer-timestamped pipeline-grounded fallback for the same cycle'
      );
    } finally {
      globalThis.fetch = origFetch;
      globalThis.localStorage = origStorage;
      globalThis.window = origWindow;
    }
  }
);

test('Salient Visual Media Engine: CDN resize transforms, 4-tier visual resolution, cluster photo promotion & holistic view coverage', () => {
  // 1. Verified CDN resize transforms + fallback preservation
  const optHs = optimizeImageUrlForSlot('https://a.espncdn.com/i/headshots/nfl/players/full/4361741.png', 'thumb');
  assert.ok(optHs.src.includes('a.espncdn.com/combiner/i?img=/i/headshots/nfl/players/full/4361741.png&w=180'));
  assert.equal(optHs.fallbackSrc, 'https://a.espncdn.com/i/headshots/nfl/players/full/4361741.png');

  const optLogo = optimizeImageUrlForSlot('https://a.espncdn.com/i/teamlogos/nfl/500/sf.png', 'logo');
  assert.ok(optLogo.src.includes('a.espncdn.com/combiner/i?img=/i/teamlogos/nfl/500/sf.png&w=96&h=96'));
  assert.equal(optLogo.fallbackSrc, 'https://a.espncdn.com/i/teamlogos/nfl/500/sf.png');

  const optTw = optimizeImageUrlForSlot('https://pbs.twimg.com/media/HXRndonaQAAfqqC.jpg', 'thumb');
  assert.equal(optTw.src, 'https://pbs.twimg.com/media/HXRndonaQAAfqqC?format=webp&name=360x360');
  assert.equal(optTw.fallbackSrc, 'https://pbs.twimg.com/media/HXRndonaQAAfqqC.jpg');

  const optNn = optimizeImageUrlForSlot(
    'https://platform.ninersnation.com/wp-content/uploads/sites/115/2026/11/gettyimages-2305283884.jpg?quality=90&strip=all',
    'thumb'
  );
  assert.ok(optNn.src.includes('w=320') && optNn.src.includes('quality=80'));

  const optClub = optimizeImageUrlForSlot(
    'https://static.clubs.nfl.com/image/upload/t_editorial_landscape_12_desktop/49ers/k9mjyceeg70bibwndz1r.jpg',
    'thumb'
  );
  assert.ok(optClub.src.includes('f_auto,q_auto,w_360'));

  const optPod = optimizeImageUrlForSlot(
    'https://is1-ssl.mzstatic.com/image/thumb/Podcasts211/v4/5b/63/ed/mza_123.png/600x600bb.jpg',
    'artwork'
  );
  assert.ok(optPod.src.endsWith('/160x160bb.jpg'));

  // 2. Editorial vs headshot classification
  assert.equal(isHeadshotImageUrl('https://a.espncdn.com/i/headshots/nfl/players/full/4361741.png'), true);
  assert.equal(isEditorialPhotoUrl('https://a.espncdn.com/i/headshots/nfl/players/full/4361741.png'), false);
  assert.equal(isEditorialPhotoUrl('https://s.espncdn.com/stitcher/sports/football/nfl/events/401873063.png?templateId=espn.applewatch.awayhome.1'), false);
  assert.equal(isEditorialPhotoUrl('https://static.clubs.nfl.com/image/upload/t_editorial_landscape_12_desktop/49ers/test.jpg'), true);

  // 3. 4-tier visual resolution cascade + excludePlayerId non-redundancy
  const metaLocal = JSON.parse(fs.readFileSync(path.join(rootDir, 'data', 'meta.json'), 'utf8'));
  const rosterLocal = JSON.parse(fs.readFileSync(path.join(rootDir, 'data', 'roster.json'), 'utf8'));
  const healthLocal = JSON.parse(fs.readFileSync(path.join(rootDir, 'data', 'health.json'), 'utf8'));
  const newsLocal = JSON.parse(fs.readFileSync(path.join(rootDir, 'data', 'news.json'), 'utf8'));
  const schedLocal = JSON.parse(fs.readFileSync(path.join(rootDir, 'data', 'schedule-matchup.json'), 'utf8'));
  const reportersLocal = JSON.parse(fs.readFileSync(path.join(rootDir, 'data', 'reporters.json'), 'utf8'));
  const beatPodsLocal = JSON.parse(fs.readFileSync(path.join(rootDir, 'data', 'beat-podcasts.json'), 'utf8'));
  const podIndexLocal = JSON.parse(fs.readFileSync(path.join(rootDir, 'data', 'podcasts', 'index.json'), 'utf8'));
  const sampleRoster = rosterLocal.players || [];
  const purdy = sampleRoster.find(p => /brock purdy/i.test(p.name));
  assert.ok(purdy?.headshotUrl, 'Roster must include Brock Purdy with headshotUrl');

  const edVisual = resolveSalientCardVisual(
    {
      title: '49ers offense sets records vs Cowboys',
      imageUrl: 'https://static.clubs.nfl.com/image/upload/t_editorial_landscape_12_desktop/49ers/test.jpg'
    },
    { rosterPlayers: sampleRoster }
  );
  assert.equal(edVisual?.kind, 'editorial');

  const playerFallback = resolveSalientCardVisual(
    {
      title: 'NFC Notes: Brock Purdy efficiency surges entering Week 11',
      imageUrl: '',
      mentionedPlayers: []
    },
    { rosterPlayers: sampleRoster }
  );
  assert.equal(playerFallback?.kind, 'player');
  assert.equal(playerFallback?.playerId, String(purdy.id));

  // Inside Brock Purdy's own dossier (`excludePlayerId = purdy.id`), suppress redundant headshot!
  const suppressedInOwnDossier = resolveSalientCardVisual(
    {
      title: 'Brock Purdy throws three touchdowns in practice',
      imageUrl: purdy.headshotUrl,
      mentionedPlayers: [purdy]
    },
    { rosterPlayers: sampleRoster, excludePlayerId: purdy.id, allowTeamFallback: false }
  );
  assert.equal(suppressedInOwnDossier, null, 'Must not repeat the same player headshot inside their own Player Dossier');

  // Opponent matchup dual-crest fallback when no photo or player is present
  const matchupVisual = resolveSalientCardVisual(
    {
      title: 'The Cowboys are going to have a chance to win this.',
      imageUrl: '',
      mentionedPlayers: []
    },
    { rosterPlayers: sampleRoster }
  );
  assert.equal(matchupVisual?.kind, 'matchup');
  assert.equal(matchupVisual?.oppAbbr, 'DAL');

  // Official 49ers Coach/Podium emblem fallback
  const coachVisual = resolveSalientCardVisual(
    {
      title: 'Kyle Shanahan on the 49ers pass rush after Week 10',
      imageUrl: '',
      mentionedPlayers: []
    },
    { rosterPlayers: sampleRoster }
  );
  assert.equal(coachVisual?.kind, 'team');
  assert.equal(coachVisual?.tagLabel, 'COACH');

  // 4. Cluster photo inheritance: confirming report editorial photo upgrades text-only lead
  const clusteredWithPhoto = deduplicateAndGroupWireItems(
    [
      {
        id: 'x_lead_no_img',
        type: 'tweet',
        author: 'Matt Maiocco',
        outletName: 'NBC Sports Bay Area',
        trustTier: 1,
        url: 'https://x.com/MaioccoNBCS/status/999000111222333',
        title: 'Brock Purdy named NFC Offensive Player of the Week after 46-40 win over Cowboys',
        fullText: 'Brock Purdy named NFC Offensive Player of the Week after 46-40 win over Cowboys',
        imageUrl: '',
        publishedAt: new Date(Date.now() - 30 * 60_000).toISOString()
      },
      {
        id: 'art_confirm_with_img',
        type: 'article',
        author: 'NBC Sports Bay Area',
        outletName: 'NBC Sports Bay Area',
        trustTier: 2,
        url: 'https://www.nbcsportsbayarea.com/nfl/san-francisco-49ers/brock-purdy-nfc-player-week/999999/',
        title: 'Brock Purdy named NFC Offensive Player of the Week after 46-40 Cowboys win',
        imageUrl: 'https://static.clubs.nfl.com/image/upload/t_editorial_landscape_12_desktop/49ers/purdy-hero.jpg',
        publishedAt: new Date(Date.now() - 25 * 60_000).toISOString()
      }
    ],
    { nowMs: Date.now() }
  );
  assert.equal(clusteredWithPhoto.length, 1);
  assert.ok(
    isEditorialPhotoUrl(clusteredWithPhoto[0].imageUrl),
    'Story cluster lead must inherit editorial photo from confirming report'
  );

  // 5. Daily Top News Brief hero selection strictly picks a real editorial photo (never a headshot)
  const briefHero = resolveDailyBriefHeroMedia(newsLocal.dailyTopNewsBrief, newsLocal.rawStream || [], {
    rosterPlayers: sampleRoster
  });
  assert.ok(briefHero && isEditorialPhotoUrl(briefHero.rawUrl), 'Daily Top News Brief must resolve a real editorial photo');

  // 6. Audio episode visual accents extract mentioned players & opponent
  const epVisual = resolveAudioEpisodeVisual(
    {
      title: 'Week 9 Trench & Scheme Preview: Bosa + Buckner Debut vs. Raiders',
      topic: 'Week 9 LV @ SF Matchup'
    },
    { rosterPlayers: sampleRoster }
  );
  assert.equal(epVisual.opponent?.abbr, 'LV');
  assert.ok(epVisual.players.length >= 1, 'Episode visual resolver should detect mentioned 49ers stars');

  // 7. Rendered Home & News views include salient photos on tweets, articles & Daily Brief with zero regressions
  const appMock = {
    meta: metaLocal,
    roster: rosterLocal,
    health: healthLocal,
    cap: capData,
    news: newsLocal,
    scheduleMatchup: schedLocal,
    seasonal: seasonalData,
    reporters: reportersLocal,
    beatPodcasts: beatPodsLocal,
    podcastIndex: podIndexLocal
  };
  const renderedNewsAll = renderNewsViewHtml({
    appData: appMock,
    newsCategoryFilter: 'all',
    filteredRawItems: newsLocal.rawStream || [],
    userPrefs: {}
  });
  assert.ok(renderedNewsAll.includes('data-salient-hero="true"'), 'News & Film Daily Brief must render editorial hero photo');
  assert.ok(renderedNewsAll.includes('data-salient-thumb='), 'News & Film feed cards must render salient thumbnails');

  const renderedHome = renderHomeDashboardHtml({
    orderedBlocks: ALL_DASHBOARD_BLOCKS.filter(b => DEFAULT_HOME_BLOCK_IDS.includes(b.id)),
    appData: appMock,
    simCapResult: { summary: {}, moveCount: 0, baseYear: '2026' },
    mcSimResult: seasonalData.playoffPicture?.baselineSimulation || {},
    filteredClusters: [],
    filteredRawItems: newsLocal.rawStream || [],
    userPrefs: {},
    isCustomizingLayout: false
  });
  assert.ok(renderedHome.includes('home-wire-thumb'), 'Home Latest Tweets must render salient right-rail thumbnails');
  assert.ok(renderedHome.includes('home-article-thumb'), 'Home Latest Articles must render salient right-rail thumbnails');
  assert.ok(renderedHome.includes('home-pod-art-stack'), 'Home Audio & AI card must render overlapping Beat Podcast show artwork');
  const homeMatchupMatch = renderedHome.match(/data-dashboard-block="upcoming_matchup"[\s\S]*?<\/article>/);
  assert.ok(homeMatchupMatch && !homeMatchupMatch[0].includes('player-avatar'), 'Home Upcoming Matchup must preserve 0 player avatars');
});

await testAsync(
  'Holistic Link-Drop Tweet -> Direct Article Promotion: bypasses intermediate social hop for 90%+ article link-drops while preserving salient tweets with complementary links',
  async () => {
    const {
      extractBlueskyBestExternalLink,
      isDirectArticleUrl,
      isPublicationOrBrandSocialAccount,
      isArticleLinkDropTweet,
      promoteLinkDropTweetToArticle,
      reconcileLinkDropTweetsWithArticles
    } = await import('../src/engine/breakingClassifier.js');
    const { hydrateLiveBlueskyBeatWire } = await import('../src/services/dataService.js');
    const { renderWireItemCardHtml, renderDailyTopNewsBriefHtml } = await import('../src/views/newsView.js');

    // 1. Direct article URL validation
    assert.equal(isDirectArticleUrl('https://nfltraderumors.co/nfc-notes-christian-mccaffrey-49ers-cowboys-giants/'), true);
    assert.equal(isDirectArticleUrl('https://www.49erswebzone.com/articles/205235-transcript-shanahan/'), true);
    assert.equal(isDirectArticleUrl('https://www.nbcsportsbayarea.com/nfl/san-francisco-49ers/week-11/1978963/'), true);
    assert.equal(isDirectArticleUrl('https://youtu.be/MJYAXBf05vM'), false, 'YouTube is video, not article');
    assert.equal(isDirectArticleUrl('https://open.spotify.com/episode/6FrjIKMcvJCsNV3JNBHhOh'), false, 'Spotify is podcast, not article');
    assert.equal(isDirectArticleUrl('https://www.nytimes.com/athletic/7781234/49ers/'), false, 'Paywalled Athletic must not promote');
    assert.equal(isDirectArticleUrl('https://dlvr.it/TAbC12'), false, 'Unexpanded shortener must not promote');
    assert.equal(isDirectArticleUrl('https://www.49erswebzone.com/articles/'), false, 'Bare section root must not promote');
    assert.equal(isDirectArticleUrl('https://www.nbcsportsbayarea.com/mlb/san-francisco-giants/hire/1979637/'), false, 'MLB URL must not promote');

    // 2. Pure brand link-drop tweets MUST promote directly to type='article' with direct article URL & no redundant Article chip
    const wzLinkDrop = {
      id: 'wz_bsky_1',
      type: 'tweet',
      author: '49ers Webzone',
      reporterName: '49ers Webzone',
      outletId: '49ers_webzone',
      outletName: '49ers Webzone',
      authorHandle: '@49erswebzone',
      title: "#49ers' Defensive Struggles Could Become a Major Playoff Problem Read:",
      fullText: "#49ers' Defensive Struggles Could Become a Major Playoff Problem Read:",
      url: 'https://bsky.app/profile/49erswebzone.bsky.social/post/3n2testwz1',
      externalUrl: 'https://www.49erswebzone.com/articles/205250-defensive-struggles-playoff-problem/',
      externalTitle: "49ers' Defensive Struggles Could Become a Major Playoff Problem",
      externalDescription: 'San Francisco gave up 40 points in Dallas despite improving to 8-1.',
      publishedAt: new Date().toISOString()
    };
    const wzPromoted = promoteLinkDropTweetToArticle(wzLinkDrop);
    assert.equal(wzPromoted.type, 'article', '49ers Webzone Read: tweet must promote to article');
    assert.equal(wzPromoted.url, 'https://www.49erswebzone.com/articles/205250-defensive-struggles-playoff-problem/');
    assert.equal(wzPromoted.externalUrl, null, 'Promoted article must clear externalUrl so no redundant Article pill renders');
    assert.equal(wzPromoted.title, "49ers' Defensive Struggles Could Become a Major Playoff Problem");
    assert.ok(wzPromoted.summary.includes('40 points'), 'Promoted article must carry externalDescription as summary');
    const wzCardHtml = renderWireItemCardHtml(wzPromoted);
    assert.ok(wzCardHtml.includes('data-raw-type="article"'), 'Rendered card must be labeled article');
    assert.ok(wzCardHtml.includes('<span>Article</span>'), 'Rendered card must display Article badge');
    assert.ok(!wzCardHtml.includes('bsky.app'), 'Rendered card must link directly to article, bypassing Bluesky');
    assert.ok(!wzCardHtml.includes('Article: 49ers'), 'Rendered card must not duplicate Article chip');

    // 3. NFL Trade Rumors exact headline link-drop & ProFootballTalk exact headline link-drop -> promote to article
    const nfltrPromoted = promoteLinkDropTweetToArticle({
      id: 'nfltr_bsky_1',
      type: 'tweet',
      author: 'NFL Trade Rumors',
      outletId: 'nfl_trade_rumors',
      outletName: 'NFL Trade Rumors',
      authorHandle: '@nflrums',
      title: 'NFC Notes: Christian McCaffrey, Christian Parker, 49ers, Cowboys, Giants',
      fullText: 'NFC Notes: Christian McCaffrey, Christian Parker, 49ers, Cowboys, Giants',
      url: 'https://bsky.app/profile/nfltraderumors.bsky.social/post/3n2k6eqwce32q',
      externalUrl: 'https://nfltraderumors.co/nfc-notes-christian-mccaffrey-christian-parker-49ers-cowboys-giants/',
      externalTitle: 'NFC Notes: Christian McCaffrey, Christian Parker, 49ers, Cowboys, Giants',
      externalDescription: '49ers RB Christian McCaffrey had a massive game against the Cowboys defense.',
      publishedAt: new Date().toISOString()
    });
    assert.equal(nfltrPromoted.type, 'article');
    assert.equal(nfltrPromoted.url, 'https://nfltraderumors.co/nfc-notes-christian-mccaffrey-christian-parker-49ers-cowboys-giants/');
    assert.equal(nfltrPromoted.promotedFromSocialUrl, 'https://bsky.app/profile/nfltraderumors.bsky.social/post/3n2k6eqwce32q');

    const pftPromoted = promoteLinkDropTweetToArticle({
      id: 'pft_bsky_1',
      type: 'tweet',
      author: 'ProFootballTalk',
      reporterId: 'mike_florio',
      outletId: 'nfl_network',
      outletName: 'NBC ProFootballTalk',
      authorHandle: '@ProFootballTalk',
      title: 'Von Miller blames himself, not the play call, for Christian McCaffrey’s late TD.',
      fullText: 'Von Miller blames himself, not the play call, for Christian McCaffrey’s late TD.',
      url: 'https://bsky.app/profile/profootballtalk.bsky.social/post/3n2i3g7uib22t',
      externalUrl: 'https://www.nbcsports.com/nfl/profootballtalk/rumor-mill/news/von-miller-blames-himself',
      externalTitle: "Von Miller blames himself, not the play call, for Christian McCaffrey's late TD",
      publishedAt: new Date().toISOString()
    });
    assert.equal(pftPromoted.type, 'article');
    assert.equal(pftPromoted.url, 'https://www.nbcsports.com/nfl/profootballtalk/rumor-mill/news/von-miller-blames-himself');

    // 4. NBCSBA brand desk teaser with `(via @mattmaiocco.bsky.social)` -> promotes to article AND resolves writer byline
    const nbcsbaPromoted = promoteLinkDropTweetToArticle({
      id: 'nbcs_bsky_1',
      type: 'tweet',
      author: '49ers on NBCSBA',
      outletId: 'nbcsba',
      outletName: 'NBC Sports Bay Area',
      authorHandle: '@NBCS49ers',
      title: '"I\'m not worried about Nick." Kyle Shanahan is confident Nick Bosa will return to form (via @mattmaiocco.bsky.social)',
      fullText: '"I\'m not worried about Nick." Kyle Shanahan is confident Nick Bosa will return to form (via @mattmaiocco.bsky.social)',
      url: 'https://bsky.app/profile/nbcs49ers.bsky.social/post/3n2hn4rl3xc22',
      externalUrl: 'https://www.nbcsportsbayarea.com/nfl/san-francisco-49ers/nick-bosa-sack-injury-kyle-shanahan/1980800/',
      externalTitle: 'Why Nick Bosa’s sack-less season doesn’t worry 49ers coach Kyle Shanahan',
      externalDescription: 'San Francisco 49ers coach Kyle Shanahan is confident it is only a matter of time for Nick Bosa.',
      publishedAt: new Date().toISOString()
    });
    assert.equal(nbcsbaPromoted.type, 'article');
    assert.equal(nbcsbaPromoted.url, 'https://www.nbcsportsbayarea.com/nfl/san-francisco-49ers/nick-bosa-sack-injury-kyle-shanahan/1980800/');
    assert.equal(nbcsbaPromoted.author, 'Matt Maiocco', 'Brand desk via-@writer attribution should credit Matt Maiocco cleanly');

    // 5. Individual writer pure self-promo link-drop (facet link) -> promotes to article
    const facetExtract = extractBlueskyBestExternalLink(
      { embed: null },
      {
        text: "Kyle Shanahan talks QBs -- in detail about the 49ers' old Kirk Cousins Plan and also agreeing that Brock Purdy is playing at an all-time level. sfstandard.com/2026/11/16/k...",
        facets: [
          {
            features: [
              {
                $type: 'app.bsky.richtext.facet#link',
                uri: 'https://sfstandard.com/2026/11/16/kyle-shanahan-brock-purdy-kirk-cousins/'
              }
            ]
          }
        ]
      }
    );
    assert.equal(facetExtract.uri, 'https://sfstandard.com/2026/11/16/kyle-shanahan-brock-purdy-kirk-cousins/');
    const tkPromoted = promoteLinkDropTweetToArticle({
      id: 'tk_bsky_1',
      type: 'tweet',
      author: 'Tim Kawakami',
      reporterId: 'tim_kawakami',
      outletId: 'sf_standard',
      outletName: 'The SF Standard',
      authorHandle: '@timkawakami',
      fullText: "Brock Purdy's apex, band of 30-something brothers, a pass rush that has to be better (right?) and other reasons the 49ers are ready to win the Super Bowl sfstandard.com/2026/11/15/4...",
      url: 'https://bsky.app/profile/timkawakami.bsky.social/post/3n2fpv762ms24',
      externalUrl: 'https://sfstandard.com/2026/11/15/49ers-super-bowl-chances-nfc-west-contenders/',
      externalTitle: 'Kawakami: 10 reasons why 49ers are ready to get to the Super Bowl — and win it',
      publishedAt: new Date().toISOString()
    });
    assert.equal(tkPromoted.type, 'article', 'Individual columnist bare-slug self-promo teaser should promote to article');
    assert.equal(tkPromoted.url, 'https://sfstandard.com/2026/11/15/49ers-super-bowl-chances-nfc-west-contenders/');

    // 6. SALIENT TWEETS WITH COMPLEMENTARY ARTICLES MUST STAY TWEETS!
    // Case 6a: Adam Schefter breaking news + "Story via @BradyHenderson:" (even when mirror bot duplicates text into externalTitle!)
    const schefterSalient = {
      id: 'schefter_bsky_salient',
      type: 'tweet',
      author: 'Adam Schefter',
      reporterId: 'adam_schefter',
      outletId: 'espn',
      outletName: 'ESPN NFL Insider',
      authorHandle: '@AdamSchefter',
      fullText: "Seahawks HC Mike Macdonald said today that Sam Darnold is still the team’s starter when healthy, and that he’a on track to play next week against the 49ers following Seattle's bye. Story via @BradyHenderson:",
      url: 'https://bsky.app/profile/adamscheftermirror.bsky.social/post/3n2hrs3pww32t',
      externalUrl: 'https://www.espn.com/nfl/story/_/id/50504531/seahawks-macdonald-optimisitic-qb-darnold-plays-bye-week',
      externalTitle: "Seahawks HC Mike Macdonald said today that Sam Darnold is still the team’s starter when healthy, and that he’a on track to play next week against the 49ers following Seattle's bye. Story via @BradyHenderson:",
      externalDescription: '',
      publishedAt: new Date().toISOString()
    };
    assert.equal(isPublicationOrBrandSocialAccount(schefterSalient), false);
    assert.equal(isArticleLinkDropTweet(schefterSalient).isLinkDrop, false, 'Salient insider tweet with Story via @... must NOT demote to article');
    assert.equal(promoteLinkDropTweetToArticle(schefterSalient).type, 'tweet');
    assert.equal(promoteLinkDropTweetToArticle(schefterSalient).externalUrl, schefterSalient.externalUrl);

    // Case 6b: Individual beat writer sharing concrete novel EPA/snap stats + complementary column link
    const maioccoStatsTweet = {
      id: 'maiocco_stats_salient',
      type: 'tweet',
      author: 'Matt Maiocco',
      reporterId: 'matt_maiocco',
      outletId: 'nbcsba',
      outletName: 'NBC Sports Bay Area',
      authorHandle: '@MaioccoNBCS',
      fullText: 'Brock Purdy posted +0.42 EPA/play and a 78.4% completion rate on play-action across 65 offensive snaps against Dallas. Full film breakdown:',
      url: 'https://x.com/MaioccoNBCS/status/2122999888777666555',
      externalUrl: 'https://www.nbcsportsbayarea.com/nfl/san-francisco-49ers/purdy-play-action-breakdown/1980999/',
      externalTitle: 'How Brock Purdy shredded Dallas in Week 10',
      publishedAt: new Date().toISOString()
    };
    assert.equal(isArticleLinkDropTweet(maioccoStatsTweet).isLinkDrop, false, 'Beat writer tweet with novel stats (+0.42 EPA/play, 78.4%, 65 snaps) must stay tweet');

    // Case 6c: Individual beat writer reporting acute injury/practice news + complementary story link
    const wagonerInjuryTweet = {
      id: 'wagoner_inj_salient',
      type: 'tweet',
      author: 'Nick Wagoner',
      reporterId: 'nick_wagoner',
      outletId: 'espn',
      outletName: 'ESPN 49ers Beat',
      authorHandle: '@nwagoner',
      fullText: 'WR Mike Evans (Achilles) is flying to Colorado Springs tonight and Kyle Shanahan hopes he returns to practice Wednesday ahead of Week 11 vs. Minnesota. Full story:',
      url: 'https://x.com/nwagoner/status/2122999888777666444',
      externalUrl: 'https://www.espn.com/nfl/story/_/id/50509999/49ers-evans-practice-week-11',
      externalTitle: '49ers Week 11 Injury Notebook',
      publishedAt: new Date().toISOString()
    };
    assert.equal(isArticleLinkDropTweet(wagonerInjuryTweet).isLinkDrop, false, 'Beat writer tweet breaking injury/practice details must stay tweet');

    // 7. Stream-level reconciliation collapses unexpanded dlvr.it Bluesky brand link-drop into matching direct RSS article
    const reconciledStream = reconcileLinkDropTweetsWithArticles([
      {
        id: 'bsky_nfltr_unexpanded',
        type: 'tweet',
        author: 'NFL Trade Rumors',
        outletId: 'nfl_trade_rumors',
        outletName: 'NFL Trade Rumors',
        authorHandle: '@nflrums',
        title: 'NFC Notes: Christian McCaffrey, Christian Parker, 49ers, Cowboys, Giants',
        fullText: 'NFC Notes: Christian McCaffrey, Christian Parker, 49ers, Cowboys, Giants',
        url: 'https://bsky.app/profile/nfltraderumors.bsky.social/post/3n2k6eqwce32q',
        externalUrl: null,
        imageUrl: 'https://cdn.bsky.app/img/feed_thumbnail/plain/did:plc:test/cmc.jpg',
        publishedAt: '2026-11-17T23:16:00Z'
      },
      {
        id: 'rss_nfltr_direct',
        type: 'article',
        author: 'NFL Trade Rumors',
        outletId: 'nfl_trade_rumors',
        outletName: 'NFL Trade Rumors',
        title: 'NFC Notes: Christian McCaffrey, Christian Parker, 49ers, Cowboys, Giants',
        summary: '49ers RB Christian McCaffrey had a massive game against Dallas.',
        url: 'https://nfltraderumors.co/nfc-notes-christian-mccaffrey-christian-parker-49ers-cowboys-giants/',
        imageUrl: '',
        publishedAt: '2026-11-17T23:14:00Z'
      }
    ]);
    assert.equal(reconciledStream.length, 1, 'Unexpanded brand Bluesky link-drop must collapse into matching direct RSS article');
    assert.equal(reconciledStream[0].type, 'article');
    assert.equal(reconciledStream[0].url, 'https://nfltraderumors.co/nfc-notes-christian-mccaffrey-christian-parker-49ers-cowboys-giants/');
    assert.equal(reconciledStream[0].imageUrl, 'https://cdn.bsky.app/img/feed_thumbnail/plain/did:plc:test/cmc.jpg', 'Reconciled article should inherit Bluesky card thumbnail when missing');

    // 8. Live Bluesky client hydrator unwraps dlvr.it via Worker /api/expand-urls and promotes directly to article!
    const origFetch = globalThis.fetch;
    try {
      globalThis.fetch = async (url, init) => {
        const u = String(url || '');
        if (u.includes('/api/expand-urls')) {
          const parsedBody = JSON.parse(init?.body || '{}');
          const expanded = {};
          for (const s of parsedBody.urls || []) {
            if (s.includes('dlvr.it/TestNfltr1')) {
              expanded[s] = 'https://nfltraderumors.co/nfc-notes-christian-mccaffrey-49ers-cowboys/';
            }
          }
          return { ok: true, json: async () => ({ expanded }) };
        }
        if (u.includes('nfltraderumors.bsky.social')) {
          return {
            ok: true,
            json: async () => ({
              feed: [
                {
                  post: {
                    uri: 'at://did:plc:nfltr/app.bsky.feed.post/3n2k6eqwce32q',
                    author: { did: 'did:plc:nfltr', handle: 'nfltraderumors.bsky.social' },
                    record: {
                      text: 'NFC Notes: Christian McCaffrey, Christian Parker, 49ers, Cowboys, Giants',
                      createdAt: new Date().toISOString()
                    },
                    embed: {
                      external: {
                        uri: 'https://dlvr.it/TestNfltr1',
                        title: 'NFC Notes: Christian McCaffrey, Christian Parker, 49ers, Cowboys, Giants',
                        description: '49ers RB Christian McCaffrey had a massive game against the Cowboys defense.'
                      }
                    }
                  }
                }
              ]
            })
          };
        }
        return { ok: true, json: async () => ({ feed: [] }) };
      };
      const liveTestData = {
        meta: { currentWeek: 11 },
        scheduleMatchup: { schedule: [] },
        roster: { players: [{ id: '3117251', name: 'Christian McCaffrey', position: 'RB', jersey: 23, recentNews: [] }] },
        news: { rawStream: [] }
      };
      const added = await hydrateLiveBlueskyBeatWire(liveTestData, {
        workerBaseUrl: 'https://mock-worker.example.com'
      });
      assert.equal(added, 1);
      assert.equal(liveTestData.news.rawStream[0].type, 'article', 'Live Bluesky dlvr.it link-drop must promote to article');
      assert.equal(
        liveTestData.news.rawStream[0].url,
        'https://nfltraderumors.co/nfc-notes-christian-mccaffrey-49ers-cowboys/',
        'Live Bluesky dlvr.it link-drop must link directly to unwrapped nfltraderumors.co article'
      );
      assert.equal(liveTestData.news.rawStream[0].externalUrl, null);
    } finally {
      globalThis.fetch = origFetch;
    }

    // 9. Daily Top News Brief upgrades inline & Sources (N) links from promoted social URL -> direct article URL + Article label
    const briefHtml = renderDailyTopNewsBriefHtml(
      {
        id: 'brief_promo_test',
        headline: '49ers Week 11 Briefing',
        generatedAt: new Date().toISOString(),
        bullets: [
          'NFC Notes: Christian McCaffrey drew leaguewide buzz after his Dallas explosion [NFL Trade Rumors](https://bsky.app/profile/nfltraderumors.bsky.social/post/3n2k6eqwce32q).'
        ],
        sources: [
          {
            type: 'tweet',
            author: 'NFL Trade Rumors',
            outlet: 'NFL Trade Rumors',
            title: 'NFC Notes: Christian McCaffrey, Christian Parker, 49ers, Cowboys, Giants',
            url: 'https://bsky.app/profile/nfltraderumors.bsky.social/post/3n2k6eqwce32q',
            publishedAt: new Date().toISOString()
          }
        ]
      },
      { rawStream: [nfltrPromoted] }
    );
    assert.ok(
      briefHtml.includes('https://nfltraderumors.co/nfc-notes-christian-mccaffrey-christian-parker-49ers-cowboys-giants/'),
      'Daily Brief inline link and Sources drawer must upgrade promoted Bluesky link-drop to direct article URL'
    );
    assert.ok(!briefHtml.includes('bsky.app/profile/nfltraderumors'), 'Daily Brief must not retain bypassed Bluesky URL');
    assert.ok(briefHtml.includes('>Article<'), 'Daily Brief Sources drawer must label promoted link-drop as Article');
  }
);

test('Digest Experience Engine: Catch-up watermark, 2-mode sort (Top default | Latest), simplified News toolbar, topic chips, story timeline, deltas, presser takeaways, effort cues & universal search', () => {
  const nowMs = Date.parse('2026-11-17T22:00:00Z');
  assert.equal(normalizeNewsSortMode(''), 'top');
  assert.equal(normalizeNewsSortMode('invalid'), 'top');
  assert.equal(normalizeNewsSortMode('hybrid'), 'top', 'Legacy hybrid sort pref must normalize to top');
  assert.equal(NEWS_SORT_MODES.length, 2);
  assert.equal(NEWS_SORT_MODES[0].key, 'top');
  assert.equal(NEWS_SORT_MODES[0].label, 'Top');
  assert.equal(NEWS_SORT_MODES[1].key, 'latest');
  assert.equal(NEWS_SORT_MODES[1].label, 'Latest');

  // 1. Catch-Up Watermark & Read State
  const sampleItems = [
    {
      id: 'item_new_1',
      type: 'tweet',
      title: 'Kyle Shanahan said Mike Evans is trending up for Week 11 practice.',
      fullText: 'Kyle Shanahan said WR Mike Evans (Achilles) is flying to Colorado Springs and could return to Wednesday practice.',
      author: 'Matt Maiocco',
      outletName: 'NBC Sports Bay Area',
      url: 'https://x.com/MaioccoNBCS/status/1001',
      publishedAt: '2026-11-17T21:30:00Z',
      storyRank: 75,
      mentionedPlayers: [{ id: '16737', name: 'Mike Evans' }]
    },
    {
      id: 'item_new_2',
      type: 'article',
      category: 'film',
      title: 'All-22 Breakdown: How Brock Purdy Dissected Two-High Shells vs Dallas',
      summary: 'Purdy posted +0.42 EPA/play off play-action motion stacks.',
      author: "JT O'Sullivan",
      outletName: 'The QB School',
      url: 'https://example.com/purdy-all22',
      publishedAt: '2026-11-17T20:15:00Z',
      storyRank: 92,
      wordCount: 1100,
      mentionedPlayers: [{ id: '4361741', name: 'Brock Purdy' }]
    },
    {
      id: 'item_old_1',
      type: 'tweet',
      title: 'John Lynch told reporters Renardo Green is day-to-day with back tightness.',
      fullText: 'John Lynch told reporters CB Renardo Green (back) remains day-to-day after Sunday.',
      author: 'Adam Schefter',
      outletName: 'ESPN',
      isNationalInsider: true,
      url: 'https://x.com/AdamSchefter/status/1002',
      publishedAt: '2026-11-17T16:00:00Z',
      storyRank: 88,
      mentionedPlayers: [{ id: '4427325', name: 'Renardo Green' }]
    }
  ];

  // First visit (no lastVisitedAt) must never show a fake watermark
  const firstVisit = computeCatchUpState(sampleItems, { lastVisitedAt: null, readKeys: [] }, nowMs);
  assert.equal(firstVisit.hasWatermark, false);
  assert.equal(firstVisit.newCount, 0);

  // Returning visit after 18:00Z sees 2 new items (item_new_1 & item_new_2)
  const returning = computeCatchUpState(
    sampleItems,
    { lastVisitedAt: '2026-11-17T18:00:00Z', readKeys: [] },
    nowMs
  );
  assert.equal(returning.hasWatermark, true);
  assert.equal(returning.newCount, 2);
  assert.equal(returning.watermarkInsertBeforeIdx, 2);

  // Marking one read reduces newCount to 1
  const readSet = new Set([getItemReadKey(sampleItems[0])]);
  assert.equal(isItemRead(sampleItems[0], readSet), true);
  const afterRead = computeCatchUpState(
    sampleItems,
    { lastVisitedAt: '2026-11-17T18:00:00Z', readKeys: readSet },
    nowMs
  );
  assert.equal(afterRead.newCount, 1);

  // 2. 2-mode Sorting (`top` default | `latest`) + legacy `hybrid` -> `top` fallback + live in-game injury pin
  const latestSorted = sortNewsFeedByMode(sampleItems, 'latest', { nowMs });
  assert.equal(latestSorted[0].id, 'item_new_1', 'Latest mode must sort strictly newest first');
  const topSorted = sortNewsFeedByMode(sampleItems, 'top', { nowMs });
  assert.equal(topSorted[0].id, 'item_new_2', 'Top mode must prioritize highest salience');
  const legacyHybridSorted = sortNewsFeedByMode(sampleItems, 'hybrid', { nowMs });
  assert.deepEqual(
    legacyHybridSorted.map(x => x.id),
    topSorted.map(x => x.id),
    'Legacy hybrid mode must match Top mode ordering'
  );
  const withLiveInj = [
    ...sampleItems,
    {
      id: 'item_live_inj',
      type: 'tweet',
      title: 'Brock Purdy heads to blue medical tent',
      publishedAt: '2026-11-17T21:55:00Z',
      isInGameInjury: true,
      breakingBadge: 'LIVE INJURY UPDATE',
      storyRank: 40
    }
  ];
  assert.equal(
    sortNewsFeedByMode(withLiveInj, 'top', { nowMs })[0].id,
    'item_live_inj',
    'Top mode must still pin live in-game urgent injuries to #1'
  );

  // 2b. Simplified News toolbar layout: Top/Latest top-left, no News & Film logo, no Scan/Rich button in News toolbar
  const renderedToolbarHtml = renderNewsViewHtml({
    appData: { roster: { players: [] }, news: {} },
    filteredRawItems: sampleItems,
    userPrefs: { feedDensity: 'rich', newsSortMode: 'top' },
    nowMs
  });
  assert.ok(!renderedToolbarHtml.includes('news-toolbar-brand'), 'News toolbar must not render News & Film brand block');
  assert.ok(!renderedToolbarHtml.includes('toggle-feed-density'), 'News toolbar must not render Scan/Rich density toggle');
  assert.ok(!renderedToolbarHtml.includes('Top + Latest'), 'News toolbar must not render Top + Latest option');
  assert.ok(!renderedToolbarHtml.includes('data-news-digest-controls'), 'Extra digest strip must be omitted when no search filter is active');
  const titleRowIdx = renderedToolbarHtml.indexOf('news-toolbar-title-row');
  const sortBarIdx = renderedToolbarHtml.indexOf('data-news-sort-bar');
  const actionsIdx = renderedToolbarHtml.indexOf('news-toolbar-actions');
  assert.ok(
    titleRowIdx > 0 && sortBarIdx > titleRowIdx && sortBarIdx < actionsIdx,
    'Top / Latest segmented control must sit on the top-left of .news-toolbar-title-row before .news-toolbar-actions'
  );
  const renderedSearchHtml = renderNewsViewHtml({
    appData: { roster: { players: [] }, news: {} },
    filteredRawItems: sampleItems,
    newsSearchQuery: 'Purdy',
    userPrefs: { feedDensity: 'rich', newsSortMode: 'top' },
    nowMs
  });
  assert.ok(
    renderedSearchHtml.includes('clear-news-search-filter'),
    'Active search query must still render clear-search pill'
  );

  // 3. Trending Topic Chips & Filtering
  const chipPool = [...sampleItems, { ...sampleItems[0], id: 'item_new_3', url: 'https://x.com/MaioccoNBCS/status/1003' }];
  const chips = extractTrendingTopicChips(chipPool, { activeCategory: 'all', nowMs });
  assert.ok(chips.some(c => c.key === 'topic:injuries'), 'Expected Injuries trending chip');
  assert.ok(chips.some(c => c.key === 'player:16737'), 'Expected Mike Evans player chip');
  const injFiltered = filterItemsByTopicChip(chipPool, 'topic:injuries');
  assert.ok(injFiltered.length >= 2 && injFiltered.length < chipPool.length);

  // 4. Story Timeline & Source-Lens Tagging
  assert.equal(classifySourceLensTag({ outletName: '49ers.com' }), 'Official');
  assert.equal(classifySourceLensTag(sampleItems[1]), 'Film');
  assert.equal(classifySourceLensTag(sampleItems[2]), 'National');
  assert.equal(classifySourceLensTag(sampleItems[0]), 'Beat');
  const timeline = buildStoryTimelineEntries(sampleItems[0], [sampleItems[2]], sampleItems);
  assert.equal(timeline.length, 2);
  assert.equal(timeline[0].id, 'item_old_1', 'Timeline must order oldest -> newest');
  assert.equal(timeline[0].timelineMarker, 'First');
  assert.equal(timeline[1].timelineMarker, 'Latest');
  assert.equal(shouldShowItemAskAiButton(sampleItems[1], 0), true);

  // 5. Directional Delta Cues
  const upTraj = computePracticeTrajectoryDelta({ wed: 'DNP', thu: 'LP', fri: 'FP', playProbabilityPct: 86 });
  assert.equal(upTraj.trajectory.direction, 'up');
  assert.equal(upTraj.displayLabel, 'DNP→FP ↑');
  const downTraj = computePracticeTrajectoryDelta({ wed: 'FP', thu: 'LP', fri: 'DNP', playProbabilityPct: 18 });
  assert.equal(downTraj.trajectory.direction, 'down');
  assert.equal(downTraj.tone, 'danger');
  const probShiftOnly = computePracticeTrajectoryDelta(
    { wed: '-', thu: '-', fri: '-', playProbabilityPct: 68 },
    { playProbabilityPct: 45 }
  );
  assert.equal(probShiftOnly.displayLabel, '+23%');
  assert.equal(formatRankDeltaCue(3, 5).text, '▲2');
  assert.equal(formatRankDeltaCue(6, 4).text, '▼2');
  assert.equal(formatRankDeltaCue(3, 3, '0'), null, 'Zero movement must return null (no noisy (0) clutter)');
  assert.equal(formatPlayoffOddsDeltaCue(86.4, 82.0).text, '+4.4%');
  assert.equal(formatPlayoffOddsDeltaCue(82.0, 82.0), null);

  // 6. Presser Takeaways Extractor
  const pressers = extractPresserTakeaways(sampleItems, { nowMs });
  assert.equal(pressers.length, 2, 'Should distill 2 distinct Shanahan + Lynch podium takeaways');
  assert.ok(pressers.some(p => p.speaker === 'Shanahan'));
  assert.ok(pressers.some(p => p.speaker === 'Lynch'));

  // 7. Reading-Time / Effort Cues & Inline Chart Preview Detection
  assert.equal(estimateItemEffortCue(sampleItems[1]), 'Film study');
  assert.equal(estimateItemEffortCue({ type: 'article', wireSource: 'espn_player_wire', title: 'Short update' }), 'Quick note');
  assert.equal(estimateItemEffortCue({ type: 'video', duration: '12:30' }), '', 'Videos already show duration');
  const chartPreview = extractInlinePreviewVisual({
    type: 'tweet',
    title: '49ers EPA/play scatter chart through Week 10',
    imageUrl: 'https://cdn.bsky.app/img/feed_thumbnail/plain/did:plc:abc/chart123'
  });
  assert.ok(chartPreview && chartPreview.isChart && chartPreview.src.includes('/img/feed_fullsize/'));
  assert.equal(
    extractInlinePreviewVisual({
      type: 'tweet',
      title: 'Mike Evans update',
      imageUrl: 'https://a.espncdn.com/i/headshots/nfl/players/full/16737.png'
    }),
    null,
    'Headshots must not trigger chart preview button'
  );

  // 8. Universal Instant Search & Push Helper
  const searchRes = runUniversalSearch('#13', {
    appData: {
      roster: {
        players: [
          { id: '4361741', name: 'Brock Purdy', position: 'QB', jersey: 13, rosterBucket: 'active' },
          { id: '16737', name: 'Mike Evans', position: 'WR', jersey: 5, rosterBucket: 'active' }
        ]
      },
      beatPodcasts: { episodes: [{ id: 'ep1', title: 'Purdy Week 10 Film Review', showName: '49ers Talk' }] }
    },
    filteredRawItems: sampleItems
  });
  assert.equal(searchRes.players[0].name, 'Brock Purdy', '#13 jersey lookup must match Brock Purdy');

  const capSearch = runUniversalSearch('cap', { appData: { roster: { players: [] } }, filteredRawItems: sampleItems });
  assert.ok(capSearch.sections.some(s => s.subTab === 'cap'), 'Searching "cap" must surface Salary Cap quick jump');
  assert.ok(urlBase64ToUint8Array('SGVsbG8').length === 5, 'Base64URL decoder must return Uint8Array');
});

test('49ers & Opponent Injury Robustness: multi-day practice prose, MNF/TNF HTML columns, status guards & trending up/down signals', () => {
  // 1. Multi-day practice prose parsing (segment-isolated, zero cross-comma corruption, speculative guard)
  assert.deepEqual(
    extractPracticeDaysFromText({ shortComment: 'Did not practice Wednesday, limited Thursday, full Friday' }),
    { wed: 'DNP', thu: 'LP', fri: 'FP' },
    'Comma-separated W/T/F progression must not corrupt Thu/Fri into DNP'
  );
  assert.deepEqual(
    extractPracticeDaysFromText({ shortComment: 'did not practice Wed/Thu, but was limited Friday' }),
    { wed: 'DNP', thu: 'DNP', fri: 'LP' },
    'Conjunction-separated Wed/Thu DNP + Fri LP must parse cleanly'
  );
  assert.deepEqual(
    extractPracticeDaysFromText({
      shortComment: "held out of Friday's practice after being limited Thursday",
      allowHeuristicFill: false
    }),
    { wed: '-', thu: 'LP', fri: 'DNP' },
    'Late-week Friday held-out after Thursday LP must parse accurately'
  );
  assert.deepEqual(
    extractPracticeDaysFromText({
      shortComment: "missed Wednesday and Thursday's practices before upgrading to limited on Friday"
    }),
    { wed: 'DNP', thu: 'DNP', fri: 'LP' }
  );
  assert.deepEqual(
    extractPracticeDaysFromText({
      shortComment: 'upgraded to a full practice Friday after being limited Wednesday and Thursday'
    }),
    { wed: 'LP', thu: 'LP', fri: 'FP' }
  );
  assert.deepEqual(
    extractPracticeDaysFromText({
      shortComment: 'is expected to be limited Friday and questionable for Sunday',
      allowHeuristicFill: false
    }),
    { wed: '-', thu: '-', fri: '-' },
    'Speculative future practice expectations must not be recorded as observed practice'
  );
  // Non-Sunday game weekday mapping (MNF Thu/Fri/Sat & TNF Mon/Tue/Wed)
  assert.deepEqual(
    extractPracticeDaysFromText({
      shortComment: 'Did not practice Thursday, limited Friday, full Saturday',
      kickoffIso: '2026-11-24T01:15:00Z', // Monday Night Football
      nowMs: Date.parse('2026-11-22T22:00:00Z')
    }),
    { wed: 'DNP', thu: 'LP', fri: 'FP' },
    'MNF Thu/Fri/Sat must map cleanly into slots 1/2/3'
  );
  assert.deepEqual(
    extractPracticeDaysFromText({
      shortComment: 'Limited Monday, full Tuesday and Wednesday',
      kickoffIso: '2026-11-20T01:15:00Z', // Thursday Night Football
      nowMs: Date.parse('2026-11-19T22:00:00Z')
    }),
    { wed: 'LP', thu: 'FP', fri: 'FP' },
    'TNF Mon/Tue/Wed must map cleanly into slots 1/2/3'
  );

  // 2. Official 49ers.com HTML Parser for MNF (Thu/Fri/Sat) & TNF (Mon/Tue/Wed) + Game-Designation flags
  const mnfHtml = `
    <section><h3>San Francisco 49ers</h3><table>
      <thead><tr><th>Player</th><th>Position</th><th>Injury</th><th>Thu</th><th>Fri</th><th>Sat</th><th>Game Status</th></tr></thead>
      <tbody>
        <tr><td>Mike Evans</td><td>WR</td><td>Achilles</td><td>DNP</td><td>LP</td><td>FP</td><td>Questionable</td></tr>
        <tr><td>Renardo Green</td><td>CB</td><td>Back</td><td>DNP</td><td>DNP</td><td>LP</td><td></td></tr>
      </tbody>
    </table></section>
    <section><h3>Minnesota Vikings</h3><table>
      <thead><tr><th>Player</th><th>Position</th><th>Injury</th><th>Thu</th><th>Fri</th><th>Sat</th><th>Game Status</th></tr></thead>
      <tbody>
        <tr><td>Justin Jefferson</td><td>WR</td><td>Hamstring</td><td>DNP</td><td>LP</td><td>LP</td><td>Questionable</td></tr>
      </tbody>
    </table></section>`;
  const mnfParsed = parseOfficial49ersInjuryReportHtml(mnfHtml, 'Minnesota Vikings');
  assert.equal(mnfParsed.hasSfReport, true);
  assert.equal(mnfParsed.hasOppReport, true);
  assert.equal(mnfParsed.hasSfGameDesignations, true);
  assert.equal(mnfParsed.hasOppGameDesignations, true);
  const sfEvansMnf = mnfParsed.sfByKey.get(canonicalPlayerKey('Mike Evans'));
  assert.deepEqual(
    { wed: sfEvansMnf?.wed, thu: sfEvansMnf?.thu, fri: sfEvansMnf?.fri },
    { wed: 'DNP', thu: 'LP', fri: 'FP' },
    'MNF Thu/Fri/Sat HTML columns must map positionally to wed/thu/fri for SF'
  );
  const oppJjMnf = mnfParsed.oppByKey.get(canonicalPlayerKey('Justin Jefferson'));
  assert.deepEqual(
    { wed: oppJjMnf?.wed, thu: oppJjMnf?.thu, fri: oppJjMnf?.fri },
    { wed: 'DNP', thu: 'LP', fri: 'LP' },
    'MNF Thu/Fri/Sat HTML columns must map positionally to wed/thu/fri for Opponent'
  );

  const tnfMidweekHtml = `
    <section><h3>San Francisco 49ers</h3><table>
      <thead><tr><th>Player</th><th>Position</th><th>Injury</th><th>Mon</th><th>Tue</th><th>Wed</th><th>Game Status</th></tr></thead>
      <tbody>
        <tr><td>Brock Purdy</td><td>QB</td><td>Toe</td><td>LP</td><td>FP</td><td></td><td></td></tr>
      </tbody>
    </table></section>`;
  const tnfParsed = parseOfficial49ersInjuryReportHtml(tnfMidweekHtml, '');
  assert.equal(tnfParsed.hasSfGameDesignations, false, 'Mid-week table with blank game statuses must report hasSfGameDesignations=false');
  const sfPurdyTnf = tnfParsed.sfByKey.get(canonicalPlayerKey('Brock Purdy'));
  assert.equal(sfPurdyTnf?.wed, 'LP');
  assert.equal(sfPurdyTnf?.thu, 'FP');
  assert.equal(sfPurdyTnf?.fri, '-');

  // 3. resolveOfficialReportGameStatus invariants (never clear Friday DNP or clobber Saturday ESPN downgrade)
  assert.equal(
    resolveOfficialReportGameStatus({
      offRec: { wed: 'DNP', thu: 'DNP', fri: 'DNP', gameStatus: '' },
      teamHasGameDesignations: true,
      existingStatus: 'Questionable',
      effectiveInjuryType: 'Hamstring',
      hasSecondaryMedical: false,
      isPureRest: false,
      espnHasDowngradeProse: false
    }),
    'Questionable',
    'Non-Rest Friday DNP with blank gameStatus must NEVER auto-clear to Active'
  );
  assert.equal(
    resolveOfficialReportGameStatus({
      offRec: { wed: 'DNP', thu: 'FP', fri: 'DNP', gameStatus: '' },
      teamHasGameDesignations: true,
      existingStatus: 'Active',
      effectiveInjuryType: 'Not Injury Related - Rest',
      hasSecondaryMedical: false,
      isPureRest: true,
      espnHasDowngradeProse: false
    }),
    'Active',
    'Pure Veteran Rest Friday DNP with blank gameStatus may cleanly resolve to Active'
  );
  assert.equal(
    resolveOfficialReportGameStatus({
      offRec: { wed: 'DNP', thu: 'LP', fri: 'LP', gameStatus: 'Questionable' },
      teamHasGameDesignations: true,
      existingStatus: 'Out',
      effectiveInjuryType: 'Achilles',
      hasSecondaryMedical: false,
      isPureRest: false,
      espnHasDowngradeProse: false
    }),
    'Out',
    'Lagging Friday 49ers.com Questionable must NEVER overwrite a live Saturday ESPN Out downgrade'
  );
  assert.equal(
    resolveOfficialReportGameStatus({
      offRec: { wed: 'LP', thu: 'LP', fri: '-', gameStatus: '' },
      teamHasGameDesignations: false,
      existingStatus: 'Questionable',
      effectiveInjuryType: 'Knee',
      hasSecondaryMedical: false,
      isPureRest: false,
      espnHasDowngradeProse: false
    }),
    'Questionable',
    'Unfinalized mid-week table with blank gameStatus must NEVER auto-clear LP to Active'
  );
  assert.equal(
    resolveOfficialReportGameStatus({
      offRec: { wed: 'LP', thu: 'FP', fri: 'FP', gameStatus: '' },
      teamHasGameDesignations: true,
      existingStatus: 'Questionable',
      effectiveInjuryType: 'Ankle',
      hasSecondaryMedical: false,
      isPureRest: false,
      espnHasDowngradeProse: false
    }),
    'Active',
    'Finalized Friday table with fri=FP and blank gameStatus cleanly clears to Active'
  );

  // 4. Trending Upward / Downward, Late Setback, Negations & Saturday Concussion Clearance
  assert.equal(hasTrendingDownwardSignal('Mike Evans is trending downward ahead of Sunday after soreness'), true);
  assert.equal(hasTrendingDownwardSignal('Suffered a setback in Friday walkthrough; uphill battle to play'), true);
  assert.equal(hasTrendingDownwardSignal('No setback for Mike Evans; feeling much better today'), false, 'Negated "no setback" must NOT fire downward signal');
  assert.equal(hasTrendingUpwardSignal('Mike Evans is trending upward and optimistic he plays Sunday'), true);
  assert.equal(hasTrendingUpwardSignal('Not trending up and not optimistic he can go this week'), false, 'Negated "not trending up" must NOT fire upward signal');
  assert.equal(hasTrendingUpwardSignal('If he is trending upward by Friday he could play'), false, 'Conditional "if he is trending upward" must NOT fire upward signal');

  const basePlayerInput = {
    name: 'Mike Evans',
    position: 'WR',
    snapPct: 86,
    gameStatus: 'Questionable',
    injuryType: 'Achilles',
    wed: 'DNP',
    thu: 'DNP',
    fri: 'LP'
  };
  const nowMs = Date.parse('2026-11-21T18:00:00Z'); // Saturday 10:00 AM PT
  const baseProb = computePlayerPlayProbability({ ...basePlayerInput, beatNote: 'Limited Friday.' });

  // Trending upward tweet (Saturday) lifts probability meaningfully
  const upSig = evaluateCorroboratedNewsInjurySignal({
    playerName: 'Mike Evans',
    newsItems: [
      {
        title: 'Mike Evans is trending upward and 49ers are optimistic he plays Sunday vs Vikings',
        author: 'Adam Schefter',
        publishedAt: '2026-11-21T17:00:00Z'
      },
      {
        title: 'Mike Evans trending in the right direction after Friday work',
        author: 'Matt Maiocco',
        publishedAt: '2026-11-21T17:15:00Z'
      }
    ],
    nowMs
  });
  assert.equal(upSig.signalType, 'TRENDING_UPWARD');
  const upProb = computePlayerPlayProbability({ ...basePlayerInput, corroboratedNewsSignal: upSig });
  assert.ok(upProb.probabilityPct >= baseProb.probabilityPct + 6, `Trending upward (${upProb.probabilityPct}%) must exceed neutral baseline (${baseProb.probabilityPct}%) by >=6 pts`);

  // Trending downward + late setback tweet (Saturday) drops probability sharply
  const downSig = evaluateCorroboratedNewsInjurySignal({
    playerName: 'Mike Evans',
    newsItems: [
      {
        title: 'Mike Evans is trending downward after suffering a late-week setback with his Achilles; uphill battle to play',
        author: 'Ian Rapoport',
        publishedAt: '2026-11-21T17:30:00Z'
      },
      {
        title: 'Mike Evans trending in the wrong direction ahead of Sunday after Friday setback',
        author: 'Matt Barrows',
        publishedAt: '2026-11-21T17:40:00Z'
      }
    ],
    nowMs
  });
  assert.equal(downSig.signalType, 'TRENDING_DOWNWARD');
  assert.equal(downSig.hasLateSetback, true);
  const downProb = computePlayerPlayProbability({ ...basePlayerInput, corroboratedNewsSignal: downSig });
  assert.ok(downProb.probabilityPct <= 30, `Late-setback trending downward must drop probability <= 30%, got ${downProb.probabilityPct}%`);

  // Opposing Head Coach quote + fresh Saturday trend beats stale Wednesday same-polarity note
  const oppTrendSig = evaluateCorroboratedNewsInjurySignal({
    playerName: 'Justin Jefferson',
    newsItems: [
      {
        title: 'Justin Jefferson did not practice Wednesday due to hamstring tightness',
        author: 'Kevin Seifert',
        publishedAt: '2026-11-18T21:00:00Z'
      },
      {
        title: "Vikings head coach Kevin O'Connell said Justin Jefferson is trending downward and facing an uphill battle to play Sunday",
        author: 'Tom Pelissero',
        publishedAt: '2026-11-21T17:20:00Z'
      }
    ],
    nowMs
  });
  assert.equal(oppTrendSig.signalType, 'TRENDING_DOWNWARD', 'Fresh Saturday opposing coach downward trend must outrank stale Wednesday DNP note');

  // Saturday concussion protocol clearance lifts Questionable concussion player >= 85%
  const concSig = evaluateCorroboratedNewsInjurySignal({
    playerName: 'Ricky Pearsall',
    newsItems: [
      {
        title: 'Ricky Pearsall has cleared concussion protocol and is good to go for Sunday',
        author: 'Matt Barrows',
        publishedAt: '2026-11-21T16:30:00Z'
      },
      {
        title: 'Ricky Pearsall cleared the NFL concussion protocol on Saturday',
        author: 'Matt Maiocco',
        publishedAt: '2026-11-21T16:40:00Z'
      }
    ],
    nowMs
  });
  assert.equal(concSig.signalType, 'CLEARED_CONCUSSION_PROTOCOL');
  const concProb = computePlayerPlayProbability({
    name: 'Ricky Pearsall',
    position: 'WR',
    snapPct: 78,
    gameStatus: 'Questionable',
    injuryType: 'Concussion',
    wed: 'DNP',
    thu: 'LP',
    fri: 'LP',
    corroboratedNewsSignal: concSig
  });
  assert.ok(concProb.probabilityPct >= 85, `Cleared concussion protocol must lift probability >= 85%, got ${concProb.probabilityPct}%`);

  // Corroborated RULED_OUT_WEEK overrides mid-week thu='LP' even when fri='-'
  const ruledOutSig = evaluateCorroboratedNewsInjurySignal({
    playerName: 'Renardo Green',
    newsItems: [
      {
        title: 'Kyle Shanahan said CB Renardo Green (back) has been ruled out for Sunday vs Vikings',
        author: 'Nick Wagoner',
        publishedAt: '2026-11-21T17:45:00Z'
      }
    ],
    nowMs
  });
  assert.equal(ruledOutSig.signalType, 'RULED_OUT_WEEK');
  const ruledOutProb = computePlayerPlayProbability({
    name: 'Renardo Green',
    position: 'CB',
    snapPct: 91,
    gameStatus: 'Questionable',
    injuryType: 'Back',
    wed: 'DNP',
    thu: 'LP',
    fri: '-',
    corroboratedNewsSignal: ruledOutSig
  });
  assert.equal(ruledOutProb.probabilityPct, 0, 'Corroborated RULED_OUT_WEEK must force 0% even when mid-week thu=LP and fri=-');
});

test('49ers & Opponent Weekly Snapshot Non-Destructive Merge, Official Slot Protection & Full Opponent Wire Reconciliation', () => {
  // 1. Mock browser localStorage to verify Friday practice is NEVER erased by a Saturday blank snapshot
  const memStore = new Map();
  const prevWindow = globalThis.window;
  globalThis.window = {
    localStorage: {
      getItem: k => (memStore.has(k) ? memStore.get(k) : null),
      setItem: (k, v) => memStore.set(k, String(v)),
      removeItem: k => memStore.delete(k)
    }
  };
  try {
    const fridayAppData = {
      meta: { seasonYear: 2026, currentWeek: 11 },
      roster: {
        players: [
          {
            id: '16737',
            name: 'Mike Evans',
            position: 'WR',
            rosterBucket: 'active',
            snapSharePct: 86,
            health: { status: 'Questionable', injuryType: 'Achilles', wed: 'DNP', thu: 'LP', fri: 'LP', playProbabilityPct: 58 }
          }
        ]
      },
      health: {
        week: 11,
        practiceReport: [
          {
            playerId: '16737',
            name: 'Mike Evans',
            position: 'WR',
            wed: 'DNP',
            thu: 'LP',
            fri: 'LP',
            injuryType: 'Achilles',
            gameStatus: 'Questionable',
            playProbabilityPct: 58,
            beatComment: 'Limited Friday.'
          }
        ]
      },
      scheduleMatchup: {
        upcomingMatchup: {
          week: 11,
          oppAbbr: 'MIN',
          kickoffIso: '2026-11-23T01:20:00Z',
          opponentHealth: {
            injuryReport: [
              {
                name: 'Justin Jefferson',
                position: 'WR',
                wed: 'DNP',
                thu: 'LP',
                fri: 'FP',
                injuryType: 'Hamstring',
                gameStatus: 'Questionable',
                playProbabilityPct: 82,
                shortComment: 'Full practice Friday.'
              }
            ],
            keyStartersHealthy: [],
            irReserve: []
          }
        }
      }
    };
    persistWeeklyPracticeSnapshot(fridayAppData);

    // Saturday morning transient upstream refresh temporarily blanks Friday (`fri: '-'`)
    const saturdayBlankAppData = JSON.parse(JSON.stringify(fridayAppData));
    saturdayBlankAppData.roster.players[0].health.fri = '-';
    saturdayBlankAppData.health.practiceReport[0].fri = '-';
    saturdayBlankAppData.scheduleMatchup.upcomingMatchup.opponentHealth.injuryReport[0].fri = '-';

    // Non-destructive save must NOT wipe Friday practice in localStorage
    persistWeeklyPracticeSnapshot(saturdayBlankAppData);

    // Hydrate into a fresh Saturday bundle -> Friday practice MUST be restored for BOTH SF & Opponent!
    const freshSatBundle = JSON.parse(JSON.stringify(saturdayBlankAppData));
    hydrateCachedWeeklyPracticeAndInactives(freshSatBundle);
    assert.equal(freshSatBundle.health.practiceReport[0].fri, 'LP', 'SF Friday practice must survive Saturday transient blank snapshot');
    assert.equal(freshSatBundle.roster.players[0].health.fri, 'LP', 'SF roster Friday practice must survive Saturday transient blank snapshot');
    assert.equal(freshSatBundle.roster.players[0].health._practiceRestoredFromCache, true);
    assert.equal(
      freshSatBundle.scheduleMatchup.upcomingMatchup.opponentHealth.injuryReport[0].fri,
      'FP',
      'Opponent Friday practice must survive Saturday transient blank snapshot'
    );
  } finally {
    if (prevWindow === undefined) delete globalThis.window;
    else globalThis.window = prevWindow;
  }

  // 2. Official `_officialSlots` protection + Full Opponent `_oppNewsWire` Reconciliation inside `reconcileRosterAndHealthWithNews`
  const nowIso = '2026-11-21T18:00:00Z'; // Saturday 10:00 AM PT
  const mockReconcileData = {
    meta: { seasonYear: 2026, currentWeek: 11, updatedAt: nowIso },
    roster: {
      players: [
        {
          id: '16737',
          name: 'Mike Evans',
          position: 'WR',
          rosterBucket: 'active',
          snapSharePct: 86,
          health: {
            isOnPracticeReport: true,
            status: 'Questionable',
            injuryType: 'Achilles',
            wed: 'DNP',
            thu: 'LP',
            fri: 'LP',
            _officialSlots: { wed: true, thu: true, fri: true },
            playProbabilityPct: 58,
            beatNote: 'Limited Friday.'
          }
        },
        {
          id: '4427325',
          name: 'Renardo Green',
          position: 'CB',
          rosterBucket: 'active',
          snapSharePct: 91,
          health: {
            status: 'Questionable',
            injuryType: 'Back',
            wed: 'DNP',
            thu: 'LP',
            fri: '-',
            playProbabilityPct: 55,
            beatNote: 'Back tightness.'
          }
        }
      ]
    },
    health: {
      week: 11,
      practiceReport: [
        {
          playerId: '16737',
          name: 'Mike Evans',
          position: 'WR',
          wed: 'DNP',
          thu: 'LP',
          fri: 'LP',
          _officialSlots: { wed: true, thu: true, fri: true },
          injuryType: 'Achilles',
          gameStatus: 'Questionable',
          playProbabilityPct: 58,
          beatComment: 'Limited Friday.'
        },
        {
          playerId: '4427325',
          name: 'Renardo Green',
          position: 'CB',
          wed: 'DNP',
          thu: 'LP',
          fri: '-',
          injuryType: 'Back',
          gameStatus: 'Questionable',
          playProbabilityPct: 55,
          beatComment: 'Back tightness.'
        }
      ],
      irAndReserveTracker: []
    },
    news: {
      rawStream: [
        // Earlier-in-the-day open-media beat tweet claiming DNP Friday MUST NOT clobber official 49ers.com fri='LP'!
        {
          id: 'sf_open_media_1',
          title: 'Mike Evans was not seen during open media portion of Friday practice',
          summary: 'Mike Evans did not practice Friday during open viewing.',
          author: 'David Lombardi',
          publishedAt: '2026-11-20T19:15:00Z'
        },
        // Corroborated Saturday ruled-out report for Renardo Green -> must sync status='Out' and 0%
        {
          id: 'sf_ruled_out_1',
          title: 'Kyle Shanahan confirms CB Renardo Green (back) is ruled out for Sunday vs Vikings',
          author: 'Matt Maiocco',
          publishedAt: '2026-11-21T17:10:00Z'
        }
      ]
    },
    _oppNewsWire: [
      // Fills missing Friday LP + upgrades bare "questionable" placeholder + applies trending upward shift for Justin Jefferson
      {
        id: 'opp_jj_1',
        title: 'Justin Jefferson was limited in Friday practice and is trending upward ahead of Sunday vs 49ers',
        summary: 'Vikings WR Justin Jefferson (hamstring) logged limited work Friday and is trending in the right direction to play.',
        author: 'Adam Schefter',
        publishedAt: '2026-11-21T16:30:00Z'
      },
      // Downgrades Brian O'Neill via trending downward + late setback + upgrades bare "out"/"questionable" note
      {
        id: 'opp_oneill_1',
        title: "Vikings RT Brian O'Neill (knee) is trending downward after a late-week setback and faces an uphill battle",
        author: 'Ian Rapoport',
        publishedAt: '2026-11-21T17:00:00Z'
      },
      // Promotes healthy starter Jonathan Greenard to Out when ruled out Saturday!
      {
        id: 'opp_greenard_1',
        title: "Vikings head coach Kevin O'Connell ruled out EDGE Jonathan Greenard (shoulder) for Sunday against the 49ers",
        author: 'Tom Pelissero',
        publishedAt: '2026-11-21T17:25:00Z'
      }
    ],
    scheduleMatchup: {
      upcomingMatchup: {
        week: 11,
        oppAbbr: 'MIN',
        opponent: 'Minnesota Vikings',
        kickoffIso: '2026-11-23T01:20:00Z',
        opponentHealth: {
          summary: { totalStarters: 22, healthyStarters: 20, startersOutOrIr: 0, overallAvailabilityScore: 95 },
          injuryReport: [
            {
              name: 'Justin Jefferson',
              position: 'WR',
              isStarter: true,
              wed: 'DNP',
              thu: 'LP',
              fri: '-',
              injuryType: 'Hamstring',
              gameStatus: 'Questionable',
              playProbabilityPct: 50,
              shortComment: 'questionable'
            },
            {
              name: "Brian O'Neill",
              position: 'OT',
              isStarter: true,
              wed: 'LP',
              thu: 'LP',
              fri: 'LP',
              injuryType: 'Knee',
              gameStatus: 'Questionable',
              playProbabilityPct: 68,
              shortComment: 'questionable'
            }
          ],
          keyStartersHealthy: [
            { name: 'Jonathan Greenard', position: 'DE', unit: 'Defense', status: 'Active' },
            { name: 'J.J. McCarthy', position: 'QB', unit: 'Offense', status: 'Active' }
          ],
          irReserve: []
        }
      }
    }
  };

  reconcileRosterAndHealthWithNews(mockReconcileData, { nowMs: Date.parse(nowIso) });

  // Verify SF official Friday LP protected from open-media tweet
  const sfEvans = mockReconcileData.health.practiceReport.find(r => r.name === 'Mike Evans');
  assert.equal(sfEvans.fri, 'LP', 'Official 49ers.com fri=LP must NOT be overwritten by earlier open-media DNP tweet');

  // Verify SF corroborated ruled-out updates status to Out & 0%
  const sfGreen = mockReconcileData.health.practiceReport.find(r => r.name === 'Renardo Green');
  assert.equal(sfGreen.playProbabilityPct, 0, 'Corroborated SF RULED_OUT_WEEK must set 0%');
  assert.equal(sfGreen.gameStatus, 'Out', 'Corroborated SF RULED_OUT_WEEK must sync gameStatus to Out');
  assert.equal(mockReconcileData.roster.players[1].health.status, 'Out');

  // Verify Opponent Friday LP filled, bare "questionable" upgraded, and trending upward lifted probability
  const oh = mockReconcileData.scheduleMatchup.upcomingMatchup.opponentHealth;
  const oppJj = oh.injuryReport.find(r => r.name === 'Justin Jefferson');
  assert.equal(oppJj.fri, 'LP', 'Opponent blank Friday slot must be filled from _oppNewsWire');
  assert.ok(oppJj.playProbabilityPct >= 66, `Opponent trending upward + Fri LP must lift probability >= 66%, got ${oppJj.playProbabilityPct}%`);
  assert.ok(oppJj.shortComment.length > 20 && !/^questionable$/i.test(oppJj.shortComment), 'Bare "questionable" opponent comment must be upgraded from wire');

  // Verify Opponent trending downward + setback dropped probability sharply (from 81% OT baseline -> Long Shot <= 45%)
  const oppOneill = oh.injuryReport.find(r => r.name === "Brian O'Neill");
  assert.ok(oppOneill.playProbabilityPct <= 45, `Opponent trending downward setback must drop probability <= 45%, got ${oppOneill.playProbabilityPct}%`);

  // Verify newly ruled-out Opponent starter promoted out of keyStartersHealthy into injuryReport at 0% Out
  const oppGreenard = oh.injuryReport.find(r => r.name === 'Jonathan Greenard');
  assert.ok(oppGreenard, 'Newly ruled-out Opponent starter must be promoted to opponentHealth.injuryReport');
  assert.equal(oppGreenard.playProbabilityPct, 0);
  assert.equal(oppGreenard.gameStatus, 'Out');
  assert.ok(!oh.keyStartersHealthy.some(s => s.name === 'Jonathan Greenard'), 'Promoted injured starter must be removed from keyStartersHealthy');
  assert.ok(oh.summary.overallAvailabilityScore < 95, 'Opponent Availability Index must recompute downward after starter ruled out');
});

await testAsync('hydrateLiveEspnOverlay protects live ESPN-designated SF injuries & Saturday downgrades from lagging 49ers.com HTML', async () => {
  const origFetch = globalThis.fetch;
  try {
    const friKickoffIso = new Date(Date.now() + 30 * 3600_000).toISOString(); // Saturday (~30h before kickoff)
    const appData = {
      meta: { seasonYear: 2026, currentWeek: 11, updatedAt: new Date().toISOString() },
      roster: {
        players: [
          {
            id: '16737',
            name: 'Mike Evans',
            position: 'WR',
            jersey: 5,
            rosterBucket: 'active',
            snapSharePct: 86,
            health: { status: 'Questionable', injuryType: 'Achilles', wed: 'DNP', thu: 'LP', fri: 'LP', playProbabilityPct: 58 }
          },
          {
            id: '4427325',
            name: 'Renardo Green',
            position: 'CB',
            jersey: 0,
            rosterBucket: 'active',
            snapSharePct: 91,
            health: { status: 'Active', injuryType: 'None', wed: '-', thu: '-', fri: '-', playProbabilityPct: 95 }
          }
        ]
      },
      health: {
        week: 11,
        practiceReport: [
          {
            playerId: '16737',
            name: 'Mike Evans',
            position: 'WR',
            wed: 'DNP',
            thu: 'LP',
            fri: 'LP',
            injuryType: 'Achilles',
            gameStatus: 'Questionable',
            playProbabilityPct: 58,
            beatComment: 'Limited Friday.'
          }
        ],
        irAndReserveTracker: []
      },
      news: { rawStream: [] },
      scheduleMatchup: {
        upcomingMatchup: {
          week: 11,
          oppAbbr: 'MIN',
          opponent: 'Minnesota Vikings',
          kickoffIso: friKickoffIso,
          opponentHealth: { injuryReport: [], keyStartersHealthy: [], irReserve: [] }
        },
        games: []
      }
    };

    // Mock ESPN live feed: Saturday downgrade for Mike Evans -> Out AND late Saturday add for Renardo Green -> Questionable
    // Mock 49ers.com HTML: LAGGING Friday table (Mike Evans still Questionable; Renardo Green completely missing!)
    const lagging49ersHtml = `
      <section><h3>San Francisco 49ers</h3><table>
        <thead><tr><th>Player</th><th>Position</th><th>Injury</th><th>Wed</th><th>Thu</th><th>Fri</th><th>Game Status</th></tr></thead>
        <tbody>
          <tr><td>Mike Evans</td><td>WR</td><td>Achilles</td><td>DNP</td><td>LP</td><td>LP</td><td>Questionable</td></tr>
        </tbody>
      </table></section>`;

    globalThis.fetch = async url => {
      const u = String(url || '');
      if (u.includes('site.api.espn.com/apis/site/v2/sports/football/nfl/injuries')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            injuries: [
              {
                id: '25',
                displayName: 'San Francisco 49ers',
                injuries: [
                  {
                    status: 'Out',
                    date: new Date().toISOString(),
                    details: { type: 'Achilles' },
                    shortComment: 'Downgraded to Out on Saturday after Achilles tightened up overnight.',
                    athlete: { id: '16737', displayName: 'Mike Evans', position: { abbreviation: 'WR' } }
                  },
                  {
                    status: 'Questionable',
                    date: new Date().toISOString(),
                    details: { type: 'Back' },
                    shortComment: 'Added to the Saturday injury report as questionable with back tightness.',
                    athlete: { id: '4427325', displayName: 'Renardo Green', position: { abbreviation: 'CB' } }
                  }
                ]
              }
            ]
          })
        };
      }
      if (u.includes('49ers.com/team/injury-report') || u.includes('api.allorigins.win') || u.includes('corsproxy.io') || u.includes('api.codetabs.com')) {
        return { ok: true, status: 200, text: async () => lagging49ersHtml };
      }
      return { ok: false, status: 404, json: async () => ({}), text: async () => '' };
    };

    await hydrateLiveEspnOverlay(appData);

    const evansRow = appData.health.practiceReport.find(r => r.name === 'Mike Evans');
    const greenRow = appData.health.practiceReport.find(r => r.name === 'Renardo Green');
    assert.ok(evansRow, 'Mike Evans must remain on practiceReport');
    assert.equal(evansRow.gameStatus, 'Out', 'Lagging Friday 49ers.com Questionable must NOT revert live Saturday ESPN Out downgrade');
    assert.equal(evansRow.playProbabilityPct, 0, 'Downgraded Out player must compute 0%');
    assert.equal(evansRow.fri, 'LP', 'Friday practice participation must be preserved alongside Saturday Out downgrade');

    assert.ok(greenRow, 'Renardo Green explicitly added on live ESPN must NOT be wiped by lagging 49ers.com HTML');
    assert.equal(greenRow.gameStatus, 'Questionable');
    assert.ok(greenRow.playProbabilityPct < 90, `Late Saturday Questionable add must stay injured (<90%), got ${greenRow.playProbabilityPct}%`);
  } finally {
    globalThis.fetch = origFetch;
  }
});

test('Top-only Similar Stories grouping collapses paraphrased multi-outlet coverage (Nick Bosa sack drought), keeps Latest chronological, and guards against false merges & roundup rank inflation', () => {
  const nowMs = Date.parse('2026-11-18T22:00:00Z');
  const sampleFeed = [
    {
      id: 'bosa_wagoner',
      type: 'article',
      outletName: 'ESPN',
      author: 'Nick Wagoner',
      trustTier: 1,
      signalScore: 80,
      title: "Niners' Nick Bosa on 4-game sack drought: 'Don't think I'm playing my best'",
      summary: "Niners star Nick Bosa acknowledged his performance this season, including four straight games with no sacks, hasn't been up to his usual standard.",
      publishedAt: '2026-11-18T18:00:00Z',
      url: 'https://www.espn.com/nfl/story/_/id/4900001/nick-bosa-sack-drought',
      mentionedPlayers: [{ id: 'bosa', name: 'Nick Bosa' }]
    },
    {
      id: 'bosa_chan',
      type: 'article',
      outletName: 'NBC Sports Bay Area',
      author: 'Jennifer Lee Chan',
      trustTier: 1,
      signalScore: 76,
      title: '49ers star Nick Bosa makes honest admission about slow start to 2026 NFL season',
      summary: "San Francisco 49ers defensive end Nick Bosa knows he's not playing his best football as his first sack of the 2026 NFL season eludes him.",
      publishedAt: '2026-11-18T18:05:00Z',
      url: 'https://www.nbcsportsbayarea.com/nfl/san-francisco-49ers/nick-bosa-honest-admission/1001/',
      mentionedPlayers: [{ id: 'bosa', name: 'Nick Bosa' }]
    },
    {
      id: 'bosa_pft',
      type: 'article',
      outletName: 'ProFootballTalk',
      author: 'ProFootballTalk',
      trustTier: 2,
      signalScore: 72,
      title: "Nick Bosa: I don't think I've played my best football",
      summary: "49ers defensive end Nick Bosa's only stats in Sunday's 46-40 win over the Cowboys were one quarterback hit, four pressures and three penalties in 34 snaps.",
      publishedAt: '2026-11-18T21:00:00Z',
      url: 'https://www.nbcsports.com/nfl/profootballtalk/rumor-mill/news/nick-bosa-best-football',
      mentionedPlayers: [{ id: 'bosa', name: 'Nick Bosa' }]
    },
    {
      id: 'bosa_pft_dup_url',
      type: 'article',
      outletName: 'ProFootballTalk',
      author: 'ProFootballTalk',
      trustTier: 2,
      signalScore: 72,
      title: "Nick Bosa: I don't think I've played my best football",
      summary: 'Exact duplicate URL should always be deduplicated even in Latest.',
      publishedAt: '2026-11-18T21:00:00Z',
      url: 'https://www.nbcsports.com/nfl/profootballtalk/rumor-mill/news/nick-bosa-best-football?utm_source=test',
      mentionedPlayers: [{ id: 'bosa', name: 'Nick Bosa' }]
    },
    {
      id: 'height_feature',
      type: 'article',
      outletName: '49ers Webzone',
      author: '49ers Webzone',
      trustTier: 2,
      signalScore: 74,
      title: "Can Romello Height Spark the 49ers' Pass Rush?",
      summary: 'There has been a lot said recently about the 49ers pass rush while Nick Bosa works back from injury.',
      publishedAt: '2026-11-18T19:00:00Z',
      url: 'https://www.49erswebzone.com/articles/romello-height-pass-rush/',
      mentionedPlayers: [{ id: 'height', name: 'Romello Height' }, { id: 'bosa', name: 'Nick Bosa' }]
    },
    {
      id: 'allen_debut_art',
      type: 'article',
      outletName: '49ers Webzone',
      author: '49ers Webzone',
      trustTier: 2,
      signalScore: 73,
      title: "WR Keenan Allen shines in San Francisco 49ers debut, adding to exciting potential of team's offense",
      summary: 'Keenan Allen made an immediate impact in his 49ers debut, giving Brock Purdy another weapon.',
      publishedAt: '2026-11-18T16:00:00Z',
      url: 'https://www.49erswebzone.com/articles/keenan-allen-debut/',
      mentionedPlayers: [{ id: 'purdy', name: 'Brock Purdy' }, { id: 'allen', name: 'Keenan Allen' }]
    },
    {
      id: 'allen_play_tweet',
      type: 'tweet',
      outletName: 'NBC Sports Bay Area',
      author: 'Matt Maiocco',
      trustTier: 1,
      signalScore: 70,
      title: 'Third and 12, Brock Purdy escapes the rush and finds Keenan Allen for 23.',
      fullText: 'Third and 12, Brock Purdy escapes the rush and finds Keenan Allen for 23.',
      publishedAt: '2026-11-18T15:30:00Z',
      url: 'https://x.com/MaioccoNBCS/status/999000111222333',
      mentionedPlayers: [{ id: 'purdy', name: 'Brock Purdy' }, { id: 'allen', name: 'Keenan Allen' }]
    },
    {
      id: 'pr_1',
      type: 'article',
      outletName: '49ers.com Official',
      author: '49ers.com Official',
      trustTier: 1,
      signalScore: 68,
      title: 'Power Rankings: Where the 49ers Stand Entering Week 11',
      summary: 'National Week 11 NFL power rankings roundup.',
      publishedAt: '2026-11-18T20:00:00Z',
      url: 'https://www.49ers.com/news/power-rankings-week-11'
    },
    {
      id: 'pr_2',
      type: 'article',
      outletName: '49ers Webzone',
      author: '49ers Webzone',
      trustTier: 2,
      signalScore: 65,
      title: '49ers in Week 11 power rankings: Massive test ahead vs. Vikings',
      summary: 'National analysts weigh in on Week 11 power rankings.',
      publishedAt: '2026-11-18T19:30:00Z',
      url: 'https://www.49erswebzone.com/articles/week-11-power-rankings/'
    },
    {
      id: 'pr_3',
      type: 'article',
      outletName: 'NBC Sports Bay Area',
      author: 'NBC Sports Bay Area',
      trustTier: 1,
      signalScore: 66,
      title: 'Where NFL-best 49ers sit in the Week 11 power rankings after road win',
      summary: 'Where the 49ers land in NFL Week 11 power rankings.',
      publishedAt: '2026-11-18T19:00:00Z',
      url: 'https://www.nbcsportsbayarea.com/nfl/san-francisco-49ers/week-11-power-rankings/1002/'
    }
  ];

  // 1. Grouped (Top default): 3 Bosa articles -> 1 similar cluster; 3 Power Rankings -> 1 low-salience roundup cluster; Height & Allen tweet stay distinct
  const grouped = deduplicateAndGroupWireItems(sampleFeed, { nowMs, groupSimilarStories: true });
  const bosaCluster = grouped.find(it => it.id === 'bosa_wagoner');
  assert.ok(bosaCluster, 'Nick Wagoner ESPN article should lead the Nick Bosa cluster');
  assert.equal(bosaCluster.clusterKind, 'similar', 'Nick Bosa quote cluster must be classified as similar');
  assert.equal(bosaCluster.confirmingReports?.length, 2, 'Both Jennifer Lee Chan and ProFootballTalk articles must fold into Similar stories');
  assert.ok(grouped.some(it => it.id === 'height_feature'), 'Distinct Romello Height pass-rush feature must NOT be swallowed into Nick Bosa cluster');
  assert.ok(grouped.some(it => it.id === 'allen_debut_art') && grouped.some(it => it.id === 'allen_play_tweet'), '1-play Purdy-to-Allen tweet must NOT falsely merge into Keenan Allen debut recap');

  const prCluster = grouped.find(it => it.id === 'pr_1');
  assert.ok(prCluster, 'Power Rankings roundup should consolidate under 49ers.com lead');
  assert.equal(prCluster.confirmingReports?.length, 2, '3 Week 11 Power Rankings roundups must consolidate into 1 card + 2 similar stories');
  assert.equal(prCluster._isLowSalienceRoundupCluster, true, 'Power Rankings cluster must be flagged as low-salience roundup to prevent corroboration rank inflation');

  // 2. Flat (Latest or Setting OFF): deduplicates exact URL only, preserves all 3 Bosa articles flat with zero confirmingReports
  const flat = deduplicateAndGroupWireItems(sampleFeed, { nowMs, groupSimilarStories: false });
  assert.equal(flat.length, sampleFeed.length - 1, 'Flat mode must remove exact duplicate URL only and keep all distinct stories separate');
  assert.ok(flat.every(it => (it.confirmingReports?.length || 0) === 0), 'Flat mode must never hide items inside confirmingReports');

  // 3. View rendering: Top + groupSimilarStories=true shows Google News-style Similar stories drawer; Latest & Top(false) stay flat
  const minimalAppData = { roster: { players: [] }, news: { rawStream: sampleFeed }, schedule: { games: [] } };
  const topGroupedHtml = renderNewsViewHtml({
    appData: minimalAppData,
    newsCategoryFilter: 'articles',
    newsSortMode: 'top',
    filteredRawItems: sampleFeed,
    userPrefs: { groupSimilarStories: true },
    nowMs
  });
  assert.ok(topGroupedHtml.includes('Similar stories (2)'), 'Top grouped Articles view must render Similar stories (2) drawer for Nick Bosa cluster');
  assert.ok(topGroupedHtml.includes('data-similar-story-row') && topGroupedHtml.includes('synthesis-source-sheet-row'), 'Similar stories drawer must use the clean Brief Sources row UI');
  assert.ok(!topGroupedHtml.includes('Confirming reports'), 'Grouped drawers must consolidate to Similar stories (no Confirming reports label)');
  assert.ok(!topGroupedHtml.includes('All Coverage') && !topGroupedHtml.includes('Timeline ▾'), 'Grouped drawer header must not render redundant All Coverage / Timeline right-side carets');

  // Verify corroboration clusters (e.g. injury/practice reports) ALSO consolidate cleanly to `Similar stories (N)`
  const corroborationClusterHtml = renderNewsViewHtml({
    appData: minimalAppData,
    newsCategoryFilter: 'tweets',
    newsSortMode: 'top',
    filteredRawItems: [
      {
        id: 'evans_prac_1',
        type: 'tweet',
        category: 'injury',
        author: 'Matt Barrows',
        outletName: 'The Athletic',
        trustTier: 1,
        mentionedPlayers: [{ id: '16737', name: 'Mike Evans' }],
        title: 'Mike Evans is hoping to return to practice this week per Kyle Shanahan.',
        fullText: 'Mike Evans is hoping to return to practice this week per Kyle Shanahan.',
        url: 'https://x.com/mattbarrows/status/2199100000000000001',
        publishedAt: new Date(nowMs - 2 * 3_600_000).toISOString()
      },
      {
        id: 'evans_prac_2',
        type: 'tweet',
        category: 'injury',
        author: 'Jennifer Lee Chan',
        outletName: 'NBC Sports Bay Area',
        trustTier: 1,
        mentionedPlayers: [{ id: '16737', name: 'Mike Evans' }],
        title: '#49ers WR Mike Evans is flying in tonight — Shanahan hopes to get him back in practice this week.',
        fullText: '#49ers WR Mike Evans is flying in tonight — Shanahan hopes to get him back in practice this week.',
        url: 'https://x.com/jenniferleechan/status/2199100000000000002',
        publishedAt: new Date(nowMs - 1.5 * 3_600_000).toISOString()
      }
    ],
    userPrefs: { groupSimilarStories: true },
    nowMs
  });
  assert.ok(
    corroborationClusterHtml.includes('data-cluster-kind="corroboration"') &&
      corroborationClusterHtml.includes('Similar stories (1)') &&
      !corroborationClusterHtml.includes('Confirming reports') &&
      !corroborationClusterHtml.includes('story-timeline-marker'),
    'Injury/corroboration clusters must also render unified Similar stories (N) label without Timeline/FIRST/LATEST clutter'
  );

  // Verify video cards render `Similar stories (N)` BELOW `.video-embed-box` in both News & Film and Player Cards
  const videoWithSimilar = {
    id: 'vid_clip_similar',
    type: 'video',
    isHighlightClip: true,
    videoStreamUrl: 'https://video.twimg.com/ext_tw_video/199999/pu/vid/avc1/1280x720/clip.mp4',
    imageUrl: 'https://pbs.twimg.com/ext_tw_video_thumb/199999/pu/img/poster.jpg',
    duration: '0:37',
    author: 'Jon Machota',
    outletName: 'The Athletic',
    title: 'Cowboys owner Jerry Jones not surprised to see so many 49ers fans inside AT&T Stadium today',
    url: 'https://x.com/jonmachota/status/2199200000000000001',
    publishedAt: new Date(nowMs - 3 * 3_600_000).toISOString(),
    confirmingReports: [
      {
        id: 'vid_rel_1',
        type: 'article',
        author: '49ers Webzone',
        outletName: '49ers Webzone',
        title: 'Jerry Jones reacts to 49ers fan takeover at AT&T Stadium',
        url: 'https://www.49erswebzone.com/articles/999002-jerry-jones-fans/',
        publishedAt: new Date(nowMs - 2 * 3_600_000).toISOString()
      }
    ]
  };
  const wireVideoHtml = renderWireItemCardHtml(videoWithSimilar, { prioritizedRaw: [videoWithSimilar] });
  const wireVideoIdx = wireVideoHtml.indexOf('video-embed-box');
  const wireSimilarIdx = wireVideoHtml.indexOf('data-similar-stories="true"');
  assert.ok(
    wireVideoIdx > -1 && wireSimilarIdx > wireVideoIdx,
    'News & Film video cards must render Similar stories drawer BELOW the inline video box'
  );

  const playerVideoHtml = renderInjuryNewsItemCardHtml(videoWithSimilar, { directPosts: [videoWithSimilar] });
  const playerVideoIdx = playerVideoHtml.indexOf('video-embed-box');
  const playerSimilarIdx = playerVideoHtml.indexOf('data-similar-stories="true"');
  assert.ok(
    playerVideoIdx > -1 && playerSimilarIdx > playerVideoIdx,
    'Player Card video items must render Similar stories drawer BELOW the inline video box'
  );

  const topUngroupedHtml = renderNewsViewHtml({
    appData: minimalAppData,
    newsCategoryFilter: 'articles',
    newsSortMode: 'top',
    filteredRawItems: sampleFeed,
    userPrefs: { groupSimilarStories: false },
    nowMs
  });
  assert.ok(!topUngroupedHtml.includes('data-similar-stories="true"'), 'Top view with groupSimilarStories=false must render zero Similar stories drawers');
  assert.ok(topUngroupedHtml.includes('honest admission') && topUngroupedHtml.includes("played my best football"), 'All 3 Nick Bosa articles must render flat when Top grouping is disabled');

  const latestHtml = renderNewsViewHtml({
    appData: minimalAppData,
    newsCategoryFilter: 'articles',
    newsSortMode: 'latest',
    filteredRawItems: sampleFeed,
    userPrefs: { groupSimilarStories: true },
    nowMs
  });
  assert.ok(!latestHtml.includes('data-similar-stories="true"'), 'Latest chronological wire must never group stories even when Top grouping setting is ON');
});

await testAsync(
  'Unified Player Card & News Engine: shared userPrefs (hot-take/outlet/strictAnalytics), Top/Latest toggle (>=5 vs <5), video inclusion, and full-pool Latest slicing',
  async () => {
    const { isItemAllowedByUserPrefs } = await import('../src/engine/antiFluffFilter.js');
    const { rankPlayerOverviewMentions, rankPlayerInjuryNews } = await import('../src/engine/injuryProbabilityModel.js');
    const { renderPlayerDossierSheetHtml } = await import('../src/views/playerSheetView.js');

    const nowMs = Date.parse('2026-11-19T18:00:00Z');
    const reportersData = JSON.parse(fs.readFileSync(path.join(rootDir, 'data', 'reporters.json'), 'utf8'));
    const reportersById = new Map((reportersData.reporters || []).map(r => [r.id, r]));

    const purdy = {
      id: '4361741',
      name: 'Brock Purdy',
      position: 'QB',
      unit: 'Offense',
      rosterBucket: 'active',
      displayHeight: '6-1',
      displayWeight: '220 lbs',
      age: 26,
      college: 'Iowa State',
      draftInfo: '2022 Rd 7 (#262)',
      primarySnapPct: 99,
      capHit2026: 53_000_000,
      health: { status: 'Questionable', injuryType: 'Ankle', playProbabilityPct: 86, playBadgeLabel: '86% • Likely', wed: 'LP', thu: 'FP', fri: '-' },
      recentNews: [
        // Item without reporterId/outletId (simulating legacy recentNews) from hot-take personality Grant Cohn
        {
          id: 'hot_take_no_id',
          type: 'tweet',
          author: 'Grant Cohn',
          outletName: 'YouTube',
          title: 'Brock Purdy (ankle) practice hot take after Thursday session',
          fullText: 'Brock Purdy (ankle) practice hot take after Thursday session',
          url: 'https://x.com/grantcohn/status/2199000000000000001',
          publishedAt: new Date(nowMs - 45 * 60_000).toISOString()
        }
      ]
    };

    const syntheticStream = [
      // 1. High-signal All-22 film video (6h old) -> MUST be included in Overview & rank near top in `top` mode
      {
        id: 'qb_school_video',
        type: 'video',
        category: 'film',
        videoId: 'qbsPurdyWk10',
        embeddable: true,
        author: 'The QB School',
        reporterId: 'jt_osullivan',
        outletId: 'youtube_film',
        outletName: 'The QB School',
        trustTier: 1,
        signalScore: 95,
        title: 'Brock Purdy vs the Cowboys Week 10, 2026 All-22 Analysis',
        url: 'https://www.youtube.com/watch?v=qbsPurdyWk10',
        publishedAt: new Date(nowMs - 6 * 3_600_000).toISOString()
      },
      // 2. Primary Tier-1 milestone/film article (5h old)
      {
        id: 'maiocco_film_art',
        type: 'article',
        category: 'film',
        author: 'Matt Maiocco',
        reporterId: 'matt_maiocco',
        outletId: 'nbcsba',
        outletName: 'NBC Sports Bay Area',
        trustTier: 1,
        signalScore: 92,
        title: 'Brock Purdy reaches 100 career passing touchdowns while dissecting two-high coverage shells',
        url: 'https://www.nbcsportsbayarea.com/nfl/san-francisco-49ers/purdy-100-tds-test/',
        publishedAt: new Date(nowMs - 5 * 3_600_000).toISOString()
      },
      // 3. Brand-new (10m old) mock-draft fluff -> low rank in `top`, #1 in `latest`!
      {
        id: 'newest_mock_draft',
        type: 'article',
        category: 'beat',
        author: '49ers Webzone',
        outletId: '49ers_webzone',
        outletName: '49ers Webzone',
        trustTier: 2,
        signalScore: 52,
        title: '49ers add offensive line protection for Brock Purdy in 3-round 2027 NFL mock draft',
        url: 'https://www.49erswebzone.com/articles/999001-purdy-mock-draft/',
        publishedAt: new Date(nowMs - 10 * 60_000).toISOString()
      },
      // 4. Fresh 2h injury/practice tweet (Tier 1)
      {
        id: 'barrows_ankle_prac',
        type: 'tweet',
        category: 'injury',
        author: 'Matt Barrows',
        reporterId: 'matt_barrows',
        outletId: 'athletic',
        outletName: 'The Athletic',
        trustTier: 1,
        signalScore: 88,
        title: 'Brock Purdy (ankle) was a full participant in Thursday practice and moved cleanly in individual drills.',
        fullText: 'Brock Purdy (ankle) was a full participant in Thursday practice and moved cleanly in individual drills.',
        url: 'https://x.com/mattbarrows/status/2199000000000000002',
        publishedAt: new Date(nowMs - 2 * 3_600_000).toISOString()
      },
      // 5. 3h old primary X quote tweet
      {
        id: 'wagoner_quote_tw',
        type: 'tweet',
        category: 'beat',
        author: 'Nick Wagoner',
        reporterId: 'nick_wagoner',
        outletId: 'espn',
        outletName: 'ESPN',
        trustTier: 1,
        signalScore: 84,
        title: 'Brock Purdy on third-down red-zone sequencing ahead of Seattle matchup.',
        fullText: 'Brock Purdy on third-down red-zone sequencing ahead of Seattle matchup.',
        url: 'https://x.com/nwagoner/status/2199000000000000003',
        publishedAt: new Date(nowMs - 3 * 3_600_000).toISOString()
      },
      // 6. 8h old article (ensures >=5 mentions even after muting hot takes)
      {
        id: 'lombardi_epa_art',
        type: 'article',
        category: 'analytics',
        author: 'David Lombardi',
        reporterId: 'david_lombardi',
        outletId: 'sf_standard',
        outletName: 'The SF Standard',
        trustTier: 1,
        signalScore: 90,
        title: 'Brock Purdy leads NFL in EPA per dropback and CPOE over the past four weeks',
        url: 'https://sfstandard.com/sports/brock-purdy-epa-cpoe-test/',
        publishedAt: new Date(nowMs - 8 * 3_600_000).toISOString()
      },
      // 7. 7.5-day-old article -> MUST be excluded by strict 7-day window (`maxAgeDays: 7`)
      {
        id: 'expired_7_5d_art',
        type: 'article',
        author: 'Cam Inman',
        reporterId: 'cam_inman',
        outletId: 'bay_area_news',
        outletName: 'Mercury News',
        trustTier: 1,
        title: 'Brock Purdy reflects on early-season rhythm eight days ago',
        url: 'https://www.nbcsportsbayarea.com/nfl/san-francisco-49ers/purdy-8d-old-test/',
        publishedAt: new Date(nowMs - 7.5 * 86_400_000).toISOString()
      }
    ];

    // 1. Unified userPrefs check: muteHotTakePersonalities blocks Grant Cohn (styleTag === 'opinion-hot-take')
    //    even without explicit reporterId, across isItemAllowedByUserPrefs, Overview, and Injury News!
    assert.equal(
      isItemAllowedByUserPrefs(purdy.recentNews[0], reportersById, { muteHotTakePersonalities: true }),
      false,
      'isItemAllowedByUserPrefs must mute opinion-hot-take reporters even when reporterId is absent on player.recentNews'
    );

    const mutedPrefs = { muteHotTakePersonalities: true, disabledReporterIds: [], disabledOutlets: [] };
    const topMentions = rankPlayerOverviewMentions(purdy, {
      rawStream: syntheticStream,
      userPrefs: mutedPrefs,
      reportersById,
      nowMs,
      maxAgeDays: 7,
      maxItems: 10,
      sortMode: 'top'
    });
    assert.equal(topMentions.some(m => m.id === 'hot_take_no_id'), false, 'Overview mentions must hide hot-take personalities when muteHotTakePersonalities is enabled');
    assert.equal(topMentions.some(m => m.id === 'expired_7_5d_art'), false, 'Overview mentions must strictly enforce 7-day window');
    assert.equal(topMentions.some(m => m.id === 'qb_school_video' && m.type === 'video'), true, 'Overview mentions must surface high-signal All-22 film videos');
    assert.notEqual(topMentions[0].id, 'newest_mock_draft', 'Top sort must NOT let a 10m-old mock draft outrank primary film/injury/beat coverage');
    assert.equal(topMentions.length, 6, `Expected 6 valid 7d mentions after muting Grant Cohn & pruning >7d, got ${topMentions.length}`);

    const injMuted = rankPlayerInjuryNews(purdy, {
      rawStream: syntheticStream,
      userPrefs: mutedPrefs,
      reportersById,
      nowMs
    });
    assert.equal(injMuted.some(m => m.id === 'hot_take_no_id'), false, 'Injury News must also honor muteHotTakePersonalities via unified filter');
    assert.equal(injMuted.some(m => m.id === 'barrows_ankle_prac'), true, 'Injury News must retain verified Tier-1 ankle practice update');

    // 2. Latest mode sorts strictly newest-first across the full deduplicated 7d pool BEFORE slicing `maxItems`!
    const latestMentions = rankPlayerOverviewMentions(purdy, {
      rawStream: syntheticStream,
      userPrefs: mutedPrefs,
      reportersById,
      nowMs,
      maxAgeDays: 7,
      maxItems: 3, // tighter cap than pool size (6) to prove Latest sorts BEFORE slicing!
      sortMode: 'latest'
    });
    assert.equal(latestMentions[0].id, 'newest_mock_draft', 'Latest sort must surface the newest 10m-old item #1 even when maxItems < pool size');
    assert.equal(latestMentions[1].id, 'barrows_ankle_prac', 'Latest sort must order strictly chronologically (#2 = 2h old)');
    assert.equal(latestMentions[2].id, 'wagoner_quote_tw', 'Latest sort must order strictly chronologically (#3 = 3h old)');

    // 3. UI Threshold: >=5 mentions renders compact Top|Latest toggle inline in header; <5 omits it!
    const sheetGe5Html = renderPlayerDossierSheetHtml({
      player: purdy,
      activeTab: 'overview',
      mentionsSortMode: 'latest',
      rawStream: syntheticStream,
      userPrefs: mutedPrefs,
      reportersById
    });
    assert.ok(sheetGe5Html.includes('data-player-mentions-sort-bar'), 'Player with >=5 mentions in 7d must render Top|Latest toggle');
    assert.ok(
      sheetGe5Html.includes('data-action="set-player-mentions-sort"') &&
        sheetGe5Html.includes('data-mentions-sort-mode="latest"'),
      'Player mentions sort toggle must reflect active Latest state'
    );

    const sheetLt5Html = renderPlayerDossierSheetHtml({
      player: { ...purdy, recentNews: [] },
      activeTab: 'overview',
      mentionsSortMode: 'top',
      rawStream: syntheticStream.slice(0, 4),
      userPrefs: mutedPrefs,
      reportersById
    });
    assert.equal(
      sheetLt5Html.includes('data-player-mentions-sort-bar'),
      false,
      'Player with <5 mentions in 7d must NOT render Top|Latest toggle'
    );
  }
);

test(
  'Wire Summary Bounding, Direct-Article Sanitizer & Rare Expandable Disclosure (>450 chars)',
  () => {
    // 1. buildBoundedWireSummary cleans HTML-strip punctuation spacing and stops cleanly on sentence/word boundary
    const messyEspnBody =
      "COLORADO SPRINGS, Colo. -- As wide receiver Mike Evans works his way back from Achilles tendinitis , nobody in the San Francisco 49ers ' locker room knows better how frustrating that injury can be than running back Christian McCaffrey . In 2024, McCaffrey missed the first eight games of the season with bilateral Achilles tendinitis and Dr. Daniel Kaplan explained the timeline in great detail over 6,000 more characters.";
    const bounded = buildBoundedWireSummary(messyEspnBody, WIRE_ARTICLE_EXCERPT_MAX_CHARS);
    assert.ok(bounded.length <= WIRE_ARTICLE_EXCERPT_MAX_CHARS, `Bounded summary exceeded ${WIRE_ARTICLE_EXCERPT_MAX_CHARS}: ${bounded.length}`);
    assert.ok(!bounded.includes(' ,') && !bounded.includes("49ers '"), `Stray HTML punctuation spacing must be cleaned: ${bounded}`);
    assert.ok(bounded.endsWith('Christian McCaffrey.'), `Should end cleanly on complete sentence boundary (ignoring Colo.): ${bounded}`);

    // 2. sanitizeOversizedDirectArticleSummary repairs direct ESPN full-article dumps & misclassified 'film' category
    const fullEspnStoryItem = {
      id: 'espn_pwire_16737_50502440',
      type: 'article',
      category: 'film',
      wireSource: 'espn_player_wire',
      url: 'https://www.espn.com/nfl/story/_/id/50502440/san-francisco-49ers-mike-evans-achilles-tendinitis-injury-recovery',
      title: "ESPN spoke with a medical professional for a better understanding of Evans' diagnosis.",
      summary: `${messyEspnBody} ${'Extra medical Q&A paragraph about yards per play and offensive scheme. '.repeat(80)}`
    };
    const healed = sanitizeOversizedDirectArticleSummary(fullEspnStoryItem);
    assert.ok(healed.summary.length <= WIRE_ARTICLE_EXCERPT_MAX_CHARS, `Direct ESPN article summary must be bounded <=280, got ${healed.summary.length}`);
    assert.notEqual(healed.category, 'film', 'Healing full article body must clear false Film & Trench classification');

    // Legitimate RotoWire player-profile blurb (613 chars) must remain intact (not truncated by direct-article sanitizer)
    const rotoBlurbItem = {
      id: 'espn_pwire_16737_64817928',
      type: 'article',
      category: 'injury',
      wireSource: 'espn_player_wire',
      url: 'https://www.espn.com/nfl/player/_/id/16737/mike-evans#:~:text=Evans',
      title: 'Kyle Shanahan hoping to have Evans back at practice this week.',
      summary:
        "Evans missed the 49ers' last three games while recovering from right Achilles tendinitis, but he has a chance at returning to action in Week 11. After staying behind in the Bay Area this past weekend for the team's 46-40 win in Dallas, he's scheduled to meet back up with the 49ers this week in Colorado Springs, where the team will be holding practices at high altitude to get acclimated for Sunday's matchup with the Vikings in Mexico City. If Evans is able to practice in some capacity Wednesday through Friday and if his Achilles responds well, he'll likely be cleared to play for the first time since Week 6."
    };
    assert.equal(sanitizeOversizedDirectArticleSummary(rotoBlurbItem), rotoBlurbItem, 'Legitimate 613-char RotoWire player blurb must remain intact for expandable disclosure');

    // 3. splitSummaryForExpandableDisplay keeps normal summaries (<=450) uncollapsed and collapses rare >450 summaries cleanly
    const normalSummary = 'Green injured his back in the second half of the 49ers win over the Raiders in Week 9, and he finished that game with four tackles and one interception. Kyle Shanahan indicated Monday that Green is considered day-to-day.';
    const normalSplit = splitSummaryForExpandableDisplay(normalSummary);
    assert.equal(normalSplit.isTruncated, false, 'Normal <=450 char summaries must never show expand button');

    const longSplit = splitSummaryForExpandableDisplay(rotoBlurbItem.summary);
    assert.equal(longSplit.isTruncated, true, `Summary >${WIRE_SUMMARY_EXPAND_THRESHOLD} chars must collapse behind Show more`);
    assert.ok(longSplit.previewText.length <= WIRE_SUMMARY_PREVIEW_MAX + 26, `Collapsed preview too long: ${longSplit.previewText.length}`);
    assert.ok(longSplit.fullText.length - longSplit.previewText.length >= 60, 'Collapsed preview must hide meaningful overflow');

    // 4. renderWireItemCardHtml renders plain summary for normal items and Show more/Show less toggle for rare long summaries
    const normalCardHtml = renderWireItemCardHtml({
      id: 'art_normal',
      type: 'article',
      title: 'Renardo Green practice update',
      summary: normalSummary,
      url: 'https://www.49erswebzone.com/articles/normal-1/',
      author: 'Matt Barrows',
      publishedAt: new Date().toISOString()
    });
    assert.ok(!normalCardHtml.includes('data-expandable-summary'), 'Normal card must not render expand button');

    const longCardHtml = renderWireItemCardHtml({
      ...rotoBlurbItem,
      author: 'Nick Wagoner',
      publishedAt: new Date().toISOString()
    });
    assert.ok(
      longCardHtml.includes('data-expandable-summary="collapsed"') &&
        longCardHtml.includes('data-action="toggle-wire-summary"') &&
        longCardHtml.includes('>Show more</button>') &&
        longCardHtml.includes('>Show less</button>'),
      'Rare >450-char summary card must render collapsed preview with Show more / Show less toggle'
    );
  }
);

test(
  'Unified Card Typography & Independent Read State (Main Story vs Similar Stories)',
  () => {
    const nowIso = new Date().toISOString();
    const sim1 = {
      id: 'sim_story_1',
      type: 'article',
      author: 'Matt Maiocco',
      outletName: 'NBC Sports Bay Area',
      title: 'Nick Bosa opens up on pass-rush adjustments ahead of Week 11',
      url: 'https://www.nbcsportsbayarea.com/nfl/san-francisco-49ers/bosa-adjustments/1/',
      publishedAt: nowIso
    };
    const sim2 = {
      id: 'sim_story_2',
      type: 'tweet',
      author: 'David Lombardi',
      authorHandle: '@LombardiHimself',
      outletName: 'X',
      title: 'Bosa noted the interior push has forced offenses to chip more aggressively.',
      fullText: 'Bosa noted the interior push has forced offenses to chip more aggressively.',
      url: 'https://x.com/LombardiHimself/status/1999999999999999991',
      publishedAt: nowIso
    };
    const mainArticle = {
      id: 'main_bosa_article',
      type: 'article',
      author: 'Nick Wagoner',
      outletName: 'ESPN',
      title: "Niners' Nick Bosa on 4-game sack drought: 'Don't think I'm playing my best'",
      summary: 'Niners star Nick Bosa acknowledged his performance this season has not met his standard.',
      url: 'https://www.espn.com/nfl/story/_/id/99999999/nick-bosa-sack-drought',
      publishedAt: nowIso,
      confirmingReports: [sim1, sim2]
    };
    const mainTweet = {
      id: 'main_evans_tweet',
      type: 'tweet',
      author: 'Coach Yac',
      authorHandle: '@Coach_Yac',
      outletName: 'X',
      title: 'The 49ers are hoping to have Mike Evans back at practice this week, per Kyle Shanahan',
      fullText: 'The 49ers are hoping to have Mike Evans back at practice this week, per Kyle Shanahan',
      url: 'https://x.com/Coach_Yac/status/1999999999999999992',
      publishedAt: nowIso
    };

    // 1. Unified typography markup: articles use bold .wire-card-headline + .wire-headline-link; tweets use .is-tweet-body
    const unreadArticleHtml = renderWireItemCardHtml(mainArticle, { readKeysSet: new Set() });
    assert.ok(
      unreadArticleHtml.includes('class="wire-card-headline "') || unreadArticleHtml.includes('class="wire-card-headline"'),
      'Article card must use standard .wire-card-headline class without .is-tweet-body'
    );
    assert.ok(
      unreadArticleHtml.includes('class="ext-link wire-headline-link"'),
      'Article headline link must use unified .wire-headline-link class'
    );
    assert.ok(
      !unreadArticleHtml.includes('style="font-weight:'),
      'Wire headline must rely on unified CSS classes rather than inline font-weight overrides'
    );

    const unreadTweetHtml = renderWireItemCardHtml(mainTweet, { readKeysSet: new Set() });
    assert.ok(
      unreadTweetHtml.includes('class="wire-card-headline is-tweet-body"'),
      'Tweet card must apply .is-tweet-body for natural regular-weight primary ink'
    );

    // 2. Reading ONLY the main story marks main .brief-card read while keeping BOTH similar stories UNREAD
    const mainReadHtml = renderWireItemCardHtml(mainArticle, {
      readKeysSet: new Set(['main_bosa_article'])
    });
    assert.ok(
      /class="brief-card[^"]*is-read-item[^"]*"[^>]*data-read-key="main_bosa_article"/.test(mainReadHtml),
      'Main card must carry .is-read-item when main_bosa_article is in readKeysSet'
    );
    assert.ok(
      !/class="[^"]*similar-story-row[^"]*is-read-item[^"]*"[^>]*data-read-key="sim_story_1"/.test(mainReadHtml) &&
        !/class="[^"]*similar-story-row[^"]*is-read-item[^"]*"[^>]*data-read-key="sim_story_2"/.test(mainReadHtml),
      'Unclicked similar stories inside a read main card must remain unread (no .is-read-item)'
    );

    // 3. Reading ONLY sim_story_1 marks ONLY sim_story_1 read while keeping main card and sim_story_2 UNREAD
    const sim1ReadHtml = renderWireItemCardHtml(mainArticle, {
      readKeysSet: new Set(['sim_story_1'])
    });
    assert.ok(
      !/class="brief-card[^"]*is-read-item[^"]*"[^>]*data-read-key="main_bosa_article"/.test(sim1ReadHtml),
      'Clicking a similar story must NOT mark the main story card as read'
    );
    assert.ok(
      /class="[^"]*similar-story-row[^"]*is-read-item[^"]*"[^>]*data-similar-story-row data-read-key="sim_story_1"/.test(
        sim1ReadHtml
      ),
      'Clicked similar story sim_story_1 must carry .is-read-item and data-read-key'
    );
    assert.ok(
      !/class="[^"]*similar-story-row[^"]*is-read-item[^"]*"[^>]*data-similar-story-row data-read-key="sim_story_2"/.test(
        sim1ReadHtml
      ),
      'Sibling unclicked similar story sim_story_2 must remain unread'
    );
    assert.ok(
      sim1ReadHtml.includes('class="source-row-headline is-tweet-body"'),
      'Tweet rows inside Similar stories must also use .is-tweet-body for regular weight'
    );
  }
);

test(
  'Direct-Click Linked Article Preview Cards on Tweets across News, Similar Stories, Brief Sources, Home & Player Sheet',
  () => {
    const assertZeroNestedAnchors = (html, ctxLabel) => {
      // Lightweight balanced-tag check ensuring no <a> opens inside another <a>
      const tokens = html.match(/<\/?a(?:\s[^>]*)?>/gi) || [];
      let depth = 0;
      for (const tok of tokens) {
        if (/^<a\b/i.test(tok)) {
          depth += 1;
          assert.ok(depth <= 1, `Nested <a> tag detected in ${ctxLabel}`);
        } else {
          depth = Math.max(0, depth - 1);
        }
      }
    };

    // 1. formatTweetBodyForDisplay strips trailing Bluesky mirror-bot "Original post" boilerplate
    const cleanedMirror = formatTweetBodyForDisplay(
      '49ers DE Nick Bosa on his four-game sack drought: "I don\'t think I\'m playing my best football right now." Story via @nwagoner: Original post'
    );
    assert.ok(
      !cleanedMirror.text.includes('Original post') && cleanedMirror.text.endsWith('Story via @nwagoner:'),
      `Trailing "Original post" boilerplate must be stripped: ${cleanedMirror.text}`
    );

    // 2. extractBlueskyBestExternalLink ignores "Original post" x.com facet and extracts ESPN article embed
    const bskyPostWithOriginalFacet = {
      embed: {
        external: {
          uri: 'https://www.espn.com/nfl/story/_/id/50526309/niners-nick-bosa-says-better-amid-4-game-sack-drought',
          title: '49ers DE Nick Bosa on his four-game sack drought: "I don\'t think I\'m playing my best football right now." Story via @nwagoner:',
          description: '',
          thumb: 'https://cdn.bsky.app/img/feed_thumbnail/plain/did:plc:schefter/bosa.jpg'
        }
      }
    };
    const bskyRecWithOriginalFacet = {
      text: '49ers DE Nick Bosa on his four-game sack drought... Original post',
      facets: [
        {
          features: [
            {
              $type: 'app.bsky.richtext.facet#link',
              uri: 'https://x.com/AdamSchefter/status/1991000000000000001'
            }
          ]
        }
      ]
    };
    const extracted = extractBlueskyBestExternalLink(bskyPostWithOriginalFacet, bskyRecWithOriginalFacet);
    assert.equal(
      extracted.uri,
      'https://www.espn.com/nfl/story/_/id/50526309/niners-nick-bosa-says-better-amid-4-game-sack-drought'
    );
    // Also when embed.external is absent and facets contain BOTH x.com Original post + direct article link
    const extractedFromFacets = extractBlueskyBestExternalLink(
      {},
      {
        facets: [
          { features: [{ $type: 'app.bsky.richtext.facet#link', uri: 'https://x.com/AdamSchefter/status/1991000000000000001' }] },
          { features: [{ $type: 'app.bsky.richtext.facet#link', uri: 'https://www.espn.com/nfl/story/_/id/50526309/niners-nick-bosa-says-better-amid-4-game-sack-drought' }] }
        ]
      }
    );
    assert.equal(
      extractedFromFacets.uri,
      'https://www.espn.com/nfl/story/_/id/50526309/niners-nick-bosa-says-better-amid-4-game-sack-drought'
    );

    // 3. resolveTweetLinkedArticlePreview: cross-match by ESPN story ID recovers real headline, byline & ESPN CDN photo
    const wagonerArticle = {
      id: 'espn_art_50526309',
      type: 'article',
      author: 'Nick Wagoner',
      reporterName: 'Nick Wagoner',
      outletName: 'ESPN',
      title: "Niners' Nick Bosa on 4-game sack drought: 'Don't think I'm playing my best'",
      url: 'https://www.espn.com/nfl/story/_/id/50526309/niners-nick-bosa-4-game-sack-drought',
      imageUrl: 'https://a.espncdn.com/photo/2026/1118/r1420001_1296x729_16-9.jpg',
      publishedAt: new Date(Date.now() - 4 * 3600_000).toISOString()
    };
    const schefterBosaTweet = {
      id: 'bsky_live_adam_schefter_bosa',
      type: 'tweet',
      author: 'Adam Schefter',
      reporterName: 'Adam Schefter',
      outletName: 'ESPN NFL Insider',
      title: '49ers DE Nick Bosa on his four-game sack drought: "I don\'t think I\'m playing my best football right now." Story via @nwagoner: Original post',
      fullText: '49ers DE Nick Bosa on his four-game sack drought: "I don\'t think I\'m playing my best football right now." Story via @nwagoner: Original post',
      url: 'https://bsky.app/profile/adamscheftermirror.bsky.social/post/3n2bosa97',
      externalUrl: 'https://www.espn.com/nfl/story/_/id/50526309/niners-nick-bosa-says-better-amid-4-game-sack-drought',
      externalTitle: '49ers DE Nick Bosa on his four-game sack drought: "I don\'t think I\'m playing my best football right now." Story via @nwagoner:',
      imageUrl: 'https://cdn.bsky.app/img/feed_thumbnail/plain/did:plc:schefter/bosa.jpg',
      publishedAt: new Date(Date.now() - 2 * 3600_000).toISOString()
    };
    const previewMatched = resolveTweetLinkedArticlePreview(schefterBosaTweet, {
      rawStream: [wagonerArticle, schefterBosaTweet],
      resolvedItemUrl: schefterBosaTweet.url
    });
    assert.ok(previewMatched, 'Schefter tweet linking to ESPN story must resolve a linked article preview');
    assert.equal(previewMatched.titleSource, 'stream_match');
    assert.equal(previewMatched.title, "Niners' Nick Bosa on 4-game sack drought: 'Don't think I'm playing my best'");
    assert.equal(previewMatched.domain, 'espn.com');
    assert.equal(previewMatched.byline, 'Nick Wagoner');
    assert.equal(
      previewMatched.imageUrl,
      'https://a.espncdn.com/photo/2026/1118/r1420001_1296x729_16-9.jpg',
      'Should prefer crisp ESPN CDN editorial photo over Bluesky proxy thumb when stream-matched'
    );

    // 4. Mirror-bot verbatim duplicate externalTitle with NO stream match -> clean fallback (never repeats tweet verbatim)
    const previewUnmatched = resolveTweetLinkedArticlePreview(schefterBosaTweet, {
      rawStream: [schefterBosaTweet],
      resolvedItemUrl: schefterBosaTweet.url
    });
    assert.ok(previewUnmatched);
    assert.equal(previewUnmatched.titleSource, 'editorial_fallback');
    assert.equal(previewUnmatched.title, 'Read full story on ESPN');
    assert.equal(previewUnmatched.byline, 'Nick Wagoner', '@nwagoner should resolve cleanly to Nick Wagoner');
    assert.equal(previewUnmatched.imageUrl, schefterBosaTweet.imageUrl);

    // 5. Rejects paywalled links, social self-links, video tweets & headshot images
    assert.equal(
      resolveTweetLinkedArticlePreview({
        ...schefterBosaTweet,
        externalUrl: 'https://www.nytimes.com/athletic/7781234/49ers-bosa/'
      }),
      null,
      'Paywalled Athletic link must not render direct linked article card'
    );
    assert.equal(
      resolveTweetLinkedArticlePreview({
        ...schefterBosaTweet,
        videoId: 'dQw4w9WgXcQ'
      }),
      null,
      'Playable YouTube video tweet must not duplicate linked article card'
    );
    const headshotOnlyPreview = resolveTweetLinkedArticlePreview({
      ...schefterBosaTweet,
      imageUrl: 'https://a.espncdn.com/i/headshots/nfl/players/full/4040605.png'
    });
    assert.equal(headshotOnlyPreview.imageUrl, '', 'Player cutout headshots must not be stretched into linked article banners');

    // 6. Standalone News & Film tweet card renders Bluesky-style media-top card & suppresses redundant side thumb
    const standaloneHtml = renderWireItemCardHtml(schefterBosaTweet, {
      prioritizedRaw: [wagonerArticle, schefterBosaTweet],
      readKeysSet: new Set()
    });
    assertZeroNestedAnchors(standaloneHtml, 'standalone News tweet card');
    assert.ok(
      standaloneHtml.includes('data-linked-article-card="true"') &&
        standaloneHtml.includes('data-linked-article-variant="card"') &&
        standaloneHtml.includes('href="https://www.espn.com/nfl/story/_/id/50526309/niners-nick-bosa-says-better-amid-4-game-sack-drought"'),
      'Standalone tweet card must render media-top linked article card pointing directly to ESPN'
    );
    assert.ok(!standaloneHtml.includes('Original post'), 'Standalone tweet card must not leak "Original post"');
    assert.ok(
      !standaloneHtml.includes('data-salient-thumb'),
      'Standalone tweet card with media-top linked article card must suppress redundant outer side thumbnail'
    );
    assert.ok(
      !standaloneHtml.includes('Article: 49ers'),
      'Standalone tweet card must replace cramped Article: chip with clean preview card'
    );

    // 7. Similar stories drawer (exact Image 1 scenario): Jennifer Lee Chan lead + Adam Schefter tweet with linked ESPN article
    const jlcLeadArticle = {
      id: 'nbcsba_jlc_bosa',
      type: 'article',
      author: 'Jennifer Lee Chan',
      outletName: 'NBC Sports Bay Area',
      title: '49ers star Nick Bosa makes honest admission about slow start to 2026 NFL season',
      url: 'https://www.nbcsportsbayarea.com/nfl/san-francisco-49ers/nick-bosa-honest-admission-2026/1991234/',
      imageUrl: 'https://media.nbcsportsbayarea.com/2026/11/bosa.jpg',
      publishedAt: new Date(Date.now() - 6 * 60_000).toISOString(),
      confirmingReports: [wagonerArticle, schefterBosaTweet]
    };
    const clusteredHtml = renderWireItemCardHtml(jlcLeadArticle, {
      prioritizedRaw: [jlcLeadArticle, wagonerArticle, schefterBosaTweet],
      readKeysSet: new Set()
    });
    assertZeroNestedAnchors(clusteredHtml, 'News Similar stories drawer with linked article tweet');
    assert.ok(
      clusteredHtml.includes('data-linked-article-card="true"') &&
        clusteredHtml.includes('data-linked-article-variant="compact"') &&
        clusteredHtml.includes('href="https://www.espn.com/nfl/story/_/id/50526309/niners-nick-bosa-says-better-amid-4-game-sack-drought"') &&
        clusteredHtml.includes('espn.com · Nick Wagoner'),
      'Similar stories tweet row must embed a compact direct-click ESPN preview card with real headline & byline'
    );
    assert.ok(
      !clusteredHtml.includes('Original post'),
      'Similar stories tweet row must strip "Original post"'
    );

    // 8. Daily Brief Sources drawer renders linked article preview for tweet source with zero nested <a>
    const briefWithTweetSource = {
      id: 'daily_test_linked',
      headline: 'Nick Bosa Eyes Pass-Rush Breakout Ahead of Week 11',
      bullets: ['Bosa candid on sack drought [Adam Schefter](https://bsky.app/profile/adamscheftermirror.bsky.social/post/3n2bosa97).'],
      sources: [
        {
          title: schefterBosaTweet.title,
          url: schefterBosaTweet.url,
          author: 'Adam Schefter',
          outlet: 'ESPN NFL Insider',
          type: 'tweet',
          publishedAt: schefterBosaTweet.publishedAt
        }
      ],
      generatedAt: new Date().toISOString()
    };
    const briefSourcesHtml = renderDailyTopNewsBriefHtml(briefWithTweetSource, {
      rawStream: [wagonerArticle, schefterBosaTweet],
      readKeysSet: new Set()
    });
    assertZeroNestedAnchors(briefSourcesHtml, 'Daily Brief Sources with linked article tweet');
    assert.ok(
      briefSourcesHtml.includes('data-linked-article-card="true"') &&
        briefSourcesHtml.includes('href="https://www.espn.com/nfl/story/_/id/50526309/niners-nick-bosa-says-better-amid-4-game-sack-drought"'),
      'Daily Brief Sources must surface direct linked article preview card for tweet sources'
    );

    // 9. Player Sheet mention card & nested Similar stories both render linked article cards with zero nested <a>
    const playerMentionHtml = renderInjuryNewsItemCardHtml(schefterBosaTweet, {
      playerName: 'Nick Bosa',
      directPosts: [wagonerArticle, schefterBosaTweet],
      excludePlayerId: '4040605',
      readKeysSet: new Set()
    });
    assertZeroNestedAnchors(playerMentionHtml, 'Player Sheet tweet mention card');
    assert.ok(
      playerMentionHtml.includes('data-linked-article-card="true"') &&
        playerMentionHtml.includes('href="https://www.espn.com/nfl/story/_/id/50526309/niners-nick-bosa-says-better-amid-4-game-sack-drought"'),
      'Player Sheet tweet mention must render direct-click linked article preview card'
    );
    const playerClusterHtml = renderInjuryNewsItemCardHtml(jlcLeadArticle, {
      playerName: 'Nick Bosa',
      directPosts: [jlcLeadArticle, wagonerArticle, schefterBosaTweet],
      excludePlayerId: '4040605',
      readKeysSet: new Set()
    });
    assertZeroNestedAnchors(playerClusterHtml, 'Player Sheet Similar stories with linked article tweet');
    assert.ok(
      playerClusterHtml.includes('data-linked-article-card="true"'),
      'Player Sheet Similar stories must embed compact linked article card on tweets'
    );
  }
);

await testAsync(
  'Proactive 5:00 PM PT & variable game-day post-game brief scheduling: GitHub Actions workflow, Wrangler crons, Worker scheduled()/runScheduledDailyNewsBrief(), KV cache-hit zero-credit guard, game-day hold & pre-resolved seedData citation parity',
  async () => {
    const {
      default: edgeWorker,
      runScheduledDailyNewsBrief,
      overlayLiveEspnScheduleForBrief
    } = await import('../worker/index.js');
    const { parseAndSanitizeDailyTopNewsBrief } = await import('../src/services/aiWorkerClient.js');

    // 1. GitHub Actions workflow template exists, schedules 5:05 PM PT + 30m windows, and matches .github/workflows/refresh-data.yml when installed
    const activeWfPath = path.join(rootDir, '.github', 'workflows', 'refresh-data.yml');
    const templateWfPath = path.join(rootDir, 'scripts', 'github-workflow-refresh-data.yml');
    assert.ok(fs.existsSync(templateWfPath), 'Expected scripts/github-workflow-refresh-data.yml to exist');
    const templateWfText = fs.readFileSync(templateWfPath, 'utf8');
    if (fs.existsSync(activeWfPath)) {
      const activeWfText = fs.readFileSync(activeWfPath, 'utf8');
      assert.equal(activeWfText, templateWfText, '.github/workflows/refresh-data.yml must stay synced with scripts/github-workflow-refresh-data.yml');
    }
    assert.ok(
      templateWfText.includes("cron: '5 0,1 * * *'") &&
        templateWfText.includes("cron: '*/30 15-23,0-7 * * *'") &&
        templateWfText.includes('GEMINI_API_KEY') &&
        templateWfText.includes('WORKER_BASE_URL'),
      'GitHub Actions workflow must schedule 5:05 PM PT + 30m windows and pass Gemini/Worker secrets'
    );

    // 2. Wrangler config registers 5:02 PM PT + half-hourly daytime/game-day cron triggers
    const wranglerText = fs.readFileSync(path.join(rootDir, 'worker', 'wrangler.toml'), 'utf8');
    assert.ok(
      wranglerText.includes('"2 0,1 * * *"') &&
        wranglerText.includes('"*/30 16-23,0-7 * * *"') &&
        wranglerText.includes('"15 */6 * * *"'),
      'worker/wrangler.toml must register 6h model discovery, 5:02 PM PT daily brief, and half-hourly game-day crons'
    );

    // 3. Mock KV + fetch to test runScheduledDailyNewsBrief end-to-end across 5:02 PM PT, cache hit, game-day hold, and post-game completion
    const kvStore = new Map();
    const mockKv = {
      async get(key, type) {
        if (!kvStore.has(key)) return null;
        const val = kvStore.get(key);
        if (type === 'json') return typeof val === 'string' ? JSON.parse(val) : val;
        return typeof val === 'string' ? val : JSON.stringify(val);
      },
      async put(key, val) {
        kvStore.set(key, typeof val === 'string' ? val : JSON.stringify(val));
      },
      async delete(key) {
        kvStore.delete(key);
      }
    };
    const mockEnv = {
      SHARED_CACHE: mockKv,
      ALLOWED_ORIGIN: 'https://49ers.joshal.com',
      GEMINI_API_KEY: 'test-key-proactive-brief',
      GEMINI_DEFAULT_FREE_MODEL: 'gemini-4-hydrogen'
    };

    const metaJson = JSON.parse(fs.readFileSync(path.join(rootDir, 'data', 'meta.json'), 'utf8'));
    const schedJson = JSON.parse(fs.readFileSync(path.join(rootDir, 'data', 'schedule-matchup.json'), 'utf8'));
    const healthJson = JSON.parse(fs.readFileSync(path.join(rootDir, 'data', 'health.json'), 'utf8'));
    const capJson = JSON.parse(fs.readFileSync(path.join(rootDir, 'data', 'cap.json'), 'utf8'));
    const depthJson = JSON.parse(fs.readFileSync(path.join(rootDir, 'data', 'depth-chart.json'), 'utf8'));
    const seasonalJson = JSON.parse(fs.readFileSync(path.join(rootDir, 'data', 'seasonal.json'), 'utf8'));
    const newsJson = JSON.parse(fs.readFileSync(path.join(rootDir, 'data', 'news.json'), 'utf8'));

    let geminiCalls = 0;
    let mockEspnSchedule = { events: [] };
    let mockEspnNews = {
      articles: [
        {
          id: '50599901',
          headline: '49ers finish Colorado Springs altitude prep ahead of Vikings matchup',
          description: 'Kyle Shanahan praised Nick Bosa and Brock Purdy after Thursday afternoon drills in Colorado Springs.',
          links: { web: { href: 'https://www.espn.com/nfl/story/_/id/50599901/49ers-altitude-prep-vikings' } },
          byline: 'Nick Wagoner',
          published: '2026-11-20T00:30:00Z'
        },
        {
          id: '50599902',
          headline: 'Christian McCaffrey leads NFC rushing attack entering Week 11',
          description: 'San Francisco sits 8-1 atop the NFC West with Brock Purdy and Christian McCaffrey clicking.',
          links: { web: { href: 'https://www.espn.com/nfl/story/_/id/50599902/49ers-mccaffrey-week-11' } },
          byline: 'Nick Wagoner',
          published: '2026-11-20T00:10:00Z'
        }
      ]
    };

    const origFetch = globalThis.fetch;
    globalThis.fetch = async (input, init) => {
      const url = typeof input === 'string' ? input : input?.url || '';
      if (url.endsWith('/data/schedule-matchup.json')) {
        return new Response(JSON.stringify(schedJson), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      if (url.endsWith('/data/meta.json')) {
        return new Response(JSON.stringify(metaJson), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      if (url.endsWith('/data/health.json')) {
        return new Response(JSON.stringify(healthJson), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      if (url.endsWith('/data/cap.json')) {
        return new Response(JSON.stringify(capJson), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      if (url.endsWith('/data/depth-chart.json')) {
        return new Response(JSON.stringify(depthJson), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      if (url.endsWith('/data/seasonal.json')) {
        return new Response(JSON.stringify(seasonalJson), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      if (url.endsWith('/data/news.json')) {
        return new Response(JSON.stringify(newsJson), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      if (url.includes('teams/sf/schedule')) {
        return new Response(JSON.stringify(mockEspnSchedule), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      if (url.includes('nfl/news?team=25')) {
        return new Response(JSON.stringify(mockEspnNews), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      if (url.includes('generativelanguage.googleapis.com')) {
        geminiCalls += 1;
        const bodyObj = init?.body ? JSON.parse(init.body) : {};
        const promptStr = String(bodyObj?.contents?.[0]?.parts?.[0]?.text || '');
        const isPostGamePrompt = /COMPLETED GAME PRIMARY LEAD/i.test(promptStr);
        const mockBriefJson = isPostGamePrompt
          ? {
              headline: '49ers Move to 9-1 With Commanding Week 11 Win Over Vikings in Mexico City',
              bullets: [
                {
                  subtopic: 'Mexico City Victory',
                  body: 'San Francisco improved to 9-1 with a 31-24 Week 11 triumph over Minnesota at Estadio Banorte [S1].'
                },
                {
                  subtopic: 'Offensive Execution',
                  body: 'Brock Purdy and Christian McCaffrey controlled possession at 7,200 feet while sustaining red-zone efficiency [S2].'
                },
                {
                  subtopic: 'NFC Top Seed Grip',
                  body: 'With the head-to-head victory over Minnesota, San Francisco tightened its hold on the NFC West and conference lead [S1].'
                }
              ],
              citedSourceIds: ['S1', 'S2']
            }
          : {
              headline: '49ers Finalize Colorado Altitude Prep Ahead of Week 11 Vikings Showdown',
              bullets: [
                {
                  subtopic: 'Altitude Prep Wraps',
                  body: 'San Francisco completed its Colorado Springs practice block to acclimate for Estadio Banorte against Minnesota [S1].'
                },
                {
                  subtopic: 'Offensive Rhythm Intact',
                  body: 'Brock Purdy and Christian McCaffrey carry an 8-1 NFC-leading attack into Sunday night against Brian Flores [S2].'
                },
                {
                  subtopic: 'Pass-Rush & Health Focus',
                  body: 'Nick Bosa emphasized four-man rush finish while the training staff monitored wide receiver Mike Evans ahead of Friday [S1].'
                }
              ],
              citedSourceIds: ['S1', 'S2']
            };
        return new Response(
          JSON.stringify({
            candidates: [{ content: { parts: [{ text: JSON.stringify(mockBriefJson) }] } }]
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
      return new Response('', { status: 200 });
    };

    try {
      // 3A. 5:02 PM PST Thursday Nov 19 (`2026-11-20T01:02:00Z`) proactively generates `2026-11-19@17PT`
      const thu502PmPtMs = Date.parse('2026-11-20T01:02:00Z');
      const res5pm = await runScheduledDailyNewsBrief(mockEnv, {
        nowMs: thu502PmPtMs,
        cron: '2 0,1 * * *'
      });
      assert.equal(res5pm.ok, true);
      assert.equal(res5pm.generated, true, '5:02 PM PT cron must proactively synthesize the new daily brief');
      assert.equal(res5pm.cycleKey, '2026-11-19@17PT');
      assert.equal(geminiCalls, 1, 'Expected exactly 1 Gemini call at 5:02 PM PT');
      assert.equal(kvStore.has('daily_news_brief_lock:2026-11-19@17PT-v5'), false, 'In-flight KV lock must be cleaned up');

      const stored5pm = await mockKv.get('daily_news_brief_v5:2026-11-19@17PT-v5', 'json');
      assert.ok(stored5pm && stored5pm.scheduled === true, 'Stored brief must be tagged scheduled: true');
      assert.equal(stored5pm.generatedAt, '2026-11-20T01:02:00.000Z', 'generatedAt must reflect 5:02 PM PT cron run');
      assert.ok(
        stored5pm.data && Array.isArray(stored5pm.data.bullets) && stored5pm.data.bullets.length >= 3,
        'Stored KV payload must include pre-resolved data with inline links & sources'
      );

      // 3B. Next morning 8:30 AM PST Friday (`2026-11-20T16:30:00Z`) hits KV cache with 0 Gemini calls!
      const friMorningMs = Date.parse('2026-11-20T16:30:00Z');
      const resCacheHit = await runScheduledDailyNewsBrief(mockEnv, {
        nowMs: friMorningMs,
        cron: '*/30 16-23,0-7 * * *'
      });
      assert.equal(resCacheHit.skipped, true);
      assert.equal(resCacheHit.reason, 'already_cached');
      assert.equal(resCacheHit.generatedAt, '2026-11-20T01:02:00.000Z');
      assert.equal(geminiCalls, 1, 'Cached cycle must spend 0 additional Gemini credits');

      // 3C. Game Day Hold: Sunday Nov 22 at 5:02 PM PST (18 min before 5:20 PM PST Vikings kickoff) must NOT fire!
      const sunGameDay502PmMs = Date.parse('2026-11-23T01:02:00Z');
      const resHold = await runScheduledDailyNewsBrief(mockEnv, {
        nowMs: sunGameDay502PmMs,
        cron: '2 0,1 * * *'
      });
      assert.equal(resHold.skipped, true);
      assert.equal(resHold.reason, 'gameday_hold', 'Game-day 5:02 PM PT cron inside [T-90m, Final) must hold');
      assert.equal(geminiCalls, 1, 'Game-day hold must spend 0 Gemini credits');

      // 3D. Variable Game-Day Post-Game Completion: ESPN marks Week 11 Final (SF 31, MIN 24) -> post-game cron generates `2026-11-22@postgame-wk11`
      mockEspnSchedule = {
        events: [
          {
            id: '401873077',
            date: '2026-11-23T01:20Z',
            seasonType: { type: 2 },
            week: { number: 11 },
            competitions: [
              {
                status: { type: { completed: true, state: 'post', shortDetail: 'Final' } },
                competitors: [
                  { id: '25', team: { abbreviation: 'SF' }, score: { value: 31, displayValue: '31' }, winner: true },
                  { id: '16', team: { abbreviation: 'MIN' }, score: { value: 24, displayValue: '24' }, winner: false }
                ]
              }
            ]
          }
        ]
      };
      mockEspnNews = {
        articles: [
          {
            id: '50599991',
            headline: '49ers defeat Vikings 31-24 in Mexico City to reach 9-1',
            description: 'Brock Purdy and Christian McCaffrey powered San Francisco past Minnesota in Week 11.',
            links: { web: { href: 'https://www.espn.com/nfl/story/_/id/50599991/49ers-defeat-vikings-mexico-city' } },
            byline: 'Nick Wagoner',
            published: '2026-11-23T04:40:00Z'
          },
          {
            id: '50599992',
            headline: 'Kyle Shanahan postgame takeaways after Week 11 win over Vikings',
            description: 'San Francisco defense closed the fourth quarter cleanly at high altitude.',
            links: { web: { href: 'https://www.espn.com/nfl/story/_/id/50599992/shanahan-postgame-vikings' } },
            byline: 'Nick Wagoner',
            published: '2026-11-23T04:50:00Z'
          },
          {
            id: '50599993',
            headline: 'Nick Bosa and Raheem Morris credit late-game rush against Minnesota',
            description: '49ers move to 9-1 and keep sole possession of the NFC top seed.',
            links: { web: { href: 'https://www.espn.com/nfl/story/_/id/50599993/bosa-postgame-vikings' } },
            byline: 'Nick Wagoner',
            published: '2026-11-23T04:55:00Z'
          }
        ]
      };
      // Simulate first post-game completion observation at 8:30 PM PST (04:30 UTC), then 9:00 PM PST (05:00 UTC, >=18m buffer!)
      const schedCopyForOverlay = structuredClone(schedJson);
      const metaCopyForOverlay = structuredClone(metaJson);
      await overlayLiveEspnScheduleForBrief(schedCopyForOverlay, metaCopyForOverlay, mockEspnSchedule, {
        nowMs: Date.parse('2026-11-23T04:30:00Z'),
        env: mockEnv
      });
      assert.equal(metaCopyForOverlay.teamRecord, '9-1', 'Live ESPN overlay must advance team record to 9-1');

      const sunPostGame900PmMs = Date.parse('2026-11-23T05:00:00Z');
      const resPostGame = await runScheduledDailyNewsBrief(mockEnv, {
        nowMs: sunPostGame900PmMs,
        cron: '*/30 16-23,0-7 * * *'
      });
      assert.equal(resPostGame.ok, true);
      assert.equal(resPostGame.generated, true, 'Post-game half-hourly cron must proactively synthesize post-game brief after Final + buffer');
      assert.equal(resPostGame.cycleKey, '2026-11-22@postgame-wk11');
      assert.equal(geminiCalls, 2, 'Expected exactly 1 additional Gemini call for post-game cycle');

      // 3E. Pre-resolved KV `data` preserves original inline-cited sources even if client sourceCandidates shifted later
      const rehydrated = parseAndSanitizeDailyTopNewsBrief(
        stored5pm.data,
        [
          {
            refId: 'S1',
            type: 'article',
            author: 'Different Writer',
            outlet: 'Different Outlet',
            citeLabel: 'Different Outlet',
            title: 'Unrelated Next-Day Story',
            url: 'https://www.49ers.com/news/unrelated-next-day-story',
            publishedAt: '2026-11-20T16:00:00Z'
          }
        ],
        { meta: metaJson, roster: { players: [] } },
        { cycleKey: '2026-11-19@17PT', generatedAt: stored5pm.generatedAt, source: 'live-gemini-daily' }
      );
      assert.ok(
        rehydrated.sources.some(s => s.url === 'https://www.espn.com/nfl/story/_/id/50599901/49ers-altitude-prep-vikings'),
        'Pre-resolved KV data must preserve original cited source URLs even when client candidates shift hours later'
      );

      // 3F. POST /api/daily-news-brief accepts `seedData` alongside `seedRawText` and GET returns it
      const seedReq = new Request('https://worker.example.com/api/daily-news-brief', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          cycleKey: '2026-11-25@17PT-v5',
          seedRawText: '{"headline":"Seeded"}',
          seedData: stored5pm.data,
          modelUsed: 'gemini-4-hydrogen',
          generatedAt: '2026-11-26T01:05:00.000Z'
        })
      });
      const seedResp = await edgeWorker.fetch(seedReq, mockEnv);
      assert.equal(seedResp.status, 200);
      const getResp = await edgeWorker.fetch(
        new Request('https://worker.example.com/api/daily-news-brief?cycleKey=2026-11-25@17PT-v5'),
        mockEnv
      );
      const getJson = await getResp.json();
      assert.equal(getJson.cached, true);
      assert.equal(getJson.data?.headline, stored5pm.data.headline, 'GET /api/daily-news-brief must serve seeded data object');
    } finally {
      globalThis.fetch = origFetch;
    }
  }
);

test('Same-cycle official briefing & RotoWire paraphrase clustering merges John Lynch KNBR trio while guarding against practice-status, setback, topic-domain, and cross-player false merges', () => {
  const nowMs = Date.parse('2026-11-19T17:00:00Z');
  const feed = [
    {
      id: 'rw_live_evans_knbr',
      type: 'tweet',
      wireSource: 'rotowire_rss',
      outletName: 'NBC Sports Bay Area',
      author: 'Matt Maiocco',
      reporterId: 'matt_maiocco',
      trustTier: 1,
      title: 'San Francisco general manager John Lynch said that "there\'s a chance" Evans (Achilles) will take part in a padded practice Thursday.',
      fullText: 'San Francisco general manager John Lynch said that "there\'s a chance" Evans (Achilles) will take part in a padded practice Thursday.',
      url: 'https://www.rotowire.com/football/headlines/mike-evans-knbr',
      publishedAt: new Date(nowMs - 28 * 60_000).toISOString(),
      mentionedPlayers: [{ id: 'evans', name: 'Mike Evans' }]
    },
    {
      id: 'wz_lynch_evans_knbr',
      type: 'article',
      outletName: '49ers Webzone',
      author: '49ers Webzone',
      trustTier: 2,
      title: "49ers' John Lynch shares Mike Evans injury update: 'This week's a big step'",
      summary: "49ers GM John Lynch says this week is a big step in Mike Evans' recovery, offering hope the veteran receiver could return against the Vikings.",
      url: 'https://www.49erswebzone.com/articles/john-lynch-mike-evans-injury-update/',
      imageUrl: 'https://static.49erswebzone.com/evans-action.jpg',
      publishedAt: new Date(nowMs - 15 * 60_000).toISOString(),
      mentionedPlayers: [{ id: 'evans', name: 'Mike Evans' }]
    },
    {
      id: 'maiocco_knbr_tweet',
      type: 'tweet',
      outletName: 'NBC Sports Bay Area',
      author: 'Matt Maiocco',
      reporterId: 'matt_maiocco',
      trustTier: 1,
      title: "The 49ers will have a padded practice today at the Air Force Academy and there's a chance WR Mike Evans (Achilles) will be out there, GM John Lynch said on KNBR.",
      fullText: "The 49ers will have a padded practice today at the Air Force Academy and there's a chance WR Mike Evans (Achilles) will be out there, GM John Lynch said on KNBR.",
      url: 'https://x.com/MaioccoNBCS/status/1234567890',
      publishedAt: new Date(nowMs - 38 * 60_000).toISOString(),
      mentionedPlayers: [{ id: 'evans', name: 'Mike Evans' }]
    },
    // Prior-cycle (2d ago) Shanahan quote MUST stay separate
    {
      id: 'coach_yac_2d_shanahan',
      type: 'tweet',
      outletName: 'X Beat',
      author: 'Coach Yac',
      trustTier: 2,
      title: 'The 49ers are hoping to have Mike Evans back at practice this week, per Kyle Shanahan',
      fullText: 'The 49ers are hoping to have Mike Evans back at practice this week, per Kyle Shanahan',
      url: 'https://x.com/Coach_Yac/status/1111111',
      publishedAt: new Date(nowMs - 48 * 3600_000).toISOString(),
      mentionedPlayers: [{ id: 'evans', name: 'Mike Evans' }]
    },
    // Guardrail 1: Afternoon official DNP practice report MUST NOT merge with morning Lynch quote
    {
      id: 'evans_dnp_thursday',
      type: 'tweet',
      outletName: 'NBC Sports Bay Area',
      author: 'Matt Maiocco',
      reporterId: 'matt_maiocco',
      trustTier: 1,
      title: 'Mike Evans (Achilles) did not practice Thursday, per 49ers injury report.',
      fullText: 'Mike Evans (Achilles) did not practice Thursday, per 49ers injury report.',
      url: 'https://x.com/MaioccoNBCS/status/99999999',
      publishedAt: new Date(nowMs + 3 * 3600_000).toISOString(),
      mentionedPlayers: [{ id: 'evans', name: 'Mike Evans' }]
    },
    // Guardrail 2: Afternoon acute setback / ruled out MUST NOT merge with morning optimistic quote
    {
      id: 'evans_setback_ruled_out',
      type: 'tweet',
      outletName: 'ESPN',
      author: 'Nick Wagoner',
      reporterId: 'nick_wagoner',
      trustTier: 1,
      title: 'GM John Lynch confirmed Mike Evans suffered an Achilles setback and has been ruled out for Sunday.',
      fullText: 'GM John Lynch confirmed Mike Evans suffered an Achilles setback and has been ruled out for Sunday.',
      url: 'https://x.com/nwagoner/status/88888888',
      publishedAt: new Date(nowMs + 4 * 3600_000).toISOString(),
      mentionedPlayers: [{ id: 'evans', name: 'Mike Evans' }]
    },
    // Guardrail 3: Same speaker + same player + different topic domain (contract vs injury) MUST stay separate
    {
      id: 'lynch_evans_contract',
      type: 'article',
      outletName: '49ers Webzone',
      author: '49ers Webzone',
      trustTier: 2,
      title: "John Lynch explains how 49ers structured Mike Evans' contract extension",
      summary: 'John Lynch broke down the salary cap structure of Mike Evans contract on KNBR.',
      url: 'https://www.49erswebzone.com/articles/lynch-evans-contract/',
      publishedAt: new Date(nowMs - 10 * 60_000).toISOString(),
      mentionedPlayers: [{ id: 'evans', name: 'Mike Evans' }]
    },
    // Guardrail 4: Same reporter + same coach (Shanahan) + wire blurb about TWO DIFFERENT players MUST NOT merge
    {
      id: 'wagoner_green_tweet',
      type: 'tweet',
      outletName: 'ESPN 49ers Beat',
      author: 'Nick Wagoner',
      reporterId: 'nick_wagoner',
      trustTier: 1,
      title: '#49ers CB Renardo Green (back) is the only injury from Sunday, per Kyle Shanahan.',
      fullText: '#49ers CB Renardo Green (back) is the only injury from Sunday, per Kyle Shanahan.',
      url: 'https://x.com/nwagoner/status/77777777',
      publishedAt: new Date(nowMs - 48 * 3600_000).toISOString(),
      mentionedPlayers: [{ id: 'green', name: 'Renardo Green' }]
    },
    {
      id: 'espn_pwire_evans_shanahan',
      type: 'article',
      wireSource: 'espn_player_wire',
      outletName: 'ESPN 49ers Beat',
      author: 'Nick Wagoner',
      reporterId: 'nick_wagoner',
      trustTier: 1,
      title: 'Head coach Kyle Shanahan said Monday that the 49ers are "hoping to" have Evans (Achilles) back at practice this week.',
      url: 'https://www.espn.com/nfl/player/_/id/16737/mike-evans',
      publishedAt: new Date(nowMs - 47.8 * 3600_000).toISOString(),
      mentionedPlayers: [{ id: 'evans', name: 'Mike Evans' }]
    }
  ];

  const grouped = deduplicateAndGroupWireItems(feed, { nowMs: nowMs + 5 * 3600_000, groupSimilarStories: true });
  const knbrCluster = grouped.find(x => x.id === 'maiocco_knbr_tweet');
  assert.ok(knbrCluster, 'Matt Maiocco direct X tweet should lead the John Lynch KNBR cluster over RotoWire paraphrase and blog rewrite');
  assert.equal(knbrCluster.confirmingReports?.length, 2, 'Both RotoWire paraphrase and 49ers Webzone article must group into the John Lynch KNBR cluster');
  assert.equal(knbrCluster.imageUrl, 'https://static.49erswebzone.com/evans-action.jpg', 'Lead tweet should inherit editorial action photo from grouped Webzone article');

  assert.ok(grouped.some(x => x.id === 'evans_dnp_thursday'), 'Afternoon official DNP report must NOT be swallowed into morning Lynch quote');
  assert.ok(grouped.some(x => x.id === 'evans_setback_ruled_out'), 'Afternoon acute setback/ruled-out report must NOT be swallowed into morning optimistic quote');
  assert.ok(grouped.some(x => x.id === 'lynch_evans_contract'), 'Same-day contract article from John Lynch must NOT merge with his injury update');

  const greenCluster = grouped.find(x => x.id === 'wagoner_green_tweet');
  assert.ok(greenCluster && (greenCluster.confirmingReports?.length || 0) === 0, 'Renardo Green tweet must NOT merge with Nick Wagoner ESPN blurb about Mike Evans purely via shared coach:shanahan');
  const shanahanEvansCluster = grouped.find(x => x.id === 'coach_yac_2d_shanahan');
  assert.ok(shanahanEvansCluster && shanahanEvansCluster.confirmingReports?.some(c => c.id === 'espn_pwire_evans_shanahan'), 'ESPN Mike Evans Shanahan blurb should merge into the 2d-ago Shanahan Mike Evans cluster');
});

await testAsync(
  'Injury Report Calibration, Conditional Practice-Day Guard, Compound Medical+Rest Parsing & Trajectory+% Delta Chips',
  async () => {
    const {
      computePlayerPlayProbability,
      evaluateCorroboratedNewsInjurySignal,
      extractLivePracticeParticipationFromWire,
      extractPracticeDaysFromText,
      isRestOrPersonalInjuryLabel,
      parseOfficial49ersInjuryReportHtml,
      reconcileRosterAndHealthWithNews
    } = await import('../src/engine/injuryProbabilityModel.js');
    const { computePracticeTrajectoryDelta } = await import('../src/engine/digestExperienceEngine.js');
    const { renderSeasonMatchupViewHtml } = await import('../src/views/seasonMatchupView.js');

    const kickoffIso = '2026-11-23T01:20:00Z';
    const thuMiddayMs = Date.parse('2026-11-19T21:26:00Z'); // Thu 1:26 PM PT

    // 1. Exact Mike Evans pre-practice warmup + RotoWire conditional "Assuming ... at least a limited practice Thursday"
    //    must NEVER fabricate thu='LP' ahead of official Thursday report!
    const evansShort = "Evans (Achilles) is suited up for Thursday's practice, Cam Inman of The San Jose Mercury News reports.";
    const evansLong =
      "Assuming Evans is able to log at least a limited practice Thursday, it'll officially mark his first on-field work since aggravating a right Achilles injury during a Week 6 win against the Commanders. How he fares in drills Thursday and Friday likely will determine if he's cleared to return to action Sunday versus the Vikings in Mexico City.";
    assert.deepEqual(
      extractPracticeDaysFromText({
        statusRaw: 'Questionable',
        injuryType: 'Achilles',
        shortComment: evansShort,
        longComment: evansLong,
        kickoffIso,
        nowMs: thuMiddayMs,
        allowHeuristicFill: false
      }),
      { wed: '-', thu: '-', fri: '-' },
      'Conditional "Assuming ... able to log at least a limited practice Thursday" must NEVER fabricate thu=LP'
    );
    for (const condNote of [
      'If he is able to log a limited practice Thursday, he could suit up Sunday.',
      "There's a chance Evans logs a limited session Thursday.",
      'He could log a full practice Friday if his Achilles responds well.'
    ]) {
      assert.deepEqual(
        extractPracticeDaysFromText({
          statusRaw: 'Questionable',
          injuryType: 'Achilles',
          shortComment: condNote,
          kickoffIso,
          nowMs: Date.parse('2026-11-20T22:00:00Z'),
          allowHeuristicFill: false
        }),
        { wed: '-', thu: '-', fri: '-' },
        `Speculative/conditional prose must stay blank: "${condNote}"`
      );
    }
    // Confirmed post-practice participation MUST still parse cleanly
    assert.deepEqual(
      extractPracticeDaysFromText({
        statusRaw: 'Questionable',
        injuryType: 'Achilles',
        shortComment: 'Evans (Achilles) practiced in a limited capacity Thursday after sitting out Wednesday.',
        kickoffIso,
        nowMs: thuMiddayMs,
        allowHeuristicFill: false
      }),
      { wed: 'DNP', thu: 'LP', fri: '-' },
      'Confirmed post-practice Thursday LP + Wednesday DNP must still extract cleanly'
    );

    const evansRosterStub = [
      {
        id: '16737',
        name: 'Mike Evans',
        position: 'WR',
        jersey: 5,
        experienceYears: 13,
        primarySnapPct: 54,
        rosterBucket: 'active',
        health: { injuryType: 'Achilles' }
      }
    ];
    const liveWireMap = extractLivePracticeParticipationFromWire({
      newsItems: [
        {
          id: 'espn_pwire_16737_thu_midday',
          publishedAt: '2026-11-19T20:13:14Z',
          title: evansShort,
          summary: evansLong,
          wireSource: 'espn_player_wire',
          primaryPlayer: { id: '16737' }
        }
      ],
      rosterPlayers: evansRosterStub,
      kickoffIso,
      lastCompletedGameEndMs: Date.parse('2026-11-16T00:00:00Z'),
      nowMs: thuMiddayMs
    });
    assert.equal(
      liveWireMap.get('16737')?.thu || null,
      null,
      'extractLivePracticeParticipationFromWire must NOT fabricate thu=LP from conditional "Assuming..." blurb'
    );

    // 2. Multi-game absence + load-response monotonicity (Mike Evans 3 missed games w/ 0 prior practices)
    const evansHist3Missed = [
      { week: 7, injury: 'Ribs', gameStatus: 'Out', practiceStatus: 'Did Not Participate In Practice' },
      { week: 9, injury: 'Ribs', gameStatus: 'Out', practiceStatus: 'Did Not Participate In Practice' },
      { week: 10, injury: 'Achilles', gameStatus: 'Out', practiceStatus: 'Did Not Participate In Practice' }
    ];
    const evalEvans = (wed, thu, fri, sig = null) =>
      computePlayerPlayProbability({
        name: 'Mike Evans',
        position: 'WR',
        experienceYears: 13,
        snapPct: 54,
        rosterBucket: 'active',
        gameStatus: 'Questionable',
        injuryType: 'Achilles',
        wed,
        thu,
        fri,
        weeklyHistory: evansHist3Missed,
        currentWeek: 11,
        byeWeek: 8,
        corroboratedNewsSignal: sig
      });

    const wedDnp = evalEvans('DNP', '-', '-');
    const thuUniformSig = evaluateCorroboratedNewsInjurySignal({
      playerName: 'Mike Evans',
      playerId: '16737',
      rosterBucket: 'active',
      newsItems: [
        {
          id: 'maiocco_thu_uniform',
          author: 'Matt Maiocco',
          trustTier: 1,
          publishedAt: '2026-11-19T20:36:42Z',
          fullText:
            "WR Mike Evans (Achilles) is in uniform at 49ers' practice and there is now looking like a decent chance he will be available to play Sunday night against the Vikings."
        }
      ],
      rosterPlayerNames: ['Mike Evans'],
      nowMs: thuMiddayMs,
      windowStartMs: Date.parse('2026-11-16T00:00:00Z')
    });
    assert.equal(thuUniformSig.signalType, 'TRENDING_UPWARD');
    const thuMiddayTrend = evalEvans('DNP', '-', '-', thuUniformSig);
    const thuFirstLp = evalEvans('DNP', 'LP', '-');
    const thuFirstLpWithTrend = evalEvans('DNP', 'LP', '-', thuUniformSig);
    const friSecondLp = evalEvans('DNP', 'LP', 'LP');
    const friThreeLp = evalEvans('LP', 'LP', 'LP');
    const friFull = evalEvans('DNP', 'LP', 'FP');
    const friSetback = evalEvans('DNP', 'LP', 'DNP');
    const activePlayerSingleLp = computePlayerPlayProbability({
      name: 'Renardo Green',
      position: 'CB',
      experienceYears: 3,
      snapPct: 93,
      rosterBucket: 'active',
      gameStatus: 'Questionable',
      injuryType: 'Back',
      wed: 'LP',
      thu: '-',
      fri: '-',
      weeklyHistory: [{ week: 10, injury: 'Back', gameStatus: 'Questionable', practiceStatus: 'Limited Participation in Practice' }],
      currentWeek: 11,
      byeWeek: 8
    });

    assert.ok(wedDnp.probabilityPct >= 18 && wedDnp.probabilityPct <= 26, `Expected Wed DNP ~22%, got ${wedDnp.probabilityPct}%`);
    assert.ok(
      thuMiddayTrend.probabilityPct > wedDnp.probabilityPct && thuMiddayTrend.probabilityPct <= 42,
      `DNP-only positive uniform trend must give bounded lift (24–42%), got ${thuMiddayTrend.probabilityPct}%`
    );
    assert.ok(
      thuFirstLp.probabilityPct >= 44 && thuFirstLp.probabilityPct <= 54,
      `1st Thu LP after 3 missed games + Wed DNP must sit in cautious coin-flip band (44–54%), NOT 74%, got ${thuFirstLp.probabilityPct}%`
    );
    assert.ok(
      thuFirstLpWithTrend.probabilityPct + 18 <= activePlayerSingleLp.probabilityPct,
      `Mike Evans 1st LP (${thuFirstLpWithTrend.probabilityPct}%) must remain well below active-prior-week LP starter Renardo Green (${activePlayerSingleLp.probabilityPct}%)`
    );
    assert.ok(
      friSetback.probabilityPct < wedDnp.probabilityPct &&
        wedDnp.probabilityPct < thuMiddayTrend.probabilityPct &&
        thuMiddayTrend.probabilityPct < thuFirstLp.probabilityPct &&
        thuFirstLp.probabilityPct < friSecondLp.probabilityPct &&
        friSecondLp.probabilityPct < friThreeLp.probabilityPct &&
        friThreeLp.probabilityPct < friFull.probabilityPct,
      `Monotonicity violated: setback=${friSetback.probabilityPct}, wedDnp=${wedDnp.probabilityPct}, trend=${thuMiddayTrend.probabilityPct}, thuLp=${thuFirstLp.probabilityPct}, dnpLpLp=${friSecondLp.probabilityPct}, lpLpLp=${friThreeLp.probabilityPct}, friFp=${friFull.probabilityPct}`
    );

    // 3. Compound "Neck, Not injury related - resting player" preserves Neck & avoids factors:[] 78% fallthrough
    assert.equal(isRestOrPersonalInjuryLabel('Not injury related - resting player'), true);
    assert.equal(isRestOrPersonalInjuryLabel('NIR - Rest'), true);
    assert.equal(isRestOrPersonalInjuryLabel('Neck, Not injury related - resting player'), false);
    assert.equal(isRestOrPersonalInjuryLabel('Neck, NIR - Rest'), false);

    const compoundHtml = `
      <section><h3>San Francisco 49ers</h3><table>
        <thead><tr><th>Player</th><th>Position</th><th>Injury</th><th>Wed</th><th>Thu</th><th>Fri</th><th>Game Status</th></tr></thead>
        <tbody>
          <tr><td>Dre Greenlaw</td><td>LB</td><td>Neck, Not injury related - resting player</td><td>DNP</td><td></td><td></td><td>UNSPECIFIED</td></tr>
          <tr><td>Trent Williams</td><td>T</td><td>Not injury related - resting player</td><td>DNP</td><td></td><td></td><td>UNSPECIFIED</td></tr>
        </tbody>
      </table></section>`;
    const parsedComp = parseOfficial49ersInjuryReportHtml(compoundHtml, '');
    const gl = parsedComp.sfByKey.get('dregreenlaw');
    const tw = parsedComp.sfByKey.get('trentwilliams');
    assert.equal(gl?.injuryType, 'Neck, NIR - Rest', 'Compound medical + NIR-Rest must preserve medical body part');
    assert.equal(gl?.wed, 'DNP', 'Compound medical + NIR-Rest DNP must stay DNP, not Vet Rest');
    assert.equal(tw?.injuryType, 'NIR - Rest');
    assert.equal(tw?.wed, 'Vet Rest');
    const glProb = computePlayerPlayProbability({
      name: 'Dre Greenlaw',
      position: 'LB',
      experienceYears: 8,
      snapPct: 76,
      rosterBucket: 'active',
      gameStatus: 'Questionable',
      injuryType: gl.injuryType,
      wed: gl.wed,
      thu: '-',
      fri: '-',
      currentWeek: 11
    });
    assert.ok(glProb.factors.length > 0, 'Combined medical + rest DNP must populate explicit explanatory factors');
    assert.ok(glProb.probabilityPct >= 55 && glProb.probabilityPct <= 70, `Expected combined Neck+Rest Wed DNP in 55–70%, got ${glProb.probabilityPct}%`);

    // 4. Deterministic priorDayPlayProbabilityPct + Trajectory + % delta chip in Health table & Home card
    const mockMultiDayApp = {
      meta: { seasonYear: 2026, currentWeek: 11 },
      roster: {
        players: [
          {
            id: '16737',
            name: 'Mike Evans',
            position: 'WR',
            jersey: 5,
            experienceYears: 13,
            primarySnapPct: 54,
            capHit2026: 18_000_000,
            rosterBucket: 'active',
            health: {
              status: 'Questionable',
              injuryType: 'Achilles',
              isOnPracticeReport: true,
              wed: 'DNP',
              thu: 'LP',
              fri: '-',
              playProbabilityPct: thuFirstLp.probabilityPct,
              playBadgeLabel: thuFirstLp.badgeLabel,
              weeklyHistory2026: evansHist3Missed
            },
            recentNews: []
          }
        ]
      },
      health: { week: 11, byeWeek: 8, practiceReport: [], irAndReserveTracker: [] },
      news: { rawStream: [] },
      scheduleMatchup: {
        schedule: [{ week: 11, dateIso: kickoffIso, completed: false }],
        upcomingMatchup: { week: 11, oppAbbr: 'MIN', oppName: 'Minnesota Vikings', kickoffIso }
      }
    };
    reconcileRosterAndHealthWithNews(mockMultiDayApp, { nowMs: Date.parse('2026-11-19T23:30:00Z') });
    const evansRow = mockMultiDayApp.health.practiceReport.find(r => r.name === 'Mike Evans');
    assert.equal(evansRow?.priorDayPlayProbabilityPct, wedDnp.probabilityPct, 'Multi-day DNP/LP row must compute deterministic Wed DNP priorDayPlayProbabilityPct');

    const deltaObj = computePracticeTrajectoryDelta(evansRow, { playProbabilityPct: 42 });
    assert.ok(deltaObj && deltaObj.compactLabel.startsWith('↑ +') && deltaObj.compactLabel.endsWith('%'), `Expected compactLabel "↑ +XX%", got "${deltaObj?.compactLabel}"`);
    assert.ok(deltaObj.displayLabel.startsWith('DNP→LP +') && deltaObj.displayLabel.endsWith('%'), `Expected displayLabel "DNP→LP +XX%", got "${deltaObj?.displayLabel}"`);

    // Sign-consistency guard: stale higher Monday snapshot must NOT show contradictory negative % with upward DNP->LP arrow
    const signGuardDelta = computePracticeTrajectoryDelta(
      { wed: 'DNP', thu: 'LP', fri: '-', playProbabilityPct: 54, priorDayPlayProbabilityPct: 28 },
      { playProbabilityPct: 68 }
    );
    assert.equal(signGuardDelta.compactLabel, '↑ +26%', 'Must prefer trajectory-consistent prior-day delta over contradictory stale snapshot');

    const healthHtml = renderSeasonMatchupViewHtml({
      seasonSub: 'health',
      appData: mockMultiDayApp,
      userPrefs: { deltaSnapshots: { healthByPlayer: { '16737': { playProbabilityPct: 42 } } } }
    });
    assert.ok(
      healthHtml.includes(`data-health-delta`) && healthHtml.includes(deltaObj.compactLabel),
      `Health table must render combined trajectory + % increase chip (${deltaObj.compactLabel}), never a bare arrow`
    );

    // 5. Trailing participial teammate-beneficiary clause ("..., boosting hopes for Brock Purdy's offense") must NOT bleed Mike Evans injury news onto healthy Brock Purdy
    const { rankPlayerInjuryNews: rankInjCheck } = await import('../src/engine/injuryProbabilityModel.js');
    const purdyHealthy = { id: '4361741', name: 'Brock Purdy', position: 'QB', rosterBucket: 'active', health: { status: 'Active', isOnPracticeReport: false } };
    const wzBoostArticle = {
      id: 'wz_evans_purdy_boost',
      type: 'article',
      title: '49ers get key offensive weapon back at practice ahead of Vikings game',
      summary: "The 49ers received encouraging injury news as Mike Evans returned to practice ahead of Sunday's Vikings game, boosting hopes for Brock Purdy's offense.",
      publishedAt: '2026-11-19T20:30:03Z',
      url: 'https://www.49erswebzone.com/articles/197000/',
      author: '49ers Webzone',
      trustTier: 2,
      mentionedPlayers: [{ id: '16737', name: 'Mike Evans' }, { id: '4361741', name: 'Brock Purdy' }]
    };
    assert.equal(
      rankInjCheck(purdyHealthy, {
        rawStream: [wzBoostArticle],
        appData: { roster: { players: [purdyHealthy, { id: '16737', name: 'Mike Evans', position: 'WR' }] }, meta: { currentWeek: 11 }, scheduleMatchup: { schedule: [] } },
        nowMs: thuMiddayMs,
        includeFallbackCard: false
      }).length,
      0,
      'Teammate return article ("boosting hopes for Brock Purdy\'s offense") must NOT create Injury News on healthy Brock Purdy'
    );

    // 6. Non-speculative next-day practice-return news (before official Thursday report) MUST be credited without fabricating thu=LP or showing stale -16%
    const { hasObservedPracticeReturnSignal } = await import('../src/engine/injuryProbabilityModel.js');
    assert.equal(hasObservedPracticeReturnSignal(evansShort + ' ' + evansLong), true, 'Factual "suited up for Thursday\'s practice" sentence must pass even with conditional 2nd sentence');
    assert.equal(hasObservedPracticeReturnSignal('Mike Evans (Achilles) is practicing on the sideline today.'), true, 'Factual sideline practice observation must match');
    assert.equal(hasObservedPracticeReturnSignal(wzBoostArticle.summary), true, 'Factual "Mike Evans returned to practice" must match');
    assert.equal(hasObservedPracticeReturnSignal('Mike Evans not practicing but he was doing some work on a side field.'), false, 'Negated Wed "not practicing" must NOT match observed practice return');
    assert.equal(hasObservedPracticeReturnSignal('The 49ers are hoping to have Mike Evans back at practice this week.'), false, 'Speculative "hoping to" must NOT match observed practice return');
    assert.equal(hasObservedPracticeReturnSignal('Assuming Evans is able to log at least a limited practice Thursday.'), false, 'Conditional "Assuming..." alone must NOT match observed practice return');

    // Guard against midweek conditional "if he's cleared to return to action Sunday" deleting ESPN wire reports while keeping genuine in-game blue-tent return cancellation
    const liveThuItems = [
      {
        id: 'espn_pwire_16737_thu_real',
        wireSource: 'espn_player_wire',
        trustTier: 1,
        primaryPlayer: { id: '16737', name: 'Mike Evans' },
        mentionedPlayers: [{ id: '16737', name: 'Mike Evans' }],
        author: 'Cam Inman',
        publishedAt: '2026-11-19T20:13:00Z',
        title: evansShort,
        summary: evansLong
      },
      wzBoostArticle,
      {
        id: 'barrows_wed_dnp',
        wireSource: 'bluesky',
        trustTier: 1,
        author: 'Matt Barrows',
        publishedAt: '2026-11-18T20:55:09Z',
        title: "49ers' Air Force Academy practice observations… - Mike Evans not practicing but he was doing some work on a side field.",
        summary: ''
      }
    ];
    const thuCorroborated = evaluateCorroboratedNewsInjurySignal({
      playerName: 'Mike Evans',
      playerId: '16737',
      rosterBucket: 'active',
      newsItems: liveThuItems,
      rosterPlayerNames: ['Mike Evans', 'Brock Purdy'],
      lastCompletedGameKickoffMs: Date.parse('2026-11-15T21:25:00Z'),
      nowMs: thuMiddayMs,
      priorWeekInjuryType: 'Achilles'
    });
    assert.equal(thuCorroborated.hasSignal, true, 'Corroborated Thu Cam Inman + Webzone practice return must NOT be deleted by conditional "cleared to return" or Wed DNP');
    assert.equal(thuCorroborated.signalType, 'OBSERVED_PRACTICE_RETURN');
    assert.equal(thuCorroborated.corroboratingCount, 2, 'Both Cam Inman ESPN wire and 49ers Webzone must corroborate Thursday practice return');
    assert.ok(thuCorroborated.confidence >= 0.65, `Expected high confidence >=0.65 after superseding prior-day Wed DNP, got ${thuCorroborated.confidence}`);

    // Same-day conflicting reports (within <=6h) MUST still reduce confidence appropriately
    const sameDayConflict = evaluateCorroboratedNewsInjurySignal({
      playerName: 'Mike Evans',
      playerId: '16737',
      rosterBucket: 'active',
      newsItems: [
        liveThuItems[0],
        {
          id: 'same_day_dnp_conflict',
          wireSource: 'bluesky',
          trustTier: 1,
          author: 'Matt Barrows',
          publishedAt: '2026-11-19T19:45:00Z',
          title: 'Mike Evans (Achilles) is not practicing today at Air Force Academy.',
          summary: ''
        }
      ],
      rosterPlayerNames: ['Mike Evans'],
      lastCompletedGameKickoffMs: Date.parse('2026-11-15T21:25:00Z'),
      nowMs: thuMiddayMs,
      priorWeekInjuryType: 'Achilles'
    });
    assert.ok(
      sameDayConflict.confidence < thuCorroborated.confidence - 0.15,
      `Same-day conflicting DNP must still penalize confidence (${sameDayConflict.confidence} vs ${thuCorroborated.confidence})`
    );

    // Genuine in-game blue-tent return STILL cancels mid-game questionable-to-return tweet
    const inGameCancelSig = evaluateCorroboratedNewsInjurySignal({
      playerName: 'Renardo Green',
      playerId: '4431490',
      rosterBucket: 'active',
      newsItems: [
        {
          id: 'q2_tent_qtr',
          trustTier: 1,
          author: 'Nick Wagoner',
          publishedAt: '2026-11-15T22:10:00Z',
          title: 'CB Renardo Green (back) is questionable to return.'
        },
        {
          id: 'q2_cleared_return',
          trustTier: 1,
          author: 'Matt Maiocco',
          publishedAt: '2026-11-15T22:22:00Z',
          title: 'Renardo Green (back) was evaluated on the sideline and has been cleared to return to action.'
        }
      ],
      rosterPlayerNames: ['Renardo Green'],
      lastCompletedGameKickoffMs: Date.parse('2026-11-15T21:25:00Z'),
      windowStartMs: Date.parse('2026-11-16T00:30:00Z'),
      nowMs: Date.parse('2026-11-16T18:00:00Z')
    });
    assert.equal(inGameCancelSig.hasSignal, false, 'Genuine in-game "has been cleared to return to action" must still cancel Q2 questionable-to-return tent visit');

    // Reconcile full pre-report Thursday state: W/T/F stays DNP/-/-, probability steps cleanly above Wed DNP and below Thu LP, delta chip is positive +XX% (not -16%)
    const mockPreReportThuApp = {
      meta: { seasonYear: 2026, currentWeek: 11 },
      roster: {
        players: [
          {
            id: '16737',
            name: 'Mike Evans',
            position: 'WR',
            jersey: 5,
            experienceYears: 13,
            primarySnapPct: 54,
            capHit2026: 18_000_000,
            rosterBucket: 'active',
            health: {
              status: 'Questionable',
              injuryType: 'Achilles',
              isOnPracticeReport: true,
              wed: 'DNP',
              thu: '-',
              fri: '-',
              hasSideFieldRehab: true,
              shortComment: evansShort,
              longComment: evansLong,
              blurbDateIso: '2026-11-19T20:13:00Z',
              weeklyHistory2026: evansHist3Missed
            },
            recentNews: []
          }
        ]
      },
      health: { week: 11, byeWeek: 8, practiceReport: [], irAndReserveTracker: [] },
      news: { rawStream: liveThuItems },
      scheduleMatchup: {
        schedule: [
          { week: 10, dateIso: '2026-11-15T21:25:00Z', completed: true },
          { week: 11, dateIso: kickoffIso, completed: false }
        ],
        upcomingMatchup: { week: 11, oppAbbr: 'MIN', oppName: 'Minnesota Vikings', kickoffIso }
      }
    };
    reconcileRosterAndHealthWithNews(mockPreReportThuApp, { nowMs: thuMiddayMs });
    const preReportRow = mockPreReportThuApp.health.practiceReport.find(r => r.name === 'Mike Evans');
    assert.equal(preReportRow?.wed, 'DNP');
    assert.equal(preReportRow?.thu, '-', 'Official Thu column must remain blank ahead of official club report');
    assert.equal(preReportRow?.fri, '-');
    assert.ok(
      preReportRow.playProbabilityPct >= 34 && preReportRow.playProbabilityPct < thuFirstLp.probabilityPct,
      `Pre-report Thu practice return (${preReportRow.playProbabilityPct}%) must sit strictly above Wed DNP (~25%) and below official Thu LP (${thuFirstLp.probabilityPct}%)`
    );
    assert.equal(preReportRow.hasPreReportPracticeReturnDelta, true);
    assert.ok(preReportRow.priorDayPlayProbabilityPct >= 20 && preReportRow.priorDayPlayProbabilityPct <= 27);
    const preReportDeltaVsTue = computePracticeTrajectoryDelta(preReportRow, { playProbabilityPct: 42 });
    assert.ok(
      preReportDeltaVsTue && preReportDeltaVsTue.tone === 'positive' && preReportDeltaVsTue.compactLabel.startsWith('+'),
      `Pre-report practice return must show modest positive +XX% chip (not stale -16% vs Tuesday 42%), got ${JSON.stringify(preReportDeltaVsTue)}`
    );

    // Guard against double-counting "suited up for Thursday's practice" once official Thu LP posts
    const officialThuLpNoDouble = computePlayerPlayProbability({
      name: 'Mike Evans',
      position: 'WR',
      experienceYears: 13,
      snapPct: 54,
      rosterBucket: 'active',
      gameStatus: 'Questionable',
      injuryType: 'Achilles',
      wed: 'DNP',
      thu: 'LP',
      fri: '-',
      hasSideFieldRehab: true,
      beatNote: evansShort + ' ' + evansLong,
      corroboratedNewsSignal: thuCorroborated,
      weeklyHistory: evansHist3Missed,
      currentWeek: 11,
      byeWeek: 8,
      kickoffIso,
      nowMs: thuMiddayMs
    });
    assert.equal(
      officialThuLpNoDouble.probabilityPct,
      thuFirstLp.probabilityPct,
      'Once official Thu LP posts, "suited up for Thursday\'s practice" must NOT double-boost probability above official Thu LP'
    );

    // Guard against stale Wednesday text firing pre-report return on a Wednesday DNP
    const staleWedProb = computePlayerPlayProbability({
      name: 'Mike Evans',
      position: 'WR',
      experienceYears: 13,
      snapPct: 54,
      rosterBucket: 'active',
      gameStatus: 'Questionable',
      injuryType: 'Achilles',
      wed: 'DNP',
      thu: '-',
      fri: '-',
      beatNote: 'Mike Evans was suited up for Wednesday practice.',
      blurbDateIso: '2026-11-18T19:00:00Z',
      weeklyHistory: evansHist3Missed,
      currentWeek: 11,
      byeWeek: 8,
      kickoffIso,
      nowMs: Date.parse('2026-11-18T22:00:00Z')
    });
    assert.equal(staleWedProb.appliedPreReportPracticeReturn, false, 'Same-day/Wednesday text must NEVER trigger next-day pre-report practice return on Wed DNP');
  }
);

console.log(`\n======================================================`);
console.log(`UNIT & DATA QA SUMMARY: ${passed} Passed, ${failed} Failed`);
console.log(`======================================================\n`);

if (failed > 0) {
  process.exit(1);
}
