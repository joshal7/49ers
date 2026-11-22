/**
 * 5-Tab Player Dossier Slide-Up Bottom Sheet Renderer
 * Tabs:
 * 1. overview  — Bio, Draft Info, Snap %, Efficiency Callout & Player News
 * 2. health    — Weekly Practice Progression, Health News (Tweets, Videos & Articles), Priors & IR Log
 * 3. stats     — 2026 Season vs Career Year-by-Year Standard + EPA + NextGen Stats + PFR Adv
 * 4. spider    — MockDraftable 0–100th Positional Percentile SVG Radar Chart + Comps
 * 5. contract  — Multi-Year OverTheCap Breakdown + Pre/Post-June 1 Cut/Trade/Restructure Calculator
 */

import { esc, escJargon, jargonTerm, formatRelativeAge, playProbBadgeClass, rankBadgeClass, renderExpandableSummaryHtml, renderPlayerAvatarHtml, renderSalientThumbHtml, renderTweetLinkedArticleCardHtml, renderMiniMeterHtml } from './uiHelpers.js';
import { resolveSalientCardVisual } from '../engine/salientMediaEngine.js';
import { iconSvg } from './icons.js';
import { renderVideoEmbedOrFacade } from './newsView.js';
import { renderSpiderChartHtml } from '../components/spiderChart.js';
import { formatDollars, formatOtcDollars, formatCompactDollars, formatCapActionLabel } from '../engine/capSimulator.js';
import { resolveCareerTableSchema } from '../engine/statsLeaderboardEngine.js';
import {
  SHORT_TWEET_FULL_TEXT_LIMIT,
  isUrgentBreakingBadge,
  stripRedundantAuthorBoilerplate,
  isRedundantProfileSelfLink,
  resolveTweetLinkedArticlePreview,
  formatTweetBodyForDisplay
} from '../engine/breakingClassifier.js';
import {
  formatWireSourceDisplayName,
  isIndividualOtcPlayerUrl,
  sanitizeExternalUrl
} from '../engine/linkIntegrity.js';
import {
  buildXPlayerScoopSearchUrl,
  resolveItemAuthorProfileUrl,
  resolveOriginalTweetUrl
} from '../engine/beatAttributionEngine.js';
import {
  NEWS_SORT_MODES,
  normalizeNewsSortMode,
  getItemReadKey,
  isItemRead
} from '../engine/digestExperienceEngine.js';
import {
  isPlayerEligibleForInjuryNews,
  rankPlayerInjuryNews,
  rankPlayerOverviewMentions
} from '../engine/injuryProbabilityModel.js';

