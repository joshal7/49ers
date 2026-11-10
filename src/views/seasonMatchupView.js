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
  playProbBadgeClass,
  rankBadgeClass,
  renderPlayerAvatarHtml,
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
import { partitionCompletedTradesByWindow } from '../engine/seasonStateMachine.js';
import {
  buildPfrTeamDraftUrl,
  buildPfrTeamSeasonUrl,
  sanitizeExternalUrl
} from '../engine/linkIntegrity.js';
import {
  evaluateGameDayWindow,
  resolveGameDayInjuryRows,
  resolveTeamGameDayModel
} from '../engine/gameDayRosterEngine.js';

function formatPracCell(val) {
  const s = String(val ?? '').trim();
  return !s || s === '-' ? '—' : s;
}

function formatOppImportanceTag(op) {
  const snap = Number(op?.snapPct || 0);
  const isStarter = Boolean(op?.isStarter) || snap >= 58 || /starter|pro bowl|all-pro|wr1|wr2|qb1|rb1|te1|cb1|lt|rt/i.test(String(op?.archetypeNote || ''));
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
  expandedDraftSpiderIdx = -1,
  activeVideosSet,
  schedulePrevExpanded = false,
  matchupStatsUnit = 'offense'
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
  if (seasonSub === 'health') return switcherCard + renderTeamHealthAndIr(appData);
  if (seasonSub === 'stats') return switcherCard + renderTeamStatsAndPower(appData);
  if (seasonSub === 'trade') return switcherCard + renderTradeWindow(appData);
  if (seasonSub === 'playoffs') return switcherCard + renderPlayoffSimulator(appData, mcSimResult, forcedWinners);
  if (seasonSub === 'schedule') return switcherCard + renderFullSchedule(appData, schedulePrevExpanded);
  if (seasonSub === 'draft_prep') return switcherCard + renderDraftPrepAndCombine(appData, combineSearch);
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
            <span>Detailed ${esc(activeUnit.shortLabel)} Breakdown (${expandedCount} Metrics)</span>
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
  const oppHealthyStarters = oppHealth.keyStartersHealthy || [];
  const oppIrList = oppHealth.irReserve || [];
  const sfGameDay = resolveTeamGameDayModel(appData, { is49ers: true, windowState: sharedWin });
  const rawSfPr = appData?.health?.practiceReport || [];
  const sfPr = (sfGameDay?.isActive ? resolveGameDayInjuryRows(rawSfPr, sfGameDay) : rawSfPr).slice(0, 5);

  const resolvedOppSummary = oppGameDay?.isActive
    ? {
        ...oppHealth.summary,
        questionableOrDoubtfulCount: oppInjReport.filter(r =>
          /questionable|doubtful|gtd/i.test(String(r.gameStatus || ''))
        ).length,
        ruledOutCount: Math.max(
          oppHealth.summary?.ruledOutCount ?? 0,
          oppInjReport.filter(
            r => /^(?:out|inactive)/i.test(String(r.gameStatus || '')) || r.playProbabilityPct === 0
          ).length
        )
      }
    : oppHealth.summary;

  const sfIsAway = um.homeAway === 'away';
  const sfRecShort = um.sfRecord?.split(' ')[0] || appData?.meta?.teamRecord || '—';
  const oppShortName = (um.oppName || 'Opponent').split(' ').slice(-1)[0] || um.oppName || 'Opponent';
  const matchupHeadline = sfIsAway
    ? `49ers (${sfRecShort}) @ ${um.oppName} (${um.oppRecord})`
    : `${um.oppName} (${um.oppRecord}) @ 49ers (${sfRecShort})`;
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
            <div class="card-eyebrow">Week ${um.week} Upcoming Matchup • ${esc(um.kickoffDisplay)}</div>
            <h2 class="card-title">${esc(matchupHeadline)}</h2>
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
        <span class="sb-vs-pill mono">@ WK ${um.week || ''}</span>
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
            <div class="card-eyebrow">Opponent Availability • Bye Wk ${oppHealth.byeWeek || 13}</div>
            <h3 class="card-title">${esc(um.oppName)} Health &amp; Play Odds</h3>
          </div>
        </div>
        <div class="source-link-strip">
          <a href="${esc(oppHealth.teamInjuriesUrl || um.injurySourceUrl || 'https://www.espn.com/nfl/injuries')}" target="_blank" rel="noopener noreferrer" class="source-chip-link">
            <span>${esc(um.oppAbbr || 'OPP')} Injuries</span>${iconSvg('externalLink', 11)}
          </a>
        </div>
      </div>

      <div class="kpi-grid kpi-grid-2" style="margin-bottom:10px">
        <div class="kpi-box">
          <div class="kpi-label">Availability Index</div>
          <div class="kpi-val mono" style="color:var(--emerald)">${resolvedOppSummary?.overallAvailabilityScore ?? 85}/100</div>
          ${renderMiniMeterHtml(resolvedOppSummary?.overallAvailabilityScore ?? 85, 'emerald')}
        </div>
        <div class="kpi-box">
          <div class="kpi-label">Starters Cleared</div>
          <div class="kpi-val mono">${resolvedOppSummary?.activeStartersHealthy ?? 19}/${resolvedOppSummary?.totalStarters ?? 22}</div>
        </div>
        <div class="kpi-box">
          <div class="kpi-label">Questionable / GTD</div>
          <div class="kpi-val mono" style="color:var(--gold-bright)">${resolvedOppSummary?.questionableOrDoubtfulCount ?? 0}</div>
        </div>
        <div class="kpi-box">
          <div class="kpi-label">Ruled Out / ${jargonTerm('IR', 'ir')}</div>
          <div class="kpi-val mono" style="color:var(--crimson)">${resolvedOppSummary?.ruledOutCount ?? 0} Out • ${resolvedOppSummary?.irCount ?? oppIrList.length} IR</div>
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
            <div class="sub-label" style="margin-bottom:6px">Week ${um.week || 9} Practice Participation &amp; Modeled Play Likelihood</div>
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
                      <td>
                        <div>${esc(op.injuryType || op.gameStatus || 'Undisclosed')}</div>
                        ${
                          op.gameStatus && !/^(?:active|in\b)/i.test(String(op.gameStatus))
                            ? `<div style="font-size:10.5px;color:var(--text-muted)">${esc(op.gameStatus)}</div>`
                            : ''
                        }
                      </td>
                      <td class="mono">${esc(formatPracCell(op.wed))} / ${esc(formatPracCell(op.thu))} / ${esc(formatPracCell(op.fri))}</td>
                      <td><span class="badge ${playProbBadgeClass(op.playProbabilityPct)} mono">${esc(op.playBadgeLabel)}</span></td>
                    </tr>
                  `
                    )
                    .join('')}
                </tbody>
              </table>
            </div>

            <details class="compact-details" style="margin-bottom:10px">
              <summary class="compact-details-summary">
                <span>${esc(um.oppAbbr || 'OPP')} Beat Notes &amp; Availability Context (${oppInjReport.length})</span>
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
                <span>Key ${esc(um.oppName)} Starters Cleared (${oppHealthyStarters.length})</span>
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
                <span>${esc(um.oppAbbr || 'OPP')} IR &amp; 4-Game Return Window Tracker (${oppIrList.length})</span>
              </summary>
              <div style="display:flex;flex-direction:column;gap:6px;margin-top:6px">
                ${oppIrList
                  .map(ir => {
                    const meta = formatIrCardBadgeAndSubtitle(ir, appData?.meta?.seasonYear || 2026);
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

    <section class="card">
      <div class="card-eyebrow">Opposing Coaching Staff Tendencies</div>
      <h3 class="card-title" style="margin-bottom:8px">${escJargon(um.coachingMatchup?.headline)}</h3>
      <p style="margin:0 0 8px;font-size:13px;color:var(--text-secondary)">${escJargon(um.coachingMatchup?.summary)}</p>
      <ul class="brief-bullets">
        ${(um.coachingMatchup?.bullets || []).map(b => `<li>${escJargon(b)}</li>`).join('')}
      </ul>
    </section>

    <section class="card">
      <div class="card-eyebrow">Trench &amp; Coverage Mismatches</div>
      <h3 class="card-title" style="margin-bottom:8px">Key Matchup Matrix</h3>
      <div style="display:flex;flex-direction:column;gap:8px">
        ${(um.keyMatchupsMatrix || [])
          .map(
            m => `
          <div class="subcard-panel">
            <div style="display:flex;justify-content:space-between;align-items:center;gap:6px;flex-wrap:wrap;margin-bottom:4px">
              <strong style="font-size:13px">${esc(m.unitMatchup)}</strong>
              <span class="badge badge-positive">${esc(m.advantage)}</span>
            </div>
            <div style="font-size:12.5px;color:var(--text-secondary)">${escJargon(m.tacticalDetail || '')}</div>
          </div>
        `
          )
          .join('')}
      </div>
    </section>

    <section class="card">
      <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:8px">
        <div>
          <div class="card-eyebrow">Recent Franchise History (${esc(um.franchiseHistory?.recentRecord)})</div>
          <h3 class="card-title">49ers vs. ${esc(oppShortName)} Recent Meetings</h3>
        </div>
        <a href="${esc(um.franchiseHistory?.pfrQueryUrl || 'https://www.pro-football-reference.com/teams/sfo/head-to-head.htm')}" target="_blank" rel="noopener noreferrer" class="source-chip-link">
          <span>PFR Box Scores</span>${iconSvg('externalLink', 11)}
        </a>
      </div>
      <div style="font-size:12px;color:var(--text-secondary);margin-bottom:8px">${escJargon(um.franchiseHistory?.lastMeetingNote)}</div>
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

function formatIrCardBadgeAndSubtitle(ir, seasonYear = 2026) {
  const projRaw =
    typeof ir.projectedReturnWeek === 'number'
      ? `Est. Week ${ir.projectedReturnWeek}`
      : String(ir.projectedReturnWeek || 'TBD').trim();
  const isSeasonEnd = Boolean(ir.isSeasonEnding) || /^out for (?:the )?(?:\d{4} )?season$/i.test(projRaw);

  if (isSeasonEnd) {
    return {
      badgeClass: 'badge-danger',
      badgeText: `Out for ${seasonYear} Season`,
      subtitleHtml: `${esc(ir.status || 'Season-Ending IR')} • ${esc(ir.byeWeekNote || `Ineligible to return in ${seasonYear}`)}`
    };
  }

  if (ir.isPracticeWindowOpen) {
    const badgeLabel = /^est\.|^week\s/i.test(projRaw) ? projRaw : `Est. Return: ${projRaw}`;
    return {
      badgeClass: 'badge-positive',
      badgeText: badgeLabel,
      subtitleHtml: `${esc(ir.status || 'IR — 21-Day Window Open')}${
        ir.earliestEligibleWeek ? ` • Earliest Eligible: Wk ${ir.earliestEligibleWeek}` : ''
      }${ir.byeWeekNote ? ` (${esc(ir.byeWeekNote)})` : ''}`
    };
  }

  if (!ir.earliestEligibleWeek) {
    return {
      badgeClass: 'badge-neutral',
      badgeText: projRaw,
      subtitleHtml: `${esc(ir.status || 'Reserve')}${ir.byeWeekNote ? ` • ${esc(ir.byeWeekNote)}` : ''}`
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
      ir.byeWeekNote ? ` (${esc(ir.byeWeekNote)})` : ''
    }`
  };
}

