/**
 * Settings (Theme, Feed Density, Quiet Alerts, Outlet & Reporter Toggles, Cloud Sync)
 * & Universal Instant Search Sheet Renderer
 */

import {
  esc,
  formatRelativeAge,
  playProbBadgeClass,
  renderPlayerAvatarHtml
} from './uiHelpers.js';
import { iconSvg } from './icons.js';
import { sanitizeExternalUrl } from '../engine/linkIntegrity.js';
import {
  buildXBeatListSearchUrl,
  getReporterTrustTier
} from '../engine/beatAttributionEngine.js';
import {
  evaluatePushSupportStatus,
  runUniversalSearch
} from '../engine/digestExperienceEngine.js';
import {
  AI_STUDIO_DIRECT_KEY_URL,
  renderGeminiApiKeyStepByStepGuideHtml
} from './audioAiView.js';

export function renderSettingsSheetHtml({
  userPrefs,
  reportersData,
  reporterSearch = '',
  pushStatusNotice = ''
}) {
  const outlets = reportersData?.outlets || [];
  const reporters = reportersData?.reporters || [];
  const disabledOutlets = new Set(userPrefs?.disabledOutlets || []);
  const disabledReps = new Set(userPrefs?.disabledReporterIds || []);
  const feedDensity = userPrefs?.feedDensity === 'compact' ? 'compact' : 'rich';
  const pushPrefs = userPrefs?.pushAlerts || {
    enabled: false,
    channels: { tier1Breaking: true, dailyBriefReady: true, practiceDowngrades: false }
  };
  const pushSupport = evaluatePushSupportStatus();
  const pushStatusLabel = pushPrefs.enabled
    ? pushPrefs.endpoint
      ? 'Push Active'
      : 'Active (Local)'
    : pushSupport.reason === 'ios_requires_pwa'
      ? 'Add to Home Screen'
      : pushSupport.permission === 'denied'
        ? 'Blocked in Browser'
        : 'Off';

  const q = String(reporterSearch || '').toLowerCase().trim();
  const visibleReporters = reporters.filter(
    r => !q || r.name.toLowerCase().includes(q) || r.handle.toLowerCase().includes(q) || r.role.toLowerCase().includes(q)
  );

  return `
    <!-- Theme & Feed Preferences -->
    <div class="subcard-panel" style="display:flex;flex-direction:column;gap:10px">
      <div class="sub-label">1. Display &amp; Feed Preferences</div>

      <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap">
        <div style="min-width:0;flex:1 1 170px">
          <strong>App Theme</strong>
          <div style="font-size:11.5px;color:var(--text-secondary)">Levi's Night Game (Dark) vs. '94 Throwback (Light)</div>
        </div>
        <button type="button" class="btn-secondary" style="white-space:nowrap;flex-shrink:0" data-action="toggle-theme">
          ${iconSvg(userPrefs.theme === 'light' ? 'moon' : 'sun', 14)}
          <span>${userPrefs.theme === 'light' ? 'Night Game Dark' : "'94 White & Gold"}</span>
        </button>
      </div>

      <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap" data-settings-feed-density>
        <div style="min-width:0;flex:1 1 160px">
          <strong>Feed Density</strong>
          <div style="font-size:11.5px;color:var(--text-secondary)">Rich editorial cards vs. compact headline scan</div>
        </div>
        <div class="segmented-control compact-seg" role="group" aria-label="Feed Reading Density" style="flex-shrink:0">
          <button type="button" class="pill-btn seg-btn ${feedDensity === 'rich' ? 'active' : ''}" data-action="set-feed-density" data-density="rich">
            <span>Rich</span>
          </button>
          <button type="button" class="pill-btn seg-btn ${feedDensity === 'compact' ? 'active' : ''}" data-action="set-feed-density" data-density="compact">
            ${iconSvg('layoutList', 12)}
            <span>Compact</span>
          </button>
        </div>
      </div>

      <label style="display:flex;justify-content:space-between;align-items:center;gap:10px;cursor:pointer">
        <div>
          <strong>Mute Opinion Columnists</strong>
          <div style="font-size:11.5px;color:var(--text-secondary)">Hides opinion commentary while keeping beat reporting &amp; film</div>
        </div>
        <input type="checkbox" data-action="toggle-pref-bool" data-pref-key="muteHotTakePersonalities"
               ${userPrefs.muteHotTakePersonalities ? 'checked' : ''} style="width:20px;height:20px;accent-color:var(--scarlet)" />
      </label>

      <label style="display:flex;justify-content:space-between;align-items:center;gap:10px;cursor:pointer">
        <div>
          <strong>Analytics, Film &amp; Cap Only</strong>
          <div style="font-size:11.5px;color:var(--text-secondary)">Scopes stream to EPA, All-22 film &amp; salary cap coverage</div>
        </div>
        <input type="checkbox" data-action="toggle-pref-bool" data-pref-key="strictAnalyticsFilmOnly"
               ${userPrefs.strictAnalyticsFilmOnly ? 'checked' : ''} style="width:20px;height:20px;accent-color:var(--scarlet)" />
      </label>
    </div>

    <!-- Quiet Opt-In Push Alerts (Zero Clickbait, Zero Score Spam) -->
    <div class="subcard-panel" style="display:flex;flex-direction:column;gap:8px" data-settings-push-alerts>
      <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap">
        <div class="sub-label" style="margin:0">2. Quiet Alerts (Opt-In Only)</div>
        <span class="badge ${pushPrefs.enabled ? 'badge-positive' : 'badge-neutral'} mono" data-push-status-badge>${esc(pushStatusLabel)}</span>
      </div>
      <div style="font-size:11.5px;color:var(--text-secondary);line-height:1.4">
        High-signal alerts only — zero live score spam, zero clickbait promos.
        ${pushSupport.isIosBrowserTab ? '<strong>iPhone tip:</strong> Tap Share → Add to Home Screen to unlock iOS Web Push.' : ''}
      </div>

      <div style="display:flex;flex-direction:column;gap:7px">
        <label style="display:flex;justify-content:space-between;align-items:center;gap:10px;cursor:pointer">
          <div>
            <strong style="font-size:12.5px">Tier-1 Breaking Only</strong>
            <div style="font-size:11px;color:var(--text-secondary)">Trades, major injury/IR moves &amp; official game-day inactives</div>
          </div>
          <input type="checkbox" data-action="toggle-push-channel" data-push-channel="tier1Breaking"
                 ${pushPrefs.channels?.tier1Breaking !== false ? 'checked' : ''} style="width:19px;height:19px;accent-color:var(--scarlet)" />
        </label>

        <label style="display:flex;justify-content:space-between;align-items:center;gap:10px;cursor:pointer">
          <div>
            <strong style="font-size:12.5px">Daily 5:00 PM PT Top-News Brief</strong>
            <div style="font-size:11px;color:var(--text-secondary)">One daily digest ping when the synthesized briefing drops</div>
          </div>
          <input type="checkbox" data-action="toggle-push-channel" data-push-channel="dailyBriefReady"
                 ${pushPrefs.channels?.dailyBriefReady !== false ? 'checked' : ''} style="width:19px;height:19px;accent-color:var(--scarlet)" />
        </label>

        <label style="display:flex;justify-content:space-between;align-items:center;gap:10px;cursor:pointer">
          <div>
            <strong style="font-size:12.5px">Practice Downgrades (DNP / Out)</strong>
            <div style="font-size:11px;color:var(--text-secondary)">Alert when a key starter drops to DNP or is ruled Out</div>
          </div>
          <input type="checkbox" data-action="toggle-push-channel" data-push-channel="practiceDowngrades"
                 ${pushPrefs.channels?.practiceDowngrades ? 'checked' : ''} style="width:19px;height:19px;accent-color:var(--scarlet)" />
        </label>
      </div>

      <div style="display:flex;gap:7px;flex-wrap:wrap;margin-top:2px">
        <button type="button" class="${pushPrefs.enabled ? 'btn-ghost' : 'btn-secondary'}" data-action="toggle-push-subscription" style="flex:1 1 160px">
          ${iconSvg('bell', 13)}
          <span>${pushPrefs.enabled ? 'Disable Quiet Alerts' : 'Enable Quiet Alerts'}</span>
        </button>
        ${
          pushPrefs.enabled
            ? `<button type="button" class="btn-ghost" data-action="test-quiet-alert">
                 <span>Send Test</span>
               </button>`
            : ''
        }
      </div>
      ${pushStatusNotice ? `<div style="font-size:11.5px;color:var(--gold-bright)" data-push-notice>${esc(pushStatusNotice)}</div>` : ''}
    </div>

    <!-- Podcast Preferences (Host Format & Default Duration) -->
    <div class="subcard-panel" style="display:flex;flex-direction:column;gap:8px" data-settings-podcast-prefs>
      <div class="sub-label">3. Custom Podcast Preferences</div>
      <div>
        <div style="font-size:11.5px;color:var(--text-secondary);margin-bottom:5px">Host Format</div>
        <div class="segmented-control compact-seg" role="group" aria-label="Podcast Host Format">
          <button type="button" class="pill-btn seg-btn ${(userPrefs.podFormat || 'two_host') === 'two_host' ? 'active' : ''}" data-action="set-pod-format" data-format="two_host">
            ${iconSvg('mic', 13)}
            <span>Two-Host (Marcus &amp; Elena)</span>
          </button>
          <button type="button" class="pill-btn seg-btn ${userPrefs.podFormat === 'solo' ? 'active' : ''}" data-action="set-pod-format" data-format="solo">
            ${iconSvg('target', 13)}
            <span>Solo Briefing</span>
          </button>
        </div>
      </div>
      <div>
        <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;margin-bottom:3px">
          <label style="font-size:11.5px;color:var(--text-secondary)" for="prefPodDurationSlider">Default Podcast Length</label>
          <span class="badge badge-gold mono" id="prefPodDurationBadge">${Number(userPrefs.defaultPodDurationMin || 3)} min</span>
        </div>
        <input type="range" id="prefPodDurationSlider" min="2" max="20" step="1" value="${Number(userPrefs.defaultPodDurationMin || 3)}" style="width:100%" aria-label="Default Podcast Length Minutes" />
      </div>
    </div>

    <!-- Display Name, API Key & Cloud Sync -->
    <div class="subcard-panel" style="display:flex;flex-direction:column;gap:8px">
      <div class="sub-label">4. Profile, API Key &amp; Cloud Sync</div>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(135px,1fr));gap:8px">
        <div>
          <label style="font-size:11px;color:var(--text-secondary)" for="prefAuthorInput">Your Display Name</label>
          <input type="text" id="prefAuthorInput" class="text-input" value="${esc(userPrefs.authorName || 'Josh')}" />
        </div>
        <div>
          <label style="font-size:11px;color:var(--text-secondary)" for="prefPasscodeInput">Sync Passcode</label>
          <input type="password" id="prefPasscodeInput" class="text-input" placeholder="Optional PIN" value="${esc(userPrefs.groupPasscode || '')}" />
        </div>
      </div>
      <div>
        ${
          !userPrefs.geminiApiKey
            ? `<details class="gemini-guide-banner" style="margin-bottom:6px">
                 <summary class="gemini-guide-link-btn" style="list-style:none">
                   ${iconSvg('helpCircle', 14)}
                   <span>New here? Step-by-step instructions to get your free 1-time Gemini API key</span>
                 </summary>
                 ${renderGeminiApiKeyStepByStepGuideHtml({ includeFocusButton: false })}
               </details>`
            : ''
        }
        <div style="display:flex;justify-content:space-between;align-items:center;gap:6px;flex-wrap:wrap;margin-bottom:3px">
          <label style="font-size:11px;color:var(--text-secondary)" for="prefGeminiKeyInput">Google Gemini API Key (Private on This Device • Unlocks Daily Briefs, Auto Pod &amp; AI Analysis)</label>
          <a href="${AI_STUDIO_DIRECT_KEY_URL}" target="_blank" rel="noopener noreferrer" class="ext-link" style="font-size:11px">Get Free AI Studio Key ${iconSvg('externalLink', 10)}</a>
        </div>
        <input type="password" id="prefGeminiKeyInput" class="text-input" placeholder="AIza..." autocomplete="off" value="${esc(userPrefs.geminiApiKey || '')}" />
      </div>
      <div>
        <label style="font-size:11px;color:var(--text-secondary)" for="prefWorkerUrlInput">Cloudflare Worker URL (Optional Shared Group Cache)</label>
        <input type="url" id="prefWorkerUrlInput" class="text-input" placeholder="https://49ers-worker.<subdomain>.workers.dev" value="${esc(userPrefs.workerBaseUrl || '')}" />
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <button type="button" class="btn-secondary" style="flex:1 1 160px" data-action="save-group-config">
          ${iconSvg('save', 14)}
          <span>Save AI &amp; Sync Settings</span>
        </button>
        ${
          userPrefs.geminiApiKey
            ? `<button type="button" class="btn-ghost" data-action="clear-gemini-key">
                 ${iconSvg('trash', 13)}
                 <span>Clear Key</span>
               </button>`
            : ''
        }
      </div>
    </div>

    <!-- Direct X Beat Lists (Synced Live with Enabled Reporters Below) -->
    <div id="settingsSourcesSection" class="subcard-panel" data-settings-x-beat-lists style="display:flex;flex-direction:column;gap:7px">
      <div class="sub-label" style="margin:0">5. Direct X Beat Lists</div>
      <div style="font-size:11.5px;color:var(--text-secondary)">Live X searches synced with your enabled beat voices below.</div>
      <div class="x-beat-launch-strip" aria-label="Live X Beat Search">
        <a href="${esc(buildXBeatListSearchUrl('trusted', { reporters, userPrefs }))}" target="_blank" rel="noopener noreferrer" class="source-chip-link x-beat-chip" title="All enabled Tier 1–3 49ers Beat Reporters, Columnists &amp; Official Team handles from Settings">
          <span>Trusted Beat</span>${iconSvg('externalLink', 10)}
        </a>
        <a href="${esc(buildXBeatListSearchUrl('film', { reporters, userPrefs }))}" target="_blank" rel="noopener noreferrer" class="source-chip-link x-beat-chip" title="All enabled Tier 1–3 49ers Film, Analytics &amp; Podcast Analysts from Settings">
          <span>Film &amp; Analysts</span>${iconSvg('externalLink', 10)}
        </a>
        <a href="${esc(buildXBeatListSearchUrl('injuries', { reporters, userPrefs }))}" target="_blank" rel="noopener noreferrer" class="source-chip-link x-beat-chip" title="Live 49ers sideline, practice &amp; warmup injury updates across Tier 1–3 beat voices">
          <span>Injury Scoops</span>${iconSvg('externalLink', 10)}
        </a>
        <a href="${esc(buildXBeatListSearchUrl('insiders', { reporters, userPrefs }))}" target="_blank" rel="noopener noreferrer" class="source-chip-link x-beat-chip" title="All enabled Tier 1–3 National NFL Insiders, Draft Evaluators &amp; League Analysts scoped to 49ers">
          <span>NFL Insiders</span>${iconSvg('externalLink', 10)}
        </a>
      </div>
    </div>

    <!-- Outlet Toggles -->
    <div class="subcard-panel" style="display:flex;flex-direction:column;gap:7px">
      <div class="sub-label">6. News Outlets &amp; Channels (${outlets.length})</div>
      <div class="settings-outlets-grid">
        ${outlets
          .map(o => {
            const enabled = !disabledOutlets.has(o.id);
            return `
              <button type="button" class="pill-btn ${enabled ? 'active' : ''}"
                      data-action="toggle-outlet" data-outlet-id="${esc(o.id)}">
                ${iconSvg(enabled ? 'check' : 'close', 12)}
                <span>${esc(o.name)}</span>
              </button>
            `;
          })
          .join('')}
      </div>
    </div>

    <!-- Individual Beat Reporters & Insiders -->
    <div class="subcard-panel" style="display:flex;flex-direction:column;gap:8px">
      <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap">
        <div class="sub-label">7. Beat Reporters &amp; Analysts (${reporters.length})</div>
        <div style="display:flex;gap:6px">
          <button type="button" class="btn-ghost" data-action="enable-all-reporters">${iconSvg('check', 12)}<span>Enable All</span></button>
        </div>
      </div>

      <div class="search-input-wrap">
        ${iconSvg('search', 15, 'search-input-icon')}
        <input type="search" id="reporterFilterSearchInput" class="text-input has-lead-icon"
               placeholder="Search Maiocco, Barrows, Lombardi, Wagoner, Schefter…"
               value="${esc(reporterSearch)}" aria-label="Search Reporters" />
      </div>

      <div style="display:flex;flex-direction:column;gap:6px;max-height:280px;overflow-y:auto">
        ${visibleReporters
          .map(r => {
            const enabled = !disabledReps.has(r.id);
            const repLink = sanitizeExternalUrl(r.xUrl || r.profileUrl, null);
            const tier = Number(r.trustTier) || getReporterTrustTier(r.id);
            const tierCls = tier === 1 ? 'badge-gold' : 'badge-neutral';
            const tierShort = tier === 1 ? 'Tier 1 Trusted' : tier === 2 ? 'Tier 2 Beat/Film' : 'Tier 3 Viable';
            return `
              <label style="display:flex;justify-content:space-between;align-items:center;gap:8px;padding:7px 9px;border-radius:8px;background:var(--bg-elevated);border:1px solid var(--border-subtle);cursor:pointer">
                <div style="min-width:0">
                  <div style="font-weight:700;font-size:13px;display:flex;align-items:center;gap:6px;flex-wrap:wrap">
                    <span>${esc(r.name)}</span>
                    <span class="badge ${tierCls}" style="font-size:9.5px;padding:1px 6px">${esc(tierShort)}</span>
                    ${
                      repLink
                        ? `<a href="${esc(repLink)}" target="_blank" rel="noopener noreferrer" onclick="event.stopPropagation()" style="color:var(--gold-bright);font-size:11px;display:inline-flex;align-items:center;gap:3px">${esc(r.handle)} ${iconSvg('externalLink', 10)}</a>`
                        : `<span style="color:var(--gold-bright);font-size:11px">${esc(r.handle)}</span>`
                    }
                  </div>
                  <div style="font-size:11px;color:var(--text-secondary)">${esc(r.role)}</div>
                </div>
                <input type="checkbox" data-action="toggle-reporter" data-reporter-id="${esc(r.id)}"
                       ${enabled ? 'checked' : ''} style="width:19px;height:19px;flex-shrink:0;accent-color:var(--scarlet)" />
              </label>
            `;
          })
          .join('')}
      </div>
    </div>
  `;
}