export function renderInjuryNewsItemCardHtml(
  n = {},
  {
    playerName = '',
    directPosts = [],
    excludePlayerId = '',
    rosterPlayers = [],
    outerClassName = 'injury-news-item-card',
    activeVideosSet = new Set(),
    readKeysSet = null,
    teamContext = null
  } = {}
) {
  const isVideo = n.type === 'video';
  const isTweet = !isVideo && (n.type === 'tweet' || n.type === 'social');
  const itemReadKey = getItemReadKey(n);
  const itemAlreadyRead = isItemRead(n, readKeysSet);
  const safeStreamCandidate =
    n.videoStreamUrl && /^https:\/\//i.test(String(n.videoStreamUrl).trim())
      ? String(n.videoStreamUrl).trim()
      : '';
  const defaultBeatFallback = teamContext?.isRemoteTeam
    ? `${teamContext.nickname || teamContext.abbr || 'NFL'} Beat`
    : '49ers Beat';
  const rawAuthorName = n.author || n.reporterName || n.outletName || defaultBeatFallback;
  const authorName = formatWireSourceDisplayName(rawAuthorName, n);
  const resolvedMentionUrl = isTweet
    ? sanitizeExternalUrl(
        resolveOriginalTweetUrl(
          playerName ? { ...n, primaryPlayer: { name: playerName } } : n,
          directPosts
        ),
        '#'
      )
    : sanitizeExternalUrl(n.url, '#');
  const externalVideoCardUrl =
    !n.videoId &&
    !safeStreamCandidate &&
    (isVideo || Boolean(n.isHighlightClip && n.externalVideoUrl)) &&
    (n.externalVideoUrl || resolvedMentionUrl)
      ? sanitizeExternalUrl(n.externalVideoUrl || resolvedMentionUrl, null)
      : '';
  const effectiveStreamOrCardUrl = safeStreamCandidate || externalVideoCardUrl;
  const effectiveEmbeddable = safeStreamCandidate || n.videoId ? n.embeddable !== false : false;
  const hasPlayableVideo = Boolean(n.videoId || effectiveStreamOrCardUrl);
  const vidKey = hasPlayableVideo ? `dossier_vid_${n.id || ''}` : null;
  const isVidOpen = Boolean(vidKey && activeVideosSet instanceof Set && activeVideosSet.has(vidKey));
  const mentionLinkedPreview =
    isTweet && !hasPlayableVideo
      ? resolveTweetLinkedArticlePreview(n, {
          rawStream: directPosts,
          resolvedItemUrl: resolvedMentionUrl !== '#' ? resolvedMentionUrl : ''
        })
      : null;
  const mentionLinkedCardHtml = mentionLinkedPreview
    ? renderTweetLinkedArticleCardHtml(mentionLinkedPreview, {
        variant: mentionLinkedPreview.imageUrl ? 'card' : 'compact',
        markReadKey: itemReadKey
      })
    : '';
  const salientVisual =
    !isVideo && !hasPlayableVideo && !mentionLinkedPreview?.imageUrl
      ? resolveSalientCardVisual(n, {
          rosterPlayers,
          excludePlayerId,
          slot: 'thumb',
          allowTeamFallback: false
        })
      : null;
  const thumbHtml = salientVisual
    ? renderSalientThumbHtml(salientVisual, {
        href: resolvedMentionUrl !== '#' ? resolvedMentionUrl : '',
        size: 'md',
        extraClass: 'dossier-mention-thumb',
        markReadKey: itemReadKey
      })
    : '';
  const hasImg = Boolean(thumbHtml);
  const authorHref = sanitizeExternalUrl(
    n.authorProfileUrl || resolveItemAuthorProfileUrl(n, resolvedMentionUrl),
    resolvedMentionUrl
  );
  const ageStr = n.publishedAt ? formatRelativeAge(n.publishedAt) : '';
  const ageWithDuration = hasPlayableVideo && n.duration ? `${n.duration} • ${ageStr}` : ageStr;

  const tweetFormatted = isTweet
    ? formatTweetBodyForDisplay(
        stripRedundantAuthorBoilerplate(n.fullText || n.headline || n.title || '', rawAuthorName),
        SHORT_TWEET_FULL_TEXT_LIMIT
      )
    : null;

  const tweetLinkContext =
    isTweet &&
    n.externalDescription &&
    n.externalDescription.length >= 20 &&
    !String(tweetFormatted?.text || '')
      .toLowerCase()
      .includes(String(n.externalDescription).toLowerCase().slice(0, 28)) &&
    String(n.externalDescription).trim().toLowerCase() !== String(n.externalTitle || '').trim().toLowerCase()
      ? stripRedundantAuthorBoilerplate(n.externalDescription, rawAuthorName)
      : '';

  const cleanSummary =
    !isTweet &&
    !isVideo &&
    n.summary &&
    !n.summary.startsWith('Published via ') &&
    n.summary.toLowerCase() !== `${rawAuthorName} • ${n.outletName || ''}`.toLowerCase()
      ? stripRedundantAuthorBoilerplate(n.summary, rawAuthorName)
      : '';

  const isUrgentCard = isUrgentBreakingBadge(n.breakingBadge);
  const cardBadgeCls = n.isInGameInjury
    ? 'badge-danger live-breaking-pill'
    : isUrgentCard
      ? 'badge-scarlet live-breaking-pill'
      : n.breakingBadge === 'ROSTER MOVE' || n.breakingBadge === 'TRADE INTEL'
        ? 'badge-gold'
        : 'badge-neutral';
  const breakingPill = n.breakingBadge
    ? `<span class="badge ${cardBadgeCls}">${isUrgentCard ? iconSvg('bolt', 11) : ''}<span>${esc(n.breakingBadge)}</span></span>`
    : '';

  const safeMentionExt = sanitizeExternalUrl(n.externalUrl, null);
  const normCmpUrl = u => String(u || '').replace(/\/+$/, '').toLowerCase();
  const effectiveMentionExtUrl = mentionLinkedPreview?.url || safeMentionExt || '';
  const showMentionExt =
    !mentionLinkedCardHtml &&
    Boolean(safeMentionExt) &&
    normCmpUrl(safeMentionExt) !== normCmpUrl(resolvedMentionUrl) &&
    !isRedundantProfileSelfLink(safeMentionExt, resolvedMentionUrl) &&
    !isRedundantProfileSelfLink(safeMentionExt, n.url) &&
    !/\bon X$/i.test(String(n.externalTitle || ''));

  const confirmingList = (Array.isArray(n.confirmingReports) ? n.confirmingReports : []).filter(cr => {
    const crIsTw = cr?.type === 'tweet' || cr?.type === 'social';
    const crHref = crIsTw
      ? sanitizeExternalUrl(resolveOriginalTweetUrl(cr, directPosts), '')
      : sanitizeExternalUrl(cr?.url, '');
    if ((mentionLinkedCardHtml || showMentionExt) && effectiveMentionExtUrl && crHref && normCmpUrl(crHref) === normCmpUrl(effectiveMentionExtUrl)) return false;
    if (resolvedMentionUrl && crHref && normCmpUrl(crHref) === normCmpUrl(resolvedMentionUrl)) return false;
    return true;
  });
  const headlineText = n.headline || n.title || '';

  const nonTweetBadgeLabel =
    n.wireSource === 'espn_player_wire' || String(n.id || '').startsWith('espn_pwire_')
      ? 'Injury Wire'
      : 'Article';
  const formatTypeBadgeHtml =
    isVideo || hasPlayableVideo
      ? `<span class="badge badge-scarlet">${iconSvg('video', 11)}<span>Video</span></span>`
      : !isTweet
        ? `<span class="badge badge-neutral">${iconSvg('news', 11)}<span>${esc(nonTweetBadgeLabel)}</span></span>`
        : '';

  const similarStoriesDrawerHtml =
    confirmingList.length > 0
      ? `<details class="compact-details confirming-reports-toggle similar-stories-drawer" data-confirming-reports data-similar-stories="true" data-cluster-kind="${n.clusterKind === 'corroboration' ? 'corroboration' : 'similar'}" style="margin-top:6px">
           <summary class="compact-details-summary">
             <span>Similar stories (${confirmingList.length})</span>
           </summary>
           <div style="display:flex;flex-direction:column;gap:5px;margin-top:6px">
             ${confirmingList
               .slice(0, 5)
               .map(cr => {
                 const crAuthor = cr.author || cr.reporterName || cr.outletName || 'Beat';
                 const crOutlet = cr.outletName || '';
                 const crAttrib =
                   crAuthor && crOutlet && crAuthor.toLowerCase() !== crOutlet.toLowerCase()
                     ? `${crAuthor} • ${crOutlet}`
                     : crAuthor || crOutlet || 'Beat';
                 const crIsTw = cr.type === 'tweet' || cr.type === 'social';
                 const crBody = crIsTw
                   ? formatTweetBodyForDisplay(
                       stripRedundantAuthorBoilerplate(cr.fullText || cr.title || cr.headline || '', crAuthor)
                     ).text
                   : stripRedundantAuthorBoilerplate(cr.title || cr.headline || cr.fullText || '', crAuthor);
                 const crHref = crIsTw
                   ? sanitizeExternalUrl(resolveOriginalTweetUrl(cr, directPosts), '#')
                   : sanitizeExternalUrl(cr.url, '#');
                 const crReadKey = getItemReadKey(cr);
                 const crIsRead = isItemRead(cr, readKeysSet);
                 const crLinkedPreview = crIsTw
                   ? resolveTweetLinkedArticlePreview(cr, {
                       rawStream: directPosts,
                       resolvedItemUrl: crHref !== '#' ? crHref : ''
                     })
                   : null;
                 const crLinkedCardHtml = crLinkedPreview
                   ? renderTweetLinkedArticleCardHtml(crLinkedPreview, {
                       variant: 'compact',
                       markReadKey: crReadKey
                     })
                   : '';
                 if (crLinkedCardHtml) {
                   return `<div class="synthesis-source-sheet-row similar-story-row has-linked-article-card ${crIsRead ? 'is-read-item' : ''}" data-similar-story-row data-read-key="${esc(crReadKey)}" style="padding:7px 9px">
                     <div class="source-row-meta" style="margin-bottom:2px">
                       <div style="display:flex;align-items:center;gap:5px;min-width:0">
                         <span class="badge badge-gold" style="font-size:9.3px;padding:1px 5px">Tweet</span>
                         <strong class="source-row-author">${esc(crAttrib)}</strong>
                       </div>
                       <span class="mono source-row-age">${cr.publishedAt ? esc(formatRelativeAge(cr.publishedAt)) : ''}</span>
                     </div>
                     <a href="${esc(crHref)}" target="_blank" rel="noopener noreferrer" class="source-row-headline is-tweet-body similar-story-tweet-link" data-mark-read-key="${esc(crReadKey)}">${esc(crBody.slice(0, 140))}${crBody.length > 140 ? '…' : ''} <span class="wire-inline-ext">${iconSvg('externalLink', 10)}</span></a>
                     ${crLinkedCardHtml}
                   </div>`;
                 }
                 return `<a href="${esc(crHref)}" target="_blank" rel="noopener noreferrer" class="synthesis-source-sheet-row similar-story-row ${crIsRead ? 'is-read-item' : ''}" data-similar-story-row data-read-key="${esc(crReadKey)}" data-mark-read-key="${esc(crReadKey)}" style="padding:7px 9px">
                   <div class="source-row-meta" style="margin-bottom:2px">
                     <div style="display:flex;align-items:center;gap:5px;min-width:0">
                       <span class="badge ${crIsTw ? 'badge-gold' : 'badge-neutral'}" style="font-size:9.3px;padding:1px 5px">${crIsTw ? 'Tweet' : 'Article'}</span>
                       <strong class="source-row-author">${esc(crAttrib)}</strong>
                     </div>
                     <span class="mono source-row-age">${cr.publishedAt ? esc(formatRelativeAge(cr.publishedAt)) : ''}</span>
                   </div>
                   <div class="source-row-headline ${crIsTw ? 'is-tweet-body' : ''}">${esc(crBody.slice(0, 140))}${crBody.length > 140 ? '…' : ''} <span class="wire-inline-ext">${iconSvg('externalLink', 10)}</span></div>
                 </a>`;
               })
               .join('')}
           </div>
         </details>`
      : '';

  return `
    <div class="player-mention-card ${esc(outerClassName)} ${isUrgentCard ? 'breaking-elevated' : ''} ${itemAlreadyRead ? 'is-read-item' : ''}" data-mention-type="${isVideo ? 'video' : isTweet ? 'tweet' : 'article'}" data-read-key="${esc(itemReadKey)}">
      <div class="player-mention-meta">
        <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;min-width:0">
          ${breakingPill}
          ${formatTypeBadgeHtml}
          <span class="player-mention-author">
            ${
              authorHref
                ? `<a href="${esc(authorHref)}" target="_blank" rel="noopener noreferrer" class="wire-author-single-link"><strong>${esc(authorName)}</strong></a>`
                : `<strong class="wire-author-label">${esc(authorName)}</strong>`
            }
          </span>
        </div>
        ${ageWithDuration ? `<span class="mono wire-card-age" data-wire-age>${esc(ageWithDuration)}</span>` : ''}
      </div>

      <div class="player-mention-main-row ${hasImg ? 'media-split-row' : ''}" style="margin-top:5px">
        <div class="wire-card-body-col">
          ${
            isTweet
              ? `<a href="${esc(resolvedMentionUrl)}" target="_blank" rel="noopener noreferrer" class="player-mention-tweet-body" data-mark-read-key="${esc(itemReadKey)}">${esc(tweetFormatted.text)} <span class="wire-inline-ext">${iconSvg('externalLink', 11)}</span></a>
                 ${!mentionLinkedCardHtml && tweetLinkContext ? `<div class="wire-card-summary" style="margin-top:2px">${escJargon(tweetLinkContext, { excludePlayerId })}</div>` : ''}
                 ${mentionLinkedCardHtml}
                 ${
                   showMentionExt
                     ? `<div style="margin-top:5px">
                          <a href="${esc(safeMentionExt)}" target="_blank" rel="noopener noreferrer" class="source-chip-link" data-mark-read-key="${esc(itemReadKey)}">
                            <span>Article: ${esc((n.externalTitle || headlineText || n.outletName || 'Read Story').slice(0, 56))}</span>
                            ${iconSvg('externalLink', 10)}
                          </a>
                        </div>`
                     : ''
                 }`
              : `<div class="player-mention-headline"><a href="${esc(resolvedMentionUrl)}" target="_blank" rel="noopener noreferrer" class="ext-link wire-headline-link" data-mark-read-key="${esc(itemReadKey)}">${esc(headlineText)} <span class="wire-inline-ext">${iconSvg('externalLink', 11)}</span></a></div>
                 ${cleanSummary ? renderExpandableSummaryHtml(cleanSummary, { className: 'wire-card-summary player-mention-summary', jargonOptions: { excludePlayerId } }) : ''}`
          }
          ${!hasPlayableVideo ? similarStoriesDrawerHtml : ''}
        </div>
        ${thumbHtml}
      </div>
      ${
        hasPlayableVideo
          ? `<div style="margin-top:6px">
              ${renderVideoEmbedOrFacade(
                vidKey,
                n.videoId || '',
                0,
                headlineText || `Watch Clip (${n.duration || 'Video'})`,
                n.outletName || authorName,
                isVidOpen,
                effectiveEmbeddable,
                {
                  compactFooter: true,
                  videoStreamUrl: effectiveStreamOrCardUrl || '',
                  posterUrl: n.imageUrl || '',
                  externalWatchUrl:
                    sanitizeExternalUrl(n.externalVideoUrl, null) ||
                    (resolvedMentionUrl !== '#' ? resolvedMentionUrl : '') ||
                    ''
                }
              )}
            </div>
            ${similarStoriesDrawerHtml}`
          : ''
      }
    </div>
  `;
}

