/**
 * Main Application Controller for 49ers Faithful (https://49ers.joshal.com)
 */

import { evaluateSeasonState, resolveOrderedDashboardBlocks } from './engine/seasonStateMachine.js';
import { simulateCapScenario } from './engine/capSimulator.js';
import { runPlayoffMonteCarlo } from './engine/playoffMonteCarlo.js';
import { filterNewsByUserPrefs } from './engine/antiFluffFilter.js';
import { is49ersGameLiveWindow } from './engine/breakingClassifier.js';
import { PodcastAudioController, formatTimeMmSs } from './components/audioPlayer.js';
import {
  loadAll49ersData,
  fetchFresherUpstreamData,
  hydrateLiveBlueskyBeatWire,
  hydrateLiveEspnOverlay,
  hydrateLive49ersPodcasts,
  loadUserPrefs,
  saveUserPrefs
} from './services/dataService.js';
import {
  fetchSharedWorkerFeed,
  runOnDemandDeepAnalysis,
  generateOnDemandAutopodcast
} from './services/aiWorkerClient.js';

import { esc, formatRelativeAge } from './views/uiHelpers.js';
import { getJargonEntry } from './engine/jargonGlossary.js';
import { iconSvg } from './views/icons.js';
import { renderHomeDashboardHtml } from './views/homeView.js';
import { renderNewsViewHtml } from './views/newsView.js';
import { renderRosterCapViewHtml, ROSTER_SORT_FIELDS, normalizeRosterSort } from './views/rosterCapView.js';
import { renderPlayerDossierSheetHtml } from './views/playerSheetView.js';
import { renderSeasonMatchupViewHtml } from './views/seasonMatchupView.js';
import { renderAudioAiViewHtml } from './views/audioAiView.js';
import { renderSettingsSheetHtml, renderArchiveVaultSheetHtml } from './views/settingsArchiveView.js';

const state = {
  appData: null,
  prefs: loadUserPrefs(),
  seasonState: null,

  activeNavTab: 'home', // 'home' | 'news' | 'roster' | 'season' | 'audio'
  isCustomizingLayout: false,
  draggedBlockId: null,

  // News state
  newsMode: 'clustered',
  newsCategoryFilter: 'all',
  activeVideosSet: new Set(),
  lastWireSyncAt: null,
  isSyncingWire: false,

  // Roster & Cap state
  rosterSubTab: 'roster',
  rosterSearch: '',
  rosterUnitFilter: 'All',
  rosterPosFilter: 'ALL',
  rosterSort: 'name',
  rosterSortDir: 'asc',
  depthMode: 'projected',
  capSelectedYear: '2026',

  // Season & Temporal state
  seasonSubTab: 'matchup',
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
  jobStatus: null,
  workerSharedFeed: { analyses: [], episodes: [] },
  audioState: {},

  // Bottom Sheet state
  sheetMode: null, // 'player' | 'settings' | 'vault' | null
  sheetPlayerId: null,
  sheetPlayerTab: 'overview',
  sheetPlayerStatsMode: '2026',
  sheetPlayerTxScenario: 'cut',
  reporterSearch: ''
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
  const merged = [...localEps, ...workerEps, ...base];
  const seen = new Set();
  return merged.filter(ep => {
    if (!ep?.id || seen.has(ep.id)) return false;
    seen.add(ep.id);
    return true;
  });
}

