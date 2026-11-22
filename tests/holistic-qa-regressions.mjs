#!/usr/bin/env node
/**
 * Holistic QA Regression Suite for 49ers Faithful (49ers.joshal.com)
 * Covers multi-year season rollovers (2027–2030+), post-Week-18 elimination states,
 * live Sunday standings 17-game conservation, calibrated AFC power ratings,
 * IR-return Questionable activation modeling, and live grounding dead-money snapshots.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  DEFAULT_NFL_CALENDAR_2026,
  buildNflCalendarForSeasonYear,
  evaluateCombineLeaderboardWindow,
  evaluateMockDraftFreshnessWindow,
  evaluateSeasonState,
  evaluateTradeDeadlineStatus,
  filterConsensusBigBoard,
  partitionCompletedTradesByWindow,
  resolveFirstPickMockDatabase
} from '../src/engine/seasonStateMachine.js';
import {
  sanitizeHallucinatedRosterText,
  buildAuthoritativeLiveContextSnapshot
} from '../src/engine/groundingValidator.js';
import {
  buildTeamInjuryNewsFeed,
  classifyIrAndReserveTimeline,
  collapseInitialDots,
  computeInjuryNewsRankScore,
  computePlayerPlayProbability,
  computeTeamHealthSummary,
  doesClauseMentionPlayer,
  evaluateCorroboratedNewsInjurySignal,
  extractLivePracticeParticipationFromWire,
  extractPracticeDaysFromText,
  isPlayerEligibleForInjuryNews,
  rankPlayerInjuryNews,
  rankPlayerOverviewMentions,
  reconcileRosterAndHealthWithNews,
  resolvePlacedBeforeWeekFromDate,
  scopeBeatTextToPlayer
} from '../src/engine/injuryProbabilityModel.js';
import { runPlayoffMonteCarlo } from '../src/engine/playoffMonteCarlo.js';
import {
  WIRE_BLURB_SUMMARY_MAX_CHARS,
  deduplicateAndGroupWireItems,
  sortNewsWithBreakingPriority,
  isRedundantProfileSelfLink,
  isArticleLinkDropTweet,
  reconcileLinkDropTweetsWithArticles,
  splitSummaryForExpandableDisplay
} from '../src/engine/breakingClassifier.js';
import { getJargonEntry } from '../src/engine/jargonGlossary.js';
import {
  resolveLatestCompletedSfGame,
  evaluatePowerRankingSourceFreshness,
  resolveConsistentPowerRankings
} from '../src/engine/powerRankingsEngine.js';
import {
  parseInpredictableHtml,
  parseNfeloHtml,
  parseRbsdmRatingsJson,
  parseCbsSportsHtml,
  parseEspnFpiJson,
  parseEspnPanelArticle
} from '../scripts/lib/powerRankingsFetcher.mjs';
import {
  TEAM_STAT_UNITS_SCHEMA,
  computeLeagueTeamStatsPayload,
  refreshLiveStandingsMetricsInTeamStats,
  aggregateWeeklyNgsStats2026,
  aggregateWeeklyPfrAdvStats2026,
  normalizePositionalPeerGroup,
  resolveCareerTableSchema,
  resolveLeaderboardModalModel
} from '../src/engine/statsLeaderboardEngine.js';
import { hydrateLiveEspnOverlay, matchPlayersClient } from '../src/services/dataService.js';
import { buildClusteredNewsBriefs } from '../scripts/lib/seasonalContentBuilder.mjs';
import {
  buildEspnPlayerNewsAnchorUrl,
  encodeMarkdownLinkUrl,
  normalizeMarkdownInlineLinksInText,
  stripMarkdownInlineLinks,
  isOffTopicLeagueFiller,
  isOpaqueShortenerUrl,
  isPaywalledOrBlockedUrl,
  isStaleSeasonHeadline,
  sanitizeExternalUrl
} from '../src/engine/linkIntegrity.js';
import {
  buildXPlayerScoopSearchUrl,
  extractBeatAttributionFromText,
  isBlueskyPostUrl,
  isDirectSocialPostUrl,
  isDirectXStatusUrl,
  resolveItemAuthorProfileUrl,
  resolveOriginalTweetUrl,
  resolveReporterFromNameOrHandle,
  corroborateAndAnnotateWireStream
} from '../src/engine/beatAttributionEngine.js';
import {
  selectTopNewsBriefSourceCandidates,
  parseAndSanitizeDailyTopNewsBrief,
  repairDailyTopNewsBriefLinks
} from '../src/services/aiWorkerClient.js';
import {
  renderDailyTopNewsBriefHtml,
  renderBriefProseWithInlineLinksHtml
} from '../src/views/newsView.js';
import { renderSeasonMatchupViewHtml } from '../src/views/seasonMatchupView.js';
import {
  registerRosterPlayersForInlineLinks,
  escJargon,
  renderReporterSourceLinksHtml,
  buildEspnNflTeamUrl
} from '../src/views/uiHelpers.js';
import {
  extractWireGameDaySignals,
  isBeforeWeeklyPracticeWindow,
  resolveEarlyWeekRolloverInput,
  rolloverPracticeReportForUpcomingWeek
} from '../src/engine/gameDayRosterEngine.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  PASS  ${name}`);
  } catch (err) {
    failed++;
    console.error(`  FAIL  ${name}`);
    console.error(`        ${err.stack || err.message}`);
  }
}

async function testAsync(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`  PASS  ${name}`);
  } catch (err) {
    failed++;
    console.error(`  FAIL  ${name}`);
    console.error(`        ${err.stack || err.message}`);
  }
}

console.log('\n=== Holistic QA Regression Suite (Rollovers, Live Telemetry & Edge Invariants) ===');

test('Grounding snapshot injects real OverTheCap deadMoneyTotal ($46M+, never $0) and pivots cleanly on 2027+ rollover', () => {
  const meta = JSON.parse(fs.readFileSync(path.join(rootDir, 'data', 'meta.json'), 'utf8'));
  const cap = JSON.parse(fs.readFileSync(path.join(rootDir, 'data', 'cap.json'), 'utf8'));
  const roster = JSON.parse(fs.readFileSync(path.join(rootDir, 'data', 'roster.json'), 'utf8'));

  const snap2026 = buildAuthoritativeLiveContextSnapshot({ meta, cap, roster });
  assert.ok(
    !snap2026.includes('2026 Dead Money: $0 '),
    `Expected non-zero 2026 Dead Money from deadMoneyTotal in grounding snapshot, got: ${snap2026}`
  );
  const expectedDead26 = Number(cap.years['2026'].deadMoneyTotal || 0).toLocaleString();
  assert.ok(
    snap2026.includes(`2026 Dead Money: $${expectedDead26}`),
    `Expected 2026 Dead Money: $${expectedDead26} in snapshot`
  );

  // Simulate 2027 season rollover
  const snap2027 = buildAuthoritativeLiveContextSnapshot({
    meta: { ...meta, seasonYear: 2027, currentWeek: 4 },
    cap,
    roster,
    seasonal: { draftPrep2027: { pickInventory: [{ round: 1, origin: 'Own Pick' }] } }
  });
  assert.ok(snap2027.includes('2027 Gross Cap Space:'), 'Expected 2027 primary cap year in 2027 season');
  assert.ok(snap2027.includes('2028 Projected Cap Space:'), 'Expected 2028 horizon year in 2027 season');
  assert.ok(snap2027.includes('2028 DRAFT PICK INVENTORY'), 'Expected 2028 draft pick label in 2027 season');
});

test('Hallucination sanitizer maps departed former 49ers to position-matched active 49ers instead of replacing QBs/DBs with EDGE rushers', () => {
  const roster = JSON.parse(fs.readFileSync(path.join(rootDir, 'data', 'roster.json'), 'utf8'));
  const activeQbs = roster.players.filter(p => p.rosterBucket === 'active' && p.position === 'QB').map(p => p.name);
  const activeDbs = roster.players
    .filter(p => p.rosterBucket === 'active' && ['CB', 'S', 'DB', 'FS', 'SS'].includes(p.position))
    .map(p => p.name);

  const scrubbedQb = sanitizeHallucinatedRosterText(
    'Kyle Shanahan dialed up a bootleg throw for Jimmy Garoppolo on 2nd-and-6.',
    roster.players
  );
  assert.ok(!/Jimmy Garoppolo/i.test(scrubbedQb));
  assert.ok(activeQbs.some(qb => scrubbedQb.includes(qb)), `Expected active QB replacement, got: ${scrubbedQb}`);

  const scrubbedDb = sanitizeHallucinatedRosterText(
    'Raheem Morris rolled Charvarius Ward into press-bail Quarters.',
    roster.players
  );
  assert.ok(!/Charvarius Ward/i.test(scrubbedDb));
  assert.ok(activeDbs.some(db => scrubbedDb.includes(db)), `Expected active DB replacement, got: ${scrubbedDb}`);
});

test('Year-round state machine supports 2027+ automatic calendar rollover, zero archived blocks, factual trade status, and timezone-safe trade partitioning', () => {
  assert.deepEqual(buildNflCalendarForSeasonYear(2026), DEFAULT_NFL_CALENDAR_2026);

  // October 2027 without passing custom calendar must roll over to 2027 trade deadline with 0 archived blocks
  const oct2027 = evaluateSeasonState({
    now: '2027-10-19T18:00:00Z',
    teamStatus: { currentWeek: 7, mathematicallyEliminated: false }
  });
  assert.equal(oct2027.archivedBlocks.length, 0, 'Zero archived blocks in year-round model');
  assert.equal(oct2027.activeBlocks.length, 6, 'Tighter 6-card default Home count');
  assert.equal(oct2027.tradeDeadlineStatus.seasonYear, 2027);
  assert.equal(oct2027.tradeDeadlineStatus.isPreDeadline, true);
  assert.ok(oct2027.tradeDeadlineStatus.countdownText?.includes('Deadline:'));

  const novPost2027 = evaluateTradeDeadlineStatus({
    now: '2027-11-12T18:00:00Z'
  });
  assert.equal(novPost2027.seasonYear, 2027);
  assert.equal(novPost2027.isPostDeadlinePause, true);

  // Timezone-safe bare YYYY-MM-DD trade partitioning
  const part = partitionCompletedTradesByWindow(
    [{ player: 'Recent Acq', tradeDateIso: '2026-10-08' }, { player: 'Summer Acq', tradeDateIso: '2026-08-20' }],
    '2026-11-07T02:00:00Z',
    30
  );
  assert.equal(part.recentTrades.length, 1);
  assert.equal(part.archivedTrades.length, 1);
});

test('Injury probability model honors official Questionable + isIrReturnQuestionable on IR returners without requiring beatNote prose, and interpolates multi-week schedule gaps', () => {
  const irReturnOfficial = computePlayerPlayProbability({
    name: 'Ricky Pearsall',
    position: 'WR',
    rosterBucket: 'ir',
    gameStatus: 'Questionable',
    isIrReturnQuestionable: true,
    injuryType: 'Hamstring',
    wed: 'LP',
    thu: 'LP',
    fri: 'LP',
    beatNote: ''
  });
  assert.ok(
    irReturnOfficial.probabilityPct >= 55,
    `Expected IR-return Questionable >55% even with empty beatNote, got ${irReturnOfficial.probabilityPct}% (${irReturnOfficial.badgeLabel})`
  );
  assert.notEqual(irReturnOfficial.tier, 'OUT');

  // Season-ending IR must still hard-gate to 0% even if caller passes isIrReturnQuestionable
  const seasonEndingStillOut = computePlayerPlayProbability({
    name: 'Brandon Aiyuk',
    position: 'WR',
    rosterBucket: 'ir',
    gameStatus: 'Out for Season',
    isSeasonEnding: true,
    isIrReturnQuestionable: true,
    injuryType: 'Knee'
  });
  assert.equal(seasonEndingStillOut.probabilityPct, 0);

  // Sparse schedule interpolation (only Week 6 and Week 14 provided -> Week 2 and Week 17 still resolve accurately)
  const sparseSchedule = [
    { week: 6, dateIso: '2026-10-18T20:25:00Z' },
    { week: 14, dateIso: '2026-12-13T21:25:00Z' }
  ];
  const wk2Resolved = resolvePlacedBeforeWeekFromDate('2026-09-18T16:00:00Z', sparseSchedule, 9);
  const wk16Resolved = resolvePlacedBeforeWeekFromDate('2026-12-24T16:00:00Z', sparseSchedule, 9);
  assert.equal(wk2Resolved, 2);
  assert.equal(wk16Resolved, 16);
});

test('Playoff Monte Carlo wires calibrated afcRatings, simulates AFC-vs-AFC games for 17-game SOV/SOS, and preserves Common Random Numbers', () => {
  const baseNfc = Array.from({ length: 16 }, (_, idx) => {
    const abbrs = ['SF', 'SEA', 'LAR', 'ARI', 'DET', 'MIN', 'GB', 'CHI', 'PHI', 'DAL', 'WAS', 'NYG', 'TB', 'ATL', 'NO', 'CAR'];
    return {
      abbr: abbrs[idx],
      name: abbrs[idx],
      wins: idx === 0 ? 6 : 4,
      losses: idx === 0 ? 2 : 4,
      ties: 0,
      powerRating: idx === 0 ? 1600 : 1500
    };
  });

  const remGames = [
    { id: 'sf_lv', week: 9, home: 'SF', away: 'LV' },
    { id: 'kc_lv', week: 10, home: 'KC', away: 'LV' }
  ];

  const weakAfc = runPlayoffMonteCarlo({
    nfcTeams: baseNfc,
    afcRatings: { LV: 1250, KC: 1650 },
    afcStandings: { LV: { wins: 2, losses: 6, ties: 0 }, KC: { wins: 6, losses: 2, ties: 0 } },
    remainingGames: remGames,
    iterations: 6000,
    seed: 492026
  });
  const eliteAfc = runPlayoffMonteCarlo({
    nfcTeams: baseNfc,
    afcRatings: { LV: 1750, KC: 1650 },
    afcStandings: { LV: { wins: 7, losses: 1, ties: 0 }, KC: { wins: 6, losses: 2, ties: 0 } },
    remainingGames: remGames,
    iterations: 6000,
    seed: 492026
  });

  assert.ok(
    weakAfc.sfOdds.projectedWins > eliteAfc.sfOdds.projectedWins + 0.35,
    `Expected calibrated afcRatings to impact SF projected wins (${weakAfc.sfOdds.projectedWins} vs ${eliteAfc.sfOdds.projectedWins})`
  );
});

test('Breaking badge expires cleanly after activeWindowHours while recent breaking items keep their badge', () => {
  const nowMs = Date.parse('2026-11-08T22:00:00Z');
  const sorted = sortNewsWithBreakingPriority(
    [
      {
        id: 'stale_brk',
        title: 'BREAKING: 49ers trade for DT DeForest Buckner',
        publishedAt: new Date(nowMs - 48 * 3_600_000).toISOString()
      },
      {
        id: 'fresh_brk',
        title: 'Injury update: Nick Bosa (ankle) is questionable to return',
        publishedAt: new Date(nowMs - 10 * 60_000).toISOString()
      }
    ],
    nowMs,
    { activeWindowHours: 18 }
  );
  assert.equal(sorted[0].id, 'fresh_brk');
  assert.equal(sorted[0].breakingBadge, 'LIVE INJURY UPDATE');
  assert.equal(sorted[1].breakingBadge, null, '48h-old item must not keep flashing breaking badge');
});

await testAsync('hydrateLiveEspnOverlay prunes completed NFC rival games (preventing 18-game double-counting), updates seedPathCards.currentProbPct, and resolves suffix-safe player chips + reporter bylines', async () => {
  const mockAppData = {
    meta: JSON.parse(fs.readFileSync(path.join(rootDir, 'data', 'meta.json'), 'utf8')),
    roster: JSON.parse(fs.readFileSync(path.join(rootDir, 'data', 'roster.json'), 'utf8')),
    reporters: JSON.parse(fs.readFileSync(path.join(rootDir, 'data', 'reporters.json'), 'utf8')),
    health: JSON.parse(fs.readFileSync(path.join(rootDir, 'data', 'health.json'), 'utf8')),
    news: JSON.parse(fs.readFileSync(path.join(rootDir, 'data', 'news.json'), 'utf8')),
    scheduleMatchup: JSON.parse(fs.readFileSync(path.join(rootDir, 'data', 'schedule-matchup.json'), 'utf8')),
    seasonal: JSON.parse(fs.readFileSync(path.join(rootDir, 'data', 'seasonal.json'), 'utf8'))
  };

  const simIn = mockAppData.seasonal.playoffPicture.simulatorInputs;
  // Pick an early-slate non-SF NFC-vs-NFC game in remainingGames to simulate completing while SF is still 6-1
  const rivalGame = simIn.remainingGames.find(
    g => g.home !== 'SF' && g.away !== 'SF' && simIn.nfcTeams.some(t => t.abbr === g.home) && simIn.nfcTeams.some(t => t.abbr === g.away)
  );
  assert.ok(rivalGame, 'Expected an NFC rival game in remainingGames');

  const homeTeamBase = simIn.nfcTeams.find(t => t.abbr === rivalGame.home);
  const awayTeamBase = simIn.nfcTeams.find(t => t.abbr === rivalGame.away);
  const sfBase = simIn.nfcTeams.find(t => t.abbr === 'SF');

  const standingsEntries = simIn.nfcTeams.map(nt => {
    let wins = nt.wins;
    let losses = nt.losses;
    if (nt.abbr === homeTeamBase.abbr) wins += 1;
    if (nt.abbr === awayTeamBase.abbr) losses += 1;
    return {
      team: { abbreviation: nt.abbr },
      stats: [
        { name: 'overall', displayValue: `${wins}-${losses}${nt.ties ? `-${nt.ties}` : ''}` },
        { name: 'wins', value: wins },
        { name: 'losses', value: losses },
        { name: 'ties', value: nt.ties || 0 },
        { name: 'winPercent', value: wins / Math.max(1, wins + losses) },
        { name: 'pointDifferential', value: nt.pointDiff || 0 },
        { name: 'pointsFor', value: 200 },
        { name: 'pointsAgainst', value: 150 },
        { name: 'playoffSeed', value: nt.abbr === 'SF' ? 1 : 4 }
      ]
    };
  });

  mockAppData.roster.players.push({
    id: 'qa_no_shortname_jr',
    name: 'Test Prospect Jr.',
    position: 'WR',
    jersey: 89,
    rosterBucket: 'active'
  });

  const origFetch = globalThis.fetch;
  globalThis.fetch = async url => {
    const u = String(url);
    if (u.includes('/standings')) {
      return new Response(JSON.stringify({ children: [{ standings: { entries: standingsEntries } }] }), { status: 200 });
    }
    if (u.includes('/teams/sf/schedule')) {
      return new Response(JSON.stringify({ events: [] }), { status: 200 });
    }
    if (u.includes('/injuries')) {
      return new Response(JSON.stringify({ injuries: [] }), { status: 200 });
    }
    if (u.includes('/news')) {
      return new Response(
        JSON.stringify({
          articles: [
            {
              id: 'espn_qa_schefter_1',
              byline: 'By Adam Schefter',
              headline: 'Deebo Samuel Sr., Test Prospect Jr., and Brock Purdy headline 49ers offensive game plan',
              description: 'San Francisco prepares for Sunday afternoon kickoff.',
              published: '2026-11-08T16:00:00Z',
              links: { web: { href: 'https://www.espn.com/nfl/story/_/id/888777/49ers-plan' } }
            }
          ]
        }),
        { status: 200 }
      );
    }
    return new Response('{}', { status: 200 });
  };

  try {
    assert.ok(sfBase, 'Expected SF in nfcTeams');
    const changed = await hydrateLiveEspnOverlay(mockAppData);
    assert.equal(changed, true);

    // Every single NFC team must still sum to exactly 17 games (played + remainingGames == 17)
    const afterSimIn = mockAppData.seasonal.playoffPicture.simulatorInputs;
    for (const nt of afterSimIn.nfcTeams) {
      const played = (nt.wins || 0) + (nt.losses || 0) + (nt.ties || 0);
      const rem = afterSimIn.remainingGames.filter(g => g.home === nt.abbr || g.away === nt.abbr).length;
      assert.equal(
        played + rem,
        17,
        `NFC team ${nt.abbr} violated 17-game season invariant after rival game finished: ${played} played + ${rem} remaining = ${played + rem}`
      );
    }

    // seedPathCards.currentProbPct must match fresh baselineSimulation.sfOdds
    const freshSf = mockAppData.seasonal.playoffPicture.baselineSimulation.sfOdds;
    const cards = mockAppData.seasonal.playoffPicture.seedPathCards;
    assert.equal(cards[0].currentProbPct, freshSf.seed1ByePct);
    assert.equal(cards[1].currentProbPct, freshSf.winDivisionPct);
    assert.equal(cards[2].currentProbPct, freshSf.makePlayoffsPct);

    // Schefter article attribution & suffix-safe shortName fallback
    const injectedArt = mockAppData.news.rawStream.find(a => a.id === 'espn_live_espn_qa_schefter_1');
    assert.ok(injectedArt, 'Expected injected ESPN article');
    assert.equal(injectedArt.reporterId, 'adam_schefter');
    const deeboMention = injectedArt.mentionedPlayers.find(m => m.name.includes('Deebo Samuel'));
    assert.ok(deeboMention && deeboMention.shortName.includes('Samuel') && deeboMention.shortName !== 'D. Sr.');
    const jrFallbackMention = injectedArt.mentionedPlayers.find(m => m.id === 'qa_no_shortname_jr');
    assert.ok(jrFallbackMention, 'Expected fallback player mention');
    assert.equal(jrFallbackMention.shortName, 'T. Prospect');
  } finally {
    globalThis.fetch = origFetch;
  }
});

await testAsync('buildClusteredNewsBriefs generates dynamic clusters in 2027 Week 9 instead of replaying 2026 Raiders Week 9 clusters', async () => {
  const clusters2027Wk9 = await buildClusteredNewsBriefs(
    [],
    [
      {
        title: '49ers open 2027 Week 9 preparation for Dallas Cowboys',
        summary: 'Kyle Shanahan previews Sunday night showdown.',
        url: 'https://www.espn.com/nfl/team/_/name/sf/san-francisco-49ers',
        outletName: 'ESPN',
        type: 'article',
        publishedAt: '2027-11-04T18:00:00Z'
      }
    ],
    [],
    {
      seasonYear: 2027,
      currentWeek: 9,
      teamRecord: '7-1',
      standingSummary: '1st in NFC West',
      upcomingMatchup: {
        week: 9,
        oppAbbr: 'DAL',
        oppName: 'Dallas Cowboys',
        oppRecord: '5-3',
        homeAway: 'home',
        kickoffDisplay: 'Sun, Nov 7 • 5:20 PM PT (NBC)'
      }
    }
  );
  assert.ok(clusters2027Wk9.length >= 2);
  assert.ok(
    !JSON.stringify(clusters2027Wk9).includes('Raiders'),
    '2027 Week 9 vs Dallas must not replay 2026 Week 9 Raiders cluster'
  );
});

await testAsync('Link scrub & attribution integrity: zero dead 404s, zero opaque shorteners/wrappers, zero coach-as-journalist or cross-reporter X profile bugs', async () => {
  // 1. Dead ESPN paths & opaque shorteners blocked; tracking params stripped cleanly
  assert.equal(isPaywalledOrBlockedUrl('https://www.espn.com/nfl/draft2027'), true);
  assert.equal(isPaywalledOrBlockedUrl('https://www.espn.com/nfl/story/_/page/nflpowerrankings'), true);
  assert.equal(isOpaqueShortenerUrl('https://dlvr.it/TWFclL'), true);
  assert.equal(sanitizeExternalUrl('https://dlvr.it/TWFclL', null), null);
  assert.equal(
    sanitizeExternalUrl('https://nfltraderumors.co/trade-deadline-buzz-49ers/?utm_source=dlvr.it&utm_medium=bluesky', null),
    'https://nfltraderumors.co/trade-deadline-buzz-49ers/'
  );

  // 2. Podium subjects (Kyle Shanahan / John Lynch) never hijack journalist tweet attribution
  const schefterQuotingShanahan = extractBeatAttributionFromText(
    '49ers DT Gracen Halton broke his ankle and is out for the season, per Kyle Shanahan.',
    {
      reporterId: 'adam_schefter',
      reporterName: 'Adam Schefter',
      authorHandle: '@AdamSchefter',
      outletId: 'espn',
      outletName: 'ESPN NFL Insider'
    }
  );
  assert.equal(schefterQuotingShanahan.author, 'Adam Schefter');
  assert.equal(schefterQuotingShanahan.authorHandle, '@AdamSchefter');
  assert.equal(schefterQuotingShanahan.xUrl, 'https://x.com/AdamSchefter');

  // 3. Cross-reporter X profile guard prevents linking Dan Graziano / Kerry Crowley to @nwagoner / @timkawakami
  assert.equal(
    resolveItemAuthorProfileUrl(
      { author: 'Dan Graziano', outletId: 'espn', authorProfileUrl: 'https://x.com/nwagoner' },
      'https://www.espn.com/nfl/story/_/id/123/test'
    ),
    'https://www.espn.com/nfl/team/_/name/sf/san-francisco-49ers'
  );
  assert.equal(
    resolveItemAuthorProfileUrl(
      { author: 'Kerry Crowley', outletId: 'sf_standard', authorProfileUrl: 'https://x.com/timkawakami' },
      'https://sfstandard.com/2026/11/06/test/'
    ),
    'https://sfstandard.com/sports/'
  );
  assert.equal(
    resolveItemAuthorProfileUrl(
      { author: 'Nick Wagoner', outletId: 'espn', authorProfileUrl: 'https://x.com/nwagoner' },
      'https://www.espn.com/nfl/story/_/id/123/test'
    ),
    'https://x.com/nwagoner'
  );

  // 4. Off-topic league filler & stale preseason/early-week guards
  assert.equal(
    isOffTopicLeagueFiller({
      url: 'https://www.espn.com/fantasy/football/story/_/id/50380217/nfl-survivor-week-9',
      title: 'NFL survivor power rankings: Why this is the week to use Seahawks, Chiefs',
      summary: ''
    }),
    true
  );
  assert.equal(
    isStaleSeasonHeadline('49ers announce roster moves ahead of Week 1 clash vs. Rams', 10),
    true
  );
  assert.equal(
    isStaleSeasonHeadline('49ers 2026 Roster Tracker: Cut-down to 53 players', 10),
    true
  );

  // 5. Compiled data/news.json, data/roster.json & data/schedule-matchup.json scrub assertions
  const newsJson = JSON.parse(fs.readFileSync(path.join(rootDir, 'data', 'news.json'), 'utf8'));
  const rosterJson = JSON.parse(fs.readFileSync(path.join(rootDir, 'data', 'roster.json'), 'utf8'));
  const smJson = JSON.parse(fs.readFileSync(path.join(rootDir, 'data', 'schedule-matchup.json'), 'utf8'));

  for (const src of smJson.powerRankings?.sources || []) {
    assert.ok(!src.url.includes('nflpowerrankings'), `Dead ESPN power rankings URL remained: ${src.url}`);
    assert.equal(isPaywalledOrBlockedUrl(src.url), false, `Blocked power rankings URL: ${src.url}`);
  }

  for (const item of newsJson.rawStream || []) {
    assert.ok(!/news\.google\.com\/rss\/articles/i.test(item.url || ''), `Opaque Google News wrapper in news.json: ${item.url}`);
    assert.ok(!isOpaqueShortenerUrl(item.url || ''), `Shortener URL in news.json: ${item.url}`);
    if (item.externalUrl) {
      assert.ok(!isOpaqueShortenerUrl(item.externalUrl), `Shortener externalUrl in news.json: ${item.externalUrl}`);
      assert.ok(!/utm_source=/i.test(item.externalUrl), `Unstripped utm_source in externalUrl: ${item.externalUrl}`);
    }
    assert.ok(!/^(Kyle Shanahan|John Lynch)$/i.test(item.author || ''), `Coach/GM misattributed as author on ${item.id}: ${item.author}`);
    assert.ok(!/&#\d+;/.test(item.title || ''), `Unescaped numeric HTML entity in title: ${item.title}`);
  }

  for (const p of rosterJson.players || []) {
    for (const rn of p.recentNews || []) {
      assert.ok(!/news\.google\.com\/rss\/articles/i.test(rn.url || ''), `Opaque Google News wrapper in ${p.name} recentNews: ${rn.url}`);
      assert.ok(!/^(Kyle Shanahan|John Lynch)$/i.test(rn.author || ''), `Coach/GM misattributed as author in ${p.name} recentNews: ${rn.author}`);
    }
  }
});

test('Game-day clause isolation, DST practice-window accuracy, early-week rollover pruning & unpracticed play-probability calibration', () => {
  // 1. Multi-player mixed active/inactive tweet must never cross-contaminate active players as inactive
  const signals = extractWireGameDaySignals(
    [
      {
        title: '49ers gameday status',
        fullText: 'Nick Bosa and Christian McCaffrey are officially active today, while Mike Evans is inactive vs. Dallas.',
        publishedAt: '2026-11-15T19:45:00Z'
      }
    ],
    [{ name: 'Nick Bosa' }, { name: 'Christian McCaffrey' }, { name: 'Mike Evans' }],
    Date.parse('2026-11-15T21:25:00Z')
  );
  assert.equal(signals.activeKeys.has('nickbosa'), true);
  assert.equal(signals.activeKeys.has('christianmccaffrey'), true);
  assert.equal(signals.inactiveKeys.has('nickbosa'), false, 'Active player Nick Bosa must not leak into inactiveKeys');
  assert.equal(signals.inactiveKeys.has('christianmccaffrey'), false);
  assert.equal(signals.inactiveKeys.has('mikeevans'), true);
  assert.equal(signals.activeKeys.has('mikeevans'), false);

  // 2. DST-exact Pacific weekday evaluation (September PDT UTC-7 vs November PST UTC-8)
  // Sept 20, 2026 1:05 PM PDT = 2026-09-20T20:05:00Z -> Wednesday practice opens Sept 16, 2026 12:00 PM PDT (19:00Z)
  const pdtKickoff = '2026-09-20T20:05:00Z';
  assert.equal(isBeforeWeeklyPracticeWindow(pdtKickoff, Date.parse('2026-09-16T18:30:00Z')), true);
  assert.equal(isBeforeWeeklyPracticeWindow(pdtKickoff, Date.parse('2026-09-16T19:30:00Z')), false);

  // Nov 15, 2026 1:25 PM PST = 2026-11-15T21:25:00Z -> Wednesday practice opens Nov 11, 2026 12:00 PM PST (20:00Z)
  const pstKickoff = '2026-11-15T21:25:00Z';
  assert.equal(isBeforeWeeklyPracticeWindow(pstKickoff, Date.parse('2026-11-11T19:30:00Z')), true);
  assert.equal(isBeforeWeeklyPracticeWindow(pstKickoff, Date.parse('2026-11-11T20:30:00Z')), false);

  // 3. Pre-game cleared players ("does not carry an official injury designation") skip Week N+1 rollover
  const clearedSigle = resolveEarlyWeekRolloverInput({
    rawStatus: 'Questionable',
    injuryType: 'Ankle',
    shortComment: "Sigle (ankle) does not carry an official injury designation ahead of Sunday's game versus the Raiders.",
    longComment: "He's now set to get back on the field in Week 9.",
    upcomingWeek: 10
  });
  assert.equal(clearedSigle.skip, true, 'Pre-game cleared player with zero in-game injury must skip rollover');

  // 4. Prior-game "will miss his second straight game" + unpracticed multi-week / new injury calibration
  const rolled = rolloverPracticeReportForUpcomingWeek(
    [
      {
        name: 'Luke Schoonmaker',
        position: 'TE',
        snapPct: 50,
        injuryType: 'Groin',
        gameStatus: 'Out',
        shortComment: "Schoonmaker (groin) is inactive for Sunday's clash against the Colts.",
        beatNote:
          'Schoonmaker continues to tend to a groin issue and will miss his second straight game. He did manage a trio of limited practices during the week, so the tight end may be able to play next Sunday, Nov. 15, against San Francisco.'
      },
      {
        name: 'Mike Evans',
        position: 'WR',
        snapPct: 80,
        injuryType: 'Achilles',
        gameStatus: 'Out',
        shortComment: `Evans (Achilles), who won't play in Sunday's game against the Raiders, appears to be "questionable at best" for next Sunday's road matchup with the Cowboys.`,
        beatNote: "Evans is missing a second straight contest Sunday. He hasn't been able to practice in the meantime."
      },
      {
        name: 'Deommodore Lenoir',
        position: 'CB',
        snapPct: 96,
        injuryType: 'Foot',
        gameStatus: 'Questionable',
        sustainedInLastGame: true,
        shortComment: "Lenoir sustained a foot injury during Sunday's 38-17 win against Las Vegas.",
        beatNote: "Head coach Kyle Shanahan explained after the game that the cornerback hasn't been ruled out for Week 10."
      }
    ],
    { clearPracticeDays: true, upcomingWeek: 10 }
  );

  const schoonmaker = rolled.find(r => r.name === 'Luke Schoonmaker');
  const evans = rolled.find(r => r.name === 'Mike Evans');
  const lenoir = rolled.find(r => r.name === 'Deommodore Lenoir');
  assert.ok(schoonmaker && schoonmaker.playProbabilityPct >= 65, `Expected Schoonmaker >=65%, got ${schoonmaker?.playProbabilityPct}%`);
  assert.ok(evans && evans.playProbabilityPct <= 50, `Expected unpracticed multi-week Evans <=50%, got ${evans?.playProbabilityPct}%`);
  assert.ok(lenoir && lenoir.playProbabilityPct <= 84, `Expected unpracticed injured Lenoir <=84% GTD, got ${lenoir?.playProbabilityPct}%`);

  // 5. Corroboration pass preserves safe author profile URLs and never assigns coach/cross-reporter X URLs
  const corroborated = corroborateAndAnnotateWireStream([
    {
      id: 'c1',
      author: 'Dan Graziano',
      outletId: 'espn',
      authorProfileUrl: 'https://x.com/nwagoner',
      url: 'https://www.espn.com/nfl/story/_/id/555/test',
      title: '49ers DT Gracen Halton out for season per Kyle Shanahan',
      publishedAt: '2026-11-08T23:00:00Z'
    }
  ]);
  assert.equal(corroborated[0].author, 'Dan Graziano');
  assert.equal(corroborated[0].authorProfileUrl, 'https://www.espn.com/nfl/team/_/name/sf/san-francisco-49ers');
});

test('Site-wide link, tooltip, inline-player, cross-mentioned tweet subject & entity-URI regressions', () => {
  // 1. Every jargonTerm(label, key) call in src/views and src/components must resolve to a real glossary entry
  for (const dirRel of ['src/views', 'src/components']) {
    const dirAbs = path.join(rootDir, dirRel);
    for (const file of fs.readdirSync(dirAbs).filter(f => f.endsWith('.js'))) {
      const src = fs.readFileSync(path.join(dirAbs, file), 'utf8');
      const re = /jargonTerm\(\s*(['"`])([^'"`]+)\1(?:\s*,\s*(['"`])([^'"`]+)\3)?\s*\)/g;
      let m;
      while ((m = re.exec(src)) !== null) {
        const label = m[2];
        const key = m[4] || label;
        const entry = getJargonEntry(key) || getJargonEntry(label);
        assert.ok(entry, `Dead jargonTerm("${label}", "${key}") in ${dirRel}/${file}`);
      }
    }
  }
  assert.ok(getJargonEntry('dead_cap'), 'dead_cap synonym must resolve');
  assert.ok(getJargonEntry('11_personnel'), '11_personnel synonym must resolve');
  assert.ok(getJargonEntry('21_personnel'), '21_personnel synonym must resolve');

  // 2. Cross-mentioned tweet subject extraction resolves lead injured player ("Evans") instead of secondary dossier player ("Cooks")
  const crossMentionTweetUrl = resolveOriginalTweetUrl({
    type: 'tweet',
    author: 'Mike Garafolo',
    authorHandle: '@MikeGarafolo',
    title: `Evans (Achilles), who won't play in Sunday's game against the Raiders, appears to be "questionable at best" for Week 10, Mike Garafolo of NFL Network reports.`,
    fullText: `Evans (Achilles), who won't play in Sunday's game against the Raiders, appears to be "questionable at best" for Week 10. Brandin Cooks and Jordan Watkins will lead the receiver rotation.`,
    primaryPlayer: { name: 'Brandin Cooks' },
    url: 'https://www.espn.com/nfl/player/_/id/16731/brandin-cooks'
  });
  assert.ok(
    crossMentionTweetUrl.includes('from%3AMikeGarafolo') && crossMentionTweetUrl.includes('%22Evans%22'),
    `Expected Mike Garafolo tweet URL to target "Evans", got: ${crossMentionTweetUrl}`
  );
  assert.ok(!crossMentionTweetUrl.includes('Cooks'), `Cross-mentioned secondary player leaked into tweet search: ${crossMentionTweetUrl}`);

  // 3. Newly mapped beat & draft voices resolve to verified X handles and 0 tweets in news.json lack handle/direct post
  for (const voice of ['Harrison Rich', 'Dane Brugler', 'Mel Kiper Jr.', 'Daniel Jeremiah', 'Lance Zierlein']) {
    const rep = resolveReporterFromNameOrHandle(voice);
    assert.ok(rep?.xUrl?.startsWith('https://x.com/'), `Missing verified X handle for ${voice}`);
  }
  const newsJson = JSON.parse(fs.readFileSync(path.join(rootDir, 'data', 'news.json'), 'utf8'));
  const directPosts = (newsJson.rawStream || []).filter(
    it => (it.type === 'tweet' || it.type === 'social') && isDirectSocialPostUrl(it.url || '')
  );
  for (const tw of (newsJson.rawStream || []).filter(it => it.type === 'tweet' || it.type === 'social')) {
    const resolved = resolveOriginalTweetUrl(tw, directPosts);
    assert.ok(
      isDirectSocialPostUrl(resolved),
      `Tweet ${tw.id} (${tw.author}) must resolve to a verified direct social/transaction post URL (never dead x.com/search): ${resolved}`
    );
    assert.ok(
      !resolved.includes('x.com/search'),
      `Tweet ${tw.id} (${tw.author}) must not fall back to speculative x.com/search: ${resolved}`
    );
    assert.ok(
      !String(tw.authorProfileUrl || '').includes('bsky.app'),
      `Tweet ${tw.id} authorProfileUrl should remain canonical X profile: ${tw.authorProfileUrl}`
    );
  }

  // Verified Bluesky post permalink is preserved when no matching X status tweet exists,
  // and upgraded to `https://x.com/<handle>/status/<id>` ONLY when an exact mirror tweet exists on X!
  const preservedBskyUrl = resolveOriginalTweetUrl({
    type: 'tweet',
    url: 'https://bsky.app/profile/mattbarrows.bsky.social/post/3n22svbobls27',
    author: 'Matt Barrows',
    reporterId: 'matt_barrows',
    title: 'CBs Renardo Green (back) and Deommodore Lenoir (foot) are not practicing today.',
    fullText: 'CBs Renardo Green (back) and Deommodore Lenoir (foot) are not practicing today.',
    publishedAt: '2026-11-11T21:10:00.000Z'
  });
  assert.equal(
    preservedBskyUrl,
    'https://bsky.app/profile/mattbarrows.bsky.social/post/3n22svbobls27',
    `Bluesky-primary post must preserve its live bsky.app permalink instead of a dead from:mattbarrows X search: ${preservedBskyUrl}`
  );

  const upgradedMirrorXUrl = resolveOriginalTweetUrl(
    {
      type: 'tweet',
      url: 'https://bsky.app/profile/mattmaiocco.bsky.social/post/3mztosm6ikc2f',
      author: 'Matt Maiocco',
      authorHandle: '@MaioccoNBCS',
      title: 'Rookie DL Gracen Halton fractured his ankle, 49ers coach Kyle Shanahan said.',
      fullText: 'Rookie DL Gracen Halton fractured his ankle, 49ers coach Kyle Shanahan said.',
      publishedAt: '2026-11-09T00:39:17.526Z'
    },
    [
      {
        type: 'tweet',
        url: 'https://x.com/MaioccoNBCS/status/2119551122334455667',
        author: 'Matt Maiocco',
        authorHandle: '@MaioccoNBCS',
        fullText: 'Rookie DL Gracen Halton fractured his ankle, 49ers coach Kyle Shanahan said.',
        publishedAt: '2026-11-09T00:38:55.000Z'
      }
    ]
  );
  assert.equal(
    upgradedMirrorXUrl,
    'https://x.com/MaioccoNBCS/status/2119551122334455667',
    `Cross-posted Bluesky mirror with matching X status tweet must upgrade to x.com/<handle>/status/<id>: ${upgradedMirrorXUrl}`
  );

  // Verify blocked/broken URL patterns (bare ESPN /video/clip 404, RotoWire /football/headlines 403, Heavy Cloudflare 403) and ESPN #:~:text= anchor builder
  assert.equal(isPaywalledOrBlockedUrl('https://www.espn.com/video/clip'), true);
  assert.equal(isPaywalledOrBlockedUrl('https://www.rotowire.com/football/headlines/test-999'), true);
  assert.equal(isPaywalledOrBlockedUrl('https://heavy.com/sports/nfl/san-francisco-49ers/test-story/'), true);
  const espnAnchor = buildEspnPlayerNewsAnchorUrl(
    '3126486',
    'Deebo Samuel Sr.',
    'Samuel (hamstring) was a limited practice participant Wednesday, Matt Barrows of The Athletic reports.'
  );
  assert.equal(
    espnAnchor,
    'https://www.espn.com/nfl/player/_/id/3126486/deebo-samuel-sr#:~:text=Samuel%20(hamstring)%20was%20a%20limited%20practice%20participant'
  );
  assert.equal(sanitizeExternalUrl(espnAnchor, null), espnAnchor);

  // 4. Redundant self-link suppressor catches utm_*, www., and trailing-slash variants
  assert.equal(
    isRedundantProfileSelfLink(
      'https://www.49erswebzone.com/articles/195000-test/?utm_source=rss',
      'https://49erswebzone.com/articles/195000-test'
    ),
    true
  );

  // 5. Inline roster player linker & multi-delimiter reporter link helper
  const rosterJson = JSON.parse(fs.readFileSync(path.join(rootDir, 'data', 'roster.json'), 'utf8'));
  registerRosterPlayersForInlineLinks(rosterJson.players);
  const annotatedHtml = escJargon('Brock Purdy hit George Kittle on a Wide-9 hot read.', {
    excludePlayerId: '4361741'
  });
  assert.ok(!annotatedHtml.includes('data-player-id="4361741"'), 'Excluded self dossier player should not self-link');
  assert.ok(annotatedHtml.includes('class="inline-player-link"') && annotatedHtml.includes('George Kittle'), 'Expected inline player link for George Kittle');
  assert.ok(annotatedHtml.includes('data-jargon="wide_9"'), 'Expected inline jargon link for Wide-9');
  const hostLinksHtml = renderReporterSourceLinksHtml('Matt Maiocco & Laura Britt');
  assert.ok(hostLinksHtml.includes('https://x.com/MaioccoNBCS') && hostLinksHtml.includes(' &amp; Laura Britt'));
  assert.equal(buildEspnNflTeamUrl('WAS'), 'https://www.espn.com/nfl/team/_/name/wsh/washington-commanders');

  // 6. Compiled JSON entity-link & playerId integrity across roster, cap, health, depth, matchup & seasonal
  const capJson = JSON.parse(fs.readFileSync(path.join(rootDir, 'data', 'cap.json'), 'utf8'));
  const healthJson = JSON.parse(fs.readFileSync(path.join(rootDir, 'data', 'health.json'), 'utf8'));
  const depthJson = JSON.parse(fs.readFileSync(path.join(rootDir, 'data', 'depth-chart.json'), 'utf8'));
  const smJson = JSON.parse(fs.readFileSync(path.join(rootDir, 'data', 'schedule-matchup.json'), 'utf8'));
  const seasonalJson = JSON.parse(fs.readFileSync(path.join(rootDir, 'data', 'seasonal.json'), 'utf8'));

  const validPlayerIds = new Set();
  for (const p of rosterJson.players || []) {
    if (p.id) validPlayerIds.add(String(p.id));
    if (p.otcId) validPlayerIds.add(String(p.otcId));
    if (p.pfrId) validPlayerIds.add(String(p.pfrId));
    for (const comp of p.spiderProfile?.historicalComps || []) {
      assert.ok(
        /^https:\/\/www\.pro-football-reference\.com\/(?:players\/|search\/search\.fcgi\?search=)/.test(String(comp.pfrUrl || '')),
        `Missing historicalComp pfrUrl on ${p.name} -> ${comp.name}: ${comp.pfrUrl}`
      );
    }
  }

  for (const r of [...(healthJson.practiceReport || []), ...(healthJson.injuredReserve || [])]) {
    assert.ok(r.playerId && validPlayerIds.has(String(r.playerId)), `Unresolved health playerId for ${r.name}: ${r.playerId}`);
  }
  for (const u of depthJson.units || []) {
    for (const row of u.rows || []) {
      for (const c of [...(row.projectedActiveChain || []), ...(row.baselineChain || [])]) {
        assert.ok(c.playerId && validPlayerIds.has(String(c.playerId)), `Unresolved depth playerId for ${c.name}: ${c.playerId}`);
      }
    }
  }
  for (const m of seasonalJson.tradeWarRoom?.completed2026Moves || []) {
    assert.ok(m.playerId && validPlayerIds.has(String(m.playerId)), `Unresolved completed trade playerId for ${m.player}`);
  }
  for (const pk of seasonalJson.draftClass2026?.picks || []) {
    assert.ok(pk.playerId && validPlayerIds.has(String(pk.playerId)), `Unresolved 2026 draft pick playerId for ${pk.name}`);
  }
  for (const ud of seasonalJson.draftClass2026?.priorityUdfas || []) {
    assert.ok(ud.playerId && validPlayerIds.has(String(ud.playerId)), `Unresolved priority UDFA playerId for ${ud.name}`);
  }
  for (const dm of capJson.years?.['2026']?.topDeadMoneyEntries || []) {
    assert.ok(String(dm.otcUrl || '').startsWith('https://overthecap.com/player/'), `Missing dead money otcUrl for ${dm.name}`);
  }
  for (const hg of smJson.franchiseHistory?.recentGames || []) {
    assert.ok(String(hg.boxscoreUrl || '').startsWith('https://'), `Missing H2H boxscoreUrl on ${hg.season} Wk ${hg.week}`);
  }
  for (const pf of seasonalJson.tradeWarRoom?.pitfallsToAvoid || []) {
    assert.ok(Array.isArray(pf.exampleLinks) && pf.exampleLinks.length > 0, `Missing exampleLinks on pitfall: ${pf.trap}`);
    for (const el of pf.exampleLinks) {
      assert.ok(String(el.url || '').startsWith('https://overthecap.com/player/'), `Invalid pitfall example URL: ${el.url}`);
    }
  }
  for (const mt of seasonalJson.draftPrep2027?.consensusMockTargets || []) {
    assert.ok(Array.isArray(mt.prospectLinks) && mt.prospectLinks.length > 0, `Missing prospectLinks on mock target: ${mt.name}`);
    for (const pl of mt.prospectLinks) {
      assert.ok(String(pl.url || '').startsWith('https://'), `Invalid mock prospect URL: ${pl.url}`);
    }
  }
});

await testAsync('Trust-weighted corroborated news & prior-week absence calibration aligns Deebo, Mike Evans & C.J. West without overcorrecting on single/speculative tweets', async () => {
  // 1. Initialism normalization ("CJ West" <-> "C.J. West") across matchPlayersClient, clause matcher & inline links
  assert.equal(collapseInitialDots('C.J. West'), 'CJ West');
  assert.equal(doesClauseMentionPlayer('Shanahan is hopeful to get Deebo Samuel and CJ West back to practice.', 'C.J. West'), true);
  assert.equal(doesClauseMentionPlayer('NFC West standings heading into Week 10', 'C.J. West'), false, 'NFC West must never match C.J. West');

  const sampleRoster = [
    { id: '3126486', name: 'Deebo Samuel Sr.', shortName: 'D. Samuel Sr.', position: 'WR', jersey: 19 },
    { id: '16737', name: 'Mike Evans', shortName: 'M. Evans', position: 'WR', jersey: 5 },
    { id: '4686308', name: 'C.J. West', shortName: 'C. West', position: 'DT', jersey: 99 }
  ];
  const barrowsTweet =
    "Shanahan said he's hopeful to get Deebo Samuel and CJ West back to practice on Wednesday. The team is not expecting Mike Evans this week.";
  const matchedChips = matchPlayersClient(barrowsTweet, sampleRoster, 10);
  assert.deepEqual(
    matchedChips.map(m => m.name),
    ['Deebo Samuel Sr.', 'Mike Evans', 'C.J. West'],
    'Multi-player tweet with dotless "CJ West" must match all three players'
  );

  // 2. Clause-level per-player scoping prevents cross-player bleed between adjacent sentences
  const deeboScoped = scopeBeatTextToPlayer(barrowsTweet, 'Deebo Samuel Sr.', sampleRoster.map(p => p.name));
  const westScoped = scopeBeatTextToPlayer(barrowsTweet, 'C.J. West', sampleRoster.map(p => p.name));
  const evansScoped = scopeBeatTextToPlayer(barrowsTweet, 'Mike Evans', sampleRoster.map(p => p.name));
  assert.ok(/hopeful to get Deebo Samuel/i.test(deeboScoped) && !/not expecting Mike Evans/i.test(deeboScoped));
  assert.ok(/CJ West back to practice/i.test(westScoped) && !/not expecting Mike Evans/i.test(westScoped));
  assert.ok(/not expecting Mike Evans/i.test(evansScoped) && !/hopeful to get/i.test(evansScoped));

  // 3. Anti-overreaction guards: speculative/unreliable sources = 0 confidence; aggregator echoes deduplicate; single unquoted tweet stays conservative
  const nowMs = Date.parse('2026-11-10T01:30:00Z');
  const winStartMs = Date.parse('2026-11-09T01:00:00Z');

  const speculativeSig = evaluateCorroboratedNewsInjurySignal({
    playerName: 'C.J. West',
    rosterBucket: 'ir',
    nowMs,
    windowStartMs: winStartMs,
    newsItems: [
      {
        id: 'spec1',
        trustTier: 3,
        author: 'Random Fan Blog',
        fullText: '49ers expect CJ West back to practice Wednesday and should activate him.',
        publishedAt: '2026-11-09T23:00:00Z'
      },
      {
        id: 'spec2',
        trustTier: 1,
        reporterId: 'matt_barrows',
        author: 'Matt Barrows',
        fullText: 'Team could activate CJ West this week if thin at DT.',
        publishedAt: '2026-11-09T23:05:00Z'
      }
    ]
  });
  assert.equal(speculativeSig.hasSignal, false, 'Speculative modals and Tier-3 blogs must have zero impact');
  assert.equal(speculativeSig.confidence, 0);

  // Three mirrors quoting the SAME reporter (Matt Barrows) without coach quote must deduplicate to 1 reporter (<0.55 IR threshold!)
  const echoedSingleReporter = evaluateCorroboratedNewsInjurySignal({
    playerName: 'C.J. West',
    rosterBucket: 'ir',
    nowMs,
    windowStartMs: winStartMs,
    newsItems: [
      {
        id: 'ec1',
        trustTier: 1,
        reporterId: 'matt_barrows',
        author: 'Matt Barrows',
        fullText: 'CJ West is on track to return to practice Wednesday.',
        publishedAt: '2026-11-09T22:30:00Z'
      },
      {
        id: 'ec2',
        trustTier: 2,
        outletId: 'rotowire',
        author: 'RotoWire',
        fullText: 'CJ West is on track to return to practice Wednesday, Matt Barrows of The Athletic reports.',
        publishedAt: '2026-11-09T22:40:00Z'
      }
    ]
  });
  assert.equal(echoedSingleReporter.corroboratingCount, 1, 'Aggregator echo of same beat writer must count as 1 source');
  assert.ok(echoedSingleReporter.confidence < 0.55, 'Single unquoted beat tweet must remain below 0.55 IR override threshold');

  const unquotedIrTimeline = classifyIrAndReserveTimeline({
    statusRaw: 'Injured Reserve',
    injuryType: 'Knee',
    placedDateIso: '2026-09-23T18:00:00Z',
    txPlacedDateIso: '2026-09-23T18:00:00Z',
    currentWeek: 10,
    byeWeek: 8,
    seasonYear: 2026,
    scheduleEvents: [
      { week: { number: 1 }, date: '2026-09-13T20:25Z' },
      { week: { number: 3 }, date: '2026-09-27T20:05Z' },
      { week: { number: 10 }, date: '2026-11-15T21:25Z' }
    ],
    corroboratedNewsSignal: echoedSingleReporter
  });
  assert.equal(unquotedIrTimeline.projectedReturnWeek, 'TBD (21d Window Not Open)', 'Single unquoted tweet must NOT flip IR badge');

  // 4. Corroborated coaching podium reports (Barrows + Maiocco + Wagoner/Lombardi) properly calibrate Deebo > Mike Evans & C.J. West Window Expected
  const podiumNews = [
    {
      id: 'p1',
      trustTier: 1,
      reporterId: 'matt_barrows',
      author: 'Matt Barrows',
      fullText: barrowsTweet,
      publishedAt: '2026-11-09T22:37:52Z'
    },
    {
      id: 'p2',
      trustTier: 1,
      reporterId: 'matt_maiocco',
      author: 'Matt Maiocco',
      fullText:
        'The 49ers expect WR Deebo Samuel and DT CJ West to be back at practice on Wednesday, coach Kyle Shanahan said. They are not expecting WR Mike Evans to be ready this week.',
      publishedAt: '2026-11-09T22:37:58Z'
    },
    {
      id: 'p3',
      trustTier: 1,
      reporterId: 'nick_wagoner',
      author: 'Nick Wagoner',
      fullText: 'Evans (Achilles) is unlikely to participate in practice Wednesday, Nick Wagoner of ESPN reports.',
      publishedAt: '2026-11-09T22:58:35Z'
    },
    {
      id: 'p4',
      trustTier: 1,
      reporterId: 'david_lombardi',
      author: 'David Lombardi',
      fullText: 'Samuel (hamstring) is on track to return to practice Wednesday, David Lombardi of SFStandard.com reports.',
      publishedAt: '2026-11-09T23:07:08Z'
    }
  ];

  const deeboSig = evaluateCorroboratedNewsInjurySignal({
    playerName: 'Deebo Samuel Sr.',
    rosterBucket: 'active',
    newsItems: podiumNews,
    rosterPlayerNames: sampleRoster.map(p => p.name),
    nowMs,
    windowStartMs: winStartMs
  });
  const evansSig = evaluateCorroboratedNewsInjurySignal({
    playerName: 'Mike Evans',
    rosterBucket: 'active',
    newsItems: podiumNews,
    rosterPlayerNames: sampleRoster.map(p => p.name),
    nowMs,
    windowStartMs: winStartMs
  });
  const westSig = evaluateCorroboratedNewsInjurySignal({
    playerName: 'C.J. West',
    rosterBucket: 'ir',
    newsItems: podiumNews,
    rosterPlayerNames: sampleRoster.map(p => p.name),
    nowMs,
    windowStartMs: winStartMs
  });

  const deeboProb = computePlayerPlayProbability({
    name: 'Deebo Samuel Sr.',
    position: 'WR',
    experienceYears: 8,
    snapPct: 58,
    gameStatus: 'Questionable',
    priorWeekStatus: 'Out',
    missedPriorGame: true,
    priorWeekPracticed: false,
    consecutiveMissedGames: 3,
    injuryType: 'Hamstring',
    wed: '-',
    thu: '-',
    fri: '-',
    corroboratedNewsSignal: deeboSig
  });
  const evansProb = computePlayerPlayProbability({
    name: 'Mike Evans',
    position: 'WR',
    experienceYears: 13,
    snapPct: 54,
    gameStatus: 'Questionable',
    priorWeekStatus: 'Out',
    missedPriorGame: true,
    priorWeekPracticed: false,
    consecutiveMissedGames: 2,
    injuryType: 'Achilles',
    wed: '-',
    thu: '-',
    fri: '-',
    corroboratedNewsSignal: evansSig
  });

  assert.ok(
    deeboProb.probabilityPct >= 55 && deeboProb.probabilityPct <= 68,
    `Expected Deebo cautious GTD (55–68%, not overcorrected to Probable), got ${deeboProb.probabilityPct}%`
  );
  assert.ok(
    evansProb.probabilityPct >= 15 && evansProb.probabilityPct <= 28,
    `Expected Mike Evans Long Shot/Doubtful (15–28%, not 0% Out or 79% GTD), got ${evansProb.probabilityPct}%`
  );
  assert.ok(
    deeboProb.probabilityPct >= evansProb.probabilityPct + 25,
    `Deebo (${deeboProb.probabilityPct}%) must substantially exceed Mike Evans (${evansProb.probabilityPct}%)`
  );

  // Once actual Wed/Thu/Fri practice codes are logged (e.g., Deebo logs DNP/DNP/DNP setback), observed practice overrides Monday hope!
  const deeboIfSetbackDnp = computePlayerPlayProbability({
    name: 'Deebo Samuel Sr.',
    position: 'WR',
    gameStatus: 'Questionable',
    injuryType: 'Hamstring',
    wed: 'DNP',
    thu: 'DNP',
    fri: 'DNP',
    corroboratedNewsSignal: deeboSig
  });
  assert.ok(deeboIfSetbackDnp.probabilityPct <= 15, `Observed DNP/DNP/DNP must override Monday optimism, got ${deeboIfSetbackDnp.probabilityPct}%`);

  const westIrTimeline = classifyIrAndReserveTimeline({
    statusRaw: 'Injured Reserve',
    injuryType: 'Knee',
    placedDateIso: '2026-09-23T18:00:00Z',
    txPlacedDateIso: '2026-09-23T18:00:00Z',
    currentWeek: 10,
    byeWeek: 8,
    seasonYear: 2026,
    scheduleEvents: [
      { week: { number: 1 }, date: '2026-09-13T20:25Z' },
      { week: { number: 3 }, date: '2026-09-27T20:05Z' },
      { week: { number: 10 }, date: '2026-11-15T21:25Z' }
    ],
    corroboratedNewsSignal: westSig
  });
  assert.equal(westIrTimeline.isPracticeWindowOpen, false, 'Formal NFL transaction count must remain unchanged before official wire');
  assert.equal(westIrTimeline.isPracticeWindowExpected, true);
  assert.equal(westIrTimeline.projectedReturnWeek, 'Est. Week 10–11 (Window Expected)');

  // 5. hydrateLiveEspnOverlay resilience when ESPN /injuries emits bare "out" / "inactive" strings
  const origFetch = globalThis.fetch;
  try {
    const mockAppData = {
      meta: { updatedAt: '2026-11-09T14:00:00Z', currentWeek: 10 },
      roster: {
        players: [
          {
            id: '3126486',
            name: 'Deebo Samuel Sr.',
            position: 'WR',
            jersey: 19,
            rosterBucket: 'active',
            experienceYears: 8,
            primarySnapPct: 58,
            capHit2026: 15_000_000,
            health: {
              status: 'Questionable',
              injuryType: 'Hamstring',
              isOnPracticeReport: true,
              wed: '-',
              thu: '-',
              fri: '-',
              shortComment: 'Samuel (hamstring) is on track to return to practice Wednesday.',
              longComment: 'Samuel (hamstring) is on track to return to practice Wednesday.',
              weeklyHistory2026: [
                { week: 6, gameStatus: 'Out', practiceStatus: 'Did Not Participate In Practice' },
                { week: 7, gameStatus: 'Out', practiceStatus: 'Did Not Participate In Practice' },
                { week: 9, gameStatus: 'Out', practiceStatus: 'Did Not Participate In Practice' }
              ]
            },
            recentNews: []
          },
          {
            id: '16737',
            name: 'Mike Evans',
            position: 'WR',
            jersey: 5,
            rosterBucket: 'active',
            experienceYears: 13,
            primarySnapPct: 54,
            capHit2026: 12_000_000,
            health: {
              status: 'Questionable',
              injuryType: 'Achilles',
              isOnPracticeReport: true,
              wed: '-',
              thu: '-',
              fri: '-',
              shortComment: 'Evans (Achilles) is unlikely to participate in practice Wednesday.',
              longComment: 'Evans (Achilles) appears to be questionable at best for Dallas.',
              weeklyHistory2026: [
                { week: 7, gameStatus: 'Out', practiceStatus: 'Did Not Participate In Practice' },
                { week: 9, gameStatus: 'Out', practiceStatus: 'Did Not Participate In Practice' }
              ]
            },
            recentNews: []
          },
          {
            id: '4686308',
            name: 'C.J. West',
            position: 'DT',
            jersey: 99,
            rosterBucket: 'ir',
            experienceYears: 2,
            primarySnapPct: 41,
            capHit2026: 1_200_000,
            health: {
              status: 'Injured Reserve',
              injuryType: 'Knee',
              isSeasonEnding: false,
              isPracticeWindowOpen: false,
              placedBeforeWeek: 3,
              earliestEligibleWeek: 7,
              projectedReturnWeek: 'TBD (21d Window Not Open)',
              irBeatNote: 'West will need to miss at least four games on IR.'
            },
            recentNews: []
          }
        ]
      },
      health: {
        week: 10,
        byeWeek: 8,
        practiceReport: [],
        irAndReserveTracker: [
          {
            playerId: '4686308',
            name: 'C.J. West',
            position: 'DT',
            jersey: 99,
            injuryType: 'Knee',
            status: 'Injured Reserve',
            isSeasonEnding: false,
            isPracticeWindowOpen: false,
            placedBeforeWeek: 3,
            earliestEligibleWeek: 7,
            projectedReturnWeek: 'TBD (21d Window Not Open)'
          }
        ]
      },
      news: { rawStream: podiumNews },
      scheduleMatchup: {
        schedule: [
          { week: 9, dateIso: '2026-11-08T21:25:00Z', completed: true },
          { week: 10, dateIso: new Date(Date.now() + 5 * 86_400_000).toISOString(), completed: false }
        ],
        upcomingMatchup: {
          week: 10,
          oppAbbr: 'DAL',
          oppName: 'Dallas Cowboys',
          kickoffIso: new Date(Date.now() + 5 * 86_400_000).toISOString()
        }
      }
    };

    globalThis.fetch = async url => {
      if (String(url).includes('/injuries')) {
        return {
          ok: true,
          json: async () => ({
            injuries: [
              {
                id: '25',
                displayName: 'San Francisco 49ers',
                injuries: [
                  {
                    athlete: { displayName: 'Deebo Samuel Sr.' },
                    status: 'Out',
                    details: { type: 'Hamstring' },
                    shortComment: 'out',
                    longComment: 'out'
                  },
                  {
                    athlete: { displayName: 'Mike Evans' },
                    status: 'Out',
                    details: { type: 'Achilles' },
                    shortComment: 'out',
                    longComment: 'out'
                  }
                ]
              }
            ]
          })
        };
      }
      return { ok: false, json: async () => null };
    };

    await hydrateLiveEspnOverlay(mockAppData);
    reconcileRosterAndHealthWithNews(mockAppData, { nowMs });

    const prDeebo = mockAppData.health.practiceReport.find(p => p.name === 'Deebo Samuel Sr.');
    const prEvans = mockAppData.health.practiceReport.find(p => p.name === 'Mike Evans');
    const irWest = mockAppData.health.irAndReserveTracker.find(p => p.name === 'C.J. West');

    assert.ok(prDeebo && prEvans && irWest, 'Expected Deebo, Evans & West present after live overlay hydration');
    assert.notEqual(prEvans.beatComment, 'out', 'Bare "out" placeholder must never overwrite real medical comment');
    assert.ok(
      prDeebo.playProbabilityPct > prEvans.playProbabilityPct + 25,
      `Live overlay must rank Deebo (${prDeebo.playProbabilityPct}%) well above Mike Evans (${prEvans.playProbabilityPct}%)`
    );
    assert.equal(irWest.projectedReturnWeek, 'Est. Week 10–11 (Window Expected)');
  } finally {
    globalThis.fetch = origFetch;
  }
});

test('4-Unit Team Stats, Overall Composite Rank Jargon Tooltips, Positional Leaderboards & Position-Specific Career Tables validate cleanly', () => {
  const scheduleMatchup = JSON.parse(fs.readFileSync(path.join(rootDir, 'data', 'schedule-matchup.json'), 'utf8'));
  const roster = JSON.parse(fs.readFileSync(path.join(rootDir, 'data', 'roster.json'), 'utf8'));

  // 1. Exact 4-unit card order & Offense <-> Defense symmetry
  assert.deepEqual(
    TEAM_STAT_UNITS_SCHEMA.map(u => u.id),
    ['offense', 'defense', 'special_teams', 'margin']
  );
  const tsUnits = scheduleMatchup.teamStats?.units || [];
  assert.deepEqual(tsUnits.map(u => u.id), ['offense', 'defense', 'special_teams', 'margin']);
  assert.equal(tsUnits[0].coreRows.length, 7, 'Offense must expose 7 paired core rows');
  assert.equal(tsUnits[1].coreRows.length, 7, 'Defense must expose 7 symmetrical core rows');
  assert.equal(tsUnits[0].expandedGroups.length, 3);
  assert.equal(tsUnits[1].expandedGroups.length, 3);

  // 2. Overall Rank "How calculated" tooltips exist with weighted methodology
  for (const key of ['overall_offense_rank', 'overall_defense_rank', 'overall_st_rank', 'overall_margin_rank']) {
    const entry = getJargonEntry(key);
    assert.ok(entry && entry.definition.includes('%'), `Missing weighted formula explanation for ${key}`);
  }

  // 3. Every Team Stat & Overall Rank carries a full 32-team leaderboard sorted #1..#32
  for (const [mKey, mObj] of Object.entries(scheduleMatchup.teamStats.flatByKey)) {
    assert.equal(mObj.leaderboard.length, 32, `Metric ${mKey} must have 32 teams`);
    assert.equal(mObj.leaderboard[0].rank, 1);
    assert.equal(mObj.leaderboard[31].rank, 32);
    if (mObj.higherIsBetter) {
      assert.ok(mObj.leaderboard[0].val >= mObj.leaderboard[31].val, `${mKey} higherIsBetter sort wrong`);
    } else {
      assert.ok(mObj.leaderboard[0].val <= mObj.leaderboard[31].val, `${mKey} lowerIsBetter sort wrong`);
    }
  }

  // 4. Leaderboard modal resolver highlights SF on Team Stats & highlights viewed 49ers player on Player Stats
  const appDataMock = { scheduleMatchup, roster };
  const teamModal = resolveLeaderboardModalModel({ appData: appDataMock, scope: 'team', key: 'off_pts_game' });
  assert.ok(teamModal && teamModal.rows.length === 32);
  assert.equal(teamModal.rows.filter(r => r.isHighlighted).length, 1);
  assert.equal(teamModal.rows.find(r => r.isHighlighted).id, 'SF');
  assert.ok(teamModal.avgInsertAfterIdx >= 0 && teamModal.avgInsertAfterIdx < 31);

  const purdy = roster.players.find(p => p.name === 'Brock Purdy');
  const cmc = roster.players.find(p => p.name === 'Christian McCaffrey');
  assert.ok(purdy?.statProfile2026?.sections?.length >= 2, 'Purdy must have Passing + Rushing sections');
  assert.ok(cmc?.statProfile2026?.sections?.length >= 2, 'CMC must have Rushing + RB Receiving sections');

  const purdyCoreKeys = purdy.statProfile2026.sections[0].coreRows.map(r => r.key);
  const purdyExpKeys = purdy.statProfile2026.sections[0].expandedRows.map(r => r.key);
  assert.deepEqual(
    purdyCoreKeys,
    [
      'pass_yds_game',
      'pass_tds',
      'pass_ints',
      'comp_pct',
      'pass_cpoe',
      'passer_rating',
      'qbr_total',
      'pass_epa_total'
    ],
    `QB core metric order must place Completion % in standard metrics and Total QBR directly next to Passer Rating: ${JSON.stringify(purdyCoreKeys)}`
  );
  assert.ok(
    purdyExpKeys.includes('pass_ny_att'),
    `Net Yards / Dropback must be in Detailed (expanded) QB metrics: ${JSON.stringify(purdyExpKeys)}`
  );
  const purdyQbrRow = purdy.statProfile2026.sections[0].coreRows.find(r => r.key === 'qbr_total');
  assert.ok(purdyQbrRow && purdyQbrRow.value > 50, `Purdy must have Total QBR core metric populated, got ${JSON.stringify(purdyQbrRow)}`);
  assert.ok(getJargonEntry('qbr')?.definition.includes('0–100'), 'QBR jargon definition must be registered');

  const purdyFirstRow = purdy.statProfile2026.sections[0].coreRows[0];
  const playerModal = resolveLeaderboardModalModel({
    appData: appDataMock,
    scope: 'player',
    key: purdyFirstRow.leaderboardKey,
    playerId: purdy.id
  });
  assert.ok(playerModal && playerModal.rows.length >= 20);
  assert.equal(playerModal.rows.find(r => r.isHighlighted)?.title, 'Brock Purdy');

  // 5. Position classification & Position-Specific Career Table Columns (zero blank offensive columns on defenders!)
  assert.equal(normalizePositionalPeerGroup('OLB', { pff_position: 'ED' }), 'EDGE');
  assert.equal(normalizePositionalPeerGroup('OLB', { pff_position: 'LB' }), 'LB');
  assert.equal(normalizePositionalPeerGroup('OT', null), 'OT');
  assert.equal(normalizePositionalPeerGroup('C', null), 'IOL');

  const defCareer = resolveCareerTableSchema('DE');
  assert.ok(defCareer.headers.includes('Sacks') && defCareer.headers.includes('TFL'));
  assert.ok(
    !defCareer.headers.some(h => /Pass|Rush|Rec/i.test(h)),
    `Defensive career schema must not contain offensive columns: ${JSON.stringify(defCareer.headers)}`
  );
});

test('Statistical datasource refresh cadences (Thursday PFR charting, Tuesday nflverse/NGS, real-time ESPN) isolate denominators & sync live', () => {
  const scheduleMatchup = JSON.parse(fs.readFileSync(path.join(rootDir, 'data', 'schedule-matchup.json'), 'utf8'));
  const roster = JSON.parse(fs.readFileSync(path.join(rootDir, 'data', 'roster.json'), 'utf8'));

  // 1. Live dataset check: Fred Warner PFR coverage metrics must aggregate weekly PFR charting (qualified across >40 NFL LBs, never frozen at Week 3 g=3)
  const warner = roster.players.find(p => p.name === 'Fred Warner');
  const warnerRows = [
    ...(warner?.statProfile2026?.sections?.[0]?.coreRows || []),
    ...(warner?.statProfile2026?.sections?.[0]?.expandedRows || [])
  ];
  const warnerRatRow = warnerRows.find(r => r.key === 'pfr_rat_allowed');
  assert.ok(warnerRatRow && warnerRatRow.qualified, 'Fred Warner must be qualified on PFR Passer Rating Allowed');
  assert.ok(warnerRatRow.totalPeers >= 40, `Expected >=40 qualified NFL LBs on PFR coverage, got ${warnerRatRow.totalPeers}`);

  // 2. Live dataset check: Deebo Samuel Sr. must receive 2026 NextGen Stats via weekly NGS rollup even below full-season week=0 threshold
  const deebo = roster.players.find(p => p.name === 'Deebo Samuel Sr.');
  const deeboRows = [
    ...(deebo?.statProfile2026?.sections?.[0]?.coreRows || []),
    ...(deebo?.statProfile2026?.sections?.[0]?.expandedRows || [])
  ];
  assert.ok(deeboRows.some(r => r.key === 'ngs_sep'), 'Deebo Samuel Sr. must have 2026 NGS Route Separation populated');

  // 3. Cross-source Sunday/Monday latency test: ESPN Standings at 8 GP (`pf=235`) while nflverse `reg` lags at 7 GP (`passing_yards=1750`)
  const recMap = new Map([
    ['SF', { record: '7-1', wins: 7, losses: 1, ties: 0, pointsFor: 235, pointsAgainst: 156, pointDiff: 79 }]
  ]);
  const espnStMap = new Map([
    ['SF', { gamesPlayed: 8, takeaways: 12, giveaways: 11, turnoverDiff: 1 }]
  ]);
  const regTeamsLagging = [
    { team: 'SF', season_type: 'REG', games: '7', attempts: '210', sacks_suffered: '7', sack_yards_lost: '-40', passing_yards: '1790', carries: '190', rushing_yards: '945', passing_epa: '60', rushing_epa: '21' }
  ];
  const simOut = computeLeagueTeamStatsPayload({
    regTeams: regTeamsLagging,
    statsTeamWeek: [],
    espnTeamStatsByAbbr: espnStMap,
    teamRecordsMap: recMap,
    seasonYear: 2026
  });
  // PPG must use 8-game `standingsGp` (`235 / 8 = 29.375 -> 29.4`), NOT 7-game `regGp` (`33.6`)!
  assert.equal(simOut.teamStats.flatByKey.off_pts_game.displayValue, '29.4');
  // Passing Yards/Gm must use 7-game `regGp` (`(1790 - 40) / 7 = 250.0 yds`), NOT 8-game `standingsGp`!
  assert.equal(simOut.teamStats.flatByKey.off_pass_yds_game.displayValue, '250.0 yds');
  // Takeaways/Gm must use 8-game `espnGp` (`12 / 8 = 1.50`), NOT 7-game `regGp` (`1.71`)!
  assert.equal(simOut.teamStats.flatByKey.def_takeaways_game.displayValue, '1.50');

  // 4. Live in-browser post-game sync (`refreshLiveStandingsMetricsInTeamStats`) updates PPG, records & composites immediately
  const clonedTs = JSON.parse(JSON.stringify(scheduleMatchup.teamStats));
  const clonedRanks = JSON.parse(JSON.stringify(scheduleMatchup.teamStatRankings));
  const postGameMap = new Map([
    ['SF', { record: '8-1', wins: 8, losses: 1, ties: 0, pf: 270, pa: 171, pd: 99 }]
  ]);
  const didUpdate = refreshLiveStandingsMetricsInTeamStats(clonedTs, clonedRanks, postGameMap);
  assert.equal(didUpdate, true);
  assert.equal(clonedTs.teams.SF.record, '8-1');
  assert.equal(clonedTs.flatByKey.off_pts_game.displayValue, '30.0'); // 270 / 9 = 30.0 PPG
  assert.equal(clonedTs.flatByKey.def_pts_allowed_game.displayValue, '19.0'); // 171 / 9 = 19.0 PAPG

  // 5. PFR Thursday latency denominator isolation: 7 charted PFR weeks must divide by 7-week attempts (`200`), NEVER 8-week attempts (`240`)
  const pfrAgg = aggregateWeeklyPfrAdvStats2026({
    pfrPassSeason: [],
    pfrDefSeason: [{ season: '2026', pfr_id: 'WarnFr00', g: '3', tgt: '11', cmp: '9', rat: '98.9', prss: '2' }],
    pfrPassWeek: [
      { season: '2026', game_type: 'REG', week: '1', team: 'SF', pfr_player_id: 'PurdBr00', pfr_player_name: 'Brock Purdy', passing_bad_throws: '15', passing_drops: '2', times_pressured: '20', times_sacked: '0' },
      { season: '2026', game_type: 'REG', week: '2', team: 'SF', pfr_player_id: 'PurdBr00', pfr_player_name: 'Brock Purdy', passing_bad_throws: '15', passing_drops: '2', times_pressured: '20', times_sacked: '0' }
    ],
    pfrDefWeek: [
      { season: '2026', game_type: 'REG', week: '1', pfr_player_id: 'WarnFr00', def_targets: '5', def_completions_allowed: '3', def_yards_allowed: '25', def_receiving_td_allowed: '0', def_ints: '0', def_pressures: '2', def_tackles_combined: '10', def_missed_tackles: '1' },
      { season: '2026', game_type: 'REG', week: '2', pfr_player_id: 'WarnFr00', def_targets: '5', def_completions_allowed: '3', def_yards_allowed: '25', def_receiving_td_allowed: '0', def_ints: '0', def_pressures: '2', def_tackles_combined: '10', def_missed_tackles: '1' },
      { season: '2026', game_type: 'REG', week: '3', pfr_player_id: 'WarnFr00', def_targets: '5', def_completions_allowed: '3', def_yards_allowed: '25', def_receiving_td_allowed: '0', def_ints: '0', def_pressures: '2', def_tackles_combined: '10', def_missed_tackles: '1' },
      { season: '2026', game_type: 'REG', week: '4', pfr_player_id: 'WarnFr00', def_targets: '5', def_completions_allowed: '3', def_yards_allowed: '25', def_receiving_td_allowed: '0', def_ints: '0', def_pressures: '2', def_tackles_combined: '10', def_missed_tackles: '1' }
    ],
    statsPlayerWeek: [
      { season_type: 'REG', week: '1', player_id: 'G1', recent_team: 'SF', attempts: '100', sacks_suffered: '0' },
      { season_type: 'REG', week: '2', player_id: 'G1', recent_team: 'SF', attempts: '100', sacks_suffered: '0' },
      { season_type: 'REG', week: '3', player_id: 'G1', recent_team: 'SF', attempts: '40', sacks_suffered: '5' } // Uncharted in PFR!
    ],
    nflPlayers: [{ gsis_id: 'G1', pfr_id: 'PurdBr00' }],
    seasonYear: 2026
  });
  assert.equal(pfrAgg.pfrPass2026.get('PurdBr00').badThrowPct, 15.0); // 30 / 200 = 15.0% (ignores uncharted Week 3's 40 att!)
  assert.equal(pfrAgg.pfrDef2026.get('WarnFr00').games, 4); // Upgrades frozen g=3 season row to 4 weekly charted games!

  // 6. Weekly NGS rollup test when `week === '0'` is absent
  const ngsAgg = aggregateWeeklyNgsStats2026({
    ngsReceiving: [
      { season: '2026', season_type: 'REG', week: '1', player_gsis_id: 'DEEBO', targets: '4', receptions: '3', avg_separation: '4.0', avg_yac_above_expectation: '1.0', avg_cushion: '6.0', avg_intended_air_yards: '5.0', percent_share_of_intended_air_yards: '12.0', avg_yac: '8.0' },
      { season: '2026', season_type: 'REG', week: '2', player_gsis_id: 'DEEBO', targets: '6', receptions: '5', avg_separation: '5.0', avg_yac_above_expectation: '2.0', avg_cushion: '7.0', avg_intended_air_yards: '5.0', percent_share_of_intended_air_yards: '14.0', avg_yac: '9.0' }
    ],
    seasonYear: 2026
  });
  assert.equal(ngsAgg.ngsRec2026.get('DEEBO').avgSeparation, 4.6); // (4*4.0 + 6*5.0)/10 = 4.60
});

test('Injury News Stack Ranking (Recency + Salience), Immediate Practice Report Wire Sync & Play Likelihood Calibration (Deebo LP > Green DNP)', () => {
  const nowMs = Date.parse('2026-11-11T23:30:00Z'); // Wednesday 3:30 PM PST (Week 10)
  const kickoffIso = '2026-11-15T21:25:00Z';
  const lastCompletedGameEndMs = Date.parse('2026-11-09T00:30:00Z');

  // 1. Eligibility Gate (`isPlayerEligibleForInjuryNews`):
  //    Active injured = true, 2–3wk IR = true, Vet Rest = false, healthy starter = false, >3wk IR = false, season-ending IR = false
  assert.equal(
    isPlayerEligibleForInjuryNews(
      { name: 'Deebo Samuel Sr.', rosterBucket: 'active', health: { status: 'Questionable', injuryType: 'Hamstring', isOnPracticeReport: true, wed: 'LP' } },
      { currentWeek: 10, byeWeek: 8 }
    ),
    true
  );
  assert.equal(
    isPlayerEligibleForInjuryNews(
      { name: 'Trent Williams', rosterBucket: 'active', health: { status: 'Active', injuryType: 'NIR - Rest', isOnPracticeReport: true, wed: 'Vet Rest' } },
      { currentWeek: 10, byeWeek: 8 }
    ),
    false,
    'Veteran Rest maintenance days must NOT trigger an Injury News card'
  );
  assert.equal(
    isPlayerEligibleForInjuryNews(
      { name: 'Brock Purdy', rosterBucket: 'active', health: { status: 'Active', injuryType: '', isOnPracticeReport: false } },
      { currentWeek: 10, byeWeek: 8 }
    ),
    false
  );
  assert.equal(
    isPlayerEligibleForInjuryNews(
      { name: 'C.J. West', rosterBucket: 'ir', health: { status: 'IR — 21-Day Window Open', injuryType: 'Knee', isPracticeWindowOpen: true, projectedReturnWeek: 'Week 10 Activation Window' } },
      { currentWeek: 10, byeWeek: 8 }
    ),
    true
  );
  assert.equal(
    isPlayerEligibleForInjuryNews(
      { name: "De'Zhaun Stribling", rosterBucket: 'ir', health: { status: 'Injured Reserve', injuryType: 'Ankle', isSeasonEnding: false, projectedReturnWeek: 'Est. Week 13 (Dec 6)' } },
      { currentWeek: 10, byeWeek: 8 }
    ),
    true,
    'IR player projected within 3 weeks (Week 13 from Week 10) must be eligible for Injury News'
  );
  assert.equal(
    isPlayerEligibleForInjuryNews(
      { name: 'Sam Okuayinonu', rosterBucket: 'ir', health: { status: 'Injured Reserve', injuryType: 'Pectoral', isSeasonEnding: false, projectedReturnWeek: 'Est. Week 15 (Dec 20)' } },
      { currentWeek: 10, byeWeek: 8 }
    ),
    false,
    'IR player >3 weeks away must not show Injury News card'
  );
  assert.equal(
    isPlayerEligibleForInjuryNews(
      { name: 'Alfred Collins', rosterBucket: 'ir', health: { status: 'Season-Ending IR', injuryType: 'Shoulder', isSeasonEnding: true, projectedReturnWeek: 'Out for Season' } },
      { currentWeek: 10, byeWeek: 8 }
    ),
    false
  );

  // 2. Joint Recency + Salience Stack Ranking (`rankPlayerInjuryNews` & `computeInjuryNewsRankScore`):
  //    Observational rehab color ("Evans didn't practice, but was spotted running on the sidelines") MUST outrank a bare DNP list item!
  const evansPlayer = {
    id: '16737',
    name: 'Mike Evans',
    position: 'WR',
    rosterBucket: 'active',
    health: { status: 'Questionable', injuryType: 'Achilles', isOnPracticeReport: true, wed: 'DNP', thu: '-', fri: '-' },
    recentNews: []
  };
  const candidateStream = [
    {
      id: 'bare_dnp_list',
      type: 'tweet',
      author: 'Jennifer Lee Chan',
      outletName: 'NBC Sports Bay Area',
      trustTier: 1,
      publishedAt: '2026-11-11T21:10:00Z',
      url: 'https://x.com/jenniferleechan/status/1001',
      fullText: '#49ers practice report: Not participating WR Mike Evans, CB Renardo Green, CB Deommodore Lenoir, S JiAyir Brown, LB Luke Gifford.'
    },
    {
      id: 'sideline_color_tweet',
      type: 'tweet',
      author: 'Matt Barrows',
      outletName: 'The Athletic',
      trustTier: 1,
      publishedAt: '2026-11-11T20:55:00Z',
      url: 'https://x.com/mattbarrows/status/1002',
      fullText: "Mike Evans (Achilles) didn't practice Wednesday, but was spotted running on the sidelines with trainers during open media viewing."
    },
    {
      id: 'mahomes_offtopic_noise',
      type: 'article',
      author: 'ESPN',
      outletName: 'ESPN',
      trustTier: 2,
      publishedAt: '2026-11-11T23:25:00Z',
      url: 'https://www.espn.com/nfl/story/_/id/999/mahomes-news',
      headline: 'Patrick and Brittany Mahomes announce baby No. 4 on NFL trade deadline day',
      summary: 'The couple shared the news on a busy trade deadline afternoon.'
    },
    {
      id: 'stale_pre_practice_expectation',
      type: 'tweet',
      author: 'Nick Wagoner',
      outletName: 'ESPN',
      trustTier: 1,
      publishedAt: '2026-11-10T18:00:00Z',
      url: 'https://x.com/nwagoner/status/1003',
      fullText: 'Mike Evans is unlikely to participate in practice Wednesday.'
    }
  ];

  const rankedEvans = rankPlayerInjuryNews(evansPlayer, {
    rawStream: candidateStream,
    appData: { roster: { players: [evansPlayer] }, scheduleMatchup: { schedule: [] } },
    nowMs
  });
  assert.equal(rankedEvans[0]?.id, 'sideline_color_tweet', 'Sideline rehab color tweet must rank #1 over bare multi-player DNP list');
  assert.equal(rankedEvans[0]?.hasRehabColor, true);
  assert.ok(
    !rankedEvans.some(it => it.id === 'mahomes_offtopic_noise'),
    'Unrelated general NFL article must never leak into player Injury News'
  );
  assert.ok(
    rankedEvans.findIndex(it => it.id === 'sideline_color_tweet') <
      rankedEvans.findIndex(it => it.id === 'stale_pre_practice_expectation'),
    'Observed Wednesday sideline/practice update must outrank Tuesday pre-practice expectation'
  );

  // 3. Bug #3 + Bug #4 End-to-End Verification:
  //    Immediate W/T/F sync from live beat reports (even before static JSON refresh & across timezones)
  //    AND calibrated Play Likelihood (`Deebo Samuel Sr. LP` strictly > `Renardo Green DNP`, zero future Thu/Fri hallucination)
  const simAppData = {
    meta: { seasonYear: 2026, currentWeek: 10 },
    roster: {
      players: [
        {
          id: '3126486',
          name: 'Deebo Samuel Sr.',
          position: 'WR',
          jersey: 19,
          rosterBucket: 'active',
          primarySnapPct: 74,
          capHit2026: 15_000_000,
          health: {
            status: 'Questionable',
            injuryType: 'Hamstring',
            isOnPracticeReport: true,
            wed: '-',
            thu: '-',
            fri: '-',
            shortComment: 'questionable',
            longComment: 'questionable',
            playProbabilityPct: 58,
            playBadgeLabel: '58% • GTD',
            weeklyHistory2026: [
              { week: 6, gameStatus: 'Out', practiceStatus: 'Did Not Participate' },
              { week: 7, gameStatus: 'Out', practiceStatus: 'Did Not Participate' },
              { week: 9, gameStatus: 'Out', practiceStatus: 'Did Not Participate' }
            ]
          },
          recentNews: []
        },
        {
          id: '4427325',
          name: 'Renardo Green',
          position: 'CB',
          jersey: 0,
          rosterBucket: 'active',
          primarySnapPct: 97,
          capHit2026: 2_100_000,
          health: {
            status: 'Questionable',
            injuryType: 'Back',
            isOnPracticeReport: true,
            wed: '-',
            thu: '-',
            fri: '-',
            shortComment: 'Shanahan indicated Monday that Green is considered day-to-day.',
            longComment: 'Shanahan indicated Monday that Green is considered day-to-day.',
            playProbabilityPct: 82,
            playBadgeLabel: '82% • GTD',
            weeklyHistory2026: []
          },
          recentNews: []
        },
        {
          id: '4565200',
          name: 'Upton Stout',
          position: 'CB',
          jersey: 20,
          rosterBucket: 'active',
          primarySnapPct: 62,
          capHit2026: 1_200_000,
          health: {
            status: 'Active',
            injuryType: '',
            isOnPracticeReport: false,
            wed: '-',
            thu: '-',
            fri: '-',
            shortComment: '',
            longComment: '',
            playProbabilityPct: 99,
            playBadgeLabel: '99% • Full Go',
            weeklyHistory2026: []
          },
          recentNews: []
        },
        {
          id: '4686308',
          name: 'C.J. West',
          position: 'DT',
          jersey: 99,
          rosterBucket: 'ir',
          primarySnapPct: 28,
          capHit2026: 0,
          health: {
            status: 'Injured Reserve',
            injuryType: 'Knee',
            isSeasonEnding: false,
            isPracticeWindowOpen: false,
            earliestEligibleWeek: 7,
            projectedReturnWeek: 'TBD (21d Window Not Open)',
            isOnPracticeReport: false,
            wed: '-',
            thu: '-',
            fri: '-'
          },
          recentNews: []
        }
      ]
    },
    health: {
      week: 10,
      byeWeek: 8,
      practiceReport: [
        { playerId: '3126486', name: 'Deebo Samuel Sr.', wed: '-', thu: '-', fri: '-', injuryType: 'Hamstring', gameStatus: 'Questionable', playProbabilityPct: 58, playBadgeLabel: '58% • GTD' },
        { playerId: '4427325', name: 'Renardo Green', wed: '-', thu: '-', fri: '-', injuryType: 'Back', gameStatus: 'Questionable', playProbabilityPct: 82, playBadgeLabel: '82% • GTD' }
      ],
      irAndReserveTracker: [
        { playerId: '4686308', name: 'C.J. West', status: 'Injured Reserve', injuryType: 'Knee', isSeasonEnding: false, isPracticeWindowOpen: false, projectedReturnWeek: 'TBD (21d Window Not Open)' }
      ]
    },
    news: {
      rawStream: [
        {
          id: 'maiocco_wed_prac',
          type: 'tweet',
          author: 'Matt Maiocco',
          outletName: 'NBC Sports Bay Area',
          trustTier: 1,
          // Simulate early Eastern-Time / road-practice release (11:30 AM PST = 2:30 PM EST!)
          publishedAt: '2026-11-11T19:30:00Z',
          url: 'https://x.com/MaioccoNBCS/status/2120617948138401832',
          fullText:
            'The 49ers opened the practice window for DT CJ West (knee) off injured reserve. He is limited today at practice, along with Deebo Samuel and Upton Stout (shoulder). No practice for Renardo Green (back).'
        },
        {
          id: 'speculative_thu_fri_blurb',
          type: 'tweet',
          author: 'RotoWire',
          outletName: 'RotoWire',
          wireSource: 'espn_player_wire',
          trustTier: 2,
          publishedAt: '2026-11-10T16:10:00Z',
          url: 'https://www.espn.com/nfl/player/_/id/4427325',
          fullText: 'Green (back) appears unlikely to be anything more than a limited participant Thursday or Friday.'
        }
      ]
    },
    scheduleMatchup: {
      schedule: [
        { week: 9, dateIso: '2026-11-08T21:25:00Z', completed: true },
        { week: 10, dateIso: kickoffIso, completed: false }
      ],
      upcomingMatchup: { week: 10, oppAbbr: 'DAL', oppName: 'Dallas Cowboys', kickoffIso }
    }
  };

  // Run at 11:45 AM PST (before 12:15 PM PT static threshold, proving road/ET practice reports still appear immediately!)
  const roadPracticeNowMs = Date.parse('2026-11-11T19:45:00Z');
  reconcileRosterAndHealthWithNews(simAppData, { nowMs: roadPracticeNowMs });

  const deeboRow = simAppData.health.practiceReport.find(r => r.name === 'Deebo Samuel Sr.');
  const greenRow = simAppData.health.practiceReport.find(r => r.name === 'Renardo Green');
  const stoutRow = simAppData.health.practiceReport.find(r => r.name === 'Upton Stout');
  const westIrRow = simAppData.health.irAndReserveTracker.find(r => r.name === 'C.J. West');

  assert.equal(deeboRow?.wed, 'LP', 'Deebo Samuel Sr. must immediately show Wednesday LP');
  assert.equal(deeboRow?.thu, '-', 'Future Thursday slot must remain blank on Wednesday');
  assert.equal(greenRow?.wed, 'DNP', 'Renardo Green must immediately show Wednesday DNP');
  assert.equal(greenRow?.thu, '-', 'Speculative Thursday blurb must never populate thu=LP on Wednesday');
  assert.equal(stoutRow?.wed, 'LP', 'Newly injured Upton Stout must be added to practiceReport with Wednesday LP');
  assert.equal(westIrRow?.isPracticeWindowOpen, true, 'C.J. West 21-day window must open immediately upon Maiocco report');

  assert.ok(
    deeboRow.playProbabilityPct >= greenRow.playProbabilityPct + 20,
    `Deebo LP (${deeboRow.playProbabilityPct}%) must score well above Renardo Green DNP (${greenRow.playProbabilityPct}%)`
  );

  // Verify Team Injury News feed sorts strictly lowest -> highest play likelihood
  const teamFeed = buildTeamInjuryNewsFeed(simAppData, { nowMs: roadPracticeNowMs });
  assert.ok(teamFeed.length >= 3, `Expected >=3 players in Team Injury News feed, got ${teamFeed.length}`);
  const greenIdx = teamFeed.findIndex(e => e.name === 'Renardo Green');
  const deeboIdx = teamFeed.findIndex(e => e.name === 'Deebo Samuel Sr.');
  assert.ok(greenIdx >= 0 && deeboIdx > greenIdx, 'Lower play likelihood player (Green DNP) must appear before Deebo LP in Team Injury News');
  for (let i = 1; i < teamFeed.length; i++) {
    assert.ok(
      teamFeed[i - 1].playProbabilityPct <= teamFeed[i].playProbabilityPct,
      `Team Injury News must sort lowest -> highest play likelihood: ${JSON.stringify(teamFeed.map(e => [e.name, e.playProbabilityPct]))}`
    );
  }

  // Verify Thursday downgrade (Wed FP -> Thu DNP) setback penalty is reachable and severe
  const thuSetback = computePlayerPlayProbability({
    name: 'Renardo Green',
    position: 'CB',
    snapPct: 97,
    gameStatus: 'Questionable',
    injuryType: 'Hamstring',
    wed: 'FP',
    thu: 'DNP',
    fri: '-'
  });
  assert.ok(thuSetback.probabilityPct <= 42, `Wed FP -> Thu DNP setback should drop <=42%, got ${thuSetback.probabilityPct}%`);

  // Verify live generated `data/health.json` snapshot invariants AND 100% direct Injury News link integrity
  const liveHealth = JSON.parse(fs.readFileSync(path.join(rootDir, 'data', 'health.json'), 'utf8'));
  const liveRoster = JSON.parse(fs.readFileSync(path.join(rootDir, 'data', 'roster.json'), 'utf8'));
  const liveNews = JSON.parse(fs.readFileSync(path.join(rootDir, 'data', 'news.json'), 'utf8'));
  const liveSm = JSON.parse(fs.readFileSync(path.join(rootDir, 'data', 'schedule-matchup.json'), 'utf8'));
  const liveDeebo = liveHealth.practiceReport.find(r => r.name === 'Deebo Samuel Sr.');
  const liveGreen = liveHealth.practiceReport.find(r => r.name === 'Renardo Green');
  if (liveDeebo && liveGreen && liveDeebo.wed === 'LP' && liveGreen.wed === 'DNP') {
    assert.ok(
      liveDeebo.playProbabilityPct > liveGreen.playProbabilityPct,
      `Live data/health.json must rank Deebo LP (${liveDeebo.playProbabilityPct}%) > Green DNP (${liveGreen.playProbabilityPct}%)`
    );
  }

  const liveBundle = { roster: liveRoster, health: liveHealth, news: liveNews, scheduleMatchup: liveSm };
  const liveDirectSocial = (liveNews.rawStream || []).filter(it => isDirectSocialPostUrl(it.url || ''));
  const liveTeamInjFeed = buildTeamInjuryNewsFeed(liveBundle);
  assert.ok(liveTeamInjFeed.length >= 1, 'Expected >=1 injured player entry in live Team Injury News feed');
  for (const entry of liveTeamInjFeed) {
    const it = entry.topItem;
    const href =
      it.type === 'tweet' || it.type === 'social'
        ? sanitizeExternalUrl(resolveOriginalTweetUrl({ ...it, primaryPlayer: { name: entry.name } }, liveDirectSocial), null)
        : sanitizeExternalUrl(it.url, null);
    assert.ok(href && href.startsWith('https://'), `Invalid Team Injury News link for ${entry.name}: ${href}`);
    assert.ok(!href.includes('x.com/search'), `Team Injury News for ${entry.name} must never use speculative x.com/search: ${href}`);
    assert.equal(isPaywalledOrBlockedUrl(href), false, `Blocked/paywalled Team Injury News URL for ${entry.name}: ${href}`);
  }
  for (const rp of liveRoster.players || []) {
    if (!isPlayerEligibleForInjuryNews(rp)) continue;
    const pItems = rankPlayerInjuryNews(rp, { rawStream: liveNews.rawStream, appData: liveBundle });
    for (const it of pItems) {
      const href =
        it.type === 'tweet' || it.type === 'social'
          ? sanitizeExternalUrl(resolveOriginalTweetUrl({ ...it, primaryPlayer: { name: rp.name } }, liveDirectSocial), null)
          : sanitizeExternalUrl(it.url, null);
      assert.ok(href && href.startsWith('https://'), `Invalid Player Injury News link for ${rp.name}: ${href}`);
      assert.ok(!href.includes('x.com/search'), `Player Injury News for ${rp.name} must never use speculative x.com/search: ${href}`);
      assert.equal(isPaywalledOrBlockedUrl(href), false, `Blocked/paywalled Player Injury News URL for ${rp.name}: ${href}`);
    }
  }

  // Verify ALL 87 players' Overview `Recent Mentions (7d)` (`rankPlayerOverviewMentions`) enforce 100% direct link integrity,
  // primary-subject ranking ahead of secondary ripple mentions/mock drafts, cross-player `espn_pwire_*` isolation, and user mute prefs
  let totalOverviewMentionsChecked = 0;
  for (const rp of liveRoster.players || []) {
    const ovItems = rankPlayerOverviewMentions(rp, { rawStream: liveNews.rawStream, appData: liveBundle });
    for (const it of ovItems) {
      totalOverviewMentionsChecked++;
      const href =
        it.type === 'tweet' || it.type === 'social'
          ? sanitizeExternalUrl(resolveOriginalTweetUrl({ ...it, primaryPlayer: { name: rp.name } }, liveDirectSocial), null)
          : sanitizeExternalUrl(it.url, null);
      assert.ok(href && href.startsWith('https://'), `Invalid Overview mention link for ${rp.name}: ${href}`);
      assert.ok(!href.includes('x.com/search'), `Overview mention for ${rp.name} must never use speculative x.com/search: ${href}`);
      assert.equal(isPaywalledOrBlockedUrl(href), false, `Blocked/paywalled Overview mention URL for ${rp.name}: ${href}`);
      if (String(it.id || '').startsWith('espn_pwire_')) {
        const ownerId = String(it.id).split('_')[2];
        assert.equal(ownerId, String(rp.id), `Cross-player espn_pwire leak on ${rp.name}: ${it.id}`);
      }
    }
  }
  assert.ok(totalOverviewMentionsChecked >= 100, `Expected >=100 total Overview mentions audited across 87 players, got ${totalOverviewMentionsChecked}`);

  const syntheticPurdy = { id: '4361741', name: 'Brock Purdy', position: 'QB', recentNews: [] };
  const rankedPurdyOverview = rankPlayerOverviewMentions(syntheticPurdy, {
    nowMs: roadPracticeNowMs,
    rawStream: [
      {
        id: 'mock_draft_1',
        type: 'article',
        author: '49ers Webzone',
        title: '49ers add protection for Brock Purdy in 3-round 2027 NFL mock draft',
        url: 'https://www.49erswebzone.com/articles/205051-mock-draft/',
        publishedAt: new Date(roadPracticeNowMs - 2 * 3_600_000).toISOString()
      },
      {
        id: 'ripple_trade_1',
        type: 'tweet',
        author: 'Ian Rapoport',
        title: 'The 49ers are completing a trade for Colts WR Keenan Allen. Another pass-catcher for Brock Purdy.',
        fullText: 'The 49ers are completing a trade for Colts WR Keenan Allen. Another pass-catcher for Brock Purdy.',
        url: 'https://bsky.app/profile/rapsheet.bsky.social/post/3mzy45qejoc2l',
        publishedAt: new Date(roadPracticeNowMs - 3 * 3_600_000).toISOString()
      },
      {
        id: 'purdy_primary_1',
        type: 'article',
        author: 'Matt Maiocco',
        reporterId: 'matt_maiocco',
        title: 'Brock Purdy reaches 100 career passing touchdowns while dissecting two-high coverage shells',
        url: 'https://www.nbcsportsbayarea.com/nfl/san-francisco-49ers/brock-purdy-100-tds/',
        publishedAt: new Date(roadPracticeNowMs - 6 * 3_600_000).toISOString()
      },
      {
        id: 'espn_pwire_16737_99999',
        type: 'article',
        wireSource: 'espn_player_wire',
        author: 'Cam Inman',
        title: 'Evans (Achilles) did not practice while Brock Purdy threw in full.',
        url: 'https://www.espn.com/nfl/player/_/id/16737/mike-evans#:~:text=Evans',
        publishedAt: new Date(roadPracticeNowMs - 1 * 3_600_000).toISOString()
      }
    ]
  });
  assert.equal(rankedPurdyOverview.length, 3, 'Cross-player espn_pwire_16737_* must be excluded from Brock Purdy Overview');
  assert.equal(rankedPurdyOverview[0].id, 'purdy_primary_1', 'Primary Purdy milestone/film article must rank #1 ahead of trade ripple & mock draft');
  const mutedPurdyOverview = rankPlayerOverviewMentions(syntheticPurdy, {
    nowMs: roadPracticeNowMs,
    userPrefs: { disabledReporterIds: ['matt_maiocco'], disabledOutlets: [] },
    rawStream: rankedPurdyOverview
  });
  assert.equal(mutedPurdyOverview.some(x => x.id === 'purdy_primary_1'), false, 'Overview mentions must respect userPrefs muted reporters');
});

test('X-first social link priority: upgrades Bluesky mirrors to analogous X status links, promotes X leads in clusters & briefs, and preserves Bluesky fallback only when X is undiscoverable', () => {
  // 1. Player scoop X search includes Matt Barrows (@mattbarrows)
  const purdyXSearch = buildXPlayerScoopSearchUrl('Brock Purdy');
  assert.ok(purdyXSearch.includes('from%3Amattbarrows'), `Expected from:mattbarrows in X player scoop search: ${purdyXSearch}`);

  // 2. Bluesky post upgrades to direct X status URL when analogous X tweet exists, and keeps bsky.app when X tweet does not exist
  const barrowsXPost = {
    type: 'tweet',
    url: 'https://x.com/mattbarrows/status/2120638097100886138',
    author: 'Matt Barrows',
    authorHandle: '@mattbarrows',
    title: 'Keenan Allen sure seems happy to be back in the Northern California sun.',
    fullText: 'Keenan Allen sure seems happy to be back in the Northern California sun.',
    publishedAt: '2026-11-11T22:00:00.000Z'
  };
  const barrowsBskyMirror = {
    type: 'tweet',
    url: 'https://bsky.app/profile/mattbarrows.bsky.social/post/3n23allen123',
    author: 'Matt Barrows',
    authorHandle: '@mattbarrows',
    title: 'Keenan Allen sure seems happy to be back in the Northern California sun.',
    fullText: 'Keenan Allen sure seems happy to be back in the Northern California sun.',
    publishedAt: '2026-11-11T22:04:00.000Z'
  };
  assert.equal(
    resolveOriginalTweetUrl(barrowsBskyMirror, [barrowsXPost]),
    'https://x.com/mattbarrows/status/2120638097100886138'
  );

  // Unrelated same-day Barrows post on a different topic MUST NOT collide with Keenan Allen X status; keeps verified bsky.app fallback
  const barrowsUnrelatedBsky = {
    type: 'tweet',
    url: 'https://bsky.app/profile/mattbarrows.bsky.social/post/3n24qhsd6c22u',
    author: 'Matt Barrows',
    authorHandle: '@mattbarrows',
    title: 'Brock Purdy for MVP? For real? He’s among the 49ers nominated for midseason honors',
    fullText: 'Brock Purdy for MVP? For real? He’s among the 49ers nominated for midseason honors',
    publishedAt: '2026-11-11T22:30:00.000Z'
  };
  assert.equal(
    resolveOriginalTweetUrl(barrowsUnrelatedBsky, [barrowsXPost]),
    'https://bsky.app/profile/mattbarrows.bsky.social/post/3n24qhsd6c22u'
  );

  // 3. Story clustering promotes direct `x.com/<handle>/status/<id>` lead over a Bluesky post even when Bluesky carries an image thumbnail
  const clustered = deduplicateAndGroupWireItems(
    [
      {
        id: 'bsky_first_with_thumb',
        type: 'tweet',
        trustTier: 1,
        signalScore: 80,
        author: '49ers on NBCSBA',
        authorHandle: '@NBCS49ers',
        outletId: 'nbcsba',
        outletName: 'NBC Sports Bay Area',
        imageUrl: 'https://cdn.bsky.app/img/feed_thumbnail/plain/did:plc:test/thumb1',
        url: 'https://bsky.app/profile/nbcs49ers.bsky.social/post/3n23b2cukis2d',
        title: 'Keenan Allen and Mike Evans squashed their beef and are all good now',
        fullText: 'Keenan Allen and Mike Evans squashed their beef and are all good now',
        publishedAt: '2026-11-12T00:54:00.000Z'
      },
      {
        id: 'x_second_no_thumb',
        type: 'tweet',
        trustTier: 1,
        signalScore: 80,
        author: '49ers on NBCSBA',
        authorHandle: '@NBCS49ers',
        outletId: 'nbcsba',
        outletName: 'NBC Sports Bay Area',
        imageUrl: '',
        url: 'https://x.com/NBCS49ers/status/2120640440341037224',
        title: 'Keenan Allen and Mike Evans squashed their beef and are all good now',
        fullText: 'Keenan Allen and Mike Evans squashed their beef and are all good now',
        publishedAt: '2026-11-11T23:20:00.000Z'
      }
    ],
    { nowMs: Date.parse('2026-11-12T02:00:00.000Z') }
  );
  assert.equal(clustered.length, 1);
  assert.equal(clustered[0].url, 'https://x.com/NBCS49ers/status/2120640440341037224', 'Direct X status must always win cluster lead over Bluesky mirror');
  assert.equal(isDirectXStatusUrl(clustered[0].url), true);
  assert.equal(isBlueskyPostUrl(clustered[0].url), false);

  // 4. Daily Top News Brief source selector & prose renderer upgrade Bluesky link-shares and mirrors to X status or canonical article URLs
  const briefCands = selectTopNewsBriefSourceCandidates(
    {
      news: {
        rawStream: [
          {
            id: 'bsky_rumors_share',
            type: 'tweet',
            author: 'NFL Trade Rumors',
            outletName: 'NFL Trade Rumors',
            title: '49ers Restructured DT DeForest Buckner For $5.2M In Cap Space',
            fullText: '49ers Restructured DT DeForest Buckner For $5.2M In Cap Space',
            url: 'https://bsky.app/profile/nfltraderumors.bsky.social/post/3n24oqtlffn2n',
            externalUrl: 'https://nfltraderumors.co/49ers-restructured-dt-deforest-buckner-for-5-2m-in-cap-space/',
            publishedAt: '2026-11-12T14:32:15Z'
          }
        ]
      }
    },
    6,
    Date.parse('2026-11-12T18:00:00Z')
  );
  assert.equal(
    briefCands[0]?.url,
    'https://nfltraderumors.co/49ers-restructured-dt-deforest-buckner-for-5-2m-in-cap-space/',
    'Bluesky link-share without X status must upgrade to its free canonical article URL in Daily Top News Brief'
  );

  const renderedBriefHtml = renderDailyTopNewsBriefHtml(
    {
      id: 'test_brief_x_upgrade',
      headline: '49ers Week 10 Briefing',
      generatedAt: '2026-11-12T18:00:00Z',
      summary: 'Keenan Allen practiced in Northern California sunshine [Matt Barrows](https://bsky.app/profile/mattbarrows.bsky.social/post/3n23allen123).',
      bullets: [
        'Roster Note: Keenan Allen joined practice Wednesday [Matt Barrows](https://bsky.app/profile/mattbarrows.bsky.social/post/3n23allen123).',
        'Award Watch: Brock Purdy drew midseason MVP recognition [Matt Barrows](https://bsky.app/profile/mattbarrows.bsky.social/post/3n24qhsd6c22u).'
      ],
      sources: [
        {
          type: 'tweet',
          author: 'Matt Barrows',
          outlet: 'The Athletic',
          title: 'Keenan Allen sure seems happy to be back in the Northern California sun.',
          url: 'https://bsky.app/profile/mattbarrows.bsky.social/post/3n23allen123',
          publishedAt: '2026-11-11T22:04:00.000Z'
        },
        {
          type: 'tweet',
          author: 'Matt Barrows',
          outlet: 'The Athletic',
          title: 'Brock Purdy for MVP? For real? He’s among the 49ers nominated for midseason honors',
          url: 'https://bsky.app/profile/mattbarrows.bsky.social/post/3n24qhsd6c22u',
          publishedAt: '2026-11-11T22:30:00.000Z'
        }
      ]
    },
    { rawStream: [barrowsXPost] }
  );
  assert.ok(
    renderedBriefHtml.includes('href="https://x.com/mattbarrows/status/2120638097100886138"'),
    'Inline brief citation and source drawer must upgrade Bluesky URL to analogous X status URL'
  );
  assert.ok(
    !renderedBriefHtml.includes('3n23allen123'),
    'Upgraded Bluesky URL must not remain in rendered brief HTML'
  );
  assert.ok(
    renderedBriefHtml.includes('https://bsky.app/profile/mattbarrows.bsky.social/post/3n24qhsd6c22u'),
    'Undiscoverable X status fallback must cleanly keep verified Bluesky URL'
  );
});

test('Daily Top News Brief inline citations: handles parenthesized URLs (#:~:text=Greenlaw%20(knee)..., X boolean queries) with zero leaked %20 fragments and self-heals cached briefs', () => {
  const greenlawUrl =
    "https://www.espn.com/nfl/player/_/id/3916903/dre-greenlaw#:~:text=Greenlaw%20(knee)%20was%20limited%20during%20Thursday's%20practice";
  const williamsUrl =
    'https://www.espn.com/nfl/player/_/id/13241/trent-williams#:~:text=Williams%20(shoulder)%20was%20a%20limited%20participant%20at';
  const evansUrl =
    'https://www.espn.com/nfl/player/_/id/16737/mike-evans#:~:text=Coach%20Kyle%20Shanahan%20said%20Thursday%20that%20Evans';
  const xBooleanSearchUrl =
    'https://x.com/search?q=(from%3Anwagoner%20OR%20from%3AMaioccoNBCS)%20(injury%20OR%20DNP)&src=typed_query&f=live';

  // 1. Exact reproduction of user-reported Dre Greenlaw (knee) Top News Brief synthesis & rendering
  const mockCandidates = [
    {
      refId: 'S1',
      type: 'article',
      author: 'Matt Maiocco',
      outlet: 'NBC Sports Bay Area',
      citeLabel: 'Matt Maiocco',
      title: 'Williams (shoulder) was a limited participant at practice Thursday.',
      url: williamsUrl,
      publishedAt: '2026-11-13T01:49:40.000Z'
    },
    {
      refId: 'S2',
      type: 'tweet',
      author: '49ers Beat',
      outlet: 'X Beat Wire',
      citeLabel: '49ers Beat',
      title: 'Thursday practice participation updates ahead of Cowboys matchup.',
      url: xBooleanSearchUrl,
      publishedAt: '2026-11-13T00:50:00.000Z'
    },
    {
      refId: 'S3',
      type: 'article',
      author: 'Matt Maiocco',
      outlet: 'NBC Sports Bay Area',
      citeLabel: 'Matt Maiocco',
      title: "Greenlaw (knee) was limited during Thursday's practice.",
      url: greenlawUrl,
      publishedAt: '2026-11-13T00:44:02.000Z'
    },
    {
      refId: 'S4',
      type: 'article',
      author: 'David Lombardi',
      outlet: 'The SF Standard',
      citeLabel: 'David Lombardi',
      title: 'Coach Kyle Shanahan said Thursday that Evans is real close to returning.',
      url: evansUrl,
      publishedAt: '2026-11-13T00:28:11.000Z'
    }
  ];

  const synthesized = parseAndSanitizeDailyTopNewsBrief(
    {
      headline: '49ers Monitor Cornerback and Williams Injuries Alongside Post-Deadline Receiver Pivot Before Cowboys',
      summary:
        "San Francisco prepares for Sunday's Week 10 trip to Dallas with starting cornerbacks missing consecutive practices alongside key front-seven monitoring [S2]. Meanwhile, post-deadline reporting highlighted veteran receiver depth.",
      bullets: [
        'Deadline Strategy and Cap Balance: San Francisco preserved $39.18 million in 2026 rollover space against a -$36.74 million 2027 projection while onboarding veteran pass-catching help [S2].',
        "Practice Report and Availability: Trent Williams (shoulder) shifted from Wednesday rest to limited Thursday work, leaving Sunday uncertainty without a full Friday practice [S1]. Dre Greenlaw (knee) was also limited, keeping Jaden Dugger and Garret Wallow ready [S3], while Mike Evans (Achilles) stayed out Thursday and is not expected to play despite nearing a return [S4]."
      ],
      citedSourceIds: ['S1', 'S2', 'S3', 'S4']
    },
    mockCandidates,
    { roster: { players: [] } },
    { cycleKey: '2026-11-12@17PT', source: 'live-gemini-daily' }
  );

  assert.ok(synthesized, 'Expected synthesized brief to validate cleanly');
  assert.ok(
    synthesized.bullets[1].includes(encodeMarkdownLinkUrl(greenlawUrl)),
    `Expected Greenlaw URL parens to be RFC-3986 encoded inside Markdown link: ${synthesized.bullets[1]}`
  );

  const renderedHtml = renderDailyTopNewsBriefHtml(synthesized);
  const visibleProseOnly = renderedHtml.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  assert.ok(
    !visibleProseOnly.includes('%20') && !visibleProseOnly.includes("Thursday's%20practice"),
    `Rendered brief must never leak %20 URL fragments into visible prose: ${visibleProseOnly}`
  );
  assert.ok(
    renderedHtml.includes("Greenlaw%20%28knee%29%20was%20limited%20during%20Thursday&#39;s%20practice") ||
      renderedHtml.includes("Greenlaw%20%28knee%29%20was%20limited%20during%20Thursday's%20practice"),
    'Inline source link href must preserve full W3C text fragment past (knee)'
  );

  // 2. Self-healing of legacy unencoded AND split-tail cached briefs from localStorage
  const legacyCorruptedBrief = {
    id: 'daily_brief_legacy',
    cycleKey: '2026-11-12@17PT',
    headline: 'Legacy Cached Brief With Unencoded & Split Parenthesized URLs',
    summary: `Trent Williams was limited Thursday, per ([Matt Maiocco](${williamsUrl})).`,
    bullets: [
      `Practice Report: Dre Greenlaw (knee) was limited, keeping Jaden Dugger ready [Matt Maiocco](${greenlawUrl}), while Mike Evans stayed out.`,
      "Split Cache Artifact: Dre Greenlaw was limited [Matt Maiocco](https://www.espn.com/nfl/player/_/id/3916903/dre-greenlaw#:~:text=Greenlaw%20(knee) %20was%20limited%20during%20Thursday's%20practice), while Mike Evans rested."
    ],
    sources: []
  };
  const { brief: repaired, mutated } = repairDailyTopNewsBriefLinks(legacyCorruptedBrief);
  assert.equal(mutated, true, 'repairDailyTopNewsBriefLinks must detect and heal unencoded/split parenthesized URLs');
  const repairedHtml = renderDailyTopNewsBriefHtml(repaired);
  const repairedVisible = repairedHtml.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  assert.ok(
    !/%[0-9A-Fa-f]{2}/.test(repairedVisible) && !repairedVisible.includes('per ('),
    `Repaired legacy brief must render zero %XX fragments and strip outer 'per (...)': ${repairedVisible}`
  );

  // 3. Direct renderBriefProseWithInlineLinksHtml & stripMarkdownInlineLinks balanced-paren resilience
  const wikiProse =
    'Left tackle ([Wikipedia](https://en.wikipedia.org/wiki/Trent_Williams_(American_football))) anchored pass protection.';
  const wikiHtml = renderBriefProseWithInlineLinksHtml(wikiProse);
  assert.ok(
    wikiHtml.includes('Trent_Williams_%28American_football%29') &&
      !/American_football\)/.test(wikiHtml.replace(/<[^>]+>/g, '')),
    `Expected balanced Wikipedia URL rendering without trailing ')' leak: ${wikiHtml}`
  );
  assert.equal(
    stripMarkdownInlineLinks(`Update [Maiocco](${greenlawUrl}) complete.`, { keepLabel: false }).replace(/\s+/g, ' ').trim(),
    'Update complete.'
  );

  // 4. buildEspnPlayerNewsAnchorUrl trims mid-parenthetical 7-word cuts so URLs never carry unbalanced '('
  const midParenCutAnchor = buildEspnPlayerNewsAnchorUrl(
    '3916903',
    'Dre Greenlaw',
    'Coach Kyle Shanahan noted on Thursday (during open media availability) that Greenlaw looked sharp.'
  );
  const fragPart = midParenCutAnchor.split('#:~:text=')[1] || '';
  assert.equal(
    (fragPart.match(/\(/g) || []).length,
    (fragPart.match(/\)/g) || []).length,
    `Anchor fragment must never contain unbalanced parentheses: ${midParenCutAnchor}`
  );

  // 5. Verify live data/news.json dailyTopNewsBrief renders with zero leaked %XX or URL fragments
  const liveNewsJson = JSON.parse(fs.readFileSync(path.join(rootDir, 'data', 'news.json'), 'utf8'));
  const liveBriefHtml = renderDailyTopNewsBriefHtml(liveNewsJson.dailyTopNewsBrief, {
    rawStream: liveNewsJson.rawStream
  });
  const liveBriefVisible = liveBriefHtml.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  assert.ok(
    !/%[0-9A-Fa-f]{2}|#:~:text=|https?:\/\//i.test(liveBriefVisible),
    `Live data/news.json dailyTopNewsBrief leaked raw URL/encoding into prose: ${liveBriefVisible}`
  );
});

await testAsync('Draft Section: 4-Board Consensus Big Board above Combine, Preseason-to-Combine Blank Window, and 1-Month In-Season vs 1-Week Post-Elimination First-Pick Mock Database', async () => {
  const seasonalJson = JSON.parse(fs.readFileSync(path.join(rootDir, 'data', 'seasonal.json'), 'utf8'));
  const metaJson = JSON.parse(fs.readFileSync(path.join(rootDir, 'data', 'meta.json'), 'utf8'));
  const smJson = JSON.parse(fs.readFileSync(path.join(rootDir, 'data', 'schedule-matchup.json'), 'utf8'));
  const dp = seasonalJson.draftPrep2027;

  // 1. 3-Lens NFL Draft Big Board integrity (250+ prospects across 7 rounds, zero 2026 draftees, zero paywalls)
  assert.ok(Array.isArray(dp.consensusBigBoard) && dp.consensusBigBoard.length >= 250, 'NFL Draft Big Board must contain >=250 ranked 2027 prospects');
  assert.equal(dp.consensusBigBoard[0].consensusRank, 1);
  assert.equal(dp.consensusBigBoard[0].name, 'Jeremiah Smith');
  assert.equal(dp.consensusBigBoard[0].boards.buzz.rank, 1);
  assert.equal(dp.consensusBigBoard[0].boards.pff.rank, 1);
  assert.equal(dp.consensusBigBoard[0].spread, 0);
  for (let i = 0; i < dp.consensusBigBoard.length; i++) {
    const b = dp.consensusBigBoard[i];
    assert.equal(b.consensusRank, i + 1, 'Consensus Big Board ranks must be sequential 1..N');
    assert.equal(b.boards.consensus.rank, i + 1, 'boards.consensus.rank must match consensusRank');
    assert.ok(b.profileUrl && !isPaywalledOrBlockedUrl(b.profileUrl), `Blocked/invalid Big Board profileUrl: ${b.profileUrl}`);
    assert.ok(b.mockDbUrl && !isPaywalledOrBlockedUrl(b.mockDbUrl), `Blocked/invalid Big Board mockDbUrl: ${b.mockDbUrl}`);
    assert.ok(b.pffUrl && !isPaywalledOrBlockedUrl(b.pffUrl), `Blocked/invalid Big Board pffUrl: ${b.pffUrl}`);
    assert.ok(b.buzzUrl && !isPaywalledOrBlockedUrl(b.buzzUrl), `Blocked/invalid Big Board buzzUrl: ${b.buzzUrl}`);
  }
  const olFiltered = filterConsensusBigBoard(dp.consensusBigBoard, { posGroup: 'OL' });
  assert.ok(olFiltered.length >= 3 && olFiltered.every(p => /^(OT|IOL|OG|G|C|OL|T)$/i.test(p.pos)), 'OL Big Board filter must isolate offensive linemen');
  const sfWindowFiltered = filterConsensusBigBoard(dp.consensusBigBoard, { posGroup: 'SF_RANGE', sfPickOverall: 31 });
  assert.ok(sfWindowFiltered.length >= 5 && sfWindowFiltered.every(p => p.consensusRank >= 20 && p.consensusRank <= 45));

  // 2. Combine Leaderboard: strictly data-year filtered (no calendar date gate; excludes prior-year rows)
  const staleOnlyCombineRows = [
    { name: 'Stale 2026 Draftee', pos: 'EDGE', school: 'Texas Tech', season: 2026, forty: 4.52, ras: 9.41 }
  ];
  const mixedCombineRows = [
    ...staleOnlyCombineRows,
    { name: 'Fresh 2027 Prospect', pos: 'EDGE', school: 'Texas', season: 2027, forty: 4.46, ras: 9.82 }
  ];

  for (const checkDate of ['2026-07-20T18:00:00Z', '2026-11-12T18:00:00Z', '2027-02-20T18:00:00Z']) {
    const emptyWhenNoTargetYr = evaluateCombineLeaderboardWindow({
      now: checkDate,
      seasonYear: 2026,
      draftYear: 2027,
      combineLeaderboard: staleOnlyCombineRows
    });
    assert.equal(emptyWhenNoTargetYr.isBlankWindow, true, `Prior-year 2026 Combine rows must never leak into 2027 Draft view at ${checkDate}`);
    assert.equal(emptyWhenNoTargetYr.rows.length, 0);
  }

  const populatedWhenDataExists = evaluateCombineLeaderboardWindow({
    seasonYear: 2026,
    draftYear: 2027,
    combineLeaderboard: mixedCombineRows
  });
  assert.equal(populatedWhenDataExists.isBlankWindow, false, 'Combine Leaderboard activates immediately once target-year Combine rows exist');
  assert.equal(populatedWhenDataExists.rows.length, 1);
  assert.equal(populatedWhenDataExists.rows[0].name, 'Fresh 2027 Prospect', 'Only 2027 Combine class rows may appear');

  assert.equal(dp.combineLeaderboard.length, 0, 'Live Nov 2026 seasonal.json must store 0 stale prior-year Combine rows');

  // 3. 49ers First-Pick Mock Draft Database: Trailing 30 Days Initially -> Trailing 7 Days After the Super Bowl
  const syntheticMocks = [
    { siteId: 'cbs', siteName: 'CBS Sports', url: 'https://www.cbssports.com/nfl/draft/mock-draft/', publishedAt: '2026-11-10T12:00:00Z', projectedPick: 31, playerName: 'Trevor Goosby', pos: 'OT', school: 'Texas' },
    { siteId: 'fox', siteName: 'FOX Sports', url: 'https://www.foxsports.com/nfl/draft', publishedAt: '2026-11-08T12:00:00Z', projectedPick: 31, playerName: 'Trevor Goosby', pos: 'OT', school: 'Texas' },
    { siteId: 'si', siteName: 'Sports Illustrated', url: 'https://www.si.com/nfl/2027-nfl-mock-draft-gilberto-manzano-pick-predictions-rounds-1-2', publishedAt: '2026-10-22T12:00:00Z', projectedPick: 31, playerName: 'Trevor Goosby', pos: 'OT', school: 'Texas' },
    { siteId: 'tk', siteName: 'Tankathon', url: 'https://www.tankathon.com/nfl/mock_draft', publishedAt: '2026-11-11T12:00:00Z', projectedPick: 31, playerName: 'Nick Marsh', pos: 'WR', school: 'Indiana' },
    { siteId: 'dt', siteName: 'DraftTek', url: 'https://www.drafttek.com/2027-NFL-Mock-Draft/2027-NFL-Mock-Draft-Round-1.asp', publishedAt: '2026-10-25T12:00:00Z', projectedPick: 32, playerName: 'Nick Marsh', pos: 'WR', school: 'Indiana' },
    { siteId: 'old_sept', siteName: 'NFL Draft Countdown', url: 'https://draftcountdown.com/2027-nfl-draft/2027-nfl-mock-draft/', publishedAt: '2026-09-16T12:00:00Z', projectedPick: 28, playerName: 'Kade Pieper', pos: 'IOL', school: 'Iowa' }
  ];

  // 3a. Initial / In-Season before Super Bowl (Nov 12, 2026 -> trailing 30-day window, even if eliminated!)
  const inSeasonDb = resolveFirstPickMockDatabase(syntheticMocks, {
    now: '2026-11-12T18:00:00Z',
    appData: {
      meta: { seasonYear: 2026, teamStatus: { mathematicallyEliminated: true } },
      scheduleMatchup: { schedule: [] }
    }
  });
  assert.equal(inSeasonDb.isPostSuperBowl, false);
  assert.equal(inSeasonDb.freshnessDays, 30);
  assert.equal(inSeasonDb.shortWindowBadge, '30D Window');
  assert.equal(inSeasonDb.totalFreshSites, 5, '5 sites within 30d kept; 1 stale Sept mock (>30d) excluded');
  assert.equal(inSeasonDb.staleExcludedCount, 1);
  assert.equal(inSeasonDb.players[0].playerName, 'Trevor Goosby');
  assert.equal(inSeasonDb.players[0].siteCount, 3);
  assert.equal(inSeasonDb.players[1].playerName, 'Nick Marsh');
  assert.equal(inSeasonDb.players[1].siteCount, 2);

  // 3b. January Playoffs before Super Bowl still uses trailing 30-day window
  const janPreSbWin = evaluateMockDraftFreshnessWindow(
    { meta: { seasonYear: 2026 } },
    { now: '2027-01-25T18:00:00Z', draftYear: 2027 }
  );
  assert.equal(janPreSbWin.isPostSuperBowl, false);
  assert.equal(janPreSbWin.freshnessDays, 30);

  // 3c. Post-Super Bowl (Feb 20, 2027 -> tightens automatically to trailing 7-day freshness window!)
  const postSbMocks = [
    { siteId: 'cbs', siteName: 'CBS Sports', url: 'https://www.cbssports.com/nfl/draft/mock-draft/', publishedAt: '2027-02-18T12:00:00Z', projectedPick: 31, playerName: 'Trevor Goosby', pos: 'OT', school: 'Texas' },
    { siteId: 'fox', siteName: 'FOX Sports', url: 'https://www.foxsports.com/nfl/draft', publishedAt: '2027-02-16T12:00:00Z', projectedPick: 31, playerName: 'Trevor Goosby', pos: 'OT', school: 'Texas' },
    { siteId: 'si', siteName: 'Sports Illustrated', url: 'https://www.si.com/nfl/2027-nfl-mock-draft-gilberto-manzano-pick-predictions-rounds-1-2', publishedAt: '2027-02-02T12:00:00Z', projectedPick: 31, playerName: 'Trevor Goosby', pos: 'OT', school: 'Texas' },
    { siteId: 'tk', siteName: 'Tankathon', url: 'https://www.tankathon.com/nfl/mock_draft', publishedAt: '2027-02-19T12:00:00Z', projectedPick: 31, playerName: 'Nick Marsh', pos: 'WR', school: 'Indiana' },
    { siteId: 'dt', siteName: 'DraftTek', url: 'https://www.drafttek.com/2027-NFL-Mock-Draft/2027-NFL-Mock-Draft-Round-1.asp', publishedAt: '2027-02-05T12:00:00Z', projectedPick: 32, playerName: 'Nick Marsh', pos: 'WR', school: 'Indiana' }
  ];
  const postSbDb = resolveFirstPickMockDatabase(postSbMocks, {
    now: '2027-02-20T18:00:00Z',
    draftYear: 2027,
    appData: { meta: { seasonYear: 2026 } }
  });
  assert.equal(postSbDb.isPostSuperBowl, true);
  assert.equal(postSbDb.freshnessDays, 7);
  assert.equal(postSbDb.shortWindowBadge, '7D Window');
  assert.equal(postSbDb.totalFreshSites, 3, 'Under post-Super Bowl 7-day window, early-Feb mocks (>7d old) must be excluded');
  assert.equal(postSbDb.players[0].playerName, 'Trevor Goosby');
  assert.equal(postSbDb.players[0].siteCount, 2);
  assert.equal(postSbDb.players[1].playerName, 'Nick Marsh');
  assert.equal(postSbDb.players[1].siteCount, 1);

  // 3d. Next cycle June offseason (2028 Draft) resets cleanly to trailing 30-day window until next Super Bowl
  const nextCycleJuneWin = evaluateMockDraftFreshnessWindow(
    { meta: { seasonYear: 2027 } },
    { now: '2027-06-20T18:00:00Z', draftYear: 2028 }
  );
  assert.equal(nextCycleJuneWin.isPostSuperBowl, false);
  assert.equal(nextCycleJuneWin.freshnessDays, 30);

  // 4. Rendered Draft view card ordering: Consensus Mock Draft -> Consensus Big Board -> Combine Leaderboard (blank)
  const draftHtml = renderSeasonMatchupViewHtml({
    seasonSub: 'draft_prep',
    appData: {
      meta: { ...metaJson, now: '2026-11-12T18:00:00Z' },
      roster: { players: [] },
      scheduleMatchup: smJson,
      seasonal: seasonalJson
    }
  });
  const mockIdx = draftHtml.indexOf('id="consensusMockDraftCard"');
  const boardIdx = draftHtml.indexOf('id="consensusBigBoardCard"');
  const combineIdx = draftHtml.indexOf('id="combineLeaderboardCard"');
  assert.ok(mockIdx > 0 && boardIdx > mockIdx && combineIdx > boardIdx, 'NFL Draft Big Board must render directly above Combine Leaderboard');
  assert.ok(!draftHtml.includes('class="big-board-meta-note"'), 'Verbose static meta-note paragraph must be hidden in favor of sleek tooltip-links');
  assert.ok(draftHtml.includes('data-jargon="big_board_sources"'), 'Big Board header must render clickable Sources & Accuracy tooltip-link');
  assert.ok(draftHtml.includes('data-jargon="draft_buzz_edp"') && draftHtml.includes('data-jargon="pff_big_board"'), 'Big Board must render Likely (Buzz) and PFF tooltip-link triggers');
  assert.ok(draftHtml.includes('id="bigBoardSortSelect"') && draftHtml.includes('id="bigBoardFilterDrawerBtn"'), 'Big Board must render Sort dropdown and Filters drawer toggle');
  assert.ok(draftHtml.includes('class="big-board-desktop-thead"'), 'Big Board must render sortable desktop multi-column table header');
  assert.ok(draftHtml.includes('data-combine-blank="true"'), 'Combine Leaderboard must render blank state during Nov 2026 season');
  assert.ok(!draftHtml.includes('id="combineSearchInput"'), 'Blank Combine Leaderboard must not render stale search input/table');
  assert.ok(draftHtml.includes('data-mock-freshness-badge="30d"'), 'In-season Consensus Mock Draft card must display 30d freshness badge');
  assert.ok(draftHtml.includes('data-mock-site-link='), 'Consensus Mock Draft card must render clickable projecting site links');
  assert.ok(
    !draftHtml.includes('espn.com/college-football/player/') &&
      !draftHtml.includes('cbssports.com/college-football/players/') &&
      !draftHtml.includes('>CBS Profile<') &&
      !draftHtml.includes('>ESPN Profile<'),
    'Draft view must never render stat-only ESPN/CBS college bio links'
  );
  assert.ok(
    draftHtml.includes('https://sticktothemodel.com/player/jeremiah-smith') &&
      draftHtml.includes('>Scouting Report<') &&
      draftHtml.includes('https://www.nfl.com/draft/tracker/2027/prospects'),
    'Draft view must render written Scouting Report + Official NFL Draft Tracker links'
  );

  // Verify automatic promotion to "NFL Scouting Profile" as soon as nflScoutingUrl is published on NFL.com
  const withNflScoutingUrlHtml = renderSeasonMatchupViewHtml({
    seasonSub: 'draft_prep',
    activePhases: ['YEAR_ROUND', 'IN_SEASON'],
    appData: {
      meta: { ...metaJson, now: '2027-02-20T18:00:00Z' },
      roster: { players: [] },
      scheduleMatchup: smJson,
      seasonal: {
        ...seasonalJson,
        draftPrep2027: {
          ...seasonalJson.draftPrep2027,
          consensusBigBoard: seasonalJson.draftPrep2027.consensusBigBoard.map((p, idx) =>
            idx === 0
              ? {
                  ...p,
                  nflScoutingUrl: 'https://www.nfl.com/prospects/jeremiah-smith/3200534d-4900-0001-aaaa-bbbbccccdddd'
                }
              : p
          )
        }
      }
    }
  });
  assert.ok(
    withNflScoutingUrlHtml.includes('https://www.nfl.com/prospects/jeremiah-smith/3200534d-4900-0001-aaaa-bbbbccccdddd') &&
      withNflScoutingUrlHtml.includes('>NFL Scouting Profile<'),
    'Once NFL.com publishes Zierlein prospect profiles, Big Board must promote NFL Scouting Profile as primary link'
  );

  // Verify 2026 Draft Recap renders direct Lance Zierlein NFL.com Scouting Profile links on all 8 picks
  const draftRecapHtml = renderSeasonMatchupViewHtml({
    seasonSub: 'draft_class',
    activePhases: ['YEAR_ROUND', 'IN_SEASON'],
    appData: {
      meta: metaJson,
      roster: { players: [] },
      scheduleMatchup: smJson,
      seasonal: seasonalJson
    }
  });
  assert.ok(
    draftRecapHtml.includes('https://www.nfl.com/prospects/dezhaun-stribling/32005354-5233-6088-e514-5b10403eaf1e') &&
      draftRecapHtml.includes('NFL Scouting'),
    '2026 Draft Recap must link directly to official NFL.com Zierlein Scouting Profiles'
  );
});

test(
  'IR 21-Day Window Full Lifecycle: Open (>0% GTD) -> Missed Weekly 4PM ET Deadline (0%) -> Week N+1 Rollover (>0%) -> Definite Non-Activation News (0%) -> 53-Man Activation (95%)',
  () => {
    const wk10Kickoff = '2026-11-15T21:25:00Z'; // Sunday Nov 15 (Week 10 vs DAL)
    const wk11Kickoff = '2026-11-23T01:20:00Z'; // Sunday Nov 22 SNF (Week 11 vs MIN)

    const buildMockIrAppData = () => ({
      meta: { seasonYear: 2026, currentWeek: 10 },
      roster: {
        players: [
          {
            id: '4686308',
            name: 'C.J. West',
            position: 'DT',
            jersey: 99,
            rosterBucket: 'ir',
            primarySnapPct: 58,
            capHit2026: 1_350_000,
            health: {
              status: 'Injured Reserve',
              injuryType: 'Knee',
              fantasyStatusAbbr: 'IR-R',
              isSeasonEnding: false,
              isPracticeWindowOpen: false,
              isPracticeWindowExpected: false,
              isOnPracticeReport: false,
              placedBeforeWeek: 3,
              earliestEligibleWeek: 7,
              projectedReturnWeek: 'TBD (21d Window Not Open)',
              wed: '-',
              thu: '-',
              fri: '-',
              playProbabilityPct: 0,
              playTier: 'OUT',
              playBadgeLabel: '0% • IR',
              weeklyHistory2026: []
            }
          },
          {
            id: '3895856',
            name: 'Christian Kirk',
            position: 'WR',
            jersey: 3,
            rosterBucket: 'ir',
            primarySnapPct: 62,
            capHit2026: 6_500_000,
            health: {
              status: 'Injured Reserve',
              injuryType: 'Knee - Meniscus',
              fantasyStatusAbbr: 'IR',
              isSeasonEnding: false,
              isPracticeWindowOpen: false,
              isPracticeWindowExpected: true,
              isOnPracticeReport: false,
              placedBeforeWeek: 6,
              earliestEligibleWeek: 10,
              projectedReturnWeek: 'Est. Week 10–11 (Window Expected)',
              wed: '-',
              thu: '-',
              fri: '-',
              playProbabilityPct: 0,
              playTier: 'OUT',
              playBadgeLabel: '0% • IR',
              weeklyHistory2026: []
            }
          }
        ]
      },
      health: {
        week: 10,
        byeWeek: 8,
        practiceReport: [],
        irAndReserveTracker: []
      },
      depthChart: {
        units: [
          {
            unit: 'Defense',
            rows: [
              {
                position: 'DT',
                baselineChain: [
                  { playerId: '4686308', name: 'C.J. West', playProbabilityPct: 0, statusBadge: '0% • IR', isAvailable: false },
                  { playerId: '9999991', name: 'Osa Odighizuwa', playProbabilityPct: 99, statusBadge: '99% • Full Go', isAvailable: true }
                ],
                projectedActiveChain: []
              }
            ]
          }
        ]
      },
      news: {
        rawStream: [
          {
            id: 'tw_west_open_wk10',
            type: 'tweet',
            author: 'Matt Maiocco',
            reporterId: 'matt_maiocco',
            outletName: 'NBC Sports Bay Area',
            trustTier: 1,
            publishedAt: '2026-11-11T20:15:00Z',
            url: 'https://x.com/MaioccoNBCS/status/1988330001',
            fullText: 'The 49ers opened the practice window for DT CJ West (knee) off injured reserve. He was limited at Wednesday practice.'
          },
          {
            id: 'tw_kirk_no_window_wk10',
            type: 'tweet',
            author: 'Nick Wagoner',
            reporterId: 'nick_wagoner',
            outletName: 'ESPN',
            trustTier: 1,
            publishedAt: '2026-11-11T20:20:00Z',
            url: 'https://x.com/nwagoner/status/1988330002',
            fullText: 'Kyle Shanahan said the 49ers will not open WR Christian Kirk’s 21-day practice window this week.'
          }
        ]
      },
      scheduleMatchup: {
        schedule: [
          { week: 9, dateIso: '2026-11-08T21:25:00Z', completed: true, opponent: { abbr: 'LV', name: 'Las Vegas Raiders' } },
          { week: 10, dateIso: wk10Kickoff, completed: false, opponent: { abbr: 'DAL', name: 'Dallas Cowboys' } },
          { week: 11, dateIso: wk11Kickoff, completed: false, opponent: { abbr: 'MIN', name: 'Minnesota Vikings' } }
        ],
        upcomingMatchup: {
          week: 10,
          oppAbbr: 'DAL',
          oppName: 'Dallas Cowboys',
          kickoffIso: wk10Kickoff,
          opponentHealth: {
            injuryReport: [],
            irReserve: [
              {
                name: 'Sam Williams',
                position: 'DE',
                snapPct: 54,
                status: 'IR — 21-Day Window Open',
                injuryType: 'Knee',
                isSeasonEnding: false,
                isPracticeWindowOpen: true,
                designatedDateIso: '2026-11-11T18:00:00Z',
                wed: 'LP',
                thu: 'LP',
                fri: '-',
                projectedReturnWeek: 'Week 10 Activation Window',
                beatNote: 'Williams had his 21-day practice window opened Wednesday and logged limited practices.',
                playProbabilityPct: 0,
                playBadgeLabel: '0% • IR'
              }
            ],
            summary: { totalStarters: 22 }
          }
        }
      }
    });

    const appData = buildMockIrAppData();
    const west = appData.roster.players[0];
    const kirk = appData.roster.players[1];
    const oppIr = appData.scheduleMatchup.upcomingMatchup.opponentHealth.irReserve[0];

    // Phase 1: Wednesday Week 10 (window opened) -> West > 0% GTD, Kirk window-expected cleared & stays 0%, Opponent IR > 0%
    reconcileRosterAndHealthWithNews(appData, { nowMs: Date.parse('2026-11-11T21:30:00Z') });
    assert.equal(west.health.isPracticeWindowOpen, true);
    assert.ok(west.health.playProbabilityPct > 0, `West open 21d window must be >0%, got ${west.health.playProbabilityPct}%`);
    assert.equal(west.health.isOnPracticeReport, true);
    assert.ok(appData.health.practiceReport.some(r => r.name === 'C.J. West' && r.isIrReturnWindow === true));
    assert.equal(kirk.health.isPracticeWindowOpen, false);
    assert.equal(kirk.health.isPracticeWindowExpected, false, 'Definite window-not-opening news must clear isPracticeWindowExpected');
    assert.equal(kirk.health.playProbabilityPct, 0);
    assert.ok(oppIr.playProbabilityPct > 0, 'Opponent open-window IR player must also compute >0% play probability');
    assert.ok(
      appData.scheduleMatchup.upcomingMatchup.opponentHealth.injuryReport.some(r => r.name === 'Sam Williams'),
      'Opponent open-window IR player (>0%) must appear in opponentHealth.injuryReport'
    );

    // Scorecard invariant: unactivated IR returner in practiceReport must NOT subtract from 22 active healthy starters!
    const summaryPhase1 = computeTeamHealthSummary({
      injuryReport: appData.health.practiceReport,
      irReserve: appData.health.irAndReserveTracker,
      totalStarters: 22
    });
    assert.equal(summaryPhase1.activeStartersHealthy, 22, 'Unactivated IR returner must not reduce X/22 active starters cleared');

    // Grounding snapshot surfaces Activation/Play Odds for open-window IR returners
    const groundingTxt = buildAuthoritativeLiveContextSnapshot(appData);
    assert.match(groundingTxt, /C\.J\. West[\s\S]{0,140}Activation\/Play Odds:/, 'AI grounding must include IR Activation/Play Odds');

    // Phase 2: Saturday Nov 14, 4:05 PM EST (missed Week 10 4:00 PM ET NFL activation deadline) -> both SF & Opp revert to 0% • IR!
    reconcileRosterAndHealthWithNews(appData, { nowMs: Date.parse('2026-11-14T21:05:00Z') });
    assert.equal(west.health.playProbabilityPct, 0, 'Missed weekly activation window must revert West to 0%');
    assert.equal(west.health.playBadgeLabel, '0% • IR');
    assert.equal(west.health.isOnPracticeReport, false);
    assert.equal(appData.health.practiceReport.some(r => r.name === 'C.J. West'), false);
    assert.equal(oppIr.playProbabilityPct, 0, 'Missed weekly activation window must revert Opponent IR returner to 0%');
    assert.equal(
      appData.scheduleMatchup.upcomingMatchup.opponentHealth.injuryReport.some(r => r.name === 'Sam Williams'),
      false,
      'Opponent IR returner must leave opponentHealth.injuryReport once deadline passes'
    );

    // Phase 3: Post-Game Rollover to Week 11 (Monday Nov 16 morning, even with prior-week Saturday non-activation blurb!)
    appData.scheduleMatchup.schedule[1].completed = true;
    west.health.wed = '-';
    west.health.thu = '-';
    west.health.fri = '-';
    west.health.weeklyHistory2026 = [
      { week: 10, injury: 'Knee', gameStatus: 'Questionable', practiceStatus: 'Full Participation in Practice' }
    ];
    west.health.longComment =
      "West upgraded to a full practice session Friday after being limited Wednesday and Thursday, but the 49ers aren't yet ready to activate him ahead of Sunday's Week 10 clash against the Cowboys.";
    west.health.blurbDateIso = '2026-11-14T21:30:00Z';

    reconcileRosterAndHealthWithNews(appData, { nowMs: Date.parse('2026-11-16T17:00:00Z') });
    assert.equal(west.health.isPracticeWindowOpen, true, '21-day window stays open in Week 11');
    assert.ok(
      west.health.playProbabilityPct >= 55,
      `Post-game rollover to Week 11 must restore West >0% GTD (ignoring stale Week 10 Cowboys non-activation blurb), got ${west.health.playProbabilityPct}%`
    );
    assert.equal(west.health.isOnPracticeReport, true);

    // Phase 4: Current-week Week 11 news rules out activation this week -> immediately drops back to 0% • IR
    appData.news.rawStream.unshift({
      id: 'tw_west_not_activating_wk11',
      type: 'tweet',
      author: 'Matt Barrows',
      reporterId: 'matt_barrows',
      outletName: 'The Athletic',
      trustTier: 1,
      publishedAt: '2026-11-20T21:15:00Z',
      url: 'https://x.com/mattbarrows/status/1989550001',
      fullText: 'Kyle Shanahan said the 49ers will not activate DT CJ West from injured reserve ahead of Sunday night against Minnesota.'
    });
    reconcileRosterAndHealthWithNews(appData, { nowMs: Date.parse('2026-11-20T21:30:00Z') });
    assert.equal(west.health.playProbabilityPct, 0, 'Current-week non-activation news must immediately drop West back to 0%');
    assert.equal(west.health.playBadgeLabel, '0% • IR');
    assert.equal(west.health.isOnPracticeReport, false);

    // Phase 5: Official 53-man IR activation wire transaction -> promotes West to active roster at 95% • Full Go
    appData.news.rawStream.unshift({
      id: 'tx_west_activated',
      type: 'tweet',
      author: 'San Francisco 49ers',
      outletId: '49ers_official',
      wireSource: 'official_transactions',
      trustTier: 1,
      publishedAt: '2026-11-28T20:10:00Z',
      url: 'https://www.49ers.com/team/transactions/',
      fullText: 'The San Francisco 49ers have activated DL C.J. West from the Injured Reserve list.'
    });
    appData.scheduleMatchup.schedule[2].completed = true;
    appData.scheduleMatchup.schedule.push({
      week: 12,
      dateIso: '2026-11-29T21:05:00Z',
      completed: false,
      opponent: { abbr: 'GB', name: 'Green Bay Packers' }
    });
    reconcileRosterAndHealthWithNews(appData, { nowMs: Date.parse('2026-11-28T20:20:00Z') });
    assert.equal(west.rosterBucket, 'active', 'Official IR activation must promote player to active 53-man bucket');
    assert.equal(west.health.playProbabilityPct, 95);
    assert.equal(west.health.playBadgeLabel, '95% • Full Go');
  }
);

test('Power Rankings: verified live parsers (Inpredictable, nfelo, RBSDM, CBS, ESPN FPI & Panel) + strict 24h post-game week consistency', () => {
  // 1. Parser verification: Inpredictable HTML
  const inpHtml = `
    <div>As of November 16, 2026</div>
    <table>
      <tr>
        <td>5</td><td>&nbspSF</td><td>5</td>
        <td><span onMouseover='tooltip.show("Past Week GPF 11/16 : 4.3",150)'>50,38</span></td>
        <td>4.3</td><td>1,2,3</td><td>5.0</td><td>3</td><td>1,2</td><td>-0.7</td><td>18</td><td>1,2</td>
        <td>8-1</td><td>1</td><td>98.0%</td><td>0,1</td>
        <td><span onMouseover='tooltip.show("<b>Past Schedule:</b><br />Wk 1: LA 6.6<br />Wk 9: LV -7.8<br />Wk 10: @DAL 1.8",150)'>-1.8</span></td>
      </tr>
    </table>
  `;
  const inp = parseInpredictableHtml(inpHtml);
  assert.ok(inp, 'Inpredictable parser should return SF entry');
  assert.equal(inp.rank, 5);
  assert.equal(inp.delta, '0');
  assert.equal(inp.reportedRecord, '8-1');
  assert.equal(inp.gamesIncluded, 9);
  assert.equal(inp.throughWeek, 10);
  assert.equal(inp.asOfIso, '2026-11-16');
  assert.equal(inp.verified, true);

  // 2. Parser verification: nfelo Next.js SSR HTML (32 teams)
  const nfeloTeams = [];
  const fakeAbbrs = [
    'JAX', 'BUF', 'LAR', 'SEA', 'CIN', 'KC', 'SF', 'DET',
    'CHI', 'MIN', 'DEN', 'PHI', 'BAL', 'GB', 'HOU', 'LAC',
    'PIT', 'TB', 'WAS', 'DAL', 'ATL', 'NE', 'ARI', 'IND',
    'MIA', 'NYJ', 'NO', 'CLE', 'CAR', 'LV', 'TEN', 'NYG'
  ];
  for (let i = 0; i < 32; i += 1) {
    const abbr = fakeAbbrs[i];
    const score = i === 6 ? 1630.78 : 1700 - i * 10;
    const spread = i === 6 ? 5.5 : 8.0 - i * 0.4;
    const wow = i === 6 ? 2.3 : 0.0;
    nfeloTeams.push({
      team: abbr,
      season: 2026,
      nfelo: score,
      spreadValue: spread,
      spreadValueWoWChange: wow,
      wins: i === 6 ? 8 : 5,
      losses: i === 6 ? 1 : 4,
      ties: 0,
      epaPerPlayRank: i === 6 ? 1 : i + 1,
      netEpaPerPlayRank: i === 6 ? 3 : i + 1
    });
  }
  const nfeloHtml = `<script>self.__next_f.push([1,"${JSON.stringify(nfeloTeams).replace(/"/g, '\\"')}"])</script>`;
  const nfelo = parseNfeloHtml(nfeloHtml, { seasonYear: 2026 });
  assert.ok(nfelo, 'nfelo parser should return SF entry');
  assert.equal(nfelo.rank, 7);
  assert.equal(nfelo.reportedRecord, '8-1');
  assert.equal(nfelo.gamesIncluded, 9);
  assert.equal(nfelo.verified, true);

  // 3. Parser verification: RBSDM Team Ratings JSON
  const rbsdmTeams = [];
  for (let i = 0; i < 32; i += 1) {
    const abbr = i === 0 ? 'SF' : `R${String(i).padStart(2, '0')}`;
    rbsdmTeams.push({
      team: abbr,
      tier: i < 4 ? 1 : 3,
      win_pct: i === 0 ? 74.42 : 73.0 - i * 1.2,
      week_ago_win_pct: i === 0 ? 72.1 : i === 1 ? 73.5 : 70.0 - i * 1.2,
      record_wins: i === 0 ? 8 : 5,
      record_losses: i === 0 ? 1 : 4,
      record_ties: 0,
      mean_wins: i === 0 ? 13.44 : 8.5
    });
  }
  const rbsdm = parseRbsdmRatingsJson(
    { stamp: { change_week: 10, season: 2026, ratings_updated_at: '2026-11-17T15:30:32Z' }, teams: rbsdmTeams },
    { season_week_bounds: [{ season: 2026, max_week: 10 }] }
  );
  assert.ok(rbsdm, 'RBSDM parser should return SF entry');
  assert.equal(rbsdm.rank, 1);
  assert.equal(rbsdm.delta, '+1');
  assert.equal(rbsdm.reportedRecord, '8-1');
  assert.equal(rbsdm.throughWeek, 10);
  assert.equal(rbsdm.url, 'https://rbsdm.com/#ratings');

  // 4. Parser verification: CBS Sports HTML
  const cbsHtml = `
    <title>Prisco's NFL Week 11 Power Rankings - CBS Sports</title>
    <script type="application/ld+json">{"dateModified":"2026-11-17T13:34:36+00:00"}</script>
    <table>
      <tr class="team-rankings-stats">
        <td><span class="rank">2</span></td>
        <td><a href="https://www.cbssports.com/nfl/teams/SF/san-francisco-49ers/">49ers</a></td>
        <td>The offense was great in the victory over the Cowboys, but the defense gave up 40.</td>
        <td class="cell-left ">--</td>
        <td>8-1-0</td>
      </tr>
    </table>
  `;
  const cbs = parseCbsSportsHtml(cbsHtml);
  assert.ok(cbs, 'CBS Sports parser should return SF entry');
  assert.equal(cbs.rank, 2);
  assert.equal(cbs.delta, '0');
  assert.equal(cbs.forWeek, 11);
  assert.equal(cbs.throughWeek, 10);
  assert.equal(cbs.reportedRecord, '8-1');
  assert.equal(cbs.gamesIncluded, 9);

  // 5. Parser verification: ESPN FPI JSON
  const fpiTeams = [];
  for (let i = 0; i < 32; i += 1) {
    fpiTeams.push({
      team: { abbreviation: i === 0 ? 'SF' : `E${i}` },
      categories: [
        { name: 'fpi', values: [i === 0 ? 6.608 : 5 - i * 0.3, i + 1, 0, i === 0 ? 8 : 5, i === 0 ? 1 : 4, 0] },
        { name: 'efficiencies', values: [1, 12] },
        { name: 'projections', values: [13.785, 21.9] }
      ]
    });
  }
  const fpi = parseEspnFpiJson({
    lastUpdated: '2026-11-17T07:00Z',
    currentSeason: { type: { week: { number: 10 } } },
    categories: [
      { name: 'fpi', names: ['fpi', 'fpirank', 'rankchange7days', 'numwins', 'numlosses', 'numties'] },
      { name: 'efficiencies', names: ['offefficiencyrank', 'defefficiencyrank'] },
      { name: 'projections', names: ['projectedw', 'probwintitle'] }
    ],
    teams: fpiTeams
  });
  assert.ok(fpi, 'ESPN FPI parser should return SF entry');
  assert.equal(fpi.rank, 1);
  assert.equal(fpi.delta, '0');
  assert.equal(fpi.reportedRecord, '8-1');
  assert.equal(fpi.throughWeek, 10);

  // 6. Parser verification: ESPN Weekly Panel Article
  const espnPanel = parseEspnPanelArticle(
    {
      headline: 'NFL Power Rankings: Stacking all 32 teams for Week 11, plus non-QB MVPs',
      url: 'https://www.espn.com/nfl/story/_/id/50503226/nfl-power-rankings-week-11-non-quarterback-mvps-midseason',
      published: '2026-11-17T20:45:39Z'
    },
    '<h2>1. San Francisco 49ers (8-1)</h2><p><strong>Week 10 result:</strong> Beat the Cowboys 46-40<br/><strong>Week 10 ranking:</strong> 2<br/>LB Fred Warner leads the defense with 88 tackles.</p><h2>2. Buffalo Bills (8-1)</h2>'
  );
  assert.ok(espnPanel, 'ESPN Panel parser should return SF entry');
  assert.equal(espnPanel.rank, 1);
  assert.equal(espnPanel.delta, '+1');
  assert.equal(espnPanel.reportedRecord, '8-1');
  assert.equal(espnPanel.forWeek, 11);
  assert.equal(espnPanel.throughWeek, 10);

  // 7. Strict 24-hour Post-Game Freshness Cutoff & Week Consistency Engine
  // Simulate 49ers 9 completed games through Week 10 (Week 8 Bye), Week 10 kicked off Sun Nov 15 21:25Z (ended Mon Nov 16 00:55Z)
  const sfScheduleWk10 = [
    { week: 1, seasonType: 'REG', result: 'W', kickoffIso: '2026-09-13T20:25Z' },
    { week: 2, seasonType: 'REG', result: 'W', kickoffIso: '2026-09-20T20:05Z' },
    { week: 3, seasonType: 'REG', result: 'W', kickoffIso: '2026-09-27T20:25Z' },
    { week: 4, seasonType: 'REG', result: 'W', kickoffIso: '2026-10-04T20:25Z' },
    { week: 5, seasonType: 'REG', result: 'L', kickoffIso: '2026-10-11T20:25Z' },
    { week: 6, seasonType: 'REG', result: 'W', kickoffIso: '2026-10-18T20:05Z' },
    { week: 7, seasonType: 'REG', result: 'W', kickoffIso: '2026-10-25T17:00Z' },
    { week: 8, seasonType: 'REG', isBye: true, oppAbbr: 'BYE' },
    { week: 9, seasonType: 'REG', result: 'W', kickoffIso: '2026-11-08T21:05Z' },
    { week: 10, seasonType: 'REG', result: 'W', kickoffIso: '2026-11-15T21:25Z' },
    { week: 11, seasonType: 'REG', result: null, kickoffIso: '2026-11-23T01:20Z' }
  ];

  const staleCbsWk9 = {
    id: 'cbs',
    outlet: 'CBS Sports NFL Power Rankings',
    shortName: 'CBS Sports',
    url: 'https://www.cbssports.com/nfl/powerrankings/',
    rank: 2,
    delta: '+1',
    reportedRecord: '7-1',
    gamesIncluded: 8,
    throughWeek: 9,
    forWeek: 10,
    verified: true,
    blurb: 'Week 10 rankings prior to Cowboys win.'
  };
  const staleEspnWk9 = {
    id: 'espn_panel',
    outlet: 'ESPN NFL Power Rankings Panel',
    shortName: 'ESPN Panel',
    url: 'https://www.espn.com/nfl/story/_/id/50435694/nfl-power-rankings-week-10',
    rank: 2,
    delta: '0',
    reportedRecord: '7-1',
    gamesIncluded: 8,
    throughWeek: 9,
    forWeek: 10,
    verified: true,
    blurb: 'Week 10 panel prior to Cowboys win.'
  };

  // Case A: 26 hours after Week 10 game ended (Mon Nov 17 02:55Z) -> strict cutoff active!
  // Mix of 3 fresh Week 10 models (Inpredictable #5, nfelo #7, RBSDM #1) + 2 stale Week 9 polls (CBS #2, ESPN #2)
  const afterCutoffMs = Date.parse('2026-11-17T02:55:00Z');
  const resolvedStrict = resolveConsistentPowerRankings(
    { allSources: [inp, nfelo, rbsdm, staleCbsWk9, staleEspnWk9] },
    sfScheduleWk10,
    { nowMs: afterCutoffMs, currentWeek: 11 }
  );
  assert.equal(resolvedStrict.pastFreshnessCutoff, true, '26h post-game must exceed 24h cutoff');
  assert.equal(resolvedStrict.consistentThroughWeek, 10);
  assert.equal(resolvedStrict.sources.length, 3, 'Only the 3 Week 10 sources should be active after 24h cutoff');
  assert.equal(resolvedStrict.disregardedStaleCount, 2, '2 stale Week 9 polls must be disregarded');
  assert.deepEqual(resolvedStrict.sources.map(s => s.id), ['rbsdm', 'inpredictable', 'nfelo']);
  // Mean of [1, 5, 7] = 13/3 = 4.33 => Consensus #4, Range #1–#7
  assert.equal(resolvedStrict.consensusRank, 4);
  assert.equal(resolvedStrict.rangeShort, '#1–#7');

  // Case B: 26 hours after game ended, ALL sources still stale (Week 9 only) -> must NOT show stale ranks!
  const resolvedAllStaleAfter24h = resolveConsistentPowerRankings(
    { allSources: [staleCbsWk9, staleEspnWk9] },
    sfScheduleWk10,
    { nowMs: afterCutoffMs, currentWeek: 11 }
  );
  assert.equal(resolvedAllStaleAfter24h.sources.length, 0, 'After 24h, stale prior-week rankings must be completely disregarded');
  assert.equal(resolvedAllStaleAfter24h.consensusRank, null);
  assert.equal(resolvedAllStaleAfter24h.cohortStatus, 'awaiting_post_game_updates');
  assert.equal(resolvedAllStaleAfter24h.disregardedStaleCount, 2);

  // Case C: 4 hours after game ended (< 24h), only 1 source updated to Week 10 while 2 are still Week 9 -> hold consistent Week 9 cohort (never mix weeks!)
  const earlyPostGameMs = Date.parse('2026-11-16T05:00:00Z');
  const resolvedPreCutoffHold = resolveConsistentPowerRankings(
    { allSources: [rbsdm, staleCbsWk9, staleEspnWk9] },
    sfScheduleWk10,
    { nowMs: earlyPostGameMs, currentWeek: 11 }
  );
  assert.equal(resolvedPreCutoffHold.pastFreshnessCutoff, false);
  assert.equal(resolvedPreCutoffHold.cohortStatus, 'pre_cutoff_prior_week');
  assert.equal(resolvedPreCutoffHold.consistentThroughWeek, 9);
  assert.equal(resolvedPreCutoffHold.sources.length, 2, 'Must hold on consistent Week 9 cohort rather than mixing Wk 9 + Wk 10');
  assert.ok(resolvedPreCutoffHold.sources.every(s => s.throughWeek === 9));

  // Case D: 10 hours after game ended (< 24h), >= 2 sources updated to Week 10 -> promote consistent Week 10 cohort and exclude Week 9
  const resolvedPreCutoffPromote = resolveConsistentPowerRankings(
    { allSources: [inp, nfelo, rbsdm, staleCbsWk9, staleEspnWk9] },
    sfScheduleWk10,
    { nowMs: Date.parse('2026-11-16T11:00:00Z'), currentWeek: 11 }
  );
  assert.equal(resolvedPreCutoffPromote.cohortStatus, 'latest_game_partial');
  assert.equal(resolvedPreCutoffPromote.consistentThroughWeek, 10);
  assert.equal(resolvedPreCutoffPromote.sources.length, 3);
  assert.equal(resolvedPreCutoffPromote.disregardedStaleCount, 2);

  // Case E: Compiled data/schedule-matchup.json verified accuracy & week-consistency audit
  const smCompiled = JSON.parse(fs.readFileSync(path.join(rootDir, 'data', 'schedule-matchup.json'), 'utf8'));
  const compiledPwr = smCompiled.powerRankings || {};
  assert.ok(Array.isArray(compiledPwr.sources) && compiledPwr.sources.length >= 3, 'Compiled powerRankings must have verified live sources');
  for (const s of compiledPwr.sources) {
    assert.equal(s.verified, true, `Compiled power ranking source ${s.outlet} must be verified`);
    assert.ok(Number.isInteger(s.rank) && s.rank >= 1 && s.rank <= 32, `Invalid rank for ${s.outlet}`);
    assert.equal(s.includesLatestGame, true, `Active power ranking source ${s.outlet} must include the latest completed game`);
  }
  const expectedAvg = compiledPwr.sources.reduce((sum, s) => sum + s.rank, 0) / compiledPwr.sources.length;
  assert.equal(
    compiledPwr.consensusRank,
    Math.round(expectedAvg),
    'Compiled consensusRank must equal exact rounded mean of active verified sources'
  );
});

test('Holistic Regression: Link-drop tweets in compiled data/news.json promote cleanly to direct Articles while preserving salient tweets', () => {
  const compiledNews = JSON.parse(fs.readFileSync(path.join(rootDir, 'data', 'news.json'), 'utf8'));
  const reconciled = reconcileLinkDropTweetsWithArticles(compiledNews.rawStream || []);

  // Zero remaining link-drop tweets should exist after reconciliation
  const unpromotedLinkDrops = reconciled.filter(it => isArticleLinkDropTweet(it).isLinkDrop);
  assert.equal(
    unpromotedLinkDrops.length,
    0,
    `Every eligible article link-drop tweet must be promoted (found ${unpromotedLinkDrops.length})`
  );

  // Zero brand "Read:" social cards linking to bsky.app when they have an article URL
  const lingeringReadBsky = reconciled.filter(
    it =>
      (it.type === 'tweet' || it.type === 'social') &&
      /bsky\.app\/profile\/49erswebzone/i.test(String(it.url || '')) &&
      Boolean(it.externalUrl)
  );
  assert.equal(lingeringReadBsky.length, 0, '49ers Webzone Bluesky link-drops must bypass bsky.app and become Articles');

  // Verify genuine salient beat tweets remain tweets
  const remainingTweets = reconciled.filter(it => it.type === 'tweet' || it.type === 'social');
  assert.ok(remainingTweets.length >= 20, `Salient beat tweets must remain tweets (found ${remainingTweets.length})`);
});

test('Holistic Regression: Compiled news.json has zero unbounded full-article summary dumps and rare expandable-summary rate (<5%)', () => {
  const compiledNews = JSON.parse(fs.readFileSync(path.join(rootDir, 'data', 'news.json'), 'utf8'));
  const stream = compiledNews.rawStream || [];

  const oversizedDirectStories = stream.filter(
    it => /\/nfl\/story\/_\/id\/\d+/i.test(String(it.url || '')) && String(it.summary || '').length > 360
  );
  assert.equal(
    oversizedDirectStories.length,
    0,
    `Direct ESPN /nfl/story/ articles must never dump full article bodies into summary: ${oversizedDirectStories.map(i => `${i.id}(${i.summary.length})`).join(', ')}`
  );

  const runawaySummaries = stream.filter(it => String(it.summary || '').length > WIRE_BLURB_SUMMARY_MAX_CHARS);
  assert.equal(
    runawaySummaries.length,
    0,
    `Zero wire items may exceed ${WIRE_BLURB_SUMMARY_MAX_CHARS}-char summary safety cap: ${runawaySummaries.map(i => `${i.id}(${i.summary.length})`).join(', ')}`
  );

  const nonTweetWithSummary = stream.filter(
    it => it.type !== 'tweet' && it.type !== 'social' && it.type !== 'video' && String(it.summary || '').trim().length > 0
  );
  const expandableCount = nonTweetWithSummary.filter(
    it => splitSummaryForExpandableDisplay(it.summary).isTruncated
  ).length;
  const expandableRatio = nonTweetWithSummary.length > 0 ? expandableCount / nonTweetWithSummary.length : 0;
  assert.ok(
    expandableRatio < 0.05,
    `Expandable summary button should appear infrequently (<5% of article summaries), got ${expandableCount}/${nonTweetWithSummary.length} (${(expandableRatio * 100).toFixed(1)}%)`
  );
});

await testAsync(
  'Holistic Regression: Legacy v1 practice cache self-heals poisoned Thursday LP, while live v2 cache + multi-day % delta chips persist cleanly',
  async () => {
    const { hydrateCachedWeeklyPracticeAndInactives, persistWeeklyPracticeSnapshot } = await import(
      '../src/services/dataService.js'
    );
    const memStore = new Map();
    const prevWin = globalThis.window;
    globalThis.window = {
      localStorage: {
        getItem: k => (memStore.has(k) ? memStore.get(k) : null),
        setItem: (k, v) => memStore.set(k, String(v)),
        removeItem: k => memStore.delete(k)
      }
    };
    try {
      // Seed poisoned legacy v1 cache containing bogus Evans thu='LP'
      memStore.set(
        'joshal_49ers_weekly_practice_v1',
        JSON.stringify({
          seasonYear: 2026,
          week: 11,
          oppAbbr: 'MIN',
          savedAtMs: Date.now(),
          sf: { mikeevans: { wed: 'DNP', thu: 'LP', fri: '-', injuryType: 'Achilles', gameStatus: 'Questionable' } },
          opp: {}
        })
      );

      const appMock = {
        meta: { seasonYear: 2026, currentWeek: 11 },
        roster: {
          players: [
            {
              id: '16737',
              name: 'Mike Evans',
              position: 'WR',
              rosterBucket: 'active',
              health: { wed: 'DNP', thu: '-', fri: '-', injuryType: 'Achilles', status: 'Questionable', isOnPracticeReport: true }
            }
          ]
        },
        health: {
          week: 11,
          practiceReport: [
            { playerId: '16737', name: 'Mike Evans', position: 'WR', wed: 'DNP', thu: '-', fri: '-', injuryType: 'Achilles', gameStatus: 'Questionable', playProbabilityPct: 28 }
          ]
        },
        scheduleMatchup: {
          upcomingMatchup: { week: 11, oppAbbr: 'MIN', kickoffIso: '2026-11-23T01:20:00Z', opponentHealth: { injuryReport: [] } },
          schedule: [{ week: 11, dateIso: '2026-11-23T01:20:00Z', completed: false }]
        }
      };

      hydrateCachedWeeklyPracticeAndInactives(appMock);
      assert.equal(memStore.has('joshal_49ers_weekly_practice_v1'), false, 'Legacy v1 practice cache must be purged automatically');
      assert.equal(appMock.roster.players[0].health.thu, '-', 'Poisoned v1 thu=LP must NOT restore onto Mike Evans');
      assert.equal(appMock.health.practiceReport[0].thu, '-', 'Poisoned v1 thu=LP must NOT restore onto practiceReport');

      // Now persist legitimate v2 snapshot and confirm v2 round-trip works
      appMock.health.practiceReport[0].thu = 'LP';
      appMock.roster.players[0].health.thu = 'LP';
      persistWeeklyPracticeSnapshot(appMock);
      assert.equal(memStore.has('joshal_49ers_weekly_practice_v2'), true, 'Legitimate snapshot must persist under v2 cache key');

      appMock.roster.players[0].health.thu = '-';
      appMock.health.practiceReport[0].thu = '-';
      hydrateCachedWeeklyPracticeAndInactives(appMock);
      assert.equal(appMock.roster.players[0].health.thu, 'LP', 'Legitimate v2 snapshot must restore cleanly on reload');
    } finally {
      globalThis.window = prevWin;
    }
  }
);

test(
  'iOS non-standalone Safari/Chrome tabs have zero artificial top header or Search-sheet whitespace while preserving standalone PWA clearance',
  () => {
    const css = fs.readFileSync(path.join(rootDir, 'src/styles.css'), 'utf8');

    // Extract every @supports (-webkit-touch-callout: none) { ... } block with balanced braces
    const blocks = [];
    const marker = '@supports (-webkit-touch-callout: none)';
    let idx = 0;
    while ((idx = css.indexOf(marker, idx)) !== -1) {
      const openIdx = css.indexOf('{', idx);
      assert.ok(openIdx !== -1, 'Expected opening brace for @supports (-webkit-touch-callout: none)');
      let depth = 0;
      let endIdx = openIdx;
      for (let i = openIdx; i < css.length; i++) {
        if (css[i] === '{') depth++;
        else if (css[i] === '}') {
          depth--;
          if (depth === 0) {
            endIdx = i;
            break;
          }
        }
      }
      blocks.push(css.slice(openIdx + 1, endIdx));
      idx = endIdx + 1;
    }

    assert.ok(blocks.length >= 2, `Expected at least 2 iOS @supports blocks (header + search sheet), found ${blocks.length}`);

    // Every rule inside @supports (-webkit-touch-callout: none) must be gated on display-mode: standalone
    // so normal iOS Safari & Chrome tabs never inherit hardcoded 48px/44px dead top whitespace.
    for (const block of blocks) {
      const stripped = block.replace(/\/\*[\s\S]*?\*\//g, '').trim();
      assert.equal(
        /^\.top-header\b/m.test(stripped),
        false,
        'Unscoped .top-header rule inside @supports (-webkit-touch-callout: none) injects dead top whitespace in iOS Safari/Chrome tabs'
      );
      assert.equal(
        /padding-top:\s*max\([^;]+,\s*(?:48|44)px\)/.test(stripped),
        false,
        'Non-standalone 48px/44px top padding floor must be removed so iOS Safari & Chrome stay flush'
      );
      const mediaHeaders = [...stripped.matchAll(/@media\s*([^{]+)\{/g)].map(m => m[1].trim());
      assert.ok(mediaHeaders.length >= 1, 'Expected @media rules inside @supports (-webkit-touch-callout: none)');
      for (const mq of mediaHeaders) {
        assert.ok(
          mq.includes('display-mode: standalone'),
          `Every iOS @supports @media rule must include display-mode: standalone; found: @media ${mq}`
        );
      }
    }

    // Verify standalone PWA clearance is preserved intact
    const allIosCss = blocks.join('\n');
    assert.ok(
      allIosCss.includes('padding-top: max(calc(env(safe-area-inset-top, 0px) + 28px), 84px);'),
      'Standalone Home Screen PWA .top-header clearance must remain intact'
    );
    assert.ok(
      allIosCss.includes('padding-top: max(calc(env(safe-area-inset-top, 0px) + 22px), 78px);'),
      'Standalone Home Screen PWA Search sheet clearance must remain intact'
    );

    // Verify base .top-header still uses compact safe-area-aware 8px top padding
    assert.ok(
      css.includes('padding: calc(env(safe-area-inset-top, 0px) + 8px) 14px 8px;'),
      'Base .top-header must preserve compact calc(env(safe-area-inset-top, 0px) + 8px) padding'
    );
  }
);

test(
  'No in-game/post-game/pre-game live wire notification banner exists in views/CSS, and SW + module cache-busters prevent stale banner replay',
  () => {
    const viewFiles = fs
      .readdirSync(path.join(rootDir, 'src/views'))
      .filter(f => f.endsWith('.js'))
      .map(f => ({ name: f, src: fs.readFileSync(path.join(rootDir, 'src/views', f), 'utf8') }));
    const css = fs.readFileSync(path.join(rootDir, 'src/styles.css'), 'utf8');
    const appSrc = fs.readFileSync(path.join(rootDir, 'src/app.js'), 'utf8');
    const homeSrc = fs.readFileSync(path.join(rootDir, 'src/views/homeView.js'), 'utf8');
    const swSrc = fs.readFileSync(path.join(rootDir, 'sw.js'), 'utf8');

    const forbiddenPatterns = [
      'gameday-above-brief-banner',
      'New updates above brief until postgame summary',
      'POST-GAME LIVE WIRE',
      'LIVE IN-GAME WIRE',
      'OVERTIME LIVE WIRE',
      'DELAYED KICKOFF • LIVE WIRE',
      'PRE-GAME INACTIVES & WARMUPS'
    ];
    for (const vf of viewFiles) {
      for (const pat of forbiddenPatterns) {
        assert.equal(
          vf.src.toLowerCase().includes(pat.toLowerCase()),
          false,
          `View src/views/${vf.name} must not render removed live-wire banner token: ${pat}`
        );
      }
    }
    assert.equal(
      css.includes('.gameday-above-brief-banner'),
      false,
      'Dead .gameday-above-brief-banner CSS must stay removed'
    );

    // Ensure app.js & homeView.js cache-bust updated homeView/newsView modules and SW registration
    const homeVerMatch = appSrc.match(/from\s+'\.\/views\/homeView\.js\?v=(\d+)'/);
    const newsVerAppMatch = appSrc.match(/from\s+'\.\/views\/newsView\.js\?v=(\d+)'/);
    const newsVerHomeMatch = homeSrc.match(/from\s+'\.\/newsView\.js\?v=(\d+)'/);
    const swRegVerMatch = appSrc.match(/\.register\('\.\/sw\.js\?v=(\d+)'/);
    assert.ok(homeVerMatch && Number(homeVerMatch[1]) >= 89, 'app.js must import cache-busted homeView.js?v>=89');
    assert.ok(newsVerAppMatch && Number(newsVerAppMatch[1]) >= 92, 'app.js must import cache-busted newsView.js?v>=92');
    assert.ok(
      newsVerHomeMatch && newsVerHomeMatch[1] === newsVerAppMatch[1],
      'homeView.js must import the same cache-busted newsView.js?v= specifier as app.js'
    );
    assert.ok(swRegVerMatch && Number(swRegVerMatch[1]) >= 110, 'app.js must register cache-busted sw.js?v>=110');
    assert.ok(
      appSrc.includes('pendingSwReload') && appSrc.includes("document.addEventListener('visibilitychange'"),
      'app.js must defer controllerchange reload cleanly and check SW updates on foreground resume'
    );

    // Ensure sw.js activate never carries forward stale .js/.css/.html code from prior caches
    assert.ok(
      swSrc.includes("!/^\\.\\/(?:data|assets)\\//.test(assetUrl)"),
      'sw.js activate carry-forward must skip .js/.css/.html application code'
    );
  }
);

console.log(`\nHolistic QA Regressions Summary: ${passed} passed, ${failed} failed.`);
if (failed > 0) {
  process.exit(1);
}
