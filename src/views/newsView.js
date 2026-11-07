/**
 * Team News, Beat Reporter Synthesis & Playable Video Clip View
 * Modes: "Clustered Fact & Film Briefs" (Default) vs. "Raw Chronological Stream"
 */

import { esc, formatRelativeAge } from './uiHelpers.js';

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
        <div class="card-title-group">
          <div class="card-eyebrow">No-Fluff Synthesis Engine • ${totalReportersCount} Beat &amp; National Voices</div>
          <h2 class="card-title">Team News, Film &amp; Podium Briefs</h2>
        </div>
        <button type="button" class="btn-ghost" data-action="open-settings">
          ⚙️ Sources${mutedCount > 0 ? ` (${mutedCount} muted)` : ''}
        </button>
      </div>

      <div style="display:flex;gap:8px;margin-bottom:8px">
        <button type="button" class="pill-btn ${newsMode === 'clustered' ? 'active' : ''}" data-action="set-news-mode" data-mode="clustered">
          🧠 Clustered Fact &amp; Film Briefs (${filteredClusters.length})
        </button>
        <button type="button" class="pill-btn ${newsMode === 'raw' ? 'active' : ''}" data-action="set-news-mode" data-mode="raw">
          ⚡ Raw Beat Stream (${filteredRawItems.length})
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
              <span class="badge badge-positive mono">Synthesized from ${c.synthesizedFromCount} sources • ${c.filteredClickbaitCount} clickbait cut</span>
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
                ? `<div style="padding:8px 10px;border-radius:8px;background:var(--bg-card-alt);font-size:12.5px">
                    <strong style="color:var(--gold-bright)">Beat Consensus:</strong> ${esc(c.consensusVsDissent)}
                   </div>`
                : ''
            }

            ${videoHtml}

            <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;padding-top:4px;border-top:1px solid var(--border-subtle);font-size:11.5px;color:var(--text-muted)">
              <span>Cited: <strong>${esc(citedNames.join(', '))}</strong></span>
              <button type="button" class="btn-ghost" data-action="analyze-topic-jump" data-prompt="${esc(c.headline)}">
                ⚡ Deep Dive AI
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
                      ${item.type === 'video' ? '🎬 Video' : '📰 ' + esc(item.outletName)}
                    </span>
                    <span style="font-size:11px;color:var(--text-muted)" class="mono">
                      ${esc(item.reporterName)} • ${formatRelativeAge(item.publishedAt)}
                    </span>
                  </div>
                  <div style="font-weight:700;font-size:13.8px">
                    ${
                      item.url && item.type !== 'video'
                        ? `<a href="${esc(item.url)}" target="_blank" rel="noopener noreferrer">${esc(item.title)} ↗</a>`
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
          <span>🎬 ${esc(label)}</span>
          <a href="https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}&t=${Number(startSec || 0)}s" target="_blank" rel="noopener noreferrer">YouTube ↗</a>
        </div>
      </div>
    `;
  }

  return `
    <div class="video-embed-box">
      <div class="video-launch-bar">
        <div style="min-width:0">
          <div style="font-weight:700;font-size:12.5px;color:#E5CF96">▶ ${esc(label)}</div>
          <div style="font-size:11px;color:#A3AFBF">${esc(channel || 'YouTube')}</div>
        </div>
        <button type="button" class="btn-primary" data-action="play-inline-video" data-vid-key="${esc(vidKey)}">
          ▶ Play Clip
        </button>
      </div>
    </div>
  `;
}
