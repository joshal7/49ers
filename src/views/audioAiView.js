/**
 * Auto Podcast, 49ers Beat Podcasts (7-Day Native App Directory) & Deep Scouting/Cap Analysis View
 */

import { esc, renderMarkdownSafe, formatRelativeAge } from './uiHelpers.js';
import { iconSvg } from './icons.js';
import { formatTimeMmSs } from '../components/audioPlayer.js';
import { sanitizeExternalUrl } from '../engine/linkIntegrity.js';

const SEVEN_DAYS_MS = 7 * 86_400_000;

/**
 * Builds a platform-native Podcast App launch URI:
 * - iOS / iPadOS (including iPhone 16 Safari & Home Screen PWA): `podcasts://podcasts.apple.com/...`
 *   launches Apple Podcasts natively straight to the episode without getting trapped in an in-app webview.
 * - Android: `intent://<feed>#Intent;scheme=pcast;...;S.browser_fallback_url=<appleUrl>;end`
 *   launches the user's installed Android podcast player with seamless fallback.
 * - Desktop: `https://podcasts.apple.com/...` Universal Link.
 */
export function buildNativePodcastAppHref(
  episode = {},
  userAgent = typeof navigator !== 'undefined' ? navigator.userAgent : '',
  maxTouchPoints = typeof navigator !== 'undefined' ? Number(navigator.maxTouchPoints || 0) : 0
) {
  const rawAppleUrl = String(
    episode.appleEpisodeUrl || episode.appleShowUrl || 'https://podcasts.apple.com/us/genre/podcasts-sports/id1545'
  ).trim();
  const safeHttpsApple = rawAppleUrl.startsWith('https://')
    ? rawAppleUrl
    : `https://${rawAppleUrl.replace(/^https?:\/\//i, '')}`;

  const ua = String(userAgent || '');
  const isIOS =
    /iPhone|iPad|iPod/i.test(ua) ||
    (/Macintosh/i.test(ua) && maxTouchPoints > 1);
  const isAndroid = /Android/i.test(ua);

  if (isIOS) {
    return {
      href: safeHttpsApple.replace(/^https?:\/\//i, 'podcasts://'),
      platform: 'ios',
      isExternalHttp: false,
      ctaLabel: 'Open in Apple Podcasts'
    };
  }

  if (isAndroid) {
    const cleanFeed = String(episode.feedUrl || '')
      .trim()
      .replace(/^https?:\/\//i, '');
    if (cleanFeed) {
      return {
        href: `intent://${cleanFeed}#Intent;scheme=pcast;action=android.intent.action.VIEW;S.browser_fallback_url=${encodeURIComponent(safeHttpsApple)};end`,
        platform: 'android',
        isExternalHttp: false,
        ctaLabel: 'Open in Podcast App'
      };
    }
    return {
      href: safeHttpsApple,
      platform: 'android',
      isExternalHttp: true,
      ctaLabel: 'Open in Podcast App'
    };
  }

  return {
    href: safeHttpsApple,
    platform: 'desktop',
    isExternalHttp: true,
    ctaLabel: 'Open in Podcasts App'
  };
}

function formatPodcastEpisodeDate(isoStr = '') {
  if (!isoStr) return '';
  const dt = new Date(isoStr);
  if (Number.isNaN(dt.getTime())) return '';
  return dt.toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    timeZone: 'America/Los_Angeles'
  });
}

