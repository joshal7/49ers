const SW_HOST = String(self.location?.hostname || '').toLowerCase();
const IS_NFL_HUB_HOST =
  SW_HOST === 'nfl.joshal.com' ||
  SW_HOST === 'nfl-joshal.pages.dev' ||
  SW_HOST.endsWith('.nfl-joshal.pages.dev');
const SW_SUB_MATCH = SW_HOST.match(/^([a-z0-9-]+)\.joshal\.com$/);
const SW_RAW_SUB = SW_SUB_MATCH ? SW_SUB_MATCH[1] : '49ers';
const SW_TEAM_SLUG = IS_NFL_HUB_HOST ? 'nfl' : SW_RAW_SUB === '49ers' ? '49ers' : SW_RAW_SUB;
const SW_DATA_BASE = `./data/teams/${SW_TEAM_SLUG}`;
const CACHE_NAME = IS_NFL_HUB_HOST
  ? 'nfl-hub-v42'
  : SW_TEAM_SLUG === '49ers'
    ? '49ers-faithful-v199'
    : `${SW_TEAM_SLUG}-hq-v70`;
const PRESERVED_CACHE_PREFIXES =
  SW_TEAM_SLUG === '49ers'
    ? ['49ers-podcast-studio-audio-']
    : [`${SW_TEAM_SLUG}-podcast-studio-audio-`];
const NETWORK_TIMEOUT_MS = 7500;
const FAST_CACHED_NETWORK_TIMEOUT_MS = 2200;
const CORE_ASSETS = [
  './',
  './manifest.json',
  './src/styles.css',
  './src/config/teamRegistry.js',
  './src/config/nflStadiums.js',
  './src/app.js',
  './src/engine/seasonStateMachine.js',
  './src/engine/teamDeepDiveEngine.js',
  './src/engine/draftBigBoardEngine.js',
  './src/engine/capSimulator.js',
  './src/engine/injuryProbabilityModel.js',
  './src/engine/gameDayRosterEngine.js',
  './src/engine/gamecastEngine.js',
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
  './src/views/gamecastView.js',
  './src/views/seasonMatchupView.js',
  './src/views/audioAiView.js',
  './src/views/settingsArchiveView.js',
  './assets/gemini-key-walkthrough.gif'
];

const TEAM_DYNAMIC_ASSETS = IS_NFL_HUB_HOST
  ? ['./nfl-crest.svg', './nfl-icon.svg', './nfl-apple-touch-icon.png']
  : [
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
      `./assets/teams/${SW_TEAM_SLUG}/app-icon.svg`,
      `./assets/teams/${SW_TEAM_SLUG}/crest.svg`,
      `./assets/teams/${SW_TEAM_SLUG}/apple-touch-icon.png`
    ];

function resolveRootHtmlCacheKey(url) {
  if (!url || (url.pathname !== '/' && url.pathname !== '/index.html')) return null;
  const rawTeam = String(url.searchParams.get('team') || '').trim().toLowerCase();
  if (rawTeam && /^[a-z0-9-]+$/.test(rawTeam)) {
    return `${url.origin}/?team=${encodeURIComponent(rawTeam)}`;
  }
  return `${url.origin}/`;
}

function fetchWithTimeoutSw(url, init = {}, timeoutMs = NETWORK_TIMEOUT_MS) {
  if (typeof AbortController !== 'function') {
    return fetch(url, init);
  }
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  return fetch(url, { ...init, signal: ctrl.signal }).finally(() => clearTimeout(timer));
}

async function cleanRedirectedResponse(res) {
  if (!res || !res.redirected) return res;
  const body = await res.clone().arrayBuffer();
  const headers = new Headers(res.headers);
  headers.delete('content-encoding');
  headers.delete('content-length');
  headers.delete('transfer-encoding');
  return new Response(body, {
    status: res.status,
    statusText: res.statusText,
    headers
  });
}

function getPathnameDir(pathname = '/') {
  const clean = String(pathname || '/');
  const idx = clean.lastIndexOf('/');
  return idx >= 0 ? clean.slice(0, idx + 1) : '/';
}

function normalizeDataCacheKey(url) {
  if (!url) return null;
  if (url.pathname.startsWith('/data/') && url.pathname.endsWith('.json')) {
    return `${url.origin}${url.pathname}`;
  }
  return null;
}

function isCacheFirstStaticAsset(url) {
  if (!url) return false;
  const p = url.pathname;
  return (
    (p.startsWith('/src/') && (p.endsWith('.js') || p.endsWith('.css'))) ||
    p.startsWith('/assets/') ||
    p.startsWith('/icons/') ||
    p.endsWith('.svg') ||
    p.endsWith('.png') ||
    p.endsWith('.gif') ||
    p.endsWith('.webp')
  );
}

async function precacheInBatches(cache, urls, batchSize = 8) {
  for (let i = 0; i < urls.length; i += batchSize) {
    const slice = urls.slice(i, i + batchSize);
    await Promise.all(
      slice.map(url =>
        fetchWithTimeoutSw(url, { cache: 'no-cache' }, 9000)
          .then(async res => {
            if (!res || !res.ok) return null;
            const cleanRes = await cleanRedirectedResponse(res);
            return cache.put(url, cleanRes);
          })
          .catch(() => null)
      )
    );
  }
}

