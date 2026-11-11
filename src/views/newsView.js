/**
 * Team News, Beat Reporter Synthesis, Live Tweets & Playable Video Clip View
 * Modes: "Beat Synthesis Briefs" (Default) vs. "Live Tweets, Articles & Video"
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
  sortNewsWithBreakingPriority,
  deduplicateAndGroupWireItems,
  balanceFeedTopSalience,
  stripRedundantAuthorBoilerplate,
  isRedundantProfileSelfLink,
  formatTweetBodyForDisplay,
  isStaleCompletedGameAvailabilityItem,
  filterOutCompletedGameAvailabilityItems,
  filterAndCleanSynthesisClusters
} from '../engine/breakingClassifier.js';
import { isPaywalledPublisher, sanitizeExternalUrl } from '../engine/linkIntegrity.js';
import {
  buildXBeatListSearchUrl,
  resolveItemAuthorProfileUrl,
  resolveOriginalTweetUrl
} from '../engine/beatAttributionEngine.js';

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

export function resolveClusterSafeReports(cluster, rawStream = [], appData = null) {
  if (!cluster || !Array.isArray(cluster.sourceLinks)) return [];
  const seen = new Set();
  const reports = [];
  for (const sl of cluster.sourceLinks) {
    if (!sl) continue;
    const rawSlTitle = decodeInlineEntities(String(sl.title || ''));
    const isTw =
      sl.type === 'tweet' ||
      sl.type === 'social' ||
      /^@[A-Za-z0-9_]+:/.test(rawSlTitle) ||
      /^https?:\/\/bsky\.app\//i.test(String(sl.url || ''));
    const handleMatch = rawSlTitle.match(/^(@[A-Za-z0-9_]+):\s*(.*)$/);
    const effectiveHandle = sl.authorHandle || (handleMatch ? handleMatch[1] : '');
    const cleanTitle = handleMatch ? handleMatch[2].trim() : rawSlTitle.trim();

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
            publishedAt: sl.publishedAt || cluster.publishedAt || ''
          },
          rawStream
        )
      : sl.url;

    const safeUrl = sanitizeExternalUrl(resolvedUrl, null);
    const dedupKey = safeUrl && safeUrl.includes('x.com/search?')
      ? `${safeUrl}::${cleanTitle.toLowerCase().slice(0, 50)}`
      : safeUrl;
    if (!safeUrl || seen.has(dedupKey) || isPaywalledPublisher(sl.outlet, safeUrl)) continue;
    seen.add(dedupKey);

    reports.push({
      title: cleanTitle || sl.outlet || 'Open Report',
      url: safeUrl,
      outlet: sl.outlet || '49ers Beat',
      author: sl.author || (effectiveHandle ? effectiveHandle : sl.outlet || '49ers Beat'),
      type: isTw ? 'tweet' : sl.type || 'article',
      publishedAt: sl.publishedAt || null
    });
  }
  return reports;
}

export function renderSynthesisSourcesSheetHtml(cluster, rawStream = [], appData = null) {
  if (!cluster) {
    return `<div class="subcard-panel">Synthesis story not found.</div>`;
  }
  const reports = resolveClusterSafeReports(cluster, rawStream, appData);
  return `
    <div style="display:flex;flex-direction:column;gap:10px" data-synthesis-sources-sheet="${esc(cluster.id)}">
      <div class="subcard-panel" style="border-color:var(--gold-border)">
        <div class="card-eyebrow" style="margin-bottom:3px">${esc(cluster.categoryLabel || 'AI Synthesis Story')}</div>
        <div style="font-weight:700;font-size:13.5px;line-height:1.38;color:var(--text-primary)">${esc(cluster.headline)}</div>
      </div>

      ${
        reports.length === 0
          ? `<div class="subcard-panel" style="font-size:12.5px;color:var(--text-muted)">No external report links attached to this brief.</div>`
          : `<div style="display:flex;flex-direction:column;gap:7px">
              ${reports
                .map(rep => {
                  const typeLabel =
                    rep.type === 'tweet'
                      ? 'Tweet'
                      : rep.type === 'video'
                        ? 'Video'
                        : rep.type === 'cap'
                          ? 'Cap Ledger'
                          : rep.type === 'stats'
                            ? 'Dataset'
                            : 'Article';
                  const badgeCls =
                    rep.type === 'tweet'
                      ? 'badge-gold'
                      : rep.type === 'video'
                        ? 'badge-scarlet'
                        : 'badge-neutral';
                  const attribution =
                    rep.author && rep.outlet && rep.author.toLowerCase() !== rep.outlet.toLowerCase()
                      ? `${rep.author} • ${rep.outlet}`
                      : rep.outlet || rep.author || 'Source';
                  return `
                    <a href="${esc(rep.url)}" target="_blank" rel="noopener noreferrer" class="synthesis-source-sheet-row" data-synthesis-report-link>
                      <div style="display:flex;justify-content:space-between;align-items:center;gap:6px;flex-wrap:wrap;margin-bottom:4px">
                        <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;min-width:0">
                          <span class="badge ${badgeCls}" style="font-size:10px;padding:1.5px 6px">${esc(typeLabel)}</span>
                          <strong style="font-size:11.8px;color:var(--gold-bright)">${esc(attribution)}</strong>
                        </div>
                        ${rep.publishedAt ? `<span class="mono" style="font-size:10.8px;color:var(--text-muted)">${esc(formatRelativeAge(rep.publishedAt))}</span>` : ''}
                      </div>
                      <div style="font-size:12.8px;font-weight:600;line-height:1.38;color:var(--text-primary)">
                        ${esc(rep.title)} ${iconSvg('externalLink', 11)}
                      </div>
                    </a>
                  `;
                })
                .join('')}
            </div>`
      }
    </div>
  `;
}

export function renderNewsViewHtml({
  appData = null,
  newsMode = 'raw', // 'raw' | 'clustered'
  newsCategoryFilter, // 'all' | 'tweets' | 'videos' | 'film' | 'cap' | 'scheme' | 'roster' | 'beat'
  filteredClusters,
  filteredRawItems,
  reportersById,
  activeVideosSet,
  userPrefs,
  lastWireSyncAt = null,
  isSyncingWire = false
}) {
  registerRosterPlayersForInlineLinks(appData?.roster?.players);
  const mutedCount =
    (userPrefs?.disabledReporterIds?.length || 0) + (userPrefs?.disabledOutlets?.length || 0);

  const activeClusters = filterAndCleanSynthesisClusters(filteredClusters || [], appData);
  const rawAfterAvailabilityHide = filterOutCompletedGameAvailabilityItems(filteredRawItems || [], appData);
  const prioritizedRaw = sortNewsWithBreakingPriority(
    rawAfterAvailabilityHide.filter(i => {
      if (i.type === 'video' && i.videoId) return true;
      return Boolean(sanitizeExternalUrl(i.url, null)) && !isPaywalledPublisher(i.outletName, i.url);
    }),
    Date.now(),
    { appData }
  );
  const dedupedRaw = balanceFeedTopSalience(deduplicateAndGroupWireItems(prioritizedRaw), { appData });
  const tweetCount = dedupedRaw.filter(i => i.type === 'tweet' || i.type === 'social').length;
  const activeBreakingItems = dedupedRaw.filter(i => (i.breakingPriority || 0) > 0).slice(0, 3);
  const syncAge = lastWireSyncAt ? formatRelativeAge(lastWireSyncAt) : 'now';

  const topToolbar = `
    <div class="card news-toolbar-card">
      <div class="news-toolbar-head">
        <div class="news-toolbar-title-row">
          <div class="news-toolbar-brand">
            <div class="card-icon-badge compact" aria-hidden="true">${iconSvg('news', 15)}</div>
            <h2 class="card-title">Wire &amp; Film</h2>
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

      <div class="segmented-control compact-seg" role="tablist" aria-label="News Feed Mode">
        <button type="button" role="tab" aria-selected="${newsMode === 'raw' ? 'true' : 'false'}" class="pill-btn seg-btn ${newsMode === 'raw' ? 'active' : ''}" data-action="set-news-mode" data-mode="raw">
          ${iconSvg('bolt', 13)}
          <span>Wire &amp; Video (${dedupedRaw.length})</span>
        </button>
        <button type="button" role="tab" aria-selected="${newsMode === 'clustered' ? 'true' : 'false'}" class="pill-btn seg-btn ${newsMode === 'clustered' ? 'active' : ''}" data-action="set-news-mode" data-mode="clustered">
          ${iconSvg('sparkles', 13)}
          <span>Synthesis Briefs (${activeClusters.length})</span>
        </button>
      </div>

      <div class="pill-bar" aria-label="News Category Filter">
        ${(newsMode === 'raw'
          ? [
              ['all', `All (${dedupedRaw.length})`],
              ['tweets', `Tweets (${tweetCount})`],
              ['articles', 'Articles'],
              ['videos', 'Videos'],
              ['film', 'Film & Trench'],
              ['roster', 'Trades & Roster']
            ]
          : [
              ['all', 'All Topics'],
              ['film', 'Film & Trench'],
              ['cap', 'Cap & Contracts'],
              ['scheme', 'Scheme & Matchup'],
              ['roster', 'Trades & Roster']
            ]
        )
          .map(
            ([val, label]) => `
          <button type="button" class="pill-btn ${newsCategoryFilter === val ? 'active' : ''}"
                  data-action="set-news-category" data-category="${val}">${esc(label)}</button>
        `
          )
          .join('')}
      </div>

      <details class="compact-details">
        <summary class="compact-details-summary">
          <span>Direct X Beat Lists</span>
        </summary>
        <div class="x-beat-launch-strip" aria-label="Live X Beat Search" style="margin-top:6px">
          <a href="${esc(buildXBeatListSearchUrl('trusted'))}" target="_blank" rel="noopener noreferrer" class="source-chip-link x-beat-chip">
            <span>Trusted Beat</span>${iconSvg('externalLink', 10)}
          </a>
          <a href="${esc(buildXBeatListSearchUrl('injuries'))}" target="_blank" rel="noopener noreferrer" class="source-chip-link x-beat-chip">
            <span>Injury Scoops</span>${iconSvg('externalLink', 10)}
          </a>
          <a href="${esc(buildXBeatListSearchUrl('insiders'))}" target="_blank" rel="noopener noreferrer" class="source-chip-link x-beat-chip">
            <span>NFL Insiders</span>${iconSvg('externalLink', 10)}
          </a>
        </div>
      </details>
    </div>
  `;

  const xBeatSearchStrip = '';

  const breakingAlertStrip =
    newsMode === 'clustered' && activeBreakingItems.length > 0
      ? `
        <section class="card breaking-wire-card" aria-label="Breaking and Live Injury Alerts">
          <div class="breaking-wire-head">
            <span class="badge badge-danger live-breaking-pill">${iconSvg('bolt', 11)}<span>Breaking &amp; Injury Wire</span></span>
            <button type="button" class="btn-ghost btn-compact" data-action="set-news-mode" data-mode="raw">
              <span>Wire &amp; Video</span>
              ${iconSvg('arrowRight', 11)}
            </button>
          </div>
          <div style="display:flex;flex-direction:column;gap:7px">
            ${activeBreakingItems
              .map(item => {
                const isTw = item.type === 'tweet' || item.type === 'social';
                const itemHref = isTw
                  ? sanitizeExternalUrl(resolveOriginalTweetUrl(item, prioritizedRaw), '#')
                  : sanitizeExternalUrl(item.url, '#');
                const authorName = item.author || item.reporterName || item.outletName || '49ers Beat';
                const authorHref = sanitizeExternalUrl(resolveItemAuthorProfileUrl(item, itemHref), itemHref);
                const strippedBody = isTw
                  ? stripRedundantAuthorBoilerplate(item.fullText || item.title || '', authorName)
                  : item.title;
                const bodyText = isTw
                  ? formatTweetBodyForDisplay(strippedBody, SHORT_TWEET_FULL_TEXT_LIMIT).text
                  : strippedBody;
                return `
                  <div class="subcard-panel breaking-elevated" style="font-size:12.5px">
                    <div style="display:flex;justify-content:space-between;align-items:center;gap:6px;flex-wrap:wrap;margin-bottom:4px">
                      <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap">
                        <span class="badge ${item.isInGameInjury ? 'badge-danger' : 'badge-scarlet'}">${esc(item.breakingBadge || 'BREAKING')}</span>
                        <a href="${esc(authorHref)}" target="_blank" rel="noopener noreferrer" class="ext-link" style="font-size:12px"><strong>${esc(authorName)}</strong></a>
                      </div>
                      <span class="mono" style="font-size:11px;color:var(--text-muted)">${esc(formatRelativeAge(item.publishedAt))}</span>
                    </div>
                    <a href="${esc(itemHref)}" target="_blank" rel="noopener noreferrer" class="ext-link" style="font-weight:600;line-height:1.42;color:var(--text-primary)">
                      ${esc(bodyText)} ${iconSvg('externalLink', 11)}
                    </a>
                  </div>
                `;
              })
              .join('')}
          </div>
        </section>
      `
      : '';

  if (newsMode === 'clustered') {
    const visibleClusters =
      newsCategoryFilter === 'all' || ['tweets', 'articles', 'videos'].includes(newsCategoryFilter)
        ? activeClusters
        : activeClusters.filter(c => c.category === newsCategoryFilter);

    if (visibleClusters.length === 0) {
      return `${topToolbar}${xBeatSearchStrip}${breakingAlertStrip}<div class="card">No synthesis briefs match your active category or source filters.</div>`;
    }

    const clustersHtml = visibleClusters
      .map(c => {
        const citedReporters = (c.citedReporterIds || [])
          .map(id => reportersById.get(id))
          .filter(Boolean)
          .slice(0, 6);

        let videoHtml = '';
        if (c.videoClip?.videoId) {
          const vidKey = `cluster_${c.id}_${c.videoClip.videoId}`;
          const isPlaying = activeVideosSet.has(vidKey);
          videoHtml = renderVideoEmbedOrFacade(
            vidKey,
            c.videoClip.videoId,
            c.videoClip.startSeconds || 0,
            c.videoClip.timestampLabel || c.videoClip.title,
            c.videoClip.channel,
            isPlaying,
            c.videoClip.embeddable !== false
          );
        }

        const safeSourceLinks = resolveClusterSafeReports(c, prioritizedRaw, appData);
        const reportCount = safeSourceLinks.length || Number(c.synthesizedFromCount) || 0;
        const sourceLinksHtml =
          safeSourceLinks.length > 0
            ? `
              <details class="compact-details">
                <summary class="compact-details-summary">
                  <span>Sources (${safeSourceLinks.length})</span>
                </summary>
                <div class="source-links-grid" style="margin-top:7px">
                  ${safeSourceLinks
                    .map(
                      sl => `
                    <a href="${esc(sl.url)}" target="_blank" rel="noopener noreferrer" class="source-card-link">
                      <span class="source-card-outlet">${esc(sl.outlet || 'Source')}${sl.publishedAt ? ` • ${esc(formatRelativeAge(sl.publishedAt))}` : ''}</span>
                      <span class="source-card-title">${esc(sl.title)} ${iconSvg('externalLink', 11)}</span>
                    </a>
                  `
                    )
                    .join('')}
                </div>
              </details>
            `
            : '';

        const hasHeroPhoto =
          c.heroImageUrl &&
          /^https:\/\//i.test(c.heroImageUrl) &&
          (c.heroImageIsEditorial || !c.videoClip?.videoId);

        const heroBannerHtml = hasHeroPhoto
          ? `
            <div class="brief-hero-media">
              <img src="${esc(c.heroImageUrl)}" alt="${esc(c.heroImageAlt || c.headline)}" class="brief-hero-img" loading="lazy" decoding="async" />
              <div class="brief-hero-scrim">
                <span class="badge badge-gold">${esc(c.categoryLabel)}</span>
                ${c.heroImageSource ? `<span class="brief-hero-credit">${esc(c.heroImageSource)}</span>` : ''}
              </div>
            </div>
          `
          : '';

        return `
          <article class="card" data-cluster-card="${esc(c.id)}" style="display:flex;flex-direction:column;gap:10px">
            ${heroBannerHtml}
            <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap">
              ${hasHeroPhoto ? '<span></span>' : `<span class="badge badge-gold">${esc(c.categoryLabel)}</span>`}
              <span class="mono" style="font-size:11.5px;color:var(--text-muted)">
                <button type="button" class="synthesis-reports-link mono" data-action="open-synthesis-sources" data-cluster-id="${esc(c.id)}">${reportCount} report${reportCount === 1 ? '' : 's'}</button> • ${esc(formatRelativeAge(c.publishedAt))}
              </span>
            </div>

            <h3 class="brief-headline">${esc(c.headline)}</h3>

            ${c.featuredPlayers?.length ? renderPlayerChipsStripHtml(c.featuredPlayers, 5) : ''}

            <div>
              <div class="brief-section-label">Key Developments</div>
              <ul class="brief-bullets">
                ${(c.hardFacts || []).map(f => `<li>${escJargon(f)}</li>`).join('')}
              </ul>
            </div>

            <div>
              <div class="brief-section-label">Scheme &amp; Cap Impact</div>
              <ul class="brief-bullets">
                ${(c.schemeAndCapTakeaways || []).map(t => `<li>${escJargon(t)}</li>`).join('')}
              </ul>
            </div>

            ${
              c.consensusVsDissent
                ? `<div class="subcard-panel" style="font-size:12.5px">
                    <strong style="color:var(--gold-bright)">Beat Consensus:</strong> ${escJargon(c.consensusVsDissent)}
                   </div>`
                : ''
            }

            ${videoHtml}

            ${sourceLinksHtml}

            <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;padding-top:6px;border-top:1px solid var(--border-subtle);font-size:11.5px;color:var(--text-muted)">
              <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap">
                <span>Voices:</span>
                ${citedReporters
                  .map(rep => {
                    const href = sanitizeExternalUrl(rep.xUrl || rep.profileUrl, null);
                    return href
                      ? `<a href="${esc(href)}" target="_blank" rel="noopener noreferrer" class="ext-link" style="font-size:11.5px">${esc(rep.name)}</a>`
                      : `<strong>${esc(rep.name)}</strong>`;
                  })
                  .join(' · ')}
              </div>
              <button type="button" class="btn-ghost" data-action="analyze-topic-jump" data-prompt="${esc(c.headline)}">
                ${iconSvg('sparkles', 13)}
                <span>Ask AI</span>
              </button>
            </div>
          </article>
        `;
      })
      .join('');

    return `${topToolbar}${xBeatSearchStrip}${breakingAlertStrip}${clustersHtml}`;
  }

  // Raw Stream Mode (Breaking-Prioritized Tweets, Articles & Videos)
  const visibleRaw = dedupedRaw.filter(it => {
    if (newsCategoryFilter === 'all') return true;
    if (newsCategoryFilter === 'tweets') return it.type === 'tweet' || it.type === 'social';
    if (newsCategoryFilter === 'articles') return it.type === 'article' || it.type === 'post';
    if (newsCategoryFilter === 'videos') return it.type === 'video';
    return it.category === newsCategoryFilter;
  });

  const rawListHtml =
    visibleRaw.length === 0
      ? `<div class="card">No feed items match your active filters.</div>`
      : `
        <div class="card" style="display:flex;flex-direction:column;gap:9px">
          ${visibleRaw
            .slice(0, 65)
            .map(item => {
              const vidKey = item.videoId ? `raw_${item.id}` : null;
              const isVidOpen = vidKey && activeVideosSet.has(vidKey);
              const isTweet = item.type === 'tweet' || item.type === 'social';
              const isVideo = item.type === 'video';

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
              const showLinkedStory =
                Boolean(safeExtUrl) &&
                !isRedundantProfileSelfLink(safeExtUrl, resolvedItemUrl) &&
                !isRedundantProfileSelfLink(safeExtUrl, item.url) &&
                !/\bon X$/i.test(String(item.externalTitle || ''));
              const confirmingList = Array.isArray(item.confirmingReports) ? item.confirmingReports : [];

              return `
                <div class="brief-card ${item.breakingPriority > 0 ? 'breaking-elevated' : ''}" data-raw-type="${esc(item.type || 'article')}">
                  <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap">
                    <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;min-width:0">
                      ${
                        item.breakingBadge
                          ? `<span class="badge ${item.isInGameInjury ? 'badge-danger live-breaking-pill' : 'badge-scarlet live-breaking-pill'}">${iconSvg('bolt', 11)}<span>${esc(item.breakingBadge)}</span></span>`
                          : isVideo
                            ? `<span class="badge badge-scarlet">${iconSvg('video', 11)}<span>Video</span></span>`
                            : !isTweet
                              ? `<span class="badge badge-neutral">${iconSvg('news', 11)}<span>Article</span></span>`
                              : ''
                      }
                      ${
                        authorHref
                          ? `<a href="${esc(authorHref)}" target="_blank" rel="noopener noreferrer" class="wire-author-single-link" data-wire-author-link><strong>${esc(authorName)}</strong></a>`
                          : `<strong style="font-size:12.5px;color:var(--gold-bright)">${esc(authorName)}</strong>`
                      }
                    </div>
                    <span class="mono" style="font-size:11.5px;color:var(--text-muted);flex-shrink:0" data-wire-age>${esc(formatRelativeAge(item.publishedAt))}</span>
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
                               <summary class="compact-details-summary">+${confirmingList.length} confirming report${confirmingList.length === 1 ? '' : 's'}</summary>
                               <div style="display:flex;flex-direction:column;gap:4px;margin-top:5px">
                                 ${confirmingList
                                   .slice(0, 4)
                                   .map(cr => {
                                     const crAuthor = cr.author || cr.reporterName || cr.outletName || 'Beat';
                                     const crBody = stripRedundantAuthorBoilerplate(cr.fullText || cr.title || '', crAuthor);
                                     const crIsTw = cr.type === 'tweet' || cr.type === 'social';
                                     const crHref = crIsTw
                                       ? sanitizeExternalUrl(resolveOriginalTweetUrl(cr, prioritizedRaw), '#')
                                       : sanitizeExternalUrl(cr.url, '#');
                                     const crAuthorHref = sanitizeExternalUrl(
                                       resolveItemAuthorProfileUrl(cr, crHref),
                                       crHref
                                     );
                                     return `<div style="font-size:11.5px;color:var(--text-secondary)">
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
                          item.embeddable !== false
                        )
                      : ''
                  }
                </div>
              `;
            })
            .join('')}
        </div>
      `;

  return `${topToolbar}${xBeatSearchStrip}${rawListHtml}`;
}

export function renderVideoEmbedOrFacade(
  vidKey,
  videoId,
  startSec = 0,
  label = 'Watch Video',
  channel = 'YouTube',
  isPlaying = false,
  embeddable = true
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
          <div class="video-launch-bar">
            <div style="min-width:0">
              <div style="font-weight:700;font-size:12.5px;color:#E5CF96;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(label)}</div>
              <div style="font-size:11px;color:#A3AFBF">${esc(channel || 'YouTube')} • Opens directly on YouTube</div>
            </div>
            <span class="source-chip-link"><span>YouTube</span>${iconSvg('externalLink', 11)}</span>
          </div>
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
          <span class="inline-icon-meta" style="min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${iconSvg('video', 14)}<span>${esc(label)}</span></span>
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
      <div class="video-launch-bar">
        <div style="min-width:0">
          <div style="font-weight:700;font-size:12.5px;color:#E5CF96;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(label)}</div>
          <div style="font-size:11px;color:#A3AFBF">${esc(channel || 'YouTube Film & Podium')}</div>
        </div>
        <a href="${esc(watchUrl)}" target="_blank" rel="noopener noreferrer" class="ext-link" style="flex-shrink:0">YouTube ${iconSvg('externalLink', 12)}</a>
      </div>
    </div>
  `;
}
