/**
 * Main Application Controller for 49ers Faithful (https://49ers.joshal.com)
 */

import { evaluateSeasonState, resolveOrderedDashboardBlocks } from './engine/seasonStateMachine.js';
import { simulateCapScenario } from './engine/capSimulator.js';
import { runPlayoffMonteCarlo } from './engine/playoffMonteCarlo.js';
import { filterNewsByUserPrefs } from './engine/antiFluffFilter.js';
import {
  is49ersGameLiveWindow,
  isCompletedGameAvailabilityCluster,
  isActiveInGameAvailabilityCluster
} from './engine/breakingClassifier.js?v=47';
import { PodcastAudioController, formatTimeMmSs } from './components/audioPlayer.js';
import {
  loadAll49ersData,
  fetchFresherUpstreamData,
  hydrateLiveMultiSourceBeatWire,
  LIVE_WIRE_SOURCE_LABELS,
  hydrateLiveEspnOverlay,
  hydrateLive49ersPodcasts,
  loadUserPrefs,
  saveUserPrefs
} from './services/dataService.js?v=47';
import {
  PODCAST_PIPELINE_STAGES,
  ANALYSIS_PIPELINE_STAGES,
  fetchSharedWorkerFeed,
  runOnDemandDeepAnalysis,
  generateOnDemandAutopodcast,
  synthesizeMissingEpisodeAudio,
  estimateGenerationWait,
  resolveActiveHighQualityModelLabel,
  verifyGeminiApiKey,
  checkAndAutoUpdateBestGeminiModel,
  hydrateCachedDailyMatchupIntel,
  refreshDailyMatchupIntelIfDue,
  hydrateCachedDailyTopNewsBrief,
  refreshDailyTopNewsBriefIfDue
} from './services/aiWorkerClient.js?v=47';
import { deleteEpisodeAudioBlob } from './services/podcastAudioStore.js';
import {
  buildShareablePodcastUrl,
  buildShareableAnalysisUrl,
  extractIncomingSharedRoute,
  shareItemNatively
} from './services/shareService.js';

import {
  esc,
  formatRelativeAge,
  rankBadgeClass,
  renderTeamLogoHtml,
  renderPlayerAvatarHtml,
  renderMiniMeterHtml,
  registerRosterPlayersForInlineLinks
} from './views/uiHelpers.js?v=42';
import { getJargonEntry } from './engine/jargonGlossary.js?v=42';
import { resolveLeaderboardModalModel } from './engine/statsLeaderboardEngine.js?v=42';
import { iconSvg } from './views/icons.js?v=42';
import { renderHomeDashboardHtml } from './views/homeView.js?v=47';
import {
  renderNewsViewHtml,
  VALID_NEWS_CATEGORIES
} from './views/newsView.js?v=47';
import { renderRosterCapViewHtml, ROSTER_SORT_FIELDS, normalizeRosterSort } from './views/rosterCapView.js?v=42';
import { renderPlayerDossierSheetHtml } from './views/playerSheetView.js?v=47';
import { renderSeasonMatchupViewHtml } from './views/seasonMatchupView.js?v=47';
import { renderAudioAiViewHtml } from './views/audioAiView.js?v=42';
import { renderSettingsSheetHtml, renderArchiveVaultSheetHtml } from './views/settingsArchiveView.js?v=47';

const state = {
  appData: null,
  prefs: loadUserPrefs(),
  seasonState: null,

  activeNavTab: 'home', // 'home' | 'news' | 'roster' | 'season' | 'audio'
  isCustomizingLayout: false,
  draggedBlockId: null,

  // News state
  newsCategoryFilter: 'all',
  activeVideosSet: new Set(),
  lastWireSyncAt: null,
  isSyncingWire: false,

  // Roster & Cap state
  rosterSubTab: 'roster',
  rosterSearch: '',
  rosterUnitFilter: 'All',
  rosterPosFilter: 'ALL',
  rosterSort: 'jersey',
  rosterSortDir: 'asc',
  depthMode: 'projected',
  capSelectedYear: '2026',

  // Season & Temporal state
  seasonSubTab: 'matchup',
  matchupStatsUnit: 'offense',
  schedulePrevExpanded: false,
  expandedRootingWeeks: new Set(),
  combineSearch: '',
  expandedDraftSpiderIdx: -1,

  // Audio & AI Studio state
  studioSubTab: 'beat_podcasts',
  beatPodViewMode: 'date',
  beatPodShowFilter: 'all',
  podDurationMin: 3,
  podFormat: 'two_host',
  podTopicDraft: '',
  analysisPromptDraft: '',
  podLibraryFilter: 'active',
  analysisLibraryFilter: 'active',
  geminiKeyNotice: '',
  showGeminiKeyGuide: false,
  jobStatus: null,
  workerSharedFeed: { analyses: [], episodes: [] },
  audioState: {},
  expandedTranscriptIds: new Set(),
  shareToastTargetId: null,

  // Bottom Sheet & Rank Modal state
  sheetMode: null, // 'player' | 'settings' | 'vault' | null
  sheetPlayerId: null,
  sheetPlayerTab: 'overview',
  sheetPlayerStatsMode: '2026',
  sheetPlayerTxScenario: 'cut',
  reporterSearch: '',
  rankModal: null // { scope: 'team' | 'player', key: string, playerId: string | null }
};

let audioController = null;
let cachedMonteCarloKey = '';
let cachedMonteCarloResult = null;
let activeJargonAnchor = null;

function getCapMovesForYear(yearKey = '2026') {
  const yr = String(yearKey || '2026');
  const byYr = state.prefs?.capMovesByYear;
  if (byYr && typeof byYr === 'object' && byYr[yr] && typeof byYr[yr] === 'object') {
    return byYr[yr];
  }
  if (yr === '2026' && state.prefs?.capMoves && typeof state.prefs.capMoves === 'object') {
    return state.prefs.capMoves;
  }
  return {};
}

function setCapMovesForYear(yearKey, nextMoves) {
  const yr = String(yearKey || '2026');
  const clean = nextMoves && typeof nextMoves === 'object' ? { ...nextMoves } : {};
  if (!state.prefs.capMovesByYear || typeof state.prefs.capMovesByYear !== 'object') {
    state.prefs.capMovesByYear = {};
  }
  state.prefs.capMovesByYear[yr] = clean;
  if (yr === '2026') {
    state.prefs.capMoves = clean;
  }
}

function closeJargonPopover() {
  const pop = document.getElementById('jargonPopover');
  if (pop) {
    pop.hidden = true;
    pop.innerHTML = '';
  }
  activeJargonAnchor = null;
}

function openJargonPopover(anchorEl, jargonKey) {
  const pop = document.getElementById('jargonPopover');
  if (!pop || !anchorEl) return;

  if (!pop.hidden && activeJargonAnchor === anchorEl) {
    closeJargonPopover();
    return;
  }

  const entry = getJargonEntry(jargonKey);
  if (!entry) return;

  activeJargonAnchor = anchorEl;
  pop.setAttribute('aria-label', `${entry.term} definition`);
  pop.innerHTML = `
    <div class="jargon-popover-head">
      <div>
        <div class="jargon-popover-cat">${esc(entry.category)}</div>
        <div class="jargon-popover-title">${esc(entry.term)}</div>
      </div>
      <button type="button" class="jargon-popover-close" data-action="close-jargon-popover" aria-label="Close definition">✕</button>
    </div>
    <div class="jargon-popover-body">${esc(entry.definition)}</div>
  `;
  pop.style.left = '10px';
  pop.style.top = '10px';
  pop.hidden = false;

  const anchorRect = anchorEl.getBoundingClientRect();
  const popRect = pop.getBoundingClientRect();
  const vw = window.innerWidth || document.documentElement.clientWidth || 390;
  const vh = window.innerHeight || document.documentElement.clientHeight || 844;

  let left = anchorRect.left + anchorRect.width / 2 - popRect.width / 2;
  left = Math.max(10, Math.min(left, vw - popRect.width - 10));

  let top = anchorRect.bottom + 8;
  if (top + popRect.height > vh - 12 && anchorRect.top - popRect.height - 8 >= 10) {
    top = anchorRect.top - popRect.height - 8;
  }
  top = Math.max(10, Math.min(top, vh - popRect.height - 10));

  pop.style.left = `${Math.round(left)}px`;
  pop.style.top = `${Math.round(top)}px`;
}

function applyTheme(theme) {
  const clean = theme === 'light' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', clean);
  const metaTheme = document.getElementById('metaThemeColor');
  if (metaTheme) {
    metaTheme.setAttribute('content', clean === 'light' ? '#F7F5F0' : '#0B0D10');
  }
}

function getReportersMap() {
  return new Map((state.appData?.reporters?.reporters || []).map(r => [r.id, r]));
}

function getPlayerById(id) {
  if (!id || !state.appData?.roster?.players) return null;
  const sid = String(id);
  return (
    state.appData.roster.players.find(
      p => String(p.id) === sid || String(p.otcId) === sid || String(p.pfrId) === sid
    ) || null
  );
}

function getMonteCarloResult() {
  const inputs = state.appData?.seasonal?.playoffPicture?.simulatorInputs;
  if (!inputs) return state.appData?.seasonal?.playoffPicture?.baselineSimulation || null;

  const overrides = state.prefs.playoffForcedWinners || {};
  const key = JSON.stringify(overrides);
  if (Object.keys(overrides).length === 0) {
    return state.appData.seasonal.playoffPicture.baselineSimulation;
  }
  if (key === cachedMonteCarloKey && cachedMonteCarloResult) {
    return cachedMonteCarloResult;
  }
  cachedMonteCarloKey = key;
  cachedMonteCarloResult = runPlayoffMonteCarlo({
    ...inputs,
    forcedWinners: overrides,
    iterations: 10000,
    seed: 492026
  });
  return cachedMonteCarloResult;
}

function getAllEpisodes() {
  const base = state.appData?.podcastIndex?.episodes || [];
  const workerEps = state.workerSharedFeed?.episodes || [];
  const localEps = state.prefs.localCustomEpisodes || [];
  const deletedSet = new Set(state.prefs.deletedEpisodeIds || []);
  const merged = [...localEps, ...workerEps, ...base];
  const seen = new Set();
  return merged.filter(ep => {
    if (!ep?.id || seen.has(ep.id) || deletedSet.has(ep.id)) return false;
    seen.add(ep.id);
    return true;
  });
}

function getActiveEpisodes() {
  const archivedSet = new Set(state.prefs.archivedEpisodeIds || []);
  return getAllEpisodes().filter(ep => !archivedSet.has(ep.id));
}

function getArchivedEpisodes() {
  const archivedSet = new Set(state.prefs.archivedEpisodeIds || []);
  return getAllEpisodes().filter(ep => archivedSet.has(ep.id));
}

function getAllAnalyses() {
  const base = state.appData?.podcastIndex?.sharedAnalyses || [];
  const workerItems = state.workerSharedFeed?.analyses || [];
  const localItems = state.prefs.localCustomAnalyses || [];
  const deletedSet = new Set(state.prefs.deletedAnalysisIds || []);
  const merged = [...localItems, ...workerItems, ...base];
  const seen = new Set();
  return merged.filter(item => {
    if (!item?.id || seen.has(item.id) || deletedSet.has(item.id)) return false;
    seen.add(item.id);
    return true;
  });
}

function getActiveAnalyses() {
  const archivedSet = new Set(state.prefs.archivedAnalysisIds || []);
  const activeList = getAllAnalyses().filter(
    item => !archivedSet.has(item.id) && !isCompletedGameAvailabilityCluster(item, state.appData)
  );
  if (activeList.length > 1) {
    const normal = [];
    const demoted = [];
    for (const item of activeList) {
      if (isActiveInGameAvailabilityCluster(item, state.appData)) {
        demoted.push(item);
      } else {
        normal.push(item);
      }
    }
    return [...normal, ...demoted];
  }
  return activeList;
}

