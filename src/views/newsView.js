/**
 * Unified High-Signal Team News, Daily Gemini 4 Hydrogen (XHIGH) Top-News Brief,
 * Live Beat Wire, Game Highlights & All-22 Film View
 *
 * Single Two-Row Filter Bar (0px mobile overflow):
 * - Row 1: All | Tweets | Articles
 * - Row 2: Highlights & Videos | Film & Trench | Trades & Roster
 */

import {
  esc,
  escJargon,
  formatRelativeAge,
  renderPlayerChipsStripHtml,
  renderSalientThumbHtml,
  renderSalientHeroBannerHtml,
  registerRosterPlayersForInlineLinks
} from './uiHelpers.js';
import {
  optimizeImageUrlForSlot,
  resolveDailyBriefHeroMedia,
  resolveSalientCardVisual
} from '../engine/salientMediaEngine.js';
import { iconSvg } from './icons.js';
import {
  SHORT_TWEET_FULL_TEXT_LIMIT,
  isUrgentBreakingBadge,
  isSalientCapOrContractItem,
  sortNewsWithBreakingPriority,
  deduplicateAndGroupWireItems,
  balanceFeedTopSalience,
  promoteLinkDropTweetToArticle,
  stripRedundantAuthorBoilerplate,
  isRedundantProfileSelfLink,
  formatTweetBodyForDisplay,
  isStaleCompletedGameAvailabilityItem,
  filterOutCompletedGameAvailabilityItems,
  filterFreshVideosForCurrentSlate,
  scoreHighlightAndTeamVideoSalience,
  evaluateGameDayAboveBriefWindow,
  partitionBreakingNewsAboveBrief
} from '../engine/breakingClassifier.js';
import {
  formatWireSourceDisplayName,
  isPaywalledPublisher,
  sanitizeExternalUrl,
  MARKDOWN_HTTPS_INLINE_LINK_SOURCE,
  encodeMarkdownLinkUrl,
  decodeMarkdownLinkUrlParens,
  normalizeMarkdownInlineLinksInText
} from '../engine/linkIntegrity.js';
import {
  buildXBeatListSearchUrl,
  resolveItemAuthorProfileUrl,
  resolveOriginalTweetUrl
} from '../engine/beatAttributionEngine.js';
import {
  buildDeterministicDailyTopNewsBrief,
  hasPendingPostGameAiBriefAttempt,
  repairDailyTopNewsBriefLinks
} from '../services/aiWorkerClient.js';

export const NEWS_NAV_CLUSTERS = [
  {
    id: 'core_wire',
    ariaLabel: 'Primary News and Wire Formats',
    tabs: [
      { key: 'all', icon: 'layers', label: 'All', fullTitle: 'All News & Daily Brief' },
      { key: 'tweets', icon: 'tweet', label: 'Tweets', fullTitle: 'Live Beat & Insider Tweets' },
      { key: 'articles', icon: 'news', label: 'Articles', fullTitle: 'Beat Articles & Features' }
    ]
  },
  {
    id: 'media_topics',
    ariaLabel: 'Highlights, All-22 Film and Roster Topics',
    tabs: [
      { key: 'videos', icon: 'video', label: 'Highlights & Videos', fullTitle: 'Game Highlights, Recaps & Team Videos' },
      { key: 'film', icon: 'target', label: 'Film & Trench', fullTitle: "All-22 Tape, JT O'Sullivan QB School & Trench Study" },
      { key: 'roster', icon: 'trade', label: 'Trades & Roster', fullTitle: 'Trades, Roster Moves & Salary Cap' }
    ]
  }
];

export const VALID_NEWS_CATEGORIES = new Set(['all', 'tweets', 'articles', 'videos', 'film', 'roster']);

function decodeInlineEntities(str = '') {
  return String(str || '')
    .replace(/&#(\d+);/g, (_, dec) => {
      const code = Number(dec);
      return Number.isFinite(code) && code > 0 ? String.fromCodePoint(code) : _;
    })
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => {
      const code = parseInt(hex, 16);
      return Number.isFinite(code) && code > 0 ? String.fromCodePoint(code) : _;
    })
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&apos;/gi, "'");
}

/**
 * Resolves and sanitizes the source list for the Daily Top News Brief, ensuring direct
 * X/Bluesky permalinks for tweets, HTTPS-only URLs, zero paywalls, and zero stale pre-game noise.
 */
export function resolveDailyBriefSafeSources(dailyBrief, rawStream = [], appData = null) {
  const rawSources = Array.isArray(dailyBrief?.sources) ? dailyBrief.sources : [];
  const seen = new Set();
  const safeList = [];
  const rawByUrl = new Map();
  for (const it of Array.isArray(rawStream) ? rawStream : []) {
    if (it?.url) rawByUrl.set(String(it.url).trim(), it);
    if (it?.promotedFromSocialUrl) rawByUrl.set(String(it.promotedFromSocialUrl).trim(), it);
  }

  for (const sl of rawSources) {
    if (!sl) continue;
    const rawTitle = decodeInlineEntities(String(sl.title || ''));
    let isTw =
      sl.type === 'tweet' ||
      sl.type === 'social' ||
      /^@[A-Za-z0-9_]+:/.test(rawTitle) ||
      /^https?:\/\/(?:www\.)?(?:x|twitter|bsky)\./i.test(String(sl.url || ''));
    const handleMatch = rawTitle.match(/^(@[A-Za-z0-9_]+):\s*(.*)$/);
    const effectiveHandle = sl.authorHandle || (handleMatch ? handleMatch[1] : '');
    let cleanTitle = handleMatch ? handleMatch[2].trim() : rawTitle.trim();

    if (
      appData &&
      isStaleCompletedGameAvailabilityItem(
        {
          type: isTw ? 'tweet' : sl.type || 'article',
          title: cleanTitle,
          fullText: cleanTitle,
          url: sl.url || '',
          publishedAt: sl.publishedAt || null
        },
        appData
      )
    ) {
      continue;
    }

    const streamMatch = rawByUrl.get(String(sl.url || '').trim()) || null;
    let resolvedUrl = sl.url;

    // Upgrade link-drop social posts directly to their canonical article URL & Article label
    if (streamMatch && streamMatch.type === 'article' && streamMatch.promotedFromSocialUrl && streamMatch.url) {
      resolvedUrl = streamMatch.url;
      isTw = false;
      if (streamMatch.title) cleanTitle = streamMatch.title;
    } else if (isTw) {
      const promotedMatch = streamMatch ? promoteLinkDropTweetToArticle(streamMatch) : null;
      if (promotedMatch && promotedMatch.type === 'article' && promotedMatch.url) {
        resolvedUrl = promotedMatch.url;
        isTw = false;
        if (promotedMatch.title) cleanTitle = promotedMatch.title;
      } else {
        resolvedUrl = resolveOriginalTweetUrl(
          {
            type: 'tweet',
            url: sl.url || '',
            author: sl.author || sl.outlet || '',
            authorHandle: effectiveHandle,
            title: cleanTitle,
            fullText: cleanTitle,
            publishedAt: sl.publishedAt || dailyBrief?.generatedAt || ''
          },
          rawStream
        );
      }
    }

    const safeUrl = sanitizeExternalUrl(resolvedUrl, null);
    const dedupKey =
      safeUrl && safeUrl.includes('x.com/search?')
        ? `${safeUrl}::${cleanTitle.toLowerCase().slice(0, 50)}`
        : safeUrl;
    if (!safeUrl || seen.has(dedupKey) || isPaywalledPublisher(sl.outlet, safeUrl)) continue;
    seen.add(dedupKey);

    safeList.push({
      originalUrl: sl.url || safeUrl,
      title: cleanTitle || sl.outlet || 'Open Source',
      url: safeUrl,
      outlet: sl.outlet || '49ers Beat',
      author: sl.author || (effectiveHandle ? effectiveHandle : sl.outlet || '49ers Beat'),
      type: isTw ? 'tweet' : 'article',
      publishedAt: sl.publishedAt || null
    });
  }
  return safeList;
}

