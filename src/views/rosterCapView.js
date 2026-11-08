/**
 * Roster Explorer, Dual-Mode Depth Chart & Interactive GM Salary Cap View
 */

import { esc, escJargon, jargonTerm, playProbBadgeClass, renderPlayerAvatarHtml } from './uiHelpers.js';
import { iconSvg } from './icons.js';
import { formatOtcDollars, formatCompactDollars } from '../engine/capSimulator.js';

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
  capSelectedYear = '2026',
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
  return (
    topSwitcher +
    renderSalaryCapAndSimulator({
      appData,
      simCapResult,
      userCapMoves,
      capSelectedYear
    })
  );
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
        <span>Showing <strong>${filtered.length}</strong> players — tap any row for Stats, ${jargonTerm('EPA', 'epa')}, ${jargonTerm('RAS', 'ras')} &amp; Contract details.</span>
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
            <div class="card-eyebrow">${jargonTerm('11 personnel', '11_personnel')} / ${jargonTerm('21 personnel', '21_personnel')} Offense • ${jargonTerm('Wide-9', 'wide_9')} Base &amp; Nickel 4-2-5 Defense</div>
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

function renderOtcYearTabs(yrKeys, selectedYr, yearsMap, ariaLabel) {
  return `
    <div class="otc-year-tabs" role="tablist" aria-label="${esc(ariaLabel)}">
      ${yrKeys
        .map(y => {
          const row = yearsMap[y] || {};
          const active = y === selectedYr;
          return `
            <button type="button" role="tab" aria-selected="${active}"
                    class="otc-year-tab mono ${active ? 'active' : ''}"
                    data-action="set-cap-year" data-cap-year="${esc(y)}">
              <span>${esc(y)}</span>
              <span class="otc-year-tab-sub">${formatCompactDollars(row.teamCapSpace || 0, true)}</span>
            </button>
          `;
        })
        .join('')}
    </div>
  `;
}

function formatCurrentBonusSubLabel(p) {
  const parts = [];
  if (p.rosterBonusRegular > 0) parts.push(`Reg ${formatCompactDollars(p.rosterBonusRegular)}`);
  if (p.rosterBonusPerGame > 0) parts.push(`PG ${formatCompactDollars(p.rosterBonusPerGame)}`);
  if (p.workoutBonus > 0) parts.push(`Wk ${formatCompactDollars(p.workoutBonus)}`);
  if (p.otherBonus > 0) parts.push(`Oth ${formatCompactDollars(p.otherBonus)}`);
  return parts.join(' • ');
}

function formatProratedSubLabel(p) {
  const parts = [];
  if (p.proratedSigning > 0) parts.push(`Sign ${formatCompactDollars(p.proratedSigning)}`);
  if (p.proratedOption > 0) parts.push(`Opt ${formatCompactDollars(p.proratedOption)}`);
  return parts.join(' • ');
}

