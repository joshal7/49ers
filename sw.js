const CACHE_NAME = '49ers-faithful-v30';
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

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache =>
      Promise.all(
        CORE_ASSETS.map(url =>
          fetch(url, { cache: 'no-cache' })
            .then(res => (res.ok ? cache.put(url, res) : null))
            .catch(() => null)
        )
      )
    )
  );
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
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

  // Network-first with instant offline cache fallback for HTML, JS, CSS & live JSON feeds
  event.respondWith(
    fetch(event.request, { cache: 'no-cache' })
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
