/**
 * Roster Explorer, Dual-Mode Depth Chart & Interactive Armchair GM Salary Cap View
 */

import { esc, playProbBadgeClass } from './uiHelpers.js';
import { formatCompactDollars, formatDollars } from '../engine/capSimulator.js';

export function renderRosterCapViewHtml({
  subTab = 'roster', // 'roster' | 'depth' | 'cap'
  rosterSearch = '',
  rosterUnitFilter = 'All',
  rosterPosFilter = 'ALL',
  rosterSort = 'cap_desc',
  depthMode = 'projected', // 'baseline' | 'projected'
  appData,
  simCapResult,
  userCapMoves = {}
}) {
  const topSwitcher = `
    <div class="card">
      <div class="pill-bar" role="tablist" aria-label="Roster and Salary Cap Modes">
        <button type="button" class="pill-btn ${subTab === 'roster' ? 'active' : ''}" data-action="set-roster-sub" data-roster-sub="roster">
          🏈 Roster &amp; Dossiers (${appData?.roster?.players?.length || 0})
        </button>
        <button type="button" class="pill-btn ${subTab === 'depth' ? 'active' : ''}" data-action="set-roster-sub" data-roster-sub="depth">
          📋 Dual Depth Chart
        </button>
        <button type="button" class="pill-btn ${subTab === 'cap' ? 'active' : ''}" data-action="set-roster-sub" data-roster-sub="cap">
          💰 Salary Cap &amp; GM Sim
        </button>
      </div>
    </div>
  `;

  if (subTab === 'roster') {
    return topSwitcher + renderRosterExplorer({ appData, rosterSearch, rosterUnitFilter, rosterPosFilter, rosterSort });
  }
  if (subTab === 'depth') {
    return topSwitcher + renderDualDepthChart({ appData, depthMode });
  }
  return topSwitcher + renderSalaryCapAndSimulator({ appData, simCapResult, userCapMoves });
}

