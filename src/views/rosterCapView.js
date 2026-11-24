/**
 * Roster Explorer, Dual-Mode Depth Chart & Interactive GM Salary Cap View
 */

import {
  esc,
  escJargon,
  jargonTerm,
  playProbBadgeClass,
  resolvePlayerPlayBadgeLabel,
  renderPlayerAvatarHtml,
  lookupRosterPlayerByName,
  registerRosterPlayersForInlineLinks
} from './uiHelpers.js';
import { iconSvg } from './icons.js';
import { formatOtcDollars, formatCompactDollars } from '../engine/capSimulator.js';
import {
  buildPositionalCapSpendModel,
  buildUpcomingFreeAgentsModel
} from '../engine/teamDeepDiveEngine.js';
import { sanitizeExternalUrl } from '../engine/linkIntegrity.js';
import { getActiveTeamConfig, getOurladsTeamCode } from '../config/teamRegistry.js';

export const ROSTER_SORT_FIELDS = [
  { key: 'jersey', label: 'Roster Number', shortLabel: 'Roster #', defaultDir: 'asc' },
  { key: 'firstName', label: 'First Name', shortLabel: 'First Name', defaultDir: 'asc' },
  { key: 'lastName', label: 'Last Name', shortLabel: 'Last Name', defaultDir: 'asc' },
  { key: 'cap', label: '2026 Cap Hit', shortLabel: 'Cap Hit', defaultDir: 'desc' },
  { key: 'snaps', label: 'Snap Share %', shortLabel: 'Snap %', defaultDir: 'desc' },
  { key: 'health', label: 'Play Likelihood', shortLabel: 'Health', defaultDir: 'asc' },
  { key: 'ras', label: 'Athletic RAS', shortLabel: 'RAS', defaultDir: 'desc' },
  { key: 'age', label: 'Age', shortLabel: 'Age', defaultDir: 'asc' }
];

export function extractPlayerSortNameParts(fullName = '') {
  const raw = String(fullName || '').trim();
  if (!raw) return { firstName: '', lastName: '', fullName: '' };
  const withoutSuffix = raw
    .replace(/,?\s+\b(?:jr\.?|sr\.?|ii|iii|iv|v)\b\.?$/i, '')
    .trim();
  const tokens = (withoutSuffix || raw).split(/\s+/).filter(Boolean);
  if (tokens.length === 1) {
    return { firstName: tokens[0], lastName: tokens[0], fullName: raw };
  }
  const lastName = tokens[tokens.length - 1];
  const firstName = tokens.slice(0, -1).join(' ');
  return { firstName, lastName, fullName: raw };
}

export function comparePlayersByFirstName(a, b) {
  const pa = extractPlayerSortNameParts(a?.name);
  const pb = extractPlayerSortNameParts(b?.name);
  return (
    pa.firstName.localeCompare(pb.firstName, undefined, { sensitivity: 'base' }) ||
    pa.lastName.localeCompare(pb.lastName, undefined, { sensitivity: 'base' }) ||
    pa.fullName.localeCompare(pb.fullName, undefined, { sensitivity: 'base' })
  );
}

export function comparePlayersByLastName(a, b) {
  const pa = extractPlayerSortNameParts(a?.name);
  const pb = extractPlayerSortNameParts(b?.name);
  return (
    pa.lastName.localeCompare(pb.lastName, undefined, { sensitivity: 'base' }) ||
    pa.firstName.localeCompare(pb.firstName, undefined, { sensitivity: 'base' }) ||
    pa.fullName.localeCompare(pb.fullName, undefined, { sensitivity: 'base' })
  );
}

export function normalizeRosterSort(rawField = 'jersey', rawDir = 'asc') {
  let field = String(rawField || 'jersey').trim();
  let dir = rawDir === 'desc' ? 'desc' : 'asc';
  if (/_(asc|desc)$/i.test(field)) {
    const match = field.match(/^(.*)_(asc|desc)$/i);
    if (match) {
      field = match[1];
      dir = match[2].toLowerCase() === 'desc' ? 'desc' : 'asc';
    }
  }
  if (field === 'name' || field === 'first_name' || field === 'firstname') {
    field = 'firstName';
  } else if (field === 'last_name' || field === 'lastname' || field === 'surname') {
    field = 'lastName';
  } else if (field === 'number' || field === 'roster_number' || field === 'jersey_number') {
    field = 'jersey';
  }
  if (!ROSTER_SORT_FIELDS.some(x => x.key === field)) {
    field = 'jersey';
    dir = 'asc';
  }
  return { field, dir };
}