function renderTeamHealthAndIr(appData) {
  const h = appData?.health || {};
  const sfGameDay = resolveTeamGameDayModel(appData, { is49ers: true });
  const rawSfReport = h.practiceReport || [];
  const sfReport = sfGameDay?.isActive
    ? resolveGameDayInjuryRows(rawSfReport, sfGameDay)
    : rawSfReport;

  return `
    ${renderGameDayRosterCard(sfGameDay, {
      is49ers: true,
      asSubcard: false,
      teamName: '49ers',
      teamAbbr: 'SF',
      teamLogoUrl: appData?.scheduleMatchup?.upcomingMatchup?.sfLogoUrl
    })}

    <section class="card">
      <div class="card-header">
        <div class="card-header-left">
          <div class="card-icon-badge" aria-hidden="true">${iconSvg('heartPulse', 18)}</div>
          <div class="card-title-group">
            <div class="card-eyebrow">Practice Participation &amp; Player Availability</div>
            <h2 class="card-title">Week ${h.week || 9} Practice &amp; Play Likelihood</h2>
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

      <div style="font-size:11.5px;color:var(--text-muted);margin-bottom:8px">
        Tap any player for full injury &amp; contract dossier • ${jargonTerm('DNP', 'dnp')} / ${jargonTerm('LP', 'lp')} / ${jargonTerm('FP', 'fp')}
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
                <td><span class="badge ${playProbBadgeClass(p.playProbabilityPct)} mono">${esc(p.playBadgeLabel)}</span></td>
              </tr>
            `
              )
              .join('')}
          </tbody>
        </table>
      </div>
    </section>

    <section class="card">
      <div class="card-eyebrow">NFL 4-Game Minimum Rule (Week ${h.byeWeek || 8} Bye Excluded)</div>
      <h3 class="card-title" style="margin-bottom:8px">IR &amp; Reserve Return Window Tracker (${(h.irAndReserveTracker || []).length})</h3>
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
                      <span class="unit-overall-heading">${esc(u.overall?.label || 'Overall Unit Rank')}</span>
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
          <div class="card-eyebrow">${esc(pwr.weekLabel)}</div>
          <h2 class="card-title">Aggregated NFL Power Rankings</h2>
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
            <div class="card-eyebrow">Oct 1 – Trade Deadline • ${esc(tw.deadlineDisplay)}</div>
            <h2 class="card-title">NFL Trade Window</h2>
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
        <div class="sub-label" style="margin-bottom:6px">Purchasing Power &amp; 2027 Cap / Draft Constraints</div>
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
        <div class="sub-label" style="margin:0">Completed Impact Acquisitions (Last 30 Days)</div>
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

      <div class="sub-label" style="margin-bottom:6px">Remaining Pre-Deadline Needs</div>
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
      <div class="card-eyebrow">${Math.max(1, Math.min(18, 18 - (Number(appData?.meta?.currentWeek) || 9)))}/18ths Pro-Rated Base Salary &amp; ${jargonTerm('Rich Hill', 'rich_hill')} Pick Costs</div>
      <h3 class="card-title" style="margin-bottom:8px">Seller-Team Target Fit Matrix</h3>
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
                        ? `<a href="${esc(t.sourceUrl)}" target="_blank" rel="noopener noreferrer" class="ext-link"><strong>${esc(t.name)} (${esc(t.position)})</strong></a>`
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
                    ${
                      t.sourceUrl
                        ? `<a href="${esc(t.sourceUrl)}" target="_blank" rel="noopener noreferrer" class="ext-link" style="font-size:11px;margin-left:4px">OTC Contract ${iconSvg('externalLink', 10)}</a>`
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
        <div class="card-eyebrow">Front Office Discipline • Multi-Year Cap &amp; Pick Guardrails</div>
        <h3 class="card-title" style="margin-bottom:8px">Pitfalls &amp; Trap Targets to Avoid</h3>
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
      <div class="card-eyebrow">Beat &amp; National Insider Reports</div>
      <h3 class="card-title" style="margin-bottom:8px">Trade Window Updates &amp; Front Office Notes</h3>
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

function renderPlayoffSimulator(appData, mcSimResult, forcedWinners) {
  const pp = appData?.seasonal?.playoffPicture || {};
  const sim = mcSimResult || pp.baselineSimulation || {};
  const sf = sim.sfOdds || {};
  const seeds = sf.seedDistribution || {};
  const overrideCount = Object.keys(forcedWinners || {}).length;

  return `
    <section class="card temporal-highlight">
      <div class="card-header">
        <div class="card-header-left">
          <div class="card-icon-badge temporal" aria-hidden="true">${iconSvg('trophy', 18)}</div>
          <div class="card-title-group">
            <div class="card-eyebrow">10,000-Iteration ${jargonTerm('Monte Carlo', 'monte_carlo')} • Official NFL Tiebreakers</div>
            <h2 class="card-title">49ers Playoff &amp; Seeding Probabilities</h2>
          </div>
        </div>
        <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap">
          <a href="https://www.nfl.com/standings/playoff-picture" target="_blank" rel="noopener noreferrer" class="source-chip-link"><span>NFL Playoff Picture</span>${iconSvg('externalLink', 11)}</a>
          ${
            overrideCount > 0
              ? `<button type="button" class="btn-ghost" data-action="reset-playoff-overrides">${iconSvg('reset', 13)}<span>Clear (${overrideCount})</span></button>`
              : `<span class="badge badge-gold mono">10,000 Runs</span>`
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

      <div class="sub-label" style="margin:10px 0 6px">Exact NFC Seed Distribution (Proj. ${sf.projectedWins ?? 12.0} Wins)</div>
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
          <div class="card-eyebrow">Tap Any Team to Lock Winner &amp; Re-Run 10,000 Simulations</div>
          <h3 class="card-title">Interactive Rooting Guide &amp; Scenario Toggler</h3>
        </div>
      </div>

      <div style="display:flex;flex-direction:column;gap:7px">
        ${(pp.rootingLeverage || [])
          .map(g => {
            const picked = forcedWinners?.[g.gameId] || null;
            return `
              <div class="scenario-game-row">
                <div style="min-width:0">
                  <div style="font-weight:700;font-size:13px">
                    Wk ${g.week}: ${esc(g.matchupLabel)}
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
          })
          .join('')}
      </div>
    </section>

    <section class="card">
      <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:8px">
        <div>
          <div class="card-eyebrow">Explicit Seeding Scenarios</div>
          <h3 class="card-title">Paths to #1 Seed &amp; Division Crown</h3>
        </div>
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

      <div class="sub-label" style="margin-bottom:6px">Full 16-Team NFC Simulated Standings</div>
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
  const restBadge =
    g.restAdvantageDays > 0
      ? `<span class="badge badge-positive mono">+${g.restAdvantageDays}d Rest</span>`
      : g.restAdvantageDays < 0
        ? `<span class="badge badge-danger mono">${g.restAdvantageDays}d Rest</span>`
        : '';
  const isLiveInGame =
    !g.completed &&
    (g.statusState === 'in' ||
      /\b(q1|q2|q3|q4|1st|2nd|3rd|4th|halftime|in progress|ot|overtime)\b/i.test(String(g.statusDetail || '')));
  const currentBadge =
    !g.completed && isCurrentGame
      ? `<span class="badge ${isLiveInGame ? 'badge-danger' : 'badge-gold'} mono">${isLiveInGame ? 'LIVE' : 'Next Up'}</span>`
      : '';
  const borderColor = g.venue?.isInternational
    ? 'var(--gold-border)'
    : isCurrentGame && !g.completed
      ? 'var(--gold-border)'
      : 'var(--border-subtle)';

  return `
    <div data-schedule-game-row="${g.completed ? 'previous' : 'upcoming'}" data-schedule-week="${g.week}" style="padding:10px 11px;border-radius:10px;background:var(--bg-card-alt);border:1px solid ${borderColor}">
      <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap">
        <div style="display:flex;align-items:center;gap:8px;min-width:0">
          ${renderTeamLogoHtml(g.opponent?.abbr || 'NFL', g.oppLogoUrl || g.opponent?.logoUrl, 28)}
          <div style="min-width:0">
            <span class="mono" style="color:var(--gold-bright);font-weight:800">WK ${g.week}</span> •
            ${
              g.gameUrl
                ? `<a href="${esc(g.gameUrl)}" target="_blank" rel="noopener noreferrer" class="ext-link" style="color:var(--text-primary)"><strong>${g.homeAway === 'home' ? 'vs.' : '@'} ${esc(g.opponent?.name)}</strong></a>`
                : `<strong>${g.homeAway === 'home' ? 'vs.' : '@'} ${esc(g.opponent?.name)}</strong>`
            }
            <span class="mono" style="font-size:11.5px;color:var(--text-muted)">(${esc(g.opponent?.record)})</span>
          </div>
        </div>
        <div style="display:flex;gap:5px;align-items:center;flex-wrap:wrap">
          ${currentBadge}
          ${restBadge}
          ${
            g.completed
              ? `<span class="badge ${g.result === 'W' ? 'badge-positive' : g.result === 'T' ? 'badge-warning' : 'badge-danger'} mono">${g.result} ${g.sfScore}-${g.oppScore}</span>`
              : `<span class="badge badge-neutral mono">${esc(g.statusDetail)}</span>`
          }
          ${
            g.gameUrl
              ? `<a href="${esc(g.gameUrl)}" target="_blank" rel="noopener noreferrer" class="source-chip-link"><span>${g.completed ? 'Box Score' : 'Gamecast'}</span>${iconSvg('externalLink', 10)}</a>`
              : ''
          }
        </div>
      </div>
      <div class="inline-icon-meta" style="margin-top:4px">
        ${iconSvg('stadium', 13)}
        <span>${esc(g.venue?.name)} (${esc(g.venue?.city)}) • ${esc(g.venue?.surface)}
        ${g.spreadLineSf != null && !g.completed ? ` • Line: <strong class="mono">SF ${g.spreadLineSf > 0 ? '+' : ''}${g.spreadLineSf}</strong>` : ''}</span>
      </div>
      ${
        g.venue?.internationalNote
          ? `<div style="margin-top:4px;font-size:11.5px;color:var(--gold-bright);font-weight:700">${esc(g.venue.internationalNote)}</div>`
          : ''
      }
    </div>
  `;
}

