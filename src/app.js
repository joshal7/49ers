/**
 * Main Application Controller for 49ers Faithful (https://49ers.joshal.com)
 */

import {
  applyTeamThemeToDocument,
  getActiveTeamConfig,
  isNflHubMode,
  resolveTeamFromHostname,
  setActiveTeamConfig
} from './config/teamRegistry.js';

const ACTIVE_TEAM =
  typeof window !== 'undefined' && window.location
    ? setActiveTeamConfig(
        window.__ACTIVE_TEAM_SLUG__ ||
          resolveTeamFromHostname(window.location.hostname, window.location.search)
      )
    : getActiveTeamConfig();
if (typeof document !== 'undefined') {
  applyTeamThemeToDocument(ACTIVE_TEAM);
  try {
    if (
      isNflHubMode() &&
      (window.navigator?.standalone === true ||
        window.matchMedia?.('(display-mode: standalone)')?.matches ||
        window.matchMedia?.('(display-mode: fullscreen)')?.matches ||
        window.matchMedia?.('(display-mode: minimal-ui)')?.matches)
    ) {
      window.sessionStorage?.setItem('nfl_hub_standalone_session_v1', '1');
    }
  } catch {}
}

import {
  ALL_DASHBOARD_BLOCKS,
  evaluateSeasonState,
  resolveHomeDashboardState
} from './engine/seasonStateMachine.js?v=64';
import { simulateCapScenario } from './engine/capSimulator.js?v=66';
import {
  runPlayoffMonteCarlo,
  buildOtherConferenceSimulatorConfig
} from './engine/playoffMonteCarlo.js?v=66';
import { filterNewsByUserPrefs } from './engine/antiFluffFilter.js';
import {
  canonicalOpponentHealthSnapshotKey,
  reconcileRosterAndHealthWithNews
} from './engine/injuryProbabilityModel.js';
import {
  is49ersGameLiveWindow,
  isCompletedGameAvailabilityCluster,
  isActiveInGameAvailabilityCluster,
  resolveGameNewsContext,
  sortNewsWithBreakingPriority,
  filterOutCompletedGameAvailabilityItems
} from './engine/breakingClassifier.js?v=68';
import { PodcastAudioController, formatTimeMmSs } from './components/audioPlayer.js?v=60';
import {
  loadAll49ersData,
  fetchFresherUpstreamData,
  dedupeRawStreamAtomically,
  hydrateLiveMultiSourceBeatWire,
  LIVE_WIRE_SOURCE_LABELS,
  hydrateLiveEspnOverlay,
  hydrateLive49ersPodcasts,
  fetchGamecastForGame,
  fetchLiveSituationFingerprint,
  getCachedGamecastModel,
  loadUserPrefs,
  saveUserPrefs
} from './services/dataService.js?v=104';
import {
  isNumericEspnGameId,
  resolveGamecastGamesList
} from './engine/gamecastEngine.js?v=1';
import {
  SHARED_GEMINI_KEY_STORAGE_KEY,
  appendSharedKeyHandoffToUrl,
  enablePasskeyKeySync,
  isEligibleE2eeSyncPasscode,
  isPasskeyPrfPotentiallySupported,
  loadCachedPasskeyVaultKeys,
  publishSharedGeminiApiKey,
  publishClearedSharedGeminiApiKey,
  readSameOriginSharedGeminiKey,
  syncPrefsWithSharedGeminiKeyVault,
  unlockAndSyncWithPasskey
} from './services/sharedApiKeyStore.js?v=4';
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
  clearDailyMatchupIntelAttemptLock,
  hydrateCachedDailyTopNewsBrief,
  hydrateDailyTopNewsBriefFromSharedKv,
  mergeDailyTopNewsBriefOnUpstreamRefresh,
  shouldTriggerDailyTopNewsBriefRefresh,
  refreshDailyTopNewsBriefIfDue,
  clearDailyNewsBriefAttemptLock
} from './services/aiWorkerClient.js?v=91';
import {
  deleteEpisodeAudioBlob,
  exportEpisodeShareableAudioFile
} from './services/podcastAudioStore.js';
import {
  buildShareablePodcastUrl,
  buildShareableAnalysisUrl,
  extractIncomingSharedRoute,
  shareItemNatively,
  shareAudioFileNatively
} from './services/shareService.js?v=62';

import {
  resolveNflTeamMeta,
  getRemoteTeamSheetThemeVars,
  findPlayerInTeamRoster,
  buildOpponentSeedPlayer,
  mergeRemoteAndLocalOpponentPlayer,
  fetchRemoteTeamBundle,
  getCachedRemoteTeamBundle,
  clearRemoteTeamCache
} from './services/remoteTeamDossierService.js?v=3';

import {
  esc,
  formatRelativeAge,
  rankBadgeClass,
  renderTeamLogoHtml,
  renderPlayerAvatarHtml,
  renderMiniMeterHtml,
  registerRosterPlayersForInlineLinks
} from './views/uiHelpers.js?v=53';
import { getJargonEntry } from './engine/jargonGlossary.js?v=50';
import {
  isAllowedInlineVideoStreamUrl,
  resolveIosStandaloneExternalVideoBreakoutUrl,
  sanitizeExternalUrl
} from './engine/linkIntegrity.js?v=71';
import {
  BIG_BOARD_SORT_FIELDS,
  parseBigBoardUrlParams,
  buildBigBoardUrlSearch,
  normalizeBigBoardLens,
  normalizeBigBoardSort
} from './engine/draftBigBoardEngine.js?v=56';
import { resolveLeaderboardModalModel } from './engine/statsLeaderboardEngine.js?v=49';
import { iconSvg } from './views/icons.js?v=86';
import { renderHomeDashboardHtml } from './views/homeView.js?v=93';
import {
  renderNewsViewHtml,
  VALID_NEWS_CATEGORIES
} from './views/newsView.js?v=95';
import { renderRosterCapViewHtml, ROSTER_SORT_FIELDS, normalizeRosterSort } from './views/rosterCapView.js?v=51';
import { renderPlayerDossierSheetHtml } from './views/playerSheetView.js?v=83';
import { renderSeasonMatchupViewHtml } from './views/seasonMatchupView.js?v=100';
import { renderAudioAiViewHtml } from './views/audioAiView.js?v=69';
import {
  renderSettingsSheetHtml,
  renderUniversalSearchSheetHtml,
  renderUniversalSearchResultsHtml,
  renderUniversalSearchScopeBarHtml
} from './views/settingsArchiveView.js?v=92';
import {
  normalizeNewsSortMode,
  computeCatchUpState,
  urlBase64ToUint8Array,
  evaluatePushSupportStatus,
  runUniversalSearch,
  normalizeSearchText
} from './engine/digestExperienceEngine.js?v=91';

const RECENT_SEARCHES_KEY = ACTIVE_TEAM.storageKeys?.recentSearches || '49ers_faithful_recent_searches_v1';

function loadRecentSearches() {
  try {
    const raw = JSON.parse(localStorage.getItem(RECENT_SEARCHES_KEY) || '[]');
    return Array.isArray(raw) ? raw.map(s => String(s || '').trim()).filter(Boolean).slice(0, 6) : [];
  } catch {
    return [];
  }
}

function saveRecentSearchTerm(term = '') {
  const clean = String(term || '').trim();
  if (!clean || clean.length < 2) return;
  const norm = clean.toLowerCase();
  const next = [clean, ...(state.recentSearches || []).filter(t => t.toLowerCase() !== norm)].slice(0, 6);
  state.recentSearches = next;
  try {
    localStorage.setItem(RECENT_SEARCHES_KEY, JSON.stringify(next));
  } catch {}
}

function clearRecentSearchTerms() {
  state.recentSearches = [];
  try {
    localStorage.removeItem(RECENT_SEARCHES_KEY);
  } catch {}
}

function syncTopHeaderHeight() {
  if (typeof document === 'undefined') return;
  const headerEl = document.querySelector('.top-header');
  if (!headerEl) return;
  const h = Math.ceil(headerEl.getBoundingClientRect().height || 0);
  if (h > 24) {
    document.documentElement.style.setProperty('--top-header-h', `${h}px`);
  }
}

function syncVisualViewportVars() {
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  const root = document.documentElement;
  if (!root) return;
  const vv = window.visualViewport;
  const layoutH = window.innerHeight || root.clientHeight || 0;
  const vvH = vv && Number.isFinite(vv.height) && vv.height > 120 ? Math.round(vv.height) : layoutH;
  const vvTop = vv && Number.isFinite(vv.offsetTop) ? Math.max(0, Math.round(vv.offsetTop)) : 0;
  const keyboardInset = vv ? Math.max(0, Math.round(layoutH - vv.height - vv.offsetTop)) : 0;
  if (vvH > 0) root.style.setProperty('--vv-height', `${vvH}px`);
  root.style.setProperty('--vv-offset-top', `${vvTop}px`);
  root.style.setProperty('--vv-keyboard-inset', `${keyboardInset}px`);
  root.classList.toggle('is-virtual-keyboard-open', keyboardInset > 110);
}

const state = {
  appData: null,
  prefs: loadUserPrefs(),
  seasonState: null,

  activeNavTab: 'home', // 'home' | 'news' | 'roster' | 'season' | 'audio'
  isCustomizingLayout: false,
  draggedBlockId: null,

  // News state
  newsCategoryFilter: 'all',
  newsSortMode: 'top', // 'top' (default) | 'latest'
  newsTopicFilter: 'all',
  newsSearchQuery: '',
  newsSourceFilter: null,
  activeVideosSet: new Set(),
  lastWireSyncAt: null,
  isSyncingWire: false,
  sessionLastVisitedAt: null,
  tabScrollPositions: {},
  universalSearchQuery: '',
  universalSearchScope: 'all',
  universalSearchSource: null,
  universalSearchForceLiteral: false,
  recentSearches: loadRecentSearches(),
  pushStatusNotice: '',

  // Roster & Cap state
  rosterSubTab: 'roster',
  rosterSearch: '',
  rosterUnitFilter: 'All',
  rosterPosFilter: 'ALL',
  rosterSort: 'jersey',
  rosterSortDir: 'asc',
  depthMode: 'projected',
  rosterMovesFilter: 'all',
  capSelectedYear: '2026',
  capViewMode: 'sim',
  capFaFilter: 'ALL',

  // Season & Temporal state
  seasonSubTab: 'matchup',
  draftSubTab: 'prep',
  userPickedSeasonSubDuringLive: false,
  matchupStatsUnit: 'offense',
  statsSubMode: 'ranks',
  teamPlayersCat: 'rec',
  teamPlayersSortKey: '',
  teamPlayersSortDir: 'desc',
  snapMatrixUnit: 'offense',
  schedulePrevExpanded: false,
  expandedRootingWeeks: new Set(),
  playoffStandingsView: 'picture',
  playoffStandingsConf: ACTIVE_TEAM.conference || 'NFC',
  playoffSeedBarsExpanded: false,
  // Gamecast (Live & Historical Box Score / Team Stats / Play-by-Play) state
  gamecastGameId: null,
  gamecastTab: null, // 'box' | 'team' | 'pbp' | null (auto: 'pbp' when live, 'box' when final)
  gamecastBoxTeam: 'team',
  gamecastBoxUnit: 'all',
  gamecastPbpFilter: 'all',
  gamecastPbpQuarter: 'ALL',
  gamecastPbpOrder: 'newest',
  gamecastExpandedDrives: new Set(),
  gamecastFromSchedule: false,
  gamecastModelsById: new Map(),
  gamecastLoadingId: null,
  gamecastSyncing: false,
  gamecastFieldAnimKey: 0,
  gamecastLastSituationFp: '',
  activeGamecastClipKey: '',
  combineSearch: '',
  bigBoardSearch: '',
  bigBoardPosFilter: 'ALL',
  bigBoardPositions: [],
  bigBoardLens: 'consensus',
  bigBoardSortField: 'consensus',
  bigBoardSortDir: 'asc',
  bigBoardRange: 'all',
  bigBoardAgreement: 'all',
  bigBoardRankedOnly: false,
  bigBoardFilterDrawerOpen: false,
  bigBoardExpanded: false,
  bigBoardShowAll: false,
  bigBoardExpandedIds: new Set(),
  bigBoardShareCopied: false,
  expandedDraftSpiderIdx: -1,

  // Audio & AI Studio state
  studioSubTab: 'beat_podcasts',
  beatPodViewMode: 'date',
  beatPodShowFilter: 'all',
  podDurationMin: 3,
  podFormat: 'two_host',
  podTopicDraft: '',
  analysisPromptDraft: '',
  geminiKeyNotice: '',
  showGeminiKeyGuide: false,
  showPasskeySyncOffer: false,
  passkeyNeedsSecondTap: false,
  passkeyBusy: false,
  passkeyNotice: '',
  jobStatus: null,
  sharedAudioPrep: null,
  sharedAnalysisHighlightId: null,
  workerSharedFeed: { analyses: [], episodes: [] },
  audioState: {},
  expandedTranscriptIds: new Set(),
  shareToastTargetId: null,

  // Bottom Sheet & Rank Modal state
  sheetMode: null, // 'player' | 'settings' | 'search' | null
  sheetPlayerId: null,
  sheetRemoteContext: null, // { teamMeta, query, seedPlayer, bundle, remotePlayer, status, error }
  sheetPlayerTab: 'overview',
  sheetPlayerStatsMode: '2026',
  sheetPlayerGameLogSub: 'games',
  sheetPlayerTxScenario: 'cut',
  sheetPlayerMentionsSort: 'top',
  reporterSearch: '',
  rankModal: null // { scope: 'team' | 'player', key: string, playerId: string | null }
};

let audioController = null;
const inMemorySharedVoiceKeys = new Map();
let cachedMonteCarloKey = '';
let cachedMonteCarloResult = null;
let cachedOtherConfMcKey = '';
let cachedOtherConfMcResult = null;
let cachedOtherConfBaselineResult = null;

