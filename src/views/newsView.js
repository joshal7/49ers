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
  renderExpandableSummaryHtml,
  renderInlineSocialPhotoGalleryHtml,
  renderPlayerChipsStripHtml,
  renderPreservedTweetTextHtml,
  renderSalientThumbHtml,
  renderSalientHeroBannerHtml,
  renderTweetLinkedArticleCardHtml,
  registerRosterPlayersForInlineLinks
} from './uiHelpers.js';
import {
  getItemInlineSocialPhotoUrls,
  isInlineFilmPhotoOrChartTweet,
  optimizeImageUrlForSlot,
  resolveDailyBriefHeroMedia,
  resolveSalientCardVisual
} from '../engine/salientMediaEngine.js';
import { iconSvg } from './icons.js';
import { getActiveTeamConfig } from '../config/teamRegistry.js';
import {
  SHORT_TWEET_FULL_TEXT_LIMIT,
  isUrgentBreakingBadge,
  isSalientCapOrContractItem,
  sortNewsWithBreakingPriority,
  deduplicateAndGroupWireItems,
  balanceFeedTopSalience,
  promoteLinkDropTweetToArticle,
  resolveTweetLinkedArticlePreview,
  stripRedundantAuthorBoilerplate,
  isRedundantProfileSelfLink,
  formatTweetBodyForDisplay,
  isStaleCompletedGameAvailabilityItem,
  filterOutCompletedGameAvailabilityItems,
  filterFreshVideosForCurrentSlate,
  scoreHighlightAndTeamVideoSalience,
  partitionBreakingNewsAboveBrief
} from '../engine/breakingClassifier.js';
import {
  decodeHtmlEntities,
  formatWireSourceDisplayName,
  isOffTopicLeagueFiller,
  isPaywalledPublisher,
  sanitizeExternalUrl,
  MARKDOWN_HTTPS_INLINE_LINK_SOURCE,
  encodeMarkdownLinkUrl,
  decodeMarkdownLinkUrlParens,
  normalizeMarkdownInlineLinksInText
} from '../engine/linkIntegrity.js';
import {
  resolveItemAuthorProfileUrl,
  resolveOriginalTweetUrl
} from '../engine/beatAttributionEngine.js';
import {
  buildDeterministicDailyTopNewsBrief,
  repairDailyTopNewsBriefLinks
} from '../services/aiWorkerClient.js';
import {
  NEWS_SORT_MODES,
  normalizeNewsSortMode,
  getItemReadKey,
  isItemRead,
  computeCatchUpState,
  sortNewsFeedByMode,
  extractPresserTakeaways,
  estimateItemEffortCue,
  matchNewsItemSearchQuery
} from '../engine/digestExperienceEngine.js';

const runtimeBlockedYouTubeIds = new Set();

export function markYouTubeVideoBlocked(videoId = '') {
  const id = String(videoId || '').trim();
  if (id) runtimeBlockedYouTubeIds.add(id);
}