function filterEpisodesLast7Days(episodes = [], referenceUpdatedAt = '') {
  if (!Array.isArray(episodes) || episodes.length === 0) return [];
  const nowMs = Date.now();
  const liveWindow = episodes.filter(ep => {
    const ms = ep?.publishedAt ? new Date(ep.publishedAt).getTime() : 0;
    return ms > 0 && nowMs - ms <= SEVEN_DAYS_MS + 3_600_000;
  });
  if (liveWindow.length > 0) {
    return liveWindow.sort((a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime());
  }
  // Offline fallback relative to snapshot capture timestamp
  const refMs = referenceUpdatedAt ? new Date(referenceUpdatedAt).getTime() : nowMs;
  return episodes
    .filter(ep => {
      const ms = ep?.publishedAt ? new Date(ep.publishedAt).getTime() : 0;
      return ms > 0 && refMs - ms <= SEVEN_DAYS_MS + 3_600_000;
    })
    .sort((a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime());
}

function renderSourceChips(items = []) {
  if (!Array.isArray(items) || items.length === 0) return '';
  const rendered = items
    .map(item => {
      if (!item) return '';
      if (typeof item === 'string') {
        return `<span class="badge badge-neutral">${esc(item)}</span>`;
      }
      const label = item.label || item.outlet || item.title || 'Source';
      const safeUrl = sanitizeExternalUrl(item.url, null);
      if (safeUrl) {
        return `<a href="${esc(safeUrl)}" target="_blank" rel="noopener noreferrer" class="source-chip-link"><span>${esc(label)}</span>${iconSvg('externalLink', 10)}</a>`;
      }
      return `<span class="badge badge-neutral">${esc(label)}</span>`;
    })
    .filter(Boolean)
    .join('');
  return rendered ? `<div class="source-link-strip">${rendered}</div>` : '';
}

export function renderAudioAiViewHtml({
  appData = null,
  studioSub = 'podcast', // 'podcast' | 'beat_podcasts' | 'analysis'
  beatPodViewMode = 'date', // 'date' | 'show'
  beatPodShowFilter = 'all',
  podDurationMin = 3,
  podFormat = 'two_host', // 'two_host' | 'solo'
  podTopicDraft = '',
  analysisPromptDraft = '',
  jobStatus = null, // { active: boolean, message: string, error?: string }
  allEpisodes = [],
  allAnalyses = [],
  audioState = {}
}) {
  const beatPodBundle = appData?.beatPodcasts || { shows: [], episodes: [] };
  const recentBeatEpisodes = filterEpisodesLast7Days(beatPodBundle.episodes || [], beatPodBundle.updatedAt);

  const modeSwitcher = `
    <div class="card subnav-card">
      <div class="segmented-control compact-seg-3" role="tablist" aria-label="Audio, 49ers Podcasts, and Deep Analysis Modes">
        <button type="button" class="pill-btn seg-btn ${studioSub === 'beat_podcasts' ? 'active' : ''}" data-action="set-studio-sub" data-studio-sub="beat_podcasts">
          ${iconSvg('audio', 13)}
          <span>Podcasts (${recentBeatEpisodes.length})</span>
        </button>
        <button type="button" class="pill-btn seg-btn ${studioSub === 'podcast' ? 'active' : ''}" data-action="set-studio-sub" data-studio-sub="podcast">
          ${iconSvg('mic', 13)}
          <span>Auto Pod (${allEpisodes.length})</span>
        </button>
        <button type="button" class="pill-btn seg-btn ${studioSub === 'analysis' ? 'active' : ''}" data-action="set-studio-sub" data-studio-sub="analysis">
          ${iconSvg('sparkles', 13)}
          <span>AI Analysis (${allAnalyses.length})</span>
        </button>
      </div>
    </div>
  `;

  if (studioSub === 'beat_podcasts') {
    return (
      modeSwitcher +
      renderBeatPodcastsDirectory({
        shows: beatPodBundle.shows || [],
        episodes: recentBeatEpisodes,
        viewMode: beatPodViewMode,
        showFilter: beatPodShowFilter,
        updatedAt: beatPodBundle.updatedAt
      })
    );
  }

  if (studioSub === 'podcast') {
    return (
      modeSwitcher +
      renderPodcastStudio({
        appData,
        podDurationMin,
        podFormat,
        podTopicDraft,
        jobStatus,
        allEpisodes,
        audioState
      })
    );
  }

  return (
    modeSwitcher +
    renderDeepAnalysisRunner({
      appData,
      analysisPromptDraft,
      jobStatus,
      allAnalyses
    })
  );
}

function renderPodcastEpisodeRowCard(ep, { showPodcastBadge = true } = {}) {
  const launch = buildNativePodcastAppHref(ep);
  const targetAttrs = launch.isExternalHttp ? `target="_blank" rel="noopener noreferrer"` : '';
  const hasArt = ep.artworkUrl && /^https:\/\//i.test(ep.artworkUrl);
  const dateLabel = formatPodcastEpisodeDate(ep.publishedAt);
  const relLabel = ep.publishedAt ? formatRelativeAge(ep.publishedAt) : '';

  return `
    <a href="${esc(launch.href)}" ${targetAttrs}
       class="beat-podcast-ep-card"
       data-podcast-show="${esc(ep.showId)}"
       data-podcast-platform="${esc(launch.platform)}"
       aria-label="Listen to ${esc(ep.title)} from ${esc(ep.showName)} in your podcast app">
      <div class="beat-podcast-ep-top">
        ${
          hasArt
            ? `<div class="beat-podcast-art-wrap">
                 <img src="${esc(ep.artworkUrl)}" alt="${esc(ep.showName)}" width="52" height="52" loading="lazy" decoding="async" />
               </div>`
            : `<div class="studio-cover-art" aria-hidden="true">${iconSvg('audio', 17)}</div>`
        }
        <div style="min-width:0;flex:1">
          <div style="display:flex;justify-content:space-between;align-items:center;gap:6px;flex-wrap:wrap;margin-bottom:3px">
            ${
              showPodcastBadge
                ? `<span class="badge badge-gold">${esc(ep.showName)}</span>`
                : `<span class="mono" style="font-size:11px;font-weight:700;color:var(--gold-bright)">${esc(dateLabel)}</span>`
            }
            <span class="mono" style="font-size:11px;color:var(--text-muted)">
              ${showPodcastBadge && dateLabel ? `${esc(dateLabel)} • ` : ''}${relLabel ? `${esc(relLabel)} • ` : ''}${esc(ep.durationDisplay || 'Podcast')}
            </span>
          </div>
          <div class="beat-podcast-ep-title">${esc(ep.title)}</div>
          ${ep.hosts ? `<div style="font-size:11px;color:var(--text-muted);margin-top:1px">${esc(ep.hosts)}</div>` : ''}
        </div>
      </div>
      <div class="beat-podcast-ep-summary">${esc(ep.summary || '')}</div>
      <div class="beat-podcast-ep-footer">
        <span class="mono" style="font-size:11px;color:var(--text-muted)">${esc(ep.network || ep.showName)}</span>
        <span class="beat-podcast-launch-pill">
          ${iconSvg('play', 11)}
          <span>${esc(launch.ctaLabel)}</span>
          ${iconSvg('externalLink', 11)}
        </span>
      </div>
    </a>
  `;
}

function renderBeatPodcastsDirectory({
  shows = [],
  episodes = [],
  viewMode = 'date',
  showFilter = 'all',
  updatedAt = ''
}) {
  const defaultShows =
    shows.length > 0
      ? shows
      : [
          { id: 'the_gold_standard', name: 'The Gold Standard', hosts: 'Rob "Stats" Guerrera & Levin Black' },
          { id: '49ers_talk', name: '49ers Talk', hosts: 'Matt Maiocco & Laura Britt' },
          { id: '49ers_plus_minus', name: '49ers +/-', hosts: 'Tim Kawakami & SF Standard Beat' },
          { id: 'dieter_and_hutch', name: 'Dieter and Hutch', hosts: 'Dieter Kurtenbach & Jake Hutchinson' },
          { id: 'locked_on_49ers', name: 'Locked On 49ers', hosts: 'Brian Peacock & Eric Crocker' },
          { id: 'lombardi_lounge', name: 'Lombardi Lounge', hosts: 'David Lombardi' }
        ];

  const headerCard = `
    <section class="card">
      <div class="card-header">
        <div class="card-header-left">
          <div class="card-icon-badge temporal" aria-hidden="true">${iconSvg('audio', 18)}</div>
          <div class="card-title-group">
            <div class="card-eyebrow">Last 7 Days • Launches Native iOS / Android Podcast App</div>
            <h2 class="card-title">Latest 49ers Beat Podcasts</h2>
          </div>
        </div>
        ${updatedAt ? `<span class="mono" style="font-size:11px;color:var(--text-muted)">Synced ${esc(formatRelativeAge(updatedAt))}</span>` : ''}
      </div>

      <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:8px">
        <div style="font-size:12.5px;color:var(--text-secondary)">
          <strong>${episodes.length} episodes</strong> from the past 7 days across <strong>${defaultShows.length} flagship shows</strong>. Tap any episode to launch your native podcast player.
        </div>
        <div class="podcast-view-toggle" role="group" aria-label="Organize Podcasts By">
          <button type="button" class="pill-btn ${viewMode === 'date' ? 'active' : ''}"
                  data-action="set-beat-pod-view" data-pod-view="date">
            ${iconSvg('clock', 13)}
            <span>By Date</span>
          </button>
          <button type="button" class="pill-btn ${viewMode === 'show' ? 'active' : ''}"
                  data-action="set-beat-pod-view" data-pod-view="show">
            ${iconSvg('layers', 13)}
            <span>By Podcast</span>
          </button>
        </div>
      </div>

      ${
        viewMode === 'date'
          ? `<div class="pill-bar" aria-label="Filter By Show">
              <button type="button" class="pill-btn ${showFilter === 'all' ? 'active' : ''}"
                      data-action="set-beat-pod-show-filter" data-show-id="all">
                <span>All 6 Shows (${episodes.length})</span>
              </button>
              ${defaultShows
                .map(s => {
                  const cnt = episodes.filter(e => e.showId === s.id).length;
                  return `
                    <button type="button" class="pill-btn ${showFilter === s.id ? 'active' : ''}"
                            data-action="set-beat-pod-show-filter" data-show-id="${esc(s.id)}">
                      <span>${esc(s.name)} (${cnt})</span>
                    </button>
                  `;
                })
                .join('')}
            </div>`
          : ''
      }
    </section>
  `;

  if (viewMode === 'date') {
    const filteredEps =
      showFilter === 'all' ? episodes : episodes.filter(ep => ep.showId === showFilter);

    const listBody =
      filteredEps.length === 0
        ? `<section class="card"><div style="font-size:13px;color:var(--text-muted)">No episodes published in the last 7 days for this filter.</div></section>`
        : `<section class="card" style="display:flex;flex-direction:column;gap:10px" data-pod-layout="by-date">
            ${filteredEps.map(ep => renderPodcastEpisodeRowCard(ep, { showPodcastBadge: true })).join('')}
           </section>`;

    return `${headerCard}${listBody}`;
  }

  // Grouped By Podcast, and sorted newest-first by date within each podcast
  const groupedHtml = defaultShows
    .map(show => {
      const showEps = episodes
        .filter(e => e.showId === show.id)
        .sort((a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime());

      const showLaunch = buildNativePodcastAppHref({
        appleEpisodeUrl: show.appleShowUrl,
        appleShowUrl: show.appleShowUrl,
        feedUrl: show.feedUrl
      });
      const showTargetAttrs = showLaunch.isExternalHttp ? `target="_blank" rel="noopener noreferrer"` : '';
      const hasShowArt = show.artworkUrl && /^https:\/\//i.test(show.artworkUrl);

      return `
        <section class="card beat-podcast-show-group" data-podcast-group="${esc(show.id)}">
          <div class="card-header" style="margin-bottom:10px">
            <div class="card-header-left">
              ${
                hasShowArt
                  ? `<div class="beat-podcast-art-wrap" style="width:44px;height:44px">
                       <img src="${esc(show.artworkUrl)}" alt="${esc(show.name)}" width="44" height="44" loading="lazy" decoding="async" />
                     </div>`
                  : `<div class="card-icon-badge" aria-hidden="true">${iconSvg('mic', 17)}</div>`
              }
              <div class="card-title-group">
                <div class="card-eyebrow">${esc(show.hosts || show.network || '49ers Podcast')}</div>
                <h3 class="card-title">${esc(show.name)}</h3>
              </div>
            </div>
            <a href="${esc(showLaunch.href)}" ${showTargetAttrs} class="source-chip-link">
              <span>${showEps.length} in 7d</span>
              ${iconSvg('externalLink', 10)}
            </a>
          </div>

          ${
            showEps.length === 0
              ? `<div class="subcard-panel" style="font-size:12.5px;color:var(--text-muted);display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap">
                   <span>No new episodes published in the past 7 days.</span>
                   <a href="${esc(showLaunch.href)}" ${showTargetAttrs} class="ext-link">Open Show in Podcast App ${iconSvg('externalLink', 11)}</a>
                 </div>`
              : `<div style="display:flex;flex-direction:column;gap:9px">
                   ${showEps.map(ep => renderPodcastEpisodeRowCard(ep, { showPodcastBadge: false })).join('')}
                 </div>`
          }
        </section>
      `;
    })
    .join('');

  return `${headerCard}<div data-pod-layout="by-podcast" style="display:flex;flex-direction:column;gap:12px">${groupedHtml}</div>`;
}

function renderPodcastStudio({
  appData,
  podDurationMin,
  podFormat,
  podTopicDraft,
  jobStatus,
  allEpisodes,
  audioState
}) {
  const activeEp = audioState?.episode || null;
  const um = appData?.scheduleMatchup?.upcomingMatchup || {};
  const wkLabel = um.week ? `Week ${um.week}` : `Week ${appData?.meta?.currentWeek || ''}`.trim();
  const oppShort = (um.oppName || 'Opponent').split(' ').slice(-1)[0] || 'Matchup';
  const topicChips = [
    `${wkLabel} ${oppShort} Film & Trench Protection Plan`.trim(),
    '2026 Trade Window Needs, Realistic Targets & 2027 Cap Horizon',
    'DeForest Buckner + Nick Bosa Wide-9 Stunt Geometry',
    `Calibrated #1 NFC Seed Odds (${appData?.seasonal?.playoffPicture?.baselineSimulation?.sfOdds?.seed1ByePct ?? 34.5}%) & Conference Tiebreakers`
  ];

  const transcriptHtml = activeEp
    ? `
      <section class="card temporal-highlight">
        <div class="card-header">
          <div class="card-header-left">
            <div class="card-icon-badge temporal" aria-hidden="true">${iconSvg('audio', 18)}</div>
            <div class="card-title-group">
              <div class="card-eyebrow">Now Loaded • Tap Any Turn to Seek Audio</div>
              <h3 class="card-title">${esc(activeEp.title)}</h3>
            </div>
          </div>
          <span class="badge badge-gold mono">${formatTimeMmSs(audioState.currentTimeSec)} / ${formatTimeMmSs(audioState.durationSec || activeEp.durationSec)}</span>
        </div>

        <div style="display:flex;flex-direction:column;gap:7px">
          ${(activeEp.transcript || [])
            .map(
              (seg, idx) => `
            <div class="transcript-turn ${audioState.activeTurnIdx === idx ? 'active-turn' : ''}"
                 data-action="seek-podcast-turn" data-seek-sec="${seg.startSec}">
              <div class="speaker-tag">
                <span class="inline-icon-meta">${iconSvg('mic', 12)}<span>${esc(seg.speaker)} <span style="font-weight:500;color:var(--text-muted)">(${esc(seg.speakerRole || '')})</span></span></span>
                <span class="mono">${formatTimeMmSs(seg.startSec)}</span>
              </div>
              <div>${esc(seg.text)}</div>
            </div>
          `
            )
            .join('')}
        </div>
      </section>
    `
    : '';

  return `
    <!-- On-Demand Autopodcast Generator -->
    <section class="card">
      <div class="card-header">
        <div class="card-header-left">
          <div class="card-icon-badge" aria-hidden="true">${iconSvg('mic', 18)}</div>
          <div class="card-title-group">
            <div class="card-eyebrow">Live-Data Grounded • Multi-Speaker Neural Synthesis</div>
            <h2 class="card-title">Generate Custom Autopodcast</h2>
          </div>
        </div>
      </div>

      <div class="sub-label" style="margin-bottom:6px">1. Select Duration (${podDurationMin} min)</div>
      <div class="pill-bar" style="margin-bottom:8px">
        ${[
          [3, 'bolt', '3m Quick Hit'],
          [8, 'clock', '8m Commute Brief'],
          [15, 'sparkles', '15m Deep Film/Cap Dive']
        ]
          .map(
            ([mins, ic, label]) => `
          <button type="button" class="pill-btn ${Number(podDurationMin) === mins ? 'active' : ''}"
                  data-action="set-pod-duration" data-mins="${mins}">
            ${iconSvg(ic, 13)}
            <span>${esc(label)}</span>
          </button>
        `
          )
          .join('')}
      </div>

      <div style="display:flex;align-items:center;gap:10px;margin-bottom:10px">
        <span style="font-size:12px;color:var(--text-secondary)" class="mono">Custom:</span>
        <input type="range" id="podDurationSlider" min="2" max="20" step="1" value="${Number(podDurationMin)}" style="flex:1" aria-label="Custom Podcast Duration Minutes" />
        <span class="badge badge-gold mono">${podDurationMin} min</span>
      </div>

      <div class="sub-label" style="margin-bottom:6px">2. Host Format</div>
      <div class="segmented-control compact-seg" style="margin-bottom:10px" role="group" aria-label="Host Format">
        <button type="button" class="pill-btn seg-btn ${podFormat === 'two_host' ? 'active' : ''}" data-action="set-pod-format" data-format="two_host">
          ${iconSvg('mic', 13)}
          <span>Two-Host (Marcus &amp; Elena)</span>
        </button>
        <button type="button" class="pill-btn seg-btn ${podFormat === 'solo' ? 'active' : ''}" data-action="set-pod-format" data-format="solo">
          ${iconSvg('target', 13)}
          <span>Solo Briefing</span>
        </button>
      </div>

      <div class="sub-label" style="margin-bottom:6px">3. Topic or Specific Football Question</div>
      <div class="pill-bar" style="margin-bottom:8px">
        ${topicChips
          .map(
            t => `
          <button type="button" class="btn-ghost" style="flex-shrink:0" data-action="fill-pod-topic" data-topic="${esc(t)}">
            ${iconSvg('plus', 12)}
            <span>${esc(t)}</span>
          </button>
        `
          )
          .join('')}
      </div>

      <input type="text" id="podTopicInput" class="text-input" style="margin-bottom:10px"
             placeholder="e.g., How should SF structure Nick Bosa & Purdy's 2027 cap hits?"
             value="${esc(podTopicDraft)}" aria-label="Podcast Topic" />

      ${
        jobStatus?.active
          ? `<div class="job-progress-box" style="margin-bottom:10px">${iconSvg('clock', 14)}<span>${esc(jobStatus.message)}</span></div>`
          : jobStatus?.error
            ? `<div class="alert-banner-danger" style="margin-bottom:10px">${iconSvg('alert', 14)}<span>${esc(jobStatus.error)}</span></div>`
            : ''
      }

      <button type="button" class="btn-primary" style="width:100%" data-action="generate-autopodcast" ${jobStatus?.active ? 'disabled' : ''}>
        ${iconSvg('mic', 15)}
        <span>Generate ${podDurationMin}-Min Audio Briefing</span>
      </button>
    </section>

    ${transcriptHtml}

    <!-- Audio Briefing Library -->
    <section class="card">
      <div class="card-eyebrow">Instant Play • Lock-Screen Controls</div>
      <h3 class="card-title" style="margin-bottom:9px">Audio Briefing Library (${allEpisodes.length})</h3>

      <div style="display:flex;flex-direction:column;gap:8px">
        ${allEpisodes
          .map(ep => {
            const isCurrent = activeEp?.id === ep.id;
            const isPlayingNow = isCurrent && audioState?.isPlaying;
            return `
              <div class="brief-card" style="border-color:${isCurrent ? 'var(--gold)' : 'var(--border-subtle)'}">
                <div class="episode-row-head">
                  <div class="studio-cover-art" aria-hidden="true">
                    ${iconSvg('mic', 17)}
                    <span class="studio-wave-bars">
                      <span style="height:${isPlayingNow ? '9px' : '4px'}"></span>
                      <span style="height:${isPlayingNow ? '5px' : '9px'}"></span>
                      <span style="height:10px"></span>
                      <span style="height:${isPlayingNow ? '8px' : '5px'}"></span>
                      <span style="height:6px"></span>
                    </span>
                  </div>
                  <div style="min-width:0;flex:1;display:flex;flex-direction:column;gap:4px">
                    <div style="display:flex;justify-content:space-between;align-items:center;gap:6px;flex-wrap:wrap">
                      <span class="badge ${ep.audioUrl ? 'badge-positive' : 'badge-gold'}">${esc(ep.presetLabel || ep.format)}</span>
                      <span class="mono" style="font-size:11px;color:var(--text-muted)">
                        ${formatTimeMmSs(ep.durationSec)} • ${esc(ep.createdBy)} • ${formatRelativeAge(ep.createdAt)}
                      </span>
                    </div>
                    <div style="font-weight:800;font-size:14px">${esc(ep.title)}</div>
                    <div style="font-size:12px;color:var(--text-secondary)">${esc(ep.topic)}</div>
                  </div>
                </div>
                ${renderSourceChips(ep.sourceLinks || [])}
                <div style="display:flex;justify-content:space-between;align-items:center;margin-top:4px">
                  <span style="font-size:11.5px;color:var(--gold-bright)">${esc(ep.format)}</span>
                  <button type="button" class="btn-primary" data-action="play-episode" data-episode-id="${esc(ep.id)}">
                    ${iconSvg(isPlayingNow ? 'pause' : 'play', 13)}
                    <span>${isPlayingNow ? 'Playing' : 'Play Episode'}</span>
                  </button>
                </div>
              </div>
            `;
          })
          .join('')}
      </div>
    </section>
  `;
}

function renderDeepAnalysisRunner({ appData, analysisPromptDraft, jobStatus, allAnalyses }) {
  const um = appData?.scheduleMatchup?.upcomingMatchup || {};
  const wkLabel = um.week ? `Week ${um.week}` : 'upcoming';
  const oppLabel = um.oppName || 'opponent';
  const quickPrompts = [
    'Assess 49ers 2026 trade window needs, realistic seller targets, 9/18ths rental math & 2027 -$31.54M cap horizon',
    `Evaluate calibrated 10,000-run NFC #1 seed bye odds (${appData?.seasonal?.playoffPicture?.baselineSimulation?.sfOdds?.seed1ByePct ?? 34.5}%), NFC North cannibalization & Week 11 MIN tiebreaker`,
    'Evaluate Brock Purdy 2026 EPA/play, CPOE, and pressure-to-sack avoidance vs. two-high shells',
    `How DC Raheem Morris pairs DeForest Buckner, Keion White & Nick Bosa in ${wkLabel} vs. ${oppLabel}`
  ];

  return `
    <section class="card">
      <div class="card-header">
        <div class="card-header-left">
          <div class="card-icon-badge" aria-hidden="true">${iconSvg('sparkles', 18)}</div>
          <div class="card-title-group">
            <div class="card-eyebrow">Live Roster &amp; Injury Grounded • Play-by-Play EPA • Cap</div>
            <h2 class="card-title">AI Scouting &amp; Cap Analysis</h2>
          </div>
        </div>
      </div>
      <div style="font-size:12px;color:var(--text-secondary);margin-bottom:8px">
        Strictly grounded in live ${esc(appData?.meta?.teamRecord || '2026')} standings, current active 53-man roster, up-to-the-minute injury designations, and OverTheCap ledgers.
      </div>

      <div class="pill-bar" style="margin-bottom:8px">
        ${quickPrompts
          .map(
            p => `
          <button type="button" class="btn-ghost" style="flex-shrink:0" data-action="fill-analysis-prompt" data-prompt="${esc(p)}">
            ${iconSvg('plus', 12)}
            <span>${esc(p.slice(0, 44))}…</span>
          </button>
        `
          )
          .join('')}
      </div>

      <textarea id="analysisPromptInput" class="textarea-input" rows="3" style="margin-bottom:10px"
                placeholder="Ask any 49ers scheme, EPA, injury, cap, trade, or draft question…"
                aria-label="Deep Analysis Question">${esc(analysisPromptDraft)}</textarea>

      ${
        jobStatus?.active
          ? `<div class="job-progress-box" style="margin-bottom:10px">${iconSvg('clock', 14)}<span>${esc(jobStatus.message)}</span></div>`
          : jobStatus?.error
            ? `<div class="alert-banner-danger" style="margin-bottom:10px">${iconSvg('alert', 14)}<span>${esc(jobStatus.error)}</span></div>`
            : ''
      }

      <button type="button" class="btn-primary" style="width:100%" data-action="run-deep-analysis" ${jobStatus?.active ? 'disabled' : ''}>
        ${iconSvg('sparkles', 15)}
        <span>Run Deep Analysis</span>
      </button>
    </section>

    <section class="card">
      <div class="card-eyebrow">Film &amp; Salary Cap Breakdowns</div>
      <h3 class="card-title" style="margin-bottom:10px">Saved Scouting &amp; Cap Reports (${allAnalyses.length})</h3>

      <div style="display:flex;flex-direction:column;gap:10px">
        ${allAnalyses
          .map(
            rep => `
          <article class="brief-card">
            <div style="display:flex;justify-content:space-between;align-items:center;gap:6px;flex-wrap:wrap">
              <span class="badge badge-gold">${esc(rep.category)}</span>
              <span class="mono" style="font-size:11px;color:var(--text-muted)">By ${esc(rep.createdBy)} • ${formatRelativeAge(rep.createdAt)}</span>
            </div>
            <h4 style="margin:2px 0;font-size:14.5px">${esc(rep.title)}</h4>
            ${renderMarkdownSafe(rep.markdown)}
            <div style="border-top:1px solid var(--border-subtle);padding-top:6px;display:flex;align-items:center;gap:6px;flex-wrap:wrap">
              <span style="font-size:11px;color:var(--text-muted)">Sources:</span>
              ${renderSourceChips(rep.sourcesCited || [])}
            </div>
          </article>
        `
          )
          .join('')}
      </div>
    </section>
  `;
}
