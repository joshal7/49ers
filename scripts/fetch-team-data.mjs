#!/usr/bin/env node
/**
 * Two-Stage Multi-Team NFL Live Data Ingestion & Grounded AI Synthesis Pipeline
 *
 * Stage 1 (Runs ONCE): Fetches league-wide datasets once (ESPN 32-team standings,
 *   272-game league schedule for AFC/NFC Monte Carlo, OverTheCap cap-space ceilings,
 *   nflverse 32-team stats & player snaps, and shared 260-prospect Draft Big Board / Combine).
 * Stage 2 (Staggered Per-Team): Builds complete 11-file team bundles under
 *   `data/teams/{slug}/` (`meta.json`, `roster.json`, `depth-chart.json`, `cap.json`,
 *   `health.json`, `news.json`, `schedule-matchup.json`, `seasonal.json`,
 *   `reporters.json`, `beat-podcasts.json`, `podcasts/index.json`) using verified live
 *   ESPN, OverTheCap, Official Club HTML/RSS, CBS Injuries, Power Rankings, Bluesky,
 *   RotoWire, Apple Podcasts, and optional `gemini-4-hydrogen` (`XHIGH`) Daily Brief.
 *
 * NEVER touches `data/*.json` (`49ers.joshal.com` production data).
 *
 * Usage:
 *   node scripts/fetch-team-data.mjs --teams=DET,BUF
 *   GEMINI_NFL_API_KEY=... node scripts/fetch-team-data.mjs --teams=DET,BUF
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {
  ALL_NFL_TEAMS,
  NFL_DIVISIONS,
  buildDeterministicCoachingMatchup,
  getTeamByAbbr,
  hasCrossTeam49ersLeak,
  normalizeAnyTeamAbbr,
  resolveTeamConfig,
  setActiveTeamConfig
} from '../src/config/teamRegistry.js';
import { parseOverTheCapHtml } from './lib/otcParser.mjs';
import {
  analyzeTeamTransactions,
  buildCbsTeamInjuriesUrl,
  parseCbsTeamInjuriesHtml,
  parseOfficial49ersRosterHtml,
  resolveAuthoritativeRosterPlayerStatus
} from './lib/liveHealthAndRosterResolver.mjs';
import {
  buildFranchiseHeadToHeadHistory,
  buildScheduleH2hByOpponentMap,
  estimate4YrRookieContractByPick,
  loadSharedNflversePlayerContext,
  normPlayerName
} from './lib/nflversePlayerContext.mjs';
import {
  fetchLeaguePowerRankingsPayloads,
  fetchLivePowerRankings
} from './lib/powerRankingsFetcher.mjs';
import { buildTeamDraftPrep2027 } from './lib/teamDraftIntelBuilder.mjs';
import { attachDraftClassHighlightVideos } from './lib/draftVideoResolver.mjs';
import { parseTankathonTeamPicksHtml } from './lib/aiSynthesisEngine.mjs';
import {
  buildTeamTradeWindow,
  loadSharedLeagueTradeContext
} from './lib/teamTradeIntelligence.mjs';
import {
  canonicalPlayoffGameKey,
  computeCalibratedTeamPowerRating,
  computeRootingGuideLeverage,
  reconcileAndDedupePlayoffGames,
  runPlayoffMonteCarlo
} from '../src/engine/playoffMonteCarlo.js';
import {
  NFL_TEAM_NAMES,
  computeLeaguePositionalLeaderboards,
  refreshLiveStandingsMetricsInTeamStats
} from '../src/engine/statsLeaderboardEngine.js';
import {
  canonicalInjuryPlayerKey,
  classifyIrAndReserveTimeline,
  computePlayerPlayProbability,
  detectOpen21DayIrWindowFromHistory,
  doesClauseMentionPlayer,
  extractPracticeDaysFromText,
  isRestOrPersonalInjuryLabel,
  parseOfficialClubInjuryReportHtml,
  pickMeaningfulInjuryComment,
  reconcileRosterAndHealthWithNews,
  resolveOfficialReportGameStatus,
  scopeBeatTextToPlayer
} from '../src/engine/injuryProbabilityModel.js';
import { isBeforeWeeklyPracticeWindow } from '../src/engine/gameDayRosterEngine.js';
import {
  buildNflCalendarForSeasonYear,
  normalizeScheduleGameItem
} from '../src/engine/seasonStateMachine.js';
import {
  SHORT_TWEET_FULL_TEXT_LIMIT,
  classifyBreakingItem,
  classifyNewsItemCategory,
  formatTweetBodyForDisplay,
  isOpposingTeamOnlyInjuryOrRosterStory,
  isOpposingTeamSubjectLead,
  resolveNewsBriefCycleState,
  sortNewsWithBreakingPriority
} from '../src/engine/breakingClassifier.js';
import {
  configureBeatAttributionForTeam,
  resolveReporterFromNameOrHandle
} from '../src/engine/beatAttributionEngine.js';
import {
  buildOtcPlayerUrl,
  createPlayerIdentityResolver,
  getPlayerLookupKeys,
  isOffTopicLeagueFiller,
  isPaywalledPublisher,
  normalizePlayerKey,
  sanitizeExternalUrl
} from '../src/engine/linkIntegrity.js';
import { selectBestEspnArticleImage } from '../src/engine/salientMediaEngine.js';
import { cleanSensationalistText, scoreContentSignal } from '../src/engine/antiFluffFilter.js';
import {
  buildAuthoritativeLiveContextSnapshot,
  buildLiveGroundingSystemPrompt,
  validateNoHallucinatedRosterClaims
} from '../src/engine/groundingValidator.js';
import {
  PRIMARY_GEMINI_REASONING_MODEL,
  buildGeminiThinkingConfig,
  resolveGeminiThinkingLevelLabel
} from '../src/engine/geminiStudioPrompts.js';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const UA_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  Accept: 'application/json, text/html, application/xml;q=0.9, */*;q=0.8'
};

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

function hashShort(str = '') {
  return crypto.createHash('sha1').update(String(str)).digest('hex').slice(0, 12);
}

