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
import { ALL_NFL_TEAMS, getActiveTeamConfig } from '../config/teamRegistry.js';
import { sanitizeExternalUrl } from '../engine/linkIntegrity.js';
import {
  buildXBeatListSearchUrl,
  getReporterTrustTier
} from '../engine/beatAttributionEngine.js';
import {
  evaluatePushSupportStatus,
  highlightSearchTextHtml,
  runUniversalSearch,
  SEARCH_SCOPES
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

  const activeTeam = getActiveTeamConfig();
  const darkThemeName = activeTeam.themes?.dark?.name || "Levi's Night Game";
  const lightThemeName = activeTeam.themes?.light?.name || "'94 Throwback";
  const darkBtnLabel = activeTeam.abbr === 'SF' ? 'Night Game Dark' : `${darkThemeName} (Dark)`;
  const lightBtnLabel = activeTeam.abbr === 'SF' ? "'94 White & Gold" : `${lightThemeName} (Light)`;
  const briefCutoffLabel =
    activeTeam.timezone === 'America/Los_Angeles'
      ? '5:00 PM PT'
      : /New_York|Detroit|Indiana/i.test(activeTeam.timezone || '')
        ? '5:00 PM ET'
        : /Chicago/i.test(activeTeam.timezone || '')
          ? '5:00 PM CT'
          : '5:00 PM MT';

  return `
    <!-- Theme & Feed Preferences -->
    <div class="subcard-panel" style="display:flex;flex-direction:column;gap:10px">
      <div class="sub-label">Display &amp; Feed</div>

      <div style="display:flex;flex-direction:column;gap:8px" data-settings-team-switcher>
        <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap">
          <div style="min-width:0;flex:1 1 160px">
            <strong>All 32 NFL Team Sites</strong>
            <div style="font-size:11.5px;color:var(--text-secondary)">Jump to any franchise hub across the NFL</div>
          </div>
          <a href="https://nfl.joshal.com" target="_blank" rel="noopener noreferrer" class="source-chip-link">
            <span>NFL Portal</span>${iconSvg('externalLink', 10)}
          </a>
        </div>
        <details class="stats-expand-details" style="margin-top:0">
          <summary class="stats-expand-summary" style="padding:7px 10px;font-size:12px">
            <span>Switch Team (${ALL_NFL_TEAMS.length})</span>
            <span class="mono stats-expand-hint">${esc(activeTeam.nickname)}</span>
          </summary>
          <div style="padding:8px 10px;display:flex;flex-wrap:wrap;gap:6px">
            ${(() => {
              const curHost =
                typeof window !== 'undefined' ? String(window.location?.hostname || '').toLowerCase() : '';
              const isLocal = /^(localhost|127\.0\.0\.1)$/i.test(curHost);
              return [...ALL_NFL_TEAMS]
                .sort((a, b) => a.nickname.localeCompare(b.nickname))
                .map(t => {
                  const href = isLocal ? `?team=${encodeURIComponent(t.slug)}` : `https://${t.domain}`;
                  const isCur = activeTeam.slug === t.slug;
                  return `<a href="${esc(href)}" class="source-chip-link ${isCur ? 'active' : ''}" style="${isCur ? 'border-color:var(--gold-border);background:var(--gold-soft);color:var(--text-primary)' : ''}"><span>${esc(t.nickname)}</span></a>`;
                })
                .join('');
            })()}
          </div>
        </details>
      </div>

      <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap">
        <div style="min-width:0;flex:1 1 170px">
          <strong>App Theme</strong>
          <div style="font-size:11.5px;color:var(--text-secondary)">${esc(darkThemeName)} (Dark) vs. ${esc(lightThemeName)} (Light)</div>
        </div>
        <button type="button" class="btn-secondary" style="white-space:nowrap;flex-shrink:0" data-action="toggle-theme">
          ${iconSvg(userPrefs.theme === 'light' ? 'moon' : 'sun', 14)}
          <span>${esc(userPrefs.theme === 'light' ? darkBtnLabel : lightBtnLabel)}</span>
        </button>
      </div>

      <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap" data-settings-feed-density>
        <div style="min-width:0;flex:1 1 160px">
          <strong>Feed Density</strong>
          <div style="font-size:11.5px;color:var(--text-secondary)">Rich editorial cards (default) vs. compact headline scan</div>
        </div>
        <div class="segmented-control compact-seg" role="group" aria-label="Feed Reading Density" style="flex-shrink:0">
          <button type="button" class="pill-btn seg-btn ${feedDensity === 'rich' ? 'active' : ''}" data-action="set-feed-density" data-density="rich" aria-pressed="${feedDensity === 'rich' ? 'true' : 'false'}">
            <span>Rich</span>
          </button>
          <button type="button" class="pill-btn seg-btn ${feedDensity === 'compact' ? 'active' : ''}" data-action="set-feed-density" data-density="compact" aria-pressed="${feedDensity === 'compact' ? 'true' : 'false'}">
            ${iconSvg('layoutList', 12)}
            <span>Scan</span>
          </button>
        </div>
      </div>

      <label style="display:flex;justify-content:space-between;align-items:center;gap:10px;cursor:pointer" data-settings-group-similar>
        <div>
          <strong>Group Similar Stories (Top)</strong>
          <div style="font-size:11.5px;color:var(--text-secondary)">Bundles overlapping coverage under one lead card in Top sort (Latest stays chronological)</div>
        </div>
        <input type="checkbox" data-action="toggle-pref-bool" data-pref-key="groupSimilarStories"
               ${userPrefs.groupSimilarStories !== false ? 'checked' : ''} style="width:20px;height:20px;accent-color:var(--scarlet);flex-shrink:0" />
      </label>

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
        <div class="sub-label" style="margin:0">Quiet Alerts</div>
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
            <strong style="font-size:12.5px">Daily ${esc(briefCutoffLabel)} Top-News Brief</strong>
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
      <div class="sub-label">Podcast Preferences</div>
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
      <div class="sub-label">Account, AI Key &amp; Sync</div>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(135px,1fr));gap:8px">
        <div>
          <label style="font-size:11px;color:var(--text-secondary)" for="prefAuthorInput">Display Name</label>
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
                   <span>How to get your free Gemini API key (60-sec guide)</span>
                 </summary>
                 ${renderGeminiApiKeyStepByStepGuideHtml({ includeFocusButton: false })}
               </details>`
            : ''
        }
        <div style="display:flex;justify-content:space-between;align-items:center;gap:6px;flex-wrap:wrap;margin-bottom:3px">
          <label style="font-size:11px;color:var(--text-secondary)" for="prefGeminiKeyInput">Gemini API Key (shared across all 32 NFL apps)</label>
          <a href="${AI_STUDIO_DIRECT_KEY_URL}" target="_blank" rel="noopener noreferrer" class="ext-link" style="font-size:11px">Get Free Key ${iconSvg('externalLink', 10)}</a>
        </div>
        <input type="password" id="prefGeminiKeyInput" class="text-input" placeholder="AIza..." autocomplete="off" value="${esc(userPrefs.geminiApiKey || '')}" />
      </div>
      <div>
        <label style="font-size:11px;color:var(--text-secondary)" for="prefWorkerUrlInput">Shared Worker URL (optional)</label>
        <input type="url" id="prefWorkerUrlInput" class="text-input" placeholder="https://${esc(activeTeam.slug || '49ers')}-worker.<subdomain>.workers.dev" value="${esc(userPrefs.workerBaseUrl || '')}" />
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <button type="button" class="btn-secondary" style="flex:1 1 160px" data-action="save-group-config">
          ${iconSvg('save', 14)}
          <span>Save AI &amp; Sync Settings</span>
        </button>
        ${
          userPrefs.geminiApiKey
            ? `<button type="button" class="btn-ghost" data-action="clear-gemini-key" title="Clears your Gemini API key across all 32 NFL team apps on this device">
                 ${iconSvg('trash', 13)}
                 <span>Clear Key</span>
               </button>`
            : ''
        }
      </div>
    </div>

    <!-- Direct X Beat Lists (Synced Live with Enabled Reporters Below) -->
    <div id="settingsSourcesSection" class="subcard-panel" data-settings-x-beat-lists style="display:flex;flex-direction:column;gap:7px">
      <div class="sub-label" style="margin:0">Direct X Beat Lists</div>
      <div style="font-size:11.5px;color:var(--text-secondary)">Live X searches synced with your enabled reporters below.</div>
      <div class="x-beat-launch-strip" aria-label="Live X Beat Search">
        <a href="${esc(buildXBeatListSearchUrl('trusted', { reporters, userPrefs }))}" target="_blank" rel="noopener noreferrer" class="source-chip-link x-beat-chip" title="All enabled Tier 1–3 ${esc(activeTeam.nickname)} Beat Reporters, Columnists &amp; Official Team handles from Settings">
          <span>Trusted Beat</span>${iconSvg('externalLink', 10)}
        </a>
        <a href="${esc(buildXBeatListSearchUrl('film', { reporters, userPrefs }))}" target="_blank" rel="noopener noreferrer" class="source-chip-link x-beat-chip" title="All enabled Tier 1–3 ${esc(activeTeam.nickname)} Film, Analytics &amp; Podcast Analysts from Settings">
          <span>Film &amp; Analysts</span>${iconSvg('externalLink', 10)}
        </a>
        <a href="${esc(buildXBeatListSearchUrl('injuries', { reporters, userPrefs }))}" target="_blank" rel="noopener noreferrer" class="source-chip-link x-beat-chip" title="Live ${esc(activeTeam.nickname)} sideline, practice &amp; warmup injury updates across Tier 1–3 beat voices">
          <span>Injury Scoops</span>${iconSvg('externalLink', 10)}
        </a>
        <a href="${esc(buildXBeatListSearchUrl('insiders', { reporters, userPrefs }))}" target="_blank" rel="noopener noreferrer" class="source-chip-link x-beat-chip" title="All enabled Tier 1–3 National NFL Insiders, Draft Evaluators &amp; League Analysts scoped to ${esc(activeTeam.nickname)}">
          <span>NFL Insiders</span>${iconSvg('externalLink', 10)}
        </a>
      </div>
    </div>

    <!-- Outlet Toggles -->
    <div class="subcard-panel" style="display:flex;flex-direction:column;gap:7px">
      <div class="sub-label">Outlets &amp; Channels (${outlets.length})</div>
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
        <div class="sub-label">Beat Reporters &amp; Analysts (${reporters.length})</div>
        <div style="display:flex;gap:6px">
          <button type="button" class="btn-ghost" data-action="enable-all-reporters">${iconSvg('check', 12)}<span>Enable All</span></button>
        </div>
      </div>

      <div class="search-input-wrap">
        ${iconSvg('search', 15, 'search-input-icon')}
        <input type="search" id="reporterFilterSearchInput" class="text-input has-lead-icon"
               placeholder="${esc(
                 activeTeam.abbr === 'SF'
                   ? 'Search Maiocco, Barrows, Lombardi, Wagoner, Schefter…'
                   : `Search ${reporters
                       .filter(r => !/official/i.test(r.name || '') && r.name)
                       .slice(0, 3)
                       .map(r => String(r.name).trim().split(/\s+/).pop())
                       .concat(['Schefter'])
                       .filter((v, i, a) => v && a.indexOf(v) === i)
                       .slice(0, 4)
                       .join(', ')}…`
               )}"
               value="${esc(reporterSearch)}" aria-label="Search Reporters" />
      </div>

      <div style="display:flex;flex-direction:column;gap:6px;max-height:280px;overflow-y:auto">
        ${visibleReporters
          .map(r => {
            const enabled = !disabledReps.has(r.id);
            const repLink = sanitizeExternalUrl(r.xUrl || r.profileUrl, null);
            const repLinkLabel = r.handle || (r.outletId === 'knbr_radio' ? 'KNBR 680' : 'Profile');
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
                        ? `<a href="${esc(repLink)}" target="_blank" rel="noopener noreferrer" onclick="event.stopPropagation()" style="color:var(--gold-bright);font-size:11px;display:inline-flex;align-items:center;gap:3px">${esc(repLinkLabel)} ${iconSvg('externalLink', 10)}</a>`
                        : r.handle
                          ? `<span style="color:var(--gold-bright);font-size:11px">${esc(r.handle)}</span>`
                          : ''
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

function buildSearchHighlightTokens(res) {
  const effective = String(res?.effectiveQuery || res?.query || '').trim();
  if (!effective) return [];
  const stripped = effective.replace(/"/g, ' ').replace(/^[#@]+/, '');
  return stripped
    .split(/\s+/)
    .map(t => t.replace(/^[#@]+/, '').trim())
    .filter(t => t.length >= 2);
}

export function renderUniversalSearchScopeBarHtml(res = {}) {
  const hasFilter = Boolean(res?.query || res?.activeSource);
  if (!hasFilter) return '';
  const counts = res.countsByScope || {};
  const activeScope = res.activeScope || 'all';

  const visibleScopes = SEARCH_SCOPES.filter(sc => {
    if (sc.key === 'all' || sc.key === activeScope) return true;
    return Number(counts[sc.key] || 0) > 0;
  });

  if (visibleScopes.length <= 1) return '';

  return `
    <div class="search-scope-bar" role="tablist" aria-label="Filter search results by type" data-search-scope-bar>
      ${visibleScopes
        .map(sc => {
          const cnt = Number(counts[sc.key] || 0);
          const isActive = sc.key === activeScope;
          return `
            <button type="button"
                    role="tab"
                    aria-selected="${isActive ? 'true' : 'false'}"
                    class="search-scope-pill${isActive ? ' active' : ''}"
                    data-action="search-set-scope"
                    data-search-scope="${esc(sc.key)}">
              <span>${esc(sc.label)}</span>
              ${sc.key !== 'all' ? `<span class="search-scope-cnt mono">${cnt}</span>` : ''}
            </button>
          `;
        })
        .join('')}
    </div>
  `;
}

export function renderUniversalSearchResultsHtml({
  query = '',
  appData = null,
  filteredRawItems = [],
  allEpisodes = [],
  allAnalyses = [],
  scope = 'all',
  sourceFilter = null,
  forceLiteral = false,
  recentSearches = [],
  precomputedResult = null
}) {
  const res =
    precomputedResult ||
    runUniversalSearch(query, {
      appData,
      filteredRawItems,
      allEpisodes,
      allAnalyses,
      scope,
      sourceFilter,
      forceLiteral
    });

  const hasQuery = Boolean(res.query);
  const hasSource = Boolean(res.activeSource);
  const hasFilter = hasQuery || hasSource;
  const hlTokens = buildSearchHighlightTokens(res);

  // Suggested quick pills when query & source are empty (top injured starters + active QB + key shortcuts)
  const injuredSuggestions = (appData?.health?.practiceReport || [])
    .slice(0, 3)
    .map(p => p?.name)
    .filter(Boolean);
  const activeSearchTeam = getActiveTeamConfig();
  const starterQb = (appData?.roster?.players || []).find(
    p => p?.position === 'QB' && (p.rosterBucket === 'active' || p.isStarter)
  );
  const qbQuickChip =
    activeSearchTeam.abbr === 'SF'
      ? 'Purdy'
      : starterQb?.name
        ? String(starterQb.name).replace(/\s+(?:Jr\.?|Sr\.?|II|III|IV|V)$/i, '').trim().split(/\s+/).pop()
        : activeSearchTeam.nickname;
  const quickChips = [...new Set([...injuredSuggestions, qbQuickChip, 'Cap', 'Film', 'Playoffs'].filter(Boolean))].slice(0, 6);

  const recentChipsHtml =
    !hasFilter && Array.isArray(recentSearches) && recentSearches.length > 0
      ? `
        <div class="search-group" data-search-group="recent">
          <div class="search-group-head">
            <div class="sub-label" style="margin:0">Recent</div>
            <button type="button" class="btn-ghost btn-compact" data-action="search-clear-recent" style="font-size:10.5px;padding:2px 6px">Clear</button>
          </div>
          <div class="search-quick-chips" aria-label="Recent Searches">
            ${recentSearches
              .slice(0, 4)
              .map(
                term =>
                  `<button type="button" class="pill-btn search-chip-compact" data-action="fill-universal-search" data-search-query="${esc(term)}">${esc(term)}</button>`
              )
              .join('')}
          </div>
        </div>
      `
      : '';

  const emptyQuickChipsHtml = !hasFilter
    ? `
        <div class="search-quick-chips" aria-label="Suggested Searches">
          ${quickChips
            .map(
              ch =>
                `<button type="button" class="pill-btn search-chip-compact" data-action="fill-universal-search" data-search-query="${esc(ch)}">${esc(ch)}</button>`
            )
            .join('')}
        </div>
        ${
          Array.isArray(res.topSources) && res.topSources.length > 0
            ? `
              <div class="search-group" data-search-group="top-sources">
                <div class="sub-label">Filter by News Source</div>
                <div class="search-quick-chips" aria-label="Popular News Sources">
                  ${res.topSources
                    .slice(0, 6)
                    .map(
                      src => `
                        <button type="button" class="pill-btn search-source-chip" data-action="search-select-source" data-source-key="${esc(src.key)}" data-source-name="${esc(src.name)}">
                          <span>${esc(src.name)}</span>
                          <span class="search-chip-cnt mono">${src.itemCount}</span>
                        </button>
                      `
                    )
                    .join('')}
                </div>
              </div>
            `
            : ''
        }
      `
    : '';

  // Autocomplete Suggestions Strip (Words, Topics, Players & News Sources)
  const autocompleteHtml =
    hasQuery && Array.isArray(res.autocomplete) && res.autocomplete.length > 0
      ? `
        <div class="search-autocomplete-strip" role="listbox" aria-label="Autocomplete Suggestions" data-search-autocomplete>
          ${res.autocomplete
            .map((ac, idx) => {
              const isSource = ac.kind === 'source';
              const action = isSource ? 'search-select-source' : 'search-apply-autocomplete';
              const extraAttrs = isSource
                ? `data-source-key="${esc(ac.sourceKey || '')}" data-source-name="${esc(ac.sourceName || ac.label)}"`
                : `data-search-query="${esc(ac.query)}"`;
              return `
                <button type="button"
                        role="option"
                        class="search-ac-chip is-${esc(ac.kind)}"
                        data-action="${action}"
                        data-ac-index="${idx}"
                        ${extraAttrs}>
                  <span class="search-ac-label">${highlightSearchTextHtml(ac.label, hlTokens, esc)}</span>
                  <span class="search-ac-tag">${esc(ac.badge)}</span>
                </button>
              `;
            })
            .join('')}
        </div>
      `
      : '';

  // Autocorrect / Spelling Suggestion Banner
  let spellingBannerHtml = '';
  if (res.didAutoCorrect && res.correctedQuery) {
    spellingBannerHtml = `
      <div class="search-spelling-banner is-autocorrected" data-search-spelling-banner>
        <div class="search-spelling-line">
          <span>Showing results for</span>
          <button type="button" class="search-spelling-link" data-action="fill-universal-search" data-search-query="${esc(res.correctedQuery)}">${esc(res.correctedQuery)}</button>
        </div>
        <div class="search-spelling-sub">
          <span>Search instead for</span>
          <button type="button" class="search-spelling-literal" data-action="search-force-literal" data-search-query="${esc(res.originalQuery)}">&ldquo;${esc(res.originalQuery)}&rdquo;</button>
        </div>
      </div>
    `;
  } else if (res.spellingSuggestion?.suggestedQuery) {
    spellingBannerHtml = `
      <div class="search-spelling-banner" data-search-spelling-banner>
        <div class="search-spelling-line">
          <span>Did you mean</span>
          <button type="button" class="search-spelling-link" data-action="fill-universal-search" data-search-query="${esc(res.spellingSuggestion.suggestedQuery)}">${esc(res.spellingSuggestion.suggestedQuery)}</button><span>?</span>
        </div>
      </div>
    `;
  }

  // Sources Group (Reporters, Beat Writers, Outlets, Film Creators)
  const sourcesHtml =
    Array.isArray(res.sources) && res.sources.length > 0
      ? `
        <div class="search-group" data-search-group="sources">
          <div class="sub-label">News Sources (${res.countsByScope?.sources || res.sources.length})</div>
          <div class="search-result-list">
            ${res.sources
              .map(
                src => `
              <button type="button" class="search-result-row" data-action="search-select-source" data-source-key="${esc(src.key)}" data-source-name="${esc(src.name)}">
                <span class="search-result-icon" aria-hidden="true">${iconSvg('news', 14)}</span>
                <div class="search-result-meta">
                  <div class="search-result-title">
                    <strong>${highlightSearchTextHtml(src.name, hlTokens, esc)}</strong>
                    ${src.handle ? `<span class="mono" style="color:var(--gold-bright);font-size:11px;margin-left:4px">${esc(src.handle)}</span>` : ''}
                  </div>
                  <div class="search-result-sub">${esc(src.sourceKind)}${src.outletName && src.outletName !== src.name ? ` • ${esc(src.outletName)}` : ''}${src.itemCount > 0 ? ` • ${src.itemCount} ${src.itemCount === 1 ? 'post' : 'posts'}` : ''}</div>
                </div>
                <span class="badge badge-neutral mono" style="font-size:10px">Filter</span>
              </button>
            `
              )
              .join('')}
          </div>
        </div>
      `
      : '';

  const playersHtml =
    res.players.length > 0
      ? `
        <div class="search-group" data-search-group="players">
          <div class="sub-label">Players (${res.countsByScope?.players || res.players.length})</div>
          <div class="search-result-list">
            ${res.players
              .map(
                p => `
              <button type="button" class="search-result-row" data-action="search-open-player" data-player-id="${esc(p.id)}">
                ${renderPlayerAvatarHtml(p, 30)}
                <div class="search-result-meta">
                  <div class="search-result-title"><strong>${highlightSearchTextHtml(p.name, hlTokens, esc)}</strong> <span class="mono" style="color:var(--gold-bright);font-size:11px">${esc(p.position)}${p.jersey != null ? ` #${p.jersey}` : ''}</span></div>
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

  const newsHeadingLabel =
    res.activeScope === 'tweets'
      ? 'Tweets'
      : res.activeScope === 'articles'
        ? 'News Articles'
        : res.activeScope === 'videos'
          ? 'Videos & Film'
          : 'Tweets, Articles & Film';

  const newsHtml =
    res.news.length > 0
      ? `
        <div class="search-group" data-search-group="news">
          <div class="search-group-head">
            <div class="sub-label" style="margin:0">${newsHeadingLabel} (${res.totalNewsMatches})</div>
            <button type="button" class="btn-ghost btn-compact" data-action="search-filter-news-feed" data-search-query="${esc(res.effectiveQuery || res.query)}" data-source-name="${esc(res.activeSource?.name || '')}" data-search-scope="${esc(res.activeScope)}">
              <span>Filter Feed</span>
              ${iconSvg('arrowRight', 11)}
            </button>
          </div>
          <div class="search-result-list">
            ${res.news
              .map(n => {
                const trimmedTitle = n.title.length > 135 ? `${n.title.slice(0, 132)}…` : n.title;
                const showSnippet =
                  Boolean(n.snippet) &&
                  n.snippet.length >= 16 &&
                  !n.title.toLowerCase().includes(n.snippet.slice(0, 28).toLowerCase());
                const fmtCls = n.isTweet ? 'is-tweet' : n.isVideo ? 'is-video' : 'is-article';
                return `
              <a href="${esc(n.href)}" target="_blank" rel="noopener noreferrer" class="search-result-row search-result-link" data-read-key="${esc(n.id || n.href)}">
                <div class="search-result-meta">
                  <div class="search-result-title">${highlightSearchTextHtml(trimmedTitle, hlTokens, esc)}</div>
                  ${
                    showSnippet
                      ? `<div class="search-result-snippet">${highlightSearchTextHtml(n.snippet, hlTokens, esc)}</div>`
                      : ''
                  }
                  <div class="search-result-sub">
                    <span class="search-fmt-tag ${fmtCls}">${esc(n.formatLabel || 'News')}</span>
                    <span>${highlightSearchTextHtml(n.author, hlTokens, esc)}${n.publishedAt ? ` • ${esc(formatRelativeAge(n.publishedAt))}` : ''}</span>
                  </div>
                </div>
                <span class="search-row-arrow">${iconSvg('externalLink', 12)}</span>
              </a>
            `;
              })
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
                  <div class="search-result-title">${highlightSearchTextHtml(a.title, hlTokens, esc)}</div>
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

  const glossaryHtml =
    Array.isArray(res.glossary) && res.glossary.length > 0
      ? `
        <div class="search-group" data-search-group="glossary">
          <div class="sub-label">Football &amp; CBA Glossary (${res.glossary.length})</div>
          <div class="search-result-list">
            ${res.glossary
              .map(
                g => `
              <button type="button" class="search-result-row" data-jargon="${esc(g.key)}">
                <div class="search-result-meta">
                  <div class="search-result-title"><strong>${highlightSearchTextHtml(g.term, hlTokens, esc)}</strong> <span class="badge badge-neutral" style="font-size:9.5px;padding:1px 5px;margin-left:4px">${esc(g.category)}</span></div>
                  <div class="search-result-sub">${esc(g.definition.slice(0, 125))}${g.definition.length > 125 ? '…' : ''}</div>
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
          <div class="sub-label">${hasFilter ? 'Quick Jumps' : 'Sections &amp; Tools'}</div>
          <div class="search-result-list">
            ${res.sections
              .map(
                s => `
              <button type="button" class="search-result-row" data-action="search-jump-section" data-nav-tab="${esc(s.navTab)}" data-sub-tab="${esc(s.subTab || '')}">
                <div class="search-result-meta">
                  <div class="search-result-title"><strong>${highlightSearchTextHtml(s.title, hlTokens, esc)}</strong></div>
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
    hasFilter && res.totalCount === 0
      ? `<div class="subcard-panel" style="font-size:12.5px;color:var(--text-secondary)">
           No direct matches${res.query ? ` for <strong>&ldquo;${esc(res.query)}&rdquo;</strong>` : ''}${res.activeSource ? ` in <strong>${esc(res.activeSource.name)}</strong>` : ''}.
           <div style="margin-top:8px;display:flex;gap:8px;flex-wrap:wrap">
             ${
               res.activeSource
                 ? `<button type="button" class="btn-ghost btn-compact" data-action="search-clear-source">Clear source filter</button>`
                 : ''
             }
             ${
               res.query
                 ? `<button type="button" class="btn-secondary" data-action="analyze-topic-jump" data-prompt="${esc(`${getActiveTeamConfig().nickname} deep dive on ${res.query}`)}">
                      ${iconSvg('sparkles', 13)}
                      <span>Ask AI about &ldquo;${esc(res.query.slice(0, 32))}&rdquo;</span>
                    </button>`
                 : ''
             }
           </div>
         </div>`
      : '';

  return `
    ${recentChipsHtml}
    ${emptyQuickChipsHtml}
    ${autocompleteHtml}
    ${spellingBannerHtml}
    ${sourcesHtml}
    ${playersHtml}
    ${newsHtml}
    ${audioHtml}
    ${glossaryHtml}
    ${sectionsHtml}
    ${emptyStateHtml}
  `;
}

export function renderUniversalSearchSheetHtml({
  query = '',
  appData = null,
  filteredRawItems = [],
  allEpisodes = [],
  allAnalyses = [],
  scope = 'all',
  sourceFilter = null,
  forceLiteral = false,
  recentSearches = []
}) {
  const res = runUniversalSearch(query, {
    appData,
    filteredRawItems,
    allEpisodes,
    allAnalyses,
    scope,
    sourceFilter,
    forceLiteral
  });
  const hasQuery = Boolean(res.query);
  const hasSource = Boolean(res.activeSource);

  return `
    <div class="universal-search-wrap" data-universal-search>
      <div class="search-sticky-controls" id="universalSearchStickyControls">
        <div class="search-input-wrap">
          ${iconSvg('search', 16, 'search-input-icon')}
          <input type="search" id="universalSearchInput" class="text-input has-lead-icon search-has-clear"
                 style="font-size:16px"
                 placeholder="${hasSource ? `Search words in ${esc(res.activeSource.name)}…` : 'Search players, #13, beat writers, words in tweets/articles…'}"
                 value="${esc(query)}"
                 autocomplete="off"
                 autocorrect="off"
                 autocapitalize="off"
                 spellcheck="false"
                 enterkeyhint="search"
                 aria-label="Search ${esc(getActiveTeamConfig().brandName)}" />
          <button type="button" id="universalSearchClearBtn" class="search-clear-btn" data-action="clear-universal-search" aria-label="Clear search" ${hasQuery || hasSource ? '' : 'hidden'}>${iconSvg('close', 13)}</button>
        </div>

        <div id="universalSearchActiveSourceBar" class="search-active-source-bar" ${hasSource ? '' : 'hidden'}>
          ${
            hasSource
              ? `
                <span class="search-source-active-pill" data-active-source-pill>
                  <span>Source: <strong>${esc(res.activeSource.name)}</strong></span>
                  <button type="button" class="search-pill-x" data-action="search-clear-source" aria-label="Remove source filter">${iconSvg('close', 11)}</button>
                </span>
                <span class="search-source-hint">Type words to filter within ${esc(res.activeSource.name)}</span>
              `
              : ''
          }
        </div>

        <div id="universalSearchScopeBarWrap">
          ${renderUniversalSearchScopeBarHtml(res)}
        </div>
      </div>

      <div id="universalSearchResultsPane" class="search-results-pane" data-search-results-pane>
        ${renderUniversalSearchResultsHtml({
          query,
          appData,
          filteredRawItems,
          allEpisodes,
          allAnalyses,
          scope,
          sourceFilter,
          forceLiteral,
          recentSearches,
          precomputedResult: res
        })}
      </div>
    </div>
  `;
}