function getArchivedAnalyses() {
  const archivedSet = new Set(state.prefs.archivedAnalysisIds || []);
  return getAllAnalyses().filter(item => archivedSet.has(item.id));
}

function preserveFocusAroundRender(renderFn) {
  const active = document.activeElement;
  const activeId = active?.id || null;
  const selStart = typeof active?.selectionStart === 'number' ? active.selectionStart : null;
  const selEnd = typeof active?.selectionEnd === 'number' ? active.selectionEnd : null;

  const prevDetailsEl = document.querySelector('details[data-schedule-previous-games]');
  if (prevDetailsEl) {
    state.schedulePrevExpanded = Boolean(prevDetailsEl.open);
  }
  if (document.querySelector('[data-rooting-guide-weeks]')) {
    const openRooting = Array.from(document.querySelectorAll('details[data-rooting-week][open]'))
      .map(el => Number(el.getAttribute('data-rooting-week')))
      .filter(Number.isFinite);
    state.expandedRootingWeeks = new Set(openRooting);
  }

  renderFn();

  if (activeId) {
    const nextEl = document.getElementById(activeId);
    if (nextEl && typeof nextEl.focus === 'function') {
      nextEl.focus({ preventScroll: true });
      if (selStart != null && typeof nextEl.setSelectionRange === 'function') {
        try {
          nextEl.setSelectionRange(selStart, selEnd ?? selStart);
        } catch {}
      }
    }
  }
}

function renderHeaderAndPhaseBanner() {
  if (!state.appData) return;
  const m = state.appData.meta || {};
  const recPill = document.getElementById('headerRecordPill');
  const subStatus = document.getElementById('headerSubStatus');
  if (recPill) recPill.textContent = m.teamRecord || '—';
  if (subStatus) {
    subStatus.textContent = `${m.standingSummary || 'NFC West'} • Synced ${formatRelativeAge(m.updatedAt)}`;
  }

  const bannerEl = document.getElementById('phaseBanner');
  if (bannerEl && state.seasonState) {
    const isTradeActive = Boolean(state.seasonState.activePhases?.includes('TRADE_WINDOW'));
    const isInTradeSection = state.activeNavTab === 'season' && state.seasonSubTab === 'trade';
    if (!isTradeActive || !isInTradeSection) {
      bannerEl.hidden = true;
      bannerEl.innerHTML = '';
    } else {
      const hp = state.seasonState.headlinePhase;
      bannerEl.hidden = false;
      bannerEl.innerHTML = `
        <div class="phase-banner-left" style="cursor:pointer" data-action="jump-season-sub" data-season-sub="trade">
          <div class="phase-icon-badge" aria-hidden="true">
            ${iconSvg('trade', 16)}
          </div>
          <div class="phase-banner-main">
            <div class="phase-eyebrow">${esc(hp.label)}</div>
            <div class="phase-detail">${esc(hp.detail)}</div>
          </div>
        </div>
        ${
          hp.countdownText
            ? `<button type="button" class="phase-countdown mono" data-action="jump-season-sub" data-season-sub="trade">
                 ${iconSvg('clock', 12)}
                 <span>${esc(hp.countdownText)}</span>
               </button>`
            : ''
        }
      `;
    }
  }
}

function renderNavTabs() {
  document.querySelectorAll('.nav-tab-btn').forEach(btn => {
    const tab = btn.getAttribute('data-nav-tab');
    btn.classList.toggle('active', tab === state.activeNavTab);
  });
}

function renderMain() {
  if (!state.appData) return;
  const mainEl = document.getElementById('mainView');
  if (!mainEl) return;

  const bannerEl = document.getElementById('phaseBanner');
  if (bannerEl && mainEl.contains(bannerEl)) {
    mainEl.parentNode?.insertBefore(bannerEl, mainEl);
  }

  closeJargonPopover();
  registerRosterPlayersForInlineLinks(state.appData?.roster?.players);

  const sortedCapYears = Object.keys(state.appData.cap?.years || {}).sort();
  const primaryCapYear = sortedCapYears[0] || '2026';
  const activeCapYear =
    state.capSelectedYear && state.appData.cap?.years?.[state.capSelectedYear]
      ? String(state.capSelectedYear)
      : primaryCapYear;
  state.capSelectedYear = activeCapYear;

  const tab = state.activeNavTab;
  const reportersMap =
    tab === 'home' || tab === 'news' || (tab === 'season' && state.seasonSubTab === 'health')
      ? getReportersMap()
      : null;

  preserveFocusAroundRender(() => {
    if (tab === 'home') {
      const filteredRawItems = filterNewsByUserPrefs(
        state.appData.news?.rawStream || [],
        reportersMap,
        state.prefs
      );
      const homeSimCapResult = simulateCapScenario(
        state.appData.cap,
        getCapMovesForYear(primaryCapYear),
        { baseYear: primaryCapYear }
      );
      const mcSimResult = getMonteCarloResult();
      const orderedBlocks = resolveOrderedDashboardBlocks(
        state.seasonState.activeBlocks,
        state.prefs.dashboardOrder
      );
      mainEl.innerHTML = renderHomeDashboardHtml({
        orderedBlocks,
        archivedBlocks: state.seasonState.archivedBlocks,
        appData: state.appData,
        simCapResult: homeSimCapResult,
        mcSimResult,
        filteredRawItems,
        isCustomizingLayout: state.isCustomizingLayout
      });
    } else if (tab === 'news') {
      const filteredRawItems = filterNewsByUserPrefs(
        state.appData.news?.rawStream || [],
        reportersMap,
        state.prefs
      );
      mainEl.innerHTML = renderNewsViewHtml({
        appData: state.appData,
        newsCategoryFilter: state.newsCategoryFilter,
        filteredRawItems,
        reportersById: reportersMap,
        activeVideosSet: state.activeVideosSet,
        userPrefs: state.prefs,
        lastWireSyncAt: state.lastWireSyncAt || state.appData.meta?.updatedAt,
        isSyncingWire: state.isSyncingWire
      });
    } else if (tab === 'roster') {
      const activeYearMoves = getCapMovesForYear(activeCapYear);
      const rosterSimCapResult = simulateCapScenario(state.appData.cap, activeYearMoves, { baseYear: activeCapYear });
      mainEl.innerHTML = renderRosterCapViewHtml({
        subTab: state.rosterSubTab,
        rosterSearch: state.rosterSearch,
        rosterUnitFilter: state.rosterUnitFilter,
        rosterPosFilter: state.rosterPosFilter,
        rosterSort: state.rosterSort,
        rosterSortDir: state.rosterSortDir,
        depthMode: state.depthMode,
        capSelectedYear: activeCapYear,
        appData: state.appData,
        simCapResult: rosterSimCapResult,
        userCapMoves: activeYearMoves
      });
    } else if (tab === 'season') {
      const mcSimResult =
        state.seasonSubTab === 'playoffs' || state.seasonSubTab === 'schedule'
          ? getMonteCarloResult()
          : null;
      mainEl.innerHTML = renderSeasonMatchupViewHtml({
        seasonSub: state.seasonSubTab,
        activePhases: state.seasonState.activePhases,
        appData: state.appData,
        mcSimResult,
        forcedWinners: state.prefs.playoffForcedWinners,
        combineSearch: state.combineSearch,
        expandedDraftSpiderIdx: state.expandedDraftSpiderIdx,
        activeVideosSet: state.activeVideosSet,
        schedulePrevExpanded: state.schedulePrevExpanded,
        expandedRootingWeeks: state.expandedRootingWeeks,
        matchupStatsUnit: state.matchupStatsUnit,
        userPrefs: state.prefs,
        reportersById: reportersMap
      });
    } else if (tab === 'audio') {
      mainEl.innerHTML = renderAudioAiViewHtml({
        appData: state.appData,
        userPrefs: state.prefs,
        studioSub: state.studioSubTab,
        beatPodViewMode: state.beatPodViewMode,
        beatPodShowFilter: state.beatPodShowFilter,
        podDurationMin: state.podDurationMin,
        podFormat: state.podFormat,
        podTopicDraft: state.podTopicDraft,
        analysisPromptDraft: state.analysisPromptDraft,
        jobStatus: state.jobStatus,
        allEpisodes: getActiveEpisodes(),
        archivedEpisodes: getArchivedEpisodes(),
        podLibraryFilter: state.podLibraryFilter,
        allAnalyses: getActiveAnalyses(),
        archivedAnalyses: getArchivedAnalyses(),
        analysisLibraryFilter: state.analysisLibraryFilter,
        audioState: state.audioState,
        expandedTranscriptIds: state.expandedTranscriptIds,
        shareToastTargetId: state.shareToastTargetId,
        geminiKeyNotice: state.geminiKeyNotice,
        showGeminiKeyGuide: state.showGeminiKeyGuide
      });
    }
  });

  if (bannerEl && state.activeNavTab === 'season') {
    const subnavEl = mainEl.querySelector('.subnav-card');
    if (subnavEl) {
      subnavEl.insertAdjacentElement('afterend', bannerEl);
    }
  }

  renderHeaderAndPhaseBanner();
  renderNavTabs();
}

function closeStatRankModal() {
  state.rankModal = null;
  const backdrop = document.getElementById('statRankModalBackdrop');
  const body = document.getElementById('rankModalBody');
  if (backdrop) backdrop.hidden = true;
  if (body) body.innerHTML = '';
}

function renderStatRankModal() {
  const backdrop = document.getElementById('statRankModalBackdrop');
  const eyebrow = document.getElementById('rankModalEyebrow');
  const title = document.getElementById('rankModalTitle');
  const body = document.getElementById('rankModalBody');
  if (!backdrop || !body) return;

  if (!state.rankModal) {
    backdrop.hidden = true;
    body.innerHTML = '';
    return;
  }

  const model = resolveLeaderboardModalModel({
    appData: state.appData,
    scope: state.rankModal.scope,
    key: state.rankModal.key,
    playerId: state.rankModal.playerId
  });

  if (!model || !model.rows?.length) {
    closeStatRankModal();
    return;
  }

  if (eyebrow) eyebrow.textContent = model.eyebrow;
  if (title) title.textContent = model.title;

  const totalRows = model.rows.length;
  const rowsHtml = [];

  model.rows.forEach((r, idx) => {
    const scaled32 = Math.max(1, Math.min(32, Math.round((r.rank / Math.max(1, totalRows)) * 32)));
    const meterColor = scaled32 <= 8 ? 'emerald' : scaled32 <= 18 ? 'gold' : 'scarlet';
    const visualThumb =
      model.scope === 'team'
        ? renderTeamLogoHtml(r.id, r.logoUrl, 26)
        : renderPlayerAvatarHtml({ name: r.title, headshotUrl: r.headshotUrl }, 28);

    const nameHtml =
      r.is49erTeammate && r.sfPlayerId
        ? `<button type="button" class="inline-player-link" style="background:none;border:0;padding:0;font:inherit;text-align:left" data-action="open-player-from-rank-modal" data-player-id="${esc(r.sfPlayerId)}"><strong>${esc(r.title)}</strong></button>`
        : r.extUrl
          ? `<a href="${esc(r.extUrl)}" target="_blank" rel="noopener noreferrer" class="ext-link"><strong>${esc(r.title)}</strong></a>`
          : `<strong>${esc(r.title)}</strong>`;

    rowsHtml.push(`
      <div class="rank-modal-row ${r.isHighlighted ? 'highlighted' : ''}" ${r.isHighlighted ? 'data-rank-highlight="true"' : ''} data-rank-num="${r.rank}">
        <div class="rank-modal-left">
          <span class="badge ${rankBadgeClass(scaled32)} mono rank-modal-num">#${r.rank}</span>
          ${visualThumb}
          <div class="rank-modal-meta">
            <div class="rank-modal-name">${nameHtml}</div>
            <div class="rank-modal-sub mono">${esc(r.subtitle)}</div>
          </div>
        </div>
        <div class="rank-modal-right">
          <div class="rank-modal-val mono"><strong>${esc(r.displayValue)}</strong></div>
          ${renderMiniMeterHtml(r.barPct, meterColor)}
        </div>
      </div>
    `);

    if (idx === model.avgInsertAfterIdx && idx < model.rows.length - 1) {
      rowsHtml.push(`
        <div class="rank-modal-avg-divider" data-rank-avg-divider="true">
          <span class="mono">${esc(model.avgLabel)}</span>
        </div>
      `);
    }
  });

  body.innerHTML = `<div class="rank-modal-list">${rowsHtml.join('')}</div>`;
  backdrop.hidden = false;

  requestAnimationFrame(() => {
    const hl = body.querySelector('[data-rank-highlight="true"]');
    if (hl && typeof hl.scrollIntoView === 'function') {
      hl.scrollIntoView({ block: 'center', behavior: 'instant' });
    } else {
      body.scrollTop = 0;
    }
  });
}

