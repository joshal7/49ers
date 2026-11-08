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
  buildEspnPlayerUrl,
  buildEspnTeamInjuriesUrl,
  buildEspnTeamLogoUrl,
  buildPfrHeadToHeadUrl,
  sanitizeExternalUrl
} from '../engine/linkIntegrity.js';

const STORAGE_KEY = 'joshal_49ers_hq_prefs_v1';
const GITHUB_RAW_DATA_BASE = 'https://raw.githubusercontent.com/joshal7/49ers/main/data';

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
    reporterId: 'matt_barrows',
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
  workerBaseUrl: '',
  capSelectedYear: null,
  capMoves: {}, // playerId -> action (primary year backward-compatible)
  capMovesByYear: {}, // year -> { playerId -> action }
  playoffForcedWinners: {}, // gameId -> 'HOME' | 'AWAY'
  localCustomAnalyses: [],
  localCustomEpisodes: []
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
      localCustomEpisodes: Array.isArray(parsed.localCustomEpisodes) ? parsed.localCustomEpisodes : []
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
    news.rawStream = sortNewsWithBreakingPriority(news.rawStream);
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

function parseInsiderAttributionClient(rawText = '', defaultAcct = {}) {
  const prefixMatch = String(rawText || '').match(
    /^\[?(Schefter|Rapoport|Pelissero|Garafolo|Russini|Breer|Maiocco|Barrows)\]?:\s*([\s\S]+)$/i
  );
  if (!prefixMatch) {
    return {
      text: rawText,
      reporterId: defaultAcct.reporterId,
      reporterName: defaultAcct.reporterName,
      authorHandle: defaultAcct.authorHandle,
      outletId: defaultAcct.outletId,
      outletName: defaultAcct.outletName
    };
  }
  const tag = prefixMatch[1].toLowerCase();
  const body = prefixMatch[2].trim();
  const map = {
    schefter: { reporterId: 'adam_schefter', reporterName: 'Adam Schefter', authorHandle: '@AdamSchefter', outletId: 'espn', outletName: 'ESPN NFL Insider' },
    rapoport: { reporterId: 'ian_rapoport', reporterName: 'Ian Rapoport', authorHandle: '@RapSheet', outletId: 'nfl_network', outletName: 'NFL Network' },
    pelissero: { reporterId: 'tom_pelissero', reporterName: 'Tom Pelissero', authorHandle: '@TomPelissero', outletId: 'nfl_network', outletName: 'NFL Network' },
    garafolo: { reporterId: 'mike_garafolo', reporterName: 'Mike Garafolo', authorHandle: '@MikeGarafolo', outletId: 'nfl_network', outletName: 'NFL Network' },
    russini: { reporterId: 'dianna_russini', reporterName: 'Dianna Russini', authorHandle: '@DMRussini', outletId: 'athletic', outletName: 'The Athletic' },
    breer: { reporterId: 'albert_breer', reporterName: 'Albert Breer', authorHandle: '@AlbertBreer', outletId: 'nfl_network', outletName: 'Sports Illustrated / MMQB' },
    maiocco: { reporterId: 'matt_maiocco', reporterName: 'Matt Maiocco', authorHandle: '@MaioccoNBCS', outletId: 'nbcsba', outletName: 'NBC Sports Bay Area' },
    barrows: { reporterId: 'matt_barrows', reporterName: 'Matt Barrows', authorHandle: '@mattbarrows', outletId: 'athletic', outletName: 'The Athletic' }
  };
  return {
    text: body,
    ...(map[tag] || {
      reporterId: defaultAcct.reporterId,
      reporterName: defaultAcct.reporterName,
      authorHandle: defaultAcct.authorHandle,
      outletId: defaultAcct.outletId,
      outletName: defaultAcct.outletName
    })
  };
}