export function renderRosterCapViewHtml({
  subTab = 'roster', // 'roster' | 'depth' | 'moves' | 'cap'
  rosterSearch = '',
  rosterUnitFilter = 'All',
  rosterPosFilter = 'ALL',
  rosterSort = 'jersey',
  rosterSortDir = 'asc',
  depthMode = 'projected', // 'baseline' | 'projected'
  rosterMovesFilter = 'all', // 'all' | 'ir' | 'signing' | 'ps'
  capSelectedYear = '2026',
  capViewMode = 'sim', // 'sim' | 'fa'
  capFaFilter = 'ALL', // 'ALL' | 'UFA' | 'RFA' | 'ERFA'
  appData,
  simCapResult,
  userCapMoves = {}
}) {
  registerRosterPlayersForInlineLinks(appData?.roster?.players);
  const topSwitcher = `
    <div class="card subnav-card roster-subnav-card">
      <div class="segmented-control compact-seg roster-top-seg" role="tablist" aria-label="Roster and Salary Cap Modes">
        <button type="button" role="tab" aria-selected="${subTab === 'roster' ? 'true' : 'false'}" class="pill-btn seg-btn ${subTab === 'roster' ? 'active' : ''}" data-action="set-roster-sub" data-roster-sub="roster">
          ${iconSvg('football', 13)}
          <span>Roster</span>
        </button>
        <button type="button" role="tab" aria-selected="${subTab === 'depth' ? 'true' : 'false'}" class="pill-btn seg-btn ${subTab === 'depth' ? 'active' : ''}" data-action="set-roster-sub" data-roster-sub="depth">
          ${iconSvg('layers', 13)}
          <span>Depth</span>
        </button>
        <button type="button" role="tab" aria-selected="${subTab === 'moves' ? 'true' : 'false'}" class="pill-btn seg-btn ${subTab === 'moves' ? 'active' : ''}" data-action="set-roster-sub" data-roster-sub="moves">
          ${iconSvg('trade', 13)}
          <span>Moves</span>
        </button>
        <button type="button" role="tab" aria-selected="${subTab === 'cap' ? 'true' : 'false'}" class="pill-btn seg-btn ${subTab === 'cap' ? 'active' : ''}" data-action="set-roster-sub" data-roster-sub="cap">
          ${iconSvg('cap', 13)}
          <span>Cap</span>
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
  if (subTab === 'moves') {
    return topSwitcher + renderRosterMovesLedger({ appData, rosterMovesFilter });
  }
  return (
    topSwitcher +
    renderSalaryCapAndSimulator({
      appData,
      simCapResult,
      userCapMoves,
      capSelectedYear,
      capViewMode,
      capFaFilter
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
    if (sortField === 'firstName') {
      return mult * comparePlayersByFirstName(a, b);
    }
    if (sortField === 'lastName') {
      return mult * comparePlayersByLastName(a, b);
    }
    if (sortField === 'jersey') {
      const aHas = a.jersey !== null && a.jersey !== undefined && a.jersey !== '';
      const bHas = b.jersey !== null && b.jersey !== undefined && b.jersey !== '';
      if (aHas !== bHas) return aHas ? -1 : 1; // unassigned jerseys always sort last
      if (!aHas && !bHas) return comparePlayersByFirstName(a, b);
      return mult * (Number(a.jersey) - Number(b.jersey)) || comparePlayersByFirstName(a, b);
    }
    if (sortField === 'cap') {
      return mult * ((a.capHit2026 || 0) - (b.capHit2026 || 0)) || comparePlayersByFirstName(a, b);
    }
    if (sortField === 'snaps') {
      return mult * ((a.primarySnapPct || 0) - (b.primarySnapPct || 0)) || comparePlayersByFirstName(a, b);
    }
    if (sortField === 'health') {
      return (
        mult * ((a.health?.playProbabilityPct ?? 99) - (b.health?.playProbabilityPct ?? 99)) ||
        comparePlayersByFirstName(a, b)
      );
    }
    if (sortField === 'ras') {
      return (
        mult * ((a.spiderProfile?.compositeRas || 0) - (b.spiderProfile?.compositeRas || 0)) ||
        comparePlayersByFirstName(a, b)
      );
    }
    if (sortField === 'age') {
      const aHas = a.age !== null && a.age !== undefined;
      const bHas = b.age !== null && b.age !== undefined;
      if (aHas !== bHas) return aHas ? -1 : 1;
      if (!aHas && !bHas) return comparePlayersByFirstName(a, b);
      return mult * (Number(a.age) - Number(b.age)) || comparePlayersByFirstName(a, b);
    }
    return mult * comparePlayersByFirstName(a, b);
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
        <span><strong>${filtered.length}</strong> players</span>
        <div class="source-link-strip">
          <a href="https://www.espn.com/nfl/team/roster/_/name/${esc(getActiveTeamConfig().espnAbbr)}/${esc(getActiveTeamConfig().otcSlug)}" target="_blank" rel="noopener noreferrer" class="source-chip-link"><span>ESPN Roster</span>${iconSvg('externalLink', 10)}</a>
          <a href="${esc(getActiveTeamConfig().clubRosterUrl)}" target="_blank" rel="noopener noreferrer" class="source-chip-link"><span>${esc(getActiveTeamConfig().clubDomain)}</span>${iconSvg('externalLink', 10)}</a>
        </div>
      </div>

      <div class="player-list">
        ${
          filtered.length === 0
            ? `<div style="padding:14px;text-align:center;color:var(--text-muted)">No players match "${esc(rosterSearch)}".</div>`
            : filtered
                .map(p => {
                  const badgeLabel = resolvePlayerPlayBadgeLabel(p);
                  const badgeCls = playProbBadgeClass(p.health?.playProbabilityPct, {
                    rosterBucket: p.rosterBucket,
                    playTier: p.health?.playTier,
                    playBadgeLabel: badgeLabel
                  });
                  const rasVal = Number(p.spiderProfile?.compositeRas || 0);
                  const psElevMatch =
                    p.rosterBucket === 'practice_squad'
                      ? (appData?.roster?.psElevations || []).find(
                          e =>
                            (e.playerId && String(e.playerId) === String(p.id)) ||
                            String(e.player || '').toLowerCase() === String(p.name || '').toLowerCase()
                        )
                      : null;
                  const psElevPillHtml =
                    psElevMatch && psElevMatch.used > 0
                      ? ` · <span class="badge ${psElevMatch.used >= 3 ? 'badge-danger' : 'badge-gold'} mono ps-elev-inline-pill">${psElevMatch.used}/3 elev</span>`
                      : '';
                  const capDisplay =
                    p.capHit2026 > 0
                      ? formatCompactDollars(p.capHit2026)
                      : p.rosterBucket === 'practice_squad'
                        ? 'PS'
                        : p.rosterBucket === 'ir'
                          ? 'IR'
                          : 'Cap TBD';
                  return `
              <button type="button" class="player-row" data-action="open-player-sheet" data-player-id="${esc(p.id)}">
                <div class="player-row-left">
                  <div class="jersey-chip mono">${p.jersey !== null && p.jersey !== undefined ? `#${p.jersey}` : '—'}</div>
                  ${renderPlayerAvatarHtml(p, 30)}
                  <div class="player-meta-main">
                    <div class="player-name-line">${esc(p.name)} <span style="color:var(--gold-bright);font-size:11.5px">${esc(p.position)}</span></div>
                    <div class="player-sub-line">
                      ${esc(
                        p.rosterBucket === 'active'
                          ? '53-Man'
                          : p.rosterBucket === 'ir'
                            ? p.health?.isSeasonEnding
                              ? 'Season-Ending IR'
                              : p.health?.isPracticeWindowOpen
                                ? 'IR (21d Window)'
                                : p.health?.status === 'Reserve / PUP'
                                  ? 'Reserve/PUP'
                                  : p.health?.status === 'Reserve / Left Squad'
                                    ? 'Reserve/Left Sq.'
                                    : 'IR/Reserve'
                            : 'Prac. Squad'
                      )}${psElevPillHtml} ·
                      Snaps <span class="mono">${p.primarySnapPct || 0}%</span>${
                        rasVal > 0 ? ` · RAS <span class="mono">${rasVal.toFixed(1)}</span>` : ''
                      }${p.age ? ` · <span class="mono">${p.age}y</span>` : ''}
                    </div>
                  </div>
                </div>
                <div class="player-row-right">
                  <span class="mono" style="font-weight:800;font-size:12.5px">
                    ${capDisplay}
                  </span>
                  <span class="badge ${badgeCls} mono" style="font-size:10px">
                    ${esc(badgeLabel)}
                  </span>
                </div>
              </button>
            `;
                })
                .join('')
        }
      </div>
    </div>
  `;
}