function invalidateMonteCarloCaches() {
  cachedMonteCarloKey = '';
  cachedMonteCarloResult = null;
  cachedOtherConfMcKey = '';
  cachedOtherConfMcResult = null;
  cachedOtherConfBaselineResult = null;
}
let activeJargonAnchor = null;
let remoteSheetRequestSeq = 0;

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

  const dynDraftYr = Number(state.appData?.seasonal?.draftPrep2027?.draftYear) || 2027;
  const safeLinks = Array.isArray(entry.links)
    ? entry.links
        .map(lnk => {
          const rawUrl = String(lnk?.url || '').replace(/2027(?=\/|-|\.asp)/g, String(dynDraftYr));
          const safeUrl = sanitizeExternalUrl(rawUrl, null);
          return safeUrl && lnk?.label ? { label: String(lnk.label), url: safeUrl } : null;
        })
        .filter(Boolean)
    : [];

  activeJargonAnchor = anchorEl;
  pop.setAttribute('aria-label', `${entry.term} definition`);
  pop.innerHTML = `
    <div class="jargon-popover-head">
      <div>
        <div class="jargon-popover-cat">${esc(entry.category)}</div>
        <div class="jargon-popover-title">${esc(entry.term)}</div>
        ${entry.badge ? `<div class="jargon-popover-badge">${esc(entry.badge)}</div>` : ''}
      </div>
      <button type="button" class="jargon-popover-close" data-action="close-jargon-popover" aria-label="Close definition">✕</button>
    </div>
    <div class="jargon-popover-body">${esc(entry.definition)}</div>
    ${
      safeLinks.length > 0
        ? `<div class="jargon-popover-links" aria-label="Data Sources">${safeLinks
            .map(
              l => `<a href="${esc(l.url)}" target="_blank" rel="noopener noreferrer" class="source-chip-link jargon-popover-link"><span>${esc(l.label)}</span>${iconSvg('externalLink', 9)}</a>`
            )
            .join('')}</div>`
        : ''
    }
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

function syncBigBoardUrlIfActive({ includeDraftNav = false } = {}) {
  try {
    if (state.activeNavTab !== 'season' || state.seasonSubTab !== 'draft_prep') return;
    const nextSearch = buildBigBoardUrlSearch(window.location.search || '', {
      lens: state.bigBoardLens,
      sortField: state.bigBoardSortField,
      sortDir: state.bigBoardSortDir,
      positions: state.bigBoardPositions,
      posGroup: state.bigBoardPosFilter,
      range: state.bigBoardRange,
      agreement: state.bigBoardAgreement,
      rankedOnly: state.bigBoardRankedOnly,
      search: state.bigBoardSearch,
      includeDraftNav
    });
    const nextUrl = `${window.location.pathname}${nextSearch}${window.location.hash || ''}`;
    if (nextUrl !== `${window.location.pathname}${window.location.search}${window.location.hash}`) {
      window.history.replaceState(null, '', nextUrl);
    }
  } catch {
    // ignore history errors in restricted contexts
  }
}

function resetBigBoardState() {
  state.bigBoardSearch = '';
  state.bigBoardPosFilter = 'ALL';
  state.bigBoardPositions = [];
  state.bigBoardLens = 'consensus';
  state.bigBoardSortField = 'consensus';
  state.bigBoardSortDir = 'asc';
  state.bigBoardRange = 'all';
  state.bigBoardAgreement = 'all';
  state.bigBoardRankedOnly = false;
  state.bigBoardShowAll = false;
}

function applyTheme(theme) {
  const clean = theme === 'light' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', clean);
  const metaTheme = document.getElementById('metaThemeColor');
  if (metaTheme) {
    const lightColor = ACTIVE_TEAM.themes?.light?.themeColor || '#F7F5F0';
    const darkColor = ACTIVE_TEAM.themes?.dark?.themeColor || '#0B0D10';
    metaTheme.setAttribute('content', clean === 'light' ? lightColor : darkColor);
  }
  const metaStatusBar = document.getElementById('metaStatusBarStyle');
  if (metaStatusBar) {
    metaStatusBar.setAttribute('content', clean === 'light' ? 'default' : 'black');
  }
}

function applyFeedDensity(density) {
  const clean = density === 'compact' ? 'compact' : 'rich';
  document.documentElement.setAttribute('data-feed-density', clean);
}

function getActiveScrollMemoryKey() {
  if (state.activeNavTab === 'season') return `season:${state.seasonSubTab}`;
  if (state.activeNavTab === 'roster') return `roster:${state.rosterSubTab}`;
  if (state.activeNavTab === 'audio') return `audio:${state.studioSubTab}`;
  return state.activeNavTab || 'home';
}

function saveCurrentTabScroll() {
  const key = getActiveScrollMemoryKey();
  state.tabScrollPositions[key] = Math.max(0, Math.round(window.scrollY || 0));
}

function restoreScrollForCurrentTab({ fallbackTop = 0 } = {}) {
  const key = getActiveScrollMemoryKey();
  const saved = Number(state.tabScrollPositions[key]);
  const targetY = Number.isFinite(saved) && saved >= 0 ? saved : fallbackTop;
  requestAnimationFrame(() => {
    window.scrollTo({ top: targetY, behavior: 'instant' });
  });
}

function markReadKey(key) {
  const clean = String(key || '').trim();
  if (!clean) return;
  const cur = Array.isArray(state.prefs.readItemKeys) ? state.prefs.readItemKeys : [];
  if (!cur.includes(clean)) {
    state.prefs.readItemKeys = [...cur.slice(-399), clean];
    saveUserPrefs(state.prefs);
  }
  document.querySelectorAll(`[data-read-key="${CSS.escape(clean)}"]`).forEach(el => {
    el.classList.add('is-read-item');
    el.classList.remove('is-new-item');
    const dot = el.querySelector('.new-item-dot');
    if (dot) dot.remove();
  });
  syncNavUnreadBadge();
}

function markAllCaughtUp() {
  const nowIso = new Date().toISOString();
  state.prefs.lastVisitedAt = nowIso;
  state.sessionLastVisitedAt = nowIso;
  saveUserPrefs(state.prefs);
  syncNavUnreadBadge();
  renderMain();
}

function syncNavUnreadBadge() {
  const newsTabBtn = document.querySelector('.nav-tab-btn[data-nav-tab="news"]');
  if (!newsTabBtn || !state.appData) return;
  let badge = newsTabBtn.querySelector('.nav-unread-dot');
  const filteredRaw = filterNewsByUserPrefs(
    state.appData.news?.rawStream || [],
    getReportersMap(),
    state.prefs
  );
  const catchUp = computeCatchUpState(
    filteredRaw,
    {
      lastVisitedAt: state.sessionLastVisitedAt,
      readKeys: state.prefs.readItemKeys || []
    },
    Date.now()
  );
  if (catchUp.hasWatermark && catchUp.newCount > 0) {
    if (!badge) {
      badge = document.createElement('span');
      badge.className = 'nav-unread-dot mono';
      badge.setAttribute('aria-label', `${catchUp.newCount} new updates`);
      newsTabBtn.appendChild(badge);
    }
    badge.textContent = catchUp.newCount > 9 ? '9+' : String(catchUp.newCount);
  } else if (badge) {
    badge.remove();
  }
}

function countObservedPracticeSlots(row = {}) {
  return [row?.wed, row?.thu, row?.fri].filter(v => {
    const s = String(v ?? '').trim();
    return Boolean(s) && s !== '-' && s !== '—';
  }).length;
}

function buildPracticeSlotSig(row = {}) {
  return `${row?.wed || '-'}/${row?.thu || '-'}/${row?.fri || '-'}`;
}

function buildHealthSnapshotMap(rows = [], keyFn = r => (r?.playerId ? String(r.playerId) : '')) {
  const map = {};
  for (const r of rows || []) {
    const key = keyFn(r);
    if (!key) continue;
    const pct = Number(r.playProbabilityPct ?? 0);
    if (!Number.isFinite(pct)) continue;
    map[key] = {
      playProbabilityPct: pct,
      currentPct: pct,
      currentSig: buildPracticeSlotSig(r),
      daysCount: countObservedPracticeSlots(r),
      wed: r.wed || '-',
      thu: r.thu || '-',
      fri: r.fri || '-'
    };
  }
  return map;
}

function getCurrentOppHealthContext(appData) {
  const um = appData?.scheduleMatchup?.upcomingMatchup || {};
  const oppAbbr = String(um?.oppAbbr || 'OPP')
    .trim()
    .toUpperCase();
  const oppWeek = Number(um?.week || appData?.health?.week || appData?.meta?.currentWeek || 0) || null;
  const oppRows = um?.opponentHealth?.injuryReport || [];
  const oppHealthKey = oppWeek && oppAbbr ? `${oppWeek}:${oppAbbr}` : null;
  return { oppAbbr, oppWeek, oppRows, oppHealthKey };
}

function mergeHealthSnapshotTransitions(existingMap = {}, rows = [], keyFn) {
  const nextMap = { ...(existingMap || {}) };
  let changed = false;

  for (const r of rows || []) {
    const key = keyFn(r);
    const pct = Number(r?.playProbabilityPct);
    if (!key || !Number.isFinite(pct)) continue;

    const sig = buildPracticeSlotSig(r);
    const days = countObservedPracticeSlots(r);
    const prev = nextMap[key];

    if (!prev) {
      nextMap[key] = {
        playProbabilityPct: pct,
        currentPct: pct,
        currentSig: sig,
        daysCount: days,
        wed: r.wed || '-',
        thu: r.thu || '-',
        fri: r.fri || '-'
      };
      changed = true;
      continue;
    }

    const prevDays = Number.isFinite(Number(prev.daysCount))
      ? Number(prev.daysCount)
      : countObservedPracticeSlots(prev);
    const prevSig = typeof prev.currentSig === 'string' ? prev.currentSig : buildPracticeSlotSig(prev);
    const prevCurrent = Number.isFinite(Number(prev.currentPct))
      ? Number(prev.currentPct)
      : Number(prev.playProbabilityPct);

    // Ignore completely blank fallback flashes (days === 0) when a real practice report was already cached,
    // but self-heal when live official sync has fewer non-blank days than a stale/poisoned earlier snapshot
    if (days < prevDays) {
      if (days === 0) continue;
      nextMap[key] = {
        playProbabilityPct: pct,
        currentPct: pct,
        currentSig: sig,
        daysCount: days,
        wed: r.wed || '-',
        thu: r.thu || '-',
        fri: r.fri || '-'
      };
      changed = true;
      continue;
    }

    if (sig !== prevSig) {
      nextMap[key] = {
        playProbabilityPct: Number.isFinite(prevCurrent) ? prevCurrent : pct,
        currentPct: pct,
        currentSig: sig,
        daysCount: days,
        wed: r.wed || '-',
        thu: r.thu || '-',
        fri: r.fri || '-'
      };
      changed = true;
    } else if (Number.isFinite(prevCurrent) && Math.abs(pct - prevCurrent) >= 5) {
      nextMap[key] = {
        playProbabilityPct: prevCurrent,
        currentPct: pct,
        currentSig: sig,
        daysCount: days,
        wed: r.wed || '-',
        thu: r.thu || '-',
        fri: r.fri || '-'
      };
      changed = true;
    }
  }

  return { nextMap, changed };
}

function captureDeltaSnapshotsOnBoot(appData) {
  if (!appData) return;
  const curWeek = Number(appData?.health?.week || appData?.meta?.currentWeek || 0) || null;
  const { oppAbbr, oppRows, oppHealthKey } = getCurrentOppHealthContext(appData);
  const oppKeyFn = r => canonicalOpponentHealthSnapshotKey(r, oppAbbr);
  const existing = state.prefs.deltaSnapshots || {
    week: null,
    healthWeek: null,
    healthByPlayer: {},
    oppHealthKey: null,
    oppHealthByPlayer: {},
    statsByKey: {},
    playoffBaseline: null
  };

  // Seed initial baseline snapshot on first visit, or roll forward cleanly when NFL week advances
  const needsSeed = !existing.week || Object.keys(existing.healthByPlayer || {}).length === 0;
  const weekAdvanced = curWeek && existing.week && curWeek > existing.week;

  if (needsSeed) {
    const healthByPlayer = buildHealthSnapshotMap(appData?.health?.practiceReport || []);
    const oppHealthByPlayer = buildHealthSnapshotMap(oppRows, oppKeyFn);
    const statsByKey = {};
    for (const u of appData?.scheduleMatchup?.teamStats?.units || []) {
      if (u?.overall?.key && Number.isFinite(Number(u.overall.rank))) {
        statsByKey[u.overall.key] = { rank: Number(u.overall.rank) };
      }
    }
    const baseSf = appData?.seasonal?.playoffPicture?.baselineSimulation?.sfOdds || null;
    state.prefs.deltaSnapshots = {
      week: curWeek,
      healthWeek: curWeek,
      healthByPlayer,
      oppHealthKey,
      oppHealthByPlayer,
      statsByKey,
      playoffBaseline: baseSf
        ? {
            makePlayoffsPct: baseSf.makePlayoffsPct,
            winDivisionPct: baseSf.winDivisionPct,
            seed1ByePct: baseSf.seed1ByePct
          }
        : null
    };
    saveUserPrefs(state.prefs);
  } else if (weekAdvanced) {
    // Roll weekly health baselines immediately so prior-week injury percentages never leak into the new week,
    // while keeping prior-week team stats / playoff baselines visible for this session until hide.
    const existingHealthWk = Number(existing.healthWeek || existing.week || 0);
    if (curWeek > existingHealthWk || (oppHealthKey && existing.oppHealthKey !== oppHealthKey)) {
      state.prefs.deltaSnapshots = {
        ...existing,
        healthWeek: curWeek,
        healthByPlayer: buildHealthSnapshotMap(appData?.health?.practiceReport || []),
        oppHealthKey,
        oppHealthByPlayer: buildHealthSnapshotMap(oppRows, oppKeyFn)
      };
      saveUserPrefs(state.prefs);
    }
    state._pendingWeekSnapshotRollover = curWeek;
  } else if (
    oppHealthKey &&
    (existing.oppHealthKey !== oppHealthKey || Object.keys(existing.oppHealthByPlayer || {}).length === 0) &&
    oppRows.length > 0
  ) {
    state.prefs.deltaSnapshots = {
      ...existing,
      oppHealthKey,
      oppHealthByPlayer: buildHealthSnapshotMap(oppRows, oppKeyFn)
    };
    saveUserPrefs(state.prefs);
  }
}

/**
 * Last-distinct-state transition tracker for weekly injury probability deltas (both 49ers & Upcoming Opponent).
 * - Runs atomically AFTER both ESPN overlay and live beat wire complete so mid-hydration states never flicker.
 * - Seeds newly surfaced mid-week injury reportees so subsequent Thu/Fri changes display exact % deltas.
 * - Never regresses a snapshot backwards to an earlier blank (`-/-/-`) static bundle state within the same week.
 */
function syncHealthDeltaSnapshots(appData) {
  if (!appData || appData._awaitingInitialLiveWireSync) return;
  // Do not overwrite weekly mid-week practice trajectory snapshots with resolved game-day 0%/99% states
  if (appData?.health?.gameDayRoster?.isActive) return;
  const rows = appData?.health?.practiceReport || [];
  const { oppAbbr, oppRows, oppHealthKey } = getCurrentOppHealthContext(appData);
  if (rows.length === 0 && oppRows.length === 0) return;

  const curWeek = Number(appData?.health?.week || appData?.meta?.currentWeek || 0) || null;
  const oppKeyFn = r => canonicalOpponentHealthSnapshotKey(r, oppAbbr);
  const snap = state.prefs.deltaSnapshots || {
    week: curWeek,
    healthWeek: curWeek,
    healthByPlayer: {},
    oppHealthKey,
    oppHealthByPlayer: {},
    statsByKey: {},
    playoffBaseline: null
  };
  const prevHealthWk = Number(snap.healthWeek || snap.week || 0);
  if (curWeek && prevHealthWk && curWeek > prevHealthWk) {
    state.prefs.deltaSnapshots = {
      ...snap,
      healthWeek: curWeek,
      healthByPlayer: buildHealthSnapshotMap(rows),
      oppHealthKey,
      oppHealthByPlayer: buildHealthSnapshotMap(oppRows, oppKeyFn)
    };
    saveUserPrefs(state.prefs);
    return;
  }

  let changed = false;
  let healthByPlayer = snap.healthByPlayer || {};
  if (rows.length > 0) {
    const sfRes = mergeHealthSnapshotTransitions(healthByPlayer, rows, r => (r?.playerId ? String(r.playerId) : ''));
    healthByPlayer = sfRes.nextMap;
    if (sfRes.changed) changed = true;
  }

  let oppHealthByPlayer = snap.oppHealthByPlayer || {};
  let nextOppHealthKey = snap.oppHealthKey || oppHealthKey;
  if (oppRows.length > 0) {
    if (oppHealthKey && snap.oppHealthKey !== oppHealthKey) {
      oppHealthByPlayer = buildHealthSnapshotMap(oppRows, oppKeyFn);
      nextOppHealthKey = oppHealthKey;
      changed = true;
    } else {
      const oppRes = mergeHealthSnapshotTransitions(oppHealthByPlayer, oppRows, oppKeyFn);
      oppHealthByPlayer = oppRes.nextMap;
      if (oppRes.changed) changed = true;
    }
  }

  if (changed) {
    state.prefs.deltaSnapshots = {
      ...snap,
      healthWeek: curWeek || snap.healthWeek || snap.week,
      healthByPlayer,
      oppHealthKey: nextOppHealthKey,
      oppHealthByPlayer
    };
    saveUserPrefs(state.prefs);
  }
}

function commitPendingWeekSnapshotRollover() {
  const nextWk = state._pendingWeekSnapshotRollover;
  if (!nextWk || !state.appData) return;
  const statsByKey = {};
  for (const u of state.appData?.scheduleMatchup?.teamStats?.units || []) {
    if (u?.overall?.key && Number.isFinite(Number(u.overall.rank))) {
      statsByKey[u.overall.key] = { rank: Number(u.overall.rank) };
    }
  }
  const baseSf = state.appData?.seasonal?.playoffPicture?.baselineSimulation?.sfOdds || null;
  state.prefs.deltaSnapshots = {
    ...(state.prefs.deltaSnapshots || {}),
    week: nextWk,
    healthWeek: nextWk,
    statsByKey,
    playoffBaseline: baseSf
      ? {
          makePlayoffsPct: baseSf.makePlayoffsPct,
          winDivisionPct: baseSf.winDivisionPct,
          seed1ByePct: baseSf.seed1ByePct
        }
      : state.prefs.deltaSnapshots?.playoffBaseline || null
  };
  state._pendingWeekSnapshotRollover = null;
  saveUserPrefs(state.prefs);
}

async function toggleQuietPushAlerts() {
  const pushPrefs = state.prefs.pushAlerts || {
    enabled: false,
    channels: { tier1Breaking: true, dailyBriefReady: true, practiceDowngrades: false },
    subscribedAt: null,
    endpoint: ''
  };
  const workerBase = String(state.prefs?.workerBaseUrl || '').trim().replace(/\/+$/, '');

  if (pushPrefs.enabled) {
    // Disable cleanly
    try {
      const reg = await navigator.serviceWorker?.ready;
      const sub = await reg?.pushManager?.getSubscription?.();
      if (sub) {
        const endpoint = sub.endpoint;
        await sub.unsubscribe().catch(() => {});
        if (workerBase && /^https:\/\//i.test(workerBase)) {
          fetch(`${workerBase}/api/push-unsubscribe`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ endpoint })
          }).catch(() => {});
        }
      }
    } catch {}
    state.prefs.pushAlerts = { ...pushPrefs, enabled: false, endpoint: '', subscribedAt: null };
    state.pushStatusNotice = 'Quiet alerts turned off.';
    saveUserPrefs(state.prefs);
    renderSheet({ preserveScroll: true });
    return;
  }

  const support = evaluatePushSupportStatus();
  if (support.reason === 'ios_requires_pwa') {
    state.pushStatusNotice = 'On iPhone, tap Safari Share → Add to Home Screen first to enable Web Push.';
    renderSheet({ preserveScroll: true });
    return;
  }

  if (typeof Notification === 'undefined') {
    state.pushStatusNotice = 'Notifications are not supported in this browser.';
    renderSheet({ preserveScroll: true });
    return;
  }

  let perm = Notification.permission;
  if (perm === 'default') {
    try {
      perm = await Notification.requestPermission();
    } catch {
      perm = 'denied';
    }
  }
  if (perm !== 'granted') {
    state.pushStatusNotice = 'Notification permission was blocked. Enable it in browser site settings.';
    renderSheet({ preserveScroll: true });
    return;
  }

  let subscribedEndpoint = '';
  let noticeMsg = 'Quiet alerts active on this device.';

  if (workerBase && /^https:\/\//i.test(workerBase) && 'serviceWorker' in navigator && 'PushManager' in window) {
    try {
      const cfgRes = await fetch(`${workerBase}/api/push-config`, { signal: AbortSignal.timeout(4500) });
      const cfg = cfgRes.ok ? await cfgRes.json() : null;
      if (cfg?.vapidPublicKey) {
        const reg = await navigator.serviceWorker.ready;
        const existingSub = await reg.pushManager.getSubscription();
        const sub =
          existingSub ||
          (await reg.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: urlBase64ToUint8Array(cfg.vapidPublicKey)
          }));
        subscribedEndpoint = sub.endpoint || '';
        const saveRes = await fetch(`${workerBase}/api/push-subscribe`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            subscription: sub.toJSON(),
            channels: pushPrefs.channels,
            author: state.prefs.authorName || ACTIVE_TEAM.brandName
          })
        });
        if (saveRes.ok) {
          noticeMsg = 'Quiet Web Push alerts connected to Worker.';
        }
      }
    } catch {
      noticeMsg = 'Quiet alerts active locally (Worker push sync skipped).';
    }
  }

  state.prefs.pushAlerts = {
    ...pushPrefs,
    enabled: true,
    endpoint: subscribedEndpoint,
    subscribedAt: new Date().toISOString()
  };
  state.pushStatusNotice = noticeMsg;
  saveUserPrefs(state.prefs);
  renderSheet({ preserveScroll: true });
}

async function sendTestQuietAlert() {
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted') {
    state.pushStatusNotice = 'Enable browser notification permission first.';
    renderSheet({ preserveScroll: true });
    return;
  }
  const title = `${ACTIVE_TEAM.brandName} · Quiet Alert Test`;
  const tzDailyLabel =
    ACTIVE_TEAM.timezone === 'America/Los_Angeles'
      ? '5:00 PM PT'
      : ACTIVE_TEAM.timezone === 'America/Denver' || ACTIVE_TEAM.timezone === 'America/Phoenix'
        ? '6:00 PM MT'
        : ACTIVE_TEAM.timezone === 'America/Chicago'
          ? '7:00 PM CT'
          : '8:00 PM ET';
  const body = `High-signal alerts only (Tier-1 breaking & ${tzDailyLabel} daily brief). Zero score spam.`;
  const alertIcon = ACTIVE_TEAM.assets?.appleTouchIconPng || './apple-touch-icon.png';
  try {
    const reg = await navigator.serviceWorker?.ready;
    if (reg?.showNotification) {
      await reg.showNotification(title, {
        body,
        icon: alertIcon,
        tag: `${ACTIVE_TEAM.slug}-quiet-test`
      });
    } else {
      new Notification(title, { body, icon: alertIcon });
    }
    state.pushStatusNotice = 'Test alert sent.';
  } catch {
    state.pushStatusNotice = 'Test alert triggered (check device notification center).';
  }
  renderSheet({ preserveScroll: true });
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
    targetTeam: ACTIVE_TEAM.abbr,
    conference: ACTIVE_TEAM.conference,
    forcedWinners: overrides,
    iterations: 10000,
    seed: 492026
  });
  return cachedMonteCarloResult;
}

function getOtherConferenceMonteCarloPair() {
  const inputs = state.appData?.seasonal?.playoffPicture?.simulatorInputs;
  if (!inputs) return { baseline: null, active: null };
  const otherConf = (ACTIVE_TEAM.conference || 'NFC') === 'AFC' ? 'NFC' : 'AFC';
  const otherCfg = buildOtherConferenceSimulatorConfig(inputs, otherConf);
  if (!otherCfg) return { baseline: null, active: null };

  if (!cachedOtherConfBaselineResult) {
    cachedOtherConfBaselineResult = runPlayoffMonteCarlo({
      ...otherCfg,
      iterations: 2500,
      seed: 492026
    });
  }

  const overrides = state.prefs.playoffForcedWinners || {};
  const overrideKeys = Object.keys(overrides);
  if (overrideKeys.length === 0) {
    return {
      baseline: cachedOtherConfBaselineResult,
      active: cachedOtherConfBaselineResult
    };
  }
  const key = JSON.stringify(overrides);
  if (key === cachedOtherConfMcKey && cachedOtherConfMcResult) {
    return {
      baseline: cachedOtherConfBaselineResult,
      active: cachedOtherConfMcResult
    };
  }
  cachedOtherConfMcKey = key;
  cachedOtherConfMcResult = runPlayoffMonteCarlo({
    ...otherCfg,
    forcedWinners: overrides,
    iterations: 2500,
    seed: 492026
  });
  return {
    baseline: cachedOtherConfBaselineResult,
    active: cachedOtherConfMcResult
  };
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

function getSavedAnalyses() {
  const activeList = getAllAnalyses().filter(
    item => !isCompletedGameAvailabilityCluster(item, state.appData)
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

function syncLiveWireButtonsDom() {
  const syncAnchorIso = state.lastWireSyncAt || state.appData?.meta?.updatedAt || '';
  const syncAge = syncAnchorIso ? formatRelativeAge(syncAnchorIso) : '1m ago';
  const syncing = Boolean(state.isSyncingWire);

  const sheetSyncBtn = document.getElementById('sheetSyncWireBtn');
  if (sheetSyncBtn) {
    if (state.sheetMode === 'player' && state.appData) {
      sheetSyncBtn.hidden = false;
      sheetSyncBtn.classList.toggle('is-syncing', syncing);
      sheetSyncBtn.setAttribute('aria-busy', syncing ? 'true' : 'false');
      sheetSyncBtn.innerHTML = `${iconSvg(syncing ? 'loader' : 'bolt', 12, syncing ? 'wire-sync-spin' : '')}<span id="sheetSyncWireLabel">${syncing ? 'Sync…' : esc(syncAge)}</span>`;
    } else {
      sheetSyncBtn.hidden = true;
      sheetSyncBtn.classList.remove('is-syncing');
      sheetSyncBtn.setAttribute('aria-busy', 'false');
    }
  }

  document
    .querySelectorAll('#mainView [data-action="sync-live-wire-now"]')
    .forEach(btn => {
      btn.classList.toggle('is-syncing', syncing);
      btn.setAttribute('aria-busy', syncing ? 'true' : 'false');
      btn.innerHTML = `${iconSvg(syncing ? 'loader' : 'bolt', 12, syncing ? 'wire-sync-spin' : '')}<span>${syncing ? 'Sync…' : esc(syncAge)}</span>`;
    });
}

const TAB_HEADER_TITLES = {
  home: ACTIVE_TEAM.brandName || '49ers Faithful',
  news: 'News & Film',
  season: 'Game & Season',
  roster: 'Roster & Cap',
  audio: 'Audio & AI'
};

function formatCompactHeaderStanding(rawSummary = '') {
  const fallbackDiv = ACTIVE_TEAM.division || 'NFC West';
  const clean = String(rawSummary || '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!clean) return fallbackDiv;
  const parts = clean
    .split(/\s*[•·]\s*/)
    .map(part =>
      part
        .replace(/\bin\s+((?:NFC|AFC)\s+(?:North|South|East|West))\b/i, '$1')
        .replace(/\bWild\s*Card\s+in\s+(?:NFC|AFC)\b/i, 'Seed')
        .replace(/\bSeed\s+in\s+(?:NFC|AFC)\b/i, 'Seed')
        .replace(/\bin\s+(NFC|AFC)\b/i, '$1')
        .trim()
    )
    .filter(p => p && !/^outside\s+playoffs$/i.test(p) && !/^eliminated$/i.test(p));
  return parts.length > 0 ? parts.slice(0, 2).join(' · ') : fallbackDiv;
}

function renderHeader() {
  const activeTab = state.activeNavTab || 'home';
  const topHeaderEl = document.querySelector('.top-header');
  if (topHeaderEl) {
    topHeaderEl.setAttribute('data-active-tab', activeTab);
  }
  const titleEl = document.getElementById('headerTitleText');
  if (titleEl) {
    titleEl.textContent = TAB_HEADER_TITLES[activeTab] || ACTIVE_TEAM.brandName || '49ers Faithful';
  }
  if (!state.appData) {
    syncTopHeaderHeight();
    return;
  }
  const m = state.appData.meta || {};
  const recPill = document.getElementById('headerRecordPill');
  const subStatus = document.getElementById('headerSubStatus');
  if (recPill) recPill.textContent = m.teamRecord || '—';
  if (subStatus) {
    const compactStanding = formatCompactHeaderStanding(m.standingSummary || ACTIVE_TEAM.division || 'NFC West');
    const syncAge = formatRelativeAge(state.lastWireSyncAt || m.updatedAt);
    subStatus.innerHTML = `<span class="header-standing-text">${esc(compactStanding)}</span><span class="header-sub-sep" aria-hidden="true">·</span><span class="header-live-sync" title="Live data synced ${esc(syncAge)}"><span class="live-pulse-dot" aria-hidden="true"></span><span><span class="header-sync-verb">Synced </span>${esc(syncAge)}</span></span>`;
  }
  syncLiveWireButtonsDom();
  syncTopHeaderHeight();
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
      const { orderedBlocks } = resolveHomeDashboardState();
      mainEl.innerHTML = renderHomeDashboardHtml({
        orderedBlocks,
        appData: state.appData,
        simCapResult: homeSimCapResult,
        mcSimResult,
        filteredRawItems,
        userPrefs: state.prefs,
        activeVideosSet: state.activeVideosSet,
        sessionLastVisitedAt: state.sessionLastVisitedAt
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
        newsSortMode: state.newsSortMode,
        newsTopicFilter: state.newsTopicFilter,
        newsSearchQuery: state.newsSearchQuery,
        newsSourceFilter: state.newsSourceFilter,
        filteredRawItems,
        reportersById: reportersMap,
        activeVideosSet: state.activeVideosSet,
        userPrefs: state.prefs,
        lastWireSyncAt: state.lastWireSyncAt || state.appData.meta?.updatedAt,
        isSyncingWire: state.isSyncingWire,
        sessionLastVisitedAt: state.sessionLastVisitedAt
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
        rosterMovesFilter: state.rosterMovesFilter,
        capSelectedYear: activeCapYear,
        capViewMode: state.capViewMode,
        capFaFilter: state.capFaFilter,
        appData: state.appData,
        simCapResult: rosterSimCapResult,
        userCapMoves: activeYearMoves
      });
    } else if (tab === 'season') {
      const mcSimResult =
        state.seasonSubTab === 'playoffs' || state.seasonSubTab === 'schedule' || state.seasonSubTab === 'gamecast'
          ? getMonteCarloResult()
          : null;
      const otherConfMcPair =
        state.seasonSubTab === 'playoffs' ? getOtherConferenceMonteCarloPair() : { baseline: null, active: null };
      const resolvedGcInfo =
        state.seasonSubTab === 'gamecast' ? resolveGamecastGamesList(state.appData, mcSimResult) : null;
      const activeGcId =
        resolvedGcInfo
          ? (state.gamecastGameId && resolvedGcInfo.games.some(g => g.id === String(state.gamecastGameId))
              ? String(state.gamecastGameId)
              : resolvedGcInfo.defaultGameId)
          : null;
      const activeGcMeta = resolvedGcInfo?.games?.find(g => g.id === activeGcId) || null;
      const activeGcModel =
        (activeGcId && state.gamecastModelsById.get(activeGcId)) ||
        (activeGcId && getCachedGamecastModel(activeGcId)) ||
        null;
      const resolvedGcTab =
        state.gamecastTab ||
        (activeGcModel?.isLive || activeGcMeta?.isLive ? 'pbp' : 'box');
      mainEl.innerHTML = renderSeasonMatchupViewHtml({
        seasonSub: state.seasonSubTab,
        draftSub: state.draftSubTab,
        appData: state.appData,
        mcSimResult,
        otherConfMcSimResult: otherConfMcPair.active,
        otherConfBaselineSimResult: otherConfMcPair.baseline,
        playoffStandingsView: state.playoffStandingsView,
        playoffStandingsConf: state.playoffStandingsConf,
        playoffSeedBarsExpanded: state.playoffSeedBarsExpanded,
        forcedWinners: state.prefs.playoffForcedWinners,
        combineSearch: state.combineSearch,
        bigBoardSearch: state.bigBoardSearch,
        bigBoardPosFilter: state.bigBoardPosFilter,
        bigBoardPositions: state.bigBoardPositions,
        bigBoardLens: state.bigBoardLens,
        bigBoardSortField: state.bigBoardSortField,
        bigBoardSortDir: state.bigBoardSortDir,
        bigBoardRange: state.bigBoardRange,
        bigBoardAgreement: state.bigBoardAgreement,
        bigBoardRankedOnly: state.bigBoardRankedOnly,
        bigBoardFilterDrawerOpen: state.bigBoardFilterDrawerOpen,
        bigBoardExpanded: state.bigBoardExpanded,
        bigBoardShowAll: state.bigBoardShowAll,
        bigBoardExpandedIds: state.bigBoardExpandedIds,
        bigBoardShareCopied: state.bigBoardShareCopied,
        expandedDraftSpiderIdx: state.expandedDraftSpiderIdx,
        activeVideosSet: state.activeVideosSet,
        schedulePrevExpanded: state.schedulePrevExpanded,
        expandedRootingWeeks: state.expandedRootingWeeks,
        matchupStatsUnit: state.matchupStatsUnit,
        statsSubMode: state.statsSubMode,
        teamPlayersCat: state.teamPlayersCat,
        teamPlayersSortKey: state.teamPlayersSortKey,
        teamPlayersSortDir: state.teamPlayersSortDir,
        snapMatrixUnit: state.snapMatrixUnit,
        userPrefs: state.prefs,
        reportersById: reportersMap,
        gamecastGameId: activeGcId,
        gamecastTab: resolvedGcTab,
        gamecastBoxTeam: state.gamecastBoxTeam,
        gamecastBoxUnit: state.gamecastBoxUnit,
        gamecastPbpFilter: state.gamecastPbpFilter,
        gamecastPbpQuarter: state.gamecastPbpQuarter,
        gamecastPbpOrder: state.gamecastPbpOrder,
        gamecastExpandedDrives: state.gamecastExpandedDrives,
        gamecastFromSchedule: state.gamecastFromSchedule,
        gamecastModel: activeGcModel,
        gamecastIsLoading: Boolean(activeGcId && state.gamecastLoadingId === activeGcId && !activeGcModel),
        gamecastIsSyncing: state.gamecastSyncing,
        gamecastFieldAnimKey: state.gamecastFieldAnimKey,
        activeGamecastClipKey: state.activeGamecastClipKey
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
        sharedAudioPrep: state.sharedAudioPrep,
        sharedAnalysisHighlightId: state.sharedAnalysisHighlightId,
        allEpisodes: getAllEpisodes(),
        allAnalyses: getSavedAnalyses(),
        audioState: state.audioState,
        expandedTranscriptIds: state.expandedTranscriptIds,
        shareToastTargetId: state.shareToastTargetId,
        geminiKeyNotice: state.geminiKeyNotice,
        showGeminiKeyGuide: state.showGeminiKeyGuide,
        showPasskeySyncOffer: state.showPasskeySyncOffer,
        passkeyNeedsSecondTap: state.passkeyNeedsSecondTap,
        passkeyBusy: state.passkeyBusy
      });
    }
  });

  bindAllMountedInlineVideos();
  renderHeader();
  renderNavTabs();
  syncNavUnreadBadge();
}

function safePlayInlineVideo(videoEl) {
  if (!videoEl || typeof videoEl.play !== 'function') return;
  try {
    const playPromise = videoEl.play();
    if (playPromise && typeof playPromise.catch === 'function') {
      playPromise.catch(err => {
        const errName = String(err?.name || '');
        if (!videoEl.muted && (errName === 'NotAllowedError' || /notallowed|interact|gesture/i.test(String(err)))) {
          videoEl.muted = true;
          try {
            const mutedRetry = videoEl.play();
            if (mutedRetry && typeof mutedRetry.catch === 'function') mutedRetry.catch(() => {});
          } catch {}
        }
      });
    }
  } catch {}
}

function renderInlineVideoErrorFallback(videoEl) {
  if (!videoEl || videoEl.dataset.inlineFailed === '1') return;
  videoEl.dataset.inlineFailed = '1';
  const vidKey = videoEl.getAttribute('data-vid-key') || '';
  if (vidKey) {
    state.activeVideosSet.delete(vidKey);
  }
  const watchUrl = sanitizeExternalUrl(videoEl.getAttribute('data-watch-url') || '', null);
  const provider = videoEl.getAttribute('data-provider') || 'Source';
  const poster = videoEl.getAttribute('poster') || '';
  const wrap = videoEl.closest('.video-iframe-wrap');
  const box = videoEl.closest('.video-embed-box');
  if (box && vidKey) {
    const statusEl = box.querySelector('[data-vid-status-label] span');
    if (statusEl) statusEl.textContent = `Watch directly on ${provider}`;
  }
  if (wrap && watchUrl) {
    wrap.outerHTML = `
      <a href="${esc(watchUrl)}" target="_blank" rel="noopener noreferrer" class="video-external-card" aria-label="Watch clip on ${esc(provider)}">
        <div class="video-thumb-stage">
          ${
            poster
              ? `<img src="${esc(poster)}" alt="Video thumbnail" class="video-thumb-img" decoding="async" />`
              : `<div class="video-thumb-img" style="background:linear-gradient(135deg,var(--bg-card-alt),var(--bg-primary));min-height:165px"></div>`
          }
          <div class="video-thumb-overlay">
            <span class="video-play-pill">${iconSvg('externalLink', 13)}<span>Watch Clip on ${esc(provider)}</span></span>
          </div>
        </div>
      </a>
    `;
  }
}

function bindInlineVideoFallbacks(videoEl) {
  if (!videoEl || videoEl.dataset.fallbackBound === '1') return;
  videoEl.dataset.fallbackBound = '1';
  const originalSrc = videoEl.getAttribute('src') || '';

  videoEl.addEventListener('ended', () => {
    const key = videoEl.getAttribute('data-vid-key');
    if (key) state.activeVideosSet.delete(key);
  });

  videoEl.addEventListener('error', () => {
    const workerBase = String(state.prefs?.workerBaseUrl || '').trim().replace(/\/+$/, '');
    if (
      !videoEl.dataset.retriedRelay &&
      workerBase &&
      /^https:\/\//i.test(workerBase) &&
      isAllowedInlineVideoStreamUrl(originalSrc)
    ) {
      videoEl.dataset.retriedRelay = '1';
      videoEl.src = `${workerBase}/api/video-stream?url=${encodeURIComponent(originalSrc)}`;
      try {
        videoEl.load();
      } catch {}
      safePlayInlineVideo(videoEl);
      return;
    }
    renderInlineVideoErrorFallback(videoEl);
  });
}

function bindAllMountedInlineVideos() {
  if (typeof document === 'undefined') return;
  const videos = document.querySelectorAll('.video-iframe-wrap video, .gc-inline-clip-stage video');
  for (const v of videos) {
    bindInlineVideoFallbacks(v);
  }
}

function activateInlineVideoElement(vidKey) {
  if (!vidKey || typeof document === 'undefined') return;
  const videos = document.querySelectorAll('.video-iframe-wrap video, .gc-inline-clip-stage video');
  for (const v of videos) {
    if (v.getAttribute('data-vid-key') === vidKey) {
      bindInlineVideoFallbacks(v);
      safePlayInlineVideo(v);
      return;
    }
  }
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

  const remoteLeaderboardAppData =
    state.sheetMode === 'player' &&
    state.sheetRemoteContext?.bundle?.ok &&
    state.sheetRemoteContext.bundle.appData?.roster?.positionalLeaderboards?.[state.rankModal.key]
      ? state.sheetRemoteContext.bundle.appData
      : null;

  const model = resolveLeaderboardModalModel({
    appData: remoteLeaderboardAppData || state.appData,
    scope: state.rankModal.scope,
    key: state.rankModal.key,
    playerId: state.rankModal.playerId,
    focusTeamAbbr: state.rankModal.focusTeamAbbr || null
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

    const oppRowTeam =
      model.scope === 'player' && !r.is49erTeammate && !r.isHighlighted && r.teamAbbr
        ? resolveNflTeamMeta(r.teamAbbr)
        : null;
    const nameHtml =
      r.is49erTeammate && r.sfPlayerId
        ? `<button type="button" class="inline-player-link" style="background:none;border:0;padding:0;font:inherit;text-align:left" data-action="open-player-from-rank-modal" data-player-id="${esc(r.sfPlayerId)}"><strong>${esc(r.title)}</strong></button>`
        : oppRowTeam && oppRowTeam.abbr !== ACTIVE_TEAM.abbr
          ? `<button type="button" class="inline-player-link" style="background:none;border:0;padding:0;font:inherit;text-align:left" data-action="open-opponent-player-from-rank-modal" data-opp-team="${esc(oppRowTeam.abbr)}" data-opp-player-name="${esc(r.title)}"${r.playerPos ? ` data-opp-player-pos="${esc(r.playerPos)}"` : ''}${r.espnUrl ? ` data-opp-espn-url="${esc(r.espnUrl)}"` : ''}><strong>${esc(r.title)}</strong></button>`
          : r.extUrl
            ? `<a href="${esc(r.extUrl)}" target="_blank" rel="noopener noreferrer" class="ext-link"><strong>${esc(r.title)}</strong></a>`
            : `<strong>${esc(r.title)}</strong>`;

    rowsHtml.push(`
      <div class="rank-modal-row ${r.isHighlighted ? 'highlighted' : ''}" ${r.isHighlighted ? 'data-rank-highlight="true"' : ''} data-rank-num="${r.rank}"${model.scope === 'team' ? ` data-rank-team="${esc(r.id)}"` : ''}>
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