function matchPlayersClient(text = '', rosterPlayers = [], max = 12) {
  const hay = String(text || '').toLowerCase();
  if (!hay) return [];
  const hits = [];
  for (const p of rosterPlayers) {
    if (hits.length >= max) break;
    const fullLower = p.name.toLowerCase();
    const strippedLower = fullLower.replace(/\s+(sr\.?|jr\.?|ii|iii|iv)$/i, '').trim();
    if (hay.includes(fullLower) || (strippedLower.length >= 6 && hay.includes(strippedLower))) {
      const cleanParts = p.name
        .replace(/\s+(?:sr\.?|jr\.?|ii|iii|iv|v)$/i, '')
        .trim()
        .split(/\s+/);
      const surname = cleanParts[cleanParts.length - 1] || p.name;
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

          const parsedAttr = parseInsiderAttributionClient(rawOrig, acct);
          const cleanFull = cleanSensationalistText(parsedAttr.text);
          const extEmbed = post?.embed?.external || rec?.embed?.external || null;
          const combinedCheck = `${cleanFull} ${extEmbed?.title || ''}`;
          const mentioned = matchPlayersClient(combinedCheck, rosterPlayers, 12);

          if (acct.isNationalInsider && !sfKeywordsRe.test(combinedCheck) && mentioned.length === 0) {
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
            imageAlt: `${parsedAttr.reporterName} tweet`,
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
            authorProfileUrl: `https://bsky.app/profile/${acct.actor}`,
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
    // Re-evaluate time-sensitive breaking priority decay cleanly
    appData.news.rawStream = sortNewsWithBreakingPriority(appData.news.rawStream);
  }
  return discovered.length;
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
      const weekAdvanced = um.week && nextWk !== Number(um.week);
      appData.meta.currentWeek = nextWk;
      if (appData.meta.teamStatus) appData.meta.teamStatus.currentWeek = nextWk;
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
          um.opponentHealth.injuryReport = [];
          um.opponentHealth.keyStartersHealthy = [];
          um.opponentHealth.irReserve = [];
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
  if (Array.isArray(injuriesRaw?.injuries)) {
    const sfTeamInj = injuriesRaw.injuries.find(
      t => String(t.id) === '25' || /49ers/i.test(t.displayName || '')
    );
    const activeOppAbbr = normalizeTeamAbbrClient(appData.scheduleMatchup.upcomingMatchup?.oppAbbr || '');
    const oppTeamInj = injuriesRaw.injuries.find(t => {
      const sampleAbbr = normalizeTeamAbbrClient(t.injuries?.[0]?.athlete?.team?.abbreviation || '');
      return sampleAbbr === activeOppAbbr || (appData.scheduleMatchup.upcomingMatchup?.oppName && t.displayName === appData.scheduleMatchup.upcomingMatchup.oppName);
    });

    if (sfTeamInj?.injuries?.length && Array.isArray(appData.roster?.players)) {
      const rosterByNorm = new Map(appData.roster.players.map(p => [normPlayerNameKey(p.name), p]));
      for (const item of sfTeamInj.injuries) {
        const nm = item.athlete?.displayName || '';
        const rp = rosterByNorm.get(normPlayerNameKey(nm));
        if (!rp || !rp.health) continue;
        const rawStatus = item.status || rp.health.status || 'Active';
        const rawLower = rawStatus.toLowerCase();
        const shortC = cleanSensationalistText(item.shortComment || '');
        const longC = cleanSensationalistText(item.longComment || shortC);
        const combinedText = `${shortC} ${longC}`.trim();
        const bodyPart = rp.health.injuryType || item.details?.type || extractBodyPartSafe(shortC) || '';
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
        const wasOnOfficialReport = Boolean(rp.health.isOnPracticeReport);

        if (rp.rosterBucket === 'active' && !wasOnOfficialReport && !hasExplicitGameDesignation) {
          continue;
        }

        const effectiveStatusForModel = isIrReturnQ
          ? 'Questionable'
          : rp.rosterBucket === 'ir' || rp.rosterBucket === 'suspended'
            ? rp.health.status || rawStatus
            : hasExplicitGameDesignation
              ? rawStatus
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
          beatNote: combinedText
        });

        // Preserve authoritative IR sub-status ('Season-Ending IR', 'IR — 21-Day Window Open', 'Reserve / PUP', etc.)
        if (rp.rosterBucket === 'active') {
          rp.health.status = hasExplicitGameDesignation ? rawStatus : rp.health.status;
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
          (rp.rosterBucket === 'active' && (wasOnOfficialReport || hasExplicitGameDesignation)) || isIrReturnQ;
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
            wed: p.health.wed || '-',
            thu: p.health.thu || '-',
            fri: p.health.fri || '-',
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
        (oh.injuryReport || []).map(p => [normPlayerNameKey(p.name), p])
      );
      const prevByName = new Map(
        [...(oh.injuryReport || []), ...(oh.keyStartersHealthy || []), ...(oh.irReserve || [])].map(p => [
          normPlayerNameKey(p.name),
          p
        ])
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

        const bodyPart = existingRep?.injuryType || item.details?.type || extractBodyPartSafe(shortC) || prevEntry?.injuryType || '';
        const isReportWorthy =
          Boolean(existingRep) ||
          isIrRetQ ||
          ['out', 'doubtful', 'questionable'].includes(stLower) ||
          (existingReportByKey.size === 0 &&
            Boolean(bodyPart) &&
            /(designation|questionable|ruled out|will miss|doubtful)/i.test(shortC));
        if (!isReportWorthy) continue;

        const headshot = ath.headshot?.href || prevEntry?.headshotUrl || '';
        const espnIdM = headshot.match(/\/(\d+)\.png/);
        const espnId = espnIdM ? espnIdM[1] : '';
        const hasOfficialDays =
          existingRep && (existingRep.wed !== '-' || existingRep.thu !== '-' || existingRep.fri !== '-');
        const { wed, thu, fri } = hasOfficialDays
          ? { wed: existingRep.wed, thu: existingRep.thu, fri: existingRep.fri }
          : extractPracticeDaysFromText({
              statusRaw: isIrRetQ ? 'Questionable' : rawSt,
              injuryType: bodyPart,
              shortComment: shortC,
              longComment: longC
            });
        const effectiveOppGameSt = isIrRetQ
          ? 'Questionable'
          : ['out', 'doubtful', 'questionable'].includes(stLower)
            ? rawSt
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
          beatNote: `${shortC} ${longC}`
        });

        mergedByKey.set(nKey, {
          name: existingRep?.name || nm,
          position: ath.position?.abbreviation || prevEntry?.position || 'ATH',
          unit: prevEntry?.unit || 'Active',
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
      if (liveOppReport.length > 0) {
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
  if (Array.isArray(espnNewsRaw?.articles) && Array.isArray(appData.news?.rawStream)) {
    const existingUrls = new Set(appData.news.rawStream.map(it => it.url).filter(Boolean));
    const rosterPlayers = appData.roster?.players || [];
    const newArts = [];
    for (const art of espnNewsRaw.articles) {
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
      const resolvedReporterId =
        matchedRep?.id || (/schefter/i.test(bylineClean) ? 'adam_schefter' : 'nick_wagoner');
      const pubIso = art.published || new Date().toISOString();
      const brk = classifyBreakingItem({ title, summary, publishedAt: pubIso });
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
        outletId: matchedRep?.outletId || 'espn',
        outletName: 'ESPN',
        reporterId: resolvedReporterId,
        reporterName: bylineClean,
        author: bylineClean,
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
      appData.news.rawStream = sortNewsWithBreakingPriority([...newArts, ...appData.news.rawStream]);
      propagateLiveItemsToPlayerMentions(newArts, rosterPlayers);
      mutated = true;
    }
  }

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
