/**
 * Roster Explorer, Dual-Mode Depth Chart & Interactive GM Salary Cap View
 */

import { esc, playProbBadgeClass, renderPlayerAvatarHtml } from './uiHelpers.js';
import { iconSvg } from './icons.js';
import { formatCompactDollars } from '../engine/capSimulator.js';

export const ROSTER_SORT_FIELDS = [
  { key: 'name', label: 'Name', shortLabel: 'Name', defaultDir: 'asc' },
  { key: 'jersey', label: 'Jersey Number', shortLabel: 'Jersey #', defaultDir: 'asc' },
  { key: 'cap', label: '2026 Cap Hit', shortLabel: 'Cap Hit', defaultDir: 'desc' },
  { key: 'snaps', label: 'Snap Share %', shortLabel: 'Snap %', defaultDir: 'desc' },
  { key: 'health', label: 'Play Likelihood', shortLabel: 'Health', defaultDir: 'asc' },
  { key: 'ras', label: 'Athletic RAS', shortLabel: 'RAS', defaultDir: 'desc' },
  { key: 'age', label: 'Age', shortLabel: 'Age', defaultDir: 'asc' }
];

export function normalizeRosterSort(rawField = 'name', rawDir = 'asc') {
  let field = String(rawField || 'name');
  let dir = rawDir === 'desc' ? 'desc' : 'asc';
  if (field.includes('_')) {
    const [f, d] = field.split('_');
    field = f;
    dir = d === 'desc' ? 'desc' : 'asc';
  }
  if (!ROSTER_SORT_FIELDS.some(x => x.key === field)) {
    field = 'name';
    dir = 'asc';
  }
  return { field, dir };
}

export function renderRosterCapViewHtml({
  subTab = 'roster', // 'roster' | 'depth' | 'cap'
  rosterSearch = '',
  rosterUnitFilter = 'All',
  rosterPosFilter = 'ALL',
  rosterSort = 'name',
  rosterSortDir = 'asc',
  depthMode = 'projected', // 'baseline' | 'projected'
  appData,
  simCapResult,
  userCapMoves = {}
}) {
  const topSwitcher = `
    <div class="card">
      <div class="pill-bar" role="tablist" aria-label="Roster and Salary Cap Modes">
        <button type="button" class="pill-btn ${subTab === 'roster' ? 'active' : ''}" data-action="set-roster-sub" data-roster-sub="roster">
          ${iconSvg('football', 14)}
          <span>Roster (${appData?.roster?.players?.length || 0})</span>
        </button>
        <button type="button" class="pill-btn ${subTab === 'depth' ? 'active' : ''}" data-action="set-roster-sub" data-roster-sub="depth">
          ${iconSvg('layers', 14)}
          <span>Depth Chart</span>
        </button>
        <button type="button" class="pill-btn ${subTab === 'cap' ? 'active' : ''}" data-action="set-roster-sub" data-roster-sub="cap">
          ${iconSvg('cap', 14)}
          <span>Salary Cap &amp; GM Sim</span>
        </button>
      </div>
    </div>
  `;

  if (subTab === 'roster') {
    return (
      topSwitcher +
      renderRosterExplorer({
        appData,
        rosterSearch,
        rosterUnitFilter,
        rosterPosFilter,
        rosterSort,
        rosterSortDir
      })
    );
  }
  if (subTab === 'depth') {
    return topSwitcher + renderDualDepthChart({ appData, depthMode });
  }
  return topSwitcher + renderSalaryCapAndSimulator({ appData, simCapResult, userCapMoves });
}

