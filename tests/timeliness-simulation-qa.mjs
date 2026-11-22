#!/usr/bin/env node
/**
 * End-to-End Timeliness, Weekly-Rhythm Ranking, Post-Game Health Rollover,
 * X/Highlight Video Facade, AI Dossier Recency & Race-Condition Simulation Suite
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  resolveGameNewsContext,
  classifyBreakingItem,
  sortNewsWithBreakingPriority,
  deduplicateAndGroupWireItems,
  balanceFeedTopSalience,
  scoreHighlightAndTeamVideoSalience,
  partitionBreakingNewsAboveBrief
} from '../src/engine/breakingClassifier.js';
import {
  resolveEarlyWeekRolloverInput
} from '../src/engine/gameDayRosterEngine.js';
import {
  rankPlayerInjuryNews,
  buildTeamInjuryNewsFeed,
  reconcileRosterAndHealthWithNews
} from '../src/engine/injuryProbabilityModel.js';
import {
  compileDeepResearchDossier
} from '../src/engine/deepResearchEngine.js';
import {
  getDailyNewsBriefCycleKey,
  selectTopNewsBriefSourceCandidates
} from '../src/services/aiWorkerClient.js';
import {
  hydrateLiveEspnOverlay,
  hydrateLiveWorkerEdgeWire,
  hydrateLiveMultiSourceBeatWire
} from '../src/services/dataService.js';
import {
  renderNewsViewHtml
} from '../src/views/newsView.js';
import {
  discoverBestFreeGeminiModel
} from '../scripts/lib/aiSynthesisEngine.mjs';
import workerModule from '../worker/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');

let passed = 0;
let failed = 0;

async function runSim(name, fn) {
  try {
    await fn();
    passed += 1;
    console.log(`  PASS  ${name}`);
  } catch (err) {
    failed += 1;
    console.error(`  FAIL  ${name}\n        ${err?.stack || err}`);
  }
}

console.log('\n=== Timeliness, Weekly-Rhythm & Race-Condition Simulation Suite ===');

// ---------------------------------------------------------------------------
// Scenario 1: Live In-Game (Sunday Q3) — X Injury, Native Video Highlight & Epoch Wall
// ---------------------------------------------------------------------------
await runSim('Scenario 1 [Live In-Game Q3]: X sideline injury & native highlight clips lead; pre-kickoff chatter demoted; inline MP4 facade renders', async () => {
  const koIso = '2026-11-15T21:25:00Z';
  const koMs = Date.parse(koIso);
  const inGameNow = koMs + 95 * 60_000;

  const appData = {
    meta: { seasonYear: 2026, currentWeek: 10, teamRecord: '6-2' },
    roster: {
      players: [
        { id: '4040605', name: 'Nick Bosa', position: 'DE', jersey: 97, rosterBucket: 'active' },
        { id: '3117251', name: 'Christian McCaffrey', position: 'RB', jersey: 23, rosterBucket: 'active' }
      ]
    },
    news: {
      dailyTopNewsBrief: {
        id: 'daily_brief_2026-11-14_17PT',
        cycleKey: '2026-11-14@17PT',
        generatedAt: '2026-11-15T01:05:00Z',
        source: 'pipeline-gemini-daily',
        headline: '49ers Finalize Dallas Prep',
        summary: 'San Francisco heads to Dallas.',
        bullets: ['Bosa ready.', 'CMC full go.'],
        sources: []
      },
      rawStream: []
    },
    scheduleMatchup: {
      schedule: [
        {
          id: '401873063',
          week: 10,
          dateIso: koIso,
          completed: false,
          statusState: 'in',
          statusDetail: '4:12 - 3rd Quarter',
          opponent: { abbr: 'DAL', name: 'Dallas Cowboys' }
        }
      ],
      upcomingMatchup: {
        week: 10,
        oppAbbr: 'DAL',
        oppName: 'Dallas Cowboys',
        dateIso: koIso,
        liveState: 'in',
        isGameInProgress: true
      }
    }
  };

  const items = [
    {
      id: 'friday_preview',
      type: 'article',
      title: '3 keys to how the 49ers can attack Dallas coverage shells',
      summary: 'Tactical preview.',
      url: 'https://www.nbcsportsbayarea.com/nfl/san-francisco-49ers/3-keys-cowboys/',
      outletName: 'NBC Sports Bay Area',
      author: 'Matt Maiocco',
      trustTier: 1,
      publishedAt: new Date(koMs - 26 * 3600_000).toISOString(),
      signalScore: 88
    },
    {
      id: 'x_td_clip',
      type: 'tweet',
      title: 'Brock Purdy scrambles and hits Christian McCaffrey for a 74-yard 49ers TD!',
      fullText: 'Brock Purdy scrambles and hits Christian McCaffrey for a 74-yard 49ers TD!',
      url: 'https://x.com/49ers/status/2122000000000000001',
      videoStreamUrl: 'https://video.twimg.com/ext_tw_video/21220001/pu/vid/1280x720/cmc_td.mp4',
      isHighlightClip: true,
      duration: '0:34',
      embeddable: true,
      imageUrl: 'https://pbs.twimg.com/ext_tw_video_thumb/21220001/pu/img/thumb.jpg',
      outletName: 'San Francisco 49ers',
      author: 'San Francisco 49ers',
      authorHandle: '@49ers',
      trustTier: 1,
      mentionedPlayers: [{ id: '3117251', name: 'Christian McCaffrey' }],
      publishedAt: new Date(inGameNow - 8 * 60_000).toISOString(),
      signalScore: 90
    },
    {
      id: 'x_bosa_tent',
      type: 'tweet',
      title: 'Nick Bosa headed to the blue medical tent on the 49ers sideline; questionable to return.',
      fullText: 'Nick Bosa headed to the blue medical tent on the 49ers sideline; questionable to return.',
      url: 'https://x.com/nwagoner/status/2122000000000000002',
      outletName: 'ESPN',
      author: 'Nick Wagoner',
      authorHandle: '@nwagoner',
      trustTier: 1,
      mentionedPlayers: [{ id: '4040605', name: 'Nick Bosa' }],
      publishedAt: new Date(inGameNow - 3 * 60_000).toISOString(),
      signalScore: 95
    },
    {
      id: 'jonnydel_film_prev_wk',
      type: 'video',
      videoId: 'jdelWk10',
      embeddable: true,
      duration: '18:20',
      title: '49ers Playbook: Week 10 All-22 Film Breakdown vs Cowboys',
      url: 'https://www.youtube.com/watch?v=jdelWk10',
      outletName: "Jonnydel's Football Academy",
      author: "Jonnydel's Football Academy",
      publishedAt: new Date(inGameNow - 20 * 60_000).toISOString(),
      signalScore: 92
    }
  ];

  const sorted = sortNewsWithBreakingPriority(items, inGameNow, { appData });
  assert.equal(sorted[0].id, 'x_bosa_tent', 'Live sideline injury X tweet must rank #1 in-game');
  assert.equal(sorted[1].id, 'x_td_clip', 'Live X TD clip tweet must rank #2 in-game');
  assert.equal(sorted[sorted.length - 1].id, 'friday_preview', 'Pre-kickoff preview must sink behind in-game updates');

  // Verify Highlights & Videos renders X MP4 highlight clip with inline <video> support and 0% overlap with Film & Trench
  const origNow = Date.now;
  Date.now = () => inGameNow;
  try {
    const videosHtml = renderNewsViewHtml({
      appData,
      newsCategoryFilter: 'videos',
      filteredRawItems: items,
      activeVideosSet: new Set(['raw_x_td_clip']),
      userPrefs: {}
    });
    const filmHtml = renderNewsViewHtml({
      appData,
      newsCategoryFilter: 'film',
      filteredRawItems: items,
      activeVideosSet: new Set(),
      userPrefs: {}
    });
    assert.ok(videosHtml.includes('<video src="https://video.twimg.com/ext_tw_video/21220001/pu/vid/1280x720/cmc_td.mp4"'), 'Native X MP4 highlight clip must play inline via <video>');
    assert.ok(!videosHtml.includes('jdelWk10'), 'Pure film clip must never leak into Highlights & Videos');
    assert.ok(filmHtml.includes('jdelWk10') && !filmHtml.includes('cmc_td.mp4'), '0% overlap between Highlights & Videos and Film & Trench');
  } finally {
    Date.now = origNow;
  }
});

// ---------------------------------------------------------------------------
// Scenario 2: Post-Game Final & 5 PM Recap — Decaying Breaking Floor, Epoch Wall & Brief Sources
// ---------------------------------------------------------------------------
await runSim('Scenario 2 [Immediate Post-Game & 5 PM Recap]: Post-game X pressers & recaps beat 5h-old pre-game roster moves; brief sources purge pre-game previews', async () => {
  const koIso = '2026-11-15T21:25:00Z'; // 1:25 PM PST
  const koMs = Date.parse(koIso);
  const postGame5PmMs = Date.parse('2026-11-16T01:15:00Z'); // 5:15 PM PST Sunday (~3.83h after kickoff, game Final!)

  const appData = {
    meta: { seasonYear: 2026, currentWeek: 11, teamRecord: '7-2' },
    roster: { players: [{ id: '3117251', name: 'Christian McCaffrey', position: 'RB', rosterBucket: 'active' }] },
    news: {
      rawStream: [
        {
          id: 'pregame_ps_elevation',
          type: 'tweet',
          title: '49ers roster move: Signed LB Garret Wallow to the active roster ahead of Dallas.',
          fullText: '49ers roster move: Signed LB Garret Wallow to the active roster ahead of Dallas.',
          url: 'https://x.com/49ers/status/2121900000000000001',
          outletName: '49ers.com Official',
          author: 'San Francisco 49ers Official',
          trustTier: 1,
          publishedAt: new Date(koMs - 90 * 60_000).toISOString(), // ~5.3h old (pre-kickoff!)
          signalScore: 92
        },
        {
          id: 'saturday_preview',
          type: 'article',
          title: 'Why 49ers run game faces tough test in Dallas',
          summary: 'Pre-game preview.',
          url: 'https://www.nbcsportsbayarea.com/nfl/san-francisco-49ers/run-game-dallas/',
          outletName: 'NBC Sports Bay Area',
          author: 'Matt Maiocco',
          trustTier: 1,
          publishedAt: new Date(koMs - 22 * 3600_000).toISOString(),
          signalScore: 86
        },
        {
          id: 'postgame_x_shanahan_1',
          type: 'tweet',
          title: 'Kyle Shanahan after 49ers 46-40 win over Cowboys: Christian McCaffrey and Deebo carried the offense in the 4th quarter.',
          fullText: 'Kyle Shanahan after 49ers 46-40 win over Cowboys: Christian McCaffrey and Deebo carried the offense in the 4th quarter.',
          url: 'https://x.com/nwagoner/status/2122100000000000011',
          outletName: 'ESPN',
          author: 'Nick Wagoner',
          trustTier: 1,
          publishedAt: new Date(postGame5PmMs - 12 * 60_000).toISOString(),
          signalScore: 88
        },
        {
          id: 'postgame_x_inj_clean',
          type: 'tweet',
          title: 'Shanahan said the 49ers escaped Sunday win in Dallas without any new serious injuries; MRI checks tomorrow morning.',
          fullText: 'Shanahan said the 49ers escaped Sunday win in Dallas without any new serious injuries; MRI checks tomorrow morning.',
          url: 'https://x.com/mattbarrows/status/2122100000000000012',
          outletName: 'The Athletic',
          author: 'Matt Barrows',
          trustTier: 1,
          publishedAt: new Date(postGame5PmMs - 10 * 60_000).toISOString(),
          signalScore: 92
        },
        {
          id: 'postgame_recap_espn',
          type: 'article',
          title: "McCaffrey's TDs of 74 and 66 yards help 49ers beat Cowboys 46-40",
          summary: 'San Francisco outlasted Dallas in a back-and-forth thriller.',
          url: 'https://www.espn.com/nfl/recap/_/gameId/401873063',
          outletName: 'ESPN',
          author: 'Nick Wagoner',
          trustTier: 1,
          publishedAt: new Date(postGame5PmMs - 18 * 60_000).toISOString(),
          signalScore: 90
        },
        {
          id: 'postgame_x_purdy',
          type: 'tweet',
          title: 'Brock Purdy finished with 318 total yards and 3 TDs in the 46-40 shootout victory over Dallas.',
          fullText: 'Brock Purdy finished with 318 total yards and 3 TDs in the 46-40 shootout victory over Dallas.',
          url: 'https://x.com/MaioccoNBCS/status/2122100000000000013',
          outletName: 'NBC Sports Bay Area',
          author: 'Matt Maiocco',
          trustTier: 1,
          publishedAt: new Date(postGame5PmMs - 15 * 60_000).toISOString(),
          signalScore: 86
        },
        {
          id: 'postgame_x_kawakami',
          type: 'tweet',
          title: 'Inside the 49ers locker room after beating the Cowboys 46-40: offense answered every score.',
          fullText: 'Inside the 49ers locker room after beating the Cowboys 46-40: offense answered every score.',
          url: 'https://x.com/timkawakami/status/2122100000000000014',
          outletName: 'The SF Standard',
          author: 'Tim Kawakami',
          trustTier: 2,
          publishedAt: new Date(postGame5PmMs - 8 * 60_000).toISOString(),
          signalScore: 82
        }
      ]
    },
    scheduleMatchup: {
      schedule: [
        {
          id: '401873063',
          week: 10,
          dateIso: koIso,
          completed: true,
          statusDetail: 'Final',
          sfScore: 46,
          oppScore: 40,
          opponent: { abbr: 'DAL', name: 'Dallas Cowboys' }
        },
        {
          id: '401873099',
          week: 11,
          dateIso: '2026-11-22T21:05:00Z',
          completed: false,
          statusDetail: 'Sun 1:05 PM',
          opponent: { abbr: 'SEA', name: 'Seattle Seahawks' }
        }
      ],
      upcomingMatchup: {
        week: 11,
        oppAbbr: 'SEA',
        oppName: 'Seattle Seahawks',
        dateIso: '2026-11-22T21:05:00Z'
      }
    }
  };

  const cycleKey = getDailyNewsBriefCycleKey(postGame5PmMs, appData);
  assert.match(cycleKey, /@postgame-wk10$/, `Expected post-game cycleKey at 5:15 PM PT Sunday, got ${cycleKey}`);

  const ranked = sortNewsWithBreakingPriority(appData.news.rawStream, postGame5PmMs, { appData });
  const pregameMoveIdx = ranked.findIndex(i => i.id === 'pregame_ps_elevation');
  const satPreviewIdx = ranked.findIndex(i => i.id === 'saturday_preview');
  assert.ok(pregameMoveIdx >= 4, `5.3h-old pre-kickoff roster move must sink below fresh post-game X reports (got idx ${pregameMoveIdx})`);
  assert.equal(satPreviewIdx, ranked.length - 1, 'Saturday pre-game preview must sink to bottom behind Kickoff Epoch Wall');

  const briefCandidates = selectTopNewsBriefSourceCandidates(appData, 14, postGame5PmMs);
  assert.ok(briefCandidates.length >= 5, 'Expected >=5 post-game brief source candidates');
  assert.ok(
    !briefCandidates.some(c => c.url.includes('run-game-dallas')),
    'Post-game brief source selector must purge pre-kickoff preview articles when >=5 post-game sources exist'
  );
});

// ---------------------------------------------------------------------------
// Scenario 3: Monday 9 AM Rollover — Renardo Green & Deommodore Lenoir Screenshot Regression!
// ---------------------------------------------------------------------------
await runSim('Scenario 3 [Monday 9 AM Post-Game Rollover]: Green & Lenoir (played cleanly Sunday) clear to 95% Full Go; 4d-old Wednesday practice blurbs purged; Evans & in-game injured starter retained accurately', async () => {
  const monday9AmMs = Date.parse('2026-11-16T17:05:00Z'); // Mon Nov 16, 9:05 AM PST
  const wk10KoIso = '2026-11-15T21:25:00Z';
  const wk11KoIso = '2026-11-22T21:05:00Z';

  const green4dBlurb =
    "Green injured his back in the second half of the 49ers' win over the Raiders in Week 9, and he finished that game with four tackles (two solo) and one interception. Per Barrows, head coach Kyle Shanahan indicated Monday that Green is considered day-to-day, so the third-year defensive back's practice participation over the next two days will determine whether he'll be available for Sunday's game against the Cowboys.";
  const lenoir4dBlurb =
    "Lenoir is considered day-to-day due to a foot injury that he picked up in Week 9 against the Raiders. He was an observer for Wednesday's session, and he'll have two more opportunities to practice in at least a limited capacity ahead of Sunday's tilt against the Cowboys.";

  const mockAppData = {
    meta: { seasonYear: 2026, updatedAt: '2026-11-13T05:21:30Z', _upstreamUpdatedAt: '2026-11-13T05:21:30Z', currentWeek: 10 },
    roster: {
      players: [
        {
          id: '4427325',
          name: 'Renardo Green',
          position: 'CB',
          jersey: 0,
          rosterBucket: 'active',
          primarySnapPct: 97,
          capHit2026: 1_800_000,
          health: {
            status: 'Questionable',
            injuryType: 'Back',
            wed: 'DNP',
            thu: 'DNP',
            fri: '-',
            isOnPracticeReport: true,
            shortComment: 'Green (back) did not practice Wednesday.',
            longComment: green4dBlurb,
            playProbabilityPct: 28,
            playBadgeLabel: '28% • Long Shot'
          },
          recentNews: [
            {
              id: 'espn_pwire_4427325_1',
              type: 'article',
              title: 'Green (back) did not practice Wednesday.',
              summary: green4dBlurb,
              author: 'Matt Barrows',
              outletName: 'ESPN Injury Wire',
              url: 'https://www.espn.com/nfl/player/_/id/4427325/renardo-green',
              publishedAt: '2026-11-11T22:15:00Z'
            }
          ]
        },
        {
          id: '4242488',
          name: 'Deommodore Lenoir',
          position: 'CB',
          jersey: 2,
          rosterBucket: 'active',
          experienceYears: 6,
          primarySnapPct: 98,
          capHit2026: 16_500_000,
          health: {
            status: 'Questionable',
            injuryType: 'Foot',
            wed: 'DNP',
            thu: 'DNP',
            fri: '-',
            isOnPracticeReport: true,
            shortComment: "Lenoir (foot) did not participate in Wednesday's practice.",
            longComment: lenoir4dBlurb,
            playProbabilityPct: 28,
            playBadgeLabel: '28% • Long Shot'
          },
          recentNews: [
            {
              id: 'espn_pwire_4242488_1',
              type: 'article',
              title: "Lenoir (foot) did not participate in Wednesday's practice.",
              summary: lenoir4dBlurb,
              author: 'Matt Barrows',
              outletName: 'ESPN Injury Wire',
              url: 'https://www.espn.com/nfl/player/_/id/4242488/deommodore-lenoir',
              publishedAt: '2026-11-11T22:20:00Z'
            }
          ]
        },
        {
          id: '16737',
          name: 'Mike Evans',
          position: 'WR',
          jersey: 13,
          rosterBucket: 'active',
          experienceYears: 13,
          primarySnapPct: 72,
          capHit2026: 12_000_000,
          health: {
            status: 'Out',
            injuryType: 'Achilles',
            wed: 'DNP',
            thu: 'DNP',
            fri: 'DNP',
            isOnPracticeReport: true,
            shortComment: 'Evans (Achilles) ruled out for Sunday against the Cowboys.',
            longComment: 'Evans continues to rehab his multi-week Achilles strain.',
            playProbabilityPct: 0,
            playBadgeLabel: '0% • Out'
          },
          recentNews: [
            {
              id: 'evans_stale_wk10',
              type: 'article',
              title: "Evans (Achilles) did not practice Wednesday ahead of Sunday's game against the Cowboys.",
              summary: 'Evans did not practice Wednesday.',
              author: 'Nick Wagoner',
              outletName: 'ESPN',
              url: 'https://www.espn.com/nfl/player/_/id/16737/mike-evans',
              publishedAt: '2026-11-11T22:30:00Z'
            }
          ]
        },
        {
          id: '4360001',
          name: 'Dominick Puni',
          position: 'OG',
          jersey: 77,
          rosterBucket: 'active',
          experienceYears: 3,
          primarySnapPct: 100,
          capHit2026: 1_200_000,
          health: {
            status: 'Questionable',
            injuryType: 'Knee',
            wed: 'LP',
            thu: 'LP',
            fri: 'FP',
            isOnPracticeReport: true,
            shortComment: 'Puni (knee) questionable.',
            longComment: 'Puni played Sunday.',
            playProbabilityPct: 82,
            playBadgeLabel: '82% • GTD'
          },
          recentNews: []
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
          id: 'puni_postgame_mri',
          type: 'tweet',
          title: "Kyle Shanahan said OG Dominick Puni aggravated his knee late in Sunday's game and is scheduled for an MRI Monday.",
          fullText: "Kyle Shanahan said OG Dominick Puni aggravated his knee late in Sunday's game and is scheduled for an MRI Monday.",
          url: 'https://x.com/nwagoner/status/2122150000000000099',
          author: 'Nick Wagoner',
          outletName: 'ESPN',
          trustTier: 1,
          publishedAt: '2026-11-16T01:30:00Z'
        }
      ],
      clusteredBriefs: []
    },
    scheduleMatchup: {
      schedule: [
        {
          id: '401873063',
          week: 10,
          seasonType: 'REG',
          dateIso: wk10KoIso,
          completed: false,
          opponent: { abbr: 'DAL', name: 'Dallas Cowboys' }
        },
        {
          id: '401873099',
          week: 11,
          seasonType: 'REG',
          dateIso: wk11KoIso,
          completed: false,
          opponent: { abbr: 'SEA', name: 'Seattle Seahawks' }
        }
      ],
      upcomingMatchup: {
        week: 10,
        oppAbbr: 'DAL',
        oppName: 'Dallas Cowboys',
        dateIso: wk10KoIso,
        kickoffIso: wk10KoIso
      }
    }
  };

  const origFetch = globalThis.fetch;
  const origDateNow = Date.now;
  Date.now = () => monday9AmMs;
  globalThis.fetch = async url => {
    const u = String(url);
    if (u.includes('/teams/sf/schedule')) {
      return {
        ok: true,
        json: async () => ({
          events: [
            {
              id: '401873063',
              date: wk10KoIso,
              seasonType: { type: 2 },
              week: { number: 10 },
              competitions: [
                {
                  status: { type: { completed: true, state: 'post', shortDetail: 'Final' } },
                  competitors: [
                    { team: { abbreviation: 'SF' }, score: { value: 46 } },
                    { team: { abbreviation: 'DAL', displayName: 'Dallas Cowboys' }, score: { value: 40 } }
                  ]
                }
              ]
            },
            {
              id: '401873099',
              date: wk11KoIso,
              seasonType: { type: 2 },
              week: { number: 11 },
              competitions: [
                {
                  status: { type: { completed: false, state: 'pre', shortDetail: 'Sun 1:05 PM' } },
                  competitors: [
                    { team: { abbreviation: 'SF' } },
                    { team: { abbreviation: 'SEA', displayName: 'Seattle Seahawks' } }
                  ]
                }
              ]
            }
          ]
        })
      };
    }
    if (u.includes('/competitors/25/roster')) {
      return {
        ok: true,
        json: async () => ({
          entries: [
            { playerId: 4427325, didNotPlay: false, starter: true }, // Renardo Green PLAYED
            { playerId: 4242488, didNotPlay: false, starter: true }, // Deommodore Lenoir PLAYED
            { playerId: 16737, didNotPlay: true, starter: false },   // Mike Evans DID NOT PLAY
            { playerId: 4360001, didNotPlay: false, starter: true }  // Dominick Puni PLAYED (but re-injured!)
          ]
        })
      };
    }
    if (u.includes('summary?event=401873063')) {
      return {
        ok: true,
        json: async () => ({
          article: {
            id: 'recap_401873063',
            headline: "McCaffrey's TDs help 49ers beat Cowboys 46-40",
            description: '49ers win shootout in Dallas.',
            published: '2026-11-16T00:55:34Z',
            links: { web: { href: 'https://www.espn.com/nfl/recap/_/gameId/401873063' } }
          },
          videos: [
            {
              id: 50496925,
              headline: '49ers outlast Cowboys in back-and-forth thriller',
              duration: 106,
              thumbnail: 'https://espnmedia-cdn.akamaized.net/espn/media/thumb.jpg',
              lastModified: '2026-11-16T01:22:37Z',
              links: {
                web: { href: 'https://www.espn.com/video/clip/_/id/50496925/49ers-outlast-cowboys' },
                source: { HD: { href: 'https://espnmedia-cdn.akamaized.net/espn/media/49ers_cowboys_hd.mp4' } }
              }
            },
            {
              id: 50494615,
              headline: 'Dak Prescott lets it fly to George Pickens for a Cowboys TD',
              duration: 24,
              thumbnail: 'https://espnmedia-cdn.akamaized.net/espn/media/cowboys_td.jpg',
              lastModified: '2026-11-16T00:47:42Z',
              links: {
                web: { href: 'https://www.espn.com/video/clip/_/id/50494615/cowboys-td' },
                source: { HD: { href: 'https://espnmedia-cdn.akamaized.net/espn/media/cowboys_td.mp4' } }
              }
            }
          ]
        })
      };
    }
    if (u.includes('/nfl/injuries')) {
      // Simulate ESPN Monday morning stale /injuries cache STILL listing Green & Lenoir from Week 10!
      return {
        ok: true,
        json: async () => ({
          injuries: [
            {
              id: '25',
              displayName: 'San Francisco 49ers',
              injuries: [
                {
                  athlete: { displayName: 'Renardo Green' },
                  status: 'Questionable',
                  details: { type: 'Back' },
                  shortComment: 'Green (back) did not practice Wednesday.',
                  longComment: green4dBlurb
                },
                {
                  athlete: { displayName: 'Deommodore Lenoir' },
                  status: 'Questionable',
                  details: { type: 'Foot' },
                  shortComment: "Lenoir (foot) did not participate in Wednesday's practice.",
                  longComment: lenoir4dBlurb
                },
                {
                  athlete: { displayName: 'Mike Evans' },
                  status: 'Out',
                  details: { type: 'Achilles' },
                  shortComment: 'Evans (Achilles) missed Sunday against Dallas.',
                  longComment: 'Evans remains sidelined with a multi-week Achilles injury.'
                },
                {
                  athlete: { displayName: 'Dominick Puni' },
                  status: 'Questionable',
                  details: { type: 'Knee' },
                  shortComment: 'Puni (knee) questionable.',
                  longComment: 'Puni played Sunday.'
                }
              ]
            }
          ]
        })
      };
    }
    return { ok: false, json: async () => null };
  };

  try {
    await hydrateLiveEspnOverlay(mockAppData);
    reconcileRosterAndHealthWithNews(mockAppData, { nowMs: monday9AmMs });

    const prNames = mockAppData.health.practiceReport.map(p => p.name);
    assert.ok(!prNames.includes('Renardo Green'), `Renardo Green played cleanly Sunday and MUST clear off Monday Injury Report (got ${JSON.stringify(prNames)})`);
    assert.ok(!prNames.includes('Deommodore Lenoir'), `Deommodore Lenoir played cleanly Sunday and MUST clear off Monday Injury Report (got ${JSON.stringify(prNames)})`);
    assert.ok(prNames.includes('Mike Evans'), 'Mike Evans (didNotPlay=true) must remain on early-week Week 11 Injury Report');
    assert.ok(prNames.includes('Dominick Puni'), 'Dominick Puni (played + post-kickoff MRI report) must remain on early-week Week 11 Injury Report');

    const greenRoster = mockAppData.roster.players.find(p => p.name === 'Renardo Green');
    const lenoirRoster = mockAppData.roster.players.find(p => p.name === 'Deommodore Lenoir');
    assert.equal(greenRoster.health.playBadgeLabel, '95% • Full Go', 'Roster health badge for Green must reset to 95% • Full Go');
    assert.equal(lenoirRoster.health.playBadgeLabel, '95% • Full Go', 'Roster health badge for Lenoir must reset to 95% • Full Go');

    const teamInjFeed = buildTeamInjuryNewsFeed(mockAppData, { nowMs: monday9AmMs });
    const feedTextDump = JSON.stringify(teamInjFeed);
    assert.ok(!feedTextDump.includes('did not practice Wednesday'), 'Zero 4d-old pre-Cowboys Wednesday practice blurbs may appear in Monday Injury News');
    assert.ok(!feedTextDump.includes("ahead of Sunday's tilt against the Cowboys"), 'Zero completed-game Cowboys availability blurbs may appear in Monday Injury News');
    const puniEntry = teamInjFeed.find(e => e.name === 'Dominick Puni');
    assert.equal(puniEntry?.topItem?.id, 'puni_postgame_mri', 'Post-game MRI X tweet must lead Puni injury card');

    // Verify ESPN HD MP4 49ers highlight was ingested while Cowboys TD celebration clip was rejected!
    assert.ok(mockAppData.news.rawStream.some(v => v.videoStreamUrl?.includes('49ers_cowboys_hd.mp4')), '49ers HD MP4 game recap video must be ingested');
    assert.ok(!mockAppData.news.rawStream.some(v => v.videoStreamUrl?.includes('cowboys_td.mp4')), 'Opponent Cowboys TD clip must be excluded');

    // Verify _upstreamUpdatedAt was preserved even though meta.updatedAt updated!
    assert.equal(mockAppData.meta._upstreamUpdatedAt, '2026-11-13T05:21:30Z', '_upstreamUpdatedAt must remain untouched by client overlay');
  } finally {
    globalThis.fetch = origFetch;
    Date.now = origDateNow;
  }
});

// ---------------------------------------------------------------------------
// Scenario 4: Injury News Recency Curve (5.5h Half-Life)
// ---------------------------------------------------------------------------
await runSim('Scenario 4 [Injury News 5.5h Half-Life]: Fresh 20m X MRI/status update beats 22h-old rehab color blurb while same-hour rehab color beats bare DNP list', async () => {
  const nowMs = Date.parse('2026-11-18T23:00:00Z');
  const bosa = { id: '4040605', name: 'Nick Bosa', position: 'DE', health: { status: 'Questionable', injuryType: 'Hip', wed: 'LP' } };
  const stream = [
    {
      id: 'yesterday_rehab_color',
      type: 'tweet',
      title: 'Nick Bosa was working on a side field with trainers running agility cords and resisted sprints.',
      fullText: 'Nick Bosa was working on a side field with trainers running agility cords and resisted sprints.',
      url: 'https://x.com/mattbarrows/status/2122000000000000101',
      author: 'Matt Barrows',
      trustTier: 1,
      publishedAt: new Date(nowMs - 22 * 3600_000).toISOString()
    },
    {
      id: 'fresh_20m_update',
      type: 'tweet',
      title: 'Kyle Shanahan said Nick Bosa (hip) looked strong today and is trending up for Sunday.',
      fullText: 'Kyle Shanahan said Nick Bosa (hip) looked strong today and is trending up for Sunday.',
      url: 'https://x.com/nwagoner/status/2122000000000000102',
      author: 'Nick Wagoner',
      trustTier: 1,
      publishedAt: new Date(nowMs - 20 * 60_000).toISOString()
    }
  ];
  const ranked = rankPlayerInjuryNews(bosa, { rawStream: stream, nowMs });
  assert.equal(ranked[0].id, 'fresh_20m_update', '20m-old coaching update must outrank 22h-old rehab color paragraph');
});

// ---------------------------------------------------------------------------
// Scenario 5: Mid-Week (Wednesday 2:30 PM PT) Film & Trench Rhythm
// ---------------------------------------------------------------------------
await runSim('Scenario 5 [Mid-Week Tue–Fri Film Rhythm]: Jonnydel / QB School All-22 breakdowns outrank routine mid-week chatter & Sunday leftovers', async () => {
  const wed230PmMs = Date.parse('2026-11-18T22:30:00Z');
  const appData = {
    scheduleMatchup: {
      schedule: [
        { id: 'g10', week: 10, dateIso: '2026-11-15T21:25:00Z', completed: true, opponent: { abbr: 'DAL', name: 'Dallas Cowboys' } },
        { id: 'g11', week: 11, dateIso: '2026-11-22T21:05:00Z', completed: false, opponent: { abbr: 'SEA', name: 'Seattle Seahawks' } }
      ],
      upcomingMatchup: { week: 11, oppAbbr: 'SEA', oppName: 'Seattle Seahawks', dateIso: '2026-11-22T21:05:00Z' }
    }
  };
  const ctx = resolveGameNewsContext(appData, wed230PmMs);
  assert.equal(ctx.midWeekFilmWindow, true, 'Wednesday afternoon must activate midWeekFilmWindow');

  const sorted = sortNewsWithBreakingPriority(
    [
      {
        id: 'routine_locker_quote',
        type: 'article',
        title: '49ers notebook: Seattle travel schedule set for Week 11',
        url: 'https://www.49erswebzone.com/articles/199001-notebook/',
        outletName: '49ers Webzone',
        trustTier: 2,
        publishedAt: new Date(wed230PmMs - 35 * 60_000).toISOString(),
        signalScore: 68
      },
      {
        id: 'jonnydel_all22',
        type: 'video',
        videoId: 'jdelAll22Dal',
        embeddable: true,
        title: '49ers Playbook: Brock Purdy & Shanahan All-22 Film Breakdown vs Dallas',
        url: 'https://www.youtube.com/watch?v=jdelAll22Dal',
        outletName: "Jonnydel's Football Academy",
        author: "Jonnydel's Football Academy",
        trustTier: 1,
        publishedAt: new Date(wed230PmMs - 55 * 60_000).toISOString(),
        signalScore: 94
      }
    ],
    wed230PmMs,
    { appData }
  );
  assert.equal(sorted[0].id, 'jonnydel_all22', 'All-22 Film & Trench breakdown must beat routine mid-week notebook during Tue–Fri film window');
});

// ---------------------------------------------------------------------------
// Scenario 6: AI Deep Research & Auto Podcast Dossier Recency
// ---------------------------------------------------------------------------
await runSim('Scenario 6 [AI Dossier Recency]: compileDeepResearchDossier ranks 25m-old X beat update #1 over 5d-old keyword-dense article and purges completed-game availability noise', async () => {
  const nowMs = Date.now();
  const wk10KoMs = nowMs - 18 * 3600_000;
  const appData = {
    meta: { seasonYear: 2026, currentWeek: 11, teamRecord: '7-2' },
    roster: {
      players: [
        { id: '3126486', name: 'Deebo Samuel Sr.', position: 'WR', jersey: 19, rosterBucket: 'active', primarySnapPct: 74, health: { status: 'Active', playBadgeLabel: '95% • Full Go' } },
        { id: '4430807', name: 'Ricky Pearsall', position: 'WR', jersey: 14, rosterBucket: 'active', primarySnapPct: 68, health: { status: 'Active', playBadgeLabel: '95% • Full Go' } }
      ]
    },
    news: {
      rawStream: [
        {
          id: 'five_day_old_wr_art',
          type: 'article',
          title: '49ers wide receivers Deebo Samuel and Ricky Pearsall route tree analysis',
          summary: 'Wide receivers breakdown.',
          url: 'https://www.ninersnation.com/2026/11/11/wr-routes',
          author: 'Niners Nation',
          publishedAt: new Date(nowMs - 5 * 86_400_000).toISOString(),
          signalScore: 84
        },
        {
          id: 'stale_pregame_wr_avail',
          type: 'tweet',
          title: 'Deebo Samuel is officially active today against the Cowboys.',
          fullText: 'Deebo Samuel is officially active today against the Cowboys.',
          url: 'https://x.com/MaioccoNBCS/status/2121999999999999999',
          author: 'Matt Maiocco',
          publishedAt: new Date(wk10KoMs - 60 * 60_000).toISOString(),
          signalScore: 90
        },
        {
          id: 'fresh_25m_deebo_x',
          type: 'tweet',
          title: 'Shanahan praised Deebo Samuel explosive 70-yard YAC touchdown and clean post-game health check.',
          fullText: 'Shanahan praised Deebo Samuel explosive 70-yard YAC touchdown and clean post-game health check.',
          url: 'https://x.com/nwagoner/status/2122200000000000555',
          author: 'Nick Wagoner',
          trustTier: 1,
          publishedAt: new Date(nowMs - 25 * 60_000).toISOString(),
          signalScore: 88
        }
      ]
    },
    scheduleMatchup: {
      schedule: [
        { id: '401873063', week: 10, dateIso: new Date(wk10KoMs).toISOString(), completed: true, opponent: { abbr: 'DAL', name: 'Dallas Cowboys' } },
        { id: '401873099', week: 11, dateIso: new Date(nowMs + 5 * 86_400_000).toISOString(), completed: false, opponent: { abbr: 'SEA', name: 'Seattle Seahawks' } }
      ],
      upcomingMatchup: { week: 11, oppAbbr: 'SEA', oppName: 'Seattle Seahawks' }
    }
  };

  const dossier = compileDeepResearchDossier({ query: 'Wide receivers Deebo Samuel Pearsall', appData });
  assert.equal(dossier.matchedNews[0]?.id, 'fresh_25m_deebo_x', '25m-old X report must rank #1 in AI dossier over 5d-old keyword-heavy article');
  assert.ok(!dossier.matchedNews.some(n => n.id === 'stale_pregame_wr_avail'), 'Completed-game availability tweet must be purged from AI dossier');
  assert.match(dossier.dossierSummaryText, /\(\d+m ago\)/, 'Dossier summary must annotate relative age on matched news');
});

// ---------------------------------------------------------------------------
// Scenario 7: Edge Worker `/api/live-wire` + Atomic Multi-Source Race Dedup
// ---------------------------------------------------------------------------
await runSim('Scenario 7 [Worker /api/live-wire & Atomic Wire Dedup]: Worker hydrates RSS + YouTube Atom + X syn.video MP4s; client merges atomically with 0 duplicates', async () => {
  const origFetch = globalThis.fetch;
  const mockKv = new Map();
  const env = {
    ALLOWED_ORIGIN: 'https://49ers.joshal.com',
    SHARED_CACHE: {
      get: async k => (mockKv.has(k) ? JSON.parse(mockKv.get(k)) : null),
      put: async (k, v) => mockKv.set(k, v)
    }
  };

  globalThis.fetch = async url => {
    const u = String(url);
    if (u.includes('nbcsportsbayarea.com')) {
      return {
        ok: true,
        text: async () => `
          <rss><channel><item>
            <title>49ers beat Cowboys 46-40 behind McCaffrey</title>
            <description>Check https://x.com/49ers/status/1857900000000000123 for the TD clip.</description>
            <link>https://www.nbcsportsbayarea.com/nfl/san-francisco-49ers/recap-46-40/</link>
            <pubDate>${new Date().toUTCString()}</pubDate>
          </item></channel></rss>`
      };
    }
    if (u.includes('youtube.com/feeds/videos.xml?channel_id=UCt1LfHRE5eGiacPVtiaC10w')) {
      return {
        ok: true,
        text: async () => `
          <feed>
            <entry>
              <yt:videoId>jdelEdgeTest1</yt:videoId>
              <title>49ers Playbook: Brock Purdy All-22 vs Dallas</title>
              <published>${new Date().toISOString()}</published>
            </entry>
          </feed>`
      };
    }
    if (u.includes('cdn.syndication.twimg.com/tweet-result?id=1857900000000000123')) {
      return {
        ok: true,
        json: async () => ({
          text: 'CMC 74-yard touchdown in Dallas! #49ers',
          user: { screen_name: '49ers', name: 'San Francisco 49ers' },
          video: {
            poster: 'https://pbs.twimg.com/ext_tw_video_thumb/123/img/poster.jpg',
            durationMs: 28000,
            variants: [
              { type: 'video/mp4', bitrate: 832000, src: 'https://video.twimg.com/ext_tw_video/123/vid/720p.mp4' },
              { type: 'video/mp4', bitrate: 2176000, src: 'https://video.twimg.com/ext_tw_video/123/vid/1080p.mp4' }
            ]
          }
        })
      };
    }
    return { ok: true, text: async () => '<rss></rss>', json: async () => ({}) };
  };

  let edgePayload = null;
  try {
    const req = new Request('https://49ers-worker.example.workers.dev/api/live-wire', {
      method: 'GET',
      headers: { Origin: 'https://49ers.joshal.com' }
    });
    const res = await workerModule.fetch(req, env);
    assert.equal(res.status, 200);
    edgePayload = await res.json();
    assert.ok(edgePayload.items.some(i => i.type === 'article' && i.outletId === 'nbcsba'), 'Worker /api/live-wire must return RSS articles');
    assert.ok(edgePayload.items.some(i => i.type === 'video' && i.videoId === 'jdelEdgeTest1' && i.embeddable === true), 'Worker /api/live-wire must return YouTube Atom film clips');
    const xClip = edgePayload.items.find(i => i.id === 'x_edge_1857900000000000123');
    assert.ok(xClip && xClip.videoStreamUrl?.includes('1080p.mp4') && xClip.isHighlightClip === true, 'Worker /api/live-wire must hydrate highest-bitrate X syn.video MP4');

    // Now test client hydrateLiveWorkerEdgeWire + atomic duplicate guard when identical text arrives concurrently
    globalThis.fetch = async u => {
      if (String(u).includes('/api/live-wire')) {
        return { ok: true, json: async () => edgePayload };
      }
      return { ok: false, text: async () => '', json: async () => ({}) };
    };
    const clientData = {
      roster: { players: [{ id: '3117251', name: 'Christian McCaffrey', position: 'RB', rosterBucket: 'active' }] },
      news: {
        rawStream: [
          // Pre-existing duplicate copy to verify atomic dedup
          {
            id: 'dup_copy_1',
            type: 'article',
            title: '49ers beat Cowboys 46-40 behind McCaffrey',
            url: 'https://www.nbcsportsbayarea.com/nfl/san-francisco-49ers/recap-46-40/',
            outletName: 'NBC Sports Bay Area',
            publishedAt: new Date().toISOString()
          }
        ]
      },
      scheduleMatchup: { schedule: [], upcomingMatchup: {} },
      health: { practiceReport: [], irAndReserveTracker: [] }
    };
    await hydrateLiveMultiSourceBeatWire(clientData, {
      isGameLive: true,
      workerBaseUrl: 'https://49ers-worker.example.workers.dev'
    });
    const nbcsMatches = clientData.news.rawStream.filter(i => i.url === 'https://www.nbcsportsbayarea.com/nfl/san-francisco-49ers/recap-46-40/');
    assert.equal(nbcsMatches.length, 1, 'Atomic stream dedup must prevent duplicate URL entries across parallel wire sources');
    assert.ok(clientData.news.rawStream.some(i => i.videoId === 'jdelEdgeTest1'), 'Client wire must ingest Worker YouTube Atom video');
    assert.ok(clientData.news.rawStream.some(i => i.videoStreamUrl?.includes('1080p.mp4')), 'Client wire must ingest Worker X MP4 highlight clip');
  } finally {
    globalThis.fetch = origFetch;
  }
});

// ---------------------------------------------------------------------------
// Scenario 8: Gemini Token Conservation Audit (Hydrogen Preserved vs 3.8 Flash)
// ---------------------------------------------------------------------------
await runSim('Scenario 8 [Gemini Token Tiering]: discoverBestFreeGeminiModel uses 0 generateContent tokens by default; pipeline routes capNote to gemini-3.8-flash while preserving gemini-4-hydrogen for briefs & pods', async () => {
  const origFetch = globalThis.fetch;
  let generateContentCalls = 0;
  globalThis.fetch = async url => {
    if (String(url).includes(':generateContent')) {
      generateContentCalls += 1;
      return { ok: true, json: async () => ({}) };
    }
    return {
      ok: true,
      json: async () => ({
        models: [
          { name: 'models/gemini-4-hydrogen', supportedGenerationMethods: ['generateContent'] },
          { name: 'models/gemini-3.8-flash', supportedGenerationMethods: ['generateContent'] }
        ]
      })
    };
  };
  try {
    const disc = await discoverBestFreeGeminiModel('fake-test-key');
    assert.equal(disc.activeModel, 'gemini-4-hydrogen');
    assert.equal(generateContentCalls, 0, 'Default model discovery must spend 0 generateContent tokens');
  } finally {
    globalThis.fetch = origFetch;
  }

  const pipelineSrc = fs.readFileSync(path.join(rootDir, 'scripts', 'fetch-live-49ers-data.mjs'), 'utf8');
  assert.ok(
    pipelineSrc.includes("preferredModel: 'gemini-3.8-flash'"),
    'Pipeline must route simpler capPurchasingPowerNote task to gemini-3.8-flash'
  );
  assert.ok(
    pipelineSrc.includes("preferredModel: aiModelDiscovery.activeModel || 'gemini-4-hydrogen'"),
    'Pipeline must preserve gemini-4-hydrogen for flagship Top News Brief'
  );
});

// ---------------------------------------------------------------------------
// Scenario 9: Opposing-Player Injury Anti-Hijack (#Cowboys G Tyler Booker)
// ---------------------------------------------------------------------------
await runSim('Scenario 9 [Opposing-Player Injury Guard]: Completed-opponent injury (#Cowboys G Tyler Booker ... in loss to 49ers) never hijacks #1 or wears 49ers INJURY UPDATE badge, while bilateral 49ers trades still rank #1', async () => {
  const nowMs = Date.parse('2026-11-16T18:00:00Z');
  const appData = {
    scheduleMatchup: {
      schedule: [
        {
          id: '401873063',
          week: 10,
          dateIso: '2026-11-15T21:25:00Z',
          completed: true,
          statusDetail: 'Final',
          opponent: { abbr: 'DAL', name: 'Dallas Cowboys' }
        },
        {
          id: '401873099',
          week: 11,
          dateIso: '2026-11-22T21:05:00Z',
          completed: false,
          statusDetail: 'Sun 1:05 PM',
          opponent: { abbr: 'MIN', name: 'Minnesota Vikings' }
        }
      ],
      upcomingMatchup: {
        week: 11,
        oppAbbr: 'MIN',
        oppName: 'Minnesota Vikings',
        dateIso: '2026-11-22T21:05:00Z'
      }
    }
  };
  const cowboysInjuryTweet = {
    id: 'tw_booker_dal',
    type: 'tweet',
    title: "#Cowboys G Tyler Booker suffered a high-ankle sprain in his team's loss to the #49ers, source said. He'll undergo an MRI Monday.",
    fullText: "#Cowboys G Tyler Booker suffered a high-ankle sprain in his team's loss to the #49ers, source said. He'll undergo an MRI Monday.",
    author: 'Ian Rapoport',
    authorHandle: '@RapSheet',
    trustTier: 1,
    mentionedPlayers: [],
    url: 'https://x.com/RapSheet/status/2000009991',
    publishedAt: '2026-11-16T16:30:00Z'
  };
  const sfShanahanTweet = {
    id: 'tw_shanahan_mon',
    type: 'tweet',
    title: 'Kyle Shanahan on Victory Monday: Brock Purdy and Christian McCaffrey came out of the 46-40 win in Dallas clean.',
    fullText: 'Kyle Shanahan on Victory Monday: Brock Purdy and Christian McCaffrey came out of the 46-40 win in Dallas clean.',
    author: 'Matt Barrows',
    authorHandle: '@mattbarrows',
    trustTier: 1,
    mentionedPlayers: [{ name: 'Brock Purdy' }, { name: 'Christian McCaffrey' }],
    url: 'https://x.com/mattbarrows/status/2000009992',
    publishedAt: '2026-11-16T17:15:00Z'
  };
  const bilateralTradeTweet = {
    id: 'tw_colts_sf_trade',
    type: 'tweet',
    title: 'Trade! The Colts are sending WR Keenan Allen to the #49ers for a conditional late-round pick, per sources.',
    fullText: 'Trade! The Colts are sending WR Keenan Allen to the #49ers for a conditional late-round pick, per sources.',
    author: 'Ian Rapoport',
    authorHandle: '@RapSheet',
    trustTier: 1,
    mentionedPlayers: [],
    url: 'https://x.com/RapSheet/status/2000009993',
    publishedAt: '2026-11-16T17:30:00Z'
  };

  const bookerClass = classifyBreakingItem(cowboysInjuryTweet, nowMs, { appData });
  assert.notEqual(bookerClass.storyTier, 'post_game_injury', 'Completed-opponent injury must not classify as 49ers post_game_injury');
  assert.equal(bookerClass.breakingBadge, null, 'Completed-opponent injury must not wear INJURY UPDATE badge');

  const tradeClass = classifyBreakingItem(bilateralTradeTweet, nowMs, { appData });
  assert.equal(tradeClass.storyTier, 'tier1_major', 'Bilateral trade sending player to 49ers must still classify as tier1_major');

  const ranked = sortNewsWithBreakingPriority([cowboysInjuryTweet, sfShanahanTweet, bilateralTradeTweet], nowMs, { appData });
  assert.equal(ranked[0].id, 'tw_colts_sf_trade', 'Bilateral 49ers trade ranks #1');
  assert.equal(ranked[1].id, 'tw_shanahan_mon', '49ers post-game presser tweet outranks Cowboys player injury');
  assert.equal(ranked[2].id, 'tw_booker_dal', 'Completed-opponent player injury sinks below 49ers news');
});

// ---------------------------------------------------------------------------
// Scenario 10: Adversarial P0 Race & Rollover Guards (Live->Final Snapshot Clobber + ESPN-Only Sunday Injury)
// ---------------------------------------------------------------------------
await runSim('Scenario 10 [P0 Race & Rollover Guards]: Live->Final transition never clobbers cleared starters back onto practiceReport; real Sunday injury in ESPN blurb ("questionable for Sunday") is preserved', async () => {
  // 10A: Player played Sunday AND suffered a real injury reported ONLY in ESPN Monday blurb ("questionable for Sunday's game")
  const realSundayInjRoll = resolveEarlyWeekRolloverInput({
    rawStatus: 'Questionable',
    injuryType: 'Shoulder',
    shortComment: "Purdy suffered a right shoulder sprain in Sunday's win and is questionable for Sunday's game against Minnesota.",
    longComment: "Purdy injured his throwing shoulder in the fourth quarter Sunday, and his practice participation will determine whether he'll be available for Sunday's tilt.",
    upcomingWeek: 11,
    lastCompletedWeek: 10,
    playedInCompletedGame: true,
    hasPostKickoffInjurySignal: false
  });
  assert.equal(realSundayInjRoll.skip, false, 'Real Sunday injury reported in ESPN Monday blurb must NOT be wiped by forward-looking "questionable for Sunday" phrasing');

  // 10A-2: Pre-game active clearance blurb ("Greenlaw (knee) is active for Sunday's game against Dallas... injured his knee during Thursday's practice") MUST clear when player played cleanly!
  const greenlawActiveBlurbRoll = resolveEarlyWeekRolloverInput({
    rawStatus: 'Questionable',
    injuryType: 'Knee',
    shortComment: "Greenlaw (knee) is active for Sunday's game against Dallas.",
    longComment: "Greenlaw injured his knee during Thursday's practice session and was deemed questionable for Week 10, but the veteran linebacker has been cleared by medical staff to play in Sunday's contest.",
    upcomingWeek: 11,
    lastCompletedWeek: 10,
    playedInCompletedGame: true,
    hasPostKickoffInjurySignal: false
  });
  assert.equal(greenlawActiveBlurbRoll.skip, true, 'Pre-game active clearance blurb with Thursday practice injury must clear after playing cleanly Sunday');

  // 10B: Bye-week rollover (`lastCompletedWeek: 7`, `upcomingWeek: 9` after Week 8 Bye): Week 7 acute injury preserved, Week 6 historical origin stripped!
  const postByeRoll = resolveEarlyWeekRolloverInput({
    rawStatus: 'Questionable',
    injuryType: 'Ankle',
    shortComment: 'Green sustained an ankle sprain in Week 7.',
    longComment: 'Green sustained an ankle sprain in Week 7 before the Week 8 bye.',
    upcomingWeek: 9,
    lastCompletedWeek: 7,
    playedInCompletedGame: true,
    hasPostKickoffInjurySignal: false
  });
  assert.equal(postByeRoll.skip, false, 'Injury sustained in actual last completed game before a Bye week must be preserved');

  // 10C: Live->Final transition where `hydrateLiveEspnOverlay` already rolled `health.week` from 10 -> 11 and cleared Renardo Green:
  //      Subsequent `hydrateLiveGameDayRosters` must NOT restore `_preGamePracticeReport` or `_preGameHealthSnapshot`!
  const { hydrateLiveGameDayRosters } = await import('../src/services/dataService.js');
  const postWhistleMs = Date.parse('2026-11-16T01:15:00Z');
  const liveToFinalData = {
    meta: { seasonYear: 2026, currentWeek: 11 },
    _livePlayedPlayerIds: ['4427325'],
    roster: {
      players: [
        {
          id: '4427325',
          name: 'Renardo Green',
          position: 'CB',
          rosterBucket: 'active',
          _preGameHealthSnapshot: {
            status: 'Questionable',
            injuryType: 'Back',
            isOnPracticeReport: true,
            playProbabilityPct: 28,
            playBadgeLabel: '28% • Long Shot'
          },
          health: {
            status: 'Active',
            injuryType: '',
            isOnPracticeReport: false,
            playProbabilityPct: 95,
            playBadgeLabel: '95% • Full Go'
          }
        }
      ]
    },
    health: {
      week: 11, // Already advanced by hydrateLiveEspnOverlay!
      gameDayRoster: { isActive: true, week: 10, inactives: [] },
      _preGamePracticeReport: [
        {
          playerId: '4427325',
          name: 'Renardo Green',
          position: 'CB',
          injuryType: 'Back',
          gameStatus: 'Questionable',
          playProbabilityPct: 28,
          playBadgeLabel: '28% • Long Shot'
        }
      ],
      practiceReport: [],
      irAndReserveTracker: []
    },
    scheduleMatchup: {
      schedule: [
        { id: 'wk10', week: 10, dateIso: '2026-11-15T21:25:00Z', completed: true, statusDetail: 'Final', opponent: { abbr: 'DAL', name: 'Dallas Cowboys' } },
        { id: 'wk11', week: 11, dateIso: '2026-11-22T21:05:00Z', completed: false, statusDetail: 'Sun 1:05 PM', opponent: { abbr: 'MIN', name: 'Minnesota Vikings' } }
      ],
      upcomingMatchup: { week: 11, oppAbbr: 'MIN', oppName: 'Minnesota Vikings', dateIso: '2026-11-22T21:05:00Z' }
    }
  };
  await hydrateLiveGameDayRosters(liveToFinalData, postWhistleMs);
  assert.equal(liveToFinalData.health.gameDayRoster, null, 'gameDayRoster must clear at Final');
  assert.equal(liveToFinalData.health.practiceReport.length, 0, 'Cleared starter must NOT be restored onto practiceReport from _preGamePracticeReport');
  assert.equal(liveToFinalData.roster.players[0].health.playProbabilityPct, 95, 'Cleared starter must remain at 95% Full Go');
});

// ---------------------------------------------------------------------------
// Scenario 11: Standalone Playable Video Anti-Swallow & Analyst X Tape Routing
// ---------------------------------------------------------------------------
await runSim('Scenario 11 [Playable Video Preservation]: Standalone YouTube film/highlight videos never get swallowed into text articles in All or Film & Trench; @theqbschool X clips route to film', async () => {
  const { classifyNewsItemCategory } = await import('../src/engine/breakingClassifier.js');
  const nowMs = Date.parse('2026-11-18T18:00:00Z');
  const matchingArticle = {
    id: 'art_purdy_wk10',
    type: 'article',
    title: '49ers Playbook: Brock Purdy All-22 Film Breakdown vs Dallas Cowboys',
    summary: 'Breaking down Brock Purdy against Dallas Cover 3 shells.',
    outletName: 'Niners Nation',
    trustTier: 2,
    mentionedPlayers: [{ name: 'Brock Purdy' }],
    url: 'https://www.ninersnation.com/2026/11/18/purdy-all-22-dallas',
    publishedAt: '2026-11-18T16:00:00Z'
  };
  const jonnydelVideo = {
    id: 'vid_jonnydel_wk10',
    type: 'video',
    videoId: 'jdelPurdyWk10',
    duration: '18:40',
    title: '49ers Playbook: Brock Purdy All-22 Film Breakdown vs Dallas Cowboys',
    outletName: "Jonnydel's Football Academy",
    trustTier: 2,
    mentionedPlayers: [{ name: 'Brock Purdy' }],
    url: 'https://www.youtube.com/watch?v=jdelPurdyWk10',
    publishedAt: '2026-11-18T16:30:00Z'
  };
  const clustered = deduplicateAndGroupWireItems([matchingArticle, jonnydelVideo], { nowMs });
  assert.equal(clustered.length, 2, 'Standalone playable video and text article must remain separate cards so the inline video player is never swallowed');

  const qbSchoolXClip = {
    id: 'tw_qbschool_clip',
    type: 'tweet',
    title: 'Look at the anticipation from Brock Purdy on this rep against Dallas.',
    fullText: 'Look at the anticipation from Brock Purdy on this rep against Dallas.',
    author: "JT O'Sullivan",
    authorHandle: '@theqbschool',
    outletName: 'X',
    videoStreamUrl: 'https://video.twimg.com/ext_tw_video/199/pu/vid/avc1/1280x720/purdy_tape.mp4',
    url: 'https://x.com/theqbschool/status/199999999',
    publishedAt: '2026-11-18T17:00:00Z'
  };
  assert.equal(classifyNewsItemCategory(qbSchoolXClip), 'film', '@theqbschool X video breakdown must classify into Film & Trench');
});

// ---------------------------------------------------------------------------
// Scenario 12: End-to-End SNF Game-Day Lifecycle — T-89m Inactives -> OT Injury -> Immediate Post-Final Rollover
// ---------------------------------------------------------------------------
await runSim('Scenario 12 [SNF Game-Day Lifecycle & Post-Final Rollover]: hydrateLiveGameDayRosters signals gameDayChanged on new inactives, preserves OT injured starter across ESPN post-Final rollover, and blanks W/T/F', async () => {
  const { hydrateLiveGameDayRosters, hydrateLiveEspnOverlay } = await import('../src/services/dataService.js');
  const koIso = '2026-11-23T01:20:00Z'; // Sun Nov 22, 5:20 PM PT SNF
  const koMs = Date.parse(koIso);

  const snfApp = {
    meta: { seasonYear: 2026, currentWeek: 11, teamStatus: { currentWeek: 11 } },
    roster: {
      players: [
        {
          id: '3040151',
          name: 'George Kittle',
          position: 'TE',
          unit: 'Offense',
          jersey: 85,
          rosterBucket: 'active',
          isStarter: true,
          primarySnapPct: 88,
          recentNews: [],
          health: {
            status: 'Active',
            injuryType: '',
            playProbabilityPct: 95,
            playTier: 'ACTIVE',
            playBadgeLabel: '95% • Full Go',
            wed: '-',
            thu: '-',
            fri: '-'
          }
        },
        {
          id: '16737',
          name: 'Mike Evans',
          position: 'WR',
          unit: 'Offense',
          jersey: 13,
          rosterBucket: 'active',
          isStarter: true,
          primarySnapPct: 80,
          recentNews: [],
          health: {
            status: 'Questionable',
            injuryType: 'Achilles',
            playProbabilityPct: 55,
            playTier: 'QUESTIONABLE',
            playBadgeLabel: '55% • Questionable',
            wed: 'DNP',
            thu: 'LP',
            fri: 'LP'
          }
        },
        {
          id: '90001',
          name: 'Kurtis Rourke',
          position: 'QB',
          unit: 'Offense',
          jersey: 17,
          rosterBucket: 'active',
          recentNews: [],
          health: { status: 'Active', injuryType: '', playProbabilityPct: 95, playTier: 'ACTIVE', playBadgeLabel: '95% • Full Go' }
        },
        {
          id: '90002',
          name: 'Ben Bartch',
          position: 'OL',
          unit: 'Offense',
          jersey: 78,
          rosterBucket: 'active',
          recentNews: [],
          health: { status: 'Active', injuryType: '', playProbabilityPct: 95, playTier: 'ACTIVE', playBadgeLabel: '95% • Full Go' }
        }
      ]
    },
    health: {
      week: 11,
      byeWeek: 8,
      practiceReport: [
        {
          playerId: '16737',
          name: 'Mike Evans',
          position: 'WR',
          unit: 'Offense',
          isStarter: true,
          wed: 'DNP',
          thu: 'LP',
          fri: 'LP',
          gameStatus: 'Questionable',
          injuryType: 'Achilles',
          playProbabilityPct: 55,
          tier: 'QUESTIONABLE',
          badgeLabel: '55% • Questionable'
        }
      ],
      irReserve: []
    },
    news: { rawStream: [] },
    scheduleMatchup: {
      upcomingMatchup: {
        week: 11,
        gameId: '401873077',
        oppAbbr: 'MIN',
        oppName: 'Minnesota Vikings',
        dateIso: koIso,
        kickoffIso: koIso,
        liveState: 'pre',
        isGameInProgress: false,
        completed: false,
        opponentHealth: {
          teamAbbr: 'MIN',
          teamName: 'Minnesota Vikings',
          activeRoster: [
            { id: 'm1', name: 'Max Brosmer', position: 'QB', rosterBucket: 'active' },
            { id: 'm2', name: 'Harrison Smith', position: 'S', rosterBucket: 'active', isStarter: true },
            { id: 'm3', name: 'Christian Darrisaw', position: 'OT', rosterBucket: 'active', isStarter: true }
          ],
          injuryReport: [],
          keyStartersHealthy: [],
          irReserve: []
        }
      },
      schedule: [
        {
          id: '401873077',
          week: 11,
          seasonType: 'REG',
          dateIso: koIso,
          completed: false,
          statusState: 'pre',
          opponent: { abbr: 'MIN', name: 'Minnesota Vikings' }
        },
        {
          id: '401873099',
          week: 12,
          seasonType: 'REG',
          dateIso: '2026-11-29T21:25:00Z',
          completed: false,
          statusState: 'pre',
          opponent: { abbr: 'SEA', name: 'Seattle Seahawks' }
        }
      ]
    }
  };

  const origFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response('', { status: 404 });
  try {
    // T-88m: Official inactives arrive via multi-line beat tweet -> hydrateLiveGameDayRosters MUST return true (changed!)
    snfApp.news.rawStream.push({
      id: 'snf_inact_list',
      type: 'tweet',
      author: 'Matt Maiocco',
      trustTier: 1,
      title: '49ers inactives vs. Vikings:\nQB Kurtis Rourke (3rd QB)\nWR Mike Evans\nOL Ben Bartch',
      fullText: '49ers inactives vs. Vikings:\nQB Kurtis Rourke (3rd QB)\nWR Mike Evans\nOL Ben Bartch',
      publishedAt: new Date(koMs - 88 * 60_000).toISOString()
    });
    const firstChanged = await hydrateLiveGameDayRosters(snfApp, koMs - 87 * 60_000, { prefs: {} });
    assert.equal(firstChanged, true, 'First game-day hydration with newly posted inactives must signal gameDayChanged: true');
    assert.equal(snfApp.health.gameDayRoster.officialPosted, true);
    assert.equal(
      snfApp.roster.players.find(p => p.name === 'Mike Evans').health.playBadgeLabel,
      '0% • Out (Inactive)'
    );

    // Repeating with identical state returns false (no wasted re-renders)
    const repeatChanged = await hydrateLiveGameDayRosters(snfApp, koMs - 86 * 60_000, { prefs: {} });
    assert.equal(repeatChanged, false, 'Identical game-day state must return gameDayChanged: false');

    // Overtime at ko + 5.6h: George Kittle suffers rib injury and is ruled out
    const otMs = koMs + 5.6 * 3600_000;
    snfApp.scheduleMatchup.schedule[0].statusState = 'in';
    snfApp.scheduleMatchup.schedule[0].isLive = true;
    snfApp.scheduleMatchup.schedule[0].statusDetail = 'OT - 3:45';
    snfApp.scheduleMatchup.upcomingMatchup.liveState = 'in';
    snfApp.scheduleMatchup.upcomingMatchup.isGameInProgress = true;
    snfApp.scheduleMatchup.upcomingMatchup.statusDetail = 'OT - 3:45';
    snfApp.news.rawStream.unshift({
      id: 'kittle_ot_out',
      type: 'tweet',
      author: 'Matt Maiocco',
      trustTier: 1,
      title: '49ers TE George Kittle (ribs) has been ruled out for the rest of tonight’s game.',
      fullText: '49ers TE George Kittle (ribs) has been ruled out for the rest of tonight’s game.',
      publishedAt: new Date(otMs - 60_000).toISOString()
    });

    const otChanged = await hydrateLiveGameDayRosters(snfApp, otMs, { prefs: {} });
    assert.equal(otChanged, true, 'New OT injury must signal gameDayChanged: true');
    const kittleLive = snfApp.roster.players.find(p => p.name === 'George Kittle');
    assert.equal(kittleLive.health.playBadgeLabel, '0% • Out (In-Game)');
    assert.equal(kittleLive.health.sustainedInLastGame, true, 'OT injured starter must stamp sustainedInLastGame');
    assert.ok(
      Array.isArray(snfApp.health._liveSustainedInGameRows) &&
        snfApp.health._liveSustainedInGameRows.some(r => r.name === 'George Kittle'),
      'Sustained OT injury must be cached on _liveSustainedInGameRows before ESPN post-Final rollover'
    );

    // 1 minute after Final: ESPN marks Week 11 Final (and hasn't added Kittle to /injuries yet!)
    const postFinalMs = otMs + 15 * 60_000;
    globalThis.fetch = async url => {
      const u = String(url);
      if (u.includes('/teams/sf/schedule')) {
        return new Response(
          JSON.stringify({
            events: [
              {
                id: '401873077',
                date: koIso,
                season: { type: 2 },
                week: { number: 11 },
                competitions: [
                  {
                    status: { type: { state: 'post', completed: true, shortDetail: 'Final/OT' } },
                    competitors: [
                      { id: '25', homeAway: 'home', score: { value: 27 }, team: { abbreviation: 'SF', displayName: 'San Francisco 49ers' } },
                      { id: '16', homeAway: 'away', score: { value: 24 }, team: { abbreviation: 'MIN', displayName: 'Minnesota Vikings' } }
                    ]
                  }
                ]
              },
              {
                id: '401873099',
                date: '2026-11-29T21:25:00Z',
                season: { type: 2 },
                week: { number: 12 },
                competitions: [
                  {
                    status: { type: { state: 'pre', completed: false, shortDetail: '11/29 - 4:25 PM EST' } },
                    competitors: [
                      { id: '25', homeAway: 'away', team: { abbreviation: 'SF', displayName: 'San Francisco 49ers' } },
                      { id: '26', homeAway: 'home', team: { abbreviation: 'SEA', displayName: 'Seattle Seahawks' } }
                    ]
                  }
                ]
              }
            ]
          }),
          { status: 200 }
        );
      }
      if (u.includes('/injuries?team=sf')) {
        // ESPN hasn't added Kittle's brand-new OT rib injury yet!
        return new Response(JSON.stringify({ injuries: [{ team: { abbreviation: 'SF' }, injuries: [] }] }), { status: 200 });
      }
      return new Response('', { status: 404 });
    };

    const overlayMutated = await hydrateLiveEspnOverlay(snfApp);
    assert.equal(overlayMutated, true, 'Post-Final overlay must return mutated: true');
    assert.equal(snfApp.health.week, 12, 'Post-Final overlay advances health week to 12');
    assert.equal(snfApp.health.gameDayRoster, null, 'Post-Final overlay atomically retires game-day roster at Final');
    assert.notEqual(
      snfApp.roster.players.find(p => p.name === 'George Kittle').health.playBadgeLabel,
      '95% • Full Go',
      'Immediate post-Final ESPN overlay must NOT wipe OT-injured George Kittle back to 95% Full Go!'
    );

    const kittleWk12Row = snfApp.health.practiceReport.find(r => r.name === 'George Kittle');
    assert.ok(kittleWk12Row, 'OT-injured George Kittle must roll onto Week 12 practice report instead of vanishing!');
    assert.equal(kittleWk12Row.wed, '-', 'Week 12 early-week practice report W must be blank');
    assert.equal(kittleWk12Row.thu, '-', 'Week 12 early-week practice report T must be blank');
    assert.equal(kittleWk12Row.fri, '-', 'Week 12 early-week practice report F must be blank');
    assert.ok(
      kittleWk12Row.playProbabilityPct > 0 && kittleWk12Row.playProbabilityPct < 90,
      `Kittle Week 12 rolled play probability must reflect injury uncertainty (0 < pct < 90), got ${kittleWk12Row.playProbabilityPct}`
    );

    // Calling hydrateLiveGameDayRosters again after rollover is an idempotent no-op
    const repeatPost = await hydrateLiveGameDayRosters(snfApp, postFinalMs, { prefs: {} });
    assert.equal(repeatPost, false, 'Repeated post-Final game-day hydration is an idempotent no-op');
  } finally {
    globalThis.fetch = origFetch;
  }
});

console.log(`\nTimeliness Simulation Summary: ${passed} passed, ${failed} failed.\n`);
if (failed > 0) {
  process.exit(1);
}
