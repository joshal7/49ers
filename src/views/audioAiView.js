/**
 * Autopodcast Studio, Shared Episode Library & On-Demand Deep Analysis Runner View
 */

import { esc, renderMarkdownSafe, formatRelativeAge } from './uiHelpers.js';
import { iconSvg } from './icons.js';
import { formatTimeMmSs } from '../components/audioPlayer.js';

export function renderAudioAiViewHtml({
  studioSub = 'podcast', // 'podcast' | 'analysis'
  podDurationMin = 3,
  podFormat = 'two_host', // 'two_host' | 'solo'
  podTopicDraft = '',
  analysisPromptDraft = '',
  jobStatus = null, // { active: boolean, message: string, error?: string }
  allEpisodes = [],
  allAnalyses = [],
  audioState = {}
}) {
  const modeSwitcher = `
    <div class="card">
      <div class="segmented-control" role="tablist" aria-label="Autopodcast and Deep AI Modes">
        <button type="button" class="pill-btn seg-btn ${studioSub === 'podcast' ? 'active' : ''}" data-action="set-studio-sub" data-studio-sub="podcast">
          ${iconSvg('mic', 14)}
          <span>Autopodcast Studio (${allEpisodes.length})</span>
        </button>
        <button type="button" class="pill-btn seg-btn ${studioSub === 'analysis' ? 'active' : ''}" data-action="set-studio-sub" data-studio-sub="analysis">
          ${iconSvg('sparkles', 14)}
          <span>Deep Analysis Runner (${allAnalyses.length})</span>
        </button>
      </div>
    </div>
  `;

  if (studioSub === 'podcast') {
    return (
      modeSwitcher +
      renderPodcastStudio({
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
      analysisPromptDraft,
      jobStatus,
      allAnalyses
    })
  );
}

function renderPodcastStudio({
  podDurationMin,
  podFormat,
  podTopicDraft,
  jobStatus,
  allEpisodes,
  audioState
}) {
  const activeEp = audioState?.episode || null;
  const topicChips = [
    'Week 9 Raiders Film & Maxx Crosby Protection Plan',
    'DeForest Buckner + Nick Bosa Wide-9 Stunt Geometry',
    '2026–2028 Cap Rollover & Brandon Aiyuk Contract Math',
    'Path to #1 NFC Seed & Tiebreakers vs. Detroit/Philly'
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
            <div class="card-eyebrow">Custom Duration • Multi-Speaker Neural Synthesis</div>
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
      <div style="display:flex;gap:8px;margin-bottom:10px;flex-wrap:wrap">
        <button type="button" class="pill-btn ${podFormat === 'two_host' ? 'active' : ''}" data-action="set-pod-format" data-format="two_host">
          ${iconSvg('mic', 13)}
          <span>Two-Host Analytical Banter (Marcus &amp; Elena)</span>
        </button>
        <button type="button" class="pill-btn ${podFormat === 'solo' ? 'active' : ''}" data-action="set-pod-format" data-format="solo">
          ${iconSvg('target', 13)}
          <span>Solo Executive Briefing</span>
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
        <span>Generate ${podDurationMin}-Min Autopodcast &amp; Share With Group</span>
      </button>
    </section>

    ${transcriptHtml}

    <!-- Shared Friend-Group Episode Library -->
    <section class="card">
      <div class="card-eyebrow">Cached &amp; Instant Play • iOS Lock-Screen MediaSession Enabled</div>
      <h3 class="card-title" style="margin-bottom:9px">Shared Friend-Group Episode Library (${allEpisodes.length})</h3>

      <div style="display:flex;flex-direction:column;gap:8px">
        ${allEpisodes
          .map(ep => {
            const isCurrent = activeEp?.id === ep.id;
            const isPlayingNow = isCurrent && audioState?.isPlaying;
            return `
              <div class="brief-card" style="border-color:${isCurrent ? 'var(--gold)' : 'var(--border-subtle)'}">
                <div style="display:flex;justify-content:space-between;align-items:center;gap:6px;flex-wrap:wrap">
                  <span class="badge ${ep.audioUrl ? 'badge-positive' : 'badge-gold'}">${esc(ep.presetLabel || ep.format)}</span>
                  <span class="mono" style="font-size:11px;color:var(--text-muted)">
                    ${formatTimeMmSs(ep.durationSec)} • ${esc(ep.createdBy)} • ${formatRelativeAge(ep.createdAt)}
                  </span>
                </div>
                <div style="font-weight:800;font-size:14px">${esc(ep.title)}</div>
                <div style="font-size:12px;color:var(--text-secondary)">${esc(ep.topic)}</div>
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

function renderDeepAnalysisRunner({ analysisPromptDraft, jobStatus, allAnalyses }) {
  const quickPrompts = [
    'Evaluate Brock Purdy 2026 EPA/play, CPOE, and pressure-to-sack avoidance vs. two-high shells',
    'Cap & roster breakdown of Brandon Aiyuk reinstatement meeting and Post-June 1 trade dead money',
    'How DeForest Buckner and Osa Odighizuwa change Nick Bosa pass-rush win rate starting Week 9'
  ];

  return `
    <section class="card">
      <div class="card-header">
        <div class="card-header-left">
          <div class="card-icon-badge" aria-hidden="true">${iconSvg('sparkles', 18)}</div>
          <div class="card-title-group">
            <div class="card-eyebrow">Multi-Source Synthesis • Shared Group Cache</div>
            <h2 class="card-title">On-Demand Deep Analysis Runner</h2>
          </div>
        </div>
      </div>
      <div style="font-size:12px;color:var(--text-secondary);margin-bottom:8px">
        Synthesizes live play-by-play EPA, OverTheCap contract tables, and beat transcripts into a structured report (cached for all ~25 friends).
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
                placeholder="Ask any 49ers scheme, EPA, injury prior, cap, trade, or draft question…"
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
      <div class="card-eyebrow">Zero Fluff • Fact &amp; Film Reports</div>
      <h3 class="card-title" style="margin-bottom:10px">Shared Friend-Group Intelligence Reports (${allAnalyses.length})</h3>

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
            <div style="font-size:11px;color:var(--text-muted);border-top:1px solid var(--border-subtle);padding-top:5px">
              Sources: ${esc((rep.sourcesCited || []).join(' • '))}
            </div>
          </article>
        `
          )
          .join('')}
      </div>
    </section>
  `;
}