function renderSheet() {
  const backdrop = document.getElementById('bottomSheetBackdrop');
  const eyebrow = document.getElementById('sheetEyebrow');
  const title = document.getElementById('sheetTitle');
  const body = document.getElementById('sheetBody');
  if (!backdrop || !body) return;

  if (!state.sheetMode) {
    backdrop.hidden = true;
    return;
  }

  backdrop.hidden = false;

  preserveFocusAroundRender(() => {
    registerRosterPlayersForInlineLinks(state.appData?.roster?.players);
    if (state.sheetMode === 'player') {
      const player = getPlayerById(state.sheetPlayerId);
      if (eyebrow) eyebrow.textContent = player ? `${player.position} • #${player.jersey ?? '—'}` : 'Player Dossier';
      if (title) title.textContent = player ? player.name : 'Player Dossier';
      body.innerHTML = renderPlayerDossierSheetHtml({
        player,
        activeTab: state.sheetPlayerTab,
        statsMode: state.sheetPlayerStatsMode,
        txScenario: state.sheetPlayerTxScenario,
        rawStream: state.appData?.news?.rawStream || [],
        appData: state.appData,
        userPrefs: state.prefs,
        reportersById: getReportersMap()
      });
    } else if (state.sheetMode === 'settings') {
      if (eyebrow) eyebrow.textContent = 'Preferences';
      if (title) title.textContent = 'Settings';
      body.innerHTML = renderSettingsSheetHtml({
        userPrefs: state.prefs,
        reportersData: state.appData?.reporters,
        reporterSearch: state.reporterSearch
      });
    } else if (state.sheetMode === 'vault') {
      if (eyebrow) eyebrow.textContent = 'Off-Cycle & Saved Items';
      if (title) title.textContent = 'Archive';
      body.innerHTML = renderArchiveVaultSheetHtml({
        seasonState: state.seasonState,
        appData: state.appData,
        archivedEpisodes: getArchivedEpisodes(),
        archivedAnalyses: getArchivedAnalyses()
      });
    }
  });
}

function renderMiniPlayer(audioSnapshot) {
  const prevEpId = state.audioState?.episode?.id || null;
  const prevPlaying = Boolean(state.audioState?.isPlaying);
  const nextEpId = audioSnapshot?.episode?.id || null;
  const nextPlaying = Boolean(audioSnapshot?.isPlaying);
  state.audioState = audioSnapshot || {};
  const miniEl = document.getElementById('miniPlayer');
  if (!miniEl) return;

  if (!audioSnapshot?.episode) {
    miniEl.hidden = true;
    document.body.classList.remove('has-mini-player');
    if (prevEpId && state.activeNavTab === 'audio' && state.studioSubTab === 'podcast') {
      renderMain();
    }
    return;
  }

  miniEl.hidden = false;
  document.body.classList.add('has-mini-player');

  // Keep Ready-to-Play / Library cards in sync when episode or play/pause state changes
  if (
    (prevEpId !== nextEpId || prevPlaying !== nextPlaying) &&
    state.activeNavTab === 'audio' &&
    state.studioSubTab === 'podcast' &&
    !state.jobStatus?.active
  ) {
    renderMain();
  }

  const titleEl = document.getElementById('miniPlayerTitle');
  const timeEl = document.getElementById('miniPlayerTime');
  const playBtn = document.getElementById('mpPlayPauseBtn');
  const speedBtn = document.getElementById('mpSpeedBtn');

  if (titleEl) titleEl.textContent = audioSnapshot.episode.title;
  if (timeEl) {
    timeEl.textContent = `${formatTimeMmSs(audioSnapshot.currentTimeSec)} / ${formatTimeMmSs(
      audioSnapshot.durationSec || audioSnapshot.episode.durationSec
    )}`;
  }
  if (playBtn) playBtn.innerHTML = iconSvg(audioSnapshot.isPlaying ? 'pause' : 'play', 14);
  if (speedBtn) speedBtn.textContent = `${audioSnapshot.playbackRate}x`;
  const waveEl = miniEl.querySelector('.mini-player-wave');
  if (waveEl) waveEl.classList.toggle('playing', Boolean(audioSnapshot.isPlaying));

  // Update active transcript turn highlight in place for the currently loaded episode
  if (state.activeNavTab === 'audio' && state.studioSubTab === 'podcast' && nextEpId) {
    const drawer = document.querySelector(`[data-transcript-for="${CSS.escape(nextEpId)}"]`);
    if (drawer) {
      drawer.querySelectorAll('.transcript-turn').forEach((el, idx) => {
        el.classList.toggle('active-turn', idx === audioSnapshot.activeTurnIdx);
      });
    }
  }
}

function moveDashboardBlock(blockId, direction) {
  const currentOrdered = resolveOrderedDashboardBlocks(
    state.seasonState.activeBlocks,
    state.prefs.dashboardOrder
  ).map(b => b.id);

  const idx = currentOrdered.indexOf(blockId);
  if (idx === -1) return;
  const targetIdx = idx + direction;
  if (targetIdx < 0 || targetIdx >= currentOrdered.length) return;

  const swapped = [...currentOrdered];
  const [removed] = swapped.splice(idx, 1);
  swapped.splice(targetIdx, 0, removed);

  state.prefs.dashboardOrder = swapped;
  saveUserPrefs(state.prefs);
  renderMain();
}

function reorderBlockBeforeTarget(draggedId, targetId) {
  if (!draggedId || !targetId || draggedId === targetId) return;
  const currentOrdered = resolveOrderedDashboardBlocks(
    state.seasonState.activeBlocks,
    state.prefs.dashboardOrder
  ).map(b => b.id);

  const fromIdx = currentOrdered.indexOf(draggedId);
  const toIdx = currentOrdered.indexOf(targetId);
  if (fromIdx === -1 || toIdx === -1) return;

  const next = [...currentOrdered];
  const [moved] = next.splice(fromIdx, 1);
  next.splice(toIdx, 0, moved);

  state.prefs.dashboardOrder = next;
  saveUserPrefs(state.prefs);
  renderMain();
}

function triggerDailyMatchupIntelSync() {
  if (!state.appData) return Promise.resolve(null);
  return refreshDailyMatchupIntelIfDue({
    appData: state.appData,
    prefs: state.prefs
  })
    .then(res => {
      if (
        res?.updated &&
        (state.activeNavTab === 'home' ||
          (state.activeNavTab === 'season' && state.seasonSubTab === 'matchup'))
      ) {
        renderMain();
      }
      return res;
    })
    .catch(() => null);
}

function triggerDailyTopNewsBriefSync() {
  if (!state.appData) return Promise.resolve(null);
  return refreshDailyTopNewsBriefIfDue({
    appData: state.appData,
    prefs: state.prefs
  })
    .then(res => {
      if (res?.updated && (state.activeNavTab === 'home' || state.activeNavTab === 'news')) {
        renderMain();
      }
      return res;
    })
    .catch(() => null);
}