export function renderPlayerDossierSheetHtml({
  player,
  activeTab = 'overview',
  statsMode = '2026', // '2026' | 'career'
  txScenario = 'cut',
  mentionsSortMode = 'top', // 'top' | 'latest'
  rawStream = [],
  appData = null,
  userPrefs = null,
  reportersById = null,
  activeVideosSet = new Set(),
  teamContext = null,
  remoteStatus = null
}) {
  if (!player) return `<div class="empty-state">Player not found.</div>`;

  const tabDefs = [
    ['overview', 'football', 'Overview'],
    ['health', 'heartPulse', 'Health'],
    ['stats', 'season', 'Stats'],
    ['spider', 'radar', 'Spider Chart'],
    ['contract', 'cap', 'Contract']
  ];

  const tabsBar = `
    <div class="pill-bar" role="tablist" aria-label="Player Dossier Sections">
      ${tabDefs
        .map(
          ([key, ic, label]) => `
        <button type="button" role="tab" aria-selected="${activeTab === key}"
                class="pill-btn ${activeTab === key ? 'active' : ''}"
                data-action="set-player-tab" data-player-tab="${key}">
          ${iconSvg(ic, 13)}
          <span>${esc(label)}</span>
        </button>
      `
        )
        .join('')}
    </div>
  `;

  const remoteStatusBannerHtml = renderRemoteDossierStatusBannerHtml(teamContext, remoteStatus);

  let contentHtml = '';

  if (activeTab === 'overview') {
    contentHtml = renderOverviewTab(
      player,
      rawStream,
      appData,
      userPrefs,
      reportersById,
      activeVideosSet,
      mentionsSortMode,
      teamContext
    );
  } else if (activeTab === 'stats') {
    contentHtml = renderStatsTab(player, statsMode);
  } else if (activeTab === 'spider') {
    contentHtml = renderSpiderChartHtml(player.spiderProfile, player.name);
  } else if (activeTab === 'contract') {
    contentHtml = renderContractTab(player, txScenario, teamContext);
  } else if (activeTab === 'health') {
    contentHtml = renderHealthTab(player, rawStream, appData, userPrefs, reportersById, activeVideosSet, teamContext);
  }

  return `${tabsBar}${remoteStatusBannerHtml}${contentHtml}`;
}

