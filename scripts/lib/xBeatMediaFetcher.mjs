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
 * Used identically across `49ers.joshal.com` (`scripts/fetch-live-49ers-data.mjs`) and
 * all 31 other NFL club sites (`scripts/fetch-team-data.mjs`) for 100% 32-team parity.
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
  sanitizeExternalUrl,
  stripAggregatorBoilerplate,
  stripNon49ersEntityContexts
} from '../../src/engine/linkIntegrity.js';
import {
  classifyBreakingItem,
  classifyNewsItemCategory,
  formatTweetBodyForDisplay
} from '../../src/engine/breakingClassifier.js';
import {
  extractXSnowflakeTimestampMs,
  resolveItemAuthorProfileUrl,
  resolveReporterFromNameOrHandle
} from '../../src/engine/beatAttributionEngine.js';
import { cleanSensationalistText, scoreContentSignal } from '../../src/engine/antiFluffFilter.js';
import { resolveTeamConfig } from '../../src/config/teamRegistry.js';

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
  'CollinsworthPFF',
  'throwthedamball',
  'ghatz_28',
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
 * Curated 49ers beat, All-22 film, GIF, and highlight X accounts.
 */
export const SF_BEAT_FILM_X_HANDLES = Object.freeze([
  '49ers',
  'dieter',
  'SulligentHUB',
  'StatsOnFire',
  'GrustasBrady',
  'MaioccoNBCS',
  'mattbarrows',
  'LombardiHimself',
  'nwagoner',
  'KP_Show',
  'akashanav',
  'Crocky209',
  'NBCS49ers',
  'OurSF49ers',
  'Coach_Yac',
  'PFF_Jeff'
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
  const mediaSources = [
    ...(Array.isArray(tw?.extended_entities?.media) ? tw.extended_entities.media : []),
    ...(Array.isArray(tw?.entities?.media) ? tw.entities.media : []),
    ...(Array.isArray(tw?.quoted_status?.extended_entities?.media)
      ? tw.quoted_status.extended_entities.media
      : []),
    ...(Array.isArray(tw?.retweeted_status?.extended_entities?.media)
      ? tw.retweeted_status.extended_entities.media
      : [])
  ];
  const vidMedia = mediaSources.find(
    m => m && (m.type === 'video' || m.type === 'animated_gif') && m.video_info?.variants
  );
  const photoMedia = mediaSources.find(m => m && m.type === 'photo' && m.media_url_https) ||
    mediaSources.find(m => m && m.media_url_https);

  if (!vidMedia) {
    const imgUrl = String(photoMedia?.media_url_https || '').trim();
    return {
      mp4Url: '',
      isAnimatedGif: false,
      durationMs: 0,
      thumbUrl: imgUrl.startsWith('https://') ? imgUrl : '',
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
  const thumbUrl = String(vidMedia.media_url_https || photoMedia?.media_url_https || '').trim();

  return {
    mp4Url,
    isAnimatedGif,
    durationMs: Number(vidMedia.video_info?.duration_millis || 0),
    thumbUrl: thumbUrl.startsWith('https://') ? thumbUrl : '',
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

    const rawText = decodeHtmlEntities(String(baseTw.full_text || baseTw.text || ''))
      .replace(/https?:\/\/t\.co\/[A-Za-z0-9]+/gi, '')
      .replace(/\s+/g, ' ')
      .trim();
    const quotedText = decodeHtmlEntities(String(baseTw.quoted_status?.full_text || baseTw.quoted_status?.text || ''))
      .replace(/https?:\/\/t\.co\/[A-Za-z0-9]+/gi, '')
      .replace(/\s+/g, ' ')
      .trim();
    const media = pickBestMediaFromTimelineTweet(baseTw);
    const caption = rawText || quotedText;
    const hasMedia = Boolean(media.mp4Url || media.thumbUrl);
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
      mp4Url: media.mp4Url,
      isAnimatedGif: media.isAnimatedGif,
      durationMs: media.durationMs,
      durationFmt: durFmt,
      imageUrl: media.thumbUrl,
      isPhoto: media.isPhoto,
      publishedAt: new Date(Math.min(nowMs, pubMs)).toISOString()
    });
  }

  return results;
}

/**
 * Fetches X syndication timelines across a list of handles with bounded concurrency & timeouts.
 */
export async function fetchXTimelinesBatch(
  handles = [],
  { concurrency = 5, timeoutMs = 4500, maxAgeHours = 120, maxItems = 16, nowMs = Date.now() } = {}
) {
  const cleanHandles = Array.from(
    new Set(
      (Array.isArray(handles) ? handles : [])
        .map(h => String(h || '').replace(/^@/, '').trim())
        .filter(h => /^[A-Za-z0-9_]{2,25}$/.test(h))
    )
  );
  if (cleanHandles.length === 0) return [];

  const all = [];
  for (let i = 0; i < cleanHandles.length; i += concurrency) {
    const slice = cleanHandles.slice(i, i + concurrency);
    const settled = await Promise.allSettled(
      slice.map(async h => {
        try {
          const res = await fetch(
            `https://syndication.twitter.com/srv/timeline-profile/screen-name/${encodeURIComponent(h)}`,
            { headers: X_SYNDICATION_HEADERS, signal: AbortSignal.timeout(timeoutMs) }
          );
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

/**
 * Selects local beat & film X handles for any of the 32 NFL clubs from its `reportersData` + official handle.
 */
export function selectTeamLocalXHandles(team, reportersData = null, maxHandles = 6) {
  const active = resolveTeamConfig(team);
  if (active.abbr === 'SF') return [...SF_BEAT_FILM_X_HANDLES];
  const out = [];
  const seen = new Set();
  const push = raw => {
    const h = String(raw || '').replace(/^@/, '').trim();
    if (!h || !/^[A-Za-z0-9_]{2,25}$/.test(h)) return;
    const low = h.toLowerCase();
    if (seen.has(low)) return;
    seen.add(low);
    out.push(h);
  };
  const official = OFFICIAL_TEAM_X_HANDLES_BY_ABBR[active.abbr];
  if (official) push(official);
  const reps = Array.isArray(reportersData?.reporters) ? reportersData.reporters : [];
  const localReps = reps
    .filter(
      r =>
        r &&
        r.handle &&
        !['national_insider', 'film_analyst', 'cap_analyst', 'draft', 'injury_analyst'].includes(
          String(r.category || '').toLowerCase()
        )
    )
    .sort((a, b) => (Number(a.trustTier) || 2) - (Number(b.trustTier) || 2) || (Number(b.baseScore) || 0) - (Number(a.baseScore) || 0));
  for (const r of localReps) {
    if (out.length >= maxHandles) break;
    push(r.handle);
  }
  return out;
}

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
    const last = (parts[parts.length - 1] || '').replace(/[^a-zA-Z'-]/g, '').toLowerCase();
    if (last.length >= 4) lastCounts.set(last, (lastCounts.get(last) || 0) + 1);
    parsedPlayers.push({ player: p, cleanFull, last, first: (parts[0] || '').toLowerCase() });
  }

  const matchPlayers = (text = '', { allowAllSingleSurnames = false, allowUniqueSurnames = true } = {}) => {
    const raw = String(text || '');
    const lower = raw.toLowerCase();
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
      const fullLower = entry.cleanFull.toLowerCase();
      if (fullLower.length >= 6 && new RegExp(`(?<![a-z0-9])${escapeRe(fullLower)}(?![a-z0-9])`, 'i').test(lower)) {
        addP(entry.player);
        continue;
      }
      // Match X @handles containing player name (e.g., @brockpurdy13, @gkittle46, @cmc_22)
      if (
        entry.last.length >= 5 &&
        new RegExp(`@[a-z0-9_]*${escapeRe(entry.last)}[a-z0-9_]*\\b`, 'i').test(lower) &&
        (!AMBIGUOUS_PLAYER_SURNAMES.has(entry.last) ||
          (entry.first && new RegExp(`@${escapeRe(entry.first[0])}[a-z0-9_]*${escapeRe(entry.last)}`, 'i').test(lower)))
      ) {
        addP(entry.player);
        continue;
      }
      if (entry.player.name === 'Christian McCaffrey' && /\bcmc\b/i.test(lower)) {
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

  for (const raw of Array.isArray(rawItems) ? rawItems : []) {
    if (!raw || !raw.url || seenUrls.has(raw.url)) continue;
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

    const cleanBody = cleanSensationalistText(stripAggregatorBoilerplate(raw.text || ''));
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
    const hasInlineChartImage = Boolean(
      hasPhoto &&
        (resolvedCategory === 'film' ||
          isLeagueWideChart ||
          LEAGUE_WIDE_FILM_ANALYTICS_HANDLES.has(handleLower))
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

    seenUrls.add(raw.url);
    const built = {
      id: `x_tl_${handleLower}_${raw.statusId}`,
      type: 'tweet',
      title: formatted.text,
      fullText: cleanBody,
      isFullTweet: formatted.isFullTweet,
      summary: raw.quotedText ? cleanSensationalistText(raw.quotedText).slice(0, 220) : '',
      imageUrl: raw.imageUrl || '',
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
  { team = null, rosterPlayers = [], reportersData = null, nowMs = Date.now(), maxHydrate = 14 } = {}
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
    'profootballtalk'
  ]);

  const candById = new Map();
  for (const raw of rawPayloads) {
    if (!raw || typeof raw !== 'string') continue;
    const decoded = raw.replace(/\\\//g, '/').replace(/&amp;/gi, '&');
    for (const m of decoded.matchAll(statusRegex)) {
      const handle = m[1];
      const sid = m[2];
      if (/^(i|intent|share|hashtag|search)$/i.test(handle)) continue;
      if (!allowedHandles.has(handle.toLowerCase()) && !resolveReporterFromNameOrHandle(handle, active)) continue;
      const snowMs = extractXSnowflakeTimestampMs(sid);
      if (!snowMs || snowMs < sevenDaysAgoMs || snowMs > nowMs + 6 * 3_600_000) continue;
      if (!candById.has(sid)) candById.set(sid, { handle, statusId: sid, snowMs });
    }
  }

  const batch = [...candById.values()]
    .sort((a, b) => b.snowMs - a.snowMs)
    .slice(0, maxHydrate);
  if (batch.length === 0) return [];

  const hydratedRaw = [];
  await Promise.allSettled(
    batch.map(async cand => {
      try {
        const res = await fetch(
          `https://cdn.syndication.twimg.com/tweet-result?id=${encodeURIComponent(cand.statusId)}&token=x`,
          { signal: AbortSignal.timeout(4000) }
        );
        if (!res.ok) return;
        const syn = await res.json();
        const txt = typeof syn?.text === 'string' ? decodeHtmlEntities(syn.text).replace(/https?:\/\/t\.co\/[A-Za-z0-9]+/gi, '').replace(/\s+/g, ' ').trim() : '';
        const media = extractXSyndicationMedia(syn);
        if (!txt || txt.length < (media.mp4Url || media.imageUrl ? 6 : 16)) return;
        const screenName = syn.user?.screen_name || cand.handle;
        const durFmt =
          !media.isAnimatedGif && media.durationMs >= 4000
            ? `${Math.floor(media.durationMs / 60000)}:${String(Math.round((media.durationMs % 60000) / 1000)).padStart(2, '0')}`
            : '';
        const extUrls = Array.isArray(syn?.entities?.urls)
          ? syn.entities.urls.map(u => u?.expanded_url || '').filter(Boolean)
          : [];
        const nonSocialExt = extUrls.find(u => !/^https?:\/\/(?:www\.)?(?:x|twitter)\.com\//i.test(u)) || '';
        hydratedRaw.push({
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
          isPhoto: media.isPhoto,
          publishedAt: new Date(Math.min(nowMs, cand.snowMs)).toISOString()
        });
      } catch {
        // Ignore single status timeout
      }
    })
  );

  return filterXTimelineItemsForTeam(hydratedRaw, {
    team: active,
    rosterPlayers,
    reportersData,
    isNationalPool: false,
    nowMs
  });
}