function renderDepthUnitTitleHtml(rawUnitName = '') {
  const norm = String(rawUnitName || '')
    .trim()
    .replace(/\b(\d+)\s*Pers\b/gi, '$1 Personnel');
  if (/^Offense\s*\(11\s*&\s*21\s*Personnel\)$/i.test(norm)) {
    return `Offense (${jargonTerm('11', 'personnel_11')} &amp; ${jargonTerm('21 Personnel', 'personnel_21')})`;
  }
  if (/^Defense\s*\(Wide[- ]?9\s+Base\s+4-3\s*&\s*Nickel\s+4-2-5\)$/i.test(norm)) {
    return `Defense (${jargonTerm('Wide-9', 'wide_9')} ${jargonTerm('Base 4-3', 'base_4_3')} &amp; ${jargonTerm('Nickel 4-2-5', 'nickel_4_2_5')})`;
  }
  return escJargon(norm, { maxTerms: 6, maxPlayers: 0, seenKeys: new Set() });
}

function renderDepthSlotLabelHtml(rawSlotLabel = '') {
  const norm = String(rawSlotLabel || '')
    .trim()
    .replace(/\b(\d+)\s*Pers\b/gi, '$1 Personnel');
  const upper = norm.toUpperCase();

  if (upper === 'WR (X)') return `WR (${jargonTerm('X', 'x_receiver')})`;
  if (upper === 'WR (Z)') return `WR (${jargonTerm('Z', 'z_receiver')})`;
  if (upper === 'SLWR (11 PERSONNEL)') {
    return `${jargonTerm('SLWR', 'slot_wr')} (${jargonTerm('11 Personnel', 'personnel_11')})`;
  }
  if (upper === 'TE (Y)') return `TE (${jargonTerm('Y', 'y_tight_end')})`;
  if (upper === 'FB (21 PERSONNEL)') {
    return `${jargonTerm('FB', 'fullback')} (${jargonTerm('21 Personnel', 'personnel_21')})`;
  }
  if (upper === 'LDE (WIDE-9)' || upper === 'LDE (WIDE 9)') {
    return `LDE (${jargonTerm('Wide-9', 'wide_9')})`;
  }
  if (upper === 'RDE (WIDE-9)' || upper === 'RDE (WIDE 9)') {
    return `RDE (${jargonTerm('Wide-9', 'wide_9')})`;
  }
  if (upper === 'LDT (1/2I)') return `LDT (${jargonTerm('1/2i', 'one_two_i')})`;
  if (upper === 'RDT (3-TECH)') return `RDT (${jargonTerm('3-Tech', 'three_tech')})`;
  if (upper === 'WILL LB') return jargonTerm('WILL LB', 'will_lb');
  if (upper === 'MIKE LB') return jargonTerm('MIKE LB', 'mike_lb');
  if (upper === 'SAM LB (4-3)') {
    return `${jargonTerm('SAM LB', 'sam_lb')} (${jargonTerm('4-3', 'base_4_3')})`;
  }
  if (upper === 'NICKEL CB (4-2-5)') {
    return `${jargonTerm('NICKEL CB', 'nickel_cb')} (${jargonTerm('4-2-5', 'nickel_4_2_5')})`;
  }
  if (upper === 'SS') return jargonTerm('SS', 'strong_safety');
  if (upper === 'FS') return jargonTerm('FS', 'free_safety');
  if (upper === 'LS') return jargonTerm('LS', 'long_snapper');
  if (upper === 'PR') return jargonTerm('PR', 'punt_returner');
  if (upper === 'KR') return jargonTerm('KR', 'kick_returner');

  return escJargon(norm, { maxTerms: 6, maxPlayers: 0, seenKeys: new Set() });
}