function bindEvents() {
  // Bottom Nav Tabs
  document.querySelectorAll('.nav-tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      state.activeNavTab = btn.getAttribute('data-nav-tab') || 'home';
      window.scrollTo({ top: 0, behavior: 'instant' });
      if (!state.appData) {
        renderNavTabs();
        bootOrRecoverAppData({ manual: true });
        return;
      }
      if (state.activeNavTab === 'audio' && state.prefs.geminiApiKey) {
        checkAndAutoUpdateBestGeminiModel(state.prefs, () => {
          saveUserPrefs(state.prefs);
          renderMain();
        });
      }
      if (state.activeNavTab === 'season' && state.seasonSubTab === 'matchup') {
        triggerDailyMatchupIntelSync();
      }
      if (state.activeNavTab === 'news' || state.activeNavTab === 'home') {
        triggerDailyTopNewsBriefSync();
      }
      renderMain();
    });
  });

  // Top Header triggers
  document.getElementById('brandHomeTrigger')?.addEventListener('click', () => {
    state.activeNavTab = 'home';
    window.scrollTo({ top: 0, behavior: 'instant' });
    renderMain();
  });

  document.getElementById('openSettingsBtn')?.addEventListener('click', () => {
    state.sheetMode = 'settings';
    renderSheet();
  });

  document.getElementById('openArchiveBtn')?.addEventListener('click', () => {
    state.sheetMode = 'vault';
    renderSheet();
  });

  document.getElementById('closeSheetBtn')?.addEventListener('click', () => {
    state.sheetMode = null;
    renderSheet();
  });

  document.getElementById('bottomSheetBackdrop')?.addEventListener('click', e => {
    if (e.target.id === 'bottomSheetBackdrop') {
      state.sheetMode = null;
      renderSheet();
    }
  });

  document.getElementById('statRankModalBackdrop')?.addEventListener('click', e => {
    if (e.target.id === 'statRankModalBackdrop') {
      closeStatRankModal();
    }
  });

  document.addEventListener('keydown', e => {
    const pop = document.getElementById('jargonPopover');
    if (e.key === 'Escape' && pop && !pop.hidden) {
      closeJargonPopover();
      return;
    }
    if (e.key === 'Escape' && state.rankModal) {
      closeStatRankModal();
      return;
    }
    if ((e.key === 'Enter' || e.key === ' ') && e.target?.closest?.('[data-jargon]')) {
      const jt = e.target.closest('[data-jargon]');
      e.preventDefault();
      e.stopPropagation();
      openJargonPopover(jt, jt.getAttribute('data-jargon'));
      return;
    }
    if (
      (e.key === 'Enter' || e.key === ' ') &&
      e.target?.getAttribute?.('role') === 'button' &&
      e.target?.hasAttribute?.('data-action')
    ) {
      e.preventDefault();
      e.target.click();
      return;
    }
    if (e.key === 'Enter' && e.target?.id === 'inlineGeminiApiKeyInput') {
      e.preventDefault();
      document.querySelector('[data-action="save-inline-gemini-key"]')?.click();
      return;
    }
    if (e.key === 'Escape' && state.sheetMode) {
      state.sheetMode = null;
      renderSheet();
    }
  });

  window.addEventListener('resize', () => closeJargonPopover(), { passive: true });
  document.addEventListener(
    'scroll',
    e => {
      if (e.target && e.target.closest && e.target.closest('#jargonPopover')) return;
      closeJargonPopover();
    },
    { passive: true, capture: true }
  );

  document.addEventListener(
    'toggle',
    e => {
      if (e.target?.matches?.('[data-schedule-previous-games]')) {
        state.schedulePrevExpanded = Boolean(e.target.open);
      }
    },
    true
  );

  // Sticky Mini-Player Controls
  document.getElementById('miniPlayerExpandTrigger')?.addEventListener('click', () => {
    state.activeNavTab = 'audio';
    state.studioSubTab = 'podcast';
    renderMain();
  });
  document.getElementById('mpPlayPauseBtn')?.addEventListener('click', () => {
    audioController?.primeForUserGesture();
    audioController?.togglePlayPause();
  });
  document.getElementById('mpBack15Btn')?.addEventListener('click', () => audioController?.skip(-15));
  document.getElementById('mpFwd30Btn')?.addEventListener('click', () => audioController?.skip(30));
  document.getElementById('mpSpeedBtn')?.addEventListener('click', () => audioController?.cycleSpeed());
  document.getElementById('mpCloseBtn')?.addEventListener('click', () => audioController?.closePlayer());

  // Delegated Click Handler across Main View, Jargon Bubbles & Bottom Sheet
  document.addEventListener('click', async e => {
    const closePop = e.target.closest('[data-action="close-jargon-popover"]');
    if (closePop) {
      e.preventDefault();
      e.stopPropagation();
      closeJargonPopover();
      return;
    }

    const jargonTrigger = e.target.closest('[data-jargon]');
    if (jargonTrigger) {
      e.preventDefault();
      e.stopPropagation();
      openJargonPopover(jargonTrigger, jargonTrigger.getAttribute('data-jargon'));
      return;
    }

    const pop = document.getElementById('jargonPopover');
    if (pop && !pop.hidden && !e.target.closest('#jargonPopover')) {
      closeJargonPopover();
    }

    const anchorHit = e.target.closest('a[href]');
    const btn = e.target.closest('[data-action]');
    if (anchorHit && (!btn || btn.contains(anchorHit))) return;
    if (!btn) return;
    if (anchorHit) e.preventDefault();
    const action = btn.getAttribute('data-action');

    switch (action) {
      case 'toggle-customize-layout':
        state.isCustomizingLayout = !state.isCustomizingLayout;
        renderMain();
        break;

      case 'reset-dashboard-order':
        state.prefs.dashboardOrder = [];
        saveUserPrefs(state.prefs);
        renderMain();
        break;

      case 'move-block-up':
        moveDashboardBlock(btn.getAttribute('data-block-id'), -1);
        break;

      case 'move-block-down':
        moveDashboardBlock(btn.getAttribute('data-block-id'), 1);
        break;

      case 'go-home':
        state.activeNavTab = 'home';
        window.scrollTo({ top: 0, behavior: 'instant' });
        renderMain();
        break;

      case 'jump-view':
        state.activeNavTab = btn.getAttribute('data-target-tab') || 'home';
        window.scrollTo({ top: 0, behavior: 'instant' });
        if (state.activeNavTab === 'news' || state.activeNavTab === 'home') {
          triggerDailyTopNewsBriefSync();
        }
        renderMain();
        break;

      case 'jump-studio-sub':
        state.activeNavTab = 'audio';
        state.studioSubTab = btn.getAttribute('data-studio-sub') || 'beat_podcasts';
        window.scrollTo({ top: 0, behavior: 'instant' });
        renderMain();
        break;

      case 'jump-roster-sub':
        state.activeNavTab = 'roster';
        state.rosterSubTab = btn.getAttribute('data-roster-sub') || 'roster';
        window.scrollTo({ top: 0, behavior: 'instant' });
        renderMain();
        break;

      case 'jump-season-sub': {
        const nextSeasonSub = btn.getAttribute('data-season-sub') || 'matchup';
        if (nextSeasonSub === 'schedule') state.schedulePrevExpanded = false;
        state.activeNavTab = 'season';
        state.seasonSubTab = nextSeasonSub;
        window.scrollTo({ top: 0, behavior: 'instant' });
        renderMain();
        break;
      }

      case 'open-vault-module':
        state.sheetMode = null;
        renderSheet();
        state.activeNavTab = 'season';
        state.seasonSubTab = btn.getAttribute('data-season-sub') || 'draft_class';
        window.scrollTo({ top: 0, behavior: 'instant' });
        renderMain();
        break;

      case 'open-dashboard-block': {
        const bid = btn.getAttribute('data-block-id') || '';
        state.sheetMode = null;
        renderSheet();
        const seasonMap = {
          upcoming_matchup: 'matchup',
          team_health: 'health',
          schedule_overview: 'schedule',
          team_stats: 'stats',
          trade_deadline: 'trade',
          playoff_picture: 'playoffs',
          draft_prep: 'draft_prep',
          draft_live_udfa: 'draft_class'
        };
        if (bid === 'news_briefs') {
          state.activeNavTab = 'news';
        } else if (bid === 'roster_depth') {
          state.activeNavTab = 'roster';
          state.rosterSubTab = 'roster';
        } else if (bid === 'salary_cap') {
          state.activeNavTab = 'roster';
          state.rosterSubTab = 'cap';
        } else if (bid === 'autopodcast_ai') {
          state.activeNavTab = 'audio';
        } else if (seasonMap[bid]) {
          if (seasonMap[bid] === 'schedule') state.schedulePrevExpanded = false;
          state.activeNavTab = 'season';
          state.seasonSubTab = seasonMap[bid];
        } else {
          state.activeNavTab = 'home';
        }
        window.scrollTo({ top: 0, behavior: 'instant' });
        renderMain();
        break;
      }

      case 'open-settings':
        state.sheetMode = 'settings';
        renderSheet();
        break;

      case 'open-archive':
        state.sheetMode = 'vault';
        renderSheet();
        break;

      case 'close-sheet':
        state.sheetMode = null;
        renderSheet();
        break;

      case 'set-news-category': {
        const reqCat = btn.getAttribute('data-category') || 'all';
        state.newsCategoryFilter = VALID_NEWS_CATEGORIES.has(reqCat) ? reqCat : 'all';
        renderMain();
        break;
      }

      case 'play-inline-video': {
        const key = btn.getAttribute('data-vid-key');
        if (key) {
          state.activeVideosSet.add(key);
          renderMain();
        }
        break;
      }

      case 'set-roster-sub':
        state.rosterSubTab = btn.getAttribute('data-roster-sub') || 'roster';
        renderMain();
        break;

      case 'set-roster-unit':
        state.rosterUnitFilter = btn.getAttribute('data-unit') || 'All';
        renderMain();
        break;

      case 'set-roster-pos':
        state.rosterPosFilter = btn.getAttribute('data-pos') || 'ALL';
        renderMain();
        break;

      case 'set-roster-sort': {
        const nextField = btn.getAttribute('data-sort-field') || 'name';
        const cur = normalizeRosterSort(state.rosterSort, state.rosterSortDir);
        if (cur.field === nextField) {
          state.rosterSortDir = cur.dir === 'asc' ? 'desc' : 'asc';
        } else {
          const def = ROSTER_SORT_FIELDS.find(f => f.key === nextField);
          state.rosterSort = nextField;
          state.rosterSortDir = def?.defaultDir || 'asc';
        }
        renderMain();
        break;
      }

      case 'toggle-roster-sort-dir': {
        const cur = normalizeRosterSort(state.rosterSort, state.rosterSortDir);
        state.rosterSort = cur.field;
        state.rosterSortDir = cur.dir === 'asc' ? 'desc' : 'asc';
        renderMain();
        break;
      }

      case 'set-depth-mode':
        state.depthMode = btn.getAttribute('data-depth-mode') || 'projected';
        renderMain();
        break;

      case 'set-cap-year': {
        const nextYr = btn.getAttribute('data-cap-year');
        if (nextYr && state.appData?.cap?.years?.[nextYr]) {
          state.capSelectedYear = String(nextYr);
          state.prefs.capSelectedYear = String(nextYr);
          saveUserPrefs(state.prefs);
          renderMain();
        }
        break;
      }

      case 'open-player':
      case 'open-player-sheet': {
        const pid = btn.getAttribute('data-player-id');
        const player = getPlayerById(pid);
        if (player) {
          state.sheetMode = 'player';
          state.sheetPlayerId = player.id;
          state.sheetPlayerTab = btn.getAttribute('data-initial-tab') || 'overview';
          renderSheet();
        }
        break;
      }

      case 'set-player-tab':
        state.sheetPlayerTab = btn.getAttribute('data-player-tab') || 'overview';
        renderSheet();
        break;

      case 'set-player-stats-mode':
        state.sheetPlayerStatsMode = btn.getAttribute('data-stats-mode') || '2026';
        renderSheet();
        break;

      case 'set-player-tx-scenario':
        state.sheetPlayerTxScenario = btn.getAttribute('data-tx') || 'cut';
        renderSheet();
        break;

      case 'apply-ai-cap-blueprint': {
        const targetYr = state.capSelectedYear || '2026';
        const nextMoves = {};
        for (const r of (state.appData?.cap?.blueprint?.restructureCandidates || []).slice(0, 2)) {
          const p = (state.appData?.cap?.players || []).find(x => x.id === r.id);
          if (!p || p.contractsByYear?.[targetYr]?.transactions?.restructure?.capSavings > 0) {
            nextMoves[r.id] = 'restructure';
          }
        }
        if (Object.keys(nextMoves).length === 0) {
          state.capSelectedYear = '2026';
          state.prefs.capSelectedYear = '2026';
          for (const r of (state.appData?.cap?.blueprint?.restructureCandidates || []).slice(0, 2)) {
            nextMoves[r.id] = 'restructure';
          }
          setCapMovesForYear('2026', nextMoves);
        } else {
          setCapMovesForYear(targetYr, nextMoves);
        }
        saveUserPrefs(state.prefs);
        renderMain();
        break;
      }

      case 'reset-cap-moves': {
        const targetYr = state.capSelectedYear || '2026';
        setCapMovesForYear(targetYr, {});
        saveUserPrefs(state.prefs);
        renderMain();
        break;
      }

      case 'set-season-sub': {
        const nextSeasonSub = btn.getAttribute('data-season-sub') || 'matchup';
        if (nextSeasonSub === 'schedule') state.schedulePrevExpanded = false;
        state.seasonSubTab = nextSeasonSub;
        if (nextSeasonSub === 'matchup') {
          triggerDailyMatchupIntelSync();
        }
        renderMain();
        break;
      }

      case 'set-matchup-stats-unit': {
        state.matchupStatsUnit = btn.getAttribute('data-unit-id') || 'offense';
        renderMain();
        break;
      }

      case 'open-stat-rank-modal': {
        const scope = btn.getAttribute('data-rank-scope') || 'team';
        const key = btn.getAttribute('data-rank-key') || '';
        const playerId = btn.getAttribute('data-player-id') || state.sheetPlayerId || null;
        if (key) {
          closeJargonPopover();
          state.rankModal = { scope, key, playerId };
          renderStatRankModal();
        }
        break;
      }

      case 'close-stat-rank-modal':
        closeStatRankModal();
        break;

      case 'open-player-from-rank-modal': {
        const pid = btn.getAttribute('data-player-id');
        const targetPlayer = getPlayerById(pid);
        closeStatRankModal();
        if (targetPlayer) {
          state.sheetMode = 'player';
          state.sheetPlayerId = targetPlayer.id;
          state.sheetPlayerTab = 'stats';
          renderSheet();
        }
        break;
      }

      case 'toggle-playoff-winner': {
        const gid = btn.getAttribute('data-game-id');
        const side = btn.getAttribute('data-side');
        if (gid && (side === 'HOME' || side === 'AWAY')) {
          if (state.prefs.playoffForcedWinners[gid] === side) {
            delete state.prefs.playoffForcedWinners[gid];
          } else {
            state.prefs.playoffForcedWinners[gid] = side;
          }
          saveUserPrefs(state.prefs);
          renderMain();
        }
        break;
      }

      case 'reset-playoff-overrides':
        state.prefs.playoffForcedWinners = {};
        saveUserPrefs(state.prefs);
        renderMain();
        break;

      case 'toggle-draft-spider': {
        const idx = Number(btn.getAttribute('data-draft-idx'));
        state.expandedDraftSpiderIdx = state.expandedDraftSpiderIdx === idx ? -1 : idx;
        renderMain();
        break;
      }

      case 'set-studio-sub':
        state.studioSubTab = btn.getAttribute('data-studio-sub') || 'podcast';
        state.jobStatus = null;
        renderMain();
        break;

      case 'set-beat-pod-view':
        state.beatPodViewMode = btn.getAttribute('data-pod-view') || 'date';
        renderMain();
        break;

      case 'set-beat-pod-show-filter':
        state.beatPodShowFilter = btn.getAttribute('data-show-id') || 'all';
        renderMain();
        break;

      case 'sync-live-wire-now':
        await pollLowLatencyTweetAndInjuryWire(true);
        break;

      case 'set-pod-duration':
        state.podDurationMin = Number(btn.getAttribute('data-mins') || 3);
        renderMain();
        break;

      case 'set-pod-format': {
        const nextFmt = btn.getAttribute('data-format') === 'solo' ? 'solo' : 'two_host';
        state.podFormat = nextFmt;
        state.prefs.podFormat = nextFmt;
        saveUserPrefs(state.prefs);
        if (state.sheetMode === 'settings') renderSheet();
        renderMain();
        break;
      }

      case 'fill-pod-topic':
        state.podTopicDraft = btn.getAttribute('data-topic') || '';
        renderMain();
        break;

      case 'fill-analysis-prompt':
        state.analysisPromptDraft = btn.getAttribute('data-prompt') || '';
        renderMain();
        break;

      case 'analyze-topic-jump':
        state.activeNavTab = 'audio';
        state.studioSubTab = 'analysis';
        state.analysisPromptDraft = btn.getAttribute('data-prompt') || '';
        window.scrollTo({ top: 0, behavior: 'instant' });
        renderMain();
        break;

      case 'play-episode': {
        audioController?.primeForUserGesture();
        const epId = btn.getAttribute('data-episode-id');
        const ep = getAllEpisodes().find(x => x.id === epId);
        if (ep) {
          if (state.audioState?.episode?.id === ep.id) {
            await audioController.togglePlayPause();
          } else {
            await audioController.loadAndPlay(ep, 0);
          }
          renderMain();
        }
        break;
      }

      case 'seek-podcast-turn': {
        audioController?.primeForUserGesture();
        const sec = Number(btn.getAttribute('data-seek-sec') || 0);
        const turnEpId = btn.getAttribute('data-episode-id');
        if (turnEpId && state.audioState?.episode?.id !== turnEpId) {
          const targetEp = getAllEpisodes().find(x => x.id === turnEpId);
          if (targetEp) {
            await audioController.loadAndPlay(targetEp, sec);
            renderMain();
            break;
          }
        }
        audioController?.seekTo(sec);
        break;
      }

      case 'toggle-podcast-transcript': {
        const epId = btn.getAttribute('data-episode-id');
        if (epId) {
          if (state.expandedTranscriptIds.has(epId)) {
            state.expandedTranscriptIds.delete(epId);
          } else {
            state.expandedTranscriptIds.add(epId);
          }
          renderMain();
        }
        break;
      }

      case 'share-podcast': {
        const epId = btn.getAttribute('data-episode-id');
        const ep =
          getAllEpisodes().find(x => x.id === epId) ||
          (state.audioState?.episode?.id === epId ? state.audioState.episode : null);
        if (ep) {
          const shareUrl = await buildShareablePodcastUrl(ep, window.location);
          window.__lastSharedUrl = shareUrl;
          const shareRes = await shareItemNatively({
            title: `49ers Faithful Podcast: ${ep.title}`,
            text: `Listen to "${ep.title}" (${formatTimeMmSs(ep.durationSec)}) on 49ers Faithful:`,
            url: shareUrl
          });
          if (shareRes.method === 'clipboard') {
            state.shareToastTargetId = ep.id;
            renderMain();
            setTimeout(() => {
              if (state.shareToastTargetId === ep.id) {
                state.shareToastTargetId = null;
                renderMain();
              }
            }, 2400);
          }
        }
        break;
      }

      case 'share-analysis': {
        const analysisId = btn.getAttribute('data-analysis-id');
        const rep = getAllAnalyses().find(x => x.id === analysisId);
        if (rep) {
          const shareUrl = await buildShareableAnalysisUrl(rep, window.location);
          window.__lastSharedUrl = shareUrl;
          const shareRes = await shareItemNatively({
            title: `49ers Scouting & Cap Brief: ${rep.title}`,
            text: `Read "${rep.title}" on 49ers Faithful:`,
            url: shareUrl
          });
          if (shareRes.method === 'clipboard') {
            state.shareToastTargetId = rep.id;
            renderMain();
            setTimeout(() => {
              if (state.shareToastTargetId === rep.id) {
                state.shareToastTargetId = null;
                renderMain();
              }
            }, 2400);
          }
        }
        break;
      }

      case 'toggle-gemini-key-guide': {
        const podInp = document.getElementById('podTopicInput');
        if (podInp) state.podTopicDraft = podInp.value;
        const anInp = document.getElementById('analysisPromptInput');
        if (anInp) state.analysisPromptDraft = anInp.value;
        state.showGeminiKeyGuide = !state.showGeminiKeyGuide;
        renderMain();
        break;
      }

      case 'focus-inline-gemini-key': {
        const keyInput = document.getElementById('inlineGeminiApiKeyInput');
        if (keyInput) {
          keyInput.scrollIntoView({ behavior: 'smooth', block: 'center' });
          keyInput.focus();
        }
        break;
      }

      case 'save-inline-gemini-key': {
        const keyInput = document.getElementById('inlineGeminiApiKeyInput');
        const rawKey = String(keyInput?.value || '').trim();
        if (!rawKey) {
          state.geminiKeyNotice = 'Paste your Gemini API Key from Google AI Studio first.';
          renderMain();
          document.getElementById('inlineGeminiApiKeyInput')?.focus();
          break;
        }
        btn.disabled = true;
        btn.innerHTML = `${iconSvg('loader', 14, 'btn-spin-icon')}<span>Verifying…</span>`;
        try {
          const verified = await verifyGeminiApiKey(rawKey, state.prefs.geminiApiBaseUrl);
          state.prefs.geminiApiKey = rawKey;
          state.prefs.verifiedGeminiModel = verified.bestModel || '';
          saveUserPrefs(state.prefs);
          state.geminiKeyNotice = '';
          state.showGeminiKeyGuide = false;
          if (state.jobStatus?.error) state.jobStatus = null;
          triggerDailyMatchupIntelSync().finally(() => triggerDailyTopNewsBriefSync());
          renderMain();
        } catch (err) {
          state.geminiKeyNotice = err.message || 'Unable to verify Gemini API Key.';
          renderMain();
        }
        break;
      }

      case 'clear-gemini-key': {
        state.prefs.geminiApiKey = '';
        state.prefs.verifiedGeminiModel = '';
        saveUserPrefs(state.prefs);
        state.geminiKeyNotice = '';
        renderSheet();
        renderMain();
        break;
      }

      case 'set-pod-library-filter': {
        state.podLibraryFilter =
          btn.getAttribute('data-filter') === 'archived' ? 'archived' : 'active';
        renderMain();
        break;
      }

      case 'archive-podcast': {
        const epId = btn.getAttribute('data-episode-id');
        if (epId) {
          const set = new Set(state.prefs.archivedEpisodeIds || []);
          set.add(epId);
          state.prefs.archivedEpisodeIds = Array.from(set);
          saveUserPrefs(state.prefs);
          renderMain();
          if (state.sheetMode === 'vault') renderSheet();
        }
        break;
      }

      case 'unarchive-podcast': {
        const epId = btn.getAttribute('data-episode-id');
        if (epId) {
          state.prefs.archivedEpisodeIds = (state.prefs.archivedEpisodeIds || []).filter(
            id => id !== epId
          );
          saveUserPrefs(state.prefs);
          renderMain();
          if (state.sheetMode === 'vault') renderSheet();
        }
        break;
      }

      case 'delete-podcast': {
        const epId = btn.getAttribute('data-episode-id');
        if (epId) {
          const delSet = new Set(state.prefs.deletedEpisodeIds || []);
          delSet.add(epId);
          state.prefs.deletedEpisodeIds = Array.from(delSet);
          state.prefs.archivedEpisodeIds = (state.prefs.archivedEpisodeIds || []).filter(
            id => id !== epId
          );
          state.prefs.localCustomEpisodes = (state.prefs.localCustomEpisodes || []).filter(
            ep => ep.id !== epId
          );
          state.expandedTranscriptIds.delete(epId);
          if (state.audioState?.episode?.id === epId) {
            audioController?.closePlayer();
          }
          saveUserPrefs(state.prefs);
          await deleteEpisodeAudioBlob(epId);
          renderMain();
          if (state.sheetMode === 'vault') renderSheet();
        }
        break;
      }

      case 'set-analysis-library-filter': {
        state.analysisLibraryFilter =
          btn.getAttribute('data-filter') === 'archived' ? 'archived' : 'active';
        renderMain();
        break;
      }

      case 'archive-analysis': {
        const analysisId = btn.getAttribute('data-analysis-id');
        if (analysisId) {
          const set = new Set(state.prefs.archivedAnalysisIds || []);
          set.add(analysisId);
          state.prefs.archivedAnalysisIds = Array.from(set);
          saveUserPrefs(state.prefs);
          renderMain();
          if (state.sheetMode === 'vault') renderSheet();
        }
        break;
      }

      case 'unarchive-analysis': {
        const analysisId = btn.getAttribute('data-analysis-id');
        if (analysisId) {
          state.prefs.archivedAnalysisIds = (state.prefs.archivedAnalysisIds || []).filter(
            id => id !== analysisId
          );
          saveUserPrefs(state.prefs);
          renderMain();
          if (state.sheetMode === 'vault') renderSheet();
        }
        break;
      }

      case 'delete-analysis': {
        const analysisId = btn.getAttribute('data-analysis-id');
        if (analysisId) {
          const delSet = new Set(state.prefs.deletedAnalysisIds || []);
          delSet.add(analysisId);
          state.prefs.deletedAnalysisIds = Array.from(delSet);
          state.prefs.archivedAnalysisIds = (state.prefs.archivedAnalysisIds || []).filter(
            id => id !== analysisId
          );
          state.prefs.localCustomAnalyses = (state.prefs.localCustomAnalyses || []).filter(
            a => a.id !== analysisId
          );
          saveUserPrefs(state.prefs);
          renderMain();
          if (state.sheetMode === 'vault') renderSheet();
        }
        break;
      }

      case 'retry-load-feeds': {
        bootOrRecoverAppData({ manual: true });
        break;
      }

      case 'generate-autopodcast': {
        const inputEl = document.getElementById('podTopicInput');
        if (inputEl) state.podTopicDraft = inputEl.value;
        if (!String(state.podTopicDraft || '').trim()) {
          state.jobStatus = {
            active: false,
            kind: 'podcast',
            error: 'Please enter or select a podcast topic.'
          };
          renderMain();
          break;
        }
        audioController?.primeForUserGesture();
        const startedAtMs = Date.now();
        const waitEst = estimateGenerationWait({
          kind: 'podcast',
          durationMinutes: state.podDurationMin,
          prefs: state.prefs,
          appData: state.appData
        });
        const modelInfo = resolveActiveHighQualityModelLabel(state.appData, state.prefs);
        const elapsedTicker = setInterval(() => {
          const clockEl = document.getElementById('jobElapsedClock');
          if (clockEl) {
            const sec = Math.max(0, Math.floor((Date.now() - startedAtMs) / 1000));
            clockEl.textContent = `Elapsed ${formatTimeMmSs(sec)}`;
          }
        }, 250);
        try {
          state.jobStatus = {
            active: true,
            kind: 'podcast',
            startedAtMs,
            stepIdx: 1,
            totalSteps: 3,
            stages: PODCAST_PIPELINE_STAGES,
            percent: 10,
            stagePercents: [10, 0, 0],
            stageElapsedSec: [0, 0, 0],
            estLabel: waitEst.estLabel,
            modelLabel: modelInfo.displayLabel,
            message: 'Step 1 of 3: Deep research on the topic…',
            subDetail: 'Querying live 49ers beat wire, ESPN headlines & 88-player roster/EPA/cap ledger.'
          };
          renderMain();
          const episode = await generateOnDemandAutopodcast({
            topic: state.podTopicDraft,
            durationMinutes: state.podDurationMin,
            format: state.podFormat === 'solo' ? 'solo' : 'two_host',
            appData: state.appData,
            prefs: state.prefs,
            onProgress: p => {
              const prevStep = state.jobStatus?.stepIdx || 1;
              const nextStep = p.stepIdx || 1;
              state.jobStatus = {
                active: true,
                kind: 'podcast',
                startedAtMs,
                stepIdx: nextStep,
                totalSteps: p.totalSteps || 3,
                stages: p.stages || PODCAST_PIPELINE_STAGES,
                percent: p.percent || 30,
                stagePercents: p.stagePercents || [100, 0, 0],
                stageElapsedSec: p.stageElapsedSec || [0, 0, 0],
                estLabel: p.estLabel || waitEst.estLabel,
                modelLabel: p.modelLabel || modelInfo.displayLabel,
                message: p.message,
                subDetail: p.subDetail || ''
              };
              if (prevStep !== nextStep || !syncActiveJobBannerDomInPlace(state.jobStatus)) {
                renderMain();
              }
            }
          });
          // Store clean metadata in localStorage (real WAV audio blob is persisted in IndexedDB)
          const persistableEpisode = {
            ...episode,
            audioUrl:
              typeof episode.audioUrl === 'string' && episode.audioUrl.startsWith('blob:')
                ? null
                : episode.audioUrl
          };
          state.prefs.deletedEpisodeIds = (state.prefs.deletedEpisodeIds || []).filter(
            id => id !== episode.id
          );
          state.prefs.archivedEpisodeIds = (state.prefs.archivedEpisodeIds || []).filter(
            id => id !== episode.id
          );
          state.prefs.localCustomEpisodes = [
            persistableEpisode,
            ...(state.prefs.localCustomEpisodes || []).filter(e => e.id !== episode.id)
          ].slice(0, 20);
          saveUserPrefs(state.prefs);
          state.podLibraryFilter = 'active';
          // Collapse transcript by default on newly generated episodes
          state.expandedTranscriptIds.delete(episode.id);
          state.jobStatus = null;
          state.podTopicDraft = '';
          // Present episode cleanly in "Podcast Ready to Play" state with preloaded Stereo WAV!
          await audioController.loadEpisodeReady(episode);
          renderMain();
        } catch (err) {
          state.jobStatus = {
            active: false,
            kind: 'podcast',
            error: err.message || 'Failed to generate podcast.'
          };
          renderMain();
          if (err?.code === 'GEMINI_KEY_REQUIRED') {
            document.getElementById('inlineGeminiApiKeyInput')?.focus();
          }
        } finally {
          clearInterval(elapsedTicker);
        }
        break;
      }

      case 'run-deep-analysis': {
        const areaEl = document.getElementById('analysisPromptInput');
        if (areaEl) state.analysisPromptDraft = areaEl.value;
        if (!String(state.analysisPromptDraft || '').trim()) {
          state.jobStatus = {
            active: false,
            kind: 'analysis',
            error: 'Please enter an analysis topic or question.'
          };
          renderMain();
          break;
        }
        const startedAtMs = Date.now();
        const waitEst = estimateGenerationWait({
          kind: 'analysis',
          prefs: state.prefs,
          appData: state.appData
        });
        const modelInfo = resolveActiveHighQualityModelLabel(state.appData, state.prefs);
        const elapsedTicker = setInterval(() => {
          const clockEl = document.getElementById('jobElapsedClock');
          if (clockEl) {
            const sec = Math.max(0, Math.floor((Date.now() - startedAtMs) / 1000));
            clockEl.textContent = `Elapsed ${formatTimeMmSs(sec)}`;
          }
        }, 250);
        try {
          state.jobStatus = {
            active: true,
            kind: 'analysis',
            startedAtMs,
            stepIdx: 1,
            totalSteps: 3,
            stages: ANALYSIS_PIPELINE_STAGES,
            percent: 12,
            stagePercents: [12, 0, 0],
            stageElapsedSec: [0, 0, 0],
            estLabel: waitEst.estLabel,
            modelLabel: modelInfo.displayLabel,
            message: 'Step 1 of 3: Deep research on the topic…',
            subDetail: 'Querying live ESPN NFL Nation, Bluesky beat wire & 88-player roster/EPA/cap ledger.'
          };
          renderMain();
          const report = await runOnDemandDeepAnalysis({
            prompt: state.analysisPromptDraft,
            category: 'Custom Deep Dive',
            appData: state.appData,
            prefs: state.prefs,
            onProgress: p => {
              const prevStep = state.jobStatus?.stepIdx || 1;
              const nextStep = p.stepIdx || 1;
              state.jobStatus = {
                active: true,
                kind: 'analysis',
                startedAtMs,
                stepIdx: nextStep,
                totalSteps: p.totalSteps || 3,
                stages: p.stages || ANALYSIS_PIPELINE_STAGES,
                percent: p.percent || 35,
                stagePercents: p.stagePercents || [100, 0, 0],
                stageElapsedSec: p.stageElapsedSec || [0, 0, 0],
                estLabel: p.estLabel || waitEst.estLabel,
                modelLabel: p.modelLabel || modelInfo.displayLabel,
                message: p.message,
                subDetail: p.subDetail || ''
              };
              if (prevStep !== nextStep || !syncActiveJobBannerDomInPlace(state.jobStatus)) {
                renderMain();
              }
            }
          });
          state.prefs.deletedAnalysisIds = (state.prefs.deletedAnalysisIds || []).filter(
            id => id !== report.id
          );
          state.prefs.archivedAnalysisIds = (state.prefs.archivedAnalysisIds || []).filter(
            id => id !== report.id
          );
          state.prefs.localCustomAnalyses = [
            report,
            ...(state.prefs.localCustomAnalyses || []).filter(a => a.id !== report.id)
          ].slice(0, 25);
          saveUserPrefs(state.prefs);
          state.analysisLibraryFilter = 'active';
          state.jobStatus = null;
          state.analysisPromptDraft = '';
          renderMain();
        } catch (err) {
          state.jobStatus = {
            active: false,
            kind: 'analysis',
            error: err.message || 'Analysis failed.'
          };
          renderMain();
          if (err?.code === 'GEMINI_KEY_REQUIRED') {
            document.getElementById('inlineGeminiApiKeyInput')?.focus();
          }
        } finally {
          clearInterval(elapsedTicker);
        }
        break;
      }

      case 'toggle-theme':
        state.prefs.theme = state.prefs.theme === 'light' ? 'dark' : 'light';
        applyTheme(state.prefs.theme);
        saveUserPrefs(state.prefs);
        renderSheet();
        break;

      case 'toggle-outlet': {
        const oid = btn.getAttribute('data-outlet-id');
        if (oid) {
          const set = new Set(state.prefs.disabledOutlets || []);
          if (set.has(oid)) set.delete(oid);
          else set.add(oid);
          state.prefs.disabledOutlets = Array.from(set);
          saveUserPrefs(state.prefs);
          renderSheet();
          renderMain();
        }
        break;
      }

      case 'enable-all-reporters':
        state.prefs.disabledReporterIds = [];
        state.prefs.disabledOutlets = [];
        saveUserPrefs(state.prefs);
        renderSheet();
        renderMain();
        break;

      case 'save-group-config': {
        const authEl = document.getElementById('prefAuthorInput');
        const passEl = document.getElementById('prefPasscodeInput');
        const urlEl = document.getElementById('prefWorkerUrlInput');
        const geminiKeyEl = document.getElementById('prefGeminiKeyInput');
        if (authEl) state.prefs.authorName = authEl.value.trim() || 'Josh';
        if (passEl) state.prefs.groupPasscode = passEl.value.trim();
        if (urlEl) state.prefs.workerBaseUrl = urlEl.value.trim();
        if (geminiKeyEl) {
          const nextKey = geminiKeyEl.value.trim();
          state.prefs.geminiApiKey = nextKey;
          if (!nextKey) {
            state.prefs.verifiedGeminiModel = '';
          } else {
            try {
              const verified = await verifyGeminiApiKey(nextKey, state.prefs.geminiApiBaseUrl);
              state.prefs.verifiedGeminiModel = verified.bestModel || '';
            } catch {
              // Keep user's key saved even if offline or verifying later
            }
          }
        }
        saveUserPrefs(state.prefs);
        state.geminiKeyNotice = '';
        if (state.jobStatus?.error) state.jobStatus = null;
        const shared = await fetchSharedWorkerFeed(state.prefs);
        if (shared) state.workerSharedFeed = shared;
        triggerDailyMatchupIntelSync().finally(() => triggerDailyTopNewsBriefSync());
        renderMain();
        btn.innerHTML = `${iconSvg('check', 14)}<span>Saved!</span>`;
        setTimeout(() => {
          if (state.sheetMode === 'settings') renderSheet();
        }, 900);
        break;
      }
    }
  });

  // Input & Select Change Listeners
  document.addEventListener('input', e => {
    const t = e.target;
    if (t.id === 'rosterSearchInput') {
      state.rosterSearch = t.value;
      renderMain();
    } else if (t.id === 'combineSearchInput') {
      state.combineSearch = t.value;
      renderMain();
    } else if (t.id === 'podDurationSlider') {
      const nextMins = Math.max(2, Math.min(20, Number(t.value || 3)));
      state.podDurationMin = nextMins;
      const badgeEl = document.getElementById('podDurationBadge');
      if (badgeEl) badgeEl.textContent = `${nextMins} min`;
      const waitEl = document.querySelector('[data-est-wait-preview="podcast"] span span');
      if (waitEl) {
        const waitEst = estimateGenerationWait({ kind: 'podcast', durationMinutes: nextMins, prefs: state.prefs });
        waitEl.textContent = waitEst.summaryText;
      }
      const genBtnSpan = document.querySelector('[data-action="generate-autopodcast"] span');
      if (genBtnSpan && !state.jobStatus) {
        genBtnSpan.textContent = `Generate ${nextMins}-Min Audio Briefing`;
      }
    } else if (t.id === 'prefPodDurationSlider') {
      const nextDur = Math.max(2, Math.min(20, Number(t.value || 3)));
      state.prefs.defaultPodDurationMin = nextDur;
      state.podDurationMin = nextDur;
      saveUserPrefs(state.prefs);
      const badgeEl = document.getElementById('prefPodDurationBadge');
      if (badgeEl) badgeEl.textContent = `${nextDur} min`;
      if (state.activeNavTab === 'audio') renderMain();
    } else if (t.id === 'podTopicInput') {
      state.podTopicDraft = t.value;
    } else if (t.id === 'analysisPromptInput') {
      state.analysisPromptDraft = t.value;
    } else if (t.id === 'reporterFilterSearchInput') {
      state.reporterSearch = t.value;
      renderSheet();
    }
  });

  document.addEventListener('change', e => {
    const t = e.target;
    if (t.id === 'rosterSortSelect') {
      const nextField = t.value;
      const def = ROSTER_SORT_FIELDS.find(f => f.key === nextField);
      state.rosterSort = nextField;
      if (def) state.rosterSortDir = def.defaultDir;
      renderMain();
    } else if (t.classList.contains('gm-move-select')) {
      const pid = t.getAttribute('data-player-id');
      const yr = t.getAttribute('data-cap-year') || state.capSelectedYear || '2026';
      if (pid) {
        const curMoves = { ...getCapMovesForYear(yr) };
        if (t.value === 'none') delete curMoves[pid];
        else curMoves[pid] = t.value;
        setCapMovesForYear(yr, curMoves);
        saveUserPrefs(state.prefs);
        renderMain();
      }
    } else if (t.getAttribute('data-action') === 'toggle-pref-bool') {
      const key = t.getAttribute('data-pref-key');
      if (key) {
        state.prefs[key] = Boolean(t.checked);
        saveUserPrefs(state.prefs);
        renderMain();
      }
    } else if (t.getAttribute('data-action') === 'toggle-reporter') {
      const rid = t.getAttribute('data-reporter-id');
      if (rid) {
        const set = new Set(state.prefs.disabledReporterIds || []);
        if (t.checked) set.delete(rid);
        else set.add(rid);
        state.prefs.disabledReporterIds = Array.from(set);
        saveUserPrefs(state.prefs);
        renderMain();
      }
    }
  });

  // HTML5 Drag-and-Drop on Dashboard Cards when Layout Mode is active
  document.addEventListener('dragstart', e => {
    const card = e.target.closest('[data-dashboard-block]');
    if (!card || !state.isCustomizingLayout) return;
    state.draggedBlockId = card.getAttribute('data-dashboard-block');
    card.classList.add('dragging');
  });

  document.addEventListener('dragend', e => {
    const card = e.target.closest('[data-dashboard-block]');
    if (card) card.classList.remove('dragging');
    state.draggedBlockId = null;
  });

  document.addEventListener('dragover', e => {
    if (!state.isCustomizingLayout || !state.draggedBlockId) return;
    const overCard = e.target.closest('[data-dashboard-block]');
    if (overCard) e.preventDefault();
  });

  document.addEventListener('drop', e => {
    if (!state.isCustomizingLayout || !state.draggedBlockId) return;
    const targetCard = e.target.closest('[data-dashboard-block]');
    if (!targetCard) return;
    e.preventDefault();
    const targetId = targetCard.getAttribute('data-dashboard-block');
    reorderBlockBeforeTarget(state.draggedBlockId, targetId);
    state.draggedBlockId = null;
  });

  // Graceful fallback for any dynamic player headshot, team crest, or article photo
  document.addEventListener(
    'error',
    e => {
      const target = e.target;
      if (target && target.tagName === 'IMG') {
        const wrap = target.closest(
          '.player-avatar, .team-logo-wrap, .brief-hero-media, .raw-item-thumb, .yt-facade-media, .video-thumb-stage, .beat-podcast-art-wrap'
        );
        if (wrap) wrap.classList.add('img-error');
      }
    },
    true
  );
}