function renderRosterExplorer({ appData, rosterSearch, rosterUnitFilter, rosterPosFilter, rosterSort }) {
  const allPlayers = appData?.roster?.players || [];
  const q = String(rosterSearch || '').toLowerCase().trim().replace(/^#/, '');

  const filtered = allPlayers.filter(p => {
    if (rosterUnitFilter === 'Active 53' && p.rosterBucket !== 'active') return false;
    if (rosterUnitFilter === 'Offense' && p.unit !== 'Offense') return false;
    if (rosterUnitFilter === 'Defense' && p.unit !== 'Defense') return false;
    if (rosterUnitFilter === 'Special Teams' && p.unit !== 'Special Teams') return false;
    if (rosterUnitFilter === 'IR / Reserve' && p.rosterBucket !== 'ir') return false;
    if (rosterUnitFilter === 'Practice Squad' && p.rosterBucket !== 'practice_squad') return false;

    if (rosterPosFilter !== 'ALL') {
      const pos = p.position.toUpperCase();
      if (rosterPosFilter === 'OL' && !['OT', 'OG', 'G', 'C', 'T', 'OL'].includes(pos)) return false;
      else if (rosterPosFilter === 'DL' && !['DE', 'DT', 'NT', 'DL', 'EDGE'].includes(pos)) return false;
      else if (rosterPosFilter === 'DB' && !['CB', 'S', 'FS', 'SS', 'DB', 'SAF'].includes(pos)) return false;
      else if (rosterPosFilter === 'RB' && !['RB', 'FB'].includes(pos)) return false;
      else if (!['OL', 'DL', 'DB', 'RB'].includes(rosterPosFilter) && pos !== rosterPosFilter) return false;
    }

    if (q) {
      const matchName = p.name.toLowerCase().includes(q);
      const matchNum = p.jersey != null && String(p.jersey) === q;
      const matchPos = p.position.toLowerCase() === q;
      const matchSchool = p.college.toLowerCase().includes(q);
      if (!matchName && !matchNum && !matchPos && !matchSchool) return false;
    }
    return true;
  });

  filtered.sort((a, b) => {
    if (rosterSort === 'cap_desc') return b.capHit2026 - a.capHit2026 || a.name.localeCompare(b.name);
    if (rosterSort === 'snaps_desc') return b.primarySnapPct - a.primarySnapPct || b.capHit2026 - a.capHit2026;
    if (rosterSort === 'jersey_asc') return (a.jersey ?? 999) - (b.jersey ?? 999) || a.name.localeCompare(b.name);
    if (rosterSort === 'ras_desc') return (b.spiderProfile?.compositeRas || 0) - (a.spiderProfile?.compositeRas || 0);
    if (rosterSort === 'health_asc') return (a.health?.playProbabilityPct ?? 99) - (b.health?.playProbabilityPct ?? 99);
    return a.name.localeCompare(b.name);
  });

  return `
    <div class="card">
      <div class="filter-toolbar">
        <div class="search-sort-row">
          <input type="search" id="rosterSearchInput" class="text-input"
                 placeholder="Search player, #jersey, position, college…"
                 value="${esc(rosterSearch)}" aria-label="Search Roster" />
          <select id="rosterSortSelect" class="select-input" style="width:auto" aria-label="Sort Roster">
            <option value="cap_desc" ${rosterSort === 'cap_desc' ? 'selected' : ''}>Cap Hit ↓</option>
            <option value="snaps_desc" ${rosterSort === 'snaps_desc' ? 'selected' : ''}>Snap % ↓</option>
            <option value="jersey_asc" ${rosterSort === 'jersey_asc' ? 'selected' : ''}>Jersey # ↑</option>
            <option value="ras_desc" ${rosterSort === 'ras_desc' ? 'selected' : ''}>Athletic RAS ↓</option>
            <option value="health_asc" ${rosterSort === 'health_asc' ? 'selected' : ''}>Injury Watch ↑</option>
            <option value="name_asc" ${rosterSort === 'name_asc' ? 'selected' : ''}>Name A–Z</option>
          </select>
        </div>

        <div class="pill-bar" aria-label="Unit Filter">
          ${['All', 'Active 53', 'Offense', 'Defense', 'Special Teams', 'IR / Reserve', 'Practice Squad']
            .map(
              u => `
            <button type="button" class="pill-btn ${rosterUnitFilter === u ? 'active' : ''}"
                    data-action="set-roster-unit" data-unit="${esc(u)}">${esc(u)}</button>
          `
            )
            .join('')}
        </div>

        <div class="pill-bar" aria-label="Position Group Filter">
          ${['ALL', 'QB', 'RB', 'WR', 'TE', 'OL', 'DL', 'LB', 'DB']
            .map(
              pos => `
            <button type="button" class="pill-btn ${rosterPosFilter === pos ? 'active' : ''}"
                    data-action="set-roster-pos" data-pos="${pos}">${pos === 'ALL' ? 'All Pos' : pos}</button>
          `
            )
            .join('')}
        </div>
      </div>

      <div style="font-size:11.5px;color:var(--text-muted);margin-bottom:8px">
        Showing <strong>${filtered.length}</strong> players — tap any row for 5-tab Stats, EPA, Spider Chart &amp; Contract Dossier.
      </div>

      <div class="player-list">
        ${
          filtered.length === 0
            ? `<div style="padding:14px;text-align:center;color:var(--text-muted)">No players match "${esc(rosterSearch)}".</div>`
            : filtered
                .map(
                  p => `
              <button type="button" class="player-row" data-action="open-player-sheet" data-player-id="${esc(p.id)}">
                <div class="player-row-left">
                  <div class="jersey-chip mono">${p.jersey != null ? p.jersey : '—'}</div>
                  <div class="player-meta-main">
                    <div class="player-name-line">${esc(p.name)} <span style="color:var(--gold-bright);font-size:12px">${esc(p.position)}</span></div>
                    <div class="player-sub-line">
                      ${esc(p.rosterBucket === 'active' ? '53-Man' : p.rosterBucket === 'ir' ? 'IR/Out' : 'Prac. Squad')} •
                      Snaps <span class="mono">${p.primarySnapPct}%</span> •
                      RAS <span class="mono">${Number(p.spiderProfile?.compositeRas || 0).toFixed(1)}</span>
                    </div>
                  </div>
                </div>
                <div class="player-row-right">
                  <span class="mono" style="font-weight:800;font-size:12.5px">
                    ${p.capHit2026 ? formatCompactDollars(p.capHit2026) : 'PS'}
                  </span>
                  <span class="badge ${playProbBadgeClass(p.health?.playProbabilityPct)} mono" style="font-size:10px">
                    ${esc(p.health?.playBadgeLabel)}
                  </span>
                </div>
              </button>
            `
                )
                .join('')
        }
      </div>
    </div>
  `;
}

function renderDualDepthChart({ appData, depthMode }) {
  const getUnitPriority = name => {
    const n = (name || '').toLowerCase();
    if (n.includes('offense')) return 1;
    if (n.includes('defense')) return 2;
    if (n.includes('special')) return 3;
    return 4;
  };
  const units = [...(appData?.depthChart?.units || [])].sort(
    (a, b) => getUnitPriority(a.unitName) - getUnitPriority(b.unitName)
  );

  const headerCard = `
    <div class="card">
      <div class="card-header">
        <div class="card-title-group">
          <div class="card-eyebrow">11/21 Offense • Wide-9 Base &amp; Nickel 4-2-5 Defense</div>
          <h2 class="card-title">Interactive Dual Depth Chart</h2>
        </div>
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <button type="button" class="pill-btn ${depthMode === 'projected' ? 'active' : ''}" data-action="set-depth-mode" data-depth-mode="projected">
          ⚡ Projected Week 9 Active (Auto-Promotes Healthy)
        </button>
        <button type="button" class="pill-btn ${depthMode === 'baseline' ? 'active' : ''}" data-action="set-depth-mode" data-depth-mode="baseline">
          📋 Baseline Full-Roster Hierarchy
        </button>
      </div>
    </div>
  `;

  const unitCards = units
    .map(u => {
      const rowsHtml = (u.rows || [])
        .map(row => {
          const chain = depthMode === 'projected' ? row.projectedActiveChain : row.baselineChain;
          return `
            <div class="depth-slot-row">
              <div class="depth-slot-head">
                <span class="depth-pos-tag mono">${esc(row.slotLabel)}</span>
                ${
                  depthMode === 'projected' && row.starterPromoted
                    ? `<span class="badge badge-warning">Injury Next-Man-Up</span>`
                    : ''
                }
              </div>
              <div class="depth-chain-chips">
                ${(chain || [])
                  .map(
                    (c, idx) => `
                  <button type="button"
                          class="depth-player-chip ${idx === 0 && !c.demotedDueToInjury ? 'starter' : ''} ${
                      c.demotedDueToInjury ? 'demoted' : ''
                    }"
                          data-action="open-player-sheet" data-player-id="${esc(c.playerId)}">
                    ${c.jersey != null ? `<span class="mono" style="color:var(--text-muted)">#${c.jersey}</span> ` : ''}
                    ${esc(c.name)}
                    <span class="mono" style="font-size:10.5px;color:${
                      c.playProbabilityPct >= 80 ? 'var(--emerald)' : c.playProbabilityPct >= 40 ? 'var(--amber)' : 'var(--crimson)'
                    }">(${c.playProbabilityPct}%)</span>
                  </button>
                `
                  )
                  .join('')}
              </div>
            </div>
          `;
        })
        .join('');

      return `
        <section class="card">
          <div class="card-eyebrow">Depth Alignment</div>
          <h3 class="card-title" style="margin-bottom:8px">${esc(u.unitName)}</h3>
          ${rowsHtml}
        </section>
      `;
    })
    .join('');

  return `${headerCard}${unitCards}`;
}