function getFilteredRawItemsForSearch() {
  return filterNewsByUserPrefs(
    state.appData?.news?.rawStream || [],
    getReportersMap(),
    state.prefs
  );
}

function focusUniversalSearchInput({ moveCursorToEnd = false } = {}) {
  const inp = document.getElementById('universalSearchInput');
  if (!inp) return;
  try {
    inp.focus({ preventScroll: true });
  } catch {
    inp.focus();
  }
  if (moveCursorToEnd) {
    try {
      const len = inp.value.length;
      inp.setSelectionRange(len, len);
    } catch {}
  }
  syncVisualViewportVars();
}

function updateUniversalSearchLiveDom({ resetScroll = true, syncInputValue = false } = {}) {
  if (state.sheetMode !== 'search') return;
  const resultsPane = document.getElementById('universalSearchResultsPane');
  if (!resultsPane) {
    renderSheet({ preserveScroll: false });
    return;
  }

  const filteredRawItems = getFilteredRawItemsForSearch();
  const allEpisodes = getAllEpisodes();
  const allAnalyses = getSavedAnalyses();
  const res = runUniversalSearch(state.universalSearchQuery, {
    appData: state.appData,
    filteredRawItems,
    allEpisodes,
    allAnalyses,
    scope: state.universalSearchScope,
    sourceFilter: state.universalSearchSource,
    forceLiteral: state.universalSearchForceLiteral
  });

  const inp = document.getElementById('universalSearchInput');
  if (inp) {
    if (syncInputValue && inp.value !== state.universalSearchQuery) {
      inp.value = state.universalSearchQuery;
    }
    const startingQbJersey = (state.appData?.roster?.players || []).find(
      p => p && String(p.position || '').toUpperCase() === 'QB' && p.jersey != null
    )?.jersey;
    const jerseyHint = startingQbJersey != null ? `#${startingQbJersey}` : ACTIVE_TEAM.abbr === 'SF' ? '#13' : '#jersey';
    inp.placeholder = res.activeSource
      ? `Search words in ${res.activeSource.name}…`
      : `Search players, ${jerseyHint}, beat writers, words in tweets/articles…`;
  }

  const clearBtn = document.getElementById('universalSearchClearBtn');
  if (clearBtn) {
    clearBtn.hidden = !(res.query || res.activeSource);
  }

  const sourceBar = document.getElementById('universalSearchActiveSourceBar');
  if (sourceBar) {
    if (res.activeSource) {
      sourceBar.hidden = false;
      sourceBar.innerHTML = `
        <span class="search-source-active-pill" data-active-source-pill>
          <span>Source: <strong>${esc(res.activeSource.name)}</strong></span>
          <button type="button" class="search-pill-x" data-action="search-clear-source" aria-label="Remove source filter">${iconSvg('close', 11)}</button>
        </span>
        <span class="search-source-hint">Type words to filter within ${esc(res.activeSource.name)}</span>
      `;
    } else {
      sourceBar.hidden = true;
      sourceBar.innerHTML = '';
    }
  }

  const scopeWrap = document.getElementById('universalSearchScopeBarWrap');
  if (scopeWrap) {
    scopeWrap.innerHTML = renderUniversalSearchScopeBarHtml(res);
  }

  resultsPane.innerHTML = renderUniversalSearchResultsHtml({
    query: state.universalSearchQuery,
    appData: state.appData,
    filteredRawItems,
    allEpisodes,
    allAnalyses,
    scope: state.universalSearchScope,
    sourceFilter: state.universalSearchSource,
    forceLiteral: state.universalSearchForceLiteral,
    recentSearches: state.recentSearches,
    precomputedResult: res
  });

  if (resetScroll) {
    resultsPane.scrollTop = 0;
  }
}

function openUniversalSearchSheet({ seedFromActiveFeed = false } = {}) {
  if (seedFromActiveFeed && state.activeNavTab === 'news') {
    if (state.newsSearchQuery && !state.universalSearchQuery) {
      state.universalSearchQuery = state.newsSearchQuery;
    }
    if (state.newsSourceFilter && !state.universalSearchSource) {
      state.universalSearchSource = state.newsSourceFilter;
    }
  }
  state.universalSearchForceLiteral = false;
  state.sheetMode = 'search';
  syncVisualViewportVars();
  renderSheet();
  focusUniversalSearchInput({ moveCursorToEnd: true });
}

const REMOTE_SHEET_THEME_VAR_KEYS = [
  '--scarlet',
  '--scarlet-bright',
  '--scarlet-soft',
  '--gold',
  '--gold-bright',
  '--gold-soft',
  '--gold-border',
  '--dossier-hero-glow-primary',
  '--dossier-hero-glow-secondary',
  '--pill-active-shadow'
];

function applyRemoteTeamThemeToSheet(teamMeta = null) {
  const sheetEl = document.getElementById('bottomSheetContainer');
  if (!sheetEl) return;
  if (!teamMeta || teamMeta.abbr === ACTIVE_TEAM.abbr) {
    sheetEl.removeAttribute('data-remote-team');
    sheetEl.removeAttribute('data-remote-team-slug');
    for (const k of REMOTE_SHEET_THEME_VAR_KEYS) {
      sheetEl.style.removeProperty(k);
    }
    return;
  }
  const themeMode = document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark';
  const vars = getRemoteTeamSheetThemeVars(teamMeta, themeMode) || {};
  sheetEl.setAttribute('data-remote-team', teamMeta.abbr);
  sheetEl.setAttribute('data-remote-team-slug', teamMeta.slug);
  for (const [k, v] of Object.entries(vars)) {
    sheetEl.style.setProperty(k, v);
  }
}

async function openOpponentPlayerSheet({
  teamAbbr = '',
  playerId = '',
  playerName = '',
  position = '',
  espnUrl = '',
  initialTab = 'overview',
  forceRefresh = false
} = {}) {
  const teamMeta = resolveNflTeamMeta(teamAbbr);
  if (!teamMeta) return;

  // If the resolved team is the currently active team site, open local dossier directly
  if (teamMeta.abbr === ACTIVE_TEAM.abbr) {
    const localPlayers = state.appData?.roster?.players || [];
    const localPlayer =
      (playerId && getPlayerById(playerId)) ||
      findPlayerInTeamRoster(localPlayers, { playerId, name: playerName, position });
    if (localPlayer) {
      state.sheetRemoteContext = null;
      state.sheetMode = 'player';
      state.sheetPlayerId = localPlayer.id;
      state.sheetPlayerTab = initialTab || 'overview';
      state.sheetPlayerStatsMode = '2026';
      state.sheetPlayerTxScenario = 'cut';
      state.sheetPlayerMentionsSort = 'top';
      renderSheet();
    }
    return;
  }

  const matchupData = state.appData?.scheduleMatchup?.upcomingMatchup || null;
  const seedPlayer = buildOpponentSeedPlayer({
    teamMeta,
    playerId,
    playerName,
    matchupData:
      String(matchupData?.oppAbbr || '').toUpperCase() === teamMeta.abbr ? matchupData : null,
    extraSeed: { id: playerId, name: playerName, position, espnUrl }
  });

  const cachedBundle = !forceRefresh ? getCachedRemoteTeamBundle(teamMeta) : null;
  if (cachedBundle?.ok) {
    const remotePlayer = findPlayerInTeamRoster(cachedBundle.appData?.roster?.players, {
      playerId: seedPlayer.id,
      name: seedPlayer.name,
      position: seedPlayer.position
    });
    remoteSheetRequestSeq += 1;
    state.sheetMode = 'player';
    state.sheetPlayerId = remotePlayer?.id || seedPlayer.id;
    state.sheetPlayerTab = initialTab || 'overview';
    state.sheetPlayerStatsMode = '2026';
    state.sheetPlayerTxScenario = 'cut';
    state.sheetPlayerMentionsSort = 'top';
    state.sheetRemoteContext = {
      teamMeta,
      query: { playerId: seedPlayer.id, name: seedPlayer.name, position: seedPlayer.position, espnUrl },
      seedPlayer,
      bundle: cachedBundle,
      remotePlayer: remotePlayer || null,
      status: remotePlayer ? 'ready' : 'fallback',
      error: remotePlayer ? null : 'Player not listed on remote roster'
    };
    renderSheet();
    return;
  }

  const reqSeq = ++remoteSheetRequestSeq;
  state.sheetMode = 'player';
  state.sheetPlayerId = seedPlayer.id;
  state.sheetPlayerTab = initialTab || 'overview';
  state.sheetPlayerStatsMode = '2026';
  state.sheetPlayerTxScenario = 'cut';
  state.sheetPlayerMentionsSort = 'top';
  state.sheetRemoteContext = {
    teamMeta,
    query: { playerId: seedPlayer.id, name: seedPlayer.name, position: seedPlayer.position, espnUrl },
    seedPlayer,
    bundle: null,
    remotePlayer: null,
    status: 'loading',
    error: null
  };
  renderSheet();

  const bundle = await fetchRemoteTeamBundle(teamMeta, { forceRefresh });
  if (
    reqSeq !== remoteSheetRequestSeq ||
    state.sheetMode !== 'player' ||
    state.sheetRemoteContext?.teamMeta?.abbr !== teamMeta.abbr
  ) {
    return;
  }

  if (bundle?.ok) {
    const remotePlayer = findPlayerInTeamRoster(bundle.appData?.roster?.players, {
      playerId: seedPlayer.id,
      name: seedPlayer.name,
      position: seedPlayer.position
    });
    if (remotePlayer?.id) {
      state.sheetPlayerId = remotePlayer.id;
    }
    state.sheetRemoteContext = {
      ...state.sheetRemoteContext,
      bundle,
      remotePlayer: remotePlayer || null,
      status: remotePlayer ? 'ready' : 'fallback',
      error: remotePlayer ? null : 'Player not listed on remote roster'
    };
  } else {
    state.sheetRemoteContext = {
      ...state.sheetRemoteContext,
      bundle: bundle || null,
      remotePlayer: null,
      status: 'fallback',
      error: bundle?.error || 'Unavailable'
    };
  }
  renderSheet({ preserveScroll: true });
}

