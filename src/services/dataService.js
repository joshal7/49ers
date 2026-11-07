/**
 * Data Loader & Resilient LocalStorage User Preferences Manager
 */

const STORAGE_KEY = 'joshal_49ers_hq_prefs_v1';

export const DEFAULT_USER_PREFS = {
  theme: 'dark', // 'dark' = Levi's Night Game | 'light' = '94 Throwback White & Gold
  dashboardOrder: [],
  disabledReporterIds: [],
  disabledOutlets: [],
  muteHotTakePersonalities: false,
  strictAnalyticsFilmOnly: false,
  groupPasscode: '',
  authorName: 'Josh',
  workerBaseUrl: '',
  capMoves: {}, // playerId -> action
  playoffForcedWinners: {}, // gameId -> 'HOME' | 'AWAY'
  localCustomAnalyses: [],
  localCustomEpisodes: []
};

export function loadUserPrefs() {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return structuredCloneFallback(DEFAULT_USER_PREFS);
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return structuredCloneFallback(DEFAULT_USER_PREFS);
    }
    return {
      ...structuredCloneFallback(DEFAULT_USER_PREFS),
      ...parsed,
      dashboardOrder: Array.isArray(parsed.dashboardOrder) ? parsed.dashboardOrder : [],
      disabledReporterIds: Array.isArray(parsed.disabledReporterIds) ? parsed.disabledReporterIds : [],
      disabledOutlets: Array.isArray(parsed.disabledOutlets) ? parsed.disabledOutlets : [],
      capMoves: parsed.capMoves && typeof parsed.capMoves === 'object' ? parsed.capMoves : {},
      playoffForcedWinners:
        parsed.playoffForcedWinners && typeof parsed.playoffForcedWinners === 'object'
          ? parsed.playoffForcedWinners
          : {},
      localCustomAnalyses: Array.isArray(parsed.localCustomAnalyses) ? parsed.localCustomAnalyses : [],
      localCustomEpisodes: Array.isArray(parsed.localCustomEpisodes) ? parsed.localCustomEpisodes : []
    };
  } catch {
    return structuredCloneFallback(DEFAULT_USER_PREFS);
  }
}

export function saveUserPrefs(prefs) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
    return true;
  } catch {
    return false;
  }
}

function structuredCloneFallback(obj) {
  return JSON.parse(JSON.stringify(obj));
}

async function fetchJsonSafe(pathUrl) {
  const res = await fetch(pathUrl, { cache: 'no-cache' });
  if (!res.ok) {
    throw new Error(`Failed to load ${pathUrl} (HTTP ${res.status})`);
  }
  return res.json();
}

export async function loadAll49ersData() {
  const [
    meta,
    roster,
    depthChart,
    cap,
    reporters,
    news,
    scheduleMatchup,
    health,
    seasonal,
    podcastIndex
  ] = await Promise.all([
    fetchJsonSafe('./data/meta.json'),
    fetchJsonSafe('./data/roster.json'),
    fetchJsonSafe('./data/depth-chart.json'),
    fetchJsonSafe('./data/cap.json'),
    fetchJsonSafe('./data/reporters.json'),
    fetchJsonSafe('./data/news.json'),
    fetchJsonSafe('./data/schedule-matchup.json'),
    fetchJsonSafe('./data/health.json'),
    fetchJsonSafe('./data/seasonal.json'),
    fetchJsonSafe('./data/podcasts/index.json')
  ]);

  return {
    meta,
    roster,
    depthChart,
    cap,
    reporters,
    news,
    scheduleMatchup,
    health,
    seasonal,
    podcastIndex
  };
}
