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
  renderSalientThumbHtml,
  renderTweetLinkedArticleCardHtml,
  renderMiniMeterHtml,
  registerRosterPlayersForInlineLinks
} from './uiHelpers.js';
import {
  optimizeImageUrlForSlot,
  resolveSalientCardVisual
} from '../engine/salientMediaEngine.js';
import { iconSvg, blockIconName } from './icons.js';
import { formatCompactDollars } from '../engine/capSimulator.js';
import { resolveConsistentPowerRankings } from '../engine/powerRankingsEngine.js';
import {
  partitionCompletedTradesByWindow,
  resolveCompleteScheduleModel,
  resolveFirstPickMockDatabase
} from '../engine/seasonStateMachine.js';
import {
  SHORT_TWEET_FULL_TEXT_LIMIT,
  isUrgentBreakingBadge,
  sortNewsWithBreakingPriority,
  deduplicateAndGroupWireItems,
  balanceFeedTopSalience,
  stripRedundantAuthorBoilerplate,
  isRedundantProfileSelfLink,
  resolveTweetLinkedArticlePreview,
  formatTweetBodyForDisplay,
  filterOutCompletedGameAvailabilityItems,
  filterFreshVideosForCurrentSlate,
  partitionBreakingNewsAboveBrief
} from '../engine/breakingClassifier.js';
import { computeNewsSalienceScore } from '../engine/antiFluffFilter.js';
import {
  buildMockDraftTeamUrl,
  buildPfrTeamDraftUrl,
  formatWireSourceDisplayName,
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
import { renderDailyTopNewsBriefHtml, renderWireItemCardHtml } from './newsView.js';
import { buildDeterministicDailyTopNewsBrief } from '../services/aiWorkerClient.js';
import {
  getItemReadKey,
  isItemRead,
  computeCatchUpState,
  computePracticeTrajectoryDelta,
  formatRankDeltaCue,
  formatPlayoffOddsDeltaCue
} from '../engine/digestExperienceEngine.js';

export function renderHomeDashboardHtml({
  orderedBlocks,
  optionalBlocks = [],
  appData,
  simCapResult,
  mcSimResult,
  filteredClusters,
  filteredRawItems,
  userPrefs = null,
  activeVideosSet = new Set(),
  isCustomizingLayout,
  sessionLastVisitedAt = null,
  nowMs = Date.now()
}) {
  registerRosterPlayersForInlineLinks(appData?.roster?.players);
  const customizeBar = `
    <div class="reorder-bar">
      <div class="reorder-bar-status">
        <span class="reorder-status-dot ${isCustomizingLayout ? 'customizing' : ''}" aria-hidden="true"></span>
        <span>
          ${
            isCustomizingLayout
              ? '<strong>Layout Mode Active:</strong> Drag cards, tap arrows, or add/hide modules.'
              : `Showing <strong>${orderedBlocks.length} active modules</strong>`
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
        userPrefs,
        activeVideosSet,
        isCustomizingLayout,
        sessionLastVisitedAt,
        nowMs
      })
    )
    .join('');

  const optionalTrayHtml =
    isCustomizingLayout && Array.isArray(optionalBlocks) && optionalBlocks.length > 0
      ? `
        <div class="subcard-panel" data-optional-home-modules style="margin-top:10px;display:flex;flex-direction:column;gap:8px">
          <div class="sub-label" style="margin:0">Add Modules to Home (${optionalBlocks.length})</div>
          <div style="display:flex;flex-wrap:wrap;gap:6px">
            ${optionalBlocks
              .map(
                b => `
                  <button type="button" class="pill-btn" data-action="show-home-block" data-block-id="${esc(b.id)}" aria-label="Add ${esc(b.title)} to Home">
                    ${iconSvg('plus', 12)}
                    <span>${esc(b.shortTitle)}</span>
                  </button>
                `
              )
              .join('')}
          </div>
        </div>
      `
      : '';

  return `${customizeBar}<div class="dashboard-grid">${cardsHtml}</div>${optionalTrayHtml}`;
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
  userPrefs = null,
  activeVideosSet = new Set(),
  isCustomizingLayout,
  sessionLastVisitedAt = null,
  nowMs = Date.now()
}) {
  const reorderControlsHtml = isCustomizingLayout
    ? `
      <div class="reorder-controls" aria-label="Reorder ${esc(block.title)}">
        <button type="button" class="reorder-btn" data-action="move-block-up" data-block-id="${esc(block.id)}" ${
        idx === 0 ? 'disabled' : ''
      } aria-label="Move ${esc(block.shortTitle)} up">${iconSvg('arrowUp', 14)}</button>
        <button type="button" class="reorder-btn" data-action="move-block-down" data-block-id="${esc(block.id)}" ${
        idx === total - 1 ? 'disabled' : ''
      } aria-label="Move ${esc(block.shortTitle)} down">${iconSvg('arrowDown', 14)}</button>
        <button type="button" class="reorder-btn" data-action="hide-home-block" data-block-id="${esc(block.id)}" ${
        total <= 1 ? 'disabled' : ''
      } title="Hide ${esc(block.shortTitle)} from Home" aria-label="Hide ${esc(block.shortTitle)} from Home">${iconSvg('close', 13)}</button>
      </div>
    `
    : `<span class="badge badge-neutral">${esc(block.badgeLabel)}</span>`;

  let bodyHtml = '';
  let deepDiveAttr = '';
  let externalHeaderLink = '';

  switch (block.id) {
    case 'news_briefs': {
      const nowHomeMs = Number.isFinite(nowMs) ? nowMs : Date.now();
      const prioritizedHomeStream = sortNewsWithBreakingPriority(
        filterFreshVideosForCurrentSlate(
          filterOutCompletedGameAvailabilityItems(
            filteredRawItems || appData?.news?.rawStream || [],
            appData,
            nowHomeMs
          ),
          appData,
          nowHomeMs
        ),
        nowHomeMs,
        { appData }
      );
      const groupSimilarOnHome = userPrefs?.groupSimilarStories !== false;
      const rawList = balanceFeedTopSalience(
        deduplicateAndGroupWireItems(prioritizedHomeStream, {
          nowMs: nowHomeMs,
          appData,
          groupSimilarStories: groupSimilarOnHome
        }),
        { nowMs: nowHomeMs, appData }
      );
      const dailyBrief =
        appData?.news?.dailyTopNewsBrief || buildDeterministicDailyTopNewsBrief(appData, nowHomeMs);
      const {
        breakingAboveBrief,
        gameDayLiveMode,
        gameDayPhaseLabel
      } = partitionBreakingNewsAboveBrief(rawList, dailyBrief, nowHomeMs, {
        appData,
        promoteAllGameDayNews: true,
        requireAiPostGameBrief: true
      });
      const promotedIds = new Set(breakingAboveBrief.map(it => it?.id).filter(Boolean));
      const promotedUrls = new Set(breakingAboveBrief.map(it => it?.url).filter(Boolean));

      const rankHomeSalience = (a, b) => {
        const srDiff = Number(b.storyRank || 0) - Number(a.storyRank || 0);
        if (Math.abs(srDiff) >= 0.5) return srDiff;
        const salDiff = computeNewsSalienceScore(b) - computeNewsSalienceScore(a);
        if (Math.abs(salDiff) >= 1.5) return salDiff;
        return new Date(b.publishedAt || 0).getTime() - new Date(a.publishedAt || 0).getTime();
      };
      const topTweets = balanceFeedTopSalience(
        deduplicateAndGroupWireItems(
          prioritizedHomeStream.filter(
            it =>
              (it.type === 'tweet' || it.type === 'social') &&
              sanitizeExternalUrl(it.url, null) &&
              !promotedIds.has(it.id) &&
              !promotedUrls.has(it.url)
          ),
          { nowMs: nowHomeMs, preserveFormat: 'tweets', appData, groupSimilarStories: groupSimilarOnHome }
        ).sort(rankHomeSalience),
        { nowMs: nowHomeMs, appData, maxConsecutiveInjuries: 2 }
      ).slice(0, 3);
      // Anti-redundancy scrub: skip articles already linked inside topTweets on Home
      const tweetLinkedNormUrls = new Set();
      for (const tw of topTweets) {
        if (tw.externalUrl) tweetLinkedNormUrls.add(String(tw.externalUrl).trim().toLowerCase().replace(/\/+$/, ''));
        if (tw.url) tweetLinkedNormUrls.add(String(tw.url).trim().toLowerCase().replace(/\/+$/, ''));
      }
      const allHomeArticles = balanceFeedTopSalience(
        deduplicateAndGroupWireItems(
          prioritizedHomeStream.filter(
            it =>
              (it.type === 'article' || it.type === 'post') &&
              sanitizeExternalUrl(it.url, null) &&
              !isPaywalledPublisher(it.outletName, it.url) &&
              !promotedIds.has(it.id) &&
              !promotedUrls.has(it.url)
          ),
          { nowMs: nowHomeMs, preserveFormat: 'articles', appData, groupSimilarStories: groupSimilarOnHome }
        ).sort(rankHomeSalience),
        { nowMs: nowHomeMs, appData, maxConsecutiveInjuries: 2 }
      );
      const nonDupHomeArticles = allHomeArticles.filter(art => {
        const normU = String(art.url || '').trim().toLowerCase().replace(/\/+$/, '');
        return !normU || !tweetLinkedNormUrls.has(normU);
      });
      const topArticles = (nonDupHomeArticles.length >= 2 ? nonDupHomeArticles : allHomeArticles).slice(0, 3);
      const readKeysSet = new Set(Array.isArray(userPrefs?.readItemKeys) ? userPrefs.readItemKeys : []);
      const homeCatchUp = computeCatchUpState(
        rawList,
        { lastVisitedAt: sessionLastVisitedAt, readKeys: readKeysSet },
        nowHomeMs
      );
      const homeCatchUpBarHtml = homeCatchUp.hasWatermark
        ? `<div class="home-catchup-pill-row">
             <button type="button" class="catchup-home-chip" data-action="jump-view" data-target-tab="news">
               <span class="new-item-dot" aria-hidden="true"></span>
               <span><strong>${homeCatchUp.newCount} new</strong> since ${esc(homeCatchUp.lastVisitedLabel)}</span>
               ${iconSvg('arrowRight', 11)}
             </button>
           </div>`
        : '';

      const rosterPlayers = appData?.roster?.players || [];
      const homeVisibleAboveBrief = gameDayLiveMode ? breakingAboveBrief.slice(0, 6) : breakingAboveBrief;
      const homeGameDayBannerHtml = gameDayLiveMode
        ? `<div class="gameday-above-brief-banner" data-gameday-above-brief-banner>
             <span class="gameday-live-label">
               <span class="gameday-live-dot" aria-hidden="true"></span>
               <span>${esc(gameDayPhaseLabel || 'Game-Day Live Wire')}</span>
             </span>
             <span class="gameday-live-note mono">New updates above brief until postgame summary</span>
           </div>`
        : '';
      const homeMoreGameDayHtml =
        gameDayLiveMode && breakingAboveBrief.length > homeVisibleAboveBrief.length
          ? `<button type="button" class="btn-ghost btn-compact" data-action="jump-view" data-target-tab="news" style="align-self:flex-start">
               <span>View all ${breakingAboveBrief.length} game-day updates</span>
               ${iconSvg('arrowRight', 11)}
             </button>`
          : '';
      const breakingTopHomeHtml =
        homeVisibleAboveBrief.length > 0 || gameDayLiveMode
          ? `<div style="display:flex;flex-direction:column;gap:8px" data-breaking-above-brief${gameDayLiveMode ? ' data-gameday-live-above-brief="true"' : ''}>
              ${homeGameDayBannerHtml}
              ${homeVisibleAboveBrief
                .map((item, idx) =>
                  renderWireItemCardHtml(item, {
                    prioritizedRaw: prioritizedHomeStream,
                    activeVideosSet,
                    rosterPlayers,
                    isLeadFeatured: idx === 0,
                    eagerImage: idx === 0,
                    readKeysSet
                  })
                )
                .join('')}
              ${homeMoreGameDayHtml}
            </div>`
          : '';

      const homeDailyBriefHtml = renderDailyTopNewsBriefHtml(dailyBrief, {
        rawStream: prioritizedHomeStream,
        appData,
        asSubcard: true,
        readKeysSet
      });

      bodyHtml = `
        <div style="display:flex;flex-direction:column;gap:10px">
          ${homeCatchUpBarHtml}
          ${breakingTopHomeHtml}
          ${homeDailyBriefHtml}

          ${
            topTweets.length
              ? `
            <div>
              <div class="home-wire-heading">
                <span>Latest Tweets</span>
                <a href="${esc(buildXBeatListSearchUrl('trusted', { reporters: appData?.reporters?.reporters, userPrefs }))}" target="_blank" rel="noopener noreferrer" class="ext-link mono" style="font-size:10.5px">Live X Beat ${iconSvg('external', 10)}</a>
              </div>
              <div class="home-wire-list">
                ${topTweets
                  .map((tw, idx) => {
                    const rawAuthorName = tw.author || tw.reporterName || tw.outletName || '49ers Beat';
                    const authorName = formatWireSourceDisplayName(rawAuthorName, tw);
                    const resolvedTwUrl = sanitizeExternalUrl(resolveOriginalTweetUrl(tw, rawList), '#');
                    const cleanedTweetBody = stripRedundantAuthorBoilerplate(
                      tw.fullText || tw.title || '',
                      rawAuthorName
                    );
                    const fullShortTweet = formatTweetBodyForDisplay(
                      cleanedTweetBody,
                      SHORT_TWEET_FULL_TEXT_LIMIT
                    ).text;
                    const safeTwExt = sanitizeExternalUrl(tw.externalUrl, null);
                    const twLinkedPreview = resolveTweetLinkedArticlePreview(tw, {
                      rawStream: rawList,
                      resolvedItemUrl: resolvedTwUrl !== '#' ? resolvedTwUrl : ''
                    });
                    const twReadKey = getItemReadKey(tw);
                    const twIsRead = isItemRead(tw, readKeysSet);
                    const twLinkedCardHtml = twLinkedPreview
                      ? renderTweetLinkedArticleCardHtml(twLinkedPreview, {
                          variant: 'compact',
                          markReadKey: twReadKey,
                          eager: idx === 0
                        })
                      : '';
                    const showExtChip =
                      !twLinkedCardHtml &&
                      Boolean(safeTwExt) &&
                      !isRedundantProfileSelfLink(safeTwExt, resolvedTwUrl) &&
                      !isRedundantProfileSelfLink(safeTwExt, tw.url) &&
                      !/\bon X$/i.test(String(tw.externalTitle || ''));
                    const isUrgentTw = isUrgentBreakingBadge(tw.breakingBadge);
                    const twBadgeCls = tw.isInGameInjury
                      ? 'badge-danger'
                      : isUrgentTw
                        ? 'badge-scarlet'
                        : tw.breakingBadge === 'FILM & TRENCH'
                          ? 'badge-positive'
                          : tw.breakingBadge === 'ROSTER MOVE' || tw.breakingBadge === 'TRADE INTEL'
                            ? 'badge-gold'
                            : 'badge-neutral';
                    const twVisual =
                      !twLinkedPreview?.imageUrl
                        ? resolveSalientCardVisual(tw, {
                            rosterPlayers,
                            slot: 'thumb',
                            allowTeamFallback: true
                          })
                        : null;
                    const twThumbHtml = twVisual
                      ? renderSalientThumbHtml(twVisual, {
                          href: resolvedTwUrl !== '#' ? resolvedTwUrl : safeTwExt || '',
                          size: 'md',
                          eager: idx === 0,
                          extraClass: 'home-wire-thumb',
                          markReadKey: twReadKey
                        })
                      : '';
                    return `
                  <div class="home-wire-item ${isUrgentTw ? 'breaking-elevated' : ''} ${twIsRead ? 'is-read-item' : ''}" data-read-key="${esc(twReadKey)}">
                    <div class="home-wire-meta">
                      <div style="display:flex;align-items:center;gap:5px;flex-wrap:wrap;min-width:0">
                        ${
                          tw.breakingBadge
                            ? `<span class="badge ${twBadgeCls}" style="font-size:9.5px;padding:1.5px 6px">${esc(tw.breakingBadge)}</span>`
                            : ''
                        }
                        <a href="${esc(sanitizeExternalUrl(resolveItemAuthorProfileUrl(tw, resolvedTwUrl), resolvedTwUrl))}" target="_blank" rel="noopener noreferrer" class="wire-author-link" data-wire-author-link>
                          <strong>${esc(authorName)}</strong>
                        </a>
                      </div>
                      <span class="mono home-wire-age">${esc(relTime(tw.publishedAt))}</span>
                    </div>
                    <div class="home-wire-main-row ${twThumbHtml ? 'media-split-row' : ''}">
                      <div class="wire-card-body-col">
                        <a href="${esc(resolvedTwUrl)}" target="_blank" rel="noopener noreferrer" class="home-wire-text-link" data-mark-read-key="${esc(twReadKey)}">
                          ${esc(fullShortTweet)}
                          <span class="wire-inline-ext">${iconSvg('external', 11)}</span>
                        </a>
                        ${twLinkedCardHtml}
                        ${
                          showExtChip
                            ? `<div>
                                <a href="${esc(safeTwExt)}" target="_blank" rel="noopener noreferrer" class="source-chip-link" data-mark-read-key="${esc(twReadKey)}">
                                  <span>Article: ${esc((tw.externalTitle || tw.outletName || 'Read Story').slice(0, 48))}${(tw.externalTitle || '').length > 48 ? '…' : ''}</span>
                                  ${iconSvg('external', 10)}
                                </a>
                              </div>`
                            : ''
                        }
                        ${tw.mentionedPlayers?.length ? `<div class="wire-card-players-row">${renderPlayerChipsStripHtml(tw.mentionedPlayers, 3)}</div>` : ''}
                      </div>
                      ${twThumbHtml}
                    </div>
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
                    const artOutletLabel = formatWireSourceDisplayName(art.outletName || '49ers Beat', art);
                    const artReporterLabel = art.reporterName ? formatWireSourceDisplayName(art.reporterName, art) : '';
                    const artByline =
                      artReporterLabel &&
                      artReporterLabel.toLowerCase() !== artOutletLabel.toLowerCase()
                        ? `${artOutletLabel} • ${artReporterLabel}`
                        : artOutletLabel;
                    const artVisual = resolveSalientCardVisual(art, {
                      rosterPlayers,
                      slot: 'thumb',
                      allowTeamFallback: true
                    });
                    const artThumbHtml = artVisual
                      ? renderSalientThumbHtml(artVisual, {
                          size: 'md',
                          asStatic: true,
                          extraClass: 'home-article-thumb'
                        })
                      : '';
                    const artReadKey = getItemReadKey(art);
                    const artIsRead = isItemRead(art, readKeysSet);
                    return `
                  <a href="${esc(safeArtUrl)}" target="_blank" rel="noopener noreferrer" class="home-article-row ${artIsRead ? 'is-read-item' : ''}" data-read-key="${esc(artReadKey)}" data-mark-read-key="${esc(artReadKey)}">
                    <div style="min-width:0;flex:1">
                      <div class="home-article-title">${esc(art.title)} <span class="wire-inline-ext">${iconSvg('external', 10)}</span></div>
                      <div class="home-article-byline">
                        <strong class="home-article-author">${esc(artByline)}</strong>
                        <span class="mono home-article-age">${esc(relTime(art.publishedAt))}</span>
                      </div>
                    </div>
                    ${artThumbHtml}
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
      const oppGameDay = resolveTeamGameDayModel(appData, { is49ers: false });
      const rawOppInj = oppGameDay?.isActive
        ? oppHealth._preGameInjuryReport || oppHealth.injuryReport || []
        : oppHealth.injuryReport || [];
      const oppActivePool = [
        ...(oppHealth.activeRoster || []),
        ...(oppHealth._preGameKeyStartersHealthy || oppHealth.keyStartersHealthy || []),
        ...rawOppInj
      ];
      const resolvedOppInjAll = oppGameDay?.isActive
        ? resolveGameDayInjuryRows(rawOppInj, oppGameDay, { activeRosterPlayers: oppActivePool })
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
      const homeHasScore = um.sfScore != null && um.oppScore != null;
      const homeAwayScore = sfIsAway ? um.sfScore : um.oppScore;
      const homeHomeScore = sfIsAway ? um.oppScore : um.sfScore;
      const homeSbPill =
        um.isGameInProgress && homeHasScore
          ? `LIVE • ${homeAwayScore}–${homeHomeScore}`
          : um.isGameInProgress
            ? 'LIVE'
            : um.completed && homeHasScore
              ? `FINAL • ${homeAwayScore}–${homeHomeScore}`
              : um.completed
                ? 'FINAL'
                : '@';
      const homeKickoffSub = um.isGameInProgress
        ? `${um.statusDetail || 'LIVE'} • ${um.kickoffDisplay || ''}`.replace(/\s*•\s*$/, '')
        : um.completed
          ? `${um.statusDetail || 'Final'}${um.seasonConcluded ? ' • Season Complete' : ''}`
          : um.kickoffDisplay;
      bodyHtml = `
        <div class="matchup-scoreboard">
          ${awayTeamCol}
          <span class="sb-vs-pill mono">${esc(homeSbPill)}</span>
          ${homeTeamCol}
        </div>
        <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:7px">
          <div class="inline-icon-meta">
            ${iconSvg('stadium', 14)}
            <span>${esc(homeKickoffSub)}${!um.completed && um.betting?.restAdvantage ? ` • <strong>${esc(um.betting.restAdvantage)}</strong>` : ''}</span>
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
      const sfGameDay = resolveTeamGameDayModel(appData, { is49ers: true });
      const rawPr = sfGameDay?.isActive
        ? appData?.health?._preGamePracticeReport || appData?.health?.practiceReport || []
        : appData?.health?.practiceReport || [];
      const sfActive53 = (appData?.roster?.players || []).filter(p => !p.rosterBucket || p.rosterBucket === 'active');
      const pr = (
        sfGameDay?.isActive
          ? resolveGameDayInjuryRows(rawPr, sfGameDay, { activeRosterPlayers: sfActive53 })
          : rawPr
      ).slice(0, 4);
      const healthSnapMap = userPrefs?.deltaSnapshots?.healthByPlayer || {};
      const sfInjUrl = appData?.health?.sourceUrl || 'https://www.49ers.com/team/injury-report/';
      externalHeaderLink = `<a href="${esc(sfInjUrl)}" target="_blank" rel="noopener noreferrer" class="source-chip-link"><span>49ers.com Report</span>${iconSvg('external', 11)}</a>`;
      bodyHtml = `
        <div style="display:flex;flex-direction:column;gap:6px">
          ${pr
            .map(p => {
              const delta = computePracticeTrajectoryDelta(p, healthSnapMap[String(p.playerId)] || null);
              const deltaChipHtml = delta
                ? `<span class="delta-chip ${delta.tone} mono" data-health-delta title="${esc(delta.tooltipLabel || delta.displayLabel)}">${esc(delta.displayLabel)}</span>`
                : '';
              return `
            <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;font-size:12.5px;padding:6px 9px;border-radius:9px;background:var(--bg-card-alt);border:1px solid var(--border-subtle);cursor:pointer" data-action="open-player-sheet" data-player-id="${esc(p.playerId)}">
              <div style="display:flex;align-items:center;gap:8px;min-width:0">
                ${renderPlayerAvatarHtml(p, 28)}
                <span style="min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">
                  <strong>${esc(p.name)}</strong> <span style="color:var(--text-muted)">(${esc(p.position)} • ${esc(p.injuryType)})</span>
                </span>
              </div>
              <span style="display:inline-flex;align-items:center;gap:5px;flex-shrink:0">
                ${deltaChipHtml}
                <span class="badge ${playProbBadgeClass(p.playProbabilityPct)} mono">${esc(p.playBadgeLabel)}</span>
              </span>
            </div>
          `;
            })
            .join('')}
        </div>
      `;
      deepDiveAttr = `data-action="jump-season-sub" data-season-sub="health"`;
      break;
    }

    case 'schedule_overview': {
      const schedModel = resolveCompleteScheduleModel(appData, mcSimResult);
      const sched = schedModel.allGames;
      const intl = sched.filter(g => g.venue?.isInternational);
      const upcoming4 = schedModel.upcomingGames.filter(g => !g.isByeWeek).slice(0, 4);
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
                  .map((g, idx) => {
                    const safeGameUrl = idx === 0 ? sanitizeExternalUrl(g.gameUrl, null) : null;
                    const wkLbl = g.seasonType === 'REG' ? `WK ${g.week}` : g.weekLabel || `WK ${g.week}`;
                    const locPref = g.homeAway === 'home' ? 'vs' : g.homeAway === 'away' ? '@' : 'vs/@';
                    const inner = `
                      <span class="mono" style="font-size:10px;color:var(--text-muted)">${esc(wkLbl)}</span>
                      ${renderTeamLogoHtml(g.opponent?.abbr || 'NFL', g.oppLogoUrl || g.opponent?.logoUrl, 24)}
                      <span class="mono" style="font-size:11px;font-weight:700">${locPref} ${esc(g.opponent?.abbr || 'TBD')}</span>
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
      const baseSf = appData?.seasonal?.playoffPicture?.baselineSimulation?.sfOdds || {};
      const refSf =
        Object.keys(userPrefs?.playoffForcedWinners || {}).length > 0
          ? baseSf
          : userPrefs?.deltaSnapshots?.playoffBaseline || {};
      const berthDelta = formatPlayoffOddsDeltaCue(berthPct, refSf.makePlayoffsPct);
      const divDelta = formatPlayoffOddsDeltaCue(divPct, refSf.winDivisionPct);
      const byeDelta = formatPlayoffOddsDeltaCue(byePct, refSf.seed1ByePct);
      externalHeaderLink = `<a href="https://www.nfl.com/standings/playoff-picture" target="_blank" rel="noopener noreferrer" class="source-chip-link"><span>NFL Standings</span>${iconSvg('external', 11)}</a>`;
      bodyHtml = `
        <div class="kpi-grid">
          <div class="kpi-box">
            <div class="kpi-label">Playoff Berth</div>
            <div class="kpi-val mono" style="color:var(--emerald)">${berthPct}%${berthDelta ? ` <span class="delta-chip ${berthDelta.tone}">${esc(berthDelta.text)}</span>` : ''}</div>
            ${renderMiniMeterHtml(berthPct, 'emerald')}
          </div>
          <div class="kpi-box">
            <div class="kpi-label">Win NFC West</div>
            <div class="kpi-val mono" style="color:var(--gold-bright)">${divPct}%${divDelta ? ` <span class="delta-chip ${divDelta.tone}">${esc(divDelta.text)}</span>` : ''}</div>
            ${renderMiniMeterHtml(divPct, 'gold')}
          </div>
          <div class="kpi-box">
            <div class="kpi-label">#1 Seed Bye</div>
            <div class="kpi-val mono">${byePct}%${byeDelta ? ` <span class="delta-chip ${byeDelta.tone}">${esc(byeDelta.text)}</span>` : ''}</div>
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
      const mockDb = resolveFirstPickMockDatabase(dp.firstPickMockDatabase || [], {
        appData,
        now: appData?.meta?.now,
        draftYear: nextDraftYr,
        consensusBigBoard: dp.consensusBigBoard || []
      });
      const topMock = mockDb.players[0] || null;
      externalHeaderLink = `<a href="${esc(dpTeamUrl)}" target="_blank" rel="noopener noreferrer" class="source-chip-link"><span>Mock DB</span>${iconSvg('external', 11)}</a>`;
      bodyHtml = `
        <div style="font-size:12.5px;color:var(--text-secondary)">
          <strong>Top ${nextDraftYr} Horizons:</strong> ${(dp.topNeeds2027 || []).slice(0, 3).map(n => esc(n.pos)).join(' • ')}${
            topMock
              ? `<div style="margin-top:4px;font-size:12px"><strong>1st-Pick Consensus (${esc(mockDb.shortWindowBadge)}):</strong> ${esc(topMock.playerName)} (${esc(topMock.pos)} • ${esc(topMock.school)}) — <span class="mono" style="color:var(--gold-bright)">${topMock.siteCount} ${topMock.siteCount === 1 ? 'site' : 'sites'}</span></div>`
              : ''
          }
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
      const pwr = resolveConsistentPowerRankings(
        appData?.scheduleMatchup?.powerRankings || {},
        appData?.scheduleMatchup?.schedule || [],
        {
          currentWeek: appData?.meta?.currentWeek || null,
          sfRecord: appData?.meta?.teamRecord || null
        }
      );
      const pwrDelta = formatRankDeltaCue(pwr.consensusRank, pwr.previousRank);
      const statSnaps = userPrefs?.deltaSnapshots?.statsByKey || {};
      externalHeaderLink = `<a href="https://github.com/nflverse/nflverse-data" target="_blank" rel="noopener noreferrer" class="source-chip-link"><span>nflverse</span>${iconSvg('external', 11)}</a>`;
      bodyHtml = `
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;font-size:12.5px">
          ${
            pwr.consensusRank != null
              ? `<span><strong>Consensus Power Rank:</strong> #${pwr.consensusRank} NFL${pwrDelta ? ` <span class="delta-chip ${pwrDelta.tone} mono">${esc(pwrDelta.text)}</span>` : ''}</span>
          <span class="badge badge-gold mono">Range ${esc(pwr.rangeShort || `#${pwr.consensusRank}`)}</span>`
              : `<span><strong>Power Rankings:</strong> Updating post-Week ${esc(String(pwr.latestCompletedWeek || ''))}</span>
          <span class="badge badge-gold mono">Syncing</span>`
          }
        </div>
        <div class="kpi-grid">
          ${topRanks
            .map(r => {
              const rDelta = formatRankDeltaCue(r.rank, statSnaps[r.key]?.rank);
              return `
            <div class="kpi-box" ${r.key ? `style="cursor:pointer" role="button" tabindex="0" data-action="open-stat-rank-modal" data-rank-scope="team" data-rank-key="${esc(r.key)}"` : ''}>
              <div class="kpi-label">${escJargon(r.label.replace('Offensive ', ''))}</div>
              <div class="kpi-val mono" style="font-size:13px">#${r.rank}${rDelta ? ` <span class="delta-chip ${rDelta.tone}">${esc(rDelta.text)}</span>` : ''} (${esc(r.displayValue)})</div>
              ${renderMiniMeterHtml(((33 - Number(r.rank || 16)) / 32) * 100, r.rank <= 8 ? 'emerald' : 'gold')}
            </div>
          `;
            })
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
      const beatShows = (appData?.beatPodcasts?.shows || []).filter(s => s?.artworkUrl && /^https:\/\//i.test(s.artworkUrl)).slice(0, 4);
      const beatEpsCount = (appData?.beatPodcasts?.episodes || []).length;
      const latestEp = eps[0];
      const showArtStackHtml = beatShows.length
        ? `<div class="home-pod-art-stack" role="button" tabindex="0" data-action="jump-studio-sub" data-studio-sub="beat_podcasts" aria-label="Open 49ers Beat Podcasts">
            ${beatShows
              .map(s => {
                const opt = optimizeImageUrlForSlot(s.artworkUrl, 'artwork');
                return `<span class="home-pod-art-item" title="${esc(s.name)}">
                  <img src="${esc(opt.src || s.artworkUrl)}" ${opt.fallbackSrc ? `data-fallback-src="${esc(opt.fallbackSrc)}"` : ''} alt="${esc(s.name)}" width="28" height="28" loading="lazy" decoding="async" />
                </span>`;
              })
              .join('')}
          </div>`
        : '';
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
          <div style="min-width:0;flex:1;font-size:12.5px;color:var(--text-secondary)">
            <div style="color:var(--text-primary);font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">
              <span class="inline-player-link" role="button" tabindex="0" style="border-bottom-style:none" data-action="jump-studio-sub" data-studio-sub="podcast">${esc(latestEp?.title || `${epCount} Two-Host Audio Briefings Ready`)}</span>
            </div>
            <div>
              <span class="inline-player-link" role="button" tabindex="0" data-action="jump-studio-sub" data-studio-sub="beat_podcasts">${beatEpsCount} Beat Podcasts (7d)</span> ·
              <span class="inline-player-link" role="button" tabindex="0" data-action="jump-studio-sub" data-studio-sub="podcast">${epCount} Auto Pods</span> ·
              <span class="inline-player-link" role="button" tabindex="0" data-action="jump-studio-sub" data-studio-sub="analysis">AI Analysis</span>
            </div>
          </div>
          ${showArtStackHtml}
        </div>
      `;
      deepDiveAttr = `data-action="jump-view" data-target-tab="audio"`;
      break;
    }
  }

  const iconName = blockIconName(block.id);

  return `
    <article class="card"
             data-dashboard-block="${esc(block.id)}"
             ${isCustomizingLayout ? 'draggable="true"' : ''}>
      <div class="card-header">
        <div class="card-header-left" style="cursor:pointer" ${deepDiveAttr}>
          <div class="card-icon-badge" aria-hidden="true">
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
