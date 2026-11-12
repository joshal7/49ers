/**
 * Unified High-Signal Team News, Daily Gemini 3.8 Flash High Top-News Brief,
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
  registerRosterPlayersForInlineLinks
} from './uiHelpers.js';
import { iconSvg } from './icons.js';
import {
  SHORT_TWEET_FULL_TEXT_LIMIT,
  isUrgentBreakingBadge,
  isSalientCapOrContractItem,
  sortNewsWithBreakingPriority,
  deduplicateAndGroupWireItems,
  balanceFeedTopSalience,
  stripRedundantAuthorBoilerplate,
  isRedundantProfileSelfLink,
  formatTweetBodyForDisplay,
  isStaleCompletedGameAvailabilityItem,
  filterOutCompletedGameAvailabilityItems,
  filterFreshVideosForCurrentSlate,
  scoreHighlightAndTeamVideoSalience,
  partitionBreakingNewsAboveBrief
} from '../engine/breakingClassifier.js';
import { isPaywalledPublisher, sanitizeExternalUrl } from '../engine/linkIntegrity.js';
import {
  buildXBeatListSearchUrl,
  resolveItemAuthorProfileUrl,
  resolveOriginalTweetUrl
} from '../engine/beatAttributionEngine.js';
import { buildDeterministicDailyTopNewsBrief } from '../services/aiWorkerClient.js';

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

  for (const sl of rawSources) {
    if (!sl) continue;
    const rawTitle = decodeInlineEntities(String(sl.title || ''));
    const isTw =
      sl.type === 'tweet' ||
      sl.type === 'social' ||
      /^@[A-Za-z0-9_]+:/.test(rawTitle) ||
      /^https?:\/\/(?:www\.)?(?:x|twitter|bsky)\./i.test(String(sl.url || ''));
    const handleMatch = rawTitle.match(/^(@[A-Za-z0-9_]+):\s*(.*)$/);
    const effectiveHandle = sl.authorHandle || (handleMatch ? handleMatch[1] : '');
    const cleanTitle = handleMatch ? handleMatch[2].trim() : rawTitle.trim();

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

    const resolvedUrl = isTw
      ? resolveOriginalTweetUrl(
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
        )
      : sl.url;

    const safeUrl = sanitizeExternalUrl(resolvedUrl, null);
    const dedupKey =
      safeUrl && safeUrl.includes('x.com/search?')
        ? `${safeUrl}::${cleanTitle.toLowerCase().slice(0, 50)}`
        : safeUrl;
    if (!safeUrl || seen.has(dedupKey) || isPaywalledPublisher(sl.outlet, safeUrl)) continue;
    seen.add(dedupKey);

    safeList.push({
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
export function renderBriefProseWithInlineLinksHtml(text = '', seenJargon = null) {
  const rawInput = String(text || '').trim();
  if (!rawInput) return '';

  // Clean up any wrapping parentheses or "per / via / according to" prefixes around inline links
  const raw = rawInput
    .replace(/,?\s*\b(?:per|via|according to)\s+\(\s*(\[[^\]]{1,80}\]\(https:\/\/[^)\s]+\))\s*\)/gi, ' $1')
    .replace(/,?\s*\b(?:per|via|according to)\s+(\[[^\]]{1,80}\]\(https:\/\/[^)\s]+\))/gi, ' $1')
    .replace(/\(\s*(\[[^\]]{1,80}\]\(https:\/\/[^)\s]+\))\s*\)/g, '$1')
    .replace(/\s+([,.;:!?])/g, '$1');

  const opts = { maxTerms: 14, maxPlayers: 5, seenKeys: seenJargon };
  const linkRe = /\[([^\]]{1,80})\]\((https:\/\/[^)\s]+)\)/g;

  let outHtml = '';
  let lastIdx = 0;
  let match;
  while ((match = linkRe.exec(raw)) !== null) {
    if (match.index > lastIdx) {
      outHtml += escJargon(raw.slice(lastIdx, match.index), opts);
    }
    const label = decodeInlineEntities(match[1]).trim();
    const safeUrl = sanitizeExternalUrl(match[2], null);
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

function formatDailyBriefBulletHtml(bullet = '', seenJargon = null) {
  const raw = String(bullet || '').trim();
  if (!raw) return '';
  const colonIdx = raw.indexOf(':');
  // Avoid splitting inside a markdown URL `https://` by checking `[` before colon
  const bracketBeforeColon = colonIdx > 0 ? raw.slice(0, colonIdx).includes('[') : false;
  if (colonIdx > 0 && colonIdx <= 78 && !bracketBeforeColon) {
    const headClean = raw.slice(0, colonIdx).replace(/\*\*/g, '').trim();
    const bodyClean = raw.slice(colonIdx + 1).replace(/^\*\*\s*/, '').trim();
    return `<li><strong>${escJargon(headClean, { maxTerms: 6, maxPlayers: 2, seenKeys: seenJargon })}:</strong> ${renderBriefProseWithInlineLinksHtml(bodyClean, seenJargon)}</li>`;
  }
  return `<li>${renderBriefProseWithInlineLinksHtml(raw, seenJargon)}</li>`;
}

