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
  evaluateSeasonState,
  partitionCompletedTradesByWindow
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
  sortNewsWithBreakingPriority,
  isRedundantProfileSelfLink
} from '../src/engine/breakingClassifier.js';
import { getJargonEntry } from '../src/engine/jargonGlossary.js';
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
  isOffTopicLeagueFiller,
  isOpaqueShortenerUrl,
  isPaywalledOrBlockedUrl,
  isStaleSeasonHeadline,
  sanitizeExternalUrl
} from '../src/engine/linkIntegrity.js';
import {
  extractBeatAttributionFromText,
  isDirectSocialPostUrl,
  resolveItemAuthorProfileUrl,
  resolveOriginalTweetUrl,
  resolveReporterFromNameOrHandle,
  corroborateAndAnnotateWireStream
} from '../src/engine/beatAttributionEngine.js';
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

test('Season state machine supports 2027+ automatic calendar rollover, post-Week-18 mathematicallyEliminated transition, and clean headline labels', () => {
  assert.deepEqual(buildNflCalendarForSeasonYear(2026), DEFAULT_NFL_CALENDAR_2026);

  // October 2027 without passing custom calendar must activate 2027 IN_SEASON + TRADE_WINDOW
  const oct2027 = evaluateSeasonState({
    now: '2027-10-19T18:00:00Z',
    teamStatus: { currentWeek: 7, mathematicallyEliminated: false }
  });
  assert.ok(oct2027.activePhases.includes('IN_SEASON'), 'Oct 2027 must auto-activate IN_SEASON');
  assert.ok(oct2027.activePhases.includes('TRADE_WINDOW'), 'Oct 2027 must auto-activate TRADE_WINDOW');

  // Post-Week-18 mathematicallyEliminated=true without eliminatedAt must activate DRAFT_PREP immediately
  const janEliminated = evaluateSeasonState({
    now: '2027-01-15T18:00:00Z',
    teamStatus: { mathematicallyEliminated: true }
  });
  assert.equal(janEliminated.activePhases.includes('IN_SEASON'), false);
  assert.equal(janEliminated.activePhases.includes('DRAFT_PREP'), true, 'Must enter DRAFT_PREP immediately after Week 18 elimination');

  // Missing currentWeek in IN_SEASON must not leave dangling "In-Season • Week"
  const inSeasonNoWk = evaluateSeasonState({
    now: '2026-09-20T18:00:00Z',
    teamStatus: {}
  });
  assert.equal(inSeasonNoWk.headlinePhase.label, 'In-Season');

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
  assert.equal(teamFeed.length, 3);
  assert.equal(teamFeed[0].name, 'Renardo Green', 'Lowest play likelihood player (Green DNP) must appear first in Team Injury News');
  assert.ok(
    teamFeed[0].playProbabilityPct <= teamFeed[1].playProbabilityPct &&
      teamFeed[1].playProbabilityPct <= teamFeed[2].playProbabilityPct,
    `Team Injury News must sort lowest -> highest play likelihood: ${JSON.stringify(teamFeed.map(e => [e.name, e.playProbabilityPct]))}`
  );

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

console.log(`\nHolistic QA Regressions Summary: ${passed} passed, ${failed} failed.`);
if (failed > 0) {
  process.exit(1);
}
