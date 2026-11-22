/**
 * Data Loader, Sub-Minute Live Wire Hydrator & Resilient LocalStorage User Preferences Manager
 */

import { scoreContentSignal, cleanSensationalistText } from '../engine/antiFluffFilter.js';
import { normalizeScheduleGameItem, resolveCompleteScheduleModel } from '../engine/seasonStateMachine.js';
import {
  canonicalInjuryPlayerKey,
  collapseInitialDots,
  computeOpponentPriorDayPlayProbability,
  computePlayerPlayProbability,
  computeTeamHealthSummary,
  doesClauseMentionPlayer,
  evaluateCorroboratedNewsInjurySignal,
  extractPracticeDaysFromText,
  isBareStatusPlaceholderComment,
  isMidWeekHealthyAdditionRow,
  isPlayerEligibleForInjuryNews,
  isRestOrPersonalInjuryLabel,
  parseOfficial49ersInjuryReportHtml,
  pickMeaningfulInjuryComment,
  reconcileRosterAndHealthWithNews,
  resolveOfficialReportGameStatus,
  select22OffDefStartersFromDepthChart
} from '../engine/injuryProbabilityModel.js';
import {
  runPlayoffMonteCarlo,
  computeCalibratedTeamPowerRating,
  computeRootingGuideLeverage
} from '../engine/playoffMonteCarlo.js';
import {
  SHORT_TWEET_FULL_TEXT_LIMIT,
  WIRE_ARTICLE_EXCERPT_MAX_CHARS,
  WIRE_BLURB_SUMMARY_MAX_CHARS,
  buildBoundedWireSummary,
  sanitizeOversizedDirectArticleSummary,
  classifyBreakingItem,
  classifyNewsItemCategory,
  extractBlueskyBestExternalLink,
  promoteLinkDropTweetToArticle,
  reconcileLinkDropTweetsWithArticles,
  sortNewsWithBreakingPriority,
  formatTweetBodyForDisplay,
  isStaleCompletedGameAvailabilityItem,
  filterOutCompletedGameAvailabilityItems,
  filterAndCleanSynthesisClusters,
  stripRedundantAuthorBoilerplate
} from '../engine/breakingClassifier.js';
import {
  ESPN_NFL_TEAM_IDS,
  NFL_TEAM_OFFICIAL_RSS_URLS,
  evaluateGameDayWindow,
  isBeforeWeeklyPracticeWindow,
  discoverOfficialClubInactivesRssItem,
  parseOfficialClubInactivesArticle,
  parseEspnCoreEventRosterInactives,
  extractSleeperGameDaySignals,
  extractLiveInGameInjurySignals,
  buildTeamGameDayRosterModel,
  resolveGameDayInjuryRows,
  classifyRosterUnit,
  resolveEarlyWeekRolloverInput,
  rolloverPracticeReportForUpcomingWeek,
  normalizeLookupName,
  extractCompletedGameRecapSummary
} from '../engine/gameDayRosterEngine.js';
import { fetchGeminiFallbackGameDayInactives } from './aiWorkerClient.js';
import {
  AMBIGUOUS_PLAYER_SURNAMES,
  buildEspnPlayerNewsAnchorUrl,
  buildEspnPlayerUrl,
  buildEspnTeamInjuriesUrl,
  buildEspnTeamLogoUrl,
  buildPfrHeadToHeadUrl,
  hasExplicit49ersEntity,
  hasSafeStandaloneSurnameMatch,
  is49ersRelevantWireItem,
  isCompatiblePositionToken,
  isOffTopicLeagueFiller,
  isOpaqueShortenerUrl,
  sanitizeExternalUrl,
  stripAggregatorBoilerplate,
  stripHistoricalSfBioSentences
} from '../engine/linkIntegrity.js';
import {
  buildTargetedOriginalTweetUrl,
  configureBeatAttributionForTeam,
  extractBeatAttributionFromText,
  isDirectSocialPostUrl,
  isEspnPlayerProfileUrl,
  isPodiumSubjectId,
  resolveItemAuthorProfileUrl,
  resolveReporterFromNameOrHandle,
  resolveOriginalTweetUrl
} from '../engine/beatAttributionEngine.js';
import { refreshLiveStandingsMetricsInTeamStats } from '../engine/statsLeaderboardEngine.js';
import {
  buildDeterministicCoachingMatchup,
  getActiveTeamConfig,
  resolveTeamConfig,
  resolveTeamDataBasePath
} from '../config/teamRegistry.js';
import { reconcilePrefsWithSameOriginSharedKey } from './sharedApiKeyStore.js';

function getTeamStorageKeys() {
  return getActiveTeamConfig().storageKeys;
}
const STORAGE_KEY = 'joshal_49ers_hq_prefs_v1';
const LEGACY_WEEKLY_PRACTICE_CACHE_KEY = 'joshal_49ers_weekly_practice_v1';
const WEEKLY_PRACTICE_CACHE_KEY = 'joshal_49ers_weekly_practice_v2';
const GAMEDAY_INACTIVES_CACHE_KEY = 'joshal_49ers_gameday_inactives_v1';
const GITHUB_RAW_DATA_BASE = 'https://raw.githubusercontent.com/joshal7/49ers/main/data';

export const LIVE_WIRE_SOURCE_LABELS = [
  'ESPN X-Beat Player Wire',
  'RotoWire Live NFL Beat',
  '49ers Official Transactions',
  'ESPN Rapid Beat & Injury Desk',
  'Beat Social Mirrors'
];

export const LIVE_BLUESKY_BEAT_ACCOUNTS = [
  {
    actor: 'mattmaiocco.bsky.social',
    reporterId: 'matt_maiocco',
    reporterName: 'Matt Maiocco',
    authorHandle: '@MaioccoNBCS',
    outletId: 'nbcsba',
    outletName: 'NBC Sports Bay Area',
    isNationalInsider: false
  },
  {
    actor: 'mattbarrows.bsky.social',
    reporterId: 'matt_barrows',
    reporterName: 'Matt Barrows',
    authorHandle: '@mattbarrows',
    outletId: 'athletic',
    outletName: 'The Athletic',
    isNationalInsider: false
  },
  {
    actor: 'jenniferleechan.bsky.social',
    reporterId: 'jennifer_lee_chan',
    reporterName: 'Jennifer Lee Chan',
    authorHandle: '@jenniferleechan',
    outletId: 'nbcsba',
    outletName: 'NBC Sports Bay Area',
    isNationalInsider: false
  },
  {
    actor: 'timkawakami.bsky.social',
    reporterId: 'tim_kawakami',
    reporterName: 'Tim Kawakami',
    authorHandle: '@timkawakami',
    outletId: 'sf_standard',
    outletName: 'The SF Standard',
    isNationalInsider: true
  },
  {
    actor: 'nbcs49ers.bsky.social',
    reporterId: null,
    reporterName: '49ers on NBCSBA',
    authorHandle: '@NBCS49ers',
    outletId: 'nbcsba',
    outletName: 'NBC Sports Bay Area',
    isNationalInsider: false
  },
  {
    actor: 'nbcsportsbayarea.com',
    reporterId: null,
    reporterName: 'NBC Sports Bay Area',
    authorHandle: '@NBCSAuthentic',
    outletId: 'nbcsba',
    outletName: 'NBC Sports Bay Area',
    isNationalInsider: true
  },
  {
    actor: '49erswebzone.bsky.social',
    reporterId: null,
    reporterName: '49ers Webzone',
    authorHandle: '@49erswebzone',
    outletId: '49ers_webzone',
    outletName: '49ers Webzone',
    isNationalInsider: false
  },
  {
    actor: 'victafur.bsky.social',
    reporterId: 'vic_tafur',
    reporterName: 'Vic Tafur',
    authorHandle: '@VicTafur',
    outletId: 'athletic',
    outletName: 'The Athletic Bay Area',
    isNationalInsider: true
  },
  {
    actor: 'adamscheftermirror.bsky.social',
    reporterId: 'adam_schefter',
    reporterName: 'Adam Schefter',
    authorHandle: '@AdamSchefter',
    outletId: 'espn',
    outletName: 'ESPN NFL Insider',
    isNationalInsider: true
  },
  {
    actor: 'rapsheet.bsky.social',
    reporterId: 'ian_rapoport',
    reporterName: 'Ian Rapoport',
    authorHandle: '@RapSheet',
    outletId: 'nfl_network',
    outletName: 'NFL Network',
    isNationalInsider: true
  },
  {
    actor: 'tompelissero.bsky.social',
    reporterId: 'tom_pelissero',
    reporterName: 'Tom Pelissero',
    authorHandle: '@TomPelissero',
    outletId: 'nfl_network',
    outletName: 'NFL Network',
    isNationalInsider: true
  },
  {
    actor: 'diannarussini.bsky.social',
    reporterId: 'dianna_russini',
    reporterName: 'Dianna Russini',
    authorHandle: '@DMRussini',
    outletId: 'nfl_network',
    outletName: 'The Russini Report',
    isNationalInsider: true
  },
  {
    actor: 'profootballtalk.bsky.social',
    reporterId: 'mike_florio',
    reporterName: 'ProFootballTalk',
    authorHandle: '@ProFootballTalk',
    authorProfileUrl: 'https://x.com/ProFootballTalk',
    outletId: 'nfl_network',
    outletName: 'NBC ProFootballTalk',
    isNationalInsider: true
  },
  {
    actor: 'nfltraderumors.bsky.social',
    reporterId: null,
    reporterName: 'NFL Trade Rumors',
    authorHandle: '@nfltrade_rumors',
    authorProfileUrl: 'https://x.com/nfltrade_rumors',
    outletId: 'nfl_trade_rumors',
    outletName: 'NFL Trade Rumors',
    isNationalInsider: true
  },
  {
    actor: 'insidenflnews.bsky.social',
    reporterId: null,
    reporterName: 'NFL Insider Wire',
    authorHandle: '@NFL',
    authorProfileUrl: 'https://x.com/NFL',
    outletId: 'nfl_network',
    outletName: 'NFL Insider Wire',
    isNationalInsider: true
  },
  {
    actor: 'nflnewsreposterbot.bsky.social',
    reporterId: null,
    reporterName: 'NFL Beat & Insider Wire',
    authorHandle: '@NFL',
    authorProfileUrl: 'https://x.com/NFL',
    outletId: 'nfl_network',
    outletName: 'NFL Insider Wire',
    isNationalInsider: true
  }
];

export const FLAGSHIP_PODCAST_SHOWS_CLIENT = [
  {
    id: 'the_gold_standard',
    collectionId: 1524313515,
    name: 'The Gold Standard',
    hosts: 'Rob "Stats" Guerrera & Levin Black',
    network: 'Audacy / Bleav',
    feedUrl: 'https://rss.amperwave.net/v2/feed/audacynetwork/927bb572b427ed0168d252cd464a874b',
    appleShowUrl: 'https://podcasts.apple.com/us/podcast/the-gold-standard-san-francisco-49ers-podcast-network/id1524313515'
  },
  {
    id: '49ers_talk',
    collectionId: 1153457233,
    name: '49ers Talk',
    hosts: 'Matt Maiocco & Jennifer Lee Chan',
    network: 'NBC Sports Bay Area',
    feedUrl: 'https://feeds.simplecast.com/SCmnvidR',
    appleShowUrl: 'https://podcasts.apple.com/us/podcast/49ers-talk-a-san-francisco-49ers-podcast/id1153457233'
  },
  {
    id: '49ers_plus_minus',
    collectionId: 1827546443,
    name: '49ers +/-',
    hosts: 'Tim Kawakami & Matt Barrows',
    network: 'The San Francisco Standard / Audacy',
    feedUrl: 'https://rss.amperwave.net/v2/feed/audacynetwork/49ers-plus-minus',
    appleShowUrl: 'https://podcasts.apple.com/us/podcast/49ers-plus-minus/id1827546443'
  },
  {
    id: 'dieter_and_hutch',
    collectionId: 1530087532,
    name: 'Dieter and Hutch',
    hosts: 'Dieter Kurtenbach & Jake Hutchinson',
    network: 'Bay Area News Group / KNBR',
    feedUrl: 'https://feeds.castos.com/85z8',
    appleShowUrl: 'https://podcasts.apple.com/us/podcast/dieter-and-hutch/id1530087532'
  },
  {
    id: 'locked_on_49ers',
    collectionId: 1143358718,
    name: 'Locked On 49ers',
    hosts: 'Brian Peacock & Eric Crocker',
    network: 'Locked On Podcast Network',
    feedUrl: 'https://rss.pdrl.fm/f9f75c/feeds.simplecast.com/P83yLSb_',
    appleShowUrl: 'https://podcasts.apple.com/us/podcast/locked-on-49ers-daily-podcast-on-the-san-francisco-49ers/id1143358718'
  },
  {
    id: 'lombardi_lounge',
    collectionId: 1757355831,
    name: 'Lombardi Lounge',
    hosts: 'David Lombardi',
    network: 'The SF Standard / Lombardi',
    feedUrl: 'https://feeds.megaphone.fm/NSM7362508743',
    appleShowUrl: 'https://podcasts.apple.com/us/podcast/the-david-lombardi-lounge/id1757355831'
  }
];

export const DEFAULT_USER_PREFS = {
  theme: 'light', // 'light' = '94 Throwback White & Gold (Default) | 'dark' = Levi's Night Game
  themeDefaultVersion: 2,
  dashboardOrder: [],
  hiddenHomeBlockIds: [],
  pinnedHomeBlockIds: [],
  dashboardOrderVersion: 3,
  disabledReporterIds: [],
  disabledOutlets: [],
  muteHotTakePersonalities: false,
  strictAnalyticsFilmOnly: false,
  newsSortMode: 'top', // 'top' (default) | 'latest'
  groupSimilarStories: true, // Google News-style clustering when sorted by Top (Latest stays chronological)
  feedDensity: 'rich', // 'rich' (default) | 'compact'
  lastVisitedAt: null, // ISO watermark of prior session / caught-up timestamp
  readItemKeys: [], // bounded array (<=400) of opened/read wire item IDs or URLs
  pushAlerts: {
    enabled: false,
    channels: {
      tier1Breaking: true,
      dailyBriefReady: true,
      practiceDowngrades: false
    },
    subscribedAt: null,
    endpoint: ''
  },
  deltaSnapshots: {
    week: null,
    healthWeek: null,
    healthByPlayer: {},
    oppHealthKey: null,
    oppHealthByPlayer: {},
    statsByKey: {},
    playoffBaseline: null
  },
  groupPasscode: '',
  authorName: 'Josh',
  podFormat: 'two_host', // 'two_host' | 'solo'
  defaultPodDurationMin: 3, // 2..20
  workerBaseUrl: '',
  geminiApiKey: '',
  geminiApiKeyUpdatedAt: 0,
  geminiNewsApiKey: '',
  verifiedGeminiModel: '',
  geminiApiBaseUrl: '',
  capSelectedYear: null,
  capMoves: {}, // playerId -> action (primary year backward-compatible)
  capMovesByYear: {}, // year -> { playerId -> action }
  playoffForcedWinners: {}, // gameId -> 'HOME' | 'AWAY'
  localCustomAnalyses: [],
  localCustomEpisodes: [],
  deletedEpisodeIds: [],
  deletedAnalysisIds: []
};

export function loadUserPrefs() {
  try {
    const key = getTeamStorageKeys().prefs || STORAGE_KEY;
    const raw = window.localStorage.getItem(key);
    let prefs = structuredCloneFallback(DEFAULT_USER_PREFS);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        const orderIsV3 = parsed.dashboardOrderVersion === 3;
        const themeIsV2 = parsed.themeDefaultVersion === 2;
        prefs = {
          ...prefs,
          ...parsed,
          theme: themeIsV2 && (parsed.theme === 'dark' || parsed.theme === 'light') ? parsed.theme : 'light',
          themeDefaultVersion: 2,
          dashboardOrderVersion: 3,
          dashboardOrder: orderIsV3 && Array.isArray(parsed.dashboardOrder) ? parsed.dashboardOrder : [],
          hiddenHomeBlockIds:
            orderIsV3 && Array.isArray(parsed.hiddenHomeBlockIds) ? parsed.hiddenHomeBlockIds : [],
          pinnedHomeBlockIds:
            orderIsV3 && Array.isArray(parsed.pinnedHomeBlockIds) ? parsed.pinnedHomeBlockIds : [],
          disabledReporterIds: Array.isArray(parsed.disabledReporterIds) ? parsed.disabledReporterIds : [],
          disabledOutlets: Array.isArray(parsed.disabledOutlets) ? parsed.disabledOutlets : [],
          geminiApiKey: typeof parsed.geminiApiKey === 'string' ? parsed.geminiApiKey.trim() : '',
          geminiApiKeyUpdatedAt:
            Number.isFinite(Number(parsed.geminiApiKeyUpdatedAt)) && Number(parsed.geminiApiKeyUpdatedAt) > 0
              ? Math.floor(Number(parsed.geminiApiKeyUpdatedAt))
              : 0,
          geminiNewsApiKey: typeof parsed.geminiNewsApiKey === 'string' ? parsed.geminiNewsApiKey.trim() : '',
          podFormat: parsed.podFormat === 'solo' ? 'solo' : 'two_host',
          defaultPodDurationMin:
            Number.isFinite(Number(parsed.defaultPodDurationMin)) && Number(parsed.defaultPodDurationMin) >= 2
              ? Math.min(20, Math.round(Number(parsed.defaultPodDurationMin)))
              : 3,
          verifiedGeminiModel:
            typeof parsed.verifiedGeminiModel === 'string' ? parsed.verifiedGeminiModel.trim() : '',
          geminiApiBaseUrl:
            typeof parsed.geminiApiBaseUrl === 'string' ? parsed.geminiApiBaseUrl.trim() : '',
          capSelectedYear: typeof parsed.capSelectedYear === 'string' ? parsed.capSelectedYear : null,
          capMoves: parsed.capMoves && typeof parsed.capMoves === 'object' ? parsed.capMoves : {},
          capMovesByYear:
            parsed.capMovesByYear && typeof parsed.capMovesByYear === 'object' && !Array.isArray(parsed.capMovesByYear)
              ? parsed.capMovesByYear
              : {},
          playoffForcedWinners:
            parsed.playoffForcedWinners && typeof parsed.playoffForcedWinners === 'object'
              ? parsed.playoffForcedWinners
              : {},
          localCustomAnalyses: Array.isArray(parsed.localCustomAnalyses) ? parsed.localCustomAnalyses : [],
          localCustomEpisodes: Array.isArray(parsed.localCustomEpisodes) ? parsed.localCustomEpisodes : [],
          deletedEpisodeIds: Array.isArray(parsed.deletedEpisodeIds) ? parsed.deletedEpisodeIds : [],
          deletedAnalysisIds: Array.isArray(parsed.deletedAnalysisIds) ? parsed.deletedAnalysisIds : [],
          newsSortMode: parsed.newsSortMode === 'latest' ? 'latest' : 'top',
          groupSimilarStories: parsed.groupSimilarStories !== false,
          feedDensity: parsed.feedDensity === 'compact' ? 'compact' : 'rich',
          lastVisitedAt:
            typeof parsed.lastVisitedAt === 'string' && !Number.isNaN(Date.parse(parsed.lastVisitedAt))
              ? parsed.lastVisitedAt
              : null,
          readItemKeys: Array.isArray(parsed.readItemKeys)
            ? parsed.readItemKeys.filter(k => typeof k === 'string' && k.length > 0).slice(-400)
            : [],
          pushAlerts: {
            enabled: Boolean(parsed.pushAlerts?.enabled),
            channels: {
              tier1Breaking: parsed.pushAlerts?.channels?.tier1Breaking !== false,
              dailyBriefReady: parsed.pushAlerts?.channels?.dailyBriefReady !== false,
              practiceDowngrades: Boolean(parsed.pushAlerts?.channels?.practiceDowngrades)
            },
            subscribedAt: typeof parsed.pushAlerts?.subscribedAt === 'string' ? parsed.pushAlerts.subscribedAt : null,
            endpoint: typeof parsed.pushAlerts?.endpoint === 'string' ? parsed.pushAlerts.endpoint : ''
          },
          deltaSnapshots:
            parsed.deltaSnapshots && typeof parsed.deltaSnapshots === 'object' && !Array.isArray(parsed.deltaSnapshots)
              ? {
                  week: Number.isFinite(Number(parsed.deltaSnapshots.week)) ? Number(parsed.deltaSnapshots.week) : null,
                  healthWeek: Number.isFinite(Number(parsed.deltaSnapshots.healthWeek))
                    ? Number(parsed.deltaSnapshots.healthWeek)
                    : Number.isFinite(Number(parsed.deltaSnapshots.week))
                      ? Number(parsed.deltaSnapshots.week)
                      : null,
                  healthByPlayer:
                    parsed.deltaSnapshots.healthByPlayer && typeof parsed.deltaSnapshots.healthByPlayer === 'object'
                      ? parsed.deltaSnapshots.healthByPlayer
                      : {},
                  oppHealthKey:
                    typeof parsed.deltaSnapshots.oppHealthKey === 'string' ? parsed.deltaSnapshots.oppHealthKey : null,
                  oppHealthByPlayer:
                    parsed.deltaSnapshots.oppHealthByPlayer && typeof parsed.deltaSnapshots.oppHealthByPlayer === 'object'
                      ? parsed.deltaSnapshots.oppHealthByPlayer
                      : {},
                  statsByKey:
                    parsed.deltaSnapshots.statsByKey && typeof parsed.deltaSnapshots.statsByKey === 'object'
                      ? parsed.deltaSnapshots.statsByKey
                      : {},
                  playoffBaseline:
                    parsed.deltaSnapshots.playoffBaseline && typeof parsed.deltaSnapshots.playoffBaseline === 'object'
                      ? parsed.deltaSnapshots.playoffBaseline
                      : null
                }
              : {
                  week: null,
                  healthWeek: null,
                  healthByPlayer: {},
                  oppHealthKey: null,
                  oppHealthByPlayer: {},
                  statsByKey: {},
                  playoffBaseline: null
                }
        };
      }
    }

    // Synchronously reconcile against same-origin shared Gemini API key storage (`?team=` routes & multi-tab mirror)
    const syncRes = reconcilePrefsWithSameOriginSharedKey(prefs);
    if (syncRes.changed && raw) {
      saveUserPrefs(prefs);
    } else if (syncRes.changed && prefs.geminiApiKey) {
      saveUserPrefs(prefs);
    }
    return prefs;
  } catch {
    return structuredCloneFallback(DEFAULT_USER_PREFS);
  }
}

export function saveUserPrefs(prefs) {
  try {
    const key = getTeamStorageKeys().prefs || STORAGE_KEY;
    window.localStorage.setItem(key, JSON.stringify(prefs));
    return true;
  } catch {
    return false;
  }
}

function structuredCloneFallback(obj) {
  if (typeof structuredClone === 'function') {
    try {
      return structuredClone(obj);
    } catch {}
  }
  return JSON.parse(JSON.stringify(obj));
}

const OFFLINE_BUNDLE_IDB_NAME = '49ers_faithful_data_cache_v1';
const OFFLINE_BUNDLE_STORE = 'bundles';
const OFFLINE_BUNDLE_KEY = 'latest_v1';

function openOfflineBundleDb() {
  if (typeof indexedDB === 'undefined' || !indexedDB) return Promise.resolve(null);
  return new Promise(resolve => {
    try {
      const req = indexedDB.open(OFFLINE_BUNDLE_IDB_NAME, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(OFFLINE_BUNDLE_STORE)) {
          db.createObjectStore(OFFLINE_BUNDLE_STORE);
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

async function saveLastKnownGoodRawBundle(rawFiles) {
  const db = await openOfflineBundleDb();
  if (!db) return false;
  return new Promise(resolve => {
    try {
      const tx = db.transaction(OFFLINE_BUNDLE_STORE, 'readwrite');
      tx.objectStore(OFFLINE_BUNDLE_STORE).put(
        { savedAt: new Date().toISOString(), files: rawFiles },
        OFFLINE_BUNDLE_KEY
      );
      tx.oncomplete = () => {
        db.close();
        resolve(true);
      };
      tx.onerror = () => {
        db.close();
        resolve(false);
      };
    } catch {
      try {
        db.close();
      } catch {}
      resolve(false);
    }
  });
}

async function loadLastKnownGoodRawBundle() {
  const db = await openOfflineBundleDb();
  if (!db) return null;
  return new Promise(resolve => {
    try {
      const tx = db.transaction(OFFLINE_BUNDLE_STORE, 'readonly');
      const req = tx.objectStore(OFFLINE_BUNDLE_STORE).get(OFFLINE_BUNDLE_KEY);
      req.onsuccess = () => {
        const val = req.result?.files || null;
        db.close();
        resolve(val);
      };
      req.onerror = () => {
        db.close();
        resolve(null);
      };
    } catch {
      try {
        db.close();
      } catch {}
      resolve(null);
    }
  });
}

function sleepMs(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function fetchSingleWithTimeout(url, fetchInit = {}, timeoutMs = 8000) {
  const ctrl = typeof AbortController === 'function' ? new AbortController() : null;
  const timer = ctrl ? setTimeout(() => ctrl.abort(), timeoutMs) : null;
  try {
    return await fetch(url, {
      ...fetchInit,
      ...(ctrl ? { signal: ctrl.signal } : {})
    });
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function matchJsonFromCacheStorage(pathUrl) {
  if (typeof caches === 'undefined' || !caches?.match) return null;
  try {
    const cachedRes = await caches.match(pathUrl, { ignoreSearch: true });
    if (cachedRes && cachedRes.ok) {
      return await cachedRes.json();
    }
  } catch {}
  return null;
}

export async function fetchJsonSafe(pathUrl, { maxAttempts = 3, timeoutMs = 8000, allowGithubRawFallback = null } = {}) {
  let lastErr = null;
  const retryableStatuses = new Set([408, 425, 429, 500, 502, 503, 504]);

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      // First attempt checks fresh network (`no-cache`); retries allow HTTP/SW cache (`default`) to survive iOS socket drops (`Load failed`)
      const cacheMode = attempt === 1 ? 'no-cache' : 'default';
      const attemptTimeout = attempt === 1 ? timeoutMs : Math.round(timeoutMs * 1.25);
      const res = await fetchSingleWithTimeout(pathUrl, { cache: cacheMode }, attemptTimeout);
      if (res.ok) {
        return await res.json();
      }
      lastErr = new Error(`Failed to load ${pathUrl} (HTTP ${res.status})`);
      if (!retryableStatuses.has(res.status)) {
        break;
      }
    } catch (err) {
      lastErr = err;
    }
    if (attempt < maxAttempts) {
      await sleepMs(260 * attempt);
    }
  }

  // Fallback 1: Direct CacheStorage read (handles iOS PWA wake before SW claims client or offline reloads)
  const cachedJson = await matchJsonFromCacheStorage(pathUrl);
  if (cachedJson) return cachedJson;

  // Fallback 2: Cross-origin GitHub Raw mirror when hosted in production (`49ers.joshal.com` / `github.io`)
  const useRawFallback =
    allowGithubRawFallback !== null ? Boolean(allowGithubRawFallback) : isProductionHostedOrigin();
  const relMatch = String(pathUrl || '').match(/(?:^|\/)data\/(.+)$/);
  if (useRawFallback && relMatch && !String(pathUrl).startsWith(GITHUB_RAW_DATA_BASE)) {
    try {
      const rawUrl = `${GITHUB_RAW_DATA_BASE}/${relMatch[1].replace(/\?.*$/, '')}`;
      const rawRes = await fetchSingleWithTimeout(rawUrl, { cache: 'no-store' }, timeoutMs);
      if (rawRes.ok) {
        return await rawRes.json();
      }
    } catch {}
  }

  throw lastErr || new Error(`Failed to load ${pathUrl}`);
}

function isRealMedicalInjuryLabel(label = '') {
  const s = String(label || '').trim();
  if (!s) return false;
  if (isRestOrPersonalInjuryLabel(s)) return false;
  return !/^(?:cleared|undisclosed|coach'?s decision|healthy scratch|none|n\/a)\b/i.test(s);
}

function mergeNonDestructivePreGameRows(existingPreRows = [], latestRows = []) {
  if (!Array.isArray(latestRows) || latestRows.length === 0) return existingPreRows;
  if (!Array.isArray(existingPreRows) || existingPreRows.length === 0) {
    return latestRows.map(r => ({ ...r }));
  }
  const latestByKey = new Map(latestRows.map(r => [canonicalInjuryPlayerKey(r.name), r]));
  const seenKeys = new Set();
  const merged = existingPreRows.map(prev => {
    const k = canonicalInjuryPlayerKey(prev.name);
    seenKeys.add(k);
    const fresh = latestByKey.get(k);
    if (!fresh) return { ...prev };
    const next = { ...prev };
    for (const slot of ['wed', 'thu', 'fri']) {
      if (fresh[slot] && fresh[slot] !== '-') {
        next[slot] = fresh[slot];
      }
    }
    if (isRealMedicalInjuryLabel(fresh.injuryType)) {
      next.injuryType = fresh.injuryType;
    } else if (!next.injuryType && fresh.injuryType) {
      next.injuryType = fresh.injuryType;
    }
    // Only update pre-game probability/status when `fresh` has not been overridden by game-day In/Out badges
    const freshBadge = String(fresh.playBadgeLabel || '');
    if (!/in \(active\)|out \(inactive\)/i.test(freshBadge)) {
      if (fresh.gameStatus) next.gameStatus = fresh.gameStatus;
      if (Number.isFinite(fresh.playProbabilityPct)) next.playProbabilityPct = fresh.playProbabilityPct;
      if (Number.isFinite(fresh.priorDayPlayProbabilityPct)) {
        next.priorDayPlayProbabilityPct = fresh.priorDayPlayProbabilityPct;
      }
      if (typeof fresh.hasPreReportPracticeReturnDelta === 'boolean') {
        next.hasPreReportPracticeReturnDelta = fresh.hasPreReportPracticeReturnDelta;
      }
      if (typeof fresh.isMidWeekAdditionDelta === 'boolean') {
        next.isMidWeekAdditionDelta = fresh.isMidWeekAdditionDelta;
      }
      if (fresh.playBadgeLabel) next.playBadgeLabel = fresh.playBadgeLabel;
      if (fresh.playTier) next.playTier = fresh.playTier;
      if (Array.isArray(fresh.factors) && fresh.factors.length > 0) next.factors = fresh.factors;
      if (fresh.beatComment) next.beatComment = fresh.beatComment;
    }
    return next;
  });
  for (const [k, fresh] of latestByKey.entries()) {
    if (seenKeys.has(k)) continue;
    const freshBadge = String(fresh.playBadgeLabel || '');
    if (!/in \(active\)|out \(inactive\)/i.test(freshBadge)) {
      merged.push({ ...fresh });
    }
  }
  return merged;
}

function bufferOpponentNewsWireItem(appData, oppItem = null) {
  if (!appData || !oppItem) return false;
  const um = appData.scheduleMatchup?.upcomingMatchup || {};
  const oppAbbr = normalizeTeamAbbrClient(um.oppAbbr || '');
  const wk = Number(um.week || appData.meta?.currentWeek || 0);
  if (!oppAbbr || oppAbbr === 'TBD' || oppAbbr === 'BYE') return false;

  if (
    !Array.isArray(appData._oppNewsWire) ||
    appData._oppNewsWireKey !== `${wk}:${oppAbbr}`
  ) {
    appData._oppNewsWire = [];
    appData._oppNewsWireKey = `${wk}:${oppAbbr}`;
  }
  const leadKey = String(oppItem.fullText || oppItem.title || '').toLowerCase().slice(0, 90);
  if (!leadKey) return false;
  if (
    appData._oppNewsWire.some(
      w => (oppItem.id && w.id === oppItem.id) || String(w.fullText || w.title || '').toLowerCase().slice(0, 90) === leadKey
    )
  ) {
    return false;
  }
  appData._oppNewsWire.unshift(oppItem);
  if (appData._oppNewsWire.length > 80) {
    appData._oppNewsWire = appData._oppNewsWire
      .sort((a, b) => (Date.parse(b.publishedAt || '') || 0) - (Date.parse(a.publishedAt || '') || 0))
      .slice(0, 80);
  }
  return true;
}

export function persistWeeklyPracticeSnapshot(appData) {
  if (typeof window === 'undefined' || !window.localStorage || !appData) return;
  try {
    const um = appData.scheduleMatchup?.upcomingMatchup || {};
    const seasonYear = Number(appData.meta?.seasonYear || 2026);
    const week = Number(appData.health?.week || um.week || appData.meta?.currentWeek || 0);
    const oppAbbr = normalizeTeamAbbrClient(um.oppAbbr || '');
    const kickoffIso = um.kickoffIso || um.dateIso || '';
    if (!week || isBeforeWeeklyPracticeWindow(kickoffIso)) return;

    const sfSourceRows = Array.isArray(appData.health?._preGamePracticeReport)
      ? appData.health._preGamePracticeReport
      : Array.isArray(appData.health?.practiceReport)
        ? appData.health.practiceReport
        : [];
    const oppSourceRows = Array.isArray(um.opponentHealth?._preGameInjuryReport)
      ? um.opponentHealth._preGameInjuryReport
      : Array.isArray(um.opponentHealth?.injuryReport)
        ? um.opponentHealth.injuryReport
        : [];

    // Non-destructively seed from existing same-week cache so a transient Saturday blank slot
    // or lagging feed can NEVER erase verified earlier-in-the-week Wed/Thu/Fri practice slots!
    let prevSf = {};
    let prevOpp = {};
    try {
      const existingRaw = window.localStorage.getItem(WEEKLY_PRACTICE_CACHE_KEY);
      if (existingRaw) {
        const prevParsed = JSON.parse(existingRaw);
        const prevFresh = prevParsed && Date.now() - Number(prevParsed.savedAtMs || 0) <= 6.5 * 86_400_000;
        if (prevFresh && Number(prevParsed.seasonYear) === seasonYear && Number(prevParsed.week) === week) {
          if (prevParsed.sf && typeof prevParsed.sf === 'object') prevSf = prevParsed.sf;
          if (prevParsed.oppAbbr === oppAbbr && prevParsed.opp && typeof prevParsed.opp === 'object') {
            prevOpp = prevParsed.opp;
          }
        }
      }
    } catch {}

    const mergeCacheEntries = (prevMap, rows) => {
      const merged = {};
      for (const [k, rec] of Object.entries(prevMap || {})) {
        if (rec && typeof rec === 'object') merged[k] = { ...rec };
      }
      for (const r of rows) {
        const k = canonicalInjuryPlayerKey(r?.name || '');
        if (!k) continue;
        const oldRec = merged[k] || {};
        const wed = r.wed && r.wed !== '-' ? r.wed : oldRec.wed || '-';
        const thu = r.thu && r.thu !== '-' ? r.thu : oldRec.thu || '-';
        const fri = r.fri && r.fri !== '-' ? r.fri : oldRec.fri || '-';
        if (wed !== '-' || thu !== '-' || fri !== '-') {
          merged[k] = {
            wed,
            thu,
            fri,
            injuryType: isRealMedicalInjuryLabel(r.injuryType) ? r.injuryType : oldRec.injuryType || '',
            gameStatus:
              r.gameStatus && !/in \(active\)|inactive/i.test(String(r.gameStatus))
                ? r.gameStatus
                : oldRec.gameStatus || ''
          };
        }
      }
      return merged;
    };

    const sfEntries = mergeCacheEntries(prevSf, sfSourceRows);
    const oppEntries = mergeCacheEntries(prevOpp, oppSourceRows);
    if (Object.keys(sfEntries).length === 0 && Object.keys(oppEntries).length === 0) return;

    window.localStorage.setItem(
      WEEKLY_PRACTICE_CACHE_KEY,
      JSON.stringify({
        seasonYear,
        week,
        oppAbbr,
        savedAtMs: Date.now(),
        sf: sfEntries,
        opp: oppEntries
      })
    );
  } catch {}
}

export function persistGameDayInactivesSnapshot(appData, windowState = null) {
  if (typeof window === 'undefined' || !window.localStorage || !appData) return;
  try {
    if (!windowState || !windowState.isActive) {
      window.localStorage.removeItem(GAMEDAY_INACTIVES_CACHE_KEY);
      return;
    }
    const sfPosted = Boolean(appData.liveGameDay?.sf?.officialPosted && appData.liveGameDay.sf.inactives?.length >= 3);
    const oppPosted = Boolean(appData.liveGameDay?.opp?.officialPosted && appData.liveGameDay.opp.inactives?.length >= 3);
    if (!sfPosted && !oppPosted) return;

    const seasonYear = Number(appData.meta?.seasonYear || 2026);
    const oppAbbr = normalizeTeamAbbrClient(windowState.oppAbbr || appData.scheduleMatchup?.upcomingMatchup?.oppAbbr || '');
    window.localStorage.setItem(
      GAMEDAY_INACTIVES_CACHE_KEY,
      JSON.stringify({
        seasonYear,
        week: Number(windowState.week || 0),
        oppAbbr,
        savedAtMs: Date.now(),
        sf: sfPosted ? appData.liveGameDay.sf : null,
        opp: oppPosted ? appData.liveGameDay.opp : null
      })
    );
  } catch {}
}

export function hydrateCachedWeeklyPracticeAndInactives(appData) {
  if (typeof window === 'undefined' || !window.localStorage || !appData) return;
  const um = appData.scheduleMatchup?.upcomingMatchup || {};
  const seasonYear = Number(appData.meta?.seasonYear || 2026);
  const week = Number(appData.health?.week || um.week || appData.meta?.currentWeek || 0);
  const oppAbbr = normalizeTeamAbbrClient(um.oppAbbr || '');
  const kickoffIso = um.kickoffIso || um.dateIso || '';

  try {
    try {
      window.localStorage.removeItem(LEGACY_WEEKLY_PRACTICE_CACHE_KEY);
    } catch {}
    const rawPrac = window.localStorage.getItem(WEEKLY_PRACTICE_CACHE_KEY);
    if (rawPrac && week > 0 && !isBeforeWeeklyPracticeWindow(kickoffIso)) {
      const parsed = JSON.parse(rawPrac);
      const isFresh = parsed && Date.now() - Number(parsed.savedAtMs || 0) <= 6.5 * 86_400_000;
      if (isFresh && Number(parsed.seasonYear) === seasonYear && Number(parsed.week) === week) {
        const sfCache = parsed.sf || {};
        for (const p of appData.roster?.players || []) {
          if (!p?.health || !p.name) continue;
          const rec = sfCache[canonicalInjuryPlayerKey(p.name)];
          if (!rec) continue;
          for (const slot of ['wed', 'thu', 'fri']) {
            if ((!p.health[slot] || p.health[slot] === '-') && rec[slot] && rec[slot] !== '-') {
              p.health[slot] = rec[slot];
              p.health._practiceRestoredFromCache = true;
            }
          }
          if (!isRealMedicalInjuryLabel(p.health.injuryType) && isRealMedicalInjuryLabel(rec.injuryType)) {
            p.health.injuryType = rec.injuryType;
            p.health._practiceRestoredFromCache = true;
          }
          if (
            p.rosterBucket === 'active' &&
            rec.gameStatus &&
            ['Out', 'Doubtful', 'Questionable'].includes(rec.gameStatus) &&
            (!p.health.status || p.health.status === 'Active')
          ) {
            p.health.status = rec.gameStatus;
            p.health.isOnPracticeReport = true;
            p.health._practiceRestoredFromCache = true;
          }
        }
        for (const row of appData.health?.practiceReport || []) {
          const rec = sfCache[canonicalInjuryPlayerKey(row?.name || '')];
          if (!rec) continue;
          for (const slot of ['wed', 'thu', 'fri']) {
            if ((!row[slot] || row[slot] === '-') && rec[slot] && rec[slot] !== '-') {
              row[slot] = rec[slot];
            }
          }
          if (!isRealMedicalInjuryLabel(row.injuryType) && isRealMedicalInjuryLabel(rec.injuryType)) {
            row.injuryType = rec.injuryType;
          }
        }
        if (parsed.oppAbbr === oppAbbr && Array.isArray(um.opponentHealth?.injuryReport)) {
          const oppCache = parsed.opp || {};
          for (const row of um.opponentHealth.injuryReport) {
            const rec = oppCache[canonicalInjuryPlayerKey(row?.name || '')];
            if (!rec) continue;
            for (const slot of ['wed', 'thu', 'fri']) {
              if ((!row[slot] || row[slot] === '-') && rec[slot] && rec[slot] !== '-') {
                row[slot] = rec[slot];
              }
            }
            if (!isRealMedicalInjuryLabel(row.injuryType) && isRealMedicalInjuryLabel(rec.injuryType)) {
              row.injuryType = rec.injuryType;
            }
            const prob = computePlayerPlayProbability({
              name: row.name,
              position: row.position || 'ATH',
              snapPct: row.snapPct ?? null,
              gameStatus: row.gameStatus || 'Questionable',
              rosterBucket: row.isIrReturnQuestionable ? 'ir' : 'active',
              isIrReturnQuestionable: Boolean(row.isIrReturnQuestionable),
              injuryType: row.injuryType || '',
              wed: row.wed || '-',
              thu: row.thu || '-',
              fri: row.fri || '-',
              beatNote: `${row.shortComment || ''} ${row.longComment || ''}`.trim()
            });
            row.playProbabilityPct = prob.probabilityPct;
            row.playTier = prob.tier;
            row.playBadgeLabel = prob.badgeLabel;
            row.factors = prob.factors || [];
          }
          um.opponentHealth.injuryReport.sort((a, b) => a.playProbabilityPct - b.playProbabilityPct);
          um.opponentHealth.summary = computeTeamHealthSummary({
            injuryReport: um.opponentHealth.injuryReport,
            irReserve: um.opponentHealth.irReserve || [],
            totalStarters: um.opponentHealth.summary?.totalStarters || 22
          });
        }
      }
    }
  } catch {}

  try {
    const rawGd = window.localStorage.getItem(GAMEDAY_INACTIVES_CACHE_KEY);
    if (rawGd) {
      const parsedGd = JSON.parse(rawGd);
      const winState = evaluateGameDayWindow(appData.scheduleMatchup?.schedule || [], um, Date.now());
      if (
        winState.isActive &&
        parsedGd &&
        Number(parsedGd.seasonYear) === seasonYear &&
        Number(parsedGd.week) === Number(winState.week) &&
        Date.now() - Number(parsedGd.savedAtMs || 0) <= 12 * 3_600_000
      ) {
        appData.liveGameDay = {
          week: winState.week,
          sf: parsedGd.sf || null,
          opp: parsedGd.oppAbbr === oppAbbr ? parsedGd.opp || null : null,
          oppWireItems: []
        };
      }
    }
  } catch {}
}

function applyCachedGameDayRostersOnBoot(appData) {
  if (!appData?.liveGameDay) return;
  const um = appData.scheduleMatchup?.upcomingMatchup || null;
  const windowState = evaluateGameDayWindow(appData.scheduleMatchup?.schedule || [], um, Date.now());
  if (!windowState.isActive) return;

  const sfActivePlayers = (appData.roster?.players || []).filter(p => p.rosterBucket === 'active');
  if (appData.health && appData.liveGameDay.sf?.officialPosted) {
    if (!Array.isArray(appData.health._preGamePracticeReport) && Array.isArray(appData.health.practiceReport)) {
      appData.health._preGamePracticeReport = appData.health.practiceReport.map(r => ({ ...r }));
    }
    const activeTeamBoot = resolveTeamConfig(appData?.meta?.teamAbbr || getActiveTeamConfig());
    const baseSf = appData.health._preGamePracticeReport || appData.health.practiceReport || [];
    const sfModel = buildTeamGameDayRosterModel({
      teamAbbr: activeTeamBoot.abbr,
      teamName: activeTeamBoot.fullName,
      activeRosterPlayers: sfActivePlayers,
      injuryReport: baseSf,
      newsItems: appData.news?.rawStream || [],
      liveFeedData: appData.liveGameDay.sf,
      windowState
    });
    appData.health.gameDayRoster = sfModel;
    appData.health.practiceReport = resolveGameDayInjuryRows(baseSf, sfModel, {
      activeRosterPlayers: sfActivePlayers
    });
    const byName = new Map(appData.health.practiceReport.map(r => [normalizeLookupName(r.name), r]));
    const inactByKey = new Map((sfModel.inactives || []).map(x => [normalizeLookupName(x.name), x]));
    for (const p of sfActivePlayers) {
      if (!p.health) continue;
      if (!p._preGameHealthSnapshot) p._preGameHealthSnapshot = { ...p.health };
      const k = normalizeLookupName(p.name);
      const inact = inactByKey.get(k);
      const rep = byName.get(k);
      if (inact) {
        p.health.status = 'Inactive';
        p.health.playProbabilityPct = 0;
        p.health.playTier = 'OUT';
        p.health.playBadgeLabel = '0% • Out (Inactive)';
      } else if (rep) {
        p.health.status = rep.gameStatus || p.health.status;
        p.health.playProbabilityPct = rep.playProbabilityPct;
        p.health.playTier = rep.playTier || rep.tier || p.health.playTier;
        p.health.playBadgeLabel = rep.playBadgeLabel || p.health.playBadgeLabel;
      } else if (sfModel.officialPosted) {
        p.health.status = 'Active';
        p.health.playProbabilityPct = Math.max(95, Number(p.health.playProbabilityPct || 95));
        p.health.playTier = 'ACTIVE';
        if (!/full go|in \(active\)/i.test(String(p.health.playBadgeLabel || ''))) {
          p.health.playBadgeLabel = '99% • In (Active)';
        }
      }
    }
    synchronizeDepthChartForGameDay(appData);
  }
}

function hydrateBundlePostLoad(rawFiles) {
  const {
    meta,
    roster,
    depthChart,
    cap,
    reporters,
    news,
    scheduleMatchup,
    health,
    seasonal,
    podcastIndex,
    beatPodcasts
  } = rawFiles;

  const bootCtxStub = { meta, scheduleMatchup };
  const directPosts = Array.isArray(news?.rawStream)
    ? news.rawStream.filter(
        it => (it?.type === 'tweet' || it?.type === 'social') && isDirectSocialPostUrl(String(it?.url || ''))
      )
    : [];
  const promotedSocialMap = new Map();
  if (news && Array.isArray(news.rawStream)) {
    const mappedStream = reconcileLinkDropTweetsWithArticles(
      news.rawStream
        .filter(
          it =>
            !isOffTopicLeagueFiller({
              url: it?.externalUrl || it?.url || '',
              title: it?.title || it?.fullText || '',
              summary: it?.summary || it?.externalDescription || '',
              hasRosterMatch: Array.isArray(it?.mentionedPlayers) && it.mentionedPlayers.length > 0
            })
        )
        .map(rawIt => {
          const it = sanitizeOversizedDirectArticleSummary(rawIt);
          const isSoc =
            it?.type === 'tweet' || it?.type === 'social' || /^https?:\/\/bsky\.app\//i.test(String(it?.url || ''));
          if (!isSoc) return it;
          const promoted = promoteLinkDropTweetToArticle(it);
          if (promoted !== it && promoted.type === 'article') {
            return promoted;
          }
          return {
            ...it,
            url: resolveOriginalTweetUrl(it, directPosts),
            authorProfileUrl: resolveItemAuthorProfileUrl(it, null)
          };
        })
    );
    for (const it of mappedStream) {
      if (it?.promotedFromSocialUrl && it?.url) {
        promotedSocialMap.set(String(it.promotedFromSocialUrl).trim(), it);
      }
    }
    const dedupedByUrl = dedupeRawStreamAtomically(mappedStream);
    news.rawStream = sortNewsWithBreakingPriority(
      filterOutCompletedGameAvailabilityItems(dedupedByUrl, bootCtxStub),
      Date.now(),
      { appData: bootCtxStub }
    );
  }
  if (roster && Array.isArray(roster.players)) {
    for (const p of roster.players) {
      if (Array.isArray(p.recentNews)) {
        const seenMentionUrls = new Set();
        p.recentNews = p.recentNews
          .filter(rn => {
            if (String(rn?.id || '').startsWith('espn_pwire_')) {
              const ownerId = String(rn.id).split('_')[2] || '';
              if (ownerId && /^\d+$/.test(ownerId) && /^\d+$/.test(String(p.id || '')) && ownerId !== String(p.id)) {
                return false;
              }
            }
            const body = `${rn?.fullText || ''} ${rn?.title || ''} ${rn?.headline || ''} ${rn?.summary || ''} ${rn?.externalDescription || ''}`.trim();
            return body && doesClauseMentionPlayer(body, p.name, { allowSurname: true });
          })
          .map(rawRn => {
            const rn = sanitizeOversizedDirectArticleSummary(rawRn);
            const isSoc =
              rn?.type === 'tweet' || rn?.type === 'social' || /^https?:\/\/bsky\.app\//i.test(String(rn?.url || ''));
            if (!isSoc) return rn;
            const promoted = promoteLinkDropTweetToArticle(rn);
            if (promoted !== rn && promoted.type === 'article') {
              return promoted;
            }
            const mappedFromStream = rn?.url ? promotedSocialMap.get(String(rn.url).trim()) : null;
            if (mappedFromStream && mappedFromStream.type === 'article' && mappedFromStream.url) {
              return {
                ...rn,
                type: 'article',
                url: mappedFromStream.url,
                promotedFromSocialUrl: rn.url,
                headline: mappedFromStream.title || rn.headline || rn.title,
                title: mappedFromStream.title || rn.title || rn.headline,
                fullText: undefined,
                isFullTweet: false,
                summary: rn.summary || mappedFromStream.summary || '',
                externalUrl: null,
                externalTitle: null
              };
            }
            return {
              ...rn,
              url: resolveOriginalTweetUrl(
                { ...rn, type: rn.type || 'tweet', primaryPlayer: p, title: rn.title || rn.headline || '' },
                directPosts
              )
            };
          })
          .filter(rn => {
            const u = String(rn?.url || '').trim().replace(/\/+$/, '');
            if (!u || u.includes('x.com/search?') || u.includes('#:~:text=')) return true;
            if (seenMentionUrls.has(u)) return false;
            seenMentionUrls.add(u);
            return true;
          });
      }
    }
  }
  if (news && Array.isArray(news.clusteredBriefs)) {
    news.clusteredBriefs = filterAndCleanSynthesisClusters(
      news.clusteredBriefs.map(cl => {
        if (!Array.isArray(cl?.sourceLinks)) return cl;
        return {
          ...cl,
          sourceLinks: cl.sourceLinks.map(sl => {
            const promotedHit = sl?.url ? promotedSocialMap.get(String(sl.url).trim()) : null;
            if (promotedHit && promotedHit.type === 'article' && promotedHit.url) {
              return {
                ...sl,
                type: 'article',
                url: promotedHit.url,
                title: promotedHit.title || sl.title
              };
            }
            return sl && /^https?:\/\/bsky\.app\//i.test(String(sl.url || ''))
              ? {
                  ...sl,
                  url: resolveOriginalTweetUrl(
                    {
                      type: 'tweet',
                      url: sl.url,
                      author: sl.author || sl.label || sl.outlet || '',
                      authorHandle: sl.authorHandle || '',
                      title: sl.title || '',
                      fullText: sl.title || '',
                      publishedAt: sl.publishedAt || cl.publishedAt || ''
                    },
                    directPosts
                  )
                }
              : sl;
          })
        };
      }),
      bootCtxStub
    );
  }

  if (meta && typeof meta === 'object' && meta.updatedAt && !meta._upstreamUpdatedAt) {
    meta._upstreamUpdatedAt = meta.updatedAt;
  }

  const loadedBundle = {
    meta,
    roster,
    depthChart,
    cap,
    reporters,
    news,
    scheduleMatchup,
    health,
    seasonal,
    podcastIndex,
    beatPodcasts
  };
  hydrateCachedWeeklyPracticeAndInactives(loadedBundle);
  reconcileRosterAndHealthWithNews(loadedBundle);
  applyCachedGameDayRostersOnBoot(loadedBundle);
  return loadedBundle;
}

export async function loadAll49ersData(basePrefix = null) {
  const activeTeam = getActiveTeamConfig();
  const cleanBase = String(basePrefix || resolveTeamDataBasePath(activeTeam)).replace(/\/+$/, '');
  const fallbackShows =
    activeTeam.abbr !== 'SF' && Array.isArray(activeTeam.beatPodcastShows) && activeTeam.beatPodcastShows.length > 0
      ? activeTeam.beatPodcastShows
      : FLAGSHIP_PODCAST_SHOWS_CLIENT;
  try {
    const [
      meta,
      roster,
      depthChart,
      cap,
      reporters,
      news,
      scheduleMatchup,
      health,
      seasonal,
      podcastIndex,
      beatPodcasts
    ] = await Promise.all([
      fetchJsonSafe(`${cleanBase}/meta.json`),
      fetchJsonSafe(`${cleanBase}/roster.json`),
      fetchJsonSafe(`${cleanBase}/depth-chart.json`),
      fetchJsonSafe(`${cleanBase}/cap.json`),
      fetchJsonSafe(`${cleanBase}/reporters.json`).catch(() => ({ reporters: [], outlets: [] })),
      fetchJsonSafe(`${cleanBase}/news.json`),
      fetchJsonSafe(`${cleanBase}/schedule-matchup.json`),
      fetchJsonSafe(`${cleanBase}/health.json`),
      fetchJsonSafe(`${cleanBase}/seasonal.json`),
      fetchJsonSafe(`${cleanBase}/podcasts/index.json`).catch(() => ({ episodes: [], sharedAnalyses: [] })),
      fetchJsonSafe(`${cleanBase}/beat-podcasts.json`).catch(() => ({
        updatedAt: '',
        windowDays: 7,
        shows: fallbackShows,
        episodes: []
      }))
    ]);

    configureBeatAttributionForTeam(activeTeam, reporters, meta?.coaches || activeTeam.coachesSeed);

    const rawFiles = {
      meta,
      roster,
      depthChart,
      cap,
      reporters,
      news,
      scheduleMatchup,
      health,
      seasonal,
      podcastIndex,
      beatPodcasts
    };
    // Persist last-known-good snapshot off the synchronous critical boot path when IndexedDB is available
    const hydrated = hydrateBundlePostLoad(rawFiles);
    if (typeof indexedDB !== 'undefined' && indexedDB) {
      const idbTimer = setTimeout(() => {
        saveLastKnownGoodRawBundle(structuredCloneFallback(rawFiles)).catch(() => {});
      }, 1200);
      if (typeof idbTimer?.unref === 'function') idbTimer.unref();
    }
    return hydrated;
  } catch (primaryErr) {
    const fallbackRaw = await loadLastKnownGoodRawBundle();
    if (fallbackRaw?.meta && fallbackRaw?.roster && fallbackRaw?.scheduleMatchup) {
      const restored = hydrateBundlePostLoad(structuredCloneFallback(fallbackRaw));
      restored._restoredFromOfflineSnapshot = true;
      return restored;
    }
    throw primaryErr;
  }
}

function isProductionHostedOrigin() {
  if (typeof window === 'undefined' || !window.location) return false;
  const host = String(window.location.hostname || '').toLowerCase();
  return host.endsWith('joshal.com') || host.endsWith('github.io');
}

/**
 * Checks both same-origin `./data/meta.json` and (in production) GitHub's CORS-enabled
 * `raw.githubusercontent.com/joshal7/49ers/main/data/meta.json` so automated `GITHUB_TOKEN`
 * commits from GitHub Actions always propagate within seconds even without a Jekyll rebuild.
 */
export async function fetchFresherUpstreamData(currentUpdatedAt = '') {
  const activeTeam = getActiveTeamConfig();
  const basePath = resolveTeamDataBasePath(activeTeam);
  const curMs = Date.parse(currentUpdatedAt || '') || 0;
  const candidates = [basePath];
  if (isProductionHostedOrigin() && activeTeam.abbr === 'SF') {
    candidates.push(GITHUB_RAW_DATA_BASE);
  }

  let bestPrefix = null;
  let bestMs = curMs;

  await Promise.all(
    candidates.map(async prefix => {
      try {
        const res = await fetchSingleWithTimeout(`${prefix}/meta.json?t=${Date.now()}`, { cache: 'no-store' }, 6500);
        if (!res.ok) return;
        const meta = await res.json();
        const ts = Date.parse(meta?.updatedAt || '') || 0;
        if (ts > bestMs) {
          bestMs = ts;
          bestPrefix = prefix;
        }
      } catch {
        // Ignore transient offline / network errors
      }
    })
  );

  if (!bestPrefix) return null;
  return loadAll49ersData(bestPrefix);
}

function decodeXmlEntitiesClient(str = '') {
  return String(str || '')
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function hashWireKey(str = '') {
  let h = 2166136261;
  const s = String(str || '');
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36);
}

function escapeClientRegex(s = '') {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const ROSTER_MATCH_INDEX_CACHE = new WeakMap();

function getCompiledRosterMatchIndex(rosterPlayers) {
  const len = rosterPlayers.length;
  const firstId = String(rosterPlayers[0]?.id || rosterPlayers[0]?.name || '');
  const lastId = String(rosterPlayers[len - 1]?.id || rosterPlayers[len - 1]?.name || '');
  const cached = ROSTER_MATCH_INDEX_CACHE.get(rosterPlayers);
  if (cached && cached.len === len && cached.firstId === firstId && cached.lastId === lastId) {
    return cached;
  }

  const surnameCounts = new Map();
  for (const p of rosterPlayers) {
    const cleanParts = String(p?.name || '')
      .replace(/\s+(?:sr\.?|jr\.?|ii|iii|iv|v)$/i, '')
      .trim()
      .split(/\s+/);
    const sLower = (cleanParts[cleanParts.length - 1] || '').toLowerCase();
    if (sLower) surnameCounts.set(sLower, (surnameCounts.get(sLower) || 0) + 1);
  }

  const entries = [];
  for (const p of rosterPlayers) {
    const fullLower = String(p?.name || '').replace(/[’‘]/g, "'").toLowerCase().trim();
    if (!fullLower) continue;
    const strippedLower = fullLower.replace(/\s+(?:sr\.?|jr\.?|ii|iii|iv|v)$/i, '').trim();
    const collapsedStripped = collapseInitialDots(strippedLower);
    const cleanParts = String(p.name || '')
      .replace(/\s+(?:sr\.?|jr\.?|ii|iii|iv|v)$/i, '')
      .trim()
      .split(/\s+/);
    const surname = cleanParts[cleanParts.length - 1] || p.name;
    const surnameLower = surname.toLowerCase();
    const isUniqueSurname = surnameLower.length >= 4 && surnameCounts.get(surnameLower) === 1;
    const escSurname = escapeClientRegex(surnameLower);

    entries.push({
      player: p,
      surname,
      surnameLower,
      isDeebo: p.name === 'Deebo Samuel Sr.',
      isCmc: p.name === 'Christian McCaffrey',
      fullRe: new RegExp(`(?<![a-z0-9])${escapeClientRegex(fullLower)}(?![a-z0-9])`, 'i'),
      strippedRe:
        strippedLower.length >= 5 && strippedLower.includes(' ')
          ? new RegExp(`(?<![a-z0-9])${escapeClientRegex(strippedLower)}(?![a-z0-9])`, 'i')
          : null,
      collapsedRe:
        collapsedStripped.length >= 5 && collapsedStripped.includes(' ')
          ? new RegExp(`(?<![a-z0-9])${escapeClientRegex(collapsedStripped)}(?![a-z0-9])`, 'i')
          : null,
      posPrefixRe: isUniqueSurname
        ? new RegExp(
            `\\b(qb|rb|fb|wr|te|lt|lg|c|rg|rt|ot|og|ol|dt|de|dl|nt|edge|lb|ilb|olb|mlb|cb|nb|db|saf|k|pk|p|ls)s?\\s+${escSurname}\\b`,
            'i'
          )
        : null,
      injParenRe: isUniqueSurname
        ? new RegExp(`\\b${escSurname}\\s*\\([a-z /,-]{3,28}\\)`, 'i')
        : null,
      uniqueSurnameRe:
        isUniqueSurname && !AMBIGUOUS_PLAYER_SURNAMES.has(surnameLower)
          ? new RegExp(`\\b${escSurname}\\b`, 'i')
          : null
    });
  }

  const built = { len, firstId, lastId, entries };
  ROSTER_MATCH_INDEX_CACHE.set(rosterPlayers, built);
  return built;
}

export function matchPlayersClient(
  text = '',
  rosterPlayers = [],
  max = 12,
  { allowUniqueSurnames = true } = {}
) {
  const rawText = String(text || '').replace(/[’‘]/g, "'");
  const hay = rawText.toLowerCase();
  if (!hay || !Array.isArray(rosterPlayers) || rosterPlayers.length === 0) return [];
  const hayCollapsed = collapseInitialDots(hay);
  const { entries } = getCompiledRosterMatchIndex(rosterPlayers);

  const hits = [];
  for (const e of entries) {
    if (hits.length >= max) break;
    if (
      e.surnameLower.length >= 3 &&
      !hay.includes(e.surnameLower) &&
      !hayCollapsed.includes(e.surnameLower) &&
      !(e.isDeebo && hay.includes('deebo')) &&
      !(e.isCmc && hay.includes('cmc'))
    ) {
      continue;
    }

    const matchedFull =
      e.fullRe.test(hay) ||
      (e.strippedRe !== null && e.strippedRe.test(hay)) ||
      (e.collapsedRe !== null && e.collapsedRe.test(hayCollapsed)) ||
      (e.isDeebo && /\bdeebo\b/i.test(hay)) ||
      (e.isCmc && /\bcmc\b/i.test(hay));

    let matchedContextualSurname = false;
    if (!matchedFull && allowUniqueSurnames) {
      if (e.posPrefixRe !== null) {
        const posMatch = hayCollapsed.match(e.posPrefixRe);
        if (posMatch && isCompatiblePositionToken(posMatch[1], e.player.position)) {
          matchedContextualSurname = true;
        }
      }
      if (!matchedContextualSurname && e.injParenRe !== null && e.injParenRe.test(hayCollapsed)) {
        matchedContextualSurname = hasSafeStandaloneSurnameMatch(rawText, e.surname, e.player.name);
      }
    }

    const matchedUniqueSurname =
      !matchedFull &&
      !matchedContextualSurname &&
      allowUniqueSurnames &&
      e.uniqueSurnameRe !== null &&
      e.uniqueSurnameRe.test(hay) &&
      hasSafeStandaloneSurnameMatch(rawText, e.surname, e.player.name);

    if (matchedFull || matchedContextualSurname || matchedUniqueSurname) {
      const p = e.player;
      hits.push({
        id: p.id,
        name: p.name,
        shortName: p.shortName || `${p.name[0]}. ${e.surname}`,
        position: p.position,
        jersey: p.jersey,
        headshotUrl: p.headshotUrl || ''
      });
    }
  }
  return hits;
}

function propagateLiveItemsToPlayerMentions(newItems = [], rosterPlayers = [], appData = null) {
  if (!newItems.length || !rosterPlayers.length) return;
  const byId = new Map(rosterPlayers.map(p => [String(p.id), p]));
  const sevenDaysMs = 7 * 86_400_000;
  const nowMs = Date.now();

  for (const it of newItems) {
    const pubMs = new Date(it.publishedAt || 0).getTime() || 0;
    if (nowMs - pubMs > sevenDaysMs) continue;
    const isPlayerWireBlurb = String(it.id || '').startsWith('espn_pwire_') || it.wireSource === 'espn_player_wire';
    const primaryOwnerId = isPlayerWireBlurb
      ? String(it.id || '').startsWith('espn_pwire_')
        ? String(it.id).split('_')[2] || ''
        : String(it.mentionedPlayers?.[0]?.id || '')
      : '';
    const mentioned = it.mentionedPlayers || [];
    for (const mp of mentioned) {
      if (isPlayerWireBlurb && primaryOwnerId && String(mp.id) !== primaryOwnerId) {
        continue;
      }
      const rp = byId.get(String(mp.id));
      if (!rp) continue;
      const pSnippet = String(it.playerSnippet || it.playerSnippets?.[String(rp.id)] || '').trim();
      const checkText = [it.fullText, it.title, it.summary, it.externalTitle, it.externalDescription, pSnippet]
        .filter(Boolean)
        .join('. ')
        .trim();
      if (!doesClauseMentionPlayer(checkText, rp.name, { allowSurname: true, isPrimaryOwner: isPlayerWireBlurb && String(mp.id) === primaryOwnerId })) continue;
      if (!Array.isArray(rp.recentNews)) rp.recentNews = [];
      if (rp.recentNews.some(existing => (it.id && existing.id === it.id) || existing.url === it.url)) continue;

      const isTw = it.type === 'tweet' || it.type === 'social';
      const tweetFmt = isTw
        ? formatTweetBodyForDisplay(it.fullText || it.title, SHORT_TWEET_FULL_TEXT_LIMIT)
        : null;

      rp.recentNews.unshift({
        id: it.id || undefined,
        type: it.type || 'article',
        wireSource: it.wireSource || null,
        headline: isTw ? tweetFmt.text : it.title,
        fullText: isTw ? it.fullText || it.title : undefined,
        isFullTweet: isTw ? tweetFmt.isFullTweet : undefined,
        summary: isTw ? it.externalTitle || '' : pSnippet || it.summary || it.externalDescription || '',
        playerSnippet: pSnippet || undefined,
        author: it.author || it.reporterName || it.outletName || `${resolveTeamConfig(appData?.meta?.teamAbbr || getActiveTeamConfig()).nickname} Beat`,
        reporterId: it.reporterId || null,
        outletId: it.outletId || null,
        authorHandle: it.authorHandle || '',
        authorProfileUrl: it.authorProfileUrl || '',
        outletName: it.outletName || `${resolveTeamConfig(appData?.meta?.teamAbbr || getActiveTeamConfig()).nickname} Beat`,
        trustTier: it.trustTier || null,
        publishedAt: it.publishedAt,
        url: it.url,
        externalUrl: it.externalUrl || null,
        externalTitle: it.externalTitle || null,
        externalDescription: it.externalDescription || null,
        imageUrl: it.imageUrl || '',
        isBreaking: Boolean(it.isBreaking),
        isInGameInjury: Boolean(it.isInGameInjury),
        breakingBadge: it.breakingBadge || null,
        breakingPriority: it.breakingPriority || 0
      });

      const prunedPlayerNews = appData
        ? filterOutCompletedGameAvailabilityItems(rp.recentNews, appData, nowMs)
        : rp.recentNews;
      rp.recentNews = sortNewsWithBreakingPriority(prunedPlayerNews, nowMs, { appData }).slice(0, 16);
    }
  }
}

const CLIENT_SHORTENER_EXPAND_CACHE = new Map();

async function expandShortenerUrlsViaWorker(shortUrls = [], workerBaseUrl = '') {
  const unique = [...new Set((shortUrls || []).map(u => String(u || '').trim()).filter(u => isOpaqueShortenerUrl(u)))];
  if (unique.length === 0) return {};

  const out = {};
  const toFetch = [];
  for (const u of unique) {
    if (CLIENT_SHORTENER_EXPAND_CACHE.has(u)) {
      const cached = CLIENT_SHORTENER_EXPAND_CACHE.get(u);
      if (cached) out[u] = cached;
    } else {
      toFetch.push(u);
    }
  }
  if (toFetch.length === 0) return out;

  let effectiveBase = String(workerBaseUrl || '').trim();
  if (!effectiveBase && typeof window !== 'undefined') {
    try {
      effectiveBase = String(loadUserPrefs()?.workerBaseUrl || '').trim();
    } catch {}
  }
  if (!effectiveBase || !/^https?:\/\//i.test(effectiveBase)) return out;

  try {
    const cleanBase = effectiveBase.replace(/\/+$/, '');
    const res = await fetchSingleWithTimeout(
      `${cleanBase}/api/expand-urls`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ urls: toFetch.slice(0, 12) }),
        cache: 'no-store'
      },
      3500
    );
    if (!res.ok) return out;
    const payload = await res.json();
    const expanded = payload?.expanded && typeof payload.expanded === 'object' ? payload.expanded : {};
    for (const u of toFetch.slice(0, 12)) {
      const resolved = sanitizeExternalUrl(expanded[u], null);
      CLIENT_SHORTENER_EXPAND_CACHE.set(u, resolved || '');
      if (resolved) out[u] = resolved;
    }
  } catch {
    // Graceful no-op when offline or Worker unreachable
  }
  return out;
}

function getTeamEntityRegex(appData = null) {
  const activeTeam = resolveTeamConfig(appData?.meta?.teamAbbr || getActiveTeamConfig());
  if (!activeTeam || activeTeam.abbr === 'SF') return /\b(49ers|niners|san francisco)\b/i;
  const toks = [activeTeam.fullName, activeTeam.nickname, activeTeam.city]
    .filter(Boolean)
    .map(t => escapeClientRegex(String(t).trim()));
  return new RegExp(`\\b(${toks.join('|')})\\b`, 'i');
}

function getLiveBlueskyBeatAccountsForTeam(appData = null) {
  const activeTeam = resolveTeamConfig(appData?.meta?.teamAbbr || getActiveTeamConfig());
  if (!activeTeam || activeTeam.abbr === 'SF') return LIVE_BLUESKY_BEAT_ACCOUNTS;
  const reporters = Array.isArray(appData?.reporters?.reporters) ? appData.reporters.reporters : [];
  const seen = new Set();
  const out = [];
  for (const rep of reporters) {
    const actor = String(rep?.bskyHandle || '').trim();
    if (!actor || seen.has(actor.toLowerCase())) continue;
    seen.add(actor.toLowerCase());
    out.push({
      actor,
      reporterId: rep.id,
      reporterName: rep.name,
      authorHandle: rep.handle || '',
      authorProfileUrl: rep.xUrl || `https://bsky.app/profile/${actor}`,
      outletId: rep.outletId || `${activeTeam.slug}_beat`,
      outletName: rep.outletName || rep.name,
      trustTier: Number(rep.trustTier) || 1,
      isNationalInsider: ['national_insider', 'film_analyst', 'cap_analyst'].includes(rep.category)
    });
  }
  return out;
}

/**
 * Fetches real-time beat & NFL insider posts directly from CORS-enabled Bluesky public feeds
 * (`public.api.bsky.app`) with `cache: 'no-store'` so late-breaking & in-game injury return tweets,
 * author self-threads (snap counts, sideline threads), and link-card descriptions appear in < 1 minute.
 */
export async function hydrateLiveBlueskyBeatWire(
  appData,
  { isGameLive = false, manual = false, workerBaseUrl = '' } = {}
) {
  if (!appData?.news || !Array.isArray(appData.news.rawStream)) return 0;
  const activeTeam = resolveTeamConfig(appData?.meta?.teamAbbr || getActiveTeamConfig());
  const teamAccounts = getLiveBlueskyBeatAccountsForTeam(appData);
  const clubVideoPrefixRe = new RegExp(`^https:\\/\\/www\\.${escapeClientRegex(activeTeam.clubDomain)}\\/video\\/`, 'i');
  const normUrlKey = u => String(u || '').trim().replace(/\/+$/, '');
  const existingIds = new Set(appData.news.rawStream.map(it => it.id).filter(Boolean));
  const existingUrls = new Set(
    appData.news.rawStream
      .flatMap(it => [it.url, it.promotedFromSocialUrl])
      .filter(Boolean)
      .map(normUrlKey)
  );
  const existingTextKeys = new Set(
    appData.news.rawStream.map(it => String(it.fullText || it.title || '').toLowerCase().slice(0, 90))
  );
  const rosterPlayers = appData.roster?.players || [];

  const pendingItems = [];
  const shortUrlsToExpand = new Set();
  await Promise.all(
    teamAccounts.map(async acct => {
      try {
        const limit = acct.isNationalInsider ? 25 : isGameLive || manual ? 30 : 22;
        const apiUrl = `https://public.api.bsky.app/xrpc/app.bsky.feed.getAuthorFeed?actor=${encodeURIComponent(acct.actor)}&limit=${limit}&filter=posts_and_author_threads`;
        const res = await fetchSingleWithTimeout(apiUrl, { cache: 'no-store' }, 6500);
        if (!res.ok) return;
        const payload = await res.json();
        for (const row of payload.feed || []) {
          if (row.reason) continue;
          const post = row.post;
          const rec = post?.record;
          if (
            rec?.reply &&
            row.reply?.parent?.author?.did &&
            post?.author?.did &&
            row.reply.parent.author.did !== post.author.did
          ) {
            continue;
          }
          const extLink = extractBlueskyBestExternalLink(post, rec);
          const rawOrig = String(rec?.text || extLink.title || '')
            .replace(/\s+/g, ' ')
            .replace(/\s*(?:Original post|View original post)\s*$/i, '')
            .trim();
          if (!rawOrig || rawOrig.length < 18) continue;

          const parsedAttr = extractBeatAttributionFromText(rawOrig, acct);
          const cleanFull = stripAggregatorBoilerplate(cleanSensationalistText(parsedAttr.cleanedText || rawOrig));
          const cleanExtTitle = extLink.title ? stripAggregatorBoilerplate(cleanSensationalistText(extLink.title)) : '';
          const cleanExtDesc = extLink.description
            ? stripAggregatorBoilerplate(cleanSensationalistText(extLink.description)).slice(0, 320)
            : '';
          const nonBioExtDesc = stripHistoricalSfBioSentences(cleanExtDesc);
          const combinedNonBioCheck = `${cleanFull} ${cleanExtTitle} ${nonBioExtDesc}`.trim();
          const hasExplicitSfInLead = hasExplicit49ersEntity(cleanFull);
          const hasExplicitSfInBody = hasExplicit49ersEntity(combinedNonBioCheck);
          const leadMentioned = matchPlayersClient(cleanFull, rosterPlayers, 12, {
            allowUniqueSurnames: !acct.isNationalInsider || hasExplicitSfInLead
          });
          const bodyMentioned = matchPlayersClient(`${cleanExtTitle} ${nonBioExtDesc}`, rosterPlayers, 12, {
            allowUniqueSurnames: !acct.isNationalInsider || hasExplicitSfInBody
          });

          if (
            isOffTopicLeagueFiller({
              url: extLink.uri || '',
              title: cleanFull,
              summary: `${cleanExtTitle} ${nonBioExtDesc}`,
              hasRosterMatch: leadMentioned.length > 0 || bodyMentioned.length > 0
            })
          ) {
            continue;
          }

          if (
            acct.isNationalInsider &&
            !is49ersRelevantWireItem({
              title: cleanFull,
              fullText: cleanFull,
              externalTitle: cleanExtTitle,
              externalDescription: cleanExtDesc,
              isNationalFeed: true,
              leadRosterMatchCount: leadMentioned.length,
              bodyRosterMatchCount: bodyMentioned.length
            })
          ) {
            // Buffer upcoming-opponent insider injury/practice/trend tweets into `_oppNewsWire` (strictly separate from 49ers feed!)
            const umOpp = appData.scheduleMatchup?.upcomingMatchup;
            const oppHealthObj = umOpp?.opponentHealth;
            const oppMascotWord = umOpp?.oppName ? String(umOpp.oppName).trim().split(/\s+/).pop() : '';
            if (oppHealthObj && oppMascotWord && oppMascotWord.length >= 4) {
              const oppPoolAll = [
                ...(oppHealthObj.injuryReport || []),
                ...(oppHealthObj.keyStartersHealthy || []),
                ...(oppHealthObj.activeRoster || [])
              ];
              const oppTeamMatchRe = new RegExp(
                `\\b(${escapeClientRegex(umOpp.oppName)}|${escapeClientRegex(oppMascotWord)})\\b`,
                'i'
              );
              const mentionsOppTeam = oppTeamMatchRe.test(combinedNonBioCheck);
              const oppMatched = matchPlayersClient(combinedNonBioCheck, oppPoolAll, 6, {
                allowUniqueSurnames: mentionsOppTeam
              });
              if (
                (mentionsOppTeam || oppMatched.length > 0) &&
                /\b(injur|practice|questionable|doubtful|ruled out|out for|trending|optimistic|setback|concussion|expected to play|unlikely|long shot|window|activated|ir\b|dnp|limited|full participant|illness|downgraded|inactive|inactives|officially active|is active|are active|scratch|warmups?|suiting up|won['’]?t play|will not play|medical tent|locker room|carted|to return|exited|left (?:the|tonight['’]?s|sunday['’]?s|monday['’]?s|thursday['’]?s) game)\b/i.test(
                  combinedNonBioCheck
                )
              ) {
                const oppRkey = String(post?.uri || '').split('/').pop() || hashWireKey(cleanFull);
                const oppPubIso = rec?.createdAt || post?.indexedAt || new Date().toISOString();
                bufferOpponentNewsWireItem(appData, {
                  id: `bsky_opp_${parsedAttr.reporterId || acct.actor}_${oppRkey}`,
                  type: 'tweet',
                  title: cleanFull,
                  fullText: cleanFull,
                  summary: `${cleanExtTitle} ${nonBioExtDesc}`.trim(),
                  publishedAt: oppPubIso,
                  url: `https://bsky.app/profile/${post?.author?.handle || acct.actor}/post/${oppRkey}`,
                  author: parsedAttr.reporterName || acct.reporterName,
                  authorHandle: parsedAttr.authorHandle || acct.authorHandle || '',
                  outletName: parsedAttr.outletName || acct.outletName || 'NFL Insider Wire',
                  trustTier: parsedAttr.trustTier || 1,
                  wireSource: 'bsky_mirror'
                });
              }
            }
            continue;
          }

          const mentioned = matchPlayersClient(combinedNonBioCheck, rosterPlayers, 12, {
            allowUniqueSurnames: !acct.isNationalInsider || hasExplicitSfInLead || hasExplicitSfInBody
          });

          const rkey = String(post?.uri || '').split('/').pop();
          if (!rkey) continue;
          const postId = `bsky_live_${parsedAttr.reporterId}_${rkey}`;
          const textKey = cleanFull.toLowerCase().slice(0, 90);
          if (existingIds.has(postId) || existingTextKeys.has(textKey)) continue;

          const sig = scoreContentSignal(cleanFull, cleanExtDesc);
          if (sig.isClickbait) continue;

          const tweetDisplay = formatTweetBodyForDisplay(cleanFull, SHORT_TWEET_FULL_TEXT_LIMIT);
          const pubIso = rec?.createdAt || post?.indexedAt || new Date().toISOString();
          const bskyCand = {
            type: 'tweet',
            title: tweetDisplay.text,
            fullText: cleanFull,
            summary: `${cleanExtTitle} ${cleanExtDesc}`.trim(),
            publishedAt: pubIso
          };
          if (isStaleCompletedGameAvailabilityItem(bskyCand, appData)) continue;
          const brk = classifyBreakingItem(bskyCand, Date.now(), { appData });

          const vidEmbed =
            post?.embed?.$type === 'app.bsky.embed.video#view'
              ? post.embed
              : post?.embed?.media?.$type === 'app.bsky.embed.video#view'
                ? post.embed.media
                : post?.embed?.video || null;
          const imgThumb = vidEmbed?.thumbnail || post?.embed?.images?.[0]?.thumb || extLink.thumb || '';
          const rawExtUri = extLink.uri || '';
          const isSportsShortener =
            rawExtUri && /^https?:\/\/(?:www\.)?(?:es\.pn|on\.nfl\.com|nbcnews\.to|sbn\.to)\//i.test(rawExtUri);
          if (rawExtUri && (isOpaqueShortenerUrl(rawExtUri) || isSportsShortener)) {
            shortUrlsToExpand.add(rawExtUri);
          }
          const safeExtUrl = sanitizeExternalUrl(rawExtUri, null);
          const ytMatch = String(safeExtUrl || rawOrig).match(
            /(?:youtube\.com\/(?:watch\?v=|shorts\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/i
          );
          const extractedYtVideoId = ytMatch ? ytMatch[1] : undefined;
          const hasNativeSocialVideo =
            Boolean(vidEmbed?.playlist || vidEmbed?.cid) ||
            /^https:\/\/(?:www\.)?(?:x|twitter)\.com\/[^/]+\/status\/\d+\/video\//i.test(String(safeExtUrl || '')) ||
            clubVideoPrefixRe.test(String(safeExtUrl || ''));
          const postHandle = post?.author?.handle || acct.actor;
          const bskyPermalink = `https://bsky.app/profile/${postHandle}/post/${rkey}`;
          const postUrl = resolveOriginalTweetUrl(
            {
              type: 'tweet',
              url: bskyPermalink,
              externalUrl: safeExtUrl,
              author: parsedAttr.reporterName,
              reporterId: parsedAttr.reporterId,
              reporterName: parsedAttr.reporterName,
              authorHandle: parsedAttr.authorHandle || acct.authorHandle || '',
              mentionedPlayers: mentioned,
              fullText: cleanFull,
              title: cleanFull,
              publishedAt: pubIso
            },
            appData.news.rawStream
          );
          if (postUrl && !postUrl.includes('x.com/search?') && existingUrls.has(normUrlKey(postUrl))) {
            continue;
          }

          const resolvedExternalVideoUrl =
            !extractedYtVideoId && hasNativeSocialVideo
              ? safeExtUrl && clubVideoPrefixRe.test(safeExtUrl)
                ? safeExtUrl
                : postUrl || bskyPermalink
              : undefined;

          const resolvedCategory = classifyNewsItemCategory({
            type: 'tweet',
            title: tweetDisplay.text,
            fullText: cleanFull,
            summary: `${cleanExtTitle} ${nonBioExtDesc}`.trim(),
            videoId: extractedYtVideoId,
            outletName: parsedAttr.outletName
          });
          pendingItems.push({
            _rawExtUri: rawExtUri,
            _cleanExtTitle: cleanExtTitle,
            _cleanExtDesc: cleanExtDesc,
            item: {
              id: postId,
              type: 'tweet',
              title: tweetDisplay.text,
              fullText: cleanFull,
              isFullTweet: tweetDisplay.isFullTweet,
              summary: safeExtUrl && cleanExtTitle ? cleanExtTitle : '',
              videoId: extractedYtVideoId,
              externalVideoUrl: resolvedExternalVideoUrl,
              embeddable: Boolean(extractedYtVideoId),
              isHighlightClip:
                Boolean(extractedYtVideoId || resolvedExternalVideoUrl) && resolvedCategory !== 'film',
              imageUrl: typeof imgThumb === 'string' && imgThumb.startsWith('https://') ? imgThumb : '',
              imageAlt: `${parsedAttr.reporterName} update`,
              mentionedPlayers: mentioned,
              publishedAt: pubIso,
              url: postUrl,
              externalUrl: safeExtUrl,
              externalTitle: safeExtUrl && cleanExtTitle ? cleanExtTitle : null,
              externalDescription: safeExtUrl && cleanExtDesc ? cleanExtDesc : null,
              outletId: parsedAttr.outletId,
              outletName: parsedAttr.outletName,
              reporterId: parsedAttr.reporterId,
              reporterName: parsedAttr.reporterName,
              author: parsedAttr.reporterName,
              authorHandle: parsedAttr.authorHandle,
              authorProfileUrl:
                parsedAttr.xUrl ||
                acct.authorProfileUrl ||
                (parsedAttr.authorHandle
                  ? `https://x.com/${parsedAttr.authorHandle.replace(/^@/, '')}`
                  : `https://www.${activeTeam.clubDomain}/news/`),
              trustTier: parsedAttr.trustTier,
              wireSource: 'bsky_mirror',
              isBreaking: brk.isBreaking,
              isInGameInjury: brk.isInGameInjury,
              breakingBadge: brk.breakingBadge,
              breakingPriority: brk.breakingPriority,
              category: resolvedCategory,
              signalScore: Math.max(brk.isBreaking ? 92 : 76, sig.signalScore),
              fluffScore: sig.fluffScore,
              isClickbait: false
            }
          });
        }
      } catch {
        // Ignore network/offline errors cleanly
      }
    })
  );

  // Batch-unwrap any opaque shortener embed links (e.g. dlvr.it from NFLTradeRumors, bit.ly, trib.al) via Worker when available
  const expandedShortMap =
    shortUrlsToExpand.size > 0
      ? await expandShortenerUrlsViaWorker([...shortUrlsToExpand], workerBaseUrl)
      : {};

  const discovered = [];
  for (const entry of pendingItems) {
    let built = entry.item;
    if (entry._rawExtUri && expandedShortMap[entry._rawExtUri]) {
      const resolvedUrl = sanitizeExternalUrl(expandedShortMap[entry._rawExtUri], null);
      if (resolvedUrl) {
        built = {
          ...built,
          externalUrl: resolvedUrl,
          externalTitle: entry._cleanExtTitle || null,
          externalDescription: entry._cleanExtDesc || null
        };
      }
    }

    // Holistically promote pure article link-drop posts directly to first-class 'article' items
    const finalized = promoteLinkDropTweetToArticle(built);
    const finalUrlKey = normUrlKey(finalized.url);
    const origUrlKey = normUrlKey(built.url);
    const finalTextKey = String(finalized.fullText || finalized.title || '').toLowerCase().slice(0, 90);
    if (existingIds.has(finalized.id)) continue;
    if (finalUrlKey && !finalUrlKey.includes('x.com/search?') && existingUrls.has(finalUrlKey)) {
      continue;
    }
    if (finalTextKey && existingTextKeys.has(finalTextKey)) continue;

    existingIds.add(finalized.id);
    if (finalUrlKey) existingUrls.add(finalUrlKey);
    if (origUrlKey) existingUrls.add(origUrlKey);
    if (finalTextKey) existingTextKeys.add(finalTextKey);
    discovered.push(finalized);
  }

  if (discovered.length > 0) {
    const combinedReconciled = dedupeRawStreamAtomically(
      reconcileLinkDropTweetsWithArticles([...discovered, ...appData.news.rawStream])
    );
    appData.news.rawStream = sortNewsWithBreakingPriority(
      filterOutCompletedGameAvailabilityItems(combinedReconciled, appData),
      Date.now(),
      { appData }
    );
    propagateLiveItemsToPlayerMentions(discovered, rosterPlayers, appData);
  } else {
    appData.news.rawStream = sortNewsWithBreakingPriority(
      filterOutCompletedGameAvailabilityItems(appData.news.rawStream, appData),
      Date.now(),
      { appData }
    );
  }
  return discovered.length;
}

let espnPlayerSweepCursor = 0;

/**
 * Polls ESPN's CORS-enabled real-time NFL Player Wire (`apis/fantasy/v2/games/ffl/news/players`),
 * which ingests live X (`x.com`) beat tweets from Nick Wagoner, Matt Maiocco, Matt Barrows,
 * David Lombardi, Sam Warren, Eric Branch, Cam Inman, Adam Schefter, Ian Rapoport, Tom Pelissero,
 * and Mike Garafolo within seconds/minutes of posting.
 *
 * Uses a 2-tier scheduler:
 * - Priority Cohort: Injured/Questionable/IR-return players + core high-leverage starters (every cycle)
 * - Rotating Roster Sweep: Round-robin batch across all remaining 49ers players
 */
export async function hydrateLiveEspnPlayerBeatWire(
  appData,
  { maxPriority = 18, sweepBatchSize = 6, maxAgeDays = 8, focusPlayerId = null, manual = false } = {}
) {
  if (!appData?.news || !Array.isArray(appData.news.rawStream)) return 0;
  const rosterPlayers = appData.roster?.players || [];
  const validPlayers = rosterPlayers.filter(p => /^\d{4,10}$/.test(String(p.id || '')));
  if (validPlayers.length === 0) return 0;

  const priorityCohort = [];
  const priorityIds = new Set();
  const focusIdStr = focusPlayerId != null ? String(focusPlayerId) : '';
  if (focusIdStr) {
    const focusedPlayer = validPlayers.find(p => String(p.id) === focusIdStr);
    if (focusedPlayer) {
      priorityCohort.push(focusedPlayer);
      priorityIds.add(String(focusedPlayer.id));
    }
  }

  const curWk = Number(appData.health?.week || appData.scheduleMatchup?.upcomingMatchup?.week || appData.meta?.currentWeek || 1);
  const byeWk = Number(appData.health?.byeWeek || 8);

  // 1. Injured, Questionable/Doubtful/Out, or 2-3 week IR return window players first (polled EVERY cycle)
  const injuryCandidates = validPlayers.filter(p => {
    if (priorityIds.has(String(p.id))) return false;
    const st = String(p.health?.status || '').toLowerCase();
    return (
      isPlayerEligibleForInjuryNews(p, { currentWeek: curWk, byeWeek: byeWk }) ||
      Boolean(p.health?.isOnPracticeReport) ||
      ['out', 'doubtful', 'questionable'].includes(st) ||
      (p.rosterBucket === 'ir' && !p.health?.isSeasonEnding && Boolean(p.health?.isPracticeWindowOpen))
    );
  });
  for (const p of injuryCandidates) {
    if (priorityCohort.length >= maxPriority) break;
    priorityCohort.push(p);
    priorityIds.add(String(p.id));
  }

  // 2. Prioritize live/just-completed game boxscore participants + top-cap core active starters
  const livePlayedSet = new Set(
    Array.isArray(appData._livePlayedPlayerIds) ? appData._livePlayedPlayerIds.map(String) : []
  );
  if (priorityCohort.length < maxPriority) {
    const coreSorted = validPlayers
      .filter(p => p.rosterBucket === 'active' && !priorityIds.has(String(p.id)))
      .sort((a, b) => {
        const aPlayed = livePlayedSet.has(String(a.id)) ? 1 : 0;
        const bPlayed = livePlayedSet.has(String(b.id)) ? 1 : 0;
        if (bPlayed !== aPlayed) return bPlayed - aPlayed;
        return (Number(b.capHit2026) || 0) - (Number(a.capHit2026) || 0);
      });
    for (const p of coreSorted) {
      if (priorityCohort.length >= maxPriority) break;
      priorityCohort.push(p);
      priorityIds.add(String(p.id));
    }
  }

  // 3. Round-robin sweep across remaining roster
  const remainingPool = validPlayers.filter(p => !priorityIds.has(String(p.id)));
  const sweepCohort = [];
  if (remainingPool.length > 0 && sweepBatchSize > 0) {
    const count = Math.min(sweepBatchSize, remainingPool.length);
    for (let i = 0; i < count; i++) {
      sweepCohort.push(remainingPool[(espnPlayerSweepCursor + i) % remainingPool.length]);
    }
    espnPlayerSweepCursor = (espnPlayerSweepCursor + count) % remainingPool.length;
  }

  const cohort = [...priorityCohort, ...sweepCohort];
  const existingIds = new Set(appData.news.rawStream.map(it => it.id).filter(Boolean));
  const existingUrls = new Set(appData.news.rawStream.map(it => it.url).filter(Boolean));
  const existingTextKeys = new Set(
    appData.news.rawStream.map(it => String(it.fullText || it.title || '').toLowerCase().slice(0, 90))
  );
  const nowMs = Date.now();
  const maxAgeMs = maxAgeDays * 86_400_000;
  const discovered = [];

  await Promise.all(
    cohort.map(async player => {
      try {
        const perPlayerLimit = focusIdStr && String(player.id) === focusIdStr ? 10 : manual ? 6 : 4;
        const apiUrl = `https://site.api.espn.com/apis/fantasy/v2/games/ffl/news/players?playerId=${encodeURIComponent(player.id)}&limit=${perPlayerLimit}`;
        const res = await fetchSingleWithTimeout(apiUrl, { cache: 'no-store' }, 6000);
        if (!res.ok) return;
        const payload = await res.json();
        const feedItems = Array.isArray(payload?.feed) ? payload.feed : [];

        for (const entry of feedItems) {
          const pubIso = entry.published || entry.lastModified || '';
          const pubMs = pubIso ? new Date(pubIso).getTime() : 0;
          if (!pubMs || Number.isNaN(pubMs) || nowMs - pubMs > maxAgeMs) continue;

          const rawHeadline = cleanSensationalistText(decodeXmlEntitiesClient(entry.headline || ''));
          const rawDesc = cleanSensationalistText(decodeXmlEntitiesClient(entry.description || ''));
          const rawStory = cleanSensationalistText(decodeXmlEntitiesClient(entry.story || ''));
          const leadText = rawDesc || rawHeadline;
          if (!leadText || leadText.length < 20) continue;

          // Ensure general league roundups in the feed actually reference this player or the active team
          const playerParts = String(player.name || '').replace(/\s+(?:Jr\.?|Sr\.?|II|III|IV|V)$/i, '').trim().split(/\s+/);
          const playerSurname = playerParts[playerParts.length - 1] || player.name;
          const relevanceCheck = `${rawHeadline} ${rawDesc}`;
          const activeTeamForPwire = resolveTeamConfig(appData?.meta?.teamAbbr || getActiveTeamConfig());
          if (
            playerSurname &&
            !new RegExp(`\\b${escapeClientRegex(playerSurname)}\\b`, 'i').test(relevanceCheck) &&
            !getTeamEntityRegex(appData).test(relevanceCheck)
          ) {
            continue;
          }

          const bylineHint = entry.byline
            ? String(entry.byline).replace(/^By\s+/i, '').split(/\s+and\s+|,/i)[0].trim()
            : '';
          const parsedAttr = extractBeatAttributionFromText(`${rawDesc} ${rawStory}`.trim(), {
            reporterId: null,
            reporterName: bylineHint || `${activeTeamForPwire.nickname} Beat Wire`,
            outletId: 'espn',
            outletName: 'ESPN / X Beat Wire'
          });

          const cleanFull = cleanSensationalistText(parsedAttr.cleanedText || leadText);
          if (/\b(fantasy|lineup help|sleepers|waiver wire|d\/st|start\/sit)\b/i.test(`${rawHeadline} ${cleanFull}`)) {
            continue;
          }
          const directWebUrl = sanitizeExternalUrl(entry.links?.web?.href, null);
          if (!directWebUrl && !parsedAttr.viaWire && !bylineHint) continue;
          const wireIdToken = entry.id || hashWireKey(`${player.id}_${pubIso}_${cleanFull.slice(0, 40)}`);
          const isDirectArticleOrClip =
            Boolean(directWebUrl) &&
            !isEspnPlayerProfileUrl(directWebUrl) &&
            /\/nfl\/story\/_\/id\/\d+/i.test(directWebUrl);
          const isPlayerBlurb =
            !isDirectArticleOrClip &&
            (Boolean(entry.story) || entry.type === 'PlayerNews' || entry.type === 'Rotowire' || !directWebUrl || isEspnPlayerProfileUrl(directWebUrl));
          const pubIsoStr = new Date(pubMs).toISOString();
          const isStructuredWireStory = Boolean(rawStory && rawStory.length >= 80);
          const candidateDirectSocialUrl = isPlayerBlurb && !isStructuredWireStory
            ? resolveOriginalTweetUrl(
                {
                  type: 'tweet',
                  url: '',
                  author: parsedAttr.author,
                  reporterId: parsedAttr.reporterId,
                  reporterName: parsedAttr.reporterName,
                  authorHandle: parsedAttr.authorHandle,
                  primaryPlayer: player,
                  fullText: cleanFull,
                  title: cleanFull,
                  publishedAt: pubIsoStr
                },
                appData.news.rawStream
              )
            : null;
          const hasVerifiedDirectPost = Boolean(
            candidateDirectSocialUrl && isDirectSocialPostUrl(candidateDirectSocialUrl)
          );
          const effectiveType = isPlayerBlurb && hasVerifiedDirectPost ? 'tweet' : 'article';
          const cleanLeadSentence = stripRedundantAuthorBoilerplate(
            rawDesc || rawHeadline || leadText,
            parsedAttr.author
          );
          const itemUrl = isPlayerBlurb
            ? hasVerifiedDirectPost
              ? candidateDirectSocialUrl
              : buildEspnPlayerNewsAnchorUrl(player.id, player.name, rawDesc || rawHeadline)
            : directWebUrl;
          const itemId = `espn_pwire_${player.id}_${wireIdToken}`;
          const textKey = cleanFull.toLowerCase().slice(0, 90);
          const leadKey = (cleanLeadSentence || '').toLowerCase().slice(0, 90);
          if (
            !itemUrl ||
            existingIds.has(itemId) ||
            existingUrls.has(itemUrl) ||
            existingTextKeys.has(textKey) ||
            (leadKey && existingTextKeys.has(leadKey))
          ) {
            continue;
          }

          const tweetDisplay = formatTweetBodyForDisplay(cleanFull, SHORT_TWEET_FULL_TEXT_LIMIT);
          const resolvedTitle =
            effectiveType === 'tweet'
              ? tweetDisplay.text
              : isDirectArticleOrClip
                ? rawHeadline || cleanLeadSentence || tweetDisplay.text
                : cleanLeadSentence || rawHeadline || tweetDisplay.text;
          const resolvedSummary = isDirectArticleOrClip
            ? rawDesc && rawDesc.toLowerCase() !== resolvedTitle.toLowerCase()
              ? buildBoundedWireSummary(rawDesc, WIRE_ARTICLE_EXCERPT_MAX_CHARS)
              : buildBoundedWireSummary(rawStory, WIRE_ARTICLE_EXCERPT_MAX_CHARS)
            : effectiveType === 'tweet'
              ? rawStory && rawStory !== cleanFull
                ? buildBoundedWireSummary(rawStory, WIRE_BLURB_SUMMARY_MAX_CHARS)
                : ''
              : buildBoundedWireSummary(
                  rawStory || (rawDesc !== cleanLeadSentence ? rawDesc : ''),
                  WIRE_BLURB_SUMMARY_MAX_CHARS
                );

          const sig = scoreContentSignal(cleanFull, resolvedSummary);
          if (sig.isClickbait) continue;

          const matchedOthers = matchPlayersClient(`${cleanFull} ${resolvedSummary}`, rosterPlayers, 8);
          const primaryMention = {
            id: player.id,
            name: player.name,
            shortName: player.shortName || `${player.name[0]}. ${playerSurname}`,
            position: player.position,
            jersey: player.jersey,
            headshotUrl: player.headshotUrl || ''
          };
          const mentioned =
            effectiveType === 'tweet'
              ? [primaryMention, ...matchedOthers.filter(m => String(m.id) !== String(player.id))]
              : [primaryMention];

          const pwireCand = {
            type: effectiveType,
            title: resolvedTitle,
            fullText: effectiveType === 'tweet' ? cleanFull : undefined,
            summary: resolvedSummary || rawDesc,
            publishedAt: pubIsoStr
          };
          if (isStaleCompletedGameAvailabilityItem(pwireCand, appData)) continue;
          const brk = classifyBreakingItem(pwireCand, Date.now(), { appData });

          existingIds.add(itemId);
          existingUrls.add(itemUrl);
          existingTextKeys.add(textKey);
          if (leadKey) existingTextKeys.add(leadKey);

          discovered.push({
            id: itemId,
            type: effectiveType,
            title: resolvedTitle,
            fullText: effectiveType === 'tweet' ? cleanFull : undefined,
            isFullTweet: effectiveType === 'tweet' ? tweetDisplay.isFullTweet : undefined,
            summary: resolvedSummary,
            imageUrl: player.headshotUrl?.startsWith('https://') ? player.headshotUrl : '',
            imageAlt: `${player.name} beat update`,
            mentionedPlayers: mentioned,
            publishedAt: pubIsoStr,
            url: itemUrl,
            externalUrl: null,
            externalTitle: null,
            outletId: parsedAttr.outletId || 'espn',
            outletName: isPlayerBlurb ? parsedAttr.outletName || 'ESPN Injury Wire' : 'ESPN',
            reporterId: parsedAttr.reporterId,
            reporterName: parsedAttr.reporterName,
            author: parsedAttr.author,
            authorHandle: parsedAttr.authorHandle,
            authorProfileUrl: parsedAttr.xUrl || sanitizeExternalUrl(parsedAttr.authorProfileUrl, null),
            trustTier: parsedAttr.trustTier,
            wireSource: 'espn_player_wire',
            isBreaking: brk.isBreaking,
            isInGameInjury: brk.isInGameInjury,
            breakingBadge: brk.breakingBadge,
            breakingPriority: brk.breakingPriority,
            category:
              brk.isInGameInjury ||
              /injur|practice|questionable|ruled out|tent|locker room|return|reserve|activated|mri|ankle|knee|hamstring|shoulder/i.test(
                `${cleanFull} ${resolvedSummary}`
              )
                ? 'injury'
                : classifyNewsItemCategory({
                    type: effectiveType,
                    title: pwireCand.title,
                    fullText: pwireCand.fullText,
                    summary: resolvedSummary
                  }),
            signalScore: Math.max(brk.isBreaking ? 93 : 80, sig.signalScore),
            fluffScore: sig.fluffScore,
            isClickbait: false
          });
        }
      } catch {
        // Ignore transient per-player fetch failures cleanly
      }
    })
  );

  if (discovered.length > 0) {
    appData.news.rawStream = sortNewsWithBreakingPriority([...discovered, ...appData.news.rawStream], Date.now(), { appData });
    propagateLiveItemsToPlayerMentions(discovered, rosterPlayers, appData);
  }
  return discovered.length;
}

/**
 * Polls RotoWire's CORS-enabled live NFL RSS stream (`rotowire.com/rss/news.php?sport=NFL`),
 * filtering strictly to 49ers players/team items and extracting X beat writer citations.
 */
export async function hydrateLiveRotoWireBeatRss(appData, { isGameLive = false } = {}) {
  if (!appData?.news || !Array.isArray(appData.news.rawStream)) return 0;
  try {
    const res = await fetchSingleWithTimeout('https://www.rotowire.com/rss/news.php?sport=NFL', { cache: 'no-store' }, 6500);
    if (!res.ok) return 0;
    const xml = await res.text();
    if (!xml || !xml.includes('<item')) return 0;

    const rosterPlayers = appData.roster?.players || [];
    const um = appData.scheduleMatchup?.upcomingMatchup || null;
    const gdWin = isGameLive
      ? evaluateGameDayWindow(appData.scheduleMatchup?.schedule || [], um, Date.now())
      : { isActive: false };
    const oppHealth = um?.opponentHealth || null;
    const oppPool = oppHealth
      ? [
          ...(oppHealth.activeRoster || []),
          ...(oppHealth.keyStartersHealthy || []),
          ...(oppHealth.injuryReport || [])
        ]
      : [];
    const oppMascot = um?.oppName
      ? String(um.oppName).trim().split(/\s+/).pop()
      : '';
    const oppTeamRe = oppMascot && oppMascot.length >= 4
      ? new RegExp(`\\b(${escapeClientRegex(um.oppName)}|${escapeClientRegex(oppMascot)})\\b`, 'i')
      : null;

    const existingIds = new Set(appData.news.rawStream.map(it => it.id).filter(Boolean));
    const existingUrls = new Set(appData.news.rawStream.map(it => it.url).filter(Boolean));
    const existingTextKeys = new Set(
      appData.news.rawStream.map(it => String(it.fullText || it.title || '').toLowerCase().slice(0, 90))
    );
    const sfTeamRe = getTeamEntityRegex(appData);
    const itemBlocks = xml.match(/<item\b[\s\S]*?<\/item>/gi) || [];
    const discovered = [];

    for (const block of itemBlocks) {
      const rawTitle = decodeXmlEntitiesClient((block.match(/<title>([\s\S]*?)<\/title>/i) || [])[1] || '');
      const rawDesc = decodeXmlEntitiesClient((block.match(/<description>([\s\S]*?)<\/description>/i) || [])[1] || '');
      const rawLink = decodeXmlEntitiesClient((block.match(/<link>([\s\S]*?)<\/link>/i) || [])[1] || '');
      const rawPub = decodeXmlEntitiesClient((block.match(/<pubDate>([\s\S]*?)<\/pubDate>/i) || [])[1] || '');
      const rawGuid = decodeXmlEntitiesClient((block.match(/<guid[^>]*>([\s\S]*?)<\/guid>/i) || [])[1] || '');

      const combined = `${rawTitle} ${rawDesc}`.trim();
      if (!combined || combined.length < 20) continue;

      const hasExplicitSf = sfTeamRe.test(combined);
      const exactRosterMatches = matchPlayersClient(combined, rosterPlayers, 6, {
        allowUniqueSurnames: hasExplicitSf
      });
      if (!hasExplicitSf && exactRosterMatches.length === 0) {
        // All week long (plus [T-90m, Final)), buffer Opponent RotoWire practice/trend/inactives items for Opponent Health
        if (oppPool.length > 0) {
          const hasExplicitOpp = oppTeamRe ? oppTeamRe.test(combined) : false;
          const oppMatches = matchPlayersClient(combined, oppPool, 4, { allowUniqueSurnames: hasExplicitOpp });
          if (hasExplicitOpp || oppMatches.length > 0) {
            const oppBody = cleanSensationalistText(rawDesc || rawTitle);
            const oppPubMs = rawPub ? new Date(rawPub).getTime() : Date.now();
            const oppPubIso = Number.isFinite(oppPubMs) ? new Date(oppPubMs).toISOString() : new Date().toISOString();
            const oppAttr = extractBeatAttributionFromText(rawDesc || rawTitle, {
              reporterId: null,
              reporterName: 'RotoWire NFL Beat',
              outletId: 'espn',
              outletName: 'RotoWire / X Beat'
            });
            const oppWireEntry = {
              id: `rw_opp_${hashWireKey(rawGuid || `${rawTitle}_${rawPub}`)}`,
              type: 'tweet',
              title: oppBody,
              fullText: oppBody,
              summary: cleanSensationalistText(rawTitle),
              publishedAt: oppPubIso,
              url: sanitizeExternalUrl(rawLink, oppMatches[0]?.espnUrl || 'https://www.espn.com/nfl/injuries'),
              author: oppAttr.author || 'RotoWire NFL Beat',
              authorHandle: oppAttr.authorHandle || '',
              outletName: oppAttr.outletName || 'RotoWire / X Beat',
              trustTier: oppAttr.trustTier || 1,
              wireSource: 'rotowire_rss'
            };
            bufferOpponentNewsWireItem(appData, oppWireEntry);
            if (gdWin.isActive) {
              if (!appData.liveGameDay) appData.liveGameDay = { week: gdWin.week, oppWireItems: [] };
              if (!Array.isArray(appData.liveGameDay.oppWireItems)) appData.liveGameDay.oppWireItems = [];
              const oppKey = oppBody.toLowerCase().slice(0, 90);
              if (!appData.liveGameDay.oppWireItems.some(w => String(w.fullText || w.title || '').toLowerCase().slice(0, 90) === oppKey)) {
                appData.liveGameDay.oppWireItems.unshift(oppWireEntry);
                appData.liveGameDay.oppWireItems = appData.liveGameDay.oppWireItems.slice(0, 40);
              }
            }
          }
        }
        continue;
      }

      const parsedAttr = extractBeatAttributionFromText(rawDesc || rawTitle, {
        reporterId: null,
        reporterName: 'RotoWire NFL Beat',
        outletId: 'espn',
        outletName: 'RotoWire / X Beat'
      });

      const bodyText = cleanSensationalistText(rawDesc || rawTitle);
      const guidHash = hashWireKey(rawGuid || `${rawTitle}_${rawPub}`);
      const pubMs = rawPub ? new Date(rawPub).getTime() : Date.now();
      const pubIso = Number.isFinite(pubMs) ? new Date(pubMs).toISOString() : new Date().toISOString();
      const directRwUrl = sanitizeExternalUrl(rawLink, null);
      const fallbackRwUrl = exactRosterMatches[0]?.id
        ? buildEspnPlayerNewsAnchorUrl(exactRosterMatches[0].id, exactRosterMatches[0].name, rawDesc || rawTitle)
        : resolveOriginalTweetUrl(
            {
              type: 'tweet',
              url: '',
              author: parsedAttr.author,
              reporterId: parsedAttr.reporterId,
              authorHandle: parsedAttr.authorHandle,
              mentionedPlayers: exactRosterMatches,
              fullText: bodyText,
              title: bodyText,
              publishedAt: pubIso
            },
            appData.news.rawStream
          );
      const safeUrl = directRwUrl || sanitizeExternalUrl(fallbackRwUrl, null);
      const rwItemId = `rw_live_${guidHash}`;
      const textKey = bodyText.toLowerCase().slice(0, 90);
      if (!safeUrl || existingIds.has(rwItemId) || existingUrls.has(safeUrl) || existingTextKeys.has(textKey)) continue;
      const tweetDisplay = formatTweetBodyForDisplay(bodyText, SHORT_TWEET_FULL_TEXT_LIMIT);
      const rwCand = {
        type: 'tweet',
        title: tweetDisplay.text,
        fullText: bodyText,
        summary: rawTitle,
        publishedAt: pubIso
      };
      if (isStaleCompletedGameAvailabilityItem(rwCand, appData)) continue;
      const brk = classifyBreakingItem(rwCand, Date.now(), { appData });

      const rwType = isEspnPlayerProfileUrl(safeUrl) ? 'article' : 'tweet';
      existingIds.add(rwItemId);
      existingUrls.add(safeUrl);
      existingTextKeys.add(textKey);
      discovered.push({
        id: rwItemId,
        type: rwType,
        title: tweetDisplay.text,
        fullText: rwType === 'tweet' ? bodyText : undefined,
        isFullTweet: rwType === 'tweet' ? tweetDisplay.isFullTweet : undefined,
        summary: rawTitle && rawTitle !== bodyText ? cleanSensationalistText(rawTitle) : '',
        imageUrl: exactRosterMatches[0]?.headshotUrl || '',
        imageAlt: `${parsedAttr.reporterName} beat report`,
        mentionedPlayers: exactRosterMatches,
        publishedAt: pubIso,
        url: safeUrl,
        externalUrl: null,
        externalTitle: null,
        outletId: parsedAttr.outletId,
        outletName: parsedAttr.outletName,
        reporterId: parsedAttr.reporterId,
        reporterName: parsedAttr.reporterName,
        author: parsedAttr.author,
        authorHandle: parsedAttr.authorHandle,
        authorProfileUrl: parsedAttr.xUrl || null,
        trustTier: parsedAttr.trustTier,
        wireSource: 'rotowire_rss',
        isBreaking: brk.isBreaking,
        isInGameInjury: brk.isInGameInjury,
        breakingBadge: brk.breakingBadge,
        breakingPriority: brk.breakingPriority,
        category:
          brk.isInGameInjury || /injur|practice|questionable|ruled out|return|reserve|activated/i.test(combined)
            ? 'injury'
            : classifyNewsItemCategory({
                type: rwType,
                title: tweetDisplay.text,
                fullText: bodyText,
                summary: rawTitle
              }),
        signalScore: brk.isBreaking ? 94 : 84,
        fluffScore: 0,
        isClickbait: false
      });
    }

    if (discovered.length > 0) {
      appData.news.rawStream = sortNewsWithBreakingPriority([...discovered, ...appData.news.rawStream], Date.now(), { appData });
      propagateLiveItemsToPlayerMentions(discovered, rosterPlayers, appData);
    }
    return discovered.length;
  } catch {
    return 0;
  }
}

/**
 * Polls ESPN's CORS-enabled official 49ers transaction wire (`transactions?team=25`)
 * so IR activations, 21-day return windows, IR placements, signings, waivers, and trades
 * surface immediately with Tier-1 `@49ers` attribution.
 */
export async function hydrateLiveTeamTransactionsWire(appData, { maxAgeDays = 7 } = {}) {
  if (!appData?.news || !Array.isArray(appData.news.rawStream)) return 0;
  const activeTeam = resolveTeamConfig(appData?.meta?.teamAbbr || getActiveTeamConfig());
  try {
    const res = await fetchSingleWithTimeout(
      `https://site.api.espn.com/apis/site/v2/sports/football/nfl/transactions?team=${activeTeam.espnId}&limit=20`,
      { cache: 'no-store' },
      6500
    );
    if (!res.ok) return 0;
    const payload = await res.json();
    const txList = Array.isArray(payload?.transactions) ? payload.transactions : [];
    if (txList.length === 0) return 0;

    const rosterPlayers = appData.roster?.players || [];
    const existingIds = new Set(appData.news.rawStream.map(it => it.id).filter(Boolean));
    const existingUrls = new Set(appData.news.rawStream.map(it => it.url).filter(Boolean));
    const existingTextKeys = new Set(
      appData.news.rawStream.map(it => String(it.fullText || it.title || '').toLowerCase().slice(0, 90))
    );
    const nowMs = Date.now();
    const maxAgeMs = maxAgeDays * 86_400_000;
    const discovered = [];

    for (const tx of txList) {
      const pubMs = tx.date ? new Date(tx.date).getTime() : 0;
      if (!pubMs || Number.isNaN(pubMs) || nowMs - pubMs > maxAgeMs) continue;
      const desc = cleanSensationalistText(String(tx.description || '').trim());
      if (!desc || desc.length < 12) continue;

      const nickRe = new RegExp(`^${activeTeam.nickname}\\b|^${activeTeam.city}\\b`, 'i');
      const fullLine = nickRe.test(desc) ? desc : `${activeTeam.nickname} roster move: ${desc}`;
      const txHash = hashWireKey(`${tx.date}_${desc}`);
      const txUrl = `https://www.${activeTeam.clubDomain}/team/transactions/#tx-${txHash}`;
      const textKey = fullLine.toLowerCase().slice(0, 90);
      if (existingUrls.has(txUrl) || existingTextKeys.has(textKey)) continue;

      const mentioned = matchPlayersClient(desc, rosterPlayers, 8);
      const pubIso = new Date(pubMs).toISOString();
      const tweetDisplay = formatTweetBodyForDisplay(fullLine, SHORT_TWEET_FULL_TEXT_LIMIT);
      const brk = classifyBreakingItem(
        {
          title: tweetDisplay.text,
          fullText: fullLine,
          summary: `Official ${activeTeam.fullName} NFL transaction wire.`,
          publishedAt: pubIso
        },
        nowMs,
        { appData }
      );

      existingUrls.add(txUrl);
      existingTextKeys.add(textKey);
      const officialOutletId = activeTeam.abbr === 'SF' ? '49ers_official' : `${activeTeam.slug}_official`;
      discovered.push({
        id: `${activeTeam.abbr.toLowerCase()}_tx_live_${txHash}`,
        type: 'tweet',
        title: tweetDisplay.text,
        fullText: fullLine,
        isFullTweet: tweetDisplay.isFullTweet,
        summary: '',
        imageUrl: mentioned[0]?.headshotUrl || '',
        imageAlt: `${activeTeam.fullName} transaction`,
        mentionedPlayers: mentioned,
        publishedAt: pubIso,
        url: txUrl,
        externalUrl: null,
        externalTitle: null,
        outletId: officialOutletId,
        outletName: `${activeTeam.clubDomain} Official`,
        reporterId: activeTeam.abbr === 'SF' ? '49ers_news' : `${activeTeam.slug}_official`,
        reporterName: `${activeTeam.fullName} Official`,
        author: `${activeTeam.fullName} Official`,
        authorHandle: `@${activeTeam.nickname}`,
        authorProfileUrl: `https://www.${activeTeam.clubDomain}/news/`,
        trustTier: 1,
        wireSource: 'official_transactions',
        isBreaking: brk.isBreaking,
        isInGameInjury: brk.isInGameInjury,
        breakingBadge: brk.breakingBadge || (nowMs - pubMs <= 18 * 3_600_000 ? 'ROSTER MOVE' : null),
        breakingPriority: brk.breakingPriority || 0,
        category: classifyNewsItemCategory({ type: 'tweet', title: tweetDisplay.text, fullText: fullLine }),
        signalScore: 95,
        fluffScore: 0,
        isClickbait: false
      });
    }

    if (discovered.length > 0) {
      appData.news.rawStream = sortNewsWithBreakingPriority([...discovered, ...appData.news.rawStream], Date.now(), { appData });
      propagateLiveItemsToPlayerMentions(discovered, rosterPlayers, appData);
    }
    return discovered.length;
  } catch {
    return 0;
  }
}

/**
 * Polls ESPN's CORS-enabled Rapid NFL Breaking Headlines & League-Wide Transaction Wire
 * (`news?limit=35`, `news?team=25&limit=18`, `transactions?limit=35`) every sub-minute cycle
 * so cross-team trades & acquisitions (e.g. Keenan Allen traded from Colts to 49ers) surface
 * immediately at #1 BEFORE the player is added to `roster.json` or tagged under `team=25`.
 */
export async function hydrateLiveEspnRapidBreakingDesk(appData, { maxAgeDays = 5 } = {}) {
  if (!appData?.news || !Array.isArray(appData.news.rawStream)) return 0;
  const activeTeam = resolveTeamConfig(appData?.meta?.teamAbbr || getActiveTeamConfig());
  try {
    const [nflNewsRes, sfNewsRes, nflTxRes] = await Promise.all([
      fetchSingleWithTimeout(
        'https://site.api.espn.com/apis/site/v2/sports/football/nfl/news?limit=35',
        { cache: 'no-store' },
        6500
      ).catch(() => null),
      fetchSingleWithTimeout(
        `https://site.api.espn.com/apis/site/v2/sports/football/nfl/news?team=${activeTeam.espnId}&limit=18`,
        { cache: 'no-store' },
        6500
      ).catch(() => null),
      fetchSingleWithTimeout(
        'https://site.api.espn.com/apis/site/v2/sports/football/nfl/transactions?limit=35',
        { cache: 'no-store' },
        6500
      ).catch(() => null)
    ]);

    const [nflNewsJson, sfNewsJson, nflTxJson] = await Promise.all([
      nflNewsRes?.ok ? nflNewsRes.json().catch(() => null) : Promise.resolve(null),
      sfNewsRes?.ok ? sfNewsRes.json().catch(() => null) : Promise.resolve(null),
      nflTxRes?.ok ? nflTxRes.json().catch(() => null) : Promise.resolve(null)
    ]);

    const rosterPlayers = appData.roster?.players || [];
    const existingIds = new Set(appData.news.rawStream.map(it => it.id).filter(Boolean));
    const existingUrls = new Set(appData.news.rawStream.map(it => it.url).filter(Boolean));
    const existingTextKeys = new Set(
      appData.news.rawStream.map(it => String(it.fullText || it.title || '').toLowerCase().slice(0, 90))
    );
    const sfTeamRe = getTeamEntityRegex(appData);
    const nowMs = Date.now();
    const maxAgeMs = maxAgeDays * 86_400_000;
    const discovered = [];

    const allArticles = [
      ...(Array.isArray(sfNewsJson?.articles) ? sfNewsJson.articles.map(a => ({ ...a, _isSfFeed: true })) : []),
      ...(Array.isArray(nflNewsJson?.articles) ? nflNewsJson.articles.map(a => ({ ...a, _isSfFeed: false })) : [])
    ];

    for (const art of allArticles) {
      if (!art || art.premium) continue;
      const title = stripAggregatorBoilerplate(cleanSensationalistText(art.headline || ''));
      const summary = stripAggregatorBoilerplate(cleanSensationalistText(art.description || ''));
      if (!title) continue;
      const nonBioSummary = stripHistoricalSfBioSentences(summary);
      const combined = `${title} ${nonBioSummary}`.trim();
      const leadMatches = matchPlayersClient(title, rosterPlayers, 8, { allowUniqueSurnames: art._isSfFeed || sfTeamRe.test(title) });
      const bodyMatches = matchPlayersClient(nonBioSummary, rosterPlayers, 8, { allowUniqueSurnames: art._isSfFeed || sfTeamRe.test(combined) });
      if (
        !art._isSfFeed &&
        !is49ersRelevantWireItem({
          title,
          summary,
          isNationalFeed: true,
          leadRosterMatchCount: leadMatches.length,
          bodyRosterMatchCount: bodyMatches.length
        })
      ) {
        continue;
      }

      const pubMs = art.published ? new Date(art.published).getTime() : 0;
      if (!pubMs || Number.isNaN(pubMs) || nowMs - pubMs > maxAgeMs) continue;

      const url = sanitizeExternalUrl(art.links?.web?.href, null);
      const textKey = title.toLowerCase().slice(0, 90);
      if (!url || existingUrls.has(url) || existingTextKeys.has(textKey)) continue;

      const mentioned = matchPlayersClient(combined, rosterPlayers, 12, {
        allowUniqueSurnames: art._isSfFeed || sfTeamRe.test(combined)
      });
      if (isOffTopicLeagueFiller({ url, title, summary, hasRosterMatch: mentioned.length > 0 || sfTeamRe.test(title) })) {
        continue;
      }
      const sig = scoreContentSignal(title, summary);
      if (sig.isClickbait) continue;

      const pubIso = new Date(pubMs).toISOString();
      if (isStaleCompletedGameAvailabilityItem({ type: 'article', title, summary, publishedAt: pubIso }, appData)) {
        continue;
      }

      const bylineClean = art.byline
        ? cleanSensationalistText(String(art.byline).replace(/^By\s+/i, '').split(/\s+and\s+|,/i)[0].trim())
        : 'ESPN';
      const rawDirEntry = resolveReporterFromNameOrHandle(bylineClean);
      const dirEntry = rawDirEntry && !isPodiumSubjectId(rawDirEntry.id) ? rawDirEntry : null;
      const brk = classifyBreakingItem({ type: 'article', title, summary, publishedAt: pubIso }, nowMs, { appData });
      let imgUrl = art.images?.[0]?.url || '';
      if (imgUrl.startsWith('http://')) imgUrl = `https://${imgUrl.slice(7)}`;

      existingUrls.add(url);
      existingTextKeys.add(textKey);
      const itemDraft = {
        id: `espn_rapid_${art.id || hashWireKey(url)}`,
        type: 'article',
        title,
        summary,
        imageUrl: imgUrl.startsWith('https://') ? imgUrl : '',
        imageAlt: title,
        mentionedPlayers: mentioned,
        publishedAt: pubIso,
        url,
        outletId: dirEntry?.outletId || 'espn',
        outletName: 'ESPN',
        reporterId: dirEntry?.id || (/schefter/i.test(bylineClean) ? 'adam_schefter' : null),
        reporterName: bylineClean,
        author: bylineClean,
        authorHandle: dirEntry?.handle || '',
        authorProfileUrl: dirEntry?.xUrl || null,
        trustTier: 1,
        wireSource: 'espn_rapid_desk',
        isBreaking: brk.isBreaking,
        isInGameInjury: brk.isInGameInjury,
        breakingBadge: brk.breakingBadge,
        breakingPriority: brk.breakingPriority,
        category: classifyNewsItemCategory({ type: 'article', title, summary }),
        signalScore: Math.max(brk.isBreaking ? 95 : 78, sig.signalScore),
        fluffScore: sig.fluffScore,
        isClickbait: false
      };
      itemDraft.authorProfileUrl = resolveItemAuthorProfileUrl(itemDraft, url);
      discovered.push(itemDraft);
    }

    for (const tx of Array.isArray(nflTxJson?.transactions) ? nflTxJson.transactions : []) {
      const desc = cleanSensationalistText(String(tx?.description || '').trim());
      const teamAbbr = String(tx?.team?.abbreviation || '').toUpperCase();
      if (!desc || (teamAbbr !== activeTeam.abbr && !sfTeamRe.test(desc))) continue;
      const pubMs = tx.date ? new Date(tx.date).getTime() : 0;
      if (!pubMs || Number.isNaN(pubMs) || nowMs - pubMs > maxAgeMs) continue;

      const nickStartRe = new RegExp(`^${escapeClientRegex(activeTeam.nickname)}\\b|^${escapeClientRegex(activeTeam.city)}\\b`, 'i');
      const fullLine = nickStartRe.test(desc) ? desc : `${activeTeam.nickname} roster move: ${desc}`;
      const txHash = hashWireKey(`${tx.date}_${desc}`);
      const txUrl = `https://www.${activeTeam.clubDomain}/team/transactions/#tx-${txHash}`;
      const textKey = fullLine.toLowerCase().slice(0, 90);
      if (existingUrls.has(txUrl) || existingTextKeys.has(textKey)) continue;

      const mentioned = matchPlayersClient(desc, rosterPlayers, 8);
      const pubIso = new Date(pubMs).toISOString();
      const tweetDisplay = formatTweetBodyForDisplay(fullLine, SHORT_TWEET_FULL_TEXT_LIMIT);
      const brk = classifyBreakingItem(
        { type: 'tweet', title: tweetDisplay.text, fullText: fullLine, publishedAt: pubIso },
        nowMs,
        { appData }
      );

      existingUrls.add(txUrl);
      existingTextKeys.add(textKey);
      const officialOutletId = activeTeam.abbr === 'SF' ? '49ers_official' : `${activeTeam.slug}_official`;
      discovered.push({
        id: `${activeTeam.abbr.toLowerCase()}_nfltx_live_${txHash}`,
        type: 'tweet',
        title: tweetDisplay.text,
        fullText: fullLine,
        isFullTweet: tweetDisplay.isFullTweet,
        summary: '',
        imageUrl: mentioned[0]?.headshotUrl || '',
        imageAlt: `${activeTeam.fullName} transaction`,
        mentionedPlayers: mentioned,
        publishedAt: pubIso,
        url: txUrl,
        externalUrl: null,
        externalTitle: null,
        outletId: officialOutletId,
        outletName: `${activeTeam.clubDomain} Official`,
        reporterId: activeTeam.abbr === 'SF' ? '49ers_news' : `${activeTeam.slug}_official`,
        reporterName: `${activeTeam.fullName} Official`,
        author: `${activeTeam.fullName} Official`,
        authorHandle: `@${activeTeam.nickname}`,
        authorProfileUrl: `https://www.${activeTeam.clubDomain}/news/`,
        trustTier: 1,
        wireSource: 'official_transactions',
        isBreaking: brk.isBreaking,
        isInGameInjury: brk.isInGameInjury,
        breakingBadge: brk.breakingBadge,
        breakingPriority: brk.breakingPriority,
        category: classifyNewsItemCategory({ type: 'tweet', title: tweetDisplay.text, fullText: fullLine }),
        signalScore: 95,
        fluffScore: 0,
        isClickbait: false
      });
    }

    if (discovered.length > 0) {
      appData.news.rawStream = sortNewsWithBreakingPriority([...discovered, ...appData.news.rawStream], nowMs, { appData });
      propagateLiveItemsToPlayerMentions(discovered, rosterPlayers, appData);
    }
    return discovered.length;
  } catch {
    return 0;
  }
}

export function dedupeRawStreamAtomically(items = []) {
  if (!Array.isArray(items) || items.length <= 1) return items;
  const seenUrlMap = new Map();
  const seenVideoIds = new Set();
  const seenStreamUrls = new Set();
  const seenTextKeys = new Set();
  const deduped = [];
  for (const it of items) {
    if (!it || typeof it !== 'object') continue;
    const vid = String(it.videoId || '').trim();
    if (vid) {
      if (seenVideoIds.has(vid)) continue;
      seenVideoIds.add(vid);
    }
    const streamUrl = String(it.videoStreamUrl || '').trim();
    if (streamUrl) {
      const normStream = streamUrl.split('?')[0].toLowerCase();
      if (seenStreamUrls.has(normStream)) continue;
      seenStreamUrls.add(normStream);
    }
    const u = String(it.url || '').trim();
    if (u && !u.includes('x.com/search?') && !u.includes('#:~:text=')) {
      const normU = /^https:\/\/(?:www\.)?(?:x|twitter)\.com\//i.test(u)
        ? u.replace(/^https:\/\/(?:www\.)?twitter\.com\//i, 'https://x.com/').split('?')[0].replace(/\/+$/, '').toLowerCase()
        : u.replace(/\/+$/, '');
      if (seenUrlMap.has(normU)) {
        // Enrich the kept item with any missing thumbnail, summary, or social-upgrade provenance
        const kept = seenUrlMap.get(normU);
        if (kept) {
          if (!kept.imageUrl && it.imageUrl && /^https:\/\//i.test(it.imageUrl)) {
            kept.imageUrl = it.imageUrl;
          }
          if (!kept.summary && it.summary) {
            kept.summary = it.summary;
          }
          if (!kept.promotedFromSocialUrl && it.promotedFromSocialUrl) {
            kept.promotedFromSocialUrl = it.promotedFromSocialUrl;
          }
          if ((!kept.mentionedPlayers || kept.mentionedPlayers.length === 0) && it.mentionedPlayers?.length) {
            kept.mentionedPlayers = it.mentionedPlayers;
          }
        }
        continue;
      }
      seenUrlMap.set(normU, it);
    }
    const textKey = String(it.fullText || it.title || it.headline || '')
      .toLowerCase()
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 96);
    if (textKey && textKey.length >= 24 && !vid && !it.videoStreamUrl) {
      if (seenTextKeys.has(textKey)) continue;
      seenTextKeys.add(textKey);
    }
    deduped.push(it);
  }
  return deduped;
}

/**
 * Polls Official 49ers.com RSS (`https://www.49ers.com/rss/news`, `Access-Control-Allow-Origin: *`)
 * directly in the browser so official press conference recaps, injury reports, and game stories
 * appear in <45s without waiting for GitHub Actions.
 */
export async function hydrateLive49ersOfficialRss(appData, { maxAgeDays = 6 } = {}) {
  if (!appData?.news || !Array.isArray(appData.news.rawStream)) return 0;
  const activeTeam = resolveTeamConfig(appData?.meta?.teamAbbr || getActiveTeamConfig());
  const rssUrl = activeTeam.clubRssUrls?.[0] || `https://www.${activeTeam.clubDomain}/rss/news`;
  try {
    const res = await fetchSingleWithTimeout(rssUrl, { cache: 'no-store' }, 6500);
    if (!res.ok) return 0;
    const xml = await res.text();
    if (!xml || !xml.includes('<item')) return 0;

    const rosterPlayers = appData.roster?.players || [];
    const existingUrls = new Set(appData.news.rawStream.map(it => it.url).filter(Boolean));
    const existingTextKeys = new Set(
      appData.news.rawStream.map(it => String(it.fullText || it.title || '').toLowerCase().slice(0, 90))
    );
    const nowMs = Date.now();
    const maxAgeMs = maxAgeDays * 86_400_000;
    const discovered = [];

    for (const m of xml.matchAll(/<item\b[\s\S]*?<\/item>/gi)) {
      const block = m[0];
      const title = cleanSensationalistText(
        decodeXmlEntitiesClient((block.match(/<title>([\s\S]*?)<\/title>/i) || [])[1] || '')
      );
      const summary = cleanSensationalistText(
        decodeXmlEntitiesClient((block.match(/<description>([\s\S]*?)<\/description>/i) || [])[1] || '')
      ).slice(0, 240);
      const link = sanitizeExternalUrl(
        decodeXmlEntitiesClient((block.match(/<link>([\s\S]*?)<\/link>/i) || [])[1] || ''),
        null
      );
      const pubRaw = decodeXmlEntitiesClient((block.match(/<pubDate>([\s\S]*?)<\/pubDate>/i) || [])[1] || '');
      const mediaImg =
        sanitizeExternalUrl(
          (
            (block.match(/<media:content[^>]*url="([^"]+)"/i) || [])[1] ||
            (block.match(/<media:thumbnail[^>]*url="([^"]+)"/i) || [])[1] ||
            (block.match(/<enclosure[^>]*url="([^"]+\.(?:jpg|jpeg|png|webp)(?:\?[^"]*)?)"/i) || [])[1] ||
            ''
          ).replace(/&amp;/g, '&'),
          null
        ) || '';
      if (!title || !link || existingUrls.has(link)) continue;
      const textKey = title.toLowerCase().slice(0, 90);
      if (existingTextKeys.has(textKey)) continue;

      const pubMs = pubRaw ? Date.parse(pubRaw) : nowMs;
      if (!Number.isFinite(pubMs) || nowMs - pubMs > maxAgeMs) continue;
      const pubIso = new Date(Math.min(nowMs, pubMs)).toISOString();
      if (isStaleCompletedGameAvailabilityItem({ type: 'article', title, summary, publishedAt: pubIso }, appData)) {
        continue;
      }

      const sig = scoreContentSignal(title, summary);
      if (sig.isClickbait) continue;
      const mentioned = matchPlayersClient(`${title} ${summary}`, rosterPlayers, 12);
      const brk = classifyBreakingItem({ type: 'article', title, summary, publishedAt: pubIso }, nowMs, { appData });

      existingUrls.add(link);
      existingTextKeys.add(textKey);
      const rssOfficialOutletId = activeTeam.abbr === 'SF' ? '49ers_official' : `${activeTeam.slug}_official`;
      discovered.push({
        id: `${activeTeam.abbr.toLowerCase()}_live_${hashWireKey(link)}`,
        type: 'article',
        title,
        summary,
        imageUrl: mediaImg,
        imageAlt: title,
        mentionedPlayers: mentioned,
        publishedAt: pubIso,
        url: link,
        outletId: rssOfficialOutletId,
        outletName: `${activeTeam.clubDomain} Official`,
        reporterId: activeTeam.abbr === 'SF' ? '49ers_news' : `${activeTeam.slug}_official`,
        reporterName: `${activeTeam.clubDomain} Official`,
        author: `${activeTeam.clubDomain} Official`,
        authorHandle: `@${activeTeam.nickname}`,
        authorProfileUrl: `https://www.${activeTeam.clubDomain}/news/`,
        trustTier: 1,
        wireSource: '49ers_official_rss',
        isBreaking: brk.isBreaking,
        isInGameInjury: brk.isInGameInjury,
        breakingBadge: brk.breakingBadge,
        breakingPriority: brk.breakingPriority,
        category: classifyNewsItemCategory({ type: 'article', title, summary }),
        signalScore: Math.max(76, sig.signalScore),
        fluffScore: sig.fluffScore,
        isClickbait: false
      });
    }

    if (discovered.length > 0) {
      appData.news.rawStream = [...discovered, ...appData.news.rawStream];
      propagateLiveItemsToPlayerMentions(discovered, rosterPlayers, appData);
    }
    return discovered.length;
  } catch {
    return 0;
  }
}

/**
 * Polls Official 49ers.com Video RSS (`https://www.49ers.com/rss/videos`, `Access-Control-Allow-Origin: *`)
 * directly in the browser so in-game TD highlights, locker room victory speeches, 1-on-1 reactions,
 * and podium videos populate `Highlights & Videos` within minutes during and immediately after games.
 */
export async function hydrateLive49ersOfficialVideosRss(appData, { maxAgeDays = 7 } = {}) {
  if (!appData?.news || !Array.isArray(appData.news.rawStream)) return 0;
  const activeTeam = resolveTeamConfig(appData?.meta?.teamAbbr || getActiveTeamConfig());
  const videoRssUrl = activeTeam.clubRssUrls?.[1] || `https://www.${activeTeam.clubDomain}/rss/videos`;
  try {
    const res = await fetchSingleWithTimeout(videoRssUrl, { cache: 'no-store' }, 6500);
    if (!res.ok) return 0;
    const xml = await res.text();
    if (!xml || !xml.includes('<item')) return 0;

    const rosterPlayers = appData.roster?.players || [];
    const existingUrls = new Set(appData.news.rawStream.map(it => it.url).filter(Boolean));
    const existingVideoTitleKeys = new Set(
      appData.news.rawStream
        .filter(it => it.type === 'video' || it.videoId || it.videoStreamUrl || it.externalVideoUrl)
        .map(it =>
          String(it.title || '')
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, ' ')
            .trim()
            .slice(0, 65)
        )
        .filter(Boolean)
    );
    const nowMs = Date.now();
    const maxAgeMs = maxAgeDays * 86_400_000;
    const discovered = [];

    for (const m of xml.matchAll(/<item\b[\s\S]*?<\/item>/gi)) {
      const block = m[0];
      const title = cleanSensationalistText(
        decodeXmlEntitiesClient((block.match(/<title>([\s\S]*?)<\/title>/i) || [])[1] || '')
      );
      const summary = cleanSensationalistText(
        decodeXmlEntitiesClient((block.match(/<description>([\s\S]*?)<\/description>/i) || [])[1] || '')
      ).slice(0, 240);
      const link = sanitizeExternalUrl(
        decodeXmlEntitiesClient((block.match(/<link>([\s\S]*?)<\/link>/i) || [])[1] || ''),
        null
      );
      const pubRaw = decodeXmlEntitiesClient((block.match(/<pubDate>([\s\S]*?)<\/pubDate>/i) || [])[1] || '');
      const mediaImg =
        sanitizeExternalUrl(
          (
            (block.match(/<media:content[^>]*url="([^"]+)"/i) || [])[1] ||
            (block.match(/<media:thumbnail[^>]*url="([^"]+)"/i) || [])[1] ||
            (block.match(/<enclosure[^>]*url="([^"]+\.(?:jpg|jpeg|png|webp)(?:\?[^"]*)?)"/i) || [])[1] ||
            ''
          ).replace(/&amp;/g, '&'),
          null
        ) || '';
      if (!title || !link || existingUrls.has(link)) continue;
      const titleKey = title
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, ' ')
        .trim()
        .slice(0, 65);
      if (titleKey && existingVideoTitleKeys.has(titleKey)) continue;

      const pubMs = pubRaw ? Date.parse(pubRaw) : nowMs;
      if (!Number.isFinite(pubMs) || nowMs - pubMs > maxAgeMs) continue;
      const pubIso = new Date(Math.min(nowMs, pubMs)).toISOString();
      if (isStaleCompletedGameAvailabilityItem({ type: 'video', title, summary, publishedAt: pubIso }, appData)) {
        continue;
      }

      const sig = scoreContentSignal(title, summary);
      if (sig.isClickbait) continue;
      const mentioned = matchPlayersClient(`${title} ${summary}`, rosterPlayers, 12);
      const category = classifyNewsItemCategory({
        type: 'video',
        title,
        summary,
        outletName: `${activeTeam.clubDomain} Official`
      });

      existingUrls.add(link);
      if (titleKey) existingVideoTitleKeys.add(titleKey);
      const vidOutletId = activeTeam.abbr === 'SF' ? '49ers_official' : `${activeTeam.slug}_official`;
      discovered.push({
        id: `${activeTeam.abbr.toLowerCase()}_vid_${hashWireKey(link)}`,
        type: 'video',
        title,
        summary,
        externalVideoUrl: link,
        embeddable: false,
        isHighlightClip: category !== 'film',
        imageUrl: mediaImg,
        imageAlt: title,
        mentionedPlayers: mentioned,
        publishedAt: pubIso,
        url: link,
        outletId: vidOutletId,
        outletName: `${activeTeam.clubDomain} Official`,
        reporterId: activeTeam.abbr === 'SF' ? '49ers_news' : `${activeTeam.slug}_official`,
        reporterName: `${activeTeam.clubDomain} Video`,
        author: `${activeTeam.clubDomain} Video`,
        authorHandle: `@${activeTeam.nickname}`,
        authorProfileUrl: `https://www.${activeTeam.clubDomain}/video/`,
        trustTier: 1,
        wireSource: '49ers_official_videos_rss',
        isBreaking: false,
        isInGameInjury: false,
        breakingBadge: null,
        breakingPriority: 0,
        category,
        signalScore: Math.max(84, sig.signalScore),
        fluffScore: sig.fluffScore,
        isClickbait: false
      });
    }

    if (discovered.length > 0) {
      appData.news.rawStream = [...discovered, ...appData.news.rawStream];
    }
    return discovered.length;
  } catch {
    return 0;
  }
}

/**
 * Optional Edge Worker `/api/live-wire` Accelerator: when `workerBaseUrl` is configured,
 * pulls 60s KV-cached CORS-proxied beat RSS, harvested X status posts (incl. `syn.video` clips),
 * and YouTube channel Atom clips (`49ers`, `NFL`, `QB School`, `Jonnydel`).
 */
export async function hydrateLiveWorkerEdgeWire(appData, { workerBaseUrl = '' } = {}) {
  if (!appData?.news || !Array.isArray(appData.news.rawStream)) return 0;
  const activeTeam = resolveTeamConfig(appData?.meta?.teamAbbr || getActiveTeamConfig());
  let effectiveWorkerBase = String(workerBaseUrl || '').trim();
  if (!effectiveWorkerBase && typeof window !== 'undefined') {
    try {
      effectiveWorkerBase = String(loadUserPrefs()?.workerBaseUrl || '').trim();
    } catch {}
  }
  if (!effectiveWorkerBase || !/^https?:\/\//i.test(effectiveWorkerBase)) return 0;
  // Never hit the SF-only legacy Worker (`49ers-api.joshal.com`) for non-SF teams!
  if (activeTeam.abbr !== 'SF' && /49ers-api\.joshal\.com|49ers-faithful/i.test(effectiveWorkerBase)) {
    return 0;
  }

  try {
    const cleanBase = effectiveWorkerBase.replace(/\/+$/, '');
    const wireUrl =
      activeTeam.abbr === 'SF'
        ? `${cleanBase}/api/live-wire`
        : `${cleanBase}/api/live-wire?team=${encodeURIComponent(activeTeam.slug)}`;
    const res = await fetchSingleWithTimeout(wireUrl, { cache: 'no-store' }, 4000);
    if (!res.ok) return 0;
    const payload = await res.json();
    const rawItems = Array.isArray(payload?.items) ? payload.items : [];
    if (rawItems.length === 0) return 0;

    const rosterPlayers = appData.roster?.players || [];
    const existingUrls = new Set(appData.news.rawStream.map(it => it.url).filter(Boolean));
    const existingVidIds = new Set(appData.news.rawStream.map(it => it.videoId).filter(Boolean));
    const nowMs = Date.now();
    const discovered = [];

    for (const raw of rawItems) {
      if (!raw || typeof raw !== 'object') continue;
      const type = raw.type === 'video' ? 'video' : raw.type === 'tweet' ? 'tweet' : 'article';
      const url = sanitizeExternalUrl(raw.url, null);
      if (type !== 'video' && (!url || existingUrls.has(url))) continue;
      if (raw.videoId && existingVidIds.has(raw.videoId)) continue;

      const title = stripAggregatorBoilerplate(cleanSensationalistText(raw.title || ''));
      const fullText = raw.fullText ? stripAggregatorBoilerplate(cleanSensationalistText(raw.fullText)) : undefined;
      const summary = raw.summary ? stripAggregatorBoilerplate(cleanSensationalistText(raw.summary)) : '';
      if (!title && !fullText) continue;

      const pubMs = raw.publishedAt ? Date.parse(raw.publishedAt) : nowMs;
      const pubIso = Number.isFinite(pubMs) ? new Date(Math.min(nowMs, pubMs)).toISOString() : new Date().toISOString();
      if (isStaleCompletedGameAvailabilityItem({ type, title, fullText, summary, publishedAt: pubIso }, appData)) {
        continue;
      }

      const isNationalEdgeOutlet = /^(nfl_trade_rumors|sf_standard|nfl_network|espn)$/i.test(String(raw.outletId || ''));
      const nonBioSummary = stripHistoricalSfBioSentences(summary);
      const leadTextEdge = `${title} ${fullText || ''}`.trim();
      const leadMatchesEdge = matchPlayersClient(leadTextEdge, rosterPlayers, 8, {
        allowUniqueSurnames: !isNationalEdgeOutlet || hasExplicit49ersEntity(leadTextEdge)
      });
      const bodyMatchesEdge = matchPlayersClient(nonBioSummary, rosterPlayers, 8, {
        allowUniqueSurnames: !isNationalEdgeOutlet || hasExplicit49ersEntity(`${leadTextEdge} ${nonBioSummary}`)
      });
      if (
        isOffTopicLeagueFiller({
          url: raw.externalUrl || url || '',
          title: leadTextEdge,
          summary: nonBioSummary,
          hasRosterMatch: leadMatchesEdge.length > 0 || bodyMatchesEdge.length > 0
        })
      ) {
        continue;
      }
      if (
        isNationalEdgeOutlet &&
        !is49ersRelevantWireItem({
          title,
          fullText,
          summary,
          isNationalFeed: true,
          leadRosterMatchCount: leadMatchesEdge.length,
          bodyRosterMatchCount: bodyMatchesEdge.length
        })
      ) {
        continue;
      }

      const mentioned = matchPlayersClient(`${title} ${fullText || ''} ${nonBioSummary}`, rosterPlayers, 12, {
        allowUniqueSurnames: !isNationalEdgeOutlet || hasExplicit49ersEntity(`${leadTextEdge} ${nonBioSummary}`)
      });
      const sig = scoreContentSignal(fullText || title, nonBioSummary);
      if (sig.isClickbait) continue;
      const brk = classifyBreakingItem({ type, title, fullText, summary: nonBioSummary, publishedAt: pubIso }, nowMs, { appData });

      if (url) existingUrls.add(url);
      if (raw.videoId) existingVidIds.add(raw.videoId);

      const safeStream = raw.videoStreamUrl && /^https:\/\//i.test(raw.videoStreamUrl) ? raw.videoStreamUrl : undefined;
      const safeRawExtUrl = sanitizeExternalUrl(raw.externalUrl, null);
      const rawExtTitle = raw.externalTitle ? stripAggregatorBoilerplate(cleanSensationalistText(raw.externalTitle)) : null;
      const rawExtDesc = raw.externalDescription
        ? stripAggregatorBoilerplate(cleanSensationalistText(raw.externalDescription)).slice(0, 320)
        : null;
      const itemBuilt = {
        id: raw.id || `edge_wire_${hashWireKey(url || raw.videoId || title)}`,
        type,
        title: type === 'tweet' ? formatTweetBodyForDisplay(fullText || title, SHORT_TWEET_FULL_TEXT_LIMIT).text : title,
        fullText: type === 'tweet' ? fullText || title : undefined,
        isFullTweet: type === 'tweet' ? (fullText || title).length <= SHORT_TWEET_FULL_TEXT_LIMIT : undefined,
        summary: type === 'tweet' ? '' : summary,
        videoId: raw.videoId || undefined,
        videoStreamUrl: safeStream,
        isHighlightClip: Boolean(raw.isHighlightClip && safeStream),
        duration: raw.duration || undefined,
        embeddable: typeof raw.embeddable === 'boolean' ? raw.embeddable : true,
        imageUrl: raw.imageUrl && /^https:\/\//i.test(raw.imageUrl) ? raw.imageUrl : '',
        imageAlt: title,
        mentionedPlayers: mentioned,
        publishedAt: pubIso,
        url: url || (raw.videoId ? `https://www.youtube.com/watch?v=${encodeURIComponent(raw.videoId)}` : ''),
        externalUrl: safeRawExtUrl,
        externalTitle: safeRawExtUrl ? rawExtTitle : null,
        externalDescription: safeRawExtUrl ? rawExtDesc : null,
        outletId: raw.outletId || 'x_beat',
        outletName: raw.outletName || `${activeTeam.nickname} Beat`,
        reporterId: raw.reporterId || null,
        reporterName: raw.author || raw.outletName || `${activeTeam.nickname} Beat`,
        author: raw.author || raw.outletName || `${activeTeam.nickname} Beat`,
        authorHandle: raw.authorHandle || '',
        authorProfileUrl: raw.authorProfileUrl || null,
        trustTier: Number(raw.trustTier) || 1,
        wireSource: 'worker_edge_wire',
        isBreaking: brk.isBreaking,
        isInGameInjury: brk.isInGameInjury,
        breakingBadge: brk.breakingBadge,
        breakingPriority: brk.breakingPriority,
        category: classifyNewsItemCategory({
          type,
          title,
          fullText,
          summary: nonBioSummary,
          videoId: raw.videoId,
          outletName: raw.outletName
        }),
        signalScore: Math.max(78, sig.signalScore),
        fluffScore: sig.fluffScore,
        isClickbait: false
      };
      itemBuilt.authorProfileUrl = resolveItemAuthorProfileUrl(itemBuilt, itemBuilt.url);
      const finalizedEdgeItem = promoteLinkDropTweetToArticle(itemBuilt);
      if (finalizedEdgeItem.url && finalizedEdgeItem.url !== url && existingUrls.has(finalizedEdgeItem.url)) {
        continue;
      }
      if (finalizedEdgeItem.url) existingUrls.add(finalizedEdgeItem.url);
      discovered.push(finalizedEdgeItem);
    }

    if (discovered.length > 0) {
      appData.news.rawStream = [...discovered, ...appData.news.rawStream];
      propagateLiveItemsToPlayerMentions(discovered.filter(d => d.type !== 'video'), rosterPlayers, appData);
    }
    return discovered.length;
  } catch {
    return 0;
  }
}

/**
 * Unified Multi-Source Sub-Minute Beat & Injury Wire Orchestrator.
 * Simultaneously polls:
 * 1. ESPN X-Beat Player Wire (24/7 beat tweet extraction for Priority Injured/Boxscore + Rotating Roster Sweep)
 * 2. RotoWire Live NFL RSS (sub-minute pregame warmup & sideline status updates)
 * 3. Official 49ers NFL Transaction Wire (IR activations, 21-day windows, signings, trades)
 * 4. Beat & Insider Social Mirrors (Bluesky public XRPC — 25-post insider window)
 * 5. ESPN Rapid NFL Breaking Desk & League-Wide Transactions (catches cross-team trades to SF in <45s!)
 * 6. Official 49ers.com RSS (`ACAO: *` pressers, recaps & injury updates)
 * 7. Optional Edge Worker `/api/live-wire` (60s KV-cached X embeds, native X clips & YouTube Atom XML)
 * Then atomically deduplicates & cross-corroborates stories across reporters.
 */
export async function hydrateLiveMultiSourceBeatWire(
  appData,
  { isGameLive = false, workerBaseUrl = '', focusPlayerId = null, manual = false } = {}
) {
  if (!appData?.news || !Array.isArray(appData.news.rawStream)) {
    return {
      totalAdded: 0,
      bySource: {
        espnPlayerWire: 0,
        rotowireRss: 0,
        transactions: 0,
        bluesky: 0,
        espnRapidDesk: 0,
        officialRss: 0,
        officialVideosRss: 0,
        workerEdge: 0
      }
    };
  }

  const results = await Promise.allSettled([
    hydrateLiveEspnPlayerBeatWire(appData, {
      maxPriority: isGameLive ? 22 : 18,
      sweepBatchSize: isGameLive ? 14 : 10,
      focusPlayerId,
      manual
    }),
    hydrateLiveRotoWireBeatRss(appData, { isGameLive }),
    hydrateLiveTeamTransactionsWire(appData),
    hydrateLiveBlueskyBeatWire(appData, { isGameLive, manual, workerBaseUrl }),
    hydrateLiveEspnRapidBreakingDesk(appData),
    hydrateLive49ersOfficialRss(appData),
    hydrateLive49ersOfficialVideosRss(appData),
    hydrateLiveWorkerEdgeWire(appData, { workerBaseUrl })
  ]);

  const val = idx => (results[idx]?.status === 'fulfilled' ? Number(results[idx].value || 0) : 0);
  const bySource = {
    espnPlayerWire: val(0),
    rotowireRss: val(1),
    transactions: val(2),
    bluesky: val(3),
    espnRapidDesk: val(4),
    officialRss: val(5),
    officialVideosRss: val(6),
    workerEdge: val(7)
  };
  const totalAdded =
    bySource.espnPlayerWire +
    bySource.rotowireRss +
    bySource.transactions +
    bySource.bluesky +
    bySource.espnRapidDesk +
    bySource.officialRss +
    bySource.officialVideosRss +
    bySource.workerEdge;

  // Atomic link-drop promotion/reconciliation + deduplication + cross-source corroboration + StoryRank sort
  const atomicallyDeduped = dedupeRawStreamAtomically(
    reconcileLinkDropTweetsWithArticles(appData.news.rawStream)
  );
  appData.news.rawStream = sortNewsWithBreakingPriority(
    filterOutCompletedGameAvailabilityItems(atomicallyDeduped, appData),
    Date.now(),
    { appData }
  );
  if (Array.isArray(appData.news.clusteredBriefs)) {
    appData.news.clusteredBriefs = filterAndCleanSynthesisClusters(appData.news.clusteredBriefs, appData);
  }

  // Align player play probabilities & IR return windows with corroborated current-week coaching/beat reports
  const healthAligned = reconcileRosterAndHealthWithNews(appData);
  persistWeeklyPracticeSnapshot(appData);

  // Also refresh Game-Day Inactives & Active Roster if inside [T-90m, Final) window
  const gameDayChanged = await hydrateLiveGameDayRosters(appData).catch(() => false);

  return {
    totalAdded: totalAdded + ((healthAligned || gameDayChanged) && totalAdded === 0 ? 1 : 0),
    bySource,
    healthAligned,
    gameDayChanged: Boolean(gameDayChanged)
  };
}

function toEspnTeamSlugClient(abbr = '') {
  const c = String(abbr || '').trim().toLowerCase();
  if (c === 'was') return 'wsh';
  return c;
}

function extractActiveRosterFromEspnTeamRoster(oppRosterRaw, starterNamesSet = new Set()) {
  const list = [];
  const seen = new Set();
  for (const grp of oppRosterRaw?.athletes || []) {
    const gKey = String(grp.position || '');
    if (gKey === 'injuredReserveOrOut' || gKey === 'suspended' || gKey === 'practiceSquad') continue;
    const rawUnit = gKey === 'defense' ? 'Defense' : gKey === 'specialTeam' ? 'Special Teams' : 'Offense';
    for (const ath of grp.items || []) {
      const nm = ath.fullName || ath.displayName || '';
      const nk = normPlayerNameKey(nm);
      if (!nm || seen.has(nk)) continue;
      seen.add(nk);
      const id = String(ath.id || '');
      const rawHeadshot = ath.headshot?.href || (/^\d+$/.test(id) ? `https://a.espncdn.com/i/headshots/nfl/players/full/${id}.png` : '');
      const pos = ath.position?.abbreviation || 'ATH';
      list.push({
        id,
        name: nm,
        position: pos,
        unit: classifyRosterUnit(pos, rawUnit),
        rosterBucket: 'active',
        jersey: ath.jersey !== undefined && ath.jersey !== null && ath.jersey !== '' ? Number(ath.jersey) : null,
        headshotUrl: rawHeadshot.startsWith('http://') ? `https://${rawHeadshot.slice(7)}` : rawHeadshot,
        espnUrl: buildEspnPlayerUrl(id, nm),
        isStarter: starterNamesSet.has(nk)
      });
    }
  }
  return list;
}

let oppGameDaySweepCursor = 0;
const clubOfficialRssPollState = new Map();
const espnCoreRosterPollState = new Map();
let cachedSleeperPlayersState = { fetchedAtMs: 0, data: null, inFlight: null };

// Source authority ladder so higher-authority official sources (`club_rss`, `rotowire`, `espn_event_roster`)
// can ALWAYS upgrade lower-authority fallback results (`sleeper`, `gemini_ai`) if those populated earlier.
const GAME_DAY_SOURCE_RANK = {
  club_rss: 4,
  rotowire: 3,
  espn_event_roster: 3,
  sleeper: 2,
  gemini_ai: 1
};

function hasAuthoritativeInactives(sideState, minRank = 3) {
  return Boolean(
    sideState?.officialPosted &&
      Array.isArray(sideState.inactives) &&
      sideState.inactives.length >= 3 &&
      (Number(sideState.sourceRank) || 3) >= minRank
  );
}

function computeGameDayStateFingerprint(appData) {
  const sfGd = appData?.health?.gameDayRoster;
  const oppGd = appData?.scheduleMatchup?.upcomingMatchup?.opponentHealth?.gameDayRoster;
  const sfInact = (sfGd?.inactives || []).map(p => normalizeLookupName(p.name)).sort().join(',');
  const sfInGame = (sfGd?.inGameSignals?.list || [])
    .map(s => `${s.key}:${s.state}:${s.injuryType}:${s.probabilityPct}`)
    .sort()
    .join(',');
  const oppInact = (oppGd?.inactives || []).map(p => normalizeLookupName(p.name)).sort().join(',');
  const oppInGame = (oppGd?.inGameSignals?.list || [])
    .map(s => `${s.key}:${s.state}:${s.injuryType}:${s.probabilityPct}`)
    .sort()
    .join(',');
  return [
    sfGd?.isActive ? '1' : '0',
    sfGd?.officialPosted ? '1' : '0',
    sfGd?.statusBadgeLabel || '',
    sfInact,
    sfInGame,
    oppGd?.isActive ? '1' : '0',
    oppGd?.officialPosted ? '1' : '0',
    oppGd?.statusBadgeLabel || '',
    oppInact,
    oppInGame
  ].join('|');
}

async function fetchClubOfficialRssInactivesIfDue(
  teamAbbr,
  teamName,
  candidatePlayers,
  windowState,
  existingSideState,
  nowMs = Date.now()
) {
  if (hasAuthoritativeInactives(existingSideState, GAME_DAY_SOURCE_RANK.club_rss)) {
    return existingSideState;
  }
  const canonAbbr = normalizeTeamAbbrClient(teamAbbr);
  const rssUrl = NFL_TEAM_OFFICIAL_RSS_URLS[canonAbbr];
  if (!rssUrl || !Array.isArray(candidatePlayers) || candidatePlayers.length === 0) {
    return existingSideState || null;
  }

  const pollKey = `${windowState.week || 0}:${canonAbbr}`;
  const prevPoll = clubOfficialRssPollState.get(pollKey);
  const inUrgentInactivesWindow =
    !windowState.hasKickoffStarted ||
    Boolean(windowState.isDelayed) ||
    (Number.isFinite(windowState.kickoffMs) && nowMs <= windowState.kickoffMs + 35 * 60_000);
  const minIntervalMs = inUrgentInactivesWindow ? 15_000 : 28_000;
  if (prevPoll && nowMs - prevPoll.lastPollMs < minIntervalMs) {
    return existingSideState || null;
  }
  clubOfficialRssPollState.set(pollKey, { lastPollMs: nowMs });

  try {
    const rssRes = await fetchSingleWithTimeout(rssUrl, { cache: 'no-store' }, 5500);
    if (!rssRes.ok) return existingSideState || null;
    const rssXml = await rssRes.text();
    const discoveredItem = discoverOfficialClubInactivesRssItem(rssXml, {
      kickoffMs: windowState.kickoffMs,
      week: windowState.week
    });
    if (!discoveredItem?.url) return existingSideState || null;

    let artHtml = '';
    try {
      const artRes = await fetchSingleWithTimeout(discoveredItem.url, { cache: 'no-store' }, 6500);
      if (artRes.ok) {
        artHtml = await artRes.text();
      }
    } catch {}

    // Zero-CORS fallback: if direct club article HTML is CORS-blocked, parse inline `<content:encoded>` / `<description>` from RSS XML
    const parseSource = artHtml || discoveredItem.inlineHtml || discoveredItem.description || '';
    if (!parseSource) return existingSideState || null;

    const parsed = parseOfficialClubInactivesArticle(parseSource, candidatePlayers, {
      week: windowState.week,
      teamAbbr: canonAbbr,
      teamName
    });
    if (!parsed.officialPosted) return existingSideState || null;

    const nameByKey = new Map(candidatePlayers.map(p => [normalizeLookupName(p.name), p.name]));
    return {
      officialPosted: true,
      sourceRank: GAME_DAY_SOURCE_RANK.club_rss,
      inactives: parsed.inactives,
      activeNames: [...parsed.activeKeys].map(k => nameByKey.get(k)).filter(Boolean),
      emergencyQbNames: [...parsed.emergencyQbKeys].map(k => nameByKey.get(k)).filter(Boolean),
      sourceUrl: discoveredItem.url,
      sourceLabel: `${canonAbbr === 'SF' ? '49ers.com' : `${canonAbbr}`} Official`
    };
  } catch {
    return existingSideState || null;
  }
}

async function fetchEspnCoreEventRosterInactivesIfDue(
  teamAbbr,
  candidatePlayers,
  windowState,
  existingSideState,
  nowMs = Date.now()
) {
  if (hasAuthoritativeInactives(existingSideState, GAME_DAY_SOURCE_RANK.espn_event_roster)) {
    return existingSideState;
  }
  const gameId = String(windowState?.gameId || '').trim();
  if (!/^\d{6,12}$/.test(gameId)) return existingSideState || null;

  const canonAbbr = normalizeTeamAbbrClient(teamAbbr);
  const espnTeamId = ESPN_NFL_TEAM_IDS[canonAbbr];
  if (!espnTeamId) return existingSideState || null;

  const pollKey = `${gameId}:${canonAbbr}`;
  const prevPoll = espnCoreRosterPollState.get(pollKey);
  if (prevPoll && nowMs - prevPoll.lastPollMs < 25_000) {
    return existingSideState || null;
  }
  espnCoreRosterPollState.set(pollKey, { lastPollMs: nowMs });

  try {
    const url = `https://sports.core.api.espn.com/v2/sports/football/leagues/nfl/events/${encodeURIComponent(gameId)}/competitions/${encodeURIComponent(gameId)}/competitors/${espnTeamId}/roster`;
    const res = await fetchSingleWithTimeout(url, { cache: 'no-store' }, 5500);
    if (!res.ok) return existingSideState || null;
    const raw = await res.json();
    const parsed = parseEspnCoreEventRosterInactives(raw, candidatePlayers);
    if (!parsed.officialPosted) return existingSideState || null;

    const nameByKey = new Map((candidatePlayers || []).map(p => [normalizeLookupName(p.name), p.name]));
    return {
      officialPosted: true,
      sourceRank: GAME_DAY_SOURCE_RANK.espn_event_roster,
      inactives: parsed.inactives,
      activeNames: [...parsed.activeKeys].map(k => nameByKey.get(k)).filter(Boolean),
      sourceUrl: buildEspnTeamInjuriesUrl(canonAbbr),
      sourceLabel: 'ESPN Official Game Roster'
    };
  } catch {
    return existingSideState || null;
  }
}

async function hydrateLiveOpponentGameDayPlayerWire(appData, windowState, oppPool = [], oppAbbr = '', nowMs = Date.now()) {
  if (!appData || !windowState?.isActive || oppPool.length === 0) return 0;
  if (!appData.liveGameDay) appData.liveGameDay = { week: windowState.week, oppWireItems: [] };
  if (!Array.isArray(appData.liveGameDay.oppWireItems)) appData.liveGameDay.oppWireItems = [];

  if (appData.liveGameDay._lastOppWirePollMs && nowMs - appData.liveGameDay._lastOppWirePollMs < 18_000) {
    return 0;
  }
  appData.liveGameDay._lastOppWirePollMs = nowMs;

  const validOppPlayers = [];
  const seenIds = new Set();
  for (const p of oppPool) {
    const rawId = String(p?.id || p?.playerId || (String(p?.espnUrl || '').match(/\/id\/(\d+)/)?.[1] || ''));
    if (!/^\d{4,10}$/.test(rawId) || seenIds.has(rawId)) continue;
    seenIds.add(rawId);
    validOppPlayers.push({ ...p, id: rawId });
  }
  if (validOppPlayers.length === 0) return 0;

  // Priority cohort: all injured/Q/D Opponent players + key starters, plus rotating sweep across remaining active roster
  const priority = validOppPlayers.filter(p => {
    const st = String(p.gameStatus || p.status || '').toLowerCase();
    return Boolean(p.injuryType) || ['out', 'doubtful', 'questionable'].includes(st) || Boolean(p.isStarter);
  }).slice(0, 16);
  const prioIds = new Set(priority.map(p => p.id));
  const rest = validOppPlayers.filter(p => !prioIds.has(p.id));
  const sweep = [];
  const sweepBatch = Math.min(8, rest.length);
  for (let i = 0; i < sweepBatch; i++) {
    sweep.push(rest[(oppGameDaySweepCursor + i) % rest.length]);
  }
  if (rest.length > 0) {
    oppGameDaySweepCursor = (oppGameDaySweepCursor + sweepBatch) % rest.length;
  }

  const cohort = [...priority, ...sweep];
  const existingKeys = new Set(
    appData.liveGameDay.oppWireItems.map(it => String(it.fullText || it.title || '').toLowerCase().slice(0, 90))
  );
  const minPubMs = (windowState.kickoffMs || nowMs) - 6 * 3_600_000;
  let added = 0;

  await Promise.all([
    ...cohort.map(async player => {
      try {
        const res = await fetchSingleWithTimeout(
          `https://site.api.espn.com/apis/fantasy/v2/games/ffl/news/players?playerId=${encodeURIComponent(player.id)}&limit=3`,
          { cache: 'no-store' },
          4500
        );
        if (!res.ok) return;
        const json = await res.json();
        for (const entry of json?.feed || []) {
          const pubMs = Date.parse(entry.published || entry.lastModified || '');
          if (!Number.isFinite(pubMs) || pubMs < minPubMs) continue;
          const rawHeadline = cleanSensationalistText(decodeXmlEntitiesClient(entry.headline || ''));
          const rawDesc = cleanSensationalistText(decodeXmlEntitiesClient(entry.description || ''));
          const lead = rawDesc || rawHeadline;
          if (!lead || lead.length < 16) continue;
          const key = lead.toLowerCase().slice(0, 90);
          if (existingKeys.has(key)) continue;
          existingKeys.add(key);

          const parsedAttr = extractBeatAttributionFromText(lead, {
            reporterId: null,
            reporterName: entry.byline ? String(entry.byline).replace(/^By\s+/i, '').trim() : `${oppAbbr} Beat Wire`,
            outletId: 'espn',
            outletName: 'ESPN / X Beat Wire'
          });
          const itemUrl =
            sanitizeExternalUrl(entry.links?.web?.href, null) ||
            buildEspnPlayerNewsAnchorUrl(player.id, player.name, lead);
          appData.liveGameDay.oppWireItems.unshift({
            id: `opp_pwire_${player.id}_${entry.id || hashWireKey(lead)}`,
            type: 'tweet',
            title: lead,
            fullText: lead,
            summary: cleanSensationalistText(decodeXmlEntitiesClient(entry.story || '')).slice(0, 220),
            publishedAt: new Date(pubMs).toISOString(),
            url: itemUrl,
            author: parsedAttr.author || `${oppAbbr} Beat Wire`,
            authorHandle: parsedAttr.authorHandle || '',
            outletName: parsedAttr.outletName || 'ESPN / X Beat Wire',
            playerId: player.id,
            playerName: player.name
          });
          added += 1;
        }
      } catch {}
    }),
    (async () => {
      if (!oppAbbr) return;
      try {
        const res = await fetchSingleWithTimeout(
          `https://site.api.espn.com/apis/site/v2/sports/football/nfl/news?team=${toEspnTeamSlugClient(oppAbbr)}&limit=10`,
          { cache: 'no-store' },
          4500
        );
        if (!res.ok) return;
        const json = await res.json();
        for (const art of json?.articles || []) {
          if (!art || art.premium) continue;
          const pubMs = Date.parse(art.published || '');
          if (!Number.isFinite(pubMs) || pubMs < minPubMs) continue;
          const title = cleanSensationalistText(art.headline || '');
          const summary = cleanSensationalistText(art.description || '');
          if (!title) continue;
          const key = title.toLowerCase().slice(0, 90);
          if (existingKeys.has(key)) continue;
          existingKeys.add(key);
          appData.liveGameDay.oppWireItems.unshift({
            id: `opp_news_${art.id || hashWireKey(title)}`,
            type: 'article',
            title,
            summary,
            publishedAt: new Date(pubMs).toISOString(),
            url: sanitizeExternalUrl(art.links?.web?.href, 'https://www.espn.com/nfl/injuries'),
            author: art.byline ? String(art.byline).replace(/^By\s+/i, '').trim() : 'ESPN',
            outletName: 'ESPN'
          });
          added += 1;
        }
      } catch {}
    })()
  ]);

  if (appData.liveGameDay.oppWireItems.length > 55) {
    appData.liveGameDay.oppWireItems = appData.liveGameDay.oppWireItems
      .sort((a, b) => (Date.parse(b.publishedAt || '') || 0) - (Date.parse(a.publishedAt || '') || 0))
      .slice(0, 55);
  }
  return added;
}

async function fetchThrottledSleeperPlayersMap(nowMs = Date.now()) {
  if (cachedSleeperPlayersState.data && nowMs - cachedSleeperPlayersState.fetchedAtMs < 4 * 60_000) {
    return cachedSleeperPlayersState.data;
  }
  if (cachedSleeperPlayersState.inFlight) {
    return cachedSleeperPlayersState.inFlight;
  }
  if (nowMs - cachedSleeperPlayersState.fetchedAtMs < 4 * 60_000) {
    return cachedSleeperPlayersState.data;
  }
  cachedSleeperPlayersState.fetchedAtMs = nowMs;
  cachedSleeperPlayersState.inFlight = (async () => {
    try {
      const res = await fetchSingleWithTimeout('https://api.sleeper.app/v1/players/nfl', { cache: 'no-store' }, 9000);
      if (!res.ok) return cachedSleeperPlayersState.data;
      const json = await res.json();
      if (json && typeof json === 'object') {
        cachedSleeperPlayersState.data = json;
      }
      return cachedSleeperPlayersState.data;
    } catch {
      return cachedSleeperPlayersState.data;
    } finally {
      cachedSleeperPlayersState.inFlight = null;
    }
  })();
  return cachedSleeperPlayersState.inFlight;
}

function synchronizeDepthChartForGameDay(appData) {
  if (!Array.isArray(appData?.depthChart?.units) || !Array.isArray(appData?.roster?.players)) return;
  const byId = new Map(appData.roster.players.map(p => [String(p.id), p]));
  for (const unit of appData.depthChart.units) {
    for (const row of unit.rows || []) {
      if (!Array.isArray(row.baselineChain)) continue;
      row.baselineChain = row.baselineChain.map(entry => {
        const rp = byId.get(String(entry.playerId));
        if (!rp?.health) return entry;
        const prob = rp.health.playProbabilityPct ?? entry.playProbabilityPct ?? 95;
        const isAvailable =
          prob >= 40 && (rp.rosterBucket === 'active' || Boolean(rp.health.isIrReturnQuestionable));
        return {
          ...entry,
          playProbabilityPct: prob,
          statusBadge: rp.health.playBadgeLabel || entry.statusBadge,
          isAvailable
        };
      });
      row.projectedActiveChain = [
        ...row.baselineChain.filter(x => x.isAvailable).map(({ demotedDueToInjury: _d, ...rest }) => rest),
        ...row.baselineChain.filter(x => !x.isAvailable).map(x => ({ ...x, demotedDueToInjury: true }))
      ];
      row.starterPromoted =
        row.baselineChain.length > 1 &&
        row.projectedActiveChain[0]?.playerId !== row.baselineChain[0]?.playerId;
    }
  }
}

/**
 * Hydrates 49ers & Opponent Game-Day Inactives + Collapsible Active Roster (`[T-90m, Final)`),
 * resolves `Questionable`/`Doubtful` players to deterministic `In (Active)` or `Out (Inactive)` across
 * ALL health/roster/depth-chart surfaces, tracks live mid-game return probabilities (`50% QTR` / `0% Out` / `99% Returned`),
 * and immediately resets players to modeled `Week N+1` play likelihood the moment the game hits Final.
 */
export async function hydrateLiveGameDayRosters(appData, nowMs = Date.now(), options = {}) {
  if (!appData) return false;
  const um = appData.scheduleMatchup?.upcomingMatchup || null;
  const windowState = evaluateGameDayWindow(appData.scheduleMatchup?.schedule || [], um, nowMs);

  if (!windowState.isActive) {
    let cleared = false;
    const activeGdWeek = Number(appData.health?.gameDayRoster?.week || 0);
    const currentHealthWeek = Number(appData.health?.week || um?.week || appData.meta?.currentWeek || 1);
    const espnOverlayAlreadyRolledWeek = activeGdWeek > 0 && currentHealthWeek > activeGdWeek;
    const nextWeekNum = espnOverlayAlreadyRolledWeek
      ? currentHealthWeek
      : (activeGdWeek || Number(um?.week || appData.meta?.currentWeek || 1)) + 1;
    const playedIdsSet = new Set((appData._livePlayedPlayerIds || []).map(String));

    if (appData.health?.gameDayRoster?.isActive) {
      const liveSfRows = Array.isArray(appData.health.practiceReport) ? appData.health.practiceReport : [];
      const cachedSustained = Array.isArray(appData.health._liveSustainedInGameRows)
        ? appData.health._liveSustainedInGameRows
        : [];
      const sustainedByNorm = new Map();
      for (const r of [...cachedSustained, ...liveSfRows]) {
        if (!r || !(r.sustainedInLastGame || r.isInGameInjury || r.isInGameReturned)) continue;
        sustainedByNorm.set(normalizeLookupName(r.name), r);
      }
      const sustainedSfRows = [...sustainedByNorm.values()];
      appData.health.gameDayRoster = null;
      delete appData.health._liveSustainedInGameRows;

      if (espnOverlayAlreadyRolledWeek) {
        // `hydrateLiveEspnOverlay` already advanced `appData.health.week` to `N+1` and cleared `didNotPlay === false`
        // starters — purge stale pregame snapshots without clobbering `practiceReport`!
        for (const p of appData.roster?.players || []) {
          if (p._preGameHealthSnapshot) delete p._preGameHealthSnapshot;
          if (p.health) {
            delete p.health.isInGameInjury;
            delete p.health.isInGameReturned;
          }
        }
        delete appData.health._preGamePracticeReport;
        if (sustainedSfRows.length > 0) {
          const rolledSustained = rolloverPracticeReportForUpcomingWeek(
            sustainedSfRows.map(sr => ({ ...sr, sustainedInLastGame: true })),
            { clearPracticeDays: true, upcomingWeek: nextWeekNum }
          );
          const byNorm = new Map(liveSfRows.map(r => [normalizeLookupName(r.name), r]));
          const rolledSustByNorm = new Map();
          for (const sr of rolledSustained) {
            const nk = normalizeLookupName(sr.name);
            rolledSustByNorm.set(nk, sr);
            const existingRow = byNorm.get(nk);
            if (
              !existingRow ||
              existingRow.isInGameInjury ||
              existingRow.isInGameReturned ||
              /\(in-game\)|to return/i.test(
                String(existingRow.badgeLabel || existingRow.playBadgeLabel || existingRow.gameStatus || '')
              )
            ) {
              byNorm.set(nk, sr);
            }
          }
          appData.health.practiceReport = [...byNorm.values()];
          for (const p of appData.roster?.players || []) {
            if (!p?.health || p.rosterBucket !== 'active') continue;
            const sr = rolledSustByNorm.get(normalizeLookupName(p.name));
            if (sr) {
              p.health.isOnPracticeReport = true;
              p.health.wed = '-';
              p.health.thu = '-';
              p.health.fri = '-';
              p.health.injuryType = sr.injuryType || p.health.injuryType;
              p.health.status = sr.gameStatus || 'Questionable';
              p.health.playProbabilityPct = sr.playProbabilityPct;
              p.health.playTier = sr.playTier || sr.tier || 'QUESTIONABLE';
              p.health.playBadgeLabel = sr.playBadgeLabel;
              p.health.shortComment = sr.shortComment || p.health.shortComment || '';
            }
          }
        }
      } else {
        // Restore pregame snapshots on roster players first, then carry forward any newly sustained mid-game injuries
        for (const p of appData.roster?.players || []) {
          if (p._preGameHealthSnapshot && p.health) {
            p.health = { ...p._preGameHealthSnapshot };
            delete p._preGameHealthSnapshot;
          }
        }

        let baseToRoll = Array.isArray(appData.health._preGamePracticeReport)
          ? appData.health._preGamePracticeReport
          : liveSfRows;
        delete appData.health._preGamePracticeReport;

        const sustainedNormKeys = new Set(sustainedSfRows.map(sr => normalizeLookupName(sr.name)));
        if (playedIdsSet.size > 0) {
          baseToRoll = baseToRoll.filter(r => {
            const pid = String(r.playerId || '');
            if (pid && playedIdsSet.has(pid) && !sustainedNormKeys.has(normalizeLookupName(r.name))) {
              return false;
            }
            return true;
          });
        }

        if (sustainedSfRows.length > 0) {
          const byNorm = new Map(baseToRoll.map(r => [normalizeLookupName(r.name), r]));
          for (const sr of sustainedSfRows) {
            byNorm.set(normalizeLookupName(sr.name), { ...sr, sustainedInLastGame: true });
          }
          baseToRoll = [...byNorm.values()];
        }

        const rolledSf = rolloverPracticeReportForUpcomingWeek(baseToRoll, {
          clearPracticeDays: true,
          upcomingWeek: nextWeekNum
        });
        appData.health.practiceReport = rolledSf;

        const rolledByKey = new Map(rolledSf.map(r => [normalizeLookupName(r.name), r]));
        for (const p of appData.roster?.players || []) {
          if (!p.health || p.rosterBucket !== 'active') continue;
          const rMatch = rolledByKey.get(normalizeLookupName(p.name));
          if (rMatch) {
            p.health.isOnPracticeReport = true;
            p.health.wed = '-';
            p.health.thu = '-';
            p.health.fri = '-';
            p.health.injuryType = rMatch.injuryType || p.health.injuryType;
            p.health.status = rMatch.gameStatus || 'Questionable';
            p.health.playProbabilityPct = rMatch.playProbabilityPct;
            p.health.playTier = rMatch.playTier || rMatch.tier || 'QUESTIONABLE';
            p.health.playBadgeLabel = rMatch.playBadgeLabel;
            p.health.shortComment = rMatch.shortComment || p.health.shortComment || '';
            delete p.health.isInGameInjury;
            delete p.health.isInGameReturned;
          } else {
            p.health.isOnPracticeReport = false;
            p.health.status = 'Active';
            p.health.playProbabilityPct = 95;
            p.health.playTier = 'ACTIVE';
            p.health.playBadgeLabel = '95% • Full Go';
            delete p.health.isInGameInjury;
            delete p.health.isInGameReturned;
          }
        }
      }
      synchronizeDepthChartForGameDay(appData);
      cleared = true;
    }

    if (um?.opponentHealth?.gameDayRoster?.isActive) {
      const oh = um.opponentHealth;
      const liveOppRows = Array.isArray(oh.injuryReport) ? oh.injuryReport : [];
      const sustainedOppRows = liveOppRows.filter(
        r => Boolean(r?.sustainedInLastGame || r?.isInGameInjury || r?.isInGameReturned)
      );
      oh.gameDayRoster = null;
      oh.liveInGameInjuries = [];

      if (Array.isArray(oh._preGameKeyStartersHealthy)) {
        oh.keyStartersHealthy = oh._preGameKeyStartersHealthy;
        delete oh._preGameKeyStartersHealthy;
      }

      let baseOppToRoll = Array.isArray(oh._preGameInjuryReport)
        ? oh._preGameInjuryReport
        : liveOppRows;
      delete oh._preGameInjuryReport;

      if (sustainedOppRows.length > 0) {
        const byNorm = new Map(baseOppToRoll.map(r => [normalizeLookupName(r.name), r]));
        for (const sr of sustainedOppRows) {
          byNorm.set(normalizeLookupName(sr.name), { ...sr, sustainedInLastGame: true });
        }
        baseOppToRoll = [...byNorm.values()];
      }

      oh.injuryReport = rolloverPracticeReportForUpcomingWeek(baseOppToRoll, {
        clearPracticeDays: true,
        upcomingWeek: nextWeekNum
      });
      oh.summary = computeTeamHealthSummary({
        injuryReport: oh.injuryReport,
        irReserve: oh.irReserve || [],
        totalStarters: oh.summary?.totalStarters || 22
      });
      cleared = true;
    }

    if (cleared) {
      persistGameDayInactivesSnapshot(appData, null);
    }
    return cleared;
  }

  let effectivePrefs = options?.prefs || null;
  if (!effectivePrefs && typeof window !== 'undefined') {
    try {
      effectivePrefs = loadUserPrefs();
    } catch {}
  }

  const fetchJsonNoStore = async url => {
    const res = await fetchSingleWithTimeout(url, { cache: 'no-store' }, 6000);
    if (!res.ok) return null;
    return res.json();
  };

  const oppAbbr = normalizeTeamAbbrClient(windowState.oppAbbr || um?.oppAbbr || '');
  const oppName = windowState.oppName || um?.oppName || oppAbbr;
  const oh = um?.opponentHealth || null;

  if (!appData.liveGameDay || Number(appData.liveGameDay.week || windowState.week) !== Number(windowState.week)) {
    appData.liveGameDay = {
      week: windowState.week,
      sf: appData.liveGameDay?.week === windowState.week ? appData.liveGameDay.sf : null,
      opp: appData.liveGameDay?.week === windowState.week ? appData.liveGameDay.opp : null,
      oppWireItems: Array.isArray(appData.liveGameDay?.oppWireItems) ? appData.liveGameDay.oppWireItems : []
    };
  }

  if (oh && (!Array.isArray(oh.activeRoster) || oh.activeRoster.length < 30) && oppAbbr) {
    const oppRosterRaw = await fetchJsonNoStore(
      `https://site.api.espn.com/apis/site/v2/sports/football/nfl/teams/${toEspnTeamSlugClient(oppAbbr)}/roster`
    ).catch(() => null);
    if (oppRosterRaw?.athletes?.length) {
      const starterSet = new Set(
        [...(oh.keyStartersHealthy || []), ...(oh.injuryReport || []).filter(p => p.isStarter)].map(p =>
          normPlayerNameKey(p.name)
        )
      );
      oh.activeRoster = extractActiveRosterFromEspnTeamRoster(oppRosterRaw, starterSet);
    }
  }

  const beforeFingerprint = computeGameDayStateFingerprint(appData);

  const sfActivePlayers = (appData.roster?.players || []).filter(p => p.rosterBucket === 'active');
  const baseSfReport = appData.health?._preGamePracticeReport || appData.health?.practiceReport || [];
  const baseOppReport = oh?._preGameInjuryReport || oh?.injuryReport || [];
  const oppCandidatePool = oh
    ? [
        ...(oh.activeRoster || []),
        ...(oh._preGameKeyStartersHealthy || oh.keyStartersHealthy || []),
        ...baseOppReport
      ]
    : [];

  const activeTeamGd = resolveTeamConfig(appData?.meta?.teamAbbr || getActiveTeamConfig());
  const teamBeatFallback = `${activeTeamGd.nickname} Beat`;

  // 1. Poll Official 32-Team Club `/rss/news` + Discovered Inactives Article (CORS `*`, zero tokens) + Opponent Player Wire in parallel!
  const [rssSfState, rssOppState] = await Promise.all([
    fetchClubOfficialRssInactivesIfDue(
      activeTeamGd.abbr,
      activeTeamGd.fullName,
      [...sfActivePlayers, ...baseSfReport],
      windowState,
      appData.liveGameDay.sf,
      nowMs
    ),
    oppAbbr
      ? fetchClubOfficialRssInactivesIfDue(oppAbbr, oppName, oppCandidatePool, windowState, appData.liveGameDay.opp, nowMs)
      : Promise.resolve(appData.liveGameDay.opp),
    hydrateLiveOpponentGameDayPlayerWire(appData, windowState, oppCandidatePool, oppAbbr, nowMs).catch(() => 0)
  ]);

  if (rssSfState) appData.liveGameDay.sf = rssSfState;
  if (rssOppState) appData.liveGameDay.opp = rssOppState;

  // 2. Optional Cloudflare Edge Worker `/api/gameday-inactives` (Server-side Club Article HTML + RotoWire + ESPN Core Roster + KV cache)
  const workerBase = String(effectivePrefs?.workerBaseUrl || '').trim().replace(/\/+$/, '');
  const sfNeedsAuthoritative = !hasAuthoritativeInactives(appData.liveGameDay.sf, GAME_DAY_SOURCE_RANK.rotowire);
  const oppNeedsAuthoritative = Boolean(
    oppAbbr && !hasAuthoritativeInactives(appData.liveGameDay.opp, GAME_DAY_SOURCE_RANK.rotowire)
  );
  if (
    workerBase &&
    (sfNeedsAuthoritative || oppNeedsAuthoritative) &&
    (!appData.liveGameDay._lastWorkerInactMs || nowMs - appData.liveGameDay._lastWorkerInactMs >= 28_000)
  ) {
    appData.liveGameDay._lastWorkerInactMs = nowMs;
    try {
      const q = new URLSearchParams({
        teams: `${activeTeamGd.abbr},${oppAbbr}`,
        seasonYear: String(appData.meta?.seasonYear || 2026),
        week: String(windowState.week || 1),
        oppName,
        gameId: windowState.gameId || '',
        kickoffMs: Number.isFinite(windowState.kickoffMs) ? String(windowState.kickoffMs) : ''
      });
      const wRes = await fetchSingleWithTimeout(`${workerBase}/api/gameday-inactives?${q.toString()}`, { cache: 'no-store' }, 6500);
      if (wRes.ok) {
        const wJson = await wRes.json();
        const wSfRank = Number(wJson?.sf?.sourceRank) || GAME_DAY_SOURCE_RANK.rotowire;
        if (
          wJson?.sf?.inactives?.length >= 3 &&
          (!appData.liveGameDay.sf?.officialPosted || wSfRank > (Number(appData.liveGameDay.sf?.sourceRank) || 0))
        ) {
          appData.liveGameDay.sf = {
            officialPosted: true,
            sourceRank: wSfRank,
            inactives: wJson.sf.inactives,
            activeNames: wJson.sf.activeNames || [],
            emergencyQbNames: wJson.sf.emergencyQbNames || [],
            sourceUrl: wJson.sf.sourceUrl || 'https://www.rotowire.com/football/inactives.php',
            sourceLabel: wJson.sf.sourceLabel || 'NFL Official Wire'
          };
        }
        const wOppRank = Number(wJson?.opp?.sourceRank) || GAME_DAY_SOURCE_RANK.rotowire;
        if (
          oppAbbr &&
          wJson?.opp?.inactives?.length >= 3 &&
          (!appData.liveGameDay.opp?.officialPosted || wOppRank > (Number(appData.liveGameDay.opp?.sourceRank) || 0))
        ) {
          appData.liveGameDay.opp = {
            officialPosted: true,
            sourceRank: wOppRank,
            inactives: wJson.opp.inactives,
            activeNames: wJson.opp.activeNames || [],
            emergencyQbNames: wJson.opp.emergencyQbNames || [],
            sourceUrl: wJson.opp.sourceUrl || 'https://www.rotowire.com/football/inactives.php',
            sourceLabel: wJson.opp.sourceLabel || 'NFL Official Wire'
          };
        }
      }
    } catch {}
  }

  // 2b. Zero-Worker ESPN Core Event Competitor Roster Fallback (CORS `*`, official active/inactive flags when published)
  if (
    windowState.gameId &&
    (!hasAuthoritativeInactives(appData.liveGameDay.sf, GAME_DAY_SOURCE_RANK.espn_event_roster) ||
      (oppAbbr && !hasAuthoritativeInactives(appData.liveGameDay.opp, GAME_DAY_SOURCE_RANK.espn_event_roster)))
  ) {
    const [espnSfState, espnOppState] = await Promise.all([
      fetchEspnCoreEventRosterInactivesIfDue(activeTeamGd.abbr, sfActivePlayers, windowState, appData.liveGameDay.sf, nowMs),
      oppAbbr
        ? fetchEspnCoreEventRosterInactivesIfDue(oppAbbr, oppCandidatePool, windowState, appData.liveGameDay.opp, nowMs)
        : Promise.resolve(appData.liveGameDay.opp)
    ]);
    if (espnSfState) appData.liveGameDay.sf = espnSfState;
    if (espnOppState) appData.liveGameDay.opp = espnOppState;
  }

  // 3. Zero-Worker Browser Fallback for Healthy Scratches: Throttled Sleeper Active-53 `Out` Sync (CORS `*`, widened to ko+45m / delayed)
  const withinPregameScratchDiscovery =
    !windowState.hasKickoffStarted ||
    Boolean(windowState.isDelayed) ||
    (Number.isFinite(windowState.kickoffMs) && nowMs <= windowState.kickoffMs + 45 * 60_000);

  if (
    withinPregameScratchDiscovery &&
    (!appData.liveGameDay.sf?.officialPosted || (oppAbbr && !appData.liveGameDay.opp?.officialPosted))
  ) {
    const sleeperMap = await fetchThrottledSleeperPlayersMap(nowMs);
    if (sleeperMap) {
      if (!appData.liveGameDay.sf?.officialPosted) {
        const sfSl = extractSleeperGameDaySignals(sleeperMap, activeTeamGd.abbr, sfActivePlayers, baseSfReport);
        if (sfSl.officialPosted) {
          const sfNameByKey = new Map(sfActivePlayers.map(p => [normalizeLookupName(p.name), p.name]));
          appData.liveGameDay.sf = {
            officialPosted: true,
            sourceRank: GAME_DAY_SOURCE_RANK.sleeper,
            inactives: sfSl.inactives,
            activeNames: [...sfSl.activeKeys].map(k => sfNameByKey.get(k)).filter(Boolean),
            sourceUrl: activeTeamGd.clubInjuryUrl || `https://www.${activeTeamGd.clubDomain}/team/injury-report/`,
            sourceLabel: 'NFL Game-Day Wire'
          };
        }
      }
      if (oppAbbr && !appData.liveGameDay.opp?.officialPosted) {
        const oppSl = extractSleeperGameDaySignals(sleeperMap, oppAbbr, oppCandidatePool, baseOppReport);
        if (oppSl.officialPosted) {
          const oppNameByKey = new Map(oppCandidatePool.map(p => [normalizeLookupName(p.name), p.name]));
          appData.liveGameDay.opp = {
            officialPosted: true,
            sourceRank: GAME_DAY_SOURCE_RANK.sleeper,
            inactives: oppSl.inactives,
            activeNames: [...oppSl.activeKeys].map(k => oppNameByKey.get(k)).filter(Boolean),
            sourceUrl: buildEspnTeamInjuriesUrl(oppAbbr),
            sourceLabel: 'NFL Game-Day Wire'
          };
        }
      }
    }
  }

  // 4. Optional Top-Tier-Minus-1 Gemini Flash (`gemini-3.8-flash` auto-incrementing) Google Search Fallback
  if (
    withinPregameScratchDiscovery &&
    (windowState.minutesUntilKickoff == null || windowState.minutesUntilKickoff <= 86) &&
    (!appData.liveGameDay.sf?.officialPosted || (oppAbbr && !appData.liveGameDay.opp?.officialPosted)) &&
    (effectivePrefs?.geminiApiKey || effectivePrefs?.geminiNewsApiKey || effectivePrefs?.workerBaseUrl)
  ) {
    const aiRes = await fetchGeminiFallbackGameDayInactives({
      prefs: effectivePrefs,
      seasonYear: Number(appData.meta?.seasonYear || 2026),
      week: Number(windowState.week || um?.week || 1),
      oppAbbr,
      oppName,
      kickoffIso: windowState.kickoffIso || '',
      needSf: !appData.liveGameDay.sf?.officialPosted,
      needOpp: Boolean(oppAbbr && !appData.liveGameDay.opp?.officialPosted),
      sfCandidatePlayers: sfActivePlayers,
      oppCandidatePlayers: oppCandidatePool,
      nowMs
    }).catch(() => null);

    if (aiRes) {
      if (!appData.liveGameDay.sf?.officialPosted && aiRes.sfInactives?.length >= 3) {
        appData.liveGameDay.sf = {
          officialPosted: true,
          sourceRank: GAME_DAY_SOURCE_RANK.gemini_ai,
          inactives: aiRes.sfInactives,
          activeNames: aiRes.sfActives || [],
          sourceUrl: activeTeamGd.clubNewsUrl || 'https://www.49ers.com/news/',
          sourceLabel: 'Grounded NFL Wire'
        };
      }
      if (oppAbbr && !appData.liveGameDay.opp?.officialPosted && aiRes.oppInactives?.length >= 3) {
        appData.liveGameDay.opp = {
          officialPosted: true,
          sourceRank: GAME_DAY_SOURCE_RANK.gemini_ai,
          inactives: aiRes.oppInactives,
          activeNames: aiRes.oppActives || [],
          sourceUrl: buildEspnTeamInjuriesUrl(oppAbbr),
          sourceLabel: 'Grounded NFL Wire'
        };
      }
    }
  }

  // 5. Build Team Model + Live In-Game Return Signals + Sync ALL Team Surfaces (Health Table, Roster, Player Sheet, Depth Chart)
  if (appData.health) {
    if (Array.isArray(appData.health.practiceReport)) {
      appData.health._preGamePracticeReport = mergeNonDestructivePreGameRows(
        appData.health._preGamePracticeReport,
        appData.health.practiceReport
      );
    }
    const cleanBaseSfReport = appData.health._preGamePracticeReport || appData.health.practiceReport || [];
    const sfNews = appData.news?.rawStream || [];

    const sfModel = buildTeamGameDayRosterModel({
      teamAbbr: activeTeamGd.abbr,
      teamName: activeTeamGd.fullName,
      activeRosterPlayers: sfActivePlayers,
      injuryReport: cleanBaseSfReport,
      newsItems: sfNews,
      liveFeedData: appData.liveGameDay.sf || null,
      windowState
    });

    const sfInGameSignals = windowState.hasKickoffStarted
      ? extractLiveInGameInjurySignals(sfNews, sfActivePlayers, windowState, sfModel.inactiveKeySet)
      : { byKey: new Map(), list: [] };
    sfModel.inGameSignals = sfInGameSignals;
    appData.health.gameDayRoster = sfModel;

    appData.health.practiceReport = resolveGameDayInjuryRows(cleanBaseSfReport, sfModel, {
      inGameSignals: sfInGameSignals,
      activeRosterPlayers: sfActivePlayers
    });

    // Persist newly sustained mid-game injuries separately so an immediate post-Final ESPN `/injuries`
    // refresh (which doesn't include them yet) can NEVER wipe them before Week N+1 rollover!
    const liveSustainedSf = appData.health.practiceReport.filter(
      r => Boolean(r?.sustainedInLastGame || r?.isInGameInjury || r?.isInGameReturned)
    );
    if (liveSustainedSf.length > 0) {
      appData.health._liveSustainedInGameRows = liveSustainedSf.map(r => ({ ...r, sustainedInLastGame: true }));
    }

    const byId = new Map(appData.health.practiceReport.map(r => [String(r.playerId || ''), r]));
    const byName = new Map(appData.health.practiceReport.map(r => [normalizeLookupName(r.name), r]));
    const sfInactByKey = new Map(
      (sfModel.inactives || []).map(inact => [normalizeLookupName(inact.name), inact])
    );

    for (const p of appData.roster?.players || []) {
      if (!p?.health || p.rosterBucket !== 'active') continue;
      if (!p._preGameHealthSnapshot) {
        p._preGameHealthSnapshot = { ...p.health };
      }
      const pKey = normalizeLookupName(p.name);
      const reportMatch = byId.get(String(p.id || '')) || byName.get(pKey) || null;
      const inactiveMatch = sfInactByKey.get(pKey) || null;

      if (inactiveMatch) {
        p.health.status = 'Inactive';
        p.health.injuryType = inactiveMatch.injuryType || p.health.injuryType || "Healthy Scratch (Coach's Decision)";
        p.health.playProbabilityPct = 0;
        p.health.playTier = 'OUT';
        p.health.playBadgeLabel = '0% • Out (Inactive)';
        delete p.health.isInGameInjury;
        delete p.health.isInGameReturned;
      } else if (reportMatch) {
        p.health.status = reportMatch.gameStatus || p.health.status;
        if (reportMatch.injuryType) p.health.injuryType = reportMatch.injuryType;
        p.health.playProbabilityPct = reportMatch.playProbabilityPct;
        p.health.playTier = reportMatch.playTier || reportMatch.tier || p.health.playTier;
        p.health.playBadgeLabel = reportMatch.playBadgeLabel || reportMatch.badgeLabel || p.health.playBadgeLabel;
        p.health.isInGameInjury = Boolean(reportMatch.isInGameInjury);
        p.health.isInGameReturned = Boolean(reportMatch.isInGameReturned);
        if (reportMatch.sustainedInLastGame || reportMatch.isInGameInjury || reportMatch.isInGameReturned) {
          p.health.sustainedInLastGame = true;
        }

        // Ensure latest mid-game injury/return tweet is immediately visible inside the Player Sheet modal!
        if (reportMatch.inGameLatestItem && Array.isArray(p.recentNews)) {
          const item = reportMatch.inGameLatestItem;
          if (!p.recentNews.some(rn => (item.id && rn.id === item.id) || rn.url === item.url)) {
            p.recentNews.unshift({
              id: item.id,
              type: item.type || 'tweet',
              headline: item.title || item.headline || reportMatch.beatComment,
              fullText: item.fullText || item.title || reportMatch.beatComment,
              isFullTweet: true,
              summary: item.summary || '',
              author: item.author || item.reporterName || teamBeatFallback,
              authorHandle: item.authorHandle || '',
              outletName: item.outletName || teamBeatFallback,
              publishedAt: item.publishedAt || new Date(nowMs).toISOString(),
              url: item.url || activeTeamGd.clubInjuryUrl || 'https://www.49ers.com/team/injury-report/',
              isBreaking: true,
              isInGameInjury: true,
              breakingBadge: 'LIVE INJURY UPDATE'
            });
          }
        }
      } else if (sfModel.officialPosted || sfModel.explicitActiveKeySet?.has(pKey) || windowState.hasKickoffStarted) {
        p.health.status = 'Active';
        p.health.playProbabilityPct = Math.max(95, Number(p.health.playProbabilityPct || 95));
        p.health.playTier = 'ACTIVE';
        if (!/full go|in \(active\)/i.test(String(p.health.playBadgeLabel || ''))) {
          p.health.playBadgeLabel = '99% • In (Active)';
        }
        delete p.health.isInGameInjury;
        delete p.health.isInGameReturned;
      }
    }

    synchronizeDepthChartForGameDay(appData);
  }

  // 6. Build Opponent Model + Live In-Game Return Signals + Sync Opponent Health Table, Starters Cleared, Availability Score & Live Injury Card
  if (oh && oppAbbr) {
    if (Array.isArray(oh.injuryReport)) {
      oh._preGameInjuryReport = mergeNonDestructivePreGameRows(oh._preGameInjuryReport, oh.injuryReport);
    }
    if (!Array.isArray(oh._preGameKeyStartersHealthy) && Array.isArray(oh.keyStartersHealthy)) {
      oh._preGameKeyStartersHealthy = oh.keyStartersHealthy.map(s => ({ ...s }));
    }

    const cleanBaseOppReport = oh._preGameInjuryReport || oh.injuryReport || [];
    const cleanBaseOppStarters = oh._preGameKeyStartersHealthy || oh.keyStartersHealthy || [];
    const oppNewsCombined = [
      ...(appData.liveGameDay.oppWireItems || []),
      ...(appData._oppNewsWire || []),
      ...(appData.news?.rawStream || [])
    ];
    const fullOppPool = [
      ...(oh.activeRoster || []),
      ...cleanBaseOppStarters,
      ...cleanBaseOppReport
    ];

    const oppModel = buildTeamGameDayRosterModel({
      teamAbbr: oppAbbr,
      teamName: oppName,
      activeRosterPlayers: fullOppPool,
      injuryReport: cleanBaseOppReport,
      newsItems: oppNewsCombined,
      liveFeedData: appData.liveGameDay.opp || null,
      windowState
    });

    const oppInGameSignals = windowState.hasKickoffStarted
      ? extractLiveInGameInjurySignals(oppNewsCombined, fullOppPool, windowState, oppModel.inactiveKeySet)
      : { byKey: new Map(), list: [] };
    oppModel.inGameSignals = oppInGameSignals;
    oh.gameDayRoster = oppModel;

    oh.injuryReport = resolveGameDayInjuryRows(cleanBaseOppReport, oppModel, {
      inGameSignals: oppInGameSignals,
      activeRosterPlayers: fullOppPool
    });

    // Update Healthy Key Starters: exclude declared inactives & unresolved injured/in-game-injured starters; set cleared active starters to 99%
    const unresolvedOppSet = new Set(
      oh.injuryReport
        .filter(r => (r.playProbabilityPct ?? 99) < 88)
        .map(r => normalizeLookupName(r.name))
    );
    oh.keyStartersHealthy = cleanBaseOppStarters
      .filter(st => {
        const k = normalizeLookupName(st.name);
        return !oppModel.inactiveKeySet.has(k) && !unresolvedOppSet.has(k);
      })
      .map(st =>
        oppModel.officialPosted || windowState.hasKickoffStarted
          ? {
              ...st,
              gameStatus: 'Active',
              playProbabilityPct: 99,
              playBadgeLabel: '99% • In (Active)'
            }
          : st
      );

    // Enrich live Opponent mid-game injuries for the Matchup tab's live Opponent Injury Update card
    const oppMetaByKey = new Map();
    for (const p of fullOppPool) {
      const k = normalizeLookupName(p.name);
      if (k && !oppMetaByKey.has(k)) oppMetaByKey.set(k, p);
    }
    oh.liveInGameInjuries = oppInGameSignals.list.map(sig => {
      const meta = oppMetaByKey.get(sig.key) || {};
      return {
        name: meta.name || sig.name,
        position: meta.position || sig.position || 'ATH',
        jersey: meta.jersey ?? sig.jersey ?? null,
        headshotUrl: meta.headshotUrl || '',
        espnUrl: meta.espnUrl || buildEspnTeamInjuriesUrl(oppAbbr),
        injuryType: sig.injuryType || 'In-Game Injury',
        state: sig.state,
        playProbabilityPct: sig.probabilityPct,
        playBadgeLabel: sig.badgeLabel,
        publishedAt: sig.publishedAt,
        latestSummary: sig.latestSummary,
        latestItem: sig.latestItem || null
      };
    });

    oh.summary = computeTeamHealthSummary({
      injuryReport: oh.injuryReport,
      irReserve: oh.irReserve || [],
      totalStarters: oh.summary?.totalStarters || 22
    });
  }

  persistGameDayInactivesSnapshot(appData, windowState);
  const afterFingerprint = computeGameDayStateFingerprint(appData);
  return afterFingerprint !== beforeFingerprint;
}

function normPlayerNameKey(s = '') {
  return String(s || '')
    .toLowerCase()
    .replace(/\b(jr\.?|sr\.?|ii|iii|iv)\b/g, '')
    .replace(/[^a-z0-9]/g, '')
    .trim();
}

function normalizeTeamAbbrClient(abbr = '') {
  const clean = String(abbr || '').toUpperCase().trim();
  if (clean === 'WSH') return 'WAS';
  if (clean === 'LA') return 'LAR';
  return clean;
}

function extractBodyPartSafe(shortComment = '') {
  const m = String(shortComment || '').match(/^[A-Z][A-Za-z'. -]{1,28}\s+\(([a-zA-Z /,-]{3,28})\)/);
  if (!m) return '';
  const cand = m[1].trim();
  if (/\b(solo|tackle|yard|target|catch|carry|touchdown|sack|int|fumble|pat|attempt)\b/i.test(cand)) {
    return '';
  }
  return cand.charAt(0).toUpperCase() + cand.slice(1);
}

const KNOWN_ESPN_STALE_GHOST_KEYS = new Set([
  'bretttoth',
  'vincentanthony',
  'vincentanthonyjr'
]);

/**
 * Reconciles ESPN's live 49ers Roster (`teams/25/roster`) and Depth Chart (`teams/25/depthcharts`)
 * directly in the browser so newly traded, claimed, or signed 49ers players (and newly assigned jersey numbers)
 * appear immediately in `appData.roster` and `appData.depthChart` even before the next static data build.
 */
export function reconcileLiveEspnSfRosterAndDepthChart(
  appData,
  sfRosterRaw = null,
  sfDepthRaw = null,
  combinedEspnArticles = []
) {
  if (!appData?.roster || !Array.isArray(appData.roster.players)) return false;
  let changed = false;

  const depthChartIds = new Set();
  for (const dc of sfDepthRaw?.depthchart || []) {
    for (const posObj of Object.values(dc.positions || {})) {
      for (const ath of posObj?.athletes || []) {
        if (ath?.id) depthChartIds.add(String(ath.id));
      }
    }
  }

  const players = appData.roster.players;
  const byId = new Map(players.map(p => [String(p.id), p]));
  const byNorm = new Map(players.map(p => [normPlayerNameKey(p.name), p]));

  if (Array.isArray(sfRosterRaw?.athletes) && sfRosterRaw.athletes.length > 0) {
    for (const grp of sfRosterRaw.athletes) {
      const gKey = String(grp.position || '');
      const espnDefaultBucket =
        gKey === 'injuredReserveOrOut'
          ? 'ir'
          : gKey === 'practiceSquad'
            ? 'practice_squad'
            : gKey === 'suspended'
              ? 'suspended'
              : 'active';

      for (const ath of grp.items || []) {
        const espnId = String(ath.id || '').trim();
        const fullName = String(ath.fullName || ath.displayName || '').trim();
        const nk = normPlayerNameKey(fullName);
        if (!espnId || !fullName || !nk) continue;
        if (KNOWN_ESPN_STALE_GHOST_KEYS.has(nk)) continue;

        const inlineInj = ath.injuries?.[0] || null;
        const injProbe = `${inlineInj?.shortComment || ''} ${inlineInj?.longComment || ''}`;
        if (/\breleased\b[\s\S]{0,45}\bfrom\s+(?:injured\s+reserve|the\s+practice\s+squad)\s+with\s+an\s+injury\s+settlement/i.test(injProbe)) {
          continue;
        }

        const existing = byId.get(espnId) || byNorm.get(nk) || null;
        if (existing) {
          if (
            (existing.jersey === null || existing.jersey === undefined || existing.jersey === '') &&
            ath.jersey !== undefined &&
            ath.jersey !== null &&
            ath.jersey !== ''
          ) {
            existing.jersey = Number(ath.jersey);
            changed = true;
          }
          if (!existing.headshotUrl && ath.headshot?.href) {
            const hs = String(ath.headshot.href);
            existing.headshotUrl = hs.startsWith('http://') ? `https://${hs.slice(7)}` : hs;
            changed = true;
          }
          continue;
        }

        // Only auto-inject newly added players who are in ESPN's Active 53 groups or on the live Depth Chart
        if (espnDefaultBucket !== 'active' && !depthChartIds.has(espnId)) {
          continue;
        }

        const posAbbr = ath.position?.abbreviation || 'ATH';
        const unit = classifyRosterUnit(
          posAbbr,
          gKey === 'defense' ? 'Defense' : gKey === 'specialTeam' ? 'Special Teams' : 'Offense'
        );
        const rawHs =
          ath.headshot?.href ||
          (/^\d+$/.test(espnId) ? `https://a.espncdn.com/i/headshots/nfl/players/full/${espnId}.png` : '');
        const headshotUrl = rawHs.startsWith('http://') ? `https://${rawHs.slice(7)}` : rawHs;
        const jersey =
          ath.jersey !== undefined && ath.jersey !== null && ath.jersey !== '' ? Number(ath.jersey) : null;
        const expYears = Number.isFinite(Number(ath.experience?.years)) ? Number(ath.experience.years) : null;

        // Enrich from league-wide `peerDirectory` and `positionalLeaderboards` when present
        let peerUid = null;
        let peerEntry = null;
        const peerDir = appData.roster.peerDirectory || {};
        for (const [uidKey, pMeta] of Object.entries(peerDir)) {
          if (
            (pMeta?.espnUrl && String(pMeta.espnUrl).includes(`/id/${espnId}`)) ||
            normPlayerNameKey(pMeta?.name || '') === nk
          ) {
            peerUid = uidKey;
            peerEntry = pMeta;
            break;
          }
        }
        if (peerEntry) {
          peerEntry.team = 'SF';
          peerEntry.sfPlayerId = espnId;
        }

        const gsisId = peerUid && /^\d{2}-\d{7}$/.test(peerUid) ? peerUid : null;
        const pfrUrl = peerEntry?.pfrUrl || null;
        const pfrIdMatch = pfrUrl ? String(pfrUrl).match(/\/players\/[A-Z]\/([A-Za-z0-9]+)\.htm/) : null;
        const pfrId = pfrIdMatch ? pfrIdMatch[1] : null;
        const espnUrl = buildEspnPlayerUrl(espnId, fullName);
        const slugName = fullName
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/^-|-$/g, '');
        const activeTeamRos = resolveTeamConfig(appData?.meta?.teamAbbr || getActiveTeamConfig());
        const otcUrl = `https://overthecap.com/salary-cap/${activeTeamRos.otcSlug}`;

        const playProb = computePlayerPlayProbability({
          name: fullName,
          position: posAbbr,
          experienceYears: expYears,
          snapPct: 65,
          rosterBucket: 'active',
          gameStatus: inlineInj?.status || 'Active'
        });

        const matchedNews = (combinedEspnArticles || [])
          .filter(art => {
            if (art?.premium) return false;
            const hay = `${art?.headline || ''} ${art?.description || ''}`.toLowerCase();
            return hay.includes(fullName.toLowerCase());
          })
          .slice(0, 3)
          .map(art => ({
            headline: cleanSensationalistText(art.headline || ''),
            summary: cleanSensationalistText(art.description || ''),
            publishedAt: art.published || new Date().toISOString(),
            imageUrl: art.images?.[0]?.url
              ? String(art.images[0].url).replace(/^http:\/\//i, 'https://')
              : '',
            url: sanitizeExternalUrl(
              art.links?.web?.href,
              `https://www.espn.com/nfl/team/_/name/${activeTeamRos.espnAbbr}/${activeTeamRos.otcSlug}`
            )
          }));

        const newPlayer = {
          id: espnId,
          gsisId,
          pfrId,
          otcId: null,
          otcSlug: slugName,
          otcUrl,
          espnUrl,
          pfrUrl,
          name: fullName,
          shortName: ath.shortName || fullName,
          jersey,
          position: posAbbr,
          unit,
          rosterBucket: 'active',
          age: ath.age || null,
          displayHeight: ath.displayHeight || '',
          displayWeight: ath.displayWeight || (ath.weight ? `${ath.weight} lbs` : ''),
          experienceYears: expYears ?? 0,
          college: ath.college?.name || 'NFL',
          draftInfo: ath.displayDraft || 'NFL Veteran',
          headshotUrl,
          capHit2026: 0,
          contractsByYear: {},
          snapSummary: {
            gamesLogged: peerEntry?.pfrGames || 0,
            offenseSnaps: 0,
            offenseSnapPct: unit === 'Offense' ? 65 : 0,
            defenseSnaps: 0,
            defenseSnapPct: unit === 'Defense' ? 65 : 0,
            stSnaps: 0,
            stSnapPct: unit === 'Special Teams' ? 50 : 0
          },
          primarySnapPct: 65,
          stats2026: null,
          careerSeasons: [],
          nextGenStats: null,
          pfrAdvStats: null,
          publicEfficiencyNote: null,
          spiderProfile: {
            positionGroup: posAbbr,
            compositeRas: 7.5,
            axes: [
              { label: 'Speed', percentile: 75 },
              { label: 'Explosion', percentile: 75 },
              { label: 'Agility', percentile: 78 },
              { label: 'Size', percentile: 74 },
              { label: 'Strength', percentile: 72 }
            ]
          },
          health: {
            status: inlineInj?.status && inlineInj.status !== 'Active' ? inlineInj.status : 'Active',
            injuryType: inlineInj?.details?.type || '',
            returnDate: null,
            isSeasonEnding: false,
            isPracticeWindowOpen: false,
            placedBeforeWeek: null,
            earliestEligibleWeek: null,
            projectedReturnWeek: null,
            byeWeekNote: null,
            irBeatNote: null,
            fantasyStatusAbbr: '',
            isIrReturnQuestionable: false,
            isOnPracticeReport: false,
            wed: '-',
            thu: '-',
            fri: '-',
            shortComment: '',
            longComment: '',
            playProbabilityPct: playProb.probabilityPct,
            playTier: playProb.tier,
            playBadgeLabel: playProb.badgeLabel,
            factors: playProb.factors,
            archetypeNote: playProb.priorUsed?.archetypeNote || '',
            weeklyHistory2026: []
          },
          recentNews: matchedNews
        };

        players.push(newPlayer);
        byId.set(espnId, newPlayer);
        byNorm.set(nk, newPlayer);
        changed = true;
      }
    }
  }

  if (changed) {
    players.sort((a, b) => a.name.localeCompare(b.name));
    appData.roster.count = players.length;
  }

  // Sync any newly added active players into `appData.depthChart.units` if present on ESPN's live depth chart
  if (Array.isArray(sfDepthRaw?.depthchart) && Array.isArray(appData.depthChart?.units)) {
    for (const dc of sfDepthRaw.depthchart) {
      const targetUnit = appData.depthChart.units.find(
        u =>
          String(u.id) === String(dc.id) ||
          (dc.name === '3WR 1TE' && String(u.unitName || '').includes('Offense')) ||
          (dc.name === 'Base 4-3 D' && String(u.unitName || '').includes('Defense'))
      );
      if (!targetUnit || !Array.isArray(targetUnit.rows)) continue;

      for (const [slotKey, posObj] of Object.entries(dc.positions || {})) {
        const row = targetUnit.rows.find(r => r.slotKey === slotKey);
        if (!row || !Array.isArray(row.baselineChain)) continue;
        const existingRowIds = new Set(row.baselineChain.map(c => String(c.playerId)));

        for (const ath of posObj?.athletes || []) {
          const matched =
            byId.get(String(ath.id || '')) || byNorm.get(normPlayerNameKey(ath.displayName || ''));
          if (!matched || existingRowIds.has(String(matched.id))) continue;
          const prob = matched.health?.playProbabilityPct ?? 95;
          const isAvailable =
            prob >= 40 && (matched.rosterBucket === 'active' || Boolean(matched.health?.isIrReturnQuestionable));
          const entry = {
            playerId: matched.id,
            name: matched.name,
            jersey: matched.jersey ?? null,
            headshotUrl: matched.headshotUrl || '',
            baselineRank: row.baselineChain.length + 1,
            playProbabilityPct: prob,
            statusBadge: matched.health?.playBadgeLabel || '95% • Full Go',
            isAvailable
          };
          row.baselineChain.push(entry);
          row.projectedActiveChain = [
            ...row.baselineChain.filter(x => x.isAvailable),
            ...row.baselineChain.filter(x => !x.isAvailable).map(x => ({ ...x, demotedDueToInjury: true }))
          ];
          row.starterPromoted =
            row.baselineChain.length > 1 &&
            row.projectedActiveChain[0]?.playerId !== row.baselineChain[0]?.playerId;
          existingRowIds.add(String(matched.id));
          changed = true;
        }
      }
    }
  }

  return changed;
}

/**
 * Zero-server real-time client hydration directly from CORS-enabled ESPN NFL APIs
 * (`site.api.espn.com` + `site.web.api.espn.com`). Automatically updates standings,
 * live game state & scores, week rollover (`upcomingMatchup` + Pickcenter odds), 49ers live
 * roster & depth chart additions, 49ers & opponent injury play probabilities, 10,000-run
 * Monte Carlo playoff odds, and ESPN beat articles.
 */
let cachedOfficialInjuryHtml = '';
let cachedOfficialInjuryFetchedAtMs = 0;

async function fetchOfficial49ersInjuryReportHtmlClient(nowMs = Date.now(), teamInput = null) {
  const activeTeam = resolveTeamConfig(teamInput || getActiveTeamConfig());
  if (cachedOfficialInjuryHtml && nowMs - cachedOfficialInjuryFetchedAtMs < 45_000) {
    return cachedOfficialInjuryHtml;
  }
  try {
    const res = await fetchSingleWithTimeout(activeTeam.clubInjuryUrl, { cache: 'no-store' }, 6500);
    if (!res?.ok || typeof res.text !== 'function') return '';
    const html = await res.text();
    if (typeof html === 'string' && html.includes('<table')) {
      cachedOfficialInjuryHtml = html;
      cachedOfficialInjuryFetchedAtMs = nowMs;
      return html;
    }
  } catch {
    // Ignore offline / mock fetch environments cleanly
  }
  return '';
}

function extractTeamInjuriesFromEspnPayload(payload, { isSf = false, oppAbbr = '', oppName = '', activeTeam = null } = {}) {
  if (!payload || !Array.isArray(payload.injuries)) return null;
  const teamCfg = resolveTeamConfig(activeTeam || getActiveTeamConfig());
  const espnIdStr = String(teamCfg.espnId);
  const nickRe = new RegExp(teamCfg.nickname, 'i');
  // Shape 1: Live per-team `?team=<slug|id>` response (`{ team: {...}, injuries: [athleteItem, ...] }`)
  const firstEntry = payload.injuries[0];
  const isPerTeamShape =
    Boolean(payload.team) ||
    payload.injuries.length === 0 ||
    (firstEntry && !Array.isArray(firstEntry.injuries) && Boolean(firstEntry.athlete || firstEntry.status || firstEntry.shortComment));
  if (isPerTeamShape) {
    if (payload.team) {
      const teamAbbr = normalizeTeamAbbrClient(payload.team.abbreviation || '');
      const teamIdStr = String(payload.team.id || '');
      const teamDisp = String(payload.team.displayName || '');
      if (isSf) {
        if (teamIdStr && teamIdStr !== espnIdStr && teamAbbr && teamAbbr !== teamCfg.abbr && !nickRe.test(teamDisp)) {
          return null;
        }
      } else if (oppAbbr) {
        if (teamAbbr && teamAbbr !== oppAbbr && (!oppName || teamDisp !== oppName)) {
          return null;
        }
      }
    }
    return { injuries: payload.injuries };
  }
  // Shape 2: Legacy / test-mock 32-team response (`{ injuries: [{ id: '25', displayName: 'San Francisco 49ers', injuries: [...] }] }`)
  if (isSf) {
    return (
      payload.injuries.find(t => String(t?.id) === espnIdStr || nickRe.test(t?.displayName || '')) || null
    );
  }
  if (!oppAbbr) return null;
  return (
    payload.injuries.find(t => {
      const sampleAbbr = normalizeTeamAbbrClient(t?.injuries?.[0]?.athlete?.team?.abbreviation || '');
      return sampleAbbr === oppAbbr || Boolean(oppName && t?.displayName === oppName);
    }) || null
  );
}

export async function hydrateLiveEspnOverlay(appData) {
  if (!appData?.meta || !appData?.scheduleMatchup) return false;
  const activeTeam = resolveTeamConfig(appData?.meta?.teamAbbr || getActiveTeamConfig());
  let mutated = false;
  let standingsOrScoresChanged = false;

  const fetchCorsJson = async (url, timeoutMs = 7500) => {
    const res = await fetchSingleWithTimeout(url, { cache: 'no-store' }, timeoutMs);
    if (!res.ok) return null;
    return res.json();
  };

  const initialOppAbbr = normalizeTeamAbbrClient(appData.scheduleMatchup?.upcomingMatchup?.oppAbbr || '');
  const initialOppSlug =
    initialOppAbbr && initialOppAbbr !== activeTeam.abbr && initialOppAbbr !== 'TBD' && initialOppAbbr !== 'BYE'
      ? toEspnTeamSlugClient(initialOppAbbr)
      : '';

  const [
    standingsRaw,
    scheduleRaw,
    sfInjuriesRaw,
    initialOppInjuriesRaw,
    espnNewsRaw,
    sfRosterRaw,
    sfDepthRaw,
    official49ersInjHtml
  ] = await Promise.all([
    fetchCorsJson('https://site.web.api.espn.com/apis/v2/sports/football/nfl/standings').catch(() => null),
    fetchCorsJson(`https://site.api.espn.com/apis/site/v2/sports/football/nfl/teams/${activeTeam.espnAbbr}/schedule`).catch(() => null),
    fetchCorsJson(`https://site.api.espn.com/apis/site/v2/sports/football/nfl/injuries?team=${activeTeam.espnId}`).catch(() => null),
    initialOppSlug
      ? fetchCorsJson(
          `https://site.api.espn.com/apis/site/v2/sports/football/nfl/injuries?team=${encodeURIComponent(initialOppSlug)}`
        ).catch(() => null)
      : Promise.resolve(null),
    fetchCorsJson(`https://site.api.espn.com/apis/site/v2/sports/football/nfl/news?team=${activeTeam.espnId}&limit=25`).catch(() => null),
    fetchCorsJson(`https://site.api.espn.com/apis/site/v2/sports/football/nfl/teams/${activeTeam.espnId}/roster`).catch(() => null),
    fetchCorsJson(`https://site.api.espn.com/apis/site/v2/sports/football/nfl/teams/${activeTeam.espnId}/depthcharts`).catch(() => null),
    fetchOfficial49ersInjuryReportHtmlClient(Date.now(), activeTeam).catch(() => '')
  ]);
  let oppInjuriesRaw = initialOppInjuriesRaw;
  let combinedEspnArticles = Array.isArray(espnNewsRaw?.articles) ? [...espnNewsRaw.articles] : [];

  // Reconcile any newly traded/signed/claimed 49ers players on ESPN's live roster & depth chart immediately
  if (reconcileLiveEspnSfRosterAndDepthChart(appData, sfRosterRaw, sfDepthRaw, combinedEspnArticles)) {
    mutated = true;
  }

  const teamRecords = new Map();

  // 1. Live Standings & NFC West Rank
  if (standingsRaw?.children?.length) {
    for (const conf of standingsRaw.children) {
      for (const entry of conf.standings?.entries || []) {
        const abbr = normalizeTeamAbbrClient(entry.team?.abbreviation);
        const getStat = n => entry.stats?.find(s => s.name === n);
        const record = getStat('overall')?.displayValue || '0-0';
        const wins = Number(getStat('wins')?.value || 0);
        const losses = Number(getStat('losses')?.value || 0);
        const ties = Number(getStat('ties')?.value || 0);
        const winPct = Number(getStat('winPercent')?.value || 0);
        const pd = Number(getStat('pointDifferential')?.value || 0);
        const pf = Number(getStat('pointsFor')?.value || 0);
        const pa = Number(getStat('pointsAgainst')?.value || 0);
        const seed = Number(getStat('playoffSeed')?.value || 1);
        const divRec = getStat('vs. Div.')?.displayValue || getStat('divisionRecord')?.displayValue || '0-0';
        const confRec = getStat('vs. Conf.')?.displayValue || '0-0';
        teamRecords.set(abbr, { record, wins, losses, ties, winPct, pd, pf, pa, seed, divRec, confRec });
      }
    }

    const sfSt = teamRecords.get(activeTeam.abbr);
    if (sfSt) {
      const divPeerAbbrs = [activeTeam.abbr, ...(activeTeam.divisionRivals || [])];
      const nfcWestRanked = divPeerAbbrs
        .map(a => ({ abbr: a, ...(teamRecords.get(a) || { winPct: 0, wins: 0, pd: 0 }) }))
        .sort((a, b) => b.winPct - a.winPct || b.wins - a.wins || b.pd - a.pd);
      const divIdx = Math.max(0, nfcWestRanked.findIndex(t => t.abbr === activeTeam.abbr));
      const divOrd = ['1st', '2nd', '3rd', '4th'][divIdx] || '1st';
      const newSummary = `${divOrd} in ${activeTeam.division} • #${sfSt.seed} Seed in ${activeTeam.conference}`;
      const newPdDisp = `${sfSt.pd >= 0 ? '+' : ''}${sfSt.pd} (${sfSt.pf} PF / ${sfSt.pa} PA)`;

      if (appData.meta.teamRecord !== sfSt.record) standingsOrScoresChanged = true;
      appData.meta.teamRecord = sfSt.record;
      appData.meta.divisionRecord = sfSt.divRec;
      appData.meta.conferenceRecord = sfSt.confRec;
      appData.meta.standingSummary = newSummary;
      appData.meta.pointDifferential = newPdDisp;
      mutated = true;

      const parseWltRecord = str => {
        const parts = String(str || '0-0')
          .split('-')
          .map(x => Number(x) || 0);
        return { w: parts[0] || 0, l: parts[1] || 0, t: parts[2] || 0 };
      };

      const simInputsRef = appData.seasonal?.playoffPicture?.simulatorInputs;
      const nfcInputs = simInputsRef?.nfcTeams || [];
      for (const nt of nfcInputs) {
        const normAbbr = normalizeTeamAbbrClient(nt.abbr);
        const liveT = teamRecords.get(normAbbr);
        if (liveT) {
          if (
            Number(nt.wins || 0) !== liveT.wins ||
            Number(nt.losses || 0) !== liveT.losses ||
            Number(nt.ties || 0) !== liveT.ties
          ) {
            standingsOrScoresChanged = true;
          }
          nt.wins = liveT.wins;
          nt.losses = liveT.losses;
          nt.ties = liveT.ties;
          nt.pointDiff = liveT.pd;
          if (liveT.divRec && liveT.divRec !== '0-0') {
            const dParsed = parseWltRecord(liveT.divRec);
            nt.divWins = dParsed.w;
            nt.divLosses = dParsed.l;
            nt.divTies = dParsed.t;
          }
          if (liveT.confRec && liveT.confRec !== '0-0') {
            const cParsed = parseWltRecord(liveT.confRec);
            nt.confWins = cParsed.w;
            nt.confLosses = cParsed.l;
            nt.confTies = cParsed.t;
          }
          nt.powerRating = computeCalibratedTeamPowerRating({
            wins: liveT.wins,
            losses: liveT.losses,
            ties: liveT.ties,
            pointDiff: liveT.pd,
            netEpaPerGame: nt.netEpaPerGame ?? null,
            sosSpreadAdj: nt.sosSpreadAdj ?? 0
          });
        }
      }

      if (simInputsRef) {
        const nfcAbbrSet = new Set(nfcInputs.map(t => normalizeTeamAbbrClient(t.abbr)));
        if (!simInputsRef.afcStandings || typeof simInputsRef.afcStandings !== 'object') {
          simInputsRef.afcStandings = {};
        }
        if (!simInputsRef.afcRatings || typeof simInputsRef.afcRatings !== 'object') {
          simInputsRef.afcRatings = {};
        }
        for (const [abbr, liveT] of teamRecords.entries()) {
          if (nfcAbbrSet.has(abbr)) continue;
          const prevAfc = simInputsRef.afcStandings[abbr];
          if (
            prevAfc &&
            (prevAfc.wins !== liveT.wins || prevAfc.losses !== liveT.losses || prevAfc.ties !== liveT.ties)
          ) {
            standingsOrScoresChanged = true;
          }
          simInputsRef.afcStandings[abbr] = {
            wins: liveT.wins,
            losses: liveT.losses,
            ties: liveT.ties,
            pointDiff: liveT.pd
          };
          simInputsRef.afcRatings[abbr] = computeCalibratedTeamPowerRating({
            wins: liveT.wins,
            losses: liveT.losses,
            ties: liveT.ties,
            pointDiff: liveT.pd
          });
        }
      }

      // Immediately refresh live Standings-driven Team Stats (PPG, PAPG, PtDiff/Gm, 32-team modal records & unit composites)
      if (appData.scheduleMatchup?.teamStats) {
        const teamStatsUpdated = refreshLiveStandingsMetricsInTeamStats(
          appData.scheduleMatchup.teamStats,
          appData.scheduleMatchup.teamStatRankings,
          teamRecords,
          activeTeam.abbr
        );
        if (teamStatsUpdated) mutated = true;
      }
    }
  }

  let weekAdvancedFlag = false;
  let nextGameKickoffIso =
    appData.scheduleMatchup?.upcomingMatchup?.kickoffIso ||
    appData.scheduleMatchup?.upcomingMatchup?.dateIso ||
    '';

  // 2. Live Schedule Scores, In-Game Live State & Automatic Week Rollover (Preseason + Regular Season + Postseason)
  if (scheduleRaw?.events?.length && Array.isArray(appData.scheduleMatchup.schedule)) {
    const byId = new Map(
      appData.scheduleMatchup.schedule.filter(g => g?.id).map(g => [String(g.id), g])
    );
    const byTypeWeek = new Map(
      appData.scheduleMatchup.schedule.map(g => [`${g.seasonType || 'REG'}:${Number(g.week)}`, g])
    );

    const allEvents = [...scheduleRaw.events];
    const allRegDone = appData.scheduleMatchup.schedule
      .filter(g => (g.seasonType || 'REG') === 'REG' && !g.isByeWeek)
      .every(g => Boolean(g.completed));
    if (
      allRegDone &&
      !allEvents.some(e => Number(e.seasonType?.type ?? e.seasonType?.id ?? 0) === 3)
    ) {
      const postRaw = await fetchCorsJson(
        `https://site.api.espn.com/apis/site/v2/sports/football/nfl/teams/${activeTeam.espnAbbr}/schedule?seasontype=3`
      ).catch(() => null);
      if (Array.isArray(postRaw?.events) && postRaw.events.length > 0) {
        allEvents.push(...postRaw.events);
      }
    }

    for (const ev of allEvents) {
      const evStType = Number(ev.seasonType?.type ?? ev.seasonType?.id ?? 2);
      const rawWkNum = Number(ev.week?.number || 0);
      if (evStType === 3 && rawWkNum === 4) continue; // Skip Pro Bowl

      let stCode = 'REG';
      let wk = rawWkNum;
      let postRound = null;
      if (evStType === 1) {
        stCode = 'PRE';
        const preWk = Number(
          String(ev.week?.text || '').match(/(\d+)/)?.[1] || Math.max(1, rawWkNum - 1)
        );
        wk = -(4 - Math.min(3, preWk));
      } else if (evStType === 3) {
        stCode = 'POST';
        postRound = rawWkNum === 1 ? 'WC' : rawWkNum === 2 ? 'DIV' : rawWkNum === 3 ? 'CON' : 'SB';
        wk = rawWkNum === 1 ? 19 : rawWkNum === 2 ? 20 : rawWkNum === 3 ? 21 : 22;
      }

      const comp = ev.competitions?.[0] || {};
      const sfComp = (comp.competitors || []).find(
        c => normalizeTeamAbbrClient(c.team?.abbreviation) === activeTeam.abbr
      );
      const oppComp = (comp.competitors || []).find(
        c => normalizeTeamAbbrClient(c.team?.abbreviation) !== activeTeam.abbr
      );
      const completed = Boolean(comp.status?.type?.completed);
      const liveState = String(comp.status?.type?.state || '').toLowerCase();

      let item = (ev.id && byId.get(String(ev.id))) || byTypeWeek.get(`${stCode}:${wk}`) || null;
      if (!item && stCode === 'POST') {
        const oppAbbrRaw = normalizeTeamAbbrClient(oppComp?.team?.abbreviation || 'TBD');
        const isTbdOpp = !oppComp?.team?.abbreviation || oppAbbrRaw === 'TBD';
        const venueObj = comp.venue || {};
        item = normalizeScheduleGameItem(
          {
            id: ev.id || `post_${appData.meta.seasonYear || 2026}_${postRound.toLowerCase()}`,
            seasonType: 'POST',
            postseasonRound: postRound,
            week: wk,
            dateIso: ev.date,
            statusDetail: comp.status?.type?.shortDetail || 'Playoffs',
            statusState: liveState,
            completed,
            homeAway: sfComp?.homeAway || 'home',
            sfLogoUrl: buildEspnTeamLogoUrl(activeTeam.abbr),
            opponent: {
              abbr: isTbdOpp ? 'TBD' : oppAbbrRaw,
              name: oppComp?.team?.displayName || (isTbdOpp ? 'Opponent TBD' : oppAbbrRaw),
              logoUrl: isTbdOpp ? '' : buildEspnTeamLogoUrl(oppAbbrRaw),
              record: teamRecords.get(oppAbbrRaw)?.record || (isTbdOpp ? 'Matchup TBD' : '—'),
              isTbd: isTbdOpp
            },
            venue: {
              name: venueObj.fullName || (sfComp?.homeAway === 'home' ? activeTeam.stadium : 'Venue TBD'),
              city: venueObj.address?.city || (sfComp?.homeAway === 'home' ? activeTeam.city : ''),
              state: venueObj.address?.state || '',
              country: venueObj.address?.country || 'USA',
              isInternational: false,
              surface: 'Natural Grass'
            }
          },
          Number(appData.meta.seasonYear) || 2026
        );
        appData.scheduleMatchup.schedule.push(item);
        if (item.id) byId.set(String(item.id), item);
        byTypeWeek.set(`${stCode}:${wk}`, item);
      }

      if (!item) continue;
      item.statusState = liveState;

      // Sync last-minute NFL flexes / rescheduled kickoff times & broadcast networks immediately!
      if (ev.date) {
        const liveEvMs = Date.parse(ev.date);
        const prevItemMs = item.dateIso ? Date.parse(item.dateIso) : NaN;
        if (Number.isFinite(liveEvMs) && (!Number.isFinite(prevItemMs) || Math.abs(liveEvMs - prevItemMs) >= 60_000)) {
          item.dateIso = ev.date;
          standingsOrScoresChanged = true;
        }
      }
      const liveBroadcast = comp.broadcasts?.[0]?.names?.[0] || comp.geoBroadcasts?.[0]?.media?.shortName || '';
      if (liveBroadcast && liveBroadcast !== item.broadcast) {
        item.broadcast = liveBroadcast;
      }

      if (completed && !item.completed) standingsOrScoresChanged = true;
      if (completed || liveState === 'in') {
        const sfSc = Number(sfComp?.score?.value ?? sfComp?.score?.displayValue ?? item.sfScore ?? 0);
        const opSc = Number(oppComp?.score?.value ?? oppComp?.score?.displayValue ?? item.oppScore ?? 0);
        item.sfScore = sfSc;
        item.oppScore = opSc;
        if (completed) {
          if (!item.completed && !item.completedAt) {
            const koCheckMs = item.dateIso ? Date.parse(item.dateIso) : NaN;
            // Widened to 8.5h to cover weather-delayed and overtime games finishing past ko + 5.5h
            if (Number.isFinite(koCheckMs) && Date.now() >= koCheckMs && Date.now() <= koCheckMs + 8.5 * 3600_000) {
              item.completedAt = new Date().toISOString();
            }
          }
          item.completed = true;
          item.result = sfSc > opSc ? 'W' : sfSc < opSc ? 'L' : 'T';
        }
      }
      if (comp.status?.type?.shortDetail) {
        item.statusDetail = comp.status.type.shortDetail;
      }
      if (stCode === 'POST' && oppComp?.team?.abbreviation && oppComp.team.abbreviation !== 'TBD') {
        const newOppAbbr = normalizeTeamAbbrClient(oppComp.team.abbreviation);
        item.opponent = {
          ...(item.opponent || {}),
          abbr: newOppAbbr,
          name: oppComp.team.displayName || newOppAbbr,
          logoUrl: buildEspnTeamLogoUrl(newOppAbbr),
          isTbd: false
        };
      }
      const oppLive = teamRecords.get(normalizeTeamAbbrClient(item.opponent?.abbr));
      if (oppLive && item.opponent && !item.opponent.isTbd) {
        item.opponent.record = oppLive.record;
        item.opponent.pointDiff = oppLive.pd;
      }
      mutated = true;
    }

    const allRegCompletedAfterSync = appData.scheduleMatchup.schedule
      .filter(g => (g.seasonType || 'REG') === 'REG' && !g.isByeWeek)
      .every(g => Boolean(g.completed));
    const schedModelAfterSync = allRegCompletedAfterSync ? resolveCompleteScheduleModel(appData) : null;
    const projectedNextPostGame = schedModelAfterSync
      ? schedModelAfterSync.upcomingGames.find(g => !g.isByeWeek) || null
      : null;

    const nextGame =
      appData.scheduleMatchup.schedule.find(g => !g.completed && !g.isByeWeek) ||
      projectedNextPostGame ||
      appData.scheduleMatchup.schedule[appData.scheduleMatchup.schedule.length - 1];

    if (nextGame) {
      const um = appData.scheduleMatchup.upcomingMatchup || {};
      const nextWk = Number(nextGame.week || appData.meta.currentWeek || 9);
      const weekAdvanced = Boolean(um.week && nextWk !== Number(um.week));
      if (weekAdvanced) weekAdvancedFlag = true;
      nextGameKickoffIso = nextGame.dateIso || um.kickoffIso || nextGameKickoffIso;

      const sbWonAfterSync = Boolean(
        schedModelAfterSync?.postseasonGames?.some(
          g => g.postseasonRound === 'SB' && g.completed && g.result === 'W'
        )
      );
      const isSeasonConcluded = Boolean(
        allRegCompletedAfterSync &&
          schedModelAfterSync &&
          (schedModelAfterSync.postseasonStatus.isEliminated ||
            sbWonAfterSync ||
            (!schedModelAfterSync.postseasonStatus.hasClinchedPlayoffs &&
              schedModelAfterSync.upcomingGames.filter(g => !g.isByeWeek).length === 0))
      );

      appData.meta.currentWeek = nextWk;
      if (appData.meta.teamStatus) {
        appData.meta.teamStatus.currentWeek = nextWk;
        appData.meta.teamStatus.seasonConcluded = isSeasonConcluded;
      }
      if (appData.health) appData.health.week = nextWk;

      const oppAbbr = normalizeTeamAbbrClient(nextGame.opponent?.abbr || um.oppAbbr || 'LV');
      const isTbdOpponent = Boolean(nextGame.opponent?.isTbd || oppAbbr === 'TBD' || oppAbbr === 'BYE');
      const oppLiveRec = !isTbdOpponent
        ? teamRecords.get(oppAbbr)?.record || nextGame.opponent?.record || um.oppRecord
        : nextGame.opponent?.record || 'Matchup TBD';
      if (oppLiveRec) um.oppRecord = oppLiveRec;
      if (appData.meta.teamRecord) {
        const divOrdPart = (appData.meta.standingSummary || '').split('•')[0]?.trim() || activeTeam.division || 'NFC West';
        um.sfRecord = `${appData.meta.teamRecord} (${divOrdPart})`;
      }

      if (weekAdvanced) {
        const dt = nextGame.dateIso ? new Date(nextGame.dateIso) : null;
        const tz = activeTeam.timezone || 'America/Los_Angeles';
        const tzShort = tz === 'America/Los_Angeles' ? 'PT' : tz === 'America/New_York' || tz === 'America/Detroit' ? 'ET' : tz === 'America/Chicago' ? 'CT' : tz === 'America/Denver' ? 'MT' : 'ET';
        const kickoffFmt = dt && !Number.isNaN(dt.getTime())
          ? `${dt.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: tz })} • ${dt.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: tz })} ${tzShort} (${nextGame.broadcast || 'NFL'})`
          : nextGame.statusDetail || '';

        um.week = nextWk;
        um.gameId = nextGame.id || um.gameId;
        um.gameUrl = nextGame.gameUrl || um.gameUrl;
        um.oppAbbr = oppAbbr;
        um.oppName = nextGame.opponent?.name || oppAbbr;
        um.oppLogoUrl = isTbdOpponent ? '' : nextGame.opponent?.logoUrl || buildEspnTeamLogoUrl(oppAbbr);
        um.homeAway = nextGame.homeAway || 'home';
        um.dateIso = nextGame.dateIso || um.dateIso || um.kickoffIso;
        um.kickoffIso = nextGame.dateIso || um.kickoffIso;
        um.kickoffDisplay = kickoffFmt;
        um.venue = `${nextGame.venue?.name || ''}${nextGame.venue?.city ? ` (${nextGame.venue.city})` : ''} • ${nextGame.venue?.surface || 'Grass'}`;
        um.aiMatchupMeta = null;
        um.coachingMatchup = buildDeterministicCoachingMatchup({
          team: activeTeam,
          metaCoaches: appData.meta?.coaches || null,
          week: nextWk,
          oppAbbr,
          oppName: um.oppName,
          oppRecord: um.oppRecord,
          oppCoachName: nextGame.opponent?.coach || '',
          homeAway: nextGame.homeAway || 'home'
        });
        um.keyMatchupsMatrix = [];
        if (um.franchiseHistory && !isTbdOpponent) {
          um.franchiseHistory.pfrQueryUrl = buildPfrHeadToHeadUrl(activeTeam.abbr, oppAbbr);
          if (oppAbbr !== initialOppAbbr) {
            um.franchiseHistory.allTimeRecord = `${activeTeam.nickname} vs. ${nextGame.opponent?.shortName || um.oppName}`;
            um.franchiseHistory.recentRecord = '';
            um.franchiseHistory.recentGames = [];
          }
        }
        if (um.opponentHealth) {
          um.opponentHealth.teamAbbr = oppAbbr;
          um.opponentHealth.teamName = um.oppName;
          um.opponentHealth.teamInjuriesUrl = isTbdOpponent ? 'https://www.espn.com/nfl/injuries' : buildEspnTeamInjuriesUrl(oppAbbr);
          um.opponentHealth.gameDayRoster = null;
          um.opponentHealth.liveInGameInjuries = [];
          delete um.opponentHealth._preGameInjuryReport;
          delete um.opponentHealth._preGameKeyStartersHealthy;
          appData.liveGameDay = null;
          um.opponentHealth.injuryReport = [];
          um.opponentHealth.keyStartersHealthy = [];
          um.opponentHealth.irReserve = [];
          um.opponentHealth.activeRoster = [];

          if (!isTbdOpponent) {
            const oppSlug = toEspnTeamSlugClient(oppAbbr);
            const [oppRosterRaw, oppDepthRaw, nextOppInjRaw] = await Promise.all([
              fetchCorsJson(`https://site.api.espn.com/apis/site/v2/sports/football/nfl/teams/${oppSlug}/roster`).catch(() => null),
              fetchCorsJson(`https://site.api.espn.com/apis/site/v2/sports/football/nfl/teams/${oppSlug}/depthcharts`).catch(() => null),
              oppAbbr !== initialOppAbbr
                ? fetchCorsJson(
                    `https://site.api.espn.com/apis/site/v2/sports/football/nfl/injuries?team=${encodeURIComponent(oppSlug)}`
                  ).catch(() => null)
                : Promise.resolve(oppInjuriesRaw)
            ]);
            if (nextOppInjRaw) oppInjuriesRaw = nextOppInjRaw;

            const { allStarterNames: oppStarterSet } = select22OffDefStartersFromDepthChart(
              oppDepthRaw?.depthchart || [],
              null,
              normPlayerNameKey
            );
            const oppDepthSlotMap = new Map();
            for (const dc of oppDepthRaw?.depthchart || []) {
              if (String(dc?.name || '').toLowerCase().includes('special')) continue;
              for (const [slotRaw, posObj] of Object.entries(dc?.positions || {})) {
                const slotUpper = String(slotRaw || '').trim().toUpperCase();
                if (/^(?:PK|K|P|LS|H|PR|KR)\b/.test(slotUpper)) continue;
                (posObj?.athletes || []).slice(0, 3).forEach((ath, idx) => {
                  const nk = normPlayerNameKey(ath?.displayName || ath?.fullName || '');
                  if (!nk || oppDepthSlotMap.has(nk)) return;
                  const lbl = /\d$/.test(slotUpper)
                    ? idx === 0
                      ? slotUpper
                      : `${slotUpper} (${idx + 1}nd)`
                    : idx === 0
                      ? /^(?:QB|RB|WR|TE)$/.test(slotUpper)
                        ? `${slotUpper}1`
                        : slotUpper
                      : `${slotUpper}${idx + 1}`;
                  oppDepthSlotMap.set(nk, lbl);
                });
              }
            }

            if (oppRosterRaw?.athletes?.length) {
              const activeOppList = extractActiveRosterFromEspnTeamRoster(oppRosterRaw, oppStarterSet).map(p => ({
                ...p,
                depthSlot: oppDepthSlotMap.get(normPlayerNameKey(p.name)) || null
              }));
              um.opponentHealth.activeRoster = activeOppList;
              const starterRolePrio = pos => (['QB', 'WR', 'RB', 'TE', 'DE', 'OLB', 'CB', 'DT', 'S'].includes(pos) ? 0 : 1);
              um.opponentHealth.keyStartersHealthy = activeOppList
                .filter(p => p.isStarter && p.unit !== 'Special Teams')
                .sort((a, b) => starterRolePrio(a.position) - starterRolePrio(b.position))
                .map(p => ({
                  ...p,
                  gameStatus: 'Active • Off Injury Report',
                  playProbabilityPct: 95,
                  playBadgeLabel: '95% • Full Go',
                  shortComment: 'Listed 1st-string on depth chart; active without game designation.'
                }));

              const irList = [];
              for (const grp of oppRosterRaw.athletes) {
                const gKey = String(grp.position || '');
                if (gKey !== 'injuredReserveOrOut' && gKey !== 'suspended') continue;
                for (const ath of grp.items || []) {
                  const nm = ath.fullName || ath.displayName || '';
                  if (!nm) continue;
                  const id = String(ath.id || '');
                  const hs = ath.headshot?.href || (/^\d+$/.test(id) ? `https://a.espncdn.com/i/headshots/nfl/players/full/${id}.png` : '');
                  irList.push({
                    name: nm,
                    position: ath.position?.abbreviation || 'ATH',
                    jersey: ath.jersey != null && ath.jersey !== '' ? Number(ath.jersey) : null,
                    headshotUrl: hs.startsWith('http://') ? `https://${hs.slice(7)}` : hs,
                    espnUrl: buildEspnPlayerUrl(id, nm),
                    status: gKey === 'suspended' ? 'Reserve / Suspended' : 'Injured Reserve',
                    injuryType: ath.injuries?.[0]?.details?.type || (gKey === 'suspended' ? 'League Suspension' : 'Injured Reserve'),
                    projectedReturnWeek: 'TBD',
                    playProbabilityPct: 0,
                    playBadgeLabel: gKey === 'suspended' ? '0% • Suspended' : '0% • IR'
                  });
                }
              }
              um.opponentHealth.irReserve = irList;
              um.opponentHealth.summary = computeTeamHealthSummary({
                injuryReport: um.opponentHealth.injuryReport || [],
                irReserve: irList,
                totalStarters: 22
              });
            }
          }
        }
      }

      // Always synchronize live in-game, final-score, flexed kickoff time, TBD, and season-concluded telemetry onto `upcomingMatchup`
      if (nextGame.id && !String(nextGame.id).startsWith('post_')) {
        um.gameId = nextGame.id;
      }
      if (nextGame.dateIso) {
        const nextMs = Date.parse(nextGame.dateIso);
        const prevUmMs = Date.parse(um.dateIso || um.kickoffIso || '');
        const flexedTime = Number.isFinite(nextMs) && (!Number.isFinite(prevUmMs) || Math.abs(nextMs - prevUmMs) >= 60_000);
        if (flexedTime || !um.dateIso || !um.kickoffIso) {
          um.dateIso = nextGame.dateIso;
          um.kickoffIso = nextGame.dateIso;
          const dtFlex = new Date(nextGame.dateIso);
          if (!Number.isNaN(dtFlex.getTime())) {
            um.kickoffDisplay = `${dtFlex.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'America/Los_Angeles' })} • ${dtFlex.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'America/Los_Angeles' })} PT (${nextGame.broadcast || 'NFL'})`;
          }
        }
      }
      const resolvedState = String(nextGame.statusState || (nextGame.completed ? 'post' : 'pre')).toLowerCase();
      um.liveState = resolvedState;
      um.isGameInProgress = resolvedState === 'in';
      um.completed = Boolean(nextGame.completed);
      if (nextGame.completedAt) um.completedAt = nextGame.completedAt;
      um.isTbd = isTbdOpponent;
      um.seasonConcluded = isSeasonConcluded;
      if (nextGame.statusDetail) {
        um.statusDetail = nextGame.statusDetail;
      }
      if (um.isGameInProgress || um.completed) {
        if (nextGame.sfScore != null) um.sfScore = Number(nextGame.sfScore);
        if (nextGame.oppScore != null) um.oppScore = Number(nextGame.oppScore);
        if (nextGame.result) um.result = nextGame.result;
      } else {
        um.sfScore = null;
        um.oppScore = null;
        um.result = null;
      }

      if (nextGame.id && !String(nextGame.id).startsWith('post_')) {
        const summaryRaw = await fetchCorsJson(
          `https://site.api.espn.com/apis/site/v2/sports/football/nfl/summary?event=${encodeURIComponent(nextGame.id)}`
        ).catch(() => null);
        const pc = summaryRaw?.pickcenter?.[0];
        if (pc && um.betting) {
          if (pc.details) um.betting.spread = pc.details;
          if (pc.overUnder) um.betting.overUnder = Number(pc.overUnder);
        }
        if (Array.isArray(summaryRaw?.news?.articles) && summaryRaw.news.articles.length > 0) {
          combinedEspnArticles = [...summaryRaw.news.articles, ...combinedEspnArticles];
        }
      }
    }
  }

  // 2b. Authoritative Active/Completed Game Participation (`didNotPlay`), Recap Story & Instant HD Highlight Clips
  const playedInCompletedGameIds = new Set();
  const dnpInCompletedGameIds = new Set();
  let latestCompletedKickoffMsForOverlay = null;
  let latestCompletedSchedGame = null;
  if (Array.isArray(appData.scheduleMatchup?.schedule)) {
    const nowOverlayMs = Date.now();
    const recentTargetGames = appData.scheduleMatchup.schedule
      .filter(g => {
        if (!g?.id || g.isByeWeek) return false;
        if (g.statusState === 'in') return true;
        if (!g.completed) return false;
        const ko = g.dateIso ? Date.parse(g.dateIso) : NaN;
        return Number.isFinite(ko) && ko <= nowOverlayMs + 6 * 3_600_000;
      })
      .sort((a, b) => (Date.parse(b.dateIso || '') || 0) - (Date.parse(a.dateIso || '') || 0));

    const targetGame = recentTargetGames[0] || null;
    if (targetGame?.completed) {
      latestCompletedSchedGame = targetGame;
      if (targetGame.dateIso) {
        const parsedKo = Date.parse(targetGame.dateIso);
        if (Number.isFinite(parsedKo)) latestCompletedKickoffMsForOverlay = parsedKo;
      }
    }

    if (
      targetGame?.id &&
      (targetGame.statusState === 'in' ||
        (latestCompletedKickoffMsForOverlay && nowOverlayMs - latestCompletedKickoffMsForOverlay <= 6.8 * 86_400_000))
    ) {
      const evIdEnc = encodeURIComponent(String(targetGame.id));
      const [compSummaryRaw, compCoreRosterRaw] = await Promise.all([
        fetchCorsJson(`https://site.api.espn.com/apis/site/v2/sports/football/nfl/summary?event=${evIdEnc}`).catch(
          () => null
        ),
        targetGame.completed
          ? fetchCorsJson(
              `https://sports.core.api.espn.com/v2/sports/football/leagues/nfl/events/${evIdEnc}/competitions/${evIdEnc}/competitors/25/roster`
            ).catch(() => null)
          : Promise.resolve(null)
      ]);

      if (targetGame.completed) {
        for (const entry of compCoreRosterRaw?.entries || []) {
          const pid = entry?.playerId != null ? String(entry.playerId) : '';
          if (!pid) continue;
          if (entry.didNotPlay === false) {
            playedInCompletedGameIds.add(pid);
          } else if (entry.didNotPlay === true) {
            dnpInCompletedGameIds.add(pid);
          }
        }
        const sfBox = (compSummaryRaw?.boxscore?.players || []).find(
          b => normalizeTeamAbbrClient(b?.team?.abbreviation || '') === 'SF'
        );
        for (const statGrp of sfBox?.statistics || []) {
          for (const athEntry of statGrp?.athletes || []) {
            const pid = athEntry?.athlete?.id != null ? String(athEntry.athlete.id) : '';
            if (pid) {
              playedInCompletedGameIds.add(pid);
              dnpInCompletedGameIds.delete(pid);
            }
          }
        }
        if (playedInCompletedGameIds.size > 0) {
          appData._livePlayedPlayerIds = [...playedInCompletedGameIds];
        }
        if (compSummaryRaw && appData.scheduleMatchup) {
          const parsedRecap = extractCompletedGameRecapSummary(compSummaryRaw, targetGame);
          if (parsedRecap) {
            appData.scheduleMatchup.lastCompletedGameRecap = parsedRecap;
            mutated = true;
          }
        }
      }

      if (compSummaryRaw?.article && compSummaryRaw.article.headline) {
        const recapArt = compSummaryRaw.article;
        const recapHref =
          recapArt.links?.web?.href ||
          `https://www.espn.com/nfl/recap/_/gameId/${encodeURIComponent(String(targetGame.id))}`;
        const recapDesc =
          recapArt.description ||
          appData.scheduleMatchup?.lastCompletedGameRecap?.recapLeadExcerpt ||
          '';
        combinedEspnArticles = [
          {
            id: recapArt.id || `recap_${targetGame.id}`,
            headline: recapArt.headline,
            description: recapDesc,
            published: recapArt.published || new Date().toISOString(),
            byline: recapArt.byline || 'ESPN / AP',
            images: recapArt.images || [],
            links: { web: { href: recapHref } }
          },
          ...combinedEspnArticles
        ];
      }
      if (Array.isArray(compSummaryRaw?.news?.articles) && compSummaryRaw.news.articles.length > 0) {
        combinedEspnArticles = [...compSummaryRaw.news.articles, ...combinedEspnArticles];
      }

      // Ingest instant ESPN HD 16x9 MP4 49ers game & player highlight clips (`summary.videos`) directly into rawStream!
      if (Array.isArray(compSummaryRaw?.videos) && compSummaryRaw.videos.length > 0 && Array.isArray(appData.news?.rawStream)) {
        const rosterPlayers = appData.roster?.players || [];
        const existingUrls = new Set(appData.news.rawStream.map(it => it.url).filter(Boolean));
        const existingStreams = new Set(appData.news.rawStream.map(it => it.videoStreamUrl).filter(Boolean));
        const oppNick = String(targetGame.opponent?.name || '').trim().split(/\s+/).pop() || '';
        const newHighlightClips = [];

        for (const vid of compSummaryRaw.videos) {
          const headline = cleanSensationalistText(vid?.headline || '');
          if (!headline) continue;
          const mp4Raw =
            vid?.links?.source?.HD?.href ||
            vid?.links?.source?.full?.href ||
            vid?.links?.source?.href ||
            '';
          const mp4Https = mp4Raw.startsWith('http://') ? `https://${mp4Raw.slice(7)}` : mp4Raw;
          const webRaw = vid?.links?.web?.href || '';
          const safeWeb = sanitizeExternalUrl(webRaw, mp4Https.startsWith('https://') ? mp4Https : null);
          if (!mp4Https.startsWith('https://') || !safeWeb) continue;
          if (existingUrls.has(safeWeb) || existingStreams.has(mp4Https)) continue;

          const vidFullText = `${headline} ${vid.description || ''}`;
          const mentioned = matchPlayersClient(vidFullText, rosterPlayers, 8);
          const teamVidRe = getTeamEntityRegex(appData);
          const mentionsTeamExplicitly =
            teamVidRe.test(vidFullText) ||
            (activeTeam.abbr === 'SF' &&
              /\b(purdy|mccaffrey|\bcmc\b|kittle|deebo|bosa|warner|lenoir|greenlaw|juszczyk|jennings|pearsall|pi[nñ]eiro)\b/i.test(
                vidFullText
              ));
          // Exclude opponent-TD celebration clips (e.g. "Dak Prescott lets it fly to George Pickens for a Cowboys TD")
          const isOpponentScoringClip =
            oppNick &&
            new RegExp(`\\bfor\\s+(?:a\\s+|their\\s+|an\\s+)?${escapeClientRegex(oppNick)}\\b`, 'i').test(headline) &&
            !teamVidRe.test(headline) &&
            mentioned.length === 0;
          if (isOpponentScoringClip || (!mentionsTeamExplicitly && mentioned.length === 0)) continue;

          const durNum = Number(vid.duration || 0);
          const durStr =
            durNum > 0
              ? `${Math.floor(durNum / 60)}:${String(Math.round(durNum % 60)).padStart(2, '0')}`
              : '';
          let thumbHttps = String(vid.thumbnail || '');
          if (thumbHttps.startsWith('http://')) thumbHttps = `https://${thumbHttps.slice(7)}`;
          const pubIso = vid.lastModified || vid.originalPublishDate || new Date().toISOString();

          existingUrls.add(safeWeb);
          existingStreams.add(mp4Https);
          newHighlightClips.push({
            id: `espn_hl_vid_${vid.id || hashWireKey(mp4Https)}`,
            type: 'video',
            title: headline,
            summary: cleanSensationalistText(vid.description || ''),
            videoStreamUrl: mp4Https,
            isHighlightClip: true,
            duration: durStr,
            embeddable: true,
            imageUrl: thumbHttps.startsWith('https://') ? thumbHttps : '',
            imageAlt: headline,
            mentionedPlayers: mentioned,
            publishedAt: pubIso,
            url: safeWeb,
            outletId: 'espn',
            outletName: 'ESPN',
            reporterId: null,
            reporterName: 'ESPN Game Highlights',
            author: 'ESPN',
            authorHandle: '@ESPNNFL',
            authorProfileUrl: 'https://x.com/ESPNNFL',
            trustTier: 1,
            wireSource: 'espn_live_highlights',
            isBreaking: false,
            isInGameInjury: false,
            breakingBadge: null,
            breakingPriority: 0,
            category: 'beat',
            signalScore: 90,
            fluffScore: 0,
            isClickbait: false
          });
        }

        if (newHighlightClips.length > 0) {
          appData.news.rawStream = sortNewsWithBreakingPriority(
            dedupeRawStreamAtomically([...newHighlightClips, ...appData.news.rawStream]),
            Date.now(),
            { appData }
          );
          mutated = true;
        }
      }
    }
  }

  // 3. Re-run 10,000-trial Playoff Monte Carlo if standings or completed games changed
  if (standingsOrScoresChanged && appData.seasonal?.playoffPicture?.simulatorInputs) {
    try {
      const simIn = appData.seasonal.playoffPicture.simulatorInputs;
      let prunedRemainingCount = 0;
      // Ensure newly completed SF regular-season schedule games are moved out of remainingGames so SF never exceeds 17 games
      const completedSfWeeks = new Set(
        (appData.scheduleMatchup?.schedule || [])
          .filter(g => g.completed && (g.seasonType || 'REG') === 'REG' && Number(g.week) >= 1 && Number(g.week) <= 18)
          .map(g => Number(g.week))
      );
      if (Array.isArray(simIn.remainingGames) && completedSfWeeks.size > 0) {
        const newlyDone = simIn.remainingGames.filter(
          rg => (rg.home === 'SF' || rg.away === 'SF') && completedSfWeeks.has(Number(rg.week))
        );
        if (newlyDone.length > 0) {
          prunedRemainingCount += newlyDone.length;
          simIn.remainingGames = simIn.remainingGames.filter(
            rg => !((rg.home === 'SF' || rg.away === 'SF') && completedSfWeeks.has(Number(rg.week)))
          );
          for (const nd of newlyDone) {
            const schedItem = (appData.scheduleMatchup?.schedule || []).find(
              s => (s.seasonType || 'REG') === 'REG' && Number(s.week) === Number(nd.week)
            );
            if (schedItem && schedItem.sfScore != null && schedItem.oppScore != null) {
              const homeScore = nd.home === 'SF' ? Number(schedItem.sfScore) : Number(schedItem.oppScore);
              const awayScore = nd.home === 'SF' ? Number(schedItem.oppScore) : Number(schedItem.sfScore);
              simIn.completedGames = [
                ...(simIn.completedGames || []),
                { id: nd.id, week: nd.week, home: nd.home, away: nd.away, homeScore, awayScore }
              ];
            }
          }
        }
      }

      // Also prune newly completed non-SF NFL games when live standings advance so no rival team simulates 18 games
      if (Array.isArray(simIn.remainingGames) && simIn.remainingGames.length > 0) {
        const playedCountByAbbr = new Map();
        for (const nt of simIn.nfcTeams || []) {
          const ab = normalizeTeamAbbrClient(nt.abbr);
          playedCountByAbbr.set(ab, (Number(nt.wins) || 0) + (Number(nt.losses) || 0) + (Number(nt.ties) || 0));
        }
        for (const [ab, st] of Object.entries(simIn.afcStandings || {})) {
          playedCountByAbbr.set(
            normalizeTeamAbbrClient(ab),
            (Number(st.wins) || 0) + (Number(st.losses) || 0) + (Number(st.ties) || 0)
          );
        }
        const remCountByAbbr = new Map();
        for (const rg of simIn.remainingGames) {
          const h = normalizeTeamAbbrClient(rg.home);
          const a = normalizeTeamAbbrClient(rg.away);
          remCountByAbbr.set(h, (remCountByAbbr.get(h) || 0) + 1);
          remCountByAbbr.set(a, (remCountByAbbr.get(a) || 0) + 1);
        }
        const excessByAbbr = new Map();
        for (const [ab, played] of playedCountByAbbr.entries()) {
          const excess = played + (remCountByAbbr.get(ab) || 0) - 17;
          if (excess > 0) excessByAbbr.set(ab, excess);
        }
        if (excessByAbbr.size > 0) {
          const sortedRem = [...simIn.remainingGames].sort((a, b) => Number(a.week || 0) - Number(b.week || 0));
          const kept = [];
          for (const rg of sortedRem) {
            const h = normalizeTeamAbbrClient(rg.home);
            const a = normalizeTeamAbbrClient(rg.away);
            const exH = excessByAbbr.get(h) || 0;
            const exA = excessByAbbr.get(a) || 0;
            const bothExceeded = exH > 0 && exA > 0;
            const singleMockExceeded =
              (exH > 0 && !playedCountByAbbr.has(a)) || (exA > 0 && !playedCountByAbbr.has(h));
            if (bothExceeded || singleMockExceeded) {
              if (exH > 0) excessByAbbr.set(h, exH - 1);
              if (exA > 0) excessByAbbr.set(a, exA - 1);
              prunedRemainingCount++;
            } else {
              kept.push(rg);
            }
          }
          simIn.remainingGames = kept;
        }
      }

      const freshMc = runPlayoffMonteCarlo({
        ...simIn,
        targetTeam: activeTeam.abbr,
        conference: activeTeam.conference,
        iterations: 10000,
        seed: 492026
      });
      if (freshMc?.sfOdds) {
        appData.seasonal.playoffPicture.baselineSimulation = freshMc;
        if (Array.isArray(appData.seasonal.playoffPicture.seedPathCards)) {
          const sf = freshMc.sfOdds;
          for (const card of appData.seasonal.playoffPicture.seedPathCards) {
            if (/bye|#1\s*seed/i.test(card.target)) {
              card.currentProbPct = sf.seed1ByePct;
            } else if (/division|nfc\s*west/i.test(card.target)) {
              card.currentProbPct = sf.winDivisionPct;
            } else if (/playoff\s*berth|make\s*playoffs|seeds\s*#1/i.test(card.target)) {
              card.currentProbPct = sf.makePlayoffsPct;
            } else if (/wild\s*card/i.test(card.target)) {
              card.currentProbPct = sf.wildCardPct;
            }
          }
        }
        if (prunedRemainingCount > 0 && Array.isArray(appData.seasonal.playoffPicture.rootingLeverage)) {
          appData.seasonal.playoffPicture.rootingLeverage = computeRootingGuideLeverage(simIn, 12).map(g => ({
            ...g,
            awayLogoUrl: g.awayLogoUrl || buildEspnTeamLogoUrl(g.away),
            homeLogoUrl: g.homeLogoUrl || buildEspnTeamLogoUrl(g.home)
          }));
        }
      }
    } catch {
      // Keep baseline simulation on error
    }
  }

  // 4. Live ESPN Injury Designations (49ers + Upcoming Opponent — ~277 KB per team instead of 8.76 MB league-wide)
  const earlyWeekBlankPractice = isBeforeWeeklyPracticeWindow(nextGameKickoffIso);
  const activeOppAbbr = normalizeTeamAbbrClient(appData.scheduleMatchup.upcomingMatchup?.oppAbbr || '');
  const activeOppName = appData.scheduleMatchup.upcomingMatchup?.oppName || '';
  const sfTeamInj = extractTeamInjuriesFromEspnPayload(sfInjuriesRaw, { isSf: true });
  const oppTeamInj =
    activeOppAbbr && activeOppAbbr !== 'TBD' && activeOppAbbr !== 'BYE'
      ? extractTeamInjuriesFromEspnPayload(oppInjuriesRaw || sfInjuriesRaw, {
          isSf: false,
          oppAbbr: activeOppAbbr,
          oppName: activeOppName
        })
      : null;

  const espnLiveDesignatedSfKeys = new Set();
  if (sfTeamInj?.injuries || oppTeamInj?.injuries) {

    if (sfTeamInj?.injuries && Array.isArray(appData.roster?.players)) {
      const rosterByNorm = new Map(appData.roster.players.map(p => [normPlayerNameKey(p.name), p]));
      for (const item of sfTeamInj.injuries) {
        const stL = String(item?.status || '').trim().toLowerCase();
        if (['out', 'doubtful', 'questionable'].includes(stL)) {
          const ck = canonicalInjuryPlayerKey(item?.athlete?.displayName || '');
          if (ck) espnLiveDesignatedSfKeys.add(ck);
        }
      }
      const sfRosterNamesForSig = appData.roster.players.map(p => p?.name).filter(Boolean);
      const postKoSigCache = new Map();
      const completedGameEndMsForSig = Number.isFinite(latestCompletedKickoffMsForOverlay)
        ? latestCompletedKickoffMsForOverlay + 3 * 3_600_000
        : 0;
      const resolvePostKickoffWireInjuryForPlayer = playerObj => {
        if (!latestCompletedKickoffMsForOverlay || !playerObj?.name) return null;
        const cacheKey = String(playerObj.id || playerObj.name);
        if (postKoSigCache.has(cacheKey)) return postKoSigCache.get(cacheKey);
        const priorWkNum = latestCompletedSchedGame?.week ? Number(latestCompletedSchedGame.week) : null;
        const priorHist = priorWkNum
          ? (playerObj.health?.weeklyHistory2026 || []).find(h => Number(h?.week) === priorWkNum) || null
          : null;
        const pool = [
          ...(Array.isArray(appData.news?.rawStream) ? appData.news.rawStream : []),
          ...(Array.isArray(playerObj.recentNews) ? playerObj.recentNews : [])
        ];
        const sig = evaluateCorroboratedNewsInjurySignal({
          playerName: playerObj.name,
          playerId: playerObj.id,
          rosterBucket: playerObj.rosterBucket || 'active',
          newsItems: pool,
          rosterPlayerNames: sfRosterNamesForSig,
          nowMs: Date.now(),
          windowStartMs: completedGameEndMsForSig,
          lastCompletedGameKickoffMs: latestCompletedKickoffMsForOverlay,
          lastCompletedWeek: priorWkNum,
          priorWeekInjuryType: priorHist?.injury || ''
        });
        postKoSigCache.set(cacheKey, sig);
        return sig;
      };

      // When rolling over to a new upcoming week (before Wednesday practice), drop prior-week cleared / Vet Rest entries
      if (weekAdvancedFlag || earlyWeekBlankPractice) {
        if (appData.health) {
          appData.health._hasLiveOfficialCurrentWeekSfReport = false;
        }
        const liveInjuredKeys = new Set();
        for (const item of sfTeamInj.injuries) {
          const nm = item.athlete?.displayName || '';
          const k = normPlayerNameKey(nm);
          const stL = String(item.status || '').toLowerCase();
          const bPart = item.details?.type || extractBodyPartSafe(item.shortComment || '') || '';
          const isRest = /not injury related|nir\s*-?\s*rest|\brest\b|coach'?s decision|healthy scratch/i.test(bPart);
          if (k && !isRest && (['out', 'doubtful', 'questionable'].includes(stL) || Boolean(bPart))) {
            liveInjuredKeys.add(k);
          }
        }
        for (const p of appData.roster.players) {
          if (!p?.health) continue;
          const k = normPlayerNameKey(p.name);
          const wasVetRest =
            p.health.wed === 'Vet Rest' ||
            /not injury related|nir\s*-?\s*rest|\brest\b|coach'?s decision|healthy scratch/i.test(p.health.injuryType || '');
          if (earlyWeekBlankPractice) {
            p.health.wed = '-';
            p.health.thu = '-';
            p.health.fri = '-';
          }
          if (p.rosterBucket === 'active' && !liveInjuredKeys.has(k)) {
            const postKoNotInEspn = resolvePostKickoffWireInjuryForPlayer(p);
            const hasSustainedWireInjury =
              Boolean(p.health.sustainedInLastGame || p.health.isInGameInjury) ||
              Boolean(
                postKoNotInEspn?.hasSignal &&
                  postKoNotInEspn.confidence >= 0.42 &&
                  (postKoNotInEspn.signalType === 'SUSTAINED_IN_GAME_INJURY' || postKoNotInEspn.direction < 0)
              );
            if (hasSustainedWireInjury) {
              continue;
            }
            const hasActiveDesig = ['out', 'doubtful', 'questionable'].includes(
              String(p.health.status || '').toLowerCase()
            );
            if (weekAdvancedFlag || wasVetRest || !hasActiveDesig) {
              p.health.isOnPracticeReport = false;
              p.health.status = 'Active';
              p.health.injuryType = '';
              p.health.playProbabilityPct = 95;
              p.health.playTier = 'ACTIVE';
              p.health.playBadgeLabel = '95% • Full Go';
            }
          }
        }
      }

      for (const item of sfTeamInj.injuries) {
        const nm = item.athlete?.displayName || '';
        const rp = rosterByNorm.get(normPlayerNameKey(nm));
        if (!rp || !rp.health) continue;
        const rawStatus = item.status || rp.health.status || 'Active';
        const rawLower = rawStatus.toLowerCase();
        const rawShortIn = cleanSensationalistText(item.shortComment || '');
        const rawLongField = cleanSensationalistText(item.longComment || '');
        const rawLongIn = rawLongField || rawShortIn;
        const freshShortProvided = !isBareStatusPlaceholderComment(rawShortIn);
        const shortC = pickMeaningfulInjuryComment(rawShortIn, rp.health.shortComment);
        const longC =
          freshShortProvided && isBareStatusPlaceholderComment(rawLongField)
            ? rawShortIn
            : pickMeaningfulInjuryComment(rawLongIn, rp.health.longComment, shortC);
        const combinedText = `${shortC} ${longC}`.trim();
        const postKoSig = earlyWeekBlankPractice ? resolvePostKickoffWireInjuryForPlayer(rp) : null;
        const hasPostKickoffInjurySignal = Boolean(
          postKoSig?.hasSignal &&
            postKoSig.confidence >= 0.42 &&
            (postKoSig.signalType === 'SUSTAINED_IN_GAME_INJURY' || postKoSig.direction < 0)
        );
        const bodyPart =
          item.details?.type ||
          extractBodyPartSafe(shortC) ||
          (hasPostKickoffInjurySignal ? postKoSig.inferredInjuryType : '') ||
          rp.health.injuryType ||
          '';
        const fantasyAbbr = item.details?.fantasyStatus?.abbreviation || rp.health.fantasyStatusAbbr || '';
        const pidStr = String(rp.id || '');
        const playedInCompletedGame = playedInCompletedGameIds.has(pidStr)
          ? true
          : dnpInCompletedGameIds.has(pidStr) &&
              (Boolean(rp.health.isOnPracticeReport) || ['out', 'doubtful', 'questionable'].includes(rawLower))
            ? false
            : null;
        const blurbDateIso = item.date || item.notes?.items?.[0]?.date || rp.health.blurbDateIso || null;
        const sfEarlyRoll =
          earlyWeekBlankPractice && rp.rosterBucket === 'active'
            ? resolveEarlyWeekRolloverInput({
                playerName: rp.name,
                rawStatus,
                injuryType: bodyPart,
                shortComment: freshShortProvided ? rawShortIn : shortC,
                longComment: !isBareStatusPlaceholderComment(rawLongField) ? rawLongField : longC,
                upcomingWeek: appData.scheduleMatchup.upcomingMatchup?.week,
                lastCompletedWeek: latestCompletedSchedGame?.week || null,
                blurbDateIso,
                lastCompletedGameKickoffMs: latestCompletedKickoffMsForOverlay,
                playedInCompletedGame,
                hasPostKickoffInjurySignal,
                postKickoffInjuryNote: postKoSig?.leadClause || ''
              })
            : null;
        if (sfEarlyRoll?.skip) {
          rp.health.isOnPracticeReport = false;
          rp.health.status = 'Active';
          rp.health.injuryType = '';
          rp.health.shortComment = '';
          rp.health.longComment = '';
          rp.health.playProbabilityPct = 95;
          rp.health.playTier = 'ACTIVE';
          rp.health.playBadgeLabel = '95% • Full Go';
          rp.health.factors = [];
          continue;
        }
        if (blurbDateIso) rp.health.blurbDateIso = blurbDateIso;

        if (
          rp.rosterBucket === 'ir' &&
          !rp.health.isSeasonEnding &&
          String(fantasyAbbr).toUpperCase() !== 'RESERVE-EX' &&
          (rp.health.isPracticeWindowOpen ||
            /\b(?:21-day\s+practice\s+window\s+opened|opened\s+(?:the\s+|his\s+|[a-z']+s?\s+)?(?:21-day\s+|injured\s+reserve\s+|ir\s+)?practice\s+window)\b/i.test(
              combinedText
            )) &&
          !/\bnot\s+(?:yet\s+)?ready\s+to\s+return\s+to\s+practice\b/i.test(combinedText)
        ) {
          rp.health.isPracticeWindowOpen = true;
          if (weekAdvancedFlag && appData.scheduleMatchup.upcomingMatchup?.week) {
            rp.health.projectedReturnWeek = `Week ${appData.scheduleMatchup.upcomingMatchup.week} Activation Window`;
          }
        }

        const isIrReturnQ =
          rp.rosterBucket === 'ir' &&
          !rp.health.isSeasonEnding &&
          String(fantasyAbbr).toUpperCase() !== 'RESERVE-EX' &&
          /(listed as questionable|questionable for sunday|likely will be activated|expected to be activated)/i.test(
            combinedText
          );

        const hasExplicitGameDesignation = ['out', 'doubtful', 'questionable'].includes(rawLower);
        const hasEarlyWeekSustainedInjury = earlyWeekBlankPractice && Boolean(bodyPart) && !sfEarlyRoll?.skip;
        const wasOnOfficialReport = Boolean(rp.health.isOnPracticeReport) && !weekAdvancedFlag;

        if (
          rp.rosterBucket === 'active' &&
          !wasOnOfficialReport &&
          !hasExplicitGameDesignation &&
          !hasEarlyWeekSustainedInjury
        ) {
          continue;
        }

        if (earlyWeekBlankPractice) {
          rp.health.wed = '-';
          rp.health.thu = '-';
          rp.health.fri = '-';
        } else if (rp.rosterBucket === 'active' || isIrReturnQ || rp.health.isPracticeWindowOpen) {
          const freshProseText = `${!isBareStatusPlaceholderComment(rawShortIn) ? rawShortIn : ''} ${!isBareStatusPlaceholderComment(rawLongIn) ? rawLongIn : ''}`.trim();
          if (freshProseText) {
            const parsedDays = extractPracticeDaysFromText({
              statusRaw: rawStatus,
              injuryType: bodyPart,
              shortComment: !isBareStatusPlaceholderComment(rawShortIn) ? rawShortIn : '',
              longComment: !isBareStatusPlaceholderComment(rawLongIn) ? rawLongIn : '',
              kickoffIso: nextGameKickoffIso,
              allowHeuristicFill: false
            });
            if ((!rp.health.wed || rp.health.wed === '-') && parsedDays.wed && parsedDays.wed !== '-') {
              rp.health.wed = parsedDays.wed;
            }
            if ((!rp.health.thu || rp.health.thu === '-') && parsedDays.thu && parsedDays.thu !== '-') {
              rp.health.thu = parsedDays.thu;
            }
            if ((!rp.health.fri || rp.health.fri === '-') && parsedDays.fri && parsedDays.fri !== '-') {
              rp.health.fri = parsedDays.fri;
            }
          }
        }

        const effectiveStatusForModel = isIrReturnQ
          ? 'Questionable'
          : rp.rosterBucket === 'ir' || rp.rosterBucket === 'suspended'
            ? rp.health.status || rawStatus
            : sfEarlyRoll
              ? sfEarlyRoll.effectiveStatus
              : hasExplicitGameDesignation
                ? rawStatus
                : hasEarlyWeekSustainedInjury
                  ? 'Questionable'
                  : rp.health.status || rawStatus;

        const playProb = computePlayerPlayProbability({
          name: rp.name,
          position: rp.position,
          experienceYears: rp.experienceYears ?? null,
          snapPct: rp.primarySnapPct ?? null,
          rosterBucket: rp.rosterBucket,
          isSeasonEnding: Boolean(rp.health.isSeasonEnding),
          isPracticeWindowOpen: Boolean(rp.health.isPracticeWindowOpen),
          designatedDateIso: rp.health.designatedDateIso || '',
          kickoffIso: nextGameKickoffIso,
          schedule: appData.scheduleMatchup?.schedule || [],
          upcomingOppName: appData.scheduleMatchup.upcomingMatchup?.oppName || '',
          upcomingOppAbbr: appData.scheduleMatchup.upcomingMatchup?.oppAbbr || '',
          blurbDateIso,
          lastCompletedGameKickoffMs: latestCompletedKickoffMsForOverlay,
          fantasyStatusAbbr: fantasyAbbr,
          gameStatus: effectiveStatusForModel,
          priorWeekStatus: rawStatus,
          missedPriorGame: sfEarlyRoll
            ? sfEarlyRoll.missedPriorGameKnown
              ? sfEarlyRoll.missedPriorGame
              : undefined
            : undefined,
          priorWeekPracticed: sfEarlyRoll ? sfEarlyRoll.priorWeekPracticed : undefined,
          sustainedInLastGame: sfEarlyRoll?.missedPriorGame
            ? false
            : Boolean(sfEarlyRoll?.sustainedInLastGame || rp.health.sustainedInLastGame),
          exitedPriorGameWithoutReturn: sfEarlyRoll?.missedPriorGame
            ? false
            : Boolean(
                sfEarlyRoll?.exitedWithoutReturn || postKoSig?.exitedWithoutReturn || rp.health.exitedPriorGameWithoutReturn
              ),
          weeklyHistory: rp.health.weeklyHistory2026 || [],
          currentWeek: appData.scheduleMatchup.upcomingMatchup?.week,
          byeWeek: appData.health?.byeWeek || 8,
          isIrReturnQuestionable: isIrReturnQ,
          injuryType: bodyPart,
          wed: rp.health.wed,
          thu: rp.health.thu,
          fri: rp.health.fri,
          beatNote: sfEarlyRoll ? sfEarlyRoll.beatNoteForModel : combinedText
        });

        // Preserve authoritative IR sub-status ('Season-Ending IR', 'IR — 21-Day Window Open', 'Reserve / PUP', 'Reserve / Roster Exemption', etc.)
        if (rp.rosterBucket === 'active') {
          rp.health.status = sfEarlyRoll
            ? sfEarlyRoll.effectiveStatus
            : hasExplicitGameDesignation
              ? rawStatus
              : hasEarlyWeekSustainedInjury
                ? 'Questionable'
                : rp.health.status;
        } else if (isIrReturnQ && playProb.probabilityPct > 0) {
          rp.health.status = 'Questionable (IR Return Window)';
        } else if (rp.rosterBucket === 'ir' && rp.health.isPracticeWindowOpen) {
          rp.health.status = 'IR — 21-Day Window Open';
        }
        if (fantasyAbbr) rp.health.fantasyStatusAbbr = fantasyAbbr;
        if (bodyPart && (rp.rosterBucket === 'active' || !rp.health.injuryType || rp.health.injuryType === 'Undisclosed')) {
          rp.health.injuryType = bodyPart;
        }
        if (sfEarlyRoll?.missedPriorGame) {
          rp.health.sustainedInLastGame = false;
          rp.health.exitedPriorGameWithoutReturn = false;
        } else if (hasPostKickoffInjurySignal) {
          rp.health.sustainedInLastGame = true;
          if (postKoSig?.exitedWithoutReturn) rp.health.exitedPriorGameWithoutReturn = true;
        }
        const stalePregameClearanceInEspn =
          hasPostKickoffInjurySignal &&
          /\b(is active for (?:sunday|monday|thursday|saturday)|given the green light to play|cleared by medical staff to play)\b/i.test(
            combinedText
          );
        if (stalePregameClearanceInEspn && postKoSig?.leadClause) {
          rp.health.shortComment = postKoSig.leadClause;
          rp.health.longComment = postKoSig.leadClause;
        } else {
          if (shortC && !isBareStatusPlaceholderComment(shortC)) rp.health.shortComment = shortC;
          if (longC && !isBareStatusPlaceholderComment(longC)) rp.health.longComment = longC;
        }
        rp.health.playProbabilityPct = playProb.probabilityPct;
        rp.health.playTier = playProb.tier;
        rp.health.playBadgeLabel = playProb.badgeLabel;
        rp.health.factors = playProb.factors;
        rp.health.isOnPracticeReport =
          (rp.rosterBucket === 'active' &&
            (wasOnOfficialReport || hasExplicitGameDesignation || hasEarlyWeekSustainedInjury)) ||
          Boolean(rp.rosterBucket === 'ir' && rp.health.isPracticeWindowOpen && playProb.probabilityPct > 0);
      }

      if (appData.health) {
        appData.health.practiceReport = appData.roster.players
          .filter(p => p.health?.isOnPracticeReport)
          .sort((a, b) => a.health.playProbabilityPct - b.health.playProbabilityPct || (b.capHit2026 || 0) - (a.capHit2026 || 0))
          .map(p => ({
            playerId: p.id,
            name: p.name,
            position: p.position,
            jersey: p.jersey,
            headshotUrl: p.headshotUrl || '',
            rosterBucket: p.rosterBucket || 'active',
            isIrReturnWindow: p.rosterBucket === 'ir' && Boolean(p.health.isPracticeWindowOpen),
            wed: earlyWeekBlankPractice ? '-' : p.health.wed || '-',
            thu: earlyWeekBlankPractice ? '-' : p.health.thu || '-',
            fri: earlyWeekBlankPractice ? '-' : p.health.fri || '-',
            injuryType: p.health.injuryType || 'Cleared — No Designation',
            gameStatus: p.health.status,
            playProbabilityPct: p.health.playProbabilityPct,
            playBadgeLabel: p.health.playBadgeLabel,
            archetypeNote: p.health.archetypeNote || '',
            factors: p.health.factors || [],
            beatComment: pickMeaningfulInjuryComment(p.health.longComment, p.health.shortComment, p.health.irBeatNote)
          }));
        if (Array.isArray(appData.health._preGamePracticeReport)) {
          appData.health._preGamePracticeReport = mergeNonDestructivePreGameRows(
            appData.health._preGamePracticeReport,
            appData.health.practiceReport
          );
        }
      }
      mutated = true;
    }

    if (oppTeamInj?.injuries && appData.scheduleMatchup.upcomingMatchup?.opponentHealth) {
      const oh = appData.scheduleMatchup.upcomingMatchup.opponentHealth;
      const existingReportByKey = new Map(
        (oh.injuryReport || [])
          .filter(p => {
            if (!earlyWeekBlankPractice && !weekAdvancedFlag) return true;
            const stL = String(p.preGameStatus || p.gameStatus || '').toLowerCase();
            const injL = String(p.injuryType || '').toLowerCase();
            if (/not injury related|nir\s*-?\s*rest|\brest\b/i.test(injL) || p.wed === 'Vet Rest') return false;
            return ['out', 'inactive', 'doubtful', 'questionable'].includes(stL) || Boolean(p.isIrReturnQuestionable);
          })
          .map(p => [
            normPlayerNameKey(p.name),
            earlyWeekBlankPractice ? { ...p, wed: '-', thu: '-', fri: '-' } : p
          ])
      );
      const prevByName = new Map(
        [
          ...(oh.activeRoster || []),
          ...(oh.injuryReport || []),
          ...(oh.keyStartersHealthy || []),
          ...(oh.irReserve || [])
        ].map(p => [normPlayerNameKey(p.name), p])
      );
      const mergedByKey = new Map(existingReportByKey);

      for (const item of oppTeamInj.injuries) {
        const ath = item.athlete || {};
        const nm = ath.displayName || '';
        const nKey = normPlayerNameKey(nm);
        if (!nKey) continue;
        const prevEntry = prevByName.get(nKey) || null;
        const existingRep = existingReportByKey.get(nKey) || null;
        const rawSt = item.status || 'Active';
        const stLower = rawSt.toLowerCase();
        const rawOppShort = cleanSensationalistText(item.shortComment || '');
        const rawOppLong = cleanSensationalistText(item.longComment || rawOppShort);
        const shortC = pickMeaningfulInjuryComment(rawOppShort, existingRep?.shortComment);
        const longC = pickMeaningfulInjuryComment(rawOppLong, existingRep?.longComment, shortC);
        const combinedLower = `${shortC} ${longC}`.toLowerCase();
        const isIrRetQ =
          stLower.includes('injured reserve') &&
          /listed as questionable|questionable for sunday|questionable ahead of|expected to be activated|likely will be activated/i.test(
            combinedLower
          ) &&
          !/not activated|didn't activate|did not activate|remains on injured reserve|ruled out|will miss/i.test(
            combinedLower
          );
        if (stLower.includes('injured reserve') && !isIrRetQ) continue;

        const bodyPart = item.details?.type || extractBodyPartSafe(shortC) || existingRep?.injuryType || prevEntry?.injuryType || '';
        const oppEarlyRoll =
          earlyWeekBlankPractice && !isIrRetQ
            ? resolveEarlyWeekRolloverInput({
                playerName: nm,
                rawStatus: rawSt,
                injuryType: bodyPart,
                shortComment: !isBareStatusPlaceholderComment(rawOppShort) ? rawOppShort : shortC,
                longComment: !isBareStatusPlaceholderComment(rawOppLong) ? rawOppLong : longC,
                upcomingWeek: appData.scheduleMatchup.upcomingMatchup?.week,
                lastCompletedWeek: latestCompletedSchedGame?.week || null,
                blurbDateIso: item.date || item.notes?.items?.[0]?.date || null,
                lastCompletedGameKickoffMs: latestCompletedKickoffMsForOverlay
              })
            : null;
        if (oppEarlyRoll?.skip) {
          mergedByKey.delete(nKey);
          continue;
        }

        const isReportWorthy =
          Boolean(existingRep) ||
          isIrRetQ ||
          ['out', 'doubtful', 'questionable'].includes(stLower) ||
          (earlyWeekBlankPractice && Boolean(bodyPart) && !oppEarlyRoll?.skip) ||
          (existingReportByKey.size === 0 &&
            Boolean(bodyPart) &&
            /(designation|questionable|ruled out|will miss|doubtful)/i.test(shortC));
        if (!isReportWorthy) continue;

        const headshot = ath.headshot?.href || prevEntry?.headshotUrl || '';
        const espnIdM = headshot.match(/\/(\d+)\.png/);
        const espnId = String(ath.id || (espnIdM ? espnIdM[1] : '') || '');
        const freshOppProse = `${!isBareStatusPlaceholderComment(rawOppShort) ? rawOppShort : ''} ${
          !isBareStatusPlaceholderComment(rawOppLong) ? rawOppLong : ''
        }`.trim();
        const parsedOppDays =
          !earlyWeekBlankPractice && (freshOppProse || !existingRep)
            ? extractPracticeDaysFromText({
                statusRaw: isIrRetQ ? 'Questionable' : rawSt,
                injuryType: bodyPart,
                shortComment: !isBareStatusPlaceholderComment(rawOppShort) ? rawOppShort : shortC,
                longComment: !isBareStatusPlaceholderComment(rawOppLong) ? rawOppLong : longC,
                kickoffIso: nextGameKickoffIso,
                allowHeuristicFill: false
              })
            : { wed: '-', thu: '-', fri: '-' };
        const { wed, thu, fri } = earlyWeekBlankPractice
          ? { wed: '-', thu: '-', fri: '-' }
          : {
              wed: existingRep?.wed && existingRep.wed !== '-' ? existingRep.wed : parsedOppDays.wed,
              thu: existingRep?.thu && existingRep.thu !== '-' ? existingRep.thu : parsedOppDays.thu,
              fri: existingRep?.fri && existingRep.fri !== '-' ? existingRep.fri : parsedOppDays.fri
            };
        const effectiveOppGameSt = isIrRetQ
          ? 'Questionable'
          : oppEarlyRoll
            ? oppEarlyRoll.effectiveStatus
            : ['out', 'doubtful', 'questionable'].includes(stLower)
              ? rawSt
              : earlyWeekBlankPractice && Boolean(bodyPart)
                ? 'Questionable'
                : existingRep?.gameStatus && ['Out', 'Doubtful', 'Questionable'].includes(existingRep.gameStatus)
                  ? existingRep.gameStatus
                  : rawSt;

        const prob = computePlayerPlayProbability({
          name: nm,
          position: ath.position?.abbreviation || prevEntry?.position || 'ATH',
          snapPct: prevEntry?.snapPct ?? null,
          gameStatus: effectiveOppGameSt,
          priorWeekStatus: rawSt,
          missedPriorGame: oppEarlyRoll
            ? oppEarlyRoll.missedPriorGameKnown
              ? oppEarlyRoll.missedPriorGame
              : undefined
            : undefined,
          priorWeekPracticed: oppEarlyRoll ? oppEarlyRoll.priorWeekPracticed : undefined,
          sustainedInLastGame: oppEarlyRoll ? Boolean(oppEarlyRoll.sustainedInLastGame) : undefined,
          exitedPriorGameWithoutReturn: oppEarlyRoll ? Boolean(oppEarlyRoll.exitedWithoutReturn) : undefined,
          rosterBucket: isIrRetQ ? 'ir' : 'active',
          injuryType: bodyPart,
          wed,
          thu,
          fri,
          beatNote: oppEarlyRoll ? oppEarlyRoll.beatNoteForModel : `${shortC} ${longC}`
        });

        mergedByKey.set(nKey, {
          name: existingRep?.name || nm,
          position: ath.position?.abbreviation || prevEntry?.position || 'ATH',
          unit: prevEntry?.unit || classifyRosterUnit(ath.position?.abbreviation || prevEntry?.position || '', ''),
          jersey: prevEntry?.jersey ?? null,
          headshotUrl: headshot.startsWith('http://') ? `https://${headshot.slice(7)}` : headshot,
          espnUrl: prevEntry?.espnUrl || buildEspnPlayerUrl(espnId, nm),
          snapPct: prevEntry?.snapPct ?? null,
          wed,
          thu,
          fri,
          injuryType: bodyPart || 'Undisclosed',
          gameStatus: isIrRetQ
            ? 'IR Return Window (Q)'
            : effectiveOppGameSt.toLowerCase() === 'active'
              ? 'No Designation (Cleared)'
              : effectiveOppGameSt,
          shortComment: shortC || existingRep?.shortComment || '',
          longComment: longC || existingRep?.longComment || '',
          isStarter: Boolean(prevEntry?.isStarter),
          isIrReturnQuestionable: isIrRetQ,
          playProbabilityPct: prob.probabilityPct,
          playTier: prob.tier,
          playBadgeLabel: prob.badgeLabel,
          factors: prob.factors || [],
          archetypeNote: prob.priorUsed?.archetypeNote || ''
        });
      }
      const liveOppReport = [...mergedByKey.values()];
      if (liveOppReport.length > 0 || weekAdvancedFlag) {
        liveOppReport.sort((a, b) => a.playProbabilityPct - b.playProbabilityPct);
        oh.injuryReport = liveOppReport;
        if (Array.isArray(oh._preGameInjuryReport)) {
          oh._preGameInjuryReport = mergeNonDestructivePreGameRows(oh._preGameInjuryReport, liveOppReport);
        }
        oh.summary = computeTeamHealthSummary({
          injuryReport: liveOppReport,
          irReserve: oh.irReserve || [],
          totalStarters: oh.summary?.totalStarters || 22
        });
        mutated = true;
      }
    }
  }

  // 4b. Authoritative Live 49ers.com Weekly Practice & Injury Report Reconciliation (SF + Opponent)
  if (!earlyWeekBlankPractice && official49ersInjHtml) {
    const liveOfficial = parseOfficial49ersInjuryReportHtml(
      official49ersInjHtml,
      appData.scheduleMatchup?.upcomingMatchup?.oppName || '',
      activeTeam
    );

    if (liveOfficial.hasSfReport && Array.isArray(appData.roster?.players)) {
      const hasAnyLiveSfPractice = [...liveOfficial.sfByKey.values()].some(
        r => (r.wed && r.wed !== '-') || (r.thu && r.thu !== '-') || (r.fri && r.fri !== '-')
      );
      if (appData.health) {
        appData.health._hasLiveOfficialCurrentWeekSfReport = Boolean(hasAnyLiveSfPractice);
      }
      const hasSfFridayOfficial = [...liveOfficial.sfByKey.values()].some(r => r.fri && r.fri !== '-');
      const hasSfThuOfficial = [...liveOfficial.sfByKey.values()].some(r => r.thu && r.thu !== '-');
      const sfRosterPlayerNames = appData.roster.players.map(p => p.name).filter(Boolean);
      const DOWNGRADE_PROSE_RE =
        /\b(?:downgraded\s+to\s+(?:out|doubtful|questionable)|ruled\s+out|did\s+not\s+travel|didn['’]?t\s+travel|added\s+to\s+(?:the\s+)?injury\s+report|suffered\s+a\s+setback|setback\s+(?:at|in|during)\s+practice|illness)\b/i;
      for (const rp of appData.roster.players) {
        if (!rp?.health || !rp.name) continue;
        const sfCanonKey = canonicalInjuryPlayerKey(rp.name);
        const offRec = liveOfficial.sfByKey.get(sfCanonKey) || null;
        if (offRec) {
          if (!rp.health._officialSlots || typeof rp.health._officialSlots !== 'object') {
            rp.health._officialSlots = {};
          }
          if (offRec.wed && offRec.wed !== '-') {
            rp.health.wed = offRec.wed;
            rp.health._officialSlots.wed = true;
          } else if (!rp.health.wed) {
            rp.health.wed = '-';
          }
          if (offRec.thu && offRec.thu !== '-') {
            rp.health.thu = offRec.thu;
            rp.health._officialSlots.thu = true;
          } else if (!rp.health.thu) {
            rp.health.thu = '-';
          }
          if (offRec.fri && offRec.fri !== '-') {
            rp.health.fri = offRec.fri;
            rp.health._officialSlots.fri = true;
          } else if (!rp.health.fri) {
            rp.health.fri = '-';
          }

          if (rp.rosterBucket === 'active') {
            const offIsRest = isRestOrPersonalInjuryLabel(offRec.injuryType || '');
            const existingIsRealMedical = isRealMedicalInjuryLabel(rp.health.injuryType);
            const fallbackMedicalFromProse = extractBodyPartSafe(
              `${rp.health.shortComment || ''} ${rp.health.longComment || ''}`
            );
            const hasMidweekInjuryPattern =
              rp.health.thu === 'LP' ||
              rp.health.thu === 'DNP' ||
              rp.health.fri === 'LP' ||
              rp.health.fri === 'DNP' ||
              ['Questionable', 'Doubtful', 'Out'].includes(offRec.gameStatus || '');
            const hasSecondaryMidweekMedical = offIsRest && hasMidweekInjuryPattern;
            const effectiveInj = hasSecondaryMidweekMedical
              ? existingIsRealMedical
                ? rp.health.injuryType
                : fallbackMedicalFromProse || 'Injury (Reported)'
              : offRec.injuryType || rp.health.injuryType || '';
            rp.health.injuryType = effectiveInj;

            const combinedBeat = pickMeaningfulInjuryComment(rp.health.longComment, rp.health.shortComment);
            const effGameStatus = resolveOfficialReportGameStatus({
              offRec: { ...offRec, wed: rp.health.wed, thu: rp.health.thu, fri: rp.health.fri },
              teamHasGameDesignations: Boolean(liveOfficial.hasSfGameDesignations),
              existingStatus: rp.health.status,
              effectiveInjuryType: effectiveInj,
              hasSecondaryMedical: hasSecondaryMidweekMedical,
              isPureRest: offIsRest,
              espnHasDowngradeProse: DOWNGRADE_PROSE_RE.test(combinedBeat)
            });

            rp.health.status =
              effGameStatus === 'Active'
                ? rp.health.wed === 'Vet Rest' && !hasSecondaryMidweekMedical
                  ? 'Active'
                  : 'No Designation (Cleared)'
                : effGameStatus;
            rp.health.isOnPracticeReport = true;

            const playProb = computePlayerPlayProbability({
              name: rp.name,
              position: rp.position,
              experienceYears: rp.experienceYears ?? null,
              snapPct: rp.primarySnapPct ?? null,
              rosterBucket: rp.rosterBucket,
              isSeasonEnding: false,
              fantasyStatusAbbr: rp.health.fantasyStatusAbbr || '',
              gameStatus: effGameStatus,
              weeklyHistory: rp.health.weeklyHistory2026 || [],
              currentWeek: appData.scheduleMatchup?.upcomingMatchup?.week,
              byeWeek: appData.health?.byeWeek || 8,
              isIrReturnQuestionable: false,
              injuryType: effectiveInj,
              wed: rp.health.wed,
              thu: rp.health.thu,
              fri: rp.health.fri,
              hasSideFieldRehab: Boolean(rp.health.hasSideFieldRehab),
              kickoffIso: nextGameKickoffIso,
              blurbDateIso: rp.health.blurbDateIso || null,
              beatNote: combinedBeat
            });
            rp.health.playProbabilityPct = playProb.probabilityPct;
            rp.health.playTier = playProb.tier;
            rp.health.playBadgeLabel = playProb.badgeLabel;
            rp.health.factors = playProb.factors;
            rp.health.hasPreReportPracticeReturn = Boolean(playProb.appliedPreReportPracticeReturn);
          } else if (rp.rosterBucket === 'ir' && !rp.health.isSeasonEnding) {
            if (rp.health.wed !== '-' || rp.health.thu !== '-' || rp.health.fri !== '-') {
              rp.health.isPracticeWindowOpen = true;
              rp.health.isPracticeWindowExpected = false;
              if (offRec.injuryType && (!rp.health.injuryType || rp.health.injuryType === 'Undisclosed')) {
                rp.health.injuryType = offRec.injuryType;
              }
              if (offRec.gameStatus === 'Questionable') {
                rp.health.isIrReturnQuestionable = true;
                rp.health.status = 'Questionable (IR Return Window)';
              } else if (offRec.gameStatus === 'Out') {
                rp.health.isIrReturnQuestionable = false;
                rp.health.status = 'IR — 21-Day Window Open';
              } else if (!rp.health.isIrReturnQuestionable) {
                rp.health.status = 'IR — 21-Day Window Open';
              }

              const irCombinedBeat = pickMeaningfulInjuryComment(
                rp.health.irBeatNote,
                rp.health.longComment,
                rp.health.shortComment
              );
              const irPlayProb = computePlayerPlayProbability({
                name: rp.name,
                position: rp.position,
                experienceYears: rp.experienceYears ?? null,
                snapPct: rp.primarySnapPct ?? null,
                rosterBucket: rp.rosterBucket,
                isSeasonEnding: false,
                isPracticeWindowOpen: true,
                designatedDateIso: rp.health.designatedDateIso || '',
                kickoffIso: nextGameKickoffIso,
                schedule: appData.scheduleMatchup?.schedule || [],
                upcomingOppName: appData.scheduleMatchup?.upcomingMatchup?.oppName || '',
                upcomingOppAbbr: appData.scheduleMatchup?.upcomingMatchup?.oppAbbr || '',
                blurbDateIso: rp.health.blurbDateIso || null,
                lastCompletedGameKickoffMs: latestCompletedKickoffMsForOverlay,
                fantasyStatusAbbr: rp.health.fantasyStatusAbbr || '',
                gameStatus: offRec.gameStatus === 'Out' ? 'Out' : offRec.gameStatus === 'Questionable' ? 'Questionable' : rp.health.status,
                weeklyHistory: rp.health.weeklyHistory2026 || [],
                earliestEligibleWeek: rp.health.earliestEligibleWeek ?? null,
                rosterPlayerNames: sfRosterPlayerNames,
                currentWeek: appData.scheduleMatchup?.upcomingMatchup?.week,
                byeWeek: appData.health?.byeWeek || 8,
                isIrReturnQuestionable: Boolean(rp.health.isIrReturnQuestionable),
                injuryType: rp.health.injuryType || '',
                wed: rp.health.wed,
                thu: rp.health.thu,
                fri: rp.health.fri,
                beatNote: irCombinedBeat
              });
              rp.health.playProbabilityPct = irPlayProb.probabilityPct;
              rp.health.playTier = irPlayProb.tier;
              rp.health.playBadgeLabel = irPlayProb.badgeLabel;
              rp.health.factors = irPlayProb.factors;
              rp.health.isOnPracticeReport = irPlayProb.probabilityPct > 0;
            }
          }
        } else if (hasAnyLiveSfPractice && rp.rosterBucket === 'active' && rp.health.isOnPracticeReport) {
          // NEVER wipe a player explicitly listed Out/Doubtful/Questionable on live ESPN `/injuries`
          // or added via a newer later-day live wire observation while `49ers.com` HTML lags!
          const hasLiveEspnDesig = espnLiveDesignatedSfKeys.has(sfCanonKey);
          const hasNewerDayWirePractice =
            (!hasSfFridayOfficial && rp.health.fri && rp.health.fri !== '-') ||
            (!hasSfThuOfficial && !hasSfFridayOfficial && rp.health.thu && rp.health.thu !== '-');
          if (!hasLiveEspnDesig && !hasNewerDayWirePractice) {
            rp.health.isOnPracticeReport = false;
            delete rp.health.sustainedInLastGame;
            delete rp.health.exitedPriorGameWithoutReturn;
            rp.health.wed = '-';
            rp.health.thu = '-';
            rp.health.fri = '-';
            rp.health.status = 'Active';
            rp.health.injuryType = '';
            rp.health.playProbabilityPct = 95;
            rp.health.playTier = 'ACTIVE';
            rp.health.playBadgeLabel = '95% • Full Go';
          }
        }
      }

      if (appData.health) {
        appData.health.practiceReport = appData.roster.players
          .filter(p => p.health?.isOnPracticeReport)
          .sort((a, b) => a.health.playProbabilityPct - b.health.playProbabilityPct || (b.capHit2026 || 0) - (a.capHit2026 || 0))
          .map(p => ({
            playerId: p.id,
            name: p.name,
            position: p.position,
            jersey: p.jersey,
            headshotUrl: p.headshotUrl || '',
            rosterBucket: p.rosterBucket || 'active',
            isIrReturnWindow: p.rosterBucket === 'ir' && Boolean(p.health.isPracticeWindowOpen),
            wed: p.health.wed || '-',
            thu: p.health.thu || '-',
            fri: p.health.fri || '-',
            injuryType: p.health.injuryType || 'Cleared — No Designation',
            gameStatus: p.health.status,
            playProbabilityPct: p.health.playProbabilityPct,
            playBadgeLabel: p.health.playBadgeLabel,
            archetypeNote: p.health.archetypeNote || '',
            factors: p.health.factors || [],
            beatComment: pickMeaningfulInjuryComment(p.health.longComment, p.health.shortComment, p.health.irBeatNote)
          }));
        if (Array.isArray(appData.health._preGamePracticeReport)) {
          appData.health._preGamePracticeReport = mergeNonDestructivePreGameRows(
            appData.health._preGamePracticeReport,
            appData.health.practiceReport
          );
        }
      }
      mutated = true;
    }

    if (liveOfficial.hasOppReport && appData.scheduleMatchup.upcomingMatchup?.opponentHealth) {
      const oh = appData.scheduleMatchup.upcomingMatchup.opponentHealth;
      const hasOppFridayOfficial = [...liveOfficial.oppByKey.values()].some(r => r.fri && r.fri !== '-');
      const irKeySet = new Set((oh.irReserve || []).map(ir => canonicalInjuryPlayerKey(ir.name)));
      const rosterMetaByKey = new Map(
        [
          ...(oh.activeRoster || []),
          ...(oh.keyStartersHealthy || []),
          ...(oh.injuryReport || [])
        ].map(p => [canonicalInjuryPlayerKey(p.name), p])
      );
      const oppReportByKey = new Map(
        (oh.injuryReport || []).map(r => [canonicalInjuryPlayerKey(r.name), r])
      );

      const oppDowngradeProseRe =
        /\b(?:downgraded\s+to\s+(?:out|doubtful|questionable)|ruled\s+out|did\s+not\s+travel|didn['’]?t\s+travel|added\s+to\s+(?:the\s+)?injury\s+report|suffered\s+a\s+setback|setback\s+(?:at|in|during)\s+practice|illness)\b/i;

      for (const [oppKey, offOppRec] of liveOfficial.oppByKey.entries()) {
        if (irKeySet.has(oppKey) && offOppRec.gameStatus !== 'Questionable') continue;
        const existing = oppReportByKey.get(oppKey) || null;
        const meta = rosterMetaByKey.get(oppKey) || existing || {};
        const mergedWed = offOppRec.wed && offOppRec.wed !== '-' ? offOppRec.wed : existing?.wed || '-';
        const mergedThu = offOppRec.thu && offOppRec.thu !== '-' ? offOppRec.thu : existing?.thu || '-';
        const mergedFri = offOppRec.fri && offOppRec.fri !== '-' ? offOppRec.fri : existing?.fri || '-';
        const officialSlots = {
          ...(existing?._officialSlots || {}),
          ...(offOppRec.wed && offOppRec.wed !== '-' ? { wed: true } : {}),
          ...(offOppRec.thu && offOppRec.thu !== '-' ? { thu: true } : {}),
          ...(offOppRec.fri && offOppRec.fri !== '-' ? { fri: true } : {})
        };

        const offIsRest = isRestOrPersonalInjuryLabel(offOppRec.injuryType || '');
        const existingRealMed = isRealMedicalInjuryLabel(existing?.injuryType);
        const hasMidweekInjOpp =
          mergedThu === 'LP' ||
          mergedThu === 'DNP' ||
          mergedFri === 'LP' ||
          mergedFri === 'DNP' ||
          ['Questionable', 'Doubtful', 'Out'].includes(offOppRec.gameStatus || '');
        const hasSecondaryMed = offIsRest && hasMidweekInjOpp;
        const effInj = hasSecondaryMed
          ? existingRealMed
            ? existing.injuryType
            : extractBodyPartSafe(`${existing?.shortComment || ''} ${existing?.longComment || ''}`) || 'Injury Report'
          : offOppRec.injuryType || existing?.injuryType || 'Injury Report';

        const existingOppBeat = `${existing?.shortComment || ''} ${existing?.longComment || ''}`.trim();
        const effSt = resolveOfficialReportGameStatus({
          offRec: { ...offOppRec, wed: mergedWed, thu: mergedThu, fri: mergedFri },
          teamHasGameDesignations: Boolean(liveOfficial.hasOppGameDesignations),
          existingStatus: existing?.gameStatus || '',
          effectiveInjuryType: effInj,
          hasSecondaryMedical: hasSecondaryMed,
          isPureRest: offIsRest,
          espnHasDowngradeProse: oppDowngradeProseRe.test(existingOppBeat)
        });

        const isIrRetQ = irKeySet.has(oppKey) && offOppRec.gameStatus === 'Questionable';
        const prob = computePlayerPlayProbability({
          name: existing?.name || offOppRec.name,
          position: existing?.position || meta.position || offOppRec.position || 'ATH',
          snapPct: existing?.snapPct ?? meta.snapPct ?? null,
          gameStatus: isIrRetQ ? 'Questionable' : effSt,
          rosterBucket: isIrRetQ ? 'ir' : 'active',
          isIrReturnQuestionable: isIrRetQ,
          injuryType: effInj,
          wed: mergedWed,
          thu: mergedThu,
          fri: mergedFri,
          kickoffIso: nextGameKickoffIso,
          blurbDateIso: existing?.blurbDateIso || null,
          beatNote: existingOppBeat
        });

        const nextOppRow = {
          id: existing?.id || meta.id || undefined,
          name: existing?.name || meta.name || offOppRec.name,
          position: existing?.position || meta.position || offOppRec.position || 'ATH',
          unit: existing?.unit || meta.unit || classifyRosterUnit(offOppRec.position || '', ''),
          jersey: existing?.jersey ?? meta.jersey ?? null,
          headshotUrl: existing?.headshotUrl || meta.headshotUrl || '',
          espnUrl:
            existing?.espnUrl ||
            meta.espnUrl ||
            buildEspnTeamInjuriesUrl(appData.scheduleMatchup.upcomingMatchup?.oppAbbr || ''),
          snapPct: existing?.snapPct ?? meta.snapPct ?? null,
          wed: mergedWed,
          thu: mergedThu,
          fri: mergedFri,
          _officialSlots: officialSlots,
          injuryType: effInj,
          gameStatus: isIrRetQ
            ? 'IR Return Window (Q)'
            : effSt === 'Active'
              ? 'No Designation (Cleared)'
              : effSt,
          shortComment: existing?.shortComment || '',
          longComment: existing?.longComment || '',
          isStarter: Boolean(existing?.isStarter || meta.isStarter),
          isIrReturnQuestionable: isIrRetQ,
          playProbabilityPct: prob.probabilityPct,
          playTier: prob.tier,
          playBadgeLabel: prob.badgeLabel,
          hasPreReportPracticeReturn: Boolean(prob.appliedPreReportPracticeReturn),
          factors: prob.factors || [],
          archetypeNote: prob.priorUsed?.archetypeNote || existing?.archetypeNote || ''
        };
        const oppFilledCnt = [mergedWed, mergedThu, mergedFri].filter(v => v && v !== '-' && v !== '—').length;
        nextOppRow.priorDayPlayProbabilityPct = computeOpponentPriorDayPlayProbability(nextOppRow, {
          currentWeek: appData.scheduleMatchup.upcomingMatchup?.week || null,
          kickoffIso: nextGameKickoffIso
        });
        nextOppRow.hasPreReportPracticeReturnDelta = Boolean(
          oppFilledCnt === 1 && nextOppRow.hasPreReportPracticeReturn
        );
        nextOppRow.isMidWeekAdditionDelta = Boolean(
          oppFilledCnt === 1 && isMidWeekHealthyAdditionRow(nextOppRow)
        );
        oppReportByKey.set(oppKey, nextOppRow);
      }

      const reconciledOppReport = [...oppReportByKey.values()].sort(
        (a, b) => a.playProbabilityPct - b.playProbabilityPct
      );
      oh.injuryReport = reconciledOppReport;
      if (Array.isArray(oh._preGameInjuryReport)) {
        oh._preGameInjuryReport = mergeNonDestructivePreGameRows(oh._preGameInjuryReport, reconciledOppReport);
      }
      oh.summary = computeTeamHealthSummary({
        injuryReport: reconciledOppReport,
        irReserve: oh.irReserve || [],
        totalStarters: oh.summary?.totalStarters || 22
      });
      mutated = true;
    }
  }

  // 4c. Live Opponent Per-Player Practice Wire Fallback (fills missing W/T/F slots when opponent leaves NFL CMS blank)
  if (!earlyWeekBlankPractice) {
    const oppPracticeMutated = await hydrateLiveOpponentWeeklyPracticeWire(appData, nextGameKickoffIso).catch(() => false);
    if (oppPracticeMutated) mutated = true;
  }

  // 5. Live ESPN 49ers Beat Articles
  if (combinedEspnArticles.length > 0 && Array.isArray(appData.news?.rawStream)) {
    const existingUrls = new Set(appData.news.rawStream.map(it => it.url).filter(Boolean));
    const rosterPlayers = appData.roster?.players || [];
    const newArts = [];
    for (const art of combinedEspnArticles) {
      const title = cleanSensationalistText(art.headline || '');
      if (!title) continue;
      const url = sanitizeExternalUrl(art.links?.web?.href, null);
      if (!url || existingUrls.has(url)) continue;

      const summary = cleanSensationalistText(art.description || '');
      const mentioned = matchPlayersClient(`${title} ${summary}`, rosterPlayers, 12);
      if (isOffTopicLeagueFiller({ url, title, summary, hasRosterMatch: mentioned.length > 0 })) continue;
      const sig = scoreContentSignal(title, summary);
      if (sig.isClickbait) continue;
      let imgUrl = art.images?.[0]?.url || '';
      if (imgUrl.startsWith('http://')) imgUrl = `https://${imgUrl.slice(7)}`;
      const bylineClean = art.byline
        ? cleanSensationalistText(String(art.byline).replace(/^By\s+/i, '').split(/\s+and\s+|,/i)[0].trim())
        : 'ESPN';
      const bylineLower = bylineClean.toLowerCase();
      const matchedRep = (appData.reporters?.reporters || []).find(
        r => r.name && !isPodiumSubjectId(r.id) && r.name.toLowerCase() === bylineLower
      );
      const rawDirEntry = resolveReporterFromNameOrHandle(matchedRep?.id || bylineClean);
      const dirEntry = rawDirEntry && !isPodiumSubjectId(rawDirEntry.id) ? rawDirEntry : null;
      const resolvedReporterId =
        matchedRep?.id || dirEntry?.id || (/schefter/i.test(bylineClean) ? 'adam_schefter' : null);
      const pubIso = art.published || new Date().toISOString();
      if (isStaleCompletedGameAvailabilityItem({ type: 'article', title, summary, publishedAt: pubIso }, appData)) {
        continue;
      }
      const brk = classifyBreakingItem({ title, summary, publishedAt: pubIso }, Date.now(), { appData });

      existingUrls.add(url);
      const itemDraft = {
        id: `espn_live_${art.id || Date.now()}`,
        type: 'article',
        title,
        summary,
        imageUrl: imgUrl.startsWith('https://') ? imgUrl : '',
        imageAlt: title,
        mentionedPlayers: mentioned,
        publishedAt: pubIso,
        url,
        outletId: matchedRep?.outletId || dirEntry?.outletId || 'espn',
        outletName: 'ESPN',
        reporterId: resolvedReporterId,
        reporterName: bylineClean,
        author: bylineClean,
        authorHandle: matchedRep?.handle || dirEntry?.handle || '',
        authorProfileUrl: matchedRep?.xUrl || dirEntry?.xUrl || null,
        trustTier: dirEntry?.trustTier || 1,
        isBreaking: brk.isBreaking,
        isInGameInjury: brk.isInGameInjury,
        breakingBadge: brk.breakingBadge,
        breakingPriority: brk.breakingPriority,
        category: brk.isInGameInjury || /injur|bosa|questionable|return/i.test(title) ? 'injury' : 'beat',
        signalScore: Math.max(70, sig.signalScore),
        fluffScore: sig.fluffScore,
        isClickbait: false
      };
      itemDraft.authorProfileUrl = resolveItemAuthorProfileUrl(itemDraft, url);
      newArts.push(itemDraft);
    }
    if (newArts.length > 0) {
      appData.news.rawStream = sortNewsWithBreakingPriority(
        filterOutCompletedGameAvailabilityItems([...newArts, ...appData.news.rawStream], appData),
        Date.now(),
        { appData }
      );
      propagateLiveItemsToPlayerMentions(newArts, rosterPlayers, appData);
      mutated = true;
    }
  }

  if (Array.isArray(appData.news?.rawStream)) {
    const beforeLen = appData.news.rawStream.length;
    appData.news.rawStream = filterOutCompletedGameAvailabilityItems(appData.news.rawStream, appData);
    if (appData.news.rawStream.length !== beforeLen) mutated = true;
  }
  if (Array.isArray(appData.news?.clusteredBriefs)) {
    appData.news.clusteredBriefs = filterAndCleanSynthesisClusters(appData.news.clusteredBriefs, appData);
  }

  // 6. Reconcile 49ers Play Likelihood & IR Return Windows with Corroborated Beat/Coaching News
  if (reconcileRosterAndHealthWithNews(appData)) {
    mutated = true;
  }

  // Persist non-destructive weekly W/T/F practice snapshot before applying game-day In/Out overrides
  persistWeeklyPracticeSnapshot(appData);

  // 7. Game-Day Inactives & Active Roster Window ([T-90m, Final))
  const gdMutated = await hydrateLiveGameDayRosters(appData).catch(() => false);
  if (gdMutated) mutated = true;

  if (mutated) {
    appData.meta.updatedAt = new Date().toISOString();
  }
  return mutated;
}

const oppWeeklyPracticeWirePollState = new Map();

/**
 * Hydrates missing Opponent `W / T / F` practice participation slots directly from ESPN's CORS-enabled
 * per-player news feed (`apis/fantasy/v2/games/ffl/news/players?playerId=...`) when an opponent club
 * leaves Friday or midweek cells blank in NFL CMS (e.g. Dallas Cowboys `UNSPECIFIED` Friday rows).
 */
export async function hydrateLiveOpponentWeeklyPracticeWire(
  appData,
  nextGameKickoffIso = '',
  nowMs = Date.now()
) {
  const um = appData?.scheduleMatchup?.upcomingMatchup;
  const oh = um?.opponentHealth;
  if (!oh || !Array.isArray(oh.injuryReport) || oh.injuryReport.length === 0) return false;
  if (isBeforeWeeklyPracticeWindow(nextGameKickoffIso || um.kickoffIso || um.dateIso || '', nowMs)) {
    return false;
  }

  const oppAbbr = normalizeTeamAbbrClient(um.oppAbbr || '');
  const week = Number(um.week || appData.meta?.currentWeek || 0);
  const pollKey = `${week}:${oppAbbr}`;
  const prevPollMs = oppWeeklyPracticeWirePollState.get(pollKey) || 0;
  if (nowMs - prevPollMs < 180_000) return false;

  const idByKey = new Map();
  for (const p of [...(oh.activeRoster || []), ...(oh.keyStartersHealthy || []), ...oh.injuryReport]) {
    const k = canonicalInjuryPlayerKey(p?.name || '');
    const rawId = String(
      p?.id ||
        p?.playerId ||
        (String(p?.espnUrl || '').match(/\/id\/(\d+)/)?.[1] || '') ||
        (String(p?.headshotUrl || '').match(/\/(\d+)\.png/)?.[1] || '')
    );
    if (k && /^\d{4,10}$/.test(rawId) && !idByKey.has(k)) {
      idByKey.set(k, rawId);
    }
  }

  // Poll ALL injured / Questionable / Doubtful / Out / missing-slot opponent players (up to 16),
  // prioritizing missing W/T/F slots and Questionable/Doubtful starters so Saturday trending/downgrade
  // updates are captured even after Fri practice is populated!
  const targetRows = [...oh.injuryReport]
    .filter(r => idByKey.has(canonicalInjuryPlayerKey(r.name)))
    .sort((a, b) => {
      const aMiss = !a.wed || a.wed === '-' || !a.thu || a.thu === '-' || !a.fri || a.fri === '-' ? 0 : 1;
      const bMiss = !b.wed || b.wed === '-' || !b.thu || b.thu === '-' || !b.fri || b.fri === '-' ? 0 : 1;
      if (aMiss !== bMiss) return aMiss - bMiss;
      const aBare = isBareStatusPlaceholderComment(a.longComment || a.shortComment) ? 0 : 1;
      const bBare = isBareStatusPlaceholderComment(b.longComment || b.shortComment) ? 0 : 1;
      if (aBare !== bBare) return aBare - bBare;
      return (b.isStarter ? 1 : 0) - (a.isStarter ? 1 : 0);
    })
    .slice(0, 16);

  if (targetRows.length === 0) return false;
  oppWeeklyPracticeWirePollState.set(pollKey, nowMs);

  const kickoffMs = Date.parse(nextGameKickoffIso || um.kickoffIso || um.dateIso || '');
  const weekWindowFloorMs = Number.isFinite(kickoffMs)
    ? kickoffMs - 5.5 * 86_400_000
    : nowMs - 5 * 86_400_000;
  let updatedAny = false;

  await Promise.all(
    targetRows.map(async row => {
      const pid = idByKey.get(canonicalInjuryPlayerKey(row.name));
      if (!pid) return;
      try {
        const res = await fetchSingleWithTimeout(
          `https://site.api.espn.com/apis/fantasy/v2/games/ffl/news/players?playerId=${encodeURIComponent(pid)}&limit=4`,
          { cache: 'no-store' },
          4500
        );
        if (!res.ok) return;
        const json = await res.json();
        const entries = Array.isArray(json?.feed) ? [...json.feed].reverse() : [];
        let rowUpdated = false;
        for (const entry of entries) {
          const pubMs = Date.parse(entry.published || entry.lastModified || '');
          if (!Number.isFinite(pubMs) || pubMs < weekWindowFloorMs) continue;
          const headline = cleanSensationalistText(decodeXmlEntitiesClient(entry.headline || ''));
          const desc = cleanSensationalistText(decodeXmlEntitiesClient(entry.description || ''));
          const story = cleanSensationalistText(decodeXmlEntitiesClient(entry.story || ''));
          const leadText = desc || headline;
          if (leadText && leadText.length >= 16) {
            const parsedAttr = extractBeatAttributionFromText(`${desc} ${story}`.trim(), {
              reporterId: null,
              reporterName: entry.byline ? String(entry.byline).replace(/^By\s+/i, '').trim() : `${oppAbbr} Beat Wire`,
              outletId: 'espn',
              outletName: 'ESPN / X Beat Wire'
            });
            const buffered = bufferOpponentNewsWireItem(appData, {
              id: `espn_pwire_${pid}_${entry.id || hashWireKey(`${pid}_${pubMs}_${leadText.slice(0, 40)}`)}`,
              type: 'tweet',
              title: leadText,
              fullText: leadText,
              summary:
                story && story !== leadText
                  ? buildBoundedWireSummary(story, WIRE_BLURB_SUMMARY_MAX_CHARS)
                  : headline !== leadText
                    ? buildBoundedWireSummary(headline, WIRE_ARTICLE_EXCERPT_MAX_CHARS)
                    : '',
              publishedAt: new Date(pubMs).toISOString(),
              url:
                sanitizeExternalUrl(entry.links?.web?.href, null) ||
                buildEspnPlayerNewsAnchorUrl(pid, row.name, leadText),
              author: parsedAttr.author || `${oppAbbr} Beat Wire`,
              authorHandle: parsedAttr.authorHandle || '',
              outletName: parsedAttr.outletName || 'ESPN / X Beat Wire',
              trustTier: parsedAttr.trustTier || 1,
              wireSource: 'espn_player_wire',
              primaryPlayer: { id: pid, name: row.name }
            });
            if (buffered) updatedAny = true;
            // Upgrade bare `"out"` / `"questionable"` placeholder comments with genuine player wire prose!
            if (isBareStatusPlaceholderComment(row.longComment) && !isBareStatusPlaceholderComment(story || leadText)) {
              row.longComment = story || leadText;
              if (isBareStatusPlaceholderComment(row.shortComment)) {
                row.shortComment = leadText;
              }
              rowUpdated = true;
              updatedAny = true;
            }
          }
          const parsed = extractPracticeDaysFromText({
            statusRaw: row.gameStatus || 'Questionable',
            injuryType: row.injuryType || '',
            shortComment: `${headline} ${desc}`.trim(),
            longComment: story,
            kickoffIso: nextGameKickoffIso || um.kickoffIso || um.dateIso || '',
            allowHeuristicFill: false
          });
          for (const slot of ['wed', 'thu', 'fri']) {
            if ((!row[slot] || row[slot] === '-') && parsed[slot] && parsed[slot] !== '-') {
              row[slot] = parsed[slot];
              rowUpdated = true;
              updatedAny = true;
            }
          }
          if (!isRealMedicalInjuryLabel(row.injuryType)) {
            const bp = extractBodyPartSafe(`${headline} ${desc}`);
            if (isRealMedicalInjuryLabel(bp)) {
              row.injuryType = bp;
              rowUpdated = true;
              updatedAny = true;
            }
          }
        }
        if (rowUpdated) {
          const stClean =
            row.gameStatus === 'No Designation (Cleared)'
              ? 'Active'
              : row.gameStatus === 'IR Return Window (Q)'
                ? 'Questionable'
                : row.gameStatus || 'Questionable';
          const prob = computePlayerPlayProbability({
            name: row.name,
            position: row.position || 'ATH',
            snapPct: row.snapPct ?? null,
            gameStatus: stClean,
            rosterBucket: row.isIrReturnQuestionable ? 'ir' : 'active',
            isIrReturnQuestionable: Boolean(row.isIrReturnQuestionable),
            injuryType: row.injuryType || '',
            wed: row.wed || '-',
            thu: row.thu || '-',
            fri: row.fri || '-',
            kickoffIso: nextGameKickoffIso || um.kickoffIso || um.dateIso || '',
            blurbDateIso: row.blurbDateIso || null,
            beatNote: `${row.shortComment || ''} ${row.longComment || ''}`.trim()
          });
          row.playProbabilityPct = prob.probabilityPct;
          row.playTier = prob.tier;
          row.playBadgeLabel = prob.badgeLabel;
          row.factors = prob.factors || [];
          row.hasPreReportPracticeReturn = Boolean(prob.appliedPreReportPracticeReturn);
          const oppFilled = [row.wed, row.thu, row.fri].filter(v => v && v !== '-' && v !== '—').length;
          row.priorDayPlayProbabilityPct = computeOpponentPriorDayPlayProbability(row, {
            currentWeek: um.week || null,
            kickoffIso: nextGameKickoffIso || um.kickoffIso || um.dateIso || ''
          });
          row.hasPreReportPracticeReturnDelta = Boolean(oppFilled === 1 && row.hasPreReportPracticeReturn);
          row.isMidWeekAdditionDelta = Boolean(oppFilled === 1 && isMidWeekHealthyAdditionRow(row));
        }
      } catch {}
    })
  );

  if (updatedAny) {
    oh.injuryReport.sort((a, b) => a.playProbabilityPct - b.playProbabilityPct);
    if (Array.isArray(oh._preGameInjuryReport)) {
      oh._preGameInjuryReport = mergeNonDestructivePreGameRows(oh._preGameInjuryReport, oh.injuryReport);
    }
    oh.summary = computeTeamHealthSummary({
      injuryReport: oh.injuryReport,
      irReserve: oh.irReserve || [],
      totalStarters: oh.summary?.totalStarters || 22
    });
  }
  return updatedAny;
}

/**
 * Live client-side refresh of the 6 flagship 49ers podcasts over the last 7 days
 * directly from Apple Podcasts' CORS-enabled Lookup API (`itunes.apple.com/lookup`).
 */
export async function hydrateLive49ersPodcasts(appData) {
  if (!appData) return false;
  const activeTeam = resolveTeamConfig(appData?.meta?.teamAbbr || getActiveTeamConfig());
  const teamShows =
    activeTeam.abbr !== 'SF' && Array.isArray(activeTeam.beatPodcastShows) && activeTeam.beatPodcastShows.length > 0
      ? activeTeam.beatPodcastShows
      : Array.isArray(appData?.beatPodcasts?.shows) && appData.beatPodcasts.shows.length > 0
        ? appData.beatPodcasts.shows
        : FLAGSHIP_PODCAST_SHOWS_CLIENT;
  try {
    const ids = teamShows.map(s => s.collectionId).filter(Boolean).join(',');
    if (!ids) return false;
    const res = await fetchSingleWithTimeout(
      `https://itunes.apple.com/lookup?id=${ids}&entity=podcastEpisode&limit=12`,
      { cache: 'no-cache' },
      8500
    );
    if (!res.ok) return false;
    const payload = await res.json();
    const results = Array.isArray(payload?.results) ? payload.results : [];
    if (results.length === 0) return false;

    const nowMs = Date.now();
    const windowMs = 7 * 86_400_000;
    const showMetaById = new Map();
    for (const r of results) {
      if (r.wrapperType === 'track' && r.kind === 'podcast') {
        showMetaById.set(Number(r.collectionId), r);
      }
    }

    const episodes = [];
    for (const r of results) {
      if (r.wrapperType !== 'podcastEpisode') continue;
      const showCfg = teamShows.find(s => Number(s.collectionId) === Number(r.collectionId));
      if (!showCfg) continue;
      const pubMs = r.releaseDate ? new Date(r.releaseDate).getTime() : 0;
      if (!pubMs || nowMs - pubMs > windowMs) continue;

      const showMeta = showMetaById.get(Number(showCfg.collectionId)) || {};
      const durMin = r.trackTimeMillis ? Math.max(1, Math.round(r.trackTimeMillis / 60000)) : null;
      const rawDesc = String(r.description || r.shortDescription || '')
        .replace(/<[^>]+>/g, ' ')
        .replace(/\b(Learn more about your ad choices[\s\S]*|Visit podcastchoices\.com[\s\S]*|Support Us By Supporting Our Sponsors[\s\S]*)/i, '')
        .replace(/\s+/g, ' ')
        .trim();
      const summary = rawDesc.length > 280 ? `${rawDesc.slice(0, 277).replace(/\s+\S*$/, '')}…` : rawDesc;

      episodes.push({
        id: `pod_${showCfg.id}_${r.trackId}`,
        trackId: r.trackId,
        collectionId: showCfg.collectionId,
        showId: showCfg.id,
        showName: showCfg.name,
        showFullTitle: showMeta.collectionName || r.collectionName || showCfg.name,
        hosts: showCfg.hosts,
        network: showCfg.network,
        title: cleanSensationalistText(r.trackName || 'Episode'),
        summary: summary || `${showCfg.name} episode analyzing the latest ${activeTeam.fullName} news and film.`,
        publishedAt: new Date(pubMs).toISOString(),
        durationMinutes: durMin,
        durationDisplay: durMin ? `${durMin} min` : 'Podcast',
        artworkUrl: r.artworkUrl160 || showMeta.artworkUrl600 || showMeta.artworkUrl100 || '',
        appleEpisodeUrl: r.trackViewUrl || showCfg.appleShowUrl,
        appleShowUrl: showMeta.collectionViewUrl || showCfg.appleShowUrl,
        feedUrl: r.feedUrl || showMeta.feedUrl || showCfg.feedUrl,
        audioStreamUrl: r.episodeUrl || ''
      });
    }

    episodes.sort((a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime());

    const shows = teamShows.map(s => {
      const meta = showMetaById.get(s.collectionId) || {};
      const count = episodes.filter(e => e.showId === s.id).length;
      return {
        ...s,
        fullTitle: meta.collectionName || s.name,
        artworkUrl: meta.artworkUrl600 || meta.artworkUrl100 || '',
        feedUrl: meta.feedUrl || s.feedUrl,
        appleShowUrl: meta.collectionViewUrl || s.appleShowUrl,
        episodeCount7d: count
      };
    });

    const prevTopId = appData.beatPodcasts?.episodes?.[0]?.id || '';
    appData.beatPodcasts = {
      updatedAt: new Date().toISOString(),
      windowDays: 7,
      totalEpisodes: episodes.length,
      shows,
      episodes
    };
    return Boolean(episodes[0]?.id && episodes[0].id !== prevTopId);
  } catch {
    return false;
  }
}