function renderSalaryCapAndSimulator({ appData, simCapResult, userCapMoves = {}, capSelectedYear }) {
  const years = appData?.cap?.years || {};
  const sortedYrKeys = Object.keys(years).sort().slice(0, 5);
  const firstYrKey = sortedYrKeys[0] || String(appData?.meta?.seasonYear || 2026);
  const horizonEndKey = sortedYrKeys[sortedYrKeys.length - 1] || String(Number(firstYrKey) + 4);

  const selectedYrKey =
    capSelectedYear && years[String(capSelectedYear)]
      ? String(capSelectedYear)
      : simCapResult?.baseYear && years[String(simCapResult.baseYear)]
        ? String(simCapResult.baseYear)
        : firstYrKey;

  const nextYrNum = Number(selectedYrKey) + 1;
  const nextYrKey = String(nextYrNum);
  const hasNextYrInLedger = Boolean(years[nextYrKey]);

  const blueprint = appData?.cap?.blueprint || {};
  const yrRow = years[selectedYrKey] || {};
  const isSimForSelectedYr = String(simCapResult?.baseYear || firstYrKey) === selectedYrKey;
  const sum = isSimForSelectedYr ? simCapResult?.summary || {} : {};
  const activeMoveCount = isSimForSelectedYr ? Number(simCapResult?.moveCount || 0) : 0;

  const yrCeiling = Math.max(1, Number(yrRow.capCeiling || 304000000));
  const yrGrossSpace =
    activeMoveCount > 0 && sum.updatedCapSpace !== undefined
      ? Number(sum.updatedCapSpace)
      : Number(yrRow.teamCapSpace || 0);
  const yrEffectiveSpace =
    activeMoveCount > 0 && sum.updatedEffectiveCapSpace !== undefined
      ? Number(sum.updatedEffectiveCapSpace)
      : Number(yrRow.effectiveCapSpace ?? yrRow.teamCapSpace ?? 0);
  const yrLiabilities =
    activeMoveCount > 0 && sum.updatedTotalLiabilities !== undefined
      ? Number(sum.updatedTotalLiabilities)
      : Number(yrRow.totalCapLiabilities ?? yrRow.totalLiabilities ?? 0);
  const yrTop51 =
    activeMoveCount > 0 && sum.updatedTop51 !== undefined
      ? Number(sum.updatedTop51)
      : Number(yrRow.top51 || 0);
  const simAddedDead = activeMoveCount > 0 ? Number(sum.baseYearDeadMoneyAdded || 0) : 0;
  const yrDeadMoney = Number(yrRow.deadMoneyTotal || 0) + simAddedDead;
  const yrActiveRosterCount =
    activeMoveCount > 0 && sum.activeContractedCount !== undefined
      ? Number(sum.activeContractedCount)
      : Number(yrRow.contractedCount || 0);

  const openSpaceForBar = Math.max(0, yrGrossSpace);
  const deadCapForBar = Math.max(0, yrDeadMoney);
  const activeUsedForBar = Math.max(0, yrCeiling - openSpaceForBar - deadCapForBar);
  const activePct = Math.min(100, (activeUsedForBar / yrCeiling) * 100);
  const deadPct = Math.min(100 - activePct, (deadCapForBar / yrCeiling) * 100);
  const spacePct = Math.max(0, 100 - activePct - deadPct);

  const otcTeamUrl = appData?.cap?.sourceUrl || 'https://overthecap.com/salary-cap/san-francisco-49ers';
  const spotracUrl = appData?.cap?.spotracUrl || 'https://www.spotrac.com/nfl/san-francisco-49ers/cap/';
  const nflpaUrl = appData?.cap?.nflpaUrl || 'https://nflpa.com/reports/public-salary-cap-report';

  // Fallback player list if simCapResult wasn't computed for selectedYrKey
  const simPlayers =
    isSimForSelectedYr && Array.isArray(simCapResult?.simulatedPlayers)
      ? simCapResult.simulatedPlayers
      : (appData?.cap?.players || [])
          .filter(p => Boolean(p?.contractsByYear?.[selectedYrKey]))
          .sort(
            (a, b) =>
              (b.contractsByYear?.[selectedYrKey]?.capNumber || 0) -
              (a.contractsByYear?.[selectedYrKey]?.capNumber || 0)
          )
          .map(p => {
            const c = p.contractsByYear[selectedYrKey];
            const proratedSigning = Number(c.proratedSigning) || 0;
            const proratedOption = Number(c.proratedOption) || 0;
            const rosterBonusRegular = Number(c.rosterBonusRegular) || 0;
            const rosterBonusPerGame = Number(c.rosterBonusPerGame) || 0;
            const workoutBonus = Number(c.workoutBonus) || 0;
            const otherBonus = Number(c.otherBonus) || 0;
            return {
              id: p.id,
              name: p.name,
              position: p.position,
              jersey: p.jersey,
              headshotUrl: p.headshotUrl,
              otcUrl: p.otcUrl,
              year: Number(selectedYrKey),
              isVoidYear: Boolean(c.isVoidYear),
              baseSalary: Number(c.baseSalary) || 0,
              proratedSigning,
              proratedOption,
              proratedBonus: proratedSigning + proratedOption,
              rosterBonusRegular,
              rosterBonusPerGame,
              workoutBonus,
              otherBonus,
              currentYearBonuses:
                rosterBonusRegular + rosterBonusPerGame + workoutBonus + otherBonus,
              guaranteedSalary: Number(c.guaranteedSalary) || 0,
              capNumber: Number(c.capNumber) || 0,
              effectiveCapNumber: Number(c.capNumber) || 0,
              selectedMove: userCapMoves?.[p.id] || 'none',
              moveDeadMoney: 0,
              moveCapSavings: 0,
              transactions: c.transactions || {}
            };
          });

  const horizonRows = sortedYrKeys
    .map(y => {
      const row = years[y] || {};
      const isSel = y === selectedYrKey;
      const grossVal = Number(row.teamCapSpace || 0);
      const effVal = Number(row.effectiveCapSpace ?? grossVal);
      const liabVal = Number(row.totalCapLiabilities ?? row.totalLiabilities ?? 0);
      return `
        <tr style="cursor:pointer;${isSel ? 'background:var(--gold-soft)' : ''}"
            data-action="set-cap-year" data-cap-year="${esc(y)}">
          <td><strong>${esc(y)}</strong>${row.capCeilingProjected ? ' <span style="font-size:10px;color:var(--text-muted)">(Est.)</span>' : ''}</td>
          <td>${formatCompactDollars(row.capCeiling)}</td>
          <td>${formatCompactDollars(liabVal)}</td>
          <td>${formatCompactDollars(row.top51 || 0)}</td>
          <td style="color:${grossVal >= 0 ? 'var(--emerald)' : 'var(--crimson)'}"><strong>${formatCompactDollars(grossVal, true)}</strong></td>
          <td style="color:${effVal >= 0 ? 'var(--emerald)' : 'var(--crimson)'}">${formatCompactDollars(effVal, true)}</td>
          <td>${formatCompactDollars(row.deadMoneyTotal || 0)}</td>
          <td>${row.contractedCount || 0}</td>
        </tr>
      `;
    })
    .join('');

  const topDeadItems = yrRow.topDeadMoneyEntries || [];
  const hasNonActiveCharges =
    yrDeadMoney > 0 ||
    Number(yrRow.injuredReserveTotal || 0) > 0 ||
    Number(yrRow.practiceSquadTotal || 0) > 0 ||
    Number(yrRow.pupTotal || 0) > 0 ||
    Number(yrRow.suspendedTotal || 0) > 0;

  const nonActiveLedgerHtml = hasNonActiveCharges
    ? `
      <div class="subcard-panel" style="margin-top:10px;font-size:12px">
        <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:5px">
          <strong style="color:var(--gold-bright)">${esc(selectedYrKey)} Non-Active &amp; Dead Cap Breakdown (OverTheCap)</strong>
          <span class="mono" style="color:var(--amber)">Dead Money: ${formatOtcDollars(yrDeadMoney)}</span>
        </div>
        <div style="display:flex;flex-wrap:wrap;gap:10px;color:var(--text-secondary);font-size:11.5px;margin-bottom:${topDeadItems.length ? '6px' : '0'}">
          ${Number(yrRow.injuredReserveTotal || 0) > 0 ? `<span>Injured Reserve: <strong class="mono">${formatCompactDollars(yrRow.injuredReserveTotal)}</strong></span>` : ''}
          ${Number(yrRow.practiceSquadTotal || 0) > 0 ? `<span>Practice Squad: <strong class="mono">${formatCompactDollars(yrRow.practiceSquadTotal)}</strong></span>` : ''}
          ${Number(yrRow.pupTotal || 0) > 0 ? `<span>PUP: <strong class="mono">${formatCompactDollars(yrRow.pupTotal)}</strong></span>` : ''}
          ${Number(yrRow.suspendedTotal || 0) > 0 ? `<span>Suspended: <strong class="mono">${formatCompactDollars(yrRow.suspendedTotal)}</strong></span>` : ''}
          ${simAddedDead > 0 ? `<span style="color:var(--crimson)">Sim Added Dead Cap: <strong class="mono">+${formatCompactDollars(simAddedDead)}</strong></span>` : ''}
        </div>
        ${
          topDeadItems.length > 0
            ? `<div style="font-size:11.5px;color:var(--text-muted)">
                <strong>Largest ${esc(selectedYrKey)} Dead Charges:</strong>
                ${topDeadItems
                  .slice(0, 6)
                  .map(d => `${esc(d.name)} (<span class="mono">${formatCompactDollars(d.capCharge)}</span>)`)
                  .join(' • ')}
              </div>`
            : ''
        }
      </div>
    `
    : '';

  const warningsHtml = (isSimForSelectedYr ? simCapResult?.warnings || [] : [])
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
    <!-- OverTheCap 5-Year Cap Summary (This Year + Next 4 Years) -->
    <section class="card" id="capHorizonSummaryCard">
      <div class="card-header">
        <div class="card-header-left">
          <div class="card-icon-badge" aria-hidden="true">${iconSvg('cap', 18)}</div>
          <div class="card-title-group">
            <div class="card-eyebrow">OverTheCap &amp; NFLPA Ledger • ${esc(firstYrKey)}–${esc(horizonEndKey)} (5-Year Horizon)</div>
            <h2 class="card-title">49ers Salary Cap Summary (${esc(selectedYrKey)})</h2>
          </div>
        </div>
        <button type="button" class="btn-ghost" data-action="analyze-topic-jump"
                data-prompt="Analyze the 49ers ${esc(firstYrKey)}-${esc(horizonEndKey)} salary cap rollover strategy, option bonus proration on Purdy and Bosa, and multi-year cap flexibility">
          ${iconSvg('sparkles', 13)}
          <span>AI Cap Audit</span>
        </button>
      </div>

      <div class="source-link-strip" style="margin-bottom:10px">
        <a href="${esc(otcTeamUrl)}" target="_blank" rel="noopener noreferrer" class="source-chip-link"><span>OverTheCap 49ers Table</span>${iconSvg('externalLink', 11)}</a>
        <a href="${esc(spotracUrl)}" target="_blank" rel="noopener noreferrer" class="source-chip-link"><span>Spotrac 49ers Cap</span>${iconSvg('externalLink', 11)}</a>
        <a href="${esc(nflpaUrl)}" target="_blank" rel="noopener noreferrer" class="source-chip-link"><span>NFLPA Public Cap</span>${iconSvg('externalLink', 11)}</a>
      </div>

      ${renderOtcYearTabs(sortedYrKeys, selectedYrKey, years, 'Select Salary Cap Summary Year')}

      <!-- Selected Year OverTheCap Top-of-Page Summary Metrics -->
      <div class="kpi-grid" style="margin-bottom:8px">
        <div class="kpi-box">
          <div class="kpi-label">${esc(selectedYrKey)} Projected Gross Space</div>
          <div class="kpi-val mono" style="color:${yrGrossSpace >= 0 ? 'var(--emerald)' : 'var(--crimson)'}">
            ${formatOtcDollars(yrGrossSpace)}
          </div>
          <div class="mono" style="font-size:10.5px;color:var(--text-muted)">
            ${yrRow.capCeilingProjected ? 'Proj. CBA Cap Ceiling' : 'OTC Team Cap Space'}
          </div>
        </div>
        <div class="kpi-box">
          <div class="kpi-label">${jargonTerm('Effective Cap Space', 'effective_cap_space')}</div>
          <div class="kpi-val mono" style="color:${yrEffectiveSpace >= 0 ? 'var(--emerald)' : 'var(--crimson)'}">
            ${formatOtcDollars(yrEffectiveSpace)}
          </div>
          <div class="mono" style="font-size:10.5px;color:var(--text-muted)">After Top-51 / Rookie Pool</div>
        </div>
        <div class="kpi-box">
          <div class="kpi-label">Total Cap Liabilities</div>
          <div class="kpi-val mono">${formatOtcDollars(yrLiabilities)}</div>
          <div class="mono" style="font-size:10.5px;color:var(--text-muted)">
            Ceiling: ${formatCompactDollars(yrCeiling)}${yrRow.capCeilingProjected ? ' (Est.)' : ''}
          </div>
        </div>
        <div class="kpi-box">
          <div class="kpi-label">${jargonTerm('Top-51', 'top_51')} Cap Charge</div>
          <div class="kpi-val mono">${formatOtcDollars(yrTop51)}</div>
          <div class="mono" style="font-size:10.5px;color:var(--text-muted)">
            ${yrActiveRosterCount} Active / ${yrRow.totalSignedCount || yrActiveRosterCount} Signed
          </div>
        </div>
        <div class="kpi-box">
          <div class="kpi-label">${esc(selectedYrKey)} ${jargonTerm('Dead Cap', 'dead_cap')}</div>
          <div class="kpi-val mono" style="color:${yrDeadMoney > 0 ? 'var(--amber)' : 'var(--text-primary)'}">
            ${formatOtcDollars(yrDeadMoney)}
          </div>
          <div class="mono" style="font-size:10.5px;color:var(--text-muted)">
            ${yrDeadMoney > 0 ? `${((yrDeadMoney / yrCeiling) * 100).toFixed(1)}% of Team Cap` : 'Clean Ledger ($0)'}
          </div>
        </div>
        <div class="kpi-box">
          <div class="kpi-label">Active Roster Spend</div>
          <div class="kpi-val mono">${formatCompactDollars(yrRow.activeCapSpending || 0)}</div>
          <div class="mono" style="font-size:10.5px;color:var(--text-muted)">
            Off ${formatCompactDollars(yrRow.offenseSpend || 0)} • Def ${formatCompactDollars(yrRow.defenseSpend || 0)}
          </div>
        </div>
      </div>

      ${nonActiveLedgerHtml}

      <div class="sub-label" style="margin:12px 0 6px">${esc(firstYrKey)}–${esc(horizonEndKey)} Multi-Year OverTheCap Comparison (Tap Any Year)</div>
      <div class="table-scroll">
        <table class="data-table mono">
          <thead>
            <tr>
              <th>Year</th><th>Cap Ceiling</th><th>Total Liabilities</th><th>Top-51</th><th>Gross Space</th><th>Effective Space</th><th>Dead Cap</th><th>Signed</th>
            </tr>
          </thead>
          <tbody>${horizonRows}</tbody>
        </table>
      </div>

      <div style="margin-top:10px;font-size:12.5px;color:var(--text-secondary)">
        <strong style="color:var(--gold-bright)">Front Office Blueprint:</strong> ${escJargon(blueprint.executiveSummary || '')}
      </div>

      <div style="display:flex;flex-direction:column;gap:7px;margin-top:9px">
        ${(blueprint.strategicPillars || [])
          .map(
            sp => `
          <div class="subcard-panel" style="font-size:12.5px">
            <strong>${esc(sp.title)}:</strong> <span style="color:var(--text-secondary)">${escJargon(sp.detail)}</span>
          </div>
        `
          )
          .join('')}
      </div>
    </section>

    <!-- Multi-Year Interactive OverTheCap Salary Cap Simulator -->
    <section class="card" id="capSimulatorCard">
      <div class="card-header">
        <div class="card-header-left">
          <div class="card-icon-badge temporal" aria-hidden="true">${iconSvg('bolt', 18)}</div>
          <div class="card-title-group">
            <div class="card-eyebrow">CBA Cap Calculator • ${jargonTerm('Post-June 1', 'post_june_1')} &amp; Replacement Rules Applied</div>
            <h2 class="card-title">Salary Cap Simulator (${esc(selectedYrKey)})</h2>
          </div>
        </div>
        <div style="display:flex;gap:6px;flex-wrap:wrap">
          <button type="button" class="btn-secondary" data-action="apply-ai-cap-blueprint">${iconSvg('sparkles', 13)}<span>Blueprint</span></button>
          <button type="button" class="btn-ghost" data-action="reset-cap-moves">${iconSvg('reset', 13)}<span>Reset ${esc(selectedYrKey)}</span></button>
        </div>
      </div>

      ${renderOtcYearTabs(sortedYrKeys, selectedYrKey, years, 'Select Salary Cap Simulator Year')}

      <div class="gm-summary-banner">
        <div class="kpi-grid">
          <div class="kpi-box">
            <div class="kpi-label">${esc(selectedYrKey)} Simulated Gross Space</div>
            <div class="kpi-val mono" style="color:${yrGrossSpace >= 0 ? 'var(--emerald)' : 'var(--crimson)'}">
              ${formatCompactDollars(yrGrossSpace)}
            </div>
            <div class="mono" style="font-size:10.5px;color:var(--text-secondary)">
              Sim Delta: ${formatCompactDollars(sum.baseYearNetCapDelta || 0, true)}
            </div>
          </div>
          <div class="kpi-box">
            <div class="kpi-label">${hasNextYrInLedger ? `${esc(nextYrKey)} Projected Space` : `${esc(selectedYrKey)} Effective Space`}</div>
            <div class="kpi-val mono" style="color:${(hasNextYrInLedger ? (sum.updatedNextYearCapSpace ?? years[nextYrKey]?.teamCapSpace ?? 0) : yrEffectiveSpace) >= 0 ? 'var(--emerald)' : 'var(--crimson)'}">
              ${
                hasNextYrInLedger
                  ? formatCompactDollars(sum.updatedNextYearCapSpace ?? years[nextYrKey]?.teamCapSpace ?? 0)
                  : formatCompactDollars(yrEffectiveSpace)
              }
            </div>
            <div class="mono" style="font-size:10.5px;color:var(--text-secondary)">
              ${hasNextYrInLedger ? `${esc(nextYrKey)} Delta: ${formatCompactDollars(sum.nextYearCapDelta || 0, true)}` : 'After Replacement Rule'}
            </div>
          </div>
          <div class="kpi-box">
            <div class="kpi-label">New ${esc(selectedYrKey)} Dead Cap</div>
            <div class="kpi-val mono" style="color:var(--amber)">${formatCompactDollars(simAddedDead, true)}</div>
            <div class="mono" style="font-size:10.5px;color:var(--text-secondary)">
              ${activeMoveCount} move(s) active in ${esc(selectedYrKey)}
            </div>
          </div>
        </div>
        <div class="cap-alloc-wrap">
          <div class="cap-alloc-bar" aria-label="${esc(selectedYrKey)} Cap Allocation">
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

      <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:8px">
        <div class="sub-label" style="margin:0">Active Roster (${simPlayers.length} total) — ${esc(selectedYrKey)} Ledger</div>
        <span style="font-size:11.5px;color:var(--text-muted)">
          Dead Money &amp; Cap Savings are nominally <strong class="mono">$0</strong> when keeping a player; select any roster move to model CBA impact.
        </span>
      </div>

      <div class="table-scroll">
        <table class="data-table cap-sim-table mono" aria-label="${esc(selectedYrKey)} OverTheCap Player Salary Cap Simulator">
          <thead>
            <tr>
              <th style="font-family:var(--font-sans)">Player</th>
              <th>Base Salary</th>
              <th>${jargonTerm('Prorated Bonuses', 'prorated_bonus')}</th>
              <th>Current Yr Bonuses</th>
              <th>${jargonTerm('Guaranteed Salary', 'guaranteed_salary')}</th>
              <th>Cap Number</th>
              <th style="font-family:var(--font-sans)">Roster Move</th>
              <th>${jargonTerm('Dead Money', 'dead_cap')}</th>
              <th>Cap Savings</th>
            </tr>
          </thead>
          <tbody>
            ${simPlayers
              .map(p => {
                const selected = p.selectedMove || 'none';
                const tx = p.transactions || {};
                const proratedSub = formatProratedSubLabel(p);
                const curBonusSub = formatCurrentBonusSubLabel(p);
                const isModified = selected !== 'none';
                const deadCls = isModified && p.moveDeadMoney > 0 ? 'cap-cell-dead-active' : '';
                const saveCls = isModified
                  ? p.moveCapSavings > 0
                    ? 'cap-cell-save-pos'
                    : p.moveCapSavings < 0
                      ? 'cap-cell-save-neg'
                      : ''
                  : '';

                return `
                  <tr class="${isModified ? 'has-active-move' : ''}" data-sim-player-row="${esc(p.id)}">
                    <td style="font-family:var(--font-sans)">
                      <div style="display:flex;align-items:center;gap:8px;min-width:165px">
                        <span style="cursor:pointer;display:inline-flex;flex-shrink:0" data-action="open-player-sheet" data-player-id="${esc(p.id)}" data-initial-tab="contract">
                          ${renderPlayerAvatarHtml(p, 30)}
                        </span>
                        <div style="min-width:0">
                          <div style="display:flex;align-items:center;gap:5px">
                            <span style="cursor:pointer;font-weight:700;color:var(--text-primary)" data-action="open-player-sheet" data-player-id="${esc(p.id)}" data-initial-tab="contract">${esc(p.name)}</span>
                            <span style="color:var(--gold-bright);font-size:11px;font-weight:700">${esc(p.position)}</span>
                            ${
                              p.otcUrl
                                ? `<a href="${esc(p.otcUrl)}" target="_blank" rel="noopener noreferrer" class="ext-link" style="font-size:10.5px" title="OverTheCap Contract">${iconSvg('externalLink', 10)}</a>`
                                : ''
                            }
                          </div>
                        </div>
                      </div>
                    </td>
                    <td>
                      ${
                        p.isVoidYear
                          ? `<span class="badge badge-neutral" title="Void Year">${jargonTerm('Void', 'void_years')}</span>`
                          : formatOtcDollars(p.baseSalary)
                      }
                    </td>
                    <td>
                      ${formatOtcDollars(p.proratedBonus)}
                      ${proratedSub ? `<span class="cap-cell-sub">${esc(proratedSub)}</span>` : ''}
                    </td>
                    <td>
                      ${formatOtcDollars(p.currentYearBonuses)}
                      ${curBonusSub ? `<span class="cap-cell-sub">${esc(curBonusSub)}</span>` : ''}
                    </td>
                    <td>${formatOtcDollars(p.guaranteedSalary)}</td>
                    <td>
                      <strong>${formatOtcDollars(p.capNumber)}</strong>
                      ${isModified ? `<span class="cap-cell-sub">Sim: ${formatOtcDollars(p.effectiveCapNumber)}</span>` : ''}
                    </td>
                    <td style="font-family:var(--font-sans)">
                      <select class="select-input gm-move-select"
                              data-player-id="${esc(p.id)}"
                              data-cap-year="${esc(selectedYrKey)}"
                              aria-label="Roster Move for ${esc(p.name)} (${esc(selectedYrKey)})">
                        <option value="none" ${selected === 'none' ? 'selected' : ''}>Do Nothing ($0 / $0)</option>
                        <option value="cut" ${selected === 'cut' ? 'selected' : ''}>
                          Cut Pre-6/1 (${formatCompactDollars(tx.cut?.capSavings || 0, true)})
                        </option>
                        <option value="june_1_cut" ${selected === 'june_1_cut' ? 'selected' : ''}>
                          Cut Post-6/1 (${formatCompactDollars(tx.june_1_cut?.capSavings || 0, true)})
                        </option>
                        <option value="trade" ${selected === 'trade' ? 'selected' : ''}>
                          Trade Pre-6/1 (${formatCompactDollars(tx.trade?.capSavings || 0, true)})
                        </option>
                        <option value="june_1_trade" ${selected === 'june_1_trade' ? 'selected' : ''}>
                          Trade Post-6/1 (${formatCompactDollars(tx.june_1_trade?.capSavings || 0, true)})
                        </option>
                        <option value="restructure" ${selected === 'restructure' ? 'selected' : ''}>
                          Restructure (${formatCompactDollars(tx.restructure?.capSavings || 0, true)})
                        </option>
                        <option value="extension" ${selected === 'extension' ? 'selected' : ''}>
                          Extension (${formatCompactDollars(tx.extension?.capSavings || 0, true)})
                        </option>
                      </select>
                    </td>
                    <td class="${deadCls}" data-col="dead-money">
                      ${isModified ? formatOtcDollars(p.moveDeadMoney) : '$0'}
                    </td>
                    <td class="${saveCls}" data-col="cap-savings">
                      ${isModified ? formatOtcDollars(p.moveCapSavings) : '$0'}
                    </td>
                  </tr>
                `;
              })
              .join('')}
          </tbody>
        </table>
      </div>
    </section>
  `;
}
