/**
 * Gamecast View — Live & Historical Box Score, Single-Game Team Stats, and Play-by-Play
 *
 * Layout principles (modern ESPN-inspired UX, zero ad/video clutter):
 * - Clean Scorebug with unboxed large team logos and 3 live timeout pips underneath each team.
 * - Sticky 3-tab bar (`Box Score` | `Team Stats` | `Play-by-Play`) pinned beneath `.top-header`.
 * - Inside `Play-by-Play`:
 *   1. Hero Current Drive card with 3D perspective football field (highlighted drive zone, blue LOS,
 *      yellow 1st-down line, goalposts, drive shaft, pass arcs/arrows, realistic football) + prominent
 *      Last Play callout with inline live Win %.
 *   2. Compact Quarter-by-Quarter Scoring linescore.
 *   3. Single-line delineated Drive/Quarter filter toolbar (`All Drives | Scoring | Key Plays` | `All | Q1–Q4`).
 *   4. Collapsible Drive Accordions with bold ESPN-style play headlines (`10-yd Pass`, `1-yd Run`, `Sack`) & HD clips.
 *   5. Fully expanded ESPN-style Win Probability graph at the bottom.
 *   6. Game Leaders (Top Players) card with headshots & clickable Player Dossier links + `Full Box Score` CTA.
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
import {
  buildFallbackGamecastFromSchedule,
  buildPlayHeadline,
  resolveGamecastGamesList
} from '../engine/gamecastEngine.js';
import { resolveNflTeamMeta } from '../services/remoteTeamDossierService.js';
import { resolveReadOnlyPlatformApiBase } from '../services/aiWorkerClient.js';

function renderTimeoutDotsHtml(count) {
  if (count == null || !Number.isFinite(Number(count))) return '';
  const rem = Math.max(0, Math.min(3, Number(count)));
  return `<span class="gc-timeouts" data-timeouts-remaining="${rem}" aria-label="${rem} timeouts remaining">${Array.from(
    { length: 3 },
    (_, i) => `<span class="gc-to-dot ${i < rem ? 'on' : 'off'}"></span>`
  ).join('')}</span>`;
}

function getInitials(name = '') {
  const parts = String(name || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (parts.length === 0) return '—';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0] || ''}${parts[parts.length - 1][0] || ''}`.toUpperCase();
}

/**
 * Ensures team colors used on the Win Probability chart stay clearly legible and visually
 * distinct from each other across both dark and light themes.
 */