/**
 * Safely renders prose containing markdown inline source citations `[Label](https://...)`
 * into compact, distraction-free clickable link icon pills (`a.brief-inline-source-link`)
 * without rendering full reporter/outlet names inside the paragraph, while annotating plain prose
 * segments between links with football jargon popovers and clickable roster player links
 * (guaranteeing zero nested `<a>` tags!).
 */
export function renderBriefProseWithInlineLinksHtml(text = '', seenJargon = null, urlUpgradeMap = null) {
  const rawInput = normalizeMarkdownInlineLinksInText(String(text || '').trim());
  if (!rawInput) return '';

  const perParenRe = new RegExp(
    `,?\\s*\\b(?:per|via|according to)\\s+\\(\\s*(${MARKDOWN_HTTPS_INLINE_LINK_SOURCE})\\s*\\)`,
    'gi'
  );
  const perBareRe = new RegExp(
    `,?\\s*\\b(?:per|via|according to)\\s+(${MARKDOWN_HTTPS_INLINE_LINK_SOURCE})`,
    'gi'
  );
  const wrapParenRe = new RegExp(`\\(\\s*(${MARKDOWN_HTTPS_INLINE_LINK_SOURCE})\\s*\\)`, 'g');

  // Clean up any wrapping parentheses or "per / via / according to" prefixes around inline links
  const raw = rawInput
    .replace(perParenRe, ' $1')
    .replace(perBareRe, ' $1')
    .replace(wrapParenRe, '$1')
    .replace(/\s+([,.;:!?])/g, '$1');

  const opts = { maxTerms: 14, maxPlayers: 5, seenKeys: seenJargon };
  const linkRe = new RegExp(MARKDOWN_HTTPS_INLINE_LINK_SOURCE, 'g');

  let outHtml = '';
  let lastIdx = 0;
  let match;
  while ((match = linkRe.exec(raw)) !== null) {
    if (match.index > lastIdx) {
      outHtml += escJargon(raw.slice(lastIdx, match.index), opts);
    }
    const label = decodeInlineEntities(match[1]).trim();
    const rawHref = match[2];
    const mappedTarget =
      urlUpgradeMap?.get(rawHref) ||
      urlUpgradeMap?.get(decodeMarkdownLinkUrlParens(rawHref)) ||
      rawHref;
    const safeUrl = sanitizeExternalUrl(mappedTarget, null);
    if (safeUrl && !isPaywalledPublisher('', safeUrl)) {
      const cleanTip = label && !/^s\d+$/i.test(label) ? `Source: ${label}` : 'Open source';
      outHtml += `<a href="${esc(safeUrl)}" target="_blank" rel="noopener noreferrer" class="brief-inline-source-link" data-brief-inline-source title="${esc(cleanTip)}" aria-label="${esc(cleanTip)}">${iconSvg('link', 10)}</a>`;
    }
    lastIdx = match.index + match[0].length;
  }

  if (lastIdx < raw.length) {
    outHtml += escJargon(raw.slice(lastIdx), opts);
  }
  return outHtml;
}

const PLACEHOLDER_SUBTOPIC_PREFIX_RE =
  /^(?:[-•*]\s*|\d+[.)]\s*)?(?:\*\*|\[)?\s*(?:bold\s+subtopic|bold\s+heading|bold\s+title|subtopic(?:\s+title|\s+name)?|topic\s+title|section\s+title|bullet\s*\d+)\s*(?:\*\*|\])?\s*[:—–-]\s*/i;

function stripBulletPlaceholderPrefixes(str = '') {
  let out = String(str || '').replace(/^(?:[-•*]\s+|\d+[.)]\s+)/, '').trim();
  let guard = 0;
  while (guard < 4 && PLACEHOLDER_SUBTOPIC_PREFIX_RE.test(out)) {
    out = out.replace(PLACEHOLDER_SUBTOPIC_PREFIX_RE, '').trim();
    guard += 1;
  }
  return out;
}

function formatDailyBriefBulletHtml(bullet = '', seenJargon = null, urlUpgradeMap = null) {
  const raw = stripBulletPlaceholderPrefixes(bullet);
  if (!raw) return '';
  const colonIdx = raw.indexOf(':');
  // Avoid splitting inside a markdown URL `https://` by checking `[` before colon
  const bracketBeforeColon = colonIdx > 0 ? raw.slice(0, colonIdx).includes('[') : false;
  if (colonIdx > 0 && colonIdx <= 78 && !bracketBeforeColon) {
    const headClean = raw.slice(0, colonIdx).replace(/\*\*/g, '').trim();
    const bodyClean = stripBulletPlaceholderPrefixes(raw.slice(colonIdx + 1).replace(/^\*\*\s*/, '').trim());
    if (
      headClean &&
      !/^(?:bold\s+subtopic|subtopic|topic\s+title|section\s+title|bullet\s*\d+|topic)$/i.test(headClean)
    ) {
      return `<li><strong>${escJargon(headClean, { maxTerms: 6, maxPlayers: 2, seenKeys: seenJargon })}:</strong> ${renderBriefProseWithInlineLinksHtml(bodyClean, seenJargon, urlUpgradeMap)}</li>`;
    }
    return `<li>${renderBriefProseWithInlineLinksHtml(bodyClean, seenJargon, urlUpgradeMap)}</li>`;
  }
  return `<li>${renderBriefProseWithInlineLinksHtml(raw, seenJargon, urlUpgradeMap)}</li>`;
}

/**
 * Renders the 1/day Gemini 4 Hydrogen (XHIGH) Top-News Brief card (shared identically between
 * the top of `News & Film -> All` and the top of the `Home` screen).
 */
