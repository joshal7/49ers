/**
 * In-Season & Seasonal Views
 * Sub-modules:
 * - matchup     : Upcoming Matchup (Betting, Opponent Health & Play Likelihood, Coaching H2H, Trench Matrix, Franchise H2H)
 * - health      : Team Health & Play Probability (Wed/Thu/Fri Practice, Player Priors, IR 4-Game Return Tracker)
 * - schedule    : Full 2026 Schedule (Melbourne & Mexico City International Venues, Turf, Rest Deltas, Gamecast Links)
 * - trade       : Trade Window (Oct 1 – Nov 10: Buckner/Odighizuwa Grades, Needs, Fits, Pick Costs, Insider Reports)
 * - playoffs    : Playoff Probabilities (10,000-Run Monte Carlo Simulator, Explicit Seed Paths & Interactive Rooting Guide)
 * - draft_prep  : Draft (2027 Needs, Consensus Mocks, Shanahan/Lynch Fit Score, Combine Hub)
 * - draft_class : Draft Recap (2026 Draft Picks & Priority UDFAs, Spider Charts & Verified Highlight Reels)
 * - stats       : Team Stats (1st–32nd NFL Standard & Advanced EPA Rankings + Aggregated Power Rankings)
 */

import {
  esc,
  escJargon,
  jargonTerm,
  jargonInfoIcon,
  playProbBadgeClass,
  rankBadgeClass,
  renderPlayerAvatarHtml,
  renderAvatarStackHtml,
  renderTeamLogoHtml,
  renderMiniMeterHtml,
  renderReporterSourceLinksHtml,
  buildEspnNflTeamUrl,
  lookupRosterPlayerByName,
  registerRosterPlayersForInlineLinks
} from './uiHelpers.js';
import { iconSvg } from './icons.js';
import { renderVideoEmbedOrFacade } from './newsView.js';
import { renderSpiderChartHtml } from '../components/spiderChart.js';
import { formatCompactDollars } from '../engine/capSimulator.js';
import {
  evaluateCombineLeaderboardWindow,
  partitionCompletedTradesByWindow,
  resolveCompleteScheduleModel,
  resolveFirstPickMockDatabase
} from '../engine/seasonStateMachine.js';
import {
  BIG_BOARD_LENSES,
  BIG_BOARD_LENS_ORDER,
  BIG_BOARD_SORT_FIELDS,
  BIG_BOARD_INDIVIDUAL_POSITIONS,
  BIG_BOARD_RANGE_OPTIONS,
  BIG_BOARD_AGREEMENT_OPTIONS,
  formatShortBoardDate,
  queryBigBoardProspects
} from '../engine/draftBigBoardEngine.js';
import {
  buildMockDraftBigBoardUrl,
  buildMockDraftTeamUrl,
  buildPfrTeamDraftUrl,
  buildPfrTeamSeasonUrl,
  sanitizeExternalUrl
} from '../engine/linkIntegrity.js';
import {
  evaluateGameDayWindow,
  resolveGameDayInjuryRows,
  resolveTeamGameDayModel
} from '../engine/gameDayRosterEngine.js';
import {
  buildTeamInjuryNewsFeed,
  computeTeamHealthSummary,
  isEffectiveOffDefStarter
} from '../engine/injuryProbabilityModel.js';
import { renderInjuryNewsItemCardHtml } from './playerSheetView.js';

function formatPracCell(val) {
  const s = String(val ?? '').trim();
  if (!s || s === '-') return '—';
  if (/^vet\s*rest$/i.test(s)) return 'Rest';
  return s;
}

function formatCompactPlayBadge(label) {
  return String(label || '').replace(/Vet Rest\s*\(Full Go\)/i, 'Vet Rest');
}

function formatCoachingBulletHtml(bullet = '', seenJargon = null) {
  const raw = String(bullet || '').trim();
  const colonIdx = raw.indexOf(':');
  const opts = { maxTerms: 20, maxPlayers: 6, seenKeys: seenJargon };
  if (colonIdx > 0 && colonIdx <= 95) {
    const headClean = raw.slice(0, colonIdx).replace(/\*\*/g, '').trim();
    const bodyClean = raw.slice(colonIdx + 1).replace(/^\*\*\s*/, '').trim();
    return `<li><strong>${escJargon(headClean, opts)}:</strong> ${escJargon(bodyClean, opts)}</li>`;
  }
  return `<li>${escJargon(raw, opts)}</li>`;
}

function matchupAdvantageBadgeClass(advantage = '') {
  const s = String(advantage || '').trim();
  if (/\beven\b|\btoss[-\s]?up\b|\bpush\b|\bsplit\b/i.test(s)) return 'badge-gold';
  if (/\b(?:sf|49ers|niners|san francisco)\b/i.test(s)) return 'badge-positive';
  return 'badge-warning';
}

function resolveKeyMatchupSfPlayers(matchupItem = {}, rosterPlayers = []) {
  if (!Array.isArray(rosterPlayers) || rosterPlayers.length === 0) return [];
  const byId = new Map(rosterPlayers.map(p => [String(p.id), p]));
  const out = [];
  const seen = new Set();

  const explicitNames = Array.isArray(matchupItem.sfPlayers) ? matchupItem.sfPlayers : [];
  for (const nm of explicitNames) {
    const found = lookupRosterPlayerByName(nm);
    const full = found ? byId.get(String(found.id)) : null;
    if (full && !seen.has(full.id)) {
      seen.add(full.id);
      out.push(full);
    }
  }
  if (out.length > 0) return out.slice(0, 3);

  const searchHaystack = `${matchupItem.unitMatchup || ''} ${matchupItem.tacticalDetail || ''}`.toLowerCase();
  for (const p of rosterPlayers) {
    if (!p?.name || p.name.length < 6) continue;
    const lowerName = p.name.toLowerCase();
    const noSuffix = lowerName.replace(/,?\s+\b(?:jr\.?|sr\.?|ii|iii|iv|v)\b\.?$/i, '').trim();
    if (searchHaystack.includes(lowerName) || (noSuffix.length >= 6 && searchHaystack.includes(noSuffix))) {
      if (!seen.has(p.id)) {
        seen.add(p.id);
        out.push(p);
        if (out.length >= 3) break;
      }
    }
  }
  return out;
}

function renderKeyMatchupStatStripHtml(statComparison = '') {
  const raw = String(statComparison || '').trim();
  if (!raw) return '';
  const parts = raw
    .split(/\s*\|\s*/)
    .map(s => s.trim())
    .filter(Boolean);
  if (parts.length >= 2) {
    return `
      <div class="matchup-tape-strip mono" data-matchup-stat-strip>
        <span class="matchup-tape-sf">${escJargon(parts[0], { maxTerms: 4, maxPlayers: 0 })}</span>
        <span class="matchup-tape-sep" aria-hidden="true">vs.</span>
        <span class="matchup-tape-opp">${escJargon(parts.slice(1).join(' · '), { maxTerms: 4, maxPlayers: 0 })}</span>
      </div>
    `;
  }
  return `<div class="matchup-tape-strip mono" data-matchup-stat-strip><span class="matchup-tape-sf">${escJargon(raw, { maxTerms: 6, maxPlayers: 0 })}</span></div>`;
}

function formatOppImportanceTag(op) {
  const snap = Number(op?.snapPct || 0);
  const isStarter = isEffectiveOffDefStarter(op);
  if (isStarter && snap > 0) return `Starter · ${snap}%`;
  if (isStarter) return 'Starter';
  if (snap >= 25) return `Rotation · ${snap}%`;
  if (snap > 0) return `${snap}% snaps`;
  return 'Depth';
}

