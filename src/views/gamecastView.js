/**
 * Gamecast View — Live & Historical Box Score, Single-Game Team Stats, and Play-by-Play
 *
 * Layout principles:
 * - Ultra-slim shared Scorebug above the 3 tabs (no quarter linescore or Win Prob cluttering Box Score / Team Stats).
 * - Sticky 3-tab bar (`Box Score` | `Team Stats` | `Play-by-Play`) pinned beneath `.top-header` while the 2x4 season nav scrolls away.
 * - Inside `Play-by-Play`: ESPN vertical flow — Animated SVG Football Field (when live) -> Quarter-by-Quarter Scoring + expandable Win Prob directly below -> Drive filters & collapsible Drive Accordions with inline HD highlight clips.
 * - Every 49ers and opponent player name opens their native slide-up `Player Dossier` sheet.
 */

import {
  esc,
  escJargon,
  jargonTerm,
  relTime,
  renderTeamLogoHtml,
  lookupRosterPlayerByName,
  registerRosterPlayersForInlineLinks,
  registerOpponentPlayersForInlineLinks
} from './uiHelpers.js';
import { iconSvg } from './icons.js';
import { getActiveTeamConfig } from '../config/teamRegistry.js';
import {
  buildFallbackGamecastFromSchedule,
  resolveGamecastGamesList
} from '../engine/gamecastEngine.js';
import { resolveNflTeamMeta } from '../services/remoteTeamDossierService.js';
import { sanitizeExternalUrl } from '../engine/linkIntegrity.js';
import { resolveReadOnlyPlatformApiBase } from '../services/aiWorkerClient.js';

function renderTimeoutDotsHtml(count) {
  if (count == null || !Number.isFinite(Number(count))) return '';
  const rem = Math.max(0, Math.min(3, Number(count)));
  return `<span class="gc-timeouts" aria-label="${rem} timeouts remaining">${Array.from({ length: 3 }, (_, i) =>
    `<span class="gc-to-dot ${i < rem ? 'on' : 'off'}"></span>`
  ).join('')}</span>`;
}

function buildBoxPlayerTriggerHtml(athlete, { isActiveTeam = true, oppAbbr = '', rosterPlayers = [] } = {}) {
  const displayName = String(athlete?.shortName || athlete?.name || '').trim();
  const fullName = String(athlete?.name || displayName).trim();
  const posBadge = athlete?.position ? `<span class="gc-box-pos">${esc(athlete.position)}</span>` : '';

  if (isActiveTeam) {
    const matched =
      (athlete?.id && rosterPlayers.find(p => String(p.espnId || '') === String(athlete.id))) ||
      lookupRosterPlayerByName(fullName) ||
      lookupRosterPlayerByName(displayName);
    if (matched?.id) {
      return `
        <span class="inline-player-link gc-box-player-name" role="button" tabindex="0"
              data-action="open-player-sheet" data-player-id="${esc(matched.id)}">${esc(displayName)}</span>${posBadge}
      `;
    }
  } else {
    const oppMeta = resolveNflTeamMeta(oppAbbr);
    if (oppMeta && fullName) {
      return `
        <span class="inline-player-link gc-box-player-name" role="button" tabindex="0"
              data-action="open-opponent-player-sheet"
              data-opp-team="${esc(oppMeta.abbr)}"
              ${athlete?.id ? `data-opp-player-id="${esc(athlete.id)}"` : ''}
              data-opp-player-name="${esc(fullName)}"
              ${athlete?.position ? `data-opp-player-pos="${esc(athlete.position)}"` : ''}
              ${athlete?.espnUrl ? `data-opp-espn-url="${esc(athlete.espnUrl)}"` : ''}>${esc(displayName)}</span>${posBadge}
      `;
    }
  }

  return `<strong class="gc-box-player-name">${esc(displayName)}</strong>${posBadge}`;
}