function renderRemoteDossierStatusBannerHtml(teamContext, remoteStatus) {
  if (!teamContext?.isRemoteTeam || !remoteStatus) return '';
  const domain = teamContext.domain || `${teamContext.slug}.joshal.com`;
  if (remoteStatus.state === 'loading') {
    return `
      <div class="remote-dossier-status-bar is-loading" data-remote-dossier-status="loading" role="status" aria-live="polite">
        <span class="remote-dossier-status-text">${iconSvg('loader', 12, 'wire-sync-spin')}<span>Loading full ${esc(teamContext.nickname || teamContext.abbr)} dossier from <strong>${esc(domain)}</strong>…</span></span>
      </div>
    `;
  }
  if (remoteStatus.state === 'fallback') {
    return `
      <div class="remote-dossier-status-bar is-fallback" data-remote-dossier-status="fallback" role="status">
        <span class="remote-dossier-status-text">Showing matchup snapshot — <strong>${esc(domain)}</strong> dossier is currently syncing.</span>
        <button type="button" class="btn-ghost btn-compact remote-dossier-retry-btn" data-action="retry-remote-player-sheet">Retry</button>
      </div>
    `;
  }
  return '';
}

const PLAYER_MENTIONS_SORT_MIN_ITEMS = 5;

function renderOverviewTab(
  p,
  rawStream = [],
  appData = null,
  userPrefs = null,
  reportersById = null,
  activeVideosSet = new Set(),
  mentionsSortMode = 'top',
  teamContext = null
) {
  const nowMs = Date.now();
  const activeMentionsSort = normalizeNewsSortMode(mentionsSortMode);
  const sortedMentions = rankPlayerOverviewMentions(p, {
    rawStream,
    appData,
    userPrefs,
    reportersById,
    nowMs,
    maxAgeDays: 7,
    maxItems: 10,
    sortMode: activeMentionsSort
  });
  const showMentionsSortToggle = sortedMentions.length >= PLAYER_MENTIONS_SORT_MIN_ITEMS;
  const combinedDirectPosts = [
    ...(Array.isArray(rawStream) ? rawStream : []),
    ...(Array.isArray(appData?.news?.rawStream) ? appData.news.rawStream : []),
    ...sortedMentions
  ];

  const mentionsHeaderRightHtml = showMentionsSortToggle
    ? `
      <div class="segmented-control news-sort-seg player-mentions-sort-seg" role="group" aria-label="Sort Recent Mentions" data-player-mentions-sort-bar>
        ${NEWS_SORT_MODES.map(
          m => `
            <button type="button"
                    class="pill-btn seg-btn news-sort-btn ${activeMentionsSort === m.key ? 'active' : ''}"
                    data-action="set-player-mentions-sort"
                    data-sort-mode="${esc(m.key)}"
                    title="${esc(m.title)}"
                    aria-pressed="${activeMentionsSort === m.key ? 'true' : 'false'}">
              <span>${esc(m.label)}</span>
            </button>
          `
        ).join('')}
      </div>
    `
    : `<span class="mono" style="font-size:11px;color:var(--text-muted)">${sortedMentions.length} update${sortedMentions.length === 1 ? '' : 's'}</span>`;

  const newsHtml =
    sortedMentions.length > 0
      ? `
        <div class="player-mentions-section" data-player-overview-mentions data-mentions-sort-mode="${esc(activeMentionsSort)}">
          <div class="player-mentions-header" style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:7px">
            <div style="display:flex;align-items:center;gap:6px;min-width:0">
              <div class="sub-label" style="margin:0">Recent Mentions (7d)</div>
              ${
                showMentionsSortToggle
                  ? `<span class="mono" style="font-size:11px;color:var(--text-muted)">· ${sortedMentions.length}</span>`
                  : ''
              }
            </div>
            ${mentionsHeaderRightHtml}
          </div>
          <div style="display:flex;flex-direction:column;gap:7px">
            ${sortedMentions
              .map(n =>
                renderInjuryNewsItemCardHtml(n, {
                  playerName: p.name,
                  directPosts: combinedDirectPosts,
                  excludePlayerId: p.id,
                  rosterPlayers: appData?.roster?.players || [],
                  outerClassName: 'subcard-panel',
                  activeVideosSet,
                  readKeysSet: new Set(Array.isArray(userPrefs?.readItemKeys) ? userPrefs.readItemKeys : []),
                  teamContext
                })
              )
              .join('')}
          </div>
        </div>
      `
      : `<div style="font-size:12px;color:var(--text-muted)">No beat tweets, videos, or articles specific to ${esc(p.name)} in the past 7 days.</div>`;

  const safeRemoteOrigin = teamContext?.isRemoteTeam ? sanitizeExternalUrl(teamContext.origin, null) : null;
  const safeEspnUrl = sanitizeExternalUrl(p.espnUrl, null);
  const safeOtcUrl = sanitizeExternalUrl(p.otcUrl, null);
  const safePfrUrl = sanitizeExternalUrl(p.pfrUrl, null);
  const safeXBeatUrl = sanitizeExternalUrl(buildXPlayerScoopSearchUrl(p.name, teamContext), null);
  const otcFallbackLabel = teamContext?.isRemoteTeam
    ? `OverTheCap ${teamContext.nickname || teamContext.abbr} Cap`
    : 'OverTheCap 49ers Cap';
  const profileLinks = [
    safeRemoteOrigin && teamContext?.domain
      ? { label: teamContext.domain, url: safeRemoteOrigin, isTeamSite: true }
      : null,
    safeXBeatUrl ? { label: 'Live X Beat', url: safeXBeatUrl } : null,
    safeEspnUrl ? { label: 'ESPN Profile', url: safeEspnUrl } : null,
    safeOtcUrl
      ? {
          label: isIndividualOtcPlayerUrl(safeOtcUrl) ? 'OverTheCap Contract' : otcFallbackLabel,
          url: safeOtcUrl
        }
      : null,
    safePfrUrl ? { label: 'Pro-Football-Ref', url: safePfrUrl } : null
  ].filter(Boolean);

  const bioParts = [
    p.displayHeight && p.displayHeight !== '—' ? p.displayHeight : null,
    p.displayWeight && p.displayWeight !== '—' ? p.displayWeight : null,
    p.age != null ? `Age ${p.age}` : null,
    p.college || null
  ].filter(Boolean);
  const heroSubtitleText = bioParts.length
    ? bioParts.join(' • ')
    : teamContext?.fullName || 'NFL Roster';
  const bucketLabel = String(p.rosterBucket || 'active').replace('_', ' ').toUpperCase();

  return `
    <div class="dossier-hero-banner">
      <div style="display:flex;align-items:center;gap:12px;min-width:0">
        ${renderPlayerAvatarHtml(p, 68, { showJerseyBadge: true, hero: true })}
        <div style="min-width:0">
          <div style="font-weight:800;font-size:15px">${esc(p.position)} • ${esc(p.unit)} (${esc(bucketLabel)})</div>
          <div style="font-size:12px;color:var(--text-secondary)">${esc(heroSubtitleText)}</div>
        </div>
      </div>
      <span class="badge ${playProbBadgeClass(p.health?.playProbabilityPct)} mono">${esc(p.health?.playBadgeLabel)}</span>
    </div>

    ${
      profileLinks.length
        ? `<div class="source-link-strip">
            ${profileLinks
              .map(
                pl => `<a href="${esc(pl.url)}" target="_blank" rel="noopener noreferrer" class="source-chip-link${pl.isTeamSite ? ' remote-team-site-chip' : ''}"${pl.isTeamSite ? ' data-remote-team-site-link="true"' : ''}><span>${esc(pl.label)}</span>${iconSvg('externalLink', 11)}</a>`
              )
              .join('')}
          </div>`
        : ''
    }

    <div class="kpi-grid">
      <div class="kpi-box">
        <div class="kpi-label">Draft Pedigree</div>
        <div class="kpi-val" style="font-size:12px">${esc(p.draftInfo)}</div>
      </div>
      <div class="kpi-box">
        <div class="kpi-label">2026 Snap Share</div>
        <div class="kpi-val mono">${p.primarySnapPct}%</div>
        ${renderMiniMeterHtml(p.primarySnapPct, 'gold')}
      </div>
      <div class="kpi-box">
        <div class="kpi-label">2026 Cap Hit</div>
        <div class="kpi-val mono">${p.capHit2026 ? formatCompactDollars(p.capHit2026) : 'PS/Min'}</div>
      </div>
    </div>

    ${
      p.publicEfficiencyNote
        ? `<div style="padding:9px 11px;border-radius:9px;background:var(--gold-soft);border:1px solid var(--gold-border);font-size:12.5px">
            <strong style="color:var(--gold-bright)">Scouting Note:</strong> ${escJargon(p.publicEfficiencyNote, { excludePlayerId: p.id })}
           </div>`
        : ''
    }

    ${newsHtml}
  `;
}