const GAME_LIVE_WIRE_POLL_MS = 20_000; // 20s latency during 49ers game windows (<1 min)
const STANDARD_WIRE_POLL_MS = 45_000; // 45s latency year-round (<1 min)

let lastLiveCheckMs = 0;
let lastWirePollMs = 0;
let wirePollCount = 0;
let isBackgroundSyncing = false;
let isWirePolling = false;
let wirePollTimerId = null;

async function pollLowLatencyTweetAndInjuryWire(manual = false) {
  if (isWirePolling || !state.appData) return;
  isWirePolling = true;
  if (manual) {
    state.isSyncingWire = true;
    if (state.activeNavTab === 'news') renderMain();
  }
  try {
    const gameLive = is49ersGameLiveWindow(state.appData);
    wirePollCount += 1;
    const viewingHealthSurface =
      (state.activeNavTab === 'season' && (state.seasonSubTab === 'health' || state.seasonSubTab === 'matchup')) ||
      (state.sheetMode === 'player' && state.sheetPlayerTab === 'health');
    const hasPendingPracticeSlots = (state.appData?.health?.practiceReport || []).some(
      r => r.wed === '-' || r.thu === '-' || r.fri === '-'
    );
    const shouldCheckEspn =
      manual || gameLive || viewingHealthSurface || hasPendingPracticeSlots || wirePollCount % 2 === 0;

    const [wireResult, espnChanged] = await Promise.all([
      hydrateLiveMultiSourceBeatWire(state.appData, { isGameLive: gameLive }),
      shouldCheckEspn ? hydrateLiveEspnOverlay(state.appData) : Promise.resolve(false)
    ]);
    const addedTweets = Number(wireResult?.totalAdded || 0);
    state.lastWireSourceCounts = wireResult?.bySource || null;

    state.lastWireSyncAt = new Date().toISOString();
    lastWirePollMs = Date.now();

    if (addedTweets > 0 || espnChanged) {
      cachedMonteCarloKey = '';
      cachedMonteCarloResult = null;
      renderHeaderAndPhaseBanner();
    }

    const activeTag = document.activeElement?.tagName;
    const isTyping = activeTag === 'INPUT' || activeTag === 'TEXTAREA';
    const hasPlayingIframe = state.activeVideosSet.size > 0;

    if ((manual || addedTweets > 0 || espnChanged) && !isTyping && !hasPlayingIframe && !state.jobStatus?.active) {
      renderMain();
      if (state.sheetMode === 'player') renderSheet();
    }
  } catch {
    // Offline or transient network blip; keep serving existing cached state cleanly
  } finally {
    state.isSyncingWire = false;
    isWirePolling = false;
    if (manual && state.activeNavTab === 'news') renderMain();
  }
}

