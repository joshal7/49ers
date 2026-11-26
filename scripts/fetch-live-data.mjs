#!/usr/bin/env node
/**
 * Unified Two-Stage All-32-Team NFL Live Data Ingestion & Grounded AI Synthesis Pipeline
 *
 * Single canonical fetcher for ALL 32 NFL franchises (`49ers.joshal.com` -> `data/`,
 * all 31 other clubs -> `data/teams/{slug}/`):
 *
 * Stage 1 (Runs ONCE): Fetches league-wide datasets once (ESPN 32-team standings & team stats,
 *   nflverse 32-team stats/player snaps/combine/draft picks, 272-game league schedule for AFC/NFC
 *   Monte Carlo, OverTheCap cap-space ceilings, live 250+ prospect 3-Lens Draft Big Board,
 *   national All-22 film/analytics X timelines & YouTube feeds, and free-tier Gemini model discovery).
 * Stage 2 (Per-Team): Builds complete 11-file team bundles (`meta.json`, `roster.json`,
 *   `depth-chart.json`, `cap.json`, `health.json`, `news.json`, `schedule-matchup.json`,
 *   `seasonal.json`, `reporters.json`, `beat-podcasts.json`, `podcasts/index.json`) using verified
 *   ESPN roster/depth/schedule/player-wire, OverTheCap, Official Club HTML/RSS, CBS Injuries,
 *   Per-Team Local Beat RSS (SB Nation + USA Today Wire + regional TV/radio), Power Rankings,
 *   Local + National X Timelines & Embedded X Clips/GIFs, Bluesky, RotoWire, Apple Podcasts,
 *   Cloudflare KV brief adoption, and `gemini-4-hydrogen` (`XHIGH`) Daily Brief + `gemini-3.8-flash` Cap Note.
 *
 * Usage:
 *   node scripts/fetch-live-data.mjs --all
 *   node scripts/fetch-live-data.mjs --teams=SF
 *   node scripts/fetch-live-data.mjs --teams=DET,BUF,SF
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import zlib from 'node:zlib';
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
  fetchEspnAthleteDetailsBatch,
  parseCbsTeamInjuriesHtml,
  parseOfficial49ersRosterHtml,
  resolveAuthoritativeRosterPlayerStatus
} from './lib/liveHealthAndRosterResolver.mjs';
import {
  buildFranchiseHeadToHeadHistory,
  buildScheduleH2hByOpponentMap,
  estimate4YrRookieContractByPick,
  fetchKickoffOutdoorWeather,
  loadSharedNflversePlayerContext,
  normPlayerName,
  parseCsv,
  resolvePlayerWeeklyLog
} from './lib/nflversePlayerContext.mjs';
import { resolveNflStadiumMeta } from '../src/config/nflStadiums.js';
import {
  extractLiveScoreboardMap,
  parseEspnTransactionsToLedger
} from '../src/engine/teamDeepDiveEngine.js';
import {
  fetchLeaguePowerRankingsPayloads,
  fetchLivePowerRankings
} from './lib/powerRankingsFetcher.mjs';
import { buildTeamDraftPrep2027 } from './lib/teamDraftIntelBuilder.mjs';
import { attachDraftClassHighlightVideos } from './lib/draftVideoResolver.mjs';
import {
  GEMINI_X_DISCOVERY_QUOTA_POLICY,
  NATIONAL_FILM_ANALYTICS_X_HANDLES,
  OFFICIAL_TEAM_X_HANDLES_BY_ABBR,
  discoverXStatusesViaGeminiSearch,
  fetchBeatArticleHtmlForXEmbeds,
  fetchXTimelinesBatch,
  filterXTimelineItemsForTeam,
  harvestEmbeddedXForTeamRss,
  hydrateRawXStatusUrlsBatch,
  resolveGeminiXDiscoveryPlan,
  selectRotatingXHandleSlice,
  selectTeamLocalXHandles
} from './lib/xBeatMediaFetcher.mjs';
import {
  TEAM_CURATED_YOUTUBE_CHANNELS_BY_ABBR,
  resolveTeamBeatRssFeeds
} from './lib/teamMediaFeeds.mjs';
import {
  discoverBestFreeGeminiModel,
  parseTankathonTeamPicksHtml,
  runSinglePassDailyGeminiSynthesis
} from './lib/aiSynthesisEngine.mjs';
import {
  fetchCuratedYouTubeChannelVideos,
  fetchLive2027ConsensusBigBoardAndMocks,
  fetchYouTubeVideoDuration,
  parseRelativePublishedAgoToIso,
  searchYouTubeChannelVideos,
  verifyYouTubeEmbeddable
} from './lib/seasonalContentBuilder.mjs';
import {
  buildTeamTradeWindow,
  loadSharedLeagueTradeContext
} from './lib/teamTradeIntelligence.mjs';
import {
  canonicalPlayoffGameKey,
  estimateTeamInjurySpreadAdjustments,
  reconcileAndDedupePlayoffGames
} from '../src/engine/playoffMonteCarlo.js';
import {
  buildPlayoffPictureForTeam,
  buildSharedLeaguePlayoffContext
} from './lib/leaguePlayoffPipeline.mjs';
import {
  NFL_TEAM_NAMES,
  computeLeaguePositionalLeaderboards,
  computeLeagueTeamStatsPayload,
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
import {
  extractCompletedGameRecapSummary,
  isBeforeWeeklyPracticeWindow
} from '../src/engine/gameDayRosterEngine.js';
import {
  buildNflCalendarForSeasonYear,
  normalizeScheduleGameItem
} from '../src/engine/seasonStateMachine.js';
import {
  SHORT_TWEET_FULL_TEXT_LIMIT,
  classifyBreakingItem,
  classifyNewsItemCategory,
  extractBlueskyInlineLinks,
  filterOutCompletedGameAvailabilityItems,
  formatTweetBodyForDisplay,
  isDailyBriefStaleForLiveState,
  isOpposingTeamOnlyInjuryOrRosterStory,
  isOpposingTeamSubjectLead,
  resolveNewsBriefCycleState,
  sortNewsWithBreakingPriority,
  stripRedundantAuthorBoilerplate
} from '../src/engine/breakingClassifier.js';
import {
  configureBeatAttributionForTeam,
  extractBeatAttributionFromText,
  isDirectSocialPostUrl,
  isEspnPlayerProfileUrl,
  isPodiumSubjectId,
  resolveOriginalTweetUrl,
  resolveReporterFromNameOrHandle
} from '../src/engine/beatAttributionEngine.js';
import {
  AMBIGUOUS_PLAYER_SURNAMES,
  buildEspnPlayerNewsAnchorUrl,
  buildOtcPlayerUrl,
  createPlayerIdentityResolver,
  decodeHtmlEntities,
  extractBlueskyEmbedImages,
  getPlayerLookupKeys,
  hasExplicit49ersEntity,
  hasSafeStandaloneSurnameMatch,
  isLeagueWideFilmAnalyticsTweet,
  isOffTopicLeagueFiller,
  isPaywalledPublisher,
  normalizeMultilineSocialText,
  normalizePlayerKey,
  sanitizeExternalUrl,
  stripHtmlAndDecodeEntities
} from '../src/engine/linkIntegrity.js';
import { selectBestEspnArticleImage } from '../src/engine/salientMediaEngine.js';
import { formatVideoDurationDisplay } from '../src/engine/digestExperienceEngine.js';
import { cleanSensationalistText, scoreContentSignal } from '../src/engine/antiFluffFilter.js';
import {
  buildAuthoritativeLiveContextSnapshot,
  buildLiveGroundingSystemPrompt,
  classifySymmetricUnitAdvantage,
  validateNoHallucinatedRosterClaims
} from '../src/engine/groundingValidator.js';
import {
  PRIMARY_GEMINI_REASONING_MODEL,
  buildGeminiThinkingConfig,
  resolveGeminiThinkingLevelLabel
} from '../src/engine/geminiStudioPrompts.js';
import {
  isSearchGroundingAllowed,
  normalizeGeminiQuotaState,
  refreshGeminiModelCatalogIfDue,
  summarizeGeminiQuotaHeadroom
} from '../src/engine/geminiQuotaManager.js';
import {
  buildDailyTopNewsBriefPrompt,
  buildDeterministicDailyTopNewsBrief,
  getPacificDateKey,
  parseAndSanitizeDailyTopNewsBrief,
  repairDailyTopNewsBriefLinks,
  selectTopNewsBriefSourceCandidates
} from '../src/services/aiWorkerClient.js';

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

const espnClipDurationCache = new Map();
const bskyPlaylistDurationCache = new Map();

function parseClubVideoSitemapDurations(xml = '') {
  const map = new Map();
  for (const m of String(xml || '').matchAll(/<url>([\s\S]*?)<\/url>/gi)) {
    const loc = (m[1].match(/<loc>([^<]+)<\/loc>/i) || [])[1]?.trim();
    const sec = Number((m[1].match(/<video:duration>(\d+)<\/video:duration>/i) || [])[1] || 0);
    const durStr = formatVideoDurationDisplay(sec);
    if (loc && durStr) {
      map.set(loc.replace(/\/+$/, '').toLowerCase(), durStr);
    }
  }
  return map;
}

async function fetchEspnClipDuration(clipId = '') {
  const clean = String(clipId || '').trim();
  if (!clean) return '';
  if (espnClipDurationCache.has(clean)) return espnClipDurationCache.get(clean);
  let durStr = '';
  try {
    const json = await fetchJsonSafe(`https://api-app.espn.com/v1/video/clips/${encodeURIComponent(clean)}`, 4500);
    const sec = Number(json?.videos?.[0]?.duration || 0);
    durStr = formatVideoDurationDisplay(sec);
  } catch {
    durStr = '';
  }
  espnClipDurationCache.set(clean, durStr);
  return durStr;
}

async function fetchBlueskyHlsDuration(playlistUrl = '') {
  const clean = String(playlistUrl || '').trim();
  if (!clean || !/^https:\/\//i.test(clean)) return '';
  if (bskyPlaylistDurationCache.has(clean)) return bskyPlaylistDurationCache.get(clean);
  let durStr = '';
  try {
    const master = await fetchTextSafe(clean, 4500);
    const subLine = String(master || '')
      .split(/\r?\n/)
      .map(l => l.trim())
      .find(l => l && !l.startsWith('#') && /\.m3u8(?:\?|$)/i.test(l));
    if (subLine) {
      const subUrl = new URL(subLine, clean).toString();
      const subText = await fetchTextSafe(subUrl, 4500);
      let totalSec = 0;
      for (const em of String(subText || '').matchAll(/#EXTINF:([0-9]+(?:\.[0-9]+)?)/gi)) {
        totalSec += Number(em[1] || 0);
      }
      durStr = formatVideoDurationDisplay(totalSec);
    }
  } catch {
    durStr = '';
  }
  bskyPlaylistDurationCache.set(clean, durStr);
  return durStr;
}

async function enrichRawStreamVideoDurations(rawStream = []) {
  if (!Array.isArray(rawStream) || rawStream.length === 0) return;

  const jobs = [];
  for (const it of rawStream) {
    if (!it || typeof it !== 'object') continue;
    const normExisting = formatVideoDurationDisplay(it.duration);
    if (normExisting) {
      it.duration = normExisting;
      continue;
    }
    if (it.duration) delete it.duration;
    if (it.isAnimatedGif) continue;
    const isVid = it.type === 'video' || Boolean(it.videoId || it.videoStreamUrl || it.externalVideoUrl);
    if (!isVid) continue;

    if (it.videoId) {
      jobs.push({ item: it, kind: 'youtube', key: String(it.videoId).trim() });
      continue;
    }
    const espnClipMatch = String(it.url || '').match(/espn\.com\/video\/clip\/_\/id\/(\d+)/i);
    if (espnClipMatch?.[1]) {
      jobs.push({ item: it, kind: 'espn', key: espnClipMatch[1] });
      continue;
    }
    const bskyPlaylist =
      it._bskyPlaylistUrl ||
      (String(it.imageUrl || '').match(/^(https:\/\/video\.bsky\.app\/watch\/[^/]+\/[^/]+)\/thumbnail\.jpg/i)?.[1]
        ? `${String(it.imageUrl).match(/^(https:\/\/video\.bsky\.app\/watch\/[^/]+\/[^/]+)\/thumbnail\.jpg/i)[1]}/playlist.m3u8`
        : '');
    if (bskyPlaylist) {
      jobs.push({ item: it, kind: 'bsky', key: bskyPlaylist });
    }
  }

  const CONCURRENCY = 10;
  for (let i = 0; i < jobs.length; i += CONCURRENCY) {
    await Promise.all(
      jobs.slice(i, i + CONCURRENCY).map(async job => {
        try {
          const dur =
            job.kind === 'youtube'
              ? await fetchYouTubeVideoDuration(job.key)
              : job.kind === 'espn'
                ? await fetchEspnClipDuration(job.key)
                : await fetchBlueskyHlsDuration(job.key);
          if (dur) job.item.duration = dur;
        } catch {}
      })
    );
  }

  // Final title cross-match pass (copies YouTube exact duration onto matching-title club videos
  // whose sitemap still had `<video:duration>0</video:duration>` right after upload)
  const normVidTitle = t =>
    String(t || '')
      .toLowerCase()
      .replace(/\s*\|\s*(?:49ers|nfl|week\s+\d+).*$/i, '')
      .replace(/[^a-z0-9]+/g, ' ')
      .trim()
      .slice(0, 60);
  const durByNormTitle = new Map();
  for (const it of rawStream) {
    if (!it?.duration) continue;
    const k = normVidTitle(it.title);
    if (k.length >= 16 && !durByNormTitle.has(k)) durByNormTitle.set(k, it.duration);
  }
  for (const it of rawStream) {
    if (it && '_bskyPlaylistUrl' in it) delete it._bskyPlaylistUrl;
    if (!it || it.duration || it.isAnimatedGif) continue;
    if (it.type !== 'video' && !it.videoId && !it.videoStreamUrl && !it.externalVideoUrl) continue;
    const k = normVidTitle(it.title);
    if (k.length >= 16 && durByNormTitle.has(k)) {
      it.duration = durByNormTitle.get(k);
    }
  }
}

async function fetchTextSafe(url, timeoutMs = 12000) {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const res = await fetch(url, { headers: UA_HEADERS, signal: AbortSignal.timeout(timeoutMs) });
      if ((res.status === 429 || res.status === 503) && attempt === 0 && /overthecap\.com/i.test(url)) {
        await sleep(1800);
        continue;
      }
      if (!res.ok) return '';
      return await res.text();
    } catch {
      if (attempt === 0 && /overthecap\.com/i.test(url)) {
        await sleep(1200);
        continue;
      }
      return '';
    }
  }
  return '';
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

function getTeamOutDir(team) {
  return path.join(ROOT, 'data', 'teams', team.slug);
}

function getTeamDataRelUrl(team, fileName) {
  return `data/teams/${team.slug}/${fileName}`;
}

function upgradeHttpUrlsDeep(val) {
  if (typeof val === 'string') {
    return val.startsWith('http://') ? `https://${val.slice(7)}` : val;
  }
  if (Array.isArray(val)) return val.map(upgradeHttpUrlsDeep);
  if (val && typeof val === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(val)) {
      out[k] = upgradeHttpUrlsDeep(v);
    }
    return out;
  }
  return val;
}

async function fetchCsvGzSafe(primaryUrl, fallbackUrl = null, timeoutMs = 15000) {
  for (const u of [primaryUrl, fallbackUrl].filter(Boolean)) {
    try {
      const res = await fetch(u, { headers: UA_HEADERS, signal: AbortSignal.timeout(timeoutMs) });
      if (!res.ok) continue;
      const buf = Buffer.from(await res.arrayBuffer());
      const txt = u.endsWith('.gz') ? zlib.gunzipSync(buf).toString('utf8') : buf.toString('utf8');
      const rows = parseCsv(txt);
      if (rows.length > 0) return rows;
    } catch {
      // try fallback
    }
  }
  return [];
}

function buildTeamCapBlueprint(team, capYears = {}, capPlayers = [], seasonYear = 2026) {
  const yrKey = capYears?.[String(seasonYear)]
    ? String(seasonYear)
    : Object.keys(capYears || {}).sort()[0] || String(seasonYear);
  const nextYrNum = Number(yrKey) + 1;
  const nextYrKey = String(nextYrNum);
  const otcTeamUrl = `https://overthecap.com/salary-cap/${team.otcSlug}`;

  const topSeason = [...(capPlayers || [])]
    .filter(p => p.contractsByYear?.[yrKey])
    .sort((a, b) => (b.contractsByYear[yrKey].capNumber || 0) - (a.contractsByYear[yrKey].capNumber || 0));

  const restructureCandidates = topSeason
    .filter(p => (p.contractsByYear[yrKey]?.transactions?.restructure?.capSavings || 0) >= 1_000_000)
    .slice(0, 6)
    .map(p => ({
      id: p.id || p.otcId,
      name: p.name,
      position: p.position || 'VET',
      jersey: p.jersey ?? null,
      headshotUrl: p.headshotUrl || '',
      otcUrl: sanitizeExternalUrl(p.otcUrl, otcTeamUrl),
      capHit2026: p.contractsByYear[yrKey].capNumber,
      baseSalary2026: p.contractsByYear[yrKey].baseSalary,
      maxRestructureSavings: p.contractsByYear[yrKey].transactions.restructure.capSavings,
      rationale: 'High base/option conversion capacity over remaining contract + void years; preserves immediate rollover cap.'
    }));

  const cutOrTradeCandidates = topSeason
    .filter(p => {
      const tx = p.contractsByYear[yrKey]?.transactions;
      return (tx?.june_1_trade?.capSavings || 0) >= 2_000_000 || (tx?.june_1_cut?.capSavings || 0) >= 2_000_000;
    })
    .slice(0, 6)
    .map(p => {
      const cur = p.contractsByYear[yrKey];
      return {
        id: p.id || p.otcId,
        name: p.name,
        position: p.position || 'VET',
        jersey: p.jersey ?? null,
        headshotUrl: p.headshotUrl || '',
        otcUrl: sanitizeExternalUrl(p.otcUrl, otcTeamUrl),
        capHit2026: cur.capNumber,
        postJune1CutSavings: cur.transactions.june_1_cut.capSavings,
        postJune1TradeSavings: cur.transactions.june_1_trade.capSavings,
        preJune1DeadMoney: cur.transactions.cut.deadMoney,
        rationale: `Significant ${yrKey}/${nextYrNum} cash and cap relief via Post-June 1 trade or release designation.`
      };
    });

  const grossSpace = Number(capYears?.[yrKey]?.teamCapSpace || 0);
  const effSpace = Number(capYears?.[yrKey]?.effectiveCapSpace ?? Math.max(0, grossSpace - 5_000_000));
  const nextGrossSpace = Number(capYears?.[nextYrKey]?.teamCapSpace ?? 0);
  const nextCeilingM = Math.round(Number(capYears?.[nextYrKey]?.capCeiling || 327_000_000) / 1e6);
  const grossM = (grossSpace / 1e6).toFixed(2);
  const effM = (effSpace / 1e6).toFixed(2);
  const nextSpaceAbsM = (Math.abs(nextGrossSpace) / 1e6).toFixed(2);
  const rolloverLowM = Math.max(4, Math.round(Math.max(0, grossSpace - 7_000_000) / 1e6));
  const rolloverHighM = Math.max(rolloverLowM + 2, Math.round(Math.max(0, grossSpace - 3_000_000) / 1e6));
  const topCoreNames = topSeason.slice(0, 4).map(p => p.name).join(', ') || `${team.nickname} veteran core`;
  const gmLabel = team.coachesSeed?.gm ? `${team.coachesSeed.gm} and the ${team.nickname} front office` : `${team.fullName}`;

  const summary = `${team.fullName} hold $${grossM}M in ${yrKey} OverTheCap space ($${effM}M effective) and ${nextGrossSpace < 0 ? `-$${nextSpaceAbsM}M` : `+$${nextSpaceAbsM}M`} projected for ${nextYrNum}.`;
  return {
    sourceUrl: otcTeamUrl,
    summary,
    executiveSummary: `${gmLabel} hold $${grossM}M in gross ${yrKey} cap space ($${effM}M effective), while ${nextYrNum} currently projects at ${nextGrossSpace < 0 ? `-$${nextSpaceAbsM}M over` : `+$${nextSpaceAbsM}M under`} an estimated $${nextCeilingM}M cap ceiling. Rolling unused ${yrKey} cap space 1-for-1 under CBA Article 13 ($${rolloverLowM}M–$${rolloverHighM}M target) helps manage scheduled cap escalations for ${topCoreNames}.`,
    strategicPillars: [
      {
        title: `1. CBA Article 13 Rollover Bridge ($${rolloverLowM}M–$${rolloverHighM}M Target vs. ${nextGrossSpace < 0 ? `-$${nextSpaceAbsM}M` : `+$${nextSpaceAbsM}M`} ${nextYrNum} Projection)`,
        detail: `Unused ${yrKey} cap space carries over dollar-for-dollar into ${nextYrNum}, buffering ${team.city}'s projected ${nextYrNum} ledger without forcing premature void-year restructures.`
      },
      {
        title: '2. Prorated Base Salary & Option-Bonus Architecture',
        detail: `Converting base salary or option bonuses spreads cap charges across up to 5 years (including void years) while preserving weekly in-season flexibility.`
      }
    ],
    restructureCandidates,
    cutOrTradeCandidates
  };
}

function decodeXmlEntities(str = '') {
  return stripHtmlAndDecodeEntities(str);
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
  const mergedRawReps = [
    ...(loc.reporters || []).map(r => ({ ...r, scope: r.scope || 'local' })),
    ...(nat.reporters || []).map(r => ({ ...r, scope: 'national' }))
  ];
  for (const r of mergedRawReps) {
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
async function loadSharedLeagueContext(seasonYear = 2026, { geminiApiKey = '' } = {}) {
  console.log('[stage-1] Fetching league-wide shared datasets (standings, 32-team stats, OTC ceilings, schedule, nflverse players/combine/stats/snaps, live mock drafts, big board)...');
  const nextDraftYear = seasonYear + 1;
  const prevSeasonYear = seasonYear - 1;
  const NFLVERSE_BASE = 'https://github.com/nflverse/nflverse-data/releases/download';
  const [
    standingsRaw,
    otcSpaceHtml,
    rotowireXml,
    pftRssXml,
    nfltrRssXml,
    ytNflXml,
    ytQbSchoolXml,
    ytKollmannXml,
    ytChaseDanielXml,
    nflverse,
    statsTeamReg,
    statsTeamWeek,
    tkMockHtml,
    dtMockHtml,
    wfMock1Html,
    wfMock2Html,
    nationalFilmXItems,
    liveDraftBigBoardIntel,
    aiModelDiscovery
  ] = await Promise.all([
    fetchJsonSafe('https://site.web.api.espn.com/apis/v2/sports/football/nfl/standings', 14000),
    fetchTextSafe('https://overthecap.com/salary-cap-space', 14000),
    fetchTextSafe('https://www.rotowire.com/rss/news.php?sport=NFL', 10000),
    fetchTextSafe('https://www.nbcsports.com/nfl/profootballtalk.rss', 10000),
    fetchTextSafe('https://nfltraderumors.co/feed/', 10000),
    fetchTextSafe('https://www.youtube.com/feeds/videos.xml?channel_id=UCDVYQ4Zhbm3S2dlz7P1GBDg', 10000),
    fetchTextSafe('https://www.youtube.com/feeds/videos.xml?channel_id=UCGfxHp2yuimtLsFaq1r7aIQ', 10000),
    fetchTextSafe('https://www.youtube.com/feeds/videos.xml?channel_id=UCYzfVBuCfGz-oF3aOCGgOmw', 10000),
    fetchTextSafe('https://www.youtube.com/feeds/videos.xml?channel_id=UCSnTko7TBHGlGlA7yvzQVpA', 10000),
    loadSharedNflversePlayerContext(seasonYear),
    fetchCsvGzSafe(
      `${NFLVERSE_BASE}/stats_team/stats_team_reg_${seasonYear}.csv.gz`,
      `${NFLVERSE_BASE}/stats_team/stats_team_reg_${prevSeasonYear}.csv.gz`
    ),
    fetchCsvGzSafe(
      `${NFLVERSE_BASE}/stats_team/stats_team_week_${seasonYear}.csv.gz`,
      `${NFLVERSE_BASE}/stats_team/stats_team_week_${prevSeasonYear}.csv.gz`
    ),
    fetchTextSafe('https://www.tankathon.com/nfl/mock_draft', 14000),
    fetchTextSafe(`https://www.drafttek.com/${nextDraftYear}-NFL-Mock-Draft/${nextDraftYear}-NFL-Mock-Draft-Round-1.asp`, 14000),
    fetchTextSafe(`https://walterfootball.com/draft${nextDraftYear}.php`, 14000),
    fetchTextSafe(`https://walterfootball.com/draft${nextDraftYear}_1.php`, 14000),
    fetchXTimelinesBatch(
      process.env.X_BEARER_TOKEN
        ? NATIONAL_FILM_ANALYTICS_X_HANDLES
        : selectRotatingXHandleSlice(NATIONAL_FILM_ANALYTICS_X_HANDLES, {
            maxPerRun: 4,
            bucketMinutes: 30,
            seedOffset: 0
          }),
      {
        concurrency: 1,
        spacingMs: 450,
        timeoutMs: 4500,
        maxAgeHours: 120,
        maxItems: 14
      }
    ).catch(() => []),
    fetchLive2027ConsensusBigBoardAndMocks({
      draftYear: nextDraftYear,
      nowMs: Date.now()
    }).catch(() => null),
    discoverBestFreeGeminiModel(geminiApiKey, { timeoutMs: 7000 }).catch(() => ({
      activeModel: PRIMARY_GEMINI_REASONING_MODEL,
      thinkingLevel: 'XHIGH',
      source: 'fallback',
      candidateCascade: [PRIMARY_GEMINI_REASONING_MODEL, 'gemini-3.8-flash']
    }))
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
      const confRec = getStat('vs. Conf.')?.displayValue || getStat('conferenceRecord')?.displayValue || '0-0';
      const homeRec = getStat('Home')?.displayValue || getStat('home')?.displayValue || '';
      const awayRec = getStat('Road')?.displayValue || getStat('Away')?.displayValue || getStat('away')?.displayValue || '';
      const streak = getStat('streak')?.displayValue || '';
      const clincher = getStat('clincher')?.displayValue || '';
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
        confRec,
        homeRec,
        awayRec,
        streak,
        clincher
      });
    }
  }

  // Pull shared league artifacts (260-prospect 3-Lens Draft Big Board, Combine Leaderboard,
  // 272-game league schedule & 32-team base metrics) from existing verified data if present
  const sfSeasonalPath = path.join(ROOT, 'data', 'teams', '49ers', 'seasonal.json');
  const sfMatchupPath = path.join(ROOT, 'data', 'teams', '49ers', 'schedule-matchup.json');
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
  const liveScoresByMatchup = {};
  const espnWeatherByGameId = new Map();
  for (const sb of sbPayloads) {
    Object.assign(liveScoresByMatchup, extractLiveScoreboardMap(sb));
    for (const ev of sb?.events || []) {
      const comp = ev.competitions?.[0];
      if (!comp) continue;
      if (ev.id) {
        const w = ev.weather || comp.weather || null;
        espnWeatherByGameId.set(String(ev.id), {
          indoor: comp.venue?.indoor,
          tempF: w?.temperature != null ? Math.round(Number(w.temperature)) : null,
          condition: String(w?.displayValue || '').trim()
        });
      }
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

  // Compute live 32-team 4-unit Team Stats template ONCE in Stage 1 (zero dependency on stale SF files!)
  let freshTeamStatsTemplate = null;
  const regTeams = Array.isArray(statsTeamReg) ? statsTeamReg.filter(r => r.season_type === 'REG' && r.team) : [];
  if (regTeams.length >= 28) {
    const espnTeamStatsByAbbr = new Map();
    const allClubTeams = [...ALL_NFL_TEAMS];
    for (let i = 0; i < allClubTeams.length; i += 8) {
      const slice = allClubTeams.slice(i, i + 8);
      await Promise.all(
        slice.map(async club => {
          const stJson = await fetchJsonSafe(
            `https://site.api.espn.com/apis/site/v2/sports/football/nfl/teams/${club.espnAbbr}/statistics`,
            7000
          );
          if (!stJson) return;
          const ownCats = stJson?.results?.stats?.categories || [];
          const oppRaw = stJson?.results?.opponent;
          const oppCats = Array.isArray(oppRaw) ? oppRaw : oppRaw?.categories || [];
          const findVal = (cats, catName, statName) => {
            const c = cats.find(x => x.name === catName);
            const s = c?.stats?.find(x => x.name === statName);
            return s?.value != null && Number.isFinite(Number(s.value)) ? Number(s.value) : null;
          };
          espnTeamStatsByAbbr.set(club.abbr, {
            gamesPlayed:
              findVal(ownCats, 'general', 'gamesPlayed') ??
              findVal(ownCats, 'passing', 'teamGamesPlayed'),
            offThirdDownPct: findVal(ownCats, 'miscellaneous', 'thirdDownConvPct'),
            defThirdDownPctAllowed: findVal(oppCats, 'miscellaneous', 'thirdDownConvPct'),
            offRedZoneTdPct: findVal(ownCats, 'miscellaneous', 'redzoneTouchdownPct'),
            defRedZoneTdPctAllowed: findVal(oppCats, 'miscellaneous', 'redzoneTouchdownPct'),
            takeaways: findVal(ownCats, 'miscellaneous', 'totalTakeaways'),
            giveaways: findVal(ownCats, 'miscellaneous', 'totalGiveaways'),
            turnoverDiff: findVal(ownCats, 'miscellaneous', 'turnOverDifferential'),
            netPassingYards: findVal(ownCats, 'passing', 'netPassingYards'),
            oppNetPassingYards: findVal(oppCats, 'passing', 'netPassingYards'),
            oppRushingYards: findVal(oppCats, 'rushing', 'rushingYards'),
            puntNetAvg: findVal(ownCats, 'punting', 'netAvgPuntYards'),
            krAvg: findVal(ownCats, 'returning', 'yardsPerKickReturn'),
            prAvg: findVal(ownCats, 'returning', 'yardsPerPuntReturn'),
            oppKrAvg: findVal(oppCats, 'returning', 'yardsPerKickReturn'),
            oppPrAvg: findVal(oppCats, 'returning', 'yardsPerPuntReturn')
          });
        })
      );
    }
    const teamRecordsMap = new Map();
    for (const [abbr, st] of standingsByAbbr.entries()) {
      teamRecordsMap.set(abbr, {
        wins: st.wins,
        losses: st.losses,
        ties: st.ties,
        pointsFor: st.pf,
        pointsAgainst: st.pa,
        pointDiff: st.pd,
        gamesPlayed: st.wins + st.losses + st.ties
      });
    }
    try {
      const payload = computeLeagueTeamStatsPayload({
        regTeams,
        statsTeamWeek: statsTeamWeek || [],
        espnTeamStatsByAbbr,
        teamRecordsMap,
        seasonYear
      });
      if (payload?.teamStats?.units?.length) {
        freshTeamStatsTemplate = payload.teamStats;
      }
    } catch {
      // fallback below
    }
  }

  const existingBoardLen = Array.isArray(sfSeasonal?.draftPrep2027?.consensusBigBoard)
    ? sfSeasonal.draftPrep2027.consensusBigBoard.length
    : 0;
  const liveBigBoard =
    Array.isArray(liveDraftBigBoardIntel?.consensusBigBoard) &&
    liveDraftBigBoardIntel.consensusBigBoard.length >= Math.max(250, existingBoardLen)
      ? liveDraftBigBoardIntel.consensusBigBoard
      : sfSeasonal?.draftPrep2027?.consensusBigBoard || liveDraftBigBoardIntel?.consensusBigBoard || [];

  const youtubeFeeds = [
    { id: 'nfl_official', name: 'NFL', handle: '@NFL', xml: ytNflXml, category: 'highlights', embeddable: false },
    { id: 'the_qb_school', name: 'The QB School', handle: '@TheQBSchool', xml: ytQbSchoolXml, category: 'film', embeddable: true },
    { id: 'brett_kollmann', name: 'Brett Kollmann', handle: '@BrettKollmann', xml: ytKollmannXml, category: 'film', embeddable: true },
    { id: 'chase_daniel', name: 'Chase Daniel', handle: '@ChaseDaniel', xml: ytChaseDanielXml, category: 'film', embeddable: true }
  ];

  // Stage-1 deduplicated embeddability verification for all national film YouTube videos (detects NFL Content ID blocks once for all 32 teams!)
  const nationalFilmVidIds = new Set();
  const stage1CutoffMs = Date.now() - 62 * 86_400_000;
  for (const ytFeed of youtubeFeeds) {
    if (ytFeed.embeddable === false) continue;
    for (const m of (ytFeed.xml || '').matchAll(/<entry\b[\s\S]*?<\/entry>/gi)) {
      const b = m[0];
      const vid = (b.match(/<yt:videoId>([^<]+)<\/yt:videoId>/i) || [])[1]?.trim() || '';
      const pubRaw = (b.match(/<published>([^<]+)<\/published>/i) || [])[1]?.trim() || '';
      const pubMs = pubRaw ? Date.parse(pubRaw) : NaN;
      if (vid && Number.isFinite(pubMs) && pubMs >= stage1CutoffMs) {
        nationalFilmVidIds.add(vid);
      }
    }
  }
  const youtubeEmbeddableById = new Map();
  const vidIdList = [...nationalFilmVidIds];
  for (let i = 0; i < vidIdList.length; i += 8) {
    const chunk = vidIdList.slice(i, i + 8);
    const checks = await Promise.all(
      chunk.map(async vid => [vid, await verifyYouTubeEmbeddable(vid)])
    );
    for (const [vid, check] of checks) {
      youtubeEmbeddableById.set(vid, check);
    }
  }

  // Load & periodically refresh unified Two-Pool Gemini Quota & Model Registry (`data/league/gemini-quota-state.json`)
  // Polls `/v1beta/models` at most once every 24h to automatically discover newly launched premier/lite models & drop deprecated ones!
  const quotaStatePath = path.join(leagueDir, 'gemini-quota-state.json');
  let rawQuotaState = null;
  try {
    if (fs.existsSync(quotaStatePath)) {
      rawQuotaState = JSON.parse(fs.readFileSync(quotaStatePath, 'utf8'));
    }
  } catch {}
  const quotaRefresh = await refreshGeminiModelCatalogIfDue(
    normalizeGeminiQuotaState(rawQuotaState, Date.now()),
    geminiApiKey,
    { nowMs: Date.now(), timeoutMs: 7000 }
  );
  const quotaState = quotaRefresh.state;
  const persistQuotaState = () => {
    try {
      fs.writeFileSync(quotaStatePath, JSON.stringify(quotaState, null, 2));
    } catch {}
  };
  if (quotaRefresh.refreshed) {
    persistQuotaState();
    console.log(
      `[stage-1/gemini-catalog] Auto-refreshed AI Studio catalog: premier=[${quotaState.pools.premier.join(', ')}], lite=[${quotaState.pools.lite.join(', ')}]`
    );
  }

  // Option B (Stage 1 Shared National Film & Analytics Discovery):
  // Only runs when explicitly enabled (`ENABLE_GEMINI_X_SEARCH=1`) and Search Grounding quota is available,
  // preventing wasted HTTP 429 attempts on free-tier keys with 0 Search Grounding quota.
  const natDiscoveryPath = path.join(leagueDir, 'x-film-discovery.json');
  let prevNatDiscovery = null;
  try {
    if (fs.existsSync(natDiscoveryPath)) {
      prevNatDiscovery = JSON.parse(fs.readFileSync(natDiscoveryPath, 'utf8'));
    }
  } catch {}
  const natNowMs = Date.now();
  const natCutoffMs = natNowMs - 96 * 3_600_000;
  let sharedDiscoveredRawItems = (Array.isArray(prevNatDiscovery?.rawItems) ? prevNatDiscovery.rawItems : []).filter(
    it => it?.statusId && Number.isFinite(Date.parse(it.publishedAt || '')) && Date.parse(it.publishedAt) >= natCutoffMs
  );
  const xSearchEnabled = process.env.ENABLE_GEMINI_X_SEARCH === '1' && isSearchGroundingAllowed(quotaState, natNowMs);
  const natPlan = resolveGeminiXDiscoveryPlan({
    scope: 'national',
    nowMs: natNowMs,
    prevMeta: prevNatDiscovery,
    hasApiKey: Boolean(geminiApiKey && xSearchEnabled),
    force: process.argv.includes('--force-x-discovery')
  });
  if (natPlan.shouldRun) {
    const natHandles =
      natPlan.slotKey === 'pm'
        ? GEMINI_X_DISCOVERY_QUOTA_POLICY.nationalAnalyticsChartHandles
        : GEMINI_X_DISCOVERY_QUOTA_POLICY.nationalVideoHandles;
    const natDisc = await discoverXStatusesViaGeminiSearch({
      scope: 'national',
      slotKey: natPlan.slotKey,
      handles: natHandles,
      apiKey: geminiApiKey,
      modelCascade: natPlan.modelCascade,
      nowMs: natNowMs
    }).catch(() => ({ ok: false, statusUrls: [] }));
    if (natDisc.ok) {
      const freshlyHydrated = await hydrateRawXStatusUrlsBatch(natDisc.statusUrls || [], {
        nowMs: natNowMs,
        maxHydrate: 24,
        concurrency: 4
      }).catch(() => []);
      const mergedBySid = new Map();
      for (const it of [...freshlyHydrated, ...sharedDiscoveredRawItems]) {
        if (it?.statusId && !mergedBySid.has(String(it.statusId))) {
          mergedBySid.set(String(it.statusId), it);
        }
      }
      sharedDiscoveredRawItems = [...mergedBySid.values()].slice(0, 60);
      const nextSlots = Array.from(new Set([...(natPlan.completedSlotsToday || []), natPlan.slotKey]));
      try {
        fs.writeFileSync(
          natDiscoveryPath,
          JSON.stringify(
            {
              updatedAt: new Date(natNowMs).toISOString(),
              datePt: natPlan.datePt,
              completedSlots: nextSlots,
              lastModelUsed: natDisc.modelUsed || null,
              lastUrlCount: (natDisc.statusUrls || []).length,
              rawItems: sharedDiscoveredRawItems
            },
            null,
            2
          )
        );
      } catch {}
      console.log(
        `[stage-1/x-discovery] National ${natPlan.slotKey.toUpperCase()} sweep (${natDisc.modelUsed}): found=${(natDisc.statusUrls || []).length} URLs, hydrated=${freshlyHydrated.length}, cached96h=${sharedDiscoveredRawItems.length}`
      );
    }
  }
  const combinedNationalFilmXItems = [];
  const seenNatSid = new Set();
  for (const it of [...(Array.isArray(nationalFilmXItems) ? nationalFilmXItems : []), ...sharedDiscoveredRawItems]) {
    const sid = String(it?.statusId || (String(it?.url || '').match(/\/status\/(\d{15,22})/) || [])[1] || '');
    if (sid && seenNatSid.has(sid)) continue;
    if (sid) seenNatSid.add(sid);
    combinedNationalFilmXItems.push(it);
  }

  return {
    seasonYear,
    aiModelDiscovery,
    quotaState,
    persistQuotaState,
    standingsByAbbr,
    otcSpaceHtml,
    rotowireXml,
    pftRssXml,
    nfltrRssXml,
    youtubeFeeds,
    youtubeEmbeddableById,
    nflverse,
    leagueTradeCtx,
    powerRankingsPayloads,
    completedGames: reconciledLeagueGames.completedGames,
    remainingGames: reconciledLeagueGames.remainingGames,
    sharedPreseasonPriors: sfSeasonal?.playoffPicture?.simulatorInputs?.preseasonPriors || {},
    sharedWeeklyTeamStats: sfSeasonal?.playoffPicture?.simulatorInputs?.weeklyTeamStats || null,
    sharedInjuryAdjustments: sfSeasonal?.playoffPicture?.simulatorInputs?.injuryAdjustmentsByTeam || null,
    liveScoresByMatchup,
    espnWeatherByGameId,
    baseTeamStatsTemplate: freshTeamStatsTemplate || sfMatchup?.teamStats || null,
    sharedBigBoard: liveBigBoard,
    sharedBigBoardMeta: liveDraftBigBoardIntel?.bigBoardMeta || sfSeasonal?.draftPrep2027?.bigBoardMeta || null,
    sharedBigBoardMethodology:
      liveDraftBigBoardIntel?.bigBoardMethodology || sfSeasonal?.draftPrep2027?.bigBoardMethodology || null,
    sharedCombineLeaderboard: sfSeasonal?.draftPrep2027?.combineLeaderboard || null,
    leagueMockHtmls: { tkMockHtml, dtMockHtml, wfMock1Html, wfMock2Html },
    nationalFilmXItems: combinedNationalFilmXItems
  };
}

function buildTeamKeyMatchupsMatrix({
  team,
  oppAbbr = '',
  oppName = 'Opponent',
  players = [],
  oppActiveRoster = [],
  oppKeyStartersHealthy = [],
  teamStats = null
} = {}) {
  const cleanOpp = String(oppAbbr || '').toUpperCase().trim();
  const oppShort = String(oppName || 'Opponent').split(/\s+/).pop() || cleanOpp || 'Opponent';
  if (!cleanOpp || cleanOpp === 'TBD' || cleanOpp === 'BYE') return [];

  const allMetrics = (teamStats?.units || []).flatMap(u => [...(u.coreRows || []), ...(u.extraRows || [])]);
  const getMetricFor = (abbr, labelRe, fallbackDisp = '—') => {
    const m = allMetrics.find(x => labelRe.test(String(x?.label || x?.key || '')));
    const hit = (m?.leaderboard || []).find(e => String(e?.team || '').toUpperCase() === abbr);
    return {
      rank: Number(hit?.rank || 16),
      val: Number(hit?.val || 0),
      disp: hit?.disp || fallbackDisp
    };
  };

  const ourPassOff = getMetricFor(team.abbr, /pass.*epa|passing\s+yards|pass\s+off/i, 'Top-15');
  const ourRushOff = getMetricFor(team.abbr, /rush.*epa|rushing\s+yards|rush\s+off/i, 'Balanced');
  const ourSackAllow = getMetricFor(team.abbr, /sack\s+rate\s+allow|sacks\s+allow/i, '6.0%');
  const ourPassDef = getMetricFor(team.abbr, /pass.*epa\s+allow|pass\s+yds\s+allow|pass\s+def/i, 'Mid-Tier');
  const ourDefSacks = getMetricFor(team.abbr, /sacks?\s*(?:\/|\s+per)\s*gm|def.*sack/i, '2.3/gm');
  const ourOffEpa = getMetricFor(team.abbr, /off.*epa|points\s+per\s+game|ppg/i, '24.0');

  const oppPassOff = getMetricFor(cleanOpp, /pass.*epa|passing\s+yards|pass\s+off/i, 'Mid-Tier');
  const oppPassDef = getMetricFor(cleanOpp, /pass.*epa\s+allow|pass\s+yds\s+allow|pass\s+def/i, 'Mid-Tier');
  const oppRushDef = getMetricFor(cleanOpp, /rush.*epa\s+allow|rush\s+yds\s+allow|yards\/carry\s+allow/i, 'Mid-Tier');
  const oppDefSacks = getMetricFor(cleanOpp, /sacks?\s*(?:\/|\s+per)\s*gm|def.*sack/i, '2.4/gm');
  const oppSackAllow = getMetricFor(cleanOpp, /sack\s+rate\s+allow|sacks\s+allow/i, '6.5%');

  const activePool = (players || [])
    .filter(p => p && p.rosterBucket === 'active' && (p.health?.playProbabilityPct ?? 95) >= 35)
    .sort((a, b) => Number(b.primarySnapPct || 0) - Number(a.primarySnapPct || 0) || Number(b.capHit2026 || 0) - Number(a.capHit2026 || 0));
  const pickOurs = (posRe, count = 2, fallback = []) => {
    const out = activePool.filter(p => posRe.test(String(p.position || ''))).slice(0, count);
    return out.length > 0 ? out : fallback;
  };
  const oppPool = [...(oppKeyStartersHealthy || []), ...(oppActiveRoster || [])].filter(p => p?.name);
  const pickOpp = (posRe, fallbackLabel) => {
    const hit = oppPool.find(p => posRe.test(String(p.position || '')));
    return hit ? `${hit.position} ${hit.name}` : fallbackLabel;
  };
  const fmtStar = p => (p?.jersey != null ? `${p.name} (#${p.jersey})` : p?.name || '');

  const qb = pickOurs(/^QB$/i, 1)[0];
  const te = pickOurs(/^TE$/i, 1)[0];
  const wrs = pickOurs(/^WR$/i, 2);
  const rb = pickOurs(/^RB$/i, 1)[0];
  const fb = pickOurs(/^FB$/i, 1)[0];
  const edgeDls = pickOurs(/^(?:DE|EDGE|OLB|DT|DL|NT)$/i, 3);
  const dbsLbs = pickOurs(/^(?:CB|S|SS|FS|LB|MLB|ILB)$/i, 3);
  const ols = pickOurs(/^(?:OT|LT|RT|OG|LG|RG|C|G|T|OL)$/i, 3);

  const oppQb = pickOpp(/^QB$/i, `${oppShort} QB`);
  const oppWr = pickOpp(/^WR$/i, `${oppShort} WR1`);
  const oppEdge = pickOpp(/^(?:DE|EDGE|OLB|DT|DL)$/i, `${oppShort} Pass Rush`);
  const oppCb = pickOpp(/^(?:CB|S|DB)$/i, `${oppShort} Secondary`);
  const oppLb = pickOpp(/^(?:LB|ILB|MLB)$/i, `${oppShort} Linebackers`);
  const oppOl = pickOpp(/^(?:OT|LT|RT|C|OG|G|T)$/i, `${oppShort} Offensive Line`);

  const ourLabel = team.abbr;
  const passOffAdv = classifySymmetricUnitAdvantage(ourPassOff.rank, oppPassDef.rank, cleanOpp, {
    tieLabel: 'Even Star Clash',
    strengthVsStrengthLabel: 'Strength vs. Strength',
    sfEdgeLabel: `${ourLabel} Edge`,
    sfHeavyLabel: `${ourLabel} Heavy Edge`
  });
  const rushVsOlAdv = classifySymmetricUnitAdvantage(ourDefSacks.rank, oppSackAllow.rank, cleanOpp, {
    tieLabel: 'Even Trench Battle',
    strengthVsStrengthLabel: 'Strength vs. Strength',
    sfEdgeLabel: `${ourLabel} Trench Edge`,
    sfHeavyLabel: `${ourLabel} Heavy Edge`,
    oppEdgeLabel: `${cleanOpp} Trench Edge`
  });
  const covVsPassAdv = classifySymmetricUnitAdvantage(ourPassDef.rank, oppPassOff.rank, cleanOpp, {
    tieLabel: 'Even Star Clash',
    strengthVsStrengthLabel: 'Strength vs. Strength',
    sfEdgeLabel: `${ourLabel} Edge`,
    sfHeavyLabel: `${ourLabel} Heavy Edge`
  });
  const runVsDefAdv = classifySymmetricUnitAdvantage(ourRushOff.rank, oppRushDef.rank, cleanOpp, {
    tieLabel: 'Even Trench Battle',
    strengthVsStrengthLabel: 'Strength vs. Strength',
    sfEdgeLabel: `${ourLabel} Trench Edge`,
    sfHeavyLabel: `${ourLabel} Heavy Edge`
  });
  const olVsRushAdv = classifySymmetricUnitAdvantage(ourSackAllow.rank, oppDefSacks.rank, cleanOpp, {
    tieLabel: 'Even Trench Battle',
    strengthVsStrengthLabel: 'Strength vs. Strength',
    sfEdgeLabel: `${ourLabel} Trench Edge`,
    sfHeavyLabel: `${ourLabel} Heavy Edge`,
    oppEdgeLabel: `${cleanOpp} Edge`
  });

  const c1Players = [qb, te, wrs[0]].filter(Boolean);
  const c2Players = edgeDls.slice(0, 3);
  const c3Players = dbsLbs.slice(0, 3);
  const c4Players = [rb, fb || wrs[1]].filter(Boolean);
  const c5Players = ols.slice(0, 3);

  const joinP = arr => arr.map(p => p.name).join(', ').replace(/, ([^,]+)$/, ' & $1') || `${team.nickname} Unit`;

  return [
    {
      phaseTag: 'Middle-Field Passing Spine',
      unitMatchup: `${joinP(c1Players)} vs. ${oppCb} & ${oppLb}`,
      advantage: passOffAdv,
      sfPlayers: c1Players.map(p => p.name),
      statComparison: `${ourLabel}: #${ourPassOff.rank} Pass Off (${ourPassOff.disp}) · #${ourOffEpa.rank} Off. Scoring (${ourOffEpa.disp}) | ${cleanOpp}: #${oppPassDef.rank} Pass Def (${oppPassDef.disp})`,
      tacticalDetail: `${joinP(c1Players)} attack the intermediate seams and middle-of-the-field leverage windows against ${oppName}'s #${oppPassDef.rank} pass defense (${oppPassDef.disp}). Winning early-down timing throws keeps ${team.city}'s offense ahead of the chains and punishes disguised single-high rotations.`,
      filmTell: `Watch ${fmtStar(c1Players[0]) || team.nickname} scanning ${oppShort}'s deep safeties at the snap—when ${oppLb} widens to take away the crossers, the intermediate seam opens immediately for ${fmtStar(c1Players[1] || c1Players[0])}.`
    },
    {
      phaseTag: 'Front-Four Pass-Rush Stress',
      unitMatchup: `${joinP(c2Players)} vs. ${oppQb} & ${oppOl}`,
      advantage: rushVsOlAdv,
      sfPlayers: c2Players.map(p => p.name),
      statComparison: `${ourLabel}: #${ourDefSacks.rank} Def Sacks (${ourDefSacks.disp}) | ${cleanOpp}: #${oppSackAllow.rank} Pass Protection (${oppSackAllow.disp})`,
      tacticalDetail: `${joinP(c2Players)} lead ${team.city}'s #${ourDefSacks.rank} NFL pass rush (${ourDefSacks.disp}) against ${oppName}'s #${oppSackAllow.rank} pass-protection unit (${oppSackAllow.disp}). Collapsing the interior pocket without sending extra blitzers lets ${team.nickname} keep seven defenders in coverage.`,
      filmTell: `On 3rd-and-6+, watch whether ${fmtStar(c2Players[0]) || `${team.nickname} edge rushers`} draw chip help from ${oppShort}'s tight ends or backs—creating 1-on-1 rush lanes inside for ${fmtStar(c2Players[1] || c2Players[0])}.`
    },
    {
      phaseTag: 'Perimeter Coverage & Explosive Prevention',
      unitMatchup: `${joinP(c3Players)} vs. ${oppWr} & ${oppQb}`,
      advantage: covVsPassAdv,
      sfPlayers: c3Players.map(p => p.name),
      statComparison: `${ourLabel}: #${ourPassDef.rank} Pass Def (${ourPassDef.disp}) | ${cleanOpp}: #${oppPassOff.rank} Pass Off (${oppPassOff.disp})`,
      tacticalDetail: `${joinP(c3Players)} anchor ${team.city}'s #${ourPassDef.rank} pass defense (${ourPassDef.disp}) against ${oppWr} and ${oppName}'s #${oppPassOff.rank} passing attack (${oppPassOff.disp}). Limiting explosive 20+ yard chunk plays forces ${oppShort} into sustained red-zone drives.`,
      filmTell: `Track ${fmtStar(c3Players[0]) || `${team.nickname} boundary corners`} at the top of routes against ${oppWr}: press-bail alignment with safety help over the top takes away ${oppQb}'s preferred isolation shots.`
    },
    {
      phaseTag: 'Early-Down Ground Game & Run Fits',
      unitMatchup: `${joinP(c4Players)} vs. ${oppShort} Front Seven & ${oppLb}`,
      advantage: runVsDefAdv,
      sfPlayers: c4Players.map(p => p.name),
      statComparison: `${ourLabel}: #${ourRushOff.rank} Rush Off (${ourRushOff.disp}) | ${cleanOpp}: #${oppRushDef.rank} Rush Def (${oppRushDef.disp})`,
      tacticalDetail: `${joinP(c4Players)} test ${oppName}'s #${oppRushDef.rank} run defense (${oppRushDef.disp}) with horizontal stretch and interior cutback lanes. Generating 4.5+ yards on first down unlocks play-action explosives and neutralizes ${oppShort}'s pass-rush packages.`,
      filmTell: `Watch whether ${oppShort}'s linebackers over-pursue motion to the perimeter—opening decisive backside B-gap cutback lanes for ${fmtStar(c4Players[0]) || `${team.nickname}'s lead back`}.`
    },
    {
      phaseTag: 'Pocket Protection & Edge Containment',
      unitMatchup: `${joinP(c5Players)} vs. ${oppEdge} & ${oppShort} Simulated Pressures`,
      advantage: olVsRushAdv,
      sfPlayers: c5Players.map(p => p.name),
      statComparison: `${ourLabel}: #${ourSackAllow.rank} Pass Protection (${ourSackAllow.disp}) | ${cleanOpp}: #${oppDefSacks.rank} Def Sacks (${oppDefSacks.disp})`,
      tacticalDetail: `${joinP(c5Players)} protect ${qb?.name || `${team.nickname}'s quarterback`} (#${ourSackAllow.rank} protection at ${ourSackAllow.disp}) against ${oppEdge} and ${oppName}'s #${oppDefSacks.rank} pass rush (${oppDefSacks.disp}). Passing off interior twists and simulated blitzes cleanly determines late-down conversion efficiency.`,
      filmTell: `Watch ${fmtStar(c5Players[0]) || `${team.nickname}'s blindside tackle`} on obvious passing downs—if ${oppEdge} cannot win clean around the arc, ${oppShort} must dial up interior stunts that stress ${fmtStar(c5Players[1] || c5Players[0])}.`
    }
  ];
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
      displayValue: m.displayValue,
      rank: m.rank,
      leagueAvg: m.leagueAvgDisplay,
      higherIsBetter: m.higherIsBetter
    }));

  return { teamStats: tpl, teamStatRankings };
}

function buildConferencePlayoffPicture(team, leagueCtx, { healthData = null, rosterPlayers = null } = {}) {
  const mergedInjuryAdjustments = {
    ...(leagueCtx.sharedInjuryAdjustments || {})
  };
  let needsFreshContext = !leagueCtx.sharedPlayoffCtx;
  if (healthData || (Array.isArray(rosterPlayers) && rosterPlayers.length > 0)) {
    const remForTeam =
      (leagueCtx.remainingGames || []).filter(g => g.home === team.abbr || g.away === team.abbr).length || 6;
    const teamSt = leagueCtx.standingsByAbbr.get(team.abbr);
    const teamGp = teamSt
      ? (Number(teamSt.wins) || 0) + (Number(teamSt.losses) || 0) + (Number(teamSt.ties) || 0)
      : null;
    const freshAdj = estimateTeamInjurySpreadAdjustments({
      healthData,
      rosterPlayers: rosterPlayers || [],
      remainingGamesCount: remForTeam,
      teamGamesPlayed: teamGp
    });
    const prevAdj = mergedInjuryAdjustments[team.abbr];
    if (
      !prevAdj ||
      Math.abs((prevAdj.totalGameSpreadAdj || 0) - (freshAdj.totalGameSpreadAdj || 0)) > 0.05 ||
      Math.abs((prevAdj.totalSeasonSpreadAdj || 0) - (freshAdj.totalSeasonSpreadAdj || 0)) > 0.05
    ) {
      mergedInjuryAdjustments[team.abbr] = freshAdj;
      needsFreshContext = true;
    }
  }

  const playoffCtx = needsFreshContext
    ? buildSharedLeaguePlayoffContext({
        standingsByAbbr: leagueCtx.standingsByAbbr,
        completedGames: leagueCtx.completedGames,
        remainingGames: leagueCtx.remainingGames,
        preseasonPriors: leagueCtx.sharedPreseasonPriors || {},
        weeklyTeamStats: leagueCtx.sharedWeeklyTeamStats || null,
        injuryAdjustmentsByTeam:
          Object.keys(mergedInjuryAdjustments).length > 0 ? mergedInjuryAdjustments : null,
        liveScoresByMatchup: leagueCtx.liveScoresByMatchup || {}
      })
    : leagueCtx.sharedPlayoffCtx;

  if (!leagueCtx.sharedPlayoffCtx) {
    leagueCtx.sharedPlayoffCtx = playoffCtx;
  }

  return buildPlayoffPictureForTeam(team, playoffCtx);
}

async function fetchRawBlueskyFeedsForReporters(reportersData) {
  const bskyReps = (reportersData.reporters || []).filter(r => r.bskyHandle);
  const rawEntries = [];
  const settled = await Promise.allSettled(
    bskyReps.map(async rep => {
      const url = `https://public.api.bsky.app/xrpc/app.bsky.feed.getAuthorFeed?actor=${encodeURIComponent(rep.bskyHandle)}&limit=20&filter=posts_no_replies`;
      const json = await fetchJsonSafe(url, 7000);
      if (!json?.feed?.length) return [];
      return json.feed.map(entry => ({ rep, entry }));
    })
  );
  for (const s of settled) {
    if (s.status === 'fulfilled' && Array.isArray(s.value)) rawEntries.push(...s.value);
  }
  return rawEntries;
}

function filterRawBlueskyPostsForTeam(rawEntries = [], team, rosterPlayers = []) {
  const items = [];
  const nickRe = new RegExp(`\\b(${team.keywordRules.requiredNicknames.join('|')})\\b`, 'i');
  const includeCity = !team.keywordRules?.excludeGenericCity && team.city && team.city !== team.nickname;
  const teamTerms = [
    team.fullName,
    ...(team.keywordRules.requiredNicknames || []),
    ...(includeCity ? [team.city] : []),
    team.coachesSeed?.hc,
    team.coachesSeed?.gm
  ]
    .filter(Boolean)
    .map(w => String(w).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const teamEntityRe = new RegExp(`\\b(?:${teamTerms.join('|')})\\b`, 'i');
  const activeStarFullNames = (Array.isArray(rosterPlayers) ? rosterPlayers : [])
    .filter(p => p?.name && (p.rosterBucket === 'active' || p.rosterBucket === 'ir'))
    .map(p => String(p.name).replace(/\s+(?:Jr\.?|Sr\.?|II|III|IV|V)$/i, '').trim())
    .filter(n => n.length >= 6);
  const starFullRe =
    activeStarFullNames.length > 0
      ? new RegExp(
          `\\b(?:${activeStarFullNames.slice(0, 75).map(n => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})\\b`,
          'i'
        )
      : null;

  for (const { rep, entry } of rawEntries) {
    if (entry?.reason) continue;
    const post = entry?.post;
    const rec = post?.record;
    if (!post || !rec?.text) continue;
    const text = normalizeMultilineSocialText(decodeHtmlEntities(String(rec.text)));
    const vidEmbed =
      post.embed?.$type === 'app.bsky.embed.video#view'
        ? post.embed
        : post.embed?.media?.$type === 'app.bsky.embed.video#view'
          ? post.embed.media
          : null;
    const vidDid = String(post.author?.did || '').trim();
    const vidCid = String(
      vidEmbed?.cid || rec.embed?.video?.ref?.$link || rec.embed?.media?.video?.ref?.$link || ''
    ).trim();
    const bskyVideoMp4Url =
      vidDid && vidCid
        ? `https://bsky.social/xrpc/com.atproto.sync.getBlob?did=${encodeURIComponent(vidDid)}&cid=${encodeURIComponent(vidCid)}`
        : '';
    const embedPhotos = extractBlueskyEmbedImages(post);
    const embedPhoto = embedPhotos[0] || '';
    const embedImg = vidEmbed?.thumbnail || embedPhoto || post.embed?.external?.thumb || '';
    const distinctEmbedPhotos = vidEmbed?.thumbnail
      ? embedPhotos.filter(u => u !== vidEmbed.thumbnail)
      : embedPhotos;
    const extUrl = sanitizeExternalUrl(post.embed?.external?.uri || '', null);
    const isTenorGif = Boolean(extUrl && /^https:\/\/(?:media|c)\.tenor\.com\/.+\.(?:gif|mp4)(?:\?|$)/i.test(extUrl));
    const resolvedVideoStreamUrl = isTenorGif ? extUrl : bskyVideoMp4Url || undefined;
    if (text.length < (embedImg || resolvedVideoStreamUrl ? 6 : 18)) continue;

    const isNational =
      rep.scope === 'national' ||
      rep.category === 'national_insider' ||
      rep.category === 'film_analyst' ||
      rep.category === 'analytics' ||
      rep.category === 'cap_analyst';
    const mentionsClubOrPlayer =
      nickRe.test(text) ||
      teamEntityRe.test(text) ||
      (team.abbr === 'SF' && hasExplicit49ersEntity(text)) ||
      Boolean(starFullRe && starFullRe.test(text));
    let isLeagueWideChart = false;
    let filmOnlyScope = false;
    if (isNational && !mentionsClubOrPlayer) {
      if (
        (rep.category === 'film_analyst' || rep.category === 'analytics') &&
        isLeagueWideFilmAnalyticsTweet(
          { title: text, fullText: text, authorHandle: rep.handle || '', imageUrl: embedImg },
          team
        )
      ) {
        isLeagueWideChart = true;
        filmOnlyScope = true;
      } else {
        continue;
      }
    }
    const rkey = String(post.uri || '').split('/').pop() || '';
    const bskyUrl = `https://bsky.app/profile/${rep.bskyHandle}/post/${rkey}`;
    const pubIso = rec.createdAt || post.indexedAt || new Date().toISOString();
    const ageDays = (Date.now() - Date.parse(pubIso)) / 86_400_000;
    if (!Number.isFinite(ageDays) || ageDays > 10) continue;
    const tweetDisplay = formatTweetBodyForDisplay(text, SHORT_TWEET_FULL_TEXT_LIMIT);
    const bskyInlineLinks = extractBlueskyInlineLinks(rec, post);
    const isFilmAnalystRep = rep.category === 'film_analyst' || rep.category === 'film' || rep.category === 'analytics';
    const resolvedCategory = isLeagueWideChart
      ? 'film'
      : classifyNewsItemCategory({
          type: 'tweet',
          title: tweetDisplay.text,
          fullText: text,
          videoStreamUrl: resolvedVideoStreamUrl,
          isAnimatedGif: isTenorGif,
          imageUrl: embedImg,
          hasInlineChartImage: Boolean(embedPhoto && (isLeagueWideChart || isFilmAnalystRep)),
          reporterId: rep.id,
          reporterCategory: rep.category,
          author: rep.name,
          authorHandle: rep.handle || '',
          outletName: rep.name,
          isLeagueWideFilmChart: isLeagueWideChart
        });
    items.push({
      id: `${team.abbr.toLowerCase()}_bsky_${hashShort(bskyUrl)}`,
      type: 'tweet',
      title: tweetDisplay.text,
      fullText: text,
      isFullTweet: tweetDisplay.isFullTweet,
      summary: '',
      imageUrl: embedImg,
      ...(distinctEmbedPhotos.length > (resolvedVideoStreamUrl ? 0 : 1) ? { imageUrls: distinctEmbedPhotos } : {}),
      videoStreamUrl: resolvedVideoStreamUrl,
      isAnimatedGif: isTenorGif || undefined,
      embeddable: Boolean(resolvedVideoStreamUrl) || undefined,
      isHighlightClip: Boolean(resolvedVideoStreamUrl) && resolvedCategory !== 'film' ? true : undefined,
      hasInlineChartImage:
        Boolean(
          distinctEmbedPhotos.length > 1 ||
            (embedPhoto && (isLeagueWideChart || isFilmAnalystRep || resolvedCategory === 'film'))
        ) || undefined,
      isLeagueWideFilmChart: isLeagueWideChart || undefined,
      filmOnlyScope: filmOnlyScope || undefined,
      imageAlt: `${rep.name} post`,
      publishedAt: new Date(pubIso).toISOString(),
      url: bskyUrl,
      externalUrl: !isTenorGif && extUrl && !isPaywalledPublisher(extUrl) ? extUrl : null,
      externalTitle: !isTenorGif && extUrl && !isPaywalledPublisher(extUrl) ? (post.embed?.external?.title ? decodeHtmlEntities(post.embed.external.title) : null) : null,
      ...(bskyInlineLinks.length > 0 ? { inlineLinks: bskyInlineLinks } : {}),
      ...(vidEmbed?.playlist ? { _bskyPlaylistUrl: vidEmbed.playlist } : {}),
      outletId: rep.outletId,
      outletName: rep.name,
      reporterId: rep.id,
      reporterName: rep.name,
      author: rep.name,
      authorHandle: rep.handle,
      authorProfileUrl: rep.xUrl || `https://bsky.app/profile/${rep.bskyHandle}`,
      trustTier: rep.trustTier || 1,
      category: resolvedCategory,
      wireSource: 'bluesky_live'
    });
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

async function generateGroundedDailyBrief(
  team,
  appData,
  apiKey,
  { existingBrief = null, priorCycleBrief = null, forceBrief = false, aiModelDiscovery = null, quotaState = null, persistQuotaState = null } = {}
) {
  const nowMs = Date.now();
  const cycleState = resolveNewsBriefCycleState(nowMs, appData, 17);
  const activeCycleKey = cycleState.activeCycleKey;
  const workerBaseUrlEnv = String(process.env.WORKER_BASE_URL || '').trim().replace(/\/+$/, '');
  const groupPasscodeEnv = String(process.env.GROUP_PASSCODE || '').trim();
  const workerBriefCycleKey = `${activeCycleKey}-v5`;
  const oppAbbrBrief = appData.scheduleMatchup?.upcomingMatchup?.oppAbbr || '';

  const existingBriefText = [
    existingBrief?.headline || '',
    existingBrief?.summary || '',
    ...(existingBrief?.bullets || []).map(b => (typeof b === 'string' ? b : `${b?.subtopic || ''} ${b?.body || ''}`))
  ].join(' ');
  const existingBriefMatchesTeam =
    Boolean(existingBrief) &&
    !hasCrossTeam49ersLeak(existingBriefText, team, oppAbbrBrief);

  if (
    !forceBrief &&
    !process.env.FORCE_NEWS_BRIEF_AI &&
    existingBriefMatchesTeam &&
    (existingBrief.source === 'pipeline-gemini-daily' || existingBrief.source === 'live-gemini-daily') &&
    (existingBrief.cycleKey === activeCycleKey ||
      (!apiKey &&
        existingBrief.generatedAt &&
        nowMs - Date.parse(existingBrief.generatedAt) <= 72 * 3_600_000)) &&
    !isDailyBriefStaleForLiveState(existingBrief, appData, nowMs) &&
    existingBrief.headline &&
    Array.isArray(existingBrief.bullets) &&
    existingBrief.bullets.length >= 2
  ) {
    return repairDailyTopNewsBriefLinks(existingBrief).brief;
  }

  const preGameHoldCutoffMs =
    cycleState.isGameDayHold && Number.isFinite(cycleState.targetKickoffMs)
      ? cycleState.targetKickoffMs - 90 * 60_000
      : null;
  const sourceCandidates = selectTopNewsBriefSourceCandidates(appData, 18, nowMs, {
    maxPublishedMs: preGameHoldCutoffMs
  });

  // 1. Check Shared Worker KV FIRST across ALL 32 clubs (even during Game-Day Hold — 0 credits spent!)
  if (!forceBrief && !process.env.FORCE_NEWS_BRIEF_AI && workerBaseUrlEnv && sourceCandidates.length > 0) {
    try {
      const kvRes = await fetch(
        `${workerBaseUrlEnv}/api/daily-news-brief?team=${encodeURIComponent(team.abbr)}&cycleKey=${encodeURIComponent(workerBriefCycleKey)}&allowLatest=1`,
        {
          method: 'GET',
          headers: groupPasscodeEnv ? { 'X-Group-Passcode': groupPasscodeEnv } : {},
          signal: AbortSignal.timeout(7000)
        }
      );
      if (kvRes.ok) {
        const kvJson = await kvRes.json();
        if (kvJson?.cached && (kvJson.data || kvJson.rawText) && !kvJson.latestFallback) {
          const adopted = parseAndSanitizeDailyTopNewsBrief(
            kvJson.data || kvJson.rawText,
            sourceCandidates,
            appData,
            {
              cycleKey: activeCycleKey,
              isPostGame: cycleState.isPostGameCycle,
              gameWeek: cycleState.targetGame
                ? Number(cycleState.targetGame.week)
                : appData.meta?.currentWeek || 1,
              generatedAt: kvJson.generatedAt || new Date(nowMs).toISOString(),
              modelUsed: kvJson.modelUsed || aiModelDiscovery?.activeModel || 'gemini-4-hydrogen',
              source: 'pipeline-gemini-daily'
            }
          );
          if (adopted && !isDailyBriefStaleForLiveState(adopted, appData, nowMs)) {
            const adoptedTxt = `${adopted.headline || ''} ${(adopted.bullets || []).join(' ')}`;
            if (!hasCrossTeam49ersLeak(adoptedTxt, team, oppAbbrBrief)) {
              console.log(`[ai-brief] Adopted shared Worker KV ${team.abbr} ${activeCycleKey} brief (0 credits spent).`);
              return adopted;
            }
          }
        }
      }
    } catch {
      // Non-fatal: continue to direct synthesis or deterministic fallback
    }
  }

  // 2. Synthesize canonical High-Reasoning Pool-1 brief via Two-Pool Quota Manager
  // (SF runs FIRST with reserved frontier tokens; non-SF degrades early so SF keeps best tokens;
  // strict <=4 RPM staggering, <=200K TPM & TPD protection, auto-disabling search when free-tier 429s)
  if (!cycleState.isGameDayHold && apiKey && sourceCandidates.length >= 2) {
    try {
      const aiNewsBriefRes = await runSinglePassDailyGeminiSynthesis({
        apiKey,
        preferredModel: quotaState?.pools?.premier?.[0] || aiModelDiscovery?.activeModel || 'gemini-4-hydrogen',
        promptText: buildDailyTopNewsBriefPrompt(appData, sourceCandidates, nowMs, {
          previousBrief: priorCycleBrief
        }),
        appData,
        rosterPlayers: appData.roster?.players || [],
        quotaState,
        pool: 'premier',
        isPriorityTeam: team.abbr === 'SF',
        allowSearchGrounding: !quotaState || isSearchGroundingAllowed(quotaState, nowMs),
        maxOutputTokens: 2048
      });
      if (typeof persistQuotaState === 'function') persistQuotaState();
      if (aiNewsBriefRes.ok && aiNewsBriefRes.rawText) {
        const synthGenIso = new Date().toISOString();
        const parsedBrief = parseAndSanitizeDailyTopNewsBrief(
          aiNewsBriefRes.rawText,
          sourceCandidates,
          appData,
          {
            cycleKey: activeCycleKey,
            isPostGame: cycleState.isPostGameCycle,
            gameWeek: cycleState.targetGame
              ? Number(cycleState.targetGame.week)
              : appData.meta?.currentWeek || 1,
            generatedAt: synthGenIso,
            modelUsed: aiNewsBriefRes.modelUsed || 'gemini-4-hydrogen',
            source: 'pipeline-gemini-daily'
          }
        );
        if (parsedBrief) {
          const joined = `${parsedBrief.headline || ''} ${(parsedBrief.bullets || []).join(' ')}`;
          if (!hasCrossTeam49ersLeak(joined, team, oppAbbrBrief)) {
            if (workerBaseUrlEnv) {
              try {
                await fetch(`${workerBaseUrlEnv}/api/daily-news-brief?team=${encodeURIComponent(team.abbr)}`, {
                  method: 'POST',
                  headers: {
                    'Content-Type': 'application/json',
                    ...(groupPasscodeEnv ? { 'X-Group-Passcode': groupPasscodeEnv } : {})
                  },
                  body: JSON.stringify({
                    team: team.abbr,
                    cycleKey: workerBriefCycleKey,
                    seedRawText: aiNewsBriefRes.rawText,
                    seedData: parsedBrief,
                    modelUsed: parsedBrief.modelUsed,
                    generatedAt: synthGenIso
                  }),
                  signal: AbortSignal.timeout(6000)
                });
              } catch {
                // Non-fatal
              }
            }
            return parsedBrief;
          }
        }
      }
    } catch (err) {
      console.warn(`[ai-brief] ${team.abbr} Gemini synthesis skipped: ${err?.message || err}`);
    }
  }

  return buildDeterministicDailyTopNewsBrief(appData, nowMs, {
    cycleKey: activeCycleKey,
    ...(Number.isFinite(preGameHoldCutoffMs) ? { maxPublishedMs: preGameHoldCutoffMs } : {}),
    source: 'pipeline-grounded'
  });
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
    clubVideoSitemapXml,
    pfrTeamRssXml,
    cbsInjHtml,
    rawBskyEntries,
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
    fetchTextSafe(`https://www.${team.clubDomain}/sitemap-video-fast-changing.xml`, 9000),
    fetchTextSafe(`https://www.profootballrumors.com/${team.otcSlug}/feed`, 8500),
    fetchTextSafe(buildCbsTeamInjuriesUrl(team.abbr, team.fullName), 10000),
    fetchRawBlueskyFeedsForReporters(reportersData),
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

  let preSeqIdx = 0;
  for (const ev of espnScheduleRaw?.events || []) {
    const stType = Number(ev.seasonType?.type ?? ev.seasonType?.id ?? 2);
    const wkRaw = Number(ev.week?.number || 0);
    if (stType === 3 && wkRaw === 4) continue;
    const seasonType = stType === 1 ? 'PRE' : stType === 3 ? 'POST' : 'REG';
    if (seasonType === 'PRE') preSeqIdx += 1;
    const preNum = seasonType === 'PRE' ? preSeqIdx : null;
    const wk =
      seasonType === 'PRE'
        ? -(4 - Math.min(3, preNum || 1))
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

    const matchedNflRow =
      seasonType === 'REG' && Array.isArray(nflCtx?.gamesRows)
        ? nflCtx.gamesRows.find(
            r =>
              Number(r.season) === seasonYear &&
              Number(r.week) === wk &&
              (normalizeAnyTeamAbbr(r.home_team) === team.abbr || normalizeAnyTeamAbbr(r.away_team) === team.abbr)
          ) || null
        : null;
    const isTeamHome = (myComp?.homeAway || 'home') === 'home';
    const teamRestDays = matchedNflRow
      ? isTeamHome
        ? Number(matchedNflRow.home_rest || 7)
        : Number(matchedNflRow.away_rest || 7)
      : 7;
    const oppRestDays = matchedNflRow
      ? isTeamHome
        ? Number(matchedNflRow.away_rest || 7)
        : Number(matchedNflRow.home_rest || 7)
      : 7;
    const netRestDays = matchedNflRow ? teamRestDays - oppRestDays : null;
    const nflSpreadTeam =
      matchedNflRow && matchedNflRow.spread_line !== '' && matchedNflRow.spread_line != null
        ? isTeamHome
          ? -Number(matchedNflRow.spread_line)
          : Number(matchedNflRow.spread_line)
        : null;
    const nflTotalLine =
      matchedNflRow && matchedNflRow.total_line !== '' && matchedNflRow.total_line != null
        ? Number(matchedNflRow.total_line)
        : null;

    schedule.push(
      normalizeScheduleGameItem(
        {
          id: String(ev.id || `${seasonType}_${wk}`),
          seasonType,
          preseasonWeek: seasonType === 'PRE' ? preNum : null,
          week: wk,
          weekLabel: seasonType === 'PRE' ? `PRE ${preNum}` : seasonType === 'POST' ? ['WC', 'DIV', 'CON', 'SB'][wkRaw - 1] || 'POST' : `Wk ${wk}`,
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
          ...(netRestDays != null && Number.isFinite(netRestDays) ? { restAdvantageDays: netRestDays } : {}),
          ...(nflSpreadTeam != null && Number.isFinite(nflSpreadTeam) ? { spreadLineSf: nflSpreadTeam } : {}),
          ...(nflTotalLine != null && Number.isFinite(nflTotalLine) ? { totalLine: nflTotalLine } : {}),
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
  schedule.sort((a, b) => (a.week || 0) - (b.week || 0));

  const regAndPost = schedule.filter(g => g.seasonType !== 'PRE' && !g.isByeWeek);
  const nextUnplayed = regAndPost.find(g => !g.completed) || regAndPost[regAndPost.length - 1] || schedule[0];
  const currentWeek = Number(nextUnplayed?.week || Math.min(18, teamStanding.wins + teamStanding.losses + teamStanding.ties + 1));
  const beforePracticeWindow = isBeforeWeeklyPracticeWindow(nextUnplayed?.dateIso || '');

  // Fetch opponent injuries, active roster & depth chart for upcoming matchup (full 32-team parity!)
  const oppCfg = nextUnplayed?.opponent?.abbr && nextUnplayed.opponent.abbr !== 'BYE' && nextUnplayed.opponent.abbr !== 'TBD'
    ? getTeamByAbbr(nextUnplayed.opponent.abbr)
    : null;
  const [oppInjRaw, oppRosterRaw, oppDepthRaw] = oppCfg
    ? await Promise.all([
        fetchJsonSafe(`https://site.api.espn.com/apis/site/v2/sports/football/nfl/injuries?team=${oppCfg.espnId}`, 8000),
        fetchJsonSafe(`https://site.api.espn.com/apis/site/v2/sports/football/nfl/teams/${oppCfg.espnId}/roster`, 8000),
        fetchJsonSafe(`https://site.api.espn.com/apis/site/v2/sports/football/nfl/teams/${oppCfg.espnId}/depthcharts`, 8000)
      ])
    : [null, null, null];

  // Reconcile official club injury HTML for team & opponent
  const officialInj = clubInjuryHtml
    ? parseOfficialClubInjuryReportHtml(clubInjuryHtml, nextUnplayed?.opponent?.name || '', team)
    : null;

  // 2. Parse OverTheCap 5-year salary cap ledger & Player Identity Resolver (homonym-safe)
  // If OverTheCap transiently rate-limits (429/empty HTML), preserve the prior verified cap.json / roster.json
  // OTC ledger on disk rather than clobbering 5-year cap space, void-year dead cap, and OTC player IDs.
  let otcParsed = otcHtml
    ? parseOverTheCapHtml(otcHtml, seasonYear, leagueCtx.otcSpaceHtml, team.otcSlug)
    : { years: {}, otcPlayers: [], otcNonActivePlayers: [], otcDirectory: [] };
  if (Object.keys(otcParsed.years || {}).length === 0) {
    try {
      const prevCapPath = path.join(getTeamOutDir(team), 'cap.json');
      const prevRosterPath = path.join(getTeamOutDir(team), 'roster.json');
      const prevCap = fs.existsSync(prevCapPath) ? JSON.parse(fs.readFileSync(prevCapPath, 'utf8')) : null;
      const prevRoster = fs.existsSync(prevRosterPath) ? JSON.parse(fs.readFileSync(prevRosterPath, 'utf8')) : null;
      if (prevCap && Object.keys(prevCap.years || {}).length >= 3) {
        const prevPlayers = Array.isArray(prevCap.players) ? prevCap.players : [];
        const prevDeparted = Array.isArray(prevRoster?.departedPlayers) ? prevRoster.departedPlayers : [];
        const prevRosterList = Array.isArray(prevRoster?.players) ? prevRoster.players : [];
        const dirSeed = [...prevPlayers, ...prevRosterList, ...prevDeparted]
          .filter(p => p?.name && p?.otcId)
          .map(p => ({ name: p.name, otcId: String(p.otcId), otcSlug: p.otcSlug || '' }));
        otcParsed = {
          years: prevCap.years,
          otcPlayers: prevPlayers.map(p => ({
            name: p.name,
            otcId: p.otcId || null,
            otcSlug: p.otcSlug || '',
            contractsByYear: p.contractsByYear || {}
          })),
          otcNonActivePlayers: prevDeparted.map(p => ({
            name: p.name,
            otcId: p.otcId || null,
            otcSlug: p.otcSlug || '',
            contractsByYear: p.contractsByYear || {},
            deadMoney2026: p.deadMoney2026 || 0
          })),
          otcDirectory: dirSeed
        };
        console.warn(`[stage-2] OverTheCap unavailable for ${team.abbr}; preserved prior verified ${Object.keys(prevCap.years).length}-year cap ledger from disk.`);
      }
    } catch {}
  }
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
  const deepHealthIds = [];
  for (const grp of espnRosterRaw?.athletes || []) {
    const gPos = String(grp.position || '').toLowerCase();
    const isIrGroup = /injured|reserve|suspended|pup|nfi/i.test(gPos);
    for (const a of grp.items || []) {
      const nm = a?.fullName || a?.displayName;
      if (nm) allEspnRosterNames.push(nm);
      const aid = String(a?.id || '').trim();
      const ck = canonicalInjuryPlayerKey(nm || '');
      if (
        aid &&
        (isIrGroup ||
          espnInjById.has(aid) ||
          cbsInjMap.has(ck) ||
          officialInj?.sfByKey?.has(ck) ||
          (Array.isArray(a?.injuries) && a.injuries.length > 0))
      ) {
        deepHealthIds.push(aid);
      }
    }
  }
  const espnWebAthleteDetails = await fetchEspnAthleteDetailsBatch(deepHealthIds, fetchJsonSafe, 10);
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

      const webAthInjEarly = espnWebAthleteDetails.get(id)?.injury || null;
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
        webInj: webAthInjEarly,
        inlineInj,
        recentNewsText: recentTeamNewsText,
        inOtcTeamPage
      });
      if (!rosterDecision.include) {
        excludedGhostIds.push(id);
        continue;
      }

      const rawIrFantasyEarly = String(
        espnInj?.details?.fantasyStatus?.abbreviation || webAthInjEarly?.fantasyStatusAbbr || ''
      ).toUpperCase();
      const espnRemainsOnIrNote = /\bremains\s+on\s+injured\s+reserve\b/i.test(
        `${espnInj?.shortComment || ''} ${espnInj?.longComment || ''} ${webAthInjEarly?.shortComment || ''} ${webAthInjEarly?.longComment || ''}`
      );
      const rosterBucket =
        rosterDecision.bucket === 'active' && (rawIrFantasyEarly === 'IR-R' || espnRemainsOnIrNote)
          ? 'ir'
          : rosterDecision.bucket;
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
      const contractsByYear = { ...(otcEntry?.contractsByYear || {}) };
      const curYrKey = String(seasonYear);
      const nonActiveCurCharge = otcNonActiveEntry?.chargesByYear?.[curYrKey] || null;
      const capHit2026 = Number(
        contractsByYear[curYrKey]?.capNumber ||
          nonActiveCurCharge?.capNumber ||
          0
      );
      // If a player was just activated off IR/PS onto the Active 53 before OverTheCap moved them out of the non-active table,
      // preserve their current-year OTC cap charge in `contractsByYear` so all 53 active roster players stay in the Cap Simulator!
      if (rosterBucket === 'active' && !contractsByYear[curYrKey]) {
        const carryCap = capHit2026 > 0 ? capHit2026 : 840000;
        const carryBase = Number(nonActiveCurCharge?.baseSalary || carryCap);
        const carryBonus = Math.max(0, carryCap - carryBase);
        contractsByYear[curYrKey] = {
          baseSalary: carryBase,
          proratedBonus: carryBonus,
          rosterBonus: 0,
          capNumber: carryCap,
          deadMoneyPreJune1: Number(nonActiveCurCharge?.deadMoney || carryBonus),
          capSavingsPreJune1: Math.max(0, carryCap - Number(nonActiveCurCharge?.deadMoney || carryBonus)),
          deadMoneyPostJune1: Number(nonActiveCurCharge?.deadMoney || carryBonus),
          capSavingsPostJune1: Math.max(0, carryCap - Number(nonActiveCurCharge?.deadMoney || carryBonus)),
          guaranteedSalary: 0
        };
      }
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

      // Multi-source Injury, Practice Progression & IR Return Reconciliation (merging ESPN Web v3 Athlete Details for Season-Ending IR accuracy!)
      const cbsInj = cbsInjMap.get(canonKey) || null;
      const offInjRec = officialInj?.sfByKey?.get(canonKey) || null;
      const webAthInj = espnWebAthleteDetails.get(id)?.injury || null;
      const weeklyHistory2026 = teamWeeklyInjByName.get(nflNameKey) || [];

      const rawEspnStatus = String(espnInj?.status || webAthInj?.status || inlineInj?.status || '').trim();
      const espnBlurbMs = espnInj?.date ? Date.parse(espnInj.date) : webAthInj?.date ? Date.parse(webAthInj.date) : NaN;
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
        : cleanSensationalistText(
            pickMeaningfulInjuryComment(espnInj?.shortComment, webAthInj?.shortComment, inlineInj?.shortComment)
          );
      const rawLongComment = isStaleActiveIrBlurb
        ? ''
        : cleanSensationalistText(
            pickMeaningfulInjuryComment(espnInj?.longComment, webAthInj?.longComment, inlineInj?.longComment, rawShortComment)
          );
      const returnDateStr = isStaleActiveIrBlurb
        ? null
        : espnInj?.details?.returnDate || webAthInj?.returnDate || inlineInj?.details?.returnDate || null;

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
          webAthInj?.injuryType ||
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

      const irFantasyAbbr = espnInj?.details?.fantasyStatus?.abbreviation || webAthInj?.fantasyStatusAbbr || '';
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
              injuryDetail: espnInj?.details?.detail || webAthInj?.injuryDetail || '',
              returnDateIso: returnDateStr,
              placedDateIso: espnInj?.date || webAthInj?.date || inlineInj?.date || null,
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
        weeklyLog2026: resolvePlayerWeeklyLog(nflCtx?.weeklyPlayerLogsIndex, {
          gsisId,
          pfrId,
          name: fullName,
          teamAbbr: team.abbr
        }),
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
  const isBase34Defense = (espnDepthRaw?.depthchart || []).some(dc => /3-4/i.test(String(dc?.name || '')));
  const slotLabels = {
    qb: 'QB', rb: 'RB', fb: 'FB (21 Personnel)', wr1: 'WR (X)', wr2: 'WR (Z)', wr3: 'SLWR (11 Personnel)',
    te: 'TE (Y)', lt: 'LT', lg: 'LG', c: 'C', rg: 'RG', rt: 'RT',
    lde: isBase34Defense ? 'LDE (3-4)' : 'LDE (Wide-9)',
    ldt: 'LDT (1/2i)', nt: 'NT (0/1-Tech)', rdt: 'RDT (3-Tech)',
    rde: isBase34Defense ? 'RDE (3-4)' : 'RDE (Wide-9)',
    wlb: 'WILL LB', mlb: 'MIKE LB', slb: 'SAM LB (4-3)',
    lolb: 'LOLB', lilb: 'LILB', rilb: 'RILB', rolb: 'ROLB',
    nb: 'NICKEL CB (4-2-5)', lcb: 'LCB', rcb: 'RCB', ss: 'SS', fs: 'FS',
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
          ? 'Offense (11 & 21 Personnel)'
          : /\b(4-3|3-4|defense|base\s*def|d)\b/i.test(rawName)
            ? /3-4/i.test(rawName)
              ? 'Defense (Base 3-4 & Nickel 4-2-5)'
              : 'Defense (Wide-9 Base 4-3 & Nickel 4-2-5)'
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

    const oppIrCls = isOppIr
      ? classifyIrAndReserveTimeline({
          statusRaw: effectiveOppStatus || rawOppStatus || 'Injured Reserve',
          fantasyStatusAbbr: inj?.details?.fantasyStatus?.abbreviation || '',
          injuryType: effectiveOppInj || 'Reserve / IR',
          injuryDetail: inj?.details?.detail || '',
          returnDateIso: inj?.details?.returnDate || null,
          placedDateIso: inj?.date || null,
          beatNote: oppComment,
          currentWeek,
          byeWeek: null,
          seasonYear,
          scheduleEvents: espnScheduleRaw?.events || []
        })
      : null;

    const oppRow = {
      playerId: oppPid,
      name: nm,
      position: pos,
      headshotUrl: headshot,
      injuryType: oppIrCls?.injuryType || effectiveOppInj || (isOppIr ? 'Reserve / IR' : 'Injury'),
      gameStatus: oppIrCls?.status || effectiveOppStatus || (isOppIr ? 'Injured Reserve' : 'Questionable'),
      status: oppIrCls?.status || effectiveOppStatus || (isOppIr ? 'Injured Reserve' : 'Questionable'),
      isSeasonEnding: Boolean(oppIrCls?.isSeasonEnding),
      isPracticeWindowOpen: Boolean(oppIrCls?.isPracticeWindowOpen),
      earliestEligibleWeek: oppIrCls ? oppIrCls.earliestEligibleWeek ?? Math.max(5, currentWeek) : null,
      projectedReturnWeek: oppIrCls?.projectedReturnWeek || null,
      byeWeekNote: oppIrCls?.byeWeekNote || null,
      wed: beforePracticeWindow ? '-' : offRec?.wed || '-',
      thu: beforePracticeWindow ? '-' : offRec?.thu || '-',
      fri: beforePracticeWindow ? '-' : offRec?.fri || '-',
      playProbabilityPct: oppProb.probabilityPct,
      playBadgeLabel: oppProb.badgeLabel,
      archetypeNote: oppProb.archetypeNote || `${pos} availability projection`,
      factors: Array.isArray(oppProb.factors) && oppProb.factors.length > 0 ? oppProb.factors : [effectiveOppStatus || 'Monitor weekly practice progression'],
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
        wed: beforePracticeWindow ? '-' : offRec.wed || '-',
        thu: beforePracticeWindow ? '-' : offRec.thu || '-',
        fri: beforePracticeWindow ? '-' : offRec.fri || '-',
        kickoffIso: nextUnplayed?.dateIso || ''
      });
      oppInjuryReport.push({
        playerId: '',
        name: offRec.name,
        position: offRec.position || 'ATH',
        headshotUrl: '',
        injuryType: offRec.injuryType || 'Injury',
        gameStatus: offRec.gameStatus || 'Questionable',
        wed: beforePracticeWindow ? '-' : offRec.wed || '-',
        thu: beforePracticeWindow ? '-' : offRec.thu || '-',
        fri: beforePracticeWindow ? '-' : offRec.fri || '-',
        playProbabilityPct: oppProb.probabilityPct,
        playBadgeLabel: oppProb.badgeLabel,
        archetypeNote: oppProb.archetypeNote || `${offRec.position || 'ATH'} availability projection`,
        factors: Array.isArray(oppProb.factors) && oppProb.factors.length > 0 ? oppProb.factors : [offRec.gameStatus || 'Official injury report'],
        beatComment: ''
      });
    }
  }

  // Build Opponent Active Roster (>=40 active players), Starter Depth Keys & Healthy 1st-String Starters (full 32-team parity!)
  const oppActiveRoster = [];
  const oppRosterByKey = new Map();
  for (const grp of oppRosterRaw?.athletes || []) {
    const gPos = String(grp?.position || '').toLowerCase();
    if (/injured|reserve|suspended|practice/i.test(gPos)) continue;
    for (const a of grp?.items || []) {
      const nm = a?.fullName || a?.displayName || '';
      if (!nm) continue;
      const ck = canonicalInjuryPlayerKey(nm);
      if (oppRosterByKey.has(ck)) continue;
      const rec = {
        playerId: String(a.id || ''),
        name: nm,
        position: a.position?.abbreviation || 'ATH',
        jersey: a.jersey ? Number(a.jersey) : null,
        headshotUrl: a.headshot?.href || (a.id ? `https://a.espncdn.com/i/headshots/nfl/players/full/${a.id}.png` : ''),
        unit: mapPositionToUnit(a.position?.abbreviation || '')
      };
      oppRosterByKey.set(ck, rec);
      oppActiveRoster.push(rec);
    }
  }
  const oppStarterKeys = new Set();
  const oppStarterMetaByKey = new Map();
  for (const dc of oppDepthRaw?.depthchart || []) {
    if (/special/i.test(String(dc?.name || ''))) continue;
    for (const [slotKey, posObj] of Object.entries(dc?.positions || {})) {
      const first = (posObj?.athletes || [])[0];
      const nm = first?.displayName || first?.fullName || '';
      if (!nm) continue;
      const ck = canonicalInjuryPlayerKey(nm);
      if (oppStarterKeys.has(ck) || oppStarterKeys.size >= 22) continue;
      oppStarterKeys.add(ck);
      const rMatch = oppRosterByKey.get(ck);
      const starterPos = rMatch?.position || posObj?.position?.abbreviation || slotKey.toUpperCase();
      const starterUnit = /offense/i.test(String(dc?.name || ''))
        ? 'Offense'
        : /defense/i.test(String(dc?.name || ''))
          ? 'Defense'
          : mapPositionToUnit(starterPos);
      oppStarterMetaByKey.set(ck, {
        playerId: String(first?.id || rMatch?.playerId || ''),
        name: rMatch?.name || nm,
        position: starterPos,
        unit: starterUnit,
        slot: slotKey.toUpperCase(),
        jersey: rMatch?.jersey ?? null,
        headshotUrl: rMatch?.headshotUrl || (first?.id ? `https://a.espncdn.com/i/headshots/nfl/players/full/${first.id}.png` : ''),
        playProbabilityPct: 95
      });
    }
  }
  // Annotate Starter vs Depth role on every opponent injury report row across all 32 teams
  for (const row of oppInjuryReport) {
    const ck = canonicalInjuryPlayerKey(row.name || '');
    const isStarter = oppStarterKeys.has(ck);
    row.isStarter = isStarter;
    row.role = isStarter ? 'Starter' : 'Depth';
  }
  const oppNotClearedKeys = new Set([
    ...oppInjuryReport
      .filter(r => {
        const pct = Number(r.playProbabilityPct ?? 95);
        const st = String(r.gameStatus || r.status || '');
        const isCleared = /Full Go|Cleared|Likely|In \(Active\)/i.test(String(r.playBadgeLabel || '')) || (pct >= 85 && !/\b(?:Out|Doubtful|IR)\b/i.test(st));
        return !isCleared;
      })
      .map(r => canonicalInjuryPlayerKey(r.name || '')),
    ...oppIrReserve.map(r => canonicalInjuryPlayerKey(r.name || ''))
  ]);
  const oppKeyStartersHealthy = [...oppStarterMetaByKey.entries()]
    .filter(([ck]) => !oppNotClearedKeys.has(ck))
    .map(([, meta]) => meta);
  const oppInjuredStarterRows = oppInjuryReport.filter(r => {
    if (!r.isStarter) return false;
    const pct = Number(r.playProbabilityPct ?? 95);
    const st = String(r.gameStatus || r.status || '');
    const isCleared = /Full Go|Cleared|Likely|In \(Active\)/i.test(String(r.playBadgeLabel || '')) || (pct >= 85 && !/\b(?:Out|Doubtful|IR)\b/i.test(st));
    return !isCleared;
  });
  const oppTotalStarters = 22;
  const oppStartersClearedCount = Math.max(0, oppTotalStarters - oppInjuredStarterRows.length);
  const oppAvailSum =
    oppStartersClearedCount * 95 +
    oppInjuredStarterRows.reduce((s, r) => s + (Number(r.playProbabilityPct) || 50), 0);
  const oppOverallAvailabilityScore = Math.max(
    50,
    Math.min(100, Math.round(oppAvailSum / Math.max(1, oppTotalStarters)))
  );

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

  // 9. Build News Raw Stream (ESPN News + ESPN Tx + Club RSS + Club Video RSS + Local Beat RSS + X + RotoWire + Bluesky)
  const rawStream = [];
  const seenNewsUrls = new Set();
  const newsSurnameCounts = new Map();
  const newsRosterMatchers = players
    .filter(p => p?.name && (p.rosterBucket === 'active' || p.rosterBucket === 'ir'))
    .map(p => {
      const cleanFull = String(p.name).replace(/\s+(?:Jr\.?|Sr\.?|II|III|IV|V)$/i, '').trim();
      const parts = cleanFull.split(/\s+/).filter(Boolean);
      const first = (parts[0] || '').toLowerCase();
      const last = (parts[parts.length - 1] || '').replace(/[^a-zA-Z'-]/g, '').toLowerCase();
      if (last.length >= 4) newsSurnameCounts.set(last, (newsSurnameCounts.get(last) || 0) + 1);
      return {
        player: p,
        cleanFull,
        fullLower: cleanFull.toLowerCase(),
        fullRe: cleanFull.length >= 5 ? new RegExp(`\\b${cleanFull.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i') : null,
        first,
        last
      };
    });
  const extractMentionedPlayersForNews = item => {
    if (Array.isArray(item.mentionedPlayers) && item.mentionedPlayers.length > 0) {
      return item.mentionedPlayers;
    }
    const blob = `${item.title || ''} ${item.fullText || ''} ${item.summary || ''}`.trim();
    if (!blob) return [];
    const found = [];
    const seenPid = new Set();
    const addMatch = p => {
      if (!p || seenPid.has(p.id) || found.length >= 6) return;
      seenPid.add(p.id);
      found.push({
        id: p.id,
        name: p.name,
        shortName: p.shortName || p.name,
        position: p.position,
        jersey: p.jersey,
        headshotUrl: p.headshotUrl || ''
      });
    };
    for (const m of newsRosterMatchers) {
      if (m.fullRe && m.fullRe.test(blob)) {
        addMatch(m.player);
        continue;
      }
      if (m.first === 'deebo' && /\bdeebo\b/i.test(blob)) {
        addMatch(m.player);
        continue;
      }
      if (
        m.last.length >= 5 &&
        newsSurnameCounts.get(m.last) === 1 &&
        !AMBIGUOUS_PLAYER_SURNAMES.has(m.last) &&
        hasSafeStandaloneSurnameMatch(blob, m.last, m.cleanFull)
      ) {
        addMatch(m.player);
      }
    }
    return found;
  };
  const seenXStatusIds = new Set();
  const extractXSid = u => (String(u || '').match(/https?:\/\/(?:www\.|mobile\.)?(?:x|twitter)\.com\/[^/]+\/status\/(\d{15,22})/i) || [])[1] || '';
  const pushNewsItem = item => {
    const cleanUrl = sanitizeExternalUrl(item?.url || '', null);
    const normUrlKey = cleanUrl ? cleanUrl.toLowerCase() : '';
    const xSid = extractXSid(cleanUrl);
    if (!cleanUrl || isPaywalledPublisher(cleanUrl) || seenNewsUrls.has(normUrlKey) || (xSid && seenXStatusIds.has(xSid))) return;
    seenNewsUrls.add(normUrlKey);
    if (xSid) seenXStatusIds.add(xSid);
    if (isOpposingTeamOnlyInjuryOrRosterStory(item, team)) return;
    const decTitle = decodeHtmlEntities(String(item.title || '')).trim();
    const decSummary = decodeHtmlEntities(String(item.summary || '')).trim();
    const decFull = item.fullText != null ? decodeHtmlEntities(String(item.fullText)).trim() : undefined;
    const sig = scoreContentSignal(decTitle, decSummary || decFull || '', {
      url: cleanUrl,
      externalUrl: item.externalUrl || '',
      type: item.type || ''
    });
    if (sig.isClickbait) return;
    const cleanImg = item.imageUrl
      ? decodeHtmlEntities(String(item.imageUrl)).trim()
      : item.thumbnailUrl
        ? decodeHtmlEntities(String(item.thumbnailUrl)).trim()
        : '';
    const genericBeatLabel = `${team.nickname} Beat`;
    const isGenericBeatAuthor = v => {
      const s = String(v || '').trim().toLowerCase();
      return !s || s === genericBeatLabel.toLowerCase() || s === '49ers beat' || s === 'nfl beat';
    };
    const rawAuthorCand = decodeHtmlEntities(String(item.author || '')).trim();
    const rawReporterCand = decodeHtmlEntities(String(item.reporterName || '')).trim();
    const rawChannelCand = decodeHtmlEntities(String(item.channel || '')).trim();
    const rawOutletCand = decodeHtmlEntities(String(item.outletName || '')).trim();
    const resolvedAuthor =
      (!isGenericBeatAuthor(rawAuthorCand) ? rawAuthorCand : '') ||
      (!isGenericBeatAuthor(rawReporterCand) ? rawReporterCand : '') ||
      (!isGenericBeatAuthor(rawChannelCand) ? rawChannelCand : '') ||
      (!isGenericBeatAuthor(rawOutletCand) ? rawOutletCand : '') ||
      rawAuthorCand ||
      rawOutletCand ||
      genericBeatLabel;
    const resolvedOutlet =
      (!isGenericBeatAuthor(rawOutletCand) ? rawOutletCand : '') ||
      (!isGenericBeatAuthor(rawChannelCand) ? rawChannelCand : '') ||
      rawOutletCand ||
      resolvedAuthor;
    const resolvedReporter = (!isGenericBeatAuthor(rawReporterCand) ? rawReporterCand : '') || resolvedAuthor;
    const resolvedId =
      String(item.id || '').trim() ||
      (item.videoId ? `${team.abbr.toLowerCase()}_yt_${item.videoId}` : `${team.abbr.toLowerCase()}_item_${hashShort(cleanUrl)}`);
    const cleanImgUrls = Array.isArray(item.imageUrls)
      ? Array.from(
          new Set(
            item.imageUrls
              .map(u => decodeHtmlEntities(String(u || '')).trim())
              .filter(u => /^https:\/\//i.test(u))
          )
        ).slice(0, 4)
      : [];
    const decodedItem = {
      ...item,
      id: resolvedId,
      title: decTitle,
      summary: decSummary,
      ...(cleanImg ? { imageUrl: cleanImg } : {}),
      ...(cleanImgUrls.length > 0 ? { imageUrls: cleanImgUrls } : {}),
      ...(decFull !== undefined ? { fullText: decFull } : {}),
      author: resolvedAuthor,
      outletName: resolvedOutlet,
      reporterName: resolvedReporter,
      ...(item.imageCaption ? { imageCaption: decodeHtmlEntities(String(item.imageCaption)).trim() } : {}),
      ...(item.imageAlt ? { imageAlt: decodeHtmlEntities(String(item.imageAlt)).trim() } : {})
    };
    const mentionedPlayers = extractMentionedPlayersForNews(decodedItem);
    const enrichedItem = {
      ...decodedItem,
      mentionedPlayers,
      ...(decodedItem.type === 'video'
        ? {
            embeddable:
              typeof decodedItem.embeddable === 'boolean'
                ? decodedItem.embeddable
                : Boolean(decodedItem.videoStreamUrl)
          }
        : {})
    };
    const rawPubCandidate =
      enrichedItem.publishedAt ||
      enrichedItem.publishedAtIso ||
      enrichedItem.published ||
      parseRelativePublishedAgoToIso(enrichedItem.publishedAgo, Date.now());
    const parsedPubMs = rawPubCandidate ? Date.parse(rawPubCandidate) : NaN;
    const pubIso = Number.isFinite(parsedPubMs)
      ? new Date(Math.min(Date.now(), parsedPubMs)).toISOString()
      : nowIso;
    const brk = classifyBreakingItem({ ...enrichedItem, publishedAt: pubIso }, Date.now(), { team, rosterPlayers: players });
    const cat = classifyNewsItemCategory(enrichedItem);
    rawStream.push({
      ...enrichedItem,
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

  // 9d. Official Club Video RSS (enriched with exact durations from official club video sitemap)
  const clubVideoDurByUrl = parseClubVideoSitemapDurations(clubVideoSitemapXml);
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
    const clubVidDuration = clubVideoDurByUrl.get(link.replace(/\/+$/, '').toLowerCase()) || undefined;
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
      ...(clubVidDuration ? { duration: clubVidDuration } : {}),
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

  // 9e-3. Stage-1 Shared YouTube Atom Feeds (NFL Highlights, The QB School, Brett Kollmann, Chase Daniel) filtered per team
  const atomPubByVideoId = new Map();
  for (const ytFeed of leagueCtx.youtubeFeeds || []) {
    for (const m of (ytFeed.xml || '').matchAll(/<entry\b[\s\S]*?<\/entry>/gi)) {
      const b = m[0];
      const videoId = (b.match(/<yt:videoId>([^<]+)<\/yt:videoId>/i) || [])[1]?.trim() || '';
      const title = decodeXmlEntities((b.match(/<title>([\s\S]*?)<\/title>/i) || [])[1] || '');
      const xmlCreator = decodeXmlEntities((b.match(/<author>[\s\S]*?<name>([\s\S]*?)<\/name>/i) || [])[1] || '').trim();
      const desc = decodeXmlEntities((b.match(/<media:description>([\s\S]*?)<\/media:description>/i) || [])[1] || '')
        .replace(/\s+/g, ' ')
        .trim();
      const pubRaw = (b.match(/<published>([^<]+)<\/published>/i) || [])[1]?.trim() || '';
      if (!videoId || !title) continue;
      if (/#shorts\b/i.test(title) || /youtube\.com\/shorts\//i.test(b)) continue;
      const pubMs = pubRaw ? Date.parse(pubRaw) : NaN;
      if (Number.isFinite(pubMs)) atomPubByVideoId.set(videoId, new Date(pubMs).toISOString());
      if (!teamOrStarRe.test(`${title} ${desc.slice(0, 220)}`)) continue;
      if (ytFeed.category !== 'film' && isOpposingTeamSubjectLead(title, {}, team)) continue;
      const maxAgeDays = ytFeed.category === 'film' ? 60 : 21;
      if (!Number.isFinite(pubMs) || Date.now() - pubMs > maxAgeDays * 86_400_000) continue;
      const embCheck = ytFeed.embeddable === false ? null : leagueCtx.youtubeEmbeddableById?.get(videoId) || null;
      if (embCheck && embCheck.exists === false) continue;
      const resolvedEmbeddable =
        ytFeed.embeddable === false
          ? false
          : embCheck
            ? Boolean(embCheck.embeddable)
            : false;
      const creatorName = ytFeed.name || xmlCreator || embCheck?.authorName || 'YouTube';
      const watchUrl = `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`;
      pushNewsItem({
        id: `${team.abbr.toLowerCase()}_yt_${videoId}`,
        type: 'video',
        category: ytFeed.category,
        videoId,
        embeddable: resolvedEmbeddable,
        title,
        summary: desc.slice(0, 220),
        imageUrl: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
        imageAlt: title,
        publishedAt: new Date(pubMs).toISOString(),
        url: watchUrl,
        externalVideoUrl: watchUrl,
        channel: creatorName,
        outletId: ytFeed.id,
        outletName: creatorName,
        reporterId: ytFeed.id,
        reporterName: creatorName,
        author: creatorName,
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

  // 9f. Per-Team Local Beat RSS Feeds (SB Nation + USA Today Wire + Regional Beat), Curated YouTube Film Channels,
  //     Verified Local + National X Timelines, Embedded RSS X Tweets, ESPN 24/7 Player Wire & Bluesky Beat Posts!
  const localBeatRssSpecs = resolveTeamBeatRssFeeds(team, reportersData);
  const teamCuratedYtSpecs = TEAM_CURATED_YOUTUBE_CHANNELS_BY_ABBR[team.abbr] || [];
  const [localBeatRssXmls, teamYtXmls, localXRaw, curatedSfYtVideos] = await Promise.all([
    Promise.all(localBeatRssSpecs.map(spec => fetchTextSafe(spec.url, 6500).catch(() => ''))),
    Promise.all(
      teamCuratedYtSpecs.map(ch =>
        fetchTextSafe(`https://www.youtube.com/feeds/videos.xml?channel_id=${encodeURIComponent(ch.id)}`, 7500).catch(() => '')
      )
    ),
    fetchXTimelinesBatch(
      process.env.X_BEARER_TOKEN
        ? selectTeamLocalXHandles(team, reportersData, 18)
        : selectRotatingXHandleSlice(selectTeamLocalXHandles(team, reportersData, 18), {
            maxPerRun: 3,
            bucketMinutes: 30,
            seedOffset: (team.abbr.charCodeAt(0) || 0) + (team.abbr.charCodeAt(1) || 0)
          }),
      {
        concurrency: 1,
        spacingMs: 450,
        timeoutMs: 4200,
        maxAgeHours: 120,
        maxItems: 12
      }
    ).catch(() => []),
    team.abbr === 'SF'
      ? fetchCuratedYouTubeChannelVideos({
          qbNames: players.filter(p => p.position === 'QB' && p.rosterBucket === 'active').map(p => p.name),
          rosterPlayers: players,
          maxAgeDays: 14
        }).catch(() => [])
      : Promise.resolve([])
  ]);

  // Parse Per-Team Local Beat RSS articles (all 32 teams!)
  localBeatRssSpecs.forEach((spec, idx) => {
    const xml = localBeatRssXmls[idx] || '';
    if (!xml) return;
    const blocks = (xml.match(/<(?:item|entry)\b[\s\S]*?<\/(?:item|entry)>/gi) || []).slice(0, 14);
    const parsedEntries = [];
    const descFreq = new Map();
    for (const b of blocks) {
      const title = decodeXmlEntities((b.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || '');
      const desc = decodeXmlEntities(
        (b.match(/<(?:description|summary|content)[^>]*>([\s\S]*?)<\/(?:description|summary|content)>/i) || [])[1] || ''
      )
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
      const link = decodeXmlEntities(
        (b.match(/<link[^>]*href="([^"]+)"/i) || [])[1] ||
          (b.match(/<link>([\s\S]*?)<\/link>/i) || [])[1] ||
          ''
      );
      const pubRaw = decodeXmlEntities(
        (b.match(/<(?:pubDate|published|updated)>([\s\S]*?)<\/(?:pubDate|published|updated)>/i) || [])[1] || ''
      );
      const creator = decodeXmlEntities(
        (b.match(/<dc:creator[^>]*>([\s\S]*?)<\/dc:creator>/i) || [])[1] ||
          (b.match(/<author>[\s\S]*?<name>([^<]+)<\/name>/i) || [])[1] ||
          ''
      );
      if (!title || !/^https?:\/\//i.test(link)) continue;
      const descKey = desc.slice(0, 120).toLowerCase();
      if (descKey.length >= 24) {
        descFreq.set(descKey, (descFreq.get(descKey) || 0) + 1);
      }
      parsedEntries.push({ b, title, desc, descKey, link, pubRaw, creator });
    }
    for (const entry of parsedEntries) {
      const { b, title, link, pubRaw, creator } = entry;
      // Guard against CMS RSS bugs (e.g. NBC Sports Regional ?rss=1) where >=3 distinct articles
      // repeat item #1's description verbatim — keep the description only on an item whose headline matches it.
      let desc = entry.desc;
      if (entry.descKey && (descFreq.get(entry.descKey) || 0) >= 3) {
        const titleWords = title
          .toLowerCase()
          .replace(/[^a-z0-9\s]/g, ' ')
          .split(/\s+/)
          .filter(w => w.length >= 5 && !/^(?:49ers|niners|eagles|patriots|bears|commanders|report|source|after|about|their|before|could|would|should|season|former)$/.test(w));
        const descLower = desc.toLowerCase();
        const overlapCount = titleWords.filter(w => descLower.includes(w)).length;
        if (overlapCount < 2) desc = '';
      }
      if (spec.filterByTeam && !teamOrStarRe.test(`${title} ${desc}`)) continue;
      if (isOpposingTeamSubjectLead(`${title} ${desc}`, {}, team)) continue;
      const pubMs = pubRaw ? Date.parse(pubRaw) : Date.now();
      if (!Number.isFinite(pubMs) || Date.now() - pubMs > 12 * 86_400_000) continue;
      const img = (
        (b.match(/<media:content[^>]*url="([^"]+)"/i) ||
          b.match(/<media:thumbnail[^>]*url="([^"]+)"/i) ||
          b.match(/<enclosure[^>]*url="([^"]+\.(?:jpg|jpeg|png|webp)[^"]*)"/i) ||
          [])[1] || ''
      ).replace(/&amp;/g, '&');
      const repEntry = creator ? resolveReporterFromNameOrHandle(creator, team) : null;
      const validRep = repEntry && !isPodiumSubjectId(repEntry.id) ? repEntry : null;
      pushNewsItem({
        id: `${team.abbr.toLowerCase()}_brss_${spec.outletId}_${hashShort(link)}`,
        type: 'article',
        title,
        summary: desc.slice(0, 240),
        imageUrl: img,
        imageAlt: title,
        publishedAt: new Date(pubMs).toISOString(),
        url: link,
        outletId: spec.outletId,
        outletName: spec.outletName,
        reporterId: validRep?.id || spec.outletId,
        reporterName: validRep?.name || creator || spec.outletName,
        author: validRep?.name || creator || spec.outletName,
        authorHandle: validRep?.handle || '',
        authorProfileUrl: validRep?.xUrl || link,
        trustTier: validRep?.trustTier || spec.trustTier || 2,
        wireSource: 'local_beat_rss'
      });
    }
  });

  // Parse Per-Team Curated YouTube Channels (official + local All-22 film) with live per-video embeddability verification
  const teamYtPending = [];
  teamCuratedYtSpecs.forEach((ytCh, idx) => {
    const xml = teamYtXmls[idx] || '';
    for (const m of xml.matchAll(/<entry\b[\s\S]*?<\/entry>/gi)) {
      const b = m[0];
      const videoId = (b.match(/<yt:videoId>([^<]+)<\/yt:videoId>/i) || [])[1]?.trim() || '';
      const title = decodeXmlEntities((b.match(/<title>([\s\S]*?)<\/title>/i) || [])[1] || '');
      const xmlCreator = decodeXmlEntities((b.match(/<author>[\s\S]*?<name>([\s\S]*?)<\/name>/i) || [])[1] || '').trim();
      const desc = decodeXmlEntities((b.match(/<media:description>([\s\S]*?)<\/media:description>/i) || [])[1] || '')
        .replace(/\s+/g, ' ')
        .trim();
      const pubRaw = (b.match(/<published>([^<]+)<\/published>/i) || [])[1]?.trim() || '';
      if (!videoId || !title) continue;
      if (/#shorts\b/i.test(title) || /youtube\.com\/shorts\//i.test(b)) continue;
      const pubMs = pubRaw ? Date.parse(pubRaw) : NaN;
      if (Number.isFinite(pubMs)) atomPubByVideoId.set(videoId, new Date(pubMs).toISOString());
      const maxAgeDays = ytCh.category === 'film' ? 60 : 21;
      if (!Number.isFinite(pubMs) || Date.now() - pubMs > maxAgeDays * 86_400_000) continue;
      teamYtPending.push({ ytCh, videoId, title, xmlCreator, desc, pubIso: new Date(pubMs).toISOString() });
    }
  });
  const verifiedTeamYtItems = await Promise.all(
    teamYtPending.map(async entry => {
      const check =
        entry.ytCh.embeddable === false
          ? { exists: true, embeddable: false, authorName: entry.ytCh.name }
          : await verifyYouTubeEmbeddable(entry.videoId);
      return { ...entry, check };
    })
  );
  for (const entry of verifiedTeamYtItems) {
    if (entry.check?.exists === false) continue;
    const { ytCh, videoId, title, xmlCreator, desc, pubIso, check } = entry;
    const creatorName = ytCh.name || xmlCreator || check?.authorName || 'YouTube';
    const watchUrl = `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`;
    pushNewsItem({
      id: `${team.abbr.toLowerCase()}_tyt_${videoId}`,
      type: 'video',
      category: ytCh.category,
      videoId,
      embeddable: ytCh.embeddable === false ? false : Boolean(check?.embeddable),
      title,
      summary: desc.slice(0, 220),
      imageUrl: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
      imageAlt: title,
      publishedAt: pubIso,
      url: watchUrl,
      externalVideoUrl: watchUrl,
      channel: creatorName,
      outletId: ytCh.id,
      outletName: creatorName,
      reporterId: ytCh.id,
      reporterName: creatorName,
      author: creatorName,
      authorHandle: ytCh.handle,
      authorProfileUrl: `https://www.youtube.com/${ytCh.handle}`,
      trustTier: ytCh.trustTier || 2,
      wireSource: 'team_youtube_atom'
    });
  }
  // Also search official NFL YouTube channel for recent player & game highlight cutups across ALL 32 clubs
  const latestCompForYt = [...schedule].reverse().find(g => g.completed && !g.isByeWeek) || null;
  const officialTeamYtCh = teamCuratedYtSpecs.find(c => c.category !== 'film') || null;
  const [nflHighlightVids, clubHighlightVids] = await Promise.all([
    searchYouTubeChannelVideos(
      'UCDVYQ4Zhbm3S2dlz7P1GBDg',
      'NFL',
      latestCompForYt?.week ? `${team.nickname} Week ${latestCompForYt.week}` : `${team.fullName} ${seasonYear} Highlights`,
      8
    ).catch(() => []),
    officialTeamYtCh
      ? searchYouTubeChannelVideos(
          officialTeamYtCh.id,
          officialTeamYtCh.name,
          latestCompForYt?.opponent?.shortName || (latestCompForYt?.week ? `Week ${latestCompForYt.week}` : 'Highlights'),
          12
        ).catch(() => [])
      : Promise.resolve([])
  ]);
  for (const hv of [...clubHighlightVids, ...nflHighlightVids]) {
    if (!hv?.videoId || !hv?.title) continue;
    if (!teamOrStarRe.test(hv.title) && hv.channel !== officialTeamYtCh?.name) continue;
    const resolvedPubIso =
      atomPubByVideoId.get(hv.videoId) ||
      hv.publishedAt ||
      hv.publishedAtIso ||
      parseRelativePublishedAgoToIso(hv.publishedAgo, Date.now());
    // Never falsely stamp an undated channel-search result as "just now" (nowIso)
    if (!resolvedPubIso) continue;
    const creatorName = hv.channel || hv.author || (officialTeamYtCh ? officialTeamYtCh.name : 'NFL');
    const isClubOfficial = Boolean(officialTeamYtCh && creatorName === officialTeamYtCh.name);
    const isOfficialNflChannel = !isClubOfficial && /^nfl$/i.test(String(creatorName || '').trim());
    pushNewsItem({
      id: `${team.abbr.toLowerCase()}_yts_${hv.videoId}`,
      type: 'video',
      videoId: hv.videoId,
      embeddable: isOfficialNflChannel ? false : hv.embeddable !== undefined ? hv.embeddable : false,
      title: hv.title,
      summary: hv.summary || '',
      duration: hv.duration || '',
      imageUrl: `https://i.ytimg.com/vi/${hv.videoId}/hqdefault.jpg`,
      imageAlt: hv.title,
      publishedAt: resolvedPubIso,
      url: `https://www.youtube.com/watch?v=${encodeURIComponent(hv.videoId)}`,
      externalVideoUrl: `https://www.youtube.com/watch?v=${encodeURIComponent(hv.videoId)}`,
      channel: creatorName,
      outletId: isClubOfficial ? `${team.slug}_official` : 'nfl_official',
      outletName: creatorName,
      reporterId: isClubOfficial ? `${team.slug}_official` : 'nfl_official',
      reporterName: creatorName,
      author: creatorName,
      authorHandle: isClubOfficial ? officialTeamYtCh.handle : '@NFL',
      authorProfileUrl: isClubOfficial
        ? `https://www.youtube.com/${officialTeamYtCh.handle}`
        : 'https://www.youtube.com/@NFL',
      trustTier: 1,
      wireSource: 'youtube_search'
    });
  }

  for (const cv of Array.isArray(curatedSfYtVideos) ? curatedSfYtVideos : []) {
    if (!cv?.videoId || !cv?.title) continue;
    const cvPubIso =
      atomPubByVideoId.get(cv.videoId) ||
      cv.publishedAt ||
      cv.publishedAtIso ||
      parseRelativePublishedAgoToIso(cv.publishedAgo, Date.now());
    if (!cvPubIso) continue;
    const creatorName = cv.author || cv.channel || cv.outletName || 'YouTube';
    const watchUrl = `https://www.youtube.com/watch?v=${encodeURIComponent(cv.videoId)}`;
    pushNewsItem({
      ...cv,
      id: `${team.abbr.toLowerCase()}_cyt_${cv.videoId}`,
      type: 'video',
      videoId: cv.videoId,
      embeddable: cv.embeddable === true,
      url: watchUrl,
      externalVideoUrl: watchUrl,
      imageUrl: cv.imageUrl || cv.thumbnailUrl || `https://i.ytimg.com/vi/${cv.videoId}/hqdefault.jpg`,
      imageAlt: cv.title,
      publishedAt: cvPubIso,
      channel: creatorName,
      author: creatorName,
      reporterName: creatorName,
      outletName: creatorName,
      authorHandle: cv.authorHandle || '',
      authorProfileUrl: cv.authorProfileUrl || watchUrl,
      wireSource: cv.wireSource || 'curated_youtube_atom'
    });
  }

  const bskyPosts = filterRawBlueskyPostsForTeam(rawBskyEntries || [], team, players);
  // Load previous news.json once for both Option B daily X-discovery slot tracking & 96h X carry-forward
  let prevNewsSnapshot = null;
  try {
    const prevNewsPath = path.join(getTeamOutDir(team), 'news.json');
    if (fs.existsSync(prevNewsPath)) {
      prevNewsSnapshot = JSON.parse(fs.readFileSync(prevNewsPath, 'utf8'));
    }
  } catch {}

  // Option B (Stage 2 Per-Team Grounded Gemini Search X-Status Discovery):
  // SF runs FIRST (ALL_NFL_TEAMS[0]) with 2x daily quota (am + pm) on best tokens (`gemini-4-hydrogen` -> Flash);
  // all other 31 clubs get an even 1x daily sweep (`daily`) on Flash-first tokens (`gemini-3.8-flash` -> `2.5-flash`).
  // Every discovered URL is verified & hydrated via Syndication/FxTwitter (zero hallucinated IDs).
  let teamXSearchDiscoveryMeta = prevNewsSnapshot?.xSearchDiscoveryMeta || null;
  let geminiDiscoveredXPayload = '';
  const teamDiscoveryNowMs = Date.now();
  const teamXSearchEnabled =
    process.env.ENABLE_GEMINI_X_SEARCH === '1' &&
    (!leagueCtx.quotaState || isSearchGroundingAllowed(leagueCtx.quotaState, teamDiscoveryNowMs));
  const teamDiscoveryPlan = resolveGeminiXDiscoveryPlan({
    scope: 'team',
    team,
    nowMs: teamDiscoveryNowMs,
    prevMeta: teamXSearchDiscoveryMeta,
    hasApiKey: Boolean(geminiApiKey && teamXSearchEnabled),
    force: process.argv.includes('--force-x-discovery')
  });
  if (teamDiscoveryPlan.shouldRun) {
    const teamSearchHandles = selectTeamLocalXHandles(team, reportersData, 18);
    const teamDiscRes = await discoverXStatusesViaGeminiSearch({
      scope: 'team',
      team,
      slotKey: teamDiscoveryPlan.slotKey,
      handles: teamSearchHandles,
      rosterPlayers: players,
      apiKey: geminiApiKey,
      modelCascade: teamDiscoveryPlan.modelCascade,
      nowMs: teamDiscoveryNowMs
    }).catch(() => ({ ok: false, statusUrls: [], rawPayloadText: '' }));
    if (teamDiscRes.ok) {
      geminiDiscoveredXPayload = teamDiscRes.rawPayloadText || '';
      const updatedSlots = Array.from(
        new Set([...(teamDiscoveryPlan.completedSlotsToday || []), teamDiscoveryPlan.slotKey])
      );
      teamXSearchDiscoveryMeta = {
        datePt: teamDiscoveryPlan.datePt,
        dailyQuota: teamDiscoveryPlan.dailyQuota,
        completedSlots: updatedSlots,
        lastModelUsed: teamDiscRes.modelUsed || null,
        lastUrlCount: (teamDiscRes.statusUrls || []).length,
        updatedAt: new Date(teamDiscoveryNowMs).toISOString()
      };
      console.log(
        `[stage-2/x-discovery] ${team.abbr} ${teamDiscoveryPlan.slotKey.toUpperCase()} (${teamDiscRes.modelUsed}, quota=${updatedSlots.length}/${teamDiscoveryPlan.dailyQuota}): found=${(teamDiscRes.statusUrls || []).length} X status URLs`
      );
    }
  }

  // Deep Beat-Article HTML Embed Harvesting + Option B Gemini-Discovered Status Hydration (100% free via api.fxtwitter.com across ALL 32 clubs):
  // Fetch public HTML of up to 10 recent film/takeaway/grade local beat articles to extract embedded X clips/GIFs/charts
  const recentLocalBeatArticlesForEmbeds = rawStream.filter(
    it =>
      it &&
      it.type === 'article' &&
      (it.wireSource === 'local_beat_rss' || it.wireSource === 'club_official_rss') &&
      it.url
  );
  const beatArticleHtmlPayloads = await fetchBeatArticleHtmlForXEmbeds(recentLocalBeatArticlesForEmbeds, {
    maxArticles: 10,
    concurrency: 5,
    timeoutMs: 4500
  }).catch(() => []);
  const embeddedXItems = await harvestEmbeddedXForTeamRss(
    [
      ...(geminiDiscoveredXPayload ? [geminiDiscoveredXPayload] : []),
      clubNewsRssXml,
      pfrTeamRssXml,
      JSON.stringify(espnNewsRaw || {}),
      ...localBeatRssXmls,
      ...beatArticleHtmlPayloads
    ],
    {
      team,
      rosterPlayers: players,
      reportersData,
      maxHydrate: 36,
      allowEmbeddedBeatQuotes: true
    }
  ).catch(() => []);
  const localXItems = filterXTimelineItemsForTeam(localXRaw, {
    team,
    rosterPlayers: players,
    reportersData,
    isNationalPool: false
  });
  const nationalFilmXForTeam = filterXTimelineItemsForTeam(leagueCtx.nationalFilmXItems || [], {
    team,
    rosterPlayers: players,
    reportersData,
    isNationalPool: true
  });
  // Accumulative 96-hour carry-forward across rotating 30-minute X slices (and transient 429s):
  // preserves valid recent harvested X clips, GIFs, charts & beat tweets from handles not polled in this bucket!
  const freshXUrls = new Set(
    [...localXItems, ...embeddedXItems, ...nationalFilmXForTeam]
      .map(it => String(it?.url || '').trim().toLowerCase())
      .filter(Boolean)
  );
  const freshXStatusIds = new Set(
    [...localXItems, ...embeddedXItems, ...nationalFilmXForTeam]
      .map(it => extractXSid(it?.url || ''))
      .filter(Boolean)
  );
  const currentRosterIds = new Set(players.map(p => String(p.id || '')).filter(Boolean));
  const carriedXItems = [];
  try {
    if (prevNewsSnapshot) {
      const prevNews = prevNewsSnapshot;
      const carryCutoffMs = Date.now() - 96 * 3_600_000;
      const otherTeamHandlesLow = new Set(
        Object.entries(OFFICIAL_TEAM_X_HANDLES_BY_ABBR)
          .filter(([abbr]) => abbr !== team.abbr)
          .map(([, h]) => String(h || '').toLowerCase())
          .filter(Boolean)
      );
      const localKnownLow = new Set([
        ...selectTeamLocalXHandles(team, reportersData, 32).map(h => h.toLowerCase()),
        ...NATIONAL_FILM_ANALYTICS_X_HANDLES.map(h => h.toLowerCase()),
        'nfl', 'espnnfl', 'nflnetwork', 'adamschefter', 'rapsheet', 'tompelissero', 'mikegarafolo', 'dmrussini', 'fieldyates', 'jayglazer', 'profootballtalk'
      ]);
      for (const it of prevNews?.rawStream || []) {
        if (it?.wireSource !== 'x_timeline_live') continue;
        const uKey = String(it.url || '').trim().toLowerCase();
        const sid = extractXSid(uKey);
        if (!uKey || freshXUrls.has(uKey) || (sid && freshXStatusIds.has(sid))) continue;
        const pubMs = Date.parse(it.publishedAt || '');
        if (!Number.isFinite(pubMs) || pubMs < carryCutoffMs) continue;
        if (isPromotionalAdvertisement(it)) continue;
        const hLow = String(it.authorHandle || '').replace(/^@/, '').trim().toLowerCase();
        if (hLow && (otherTeamHandlesLow.has(hLow) || (/(?:comms|pr)$/i.test(hLow) && !localKnownLow.has(hLow)))) continue;
        const hasRichFilmOrClip = Boolean(
          it.videoStreamUrl || it.isAnimatedGif || (it.hasInlineChartImage && it.category === 'film')
        );
        if (!it.reporterId && !localKnownLow.has(hLow) && !hasRichFilmOrClip) continue;
        // Prune stale mentionedPlayers whose IDs are no longer on the live roster (e.g. post-waiver/trade)
        const prunedMentions = Array.isArray(it.mentionedPlayers)
          ? it.mentionedPlayers.filter(mp => mp?.id && currentRosterIds.has(String(mp.id)))
          : [];
        carriedXItems.push({ ...it, mentionedPlayers: prunedMentions });
      }
    }
  } catch {}
  const combinedDirectSocial = [
    ...localXItems,
    ...embeddedXItems,
    ...nationalFilmXForTeam,
    ...carriedXItems.slice(0, 40),
    ...bskyPosts
  ];
  for (const xi of combinedDirectSocial) pushNewsItem(xi);

  // 9g. ESPN 24/7 Player Wire Batch across ALL 32 clubs (top active/injured numeric-ESPN-ID players, 7-day window)
  const sevenDayWireCutoffMs = Date.now() - 7 * 86_400_000;
  const keyWirePlayers = players
    .filter(p => /^\d{4,10}$/.test(String(p.id || '')))
    .sort((a, b) => {
      const aInj = a.health?.injuryStatus && a.health.injuryStatus !== 'Healthy' ? 1 : 0;
      const bInj = b.health?.injuryStatus && b.health.injuryStatus !== 'Healthy' ? 1 : 0;
      const aSkill = ['QB', 'WR', 'RB', 'TE'].includes(String(a.position || '').toUpperCase()) ? 1 : 0;
      const bSkill = ['QB', 'WR', 'RB', 'TE'].includes(String(b.position || '').toUpperCase()) ? 1 : 0;
      return bInj - aInj || bSkill - aSkill || (Number(b.primarySnapPct) || 0) - (Number(a.primarySnapPct) || 0);
    })
    .slice(0, 42);
  for (let i = 0; i < keyWirePlayers.length; i += 12) {
    const slice = keyWirePlayers.slice(i, i + 12);
    await Promise.all(
      slice.map(async p => {
        const pwJson = await fetchJsonSafe(
          `https://site.api.espn.com/apis/fantasy/v2/games/ffl/news/players?playerId=${encodeURIComponent(p.id)}&limit=3`,
          6000
        );
        for (const entry of pwJson?.feed || []) {
          const pubIso = entry.published || entry.lastModified || '';
          const pubMs = pubIso ? Date.parse(pubIso) : NaN;
          if (!Number.isFinite(pubMs) || pubMs < sevenDayWireCutoffMs) continue;
          const rawHeadline = cleanSensationalistText(stripHtmlAndDecodeEntities(String(entry.headline || '')));
          const rawDesc = cleanSensationalistText(stripHtmlAndDecodeEntities(String(entry.description || '')));
          const rawStory = cleanSensationalistText(stripHtmlAndDecodeEntities(String(entry.story || '')));
          const lead = rawDesc || rawHeadline;
          if (!lead || lead.length < 20) continue;
          if (/\b(fantasy|lineup help|sleepers|waiver wire|d\/st|start\/sit)\b/i.test(`${rawHeadline} ${rawDesc}`)) continue;
          const bylineHint = entry.byline
            ? String(entry.byline).replace(/^By\s+/i, '').split(/\s+and\s+|,/i)[0].trim()
            : '';
          const attr = extractBeatAttributionFromText(`${rawDesc} ${rawStory}`.trim(), {
            reporterId: null,
            reporterName: bylineHint || `${team.nickname} Beat Wire`,
            outletId: 'espn',
            outletName: 'ESPN / X Beat Wire'
          });
          const cleanFull = cleanSensationalistText(attr.cleanedText || lead);
          const directWeb = sanitizeExternalUrl(entry.links?.web?.href, null);
          if (!directWeb && !attr.viaWire && !bylineHint) continue;
          const isDirectArticle = Boolean(directWeb && !isEspnPlayerProfileUrl(directWeb) && /\/nfl\/story\/_\/id\/\d+/i.test(directWeb));
          const isPlayerBlurb = !isDirectArticle;
          const pubIsoStr = new Date(pubMs).toISOString();
          const candidateDirectSocial =
            isPlayerBlurb && !(rawStory && rawStory.length >= 80)
              ? resolveOriginalTweetUrl(
                  {
                    type: 'tweet',
                    url: '',
                    author: attr.author,
                    reporterId: attr.reporterId,
                    reporterName: attr.reporterName,
                    authorHandle: attr.authorHandle,
                    primaryPlayer: p,
                    fullText: cleanFull,
                    title: cleanFull,
                    publishedAt: pubIsoStr
                  },
                  combinedDirectSocial
                )
              : null;
          const hasDirectPost = Boolean(candidateDirectSocial && isDirectSocialPostUrl(candidateDirectSocial));
          const effectiveType = isPlayerBlurb && hasDirectPost ? 'tweet' : 'article';
          const cleanLead = stripRedundantAuthorBoilerplate(rawDesc || rawHeadline || lead, attr.author);
          const itemUrl = isPlayerBlurb
            ? hasDirectPost
              ? candidateDirectSocial
              : buildEspnPlayerNewsAnchorUrl(p.id, p.name, rawDesc || rawHeadline)
            : directWeb;
          if (!itemUrl) continue;
          const fmtTw = formatTweetBodyForDisplay(cleanFull);
          const resolvedTitle =
            effectiveType === 'tweet' ? fmtTw.text : isDirectArticle ? rawHeadline || cleanLead : cleanLead || rawHeadline;
          const resolvedAuthor = isPlayerBlurb ? attr.author : bylineHint || 'ESPN';
          const repMatch = resolveReporterFromNameOrHandle(resolvedAuthor, team);
          const validRep = repMatch && !isPodiumSubjectId(repMatch.id) ? repMatch : null;
          pushNewsItem({
            id: `${team.abbr.toLowerCase()}_pwire_${p.id}_${entry.id || Math.floor(pubMs / 1000)}`,
            type: effectiveType,
            title: resolvedTitle,
            fullText: effectiveType === 'tweet' ? cleanFull : undefined,
            isFullTweet: effectiveType === 'tweet' ? fmtTw.isFullTweet : undefined,
            summary: (rawStory && rawStory !== cleanFull ? rawStory : rawDesc !== resolvedTitle ? rawDesc : '').slice(0, 220),
            publishedAt: pubIsoStr,
            url: itemUrl,
            outletId: validRep?.outletId || attr.outletId || 'espn',
            outletName: validRep?.outletName || attr.outletName || 'ESPN / X Beat Wire',
            reporterId: validRep?.id || attr.reporterId || null,
            reporterName: validRep?.name || resolvedAuthor,
            author: validRep?.name || resolvedAuthor,
            authorHandle: validRep?.handle || attr.authorHandle || '',
            authorProfileUrl: validRep?.xUrl || attr.authorProfileUrl || itemUrl,
            trustTier: validRep?.trustTier || attr.trustTier || 2,
            wireSource: 'espn_player_wire'
          });
        }
      })
    );
  }

  // 9h. Enrich verified exact durations for YouTube, ESPN clip, Bluesky HLS & club-matched videos
  await enrichRawStreamVideoDurations(rawStream);

  // 10. Live Power Rankings (teamStats & teamStatRankings already built in Step 5)
  const outDir = getTeamOutDir(team);
  let previousPowerRankings = null;
  try {
    const existingSmPath = path.join(outDir, 'schedule-matchup.json');
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
  const playoffPicture = buildConferencePlayoffPicture(team, leagueCtx, {
    healthData: { practiceReport, irReserve: irAndReserveTracker },
    rosterPlayers: players
  });

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
      currentWeek,
      inPlayoffHunt: (playoffPicture.baselineSimulation?.teamOdds?.makePlayoffsPct ?? 50) > 0,
      playoffSeed: teamStanding.seed,
      seasonConcluded: false,
      mathematicallyEliminated: (playoffPicture.baselineSimulation?.teamOdds?.makePlayoffsPct ?? 50) <= 0,
      eliminatedAt: null
    },
    aiEngine: {
      activeModel: leagueCtx.aiModelDiscovery?.activeModel || PRIMARY_GEMINI_REASONING_MODEL,
      thinkingLevel: 'XHIGH',
      thinkingBudget: 24576,
      autoPollEnabled: true,
      pollIntervalHours: 24,
      candidateCascade: leagueCtx.aiModelDiscovery?.candidateCascade || [PRIMARY_GEMINI_REASONING_MODEL, 'gemini-3.8-flash'],
      source: leagueCtx.aiModelDiscovery?.source || 'live-v1beta',
      lastCheckedAt: nowIso,
      quotaOwner: 'joshalbox@gmail.com'
    }
  };

  const kickoffDate = nextUnplayed?.dateIso ? new Date(nextUnplayed.dateIso) : null;
  const broadcastLabel = String(nextUnplayed?.broadcast || 'NFL TV').trim();
  const kickoffDisplayBase = kickoffDate
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
  const kickoffDisplay =
    kickoffDisplayBase !== 'TBD' && broadcastLabel && !kickoffDisplayBase.includes(broadcastLabel)
      ? `${kickoffDisplayBase} • ${broadcastLabel}`
      : kickoffDisplayBase;

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

  const venueObjForWeather = nextUnplayed?.venue || { name: team.stadium, city: team.city, state: '', country: 'USA' };
  const venueLabelForWeather = typeof venueObjForWeather === 'string'
    ? venueObjForWeather
    : [venueObjForWeather.name, venueObjForWeather.city].filter(Boolean).join(' • ');
  const homeAbbrForWeather = nextUnplayed?.homeAway === 'away' ? (nextUnplayed?.opponent?.abbr || '') : team.abbr;
  const stadiumMetaForWeather = resolveNflStadiumMeta({
    venueName: venueLabelForWeather,
    homeTeamAbbr: homeAbbrForWeather
  });
  let upcomingMatchupWeather = null;
  if (nextUnplayed && !nextUnplayed.completed && !nextUnplayed.isByeWeek && nextUnplayed.opponent?.abbr !== 'TBD') {
    const sbW = nextUnplayed.id ? leagueCtx.espnWeatherByGameId?.get(String(nextUnplayed.id)) : null;
    if (sbW?.indoor === true || (sbW?.indoor !== false && stadiumMetaForWeather?.isIndoor)) {
      upcomingMatchupWeather = { indoor: true, altitudeFt: stadiumMetaForWeather?.altitudeFt || 0, source: 'stadium' };
    } else if (sbW && sbW.tempF != null) {
      upcomingMatchupWeather = {
        indoor: false,
        tempF: sbW.tempF,
        condition: sbW.condition || '',
        windMph: null,
        windDir: '',
        precipPct: null,
        altitudeFt: stadiumMetaForWeather?.altitudeFt || 0,
        source: 'espn'
      };
    } else if (stadiumMetaForWeather && !stadiumMetaForWeather.isIndoor && nextUnplayed.dateIso) {
      upcomingMatchupWeather = await fetchKickoffOutdoorWeather(nextUnplayed.dateIso, stadiumMetaForWeather);
    }
  }

  // Populate full betting lines (Spread, O/U, Implied Score, Opening Line, Moneyline & Rest Advantage)
  let nextPickPrimary = null;
  if (nextUnplayed?.id && /^\d{6,12}$/.test(String(nextUnplayed.id)) && !nextUnplayed.completed) {
    const sumRaw = await fetchJsonSafe(
      `https://site.web.api.espn.com/apis/site/v2/sports/football/nfl/summary?event=${encodeURIComponent(nextUnplayed.id)}`,
      8000
    ).catch(() => null);
    nextPickPrimary = sumRaw?.pickcenter?.[0] || null;
  }
  const teamIsHomeNext = (nextUnplayed?.homeAway || 'home') !== 'away';
  const oppAbbrNext = nextUnplayed?.opponent?.abbr || 'OPP';
  const signedSpreadNext = (() => {
    if (nextPickPrimary?.details) {
      const m = String(nextPickPrimary.details).trim().match(/^([A-Z]{2,4})\s*([+-]?\d+(?:\.\d+)?)$/i);
      if (m) {
        const fav = normalizeAnyTeamAbbr(m[1]);
        const v = Number(m[2]);
        if (Number.isFinite(v)) return fav === team.abbr ? -Math.abs(v) : Math.abs(v);
      }
      if (/^(?:pk|even)$/i.test(String(nextPickPrimary.details).trim())) return 0;
    }
    if (nextPickPrimary?.spread != null && Number.isFinite(Number(nextPickPrimary.spread))) {
      return teamIsHomeNext ? Number(nextPickPrimary.spread) : -Number(nextPickPrimary.spread);
    }
    if (nextUnplayed?.spreadLineSf != null && Number.isFinite(Number(nextUnplayed.spreadLineSf))) {
      return Number(nextUnplayed.spreadLineSf);
    }
    return null;
  })();
  const ouNext = (() => {
    for (const c of [nextPickPrimary?.overUnder, nextUnplayed?.totalLine]) {
      const n = Number(c);
      if (Number.isFinite(n) && n >= 20 && n <= 85) return Math.round(n * 2) / 2;
    }
    return null;
  })();
  const spreadDispNext =
    String(nextPickPrimary?.details || '').trim() ||
    (signedSpreadNext == null
      ? 'TBD'
      : signedSpreadNext === 0
        ? 'PK'
        : signedSpreadNext < 0
          ? `${team.abbr} ${signedSpreadNext.toFixed(1)}`
          : `${team.abbr} +${signedSpreadNext.toFixed(1)}`);
  const impliedScoreDispNext =
    signedSpreadNext != null && ouNext != null
      ? `${team.abbr} ${((ouNext - signedSpreadNext) / 2).toFixed(1)} – ${oppAbbrNext} ${((ouNext + signedSpreadNext) / 2).toFixed(1)}`
      : 'TBD';
  const fmtMlNext = v => {
    const n = Number(v);
    if (!Number.isFinite(n) || n === 0) return null;
    return n > 0 ? `+${Math.round(n)}` : `${Math.round(n)}`;
  };
  const teamMlRawNext = teamIsHomeNext ? nextPickPrimary?.homeTeamOdds?.moneyLine : nextPickPrimary?.awayTeamOdds?.moneyLine;
  const oppMlRawNext = teamIsHomeNext ? nextPickPrimary?.awayTeamOdds?.moneyLine : nextPickPrimary?.homeTeamOdds?.moneyLine;
  const moneylineDispNext = (() => {
    if (fmtMlNext(teamMlRawNext) && fmtMlNext(oppMlRawNext)) {
      return `${team.abbr} ${fmtMlNext(teamMlRawNext)} | ${oppAbbrNext} ${fmtMlNext(oppMlRawNext)}`;
    }
    if (signedSpreadNext != null) {
      if (Math.abs(signedSpreadNext) < 0.25) return `${team.abbr} -110 | ${oppAbbrNext} -110`;
      const pT = Math.max(0.06, Math.min(0.94, 1 / (1 + Math.exp(signedSpreadNext / 4.2))));
      const pO = 1 - pT;
      const toAmer = p => {
        const raw = p >= 0.5 ? -((p / (1 - p)) * 100) : ((1 - p) / p) * 100;
        const s = Math.round(raw / 5) * 5;
        return s === 0 ? -110 : s;
      };
      return `${team.abbr} ${fmtMlNext(toAmer(Math.min(0.95, pT * 1.022)))} | ${oppAbbrNext} ${fmtMlNext(toAmer(Math.min(0.95, pO * 1.022)))}`;
    }
    return 'TBD';
  })();
  const openLineNext = teamIsHomeNext
    ? nextPickPrimary?.pointSpread?.home?.open?.line
    : nextPickPrimary?.pointSpread?.away?.open?.line;
  const openingSpreadDispNext =
    openLineNext != null && String(openLineNext).trim()
      ? `Opened ${team.abbr} ${openLineNext} (${nextPickPrimary?.provider?.name || 'Sportsbook Consensus'})`
      : spreadDispNext !== 'TBD'
        ? `Consensus ${spreadDispNext}`
        : 'Consensus Line TBD';
  const restDeltaNext = Number(nextUnplayed?.restAdvantageDays || 0);
  const restAdvDispNext =
    restDeltaNext > 0
      ? `+${restDeltaNext} Days Rest Advantage${byeWeek && currentWeek === byeWeek + 1 ? ` (${team.abbr} off Week ${byeWeek} Bye)` : ''}`
      : restDeltaNext < 0
        ? `${restDeltaNext} Days Rest Differential (${oppAbbrNext} extra rest)`
        : 'Even Rest (Standard Prep Week)';

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
    venue: venueObjForWeather,
    weather: upcomingMatchupWeather,
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
      teamAbbr: oppCfg?.abbr || oppAbbrNext,
      teamName: oppCfg?.fullName || nextUnplayed?.opponent?.name || 'Opponent',
      sourceUrl: oppCfg ? oppCfg.clubInjuryUrl : 'https://www.espn.com/nfl/injuries',
      teamInjuriesUrl: oppCfg ? buildCbsTeamInjuriesUrl(oppCfg.abbr, oppCfg.fullName) : 'https://www.espn.com/nfl/injuries',
      byeWeek: null,
      summary: {
        overallAvailabilityScore: oppOverallAvailabilityScore,
        totalStarters: oppTotalStarters,
        startersHealthy: oppStartersClearedCount,
        injuredCount: oppInjuryReport.length,
        irCount: oppIrReserve.length,
        text: `${oppInjuryReport.length} on injury report, ${oppIrReserve.length} on IR/Reserve`
      },
      activeRoster: oppActiveRoster,
      keyStartersHealthy: oppKeyStartersHealthy,
      injuryReport: oppInjuryReport,
      irReserve: oppIrReserve
    },
    betting: {
      favorite:
        signedSpreadNext == null
          ? 'TBD'
          : signedSpreadNext === 0
            ? 'PK'
            : signedSpreadNext < 0
              ? team.abbr
              : oppAbbrNext,
      spread: spreadDispNext,
      openingSpread: openingSpreadDispNext,
      overUnder: ouNext ?? 'TBD',
      moneyline: moneylineDispNext,
      impliedScore: impliedScoreDispNext,
      restAdvantage: restAdvDispNext,
      impliedWinProb:
        signedSpreadNext != null
          ? `${Math.round((1 / (1 + Math.exp(signedSpreadNext / 4.2))) * 100)}%`
          : '50%'
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
    keyMatchupsMatrix: buildTeamKeyMatchupsMatrix({
      team,
      oppAbbr: oppAbbrNext,
      oppName: nextUnplayed?.opponent?.name || 'Opponent',
      players,
      oppActiveRoster,
      oppKeyStartersHealthy,
      teamStats
    })
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
    blueprint: buildTeamCapBlueprint(team, otcYears, capPlayers, seasonYear),
    players: capPlayers
  };

  // Build authentic seasonYear Draft Class & Priority UDFAs (using nflverse draft_picks.csv + roster spiderProfiles!)
  let existingSeasonalDraftClass = null;
  let prevCapNoteCached = null;
  let prevCapNoteDatePt = '';
  let prevCapNoteFingerprint = '';
  const todayPt = getPacificDateKey(Date.now());
  try {
    const existingSeasonalPath = path.join(outDir, 'seasonal.json');
    if (fs.existsSync(existingSeasonalPath)) {
      const prevSeas = JSON.parse(fs.readFileSync(existingSeasonalPath, 'utf8'));
      existingSeasonalDraftClass = prevSeas?.draftClass2026 || null;
      if (prevSeas?.tradeWarRoom?.capPurchasingPowerNote) {
        prevCapNoteCached = prevSeas.tradeWarRoom.capPurchasingPowerNote;
        prevCapNoteDatePt = String(prevSeas.tradeWarRoom.aiCapNoteDatePt || '');
        prevCapNoteFingerprint = String(prevSeas.tradeWarRoom.aiCapNoteFingerprint || '');
      }
    }
  } catch {}
  const existingPickByNormName = new Map(
    (existingSeasonalDraftClass?.picks || []).map(pk => [normPlayerName(pk?.name || ''), pk])
  );
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

    const prevPickRec = existingPickByNormName.get(normPlayerName(matched?.name || dp.name)) || null;
    const nflProspectSlug = String(matched?.name || dp.name)
      .toLowerCase()
      .replace(/['’.]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');
    const nflScoutingUrl =
      prevPickRec?.nflScoutingUrl && /^https:\/\/www\.nfl\.com\/prospects\//i.test(prevPickRec.nflScoutingUrl)
        ? prevPickRec.nflScoutingUrl
        : `https://www.nfl.com/prospects/${nflProspectSlug}`;

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
      nflScoutingUrl,
      ...(prevPickRec?.highlightVideo ? { highlightVideo: prevPickRec.highlightVideo } : {}),
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

  // Cross-reference club's verified recent trades onto `draftPrep2027.tradedPicksNote` across ALL 32 clubs
  // so traded-away upcoming-draft picks explicitly cite the acquired player and counterparty (e.g. Rd 4 sent to IND for Buckner)
  if (draftPrep2027 && typeof draftPrep2027.tradedPicksNote === 'string') {
    const draftYrNum = Number(draftPrep2027.draftYear || seasonYear + 1);
    const wordToRd = { first: 1, second: 2, third: 3, fourth: 4, fifth: 5, sixth: 6, seventh: 7 };
    const tradeDetails = [];
    const recentMovesList = [
      ...(tradeIntel?.tradeWarRoom?.completed2026Moves || []),
      ...(tradeIntel?.tradeWarRoom?.recentTrades || [])
    ];
    for (const tr of recentMovesList) {
      const cost = String(tr?.costSummary || '');
      const yrMatch = cost.match(new RegExp(`\\b${draftYrNum}\\b`));
      const rdMatch = cost.match(
        /\b([1-7])(?:st|nd|rd|th)[- ]round|\bRd\s*([1-7])\b|\b(first|second|third|fourth|fifth|sixth|seventh)[- ]round/i
      );
      if (!rdMatch) continue;
      if (!yrMatch && /\b202[0-9]\b/.test(cost)) continue;
      const rd = Number(rdMatch[1] || rdMatch[2] || wordToRd[String(rdMatch[3] || '').toLowerCase()] || 0);
      if (!Number.isFinite(rd) || rd < 1 || rd > 7) continue;
      const fromTeam = String(tr.acquiredFrom || '').trim();
      const playerName = String(tr.player || '').trim();
      if (!playerName) continue;
      tradeDetails.push(`Rd ${rd} sent${fromTeam ? ` to ${fromTeam}` : ''} for ${playerName}`);
    }
    if (tradeDetails.length > 0) {
      const baseNote = draftPrep2027.tradedPicksNote.replace(/\.$/, '');
      draftPrep2027.tradedPicksNote = `${baseNote} (incl. ${tradeDetails.slice(0, 3).join('; ')}).`;
    }
  }

  // Change-gated 2-sentence Cap Purchasing Power Note:
  // Reuses existing note whenever cap space (+/-$500K) and draft-pick count are unchanged (0 RPD spent!),
  // and when cap/picks DO change, routes strictly to Pool 2 (`lite`, e.g. `gemini-3.5-flash-lite` 500 RPD)
  // so 100% of Pool 1 High-Reasoning tokens stay preserved for Top-News Briefs and Matchup Intel!
  const capNoteFingerprint = `${Math.round(Number(cap26?.teamCapSpace || 0) / 500_000)}|${Math.round(Number(cap27?.teamCapSpace || 0) / 500_000)}|${tankathonPicks?.length || 0}`;
  const canReuseCapNote = Boolean(
    prevCapNoteCached &&
      (prevCapNoteDatePt === todayPt || (prevCapNoteFingerprint && prevCapNoteFingerprint === capNoteFingerprint))
  );
  if (canReuseCapNote && tradeIntel?.tradeWarRoom) {
    tradeIntel.tradeWarRoom.capPurchasingPowerNote = prevCapNoteCached;
    tradeIntel.tradeWarRoom.aiCapNoteDatePt = prevCapNoteDatePt || todayPt;
    tradeIntel.tradeWarRoom.aiCapNoteFingerprint = capNoteFingerprint;
  } else if (geminiApiKey && !process.env.SKIP_TRADE_AI && tradeIntel?.tradeWarRoom) {
    try {
      const capPromptFacts = JSON.stringify({
        team: team.fullName,
        seasonYear,
        currentWeek,
        record: teamStanding.record,
        capCurrent: cap26?.teamCapSpace,
        capNext: cap27?.teamCapSpace,
        draftPickCount: tankathonPicks?.length || 0
      });
      const capAiRes = await runSinglePassDailyGeminiSynthesis({
        apiKey: geminiApiKey,
        promptText: `Facts: ${capPromptFacts}\nReturn strict JSON {"capNote": "..."} with a concise 2-sentence CBA cap-rollover & trade-window synthesis for ${team.fullName} grounded strictly in the provided ${seasonYear}/${seasonYear + 1} cap space, draft pick count, and weekly proration mechanics.`,
        appData: { meta, roster: { players }, cap: capJson },
        rosterPlayers: players,
        quotaState: leagueCtx.quotaState,
        pool: 'lite',
        isPriorityTeam: team.abbr === 'SF',
        allowSearchGrounding: false,
        maxOutputTokens: 320
      });
      if (typeof leagueCtx.persistQuotaState === 'function') leagueCtx.persistQuotaState();
      if (capAiRes.ok && capAiRes.rawText) {
        const cleanCap = capAiRes.rawText.replace(/^```json\s*/i, '').replace(/```$/i, '').trim();
        const parsedCap = JSON.parse(cleanCap);
        if (parsedCap?.capNote && !hasCrossTeam49ersLeak(parsedCap.capNote, team, oppAbbrNext)) {
          tradeIntel.tradeWarRoom.capPurchasingPowerNote = String(parsedCap.capNote).trim();
          tradeIntel.tradeWarRoom.aiCapNoteDatePt = todayPt;
          tradeIntel.tradeWarRoom.aiCapNoteFingerprint = capNoteFingerprint;
        }
      }
    } catch {
      // Non-fatal: deterministic cap purchasing power note remains intact
    }
  }

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

  // Fetch latest completed game summary for `lastCompletedGameRecap` across ALL 32 clubs
  const latestCompletedSchedItem =
    [...schedule].reverse().find(g => g.completed && !g.isByeWeek && g.id && /^\d{6,12}$/.test(String(g.id))) || null;
  let lastCompletedGameRecap = null;
  if (latestCompletedSchedItem) {
    const compSum = await fetchJsonSafe(
      `https://site.web.api.espn.com/apis/site/v2/sports/football/nfl/summary?event=${encodeURIComponent(latestCompletedSchedItem.id)}`,
      8000
    ).catch(() => null);
    if (compSum) {
      try {
        lastCompletedGameRecap = extractCompletedGameRecapSummary(compSum, latestCompletedSchedItem);
      } catch {
        lastCompletedGameRecap = null;
      }
    }
  }

  const teamTxLedger = parseEspnTransactionsToLedger(espnTxRaw?.transactions || [], {
    teamRoster: players,
    seasonYear
  });
  if (playoffPicture && leagueCtx.liveScoresByMatchup) {
    playoffPicture.liveScoresByMatchup = leagueCtx.liveScoresByMatchup;
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

  // Keep roster players sorted alphabetically ascending by name across all 32 teams
  players.sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));

  const rosterJson = {
    updatedAt: nowIso,
    count: players.length,
    excludedGhostIds,
    departedPlayers,
    positionalLeaderboards,
    peerDirectory,
    transactions: teamTxLedger.transactions,
    psElevations: teamTxLedger.psElevations,
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
    lastCompletedGameRecap,
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
    news: {
      updatedAt: nowIso,
      ...(teamXSearchDiscoveryMeta ? { xSearchDiscoveryMeta: teamXSearchDiscoveryMeta } : {}),
      dailyTopNewsBrief: null,
      clusteredBriefs: [],
      rawStream
    }
  };

  tempAppData.news.rawStream = sortNewsWithBreakingPriority(rawStream, Date.now(), { appData: tempAppData });
  reconcileRosterAndHealthWithNews(tempAppData);

  // Attach deep 7-day rolling `recentNews` to every roster player (pruning stale completed-game availability notes!)
  const cleanStreamForPlayers = filterOutCompletedGameAvailabilityItems(
    tempAppData.news.rawStream,
    tempAppData,
    Date.now()
  );
  const recentByPid = new Map();
  for (const item of cleanStreamForPlayers) {
    for (const mp of item.mentionedPlayers || []) {
      if (!mp?.id) continue;
      if (!recentByPid.has(mp.id)) recentByPid.set(mp.id, []);
      const arr = recentByPid.get(mp.id);
      if (arr.length >= 12) continue;
      arr.push({
        id: item.id,
        type: item.type || 'article',
        headline: item.title || '',
        title: item.title || '',
        fullText: item.fullText || undefined,
        summary: item.summary || '',
        ...(item.imageUrl ? { imageUrl: item.imageUrl } : {}),
        ...(Array.isArray(item.imageUrls) && item.imageUrls.length > 0 ? { imageUrls: item.imageUrls } : {}),
        ...(item.hasInlineChartImage ? { hasInlineChartImage: true } : {}),
        url: item.url,
        author: item.author || item.outletName || `${team.nickname} Beat`,
        outletName: item.outletName || `${team.nickname} Beat`,
        publishedAt: item.publishedAt
      });
    }
  }
  for (const p of players) {
    p.recentNews = recentByPid.get(p.id) || [];
  }

  // Build structured high-SNR `clusteredBriefs` (>=3 topic clusters with verified sourceLinks) across ALL 32 clubs!
  const buildClusterCard = (id, category, headline, items) => {
    const picked = (items || []).filter(i => i?.url && i?.title).slice(0, 6);
    if (picked.length === 0) return null;
    return {
      id: `${team.abbr.toLowerCase()}_cl_${id}`,
      category,
      headline,
      summary: picked.slice(0, 2).map(i => i.title).join(' — ').slice(0, 260),
      updatedAt: picked[0].publishedAt || nowIso,
      itemCount: picked.length,
      sourceLinks: picked.map(i => ({
        label: i.author || i.outletName || `${team.nickname} Beat`,
        title: i.title,
        url: i.url,
        publishedAt: i.publishedAt
      }))
    };
  };
  const nonFilmRaw = tempAppData.news.rawStream.filter(i => !i.filmOnlyScope);
  tempAppData.news.clusteredBriefs = [
    buildClusterCard(
      'top',
      'beat',
      `${team.fullName} Week ${currentWeek} Top Headlines (${meta.teamRecord})`,
      nonFilmRaw.filter(i => i.type !== 'video')
    ),
    buildClusterCard(
      'health',
      'injury',
      `${team.nickname} Practice Report, Injury & IR Availability`,
      nonFilmRaw.filter(i => i.category === 'injury' || /injur|practice|ir\b|questionable|out\b/i.test(i.title || ''))
    ),
    buildClusterCard(
      'film',
      'film',
      `${team.nickname} All-22 Film, Trench & Efficiency Breakdowns`,
      tempAppData.news.rawStream.filter(i => i.category === 'film')
    ),
    buildClusterCard(
      'roster',
      'roster',
      `${team.nickname} Roster Moves, Trades & Salary Cap Desk`,
      nonFilmRaw.filter(i => i.category === 'roster' || i.category === 'cap')
    )
  ].filter(Boolean);
  if (tempAppData.news.clusteredBriefs.length < 3 && nonFilmRaw.length > 0) {
    const fallbackCluster = buildClusterCard(
      'matchup',
      'beat',
      `Week ${currentWeek} Matchup Prep vs. ${upcomingMatchup.oppName}`,
      nonFilmRaw.slice(0, 5)
    );
    if (fallbackCluster) tempAppData.news.clusteredBriefs.push(fallbackCluster);
  }

  // Reuse an already-generated live/pipeline Gemini brief for the exact same cycleKey so hourly refreshes spend 0 extra API calls!
  let existingBrief = null;
  let priorCycleBrief = null;
  try {
    const existingNewsPath = path.join(outDir, 'news.json');
    if (fs.existsSync(existingNewsPath)) {
      const prev = JSON.parse(fs.readFileSync(existingNewsPath, 'utf8'));
      existingBrief = prev?.dailyTopNewsBrief || null;
    }
  } catch {}
  if (!existingBrief && process.env.CI) {
    try {
      const livePrev = await fetchJsonSafe(`https://${team.domain}/${getTeamDataRelUrl(team, 'news.json')}`, 4500);
      existingBrief = livePrev?.dailyTopNewsBrief || null;
    } catch {}
  }
  const activeBriefCycleCheck = resolveNewsBriefCycleState(Date.now(), tempAppData, 17).activeCycleKey;
  if (existingBrief?.cycleKey && existingBrief.cycleKey !== activeBriefCycleCheck) {
    priorCycleBrief = existingBrief;
  }

  tempAppData.news.dailyTopNewsBrief = await generateGroundedDailyBrief(team, tempAppData, geminiApiKey, {
    existingBrief,
    priorCycleBrief,
    forceBrief: process.argv.includes('--force-brief'),
    aiModelDiscovery: leagueCtx.aiModelDiscovery || { activeModel: PRIMARY_GEMINI_REASONING_MODEL },
    quotaState: leagueCtx.quotaState || null,
    persistQuotaState: leagueCtx.persistQuotaState || null
  });

  // Preserve any pre-generated studio `.m4a` episodes / sharedAnalyses in `podcasts/index.json`!
  const podIndexPath = path.join(outDir, 'podcasts', 'index.json');
  let existingPodIndex = null;
  try {
    if (fs.existsSync(podIndexPath)) {
      existingPodIndex = JSON.parse(fs.readFileSync(podIndexPath, 'utf8'));
    }
  } catch {}
  const podcastIndexJson = {
    updatedAt: nowIso,
    episodes: Array.isArray(existingPodIndex?.episodes) ? existingPodIndex.episodes : [],
    sharedAnalyses: Array.isArray(existingPodIndex?.sharedAnalyses) ? existingPodIndex.sharedAnalyses : []
  };

  // Write all 11 JSON files cleanly (`data/` for SF, `data/teams/{slug}/` for all 31 other teams), upgrading any http:// URLs
  const writeCleanJson = (targetPath, payload) => {
    fs.writeFileSync(targetPath, JSON.stringify(upgradeHttpUrlsDeep(payload), null, 2));
  };
  fs.mkdirSync(path.join(outDir, 'podcasts'), { recursive: true });
  writeCleanJson(path.join(outDir, 'meta.json'), meta);
  writeCleanJson(path.join(outDir, 'roster.json'), rosterJson);
  writeCleanJson(path.join(outDir, 'depth-chart.json'), depthChartJson);
  writeCleanJson(path.join(outDir, 'cap.json'), capJson);
  writeCleanJson(path.join(outDir, 'health.json'), healthJson);
  writeCleanJson(path.join(outDir, 'news.json'), tempAppData.news);
  writeCleanJson(path.join(outDir, 'schedule-matchup.json'), scheduleMatchupJson);
  writeCleanJson(path.join(outDir, 'seasonal.json'), seasonalJson);
  writeCleanJson(path.join(outDir, 'reporters.json'), reportersData);
  writeCleanJson(path.join(outDir, 'beat-podcasts.json'), beatPodcasts);
  writeCleanJson(podIndexPath, podcastIndexJson);

  console.log(
    `[stage-2] Done ${team.abbr} (${team.slug}): record=${meta.teamRecord}, roster=${players.length}, capPlayers=${capPlayers.length}, departed=${departedPlayers.length}, power=${powerRankings.sources?.length || 0}/${powerRankings.allSources?.length || 0} (#${powerRankings.consensusRank ?? '—'}), news=${tempAppData.news.rawStream.length}, brief=${tempAppData.news.dailyTopNewsBrief?.source} (${tempAppData.news.dailyTopNewsBrief?.modelUsed}), pods7d=${beatPodcasts.totalEpisodes}, playoffOdds=${playoffPicture.baselineSimulation?.teamOdds?.makePlayoffsPct}%`
  );
}