function renderGameDayRosterCard(
  gameDayModel,
  { is49ers = false, asSubcard = false, teamName = '49ers', teamAbbr = 'SF', teamLogoUrl = null } = {}
) {
  if (!gameDayModel?.isActive) return '';

  const inactives = gameDayModel.inactives || [];
  const activesByUnit = gameDayModel.activesByUnit || {
    Offense: [],
    Defense: [],
    'Special Teams': []
  };
  const unitOrder = ['Offense', 'Defense', 'Special Teams'];
  const totalActives =
    gameDayModel.totalActives ||
    unitOrder.reduce((acc, u) => acc + (activesByUnit[u]?.length || 0), 0);

  const win = gameDayModel.windowInfo || {};
  const timingLabel =
    win.phase === 'in_game'
      ? 'Live Game'
      : typeof win.minutesToKickoff === 'number' && win.minutesToKickoff > 0
        ? `Kickoff in ${win.minutesToKickoff}m`
        : 'Pre-Kickoff';

  const statusBadgeCls = gameDayModel.officialPosted ? 'badge-positive' : 'badge-warning';
  const statusLabel =
    gameDayModel.statusLabel ||
    (gameDayModel.officialPosted ? 'Official Inactives Declared' : 'Official Inactives Pending');

  const tagName = asSubcard ? 'div' : 'section';
  const outerCls = asSubcard
    ? 'subcard-panel gameday-roster-card gameday-subcard'
    : 'card temporal-highlight gameday-roster-card';

  return `
    <${tagName} class="${outerCls}" data-gameday-roster-block="${is49ers ? 'sf' : 'opp'}">
      <div class="gameday-roster-head">
        <div class="gameday-roster-title-wrap">
          ${renderTeamLogoHtml(teamAbbr, teamLogoUrl, 24)}
          <div>
            <div class="card-eyebrow">${esc(teamAbbr)} Game-Day Availability • ${esc(timingLabel)}</div>
            <div class="gameday-roster-title">${esc(teamName)} Inactives &amp; Active Roster</div>
          </div>
        </div>
        <span class="badge ${statusBadgeCls} mono">${esc(statusLabel)}</span>
      </div>

      ${
        !gameDayModel.officialPosted
          ? `<div class="gameday-pending-note">
              Official game-day inactives are due ~90 min pre-kickoff (auto-updating live as announced).${
                (gameDayModel.pendingQuestionables || []).length > 0
                  ? ` Watching ${gameDayModel.pendingQuestionables.length} GTD designation${gameDayModel.pendingQuestionables.length > 1 ? 's' : ''}.`
                  : ''
              }
            </div>`
          : ''
      }

      <div class="gameday-inactives-section" data-gameday-inactives>
        <div class="sub-label" style="margin-bottom:5px">
          ${gameDayModel.officialPosted ? `Declared Inactives (${inactives.length})` : `Pre-Declared Out / Inactives (${inactives.length})`}
        </div>
        ${
          inactives.length > 0
            ? `<div class="gameday-inactives-grid">
                ${inactives
                  .map(p => {
                    const clickAttrs =
                      is49ers && p.playerId
                        ? `style="cursor:pointer" data-action="open-player-sheet" data-player-id="${esc(p.playerId)}" data-initial-tab="health"`
                        : '';
                    const nameHtml =
                      !is49ers && p.espnUrl
                        ? `<a href="${esc(p.espnUrl)}" target="_blank" rel="noopener noreferrer" class="ext-link"><strong>${esc(p.name)}</strong></a>`
                        : `<strong>${esc(p.name)}</strong>`;
                    return `
                      <div class="gameday-inactive-chip" ${clickAttrs}>
                        ${renderPlayerAvatarHtml(p, 24)}
                        <div class="gameday-inactive-meta">
                          <div class="gameday-inactive-name">${nameHtml} <span class="gameday-pos">${esc(p.position)}${p.jersey != null ? ` #${p.jersey}` : ''}</span></div>
                          <div class="gameday-inactive-reason">${esc(p.injuryType || p.reason || 'Inactive')}</div>
                        </div>
                      </div>
                    `;
                  })
                  .join('')}
              </div>`
            : `<div style="font-size:12px;color:var(--text-muted)">Awaiting official game-day scratch list from stadium press box…</div>`
        }
      </div>

      <details class="gameday-active-collapsible" data-gameday-active-roster>
        <summary class="gameday-active-summary">
          <span>Active Game-Day Roster (${totalActives} Players)</span>
          <span class="gameday-summary-sub mono">Offense • Defense • ST</span>
        </summary>
        <div class="gameday-units-wrap">
          ${unitOrder
            .map(unitName => {
              const list = activesByUnit[unitName] || [];
              return `
                <div class="gameday-unit-group" data-gameday-unit="${esc(unitName)}">
                  <div class="gameday-unit-title">${esc(unitName)} (${list.length})</div>
                  ${
                    list.length > 0
                      ? `<div class="gameday-active-chips">
                          ${list
                            .map(ap => {
                              const inner = `${
                                ap.jersey != null ? `<span class="mono gameday-pill-num">#${ap.jersey}</span>` : ''
                              }<span>${esc(ap.name)}</span><span class="gameday-pos">${esc(ap.position)}</span>${
                                ap.isExplicitActiveGtd ? `<span class="badge badge-warning mono" style="font-size:9px;padding:1px 4px">GTD</span>` : ''
                              }`;
                              if (is49ers && ap.playerId) {
                                return `<button type="button" class="gameday-active-pill gameday-active-chip" data-action="open-player-sheet" data-player-id="${esc(ap.playerId)}">${inner}</button>`;
                              }
                              const safeOppUrl = !is49ers ? sanitizeExternalUrl(ap.espnUrl, null) : null;
                              if (safeOppUrl) {
                                return `<a href="${esc(safeOppUrl)}" target="_blank" rel="noopener noreferrer" class="gameday-active-pill gameday-active-chip" style="text-decoration:none;color:inherit">${inner}</a>`;
                              }
                              return `<span class="gameday-active-pill gameday-active-chip">${inner}</span>`;
                            })
                            .join('')}
                        </div>`
                      : `<div style="font-size:11.5px;color:var(--text-muted)">Roster unit populating…</div>`
                  }
                </div>
              `;
            })
            .join('')}
        </div>
      </details>
    </${tagName}>
  `;
}

export const SEASON_NAV_CLUSTERS = [
  {
    id: 'gameday_core',
    ariaLabel: 'Weekly Game and Team Views',
    tabs: [
      { key: 'matchup', icon: 'swords', label: 'Matchup', fullTitle: 'Upcoming Matchup', phase: 'IN_SEASON', temporal: false },
      { key: 'health', icon: 'heartPulse', label: 'Health', fullTitle: 'Team Health', phase: 'IN_SEASON', temporal: false },
      { key: 'schedule', icon: 'calendar', label: 'Schedule', fullTitle: 'Schedule', phase: 'YEAR_ROUND', temporal: false },
      { key: 'stats', icon: 'season', label: 'Stats', fullTitle: 'Team Stats', phase: 'IN_SEASON', temporal: false }
    ]
  },
  {
    id: 'seasonal_horizon',
    ariaLabel: 'Trade, Playoffs and Draft Views',
    tabs: [
      { key: 'trade', icon: 'trade', label: 'Trade', fullTitle: 'Trade Window', phase: 'TRADE_WINDOW', temporal: true },
      { key: 'playoffs', icon: 'trophy', label: 'Playoffs', fullTitle: 'Playoff Odds', phase: 'PLAYOFF_PUSH', temporal: true },
      { key: 'draft_prep', icon: 'compass', label: 'Draft', fullTitle: '2027 NFL Draft', phase: 'DRAFT_PREP', temporal: true },
      { key: 'draft_class', icon: 'radar', label: 'Draft Recap', fullTitle: '2026 Draft Recap', phase: 'DRAFT_LIVE_UDFA', temporal: true }
    ]
  }
];

export function renderSeasonMatchupViewHtml({
  seasonSub = 'matchup',
  activePhases = [],
  appData,
  mcSimResult,
  forcedWinners = {},
  combineSearch = '',
  bigBoardSearch = '',
  bigBoardPosFilter = 'ALL',
  bigBoardPositions = [],
  bigBoardLens = 'consensus',
  bigBoardSortField = 'consensus',
  bigBoardSortDir = 'asc',
  bigBoardRange = 'all',
  bigBoardAgreement = 'all',
  bigBoardRankedOnly = false,
  bigBoardFilterDrawerOpen = false,
  bigBoardExpanded = false,
  bigBoardShowAll = false,
  bigBoardExpandedIds = null,
  bigBoardShareCopied = false,
  expandedDraftSpiderIdx = -1,
  activeVideosSet,
  schedulePrevExpanded = false,
  expandedRootingWeeks = null,
  matchupStatsUnit = 'offense',
  userPrefs = null,
  reportersById = null
}) {
  registerRosterPlayersForInlineLinks(appData?.roster?.players);
  const phaseSet = new Set(activePhases || []);

  const switcherCard = `
    <div class="card subnav-card season-subnav-card" role="navigation" aria-label="Game and Season Views">
      ${SEASON_NAV_CLUSTERS.map(
        cluster => `
        <div class="segmented-control season-cluster-bar" data-season-cluster="${esc(cluster.id)}" role="tablist" aria-label="${esc(cluster.ariaLabel)}">
          ${cluster.tabs
            .map(t => {
              const isSelected = seasonSub === t.key;
              const isLiveTemporal = Boolean(t.temporal && phaseSet.has(t.phase));
              return `
            <button type="button" role="tab" aria-selected="${isSelected ? 'true' : 'false'}"
                    title="${esc(t.fullTitle)}${isLiveTemporal ? ' • Active NFL Window' : ''}"
                    class="pill-btn seg-btn season-tab-btn ${isSelected ? 'active' : ''} ${t.temporal && !isLiveTemporal ? 'off-cycle' : ''}"
                    data-action="set-season-sub" data-season-sub="${t.key}">
              ${iconSvg(t.icon, 13)}
              <span>${esc(t.label)}</span>
              ${isLiveTemporal ? `<span class="season-live-dot" aria-hidden="true"></span>` : ''}
            </button>
          `;
            })
            .join('')}
        </div>
      `
      ).join('')}
    </div>
  `;

  if (seasonSub === 'matchup') return switcherCard + renderUpcomingMatchup(appData, matchupStatsUnit);
  if (seasonSub === 'health') return switcherCard + renderTeamHealthAndIr(appData, userPrefs, reportersById);
  if (seasonSub === 'stats') return switcherCard + renderTeamStatsAndPower(appData);
  if (seasonSub === 'trade') return switcherCard + renderTradeWindow(appData);
  if (seasonSub === 'playoffs')
    return switcherCard + renderPlayoffSimulator(appData, mcSimResult, forcedWinners, expandedRootingWeeks);
  if (seasonSub === 'schedule') return switcherCard + renderFullSchedule(appData, schedulePrevExpanded, mcSimResult);
  if (seasonSub === 'draft_prep') {
    return (
      switcherCard +
      renderDraftPrepAndCombine(appData, {
        combineSearch,
        bigBoardSearch,
        bigBoardPosFilter,
        bigBoardPositions,
        bigBoardLens,
        bigBoardSortField,
        bigBoardSortDir,
        bigBoardRange,
        bigBoardAgreement,
        bigBoardRankedOnly,
        bigBoardFilterDrawerOpen,
        bigBoardExpanded,
        bigBoardShowAll,
        bigBoardExpandedIds,
        bigBoardShareCopied,
        mcSimResult
      })
    );
  }
  return switcherCard + renderDraftClassAndUdfas(appData, expandedDraftSpiderIdx, activeVideosSet);
}

function renderTeamRankTriggerHtml(rank, metricKey, { showMeter = true, large = false } = {}) {
  const rNum = Number(rank || 16);
  const pct = ((33 - rNum) / 32) * 100;
  const meterColor = rNum <= 8 ? 'emerald' : rNum <= 18 ? 'gold' : 'scarlet';
  if (!metricKey) {
    return `<div class="team-rank-cell"><span class="badge ${rankBadgeClass(rNum)} mono">#${rNum}</span>${
      showMeter ? renderMiniMeterHtml(pct, meterColor) : ''
    }</div>`;
  }
  return `
    <button type="button" class="rank-badge-trigger ${large ? 'large' : ''}"
            data-action="open-stat-rank-modal"
            data-rank-scope="team"
            data-rank-key="${esc(metricKey)}"
            aria-label="Rank #${rNum} — tap to view all 32 NFL teams">
      <span class="badge ${rankBadgeClass(rNum)} mono ${large ? 'overall-rank-pill' : ''}">#${rNum}</span>
      ${showMeter ? renderMiniMeterHtml(pct, meterColor) : ''}
    </button>
  `;
}

function renderMatchupTeamStatsComparison(appData, matchupStatsUnit = 'offense') {
  const ts = appData?.scheduleMatchup?.teamStats;
  const units = ts?.units || [];
  if (units.length === 0) return '';

  const um = appData?.scheduleMatchup?.upcomingMatchup || {};
  const oppAbbr = String(um.oppAbbr || 'OPP').toUpperCase();
  const oppShortName = (um.oppName || oppAbbr).split(' ').slice(-1)[0] || oppAbbr;
  const activeUnit = units.find(u => u.id === matchupStatsUnit) || units[0];

  const getTeamRowEntry = (metricObj, abbr) => {
    const lb = metricObj?.leaderboard || [];
    return lb.find(x => x.team === abbr) || { rank: 16, disp: '—' };
  };

  const renderH2hRows = rows =>
    (rows || [])
      .map(r => {
        const sfEntry = getTeamRowEntry(r, 'SF');
        const oppEntry = getTeamRowEntry(r, oppAbbr);
        return `
          <tr>
            <td><strong>${escJargon(r.label)}</strong></td>
            <td class="mono num-col"><strong>${esc(sfEntry.disp ?? r.displayValue)}</strong></td>
            <td class="rank-col">${renderTeamRankTriggerHtml(sfEntry.rank ?? r.rank, r.key, { showMeter: false })}</td>
            <td class="mono num-col">${esc(oppEntry.disp)}</td>
            <td class="rank-col">${renderTeamRankTriggerHtml(oppEntry.rank, r.key, { showMeter: false })}</td>
          </tr>
        `;
      })
      .join('');

  const sfOverall = getTeamRowEntry(activeUnit.overall, 'SF');
  const oppOverall = getTeamRowEntry(activeUnit.overall, oppAbbr);
  const sfOverallDisp = String(sfOverall.disp || activeUnit.overall?.displayValue || '—').replace(/\s*idx\b/gi, '%');
  const oppOverallDisp = String(oppOverall.disp || '—').replace(/\s*idx\b/gi, '%');
  const expandedCount = (activeUnit.expandedGroups || []).reduce((s, g) => s + (g.rows?.length || 0), 0);

  return `
    <section class="card team-stats-card matchup-stats-card" id="matchupTeamStatsCard">
      <div class="card-header team-stats-header">
        <div class="card-header-left">
          <div class="card-icon-badge compact" aria-hidden="true">${iconSvg('season', 16)}</div>
          <div class="card-title-group">
            <h3 class="card-title">49ers vs. ${esc(oppShortName)} Unit Rankings</h3>
          </div>
        </div>
      </div>

      <div class="segmented-control compact-seg" role="tablist" aria-label="Matchup Stat Units">
        ${units
          .map(
            u => `
          <button type="button" role="tab" aria-selected="${u.id === activeUnit.id ? 'true' : 'false'}"
                  class="pill-btn seg-btn ${u.id === activeUnit.id ? 'active' : ''}"
                  data-action="set-matchup-stats-unit" data-unit-id="${esc(u.id)}">
            <span>${esc(u.shortLabel)}</span>
          </button>
        `
          )
          .join('')}
      </div>

      <div class="table-scroll">
        <table class="data-table team-stats-table matchup-stats-table">
          <thead>
            <tr>
              <th>Metric</th>
              <th class="mono num-col">49ers</th>
              <th class="mono rank-col">Rank</th>
              <th class="mono num-col">${esc(oppShortName)}</th>
              <th class="mono rank-col">Rank</th>
            </tr>
            <tr class="unit-overall-banner overall-stat-row matchup-h2h-banner" data-overall-unit="${esc(activeUnit.id)}">
              <td>
                <div class="unit-overall-inline">
                  <span class="unit-overall-heading">${esc(activeUnit.overall?.label || `Overall ${activeUnit.shortLabel} Rank`)}</span>
                  <span class="unit-overall-sub mono overall-how-wrap">${jargonTerm('Composite Score', activeUnit.jargonKey)}</span>
                </div>
              </td>
              <td class="mono num-col overall-val-cell" data-overall-col="sf-val"><strong>${esc(sfOverallDisp)}</strong></td>
              <td class="rank-col overall-rank-cell" data-overall-col="sf-rank">
                <div class="unit-overall-right">${renderTeamRankTriggerHtml(sfOverall.rank, activeUnit.overall?.key, { showMeter: false, large: true })}</div>
              </td>
              <td class="mono num-col overall-val-cell" data-overall-col="opp-val"><strong>${esc(oppOverallDisp)}</strong></td>
              <td class="rank-col overall-rank-cell" data-overall-col="opp-rank">
                <div class="unit-overall-right">${renderTeamRankTriggerHtml(oppOverall.rank, activeUnit.overall?.key, { showMeter: false, large: true })}</div>
              </td>
            </tr>
          </thead>
          <tbody>
            ${renderH2hRows(activeUnit.coreRows)}
          </tbody>
        </table>
      </div>

      ${
        expandedCount > 0
          ? `
        <details class="stats-expand-details" data-matchup-stats-expander="${esc(activeUnit.id)}">
          <summary class="stats-expand-summary">
            <span>Detailed ${esc(activeUnit.shortLabel)} (${expandedCount})</span>
            <span class="mono stats-expand-hint">Expand</span>
          </summary>
          <div class="stats-expand-body">
            ${(activeUnit.expandedGroups || [])
              .map(
                grp => `
              <div class="stats-subgroup-block">
                <div class="sub-label stats-subgroup-title">${esc(grp.groupTitle)}</div>
                <div class="table-scroll">
                  <table class="data-table team-stats-table matchup-stats-table">
                    <tbody>
                      ${renderH2hRows(grp.rows)}
                    </tbody>
                  </table>
                </div>
              </div>
            `
              )
              .join('')}
          </div>
        </details>
      `
          : ''
      }
    </section>
  `;
}

function renderUpcomingMatchup(appData, matchupStatsUnit = 'offense') {
  const um = appData?.scheduleMatchup?.upcomingMatchup || {};
  const bet = um.betting || {};
  const oppHealth = um.opponentHealth || {};
  const sharedWin = evaluateGameDayWindow(appData?.scheduleMatchup?.schedule || [], um, Date.now());
  const oppGameDay = resolveTeamGameDayModel(appData, { is49ers: false, windowState: sharedWin });
  const rawOppInjReport = oppHealth.injuryReport || [];
  const oppInjReport = oppGameDay?.isActive
    ? resolveGameDayInjuryRows(rawOppInjReport, oppGameDay)
    : rawOppInjReport;
  const oppIrList = oppHealth.irReserve || [];
  const unresolvedOppNames = new Set(
    oppInjReport
      .filter(r => {
        const st = String(r?.gameStatus || '').trim();
        const pr = Number(r?.playProbabilityPct ?? 50);
        return !(/^(?:active|in\b|no designation|cleared)/i.test(st) || pr >= 88);
      })
      .map(r => String(r?.name || '').toLowerCase().replace(/[^a-z0-9]/g, ''))
      .filter(Boolean)
  );
  const oppHealthyStarters = (oppHealth.keyStartersHealthy || []).filter(
    st => !unresolvedOppNames.has(String(st?.name || '').toLowerCase().replace(/[^a-z0-9]/g, ''))
  );
  const sfGameDay = resolveTeamGameDayModel(appData, { is49ers: true, windowState: sharedWin });
  const rawSfPr = appData?.health?.practiceReport || [];
  const sfPr = (sfGameDay?.isActive ? resolveGameDayInjuryRows(rawSfPr, sfGameDay) : rawSfPr).slice(0, 5);

  const resolvedOppSummary = computeTeamHealthSummary({
    injuryReport: oppInjReport,
    irReserve: oppIrList,
    totalStarters: oppHealth.summary?.totalStarters || 22
  });
  const availScore = resolvedOppSummary.overallAvailabilityScore;
  const availMeterTone = availScore >= 82 ? 'emerald' : availScore >= 68 ? 'gold' : 'scarlet';
  const availValColor =
    availScore >= 82 ? 'var(--emerald)' : availScore >= 68 ? 'var(--gold-bright)' : 'var(--crimson)';
  const startersSubNote = (() => {
    const {
      startersUnresolvedCount,
      startersOutCount,
      startersDoubtfulOnlyCount,
      startersLongShotCount,
      startersQuestionableCount
    } = resolvedOppSummary;
    if (startersUnresolvedCount === 0) return 'All 22 full go';
    const parts = [
      startersOutCount > 0 ? `${startersOutCount} Out` : '',
      startersDoubtfulOnlyCount > 0 ? `${startersDoubtfulOnlyCount} Doubtful` : '',
      startersLongShotCount > 0 ? `${startersLongShotCount} Long Shot` : '',
      startersQuestionableCount > 0 ? `${startersQuestionableCount} GTD` : ''
    ].filter(Boolean);
    return parts.join(' · ');
  })();
  const qDoubtfulSubNote = (() => {
    const { questionableOrDoubtfulCount, doubtfulCount, longShotCount, gtdCount } = resolvedOppSummary;
    if (questionableOrDoubtfulCount === 0) return '0 designations';
    const parts = [
      doubtfulCount > 0 ? `${doubtfulCount} Doubtful` : '',
      longShotCount > 0 ? `${longShotCount} Long Shot` : '',
      gtdCount > 0 ? `${gtdCount} GTD` : ''
    ].filter(Boolean);
    return `(${parts.join(' · ')})`;
  })();
  const outIrSubNote = (() => {
    const { irCount, irOpenWindowCount, irSeasonEndingCount } = resolvedOppSummary;
    if (irOpenWindowCount > 0) {
      return `${irOpenWindowCount} IR window${irOpenWindowCount > 1 ? 's' : ''} open`;
    }
    if (irSeasonEndingCount > 0) {
      return `${irSeasonEndingCount} season-ending`;
    }
    if (irCount > 0) return '4-gm min reserve';
    return '0 on reserve';
  })();

  const sfIsAway = um.homeAway === 'away';
  const sfRecShort = um.sfRecord?.split(' ')[0] || appData?.meta?.teamRecord || '—';
  const awayColHtml = sfIsAway
    ? `<a href="${esc(buildEspnNflTeamUrl('SF'))}" target="_blank" rel="noopener noreferrer" class="sb-team-col" style="text-decoration:none;color:inherit">
        ${renderTeamLogoHtml('SF', um.sfLogoUrl, 40)}
        <div class="sb-team-meta">
          <div class="sb-team-abbr">49ers</div>
          <div class="sb-team-rec mono">${esc(sfRecShort)}</div>
        </div>
      </a>`
    : `<a href="${esc(buildEspnNflTeamUrl(um.oppAbbr || 'NFL'))}" target="_blank" rel="noopener noreferrer" class="sb-team-col" style="text-decoration:none;color:inherit">
        ${renderTeamLogoHtml(um.oppAbbr || 'NFL', um.oppLogoUrl, 40)}
        <div class="sb-team-meta">
          <div class="sb-team-abbr">${esc(um.oppName || 'Opponent')}</div>
          <div class="sb-team-rec mono">${esc(um.oppRecord || '—')}</div>
        </div>
      </a>`;
  const homeColHtml = sfIsAway
    ? `<a href="${esc(buildEspnNflTeamUrl(um.oppAbbr || 'NFL'))}" target="_blank" rel="noopener noreferrer" class="sb-team-col home" style="text-decoration:none;color:inherit">
        <div class="sb-team-meta">
          <div class="sb-team-abbr">${esc(um.oppName || 'Opponent')}</div>
          <div class="sb-team-rec mono">${esc(um.oppRecord || '—')}</div>
        </div>
        ${renderTeamLogoHtml(um.oppAbbr || 'NFL', um.oppLogoUrl, 40)}
      </a>`
    : `<a href="${esc(buildEspnNflTeamUrl('SF'))}" target="_blank" rel="noopener noreferrer" class="sb-team-col home" style="text-decoration:none;color:inherit">
        <div class="sb-team-meta">
          <div class="sb-team-abbr">49ers</div>
          <div class="sb-team-rec mono">${esc(sfRecShort)}</div>
        </div>
        ${renderTeamLogoHtml('SF', um.sfLogoUrl, 40)}
      </a>`;

  return `
    <section class="card temporal-highlight">
      <div class="card-header">
        <div class="card-header-left">
          <div class="card-icon-badge temporal" aria-hidden="true">${iconSvg('swords', 18)}</div>
          <div class="card-title-group">
            <div class="card-eyebrow">${esc(um.kickoffDisplay)}</div>
            <h2 class="card-title">Week ${um.week} Matchup</h2>
          </div>
        </div>
        <button type="button" class="btn-ghost" data-action="analyze-topic-jump"
                data-prompt="${esc(`Deep film and protection breakdown for Week ${um.week} ${sfIsAway ? `49ers at ${um.oppName}` : `${um.oppName} at 49ers`}: ${um.coachingMatchup?.headline || 'coaching chess match and trench keys'}`)}">
          ${iconSvg('sparkles', 13)}
          <span>AI Film Prep</span>
        </button>
      </div>

      <div class="matchup-scoreboard">
        ${awayColHtml}
        <span class="sb-vs-pill mono">@</span>
        ${homeColHtml}
      </div>

      <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:8px">
        <div class="inline-icon-meta">
          ${iconSvg('stadium', 14)}
          <span>${esc(um.venue)}</span>
        </div>
        <div class="source-link-strip">
          ${
            um.gameUrl
              ? `<a href="${esc(um.gameUrl)}" target="_blank" rel="noopener noreferrer" class="source-chip-link"><span>ESPN Gamecast</span>${iconSvg('externalLink', 11)}</a>`
              : ''
          }
          <a href="${esc(um.statsSourceUrl || 'https://github.com/nflverse/nflverse-data')}" target="_blank" rel="noopener noreferrer" class="source-chip-link"><span>nflverse EPA</span>${iconSvg('externalLink', 11)}</a>
        </div>
      </div>

      <div class="kpi-grid" style="grid-template-columns:0.82fr 0.8fr 1.38fr">
        <div class="kpi-box"><div class="kpi-label">Spread</div><div class="kpi-val mono" style="color:var(--emerald)">${esc(bet.spread)}</div></div>
        <div class="kpi-box"><div class="kpi-label">Total (O/U)</div><div class="kpi-val mono">${esc(bet.overUnder)}</div></div>
        <div class="kpi-box"><div class="kpi-label">Implied Score</div><div class="kpi-val mono" style="font-size:12px;letter-spacing:-0.03em">${esc(String(bet.impliedScore || '').replace(/\s+[–—-]\s+/g, ' · '))}</div></div>
      </div>

      <div class="subcard-panel" style="font-size:12px;color:var(--text-secondary)">
        <strong>Line &amp; Rest:</strong> ${esc(bet.openingSpread)} • ML <span class="mono">${esc(bet.moneyline)}</span> • <strong style="color:var(--gold-bright)">${esc(bet.restAdvantage)}</strong>
      </div>
    </section>

    <section class="card" id="opponentHealthSection">
      <div class="card-header">
        <div class="card-header-left">
          ${renderTeamLogoHtml(um.oppAbbr || 'LV', um.oppLogoUrl, 28)}
          <div class="card-title-group">
            <h3 class="card-title">${esc(um.oppName)} Health</h3>
          </div>
        </div>
        <div class="source-link-strip">
          <a href="${esc(oppHealth.teamInjuriesUrl || um.injurySourceUrl || 'https://www.espn.com/nfl/injuries')}" target="_blank" rel="noopener noreferrer" class="source-chip-link">
            <span>${esc(um.oppAbbr || 'OPP')} Injuries</span>${iconSvg('externalLink', 11)}
          </a>
        </div>
      </div>

      <div class="kpi-grid kpi-grid-2 health-scorecard-grid" style="margin-bottom:10px" data-opp-health-scorecard>
        <div class="kpi-box">
          <div class="kpi-label">${jargonTerm('Availability Index', 'availability_index')}</div>
          <div class="kpi-val mono" style="color:${availValColor}">${availScore}/100</div>
          ${renderMiniMeterHtml(availScore, availMeterTone)}
        </div>
        <div class="kpi-box">
          <div class="kpi-label">${jargonTerm('Starters Cleared', 'starters_cleared')}</div>
          <div class="kpi-val mono">${resolvedOppSummary.activeStartersHealthy}/${resolvedOppSummary.totalStarters}</div>
          <div class="kpi-sub-note mono">${esc(startersSubNote)}</div>
        </div>
        <div class="kpi-box">
          <div class="kpi-label">Injured</div>
          <div class="kpi-val mono" style="color:${resolvedOppSummary.questionableOrDoubtfulCount > 0 ? 'var(--gold-bright)' : 'var(--text-primary)'}">${resolvedOppSummary.questionableOrDoubtfulCount}</div>
          <div class="kpi-sub-note mono">${esc(qDoubtfulSubNote)}</div>
        </div>
        <div class="kpi-box">
          <div class="kpi-label">Ruled Out / ${jargonTerm('IR', 'ir')}</div>
          <div class="kpi-val mono" style="color:${resolvedOppSummary.ruledOutCount > 0 || resolvedOppSummary.irCount > 0 ? 'var(--crimson)' : 'var(--text-primary)'}">${resolvedOppSummary.ruledOutCount} Out • ${resolvedOppSummary.irCount} IR</div>
          <div class="kpi-sub-note mono">${esc(outIrSubNote)}</div>
        </div>
      </div>

      ${renderGameDayRosterCard(oppGameDay, {
        is49ers: false,
        asSubcard: true,
        teamName: um.oppName || 'Opponent',
        teamAbbr: um.oppAbbr || 'OPP',
        teamLogoUrl: um.oppLogoUrl
      })}

      ${
        oppInjReport.length > 0
          ? `
            <div class="sub-label" style="margin-bottom:6px">Practice Participation</div>
            <div class="table-scroll health-table-scroll" data-health-table="opp" style="margin-bottom:10px">
              <table class="data-table sticky-col-table narrow-health-table">
                <thead>
                  <tr>
                    <th class="sticky-first-col">${esc(um.oppAbbr || 'OPP')} Player</th>
                    <th>Injury</th>
                    <th class="mono">${jargonTerm('W', 'dnp')} / ${jargonTerm('T', 'lp')} / ${jargonTerm('F', 'fp')}</th>
                    <th>Play Likelihood</th>
                  </tr>
                </thead>
                <tbody>
                  ${oppInjReport
                    .map(
                      op => `
                    <tr>
                      <td class="sticky-first-col">
                        <div class="sticky-player-cell">
                          ${renderPlayerAvatarHtml(op, 26)}
                          <div class="sticky-player-meta">
                            <div class="sticky-player-name">
                              ${
                                op.espnUrl
                                  ? `<a href="${esc(op.espnUrl)}" target="_blank" rel="noopener noreferrer" class="ext-link"><strong>${esc(op.name)}</strong></a>`
                                  : `<strong>${esc(op.name)}</strong>`
                              }
                            </div>
                            <div class="sticky-player-sub">${esc(op.position)}${op.jersey != null ? ` #${op.jersey}` : ''} • ${esc(formatOppImportanceTag(op))}</div>
                          </div>
                        </div>
                      </td>
                      <td>${esc(op.injuryType || op.gameStatus || 'Undisclosed')}</td>
                      <td class="mono">${esc(formatPracCell(op.wed))} / ${esc(formatPracCell(op.thu))} / ${esc(formatPracCell(op.fri))}</td>
                      <td><span class="badge ${playProbBadgeClass(op.playProbabilityPct)} mono">${esc(formatCompactPlayBadge(op.playBadgeLabel))}</span></td>
                    </tr>
                  `
                    )
                    .join('')}
                </tbody>
              </table>
            </div>

            <details class="compact-details" style="margin-bottom:10px">
              <summary class="compact-details-summary">
                <span>${esc(um.oppAbbr || 'OPP')} Beat Notes (${oppInjReport.length})</span>
              </summary>
              <div style="display:flex;flex-direction:column;gap:6px;margin-top:6px">
                ${oppInjReport
                  .map(
                    op => `
                  <div class="subcard-panel" style="font-size:12px">
                    <div style="display:flex;justify-content:space-between;align-items:center;gap:6px;flex-wrap:wrap;margin-bottom:2px">
                      <span>
                        ${
                          op.espnUrl
                            ? `<a href="${esc(op.espnUrl)}" target="_blank" rel="noopener noreferrer" class="ext-link"><strong>${esc(op.name)}</strong></a>`
                            : `<strong>${esc(op.name)}</strong>`
                        } <strong style="color:var(--gold-bright)">(${esc(op.position)} • ${esc(op.injuryType)})</strong>
                      </span>
                      <span class="mono" style="font-size:11px;color:var(--text-muted)">${esc((op.factors || [])[0] || `${formatPracCell(op.wed)}/${formatPracCell(op.thu)}/${formatPracCell(op.fri)}`)}</span>
                    </div>
                    <div style="color:var(--text-secondary)">${escJargon(op.longComment || op.shortComment || op.archetypeNote || '')}</div>
                  </div>
                `
                  )
                  .join('')}
              </div>
            </details>
          `
          : `<div class="subcard-panel" style="font-size:12.5px;margin-bottom:10px">No active-roster ${esc(um.oppName)} players currently carry an injury designation for Week ${um.week || ''}.</div>`
      }

      ${
        oppHealthyStarters.length > 0
          ? `
            <details class="compact-details" style="margin-bottom:10px">
              <summary class="compact-details-summary">
                <span>Starters Cleared (${oppHealthyStarters.length})</span>
              </summary>
              <div style="display:flex;flex-wrap:wrap;gap:6px;margin-top:6px">
                ${oppHealthyStarters
                  .map(
                    st => `
                  <a href="${esc(st.espnUrl || oppHealth.sourceUrl || 'https://www.espn.com/nfl/injuries')}" target="_blank" rel="noopener noreferrer" class="source-chip-link" style="padding:5px 9px">
                    <strong>${esc(st.name)}</strong>
                    <span style="color:var(--text-muted)">(${esc(st.position)}${st.snapPct ? ` • ${st.snapPct}% snaps` : ''})</span>
                    <span class="mono" style="color:var(--emerald);font-weight:700">${st.playProbabilityPct}%</span>
                  </a>
                `
                  )
                  .join('')}
              </div>
            </details>
          `
          : ''
      }

      ${
        oppIrList.length > 0
          ? `
            <details class="compact-details" style="margin-bottom:10px">
              <summary class="compact-details-summary">
                <span>IR &amp; 4-Game Return Window Tracker (${oppIrList.length})</span>
              </summary>
              <div style="display:flex;flex-direction:column;gap:6px;margin-top:6px">
                ${oppIrList
                  .map(ir => {
                    const meta = formatIrCardBadgeAndSubtitle(ir, appData?.meta?.seasonYear || 2026, { isOpponent: true });
                    return `
                  <div class="subcard-panel" style="font-size:12px">
                    <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap">
                      <div style="display:flex;align-items:center;gap:8px;min-width:0">
                        ${renderPlayerAvatarHtml(ir, 28)}
                        <div>
                          ${
                            ir.espnUrl
                              ? `<a href="${esc(ir.espnUrl)}" target="_blank" rel="noopener noreferrer" class="ext-link"><strong>${esc(ir.name)}</strong> ${iconSvg('externalLink', 10)}</a>`
                              : `<strong>${esc(ir.name)}</strong>`
                          }
                          <span style="color:var(--gold-bright)"> (${esc(ir.position)}${ir.injuryType ? ` • ${esc(ir.injuryType)}` : ''})</span>
                        </div>
                      </div>
                      <span class="badge ${meta.badgeClass} mono">${esc(meta.badgeText)}</span>
                    </div>
                    <div style="font-size:11px;color:var(--text-muted);margin-top:3px">
                      ${meta.subtitleHtml}
                    </div>
                    ${ir.beatNote ? `<div style="color:var(--text-secondary);margin-top:3px">${escJargon(ir.beatNote)}</div>` : ''}
                  </div>
                `;
                  })
                  .join('')}
              </div>
            </details>
          `
          : ''
      }

      <div class="subcard-panel" style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap">
        <div style="font-size:12px;color:var(--text-secondary)">
          <strong>49ers Side:</strong> ${sfPr
            .slice(0, 3)
            .map(p =>
              p.playerId
                ? `<span class="inline-player-link" role="button" tabindex="0" data-action="open-player-sheet" data-player-id="${esc(p.playerId)}" data-initial-tab="health">${esc(p.name)}</span> (${esc(p.playBadgeLabel)})`
                : `${esc(p.name)} (${esc(p.playBadgeLabel)})`
            )
            .join(' • ')}
        </div>
        <button type="button" class="btn-ghost" data-action="set-season-sub" data-season-sub="health">
          ${iconSvg('heartPulse', 13)}
          <span>Full 49ers Health</span>
        </button>
      </div>
    </section>

    ${renderMatchupTeamStatsComparison(appData, matchupStatsUnit)}

    ${(() => {
      const seenCoachJargon = new Set();
      const aiDatePt = um.aiMatchupMeta?.datePt || '';
      return `
        <section class="card" id="coachingMatchupSection" data-coaching-matchup-card>
          <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px;flex-wrap:wrap;margin-bottom:6px">
            <div style="min-width:0;flex:1">
              <div class="card-eyebrow">Coaching Matchup • Coordinator Tendencies</div>
              <h3 class="card-title">${escJargon(um.coachingMatchup?.headline, { maxTerms: 12, maxPlayers: 0, seenKeys: seenCoachJargon })}</h3>
            </div>
            ${aiDatePt ? `<span class="badge badge-gold mono" data-daily-ai-matchup-badge title="Refreshed daily (${esc(aiDatePt)} PT)">Daily AI Brief</span>` : ''}
          </div>
          <p class="coaching-thesis-copy">${escJargon(um.coachingMatchup?.summary, { maxTerms: 20, maxPlayers: 0, seenKeys: seenCoachJargon })}</p>
          <ul class="brief-bullets coaching-bullets">
            ${(um.coachingMatchup?.bullets || []).map(b => formatCoachingBulletHtml(b, seenCoachJargon)).join('')}
          </ul>
        </section>
      `;
    })()}

    <section class="card" id="keyMatchupsSection" data-key-matchups-card>
      <div class="card-eyebrow">1-on-1 &amp; Trench Battles</div>
      <h3 class="card-title" style="margin-bottom:8px">Key Matchups</h3>
      <div style="display:flex;flex-direction:column;gap:9px">
        ${(um.keyMatchupsMatrix || [])
          .map(m => {
            const cardJargonSeen = new Set();
            const cardPlayerSeen = new Set();
            const sfStars = resolveKeyMatchupSfPlayers(m, appData?.roster?.players || []);
            const rawTell = String(m.filmTell || '')
              .replace(/^(?:broadcast\s+tell|film\s+tell|tv\s+tell)\s*:\s*/i, '')
              .trim();
            return `
          <div class="subcard-panel key-matchup-card" data-key-matchup-item>
            ${m.phaseTag ? `<div class="key-matchup-phase mono">${esc(m.phaseTag)}</div>` : ''}
            <div class="key-matchup-head">
              <div class="key-matchup-title-row">
                ${sfStars.length > 0 ? renderAvatarStackHtml(sfStars, 24, 3) : ''}
                <strong class="key-matchup-title">${escJargon(m.unitMatchup, {
                  maxTerms: 10,
                  maxPlayers: 6,
                  seenKeys: cardJargonSeen,
                  seenPlayerIds: cardPlayerSeen
                })}</strong>
              </div>
              <span class="badge ${matchupAdvantageBadgeClass(m.advantage)} mono key-matchup-adv">${esc(m.advantage)}</span>
            </div>
            ${renderKeyMatchupStatStripHtml(m.statComparison)}
            <div class="key-matchup-detail">${escJargon(m.tacticalDetail || '', {
              maxTerms: 16,
              maxPlayers: 8,
              seenKeys: cardJargonSeen,
              seenPlayerIds: cardPlayerSeen
            })}</div>
            ${
              rawTell
                ? `<div class="matchup-film-tell" data-matchup-film-tell>
                    <span class="film-tell-label mono">Broadcast Tell</span>
                    <span>${escJargon(rawTell, {
                      maxTerms: 12,
                      maxPlayers: 6,
                      seenKeys: cardJargonSeen,
                      seenPlayerIds: cardPlayerSeen
                    })}</span>
                  </div>`
                : ''
            }
          </div>
        `;
          })
          .join('')}
      </div>
    </section>

    <section class="card">
      <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:8px">
        <h3 class="card-title">Recent Meetings (${esc(um.franchiseHistory?.recentRecord)})</h3>
        <a href="${esc(um.franchiseHistory?.pfrQueryUrl || 'https://www.pro-football-reference.com/teams/sfo/head-to-head.htm')}" target="_blank" rel="noopener noreferrer" class="source-chip-link">
          <span>PFR Box Scores</span>${iconSvg('externalLink', 11)}
        </a>
      </div>
      <div class="table-scroll">
        <table class="data-table mono">
          <thead><tr><th>Season</th><th>Date</th><th>Site</th><th>Result</th></tr></thead>
          <tbody>
            ${(um.franchiseHistory?.recentGames || [])
              .map(g => {
                const safeBoxUrl = sanitizeExternalUrl(g.boxscoreUrl, null);
                const resInner = `<strong>${g.sfWon ? 'W' : 'L'}</strong> ${esc(g.scoreDisplay)}${g.overtime ? ' (OT)' : ''}`;
                return `
              <tr>
                <td>${g.season}</td>
                <td>${esc(g.date)}</td>
                <td>${esc(g.venue)}</td>
                <td style="color:${g.sfWon ? 'var(--emerald)' : 'var(--crimson)'}">
                  ${
                    safeBoxUrl
                      ? `<a href="${esc(safeBoxUrl)}" target="_blank" rel="noopener noreferrer" class="ext-link" style="color:inherit">${resInner} ${iconSvg('externalLink', 10)}</a>`
                      : resInner
                  }
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

function formatIrCardBadgeAndSubtitle(ir, seasonYear = 2026, { isOpponent = false } = {}) {
  const projRaw =
    typeof ir.projectedReturnWeek === 'number'
      ? `Est. Week ${ir.projectedReturnWeek}`
      : String(ir.projectedReturnWeek || 'TBD').trim();
  const isSeasonEnd = Boolean(ir.isSeasonEnding) || /^out for (?:the )?(?:\d{4} )?season$/i.test(projRaw);
  const cleanByeNote = isOpponent
    ? String(ir.byeWeekNote || '')
        .replace(/\b(?:[A-Z]{2,3}\s+)?Bye\s+Week\s+\d+\s*[•·-]\s*/gi, '')
        .replace(/Excludes\s+[A-Z]{2,3}\s+Week\s+\d+\s+Bye\s+under\s+/gi, '')
        .trim()
    : String(ir.byeWeekNote || '').trim();

  if (isSeasonEnd) {
    return {
      badgeClass: 'badge-danger',
      badgeText: `Out for ${seasonYear} Season`,
      subtitleHtml: `${esc(ir.status || 'Season-Ending IR')} • ${esc(cleanByeNote || `Ineligible to return in ${seasonYear}`)}`
    };
  }

  if (ir.isPracticeWindowOpen) {
    const badgeLabel = /^est\.|^week\s/i.test(projRaw) ? projRaw : `Est. Return: ${projRaw}`;
    return {
      badgeClass: 'badge-positive',
      badgeText: badgeLabel,
      subtitleHtml: `${esc(ir.status || 'IR — 21-Day Window Open')}${
        ir.earliestEligibleWeek ? ` • Earliest Eligible: Wk ${ir.earliestEligibleWeek}` : ''
      }${cleanByeNote ? ` (${esc(cleanByeNote)})` : ''}`
    };
  }

  if (!ir.earliestEligibleWeek) {
    return {
      badgeClass: 'badge-neutral',
      badgeText: projRaw,
      subtitleHtml: `${esc(ir.status || 'Reserve')}${cleanByeNote ? ` • ${esc(cleanByeNote)}` : ''}`
    };
  }

  const isTbd = /^tbd\b/i.test(projRaw);
  const badgeText = isTbd
    ? projRaw
    : /^est\.|^week\s/i.test(projRaw)
      ? projRaw
      : `Est. Return: ${projRaw}`;

  return {
    badgeClass: isTbd ? 'badge-neutral' : 'badge-gold',
    badgeText,
    subtitleHtml: `${esc(ir.status || 'Injured Reserve')} • Earliest Eligible: Wk ${ir.earliestEligibleWeek}${
      cleanByeNote ? ` (${esc(cleanByeNote)})` : ''
    }`
  };
}

function renderTeamHealthAndIr(appData, userPrefs = null, reportersById = null) {
  const h = appData?.health || {};
  const sfGameDay = resolveTeamGameDayModel(appData, { is49ers: true });
  const rawSfReport = h.practiceReport || [];
  const sfReport = sfGameDay?.isActive
    ? resolveGameDayInjuryRows(rawSfReport, sfGameDay)
    : rawSfReport;

  const injuryNewsEntries = buildTeamInjuryNewsFeed(appData, {
    userPrefs,
    reportersById,
    injuryRowsOverride: sfReport
  });
  const directPosts = Array.isArray(appData?.news?.rawStream) ? appData.news.rawStream : [];

  return `
    ${renderGameDayRosterCard(sfGameDay, {
      is49ers: true,
      asSubcard: false,
      teamName: '49ers',
      teamAbbr: 'SF',
      teamLogoUrl: appData?.scheduleMatchup?.upcomingMatchup?.sfLogoUrl
    })}

    <section class="card" id="weeklyInjuryReportCard">
      <div class="card-header">
        <div class="card-header-left">
          <div class="card-icon-badge" aria-hidden="true">${iconSvg('heartPulse', 18)}</div>
          <div class="card-title-group">
            <div class="card-eyebrow">${jargonTerm('DNP', 'dnp')} · ${jargonTerm('LP', 'lp')} · ${jargonTerm('FP', 'fp')}</div>
            <h2 class="card-title">Week ${h.week || 9} Injury Report</h2>
          </div>
        </div>
        <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap">
          <a href="${esc(h.sourceUrl || 'https://www.49ers.com/team/injury-report/')}" target="_blank" rel="noopener noreferrer" class="source-chip-link">
            <span>49ers.com</span>${iconSvg('externalLink', 11)}
          </a>
          <a href="${esc(h.espnInjuryUrl || 'https://www.espn.com/nfl/injuries')}" target="_blank" rel="noopener noreferrer" class="source-chip-link">
            <span>ESPN</span>${iconSvg('externalLink', 11)}
          </a>
          <span class="badge badge-gold mono">${jargonTerm('IR', 'ir')} Returns Left: ${h.remainingIrDesignations}/${h.maxRegularSeasonIrDesignations}</span>
        </div>
      </div>

      <div class="table-scroll health-table-scroll" data-health-table="sf">
        <table class="data-table sticky-col-table narrow-health-table">
          <thead>
            <tr>
              <th class="sticky-first-col">Player</th>
              <th>Injury</th>
              <th class="mono">W / T / F</th>
              <th>Play Likelihood</th>
            </tr>
          </thead>
          <tbody>
            ${sfReport
              .map(
                p => `
              <tr style="cursor:pointer" data-action="open-player-sheet" data-player-id="${esc(p.playerId)}" data-initial-tab="health">
                <td class="sticky-first-col">
                  <div class="sticky-player-cell">
                    ${renderPlayerAvatarHtml(p, 26)}
                    <div class="sticky-player-meta">
                      <div class="sticky-player-name"><strong>${esc(p.name)}</strong></div>
                      <div class="sticky-player-sub">${esc(p.position)}${p.jersey != null ? ` #${p.jersey}` : ''}</div>
                    </div>
                  </div>
                </td>
                <td>${esc(p.injuryType)}</td>
                <td class="mono">${esc(formatPracCell(p.wed))} / ${esc(formatPracCell(p.thu))} / ${esc(formatPracCell(p.fri))}</td>
                <td><span class="badge ${playProbBadgeClass(p.playProbabilityPct)} mono">${esc(formatCompactPlayBadge(p.playBadgeLabel))}</span></td>
              </tr>
            `
              )
              .join('')}
          </tbody>
        </table>
      </div>
    </section>

    <section class="card" id="teamInjuryNewsCard" data-health-injury-news>
      <div class="card-header">
        <div class="card-header-left">
          <div class="card-icon-badge compact" aria-hidden="true">${iconSvg('news', 16)}</div>
          <div class="card-title-group">
            <h3 class="card-title">Injury News (${injuryNewsEntries.length})</h3>
          </div>
        </div>
        <span class="mono" style="font-size:11px;color:var(--text-muted)">Lowest → Highest Play %</span>
      </div>
      ${
        injuryNewsEntries.length > 0
          ? `<div class="health-injury-news-list">
              ${injuryNewsEntries
                .map(
                  entry => `
                <div class="health-injury-news-entry" data-injury-news-player="${esc(entry.playerId)}" data-play-prob="${entry.playProbabilityPct}">
                  <button type="button" class="health-injury-player-head"
                          data-action="open-player-sheet"
                          data-player-id="${esc(entry.playerId)}"
                          data-initial-tab="health"
                          aria-label="Open ${esc(entry.name)} Health and Priors">
                    <span class="health-injury-player-ident">
                      ${renderPlayerAvatarHtml(entry, 34, { showJerseyBadge: entry.jersey != null })}
                      <span class="health-injury-player-label">
                        <strong>${esc(entry.name)} <span style="color:var(--gold-bright)">(${esc(entry.position)}${entry.injuryType ? ` • ${esc(entry.injuryType)}` : ''})</span></strong>
                      </span>
                    </span>
                    <span class="badge ${playProbBadgeClass(entry.playProbabilityPct)} mono">${esc(entry.playBadgeLabel)}</span>
                  </button>
                  ${renderInjuryNewsItemCardHtml(entry.topItem, {
                    playerName: entry.name,
                    directPosts,
                    excludePlayerId: entry.playerId,
                    outerClassName: 'health-injury-news-card'
                  })}
                </div>
              `
                )
                .join('')}
            </div>`
          : `<div style="font-size:12.5px;color:var(--text-muted)">No active injury designations on the weekly report.</div>`
      }
    </section>

    <section class="card" id="injuredReserveCard">
      <div class="card-eyebrow">Week ${h.byeWeek || 8} Bye Excluded</div>
      <h3 class="card-title" style="margin-bottom:8px">Injured Reserve (${(h.irAndReserveTracker || []).length})</h3>
      <div style="display:flex;flex-direction:column;gap:8px">
        ${(h.irAndReserveTracker || [])
          .map(ir => {
            const meta = formatIrCardBadgeAndSubtitle(ir, appData?.meta?.seasonYear || 2026);
            const showInj =
              ir.injuryType &&
              ir.injuryType.toLowerCase() !== String(ir.status || '').toLowerCase() &&
              ir.injuryType !== 'Undisclosed';
            return `
          <div class="subcard-panel" style="cursor:pointer"
               data-action="open-player-sheet" data-player-id="${esc(ir.playerId)}" data-initial-tab="health">
            <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap">
              <div style="display:flex;align-items:center;gap:8px;min-width:0">
                ${renderPlayerAvatarHtml(ir, 34, { showJerseyBadge: ir.jersey != null })}
                <strong>${esc(ir.name)} <span style="color:var(--gold-bright)">(${esc(ir.position)}${showInj ? ` • ${esc(ir.injuryType)}` : ''})</span></strong>
              </div>
              <span class="badge ${meta.badgeClass} mono">${esc(meta.badgeText)}</span>
            </div>
            <div style="font-size:11.5px;color:var(--text-muted);margin-top:2px">
              ${meta.subtitleHtml}
            </div>
            ${ir.beatNote ? `<div style="font-size:12px;color:var(--text-secondary);margin-top:4px">${escJargon(ir.beatNote, { excludePlayerId: ir.playerId })}</div>` : ''}
          </div>
        `;
          })
          .join('')}
      </div>
    </section>
  `;
}

const COMPACT_STAT_LABELS = {
  total_off_epa_game: 'Total Offensive EPA / Gm',
  passing_epa_game: 'Passing EPA / Game',
  passing_cpoe: 'Completion CPOE',
  rushing_epa_game: 'Rushing EPA / Game',
  yards_per_pass_att: 'Net Yards / Pass Att',
  sack_rate_allowed: 'Sacks Allowed Rate',
  explosive_plays_game: 'Explosive Plays / Game',
  rush_yds_game: 'Rushing Yards / Game',
  def_sacks_game: 'Defensive Sacks / Game',
  def_tfl_game: 'Tackles For Loss (TFL) / Gm',
  def_takeaways_game: 'Def. Takeaways / Game'
};

function renderTeamStatsRowsHtml(rows = []) {
  return rows
    .map(r => {
      const metricLabel = COMPACT_STAT_LABELS[r.key] || r.label;
      return `
        <tr>
          <td><strong>${escJargon(metricLabel)}</strong></td>
          <td class="mono num-col"><strong>${esc(r.displayValue)}</strong></td>
          <td class="rank-col">${renderTeamRankTriggerHtml(r.rank, r.key, { showMeter: true })}</td>
          <td class="mono num-col" style="color:var(--text-muted)">${esc(r.leagueAvgDisplay)}</td>
        </tr>
      `;
    })
    .join('');
}

function renderTeamStatsAndPower(appData) {
  const ts = appData?.scheduleMatchup?.teamStats;
  const units = ts?.units || [];
  const ranks = appData?.scheduleMatchup?.teamStatRankings || [];
  const pwr = appData?.scheduleMatchup?.powerRankings || {};
  const seasonYear = Number(appData?.meta?.seasonYear) || 2026;
  const pfrSeasonUrl = buildPfrTeamSeasonUrl('SF', seasonYear);

  const unitCardsHtml =
    units.length > 0
      ? units
          .map((u, idx) => {
            const expandedCount = (u.expandedGroups || []).reduce((acc, g) => acc + (g.rows?.length || 0), 0);
            const overallDisp = String(u.overall?.displayValue || '—').replace(/\s*idx\b/gi, '%');
            const overallAvgDisp = String(u.overall?.leagueAvgDisplay || '50.0%').replace(/\s*idx\b/gi, '%');
            return `
        <section class="card team-stats-card" ${idx === 0 ? 'id="teamStatsRankingsCard"' : ''} data-team-stats-unit="${esc(u.id)}">
          <div class="card-header team-stats-header">
            <div class="card-header-left">
              <div class="card-icon-badge compact" aria-hidden="true">${iconSvg(u.icon || 'season', 16)}</div>
              <div class="card-title-group">
                <h2 class="card-title">${esc(u.title)}</h2>
              </div>
            </div>
          </div>

          <div class="table-scroll">
            <table class="data-table team-stats-table">
              <thead>
                <tr>
                  <th>Metric</th>
                  <th class="mono num-col">49ers</th>
                  <th class="mono rank-col">Rank</th>
                  <th class="mono num-col">NFL Avg</th>
                </tr>
                <tr class="unit-overall-banner overall-stat-row" data-overall-unit="${esc(u.id)}">
                  <td>
                    <div class="unit-overall-inline">
                      <span class="unit-overall-heading">Overall Rank</span>
                      <span class="unit-overall-sub mono overall-how-wrap">${jargonTerm('Composite Score', u.jargonKey)}</span>
                    </div>
                  </td>
                  <td class="mono num-col overall-val-cell" data-overall-col="sf-val"><strong>${esc(overallDisp)}</strong></td>
                  <td class="rank-col overall-rank-cell" data-overall-col="sf-rank">
                    <div class="unit-overall-right">${renderTeamRankTriggerHtml(u.overall?.rank || 16, u.overall?.key, { showMeter: true, large: true })}</div>
                  </td>
                  <td class="mono num-col overall-val-cell overall-avg-cell" data-overall-col="nfl-avg">${esc(overallAvgDisp)}</td>
                </tr>
              </thead>
              <tbody>
                ${renderTeamStatsRowsHtml(u.coreRows || [])}
              </tbody>
            </table>
          </div>

          ${
            expandedCount > 0
              ? `
            <details class="stats-expand-details" data-stats-expander="${esc(u.id)}">
              <summary class="stats-expand-summary">
                <span>Detailed ${esc(u.shortLabel)} Metrics (${expandedCount})</span>
                <span class="mono stats-expand-hint">Expand</span>
              </summary>
              <div class="stats-expand-body">
                ${(u.expandedGroups || [])
                  .map(
                    grp => `
                  <div class="stats-subgroup-block">
                    <div class="sub-label stats-subgroup-title">${esc(grp.groupTitle)}</div>
                    <div class="table-scroll">
                      <table class="data-table team-stats-table">
                        <tbody>
                          ${renderTeamStatsRowsHtml(grp.rows || [])}
                        </tbody>
                      </table>
                    </div>
                  </div>
                `
                  )
                  .join('')}
              </div>
            </details>
          `
              : ''
          }

          ${
            idx === units.length - 1
              ? `
            <div class="source-link-strip team-stats-sources">
              <a href="https://github.com/nflverse/nflverse-data" target="_blank" rel="noopener noreferrer" class="source-chip-link"><span>nflverse</span>${iconSvg('externalLink', 11)}</a>
              <a href="${esc(pfrSeasonUrl)}" target="_blank" rel="noopener noreferrer" class="source-chip-link"><span>PFR 49ers</span>${iconSvg('externalLink', 11)}</a>
              <a href="https://rbsdm.com/stats/stats/" target="_blank" rel="noopener noreferrer" class="source-chip-link"><span>RBSDM EPA</span>${iconSvg('externalLink', 11)}</a>
            </div>
          `
              : ''
          }
        </section>
      `;
          })
          .join('')
      : `
    <section class="card team-stats-card" id="teamStatsRankingsCard">
      <div class="card-header team-stats-header">
        <div class="card-header-left">
          <div class="card-icon-badge compact" aria-hidden="true">${iconSvg('season', 16)}</div>
          <div class="card-title-group">
            <div class="card-eyebrow">nflverse ${seasonYear} • 32-Team Benchmarks</div>
            <h2 class="card-title">49ers Team Stats &amp; NFL Rankings</h2>
          </div>
        </div>
      </div>

      <div class="table-scroll">
        <table class="data-table team-stats-table">
          <thead>
            <tr>
              <th>Metric</th>
              <th class="mono num-col">49ers</th>
              <th class="mono rank-col">Rank</th>
              <th class="mono num-col">NFL Avg</th>
            </tr>
          </thead>
          <tbody>
            ${renderTeamStatsRowsHtml(ranks)}
          </tbody>
        </table>
      </div>

      <div class="source-link-strip team-stats-sources">
        <a href="https://github.com/nflverse/nflverse-data" target="_blank" rel="noopener noreferrer" class="source-chip-link"><span>nflverse</span>${iconSvg('externalLink', 11)}</a>
        <a href="${esc(pfrSeasonUrl)}" target="_blank" rel="noopener noreferrer" class="source-chip-link"><span>PFR 49ers</span>${iconSvg('externalLink', 11)}</a>
        <a href="https://rbsdm.com/stats/stats/" target="_blank" rel="noopener noreferrer" class="source-chip-link"><span>RBSDM EPA</span>${iconSvg('externalLink', 11)}</a>
      </div>
    </section>
  `;

  return `
    ${unitCardsHtml}

    <section class="card">
      <div class="card-header">
        <div class="card-title-group">
          <div class="card-eyebrow">${esc(String(pwr.weekLabel || '').replace(/\s+Consensus$/i, ''))}</div>
          <h2 class="card-title">Power Rankings</h2>
        </div>
        <span class="badge badge-positive mono" style="font-size:13px">#${pwr.consensusRank} Consensus</span>
      </div>

      <p style="margin:0 0 10px;font-size:13px;color:var(--text-secondary)">${escJargon(pwr.synthesizedTakeaway)}</p>

      <div style="display:flex;flex-direction:column;gap:8px">
        ${(pwr.sources || [])
          .map(
            s => `
          <div class="subcard-panel">
            <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;margin-bottom:3px">
              ${
                sanitizeExternalUrl(s.url, null)
                  ? `<a href="${esc(sanitizeExternalUrl(s.url))}" target="_blank" rel="noopener noreferrer" class="ext-link"><strong>${esc(s.outlet)}</strong> ${iconSvg('externalLink', 11)}</a>`
                  : `<strong>${esc(s.outlet)}</strong>`
              }
              <span class="badge badge-gold mono">Rank #${s.rank} (${esc(s.delta)})</span>
            </div>
            <div style="font-size:12.5px;color:var(--text-secondary)">${escJargon(s.blurb)}</div>
          </div>
        `
          )
          .join('')}
      </div>
    </section>
  `;
}

function renderTradeWindow(appData) {
  const tw = appData?.seasonal?.tradeWarRoom || {};
  const { recentTrades, archivedTrades } = partitionCompletedTradesByWindow(
    tw.completed2026Moves || [],
    appData?.meta?.updatedAt || Date.now(),
    30
  );

  return `
    <section class="card temporal-highlight">
      <div class="card-header">
        <div class="card-header-left">
          <div class="card-icon-badge temporal" aria-hidden="true">${iconSvg('trade', 18)}</div>
          <div class="card-title-group">
            <div class="card-eyebrow">${esc(tw.deadlineDisplay)}</div>
            <h2 class="card-title">Trade Window</h2>
          </div>
        </div>
        <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap">
          <a href="${esc(tw.capSourceUrl || 'https://overthecap.com/salary-cap/san-francisco-49ers')}" target="_blank" rel="noopener noreferrer" class="source-chip-link"><span>OverTheCap</span>${iconSvg('externalLink', 11)}</a>
          <a href="${esc(tw.transactionsUrl || 'https://www.espn.com/nfl/transactions')}" target="_blank" rel="noopener noreferrer" class="source-chip-link"><span>Transactions</span>${iconSvg('externalLink', 11)}</a>
          <span class="badge badge-positive mono">${formatCompactDollars(tw.availableGrossCap)} Gross Cap</span>
        </div>
      </div>

      ${
        Array.isArray(tw.purchasingPower) && tw.purchasingPower.length > 0
          ? `
        <div class="sub-label" style="margin-bottom:6px">Cap &amp; Draft Constraints</div>
        <div style="display:flex;flex-direction:column;gap:6px;margin-bottom:12px">
          ${tw.purchasingPower
            .map(
              pp => `
            <div class="subcard-panel" style="font-size:12px">
              <div style="display:flex;justify-content:space-between;align-items:center;gap:6px;flex-wrap:wrap;margin-bottom:2px">
                <strong>${esc(pp.metric)}</strong>
                <span class="badge ${String(pp.figure || '').startsWith('-') ? 'badge-warning' : 'badge-gold'} mono">${esc(pp.figure)}</span>
              </div>
              <div style="color:var(--text-secondary)">${escJargon(pp.strategicImpact || '')}</div>
            </div>
          `
            )
            .join('')}
        </div>
      `
          : ''
      }

      <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:6px">
        <div class="sub-label" style="margin:0">Completed Trades (Last 30 Days)</div>
        ${
          archivedTrades.length > 0
            ? `<button type="button" class="btn-ghost" data-action="open-archive" style="font-size:11.5px;padding:4px 9px">
                ${iconSvg('archive', 12)}
                <span>${archivedTrades.length} Older Trade${archivedTrades.length > 1 ? 's' : ''} (&gt;30d) in Archive</span>
              </button>`
            : ''
        }
      </div>
      <div style="display:flex;flex-direction:column;gap:7px;margin-bottom:12px" id="recentCompletedTradesList">
        ${
          recentTrades.length === 0
            ? `<div class="subcard-panel" style="font-size:12.5px;color:var(--text-muted)">No completed 49ers trades within the past 30 days. Older acquisitions are stored in the Archive.</div>`
            : recentTrades
                .map(
                  m => `
          <div class="subcard-panel" style="border-color:var(--gold-border)">
            <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap">
              <div style="display:flex;align-items:center;gap:9px;min-width:0">
                <span style="cursor:${m.playerId ? 'pointer' : 'default'};display:inline-flex" ${m.playerId ? `data-action="open-player-sheet" data-player-id="${esc(m.playerId)}"` : ''}>
                  ${renderPlayerAvatarHtml({ name: m.player, jersey: m.jersey, headshotUrl: m.headshotUrl }, 36, { showJerseyBadge: m.jersey != null })}
                </span>
                <div style="min-width:0">
                  <div style="display:flex;align-items:center;gap:5px;flex-wrap:wrap">
                    ${
                      m.playerId
                        ? `<span class="inline-player-link" role="button" tabindex="0" data-action="open-player-sheet" data-player-id="${esc(m.playerId)}">${esc(m.player)} (${esc(m.position)})</span>`
                        : `<strong>${esc(m.player)} (${esc(m.position)})</strong>`
                    }
                    <span style="color:var(--text-muted)">←</span>
                    ${
                      m.acquiredFrom
                        ? `<a href="${esc(buildEspnNflTeamUrl(m.acquiredFrom))}" target="_blank" rel="noopener noreferrer" class="ext-link" style="display:inline-flex;align-items:center;gap:4px;color:inherit">${renderTeamLogoHtml(m.acquiredFrom, m.acquiredFromLogoUrl, 18)}<strong>${esc(m.acquiredFrom)}</strong></a>`
                        : ''
                    }
                    ${
                      m.sourceUrl
                        ? `<a href="${esc(m.sourceUrl)}" target="_blank" rel="noopener noreferrer" class="ext-link" style="font-size:11.5px;margin-left:4px">Source ${iconSvg('externalLink', 10)}</a>`
                        : ''
                    }
                  </div>
                  <div style="font-size:11.5px;color:var(--gold-bright)">${esc(m.timing)} • Cost: ${esc(m.costSummary)}</div>
                </div>
              </div>
              <span class="badge badge-positive mono">Grade ${esc(m.schemeGrade)}</span>
            </div>
            <div style="font-size:12.5px;color:var(--text-secondary);margin-top:5px">${escJargon(m.analysis, { excludePlayerId: m.playerId })}</div>
          </div>
        `
                )
                .join('')
        }
      </div>

      <div class="sub-label" style="margin-bottom:6px">Team Needs</div>
      <div style="display:flex;flex-direction:column;gap:7px">
        ${(tw.topNeeds || [])
          .map(
            n => `
          <div class="subcard-panel">
            <strong>#${n.rank} ${esc(n.positionGroup)}</strong> <span class="badge badge-warning">${esc(n.urgency)}</span>
            <div style="font-size:12px;color:var(--text-secondary);margin-top:3px">${escJargon(n.epaContext)}</div>
          </div>
        `
          )
          .join('')}
      </div>
    </section>

    <section class="card">
      <div class="card-eyebrow">${Math.max(1, Math.min(18, 18 - (Number(appData?.meta?.currentWeek) || 9)))}/18ths Prorated Cap • ${jargonTerm('Rich Hill', 'rich_hill')} Pick Value</div>
      <h3 class="card-title" style="margin-bottom:8px">Trade Targets</h3>
      <div style="display:flex;flex-direction:column;gap:8px">
        ${(tw.realisticTargets || [])
          .map(
            t => `
          <div class="subcard-panel">
            <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap">
              <div style="display:flex;align-items:center;gap:9px;min-width:0">
                ${renderPlayerAvatarHtml({ name: t.name, jersey: t.jersey, headshotUrl: t.headshotUrl }, 36)}
                <div style="min-width:0">
                  <div style="display:flex;align-items:center;gap:5px;flex-wrap:wrap">
                    ${
                      t.sourceUrl
                        ? `<a href="${esc(t.sourceUrl)}" target="_blank" rel="noopener noreferrer" class="ext-link" title="Open OverTheCap Contract"><strong>${esc(t.name)} (${esc(t.position)})</strong> ${iconSvg('externalLink', 10)}</a>`
                        : `<strong>${esc(t.name)} (${esc(t.position)})</strong>`
                    }
                    ${t.teamAbbr ? renderTeamLogoHtml(t.teamAbbr, t.teamLogoUrl, 17) : ''}
                    ${
                      t.currentTeam
                        ? t.teamAbbr
                          ? `<a href="${esc(buildEspnNflTeamUrl(t.teamAbbr))}" target="_blank" rel="noopener noreferrer" class="ext-link" style="font-size:11.5px;color:var(--gold-bright);font-weight:700">${esc(t.currentTeam)}</a>`
                          : `<span style="font-size:11.5px;color:var(--gold-bright);font-weight:700">${esc(t.currentTeam)}</span>`
                        : ''
                    }
                  </div>
                  <div style="font-size:11.5px;color:var(--emerald)">Est. Cost: ${esc(t.projectedPickCost)}${t.cap2027Impact ? ` • <span style="color:${String(t.cap2027Impact).includes('⚠️') ? 'var(--amber)' : 'var(--text-secondary)'}">2027 Cap: ${esc(t.cap2027Impact)}</span>` : ''}</div>
                </div>
              </div>
              <div style="min-width:128px;text-align:right">
                <span class="badge badge-gold mono">Fit ${t.fitScore}/100 • Cap ${formatCompactDollars(t.prorated2026CapCharge)}</span>
                ${renderMiniMeterHtml(t.fitScore, 'gold')}
              </div>
            </div>
            ${t.sellerIncentive ? `<div style="font-size:11.5px;color:var(--text-muted);margin-top:4px"><strong>Seller Context:</strong> ${escJargon(t.sellerIncentive)}</div>` : ''}
            <div style="font-size:12.5px;color:var(--text-secondary);margin-top:4px">${escJargon(t.fitBreakdown)}</div>
          </div>
        `
          )
          .join('')}
      </div>
    </section>

    ${
      Array.isArray(tw.pitfallsToAvoid) && tw.pitfallsToAvoid.length > 0
        ? `
      <section class="card">
        <h3 class="card-title" style="margin-bottom:8px">Targets to Avoid</h3>
        <div style="display:flex;flex-direction:column;gap:8px">
          ${tw.pitfallsToAvoid
            .map(
              p => `
            <div class="subcard-panel" style="border-color:rgba(220,38,38,0.28)">
              <div style="display:flex;justify-content:space-between;align-items:center;gap:6px;flex-wrap:wrap;margin-bottom:3px">
                <strong>${esc(p.trap)}</strong>
                <span class="badge badge-danger">Avoid</span>
              </div>
              ${
                Array.isArray(p.exampleLinks) && p.exampleLinks.length > 0
                  ? `<div style="font-size:11.5px;color:var(--gold-bright);margin-bottom:3px"><strong>Examples:</strong> ${p.exampleLinks
                      .map(el => {
                        const safeEx = sanitizeExternalUrl(el.url, null);
                        return safeEx
                          ? `<a href="${esc(safeEx)}" target="_blank" rel="noopener noreferrer" class="ext-link" style="color:var(--gold-bright)">${esc(el.label)} ${iconSvg('externalLink', 9)}</a>`
                          : esc(el.label);
                      })
                      .join(', ')}</div>`
                  : p.examples
                    ? `<div style="font-size:11.5px;color:var(--gold-bright);margin-bottom:3px"><strong>Examples:</strong> ${esc(p.examples)}</div>`
                    : ''
              }
              <div style="font-size:12.5px;color:var(--text-secondary)">${escJargon(p.whyAvoid)}</div>
            </div>
          `
            )
            .join('')}
        </div>
      </section>
    `
        : ''
    }

    <section class="card">
      <h3 class="card-title" style="margin-bottom:8px">Trade Intel &amp; Rumors</h3>
      <div style="display:flex;flex-direction:column;gap:8px">
        ${(tw.tieredRumors || [])
          .map(
            r => `
          <div class="subcard-panel">
            <div style="display:flex;justify-content:space-between;align-items:center;gap:6px;flex-wrap:wrap;margin-bottom:3px">
              <span class="badge ${r.tier.includes('Tier 1') ? 'badge-positive' : 'badge-gold'}">${esc(r.tier)}</span>
              <span style="font-size:11px;color:var(--text-muted)">${renderReporterSourceLinksHtml(r.sources, r.sourceUrl)}</span>
            </div>
            <div style="font-size:12.5px">${escJargon(r.summary)}</div>
          </div>
        `
          )
          .join('')}
      </div>
    </section>
  `;
}

function renderRootingGameRowHtml(g, forcedWinners) {
  const picked = forcedWinners?.[g.gameId] || null;
  return `
    <div class="scenario-game-row">
      <div style="min-width:0">
        <div style="font-weight:700;font-size:13px">
          ${esc(g.matchupLabel)}
          ${g.is49ersGame ? `<span class="badge badge-scarlet">49ers</span>` : ''}
        </div>
        <div style="font-size:11.5px;color:var(--text-secondary)">
          Root for <strong style="color:var(--emerald)">${esc(g.rootForTeam)}</strong> •
          <span class="mono">+${g.primaryDeltaPct}% ${esc(g.primaryMetric)} swing</span>${g.leverageTag ? ` <span style="color:var(--text-muted)">(${esc(g.leverageTag)})</span>` : ''}
        </div>
      </div>
      <div class="scenario-toggle-pair">
        <button type="button"
                class="team-pick-btn mono ${picked === 'AWAY' ? 'selected' : ''} ${g.recommendedWinner === 'AWAY' ? 'recommended' : ''}"
                style="display:inline-flex;align-items:center;gap:5px"
                data-action="toggle-playoff-winner" data-game-id="${esc(g.gameId)}" data-side="AWAY">
          ${renderTeamLogoHtml(g.away, g.awayLogoUrl, 16)}
          <span>${esc(g.away)}</span>
        </button>
        <button type="button"
                class="team-pick-btn mono ${picked === 'HOME' ? 'selected' : ''} ${g.recommendedWinner === 'HOME' ? 'recommended' : ''}"
                style="display:inline-flex;align-items:center;gap:5px"
                data-action="toggle-playoff-winner" data-game-id="${esc(g.gameId)}" data-side="HOME">
          ${renderTeamLogoHtml(g.home, g.homeLogoUrl, 16)}
          <span>${esc(g.home)}</span>
        </button>
      </div>
    </div>
  `;
}

function renderPlayoffSimulator(appData, mcSimResult, forcedWinners, expandedRootingWeeks = null) {
  const pp = appData?.seasonal?.playoffPicture || {};
  const sim = mcSimResult || pp.baselineSimulation || {};
  const sf = sim.sfOdds || {};
  const seeds = sf.seedDistribution || {};
  const overrideCount = Object.keys(forcedWinners || {}).length;

  const byWeek = new Map();
  for (const g of pp.rootingLeverage || []) {
    const wk = Number(g.week || 0);
    if (!byWeek.has(wk)) byWeek.set(wk, []);
    byWeek.get(wk).push(g);
  }
  const sortedRootingWeeks = [...byWeek.keys()].sort((a, b) => a - b);
  const rootingWeekCardsHtml = sortedRootingWeeks
    .map((wk, idx) => {
      const games = byWeek.get(wk) || [];
      const rowsHtml = games.map(g => renderRootingGameRowHtml(g, forcedWinners)).join('');
      if (idx === 0) {
        return `
          <div class="subcard-panel rooting-week-card" data-rooting-week="${wk}">
            <div class="rooting-week-header">
              <strong style="font-size:13px;color:var(--gold-bright)">Week ${wk}</strong>
              <span class="mono" style="font-size:11px;color:var(--text-muted)">${games.length} ${games.length === 1 ? 'game' : 'games'}</span>
            </div>
            <div style="display:flex;flex-direction:column;gap:7px;margin-top:8px">
              ${rowsHtml}
            </div>
          </div>
        `;
      }
      const isOpen = expandedRootingWeeks instanceof Set && expandedRootingWeeks.has(wk);
      return `
        <details class="subcard-panel rooting-week-card rooting-week-collapsible" data-rooting-week="${wk}" data-rooting-next-week${isOpen ? ' open' : ''}>
          <summary class="rooting-week-summary">
            <strong style="font-size:13px">Week ${wk}</strong>
            <span class="mono" style="font-size:11px;color:var(--gold-bright)">${games.length} ${games.length === 1 ? 'game' : 'games'} • Tap to expand ▾</span>
          </summary>
          <div style="display:flex;flex-direction:column;gap:7px;margin-top:8px">
            ${rowsHtml}
          </div>
        </details>
      `;
    })
    .join('');

  return `
    <section class="card temporal-highlight">
      <div class="card-header">
        <div class="card-header-left">
          <div class="card-icon-badge temporal" aria-hidden="true">${iconSvg('trophy', 18)}</div>
          <div class="card-title-group">
            <div class="card-eyebrow">10,000-Run ${jargonTerm('Monte Carlo', 'monte_carlo')}</div>
            <h2 class="card-title">Playoff Odds</h2>
          </div>
        </div>
        <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap">
          <a href="https://www.nfl.com/standings/playoff-picture" target="_blank" rel="noopener noreferrer" class="source-chip-link"><span>NFL Playoff Picture</span>${iconSvg('externalLink', 11)}</a>
          ${
            overrideCount > 0
              ? `<button type="button" class="btn-ghost" data-action="reset-playoff-overrides">${iconSvg('reset', 13)}<span>Clear (${overrideCount})</span></button>`
              : ''
          }
        </div>
      </div>

      <div class="kpi-grid">
        <div class="kpi-box">
          <div class="kpi-label">Make Playoffs</div>
          <div class="kpi-val mono" style="color:var(--emerald)">${sf.makePlayoffsPct ?? 0}%</div>
          ${renderMiniMeterHtml(sf.makePlayoffsPct ?? 0, 'emerald')}
        </div>
        <div class="kpi-box">
          <div class="kpi-label">Win NFC West</div>
          <div class="kpi-val mono" style="color:var(--gold-bright)">${sf.winDivisionPct ?? 0}%</div>
          ${renderMiniMeterHtml(sf.winDivisionPct ?? 0, 'gold')}
        </div>
        <div class="kpi-box">
          <div class="kpi-label">#1 Seed Bye</div>
          <div class="kpi-val mono">${sf.seed1ByePct ?? 0}%</div>
          ${renderMiniMeterHtml(sf.seed1ByePct ?? 0, 'scarlet')}
        </div>
      </div>

      <div class="sub-label" style="margin:10px 0 6px">NFC Seed Distribution (Proj. ${sf.projectedWins ?? 12.0} Wins)</div>
      <div style="display:flex;flex-direction:column;gap:5px">
        ${[1, 2, 3, 4, 5, 6, 7]
          .map(s => {
            const pct = seeds[s] ?? 0;
            return `
              <div class="spider-drill-row" style="grid-template-columns:98px 1fr 44px">
                <span class="mono" style="font-size:11.5px;font-weight:700;white-space:nowrap">Seed #${s}${s === 1 ? ' (Bye)' : ''}</span>
                <div class="spider-bar-track"><div class="spider-bar-fill" style="width:${Math.min(100, pct)}%;background:${s === 1 ? 'var(--emerald)' : s <= 4 ? 'var(--gold)' : 'var(--scarlet-bright)'}"></div></div>
                <span class="mono" style="font-size:12px;text-align:right">${pct}%</span>
              </div>
            `;
          })
          .join('')}
      </div>
    </section>

    <section class="card">
      <div class="card-header">
        <div class="card-title-group">
          <div class="card-eyebrow">Tap team to lock winner</div>
          <h3 class="card-title">Rooting Guide</h3>
        </div>
      </div>

      <div style="display:flex;flex-direction:column;gap:8px" data-rooting-guide-weeks>
        ${rootingWeekCardsHtml}
      </div>
    </section>

    <section class="card">
      <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:8px">
        <h3 class="card-title">Seeding Scenarios</h3>
        <a href="https://www.espn.com/nfl/standings" target="_blank" rel="noopener noreferrer" class="source-chip-link"><span>ESPN Standings</span>${iconSvg('externalLink', 11)}</a>
      </div>
      <div style="display:flex;flex-direction:column;gap:8px;margin-bottom:12px">
        ${(pp.seedPathCards || [])
          .map(
            c => `
          <div class="subcard-panel">
            <strong>${esc(c.target)}</strong>
            <div style="font-size:12.5px;color:var(--text-secondary);margin-top:3px">${escJargon(c.pathSummary)}</div>
          </div>
        `
          )
          .join('')}
      </div>

      <div class="sub-label" style="margin-bottom:6px">NFC Projected Standings</div>
      <div class="table-scroll">
        <table class="data-table mono">
          <thead><tr><th>Team</th><th>Div</th><th>Rec</th><th>Proj W</th><th>Playoffs</th><th>Div %</th><th>#1 Bye</th></tr></thead>
          <tbody>
            ${(sim.allTeamOdds || [])
              .map(
                t => `
              <tr style="${t.abbr === 'SF' ? 'background:var(--gold-soft)' : ''}">
                <td>
                  <a href="${esc(buildEspnNflTeamUrl(t.abbr))}" target="_blank" rel="noopener noreferrer" class="ext-link" style="display:inline-flex;align-items:center;gap:6px;color:inherit">
                    ${renderTeamLogoHtml(t.abbr, t.logoUrl, 20)}
                    <strong>${esc(t.abbr)}</strong>
                  </a>
                </td>
                <td style="font-family:var(--font-sans);font-size:11px">${esc(t.division.replace('NFC ', ''))}</td>
                <td>${esc(t.currentRecord)}</td>
                <td>${t.projectedWins}</td>
                <td>${t.makePlayoffsPct}%</td>
                <td>${t.winDivisionPct}%</td>
                <td>${t.seed1ByePct}%</td>
              </tr>
            `
              )
              .join('')}
          </tbody>
        </table>
      </div>
    </section>
  `;
}

function renderScheduleGameRowHtml(g, { isCurrentGame = false } = {}) {
  const seasonType = g.seasonType || 'REG';
  const isPre = seasonType === 'PRE';
  const isPost = seasonType === 'POST';
  const isBye = Boolean(g.isByeWeek);

  const restBadge =
    !isBye && g.restAdvantageDays > 0
      ? `<span class="badge badge-positive mono">+${g.restAdvantageDays}d Rest</span>`
      : !isBye && g.restAdvantageDays < 0
        ? `<span class="badge badge-danger mono">${g.restAdvantageDays}d Rest</span>`
        : '';
  const isLiveInGame =
    !g.completed &&
    !isBye &&
    (g.statusState === 'in' ||
      /\b(q1|q2|q3|q4|1st|2nd|3rd|4th|halftime|in progress|ot|overtime)\b/i.test(String(g.statusDetail || '')));
  const currentBadge =
    !g.completed && isCurrentGame && !isBye
      ? `<span class="badge ${isLiveInGame ? 'badge-danger' : 'badge-gold'} mono">${isLiveInGame ? 'LIVE' : 'Next Up'}</span>`
      : '';
  const borderColor =
    isPost || g.venue?.isInternational || (isCurrentGame && !g.completed)
      ? 'var(--gold-border)'
      : 'var(--border-subtle)';

  const weekTagText =
    seasonType === 'REG'
      ? `WK ${g.week}`
      : g.weekLabel || (isPre ? `PRE ${g.preseasonWeek || Math.abs(g.week)}` : 'POST');

  const phasePillHtml = isPre
    ? `<span class="badge badge-neutral mono" style="font-size:9.5px;padding:1px 5px">Preseason</span>`
    : isPost
      ? `<span class="badge ${isBye ? 'badge-positive' : 'badge-gold'} mono" style="font-size:9.5px;padding:1px 5px">${esc(g.roundBadgeLabel || 'Playoffs')}</span>`
      : '';

  if (isBye) {
    return `
      <div data-schedule-game-row="${g.completed ? 'previous' : 'upcoming'}"
           data-schedule-season-type="POST"
           data-schedule-week="${esc(g.week)}"
           data-postseason-round="${esc(g.postseasonRound || 'WC_BYE')}"
           data-postseason-state="${esc(g.postseasonState || 'first_round_bye')}"
           style="padding:10px 11px;border-radius:10px;background:var(--bg-card-alt);border:1px solid ${borderColor}">
        <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap">
          <div style="display:flex;align-items:center;gap:8px;min-width:0">
            ${renderTeamLogoHtml('SF', g.sfLogoUrl, 28)}
            <div style="min-width:0;display:flex;align-items:center;gap:5px;flex-wrap:wrap">
              <span class="mono" style="color:var(--gold-bright);font-weight:800">${esc(weekTagText)}</span>
              ${phasePillHtml}
              <span>•</span>
              <strong>${esc(g.opponent?.name || 'First-Round Playoff Bye (#1 NFC Seed)')}</strong>
            </div>
          </div>
          <div style="display:flex;gap:5px;align-items:center;flex-wrap:wrap">
            <span class="badge badge-positive mono">${esc(g.statusDetail || '1st-Round Bye (#1 Seed)')}</span>
          </div>
        </div>
        <div class="inline-icon-meta" style="margin-top:4px">
          ${iconSvg('stadium', 13)}
          <span>${esc(g.venue?.name || "Levi's Stadium")} (${esc(g.venue?.city || 'Santa Clara')}) • Homefield Advantage Clinched</span>
        </div>
        ${
          g.qualificationNote
            ? `<div style="margin-top:4px;font-size:11.5px;color:var(--emerald);font-weight:600">${esc(g.qualificationNote)}</div>`
            : ''
        }
      </div>
    `;
  }

  const locPrefix =
    g.homeAway === 'home'
      ? 'vs.'
      : g.homeAway === 'away'
        ? '@'
        : g.homeAway === 'neutral'
          ? 'vs.'
          : 'vs./@';
  const oppRecordDisplay =
    g.opponent?.record && g.opponent.record !== '—'
      ? ` <span class="mono" style="font-size:11.5px;color:var(--text-muted)">(${esc(g.opponent.record)})</span>`
      : '';
  const venueCityPart = g.venue?.city ? ` (${esc(g.venue.city)})` : '';
  const venueSurfacePart = g.venue?.surface ? ` • ${esc(g.venue.surface)}` : '';

  return `
    <div data-schedule-game-row="${g.completed ? 'previous' : 'upcoming'}"
         data-schedule-season-type="${esc(seasonType)}"
         data-schedule-week="${esc(g.week)}"
         ${isPost ? `data-postseason-round="${esc(g.postseasonRound || '')}" data-postseason-state="${esc(g.postseasonState || '')}"` : ''}
         style="padding:10px 11px;border-radius:10px;background:var(--bg-card-alt);border:1px solid ${borderColor}">
      <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap">
        <div style="display:flex;align-items:center;gap:8px;min-width:0">
          ${renderTeamLogoHtml(g.opponent?.abbr || 'NFL', g.oppLogoUrl || g.opponent?.logoUrl, 28)}
          <div style="min-width:0">
            <span class="mono" style="color:var(--gold-bright);font-weight:800">${esc(weekTagText)}</span>
            ${phasePillHtml ? ` ${phasePillHtml}` : ''} •
            ${
              g.gameUrl && (g.completed || isCurrentGame)
                ? `<a href="${esc(g.gameUrl)}" target="_blank" rel="noopener noreferrer" class="ext-link" style="color:var(--text-primary)"><strong>${locPrefix} ${esc(g.opponent?.name)}</strong></a>`
                : `<strong>${locPrefix} ${esc(g.opponent?.name)}</strong>`
            }${oppRecordDisplay}
          </div>
        </div>
        <div style="display:flex;gap:5px;align-items:center;flex-wrap:wrap">
          ${currentBadge}
          ${restBadge}
          ${
            g.completed
              ? `<span class="badge ${g.result === 'W' ? 'badge-positive' : g.result === 'T' ? 'badge-warning' : 'badge-danger'} mono">${g.result} ${g.sfScore}-${g.oppScore}</span>`
              : `<span class="badge ${isPost ? 'badge-gold' : 'badge-neutral'} mono">${esc(g.statusDetail || 'TBD')}</span>`
          }
          ${
            g.gameUrl && (g.completed || isCurrentGame)
              ? `<a href="${esc(g.gameUrl)}" target="_blank" rel="noopener noreferrer" class="source-chip-link"><span>${g.completed ? 'Box Score' : 'Gamecast'}</span>${iconSvg('externalLink', 10)}</a>`
              : ''
          }
        </div>
      </div>
      <div class="inline-icon-meta" style="margin-top:4px">
        ${iconSvg('stadium', 13)}
        <span>${esc(g.venue?.name || 'Venue TBD')}${venueCityPart}${venueSurfacePart}
        ${g.spreadLineSf != null && !g.completed ? ` • Line: <strong class="mono">SF ${g.spreadLineSf > 0 ? '+' : ''}${g.spreadLineSf}</strong>` : ''}</span>
      </div>
      ${
        g.venue?.internationalNote
          ? `<div style="margin-top:4px;font-size:11.5px;color:var(--gold-bright);font-weight:700">${esc(g.venue.internationalNote)}</div>`
          : ''
      }
      ${
        g.qualificationNote
          ? `<div style="margin-top:4px;font-size:11.5px;color:var(--gold-bright);font-weight:600">${esc(g.qualificationNote)}</div>`
          : ''
      }
    </div>
  `;
}

function formatWltString(games = []) {
  const playable = games.filter(g => !g.isByeWeek && (g.result === 'W' || g.result === 'L' || g.result === 'T'));
  const w = playable.filter(g => g.result === 'W').length;
  const l = playable.filter(g => g.result === 'L').length;
  const t = playable.filter(g => g.result === 'T').length;
  return {
    w,
    l,
    t,
    str: t > 0 ? `${w}-${l}-${t}` : `${w}-${l}`
  };
}

function renderFullSchedule(appData, schedulePrevExpanded = false, mcSimResult = null) {
  const schedModel = resolveCompleteScheduleModel(appData, mcSimResult);
  const seasonYr = schedModel.seasonYear;
  const previousGames = schedModel.previousGames;
  const currentAndFutureGames = schedModel.upcomingGames;
  const postStatus = schedModel.postseasonStatus;

  const prevPre = previousGames.filter(g => g.seasonType === 'PRE');
  const prevReg = previousGames.filter(g => g.seasonType === 'REG');
  const prevPost = previousGames.filter(g => g.seasonType === 'POST');
  const prevPostPlayed = prevPost.filter(g => !g.isByeWeek);

  const regRec = formatWltString(prevReg);
  const preRec = formatWltString(prevPre);
  const postRec = formatWltString(prevPostPlayed);

  const primaryRecObj = prevReg.length > 0 ? regRec : prevPre.length > 0 ? preRec : postRec;
  const primaryRecLabel =
    prevReg.length > 0
      ? regRec.str
      : prevPre.length > 0
        ? `${preRec.str} Pre`
        : postRec.str;

  const extraRecordBadgesHtml = [
    prevReg.length > 0 && prevPre.length > 0
      ? `<span class="badge badge-neutral mono">${esc(preRec.str)} Pre</span>`
      : '',
    prevPostPlayed.length > 0
      ? `<span class="badge badge-gold mono">${esc(postRec.str)} Post</span>`
      : ''
  ]
    .filter(Boolean)
    .join('');

  const rangeParts = [];
  if (prevPre.length === 1) {
    rangeParts.push(`PRE ${prevPre[0].preseasonWeek || 1}`);
  } else if (prevPre.length > 1) {
    rangeParts.push(
      `PRE ${prevPre[0].preseasonWeek || 1}–${prevPre[prevPre.length - 1].preseasonWeek || prevPre.length}`
    );
  }
  if (prevReg.length === 1) {
    rangeParts.push(`Wk ${prevReg[0].week}`);
  } else if (prevReg.length > 1) {
    rangeParts.push(`Wk ${prevReg[0].week}–${prevReg[prevReg.length - 1].week}`);
  }
  if (prevPost.length > 0) {
    rangeParts.push(
      prevPost.length === 1 ? prevPost[0].weekLabel || 'Playoffs' : 'Playoffs'
    );
  }
  const prevRangeLabel = rangeParts.join(' • ');

  const previousGamesBoxHtml =
    previousGames.length > 0
      ? `
        <details class="schedule-prev-collapsible" data-schedule-previous-games${schedulePrevExpanded ? ' open' : ''}>
          <summary class="schedule-prev-summary" data-schedule-previous-summary>
            <span class="schedule-prev-summary-main">
              <span>Previous Games (${previousGames.length})</span>
              <span class="badge ${primaryRecObj.w >= primaryRecObj.l ? 'badge-positive' : 'badge-neutral'} mono">${esc(primaryRecLabel)}</span>
              ${extraRecordBadgesHtml}
            </span>
            <span class="schedule-prev-summary-sub mono">${esc(prevRangeLabel)}</span>
          </summary>
          <div class="schedule-prev-list" data-schedule-previous-list>
            ${previousGames.map(g => renderScheduleGameRowHtml(g, { isCurrentGame: false })).join('')}
          </div>
        </details>
      `
      : '';

  const firstPlayableUpcomingIdx = currentAndFutureGames.findIndex(g => !g.isByeWeek);
  const activeCurrentIdx = firstPlayableUpcomingIdx >= 0 ? firstPlayableUpcomingIdx : 0;

  const upcomingListHtml =
    currentAndFutureGames.length > 0
      ? `
        <div class="schedule-upcoming-list" data-schedule-upcoming-list style="display:flex;flex-direction:column;gap:8px">
          ${currentAndFutureGames
            .map((g, idx) => renderScheduleGameRowHtml(g, { isCurrentGame: idx === activeCurrentIdx }))
            .join('')}
        </div>
      `
      : `<div class="subcard-panel" data-schedule-upcoming-list style="font-size:12.5px;color:var(--text-secondary)">All ${seasonYr} games are complete.${
          postStatus.summary ? ` ${esc(postStatus.summary)}` : ''
        } Expand <strong>Previous Games</strong> above to review results and box scores.</div>`;

  const postseasonHorizonHtml =
    postStatus.state === 'UNCLINCHED_IN_HUNT'
      ? `
        <div class="subcard-panel" data-schedule-postseason-tracker="unclinched" style="margin-top:10px;border-color:var(--gold-border)">
          <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap">
            <div>
              <div class="card-eyebrow">Postseason Qualification Tracker</div>
              <strong style="font-size:13px">${esc(postStatus.headline)}</strong>
            </div>
            <button type="button" class="btn-ghost" data-action="set-season-sub" data-season-sub="playoffs" style="font-size:11.5px;padding:4px 9px">
              ${iconSvg('trophy', 12)}
              <span>Playoff Simulator</span>
            </button>
          </div>
          <div style="font-size:12px;color:var(--text-secondary);margin-top:4px">${esc(postStatus.summary)}</div>
        </div>
      `
      : '';

  return `
    <section class="card">
      <div class="card-header">
        <div class="card-header-left">
          <div class="card-icon-badge" aria-hidden="true">${iconSvg('calendar', 18)}</div>
          <div class="card-title-group">
            <h2 class="card-title">${seasonYr} Season</h2>
          </div>
        </div>
        <a href="https://www.espn.com/nfl/team/schedule/_/name/sf/san-francisco-49ers" target="_blank" rel="noopener noreferrer" class="source-chip-link">
          <span>ESPN Schedule</span>${iconSvg('externalLink', 11)}
        </a>
      </div>

      ${previousGamesBoxHtml}
      ${upcomingListHtml}
      ${postseasonHorizonHtml}
    </section>
  `;
}

const BIG_BOARD_POS_PILLS = [
  { key: 'ALL', label: 'All' },
  { key: 'SF_RANGE', label: 'SF Window' },
  { key: 'OL', label: 'OL' },
  { key: 'WR_TE', label: 'WR/TE' },
  { key: 'DL_EDGE', label: 'DL/EDGE' },
  { key: 'DB_LB', label: 'DB/LB' },
  { key: 'QB_RB', label: 'QB/RB' }
];

function formatBoardRankLabelForMock(p, activeLens = 'consensus') {
  if (activeLens === 'buzz' && p.buzzRank) {
    return p.bigBoardRank
      ? `(Likely #${p.buzzRank} • Cons #${p.bigBoardRank})`
      : `(Likely #${p.buzzRank})`;
  }
  if (activeLens === 'pff' && p.pffRank) {
    return p.bigBoardRank
      ? `(PFF #${p.pffRank} • Cons #${p.bigBoardRank})`
      : `(PFF #${p.pffRank})`;
  }
  return p.bigBoardRank ? `(Board #${p.bigBoardRank})` : '';
}

function renderMockDbPlayerCardHtml(p, activeLens = 'consensus') {
  const safeProf = sanitizeExternalUrl(p.profileUrl, null) || sanitizeExternalUrl(p.mockDbUrl, null);
  const safeMockDb = sanitizeExternalUrl(p.mockDbUrl, null);
  const safeTk = sanitizeExternalUrl(p.tankathonUrl, null);
  const siteCountBadgeCls =
    p.siteCount >= 3 ? 'badge-positive' : p.siteCount === 2 ? 'badge-gold' : 'badge-neutral';
  const barWidth = Math.max(8, Math.min(100, Number(p.sharePct || 0)));
  const boardRankLbl = formatBoardRankLabelForMock(p, activeLens);

  const logoHtml = p.collegeLogoUrl
    ? `<img src="${esc(p.collegeLogoUrl)}" alt="" width="20" height="20" loading="lazy" class="ncaa-mini-logo" />`
    : '';

  return `
    <div class="mock-db-card" data-mock-db-player="${esc(p.playerKey)}" data-mock-site-count="${p.siteCount}">
      <div class="mock-db-top">
        <div class="mock-db-player-head">
          <span class="mock-db-rank mono">#${p.rank}</span>
          ${logoHtml}
          <div class="mock-db-name-wrap">
            <div class="mock-db-name-line">
              ${
                safeProf
                  ? `<a href="${esc(safeProf)}" target="_blank" rel="noopener noreferrer" class="ext-link mock-db-player-link"><strong>${esc(p.playerName)}</strong> ${iconSvg('externalLink', 9)}</a>`
                  : `<strong>${esc(p.playerName)}</strong>`
              }
              <span class="mock-db-pos-school"><strong style="color:var(--gold-bright)">${esc(p.pos)}</strong> • ${esc(p.school)}${
                boardRankLbl ? ` <span class="mono" style="color:var(--text-muted)">${esc(boardRankLbl)}</span>` : ''
              }</span>
            </div>
          </div>
        </div>
        <span class="badge ${siteCountBadgeCls} mono mock-db-count-badge">
          ${p.siteCount} ${p.siteCount === 1 ? 'Site' : 'Sites'} • ${p.sharePct}%
        </span>
      </div>

      <div class="mock-db-share-track" aria-hidden="true">
        <div class="mock-db-share-fill" style="width:${barWidth}%"></div>
      </div>

      <div class="mock-db-sites-strip" data-mock-projecting-sites>
        <span class="mock-db-sites-label mono">Projecting:</span>
        ${p.sites
          .map(
            s => `
          <a href="${esc(s.url)}" target="_blank" rel="noopener noreferrer"
             class="mock-site-chip" data-mock-site-link="${esc(s.siteId)}"
             title="${esc(`${s.siteName}${s.analyst ? ` (${s.analyst})` : ''} — Pick #${s.projectedPick} • ${s.shortDate}`)}">
            <span>${esc(s.siteName)}</span>
            <span class="mono mock-site-chip-meta">#${s.projectedPick}</span>
            ${iconSvg('externalLink', 9)}
          </a>
        `
          )
          .join('')}
      </div>

      <details class="compact-details mock-db-drilldown" data-mock-drilldown="${esc(p.playerKey)}">
        <summary class="compact-details-summary">
          <span>Drill Down: Scouting &amp; Site Notes (${p.siteCount})</span>
          <span class="mono" style="font-size:10.5px;color:var(--gold-bright)">${
            p.shanahanLynchFitScore ? `SF Fit ${p.shanahanLynchFitScore}/100 • ` : ''
          }Pick ${esc(p.pickRangeLabel)}</span>
        </summary>
        <div class="mock-db-drill-body">
          ${
            p.heightWeight || p.collegeStats
              ? `<div class="mock-db-meas-strip mono">${esc(
                  [p.heightWeight, p.collegeStats].filter(Boolean).join('  |  ')
                )}</div>`
              : ''
          }
          ${
            p.archetypeTraits
              ? `<div style="font-size:12px;color:var(--text-secondary)">${escJargon(p.archetypeTraits)}</div>`
              : ''
          }
          <div class="mock-db-site-detail-list">
            ${p.sites
              .map(
                s => `
              <div class="mock-db-site-detail-row">
                <div class="mock-db-site-detail-head">
                  <a href="${esc(s.url)}" target="_blank" rel="noopener noreferrer" class="ext-link">
                    <strong>${esc(s.siteName)}</strong>${s.analyst ? ` <span style="color:var(--text-muted)">(${esc(s.analyst)})</span>` : ''} ${iconSvg('externalLink', 9)}
                  </a>
                  <span class="mono" style="font-size:10.5px;color:var(--text-muted)">Rd ${s.round} #${s.projectedPick} • ${esc(s.shortDate)} (${esc(s.ageLabel)})</span>
                </div>
                ${s.note ? `<div style="font-size:11.5px;color:var(--text-secondary);margin-top:2px">${escJargon(s.note)}</div>` : ''}
              </div>
            `
              )
              .join('')}
          </div>
          <div class="source-link-strip" style="margin-top:4px">
            ${
              safeProf
                ? `<a href="${esc(safeProf)}" target="_blank" rel="noopener noreferrer" class="source-chip-link"><span>Scouting Profile</span>${iconSvg('externalLink', 9)}</a>`
                : ''
            }
            ${
              safeTk && safeTk !== safeProf
                ? `<a href="${esc(safeTk)}" target="_blank" rel="noopener noreferrer" class="source-chip-link"><span>Tankathon Tape</span>${iconSvg('externalLink', 9)}</a>`
                : ''
            }
            ${
              safeMockDb && safeMockDb !== safeProf
                ? `<a href="${esc(safeMockDb)}" target="_blank" rel="noopener noreferrer" class="source-chip-link"><span>Mock Draft DB</span>${iconSvg('externalLink', 9)}</a>`
                : ''
            }
          </div>
        </div>
      </details>
    </div>
  `;
}

function renderDeltaBadgeHtml(delta) {
  if (delta === null || delta === undefined || !Number.isFinite(delta) || delta === 0) return '';
  if (delta > 0) {
    return `<span class="bb-delta bb-delta-pos mono" title="Ranked ${delta} spots higher than Consensus">+${delta}</span>`;
  }
  return `<span class="bb-delta bb-delta-neg mono" title="Ranked ${Math.abs(delta)} spots lower than Consensus">${delta}</span>`;
}

function renderLensRankCellHtml(lensObj) {
  const r = lensObj?.rank ?? null;
  if (r === null) {
    return `<span class="bb-nr-pill mono" title="Unranked on this board (outside published Top 150/185)">NR</span>`;
  }
  return `<span class="bb-lens-cell-wrap mono"><span class="bb-lens-num">#${r}</span>${renderDeltaBadgeHtml(lensObj.delta)}</span>`;
}

function renderBigBoardProspectItemHtml(
  b,
  {
    sfPickOverall = 31,
    activeLens = 'consensus',
    mockSitesByKey = null,
    isOpen = false
  } = {}
) {
  const consRank = Number(b.boards?.consensus?.rank ?? b.consensusRank ?? 1);
  const activeLensObj = b.boards?.[activeLens] || b.boards?.consensus || { rank: consRank, delta: 0 };
  const mobileRank = activeLensObj.rank;
  const rankBadgeCls =
    mobileRank === null
      ? 'badge-neutral bb-rank-nr'
      : mobileRank <= 12
        ? 'badge-positive'
        : mobileRank <= 32
          ? 'badge-gold'
          : 'badge-neutral';
  const consBadgeCls =
    consRank <= 12 ? 'badge-positive' : consRank <= 32 ? 'badge-gold' : 'badge-neutral';

  const inSfRange = consRank >= Math.max(1, sfPickOverall - 11) && consRank <= sfPickOverall + 14;
  const spreadVal = b.spread;
  const spreadCls =
    spreadVal === null
      ? 'bb-spread-muted'
      : spreadVal >= 15
        ? 'bb-spread-polarizing'
        : spreadVal <= 5
          ? 'bb-spread-lock'
          : '';
  const mobileSpreadTxt =
    spreadVal === null ? '—' : spreadVal === 0 ? 'Δ0' : `Δ${spreadVal}`;

  const br = b.boardRanks || {};
  const boardChips = [
    br.espn ? { lbl: `ESPN #${br.espn}`, url: sanitizeExternalUrl(b.espnUrl || 'https://www.espn.com/nfl/draft/bestavailable', null) } : null,
    br.cbs ? { lbl: `CBS #${br.cbs}`, url: sanitizeExternalUrl(b.cbsUrl || 'https://www.cbssports.com/nfl/draft/prospect-rankings/', null) } : null,
    br.tankathon ? { lbl: `Tankathon #${br.tankathon}`, url: sanitizeExternalUrl(b.tankathonUrl || 'https://www.tankathon.com/nfl/big_board', null) } : null,
    br.drafttek ? { lbl: `DraftTek #${br.drafttek}`, url: null } : null
  ].filter(Boolean);

  const safeProf = sanitizeExternalUrl(b.profileUrl, null);
  const safeMockDb = sanitizeExternalUrl(b.mockDbUrl, null);
  const safeBuzzUrl = sanitizeExternalUrl(b.buzzUrl, 'https://grindingthemocks.com/');
  const safePffUrl = sanitizeExternalUrl(b.pffUrl, 'https://www.pff.com/draft/big-board');
  const safeBigBoardUrl = sanitizeExternalUrl(b.bigBoardUrl, safeMockDb);

  const logoHtml = b.collegeLogoUrl
    ? `<img src="${esc(b.collegeLogoUrl)}" alt="" width="19" height="19" loading="lazy" class="ncaa-mini-logo" />`
    : '';

  const mockHit = mockSitesByKey?.get(b.playerKey) || null;
  const consDate = formatShortBoardDate(b.boards?.consensus?.updated_at);
  const buzzDate = formatShortBoardDate(b.boards?.buzz?.updated_at);
  const pffDate = formatShortBoardDate(b.boards?.pff?.updated_at);

  const buzzRank = b.boards?.buzz?.rank ?? null;
  const pffRank = b.boards?.pff?.rank ?? null;
  const buzzDeltaTxt =
    buzzRank !== null && b.boards.buzz.delta
      ? ` (${b.boards.buzz.delta > 0 ? `+${b.boards.buzz.delta}` : b.boards.buzz.delta})`
      : '';
  const pffDeltaTxt =
    pffRank !== null && b.boards.pff.delta
      ? ` (${b.boards.pff.delta > 0 ? `+${b.boards.pff.delta}` : b.boards.pff.delta})`
      : '';

  return `
    <details class="big-board-item" data-big-board-rank="${consRank}" data-prospect-id="${esc(b.id)}" ${
      inSfRange ? 'data-in-sf-window="true"' : ''
    } ${isOpen ? 'open' : ''}>
      <summary class="big-board-summary">
        <!-- Mobile Compact View (< 768px or Landscape < 500px height) -->
        <div class="big-board-mobile-row">
          <div class="big-board-left">
            <span class="badge ${rankBadgeCls} mono big-board-rank-pill">${mobileRank !== null ? `#${mobileRank}` : 'NR'}</span>
            ${logoHtml}
            <div class="big-board-identity">
              <span class="big-board-name">${esc(b.name)}</span>
              <span class="big-board-sub"><strong style="color:var(--gold-bright)">${esc(b.pos)}</strong> • ${esc(b.school)} <span class="bb-tier-inline mono">T${b.tier}</span></span>
            </div>
          </div>
          <div class="big-board-right">
            ${
              activeLens !== 'consensus'
                ? mobileRank !== null
                  ? renderDeltaBadgeHtml(activeLensObj.delta)
                  : `<span class="bb-cons-fallback mono">Cons #${consRank}</span>`
                : ''
            }
            ${inSfRange ? `<span class="badge badge-scarlet mono big-board-sf-tag" title="Inside 49ers 1st-Pick Range">SF</span>` : ''}
            <span class="mono big-board-spread ${spreadCls}">${esc(mobileSpreadTxt)}</span>
          </div>
        </div>

        <!-- Desktop 8-Column Comparison Row (>= 768px and height >= 500px) -->
        <div class="big-board-desktop-row">
          <div class="bb-col bb-col-cons">
            <span class="badge ${consBadgeCls} mono big-board-rank-pill">#${consRank}</span>
          </div>
          <div class="bb-col bb-col-player">
            ${logoHtml}
            <span class="big-board-name">${esc(b.name)}</span>
            ${inSfRange ? `<span class="badge badge-scarlet mono big-board-sf-tag" title="Inside 49ers 1st-Pick Range">SF</span>` : ''}
          </div>
          <div class="bb-col bb-col-pos mono"><strong style="color:var(--gold-bright)">${esc(b.pos)}</strong></div>
          <div class="bb-col bb-col-school">${esc(b.school)}</div>
          <div class="bb-col bb-col-tier mono"><span class="bb-tier-pill">T${b.tier}</span></div>
          <div class="bb-col bb-col-lens ${activeLens === 'buzz' ? 'is-active-lens' : ''}">${renderLensRankCellHtml(b.boards?.buzz)}</div>
          <div class="bb-col bb-col-lens ${activeLens === 'pff' ? 'is-active-lens' : ''}">${renderLensRankCellHtml(b.boards?.pff)}</div>
          <div class="bb-col bb-col-spread mono ${spreadCls}">
            <span>${spreadVal !== null ? spreadVal : '—'}</span>
            <span class="bb-row-caret" aria-hidden="true">▾</span>
          </div>
        </div>
      </summary>

      <div class="big-board-detail-body">
        <div class="big-board-lenses-detail-strip">
          ${
            safeBigBoardUrl
              ? `<a href="${esc(safeBigBoardUrl)}" target="_blank" rel="noopener noreferrer" class="source-chip-link mono" title="Talent &amp; Value Baseline • Updated ${esc(consDate)}"><span>Consensus #${consRank}${consDate ? ` · ${consDate}` : ''}</span>${iconSvg('externalLink', 9)}</a>`
              : `<span class="badge badge-neutral mono">Consensus #${consRank}</span>`
          }
          ${
            safeBuzzUrl
              ? `<a href="${esc(safeBuzzUrl)}" target="_blank" rel="noopener noreferrer" class="source-chip-link mono" title="Most Likely NFL Draft Order (Buzz &amp; EDP) • Updated ${esc(buzzDate)}"><span>Likely: ${buzzRank !== null ? `#${buzzRank}${buzzDeltaTxt}` : 'NR'}${buzzDate ? ` · ${buzzDate}` : ''}</span>${iconSvg('externalLink', 9)}</a>`
              : ''
          }
          ${
            safePffUrl
              ? `<a href="${esc(safePffUrl)}" target="_blank" rel="noopener noreferrer" class="source-chip-link mono" title="Most Accurate for NFL Performance (PFF Grade &amp; WAR) • Updated ${esc(pffDate)}"><span>PFF: ${pffRank !== null ? `#${pffRank}${pffDeltaTxt}` : 'NR'}${pffDate ? ` · ${pffDate}` : ''}</span>${iconSvg('externalLink', 9)}</a>`
              : ''
          }
        </div>

        <div class="big-board-ranks-strip">
          ${boardChips
            .map(bc =>
              bc.url
                ? `<a href="${esc(bc.url)}" target="_blank" rel="noopener noreferrer" class="source-chip-link mono">${esc(bc.lbl)} ${iconSvg('externalLink', 9)}</a>`
                : `<span class="badge badge-neutral mono">${esc(bc.lbl)}</span>`
            )
            .join('')}
          ${
            b.shanahanLynchFitScore
              ? `<span class="badge badge-positive mono">SF Fit ${b.shanahanLynchFitScore}/100</span>`
              : ''
          }
          ${
            mockHit
              ? `<span class="badge badge-gold mono">Mocked to SF (${mockHit.siteCount} ${mockHit.siteCount === 1 ? 'site' : 'sites'})</span>`
              : ''
          }
        </div>

        ${
          b.heightWeight || b.collegeStats
            ? `<div class="mock-db-meas-strip mono">${esc(
                [b.heightWeight, b.collegeStats].filter(Boolean).join('  |  ')
              )}</div>`
            : ''
        }
        ${b.archetypeNote ? `<div style="font-size:12px;color:var(--text-secondary)">${escJargon(b.archetypeNote)}</div>` : ''}
        <div class="source-link-strip">
          ${
            safeProf
              ? `<a href="${esc(safeProf)}" target="_blank" rel="noopener noreferrer" class="source-chip-link"><span>Prospect Profile</span>${iconSvg('externalLink', 9)}</a>`
              : ''
          }
          ${
            safeMockDb && safeMockDb !== safeProf
              ? `<a href="${esc(safeMockDb)}" target="_blank" rel="noopener noreferrer" class="source-chip-link"><span>Mock Draft DB</span>${iconSvg('externalLink', 9)}</a>`
              : ''
          }
        </div>
      </div>
    </details>
  `;
}

function renderDesktopSortHeaderCell({
  colKey,
  title,
  sub = '',
  jargonKey = '',
  activeSortField = 'consensus',
  activeSortDir = 'asc',
  extraCls = ''
}) {
  const isSorted = activeSortField === colKey;
  const arrow = isSorted ? (activeSortDir === 'asc' ? '▴' : '▾') : '⇅';
  return `
    <div class="bb-th ${extraCls} ${isSorted ? 'is-sorted' : ''}"
         role="button" tabindex="0"
         data-action="sort-big-board-col" data-sort-col="${esc(colKey)}"
         aria-label="Sort by ${esc(title)}">
      <div class="bb-th-top">
        <span class="bb-th-title">${esc(title)}</span>
        <span class="bb-th-arrow mono" aria-hidden="true">${arrow}</span>
        ${jargonKey ? jargonInfoIcon(jargonKey) : ''}
      </div>
      ${sub ? `<div class="bb-th-sub">${esc(sub)}</div>` : ''}
    </div>
  `;
}

function renderDraftPrepAndCombine(appData, opts = {}) {
  const combineSearch = typeof opts === 'string' ? opts : opts.combineSearch || '';
  const bigBoardSearch = typeof opts === 'object' && opts ? opts.bigBoardSearch || '' : '';
  const bigBoardPosFilter = typeof opts === 'object' && opts ? opts.bigBoardPosFilter || 'ALL' : 'ALL';
  const bigBoardPositions = typeof opts === 'object' && Array.isArray(opts.bigBoardPositions) ? opts.bigBoardPositions : [];
  const bigBoardLens = typeof opts === 'object' && opts?.bigBoardLens ? opts.bigBoardLens : 'consensus';
  const bigBoardSortField = typeof opts === 'object' && opts?.bigBoardSortField ? opts.bigBoardSortField : 'consensus';
  const bigBoardSortDir = typeof opts === 'object' && opts?.bigBoardSortDir ? opts.bigBoardSortDir : 'asc';
  const bigBoardRange = typeof opts === 'object' && opts?.bigBoardRange ? opts.bigBoardRange : 'all';
  const bigBoardAgreement = typeof opts === 'object' && opts?.bigBoardAgreement ? opts.bigBoardAgreement : 'all';
  const bigBoardRankedOnly = Boolean(typeof opts === 'object' && opts?.bigBoardRankedOnly);
  const bigBoardFilterDrawerOpen = Boolean(typeof opts === 'object' && opts?.bigBoardFilterDrawerOpen);
  const bigBoardExpanded = Boolean(typeof opts === 'object' && opts?.bigBoardExpanded);
  const bigBoardShowAll = Boolean(typeof opts === 'object' && opts?.bigBoardShowAll);
  const bigBoardExpandedIds = opts?.bigBoardExpandedIds instanceof Set ? opts.bigBoardExpandedIds : new Set();
  const bigBoardShareCopied = Boolean(typeof opts === 'object' && opts?.bigBoardShareCopied);
  const mcSimResult = typeof opts === 'object' && opts ? opts.mcSimResult || null : null;

  const dp = appData?.seasonal?.draftPrep2027 || {};
  const seasonYr = Number(appData?.meta?.seasonYear) || 2026;
  const nextDraftYr = Number(dp.draftYear) || seasonYr + 1;
  const sfFirstPickOverall = Number(dp.pickInventory?.[0]?.projectedOverall) || 31;

  // 1. Resolve 49ers First-Pick Mock Draft Database (1-month in-season vs 1-week post-elimination)
  const mockDb = resolveFirstPickMockDatabase(dp.firstPickMockDatabase || [], {
    appData,
    now: appData?.meta?.now,
    mcSimResult,
    draftYear: nextDraftYr,
    projectedPick: sfFirstPickOverall,
    activeLens: bigBoardLens,
    consensusBigBoard: dp.consensusBigBoard || []
  });
  const mockSitesByKey = new Map(mockDb.players.map(p => [p.playerKey, p]));
  const mockDbTeamUrl =
    sanitizeExternalUrl(dp.sources?.[0]?.url, null) || buildMockDraftTeamUrl(nextDraftYr);
  const primaryMockPlayers = mockDb.players.slice(0, 5);
  const overflowMockPlayers = mockDb.players.slice(5);

  // 2. Resolve 3-Lens NFL Draft Big Board (directly above Combine Leaderboard)
  const rawBigBoard = Array.isArray(dp.consensusBigBoard) ? dp.consensusBigBoard : [];
  const boardQuery = queryBigBoardProspects(rawBigBoard, {
    draftYear: nextDraftYr,
    lens: bigBoardLens,
    sortField: bigBoardSortField,
    sortDir: bigBoardSortDir,
    search: bigBoardSearch,
    posGroup: bigBoardPosFilter,
    positions: bigBoardPositions,
    range: bigBoardRange,
    agreement: bigBoardAgreement,
    rankedOnly: bigBoardRankedOnly,
    sfPickOverall: sfFirstPickOverall
  });

  const activeLensSpec = BIG_BOARD_LENSES[boardQuery.activeLens] || BIG_BOARD_LENSES.consensus;
  const lensMeta = dp.bigBoardMeta?.lenses?.[boardQuery.activeLens] || {};
  const activeLensUpdatedRaw =
    lensMeta.updated_at ||
    boardQuery.items[0]?.boards?.[boardQuery.activeLens]?.updated_at ||
    `${nextDraftYr - 1}-11-12`;
  const activeLensUpdatedDisplay = formatShortBoardDate(activeLensUpdatedRaw);

  const isNarrowedByFilter = boardQuery.activeFilterCount > 0;
  let displayLimit = 25;
  if (bigBoardShowAll) {
    displayLimit = boardQuery.filteredCount;
  } else if (bigBoardExpanded || isNarrowedByFilter) {
    displayLimit = 100;
  }
  const visibleBigBoard = boardQuery.items.slice(0, displayLimit);

  const drawerBadgeCount =
    (boardQuery.positions.length > 0 ? 1 : 0) +
    (boardQuery.posGroup === 'OFF' || boardQuery.posGroup === 'DEF' ? 1 : 0) +
    (boardQuery.range !== 'all' ? 1 : 0) +
    (boardQuery.agreement !== 'all' ? 1 : 0) +
    (boardQuery.rankedOnly ? 1 : 0);

  // 3. Evaluate Combine Leaderboard Blank Window (blank from preseason start until Combine start)
  const combineWindow = evaluateCombineLeaderboardWindow({
    now: appData?.meta?.now,
    seasonYear: seasonYr,
    draftYear: nextDraftYr,
    schedule: appData?.scheduleMatchup?.schedule || [],
    combineLeaderboard: dp.combineLeaderboard || []
  });
  const q = String(combineSearch || '').toLowerCase().trim();
  const filteredCombine = combineWindow.rows.filter(
    c => !q || c.name.toLowerCase().includes(q) || c.pos.toLowerCase().includes(q) || c.school.toLowerCase().includes(q)
  );

  return `
    <section class="card">
      <div class="card-header">
        <div class="card-header-left">
          <div class="card-icon-badge" aria-hidden="true">${iconSvg('compass', 18)}</div>
          <div class="card-title-group">
            <h2 class="card-title">${nextDraftYr} Draft Needs &amp; Picks</h2>
          </div>
        </div>
        <div class="source-link-strip">
          ${(dp.sources || [])
            .filter(s => sanitizeExternalUrl(s?.url, null))
            .slice(0, 3)
            .map(
              s => `<a href="${esc(sanitizeExternalUrl(s.url))}" target="_blank" rel="noopener noreferrer" class="source-chip-link"><span>${esc(s.label)}</span>${iconSvg('externalLink', 10)}</a>`
            )
            .join('')}
        </div>
      </div>

      <div style="display:flex;flex-direction:column;gap:6px;margin-bottom:12px">
        ${(dp.topNeeds2027 || [])
          .map(
            n => `
          <div class="subcard-panel" style="font-size:12.5px">
            <strong style="color:var(--gold-bright)">#${n.rank} ${esc(n.pos)}:</strong> ${escJargon(n.horizon)}
          </div>
        `
          )
          .join('')}
      </div>

      <div class="sub-label" style="margin-bottom:6px">${nextDraftYr} Draft Picks (${(dp.pickInventory || []).length})</div>
      ${dp.tradedPicksNote ? `<div class="subcard-panel" style="font-size:11.5px;color:var(--text-secondary);margin-bottom:8px">${escJargon(dp.tradedPicksNote)}</div>` : ''}
      <div class="table-scroll">
        <table class="data-table mono">
          <thead><tr><th>Rd</th><th>Est. Pick</th><th>Origin</th><th>${jargonTerm('Rich Hill', 'rich_hill')} Pts</th></tr></thead>
          <tbody>
            ${(dp.pickInventory || [])
              .map(
                p => `
              <tr>
                <td>Rd ${p.round}</td><td>#${p.projectedOverall}</td>
                <td style="font-family:var(--font-sans)">${esc(p.origin)}</td>
                <td>${p.valueRichHill}</td>
              </tr>
            `
              )
              .join('')}
          </tbody>
        </table>
      </div>
    </section>

    <section class="card" id="consensusMockDraftCard" data-consensus-mock-card>
      <div class="card-header" style="margin-bottom:6px">
        <div class="card-header-left">
          <div class="card-icon-badge" aria-hidden="true">${iconSvg('trophy', 17)}</div>
          <div class="card-title-group">
            <div class="card-eyebrow">49ers 1st Pick • Rd ${mockDb.projectedFirstPickRound} Est. #${mockDb.projectedFirstPickOverall}</div>
            <h3 class="card-title">Consensus Mock Draft</h3>
          </div>
        </div>
        <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap">
          <span class="badge ${mockDb.isEliminated ? 'badge-scarlet' : 'badge-gold'} mono"
                data-mock-freshness-badge="${mockDb.freshnessDays}d">
            ${esc(mockDb.shortWindowBadge)} • ${mockDb.totalFreshSites} ${mockDb.totalFreshSites === 1 ? 'Site' : 'Sites'}
          </span>
          <a href="${esc(mockDbTeamUrl)}" target="_blank" rel="noopener noreferrer" class="source-chip-link">
            <span>Mock DB</span>${iconSvg('externalLink', 10)}
          </a>
        </div>
      </div>

      <div class="mock-freshness-banner" data-mock-freshness-note>
        ${
          mockDb.isEliminated
            ? `Post-elimination filter active: showing <strong>last 7 days</strong> of 49ers 1st-pick projections (${mockDb.totalFreshSites} verified sites${
                mockDb.staleExcludedCount > 0 ? ` • ${mockDb.staleExcludedCount} older >7d excluded` : ''
              }).`
            : `In-season filter active: showing <strong>last 1 month (30 days)</strong> of 49ers 1st-pick projections (${mockDb.totalFreshSites} verified sites${
                mockDb.staleExcludedCount > 0 ? ` • ${mockDb.staleExcludedCount} stale >30d excluded` : ''
              }; tightens to 1 week post-elimination).`
        }
      </div>

      ${
        primaryMockPlayers.length > 0
          ? `
        <div class="mock-db-list" data-mock-db-list>
          ${primaryMockPlayers.map(p => renderMockDbPlayerCardHtml(p, boardQuery.activeLens)).join('')}
        </div>
        ${
          overflowMockPlayers.length > 0
            ? `
          <details class="compact-details" style="margin-top:8px" data-mock-db-more>
            <summary class="compact-details-summary">
              <span>More 49ers 1st-Pick Projections (${overflowMockPlayers.length})</span>
            </summary>
            <div class="mock-db-list" style="margin-top:6px">
              ${overflowMockPlayers.map(p => renderMockDbPlayerCardHtml(p, boardQuery.activeLens)).join('')}
            </div>
          </details>
        `
            : ''
        }
      `
          : `<div class="subcard-panel" data-mock-db-empty style="font-size:12px;color:var(--text-secondary)">No verified 49ers 1st-pick mock drafts published within the active ${mockDb.freshnessDays}-day freshness window yet.</div>`
      }

      ${
        (dp.consensusMockTargets || []).length > 0
          ? `
        <details class="compact-details" style="margin-top:9px" data-mock-archetypes-details>
          <summary class="compact-details-summary">
            <span>Shanahan / Lynch Scheme Fit Clusters (${(dp.consensusMockTargets || []).length})</span>
          </summary>
          <div style="display:flex;flex-direction:column;gap:7px;margin-top:6px">
            ${(dp.consensusMockTargets || [])
              .map(m => {
                const pLinks = Array.isArray(m.prospectLinks) && m.prospectLinks.length > 0 ? m.prospectLinks : null;
                const headerLinksHtml = pLinks
                  ? `<span style="display:inline-flex;align-items:center;gap:6px;flex-wrap:wrap">${pLinks
                      .map(pl => {
                        const safePl = sanitizeExternalUrl(pl.url, null);
                        const lbl = `${pl.name} (${pl.pos} • ${pl.school})`;
                        return safePl
                          ? `<a href="${esc(safePl)}" target="_blank" rel="noopener noreferrer" class="ext-link"><strong>${esc(lbl)}</strong> ${iconSvg('externalLink', 10)}</a>`
                          : `<strong>${esc(lbl)}</strong>`;
                      })
                      .join('<span style="color:var(--text-muted)">/</span>')}</span>`
                  : `<strong>${esc(m.name)} (${esc(m.pos)} • ${esc(m.school)})</strong>`;
                return `
              <div class="subcard-panel">
                <div style="display:flex;justify-content:space-between;align-items:center;gap:6px;flex-wrap:wrap">
                  ${headerLinksHtml}
                  <span class="badge badge-positive mono">SF Fit ${m.shanahanLynchFitScore}/100</span>
                </div>
                <div style="font-size:11.5px;color:var(--gold-bright);margin:2px 0">${esc(m.heightWeight)} • ${renderReporterSourceLinksHtml(m.sourcesMocking || [], m.sourceUrl)}</div>
                <div style="font-size:12px;color:var(--text-secondary)">${escJargon(m.archetypeTraits)}</div>
              </div>
            `;
              })
              .join('')}
          </div>
        </details>
      `
          : ''
      }
    </section>

    <section class="card" id="consensusBigBoardCard" data-consensus-big-board data-active-lens="${esc(boardQuery.activeLens)}">
      <div class="card-header" style="margin-bottom:7px">
        <div class="card-header-left">
          <div class="card-icon-badge" aria-hidden="true">${iconSvg('radar', 17)}</div>
          <div class="card-title-group">
            <div class="card-eyebrow">3-Lens Composite • ${esc(activeLensSpec.badge)}</div>
            <h3 class="card-title">${nextDraftYr} NFL Draft Big Board</h3>
          </div>
        </div>
        <span class="source-chip-link big-board-sources-trigger" role="button" tabindex="0"
              data-jargon="big_board_sources"
              aria-label="View 3-Lens Big Board sources and predictive accuracy">
          <span>Sources &amp; Accuracy</span>
          <span class="jargon-info-dot-inline" aria-hidden="true">ⓘ</span>
        </span>
      </div>

      <!-- 3-Lens Pill Switcher (Consensus • Likely Draft Order • PFF NFL Accuracy) -->
      <div class="segmented-control big-board-lens-bar" role="tablist" aria-label="Select Big Board Lens">
        ${BIG_BOARD_LENS_ORDER.map(lk => {
          const spec = BIG_BOARD_LENSES[lk];
          const isSelected = boardQuery.activeLens === lk;
          return `
            <button type="button" role="tab" aria-selected="${isSelected ? 'true' : 'false'}"
                    class="pill-btn seg-btn big-board-lens-pill ${isSelected ? 'active' : ''}"
                    data-action="set-big-board-lens" data-lens="${lk}">
              <span>${esc(spec.pillLabel)}</span>
              ${jargonInfoIcon(spec.jargonKey, `${spec.label} — ${spec.badge}: tap for methodology & source links`)}
            </button>
          `;
        }).join('')}
      </div>

      <!-- Live Count, Per-Lens Freshness & 1-Tap Share / Reset Strip -->
      <div class="big-board-status-strip">
        <div class="big-board-status-left">
          <span class="big-board-count-txt" data-big-board-count>
            Showing <strong>${boardQuery.filteredCount}</strong> of <strong>${boardQuery.totalCount}</strong> prospects
          </span>
          ${
            activeLensUpdatedDisplay
              ? `<span class="big-board-updated-pill mono" data-board-updated="${esc(activeLensUpdatedRaw)}">Updated ${esc(activeLensUpdatedDisplay)}</span>`
              : ''
          }
        </div>
        <div class="big-board-status-actions">
          <button type="button" class="bb-micro-btn" data-action="share-big-board-url" title="Copy shareable link to current Big Board view">
            ${iconSvg('share', 11)}
            <span>${bigBoardShareCopied ? 'Copied!' : 'Share'}</span>
          </button>
          ${
            boardQuery.hasActiveControls
              ? `<button type="button" class="bb-micro-btn bb-reset-btn" data-action="reset-big-board-filters" title="Reset Big Board sort and filters">
                  ${iconSvg('reset', 11)}
                  <span>Reset</span>
                </button>`
              : ''
          }
        </div>
      </div>

      <!-- Search, Roster-Consistent Sort Dropdown + Asc/Desc Arrow & Filters Drawer Toggle -->
      <div class="big-board-toolbar">
        <div class="search-input-wrap big-board-search-wrap">
          ${iconSvg('search', 15, 'search-input-icon')}
          <input type="search" id="bigBoardSearchInput" class="text-input has-lead-icon"
                 placeholder="Search ${boardQuery.totalCount || 250} prospects by name, school, pos…"
                 value="${esc(bigBoardSearch)}" aria-label="Search NFL Draft Big Board" />
        </div>
        <div class="big-board-controls-row">
          <select id="bigBoardSortSelect" class="select-input big-board-sort-select" aria-label="Sort Big Board By">
            ${BIG_BOARD_SORT_FIELDS.map(
              f => `<option value="${f.key}" ${boardQuery.sortField === f.key ? 'selected' : ''}>Sort: ${esc(f.shortLabel)}</option>`
            ).join('')}
          </select>
          <button type="button" id="bigBoardSortDirBtn" class="btn-secondary sort-dir-btn mono"
                  data-action="toggle-big-board-sort-dir"
                  data-sort-dir="${boardQuery.sortDir}"
                  title="Toggle Sort Order (${boardQuery.sortDir === 'asc' ? 'Ascending' : 'Descending'})"
                  aria-label="Toggle Big Board Sort Direction">
            ${boardQuery.sortDir === 'asc' ? '↑' : '↓'}
          </button>
          <button type="button" id="bigBoardFilterDrawerBtn"
                  class="btn-secondary big-board-filter-btn ${bigBoardFilterDrawerOpen || drawerBadgeCount > 0 ? 'has-active' : ''}"
                  data-action="toggle-big-board-filter-drawer"
                  aria-expanded="${bigBoardFilterDrawerOpen ? 'true' : 'false'}">
            <span>Filters${drawerBadgeCount > 0 ? ` (${drawerBadgeCount})` : ''}</span>
            ${iconSvg(bigBoardFilterDrawerOpen ? 'chevronUp' : 'chevronDown', 12)}
          </button>
        </div>
      </div>

      <!-- Quick Position Group Filter Pills -->
      <div class="big-board-pos-bar" role="tablist" aria-label="Filter Big Board by Position Group">
        ${BIG_BOARD_POS_PILLS.map(pill => {
          const active = boardQuery.posGroup === pill.key && boardQuery.positions.length === 0;
          return `
            <button type="button" role="tab" aria-selected="${active ? 'true' : 'false'}"
                    class="pill-btn big-board-pos-pill ${active ? 'active' : ''}"
                    data-action="set-big-board-pos" data-pos-group="${pill.key}">
              <span>${esc(pill.label)}</span>
            </button>
          `;
        }).join('')}
      </div>

      <!-- Progressive-Disclosure Advanced Filter Drawer -->
      ${
        bigBoardFilterDrawerOpen
          ? `
        <div class="big-board-filter-drawer" id="bigBoardFilterDrawer" data-big-board-drawer>
          <div class="bb-drawer-group">
            <div class="bb-drawer-label">Positions (Multi-Select) &amp; Unit</div>
            <div class="bb-drawer-chips">
              <button type="button" class="pill-btn big-board-pos-pill ${boardQuery.posGroup === 'ALL' && boardQuery.positions.length === 0 ? 'active' : ''}"
                      data-action="set-big-board-pos" data-pos-group="ALL">All</button>
              <button type="button" class="pill-btn big-board-pos-pill ${boardQuery.posGroup === 'OFF' ? 'active' : ''}"
                      data-action="set-big-board-pos" data-pos-group="OFF">Offense</button>
              <button type="button" class="pill-btn big-board-pos-pill ${boardQuery.posGroup === 'DEF' ? 'active' : ''}"
                      data-action="set-big-board-pos" data-pos-group="DEF">Defense</button>
              ${BIG_BOARD_INDIVIDUAL_POSITIONS.map(posKey => {
                const active = boardQuery.positions.includes(posKey);
                return `
                  <button type="button" class="pill-btn big-board-pos-pill ${active ? 'active' : ''}"
                          data-action="toggle-big-board-pos-chip" data-pos="${posKey}">
                    ${esc(posKey)}
                  </button>
                `;
              }).join('')}
            </div>
          </div>

          <div class="bb-drawer-group">
            <div class="bb-drawer-label">Draft Range &amp; Capital Tier</div>
            <div class="bb-drawer-chips">
              ${BIG_BOARD_RANGE_OPTIONS.map(ro => `
                <button type="button" class="pill-btn big-board-pos-pill ${boardQuery.range === ro.key ? 'active' : ''}"
                        data-action="set-big-board-range" data-range="${ro.key}">
                  ${esc(ro.label)}
                </button>
              `).join('')}
            </div>
          </div>

          <div class="bb-drawer-group">
            <div class="bb-drawer-label">Board Agreement &amp; Coverage</div>
            <div class="bb-drawer-chips">
              ${BIG_BOARD_AGREEMENT_OPTIONS.map(ao => `
                <button type="button" class="pill-btn big-board-pos-pill ${boardQuery.agreement === ao.key ? 'active' : ''}"
                        data-action="set-big-board-agreement" data-agree="${ao.key}">
                  ${esc(ao.label)}
                </button>
              `).join('')}
              <button type="button" class="pill-btn big-board-pos-pill ${boardQuery.rankedOnly ? 'active' : ''}"
                      data-action="toggle-big-board-ranked-only"
                      aria-pressed="${boardQuery.rankedOnly ? 'true' : 'false'}">
                ${boardQuery.rankedOnly ? '✓ ' : ''}Ranked on Selected Board (Hide NR)
              </button>
            </div>
          </div>
        </div>
      `
          : ''
      }

      ${
        visibleBigBoard.length > 0
          ? `
        <!-- Desktop 8-Column Sortable Table Header (Hidden on Mobile via CSS) -->
        <div class="big-board-desktop-thead" role="row" aria-label="Sortable Big Board Columns">
          ${renderDesktopSortHeaderCell({
            colKey: 'consensus',
            title: 'Cons.',
            sub: 'Baseline',
            jargonKey: 'consensus_big_board',
            activeSortField: boardQuery.sortField,
            activeSortDir: boardQuery.sortDir,
            extraCls: 'bb-col-cons'
          })}
          ${renderDesktopSortHeaderCell({
            colKey: 'name',
            title: 'Player',
            sub: 'Click row for dossier',
            activeSortField: boardQuery.sortField,
            activeSortDir: boardQuery.sortDir,
            extraCls: 'bb-col-player'
          })}
          ${renderDesktopSortHeaderCell({
            colKey: 'pos',
            title: 'Pos',
            activeSortField: boardQuery.sortField,
            activeSortDir: boardQuery.sortDir,
            extraCls: 'bb-col-pos'
          })}
          <div class="bb-th bb-th-static bb-col-school"><div class="bb-th-top"><span class="bb-th-title">School</span></div></div>
          ${renderDesktopSortHeaderCell({
            colKey: 'tier',
            title: 'Tier',
            jargonKey: 'draft_tier_system',
            activeSortField: boardQuery.sortField,
            activeSortDir: boardQuery.sortDir,
            extraCls: 'bb-col-tier'
          })}
          ${renderDesktopSortHeaderCell({
            colKey: 'buzz',
            title: 'Likely',
            sub: 'Draft Order',
            jargonKey: 'draft_buzz_edp',
            activeSortField: boardQuery.sortField,
            activeSortDir: boardQuery.sortDir,
            extraCls: 'bb-col-lens'
          })}
          ${renderDesktopSortHeaderCell({
            colKey: 'pff',
            title: 'PFF',
            sub: 'NFL Perf.',
            jargonKey: 'pff_big_board',
            activeSortField: boardQuery.sortField,
            activeSortDir: boardQuery.sortDir,
            extraCls: 'bb-col-lens'
          })}
          ${renderDesktopSortHeaderCell({
            colKey: 'spread',
            title: 'Spread',
            sub: 'Max Δ',
            jargonKey: 'board_spread_delta',
            activeSortField: boardQuery.sortField,
            activeSortDir: boardQuery.sortDir,
            extraCls: 'bb-col-spread'
          })}
        </div>

        <div class="big-board-list" data-big-board-list>
          ${visibleBigBoard
            .map(b =>
              renderBigBoardProspectItemHtml(b, {
                sfPickOverall: sfFirstPickOverall,
                activeLens: boardQuery.activeLens,
                mockSitesByKey,
                isOpen: bigBoardExpandedIds.has(b.id)
              })
            )
            .join('')}
        </div>

        <div class="big-board-pagination-row">
          ${
            !isNarrowedByFilter && boardQuery.filteredCount > 25
              ? `<button type="button" class="btn-ghost" style="flex:1" data-action="toggle-big-board-expand">
                  ${iconSvg(bigBoardExpanded || bigBoardShowAll ? 'chevronUp' : 'chevronDown', 13)}
                  <span>${
                    bigBoardExpanded || bigBoardShowAll
                      ? 'Show Top 25 Only'
                      : `View Top 100 Prospects (${Math.min(100, boardQuery.filteredCount) - 25} more)`
                  }</span>
                </button>`
              : ''
          }
          ${
            (bigBoardExpanded || isNarrowedByFilter) && !bigBoardShowAll && boardQuery.filteredCount > visibleBigBoard.length
              ? `<button type="button" class="btn-ghost" style="flex:1" data-action="show-all-big-board">
                  ${iconSvg('chevronDown', 13)}
                  <span>Show All ${boardQuery.filteredCount} Prospects</span>
                </button>`
              : ''
          }
        </div>
      `
          : `<div class="subcard-panel" style="font-size:12px;color:var(--text-secondary)">No prospects match current filters. <button type="button" class="bb-inline-reset" data-action="reset-big-board-filters">Reset filters</button></div>`
      }
    </section>

    <section class="card" id="combineLeaderboardCard" data-combine-card data-combine-blank="${combineWindow.isBlankWindow ? 'true' : 'false'}">
      <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:8px">
        <h3 class="card-title">${
          combineWindow.isBlankWindow
            ? `${combineWindow.targetCombineYear} Combine Leaderboard`
            : `Combine Leaderboard (${filteredCombine.length})`
        }</h3>
        <div class="source-link-strip">
          <a href="https://www.nfl.com/combine/" target="_blank" rel="noopener noreferrer" class="source-chip-link"><span>NFL Combine</span>${iconSvg('externalLink', 10)}</a>
          <a href="https://ras.football/" target="_blank" rel="noopener noreferrer" class="source-chip-link"><span>RAS.football</span>${iconSvg('externalLink', 10)}</a>
          <a href="https://www.mockdraftable.com/" target="_blank" rel="noopener noreferrer" class="source-chip-link"><span>MockDraftable</span>${iconSvg('externalLink', 10)}</a>
        </div>
      </div>
      ${
        combineWindow.isBlankWindow
          ? `
        <div class="subcard-panel combine-blank-panel" data-combine-blank-note>
          <div style="display:flex;justify-content:space-between;align-items:center;gap:6px;flex-wrap:wrap;margin-bottom:3px">
            <strong style="font-size:12.5px;color:var(--gold-bright)">Blank Until ${combineWindow.targetCombineYear} NFL Scouting Combine Starts</strong>
            <span class="badge badge-neutral mono">Opens ${esc(combineWindow.combineStartDisplay)}</span>
          </div>
          <div style="font-size:12px;color:var(--text-secondary)">
            Cleared after preseason kickoff so prior-year NFL Combine results never mix with the ${combineWindow.targetCombineYear} prospect class. Live 40-yard dash, 10-yard split, jumps, 3-cone, and ${jargonTerm('RAS', 'ras')} percentiles populate once drills begin in Indianapolis.
          </div>
        </div>
      `
          : `
        <div class="search-input-wrap" style="margin-bottom:8px">
          ${iconSvg('search', 15, 'search-input-icon')}
          <input type="search" id="combineSearchInput" class="text-input has-lead-icon"
                 placeholder="Filter Combine athletes by name, position, college…" value="${esc(combineSearch)}" aria-label="Search Combine Results" />
        </div>
        <div class="table-scroll">
          <table class="data-table mono">
            <thead><tr><th>Athlete</th><th>Pos</th><th>School</th><th>Ht / Wt</th><th>40-Yd</th><th>Vert</th><th>3-Cone</th><th>${jargonTerm('RAS', 'ras')}</th></tr></thead>
            <tbody>
              ${filteredCombine
                .slice(0, 35)
                .map(c => {
                  const sfMatch = c.playerId ? { id: c.playerId } : lookupRosterPlayerByName(c.name);
                  const fallbackPfr = `https://www.pro-football-reference.com/search/search.fcgi?search=${encodeURIComponent(c.name || '')}`;
                  const safeProfUrl = sanitizeExternalUrl(c.profileUrl, fallbackPfr);
                  const athleteCellHtml = sfMatch?.id
                    ? `<span class="inline-player-link" role="button" tabindex="0" data-action="open-player-sheet" data-player-id="${esc(sfMatch.id)}" data-initial-tab="spider">${esc(c.name)}</span>`
                    : `<a href="${esc(safeProfUrl)}" target="_blank" rel="noopener noreferrer" class="ext-link"><strong>${esc(c.name)}</strong> ${iconSvg('externalLink', 9)}</a>`;
                  return `
                <tr>
                  <td style="font-family:var(--font-sans)">${athleteCellHtml}</td>
                  <td>${esc(c.pos)}</td>
                  <td style="font-family:var(--font-sans)">${esc(c.school)}</td>
                  <td>${esc(c.ht)} / ${c.wt ?? '—'}</td>
                  <td>${c.forty ?? '—'}</td>
                  <td>${c.vertical ?? '—'}</td>
                  <td>${c.threeCone ?? '—'}</td>
                  <td><span class="badge badge-positive">${Number(c.ras).toFixed(2)}</span></td>
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

function renderDraftClassAndUdfas(appData, expandedDraftSpiderIdx, activeVideosSet) {
  const dc = appData?.seasonal?.draftClass2026 || {};
  const draftYear = Number(dc.draftYear) || Number(appData?.meta?.seasonYear) || 2026;
  const pfrDraftUrl = sanitizeExternalUrl(dc.sourceUrl, null) || buildPfrTeamDraftUrl('SF', draftYear);
  const picks = dc.picks || [];
  const udfas = dc.priorityUdfas || [];

  return `
    <section class="card">
      <div class="card-header">
        <div class="card-header-left">
          <div class="card-icon-badge" aria-hidden="true">${iconSvg('radar', 18)}</div>
          <div class="card-title-group">
            <h2 class="card-title">${draftYear} Draft Class (${picks.length} Picks)</h2>
          </div>
        </div>
        <div class="source-link-strip">
          <a href="${esc(pfrDraftUrl)}" target="_blank" rel="noopener noreferrer" class="source-chip-link"><span>PFR Draft</span>${iconSvg('externalLink', 11)}</a>
          <a href="${esc(dc.otcDraftUrl || 'https://overthecap.com/draft')}" target="_blank" rel="noopener noreferrer" class="source-chip-link"><span>OTC Rookie Pool</span>${iconSvg('externalLink', 11)}</a>
        </div>
      </div>

      <div style="display:flex;flex-direction:column;gap:10px">
        ${picks
          .map((pk, idx) => {
            const vidKey = `draft26_${pk.pick}_${pk.highlightVideo?.videoId || idx}`;
            const isVidPlaying = activeVideosSet.has(vidKey);
            const isSpiderOpen = expandedDraftSpiderIdx === idx;
            const stealBadge =
              pk.stealDelta > 0
                ? `<span class="badge badge-positive mono">+${pk.stealDelta} Value Steal (Board #${pk.consensusBigBoardRank})</span>`
                : `<span class="badge badge-gold mono">Board #${pk.consensusBigBoardRank}</span>`;

            return `
              <div class="brief-card">
                <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap">
                  <div style="display:flex;align-items:center;gap:9px;min-width:0">
                    <span style="cursor:${pk.playerId ? 'pointer' : 'default'};display:inline-flex" ${pk.playerId ? `data-action="open-player-sheet" data-player-id="${esc(pk.playerId)}"` : ''}>
                      ${renderPlayerAvatarHtml({ name: pk.name, jersey: pk.jersey, headshotUrl: pk.headshotUrl }, 40, { showJerseyBadge: pk.jersey != null })}
                    </span>
                    <div style="min-width:0">
                      <span class="badge badge-scarlet mono">Rd ${pk.round} • Pick #${pk.pick}</span>
                      ${
                        pk.playerId
                          ? `<span class="inline-player-link" role="button" tabindex="0" style="font-size:14.5px;margin-left:5px" data-action="open-player-sheet" data-player-id="${esc(pk.playerId)}">${esc(pk.name)}</span>`
                          : `<strong style="font-size:14.5px;margin-left:5px">${esc(pk.name)}</strong>`
                      }
                      <span style="color:var(--gold-bright);font-weight:700"> ${esc(pk.position)} • ${esc(pk.college)}</span>
                      ${
                        pk.pfrUrl
                          ? `<a href="${esc(pk.pfrUrl)}" target="_blank" rel="noopener noreferrer" class="ext-link" style="font-size:11px;margin-left:6px">PFR ${iconSvg('externalLink', 10)}</a>`
                          : ''
                      }
                    </div>
                  </div>
                  ${stealBadge}
                </div>

                <div style="font-size:12.5px;color:var(--text-secondary)">${escJargon(pk.roleSummary, { excludePlayerId: pk.playerId })}</div>

                <ul class="brief-bullets">
                  ${(pk.strengths || []).map(s => `<li>${escJargon(s, { excludePlayerId: pk.playerId })}</li>`).join('')}
                </ul>

                <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap">
                  <span class="mono" style="font-size:11.5px;color:var(--text-muted)">Est. 4-Yr Deal: ${formatCompactDollars(pk.estimated4YrRookieTotal)}</span>
                  <button type="button" class="btn-ghost" data-action="toggle-draft-spider" data-draft-idx="${idx}">
                    ${iconSvg(isSpiderOpen ? 'chevronUp' : 'radar', 13)}
                    <span>${isSpiderOpen ? 'Hide Spider Chart' : 'Athletic Spider Chart'}</span>
                  </button>
                </div>

                ${isSpiderOpen ? renderSpiderChartHtml(pk.spiderProfile, pk.name) : ''}

                ${
                  pk.highlightVideo?.videoId
                    ? renderVideoEmbedOrFacade(
                        vidKey,
                        pk.highlightVideo.videoId,
                        0,
                        pk.highlightVideo.title || `${pk.name} College Highlights`,
                        pk.highlightVideo.channel,
                        isVidPlaying,
                        pk.highlightVideo.embeddable !== false
                      )
                    : ''
                }
              </div>
            `;
          })
          .join('')}
      </div>
    </section>

    <section class="card">
      <h3 class="card-title" style="margin-bottom:8px">Priority ${jargonTerm('UDFAs', 'udfa')} (${udfas.length})</h3>
      <div style="display:flex;flex-direction:column;gap:9px">
        ${udfas
          .map((u, idx) => {
            const vidKey = `udfa26_${idx}_${u.highlightVideo?.videoId || idx}`;
            return `
              <div class="brief-card">
                <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap">
                  <div style="display:flex;align-items:center;gap:9px;min-width:0">
                    <span style="cursor:${u.playerId ? 'pointer' : 'default'};display:inline-flex" ${u.playerId ? `data-action="open-player-sheet" data-player-id="${esc(u.playerId)}"` : ''}>
                      ${renderPlayerAvatarHtml({ name: u.displayName || u.name, jersey: u.jersey, headshotUrl: u.headshotUrl }, 38, { showJerseyBadge: u.jersey != null })}
                    </span>
                    <div>
                      ${
                        u.playerId
                          ? `<span class="inline-player-link" role="button" tabindex="0" data-action="open-player-sheet" data-player-id="${esc(u.playerId)}">${esc(u.displayName || u.name)} (${esc(u.position)})</span>`
                          : `<strong>${esc(u.displayName || u.name)} (${esc(u.position)})</strong>`
                      }
                      ${
                        u.otcUrl
                          ? `<a href="${esc(u.otcUrl)}" target="_blank" rel="noopener noreferrer" class="ext-link" style="font-size:11px;margin-left:6px">OTC ${iconSvg('externalLink', 10)}</a>`
                          : ''
                      }
                    </div>
                  </div>
                  <span class="badge badge-gold mono">${formatCompactDollars(u.guaranteedTotal)} Guaranteed</span>
                </div>
                <div style="font-size:12px;color:var(--emerald)">${esc(u.rosterOddsNote)}</div>
                <div style="font-size:12.5px;color:var(--text-secondary)">${escJargon(u.roleSummary, { excludePlayerId: u.playerId })}</div>
                ${
                  u.highlightVideo?.videoId
                    ? renderVideoEmbedOrFacade(
                        vidKey,
                        u.highlightVideo.videoId,
                        0,
                        u.highlightVideo.title,
                        u.highlightVideo.channel,
                        activeVideosSet.has(vidKey),
                        u.highlightVideo.embeddable !== false
                      )
                    : ''
                }
              </div>
            `;
          })
          .join('')}
      </div>
    </section>
  `;
}