function renderPlayerStatRankCellHtml(row, playerId) {
  const rank = Number(row.rank || 1);
  const total = Math.max(1, Number(row.totalPeers || 32));
  const scaledRank32 = Math.max(1, Math.min(32, Math.round((rank / total) * 32)));
  const pct = Math.max(6, Math.min(100, Math.round(((total - rank + 1) / total) * 100)));
  const meterColor = scaledRank32 <= 8 ? 'emerald' : scaledRank32 <= 18 ? 'gold' : 'scarlet';
  const scope = row.scope || 'player';

  if (!row.leaderboardKey) {
    return `<span class="badge ${rankBadgeClass(scaledRank32)} mono">#${rank}</span>`;
  }

  return `
    <button type="button" class="rank-badge-trigger"
            data-action="open-stat-rank-modal"
            data-rank-scope="${esc(scope)}"
            data-rank-key="${esc(row.leaderboardKey)}"
            data-player-id="${esc(playerId || '')}"
            aria-label="Rank #${rank} of ${total} — tap to view leaderboard">
      <span class="badge ${rankBadgeClass(scaledRank32)} mono">#${rank}${!row.qualified ? '*' : ''}</span>
      ${renderMiniMeterHtml(pct, meterColor)}
    </button>
  `;
}

function renderPlayerStatTableRowsHtml(rows = [], playerId = '') {
  return rows
    .map(
      r => `
      <tr>
        <td><strong>${escJargon(r.label)}</strong></td>
        <td class="mono num-col"><strong>${esc(r.displayValue)}</strong></td>
        <td class="rank-col">${renderPlayerStatRankCellHtml(r, playerId)}</td>
        <td class="mono num-col" style="color:var(--text-muted)">${esc(r.posAvgDisplay)}</td>
      </tr>
    `
    )
    .join('');
}