export function renderDailyTopNewsBriefHtml(
  dailyBrief,
  { rawStream = [], appData = null, asSubcard = false } = {}
) {
  const rawBrief =
    dailyBrief && typeof dailyBrief === 'object' && Array.isArray(dailyBrief.bullets) && dailyBrief.bullets.length > 0
      ? dailyBrief
      : buildDeterministicDailyTopNewsBrief(appData);
  const { brief } = repairDailyTopNewsBriefLinks(rawBrief);
  if (!brief) return '';

  const seenJargon = new Set();
  const safeSources = resolveDailyBriefSafeSources(brief, rawStream, appData);
  const urlUpgradeMap = new Map();
  for (const it of Array.isArray(rawStream) ? rawStream : []) {
    if (it?.promotedFromSocialUrl && it?.url && it.promotedFromSocialUrl !== it.url) {
      urlUpgradeMap.set(it.promotedFromSocialUrl, it.url);
      urlUpgradeMap.set(encodeMarkdownLinkUrl(it.promotedFromSocialUrl), it.url);
      urlUpgradeMap.set(decodeMarkdownLinkUrlParens(it.promotedFromSocialUrl), it.url);
    }
  }
  for (const s of safeSources) {
    if (s.originalUrl && s.url && s.originalUrl !== s.url) {
      urlUpgradeMap.set(s.originalUrl, s.url);
      urlUpgradeMap.set(encodeMarkdownLinkUrl(s.originalUrl), s.url);
      urlUpgradeMap.set(decodeMarkdownLinkUrlParens(s.originalUrl), s.url);
    }
  }
  const ageTiny = brief.generatedAt ? formatRelativeAge(brief.generatedAt) : 'now';
  const tagName = asSubcard ? 'div' : 'section';
  const outerCls = asSubcard
    ? 'subcard-panel daily-news-brief-card daily-news-brief-subcard'
    : 'card daily-news-brief-card';

  const rosterPlayers = appData?.roster?.players || [];
  const rawByLowerUrl = new Map();
  for (const it of Array.isArray(rawStream) ? rawStream : []) {
    if (it?.url) rawByLowerUrl.set(String(it.url).trim().toLowerCase(), it);
    if (it?.externalUrl) rawByLowerUrl.set(String(it.externalUrl).trim().toLowerCase(), it);
    if (it?.promotedFromSocialUrl) rawByLowerUrl.set(String(it.promotedFromSocialUrl).trim().toLowerCase(), it);
  }
  const briefHero = resolveDailyBriefHeroMedia(brief, rawStream, { rosterPlayers });
  const briefHeroHtml = briefHero
    ? renderSalientHeroBannerHtml(briefHero, {
        compact: asSubcard,
        creditLabel: briefHero.creditLabel ? `Photo · ${briefHero.creditLabel}` : '',
        eager: true,
        extraClass: 'daily-brief-hero'
      })
    : '';

  const sourcesDrawerHtml =
    safeSources.length > 0
      ? `
        <div class="daily-brief-footer">
          <details class="compact-details daily-brief-sources" data-daily-brief-sources>
            <summary class="compact-details-summary" style="justify-content:space-between">
              <span>Sources (${safeSources.length})</span>
              <span class="mono" style="font-size:10px;color:var(--text-muted)">All Sources ▾</span>
            </summary>
            <div style="display:flex;flex-direction:column;gap:6px;margin-top:7px">
              ${safeSources
                .map(rep => {
                  const typeLabel = rep.type === 'tweet' ? 'Tweet' : 'Article';
                  const badgeCls = rep.type === 'tweet' ? 'badge-gold' : 'badge-neutral';
                  const attribution =
                    rep.author && rep.outlet && rep.author.toLowerCase() !== rep.outlet.toLowerCase()
                      ? `${rep.author} • ${rep.outlet}`
                      : rep.outlet || rep.author || 'Source';
                  const matchedItem =
                    rawByLowerUrl.get(String(rep.originalUrl || '').trim().toLowerCase()) ||
                    rawByLowerUrl.get(String(rep.url || '').trim().toLowerCase()) ||
                    {
                      title: rep.title,
                      url: rep.url,
                      author: rep.author,
                      outletName: rep.outlet,
                      type: rep.type
                    };
                  const srcVisual = resolveSalientCardVisual(matchedItem, {
                    rosterPlayers,
                    slot: 'thumb',
                    allowTeamFallback: false
                  });
                  const srcThumbHtml = srcVisual
                    ? renderSalientThumbHtml(srcVisual, { size: 'sm', asStatic: true, extraClass: 'brief-source-thumb' })
                    : '';
                  return `
                    <a href="${esc(rep.url)}" target="_blank" rel="noopener noreferrer" class="synthesis-source-sheet-row ${srcThumbHtml ? 'has-source-thumb' : ''}" data-brief-source-row>
                      <div style="min-width:0;flex:1">
                        <div style="display:flex;justify-content:space-between;align-items:center;gap:6px;flex-wrap:wrap;margin-bottom:3px">
                          <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;min-width:0">
                            <span class="badge ${badgeCls}" style="font-size:9.8px;padding:1.5px 6px">${esc(typeLabel)}</span>
                            <strong style="font-size:11.6px;color:var(--gold-bright)">${esc(attribution)}</strong>
                          </div>
                          ${rep.publishedAt ? `<span class="mono" style="font-size:10.5px;color:var(--text-muted)">${esc(formatRelativeAge(rep.publishedAt))}</span>` : ''}
                        </div>
                        <div style="font-size:12.4px;font-weight:600;line-height:1.36;color:var(--text-primary)">
                          ${esc(rep.title)} ${iconSvg('externalLink', 11)}
                        </div>
                      </div>
                      ${srcThumbHtml}
                    </a>
                  `;
                })
                .join('')}
            </div>
          </details>
          ${
            !asSubcard
              ? `<button type="button" class="btn-ghost btn-compact daily-brief-ask-btn" data-action="analyze-topic-jump" data-prompt="${esc(brief.headline || '49ers Top News Deep Dive')}">
                   ${iconSvg('sparkles', 12)}
                   <span>Ask AI</span>
                 </button>`
              : ''
          }
        </div>
      `
      : '';

  return `
    <${tagName} class="${outerCls}" data-daily-news-brief="${esc(brief.id || 'daily')}">
      <div class="daily-brief-head">
        <div style="min-width:0;flex:1">
          <div class="card-eyebrow">Top News Brief</div>
          <h3 class="card-title daily-brief-headline">${escJargon(brief.headline || '49ers Daily Briefing', { maxTerms: 6, maxPlayers: 3, seenKeys: seenJargon })}</h3>
        </div>
        <span class="mono daily-brief-age" data-daily-brief-age title="Generated ${esc(brief.generatedAt || '')}">${esc(ageTiny)}</span>
      </div>
      ${briefHeroHtml}
      <ul class="brief-bullets coaching-bullets daily-brief-bullets">
        ${(brief.bullets || []).map(b => formatDailyBriefBulletHtml(b, seenJargon, urlUpgradeMap)).join('')}
      </ul>
      ${sourcesDrawerHtml}
    </${tagName}>
  `;
}