/**
 * Renders the 1/day Gemini 3.8 Flash High Top-News Brief card (shared identically between
 * the top of `News & Film -> All` and the top of the `Home` screen).
 */
export function renderDailyTopNewsBriefHtml(
  dailyBrief,
  { rawStream = [], appData = null, asSubcard = false } = {}
) {
  const brief =
    dailyBrief && typeof dailyBrief === 'object' && Array.isArray(dailyBrief.bullets) && dailyBrief.bullets.length > 0
      ? dailyBrief
      : buildDeterministicDailyTopNewsBrief(appData);
  if (!brief) return '';

  const seenJargon = new Set();
  const safeSources = resolveDailyBriefSafeSources(brief, rawStream, appData);
  const ageTiny = brief.generatedAt ? formatRelativeAge(brief.generatedAt) : 'now';
  const tagName = asSubcard ? 'div' : 'section';
  const outerCls = asSubcard
    ? 'subcard-panel daily-news-brief-card daily-news-brief-subcard'
    : 'card daily-news-brief-card';

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
                  return `
                    <a href="${esc(rep.url)}" target="_blank" rel="noopener noreferrer" class="synthesis-source-sheet-row" data-brief-source-row>
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
      <p class="coaching-thesis-copy daily-brief-summary">${renderBriefProseWithInlineLinksHtml(brief.summary || '', seenJargon)}</p>
      <ul class="brief-bullets coaching-bullets daily-brief-bullets">
        ${(brief.bullets || []).map(b => formatDailyBriefBulletHtml(b, seenJargon)).join('')}
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
  if (isVideo) {
    const title = String(item?.title || '');
    const isInterviewClip = /\b(press conference|reflects on|chats about|previews week|shares final updates|speak ahead|talk new additions|on first career touchdown|you['’]?ve got mail|inside the oval)\b/i.test(
      title
    );
    const hasPlayerFocus =
      (item?.mentionedPlayers?.length || 0) > 0 ||
      /\b(best plays|every completed pass|every throw|pick[- ]?6|interceptions?)\b/i.test(title);
    if (
      !isInterviewClip &&
      hasPlayerFocus &&
      /\b(highlights|best plays|every completed pass|every throw|every catch|rushing|pick[- ]?6|interceptions?|touchdown|big catch|sacks?)\b/i.test(
        title
      )
    ) {
      return `<span class="badge badge-scarlet">${iconSvg('video', 11)}<span>Player Highlights</span></span>`;
    }
    if (!isInterviewClip && /\b(highlights|best plays|top plays|every touchdown|condensed game)\b/i.test(title)) {
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

export function renderWireItemCardHtml(item, { prioritizedRaw = [], activeVideosSet = new Set() } = {}) {
  const vidKey = item.videoId ? `raw_${item.id}` : null;
  const isVidOpen = vidKey && activeVideosSet.has(vidKey);
  const isTweet = item.type === 'tweet' || item.type === 'social';
  const isVideo = item.type === 'video';
  const isUrgent = isUrgentBreakingBadge(item.breakingBadge);

  const authorName = item.author || item.reporterName || item.outletName || '49ers Beat';
  const resolvedItemUrl = isTweet
    ? sanitizeExternalUrl(resolveOriginalTweetUrl(item, prioritizedRaw), null)
    : sanitizeExternalUrl(item.url, null);
  const authorHref = sanitizeExternalUrl(
    resolveItemAuthorProfileUrl(item, resolvedItemUrl),
    resolvedItemUrl
  );
  const rawBody = isTweet
    ? stripRedundantAuthorBoilerplate(item.fullText || item.title || '', authorName)
    : item.title || '';
  const displayTitle = isTweet
    ? formatTweetBodyForDisplay(rawBody, SHORT_TWEET_FULL_TEXT_LIMIT).text
    : rawBody;

  const cleanSummary =
    !isVideo &&
    !isTweet &&
    item.summary &&
    !item.summary.startsWith('Published via ') &&
    item.summary.toLowerCase() !== `${authorName} • ${item.outletName || ''}`.toLowerCase()
      ? stripRedundantAuthorBoilerplate(item.summary, authorName)
      : '';

  const hasThumb = !isVideo && item.imageUrl && /^https:\/\//i.test(item.imageUrl);
  const safeExtUrl = sanitizeExternalUrl(item.externalUrl, null);
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
    <div class="brief-card ${isUrgent ? 'breaking-elevated' : ''}" data-raw-type="${esc(item.type || 'article')}" data-raw-category="${esc(item.category || 'beat')}">
      <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap">
        <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;min-width:0">
          ${renderWireSignalBadgeHtml(item, isVideo, isTweet)}
          ${
            authorHref
              ? `<a href="${esc(authorHref)}" target="_blank" rel="noopener noreferrer" class="wire-author-single-link" data-wire-author-link><strong>${esc(authorName)}</strong></a>`
              : `<strong style="font-size:12.5px;color:var(--gold-bright)">${esc(authorName)}</strong>`
          }
        </div>
        <span class="mono" style="font-size:11.5px;color:var(--text-muted);flex-shrink:0" data-wire-age>${isVideo && item.duration ? `${esc(item.duration)} • ` : ''}${esc(formatRelativeAge(item.publishedAt))}</span>
      </div>
      <div class="${hasThumb ? 'media-split-row' : ''}">
        <div style="min-width:0;display:flex;flex-direction:column;gap:4px">
          <div style="font-weight:${isTweet ? '600' : '700'};font-size:13.6px;line-height:1.42">
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
        ${
          hasThumb && (resolvedItemUrl || sanitizeExternalUrl(item.externalUrl, null))
            ? `<a href="${esc(resolvedItemUrl || sanitizeExternalUrl(item.externalUrl))}" target="_blank" rel="noopener noreferrer" class="raw-item-thumb" aria-hidden="true" tabindex="-1">
                <img src="${esc(item.imageUrl)}" alt="${esc(displayTitle)}" width="72" height="72" loading="lazy" decoding="async" />
              </a>`
            : hasThumb
              ? `<div class="raw-item-thumb" aria-hidden="true">
                  <img src="${esc(item.imageUrl)}" alt="${esc(displayTitle)}" width="72" height="72" loading="lazy" decoding="async" />
                </div>`
              : ''
        }
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
        item.videoId
          ? renderVideoEmbedOrFacade(
              vidKey,
              item.videoId,
              0,
              item.title || `Watch Clip (${item.duration || 'Video'})`,
              item.outletName,
              isVidOpen,
              item.embeddable !== false,
              { compactFooter: true }
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
  isSyncingWire = false
}) {
  registerRosterPlayersForInlineLinks(appData?.roster?.players);
  const activeFilter = ['all', 'tweets', 'articles', 'videos', 'film', 'roster'].includes(newsCategoryFilter)
    ? newsCategoryFilter
    : 'all';
  const mutedCount =
    (userPrefs?.disabledReporterIds?.length || 0) + (userPrefs?.disabledOutlets?.length || 0);

  const nowMs = Date.now();
  const rawAfterAvailabilityHide = filterFreshVideosForCurrentSlate(
    filterOutCompletedGameAvailabilityItems(filteredRawItems || [], appData, nowMs),
    appData,
    nowMs
  );
  const prioritizedRaw = sortNewsWithBreakingPriority(
    rawAfterAvailabilityHide.filter(i => {
      if (i.type === 'video' && i.videoId) return true;
      return Boolean(sanitizeExternalUrl(i.url, null)) && !isPaywalledPublisher(i.outletName, i.url);
    }),
    nowMs,
    { appData }
  );

  const dedupedRaw = balanceFeedTopSalience(deduplicateAndGroupWireItems(prioritizedRaw, { nowMs }), {
    nowMs,
    appData
  });
  const dedupedTweets = deduplicateAndGroupWireItems(
    prioritizedRaw.filter(i => i.type === 'tweet' || i.type === 'social'),
    { nowMs, preserveFormat: 'tweets' }
  );
  const dedupedArticles = deduplicateAndGroupWireItems(
    prioritizedRaw.filter(i => i.type === 'article' || i.type === 'post'),
    { nowMs, preserveFormat: 'articles' }
  );
  // Highlights & Videos: strictly non-film videos (0% overlap with Film & Trench), ranked by Highlight & Team-Video salience!
  const dedupedHighlightsAndVideos = deduplicateAndGroupWireItems(
    prioritizedRaw.filter(i => i.type === 'video' && i.category !== 'film'),
    { nowMs, preserveFormat: 'videos' }
  ).sort(
    (a, b) =>
      scoreHighlightAndTeamVideoSalience(b, appData, nowMs) -
      scoreHighlightAndTeamVideoSalience(a, appData, nowMs)
  );
  // Film & Trench: All-22 film videos (incl. JT O'Sullivan's The QB School & Jonnydel) + written film/trench breakdowns
  const dedupedFilmAndTrench = deduplicateAndGroupWireItems(
    prioritizedRaw.filter(i => i.category === 'film'),
    { nowMs }
  );
  // Trades & Roster: Trades, official roster moves, AND salient salary cap / contract news (excluding videos to avoid redundancy)
  const dedupedTradesAndRoster = deduplicateAndGroupWireItems(
    prioritizedRaw.filter(
      i => i.type !== 'video' && (i.category === 'roster' || i.category === 'cap' || isSalientCapOrContractItem(i))
    ),
    { nowMs }
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
    const { breakingAboveBrief, remainingBelowBrief } = partitionBreakingNewsAboveBrief(
      dedupedRaw,
      dailyBrief,
      nowMs
    );

    const breakingTopHtml =
      breakingAboveBrief.length > 0
        ? `
          <div class="card breaking-above-brief-card" data-breaking-above-brief style="display:flex;flex-direction:column;gap:9px">
            ${breakingAboveBrief
              .map(item => renderWireItemCardHtml(item, { prioritizedRaw, activeVideosSet }))
              .join('')}
          </div>
        `
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
              .map(item => renderWireItemCardHtml(item, { prioritizedRaw, activeVideosSet }))
              .join('')}
          </div>
        `;

    return `${topToolbar}${breakingTopHtml}${briefHtml}${belowListHtml}`;
  }

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
            .map(item => renderWireItemCardHtml(item, { prioritizedRaw, activeVideosSet }))
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
  { compactFooter = false } = {}
) {
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