function renderDualDepthChart({ appData, depthMode }) {
  const units = appData?.depthChart?.units || [];
  const depthWk = appData?.depthChart?.week || appData?.meta?.currentWeek || '';

  const headerCard = `
    <div class="card">
      <div class="segmented-control compact-seg" role="tablist" aria-label="Depth Chart Mode" style="margin-bottom:8px">
        <button type="button" role="tab" aria-selected="${depthMode === 'projected' ? 'true' : 'false'}" class="pill-btn seg-btn ${depthMode === 'projected' ? 'active' : ''}" data-action="set-depth-mode" data-depth-mode="projected">
          ${iconSvg('bolt', 13)}
          <span>${depthWk ? `Wk ${depthWk} ` : ''}Active (Injury-Adj.)</span>
        </button>
        <button type="button" role="tab" aria-selected="${depthMode === 'baseline' ? 'true' : 'false'}" class="pill-btn seg-btn ${depthMode === 'baseline' ? 'active' : ''}" data-action="set-depth-mode" data-depth-mode="baseline">
          ${iconSvg('layers', 13)}
          <span>Full Hierarchy</span>
        </button>
      </div>
      <div class="source-link-strip" style="justify-content:flex-end">
        <a href="https://www.espn.com/nfl/team/depth/_/name/${esc(getActiveTeamConfig().espnAbbr)}/${esc(getActiveTeamConfig().otcSlug)}" target="_blank" rel="noopener noreferrer" class="source-chip-link"><span>ESPN Depth</span>${iconSvg('externalLink', 10)}</a>
        <a href="https://www.ourlads.com/nfldepthcharts/depthchart/${esc(getOurladsTeamCode())}" target="_blank" rel="noopener noreferrer" class="source-chip-link"><span>Ourlads</span>${iconSvg('externalLink', 10)}</a>
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
                <span class="depth-pos-tag mono">${renderDepthSlotLabelHtml(row.slotLabel)}</span>
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
                      c.playProbabilityPct >= 85
                        ? 'var(--emerald)'
                        : c.playProbabilityPct >= 50
                          ? 'var(--yellow-gtd)'
                          : c.playProbabilityPct >= 20
                            ? 'var(--orange)'
                            : 'var(--crimson)'
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
          <h3 class="card-title" style="margin-bottom:8px">${renderDepthUnitTitleHtml(u.unitName)}</h3>
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

function formatShortTxDate(dateIso = '') {
  const m = String(dateIso || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return String(dateIso || '—');
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${months[Math.max(0, Number(m[2]) - 1)] || m[2]} ${Number(m[3])}`;
}

function formatMonthHeading(dateIso = '') {
  const m = String(dateIso || '').match(/^(\d{4})-(\d{2})/);
  if (!m) return 'Season Moves';
  const months = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'
  ];
  return `${months[Math.max(0, Number(m[2]) - 1)] || m[2]} ${m[1]}`;
}

function txToneToBadgeCls(tone = 'neutral') {
  if (tone === 'emerald') return 'badge-positive';
  if (tone === 'crimson') return 'badge-danger';
  if (tone === 'gold') return 'badge-gold';
  if (tone === 'amber') return 'badge-warning';
  if (tone === 'blue') return 'badge-info';
  return 'badge-neutral';
}

