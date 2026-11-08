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
  computePlayerPlayProbability,
  resolvePlacedBeforeWeekFromDate
} from '../src/engine/injuryProbabilityModel.js';
import { runPlayoffMonteCarlo } from '../src/engine/playoffMonteCarlo.js';
import { sortNewsWithBreakingPriority } from '../src/engine/breakingClassifier.js';
import { hydrateLiveEspnOverlay } from '../src/services/dataService.js';
import { buildClusteredNewsBriefs } from '../scripts/lib/seasonalContentBuilder.mjs';

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

console.log(`\nHolistic QA Regressions Summary: ${passed} passed, ${failed} failed.`);
if (failed > 0) {
  process.exit(1);
}
