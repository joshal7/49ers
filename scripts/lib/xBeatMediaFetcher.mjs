/**
 * Shared 32-Team X/Twitter Beat, All-22 Film, GIF & Analytics Chart Ingestion Engine
 *
 * Polls public X syndication profile timelines (`syndication.twitter.com/srv/timeline-profile/screen-name/<handle>`)
 * and embedded status endpoints (`cdn.syndication.twimg.com/tweet-result`) with zero API keys,
 * extracting:
 *   - Native HD `video.twimg.com` MP4 clips (videos + short film clips)
 *   - Native X animated GIFs (`animated_gif` -> `video.twimg.com/tweet_video/*.mp4` with `isAnimatedGif: true`)
 *   - High-res analytics scatter plots & editorial photos (`pbs.twimg.com/media/...`)
 *
 * Used identically across ALL 32 NFL club sites (`49ers.joshal.com` -> `data/`, all 31 other
 * clubs -> `data/teams/<slug>/`) via `scripts/fetch-live-data.mjs` for 100% 32-team parity.
 */

import {
  AMBIGUOUS_PLAYER_SURNAMES,
  LEAGUE_WIDE_FILM_ANALYTICS_HANDLES,
  TEAM_CANONICAL_HASHTAGS,
  decodeHtmlEntities,
  extractXSyndicationMedia,
  hasSafeStandaloneSurnameMatch,
  isLeagueWideFilmAnalyticsTweet,
  isPaywalledPublisher,
  isPromotionalAdvertisement,
  normalizeMultilineSocialText,
  sanitizeExternalUrl,
  stripAggregatorBoilerplate,
  stripNon49ersEntityContexts
} from '../../src/engine/linkIntegrity.js';
import {
  classifyBreakingItem,
  classifyNewsItemCategory,
  extractXEntityInlineLinks,
  formatTweetBodyForDisplay
} from '../../src/engine/breakingClassifier.js';
import {
  NATIONAL_NFL_SETTINGS_REPORTER_IDS,
  extractXSnowflakeTimestampMs,
  resolveItemAuthorProfileUrl,
  resolveReporterFromNameOrHandle
} from '../../src/engine/beatAttributionEngine.js';
import { cleanSensationalistText, scoreContentSignal } from '../../src/engine/antiFluffFilter.js';
import { resolveTeamConfig } from '../../src/config/teamRegistry.js';
import { buildGeminiThinkingConfig } from '../../src/engine/geminiStudioPrompts.js';

export const OFFICIAL_TEAM_X_HANDLES_BY_ABBR = Object.freeze({
  SF: '49ers',
  SEA: 'Seahawks',
  LAR: 'RamsNFL',
  ARI: 'AZCardinals',
  MIN: 'Vikings',
  DET: 'Lions',
  GB: 'packers',
  CHI: 'ChicagoBears',
  PHI: 'Eagles',
  DAL: 'dallascowboys',
  NYG: 'Giants',
  WAS: 'Commanders',
  TB: 'Buccaneers',
  NO: 'Saints',
  ATL: 'AtlantaFalcons',
  CAR: 'Panthers',
  BUF: 'BuffaloBills',
  NE: 'Patriots',
  MIA: 'MiamiDolphins',
  NYJ: 'nyjets',
  BAL: 'Ravens',
  CIN: 'Bengals',
  CLE: 'Browns',
  PIT: 'steelers',
  HOU: 'HoustonTexans',
  IND: 'Colts',
  JAX: 'Jaguars',
  TEN: 'Titans',
  KC: 'Chiefs',
  LAC: 'chargers',
  DEN: 'Broncos',
  LV: 'Raiders'
});

/**
 * Shared Stage-1 national All-22 film, trench, PFF, and analytics chart creators.
 * Polled ONCE per multi-team run and filtered cleanly to every club (team-specific + league-wide Film & Trench charts).
 */
export const NATIONAL_FILM_ANALYTICS_X_HANDLES = Object.freeze([
  'BaldyNFL',
  'BrandonThornNFL',
  'FB_FilmAnalysis',
  'QBKlass',
  'kurt13warner',
  'danorlovsky7',
  'CollinsworthPFF',
  'throwthedamball',
  'ghatz_28',
  'tejfbanalytics',
  'SumerSports',
  'PFF_Moo',
  'Nate_Tice',
  'BenjaminSolak',
  'minakimes',
  'BrettKollmann',
  'theqbschool',
  'PFF',
  'NextGenStats',
  'fball_insights',
  'benbbaldwin',
  'SethWalder'
]);

/**
 * Fallback 49ers beat & film X handles used ONLY when `reportersData` is not supplied.
 * In normal operation, ALL 32 clubs (including SF) select handles dynamically from their `reporters.json`.
 */
export const SF_BEAT_FILM_X_HANDLES = Object.freeze([
  '49ers',
  'SulligentHUB',
  'GrustasBrady',
  'dieter',
  'StatsOnFire',
  'MaioccoNBCS',
  'mattbarrows',
  'LombardiHimself',
  'nwagoner',
  'KP_Show',
  'akashanav',
  'Crocky209'
]);

const NON_NFL_OTHER_SPORT_RE =
  /\b(warriors|lakers|celtics|nba\b|sf giants|san francisco giants|dodgers|mlb\b|sharks|nhl\b|stanley cup|world series|premier league|champions league|pga tour|ufc\b|wwe\b)\b/i;

const FOOTBALL_OR_FILM_CONTEXT_RE =
  /\b(nfl|nfc|afc|touchdown|\btd\b|interception|fumble|sack|drive|quarter|halftime|overtime|defense|offense|special teams|practice|locker room|injury|draft|cap|trade|coach|qb|wr|rb|te|lb|cb|ol|dl|lt|lg|rg|rt|edge|pass[- ]?rush|block|pull|swat|route|coverage|separation|epa|pff|cpoe|dvoa|all-?22|film|tape|play[- ]?design|snap|sunday|monday|thursday|game|playoff|win|loss|precision|accuracy|check\s*down)\b/i;

const X_SYNDICATION_HEADERS = Object.freeze({
  'User-Agent':
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9'
});