function renderRosterMovesLedger({ appData, rosterMovesFilter = 'all' }) {
  const activeTeam = getActiveTeamConfig();
  const seasonYr = Number(appData?.meta?.seasonYear) || 2026;
  const allMoves = Array.isArray(appData?.roster?.transactions) ? appData.roster.transactions : [];
  const psElevations = Array.isArray(appData?.roster?.psElevations) ? appData.roster.psElevations : [];
  const normFilter = ['all', 'ir', 'signing', 'ps'].includes(rosterMovesFilter) ? rosterMovesFilter : 'all';
  const filtered = normFilter === 'all' ? allMoves : allMoves.filter(m => m.cat === normFilter);

  const grouped = [];
  for (const m of filtered) {
    const heading = formatMonthHeading(m.date);
    let bucket = grouped.find(g => g.heading === heading);
    if (!bucket) {
      bucket = { heading, items: [] };
      grouped.push(bucket);
    }
    bucket.items.push(m);
  }

  const topPsPreview = psElevations
    .slice(0, 2)
    .map(e => `${String(e.player || '').split(/\s+/).pop()} ${e.used}/3`)
    .join(' · ');

  const psCardHtml =
    psElevations.length > 0
      ? `
      <details class="card compact-details ps-elev-details" data-ps-elevations-card>
        <summary class="compact-details-summary ps-elev-summary">
          <span>PS Elevations (Max 3)</span>
          <span class="mono ps-elev-summary-preview">${esc(topPsPreview || `${psElevations.length} tracked`)}</span>
        </summary>
        <div class="ps-elev-list">
          ${psElevations
            .map(e => {
              const matched = e.playerId
                ? { id: e.playerId }
                : lookupRosterPlayerByName(e.player);
              const nameHtml = matched?.id
                ? `<span class="inline-player-link" role="button" tabindex="0" data-action="open-player-sheet" data-player-id="${esc(matched.id)}">${esc(e.player)}</span>`
                : `<strong>${esc(e.player)}</strong>`;
              const dots = [1, 2, 3]
                .map(
                  i =>
                    `<span class="ps-elev-dot ${i <= e.used ? (e.used >= 3 ? 'is-max' : 'is-used') : ''}" aria-hidden="true"></span>`
                )
                .join('');
              const statusNote =
                e.rosterBucket === 'active'
                  ? 'Signed 53'
                  : e.used >= 3
                    ? 'Max reached'
                    : `${e.remaining} left`;
              return `
                <div class="subcard-panel ps-elev-row">
                  <div class="ps-elev-left">
                    ${nameHtml}
                    ${e.pos ? `<span class="ps-elev-pos">${esc(e.pos)}</span>` : ''}
                    <span class="ps-elev-note">· ${esc(statusNote)}</span>
                  </div>
                  <div class="ps-elev-right">
                    <span class="ps-elev-dots">${dots}</span>
                    <span class="mono ps-elev-count ${e.used >= 3 ? 'is-max' : ''}">${e.used}/3</span>
                  </div>
                </div>
              `;
            })
            .join('')}
        </div>
      </details>
    `
      : '';

  return `
    ${psCardHtml}
    <section class="card" id="rosterMovesLedgerCard" data-roster-moves-filter="${esc(normFilter)}">
      <div class="card-header" style="margin-bottom:8px">
        <div class="card-header-left">
          <div class="card-icon-badge compact" aria-hidden="true">${iconSvg('trade', 15)}</div>
          <div class="card-title-group">
            <h2 class="card-title">${esc(String(seasonYr))} ${esc(activeTeam.nickname)} Roster Moves</h2>
          </div>
        </div>
        <div class="source-link-strip">
          <a href="https://www.espn.com/nfl/team/transactions/_/name/${esc(activeTeam.espnAbbr)}/${esc(activeTeam.otcSlug)}" target="_blank" rel="noopener noreferrer" class="source-chip-link"><span>ESPN Moves</span>${iconSvg('externalLink', 10)}</a>
        </div>
      </div>

      <div class="pill-bar compact-chip-row" role="tablist" aria-label="Roster Moves Category" style="margin-bottom:10px">
        ${[
          ['all', `All (${allMoves.length})`],
          ['ir', 'IR / Reserve'],
          ['signing', '53-Man'],
          ['ps', 'Practice Squad']
        ]
          .map(
            ([k, lbl]) => `
          <button type="button" role="tab" aria-selected="${normFilter === k}"
                  class="pill-btn ${normFilter === k ? 'active' : ''}"
                  data-action="set-roster-moves-filter" data-moves-filter="${k}">${esc(lbl)}</button>
        `
          )
          .join('')}
      </div>

      ${
        filtered.length === 0
          ? `<div class="subcard-panel" style="font-size:12.5px;color:var(--text-muted)">No official ${esc(String(seasonYr))} moves in this category yet.</div>`
          : `
        <div class="moves-month-stack">
          ${grouped
            .map(
              grp => `
            <div class="moves-month-group">
              <div class="sub-label moves-month-heading">${esc(grp.heading)}</div>
              <div class="moves-ledger-box">
                ${grp.items
                  .map(tx => {
                    const matched = tx.playerId
                      ? { id: tx.playerId }
                      : lookupRosterPlayerByName(tx.player);
                    const playerHtml = matched?.id
                      ? `<span class="inline-player-link moves-player-name" role="button" tabindex="0" data-action="open-player-sheet" data-player-id="${esc(matched.id)}">${esc(tx.player)}</span>`
                      : `<span class="moves-player-name">${esc(tx.player)}</span>`;
                    return `
                      <div class="moves-ledger-row">
                        <span class="mono moves-date">${esc(formatShortTxDate(tx.date))}</span>
                        <span class="badge ${txToneToBadgeCls(tx.tone)} moves-tag">${esc(tx.tag)}</span>
                        ${playerHtml}
                        <span class="mono moves-pos">${esc(tx.pos || '')}</span>
                      </div>
                    `;
                  })
                  .join('')}
              </div>
            </div>
          `
            )
            .join('')}
        </div>
      `
      }
    </section>
  `;
}

