/**
 * Data Loader, Sub-Minute Live Wire Hydrator & Resilient LocalStorage User Preferences Manager
 */

import { scoreContentSignal, cleanSensationalistText } from '../engine/antiFluffFilter.js';
import {
  computePlayerPlayProbability,
  extractPracticeDaysFromText
} from '../engine/injuryProbabilityModel.js';
import {
  runPlayoffMonteCarlo,
  computeCalibratedTeamPowerRating,
  computeRootingGuideLeverage
} from '../engine/playoffMonteCarlo.js';
import {
  SHORT_TWEET_FULL_TEXT_LIMIT,
  classifyBreakingItem,
  sortNewsWithBreakingPriority,
  formatTweetBodyForDisplay
} from '../engine/breakingClassifier.js';
import {
  evaluateGameDayWindow,
  isBeforeWeeklyPracticeWindow,
  buildTeamGameDayRosterModel,
  resolveGameDayInjuryRows,
  classifyRosterUnit,
  resolveEarlyWeekRolloverInput
} from '../engine/gameDayRosterEngine.js';
import {
  buildEspnPlayerUrl,
  buildEspnTeamInjuriesUrl,
  buildEspnTeamLogoUrl,
  buildPfrHeadToHeadUrl,
  sanitizeExternalUrl
} from '../engine/linkIntegrity.js';
import {
  extractBeatAttributionFromText,
  resolveReporterFromNameOrHandle,
  resolveOriginalTweetUrl
} from '../engine/beatAttributionEngine.js';

const STORAGE_KEY = 'joshal_49ers_hq_prefs_v1';
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
    isNationalInsider: false
  },
  {
    actor: 'nbcs49ers.bsky.social',
    reporterId: 'matt_maiocco',
    reporterName: '49ers on NBCSBA',
    authorHandle: '@NBCS49ers',
    outletId: 'nbcsba',
    outletName: 'NBC Sports Bay Area',
    isNationalInsider: false
  },
  {
    actor: 'nbcsportsbayarea.com',
    reporterId: 'matt_maiocco',
    reporterName: 'NBC Sports Bay Area',
    authorHandle: '@NBCSAuthentic',
    outletId: 'nbcsba',
    outletName: 'NBC Sports Bay Area',
    isNationalInsider: true
  },
  {
    actor: '49erswebzone.bsky.social',
    reporterId: 'al_sacco',
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
    actor: 'nfltraderumors.bsky.social',
    reporterId: 'adam_schefter',
    reporterName: 'NFL Trade Rumors Wire',
    authorHandle: '@nflrums',
    outletId: 'nfl_network',
    outletName: 'NFL Beat & Transaction Wire',
    isNationalInsider: true
  },
  {
    actor: 'insidenflnews.bsky.social',
    reporterId: 'adam_schefter',
    reporterName: 'NFL Insider Wire',
    authorHandle: '@NFLInsiderWire',
    outletId: 'nfl_network',
    outletName: 'NFL Insider Wire',
    isNationalInsider: true
  },
  {
    actor: 'nflnewsreposterbot.bsky.social',
    reporterId: 'tom_pelissero',
    reporterName: 'NFL Beat & Insider Wire',
    authorHandle: '@NFLBeatWire',
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
    hosts: 'Matt Maiocco & Laura Britt',
    network: 'NBC Sports Bay Area',
    feedUrl: 'https://feeds.simplecast.com/SCmnvidR',
    appleShowUrl: 'https://podcasts.apple.com/us/podcast/49ers-talk-a-san-francisco-49ers-podcast/id1153457233'
  },
  {
    id: '49ers_plus_minus',
    collectionId: 1827546443,
    name: '49ers +/-',
    hosts: 'Tim Kawakami & SF Standard Beat',
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
  theme: 'dark', // 'dark' = Levi's Night Game | 'light' = '94 Throwback White & Gold
  dashboardOrder: [],
  dashboardOrderVersion: 2,
  disabledReporterIds: [],
  disabledOutlets: [],
  muteHotTakePersonalities: false,
  strictAnalyticsFilmOnly: false,
  groupPasscode: '',
  authorName: 'Josh',
  podFormat: 'two_host', // 'two_host' | 'solo'
  defaultPodDurationMin: 3, // 2..20
  workerBaseUrl: '',
  geminiApiKey: '',
  verifiedGeminiModel: '',
  geminiApiBaseUrl: '',
  capSelectedYear: null,
  capMoves: {}, // playerId -> action (primary year backward-compatible)
  capMovesByYear: {}, // year -> { playerId -> action }
  playoffForcedWinners: {}, // gameId -> 'HOME' | 'AWAY'
  localCustomAnalyses: [],
  localCustomEpisodes: [],
  archivedEpisodeIds: [],
  deletedEpisodeIds: [],
  archivedAnalysisIds: [],
  deletedAnalysisIds: []
};

export function loadUserPrefs() {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return structuredCloneFallback(DEFAULT_USER_PREFS);
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return structuredCloneFallback(DEFAULT_USER_PREFS);
    }
    const orderIsV2 = parsed.dashboardOrderVersion === 2;
    return {
      ...structuredCloneFallback(DEFAULT_USER_PREFS),
      ...parsed,
      dashboardOrderVersion: 2,
      dashboardOrder: orderIsV2 && Array.isArray(parsed.dashboardOrder) ? parsed.dashboardOrder : [],
      disabledReporterIds: Array.isArray(parsed.disabledReporterIds) ? parsed.disabledReporterIds : [],
      disabledOutlets: Array.isArray(parsed.disabledOutlets) ? parsed.disabledOutlets : [],
      geminiApiKey: typeof parsed.geminiApiKey === 'string' ? parsed.geminiApiKey.trim() : '',
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
      archivedEpisodeIds: Array.isArray(parsed.archivedEpisodeIds) ? parsed.archivedEpisodeIds : [],
      deletedEpisodeIds: Array.isArray(parsed.deletedEpisodeIds) ? parsed.deletedEpisodeIds : [],
      archivedAnalysisIds: Array.isArray(parsed.archivedAnalysisIds) ? parsed.archivedAnalysisIds : [],
      deletedAnalysisIds: Array.isArray(parsed.deletedAnalysisIds) ? parsed.deletedAnalysisIds : []
    };
  } catch {
    return structuredCloneFallback(DEFAULT_USER_PREFS);
  }
}

export function saveUserPrefs(prefs) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
    return true;
  } catch {
    return false;
  }
}

function structuredCloneFallback(obj) {
  return JSON.parse(JSON.stringify(obj));
}

async function fetchJsonSafe(pathUrl) {
  const res = await fetch(pathUrl, { cache: 'no-cache' });
  if (!res.ok) {
    throw new Error(`Failed to load ${pathUrl} (HTTP ${res.status})`);
  }
  return res.json();
}