function renderFullSchedule(appData, schedulePrevExpanded = false) {
  const sched = appData?.scheduleMatchup?.schedule || [];
  const seasonYr = Number(appData?.meta?.seasonYear) || 2026;
  const previousGames = sched.filter(g => Boolean(g?.completed));
  const currentAndFutureGames = sched.filter(g => g && !g.completed);

  const prevWins = previousGames.filter(g => g.result === 'W').length;
  const prevLosses = previousGames.filter(g => g.result === 'L').length;
  const prevTies = previousGames.filter(g => g.result === 'T').length;
  const prevRecordStr = prevTies > 0 ? `${prevWins}-${prevLosses}-${prevTies}` : `${prevWins}-${prevLosses}`;
  const prevRangeLabel =
    previousGames.length === 1
      ? `Wk ${previousGames[0].week}`
      : previousGames.length > 1
        ? `Wk ${previousGames[0].week}–${previousGames[previousGames.length - 1].week}`
        : '';

  const previousGamesBoxHtml =
    previousGames.length > 0
      ? `
        <details class="schedule-prev-collapsible" data-schedule-previous-games${schedulePrevExpanded ? ' open' : ''}>
          <summary class="schedule-prev-summary" data-schedule-previous-summary>
            <span class="schedule-prev-summary-main">
              <span>Previous Games (${previousGames.length})</span>
              <span class="badge ${prevWins >= prevLosses ? 'badge-positive' : 'badge-neutral'} mono">${esc(prevRecordStr)}</span>
            </span>
            <span class="schedule-prev-summary-sub mono">${esc(prevRangeLabel)}</span>
          </summary>
          <div class="schedule-prev-list" data-schedule-previous-list>
            ${previousGames.map(g => renderScheduleGameRowHtml(g, { isCurrentGame: false })).join('')}
          </div>
        </details>
      `
      : '';

  const upcomingListHtml =
    currentAndFutureGames.length > 0
      ? `
        <div class="schedule-upcoming-list" data-schedule-upcoming-list style="display:flex;flex-direction:column;gap:8px">
          ${currentAndFutureGames
            .map((g, idx) => renderScheduleGameRowHtml(g, { isCurrentGame: idx === 0 }))
            .join('')}
        </div>
      `
      : `<div class="subcard-panel" data-schedule-upcoming-list style="font-size:12.5px;color:var(--text-secondary)">All ${seasonYr} regular-season games are complete. Expand <strong>Previous Games</strong> above to review results and box scores.</div>`;

  return `
    <section class="card">
      <div class="card-header">
        <div class="card-header-left">
          <div class="card-icon-badge" aria-hidden="true">${iconSvg('calendar', 18)}</div>
          <div class="card-title-group">
            <div class="card-eyebrow">${seasonYr} Regular Season • Current &amp; Upcoming Slate</div>
            <h2 class="card-title">49ers Schedule &amp; Venue Tracker</h2>
          </div>
        </div>
        <a href="https://www.espn.com/nfl/team/schedule/_/name/sf/san-francisco-49ers" target="_blank" rel="noopener noreferrer" class="source-chip-link">
          <span>ESPN Schedule</span>${iconSvg('externalLink', 11)}
        </a>
      </div>

      ${previousGamesBoxHtml}
      ${upcomingListHtml}
    </section>
  `;
}

