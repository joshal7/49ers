/**
 * Modular, Reorderable Home Dashboard View
 * Renders summary cards for all active Year-Round, In-Season, and Temporal blocks.
 * Supports both touch/click Up/Down reordering and HTML5 drag-and-drop customization!
 */

import { esc, playProbBadgeClass, rankBadgeClass } from './uiHelpers.js';
import { formatCompactDollars } from '../engine/capSimulator.js';

export function renderHomeDashboardHtml({
  orderedBlocks,
  archivedBlocks,
  appData,
  simCapResult,
  mcSimResult,
  filteredClusters,
  isCustomizingLayout
}) {
  const customizeBar = `
    <div class="reorder-bar">
      <div style="font-size:12px;color:var(--text-secondary)">
        ${
          isCustomizingLayout
            ? '<strong>Layout Mode Active:</strong> Drag cards or tap ↑ / ↓ to prioritize your top blocks.'
            : `Showing <strong>${orderedBlocks.length} active modules</strong> (${archivedBlocks.length} off-cycle in Vault).`
        }
      </div>
      <div class="reorder-controls">
        ${
          isCustomizingLayout
            ? `<button type="button" class="btn-ghost" data-action="reset-dashboard-order">↺ Default</button>`
            : ''
        }
        <button type="button" class="icon-btn ${isCustomizingLayout ? 'active' : ''}" data-action="toggle-customize-layout">
          ${isCustomizingLayout ? '✓ Done' : '⇅ Customize Order'}
        </button>
      </div>
    </div>
  `;

  const cardsHtml = orderedBlocks
    .map((block, idx) =>
      renderSingleDashboardCard({
        block,
        idx,
        total: orderedBlocks.length,
        appData,
        simCapResult,
        mcSimResult,
        filteredClusters,
        isCustomizingLayout
      })
    )
    .join('');

  return `${customizeBar}${cardsHtml}`;
}

