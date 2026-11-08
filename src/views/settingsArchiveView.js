/**
 * Settings (Theme, Feed Filters, Outlet & Reporter Toggles, Cloud Sync)
 * & Seasonal Off-Cycle Archive Sheet Renderers
 */

import { esc, escJargon, renderPlayerAvatarHtml, renderTeamLogoHtml } from './uiHelpers.js';
import { iconSvg, blockIconName } from './icons.js';
import { sanitizeExternalUrl } from '../engine/linkIntegrity.js';
import { partitionCompletedTradesByWindow } from '../engine/seasonStateMachine.js';

export function renderSettingsSheetHtml({
  userPrefs,
  reportersData,
  reporterSearch = ''
}) {
  const outlets = reportersData?.outlets || [];
  const reporters = reportersData?.reporters || [];
  const disabledOutlets = new Set(userPrefs?.disabledOutlets || []);
  const disabledReps = new Set(userPrefs?.disabledReporterIds || []);

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

      <label style="display:flex;justify-content:space-between;align-items:center;gap:10px;cursor:pointer">
        <div>
          <strong>Mute Opinion Columnists</strong>
          <div style="font-size:11.5px;color:var(--text-secondary)">Hides opinion-heavy commentary while keeping beat reporting &amp; film</div>
        </div>
        <input type="checkbox" data-action="toggle-pref-bool" data-pref-key="muteHotTakePersonalities"
               ${userPrefs.muteHotTakePersonalities ? 'checked' : ''} style="width:20px;height:20px;accent-color:var(--scarlet)" />
      </label>

      <label style="display:flex;justify-content:space-between;align-items:center;gap:10px;cursor:pointer">
        <div>
          <strong>Analytics, Film &amp; Cap Only</strong>
          <div style="font-size:11.5px;color:var(--text-secondary)">Filters stream to EPA, All-22 film &amp; salary cap coverage</div>
        </div>
        <input type="checkbox" data-action="toggle-pref-bool" data-pref-key="strictAnalyticsFilmOnly"
               ${userPrefs.strictAnalyticsFilmOnly ? 'checked' : ''} style="width:20px;height:20px;accent-color:var(--scarlet)" />
      </label>
    </div>

    <!-- Display Name & Sync Endpoint -->
    <div class="subcard-panel" style="display:flex;flex-direction:column;gap:8px">
      <div class="sub-label">2. Display Name &amp; Cloud Sync</div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
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
        <label style="font-size:11px;color:var(--text-secondary)" for="prefWorkerUrlInput">Cloudflare Worker URL (Optional — Leave blank for built-in local engine)</label>
        <input type="url" id="prefWorkerUrlInput" class="text-input" placeholder="https://49ers-worker.<subdomain>.workers.dev" value="${esc(userPrefs.workerBaseUrl || '')}" />
      </div>
      <button type="button" class="btn-secondary" data-action="save-group-config">
        ${iconSvg('save', 14)}
        <span>Save Sync Settings</span>
      </button>
    </div>

    <!-- Outlet Toggles -->
    <div class="subcard-panel" style="display:flex;flex-direction:column;gap:7px">
      <div class="sub-label">3. News Outlets &amp; Channels (${outlets.length})</div>
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
        <div class="sub-label">4. Beat Reporters &amp; Analysts (${reporters.length})</div>
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
            const repLink = sanitizeExternalUrl(r.bskyUrl || r.profileUrl || r.xUrl, null);
            return `
              <label style="display:flex;justify-content:space-between;align-items:center;gap:8px;padding:7px 9px;border-radius:8px;background:var(--bg-elevated);border:1px solid var(--border-subtle);cursor:pointer">
                <div style="min-width:0">
                  <div style="font-weight:700;font-size:13px;display:flex;align-items:center;gap:6px;flex-wrap:wrap">
                    <span>${esc(r.name)}</span>
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

export function renderArchiveVaultSheetHtml({ seasonState, appData }) {
  const active = seasonState?.activeBlocks || [];
  const archived = seasonState?.archivedBlocks || [];
  const { archivedTrades } = partitionCompletedTradesByWindow(
    appData?.seasonal?.tradeWarRoom?.completed2026Moves || [],
    appData?.meta?.updatedAt || Date.now(),
    30
  );

  const jumpMap = {
    playoff_picture: 'playoffs',
    draft_prep: 'draft_prep',
    draft_live_udfa: 'draft_class',
    trade_deadline: 'trade',
    upcoming_matchup: 'matchup',
    team_health: 'health',
    team_stats: 'stats'
  };

  return `
    <div style="font-size:12.5px;color:var(--text-secondary)">
      Seasonal modules surface on your Home Dashboard during their active NFL calendar window and move to the archive afterward. Completed trades older than 30 days are also archived below:
    </div>

    <div id="archiveOlderTradesSection">
      <div class="sub-label" style="margin-bottom:6px">Older Completed Trades (&gt;30 Days) (${archivedTrades.length})</div>
      <div style="display:flex;flex-direction:column;gap:8px">
        ${
          archivedTrades.length === 0
            ? `<div style="font-size:12.5px;color:var(--text-muted)">No completed trades older than 30 days.</div>`
            : archivedTrades
                .map(
                  m => `
              <div class="subcard-panel" style="border-color:var(--border-strong)">
                <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap">
                  <div style="display:flex;align-items:center;gap:9px;min-width:0">
                    ${renderPlayerAvatarHtml({ name: m.player, jersey: m.jersey, headshotUrl: m.headshotUrl }, 34, { showJerseyBadge: m.jersey != null })}
                    <div style="min-width:0">
                      <div style="display:flex;align-items:center;gap:5px;flex-wrap:wrap">
                        <strong style="cursor:${m.playerId ? 'pointer' : 'default'}" ${m.playerId ? `data-action="open-player-sheet" data-player-id="${esc(m.playerId)}"` : ''}>${esc(m.player)} (${esc(m.position)})</strong>
                        <span style="color:var(--text-muted)">←</span>
                        ${m.acquiredFrom ? renderTeamLogoHtml(m.acquiredFrom, m.acquiredFromLogoUrl, 17) : ''}
                        <strong>${esc(m.acquiredFrom)}</strong>
                        ${
                          m.sourceUrl
                            ? `<a href="${esc(m.sourceUrl)}" target="_blank" rel="noopener noreferrer" class="ext-link" style="font-size:11px;margin-left:4px">Source ${iconSvg('externalLink', 10)}</a>`
                            : ''
                        }
                      </div>
                      <div style="font-size:11.5px;color:var(--gold-bright)">${esc(m.timing)} • Cost: ${esc(m.costSummary)}</div>
                    </div>
                  </div>
                  <span class="badge badge-neutral mono">Grade ${esc(m.schemeGrade)}</span>
                </div>
                <div style="font-size:12px;color:var(--text-secondary);margin-top:5px">${escJargon(m.analysis)}</div>
              </div>
            `
                )
                .join('')
        }
      </div>
    </div>

    <div>
      <div class="sub-label" style="margin-bottom:6px">Off-Cycle / Archived Views (${archived.length})</div>
      <div style="display:flex;flex-direction:column;gap:8px">
        ${
          archived.length === 0
            ? `<div style="font-size:12.5px;color:var(--text-muted)">All modules are currently active.</div>`
            : archived
                .map(
                  b => `
              <div class="subcard-panel" style="border-color:var(--gold-border);display:flex;justify-content:space-between;align-items:center;gap:10px">
                <div style="display:flex;align-items:center;gap:10px;min-width:0">
                  <div class="card-icon-badge temporal" aria-hidden="true">${iconSvg(blockIconName(b.id), 17)}</div>
                  <div style="min-width:0">
                    <span class="badge badge-gold">${esc(b.badgeLabel)}</span>
                    <div style="font-weight:800;font-size:14px;margin-top:3px">${esc(b.title)}</div>
                  </div>
                </div>
                <button type="button" class="btn-primary" data-action="open-vault-module" data-season-sub="${esc(jumpMap[b.id] || 'draft_class')}">
                  <span>Open</span>
                  ${iconSvg('arrowRight', 13)}
                </button>
              </div>
            `
                )
                .join('')
        }
      </div>
    </div>

    <div>
      <div class="sub-label" style="margin-bottom:6px">Currently Active On Dashboard (${active.length})</div>
      <div style="display:flex;flex-wrap:wrap;gap:6px">
        ${active.map(b => `<span class="badge badge-positive">${iconSvg('check', 11)}<span>${esc(b.shortTitle)}</span></span>`).join('')}
      </div>
    </div>
  `;
}