function renderSheet({ preserveScroll = false } = {}) {
  const backdrop = document.getElementById('bottomSheetBackdrop');
  const eyebrow = document.getElementById('sheetEyebrow');
  const title = document.getElementById('sheetTitle');
  const body = document.getElementById('sheetBody');
  if (!backdrop || !body) return;

  if (!state.sheetMode) {
    state.sheetRemoteContext = null;
    applyRemoteTeamThemeToSheet(null);
    backdrop.hidden = true;
    backdrop.removeAttribute('data-sheet-mode');
    document.body.classList.remove('sheet-open');
    syncLiveWireButtonsDom();
    return;
  }

  const prevScrollTop = preserveScroll ? body.scrollTop : 0;
  const openStatExpanders = preserveScroll
    ? new Set(
        Array.from(body.querySelectorAll('details[data-player-stats-expander][open]'))
          .map(el => el.getAttribute('data-player-stats-expander'))
          .filter(Boolean)
      )
    : null;

  backdrop.setAttribute('data-sheet-mode', state.sheetMode);
  backdrop.hidden = false;
  document.body.classList.add('sheet-open');
  syncVisualViewportVars();
  syncLiveWireButtonsDom();

  preserveFocusAroundRender(() => {
    registerRosterPlayersForInlineLinks(state.appData?.roster?.players, {
      teamAbbr: ACTIVE_TEAM.abbr,
      activeTeamAbbr: ACTIVE_TEAM.abbr
    });
    if (state.sheetMode === 'player' && state.sheetRemoteContext?.teamMeta) {
      const remoteCtx = state.sheetRemoteContext;
      applyRemoteTeamThemeToSheet(remoteCtx.teamMeta);
      const merged = mergeRemoteAndLocalOpponentPlayer({
        remotePlayer: remoteCtx.remotePlayer,
        remoteBundle: remoteCtx.bundle,
        seedPlayer: remoteCtx.seedPlayer,
        teamMeta: remoteCtx.teamMeta,
        activeTeamAbbr: ACTIVE_TEAM.abbr,
        localNewsRawStream: state.appData?.news?.rawStream || []
      });
      const player = merged.player;
      if (eyebrow) {
        eyebrow.textContent = player
          ? `${remoteCtx.teamMeta.abbr} • ${player.position} • #${player.jersey ?? '—'}`
          : `${remoteCtx.teamMeta.abbr} Dossier`;
      }
      if (title) title.textContent = player ? player.name : 'Player Dossier';
      try {
        registerRosterPlayersForInlineLinks(merged.appData?.roster?.players || [], {
          teamAbbr: remoteCtx.teamMeta.abbr,
          activeTeamAbbr: ACTIVE_TEAM.abbr
        });
        body.innerHTML = renderPlayerDossierSheetHtml({
          player,
          activeTab: state.sheetPlayerTab,
          statsMode: state.sheetPlayerStatsMode,
          gameLogSub: state.sheetPlayerGameLogSub,
          txScenario: state.sheetPlayerTxScenario,
          mentionsSortMode: state.sheetPlayerMentionsSort,
          rawStream: merged.rawStream,
          appData: merged.appData,
          userPrefs: state.prefs,
          reportersById: merged.reportersById,
          activeVideosSet: state.activeVideosSet,
          teamContext: merged.teamContext,
          remoteStatus: {
            state: remoteCtx.status,
            error: remoteCtx.error
          }
        });
      } finally {
        registerRosterPlayersForInlineLinks(state.appData?.roster?.players, {
          teamAbbr: ACTIVE_TEAM.abbr,
          activeTeamAbbr: ACTIVE_TEAM.abbr
        });
      }
      if (openStatExpanders && openStatExpanders.size > 0) {
        body.querySelectorAll('details[data-player-stats-expander]').forEach(el => {
          const secId = el.getAttribute('data-player-stats-expander');
          if (secId && openStatExpanders.has(secId)) el.open = true;
        });
      }
      if (preserveScroll) {
        body.scrollTop = prevScrollTop;
      } else {
        body.scrollTop = 0;
      }
    } else if (state.sheetMode === 'player') {
      applyRemoteTeamThemeToSheet(null);
      const player = getPlayerById(state.sheetPlayerId);
      if (eyebrow) eyebrow.textContent = player ? `${player.position} • #${player.jersey ?? '—'}` : 'Player Dossier';
      if (title) title.textContent = player ? player.name : 'Player Dossier';
      body.innerHTML = renderPlayerDossierSheetHtml({
        player,
        activeTab: state.sheetPlayerTab,
        statsMode: state.sheetPlayerStatsMode,
        gameLogSub: state.sheetPlayerGameLogSub,
        txScenario: state.sheetPlayerTxScenario,
        mentionsSortMode: state.sheetPlayerMentionsSort,
        rawStream: state.appData?.news?.rawStream || [],
        appData: state.appData,
        userPrefs: state.prefs,
        reportersById: getReportersMap(),
        activeVideosSet: state.activeVideosSet
      });
      if (openStatExpanders && openStatExpanders.size > 0) {
        body.querySelectorAll('details[data-player-stats-expander]').forEach(el => {
          const secId = el.getAttribute('data-player-stats-expander');
          if (secId && openStatExpanders.has(secId)) el.open = true;
        });
      }
      if (preserveScroll) {
        body.scrollTop = prevScrollTop;
      } else {
        body.scrollTop = 0;
      }
    } else if (state.sheetMode === 'settings') {
      applyRemoteTeamThemeToSheet(null);
      if (eyebrow) eyebrow.textContent = 'Preferences';
      if (title) title.textContent = 'Settings';
      body.innerHTML = renderSettingsSheetHtml({
        userPrefs: state.prefs,
        reportersData: state.appData?.reporters,
        reporterSearch: state.reporterSearch,
        pushStatusNotice: state.pushStatusNotice,
        passkeyNotice: state.passkeyNotice,
        passkeyNeedsSecondTap: state.passkeyNeedsSecondTap,
        passkeyBusy: state.passkeyBusy
      });
      if (!preserveScroll) body.scrollTop = 0;
    } else if (state.sheetMode === 'search') {
      applyRemoteTeamThemeToSheet(null);
      if (eyebrow) eyebrow.textContent = ACTIVE_TEAM.brandName;
      if (title) title.textContent = 'Search';
      const filteredRawItems = getFilteredRawItemsForSearch();
      body.innerHTML = renderUniversalSearchSheetHtml({
        query: state.universalSearchQuery,
        appData: state.appData,
        filteredRawItems,
        allEpisodes: getAllEpisodes(),
        allAnalyses: getSavedAnalyses(),
        scope: state.universalSearchScope,
        sourceFilter: state.universalSearchSource,
        forceLiteral: state.universalSearchForceLiteral,
        recentSearches: state.recentSearches
      });
      if (!preserveScroll) body.scrollTop = 0;
    }
  });
}

