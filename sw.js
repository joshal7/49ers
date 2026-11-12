const CACHE_NAME = '49ers-faithful-v56';
const NETWORK_TIMEOUT_MS = 7500;
const CORE_ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './src/styles.css',
  './src/app.js',
  './src/engine/seasonStateMachine.js',
  './src/engine/capSimulator.js',
  './src/engine/injuryProbabilityModel.js',
  './src/engine/gameDayRosterEngine.js',
  './src/engine/playoffMonteCarlo.js',
  './src/engine/antiFluffFilter.js',
  './src/engine/beatAttributionEngine.js',
  './src/engine/groundingValidator.js',
  './src/engine/breakingClassifier.js',
  './src/engine/linkIntegrity.js',
  './src/engine/jargonGlossary.js',
  './src/engine/statsLeaderboardEngine.js',
  './src/engine/podcastSpeechEngine.js',
  './src/engine/deepResearchEngine.js',
  './src/engine/geminiStudioPrompts.js',
  './src/components/spiderChart.js',
  './src/components/audioPlayer.js',
  './src/services/dataService.js',
  './src/services/aiWorkerClient.js',
  './src/services/podcastAudioStore.js',
  './src/services/shareService.js',
  './src/workers/neuralTtsWorker.js',
  './src/views/icons.js',
  './src/views/uiHelpers.js',
  './src/views/homeView.js',
  './src/views/newsView.js',
  './src/views/rosterCapView.js',
  './src/views/playerSheetView.js',
  './src/views/seasonMatchupView.js',
  './src/views/audioAiView.js',
  './src/views/settingsArchiveView.js',
  './data/meta.json',
  './data/roster.json',
  './data/depth-chart.json',
  './data/cap.json',
  './data/reporters.json',
  './data/news.json',
  './data/schedule-matchup.json',
  './data/health.json',
  './data/seasonal.json',
  './data/beat-podcasts.json',
  './data/podcasts/index.json',
  './assets/app-icon.svg',
  './assets/apple-touch-icon.png',
  './apple-touch-icon.png'
];

function fetchWithTimeoutSw(url, init = {}, timeoutMs = NETWORK_TIMEOUT_MS) {
  if (typeof AbortController !== 'function') {
    return fetch(url, init);
  }
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  return fetch(url, { ...init, signal: ctrl.signal }).finally(() => clearTimeout(timer));
}

self.addEventListener('install', event => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then(cache =>
        Promise.all(
          CORE_ASSETS.map(url =>
            fetchWithTimeoutSw(url, { cache: 'no-cache' }, 9000)
              .then(res => (res && res.ok ? cache.put(url, res) : null))
              .catch(() => null)
          )
        )
      )
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      const oldKeys = keys.filter(k => k !== CACHE_NAME);
      if (oldKeys.length > 0) {
        try {
          const nextCache = await caches.open(CACHE_NAME);
          // Carry forward any core/data asset that failed to pre-fetch on a flaky cellular SW install
          for (const assetUrl of CORE_ASSETS) {
            const alreadyPresent = await nextCache.match(assetUrl, { ignoreSearch: true });
            if (alreadyPresent) continue;
            for (const oldKey of oldKeys) {
              const prevCache = await caches.open(oldKey);
              const prevMatch = await prevCache.match(assetUrl, { ignoreSearch: true });
              if (prevMatch) {
                await nextCache.put(assetUrl, prevMatch.clone());
                break;
              }
            }
          }
        } catch {}
        await Promise.all(oldKeys.map(k => caches.delete(k)));
      }
      await self.clients.claim();
    })()
  );
});

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  if (!event.request.url.startsWith(self.location.origin)) return;

  // Let browser handle HTTP byte-range audio requests natively when online; fallback to cache offline
  if (event.request.headers.get('range')) {
    return;
  }

  const url = new URL(event.request.url);
  if (url.pathname.startsWith('/v1beta/') || url.pathname.startsWith('/api/')) {
    return;
  }
  const isAudioAsset = url.pathname.endsWith('.m4a') || url.pathname.endsWith('.mp3');

  if (isAudioAsset) {
    event.respondWith(
      caches.open(CACHE_NAME).then(async cache => {
        const cached = await cache.match(event.request);
        if (cached) return cached;
        try {
          const res = await fetch(event.request);
          if (res && res.status === 200) {
            cache.put(event.request, res.clone());
          }
          return res;
        } catch {
          return Response.error();
        }
      })
    );
    return;
  }

  // Network-first with fast timeout & instant offline cache fallback for HTML, JS, CSS & live JSON feeds
  // Pass event.request.url string so { cache: 'no-cache' } never throws TypeError on mode === 'navigate'
  event.respondWith(
    fetchWithTimeoutSw(event.request.url, { cache: 'no-cache' }, NETWORK_TIMEOUT_MS)
      .then(res => {
        if (res && res.status === 200) {
          const clone = res.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
        }
        return res;
      })
      .catch(async () => {
        const cached = await caches.match(event.request, { ignoreSearch: true });
        return cached || Response.error();
      })
  );
});