function renderStatsTab(p, statsMode) {
  const seasons = p.careerSeasons || [];
  const profile = p.statProfile2026 || null;

  const modeToggle = `
    <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap">
      <div class="segmented-control compact-seg" role="tablist" aria-label="Player Stat View Mode" style="flex:1 1 240px;margin:0">
        <button type="button" role="tab" aria-selected="${statsMode === '2026' ? 'true' : 'false'}" class="pill-btn seg-btn ${statsMode === '2026' ? 'active' : ''}" data-action="set-player-stats-mode" data-stats-mode="2026"><span>2026 Season</span></button>
        <button type="button" role="tab" aria-selected="${statsMode === 'career' ? 'true' : 'false'}" class="pill-btn seg-btn ${statsMode === 'career' ? 'active' : ''}" data-action="set-player-stats-mode" data-stats-mode="career"><span>Career Year-by-Year (${seasons.length})</span></button>
      </div>
      <div class="source-link-strip">
        ${p.pfrUrl ? `<a href="${esc(p.pfrUrl)}" target="_blank" rel="noopener noreferrer" class="source-chip-link"><span>PFR Stats</span>${iconSvg('externalLink', 10)}</a>` : ''}
        <a href="https://github.com/nflverse/nflverse-data" target="_blank" rel="noopener noreferrer" class="source-chip-link"><span>nflverse</span>${iconSvg('externalLink', 10)}</a>
        <a href="https://nextgenstats.nfl.com/" target="_blank" rel="noopener noreferrer" class="source-chip-link"><span>NextGen</span>${iconSvg('externalLink', 10)}</a>
      </div>
    </div>
  `;

  if (statsMode === 'career') {
    if (seasons.length === 0) {
      return `${modeToggle}<div class="subcard-panel" style="font-size:12.5px;color:var(--text-muted)">
        No multi-year NFL box-score seasons recorded yet (${esc(p.position)} • ${esc(p.draftInfo || 'Roster')}).
      </div>`;
    }
    const schema = resolveCareerTableSchema(p.position);
    return `
      ${modeToggle}
      <section class="card team-stats-card player-stat-section">
        <div class="card-header team-stats-header">
          <div class="card-header-left">
            <div class="card-icon-badge compact" aria-hidden="true">${iconSvg('calendar', 15)}</div>
            <div class="card-title-group">
              <h3 class="card-title">Career Stats (${seasons[seasons.length - 1].season}–${seasons[0].season})</h3>
            </div>
          </div>
        </div>
        <div class="table-scroll">
          <table class="data-table team-stats-table mono" data-career-pos-table="${esc(p.position)}">
            <thead>
              <tr>
                ${schema.headers.map((h, idx) => `<th class="${idx >= 2 ? 'num-col' : ''}">${esc(h)}</th>`).join('')}
              </tr>
            </thead>
            <tbody>
              ${seasons
                .map(s => {
                  const cells = schema.cells(s);
                  return `
                    <tr>
                      ${cells
                        .map((cell, idx) =>
                          idx === 0
                            ? `<td>${cell}</td>`
                            : `<td class="${idx >= 2 ? 'num-col' : ''}">${esc(String(cell))}</td>`
                        )
                        .join('')}
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

  // 2026 Season Mode — Position-Tailored Single-Stat Rows + Clickable #X Positional Leaderboards
  const snapBannerHtml = `
    <div class="subcard-panel player-snaps-banner" style="font-size:12px;color:var(--text-secondary)">
      <strong style="color:var(--text-primary)">2026 Snaps Logged:</strong>
      Offense <span class="mono">${p.snapSummary?.offenseSnaps || 0} (${p.snapSummary?.offenseSnapPct || 0}%)</span> •
      Defense <span class="mono">${p.snapSummary?.defenseSnaps || 0} (${p.snapSummary?.defenseSnapPct || 0}%)</span> •
      Special Teams <span class="mono">${p.snapSummary?.stSnaps || 0} (${p.snapSummary?.stSnapPct || 0}%)</span>
    </div>
  `;

  if (!profile?.hasActiveStats || !(profile.sections || []).length) {
    const statLineBox = p.statLine2026
      ? `<div class="subcard-panel" style="border-color:var(--gold-border);font-size:12.5px">
           <strong style="color:var(--gold-bright)">2026 Season Production:</strong> <span class="mono">${esc(p.statLine2026)}</span>
         </div>`
      : '';
    return `
      ${modeToggle}
      ${snapBannerHtml}
      ${statLineBox}
      <div class="subcard-panel" style="font-size:12.5px;color:var(--text-secondary)">
        ${
          p.statLine2026
            ? `Full positional percentile breakdown syncs automatically from team stats feeds.`
            : `No 2026 regular-season game snaps logged yet (${esc(p.health?.status || p.rosterBucket)}).`
        }${
          seasons.length > 0
            ? ` Switch to <strong>Career Year-by-Year (${seasons.length})</strong> above to inspect prior NFL seasons.`
            : ''
        }
      </div>
    `;
  }

  const hasAnyUnqualified = (profile.sections || []).some(sec =>
    [...(sec.coreRows || []), ...(sec.expandedRows || [])].some(r => !r.qualified)
  );

  const sectionsHtml = (profile.sections || [])
    .map(sec => {
      const expRows = sec.expandedRows || [];
      const expSubgroups = [];
      for (const r of expRows) {
        const gTitle = r.group || 'Advanced Efficiency, NextGen & Film Metrics';
        const lastGrp = expSubgroups[expSubgroups.length - 1];
        if (!lastGrp || lastGrp.groupTitle !== gTitle) {
          expSubgroups.push({ groupTitle: gTitle, rows: [r] });
        } else {
          lastGrp.rows.push(r);
        }
      }
      return `
        <section class="card team-stats-card player-stat-section" data-player-stat-section="${esc(sec.id)}">
          <div class="card-header team-stats-header">
            <div class="card-header-left">
              <div class="card-icon-badge compact" aria-hidden="true">${iconSvg('season', 15)}</div>
              <div class="card-title-group">
                <h3 class="card-title">${esc(sec.title)}</h3>
              </div>
            </div>
          </div>
          <div class="table-scroll">
            <table class="data-table team-stats-table player-stats-table">
              <thead>
                <tr>
                  <th>Metric</th>
                  <th class="mono num-col">${esc(p.shortName || 'Player')}</th>
                  <th class="mono rank-col">Rank</th>
                  <th class="mono num-col">NFL Avg</th>
                </tr>
              </thead>
              <tbody>
                ${renderPlayerStatTableRowsHtml(sec.coreRows || [], p.id)}
              </tbody>
            </table>
          </div>
          ${
            expRows.length > 0
              ? `
            <details class="stats-expand-details" data-player-stats-expander="${esc(sec.id)}">
              <summary class="stats-expand-summary">
                <span>Detailed ${esc(p.position)} Metrics (${expRows.length})</span>
                <span class="mono stats-expand-hint">Expand</span>
              </summary>
              <div class="stats-expand-body">
                ${expSubgroups
                  .map(
                    grp => `
                  <div class="stats-subgroup-block">
                    <div class="sub-label stats-subgroup-title">${esc(grp.groupTitle)}</div>
                    <div class="table-scroll">
                      <table class="data-table team-stats-table player-stats-table">
                        <tbody>
                          ${renderPlayerStatTableRowsHtml(grp.rows, p.id)}
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
    })
    .join('');

  const footnoteHtml = hasAnyUnqualified
    ? `<div style="font-size:11px;color:var(--text-muted)">* Below full-starter per-game volume threshold; effective placement shown against qualified NFL ${esc(profile.peerGroupLabel || p.position)}.</div>`
    : '';

  return `${modeToggle}${snapBannerHtml}${sectionsHtml}${footnoteHtml}`;
}

function renderContractTab(p, txScenario, teamContext = null) {
  const yrs = Object.values(p.contractsByYear || {}).sort((a, b) => a.year - b.year);
  const fallbackOtcUrl =
    p.otcUrl || teamContext?.otcCapUrl || 'https://overthecap.com/salary-cap/san-francisco-49ers';
  if (yrs.length === 0) {
    if (p._isMatchupSeedFallback && teamContext?.isRemoteTeam) {
      return `<div class="subcard-panel" style="font-size:12.5px;display:flex;flex-direction:column;gap:8px">
        <div>Multi-year OverTheCap contract table loads directly from <strong>${esc(teamContext.domain)}</strong> when available.</div>
        <div>
          <a href="${esc(fallbackOtcUrl)}" target="_blank" rel="noopener noreferrer" class="source-chip-link">
            <span>View ${esc(teamContext.nickname || teamContext.abbr)} Cap on OverTheCap</span>${iconSvg('externalLink', 10)}
          </a>
        </div>
      </div>`;
    }
    return `<div class="subcard-panel" style="font-size:12.5px">
      Practice Squad / Non-Top-51 standard weekly agreement (no multi-year guaranteed dead-money exposure).
    </div>`;
  }

  const activeContractYr = p.contractsByYear['2026'] || yrs[0];
  const activeYrLabel = activeContractYr?.year || 2026;
  const tx = activeContractYr.transactions?.[txScenario] || { deadMoney: 0, capSavings: 0 };

  const txButtons = [
    ['cut', 'Pre-6/1 Cut'],
    ['june_1_cut', 'Post-6/1 Cut'],
    ['trade', 'Pre-6/1 Trade'],
    ['june_1_trade', 'Post-6/1 Trade'],
    ['restructure', 'Max Restructure'],
    ['extension', 'Extension']
  ]
    .map(
      ([key, label]) => `
      <button type="button" class="pill-btn ${txScenario === key ? 'active' : ''}"
              data-action="set-player-tx-scenario" data-tx="${key}">${esc(label)}</button>
    `
    )
    .join('');

  return `
    <div>
      <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:6px">
        <div class="sub-label">Contract Breakdown (${yrs[0].year}–${yrs[yrs.length - 1].year})</div>
        <a href="${esc(fallbackOtcUrl)}" target="_blank" rel="noopener noreferrer" class="source-chip-link">
          <span>OverTheCap</span>${iconSvg('externalLink', 10)}
        </a>
      </div>
      <div class="table-scroll">
        <table class="data-table mono">
          <thead>
            <tr>
              <th>Year</th><th>Base Salary</th><th>${jargonTerm('Prorated Bonuses', 'prorated_bonus')}</th><th>Current Yr Bonuses</th><th>${jargonTerm('Guaranteed', 'guaranteed_salary')}</th><th>Cap Hit</th>
            </tr>
          </thead>
          <tbody>
            ${yrs
              .map(
                y => `
              <tr>
                <td><strong>${y.year}</strong></td>
                <td>${y.isVoidYear ? `<span class="badge badge-neutral">${jargonTerm('Void', 'void_years')}</span>` : formatOtcDollars(y.baseSalary)}</td>
                <td>${formatOtcDollars((y.proratedSigning || 0) + (y.proratedOption || 0))}</td>
                <td>${formatOtcDollars((y.rosterBonusRegular || 0) + (y.rosterBonusPerGame || 0) + (y.workoutBonus || 0) + (y.otherBonus || 0))}</td>
                <td>${formatOtcDollars(y.guaranteedSalary)}</td>
                <td><strong>${formatOtcDollars(y.capNumber)}</strong></td>
              </tr>
            `
              )
              .join('')}
          </tbody>
        </table>
      </div>
    </div>

    <div>
      <div class="sub-label" style="margin-bottom:6px">${activeYrLabel} ${jargonTerm('Dead Cap', 'dead_cap')} &amp; Cap Savings</div>
      <div class="pill-bar" style="margin-bottom:8px">${txButtons}</div>
      <div class="kpi-grid kpi-grid-2">
        <div class="kpi-box">
          <div class="kpi-label">${esc(formatCapActionLabel(txScenario))} — Dead Cap</div>
          <div class="kpi-val mono" style="color:var(--crimson)">${formatDollars(tx.deadMoney)}</div>
        </div>
        <div class="kpi-box">
          <div class="kpi-label">${activeYrLabel} Net Cap Savings</div>
          <div class="kpi-val mono" style="color:${tx.capSavings >= 0 ? 'var(--emerald)' : 'var(--crimson)'}">
            ${formatDollars(tx.capSavings, true)}
          </div>
        </div>
      </div>
    </div>
  `;
}

function formatDossierPracVal(val) {
  const s = String(val ?? '').trim();
  return !s || s === '-' ? '—' : s;
}

function renderHealthTab(
  p,
  rawStream = [],
  appData = null,
  userPrefs = null,
  reportersById = null,
  activeVideosSet = new Set(),
  teamContext = null
) {
  const h = p.health || {};
  const isIrOrReserve = p.rosterBucket === 'ir' || p.rosterBucket === 'suspended';
  const currentWeek = Number(
    appData?.health?.week ||
      appData?.scheduleMatchup?.upcomingMatchup?.week ||
      appData?.meta?.currentWeek ||
      1
  );
  const byeWeek = Number(appData?.health?.byeWeek || 8);
  const isEligibleByStatus = isPlayerEligibleForInjuryNews(p, { currentWeek, byeWeek });

  const nowMs = Date.now();
  const injuryItems = rankPlayerInjuryNews(p, {
    rawStream,
    appData,
    userPrefs,
    reportersById,
    nowMs,
    maxAgeDays: 14,
    maxItems: 25,
    includeFallbackCard: isEligibleByStatus
  });
  const showInjuryNewsCard = isEligibleByStatus || injuryItems.length > 0;

  const practiceBoxesHtml = `
    <div class="kpi-grid" data-practice-days-grid>
      <div class="kpi-box"><div class="kpi-label">Wednesday</div><div class="kpi-val mono">${esc(formatDossierPracVal(h.wed))}</div></div>
      <div class="kpi-box"><div class="kpi-label">Thursday</div><div class="kpi-val mono">${esc(formatDossierPracVal(h.thu))}</div></div>
      <div class="kpi-box"><div class="kpi-label">Friday</div><div class="kpi-val mono">${esc(formatDossierPracVal(h.fri))}</div></div>
    </div>
  `;

  const irDetailHtml = isIrOrReserve
    ? `
    <div class="kpi-grid">
      <div class="kpi-box">
        <div class="kpi-label">Reserve List</div>
        <div class="kpi-val" style="font-size:12.5px">${esc(h.status || 'Injured Reserve')}</div>
      </div>
      <div class="kpi-box">
        <div class="kpi-label">Earliest Eligible</div>
        <div class="kpi-val mono">${h.isSeasonEnding ? 'Ineligible' : h.earliestEligibleWeek ? `Week ${h.earliestEligibleWeek}` : '—'}</div>
      </div>
      <div class="kpi-box">
        <div class="kpi-label">Return Window</div>
        <div class="kpi-val mono" style="font-size:12px;color:${h.isSeasonEnding ? 'var(--crimson)' : 'var(--gold-bright)'}">
          ${esc(h.isSeasonEnding ? 'Out for Season' : h.projectedReturnWeek || 'TBD')}
        </div>
      </div>
    </div>
    ${isEligibleByStatus ? practiceBoxesHtml : ''}
    `
    : practiceBoxesHtml;

  const combinedDirectPosts = [
    ...(Array.isArray(rawStream) ? rawStream : []),
    ...(Array.isArray(appData?.news?.rawStream) ? appData.news.rawStream : []),
    ...(Array.isArray(p.recentNews) ? p.recentNews : [])
  ];

  const injuryNewsCardHtml = showInjuryNewsCard
    ? `
    <section class="card injury-news-dossier-card" data-player-injury-news>
      <div class="injury-news-card-head">
        <div style="display:flex;align-items:center;gap:7px;min-width:0">
          <div class="card-icon-badge compact" aria-hidden="true">${iconSvg('news', 14)}</div>
          <h3 class="card-title" style="font-size:14px">Injury News</h3>
        </div>
        <span class="mono" style="font-size:11px;color:var(--text-muted)">${injuryItems.length} ${injuryItems.length === 1 ? 'update' : 'updates'}</span>
      </div>
      ${
        injuryItems.length > 0
          ? `<div class="injury-news-items-stack">
              ${injuryItems
                .map(item =>
                  renderInjuryNewsItemCardHtml(item, {
                    playerName: p.name,
                    directPosts: combinedDirectPosts,
                    excludePlayerId: p.id,
                    rosterPlayers: appData?.roster?.players || [],
                    activeVideosSet,
                    readKeysSet: new Set(Array.isArray(userPrefs?.readItemKeys) ? userPrefs.readItemKeys : []),
                    teamContext
                  })
                )
                .join('')}
            </div>`
          : `<div style="font-size:12px;color:var(--text-muted)">Monitoring practice &amp; beat wire for new rehab updates on ${esc(p.name)}.</div>`
      }
    </section>
    `
    : '';

  const noteBody = h.irBeatNote || h.longComment || h.shortComment || '';
  const officialInjuryUrl = sanitizeExternalUrl(
    teamContext?.injuryReportUrl || appData?.health?.sourceUrl || 'https://www.49ers.com/team/injury-report/',
    'https://www.49ers.com/team/injury-report/'
  );
  const officialInjuryLabel = teamContext?.isRemoteTeam
    ? `${teamContext.clubDomain || teamContext.abbr} Report`
    : '49ers.com Report';

  return `
    <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap">
      <div>
        <div class="sub-label">Availability</div>
        <div style="font-size:13px;color:var(--text-secondary)">Status: <strong>${esc(h.status || 'Active')}</strong> ${h.injuryType ? `(${esc(h.injuryType)})` : ''}</div>
      </div>
      <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap">
        <a href="${esc(officialInjuryUrl)}" target="_blank" rel="noopener noreferrer" class="source-chip-link"><span>${esc(officialInjuryLabel)}</span>${iconSvg('externalLink', 10)}</a>
        <span class="badge ${playProbBadgeClass(h.playProbabilityPct)} mono" style="font-size:13px;padding:4px 10px">${esc(h.playBadgeLabel)}</span>
      </div>
    </div>

    ${irDetailHtml}

    ${injuryNewsCardHtml}

    <div class="subcard-panel" style="border-color:var(--gold-border);font-size:12.5px" data-player-availability-prior>
      <strong style="color:var(--gold-bright)">Player Availability Prior:</strong> ${escJargon(h.archetypeNote || 'Standard positional prior.', { excludePlayerId: p.id })}
    </div>

    <div>
      <div class="sub-label" style="margin-bottom:4px">Model Factors</div>
      <ul class="brief-bullets">
        ${(h.factors || []).map(f => `<li>${escJargon(f, { excludePlayerId: p.id })}</li>`).join('')}
      </ul>
    </div>

    ${
      noteBody
        ? `<div class="subcard-panel" style="font-size:12.5px">
            <strong>Beat &amp; Medical Note:</strong> ${escJargon(noteBody, { excludePlayerId: p.id })}
           </div>`
        : ''
    }
  `;
}