function renderMiniPlayer(audioSnapshot) {
  const prevEpId = state.audioState?.episode?.id || null;
  const prevPlaying = Boolean(state.audioState?.isPlaying);
  const prevBuffering = Boolean(state.audioState?.isBufferingAudio);
  const prevAutoPlayQueued = Boolean(state.audioState?.isAutoPlayQueued);
  const nextEpId = audioSnapshot?.episode?.id || null;
  const nextPlaying = Boolean(audioSnapshot?.isPlaying);
  const nextBuffering = Boolean(audioSnapshot?.isBufferingAudio);
  const nextAutoPlayQueued = Boolean(audioSnapshot?.isAutoPlayQueued);
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

  // Keep Ready-to-Play / Shared Hero / Library cards in sync when episode or play/queue state changes
  if (
    (prevEpId !== nextEpId ||
      prevPlaying !== nextPlaying ||
      prevBuffering !== nextBuffering ||
      prevAutoPlayQueued !== nextAutoPlayQueued) &&
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

function getCurrentHomeOrderedIds() {
  return resolveHomeDashboardState({
    savedOrderIds: state.prefs.dashboardOrder,
    hiddenBlockIds: state.prefs.hiddenHomeBlockIds,
    pinnedBlockIds: state.prefs.pinnedHomeBlockIds
  }).orderedBlocks.map(b => b.id);
}

function moveDashboardBlock(blockId, direction) {
  const currentOrdered = getCurrentHomeOrderedIds();

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
  const currentOrdered = getCurrentHomeOrderedIds();

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

let initialLiveHydrationPromise = null;

function awaitInitialLiveHydrationBounded(maxWaitMs = 15000) {
  if (!initialLiveHydrationPromise) return Promise.resolve();
  return Promise.race([
    initialLiveHydrationPromise.catch(() => {}),
    new Promise(resolve => setTimeout(resolve, maxWaitMs))
  ]);
}

async function triggerDailyMatchupIntelSync() {
  if (!state.appData) return null;
  await awaitInitialLiveHydrationBounded(15000);
  if (!state.appData) return null;
  return refreshDailyMatchupIntelIfDue({
    appData: state.appData,
    prefs: state.prefs
  })
    .then(res => {
      if (state.appData) {
        hydrateCachedDailyMatchupIntel(state.appData);
      }
      if (
        res?.updated &&
        !hasActivelyPlayingInlineMedia() &&
        (state.activeNavTab === 'home' ||
          (state.activeNavTab === 'season' && state.seasonSubTab === 'matchup'))
      ) {
        renderMain();
      }
      return res;
    })
    .catch(() => null);
}

async function triggerFastSharedKvBriefHydration() {
  if (!state.appData) return null;
  return hydrateDailyTopNewsBriefFromSharedKv({
    appData: state.appData,
    prefs: state.prefs
  })
    .then(res => {
      if (
        res?.updated &&
        !hasActivelyPlayingInlineMedia() &&
        (state.activeNavTab === 'home' || state.activeNavTab === 'news')
      ) {
        renderMain();
      }
      return res;
    })
    .catch(() => null);
}

async function triggerDailyTopNewsBriefSync() {
  if (!state.appData) return null;
  await awaitInitialLiveHydrationBounded(15000);
  if (!state.appData) return null;
  return refreshDailyTopNewsBriefIfDue({
    appData: state.appData,
    prefs: state.prefs
  })
    .then(res => {
      if (state.appData) {
        hydrateCachedDailyTopNewsBrief(state.appData);
      }
      if (
        res?.updated &&
        !hasActivelyPlayingInlineMedia() &&
        (state.activeNavTab === 'home' || state.activeNavTab === 'news')
      ) {
        renderMain();
      }
      return res;
    })
    .catch(() => null);
}

let gamecastPollTimerId = null;
let gamecastPollSeq = 0;
let gamecastSituationTickCount = 0;

function isActiveLiveGamePresent(appData) {
  if (!appData?.scheduleMatchup) return false;
  if (appData.scheduleMatchup.upcomingMatchup?.isGameInProgress) return true;
  return (appData.scheduleMatchup.schedule || []).some(
    g => g && !g.completed && !g.isByeWeek && (g.statusState === 'in' || g.isLive)
  );
}

function stopGamecastLivePoller() {
  if (gamecastPollTimerId) {
    clearTimeout(gamecastPollTimerId);
    gamecastPollTimerId = null;
  }
  gamecastPollSeq += 1;
}

function getActiveGamecastTarget() {
  if (!state.appData) return { listInfo: null, gameId: null, meta: null };
  const mcSimResult = getMonteCarloResult();
  const listInfo = resolveGamecastGamesList(state.appData, mcSimResult);
  const gameId =
    (state.gamecastGameId && listInfo.games.some(g => g.id === String(state.gamecastGameId))
      ? String(state.gamecastGameId)
      : listInfo.defaultGameId) || null;
  const meta = listInfo.games.find(g => g.id === gameId) || null;
  return { listInfo, gameId, meta };
}

function renderGamecastPreservingScroll() {
  if (hasActivelyPlayingInlineMedia()) return;
  const prevY = window.scrollY || 0;
  renderMain();
  if (Math.abs((window.scrollY || 0) - prevY) > 4) {
    window.scrollTo({ top: prevY, behavior: 'instant' });
  }
}

async function hydrateGamecastById(meta, { forceRefresh = false, silent = false, pollSeq = null } = {}) {
  if (!meta?.id || !state.appData) return null;
  const gameId = String(meta.id);
  const prevModel = state.gamecastModelsById.get(gameId) || getCachedGamecastModel(gameId) || null;
  if (!prevModel && !silent) {
    state.gamecastLoadingId = gameId;
    renderMain();
  }
  if (forceRefresh && !silent) {
    state.gamecastSyncing = true;
    renderGamecastPreservingScroll();
  }

  try {
    const fetched = await fetchGamecastForGame(meta, {
      appData: state.appData,
      prefs: state.prefs,
      forceRefresh
    });
    if (pollSeq != null && pollSeq !== gamecastPollSeq) return null;
    if (fetched && fetched.gameId === gameId) {
      const prevPlayId = prevModel?.situation?.lastPlayId || '';
      const nextPlayId = fetched.situation?.lastPlayId || '';
      const prevScoreSig = prevModel
        ? `${prevModel.away?.score}-${prevModel.home?.score}-${prevModel.totalPlays}`
        : '';
      const nextScoreSig = `${fetched.away?.score}-${fetched.home?.score}-${fetched.totalPlays}`;
      const changed = !prevModel || prevPlayId !== nextPlayId || prevScoreSig !== nextScoreSig || prevModel.isFallback !== fetched.isFallback;

      if (nextPlayId && prevPlayId && nextPlayId !== prevPlayId) {
        state.gamecastFieldAnimKey += 1;
      }
      state.gamecastModelsById.set(gameId, fetched);
      if (state.gamecastLoadingId === gameId) state.gamecastLoadingId = null;
      state.gamecastSyncing = false;

      if (state.activeNavTab === 'season' && state.seasonSubTab === 'gamecast' && (changed || !silent)) {
        renderGamecastPreservingScroll();
      }
      return fetched;
    }
  } catch {
    // Keep existing cached/fallback model cleanly
  } finally {
    if (state.gamecastLoadingId === gameId) state.gamecastLoadingId = null;
    state.gamecastSyncing = false;
  }
  return prevModel;
}

function scheduleNextGamecastPoll(seq) {
  if (seq !== gamecastPollSeq) return;
  if (
    document.visibilityState !== 'visible' ||
    state.activeNavTab !== 'season' ||
    state.seasonSubTab !== 'gamecast' ||
    !state.appData
  ) {
    return;
  }
  const { gameId, meta } = getActiveGamecastTarget();
  if (!gameId || !meta) return;
  const curModel = state.gamecastModelsById.get(gameId) || getCachedGamecastModel(gameId);
  const isLiveTarget = Boolean(curModel ? curModel.isLive : meta.isLive);
  if (!isLiveTarget) return;

  const activeTab = state.gamecastTab || 'pbp';
  const intervalMs = activeTab === 'pbp' ? 2000 : 6000;

  gamecastPollTimerId = setTimeout(async () => {
    if (seq !== gamecastPollSeq) return;
    if (
      document.visibilityState !== 'visible' ||
      state.activeNavTab !== 'season' ||
      state.seasonSubTab !== 'gamecast'
    ) {
      return;
    }
    const latest = getActiveGamecastTarget();
    if (!latest.meta || latest.gameId !== gameId) return;

    if (activeTab === 'pbp') {
      gamecastSituationTickCount += 1;
      const fp = await fetchLiveSituationFingerprint(gameId, { prefs: state.prefs });
      if (seq !== gamecastPollSeq) return;
      const fpChanged = Boolean(fp?.fingerprint && fp.fingerprint !== state.gamecastLastSituationFp);
      if (fp?.fingerprint) state.gamecastLastSituationFp = fp.fingerprint;
      if (fpChanged || gamecastSituationTickCount % 5 === 0) {
        await hydrateGamecastById(latest.meta, { forceRefresh: true, silent: true, pollSeq: seq });
      }
    } else {
      await hydrateGamecastById(latest.meta, { forceRefresh: true, silent: true, pollSeq: seq });
    }
    scheduleNextGamecastPoll(seq);
  }, intervalMs);
}

function ensureGamecastHydratedAndPolling({ forceRefresh = false } = {}) {
  stopGamecastLivePoller();
  if (state.activeNavTab !== 'season' || state.seasonSubTab !== 'gamecast' || !state.appData) {
    return;
  }
  const { gameId, meta } = getActiveGamecastTarget();
  if (!gameId || !meta) return;
  state.gamecastGameId = gameId;
  const seq = gamecastPollSeq;
  gamecastSituationTickCount = 0;

  hydrateGamecastById(meta, { forceRefresh, silent: false, pollSeq: seq }).then(() => {
    if (seq === gamecastPollSeq) {
      scheduleNextGamecastPoll(seq);
    }
  });
}

function openGamecastForGameId(gameId, { fromSchedule = false } = {}) {
  saveCurrentTabScroll();
  state.activeNavTab = 'season';
  state.seasonSubTab = 'gamecast';
  state.userPickedSeasonSubDuringLive = true;
  if (isNumericEspnGameId(gameId)) {
    const cleanId = String(gameId);
    if (state.gamecastGameId !== cleanId) {
      state.gamecastGameId = cleanId;
      state.gamecastExpandedDrives = new Set();
      state.gamecastPbpQuarter = 'ALL';
      state.gamecastPbpFilter = 'all';
      state.activeGamecastClipKey = '';
      state.gamecastLastSituationFp = '';
      const targetMeta = getActiveGamecastTarget().meta;
      state.gamecastTab = targetMeta?.isLive ? 'pbp' : 'box';
    }
  }
  state.gamecastFromSchedule = Boolean(fromSchedule);
  window.scrollTo({ top: 0, behavior: 'instant' });
  renderMain();
  ensureGamecastHydratedAndPolling({ forceRefresh: false });
}

function bindEvents() {
  // Bottom Nav Tabs (with per-tab scroll memory; tapping active tab scrolls cleanly to top)
  document.querySelectorAll('.nav-tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const nextTab = btn.getAttribute('data-nav-tab') || 'home';
      if (nextTab === state.activeNavTab) {
        window.scrollTo({ top: 0, behavior: 'smooth' });
        state.tabScrollPositions[getActiveScrollMemoryKey()] = 0;
        return;
      }
      saveCurrentTabScroll();
      state.activeNavTab = nextTab;
      if (!state.appData) {
        renderNavTabs();
        bootOrRecoverAppData({ manual: true });
        return;
      }
      // Smart Live Auto-Land: during an active live game, tapping Season lands directly on Gamecast
      if (state.activeNavTab === 'season') {
        if (isActiveLiveGamePresent(state.appData) && !state.userPickedSeasonSubDuringLive) {
          state.seasonSubTab = 'gamecast';
          state.gamecastTab = state.gamecastTab || 'pbp';
        }
      } else {
        stopGamecastLivePoller();
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
        triggerFastSharedKvBriefHydration();
        triggerDailyTopNewsBriefSync();
      }
      renderMain();
      if (state.activeNavTab === 'season' && state.seasonSubTab === 'gamecast') {
        ensureGamecastHydratedAndPolling({ forceRefresh: false });
      }
      restoreScrollForCurrentTab({ fallbackTop: 0 });
    });
  });

  // Top Header triggers
  document.getElementById('brandHomeTrigger')?.addEventListener('click', () => {
    if (state.activeNavTab === 'home') {
      window.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }
    if ((window.scrollY || 0) > 36) {
      window.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }
    saveCurrentTabScroll();
    state.activeNavTab = 'home';
    window.scrollTo({ top: 0, behavior: 'instant' });
    renderMain();
  });

  document.getElementById('openSearchBtn')?.addEventListener('click', e => {
    e.stopPropagation();
    openUniversalSearchSheet({ seedFromActiveFeed: true });
  });

  // Live top-header offset & visualViewport sync so content never hides behind fixed header
  // and top-docked mobile Search stays 100% above the on-screen keyboard
  syncTopHeaderHeight();
  syncVisualViewportVars();
  const topHeaderEl = document.querySelector('.top-header');
  if (topHeaderEl && typeof ResizeObserver === 'function') {
    const headerRo = new ResizeObserver(() => syncTopHeaderHeight());
    headerRo.observe(topHeaderEl);
  }
  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', syncVisualViewportVars, { passive: true });
    window.visualViewport.addEventListener('scroll', syncVisualViewportVars, { passive: true });
  }
  window.addEventListener(
    'orientationchange',
    () =>
      setTimeout(() => {
        syncTopHeaderHeight();
        syncVisualViewportVars();
      }, 120),
    { passive: true }
  );
  document.addEventListener('focusin', e => {
    if (e.target?.id === 'universalSearchInput') {
      syncVisualViewportVars();
      setTimeout(syncVisualViewportVars, 180);
    }
  });
  document.addEventListener('focusout', e => {
    if (e.target?.id === 'universalSearchInput') {
      setTimeout(syncVisualViewportVars, 120);
    }
  });

  document.getElementById('openSettingsBtn')?.addEventListener('click', () => {
    state.pushStatusNotice = '';
    state.sheetMode = 'settings';
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
    if (e.target?.id === 'universalSearchInput') {
      if (e.key === 'Tab') {
        const firstAc = document.querySelector('#universalSearchResultsPane [data-search-autocomplete] [data-ac-index="0"]');
        if (firstAc) {
          e.preventDefault();
          firstAc.click();
          return;
        }
      }
      if (e.key === 'Enter') {
        e.preventDefault();
        if (state.universalSearchQuery.trim()) {
          saveRecentSearchTerm(state.universalSearchQuery.trim());
        }
        // Dismiss mobile keyboard so results expand cleanly to fill the full screen
        e.target.blur();
        syncVisualViewportVars();
        return;
      }
    }
    if (
      (e.key === '/' || ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k')) &&
      !e.target?.closest?.('input, textarea, select, [contenteditable]')
    ) {
      e.preventDefault();
      openUniversalSearchSheet({ seedFromActiveFeed: true });
      return;
    }
    if (e.key === 'Escape' && state.sheetMode) {
      state.sheetMode = null;
      renderSheet();
    }
  });

  window.addEventListener('resize', () => {
    closeJargonPopover();
    syncTopHeaderHeight();
    syncVisualViewportVars();
  }, { passive: true });
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
      } else if (e.target?.matches?.('details.big-board-item[data-prospect-id]')) {
        const pid = e.target.getAttribute('data-prospect-id');
        if (pid) {
          if (e.target.open) state.bigBoardExpandedIds.add(pid);
          else state.bigBoardExpandedIds.delete(pid);
        }
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

    const markReadHit = e.target.closest('[data-mark-read-key]');
    if (markReadHit) {
      markReadKey(markReadHit.getAttribute('data-mark-read-key'));
    }

    const anchorHit = e.target.closest('a[href]');
    if (anchorHit?.classList?.contains('search-result-link')) {
      if (state.universalSearchQuery.trim()) saveRecentSearchTerm(state.universalSearchQuery.trim());
      const rk = anchorHit.getAttribute('data-read-key');
      if (rk) markReadKey(rk);
    }
    const btn = e.target.closest('[data-action]');
    if (anchorHit && (!btn || btn.contains(anchorHit))) {
      // Attach transient client-side `#nfl_ks=` fragment on allowlisted cross-subdomain NFL links
      // (Settings "NFL Portal" / "Switch Team") so Safari / iOS propagate the API key instantaneously
      // without ever transmitting it to a server or exposing it in static DOM href attributes.
      if (
        anchorHit.hasAttribute('data-nfl-key-handoff') &&
        !e.metaKey &&
        !e.ctrlKey &&
        !e.shiftKey &&
        !e.altKey &&
        (e.button === 0 || e.button == null)
      ) {
        const cleanHref = anchorHit.getAttribute('href') || '';
        const sharedRec =
          readSameOriginSharedGeminiKey() ||
          (state.prefs?.geminiApiKey
            ? {
                v: 1,
                k: String(state.prefs.geminiApiKey).trim(),
                m: String(state.prefs.verifiedGeminiModel || '').trim(),
                t: Number(state.prefs.geminiApiKeyUpdatedAt) || Date.now(),
                c: 0
              }
            : null);
        if (cleanHref && sharedRec) {
          const handoffHref = appendSharedKeyHandoffToUrl(anchorHit.href, sharedRec, {
            currentOrigin: window.location.origin
          });
          if (handoffHref && handoffHref !== anchorHit.href) {
            anchorHit.setAttribute('href', handoffHref);
            setTimeout(() => {
              anchorHit.setAttribute('href', cleanHref);
            }, 250);
          }
        }
      }

      // On iOS 17+ installed Home Screen PWAs (standalone mode), opening NFL club/league
      // video pages (`49ers.com/video/...`, `nfl.com/videos/...`) via `target="_blank"`
      // opens them inside `SFSafariViewController`, where NFL's TheoPlayer/Anvato + IMA
      // pre-roll player stalls on an infinite spinner. Hand off directly to Safari via
      // `x-safari-https://` so playback works reliably while keeping the PWA intact.
      if (!e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey && (e.button === 0 || e.button == null)) {
        const breakoutUrl = resolveIosStandaloneExternalVideoBreakoutUrl(anchorHit.href);
        if (breakoutUrl) {
          e.preventDefault();
          try {
            window.location.href = breakoutUrl;
          } catch {
            window.open(anchorHit.href, '_blank', 'noopener,noreferrer');
          }
          return;
        }
      }
      return;
    }
    if (!btn) return;
    if (anchorHit) e.preventDefault();
    const action = btn.getAttribute('data-action');

    switch (action) {
      case 'toggle-wire-summary': {
        const container = btn.closest('[data-expandable-summary]');
        if (!container) break;
        const previewEl = container.querySelector('[data-summary-preview]');
        const fullEl = container.querySelector('[data-summary-full]');
        const isExpanded = container.getAttribute('data-expandable-summary') === 'expanded';
        if (isExpanded) {
          container.setAttribute('data-expandable-summary', 'collapsed');
          if (previewEl) previewEl.hidden = false;
          if (fullEl) fullEl.hidden = true;
        } else {
          container.setAttribute('data-expandable-summary', 'expanded');
          if (previewEl) previewEl.hidden = true;
          if (fullEl) fullEl.hidden = false;
        }
        break;
      }

      case 'toggle-customize-layout':
        state.isCustomizingLayout = !state.isCustomizingLayout;
        renderMain();
        break;

      case 'reset-dashboard-order':
        state.prefs.dashboardOrder = [];
        state.prefs.hiddenHomeBlockIds = [];
        state.prefs.pinnedHomeBlockIds = [];
        saveUserPrefs(state.prefs);
        renderMain();
        break;

      case 'hide-home-block': {
        const bid = btn.getAttribute('data-block-id') || '';
        const currentOrdered = getCurrentHomeOrderedIds();
        if (bid && currentOrdered.length > 1 && ALL_DASHBOARD_BLOCKS.some(b => b.id === bid)) {
          const hidden = new Set(state.prefs.hiddenHomeBlockIds || []);
          hidden.add(bid);
          state.prefs.hiddenHomeBlockIds = Array.from(hidden);
          state.prefs.pinnedHomeBlockIds = (state.prefs.pinnedHomeBlockIds || []).filter(
            id => id !== bid
          );
          state.prefs.dashboardOrder = currentOrdered.filter(id => id !== bid);
          saveUserPrefs(state.prefs);
          renderMain();
        }
        break;
      }

      case 'show-home-block': {
        const bid = btn.getAttribute('data-block-id') || '';
        const blockSpec = ALL_DASHBOARD_BLOCKS.find(b => b.id === bid);
        if (blockSpec) {
          const currentOrdered = getCurrentHomeOrderedIds();
          state.prefs.hiddenHomeBlockIds = (state.prefs.hiddenHomeBlockIds || []).filter(
            id => id !== bid
          );
          if (!blockSpec.defaultOnHome) {
            const pinned = new Set(state.prefs.pinnedHomeBlockIds || []);
            pinned.add(bid);
            state.prefs.pinnedHomeBlockIds = Array.from(pinned);
          }
          if (!currentOrdered.includes(bid)) {
            state.prefs.dashboardOrder = [...currentOrdered, bid];
          }
          saveUserPrefs(state.prefs);
          renderMain();
        }
        break;
      }

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
        const rawNext = btn.getAttribute('data-season-sub') || 'matchup';
        const nextSeasonSub = rawNext === 'draft_class' ? 'draft_prep' : rawNext;
        if (rawNext === 'draft_class') state.draftSubTab = 'class';
        else if (rawNext === 'draft_prep') state.draftSubTab = 'prep';
        if (nextSeasonSub === 'schedule') state.schedulePrevExpanded = false;
        state.activeNavTab = 'season';
        state.seasonSubTab = nextSeasonSub;
        state.userPickedSeasonSubDuringLive = true;
        if (nextSeasonSub !== 'gamecast') {
          state.gamecastFromSchedule = false;
          stopGamecastLivePoller();
        }
        window.scrollTo({ top: 0, behavior: 'instant' });
        renderMain();
        if (nextSeasonSub === 'gamecast') {
          ensureGamecastHydratedAndPolling({ forceRefresh: false });
        }
        break;
      }

      case 'open-gamecast-game': {
        const targetId = btn.getAttribute('data-game-id') || '';
        const fromSched = btn.getAttribute('data-from-schedule') === 'true';
        if (btn.getAttribute('data-close-sheet') === 'true' && state.sheetMode) {
          state.sheetMode = null;
          renderSheet();
        }
        openGamecastForGameId(targetId, { fromSchedule: fromSched });
        break;
      }

      case 'back-to-schedule-from-gamecast': {
        state.gamecastFromSchedule = false;
        state.seasonSubTab = 'schedule';
        state.schedulePrevExpanded = true;
        stopGamecastLivePoller();
        window.scrollTo({ top: 0, behavior: 'instant' });
        renderMain();
        break;
      }

      case 'set-gamecast-tab': {
        const nextTab = btn.getAttribute('data-gamecast-tab') || 'pbp';
        if (['box', 'team', 'pbp'].includes(nextTab)) {
          state.gamecastTab = nextTab;
          state.activeGamecastClipKey = '';
          renderMain();
          // Re-tune poll interval immediately (2s on pbp vs 6s on box/team)
          ensureGamecastHydratedAndPolling({ forceRefresh: false });
        }
        break;
      }

      case 'set-gamecast-box-team': {
        const nextBoxTeam = btn.getAttribute('data-box-team') === 'opponent' ? 'opponent' : 'team';
        state.gamecastBoxTeam = nextBoxTeam;
        renderMain();
        break;
      }

      case 'set-gamecast-box-unit': {
        const nextUnit = btn.getAttribute('data-box-unit') || 'all';
        state.gamecastBoxUnit = ['all', 'offense', 'defense', 'special_teams'].includes(nextUnit) ? nextUnit : 'all';
        renderMain();
        break;
      }

      case 'set-gamecast-pbp-filter': {
        const nextFilter = btn.getAttribute('data-pbp-filter') || 'all';
        state.gamecastPbpFilter = ['all', 'scoring', 'key'].includes(nextFilter) ? nextFilter : 'all';
        renderMain();
        break;
      }

      case 'set-gamecast-pbp-quarter': {
        state.gamecastPbpQuarter = btn.getAttribute('data-pbp-quarter') || 'ALL';
        renderMain();
        break;
      }

      case 'toggle-gamecast-pbp-order': {
        state.gamecastPbpOrder = state.gamecastPbpOrder === 'newest' ? 'chrono' : 'newest';
        renderMain();
        break;
      }

      case 'step-gamecast-game': {
        const delta = Number(btn.getAttribute('data-step') || 0);
        const { listInfo, gameId } = getActiveGamecastTarget();
        if (listInfo?.games?.length && gameId && delta) {
          const idx = listInfo.games.findIndex(g => g.id === gameId);
          const nextGame = listInfo.games[idx + delta];
          if (nextGame) {
            state.gamecastGameId = nextGame.id;
            state.gamecastExpandedDrives = new Set();
            state.gamecastPbpQuarter = 'ALL';
            state.gamecastPbpFilter = 'all';
            state.activeGamecastClipKey = '';
            state.gamecastLastSituationFp = '';
            state.gamecastTab = nextGame.isLive ? 'pbp' : 'box';
            renderMain();
            ensureGamecastHydratedAndPolling({ forceRefresh: false });
          }
        }
        break;
      }

      case 'refresh-gamecast-now': {
        ensureGamecastHydratedAndPolling({ forceRefresh: true });
        break;
      }

      case 'play-gamecast-clip': {
        const clipKey = btn.getAttribute('data-clip-key') || '';
        if (clipKey) {
          state.activeGamecastClipKey = state.activeGamecastClipKey === clipKey ? '' : clipKey;
          renderGamecastPreservingScroll();
        }
        break;
      }

      case 'close-gamecast-clip': {
        state.activeGamecastClipKey = '';
        renderGamecastPreservingScroll();
        break;
      }

      case 'set-draft-sub': {
        const nextDraftSub = btn.getAttribute('data-draft-sub') === 'class' ? 'class' : 'prep';
        state.draftSubTab = nextDraftSub;
        renderMain();
        break;
      }

      case 'open-settings': {
        const focusSection = btn.getAttribute('data-settings-focus') || '';
        state.pushStatusNotice = '';
        state.sheetMode = 'settings';
        renderSheet();
        if (focusSection === 'sources') {
          requestAnimationFrame(() => {
            const targetEl = document.getElementById('settingsSourcesSection');
            if (targetEl) targetEl.scrollIntoView({ behavior: 'instant', block: 'start' });
          });
        }
        break;
      }

      case 'open-search':
        openUniversalSearchSheet({ seedFromActiveFeed: true });
        break;

      case 'fill-universal-search':
        state.universalSearchQuery = btn.getAttribute('data-search-query') || '';
        state.universalSearchForceLiteral = false;
        updateUniversalSearchLiveDom({ resetScroll: true, syncInputValue: true });
        focusUniversalSearchInput({ moveCursorToEnd: true });
        break;

      case 'search-apply-autocomplete':
        state.universalSearchQuery = btn.getAttribute('data-search-query') || '';
        state.universalSearchForceLiteral = false;
        updateUniversalSearchLiveDom({ resetScroll: true, syncInputValue: true });
        focusUniversalSearchInput({ moveCursorToEnd: true });
        break;

      case 'search-select-source': {
        const sourceKey = btn.getAttribute('data-source-key') || '';
        const sourceName = btn.getAttribute('data-source-name') || '';
        if (sourceName) {
          state.universalSearchSource = { key: sourceKey || normalizeSearchText(sourceName), name: sourceName };
          // If the typed query was just a prefix/match of the source name itself, clear the text input
          // so the user immediately sees all tweets & articles from that source and can type words to filter inside it.
          const qNorm = normalizeSearchText(state.universalSearchQuery.replace(/^@+/, ''));
          const sNorm = normalizeSearchText(sourceName);
          if (
            !qNorm ||
            sNorm.includes(qNorm) ||
            sNorm.split(/\s+/).some(w => w.startsWith(qNorm)) ||
            state.universalSearchQuery.trim().startsWith('@')
          ) {
            state.universalSearchQuery = '';
          }
          state.universalSearchForceLiteral = false;
          if (state.universalSearchScope === 'sources' || state.universalSearchScope === 'players') {
            state.universalSearchScope = 'all';
          }
          updateUniversalSearchLiveDom({ resetScroll: true, syncInputValue: true });
          focusUniversalSearchInput({ moveCursorToEnd: true });
        }
        break;
      }

      case 'search-clear-source':
        state.universalSearchSource = null;
        state.universalSearchForceLiteral = false;
        updateUniversalSearchLiveDom({ resetScroll: true, syncInputValue: false });
        focusUniversalSearchInput({ moveCursorToEnd: true });
        break;

      case 'search-set-scope': {
        const nextScope = btn.getAttribute('data-search-scope') || 'all';
        state.universalSearchScope = nextScope;
        updateUniversalSearchLiveDom({ resetScroll: true, syncInputValue: false });
        break;
      }

      case 'search-force-literal':
        state.universalSearchForceLiteral = true;
        updateUniversalSearchLiveDom({ resetScroll: true, syncInputValue: false });
        break;

      case 'search-clear-recent':
        clearRecentSearchTerms();
        updateUniversalSearchLiveDom({ resetScroll: false, syncInputValue: false });
        break;

      case 'clear-universal-search':
        state.universalSearchQuery = '';
        state.universalSearchSource = null;
        state.universalSearchScope = 'all';
        state.universalSearchForceLiteral = false;
        updateUniversalSearchLiveDom({ resetScroll: true, syncInputValue: true });
        focusUniversalSearchInput({ moveCursorToEnd: true });
        break;

      case 'search-open-player': {
        const pid = btn.getAttribute('data-player-id');
        const target = getPlayerById(pid);
        if (target) {
          if (state.universalSearchQuery.trim()) saveRecentSearchTerm(state.universalSearchQuery.trim());
          state.sheetRemoteContext = null;
          state.sheetMode = 'player';
          state.sheetPlayerId = target.id;
          state.sheetPlayerTab = 'overview';
          state.sheetPlayerMentionsSort = 'top';
          renderSheet();
        }
        break;
      }

      case 'search-filter-news-feed': {
        const q = btn.getAttribute('data-search-query') || state.universalSearchQuery || '';
        const srcName = btn.getAttribute('data-source-name') || state.universalSearchSource?.name || '';
        const scopeAttr = btn.getAttribute('data-search-scope') || state.universalSearchScope || 'all';
        if (q.trim()) saveRecentSearchTerm(q.trim());
        state.sheetMode = null;
        renderSheet();
        saveCurrentTabScroll();
        state.activeNavTab = 'news';
        state.newsCategoryFilter =
          scopeAttr === 'tweets' || scopeAttr === 'articles' || scopeAttr === 'videos' ? scopeAttr : 'all';
        state.newsTopicFilter = 'all';
        state.newsSearchQuery = q.trim();
        state.newsSourceFilter = srcName ? { key: normalizeSearchText(srcName), name: srcName } : null;
        window.scrollTo({ top: 0, behavior: 'instant' });
        renderMain();
        break;
      }

      case 'search-jump-audio': {
        const kind = btn.getAttribute('data-audio-kind') || 'beat_podcasts';
        const showId = btn.getAttribute('data-show-id') || '';
        if (state.universalSearchQuery.trim()) saveRecentSearchTerm(state.universalSearchQuery.trim());
        state.sheetMode = null;
        renderSheet();
        saveCurrentTabScroll();
        state.activeNavTab = 'audio';
        state.studioSubTab =
          kind === 'analysis' ? 'analysis' : kind === 'autopod' ? 'podcast' : 'beat_podcasts';
        if (kind === 'beat_podcast' && showId) {
          state.beatPodViewMode = 'date';
          state.beatPodShowFilter = showId;
        }
        window.scrollTo({ top: 0, behavior: 'instant' });
        renderMain();
        break;
      }

      case 'search-jump-section': {
        const navTab = btn.getAttribute('data-nav-tab') || 'home';
        const subTab = btn.getAttribute('data-sub-tab') || '';
        if (state.universalSearchQuery.trim()) saveRecentSearchTerm(state.universalSearchQuery.trim());
        state.sheetMode = null;
        renderSheet();
        saveCurrentTabScroll();
        state.activeNavTab = navTab;
        if (navTab === 'season' && subTab) {
          if (subTab === 'draft_class') {
            state.seasonSubTab = 'draft_prep';
            state.draftSubTab = 'class';
          } else {
            state.seasonSubTab = subTab;
            if (subTab === 'draft_prep') state.draftSubTab = 'prep';
          }
          state.userPickedSeasonSubDuringLive = true;
        } else if (navTab === 'roster' && subTab) {
          state.rosterSubTab = subTab;
        } else if (navTab === 'audio' && subTab) {
          state.studioSubTab = subTab;
        }
        if (!(navTab === 'season' && state.seasonSubTab === 'gamecast')) {
          stopGamecastLivePoller();
        }
        window.scrollTo({ top: 0, behavior: 'instant' });
        renderMain();
        if (navTab === 'season' && state.seasonSubTab === 'gamecast') {
          ensureGamecastHydratedAndPolling({ forceRefresh: false });
        }
        break;
      }

      case 'close-sheet':
        state.sheetMode = null;
        renderSheet();
        break;

      case 'set-news-category': {
        const reqCat = btn.getAttribute('data-category') || 'all';
        state.newsCategoryFilter = VALID_NEWS_CATEGORIES.has(reqCat) ? reqCat : 'all';
        state.newsTopicFilter = 'all';
        state.activeVideosSet.clear();
        renderMain();
        break;
      }

      case 'set-news-sort': {
        const nextSort = normalizeNewsSortMode(btn.getAttribute('data-sort-mode') || 'top');
        state.newsSortMode = nextSort;
        state.prefs.newsSortMode = nextSort;
        saveUserPrefs(state.prefs);
        renderMain();
        break;
      }

      case 'set-news-topic': {
        const nextTopic = btn.getAttribute('data-topic-key') || 'all';
        state.newsTopicFilter = state.newsTopicFilter === nextTopic ? 'all' : nextTopic;
        renderMain();
        break;
      }

      case 'clear-news-search-filter':
        state.newsSearchQuery = '';
        state.newsSourceFilter = null;
        renderMain();
        break;

      case 'mark-all-caught-up':
        markAllCaughtUp();
        break;

      case 'set-feed-density': {
        const nextDensity = btn.getAttribute('data-density') === 'compact' ? 'compact' : 'rich';
        state.prefs.feedDensity = nextDensity;
        applyFeedDensity(nextDensity);
        saveUserPrefs(state.prefs);
        if (state.sheetMode === 'settings') renderSheet({ preserveScroll: true });
        renderMain();
        break;
      }

      case 'toggle-feed-density': {
        const nextDensity = state.prefs.feedDensity === 'compact' ? 'rich' : 'compact';
        state.prefs.feedDensity = nextDensity;
        applyFeedDensity(nextDensity);
        saveUserPrefs(state.prefs);
        renderMain();
        break;
      }

      case 'toggle-push-subscription':
        await toggleQuietPushAlerts();
        break;

      case 'test-quiet-alert':
        await sendTestQuietAlert();
        break;

      case 'play-inline-video': {
        const key = btn.getAttribute('data-vid-key');
        if (key) {
          state.activeVideosSet.clear();
          state.activeVideosSet.add(key);
          if (state.sheetMode === 'player') {
            renderSheet({ preserveScroll: true });
          } else {
            renderMain();
          }
          activateInlineVideoElement(key);
        }
        break;
      }

      case 'set-roster-sub':
        state.rosterSubTab = btn.getAttribute('data-roster-sub') || 'roster';
        renderMain();
        break;

      case 'set-roster-moves-filter':
        state.rosterMovesFilter = btn.getAttribute('data-moves-filter') || 'all';
        renderMain();
        break;

      case 'set-cap-view-mode':
        state.capViewMode = btn.getAttribute('data-cap-mode') === 'fa' ? 'fa' : 'sim';
        renderMain();
        break;

      case 'set-cap-fa-filter':
        state.capFaFilter = btn.getAttribute('data-fa-filter') || 'ALL';
        renderMain();
        break;

      case 'set-stats-sub': {
        const nextStatsSub = btn.getAttribute('data-stats-sub') || 'ranks';
        state.statsSubMode = ['ranks', 'players', 'snaps'].includes(nextStatsSub) ? nextStatsSub : 'ranks';
        renderMain();
        break;
      }

      case 'set-team-players-cat': {
        const nextCat = btn.getAttribute('data-players-cat') || 'rec';
        if (['pass', 'rush', 'rec', 'def'].includes(nextCat)) {
          state.teamPlayersCat = nextCat;
          state.teamPlayersSortKey = '';
          state.teamPlayersSortDir = 'desc';
          renderMain();
        }
        break;
      }

      case 'set-team-players-sort': {
        const nextKey = btn.getAttribute('data-sort-key') || '';
        if (nextKey) {
          const defaultKey = state.teamPlayersCat === 'def' ? 'tackles' : 'yards';
          const effectiveCurKey = state.teamPlayersSortKey || defaultKey;
          if (effectiveCurKey === nextKey) {
            state.teamPlayersSortKey = nextKey;
            state.teamPlayersSortDir = state.teamPlayersSortDir === 'desc' ? 'asc' : 'desc';
          } else {
            state.teamPlayersSortKey = nextKey;
            state.teamPlayersSortDir = 'desc';
          }
          renderMain();
        }
        break;
      }

      case 'set-snap-matrix-unit': {
        state.snapMatrixUnit = btn.getAttribute('data-snap-unit') === 'defense' ? 'defense' : 'offense';
        renderMain();
        break;
      }

      case 'set-roster-unit':
        state.rosterUnitFilter = btn.getAttribute('data-unit') || 'All';
        renderMain();
        break;

      case 'set-roster-pos':
        state.rosterPosFilter = btn.getAttribute('data-pos') || 'ALL';
        renderMain();
        break;

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

      case 'open-player-sheet': {
        const pid = btn.getAttribute('data-player-id');
        const player = getPlayerById(pid);
        if (player) {
          state.sheetRemoteContext = null;
          state.sheetMode = 'player';
          state.sheetPlayerId = player.id;
          state.sheetPlayerTab = btn.getAttribute('data-initial-tab') || 'overview';
          state.sheetPlayerStatsMode = '2026';
          state.sheetPlayerGameLogSub = 'games';
          state.sheetPlayerMentionsSort = 'top';
          renderSheet();
        }
        break;
      }

      case 'open-opponent-player-sheet': {
        const teamAbbr = btn.getAttribute('data-opp-team') || '';
        const oppPid = btn.getAttribute('data-opp-player-id') || '';
        const oppName = btn.getAttribute('data-opp-player-name') || '';
        const oppPos = btn.getAttribute('data-opp-player-pos') || '';
        const oppEspnUrl = btn.getAttribute('data-opp-espn-url') || '';
        const initialTab = btn.getAttribute('data-initial-tab') || 'overview';
        void openOpponentPlayerSheet({
          teamAbbr,
          playerId: oppPid,
          playerName: oppName,
          position: oppPos,
          espnUrl: oppEspnUrl,
          initialTab
        });
        break;
      }

      case 'retry-remote-player-sheet': {
        const rc = state.sheetRemoteContext;
        if (rc?.teamMeta) {
          void openOpponentPlayerSheet({
            teamAbbr: rc.teamMeta.abbr,
            playerId: rc.query?.playerId || '',
            playerName: rc.query?.name || '',
            position: rc.query?.position || '',
            espnUrl: rc.query?.espnUrl || '',
            initialTab: state.sheetPlayerTab || 'overview',
            forceRefresh: true
          });
        }
        break;
      }

      case 'set-player-tab':
        state.sheetPlayerTab = btn.getAttribute('data-player-tab') || 'overview';
        renderSheet();
        break;

      case 'set-player-mentions-sort':
        state.sheetPlayerMentionsSort = normalizeNewsSortMode(btn.getAttribute('data-sort-mode') || 'top');
        renderSheet({ preserveScroll: true });
        break;

      case 'set-player-stats-mode':
        state.sheetPlayerStatsMode = btn.getAttribute('data-stats-mode') || '2026';
        renderSheet();
        break;

      case 'set-player-gamelog-sub':
        state.sheetPlayerGameLogSub = btn.getAttribute('data-gamelog-sub') === 'splits' ? 'splits' : 'games';
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
        const rawNext = btn.getAttribute('data-season-sub') || 'matchup';
        const nextSeasonSub = rawNext === 'draft_class' ? 'draft_prep' : rawNext;
        if (rawNext === 'draft_class') state.draftSubTab = 'class';
        if (nextSeasonSub === 'schedule') state.schedulePrevExpanded = false;
        state.seasonSubTab = nextSeasonSub;
        state.userPickedSeasonSubDuringLive = true;
        if (nextSeasonSub !== 'gamecast') {
          state.gamecastFromSchedule = false;
          stopGamecastLivePoller();
        }
        if (nextSeasonSub === 'matchup') {
          triggerDailyMatchupIntelSync();
        }
        renderMain();
        if (nextSeasonSub === 'gamecast') {
          ensureGamecastHydratedAndPolling({ forceRefresh: false });
        }
        break;
      }

      case 'set-matchup-stats-unit': {
        state.matchupStatsUnit = btn.getAttribute('data-unit-id') || 'offense';
        renderMain();
        break;
      }

      case 'set-big-board-lens': {
        const nextLens = normalizeBigBoardLens(btn.getAttribute('data-lens') || 'consensus');
        state.bigBoardLens = nextLens;
        state.bigBoardSortField = nextLens;
        state.bigBoardSortDir = 'asc';
        syncBigBoardUrlIfActive();
        renderMain();
        break;
      }

      case 'sort-big-board-col': {
        const colKey = btn.getAttribute('data-sort-col') || 'consensus';
        if (state.bigBoardSortField === colKey) {
          state.bigBoardSortDir = state.bigBoardSortDir === 'asc' ? 'desc' : 'asc';
        } else {
          const { field, dir } = normalizeBigBoardSort(colKey, '');
          state.bigBoardSortField = field;
          state.bigBoardSortDir = dir;
          if (field === 'consensus' || field === 'buzz' || field === 'pff') {
            state.bigBoardLens = field;
          }
        }
        syncBigBoardUrlIfActive();
        renderMain();
        break;
      }

      case 'toggle-big-board-sort-dir': {
        state.bigBoardSortDir = state.bigBoardSortDir === 'asc' ? 'desc' : 'asc';
        syncBigBoardUrlIfActive();
        renderMain();
        break;
      }

      case 'toggle-big-board-filter-drawer': {
        state.bigBoardFilterDrawerOpen = !state.bigBoardFilterDrawerOpen;
        renderMain();
        break;
      }

      case 'set-big-board-pos': {
        state.bigBoardPosFilter = btn.getAttribute('data-pos-group') || 'ALL';
        state.bigBoardPositions = [];
        syncBigBoardUrlIfActive();
        renderMain();
        break;
      }

      case 'toggle-big-board-pos-chip': {
        const pKey = String(btn.getAttribute('data-pos') || '').toUpperCase();
        if (pKey) {
          const cur = new Set(state.bigBoardPositions || []);
          if (cur.has(pKey)) cur.delete(pKey);
          else cur.add(pKey);
          state.bigBoardPositions = [...cur];
          if (state.bigBoardPosFilter !== 'OFF' && state.bigBoardPosFilter !== 'DEF') {
            state.bigBoardPosFilter = 'ALL';
          }
          syncBigBoardUrlIfActive();
          renderMain();
        }
        break;
      }

      case 'set-big-board-range': {
        state.bigBoardRange = btn.getAttribute('data-range') || 'all';
        syncBigBoardUrlIfActive();
        renderMain();
        break;
      }

      case 'set-big-board-agreement': {
        state.bigBoardAgreement = btn.getAttribute('data-agree') || 'all';
        syncBigBoardUrlIfActive();
        renderMain();
        break;
      }

      case 'toggle-big-board-ranked-only': {
        state.bigBoardRankedOnly = !state.bigBoardRankedOnly;
        syncBigBoardUrlIfActive();
        renderMain();
        break;
      }

      case 'reset-big-board-filters': {
        resetBigBoardState();
        syncBigBoardUrlIfActive();
        renderMain();
        break;
      }

      case 'share-big-board-url': {
        const shareSearch = buildBigBoardUrlSearch(window.location.search || '', {
          lens: state.bigBoardLens,
          sortField: state.bigBoardSortField,
          sortDir: state.bigBoardSortDir,
          positions: state.bigBoardPositions,
          posGroup: state.bigBoardPosFilter,
          range: state.bigBoardRange,
          agreement: state.bigBoardAgreement,
          rankedOnly: state.bigBoardRankedOnly,
          search: state.bigBoardSearch,
          includeDraftNav: true
        });
        let fullShareUrl = `${window.location.origin}${window.location.pathname}${shareSearch}`;
        if (isNflHubMode() && ACTIVE_TEAM?.domain) {
          const canonicalParams = new URLSearchParams(String(shareSearch || '').replace(/^\?/, ''));
          canonicalParams.delete('team');
          const canonicalQs = canonicalParams.toString();
          fullShareUrl = `https://${ACTIVE_TEAM.domain}/${canonicalQs ? `?${canonicalQs}` : ''}`;
        }
        try {
          window.history.replaceState(null, '', `${window.location.pathname}${shareSearch}${window.location.hash || ''}`);
        } catch {}
        try {
          await navigator.clipboard?.writeText?.(fullShareUrl);
        } catch {}
        state.bigBoardShareCopied = true;
        renderMain();
        setTimeout(() => {
          state.bigBoardShareCopied = false;
          if (state.activeNavTab === 'season' && state.seasonSubTab === 'draft_prep') {
            renderMain();
          }
        }, 1800);
        break;
      }

      case 'toggle-big-board-expand': {
        if (state.bigBoardExpanded || state.bigBoardShowAll) {
          state.bigBoardExpanded = false;
          state.bigBoardShowAll = false;
        } else {
          state.bigBoardExpanded = true;
        }
        renderMain();
        break;
      }

      case 'show-all-big-board': {
        state.bigBoardExpanded = true;
        state.bigBoardShowAll = true;
        renderMain();
        break;
      }

      case 'open-stat-rank-modal': {
        const scope = btn.getAttribute('data-rank-scope') || 'team';
        const key = btn.getAttribute('data-rank-key') || '';
        const playerId = btn.getAttribute('data-player-id') || state.sheetPlayerId || null;
        const focusTeamAbbr = btn.getAttribute('data-focus-team') || null;
        if (key) {
          closeJargonPopover();
          state.rankModal = { scope, key, playerId, focusTeamAbbr };
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
          state.sheetRemoteContext = null;
          state.sheetMode = 'player';
          state.sheetPlayerId = targetPlayer.id;
          state.sheetPlayerTab = 'stats';
          state.sheetPlayerMentionsSort = 'top';
          renderSheet();
        }
        break;
      }

      case 'open-opponent-player-from-rank-modal': {
        const teamAbbr = btn.getAttribute('data-opp-team') || '';
        const oppName = btn.getAttribute('data-opp-player-name') || '';
        const oppPos = btn.getAttribute('data-opp-player-pos') || '';
        const oppEspnUrl = btn.getAttribute('data-opp-espn-url') || '';
        closeStatRankModal();
        void openOpponentPlayerSheet({
          teamAbbr,
          playerName: oppName,
          position: oppPos,
          espnUrl: oppEspnUrl,
          initialTab: 'stats'
        });
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

      case 'set-playoff-standings-view': {
        const nextView = btn.getAttribute('data-standings-view') || 'picture';
        if (['picture', 'division', 'conference', 'league'].includes(nextView)) {
          state.playoffStandingsView = nextView;
          renderMain();
        }
        break;
      }

      case 'set-playoff-standings-conf': {
        const nextConf = String(btn.getAttribute('data-standings-conf') || 'NFC').toUpperCase();
        if (nextConf === 'NFC' || nextConf === 'AFC') {
          state.playoffStandingsConf = nextConf;
          renderMain();
        }
        break;
      }

      case 'toggle-playoff-seed-bars':
        state.playoffSeedBarsExpanded = !state.playoffSeedBarsExpanded;
        renderMain();
        break;

      case 'jump-to-playoff-standings': {
        const target = document.getElementById('playoffStandingsCard');
        if (target) {
          target.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
        break;
      }

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

      case 'sync-live-wire-now': {
        const rc = state.sheetMode === 'player' ? state.sheetRemoteContext : null;
        if (rc?.teamMeta) {
          await Promise.allSettled([
            openOpponentPlayerSheet({
              teamAbbr: rc.teamMeta.abbr,
              playerId: rc.query?.playerId || '',
              playerName: rc.query?.name || '',
              position: rc.query?.position || '',
              espnUrl: rc.query?.espnUrl || '',
              initialTab: state.sheetPlayerTab || 'overview',
              forceRefresh: true
            }),
            pollLowLatencyTweetAndInjuryWire(true)
          ]);
        } else {
          await pollLowLatencyTweetAndInjuryWire(true);
        }
        break;
      }

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
        const ep =
          getAllEpisodes().find(x => x.id === epId) ||
          (state.audioState?.episode?.id === epId ? state.audioState.episode : null);
        if (ep) {
          if (state.sharedAudioPrep && !state.sharedAudioPrep.active && state.sharedAudioPrep.episodeId === ep.id) {
            state.sharedAudioPrep = null;
          }
          if (state.audioState?.episode?.id === ep.id) {
            await audioController.togglePlayPause();
          } else {
            await audioController.loadAndPlay(ep, 0);
          }
          renderMain();
        }
        break;
      }

      case 'retry-shared-audio': {
        audioController?.primeForUserGesture();
        const epId = btn.getAttribute('data-episode-id');
        const ep =
          getAllEpisodes().find(x => x.id === epId) ||
          (state.audioState?.episode?.id === epId ? state.audioState.episode : null);
        if (ep) {
          state.sharedAudioPrep = null;
          await audioController.loadAndPlay(ep, 0);
          renderMain();
        }
        break;
      }

      case 'play-device-voice': {
        audioController?.primeForUserGesture();
        const epId = btn.getAttribute('data-episode-id');
        const ep =
          getAllEpisodes().find(x => x.id === epId) ||
          (state.audioState?.episode?.id === epId ? state.audioState.episode : null);
        if (ep) {
          state.sharedAudioPrep = null;
          audioController?.playWithDeviceVoiceFallback(ep, 0);
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
          if (!ep._sharedVoiceKey && inMemorySharedVoiceKeys.has(ep.id)) {
            ep._sharedVoiceKey = inMemorySharedVoiceKeys.get(ep.id);
          }
          const shareUrl = await buildShareablePodcastUrl(ep, window.location, state.prefs);
          window.__lastSharedUrl = shareUrl;
          const shareRes = await shareItemNatively({
            title: `${ACTIVE_TEAM.brandName} Podcast: ${ep.title}`,
            text: `Listen to "${ep.title}" (${formatTimeMmSs(ep.durationSec)}) on ${ACTIVE_TEAM.brandName}:`,
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

      case 'share-podcast-audio': {
        const epId = btn.getAttribute('data-episode-id');
        const ep =
          getAllEpisodes().find(x => x.id === epId) ||
          (state.audioState?.episode?.id === epId ? state.audioState.episode : null);
        if (ep) {
          const origHtml = btn.innerHTML;
          btn.disabled = true;
          btn.innerHTML = `${iconSvg('loader', 13, 'btn-spin-icon')}<span>MP3…</span>`;
          try {
            const audioFile = await exportEpisodeShareableAudioFile(ep, 48);
            if (audioFile) {
              await shareAudioFileNatively({
                file: audioFile,
                title: `${ACTIVE_TEAM.brandName} Podcast: ${ep.title}`,
                text: `${ep.title} (${formatTimeMmSs(ep.durationSec)}) — ${ACTIVE_TEAM.brandName}`
              });
            }
          } finally {
            btn.disabled = false;
            btn.innerHTML = origHtml;
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
            title: `${ACTIVE_TEAM.nickname} Scouting & Cap Brief: ${rep.title}`,
            text: `Read "${rep.title}" on ${ACTIVE_TEAM.brandName}:`,
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
        e.preventDefault();
        if (btn.disabled) break;
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
          const published = await publishSharedGeminiApiKey({
            apiKey: rawKey,
            verifiedModel: verified.bestModel || '',
            updatedAt: state.prefs.geminiApiKeyUpdatedAt || 0,
            syncPasscode: state.prefs.groupPasscode || ''
          });
          state.prefs.geminiApiKey = published.apiKey;
          state.prefs.verifiedGeminiModel = published.verifiedModel;
          state.prefs.geminiApiKeyUpdatedAt = published.updatedAt;
          saveUserPrefs(state.prefs);
          state.geminiKeyNotice = '';
          state.passkeyNotice = '';
          state.showGeminiKeyGuide = false;
          if (isPasskeyPrfPotentiallySupported() && !state.prefs.passkeySyncEnabled) {
            state.showPasskeySyncOffer = true;
          }
          if (state.jobStatus?.error) state.jobStatus = null;
          triggerDailyMatchupIntelSync().finally(() => triggerDailyTopNewsBriefSync());
          renderMain();
        } catch (err) {
          state.geminiKeyNotice = err.message || 'Unable to verify Gemini API Key.';
          renderMain();
        }
        break;
      }

      case 'enable-passkey-sync': {
        if (state.passkeyBusy) break;
        const currentRec = state.prefs.geminiApiKey
          ? {
              v: 1,
              k: String(state.prefs.geminiApiKey).trim(),
              m: String(state.prefs.verifiedGeminiModel || '').trim(),
              t: Number(state.prefs.geminiApiKeyUpdatedAt) || Date.now(),
              c: 0
            }
          : readSameOriginSharedGeminiKey();
        if (!currentRec || currentRec.c === 1) {
          state.passkeyNotice = 'Add your Gemini API key first before enabling Face ID sync.';
          state.geminiKeyNotice = state.passkeyNotice;
          if (state.sheetMode === 'settings') renderSheet(true);
          renderMain();
          break;
        }
        // IMPORTANT: Invoke `enablePasskeyKeySync` synchronously BEFORE any `await` or DOM rebuild
        // that could interfere with iOS Safari's transient Face ID user activation!
        state.passkeyBusy = true;
        state.passkeyNotice = '';
        btn.disabled = true;
        const syncPromise = enablePasskeyKeySync({ record: currentRec });
        try {
          const res = await syncPromise;
          if (res.ok) {
            state.prefs.passkeySyncEnabled = true;
            if (res.record?.k) {
              state.prefs.geminiApiKey = res.record.k;
              state.prefs.verifiedGeminiModel = res.record.m || state.prefs.verifiedGeminiModel || '';
              state.prefs.geminiApiKeyUpdatedAt = res.record.t || state.prefs.geminiApiKeyUpdatedAt || Date.now();
            }
            saveUserPrefs(state.prefs);
            state.showPasskeySyncOffer = false;
            state.passkeyNeedsSecondTap = false;
            state.geminiKeyNotice = '';
            state.passkeyNotice =
              'Face ID Sync enabled! Open any other standalone team app and tap once for Face ID to unlock your key.';
          } else if (res.status === 'needs_verification_tap') {
            state.passkeyNeedsSecondTap = true;
            state.showPasskeySyncOffer = true;
            state.passkeyNotice = res.message || 'Passkey created! Tap Finish Face ID Sync once to complete.';
            state.geminiKeyNotice = state.passkeyNotice;
          } else if (res.status !== 'cancelled') {
            state.passkeyNotice = res.message || 'Unable to enable Face ID sync.';
            state.geminiKeyNotice = state.passkeyNotice;
          }
        } finally {
          state.passkeyBusy = false;
        }
        if (state.sheetMode === 'settings') renderSheet(true);
        renderMain();
        break;
      }

      case 'unlock-passkey-sync': {
        if (state.passkeyBusy) break;
        const localRec = state.prefs.geminiApiKey
          ? {
              v: 1,
              k: String(state.prefs.geminiApiKey).trim(),
              m: String(state.prefs.verifiedGeminiModel || '').trim(),
              t: Number(state.prefs.geminiApiKeyUpdatedAt) || Date.now(),
              c: 0
            }
          : readSameOriginSharedGeminiKey();
        // IMPORTANT: Invoke `unlockAndSyncWithPasskey` synchronously inside click gesture for iOS Safari!
        state.passkeyBusy = true;
        state.passkeyNotice = '';
        btn.disabled = true;
        const unlockPromise = unlockAndSyncWithPasskey({ localRecord: localRec });
        try {
          const res = await unlockPromise;
          if (res.ok && res.record?.k) {
            const prevKey = String(state.prefs.geminiApiKey || '').trim();
            state.prefs.geminiApiKey = res.record.k;
            state.prefs.verifiedGeminiModel = res.record.m || state.prefs.verifiedGeminiModel || '';
            state.prefs.geminiApiKeyUpdatedAt = res.record.t || Date.now();
            state.prefs.passkeySyncEnabled = true;
            saveUserPrefs(state.prefs);
            state.showPasskeySyncOffer = false;
            state.passkeyNeedsSecondTap = false;
            state.showGeminiKeyGuide = false;
            state.geminiKeyNotice = '';
            state.passkeyNotice =
              res.status === 'pushed'
                ? 'Face ID Sync complete! Your Gemini API key is ready across all 32 team apps.'
                : 'Synced with Face ID! Your Gemini API key is now active in this app.';
            if (state.jobStatus?.error) state.jobStatus = null;
            if (res.record.k !== prevKey) {
              checkAndAutoUpdateBestGeminiModel(state.prefs, () => {
                saveUserPrefs(state.prefs);
                if (state.activeNavTab === 'audio') renderMain();
              });
              triggerDailyMatchupIntelSync().finally(() => triggerDailyTopNewsBriefSync());
            }
          } else if (res.status !== 'cancelled') {
            state.passkeyNotice = res.message || 'Unable to sync key with Face ID.';
            state.geminiKeyNotice = state.passkeyNotice;
          }
        } finally {
          state.passkeyBusy = false;
        }
        if (state.sheetMode === 'settings') renderSheet(true);
        renderMain();
        break;
      }

      case 'dismiss-passkey-sync-offer': {
        state.showPasskeySyncOffer = false;
        state.passkeyNeedsSecondTap = false;
        renderMain();
        break;
      }

      case 'clear-gemini-key': {
        const cleared = await publishClearedSharedGeminiApiKey({
          updatedAt: state.prefs.geminiApiKeyUpdatedAt || 0,
          syncPasscode: state.prefs.groupPasscode || ''
        });
        state.prefs.geminiApiKey = '';
        state.prefs.verifiedGeminiModel = '';
        state.prefs.geminiApiKeyUpdatedAt = cleared.updatedAt;
        saveUserPrefs(state.prefs);
        state.geminiKeyNotice = '';
        renderSheet();
        renderMain();
        break;
      }

      case 'delete-podcast': {
        const epId = btn.getAttribute('data-episode-id');
        if (epId) {
          const delSet = new Set(state.prefs.deletedEpisodeIds || []);
          delSet.add(epId);
          state.prefs.deletedEpisodeIds = Array.from(delSet);
          state.prefs.localCustomEpisodes = (state.prefs.localCustomEpisodes || []).filter(
            ep => ep.id !== epId
          );
          state.expandedTranscriptIds.delete(epId);
          inMemorySharedVoiceKeys.delete(epId);
          if (state.sharedAudioPrep?.episodeId === epId) {
            state.sharedAudioPrep = null;
          }
          if (state.audioState?.episode?.id === epId) {
            audioController?.closePlayer();
          }
          saveUserPrefs(state.prefs);
          await deleteEpisodeAudioBlob(epId);
          renderMain();
        }
        break;
      }

      case 'delete-analysis': {
        const analysisId = btn.getAttribute('data-analysis-id');
        if (analysisId) {
          const delSet = new Set(state.prefs.deletedAnalysisIds || []);
          delSet.add(analysisId);
          state.prefs.deletedAnalysisIds = Array.from(delSet);
          state.prefs.localCustomAnalyses = (state.prefs.localCustomAnalyses || []).filter(
            a => a.id !== analysisId
          );
          if (state.sharedAnalysisHighlightId === analysisId) {
            state.sharedAnalysisHighlightId = null;
          }
          saveUserPrefs(state.prefs);
          renderMain();
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
            subDetail: `Querying live ${ACTIVE_TEAM.nickname} beat wire, ESPN headlines & ${state.appData?.roster?.players?.length || 90}-player roster/EPA/cap ledger.`
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
          state.prefs.localCustomEpisodes = [
            persistableEpisode,
            ...(state.prefs.localCustomEpisodes || []).filter(e => e.id !== episode.id)
          ].slice(0, 20);
          saveUserPrefs(state.prefs);
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
            subDetail: `Querying live ESPN NFL Nation, Bluesky beat wire & ${state.appData?.roster?.players?.length || 90}-player roster/EPA/cap ledger.`
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
          state.prefs.localCustomAnalyses = [
            report,
            ...(state.prefs.localCustomAnalyses || []).filter(a => a.id !== report.id)
          ].slice(0, 25);
          saveUserPrefs(state.prefs);
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
        const prevPasscode = String(state.prefs.groupPasscode || '').trim();
        if (authEl) state.prefs.authorName = authEl.value.trim() || 'Josh';
        if (passEl) state.prefs.groupPasscode = passEl.value.trim();
        if (urlEl) state.prefs.workerBaseUrl = urlEl.value.trim();
        const nextPasscode = String(state.prefs.groupPasscode || '').trim();
        let didPublishExplicitKeyChange = false;
        if (geminiKeyEl) {
          const prevKey = String(state.prefs.geminiApiKey || '').trim();
          const nextKey = geminiKeyEl.value.trim();
          if (!nextKey) {
            state.prefs.geminiApiKey = '';
            state.prefs.verifiedGeminiModel = '';
            if (prevKey) {
              const cleared = await publishClearedSharedGeminiApiKey({
                updatedAt: state.prefs.geminiApiKeyUpdatedAt || 0,
                syncPasscode: nextPasscode
              });
              state.prefs.geminiApiKeyUpdatedAt = cleared.updatedAt;
              didPublishExplicitKeyChange = true;
            }
          } else {
            let nextModel = nextKey === prevKey ? state.prefs.verifiedGeminiModel || '' : '';
            try {
              const verified = await verifyGeminiApiKey(nextKey, state.prefs.geminiApiBaseUrl);
              nextModel = verified.bestModel || nextModel;
            } catch {
              // Keep user's key saved even if offline or verifying later
            }
            const published = await publishSharedGeminiApiKey({
              apiKey: nextKey,
              verifiedModel: nextModel,
              updatedAt: state.prefs.geminiApiKeyUpdatedAt || 0,
              syncPasscode: nextPasscode
            });
            state.prefs.geminiApiKey = published.apiKey;
            state.prefs.verifiedGeminiModel = published.verifiedModel;
            state.prefs.geminiApiKeyUpdatedAt = published.updatedAt;
            didPublishExplicitKeyChange = true;
          }
        }
        saveUserPrefs(state.prefs);
        // When an 8+ char E2EE Sync Passcode is newly entered or changed (especially on a fresh isolated
        // iOS Home Screen PWA without a key yet), immediately reconcile against the zero-knowledge cloud vault!
        if (
          isEligibleE2eeSyncPasscode(nextPasscode) &&
          (!didPublishExplicitKeyChange || nextPasscode !== prevPasscode || !state.prefs.geminiApiKey)
        ) {
          await syncSharedGeminiKeyAcrossTeams({ triggerBriefs: false, forceCloudSync: true });
        }
        clearDailyNewsBriefAttemptLock();
        clearDailyMatchupIntelAttemptLock();
        state.geminiKeyNotice = '';
        state.passkeyNotice = '';
        if (state.prefs.geminiApiKey && isPasskeyPrfPotentiallySupported() && !state.prefs.passkeySyncEnabled) {
          state.showPasskeySyncOffer = true;
        }
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

  // Prevent native full-page reload on iCloud Keychain / Apple Passwords credential forms
  document.addEventListener('submit', e => {
    const form = e.target;
    if (!form || !form.matches) return;
    if (form.matches('[data-inline-gemini-form="true"]')) {
      e.preventDefault();
      form.querySelector('[data-action="save-inline-gemini-key"]')?.click();
    } else if (form.matches('[data-settings-gemini-form="true"]')) {
      e.preventDefault();
      document.querySelector('[data-action="save-group-config"]')?.click();
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
    } else if (t.id === 'bigBoardSearchInput') {
      state.bigBoardSearch = t.value;
      syncBigBoardUrlIfActive();
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
    } else if (t.id === 'universalSearchInput') {
      state.universalSearchQuery = t.value;
      state.universalSearchForceLiteral = false;
      updateUniversalSearchLiveDom({ resetScroll: true, syncInputValue: false });
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
    } else if (t.id === 'bigBoardSortSelect') {
      const nextField = t.value;
      const def = BIG_BOARD_SORT_FIELDS.find(f => f.key === nextField);
      state.bigBoardSortField = nextField;
      if (def) state.bigBoardSortDir = def.defaultDir;
      if (nextField === 'consensus' || nextField === 'buzz' || nextField === 'pff') {
        state.bigBoardLens = nextField;
      }
      syncBigBoardUrlIfActive();
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
    } else if (t.getAttribute('data-action') === 'toggle-push-channel') {
      const ch = t.getAttribute('data-push-channel');
      if (ch && ['tier1Breaking', 'dailyBriefReady', 'practiceDowngrades'].includes(ch)) {
        if (!state.prefs.pushAlerts) {
          state.prefs.pushAlerts = {
            enabled: false,
            channels: { tier1Breaking: true, dailyBriefReady: true, practiceDowngrades: false },
            subscribedAt: null,
            endpoint: ''
          };
        }
        state.prefs.pushAlerts.channels = {
          ...(state.prefs.pushAlerts.channels || {}),
          [ch]: Boolean(t.checked)
        };
        saveUserPrefs(state.prefs);
      }
    } else if (t.getAttribute('data-action') === 'select-gamecast-game') {
      const nextId = String(t.value || '').trim();
      if (isNumericEspnGameId(nextId)) {
        state.gamecastGameId = nextId;
        state.gamecastExpandedDrives = new Set();
        state.gamecastPbpQuarter = 'ALL';
        state.gamecastPbpFilter = 'all';
        state.activeGamecastClipKey = '';
        state.gamecastLastSituationFp = '';
        const targetMeta = getActiveGamecastTarget().meta;
        state.gamecastTab = targetMeta?.isLive ? 'pbp' : 'box';
        renderMain();
        ensureGamecastHydratedAndPolling({ forceRefresh: false });
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

  // Persist open/closed Gamecast Play-by-Play drive accordions across 2s live refreshes
  document.addEventListener(
    'toggle',
    e => {
      const el = e.target;
      if (!el || el.tagName !== 'DETAILS') return;
      const driveId = el.getAttribute('data-gamecast-drive-id');
      if (!driveId) return;
      if (!(state.gamecastExpandedDrives instanceof Set)) {
        state.gamecastExpandedDrives = new Set();
      }
      if (el.open) state.gamecastExpandedDrives.add(driveId);
      else state.gamecastExpandedDrives.delete(driveId);
    },
    true
  );

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
        const fallbackSrc = target.getAttribute('data-fallback-src');
        if (fallbackSrc && /^https:\/\//i.test(fallbackSrc) && target.src !== fallbackSrc) {
          target.removeAttribute('data-fallback-src');
          target.src = fallbackSrc;
          return;
        }
        const wrap = target.closest(
          '.player-avatar, .team-logo-wrap, .brief-hero-media, .salient-hero-banner, .raw-item-thumb, .yt-facade-media, .video-thumb-stage, .beat-podcast-art-wrap, .home-pod-art-item'
        );
        if (wrap) wrap.classList.add('img-error');
      }
    },
    true
  );

  // Pull-to-refresh gesture at top of Home & News & Film (mobile ergonomics)
  let ptrStartY = null;
  let ptrDeltaY = 0;
  let ptrArmed = false;
  const ptrEl = document.getElementById('pullRefreshIndicator');
  const ptrLabel = document.getElementById('pullRefreshLabel');

  document.addEventListener(
    'touchstart',
    e => {
      if (
        (state.activeNavTab !== 'home' && state.activeNavTab !== 'news') ||
        state.sheetMode ||
        state.rankModal ||
        window.scrollY > 2 ||
        e.touches.length !== 1
      ) {
        ptrStartY = null;
        return;
      }
      ptrStartY = e.touches[0].clientY;
      ptrDeltaY = 0;
      ptrArmed = false;
    },
    { passive: true }
  );

  document.addEventListener(
    'touchmove',
    e => {
      if (ptrStartY === null || e.touches.length !== 1) return;
      const dy = e.touches[0].clientY - ptrStartY;
      if (dy <= 14 || window.scrollY > 2) {
        if (ptrEl && !ptrEl.hidden) ptrEl.hidden = true;
        ptrArmed = false;
        return;
      }
      ptrDeltaY = Math.min(96, dy);
      if (ptrDeltaY >= 24 && ptrEl && ptrLabel) {
        ptrEl.hidden = false;
        ptrArmed = ptrDeltaY >= 60;
        ptrEl.classList.toggle('armed', ptrArmed);
        ptrLabel.textContent = ptrArmed ? 'Release to sync live wire' : 'Pull to sync live wire';
      }
    },
    { passive: true }
  );

  document.addEventListener(
    'touchend',
    () => {
      if (ptrStartY === null) return;
      const shouldSync = ptrArmed && !state.isSyncingWire;
      ptrStartY = null;
      ptrDeltaY = 0;
      ptrArmed = false;
      if (shouldSync && ptrEl && ptrLabel) {
        ptrEl.hidden = false;
        ptrEl.classList.add('armed');
        ptrLabel.textContent = 'Syncing live wire…';
        pollLowLatencyTweetAndInjuryWire(true).finally(() => {
          setTimeout(() => {
            if (ptrEl) {
              ptrEl.hidden = true;
              ptrEl.classList.remove('armed');
            }
          }, 400);
        });
      } else if (ptrEl) {
        ptrEl.hidden = true;
        ptrEl.classList.remove('armed');
      }
    },
    { passive: true }
  );
}

const GAME_LIVE_WIRE_POLL_MS = 8_000; // 8s ultra-low latency during live 49ers game windows
const STANDARD_WIRE_POLL_MS = 25_000; // 25s sub-minute latency year-round

let lastLiveCheckMs = 0;
let lastWirePollMs = 0;
let wirePollCount = 0;
let isBackgroundSyncing = false;
let isWirePolling = false;
let wirePollTimerId = null;
let activeWirePollPromise = null;
let activeWirePollMeta = { manual: false, focusPlayerId: null, startedAtMs: 0 };
let queuedManualSync = null; // { focusPlayerId: string | null }

function hasActivelyPlayingInlineMedia() {
  if (typeof document === 'undefined') return false;
  if (document.querySelector('.video-iframe-wrap iframe')) return true;
  const videos = document.querySelectorAll('.video-iframe-wrap video, .gc-inline-clip-stage video');
  for (const v of videos) {
    if (v.ended) {
      const k = v.getAttribute('data-vid-key');
      if (k) state.activeVideosSet.delete(k);
      continue;
    }
    if (!v.dataset.inlineFailed && !v.error) {
      return true;
    }
  }
  return false;
}

function mergeRuntimeStateIntoUpstreamBundle(prevData, nextData) {
  if (!prevData || !nextData) return nextData;
  // Preserve live runtime tweets/highlights discovered in-browser that aren't yet in upstream JSON
  if (Array.isArray(prevData.news?.rawStream) && Array.isArray(nextData.news?.rawStream)) {
    const runtimeOnly = prevData.news.rawStream.filter(it => it && it.wireSource);
    if (runtimeOnly.length > 0) {
      nextData.news.rawStream = sortNewsWithBreakingPriority(
        filterOutCompletedGameAvailabilityItems(
          dedupeRawStreamAtomically([...runtimeOnly, ...nextData.news.rawStream]),
          nextData
        ),
        Date.now(),
        { appData: nextData }
      );
    }
  }
  // Preserve a newer/non-stale live or KV Daily Brief whenever an older-cycle or non-canonical upstream JSON bundle reloads
  const prevBrief = prevData.news?.dailyTopNewsBrief;
  const nextBrief = nextData.news?.dailyTopNewsBrief;
  if (prevBrief?.generatedAt && nextData.news) {
    const mergedBrief = mergeDailyTopNewsBriefOnUpstreamRefresh(prevBrief, nextBrief, nextData, Date.now());
    if (mergedBrief) {
      nextData.news.dailyTopNewsBrief = mergedBrief;
    }
  }
  if (Array.isArray(prevData._livePlayedPlayerIds) && !nextData._livePlayedPlayerIds) {
    nextData._livePlayedPlayerIds = prevData._livePlayedPlayerIds;
  }
  if (
    prevData.scheduleMatchup?.lastCompletedGameRecap &&
    nextData.scheduleMatchup &&
    !nextData.scheduleMatchup.lastCompletedGameRecap
  ) {
    nextData.scheduleMatchup.lastCompletedGameRecap = prevData.scheduleMatchup.lastCompletedGameRecap;
  }
  if (
    prevData.liveGameDay &&
    !nextData.liveGameDay &&
    Number(prevData.liveGameDay.week) === Number(nextData.scheduleMatchup?.upcomingMatchup?.week)
  ) {
    nextData.liveGameDay = prevData.liveGameDay;
  }
  const nextOppKey = `${Number(nextData.scheduleMatchup?.upcomingMatchup?.week || 0)}:${String(
    nextData.scheduleMatchup?.upcomingMatchup?.oppAbbr || ''
  ).toUpperCase()}`;
  if (Array.isArray(prevData._oppNewsWire) && prevData._oppNewsWire.length > 0 && prevData._oppNewsWireKey === nextOppKey) {
    nextData._oppNewsWire = prevData._oppNewsWire;
    nextData._oppNewsWireKey = prevData._oppNewsWireKey;
  }
  if (
    (Array.isArray(prevData.news?.rawStream) && prevData.news.rawStream.some(it => it && it.wireSource)) ||
    (Array.isArray(nextData._oppNewsWire) && nextData._oppNewsWire.length > 0)
  ) {
    reconcileRosterAndHealthWithNews(nextData);
  }
  return nextData;
}

async function executeSingleWirePollPass({ manual = false, focusPlayerId = null } = {}) {
  if (!state.appData) return;
  const gameLive = is49ersGameLiveWindow(state.appData);
  const gameCtx = resolveGameNewsContext(state.appData, Date.now());
  wirePollCount += 1;
  const viewingHealthSurface =
    (state.activeNavTab === 'season' && (state.seasonSubTab === 'health' || state.seasonSubTab === 'matchup')) ||
    state.sheetMode === 'player';
  const hasPendingPracticeSlots = (state.appData?.health?.practiceReport || []).some(
    r => r.wed === '-' || r.thu === '-' || r.fri === '-'
  );
  // During 10s live-game polling, run heavy 8-endpoint standings/roster/injuries overlay every ~30s (every 3rd tick)
  // while keeping ultra-fast beat wire + live game highlights/scoring plays running on EVERY 10s tick!
  const shouldCheckEspn =
    manual ||
    wirePollCount === 1 ||
    (gameLive ? wirePollCount % 3 === 0 : Boolean(gameCtx.postGameImmediate) || viewingHealthSurface || hasPendingPracticeSlots || wirePollCount % 2 === 0);

  // Serialize `hydrateLiveEspnOverlay` BEFORE `hydrateLiveMultiSourceBeatWire` when due so `_livePlayedPlayerIds`,
  // `completed = true`, and `upcomingMatchup.week` advance atomically with zero concurrent mutation!
  const espnChanged = shouldCheckEspn ? await hydrateLiveEspnOverlay(state.appData) : false;
  const wireResult = await hydrateLiveMultiSourceBeatWire(state.appData, {
    isGameLive: gameLive || Boolean(gameCtx.postGameImmediate),
    workerBaseUrl: state.prefs?.workerBaseUrl || '',
    focusPlayerId,
    manual
  });
  const addedTweets = Number(wireResult?.totalAdded || 0);
  const gameDayChanged = Boolean(wireResult?.gameDayChanged);
  state.lastWireSourceCounts = wireResult?.bySource || null;

  state.lastWireSyncAt = new Date().toISOString();
  lastWirePollMs = Date.now();
  if (state.appData) {
    state.appData._awaitingInitialLiveWireSync = false;
    syncHealthDeltaSnapshots(state.appData);
  }

  const briefChanged = hydrateCachedDailyTopNewsBrief(state.appData);

  if (addedTweets > 0 || espnChanged || briefChanged || gameDayChanged) {
    invalidateMonteCarloCaches();
  }
  renderHeader();

  const activeTag = document.activeElement?.tagName;
  const isTyping = activeTag === 'INPUT' || activeTag === 'TEXTAREA';
  const hasPlayingIframe = hasActivelyPlayingInlineMedia();

  if (
    (manual || addedTweets > 0 || espnChanged || briefChanged || gameDayChanged) &&
    !isTyping &&
    !hasPlayingIframe &&
    !state.jobStatus?.active
  ) {
    renderMain();
    if (state.sheetMode === 'player') {
      renderSheet({ preserveScroll: true });
    }
  } else if (state.sheetMode === 'player') {
    syncLiveWireButtonsDom();
  }

  if (shouldTriggerDailyTopNewsBriefRefresh(state.appData, state.prefs)) {
    triggerDailyTopNewsBriefSync();
  }
}

async function pollLowLatencyTweetAndInjuryWire(manual = false) {
  if (!state.appData) return;
  const requestedFocusPlayerId =
    state.sheetMode === 'player' && !state.sheetRemoteContext && state.sheetPlayerId
      ? String(state.sheetPlayerId)
      : null;

  if (isBackgroundSyncing) {
    if (manual) {
      state.isSyncingWire = true;
      queuedManualSync = {
        focusPlayerId: requestedFocusPlayerId || queuedManualSync?.focusPlayerId || null
      };
      syncLiveWireButtonsDom();
    }
    return;
  }

  // Coalesce furious manual clicks & background-poll overlaps safely with zero race conditions
  if (isWirePolling && activeWirePollPromise) {
    if (!manual) return activeWirePollPromise;
    state.isSyncingWire = true;
    syncLiveWireButtonsDom();
    const sameManualPassJustStarted =
      activeWirePollMeta.manual &&
      activeWirePollMeta.focusPlayerId === requestedFocusPlayerId &&
      Date.now() - activeWirePollMeta.startedAtMs < 650;
    if (!sameManualPassJustStarted) {
      queuedManualSync = {
        focusPlayerId: requestedFocusPlayerId || queuedManualSync?.focusPlayerId || null
      };
    }
    return activeWirePollPromise;
  }

  isWirePolling = true;
  if (manual) {
    state.isSyncingWire = true;
    syncLiveWireButtonsDom();
  }

  activeWirePollMeta = {
    manual,
    focusPlayerId: requestedFocusPlayerId,
    startedAtMs: Date.now()
  };

  activeWirePollPromise = (async () => {
    try {
      await executeSingleWirePollPass({
        manual,
        focusPlayerId: requestedFocusPlayerId
      });

      while (queuedManualSync && state.appData) {
        const nextReq = queuedManualSync;
        queuedManualSync = null;
        const effectiveFocus =
          nextReq.focusPlayerId ||
          (state.sheetMode === 'player' && !state.sheetRemoteContext && state.sheetPlayerId
            ? String(state.sheetPlayerId)
            : null);
        activeWirePollMeta = {
          manual: true,
          focusPlayerId: effectiveFocus,
          startedAtMs: Date.now()
        };
        await executeSingleWirePollPass({
          manual: true,
          focusPlayerId: effectiveFocus
        });
      }
    } catch {
      // Offline or transient network blip; keep serving existing cached state cleanly
    } finally {
      queuedManualSync = null;
      state.isSyncingWire = false;
      isWirePolling = false;
      activeWirePollPromise = null;
      syncLiveWireButtonsDom();
    }
  })();

  return activeWirePollPromise;
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
  if (isBackgroundSyncing || isWirePolling || !state.appData) return;
  isBackgroundSyncing = true;
  try {
    let hasNewUpstreamData = false;
    const upstreamAnchorIso =
      state.appData.meta?._upstreamUpdatedAt || state.appData.meta?.updatedAt || '';
    const fresherBundle = forceFull
      ? await loadAll49ersData()
      : await fetchFresherUpstreamData(upstreamAnchorIso);

    if (fresherBundle) {
      state.appData = mergeRuntimeStateIntoUpstreamBundle(state.appData, fresherBundle);
      hydrateCachedDailyMatchupIntel(state.appData);
      hydrateCachedDailyTopNewsBrief(state.appData);
      invalidateMonteCarloCaches();
      hasNewUpstreamData = true;
    }

    const bgGameCtx = resolveGameNewsContext(state.appData, Date.now());
    const [espnMutated, podsMutated] = await Promise.all([
      hydrateLiveEspnOverlay(state.appData),
      hydrateLive49ersPodcasts(state.appData)
    ]);
    const wireResult = await hydrateLiveMultiSourceBeatWire(state.appData, {
      isGameLive: is49ersGameLiveWindow(state.appData) || Boolean(bgGameCtx.postGameImmediate),
      workerBaseUrl: state.prefs?.workerBaseUrl || ''
    });
    const addedLivePosts = Number(wireResult?.totalAdded || 0);
    const gameDayChanged = Boolean(wireResult?.gameDayChanged);
    state.lastWireSourceCounts = wireResult?.bySource || null;
    state.lastWireSyncAt = new Date().toISOString();
    lastWirePollMs = Date.now();
    state.appData._awaitingInitialLiveWireSync = false;
    syncHealthDeltaSnapshots(state.appData);

    const briefHydratedChanged = hydrateCachedDailyTopNewsBrief(state.appData);

    if (addedLivePosts > 0 || espnMutated || podsMutated || briefHydratedChanged || gameDayChanged) {
      invalidateMonteCarloCaches();
      hasNewUpstreamData = true;
    }

    state.seasonState = evaluateSeasonState({
      now: new Date(),
      calendar: state.appData.meta?.calendar,
      teamStatus: state.appData.meta?.teamStatus
    });

    renderHeader();

    const activeTag = document.activeElement?.tagName;
    const isTyping = activeTag === 'INPUT' || activeTag === 'TEXTAREA';
    const hasPlayingIframe = hasActivelyPlayingInlineMedia();

    if (hasNewUpstreamData && !isTyping && !hasPlayingIframe && !state.jobStatus?.active) {
      renderMain();
      if (state.sheetMode) renderSheet({ preserveScroll: true });
    }

    if (shouldTriggerDailyTopNewsBriefRefresh(state.appData, state.prefs)) {
      triggerDailyTopNewsBriefSync();
    }

    lastLiveCheckMs = Date.now();
  } catch {
    // Offline or transient network blip; keep serving existing cached state cleanly
  } finally {
    if (state.appData) {
      state.appData._awaitingInitialLiveWireSync = false;
    }
    isBackgroundSyncing = false;
    if (queuedManualSync && state.appData) {
      const pendingFocus = queuedManualSync.focusPlayerId;
      queuedManualSync = null;
      if (pendingFocus && state.sheetMode === 'player' && !state.sheetRemoteContext) {
        state.sheetPlayerId = pendingFocus;
      }
      pollLowLatencyTweetAndInjuryWire(true);
    } else {
      state.isSyncingWire = false;
      syncLiveWireButtonsDom();
    }
  }
}

async function handleIncomingSharedLink(locationLike = window.location) {
  try {
    const rawParams = new URLSearchParams(String(locationLike?.search || '').replace(/^\?/, ''));
    const qSub = String(rawParams.get('sub') || '').toLowerCase();
    const qGameId = String(rawParams.get('gameId') || '').trim();
    if (qSub === 'gamecast' || (rawParams.get('tab') === 'season' && isNumericEspnGameId(qGameId))) {
      state.activeNavTab = 'season';
      state.seasonSubTab = 'gamecast';
      state.userPickedSeasonSubDuringLive = true;
      if (isNumericEspnGameId(qGameId)) state.gamecastGameId = qGameId;
      renderMain();
      ensureGamecastHydratedAndPolling({ forceRefresh: false });
    } else if (qSub === 'draft_class') {
      state.activeNavTab = 'season';
      state.seasonSubTab = 'draft_prep';
      state.draftSubTab = 'class';
      renderMain();
    }
  } catch {}

  const bbParams = parseBigBoardUrlParams(locationLike?.search || '');
  if (bbParams.hasBigBoardParams) {
    state.bigBoardLens = bbParams.lens;
    state.bigBoardSortField = bbParams.sortField;
    state.bigBoardSortDir = bbParams.sortDir;
    state.bigBoardPositions = bbParams.positions || [];
    state.bigBoardPosFilter = bbParams.posGroup || 'ALL';
    state.bigBoardRange = bbParams.range || 'all';
    state.bigBoardAgreement = bbParams.agreement || 'all';
    state.bigBoardRankedOnly = Boolean(bbParams.rankedOnly);
    state.bigBoardSearch = bbParams.search || '';
    if (bbParams.openDraftTab) {
      state.activeNavTab = 'season';
      state.seasonSubTab = 'draft_prep';
    }
    renderMain();
  }

  const sharedRoute = await extractIncomingSharedRoute(locationLike);
  if (!sharedRoute) return bbParams.hasBigBoardParams;

  if (sharedRoute.type === 'podcast') {
    state.activeNavTab = 'audio';
    state.studioSubTab = 'podcast';
    window.scrollTo({ top: 0, behavior: 'instant' });

    if (sharedRoute.id) {
      state.prefs.deletedEpisodeIds = (state.prefs.deletedEpisodeIds || []).filter(
        id => id !== sharedRoute.id
      );
    }

    if (sharedRoute.episode?._sharedVoiceKey && sharedRoute.id) {
      inMemorySharedVoiceKeys.set(sharedRoute.id, sharedRoute.episode._sharedVoiceKey);
    }

    let targetEp = getAllEpisodes().find(ep => ep.id === sharedRoute.id) || null;
    let readyEpisode = null;
    if (!targetEp && sharedRoute.episode) {
      targetEp = sharedRoute.episode;
      readyEpisode = targetEp;
      const { _sharedVoiceKey: _omitRelay, ...persistableSharedEp } = targetEp;
      state.prefs.localCustomEpisodes = [
        persistableSharedEp,
        ...(state.prefs.localCustomEpisodes || []).filter(e => e.id !== targetEp.id)
      ].slice(0, 20);
      saveUserPrefs(state.prefs);
    } else if (targetEp) {
      readyEpisode = sharedRoute.episode?.isSharedImport
        ? {
            ...targetEp,
            isSharedImport: true,
            ...(sharedRoute.episode._sharedVoiceKey
              ? { _sharedVoiceKey: sharedRoute.episode._sharedVoiceKey }
              : {})
          }
        : targetEp;
      saveUserPrefs(state.prefs);
    }

    renderMain();
    if (readyEpisode) {
      state.expandedTranscriptIds.delete(readyEpisode.id);
      if (state.sharedAudioPrep && state.sharedAudioPrep.episodeId !== readyEpisode.id) {
        state.sharedAudioPrep = null;
      }
      await audioController.loadEpisodeReady(readyEpisode);
      renderMain();
    }
    return true;
  }

  if (sharedRoute.type === 'analysis') {
    state.activeNavTab = 'audio';
    state.studioSubTab = 'analysis';
    window.scrollTo({ top: 0, behavior: 'instant' });

    if (sharedRoute.id) {
      state.prefs.deletedAnalysisIds = (state.prefs.deletedAnalysisIds || []).filter(
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
    state.sharedAnalysisHighlightId = targetReport?.id || sharedRoute.id || null;
    saveUserPrefs(state.prefs);
    renderMain();
    return true;
  }

  return false;
}

function syncSharedAudioPrepDomInPlace(prep) {
  if (!prep?.active) return false;
  const box = document.querySelector('[data-shared-audio-prep="active"]');
  if (!box) return false;

  const pct = Math.max(8, Math.min(99, Math.round(Number(prep.percent || 12))));
  const barEl = box.querySelector('[data-shared-prep-bar]');
  if (barEl) barEl.style.width = `${pct}%`;

  const pctBadge = box.querySelector('[data-shared-prep-pct]');
  if (pctBadge) pctBadge.textContent = `${pct}%`;

  const msgEl = box.querySelector('[data-shared-prep-message]');
  if (msgEl && prep.message) msgEl.textContent = prep.message;

  const subEl = box.querySelector('[data-shared-prep-subdetail]');
  if (subEl && !state.audioState?.isAutoPlayQueued && prep.subDetail) {
    subEl.textContent = prep.subDetail;
  }
  return true;
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
    subStatus.innerHTML = isRetrying
      ? '<span class="header-live-sync"><span class="live-pulse-dot" aria-hidden="true"></span><span>Reconnecting…</span></span>'
      : '<span class="header-live-sync"><span class="live-pulse-dot is-error" aria-hidden="true"></span><span>Offline • Tap Retry</span></span>';
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
      <h2 class="card-title">Reconnecting ${esc(ACTIVE_TEAM.nickname)} Data Feeds</h2>
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
    const upstreamAgeMs = state.appData?.meta?.updatedAt
      ? Date.now() - Date.parse(state.appData.meta.updatedAt)
      : Infinity;
    if (
      !Number.isFinite(upstreamAgeMs) ||
      upstreamAgeMs > 90 * 60_000 ||
      Boolean(state.appData?._restoredFromOfflineSnapshot)
    ) {
      state.appData._awaitingInitialLiveWireSync = true;
    }
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
      openOpponentPlayerSheet: opts => openOpponentPlayerSheet(opts),
      clearRemoteTeamCache: () => clearRemoteTeamCache(),
      setRemoteTeamDataBaseOverride: override => {
        globalThis.__REMOTE_TEAM_DATA_BASE_OVERRIDE__ = override || null;
      },
      syncSharedGeminiKey: (opts = {}) => syncSharedGeminiKeyAcrossTeams({ triggerBriefs: false, ...opts }),
      forceRender: () => {
        renderMain();
        if (state.sheetMode) renderSheet();
      }
    };

    if (!state.lastWireSyncAt && state.appData?.meta?.updatedAt) {
      state.lastWireSyncAt = state.appData.meta.updatedAt;
    }

    captureDeltaSnapshotsOnBoot(state.appData);
    renderHeader();
    renderMain();

    if (!hasCompletedBootLifecycle) {
      hasCompletedBootLifecycle = true;

      // Check if colleague arrived via a shared `?pod=...` / `#shared-pod=...` or `?analysis=...` deep link
      handleIncomingSharedLink(window.location).catch(() => {});
      window.addEventListener('hashchange', () => {
        handleIncomingSharedLink(window.location).catch(() => {});
      });

      // Real-time delta hydration (fresher GitHub Raw commits + live ESPN/Bluesky beat wire + 6 podcasts)
      // Tracked in `initialLiveHydrationPromise` so Daily Brief & Matchup Intel never synthesize on stale pre-game snapshots
      initialLiveHydrationPromise = refreshLiveFeedsInBackground(
        Boolean(state.appData._restoredFromOfflineSnapshot)
      ).finally(() => {
        initialLiveHydrationPromise = null;
      });

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

      // Instant 0-credit Shared Worker KV hydration (runs immediately on boot, including during Game-Day Hold,
      // without waiting 15–60s behind live wire hydration or Matchup Intel synthesis)
      triggerFastSharedKvBriefHydration();

      // Sequenced 1/day Gemini 4 Hydrogen (XHIGH) Matchup Intel + 5:00 PM PT Top News Brief refreshes (no split budget)
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

let sharedGeminiKeySyncPromise = null;

async function syncSharedGeminiKeyAcrossTeams({
  triggerBriefs = true,
  vaultUrlOverride = '',
  cloudEndpointOverride = '',
  forceCloudSync = false
} = {}) {
  if (sharedGeminiKeySyncPromise) return sharedGeminiKeySyncPromise;
  sharedGeminiKeySyncPromise = (async () => {
    try {
      const res = await syncPrefsWithSharedGeminiKeyVault(state.prefs, {
        vaultUrlOverride,
        cloudEndpointOverride,
        syncPasscode: state.prefs.groupPasscode || '',
        forceCloudSync
      });
      if (res.changed) {
        saveUserPrefs(state.prefs);
        if (res.nextKey && res.nextKey !== res.prevKey) {
          state.geminiKeyNotice = '';
          state.showGeminiKeyGuide = false;
          if (state.jobStatus?.error) state.jobStatus = null;
          checkAndAutoUpdateBestGeminiModel(state.prefs, () => {
            saveUserPrefs(state.prefs);
            if (state.activeNavTab === 'audio') renderMain();
          });
          if (triggerBriefs && state.appData) {
            triggerDailyMatchupIntelSync().finally(() => triggerDailyTopNewsBriefSync());
          }
        }
        if (state.appData) renderMain();
        if (state.sheetMode === 'settings') renderSheet();
      }
      return res;
    } catch {
      return { action: 'noop', changed: false, prevKey: '', nextKey: '', vaultChecked: false, cloudChecked: false };
    } finally {
      sharedGeminiKeySyncPromise = null;
    }
  })();
  return sharedGeminiKeySyncPromise;
}

async function init() {
  state.prefs = loadUserPrefs();
  applyTheme(state.prefs.theme);
  applyFeedDensity(state.prefs.feedDensity);
  state.newsSortMode = normalizeNewsSortMode(state.prefs.newsSortMode || 'top');
  // Start cross-subdomain NFL key vault sync immediately in parallel with app data boot
  loadCachedPasskeyVaultKeys()
    .then(cached => {
      if (cached && !state.prefs.passkeySyncEnabled) {
        state.prefs.passkeySyncEnabled = true;
        saveUserPrefs(state.prefs);
      }
    })
    .catch(() => {});
  syncSharedGeminiKeyAcrossTeams({ triggerBriefs: true });
  // Preserve prior visit watermark for the entire active session so "N new since …" stays stable
  state.sessionLastVisitedAt = state.prefs.lastVisitedAt || null;
  if (!state.prefs.lastVisitedAt) {
    state.prefs.lastVisitedAt = new Date().toISOString();
    saveUserPrefs(state.prefs);
  }
  const sessionBootMs = Date.now();
  if (state.prefs?.capSelectedYear) {
    state.capSelectedYear = String(state.prefs.capSelectedYear);
  }
  state.podFormat = state.prefs?.podFormat === 'solo' ? 'solo' : 'two_host';
  state.podDurationMin = Math.max(2, Math.min(20, Number(state.prefs?.defaultPodDurationMin || 3)));
  audioController = new PodcastAudioController(renderMiniPlayer, {
    onSynthesizeMissingAudio: async ep => {
      if (ep?.id && !ep._sharedVoiceKey && inMemorySharedVoiceKeys.has(ep.id)) {
        ep._sharedVoiceKey = inMemorySharedVoiceKeys.get(ep.id);
      }
      const startedAtMs = Date.now();
      state.sharedAudioPrep = {
        active: true,
        episodeId: ep.id,
        startedAtMs,
        percent: 12,
        message: 'Preparing smooth human studio voices (~20–30 sec)…',
        subDetail:
          'Tap "Play When Ready" below to start automatically when ready, or tap "Show Transcript" to read now.',
        error: ''
      };
      const elapsedTicker = setInterval(() => {
        const clockEl = document.getElementById('sharedAudioElapsedClock');
        if (clockEl) {
          const sec = Math.max(0, Math.floor((Date.now() - startedAtMs) / 1000));
          clockEl.textContent = `Elapsed ${formatTimeMmSs(sec)}`;
        }
      }, 250);

      if (state.activeNavTab === 'audio') renderMain();
      try {
        const renderedUrl = await synthesizeMissingEpisodeAudio(
          ep,
          p => {
            const pct = Math.max(
              state.sharedAudioPrep?.percent || 12,
              Math.min(99, Math.round(Number(p.subPercent ?? p.percent ?? 22)))
            );
            state.sharedAudioPrep = {
              ...state.sharedAudioPrep,
              active: true,
              episodeId: ep.id,
              startedAtMs,
              percent: pct,
              message: p.message || state.sharedAudioPrep?.message || 'Preparing smooth human studio voices…',
              subDetail: p.subDetail || state.sharedAudioPrep?.subDetail || '',
              error: ''
            };
            if (state.activeNavTab === 'audio' && !syncSharedAudioPrepDomInPlace(state.sharedAudioPrep)) {
              renderMain();
            }
          },
          state.prefs
        );
        state.sharedAudioPrep = null;
        return renderedUrl;
      } catch (err) {
        state.sharedAudioPrep = {
          active: false,
          episodeId: ep.id,
          startedAtMs,
          percent: 0,
          message: '',
          subDetail: '',
          error:
            err?.message ||
            'Unable to prepare studio audio right now. Tap Retry Studio Audio or Listen Now (Device Voice).'
        };
        return null;
      } finally {
        clearInterval(elapsedTicker);
        if (state.activeNavTab === 'audio') renderMain();
      }
    }
  });
  bindEvents();

  // Register recovery & live-sync listeners unconditionally so even an offline cold boot self-heals automatically
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      stopGamecastLivePoller();
      // Advance persisted visit watermark cleanly after active session (>=15s) so next visit highlights new items
      if (Date.now() - sessionBootMs >= 15_000) {
        state.prefs.lastVisitedAt = new Date().toISOString();
        saveUserPrefs(state.prefs);
        commitPendingWeekSnapshotRollover();
      }
      return;
    }
    if (document.visibilityState === 'visible') {
      if (state.appData && state.activeNavTab === 'season' && state.seasonSubTab === 'gamecast') {
        ensureGamecastHydratedAndPolling({ forceRefresh: false });
      }
      syncSharedGeminiKeyAcrossTeams({ triggerBriefs: true });
      if (!state.appData) {
        bootOrRecoverAppData({ manual: false });
      } else {
        triggerFastSharedKvBriefHydration();
        if (Date.now() - lastLiveCheckMs >= 5 * 60_000) {
          refreshLiveFeedsInBackground(false);
        } else if (Date.now() - lastWirePollMs >= 15_000) {
          pollLowLatencyTweetAndInjuryWire(false);
        } else if (shouldTriggerDailyTopNewsBriefRefresh(state.appData, state.prefs)) {
          triggerDailyTopNewsBriefSync();
        }
      }
    }
  });
  window.addEventListener('focus', () => {
    syncSharedGeminiKeyAcrossTeams({ triggerBriefs: true });
    if (!state.appData) {
      bootOrRecoverAppData({ manual: false });
    } else if (Date.now() - lastWirePollMs >= 15_000) {
      pollLowLatencyTweetAndInjuryWire(false);
    } else if (shouldTriggerDailyTopNewsBriefRefresh(state.appData, state.prefs)) {
      triggerDailyTopNewsBriefSync();
    }
  });
  window.addEventListener('pageshow', () => {
    syncSharedGeminiKeyAcrossTeams({ triggerBriefs: true });
  });
  window.addEventListener('storage', e => {
    if (e.key === SHARED_GEMINI_KEY_STORAGE_KEY) {
      syncSharedGeminiKeyAcrossTeams({ triggerBriefs: true });
    }
  });
  window.addEventListener('online', () => {
    syncSharedGeminiKeyAcrossTeams({ triggerBriefs: true });
    if (!state.appData) {
      bootOrRecoverAppData({ manual: true });
    } else {
      refreshLiveFeedsInBackground(false);
    }
  });

  // Live relative timestamp ticker (every 60s while tab is visible)
  setInterval(() => {
    if (document.visibilityState === 'hidden' || !state.appData) return;
    state.seasonState = evaluateSeasonState({
      now: new Date(),
      calendar: state.appData.meta?.calendar,
      teamStatus: state.appData.meta?.teamStatus
    });
    renderHeader();
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
    let pendingSwReload = false;
    let activeSwReg = null;
    let lastSwUpdateCheckMs = Date.now();
    const hadController = Boolean(navigator.serviceWorker.controller);
    const tryReloadForUpdatedSw = () => {
      if (!pendingSwReload || !hadController || refreshingSw) return false;
      if (
        isBootingAppData ||
        !state.appData ||
        state.jobStatus?.active ||
        state.sharedAudioPrep?.active ||
        state.audioState?.isPlaying ||
        hasActivelyPlayingInlineMedia()
      ) {
        return false;
      }
      refreshingSw = true;
      pendingSwReload = false;
      window.location.reload();
      return true;
    };
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (!hadController || refreshingSw) return;
      pendingSwReload = true;
      if (!tryReloadForUpdatedSw()) {
        // Retry cleanly once active boot/job/playback settles so updated views never stay trapped behind stale modules
        const retryTimer = window.setInterval(() => {
          if (!pendingSwReload || tryReloadForUpdatedSw()) {
            window.clearInterval(retryTimer);
          }
        }, 1500);
      }
    });
    const registerSw = () => {
      navigator.serviceWorker
        .register('./sw.js?v=124', { updateViaCache: 'none' })
        .then(reg => {
          activeSwReg = reg;
          return reg.update().catch(() => {});
        })
        .catch(() => {});
    };
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState !== 'visible') return;
      if (pendingSwReload && tryReloadForUpdatedSw()) return;
      const now = Date.now();
      if (activeSwReg && now - lastSwUpdateCheckMs >= 60_000) {
        lastSwUpdateCheckMs = now;
        activeSwReg.update().catch(() => {});
      }
    });
    if (document.readyState === 'complete') {
      registerSw();
    } else {
      window.addEventListener('load', registerSw, { once: true });
    }
  }
}

init();