function escapeRe(s = '') {
  return String(s || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function stripPlayerSuffix(name = '') {
  return String(name || '')
    .replace(/\s+(?:Jr\.?|Sr\.?|II|III|IV|V)$/i, '')
    .trim();
}

function pickBestMediaFromTimelineTweet(tw = {}) {
  const ownMedia = [
    ...(Array.isArray(tw?.extended_entities?.media) ? tw.extended_entities.media : []),
    ...(Array.isArray(tw?.entities?.media) ? tw.entities.media : [])
  ];
  const fallbackMedia =
    ownMedia.length > 0
      ? []
      : [
          ...(Array.isArray(tw?.quoted_status?.extended_entities?.media)
            ? tw.quoted_status.extended_entities.media
            : []),
          ...(Array.isArray(tw?.retweeted_status?.extended_entities?.media)
            ? tw.retweeted_status.extended_entities.media
            : [])
        ];
  const mediaSources = ownMedia.length > 0 ? ownMedia : fallbackMedia;
  const vidMedia = mediaSources.find(
    m => m && (m.type === 'video' || m.type === 'animated_gif') && m.video_info?.variants
  );
  const photoUrls = [];
  const seenPhotos = new Set();
  for (const m of mediaSources) {
    if (photoUrls.length >= 4) break;
    if (!m || m.type !== 'photo') continue;
    const u = String(m.media_url_https || '').trim();
    if (!u || !u.startsWith('https://') || seenPhotos.has(u)) continue;
    seenPhotos.add(u);
    photoUrls.push(u);
  }
  const fallbackPhotoMedia = mediaSources.find(m => m && m.media_url_https);

  if (!vidMedia) {
    const imgUrl = photoUrls[0] || String(fallbackPhotoMedia?.media_url_https || '').trim();
    return {
      mp4Url: '',
      isAnimatedGif: false,
      durationMs: 0,
      thumbUrl: imgUrl.startsWith('https://') ? imgUrl : '',
      imageUrls: photoUrls,
      isPhoto: Boolean(imgUrl.startsWith('https://'))
    };
  }

  const mp4Variants = (Array.isArray(vidMedia.video_info.variants) ? vidMedia.video_info.variants : [])
    .filter(
      v =>
        (v?.content_type === 'video/mp4' || v?.type === 'video/mp4') &&
        /^https:\/\/video\.twimg\.com\//i.test(String(v?.url || v?.src || ''))
    )
    .sort((a, b) => (Number(b.bitrate) || 0) - (Number(a.bitrate) || 0));

  const crispMobile =
    mp4Variants.find(v => (Number(v.bitrate) || 0) > 0 && Number(v.bitrate) <= 2_400_000) || mp4Variants[0];
  const mp4Url = String(crispMobile?.url || crispMobile?.src || '').trim();
  const isAnimatedGif = Boolean(
    mp4Url && (vidMedia.type === 'animated_gif' || /\/tweet_video\//i.test(mp4Url))
  );
  const thumbUrl = String(vidMedia.media_url_https || photoUrls[0] || fallbackPhotoMedia?.media_url_https || '').trim();
  const distinctPhotoUrls = photoUrls.filter(u => u !== thumbUrl);

  return {
    mp4Url,
    isAnimatedGif,
    durationMs: Number(vidMedia.video_info?.duration_millis || 0),
    thumbUrl: thumbUrl.startsWith('https://') ? thumbUrl : '',
    imageUrls: distinctPhotoUrls,
    isPhoto: false
  };
}

/**
 * Parses official X syndication timeline HTML (`syndication.twitter.com/srv/timeline-profile/screen-name/<handle>`)
 * into raw normalized tweet records preserving video MP4 streams, animated GIFs, high-res photos, and quoted text.
 */
export function parseXTimelineHtml(
  html = '',
  { handle = '', nowMs = Date.now(), maxAgeHours = 120, maxItems = 18 } = {}
) {
  if (!html || typeof html !== 'string') return [];
  const nextDataMatch = html.match(/<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/);
  if (!nextDataMatch) return [];
  let parsed = null;
  try {
    parsed = JSON.parse(nextDataMatch[1]);
  } catch {
    return [];
  }
  const entries = parsed?.props?.pageProps?.timeline?.entries || [];
  if (!Array.isArray(entries) || entries.length === 0) return [];

  const maxAgeMs = maxAgeHours * 3_600_000;
  const tweets = entries
    .filter(e => e?.type === 'tweet' && e?.content?.tweet)
    .map(e => e.content.tweet)
    .sort((a, b) => (Date.parse(b.created_at || '') || 0) - (Date.parse(a.created_at || '') || 0));

  const results = [];
  const seenIds = new Set();
  for (const tw of tweets) {
    if (results.length >= maxItems) break;
    // Skip pure retweets of unrelated third parties unless the author themselves posted/quoted
    const baseTw = tw.retweeted_status && !tw.full_text ? tw.retweeted_status : tw;
    const idStr = String(baseTw.id_str || baseTw.id || tw.id_str || '').trim();
    if (!idStr || seenIds.has(idStr)) continue;
    const pubMs = Date.parse(baseTw.created_at || tw.created_at || '');
    if (!Number.isFinite(pubMs) || nowMs - pubMs > maxAgeMs) continue;

    const rawText = normalizeMultilineSocialText(
      decodeHtmlEntities(String(baseTw.full_text || baseTw.text || '')).replace(/https?:\/\/t\.co\/[A-Za-z0-9]+/gi, '')
    );
    const quotedText = normalizeMultilineSocialText(
      decodeHtmlEntities(String(baseTw.quoted_status?.full_text || baseTw.quoted_status?.text || '')).replace(
        /https?:\/\/t\.co\/[A-Za-z0-9]+/gi,
        ''
      )
    );
    const media = pickBestMediaFromTimelineTweet(baseTw);
    const caption = rawText || quotedText;
    const hasMedia = Boolean(media.mp4Url || media.thumbUrl || (media.imageUrls && media.imageUrls.length > 0));
    if (!caption || caption.length < (hasMedia ? 6 : 16)) continue;

    const expandedUrls = [
      ...(Array.isArray(baseTw?.entities?.urls)
        ? baseTw.entities.urls.map(u => u?.expanded_url || u?.unwound_url || '')
        : []),
      ...(Array.isArray(baseTw?.quoted_status?.entities?.urls)
        ? baseTw.quoted_status.entities.urls.map(u => u?.expanded_url || u?.unwound_url || '')
        : [])
    ].filter(Boolean);

    if (
      isPromotionalAdvertisement({
        type: media.mp4Url ? 'video' : 'tweet',
        title: caption,
        fullText: caption,
        summary: quotedText && quotedText !== caption ? quotedText : '',
        expandedUrls
      })
    ) {
      continue;
    }

    const screenName = String(baseTw.user?.screen_name || tw.user?.screen_name || handle).trim();
    const userName = decodeHtmlEntities(String(baseTw.user?.name || tw.user?.name || `@${screenName}`)).trim();
    const nonSocialExt = expandedUrls.find(u => !/^https?:\/\/(?:www\.)?(?:x|twitter)\.com\//i.test(u)) || '';
    const inlineLinks = extractXEntityInlineLinks(baseTw?.entities, baseTw?.card);
    const durFmt =
      !media.isAnimatedGif && media.durationMs >= 4000
        ? `${Math.floor(media.durationMs / 60000)}:${String(Math.round((media.durationMs % 60000) / 1000)).padStart(2, '0')}`
        : '';

    seenIds.add(idStr);
    results.push({
      statusId: idStr,
      handle: screenName,
      sourceHandle: handle || screenName,
      userName,
      text: caption,
      quotedText: quotedText && quotedText !== caption ? quotedText : '',
      url: `https://x.com/${screenName}/status/${idStr}`,
      externalUrl: nonSocialExt,
      ...(inlineLinks.length > 0 ? { inlineLinks } : {}),
      mp4Url: media.mp4Url,
      isAnimatedGif: media.isAnimatedGif,
      durationMs: media.durationMs,
      durationFmt: durFmt,
      imageUrl: media.thumbUrl,
      imageUrls: Array.isArray(media.imageUrls) && media.imageUrls.length > (media.mp4Url ? 0 : 1) ? media.imageUrls : undefined,
      isPhoto: media.isPhoto,
      publishedAt: new Date(Math.min(nowMs, pubMs)).toISOString()
    });
  }

  return results;
}

/**
 * Fetches X timelines across a list of handles:
 *   1. Official X API v2 (`process.env.X_BEARER_TOKEN`) when configured — zero 429 rate-limit drops.
 *   2. Public X syndication (`syndication.twitter.com`) with gentle concurrency (2), 250ms pacing,
 *      and an immediate HTTP 429 circuit-breaker so transient rate limits never hammer X or extend IP bans.
 */
async function fetchXTimelinesViaOfficialApiV2(
  cleanHandles,
  { bearerToken, timeoutMs = 6000, maxAgeHours = 120, maxItems = 14, nowMs = Date.now() } = {}
) {
  const out = [];
  const authHeaders = { Authorization: `Bearer ${bearerToken}`, Accept: 'application/json' };
  const startTimeIso = new Date(nowMs - maxAgeHours * 3_600_000).toISOString();
  try {
    const userRes = await fetch(
      `https://api.x.com/2/users/by?usernames=${encodeURIComponent(cleanHandles.slice(0, 100).join(','))}&user.fields=name,username`,
      { headers: authHeaders, signal: AbortSignal.timeout(timeoutMs) }
    );
    if (!userRes.ok) return [];
    const userJson = await userRes.json();
    const users = Array.isArray(userJson?.data) ? userJson.data : [];
    for (const u of users) {
      try {
        const twRes = await fetch(
          `https://api.x.com/2/users/${encodeURIComponent(u.id)}/tweets?max_results=${Math.min(20, Math.max(5, maxItems))}&start_time=${encodeURIComponent(startTimeIso)}&exclude=replies,retweets&tweet.fields=created_at,entities,attachments,referenced_tweets&expansions=attachments.media_keys&media.fields=type,url,preview_image_url,variants,duration_ms`,
          { headers: authHeaders, signal: AbortSignal.timeout(timeoutMs) }
        );
        if (!twRes.ok) continue;
        const twJson = await twRes.json();
        const mediaByKey = new Map((twJson?.includes?.media || []).map(m => [m.media_key, m]));
        for (const tw of twJson?.data || []) {
          const idStr = String(tw.id || '').trim();
          const rawText = normalizeMultilineSocialText(
            decodeHtmlEntities(String(tw.text || '')).replace(/https?:\/\/t\.co\/[A-Za-z0-9]+/gi, '')
          );
          const mediaList = (tw.attachments?.media_keys || []).map(k => mediaByKey.get(k)).filter(Boolean);
          const vid = mediaList.find(m => m.type === 'video' || m.type === 'animated_gif');
          const photos = mediaList
            .filter(m => m.type === 'photo' && typeof m.url === 'string' && m.url.startsWith('https://'))
            .map(m => m.url.trim())
            .slice(0, 4);
          const photo = photos[0] ? { url: photos[0] } : null;
          const mp4s = (vid?.variants || [])
            .filter(v => v?.content_type === 'video/mp4' && /^https:\/\/video\.twimg\.com\//i.test(String(v?.url || '')))
            .sort((a, b) => (Number(b.bit_rate) || 0) - (Number(a.bit_rate) || 0));
          const crisp = mp4s.find(v => (Number(v.bit_rate) || 0) > 0 && Number(v.bit_rate) <= 2_400_000) || mp4s[0];
          const mp4Url = String(crisp?.url || '').trim();
          const isAnimatedGif = Boolean(mp4Url && (vid?.type === 'animated_gif' || /\/tweet_video\//i.test(mp4Url)));
          const durationMs = Number(vid?.duration_ms || 0);
          const durFmt =
            !isAnimatedGif && durationMs >= 4000
              ? `${Math.floor(durationMs / 60000)}:${String(Math.round((durationMs % 60000) / 1000)).padStart(2, '0')}`
              : '';
          const imageUrl = String(vid?.preview_image_url || photo?.url || '').trim();
          const distinctPhotos = mp4Url ? photos.filter(u => u !== imageUrl) : photos;
          if (!rawText || rawText.length < (mp4Url || imageUrl ? 6 : 16)) continue;
          const expandedUrls = (tw.entities?.urls || []).map(x => x.expanded_url || '').filter(Boolean);
          const nonSocialExt = expandedUrls.find(x => !/^https?:\/\/(?:www\.)?(?:x|twitter)\.com\//i.test(x)) || '';
          const pubMs = Date.parse(tw.created_at || '') || nowMs;
          out.push({
            statusId: idStr,
            handle: u.username,
            sourceHandle: u.username,
            userName: decodeHtmlEntities(u.name || `@${u.username}`),
            text: rawText,
            quotedText: '',
            url: `https://x.com/${u.username}/status/${idStr}`,
            externalUrl: nonSocialExt,
            mp4Url,
            isAnimatedGif,
            durationMs,
            durationFmt: durFmt,
            imageUrl: imageUrl.startsWith('https://') ? imageUrl : '',
            imageUrls: distinctPhotos.length > (mp4Url ? 0 : 1) ? distinctPhotos : undefined,
            isPhoto: Boolean(!mp4Url && photo?.url),
            publishedAt: new Date(Math.min(nowMs, pubMs)).toISOString()
          });
        }
      } catch {
        // Non-fatal single user failure
      }
    }
  } catch {
    return [];
  }
  return out;
}

let syndicationRateLimitedUntilMs = 0;

/**
 * Deterministic time-bucketed rotating slice selector for card-free X syndication pulls.
 * Ensures a single scheduled runner IP only queries `maxPerRun` (e.g. 3–4) handles per run
 * to stay under X's per-IP 429 threshold, while covering the entire handle roster every few runs
 * as our 96h carry-forward accumulates harvested tweets across runs.
 */
export function selectRotatingXHandleSlice(
  handles = [],
  { maxPerRun = 4, bucketMinutes = 30, nowMs = Date.now(), seedOffset = 0 } = {}
) {
  const clean = Array.from(
    new Set(
      (Array.isArray(handles) ? handles : [])
        .map(h => String(h || '').replace(/^@/, '').trim())
        .filter(h => /^[A-Za-z0-9_]{2,25}$/.test(h))
    )
  );
  if (clean.length <= maxPerRun || maxPerRun <= 0) return clean;
  const bucketIdx = Math.floor(nowMs / (Math.max(5, Number(bucketMinutes) || 30) * 60_000));
  const start = ((bucketIdx * maxPerRun) + Math.abs(Number(seedOffset) || 0)) % clean.length;
  const slice = [];
  for (let i = 0; i < maxPerRun; i += 1) {
    slice.push(clean[(start + i) % clean.length]);
  }
  return slice;
}

/**
 * Fetches full public HTML for up to `maxArticles` recent, non-paywalled local beat articles
 * (prioritizing film/takeaway/grade/reaction/notebook headlines that commonly embed X clips/GIFs/charts).
 * Never bypasses paywalls or anti-bot gates; skips non-200 responses cleanly.
 */
export async function fetchBeatArticleHtmlForXEmbeds(
  articles = [],
  { maxArticles = 10, concurrency = 5, timeoutMs = 4500, nowMs = Date.now(), fetchImpl = globalThis.fetch } = {}
) {
  const maxAgeMs = 96 * 3_600_000;
  const priorityScore = a => {
    const t = `${a?.title || ''} ${a?.summary || ''}`;
    let sc = 0;
    if (/\b(film|all-?22|tape|grade[sd]?|pff|snap\s*count|takeaway|reaction|trench|breakdown|stats|highlights?|watch|video|clip|notebook|stock\s+up|winners?\s+and\s+losers?|observation|review)\b/i.test(t)) {
      sc += 25;
    }
    if (/\b(niners\s*nation|49ers\s*webzone|wire|pride\s+of\s+detroit|bleeding\s+green|buffalo\s+rumblings|arrowhead|field\s+gulls|nbc\s+sports)\b/i.test(String(a?.outletName || ''))) {
      sc += 10;
    }
    const pubMs = Date.parse(a?.publishedAt || '');
    if (Number.isFinite(pubMs)) {
      const ageHrs = Math.max(0, (nowMs - pubMs) / 3_600_000);
      sc += Math.max(0, 20 - ageHrs * 0.25);
    }
    return sc;
  };

  const seenUrls = new Set();
  const candidates = (Array.isArray(articles) ? articles : [])
    .filter(a => {
      const u = String(a?.url || '').trim();
      if (!u.startsWith('https://') || seenUrls.has(u)) return false;
      if (isPaywalledPublisher(u)) return false;
      if (/^https?:\/\/(?:www\.)?(?:x|twitter|bsky|youtube|youtu\.be)\./i.test(u)) return false;
      const pubMs = Date.parse(a?.publishedAt || '');
      if (Number.isFinite(pubMs) && nowMs - pubMs > maxAgeMs) return false;
      seenUrls.add(u);
      return true;
    })
    .sort((a, b) => priorityScore(b) - priorityScore(a))
    .slice(0, maxArticles);

  if (candidates.length === 0) return [];
  const htmlList = [];
  for (let i = 0; i < candidates.length; i += concurrency) {
    const batch = candidates.slice(i, i + concurrency);
    const settled = await Promise.allSettled(
      batch.map(async art => {
        try {
          const res = await fetchImpl(art.url, {
            headers: {
              'User-Agent': X_SYNDICATION_HEADERS['User-Agent'],
              Accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.8'
            },
            signal: AbortSignal.timeout(timeoutMs)
          });
          if (!res.ok) return '';
          const ct = String(res.headers?.get?.('content-type') || '');
          if (ct && !/html|xml|text/i.test(ct)) return '';
          let txt = await res.text();
          if (txt.length > 450_000) txt = txt.slice(0, 450_000);
          // Focus on primary article body when present and strip sidebar/footer/nav chrome so
          // unrelated "Trending" widget tweets cannot consume the hydration cap.
          const articleMatch = txt.match(/<article\b[\s\S]*?<\/article>/i) || txt.match(/<main\b[\s\S]*?<\/main>/i);
          if (articleMatch && articleMatch[0].length >= 120) {
            txt = articleMatch[0];
          }
          txt = txt.replace(/<(script|style|nav|aside|footer)\b[\s\S]*?<\/\1>/gi, ' ');
          return txt.length > 350_000 ? txt.slice(0, 350_000) : txt;
        } catch {
          return '';
        }
      })
    );
    for (const s of settled) {
      if (s.status === 'fulfilled' && s.value) htmlList.push(s.value);
    }
  }
  return htmlList;
}

export async function fetchXTimelinesBatch(
  handles = [],
  { concurrency = 1, spacingMs = 450, timeoutMs = 4500, maxAgeHours = 120, maxItems = 16, nowMs = Date.now(), bearerToken = process.env.X_BEARER_TOKEN || '' } = {}
) {
  const cleanHandles = Array.from(
    new Set(
      (Array.isArray(handles) ? handles : [])
        .map(h => String(h || '').replace(/^@/, '').trim())
        .filter(h => /^[A-Za-z0-9_]{2,25}$/.test(h))
    )
  );
  if (cleanHandles.length === 0) return [];

  // Prefer Official X API v2 whenever X_BEARER_TOKEN is configured
  if (bearerToken && String(bearerToken).trim().length >= 20) {
    const apiItems = await fetchXTimelinesViaOfficialApiV2(cleanHandles, {
      bearerToken: String(bearerToken).trim(),
      timeoutMs: Math.max(timeoutMs, 6000),
      maxAgeHours,
      maxItems,
      nowMs
    });
    if (apiItems.length > 0) return apiItems;
  }

  // Respect active 429 circuit-breaker so we don't hammer X syndication and prolong IP bans
  if (Date.now() < syndicationRateLimitedUntilMs) return [];

  const all = [];
  const safeConc = Math.max(1, Math.min(2, Number(concurrency) || 1));
  const safeSpacing = Math.max(150, Number(spacingMs) || 450);
  let hitRateLimit = false;
  for (let i = 0; i < cleanHandles.length; i += safeConc) {
    if (hitRateLimit) break;
    if (i > 0) await new Promise(r => setTimeout(r, safeSpacing));
    const slice = cleanHandles.slice(i, i + safeConc);
    const settled = await Promise.allSettled(
      slice.map(async h => {
        try {
          const res = await fetch(
            `https://syndication.twitter.com/srv/timeline-profile/screen-name/${encodeURIComponent(h)}`,
            { headers: X_SYNDICATION_HEADERS, signal: AbortSignal.timeout(timeoutMs) }
          );
          if (res.status === 429) {
            hitRateLimit = true;
            syndicationRateLimitedUntilMs = Date.now() + 5 * 60_000;
            return [];
          }
          if (!res.ok) return [];
          const html = await res.text();
          return parseXTimelineHtml(html, { handle: h, nowMs, maxAgeHours, maxItems });
        } catch {
          return [];
        }
      })
    );
    for (const s of settled) {
      if (s.status === 'fulfilled' && Array.isArray(s.value)) {
        all.push(...s.value);
      }
    }
  }
  return all;
}

const NATIONAL_OUTLET_IDS = new Set(['espn_national', 'nfl_network', 'national_film', 'overthecap']);
const NATIONAL_HANDLE_SET_LOWER = new Set(NATIONAL_FILM_ANALYTICS_X_HANDLES.map(h => h.toLowerCase()));

/**
 * Selects local beat & film X handles uniformly for ANY of the 32 NFL clubs (including SF)
 * from its `reportersData` + official club handle, ensuring local `film`/`film_analyst`/`analytics`
 * accounts are prioritized alongside top beat reporters (never accidentally dropped as national!).
 */
export function selectTeamLocalXHandles(team, reportersData = null, maxHandles = 18) {
  const active = resolveTeamConfig(team);
  const out = [];
  const seen = new Set();
  const push = raw => {
    const h = String(raw || '').replace(/^@/, '').trim();
    if (!h || !/^[A-Za-z0-9_]{2,25}$/.test(h)) return;
    const low = h.toLowerCase();
    if (seen.has(low) || NATIONAL_HANDLE_SET_LOWER.has(low)) return;
    seen.add(low);
    out.push(h);
  };
  const official = OFFICIAL_TEAM_X_HANDLES_BY_ABBR[active.abbr];
  if (official) push(official);

  const reps = Array.isArray(reportersData?.reporters) ? reportersData.reporters : [];
  if (reps.length === 0 && active.abbr === 'SF') {
    for (const h of SF_BEAT_FILM_X_HANDLES) {
      if (out.length >= maxHandles) break;
      push(h);
    }
    return out;
  }

  const isNationalRep = r =>
    !r ||
    r.scope === 'national' ||
    NATIONAL_NFL_SETTINGS_REPORTER_IDS.has(r.id) ||
    NATIONAL_OUTLET_IDS.has(String(r.outletId || '')) ||
    ['national_insider', 'draft', 'injury_analyst'].includes(String(r.category || '').toLowerCase());

  const localReps = reps.filter(
    r =>
      r &&
      !r.isPodiumSubject &&
      !isNationalRep(r) &&
      (r.handle || (Array.isArray(r.handleAliases) && r.handleAliases.length > 0))
  );

  const extractBestHandle = r => {
    // Prefer active X timeline alias when primary handle is a legacy YouTube handle (e.g. @SulligentHUB)
    const aliases = Array.isArray(r.handleAliases) ? r.handleAliases : [];
    const primary = String(r.handle || '').replace(/^@/, '').trim();
    if (r.id === 'jonnydel') {
      const activeAlias = aliases.find(a => /sulligenthub/i.test(String(a)));
      if (activeAlias) return activeAlias;
    }
    return primary || aliases[0] || '';
  };

  const isExplicitFilmCat = r =>
    ['film', 'film_analyst', 'analytics'].includes(String(r.category || '').toLowerCase());
  const isLocalFilmOrAnalyt = r =>
    isExplicitFilmCat(r) ||
    /all[- ]?22|film|tape|scheme|analytics|chart|grade|trench/i.test(`${r.role || ''} ${r.styleTag || ''}`);
  const isExplicitClipCat = r =>
    ['video_pod', 'audio_beat'].includes(String(r.category || '').toLowerCase());
  const isLocalClipOrPod = r =>
    isExplicitClipCat(r) ||
    (String(r.category || '').toLowerCase() !== 'beat' &&
      /clip|video|highlight/i.test(`${r.role || ''} ${r.styleTag || ''}`));

  const byScoreDesc = (a, b) =>
    (Number(b.baseScore) || 85) - (Number(a.baseScore) || 85) ||
    (Number(a.trustTier) || 2) - (Number(b.trustTier) || 2);

  // Prioritize explicit film/analytics category creators ahead of general beat/radio hosts
  const filmReps = localReps
    .filter(isLocalFilmOrAnalyt)
    .sort((a, b) => Number(isExplicitFilmCat(b)) - Number(isExplicitFilmCat(a)) || byScoreDesc(a, b));
  const clipReps = localReps
    .filter(r => !isLocalFilmOrAnalyt(r) && isLocalClipOrPod(r))
    .sort((a, b) => Number(isExplicitClipCat(b)) - Number(isExplicitClipCat(a)) || byScoreDesc(a, b));
  const beatReps = localReps
    .filter(r => !isLocalFilmOrAnalyt(r) && !isLocalClipOrPod(r) && String(r.category || '').toLowerCase() !== 'official')
    .sort((a, b) => (Number(a.trustTier) || 2) - (Number(b.trustTier) || 2) || byScoreDesc(a, b));

  // Balanced high-SNR allocation: official + up to ~50% local film/analytics + ~22% video/clip pods + top beat writers
  const filmCap = Math.max(4, Math.floor(maxHandles * 0.5));
  const clipCap = Math.max(3, Math.floor(maxHandles * 0.22));
  for (const r of filmReps.slice(0, filmCap)) {
    if (out.length >= maxHandles) break;
    push(extractBestHandle(r));
  }
  for (const r of clipReps.slice(0, clipCap)) {
    if (out.length >= maxHandles) break;
    push(extractBestHandle(r));
  }
  for (const r of [...beatReps, ...filmReps.slice(filmCap), ...clipReps.slice(clipCap)]) {
    if (out.length >= maxHandles) break;
    push(extractBestHandle(r));
  }
  return out;
}

const ROSTER_CONDITIONAL_PLAYER_INITIALISMS = Object.freeze({
  'christian mccaffrey': /\bcmc\b/i,
  'justin jefferson': /\bjjettas?\b/i,
  'amon-ra st. brown': /\barsb\b/i,
  'jaxon smith-njigba': /\bjsn\b/i,
  'trevor lawrence': /\btlaw\b/i,
  'ceedee lamb': /\bcd\s*lamb\b/i
});

function buildTeamRelevanceMatcher(team, rosterPlayers = []) {
  const active = resolveTeamConfig(team);
  const includeCity = !active.keywordRules?.excludeGenericCity;
  const nicks =
    Array.isArray(active.keywordRules?.requiredNicknames) && active.keywordRules.requiredNicknames.length > 0
      ? active.keywordRules.requiredNicknames
      : [active.nickname];
  const officialHandle = OFFICIAL_TEAM_X_HANDLES_BY_ABBR[active.abbr] || '';
  const hashtags = (TEAM_CANONICAL_HASHTAGS[active.abbr] || []).map(h => escapeRe(h));

  const entityWords = new Set(
    [
      active.fullName,
      ...nicks,
      ...(includeCity ? [active.city] : []),
      active.coachesSeed?.hc,
      active.coachesSeed?.gm,
      active.stadium,
      ...(Array.isArray(active.aliases) ? active.aliases.filter(a => String(a).length >= 5) : []),
      ...(active.abbr === 'SF' ? ['49ers', 'niners', 'san francisco', 'santa clara', 'shanahan'] : [])
    ]
      .filter(Boolean)
      .map(w => escapeRe(String(w).trim()))
  );
  const hashtagPart = hashtags.length > 0 ? `|(?:^|[\\s([{"',|/-])#(?:${hashtags.join('|')})\\b` : '';
  const handlePart = officialHandle ? `|(?:^|[\\s([{"',|/-])@${escapeRe(officialHandle)}\\b` : '';
  const explicitTeamRe = new RegExp(`(?:\\b(?:${[...entityWords].join('|')})\\b${hashtagPart}${handlePart})`, 'i');

  const lastCounts = new Map();
  const parsedPlayers = [];
  for (const p of Array.isArray(rosterPlayers) ? rosterPlayers : []) {
    if (!p?.name) continue;
    const cleanFull = stripPlayerSuffix(p.name);
    const parts = cleanFull.split(/\s+/).filter(Boolean);
    const first = (parts[0] || '').replace(/[^a-zA-Z]/g, '').toLowerCase();
    const rawLast = (parts[parts.length - 1] || '').replace(/[^a-zA-Z'-]/g, '').toLowerCase();
    // Support compound surnames like "St. Brown" -> "stbrown" and hyphenated "Smith-Njigba" -> "smithnjigba" + "njigba"
    const compoundTail =
      parts.length >= 3 && /^(st\.?|de|la|le|van|von|mc|mac)$/i.test(parts[parts.length - 2])
        ? `${parts[parts.length - 2]}${parts[parts.length - 1]}`.replace(/[^a-z]/gi, '').toLowerCase()
        : '';
    const compactLast = rawLast.replace(/[^a-z]/g, '');
    const hyphenParts = rawLast.includes('-') ? rawLast.split('-').map(s => s.replace(/[^a-z]/g, '')).filter(s => s.length >= 5) : [];
    const compactFull = `${first}${compoundTail || compactLast}`;
    if (rawLast.length >= 4) lastCounts.set(rawLast, (lastCounts.get(rawLast) || 0) + 1);
    parsedPlayers.push({
      player: p,
      cleanFull,
      fullLower: cleanFull.toLowerCase(),
      first,
      last: rawLast,
      compactLast,
      compoundTail,
      hyphenParts,
      compactFull,
      jersey: String(p.jersey || '').replace(/[^0-9]/g, '')
    });
  }

  const matchPlayers = (text = '', { allowAllSingleSurnames = false, allowUniqueSurnames = true } = {}) => {
    const raw = String(text || '');
    const lower = raw.toLowerCase();
    const atHandles = [...lower.matchAll(/@([a-z0-9_]{3,25})\b/g)].map(m => m[1]);
    const matched = [];
    const seen = new Set();
    const addP = p => {
      if (!p || seen.has(p.id)) return;
      seen.add(p.id);
      matched.push({
        id: p.id,
        name: p.name,
        shortName: p.shortName || p.name,
        position: p.position,
        jersey: p.jersey,
        headshotUrl: p.headshotUrl || ''
      });
    };

    for (const entry of parsedPlayers) {
      if (entry.fullLower.length >= 6 && new RegExp(`(?<![a-z0-9])${escapeRe(entry.fullLower)}(?![a-z0-9])`, 'i').test(lower)) {
        addP(entry.player);
        continue;
      }
      // Dynamic roster-derived X @handle matching for ALL 32 teams (updates automatically as rosters change):
      // e.g. @brockpurdy13, @gkittle46, @PatrickMahomes, @JoshAllenQB, @jgoff16, @j_love10, @amonra_stbrown, @jsmithnjigba
      if (atHandles.length > 0) {
        let handleHit = false;
        for (const h of atHandles) {
          const hAlpha = h.replace(/[^a-z]/g, '');
          // 1. Concatenated full name inside handle (e.g. @patrickmahomes, @lamarjackson, @joshallenqb, @trevorlawrence)
          if (entry.compactFull.length >= 7 && hAlpha.includes(entry.compactFull)) {
            handleHit = true;
            break;
          }
          // 2. Compound or hyphenated surname inside handle (e.g. @amonra_stbrown, @jsmithnjigba)
          if (
            (entry.compoundTail && entry.compoundTail.length >= 6 && hAlpha.includes(entry.compoundTail)) ||
            entry.hyphenParts.some(hp => hp.length >= 6 && hAlpha.includes(hp))
          ) {
            handleHit = true;
            break;
          }
          // 3. 5+ letter surname inside handle (with first-initial guard if surname is ambiguous)
          if (entry.compactLast.length >= 5 && hAlpha.includes(entry.compactLast)) {
            if (
              !AMBIGUOUS_PLAYER_SURNAMES.has(entry.last) ||
              (entry.first &&
                (hAlpha.startsWith(entry.first[0]) ||
                  h.includes(`_${entry.first[0]}`) ||
                  (entry.jersey && h.endsWith(entry.jersey))))
            ) {
              handleHit = true;
              break;
            }
          }
          // 4. 4-letter surname inside handle ONLY when paired with first-initial or jersey number (e.g. @jgoff16, @j_love10, @cdlamb88, @tjwatt90, @n_bosa97)
          if (entry.compactLast.length === 4 && hAlpha.includes(entry.compactLast)) {
            const hasFirstInit = Boolean(
              entry.first &&
                new RegExp(`^[a-z]{0,2}${escapeRe(entry.first[0])}[a-z_]*${escapeRe(entry.compactLast)}`).test(h)
            );
            const hasJersey = Boolean(entry.jersey && h.endsWith(entry.jersey));
            if (hasFirstInit || (hasJersey && !AMBIGUOUS_PLAYER_SURNAMES.has(entry.last))) {
              handleHit = true;
              break;
            }
          }
        }
        if (handleHit) {
          addP(entry.player);
          continue;
        }
      }
      const initRe = ROSTER_CONDITIONAL_PLAYER_INITIALISMS[entry.fullLower];
      if (initRe && initRe.test(lower)) {
        addP(entry.player);
        continue;
      }
    }

    if (allowUniqueSurnames || allowAllSingleSurnames) {
      for (const entry of parsedPlayers) {
        if (seen.has(entry.player.id)) continue;
        if (entry.last.length < 4 || lastCounts.get(entry.last) !== 1) continue;
        const isAmbig = AMBIGUOUS_PLAYER_SURNAMES.has(entry.last);
        if (isAmbig && !allowAllSingleSurnames) continue;
        if (!isAmbig && entry.last.length < 5 && !allowAllSingleSurnames) continue;
        if (hasSafeStandaloneSurnameMatch(raw, entry.last, entry.cleanFull)) {
          addP(entry.player);
        }
      }
    }
    return matched;
  };

  return { explicitTeamRe, officialHandle: officialHandle.toLowerCase(), matchPlayers };
}

/**
 * Filters raw X timeline items for a specific NFL club (all 32 clubs supported),
 * setting accurate category (`film` vs `beat` vs `roster` vs `injury`), `isAnimatedGif`,
 * `isHighlightClip`, `hasInlineChartImage`, and `filmOnlyScope` (for league-wide scatter charts).
 */
export function filterXTimelineItemsForTeam(
  rawItems = [],
  { team = null, rosterPlayers = [], reportersData = null, isNationalPool = false, nowMs = Date.now() } = {}
) {
  const active = resolveTeamConfig(team);
  const { explicitTeamRe, officialHandle, matchPlayers } = buildTeamRelevanceMatcher(active, rosterPlayers);
  const localHandles = new Set(
    selectTeamLocalXHandles(active, reportersData, 32).map(h => h.toLowerCase())
  );
  if (officialHandle) localHandles.add(officialHandle);

  const normalized = [];
  const seenUrls = new Set();
  const seenStatusIds = new Set();

  for (const raw of Array.isArray(rawItems) ? rawItems : []) {
    if (!raw || !raw.url) continue;
    const normUrlKey = String(raw.url).trim().toLowerCase();
    const normSid =
      String(raw.statusId || '').trim() ||
      (String(raw.url).match(/\/status\/(\d{15,22})/) || [])[1] ||
      '';
    if (seenUrls.has(normUrlKey) || (normSid && seenStatusIds.has(normSid))) continue;
    const handleLower = String(raw.handle || '').toLowerCase();
    const isOfficialTeamAccount = Boolean(officialHandle && handleLower === officialHandle);
    const isLocalBeatOrFilm = !isNationalPool && localHandles.has(handleLower);
    const hasPlayableMedia = Boolean(raw.mp4Url);
    const hasPhoto = Boolean(raw.imageUrl && !raw.mp4Url);
    const relevanceText = `${raw.text || ''} ${raw.quotedText || ''}`.trim();
    const cleanedRelText = active.abbr === 'SF' ? stripNon49ersEntityContexts(relevanceText) : relevanceText;

    const explicitTeamHit = explicitTeamRe.test(cleanedRelText);
    const mentioned = matchPlayers(relevanceText, {
      allowUniqueSurnames: isLocalBeatOrFilm || isOfficialTeamAccount || explicitTeamHit,
      allowAllSingleSurnames: Boolean((isLocalBeatOrFilm || isOfficialTeamAccount) && (hasPlayableMedia || raw.isAnimatedGif))
    });

    let isLeagueWideChart = false;
    let filmOnlyScope = false;

    if (isOfficialTeamAccount) {
      // Official club account: keep all non-promo tweets/clips
    } else if (isLocalBeatOrFilm) {
      const isOtherSport = NON_NFL_OTHER_SPORT_RE.test(relevanceText) && !explicitTeamHit && mentioned.length === 0;
      if (isOtherSport) continue;
      // Open inclusion for local beat video/GIF/film clips (e.g. Dieter Kurtenbach's Lowe All-22 GIF or StatsOnFire clip)
      if (!explicitTeamHit && mentioned.length === 0 && !hasPlayableMedia && !FOOTBALL_OR_FILM_CONTEXT_RE.test(relevanceText)) {
        continue;
      }
    } else {
      // National film / analytics / insider handle
      const directTeamRelevant = explicitTeamHit || mentioned.length > 0;
      if (!directTeamRelevant) {
        const leagueWideCand = {
          title: raw.text,
          fullText: raw.text,
          summary: raw.quotedText || '',
          authorHandle: `@${raw.handle}`,
          imageUrl: raw.imageUrl || '',
          videoStreamUrl: raw.mp4Url || ''
        };
        if (isLeagueWideFilmAnalyticsTweet(leagueWideCand, active)) {
          isLeagueWideChart = true;
          filmOnlyScope = true;
        } else {
          continue;
        }
      }
    }

    const dirEntry = resolveReporterFromNameOrHandle(`@${raw.handle}`, active);
    const authorName = dirEntry?.name || raw.userName || `@${raw.handle}`;
    const authorHandle = `@${raw.handle}`;
    const outletId = dirEntry?.outletId || (isOfficialTeamAccount ? `${active.slug}_official` : 'x_beat');
    const outletName = dirEntry?.outletName || (isOfficialTeamAccount ? `@${raw.handle} Official` : 'X Beat');
    const trustTier = isOfficialTeamAccount ? 1 : Number(dirEntry?.trustTier) || 2;

    const cleanBody = cleanSensationalistText(
      stripAggregatorBoilerplate(raw.text || '', { preserveNewlines: true }),
      { preserveNewlines: true }
    );
    if (!cleanBody) continue;
    const formatted = formatTweetBodyForDisplay(cleanBody);
    const sig = scoreContentSignal(formatted.text, raw.quotedText || '', {
      url: raw.url,
      externalUrl: raw.externalUrl || '',
      type: 'tweet'
    });
    if (sig.isClickbait) continue;

    const safeExt =
      raw.externalUrl && !isPaywalledPublisher('', raw.externalUrl)
        ? sanitizeExternalUrl(raw.externalUrl, null)
        : null;

    const draftForCat = {
      type: 'tweet',
      title: formatted.text,
      fullText: cleanBody,
      summary: raw.quotedText || '',
      author: authorName,
      reporterName: authorName,
      authorHandle,
      reporterCategory: dirEntry?.category || '',
      outletName,
      mentionedPlayers: mentioned,
      videoStreamUrl: raw.mp4Url || undefined,
      isAnimatedGif: Boolean(raw.isAnimatedGif),
      isLeagueWideFilmChart: isLeagueWideChart
    };
    const resolvedCategory = isLeagueWideChart ? 'film' : classifyNewsItemCategory(draftForCat);
    const isHighlightClip = Boolean(
      raw.mp4Url &&
        resolvedCategory !== 'film' &&
        (raw.isAnimatedGif || raw.durationMs === 0 || raw.durationMs >= 4000)
    );
    const rawImageUrls = Array.isArray(raw.imageUrls)
      ? raw.imageUrls.filter(u => typeof u === 'string' && u.startsWith('https://')).slice(0, 4)
      : [];
    const hasInlineChartImage = Boolean(
      rawImageUrls.length > 1 ||
        (hasPhoto &&
          (resolvedCategory === 'film' ||
            isLeagueWideChart ||
            LEAGUE_WIDE_FILM_ANALYTICS_HANDLES.has(handleLower)))
    );

    const brk = classifyBreakingItem(
      {
        ...draftForCat,
        category: resolvedCategory,
        publishedAt: raw.publishedAt,
        reporterId: dirEntry?.id || null,
        trustTier
      },
      nowMs,
      { team: active, rosterPlayers }
    );

    seenUrls.add(normUrlKey);
    if (normSid) seenStatusIds.add(normSid);
    const built = {
      id: `x_tl_${handleLower}_${raw.statusId}`,
      type: 'tweet',
      title: formatted.text,
      fullText: cleanBody,
      isFullTweet: formatted.isFullTweet,
      summary: raw.quotedText ? cleanSensationalistText(raw.quotedText).slice(0, 220) : '',
      imageUrl: raw.imageUrl || '',
      ...(rawImageUrls.length > (raw.mp4Url ? 0 : 1) ? { imageUrls: rawImageUrls } : {}),
      imageAlt: `${authorName} post`,
      videoStreamUrl: raw.mp4Url || undefined,
      isAnimatedGif: raw.isAnimatedGif || undefined,
      isHighlightClip: isHighlightClip || undefined,
      hasInlineChartImage: hasInlineChartImage || undefined,
      isLeagueWideFilmChart: isLeagueWideChart || undefined,
      filmOnlyScope: filmOnlyScope || undefined,
      duration: raw.durationFmt || undefined,
      embeddable: raw.mp4Url ? true : undefined,
      mentionedPlayers: mentioned,
      publishedAt: raw.publishedAt,
      url: raw.url,
      externalUrl: safeExt,
      ...(Array.isArray(raw.inlineLinks) && raw.inlineLinks.length > 0 ? { inlineLinks: raw.inlineLinks } : {}),
      externalTitle: null,
      externalDescription: null,
      outletId,
      outletName,
      reporterId: dirEntry?.id || null,
      reporterName: authorName,
      author: authorName,
      authorHandle,
      authorProfileUrl: `https://x.com/${raw.handle}`,
      trustTier,
      wireSource: 'x_timeline_live',
      isBreaking: brk.isBreaking,
      isInGameInjury: brk.isInGameInjury,
      breakingBadge: brk.breakingBadge,
      breakingPriority: brk.breakingPriority,
      category: resolvedCategory,
      signalScore: Math.max(resolvedCategory === 'film' ? 84 : 78, sig.signalScore),
      fluffScore: sig.fluffScore,
      isClickbait: false
    };
    built.authorProfileUrl = resolveItemAuthorProfileUrl(built, raw.url);
    normalized.push(built);
  }

  return normalized;
}

/**
 * Lightweight 32-team embedded X status harvester for club RSS, PFR RSS, and ESPN News payloads.
 * Hydrates up to `maxHydrate` recent `x.com/<handle>/status/<id>` embeds via `cdn.syndication.twimg.com/tweet-result`
 * preserving videos, animated GIFs (`isAnimatedGif`), and analytics charts.
 */
export async function harvestEmbeddedXForTeamRss(
  rawPayloads = [],
  { team = null, rosterPlayers = [], reportersData = null, nowMs = Date.now(), maxHydrate = 24, allowEmbeddedBeatQuotes = false } = {}
) {
  const active = resolveTeamConfig(team);
  const sevenDaysAgoMs = nowMs - 7 * 86_400_000;
  const statusRegex = /https?:\/\/(?:www\.|mobile\.)?(?:x|twitter)\.com\/([A-Za-z0-9_]{2,25})\/status\/(\d{15,22})/gi;
  const allowedHandles = new Set([
    ...selectTeamLocalXHandles(active, reportersData, 32).map(h => h.toLowerCase()),
    ...NATIONAL_FILM_ANALYTICS_X_HANDLES.map(h => h.toLowerCase()),
    'nfl',
    'espnnfl',
    'nflnetwork',
    'adamschefter',
    'rapsheet',
    'tompelissero',
    'mikegarafolo',
    'dmrussini',
    'fieldyates',
    'jayglazer',
    'profootballtalk',
    'mysportsupdate',
    'nfl_dovkleiman'
  ]);

  const otherTeamOfficialHandles = new Set(
    Object.entries(OFFICIAL_TEAM_X_HANDLES_BY_ABBR)
      .filter(([abbr]) => abbr !== active.abbr)
      .map(([, h]) => String(h || '').toLowerCase())
      .filter(Boolean)
  );

  const candById = new Map();
  for (const raw of rawPayloads) {
    if (!raw || typeof raw !== 'string') continue;
    const decoded = raw.replace(/\\\//g, '/').replace(/&amp;/gi, '&');
    for (const m of decoded.matchAll(statusRegex)) {
      const handle = m[1];
      const handleLow = handle.toLowerCase();
      const sid = m[2];
      if (/^(i|intent|share|hashtag|search)$/i.test(handle)) continue;
      // Never pull other clubs' official or PR/Comms accounts from roundup/tribute articles
      if (otherTeamOfficialHandles.has(handleLow)) continue;
      if (/(?:comms|pr)$/i.test(handleLow) && !allowedHandles.has(handleLow)) continue;
      const isKnownRep = allowedHandles.has(handleLow) || Boolean(resolveReporterFromNameOrHandle(handle, active));
      if (!isKnownRep && !allowEmbeddedBeatQuotes) continue;
      const snowMs = extractXSnowflakeTimestampMs(sid);
      if (!snowMs || snowMs < sevenDaysAgoMs || snowMs > nowMs + 6 * 3_600_000) continue;
      if (!candById.has(sid)) candById.set(sid, { handle, statusId: sid, snowMs, isKnownRep });
    }
  }

  const batch = [...candById.values()]
    .sort((a, b) => Number(b.isKnownRep) - Number(a.isKnownRep) || b.snowMs - a.snowMs)
    .slice(0, maxHydrate);
  if (batch.length === 0) return [];

  const hydratedRaw = [];
  const hydrateConcurrency = 4;
  for (let i = 0; i < batch.length; i += hydrateConcurrency) {
    if (i > 0) await new Promise(r => setTimeout(r, 150));
    const microBatch = batch.slice(i, i + hydrateConcurrency);
    await Promise.allSettled(
      microBatch.map(async cand => {
        try {
          let hydrated = null;
          // 1. Primary: cdn.syndication.twimg.com/tweet-result (skip immediately when 429 circuit-breaker is active)
          if (Date.now() >= syndicationRateLimitedUntilMs) {
            try {
              const res = await fetch(
                `https://cdn.syndication.twimg.com/tweet-result?id=${encodeURIComponent(cand.statusId)}&token=x`,
                { signal: AbortSignal.timeout(3800) }
              );
              if (res.status === 429) {
                syndicationRateLimitedUntilMs = Date.now() + 5 * 60_000;
              } else if (res.ok) {
                const syn = await res.json();
                const txt =
                  typeof syn?.text === 'string'
                    ? normalizeMultilineSocialText(
                        decodeHtmlEntities(syn.text).replace(/https?:\/\/t\.co\/[A-Za-z0-9]+/gi, '')
                      )
                    : '';
                const media = extractXSyndicationMedia(syn);
                if (txt && txt.length >= (media.mp4Url || media.imageUrl ? 6 : 16)) {
                  const screenName = syn.user?.screen_name || cand.handle;
                  const durFmt =
                    !media.isAnimatedGif && media.durationMs >= 4000
                      ? `${Math.floor(media.durationMs / 60000)}:${String(Math.round((media.durationMs % 60000) / 1000)).padStart(2, '0')}`
                      : '';
                  const extUrls = Array.isArray(syn?.entities?.urls)
                    ? syn.entities.urls.map(u => u?.expanded_url || '').filter(Boolean)
                    : [];
                  const nonSocialExt = extUrls.find(u => !/^https?:\/\/(?:www\.)?(?:x|twitter)\.com\//i.test(u)) || '';
                  hydrated = {
                    statusId: cand.statusId,
                    handle: screenName,
                    sourceHandle: screenName,
                    userName: decodeHtmlEntities(syn.user?.name || `@${screenName}`),
                    text: txt,
                    quotedText: syn.quoted_tweet?.text ? decodeHtmlEntities(syn.quoted_tweet.text).replace(/\s+/g, ' ').trim() : '',
                    url: `https://x.com/${screenName}/status/${cand.statusId}`,
                    externalUrl: nonSocialExt,
                    mp4Url: media.mp4Url,
                    isAnimatedGif: media.isAnimatedGif,
                    durationMs: media.durationMs,
                    durationFmt: durFmt,
                    imageUrl: media.imageUrl,
                    imageUrls:
                      Array.isArray(media.imageUrls) && media.imageUrls.length > (media.mp4Url ? 0 : 1)
                        ? media.imageUrls
                        : undefined,
                    isPhoto: media.isPhoto,
                    publishedAt: new Date(Math.min(nowMs, cand.snowMs)).toISOString()
                  };
                }
              }
            } catch {
              // Fall through to api.fxtwitter.com
            }
          }

          // 2. Resilient fallback: public api.fxtwitter.com/<user>/status/<id> (returns full video.twimg.com MP4/GIF/chart media even when syndication 429s)
          if (!hydrated) {
            const fxRes = await fetch(
              `https://api.fxtwitter.com/${encodeURIComponent(cand.handle)}/status/${encodeURIComponent(cand.statusId)}`,
              { signal: AbortSignal.timeout(4200), headers: { Accept: 'application/json' } }
            );
            if (fxRes.ok) {
              const fxJson = await fxRes.json();
              const tw = fxJson?.tweet;
              const txt = normalizeMultilineSocialText(
                decodeHtmlEntities(String(tw?.text || '')).replace(/https?:\/\/t\.co\/[A-Za-z0-9]+/gi, '')
              );
              const fxVid = Array.isArray(tw?.media?.videos) ? tw.media.videos[0] : null;
              const fxPhotoUrls = (Array.isArray(tw?.media?.photos) ? tw.media.photos : [])
                .map(p => String(p?.url || '').trim())
                .filter(u => u.startsWith('https://'))
                .slice(0, 4);
              const fxPhoto = fxPhotoUrls[0] ? { url: fxPhotoUrls[0] } : null;
              const mp4Url =
                fxVid?.url && /^https:\/\/video\.twimg\.com\//i.test(String(fxVid.url)) ? String(fxVid.url) : '';
              const isAnimatedGif = Boolean(mp4Url && (fxVid?.type === 'gif' || /\/tweet_video\//i.test(mp4Url)));
              const durationMs = Math.round(Number(fxVid?.duration || 0) * 1000);
              const durFmt =
                !isAnimatedGif && durationMs >= 4000
                  ? `${Math.floor(durationMs / 60000)}:${String(Math.round((durationMs % 60000) / 1000)).padStart(2, '0')}`
                  : '';
              const imageUrl = String(fxVid?.thumbnail_url || fxPhoto?.url || '').trim();
              const distinctFxPhotos = mp4Url ? fxPhotoUrls.filter(u => u !== imageUrl) : fxPhotoUrls;
              if (txt && txt.length >= (mp4Url || imageUrl ? 6 : 16)) {
                const screenName = tw?.author?.screen_name || cand.handle;
                hydrated = {
                  statusId: cand.statusId,
                  handle: screenName,
                  sourceHandle: screenName,
                  userName: decodeHtmlEntities(tw?.author?.name || `@${screenName}`),
                  text: txt,
                  quotedText: tw?.quote?.text ? decodeHtmlEntities(tw.quote.text).replace(/\s+/g, ' ').trim() : '',
                  url: `https://x.com/${screenName}/status/${cand.statusId}`,
                  externalUrl: '',
                  mp4Url,
                  isAnimatedGif,
                  durationMs,
                  durationFmt: durFmt,
                  imageUrl: imageUrl.startsWith('https://') ? imageUrl : '',
                  imageUrls: distinctFxPhotos.length > (mp4Url ? 0 : 1) ? distinctFxPhotos : undefined,
                  isPhoto: Boolean(!mp4Url && fxPhoto?.url),
                  publishedAt: new Date(Math.min(nowMs, cand.snowMs)).toISOString()
                };
              }
            }
          }

          // For unregistered handles embedded inside beat articles, require inline video/GIF OR a football analytics/film chart photo
          // so random text-only fan quotes or personal condolence photos never dilute the team wire.
          if (hydrated) {
            const hasInlineClip = Boolean(hydrated.mp4Url || hydrated.isAnimatedGif);
            const hasAnalyticsChartPhoto = Boolean(
              hydrated.isPhoto &&
                /\b(epa|cpoe|pff|grade[sd]?|chart|scatter|efficiency|separation|pressure|pass[- ]?rush|coverage|snap\s*count|all-?22|film|tape|next\s+gen|yards\/|passer\s+rating|ranking|percentile|trench)\b/i.test(
                  hydrated.text || ''
                )
            );
            if (cand.isKnownRep || hasInlineClip || hasAnalyticsChartPhoto) {
              hydratedRaw.push(hydrated);
            }
          }
        } catch {
          // Ignore single status timeout
        }
      })
    );
  }

  return filterXTimelineItemsForTeam(hydratedRaw, {
    team: active,
    rosterPlayers,
    reportersData,
    isNationalPool: false,
    nowMs
  });
}

// ============================================================================
// OPTION B: Free Gemini `google_search` Grounded X-Status Discovery + FxTwitter Hydration
//
// Quota Allocation Policy (Daily RPD resets midnight PT; SF goes FIRST with 2x quota
// on best tokens; even 1x Flash-first quota across the other 31 clubs; plus 2/day
// shared Stage-1 national film/analytics sweeps benefiting all 32 teams):
//   - Shared National Film & Analytics (Stage 1, all 32 teams): 2 calls/day (am + pm)
//   - San Francisco 49ers (Priority #1, runs FIRST):           2 calls/day (am + pm, 2x)
//   - All Other 31 NFL Clubs (even logic, Flash-first):        1 call/day each (31 total)
//   Total Option B Discovery Budget: 35 calls/day across ALL 32 clubs (~7% of 500 RPD Search cap)
// ============================================================================

export const GEMINI_X_DISCOVERY_QUOTA_POLICY = Object.freeze({
  nationalSharedDailyCalls: 2,
  sfDailyCalls: 2,
  otherTeamDailyCalls: 1,
  sfModelCascade: Object.freeze([
    'gemini-4-hydrogen',
    'gemini-3.8-flash',
    'gemini-3.5-flash',
    'gemini-3-flash-preview',
    'gemini-2.5-flash'
  ]),
  nationalModelCascade: Object.freeze([
    'gemini-4-hydrogen',
    'gemini-3.8-flash',
    'gemini-3.5-flash',
    'gemini-3-flash-preview',
    'gemini-2.5-flash'
  ]),
  otherTeamModelCascade: Object.freeze([
    'gemini-3.8-flash',
    'gemini-3.5-flash',
    'gemini-3-flash-preview',
    'gemini-2.5-flash',
    'gemini-2.5-flash-lite'
  ]),
  nationalVideoHandles: Object.freeze([
    'BaldyNFL',
    'BrandonThornNFL',
    'FB_FilmAnalysis',
    'QBKlass',
    'kurt13warner',
    'danorlovsky7',
    'Nate_Tice',
    'BenjaminSolak',
    'BrettKollmann',
    'theqbschool'
  ]),
  nationalAnalyticsChartHandles: Object.freeze([
    'CollinsworthPFF',
    'throwthedamball',
    'ghatz_28',
    'tejfbanalytics',
    'SumerSports',
    'PFF_Moo',
    'fball_insights',
    'benbbaldwin',
    'SethWalder',
    'minakimes',
    'NextGenStats',
    'PFF'
  ])
});

const GEMINI_X_DISCOVERY_429_UNTIL_MS = new Map();

export function resetGeminiXDiscoveryRateLimitsForTest() {
  GEMINI_X_DISCOVERY_429_UNTIL_MS.clear();
}

export function resolvePacificDateAndHour(nowMs = Date.now()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Los_Angeles',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    hour12: false
  }).formatToParts(new Date(nowMs));
  const get = type => parts.find(p => p.type === type)?.value || '';
  const hourNum = Number(get('hour')) % 24;
  return {
    datePt: `${get('year')}-${get('month')}-${get('day')}`,
    hourPt: Number.isFinite(hourNum) ? hourNum : 12
  };
}

/**
 * Pure deterministic scheduler for Option B Gemini Search X-status discovery.
 * Guarantees:
 *   - 49ers (SF) gets 2x daily quota (am + pm) on the best model cascade and runs FIRST.
 *   - Shared National Film & Analytics gets 2 daily sweeps (am = film video/GIFs, pm = PFF/EPA charts) for all 32 clubs.
 *   - Other 31 clubs get an even 1x daily sweep (`daily`) on a Flash-first cascade so `gemini-4-hydrogen`
 *     remains protected for SF and Daily Top News Briefs.
 *   - Already-completed PT slots spend 0 Gemini calls on subsequent 30-min CI ticks.
 */
export function resolveGeminiXDiscoveryPlan({
  scope = 'team',
  team = null,
  nowMs = Date.now(),
  prevMeta = null,
  hasApiKey = false,
  force = false
} = {}) {
  const { datePt, hourPt } = resolvePacificDateAndHour(nowMs);
  const active = scope === 'team' ? resolveTeamConfig(team) : null;
  const isSf = scope === 'team' && active?.abbr === 'SF';
  const isNational = scope === 'national';

  const dailyQuota = isNational
    ? GEMINI_X_DISCOVERY_QUOTA_POLICY.nationalSharedDailyCalls
    : isSf
      ? GEMINI_X_DISCOVERY_QUOTA_POLICY.sfDailyCalls
      : GEMINI_X_DISCOVERY_QUOTA_POLICY.otherTeamDailyCalls;

  const slotKey = isNational || isSf ? (hourPt >= 15 ? 'pm' : 'am') : 'daily';
  const modelCascade = isNational
    ? [...GEMINI_X_DISCOVERY_QUOTA_POLICY.nationalModelCascade]
    : isSf
      ? [...GEMINI_X_DISCOVERY_QUOTA_POLICY.sfModelCascade]
      : [...GEMINI_X_DISCOVERY_QUOTA_POLICY.otherTeamModelCascade];

  const prevDate = String(prevMeta?.datePt || '').trim();
  const completedToday =
    prevDate === datePt && Array.isArray(prevMeta?.completedSlots) ? prevMeta.completedSlots : [];
  const alreadyDoneSlot = !force && completedToday.includes(slotKey);
  const dailyBudgetSpent = !force && completedToday.length >= dailyQuota;

  return {
    shouldRun: Boolean(hasApiKey && !alreadyDoneSlot && !dailyBudgetSpent),
    reason: !hasApiKey
      ? 'no_api_key'
      : alreadyDoneSlot
        ? 'slot_already_completed_today'
        : dailyBudgetSpent
          ? 'daily_quota_completed'
          : 'ready',
    scope,
    teamAbbr: active?.abbr || 'NFL',
    isSfPriority: isSf,
    datePt,
    hourPt,
    slotKey,
    dailyQuota,
    completedSlotsToday: completedToday,
    modelCascade
  };
}

/**
 * Extracts verified `https://x.com/<handle>/status/<id>` URLs from a Gemini `google_search`
 * response (both non-thought text parts AND `groundingMetadata.groundingChunks`, including
 * fast HEAD redirect unwrapping for `vertexaisearch.cloud.google.com/grounding-api-redirect/`).
 */
export async function extractXStatusUrlsFromGeminiResponse(
  geminiJson = null,
  { fetchImpl = globalThis.fetch, resolveRedirects = true, maxRedirects = 8, timeoutMs = 2500 } = {}
) {
  const statusRegex = /https?:\/\/(?:www\.|mobile\.)?(?:x|twitter)\.com\/([A-Za-z0-9_]{2,25})\/status\/(\d{15,22})/gi;
  const bySid = new Map();
  const addStatusUrl = (handle, sid) => {
    if (!handle || !sid || /^(i|intent|share|hashtag|search)$/i.test(handle)) return;
    if (!bySid.has(sid)) bySid.set(sid, `https://x.com/${handle}/status/${sid}`);
  };
  const scanText = txt => {
    if (!txt || typeof txt !== 'string') return;
    const cleaned = txt.replace(/\\\//g, '/').replace(/&amp;/gi, '&');
    for (const m of cleaned.matchAll(statusRegex)) {
      addStatusUrl(m[1], m[2]);
    }
  };

  const cand = geminiJson?.candidates?.[0] || {};
  const parts = Array.isArray(cand?.content?.parts) ? cand.content.parts : [];
  for (const p of parts) {
    if (p && !p.thought && typeof p.text === 'string') {
      scanText(p.text);
    }
  }

  const chunks = Array.isArray(cand?.groundingMetadata?.groundingChunks)
    ? cand.groundingMetadata.groundingChunks
    : [];
  const redirectCandidates = [];
  for (const ch of chunks) {
    const uri = String(ch?.web?.uri || '').trim();
    const title = String(ch?.web?.title || '').trim();
    if (!uri) continue;
    scanText(uri);
    if (
      resolveRedirects &&
      /vertexaisearch\.cloud\.google\.com\/grounding-api-redirect\//i.test(uri) &&
      (/\b(?:x\.com|twitter|on x)\b/i.test(title) || /@[A-Za-z0-9_]{2,25}/.test(title) || redirectCandidates.length < 4)
    ) {
      redirectCandidates.push(uri);
    }
  }

  if (resolveRedirects && redirectCandidates.length > 0 && typeof fetchImpl === 'function') {
    const toProbe = redirectCandidates.slice(0, maxRedirects);
    await Promise.allSettled(
      toProbe.map(async redirUrl => {
        try {
          const res = await fetchImpl(redirUrl, {
            method: 'HEAD',
            redirect: 'manual',
            signal: AbortSignal.timeout(timeoutMs)
          });
          const loc = String(res?.headers?.get?.('location') || '').trim();
          if (loc) scanText(loc);
        } catch {
          // Ignore unreachable redirect
        }
      })
    );
  }

  return [...bySid.values()];
}

/**
 * Runs 1 grounded Gemini Google Search call to discover fresh (`<=7d`) `x.com/<handle>/status/<id>`
 * URLs for All-22 film clips, animated GIFs, PFF grades, and analytics scatter charts.
 * Every discovered URL is subsequently hydrated & verified against real X/FxTwitter APIs
 * (so hallucinated IDs are impossible).
 */
export async function discoverXStatusesViaGeminiSearch({
  scope = 'team',
  team = null,
  slotKey = 'am',
  handles = [],
  rosterPlayers = [],
  apiKey = '',
  modelCascade = null,
  nowMs = Date.now(),
  timeoutMs = 18000,
  fetchImpl = globalThis.fetch
} = {}) {
  const cleanKey = String(apiKey || '').trim();
  if (!cleanKey || typeof fetchImpl !== 'function') {
    return { ok: false, skipped: true, reason: 'no_api_key', modelUsed: null, statusUrls: [] };
  }
  const active = scope === 'team' ? resolveTeamConfig(team) : null;
  const cleanHandles = Array.from(
    new Set(
      (Array.isArray(handles) ? handles : [])
        .map(h => String(h || '').replace(/^@/, '').trim())
        .filter(h => /^[A-Za-z0-9_]{2,25}$/.test(h))
    )
  ).slice(0, 18);
  if (cleanHandles.length === 0) {
    return { ok: false, skipped: true, reason: 'no_handles', modelUsed: null, statusUrls: [] };
  }

  const cascade =
    Array.isArray(modelCascade) && modelCascade.length > 0
      ? modelCascade
      : scope === 'national'
        ? GEMINI_X_DISCOVERY_QUOTA_POLICY.nationalModelCascade
        : active?.abbr === 'SF'
          ? GEMINI_X_DISCOVERY_QUOTA_POLICY.sfModelCascade
          : GEMINI_X_DISCOVERY_QUOTA_POLICY.otherTeamModelCascade;

  const { datePt } = resolvePacificDateAndHour(nowMs);
  const handleListText = cleanHandles.map(h => `@${h}`).join(', ');
  const starNames = (Array.isArray(rosterPlayers) ? rosterPlayers : [])
    .filter(p => p?.name && (p.rosterBucket === 'active' || p.rosterBucket === 'ir'))
    .slice(0, 6)
    .map(p => p.name)
    .join(', ');

  const prompt =
    scope === 'national'
      ? `Today is ${datePt}. Use Google Search to find recent (last 5 days) X/Twitter posts from these NFL film & analytics accounts: ${handleListText}.
Focus specifically on posts with ${slotKey === 'pm' ? 'PFF grades, EPA/CPOE/coverage/separation scatter charts, or statistical tables' : 'All-22 film breakdowns, play-design video clips, pass-rush/OL trench GIFs, or QB tape clips'}.
Return ONLY exact, verified https://x.com/<handle>/status/<numeric_id> URLs that actually appeared in your Google Search results (one URL per line, up to 20 URLs). NEVER invent or guess a status ID.`
      : `Today is ${datePt}. Use Google Search to find recent (last 5 days) X/Twitter posts about the ${active.fullName} (${active.nickname}${starNames ? `, key players: ${starNames}` : ''}) from these beat, film, and highlight accounts: ${handleListText}.
Focus specifically on posts with All-22 film clips, OL/DL trench GIFs, play-design breakdowns, PFF/EPA stat charts, or player highlight videos${slotKey === 'pm' ? ' (also include recent @BaldyNFL, @CollinsworthPFF, @FB_FilmAnalysis, or @throwthedamball posts mentioning ' + active.nickname + ' players)' : ''}.
Return ONLY exact, verified https://x.com/<handle>/status/<numeric_id> URLs that actually appeared in your Google Search results (one URL per line, up to 18 URLs). NEVER invent or guess a status ID.`;

  const rateLimitedModels = [];
  let lastError = 'all_models_failed';

  for (const model of cascade) {
    const blockedUntil = GEMINI_X_DISCOVERY_429_UNTIL_MS.get(model) || 0;
    if (nowMs < blockedUntil) {
      rateLimitedModels.push(model);
      continue;
    }
    const thinkingConfig = buildGeminiThinkingConfig(model, { preferredThinkingLevel: 'LOW' });
    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(cleanKey)}`;
    try {
      const res = await fetchImpl(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tools: [{ google_search: {} }],
          generationConfig: {
            temperature: 0.0,
            maxOutputTokens: 1024,
            ...(thinkingConfig ? { thinkingConfig } : {})
          },
          contents: [{ role: 'user', parts: [{ text: prompt }] }]
        }),
        signal: AbortSignal.timeout(timeoutMs)
      });
      if (res.status === 429) {
        GEMINI_X_DISCOVERY_429_UNTIL_MS.set(model, nowMs + 15 * 60_000);
        rateLimitedModels.push(model);
        lastError = `${model}: HTTP 429`;
        continue;
      }
      if (!res.ok) {
        lastError = `${model}: HTTP ${res.status}`;
        continue;
      }
      const json = await res.json();
      const statusUrls = await extractXStatusUrlsFromGeminiResponse(json, {
        fetchImpl,
        resolveRedirects: true,
        maxRedirects: 10
      });
      return {
        ok: true,
        modelUsed: model,
        slotKey,
        datePt,
        statusUrls,
        rawPayloadText: statusUrls.join('\n'),
        rateLimitedModels
      };
    } catch (err) {
      lastError = `${model}: ${err?.message || String(err)}`;
    }
  }

  return {
    ok: false,
    reason: lastError,
    modelUsed: null,
    slotKey,
    datePt,
    statusUrls: [],
    rawPayloadText: '',
    rateLimitedModels
  };
}

/**
 * Hydrates a list of discovered national `x.com/<handle>/status/<id>` URLs ONCE in Stage 1
 * via `cdn.syndication.twimg.com` -> `api.fxtwitter.com`, returning raw X timeline objects
 * that Stage 2 filters cleanly to each of the 32 NFL clubs via `filterXTimelineItemsForTeam`.
 */
export async function hydrateRawXStatusUrlsBatch(
  statusUrls = [],
  { nowMs = Date.now(), maxHydrate = 24, concurrency = 4, fetchImpl = globalThis.fetch } = {}
) {
  const statusRegex = /https?:\/\/(?:www\.|mobile\.)?(?:x|twitter)\.com\/([A-Za-z0-9_]{2,25})\/status\/(\d{15,22})/i;
  const sevenDaysAgoMs = nowMs - 7 * 86_400_000;
  const candById = new Map();
  for (const rawUrl of Array.isArray(statusUrls) ? statusUrls : []) {
    const m = String(rawUrl || '').match(statusRegex);
    if (!m) continue;
    const handle = m[1];
    const sid = m[2];
    if (/^(i|intent|share|hashtag|search)$/i.test(handle)) continue;
    const snowMs = extractXSnowflakeTimestampMs(sid);
    if (!snowMs || snowMs < sevenDaysAgoMs || snowMs > nowMs + 6 * 3_600_000) continue;
    if (!candById.has(sid)) candById.set(sid, { handle, statusId: sid, snowMs });
  }

  const batch = [...candById.values()]
    .sort((a, b) => b.snowMs - a.snowMs)
    .slice(0, maxHydrate);
  if (batch.length === 0) return [];

  const hydratedRaw = [];
  for (let i = 0; i < batch.length; i += concurrency) {
    if (i > 0) await new Promise(r => setTimeout(r, 150));
    const microBatch = batch.slice(i, i + concurrency);
    await Promise.allSettled(
      microBatch.map(async cand => {
        try {
          let hydrated = null;
          if (Date.now() >= syndicationRateLimitedUntilMs) {
            try {
              const res = await fetchImpl(
                `https://cdn.syndication.twimg.com/tweet-result?id=${encodeURIComponent(cand.statusId)}&token=x`,
                { signal: AbortSignal.timeout(3800) }
              );
              if (res.status === 429) {
                syndicationRateLimitedUntilMs = Date.now() + 5 * 60_000;
              } else if (res.ok) {
                const syn = await res.json();
                const txt =
                  typeof syn?.text === 'string'
                    ? normalizeMultilineSocialText(
                        decodeHtmlEntities(syn.text).replace(/https?:\/\/t\.co\/[A-Za-z0-9]+/gi, '')
                      )
                    : '';
                const media = extractXSyndicationMedia(syn);
                if (txt && txt.length >= (media.mp4Url || media.imageUrl ? 6 : 16)) {
                  const screenName = syn.user?.screen_name || cand.handle;
                  const durFmt =
                    !media.isAnimatedGif && media.durationMs >= 4000
                      ? `${Math.floor(media.durationMs / 60000)}:${String(Math.round((media.durationMs % 60000) / 1000)).padStart(2, '0')}`
                      : '';
                  const extUrls = Array.isArray(syn?.entities?.urls)
                    ? syn.entities.urls.map(u => u?.expanded_url || '').filter(Boolean)
                    : [];
                  const nonSocialExt = extUrls.find(u => !/^https?:\/\/(?:www\.)?(?:x|twitter)\.com\//i.test(u)) || '';
                  hydrated = {
                    statusId: cand.statusId,
                    handle: screenName,
                    sourceHandle: screenName,
                    userName: decodeHtmlEntities(syn.user?.name || `@${screenName}`),
                    text: txt,
                    quotedText: syn.quoted_tweet?.text ? decodeHtmlEntities(syn.quoted_tweet.text).replace(/\s+/g, ' ').trim() : '',
                    url: `https://x.com/${screenName}/status/${cand.statusId}`,
                    externalUrl: nonSocialExt,
                    mp4Url: media.mp4Url,
                    isAnimatedGif: media.isAnimatedGif,
                    durationMs: media.durationMs,
                    durationFmt: durFmt,
                    imageUrl: media.imageUrl,
                    imageUrls:
                      Array.isArray(media.imageUrls) && media.imageUrls.length > (media.mp4Url ? 0 : 1)
                        ? media.imageUrls
                        : undefined,
                    isPhoto: media.isPhoto,
                    publishedAt: new Date(Math.min(nowMs, cand.snowMs)).toISOString()
                  };
                }
              }
            } catch {}
          }

          if (!hydrated) {
            const fxRes = await fetchImpl(
              `https://api.fxtwitter.com/${encodeURIComponent(cand.handle)}/status/${encodeURIComponent(cand.statusId)}`,
              { signal: AbortSignal.timeout(4200), headers: { Accept: 'application/json' } }
            );
            if (fxRes.ok) {
              const fxJson = await fxRes.json();
              const tw = fxJson?.tweet;
              const txt = normalizeMultilineSocialText(
                decodeHtmlEntities(String(tw?.text || '')).replace(/https?:\/\/t\.co\/[A-Za-z0-9]+/gi, '')
              );
              const fxVid = Array.isArray(tw?.media?.videos) ? tw.media.videos[0] : null;
              const fxPhotoUrls = (Array.isArray(tw?.media?.photos) ? tw.media.photos : [])
                .map(p => String(p?.url || '').trim())
                .filter(u => u.startsWith('https://'))
                .slice(0, 4);
              const fxPhoto = fxPhotoUrls[0] ? { url: fxPhotoUrls[0] } : null;
              const mp4Url =
                fxVid?.url && /^https:\/\/video\.twimg\.com\//i.test(String(fxVid.url)) ? String(fxVid.url) : '';
              const isAnimatedGif = Boolean(mp4Url && (fxVid?.type === 'gif' || /\/tweet_video\//i.test(mp4Url)));
              const durationMs = Math.round(Number(fxVid?.duration || 0) * 1000);
              const durFmt =
                !isAnimatedGif && durationMs >= 4000
                  ? `${Math.floor(durationMs / 60000)}:${String(Math.round((durationMs % 60000) / 1000)).padStart(2, '0')}`
                  : '';
              const imageUrl = String(fxVid?.thumbnail_url || fxPhoto?.url || '').trim();
              const distinctFxPhotos = mp4Url ? fxPhotoUrls.filter(u => u !== imageUrl) : fxPhotoUrls;
              if (txt && txt.length >= (mp4Url || imageUrl ? 6 : 16)) {
                const screenName = tw?.author?.screen_name || cand.handle;
                hydrated = {
                  statusId: cand.statusId,
                  handle: screenName,
                  sourceHandle: screenName,
                  userName: decodeHtmlEntities(tw?.author?.name || `@${screenName}`),
                  text: txt,
                  quotedText: tw?.quote?.text ? decodeHtmlEntities(tw.quote.text).replace(/\s+/g, ' ').trim() : '',
                  url: `https://x.com/${screenName}/status/${cand.statusId}`,
                  externalUrl: '',
                  mp4Url,
                  isAnimatedGif,
                  durationMs,
                  durationFmt: durFmt,
                  imageUrl: imageUrl.startsWith('https://') ? imageUrl : '',
                  imageUrls: distinctFxPhotos.length > (mp4Url ? 0 : 1) ? distinctFxPhotos : undefined,
                  isPhoto: Boolean(!mp4Url && fxPhoto?.url),
                  publishedAt: new Date(Math.min(nowMs, cand.snowMs)).toISOString()
                };
              }
            }
          }
          if (hydrated) hydratedRaw.push(hydrated);
        } catch {}
      })
    );
  }
  return hydratedRaw;
}