export function renderWireSignalBadgeHtml(item, isVideo, isTweet) {
  const badge = item?.breakingBadge || '';
  if (badge && isUrgentBreakingBadge(badge)) {
    const urgentCls = item.isInGameInjury ? 'badge-danger live-breaking-pill' : 'badge-scarlet live-breaking-pill';
    return `<span class="badge ${urgentCls}">${iconSvg('bolt', 11)}<span>${esc(badge)}</span></span>`;
  }
  if (badge === 'FILM & TRENCH' || item?.category === 'film') {
    return `<span class="badge badge-positive">${iconSvg(isVideo ? 'video' : 'target', 11)}<span>${isVideo ? 'All-22 Film' : 'Film & Trench'}</span></span>`;
  }
  if (badge === 'ROSTER MOVE' || badge === 'TRADE INTEL') {
    return `<span class="badge badge-gold"><span>${esc(badge)}</span></span>`;
  }
  if (!isVideo && isSalientCapOrContractItem(item)) {
    return `<span class="badge badge-gold"><span>CAP &amp; CONTRACT</span></span>`;
  }
  if (badge === 'INJURY SCOOP' || badge === 'INJURY UPDATE') {
    return `<span class="badge badge-neutral"><span>${esc(badge)}</span></span>`;
  }
  if (isVideo || Boolean(item?.videoStreamUrl)) {
    const title = String(item?.title || item?.fullText || '');
    const isInterviewClip = /\b(press conference|reflects on|chats about|previews week|shares final updates|speak ahead|talk new additions|on first career touchdown|you['’]?ve got mail|inside the oval)\b/i.test(
      title
    );
    const hasPlayerFocus =
      (item?.mentionedPlayers?.length || 0) > 0 ||
      /\b(best plays|every completed pass|every throw|pick[- ]?6|interceptions?)\b/i.test(title);
    if (
      !isInterviewClip &&
      hasPlayerFocus &&
      /\b(highlights|best plays|every completed pass|every throw|every catch|rushing|pick[- ]?6|interceptions?|touchdowns?|\btd\b|end zone|big catch|sacks?)\b/i.test(
        title
      )
    ) {
      return `<span class="badge badge-scarlet">${iconSvg('video', 11)}<span>Player Highlights</span></span>`;
    }
    if (!isInterviewClip && /\b(highlights|best plays|top plays|every touchdown|condensed game|outlast|thriller)\b/i.test(title)) {
      return `<span class="badge badge-scarlet">${iconSvg('video', 11)}<span>Highlights</span></span>`;
    }
    if (/\b(forty niner way|49hours|mic['’]?d up|locker room|from the trenches|recap)\b/i.test(title)) {
      return `<span class="badge badge-gold">${iconSvg('video', 11)}<span>Team Video</span></span>`;
    }
    return `<span class="badge badge-scarlet">${iconSvg('video', 11)}<span>Video</span></span>`;
  }
  if (!isTweet) {
    const artLabel =
      item?.wireSource === 'espn_player_wire' || String(item?.id || '').startsWith('espn_pwire_')
        ? 'Injury Wire'
        : 'Article';
    return `<span class="badge badge-neutral">${iconSvg('news', 11)}<span>${artLabel}</span></span>`;
  }
  return '';
}

export function renderWireItemCardHtml(
  item,
  {
    prioritizedRaw = [],
    activeVideosSet = new Set(),
    rosterPlayers = [],
    isLeadFeatured = false,
    eagerImage = false
  } = {}
) {
  const safeStreamCandidate =
    item.videoStreamUrl && /^https:\/\//i.test(String(item.videoStreamUrl).trim())
      ? String(item.videoStreamUrl).trim()
      : '';
  const isTweet = item.type === 'tweet' || item.type === 'social';
  const isVideo = item.type === 'video';
  const isUrgent = isUrgentBreakingBadge(item.breakingBadge);

  const rawAuthorName = item.author || item.reporterName || item.outletName || '49ers Beat';
  const authorName = formatWireSourceDisplayName(rawAuthorName, item);
  const resolvedItemUrl = isTweet
    ? sanitizeExternalUrl(resolveOriginalTweetUrl(item, prioritizedRaw), null)
    : sanitizeExternalUrl(item.url, null);
  const externalVideoCardUrl =
    !item.videoId &&
    !safeStreamCandidate &&
    (isVideo || Boolean(item.isHighlightClip && item.externalVideoUrl)) &&
    (item.externalVideoUrl || resolvedItemUrl)
      ? sanitizeExternalUrl(item.externalVideoUrl || resolvedItemUrl, null)
      : '';
  const effectiveStreamOrCardUrl = safeStreamCandidate || externalVideoCardUrl;
  const effectiveEmbeddable = safeStreamCandidate || item.videoId ? item.embeddable !== false : false;
  const hasPlayableVideo = Boolean(item.videoId || effectiveStreamOrCardUrl);
  const vidKey = hasPlayableVideo ? `raw_${item.id}` : null;
  const isVidOpen = vidKey && activeVideosSet.has(vidKey);
  const authorHref = sanitizeExternalUrl(
    resolveItemAuthorProfileUrl(item, resolvedItemUrl),
    resolvedItemUrl
  );
  const rawBody = isTweet
    ? stripRedundantAuthorBoilerplate(item.fullText || item.title || '', rawAuthorName)
    : item.title || '';
  const displayTitle = isTweet
    ? formatTweetBodyForDisplay(rawBody, SHORT_TWEET_FULL_TEXT_LIMIT).text
    : rawBody;

  const cleanSummary =
    !isVideo &&
    !isTweet &&
    item.summary &&
    !item.summary.startsWith('Published via ') &&
    item.summary.toLowerCase() !== `${rawAuthorName} • ${item.outletName || ''}`.toLowerCase()
      ? stripRedundantAuthorBoilerplate(item.summary, rawAuthorName)
      : '';

  const safeExtUrl = sanitizeExternalUrl(item.externalUrl, null);
  const thumbTargetHref = resolvedItemUrl || safeExtUrl || '';
  const wantsLeadHeroSlot = Boolean((isLeadFeatured || isUrgent) && !isVideo && !hasPlayableVideo);
  const salientVisual =
    !isVideo && !hasPlayableVideo
      ? resolveSalientCardVisual(item, {
          rosterPlayers,
          slot: wantsLeadHeroSlot ? 'hero' : 'thumb',
          allowTeamFallback: true
        })
      : null;
  const showLeadHero = Boolean(wantsLeadHeroSlot && salientVisual?.kind === 'editorial');
  const sideThumbHtml =
    !showLeadHero && salientVisual
      ? renderSalientThumbHtml(salientVisual, {
          href: thumbTargetHref,
          size: 'lg',
          eager: eagerImage
        })
      : '';
  const leadHeroHtml = showLeadHero
    ? renderSalientHeroBannerHtml(salientVisual, {
        href: thumbTargetHref,
        compact: false,
        eager: eagerImage || isLeadFeatured,
        extraClass: 'wire-hero-media'
      })
    : '';
  const hasThumb = Boolean(sideThumbHtml);
  const normCmpUrl = u => String(u || '').replace(/\/+$/, '').toLowerCase();
  const showLinkedStory =
    Boolean(safeExtUrl) &&
    normCmpUrl(safeExtUrl) !== normCmpUrl(resolvedItemUrl) &&
    !isRedundantProfileSelfLink(safeExtUrl, resolvedItemUrl) &&
    !isRedundantProfileSelfLink(safeExtUrl, item.url) &&
    !/\bon X$/i.test(String(item.externalTitle || ''));
  const confirmingList = (Array.isArray(item.confirmingReports) ? item.confirmingReports : []).filter(cr => {
    const crIsTw = cr?.type === 'tweet' || cr?.type === 'social';
    const crHref = crIsTw
      ? sanitizeExternalUrl(resolveOriginalTweetUrl(cr, prioritizedRaw), '')
      : sanitizeExternalUrl(cr?.url, '');
    if (showLinkedStory && crHref && normCmpUrl(crHref) === normCmpUrl(safeExtUrl)) return false;
    if (resolvedItemUrl && crHref && normCmpUrl(crHref) === normCmpUrl(resolvedItemUrl)) return false;
    return true;
  });
  const relatedSourcesPreview =
    confirmingList.length > 0
      ? Array.from(
          new Set(
            confirmingList
              .map(cr => cr.outletName || cr.author || cr.reporterName || '')
              .filter(s => s && s.toLowerCase() !== authorName.toLowerCase())
          )
        )
          .slice(0, 2)
          .join(', ')
      : '';

  return `
    <div class="brief-card ${isUrgent ? 'breaking-elevated' : ''} ${showLeadHero ? 'has-lead-hero' : ''}" data-raw-type="${esc(item.type || 'article')}" data-raw-category="${esc(item.category || 'beat')}">
      ${leadHeroHtml}
      <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap">
        <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;min-width:0">
          ${renderWireSignalBadgeHtml(item, isVideo, isTweet)}
          ${
            authorHref
              ? `<a href="${esc(authorHref)}" target="_blank" rel="noopener noreferrer" class="wire-author-single-link" data-wire-author-link><strong>${esc(authorName)}</strong></a>`
              : `<strong style="font-size:12.5px;color:var(--gold-bright)">${esc(authorName)}</strong>`
          }
        </div>
        <span class="mono" style="font-size:11.5px;color:var(--text-muted);flex-shrink:0" data-wire-age>${hasPlayableVideo && item.duration ? `${esc(item.duration)} • ` : ''}${esc(formatRelativeAge(item.publishedAt))}</span>
      </div>
      <div class="${hasThumb ? 'media-split-row' : ''}">
        <div style="min-width:0;display:flex;flex-direction:column;gap:4px">
          <div style="font-weight:${isTweet ? '600' : '700'};font-size:${showLeadHero ? '14.5px' : '13.6px'};line-height:1.4">
            ${
              resolvedItemUrl
                ? `<a href="${esc(resolvedItemUrl)}" target="_blank" rel="noopener noreferrer" class="ext-link" style="${isTweet ? 'display:inline;color:var(--text-primary)' : ''}">${esc(displayTitle)} ${iconSvg('externalLink', 12)}</a>`
                : esc(displayTitle)
            }
          </div>
          ${cleanSummary ? `<div style="font-size:12.5px;color:var(--text-secondary)">${escJargon(cleanSummary)}</div>` : ''}
          ${
            confirmingList.length > 0
              ? `<details class="compact-details confirming-reports-toggle" data-confirming-reports>
                   <summary class="compact-details-summary" style="justify-content:space-between">
                     <span>+${confirmingList.length} confirming report${confirmingList.length === 1 ? '' : 's'}${relatedSourcesPreview ? ` · ${esc(relatedSourcesPreview)}` : ''}</span>
                     <span class="mono" style="font-size:10px;color:var(--text-muted)">Coverage ▾</span>
                   </summary>
                   <div style="display:flex;flex-direction:column;gap:5px;margin-top:6px">
                     ${confirmingList
                       .slice(0, 6)
                       .map(cr => {
                         const crAuthor = cr.author || cr.reporterName || cr.outletName || 'Beat';
                         const crBody = stripRedundantAuthorBoilerplate(cr.fullText || cr.title || '', crAuthor);
                         const crIsTw = cr.type === 'tweet' || cr.type === 'social';
                         const crIsVid = cr.type === 'video' || Boolean(cr.videoId);
                         const crTypeTag = crIsVid ? 'Video' : crIsTw ? 'Tweet' : 'Article';
                         const crHref = crIsTw
                           ? sanitizeExternalUrl(resolveOriginalTweetUrl(cr, prioritizedRaw), '#')
                           : sanitizeExternalUrl(cr.url, '#');
                         const crAuthorHref = sanitizeExternalUrl(
                           resolveItemAuthorProfileUrl(cr, crHref),
                           crHref
                         );
                         return `<div class="related-coverage-row">
                           <span class="badge badge-neutral" style="font-size:9.5px;padding:1px 5px">${esc(crTypeTag)}</span>
                           ${
                             crAuthorHref
                               ? `<a href="${esc(crAuthorHref)}" target="_blank" rel="noopener noreferrer" class="ext-link"><strong>${esc(crAuthor)}</strong></a>`
                               : `<strong>${esc(crAuthor)}</strong>`
                           } <span class="mono" style="color:var(--text-muted)">• ${esc(formatRelativeAge(cr.publishedAt))}</span>:
                           <a href="${esc(crHref)}" target="_blank" rel="noopener noreferrer" class="ext-link" style="color:var(--text-secondary)">${esc(crBody.slice(0, 140))}${crBody.length > 140 ? '…' : ''}</a>
                         </div>`;
                       })
                       .join('')}
                   </div>
                 </details>`
              : ''
          }
        </div>
        ${sideThumbHtml}
      </div>
      ${
        showLinkedStory
          ? `<div>
              <a href="${esc(safeExtUrl)}" target="_blank" rel="noopener noreferrer" class="source-chip-link">
                <span>Article: ${esc((item.externalTitle || item.outletName || 'Open Story').slice(0, 56))}</span>
                ${iconSvg('externalLink', 11)}
              </a>
            </div>`
          : ''
      }
      ${item.mentionedPlayers?.length ? renderPlayerChipsStripHtml(item.mentionedPlayers, 4) : ''}
      ${
        hasPlayableVideo
          ? renderVideoEmbedOrFacade(
              vidKey,
              item.videoId || '',
              0,
              item.title || `Watch Clip (${item.duration || 'Video'})`,
              item.outletName,
              isVidOpen,
              effectiveEmbeddable,
              {
                compactFooter: true,
                videoStreamUrl: effectiveStreamOrCardUrl || '',
                posterUrl: item.imageUrl || '',
                externalWatchUrl:
                  sanitizeExternalUrl(item.externalVideoUrl, null) ||
                  resolvedItemUrl ||
                  sanitizeExternalUrl(item.url, '') ||
                  ''
              }
            )
          : ''
      }
    </div>
  `;
}

export function renderNewsViewHtml({
  appData = null,
  newsCategoryFilter = 'all', // 'all' | 'tweets' | 'articles' | 'videos' | 'film' | 'roster'
  filteredRawItems,
  activeVideosSet = new Set(),
  userPrefs,
  lastWireSyncAt = null,
  isSyncingWire = false,
  nowMs = Date.now()
}) {
  registerRosterPlayersForInlineLinks(appData?.roster?.players);
  const activeFilter = ['all', 'tweets', 'articles', 'videos', 'film', 'roster'].includes(newsCategoryFilter)
    ? newsCategoryFilter
    : 'all';
  const mutedCount =
    (userPrefs?.disabledReporterIds?.length || 0) + (userPrefs?.disabledOutlets?.length || 0);

  const rawAfterAvailabilityHide = filterFreshVideosForCurrentSlate(
    filterOutCompletedGameAvailabilityItems(filteredRawItems || [], appData, nowMs),
    appData,
    nowMs
  );
  const prioritizedRaw = sortNewsWithBreakingPriority(
    rawAfterAvailabilityHide.filter(i => {
      if (i.type === 'video' && (i.videoId || i.videoStreamUrl)) return true;
      return Boolean(sanitizeExternalUrl(i.url, null)) && !isPaywalledPublisher(i.outletName, i.url);
    }),
    nowMs,
    { appData }
  );

  const dedupedRaw = balanceFeedTopSalience(
    deduplicateAndGroupWireItems(prioritizedRaw, { nowMs, appData }),
    {
      nowMs,
      appData
    }
  );
  const dedupedTweets = deduplicateAndGroupWireItems(
    prioritizedRaw.filter(i => i.type === 'tweet' || i.type === 'social'),
    { nowMs, preserveFormat: 'tweets', appData }
  );
  const dedupedArticles = deduplicateAndGroupWireItems(
    prioritizedRaw.filter(i => i.type === 'article' || i.type === 'post'),
    { nowMs, preserveFormat: 'articles', appData }
  );
  // Highlights & Videos: strictly non-film videos + native X/ESPN/49ers.com highlight clips (0% overlap with Film & Trench), ranked by Highlight & Team-Video salience!
  const dedupedHighlightsAndVideos = deduplicateAndGroupWireItems(
    prioritizedRaw.filter(
      i =>
        (i.type === 'video' || Boolean(i.isHighlightClip && (i.videoStreamUrl || i.externalVideoUrl))) &&
        i.category !== 'film'
    ),
    { nowMs, preserveFormat: 'videos', appData }
  ).sort(
    (a, b) =>
      scoreHighlightAndTeamVideoSalience(b, appData, nowMs) -
      scoreHighlightAndTeamVideoSalience(a, appData, nowMs)
  );
  // Film & Trench: All-22 film videos (incl. JT O'Sullivan's The QB School & Jonnydel) + written film/trench breakdowns
  const dedupedFilmVideos = deduplicateAndGroupWireItems(
    prioritizedRaw.filter(i => i.category === 'film' && i.type === 'video'),
    { nowMs, preserveFormat: 'videos', appData }
  );
  const dedupedFilmArticlesAndTweets = deduplicateAndGroupWireItems(
    prioritizedRaw.filter(i => i.category === 'film' && i.type !== 'video'),
    { nowMs, appData }
  );
  const dedupedFilmAndTrench = sortNewsWithBreakingPriority(
    [...dedupedFilmVideos, ...dedupedFilmArticlesAndTweets],
    nowMs,
    { appData }
  );
  // Trades & Roster: Trades, official roster moves, AND salient salary cap / contract news (excluding videos to avoid redundancy)
  const dedupedTradesAndRoster = deduplicateAndGroupWireItems(
    prioritizedRaw.filter(
      i => i.type !== 'video' && (i.category === 'roster' || i.category === 'cap' || isSalientCapOrContractItem(i))
    ),
    { nowMs, appData }
  );

  const syncAge = lastWireSyncAt ? formatRelativeAge(lastWireSyncAt) : 'now';

  const topToolbar = `
    <div class="card subnav-card news-toolbar-card" role="navigation" aria-label="News and Film Categories">
      <div class="news-toolbar-head">
        <div class="news-toolbar-title-row">
          <div class="news-toolbar-brand">
            <div class="card-icon-badge compact" aria-hidden="true">${iconSvg('news', 15)}</div>
            <h2 class="card-title">News &amp; Film</h2>
          </div>
          <div class="news-toolbar-actions">
            <button type="button" class="btn-ghost btn-compact" data-action="sync-live-wire-now" ${isSyncingWire ? 'disabled' : ''} title="Check live beat tweets and injury wire immediately">
              ${iconSvg('bolt', 12)}
              <span>${isSyncingWire ? 'Sync…' : esc(syncAge)}</span>
            </button>
            <button type="button" class="btn-ghost btn-compact" data-action="open-settings" title="Filter Beat Sources &amp; Reporters">
              ${iconSvg('settings', 13)}
              <span>Sources${mutedCount > 0 ? ` (${mutedCount})` : ''}</span>
            </button>
          </div>
        </div>
      </div>

      <div class="news-subnav-bars">
        ${NEWS_NAV_CLUSTERS.map(
          cluster => `
          <div class="segmented-control season-cluster-bar news-cluster-bar" data-news-cluster="${esc(cluster.id)}" role="tablist" aria-label="${esc(cluster.ariaLabel)}">
            ${cluster.tabs
              .map(t => {
                const isSelected = activeFilter === t.key;
                return `
                  <button type="button" role="tab" aria-selected="${isSelected ? 'true' : 'false'}"
                          title="${esc(t.fullTitle)}"
                          class="pill-btn seg-btn season-tab-btn news-tab-btn ${isSelected ? 'active' : ''}"
                          data-action="set-news-category" data-category="${esc(t.key)}">
                    ${iconSvg(t.icon, 12)}
                    <span>${esc(t.label)}</span>
                  </button>
                `;
              })
              .join('')}
          </div>
        `
        ).join('')}
      </div>

      <details class="compact-details">
        <summary class="compact-details-summary">
          <span>Direct X Beat Lists</span>
        </summary>
        <div class="x-beat-launch-strip" aria-label="Live X Beat Search" style="margin-top:6px">
          <a href="${esc(buildXBeatListSearchUrl('trusted', { reporters: appData?.reporters?.reporters, userPrefs }))}" target="_blank" rel="noopener noreferrer" class="source-chip-link x-beat-chip" title="All enabled Tier 1–3 49ers Beat Reporters, Columnists &amp; Official Team handles from Settings">
            <span>Trusted Beat</span>${iconSvg('externalLink', 10)}
          </a>
          <a href="${esc(buildXBeatListSearchUrl('film', { reporters: appData?.reporters?.reporters, userPrefs }))}" target="_blank" rel="noopener noreferrer" class="source-chip-link x-beat-chip" title="All enabled Tier 1–3 49ers Film, Analytics &amp; Podcast Analysts from Settings">
            <span>Film &amp; Analysts</span>${iconSvg('externalLink', 10)}
          </a>
          <a href="${esc(buildXBeatListSearchUrl('injuries', { reporters: appData?.reporters?.reporters, userPrefs }))}" target="_blank" rel="noopener noreferrer" class="source-chip-link x-beat-chip" title="Live 49ers sideline, practice &amp; warmup injury updates across Tier 1–3 beat voices">
            <span>Injury Scoops</span>${iconSvg('externalLink', 10)}
          </a>
          <a href="${esc(buildXBeatListSearchUrl('insiders', { reporters: appData?.reporters?.reporters, userPrefs }))}" target="_blank" rel="noopener noreferrer" class="source-chip-link x-beat-chip" title="All enabled Tier 1–3 National NFL Insiders, Draft Evaluators &amp; League Analysts scoped to 49ers">
            <span>NFL Insiders</span>${iconSvg('externalLink', 10)}
          </a>
        </div>
      </details>
    </div>
  `;

  if (activeFilter === 'all') {
    const dailyBrief =
      appData?.news?.dailyTopNewsBrief || buildDeterministicDailyTopNewsBrief(appData, nowMs);
    const requireAiPostGameBrief = hasPendingPostGameAiBriefAttempt(appData, userPrefs, nowMs);
    const gdWindow = evaluateGameDayAboveBriefWindow(appData, dailyBrief, nowMs, {
      requireAiSource: requireAiPostGameBrief
    });
    const {
      breakingAboveBrief,
      remainingBelowBrief,
      gameDayLiveMode,
      gameDayPhaseLabel
    } = partitionBreakingNewsAboveBrief(dedupedRaw, dailyBrief, nowMs, {
      appData,
      promoteAllGameDayNews: true,
      requireAiPostGameBrief
    });

    const gameDayBannerHtml =
      gdWindow.active || gameDayLiveMode
        ? `
          <div class="gameday-above-brief-banner" data-gameday-above-brief-banner>
            <span class="gameday-live-label">
              <span class="gameday-live-dot" aria-hidden="true"></span>
              <span>${esc(gameDayPhaseLabel || gdWindow.phaseLabel || 'Game-Day Live Wire')}</span>
            </span>
            <span class="gameday-live-note mono">New updates above brief until postgame summary</span>
          </div>
        `
        : '';

    const rosterPlayers = appData?.roster?.players || [];
    const breakingTopHtml =
      breakingAboveBrief.length > 0
        ? `
          <div class="card breaking-above-brief-card${gameDayLiveMode ? ' gameday-live-above-card' : ''}" data-breaking-above-brief${gameDayLiveMode ? ' data-gameday-live-above-brief="true"' : ''} style="display:flex;flex-direction:column;gap:9px">
            ${gameDayBannerHtml}
            ${breakingAboveBrief
              .slice(0, 45)
              .map((item, idx) =>
                renderWireItemCardHtml(item, {
                  prioritizedRaw,
                  activeVideosSet,
                  rosterPlayers,
                  isLeadFeatured: idx === 0,
                  eagerImage: idx < 2
                })
              )
              .join('')}
          </div>
        `
        : gameDayBannerHtml
          ? `<div class="card breaking-above-brief-card gameday-live-above-card" data-gameday-live-above-brief="true" style="padding:8px 11px">${gameDayBannerHtml}</div>`
          : '';

    const briefHtml = renderDailyTopNewsBriefHtml(dailyBrief, {
      rawStream: prioritizedRaw,
      appData,
      asSubcard: false
    });

    const belowListHtml =
      remainingBelowBrief.length === 0
        ? `<div class="card">No additional feed items match your active source filters.</div>`
        : `
          <div class="card" style="display:flex;flex-direction:column;gap:9px">
            ${remainingBelowBrief
              .slice(0, 65)
              .map((item, idx) =>
                renderWireItemCardHtml(item, {
                  prioritizedRaw,
                  activeVideosSet,
                  rosterPlayers,
                  isLeadFeatured: false,
                  eagerImage: idx < 2
                })
              )
              .join('')}
          </div>
        `;

    return `${topToolbar}${breakingTopHtml}${briefHtml}${belowListHtml}`;
  }

  const rosterPlayers = appData?.roster?.players || [];
  const visibleFiltered =
    activeFilter === 'tweets'
      ? balanceFeedTopSalience(dedupedTweets, { nowMs, appData })
      : activeFilter === 'articles'
        ? balanceFeedTopSalience(dedupedArticles, { nowMs, appData })
        : activeFilter === 'videos'
          ? dedupedHighlightsAndVideos
          : activeFilter === 'film'
            ? dedupedFilmAndTrench
            : dedupedTradesAndRoster;

  const filteredListHtml =
    visibleFiltered.length === 0
      ? `<div class="card">No feed items match your active filters.</div>`
      : `
        <div class="card" style="display:flex;flex-direction:column;gap:9px">
          ${visibleFiltered
            .slice(0, 65)
            .map((item, idx) =>
              renderWireItemCardHtml(item, {
                prioritizedRaw,
                activeVideosSet,
                rosterPlayers,
                isLeadFeatured: idx === 0 && activeFilter !== 'videos',
                eagerImage: idx < 2
              })
            )
            .join('')}
        </div>
      `;

  return `${topToolbar}${filteredListHtml}`;
}

export function renderVideoEmbedOrFacade(
  vidKey,
  videoId,
  startSec = 0,
  label = 'Watch Video',
  channel = 'YouTube',
  isPlaying = false,
  embeddable = true,
  { compactFooter = false, videoStreamUrl = '', posterUrl = '', externalWatchUrl = '' } = {}
) {
  const safeStreamUrl =
    videoStreamUrl && /^https:\/\//i.test(String(videoStreamUrl)) ? String(videoStreamUrl).trim() : '';

  if (!videoId && safeStreamUrl) {
    const rawPoster = posterUrl && /^https:\/\//i.test(String(posterUrl)) ? String(posterUrl).trim() : '';
    const optPoster = rawPoster ? optimizeImageUrlForSlot(rawPoster, 'hero') : { src: '', fallbackSrc: '' };
    const safePoster = optPoster.src || rawPoster;
    const posterFallbackAttr = optPoster.fallbackSrc ? `data-fallback-src="${esc(optPoster.fallbackSrc)}"` : '';
    const safeOutUrl = sanitizeExternalUrl(externalWatchUrl, safeStreamUrl) || safeStreamUrl;
    const providerLabel = /x\.com|twimg\.com/i.test(`${safeOutUrl} ${safeStreamUrl}`)
      ? 'X'
      : /49ers\.com/i.test(`${safeOutUrl} ${safeStreamUrl}`)
        ? '49ers.com'
        : /bsky\.app|bsky\.network/i.test(`${safeOutUrl} ${safeStreamUrl}`)
          ? 'Bluesky'
          : /espn/i.test(`${safeOutUrl} ${channel}`)
            ? 'ESPN'
            : channel || 'Source';

    if (embeddable === false) {
      return `
        <div class="video-embed-box">
          <a href="${esc(safeOutUrl)}" target="_blank" rel="noopener noreferrer" class="video-external-card" aria-label="Watch ${esc(label)} on ${esc(providerLabel)}">
            <div class="video-thumb-stage">
              ${
                safePoster
                  ? `<img src="${esc(safePoster)}" ${posterFallbackAttr} alt="${esc(label)}" class="video-thumb-img" loading="lazy" decoding="async" />`
                  : `<div class="video-thumb-img" style="background:linear-gradient(135deg,#1A080C,#261419);min-height:165px"></div>`
              }
              <div class="video-thumb-overlay">
                <span class="video-play-pill">${iconSvg('externalLink', 13)}<span>Watch on ${esc(providerLabel)}</span></span>
              </div>
            </div>
          </a>
        </div>
      `;
    }

    if (isPlaying) {
      return `
        <div class="video-embed-box">
          <div class="video-iframe-wrap">
            <video src="${esc(safeStreamUrl)}" ${safePoster ? `poster="${esc(safePoster)}"` : ''} data-vid-key="${esc(vidKey)}" data-watch-url="${esc(safeOutUrl)}" data-provider="${esc(providerLabel)}" controls autoplay playsinline preload="auto"></video>
          </div>
          <div class="video-launch-bar">
            <span class="inline-icon-meta" style="min-width:0" data-vid-status-label="${esc(vidKey)}">${iconSvg('video', 14)}<span>Playing Inline</span></span>
            <a href="${esc(safeOutUrl)}" target="_blank" rel="noopener noreferrer" class="ext-link" style="flex-shrink:0">Open on ${esc(providerLabel)} ${iconSvg('externalLink', 12)}</a>
          </div>
        </div>
      `;
    }

    return `
      <div class="video-embed-box">
        <div class="video-thumb-stage" style="cursor:pointer" data-action="play-inline-video" data-vid-key="${esc(vidKey)}">
          ${
            safePoster
              ? `<img src="${esc(safePoster)}" ${posterFallbackAttr} alt="${esc(label)}" class="video-thumb-img" loading="lazy" decoding="async" />`
              : `<div class="video-thumb-img" style="background:linear-gradient(135deg,#1A080C,#261419);min-height:165px"></div>`
          }
          <div class="video-thumb-overlay">
            <button type="button" class="video-play-pill" data-action="play-inline-video" data-vid-key="${esc(vidKey)}">
              ${iconSvg('play', 14)}
              <span>Play Clip Inline</span>
            </button>
          </div>
        </div>
        <div class="video-launch-bar" style="justify-content:flex-end">
          <a href="${esc(safeOutUrl)}" target="_blank" rel="noopener noreferrer" class="ext-link" style="flex-shrink:0">Open on ${esc(providerLabel)} ${iconSvg('externalLink', 12)}</a>
        </div>
      </div>
    `;
  }

  if (!videoId) return '';

  const safeId = encodeURIComponent(videoId);
  const startNum = Number(startSec || 0);
  const watchUrl = `https://www.youtube.com/watch?v=${safeId}${startNum > 0 ? `&t=${startNum}s` : ''}`;
  const thumbUrl = `https://i.ytimg.com/vi/${safeId}/hqdefault.jpg`;

  // Official NFL / San Francisco 49ers videos block 3rd-party domain iframes (emb_err_woyt).
  // Render a crisp HD thumbnail preview card that opens cleanly on YouTube instead of a broken iframe!
  if (embeddable === false) {
    return `
      <div class="video-embed-box">
        <a href="${esc(watchUrl)}" target="_blank" rel="noopener noreferrer" class="video-external-card" aria-label="Watch ${esc(label)} on YouTube">
          <div class="video-thumb-stage">
            <img src="${esc(thumbUrl)}" alt="${esc(label)}" class="video-thumb-img" loading="lazy" decoding="async" />
            <div class="video-thumb-overlay">
              <span class="video-play-pill">
                ${iconSvg('play', 14)}
                <span>Watch on YouTube</span>
                ${iconSvg('externalLink', 12)}
              </span>
            </div>
          </div>
          ${
            compactFooter
              ? ''
              : `<div class="video-launch-bar">
                  <div style="min-width:0">
                    <div style="font-weight:700;font-size:12.5px;color:#E5CF96;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(label)}</div>
                    <div style="font-size:11px;color:#A3AFBF">${esc(channel || 'YouTube')} • Opens directly on YouTube</div>
                  </div>
                  <span class="source-chip-link"><span>YouTube</span>${iconSvg('externalLink', 11)}</span>
                </div>`
          }
        </a>
      </div>
    `;
  }

  if (isPlaying) {
    const src = `https://www.youtube.com/embed/${safeId}?start=${startNum}&autoplay=1&rel=0&playsinline=1`;
    return `
      <div class="video-embed-box">
        <div class="video-iframe-wrap">
          <iframe src="${src}" title="${esc(label)}" referrerpolicy="strict-origin-when-cross-origin" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" allowfullscreen></iframe>
        </div>
        <div class="video-launch-bar">
          ${
            compactFooter
              ? `<span class="inline-icon-meta" style="min-width:0">${iconSvg('video', 14)}<span>Playing Inline</span></span>`
              : `<span class="inline-icon-meta" style="min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${iconSvg('video', 14)}<span>${esc(label)}</span></span>`
          }
          <a href="${esc(watchUrl)}" target="_blank" rel="noopener noreferrer" class="ext-link" style="flex-shrink:0">Watch on YouTube ${iconSvg('externalLink', 12)}</a>
        </div>
      </div>
    `;
  }

  return `
    <div class="video-embed-box">
      <div class="video-thumb-stage" style="cursor:pointer" data-action="play-inline-video" data-vid-key="${esc(vidKey)}">
        <img src="${esc(thumbUrl)}" alt="${esc(label)}" class="video-thumb-img" loading="lazy" decoding="async" />
        <div class="video-thumb-overlay">
          <button type="button" class="video-play-pill" data-action="play-inline-video" data-vid-key="${esc(vidKey)}">
            ${iconSvg('play', 14)}
            <span>Play Clip Inline</span>
          </button>
        </div>
      </div>
      ${
        compactFooter
          ? `<div class="video-launch-bar" style="justify-content:flex-end">
              <a href="${esc(watchUrl)}" target="_blank" rel="noopener noreferrer" class="ext-link" style="flex-shrink:0">Open on YouTube ${iconSvg('externalLink', 12)}</a>
            </div>`
          : `<div class="video-launch-bar">
              <div style="min-width:0">
                <div style="font-weight:700;font-size:12.5px;color:#E5CF96;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(label)}</div>
                <div style="font-size:11px;color:#A3AFBF">${esc(channel || 'YouTube Film & Podium')}</div>
              </div>
              <a href="${esc(watchUrl)}" target="_blank" rel="noopener noreferrer" class="ext-link" style="flex-shrink:0">YouTube ${iconSvg('externalLink', 12)}</a>
            </div>`
      }
    </div>
  `;
}
