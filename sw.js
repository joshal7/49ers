const SW_HOST = String(self.location?.hostname || '').toLowerCase();
const SW_SUB_MATCH = SW_HOST.match(/^([a-z0-9-]+)\.joshal\.com$/);
const SW_RAW_SUB = SW_SUB_MATCH ? SW_SUB_MATCH[1] : '49ers';
const SW_TEAM_SLUG = SW_RAW_SUB === '49ers' || SW_RAW_SUB === '49ers2' ? '49ers' : SW_RAW_SUB;
const SW_DATA_BASE = SW_TEAM_SLUG === '49ers' ? './data' : `./data/teams/${SW_TEAM_SLUG}`;
const CACHE_NAME = SW_TEAM_SLUG === '49ers' ? '49ers-faithful-v145' : `${SW_TEAM_SLUG}-hq-v16`;
const PRESERVED_CACHE_PREFIXES = ['49ers-podcast-studio-audio-', `${SW_TEAM_SLUG}-podcast-studio-audio-`];
const NETWORK_TIMEOUT_MS = 7500;
const FAST_CACHED_NETWORK_TIMEOUT_MS = 2200;
const CORE_ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './src/styles.css',
  './src/config/teamRegistry.js',
  './src/app.js',
  './src/engine/seasonStateMachine.js',
  './src/engine/draftBigBoardEngine.js',
  './src/engine/capSimulator.js',
  './src/engine/injuryProbabilityModel.js',
  './src/engine/gameDayRosterEngine.js',
  './src/engine/playoffMonteCarlo.js',
  './src/engine/antiFluffFilter.js',
  './src/engine/beatAttributionEngine.js',
  './src/engine/groundingValidator.js',
  './src/engine/breakingClassifier.js',
  './src/engine/universalSearchEngine.js',
  './src/engine/digestExperienceEngine.js',
  './src/engine/linkIntegrity.js',
  './src/engine/salientMediaEngine.js',
  './src/engine/jargonGlossary.js',
  './src/engine/statsLeaderboardEngine.js',
  './src/engine/powerRankingsEngine.js',
  './src/engine/podcastSpeechEngine.js',
  './src/engine/deepResearchEngine.js',
  './src/engine/geminiStudioPrompts.js',
  './src/components/spiderChart.js',
  './src/components/audioPlayer.js',
  './src/services/dataService.js',
  './src/services/sharedApiKeyStore.js',
  './src/services/remoteTeamDossierService.js',
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
  './apple-touch-icon.png'
];

const TEAM_DYNAMIC_ASSETS = [
  `${SW_DATA_BASE}/meta.json`,
  `${SW_DATA_BASE}/roster.json`,
  `${SW_DATA_BASE}/depth-chart.json`,
  `${SW_DATA_BASE}/cap.json`,
  `${SW_DATA_BASE}/reporters.json`,
  `${SW_DATA_BASE}/news.json`,
  `${SW_DATA_BASE}/schedule-matchup.json`,
  `${SW_DATA_BASE}/health.json`,
  `${SW_DATA_BASE}/seasonal.json`,
  `${SW_DATA_BASE}/beat-podcasts.json`,
  `${SW_DATA_BASE}/podcasts/index.json`,
  SW_TEAM_SLUG === '49ers' ? './assets/app-icon.svg' : `./assets/teams/${SW_TEAM_SLUG}/app-icon.svg`,
  SW_TEAM_SLUG === '49ers' ? './assets/sf-crest.svg' : `./assets/teams/${SW_TEAM_SLUG}/crest.svg`,
  SW_TEAM_SLUG === '49ers' ? './apple-touch-icon.png' : `./assets/teams/${SW_TEAM_SLUG}/apple-touch-icon.png`
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
          [...CORE_ASSETS, ...TEAM_DYNAMIC_ASSETS].map(url =>
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
      const oldKeys = keys.filter(
        k => k !== CACHE_NAME && !PRESERVED_CACHE_PREFIXES.some(prefix => k.startsWith(prefix))
      );
      if (oldKeys.length > 0) {
        try {
          const nextCache = await caches.open(CACHE_NAME);
          // Carry forward ONLY offline data/media assets that failed to pre-fetch on a flaky cellular SW install.
          // NEVER carry forward stale .js/.css/.html application code across cache versions!
          for (const assetUrl of CORE_ASSETS) {
            if (!/^\.\/(?:data|assets)\//.test(assetUrl) && assetUrl !== './apple-touch-icon.png') {
              continue;
            }
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

  // Network-first with fast 2.2s timeout when warm-cached (7.5s cold) & instant offline fallback
  // Pass event.request.url string so { cache: 'no-cache' } never throws TypeError on mode === 'navigate'
  event.respondWith(
    (async () => {
      const cached = await caches.match(event.request, { ignoreSearch: true });
      const timeoutMs = cached ? FAST_CACHED_NETWORK_TIMEOUT_MS : NETWORK_TIMEOUT_MS;
      try {
        const res = await fetchWithTimeoutSw(event.request.url, { cache: 'no-cache' }, timeoutMs);
        if (res && res.status === 200) {
          const clone = res.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
        }
        return res;
      } catch {
        return cached || Response.error();
      }
    })()
  );
});

// Quiet Opt-In Web Push Alerts (Tier-1 Breaking, 5 PM PT Brief, Practice Downgrades)
self.addEventListener('push', event => {
  let payload = {
    title: '49ers Faithful Briefing',
    body: 'High-signal 49ers update available.',
    tag: '49ers-quiet-alert',
    url: './'
  };
  try {
    if (event.data) {
      const parsed = event.data.json();
      if (parsed && typeof parsed === 'object') {
        payload = {
          title: String(parsed.title || payload.title).slice(0, 90),
          body: String(parsed.body || payload.body).slice(0, 220),
          tag: String(parsed.tag || payload.tag).slice(0, 64),
          url: typeof parsed.url === 'string' && parsed.url.startsWith('./') ? parsed.url : './'
        };
      }
    }
  } catch {
    try {
      const txt = event.data?.text?.();
      if (txt) payload.body = String(txt).slice(0, 220);
    } catch {}
  }

  event.waitUntil(
    self.registration.showNotification(payload.title, {
      body: payload.body,
      icon: './apple-touch-icon.png',
      badge: './apple-touch-icon.png',
      tag: payload.tag,
      renotify: false,
      data: { url: payload.url }
    })
  );
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const targetUrl = event.notification?.data?.url || './';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clientList => {
      for (const client of clientList) {
        if ('focus' in client) {
          return client.focus();
        }
      }
      if (self.clients.openWindow) {
        return self.clients.openWindow(targetUrl);
      }
      return undefined;
    })
  );
});