function renderWinProbSparklineSvg(series = [], activeAbbr = 'SF', oppAbbr = 'OPP') {
  if (!Array.isArray(series) || series.length < 2) {
    return `<div class="gc-wp-empty">Win probability curve populates as plays are logged.</div>`;
  }
  const w = 320;
  const h = 68;
  const pts = series
    .map((val, idx) => {
      const x = (idx / (series.length - 1)) * w;
      const y = h - (Math.max(0, Math.min(100, Number(val) || 50)) / 100) * h;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
  const lastVal = series[series.length - 1];
  const lastY = h - (Math.max(0, Math.min(100, Number(lastVal) || 50)) / 100) * h;

  return `
    <div class="gc-wp-chart-wrap">
      <svg viewBox="0 0 ${w} ${h}" class="gc-wp-svg" role="img" aria-label="${esc(activeAbbr)} win probability curve">
        <line x1="0" y1="${h / 2}" x2="${w}" y2="${h / 2}" class="gc-wp-midline" />
        <polyline fill="none" class="gc-wp-line" points="${pts}" />
        <circle cx="${w}" cy="${lastY.toFixed(1)}" r="3.4" class="gc-wp-dot" />
        <text x="2" y="10" class="gc-wp-axis">${esc(activeAbbr)} 100%</text>
        <text x="2" y="${h - 2}" class="gc-wp-axis">${esc(oppAbbr)} 100%</text>
      </svg>
    </div>
  `;
}

/**
 * ESPN-style Animated Mini Football Field rendered at the top of `Play-by-Play` during live games.
 * Geometry: Left Endzone = Away (0), Right Endzone = Home (100).
 */
function renderAnimatedFootballFieldCard(model, fieldAnimKey = 0) {
  const sit = model.situation || {};
  const away = model.away || {};
  const home = model.home || {};
  const ydToX = yd => 32 + (Math.max(0, Math.min(100, Number(yd) || 50)) / 100) * 296;

  const xDriveStart = ydToX(sit.driveStartPos0to100 ?? 50);
  const xPrev = ydToX(sit.prevPos0to100 ?? 50);
  const xBall = ydToX(sit.ballPos0to100 ?? 50);
  const xFirst = ydToX(sit.firstDownPos0to100 ?? 60);
  const driveRectLeft = Math.min(xDriveStart, xBall);
  const driveRectWidth = Math.abs(xBall - xDriveStart);
  const midX = (xPrev + xBall) / 2;
  const arcY = sit.lastPlayIsPass ? 22 : 55;
  const hasMovement = Math.abs(xBall - xPrev) >= 1.5;
  const isTd = Boolean(sit.isTouchdownLastPlay);
  const possessingColor = sit.possessionSide === 'away' ? away.color : home.color;

  return `
    <section class="card gc-field-card" data-gamecast-field data-anim-key="${Number(fieldAnimKey) || 0}">
      <div class="gc-field-head">
        <div class="gc-field-sit-wrap">
          <div class="gc-field-sit mono ${isTd ? 'is-td' : ''}">
            <span class="gc-live-dot" aria-hidden="true"></span>
            <span>${esc(sit.downDistanceText || model.statusDetail || 'Live Drive')}</span>
            ${sit.isRedZone && !isTd ? '<span class="gc-rz-pill">RED ZONE</span>' : ''}
          </div>
          ${
            sit.lastPlayText
              ? `<div class="gc-field-last-play">${esc(sit.lastPlayText)}</div>`
              : sit.currentDriveSummary
                ? `<div class="gc-field-last-play">${esc(sit.currentDriveSummary)}</div>`
                : ''
          }
        </div>
      </div>

      <div class="gc-field-stage">
        <svg viewBox="0 0 360 108" class="gc-field-svg" role="img" aria-label="Live field position: ${esc(sit.downDistanceText || 'Midfield')}">
          <rect x="0" y="0" width="360" height="108" fill="#1e5c31" />
          ${Array.from({ length: 10 }, (_, i) =>
            `<rect x="${(32 + i * 29.6).toFixed(1)}" y="0" width="29.6" height="108" fill="${i % 2 === 0 ? '#226636' : '#1d5a30'}" />`
          ).join('')}

          <!-- Left Endzone (Away) -->
          <rect x="0" y="0" width="32" height="108" fill="${esc(away.color || '#1E293B')}" class="${isTd && sit.possessionSide === 'home' ? 'gc-td-flash' : ''}" />
          <text x="16" y="54" fill="${away.abbr === 'SF' ? '#B3995D' : '#FFFFFF'}" font-size="10.5" font-weight="900" text-anchor="middle" dominant-baseline="middle" transform="rotate(-90 16 54)" letter-spacing="1.8">${esc(away.abbr === 'SF' ? '49ERS' : away.abbr)}</text>

          <!-- Right Endzone (Home) -->
          <rect x="328" y="0" width="32" height="108" fill="${esc(home.color || '#AA0000')}" class="${isTd && sit.possessionSide === 'away' ? 'gc-td-flash' : ''}" />
          <text x="344" y="54" fill="${home.abbr === 'SF' ? '#B3995D' : '#FFFFFF'}" font-size="10.5" font-weight="900" text-anchor="middle" dominant-baseline="middle" transform="rotate(90 344 54)" letter-spacing="1.8">${esc(home.abbr === 'SF' ? '49ERS' : home.abbr)}</text>

          <!-- Yard Lines & Numbers -->
          ${[10, 20, 30, 40, 50, 60, 70, 80, 90]
            .map(yd => {
              const x = ydToX(yd).toFixed(1);
              const lbl = yd <= 50 ? yd : 100 - yd;
              return `
                <line x1="${x}" y1="0" x2="${x}" y2="108" stroke="rgba(255,255,255,0.28)" stroke-width="${yd === 50 ? 1.5 : 0.9}" />
                <text x="${x}" y="12" fill="rgba(255,255,255,0.58)" font-size="7.5" font-family="monospace" font-weight="700" text-anchor="middle">${lbl}</text>
                <text x="${x}" y="102" fill="rgba(255,255,255,0.58)" font-size="7.5" font-family="monospace" font-weight="700" text-anchor="middle">${lbl}</text>
              `;
            })
            .join('')}

          <!-- Goal Lines & Hash Marks -->
          <line x1="32" y1="0" x2="32" y2="108" stroke="#FFFFFF" stroke-width="1.6" />
          <line x1="328" y1="0" x2="328" y2="108" stroke="#FFFFFF" stroke-width="1.6" />
          <line x1="32" y1="38" x2="328" y2="38" stroke="rgba(255,255,255,0.22)" stroke-width="1" stroke-dasharray="2 3.92" />
          <line x1="32" y1="70" x2="328" y2="70" stroke="rgba(255,255,255,0.22)" stroke-width="1" stroke-dasharray="2 3.92" />

          <!-- Drive Progress Shading -->
          ${
            driveRectWidth >= 1
              ? `<rect x="${driveRectLeft.toFixed(1)}" y="0" width="${driveRectWidth.toFixed(1)}" height="108" fill="${esc(possessingColor || '#AA0000')}" fill-opacity="0.22" />`
              : ''
          }

          <!-- Line of Scrimmage (blue) & First Down Marker (gold) -->
          ${
            !isTd
              ? `
                <line x1="${xBall.toFixed(1)}" y1="0" x2="${xBall.toFixed(1)}" y2="108" stroke="#60a5fa" stroke-width="2" />
                <line x1="${xFirst.toFixed(1)}" y1="0" x2="${xFirst.toFixed(1)}" y2="108" stroke="#facc15" stroke-width="2.2" />
              `
              : ''
          }

          <!-- Animated Play Arc -->
          ${
            hasMovement
              ? `
                <path d="M ${xPrev.toFixed(1)} 56 Q ${midX.toFixed(1)} ${arcY} ${xBall.toFixed(1)} 55"
                      fill="none"
                      stroke="${sit.lastPlayIsPass ? '#facc15' : '#ffffff'}"
                      stroke-width="2.4"
                      stroke-linecap="round"
                      class="gc-play-arc-anim" />
                <circle cx="${xPrev.toFixed(1)}" cy="56" r="2.8" fill="rgba(255,255,255,0.72)" />
              `
              : ''
          }

          <!-- Football Marker -->
          <g class="gc-ball-pop">
            <ellipse cx="${xBall.toFixed(1)}" cy="55" rx="6.4" ry="3.9" fill="#7c2d12" stroke="#ffffff" stroke-width="1.35" />
            <line x1="${(xBall - 2.4).toFixed(1)}" y1="55" x2="${(xBall + 2.4).toFixed(1)}" y2="55" stroke="#ffffff" stroke-width="1.1" />
          </g>

          ${
            isTd
              ? `
                <rect x="92" y="33" width="176" height="40" rx="8" fill="rgba(170,0,0,0.92)" stroke="#B3995D" stroke-width="1.6" />
                <text x="180" y="58" fill="#FFFFFF" font-size="13.5" font-weight="900" text-anchor="middle" letter-spacing="1.4">TOUCHDOWN ${esc(sit.possessionAbbr || '')}!</text>
              `
              : ''
          }
        </svg>
      </div>
    </section>
  `;
}

/**
 * Quarter-by-Quarter Scoring Table + Expandable Win Probability Meter.
 * Rendered ONLY on the `Play-by-Play` tab (directly below the live football field, matching ESPN).
 */
function renderQuarterScoreboardCard(model) {
  const away = model.away || {};
  const home = model.home || {};
  const qHeaders = model.quarterHeaders || ['1', '2', '3', '4'];
  const wp = model.winProb || {};
  const hasWinProb = wp.teamPct != null && Number.isFinite(Number(wp.teamPct));
  const activeAbbr = model.activeSide?.abbr || 'SF';
  const oppAbbr = model.oppSide?.abbr || 'OPP';

  return `
    <section class="card gc-quarter-card" data-gamecast-quarter-scoreboard>
      <div class="table-scroll">
        <table class="data-table gc-linescore-table mono">
          <thead>
            <tr>
              <th class="gc-ls-team-col">Scoring</th>
              ${qHeaders.map(q => `<th class="num-col">${esc(q)}</th>`).join('')}
              <th class="num-col gc-ls-total-col">T</th>
            </tr>
          </thead>
          <tbody>
            <tr class="${away.isActive ? 'gc-ls-active-row' : ''}">
              <td class="gc-ls-team-col">
                <span class="gc-ls-team-cell">
                  ${renderTeamLogoHtml(away.abbr, away.logoUrl, 16)}
                  <strong>${esc(away.abbr)}</strong>
                </span>
              </td>
              ${(away.linescores || []).slice(0, qHeaders.length).map(v => `<td class="num-col">${esc(v)}</td>`).join('')}
              <td class="num-col gc-ls-total-col"><strong>${away.score != null ? esc(away.score) : '—'}</strong></td>
            </tr>
            <tr class="${home.isActive ? 'gc-ls-active-row' : ''}">
              <td class="gc-ls-team-col">
                <span class="gc-ls-team-cell">
                  ${renderTeamLogoHtml(home.abbr, home.logoUrl, 16)}
                  <strong>${esc(home.abbr)}</strong>
                </span>
              </td>
              ${(home.linescores || []).slice(0, qHeaders.length).map(v => `<td class="num-col">${esc(v)}</td>`).join('')}
              <td class="num-col gc-ls-total-col"><strong>${home.score != null ? esc(home.score) : '—'}</strong></td>
            </tr>
          </tbody>
        </table>
      </div>

      ${
        hasWinProb
          ? `
            <details class="gc-wp-details">
              <summary class="gc-wp-summary">
                <div class="gc-wp-head mono">
                  <span><strong>${esc(activeAbbr)} Win Prob ${wp.teamPct}%</strong></span>
                  <span class="gc-wp-opp">${esc(oppAbbr)} ${wp.oppPct}% ${wp.series?.length >= 2 ? '▾' : ''}</span>
                </div>
                <div class="gc-wp-bar" role="presentation">
                  <div class="gc-wp-bar-team" style="width:${wp.teamPct}%"></div>
                  <div class="gc-wp-bar-opp" style="width:${wp.oppPct}%"></div>
                </div>
              </summary>
              ${renderWinProbSparklineSvg(wp.series || [], activeAbbr, oppAbbr)}
            </details>
          `
          : ''
      }
    </section>
  `;
}

function renderBoxScoreTabHtml(
  model,
  { boxTeam = 'team', boxUnit = 'all', rosterPlayers = [], isLoading = false } = {}
) {
  const activeSide = model.activeSide || {};
  const oppSide = model.oppSide || {};
  const showingActiveTeam = boxTeam !== 'opponent';
  const groups = showingActiveTeam ? model.boxScore?.team || [] : model.boxScore?.opponent || [];

  const filteredGroups = groups.filter(g => {
    if (boxUnit === 'all') return true;
    return g.unit === boxUnit;
  });

  const controlsHtml = `
    <div class="gc-box-controls">
      <div class="segmented-control compact-seg gc-team-seg" role="tablist" aria-label="Box Score Team">
        <button type="button" role="tab" aria-selected="${showingActiveTeam ? 'true' : 'false'}"
                class="pill-btn seg-btn ${showingActiveTeam ? 'active' : ''}"
                data-action="set-gamecast-box-team" data-box-team="team">
          <span>${esc(activeSide.shortName || activeSide.abbr || 'Team')}</span>
        </button>
        <button type="button" role="tab" aria-selected="${!showingActiveTeam ? 'true' : 'false'}"
                class="pill-btn seg-btn ${!showingActiveTeam ? 'active' : ''}"
                data-action="set-gamecast-box-team" data-box-team="opponent">
          <span>${esc(oppSide.shortName || oppSide.abbr || 'Opponent')}</span>
        </button>
      </div>

      <div class="gc-unit-pills" role="group" aria-label="Box Score Unit Filter">
        ${[
          ['all', 'All'],
          ['offense', 'Off'],
          ['defense', 'Def'],
          ['special_teams', 'ST']
        ]
          .map(
            ([k, lbl]) => `
          <button type="button"
                  class="pill-btn gc-mini-pill ${boxUnit === k ? 'active' : ''}"
                  data-action="set-gamecast-box-unit" data-box-unit="${k}">
            ${lbl}
          </button>
        `
          )
          .join('')}
      </div>
    </div>
  `;

  if (isLoading && groups.length === 0) {
    return `
      ${controlsHtml}
      <section class="card gc-empty-card">
        <div class="gc-skeleton-line wide"></div>
        <div class="gc-skeleton-line"></div>
        <div class="gc-skeleton-line"></div>
      </section>
    `;
  }

  if (model.isPre) {
    return `
      <section class="card gc-empty-card">
        <div class="gc-empty-title">Box Score opens at kickoff</div>
        <p class="gc-empty-sub">${esc(model.statusDetail || 'Scheduled')}${model.venue ? ` • ${esc(model.venue)}` : ''}</p>
        <button type="button" class="btn-ghost" data-action="set-season-sub" data-season-sub="matchup">
          ${iconSvg('swords', 13)}
          <span>Open Matchup Preview</span>
        </button>
      </section>
    `;
  }

  if (filteredGroups.length === 0) {
    return `
      ${controlsHtml}
      <section class="card gc-empty-card">
        <div class="gc-empty-title">${groups.length === 0 ? 'Player box score unavailable offline' : 'No stats recorded in this unit'}</div>
        <div class="gc-empty-actions">
          ${
            groups.length === 0
              ? `<button type="button" class="btn-ghost" data-action="refresh-gamecast-now">${iconSvg('reset', 12)}<span>Retry Load</span></button>`
              : `<button type="button" class="btn-ghost" data-action="set-gamecast-box-unit" data-box-unit="all"><span>Show All Units</span></button>`
          }
          ${
            model.gameUrl
              ? `<a href="${esc(model.gameUrl)}" target="_blank" rel="noopener noreferrer" class="source-chip-link"><span>ESPN Box Score</span>${iconSvg('externalLink', 10)}</a>`
              : ''
          }
        </div>
      </section>
    `;
  }

  const tablesHtml = filteredGroups
    .map(grp => {
      const colCount = grp.labels.length;
      return `
        <section class="card gc-box-cat-card" data-box-category="${esc(grp.key)}">
          <div class="gc-box-cat-head">
            <h3 class="gc-box-cat-title">${esc(grp.label)}</h3>
            <span class="mono gc-box-cat-count">${grp.athletes.length}</span>
          </div>
          <div class="table-scroll">
            <table class="data-table sticky-col-table gc-box-table">
              <thead>
                <tr>
                  <th class="sticky-first-col">Player</th>
                  ${grp.labels.map(lbl => `<th class="mono num-col">${esc(lbl)}</th>`).join('')}
                </tr>
              </thead>
              <tbody>
                ${grp.athletes
                  .map(ath => {
                    const cells = Array.from({ length: colCount }, (_, idx) => {
                      const v = ath.stats?.[idx] ?? '—';
                      return `<td class="mono num-col ${idx === 1 ? 'gc-box-key-val' : ''}">${esc(v)}</td>`;
                    }).join('');
                    return `
                      <tr>
                        <td class="sticky-first-col">
                          ${buildBoxPlayerTriggerHtml(ath, {
                            isActiveTeam: showingActiveTeam,
                            oppAbbr: oppSide.abbr,
                            rosterPlayers
                          })}
                        </td>
                        ${cells}
                      </tr>
                    `;
                  })
                  .join('')}
                ${
                  Array.isArray(grp.totals) && grp.totals.length > 0
                    ? `
                      <tr class="gc-box-total-row">
                        <td class="sticky-first-col"><strong>TEAM</strong></td>
                        ${Array.from({ length: colCount }, (_, idx) =>
                          `<td class="mono num-col"><strong>${esc(grp.totals[idx] || '')}</strong></td>`
                        ).join('')}
                      </tr>
                    `
                    : ''
                }
              </tbody>
            </table>
          </div>
        </section>
      `;
    })
    .join('');

  return `${controlsHtml}<div class="gc-stack">${tablesHtml}</div>`;
}

function renderTeamStatsTabHtml(model, { isLoading = false } = {}) {
  const away = model.away || {};
  const home = model.home || {};
  const groups = model.teamStatsGroups || [];

  if (isLoading && groups.length === 0) {
    return `
      <section class="card gc-empty-card">
        <div class="gc-skeleton-line wide"></div>
        <div class="gc-skeleton-line"></div>
        <div class="gc-skeleton-line"></div>
      </section>
    `;
  }

  if (model.isPre) {
    return `
      <section class="card gc-empty-card">
        <div class="gc-empty-title">Game Team Stats begin at kickoff</div>
        <p class="gc-empty-sub">Looking for season-long 32-team NFL rankings?</p>
        <button type="button" class="btn-ghost" data-action="set-season-sub" data-season-sub="stats">
          ${iconSvg('season', 13)}
          <span>Open Season Stats</span>
        </button>
      </section>
    `;
  }

  if (groups.length === 0) {
    return `
      <section class="card gc-empty-card">
        <div class="gc-empty-title">Single-game team stats unavailable offline</div>
        <div class="gc-empty-actions">
          <button type="button" class="btn-ghost" data-action="refresh-gamecast-now">${iconSvg('reset', 12)}<span>Retry Load</span></button>
          ${
            model.gameUrl
              ? `<a href="${esc(model.gameUrl)}" target="_blank" rel="noopener noreferrer" class="source-chip-link"><span>ESPN Team Stats</span>${iconSvg('externalLink', 10)}</a>`
              : ''
          }
        </div>
      </section>
    `;
  }

  const legendHtml = `
    <div class="gc-ts-legend">
      <div class="gc-ts-team-tag ${away.isActive ? 'is-active' : ''}">
        ${renderTeamLogoHtml(away.abbr, away.logoUrl, 18)}
        <strong>${esc(away.shortName || away.abbr)}</strong>
      </div>
      <span class="gc-ts-mid-label">Single-Game Stats</span>
      <div class="gc-ts-team-tag right ${home.isActive ? 'is-active' : ''}">
        <strong>${esc(home.shortName || home.abbr)}</strong>
        ${renderTeamLogoHtml(home.abbr, home.logoUrl, 18)}
      </div>
    </div>
  `;

  const cardsHtml = groups
    .map(
      grp => `
      <section class="card gc-ts-group-card">
        <div class="gc-ts-group-title">${esc(grp.title)}</div>
        <div class="gc-ts-rows">
          ${grp.rows
            .map(r => {
              const labelHtml = r.jargonKey ? jargonTerm(r.label, r.jargonKey) : esc(r.label);
              const awayCls = r.awayLeads ? (away.isActive ? 'lead-active' : 'lead-opp') : 'muted';
              const homeCls = r.homeLeads ? (home.isActive ? 'lead-active' : 'lead-opp') : 'muted';
              const awayBarCls = away.isActive
                ? r.awayLeads
                  ? 'bar-active-lead'
                  : 'bar-active-dim'
                : r.awayLeads
                  ? 'bar-opp-lead'
                  : 'bar-opp-dim';
              const homeBarCls = home.isActive
                ? r.homeLeads
                  ? 'bar-active-lead'
                  : 'bar-active-dim'
                : r.homeLeads
                  ? 'bar-opp-lead'
                  : 'bar-opp-dim';
              return `
                <div class="gc-ts-row">
                  <div class="gc-ts-vals">
                    <span class="mono gc-ts-val ${awayCls}">${esc(r.awayDisplay)}</span>
                    <span class="gc-ts-label">${labelHtml}</span>
                    <span class="mono gc-ts-val right ${homeCls}">${esc(r.homeDisplay)}</span>
                  </div>
                  <div class="gc-ts-bar" role="presentation">
                    <div class="gc-ts-bar-seg ${awayBarCls}" style="width:${r.awayPct}%"></div>
                    <div class="gc-ts-bar-seg ${homeBarCls}" style="width:${r.homePct}%"></div>
                  </div>
                  ${r.sub ? `<div class="gc-ts-sub mono">${esc(r.sub)}</div>` : ''}
                </div>
              `;
            })
            .join('')}
        </div>
      </section>
    `
    )
    .join('');

  return `${legendHtml}<div class="gc-stack">${cardsHtml}</div>`;
}

function renderPlayClipBlockHtml(play, clipKey, activeGamecastClipKey, prefs = null) {
  const clip = play?.clip;
  if (!clip) return '';
  const isPlaying = activeGamecastClipKey === clipKey && Boolean(clip.mp4Url);
  if (isPlaying) {
    const apiBase = resolveReadOnlyPlatformApiBase(prefs || {});
    const streamSrc = apiBase
      ? `${apiBase}/api/video-stream?url=${encodeURIComponent(clip.mp4Url)}`
      : clip.mp4Url;
    return `
      <div class="gc-inline-clip-stage" data-gamecast-clip-stage>
        <video controls autoplay playsinline preload="metadata"
               ${clip.posterUrl ? `poster="${esc(clip.posterUrl)}"` : ''}
               src="${esc(streamSrc)}"
               data-vid-key="${esc(clipKey)}"
               data-video-stream-url="${esc(clip.mp4Url)}"
               data-original-video-src="${esc(clip.mp4Url)}"
               class="gc-inline-video"></video>
        <div class="gc-clip-caption">
          <span>${esc(clip.headline)}</span>
          <button type="button" class="btn-ghost btn-compact" data-action="close-gamecast-clip">Close</button>
        </div>
      </div>
    `;
  }
  return '';
}

function renderPlayByPlayTabHtml(
  model,
  {
    pbpFilter = 'all',
    pbpQuarter = 'ALL',
    pbpOrder = 'newest',
    expandedDrives = new Set(),
    fieldAnimKey = 0,
    activeGamecastClipKey = '',
    userPrefs = null,
    isLoading = false
  } = {}
) {
  // ESPN vertical order inside Play-by-Play:
  // 1. Live Animated Football Field (when live)
  // 2. Quarter-by-Quarter Linescore + Expandable Win Prob (directly below the field!)
  // 3. Drive Filters + Collapsible Drive Accordions
  const fieldHtml = model.isLive ? renderAnimatedFootballFieldCard(model, fieldAnimKey) : '';
  const quarterCardHtml = !model.isPre ? renderQuarterScoreboardCard(model) : '';

  if (model.isPre) {
    return `
      <section class="card gc-empty-card">
        <div class="gc-empty-title">Live Play-by-Play &amp; Field Tracker unlock at kickoff</div>
        <p class="gc-empty-sub">${esc(model.statusDetail || 'Scheduled')}${model.venue ? ` • ${esc(model.venue)}` : ''}</p>
        <button type="button" class="btn-ghost" data-action="set-season-sub" data-season-sub="matchup">
          ${iconSvg('swords', 13)}
          <span>Open Matchup Preview</span>
        </button>
      </section>
    `;
  }

  const rawDrives = Array.isArray(model.drivesChrono) ? model.drivesChrono : [];
  if (isLoading && rawDrives.length === 0) {
    return `
      <div class="gc-stack">
        ${fieldHtml}
        ${quarterCardHtml}
        <section class="card gc-empty-card">
          <div class="gc-skeleton-line wide"></div>
          <div class="gc-skeleton-line"></div>
          <div class="gc-skeleton-line"></div>
        </section>
      </div>
    `;
  }

  const quarters = model.quartersAvailable?.length ? model.quartersAvailable : ['Q1', 'Q2', 'Q3', 'Q4'];
  const effectiveOrder = model.isLive ? 'newest' : pbpOrder;

  const controlsHtml = `
    <div class="gc-pbp-controls">
      <div class="gc-pbp-mode-row">
        <div class="gc-pbp-modes" role="tablist" aria-label="Play-by-Play Filter">
          ${[
            ['all', 'All Drives'],
            ['scoring', 'Scoring'],
            ['key', 'Key Plays']
          ]
            .map(
              ([k, lbl]) => `
            <button type="button" role="tab" aria-selected="${pbpFilter === k ? 'true' : 'false'}"
                    class="pill-btn gc-mini-pill ${pbpFilter === k ? 'active' : ''}"
                    data-action="set-gamecast-pbp-filter" data-pbp-filter="${k}">
              ${lbl}
            </button>
          `
            )
            .join('')}
        </div>
        ${
          !model.isLive && rawDrives.length > 1
            ? `
              <button type="button" class="pill-btn gc-mini-pill gc-order-btn"
                      data-action="toggle-gamecast-pbp-order"
                      title="Reverse drive order">
                ${effectiveOrder === 'newest' ? 'Newest ↓' : 'Q1 → Q4'}
              </button>
            `
            : ''
        }
      </div>

      <div class="gc-pbp-quarters" role="group" aria-label="Quarter Filter">
        ${['ALL', ...quarters]
          .map(
            q => `
          <button type="button"
                  class="pill-btn gc-q-pill mono ${pbpQuarter === q ? 'active' : ''}"
                  data-action="set-gamecast-pbp-quarter" data-pbp-quarter="${esc(q)}">
            ${esc(q === 'ALL' ? 'All' : q)}
          </button>
        `
          )
          .join('')}
      </div>
    </div>
  `;

  if (rawDrives.length === 0) {
    return `
      <div class="gc-stack">
        ${fieldHtml}
        ${quarterCardHtml}
        <section class="card gc-empty-card">
          <div class="gc-empty-title">Drive play-by-play unavailable offline</div>
          <div class="gc-empty-actions">
            <button type="button" class="btn-ghost" data-action="refresh-gamecast-now">${iconSvg('reset', 12)}<span>Retry Load</span></button>
            ${
              model.gameUrl
                ? `<a href="${esc(model.gameUrl)}" target="_blank" rel="noopener noreferrer" class="source-chip-link"><span>ESPN Play-by-Play</span>${iconSvg('externalLink', 10)}</a>`
                : ''
            }
          </div>
        </section>
      </div>
    `;
  }

  const orderedDrives = effectiveOrder === 'newest' ? [...rawDrives].reverse() : rawDrives;
  const filteredDrives = orderedDrives
    .map(d => {
      const plays = (d.plays || []).filter(p => {
        if (pbpQuarter !== 'ALL' && p.quarterLabel !== pbpQuarter) return false;
        if (pbpFilter === 'scoring') return Boolean(p.isScoring);
        if (pbpFilter === 'key') return Boolean(p.isKeyPlay);
        return true;
      });
      const orderedPlays = effectiveOrder === 'newest' ? [...plays].reverse() : plays;
      return { ...d, visiblePlays: orderedPlays };
    })
    .filter(d => d.visiblePlays.length > 0);

  const defaultOpenId = orderedDrives[0]?.id || '';

  const drivesHtml =
    filteredDrives.length > 0
      ? filteredDrives
          .map(d => {
            const isExplicitOpen =
              expandedDrives instanceof Set && expandedDrives.size > 0
                ? expandedDrives.has(d.id)
                : d.isLiveDrive || d.id === defaultOpenId;
            const isOpen = pbpFilter !== 'all' || isExplicitOpen;
            const badgeCls =
              d.resultTone === 'live'
                ? 'badge-scarlet'
                : d.resultTone === 'positive'
                  ? 'badge-positive'
                  : d.resultTone === 'danger'
                    ? 'badge-danger'
                    : d.resultTone === 'warning'
                      ? 'badge-warning'
                      : 'badge-neutral';

            return `
              <details class="card gc-drive-card ${d.isLiveDrive ? 'is-live-drive' : ''}"
                       data-gamecast-drive-id="${esc(d.id)}"${isOpen ? ' open' : ''}>
                <summary class="gc-drive-summary">
                  <div class="gc-drive-left">
                    ${renderTeamLogoHtml(d.teamAbbr, d.teamLogoUrl, 20)}
                    <span class="badge ${badgeCls} mono gc-drive-res">${esc(d.isLiveDrive ? 'LIVE' : d.resultCode)}</span>
                    <span class="gc-drive-desc">${esc(d.summary)}</span>
                  </div>
                  <div class="gc-drive-right mono">
                    ${d.scoreAfter ? `<span class="gc-drive-score">${esc(d.scoreAfter)}</span>` : ''}
                    <span class="gc-drive-qtr">${esc(d.quarter)} ▾</span>
                  </div>
                </summary>

                <div class="gc-plays-list">
                  ${d.visiblePlays
                    .map(p => {
                      const ydTone =
                        p.yards >= 15
                          ? 'pos'
                          : p.yards < 0 || p.isTurnover
                            ? 'neg'
                            : 'neu';
                      const clipKey = `gc_${model.gameId}_${p.id}`;
                      const clipBtnHtml = p.clip?.mp4Url
                        ? `<button type="button" class="gc-clip-btn" data-action="play-gamecast-clip" data-clip-key="${esc(clipKey)}">▶ Clip</button>`
                        : p.clip?.webUrl
                          ? `<a href="${esc(p.clip.webUrl)}" target="_blank" rel="noopener noreferrer" class="gc-clip-btn">▶ Clip</a>`
                          : '';
                      return `
                        <div class="gc-play-row ${p.isScoring ? 'is-scoring' : ''} ${p.isTurnover ? 'is-turnover' : ''}">
                          <div class="gc-play-meta mono">
                            <span class="gc-play-down">${esc(p.downDistanceSpot || p.quarterLabel)}${p.clock ? ` · ${esc(p.clock)}` : ''}</span>
                            <span class="gc-play-chips">
                              ${
                                p.yards !== 0
                                  ? `<span class="gc-yd-pill ${ydTone}">${p.yards > 0 ? '+' : ''}${p.yards} yds</span>`
                                  : ''
                              }
                              ${p.wpDelta ? `<span class="gc-wp-delta">WP ${esc(p.wpDelta)}</span>` : ''}
                            </span>
                          </div>
                          <div class="gc-play-body">
                            <span class="gc-play-text">${escJargon(p.text, { maxTerms: 4, maxPlayers: 4 })}</span>
                            ${clipBtnHtml}
                          </div>
                          ${renderPlayClipBlockHtml(p, clipKey, activeGamecastClipKey, userPrefs)}
                        </div>
                      `;
                    })
                    .join('')}
                </div>
              </details>
            `;
          })
          .join('')
      : `
        <section class="card gc-empty-card">
          <div class="gc-empty-title">No plays match this filter</div>
          <button type="button" class="btn-ghost" data-action="set-gamecast-pbp-filter" data-pbp-filter="all">
            <span>Show All Drives</span>
          </button>
        </section>
      `;

  return `<div class="gc-stack">${fieldHtml}${quarterCardHtml}${controlsHtml}${drivesHtml}</div>`;
}

/**
 * Main Gamecast View Renderer
 */
export function renderGamecastViewHtml({
  appData,
  mcSimResult = null,
  selectedGameId = null,
  gamecastTab = 'pbp',
  boxTeam = 'team',
  boxUnit = 'all',
  pbpFilter = 'all',
  pbpQuarter = 'ALL',
  pbpOrder = 'newest',
  expandedDrives = new Set(),
  fromSchedule = false,
  gamecastModel = null,
  isLoading = false,
  isSyncing = false,
  fieldAnimKey = 0,
  activeGamecastClipKey = '',
  userPrefs = null
} = {}) {
  const rosterPlayers = appData?.roster?.players || [];
  registerRosterPlayersForInlineLinks(rosterPlayers);

  const listInfo = resolveGamecastGamesList(appData, mcSimResult);
  const games = listInfo.games || [];
  const resolvedGameId =
    (selectedGameId && games.some(g => g.id === String(selectedGameId)) && String(selectedGameId)) ||
    listInfo.defaultGameId;
  const activeMeta = games.find(g => g.id === resolvedGameId) || games[0] || null;

  if (!activeMeta) {
    return `
      <section class="card gc-empty-card">
        <div class="gc-empty-title">No scheduled games available yet</div>
        <p class="gc-empty-sub">Live Play-by-Play, Box Score, and Game Stats will populate automatically as soon as the NFL schedule publishes.</p>
      </section>
    `;
  }

  const model =
    (gamecastModel && String(gamecastModel.gameId) === String(activeMeta.id) ? gamecastModel : null) ||
    buildFallbackGamecastFromSchedule(activeMeta, appData);

  // Register opponent players from Box Score so inline opponent names in Play-by-Play also become clickable!
  const oppMeta = resolveNflTeamMeta(model.oppSide?.abbr || '');
  if (oppMeta) {
    const oppBoxAthletes = (model.boxScore?.opponent || []).flatMap(grp => grp.athletes || []);
    if (oppBoxAthletes.length > 0) {
      registerOpponentPlayersForInlineLinks(oppBoxAthletes, oppMeta.abbr);
    }
  }

  const curIdx = games.findIndex(g => g.id === activeMeta.id);
  const hasPrev = curIdx > 0;
  const hasNext = curIdx >= 0 && curIdx < games.length - 1;
  const away = model.away || {};
  const home = model.home || {};
  const hasScore = away.score != null && home.score != null;
  const syncAgeText = model.fetchedAtIso ? relTime(model.fetchedAtIso) : '';
  const liveLabel = isSyncing ? 'Syncing…' : `Live${syncAgeText ? ` · ${syncAgeText}` : ''}`;

  const activeTab = ['box', 'team', 'pbp'].includes(gamecastTab) ? gamecastTab : model.isLive ? 'pbp' : 'box';

  // 1. ULTRA-SLIM SHARED SCOREBUG (Merged Game Switcher + Single-Row Score, ZERO Quarter Linescore/WinProb here!)
  const scorebugHtml = `
    <section class="card gc-scorebug-card" data-gamecast-scorebug data-game-id="${esc(model.gameId)}" data-game-state="${esc(model.state)}">
      <div class="gc-switcher-strip">
        <div class="gc-switcher-left">
          ${
            fromSchedule
              ? `<button type="button" class="gc-back-btn" data-action="back-to-schedule-from-gamecast" aria-label="Back to Schedule">← Sched</button>`
              : ''
          }
          <button type="button" class="gc-step-btn" data-action="step-gamecast-game" data-step="-1"
                  ${!hasPrev ? 'disabled' : ''} aria-label="Previous game">‹</button>
          <select class="gc-game-select mono" data-action="select-gamecast-game" aria-label="Select game">
            ${games
              .map(
                g => `<option value="${esc(g.id)}"${g.id === activeMeta.id ? ' selected' : ''}>${esc(g.pickerLabel)}</option>`
              )
              .join('')}
          </select>
          <button type="button" class="gc-step-btn" data-action="step-gamecast-game" data-step="1"
                  ${!hasNext ? 'disabled' : ''} aria-label="Next game">›</button>
        </div>

        <div class="gc-switcher-right">
          <button type="button" class="gc-fresh-pill mono ${model.isLive ? 'is-live' : ''}"
                  data-action="refresh-gamecast-now"
                  title="Refresh game data now">
            ${model.isLive ? '<span class="gc-live-dot" aria-hidden="true"></span>' : ''}
            <span>${esc(model.isLive ? liveLabel : model.isFinal ? 'Final' : 'Pre')}</span>
            <span class="gc-refresh-glyph ${isSyncing ? 'spinning' : ''}" aria-hidden="true">↻</span>
          </button>
          ${
            model.gameUrl
              ? `<a href="${esc(model.gameUrl)}" target="_blank" rel="noopener noreferrer" class="gc-espn-link" title="Open on ESPN">ESPN${iconSvg('externalLink', 10)}</a>`
              : ''
          }
        </div>
      </div>

      <div class="gc-score-row">
        <div class="gc-sb-team">
          ${renderTeamLogoHtml(away.abbr, away.logoUrl, 34)}
          <div class="gc-sb-team-meta">
            <div class="gc-sb-name">
              <span>${esc(away.shortName || away.abbr)}</span>
              ${model.isLive && away.hasPossession ? '<span class="gc-poss-dot" title="Possession" aria-label="Has possession">●</span>' : ''}
            </div>
            <div class="gc-sb-sub mono">
              ${away.record ? `<span>${esc(away.record)}</span>` : ''}
              ${model.isLive ? renderTimeoutDotsHtml(away.timeoutsRemaining) : ''}
            </div>
          </div>
        </div>

        <div class="gc-sb-center">
          <div class="gc-sb-score mono">${hasScore ? `${away.score} – ${home.score}` : 'vs'}</div>
          <div class="gc-sb-clock mono ${model.isLive ? 'is-live' : ''}">
            ${esc(model.isLive ? model.statusDetail || model.clock || 'LIVE' : model.isFinal ? model.statusDetail || 'FINAL' : model.statusDetail || 'Scheduled')}
          </div>
        </div>

        <div class="gc-sb-team home">
          <div class="gc-sb-team-meta">
            <div class="gc-sb-name">
              ${model.isLive && home.hasPossession ? '<span class="gc-poss-dot" title="Possession" aria-label="Has possession">●</span>' : ''}
              <span>${esc(home.shortName || home.abbr)}</span>
            </div>
            <div class="gc-sb-sub mono">
              ${model.isLive ? renderTimeoutDotsHtml(home.timeoutsRemaining) : ''}
              ${home.record ? `<span>${esc(home.record)}</span>` : ''}
            </div>
          </div>
          ${renderTeamLogoHtml(home.abbr, home.logoUrl, 34)}
        </div>
      </div>

      ${
        model.isLive && activeTab !== 'pbp'
          ? `
            <div class="gc-live-foot">
              <span class="mono gc-live-foot-sit">${esc(model.situation?.downDistanceText || model.statusDetail || 'Live')}</span>
              <button type="button" class="gc-inactives-link" data-action="set-season-sub" data-season-sub="health">
                <span>Inactives</span>${iconSvg('arrowRight', 11)}
              </button>
            </div>
          `
          : ''
      }
    </section>
  `;

  // 2. STICKY 3-TAB BAR (Sticks under top-header while 2x4 Season nav scrolls away)
  const stickyTabsHtml = `
    <div class="gc-sticky-tabs" data-gamecast-tabs>
      <div class="segmented-control gc-inner-seg" role="tablist" aria-label="Gamecast Sections">
        ${[
          { key: 'box', label: 'Box Score' },
          { key: 'team', label: 'Team Stats' },
          { key: 'pbp', label: 'Play-by-Play' }
        ]
          .map(
            t => `
          <button type="button" role="tab" aria-selected="${activeTab === t.key ? 'true' : 'false'}"
                  class="pill-btn seg-btn ${activeTab === t.key ? 'active' : ''}"
                  data-action="set-gamecast-tab" data-gamecast-tab="${t.key}">
            <span>${t.label}</span>
          </button>
        `
          )
          .join('')}
      </div>
    </div>
  `;

  let bodyHtml = '';
  if (activeTab === 'box') {
    bodyHtml = renderBoxScoreTabHtml(model, { boxTeam, boxUnit, rosterPlayers, isLoading });
  } else if (activeTab === 'team') {
    bodyHtml = renderTeamStatsTabHtml(model, { isLoading });
  } else {
    bodyHtml = renderPlayByPlayTabHtml(model, {
      pbpFilter,
      pbpQuarter,
      pbpOrder,
      expandedDrives,
      fieldAnimKey,
      activeGamecastClipKey,
      userPrefs,
      isLoading
    });
  }

  return `<div class="gc-root" data-gamecast-view>${scorebugHtml}${stickyTabsHtml}${bodyHtml}</div>`;
}