function getAllAnalyses() {
  const base = state.appData?.podcastIndex?.sharedAnalyses || [];
  const workerItems = state.workerSharedFeed?.analyses || [];
  const localItems = state.prefs.localCustomAnalyses || [];
  const merged = [...localItems, ...workerItems, ...base];
  const seen = new Set();
  return merged.filter(item => {
    if (!item?.id || seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  });
}

function preserveFocusAroundRender(renderFn) {
  const active = document.activeElement;
  const activeId = active?.id || null;
  const selStart = typeof active?.selectionStart === 'number' ? active.selectionStart : null;
  const selEnd = typeof active?.selectionEnd === 'number' ? active.selectionEnd : null;

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

  closeJargonPopover();
  renderHeaderAndPhaseBanner();

  const sortedCapYears = Object.keys(state.appData.cap?.years || {}).sort();
  const primaryCapYear = sortedCapYears[0] || '2026';
  const activeCapYear =
    state.capSelectedYear && state.appData.cap?.years?.[state.capSelectedYear]
      ? String(state.capSelectedYear)
      : primaryCapYear;
  state.capSelectedYear = activeCapYear;

  const reportersMap = getReportersMap();
  const filteredClusters = filterNewsByUserPrefs(
    state.appData.news?.clusteredBriefs || [],
    reportersMap,
    state.prefs
  );
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
  const activeYearMoves = getCapMovesForYear(activeCapYear);
  const rosterSimCapResult =
    activeCapYear === primaryCapYear
      ? homeSimCapResult
      : simulateCapScenario(state.appData.cap, activeYearMoves, { baseYear: activeCapYear });
  const mcSimResult = getMonteCarloResult();

  preserveFocusAroundRender(() => {
    if (state.activeNavTab === 'home') {
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
        filteredClusters,
        filteredRawItems,
        isCustomizingLayout: state.isCustomizingLayout
      });
    } else if (state.activeNavTab === 'news') {
      mainEl.innerHTML = renderNewsViewHtml({
        newsMode: state.newsMode,
        newsCategoryFilter: state.newsCategoryFilter,
        filteredClusters,
        filteredRawItems,
        reportersById: reportersMap,
        activeVideosSet: state.activeVideosSet,
        userPrefs: state.prefs,
        totalReportersCount: state.appData.reporters?.reporters?.length || 45,
        isGameLive: is49ersGameLiveWindow(state.appData),
        lastWireSyncAt: state.lastWireSyncAt || state.appData.meta?.updatedAt,
        isSyncingWire: state.isSyncingWire
      });
    } else if (state.activeNavTab === 'roster') {
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
    } else if (state.activeNavTab === 'season') {
      mainEl.innerHTML = renderSeasonMatchupViewHtml({
        seasonSub: state.seasonSubTab,
        activePhases: state.seasonState.activePhases,
        appData: state.appData,
        mcSimResult,
        forcedWinners: state.prefs.playoffForcedWinners,
        combineSearch: state.combineSearch,
        expandedDraftSpiderIdx: state.expandedDraftSpiderIdx,
        activeVideosSet: state.activeVideosSet
      });
    } else if (state.activeNavTab === 'audio') {
      mainEl.innerHTML = renderAudioAiViewHtml({
        appData: state.appData,
        studioSub: state.studioSubTab,
        beatPodViewMode: state.beatPodViewMode,
        beatPodShowFilter: state.beatPodShowFilter,
        podDurationMin: state.podDurationMin,
        podFormat: state.podFormat,
        podTopicDraft: state.podTopicDraft,
        analysisPromptDraft: state.analysisPromptDraft,
        jobStatus: state.jobStatus,
        allEpisodes: getAllEpisodes(),
        allAnalyses: getAllAnalyses(),
        audioState: state.audioState
      });
    }
  });

  renderNavTabs();
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
    if (state.sheetMode === 'player') {
      const player = getPlayerById(state.sheetPlayerId);
      if (eyebrow) eyebrow.textContent = player ? `${player.position} • #${player.jersey ?? '—'}` : 'Player Dossier';
      if (title) title.textContent = player ? player.name : 'Player Dossier';
      body.innerHTML = renderPlayerDossierSheetHtml({
        player,
        activeTab: state.sheetPlayerTab,
        statsMode: state.sheetPlayerStatsMode,
        txScenario: state.sheetPlayerTxScenario
      });
    } else if (state.sheetMode === 'settings') {
      if (eyebrow) eyebrow.textContent = 'Customization & Source Control';
      if (title) title.textContent = 'Settings & Reporter Filters';
      body.innerHTML = renderSettingsSheetHtml({
        userPrefs: state.prefs,
        reportersData: state.appData?.reporters,
        reporterSearch: state.reporterSearch
      });
    } else if (state.sheetMode === 'vault') {
      if (eyebrow) eyebrow.textContent = 'Seasonal Schedule & Trade Archive';
      if (title) title.textContent = 'Off-Cycle Archive';
      body.innerHTML = renderArchiveVaultSheetHtml({
        seasonState: state.seasonState,
        appData: state.appData
      });
    }
  });
}

