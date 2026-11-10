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
  classifyIrAndReserveTimeline,
  collapseInitialDots,
  computePlayerPlayProbability,
  doesClauseMentionPlayer,
  evaluateCorroboratedNewsInjurySignal,
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
  normalizePositionalPeerGroup,
  resolveCareerTableSchema,
  resolveLeaderboardModalModel
} from '../src/engine/statsLeaderboardEngine.js';
import { hydrateLiveEspnOverlay, matchPlayersClient } from '../src/services/dataService.js';
import { buildClusteredNewsBriefs } from '../scripts/lib/seasonalContentBuilder.mjs';
import {
  isOffTopicLeagueFiller,
  isOpaqueShortenerUrl,
  isPaywalledOrBlockedUrl,
  isStaleSeasonHeadline,
  sanitizeExternalUrl
} from '../src/engine/linkIntegrity.js';
import {
  extractBeatAttributionFromText,
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
  assert.ok(lenoir && lenoir.playProbabilityPct <= 84, `Expected unpracticed injured Lenoir <=84% True GTD, got ${lenoir?.playProbabilityPct}%`);

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
    it => (it.type === 'tweet' || it.type === 'social') && /^(?:https?:\/\/)(?:www\.)?(?:x\.com|twitter\.com)\//i.test(it.url || '')
  );
  for (const tw of (newsJson.rawStream || []).filter(it => it.type === 'tweet' || it.type === 'social')) {
    const resolved = resolveOriginalTweetUrl(tw, directPosts);
    assert.ok(
      /\/status\/|from%3A|49ers\.com\/team\/transactions/i.test(resolved),
      `Tweet ${tw.id} (${tw.author}) lacked direct X status or from:<handle> query: ${resolved}`
    );
    assert.ok(
      !resolved.includes('bsky.app'),
      `Tweet ${tw.id} (${tw.author}) must not link to bsky.app: ${resolved}`
    );
    assert.ok(
      !String(tw.url || '').includes('bsky.app') && !String(tw.authorProfileUrl || '').includes('bsky.app'),
      `Tweet ${tw.id} in news.json still contains bsky.app URL: ${tw.url}`
    );
  }
  const legacyBskyResolved = resolveOriginalTweetUrl({
    type: 'tweet',
    url: 'https://bsky.app/profile/mattmaiocco.bsky.social/post/3mztosm6ikc2f',
    title: 'Rookie DL Gracen Halton fractured his ankle, 49ers coach Kyle Shanahan said.',
    fullText: 'Rookie DL Gracen Halton fractured his ankle, 49ers coach Kyle Shanahan said.',
    publishedAt: '2026-11-09T00:39:17.526Z'
  });
  assert.ok(
    legacyBskyResolved.startsWith('https://x.com/search?q=from%3AMaioccoNBCS') && legacyBskyResolved.includes('%22Halton%22'),
    `Legacy bsky.app tweet URL must resolve to X original tweet search: ${legacyBskyResolved}`
  );

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
    `Expected Deebo cautious True GTD (55–68%, not overcorrected to Probable), got ${deeboProb.probabilityPct}%`
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

console.log(`\nHolistic QA Regressions Summary: ${passed} passed, ${failed} failed.`);
if (failed > 0) {
  process.exit(1);
}
