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
  CANARY_TEAM_SLUGS,
  NFL_DIVISIONS,
  getTeamByAbbr,
  normalizeAnyTeamAbbr,
  resolveTeamConfig,
  setActiveTeamConfig
} from '../src/config/teamRegistry.js';
import { parseOverTheCapHtml } from './lib/otcParser.mjs';
import {
  buildCbsTeamInjuriesUrl,
  parseCbsTeamInjuriesHtml,
  parseOfficial49ersRosterHtml
} from './lib/liveHealthAndRosterResolver.mjs';
import { fetchLivePowerRankings } from './lib/powerRankingsFetcher.mjs';
import {
  computeCalibratedTeamPowerRating,
  computeRootingGuideLeverage,
  runPlayoffMonteCarlo
} from '../src/engine/playoffMonteCarlo.js';
import {
  NFL_TEAM_NAMES,
  refreshLiveStandingsMetricsInTeamStats
} from '../src/engine/statsLeaderboardEngine.js';
import {
  canonicalInjuryPlayerKey,
  computePlayerPlayProbability,
  parseOfficialClubInjuryReportHtml,
  reconcileRosterAndHealthWithNews
} from '../src/engine/injuryProbabilityModel.js';
import {
  buildNflCalendarForSeasonYear,
  normalizeScheduleGameItem
} from '../src/engine/seasonStateMachine.js';
import {
  SHORT_TWEET_FULL_TEXT_LIMIT,
  classifyBreakingItem,
  classifyNewsItemCategory,
  formatTweetBodyForDisplay,
  resolveNewsBriefCycleState,
  sortNewsWithBreakingPriority
} from '../src/engine/breakingClassifier.js';
import {
  configureBeatAttributionForTeam,
  resolveReporterFromNameOrHandle
} from '../src/engine/beatAttributionEngine.js';
import {
  isPaywalledPublisher,
  normalizePlayerKey,
  sanitizeExternalUrl
} from '../src/engine/linkIntegrity.js';
import { scoreContentSignal } from '../src/engine/antiFluffFilter.js';
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
  console.log('[stage-1] Fetching league-wide shared datasets (standings, OTC ceilings, schedule, big board)...');
  const [standingsRaw, otcSpaceHtml, rotowireXml] = await Promise.all([
    fetchJsonSafe('https://site.web.api.espn.com/apis/v2/sports/football/nfl/standings', 14000),
    fetchTextSafe('https://overthecap.com/salary-cap-space', 14000),
    fetchTextSafe('https://www.rotowire.com/rss/news.php?sport=NFL', 10000)
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

  // Re-fetch current week + next 2 weeks of ESPN NFL scoreboard to ensure completedGames/remainingGames are 100% fresh
  const liveScoreboardCompleted = new Map(sharedCompletedGames.map(g => [String(g.id), g]));
  const liveScoreboardRemaining = new Map(sharedRemainingGames.map(g => [String(g.id), g]));
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
      const id = String(ev.id || `w${wk}_${away}_${home}`);
      const completed = Boolean(comp.status?.type?.completed);
      if (completed) {
        liveScoreboardRemaining.delete(id);
        liveScoreboardCompleted.set(id, {
          id,
          week: wk,
          home,
          away,
          homeScore: Number(homeC.score || 0),
          awayScore: Number(awayC.score || 0)
        });
      } else if (!liveScoreboardCompleted.has(id)) {
        liveScoreboardRemaining.set(id, {
          id,
          week: wk,
          home,
          away,
          neutral: Boolean(comp.neutralSite)
        });
      }
    }
  }

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
        completedLeagueGames: liveScoreboardCompleted.size,
        remainingLeagueGames: liveScoreboardRemaining.size
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
    completedGames: [...liveScoreboardCompleted.values()],
    remainingGames: [...liveScoreboardRemaining.values()],
    baseTeamStatsTemplate: sfMatchup?.teamStats || null,
    sharedBigBoard: sfSeasonal?.draftPrep2027?.consensusBigBoard || [],
    sharedBigBoardMeta: sfSeasonal?.draftPrep2027?.bigBoardMeta || null,
    sharedBigBoardMethodology: sfSeasonal?.draftPrep2027?.bigBoardMethodology || null,
    sharedCombineLeaderboard: sfSeasonal?.draftPrep2027?.combineLeaderboard || null
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
    'def_epa_play_allowed',
    'def_sacks_game'
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