self.addEventListener('install', event => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then(cache => {
        const installUrls = IS_NFL_HUB_HOST
          ? ['./', './manifest.json', ...TEAM_DYNAMIC_ASSETS]
          : [...CORE_ASSETS, ...TEAM_DYNAMIC_ASSETS];
        return precacheInBatches(cache, installUrls, 8);
      })
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      const oldKeys = keys.filter(
        k =>
          k !== CACHE_NAME &&
          !PRESERVED_CACHE_PREFIXES.some(prefix => k.startsWith(prefix)) &&
          !k.includes('-podcast-studio-audio-')
      );
      if (oldKeys.length > 0) {
        try {
          const nextCache = await caches.open(CACHE_NAME);
          // Carry forward ONLY offline data/media assets that failed to pre-fetch on a flaky cellular SW install.
          // NEVER carry forward stale .js/.css/.html application code across cache versions!
          for (const assetUrl of [...CORE_ASSETS, ...TEAM_DYNAMIC_ASSETS]) {
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

function safeWaitUntil(event, promise) {
  const safePromise = Promise.resolve(promise).catch(() => {});
  if (typeof event?.waitUntil === 'function') {
    event.waitUntil(safePromise);
  }
}

async function serveOfflineAudioRange(request, rangeHeader) {
  try {
    const cache = await caches.open(CACHE_NAME);
    const cached = await cache.match(request.url, { ignoreSearch: true });
    if (!cached) return Response.error();
    const buf = await cached.arrayBuffer();
    const total = buf.byteLength;
    const m = /^bytes=(\d*)-(\d*)$/i.exec(String(rangeHeader || '').trim());
    if (!m || total === 0) return cached;
    const start = m[1] ? Math.min(total - 1, Math.max(0, Number(m[1]))) : 0;
    const end = m[2] ? Math.min(total - 1, Math.max(start, Number(m[2]))) : total - 1;
    const slice = buf.slice(start, end + 1);
    return new Response(slice, {
      status: 206,
      statusText: 'Partial Content',
      headers: {
        'Content-Type': cached.headers.get('Content-Type') || 'audio/mp4',
        'Content-Range': `bytes ${start}-${end}/${total}`,
        'Accept-Ranges': 'bytes',
        'Content-Length': String(slice.byteLength)
      }
    });
  } catch {
    return Response.error();
  }
}

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  if (!event.request.url.startsWith(self.location.origin)) return;

  const url = new URL(event.request.url);
  if (
    url.pathname.startsWith('/v1beta/') ||
    url.pathname.startsWith('/api/') ||
    url.pathname === '/key-sync' ||
    url.pathname === '/key-sync.html'
  ) {
    return;
  }
  const isAudioAsset = url.pathname.endsWith('.m4a') || url.pathname.endsWith('.mp3');

  // Let browser handle HTTP byte-range audio requests natively when online; slice 206 from cache offline (iOS Safari PWA)
  const rangeHeader = event.request.headers.get('range');
  if (rangeHeader) {
    if (!isAudioAsset) return;
    event.respondWith(
      fetch(event.request).catch(() => serveOfflineAudioRange(event.request, rangeHeader))
    );
    return;
  }

  if (isAudioAsset) {
    event.respondWith(
      caches.open(CACHE_NAME).then(async cache => {
        const cached = await cache.match(event.request);
        if (cached) return cached;
        try {
          const res = await fetchWithTimeoutSw(event.request.url, {}, 12000);
          if (res && res.status === 200) {
            const clone = res.clone();
            safeWaitUntil(event, cache.put(event.request, clone));
          }
          return res;
        } catch {
          return Response.error();
        }
      })
    );
    return;
  }

  // Cache-First for version-scoped static JS/CSS/images (`CACHE_NAME` rotates cleanly on every deploy!)
  // Eliminates 4-level ES module cellular startup waterfalls & prevents duplicate `?v=` cache entries.
  if (isCacheFirstStaticAsset(url)) {
    const canonicalStaticKey = `${url.origin}${url.pathname}`;
    event.respondWith(
      caches.open(CACHE_NAME).then(async cache => {
        const cached = await cache.match(canonicalStaticKey, { ignoreSearch: true });
        if (cached) {
          return cached.redirected ? cleanRedirectedResponse(cached) : cached;
        }
        try {
          const rawRes = await fetchWithTimeoutSw(event.request.url, { cache: 'no-cache' }, NETWORK_TIMEOUT_MS);
          const outRes = rawRes && rawRes.redirected && rawRes.ok ? await cleanRedirectedResponse(rawRes) : rawRes;
          if (outRes && outRes.status === 200 && !outRes.redirected) {
            const clone = outRes.clone();
            safeWaitUntil(event, cache.put(canonicalStaticKey, clone));
          }
          return outRes;
        } catch {
          return Response.error();
        }
      })
    );
    return;
  }

  // Network-first with fast 2.2s timeout when warm-cached (7.5s cold) & instant offline fallback
  // for HTML navigations and `/data/*.json` feeds (normalizing `?t=` cache-busters so meta.json never leaks entries!)
  const isNavigation = event.request.mode === 'navigate' || event.request.redirect === 'manual';
  const isRootHtmlPath = url.pathname === '/' || url.pathname === '/index.html';
  const rootHtmlCacheKey = isNavigation && isRootHtmlPath ? resolveRootHtmlCacheKey(url) : null;
  const dataCacheKey = normalizeDataCacheKey(url);
  const isolateRootByTeam = Boolean(rootHtmlCacheKey && (IS_NFL_HUB_HOST || url.searchParams.has('team')));
  event.respondWith(
    (async () => {
      const activeCache = await caches.open(CACHE_NAME).catch(() => null);
      let cached = null;
      if (activeCache) {
        if (isolateRootByTeam) {
          cached = await activeCache.match(rootHtmlCacheKey);
        } else if (dataCacheKey) {
          cached = await activeCache.match(dataCacheKey, { ignoreSearch: true });
        } else {
          cached = await activeCache.match(event.request, { ignoreSearch: true });
          if (!cached && isNavigation && isRootHtmlPath) {
            cached = await activeCache.match('./', { ignoreSearch: true });
          }
        }
      }
      const timeoutMs = cached ? FAST_CACHED_NETWORK_TIMEOUT_MS : NETWORK_TIMEOUT_MS;
      try {
        const fetchUrl =
          isNavigation && url.pathname === '/index.html'
            ? `${url.origin}/${url.search}`
            : event.request.url;
        const rawRes = await fetchWithTimeoutSw(fetchUrl, { cache: 'no-cache' }, timeoutMs);
        let outRes = rawRes;
        if (rawRes && rawRes.redirected) {
          if (isNavigation && rawRes.url) {
            let sameDir = false;
            try {
              const finalUrl = new URL(rawRes.url);
              sameDir =
                finalUrl.origin === url.origin &&
                getPathnameDir(finalUrl.pathname) === getPathnameDir(url.pathname);
            } catch {}
            if (sameDir && rawRes.ok) {
              outRes = await cleanRedirectedResponse(rawRes);
            } else {
              return Response.redirect(rawRes.url, 302);
            }
          } else if (rawRes.ok) {
            outRes = await cleanRedirectedResponse(rawRes);
          }
        }
        if (outRes && outRes.status === 200 && !outRes.redirected) {
          const cacheKey =
            rootHtmlCacheKey ||
            dataCacheKey ||
            (isNavigation && url.pathname === '/index.html' ? './' : event.request);
          const clone = outRes.clone();
          safeWaitUntil(
            event,
            caches.open(CACHE_NAME).then(cache => cache.put(cacheKey, clone))
          );
        }
        return outRes;
      } catch {
        if (cached) {
          // Stale-while-revalidate self-heal: when the 2.2s cellular fast-timeout falls back to a cached
          // `/data/*.json` feed, continue refreshing the SW cache in the background so the next load is fresh.
          if (dataCacheKey) {
            safeWaitUntil(
              event,
              fetchWithTimeoutSw(event.request.url, { cache: 'no-cache' }, 12000).then(async bgRes => {
                if (!bgRes || bgRes.status !== 200) return;
                const cleanBg = bgRes.redirected ? await cleanRedirectedResponse(bgRes) : bgRes;
                const c = await caches.open(CACHE_NAME);
                await c.put(dataCacheKey, cleanBg.clone());
              })
            );
          }
          return cached.redirected ? cleanRedirectedResponse(cached) : cached;
        }
        return Response.error();
      }
    })()
  );
});

// Quiet Opt-In Web Push Alerts (Tier-1 Breaking, Daily Brief, Practice Downgrades)
function formatSwTeamDisplay(slug = '49ers') {
  if (slug === '49ers') return '49ers Faithful';
  if (slug === 'nfl') return 'NFL Hub';
  return `${slug.charAt(0).toUpperCase()}${slug.slice(1)} HQ`;
}
const SW_PUSH_ICON =
  SW_TEAM_SLUG === 'nfl'
    ? './nfl-apple-touch-icon.png'
    : `./assets/teams/${SW_TEAM_SLUG}/apple-touch-icon.png`;

self.addEventListener('push', event => {
  const teamLabel = formatSwTeamDisplay(SW_TEAM_SLUG);
  const teamNoun = SW_TEAM_SLUG === '49ers' ? '49ers' : SW_TEAM_SLUG === 'nfl' ? 'NFL' : `${SW_TEAM_SLUG.charAt(0).toUpperCase()}${SW_TEAM_SLUG.slice(1)}`;
  let payload = {
    title: `${teamLabel} Briefing`,
    body: `High-signal ${teamNoun} update available.`,
    tag: `${SW_TEAM_SLUG}-quiet-alert`,
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
      icon: SW_PUSH_ICON,
      badge: SW_PUSH_ICON,
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
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(async clientList => {
      for (const client of clientList) {
        if ('focus' in client) {
          if (targetUrl && targetUrl !== './' && typeof client.navigate === 'function') {
            try {
              await client.navigate(targetUrl);
            } catch {}
          }
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
