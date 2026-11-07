/**
 * Team News, Beat Reporter Synthesis, Live Tweets & Playable Video Clip View
 * Modes: "Beat Synthesis Briefs" (Default) vs. "Live Tweets, Articles & Video"
 */

import { esc, formatRelativeAge, renderPlayerChipsStripHtml } from './uiHelpers.js';
import { iconSvg } from './icons.js';

export function renderNewsViewHtml({
  newsMode, // 'clustered' | 'raw'
  newsCategoryFilter, // 'all' | 'tweets' | 'videos' | 'film' | 'cap' | 'scheme' | 'roster' | 'beat'
  filteredClusters,
  filteredRawItems,
  reportersById,
  activeVideosSet,
  userPrefs,
  totalReportersCount
}) {
  const mutedCount =
    (userPrefs?.disabledReporterIds?.length || 0) + (userPrefs?.disabledOutlets?.length || 0);

  const tweetCount = (filteredRawItems || []).filter(i => i.type === 'tweet' || i.type === 'social').length;

  const topToolbar = `
    <div class="card">
      <div class="card-header">
        <div class="card-header-left">
          <div class="card-icon-badge" aria-hidden="true">${iconSvg('news', 18)}</div>
          <div class="card-title-group">
            <div class="card-eyebrow">${totalReportersCount} Tracked Beat &amp; National Sources • Direct Source Links</div>
            <h2 class="card-title">Team News, Beat Wire &amp; Film</h2>
          </div>
        </div>
        <button type="button" class="btn-ghost" data-action="open-settings">
          ${iconSvg('settings', 14)}
          <span>Sources${mutedCount > 0 ? ` (${mutedCount} muted)` : ''}</span>
        </button>
      </div>

      <div class="segmented-control" role="tablist" aria-label="News Feed Mode" style="margin-bottom:10px">
        <button type="button" class="pill-btn seg-btn ${newsMode === 'clustered' ? 'active' : ''}" data-action="set-news-mode" data-mode="clustered">
          ${iconSvg('sparkles', 14)}
          <span>Synthesis Briefs (${filteredClusters.length})</span>
        </button>
        <button type="button" class="pill-btn seg-btn ${newsMode === 'raw' ? 'active' : ''}" data-action="set-news-mode" data-mode="raw">
          ${iconSvg('bolt', 14)}
          <span>Tweets, Articles &amp; Video (${filteredRawItems.length})</span>
        </button>
      </div>

      <div class="pill-bar" aria-label="News Category Filter">
        ${(newsMode === 'raw'
          ? [
              ['all', `All (${filteredRawItems.length})`],
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

  if (newsMode === 'clustered') {
    const visibleClusters =
      newsCategoryFilter === 'all' || ['tweets', 'articles', 'videos'].includes(newsCategoryFilter)
        ? filteredClusters
        : filteredClusters.filter(c => c.category === newsCategoryFilter);

    if (visibleClusters.length === 0) {
      return `${topToolbar}<div class="card">No synthesis briefs match your active category or source filters.</div>`;
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

        const sourceLinksHtml =
          (c.sourceLinks || []).length > 0
            ? `
              <div>
                <div class="brief-section-label">Original Sources &amp; Reports Used</div>
                <div class="source-links-grid">
                  ${c.sourceLinks
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
                ${(c.hardFacts || []).map(f => `<li>${esc(f)}</li>`).join('')}
              </ul>
            </div>

            <div>
              <div class="brief-section-label">Scheme &amp; Salary Cap Breakdown</div>
              <ul class="brief-bullets">
                ${(c.schemeAndCapTakeaways || []).map(t => `<li>${esc(t)}</li>`).join('')}
              </ul>
            </div>

            ${
              c.consensusVsDissent
                ? `<div class="subcard-panel" style="font-size:12.5px">
                    <strong style="color:var(--gold-bright)">Beat Consensus:</strong> ${esc(c.consensusVsDissent)}
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
                    const href = rep.bskyUrl || rep.profileUrl || rep.xUrl;
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

    return `${topToolbar}${clustersHtml}`;
  }

  // Raw Chronological Stream Mode (Tweets, Articles & Videos)
  const visibleRaw = (filteredRawItems || []).filter(it => {
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
            .slice(0, 50)
            .map(item => {
              const vidKey = item.videoId ? `raw_${item.id}` : null;
              const isVidOpen = vidKey && activeVideosSet.has(vidKey);
              const isTweet = item.type === 'tweet' || item.type === 'social';
              const isVideo = item.type === 'video';
              const badgeCls = isVideo ? 'badge-scarlet' : isTweet ? 'badge-gold' : 'badge-neutral';
              const badgeIcon = isVideo ? 'video' : isTweet ? 'tweet' : 'news';
              const badgeText = isVideo ? 'Video' : isTweet ? `Tweet • ${item.authorHandle || item.outletName}` : item.outletName;

              const hasThumb = !isVideo && item.imageUrl && /^https:\/\//i.test(item.imageUrl);

              return `
                <div class="brief-card">
                  <div style="display:flex;justify-content:space-between;align-items:center;gap:6px;flex-wrap:wrap">
                    <span class="badge ${badgeCls}">
                      ${iconSvg(badgeIcon, 12)}
                      <span>${esc(badgeText)}</span>
                    </span>
                    <span style="font-size:11px;color:var(--text-muted)" class="mono">
                      ${
                        item.authorProfileUrl
                          ? `<a href="${esc(item.authorProfileUrl)}" target="_blank" rel="noopener noreferrer" class="ext-link" style="font-size:11px">${esc(item.reporterName)}</a>`
                          : esc(item.reporterName)
                      } • ${formatRelativeAge(item.publishedAt)}
                    </span>
                  </div>
                  <div class="${hasThumb ? 'media-split-row' : ''}">
                    <div style="min-width:0;display:flex;flex-direction:column;gap:4px">
                      <div style="font-weight:${isTweet ? '600' : '700'};font-size:13.6px;line-height:1.4">
                        ${
                          item.url
                            ? `<a href="${esc(item.url)}" target="_blank" rel="noopener noreferrer" class="ext-link">${esc(item.title)} ${iconSvg('externalLink', 12)}</a>`
                            : esc(item.title)
                        }
                      </div>
                      ${item.summary && !isVideo ? `<div style="font-size:12.5px;color:var(--text-secondary)">${esc(item.summary)}</div>` : ''}
                    </div>
                    ${
                      hasThumb
                        ? `<a href="${esc(item.url || item.externalUrl || '#')}" target="_blank" rel="noopener noreferrer" class="raw-item-thumb" aria-hidden="true" tabindex="-1">
                            <img src="${esc(item.imageUrl)}" alt="${esc(item.title)}" width="76" height="76" loading="lazy" decoding="async" />
                          </a>`
                        : ''
                    }
                  </div>
                  ${
                    item.externalUrl
                      ? `<div>
                          <a href="${esc(item.externalUrl)}" target="_blank" rel="noopener noreferrer" class="source-chip-link">
                            <span>Linked Story: ${esc((item.externalTitle || item.outletName || 'Open Article').slice(0, 62))}</span>
                            ${iconSvg('externalLink', 11)}
                          </a>
                        </div>`
                      : ''
                  }
                  ${item.mentionedPlayers?.length ? renderPlayerChipsStripHtml(item.mentionedPlayers, 3) : ''}
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