function renderSingleDashboardCard({
  block,
  idx,
  total,
  appData,
  simCapResult,
  mcSimResult,
  filteredClusters,
  isCustomizingLayout
}) {
  const isTemporal = block.phase !== 'YEAR_ROUND' && block.phase !== 'IN_SEASON';
  const reorderControlsHtml = isCustomizingLayout
    ? `
      <div class="reorder-controls" aria-label="Reorder ${esc(block.title)}">
        <button type="button" class="reorder-btn" data-action="move-block-up" data-block-id="${esc(block.id)}" ${
        idx === 0 ? 'disabled' : ''
      } aria-label="Move ${esc(block.shortTitle)} up">↑</button>
        <button type="button" class="reorder-btn" data-action="move-block-down" data-block-id="${esc(block.id)}" ${
        idx === total - 1 ? 'disabled' : ''
      } aria-label="Move ${esc(block.shortTitle)} down">↓</button>
      </div>
    `
    : `<span class="badge ${isTemporal ? 'badge-gold' : 'badge-neutral'}">${esc(block.badgeLabel)}</span>`;

  let bodyHtml = '';
  let deepDiveAttr = '';

  switch (block.id) {
    case 'news_briefs': {
      const top2 = (filteredClusters || []).slice(0, 2);
      bodyHtml = `
        <div style="display:flex;flex-direction:column;gap:8px">
          ${top2
            .map(
              c => `
            <div style="padding:8px 10px;border-radius:9px;background:var(--bg-card-alt);border:1px solid var(--border-subtle)">
              <div style="display:flex;justify-content:space-between;gap:6px;margin-bottom:3px">
                <span class="badge badge-gold">${esc(c.categoryLabel)}</span>
                <span style="font-size:11px;color:var(--emerald)" class="mono">🧹 ${c.filteredClickbaitCount} clickbait cut</span>
              </div>
              <div style="font-weight:700;font-size:13.5px">${esc(c.headline)}</div>
              <div style="font-size:12px;color:var(--text-secondary);margin-top:3px">${esc(c.hardFacts?.[0] || '')}</div>
            </div>
          `
            )
            .join('')}
        </div>
      `;
      deepDiveAttr = `data-action="jump-view" data-target-tab="news"`;
      break;
    }

    case 'trade_deadline': {
      const tw = appData?.seasonal?.tradeWarRoom || {};
      bodyHtml = `
        <div class="kpi-grid kpi-grid-2">
          <div class="kpi-box">
            <div class="kpi-label">NFL Deadline</div>
            <div class="kpi-val" style="font-size:13px">Tue Nov 10 • 1PM PT</div>
          </div>
          <div class="kpi-box">
            <div class="kpi-label">2026 Gross Cap Room</div>
            <div class="kpi-val mono">${formatCompactDollars(tw.availableGrossCap)}</div>
          </div>
        </div>
        <div style="font-size:12.5px;color:var(--text-secondary)">
          <strong>Recent Impact Move:</strong> ${esc(tw.completed2026Moves?.[0]?.player || 'DeForest Buckner')} (${esc(
        tw.completed2026Moves?.[0]?.timing || ''
      )}) • <strong>Top Remaining Watch:</strong> ${esc(tw.topNeeds?.[0]?.positionGroup || 'WR Insurance')}
        </div>
      `;
      deepDiveAttr = `data-action="jump-season-sub" data-season-sub="trade"`;
      break;
    }

    case 'upcoming_matchup': {
      const um = appData?.scheduleMatchup?.upcomingMatchup || {};
      bodyHtml = `
        <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:6px">
          <div style="font-weight:800;font-size:14.5px">${esc(um.oppName)} (${esc(um.oppRecord)}) @ 49ers (${esc(um.sfRecord?.split(' ')[0] || '6-1')})</div>
          <span class="badge badge-positive mono">${esc(um.betting?.spread || 'SF -10.0')} • O/U ${esc(um.betting?.overUnder || '51.5')}</span>
        </div>
        <div style="font-size:12px;color:var(--text-secondary);margin-bottom:6px">
          📍 ${esc(um.kickoffDisplay)} • <strong>${esc(um.betting?.restAdvantage || '')}</strong>
        </div>
        <div style="font-size:12.5px;padding:7px 9px;border-radius:8px;background:var(--bg-card-alt)">
          <strong>Coaching Edge:</strong> ${esc(um.coachingMatchup?.headline || '')}
        </div>
      `;
      deepDiveAttr = `data-action="jump-season-sub" data-season-sub="matchup"`;
      break;
    }

    case 'team_health': {
      const pr = (appData?.health?.practiceReport || []).slice(0, 4);
      bodyHtml = `
        <div style="display:flex;flex-direction:column;gap:6px">
          ${pr
            .map(
              p => `
            <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;font-size:12.5px;padding:5px 8px;border-radius:8px;background:var(--bg-card-alt)">
              <span style="min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">
                <strong>${esc(p.name)}</strong> <span style="color:var(--text-muted)">(${esc(p.position)} • ${esc(p.injuryType)})</span>
              </span>
              <span class="badge ${playProbBadgeClass(p.playProbabilityPct)} mono">${esc(p.playBadgeLabel)}</span>
            </div>
          `
            )
            .join('')}
        </div>
      `;
      deepDiveAttr = `data-action="jump-season-sub" data-season-sub="health"`;
      break;
    }

    case 'playoff_picture': {
      const sf = mcSimResult?.sfOdds || appData?.seasonal?.playoffPicture?.baselineSimulation?.sfOdds || {};
      bodyHtml = `
        <div class="kpi-grid">
          <div class="kpi-box">
            <div class="kpi-label">Playoff Berth</div>
            <div class="kpi-val mono" style="color:var(--emerald)">${sf.makePlayoffsPct ?? 99.7}%</div>
          </div>
          <div class="kpi-box">
            <div class="kpi-label">Win NFC West</div>
            <div class="kpi-val mono" style="color:var(--gold-bright)">${sf.winDivisionPct ?? 97.7}%</div>
          </div>
          <div class="kpi-box">
            <div class="kpi-label">#1 Seed Bye</div>
            <div class="kpi-val mono">${sf.seed1ByePct ?? 54.8}%</div>
          </div>
        </div>
      `;
      deepDiveAttr = `data-action="jump-season-sub" data-season-sub="playoffs"`;
      break;
    }

    case 'draft_prep': {
      const dp = appData?.seasonal?.draftPrep2027 || {};
      bodyHtml = `
        <div style="font-size:12.5px;color:var(--text-secondary)">
          <strong>Top 2027 Horizons:</strong> ${(dp.topNeeds2027 || []).slice(0, 3).map(n => esc(n.pos)).join(' • ')}
        </div>
      `;
      deepDiveAttr = `data-action="jump-season-sub" data-season-sub="draft_prep"`;
      break;
    }

    case 'draft_live_udfa': {
      const dc = appData?.seasonal?.draftClass2026 || {};
      bodyHtml = `
        <div style="font-size:12.5px;color:var(--text-secondary)">
          <strong>${(dc.picks || []).length} Draft Picks + Priority UDFAs:</strong> ${(dc.picks || []).slice(0, 4).map(p => esc(p.name)).join(', ')}…
        </div>
      `;
      deepDiveAttr = `data-action="jump-season-sub" data-season-sub="draft_class"`;
      break;
    }

    case 'team_stats': {
      const topRanks = (appData?.scheduleMatchup?.teamStatRankings || []).slice(0, 3);
      const pwr = appData?.scheduleMatchup?.powerRankings || {};
      bodyHtml = `
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;font-size:12.5px">
          <span><strong>Consensus Power Rank:</strong> #${pwr.consensusRank || 2} NFL</span>
          <span class="badge badge-gold mono">Range ${esc(pwr.rangeDisplay?.split(' ')[0] || '#1–#3')}</span>
        </div>
        <div class="kpi-grid">
          ${topRanks
            .map(
              r => `
            <div class="kpi-box">
              <div class="kpi-label">${esc(r.label.replace('Offensive ', ''))}</div>
              <div class="kpi-val mono" style="font-size:13px">#${r.rank} (${esc(r.displayValue)})</div>
            </div>
          `
            )
            .join('')}
        </div>
      `;
      deepDiveAttr = `data-action="jump-season-sub" data-season-sub="stats"`;
      break;
    }

    case 'roster_depth': {
      const count = appData?.roster?.players?.length || 88;
      bodyHtml = `
        <div style="font-size:12.5px;color:var(--text-secondary)">
          Explore all <strong>${count} players</strong> (53 Active + IR + PS) with EPA, NextGen Stats, MockDraftable 0–100th Spider Charts, Contracts &amp; 1-tap Week 9 Active Depth Chart.
        </div>
      `;
      deepDiveAttr = `data-action="jump-view" data-target-tab="roster"`;
      break;
    }

    case 'salary_cap': {
      const sum = simCapResult?.summary || {};
      bodyHtml = `
        <div class="kpi-grid">
          <div class="kpi-box">
            <div class="kpi-label">2026 Cap Space</div>
            <div class="kpi-val mono" style="color:var(--emerald)">${formatCompactDollars(sum.updatedCapSpace)}</div>
          </div>
          <div class="kpi-box">
            <div class="kpi-label">Effective Space</div>
            <div class="kpi-val mono">${formatCompactDollars(sum.effectiveCapSpace)}</div>
          </div>
          <div class="kpi-box">
            <div class="kpi-label">2027 Projected</div>
            <div class="kpi-val mono">${formatCompactDollars(sum.updatedNextYearCapSpace)}</div>
          </div>
        </div>
        ${
          simCapResult?.moveCount > 0
            ? `<div style="font-size:11.5px;color:var(--gold-bright)">⚡ Armchair GM Active: ${simCapResult.moveCount} custom contract move(s) applied</div>`
            : ''
        }
      `;
      deepDiveAttr = `data-action="jump-roster-sub" data-roster-sub="cap"`;
      break;
    }

    case 'schedule_overview': {
      const intl = (appData?.scheduleMatchup?.schedule || []).filter(g => g.venue?.isInternational);
      bodyHtml = `
        <div style="font-size:12.5px;color:var(--text-secondary)">
          <strong>6-1 Overall (3-0 NFC West)</strong> • International Series: Melbourne Wk 1 (W 27-7 vs LAR) &amp; Mexico City Wk 11 (vs MIN, 7,200 ft altitude). ${intl.length} international venues tracked.
        </div>
      `;
      deepDiveAttr = `data-action="jump-season-sub" data-season-sub="schedule"`;
      break;
    }

    case 'autopodcast_ai': {
      const epCount =
        (appData?.podcastIndex?.episodes?.length || 0);
      bodyHtml = `
        <div style="font-size:12.5px;color:var(--text-secondary)">
          <strong>${epCount} Studio Two-Host Neural Episodes Ready</strong> + On-Demand Custom Autopodcast &amp; Deep Analysis Runner shared across the friend group.
        </div>
      `;
      deepDiveAttr = `data-action="jump-view" data-target-tab="audio"`;
      break;
    }
  }

  return `
    <article class="card ${isTemporal ? 'temporal-highlight' : ''}"
             data-dashboard-block="${esc(block.id)}"
             ${isCustomizingLayout ? 'draggable="true"' : ''}>
      <div class="card-header">
        <div class="card-title-group">
          <div class="card-eyebrow">${esc(block.phase.replace('_', ' '))}</div>
          <h2 class="card-title">${esc(block.title)}</h2>
        </div>
        ${reorderControlsHtml}
      </div>
      ${bodyHtml}
      <div style="margin-top:10px;display:flex;justify-content:flex-end">
        <button type="button" class="btn-secondary" ${deepDiveAttr}>Open ${esc(block.shortTitle)} →</button>
      </div>
    </article>
  `;
}