function scheduleAdaptiveSubMinuteWireLoop() {
  if (wirePollTimerId) clearTimeout(wirePollTimerId);
  const nextIntervalMs = is49ersGameLiveWindow(state.appData)
    ? GAME_LIVE_WIRE_POLL_MS
    : STANDARD_WIRE_POLL_MS;

  wirePollTimerId = setTimeout(async () => {
    if (document.visibilityState === 'visible') {
      await pollLowLatencyTweetAndInjuryWire(false);
    }
    scheduleAdaptiveSubMinuteWireLoop();
  }, nextIntervalMs);
}

async function refreshLiveFeedsInBackground(forceFull = false) {
  if (isBackgroundSyncing || !state.appData) return;
  isBackgroundSyncing = true;
  try {
    let hasNewUpstreamData = false;
    const fresherBundle = forceFull
      ? await loadAll49ersData()
      : await fetchFresherUpstreamData(state.appData.meta?.updatedAt);

    if (fresherBundle) {
      state.appData = fresherBundle;
      hydrateCachedDailyMatchupIntel(state.appData);
      hydrateCachedDailyTopNewsBrief(state.appData);
      cachedMonteCarloKey = '';
      cachedMonteCarloResult = null;
      hasNewUpstreamData = true;
    }

    const [wireResult, espnMutated, podsMutated] = await Promise.all([
      hydrateLiveMultiSourceBeatWire(state.appData, {
        isGameLive: is49ersGameLiveWindow(state.appData)
      }),
      hydrateLiveEspnOverlay(state.appData),
      hydrateLive49ersPodcasts(state.appData)
    ]);
    const addedLivePosts = Number(wireResult?.totalAdded || 0);
    state.lastWireSourceCounts = wireResult?.bySource || null;
    state.lastWireSyncAt = new Date().toISOString();
    lastWirePollMs = Date.now();

    if (addedLivePosts > 0 || espnMutated || podsMutated) {
      cachedMonteCarloKey = '';
      cachedMonteCarloResult = null;
      hasNewUpstreamData = true;
    }

    const prevPhaseKey = JSON.stringify(state.seasonState?.activePhases || []);
    state.seasonState = evaluateSeasonState({
      now: new Date(),
      calendar: state.appData.meta?.calendar,
      teamStatus: state.appData.meta?.teamStatus
    });
    const nextPhaseKey = JSON.stringify(state.seasonState?.activePhases || []);

    renderHeaderAndPhaseBanner();

    const activeTag = document.activeElement?.tagName;
    const isTyping = activeTag === 'INPUT' || activeTag === 'TEXTAREA';
    const hasPlayingIframe = state.activeVideosSet.size > 0;

    if ((hasNewUpstreamData || prevPhaseKey !== nextPhaseKey) && !isTyping && !hasPlayingIframe && !state.jobStatus?.active) {
      renderMain();
      if (state.sheetMode) renderSheet();
    }

    lastLiveCheckMs = Date.now();
  } catch {
    // Offline or transient network blip; keep serving existing cached state cleanly
  } finally {
    isBackgroundSyncing = false;
  }
}