function renderUpcomingFreeAgentsView({ appData, capSelectedYear, capFaFilter = 'ALL' }) {
  const activeTeam = getActiveTeamConfig();
  const baseYrNum = Number(appData?.meta?.seasonYear) || Number(capSelectedYear) || 2026;
  const baseYrStr = String(baseYrNum);
  const nextYrStr = String(baseYrNum + 1);
  const shortBaseYr = `'${baseYrStr.slice(-2)}`;
  const years = appData?.cap?.years || {};
  const yrNow = years[baseYrStr] || {};
  const yrNext = years[nextYrStr] || {};

  const faModel = buildUpcomingFreeAgentsModel(appData?.cap || {}, appData?.roster?.players || [], {
    baseYear: baseYrNum,
    statusFilter: capFaFilter
  });
  const capMix = buildPositionalCapSpendModel(appData?.cap || {}, { yearKey: baseYrStr });
  const topUnitsPreview = capMix.units
    .slice(0, 2)
    .map(u => `${u.label.split(' ')[0]} ${u.teamPct}%`)
    .join(' · ');

  return `
    <div class="kpi-grid cap-fa-kpi-grid">
      <div class="kpi-box">
        <div class="kpi-label">${esc(baseYrStr)} Space</div>
        <div class="kpi-val mono" style="color:${Number(yrNow.teamCapSpace || 0) >= 0 ? 'var(--emerald)' : 'var(--crimson)'}">${formatCompactDollars(yrNow.teamCapSpace || 0)}</div>
      </div>
      <div class="kpi-box">
        <div class="kpi-label">${esc(nextYrStr)} Proj.</div>
        <div class="kpi-val mono" style="color:${Number(yrNext.teamCapSpace || 0) >= 0 ? 'var(--gold-bright)' : 'var(--crimson)'}">${formatCompactDollars(yrNext.teamCapSpace || 0)}</div>
      </div>
      <div class="kpi-box">
        <div class="kpi-label">${esc(nextYrStr)} Expiring</div>
        <div class="kpi-val mono">${faModel.counts.ALL}</div>
      </div>
    </div>

    <details class="card compact-details cap-mix-details" data-cap-positional-spend>
      <summary class="compact-details-summary">
        <span>${esc(baseYrStr)} Cap Spend by Unit vs. NFL Avg</span>
        <span class="mono cap-mix-preview">${esc(topUnitsPreview)}</span>
      </summary>
      <div class="cap-mix-list">
        ${capMix.units
          .map(u => {
            const barW = Math.min(100, u.teamPct * 4.2);
            const avgPos = Math.min(97, u.nflAvgPct * 4.2);
            return `
              <div class="cap-mix-row">
                <span class="cap-mix-label">${esc(u.label)}</span>
                <div class="cap-mix-track" title="${esc(activeTeam.abbr)} ${u.teamPct}% vs NFL Avg ${u.nflAvgPct}%">
                  <div class="cap-mix-fill" style="width:${barW.toFixed(1)}%"></div>
                  <div class="cap-mix-avg-tick" style="left:${avgPos.toFixed(1)}%"></div>
                </div>
                <span class="mono cap-mix-pct">${u.teamPct.toFixed(1)}%</span>
              </div>
            `;
          })
          .join('')}
        <div class="cap-mix-footnote">Vertical tick = NFL 32-team average % of cap ceiling</div>
      </div>
    </details>

    <section class="card" id="upcomingFreeAgentsCard" data-fa-year="${faModel.targetFaYear}" data-fa-filter="${esc(faModel.statusFilter)}">
      <div class="card-header" style="margin-bottom:8px">
        <div class="card-header-left">
          <div class="card-icon-badge compact" aria-hidden="true">${iconSvg('calendar', 15)}</div>
          <div class="card-title-group">
            <h2 class="card-title">${faModel.targetFaYear} Expiring Contracts (${faModel.counts.ALL})</h2>
          </div>
        </div>
      </div>

      <div class="pill-bar compact-chip-row" role="tablist" aria-label="Free Agent Designation Filter" style="margin-bottom:8px">
        ${[
          ['ALL', `All (${faModel.counts.ALL})`],
          ['UFA', `UFA (${faModel.counts.UFA})`],
          ['RFA', `RFA (${faModel.counts.RFA})`],
          ['ERFA', `ERFA (${faModel.counts.ERFA})`]
        ]
          .map(
            ([k, lbl]) => `
          <button type="button" role="tab" aria-selected="${faModel.statusFilter === k}"
                  class="pill-btn ${faModel.statusFilter === k ? 'active' : ''}"
                  data-action="set-cap-fa-filter" data-fa-filter="${k}">${esc(lbl)}</button>
        `
          )
          .join('')}
      </div>

      ${
        faModel.players.length === 0
          ? `<div class="subcard-panel" style="font-size:12.5px;color:var(--text-muted)">No expiring ${esc(faModel.statusFilter)} contracts found for ${faModel.targetFaYear}.</div>`
          : `
        <div class="table-scroll">
          <table class="data-table sticky-col-table cap-fa-table mono">
            <thead>
              <tr>
                <th class="sticky-col" style="font-family:var(--font-sans)">Player</th>
                <th style="text-align:center">Type</th>
                <th class="num-col">Snap%</th>
                <th class="num-col">Age</th>
                <th class="num-col">${esc(shortBaseYr)} Cap</th>
              </tr>
            </thead>
            <tbody>
              ${faModel.players
                .map(p => {
                  const typeCls =
                    p.faStatus === 'UFA'
                      ? 'badge-danger'
                      : p.faStatus === 'RFA'
                        ? 'badge-info'
                        : 'badge-gold';
                  const snapStr = p.rosterBucket === 'ir' && p.snapPct === 0 ? 'IR' : `${p.snapPct}%`;
                  const snapCls = p.snapPct >= 65 ? 'val-pos' : '';
                  const nameEl = p.id
                    ? `<span class="inline-player-link" role="button" tabindex="0" data-action="open-player-sheet" data-player-id="${esc(p.id)}" data-initial-tab="contract">${esc(p.name)}</span>`
                    : `<strong>${esc(p.name)}</strong>`;
                  return `
                    <tr>
                      <td class="sticky-col" style="font-family:var(--font-sans)">
                        ${nameEl}
                        <span class="team-players-pos">${esc(p.position)}</span>
                        ${p.hasVoidYears ? `<span class="fa-void-tag mono" title="Carries void-year dead cap acceleration">Void</span>` : ''}
                      </td>
                      <td style="text-align:center"><span class="badge ${typeCls} mono">${esc(p.faStatus)}</span></td>
                      <td class="num-col ${snapCls}">${esc(snapStr)}</td>
                      <td class="num-col">${p.age != null ? p.age : '—'}</td>
                      <td class="num-col">${formatCompactDollars(p.capHit)}</td>
                    </tr>
                  `;
                })
                .join('')}
            </tbody>
          </table>
        </div>
      `
      }
    </section>
  `;
}

