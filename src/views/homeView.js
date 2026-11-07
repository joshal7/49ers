/**
 * Modular, Reorderable Home Dashboard View
 * Renders summary cards for all active Year-Round, In-Season, and Temporal blocks.
 * Supports both touch/click Up/Down reordering and HTML5 drag-and-drop customization.
 */

import {
  esc,
  relTime,
  playProbBadgeClass,
  renderPlayerAvatarHtml,
  renderTeamLogoHtml,
  renderAvatarStackHtml,
  renderMiniMeterHtml
} from './uiHelpers.js';
import { iconSvg, blockIconName } from './icons.js';
import { formatCompactDollars } from '../engine/capSimulator.js';

export function renderHomeDashboardHtml({
  orderedBlocks,
  archivedBlocks,
  appData,
  simCapResult,
  mcSimResult,
  filteredClusters,
  filteredRawItems,
  isCustomizingLayout
}) {
  const customizeBar = `
    <div class="reorder-bar">
      <div class="reorder-bar-status">
        <span class="reorder-status-dot ${isCustomizingLayout ? 'customizing' : ''}" aria-hidden="true"></span>
        <span>
          ${
            isCustomizingLayout
              ? '<strong>Layout Mode Active:</strong> Drag cards or tap arrows to reorder modules.'
              : `Showing <strong>${orderedBlocks.length} active modules</strong>${
                  archivedBlocks.length ? ` <span class="text-muted-inline">(${archivedBlocks.length} off-cycle in Archive)</span>` : ''
                }`
          }
        </span>
      </div>
      <div class="reorder-controls">
        ${
          isCustomizingLayout
            ? `<button type="button" class="btn-ghost" data-action="reset-dashboard-order">${iconSvg('reset', 13)}<span>Default</span></button>`
            : ''
        }
        <button type="button" class="icon-btn ${isCustomizingLayout ? 'active' : ''}" data-action="toggle-customize-layout">
          ${iconSvg(isCustomizingLayout ? 'check' : 'customize', 14)}
          <span>${isCustomizingLayout ? 'Done' : 'Customize Order'}</span>
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
        filteredRawItems,
        isCustomizingLayout
      })
    )
    .join('');

  return `${customizeBar}<div class="dashboard-grid">${cardsHtml}</div>`;
}

function renderSingleDashboardCard({
  block,
  idx,
  total,
  appData,
  simCapResult,
  mcSimResult,
  filteredClusters,
  filteredRawItems,
  isCustomizingLayout
}) {
  const isTemporal = block.phase !== 'YEAR_ROUND' && block.phase !== 'IN_SEASON';
  const reorderControlsHtml = isCustomizingLayout
    ? `
      <div class="reorder-controls" aria-label="Reorder ${esc(block.title)}">
        <button type="button" class="reorder-btn" data-action="move-block-up" data-block-id="${esc(block.id)}" ${
        idx === 0 ? 'disabled' : ''
      } aria-label="Move ${esc(block.shortTitle)} up">${iconSvg('arrowUp', 14)}</button>
        <button type="button" class="reorder-btn" data-action="move-block-down" data-block-id="${esc(block.id)}" ${
        idx === total - 1 ? 'disabled' : ''
      } aria-label="Move ${esc(block.shortTitle)} down">${iconSvg('arrowDown', 14)}</button>
      </div>
    `
    : `<span class="badge ${isTemporal ? 'badge-gold' : 'badge-neutral'}">${esc(block.badgeLabel)}</span>`;

  let bodyHtml = '';
  let deepDiveAttr = '';
  let externalHeaderLink = '';

  const rawList = filteredRawItems || appData?.news?.rawStream || [];

  switch (block.id) {
    case 'news_briefs': {
      const top2 = (filteredClusters || []).slice(0, 2);
      const topTweets = rawList.filter(it => (it.type === 'tweet' || it.type === 'social') && it.url).slice(0, 3);
      const topArticles = rawList
        .filter(it => (it.type === 'article' || it.type === 'post') && it.url)
        .slice(0, 3);

      bodyHtml = `
        <div style="display:flex;flex-direction:column;gap:10px">
          <div>
            <div class="home-wire-heading">
              <span>AI Beat Synthesis</span>
              <span class="mono" style="font-size:10.5px;color:var(--text-muted)">${top2[0]?.publishedAt ? `Synthesized ${esc(relTime(top2[0].publishedAt))}` : ''}</span>
            </div>
            <div style="display:flex;flex-direction:column;gap:8px">
              ${top2
                .map(c => {
                  const hasHeroImg = c.heroImageUrl && /^https:\/\//i.test(c.heroImageUrl);
                  return `
                <div class="subcard-panel">
                  <div style="display:flex;justify-content:space-between;align-items:center;gap:6px;margin-bottom:5px">
                    <span class="badge badge-gold">${esc(c.categoryLabel)}</span>
                    <span class="mono" style="font-size:11px;color:var(--text-muted)">${esc(c.synthesizedFromCount)} reports • ${esc(relTime(c.publishedAt))}</span>
                  </div>
                  <div class="${hasHeroImg ? 'media-split-row' : ''}">
                    <div style="min-width:0">
                      <div style="font-weight:700;font-size:13.5px;line-height:1.35">${esc(c.headline)}</div>
                      <div style="font-size:12px;color:var(--text-secondary);margin-top:4px">${esc(c.hardFacts?.[0] || '')}</div>
                    </div>
                    ${
                      hasHeroImg
                        ? `<div class="raw-item-thumb compact">
                            <img src="${esc(c.heroImageUrl)}" alt="${esc(c.heroImageAlt || c.headline)}" width="64" height="64" loading="lazy" decoding="async" />
                          </div>`
                        : ''
                    }
                  </div>
                  ${
                    c.featuredPlayers?.length || (c.sourceLinks || []).length
                      ? `<div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;margin-top:7px">
                          ${c.featuredPlayers?.length ? renderAvatarStackHtml(c.featuredPlayers, 25, 5) : '<span></span>'}
                          ${
                            (c.sourceLinks || []).length
                              ? `<div class="source-link-strip">
                                  ${c.sourceLinks
                                    .slice(0, 2)
                                    .map(
                                      sl => `
                                    <a href="${esc(sl.url)}" target="_blank" rel="noopener noreferrer" class="source-chip-link">
                                      <span>${esc(sl.outlet || 'Source')}</span>
                                      ${iconSvg('external', 11)}
                                    </a>
                                  `
                                    )
                                    .join('')}
                                </div>`
                              : ''
                          }
                        </div>`
                      : ''
                  }
                </div>
              `;
                })
                .join('')}
            </div>
          </div>

          ${
            topTweets.length
              ? `
            <div>
              <div class="home-wire-heading">
                <span>Top Beat Tweets</span>
                <span class="mono" style="font-size:10.5px;color:var(--emerald)">Live Wire</span>
              </div>
              <div class="home-wire-list">
                ${topTweets
                  .map(
                    tw => `
                  <div class="home-wire-item">
                    <div class="home-wire-meta">
                      <a href="${esc(tw.authorProfileUrl || tw.url)}" target="_blank" rel="noopener noreferrer" class="wire-author-link">
                        <strong>${esc(tw.reporterName || tw.outletName)}</strong>
                        <span class="mono">${esc(tw.authorHandle || '')}</span>
                      </a>
                      <span class="mono" style="font-size:10.5px;color:var(--text-muted)">${esc(relTime(tw.publishedAt))}</span>
                    </div>
                    <a href="${esc(tw.url)}" target="_blank" rel="noopener noreferrer" class="home-wire-text-link">
                      ${esc(tw.title.length > 155 ? tw.title.slice(0, 152) + '…' : tw.title)}
                      <span class="inline-ext-icon">${iconSvg('external', 11)}</span>
                    </a>
                    ${
                      tw.externalUrl
                        ? `<div style="margin-top:3px">
                            <a href="${esc(tw.externalUrl)}" target="_blank" rel="noopener noreferrer" class="source-chip-link">
                              <span>Article: ${esc((tw.externalTitle || tw.outletName || 'Read Story').slice(0, 48))}${(tw.externalTitle || '').length > 48 ? '…' : ''}</span>
                              ${iconSvg('external', 10)}
                            </a>
                          </div>`
                        : ''
                    }
                  </div>
                `
                  )
                  .join('')}
              </div>
            </div>
          `
              : ''
          }

          ${
            topArticles.length
              ? `
            <div>
              <div class="home-wire-heading">
                <span>Top Beat Articles</span>
                <span class="mono" style="font-size:10.5px;color:var(--text-muted)">Direct Links</span>
              </div>
              <div class="home-wire-list">
                ${topArticles
                  .map(art => {
                    const hasArtImg = art.imageUrl && /^https:\/\//i.test(art.imageUrl);
                    return `
                  <a href="${esc(art.url)}" target="_blank" rel="noopener noreferrer" class="home-article-row">
                    ${
                      hasArtImg
                        ? `<span class="raw-item-thumb" style="width:44px;height:44px;border-radius:8px">
                            <img src="${esc(art.imageUrl)}" alt="${esc(art.title)}" width="44" height="44" loading="lazy" decoding="async" />
                          </span>`
                        : ''
                    }
                    <div style="min-width:0;flex:1">
                      <div style="font-weight:700;font-size:12.5px;line-height:1.32;color:var(--text-primary)">${esc(art.title)}</div>
                      <div style="font-size:11px;color:var(--text-muted);margin-top:2px">
                        ${esc(art.outletName || '49ers Beat')} • ${esc(art.reporterName || '')} • ${esc(relTime(art.publishedAt))}
                      </div>
                    </div>
                    <span class="source-open-pill">${iconSvg('external', 12)}</span>
                  </a>
                `;
                  })
                  .join('')}
              </div>
            </div>
          `
              : ''
          }
        </div>
      `;
      deepDiveAttr = `data-action="jump-view" data-target-tab="news"`;
      break;
    }

    case 'upcoming_matchup': {
      const um = appData?.scheduleMatchup?.upcomingMatchup || {};
      const sfIsAway = um.homeAway === 'away';
      const sfRecShort = um.sfRecord?.split(' ')[0] || appData?.meta?.teamRecord || '—';
      const oppHealth = um.opponentHealth || {};
      const oppInj = (oppHealth.injuryReport || []).slice(0, 3);
      externalHeaderLink = um.gameUrl
        ? `<a href="${esc(um.gameUrl)}" target="_blank" rel="noopener noreferrer" class="source-chip-link"><span>ESPN Gamecast</span>${iconSvg('external', 11)}</a>`
        : '';
      const awayTeamCol = sfIsAway
        ? `<div class="sb-team-col">
            ${renderTeamLogoHtml('SF', um.sfLogoUrl, 36)}
            <div class="sb-team-meta">
              <div class="sb-team-abbr">49ers</div>
              <div class="sb-team-rec mono">${esc(sfRecShort)}</div>
            </div>
          </div>`
        : `<div class="sb-team-col">
            ${renderTeamLogoHtml(um.oppAbbr || 'NFL', um.oppLogoUrl, 36)}
            <div class="sb-team-meta">
              <div class="sb-team-abbr">${esc(um.oppName || 'Opponent')}</div>
              <div class="sb-team-rec mono">${esc(um.oppRecord || '—')}</div>
            </div>
          </div>`;
      const homeTeamCol = sfIsAway
        ? `<div class="sb-team-col home">
            <div class="sb-team-meta">
              <div class="sb-team-abbr">${esc(um.oppName || 'Opponent')}</div>
              <div class="sb-team-rec mono">${esc(um.oppRecord || '—')}</div>
            </div>
            ${renderTeamLogoHtml(um.oppAbbr || 'NFL', um.oppLogoUrl, 36)}
          </div>`
        : `<div class="sb-team-col home">
            <div class="sb-team-meta">
              <div class="sb-team-abbr">49ers</div>
              <div class="sb-team-rec mono">${esc(sfRecShort)}</div>
            </div>
            ${renderTeamLogoHtml('SF', um.sfLogoUrl, 36)}
          </div>`;
      bodyHtml = `
        <div class="matchup-scoreboard">
          ${awayTeamCol}
          <span class="sb-vs-pill mono">@</span>
          ${homeTeamCol}
        </div>
        <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:7px">
          <div class="inline-icon-meta">
            ${iconSvg('stadium', 14)}
            <span>${esc(um.kickoffDisplay)} • <strong>${esc(um.betting?.restAdvantage || '')}</strong></span>
          </div>
          <span class="badge badge-positive mono">${esc(um.betting?.spread || 'Pick')} • O/U ${esc(um.betting?.overUnder || '—')}</span>
        </div>
        <div class="subcard-panel" style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;font-size:12.5px;margin-bottom:7px">
          <div style="min-width:0;flex:1">
            <strong>Coaching Matchup:</strong> ${esc(um.coachingMatchup?.headline || '')}
          </div>
          ${um.featuredPlayers?.length ? renderAvatarStackHtml(um.featuredPlayers, 26, 5) : ''}
        </div>
        ${
          oppInj.length
            ? `<div class="subcard-panel" style="font-size:12px">
                <div style="display:flex;justify-content:space-between;align-items:center;gap:6px;margin-bottom:5px">
                  <strong style="color:var(--text-primary)">${esc(um.oppName)} Health &amp; Play Likelihood</strong>
                  <a href="${esc(oppHealth.teamInjuriesUrl || um.injurySourceUrl || 'https://www.espn.com/nfl/injuries')}" target="_blank" rel="noopener noreferrer" class="source-chip-link">
                    <span>Injury Wire</span>${iconSvg('external', 10)}
                  </a>
                </div>
                <div style="display:flex;flex-direction:column;gap:4px">
                  ${oppInj
                    .map(
                      op => `
                    <div style="display:flex;justify-content:space-between;align-items:center;gap:8px">
                      <span style="min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">
                        <strong>${esc(op.name)}</strong> <span style="color:var(--text-muted)">(${esc(op.position)} • ${esc(op.injuryType)})</span>
                      </span>
                      <span class="badge ${playProbBadgeClass(op.playProbabilityPct)} mono">${esc(op.playBadgeLabel)}</span>
                    </div>
                  `
                    )
                    .join('')}
                </div>
              </div>`
            : ''
        }
      `;
      deepDiveAttr = `data-action="jump-season-sub" data-season-sub="matchup"`;
      break;
    }

    case 'team_health': {
      const pr = (appData?.health?.practiceReport || []).slice(0, 4);
      const sfInjUrl = appData?.health?.sourceUrl || 'https://www.49ers.com/team/injury-report/';
      externalHeaderLink = `<a href="${esc(sfInjUrl)}" target="_blank" rel="noopener noreferrer" class="source-chip-link"><span>49ers.com Report</span>${iconSvg('external', 11)}</a>`;
      bodyHtml = `
        <div style="display:flex;flex-direction:column;gap:6px">
          ${pr
            .map(
              p => `
            <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;font-size:12.5px;padding:6px 9px;border-radius:9px;background:var(--bg-card-alt);border:1px solid var(--border-subtle);cursor:pointer" data-action="open-player-sheet" data-player-id="${esc(p.playerId)}">
              <div style="display:flex;align-items:center;gap:8px;min-width:0">
                ${renderPlayerAvatarHtml(p, 28)}
                <span style="min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">
                  <strong>${esc(p.name)}</strong> <span style="color:var(--text-muted)">(${esc(p.position)} • ${esc(p.injuryType)})</span>
                </span>
              </div>
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

    case 'schedule_overview': {
      const sched = appData?.scheduleMatchup?.schedule || [];
      const intl = sched.filter(g => g.venue?.isInternational);
      const upcoming4 = sched.filter(g => !g.completed).slice(0, 4);
      const overallRec = appData?.meta?.teamRecord || '—';
      const divRec = appData?.meta?.divisionRecord ? ` (${appData.meta.divisionRecord} NFC West)` : '';
      const intlNotes = intl
        .map(g => {
          const scoreTxt = g.completed ? `${g.result} ${g.sfScore}-${g.oppScore}` : `${g.homeAway === 'home' ? 'vs' : '@'} ${g.opponent?.abbr || ''}`;
          return `${g.venue?.city || g.venue?.country || 'Intl'} Wk ${g.week} (${scoreTxt})`;
        })
        .join(' & ');
      externalHeaderLink = `<a href="https://www.espn.com/nfl/team/schedule/_/name/sf/san-francisco-49ers" target="_blank" rel="noopener noreferrer" class="source-chip-link"><span>ESPN Schedule</span>${iconSvg('external', 11)}</a>`;
      bodyHtml = `
        ${
          upcoming4.length
            ? `<div style="display:grid;grid-template-columns:repeat(${upcoming4.length},minmax(0,1fr));gap:6px;margin-bottom:7px">
                ${upcoming4
                  .map(
                    g => `
                  <div class="kpi-box" style="display:flex;flex-direction:column;align-items:center;gap:3px;padding:7px 4px;text-align:center">
                    <span class="mono" style="font-size:10px;color:var(--text-muted)">WK ${g.week}</span>
                    ${renderTeamLogoHtml(g.opponent?.abbr || 'NFL', g.oppLogoUrl || g.opponent?.logoUrl, 24)}
                    <span class="mono" style="font-size:11px;font-weight:700">${g.homeAway === 'home' ? 'vs' : '@'} ${esc(g.opponent?.abbr || '')}</span>
                  </div>
                `
                  )
                  .join('')}
              </div>`
            : ''
        }
        <div style="font-size:12.5px;color:var(--text-secondary)">
          <strong>${esc(overallRec)} Overall${esc(divRec)}</strong>${intlNotes ? ` • International Series: ${esc(intlNotes)}.` : ''} ${intl.length} international venues tracked.
        </div>
      `;
      deepDiveAttr = `data-action="jump-season-sub" data-season-sub="schedule"`;
      break;
    }

    case 'trade_deadline': {
      const tw = appData?.seasonal?.tradeWarRoom || {};
      const moves = (tw.completed2026Moves || []).slice(0, 2);
      externalHeaderLink = `<a href="${esc(tw.transactionsUrl || 'https://www.espn.com/nfl/transactions')}" target="_blank" rel="noopener noreferrer" class="source-chip-link"><span>NFL Wire</span>${iconSvg('external', 11)}</a>`;
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
        ${
          moves.length
            ? `<div style="display:flex;flex-direction:column;gap:6px;margin:7px 0">
                ${moves
                  .map(
                    m => `
                  <div class="subcard-panel" style="display:flex;justify-content:space-between;align-items:center;gap:8px;padding:6px 9px;cursor:${m.playerId ? 'pointer' : 'default'}"
                       ${m.playerId ? `data-action="open-player-sheet" data-player-id="${esc(m.playerId)}"` : ''}>
                    <div style="display:flex;align-items:center;gap:8px;min-width:0">
                      ${renderPlayerAvatarHtml({ name: m.player, jersey: m.jersey, headshotUrl: m.headshotUrl }, 30)}
                      <div style="min-width:0">
                        <div style="font-weight:700;font-size:12.5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(m.player)} <span style="color:var(--gold-bright)">(${esc(m.position)})</span></div>
                        <div style="font-size:11px;color:var(--text-muted)">${esc(m.timing || '')} • ${esc(m.costSummary || '')}</div>
                      </div>
                    </div>
                    <div style="display:flex;align-items:center;gap:5px;flex-shrink:0">
                      ${m.acquiredFrom ? renderTeamLogoHtml(m.acquiredFrom, m.acquiredFromLogoUrl, 18) : ''}
                      <span class="badge badge-positive mono">${esc(m.schemeGrade || 'A')}</span>
                    </div>
                  </div>
                `
                  )
                  .join('')}
              </div>`
            : ''
        }
        <div style="font-size:12px;color:var(--text-secondary)">
          <strong>Top Remaining Watch:</strong> ${esc(tw.topNeeds?.[0]?.positionGroup || 'WR Insurance')}
        </div>
      `;
      deepDiveAttr = `data-action="jump-season-sub" data-season-sub="trade"`;
      break;
    }

    case 'playoff_picture': {
      const sf = mcSimResult?.sfOdds || appData?.seasonal?.playoffPicture?.baselineSimulation?.sfOdds || {};
      const berthPct = sf.makePlayoffsPct ?? 99.7;
      const divPct = sf.winDivisionPct ?? 97.7;
      const byePct = sf.seed1ByePct ?? 54.8;
      externalHeaderLink = `<a href="https://www.nfl.com/standings/playoff-picture" target="_blank" rel="noopener noreferrer" class="source-chip-link"><span>NFL Standings</span>${iconSvg('external', 11)}</a>`;
      bodyHtml = `
        <div class="kpi-grid">
          <div class="kpi-box">
            <div class="kpi-label">Playoff Berth</div>
            <div class="kpi-val mono" style="color:var(--emerald)">${berthPct}%</div>
            ${renderMiniMeterHtml(berthPct, 'emerald')}
          </div>
          <div class="kpi-box">
            <div class="kpi-label">Win NFC West</div>
            <div class="kpi-val mono" style="color:var(--gold-bright)">${divPct}%</div>
            ${renderMiniMeterHtml(divPct, 'gold')}
          </div>
          <div class="kpi-box">
            <div class="kpi-label">#1 Seed Bye</div>
            <div class="kpi-val mono">${byePct}%</div>
            ${renderMiniMeterHtml(byePct, 'scarlet')}
          </div>
        </div>
      `;
      deepDiveAttr = `data-action="jump-season-sub" data-season-sub="playoffs"`;
      break;
    }

    case 'draft_prep': {
      const dp = appData?.seasonal?.draftPrep2027 || {};
      externalHeaderLink = `<a href="https://www.nflmockdraftdatabase.com/team-needs-2027/san-francisco-49ers" target="_blank" rel="noopener noreferrer" class="source-chip-link"><span>Mock DB</span>${iconSvg('external', 11)}</a>`;
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
      const pickAvatars = (dc.picks || [])
        .slice(0, 6)
        .map(pk => ({ id: pk.playerId, name: pk.name, position: pk.position, jersey: pk.jersey, headshotUrl: pk.headshotUrl }));
      externalHeaderLink = `<a href="${esc(dc.sourceUrl || 'https://www.pro-football-reference.com/teams/sfo/2026_draft.htm')}" target="_blank" rel="noopener noreferrer" class="source-chip-link"><span>PFR Draft</span>${iconSvg('external', 11)}</a>`;
      bodyHtml = `
        <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap">
          <div style="font-size:12.5px;color:var(--text-secondary);min-width:0;flex:1">
            <strong>${(dc.picks || []).length} Draft Picks + Priority UDFAs:</strong> ${(dc.picks || []).slice(0, 4).map(p => esc(p.name)).join(', ')}…
          </div>
          ${pickAvatars.length ? renderAvatarStackHtml(pickAvatars, 28, 6) : ''}
        </div>
      `;
      deepDiveAttr = `data-action="jump-season-sub" data-season-sub="draft_class"`;
      break;
    }

    case 'team_stats': {
      const topRanks = (appData?.scheduleMatchup?.teamStatRankings || []).slice(0, 3);
      const pwr = appData?.scheduleMatchup?.powerRankings || {};
      externalHeaderLink = `<a href="https://github.com/nflverse/nflverse-data" target="_blank" rel="noopener noreferrer" class="source-chip-link"><span>nflverse</span>${iconSvg('external', 11)}</a>`;
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
              ${renderMiniMeterHtml(((33 - Number(r.rank || 16)) / 32) * 100, r.rank <= 8 ? 'emerald' : 'gold')}
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
      const allP = appData?.roster?.players || [];
      const count = allP.length || 88;
      const activeCnt = allP.filter(p => p.rosterBucket === 'active').length || 53;
      const depthWk = appData?.depthChart?.week || appData?.meta?.currentWeek || '';
      const starAvatars = allP
        .filter(p => p.rosterBucket === 'active' && p.headshotUrl)
        .sort((a, b) => (b.capHit2026 || 0) - (a.capHit2026 || 0))
        .slice(0, 7);
      externalHeaderLink = `<a href="https://www.espn.com/nfl/team/roster/_/name/sf/san-francisco-49ers" target="_blank" rel="noopener noreferrer" class="source-chip-link"><span>ESPN Roster</span>${iconSvg('external', 11)}</a>`;
      bodyHtml = `
        <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:6px">
          ${starAvatars.length ? renderAvatarStackHtml(starAvatars, 30, 7) : ''}
          <span class="mono" style="font-size:11px;color:var(--gold-bright)">Tap headshot for 5-tab Dossier</span>
        </div>
        <div style="font-size:12.5px;color:var(--text-secondary)">
          Explore all <strong>${count} players</strong> (${activeCnt} Active + IR + Practice Squad) sorted by Name or Jersey #, with EPA, NextGen Stats, NFL Combine percentiles, Contracts &amp; ${depthWk ? `Week ${depthWk} ` : ''}Active Depth Chart.
        </div>
      `;
      deepDiveAttr = `data-action="jump-view" data-target-tab="roster"`;
      break;
    }

    case 'salary_cap': {
      const sum = simCapResult?.summary || {};
      const y26 = appData?.cap?.years?.['2026'] || {};
      const ceiling = Math.max(1, Number(y26.capCeiling || 304000000));
      const openSpace = Math.max(0, Number(sum.updatedCapSpace ?? y26.teamCapSpace ?? 0));
      const deadCap = Math.max(0, Number(y26.deadMoneyTotal || 0) + Number(sum.baseYearDeadMoneyAdded || 0));
      const activeUsed = Math.max(0, ceiling - openSpace - deadCap);
      const activePct = Math.min(100, (activeUsed / ceiling) * 100);
      const deadPct = Math.min(100 - activePct, (deadCap / ceiling) * 100);
      const spacePct = Math.max(0, 100 - activePct - deadPct);
      const topCapStars = (appData?.cap?.players || []).filter(p => p.headshotUrl).slice(0, 5);
      const otcTeamUrl = appData?.cap?.sourceUrl || 'https://overthecap.com/salary-cap/san-francisco-49ers';
      externalHeaderLink = `<a href="${esc(otcTeamUrl)}" target="_blank" rel="noopener noreferrer" class="source-chip-link"><span>OverTheCap</span>${iconSvg('external', 11)}</a>`;
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
        <div class="cap-alloc-wrap">
          <div class="cap-alloc-bar" aria-label="2026 Salary Cap Allocation">
            <span class="cap-seg-active" style="width:${activePct.toFixed(1)}%"></span>
            <span class="cap-seg-dead" style="width:${deadPct.toFixed(1)}%"></span>
            <span class="cap-seg-space" style="width:${spacePct.toFixed(1)}%"></span>
          </div>
          <div class="cap-alloc-legend">
            <span><i class="cap-legend-dot" style="background:var(--scarlet-bright)"></i>Active ${activePct.toFixed(0)}%</span>
            <span><i class="cap-legend-dot" style="background:var(--amber)"></i>Dead ${deadPct.toFixed(0)}%</span>
            <span><i class="cap-legend-dot" style="background:var(--emerald)"></i>Open ${spacePct.toFixed(0)}%</span>
          </div>
        </div>
        ${
          topCapStars.length
            ? `<div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap">
                <span style="font-size:11.5px;color:var(--text-muted)">Top 2026 Cap Hits:</span>
                ${renderAvatarStackHtml(topCapStars, 25, 5)}
              </div>`
            : ''
        }
        ${
          simCapResult?.moveCount > 0
            ? `<div class="inline-icon-meta" style="color:var(--gold-bright);margin-top:4px">${iconSvg('bolt', 13)}<span>GM Simulator Active: ${simCapResult.moveCount} contract move(s) applied</span></div>`
            : ''
        }
      `;
      deepDiveAttr = `data-action="jump-roster-sub" data-roster-sub="cap"`;
      break;
    }

    case 'autopodcast_ai': {
      const eps = appData?.podcastIndex?.episodes || [];
      const epCount = eps.length;
      const latestEp = eps[0];
      bodyHtml = `
        <div class="episode-row-head">
          <div class="studio-cover-art" aria-hidden="true">
            ${iconSvg('mic', 17)}
            <span class="studio-wave-bars">
              <span style="height:4px"></span>
              <span style="height:9px"></span>
              <span style="height:6px"></span>
              <span style="height:10px"></span>
              <span style="height:5px"></span>
            </span>
          </div>
          <div style="min-width:0;font-size:12.5px;color:var(--text-secondary)">
            <div style="color:var(--text-primary);font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">
              ${esc(latestEp?.title || `${epCount} Two-Host Audio Briefings Ready`)}
            </div>
            <div><strong>${epCount} Episodes Ready</strong> • Synced transcripts + On-Demand Podcast &amp; Scouting Generator.</div>
          </div>
        </div>
      `;
      deepDiveAttr = `data-action="jump-view" data-target-tab="audio"`;
      break;
    }
  }

  const iconName = blockIconName(block.id);

  return `
    <article class="card ${isTemporal ? 'temporal-highlight' : ''}"
             data-dashboard-block="${esc(block.id)}"
             ${isCustomizingLayout ? 'draggable="true"' : ''}>
      <div class="card-header">
        <div class="card-header-left" style="cursor:pointer" ${deepDiveAttr}>
          <div class="card-icon-badge ${isTemporal ? 'temporal' : ''}" aria-hidden="true">
            ${iconSvg(iconName, 18)}
          </div>
          <div class="card-title-group">
            <div class="card-eyebrow">${esc(block.phase.replace('_', ' '))}</div>
            <h2 class="card-title">${esc(block.title)}</h2>
          </div>
        </div>
        ${reorderControlsHtml}
      </div>
      ${bodyHtml}
      <div class="card-footer-row">
        ${externalHeaderLink || '<span></span>'}
        <button type="button" class="btn-secondary card-cta-btn" ${deepDiveAttr}>
          <span>Open ${esc(block.shortTitle)}</span>
          ${iconSvg('arrowRight', 14)}
        </button>
      </div>
    </article>
  `;
}
