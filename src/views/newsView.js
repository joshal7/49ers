/**
 * Team News, Beat Reporter Synthesis, Live Tweets & Playable Video Clip View
 * Modes: "Beat Synthesis Briefs" (Default) vs. "Live Tweets, Articles & Video"
 */

import { esc, escJargon, formatRelativeAge, renderPlayerChipsStripHtml } from './uiHelpers.js';
import { iconSvg } from './icons.js';
import {
  SHORT_TWEET_FULL_TEXT_LIMIT,
  sortNewsWithBreakingPriority,
  formatTweetBodyForDisplay
} from '../engine/breakingClassifier.js';
import { isPaywalledPublisher, sanitizeExternalUrl } from '../engine/linkIntegrity.js';

export function renderNewsViewHtml({
  newsMode, // 'clustered' | 'raw'
  newsCategoryFilter, // 'all' | 'tweets' | 'videos' | 'film' | 'cap' | 'scheme' | 'roster' | 'beat'
  filteredClusters,
  filteredRawItems,
  reportersById,
  activeVideosSet,
  userPrefs,
  totalReportersCount,
  isGameLive = false,
  lastWireSyncAt = null,
  isSyncingWire = false
}) {
  const mutedCount =
    (userPrefs?.disabledReporterIds?.length || 0) + (userPrefs?.disabledOutlets?.length || 0);

  const prioritizedRaw = sortNewsWithBreakingPriority(
    (filteredRawItems || []).filter(i => {
      if (i.type === 'video' && i.videoId) return true;
      return Boolean(sanitizeExternalUrl(i.url, null)) && !isPaywalledPublisher(i.outletName, i.url);
    })
  );
  const tweetCount = prioritizedRaw.filter(i => i.type === 'tweet' || i.type === 'social').length;
  const activeBreakingItems = prioritizedRaw.filter(i => (i.breakingPriority || 0) > 0).slice(0, 3);
  const pollLabel = isGameLive ? '20s Game-Day Live Poll' : '45s Live Poll';
  const syncAge = lastWireSyncAt ? formatRelativeAge(lastWireSyncAt) : 'now';

  const topToolbar = `
    <div class="card news-toolbar-card">
      <div class="news-toolbar-head">
        <div class="news-toolbar-title-row">
          <div class="news-toolbar-brand">
            <div class="card-icon-badge compact" aria-hidden="true">${iconSvg('news', 15)}</div>
            <h2 class="card-title">News, Wire &amp; Film</h2>
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
        <div class="news-toolbar-meta">
          <span class="live-pulse-dot" aria-hidden="true"></span>
          <span><strong>${totalReportersCount}</strong> Beat &amp; National Sources • ${pollLabel}</span>
        </div>
      </div>

      <div class="segmented-control compact-seg" role="tablist" aria-label="News Feed Mode">
        <button type="button" class="pill-btn seg-btn ${newsMode === 'clustered' ? 'active' : ''}" data-action="set-news-mode" data-mode="clustered">
          ${iconSvg('sparkles', 13)}
          <span>Synthesis Briefs (${filteredClusters.length})</span>
        </button>
        <button type="button" class="pill-btn seg-btn ${newsMode === 'raw' ? 'active' : ''}" data-action="set-news-mode" data-mode="raw">
          ${iconSvg('bolt', 13)}
          <span>Wire &amp; Video (${prioritizedRaw.length})</span>
        </button>
      </div>

      <div class="pill-bar" aria-label="News Category Filter">
        ${(newsMode === 'raw'
          ? [
              ['all', `All (${prioritizedRaw.length})`],
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
    </div>
  `;

  const breakingAlertStrip =
    newsMode === 'clustered' && activeBreakingItems.length > 0
      ? `
        <section class="card breaking-wire-card" aria-label="Breaking and Live Injury Alerts">
          <div class="breaking-wire-head">
            <div style="display:flex;align-items:center;gap:6px;min-width:0">
              <span class="badge badge-danger live-breaking-pill">${iconSvg('bolt', 11)}<span>Breaking &amp; Injury Wire</span></span>
              <span class="mono" style="font-size:10.5px;color:var(--text-muted);white-space:nowrap">&lt;1m poll</span>
            </div>
            <button type="button" class="btn-ghost btn-compact" data-action="set-news-mode" data-mode="raw">
              <span>All Live</span>
              ${iconSvg('arrowRight', 11)}
            </button>
          </div>
          <div style="display:flex;flex-direction:column;gap:7px">
            ${activeBreakingItems
              .map(item => {
                const isTw = item.type === 'tweet' || item.type === 'social';
                const authorName = item.author || item.reporterName || item.outletName || '49ers Beat';
                const bodyText = isTw
                  ? formatTweetBodyForDisplay(item.fullText || item.title || '', SHORT_TWEET_FULL_TEXT_LIMIT).text
                  : item.title;
                return `
                  <div class="subcard-panel breaking-elevated" style="font-size:12.5px">
                    <div style="display:flex;justify-content:space-between;align-items:center;gap:6px;flex-wrap:wrap;margin-bottom:4px">
                      <div style="display:flex;align-items:center;gap:5px;flex-wrap:wrap">
                        <span class="badge ${item.isInGameInjury ? 'badge-danger' : 'badge-scarlet'}">${esc(item.breakingBadge || 'BREAKING')}</span>
                        <span>by <strong>${esc(authorName)}</strong>${isTw && item.authorHandle ? ` <span class="mono" style="font-size:11px;color:var(--text-muted)">${esc(item.authorHandle)}</span>` : ` <span style="color:var(--text-muted)">• ${esc(item.outletName || '')}</span>`}</span>
                      </div>
                      <span class="mono" style="font-size:11px;color:var(--text-muted)">${esc(formatRelativeAge(item.publishedAt))}</span>
                    </div>
                    <a href="${esc(item.url)}" target="_blank" rel="noopener noreferrer" class="ext-link" style="font-weight:600;line-height:1.42;color:var(--text-primary)">
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
        ? filteredClusters
        : filteredClusters.filter(c => c.category === newsCategoryFilter);

    if (visibleClusters.length === 0) {
      return `${topToolbar}${breakingAlertStrip}<div class="card">No synthesis briefs match your active category or source filters.</div>`;
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

        const safeSourceLinks = (c.sourceLinks || []).filter(
          sl => sanitizeExternalUrl(sl?.url, null) && !isPaywalledPublisher(sl?.outlet, sl?.url)
        );
        const sourceLinksHtml =
          safeSourceLinks.length > 0
            ? `
              <div>
                <div class="brief-section-label">Original Sources &amp; Reports Used</div>
                <div class="source-links-grid">
                  ${safeSourceLinks
                    .map(
                      sl => `
                    <a href="${esc(sanitizeExternalUrl(sl.url))}" target="_blank" rel="noopener noreferrer" class="source-card-link">
                      <span class="source-card-outlet">${esc(sl.outlet || 'Source')}${sl.publishedAt ? ` • ${esc(formatRelativeAge(sl.publishedAt))}` : ''}</span>
                      <span class="source-card-title">${esc(sl.title)} ${iconSvg('externalLink', 11)}</span>
                    </a>
                  `
                    )
                    .join('')}
                </div>
              </div>
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
          <article class="card" style="display:flex;flex-direction:column;gap:10px">
            ${heroBannerHtml}
            <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap">
              ${hasHeroPhoto ? `<span class="card-eyebrow" style="margin:0">${esc(c.categoryLabel)} Synthesis</span>` : `<span class="badge badge-gold">${esc(c.categoryLabel)}</span>`}
              <span class="mono" style="font-size:11.5px;color:var(--text-muted)">
                Synthesized from ${c.synthesizedFromCount} reports • ${esc(formatRelativeAge(c.publishedAt))}
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
              <div class="brief-section-label">Scheme &amp; Salary Cap Breakdown</div>
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
                    const href = sanitizeExternalUrl(rep.bskyUrl || rep.profileUrl || rep.xUrl, null);
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

    return `${topToolbar}${breakingAlertStrip}${clustersHtml}`;
  }

  // Raw Stream Mode (Breaking-Prioritized Tweets, Articles & Videos)
  const visibleRaw = prioritizedRaw.filter(it => {
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
              const badgeCls = isVideo ? 'badge-scarlet' : isTweet ? 'badge-gold' : 'badge-neutral';
              const badgeIcon = isVideo ? 'video' : isTweet ? 'tweet' : 'news';
              const badgeText = isVideo ? 'Video' : isTweet ? `Tweet • ${item.authorHandle || item.outletName}` : `Article • ${item.outletName || '49ers Beat'}`;

              const authorName = item.author || item.reporterName || item.outletName || '49ers Beat';
              const displayTitle = isTweet
                ? formatTweetBodyForDisplay(item.fullText || item.title || '', SHORT_TWEET_FULL_TEXT_LIMIT).text
                : item.title;

              const cleanSummary =
                !isVideo &&
                !isTweet &&
                item.summary &&
                !item.summary.startsWith('Published via ') &&
                item.summary.toLowerCase() !== `${authorName} • ${item.outletName || ''}`.toLowerCase()
                  ? item.summary
                  : '';

              const hasThumb = !isVideo && item.imageUrl && /^https:\/\//i.test(item.imageUrl);

              return `
                <div class="brief-card ${item.breakingPriority > 0 ? 'breaking-elevated' : ''}" data-raw-type="${esc(item.type || 'article')}">
                  <div style="display:flex;justify-content:space-between;align-items:center;gap:6px;flex-wrap:wrap">
                    <div style="display:flex;align-items:center;gap:5px;flex-wrap:wrap">
                      ${
                        item.breakingBadge
                          ? `<span class="badge ${item.isInGameInjury ? 'badge-danger live-breaking-pill' : 'badge-scarlet live-breaking-pill'}">${iconSvg('bolt', 11)}<span>${esc(item.breakingBadge)}</span></span>`
                          : ''
                      }
                      <span class="badge ${badgeCls}">
                        ${iconSvg(badgeIcon, 12)}
                        <span>${esc(badgeText)}</span>
                      </span>
                    </div>
                    <span style="font-size:11.5px;color:var(--text-muted)">
                      by ${
                        sanitizeExternalUrl(item.authorProfileUrl, null)
                          ? `<a href="${esc(sanitizeExternalUrl(item.authorProfileUrl))}" target="_blank" rel="noopener noreferrer" class="ext-link" style="font-size:11.5px"><strong>${esc(authorName)}</strong></a>`
                          : `<strong style="color:var(--text-secondary)">${esc(authorName)}</strong>`
                      } <span class="mono">• ${formatRelativeAge(item.publishedAt)}</span>
                    </span>
                  </div>
                  <div class="${hasThumb ? 'media-split-row' : ''}">
                    <div style="min-width:0;display:flex;flex-direction:column;gap:4px">
                      <div style="font-weight:${isTweet ? '600' : '700'};font-size:13.6px;line-height:1.42">
                        ${
                          sanitizeExternalUrl(item.url, null)
                            ? `<a href="${esc(sanitizeExternalUrl(item.url))}" target="_blank" rel="noopener noreferrer" class="ext-link" style="${isTweet ? 'display:inline;color:var(--text-primary)' : ''}">${esc(displayTitle)} ${iconSvg('externalLink', 12)}</a>`
                            : esc(displayTitle)
                        }
                      </div>
                      ${cleanSummary ? `<div style="font-size:12.5px;color:var(--text-secondary)">${escJargon(cleanSummary)}</div>` : ''}
                    </div>
                    ${
                      hasThumb && sanitizeExternalUrl(item.url || item.externalUrl, null)
                        ? `<a href="${esc(sanitizeExternalUrl(item.url || item.externalUrl))}" target="_blank" rel="noopener noreferrer" class="raw-item-thumb" aria-hidden="true" tabindex="-1">
                            <img src="${esc(item.imageUrl)}" alt="${esc(displayTitle)}" width="76" height="76" loading="lazy" decoding="async" />
                          </a>`
                        : hasThumb
                          ? `<div class="raw-item-thumb" aria-hidden="true">
                              <img src="${esc(item.imageUrl)}" alt="${esc(displayTitle)}" width="76" height="76" loading="lazy" decoding="async" />
                            </div>`
                          : ''
                    }
                  </div>
                  ${
                    sanitizeExternalUrl(item.externalUrl, null)
                      ? `<div>
                          <a href="${esc(sanitizeExternalUrl(item.externalUrl))}" target="_blank" rel="noopener noreferrer" class="source-chip-link">
                            <span>Linked Story: ${esc((item.externalTitle || item.outletName || 'Open Article').slice(0, 62))}</span>
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

  return `${topToolbar}${rawListHtml}`;
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