function renderSalaryCapAndSimulator({
  appData,
  simCapResult,
  userCapMoves = {},
  capSelectedYear,
  capViewMode = 'sim',
  capFaFilter = 'ALL'
}) {
  const effectiveCapMode = capViewMode === 'fa' ? 'fa' : 'sim';
  const baseSeasonYr = Number(appData?.meta?.seasonYear) || 2026;
  const faYearLabel = baseSeasonYr + 1;
  const capModeToggleHtml = `
    <div class="card subnav-card cap-inner-subnav-card" data-cap-mode-switcher>
      <div class="segmented-control compact-seg" role="tablist" aria-label="Salary Cap View Mode">
        <button type="button" role="tab" aria-selected="${effectiveCapMode === 'sim' ? 'true' : 'false'}"
                class="pill-btn seg-btn ${effectiveCapMode === 'sim' ? 'active' : ''}"
                data-action="set-cap-view-mode" data-cap-mode="sim">
          <span>GM Simulator</span>
        </button>
        <button type="button" role="tab" aria-selected="${effectiveCapMode === 'fa' ? 'true' : 'false'}"
                class="pill-btn seg-btn ${effectiveCapMode === 'fa' ? 'active' : ''}"
                data-action="set-cap-view-mode" data-cap-mode="fa">
          <span>${faYearLabel} Free Agents</span>
        </button>
      </div>
    </div>
  `;

  if (effectiveCapMode === 'fa') {
    return (
      capModeToggleHtml +
      renderUpcomingFreeAgentsView({ appData, capSelectedYear, capFaFilter })
    );
  }

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

  const activeTeamCap = getActiveTeamConfig();
  const otcTeamUrl = appData?.cap?.sourceUrl || `https://overthecap.com/salary-cap/${activeTeamCap.otcSlug}`;
  const spotracUrl = appData?.cap?.spotracUrl || `https://www.spotrac.com/nfl/${activeTeamCap.otcSlug}/cap/`;
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
          <strong style="color:var(--gold-bright)">${esc(selectedYrKey)} Reserve &amp; Dead Cap</strong>
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
                  .map(d => {
                    const sfMatch = lookupRosterPlayerByName(d.name);
                    const safeOtc = sanitizeExternalUrl(d.otcUrl, null);
                    const nameHtml = sfMatch
                      ? `<span class="inline-player-link" role="button" tabindex="0" data-action="open-player-sheet" data-player-id="${esc(sfMatch.id)}" data-initial-tab="contract">${esc(d.name)}</span>`
                      : safeOtc
                        ? `<a href="${esc(safeOtc)}" target="_blank" rel="noopener noreferrer" class="ext-link">${esc(d.name)}</a>`
                        : esc(d.name);
                    return `${nameHtml} (<span class="mono">${formatCompactDollars(d.capCharge)}</span>)`;
                  })
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

  return (
    capModeToggleHtml +
    `
    <!-- OverTheCap 5-Year Cap Summary (This Year + Next 4 Years) -->
    <section class="card" id="capHorizonSummaryCard">
      <div class="card-header">
        <div class="card-header-left">
          <div class="card-icon-badge" aria-hidden="true">${iconSvg('cap', 18)}</div>
          <div class="card-title-group">
            <div class="card-eyebrow">${esc(firstYrKey)}–${esc(horizonEndKey)} Cap Horizon</div>
            <h2 class="card-title">${esc(selectedYrKey)} Salary Cap</h2>
          </div>
        </div>
        <button type="button" class="btn-ghost" data-action="analyze-topic-jump"
                data-prompt="${esc(activeTeamCap.abbr === 'SF' ? `Analyze the 49ers ${firstYrKey}-${horizonEndKey} salary cap rollover strategy, option bonus proration on Purdy and Bosa, and multi-year cap flexibility` : `Analyze the ${activeTeamCap.fullName} ${firstYrKey}-${horizonEndKey} salary cap rollover strategy, top veteran restructures, dead money cliffs, and multi-year cap flexibility`)}">
          ${iconSvg('sparkles', 13)}
          <span>AI Cap Audit</span>
        </button>
      </div>

      <div class="source-link-strip" style="margin-bottom:10px">
        <a href="${esc(otcTeamUrl)}" target="_blank" rel="noopener noreferrer" class="source-chip-link"><span>OverTheCap</span>${iconSvg('externalLink', 11)}</a>
        <a href="${esc(spotracUrl)}" target="_blank" rel="noopener noreferrer" class="source-chip-link"><span>Spotrac</span>${iconSvg('externalLink', 11)}</a>
        <a href="${esc(nflpaUrl)}" target="_blank" rel="noopener noreferrer" class="source-chip-link"><span>NFLPA</span>${iconSvg('externalLink', 11)}</a>
      </div>

      ${renderOtcYearTabs(sortedYrKeys, selectedYrKey, years, 'Select Salary Cap Summary Year')}

      <!-- Selected Year OverTheCap Top-of-Page Summary Metrics -->
      <div class="kpi-grid cap-summary-kpi-grid" style="margin-bottom:8px">
        <div class="kpi-box">
          <div class="kpi-label">${jargonTerm('Gross Space', 'gross_cap_space')}</div>
          <div class="kpi-val mono" style="color:${yrGrossSpace >= 0 ? 'var(--emerald)' : 'var(--crimson)'}">
            ${formatOtcDollars(yrGrossSpace)}
          </div>
          <div class="mono" style="font-size:10px;color:var(--text-muted)">
            ${yrRow.capCeilingProjected ? 'Proj. CBA Ceiling' : 'OTC Team Space'}
          </div>
        </div>
        <div class="kpi-box">
          <div class="kpi-label">${jargonTerm('Effective Cap Space', 'effective_cap_space')}</div>
          <div class="kpi-val mono" style="color:${yrEffectiveSpace >= 0 ? 'var(--emerald)' : 'var(--crimson)'}">
            ${formatOtcDollars(yrEffectiveSpace)}
          </div>
          <div class="mono" style="font-size:10px;color:var(--text-muted)">Post Top-51 &amp; Rookies</div>
        </div>
        <div class="kpi-box">
          <div class="kpi-label">Total Liabilities</div>
          <div class="kpi-val mono">${formatOtcDollars(yrLiabilities)}</div>
          <div class="mono" style="font-size:10px;color:var(--text-muted)">
            Ceiling: ${formatCompactDollars(yrCeiling)}${yrRow.capCeilingProjected ? ' (Est.)' : ''}
          </div>
        </div>
        <div class="kpi-box">
          <div class="kpi-label">${jargonTerm('Top-51', 'top_51')} Charge</div>
          <div class="kpi-val mono">${formatOtcDollars(yrTop51)}</div>
          <div class="mono" style="font-size:10px;color:var(--text-muted)">
            ${yrActiveRosterCount} Active / ${yrRow.totalSignedCount || yrActiveRosterCount} Signed
          </div>
        </div>
        <div class="kpi-box">
          <div class="kpi-label">${jargonTerm('Dead Cap', 'dead_cap')}</div>
          <div class="kpi-val mono" style="color:${yrDeadMoney > 0 ? 'var(--amber)' : 'var(--text-primary)'}">
            ${formatOtcDollars(yrDeadMoney)}
          </div>
          <div class="mono" style="font-size:10px;color:var(--text-muted)">
            ${yrDeadMoney > 0 ? `${((yrDeadMoney / yrCeiling) * 100).toFixed(1)}% of Team Cap` : 'Clean Ledger ($0)'}
          </div>
        </div>
        <div class="kpi-box">
          <div class="kpi-label">Active Spend</div>
          <div class="kpi-val mono">${formatCompactDollars(yrRow.activeCapSpending || 0)}</div>
          <div class="mono" style="font-size:10px;color:var(--text-muted)">
            Off ${formatCompactDollars(yrRow.offenseSpend || 0)} · Def ${formatCompactDollars(yrRow.defenseSpend || 0)}
          </div>
        </div>
      </div>

      ${nonActiveLedgerHtml}

      <div class="sub-label" style="margin:12px 0 6px">5-Year Cap Outlook</div>
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

      <details class="compact-details" style="margin-top:10px">
        <summary class="compact-details-summary">
          <span>Multi-Year Cap Strategy</span>
        </summary>
        <div style="margin-top:8px;font-size:12.5px;color:var(--text-secondary)">
          <strong style="color:var(--gold-bright)">Executive Summary:</strong> ${escJargon(blueprint.executiveSummary || '')}
        </div>
        <div style="display:flex;flex-direction:column;gap:7px;margin-top:8px">
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
      </details>
    </section>

    <!-- Multi-Year Interactive OverTheCap Salary Cap Simulator -->
    <section class="card" id="capSimulatorCard">
      <div class="card-header">
        <div class="card-header-left">
          <div class="card-icon-badge temporal" aria-hidden="true">${iconSvg('bolt', 18)}</div>
          <div class="card-title-group">
            <div class="card-eyebrow">${jargonTerm('Post-June 1', 'post_june_1')} &amp; Top-51 Rules</div>
            <h2 class="card-title">${esc(selectedYrKey)} Cap Simulator</h2>
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
            <div class="kpi-label">${esc(selectedYrKey)} Space</div>
            <div class="kpi-val mono" style="color:${yrGrossSpace >= 0 ? 'var(--emerald)' : 'var(--crimson)'}">
              ${formatCompactDollars(yrGrossSpace)}
            </div>
            <div class="mono" style="font-size:10px;color:var(--text-secondary)">
              Delta: ${formatCompactDollars(sum.baseYearNetCapDelta || 0, true)}
            </div>
          </div>
          <div class="kpi-box">
            <div class="kpi-label">${hasNextYrInLedger ? `${esc(nextYrKey)} Space` : `${esc(selectedYrKey)} Eff. Space`}</div>
            <div class="kpi-val mono" style="color:${(hasNextYrInLedger ? (sum.updatedNextYearCapSpace ?? years[nextYrKey]?.teamCapSpace ?? 0) : yrEffectiveSpace) >= 0 ? 'var(--emerald)' : 'var(--crimson)'}">
              ${
                hasNextYrInLedger
                  ? formatCompactDollars(sum.updatedNextYearCapSpace ?? years[nextYrKey]?.teamCapSpace ?? 0)
                  : formatCompactDollars(yrEffectiveSpace)
              }
            </div>
            <div class="mono" style="font-size:10px;color:var(--text-secondary)">
              ${
                hasNextYrInLedger
                  ? `${esc(nextYrKey)} Δ: ${formatCompactDollars(sum.nextYearCapDelta || 0, true)} · Roll: ${formatCompactDollars(
                      sum.updatedNextYearWithRollover ??
                        (Number(years[nextYrKey]?.teamCapSpace || 0) + Math.max(0, yrGrossSpace)),
                      true
                    )}`
                  : 'Post Replacement'
              }
            </div>
          </div>
          <div class="kpi-box">
            <div class="kpi-label">Sim Dead Cap</div>
            <div class="kpi-val mono" style="color:var(--amber)">${formatCompactDollars(simAddedDead, true)}</div>
            <div class="mono" style="font-size:10px;color:var(--text-secondary)">
              ${activeMoveCount} move(s) active
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
        <div class="sub-label" style="margin:0">Active Contracts (${simPlayers.length})</div>
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
                    <td class="cap-player-td" style="font-family:var(--font-sans)">
                      <div class="cap-player-cell">
                        <span class="cap-player-av" data-action="open-player-sheet" data-player-id="${esc(p.id)}" data-initial-tab="contract">
                          ${renderPlayerAvatarHtml(p, 22)}
                        </span>
                        <div class="cap-player-meta">
                          <span class="cap-player-name" data-action="open-player-sheet" data-player-id="${esc(p.id)}" data-initial-tab="contract">${esc(p.name)}</span>
                          <span class="cap-player-pos">${esc(p.position)}${
                            p.otcUrl
                              ? ` <a href="${esc(p.otcUrl)}" target="_blank" rel="noopener noreferrer" class="ext-link" title="OverTheCap Contract" aria-label="Open ${esc(p.name)} OverTheCap Contract">${iconSvg('externalLink', 9)}</a>`
                              : ''
                          }</span>
                        </div>
                      </div>
                    </td>
                    <td>
                      ${
                        p.isVoidYear
                          ? `<span class="badge badge-neutral">${jargonTerm('Void', 'void_years')}</span>`
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
                        <option value="none" ${selected === 'none' ? 'selected' : ''}>Keep</option>
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
  `
  );
}