export function isYouTubeVideoKnownBlocked(videoId = '') {
  const id = String(videoId || '').trim();
  return Boolean(id && runtimeBlockedYouTubeIds.has(id));
}

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
  return decodeHtmlEntities(str);
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
  const inlineCitedUrls = new Set();
  const proseBlocks = [
    String(dailyBrief?.summary || ''),
    ...(Array.isArray(dailyBrief?.bullets) ? dailyBrief.bullets : [])
  ];
  const mdCiteRe = /\]\((https:\/\/[^)\s]+)\)/gi;
  for (const blk of proseBlocks) {
    let cm;
    while ((cm = mdCiteRe.exec(String(blk || ''))) !== null) {
      inlineCitedUrls.add(String(cm[1]).trim().toLowerCase().replace(/\/+$/, ''));
    }
  }
  const rosterNamesLower = Array.isArray(appData?.roster?.players)
    ? appData.roster.players
        .map(p => String(p?.name || '').trim().toLowerCase())
        .filter(n => n.length >= 6)
    : [];

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

    // Strip uncited off-topic league-wide roundups (e.g. Myles Garrett sack list, George Kittle arrivals)
    const normOrig = String(sl.url || '').trim().toLowerCase().replace(/\/+$/, '');
    const normSafe = String(safeUrl).trim().toLowerCase().replace(/\/+$/, '');
    const isInlineCited = inlineCitedUrls.has(normOrig) || inlineCitedUrls.has(normSafe);
    if (!isInlineCited) {
      const titleLower = cleanTitle.toLowerCase();
      const hasRosterHit = rosterNamesLower.some(nm => titleLower.includes(nm));
      if (isOffTopicLeagueFiller({ url: safeUrl, title: cleanTitle, summary: '', hasRosterMatch: hasRosterHit })) {
        continue;
      }
    }

    seen.add(dedupKey);

    safeList.push({
      originalUrl: sl.url || safeUrl,
      title: cleanTitle || sl.outlet || 'Open Source',
      url: safeUrl,
      outlet: sl.outlet || `${getActiveTeamConfig().nickname} Beat`,
      author: sl.author || (effectiveHandle ? effectiveHandle : sl.outlet || `${getActiveTeamConfig().nickname} Beat`),
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
  { rawStream = [], appData = null, asSubcard = false, readKeysSet = null } = {}
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
  const formatBriefCycleTooltip = b => {
    const ck = String(b?.cycleKey || '');
    const genIso = String(b?.generatedAt || '');
    let cycleLabel = '';
    const postM = ck.match(/^(\d{4})-(\d{2})-(\d{2})@postgame-([a-z0-9_-]+)$/i);
    const dailyM = ck.match(/^(\d{4})-(\d{2})-(\d{2})@(\d{1,2})PT$/i);
    if (postM) {
      const slug = postM[4].toUpperCase().replace(/^WK/, 'Week ');
      cycleLabel = `Post-Game ${slug} cycle`;
    } else if (dailyM) {
      const tz = getActiveTeamConfig()?.timezone || 'America/Los_Angeles';
      const dObj = new Date(Date.UTC(Number(dailyM[1]), Number(dailyM[2]) - 1, Number(dailyM[3]), 19, 0, 0));
      const dayLbl = dObj.toLocaleDateString('en-US', {
        timeZone: tz,
        weekday: 'short',
        month: 'short',
        day: 'numeric'
      });
      const hr = Number(dailyM[4]);
      const hr12 = hr % 12 || 12;
      const ampm = hr >= 12 ? 'PM' : 'AM';
      cycleLabel = `${dayLbl} ${hr12}:00 ${ampm} PT cycle`;
    }
    const genLabel = genIso ? `Generated ${genIso}` : '';
    return [cycleLabel, genLabel].filter(Boolean).join(' • ');
  };
  const briefAgeTooltip = formatBriefCycleTooltip(brief);
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
              <span class="mono" style="font-size:10px;color:var(--text-muted)">▾</span>
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
                  const srcReadKey = getItemReadKey(matchedItem);
                  const srcIsRead = isItemRead(matchedItem, readKeysSet);
                  const srcIsTw = rep.type === 'tweet';
                  const srcLinkedPreview = srcIsTw
                    ? resolveTweetLinkedArticlePreview(matchedItem, { rawStream, resolvedItemUrl: rep.url })
                    : null;
                  const srcLinkedCardHtml = srcLinkedPreview
                    ? renderTweetLinkedArticleCardHtml(srcLinkedPreview, {
                        variant: 'compact',
                        markReadKey: srcReadKey
                      })
                    : '';
                  const effectiveSrcThumbHtml = srcLinkedPreview?.imageUrl ? '' : srcThumbHtml;
                  if (srcLinkedCardHtml) {
                    return `
                      <div class="synthesis-source-sheet-row has-linked-article-card ${effectiveSrcThumbHtml ? 'has-source-thumb' : ''} ${srcIsRead ? 'is-read-item' : ''}" data-brief-source-row data-read-key="${esc(srcReadKey)}">
                        <div class="similar-story-top-row">
                          <div style="min-width:0;flex:1">
                            <div class="source-row-meta">
                              <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;min-width:0">
                                <span class="badge ${badgeCls}" style="font-size:9.8px;padding:1.5px 6px">${esc(typeLabel)}</span>
                                <strong class="source-row-author">${esc(attribution)}</strong>
                              </div>
                              <span class="mono source-row-age">${rep.publishedAt ? esc(formatRelativeAge(rep.publishedAt)) : ''}</span>
                            </div>
                            <a href="${esc(rep.url)}" target="_blank" rel="noopener noreferrer" class="source-row-headline is-tweet-body similar-story-tweet-link" data-mark-read-key="${esc(srcReadKey)}">
                              ${esc(rep.title)} <span class="wire-inline-ext">${iconSvg('externalLink', 11)}</span>
                            </a>
                          </div>
                          ${effectiveSrcThumbHtml}
                        </div>
                        ${srcLinkedCardHtml}
                      </div>
                    `;
                  }
                  return `
                    <a href="${esc(rep.url)}" target="_blank" rel="noopener noreferrer" class="synthesis-source-sheet-row ${srcThumbHtml ? 'has-source-thumb' : ''} ${srcIsRead ? 'is-read-item' : ''}" data-brief-source-row data-read-key="${esc(srcReadKey)}" data-mark-read-key="${esc(srcReadKey)}">
                      <div style="min-width:0;flex:1">
                        <div class="source-row-meta">
                          <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;min-width:0">
                            <span class="badge ${badgeCls}" style="font-size:9.8px;padding:1.5px 6px">${esc(typeLabel)}</span>
                            <strong class="source-row-author">${esc(attribution)}</strong>
                          </div>
                          <span class="mono source-row-age">${rep.publishedAt ? esc(formatRelativeAge(rep.publishedAt)) : ''}</span>
                        </div>
                        <div class="source-row-headline ${srcIsTw ? 'is-tweet-body' : ''}">
                          ${esc(rep.title)} <span class="wire-inline-ext">${iconSvg('externalLink', 11)}</span>
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
              ? `<button type="button" class="btn-ghost btn-compact daily-brief-ask-btn" data-action="analyze-topic-jump" data-prompt="${esc(brief.headline || `${getActiveTeamConfig().nickname} Top News Deep Dive`)}">
                   ${iconSvg('sparkles', 12)}
                   <span>Ask AI</span>
                 </button>`
              : ''
          }
        </div>
      `
      : '';

  return `
    <${tagName} class="${outerCls}" data-daily-news-brief="${esc(brief.id || 'daily')}" data-brief-gen="${esc(brief.generatedAt || '')}" data-brief-headline="${esc(String(brief.headline || '').slice(0, 80))}">
      <div class="daily-brief-head">
        <div style="min-width:0;flex:1">
          <div class="card-eyebrow">Top News Brief</div>
          <h3 class="card-title daily-brief-headline">${escJargon(brief.headline || `${getActiveTeamConfig().nickname} Daily Briefing`, { maxTerms: 6, maxPlayers: 3, seenKeys: seenJargon })}</h3>
        </div>
        <span class="mono daily-brief-age" data-daily-brief-age data-published-at="${esc(brief.generatedAt || '')}" title="${esc(briefAgeTooltip || `Generated ${brief.generatedAt || ''}`)}">${esc(ageTiny)}</span>
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
    const isGifClip = Boolean(
      item?.isAnimatedGif ||
        /\/tweet_video\//i.test(String(item?.videoStreamUrl || '')) ||
        /\.gif(?:\?|$)/i.test(String(item?.videoStreamUrl || ''))
    );
    const hasFilmMediaClip = Boolean(isVideo || item?.videoId || item?.videoStreamUrl);
    const filmLabel = isGifClip ? 'All-22 GIF' : hasFilmMediaClip ? 'All-22 Film' : 'Film & Trench';
    return `<span class="badge badge-positive">${iconSvg(hasFilmMediaClip ? 'video' : 'target', 11)}<span>${filmLabel}</span></span>`;
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
    if (/\b(forty niner way|49hours|inside the den|building the|embedded|hard knocks|sounds of the game|all access|wired|mic['’]?d up|locker room|from the trenches|recap)\b/i.test(title)) {
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

function isSummaryRedundantWithTitle(title = '', summary = '') {
  const norm = s =>
    String(s || '')
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  const t = norm(title);
  const s = norm(summary);
  if (!t || !s) return false;
  if (s === t || t.includes(s) || s.startsWith(t.slice(0, Math.min(48, t.length)))) return true;
  const tWords = new Set(t.split(' ').filter(w => w.length >= 4));
  const sWords = s.split(' ').filter(w => w.length >= 4);
  if (tWords.size >= 4 && sWords.length >= 4) {
    const overlap = sWords.filter(w => tWords.has(w)).length;
    if (overlap / sWords.length >= 0.82) return true;
  }
  return false;
}

function renderRelatedStoriesDrawerHtml(
  item,
  confirmingList = [],
  { prioritizedRaw = [], rosterPlayers = [], readKeysSet = null, parentShownUrls = null, activeVideosSet = new Set() } = {}
) {
  if (!Array.isArray(confirmingList) || confirmingList.length === 0) return '';
  const clusterKind = item?.clusterKind === 'corroboration' ? 'corroboration' : 'similar';
  const summaryLabel = `Similar stories (${confirmingList.length})`;
  const normUrl = u =>
    String(u || '')
      .replace(/^https?:\/\/(?:www\.|m\.)/i, 'https://')
      .replace(/\/+$/, '')
      .toLowerCase();

  const rowsHtml = confirmingList
    .slice(0, 12)
    .map((cr, crIdx) => {
      const crIsTw = cr?.type === 'tweet' || cr?.type === 'social';
      const crStreamUrl =
        cr?.videoStreamUrl && /^https:\/\//i.test(String(cr.videoStreamUrl).trim())
          ? String(cr.videoStreamUrl).trim()
          : '';
      const crIsGif = Boolean(
        cr?.isAnimatedGif ||
          /\/tweet_video\//i.test(crStreamUrl) ||
          /\.gif(?:\?|$)/i.test(crStreamUrl)
      );
      const crIsVid = cr?.type === 'video' || Boolean(cr?.videoId) || Boolean(crStreamUrl);
      const crHref = crIsTw
        ? sanitizeExternalUrl(resolveOriginalTweetUrl(cr, prioritizedRaw), '#')
        : sanitizeExternalUrl(cr?.url, '#');
      const crBeatFallback = `${getActiveTeamConfig().nickname} Beat`;
      const crAuthor = formatWireSourceDisplayName(cr?.author || cr?.reporterName || cr?.outletName || crBeatFallback);
      const crOutlet = formatWireSourceDisplayName(cr?.outletName || '');
      const attribution =
        crAuthor && crOutlet && crAuthor.toLowerCase() !== crOutlet.toLowerCase()
          ? `${crAuthor} • ${crOutlet}`
          : crAuthor || crOutlet || crBeatFallback;
      const crIsInjuryWire = cr?.wireSource === 'espn_player_wire' || String(cr?.id || '').startsWith('espn_pwire_');
      const typeLabel = crIsGif
        ? 'GIF'
        : crIsVid
          ? cr?.duration
            ? `Clip ${cr.duration}`
            : 'Video'
          : crIsTw
            ? 'Tweet'
            : crIsInjuryWire
              ? 'Injury Wire'
              : 'Article';
      const badgeCls = crIsGif || crIsVid ? 'badge-scarlet' : crIsTw ? 'badge-gold' : 'badge-neutral';
      const crHasInlineClip = Boolean(cr?.videoId || crStreamUrl);
      const crUniqueKey = cr?.id || (cr?.videoId ? `yt_${cr.videoId}` : `${item?.id || item?.videoId || 'item'}_${crIdx}`);
      const crVidKey = crHasInlineClip ? `rel_${crUniqueKey}` : '';
      const crVidOpen = Boolean(crVidKey && activeVideosSet.has(crVidKey));
      const rawBody = crIsTw
        ? formatTweetBodyForDisplay(
            stripRedundantAuthorBoilerplate(cr?.fullText || cr?.title || cr?.headline || '', crAuthor)
          ).text
        : stripRedundantAuthorBoilerplate(cr?.title || cr?.headline || cr?.fullText || '', crAuthor);
      const displayHeadline = rawBody.length > 165 ? `${rawBody.slice(0, 162)}…` : rawBody;
      const crVisual = resolveSalientCardVisual(cr, {
        rosterPlayers,
        slot: 'thumb',
        allowTeamFallback: false
      });
      const crThumbHtml = crVisual
        ? renderSalientThumbHtml(crVisual, { size: 'sm', asStatic: true, extraClass: 'brief-source-thumb' })
        : '';
      const crReadKey = getItemReadKey(cr);
      const crIsRead = isItemRead(cr, readKeysSet);
      const isValidLink = Boolean(crHref && crHref !== '#');
      const rawCrLinkedPreview = crIsTw
        ? resolveTweetLinkedArticlePreview(cr, { rawStream: prioritizedRaw, resolvedItemUrl: isValidLink ? crHref : '' })
        : null;
      const crLinkedPreview =
        rawCrLinkedPreview && !(parentShownUrls && parentShownUrls.has(normUrl(rawCrLinkedPreview.url)))
          ? rawCrLinkedPreview
          : null;
      const crLinkedCardHtml = crLinkedPreview
        ? renderTweetLinkedArticleCardHtml(crLinkedPreview, {
            variant: 'compact',
            markReadKey: crReadKey
          })
        : '';
      const effectiveCrThumbHtml = crLinkedPreview?.imageUrl ? '' : crThumbHtml;

      if (crLinkedCardHtml) {
        const divCls = `synthesis-source-sheet-row similar-story-row has-linked-article-card ${effectiveCrThumbHtml ? 'has-source-thumb' : ''} ${crIsRead ? 'is-read-item' : ''}`.trim();
        return `
          <div class="${divCls}" data-similar-story-row data-read-key="${esc(crReadKey)}">
            <div class="similar-story-top-row">
              <div style="min-width:0;flex:1">
                <div class="source-row-meta">
                  <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;min-width:0">
                    <span class="badge ${badgeCls}" style="font-size:9.8px;padding:1.5px 6px">${esc(typeLabel)}</span>
                    <strong class="source-row-author">${esc(attribution)}</strong>
                  </div>
                  <span class="mono source-row-age">${cr?.publishedAt ? esc(formatRelativeAge(cr.publishedAt)) : ''}</span>
                </div>
                ${
                  isValidLink
                    ? `<a href="${esc(crHref)}" target="_blank" rel="noopener noreferrer" class="source-row-headline is-tweet-body similar-story-tweet-link" data-mark-read-key="${esc(crReadKey)}">${renderPreservedTweetTextHtml(displayHeadline)} <span class="wire-inline-ext">${iconSvg('externalLink', 11)}</span></a>`
                    : `<div class="source-row-headline is-tweet-body">${renderPreservedTweetTextHtml(displayHeadline)}</div>`
                }
              </div>
              ${effectiveCrThumbHtml}
            </div>
            ${crLinkedCardHtml}
          </div>
        `;
      }

      if (crHasInlineClip) {
        const divCls = `synthesis-source-sheet-row similar-story-row has-inline-clip ${crThumbHtml ? 'has-source-thumb' : ''} ${crIsRead ? 'is-read-item' : ''}`.trim();
        const inlineRelPlayerHtml = crVidOpen
          ? renderVideoEmbedOrFacade(
              crVidKey,
              cr.videoId || '',
              0,
              displayHeadline || 'Watch Clip',
              crOutlet || crAuthor,
              true,
              cr.embeddable !== false,
              {
                compactFooter: true,
                videoStreamUrl: crStreamUrl,
                posterUrl: cr.imageUrl || '',
                externalWatchUrl: isValidLink ? crHref : '',
                isAnimatedGif: crIsGif,
                durationLabel: cr.duration || ''
              }
            )
          : '';
        return `
          <div class="${divCls}" data-similar-story-row data-read-key="${esc(crReadKey)}">
            <div class="similar-story-top-row">
              <div style="min-width:0;flex:1">
                <div class="source-row-meta">
                  <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;min-width:0">
                    <span class="badge ${badgeCls}" style="font-size:9.8px;padding:1.5px 6px">${esc(typeLabel)}</span>
                    <strong class="source-row-author">${esc(attribution)}</strong>
                  </div>
                  <div style="display:flex;align-items:center;gap:6px;flex-shrink:0">
                    ${
                      !crVidOpen
                        ? `<button type="button" class="btn-ghost btn-compact similar-story-play-btn" data-action="play-inline-video" data-vid-key="${esc(crVidKey)}" aria-label="Play ${esc(crIsGif ? 'GIF' : 'clip')} inline">${iconSvg('play', 10)}<span>${crIsGif ? 'GIF' : 'Play'}</span></button>`
                        : ''
                    }
                    <span class="mono source-row-age">${cr?.publishedAt ? esc(formatRelativeAge(cr.publishedAt)) : ''}</span>
                  </div>
                </div>
                ${
                  isValidLink
                    ? `<a href="${esc(crHref)}" target="_blank" rel="noopener noreferrer" class="source-row-headline ${crIsTw ? 'is-tweet-body' : ''} similar-story-tweet-link" data-mark-read-key="${esc(crReadKey)}">${crIsTw ? renderPreservedTweetTextHtml(displayHeadline) : esc(displayHeadline)} <span class="wire-inline-ext">${iconSvg('externalLink', 11)}</span></a>`
                    : `<div class="source-row-headline ${crIsTw ? 'is-tweet-body' : ''}">${crIsTw ? renderPreservedTweetTextHtml(displayHeadline) : esc(displayHeadline)}</div>`
                }
              </div>
              ${crVidOpen ? '' : crThumbHtml}
            </div>
            ${inlineRelPlayerHtml}
          </div>
        `;
      }

      const rowCls = `synthesis-source-sheet-row similar-story-row ${crThumbHtml ? 'has-source-thumb' : ''} ${crIsRead ? 'is-read-item' : ''}`.trim();
      const rowOpen = isValidLink
        ? `<a href="${esc(crHref)}" target="_blank" rel="noopener noreferrer" class="${rowCls}" data-similar-story-row data-read-key="${esc(crReadKey)}" data-mark-read-key="${esc(crReadKey)}">`
        : `<div class="${rowCls}" data-similar-story-row data-read-key="${esc(crReadKey)}">`;
      const rowClose = isValidLink ? '</a>' : '</div>';

      return `
        ${rowOpen}
          <div style="min-width:0;flex:1">
            <div class="source-row-meta">
              <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;min-width:0">
                <span class="badge ${badgeCls}" style="font-size:9.8px;padding:1.5px 6px">${esc(typeLabel)}</span>
                <strong class="source-row-author">${esc(attribution)}</strong>
              </div>
              <span class="mono source-row-age">${cr?.publishedAt ? esc(formatRelativeAge(cr.publishedAt)) : ''}</span>
            </div>
            <div class="source-row-headline ${crIsTw ? 'is-tweet-body' : ''}">
              ${crIsTw ? renderPreservedTweetTextHtml(displayHeadline) : esc(displayHeadline)}${isValidLink ? ` <span class="wire-inline-ext">${iconSvg('externalLink', 11)}</span>` : ''}
            </div>
          </div>
          ${crThumbHtml}
        ${rowClose}
      `;
    })
    .join('');

  const parentReadKey = getItemReadKey(item);
  return `
    <details class="compact-details confirming-reports-toggle similar-stories-drawer" data-confirming-reports data-similar-stories="true" data-story-timeline="true" data-cluster-kind="${esc(clusterKind)}"${parentReadKey ? ` data-parent-read-key="${esc(parentReadKey)}"` : ''}>
      <summary class="compact-details-summary">
        <span>${esc(summaryLabel)}</span>
      </summary>
      <div class="similar-stories-list" style="display:flex;flex-direction:column;gap:6px;margin-top:7px">
        ${rowsHtml}
      </div>
    </details>
  `;
}

export function renderWireItemCardHtml(
  item,
  {
    prioritizedRaw = [],
    activeVideosSet = new Set(),
    rosterPlayers = [],
    isLeadFeatured = false,
    eagerImage = false,
    readKeysSet = null,
    isCompactMode = false,
    isNewSinceVisit = false
  } = {}
) {
  const safeStreamCandidate =
    item.videoStreamUrl && /^https:\/\//i.test(String(item.videoStreamUrl).trim())
      ? String(item.videoStreamUrl).trim()
      : '';
  const isAnimatedGif = Boolean(
    item.isAnimatedGif ||
      /\/tweet_video\//i.test(safeStreamCandidate) ||
      /\.gif(?:\?|$)/i.test(safeStreamCandidate)
  );
  const isTweet = item.type === 'tweet' || item.type === 'social';
  const isVideo = item.type === 'video';
  const isUrgent = isUrgentBreakingBadge(item.breakingBadge);
  const readKey = getItemReadKey(item);
  const itemAlreadyRead = isItemRead(item, readKeysSet);

  const rawAuthorName = item.author || item.reporterName || item.channel || item.outletName || `${getActiveTeamConfig().nickname} Beat`;
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
  const effectiveEmbeddable =
    safeStreamCandidate || item.videoId
      ? item.embeddable !== false && !(item.videoId && isYouTubeVideoKnownBlocked(item.videoId))
      : false;
  const hasPlayableVideo = Boolean(item.videoId || effectiveStreamOrCardUrl);
  const uniqueVidIdentity =
    String(item.id || '').trim() ||
    (item.videoId ? `yt_${item.videoId}` : '') ||
    resolvedItemUrl ||
    effectiveStreamOrCardUrl ||
    '';
  const vidKey = hasPlayableVideo && uniqueVidIdentity ? `raw_${uniqueVidIdentity}` : null;
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

  const rawCleanSummary =
    !isCompactMode &&
    !isVideo &&
    !isTweet &&
    item.summary &&
    !item.summary.startsWith('Published via ') &&
    item.summary.toLowerCase() !== `${rawAuthorName} • ${item.outletName || ''}`.toLowerCase()
      ? stripRedundantAuthorBoilerplate(item.summary, rawAuthorName)
      : '';
  const cleanSummary =
    rawCleanSummary && !isSummaryRedundantWithTitle(displayTitle, rawCleanSummary) ? rawCleanSummary : '';

  const effortCue = estimateItemEffortCue(item);

  const safeExtUrl = sanitizeExternalUrl(item.externalUrl, null);
  const inlineSocialPhotos = getItemInlineSocialPhotoUrls(item);
  const hasMultiSocialPhotos = inlineSocialPhotos.length >= 2;
  const linkedArticlePreview =
    isTweet && !hasPlayableVideo
      ? resolveTweetLinkedArticlePreview(item, { rawStream: prioritizedRaw, resolvedItemUrl })
      : null;
  const linkedArticleVariant =
    isCompactMode || hasMultiSocialPhotos || !linkedArticlePreview?.imageUrl ? 'compact' : 'card';
  const linkedArticleCardHtml = linkedArticlePreview
    ? renderTweetLinkedArticleCardHtml(linkedArticlePreview, {
        variant: linkedArticleVariant,
        markReadKey: readKey,
        eager: eagerImage
      })
    : '';
  const linkedCardOwnsMedia = Boolean(linkedArticlePreview?.imageUrl && linkedArticleCardHtml && !hasMultiSocialPhotos);
  const thumbTargetHref = resolvedItemUrl || safeExtUrl || '';
  const showInlineChartPhoto = Boolean(
    !isCompactMode &&
      !linkedCardOwnsMedia &&
      !isVideo &&
      isInlineFilmPhotoOrChartTweet(item)
  );
  const inlineChartPhotoHtml = showInlineChartPhoto
    ? renderInlineSocialPhotoGalleryHtml(item, {
        fallbackHref: thumbTargetHref,
        altText: displayTitle,
        eager: eagerImage,
        markReadKey: readKey
      })
    : '';
  const wantsLeadHeroSlot = Boolean(
    !isCompactMode &&
      !linkedCardOwnsMedia &&
      !inlineChartPhotoHtml &&
      (isLeadFeatured || isUrgent) &&
      !isVideo &&
      !hasPlayableVideo
  );
  const salientVisual =
    !isCompactMode && !linkedCardOwnsMedia && !inlineChartPhotoHtml && !isVideo && !hasPlayableVideo
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
          eager: eagerImage,
          markReadKey: readKey
        })
      : '';
  const leadHeroHtml = showLeadHero
    ? renderSalientHeroBannerHtml(salientVisual, {
        href: thumbTargetHref,
        compact: false,
        eager: eagerImage || isLeadFeatured,
        extraClass: 'wire-hero-media',
        markReadKey: readKey
      })
    : '';
  const hasThumb = Boolean(sideThumbHtml);
  const normCmpUrl = u =>
    String(u || '')
      .replace(/^https?:\/\/(?:www\.|m\.)/i, 'https://')
      .replace(/\/+$/, '')
      .toLowerCase();
  const effectiveLinkedExtUrl = linkedArticlePreview?.url || safeExtUrl || '';
  const showLinkedStory =
    !linkedArticleCardHtml &&
    Boolean(safeExtUrl) &&
    normCmpUrl(safeExtUrl) !== normCmpUrl(resolvedItemUrl) &&
    !isRedundantProfileSelfLink(safeExtUrl, resolvedItemUrl) &&
    !isRedundantProfileSelfLink(safeExtUrl, item.url) &&
    !/\bon X$/i.test(String(item.externalTitle || ''));
  const parentShownUrls = new Set(
    [resolvedItemUrl, linkedArticleCardHtml || showLinkedStory ? effectiveLinkedExtUrl : '']
      .map(normCmpUrl)
      .filter(Boolean)
  );
  const confirmingList = (Array.isArray(item.confirmingReports) ? item.confirmingReports : []).filter(cr => {
    const crIsTw = cr?.type === 'tweet' || cr?.type === 'social';
    const crHref = crIsTw
      ? sanitizeExternalUrl(resolveOriginalTweetUrl(cr, prioritizedRaw), '')
      : sanitizeExternalUrl(cr?.url, '');
    if ((linkedArticleCardHtml || showLinkedStory) && effectiveLinkedExtUrl && crHref && normCmpUrl(crHref) === normCmpUrl(effectiveLinkedExtUrl)) return false;
    if (resolvedItemUrl && crHref && normCmpUrl(crHref) === normCmpUrl(resolvedItemUrl)) return false;
    return true;
  });
  const relatedStoriesDrawerHtml =
    confirmingList.length > 0
      ? renderRelatedStoriesDrawerHtml(item, confirmingList, {
          prioritizedRaw,
          rosterPlayers,
          readKeysSet,
          parentShownUrls,
          activeVideosSet
        })
      : '';

  const rightMetaPrefix =
    hasPlayableVideo && isAnimatedGif
      ? 'GIF • '
      : hasPlayableVideo && item.duration
        ? `${item.duration} • `
        : effortCue
          ? `${effortCue} • `
          : '';

  const playerChipsHtml =
    !isCompactMode && item.mentionedPlayers?.length
      ? `<div class="wire-card-players-row">${renderPlayerChipsStripHtml(item.mentionedPlayers, 4)}</div>`
      : '';

  return `
    <div class="brief-card ${isUrgent ? 'breaking-elevated' : ''} ${showLeadHero ? 'has-lead-hero' : ''} ${itemAlreadyRead ? 'is-read-item' : ''} ${isNewSinceVisit && !itemAlreadyRead ? 'is-new-item' : ''} ${isCompactMode ? 'compact-wire-card' : ''}" data-raw-type="${esc(item.type || 'article')}" data-raw-category="${esc(item.category || 'beat')}" data-read-key="${esc(readKey)}">
      ${leadHeroHtml}
      <div class="wire-card-meta-row">
        <div class="wire-card-meta-left">
          ${isNewSinceVisit && !itemAlreadyRead ? `<span class="new-item-dot" title="New since last visit" aria-hidden="true"></span>` : ''}
          ${renderWireSignalBadgeHtml(item, isVideo, isTweet)}
          ${
            authorHref
              ? `<a href="${esc(authorHref)}" target="_blank" rel="noopener noreferrer" class="wire-author-single-link" data-wire-author-link><strong>${esc(authorName)}</strong></a>`
              : `<strong class="wire-author-label">${esc(authorName)}</strong>`
          }
        </div>
        <span class="mono wire-card-age" data-wire-age data-published-at="${esc(item.publishedAt || '')}" data-age-prefix="${esc(rightMetaPrefix)}">${esc(rightMetaPrefix)}${esc(formatRelativeAge(item.publishedAt))}</span>
      </div>
      <div class="wire-card-main-row ${hasThumb ? 'media-split-row' : ''}">
        <div class="wire-card-body-col">
          <div class="wire-card-headline ${isTweet ? 'is-tweet-body' : ''}">
            ${
              resolvedItemUrl
                ? `<a href="${esc(resolvedItemUrl)}" target="_blank" rel="noopener noreferrer" class="ext-link wire-headline-link" data-mark-read-key="${esc(readKey)}">${isTweet ? renderPreservedTweetTextHtml(displayTitle) : esc(displayTitle)} <span class="wire-inline-ext">${iconSvg('externalLink', 11)}</span></a>`
                : isTweet
                  ? renderPreservedTweetTextHtml(displayTitle)
                  : esc(displayTitle)
            }
          </div>
          ${cleanSummary ? renderExpandableSummaryHtml(cleanSummary, { className: 'wire-card-summary' }) : ''}
          ${linkedArticleCardHtml}
          ${
            showLinkedStory
              ? `<div class="wire-card-actions-row">
                  <a href="${esc(safeExtUrl)}" target="_blank" rel="noopener noreferrer" class="source-chip-link" data-mark-read-key="${esc(readKey)}">
                    <span>Article: ${esc((item.externalTitle || item.outletName || 'Open Story').slice(0, 48))}</span>
                    ${iconSvg('externalLink', 10)}
                  </a>
                </div>`
              : ''
          }
          ${playerChipsHtml}
        </div>
        ${sideThumbHtml}
      </div>
      ${inlineChartPhotoHtml}
      ${
        hasPlayableVideo
          ? renderVideoEmbedOrFacade(
              vidKey,
              item.videoId || '',
              0,
              item.title || `Watch Clip (${isAnimatedGif ? 'GIF' : item.duration || 'Video'})`,
              authorName || item.channel || item.outletName || 'YouTube',
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
                  '',
                isAnimatedGif,
                durationLabel: item.duration || ''
              }
            )
          : ''
      }
      ${relatedStoriesDrawerHtml}
    </div>
  `;
}

function renderPresserTakeawaysStripHtml(takeaways = []) {
  if (!Array.isArray(takeaways) || takeaways.length < 2) return '';
  const speakers = Array.from(new Set(takeaways.map(t => t.speaker))).slice(0, 3).join(' · ');
  const newestIso = takeaways.reduce((best, t) => (!best || t.pubMs > Date.parse(best) ? t.publishedAt : best), '');

  return `
    <details class="card presser-strip-card" data-presser-takeaways>
      <summary class="presser-strip-summary">
        <div style="display:flex;align-items:center;gap:7px;min-width:0">
          <span class="presser-strip-icon" aria-hidden="true">${iconSvg('quote', 14)}</span>
          <span class="presser-strip-title">Presser Takeaways <span class="presser-strip-speakers">· ${esc(speakers)}</span></span>
        </div>
        <span class="mono presser-strip-meta">${takeaways.length} quotes${newestIso ? ` · ${esc(formatRelativeAge(newestIso))}` : ''} ▾</span>
      </summary>
      <div class="presser-strip-list">
        ${takeaways
          .map(
            t => `
          <div class="presser-quote-row">
            <div class="presser-quote-meta">
              <span class="badge ${t.topicTag === 'Health' ? 'badge-warning' : t.topicTag === 'Roster' ? 'badge-gold' : 'badge-neutral'}" style="font-size:9.5px;padding:1px 6px">${esc(t.topicTag)}</span>
              <strong style="font-size:12px">${esc(t.speakerFull)}</strong>
              <span class="mono" style="font-size:10.5px;color:var(--text-muted)">via ${esc(t.sourceAuthor)} · ${esc(formatRelativeAge(t.publishedAt))}</span>
            </div>
            <div class="presser-quote-body">
              ${escJargon(t.text, { maxTerms: 4, maxPlayers: 3 })}
              <a href="${esc(t.sourceUrl)}" target="_blank" rel="noopener noreferrer" class="brief-inline-source-link" title="Source: ${esc(t.sourceAuthor)}" aria-label="Open quote source from ${esc(t.sourceAuthor)}">${iconSvg('link', 10)}</a>
            </div>
          </div>
        `
          )
          .join('')}
      </div>
    </details>
  `;
}

export function renderNewsViewHtml({
  appData = null,
  newsCategoryFilter = 'all', // 'all' | 'tweets' | 'articles' | 'videos' | 'film' | 'roster'
  newsSortMode = 'top', // 'top' (default) | 'latest'
  newsTopicFilter = 'all',
  newsSearchQuery = '',
  newsSourceFilter = null,
  filteredRawItems,
  activeVideosSet = new Set(),
  userPrefs,
  lastWireSyncAt = null,
  isSyncingWire = false,
  sessionLastVisitedAt = null,
  nowMs = Date.now()
}) {
  registerRosterPlayersForInlineLinks(appData?.roster?.players);
  const activeFilter = ['all', 'tweets', 'articles', 'videos', 'film', 'roster'].includes(newsCategoryFilter)
    ? newsCategoryFilter
    : 'all';
  const activeSort = normalizeNewsSortMode(newsSortMode || userPrefs?.newsSortMode || 'top');
  const shouldGroupSimilar = activeSort === 'top' && userPrefs?.groupSimilarStories !== false;
  const isCompactMode = userPrefs?.feedDensity === 'compact';
  const readKeysSet = new Set(Array.isArray(userPrefs?.readItemKeys) ? userPrefs.readItemKeys : []);
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

  const applySortAndBalance = list => {
    const sorted = sortNewsFeedByMode(list, activeSort, { nowMs, appData });
    return activeSort === 'latest' ? sorted : balanceFeedTopSalience(sorted, { nowMs, appData });
  };

  const teamScopedPrioritizedRaw = prioritizedRaw.filter(i => !i.filmOnlyScope);
  const dedupedRaw = applySortAndBalance(
    deduplicateAndGroupWireItems(teamScopedPrioritizedRaw, { nowMs, appData, groupSimilarStories: shouldGroupSimilar })
  );
  const dedupedTweets = applySortAndBalance(
    deduplicateAndGroupWireItems(
      teamScopedPrioritizedRaw.filter(i => i.type === 'tweet' || i.type === 'social'),
      { nowMs, preserveFormat: 'tweets', appData, groupSimilarStories: shouldGroupSimilar }
    )
  );
  const dedupedArticles = applySortAndBalance(
    deduplicateAndGroupWireItems(
      teamScopedPrioritizedRaw.filter(i => i.type === 'article' || i.type === 'post'),
      { nowMs, preserveFormat: 'articles', appData, groupSimilarStories: shouldGroupSimilar }
    )
  );
  // Highlights & Videos: strictly non-film videos + native X/ESPN/beat video & GIF highlight clips (0% overlap with Film & Trench)
  const rawHighlightsAndVideos = deduplicateAndGroupWireItems(
    teamScopedPrioritizedRaw.filter(
      i =>
        (i.type === 'video' ||
          Boolean(i.videoStreamUrl) ||
          Boolean(i.isHighlightClip && (i.videoStreamUrl || i.externalVideoUrl))) &&
        i.category !== 'film'
    ),
    { nowMs, preserveFormat: 'videos', appData, groupSimilarStories: shouldGroupSimilar }
  );
  const dedupedHighlightsAndVideos =
    activeSort === 'latest'
      ? sortNewsFeedByMode(rawHighlightsAndVideos, 'latest', { nowMs })
      : rawHighlightsAndVideos.sort(
          (a, b) =>
            scoreHighlightAndTeamVideoSalience(b, appData, nowMs) -
            scoreHighlightAndTeamVideoSalience(a, appData, nowMs)
        );
  // Film & Trench: All-22 film videos & beat GIF/video breakdowns + written film/trench/chart breakdowns (incl. league-wide analytics charts)
  const dedupedFilmVideos = deduplicateAndGroupWireItems(
    prioritizedRaw.filter(
      i => i.category === 'film' && (i.type === 'video' || Boolean(i.videoId) || Boolean(i.videoStreamUrl))
    ),
    { nowMs, preserveFormat: 'videos', appData, groupSimilarStories: shouldGroupSimilar }
  );
  const dedupedFilmArticlesAndTweets = deduplicateAndGroupWireItems(
    prioritizedRaw.filter(
      i => i.category === 'film' && i.type !== 'video' && !i.videoId && !i.videoStreamUrl
    ),
    { nowMs, appData, groupSimilarStories: shouldGroupSimilar }
  );
  const dedupedFilmAndTrench = sortNewsFeedByMode(
    [...dedupedFilmVideos, ...dedupedFilmArticlesAndTweets],
    activeSort,
    { nowMs, appData }
  );
  // Trades & Roster: Trades, official roster moves, AND salient salary cap / contract news (excluding videos to avoid redundancy)
  const dedupedTradesAndRoster = sortNewsFeedByMode(
    deduplicateAndGroupWireItems(
      teamScopedPrioritizedRaw.filter(
        i => i.type !== 'video' && (i.category === 'roster' || i.category === 'cap' || isSalientCapOrContractItem(i))
      ),
      { nowMs, appData, groupSimilarStories: shouldGroupSimilar }
    ),
    activeSort,
    { nowMs, appData }
  );

  const syncAge = lastWireSyncAt ? formatRelativeAge(lastWireSyncAt) : 'now';

  const topToolbar = `
    <div class="card subnav-card news-toolbar-card" role="navigation" aria-label="News and Film Categories">
      <div class="news-toolbar-head">
        <div class="news-toolbar-title-row">
          <div class="segmented-control news-sort-seg" role="group" aria-label="Sort News Feed" data-news-sort-bar>
            ${NEWS_SORT_MODES.map(
              m => `
                <button type="button"
                        class="pill-btn seg-btn news-sort-btn ${activeSort === m.key ? 'active' : ''}"
                        data-action="set-news-sort"
                        data-sort-mode="${esc(m.key)}"
                        title="${esc(m.title)}"
                        aria-pressed="${activeSort === m.key ? 'true' : 'false'}">
                  <span>${esc(m.label)}</span>
                </button>
              `
            ).join('')}
          </div>
          <div class="news-toolbar-actions">
            <button type="button" class="btn-ghost btn-compact" data-action="sync-live-wire-now" ${isSyncingWire ? 'disabled' : ''} title="Check live beat tweets and injury wire immediately">
              ${iconSvg('bolt', 12)}
              <span>${isSyncingWire ? 'Sync…' : esc(syncAge)}</span>
            </button>
            <button type="button" class="btn-ghost btn-compact" data-action="open-settings" data-settings-focus="sources" title="Direct X Beat Lists, News Outlets &amp; Beat Reporters">
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
    </div>
  `;

  // Compute active list for search & catch-up watermark
  const baseActivePool =
    activeFilter === 'all'
      ? dedupedRaw
      : activeFilter === 'tweets'
        ? dedupedTweets
        : activeFilter === 'articles'
          ? dedupedArticles
          : activeFilter === 'videos'
            ? dedupedHighlightsAndVideos
            : activeFilter === 'film'
              ? dedupedFilmAndTrench
              : dedupedTradesAndRoster;

  const cleanSearchQuery = String(newsSearchQuery || '').trim();
  const cleanSourceFilter =
    typeof newsSourceFilter === 'string'
      ? newsSourceFilter.trim()
      : newsSourceFilter?.name
        ? String(newsSourceFilter.name).trim()
        : '';
  const hasActiveFeedSearch = Boolean(cleanSearchQuery || cleanSourceFilter);
  const applyTopicAndSearch = list => {
    if (!hasActiveFeedSearch) return list;
    return list.filter(it =>
      matchNewsItemSearchQuery(it, cleanSearchQuery, {
        sourceFilter: cleanSourceFilter ? newsSourceFilter : null
      }).matched
    );
  };

  // Only show a slim search-clear strip below the toolbar when an active search or source filter is applied
  const activePoolMatchCount = hasActiveFeedSearch ? applyTopicAndSearch(baseActivePool).length : 0;
  const activeSearchLabelParts = [];
  if (cleanSearchQuery) activeSearchLabelParts.push(`“${cleanSearchQuery.slice(0, 22)}${cleanSearchQuery.length > 22 ? '…' : ''}”`);
  if (cleanSourceFilter) activeSearchLabelParts.push(cleanSourceFilter.slice(0, 22));
  const activeSearchStrip = hasActiveFeedSearch
    ? `
      <div class="news-digest-controls" data-news-digest-controls>
        <div class="news-sort-row">
          <button type="button" class="pill-btn active news-search-active-pill" data-action="clear-news-search-filter" title="Clear feed search filter">
            <span>${esc(activeSearchLabelParts.join(' • '))} (${activePoolMatchCount})</span>
            ${iconSvg('close', 11)}
          </button>
          <button type="button" class="btn-ghost btn-compact" data-action="open-search" title="Edit search">
            ${iconSvg('search', 11)}
            <span>Edit</span>
          </button>
        </div>
      </div>
    `
    : '';

  const renderWireListWithWatermark = (items, { isLeadFirst = false } = {}) => {
    const catchUp = computeCatchUpState(
      items,
      { lastVisitedAt: sessionLastVisitedAt, readKeys: readKeysSet },
      nowMs
    );
    const catchUpBarHtml = catchUp.hasWatermark
      ? `
        <div class="catchup-bar" data-catchup-bar>
          <span class="catchup-bar-text">
            <span class="new-item-dot" aria-hidden="true"></span>
            <strong>${catchUp.newCount} new</strong> since ${esc(catchUp.lastVisitedLabel)}
          </span>
          <button type="button" class="btn-ghost btn-compact catchup-mark-btn" data-action="mark-all-caught-up">
            ${iconSvg('checkDouble', 12)}
            <span>Caught up</span>
          </button>
        </div>
      `
      : '';

    const cardsHtml = items
      .slice(0, 120)
      .map((item, idx) => {
        const key = getItemReadKey(item);
        const isNewSinceVisit = catchUp.hasWatermark && catchUp.newItemKeys.has(key);
        const dividerHtml =
          catchUp.hasWatermark &&
          activeSort !== 'top' &&
          catchUp.watermarkInsertBeforeIdx === idx &&
          idx > 0
            ? `<div class="catchup-divider" data-catchup-divider><span>Earlier coverage</span></div>`
            : '';
        return `${dividerHtml}${renderWireItemCardHtml(item, {
          prioritizedRaw,
          activeVideosSet,
          rosterPlayers: appData?.roster?.players || [],
          isLeadFeatured: isLeadFirst && idx === 0,
          eagerImage: idx < 2,
          readKeysSet,
          isCompactMode,
          isNewSinceVisit
        })}`;
      })
      .join('');

    return `${catchUpBarHtml}<div class="card ${isCompactMode ? 'wire-list-compact' : ''}" style="display:flex;flex-direction:column;gap:${isCompactMode ? '6px' : '9px'}">${cardsHtml}</div>`;
  };

  if (activeFilter === 'all') {
    const dailyBrief =
      appData?.news?.dailyTopNewsBrief || buildDeterministicDailyTopNewsBrief(appData, nowMs);
    // Keep ALL game-day news above yesterday's AI summary until a real post-game AI summary
    // (`live-gemini-daily` or `pipeline-gemini-daily`) has actually been created!
    const requireAiPostGameBrief = true;
    const isNarrowedByTopicOrSearch = Boolean(cleanSearchQuery);
    const scopedRaw = applyTopicAndSearch(dedupedRaw);

    if (isNarrowedByTopicOrSearch) {
      const filteredAllHtml =
        scopedRaw.length === 0
          ? `<div class="card">No feed items match this topic or search filter.</div>`
          : renderWireListWithWatermark(scopedRaw, { isLeadFirst: true });
      return `${topToolbar}${activeSearchStrip}${filteredAllHtml}`;
    }

    const {
      breakingAboveBrief,
      remainingBelowBrief,
      gameDayLiveMode
    } = partitionBreakingNewsAboveBrief(scopedRaw, dailyBrief, nowMs, {
      appData,
      promoteAllGameDayNews: true,
      requireAiPostGameBrief
    });

    const rosterPlayers = appData?.roster?.players || [];
    const breakingTopHtml =
      breakingAboveBrief.length > 0
        ? `
          <div class="card breaking-above-brief-card${gameDayLiveMode ? ' gameday-live-above-card' : ''}" data-breaking-above-brief${gameDayLiveMode ? ' data-gameday-live-above-brief="true"' : ''} style="display:flex;flex-direction:column;gap:9px">
            ${breakingAboveBrief
              .slice(0, 200)
              .map((item, idx) =>
                renderWireItemCardHtml(item, {
                  prioritizedRaw,
                  activeVideosSet,
                  rosterPlayers,
                  isLeadFeatured: idx === 0,
                  eagerImage: idx < 2,
                  readKeysSet,
                  isCompactMode
                })
              )
              .join('')}
          </div>
        `
        : '';

    const briefHtml = renderDailyTopNewsBriefHtml(dailyBrief, {
      rawStream: teamScopedPrioritizedRaw,
      appData,
      asSubcard: false,
      readKeysSet
    });

    const presserTakeaways = extractPresserTakeaways(teamScopedPrioritizedRaw, { nowMs });
    const presserStripHtml = renderPresserTakeawaysStripHtml(presserTakeaways);

    const belowListHtml =
      remainingBelowBrief.length === 0
        ? `<div class="card">No additional feed items match your active source filters.</div>`
        : renderWireListWithWatermark(remainingBelowBrief, { isLeadFirst: false });

    return `${topToolbar}${activeSearchStrip}${breakingTopHtml}${briefHtml}${presserStripHtml}${belowListHtml}`;
  }

  const visibleFiltered = applyTopicAndSearch(baseActivePool);

  const filteredListHtml =
    visibleFiltered.length === 0
      ? `<div class="card">No feed items match your active filters.</div>`
      : renderWireListWithWatermark(visibleFiltered, {
          isLeadFirst: activeFilter !== 'videos'
        });

  return `${topToolbar}${activeSearchStrip}${filteredListHtml}`;
}

export function renderVideoEmbedOrFacade(
  vidKey,
  videoId,
  startSec = 0,
  label = 'Watch Video',
  channel = 'YouTube',
  isPlaying = false,
  embeddable = true,
  {
    compactFooter = false,
    videoStreamUrl = '',
    posterUrl = '',
    externalWatchUrl = '',
    isAnimatedGif = false,
    durationLabel = ''
  } = {}
) {
  const safeStreamUrl =
    videoStreamUrl && /^https:\/\//i.test(String(videoStreamUrl)) ? String(videoStreamUrl).trim() : '';

  if (!videoId && safeStreamUrl) {
    const isGif = Boolean(
      isAnimatedGif || /\/tweet_video\//i.test(safeStreamUrl) || /\.gif(?:\?|$)/i.test(safeStreamUrl)
    );
    const isRawGifImage = /\.gif(?:\?|$)/i.test(safeStreamUrl);
    const rawPoster = posterUrl && /^https:\/\//i.test(String(posterUrl)) ? String(posterUrl).trim() : '';
    const optPoster = rawPoster ? optimizeImageUrlForSlot(rawPoster, 'hero') : { src: '', fallbackSrc: '' };
    const safePoster = optPoster.src || rawPoster;
    const posterFallbackAttr = optPoster.fallbackSrc ? `data-fallback-src="${esc(optPoster.fallbackSrc)}"` : '';
    const safeOutUrl = sanitizeExternalUrl(externalWatchUrl, safeStreamUrl) || safeStreamUrl;
    const activeClubDomain = String(getActiveTeamConfig()?.clubDomain || '49ers.com').trim();
    const clubDomainRe = new RegExp(activeClubDomain.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    const providerLabel = /x\.com|twimg\.com/i.test(`${safeOutUrl} ${safeStreamUrl}`)
      ? 'X'
      : clubDomainRe.test(`${safeOutUrl} ${safeStreamUrl}`)
        ? activeClubDomain
        : /bsky\.app|bsky\.network/i.test(`${safeOutUrl} ${safeStreamUrl}`)
          ? 'Bluesky'
          : /tenor\.com|giphy\.com/i.test(`${safeOutUrl} ${safeStreamUrl}`)
            ? 'GIF'
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
                  : `<div class="video-thumb-img" style="background:linear-gradient(135deg,var(--bg-card-alt),var(--bg-primary));min-height:165px"></div>`
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
      if (isRawGifImage) {
        return `
          <div class="video-embed-box" data-inline-gif-player="true">
            <div class="video-iframe-wrap">
              <img src="${esc(safeStreamUrl)}" alt="${esc(label)}" class="inline-gif-img" decoding="async" />
              <span class="video-gif-badge mono">GIF</span>
            </div>
            <div class="video-launch-bar">
              <span class="inline-icon-meta" style="min-width:0" data-vid-status-label="${esc(vidKey)}">${iconSvg('video', 14)}<span>Playing GIF Inline</span></span>
              <a href="${esc(safeOutUrl)}" target="_blank" rel="noopener noreferrer" class="ext-link" style="flex-shrink:0">Open on ${esc(providerLabel)} ${iconSvg('externalLink', 12)}</a>
            </div>
          </div>
        `;
      }
      return `
        <div class="video-embed-box"${isGif ? ' data-inline-gif-player="true"' : ''}>
          <div class="video-iframe-wrap">
            <video src="${esc(safeStreamUrl)}" ${safePoster ? `poster="${esc(safePoster)}"` : ''} data-vid-key="${esc(vidKey)}" data-watch-url="${esc(safeOutUrl)}" data-provider="${esc(providerLabel)}"${isGif ? ' data-is-gif="1" loop muted' : ''} controls autoplay playsinline preload="auto"></video>
            ${isGif ? '<span class="video-gif-badge mono">GIF</span>' : ''}
          </div>
          <div class="video-launch-bar">
            <span class="inline-icon-meta" style="min-width:0" data-vid-status-label="${esc(vidKey)}">${iconSvg('video', 14)}<span>${isGif ? 'Playing GIF Inline' : 'Playing Inline'}</span></span>
            <a href="${esc(safeOutUrl)}" target="_blank" rel="noopener noreferrer" class="ext-link" style="flex-shrink:0">Open on ${esc(providerLabel)} ${iconSvg('externalLink', 12)}</a>
          </div>
        </div>
      `;
    }

    const cornerBadgeHtml = isGif
      ? '<span class="video-gif-badge mono">GIF</span>'
      : durationLabel
        ? `<span class="video-dur-badge mono">${esc(durationLabel)}</span>`
        : '';

    return `
      <div class="video-embed-box"${isGif ? ' data-gif-facade="true"' : ''}>
        <div class="video-thumb-stage" style="cursor:pointer" data-action="play-inline-video" data-vid-key="${esc(vidKey)}">
          ${
            safePoster
              ? `<img src="${esc(safePoster)}" ${posterFallbackAttr} alt="${esc(label)}" class="video-thumb-img" loading="lazy" decoding="async" />`
              : `<div class="video-thumb-img" style="background:linear-gradient(135deg,var(--bg-card-alt),var(--bg-primary));min-height:165px"></div>`
          }
          ${cornerBadgeHtml}
          <div class="video-thumb-overlay">
            <button type="button" class="video-play-pill" data-action="play-inline-video" data-vid-key="${esc(vidKey)}">
              ${iconSvg('play', 14)}
              <span>${isGif ? 'Play GIF' : 'Play'}</span>
            </button>
          </div>
        </div>
        <div class="video-launch-bar" style="justify-content:flex-end">
          <a href="${esc(safeOutUrl)}" target="_blank" rel="noopener noreferrer" class="ext-link" style="flex-shrink:0">${esc(providerLabel)} ${iconSvg('externalLink', 12)}</a>
        </div>
      </div>
    `;
  }

  if (!videoId) return '';

  const safeId = encodeURIComponent(videoId);
  const startNum = Number(startSec || 0);
  const watchUrl = `https://www.youtube.com/watch?v=${safeId}${startNum > 0 ? `&t=${startNum}s` : ''}`;
  const thumbUrl = `https://i.ytimg.com/vi/${safeId}/hqdefault.jpg`;

  // Official NFL / club / Content-ID restricted videos block 3rd-party domain iframes (emb_err_woyt).
  // Render a crisp HD thumbnail preview card that opens cleanly on YouTube instead of a broken iframe!
  const ytDurationBadgeHtml = durationLabel
    ? `<span class="video-dur-badge mono">${esc(durationLabel)}</span>`
    : '';
  if (embeddable === false || isYouTubeVideoKnownBlocked(videoId)) {
    return `
      <div class="video-embed-box" data-yt-external-only="true" data-yt-video-id="${esc(videoId)}">
        <a href="${esc(watchUrl)}" target="_blank" rel="noopener noreferrer" class="video-external-card" aria-label="Watch ${esc(label)} on YouTube">
          <div class="video-thumb-stage">
            <img src="${esc(thumbUrl)}" alt="${esc(label)}" class="video-thumb-img" loading="lazy" decoding="async" />
            ${ytDurationBadgeHtml}
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
                    <div style="font-weight:700;font-size:12.5px;color:var(--gold-bright);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(label)}</div>
                    <div style="font-size:11px;color:var(--text-muted)">${esc(channel || 'YouTube')}</div>
                  </div>
                  <span class="source-chip-link"><span>YouTube</span>${iconSvg('externalLink', 11)}</span>
                </div>`
          }
        </a>
      </div>
    `;
  }

  if (isPlaying) {
    const safeOrigin =
      typeof window !== 'undefined' && window.location?.origin && /^https?:\/\//i.test(window.location.origin)
        ? `&origin=${encodeURIComponent(window.location.origin)}`
        : '';
    const src = `https://www.youtube.com/embed/${safeId}?start=${startNum}&autoplay=1&rel=0&playsinline=1&enablejsapi=1${safeOrigin}`;
    return `
      <div class="video-embed-box" data-yt-embed-box="true" data-yt-video-id="${esc(videoId)}">
        <div class="video-iframe-wrap">
          <iframe src="${src}" title="${esc(label)}" data-yt-iframe="1" data-yt-video-id="${esc(videoId)}" data-vid-key="${esc(vidKey)}" data-watch-url="${esc(watchUrl)}" data-yt-title="${esc(label)}" data-yt-channel="${esc(channel || 'YouTube')}" data-yt-compact="${compactFooter ? '1' : '0'}" referrerpolicy="strict-origin-when-cross-origin" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" allowfullscreen></iframe>
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
        ${ytDurationBadgeHtml}
        <div class="video-thumb-overlay">
          <button type="button" class="video-play-pill" data-action="play-inline-video" data-vid-key="${esc(vidKey)}">
            ${iconSvg('play', 14)}
            <span>Play</span>
          </button>
        </div>
      </div>
      ${
        compactFooter
          ? `<div class="video-launch-bar" style="justify-content:flex-end">
              <a href="${esc(watchUrl)}" target="_blank" rel="noopener noreferrer" class="ext-link" style="flex-shrink:0">YouTube ${iconSvg('externalLink', 12)}</a>
            </div>`
          : `<div class="video-launch-bar">
              <div style="min-width:0">
                <div style="font-weight:700;font-size:12.5px;color:var(--gold-bright);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(label)}</div>
                <div style="font-size:11px;color:var(--text-muted)">${esc(channel || 'YouTube Film & Podium')}</div>
              </div>
              <a href="${esc(watchUrl)}" target="_blank" rel="noopener noreferrer" class="ext-link" style="flex-shrink:0">YouTube ${iconSvg('externalLink', 12)}</a>
            </div>`
      }
    </div>
  `;
}