async function refreshPowerRankingsOnlyForTeams(teams, seasonYear = 2026) {
  const sampleMeta = teams
    .map(t => {
      const p = path.join(getTeamOutDir(t), 'meta.json');
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
    const outDir = getTeamOutDir(team);
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
    teams = [...ALL_NFL_TEAMS];
  } else if (teamsArg) {
    const rawList = teamsArg.replace(/^--teams?=/, '').split(',').map(s => s.trim()).filter(Boolean);
    teams = rawList.map(resolveTeamConfig).filter(Boolean);
  } else {
    teams = [...ALL_NFL_TEAMS];
  }
  if (missingOnly) {
    teams = teams.filter(t => !fs.existsSync(path.join(getTeamOutDir(t), 'meta.json')));
  }
  if (teams.length === 0) {
    console.log('[stage-2] All target teams already built (0 remaining).');
    return;
  }

  if (powerRankingsOnly) {
    await refreshPowerRankingsOnlyForTeams(teams, 2026);
    return;
  }

  const geminiApiKey = String(
    process.env.GEMINI_NFL_API_KEY || process.env.GEMINI_NEWS_API_KEY || process.env.GEMINI_API_KEY || ''
  ).trim();
  const leagueCtx = await loadSharedLeagueContext(2026, { geminiApiKey });
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