function renderSalaryCapAndSimulator({ appData, simCapResult, userCapMoves }) {
  const years = appData?.cap?.years || {};
  const blueprint = appData?.cap?.blueprint || {};
  const capPlayers = (appData?.cap?.players || []).slice(0, 32);
  const sum = simCapResult?.summary || {};

  const horizonRows = ['2026', '2027', '2028', '2029']
    .filter(y => years[y])
    .map(y => {
      const row = years[y];
      return `
        <tr>
          <td><strong>${y}</strong></td>
          <td>${formatCompactDollars(row.capCeiling)}</td>
          <td>${formatCompactDollars(row.totalLiabilities)}</td>
          <td style="color:var(--emerald)"><strong>${formatCompactDollars(row.teamCapSpace)}</strong></td>
          <td>${formatCompactDollars(row.deadMoneyTotal)}</td>
          <td>${row.contractedCount}</td>
        </tr>
      `;
    })
    .join('');

  const warningsHtml = (simCapResult?.warnings || [])
    .map(
      w => `
      <div style="padding:8px 10px;border-radius:8px;background:var(--crimson-soft);border:1px solid rgba(239,68,68,0.4);color:var(--crimson);font-size:12px;margin-top:6px">
        ⚠️ ${esc(w)}
      </div>
    `
    )
    .join('');

  return `
    <!-- Multi-Year Cap Horizon -->
    <section class="card">
      <div class="card-header">
        <div class="card-title-group">
          <div class="card-eyebrow">OverTheCap Synced Ledger • 2026–2029</div>
          <h2 class="card-title">Multi-Year Salary Cap Horizon</h2>
        </div>
        <button type="button" class="btn-ghost" data-action="analyze-topic-jump"
                data-prompt="Analyze the 49ers 2026-2028 salary cap rollover strategy, option bonus proration on Purdy and Bosa, and Brandon Aiyuk cap scenarios">
          ⚡ AI Cap Audit
        </button>
      </div>

      <div class="table-scroll">
        <table class="data-table mono">
          <thead>
            <tr>
              <th>Year</th><th>Projected Cap</th><th>Liabilities</th><th>Gross Space</th><th>Dead Cap</th><th>Signed</th>
            </tr>
          </thead>
          <tbody>${horizonRows}</tbody>
        </table>
      </div>

      <div style="margin-top:10px;font-size:12.5px;color:var(--text-secondary)">
        <strong style="color:var(--gold-bright)">Front Office Blueprint:</strong> ${esc(blueprint.executiveSummary || '')}
      </div>

      <div style="display:flex;flex-direction:column;gap:7px;margin-top:9px">
        ${(blueprint.strategicPillars || [])
          .map(
            sp => `
          <div style="padding:8px 10px;border-radius:8px;background:var(--bg-card-alt);font-size:12.5px">
            <strong>${esc(sp.title)}:</strong> <span style="color:var(--text-secondary)">${esc(sp.detail)}</span>
          </div>
        `
          )
          .join('')}
      </div>
    </section>

    <!-- Interactive Armchair GM Cap Simulator -->
    <section class="card">
      <div class="card-header">
        <div class="card-title-group">
          <div class="card-eyebrow">Interactive CBA Calculator • Top-53 Replacement Rule Applied</div>
          <h2 class="card-title">Armchair GM Cap Simulator</h2>
        </div>
        <div style="display:flex;gap:6px">
          <button type="button" class="btn-secondary" data-action="apply-ai-cap-blueprint">⚡ Blueprint</button>
          <button type="button" class="btn-ghost" data-action="reset-cap-moves">↺ Reset</button>
        </div>
      </div>

      <div class="gm-summary-banner">
        <div class="kpi-grid">
          <div class="kpi-box">
            <div class="kpi-label">2026 Cap Space</div>
            <div class="kpi-val mono" style="color:${sum.updatedCapSpace >= 0 ? 'var(--emerald)' : 'var(--crimson)'}">
              ${formatCompactDollars(sum.updatedCapSpace)}
            </div>
            <div class="mono" style="font-size:10.5px;color:var(--text-secondary)">
              Delta: ${formatCompactDollars(sum.baseYearNetCapDelta, true)}
            </div>
          </div>
          <div class="kpi-box">
            <div class="kpi-label">2027 Projected Space</div>
            <div class="kpi-val mono">${formatCompactDollars(sum.updatedNextYearCapSpace)}</div>
            <div class="mono" style="font-size:10.5px;color:var(--text-secondary)">
              2027 Delta: ${formatCompactDollars(sum.nextYearCapDelta, true)}
            </div>
          </div>
          <div class="kpi-box">
            <div class="kpi-label">New 2026 Dead Cap</div>
            <div class="kpi-val mono" style="color:var(--amber)">${formatCompactDollars(sum.baseYearDeadMoneyAdded, true)}</div>
            <div class="mono" style="font-size:10.5px;color:var(--text-secondary)">
              ${simCapResult?.moveCount || 0} move(s) active
            </div>
          </div>
        </div>
        ${warningsHtml}
      </div>

      <div style="display:flex;flex-direction:column;gap:8px">
        ${capPlayers
          .map(p => {
            const c26 = p.contractsByYear?.['2026'] || {};
            const selected = userCapMoves?.[p.id] || 'none';
            const tx = c26.transactions || {};
            return `
              <div class="gm-player-card ${selected !== 'none' ? 'modified' : ''}">
                <div style="display:flex;justify-content:space-between;align-items:center;gap:8px">
                  <div style="min-width:0;cursor:pointer" data-action="open-player-sheet" data-player-id="${esc(p.id)}">
                    <strong>${esc(p.name)}</strong> <span style="color:var(--gold-bright);font-size:11.5px">${esc(p.position)}</span>
                    <div class="mono" style="font-size:11px;color:var(--text-secondary)">
                      2026 Cap: ${formatCompactDollars(c26.capNumber)} • Base: ${formatCompactDollars(c26.baseSalary)}
                    </div>
                  </div>
                  <select class="select-input gm-move-select" style="width:auto;max-width:184px;padding:6px 8px"
                          data-player-id="${esc(p.id)}" aria-label="Cap Action for ${esc(p.name)}">
                    <option value="none" ${selected === 'none' ? 'selected' : ''}>Keep Contract</option>
                    <option value="restructure" ${selected === 'restructure' ? 'selected' : ''}>
                      Restructure (${formatCompactDollars(tx.restructure?.capSavings || 0, true)})
                    </option>
                    <option value="june_1_cut" ${selected === 'june_1_cut' ? 'selected' : ''}>
                      Post-6/1 Cut (${formatCompactDollars(tx.june_1_cut?.capSavings || 0, true)})
                    </option>
                    <option value="cut" ${selected === 'cut' ? 'selected' : ''}>
                      Pre-6/1 Cut (${formatCompactDollars(tx.cut?.capSavings || 0, true)})
                    </option>
                    <option value="june_1_trade" ${selected === 'june_1_trade' ? 'selected' : ''}>
                      Post-6/1 Trade (${formatCompactDollars(tx.june_1_trade?.capSavings || 0, true)})
                    </option>
                    <option value="extension" ${selected === 'extension' ? 'selected' : ''}>
                      Extend (${formatCompactDollars(tx.extension?.capSavings || 0, true)})
                    </option>
                  </select>
                </div>
              </div>
            `;
          })
          .join('')}
      </div>
    </section>
  `;
}