export async function loadAll49ersData(basePrefix = './data') {
  const cleanBase = String(basePrefix || './data').replace(/\/+$/, '');
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
    fetchJsonSafe(`${cleanBase}/reporters.json`),
    fetchJsonSafe(`${cleanBase}/news.json`),
    fetchJsonSafe(`${cleanBase}/schedule-matchup.json`),
    fetchJsonSafe(`${cleanBase}/health.json`),
    fetchJsonSafe(`${cleanBase}/seasonal.json`),
    fetchJsonSafe(`${cleanBase}/podcasts/index.json`),
    fetchJsonSafe(`${cleanBase}/beat-podcasts.json`).catch(() => ({
      updatedAt: '',
      windowDays: 7,
      shows: FLAGSHIP_PODCAST_SHOWS_CLIENT,
      episodes: []
    }))
  ]);

  if (news && Array.isArray(news.rawStream)) {
    const directPosts = news.rawStream.filter(
      it => (it?.type === 'tweet' || it?.type === 'social') && /^(?:https?:\/\/)(?:www\.)?(?:x\.com|twitter\.com|bsky\.app)\//i.test(String(it?.url || ''))
    );
    news.rawStream = sortNewsWithBreakingPriority(
      news.rawStream.map(it =>
        it?.type === 'tweet' || it?.type === 'social'
          ? { ...it, url: resolveOriginalTweetUrl(it, directPosts) }
          : it
      )
    );
  }

  return {
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
  const curMs = Date.parse(currentUpdatedAt || '') || 0;
  const candidates = ['./data'];
  if (isProductionHostedOrigin()) {
    candidates.push(GITHUB_RAW_DATA_BASE);
  }

  let bestPrefix = null;
  let bestMs = curMs;

  await Promise.all(
    candidates.map(async prefix => {
      try {
        const res = await fetch(`${prefix}/meta.json?t=${Date.now()}`, { cache: 'no-store' });
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

const AMBIGUOUS_BEAT_SURNAMES = new Set([
  'ward',
  'cook',
  'west',
  'long',
  'hill',
  'king',
  'reed',
  'hall',
  'gray',
  'wood',
  'park',
  'white',
  'green',
  'brown',
  'young',
  'scott',
  'stout',
  'height',
  'bell',
  'ford',
  'grant',
  'james',
  'miles',
  'price',
  'smith',
  'stone',
  'williams',
  'robinson',
  'thomas',
  'johnson',
  'jones',
  'davis',
  'wilson',
  'moore',
  'taylor',
  'anderson',
  'jackson',
  'harris',
  'martin',
  'evans',
  'campbell',
  'collins',
  'turner',
  'walker'
]);

function escapeClientRegex(s = '') {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function matchPlayersClient(
  text = '',
  rosterPlayers = [],
  max = 12,
  { allowUniqueSurnames = true } = {}
) {
  const hay = String(text || '').toLowerCase();
  if (!hay || !Array.isArray(rosterPlayers) || rosterPlayers.length === 0) return [];

  const surnameCounts = new Map();
  if (allowUniqueSurnames) {
    for (const p of rosterPlayers) {
      const cleanParts = String(p.name || '')
        .replace(/\s+(?:sr\.?|jr\.?|ii|iii|iv|v)$/i, '')
        .trim()
        .split(/\s+/);
      const sLower = (cleanParts[cleanParts.length - 1] || '').toLowerCase();
      if (sLower) surnameCounts.set(sLower, (surnameCounts.get(sLower) || 0) + 1);
    }
  }

  const hits = [];
  for (const p of rosterPlayers) {
    if (hits.length >= max) break;
    const fullLower = String(p.name || '').toLowerCase().trim();
    if (!fullLower) continue;
    const strippedLower = fullLower.replace(/\s+(?:sr\.?|jr\.?|ii|iii|iv|v)$/i, '').trim();
    const cleanParts = String(p.name || '')
      .replace(/\s+(?:sr\.?|jr\.?|ii|iii|iv|v)$/i, '')
      .trim()
      .split(/\s+/);
    const surname = cleanParts[cleanParts.length - 1] || p.name;
    const surnameLower = surname.toLowerCase();

    const matchedFull =
      new RegExp(`\\b${escapeClientRegex(fullLower)}\\b`, 'i').test(hay) ||
      (strippedLower.length >= 6 &&
        new RegExp(`\\b${escapeClientRegex(strippedLower)}\\b`, 'i').test(hay));

    const matchedUniqueSurname =
      !matchedFull &&
      allowUniqueSurnames &&
      surnameLower.length >= 4 &&
      surnameCounts.get(surnameLower) === 1 &&
      !AMBIGUOUS_BEAT_SURNAMES.has(surnameLower) &&
      new RegExp(`\\b${escapeClientRegex(surnameLower)}\\b`, 'i').test(hay);

    if (matchedFull || matchedUniqueSurname) {
      hits.push({
        id: p.id,
        name: p.name,
        shortName: p.shortName || `${p.name[0]}. ${surname}`,
        position: p.position,
        jersey: p.jersey,
        headshotUrl: p.headshotUrl || ''
      });
    }
  }
  return hits;
}

function propagateLiveItemsToPlayerMentions(newItems = [], rosterPlayers = []) {
  if (!newItems.length || !rosterPlayers.length) return;
  const byId = new Map(rosterPlayers.map(p => [String(p.id), p]));
  const sevenDaysMs = 7 * 86_400_000;
  const nowMs = Date.now();

  for (const it of newItems) {
    const pubMs = new Date(it.publishedAt || 0).getTime() || 0;
    if (nowMs - pubMs > sevenDaysMs) continue;
    const mentioned = it.mentionedPlayers || [];
    for (const mp of mentioned) {
      const rp = byId.get(String(mp.id));
      if (!rp) continue;
      if (!Array.isArray(rp.recentNews)) rp.recentNews = [];
      if (rp.recentNews.some(existing => existing.url === it.url)) continue;

      const isTw = it.type === 'tweet' || it.type === 'social';
      const tweetFmt = isTw
        ? formatTweetBodyForDisplay(it.fullText || it.title, SHORT_TWEET_FULL_TEXT_LIMIT)
        : null;

      rp.recentNews.unshift({
        type: it.type || 'article',
        headline: isTw ? tweetFmt.text : it.title,
        fullText: isTw ? it.fullText || it.title : undefined,
        isFullTweet: isTw ? tweetFmt.isFullTweet : undefined,
        summary: isTw ? it.externalTitle || '' : it.summary || '',
        author: it.author || it.reporterName || it.outletName || '49ers Beat',
        authorHandle: it.authorHandle || '',
        authorProfileUrl: it.authorProfileUrl || '',
        outletName: it.outletName || '49ers Beat',
        publishedAt: it.publishedAt,
        url: it.url,
        externalUrl: it.externalUrl || null,
        imageUrl: it.imageUrl || '',
        isBreaking: Boolean(it.isBreaking),
        isInGameInjury: Boolean(it.isInGameInjury),
        breakingBadge: it.breakingBadge || null,
        breakingPriority: it.breakingPriority || 0
      });

      rp.recentNews = sortNewsWithBreakingPriority(rp.recentNews, nowMs).slice(0, 12);
    }
  }
}

/**
 * Fetches real-time 49ers beat & NFL insider posts directly from CORS-enabled Bluesky public feeds
 * (`public.api.bsky.app`) with `cache: 'no-store'` so late-breaking & in-game injury return tweets
 * appear in < 1 minute (polled every 20s during games, 45s outside games).
 */
export async function hydrateLiveBlueskyBeatWire(appData) {
  if (!appData?.news || !Array.isArray(appData.news.rawStream)) return 0;
  const existingUrls = new Set(appData.news.rawStream.map(it => it.url).filter(Boolean));
  const existingTextKeys = new Set(
    appData.news.rawStream.map(it => String(it.fullText || it.title || '').toLowerCase().slice(0, 90))
  );
  const rosterPlayers = appData.roster?.players || [];
  const sfKeywordsRe = /\b(49ers|niners|san francisco|shanahan|john lynch|levi's stadium|#49ers|#fttb)\b/i;

  const discovered = [];
  await Promise.all(
    LIVE_BLUESKY_BEAT_ACCOUNTS.map(async acct => {
      try {
        const limit = acct.isNationalInsider ? 10 : 6;
        const apiUrl = `https://public.api.bsky.app/xrpc/app.bsky.feed.getAuthorFeed?actor=${encodeURIComponent(acct.actor)}&limit=${limit}&filter=posts_no_replies`;
        const res = await fetch(apiUrl, { cache: 'no-store' });
        if (!res.ok) return;
        const payload = await res.json();
        for (const row of payload.feed || []) {
          if (row.reason) continue;
          const post = row.post;
          const rec = post?.record;
          const rawOrig = String(rec?.text || '').replace(/\s+/g, ' ').trim();
          if (!rawOrig || rawOrig.length < 18) continue;

          const parsedAttr = extractBeatAttributionFromText(rawOrig, acct);
          const cleanFull = cleanSensationalistText(parsedAttr.cleanedText || rawOrig);
          const extEmbed = post?.embed?.external || rec?.embed?.external || null;
          const combinedCheck = `${cleanFull} ${extEmbed?.title || ''}`;
          const hasExplicitSfKeyword = sfKeywordsRe.test(combinedCheck);
          const mentioned = matchPlayersClient(combinedCheck, rosterPlayers, 12, {
            allowUniqueSurnames: !acct.isNationalInsider || hasExplicitSfKeyword
          });

          if (acct.isNationalInsider && !hasExplicitSfKeyword && mentioned.length === 0) {
            continue;
          }

          const rkey = String(post?.uri || '').split('/').pop();
          if (!rkey) continue;
          const postUrl = `https://bsky.app/profile/${acct.actor}/post/${rkey}`;
          const textKey = cleanFull.toLowerCase().slice(0, 90);
          if (existingUrls.has(postUrl) || existingTextKeys.has(textKey)) continue;

          const sig = scoreContentSignal(cleanFull, '');
          if (sig.isClickbait) continue;

          const tweetDisplay = formatTweetBodyForDisplay(cleanFull, SHORT_TWEET_FULL_TEXT_LIMIT);
          const pubIso = rec?.createdAt || post?.indexedAt || new Date().toISOString();
          const brk = classifyBreakingItem({
            title: tweetDisplay.text,
            fullText: cleanFull,
            summary: extEmbed?.title || '',
            publishedAt: pubIso
          });

          const imgThumb = post?.embed?.images?.[0]?.thumb || extEmbed?.thumb || '';
          const safeExtUrl = sanitizeExternalUrl(extEmbed?.uri, null);

          existingUrls.add(postUrl);
          existingTextKeys.add(textKey);
          discovered.push({
            id: `bsky_live_${parsedAttr.reporterId}_${rkey}`,
            type: 'tweet',
            title: tweetDisplay.text,
            fullText: cleanFull,
            isFullTweet: tweetDisplay.isFullTweet,
            summary: safeExtUrl && extEmbed?.title ? cleanSensationalistText(extEmbed.title) : '',
            imageUrl: typeof imgThumb === 'string' && imgThumb.startsWith('https://') ? imgThumb : '',
            imageAlt: `${parsedAttr.reporterName} update`,
            mentionedPlayers: mentioned,
            publishedAt: pubIso,
            url: postUrl,
            externalUrl: safeExtUrl,
            externalTitle: safeExtUrl && extEmbed?.title ? cleanSensationalistText(extEmbed.title) : null,
            outletId: parsedAttr.outletId,
            outletName: parsedAttr.outletName,
            reporterId: parsedAttr.reporterId,
            reporterName: parsedAttr.reporterName,
            author: parsedAttr.reporterName,
            authorHandle: parsedAttr.authorHandle,
            authorProfileUrl: parsedAttr.xUrl || `https://bsky.app/profile/${acct.actor}`,
            trustTier: parsedAttr.trustTier,
            wireSource: 'bsky_mirror',
            isBreaking: brk.isBreaking,
            isInGameInjury: brk.isInGameInjury,
            breakingBadge: brk.breakingBadge,
            breakingPriority: brk.breakingPriority,
            category:
              brk.isInGameInjury || /injur|practice|questionable|ruled out|tent|locker room|return/i.test(cleanFull)
                ? 'injury'
                : 'beat',
            signalScore: Math.max(brk.isBreaking ? 92 : 76, sig.signalScore),
            fluffScore: sig.fluffScore,
            isClickbait: false
          });
        }
      } catch {
        // Ignore network/offline errors cleanly
      }
    })
  );

  if (discovered.length > 0) {
    appData.news.rawStream = sortNewsWithBreakingPriority([...discovered, ...appData.news.rawStream]);
    propagateLiveItemsToPlayerMentions(discovered, rosterPlayers);
  } else {
    appData.news.rawStream = sortNewsWithBreakingPriority(appData.news.rawStream);
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
  { maxPriority = 12, sweepBatchSize = 6, maxAgeDays = 7 } = {}
) {
  if (!appData?.news || !Array.isArray(appData.news.rawStream)) return 0;
  const rosterPlayers = appData.roster?.players || [];
  const validPlayers = rosterPlayers.filter(p => /^\d{4,10}$/.test(String(p.id || '')));
  if (validPlayers.length === 0) return 0;

  const priorityCohort = [];
  const priorityIds = new Set();

  // 1. Injured, Questionable/Doubtful/Out, or active 21-day IR return window players first
  const injuryCandidates = validPlayers.filter(p => {
    const st = String(p.health?.status || '').toLowerCase();
    return (
      Boolean(p.health?.isOnPracticeReport) ||
      ['out', 'doubtful', 'questionable'].includes(st) ||
      (p.rosterBucket === 'ir' && !p.health?.isSeasonEnding)
    );
  });
  for (const p of injuryCandidates) {
    if (priorityCohort.length >= maxPriority) break;
    priorityCohort.push(p);
    priorityIds.add(String(p.id));
  }

  // 2. Fill remaining Priority slots with top-cap / core active starters
  if (priorityCohort.length < maxPriority) {
    const coreSorted = validPlayers
      .filter(p => p.rosterBucket === 'active' && !priorityIds.has(String(p.id)))
      .sort((a, b) => (Number(b.capHit2026) || 0) - (Number(a.capHit2026) || 0));
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
        const apiUrl = `https://site.api.espn.com/apis/fantasy/v2/games/ffl/news/players?playerId=${encodeURIComponent(player.id)}&limit=4`;
        const res = await fetch(apiUrl, { cache: 'no-store' });
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

          // Ensure general league roundups in the feed actually reference this player or the 49ers
          const playerParts = String(player.name || '').replace(/\s+(?:Jr\.?|Sr\.?|II|III|IV|V)$/i, '').trim().split(/\s+/);
          const playerSurname = playerParts[playerParts.length - 1] || player.name;
          const relevanceCheck = `${rawHeadline} ${rawDesc}`;
          if (
            playerSurname &&
            !new RegExp(`\\b${escapeClientRegex(playerSurname)}\\b`, 'i').test(relevanceCheck) &&
            !/\b(49ers|niners|san francisco)\b/i.test(relevanceCheck)
          ) {
            continue;
          }

          const bylineHint = entry.byline
            ? String(entry.byline).replace(/^By\s+/i, '').split(/\s+and\s+|,/i)[0].trim()
            : '';
          const parsedAttr = extractBeatAttributionFromText(`${rawDesc} ${rawStory}`.trim(), {
            reporterId: null,
            reporterName: bylineHint || '49ers Beat Wire',
            outletId: 'espn',
            outletName: 'ESPN / X Beat Wire'
          });

          const cleanFull = cleanSensationalistText(parsedAttr.cleanedText || leadText);
          const directWebUrl = sanitizeExternalUrl(entry.links?.web?.href, null);
          if (!directWebUrl && !parsedAttr.viaWire && !bylineHint) continue;
          const wireIdToken = entry.id || hashWireKey(`${player.id}_${pubIso}_${cleanFull.slice(0, 40)}`);
          const isPlayerBlurb = Boolean(entry.story) || entry.type === 'PlayerNews' || entry.type === 'Rotowire' || !directWebUrl;
          const itemUrl = isPlayerBlurb
            ? resolveOriginalTweetUrl(
                {
                  type: 'tweet',
                  url: directWebUrl || '',
                  author: parsedAttr.author,
                  reporterId: parsedAttr.reporterId,
                  reporterName: parsedAttr.reporterName,
                  authorHandle: parsedAttr.authorHandle,
                  primaryPlayer: player,
                  fullText: cleanFull,
                  title: cleanFull,
                  publishedAt: new Date(pubMs).toISOString()
                },
                appData.news.rawStream
              )
            : directWebUrl;
          const textKey = cleanFull.toLowerCase().slice(0, 90);
          if (!itemUrl || existingTextKeys.has(textKey)) continue;

          const sig = scoreContentSignal(cleanFull, rawStory);
          if (sig.isClickbait) continue;

          const matchedOthers = matchPlayersClient(`${cleanFull} ${rawStory}`, rosterPlayers, 8);
          const primaryMention = {
            id: player.id,
            name: player.name,
            shortName: player.shortName || `${player.name[0]}. ${playerSurname}`,
            position: player.position,
            jersey: player.jersey,
            headshotUrl: player.headshotUrl || ''
          };
          const mentioned = [
            primaryMention,
            ...matchedOthers.filter(m => String(m.id) !== String(player.id))
          ];

          const tweetDisplay = formatTweetBodyForDisplay(cleanFull, SHORT_TWEET_FULL_TEXT_LIMIT);
          const brk = classifyBreakingItem({
            title: isPlayerBlurb ? tweetDisplay.text : rawHeadline || tweetDisplay.text,
            fullText: cleanFull,
            summary: rawStory || rawDesc,
            publishedAt: pubIso
          });

          existingUrls.add(itemUrl);
          existingTextKeys.add(textKey);

          discovered.push({
            id: `espn_pwire_${player.id}_${wireIdToken}`,
            type: isPlayerBlurb ? 'tweet' : 'article',
            title: isPlayerBlurb ? tweetDisplay.text : rawHeadline || tweetDisplay.text,
            fullText: isPlayerBlurb ? cleanFull : undefined,
            isFullTweet: isPlayerBlurb ? tweetDisplay.isFullTweet : undefined,
            summary: isPlayerBlurb
              ? rawStory && rawStory !== cleanFull
                ? rawStory
                : ''
              : rawDesc,
            imageUrl: player.headshotUrl?.startsWith('https://') ? player.headshotUrl : '',
            imageAlt: `${player.name} beat update`,
            mentionedPlayers: mentioned,
            publishedAt: new Date(pubMs).toISOString(),
            url: itemUrl,
            externalUrl: null,
            externalTitle: null,
            outletId: parsedAttr.outletId || 'espn',
            outletName: parsedAttr.outletName || 'ESPN / X Beat Wire',
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
                `${cleanFull} ${rawStory}`
              )
                ? 'injury'
                : 'beat',
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
    propagateLiveItemsToPlayerMentions(discovered, rosterPlayers);
  }
  return discovered.length;
}

/**
 * Polls RotoWire's CORS-enabled live NFL RSS stream (`rotowire.com/rss/news.php?sport=NFL`),
 * filtering strictly to 49ers players/team items and extracting X beat writer citations.
 */
export async function hydrateLiveRotoWireBeatRss(appData) {
  if (!appData?.news || !Array.isArray(appData.news.rawStream)) return 0;
  try {
    const res = await fetch('https://www.rotowire.com/rss/news.php?sport=NFL', { cache: 'no-store' });
    if (!res.ok) return 0;
    const xml = await res.text();
    if (!xml || !xml.includes('<item')) return 0;

    const rosterPlayers = appData.roster?.players || [];
    const existingUrls = new Set(appData.news.rawStream.map(it => it.url).filter(Boolean));
    const existingTextKeys = new Set(
      appData.news.rawStream.map(it => String(it.fullText || it.title || '').toLowerCase().slice(0, 90))
    );
    const sfTeamRe = /\b(49ers|niners|san francisco)\b/i;
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
      if (!hasExplicitSf && exactRosterMatches.length === 0) continue;

      const parsedAttr = extractBeatAttributionFromText(rawDesc || rawTitle, {
        reporterId: 'nick_wagoner',
        reporterName: '49ers Beat Wire',
        outletId: 'espn',
        outletName: 'RotoWire / X Beat'
      });

      const bodyText = cleanSensationalistText(rawDesc || rawTitle);
      const guidHash = hashWireKey(rawGuid || `${rawTitle}_${rawPub}`);
      const safeUrl =
        sanitizeExternalUrl(rawLink, null) ||
        `https://www.rotowire.com/football/news.php#sf-${guidHash}`;
      const textKey = bodyText.toLowerCase().slice(0, 90);
      if (existingUrls.has(safeUrl) || existingTextKeys.has(textKey)) continue;

      const pubMs = rawPub ? new Date(rawPub).getTime() : Date.now();
      const pubIso = Number.isFinite(pubMs) ? new Date(pubMs).toISOString() : new Date().toISOString();
      const tweetDisplay = formatTweetBodyForDisplay(bodyText, SHORT_TWEET_FULL_TEXT_LIMIT);
      const brk = classifyBreakingItem({
        title: tweetDisplay.text,
        fullText: bodyText,
        summary: rawTitle,
        publishedAt: pubIso
      });

      existingUrls.add(safeUrl);
      existingTextKeys.add(textKey);
      discovered.push({
        id: `rw_live_${guidHash}`,
        type: 'tweet',
        title: tweetDisplay.text,
        fullText: bodyText,
        isFullTweet: tweetDisplay.isFullTweet,
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
            : 'beat',
        signalScore: brk.isBreaking ? 94 : 84,
        fluffScore: 0,
        isClickbait: false
      });
    }

    if (discovered.length > 0) {
      appData.news.rawStream = sortNewsWithBreakingPriority([...discovered, ...appData.news.rawStream], Date.now(), { appData });
      propagateLiveItemsToPlayerMentions(discovered, rosterPlayers);
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
  try {
    const res = await fetch(
      'https://site.api.espn.com/apis/site/v2/sports/football/nfl/transactions?team=25&limit=20',
      { cache: 'no-store' }
    );
    if (!res.ok) return 0;
    const payload = await res.json();
    const txList = Array.isArray(payload?.transactions) ? payload.transactions : [];
    if (txList.length === 0) return 0;

    const rosterPlayers = appData.roster?.players || [];
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

      const fullLine = /^49ers\b|^San Francisco\b/i.test(desc) ? desc : `49ers roster move: ${desc}`;
      const txHash = hashWireKey(`${tx.date}_${desc}`);
      const txUrl = `https://www.49ers.com/team/transactions/#tx-${txHash}`;
      const textKey = fullLine.toLowerCase().slice(0, 90);
      if (existingUrls.has(txUrl) || existingTextKeys.has(textKey)) continue;

      const mentioned = matchPlayersClient(desc, rosterPlayers, 8);
      const pubIso = new Date(pubMs).toISOString();
      const tweetDisplay = formatTweetBodyForDisplay(fullLine, SHORT_TWEET_FULL_TEXT_LIMIT);
      const brk = classifyBreakingItem({
        title: tweetDisplay.text,
        fullText: fullLine,
        summary: 'Official San Francisco 49ers NFL transaction wire.',
        publishedAt: pubIso
      });

      existingUrls.add(txUrl);
      existingTextKeys.add(textKey);
      discovered.push({
        id: `sf_tx_live_${txHash}`,
        type: 'tweet',
        title: tweetDisplay.text,
        fullText: fullLine,
        isFullTweet: tweetDisplay.isFullTweet,
        summary: '',
        imageUrl: mentioned[0]?.headshotUrl || '',
        imageAlt: 'San Francisco 49ers transaction',
        mentionedPlayers: mentioned,
        publishedAt: pubIso,
        url: txUrl,
        externalUrl: null,
        externalTitle: null,
        outletId: '49ers_official',
        outletName: '49ers.com Official',
        reporterId: '49ers_news',
        reporterName: 'San Francisco 49ers Official',
        author: 'San Francisco 49ers Official',
        authorHandle: '@49ers',
        authorProfileUrl: 'https://x.com/49ers',
        trustTier: 1,
        wireSource: 'official_transactions',
        isBreaking: brk.isBreaking || nowMs - pubMs <= 18 * 3_600_000,
        isInGameInjury: brk.isInGameInjury,
        breakingBadge: brk.breakingBadge || (nowMs - pubMs <= 18 * 3_600_000 ? 'ROSTER MOVE' : null),
        breakingPriority: Math.max(brk.breakingPriority || 0, nowMs - pubMs <= 18 * 3_600_000 ? 74 : 0),
        category: /injured reserve|\bir\b|waived\/injured|physically unable/i.test(desc) ? 'injury' : 'roster',
        signalScore: 95,
        fluffScore: 0,
        isClickbait: false
      });
    }

    if (discovered.length > 0) {
      appData.news.rawStream = sortNewsWithBreakingPriority([...discovered, ...appData.news.rawStream], Date.now(), { appData });
      propagateLiveItemsToPlayerMentions(discovered, rosterPlayers);
    }
    return discovered.length;
  } catch {
    return 0;
  }
}

/**
 * Unified Multi-Source Sub-Minute Beat & Injury Wire Orchestrator.
 * Simultaneously polls:
 * 1. ESPN X-Beat Player Wire (24/7 beat tweet extraction for Priority Injured/Core + Rotating Roster Sweep)
 * 2. RotoWire Live NFL RSS (sub-minute pregame warmup & sideline status updates)
 * 3. Official 49ers NFL Transaction Wire (IR activations, 21-day windows, signings, trades)
 * 4. Beat & Insider Social Mirrors (Bluesky public XRPC)
 * Then cross-corroborates stories across reporters, elevating First-Mover Injury Scoops & Tier-1 confirmations.
 */
export async function hydrateLiveMultiSourceBeatWire(appData, { isGameLive = false } = {}) {
  if (!appData?.news || !Array.isArray(appData.news.rawStream)) {
    return { totalAdded: 0, bySource: { espnPlayerWire: 0, rotowireRss: 0, transactions: 0, bluesky: 0 } };
  }

  const results = await Promise.allSettled([
    hydrateLiveEspnPlayerBeatWire(appData, {
      maxPriority: isGameLive ? 16 : 12,
      sweepBatchSize: isGameLive ? 8 : 6
    }),
    hydrateLiveRotoWireBeatRss(appData),
    hydrateLiveTeamTransactionsWire(appData),
    hydrateLiveBlueskyBeatWire(appData)
  ]);

  const val = idx => (results[idx]?.status === 'fulfilled' ? Number(results[idx].value || 0) : 0);
  const bySource = {
    espnPlayerWire: val(0),
    rotowireRss: val(1),
    transactions: val(2),
    bluesky: val(3)
  };
  const totalAdded = bySource.espnPlayerWire + bySource.rotowireRss + bySource.transactions + bySource.bluesky;

  // Run cross-source corroboration & breaking/first-mover re-ranking across the combined stream
  appData.news.rawStream = sortNewsWithBreakingPriority(appData.news.rawStream, Date.now(), { appData });

  // Also refresh Game-Day Inactives & Active Roster if inside [T-90m, Final) window
  await hydrateLiveGameDayRosters(appData).catch(() => false);

  return { totalAdded, bySource };
}

function toEspnTeamSlugClient(abbr = '') {
  const c = String(abbr || '').trim().toLowerCase();
  if (c === 'was') return 'wsh';
  return c;
}

function parseEspnSummaryCompetitorRoster(summaryRaw, teamAbbr = 'SF') {
  const normTarget = normalizeTeamAbbrClient(teamAbbr);
  const rosters = Array.isArray(summaryRaw?.rosters) ? summaryRaw.rosters : [];
  const match = rosters.find(r => normalizeTeamAbbrClient(r?.team?.abbreviation || '') === normTarget);
  if (!match || !Array.isArray(match.roster)) return [];
  return match.roster.map(entry => {
    const ath = entry.athlete || {};
    const headshot = ath.headshot?.href || '';
    const id = ath.id ? String(ath.id) : '';
    return {
      playerId: id,
      displayName: ath.displayName || ath.fullName || '',
      position: entry.position?.abbreviation || ath.position?.abbreviation || 'ATH',
      jersey: entry.jersey ?? ath.jersey ?? null,
      active: entry.active !== undefined ? Boolean(entry.active) : undefined,
      isInactive: entry.active === false,
      starter: Boolean(entry.starter),
      didNotPlay: Boolean(entry.didNotPlay),
      headshotUrl: headshot.startsWith('http://') ? `https://${headshot.slice(7)}` : headshot,
      espnUrl: id ? buildEspnPlayerUrl(id, ath.displayName || '') : ''
    };
  });
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

/**
 * Hydrates 49ers & Opponent Game-Day Inactives + Collapsible Active Roster (`[T-90m, Final)`)
 * and resolves `Questionable`/`Doubtful` players to deterministic `In (Active)` or `Out (Inactive)`.
 * Automatically clears `gameDayRoster` immediately once the game is Final.
 */
export async function hydrateLiveGameDayRosters(appData, nowMs = Date.now()) {
  if (!appData) return false;
  const um = appData.scheduleMatchup?.upcomingMatchup || null;
  const windowState = evaluateGameDayWindow(appData.scheduleMatchup?.schedule || [], um, nowMs);

  if (!windowState.isActive) {
    let cleared = false;
    if (appData.health?.gameDayRoster?.isActive) {
      appData.health.gameDayRoster = null;
      cleared = true;
    }
    if (um?.opponentHealth?.gameDayRoster?.isActive) {
      um.opponentHealth.gameDayRoster = null;
      cleared = true;
    }
    return cleared;
  }

  const fetchJsonNoStore = async url => {
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) return null;
    return res.json();
  };

  const oppAbbr = normalizeTeamAbbrClient(windowState.oppAbbr || um?.oppAbbr || '');
  const oppName = windowState.oppName || um?.oppName || oppAbbr;
  const oh = um?.opponentHealth || null;

  const [summaryRaw, oppRosterRaw] = await Promise.all([
    windowState.gameId && /^\d+$/.test(String(windowState.gameId))
      ? fetchJsonNoStore(
          `https://site.api.espn.com/apis/site/v2/sports/football/nfl/summary?event=${encodeURIComponent(windowState.gameId)}`
        ).catch(() => null)
      : Promise.resolve(null),
    oh && (!Array.isArray(oh.activeRoster) || oh.activeRoster.length < 30) && oppAbbr
      ? fetchJsonNoStore(
          `https://site.api.espn.com/apis/site/v2/sports/football/nfl/teams/${toEspnTeamSlugClient(oppAbbr)}/roster`
        ).catch(() => null)
      : Promise.resolve(null)
  ]);

  if (oh && oppRosterRaw?.athletes?.length && (!Array.isArray(oh.activeRoster) || oh.activeRoster.length < 30)) {
    const starterSet = new Set(
      [...(oh.keyStartersHealthy || []), ...(oh.injuryReport || []).filter(p => p.isStarter)].map(p =>
        normPlayerNameKey(p.name)
      )
    );
    oh.activeRoster = extractActiveRosterFromEspnTeamRoster(oppRosterRaw, starterSet);
  }

  const sfCompEntries = parseEspnSummaryCompetitorRoster(summaryRaw, 'SF');
  const oppCompEntries = oppAbbr ? parseEspnSummaryCompetitorRoster(summaryRaw, oppAbbr) : [];

  if (appData.health) {
    const sfActivePlayers = (appData.roster?.players || []).filter(p => p.rosterBucket === 'active');
    const sfModel = buildTeamGameDayRosterModel({
      teamAbbr: 'SF',
      teamName: 'San Francisco 49ers',
      activeRosterPlayers: sfActivePlayers,
      injuryReport: appData.health.practiceReport || [],
      competitorEntries: sfCompEntries,
      newsItems: appData.news?.rawStream || [],
      windowState
    });
    appData.health.gameDayRoster = sfModel;
    if (Array.isArray(appData.health.practiceReport)) {
      appData.health.practiceReport = resolveGameDayInjuryRows(appData.health.practiceReport, sfModel);
    }
  }

  if (oh && oppAbbr) {
    const fallbackOppPlayers = [
      ...(oh.activeRoster || []),
      ...(oh.keyStartersHealthy || []),
      ...(oh.injuryReport || [])
    ];
    const oppModel = buildTeamGameDayRosterModel({
      teamAbbr: oppAbbr,
      teamName: oppName,
      activeRosterPlayers: fallbackOppPlayers,
      injuryReport: oh.injuryReport || [],
      competitorEntries: oppCompEntries,
      newsItems: appData.news?.rawStream || [],
      windowState
    });
    oh.gameDayRoster = oppModel;
    if (Array.isArray(oh.injuryReport)) {
      oh.injuryReport = resolveGameDayInjuryRows(oh.injuryReport, oppModel);
    }
  }

  return true;
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

/**
 * Zero-server real-time client hydration directly from CORS-enabled ESPN NFL APIs
 * (`site.api.espn.com` + `site.web.api.espn.com`). Automatically updates standings,
 * live game state & scores, week rollover (`upcomingMatchup` + Pickcenter odds), 49ers & opponent
 * injury play probabilities, 10,000-run Monte Carlo playoff odds, and ESPN beat articles.
 */
export async function hydrateLiveEspnOverlay(appData) {
  if (!appData?.meta || !appData?.scheduleMatchup) return false;
  let mutated = false;
  let standingsOrScoresChanged = false;

  const fetchCorsJson = async url => {
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) return null;
    return res.json();
  };

  const [standingsRaw, scheduleRaw, injuriesRaw, espnNewsRaw] = await Promise.all([
    fetchCorsJson('https://site.web.api.espn.com/apis/v2/sports/football/nfl/standings').catch(() => null),
    fetchCorsJson('https://site.api.espn.com/apis/site/v2/sports/football/nfl/teams/sf/schedule').catch(() => null),
    fetchCorsJson('https://site.api.espn.com/apis/site/v2/sports/football/nfl/injuries').catch(() => null),
    fetchCorsJson('https://site.api.espn.com/apis/site/v2/sports/football/nfl/news?team=25&limit=25').catch(() => null)
  ]);
  let combinedEspnArticles = Array.isArray(espnNewsRaw?.articles) ? [...espnNewsRaw.articles] : [];

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

    const sfSt = teamRecords.get('SF');
    if (sfSt) {
      const nfcWestRanked = ['SF', 'SEA', 'LAR', 'ARI']
        .map(a => ({ abbr: a, ...(teamRecords.get(a) || { winPct: 0, wins: 0, pd: 0 }) }))
        .sort((a, b) => b.winPct - a.winPct || b.wins - a.wins || b.pd - a.pd);
      const divIdx = Math.max(0, nfcWestRanked.findIndex(t => t.abbr === 'SF'));
      const divOrd = ['1st', '2nd', '3rd', '4th'][divIdx] || '1st';
      const newSummary = `${divOrd} in NFC West • #${sfSt.seed} Seed in NFC`;
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
    }
  }

  let weekAdvancedFlag = false;
  let nextGameKickoffIso =
    appData.scheduleMatchup?.upcomingMatchup?.kickoffIso ||
    appData.scheduleMatchup?.upcomingMatchup?.dateIso ||
    '';

  // 2. Live Schedule Scores, In-Game Live State & Automatic Week Rollover
  if (scheduleRaw?.events?.length && Array.isArray(appData.scheduleMatchup.schedule)) {
    const byWeek = new Map(appData.scheduleMatchup.schedule.map(g => [Number(g.week), g]));
    for (const ev of scheduleRaw.events) {
      const wk = Number(ev.week?.number || 0);
      const item = byWeek.get(wk);
      if (!item) continue;
      const comp = ev.competitions?.[0] || {};
      const sfComp = (comp.competitors || []).find(c => c.team?.abbreviation === 'SF');
      const oppComp = (comp.competitors || []).find(c => c.team?.abbreviation !== 'SF');
      const completed = Boolean(comp.status?.type?.completed);
      const liveState = String(comp.status?.type?.state || '').toLowerCase();
      item.statusState = liveState;

      if (completed && !item.completed) standingsOrScoresChanged = true;
      if (completed || liveState === 'in') {
        const sfSc = Number(sfComp?.score?.value ?? sfComp?.score?.displayValue ?? item.sfScore ?? 0);
        const opSc = Number(oppComp?.score?.value ?? oppComp?.score?.displayValue ?? item.oppScore ?? 0);
        item.sfScore = sfSc;
        item.oppScore = opSc;
        if (completed) {
          item.completed = true;
          item.result = sfSc > opSc ? 'W' : sfSc < opSc ? 'L' : 'T';
        }
      }
      if (comp.status?.type?.shortDetail) {
        item.statusDetail = comp.status.type.shortDetail;
      }
      const oppLive = teamRecords.get(normalizeTeamAbbrClient(item.opponent?.abbr));
      if (oppLive && item.opponent) {
        item.opponent.record = oppLive.record;
        item.opponent.pointDiff = oppLive.pd;
      }
      mutated = true;
    }

    const nextGame =
      appData.scheduleMatchup.schedule.find(g => !g.completed) ||
      appData.scheduleMatchup.schedule[appData.scheduleMatchup.schedule.length - 1];

    if (nextGame) {
      const um = appData.scheduleMatchup.upcomingMatchup || {};
      const nextWk = Number(nextGame.week || appData.meta.currentWeek || 9);
      const weekAdvanced = Boolean(um.week && nextWk !== Number(um.week));
      if (weekAdvanced) weekAdvancedFlag = true;
      nextGameKickoffIso = nextGame.dateIso || um.kickoffIso || nextGameKickoffIso;

      appData.meta.currentWeek = nextWk;
      if (appData.meta.teamStatus) appData.meta.teamStatus.currentWeek = nextWk;
      if (appData.health) appData.health.week = nextWk;
      um.liveState = nextGame.statusState || um.liveState || 'pre';

      const oppAbbr = normalizeTeamAbbrClient(nextGame.opponent?.abbr || um.oppAbbr || 'LV');
      const oppLiveRec = teamRecords.get(oppAbbr)?.record || nextGame.opponent?.record || um.oppRecord;
      if (oppLiveRec) um.oppRecord = oppLiveRec;
      if (appData.meta.teamRecord) {
        const divOrdPart = (appData.meta.standingSummary || '').split('•')[0]?.trim() || 'NFC West';
        um.sfRecord = `${appData.meta.teamRecord} (${divOrdPart})`;
      }

      if (weekAdvanced) {
        const dt = nextGame.dateIso ? new Date(nextGame.dateIso) : null;
        const kickoffFmt = dt && !Number.isNaN(dt.getTime())
          ? `${dt.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'America/Los_Angeles' })} • ${dt.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'America/Los_Angeles' })} PT (${nextGame.broadcast || 'NFL'})`
          : nextGame.statusDetail || '';

        um.week = nextWk;
        um.gameId = nextGame.id || um.gameId;
        um.gameUrl = nextGame.gameUrl || um.gameUrl;
        um.oppAbbr = oppAbbr;
        um.oppName = nextGame.opponent?.name || oppAbbr;
        um.oppLogoUrl = nextGame.opponent?.logoUrl || buildEspnTeamLogoUrl(oppAbbr);
        um.homeAway = nextGame.homeAway || 'home';
        um.kickoffIso = nextGame.dateIso || um.kickoffIso;
        um.kickoffDisplay = kickoffFmt;
        um.venue = `${nextGame.venue?.name || ''}${nextGame.venue?.city ? ` (${nextGame.venue.city})` : ''} • ${nextGame.venue?.surface || 'Grass'}`;
        um.coachingMatchup = {
          headline: `Kyle Shanahan vs. ${nextGame.opponent?.coach || `${um.oppName} Staff`} (${nextGame.homeAway === 'home' ? "Levi's Stadium" : 'Road Test'})`,
          summary: `Week ${nextWk} schematic matchup pitting Kyle Shanahan's 21/11-personnel motion and Wide-9 defensive front against ${um.oppName} (${um.oppRecord}).`
        };
        if (um.franchiseHistory) {
          um.franchiseHistory.pfrQueryUrl = buildPfrHeadToHeadUrl('SF', oppAbbr);
        }
        if (um.opponentHealth) {
          um.opponentHealth.teamAbbr = oppAbbr;
          um.opponentHealth.teamName = um.oppName;
          um.opponentHealth.teamInjuriesUrl = buildEspnTeamInjuriesUrl(oppAbbr);
          um.opponentHealth.gameDayRoster = null;
          um.opponentHealth.injuryReport = [];
          um.opponentHealth.keyStartersHealthy = [];
          um.opponentHealth.irReserve = [];
          um.opponentHealth.activeRoster = [];

          const oppSlug = toEspnTeamSlugClient(oppAbbr);
          const [oppRosterRaw, oppDepthRaw] = await Promise.all([
            fetchCorsJson(`https://site.api.espn.com/apis/site/v2/sports/football/nfl/teams/${oppSlug}/roster`).catch(() => null),
            fetchCorsJson(`https://site.api.espn.com/apis/site/v2/sports/football/nfl/teams/${oppSlug}/depthcharts`).catch(() => null)
          ]);

          const oppStarterSet = new Set();
          for (const dc of oppDepthRaw?.depthchart || []) {
            for (const posObj of Object.values(dc.positions || {})) {
              const starterName = posObj?.athletes?.[0]?.displayName;
              if (starterName) oppStarterSet.add(normPlayerNameKey(starterName));
            }
          }

          if (oppRosterRaw?.athletes?.length) {
            const activeOppList = extractActiveRosterFromEspnTeamRoster(oppRosterRaw, oppStarterSet);
            um.opponentHealth.activeRoster = activeOppList;
            um.opponentHealth.keyStartersHealthy = activeOppList
              .filter(p => p.isStarter && p.unit !== 'Special Teams')
              .slice(0, 12)
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
            um.opponentHealth.summary = {
              ...(um.opponentHealth.summary || {}),
              irCount: irList.length
            };
          }
        }
      }

      if (nextGame.id) {
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

  // 3. Re-run 10,000-trial Playoff Monte Carlo if standings or completed games changed
  if (standingsOrScoresChanged && appData.seasonal?.playoffPicture?.simulatorInputs) {
    try {
      const simIn = appData.seasonal.playoffPicture.simulatorInputs;
      let prunedRemainingCount = 0;
      // Ensure newly completed SF schedule games are moved out of remainingGames so SF never exceeds 17 games
      const completedSfWeeks = new Set(
        (appData.scheduleMatchup?.schedule || []).filter(g => g.completed).map(g => Number(g.week))
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
            const schedItem = (appData.scheduleMatchup?.schedule || []).find(s => Number(s.week) === Number(nd.week));
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

      const freshMc = runPlayoffMonteCarlo({ ...simIn, iterations: 10000, seed: 492026 });
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

  // 4. Live ESPN Injury Designations (49ers + Upcoming Opponent)
  const earlyWeekBlankPractice = isBeforeWeeklyPracticeWindow(nextGameKickoffIso);
  if (Array.isArray(injuriesRaw?.injuries)) {
    const sfTeamInj = injuriesRaw.injuries.find(
      t => String(t.id) === '25' || /49ers/i.test(t.displayName || '')
    );
    const activeOppAbbr = normalizeTeamAbbrClient(appData.scheduleMatchup.upcomingMatchup?.oppAbbr || '');
    const oppTeamInj = injuriesRaw.injuries.find(t => {
      const sampleAbbr = normalizeTeamAbbrClient(t.injuries?.[0]?.athlete?.team?.abbreviation || '');
      return sampleAbbr === activeOppAbbr || (appData.scheduleMatchup.upcomingMatchup?.oppName && t.displayName === appData.scheduleMatchup.upcomingMatchup.oppName);
    });

    if (sfTeamInj?.injuries && Array.isArray(appData.roster?.players)) {
      const rosterByNorm = new Map(appData.roster.players.map(p => [normPlayerNameKey(p.name), p]));

      // When rolling over to a new upcoming week (before Wednesday practice), drop prior-week cleared / Vet Rest entries
      if (weekAdvancedFlag || earlyWeekBlankPractice) {
        const liveInjuredKeys = new Set();
        for (const item of sfTeamInj.injuries) {
          const nm = item.athlete?.displayName || '';
          const k = normPlayerNameKey(nm);
          const stL = String(item.status || '').toLowerCase();
          const bPart = item.details?.type || extractBodyPartSafe(item.shortComment || '') || '';
          const isRest = /not injury related|nir\s*-?\s*rest|\brest\b/i.test(bPart);
          if (k && !isRest && (['out', 'doubtful', 'questionable'].includes(stL) || Boolean(bPart))) {
            liveInjuredKeys.add(k);
          }
        }
        for (const p of appData.roster.players) {
          if (!p?.health) continue;
          const k = normPlayerNameKey(p.name);
          if (earlyWeekBlankPractice) {
            p.health.wed = '-';
            p.health.thu = '-';
            p.health.fri = '-';
          }
          if (p.rosterBucket === 'active' && !liveInjuredKeys.has(k)) {
            const wasVetRest =
              p.health.wed === 'Vet Rest' ||
              /not injury related|nir\s*-?\s*rest|\brest\b/i.test(p.health.injuryType || '');
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
        const shortC = cleanSensationalistText(item.shortComment || '');
        const longC = cleanSensationalistText(item.longComment || shortC);
        const combinedText = `${shortC} ${longC}`.trim();
        const bodyPart = item.details?.type || extractBodyPartSafe(shortC) || rp.health.injuryType || '';
        const sfEarlyRoll =
          earlyWeekBlankPractice && rp.rosterBucket === 'active'
            ? resolveEarlyWeekRolloverInput({
                rawStatus,
                injuryType: bodyPart,
                shortComment: shortC,
                longComment: longC,
                upcomingWeek: appData.scheduleMatchup.upcomingMatchup?.week
              })
            : null;
        if (sfEarlyRoll?.skip) {
          rp.health.isOnPracticeReport = false;
          continue;
        }
        const notActivated =
          /not activated|didn't activate|did not activate|remains on injured reserve|ruled out|will miss /i.test(
            combinedText
          );
        const isIrReturnQ =
          rp.rosterBucket === 'ir' &&
          !rp.health.isSeasonEnding &&
          !notActivated &&
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
          rosterBucket: rp.rosterBucket,
          isSeasonEnding: Boolean(rp.health.isSeasonEnding),
          gameStatus: effectiveStatusForModel,
          isIrReturnQuestionable: isIrReturnQ,
          injuryType: bodyPart,
          wed: rp.health.wed,
          thu: rp.health.thu,
          fri: rp.health.fri,
          beatNote: sfEarlyRoll ? sfEarlyRoll.beatNoteForModel : combinedText
        });

        // Preserve authoritative IR sub-status ('Season-Ending IR', 'IR — 21-Day Window Open', 'Reserve / PUP', etc.)
        if (rp.rosterBucket === 'active') {
          rp.health.status = sfEarlyRoll
            ? sfEarlyRoll.effectiveStatus
            : hasExplicitGameDesignation
              ? rawStatus
              : hasEarlyWeekSustainedInjury
                ? 'Questionable'
                : rp.health.status;
        } else if (isIrReturnQ) {
          rp.health.status = 'Questionable (IR Return Window)';
        }
        if (bodyPart) rp.health.injuryType = bodyPart;
        if (shortC) rp.health.shortComment = shortC;
        if (longC) rp.health.longComment = longC;
        rp.health.playProbabilityPct = playProb.probabilityPct;
        rp.health.playTier = playProb.tier;
        rp.health.playBadgeLabel = playProb.badgeLabel;
        rp.health.isOnPracticeReport =
          (rp.rosterBucket === 'active' &&
            (wasOnOfficialReport || hasExplicitGameDesignation || hasEarlyWeekSustainedInjury)) ||
          isIrReturnQ;
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
            wed: earlyWeekBlankPractice ? '-' : p.health.wed || '-',
            thu: earlyWeekBlankPractice ? '-' : p.health.thu || '-',
            fri: earlyWeekBlankPractice ? '-' : p.health.fri || '-',
            injuryType: p.health.injuryType || 'Cleared — No Designation',
            gameStatus: p.health.status,
            playProbabilityPct: p.health.playProbabilityPct,
            playBadgeLabel: p.health.playBadgeLabel,
            archetypeNote: p.health.archetypeNote || '',
            factors: p.health.factors || [],
            beatComment: p.health.longComment || p.health.shortComment || ''
          }));
      }
      mutated = true;
    }

    if (oppTeamInj?.injuries && appData.scheduleMatchup.upcomingMatchup?.opponentHealth) {
      const oh = appData.scheduleMatchup.upcomingMatchup.opponentHealth;
      const existingReportByKey = new Map(
        (oh.injuryReport || [])
          .filter(p => {
            if (!earlyWeekBlankPractice && !weekAdvancedFlag) return true;
            const stL = String(p.gameStatus || '').toLowerCase();
            const injL = String(p.injuryType || '').toLowerCase();
            if (/not injury related|nir\s*-?\s*rest|\brest\b/i.test(injL) || p.wed === 'Vet Rest') return false;
            return ['out', 'doubtful', 'questionable'].includes(stL) || Boolean(p.isIrReturnQuestionable);
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
        const shortC = cleanSensationalistText(item.shortComment || '');
        const longC = cleanSensationalistText(item.longComment || shortC);
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
                rawStatus: rawSt,
                injuryType: bodyPart,
                shortComment: shortC,
                longComment: longC,
                upcomingWeek: appData.scheduleMatchup.upcomingMatchup?.week
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
        const hasOfficialDays =
          !earlyWeekBlankPractice &&
          existingRep &&
          (existingRep.wed !== '-' || existingRep.thu !== '-' || existingRep.fri !== '-');
        const { wed, thu, fri } = earlyWeekBlankPractice
          ? { wed: '-', thu: '-', fri: '-' }
          : hasOfficialDays
            ? { wed: existingRep.wed, thu: existingRep.thu, fri: existingRep.fri }
            : extractPracticeDaysFromText({
                statusRaw: isIrRetQ ? 'Questionable' : rawSt,
                injuryType: bodyPart,
                shortComment: shortC,
                longComment: longC
              });
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
        oh.summary = {
          ...(oh.summary || {}),
          ruledOutCount: liveOppReport.filter(p => p.playProbabilityPct === 0).length,
          questionableOrDoubtfulCount: liveOppReport.filter(p => p.playProbabilityPct > 0 && p.playProbabilityPct < 85).length,
          clearedCount: liveOppReport.filter(p => p.playProbabilityPct >= 85).length
        };
        mutated = true;
      }
    }
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
      const sig = scoreContentSignal(title, summary);
      if (sig.isClickbait) continue;
      let imgUrl = art.images?.[0]?.url || '';
      if (imgUrl.startsWith('http://')) imgUrl = `https://${imgUrl.slice(7)}`;
      const bylineClean = art.byline
        ? cleanSensationalistText(String(art.byline).replace(/^By\s+/i, '').split(/\s+and\s+|,/i)[0].trim())
        : 'Nick Wagoner';
      const bylineLower = bylineClean.toLowerCase();
      const matchedRep = (appData.reporters?.reporters || []).find(
        r => r.name && r.name.toLowerCase() === bylineLower
      );
      const dirEntry = resolveReporterFromNameOrHandle(matchedRep?.id || bylineClean);
      const resolvedReporterId =
        matchedRep?.id || dirEntry?.id || (/schefter/i.test(bylineClean) ? 'adam_schefter' : 'nick_wagoner');
      const pubIso = art.published || new Date().toISOString();
      const brk = classifyBreakingItem({ title, summary, publishedAt: pubIso }, Date.now(), { appData });
      const mentioned = matchPlayersClient(`${title} ${summary}`, rosterPlayers, 12);

      existingUrls.add(url);
      newArts.push({
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
        authorProfileUrl: matchedRep?.xUrl || dirEntry?.xUrl || matchedRep?.profileUrl || null,
        trustTier: dirEntry?.trustTier || 1,
        isBreaking: brk.isBreaking,
        isInGameInjury: brk.isInGameInjury,
        breakingBadge: brk.breakingBadge,
        breakingPriority: brk.breakingPriority,
        category: brk.isInGameInjury || /injur|bosa|questionable|return/i.test(title) ? 'injury' : 'beat',
        signalScore: Math.max(70, sig.signalScore),
        fluffScore: sig.fluffScore,
        isClickbait: false
      });
    }
    if (newArts.length > 0) {
      appData.news.rawStream = sortNewsWithBreakingPriority([...newArts, ...appData.news.rawStream], Date.now(), {
        appData
      });
      propagateLiveItemsToPlayerMentions(newArts, rosterPlayers);
      mutated = true;
    }
  }

  // 6. Game-Day Inactives & Active Roster Window ([T-90m, Final))
  const gdMutated = await hydrateLiveGameDayRosters(appData).catch(() => false);
  if (gdMutated) mutated = true;

  if (mutated) {
    appData.meta.updatedAt = new Date().toISOString();
  }
  return mutated;
}

/**
 * Live client-side refresh of the 6 flagship 49ers podcasts over the last 7 days
 * directly from Apple Podcasts' CORS-enabled Lookup API (`itunes.apple.com/lookup`).
 */
export async function hydrateLive49ersPodcasts(appData) {
  if (!appData) return false;
  try {
    const ids = FLAGSHIP_PODCAST_SHOWS_CLIENT.map(s => s.collectionId).join(',');
    const res = await fetch(
      `https://itunes.apple.com/lookup?id=${ids}&entity=podcastEpisode&limit=12`,
      { cache: 'no-cache' }
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
      const showCfg = FLAGSHIP_PODCAST_SHOWS_CLIENT.find(s => s.collectionId === Number(r.collectionId));
      if (!showCfg) continue;
      const pubMs = r.releaseDate ? new Date(r.releaseDate).getTime() : 0;
      if (!pubMs || nowMs - pubMs > windowMs) continue;

      const showMeta = showMetaById.get(showCfg.collectionId) || {};
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
        summary: summary || `${showCfg.name} episode analyzing the latest San Francisco 49ers news and film.`,
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

    const shows = FLAGSHIP_PODCAST_SHOWS_CLIENT.map(s => {
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