export function renderUniversalSearchSheetHtml({
  query = '',
  appData = null,
  filteredRawItems = [],
  allEpisodes = [],
  allAnalyses = []
}) {
  const res = runUniversalSearch(query, {
    appData,
    filteredRawItems,
    allEpisodes,
    allAnalyses
  });
  const hasQuery = Boolean(res.query);

  // Suggested quick pills when query is empty (top injured starters + key shortcuts)
  const injuredSuggestions = (appData?.health?.practiceReport || [])
    .slice(0, 3)
    .map(p => p?.name)
    .filter(Boolean);
  const quickChips = [...injuredSuggestions, 'Purdy', 'Cap', 'Film', 'Playoffs'].slice(0, 6);

  const playersHtml =
    res.players.length > 0
      ? `
        <div class="search-group" data-search-group="players">
          <div class="sub-label">Players (${res.players.length})</div>
          <div class="search-result-list">
            ${res.players
              .map(
                p => `
              <button type="button" class="search-result-row" data-action="search-open-player" data-player-id="${esc(p.id)}">
                ${renderPlayerAvatarHtml(p, 30)}
                <div class="search-result-meta">
                  <div class="search-result-title"><strong>${esc(p.name)}</strong> <span class="mono" style="color:var(--gold-bright);font-size:11px">${esc(p.position)}${p.jersey != null ? ` #${p.jersey}` : ''}</span></div>
                  <div class="search-result-sub">${esc(p.injuryType ? `${p.injuryType} • ${p.playBadgeLabel || ''}` : p.rosterBucket === 'ir' ? 'Injured Reserve' : 'Active 53')}</div>
                </div>
                ${
                  p.playBadgeLabel && p.injuryType
                    ? `<span class="badge ${playProbBadgeClass(p.playProbabilityPct)} mono" style="font-size:10px">${esc(p.playBadgeLabel)}</span>`
                    : `<span class="search-row-arrow">${iconSvg('arrowRight', 13)}</span>`
                }
              </button>
            `
              )
              .join('')}
          </div>
        </div>
      `
      : '';

  const newsHtml =
    res.news.length > 0
      ? `
        <div class="search-group" data-search-group="news">
          <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;margin-bottom:5px">
            <div class="sub-label" style="margin:0">News &amp; Film (${res.totalNewsMatches})</div>
            <button type="button" class="btn-ghost btn-compact" data-action="search-filter-news-feed" data-search-query="${esc(res.query)}">
              <span>Filter Feed</span>
              ${iconSvg('arrowRight', 11)}
            </button>
          </div>
          <div class="search-result-list">
            ${res.news
              .map(
                n => `
              <a href="${esc(n.href)}" target="_blank" rel="noopener noreferrer" class="search-result-row search-result-link" data-read-key="${esc(n.id || n.href)}">
                <div class="search-result-meta">
                  <div class="search-result-title">${esc(n.title.slice(0, 120))}${n.title.length > 120 ? '…' : ''}</div>
                  <div class="search-result-sub">${esc(n.author)}${n.publishedAt ? ` • ${esc(formatRelativeAge(n.publishedAt))}` : ''}</div>
                </div>
                <span class="search-row-arrow">${iconSvg('externalLink', 12)}</span>
              </a>
            `
              )
              .join('')}
          </div>
        </div>
      `
      : '';

  const audioHtml =
    res.audioAndAi.length > 0
      ? `
        <div class="search-group" data-search-group="audio">
          <div class="sub-label">Podcasts &amp; AI Briefs (${res.audioAndAi.length})</div>
          <div class="search-result-list">
            ${res.audioAndAi
              .map(
                a => `
              <button type="button" class="search-result-row" data-action="search-jump-audio" data-audio-kind="${esc(a.kind)}" data-show-id="${esc(a.showId || '')}">
                <span class="search-result-icon" aria-hidden="true">${iconSvg(a.kind === 'analysis' ? 'sparkles' : 'audio', 14)}</span>
                <div class="search-result-meta">
                  <div class="search-result-title">${esc(a.title)}</div>
                  <div class="search-result-sub">${esc(a.subtitle)}${a.publishedAt ? ` • ${esc(formatRelativeAge(a.publishedAt))}` : ''}</div>
                </div>
                <span class="search-row-arrow">${iconSvg('arrowRight', 13)}</span>
              </button>
            `
              )
              .join('')}
          </div>
        </div>
      `
      : '';

  const sectionsHtml =
    res.sections.length > 0
      ? `
        <div class="search-group" data-search-group="sections">
          <div class="sub-label">${hasQuery ? 'Quick Jumps' : 'Sections &amp; Tools'}</div>
          <div class="search-result-list">
            ${res.sections
              .map(
                s => `
              <button type="button" class="search-result-row" data-action="search-jump-section" data-nav-tab="${esc(s.navTab)}" data-sub-tab="${esc(s.subTab || '')}">
                <div class="search-result-meta">
                  <div class="search-result-title"><strong>${esc(s.title)}</strong></div>
                  <div class="search-result-sub">${esc(s.subtitle)}</div>
                </div>
                <span class="search-row-arrow">${iconSvg('arrowRight', 13)}</span>
              </button>
            `
              )
              .join('')}
          </div>
        </div>
      `
      : '';

  const emptyStateHtml =
    hasQuery && res.totalCount === 0
      ? `<div class="subcard-panel" style="font-size:12.5px;color:var(--text-secondary)">
           No direct matches for <strong>&ldquo;${esc(res.query)}&rdquo;</strong>.
           <div style="margin-top:8px">
             <button type="button" class="btn-secondary" data-action="analyze-topic-jump" data-prompt="${esc(`49ers deep dive on ${res.query}`)}">
               ${iconSvg('sparkles', 13)}
               <span>Ask AI about &ldquo;${esc(res.query.slice(0, 32))}&rdquo;</span>
             </button>
           </div>
         </div>`
      : '';

  return `
    <div class="universal-search-wrap" data-universal-search>
      <div class="search-input-wrap">
        ${iconSvg('search', 16, 'search-input-icon')}
        <input type="search" id="universalSearchInput" class="text-input has-lead-icon"
               style="font-size:16px"
               placeholder="Search players, #13, injuries, news, film, cap, podcasts…"
               value="${esc(query)}"
               autocomplete="off"
               aria-label="Search 49ers Faithful" />
        ${
          hasQuery
            ? `<button type="button" class="search-clear-btn" data-action="clear-universal-search" aria-label="Clear search">${iconSvg('close', 13)}</button>`
            : ''
        }
      </div>

      ${
        !hasQuery
          ? `<div class="search-quick-chips" aria-label="Suggested Searches">
              ${quickChips
                .map(
                  ch => `<button type="button" class="pill-btn" data-action="fill-universal-search" data-search-query="${esc(ch)}">${esc(ch)}</button>`
                )
                .join('')}
             </div>`
          : ''
      }

      ${playersHtml}
      ${newsHtml}
      ${audioHtml}
      ${sectionsHtml}
      ${emptyStateHtml}
    </div>
  `;
}