async function handleIncomingSharedLink(locationLike = window.location) {
  const sharedRoute = await extractIncomingSharedRoute(locationLike);
  if (!sharedRoute) return false;

  if (sharedRoute.type === 'podcast') {
    state.activeNavTab = 'audio';
    state.studioSubTab = 'podcast';
    state.podLibraryFilter = 'active';

    if (sharedRoute.id) {
      state.prefs.deletedEpisodeIds = (state.prefs.deletedEpisodeIds || []).filter(
        id => id !== sharedRoute.id
      );
      state.prefs.archivedEpisodeIds = (state.prefs.archivedEpisodeIds || []).filter(
        id => id !== sharedRoute.id
      );
    }

    let targetEp = getAllEpisodes().find(ep => ep.id === sharedRoute.id) || null;
    if (!targetEp && sharedRoute.episode) {
      targetEp = sharedRoute.episode;
      state.prefs.localCustomEpisodes = [
        targetEp,
        ...(state.prefs.localCustomEpisodes || []).filter(e => e.id !== targetEp.id)
      ].slice(0, 20);
    }
    saveUserPrefs(state.prefs);

    renderMain();
    if (targetEp) {
      state.expandedTranscriptIds.delete(targetEp.id);
      await audioController.loadEpisodeReady(targetEp);
      renderMain();
    }
    return true;
  }

  if (sharedRoute.type === 'analysis') {
    state.activeNavTab = 'audio';
    state.studioSubTab = 'analysis';
    state.analysisLibraryFilter = 'active';

    if (sharedRoute.id) {
      state.prefs.deletedAnalysisIds = (state.prefs.deletedAnalysisIds || []).filter(
        id => id !== sharedRoute.id
      );
      state.prefs.archivedAnalysisIds = (state.prefs.archivedAnalysisIds || []).filter(
        id => id !== sharedRoute.id
      );
    }

    let targetReport = getAllAnalyses().find(a => a.id === sharedRoute.id) || null;
    if (!targetReport && sharedRoute.analysis) {
      targetReport = sharedRoute.analysis;
      state.prefs.localCustomAnalyses = [
        targetReport,
        ...(state.prefs.localCustomAnalyses || []).filter(a => a.id !== targetReport.id)
      ].slice(0, 25);
    }
    saveUserPrefs(state.prefs);
    renderMain();
    return true;
  }

  return false;
}

