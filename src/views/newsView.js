/**
 * Team News, Beat Reporter Synthesis & Playable Video Clip View
 * Modes: "Clustered Fact & Film Briefs" (Default) vs. "Raw Chronological Stream"
 */

import { esc, formatRelativeAge } from './uiHelpers.js';
import { iconSvg } from './icons.js';

export function renderNewsViewHtml({
  newsMode, // 'clustered' | 'raw'
  newsCategoryFilter, // 'all' | 'film' | 'cap' | 'beat' | 'roster'
  filteredClusters,
  filteredRawItems,
  reportersById,
  activeVideosSet,
  userPrefs,
  totalReportersCount
}) {
  const mutedCount =
    (userPrefs?.disabledReporterIds?.length || 0) + (userPrefs?.disabledOutlets?.length || 0);

  const topToolbar = `
    <div class="card">
      <div class="card-header">
        <div class="card-header-left">
          <div class="card-icon-badge" aria-hidden="true">${iconSvg('news', 18)}</div>
          <div class="card-title-group">
            <div class="card-eyebrow">No-Fluff Synthesis Engine • ${totalReportersCount} Beat &amp; National Voices</div>
            <h2 class="card-title">Team News, Film &amp; Podium Briefs</h2>
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
          <span>Clustered Fact &amp; Film Briefs (${filteredClusters.length})</span>
        </button>
        <button type="button" class="pill-btn seg-btn ${newsMode === 'raw' ? 'active' : ''}" data-action="set-news-mode" data-mode="raw">
          ${iconSvg('bolt', 14)}
          <span>Raw Beat Stream (${filteredRawItems.length})</span>
        </button>
      </div>

      <div class="pill-bar" aria-label="News Category Filter">
        ${[
          ['all', 'All Signal'],
          ['film', 'Film & Trench'],
          ['cap', 'Cap & Contracts'],
          ['scheme', 'Scheme & Matchup'],
          ['roster', 'Trades & Roster'],
          ['beat', 'Beat Wire']
        ]
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
      newsCategoryFilter === 'all'
        ? filteredClusters
        : filteredClusters.filter(c => c.category === newsCategoryFilter);

    if (visibleClusters.length === 0) {
      return `${topToolbar}<div class="card">No clustered briefs match your active category or reporter filters.</div>`;
    }

    const clustersHtml = visibleClusters
      .map(c => {
        const citedNames = (c.citedReporterIds || [])
          .map(id => reportersById.get(id)?.name || id)
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
            isPlaying
          );
        }

        return `
          <article class="card" style="display:flex;flex-direction:column;gap:10px">
            <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap">
              <span class="badge badge-gold">${esc(c.categoryLabel)}</span>
              <span class="badge badge-positive mono">${iconSvg('shieldCheck', 12)}<span>Synthesized from ${c.synthesizedFromCount} sources • ${c.filteredClickbaitCount} clickbait cut</span></span>
            </div>

            <h3 class="brief-headline">${esc(c.headline)}</h3>

            <div>
              <div class="brief-section-label">Verified Facts</div>
              <ul class="brief-bullets">
                ${(c.hardFacts || []).map(f => `<li>${esc(f)}</li>`).join('')}
              </ul>
            </div>

            <div>
              <div class="brief-section-label">X's &amp; O's / Salary Cap Implications</div>
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

            <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;padding-top:6px;border-top:1px solid var(--border-subtle);font-size:11.5px;color:var(--text-muted)">
              <span>Cited: <strong>${esc(citedNames.join(', '))}</strong></span>
              <button type="button" class="btn-ghost" data-action="analyze-topic-jump" data-prompt="${esc(c.headline)}">
                ${iconSvg('sparkles', 13)}
                <span>Deep Dive AI</span>
              </button>
            </div>
          </article>
        `;
      })
      .join('');

    return `${topToolbar}${clustersHtml}`;
  }

  // Raw Chronological Stream Mode
  const visibleRaw =
    newsCategoryFilter === 'all'
      ? filteredRawItems
      : filteredRawItems.filter(it => it.category === newsCategoryFilter);

  const rawListHtml =
    visibleRaw.length === 0
      ? `<div class="card">No raw beat items match your active filters.</div>`
      : `
        <div class="card" style="display:flex;flex-direction:column;gap:9px">
          ${visibleRaw
            .slice(0, 40)
            .map(item => {
              const vidKey = item.videoId ? `raw_${item.id}` : null;
              const isVidOpen = vidKey && activeVideosSet.has(vidKey);
              return `
                <div class="brief-card">
                  <div style="display:flex;justify-content:space-between;align-items:center;gap:6px;flex-wrap:wrap">
                    <span class="badge ${item.type === 'video' ? 'badge-scarlet' : 'badge-neutral'}">
                      ${iconSvg(item.type === 'video' ? 'video' : 'news', 12)}
                      <span>${item.type === 'video' ? 'Video' : esc(item.outletName)}</span>
                    </span>
                    <span style="font-size:11px;color:var(--text-muted)" class="mono">
                      ${esc(item.reporterName)} • ${formatRelativeAge(item.publishedAt)}
                    </span>
                  </div>
                  <div style="font-weight:700;font-size:13.8px">
                    ${
                      item.url && item.type !== 'video'
                        ? `<a href="${esc(item.url)}" target="_blank" rel="noopener noreferrer" class="ext-link">${esc(item.title)} ${iconSvg('externalLink', 12)}</a>`
                        : esc(item.title)
                    }
                  </div>
                  ${item.summary ? `<div style="font-size:12.5px;color:var(--text-secondary)">${esc(item.summary)}</div>` : ''}
                  ${
                    item.videoId
                      ? renderVideoEmbedOrFacade(
                          vidKey,
                          item.videoId,
                          0,
                          `Watch Clip (${item.duration || 'Video'})`,
                          item.outletName,
                          isVidOpen
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

export function renderVideoEmbedOrFacade(vidKey, videoId, startSec, label, channel, isPlaying) {
  if (isPlaying) {
    const src = `https://www.youtube.com/embed/${encodeURIComponent(videoId)}?start=${Number(
      startSec || 0
    )}&autoplay=1&rel=0&playsinline=1`;
    return `
      <div class="video-embed-box">
        <div class="video-iframe-wrap">
          <iframe src="${src}" title="${esc(label)}" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen></iframe>
        </div>
        <div class="video-launch-bar">
          <span class="inline-icon-meta">${iconSvg('video', 14)}<span>${esc(label)}</span></span>
          <a href="https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}&t=${Number(startSec || 0)}s" target="_blank" rel="noopener noreferrer" class="ext-link">YouTube ${iconSvg('externalLink', 12)}</a>
        </div>
      </div>
    `;
  }

  return `
    <div class="video-embed-box">
      <div class="video-launch-bar">
        <div style="display:flex;align-items:center;gap:10px;min-width:0">
          <div class="video-play-disc" aria-hidden="true">${iconSvg('play', 14)}</div>
          <div style="min-width:0">
            <div style="font-weight:700;font-size:12.5px;color:#E5CF96;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(label)}</div>
            <div style="font-size:11px;color:#A3AFBF">${esc(channel || 'YouTube Film & Podium')}</div>
          </div>
        </div>
        <button type="button" class="btn-primary" data-action="play-inline-video" data-vid-key="${esc(vidKey)}">
          ${iconSvg('play', 13)}
          <span>Play Clip</span>
        </button>
      </div>
    </div>
  `;
}