async function fetchTextSafe(url, timeoutMs = 12000) {
  try {
    const res = await fetch(url, { headers: UA_HEADERS, signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) return '';
    return await res.text();
  } catch {
    return '';
  }
}

async function fetchJsonSafe(url, timeoutMs = 12000) {
  try {
    const res = await fetch(url, { headers: UA_HEADERS, signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

function decodeXmlEntities(str = '') {
  return String(str || '')
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function mapPositionToUnit(pos = '') {
  const p = String(pos || '').toUpperCase();
  if (['QB', 'RB', 'FB', 'WR', 'TE', 'OT', 'T', 'OG', 'G', 'C', 'OL'].includes(p)) return 'Offense';
  if (['K', 'P', 'LS', 'PK'].includes(p)) return 'Special Teams';
  return 'Defense';
}

function loadMergedReportersForTeam(team) {
  const natPath = path.join(ROOT, 'config', 'reporters', 'national.json');
  const teamPath = path.join(ROOT, 'config', 'reporters', `${team.abbr.toLowerCase()}.json`);
  const nat = fs.existsSync(natPath) ? JSON.parse(fs.readFileSync(natPath, 'utf8')) : { outlets: [], reporters: [] };
  const loc = fs.existsSync(teamPath) ? JSON.parse(fs.readFileSync(teamPath, 'utf8')) : { outlets: [], reporters: [] };

  const outletsById = new Map();
  for (const o of [...(loc.outlets || []), ...(nat.outlets || [])]) {
    if (o?.id && !outletsById.has(o.id)) outletsById.set(o.id, o);
  }
  const repById = new Map();
  const tierLabels = { 1: 'Tier 1 • Primary Trusted', 2: 'Tier 2 • Analytical Beat', 3: 'Tier 3 • Watchlist' };
  for (const r of [...(loc.reporters || []), ...(nat.reporters || [])]) {
    if (!r?.id || repById.has(r.id)) continue;
    const out = outletsById.get(r.outletId);
    const tier = Number(r.trustTier) || 2;
    repById.set(r.id, {
      ...r,
      trustTier: tier,
      trustTierLabel: tierLabels[tier] || tierLabels[2],
      bskyUrl: r.bskyHandle ? `https://bsky.app/profile/${r.bskyHandle}` : null,
      profileUrl: r.xUrl || (r.bskyHandle ? `https://bsky.app/profile/${r.bskyHandle}` : out?.url || team.clubNewsUrl),
      outletUrl: out?.url || team.clubNewsUrl,
      liveWeeklyMentions: Number(r.liveWeeklyMentions || 10),
      popularityScore: Number(r.baseScore || 88),
      defaultEnabled: r.defaultEnabled !== false
    });
  }

  const nowIso = new Date().toISOString();
  const nextReview = new Date(Date.now() + 14 * 86_400_000).toISOString();
  const reporters = [...repById.values()];
  return {
    updatedAt: nowIso,
    reviewCadenceDays: 14,
    nextAutoReviewAt: nextReview,
    totalTrackedReporters: reporters.length,
    podiumSubjectIds: loc.podiumSubjectIds || [],
    outlets: [...outletsById.values()],
    reporters
  };
}

/**
 * STAGE 1: Fetch league-wide shared datasets ONCE per run.
 */
async function loadSharedLeagueContext(seasonYear = 2026) {
  console.log('[stage-1] Fetching league-wide shared datasets (standings, OTC ceilings, schedule, nflverse players/combine/stats/snaps, live mock drafts, big board)...');
  const nextDraftYear = seasonYear + 1;
  const [
    standingsRaw,
    otcSpaceHtml,
    rotowireXml,
    pftRssXml,
    nfltrRssXml,
    ytNflXml,
    ytQbSchoolXml,
    ytKollmannXml,
    nflverse,
    tkMockHtml,
    dtMockHtml,
    wfMock1Html,
    wfMock2Html
  ] = await Promise.all([
    fetchJsonSafe('https://site.web.api.espn.com/apis/v2/sports/football/nfl/standings', 14000),
    fetchTextSafe('https://overthecap.com/salary-cap-space', 14000),
    fetchTextSafe('https://www.rotowire.com/rss/news.php?sport=NFL', 10000),
    fetchTextSafe('https://www.nbcsports.com/nfl/profootballtalk.rss', 10000),
    fetchTextSafe('https://nfltraderumors.co/feed/', 10000),
    fetchTextSafe('https://www.youtube.com/feeds/videos.xml?channel_id=UCDVYQ4Zhbm3S2dlz7P1GBDg', 10000),
    fetchTextSafe('https://www.youtube.com/feeds/videos.xml?channel_id=UCGfxHp2yuimtLsFaq1r7aIQ', 10000),
    fetchTextSafe('https://www.youtube.com/feeds/videos.xml?channel_id=UCYzfVBuCfGz-oF3aOCGgOmw', 10000),
    loadSharedNflversePlayerContext(seasonYear),
    fetchTextSafe('https://www.tankathon.com/nfl/mock_draft', 14000),
    fetchTextSafe(`https://www.drafttek.com/${nextDraftYear}-NFL-Mock-Draft/${nextDraftYear}-NFL-Mock-Draft-Round-1.asp`, 14000),
    fetchTextSafe(`https://walterfootball.com/draft${nextDraftYear}.php`, 14000),
    fetchTextSafe(`https://walterfootball.com/draft${nextDraftYear}_1.php`, 14000)
  ]);

  // Parse 32-team standings from ESPN
  const standingsByAbbr = new Map();
  for (const conf of standingsRaw?.children || []) {
    const confName = /american|afc/i.test(conf.name || '') ? 'AFC' : 'NFC';
    for (const entry of conf.standings?.entries || []) {
      const abbr = normalizeAnyTeamAbbr(entry.team?.abbreviation || '');
      const getStat = n => entry.stats?.find(s => s.name === n);
      const wins = Number(getStat('wins')?.value || 0);
      const losses = Number(getStat('losses')?.value || 0);
      const ties = Number(getStat('ties')?.value || 0);
      const pf = Number(getStat('pointsFor')?.value || 0);
      const pa = Number(getStat('pointsAgainst')?.value || 0);
      const pd = Number(getStat('pointDifferential')?.value ?? (pf - pa));
      const winPct = Number(getStat('winPercent')?.value || 0);
      const seed = Number(getStat('playoffSeed')?.value || 16);
      const divRec = getStat('vs. Div.')?.displayValue || getStat('divisionRecord')?.displayValue || '0-0';
      const confRec = getStat('vs. Conf.')?.displayValue || '0-0';
      const record = getStat('overall')?.displayValue || `${wins}-${losses}${ties ? `-${ties}` : ''}`;
      standingsByAbbr.set(abbr, {
        abbr,
        name: entry.team?.displayName || NFL_TEAM_NAMES[abbr]?.name || abbr,
        logoUrl: entry.team?.logos?.[0]?.href || `https://a.espncdn.com/i/teamlogos/nfl/500/${abbr.toLowerCase()}.png`,
        conference: confName,
        division: NFL_DIVISIONS[abbr] || `${confName} East`,
        wins,
        losses,
        ties,
        pf,
        pa,
        pd,
        winPct,
        seed,
        record,
        divRec,
        confRec
      });
    }
  }

  // Pull shared league artifacts (260-prospect 3-Lens Draft Big Board, Combine Leaderboard,
  // 272-game league schedule & 32-team base metrics) from existing verified data if present
  const sfSeasonalPath = path.join(ROOT, 'data', 'seasonal.json');
  const sfMatchupPath = path.join(ROOT, 'data', 'schedule-matchup.json');
  const sfSeasonal = fs.existsSync(sfSeasonalPath) ? JSON.parse(fs.readFileSync(sfSeasonalPath, 'utf8')) : null;
  const sfMatchup = fs.existsSync(sfMatchupPath) ? JSON.parse(fs.readFileSync(sfMatchupPath, 'utf8')) : null;

  // Fetch all 18 regular-season weeks from ESPN scoreboard ONLY if shared schedule is stale/missing;
  // otherwise reuse + overlay live standings cleanly!
  const sharedCompletedGames = sfSeasonal?.playoffPicture?.simulatorInputs?.completedGames || [];
  const sharedRemainingGames = sfSeasonal?.playoffPicture?.simulatorInputs?.remainingGames || [];

  // Re-fetch current week + next 2 weeks of ESPN NFL scoreboard to ensure completedGames/remainingGames are 100% fresh.
  // Key strictly by canonical `(week, sortedTeamPair)` so ESPN numeric event IDs (`401873...`) reconcile cleanly
  // with nflverse schedule IDs (`2026_13_MIA_DEN`) instead of duplicating unplayed games or stranding completed ones.
  const seeded = reconcileAndDedupePlayoffGames(sharedCompletedGames, sharedRemainingGames);
  const liveScoreboardCompleted = new Map();
  for (const g of seeded.completedGames) {
    const key = canonicalPlayoffGameKey(g) || String(g.id);
    liveScoreboardCompleted.set(key, g);
  }
  const liveScoreboardRemaining = new Map();
  for (const g of seeded.remainingGames) {
    const key = canonicalPlayoffGameKey(g) || String(g.id);
    if (!liveScoreboardCompleted.has(key)) {
      liveScoreboardRemaining.set(key, g);
    }
  }
  const currentMaxGp = Math.max(1, ...[...standingsByAbbr.values()].map(s => s.wins + s.losses + s.ties));
  const probeWeeks = [Math.max(1, currentMaxGp), Math.min(18, currentMaxGp + 1), Math.min(18, currentMaxGp + 2)];
  const sbPayloads = await Promise.all(
    probeWeeks.map(wk =>
      fetchJsonSafe(
        `https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?seasontype=2&week=${wk}`,
        9000
      )
    )
  );
  for (const sb of sbPayloads) {
    for (const ev of sb?.events || []) {
      const comp = ev.competitions?.[0];
      if (!comp) continue;
      const homeC = (comp.competitors || []).find(c => c.homeAway === 'home');
      const awayC = (comp.competitors || []).find(c => c.homeAway === 'away');
      if (!homeC || !awayC) continue;
      const home = normalizeAnyTeamAbbr(homeC.team?.abbreviation || '');
      const away = normalizeAnyTeamAbbr(awayC.team?.abbreviation || '');
      const wk = Number(ev.week?.number || sb?.week?.number || 1);
      const fallbackId = String(ev.id || `w${wk}_${away}_${home}`);
      const key = canonicalPlayoffGameKey({ week: wk, home, away, id: fallbackId }) || fallbackId;
      const existingRem = liveScoreboardRemaining.get(key);
      const existingComp = liveScoreboardCompleted.get(key);
      const id = String(existingRem?.id || existingComp?.id || fallbackId);
      const completed = Boolean(comp.status?.type?.completed);
      if (completed) {
        liveScoreboardRemaining.delete(key);
        liveScoreboardCompleted.set(key, {
          id,
          week: wk,
          home,
          away,
          homeScore: Number(homeC.score || 0),
          awayScore: Number(awayC.score || 0)
        });
      } else if (!liveScoreboardCompleted.has(key)) {
        liveScoreboardRemaining.set(key, {
          id,
          week: wk,
          home: existingRem?.home || home,
          away: existingRem?.away || away,
          neutral: Boolean(comp.neutralSite || existingRem?.neutral)
        });
      }
    }
  }
  const reconciledLeagueGames = reconcileAndDedupePlayoffGames(
    [...liveScoreboardCompleted.values()],
    [...liveScoreboardRemaining.values()]
  );

  const [leagueTradeCtx, powerRankingsPayloads] = await Promise.all([
    loadSharedLeagueTradeContext({
      seasonYear,
      standingsByAbbr,
      otcSpaceHtml,
      nflverse
    }),
    fetchLeaguePowerRankingsPayloads({
      seasonYear,
      currentWeek: currentMaxGp
    }).catch(() => null)
  ]);

  // Persist compact shared league meta to `data/league/meta.json`
  const leagueDir = path.join(ROOT, 'data', 'league');
  fs.mkdirSync(leagueDir, { recursive: true });
  fs.writeFileSync(
    path.join(leagueDir, 'meta.json'),
    JSON.stringify(
      {
        updatedAt: new Date().toISOString(),
        seasonYear,
        standingsCount: standingsByAbbr.size,
        completedLeagueGames: reconciledLeagueGames.completedGames.length,
        remainingLeagueGames: reconciledLeagueGames.remainingGames.length,
        leagueTradesCount: leagueTradeCtx.leagueTrades.length,
        sellerTradeCandidates: leagueTradeCtx.sellerCandidates.length
      },
      null,
      2
    )
  );

  return {
    seasonYear,
    standingsByAbbr,
    otcSpaceHtml,
    rotowireXml,
    pftRssXml,
    nfltrRssXml,
    youtubeFeeds: [
      { id: 'nfl_official', name: 'NFL', handle: '@NFL', xml: ytNflXml, category: 'highlights', embeddable: false },
      { id: 'the_qb_school', name: 'The QB School', handle: '@TheQBSchool', xml: ytQbSchoolXml, category: 'film', embeddable: true },
      { id: 'brett_kollmann', name: 'Brett Kollmann', handle: '@BrettKollmann', xml: ytKollmannXml, category: 'film', embeddable: true }
    ],
    nflverse,
    leagueTradeCtx,
    powerRankingsPayloads,
    completedGames: reconciledLeagueGames.completedGames,
    remainingGames: reconciledLeagueGames.remainingGames,
    baseTeamStatsTemplate: sfMatchup?.teamStats || null,
    sharedBigBoard: sfSeasonal?.draftPrep2027?.consensusBigBoard || [],
    sharedBigBoardMeta: sfSeasonal?.draftPrep2027?.bigBoardMeta || null,
    sharedBigBoardMethodology: sfSeasonal?.draftPrep2027?.bigBoardMethodology || null,
    sharedCombineLeaderboard: sfSeasonal?.draftPrep2027?.combineLeaderboard || null,
    leagueMockHtmls: { tkMockHtml, dtMockHtml, wfMock1Html, wfMock2Html }
  };
}

function buildTeamStatsForClub(team, leagueCtx) {
  const tpl = leagueCtx.baseTeamStatsTemplate
    ? JSON.parse(JSON.stringify(leagueCtx.baseTeamStatsTemplate))
    : null;
  if (!tpl) return { teamStats: null, teamStatRankings: [] };

  tpl.teamAbbr = team.abbr;
  // Re-point every metric & unit title to this club's rank/value from the shared 32-team leaderboards!
  for (const unit of tpl.units || []) {
    unit.title = String(unit.title || '').replace(/^49ers\b/i, team.nickname);
    const rebindMetric = m => {
      if (!m || !Array.isArray(m.leaderboard)) return;
      const hit = m.leaderboard.find(x => x.team === team.abbr);
      if (hit) {
        m.rank = hit.rank;
        m.value = hit.val;
        m.displayValue = hit.disp;
      }
      if (m.unitTitle) m.unitTitle = String(m.unitTitle).replace(/^49ers\b/i, team.nickname);
    };
    rebindMetric(unit.overall);
    for (const r of unit.coreRows || []) rebindMetric(r);
    for (const grp of unit.expandedGroups || []) {
      for (const r of grp.rows || []) rebindMetric(r);
    }
  }
  for (const key of Object.keys(tpl.flatByKey || {})) {
    const m = tpl.flatByKey[key];
    if (!m || !Array.isArray(m.leaderboard)) continue;
    const hit = m.leaderboard.find(x => x.team === team.abbr);
    if (hit) {
      m.rank = hit.rank;
      m.value = hit.val;
      m.displayValue = hit.disp;
    }
    if (m.unitTitle) m.unitTitle = String(m.unitTitle).replace(/^49ers\b/i, team.nickname);
  }

  // Refresh live PPG / PAPG / PtDiff / Records from today's live ESPN standings
  const legacyRankings = [];
  refreshLiveStandingsMetricsInTeamStats(tpl, legacyRankings, leagueCtx.standingsByAbbr, team.abbr);

  const summaryKeys = [
    'off_pts_game',
    'def_pts_allowed_game',
    'margin_turnover_diff',
    'total_off_epa_game',
    'passing_epa_game',
    'passing_cpoe',
    'rushing_epa_game',
    'yards_per_pass_att',
    'sack_rate_allowed',
    'explosive_plays_game',
    'rush_yds_game',
    'def_epa_allowed_game',
    'def_sacks_game',
    'def_tfl_game',
    'def_takeaways_game'
  ];
  const teamStatRankings = summaryKeys
    .map(k => tpl.flatByKey?.[k])
    .filter(Boolean)
    .map(m => ({
      key: m.key,
      label: m.label,
      value: m.displayValue,
      rank: m.rank,
      leagueAvg: m.leagueAvgDisplay,
      higherIsBetter: m.higherIsBetter
    }));

  return { teamStats: tpl, teamStatRankings };
}

function buildConferencePlayoffPicture(team, leagueCtx) {
  const parseWlt = str => {
    const p = String(str || '0-0').split('-').map(x => Number(x) || 0);
    return { w: p[0] || 0, l: p[1] || 0, t: p[2] || 0 };
  };

  const targetConf = team.conference;
  const confTeams = [];
  const otherPowerRatings = {};
  const otherStandings = {};

  for (const t of ALL_NFL_TEAMS) {
    const st = leagueCtx.standingsByAbbr.get(t.abbr) || {
      wins: 0, losses: 0, ties: 0, pf: 0, pa: 0, pd: 0, record: '0-0', divRec: '0-0', confRec: '0-0',
      logoUrl: `https://a.espncdn.com/i/teamlogos/nfl/500/${t.espnAbbr}.png`
    };
    const rating = computeCalibratedTeamPowerRating({
      wins: st.wins,
      losses: st.losses,
      ties: st.ties,
      pointDiff: st.pd,
      pointsFor: st.pf,
      pointsAgainst: st.pa
    });
    if (t.conference === targetConf) {
      const dr = parseWlt(st.divRec);
      const cr = parseWlt(st.confRec);
      confTeams.push({
        abbr: t.abbr,
        name: t.fullName,
        logoUrl: st.logoUrl,
        division: t.division,
        wins: st.wins,
        losses: st.losses,
        ties: st.ties,
        divWins: dr.w,
        divLosses: dr.l,
        divTies: dr.t,
        confWins: cr.w,
        confLosses: cr.l,
        confTies: cr.t,
        pointDiff: st.pd,
        pointsFor: st.pf,
        pointsAgainst: st.pa,
        powerRating: Math.round(rating)
      });
    } else {
      otherPowerRatings[t.abbr] = Math.round(rating);
      otherStandings[t.abbr] = { wins: st.wins, losses: st.losses, ties: st.ties, pointDiff: st.pd };
    }
  }

  const simulatorInputs = {
    targetTeam: team.abbr,
    conference: targetConf,
    conferenceTeams: confTeams,
    nfcTeams: confTeams,
    otherConferencePowerRatings: otherPowerRatings,
    afcPowerRatings: otherPowerRatings,
    afcRatings: otherPowerRatings,
    otherConferenceStandings: otherStandings,
    afcStandings: otherStandings,
    completedGames: leagueCtx.completedGames,
    remainingGames: leagueCtx.remainingGames
  };

  const baselineSimulation = runPlayoffMonteCarlo({
    ...simulatorInputs,
    iterations: 10000,
    seed: 492026
  });
  const rootingLeverage = computeRootingGuideLeverage(simulatorInputs, 12);
  const myOdds = baselineSimulation.teamOdds || baselineSimulation.sfOdds || {};

  const seedPathCards = [
    {
      target: `#1 ${targetConf} Seed (First-Round Bye)`,
      probabilityPct: myOdds.seed1ByePct ?? 0,
      pathSummary: `${team.fullName} project to ${myOdds.projectedWins ?? 10} wins (${myOdds.seed1ByePct ?? 0}% #1 ${targetConf} seed probability across 10,000 Empirical-Bayes simulations).`
    },
    {
      target: `${team.division} Division Title`,
      probabilityPct: myOdds.winDivisionPct ?? 0,
      pathSummary: `${myOdds.winDivisionPct ?? 0}% probability to claim the ${team.division} crown and host at least one playoff game at ${team.stadium}.`
    },
    {
      target: `${targetConf} Playoff Berth`,
      probabilityPct: myOdds.makePlayoffsPct ?? 0,
      pathSummary: `${myOdds.makePlayoffsPct ?? 0}% overall playoff berth odds (${myOdds.wildCardPct ?? 0}% via Wild Card seeds #5–#7).`
    }
  ];

  return {
    sources: [
      { label: 'ESPN Live NFL Standings', url: 'https://www.espn.com/nfl/standings' },
      { label: 'Empirical-Bayes 10k Monte Carlo', url: `https://www.espn.com/nfl/team/_/name/${team.espnAbbr}/${team.otcSlug}` }
    ],
    baselineSimulation,
    rootingLeverage,
    seedPathCards,
    simulatorInputs
  };
}

async function fetchTeamBlueskyPosts(team, reportersData) {
  const items = [];
  const bskyReps = (reportersData.reporters || []).filter(r => r.bskyHandle);
  const nickRe = new RegExp(`\\b(${team.keywordRules.requiredNicknames.join('|')})\\b`, 'i');
  const handlesToPoll = bskyReps.slice(0, 8);

  const settled = await Promise.allSettled(
    handlesToPoll.map(async rep => {
      const url = `https://public.api.bsky.app/xrpc/app.bsky.feed.getAuthorFeed?actor=${encodeURIComponent(rep.bskyHandle)}&limit=8&filter=posts_no_replies`;
      const json = await fetchJsonSafe(url, 7000);
      if (!json?.feed?.length) return [];
      const out = [];
      for (const entry of json.feed) {
        const post = entry?.post;
        const rec = post?.record;
        if (!post || !rec?.text) continue;
        const text = String(rec.text).replace(/\s+/g, ' ').trim();
        if (text.length < 18) continue;
        const isNational = rep.category === 'national_insider' || rep.category === 'film_analyst' || rep.category === 'cap_analyst';
        if (isNational && !nickRe.test(text)) continue;
        const rkey = String(post.uri || '').split('/').pop() || '';
        const bskyUrl = `https://bsky.app/profile/${rep.bskyHandle}/post/${rkey}`;
        const pubIso = rec.createdAt || post.indexedAt || new Date().toISOString();
        const ageDays = (Date.now() - Date.parse(pubIso)) / 86_400_000;
        if (!Number.isFinite(ageDays) || ageDays > 10) continue;
        const embedImg = post.embed?.images?.[0]?.thumb || post.embed?.external?.thumb || '';
        const extUrl = sanitizeExternalUrl(post.embed?.external?.uri || '', null);
        const tweetDisplay = formatTweetBodyForDisplay(text, SHORT_TWEET_FULL_TEXT_LIMIT);
        out.push({
          id: `${team.abbr.toLowerCase()}_bsky_${hashShort(bskyUrl)}`,
          type: 'tweet',
          title: tweetDisplay.text,
          fullText: text,
          isFullTweet: tweetDisplay.isFullTweet,
          summary: '',
          imageUrl: embedImg,
          imageAlt: `${rep.name} post`,
          publishedAt: new Date(pubIso).toISOString(),
          url: bskyUrl,
          externalUrl: extUrl && !isPaywalledPublisher(extUrl) ? extUrl : null,
          externalTitle: extUrl && !isPaywalledPublisher(extUrl) ? (post.embed?.external?.title || null) : null,
          outletId: rep.outletId,
          outletName: rep.name,
          reporterId: rep.id,
          reporterName: rep.name,
          author: rep.name,
          authorHandle: rep.handle,
          authorProfileUrl: rep.xUrl || `https://bsky.app/profile/${rep.bskyHandle}`,
          trustTier: rep.trustTier || 1,
          wireSource: 'bluesky_live'
        });
      }
      return out;
    })
  );
  for (const s of settled) {
    if (s.status === 'fulfilled' && Array.isArray(s.value)) items.push(...s.value);
  }
  return items;
}

async function fetchTeamBeatPodcasts(team) {
  const shows = team.beatPodcastShows || [];
  if (shows.length === 0) {
    return { updatedAt: new Date().toISOString(), windowDays: 7, totalEpisodes: 0, shows: [], episodes: [] };
  }
  const ids = shows.map(s => s.collectionId).filter(Boolean).join(',');
  const payload = await fetchJsonSafe(
    `https://itunes.apple.com/lookup?id=${ids}&entity=podcastEpisode&limit=10`,
    10000
  );
  const results = Array.isArray(payload?.results) ? payload.results : [];
  const nowMs = Date.now();
  const windowMs = 7 * 86_400_000;
  const metaById = new Map();
  for (const r of results) {
    if (r.wrapperType === 'track' && r.kind === 'podcast') metaById.set(Number(r.collectionId), r);
  }
  const episodes = [];
  for (const r of results) {
    if (r.wrapperType !== 'podcastEpisode') continue;
    const showCfg = shows.find(s => Number(s.collectionId) === Number(r.collectionId));
    if (!showCfg) continue;
    const pubMs = r.releaseDate ? Date.parse(r.releaseDate) : 0;
    if (!pubMs || nowMs - pubMs > windowMs) continue;
    const sm = metaById.get(Number(showCfg.collectionId)) || {};
    const durMin = r.trackTimeMillis ? Math.max(1, Math.round(r.trackTimeMillis / 60000)) : null;
    const rawDesc = decodeXmlEntities(r.description || r.shortDescription || '').slice(0, 275);
    episodes.push({
      id: `pod_${showCfg.id}_${r.trackId}`,
      trackId: r.trackId,
      collectionId: showCfg.collectionId,
      showId: showCfg.id,
      showName: showCfg.name,
      showFullTitle: sm.collectionName || r.collectionName || showCfg.name,
      hosts: showCfg.hosts,
      network: showCfg.network,
      title: decodeXmlEntities(r.trackName || 'Episode'),
      summary: rawDesc || `${showCfg.name} analyzing the latest ${team.fullName} news and film.`,
      publishedAt: new Date(pubMs).toISOString(),
      durationMinutes: durMin,
      durationDisplay: durMin ? `${durMin} min` : 'Podcast',
      artworkUrl: r.artworkUrl160 || sm.artworkUrl600 || sm.artworkUrl100 || '',
      appleEpisodeUrl: r.trackViewUrl || showCfg.appleShowUrl,
      appleShowUrl: sm.collectionViewUrl || showCfg.appleShowUrl,
      feedUrl: r.feedUrl || sm.feedUrl || showCfg.feedUrl,
      audioStreamUrl: r.episodeUrl || ''
    });
  }
  episodes.sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt));
  const enrichedShows = shows.map(s => {
    const sm = metaById.get(Number(s.collectionId)) || {};
    return {
      ...s,
      fullTitle: sm.collectionName || s.fullTitle || s.name,
      artworkUrl: sm.artworkUrl600 || sm.artworkUrl100 || '',
      feedUrl: sm.feedUrl || s.feedUrl,
      appleShowUrl: sm.collectionViewUrl || s.appleShowUrl,
      episodeCount7d: episodes.filter(e => e.showId === s.id).length
    };
  });
  return {
    updatedAt: new Date().toISOString(),
    windowDays: 7,
    totalEpisodes: episodes.length,
    shows: enrichedShows,
    episodes
  };
}

const GEMINI_BATCH_TIMEOUT_COUNTS = new Map();

async function generateGroundedDailyBrief(team, appData, apiKey, { existingBrief = null, forceBrief = false } = {}) {
  const nowMs = Date.now();
  const cycleState = resolveNewsBriefCycleState(nowMs, appData, 17);
  const existingBriefText = [
    existingBrief?.headline || '',
    existingBrief?.summary || '',
    ...(existingBrief?.bullets || []).map(b => (typeof b === 'string' ? b : `${b?.subtopic || ''} ${b?.body || ''}`))
  ].join(' ');
  const oppAbbrBrief = appData.scheduleMatchup?.upcomingMatchup?.oppAbbr || '';
  const existingBriefMatchesTeam =
    Boolean(existingBrief?.id) &&
    String(existingBrief.id).startsWith(`brief_${team.abbr.toLowerCase()}_`) &&
    !hasCrossTeam49ersLeak(existingBriefText, team, oppAbbrBrief);
  if (
    !forceBrief &&
    existingBriefMatchesTeam &&
    existingBrief.source === 'live-gemini-daily' &&
    existingBrief.cycleKey === cycleState.activeCycleKey &&
    existingBrief.headline &&
    Array.isArray(existingBrief.bullets) &&
    existingBrief.bullets.length >= 2
  ) {
    return existingBrief;
  }
  const rawStream = appData.news?.rawStream || [];
  const sourceCandidates = rawStream.slice(0, 14).map((it, idx) => ({
    sid: `S${idx + 1}`,
    id: it.id,
    title: it.title,
    summary: it.summary || it.fullText || '',
    url: it.url,
    author: it.author || it.outletName || `${team.nickname} Beat`,
    outlet: it.outletName || `${team.nickname} Beat`,
    publishedAt: it.publishedAt
  }));

  const buildDeterministicFallback = () => {
    const bullets = sourceCandidates.slice(0, 5).map(s => {
      const lead = s.title.replace(/\s+/g, ' ').trim();
      return `${lead} ([${s.author}](${s.url}))`;
    });
    return {
      id: `brief_${team.abbr.toLowerCase()}_${hashShort(cycleState.activeCycleKey)}`,
      cycleKey: cycleState.activeCycleKey,
      scheduledHourPt: 17,
      isPostGame: Boolean(cycleState.isPostGameCycle),
      gameWeek: appData.meta?.currentWeek || 1,
      teamRecord: appData.meta?.teamRecord || '',
      generatedAt: new Date(nowMs).toISOString(),
      modelUsed: PRIMARY_GEMINI_REASONING_MODEL,
      thinkingLevel: 'XHIGH',
      source: 'deterministic-digest',
      wordCount: bullets.join(' ').split(/\s+/).length,
      headline: `${team.fullName} Daily Briefing — Week ${appData.meta?.currentWeek || 1}`,
      summary: `${team.fullName} (${appData.meta?.teamRecord || '—'}, ${appData.meta?.standingSummary || team.division}) top verified storylines, injury status, and upcoming matchup intel.`,
      bullets,
      coveredStoryKeys: sourceCandidates.slice(0, 5).map(s => s.id),
      coveredUrls: sourceCandidates.slice(0, 5).map(s => s.url).filter(Boolean),
      sources: sourceCandidates.slice(0, 8).map(s => ({
        sid: s.sid,
        title: s.title,
        url: s.url,
        author: s.author,
        outlet: s.outlet,
        publishedAt: s.publishedAt
      }))
    };
  };

  if (!apiKey || sourceCandidates.length < 2) {
    return buildDeterministicFallback();
  }

  const systemPrompt = buildLiveGroundingSystemPrompt(appData);
  const snapshot = buildAuthoritativeLiveContextSnapshot(appData, { compactForDossier: true, includeTradeMatrix: false });
  const sourceBlock = sourceCandidates
    .map(s => `[${s.sid}] (${s.author}, ${s.publishedAt?.slice(0, 10) || ''}) ${s.title}${s.summary ? ` — ${s.summary.slice(0, 180)}` : ''} | URL: ${s.url}`)
    .join('\n');

  const userPrompt = `Write today's single-pass concise, high-signal ${team.fullName} Daily Top-News Brief (target 160–220 words total) strictly grounded in the verified sources & live snapshot below.
Return ONLY valid JSON with this exact shape:
{
  "headline": "Sharp 7-12 word factual headline (no clickbait)",
  "summary": "1-2 sentence executive takeaway grounded in record/health/matchup reality",
  "bullets": [
    "Fact-dense bullet 1 citing [S1] inline as [Source Name](EXACT_URL_FROM_LIST)",
    "Fact-dense bullet 2...",
    "Fact-dense bullet 3...",
    "Fact-dense bullet 4..."
  ]
}
RULES:
- Use ONLY exact URLs from VERIFIED SOURCES below. Never invent URLs or cite departed players as active.
- Ground coaches strictly to ${JSON.stringify(appData.meta?.coaches || team.coachesSeed)}.
- Zero homerism; third-person "${team.city}" / "the ${team.nickname}".

VERIFIED SOURCES:
${sourceBlock}

LIVE SNAPSHOT:
${snapshot.slice(0, 9000)}`;

  const models = [PRIMARY_GEMINI_REASONING_MODEL, 'gemini-3.8-flash', 'gemini-3.5-flash', 'gemini-3-flash-preview'];
  for (const model of models) {
    if ((GEMINI_BATCH_TIMEOUT_COUNTS.get(model) || 0) >= 2) continue;
    try {
      const thinkingConfig = buildGeminiThinkingConfig(model, 'XHIGH');
      const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`;
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: systemPrompt }] },
          generationConfig: {
            temperature: 0.16,
            responseMimeType: 'application/json',
            ...(thinkingConfig ? { thinkingConfig } : {})
          },
          contents: [{ role: 'user', parts: [{ text: userPrompt }] }]
        }),
        signal: AbortSignal.timeout(28000)
      });
      if (!res.ok) {
        console.warn(`[ai-brief] ${team.abbr} ${model} HTTP ${res.status}`);
        continue;
      }
      GEMINI_BATCH_TIMEOUT_COUNTS.set(model, 0);
      const json = await res.json();
      const parts = json?.candidates?.[0]?.content?.parts || [];
      const rawText = parts.filter(p => !p.thought && typeof p.text === 'string').map(p => p.text).join('').trim();
      const cleanJson = rawText.replace(/^```json\s*/i, '').replace(/```$/i, '').trim();
      const parsed = JSON.parse(cleanJson);
      if (!parsed?.headline || !Array.isArray(parsed?.bullets) || parsed.bullets.length < 2) continue;

      const joined = `${parsed.headline} ${parsed.summary || ''} ${parsed.bullets.join(' ')}`;
      const oppAbbr = String(appData?.scheduleMatchup?.upcomingMatchup?.oppAbbr || '').toUpperCase();
      if (hasCrossTeam49ersLeak(joined, team, oppAbbr)) {
        console.warn(`[ai-brief] ${team.abbr} ${model} rejected due to cross-team 49ers leak`);
        continue;
      }
      const guard = validateNoHallucinatedRosterClaims(joined, appData.roster?.players || []);
      const wordCount = joined.split(/\s+/).filter(Boolean).length;
      const citedUrlSet = new Set();
      const mdLinkRe = /\]\((https:\/\/[^)\s]+)\)/gi;
      let lm;
      while ((lm = mdLinkRe.exec(joined)) !== null) {
        citedUrlSet.add(String(lm[1]).trim().toLowerCase().replace(/\/+$/, ''));
      }
      const orderedSources = [
        ...sourceCandidates.filter(s => citedUrlSet.has(String(s.url || '').trim().toLowerCase().replace(/\/+$/, ''))),
        ...sourceCandidates.filter(s => !citedUrlSet.has(String(s.url || '').trim().toLowerCase().replace(/\/+$/, '')))
      ].slice(0, 10);
      return {
        id: `brief_${team.abbr.toLowerCase()}_${hashShort(cycleState.activeCycleKey)}`,
        cycleKey: cycleState.activeCycleKey,
        scheduledHourPt: 17,
        isPostGame: Boolean(cycleState.isPostGameCycle),
        gameWeek: appData.meta?.currentWeek || 1,
        teamRecord: appData.meta?.teamRecord || '',
        generatedAt: new Date(nowMs).toISOString(),
        modelUsed: model,
        thinkingLevel: resolveGeminiThinkingLevelLabel(model, 'XHIGH'),
        source: 'live-gemini-daily',
        wordCount,
        guardClean: guard.valid,
        headline: String(parsed.headline).trim(),
        summary: String(parsed.summary || '').trim(),
        bullets: parsed.bullets.map(b => String(b || '').trim()).filter(Boolean).slice(0, 6),
        coveredStoryKeys: orderedSources.slice(0, 6).map(s => s.id),
        coveredUrls: orderedSources.slice(0, 6).map(s => s.url).filter(Boolean),
        sources: orderedSources.map(s => ({
          sid: s.sid,
          title: s.title,
          url: s.url,
          author: s.author,
          outlet: s.outlet,
          publishedAt: s.publishedAt
        }))
      };
    } catch (err) {
      const msg = String(err?.message || err);
      if (/timeout|aborted/i.test(msg)) {
        GEMINI_BATCH_TIMEOUT_COUNTS.set(model, (GEMINI_BATCH_TIMEOUT_COUNTS.get(model) || 0) + 1);
      }
      console.warn(`[ai-brief] ${team.abbr} ${model} error: ${msg}`);
      continue;
    }
  }
  return buildDeterministicFallback();
}

/**
 * STAGE 2: Build complete 11-file bundle for a single NFL franchise.
 */
async function buildTeamBundle(team, leagueCtx, { geminiApiKey = '' } = {}) {
  setActiveTeamConfig(team);
  console.log(`\n[stage-2] Building live 2026 bundle for ${team.fullName} (${team.abbr} -> ${team.domain})...`);

  const reportersData = loadMergedReportersForTeam(team);
  configureBeatAttributionForTeam(team, reportersData, team.coachesSeed);

  const [
    espnRosterRaw,
    espnDepthRaw,
    espnSchedulePreRaw,
    espnScheduleRegRaw,
    espnSchedulePostRaw,
    espnInjuriesRaw,
    espnNewsRaw,
    espnTxRaw,
    otcHtml,
    clubRosterHtml,
    clubInjuryHtml,
    clubTransactionsHtml,
    tankathonHtml,
    clubNewsRssXml,
    clubVideoRssXml,
    pfrTeamRssXml,
    cbsInjHtml,
    bskyPosts,
    beatPodcasts,
    mddbTeamHtml
  ] = await Promise.all([
    fetchJsonSafe(`https://site.api.espn.com/apis/site/v2/sports/football/nfl/teams/${team.espnId}/roster`),
    fetchJsonSafe(`https://site.api.espn.com/apis/site/v2/sports/football/nfl/teams/${team.espnId}/depthcharts`),
    fetchJsonSafe(`https://site.api.espn.com/apis/site/v2/sports/football/nfl/teams/${team.espnId}/schedule?seasontype=1`),
    fetchJsonSafe(`https://site.api.espn.com/apis/site/v2/sports/football/nfl/teams/${team.espnId}/schedule?seasontype=2`),
    fetchJsonSafe(`https://site.api.espn.com/apis/site/v2/sports/football/nfl/teams/${team.espnId}/schedule?seasontype=3`),
    fetchJsonSafe(`https://site.api.espn.com/apis/site/v2/sports/football/nfl/injuries?team=${team.espnId}`),
    fetchJsonSafe(`https://site.api.espn.com/apis/site/v2/sports/football/nfl/news?team=${team.espnId}&limit=25`),
    fetchJsonSafe(`https://site.api.espn.com/apis/site/v2/sports/football/nfl/transactions?team=${team.espnId}&limit=200`),
    fetchTextSafe(`https://overthecap.com/salary-cap/${team.otcSlug}`, 14000),
    fetchTextSafe(team.clubRosterUrl, 12000),
    fetchTextSafe(team.clubInjuryUrl, 12000),
    fetchTextSafe(`https://www.${team.clubDomain}/team/transactions/`, 10000),
    fetchTextSafe(`https://www.tankathon.com/nfl/${team.slug}`, 14000),
    fetchTextSafe(team.clubRssUrls[0], 10000),
    fetchTextSafe(team.clubRssUrls[1] || `https://www.${team.clubDomain}/rss/videos`, 10000),
    fetchTextSafe(`https://www.profootballrumors.com/${team.otcSlug}/feed`, 8500),
    fetchTextSafe(buildCbsTeamInjuriesUrl(team.abbr, team.fullName), 10000),
    fetchTeamBlueskyPosts(team, reportersData),
    fetchTeamBeatPodcasts(team),
    fetchTextSafe(`https://www.nflmockdraftdatabase.com/teams/${(leagueCtx.seasonYear || 2026) + 1}/${team.otcSlug}`, 14000)
  ]);

  // Merge Preseason (1) + Regular Season (2) + Postseason (3) schedule events cleanly
  const mergedScheduleEventMap = new Map();
  for (const src of [espnSchedulePreRaw, espnScheduleRegRaw, espnSchedulePostRaw]) {
    for (const ev of src?.events || []) {
      const k = String(ev?.id || `${ev?.seasonType?.type || 2}_${ev?.week?.number || 0}`);
      if (!mergedScheduleEventMap.has(k)) mergedScheduleEventMap.set(k, ev);
    }
  }
  const espnScheduleRaw = {
    ...(espnScheduleRegRaw || espnSchedulePostRaw || espnSchedulePreRaw || {}),
    events: [...mergedScheduleEventMap.values()]
  };

  const seasonYear = leagueCtx.seasonYear || 2026;
  const nowIso = new Date().toISOString();
  const nflCtx = leagueCtx.nflverse || null;

  const extractEspnAthleteId = inj => {
    const direct = inj?.athlete?.id ?? inj?.Athlete?.id;
    if (direct != null && String(direct).trim()) return String(direct).trim();
    const headshot = String(inj?.athlete?.headshot?.href || '');
    const hsMatch = headshot.match(/\/full\/(\d+)\.png/i);
    if (hsMatch) return hsMatch[1];
    for (const lnk of inj?.athlete?.links || []) {
      const m = String(lnk?.href || '').match(/\/id\/(\d+)/i);
      if (m) return m[1];
    }
    return '';
  };

  const flattenEspnInjuriesList = (raw, targetEspnTeamId = '') => {
    const arr = Array.isArray(raw?.injuries) ? raw.injuries : [];
    const out = [];
    for (const entry of arr) {
      if (Array.isArray(entry?.injuries)) {
        if (!targetEspnTeamId || String(entry.id || '') === String(targetEspnTeamId)) {
          out.push(...entry.injuries);
        }
      } else if (entry?.athlete) {
        out.push(entry);
      }
    }
    return out;
  };

  // 1. Build Complete Schedule, Bye Week & Upcoming Matchup Context FIRST (needed by IR & play-probability models)
  const teamStanding = leagueCtx.standingsByAbbr.get(team.abbr) || {
    wins: 0, losses: 0, ties: 0, pf: 0, pa: 0, pd: 0, seed: 1, record: '0-0', divRec: '0-0', confRec: '0-0'
  };
  const teamLogoUrl = `https://a.espncdn.com/i/teamlogos/nfl/500/${team.espnAbbr}.png`;
  const schedule = [];
  let byeWeek = null;
  const seenRegWeeks = new Set();

  for (const ev of espnScheduleRaw?.events || []) {
    const stType = Number(ev.seasonType?.type ?? ev.seasonType?.id ?? 2);
    const wkRaw = Number(ev.week?.number || 0);
    if (stType === 3 && wkRaw === 4) continue;
    const seasonType = stType === 1 ? 'PRE' : stType === 3 ? 'POST' : 'REG';
    const wk =
      seasonType === 'PRE'
        ? -(4 - Math.min(3, wkRaw || 1))
        : seasonType === 'POST'
          ? 18 + wkRaw
          : wkRaw;
    if (seasonType === 'REG' && wk >= 1 && wk <= 18) seenRegWeeks.add(wk);

    const comp = ev.competitions?.[0] || {};
    const myComp = (comp.competitors || []).find(c => normalizeAnyTeamAbbr(c.team?.abbreviation || '') === team.abbr);
    const oppComp = (comp.competitors || []).find(c => normalizeAnyTeamAbbr(c.team?.abbreviation || '') !== team.abbr);
    const oppAbbr = normalizeAnyTeamAbbr(oppComp?.team?.abbreviation || 'TBD');
    const oppTeamCfg = getTeamByAbbr(oppAbbr);
    const oppSt = leagueCtx.standingsByAbbr.get(oppAbbr);
    const completed = Boolean(comp.status?.type?.completed);
    const stateLower = String(comp.status?.type?.state || '').toLowerCase();
    const myScore = myComp?.score?.value != null ? Number(myComp.score.value) : (myComp?.score != null ? Number(myComp.score) : null);
    const oppScore = oppComp?.score?.value != null ? Number(oppComp.score.value) : (oppComp?.score != null ? Number(oppComp.score) : null);
    const result =
      completed && myScore != null && oppScore != null
        ? myScore > oppScore
          ? 'W'
          : myScore < oppScore
            ? 'L'
            : 'T'
        : null;

    schedule.push(
      normalizeScheduleGameItem(
        {
          id: String(ev.id || `${seasonType}_${wk}`),
          seasonType,
          preseasonWeek: seasonType === 'PRE' ? wkRaw : null,
          week: wk,
          weekLabel: seasonType === 'PRE' ? `PRE ${wkRaw}` : seasonType === 'POST' ? ['WC', 'DIV', 'CON', 'SB'][wkRaw - 1] || 'POST' : `Wk ${wk}`,
          gameUrl: ev.links?.[0]?.href || `https://www.espn.com/nfl/game/_/gameId/${ev.id}`,
          dateIso: ev.date || comp.date,
          statusDetail: comp.status?.type?.shortDetail || comp.status?.type?.description || '',
          statusState: stateLower,
          isLive: stateLower === 'in',
          completed,
          result,
          sfScore: myScore,
          oppScore,
          homeAway: myComp?.homeAway || 'home',
          sfLogoUrl: teamLogoUrl,
          opponent: {
            abbr: oppAbbr,
            name: oppComp?.team?.displayName || oppTeamCfg?.fullName || oppAbbr,
            shortName: oppComp?.team?.shortDisplayName || oppTeamCfg?.nickname || oppAbbr,
            record: oppSt?.record || '',
            logoUrl: oppComp?.team?.logos?.[0]?.href || `https://a.espncdn.com/i/teamlogos/nfl/500/${oppTeamCfg?.espnAbbr || oppAbbr.toLowerCase()}.png`,
            isTbd: oppAbbr === 'TBD'
          },
          venue: {
            name: comp.venue?.fullName || team.stadium,
            city: comp.venue?.address?.city || team.city,
            state: comp.venue?.address?.state || '',
            country: comp.venue?.address?.country || 'USA',
            isInternational: Boolean(comp.venue?.address?.country && comp.venue.address.country !== 'USA'),
            surface: comp.venue?.grass ? 'Natural Grass' : 'Turf'
          },
          broadcast: (comp.broadcasts || []).flatMap(b => b.names || []).filter(Boolean).join(' / ') || 'NFL TV'
        },
        seasonYear
      )
    );
  }
  for (let w = 5; w <= 14; w += 1) {
    if (!seenRegWeeks.has(w)) {
      byeWeek = w;
      break;
    }
  }
  if (byeWeek) {
    const anyCompletedAfterBye = schedule.some(
      g => g.seasonType === 'REG' && !g.isByeWeek && g.completed && Number(g.week) > byeWeek
    );
    const nextAfterBye = schedule.find(
      g => g.seasonType === 'REG' && !g.isByeWeek && Number(g.week) > byeWeek && g.dateIso
    );
    const byeWindowElapsed =
      nextAfterBye?.dateIso && Number.isFinite(Date.parse(nextAfterBye.dateIso))
        ? Date.now() >= Date.parse(nextAfterBye.dateIso) - 5 * 86_400_000
        : teamStanding.wins + teamStanding.losses + teamStanding.ties >= byeWeek;
    schedule.push(
      normalizeScheduleGameItem(
        {
          id: `bye_${seasonYear}_wk${byeWeek}`,
          seasonType: 'REG',
          week: byeWeek,
          weekLabel: `WK ${byeWeek}`,
          isByeWeek: true,
          statusDetail: 'Bye Week',
          completed: Boolean(anyCompletedAfterBye || byeWindowElapsed),
          sfLogoUrl: teamLogoUrl,
          opponent: { abbr: 'BYE', name: 'BYE WEEK', record: '', isTbd: false },
          venue: { name: 'Bye Week', city: '', state: '', country: 'USA', isInternational: false, surface: '' }
        },
        seasonYear
      )
    );
  }
  schedule.sort((a, b) => (a.week || 0) - (b.week || 0));

  const regAndPost = schedule.filter(g => g.seasonType !== 'PRE' && !g.isByeWeek);
  const nextUnplayed = regAndPost.find(g => !g.completed) || regAndPost[regAndPost.length - 1] || schedule[0];
  const currentWeek = Number(nextUnplayed?.week || Math.min(18, teamStanding.wins + teamStanding.losses + teamStanding.ties + 1));
  const beforePracticeWindow = isBeforeWeeklyPracticeWindow(nextUnplayed?.dateIso || '');

  // Fetch opponent injuries for upcoming matchup
  const oppCfg = nextUnplayed?.opponent?.abbr && nextUnplayed.opponent.abbr !== 'BYE' && nextUnplayed.opponent.abbr !== 'TBD'
    ? getTeamByAbbr(nextUnplayed.opponent.abbr)
    : null;
  const oppInjRaw = oppCfg
    ? await fetchJsonSafe(`https://site.api.espn.com/apis/site/v2/sports/football/nfl/injuries?team=${oppCfg.espnId}`, 8000)
    : null;

  // Reconcile official club injury HTML for team & opponent
  const officialInj = clubInjuryHtml
    ? parseOfficialClubInjuryReportHtml(clubInjuryHtml, nextUnplayed?.opponent?.name || '', team)
    : null;

  // 2. Parse OverTheCap 5-year salary cap ledger & Player Identity Resolver (homonym-safe)
  const otcParsed = otcHtml
    ? parseOverTheCapHtml(otcHtml, seasonYear, leagueCtx.otcSpaceHtml, team.otcSlug)
    : { years: {}, otcPlayers: [], otcNonActivePlayers: [], otcDirectory: [] };
  const otcYears = otcParsed.years || {};
  const otcById = new Map();
  const otcPlayersByKey = new Map();
  for (const entry of otcParsed.otcPlayers || []) {
    if (entry?.otcId) otcById.set(String(entry.otcId), entry);
    if (entry?.name) {
      for (const k of getPlayerLookupKeys(entry.name)) {
        if (!otcPlayersByKey.has(k)) otcPlayersByKey.set(k, entry);
      }
      const nk = normalizePlayerKey(entry.name);
      if (nk && !otcPlayersByKey.has(nk)) otcPlayersByKey.set(nk, entry);
    }
  }
  const otcNonActiveById = new Map();
  const otcNonActiveByKey = new Map();
  for (const entry of otcParsed.otcNonActivePlayers || []) {
    if (entry?.otcId) otcNonActiveById.set(String(entry.otcId), entry);
    if (entry?.name) {
      for (const k of getPlayerLookupKeys(entry.name)) {
        if (!otcNonActiveByKey.has(k)) otcNonActiveByKey.set(k, entry);
      }
      const nk = normalizePlayerKey(entry.name);
      if (nk && !otcNonActiveByKey.has(nk)) otcNonActiveByKey.set(nk, entry);
    }
  }
  const otcDirByKey = new Map();
  for (const d of otcParsed.otcDirectory || []) {
    if (d?.name) {
      for (const k of getPlayerLookupKeys(d.name)) {
        if (!otcDirByKey.has(k)) otcDirByKey.set(k, d);
      }
      const nk = normalizePlayerKey(d.name);
      if (nk && !otcDirByKey.has(nk)) otcDirByKey.set(nk, d);
    }
  }

  const playerIdentityResolver = createPlayerIdentityResolver({
    nflPlayers: nflCtx?.nflPlayers || [],
    otcPlayers: otcParsed.otcDirectory?.length
      ? [...otcParsed.otcDirectory, ...otcParsed.otcPlayers]
      : otcParsed.otcPlayers || [],
    seasonYear
  });

  // 3. Parse official club roster (`byKey`), ESPN depth chart IDs, transactions IR ledger, ESPN & CBS injuries
  const officialClubRoster = clubRosterHtml
    ? parseOfficial49ersRosterHtml(clubRosterHtml)
    : { hasAuthoritativeData: false, byKey: new Map(), counts: {} };
  const teamTxAnalysis = analyzeTeamTransactions(espnTxRaw?.transactions || [], seasonYear);
  const depthChartIds = new Set();
  for (const dc of espnDepthRaw?.depthchart || []) {
    for (const posObj of Object.values(dc.positions || {})) {
      for (const ath of posObj.athletes || []) {
        if (ath?.id != null) depthChartIds.add(String(ath.id));
      }
    }
  }
  const recentTeamNewsText = (espnNewsRaw?.articles || [])
    .slice(0, 20)
    .map(a => `${a.headline || ''} ${a.description || ''}`)
    .join(' ');

  const espnInjById = new Map();
  const espnInjByName = new Map();
  for (const inj of flattenEspnInjuriesList(espnInjuriesRaw, team.espnId)) {
    const athId = extractEspnAthleteId(inj);
    const athName = normalizePlayerKey(inj?.athlete?.displayName || inj?.athlete?.fullName || '');
    if (athId) espnInjById.set(athId, inj);
    if (athName) espnInjByName.set(athName, inj);
  }
  const cbsInjMap = cbsInjHtml ? parseCbsTeamInjuriesHtml(cbsInjHtml) : new Map();

  // Per-team nflverse maps
  const teamSnapsByPfr = nflCtx?.snapsByTeamAndPfr?.get(team.abbr) || new Map();
  const teamSnapsByName = nflCtx?.snapsByTeamAndName?.get(team.abbr) || new Map();
  const teamWeeklyInjByName = nflCtx?.weeklyInjByTeamAndName?.get(team.abbr) || new Map();
  const teamDraftPicks = nflCtx?.draftPicksByTeam?.get(team.abbr) || [];

  // 4. Build Complete Enriched Roster Array (Spider Charts, 2026 + Career Stats, Snaps, NGS, PFR, Health, IR)
  const allEspnRosterNames = [];
  for (const grp of espnRosterRaw?.athletes || []) {
    for (const a of grp.items || []) {
      const nm = a?.fullName || a?.displayName;
      if (nm) allEspnRosterNames.push(nm);
    }
  }
  const players = [];
  const excludedGhostIds = [];
  const seenIds = new Set();
  for (const grp of espnRosterRaw?.athletes || []) {
    const groupKey = String(grp.position || '');
    const grpNameLower = groupKey.toLowerCase();
    const espnDefaultBucket =
      grpNameLower.includes('injured')
        ? 'ir'
        : grpNameLower.includes('practice')
          ? 'practice_squad'
          : grpNameLower.includes('suspended')
            ? 'suspended'
            : 'active';

    for (const a of grp.items || []) {
      const id = String(a.id || '');
      if (!id || seenIds.has(id)) continue;
      seenIds.add(id);

      const fullName = a.fullName || a.displayName || 'Player';
      const nk = normalizePlayerKey(fullName);
      const nflNameKey = normPlayerName(fullName);
      const canonKey = canonicalInjuryPlayerKey(fullName);
      const pos = a.position?.abbreviation || 'ATH';
      const unit = mapPositionToUnit(pos);

      const espnInj = espnInjById.get(id) || espnInjByName.get(nk) || null;
      const inlineInj = a.injuries?.[0] || null;
      const offRosRec = officialClubRoster.byKey.get(canonKey) || null;
      const txRec = teamTxAnalysis.byKey.get(canonKey) || null;
      const otcLookupKeys = getPlayerLookupKeys(fullName);
      const inOtcTeamPage = Boolean(
        otcLookupKeys.some(k => otcPlayersByKey.has(k) || otcNonActiveByKey.has(k)) ||
          otcPlayersByKey.has(nk) ||
          otcNonActiveByKey.has(nk)
      );

      const rosterDecision = resolveAuthoritativeRosterPlayerStatus({
        teamAbbr: team.abbr,
        espnId: id,
        fullName,
        groupKey,
        espnDefaultBucket,
        offRosRec,
        officialRosterHasData: officialClubRoster.hasAuthoritativeData,
        txRec,
        depthChartIds,
        espnInj,
        webInj: null,
        inlineInj,
        recentNewsText: recentTeamNewsText,
        inOtcTeamPage
      });
      if (!rosterDecision.include) {
        excludedGhostIds.push(id);
        continue;
      }

      const rosterBucket = rosterDecision.bucket;
      const isReserveLeftSquadOrSusp = rosterDecision.isReserveLeftSquadOrSusp;

      // Homonym-safe Identity Resolution (GSIS, PFR, OTC, Draft Metadata)
      const resolvedIdentity = playerIdentityResolver.resolvePlayer({
        espnId: id,
        fullName,
        position: pos,
        college: a.college?.name || '',
        teamAbbr: team.abbr
      });
      const nflMeta = resolvedIdentity.nflMeta;
      const gsisId = resolvedIdentity.gsisId;
      const pfrId = resolvedIdentity.pfrId;
      const otcEntry =
        (resolvedIdentity.otcId && otcById.get(String(resolvedIdentity.otcId))) ||
        otcLookupKeys.map(k => otcPlayersByKey.get(k)).find(Boolean) ||
        otcPlayersByKey.get(nk) ||
        null;
      const otcNonActiveEntry =
        (resolvedIdentity.otcId && otcNonActiveById.get(String(resolvedIdentity.otcId))) ||
        otcLookupKeys.map(k => otcNonActiveByKey.get(k)).find(Boolean) ||
        otcNonActiveByKey.get(nk) ||
        null;
      const otcDir =
        otcLookupKeys.map(k => otcDirByKey.get(k)).find(Boolean) ||
        otcDirByKey.get(nk) ||
        null;
      const contractsByYear = otcEntry?.contractsByYear || {};
      const capHit2026 = Number(
        contractsByYear[String(seasonYear)]?.capNumber ||
          otcNonActiveEntry?.chargesByYear?.[String(seasonYear)]?.capNumber ||
          0
      );
      const resolvedOtcId =
        otcEntry?.otcId || otcNonActiveEntry?.otcId || otcDir?.otcId || resolvedIdentity.otcId || null;
      const resolvedOtcSlug =
        otcEntry?.slug || otcNonActiveEntry?.slug || otcDir?.slug || resolvedIdentity.otcSlug || null;
      const otcUrl =
        buildOtcPlayerUrl({
          otcSlug: resolvedOtcSlug,
          otcId: resolvedOtcId,
          espnId: id,
          playerName: fullName,
          fallbackToTeam: false
        }) ||
        otcEntry?.otcUrl ||
        otcNonActiveEntry?.otcUrl ||
        otcDir?.otcUrl ||
        `https://overthecap.com/salary-cap/${team.otcSlug}`;

      // 4-Year Career + 2026 Regular-Season Box-Score Stats (+ ESPN QBR for QBs)
      const seasonsRaw = [
        ...((gsisId && nflCtx?.seasonStatsByGsis?.get(gsisId)) ||
          nflCtx?.seasonStatsByName?.get(nflNameKey) ||
          [])
      ];
      const dedupSeasons = [];
      const seenYrs = new Set();
      for (const s of seasonsRaw.sort((x, y) => y.season - x.season)) {
        if (!seenYrs.has(s.season)) {
          seenYrs.add(s.season);
          const cloned = { ...s, passing: s.passing ? { ...s.passing } : s.passing };
          if (cloned.passing && nflCtx) {
            const qbrHit =
              nflCtx.qbrCareerByEspnSeason?.get(`${id}:${cloned.season}`) ||
              nflCtx.qbrCareerByNameSeason?.get(`${nflNameKey}:${cloned.season}`) ||
              null;
            if (qbrHit?.qbrTotal != null) {
              cloned.passing.qbr = qbrHit.qbrTotal;
            }
          }
          dedupSeasons.push(cloned);
        }
      }
      const stats2026 = dedupSeasons.find(s => s.season === seasonYear) || null;

      // 2026 Regular-Season Snap Counts (prefer full-season total for mid-season trade/waiver additions)
      const clubSnapObj = (pfrId && teamSnapsByPfr.get(pfrId)) || teamSnapsByName.get(nflNameKey) || null;
      const allSnapObj =
        (pfrId && nflCtx?.snapsAllTeamsByPfr?.get(pfrId)) ||
        nflCtx?.snapsAllTeamsByName?.get(nflNameKey) ||
        null;
      const snapObj =
        allSnapObj && (!clubSnapObj || allSnapObj.games > clubSnapObj.games)
          ? allSnapObj
          : clubSnapObj || allSnapObj || null;
      const snapSummary = snapObj
        ? {
            gamesLogged: snapObj.games,
            offenseSnaps: snapObj.offSnaps,
            offenseSnapPct: Math.round((snapObj.offPctSum / Math.max(1, snapObj.games)) * 100),
            defenseSnaps: snapObj.defSnaps,
            defenseSnapPct: Math.round((snapObj.defPctSum / Math.max(1, snapObj.games)) * 100),
            stSnaps: snapObj.stSnaps,
            stSnapPct: Math.round((snapObj.stPctSum / Math.max(1, snapObj.games)) * 100)
          }
        : { gamesLogged: 0, offenseSnaps: 0, offenseSnapPct: 0, defenseSnaps: 0, defenseSnapPct: 0, stSnaps: 0, stSnapPct: 0 };
      const primarySnapPct =
        unit === 'Offense'
          ? snapSummary.offenseSnapPct
          : unit === 'Defense'
            ? snapSummary.defenseSnapPct
            : snapSummary.stSnapPct;

      // MockDraftable Combine Spider Profile (0-100th positional percentiles, RAS, top-3 historical comps)
      const spiderProfile = nflCtx?.buildPlayerSpiderProfile
        ? nflCtx.buildPlayerSpiderProfile({
            name: fullName,
            pfrId,
            position: pos,
            heightIn: a.height || (nflMeta?.height ? Number(nflMeta.height) : null),
            weightLb: a.weight || (nflMeta?.weight ? Number(nflMeta.weight) : null)
          })
        : null;

      // Verified Draft Pedigree (nflverse players.csv -> draft_picks.csv -> ESPN draft -> Undrafted / CFA)
      const dpRec =
        (pfrId && nflCtx?.draftPickByPfrId?.get(pfrId)) ||
        (nflMeta?.draft_year ? nflCtx?.draftPickByNameYear?.get(`${nflNameKey}:${nflMeta.draft_year}`) : null) ||
        (a.experience?.years === 0 ? nflCtx?.draftPickByNameYear?.get(`${nflNameKey}:${seasonYear}`) : null) ||
        null;
      const draftYearVal = Number(nflMeta?.draft_year || dpRec?.season || a.draft?.year || 0);
      const draftRoundVal = Number(nflMeta?.draft_round || dpRec?.round || a.draft?.round || 0);
      const draftPickVal = Number(nflMeta?.draft_pick || dpRec?.pick || a.draft?.selection || 0);
      const draftInfo =
        draftYearVal && draftRoundVal && draftPickVal
          ? `${draftYearVal} • Rd ${draftRoundVal}, Pick #${draftPickVal}`
          : 'Undrafted / CFA';

      // Multi-source Injury, Practice Progression & IR Return Reconciliation (fixed property mappings!)
      const cbsInj = cbsInjMap.get(canonKey) || null;
      const offInjRec = officialInj?.sfByKey?.get(canonKey) || null;
      const weeklyHistory2026 = teamWeeklyInjByName.get(nflNameKey) || [];

      const rawEspnStatus = String(espnInj?.status || inlineInj?.status || '').trim();
      const espnBlurbMs = espnInj?.date ? Date.parse(espnInj.date) : NaN;
      const isStaleActiveIrBlurb =
        rosterBucket === 'active' &&
        /injured reserve|reserve\/pup|reserve\/nfi/i.test(rawEspnStatus) &&
        (offRosRec?.bucket === 'active' ||
          !Number.isFinite(espnBlurbMs) ||
          Date.now() - espnBlurbMs > 14 * 86_400_000);

      const rawStatus =
        (isReserveLeftSquadOrSusp && !offRosRec ? 'Reserve / Left Squad' : '') ||
        rosterDecision.statusOverride ||
        (isStaleActiveIrBlurb ? 'Active' : rawEspnStatus) ||
        (cbsInj?.statusText && !/active/i.test(cbsInj.statusText) ? cbsInj.statusText : '') ||
        (rosterBucket === 'ir' ? 'Injured Reserve' : '');

      const rawShortComment = isStaleActiveIrBlurb
        ? ''
        : cleanSensationalistText(pickMeaningfulInjuryComment(espnInj?.shortComment, inlineInj?.shortComment));
      const rawLongComment = isStaleActiveIrBlurb
        ? ''
        : cleanSensationalistText(pickMeaningfulInjuryComment(espnInj?.longComment, inlineInj?.longComment, rawShortComment));
      const returnDateStr = isStaleActiveIrBlurb
        ? null
        : espnInj?.details?.returnDate || inlineInj?.details?.returnDate || null;

      const scopedShortComment = rawShortComment
        ? scopeBeatTextToPlayer(rawShortComment, fullName, allEspnRosterNames)
        : '';

      const leadParenBodyPart = (() => {
        const m = rawShortComment.match(/^([A-Z][A-Za-z'. -]{1,28})\s+\(([a-zA-Z /,-]{3,28})\)/);
        if (!m) return '';
        const subj = m[1].trim().toLowerCase();
        const lastToken = String(fullName || '').trim().split(/\s+/).filter(w => !/^(jr\.?|sr\.?|ii|iii|iv|v)$/i.test(w)).pop()?.toLowerCase() || '';
        if (lastToken.length >= 3 && !subj.includes(lastToken)) return '';
        const cand = m[2].trim();
        if (/\b(solo|tackle|yard|target|catch|carry|touchdown|sack|int|fumble|pat|attempt)\b/i.test(cand)) {
          return '';
        }
        return cand.charAt(0).toUpperCase() + cand.slice(1);
      })();

      const secondaryMedicalInjury = isStaleActiveIrBlurb
        ? ''
        : cbsInj?.injuryType ||
          espnInj?.details?.type ||
          inlineInj?.details?.type ||
          leadParenBodyPart ||
          '';
      const offIsRestOrNir = isRestOrPersonalInjuryLabel(offInjRec?.injuryType || '');
      const offHasMidweekLimitedOrDnp =
        Boolean(offInjRec) &&
        (offInjRec.thu === 'LP' ||
          offInjRec.thu === 'DNP' ||
          offInjRec.fri === 'LP' ||
          offInjRec.fri === 'DNP' ||
          ['Questionable', 'Doubtful', 'Out'].includes(offInjRec.gameStatus || ''));
      const explicitInjType =
        (offIsRestOrNir && offHasMidweekLimitedOrDnp
          ? secondaryMedicalInjury && !isRestOrPersonalInjuryLabel(secondaryMedicalInjury)
            ? secondaryMedicalInjury
            : 'Injury (Reported)'
          : offInjRec?.injuryType) ||
        secondaryMedicalInjury ||
        '';

      const notActivatedForCurrentWeek =
        /not activated|didn't activate|did not activate|remains on injured reserve|ruled out|will miss /i.test(
          `${rawShortComment} ${rawLongComment}`
        );
      const isIrReturnQuestionable =
        rosterBucket === 'ir' &&
        !notActivatedForCurrentWeek &&
        (offInjRec?.gameStatus === 'Questionable' ||
          /(listed as questionable|questionable for sunday|likely will be activated|expected to be activated)/i.test(
            `${rawShortComment} ${rawLongComment}`
          ));
      const hasOfficialIrPractice =
        rosterBucket === 'ir' &&
        Boolean(offInjRec) &&
        ((offInjRec.wed && offInjRec.wed !== '-') ||
          (offInjRec.thu && offInjRec.thu !== '-') ||
          (offInjRec.fri && offInjRec.fri !== '-'));

      const irFantasyAbbr = espnInj?.details?.fantasyStatus?.abbreviation || '';
      const persistedIrWin =
        rosterBucket === 'ir'
          ? detectOpen21DayIrWindowFromHistory({
              playerName: fullName,
              rosterBucket,
              isSeasonEnding: false,
              fantasyStatusAbbr: irFantasyAbbr,
              weeklyHistory: weeklyHistory2026,
              beatNote: rawLongComment || rawShortComment,
              currentWeek
            })
          : { isOpen: false, designatedDateIso: null };

      const irClassification =
        rosterBucket === 'ir' || rosterBucket === 'suspended'
          ? classifyIrAndReserveTimeline({
              statusRaw: rawStatus,
              fantasyStatusAbbr: irFantasyAbbr,
              injuryType: explicitInjType || leadParenBodyPart || 'Undisclosed',
              injuryDetail: espnInj?.details?.detail || '',
              returnDateIso: returnDateStr,
              placedDateIso: espnInj?.date || inlineInj?.date || null,
              txPlacedDateIso: txRec?.placedOnIrDate || null,
              designatedDateIso: txRec?.designatedToReturnDate || persistedIrWin.designatedDateIso || null,
              beatNote: rawLongComment || rawShortComment,
              txNote: txRec?.placedOnIrNote || '',
              cbsStatusText: cbsInj?.statusText || '',
              isDesignatedToReturnOpen: Boolean(
                txRec?.designatedToReturnOpen || hasOfficialIrPractice || persistedIrWin.isOpen
              ),
              isActivated: false,
              currentWeek,
              byeWeek: byeWeek || null,
              seasonYear,
              scheduleEvents: espnScheduleRaw?.events || []
            })
          : null;

      // Filter out healthy Active ESPN fantasy blurbs & teammate-injury blurbs (e.g. Dawson Knox mentioning Kincaid)!
      const rawStatusLower = String(rawStatus || '').toLowerCase().trim();
      const hasExplicitMedicalInjury = Boolean(explicitInjType) && !/^healthy$/i.test(explicitInjType);
      const isGenuineInjuryReportEntry =
        rosterBucket === 'active'
          ? isStaleActiveIrBlurb
            ? false
            : officialInj?.hasSfReport
              ? Boolean(offInjRec) ||
                ['out', 'doubtful', 'questionable'].includes(rawStatusLower)
              : ['out', 'doubtful', 'questionable'].includes(rawStatusLower) ||
                hasExplicitMedicalInjury ||
                Boolean(leadParenBodyPart) ||
                (rawStatusLower !== 'active' &&
                  /(designation|questionable|doubtful|ruled out|will miss|limited in practice|did not practice)/i.test(
                    scopedShortComment
                  ))
          : true;

      const injuryType =
        irClassification?.injuryType ||
        (isGenuineInjuryReportEntry ? explicitInjType || leadParenBodyPart : '');
      const shortComment = isGenuineInjuryReportEntry ? rawShortComment : '';
      const longComment = isGenuineInjuryReportEntry ? rawLongComment : '';

      let wed = '-';
      let thu = '-';
      let fri = '-';
      if (
        offInjRec &&
        (rosterBucket === 'active' ||
          isIrReturnQuestionable ||
          txRec?.designatedToReturnOpen ||
          hasOfficialIrPractice ||
          irClassification?.isPracticeWindowOpen)
      ) {
        wed = offInjRec.wed || '-';
        thu = offInjRec.thu || '-';
        fri = offInjRec.fri || '-';
      } else if (!beforePracticeWindow && rosterBucket === 'active' && isGenuineInjuryReportEntry) {
        const extracted = extractPracticeDaysFromText({
          statusRaw: rawStatus,
          injuryType,
          shortComment,
          longComment,
          kickoffIso: nextUnplayed?.dateIso || '',
          allowHeuristicFill: true
        });
        wed = extracted.wed || '-';
        thu = extracted.thu || '-';
        fri = extracted.fri || '-';
      }

      const downgradeProseRe =
        /\b(?:downgraded\s+to\s+(?:out|doubtful|questionable)|ruled\s+out|did\s+not\s+travel|didn['’]?t\s+travel|added\s+to\s+(?:the\s+)?injury\s+report|suffered\s+a\s+setback|setback\s+(?:at|in|during)\s+practice|illness)\b/i;

      const effectiveGameStatus = isIrReturnQuestionable
        ? 'Questionable'
        : rosterBucket === 'ir' || rosterBucket === 'suspended'
          ? irClassification?.status || 'Injured Reserve'
          : offInjRec
            ? resolveOfficialReportGameStatus({
                offRec: { ...offInjRec, wed, thu, fri },
                teamHasGameDesignations: Boolean(officialInj?.hasSfGameDesignations),
                existingStatus: rawStatus,
                effectiveInjuryType: injuryType,
                hasSecondaryMedical:
                  Boolean(injuryType) &&
                  !isRestOrPersonalInjuryLabel(injuryType) &&
                  (thu === 'LP' || thu === 'DNP' || fri === 'LP' || fri === 'DNP'),
                isPureRest: isRestOrPersonalInjuryLabel(offInjRec.injuryType || ''),
                espnHasDowngradeProse: downgradeProseRe.test(`${shortComment} ${longComment}`)
              })
            : isGenuineInjuryReportEntry
              ? rawStatus
              : '';

      const prob = computePlayerPlayProbability({
        name: fullName,
        position: pos,
        experienceYears: Number(a.experience?.years) || 0,
        snapPct: primarySnapPct,
        gameStatus: effectiveGameStatus,
        priorWeekStatus: rawStatus,
        weeklyHistory: weeklyHistory2026,
        earliestEligibleWeek: irClassification?.earliestEligibleWeek ?? null,
        currentWeek,
        byeWeek: byeWeek || null,
        fantasyStatusAbbr: irFantasyAbbr,
        rosterBucket,
        isPracticeWindowOpen: Boolean(irClassification?.isPracticeWindowOpen),
        designatedDateIso: txRec?.designatedToReturnDate || persistedIrWin.designatedDateIso || null,
        kickoffIso: nextUnplayed?.dateIso || '',
        schedule,
        upcomingOppName: nextUnplayed?.opponent?.name || '',
        upcomingOppAbbr: nextUnplayed?.opponent?.abbr || '',
        blurbDateIso: espnInj?.date || inlineInj?.date || null,
        isIrReturnQuestionable,
        isSeasonEnding: Boolean(irClassification?.isSeasonEnding),
        injuryType,
        wed,
        thu,
        fri,
        rosterPlayerNames: allEspnRosterNames,
        beatNote: isGenuineInjuryReportEntry
          ? `${shortComment} ${longComment} ${irClassification?.beatNote || ''}`.trim()
          : ''
      });

      const resolvedHealthStatus =
        rosterBucket === 'practice_squad'
          ? 'Practice Squad'
          : isIrReturnQuestionable
            ? 'Questionable (IR Return Window)'
            : irClassification
              ? irClassification.status
              : offInjRec
                ? effectiveGameStatus === 'Active'
                  ? wed === 'Vet Rest'
                    ? 'Active'
                    : 'No Designation (Cleared)'
                  : effectiveGameStatus
                : isGenuineInjuryReportEntry && rawStatus
                  ? rawStatus
                  : 'Active';

      // Player-specific non-paywalled ESPN news mentions
      const playerRecentNews = (espnNewsRaw?.articles || [])
        .filter(art => {
          if (art.premium) return false;
          const safeArtUrl = sanitizeExternalUrl(art.links?.web?.href, null);
          if (!safeArtUrl && art.links?.web?.href) return false;
          return doesClauseMentionPlayer(`${art.headline || ''} ${art.description || ''}`, fullName, {
            allowSurname: false
          });
        })
        .slice(0, 3)
        .map(art => ({
          headline: cleanSensationalistText(art.headline || ''),
          summary: cleanSensationalistText(art.description || ''),
          publishedAt: art.published || nowIso,
          imageUrl: selectBestEspnArticleImage(art.images) || '',
          url: sanitizeExternalUrl(
            art.links?.web?.href,
            `https://www.espn.com/nfl/team/_/name/${team.espnAbbr}/${team.otcSlug}`
          )
        }));

      players.push({
        id,
        gsisId,
        pfrId,
        otcId: resolvedOtcId,
        otcSlug: resolvedOtcSlug,
        otcUrl,
        espnUrl: resolvedIdentity.espnUrl || `https://www.espn.com/nfl/player/_/id/${id}`,
        pfrUrl:
          resolvedIdentity.pfrUrl ||
          `https://www.pro-football-reference.com/search/search.fcgi?search=${encodeURIComponent(fullName)}`,
        name: fullName,
        shortName: a.shortName || fullName,
        jersey: a.jersey != null && a.jersey !== '' ? Number(a.jersey) : null,
        position: pos,
        unit,
        rosterBucket,
        age: Number(a.age) || null,
        displayHeight: a.displayHeight || '',
        displayWeight: a.displayWeight || (a.weight ? `${a.weight} lbs` : ''),
        experienceYears:
          a.experience?.years != null
            ? Number(a.experience.years)
            : nflMeta?.years_of_experience
              ? Number(nflMeta.years_of_experience)
              : 0,
        college: a.college?.name || nflMeta?.college_name || '',
        draftInfo,
        headshotUrl:
          a.headshot?.href ||
          nflMeta?.headshot ||
          `https://a.espncdn.com/i/headshots/nfl/players/full/${id}.png`,
        capHit2026,
        contractsByYear,
        snapSummary,
        primarySnapPct,
        stats2026,
        careerSeasons: dedupSeasons,
        nextGenStats: (gsisId && nflCtx?.ngsByGsis?.get(gsisId)) || null,
        pfrAdvStats: (pfrId && nflCtx?.pfrAdvById?.get(pfrId)) || null,
        publicEfficiencyNote: null,
        spiderProfile,
        health: {
          status: resolvedHealthStatus,
          injuryType: injuryType || (rosterBucket === 'ir' ? 'Reserve / IR' : ''),
          returnDate: returnDateStr,
          isSeasonEnding: Boolean(irClassification?.isSeasonEnding),
          isPracticeWindowOpen: Boolean(irClassification?.isPracticeWindowOpen),
          designatedDateIso: txRec?.designatedToReturnDate || persistedIrWin.designatedDateIso || null,
          blurbDateIso: espnInj?.date || inlineInj?.date || null,
          placedBeforeWeek: irClassification?.placedBeforeWeek ?? null,
          earliestEligibleWeek: irClassification?.earliestEligibleWeek ?? null,
          projectedReturnWeek: irClassification?.projectedReturnWeek ?? null,
          byeWeekNote: irClassification?.byeWeekNote || '',
          irBeatNote: irClassification?.beatNote || (rosterBucket === 'ir' ? longComment || shortComment : ''),
          fantasyStatusAbbr: irFantasyAbbr,
          isIrReturnQuestionable,
          isOnPracticeReport:
            rosterBucket === 'active'
              ? Boolean(isGenuineInjuryReportEntry)
              : Boolean(
                  isIrReturnQuestionable ||
                    irClassification?.isPracticeWindowOpen ||
                    hasOfficialIrPractice
                ),
          wed,
          thu,
          fri,
          shortComment,
          longComment,
          playProbabilityPct: prob.probabilityPct,
          playTier: prob.tier,
          playBadgeLabel: prob.badgeLabel,
          factors: prob.factors || [],
          archetypeNote: prob.priorUsed?.archetypeNote || prob.archetypeNote || '',
          weeklyHistory2026
        },
        recentNews: playerRecentNews,
        statProfile2026: null
      });
    }
  }

  // Auto-derive departed players from OverTheCap dead-money list minus active/IR/PS roster!
  const activeKeySet = new Set(players.map(p => normalizePlayerKey(p.name)));
  const departedPlayers = [];
  const seenDep = new Set();
  for (const yrObj of Object.values(otcYears)) {
    for (const dm of yrObj?.topDeadMoneyEntries || []) {
      const nm = String(dm?.name || '').trim();
      const nk = normalizePlayerKey(nm);
      if (!nm || !nk || activeKeySet.has(nk) || seenDep.has(nk)) continue;
      seenDep.add(nk);
      departedPlayers.push(nm);
    }
  }

  // 5. Build Live Team Stats & League-Wide Positional Leaderboards + Per-Player `statProfile2026`
  const { teamStats, teamStatRankings } = buildTeamStatsForClub(team, leagueCtx);
  let positionalLeaderboards = {};
  let peerDirectory = {};
  if (nflCtx && nflCtx.statsPlayerCurrent?.length > 0) {
    const posRes = computeLeaguePositionalLeaderboards({
      statsPlayerCurrent: nflCtx.statsPlayerCurrent,
      statsPlayerWeek: nflCtx.statsPlayerWeekCurrent,
      ngsPass2026: nflCtx.ngsPass2026,
      ngsRec2026: nflCtx.ngsRec2026,
      ngsRush2026: nflCtx.ngsRush2026,
      pfrPass2026: nflCtx.pfrPass2026,
      pfrRush2026: nflCtx.pfrRush2026,
      pfrRec2026: nflCtx.pfrRec2026,
      pfrDef2026: nflCtx.pfrDef2026,
      qbr2026ByEspnId: nflCtx.qbr2026ByEspnId,
      qbr2026ByTeamName: nflCtx.qbr2026ByTeamName,
      maxPfrChartedWeek: nflCtx.maxChartedWeek || 0,
      snaps2026: nflCtx.snapsCurrent,
      nflPlayers: nflCtx.nflPlayers,
      rosterPlayers: players,
      teamStatsPayload: teamStats,
      seasonYear,
      teamAbbr: team.abbr
    });
    positionalLeaderboards = posRes.positionalLeaderboards || {};
    peerDirectory = posRes.peerDirectory || {};
    for (const p of players) {
      p.statProfile2026 = posRes.profilesBySfPlayerId.get(p.id) || null;
    }
  }

  // 6. Build Depth Chart from ESPN (AFTER players have final playProbabilityPct & fixing "Special Teams" regex!)
  const slotLabels = {
    qb: 'QB', rb: 'RB', fb: 'FB', wr1: 'WR (X)', wr2: 'WR (Z)', wr3: 'WR (Slot)', te: 'TE',
    lt: 'LT', lg: 'LG', c: 'C', rg: 'RG', rt: 'RT',
    lde: 'LDE', ldt: 'LDT', nt: 'NT', rdt: 'RDT', rde: 'RDE',
    wlb: 'WILL LB', mlb: 'MIKE LB', slb: 'SAM LB', lolb: 'LOLB', lilb: 'LILB', rilb: 'RILB', rolb: 'ROLB',
    nb: 'NICKEL CB', lcb: 'LCB', rcb: 'RCB', ss: 'SS', fs: 'FS',
    pk: 'PK', p: 'P', ls: 'LS', h: 'H', pr: 'PR', kr: 'KR'
  };
  const playersById = new Map(players.map(p => [String(p.id), p]));
  const playersByNormName = new Map(players.map(p => [normalizePlayerKey(p.name), p]));
  const depthUnits = [];
  for (const dc of espnDepthRaw?.depthchart || []) {
    const rows = [];
    for (const [slotKey, posObj] of Object.entries(dc.positions || {})) {
      const baselineChain = (posObj.athletes || [])
        .map(ath => {
          const matched = playersById.get(String(ath.id || '')) || playersByNormName.get(normalizePlayerKey(ath.displayName || ''));
          return matched ? { ath, matched } : null;
        })
        .filter(Boolean)
        .map(({ ath, matched }, idx) => {
          const probVal = matched.health?.playProbabilityPct ?? 95;
          const isAvailable =
            probVal >= 40 &&
            (matched.rosterBucket === 'active' ||
              Boolean(matched.health?.isIrReturnQuestionable) ||
              Boolean(matched.health?.isPracticeWindowOpen));
          return {
            playerId: matched.id,
            name: matched.name || ath.displayName,
            jersey: matched.jersey ?? null,
            headshotUrl: matched.headshotUrl || '',
            baselineRank: idx + 1,
            playProbabilityPct: probVal,
            statusBadge: matched.health?.playBadgeLabel || `${probVal}% • Full Go`,
            isAvailable
          };
        });
      if (baselineChain.length === 0) continue;
      const projectedActiveChain = [
        ...baselineChain.filter(x => x.isAvailable),
        ...baselineChain.filter(x => !x.isAvailable).map(x => ({ ...x, demotedDueToInjury: true }))
      ];
      rows.push({
        slotKey,
        slotLabel: slotLabels[slotKey] || posObj.position?.abbreviation || slotKey.toUpperCase(),
        baselineChain,
        projectedActiveChain,
        starterPromoted:
          baselineChain.length > 1 && projectedActiveChain[0]?.playerId !== baselineChain[0]?.playerId
      });
    }
    if (rows.length > 0) {
      const rawName = String(dc.name || 'Unit');
      const unitName = /special/i.test(rawName)
        ? 'Special Teams'
        : /\b(wr|te|offense|2rb|3wr|1te|2te|base\s*off)\b/i.test(rawName)
          ? `Offense (${rawName})`
          : /\b(4-3|3-4|defense|base\s*def|d)\b/i.test(rawName)
            ? `Defense (${rawName})`
            : rawName;
      depthUnits.push({ id: String(dc.id || rawName), unitName, rows });
    }
  }
  const depthPriority = u => {
    const n = (u.unitName || '').toLowerCase();
    if (n.includes('offense')) return 1;
    if (n.includes('defense')) return 2;
    if (n.includes('special')) return 3;
    return 4;
  };
  depthUnits.sort((a, b) => depthPriority(a) - depthPriority(b));

  // 7. Build Opponent Health (injuryReport + irReserve, filtering healthy fantasy recaps & reading prob.probabilityPct!)
  const oppInjuryReport = [];
  const oppIrReserve = [];
  const seenOppKeys = new Set();
  for (const inj of flattenEspnInjuriesList(oppInjRaw, oppCfg?.espnId || '')) {
    const nm = inj?.athlete?.displayName || inj?.athlete?.fullName || '';
    if (!nm) continue;
    const oppKey = canonicalInjuryPlayerKey(nm);
    if (seenOppKeys.has(oppKey)) continue;
    const pos = inj?.athlete?.position?.abbreviation || 'ATH';
    const rawOppStatus = String(inj?.status || '').trim();
    const rawOppInjType = String(inj?.details?.type || '').trim();
    const offRec = officialInj?.oppByKey?.get(oppKey) || null;
    const effectiveOppStatus = offRec?.gameStatus || rawOppStatus || '';
    const effectiveOppInj = offRec?.injuryType || rawOppInjType || '';
    const oppComment = cleanSensationalistText(
      pickMeaningfulInjuryComment(inj?.longComment, inj?.shortComment)
    );
    const isOppIr = /injured reserve|reserve|pup|nfi/i.test(rawOppStatus);
    const isOppHealthyBlurb =
      !isOppIr &&
      !offRec &&
      /^active$/i.test(effectiveOppStatus) &&
      (!effectiveOppInj || /^healthy$/i.test(effectiveOppInj));
    if (isOppHealthyBlurb) continue;

    seenOppKeys.add(oppKey);
    const oppPid = extractEspnAthleteId(inj);
    const headshot =
      inj?.athlete?.headshot?.href ||
      (oppPid ? `https://a.espncdn.com/i/headshots/nfl/players/full/${oppPid}.png` : '');

    const oppProb = computePlayerPlayProbability({
      name: nm,
      position: pos,
      gameStatus: effectiveOppStatus || (isOppIr ? 'Injured Reserve' : 'Questionable'),
      injuryType: effectiveOppInj || (isOppIr ? 'Reserve / IR' : 'Injury'),
      rosterBucket: isOppIr ? 'ir' : 'active',
      wed: offRec?.wed || '-',
      thu: offRec?.thu || '-',
      fri: offRec?.fri || '-',
      kickoffIso: nextUnplayed?.dateIso || '',
      beatNote: oppComment
    });

    const oppRow = {
      playerId: oppPid,
      name: nm,
      position: pos,
      headshotUrl: headshot,
      injuryType: effectiveOppInj || (isOppIr ? 'Reserve / IR' : 'Injury'),
      gameStatus: effectiveOppStatus || (isOppIr ? 'Injured Reserve' : 'Questionable'),
      wed: offRec?.wed || '-',
      thu: offRec?.thu || '-',
      fri: offRec?.fri || '-',
      playProbabilityPct: oppProb.probabilityPct,
      playBadgeLabel: oppProb.badgeLabel,
      beatComment: oppComment
    };
    if (isOppIr && !offRec) oppIrReserve.push(oppRow);
    else oppInjuryReport.push(oppRow);
  }
  // Also include any opponent official-report players missing from ESPN injuries
  if (officialInj?.oppByKey) {
    for (const [oppKey, offRec] of officialInj.oppByKey.entries()) {
      if (seenOppKeys.has(oppKey) || !offRec?.name) continue;
      seenOppKeys.add(oppKey);
      const oppProb = computePlayerPlayProbability({
        name: offRec.name,
        position: offRec.position || 'ATH',
        gameStatus: offRec.gameStatus || 'Questionable',
        injuryType: offRec.injuryType || 'Injury',
        rosterBucket: 'active',
        wed: offRec.wed || '-',
        thu: offRec.thu || '-',
        fri: offRec.fri || '-',
        kickoffIso: nextUnplayed?.dateIso || ''
      });
      oppInjuryReport.push({
        playerId: '',
        name: offRec.name,
        position: offRec.position || 'ATH',
        headshotUrl: '',
        injuryType: offRec.injuryType || 'Injury',
        gameStatus: offRec.gameStatus || 'Questionable',
        wed: offRec.wed || '-',
        thu: offRec.thu || '-',
        fri: offRec.fri || '-',
        playProbabilityPct: oppProb.probabilityPct,
        playBadgeLabel: oppProb.badgeLabel,
        beatComment: ''
      });
    }
  }

  // 8. Build Health JSON (practiceReport & irAndReserveTracker)
  const practiceReport = players
    .filter(
      p =>
        (p.rosterBucket === 'active' &&
          (p.health.isOnPracticeReport ||
            ['out', 'doubtful', 'questionable'].includes(String(p.health.status || '').toLowerCase()))) ||
        (p.rosterBucket === 'ir' &&
          (p.health.isIrReturnQuestionable || p.health.isPracticeWindowOpen) &&
          p.health.playProbabilityPct > 0)
    )
    .map(p => ({
      playerId: p.id,
      name: p.name,
      position: p.position,
      jersey: p.jersey,
      headshotUrl: p.headshotUrl,
      rosterBucket: p.rosterBucket,
      isIrReturnWindow: Boolean(p.rosterBucket === 'ir' && (p.health.isPracticeWindowOpen || p.health.isIrReturnQuestionable)),
      sustainedInLastGame: false,
      wed: p.health.wed || '-',
      thu: p.health.thu || '-',
      fri: p.health.fri || '-',
      injuryType: p.health.injuryType || 'Injury',
      gameStatus: p.health.status || 'Questionable',
      playProbabilityPct: p.health.playProbabilityPct,
      playBadgeLabel: p.health.playBadgeLabel,
      archetypeNote: p.health.archetypeNote || '',
      factors: p.health.factors || [],
      beatComment: p.health.longComment || p.health.shortComment || ''
    }));

  const irAndReserveTracker = players
    .filter(p => p.rosterBucket === 'ir' || p.rosterBucket === 'suspended')
    .map(p => ({
      playerId: p.id,
      name: p.name,
      position: p.position,
      jersey: p.jersey,
      headshotUrl: p.headshotUrl,
      injuryType: p.health.injuryType || 'Reserve / IR',
      status: p.health.status || (p.health.isSeasonEnding ? 'Season-Ending IR' : 'IR — Reserve'),
      isSeasonEnding: Boolean(p.health.isSeasonEnding),
      isPracticeWindowOpen: Boolean(p.health.isPracticeWindowOpen),
      isPracticeWindowExpected: false,
      wed: p.health.wed || '-',
      thu: p.health.thu || '-',
      fri: p.health.fri || '-',
      placedBeforeWeek: p.health.placedBeforeWeek ?? null,
      earliestEligibleWeek: p.health.earliestEligibleWeek ?? null,
      projectedReturnWeek:
        p.health.projectedReturnWeek || (p.health.isSeasonEnding ? 'Out for Season' : 'TBD (4-game min)'),
      byeWeekNote:
        p.health.byeWeekNote || (p.health.isSeasonEnding ? 'Season-ending IR' : '4-game NFL minimum requirement'),
      playProbabilityPct: p.health.playProbabilityPct ?? 0,
      playBadgeLabel: p.health.playBadgeLabel || (p.health.isSeasonEnding ? '0% • Out for Season' : '0% • IR'),
      beatNote: p.health.irBeatNote || ''
    }));

  // 9. Build News Raw Stream (ESPN News + ESPN Tx + Club RSS + Club Video RSS + RotoWire + Bluesky)
  const rawStream = [];
  const seenNewsUrls = new Set();
  const pushNewsItem = item => {
    const cleanUrl = sanitizeExternalUrl(item?.url || '', null);
    if (!cleanUrl || isPaywalledPublisher(cleanUrl) || seenNewsUrls.has(cleanUrl)) return;
    seenNewsUrls.add(cleanUrl);
    if (isOpposingTeamOnlyInjuryOrRosterStory(item, team)) return;
    const sig = scoreContentSignal(item.title || '', item.summary || item.fullText || '');
    if (sig.isClickbait) return;
    const pubIso = item.publishedAt || nowIso;
    const brk = classifyBreakingItem(item, Date.now(), { team, rosterPlayers: players });
    const cat = classifyNewsItemCategory(item);
    rawStream.push({
      ...item,
      url: cleanUrl,
      publishedAt: pubIso,
      isBreaking: brk.isBreaking,
      isInGameInjury: brk.isInGameInjury,
      breakingBadge: brk.breakingBadge,
      breakingPriority: brk.breakingPriority || 0,
      category: cat,
      signalScore: Math.max(70, sig.signalScore),
      fluffScore: sig.fluffScore,
      isClickbait: false
    });
  };

  // 9a. ESPN Team News (filter out multi-team league roundups & select best landscape wire photo)
  const teamTextRe = new RegExp(
    `\\b(?:${[team.nickname, team.city, ...(team.aliases || [])]
      .filter(Boolean)
      .map(s => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
      .join('|')})\\b`,
    'i'
  );
  const activeRosterNamesLower = players
    .filter(p => p.rosterBucket === 'active' || p.rosterBucket === 'ir')
    .map(p => String(p.name || '').trim().toLowerCase())
    .filter(n => n.length >= 6);

  for (const a of espnNewsRaw?.articles || []) {
    const url = a.links?.web?.href || '';
    const title = String(a.headline || '').trim();
    const summary = String(a.description || '').trim();
    if (!title || !url || a.premium) continue;
    const combinedLower = `${title} ${summary}`.toLowerCase();
    const hasTeamMention = teamTextRe.test(title) || teamTextRe.test(summary);
    const hasRosterMatch =
      hasTeamMention || activeRosterNamesLower.some(nm => combinedLower.includes(nm));
    const teamCats = (a.categories || []).filter(c => c?.type === 'team');
    if (teamCats.length >= 6 && !hasTeamMention && !activeRosterNamesLower.some(nm => title.toLowerCase().includes(nm))) {
      continue;
    }
    if (isOffTopicLeagueFiller({ url, title, summary, hasRosterMatch })) continue;
    if (!hasTeamMention && isOpposingTeamSubjectLead(title, {}, team)) continue;
    const byline = a.byline || 'ESPN NFL Nation';
    const rep = resolveReporterFromNameOrHandle(byline, team);
    const resolvedTrustTier = rep?.isOtherTeamBeat ? 3 : rep?.trustTier || 1;
    const selectedImageUrl = selectBestEspnArticleImage(a.images) || '';
    const selectedImageObj =
      (Array.isArray(a.images) ? a.images : []).find(im => {
        const u = String(im?.url || '').replace(/^http:\/\//i, 'https://').trim();
        return u && u === selectedImageUrl;
      }) || a.images?.[0] || null;
    const imageCaption = String(selectedImageObj?.caption || selectedImageObj?.alt || selectedImageObj?.name || '').trim();
    pushNewsItem({
      id: `${team.abbr.toLowerCase()}_espn_${a.dataSourceIdentifier || hashShort(url)}`,
      type: a.type === 'Media' ? 'video' : 'article',
      title,
      summary,
      imageUrl: selectedImageUrl,
      imageCaption,
      imageAlt: title,
      publishedAt: a.published || nowIso,
      url,
      outletId: rep?.outletId || `espn_${team.abbr.toLowerCase()}`,
      outletName: 'ESPN',
      reporterId: rep?.id || `espn_${team.abbr.toLowerCase()}`,
      reporterName: rep?.name || byline,
      author: rep?.name || byline,
      authorHandle: rep?.handle || '@ESPNNFL',
      authorProfileUrl: rep?.xUrl || `https://www.espn.com/nfl/team/_/name/${team.espnAbbr}/${team.otcSlug}`,
      trustTier: resolvedTrustTier,
      wireSource: 'espn_team_news'
    });
  }

  // Resolve authentic official club X handle from team reporters directory
  const officialClubRep = (reportersData?.reporters || []).find(
    r => r && (r.category === 'official' || /_official$/i.test(String(r.id || ''))) && r.handle
  );
  const officialClubHandle = officialClubRep?.handle || `@${team.nickname}`;

  // 9b. ESPN Team Transactions
  for (const tx of espnTxRaw?.transactions || []) {
    const desc = String(tx.description || '').trim();
    if (!desc || desc.length < 10) continue;
    const pubMs = tx.date ? Date.parse(tx.date) : 0;
    if (!pubMs || Date.now() - pubMs > 21 * 86_400_000) continue;
    const txHash = hashShort(`${tx.date}_${desc}`);
    const fullLine = `${team.nickname} roster move: ${desc}`;
    const td = formatTweetBodyForDisplay(fullLine, SHORT_TWEET_FULL_TEXT_LIMIT);
    pushNewsItem({
      id: `${team.abbr.toLowerCase()}_tx_${txHash}`,
      type: 'tweet',
      title: td.text,
      fullText: fullLine,
      isFullTweet: td.isFullTweet,
      summary: '',
      imageUrl: '',
      publishedAt: new Date(pubMs).toISOString(),
      url: `https://www.${team.clubDomain}/team/transactions/#tx-${txHash}`,
      outletId: `${team.slug}_official`,
      outletName: `${team.clubDomain} Official`,
      reporterId: `${team.slug}_official`,
      reporterName: `${team.fullName} Official`,
      author: `${team.fullName} Official`,
      authorHandle: officialClubHandle,
      authorProfileUrl: team.clubNewsUrl,
      trustTier: 1,
      wireSource: 'official_transactions'
    });
  }

  // 9c. Official Club News RSS
  for (const m of (clubNewsRssXml || '').matchAll(/<item\b[\s\S]*?<\/item>/gi)) {
    const b = m[0];
    const title = decodeXmlEntities((b.match(/<title>([\s\S]*?)<\/title>/i) || [])[1] || '');
    const summary = decodeXmlEntities((b.match(/<description>([\s\S]*?)<\/description>/i) || [])[1] || '').slice(0, 240);
    const link = decodeXmlEntities((b.match(/<link>([\s\S]*?)<\/link>/i) || [])[1] || '');
    const pubRaw = decodeXmlEntities((b.match(/<pubDate>([\s\S]*?)<\/pubDate>/i) || [])[1] || '');
    const img = ((b.match(/<media:content[^>]*url="([^"]+)"/i) || b.match(/<enclosure[^>]*url="([^"]+)"/i) || [])[1] || '').replace(/&amp;/g, '&');
    if (!title || !link) continue;
    const pubMs = pubRaw ? Date.parse(pubRaw) : Date.now();
    if (!Number.isFinite(pubMs) || Date.now() - pubMs > 14 * 86_400_000) continue;
    pushNewsItem({
      id: `${team.abbr.toLowerCase()}_rss_${hashShort(link)}`,
      type: 'article',
      title,
      summary,
      imageUrl: img,
      imageAlt: title,
      publishedAt: new Date(pubMs).toISOString(),
      url: link,
      outletId: `${team.slug}_official`,
      outletName: `${team.clubDomain} Official`,
      reporterId: `${team.slug}_official`,
      reporterName: `${team.clubDomain} Official`,
      author: `${team.clubDomain} Official`,
      authorHandle: officialClubHandle,
      authorProfileUrl: team.clubNewsUrl,
      trustTier: 1,
      wireSource: 'club_official_rss'
    });
  }

  // 9d. Official Club Video RSS
  for (const m of (clubVideoRssXml || '').matchAll(/<item\b[\s\S]*?<\/item>/gi)) {
    const b = m[0];
    const title = decodeXmlEntities((b.match(/<title>([\s\S]*?)<\/title>/i) || [])[1] || '');
    const summary = decodeXmlEntities((b.match(/<description>([\s\S]*?)<\/description>/i) || [])[1] || '').slice(0, 220);
    const link = decodeXmlEntities((b.match(/<link>([\s\S]*?)<\/link>/i) || [])[1] || '');
    const pubRaw = decodeXmlEntities((b.match(/<pubDate>([\s\S]*?)<\/pubDate>/i) || [])[1] || '');
    const img = ((b.match(/<media:thumbnail[^>]*url="([^"]+)"/i) || b.match(/<media:content[^>]*url="([^"]+\.(?:jpg|png|webp)[^"]*)"/i) || [])[1] || '').replace(/&amp;/g, '&');
    if (!title || !link) continue;
    const pubMs = pubRaw ? Date.parse(pubRaw) : Date.now();
    if (!Number.isFinite(pubMs) || Date.now() - pubMs > 21 * 86_400_000) continue;
    pushNewsItem({
      id: `${team.abbr.toLowerCase()}_vid_${hashShort(link)}`,
      type: 'video',
      title,
      summary,
      imageUrl: img,
      imageAlt: title,
      publishedAt: new Date(pubMs).toISOString(),
      url: link,
      externalVideoUrl: link,
      outletId: `${team.slug}_official`,
      outletName: `${team.clubDomain} Video`,
      reporterId: `${team.slug}_official`,
      reporterName: `${team.clubDomain} Video`,
      author: `${team.clubDomain} Video`,
      authorHandle: officialClubHandle,
      authorProfileUrl: team.clubNewsUrl,
      trustTier: 1,
      wireSource: 'club_video_rss'
    });
  }

  // 9e. Team-filtered RotoWire NFL RSS + Pro Football Rumors + ProFootballTalk + NFL Trade Rumors + YouTube Film/Highlights
  const teamMatchRe = new RegExp(`\\b(${team.keywordRules.requiredNicknames.join('|')})\\b`, 'i');
  const starterNamesForMedia = players
    .filter(p => p.rosterBucket === 'active' && (p.position === 'QB' || Number(p.primarySnapPct || 0) >= 65))
    .slice(0, 8)
    .map(p => String(p.name || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .filter(n => n.length >= 6);
  const teamOrStarRe =
    starterNamesForMedia.length > 0
      ? new RegExp(`\\b(${[...team.keywordRules.requiredNicknames, ...starterNamesForMedia].join('|')})\\b`, 'i')
      : teamMatchRe;

  // 9e-1. Pro Football Rumors team feed (100% team-scoped)
  for (const m of (pfrTeamRssXml || '').matchAll(/<item\b[\s\S]*?<\/item>/gi)) {
    const b = m[0];
    const title = decodeXmlEntities((b.match(/<title>([\s\S]*?)<\/title>/i) || [])[1] || '');
    const desc = decodeXmlEntities((b.match(/<description>([\s\S]*?)<\/description>/i) || [])[1] || '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    const link = decodeXmlEntities((b.match(/<link>([\s\S]*?)<\/link>/i) || [])[1] || '');
    const pubRaw = decodeXmlEntities((b.match(/<pubDate>([\s\S]*?)<\/pubDate>/i) || [])[1] || '');
    if (!title || !link || isOpposingTeamSubjectLead(`${title} ${desc}`, {}, team)) continue;
    const pubMs = pubRaw ? Date.parse(pubRaw) : Date.now();
    if (!Number.isFinite(pubMs) || Date.now() - pubMs > 14 * 86_400_000) continue;
    pushNewsItem({
      id: `${team.abbr.toLowerCase()}_pfr_${hashShort(link)}`,
      type: 'article',
      title,
      summary: desc.slice(0, 240),
      imageUrl: '',
      publishedAt: new Date(pubMs).toISOString(),
      url: link,
      outletId: 'pro_football_rumors',
      outletName: 'Pro Football Rumors',
      reporterId: 'pro_football_rumors',
      reporterName: 'Pro Football Rumors',
      author: 'Pro Football Rumors',
      authorHandle: '@pfrumors',
      authorProfileUrl: `https://www.profootballrumors.com/${team.otcSlug}`,
      trustTier: 2,
      wireSource: 'pfr_team_rss'
    });
  }

  // 9e-2. Stage-1 Shared ProFootballTalk & NFL Trade Rumors filtered strictly for this team
  for (const feedSpec of [
    {
      xml: leagueCtx.pftRssXml,
      prefix: 'pft',
      outletId: 'profootballtalk',
      outletName: 'ProFootballTalk',
      handle: '@ProFootballTalk',
      profileUrl: 'https://www.nbcsports.com/nfl/profootballtalk',
      trustTier: 2
    },
    {
      xml: leagueCtx.nfltrRssXml,
      prefix: 'nfltr',
      outletId: 'nfl_trade_rumors',
      outletName: 'NFL Trade Rumors',
      handle: '@nfltrade_rumors',
      profileUrl: 'https://nfltraderumors.co/',
      trustTier: 2
    }
  ]) {
    for (const m of (feedSpec.xml || '').matchAll(/<item\b[\s\S]*?<\/item>/gi)) {
      const b = m[0];
      const title = decodeXmlEntities((b.match(/<title>([\s\S]*?)<\/title>/i) || [])[1] || '');
      const desc = decodeXmlEntities((b.match(/<description>([\s\S]*?)<\/description>/i) || [])[1] || '')
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
      const link = decodeXmlEntities((b.match(/<link>([\s\S]*?)<\/link>/i) || [])[1] || '');
      const pubRaw = decodeXmlEntities((b.match(/<pubDate>([\s\S]*?)<\/pubDate>/i) || [])[1] || '');
      if (!title || !link || !teamMatchRe.test(`${title} ${desc}`)) continue;
      if (isOpposingTeamSubjectLead(title, {}, team)) continue;
      const pubMs = pubRaw ? Date.parse(pubRaw) : Date.now();
      if (!Number.isFinite(pubMs) || Date.now() - pubMs > 12 * 86_400_000) continue;
      const img = ((b.match(/<media:content[^>]*url="([^"]+)"/i) || b.match(/<enclosure[^>]*url="([^"]+)"/i) || [])[1] || '').replace(/&amp;/g, '&');
      pushNewsItem({
        id: `${team.abbr.toLowerCase()}_${feedSpec.prefix}_${hashShort(link)}`,
        type: 'article',
        title,
        summary: desc.slice(0, 240),
        imageUrl: img,
        imageAlt: title,
        publishedAt: new Date(pubMs).toISOString(),
        url: link,
        outletId: feedSpec.outletId,
        outletName: feedSpec.outletName,
        reporterId: feedSpec.outletId,
        reporterName: feedSpec.outletName,
        author: feedSpec.outletName,
        authorHandle: feedSpec.handle,
        authorProfileUrl: feedSpec.profileUrl,
        trustTier: feedSpec.trustTier,
        wireSource: `${feedSpec.prefix}_rss`
      });
    }
  }

  // 9e-3. Stage-1 Shared YouTube Atom Feeds (NFL Highlights, The QB School, Brett Kollmann) filtered per team
  for (const ytFeed of leagueCtx.youtubeFeeds || []) {
    for (const m of (ytFeed.xml || '').matchAll(/<entry\b[\s\S]*?<\/entry>/gi)) {
      const b = m[0];
      const videoId = (b.match(/<yt:videoId>([^<]+)<\/yt:videoId>/i) || [])[1]?.trim() || '';
      const title = decodeXmlEntities((b.match(/<title>([\s\S]*?)<\/title>/i) || [])[1] || '');
      const desc = decodeXmlEntities((b.match(/<media:description>([\s\S]*?)<\/media:description>/i) || [])[1] || '')
        .replace(/\s+/g, ' ')
        .trim();
      const pubRaw = (b.match(/<published>([^<]+)<\/published>/i) || [])[1]?.trim() || '';
      if (!videoId || !title || !teamOrStarRe.test(`${title} ${desc.slice(0, 220)}`)) continue;
      if (ytFeed.category !== 'film' && isOpposingTeamSubjectLead(title, {}, team)) continue;
      const pubMs = pubRaw ? Date.parse(pubRaw) : Date.now();
      const maxAgeDays = ytFeed.category === 'film' ? 60 : 21;
      if (!Number.isFinite(pubMs) || Date.now() - pubMs > maxAgeDays * 86_400_000) continue;
      const watchUrl = `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`;
      pushNewsItem({
        id: `${team.abbr.toLowerCase()}_yt_${videoId}`,
        type: 'video',
        category: ytFeed.category,
        videoId,
        embeddable: ytFeed.embeddable,
        title,
        summary: desc.slice(0, 220),
        imageUrl: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
        imageAlt: title,
        publishedAt: new Date(pubMs).toISOString(),
        url: watchUrl,
        externalVideoUrl: watchUrl,
        outletId: ytFeed.id,
        outletName: ytFeed.name,
        reporterId: ytFeed.id,
        reporterName: ytFeed.name,
        author: ytFeed.name,
        authorHandle: ytFeed.handle,
        authorProfileUrl: `https://www.youtube.com/${ytFeed.handle}`,
        trustTier: 1,
        wireSource: 'youtube_atom'
      });
    }
  }
  for (const m of (leagueCtx.rotowireXml || '').matchAll(/<item\b[\s\S]*?<\/item>/gi)) {
    const b = m[0];
    const title = decodeXmlEntities((b.match(/<title>([\s\S]*?)<\/title>/i) || [])[1] || '');
    const desc = decodeXmlEntities((b.match(/<description>([\s\S]*?)<\/description>/i) || [])[1] || '');
    const link = decodeXmlEntities((b.match(/<link>([\s\S]*?)<\/link>/i) || [])[1] || '');
    const pubRaw = decodeXmlEntities((b.match(/<pubDate>([\s\S]*?)<\/pubDate>/i) || [])[1] || '');
    if (!title || !link || !teamMatchRe.test(`${title} ${desc}`)) continue;
    if (isOpposingTeamSubjectLead(`${title} ${desc}`, {}, team)) continue;
    const pubMs = pubRaw ? Date.parse(pubRaw) : Date.now();
    if (!Number.isFinite(pubMs) || Date.now() - pubMs > 10 * 86_400_000) continue;
    const td = formatTweetBodyForDisplay(`${title}: ${desc}`, SHORT_TWEET_FULL_TEXT_LIMIT);
    pushNewsItem({
      id: `${team.abbr.toLowerCase()}_roto_${hashShort(link)}`,
      type: 'tweet',
      title: td.text,
      fullText: `${title}: ${desc}`,
      isFullTweet: td.isFullTweet,
      summary: desc.slice(0, 220),
      imageUrl: '',
      publishedAt: new Date(pubMs).toISOString(),
      url: link,
      outletId: 'rotowire',
      outletName: 'RotoWire NFL Beat',
      reporterId: 'rotowire_nfl_beat',
      reporterName: 'RotoWire NFL Beat',
      author: 'RotoWire NFL Beat',
      authorHandle: '@RotoWireNFL',
      authorProfileUrl: 'https://www.rotowire.com/football/news.php',
      trustTier: 2,
      wireSource: 'rotowire_rss'
    });
  }

  // 9f. Verified Bluesky Beat Posts
  for (const bp of bskyPosts) pushNewsItem(bp);

  // 10. Live Power Rankings (teamStats & teamStatRankings already built in Step 5)
  let previousPowerRankings = null;
  try {
    const existingSmPath = path.join(ROOT, 'data', 'teams', team.slug, 'schedule-matchup.json');
    if (fs.existsSync(existingSmPath)) {
      previousPowerRankings = JSON.parse(fs.readFileSync(existingSmPath, 'utf8'))?.powerRankings || null;
    }
  } catch {
    previousPowerRankings = null;
  }
  const powerRankings = await fetchLivePowerRankings({
    teamAbbr: team.abbr,
    seasonYear,
    currentWeek,
    schedule,
    sfRecord: teamStanding.record,
    oppShortName: nextUnplayed?.opponent?.shortName || nextUnplayed?.opponent?.abbr || null,
    previousPowerRankings,
    sharedPayloads: leagueCtx.powerRankingsPayloads || null
  }).catch(() => ({ consensusRank: null, sources: [], allSources: [], summary: '' }));

  // 11. Playoff Monte Carlo (NFC for Lions, AFC for Bills!)
  const playoffPicture = buildConferencePlayoffPicture(team, leagueCtx);

  // 12. Assemble Meta, Schedule-Matchup, Cap, Seasonal, News & Reconcile Health
  const divPeerAbbrs = [team.abbr, ...(team.divisionRivals || [])];
  const divSorted = divPeerAbbrs
    .map(a => ({ abbr: a, ...(leagueCtx.standingsByAbbr.get(a) || { winPct: 0, wins: 0, pd: 0 }) }))
    .sort((a, b) => b.winPct - a.winPct || b.wins - a.wins || b.pd - a.pd);
  const divOrd = ['1st', '2nd', '3rd', '4th'][Math.max(0, divSorted.findIndex(x => x.abbr === team.abbr))] || '1st';
  const standingSummary = `${divOrd} in ${team.division} • #${teamStanding.seed} Seed in ${team.conference}`;

  const coaches = team.coachesSeed || { hc: `${team.nickname} Head Coach`, oc: 'Offensive Coordinator', dc: 'Defensive Coordinator', gm: 'General Manager' };

  const meta = {
    updatedAt: nowIso,
    teamAbbr: team.abbr,
    teamSlug: team.slug,
    brandName: team.brandName,
    seasonYear,
    currentWeek,
    teamRecord: teamStanding.record,
    divisionRecord: teamStanding.divRec,
    conferenceRecord: teamStanding.confRec,
    standingSummary,
    pointDifferential: `${teamStanding.pd >= 0 ? '+' : ''}${teamStanding.pd} (${teamStanding.pf} PF / ${teamStanding.pa} PA)`,
    byeWeek,
    coaches,
    calendar: buildNflCalendarForSeasonYear(seasonYear),
    teamStatus: {
      inPlayoffHunt: (playoffPicture.baselineSimulation?.teamOdds?.makePlayoffsPct ?? 50) > 0,
      playoffSeed: teamStanding.seed,
      seasonConcluded: false
    },
    aiEngine: {
      activeModel: PRIMARY_GEMINI_REASONING_MODEL,
      thinkingLevel: 'XHIGH',
      quotaOwner: 'joshalbox@gmail.com'
    }
  };

  const kickoffDate = nextUnplayed?.dateIso ? new Date(nextUnplayed.dateIso) : null;
  const kickoffDisplay = kickoffDate
    ? kickoffDate.toLocaleString('en-US', {
        timeZone: team.timezone,
        weekday: 'short',
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
        timeZoneName: 'short'
      })
    : 'TBD';

  const featuredPlayers = players
    .filter(p => p.rosterBucket === 'active' && (p.primarySnapPct >= 40 || p.stats2026))
    .sort((a, b) => {
      const score = p => {
        const s = p.stats2026;
        const prod =
          (s?.passing?.yards || 0) * 0.08 +
          (s?.rushing?.yards || 0) * 0.35 +
          (s?.receiving?.yards || 0) * 0.35 +
          ((s?.passing?.tds || 0) + (s?.rushing?.tds || 0) + (s?.receiving?.tds || 0)) * 22 +
          (s?.defense?.sacks || 0) * 28 +
          (s?.defense?.ints || 0) * 35 +
          (s?.defense?.totalTackles || 0) * 1.8;
        return prod + (p.primarySnapPct || 0) * 0.5;
      };
      return score(b) - score(a);
    })
    .slice(0, 6)
    .map(p => ({
      playerId: p.id,
      name: p.name,
      position: p.position,
      jersey: p.jersey,
      headshotUrl: p.headshotUrl,
      primarySnapPct: p.primarySnapPct,
      playProbabilityPct: p.health?.playProbabilityPct ?? 95
    }));

  const h2hNext = buildFranchiseHeadToHeadHistory(
    nflCtx?.gamesRows || [],
    team.abbr,
    nextUnplayed?.opponent?.abbr || '',
    {
      maxGames: 8,
      teamNickname: team.nickname,
      oppShortName: nextUnplayed?.opponent?.shortName || '',
      scheduleGames: schedule
    }
  );
  const h2hByOpponent = buildScheduleH2hByOpponentMap(
    nflCtx?.gamesRows || [],
    team.abbr,
    schedule,
    {
      maxGames: 8,
      teamNickname: team.nickname
    }
  );

  const upcomingMatchup = {
    week: nextUnplayed?.week || currentWeek,
    gameId: nextUnplayed?.id || '',
    homeAway: nextUnplayed?.homeAway || 'home',
    gameUrl: nextUnplayed?.gameUrl || `https://www.espn.com/nfl/team/schedule/_/name/${team.espnAbbr}/${team.otcSlug}`,
    injurySourceUrl: oppCfg ? buildCbsTeamInjuriesUrl(oppCfg.abbr, oppCfg.fullName) : 'https://www.espn.com/nfl/injuries',
    sfInjuryReportUrl: team.clubInjuryUrl,
    statsSourceUrl: `https://www.espn.com/nfl/team/stats/_/name/${team.espnAbbr}/${team.otcSlug}`,
    dateIso: nextUnplayed?.dateIso || null,
    kickoffIso: nextUnplayed?.dateIso || null,
    kickoffDisplay,
    broadcast: nextUnplayed?.broadcast || 'NFL TV',
    venue: nextUnplayed?.venue || { name: team.stadium, city: team.city, state: '', country: 'USA' },
    sfRecord: teamStanding.record,
    sfLogoUrl: teamLogoUrl,
    oppAbbr: nextUnplayed?.opponent?.abbr || 'TBD',
    oppName: nextUnplayed?.opponent?.name || 'Opponent',
    oppLogoUrl: nextUnplayed?.opponent?.logoUrl || '',
    oppRecord: nextUnplayed?.opponent?.record || '—',
    completed: Boolean(nextUnplayed?.completed),
    sfScore: nextUnplayed?.sfScore ?? null,
    oppScore: nextUnplayed?.oppScore ?? null,
    statusDetail: nextUnplayed?.statusDetail || '',
    featuredPlayers,
    opponentHealth: {
      sourceUrl: oppCfg ? oppCfg.clubInjuryUrl : 'https://www.espn.com/nfl/injuries',
      injuryReport: oppInjuryReport,
      irReserve: oppIrReserve
    },
    betting: {
      spread: 'Check ESPN Gamecast',
      overUnder: 'TBD',
      impliedWinProb: '50%'
    },
    franchiseHistory: {
      ...h2hNext,
      byOpponent: h2hByOpponent
    },
    coachingMatchup: buildDeterministicCoachingMatchup({
      team,
      metaCoaches: coaches,
      week: nextUnplayed?.week || currentWeek,
      oppAbbr: nextUnplayed?.opponent?.abbr || '',
      oppName: nextUnplayed?.opponent?.name || 'Opponent',
      oppRecord: nextUnplayed?.opponent?.record || '',
      homeAway: nextUnplayed?.homeAway || 'home'
    }),
    keyMatchupsMatrix: []
  };

  const cap26 = otcYears[String(seasonYear)] || { teamCapSpace: 0, deadMoneyTotal: 0 };
  const cap27 = otcYears[String(seasonYear + 1)] || { teamCapSpace: 0, deadMoneyTotal: 0 };
  const seasonYearKey = String(seasonYear);
  const capPlayers = players
    .filter(p => Object.keys(p.contractsByYear || {}).length > 0)
    .map(p => {
      const cleanedContractsByYear = { ...(p.contractsByYear || {}) };
      if (p.rosterBucket !== 'active' && cleanedContractsByYear[seasonYearKey]) {
        delete cleanedContractsByYear[seasonYearKey];
      }
      return {
        id: p.id,
        otcId: p.otcId,
        otcSlug: p.otcSlug,
        otcUrl: p.otcUrl,
        espnUrl: p.espnUrl,
        pfrUrl: p.pfrUrl,
        name: p.name,
        position: p.position,
        jersey: p.jersey,
        headshotUrl: p.headshotUrl,
        unit: p.unit,
        rosterBucket: p.rosterBucket,
        contractsByYear: cleanedContractsByYear
      };
    })
    .filter(p => Object.keys(p.contractsByYear || {}).length > 0)
    .sort((a, b) => {
      const capA = a.contractsByYear?.[seasonYearKey]?.capNumber || 0;
      const capB = b.contractsByYear?.[seasonYearKey]?.capNumber || 0;
      if (capB !== capA) return capB - capA;
      const maxA = Math.max(0, ...Object.values(a.contractsByYear || {}).map(y => y?.capNumber || 0));
      const maxB = Math.max(0, ...Object.values(b.contractsByYear || {}).map(y => y?.capNumber || 0));
      return maxB - maxA;
    });
  for (const [yrKey, yrSummary] of Object.entries(otcYears || {})) {
    if (yrSummary) {
      yrSummary.contractedCount = capPlayers.filter(p => Boolean(p.contractsByYear?.[yrKey])).length;
    }
  }

  const capJson = {
    updatedAt: nowIso,
    source: 'OverTheCap Live',
    sourceUrl: `https://overthecap.com/salary-cap/${team.otcSlug}`,
    spotracUrl: `https://www.spotrac.com/nfl/${team.otcSlug}/cap/`,
    nflpaUrl: 'https://nflpa.com/reports/public-salary-cap-report',
    years: otcYears,
    blueprint: {
      summary: `${team.fullName} hold $${(Number(cap26.teamCapSpace || 0) / 1e6).toFixed(2)}M in ${seasonYear} OverTheCap space and $${(Number(cap27.teamCapSpace || 0) / 1e6).toFixed(2)}M projected for ${seasonYear + 1}.`
    },
    players: capPlayers
  };

  // Build authentic seasonYear Draft Class & Priority UDFAs (using nflverse draft_picks.csv + roster spiderProfiles!)
  const playersByPfr = new Map(players.filter(p => p.pfrId).map(p => [p.pfrId, p]));
  const playersByGsis = new Map(players.filter(p => p.gsisId).map(p => [p.gsisId, p]));
  const playersByNflName = new Map(players.map(p => [normPlayerName(p.name), p]));
  const draftPicksFinal = [];
  const draftedRosterIds = new Set();

  const buildDraftStrengths = (sp, p) => {
    const out = [];
    if (sp?.compositeRas != null) {
      out.push(
        `Athletic Profile: ${Number(sp.compositeRas).toFixed(2)} RAS (${sp.sourceType || 'Combine'})`
      );
    }
    const topAxes = (sp?.axes || [])
      .filter(a => a && a.isCombineVerified && Number(a.percentile) >= 75)
      .sort((a, b) => b.percentile - a.percentile)
      .slice(0, 2);
    if (topAxes.length > 0) {
      out.push(
        `Standout measurables: ${topAxes.map(a => `${a.label} ${a.displayValue} (${a.percentile}th %ile)`).join(' · ')}`
      );
    }
    if (p?.primarySnapPct > 0) {
      out.push(`2026 Usage: ${p.primarySnapPct}% primary snap share across ${p.snapSummary?.gamesLogged || 0} games.`);
    }
    if (out.length === 0) {
      out.push(
        `${p?.displayHeight || ''} ${p?.displayWeight || ''}`.trim() ||
          `${seasonYear} draft selection for ${team.fullName}.`
      );
    }
    return out;
  };

  for (const dp of teamDraftPicks) {
    const matched =
      (dp.pfrId && playersByPfr.get(dp.pfrId)) ||
      (dp.gsisId && playersByGsis.get(dp.gsisId)) ||
      playersByNflName.get(normPlayerName(dp.name)) ||
      null;
    if (matched) draftedRosterIds.add(matched.id);

    const sp =
      matched?.spiderProfile ||
      (nflCtx?.buildPlayerSpiderProfile
        ? nflCtx.buildPlayerSpiderProfile({
            name: dp.name,
            pfrId: dp.pfrId,
            position: dp.position,
            heightIn: null,
            weightLb: null
          })
        : null);

    const otc4Yr = matched
      ? Object.values(matched.contractsByYear || {})
          .slice(0, 4)
          .reduce((sum, yr) => sum + Number(yr?.capNumber || 0), 0)
      : 0;
    const est4Yr = otc4Yr > 1_000_000 ? otc4Yr : estimate4YrRookieContractByPick(dp.pick);
    const statusText = matched
      ? matched.rosterBucket === 'active'
        ? 'Active 53'
        : matched.rosterBucket === 'ir'
          ? 'Injured Reserve'
          : 'Practice Squad'
      : 'Drafted';
    const roleSummary = matched
      ? `${statusText} • ${matched.displayHeight || ''} ${matched.displayWeight || ''}${matched.primarySnapPct > 0 ? ` • ${matched.primarySnapPct}% 2026 snaps` : ''}`.replace(/\s+/g, ' ').trim()
      : `${seasonYear} Round ${dp.round}, Pick #${dp.pick} selection from ${dp.college || 'College'}.`;

    draftPicksFinal.push({
      playerId: matched?.id || null,
      name: matched?.name || dp.name,
      position: matched?.position || dp.position,
      college: matched?.college || dp.college || 'College',
      round: dp.round,
      pick: dp.pick,
      overallPick: dp.pick,
      jersey: matched?.jersey ?? null,
      headshotUrl: matched?.headshotUrl || '',
      espnUrl: matched?.espnUrl || null,
      pfrUrl:
        matched?.pfrUrl ||
        (dp.pfrId
          ? `https://www.pro-football-reference.com/players/${dp.pfrId[0].toUpperCase()}/${dp.pfrId}.htm`
          : `https://www.pro-football-reference.com/search/search.fcgi?search=${encodeURIComponent(dp.name)}`),
      consensusBigBoardRank: dp.pick,
      stealDelta: 0,
      estimated4YrRookieTotal: est4Yr,
      status: statusText,
      roleSummary,
      strengths: buildDraftStrengths(sp, matched),
      spiderProfile: sp
    });
  }

  // Fallback if draft_picks.csv hasn't published seasonYear yet: extract from roster players with verified seasonYear draftInfo
  if (draftPicksFinal.length === 0) {
    for (const p of players) {
      const m = String(p.draftInfo || '').match(new RegExp(`^${seasonYear}\\s*•\\s*Rd\\s*(\\d+),\\s*Pick\\s*#(\\d+)`));
      if (!m) continue;
      draftedRosterIds.add(p.id);
      const rd = Number(m[1]);
      const pk = Number(m[2]);
      const otc4Yr = Object.values(p.contractsByYear || {})
        .slice(0, 4)
        .reduce((sum, yr) => sum + Number(yr?.capNumber || 0), 0);
      draftPicksFinal.push({
        playerId: p.id,
        name: p.name,
        position: p.position,
        college: p.college || 'College',
        round: rd,
        pick: pk,
        overallPick: pk,
        jersey: p.jersey ?? null,
        headshotUrl: p.headshotUrl,
        espnUrl: p.espnUrl,
        pfrUrl: p.pfrUrl,
        consensusBigBoardRank: pk,
        stealDelta: 0,
        estimated4YrRookieTotal: otc4Yr > 1_000_000 ? otc4Yr : estimate4YrRookieContractByPick(pk),
        status: p.rosterBucket === 'active' ? 'Active 53' : p.rosterBucket.toUpperCase(),
        roleSummary: `${p.rosterBucket === 'active' ? 'Active 53' : p.rosterBucket.toUpperCase()} • ${p.displayHeight} ${p.displayWeight}`.trim(),
        strengths: buildDraftStrengths(p.spiderProfile, p),
        spiderProfile: p.spiderProfile
      });
    }
    draftPicksFinal.sort((a, b) => a.pick - b.pick);
  }

  const priorityUdfasFinal = players
    .filter(p => p.experienceYears === 0 && !draftedRosterIds.has(p.id))
    .slice(0, 14)
    .map(p => ({
      playerId: p.id,
      displayName: p.name,
      name: p.name,
      position: p.position,
      college: p.college || 'College',
      jersey: p.jersey ?? null,
      headshotUrl: p.headshotUrl,
      espnUrl: p.espnUrl,
      otcUrl: p.otcUrl,
      status: p.rosterBucket === 'active' ? 'Active 53' : p.rosterBucket.toUpperCase(),
      roleSummary: `${p.rosterBucket === 'active' ? 'Active 53' : p.rosterBucket.toUpperCase()} • ${p.displayHeight} ${p.displayWeight}${p.primarySnapPct > 0 ? ` • ${p.primarySnapPct}% 2026 snaps` : ''}`.trim(),
      summary: `${p.draftInfo} • ${p.displayHeight} ${p.displayWeight}`.trim(),
      spiderProfile: p.spiderProfile
    }));

  const tankathonPicks = parseTankathonTeamPicksHtml(tankathonHtml || '', team.abbr);
  const tradeIntel = buildTeamTradeWindow({
    team,
    seasonYear,
    currentWeek,
    nowIso,
    cap26,
    cap27,
    players,
    health: { practiceReport, irAndReserveTracker },
    teamStatRankings,
    espnTransactions: espnTxRaw?.transactions || [],
    clubTransactionsHtml: clubTransactionsHtml || '',
    tankathonPicks,
    rawStream,
    leagueTradeCtx: leagueCtx.leagueTradeCtx || null
  });

  const draftPrep2027 = buildTeamDraftPrep2027({
    team,
    draftYear: seasonYear + 1,
    teamStanding,
    tankathonTeamHtml: tankathonHtml || '',
    mddbTeamHtml: mddbTeamHtml || '',
    leagueMockHtmls: leagueCtx.leagueMockHtmls || {},
    sharedBigBoard: leagueCtx.sharedBigBoard || [],
    sharedBigBoardMeta: leagueCtx.sharedBigBoardMeta,
    sharedBigBoardMethodology: leagueCtx.sharedBigBoardMethodology,
    sharedCombineLeaderboard: leagueCtx.sharedCombineLeaderboard,
    players,
    capPlayers: players,
    nowIso
  });

  const outDir = path.join(ROOT, 'data', 'teams', team.slug);
  let existingSeasonalDraftClass = null;
  try {
    const existingSeasonalPath = path.join(outDir, 'seasonal.json');
    if (fs.existsSync(existingSeasonalPath)) {
      existingSeasonalDraftClass = JSON.parse(fs.readFileSync(existingSeasonalPath, 'utf8'))?.draftClass2026 || null;
    }
  } catch {}
  const draftClass2026Obj = {
    draftYear: seasonYear,
    sourceUrl: `https://www.pro-football-reference.com/teams/${team.pfrAbbr}/${seasonYear}_draft.htm`,
    otcDraftUrl: `https://overthecap.com/salary-cap/${team.otcSlug}`,
    picks: draftPicksFinal,
    priorityUdfas: priorityUdfasFinal
  };
  if (!process.argv.includes('--skip-draft-videos')) {
    try {
      await attachDraftClassHighlightVideos(draftClass2026Obj, team, {
        existingDraftClass: existingSeasonalDraftClass
      });
    } catch {}
  }

  const seasonalJson = {
    updatedAt: nowIso,
    tradeWarRoom: tradeIntel.tradeWarRoom,
    playoffPicture,
    draftPrep2027,
    draftClass2026: draftClass2026Obj
  };

  const usedIrDesignations = Number(teamTxAnalysis?.regularSeasonIrDesignationsCount || 0);
  const healthJson = {
    updatedAt: nowIso,
    week: currentWeek,
    byeWeek,
    sourceUrl: team.clubInjuryUrl,
    espnInjuryUrl: `https://www.espn.com/nfl/team/injuries/_/name/${team.espnAbbr}/${team.otcSlug}`,
    usedIrDesignations,
    remainingIrDesignations: Math.max(0, 8 - usedIrDesignations),
    maxRegularSeasonIrDesignations: 8,
    gameDayRoster: null,
    practiceReport,
    irAndReserveTracker
  };

  const rosterJson = {
    updatedAt: nowIso,
    count: players.length,
    excludedGhostIds,
    departedPlayers,
    positionalLeaderboards,
    peerDirectory,
    players
  };

  const depthChartJson = {
    updatedAt: nowIso,
    week: currentWeek,
    units: depthUnits
  };

  const scheduleMatchupJson = {
    updatedAt: nowIso,
    sources: [
      { label: `ESPN ${team.nickname} Schedule`, url: `https://www.espn.com/nfl/team/schedule/_/name/${team.espnAbbr}/${team.otcSlug}` },
      { label: `${team.clubDomain}`, url: team.clubNewsUrl }
    ],
    schedule,
    lastCompletedGameRecap: null,
    teamStats,
    teamStatRankings,
    powerRankings,
    upcomingMatchup
  };

  const tempAppData = {
    meta,
    roster: rosterJson,
    depthChart: depthChartJson,
    cap: capJson,
    health: healthJson,
    reporters: reportersData,
    scheduleMatchup: scheduleMatchupJson,
    seasonal: seasonalJson,
    news: { updatedAt: nowIso, dailyTopNewsBrief: null, clusteredBriefs: [], rawStream }
  };

  tempAppData.news.rawStream = sortNewsWithBreakingPriority(rawStream, Date.now(), { appData: tempAppData });
  reconcileRosterAndHealthWithNews(tempAppData);

  // Reuse an already-generated live Gemini brief for the exact same cycleKey so hourly refreshes spend 0 extra API calls!
  let existingBrief = null;
  try {
    const existingNewsPath = path.join(outDir, 'news.json');
    if (fs.existsSync(existingNewsPath)) {
      const prev = JSON.parse(fs.readFileSync(existingNewsPath, 'utf8'));
      existingBrief = prev?.dailyTopNewsBrief || null;
    }
  } catch {}
  if (!existingBrief && process.env.CI) {
    try {
      const livePrev = await fetchJsonSafe(`https://${team.domain}/data/teams/${team.slug}/news.json`, 4500);
      existingBrief = livePrev?.dailyTopNewsBrief || null;
    } catch {}
  }

  tempAppData.news.dailyTopNewsBrief = await generateGroundedDailyBrief(team, tempAppData, geminiApiKey, {
    existingBrief,
    forceBrief: process.argv.includes('--force-brief')
  });

  const podcastIndexJson = {
    updatedAt: nowIso,
    episodes: [],
    sharedAnalyses: []
  };

  // Write all 11 JSON files under `data/teams/{slug}/`
  fs.mkdirSync(path.join(outDir, 'podcasts'), { recursive: true });
  fs.writeFileSync(path.join(outDir, 'meta.json'), JSON.stringify(meta, null, 2));
  fs.writeFileSync(path.join(outDir, 'roster.json'), JSON.stringify(rosterJson, null, 2));
  fs.writeFileSync(path.join(outDir, 'depth-chart.json'), JSON.stringify(depthChartJson, null, 2));
  fs.writeFileSync(path.join(outDir, 'cap.json'), JSON.stringify(capJson, null, 2));
  fs.writeFileSync(path.join(outDir, 'health.json'), JSON.stringify(healthJson, null, 2));
  fs.writeFileSync(path.join(outDir, 'news.json'), JSON.stringify(tempAppData.news, null, 2));
  fs.writeFileSync(path.join(outDir, 'schedule-matchup.json'), JSON.stringify(scheduleMatchupJson, null, 2));
  fs.writeFileSync(path.join(outDir, 'seasonal.json'), JSON.stringify(seasonalJson, null, 2));
  fs.writeFileSync(path.join(outDir, 'reporters.json'), JSON.stringify(reportersData, null, 2));
  fs.writeFileSync(path.join(outDir, 'beat-podcasts.json'), JSON.stringify(beatPodcasts, null, 2));
  fs.writeFileSync(path.join(outDir, 'podcasts', 'index.json'), JSON.stringify(podcastIndexJson, null, 2));

  console.log(
    `[stage-2] Done ${team.abbr} (${team.slug}): record=${meta.teamRecord}, roster=${players.length}, capPlayers=${capPlayers.length}, departed=${departedPlayers.length}, power=${powerRankings.sources?.length || 0}/${powerRankings.allSources?.length || 0} (#${powerRankings.consensusRank ?? '—'}), news=${tempAppData.news.rawStream.length}, brief=${tempAppData.news.dailyTopNewsBrief?.source} (${tempAppData.news.dailyTopNewsBrief?.modelUsed}), pods7d=${beatPodcasts.totalEpisodes}, playoffOdds=${playoffPicture.baselineSimulation?.teamOdds?.makePlayoffsPct}%`
  );
}

async function refreshPowerRankingsOnlyForTeams(teams, seasonYear = 2026) {
  const sampleMeta = teams
    .map(t => {
      const p = path.join(ROOT, 'data', 'teams', t.slug, 'meta.json');
      try {
        return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : null;
      } catch {
        return null;
      }
    })
    .filter(Boolean);
  const probeWeek = Math.max(1, ...sampleMeta.map(m => Number(m.currentWeek) || 1));
  console.log(`[power-rankings-only] Fetching 6 league-wide power rankings sources once (season=${seasonYear}, week~${probeWeek})...`);
  const sharedPayloads = await fetchLeaguePowerRankingsPayloads({
    seasonYear,
    currentWeek: probeWeek
  });
  const okCount = [
    sharedPayloads.inpredictableHtml,
    sharedPayloads.nfeloHtml,
    sharedPayloads.rbsdmRatingsJson,
    sharedPayloads.cbsHtml,
    sharedPayloads.espnFpiJson,
    sharedPayloads.espnPanelRaw
  ].filter(Boolean).length;
  console.log(`[power-rankings-only] Loaded ${okCount}/6 live upstream league feeds.`);

  const nowMs = Date.now();
  for (const team of teams) {
    const outDir = path.join(ROOT, 'data', 'teams', team.slug);
    const smPath = path.join(outDir, 'schedule-matchup.json');
    const metaPath = path.join(outDir, 'meta.json');
    if (!fs.existsSync(smPath)) {
      console.warn(`[power-rankings-only] Skipping ${team.abbr}: missing ${smPath}`);
      continue;
    }
    const sm = JSON.parse(fs.readFileSync(smPath, 'utf8'));
    const meta = fs.existsSync(metaPath) ? JSON.parse(fs.readFileSync(metaPath, 'utf8')) : {};
    const oppFull = sm?.upcomingMatchup?.oppName || '';
    const oppShort = oppFull ? oppFull.trim().split(/\s+/).pop() : null;
    setActiveTeamConfig(team);
    const powerRankings = await fetchLivePowerRankings({
      teamAbbr: team.abbr,
      seasonYear: Number(meta.seasonYear) || seasonYear,
      currentWeek: Number(meta.currentWeek) || probeWeek,
      schedule: sm.schedule || [],
      sfRecord: meta.teamRecord || null,
      oppShortName: oppShort,
      sharedPayloads,
      nowMs
    });
    sm.powerRankings = powerRankings;
    fs.writeFileSync(smPath, JSON.stringify(sm, null, 2));
    console.log(
      `[power-rankings-only] ${team.abbr.padEnd(3)} (${team.slug.padEnd(10)}): ${powerRankings.sources?.length || 0}/${powerRankings.allSources?.length || 0} active | #${powerRankings.consensusRank ?? '—'} (${powerRankings.rangeShort || '—'}) | ${powerRankings.weekLabel || 'N/A'}`
    );
  }
}

async function main() {
  const args = process.argv.slice(2);
  const runAll = args.includes('--all');
  const missingOnly = args.includes('--missing-only');
  const powerRankingsOnly = args.includes('--power-rankings-only');
  const teamsArg = args.find(a => a.startsWith('--teams=')) || args.find(a => a.startsWith('--team='));
  let teams = [];
  if (runAll) {
    teams = ALL_NFL_TEAMS.filter(t => t.abbr !== 'SF');
  } else if (teamsArg) {
    const rawList = teamsArg.replace(/^--teams?=/, '').split(',').map(s => s.trim()).filter(Boolean);
    teams = rawList.map(resolveTeamConfig).filter(t => t && t.abbr !== 'SF');
  } else {
    teams = ALL_NFL_TEAMS.filter(t => t.abbr !== 'SF');
  }
  if (missingOnly) {
    teams = teams.filter(t => !fs.existsSync(path.join(ROOT, 'data', 'teams', t.slug, 'meta.json')));
  }
  if (teams.length === 0) {
    console.log('[stage-2] All target teams already built (0 remaining).');
    return;
  }

  if (powerRankingsOnly) {
    await refreshPowerRankingsOnlyForTeams(teams, 2026);
    return;
  }

  const leagueCtx = await loadSharedLeagueContext(2026);
  const geminiApiKey = String(process.env.GEMINI_NFL_API_KEY || '').trim();
  const failures = [];

  for (let i = 0; i < teams.length; i += 1) {
    const t = teams[i];
    try {
      await buildTeamBundle(t, leagueCtx, { geminiApiKey });
    } catch (err) {
      console.error(`[stage-2] ERROR building ${t.abbr} (${t.slug}):`, err?.message || err);
      failures.push({ abbr: t.abbr, slug: t.slug, error: err?.message || String(err) });
    }
    if (i < teams.length - 1) await sleep(850);
  }
  if (failures.length > 0) {
    console.error(`[stage-2] Completed with ${failures.length} failures:`, JSON.stringify(failures));
    process.exit(1);
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