function renderRosterExplorer({
  appData,
  rosterSearch,
  rosterUnitFilter,
  rosterPosFilter,
  rosterSort,
  rosterSortDir
}) {
  const allPlayers = appData?.roster?.players || [];
  const q = String(rosterSearch || '').toLowerCase().trim().replace(/^#/, '');
  const qNorm = q.replace(/['’`. -]/g, '');
  const { field: sortField, dir: sortDir } = normalizeRosterSort(rosterSort, rosterSortDir);
  const mult = sortDir === 'asc' ? 1 : -1;

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
      const nameLower = p.name.toLowerCase();
      const nameNorm = nameLower.replace(/['’`. -]/g, '');
      const matchName = nameLower.includes(q) || (qNorm.length >= 2 && nameNorm.includes(qNorm));
      const matchNum = p.jersey !== null && p.jersey !== undefined && String(p.jersey) === q;
      const matchPos = p.position.toLowerCase() === q;
      const matchSchool = (p.college || '').toLowerCase().includes(q);
      if (!matchName && !matchNum && !matchPos && !matchSchool) return false;
    }
    return true;
  });

  filtered.sort((a, b) => {
    if (sortField === 'name') {
      return mult * a.name.localeCompare(b.name);
    }
    if (sortField === 'jersey') {
      const aHas = a.jersey !== null && a.jersey !== undefined;
      const bHas = b.jersey !== null && b.jersey !== undefined;
      if (aHas !== bHas) return aHas ? -1 : 1; // unassigned jerseys always sort last
      if (!aHas && !bHas) return a.name.localeCompare(b.name);
      return mult * (Number(a.jersey) - Number(b.jersey)) || a.name.localeCompare(b.name);
    }
    if (sortField === 'cap') {
      return mult * ((a.capHit2026 || 0) - (b.capHit2026 || 0)) || a.name.localeCompare(b.name);
    }
    if (sortField === 'snaps') {
      return mult * ((a.primarySnapPct || 0) - (b.primarySnapPct || 0)) || a.name.localeCompare(b.name);
    }
    if (sortField === 'health') {
      return (
        mult * ((a.health?.playProbabilityPct ?? 99) - (b.health?.playProbabilityPct ?? 99)) ||
        a.name.localeCompare(b.name)
      );
    }
    if (sortField === 'ras') {
      return (
        mult * ((a.spiderProfile?.compositeRas || 0) - (b.spiderProfile?.compositeRas || 0)) ||
        a.name.localeCompare(b.name)
      );
    }
    if (sortField === 'age') {
      const aHas = a.age !== null && a.age !== undefined;
      const bHas = b.age !== null && b.age !== undefined;
      if (aHas !== bHas) return aHas ? -1 : 1;
      if (!aHas && !bHas) return a.name.localeCompare(b.name);
      return mult * (Number(a.age) - Number(b.age)) || a.name.localeCompare(b.name);
    }
    return mult * a.name.localeCompare(b.name);
  });

  const dirArrowSymbol = sortDir === 'asc' ? '↑' : '↓';

  return `
    <div class="card">
      <div class="filter-toolbar">
        <div class="search-sort-row">
          <div class="search-input-wrap">
            ${iconSvg('search', 15, 'search-input-icon')}
            <input type="search" id="rosterSearchInput" class="text-input has-lead-icon"
                   placeholder="Search player, #jersey, position, college…"
                   value="${esc(rosterSearch)}" aria-label="Search Roster" />
          </div>
          <div class="roster-sort-controls">
            <select id="rosterSortSelect" class="select-input" aria-label="Sort Roster By">
              ${ROSTER_SORT_FIELDS.map(
                f => `<option value="${f.key}" ${sortField === f.key ? 'selected' : ''}>Sort: ${esc(f.label)}</option>`
              ).join('')}
            </select>
            <button type="button" id="rosterSortDirBtn" class="btn-secondary sort-dir-btn mono"
                    data-action="toggle-roster-sort-dir"
                    data-sort-dir="${sortDir}"
                    title="Toggle Sort Order (${sortDir === 'asc' ? 'Ascending' : 'Descending'})"
                    aria-label="Toggle Sort Direction (${sortDir === 'asc' ? 'Ascending' : 'Descending'})">
              ${iconSvg(sortDir === 'asc' ? 'arrowUp' : 'arrowDown', 15)}
              <span class="sr-only">${dirArrowSymbol}</span>
            </button>
          </div>
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

      <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;font-size:11.5px;color:var(--text-muted);margin-bottom:8px">
        <span>Showing <strong>${filtered.length}</strong> players — tap any row for Stats, EPA, Athletic Chart &amp; Contract details.</span>
        <div class="source-link-strip">
          <a href="https://www.espn.com/nfl/team/roster/_/name/sf/san-francisco-49ers" target="_blank" rel="noopener noreferrer" class="source-chip-link"><span>ESPN Roster</span>${iconSvg('externalLink', 10)}</a>
          <a href="https://www.49ers.com/team/players-roster/" target="_blank" rel="noopener noreferrer" class="source-chip-link"><span>49ers.com</span>${iconSvg('externalLink', 10)}</a>
        </div>
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
                  <div class="jersey-chip mono">${p.jersey !== null && p.jersey !== undefined ? `#${p.jersey}` : '—'}</div>
                  ${renderPlayerAvatarHtml(p, 34)}
                  <div class="player-meta-main">
                    <div class="player-name-line">${esc(p.name)} <span style="color:var(--gold-bright);font-size:12px">${esc(p.position)}</span></div>
                    <div class="player-sub-line">
                      ${esc(p.rosterBucket === 'active' ? '53-Man' : p.rosterBucket === 'ir' ? 'IR/Out' : 'Prac. Squad')} •
                      Snaps <span class="mono">${p.primarySnapPct}%</span> •
                      RAS <span class="mono">${Number(p.spiderProfile?.compositeRas || 0).toFixed(1)}</span>${p.age ? ` • Age <span class="mono">${p.age}</span>` : ''}
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
  const units = appData?.depthChart?.units || [];
  const depthWk = appData?.depthChart?.week || appData?.meta?.currentWeek || '';

  const headerCard = `
    <div class="card">
      <div class="card-header">
        <div class="card-header-left">
          <div class="card-icon-badge" aria-hidden="true">${iconSvg('layers', 18)}</div>
          <div class="card-title-group">
            <div class="card-eyebrow">11/21 Offense • Wide-9 Base &amp; Nickel 4-2-5 Defense</div>
            <h2 class="card-title">49ers Depth Chart</h2>
          </div>
        </div>
        <div class="source-link-strip">
          <a href="https://www.espn.com/nfl/team/depth/_/name/sf/san-francisco-49ers" target="_blank" rel="noopener noreferrer" class="source-chip-link"><span>ESPN Depth</span>${iconSvg('externalLink', 10)}</a>
          <a href="https://www.ourlads.com/nfldepthcharts/depthchart/SF" target="_blank" rel="noopener noreferrer" class="source-chip-link"><span>Ourlads</span>${iconSvg('externalLink', 10)}</a>
        </div>
      </div>
      <div class="segmented-control" role="tablist" aria-label="Depth Chart Mode">
        <button type="button" class="pill-btn seg-btn ${depthMode === 'projected' ? 'active' : ''}" data-action="set-depth-mode" data-depth-mode="projected">
          ${iconSvg('bolt', 14)}
          <span>Projected ${depthWk ? `Week ${depthWk} ` : ''}Active (Injury-Adjusted)</span>
        </button>
        <button type="button" class="pill-btn seg-btn ${depthMode === 'baseline' ? 'active' : ''}" data-action="set-depth-mode" data-depth-mode="baseline">
          ${iconSvg('layers', 14)}
          <span>Full-Roster Hierarchy</span>
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
                    ${
                      idx === 0
                        ? `${renderPlayerAvatarHtml({ name: c.name, jersey: c.jersey, headshotUrl: c.headshotUrl }, 20)} `
                        : ''
                    }
                    ${c.jersey !== null && c.jersey !== undefined ? `<span class="mono" style="color:var(--text-muted)">#${c.jersey}</span> ` : ''}
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
  const y26 = years['2026'] || {};
  const ceiling = Math.max(1, Number(y26.capCeiling || 304000000));
  const openSpace = Math.max(0, Number(sum.updatedCapSpace ?? y26.teamCapSpace ?? 0));
  const deadCap = Math.max(0, Number(y26.deadMoneyTotal || 0) + Number(sum.baseYearDeadMoneyAdded || 0));
  const activeUsed = Math.max(0, ceiling - openSpace - deadCap);
  const activePct = Math.min(100, (activeUsed / ceiling) * 100);
  const deadPct = Math.min(100 - activePct, (deadCap / ceiling) * 100);
  const spacePct = Math.max(0, 100 - activePct - deadPct);
  const otcTeamUrl = appData?.cap?.sourceUrl || 'https://overthecap.com/salary-cap/san-francisco-49ers';
  const spotracUrl = appData?.cap?.spotracUrl || 'https://www.spotrac.com/nfl/san-francisco-49ers/cap/';
  const nflpaUrl = appData?.cap?.nflpaUrl || 'https://nflpa.com/reports/public-salary-cap-report';

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
      <div class="alert-banner-danger">
        ${iconSvg('alert', 15)}
        <span>${esc(w)}</span>
      </div>
    `
    )
    .join('');

  return `
    <!-- Multi-Year Cap Horizon -->
    <section class="card">
      <div class="card-header">
        <div class="card-header-left">
          <div class="card-icon-badge" aria-hidden="true">${iconSvg('cap', 18)}</div>
          <div class="card-title-group">
            <div class="card-eyebrow">OverTheCap &amp; NFLPA Ledger • 2026–2029</div>
            <h2 class="card-title">Multi-Year Salary Cap Horizon</h2>
          </div>
        </div>
        <button type="button" class="btn-ghost" data-action="analyze-topic-jump"
                data-prompt="Analyze the 49ers 2026-2028 salary cap rollover strategy, option bonus proration on Purdy and Bosa, and Brandon Aiyuk cap scenarios">
          ${iconSvg('sparkles', 13)}
          <span>AI Cap Audit</span>
        </button>
      </div>

      <div class="source-link-strip" style="margin-bottom:10px">
        <a href="${esc(otcTeamUrl)}" target="_blank" rel="noopener noreferrer" class="source-chip-link"><span>OverTheCap 49ers Table</span>${iconSvg('externalLink', 11)}</a>
        <a href="${esc(spotracUrl)}" target="_blank" rel="noopener noreferrer" class="source-chip-link"><span>Spotrac 49ers Cap</span>${iconSvg('externalLink', 11)}</a>
        <a href="${esc(nflpaUrl)}" target="_blank" rel="noopener noreferrer" class="source-chip-link"><span>NFLPA Public Cap</span>${iconSvg('externalLink', 11)}</a>
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
          <div class="subcard-panel" style="font-size:12.5px">
            <strong>${esc(sp.title)}:</strong> <span style="color:var(--text-secondary)">${esc(sp.detail)}</span>
          </div>
        `
          )
          .join('')}
      </div>
    </section>

    <!-- Interactive GM Cap Simulator -->
    <section class="card">
      <div class="card-header">
        <div class="card-header-left">
          <div class="card-icon-badge temporal" aria-hidden="true">${iconSvg('bolt', 18)}</div>
          <div class="card-title-group">
            <div class="card-eyebrow">CBA Cap Calculator • Top-53 Replacement Rule Applied</div>
            <h2 class="card-title">GM Salary Cap Simulator</h2>
          </div>
        </div>
        <div style="display:flex;gap:6px">
          <button type="button" class="btn-secondary" data-action="apply-ai-cap-blueprint">${iconSvg('sparkles', 13)}<span>Blueprint</span></button>
          <button type="button" class="btn-ghost" data-action="reset-cap-moves">${iconSvg('reset', 13)}<span>Reset</span></button>
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
        <div class="cap-alloc-wrap">
          <div class="cap-alloc-bar" aria-label="2026 Cap Allocation">
            <span class="cap-seg-active" style="width:${activePct.toFixed(1)}%"></span>
            <span class="cap-seg-dead" style="width:${deadPct.toFixed(1)}%"></span>
            <span class="cap-seg-space" style="width:${spacePct.toFixed(1)}%"></span>
          </div>
          <div class="cap-alloc-legend">
            <span><i class="cap-legend-dot" style="background:var(--scarlet-bright)"></i>Active Roster ${activePct.toFixed(0)}%</span>
            <span><i class="cap-legend-dot" style="background:var(--amber)"></i>Dead Cap ${deadPct.toFixed(0)}%</span>
            <span><i class="cap-legend-dot" style="background:var(--emerald)"></i>Open Space ${spacePct.toFixed(0)}%</span>
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
                  <div style="display:flex;align-items:center;gap:9px;min-width:0">
                    <span style="cursor:pointer;display:inline-flex" data-action="open-player-sheet" data-player-id="${esc(p.id)}">
                      ${renderPlayerAvatarHtml(p, 36, { showJerseyBadge: true })}
                    </span>
                    <div style="min-width:0">
                      <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap">
                        <span style="cursor:pointer" data-action="open-player-sheet" data-player-id="${esc(p.id)}">
                          <strong>${esc(p.name)}</strong> <span style="color:var(--gold-bright);font-size:11.5px">${esc(p.position)}</span>
                        </span>
                        ${
                          p.otcUrl
                            ? `<a href="${esc(p.otcUrl)}" target="_blank" rel="noopener noreferrer" class="ext-link" style="font-size:11px">OTC ${iconSvg('externalLink', 10)}</a>`
                            : ''
                        }
                      </div>
                      <div class="mono" style="font-size:11px;color:var(--text-secondary)">
                        2026 Cap: ${formatCompactDollars(c26.capNumber)} • Base: ${formatCompactDollars(c26.baseSalary)}
                      </div>
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
