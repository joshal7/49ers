/**
 * Settings (Theme, Editorial Filters, Outlet & 45-Reporter Toggles, Group Passcode)
 * & Seasonal Off-Cycle Archive Vault Sheet Renderers
 */

import { esc } from './uiHelpers.js';

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
    <!-- Theme & Editorial Mode -->
    <div style="padding:10px;border-radius:10px;background:var(--bg-card-alt);display:flex;flex-direction:column;gap:9px">
      <div class="sub-label">1. Visual Aesthetic &amp; Editorial Guardrails</div>

      <div style="display:flex;justify-content:space-between;align-items:center;gap:8px">
        <div>
          <strong>App Theme</strong>
          <div style="font-size:11.5px;color:var(--text-secondary)">Levi's Night Game (Dark) vs. '94 Throwback (Light)</div>
        </div>
        <button type="button" class="btn-secondary" data-action="toggle-theme">
          ${userPrefs.theme === 'light' ? '🌙 Switch to Night Game Dark' : "☀️ Switch to '94 White & Gold"}
        </button>
      </div>

      <label style="display:flex;justify-content:space-between;align-items:center;gap:10px;cursor:pointer">
        <div>
          <strong>Mute Opinion / Hot-Take Columnists</strong>
          <div style="font-size:11.5px;color:var(--text-secondary)">Hides opinion-heavy columnists while keeping beat facts &amp; film</div>
        </div>
        <input type="checkbox" data-action="toggle-pref-bool" data-pref-key="muteHotTakePersonalities"
               ${userPrefs.muteHotTakePersonalities ? 'checked' : ''} style="width:20px;height:20px" />
      </label>

      <label style="display:flex;justify-content:space-between;align-items:center;gap:10px;cursor:pointer">
        <div>
          <strong>Strict Analytics, Film &amp; Cap Only</strong>
          <div style="font-size:11.5px;color:var(--text-secondary)">Filters stream strictly to high-density EPA, All-22 &amp; CBA cap items</div>
        </div>
        <input type="checkbox" data-action="toggle-pref-bool" data-pref-key="strictAnalyticsFilmOnly"
               ${userPrefs.strictAnalyticsFilmOnly ? 'checked' : ''} style="width:20px;height:20px" />
      </label>
    </div>

    <!-- Shared Friend-Group Passcode & Worker Endpoint -->
    <div style="padding:10px;border-radius:10px;background:var(--bg-card-alt);display:flex;flex-direction:column;gap:8px">
      <div class="sub-label">2. Friend-Group Shared AI Cache &amp; Passcode</div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
        <div>
          <label style="font-size:11px;color:var(--text-secondary)" for="prefAuthorInput">Your Display Name</label>
          <input type="text" id="prefAuthorInput" class="text-input" value="${esc(userPrefs.authorName || 'Josh')}" />
        </div>
        <div>
          <label style="font-size:11px;color:var(--text-secondary)" for="prefPasscodeInput">Group Passcode</label>
          <input type="password" id="prefPasscodeInput" class="text-input" placeholder="Shared PIN" value="${esc(userPrefs.groupPasscode || '')}" />
        </div>
      </div>
      <div>
        <label style="font-size:11px;color:var(--text-secondary)" for="prefWorkerUrlInput">Cloudflare Worker URL (Optional — Leave blank for built-in local engine)</label>
        <input type="url" id="prefWorkerUrlInput" class="text-input" placeholder="https://49ers-worker.<subdomain>.workers.dev" value="${esc(userPrefs.workerBaseUrl || '')}" />
      </div>
      <button type="button" class="btn-secondary" data-action="save-group-config">💾 Save Group Credentials</button>
    </div>

    <!-- Outlet Toggles -->
    <div style="padding:10px;border-radius:10px;background:var(--bg-card-alt);display:flex;flex-direction:column;gap:7px">
      <div class="sub-label">3. News Outlets &amp; Channels (${outlets.length})</div>
      <div style="display:flex;flex-wrap:wrap;gap:6px">
        ${outlets
          .map(o => {
            const enabled = !disabledOutlets.has(o.id);
            return `
              <button type="button" class="pill-btn ${enabled ? 'active' : ''}"
                      data-action="toggle-outlet" data-outlet-id="${esc(o.id)}">
                ${enabled ? '✓ ' : '✕ '}${esc(o.name)}
              </button>
            `;
          })
          .join('')}
      </div>
    </div>

    <!-- Individual Beat Reporters & Insiders -->
    <div style="padding:10px;border-radius:10px;background:var(--bg-card-alt);display:flex;flex-direction:column;gap:8px">
      <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap">
        <div class="sub-label">4. Auto-Ranked Reporters &amp; Analysts (${reporters.length})</div>
        <div style="display:flex;gap:6px">
          <button type="button" class="btn-ghost" data-action="enable-all-reporters">Enable All</button>
        </div>
      </div>

      <input type="search" id="reporterFilterSearchInput" class="text-input"
             placeholder="Search Maiocco, Barrows, Lombardi, Wagoner, Schefter…"
             value="${esc(reporterSearch)}" aria-label="Search Reporters" />

      <div style="display:flex;flex-direction:column;gap:6px;max-height:280px;overflow-y:auto">
        ${visibleReporters
          .map(r => {
            const enabled = !disabledReps.has(r.id);
            return `
              <label style="display:flex;justify-content:space-between;align-items:center;gap:8px;padding:6px 8px;border-radius:8px;background:var(--bg-elevated);cursor:pointer">
                <div style="min-width:0">
                  <div style="font-weight:700;font-size:13px">
                    ${esc(r.name)} <span style="color:var(--gold-bright);font-size:11px">${esc(r.handle)}</span>
                  </div>
                  <div style="font-size:11px;color:var(--text-secondary)">${esc(r.role)} • Pop Score <span class="mono">${r.popularityScore}</span></div>
                </div>
                <input type="checkbox" data-action="toggle-reporter" data-reporter-id="${esc(r.id)}"
                       ${enabled ? 'checked' : ''} style="width:19px;height:19px;flex-shrink:0" />
              </label>
            `;
          })
          .join('')}
      </div>
    </div>
  `;
}

export function renderArchiveVaultSheetHtml({ seasonState }) {
  const active = seasonState?.activeBlocks || [];
  const archived = seasonState?.archivedBlocks || [];

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
      Temporal modules automatically surface on your Home Dashboard during their NFL calendar window and retire cleanly afterward so your daily flow stays focused. You can inspect any off-cycle war room right here year-round:
    </div>

    <div>
      <div class="sub-label" style="margin-bottom:6px">Off-Cycle / Archived War Rooms (${archived.length})</div>
      <div style="display:flex;flex-direction:column;gap:8px">
        ${
          archived.length === 0
            ? `<div style="font-size:12.5px;color:var(--text-muted)">All modules are currently active.</div>`
            : archived
                .map(
                  b => `
              <div style="padding:10px;border-radius:10px;background:var(--bg-card-alt);border:1px solid var(--gold-border);display:flex;justify-content:space-between;align-items:center;gap:10px">
                <div>
                  <span class="badge badge-gold">${esc(b.badgeLabel)}</span>
                  <div style="font-weight:800;font-size:14px;margin-top:3px">${esc(b.title)}</div>
                </div>
                <button type="button" class="btn-primary" data-action="open-vault-module" data-season-sub="${esc(jumpMap[b.id] || 'draft_class')}">
                  Inspect →
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
        ${active.map(b => `<span class="badge badge-positive">✓ ${esc(b.shortTitle)}</span>`).join('')}
      </div>
    </div>
  `;
}