async function generateGroundedDailyBrief(team, appData, apiKey, { existingBrief = null, forceBrief = false } = {}) {
  const nowMs = Date.now();
  const cycleState = resolveNewsBriefCycleState(nowMs, appData, 17);
  if (
    !forceBrief &&
    existingBrief &&
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
        signal: AbortSignal.timeout(95000)
      });
      if (!res.ok) {
        console.warn(`[ai-brief] ${team.abbr} ${model} HTTP ${res.status}`);
        continue;
      }
      const json = await res.json();
      const parts = json?.candidates?.[0]?.content?.parts || [];
      const rawText = parts.filter(p => !p.thought && typeof p.text === 'string').map(p => p.text).join('').trim();
      const cleanJson = rawText.replace(/^```json\s*/i, '').replace(/```$/i, '').trim();
      const parsed = JSON.parse(cleanJson);
      if (!parsed?.headline || !Array.isArray(parsed?.bullets) || parsed.bullets.length < 2) continue;

      const joined = `${parsed.headline} ${parsed.summary || ''} ${parsed.bullets.join(' ')}`;
      const guard = validateNoHallucinatedRosterClaims(joined, appData.roster?.players || []);
      const wordCount = joined.split(/\s+/).filter(Boolean).length;
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
        coveredStoryKeys: sourceCandidates.slice(0, 6).map(s => s.id),
        coveredUrls: sourceCandidates.slice(0, 6).map(s => s.url).filter(Boolean),
        sources: sourceCandidates.slice(0, 10).map(s => ({
          sid: s.sid,
          title: s.title,
          url: s.url,
          author: s.author,
          outlet: s.outlet,
          publishedAt: s.publishedAt
        }))
      };
    } catch (err) {
      console.warn(`[ai-brief] ${team.abbr} ${model} error: ${err?.message || err}`);
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
    espnScheduleRaw,
    espnInjuriesRaw,
    espnNewsRaw,
    espnTxRaw,
    otcHtml,
    clubRosterHtml,
    clubInjuryHtml,
    clubNewsRssXml,
    clubVideoRssXml,
    cbsInjHtml,
    bskyPosts,
    beatPodcasts
  ] = await Promise.all([
    fetchJsonSafe(`https://site.api.espn.com/apis/site/v2/sports/football/nfl/teams/${team.espnId}/roster`),
    fetchJsonSafe(`https://site.api.espn.com/apis/site/v2/sports/football/nfl/teams/${team.espnId}/depthcharts`),
    fetchJsonSafe(`https://site.api.espn.com/apis/site/v2/sports/football/nfl/teams/${team.espnId}/schedule`),
    fetchJsonSafe(`https://site.api.espn.com/apis/site/v2/sports/football/nfl/injuries?team=${team.espnId}`),
    fetchJsonSafe(`https://site.api.espn.com/apis/site/v2/sports/football/nfl/news?team=${team.espnId}&limit=25`),
    fetchJsonSafe(`https://site.api.espn.com/apis/site/v2/sports/football/nfl/transactions?team=${team.espnId}&limit=25`),
    fetchTextSafe(`https://overthecap.com/salary-cap/${team.otcSlug}`, 14000),
    fetchTextSafe(team.clubRosterUrl, 12000),
    fetchTextSafe(team.clubInjuryUrl, 12000),
    fetchTextSafe(team.clubRssUrls[0], 10000),
    fetchTextSafe(team.clubRssUrls[1] || `https://www.${team.clubDomain}/rss/videos`, 10000),
    fetchTextSafe(buildCbsTeamInjuriesUrl(team.abbr, team.fullName), 10000),
    fetchTeamBlueskyPosts(team, reportersData),
    fetchTeamBeatPodcasts(team)
  ]);

  const seasonYear = leagueCtx.seasonYear || 2026;
  const nowIso = new Date().toISOString();

  // 1. Parse OverTheCap 5-year salary cap ledger
  const otcParsed = otcHtml
    ? parseOverTheCapHtml(otcHtml, seasonYear, leagueCtx.otcSpaceHtml, team.otcSlug)
    : { years: {}, otcPlayers: [], otcDirectory: [] };
  const otcYears = otcParsed.years || {};
  const otcPlayersByKey = new Map();
  for (const entry of otcParsed.otcPlayers || []) {
    if (entry?.name) otcPlayersByKey.set(normalizePlayerKey(entry.name), entry);
  }
  const otcDirByKey = new Map();
  for (const d of otcParsed.otcDirectory || []) {
    if (d?.name) otcDirByKey.set(normalizePlayerKey(d.name), d);
  }

  // 2. Parse official club roster bucket map (active / ir / practice_squad)
  const clubBuckets = clubRosterHtml ? parseOfficial49ersRosterHtml(clubRosterHtml) : null;
  const clubIrSet = new Set([...(clubBuckets?.ir || [])].map(normalizePlayerKey));
  const clubPsSet = new Set([...(clubBuckets?.practiceSquad || [])].map(normalizePlayerKey));

  // 3. Parse ESPN injuries by playerId & name
  const espnInjById = new Map();
  const espnInjByName = new Map();
  for (const inj of espnInjuriesRaw?.injuries || []) {
    const athId = String(inj?.athlete?.id || '');
    const athName = normalizePlayerKey(inj?.athlete?.displayName || '');
    if (athId) espnInjById.set(athId, inj);
    if (athName) espnInjByName.set(athName, inj);
  }

  // 4. Parse CBS injuries as backup cross-check
  const cbsInjMap = cbsInjHtml ? parseCbsTeamInjuriesHtml(cbsInjHtml) : new Map();

  // 5. Build complete Roster array
  const players = [];
  const seenIds = new Set();
  for (const grp of espnRosterRaw?.athletes || []) {
    const grpNameLower = String(grp.position || '').toLowerCase();
    for (const a of grp.items || []) {
      const id = String(a.id || '');
      if (!id || seenIds.has(id)) continue;
      seenIds.add(id);

      const fullName = a.fullName || a.displayName || 'Player';
      const nk = normalizePlayerKey(fullName);
      const pos = a.position?.abbreviation || 'ATH';
      const statusType = String(a.status?.type || a.status?.name || '').toLowerCase();
      let rosterBucket = 'active';
      if (grpNameLower.includes('injured') || statusType.includes('injured') || clubIrSet.has(nk)) {
        rosterBucket = 'ir';
      } else if (grpNameLower.includes('practice') || statusType.includes('practice') || clubPsSet.has(nk)) {
        rosterBucket = 'practice_squad';
      }

      const otcEntry = otcPlayersByKey.get(nk) || null;
      const otcDir = otcDirByKey.get(nk) || null;
      const contractsByYear = otcEntry?.contractsByYear || {};
      const capHit2026 = Number(contractsByYear[String(seasonYear)]?.capNumber || 0);
      const espnInj = espnInjById.get(id) || espnInjByName.get(nk) || null;
      const cbsInj = cbsInjMap.get(canonicalInjuryPlayerKey(fullName)) || null;
      const rawStatus =
        rosterBucket === 'ir'
          ? 'Injured Reserve'
          : espnInj?.status || cbsInj?.status || 'Active';
      const injType =
        espnInj?.details?.type || cbsInj?.injury || (rosterBucket === 'ir' ? 'Reserve / IR' : 'Healthy');

      const prob = computePlayerPlayProbability({
        name: fullName,
        position: pos,
        age: Number(a.age) || null,
        experienceYears: Number(a.experience?.years) || 0,
        status: rawStatus,
        injuryType: injType,
        rosterBucket,
        wed: '-',
        thu: '-',
        fri: '-',
        shortComment: espnInj?.shortComment || ''
      });

      const draftInfo = a.draft
        ? `Rd ${a.draft.round} Pick ${a.draft.selection} (${a.draft.year})`
        : a.experience?.years === 0
          ? `UDFA (${seasonYear})`
          : 'Veteran';

      players.push({
        id,
        gsisId: null,
        pfrId: null,
        otcId: otcEntry?.otcId || otcDir?.otcId || null,
        otcSlug: otcEntry?.otcSlug || otcDir?.otcSlug || null,
        otcUrl: otcEntry?.otcUrl || otcDir?.otcUrl || `https://overthecap.com/salary-cap/${team.otcSlug}`,
        espnUrl: `https://www.espn.com/nfl/player/_/id/${id}`,
        pfrUrl: `https://www.pro-football-reference.com/search/search.fcgi?search=${encodeURIComponent(fullName)}`,
        name: fullName,
        shortName: a.shortName || fullName,
        jersey: a.jersey != null && a.jersey !== '' ? Number(a.jersey) : null,
        position: pos,
        unit: mapPositionToUnit(pos),
        rosterBucket,
        age: Number(a.age) || null,
        displayHeight: a.displayHeight || '',
        displayWeight: a.displayWeight || (a.weight ? `${a.weight} lbs` : ''),
        experienceYears: Number(a.experience?.years) || 0,
        college: a.college?.name || '',
        draftInfo,
        headshotUrl: a.headshot?.href || `https://a.espncdn.com/i/headshots/nfl/players/full/${id}.png`,
        capHit2026,
        contractsByYear,
        snapSummary: null,
        primarySnapPct: 0,
        stats2026: null,
        careerSeasons: [],
        nextGenStats: null,
        pfrAdvStats: null,
        publicEfficiencyNote: '',
        spiderProfile: null,
        health: {
          status: rawStatus,
          injuryType: injType,
          returnDate: espnInj?.details?.returnDate || null,
          isSeasonEnding: rosterBucket === 'ir' && /season|acl|achilles|patellar/i.test(`${espnInj?.shortComment || ''} ${espnInj?.longComment || ''}`),
          isPracticeWindowOpen: false,
          designatedDateIso: null,
          blurbDateIso: espnInj?.date || null,
          placedBeforeWeek: null,
          earliestEligibleWeek: null,
          projectedReturnWeek: rosterBucket === 'ir' ? 'TBD (4-game min)' : null,
          byeWeekNote: rosterBucket === 'ir' ? '4-game NFL minimum requirement' : '',
          irBeatNote: espnInj?.longComment || espnInj?.shortComment || '',
          fantasyStatusAbbr: espnInj?.details?.fantasyStatus?.abbreviation || '',
          isIrReturnQuestionable: false,
          isOnPracticeReport: Boolean(espnInj && rosterBucket === 'active'),
          wed: '-',
          thu: '-',
          fri: '-',
          shortComment: espnInj?.shortComment || '',
          longComment: espnInj?.longComment || '',
          playProbabilityPct: prob.playProbabilityPct,
          playTier: prob.playTier,
          playBadgeLabel: prob.playBadgeLabel,
          factors: prob.factors || [],
          archetypeNote: prob.archetypeNote || '',
          weeklyHistory2026: []
        },
        recentNews: [],
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

  // 6. Build Depth Chart from ESPN (`espnDepthRaw.depthchart` matching `rosterCapView.js` schema)
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
          const prob = matched.health?.playProbabilityPct ?? 95;
          const isAvailable =
            prob >= 40 &&
            (matched.rosterBucket === 'active' ||
              Boolean(matched.health?.isIrReturnQuestionable) ||
              Boolean(matched.health?.isPracticeWindowOpen));
          return {
            playerId: matched.id,
            name: matched.name || ath.displayName,
            jersey: matched.jersey ?? null,
            headshotUrl: matched.headshotUrl || '',
            baselineRank: idx + 1,
            playProbabilityPct: prob,
            statusBadge: matched.health?.playBadgeLabel || `${prob}% • Full Go`,
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
      const unitName = /wr|te|offense|2rb/i.test(rawName)
        ? `Offense (${rawName})`
        : /4-3|3-4|defense|\bd\b/i.test(rawName)
          ? `Defense (${rawName})`
          : /special/i.test(rawName)
            ? 'Special Teams'
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

  // 7. Build Complete Schedule & Upcoming Matchup
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
    schedule.push(
      normalizeScheduleGameItem(
        {
          id: `bye_${seasonYear}_wk${byeWeek}`,
          seasonType: 'REG',
          week: byeWeek,
          weekLabel: `Wk ${byeWeek}`,
          isByeWeek: true,
          completed: teamStanding.wins + teamStanding.losses + teamStanding.ties >= byeWeek,
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

  const oppInjuryReport = [];
  for (const inj of oppInjRaw?.injuries || []) {
    const nm = inj?.athlete?.displayName || '';
    if (!nm) continue;
    const pos = inj?.athlete?.position?.abbreviation || 'ATH';
    const status = inj?.status || 'Questionable';
    const injType = inj?.details?.type || 'Injury';
    const offRec = officialInj?.oppByKey?.get(canonicalInjuryPlayerKey(nm)) || null;
    const prob = computePlayerPlayProbability({
      name: nm,
      position: pos,
      status: offRec?.gameStatus || status,
      injuryType: offRec?.injury || injType,
      wed: offRec?.wed || '-',
      thu: offRec?.thu || '-',
      fri: offRec?.fri || '-',
      shortComment: inj?.shortComment || ''
    });
    oppInjuryReport.push({
      playerId: String(inj?.athlete?.id || ''),
      name: nm,
      position: pos,
      headshotUrl: inj?.athlete?.headshot?.href || (inj?.athlete?.id ? `https://a.espncdn.com/i/headshots/nfl/players/full/${inj.athlete.id}.png` : ''),
      injuryType: offRec?.injury || injType,
      gameStatus: offRec?.gameStatus || status,
      wed: offRec?.wed || '-',
      thu: offRec?.thu || '-',
      fri: offRec?.fri || '-',
      playProbabilityPct: prob.playProbabilityPct,
      playBadgeLabel: prob.playBadgeLabel,
      beatComment: inj?.longComment || inj?.shortComment || ''
    });
  }

  // Apply official club W/T/F slots to our team's players
  if (officialInj?.hasSfReport) {
    for (const p of players) {
      const off = officialInj.sfByKey.get(canonicalInjuryPlayerKey(p.name));
      if (!off) continue;
      p.health.isOnPracticeReport = true;
      p.health.wed = off.wed || '-';
      p.health.thu = off.thu || '-';
      p.health.fri = off.fri || '-';
      if (off.injury) p.health.injuryType = off.injury;
      if (off.gameStatus && off.gameStatus !== '-') p.health.status = off.gameStatus;
      const prob = computePlayerPlayProbability({
        name: p.name,
        position: p.position,
        age: p.age,
        experienceYears: p.experienceYears,
        status: p.health.status,
        injuryType: p.health.injuryType,
        rosterBucket: p.rosterBucket,
        wed: p.health.wed,
        thu: p.health.thu,
        fri: p.health.fri,
        shortComment: p.health.shortComment
      });
      p.health.playProbabilityPct = prob.playProbabilityPct;
      p.health.playTier = prob.playTier;
      p.health.playBadgeLabel = prob.playBadgeLabel;
      p.health.factors = prob.factors || [];
    }
  }

  // 8. Build Health JSON (practiceReport & irAndReserveTracker)
  const practiceReport = players
    .filter(p => p.rosterBucket === 'active' && (p.health.isOnPracticeReport || p.health.status !== 'Active'))
    .map(p => ({
      playerId: p.id,
      name: p.name,
      position: p.position,
      jersey: p.jersey,
      headshotUrl: p.headshotUrl,
      rosterBucket: p.rosterBucket,
      isIrReturnWindow: false,
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
    .filter(p => p.rosterBucket === 'ir')
    .map(p => ({
      playerId: p.id,
      name: p.name,
      position: p.position,
      jersey: p.jersey,
      headshotUrl: p.headshotUrl,
      injuryType: p.health.injuryType || 'IR',
      status: p.health.isSeasonEnding ? 'Season-Ending IR' : 'IR — Reserve',
      isSeasonEnding: Boolean(p.health.isSeasonEnding),
      isPracticeWindowOpen: false,
      isPracticeWindowExpected: false,
      wed: '-',
      thu: '-',
      fri: '-',
      placedBeforeWeek: null,
      earliestEligibleWeek: null,
      projectedReturnWeek: p.health.isSeasonEnding ? 'Out for Season' : 'TBD (4-game min)',
      byeWeekNote: p.health.isSeasonEnding ? 'Season-ending IR' : '4-game NFL minimum requirement',
      playProbabilityPct: 0,
      playBadgeLabel: p.health.isSeasonEnding ? '0% • Out for Season' : '0% • IR',
      beatNote: p.health.irBeatNote || ''
    }));

  // 9. Build News Raw Stream (ESPN News + ESPN Tx + Club RSS + Club Video RSS + RotoWire + Bluesky)
  const rawStream = [];
  const seenNewsUrls = new Set();
  const pushNewsItem = item => {
    const cleanUrl = sanitizeExternalUrl(item?.url || '', null);
    if (!cleanUrl || isPaywalledPublisher(cleanUrl) || seenNewsUrls.has(cleanUrl)) return;
    seenNewsUrls.add(cleanUrl);
    const sig = scoreContentSignal(item.title || '', item.summary || item.fullText || '');
    if (sig.isClickbait) return;
    const pubIso = item.publishedAt || nowIso;
    const brk = classifyBreakingItem(item, Date.now());
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

  // 9a. ESPN Team News
  for (const a of espnNewsRaw?.articles || []) {
    const url = a.links?.web?.href || '';
    const title = String(a.headline || '').trim();
    const summary = String(a.description || '').trim();
    if (!title || !url) continue;
    const byline = a.byline || 'ESPN NFL Nation';
    const rep = resolveReporterFromNameOrHandle(byline);
    pushNewsItem({
      id: `${team.abbr.toLowerCase()}_espn_${a.dataSourceIdentifier || hashShort(url)}`,
      type: a.type === 'Media' ? 'video' : 'article',
      title,
      summary,
      imageUrl: a.images?.[0]?.url || '',
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
      trustTier: 1,
      wireSource: 'espn_team_news'
    });
  }

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
      authorHandle: `@${team.nickname}`,
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
      authorHandle: `@${team.nickname}`,
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
      authorHandle: `@${team.nickname}`,
      authorProfileUrl: team.clubNewsUrl,
      trustTier: 1,
      wireSource: 'club_video_rss'
    });
  }

  // 9e. Team-filtered RotoWire NFL RSS
  const teamMatchRe = new RegExp(`\\b(${team.keywordRules.requiredNicknames.join('|')})\\b`, 'i');
  for (const m of (leagueCtx.rotowireXml || '').matchAll(/<item\b[\s\S]*?<\/item>/gi)) {
    const b = m[0];
    const title = decodeXmlEntities((b.match(/<title>([\s\S]*?)<\/title>/i) || [])[1] || '');
    const desc = decodeXmlEntities((b.match(/<description>([\s\S]*?)<\/description>/i) || [])[1] || '');
    const link = decodeXmlEntities((b.match(/<link>([\s\S]*?)<\/link>/i) || [])[1] || '');
    const pubRaw = decodeXmlEntities((b.match(/<pubDate>([\s\S]*?)<\/pubDate>/i) || [])[1] || '');
    if (!title || !link || !teamMatchRe.test(`${title} ${desc}`)) continue;
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

  // 10. Live Team Stats (rebound from 32-team league dataset + today's ESPN standings) & Live Power Rankings
  const { teamStats, teamStatRankings } = buildTeamStatsForClub(team, leagueCtx);
  const powerRankings = await fetchLivePowerRankings({
    teamAbbr: team.abbr,
    seasonYear,
    currentWeek,
    schedule,
    sfRecord: teamStanding.record,
    oppShortName: nextUnplayed?.opponent?.shortName || nextUnplayed?.opponent?.abbr || null
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
  const oppCoaches = oppCfg?.coachesSeed || null;

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
    featuredPlayers: [],
    opponentHealth: {
      sourceUrl: oppCfg ? oppCfg.clubInjuryUrl : 'https://www.espn.com/nfl/injuries',
      injuryReport: oppInjuryReport,
      irReserve: []
    },
    betting: {
      spread: 'Check ESPN Gamecast',
      overUnder: 'TBD',
      impliedWinProb: '50%'
    },
    franchiseHistory: {
      allTimeRecord: `${team.nickname} vs. ${nextUnplayed?.opponent?.shortName || nextUnplayed?.opponent?.abbr || 'Opponent'}`
    },
    coachingMatchup: {
      headline: `${coaches.hc} vs. ${oppCoaches?.hc || `${nextUnplayed?.opponent?.shortName || 'Opponent'} Staff`}`,
      summary: `${team.fullName} (${coaches.hc} / OC ${coaches.oc} / DC ${coaches.dc}) prepare for Week ${nextUnplayed?.week || currentWeek} against ${nextUnplayed?.opponent?.name || 'their next opponent'}.`
    },
    keyMatchupsMatrix: []
  };

  const cap26 = otcYears[String(seasonYear)] || { teamCapSpace: 0, deadMoneyTotal: 0 };
  const cap27 = otcYears[String(seasonYear + 1)] || { teamCapSpace: 0, deadMoneyTotal: 0 };
  const capPlayers = players
    .filter(p => Object.keys(p.contractsByYear || {}).length > 0)
    .map(p => ({
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
      contractsByYear: p.contractsByYear
    }));

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

  const rookies = players
    .filter(p => p.experienceYears === 0)
    .slice(0, 14)
    .map((p, idx) => ({
      playerId: p.id,
      name: p.name,
      position: p.position,
      college: p.college || 'College',
      round: Number(String(p.draftInfo || '').match(/Rd (\d+)/)?.[1]) || 7,
      overallPick: Number(String(p.draftInfo || '').match(/Pick (\d+)/)?.[1]) || (220 + idx),
      headshotUrl: p.headshotUrl,
      espnUrl: p.espnUrl,
      status: p.rosterBucket === 'active' ? 'Active 53' : p.rosterBucket.toUpperCase(),
      summary: `${p.draftInfo} • ${p.displayHeight} ${p.displayWeight}`
    }));

  const seasonalJson = {
    updatedAt: nowIso,
    tradeWarRoom: {
      deadlineIso: `${seasonYear}-11-10T21:00:00Z`,
      deadlineDisplay: `Nov 10, ${seasonYear} 4:00 PM ET`,
      availableGrossCap: Number(cap26.teamCapSpace || 0),
      projected2027CapSpace: Number(cap27.teamCapSpace || 0),
      capSourceUrl: `https://overthecap.com/salary-cap/${team.otcSlug}`,
      transactionsUrl: `https://www.${team.clubDomain}/team/transactions/`,
      purchasingPower: `$${(Number(cap26.teamCapSpace || 0) / 1e6).toFixed(2)}M live ${seasonYear} cap space`,
      completed2026Moves: [],
      topNeeds: [],
      realisticTargets: [],
      pitfallsToAvoid: [],
      tieredRumors: []
    },
    playoffPicture,
    draftPrep2027: {
      draftYear: seasonYear + 1,
      bigBoardUrl: `https://www.tankathon.com/nfl/${team.slug}`,
      bigBoardMeta: leagueCtx.sharedBigBoardMeta,
      bigBoardMethodology: leagueCtx.sharedBigBoardMethodology,
      sources: [
        { label: `Tankathon ${team.nickname}`, url: `https://www.tankathon.com/nfl/${team.slug}` },
        { label: 'NFL Mock Draft Database', url: `https://www.nflmockdraftdatabase.com/nfl-teams/${seasonYear + 1}/${team.otcSlug}` }
      ],
      tradedPicksNote: `Live ${seasonYear + 1} ${team.fullName} draft order & 3-Lens 250+ Prospect Big Board.`,
      pickInventory: [
        { round: 1, projectedOverall: Math.max(1, 33 - Math.max(1, teamStanding.seed * 2)), origin: 'Own Pick', notes: `${team.abbr} 1st Round` },
        { round: 2, projectedOverall: 32 + Math.max(1, 33 - Math.max(1, teamStanding.seed * 2)), origin: 'Own Pick', notes: `${team.abbr} 2nd Round` },
        { round: 3, projectedOverall: 64 + Math.max(1, 33 - Math.max(1, teamStanding.seed * 2)), origin: 'Own Pick', notes: `${team.abbr} 3rd Round` }
      ],
      topNeeds2027: [],
      firstPickMockDatabase: [],
      consensusBigBoard: leagueCtx.sharedBigBoard || [],
      consensusMockTargets: [],
      combineLeaderboard: leagueCtx.sharedCombineLeaderboard || null
    },
    draftClass2026: {
      draftYear: seasonYear,
      sourceUrl: `https://www.pro-football-reference.com/teams/${team.pfrAbbr}/${seasonYear}_draft.htm`,
      otcDraftUrl: `https://overthecap.com/salary-cap/${team.otcSlug}`,
      picks: rookies.filter(r => r.overallPick < 260),
      priorityUdfas: rookies.filter(r => r.overallPick >= 260)
    }
  };

  const healthJson = {
    updatedAt: nowIso,
    week: currentWeek,
    byeWeek,
    sourceUrl: team.clubInjuryUrl,
    espnInjuryUrl: `https://www.espn.com/nfl/team/injuries/_/name/${team.espnAbbr}/${team.otcSlug}`,
    usedIrDesignations: 0,
    remainingIrDesignations: 8,
    maxRegularSeasonIrDesignations: 8,
    gameDayRoster: null,
    practiceReport,
    irAndReserveTracker
  };

  const rosterJson = {
    updatedAt: nowIso,
    count: players.length,
    departedPlayers,
    positionalLeaderboards: {},
    peerDirectory: {},
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
  const outDir = path.join(ROOT, 'data', 'teams', team.slug);
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
      const livePrev = await fetchJsonSafe(`https://${team.domain}/data/news.json`, 4500);
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
    `[stage-2] Done ${team.abbr} (${team.slug}): record=${meta.teamRecord}, roster=${players.length}, capPlayers=${capPlayers.length}, departed=${departedPlayers.length}, news=${tempAppData.news.rawStream.length}, brief=${tempAppData.news.dailyTopNewsBrief?.source} (${tempAppData.news.dailyTopNewsBrief?.modelUsed}), pods7d=${beatPodcasts.totalEpisodes}, playoffOdds=${playoffPicture.baselineSimulation?.teamOdds?.makePlayoffsPct}%`
  );
}

async function main() {
  const args = process.argv.slice(2);
  const teamsArg = args.find(a => a.startsWith('--teams=')) || args.find(a => a.startsWith('--team='));
  const rawList = teamsArg
    ? teamsArg.replace(/^--teams?=/, '').split(',').map(s => s.trim()).filter(Boolean)
    : [...CANARY_TEAM_SLUGS];

  const teams = rawList.map(resolveTeamConfig).filter(t => t && t.abbr !== 'SF');
  if (teams.length === 0) {
    console.error('No non-SF target teams specified. Example: --teams=DET,BUF');
    process.exit(1);
  }

  const leagueCtx = await loadSharedLeagueContext(2026);
  const geminiApiKey = String(process.env.GEMINI_NFL_API_KEY || '').trim();

  for (let i = 0; i < teams.length; i += 1) {
    await buildTeamBundle(teams[i], leagueCtx, { geminiApiKey });
    if (i < teams.length - 1) await sleep(850);
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