function renderMiniPlayer(audioSnapshot) {
  const prevEpId = state.audioState?.episode?.id || null;
  const nextEpId = audioSnapshot?.episode?.id || null;
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

  // If a new episode just loaded while viewing Podcast Studio, immediately mount its interactive transcript
  if (prevEpId !== nextEpId && state.activeNavTab === 'audio' && state.studioSubTab === 'podcast') {
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

  // Update active transcript turn highlight in place if on Audio tab
  if (state.activeNavTab === 'audio' && state.studioSubTab === 'podcast') {
    document.querySelectorAll('.transcript-turn').forEach((el, idx) => {
      el.classList.toggle('active-turn', idx === audioSnapshot.activeTurnIdx);
    });
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

function bindEvents() {
  // Bottom Nav Tabs
  document.querySelectorAll('.nav-tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      state.activeNavTab = btn.getAttribute('data-nav-tab') || 'home';
      window.scrollTo({ top: 0, behavior: 'instant' });
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

  document.addEventListener('keydown', e => {
    const pop = document.getElementById('jargonPopover');
    if (e.key === 'Escape' && pop && !pop.hidden) {
      closeJargonPopover();
      return;
    }
    if ((e.key === 'Enter' || e.key === ' ') && e.target?.closest?.('[data-jargon]')) {
      const jt = e.target.closest('[data-jargon]');
      e.preventDefault();
      e.stopPropagation();
      openJargonPopover(jt, jt.getAttribute('data-jargon'));
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

  // Sticky Mini-Player Controls
  document.getElementById('miniPlayerExpandTrigger')?.addEventListener('click', () => {
    state.activeNavTab = 'audio';
    state.studioSubTab = 'podcast';
    renderMain();
  });
  document.getElementById('mpPlayPauseBtn')?.addEventListener('click', () => audioController?.togglePlayPause());
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

    const btn = e.target.closest('[data-action]');
    if (!btn) return;
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

      case 'jump-view':
        state.activeNavTab = btn.getAttribute('data-target-tab') || 'home';
        window.scrollTo({ top: 0, behavior: 'instant' });
        renderMain();
        break;

      case 'jump-roster-sub':
        state.activeNavTab = 'roster';
        state.rosterSubTab = btn.getAttribute('data-roster-sub') || 'roster';
        window.scrollTo({ top: 0, behavior: 'instant' });
        renderMain();
        break;

      case 'jump-season-sub':
        state.activeNavTab = 'season';
        state.seasonSubTab = btn.getAttribute('data-season-sub') || 'matchup';
        window.scrollTo({ top: 0, behavior: 'instant' });
        renderMain();
        break;

      case 'open-vault-module':
        state.sheetMode = null;
        renderSheet();
        state.activeNavTab = 'season';
        state.seasonSubTab = btn.getAttribute('data-season-sub') || 'draft_class';
        window.scrollTo({ top: 0, behavior: 'instant' });
        renderMain();
        break;

      case 'open-settings':
        state.sheetMode = 'settings';
        renderSheet();
        break;

      case 'open-archive':
        state.sheetMode = 'vault';
        renderSheet();
        break;

      case 'set-news-mode':
        state.newsMode = btn.getAttribute('data-mode') || 'clustered';
        renderMain();
        break;

      case 'set-news-category':
        state.newsCategoryFilter = btn.getAttribute('data-category') || 'all';
        renderMain();
        break;

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

      case 'set-season-sub':
        state.seasonSubTab = btn.getAttribute('data-season-sub') || 'matchup';
        renderMain();
        break;

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

      case 'set-pod-format':
        state.podFormat = btn.getAttribute('data-format') || 'two_host';
        renderMain();
        break;

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
        const sec = Number(btn.getAttribute('data-seek-sec') || 0);
        audioController?.seekTo(sec);
        break;
      }

      case 'generate-autopodcast': {
        const inputEl = document.getElementById('podTopicInput');
        if (inputEl) state.podTopicDraft = inputEl.value;
        if (!String(state.podTopicDraft || '').trim()) {
          state.jobStatus = { active: false, error: 'Please enter or select a podcast topic.' };
          renderMain();
          break;
        }
        try {
          state.jobStatus = { active: true, message: 'Initializing Autopodcast generator…' };
          renderMain();
          const episode = await generateOnDemandAutopodcast({
            topic: state.podTopicDraft,
            durationMinutes: state.podDurationMin,
            format: state.podFormat === 'solo' ? 'solo' : 'two_host',
            appData: state.appData,
            prefs: state.prefs,
            onProgress: p => {
              state.jobStatus = { active: true, message: p.message };
              renderMain();
            }
          });
          state.prefs.localCustomEpisodes = [
            episode,
            ...(state.prefs.localCustomEpisodes || []).filter(e => e.id !== episode.id)
          ].slice(0, 20);
          saveUserPrefs(state.prefs);
          state.jobStatus = null;
          state.podTopicDraft = '';
          await audioController.loadAndPlay(episode, 0);
          renderMain();
        } catch (err) {
          state.jobStatus = { active: false, error: err.message || 'Failed to generate podcast.' };
          renderMain();
        }
        break;
      }

      case 'run-deep-analysis': {
        const areaEl = document.getElementById('analysisPromptInput');
        if (areaEl) state.analysisPromptDraft = areaEl.value;
        if (!String(state.analysisPromptDraft || '').trim()) {
          state.jobStatus = { active: false, error: 'Please enter an analysis topic or question.' };
          renderMain();
          break;
        }
        try {
          state.jobStatus = { active: true, message: 'Starting deep multi-source analysis…' };
          renderMain();
          const report = await runOnDemandDeepAnalysis({
            prompt: state.analysisPromptDraft,
            category: 'Custom Deep Dive',
            appData: state.appData,
            prefs: state.prefs,
            onProgress: p => {
              state.jobStatus = { active: true, message: p.message };
              renderMain();
            }
          });
          state.prefs.localCustomAnalyses = [
            report,
            ...(state.prefs.localCustomAnalyses || []).filter(a => a.id !== report.id)
          ].slice(0, 25);
          saveUserPrefs(state.prefs);
          state.jobStatus = null;
          state.analysisPromptDraft = '';
          renderMain();
        } catch (err) {
          state.jobStatus = { active: false, error: err.message || 'Analysis failed.' };
          renderMain();
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
        if (authEl) state.prefs.authorName = authEl.value.trim() || 'Josh';
        if (passEl) state.prefs.groupPasscode = passEl.value.trim();
        if (urlEl) state.prefs.workerBaseUrl = urlEl.value.trim();
        saveUserPrefs(state.prefs);
        const shared = await fetchSharedWorkerFeed(state.prefs);
        if (shared) state.workerSharedFeed = shared;
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
      state.podDurationMin = Number(t.value || 5);
      renderMain();
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
    const shouldCheckEspn = manual || gameLive || wirePollCount % 2 === 0;

    const [addedTweets, espnChanged] = await Promise.all([
      hydrateLiveBlueskyBeatWire(state.appData),
      shouldCheckEspn ? hydrateLiveEspnOverlay(state.appData) : Promise.resolve(false)
    ]);

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
      cachedMonteCarloKey = '';
      cachedMonteCarloResult = null;
      hasNewUpstreamData = true;
    }

    const [addedLivePosts, espnMutated, podsMutated] = await Promise.all([
      hydrateLiveBlueskyBeatWire(state.appData),
      hydrateLiveEspnOverlay(state.appData),
      hydrateLive49ersPodcasts(state.appData)
    ]);
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

async function init() {
  applyTheme(state.prefs.theme);
  if (state.prefs?.capSelectedYear) {
    state.capSelectedYear = String(state.prefs.capSelectedYear);
  }
  audioController = new PodcastAudioController(renderMiniPlayer);
  bindEvents();

  try {
    state.appData = await loadAll49ersData();
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
        lastWireSyncAt: state.lastWireSyncAt
      }),
      getState: () => state,
      forceRender: () => {
        renderMain();
        if (state.sheetMode) renderSheet();
      }
    };

    renderHeaderAndPhaseBanner();
    renderMain();

    // Non-blocking real-time delta hydration (fresher GitHub Raw commits + live Bluesky beat wire + 6 podcasts)
    refreshLiveFeedsInBackground(false);

    // Start <1 min adaptive live tweet & in-game injury wire polling (20s in-game, 45s standard)
    scheduleAdaptiveSubMinuteWireLoop();

    // Non-blocking sync of shared Cloudflare Worker intelligence feed if configured
    fetchSharedWorkerFeed(state.prefs).then(shared => {
      if (shared) {
        state.workerSharedFeed = shared;
        if (state.activeNavTab === 'audio') renderMain();
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
        refreshLiveFeedsInBackground(false);
      }
    }, 5 * 60_000);

    // Instant sub-minute sync when waking the PWA/tab after >= 15s or reconnecting online
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') {
        if (Date.now() - lastLiveCheckMs >= 5 * 60_000) {
          refreshLiveFeedsInBackground(false);
        } else if (Date.now() - lastWirePollMs >= 15_000) {
          pollLowLatencyTweetAndInjuryWire(false);
        }
      }
    });
    window.addEventListener('focus', () => {
      if (Date.now() - lastWirePollMs >= 15_000) {
        pollLowLatencyTweetAndInjuryWire(false);
      }
    });
    window.addEventListener('online', () => {
      refreshLiveFeedsInBackground(false);
    });
  } catch (err) {
    const mainEl = document.getElementById('mainView');
    if (mainEl) {
      mainEl.innerHTML = `
        <div class="card">
          <div class="card-eyebrow" style="color:var(--crimson)">Feed Load Error</div>
          <h2 class="card-title">Unable to Load 49ers Data Feeds</h2>
          <p style="font-size:13px;color:var(--text-secondary)">${esc(err.message)}</p>
        </div>
      `;
    }
  }

  // Register Offline-Ready Service Worker (handle both pre-load and post-async-init readyState)
  if ('serviceWorker' in navigator) {
    const registerSw = () => {
      navigator.serviceWorker
        .register('./sw.js')
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