function syncActiveJobBannerDomInPlace(jobStatus) {
  if (!jobStatus?.active) return false;
  const banner = document.querySelector('[data-job-progress="active"]');
  if (!banner) return false;

  const overallFill = banner.querySelector('.job-progress-fill');
  if (overallFill) {
    const pct = Math.max(8, Math.min(99, Number(jobStatus.percent || 12)));
    overallFill.style.width = `${pct}%`;
  }
  const stepEl = banner.querySelector('.job-progress-step');
  if (stepEl && jobStatus.message) {
    stepEl.textContent = jobStatus.message;
  }
  const subEl = banner.querySelector('.job-progress-subdetail');
  if (subEl && jobStatus.subDetail) {
    subEl.textContent = jobStatus.subDetail;
  }

  const activeStep = Math.max(1, Math.min(3, Number(jobStatus.stepIdx || 1)));
  const stagePcts = Array.isArray(jobStatus.stagePercents) ? jobStatus.stagePercents : [];
  const stageSecs = Array.isArray(jobStatus.stageElapsedSec) ? jobStatus.stageElapsedSec : [];

  for (let s = 1; s <= 3; s++) {
    const barEl = banner.querySelector(`[data-stage-bar="${s}"]`);
    const statusEl = banner.querySelector(`[data-stage-status="${s}"]`);
    const secVal = Math.max(0, Math.floor(Number(stageSecs[s - 1] || 0)));
    if (s < activeStep) {
      if (barEl) barEl.style.width = '100%';
      if (statusEl) statusEl.textContent = secVal > 0 ? `Done · ${secVal}s` : 'Done';
    } else if (s === activeStep) {
      const curPct = Math.max(8, Math.min(99, Math.round(Number(stagePcts[s - 1] || 12))));
      if (barEl) barEl.style.width = `${curPct}%`;
      if (statusEl) statusEl.textContent = `In progress · ${secVal}s`;
    } else {
      if (barEl) barEl.style.width = '0%';
      if (statusEl) statusEl.textContent = 'Queued';
    }
  }
  return true;
}

let isBootingAppData = false;
let hasCompletedBootLifecycle = false;
let bootRetryTimerId = null;
let bootFailureCount = 0;

function renderFeedLoadErrorState(err, { isRetrying = false } = {}) {
  const subStatus = document.getElementById('headerSubStatus');
  if (subStatus) {
    subStatus.textContent = isRetrying
      ? 'Reconnecting to 49ers data feeds…'
      : 'Connection interrupted • Tap Retry';
  }
  const mainEl = document.getElementById('mainView');
  if (!mainEl) return;
  const rawMsg = String(err?.message || 'Network connection interrupted');
  const friendlyDetail = /load failed|failed to fetch|networkerror|abort/i.test(rawMsg)
    ? 'Network connection dropped while loading feeds. The app will reconnect automatically as soon as signal returns, or tap Retry below.'
    : rawMsg;
  mainEl.innerHTML = `
    <div class="card" data-feed-error-card="true">
      <div class="card-eyebrow" style="color:var(--crimson)">Feed Connection Interrupted</div>
      <h2 class="card-title">Reconnecting 49ers Data Feeds</h2>
      <p style="font-size:13px;color:var(--text-secondary);margin:6px 0 12px">${esc(friendlyDetail)}</p>
      <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
        <button type="button" class="btn-primary" data-action="retry-load-feeds" ${isRetrying ? 'disabled' : ''}>
          ${iconSvg(isRetrying ? 'loader' : 'reset', 14, isRetrying ? 'btn-spin-icon' : '')}
          <span>${isRetrying ? 'Reconnecting…' : 'Retry Loading Feeds'}</span>
        </button>
      </div>
    </div>
  `;
}

async function bootOrRecoverAppData({ manual = false } = {}) {
  if (isBootingAppData || state.appData) return Boolean(state.appData);
  isBootingAppData = true;
  if (bootRetryTimerId) {
    clearTimeout(bootRetryTimerId);
    bootRetryTimerId = null;
  }
  if (manual && bootFailureCount > 0) {
    renderFeedLoadErrorState(null, { isRetrying: true });
  }

  try {
    state.appData = await loadAll49ersData();
    hydrateCachedDailyMatchupIntel(state.appData);
    hydrateCachedDailyTopNewsBrief(state.appData);
    bootFailureCount = 0;
    state.lastWireSyncAt = state.appData.meta?.updatedAt || new Date().toISOString();
    lastLiveCheckMs = Date.now();
    lastWirePollMs = Date.now();
    state.seasonState = evaluateSeasonState({
      now: new Date(),
      calendar: state.appData.meta?.calendar,
      teamStatus: state.appData.meta?.teamStatus
    });

    // Expose read-only diagnostics hook for live-wire telemetry & automated QA verification
    window.__49ersDiagnostics = {
      getLiveWireConfig: () => ({
        gameLivePollMs: GAME_LIVE_WIRE_POLL_MS,
        standardPollMs: STANDARD_WIRE_POLL_MS,
        isGameLive: is49ersGameLiveWindow(state.appData),
        lastWireSyncAt: state.lastWireSyncAt,
        sourcesPolled: LIVE_WIRE_SOURCE_LABELS,
        lastWireSourceCounts: state.lastWireSourceCounts || null
      }),
      getState: () => state,
      openSharedUrl: loc => handleIncomingSharedLink(loc),
      forceRender: () => {
        renderMain();
        if (state.sheetMode) renderSheet();
      }
    };

    renderHeaderAndPhaseBanner();
    renderMain();

    if (!hasCompletedBootLifecycle) {
      hasCompletedBootLifecycle = true;

      // Check if colleague arrived via a shared `?pod=...` / `#shared-pod=...` or `?analysis=...` deep link
      handleIncomingSharedLink(window.location).catch(() => {});
      window.addEventListener('hashchange', () => {
        handleIncomingSharedLink(window.location).catch(() => {});
      });

      // Non-blocking real-time delta hydration (fresher GitHub Raw commits + live Bluesky beat wire + 6 podcasts)
      refreshLiveFeedsInBackground(Boolean(state.appData._restoredFromOfflineSnapshot));

      // Start <1 min adaptive live tweet & in-game injury wire polling (20s in-game, 45s standard)
      scheduleAdaptiveSubMinuteWireLoop();

      // Non-blocking sync of shared Cloudflare Worker intelligence feed if configured
      fetchSharedWorkerFeed(state.prefs).then(shared => {
        if (shared) {
          state.workerSharedFeed = shared;
          if (state.activeNavTab === 'audio') renderMain();
        }
      });

      // Auto-update to newer, more capable free Gemini models in the background as Google releases them
      if (state.prefs.geminiApiKey) {
        checkAndAutoUpdateBestGeminiModel(state.prefs, () => {
          saveUserPrefs(state.prefs);
          if (state.activeNavTab === 'audio') renderMain();
        });
      }

      // Sequenced 1/day Gemini 3.8 High Matchup Intel + 5:00 PM PT Top News Brief refreshes (no split budget)
      triggerDailyMatchupIntelSync().finally(() => triggerDailyTopNewsBriefSync());
    }
    return true;
  } catch (err) {
    bootFailureCount += 1;
    renderFeedLoadErrorState(err, { isRetrying: false });
    if (bootFailureCount <= 4) {
      const retryDelayMs = Math.min(15_000, 2500 * bootFailureCount);
      bootRetryTimerId = setTimeout(() => {
        if (!state.appData && document.visibilityState !== 'hidden') {
          bootOrRecoverAppData({ manual: false });
        }
      }, retryDelayMs);
    }
    return false;
  } finally {
    isBootingAppData = false;
  }
}

async function init() {
  state.prefs = loadUserPrefs();
  applyTheme(state.prefs.theme);
  if (state.prefs?.capSelectedYear) {
    state.capSelectedYear = String(state.prefs.capSelectedYear);
  }
  state.podFormat = state.prefs?.podFormat === 'solo' ? 'solo' : 'two_host';
  state.podDurationMin = Math.max(2, Math.min(20, Number(state.prefs?.defaultPodDurationMin || 3)));
  audioController = new PodcastAudioController(renderMiniPlayer, {
    onSynthesizeMissingAudio: async ep => {
      const startedAtMs = Date.now();
      const modelInfo = resolveActiveHighQualityModelLabel(state.appData, state.prefs);
      state.jobStatus = {
        active: true,
        kind: 'podcast',
        startedAtMs,
        stepIdx: 3,
        totalSteps: 3,
        stages: PODCAST_PIPELINE_STAGES,
        percent: 52,
        stagePercents: [100, 100, 20],
        stageElapsedSec: [0, 0, 0],
        estLabel: '30–60 sec',
        modelLabel: modelInfo.displayLabel,
        message: 'Step 3 of 3: Preparing shared podcast studio audio…',
        subDetail: 'Synthesizing 2-channel Stereo WAV for instant playback on your device.'
      };
      if (state.activeNavTab === 'audio') renderMain();
      try {
        return await synthesizeMissingEpisodeAudio(
          ep,
          p => {
            state.jobStatus = {
              ...state.jobStatus,
              ...p,
              active: true,
              kind: 'podcast',
              startedAtMs,
              modelLabel: modelInfo.displayLabel
            };
            if (state.activeNavTab === 'audio' && !syncActiveJobBannerDomInPlace(state.jobStatus)) {
              renderMain();
            }
          },
          state.prefs
        );
      } finally {
        state.jobStatus = null;
        if (state.activeNavTab === 'audio') renderMain();
      }
    }
  });
  bindEvents();

  // Register recovery & live-sync listeners unconditionally so even an offline cold boot self-heals automatically
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      if (!state.appData) {
        bootOrRecoverAppData({ manual: false });
      } else if (Date.now() - lastLiveCheckMs >= 5 * 60_000) {
        refreshLiveFeedsInBackground(false);
      } else if (Date.now() - lastWirePollMs >= 15_000) {
        pollLowLatencyTweetAndInjuryWire(false);
      }
    }
  });
  window.addEventListener('focus', () => {
    if (!state.appData) {
      bootOrRecoverAppData({ manual: false });
    } else if (Date.now() - lastWirePollMs >= 15_000) {
      pollLowLatencyTweetAndInjuryWire(false);
    }
  });
  window.addEventListener('online', () => {
    if (!state.appData) {
      bootOrRecoverAppData({ manual: true });
    } else {
      refreshLiveFeedsInBackground(false);
    }
  });

  // Live countdown & relative timestamp ticker (every 60s while tab is visible)
  setInterval(() => {
    if (document.visibilityState === 'hidden' || !state.appData) return;
    const prevPhaseKey = JSON.stringify(state.seasonState?.activePhases || []);
    state.seasonState = evaluateSeasonState({
      now: new Date(),
      calendar: state.appData.meta?.calendar,
      teamStatus: state.appData.meta?.teamStatus
    });
    renderHeaderAndPhaseBanner();
    if (JSON.stringify(state.seasonState?.activePhases || []) !== prevPhaseKey && state.activeVideosSet.size === 0) {
      renderMain();
    }
  }, 60_000);

  // Periodic background check for full upstream JSON bundles & podcasts every 5 minutes
  setInterval(() => {
    if (document.visibilityState === 'visible') {
      if (!state.appData) {
        bootOrRecoverAppData({ manual: false });
      } else {
        refreshLiveFeedsInBackground(false);
      }
    }
  }, 5 * 60_000);

  await bootOrRecoverAppData({ manual: false });

  // Register Offline-Ready Service Worker AFTER initial boot attempt and NEVER reload mid-boot or mid-job
  if ('serviceWorker' in navigator) {
    let refreshingSw = false;
    const hadController = Boolean(navigator.serviceWorker.controller);
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (!hadController || refreshingSw) return;
      if (isBootingAppData || !state.appData || state.jobStatus?.active || state.audioState?.isPlaying) {
        return;
      }
      refreshingSw = true;
      window.location.reload();
    });
    const registerSw = () => {
      navigator.serviceWorker
        .register('./sw.js?v=55', { updateViaCache: 'none' })
        .then(reg => reg.update().catch(() => {}))
        .catch(() => {});
    };
    if (document.readyState === 'complete') {
      registerSw();
    } else {
      window.addEventListener('load', registerSw, { once: true });
    }
  }
}

init();