function resolveWinProbChartColor(rawHex, isActiveTeam = true) {
  const clean = String(rawHex || '').trim().replace(/^#/, '');
  if (!/^[0-9a-fA-F]{6}$/.test(clean)) {
    return isActiveTeam ? '#DC2626' : '#3B82F6';
  }
  let r = parseInt(clean.slice(0, 2), 16);
  let g = parseInt(clean.slice(2, 4), 16);
  let b = parseInt(clean.slice(4, 6), 16);
  const luma = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  // Lift very dark navy/black team colors (e.g. PIT, LV, CHI, BAL) so lines/fills stay crisp on dark cards
  if (luma < 68) {
    const lift = 0.42;
    r = Math.min(255, Math.round(r + (255 - r) * lift));
    g = Math.min(255, Math.round(g + (255 - g) * lift));
    b = Math.min(255, Math.round(b + (255 - b) * lift));
  }
  const hex = `#${[r, g, b].map(v => v.toString(16).padStart(2, '0')).join('')}`;
  return hex;
}

function areColorsTooClose(hexA, hexB) {
  const parse = h => {
    const c = String(h || '').replace(/^#/, '');
    if (!/^[0-9a-fA-F]{6}$/.test(c)) return null;
    return [parseInt(c.slice(0, 2), 16), parseInt(c.slice(2, 4), 16), parseInt(c.slice(4, 6), 16)];
  };
  const a = parse(hexA);
  const b = parse(hexB);
  if (!a || !b) return false;
  const dist = Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
  return dist < 72;
}

function buildBoxPlayerTriggerHtml(
  athlete,
  { isActiveTeam = true, oppAbbr = '', rosterPlayers = [], extraClass = 'gc-box-player-name', showPos = true } = {}
) {
  const displayName = String(athlete?.shortName || athlete?.name || '').trim();
  const fullName = String(athlete?.name || displayName).trim();
  const posBadge = showPos && athlete?.position ? `<span class="gc-box-pos">${esc(athlete.position)}</span>` : '';

  if (isActiveTeam) {
    const matched =
      (athlete?.id && rosterPlayers.find(p => String(p.espnId || '') === String(athlete.id))) ||
      lookupRosterPlayerByName(fullName) ||
      lookupRosterPlayerByName(displayName);
    if (matched?.id) {
      return `
        <span class="inline-player-link ${extraClass}" role="button" tabindex="0"
              data-action="open-player-sheet" data-player-id="${esc(matched.id)}">${esc(displayName)}</span>${posBadge}
      `;
    }
  } else {
    const oppMeta = resolveNflTeamMeta(oppAbbr);
    if (oppMeta && fullName) {
      return `
        <span class="inline-player-link ${extraClass}" role="button" tabindex="0"
              data-action="open-opponent-player-sheet"
              data-opp-team="${esc(oppMeta.abbr)}"
              ${athlete?.id ? `data-opp-player-id="${esc(athlete.id)}"` : ''}
              data-opp-player-name="${esc(fullName)}"
              ${athlete?.position ? `data-opp-player-pos="${esc(athlete.position)}"` : ''}
              ${athlete?.espnUrl ? `data-opp-espn-url="${esc(athlete.espnUrl)}"` : ''}>${esc(displayName)}</span>${posBadge}
      `;
    }
  }

  return `<strong class="${extraClass}">${esc(displayName)}</strong>${posBadge}`;
}

/**
 * Fully Expanded ESPN-Style Win Probability Chart rendered at the bottom of `Play-by-Play`.
 * Features a crisp 100 / 50 / 100 grid, vertical Q1–Q4 (and OT) quarter dividers,
 * two-tone team-colored area shading above/below 50%, and clear leading-team header.
 */
function renderWinProbabilityCard(model) {
  const wp = model.winProb || {};
  const activeSide = model.activeSide || {};
  const oppSide = model.oppSide || {};
  const activeAbbr = activeSide.abbr || 'SF';
  const oppAbbr = oppSide.abbr || 'OPP';

  const hasExact = wp.teamPctExact != null && Number.isFinite(Number(wp.teamPctExact));
  const hasInt = wp.teamPct != null && Number.isFinite(Number(wp.teamPct));
  if (!hasExact && !hasInt) return '';

  const teamPctExact = hasExact ? Number(wp.teamPctExact) : Number(wp.teamPct);
  const oppPctExact = Math.max(0, Math.round((100 - teamPctExact) * 10) / 10);
  const teamIsLeading = teamPctExact >= 50;
  const leadSide = teamIsLeading ? activeSide : oppSide;
  const leadPctStr = (teamIsLeading ? teamPctExact : oppPctExact).toFixed(1);
  const trailSide = teamIsLeading ? oppSide : activeSide;
  const trailPctStr = (teamIsLeading ? oppPctExact : teamPctExact).toFixed(1);

  // Build chart points (prefer quarter-aligned `wp.points`, fall back cleanly to `wp.series`)
  const rawPoints =
    Array.isArray(wp.points) && wp.points.length >= 2
      ? wp.points
      : Array.isArray(wp.series) && wp.series.length >= 2
        ? wp.series.map((val, idx, arr) => ({
            x01: arr.length > 1 ? idx / (arr.length - 1) : 0,
            teamPct: Number(val) || 50
          }))
        : [];

  const totalPeriods = Math.max(4, Number(wp.totalPeriods) || (model.quarterHeaders?.length || 4));
  const teamColor = resolveWinProbChartColor(activeSide.color, true);
  let oppColor = resolveWinProbChartColor(oppSide.color, false);
  if (areColorsTooClose(teamColor, oppColor)) {
    oppColor = '#38BDF8';
  }

  let chartHtml = '';
  if (rawPoints.length >= 2) {
    const svgW = 360;
    const svgH = 166;
    const padL = 10;
    const padR = 30;
    const padT = 14;
    const padB = 24;
    const plotW = svgW - padL - padR;
    const plotH = svgH - padT - padB;
    const midY = padT + plotH / 2;

    const mapX = x01 => padL + Math.max(0, Math.min(1, Number(x01) || 0)) * plotW;
    const mapY = pct => padT + ((100 - Math.max(0, Math.min(100, Number(pct) || 50))) / 100) * plotH;

    const coords = rawPoints.map(p => ({
      x: mapX(p.x01),
      y: mapY(p.teamPct),
      pct: Number(p.teamPct) || 50
    }));

    const linePath = coords
      .map((c, idx) => `${idx === 0 ? 'M' : 'L'} ${c.x.toFixed(1)} ${c.y.toFixed(1)}`)
      .join(' ');
    const firstX = coords[0].x.toFixed(1);
    const lastPt = coords[coords.length - 1];
    const lastX = lastPt.x.toFixed(1);
    const areaPath = `${linePath} L ${lastX} ${midY.toFixed(1)} L ${firstX} ${midY.toFixed(1)} Z`;

    const qLabels = [];
    for (let p = 0; p < totalPeriods; p += 1) {
      const frac = p / totalPeriods;
      const lbl = p < 4 ? `Q${p + 1}` : p === 4 ? 'OT' : `${p - 3}OT`;
      qLabels.push({ x: mapX(frac), lbl, isEdge: p === 0 });
    }
    const endLabelX = mapX(1);
    const activeDotColor = lastPt.pct >= 50 ? teamColor : oppColor;

    chartHtml = `
      <div class="gc-wp-chart-wrap">
        <svg viewBox="0 0 ${svgW} ${svgH}" class="gc-wp-svg" role="img"
             aria-label="${esc(activeAbbr)} ${teamPctExact.toFixed(1)}% vs ${esc(oppAbbr)} ${oppPctExact.toFixed(1)}% win probability chart">
          <defs>
            <clipPath id="gc-wp-clip-top">
              <rect x="${padL}" y="${padT - 2}" width="${plotW + 2}" height="${(plotH / 2 + 2).toFixed(1)}" />
            </clipPath>
            <clipPath id="gc-wp-clip-bot">
              <rect x="${padL}" y="${midY.toFixed(1)}" width="${plotW + 2}" height="${(plotH / 2 + 2).toFixed(1)}" />
            </clipPath>
          </defs>

          <!-- Horizontal reference lines (100, 75, 50, 25, 100) -->
          <line x1="${padL}" y1="${padT}" x2="${svgW - padR}" y2="${padT}" class="gc-wp-grid" />
          <line x1="${padL}" y1="${(padT + plotH * 0.25).toFixed(1)}" x2="${svgW - padR}" y2="${(padT + plotH * 0.25).toFixed(1)}" class="gc-wp-grid subtle" />
          <line x1="${padL}" y1="${midY.toFixed(1)}" x2="${svgW - padR}" y2="${midY.toFixed(1)}" class="gc-wp-midline" />
          <line x1="${padL}" y1="${(padT + plotH * 0.75).toFixed(1)}" x2="${svgW - padR}" y2="${(padT + plotH * 0.75).toFixed(1)}" class="gc-wp-grid subtle" />
          <line x1="${padL}" y1="${(padT + plotH).toFixed(1)}" x2="${svgW - padR}" y2="${(padT + plotH).toFixed(1)}" class="gc-wp-grid" />

          <!-- Vertical quarter dividers -->
          ${qLabels
            .map(
              q => `
            <line x1="${q.x.toFixed(1)}" y1="${padT}" x2="${q.x.toFixed(1)}" y2="${(padT + plotH).toFixed(1)}" class="gc-wp-qgrid" />
            <text x="${(q.x + (plotW / totalPeriods) * 0.5).toFixed(1)}" y="${svgH - 6}" class="gc-wp-qlabel" text-anchor="middle">${esc(q.lbl)}</text>
          `
            )
            .join('')}
          <line x1="${endLabelX.toFixed(1)}" y1="${padT}" x2="${endLabelX.toFixed(1)}" y2="${(padT + plotH).toFixed(1)}" class="gc-wp-qgrid" />

          <!-- Two-tone shaded probability area (top = active team, bottom = opponent) -->
          <path d="${areaPath}" fill="${esc(teamColor)}" fill-opacity="0.22" clip-path="url(#gc-wp-clip-top)" />
          <path d="${areaPath}" fill="${esc(oppColor)}" fill-opacity="0.22" clip-path="url(#gc-wp-clip-bot)" />

          <!-- Two-tone crisp curve stroke -->
          <path d="${linePath}" fill="none" stroke="${esc(teamColor)}" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round" clip-path="url(#gc-wp-clip-top)" />
          <path d="${linePath}" fill="none" stroke="${esc(oppColor)}" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round" clip-path="url(#gc-wp-clip-bot)" />

          <!-- Latest play vertical drop guide & glowing dot -->
          <line x1="${lastX}" y1="${midY.toFixed(1)}" x2="${lastX}" y2="${lastPt.y.toFixed(1)}" stroke="${esc(activeDotColor)}" stroke-width="1" stroke-opacity="0.45" stroke-dasharray="2 2" />
          <circle cx="${lastX}" cy="${lastPt.y.toFixed(1)}" r="4.2" fill="${esc(activeDotColor)}" class="gc-wp-dot-ring" />

          <!-- Team side orientation labels -->
          <text x="${padL + 3}" y="${padT + 10}" class="gc-wp-team-tag" fill="${esc(teamColor)}">${esc(activeAbbr)}</text>
          <text x="${padL + 3}" y="${(padT + plotH - 4).toFixed(1)}" class="gc-wp-team-tag" fill="${esc(oppColor)}">${esc(oppAbbr)}</text>

          <!-- Right-side ESPN Y-axis ticks (100 / 50 / 100) -->
          <text x="${svgW - padR + 5}" y="${padT + 3}" class="gc-wp-axis">100</text>
          <text x="${svgW - padR + 5}" y="${(midY + 3).toFixed(1)}" class="gc-wp-axis mid">50</text>
          <text x="${svgW - padR + 5}" y="${(padT + plotH + 3).toFixed(1)}" class="gc-wp-axis">100</text>
        </svg>
      </div>
    `;
  } else {
    chartHtml = `
      <div class="gc-wp-bar-wrap">
        <div class="gc-wp-bar" role="presentation">
          <div class="gc-wp-bar-team" style="width:${teamPctExact}%;background:${esc(teamColor)}"></div>
          <div class="gc-wp-bar-opp" style="width:${oppPctExact}%;background:${esc(oppColor)}"></div>
        </div>
        <div class="gc-wp-empty">Win probability curve populates as plays are logged.</div>
      </div>
    `;
  }

  return `
    <section class="card gc-wp-card" data-gamecast-winprob>
      <div class="gc-wp-card-head">
        <div class="gc-wp-card-title-wrap">
          <h3 class="gc-section-title">Win Probability</h3>
          <span class="gc-wp-sub-split mono">${esc(trailSide.abbr || oppAbbr)} ${trailPctStr}%</span>
        </div>
        <div class="gc-wp-lead-stat">
          ${renderTeamLogoHtml(leadSide.abbr, leadSide.logoUrl, 22, 'gc-logo-bare')}
          <span class="gc-wp-lead-abbr">${esc(leadSide.abbr || activeAbbr)}</span>
          <strong class="gc-wp-lead-pct mono">${leadPctStr}%</strong>
        </div>
      </div>
      ${chartHtml}
    </section>
  `;
}

/**
 * ESPN-style Game Leaders (Top Players) card rendered at the bottom of `Play-by-Play`.
 * Displays Passing Yards, Rushing Yards, Receiving Yards, Sacks, and Tackles with headshots
 * and clickable native Player Dossier links, plus a quick jump to `Full Box Score`.
 */
function renderGameLeadersCard(model, rosterPlayers = []) {
  const leaders = Array.isArray(model.gameLeaders) ? model.gameLeaders : [];
  if (leaders.length === 0) return '';
  const away = model.away || {};
  const home = model.home || {};
  const oppAbbr = model.oppSide?.abbr || '';

  const renderLeaderAvatar = (player, sideColor) => {
    if (!player) return `<span class="gc-ldr-avatar gc-ldr-avatar-empty">—</span>`;
    const initials = getInitials(player.name || player.shortName);
    if (player.headshotUrl) {
      return `
        <span class="gc-ldr-avatar" style="--ldr-ring:${esc(sideColor || '#64748b')}">
          <span class="gc-ldr-initials mono" aria-hidden="true">${esc(initials)}</span>
          <img class="gc-ldr-img" src="${esc(player.headshotUrl)}" alt="${esc(player.shortName || player.name)}" width="36" height="36" loading="lazy" decoding="async" />
        </span>
      `;
    }
    return `
      <span class="gc-ldr-avatar img-error" style="--ldr-ring:${esc(sideColor || '#64748b')}">
        <span class="gc-ldr-initials mono" aria-hidden="true">${esc(initials)}</span>
      </span>
    `;
  };

  const renderLeaderSide = (player, isAway) => {
    const teamObj = isAway ? away : home;
    if (!player) {
      return `
        <div class="gc-ldr-side ${isAway ? 'away' : 'home'} is-empty">
          <span class="gc-ldr-stat mono muted">—</span>
        </div>
      `;
    }
    const nameHtml = buildBoxPlayerTriggerHtml(player, {
      isActiveTeam: Boolean(teamObj.isActive),
      oppAbbr: teamObj.isActive ? oppAbbr : teamObj.abbr,
      rosterPlayers,
      extraClass: 'gc-ldr-name',
      showPos: true
    });
    return `
      <div class="gc-ldr-side ${isAway ? 'away' : 'home'}">
        <div class="gc-ldr-top-row">
          ${isAway ? renderLeaderAvatar(player, teamObj.color) : ''}
          <strong class="gc-ldr-stat mono">${esc(player.primaryStat)}</strong>
          ${!isAway ? renderLeaderAvatar(player, teamObj.color) : ''}
        </div>
        <div class="gc-ldr-identity">
          <div class="gc-ldr-name-line">${nameHtml}</div>
          ${player.subStat ? `<div class="gc-ldr-sub mono">${esc(player.subStat)}</div>` : ''}
        </div>
      </div>
    `;
  };

  return `
    <section class="card gc-leaders-card" data-gamecast-leaders>
      <div class="gc-leaders-head">
        <h3 class="gc-section-title">Game Leaders</h3>
        <div class="gc-leaders-teams">
          <span class="gc-leaders-team-chip">
            ${renderTeamLogoHtml(away.abbr, away.logoUrl, 20, 'gc-logo-bare')}
            <strong>${esc(away.abbr)}</strong>
          </span>
          <span class="gc-leaders-vs">vs</span>
          <span class="gc-leaders-team-chip">
            <strong>${esc(home.abbr)}</strong>
            ${renderTeamLogoHtml(home.abbr, home.logoUrl, 20, 'gc-logo-bare')}
          </span>
        </div>
      </div>

      <div class="gc-leaders-list">
        ${leaders
          .map(
            row => `
          <div class="gc-ldr-row" data-leader-category="${esc(row.key)}">
            ${renderLeaderSide(row.away, true)}
            <div class="gc-ldr-cat">${esc(row.label)}</div>
            ${renderLeaderSide(row.home, false)}
          </div>
        `
          )
          .join('')}
      </div>

      <div class="gc-leaders-foot">
        <button type="button" class="gc-full-box-btn" data-action="set-gamecast-tab" data-gamecast-tab="box">
          <span>Full Box Score</span>
          ${iconSvg('arrowRight', 12)}
        </button>
      </div>
    </section>
  `;
}

/**
 * ESPN-Inspired Modern 3D Perspective Football Field + Current Drive Header + Prominent Last Play.
 * Geometry: True trapezoidal 3D projection (`u` in [-10..110], `v` in [0..1]).
 * Keeps highlighted drive area, blue Line of Scrimmage, yellow 1st-Down marker, goalposts,
 * directional play arrows, small up-and-down pass arcs, and a realistic non-cartoony football.
 */
function renderAnimatedFootballFieldCard(model, fieldAnimKey = 0) {
  const sit = model.situation || {};
  const away = model.away || {};
  const home = model.home || {};
  const wp = model.winProb || {};

  // 3D Trapezoid Projection Helper:
  // u in [-10..0] = Away EZ, [0..100] = Playing Field, [100..110] = Home EZ
  // v in [0..1]: 0 = far sideline (top), 1 = near sideline (bottom)
  const yTop = 18;
  const yBot = 90;
  const xTopL = 36;
  const xTopR = 344;
  const xBotL = 10;
  const xBotR = 370;

  const proj = (u, v) => {
    const t = (u + 10) / 120;
    const xL = xTopL + (xBotL - xTopL) * v;
    const xR = xTopR + (xBotR - xTopR) * v;
    return {
      x: xL + (xR - xL) * t,
      y: yTop + (yBot - yTop) * v
    };
  };

  const quadPoints = (u1, u2, v1 = 0, v2 = 1) => {
    const tl = proj(u1, v1);
    const tr = proj(u2, v1);
    const br = proj(u2, v2);
    const bl = proj(u1, v2);
    return `${tl.x.toFixed(1)},${tl.y.toFixed(1)} ${tr.x.toFixed(1)},${tr.y.toFixed(1)} ${br.x.toFixed(1)},${br.y.toFixed(1)} ${bl.x.toFixed(1)},${bl.y.toFixed(1)}`;
  };

  const ballU = Math.max(0, Math.min(100, Number(sit.ballPos0to100 ?? 50)));
  const prevU = Math.max(0, Math.min(100, Number(sit.prevPos0to100 ?? ballU)));
  const driveStartU = Math.max(0, Math.min(100, Number(sit.driveStartPos0to100 ?? prevU)));
  const firstDownU = Math.max(0, Math.min(100, Number(sit.firstDownPos0to100 ?? 60)));

  const isTd = Boolean(sit.isTouchdownLastPlay);
  const possessingColor = sit.possessionSide === 'away' ? away.color : home.color;
  const driveMinU = Math.min(driveStartU, ballU);
  const driveMaxU = Math.max(driveStartU, ballU);
  const hasDriveSpan = driveMaxU - driveMinU >= 0.8;

  // Play trajectory coordinates at field depth v = 0.54 (visually centered in perspective)
  const playV = 0.54;
  const pDriveStart = proj(driveStartU, playV);
  const pPrev = proj(prevU, playV);
  const pBall = proj(ballU, playV);
  const dxPlay = pBall.x - pPrev.x;
  const hasMovement = Math.abs(dxPlay) >= 3.2;
  const hasPriorDriveShaft = Math.abs(pPrev.x - pDriveStart.x) >= 4;

  // Line of Scrimmage (Blue) & 1st Down Marker (Yellow) perspective segments
  const losTop = proj(ballU, 0);
  const losBot = proj(ballU, 1);
  const fdTop = proj(firstDownU, 0);
  const fdBot = proj(firstDownU, 1);
  const showFirstDownLine = !isTd && Math.abs(firstDownU - ballU) >= 0.5 && firstDownU > 0.5 && firstDownU < 99.5;

  // Compute clean directional play arc / arrow (stopped just short of football so arrowhead is visible)
  const dirSign = dxPlay >= 0 ? 1 : -1;
  const tipOffset = Math.min(Math.abs(dxPlay) * 0.25, 8.5);
  const endArrowX = hasMovement ? pBall.x - dirSign * tipOffset : pBall.x;
  const midPlayX = (pPrev.x + endArrowX) / 2;
  const passArcLift = Math.min(24, Math.max(13, Math.abs(dxPlay) * 0.36));
  const passPeakY = Math.max(8, pBall.y - passArcLift);

  // Incomplete pass short up-and-down visual cue
  const isIncomplete = Boolean(sit.lastPlayIsIncomplete);
  const incDir = sit.possessionSide === 'away' ? 1 : -1;
  const incEndU = Math.max(2, Math.min(98, ballU + incDir * 9));
  const pIncEnd = proj(incEndU, playV);
  const pIncMidX = (pBall.x + pIncEnd.x) / 2;

  // Endzone label centers
  const awayEzMid = proj(-5, 0.52);
  const homeEzMid = proj(105, 0.52);
  const awayEzLabel = away.abbr === 'SF' ? '49ERS' : (away.shortName || away.abbr || '').toUpperCase().slice(0, 10);
  const homeEzLabel = home.abbr === 'SF' ? '49ERS' : (home.shortName || home.abbr || '').toUpperCase().slice(0, 10);

  // Goalposts anchored at back of each endzone (u = -10 and u = 110, v = 0.45)
  const gpLeftBase = proj(-10, 0.46);
  const gpRightBase = proj(110, 0.46);

  // Live Win Prob badge for top Last Play header (Requirement #3 + Photo 8)
  const hasWp = wp.teamPctExact != null || wp.teamPct != null;
  const wpTeamExact = wp.teamPctExact != null ? Number(wp.teamPctExact) : Number(wp.teamPct ?? 50);
  const wpOppExact = Math.max(0, Math.round((100 - wpTeamExact) * 10) / 10);
  const wpLeadIsTeam = wpTeamExact >= 50;
  const wpLeadSide = wpLeadIsTeam ? model.activeSide || {} : model.oppSide || {};
  const wpLeadPctStr = (wpLeadIsTeam ? wpTeamExact : wpOppExact).toFixed(1);

  const driveTeamAbbr = sit.currentDriveTeamAbbr || sit.possessionAbbr || away.abbr;
  const driveTeamLogo = sit.currentDriveTeamLogo || (sit.possessionSide === 'away' ? away.logoUrl : home.logoUrl);
  const downOnly = sit.downOnlyText || sit.shortDownDistanceText || sit.downDistanceText || model.statusDetail || 'Live';
  const spotOnly = sit.spotOnlyText || sit.possessionText || '';
  const lastHeadline =
    sit.lastPlayHeadline ||
    (sit.lastPlayText ? buildPlayHeadline({ text: sit.lastPlayText, statYardage: sit.lastPlayYards }).headline : '');
  const lastTone = sit.lastPlayHeadlineTone || 'neu';

  return `
    <section class="card gc-field-card" data-gamecast-field data-anim-key="${Number(fieldAnimKey) || 0}">
      <!-- Photo 8 Inspired Current Drive Header -->
      <div class="gc-drive-hero-head">
        <div class="gc-drive-hero-left">
          ${renderTeamLogoHtml(driveTeamAbbr, driveTeamLogo, 26, 'gc-logo-bare')}
          <div class="gc-drive-hero-meta">
            <div class="gc-drive-hero-title">CURRENT DRIVE</div>
            ${
              sit.currentDriveSummary
                ? `<div class="gc-drive-hero-sub mono">${esc(sit.currentDriveSummary)}</div>`
                : ''
            }
          </div>
        </div>
        <div class="gc-drive-hero-badges">
          ${sit.isRedZone && !isTd ? '<span class="gc-rz-pill">RED ZONE</span>' : ''}
          ${isTd ? '<span class="gc-td-pill">TOUCHDOWN</span>' : '<span class="gc-live-chip"><span class="gc-live-dot" aria-hidden="true"></span>LIVE</span>'}
        </div>
      </div>

      <!-- Centered Down & Ball On KPI Strip (Photo 8) -->
      ${
        isTd
          ? `<div class="gc-sit-kpi-bar is-td mono"><strong>TOUCHDOWN ${esc(sit.possessionAbbr || '')}!</strong></div>`
          : `
            <div class="gc-sit-kpi-bar">
              <div class="gc-sit-kpi">
                <span class="gc-sit-kpi-lbl">Down</span>
                <strong class="gc-sit-kpi-val mono">${esc(downOnly)}</strong>
              </div>
              <span class="gc-sit-kpi-sep" aria-hidden="true"></span>
              <div class="gc-sit-kpi">
                <span class="gc-sit-kpi-lbl">Ball on</span>
                <strong class="gc-sit-kpi-val mono">${esc(spotOnly || '50')}</strong>
              </div>
            </div>
          `
      }

      <!-- 3D Perspective Football Field -->
      <div class="gc-field-stage">
        <svg viewBox="0 0 380 116" class="gc-field-svg" role="img"
             aria-label="Live 3D field position: ${esc(sit.downDistanceText || downOnly || 'Midfield')}">
          <defs>
            <linearGradient id="gc-field-depth" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stop-color="#0b2815" stop-opacity="0.34" />
              <stop offset="45%" stop-color="#000000" stop-opacity="0" />
              <stop offset="100%" stop-color="#071d0f" stop-opacity="0.26" />
            </linearGradient>
            <radialGradient id="gc-ball-leather" cx="38%" cy="32%" r="68%">
              <stop offset="0%" stop-color="#b4602c" />
              <stop offset="52%" stop-color="#7c3312" />
              <stop offset="100%" stop-color="#3c1506" />
            </radialGradient>
            <marker id="gc-arrow-pass" viewBox="0 0 8 8" refX="6.2" refY="4" markerWidth="5.2" markerHeight="5.2" orient="auto">
              <path d="M 0.8 1.2 L 7 4 L 0.8 6.8 L 2.2 4 Z" fill="#facc15" />
            </marker>
            <marker id="gc-arrow-run" viewBox="0 0 8 8" refX="6.2" refY="4" markerWidth="5.2" markerHeight="5.2" orient="auto">
              <path d="M 0.8 1.2 L 7 4 L 0.8 6.8 L 2.2 4 Z" fill="#ffffff" />
            </marker>
            <marker id="gc-arrow-neg" viewBox="0 0 8 8" refX="6.2" refY="4" markerWidth="5.2" markerHeight="5.2" orient="auto">
              <path d="M 0.8 1.2 L 7 4 L 0.8 6.8 L 2.2 4 Z" fill="#fb7185" />
            </marker>
          </defs>

          <!-- 3D Turf Slab Front Skirt -->
          <polygon points="${xBotL},${yBot} ${xBotR},${yBot} ${xBotR},${yBot + 4.5} ${xBotL},${yBot + 4.5}" fill="#0d2c17" />
          <polygon points="${proj(-10, 1).x.toFixed(1)},${yBot} ${proj(0, 1).x.toFixed(1)},${yBot} ${proj(0, 1).x.toFixed(1)},${yBot + 4.5} ${proj(-10, 1).x.toFixed(1)},${yBot + 4.5}" fill="${esc(away.color || '#1E293B')}" fill-opacity="0.72" />
          <polygon points="${proj(100, 1).x.toFixed(1)},${yBot} ${proj(110, 1).x.toFixed(1)},${yBot} ${proj(110, 1).x.toFixed(1)},${yBot + 4.5} ${proj(100, 1).x.toFixed(1)},${yBot + 4.5}" fill="${esc(home.color || '#AA0000')}" fill-opacity="0.72" />

          <!-- 10 Alternating 3D Perspective Turf Stripes -->
          ${Array.from({ length: 10 }, (_, i) =>
            `<polygon points="${quadPoints(i * 10, (i + 1) * 10)}" fill="${i % 2 === 0 ? '#236b38' : '#1d5d30'}" />`
          ).join('')}

          <!-- Subtle Stadium Depth Lighting -->
          <polygon points="${quadPoints(0, 100)}" fill="url(#gc-field-depth)" />

          <!-- Left 3D Endzone (Away) -->
          <polygon points="${quadPoints(-10, 0)}" fill="${esc(away.color || '#1E293B')}" class="${isTd && sit.possessionSide === 'home' ? 'gc-td-flash' : ''}" />
          <polygon points="${quadPoints(-10, 0)}" fill="url(#gc-field-depth)" />
          <text x="${awayEzMid.x.toFixed(1)}" y="${awayEzMid.y.toFixed(1)}"
                fill="${away.abbr === 'SF' ? '#E2C67E' : '#FFFFFF'}" fill-opacity="0.92"
                font-size="${awayEzLabel.length > 7 ? '7.6' : '8.8'}" font-weight="900"
                text-anchor="middle" dominant-baseline="middle"
                transform="rotate(-77 ${awayEzMid.x.toFixed(1)} ${awayEzMid.y.toFixed(1)})"
                letter-spacing="1.2">${esc(awayEzLabel)}</text>

          <!-- Right 3D Endzone (Home) -->
          <polygon points="${quadPoints(100, 110)}" fill="${esc(home.color || '#AA0000')}" class="${isTd && sit.possessionSide === 'away' ? 'gc-td-flash' : ''}" />
          <polygon points="${quadPoints(100, 110)}" fill="url(#gc-field-depth)" />
          <text x="${homeEzMid.x.toFixed(1)}" y="${homeEzMid.y.toFixed(1)}"
                fill="${home.abbr === 'SF' ? '#E2C67E' : '#FFFFFF'}" fill-opacity="0.92"
                font-size="${homeEzLabel.length > 7 ? '7.6' : '8.8'}" font-weight="900"
                text-anchor="middle" dominant-baseline="middle"
                transform="rotate(77 ${homeEzMid.x.toFixed(1)} ${homeEzMid.y.toFixed(1)})"
                letter-spacing="1.2">${esc(homeEzLabel)}</text>

          <!-- Perspective Yard Lines (10..90) + Subtle Hash Ticks -->
          ${[10, 20, 30, 40, 50, 60, 70, 80, 90]
            .map(yd => {
              const pT = proj(yd, 0);
              const pB = proj(yd, 1);
              return `<line x1="${pT.x.toFixed(1)}" y1="${pT.y.toFixed(1)}" x2="${pB.x.toFixed(1)}" y2="${pB.y.toFixed(1)}" stroke="rgba(255,255,255,${yd === 50 ? '0.42' : '0.26'})" stroke-width="${yd === 50 ? '1.35' : '0.85'}" />`;
            })
            .join('')}

          <!-- Perspective Hash Mark Rows -->
          <line x1="${proj(0, 0.35).x.toFixed(1)}" y1="${proj(0, 0.35).y.toFixed(1)}" x2="${proj(100, 0.35).x.toFixed(1)}" y2="${proj(100, 0.35).y.toFixed(1)}" stroke="rgba(255,255,255,0.22)" stroke-width="0.9" stroke-dasharray="1.8 4.4" />
          <line x1="${proj(0, 0.67).x.toFixed(1)}" y1="${proj(0, 0.67).y.toFixed(1)}" x2="${proj(100, 0.67).x.toFixed(1)}" y2="${proj(100, 0.67).y.toFixed(1)}" stroke="rgba(255,255,255,0.24)" stroke-width="1" stroke-dasharray="2 4.9" />

          <!-- Outer Field Boundary & Crisp White Goal Lines -->
          <polygon points="${quadPoints(-10, 110)}" fill="none" stroke="rgba(255,255,255,0.48)" stroke-width="1.1" />
          <line x1="${proj(0, 0).x.toFixed(1)}" y1="${proj(0, 0).y.toFixed(1)}" x2="${proj(0, 1).x.toFixed(1)}" y2="${proj(0, 1).y.toFixed(1)}" stroke="#FFFFFF" stroke-width="1.6" />
          <line x1="${proj(100, 0).x.toFixed(1)}" y1="${proj(100, 0).y.toFixed(1)}" x2="${proj(100, 1).x.toFixed(1)}" y2="${proj(100, 1).y.toFixed(1)}" stroke="#FFFFFF" stroke-width="1.6" />

          <!-- 3D Minimalist Yellow Goalposts (Left & Right) -->
          <g class="gc-goalposts" stroke-linecap="round" stroke-linejoin="round" fill="none">
            <!-- Left Goalpost -->
            <line x1="${(gpLeftBase.x - 4).toFixed(1)}" y1="${(gpLeftBase.y + 4).toFixed(1)}" x2="${(gpLeftBase.x - 4).toFixed(1)}" y2="${(gpLeftBase.y - 4).toFixed(1)}" class="gc-gp-post" stroke-width="1.5" />
            <path d="M ${(gpLeftBase.x - 8).toFixed(1)} ${(gpLeftBase.y - 19).toFixed(1)} L ${(gpLeftBase.x - 8).toFixed(1)} ${(gpLeftBase.y - 4).toFixed(1)} L ${(gpLeftBase.x - 1).toFixed(1)} ${(gpLeftBase.y - 7).toFixed(1)} L ${(gpLeftBase.x - 1).toFixed(1)} ${(gpLeftBase.y - 22).toFixed(1)}" class="gc-gp-fork" stroke-width="1.55" />
            <!-- Right Goalpost -->
            <line x1="${(gpRightBase.x + 4).toFixed(1)}" y1="${(gpRightBase.y + 4).toFixed(1)}" x2="${(gpRightBase.x + 4).toFixed(1)}" y2="${(gpRightBase.y - 4).toFixed(1)}" class="gc-gp-post" stroke-width="1.5" />
            <path d="M ${(gpRightBase.x + 1).toFixed(1)} ${(gpRightBase.y - 22).toFixed(1)} L ${(gpRightBase.x + 1).toFixed(1)} ${(gpRightBase.y - 7).toFixed(1)} L ${(gpRightBase.x + 8).toFixed(1)} ${(gpRightBase.y - 4).toFixed(1)} L ${(gpRightBase.x + 8).toFixed(1)} ${(gpRightBase.y - 19).toFixed(1)}" class="gc-gp-fork" stroke-width="1.55" />
          </g>

          <!-- Highlighted Drive Progress Zone (Kept per Req #1!) -->
          ${
            hasDriveSpan
              ? `<polygon points="${quadPoints(driveMinU, driveMaxU)}" fill="${esc(possessingColor || '#AA0000')}" fill-opacity="0.30" />`
              : ''
          }

          <!-- Blue Line of Scrimmage & Yellow First-Down Line (Kept per Req #1!) -->
          ${
            !isTd
              ? `
                <line x1="${losTop.x.toFixed(1)}" y1="${losTop.y.toFixed(1)}" x2="${losBot.x.toFixed(1)}" y2="${losBot.y.toFixed(1)}" stroke="rgba(0,0,0,0.45)" stroke-width="3.4" />
                <line x1="${losTop.x.toFixed(1)}" y1="${losTop.y.toFixed(1)}" x2="${losBot.x.toFixed(1)}" y2="${losBot.y.toFixed(1)}" stroke="#38bdf8" stroke-width="2.1" class="gc-los-line" />
              `
              : ''
          }
          ${
            showFirstDownLine
              ? `
                <line x1="${fdTop.x.toFixed(1)}" y1="${fdTop.y.toFixed(1)}" x2="${fdBot.x.toFixed(1)}" y2="${fdBot.y.toFixed(1)}" stroke="rgba(0,0,0,0.45)" stroke-width="3.6" />
                <line x1="${fdTop.x.toFixed(1)}" y1="${fdTop.y.toFixed(1)}" x2="${fdBot.x.toFixed(1)}" y2="${fdBot.y.toFixed(1)}" stroke="#facc15" stroke-width="2.3" class="gc-firstdown-line" />
              `
              : ''
          }

          <!-- Prior Drive Progression Shaft (ESPN-style solid line up to previous spot) -->
          ${
            hasPriorDriveShaft
              ? `
                <line x1="${pDriveStart.x.toFixed(1)}" y1="${pDriveStart.y.toFixed(1)}"
                      x2="${pPrev.x.toFixed(1)}" y2="${pPrev.y.toFixed(1)}"
                      stroke="rgba(255,255,255,0.52)" stroke-width="1.6" stroke-linecap="round" />
                <circle cx="${pDriveStart.x.toFixed(1)}" cy="${pDriveStart.y.toFixed(1)}" r="2.1" fill="rgba(255,255,255,0.68)" />
              `
              : ''
          }

          <!-- Last Play Trajectory: Small Up-and-Down Pass Arc or Solid Run/Sack Arrow -->
          ${
            isIncomplete
              ? `
                <path d="M ${pBall.x.toFixed(1)} ${pBall.y.toFixed(1)} Q ${pIncMidX.toFixed(1)} ${(pBall.y - 16).toFixed(1)} ${pIncEnd.x.toFixed(1)} ${pIncEnd.y.toFixed(1)}"
                      fill="none" stroke="rgba(250,204,21,0.78)" stroke-width="1.8" stroke-dasharray="3.2 2.6" stroke-linecap="round" class="gc-play-arc-anim" />
                <g stroke="#fb7185" stroke-width="1.6" stroke-linecap="round">
                  <line x1="${(pIncEnd.x - 2.6).toFixed(1)}" y1="${(pIncEnd.y - 2.6).toFixed(1)}" x2="${(pIncEnd.x + 2.6).toFixed(1)}" y2="${(pIncEnd.y + 2.6).toFixed(1)}" />
                  <line x1="${(pIncEnd.x + 2.6).toFixed(1)}" y1="${(pIncEnd.y - 2.6).toFixed(1)}" x2="${(pIncEnd.x - 2.6).toFixed(1)}" y2="${(pIncEnd.y + 2.6).toFixed(1)}" />
                </g>
              `
              : hasMovement
                ? sit.lastPlayIsPass && !sit.lastPlayIsSack
                  ? `
                    <circle cx="${pPrev.x.toFixed(1)}" cy="${pPrev.y.toFixed(1)}" r="2.4" fill="#facc15" fill-opacity="0.88" />
                    <path d="M ${pPrev.x.toFixed(1)} ${pPrev.y.toFixed(1)} Q ${midPlayX.toFixed(1)} ${passPeakY.toFixed(1)} ${endArrowX.toFixed(1)} ${pBall.y.toFixed(1)}"
                          fill="none"
                          stroke="#facc15"
                          stroke-width="2.1"
                          stroke-dasharray="4 2.6"
                          stroke-linecap="round"
                          marker-end="url(#gc-arrow-pass)"
                          class="gc-play-arc-anim gc-pass-arc" />
                  `
                  : `
                    <circle cx="${pPrev.x.toFixed(1)}" cy="${pPrev.y.toFixed(1)}" r="2.4" fill="${sit.lastPlayIsSack || sit.lastPlayYards < 0 ? '#fb7185' : '#ffffff'}" fill-opacity="0.88" />
                    <line x1="${pPrev.x.toFixed(1)}" y1="${pPrev.y.toFixed(1)}"
                          x2="${endArrowX.toFixed(1)}" y2="${pBall.y.toFixed(1)}"
                          stroke="${sit.lastPlayIsSack || sit.lastPlayYards < 0 ? '#fb7185' : '#ffffff'}"
                          stroke-width="2.2"
                          stroke-linecap="round"
                          marker-end="url(#${sit.lastPlayIsSack || sit.lastPlayYards < 0 ? 'gc-arrow-neg' : 'gc-arrow-run'})"
                          class="gc-play-arc-anim gc-run-arrow" />
                  `
                : ''
          }

          <!-- Sleek Realistic Broadcast Football Marker (Outer translate prevents CSS transform override!) -->
          <g transform="translate(${pBall.x.toFixed(1)}, ${pBall.y.toFixed(1)})">
            <g class="gc-ball-pop">
              <ellipse cx="0" cy="4.4" rx="5.8" ry="1.8" fill="rgba(0,0,0,0.44)" />
              <path d="M -6.4 0 C -3.8 -3.7, 3.8 -3.7, 6.4 0 C 3.8 3.7, -3.8 3.7, -6.4 0 Z"
                    fill="url(#gc-ball-leather)" stroke="rgba(255,255,255,0.65)" stroke-width="0.65" />
              <!-- Subtle end stripes -->
              <path d="M -3.9 -1.8 Q -3.4 0 -3.9 1.8" fill="none" stroke="rgba(255,255,255,0.58)" stroke-width="0.7" />
              <path d="M 3.9 -1.8 Q 3.4 0 3.9 1.8" fill="none" stroke="rgba(255,255,255,0.58)" stroke-width="0.7" />
              <!-- Fine broadcast laces -->
              <line x1="-1.9" y1="-0.3" x2="1.9" y2="-0.3" stroke="rgba(255,255,255,0.88)" stroke-width="0.65" stroke-linecap="round" />
              <line x1="-1.1" y1="-1.1" x2="-1.1" y2="0.5" stroke="rgba(255,255,255,0.82)" stroke-width="0.55" />
              <line x1="0" y1="-1.2" x2="0" y2="0.6" stroke="rgba(255,255,255,0.82)" stroke-width="0.55" />
              <line x1="1.1" y1="-1.1" x2="1.1" y2="0.5" stroke="rgba(255,255,255,0.82)" stroke-width="0.55" />
            </g>
          </g>

          <!-- Bottom Apron Yard Numbers (ESPN-Style Below Near Sideline) -->
          <text x="${proj(-5, 1).x.toFixed(1)}" y="108" class="gc-field-num side" text-anchor="middle">${esc(away.abbr)}</text>
          ${[10, 20, 30, 40, 50, 60, 70, 80, 90]
            .map(yd => {
              const pB = proj(yd, 1);
              const lbl = yd <= 50 ? yd : 100 - yd;
              return `<text x="${pB.x.toFixed(1)}" y="108" class="gc-field-num" text-anchor="middle">${lbl}</text>`;
            })
            .join('')}
          <text x="${proj(105, 1).x.toFixed(1)}" y="108" class="gc-field-num side" text-anchor="middle">${esc(home.abbr)}</text>

          ${
            isTd
              ? `
                <rect x="98" y="34" width="184" height="36" rx="8" fill="rgba(170,0,0,0.94)" stroke="#E2C67E" stroke-width="1.5" />
                <text x="190" y="56.5" fill="#FFFFFF" font-size="13" font-weight="900" text-anchor="middle" letter-spacing="1.4">TOUCHDOWN ${esc(sit.possessionAbbr || '')}!</text>
              `
              : ''
          }
        </svg>
      </div>

      <!-- Prominent Last Play Panel Below 3D Field (Photo 7 & Photo 8) -->
      ${
        sit.lastPlayText || lastHeadline
          ? `
            <div class="gc-last-play-panel" data-gamecast-last-play>
              <div class="gc-last-play-top">
                <strong class="gc-last-play-headline tone-${esc(lastTone)}">${esc(lastHeadline || 'Last Play')}</strong>
                <div class="gc-last-play-right">
                  ${
                    hasWp
                      ? `
                        <span class="gc-lp-winprob mono" data-gamecast-top-winprob>
                          <span class="gc-lp-wp-lbl">Win %:</span>
                          ${renderTeamLogoHtml(wpLeadSide.abbr, wpLeadSide.logoUrl, 16, 'gc-logo-bare')}
                          <strong>${wpLeadPctStr}%</strong>
                        </span>
                      `
                      : ''
                  }
                  <span class="gc-last-play-badge">Last Play</span>
                </div>
              </div>
              ${
                sit.lastPlayText
                  ? `<div class="gc-last-play-desc">${escJargon(sit.lastPlayText, { maxTerms: 4, maxPlayers: 4 })}</div>`
                  : ''
              }
            </div>
          `
          : ''
      }
    </section>
  `;
}

/**
 * Compact Quarter-by-Quarter Scoring Table.
 * Rendered ONLY on the `Play-by-Play` tab (directly below the live football field).
 */
function renderQuarterScoreboardCard(model) {
  const away = model.away || {};
  const home = model.home || {};
  const qHeaders = model.quarterHeaders || ['1', '2', '3', '4'];

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
                  ${renderTeamLogoHtml(away.abbr, away.logoUrl, 18, 'gc-logo-bare')}
                  <strong>${esc(away.abbr)}</strong>
                </span>
              </td>
              ${(away.linescores || []).slice(0, qHeaders.length).map(v => `<td class="num-col">${esc(v)}</td>`).join('')}
              <td class="num-col gc-ls-total-col"><strong>${away.score != null ? esc(away.score) : '—'}</strong></td>
            </tr>
            <tr class="${home.isActive ? 'gc-ls-active-row' : ''}">
              <td class="gc-ls-team-col">
                <span class="gc-ls-team-cell">
                  ${renderTeamLogoHtml(home.abbr, home.logoUrl, 18, 'gc-logo-bare')}
                  <strong>${esc(home.abbr)}</strong>
                </span>
              </td>
              ${(home.linescores || []).slice(0, qHeaders.length).map(v => `<td class="num-col">${esc(v)}</td>`).join('')}
              <td class="num-col gc-ls-total-col"><strong>${home.score != null ? esc(home.score) : '—'}</strong></td>
            </tr>
          </tbody>
        </table>
      </div>
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
        ${renderTeamLogoHtml(away.abbr, away.logoUrl, 22, 'gc-logo-bare')}
        <strong>${esc(away.shortName || away.abbr)}</strong>
      </div>
      <span class="gc-ts-mid-label">Single-Game Stats</span>
      <div class="gc-ts-team-tag right ${home.isActive ? 'is-active' : ''}">
        <strong>${esc(home.shortName || home.abbr)}</strong>
        ${renderTeamLogoHtml(home.abbr, home.logoUrl, 22, 'gc-logo-bare')}
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
    rosterPlayers = [],
    userPrefs = null,
    isLoading = false
  } = {}
) {
  // Modern ESPN-inspired vertical order inside Play-by-Play:
  // 1. Hero Current Drive + 3D Field + Prominent Last Play (with top Win %) when Live
  // 2. Compact Quarter-by-Quarter Scoring Table
  // 3. Single-Line Delineated Filter Bar (`All Drives | Scoring | Key Plays` | `All | Q1–Q4`)
  // 4. Collapsible Drive Accordions with bold ESPN play headlines (`10-yd Pass`, `1-yd Run`, `Sack`)
  // 5. Fully Expanded Win Probability Graph (bottom)
  // 6. Game Leaders / Top Players Card (bottom)
  const fieldHtml = model.isLive ? renderAnimatedFootballFieldCard(model, fieldAnimKey) : '';
  const quarterCardHtml = !model.isPre ? renderQuarterScoreboardCard(model) : '';
  const winProbCardHtml = !model.isPre ? renderWinProbabilityCard(model) : '';
  const leadersCardHtml = !model.isPre ? renderGameLeadersCard(model, rosterPlayers) : '';

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

  // Single-line delineated toolbar: [All Drives | Scoring | Key Plays]  |  [All | Q1 | Q2 | Q3 | Q4]
  const controlsHtml = `
    <div class="gc-pbp-toolbar" data-gamecast-pbp-toolbar>
      <div class="gc-pbp-group gc-pbp-modes" role="tablist" aria-label="Play-by-Play Filter">
        ${[
          ['all', 'All Drives', 'Drives'],
          ['scoring', 'Scoring', 'Scoring'],
          ['key', 'Key Plays', 'Key']
        ]
          .map(
            ([k, fullLbl, shortLbl]) => `
          <button type="button" role="tab" aria-selected="${pbpFilter === k ? 'true' : 'false'}"
                  class="gc-tb-pill ${pbpFilter === k ? 'active' : ''}"
                  data-action="set-gamecast-pbp-filter" data-pbp-filter="${k}" title="${esc(fullLbl)}">
            <span class="gc-lbl-full">${esc(fullLbl)}</span>
            <span class="gc-lbl-compact" aria-hidden="true">${esc(shortLbl)}</span>
          </button>
        `
          )
          .join('')}
      </div>

      <span class="gc-pbp-divider" aria-hidden="true"></span>

      <div class="gc-pbp-group gc-pbp-quarters" role="group" aria-label="Quarter Filter">
        ${['ALL', ...quarters]
          .map(
            q => `
          <button type="button"
                  class="gc-tb-pill gc-q-pill mono ${pbpQuarter === q ? 'active' : ''}"
                  data-action="set-gamecast-pbp-quarter" data-pbp-quarter="${esc(q)}">
            ${esc(q === 'ALL' ? 'All' : q)}
          </button>
        `
          )
          .join('')}
      </div>

      ${
        !model.isLive && rawDrives.length > 1
          ? `
            <button type="button" class="gc-tb-order-btn mono"
                    data-action="toggle-gamecast-pbp-order"
                    title="${effectiveOrder === 'newest' ? 'Showing newest first — switch to Q1 → Q4' : 'Showing Q1 → Q4 — switch to newest first'}"
                    aria-label="Reverse drive order">
              ${effectiveOrder === 'newest' ? '↓' : '↑'}
            </button>
          `
          : ''
      }
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
        ${winProbCardHtml}
        ${leadersCardHtml}
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
                    ${renderTeamLogoHtml(d.teamAbbr, d.teamLogoUrl, 24, 'gc-logo-bare')}
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
                      const headlineObj = p.headline
                        ? { headline: p.headline, tone: p.headlineTone || 'neu' }
                        : buildPlayHeadline(p, null, p.yards);
                      const clipKey = `gc_${model.gameId}_${p.id}`;
                      const clipBtnHtml = p.clip?.mp4Url
                        ? `<button type="button" class="gc-clip-btn" data-action="play-gamecast-clip" data-clip-key="${esc(clipKey)}">▶ Clip</button>`
                        : p.clip?.webUrl
                          ? `<a href="${esc(p.clip.webUrl)}" target="_blank" rel="noopener noreferrer" class="gc-clip-btn">▶ Clip</a>`
                          : '';
                      const sitLine = `${p.downDistanceSpot || p.quarterLabel}${p.clock ? ` · ${p.clock}` : ''}`;
                      return `
                        <div class="gc-play-row ${p.isScoring ? 'is-scoring' : ''} ${p.isTurnover ? 'is-turnover' : ''}">
                          <div class="gc-play-head">
                            <div class="gc-play-head-left">
                              <strong class="gc-play-headline tone-${esc(headlineObj.tone)}">${esc(headlineObj.headline)}</strong>
                              <span class="gc-play-down mono">${esc(sitLine)}</span>
                            </div>
                            <span class="gc-play-chips mono">
                              ${p.wpDelta ? `<span class="gc-wp-delta">WP ${esc(p.wpDelta)}</span>` : ''}
                              ${clipBtnHtml}
                            </span>
                          </div>
                          <div class="gc-play-body">
                            <span class="gc-play-text">${escJargon(p.text, { maxTerms: 4, maxPlayers: 4 })}</span>
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

  return `
    <div class="gc-stack">
      ${fieldHtml}
      ${quarterCardHtml}
      ${controlsHtml}
      ${drivesHtml}
      ${winProbCardHtml}
      ${leadersCardHtml}
    </div>
  `;
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

  const awayLeading = hasScore && Number(away.score) > Number(home.score);
  const homeLeading = hasScore && Number(home.score) > Number(away.score);

  // 1. MODERN SLIM SCOREBUG (Unboxed Larger Team Logos + Crisp Timeout Pips Beneath Each Team)
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
          ${renderTeamLogoHtml(away.abbr, away.logoUrl, 44, 'gc-logo-bare gc-sb-logo', { eager: true })}
          <div class="gc-sb-team-meta">
            <div class="gc-sb-name">
              <span>${esc(away.shortName || away.abbr)}</span>
              ${model.isLive && away.hasPossession ? '<span class="gc-poss-dot" title="Possession" aria-label="Has possession">●</span>' : ''}
            </div>
            ${away.record ? `<div class="gc-sb-sub mono">${esc(away.record)}</div>` : ''}
            ${model.isLive ? `<div class="gc-sb-to-row">${renderTimeoutDotsHtml(away.timeoutsRemaining ?? 3)}</div>` : ''}
          </div>
        </div>

        <div class="gc-sb-center">
          <div class="gc-sb-score mono">
            ${
              hasScore
                ? `<span class="${awayLeading ? 'is-lead' : homeLeading ? 'is-trail' : ''}">${away.score}</span><span class="gc-sb-dash">–</span><span class="${homeLeading ? 'is-lead' : awayLeading ? 'is-trail' : ''}">${home.score}</span>`
                : 'vs'
            }
          </div>
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
            ${home.record ? `<div class="gc-sb-sub mono">${esc(home.record)}</div>` : ''}
            ${model.isLive ? `<div class="gc-sb-to-row">${renderTimeoutDotsHtml(home.timeoutsRemaining ?? 3)}</div>` : ''}
          </div>
          ${renderTeamLogoHtml(home.abbr, home.logoUrl, 44, 'gc-logo-bare gc-sb-logo', { eager: true })}
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
      rosterPlayers,
      userPrefs,
      isLoading
    });
  }

  return `<div class="gc-root" data-gamecast-view>${scorebugHtml}${stickyTabsHtml}${bodyHtml}</div>`;
}