function renderDraftPrepAndCombine(appData, combineSearch) {
  const dp = appData?.seasonal?.draftPrep2027 || {};
  const nextDraftYr = Number(dp.draftYear) || (Number(appData?.meta?.seasonYear) || 2026) + 1;
  const q = String(combineSearch || '').toLowerCase().trim();
  const filteredCombine = (dp.combineLeaderboard || []).filter(
    c => !q || c.name.toLowerCase().includes(q) || c.pos.toLowerCase().includes(q) || c.school.toLowerCase().includes(q)
  );

  return `
    <section class="card">
      <div class="card-header">
        <div class="card-header-left">
          <div class="card-icon-badge" aria-hidden="true">${iconSvg('compass', 18)}</div>
          <div class="card-title-group">
            <div class="card-eyebrow">2-Year Cap &amp; Roster Horizon</div>
            <h2 class="card-title">${nextDraftYr} NFL Draft &amp; Pick Inventory</h2>
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

      <div class="sub-label" style="margin-bottom:6px">49ers ${Number(dp.draftYear) || 2027} Draft Pick Capital (${(dp.pickInventory || []).length} Picks)</div>
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

    <section class="card">
      <div class="card-eyebrow">Aggregated Mock Consensus + Shanahan/Lynch Fit</div>
      <h3 class="card-title" style="margin-bottom:8px">Top Projected 49ers Prospect Fits</h3>
      <div style="display:flex;flex-direction:column;gap:8px">
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
              : m.sourceUrl
                ? `<a href="${esc(m.sourceUrl)}" target="_blank" rel="noopener noreferrer" class="ext-link"><strong>${esc(m.name)} (${esc(m.pos)} • ${esc(m.school)})</strong> ${iconSvg('externalLink', 11)}</a>`
                : `<strong>${esc(m.name)} (${esc(m.pos)} • ${esc(m.school)})</strong>`;
            return `
          <div class="subcard-panel">
            <div style="display:flex;justify-content:space-between;align-items:center;gap:6px;flex-wrap:wrap">
              ${headerLinksHtml}
              <span class="badge badge-positive mono">SF Fit ${m.shanahanLynchFitScore}/100 • ${m.mockFrequencyToSfPct}% Mocks</span>
            </div>
            <div style="font-size:11.5px;color:var(--gold-bright);margin:2px 0">${esc(m.heightWeight)} • Mocked by: ${renderReporterSourceLinksHtml(m.sourcesMocking || [], m.sourceUrl)}</div>
            <div style="font-size:12.5px;color:var(--text-secondary)">${escJargon(m.archetypeTraits)}</div>
          </div>
        `;
          })
          .join('')}
      </div>
    </section>

    <section class="card">
      <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:8px">
        <div>
          <div class="card-eyebrow">NFL Scouting Combine Measurables &amp; ${jargonTerm('RAS', 'ras')} Leaderboard</div>
          <h3 class="card-title">Searchable Combine Results (${filteredCombine.length})</h3>
        </div>
        <div class="source-link-strip">
          <a href="https://www.nfl.com/combine/" target="_blank" rel="noopener noreferrer" class="source-chip-link"><span>NFL Combine</span>${iconSvg('externalLink', 10)}</a>
          <a href="https://ras.football/" target="_blank" rel="noopener noreferrer" class="source-chip-link"><span>RAS.football</span>${iconSvg('externalLink', 10)}</a>
          <a href="https://www.mockdraftable.com/" target="_blank" rel="noopener noreferrer" class="source-chip-link"><span>MockDraftable</span>${iconSvg('externalLink', 10)}</a>
        </div>
      </div>
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
            <div class="card-eyebrow">Draft Recap • Value vs. Consensus &amp; Film</div>
            <h2 class="card-title">${draftYear} 49ers Draft Class (${picks.length} Picks)</h2>
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
      <div class="card-eyebrow">Sorted by Guaranteed Contract Commitment</div>
      <h3 class="card-title" style="margin-bottom:8px">Priority Undrafted Free Agents (${jargonTerm('UDFAs', 'udfa')})</h3>
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
