/**
 * Modular, Reorderable Home Dashboard View
 * Renders summary cards for all active Year-Round, In-Season, and Temporal blocks.
 * Supports both touch/click Up/Down reordering and HTML5 drag-and-drop customization.
 */

import {
  esc,
  escJargon,
  jargonTerm,
  relTime,
  playProbBadgeClass,
  buildEspnNflTeamUrl,
  renderPlayerAvatarHtml,
  renderTeamLogoHtml,
  renderAvatarStackHtml,
  renderPlayerChipsStripHtml,
  renderMiniMeterHtml,
  registerRosterPlayersForInlineLinks
} from './uiHelpers.js';
import { iconSvg, blockIconName } from './icons.js';
import { formatCompactDollars } from '../engine/capSimulator.js';
import { partitionCompletedTradesByWindow } from '../engine/seasonStateMachine.js';
import {
  SHORT_TWEET_FULL_TEXT_LIMIT,
  sortNewsWithBreakingPriority,
  deduplicateAndGroupWireItems,
  balanceFeedTopSalience,
  stripRedundantAuthorBoilerplate,
  isRedundantProfileSelfLink,
  formatTweetBodyForDisplay,
  filterOutCompletedGameAvailabilityItems,
  filterAndCleanSynthesisClusters
} from '../engine/breakingClassifier.js';
import { computeNewsSalienceScore } from '../engine/antiFluffFilter.js';
import {
  buildMockDraftTeamUrl,
  buildPfrTeamDraftUrl,
  isPaywalledPublisher,
  sanitizeExternalUrl
} from '../engine/linkIntegrity.js';
import {
  evaluateGameDayWindow,
  resolveGameDayInjuryRows,
  resolveTeamGameDayModel
} from '../engine/gameDayRosterEngine.js';
import { computeTeamHealthSummary } from '../engine/injuryProbabilityModel.js';
import {
  buildXBeatListSearchUrl,
  resolveItemAuthorProfileUrl,
  resolveOriginalTweetUrl
} from '../engine/beatAttributionEngine.js';
import { resolveClusterSafeReports } from './newsView.js';

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
  registerRosterPlayersForInlineLinks(appData?.roster?.players);
  const customizeBar = `
    <div class="reorder-bar">
      <div class="reorder-bar-status">
        <span class="reorder-status-dot ${isCustomizingLayout ? 'customizing' : ''}" aria-hidden="true"></span>
        <span>
          ${
            isCustomizingLayout
              ? '<strong>Layout Mode Active:</strong> Drag cards or tap arrows to reorder modules.'
              : `Showing <strong>${orderedBlocks.length} active modules</strong>${
                  archivedBlocks.length ? ` <span class="text-muted-inline" style="white-space:nowrap">(${archivedBlocks.length} in Archive)</span>` : ''
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

  const rawList = deduplicateAndGroupWireItems(
    sortNewsWithBreakingPriority(
      filterOutCompletedGameAvailabilityItems(
        filteredRawItems || appData?.news?.rawStream || [],
        appData
      ),
      Date.now(),
      { appData }
    )
  );

  switch (block.id) {
    case 'news_briefs': {
      const top2 = filterAndCleanSynthesisClusters(filteredClusters || [], appData).slice(0, 2);
      const rankHomeSalience = (a, b) => {
        const bpDiff = Number(b.breakingPriority || 0) - Number(a.breakingPriority || 0);
        if (bpDiff !== 0) return bpDiff;
        const salDiff = computeNewsSalienceScore(b) - computeNewsSalienceScore(a);
        if (Math.abs(salDiff) >= 1.5) return salDiff;
        return new Date(b.publishedAt || 0).getTime() - new Date(a.publishedAt || 0).getTime();
      };
      const topTweets = balanceFeedTopSalience(
        rawList
          .filter(it => (it.type === 'tweet' || it.type === 'social') && sanitizeExternalUrl(it.url, null))
          .sort(rankHomeSalience),
        { appData, maxConsecutiveInjuries: 2 }
      ).slice(0, 3);
      const topArticles = balanceFeedTopSalience(
        rawList
          .filter(
            it =>
              (it.type === 'article' || it.type === 'post') &&
              sanitizeExternalUrl(it.url, null) &&
              !isPaywalledPublisher(it.outletName, it.url)
          )
          .sort(rankHomeSalience),
        { appData, maxConsecutiveInjuries: 2 }
      ).slice(0, 3);

      bodyHtml = `
        <div style="display:flex;flex-direction:column;gap:10px">
          <div>
            <div class="home-wire-heading">
              <span>Synthesis Briefs</span>
              <span class="mono" style="font-size:10.5px;color:var(--text-muted)">${top2[0]?.publishedAt ? esc(relTime(top2[0].publishedAt)) : ''}</span>
            </div>
            <div style="display:flex;flex-direction:column;gap:8px">
              ${top2
                .map(c => {
                  const hasHeroImg = c.heroImageUrl && /^https:\/\//i.test(c.heroImageUrl);
                  const safeReports = resolveClusterSafeReports(c, rawList, appData);
                  const reportCount = safeReports.length || Number(c.synthesizedFromCount) || 0;
                  return `
                <div class="subcard-panel">
                  <div style="display:flex;justify-content:space-between;align-items:center;gap:6px;margin-bottom:5px">
                    <span class="badge badge-gold">${esc(c.categoryLabel)}</span>
                    <span class="mono" style="font-size:11px;color:var(--text-muted)">
                      <button type="button" class="synthesis-reports-link mono" data-action="open-synthesis-sources" data-cluster-id="${esc(c.id)}">${reportCount} report${reportCount === 1 ? '' : 's'}</button> • ${esc(relTime(c.publishedAt))}
                    </span>
                  </div>
                  <div class="${hasHeroImg ? 'media-split-row' : ''}">
                    <div style="min-width:0">
                      <div style="font-weight:700;font-size:13.5px;line-height:1.35">
                        <span class="inline-player-link" role="button" tabindex="0" style="border-bottom-style:none" data-action="open-news-cluster" data-cluster-id="${esc(c.id)}">${esc(c.headline)}</span>
                      </div>
                      <div style="font-size:12px;color:var(--text-secondary);margin-top:4px">${escJargon(c.hardFacts?.[0] || '')}</div>
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
                    c.featuredPlayers?.length || safeReports.length
                      ? `<div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;margin-top:7px">
                          ${c.featuredPlayers?.length ? renderAvatarStackHtml(c.featuredPlayers, 25, 5) : '<span></span>'}
                          ${
                            safeReports.length
                              ? `<div class="source-link-strip">
                                  ${safeReports
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
                <span>Latest Tweets</span>
                <a href="${esc(buildXBeatListSearchUrl('injuries'))}" target="_blank" rel="noopener noreferrer" class="ext-link mono" style="font-size:10.5px">Live X Beat ${iconSvg('external', 10)}</a>
              </div>
              <div class="home-wire-list">
                ${topTweets
                  .map(tw => {
                    const authorName = tw.author || tw.reporterName || tw.outletName || '49ers Beat';
                    const resolvedTwUrl = sanitizeExternalUrl(resolveOriginalTweetUrl(tw, rawList), '#');
                    const cleanedTweetBody = stripRedundantAuthorBoilerplate(
                      tw.fullText || tw.title || '',
                      authorName
                    );
                    const fullShortTweet = formatTweetBodyForDisplay(
                      cleanedTweetBody,
                      SHORT_TWEET_FULL_TEXT_LIMIT
                    ).text;
                    const safeTwExt = sanitizeExternalUrl(tw.externalUrl, null);
                    const showExtChip =
                      Boolean(safeTwExt) &&
                      !isRedundantProfileSelfLink(safeTwExt, resolvedTwUrl) &&
                      !isRedundantProfileSelfLink(safeTwExt, tw.url) &&
                      !/\bon X$/i.test(String(tw.externalTitle || ''));
                    return `
                  <div class="home-wire-item ${tw.breakingPriority > 0 ? 'breaking-elevated' : ''}">
                    <div class="home-wire-meta">
                      <div style="display:flex;align-items:center;gap:5px;flex-wrap:wrap;min-width:0">
                        ${
                          tw.breakingBadge
                            ? `<span class="badge ${tw.isInGameInjury ? 'badge-danger' : 'badge-scarlet'}" style="font-size:9.5px;padding:1.5px 6px">${esc(tw.breakingBadge)}</span>`
                            : ''
                        }
                        <a href="${esc(sanitizeExternalUrl(resolveItemAuthorProfileUrl(tw, resolvedTwUrl), resolvedTwUrl))}" target="_blank" rel="noopener noreferrer" class="wire-author-link">
                          <strong>${esc(authorName)}</strong>
                        </a>
                      </div>
                      <span class="mono" style="font-size:10.5px;color:var(--text-muted)">${esc(relTime(tw.publishedAt))}</span>
                    </div>
                    <a href="${esc(resolvedTwUrl)}" target="_blank" rel="noopener noreferrer" class="home-wire-text-link">
                      ${esc(fullShortTweet)}
                      <span class="inline-ext-icon">${iconSvg('external', 11)}</span>
                    </a>
                    ${
                      showExtChip
                        ? `<div style="margin-top:3px">
                            <a href="${esc(safeTwExt)}" target="_blank" rel="noopener noreferrer" class="source-chip-link">
                              <span>Article: ${esc((tw.externalTitle || tw.outletName || 'Read Story').slice(0, 48))}${(tw.externalTitle || '').length > 48 ? '…' : ''}</span>
                              ${iconSvg('external', 10)}
                            </a>
                          </div>`
                        : ''
                    }
                    ${tw.mentionedPlayers?.length ? `<div style="margin-top:4px">${renderPlayerChipsStripHtml(tw.mentionedPlayers, 3)}</div>` : ''}
                  </div>
                `;
                  })
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
                <span>Latest Articles</span>
              </div>
              <div class="home-wire-list">
                ${topArticles
                  .map(art => {
                    const safeArtUrl = sanitizeExternalUrl(art.url, '#');
                    const hasArtImg = art.imageUrl && /^https:\/\//i.test(art.imageUrl);
                    return `
                  <a href="${esc(safeArtUrl)}" target="_blank" rel="noopener noreferrer" class="home-article-row">
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
      const rawOppInj = oppHealth.injuryReport || [];
      const oppGameDay = resolveTeamGameDayModel(appData, { is49ers: false });
      const resolvedOppInjAll = oppGameDay?.isActive
        ? resolveGameDayInjuryRows(rawOppInj, oppGameDay)
        : rawOppInj;
      const oppInj = resolvedOppInjAll.slice(0, 3);
      const homeOppSummary = computeTeamHealthSummary({
        injuryReport: resolvedOppInjAll,
        irReserve: oppHealth.irReserve || [],
        totalStarters: oppHealth.summary?.totalStarters || 22
      });
      externalHeaderLink = um.gameUrl
        ? `<a href="${esc(um.gameUrl)}" target="_blank" rel="noopener noreferrer" class="source-chip-link"><span>ESPN Gamecast</span>${iconSvg('external', 11)}</a>`
        : '';
      const awayTeamCol = sfIsAway
        ? `<a href="${esc(buildEspnNflTeamUrl('SF'))}" target="_blank" rel="noopener noreferrer" class="sb-team-col" style="text-decoration:none;color:inherit">
            ${renderTeamLogoHtml('SF', um.sfLogoUrl, 36)}
            <div class="sb-team-meta">
              <div class="sb-team-abbr">49ers</div>
              <div class="sb-team-rec mono">${esc(sfRecShort)}</div>
            </div>
          </a>`
        : `<a href="${esc(buildEspnNflTeamUrl(um.oppAbbr || 'NFL'))}" target="_blank" rel="noopener noreferrer" class="sb-team-col" style="text-decoration:none;color:inherit">
            ${renderTeamLogoHtml(um.oppAbbr || 'NFL', um.oppLogoUrl, 36)}
            <div class="sb-team-meta">
              <div class="sb-team-abbr">${esc(um.oppName || 'Opponent')}</div>
              <div class="sb-team-rec mono">${esc(um.oppRecord || '—')}</div>
            </div>
          </a>`;
      const homeTeamCol = sfIsAway
        ? `<a href="${esc(buildEspnNflTeamUrl(um.oppAbbr || 'NFL'))}" target="_blank" rel="noopener noreferrer" class="sb-team-col home" style="text-decoration:none;color:inherit">
            <div class="sb-team-meta">
              <div class="sb-team-abbr">${esc(um.oppName || 'Opponent')}</div>
              <div class="sb-team-rec mono">${esc(um.oppRecord || '—')}</div>
            </div>
            ${renderTeamLogoHtml(um.oppAbbr || 'NFL', um.oppLogoUrl, 36)}
          </a>`
        : `<a href="${esc(buildEspnNflTeamUrl('SF'))}" target="_blank" rel="noopener noreferrer" class="sb-team-col home" style="text-decoration:none;color:inherit">
            <div class="sb-team-meta">
              <div class="sb-team-abbr">49ers</div>
              <div class="sb-team-rec mono">${esc(sfRecShort)}</div>
            </div>
            ${renderTeamLogoHtml('SF', um.sfLogoUrl, 36)}
          </a>`;
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
        <div class="subcard-panel" style="font-size:12.5px;margin-bottom:7px">
          <strong>Coaching Matchup:</strong> ${escJargon(um.coachingMatchup?.headline || '')}
        </div>
        <div class="subcard-panel" style="font-size:12px">
          <div style="display:flex;justify-content:space-between;align-items:center;gap:6px;margin-bottom:${oppInj.length ? '5px' : '0'}">
            <strong style="color:var(--text-primary)">${esc(um.oppName)} Health <span class="mono" style="color:var(--gold-bright);font-size:11px">(${homeOppSummary.overallAvailabilityScore}/100 Avail.)</span></strong>
            <a href="${esc(oppHealth.teamInjuriesUrl || um.injurySourceUrl || 'https://www.espn.com/nfl/injuries')}" target="_blank" rel="noopener noreferrer" class="source-chip-link">
              <span>Injury Wire</span>${iconSvg('external', 10)}
            </a>
          </div>
          ${
            oppInj.length
              ? `<div style="display:flex;flex-direction:column;gap:4px">
                  ${oppInj
                    .map(
                      op => `
                    <div style="display:flex;justify-content:space-between;align-items:center;gap:8px">
                      <span style="min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">
                        ${
                          op.espnUrl
                            ? `<a href="${esc(op.espnUrl)}" target="_blank" rel="noopener noreferrer" class="ext-link"><strong>${esc(op.name)}</strong></a>`
                            : `<strong>${esc(op.name)}</strong>`
                        } <span style="color:var(--text-muted)">(${esc(op.position)} • ${esc(op.injuryType)})</span>
                      </span>
                      <span class="badge ${playProbBadgeClass(op.playProbabilityPct)} mono">${esc(op.playBadgeLabel)}</span>
                    </div>
                  `
                    )
                    .join('')}
                </div>`
              : `<div style="font-size:11.5px;color:var(--text-muted);margin-top:3px">Active starters cleared (${homeOppSummary.activeStartersHealthy}/${homeOppSummary.totalStarters}) • ${homeOppSummary.irCount} on IR</div>`
          }
        </div>
      `;
      deepDiveAttr = `data-action="jump-season-sub" data-season-sub="matchup"`;
      break;
    }

    case 'team_health': {
      const rawPr = appData?.health?.practiceReport || [];
      const sfGameDay = resolveTeamGameDayModel(appData, { is49ers: true });
      const pr = (
        sfGameDay?.isActive
          ? resolveGameDayInjuryRows(rawPr, sfGameDay)
          : rawPr
      ).slice(0, 4);
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
      const intlNotesHtml = intl
        .map(g => {
          const scoreTxt = g.completed ? `${g.result} ${g.sfScore}-${g.oppScore}` : `${g.homeAway === 'home' ? 'vs' : '@'} ${g.opponent?.abbr || ''}`;
          const label = `${g.venue?.city || g.venue?.country || 'Intl'} Wk ${g.week} (${scoreTxt})`;
          const safeGameUrl = sanitizeExternalUrl(g.gameUrl, null);
          return safeGameUrl
            ? `<a href="${esc(safeGameUrl)}" target="_blank" rel="noopener noreferrer" class="ext-link">${esc(label)}</a>`
            : esc(label);
        })
        .join(' &amp; ');
      externalHeaderLink = `<a href="https://www.espn.com/nfl/team/schedule/_/name/sf/san-francisco-49ers" target="_blank" rel="noopener noreferrer" class="source-chip-link"><span>ESPN Schedule</span>${iconSvg('external', 11)}</a>`;
      bodyHtml = `
        ${
          upcoming4.length
            ? `<div style="display:grid;grid-template-columns:repeat(${upcoming4.length},minmax(0,1fr));gap:6px;margin-bottom:7px">
                ${upcoming4
                  .map(g => {
                    const safeGameUrl = sanitizeExternalUrl(g.gameUrl, null);
                    const inner = `
                      <span class="mono" style="font-size:10px;color:var(--text-muted)">WK ${g.week}</span>
                      ${renderTeamLogoHtml(g.opponent?.abbr || 'NFL', g.oppLogoUrl || g.opponent?.logoUrl, 24)}
                      <span class="mono" style="font-size:11px;font-weight:700">${g.homeAway === 'home' ? 'vs' : '@'} ${esc(g.opponent?.abbr || '')}</span>
                    `;
                    return safeGameUrl
                      ? `<a href="${esc(safeGameUrl)}" target="_blank" rel="noopener noreferrer" class="kpi-box" style="display:flex;flex-direction:column;align-items:center;gap:3px;padding:7px 4px;text-align:center;text-decoration:none;color:inherit">${inner}</a>`
                      : `<div class="kpi-box" style="display:flex;flex-direction:column;align-items:center;gap:3px;padding:7px 4px;text-align:center">${inner}</div>`;
                  })
                  .join('')}
              </div>`
            : ''
        }
        <div style="font-size:12.5px;color:var(--text-secondary)">
          <strong>${esc(overallRec)} Overall${esc(divRec)}</strong>${intlNotesHtml ? ` • International Series: ${intlNotesHtml}` : ''}
        </div>
      `;
      deepDiveAttr = `data-action="jump-season-sub" data-season-sub="schedule"`;
      break;
    }

    case 'trade_deadline': {
      const tw = appData?.seasonal?.tradeWarRoom || {};
      const curSeasonYr = Number(appData?.meta?.seasonYear) || 2026;
      const nextSeasonYr = curSeasonYr + 1;
      const nextShortYr = `'${String(nextSeasonYr).slice(-2)}`;
      const deadlineLabel = tw.deadlineShortDisplay || (curSeasonYr === 2026 ? 'Tue Nov 10 • 1PM PT' : 'Tue Post-Wk 9 • 1PM PT');
      const { recentTrades } = partitionCompletedTradesByWindow(
        tw.completed2026Moves || [],
        appData?.meta?.updatedAt || Date.now(),
        30
      );
      const moves = recentTrades.slice(0, 2);
      externalHeaderLink = `<a href="${esc(tw.transactionsUrl || 'https://www.espn.com/nfl/transactions')}" target="_blank" rel="noopener noreferrer" class="source-chip-link"><span>NFL Wire</span>${iconSvg('external', 11)}</a>`;
      bodyHtml = `
        <div class="kpi-grid kpi-grid-2">
          <div class="kpi-box">
            <div class="kpi-label">NFL Deadline</div>
            <div class="kpi-val" style="font-size:13px">${esc(deadlineLabel)}</div>
          </div>
          <div class="kpi-box">
            <div class="kpi-label">${curSeasonYr} Cap / ${nextSeasonYr} Horizon</div>
            <div class="kpi-val mono" style="font-size:12.5px">${formatCompactDollars(tw.availableGrossCap)}${tw.projected2027CapSpace != null ? ` <span style="color:var(--crimson)">(${formatCompactDollars(tw.projected2027CapSpace, true)} ${nextShortYr})</span>` : ''}</div>
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
          <strong>Top Remaining Watch:</strong> ${esc(tw.topNeeds?.[0]?.positionGroup || 'WR / 12-Personnel TE & Left Guard')}
        </div>
      `;
      deepDiveAttr = `data-action="jump-season-sub" data-season-sub="trade"`;
      break;
    }

    case 'playoff_picture': {
      const sf = mcSimResult?.sfOdds || appData?.seasonal?.playoffPicture?.baselineSimulation?.sfOdds || {};
      const berthPct = sf.makePlayoffsPct ?? 93.0;
      const divPct = sf.winDivisionPct ?? 82.6;
      const byePct = sf.seed1ByePct ?? 34.5;
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
      const nextDraftYr = Number(dp.draftYear) || (Number(appData?.meta?.seasonYear) || 2026) + 1;
      const dpTeamUrl = sanitizeExternalUrl(dp.sources?.[0]?.url, null) || buildMockDraftTeamUrl(nextDraftYr);
      externalHeaderLink = `<a href="${esc(dpTeamUrl)}" target="_blank" rel="noopener noreferrer" class="source-chip-link"><span>Mock DB</span>${iconSvg('external', 11)}</a>`;
      bodyHtml = `
        <div style="font-size:12.5px;color:var(--text-secondary)">
          <strong>Top ${nextDraftYr} Horizons:</strong> ${(dp.topNeeds2027 || []).slice(0, 3).map(n => esc(n.pos)).join(' • ')}
        </div>
      `;
      deepDiveAttr = `data-action="jump-season-sub" data-season-sub="draft_prep"`;
      break;
    }

    case 'draft_live_udfa': {
      const dc = appData?.seasonal?.draftClass2026 || {};
      const curDraftYr = Number(dc.draftYear) || Number(appData?.meta?.seasonYear) || 2026;
      const dcUrl = sanitizeExternalUrl(dc.sourceUrl, null) || buildPfrTeamDraftUrl('SF', curDraftYr);
      const pickAvatars = (dc.picks || [])
        .slice(0, 6)
        .map(pk => ({ id: pk.playerId, name: pk.name, position: pk.position, jersey: pk.jersey, headshotUrl: pk.headshotUrl }));
      externalHeaderLink = `<a href="${esc(dcUrl)}" target="_blank" rel="noopener noreferrer" class="source-chip-link"><span>PFR Draft</span>${iconSvg('external', 11)}</a>`;
      bodyHtml = `
        <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap">
          <div style="font-size:12.5px;color:var(--text-secondary);min-width:0;flex:1">
            <strong>${(dc.picks || []).length} Draft Picks + Priority ${jargonTerm('UDFAs', 'udfa')}:</strong> ${(dc.picks || [])
        .slice(0, 4)
        .map(p =>
          p.playerId
            ? `<span class="inline-player-link" role="button" tabindex="0" data-action="open-player-sheet" data-player-id="${esc(p.playerId)}">${esc(p.name)}</span>`
            : esc(p.name)
        )
        .join(', ')}…
          </div>
          ${pickAvatars.length ? renderAvatarStackHtml(pickAvatars, 28, 6) : ''}
        </div>
      `;
      deepDiveAttr = `data-action="jump-season-sub" data-season-sub="draft_class"`;
      break;
    }

    case 'team_stats': {
      const tsUnits = appData?.scheduleMatchup?.teamStats?.units || [];
      const flatByKey = appData?.scheduleMatchup?.teamStats?.flatByKey || {};
      const offU = tsUnits.find(u => u.id === 'offense');
      const defU = tsUnits.find(u => u.id === 'defense');
      const toDiff = flatByKey.margin_turnover_diff;
      const topRanks =
        offU && defU && toDiff
          ? [
              { key: offU.overall.key, label: 'Offense Overall', rank: offU.overall.rank, displayValue: flatByKey.off_pts_game?.displayValue ? `${flatByKey.off_pts_game.displayValue} PPG` : offU.overall.displayValue },
              { key: defU.overall.key, label: 'Defense Overall', rank: defU.overall.rank, displayValue: flatByKey.def_pts_allowed_game?.displayValue ? `${flatByKey.def_pts_allowed_game.displayValue} PA/G` : defU.overall.displayValue },
              { key: toDiff.key, label: 'Turnover Diff', rank: toDiff.rank, displayValue: toDiff.displayValue }
            ]
          : (appData?.scheduleMatchup?.teamStatRankings || []).slice(0, 3);
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
            <div class="kpi-box" ${r.key ? `style="cursor:pointer" role="button" tabindex="0" data-action="open-stat-rank-modal" data-rank-scope="team" data-rank-key="${esc(r.key)}"` : ''}>
              <div class="kpi-label">${escJargon(r.label.replace('Offensive ', ''))}</div>
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
        </div>
        <div style="font-size:12.5px;color:var(--text-secondary)">
          <strong>${count} Players</strong> (${activeCnt} Active · IR · Practice Squad) — ${jargonTerm('EPA', 'epa')}, NextGen, ${jargonTerm('RAS', 'ras')}, Contracts &amp; ${depthWk ? `Wk ${depthWk} ` : ''}Depth Chart.
        </div>
      `;
      deepDiveAttr = `data-action="jump-view" data-target-tab="roster"`;
      break;
    }

    case 'salary_cap': {
      const sum = simCapResult?.summary || {};
      const baseYr = String(simCapResult?.baseYear || appData?.meta?.seasonYear || '2026');
      const nextYr = String(Number(baseYr) + 1);
      const yCur = appData?.cap?.years?.[baseYr] || appData?.cap?.years?.['2026'] || {};
      const ceiling = Math.max(1, Number(yCur.capCeiling || 304000000));
      const openSpace = Math.max(0, Number(sum.updatedCapSpace ?? yCur.teamCapSpace ?? 0));
      const deadCap = Math.max(0, Number(yCur.deadMoneyTotal || 0) + Number(sum.baseYearDeadMoneyAdded || 0));
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
            <div class="kpi-label">${esc(baseYr)} Gross Space</div>
            <div class="kpi-val mono" style="color:${(sum.updatedCapSpace ?? yCur.teamCapSpace ?? 0) >= 0 ? 'var(--emerald)' : 'var(--crimson)'}">${formatCompactDollars(sum.updatedCapSpace ?? yCur.teamCapSpace)}</div>
          </div>
          <div class="kpi-box">
            <div class="kpi-label">${esc(baseYr)} ${jargonTerm('Dead Cap', 'dead_cap')}</div>
            <div class="kpi-val mono" style="color:var(--amber)">${formatCompactDollars(deadCap)}</div>
          </div>
          <div class="kpi-box">
            <div class="kpi-label">${esc(nextYr)} Projected</div>
            <div class="kpi-val mono" style="color:${(sum.updatedNextYearCapSpace ?? 0) >= 0 ? 'var(--emerald)' : 'var(--crimson)'}">${formatCompactDollars(sum.updatedNextYearCapSpace)}</div>
          </div>
        </div>
        <div class="cap-alloc-wrap">
          <div class="cap-alloc-bar" aria-label="${esc(baseYr)} Salary Cap Allocation">
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
      const beatEpsCount = (appData?.beatPodcasts?.episodes || []).length;
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
              <span class="inline-player-link" role="button" tabindex="0" style="border-bottom-style:none" data-action="jump-studio-sub" data-studio-sub="podcast">${esc(latestEp?.title || `${epCount} Two-Host Audio Briefings Ready`)}</span>
            </div>
            <div>
              <span class="inline-player-link" role="button" tabindex="0" data-action="jump-studio-sub" data-studio-sub="beat_podcasts">${beatEpsCount} Beat Podcasts (7d)</span> ·
              <span class="inline-player-link" role="button" tabindex="0" data-action="jump-studio-sub" data-studio-sub="podcast">${epCount} Auto Pods</span> ·
              <span class="inline-player-link" role="button" tabindex="0" data-action="jump-studio-sub" data-studio-sub="analysis">AI Analysis</span>
            </div>
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
