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
  renderMiniMeterHtml
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
  activeVideosSet
}) {
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

  if (seasonSub === 'matchup') return switcherCard + renderUpcomingMatchup(appData);
  if (seasonSub === 'health') return switcherCard + renderTeamHealthAndIr(appData);
  if (seasonSub === 'stats') return switcherCard + renderTeamStatsAndPower(appData);
  if (seasonSub === 'trade') return switcherCard + renderTradeWindow(appData);
  if (seasonSub === 'playoffs') return switcherCard + renderPlayoffSimulator(appData, mcSimResult, forcedWinners);
  if (seasonSub === 'schedule') return switcherCard + renderFullSchedule(appData);
  if (seasonSub === 'draft_prep') return switcherCard + renderDraftPrepAndCombine(appData, combineSearch);
  return switcherCard + renderDraftClassAndUdfas(appData, expandedDraftSpiderIdx, activeVideosSet);
}

function renderUpcomingMatchup(appData) {
  const um = appData?.scheduleMatchup?.upcomingMatchup || {};
  const bet = um.betting || {};
  const oppHealth = um.opponentHealth || {};
  const oppInjReport = oppHealth.injuryReport || [];
  const oppHealthyStarters = oppHealth.keyStartersHealthy || [];
  const oppIrList = oppHealth.irReserve || [];
  const sfPr = (appData?.health?.practiceReport || []).slice(0, 5);

  const sfIsAway = um.homeAway === 'away';
  const sfRecShort = um.sfRecord?.split(' ')[0] || appData?.meta?.teamRecord || '—';
  const oppShortName = (um.oppName || 'Opponent').split(' ').slice(-1)[0] || um.oppName || 'Opponent';
  const matchupHeadline = sfIsAway
    ? `49ers (${sfRecShort}) @ ${um.oppName} (${um.oppRecord})`
    : `${um.oppName} (${um.oppRecord}) @ 49ers (${sfRecShort})`;
  const awayColHtml = sfIsAway
    ? `<div class="sb-team-col">
        ${renderTeamLogoHtml('SF', um.sfLogoUrl, 40)}
        <div class="sb-team-meta">
          <div class="sb-team-abbr">49ers</div>
          <div class="sb-team-rec mono">${esc(sfRecShort)}</div>
        </div>
      </div>`
    : `<div class="sb-team-col">
        ${renderTeamLogoHtml(um.oppAbbr || 'NFL', um.oppLogoUrl, 40)}
        <div class="sb-team-meta">
          <div class="sb-team-abbr">${esc(um.oppName || 'Opponent')}</div>
          <div class="sb-team-rec mono">${esc(um.oppRecord || '—')}</div>
        </div>
      </div>`;
  const homeColHtml = sfIsAway
    ? `<div class="sb-team-col home">
        <div class="sb-team-meta">
          <div class="sb-team-abbr">${esc(um.oppName || 'Opponent')}</div>
          <div class="sb-team-rec mono">${esc(um.oppRecord || '—')}</div>
        </div>
        ${renderTeamLogoHtml(um.oppAbbr || 'NFL', um.oppLogoUrl, 40)}
      </div>`
    : `<div class="sb-team-col home">
        <div class="sb-team-meta">
          <div class="sb-team-abbr">49ers</div>
          <div class="sb-team-rec mono">${esc(sfRecShort)}</div>
        </div>
        ${renderTeamLogoHtml('SF', um.sfLogoUrl, 40)}
      </div>`;

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
        <strong>Line Movement &amp; Rest:</strong> ${esc(bet.openingSpread)} • Moneyline <span class="mono">${esc(bet.moneyline)}</span> • <strong style="color:var(--gold-bright)">${esc(bet.restAdvantage)}</strong>
      </div>
    </section>

    <section class="card" id="opponentHealthSection">
      <div class="card-header">
        <div class="card-header-left">
          ${renderTeamLogoHtml(um.oppAbbr || 'LV', um.oppLogoUrl, 28)}
          <div class="card-title-group">
            <div class="card-eyebrow">Opposing Team Availability &amp; Play Likelihood • Bye Wk ${oppHealth.byeWeek || 13}</div>
            <h3 class="card-title">${esc(um.oppName)} Practice, Priors &amp; Play Odds</h3>
          </div>
        </div>
        <div class="source-link-strip">
          <a href="${esc(oppHealth.teamInjuriesUrl || um.injurySourceUrl || 'https://www.espn.com/nfl/injuries')}" target="_blank" rel="noopener noreferrer" class="source-chip-link">
            <span>${esc(um.oppAbbr || 'OPP')} Injury Wire</span>${iconSvg('externalLink', 11)}
          </a>
        </div>
      </div>

      <div style="font-size:12px;color:var(--text-secondary);margin-bottom:10px">
        Modeled at full parity with 49ers Health: combines Wed/Thu/Fri practice progression (${jargonTerm('DNP', 'dnp')} / ${jargonTerm('LP', 'lp')} / ${jargonTerm('FP', 'fp')}), veteran rest adjustments, snap share, and player toughness priors.
      </div>

      <div class="kpi-grid kpi-grid-2" style="margin-bottom:10px">
        <div class="kpi-box">
          <div class="kpi-label">Availability Index</div>
          <div class="kpi-val mono" style="color:var(--emerald)">${oppHealth.summary?.overallAvailabilityScore ?? 85}/100</div>
          ${renderMiniMeterHtml(oppHealth.summary?.overallAvailabilityScore ?? 85, 'emerald')}
        </div>
        <div class="kpi-box">
          <div class="kpi-label">Starters Cleared</div>
          <div class="kpi-val mono">${oppHealth.summary?.activeStartersHealthy ?? 19}/${oppHealth.summary?.totalStarters ?? 22}</div>
        </div>
        <div class="kpi-box">
          <div class="kpi-label">Questionable / GTD</div>
          <div class="kpi-val mono" style="color:var(--gold-bright)">${oppHealth.summary?.questionableOrDoubtfulCount ?? 0}</div>
        </div>
        <div class="kpi-box">
          <div class="kpi-label">Ruled Out / ${jargonTerm('IR', 'ir')}</div>
          <div class="kpi-val mono" style="color:var(--crimson)">${oppHealth.summary?.ruledOutCount ?? 0} Out • ${oppHealth.summary?.irCount ?? oppIrList.length} IR</div>
        </div>
      </div>

      ${
        oppInjReport.length > 0
          ? `
            <div class="sub-label" style="margin-bottom:6px">Week ${um.week || 9} Practice Participation &amp; Modeled Play Likelihood</div>
            <div class="table-scroll" style="margin-bottom:10px">
              <table class="data-table">
                <thead>
                  <tr>
                    <th>${esc(um.oppAbbr || 'OPP')} Player</th>
                    <th>Injury / Status</th>
                    <th class="mono">W / T / F</th>
                    <th>Play Likelihood</th>
                  </tr>
                </thead>
                <tbody>
                  ${oppInjReport
                    .map(
                      op => `
                    <tr>
                      <td>
                        <div style="display:flex;align-items:center;gap:7px">
                          ${renderPlayerAvatarHtml(op, 28)}
                          <div>
                            <div>
                              ${
                                op.espnUrl
                                  ? `<a href="${esc(op.espnUrl)}" target="_blank" rel="noopener noreferrer" class="ext-link"><strong>${esc(op.name)}</strong> ${iconSvg('externalLink', 10)}</a>`
                                  : `<strong>${esc(op.name)}</strong>`
                              }
                              <span style="color:var(--gold-bright);font-size:11px"> ${esc(op.position)}${op.jersey != null ? ` #${op.jersey}` : ''}</span>
                            </div>
                            <div style="font-size:10.5px;color:var(--text-muted)">
                              ${op.snapPct ? `<span class="mono">Snaps ${op.snapPct}%</span>` : 'Rotational / Depth'}${op.archetypeNote ? ` • ${esc(op.archetypeNote)}` : ''}
                            </div>
                          </div>
                        </div>
                      </td>
                      <td>
                        <div><strong>${esc(op.injuryType)}</strong></div>
                        <div style="font-size:11px;color:var(--text-muted)">${esc(op.gameStatus)}</div>
                      </td>
                      <td class="mono">${esc(op.wed)} / ${esc(op.thu)} / ${esc(op.fri)}</td>
                      <td style="min-width:112px">
                        <span class="badge ${playProbBadgeClass(op.playProbabilityPct)} mono">${esc(op.playBadgeLabel)}</span>
                        ${renderMiniMeterHtml(op.playProbabilityPct ?? 0, (op.playProbabilityPct ?? 0) >= 75 ? 'emerald' : (op.playProbabilityPct ?? 0) >= 35 ? 'amber' : 'scarlet')}
                      </td>
                    </tr>
                  `
                    )
                    .join('')}
                </tbody>
              </table>
            </div>

            <div class="sub-label" style="margin-bottom:6px">${esc(um.oppAbbr || 'OPP')} Player Availability Priors &amp; Beat Notes</div>
            <div style="display:flex;flex-direction:column;gap:6px;margin-bottom:10px">
              ${oppInjReport
                .map(
                  op => `
                <div class="subcard-panel" style="font-size:12px">
                  <div style="display:flex;justify-content:space-between;align-items:center;gap:6px;flex-wrap:wrap;margin-bottom:3px">
                    <strong>${esc(op.name)} <span style="color:var(--gold-bright)">(${esc(op.position)} • ${esc(op.injuryType)})</span></strong>
                    <span class="mono" style="font-size:11px;color:var(--text-muted)">${esc((op.factors || [])[0] || `${op.wed}/${op.thu}/${op.fri} progression`)}</span>
                  </div>
                  <div style="color:var(--text-secondary)">${escJargon(op.longComment || op.shortComment || op.archetypeNote || '')}</div>
                </div>
              `
                )
                .join('')}
            </div>
          `
          : `<div class="subcard-panel" style="font-size:12.5px;margin-bottom:10px">No active-roster ${esc(um.oppName)} players currently carry a restricted game designation.</div>`
      }

      ${
        oppHealthyStarters.length > 0
          ? `
            <div class="sub-label" style="margin-bottom:6px">Key ${esc(um.oppName)} Starters Cleared (Offense &amp; Defense)</div>
            <div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:10px">
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
          `
          : ''
      }

      ${
        oppIrList.length > 0
          ? `
            <div class="sub-label" style="margin-bottom:6px">${esc(um.oppAbbr || 'OPP')} IR &amp; 4-Game Return Window Tracker (${oppIrList.length})</div>
            <div style="display:flex;flex-direction:column;gap:6px;margin-bottom:10px">
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
          `
          : ''
      }

      <div class="subcard-panel" style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap">
        <div style="font-size:12px;color:var(--text-secondary)">
          <strong>49ers Side:</strong> ${sfPr
            .slice(0, 3)
            .map(p => `${esc(p.name)} (${esc(p.playBadgeLabel)})`)
            .join(' • ')}
        </div>
        <button type="button" class="btn-ghost" data-action="set-season-sub" data-season-sub="health">
          ${iconSvg('heartPulse', 13)}
          <span>Full 49ers Health</span>
        </button>
      </div>
    </section>

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
              .map(
                g => `
              <tr>
                <td>${g.season}</td>
                <td>${esc(g.date)}</td>
                <td>${esc(g.venue)}</td>
                <td style="color:${g.sfWon ? 'var(--emerald)' : 'var(--crimson)'}"><strong>${g.sfWon ? 'W' : 'L'}</strong> ${esc(g.scoreDisplay)}${g.overtime ? ' (OT)' : ''}</td>
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
  return `
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
            <span>49ers.com Report</span>${iconSvg('externalLink', 11)}
          </a>
          <a href="${esc(h.espnInjuryUrl || 'https://www.espn.com/nfl/injuries')}" target="_blank" rel="noopener noreferrer" class="source-chip-link">
            <span>ESPN Injuries</span>${iconSvg('externalLink', 11)}
          </a>
          <span class="badge badge-gold mono">${jargonTerm('IR', 'ir')} Returns Left: ${h.remainingIrDesignations}/${h.maxRegularSeasonIrDesignations}</span>
        </div>
      </div>

      <div style="font-size:12px;color:var(--text-secondary);margin-bottom:10px">
        Accounts for veteran rest days (e.g., Trent Williams / CMC) vs. acute injury designations (${jargonTerm('DNP', 'dnp')} / ${jargonTerm('LP', 'lp')} / ${jargonTerm('FP', 'fp')}) and historical play-through rates. Tap any player for full injury and contract details.
      </div>

      <div class="table-scroll">
        <table class="data-table">
          <thead>
            <tr>
              <th>Player</th><th>Injury / Context</th><th class="mono">W / T / F</th><th>Play Likelihood</th>
            </tr>
          </thead>
          <tbody>
            ${(h.practiceReport || [])
              .map(
                p => `
              <tr style="cursor:pointer" data-action="open-player-sheet" data-player-id="${esc(p.playerId)}" data-initial-tab="health">
                <td>
                  <div style="display:flex;align-items:center;gap:8px">
                    ${renderPlayerAvatarHtml(p, 30)}
                    <span><strong>${esc(p.name)}</strong> <span style="color:var(--gold-bright);font-size:11px">${esc(p.position)}</span></span>
                  </div>
                </td>
                <td>${esc(p.injuryType)}</td>
                <td class="mono">${esc(p.wed)} / ${esc(p.thu)} / ${esc(p.fri)}</td>
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
            ${ir.beatNote ? `<div style="font-size:12px;color:var(--text-secondary);margin-top:4px">${escJargon(ir.beatNote)}</div>` : ''}
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

function renderTeamStatsAndPower(appData) {
  const ranks = appData?.scheduleMatchup?.teamStatRankings || [];
  const pwr = appData?.scheduleMatchup?.powerRankings || {};
  const seasonYear = Number(appData?.meta?.seasonYear) || 2026;
  const pfrSeasonUrl = buildPfrTeamSeasonUrl('SF', seasonYear);

  return `
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
            ${ranks
              .map(r => {
                const metricLabel = COMPACT_STAT_LABELS[r.key] || r.label;
                return `
              <tr title="${esc(r.label)}">
                <td><strong>${escJargon(metricLabel)}</strong></td>
                <td class="mono num-col"><strong>${esc(r.displayValue)}</strong></td>
                <td class="rank-col">
                  <div class="team-rank-cell">
                    <span class="badge ${rankBadgeClass(r.rank)} mono">#${r.rank}</span>
                    ${renderMiniMeterHtml(((33 - Number(r.rank || 16)) / 32) * 100, r.rank <= 8 ? 'emerald' : r.rank <= 18 ? 'gold' : 'scarlet')}
                  </div>
                </td>
                <td class="mono num-col" style="color:var(--text-muted)">${esc(r.leagueAvgDisplay)}</td>
              </tr>
            `;
              })
              .join('')}
          </tbody>
        </table>
      </div>

      <div class="source-link-strip team-stats-sources">
        <a href="https://github.com/nflverse/nflverse-data" target="_blank" rel="noopener noreferrer" class="source-chip-link"><span>nflverse</span>${iconSvg('externalLink', 11)}</a>
        <a href="${esc(pfrSeasonUrl)}" target="_blank" rel="noopener noreferrer" class="source-chip-link"><span>PFR 49ers</span>${iconSvg('externalLink', 11)}</a>
        <a href="https://rbsdm.com/stats/stats/" target="_blank" rel="noopener noreferrer" class="source-chip-link"><span>RBSDM EPA</span>${iconSvg('externalLink', 11)}</a>
      </div>
    </section>

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
                ${renderPlayerAvatarHtml({ name: m.player, jersey: m.jersey, headshotUrl: m.headshotUrl }, 36, { showJerseyBadge: m.jersey != null })}
                <div style="min-width:0">
                  <div style="display:flex;align-items:center;gap:5px;flex-wrap:wrap">
                    <strong style="cursor:${m.playerId ? 'pointer' : 'default'}" ${m.playerId ? `data-action="open-player-sheet" data-player-id="${esc(m.playerId)}"` : ''}>${esc(m.player)} (${esc(m.position)})</strong>
                    <span style="color:var(--text-muted)">←</span>
                    ${m.acquiredFrom ? renderTeamLogoHtml(m.acquiredFrom, m.acquiredFromLogoUrl, 18) : ''}
                    <strong>${esc(m.acquiredFrom)}</strong>
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
            <div style="font-size:12.5px;color:var(--text-secondary);margin-top:5px">${escJargon(m.analysis)}</div>
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
      <div class="card-eyebrow">9/18ths Pro-Rated Base Salary &amp; ${jargonTerm('Rich Hill', 'rich_hill')} Pick Costs</div>
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
                    <strong>${esc(t.name)} (${esc(t.position)})</strong>
                    ${t.teamAbbr ? renderTeamLogoHtml(t.teamAbbr, t.teamLogoUrl, 17) : ''}
                    ${t.currentTeam ? `<span style="font-size:11.5px;color:var(--gold-bright);font-weight:700">${esc(t.currentTeam)}</span>` : ''}
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
              ${p.examples ? `<div style="font-size:11.5px;color:var(--gold-bright);margin-bottom:3px"><strong>Examples:</strong> ${esc(p.examples)}</div>` : ''}
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
              ${
                r.sourceUrl
                  ? `<a href="${esc(r.sourceUrl)}" target="_blank" rel="noopener noreferrer" class="ext-link" style="font-size:11px">${esc(r.sources)} ${iconSvg('externalLink', 10)}</a>`
                  : `<span style="font-size:11px;color:var(--text-muted)">${esc(r.sources)}</span>`
              }
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
                    <span class="mono">+${g.primaryDeltaPct}% ${esc(g.primaryMetric)} swing</span>
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
            <div style="font-size:12.5px;color:var(--text-secondary);margin-top:3px">${esc(c.pathSummary)}</div>
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
                  <div style="display:flex;align-items:center;gap:6px">
                    ${renderTeamLogoHtml(t.abbr, t.logoUrl, 20)}
                    <strong>${esc(t.abbr)}</strong>
                  </div>
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

function renderFullSchedule(appData) {
  const sched = appData?.scheduleMatchup?.schedule || [];
  return `
    <section class="card">
      <div class="card-header">
        <div class="card-header-left">
          <div class="card-icon-badge" aria-hidden="true">${iconSvg('calendar', 18)}</div>
          <div class="card-title-group">
            <div class="card-eyebrow">2026 Regular Season • International, Surface &amp; Rest Differential</div>
            <h2 class="card-title">49ers Schedule &amp; Venue Tracker</h2>
          </div>
        </div>
        <a href="https://www.espn.com/nfl/team/schedule/_/name/sf/san-francisco-49ers" target="_blank" rel="noopener noreferrer" class="source-chip-link">
          <span>ESPN Schedule</span>${iconSvg('externalLink', 11)}
        </a>
      </div>

      <div style="display:flex;flex-direction:column;gap:8px">
        ${sched
          .map(g => {
            const restBadge =
              g.restAdvantageDays > 0
                ? `<span class="badge badge-positive mono">+${g.restAdvantageDays}d Rest</span>`
                : g.restAdvantageDays < 0
                  ? `<span class="badge badge-danger mono">${g.restAdvantageDays}d Rest</span>`
                  : '';
            return `
              <div style="padding:10px 11px;border-radius:10px;background:var(--bg-card-alt);border:1px solid ${
                g.venue?.isInternational ? 'var(--gold-border)' : 'var(--border-subtle)'
              }">
                <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap">
                  <div style="display:flex;align-items:center;gap:8px;min-width:0">
                    ${renderTeamLogoHtml(g.opponent?.abbr || 'NFL', g.oppLogoUrl || g.opponent?.logoUrl, 28)}
                    <div style="min-width:0">
                      <span class="mono" style="color:var(--gold-bright);font-weight:800">WK ${g.week}</span> •
                      <strong>${g.homeAway === 'home' ? 'vs.' : '@'} ${esc(g.opponent?.name)}</strong>
                      <span class="mono" style="font-size:11.5px;color:var(--text-muted)">(${esc(g.opponent?.record)})</span>
                    </div>
                  </div>
                  <div style="display:flex;gap:5px;align-items:center;flex-wrap:wrap">
                    ${restBadge}
                    ${
                      g.completed
                        ? `<span class="badge ${g.result === 'W' ? 'badge-positive' : 'badge-danger'} mono">${g.result} ${g.sfScore}-${g.oppScore}</span>`
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
          })
          .join('')}
      </div>
    </section>
  `;
}

function renderDraftPrepAndCombine(appData, combineSearch) {
  const dp = appData?.seasonal?.draftPrep2027 || {};
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
            <h2 class="card-title">2027 NFL Draft &amp; Pick Inventory</h2>
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
          .map(
            m => `
          <div class="subcard-panel">
            <div style="display:flex;justify-content:space-between;align-items:center;gap:6px;flex-wrap:wrap">
              ${
                m.sourceUrl
                  ? `<a href="${esc(m.sourceUrl)}" target="_blank" rel="noopener noreferrer" class="ext-link"><strong>${esc(m.name)} (${esc(m.pos)} • ${esc(m.school)})</strong> ${iconSvg('externalLink', 11)}</a>`
                  : `<strong>${esc(m.name)} (${esc(m.pos)} • ${esc(m.school)})</strong>`
              }
              <span class="badge badge-positive mono">SF Fit ${m.shanahanLynchFitScore}/100 • ${m.mockFrequencyToSfPct}% Mocks</span>
            </div>
            <div style="font-size:11.5px;color:var(--gold-bright);margin:2px 0">${esc(m.heightWeight)} • Mocked by: ${esc((m.sourcesMocking || []).join(', '))}</div>
            <div style="font-size:12.5px;color:var(--text-secondary)">${escJargon(m.archetypeTraits)}</div>
          </div>
        `
          )
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
              .map(
                c => `
              <tr>
                <td style="font-family:var(--font-sans)"><strong>${esc(c.name)}</strong></td>
                <td>${esc(c.pos)}</td>
                <td style="font-family:var(--font-sans)">${esc(c.school)}</td>
                <td>${esc(c.ht)} / ${c.wt ?? '—'}</td>
                <td>${c.forty ?? '—'}</td>
                <td>${c.vertical ?? '—'}</td>
                <td>${c.threeCone ?? '—'}</td>
                <td><span class="badge badge-positive">${Number(c.ras).toFixed(2)}</span></td>
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
                        pk.pfrUrl
                          ? `<a href="${esc(pk.pfrUrl)}" target="_blank" rel="noopener noreferrer" class="ext-link" style="font-size:14.5px;margin-left:5px"><strong>${esc(pk.name)}</strong> ${iconSvg('externalLink', 11)}</a>`
                          : `<strong style="font-size:14.5px;margin-left:5px">${esc(pk.name)}</strong>`
                      }
                      <span style="color:var(--gold-bright);font-weight:700"> ${esc(pk.position)} • ${esc(pk.college)}</span>
                    </div>
                  </div>
                  ${stealBadge}
                </div>

                <div style="font-size:12.5px;color:var(--text-secondary)">${escJargon(pk.roleSummary)}</div>

                <ul class="brief-bullets">
                  ${(pk.strengths || []).map(s => `<li>${escJargon(s)}</li>`).join('')}
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
                      <strong>${esc(u.displayName || u.name)} (${esc(u.position)})</strong>
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
                <div style="font-size:12.5px;color:var(--text-secondary)">${escJargon(u.roleSummary)}</div>
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
