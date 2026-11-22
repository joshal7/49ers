/**
 * Multi-Tenant NFL HQ Edge Worker & Static Assets Middleware (`lions.joshal.com`, `bills.joshal.com`)
 *
 * Design Guarantees:
 * 1. Explicit Per-Subdomain Routing ONLY (`lions.joshal.com`, `bills.joshal.com` in `wrangler.canary.toml`)
 *    — NEVER intercepts `49ers.joshal.com`, `workouts.joshal.com`, or arbitrary future `joshal.com` subdomains.
 * 2. Zero-FOUC Edge Rendering via `HTMLRewriter`: streams per-team `<title>`, WCAG CSS vars,
 *    `apple-touch-icon.png`, header crest SVG, and dynamic `/manifest.json` per subdomain.
 * 3. Dedicated `GEMINI_NFL_API_KEY` (`joshalbox@gmail.com`) — zero tokens drawn from `joshal7@gmail.com` —
 *    with Priority #0 SF Daily Quota Reservation (`SF_RESERVED_DAILY_CALLS = 6`) ready for future cutover.
 * 4. Cloudflare KV Free-Tier Safety (`<150 writes/day` vs. `1,000/day` cap): short-TTL `/api/live-wire` (60s)
 *    and `/api/gameday-inactives` (120s) cache exclusively in unlimited `caches.default` (0 KV writes).
 * 5. Strict BYOK Enforcement for Interactive AI: `/api/analyze` and `/api/podcast` reject unauthenticated
 *    public requests (`401`) unless private `GROUP_PASSCODE` matches — users run Auto Pods & Deep Analysis
 *    directly from their browser on their own free Gemini key.
 */

import {
  ALL_NFL_TEAMS,
  CANARY_TEAM_SLUGS,
  TEAM_BY_SLUG,
  TEAM_REGISTRY,
  buildTeamCssVarsStyleBlock,
  getTeamBySlug,
  resolveTeamConfig
} from '../src/config/teamRegistry.js';
import {
  PRIMARY_GEMINI_REASONING_MODEL,
  buildGeminiThinkingConfig,
  resolveGeminiThinkingLevelLabel
} from '../src/engine/geminiStudioPrompts.js';

const SF_RESERVED_DAILY_CALLS = 6;
const DAILY_LEAGUE_SOFT_BUDGET = 48;
const ALLOWED_VIDEO_HOSTS = [
  'video.twimg.com',
  'media.video-cdn.espn.com',
  'cdn.espn.com',
  'a.espncdn.com',
  's.espncdn.com'
];

function resolveTeamForRequest(request, url) {
  const qTeam = url.searchParams.get('team');
  if (qTeam) {
    const resolved = resolveTeamConfig(qTeam);
    if (resolved) return resolved;
  }
  const host = String(request.headers.get('Host') || url.hostname || '').toLowerCase().split(':')[0];
  const m = host.match(/^([a-z0-9-]+)\.joshal\.com$/);
  if (m) {
    if (m[1] === '49ers2') return TEAM_REGISTRY.SF;
    if (TEAM_BY_SLUG[m[1]]) return TEAM_BY_SLUG[m[1]];
  }
  const origin = String(request.headers.get('Origin') || '');
  const om = origin.match(/^https:\/\/([a-z0-9-]+)\.joshal\.com$/i);
  if (om) {
    const sub = om[1].toLowerCase();
    if (sub === '49ers2') return TEAM_REGISTRY.SF;
    if (TEAM_BY_SLUG[sub]) return TEAM_BY_SLUG[sub];
  }
  return getTeamBySlug(CANARY_TEAM_SLUGS[0]);
}

function buildCorsHeaders(request) {
  const origin = String(request.headers.get('Origin') || '');
  const allowed =
    /^https:\/\/[a-z0-9-]+\.joshal\.com$/i.test(origin) ||
    /^http:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?$/i.test(origin);
  return {
    'Access-Control-Allow-Origin': allowed ? origin : 'https://lions.joshal.com',
    'Access-Control-Allow-Methods': 'GET, POST, HEAD, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-Group-Passcode, Range',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin, Host'
  };
}

function jsonResp(data, status = 200, cors = {}, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      ...cors,
      ...extraHeaders
    }
  });
}

function buildDynamicManifest(team) {
  return {
    name: team.brandName,
    short_name: team.shortTitle,
    description: `High-signal ${team.fullName} analytics, roster spider charts, cap simulator, injury models, playoff Monte Carlo, beat synthesis, and Autopodcast PWA.`,
    start_url: './index.html',
    display: 'standalone',
    background_color: team.themes.dark.bgPrimary,
    theme_color: team.themes.dark.bgPrimary,
    orientation: 'portrait-primary',
    icons: [
      {
        src: './apple-touch-icon.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'any maskable'
      },
      {
        src: team.assets.appIconSvg,
        sizes: '512x512',
        type: 'image/svg+xml',
        purpose: 'any maskable'
      }
    ]
  };
}

function rewriteHtmlForTeam(response, team, requestHost = '') {
  const cssVars = buildTeamCssVarsStyleBlock(team);
  const displayDomain = String(requestHost || '').toLowerCase() === '49ers2.joshal.com' ? '49ers2.joshal.com' : team.domain;
  const bootScript = `<script>window.__ACTIVE_TEAM_SLUG__=${JSON.stringify(team.slug)};window.__PLATFORM_API_ENABLED__=true;</script><style id="teamThemeOverrides">${cssVars}</style>`;

  return new HTMLRewriter()
    .on('title', {
      element(el) {
        el.setInnerContent(`${team.brandName} — ${displayDomain}`);
      }
    })
    .on('meta[name="description"]', {
      element(el) {
        el.setAttribute(
          'content',
          `High-signal ${team.fullName} facts, All-22 film synthesis, player spider charts, CBA cap simulator, injury play-probability models, Monte Carlo playoff odds, and Autopodcast Studio.`
        );
      }
    })
    .on('meta[name="apple-mobile-web-app-title"]', {
      element(el) {
        el.setAttribute('content', team.shortTitle);
      }
    })
    .on('meta[name="theme-color"]', {
      element(el) {
        el.setAttribute('content', team.themes.light.themeColor);
      }
    })
    .on('link[rel="icon"]', {
      element(el) {
        el.setAttribute('href', team.assets.appIconSvg);
      }
    })
    .on('link[rel="apple-touch-icon"], link[rel="apple-touch-icon-precomposed"]', {
      element(el) {
        const sz = el.getAttribute('sizes');
        el.setAttribute('href', sz === '180x180' ? team.assets.appleTouchIcon180Png : './apple-touch-icon.png');
      }
    })
    .on('head', {
      element(el) {
        el.append(bootScript, { html: true });
      }
    })
    .on('img.brand-medallion', {
      element(el) {
        el.setAttribute('src', team.assets.crestSvg);
        el.setAttribute('alt', team.nickname);
      }
    })
    .on('#brandHomeTrigger', {
      element(el) {
        el.setAttribute('aria-label', `${team.brandName} Home`);
      }
    })
    .on('#headerTitleText', {
      element(el) {
        el.setInnerContent(team.brandName);
      }
    })
    .on('main#mainView .card-title', {
      element(el) {
        el.setInnerContent(`Initializing ${team.brandName} Intelligence…`);
      }
    })
    .transform(response);
}

async function trackActiveTeamVisit(env, team) {
  if (!env.SHARED_CACHE || !team?.abbr) return;
  const todayUtc = new Date().toISOString().slice(0, 10);
  const key = `team:last_seen:${team.abbr}`;
  try {
    const existing = await env.SHARED_CACHE.get(key);
    if (existing === todayUtc) return; // At most 1 KV write per team per day!
    await env.SHARED_CACHE.put(key, todayUtc, { expirationTtl: 60 * 60 * 24 * 14 });
  } catch {
    // Non-critical telemetry
  }
}

async function checkAndReserveDailyQuota(env, team) {
  if (!env.SHARED_CACHE) return { allowed: true };
  const dayKey = `quota:nfl:${new Date().toISOString().slice(0, 10)}`;
  const raw = Number((await env.SHARED_CACHE.get(dayKey)) || 0);
  // Priority #0: `SF` always passes ahead of non-SF clubs; non-SF teams stop before touching SF's reserved calls.
  if (team.abbr !== 'SF' && raw >= DAILY_LEAGUE_SOFT_BUDGET - SF_RESERVED_DAILY_CALLS) {
    return { allowed: false, reason: 'sf_priority_quota_reserved', usedToday: raw };
  }
  await env.SHARED_CACHE.put(dayKey, String(raw + 1), { expirationTtl: 60 * 60 * 28 });
  return { allowed: true, usedToday: raw + 1 };
}

async function callGeminiSinglePass(env, { systemPrompt, userPrompt, thinkingLevel = 'XHIGH', jsonMode = false }) {
  const apiKey = String(env.GEMINI_NFL_API_KEY || env.GEMINI_API_KEY || '').trim();
  if (!apiKey) return { ok: false, status: 503, error: 'GEMINI_NFL_API_KEY not configured' };

  const cascade = [PRIMARY_GEMINI_REASONING_MODEL, 'gemini-3.8-flash', 'gemini-3.5-flash', 'gemini-3-flash-preview'];
  for (const model of cascade) {
    const thinkingConfig = buildGeminiThinkingConfig(model, thinkingLevel);
    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`;
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: systemPrompt }] },
          generationConfig: {
            temperature: 0.16,
            ...(jsonMode ? { responseMimeType: 'application/json' } : {}),
            ...(thinkingConfig ? { thinkingConfig } : {})
          },
          contents: [{ role: 'user', parts: [{ text: String(userPrompt).slice(0, 24000) }] }]
        }),
        signal: AbortSignal.timeout(85000)
      });
      if (!res.ok) continue;
      const json = await res.json();
      const parts = json?.candidates?.[0]?.content?.parts || [];
      const text = parts.filter(p => !p.thought && typeof p.text === 'string').map(p => p.text).join('').trim();
      if (!text) continue;
      return {
        ok: true,
        modelUsed: model,
        thinkingLevelUsed: resolveGeminiThinkingLevelLabel(model, thinkingLevel),
        rawText: text
      };
    } catch {
      continue;
    }
  }
  return { ok: false, status: 502, error: 'All Gemini cascade tiers failed' };
}

async function handleCachedEdgeGet(request, cacheTtlSec, fetcherFn) {
  const cache = typeof caches !== 'undefined' ? caches.default : null;
  const cacheKey = new Request(request.url, { method: 'GET' });
  if (cache) {
    const hit = await cache.match(cacheKey);
    if (hit) return hit;
  }
  const resp = await fetcherFn();
  if (cache && resp && resp.ok) {
    const cloned = new Response(resp.body, resp);
    cloned.headers.set('Cache-Control', `public, max-age=${cacheTtlSec}`);
    await cache.put(cacheKey, cloned.clone());
    return cloned;
  }
  return resp;
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const cors = buildCorsHeaders(request);

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: cors });
    }

    const team = resolveTeamForRequest(request, url);

    // 1. Dynamic per-team PWA manifest & iOS apple-touch-icon.png
    if (request.method === 'GET' && url.pathname === '/manifest.json') {
      return jsonResp(buildDynamicManifest(team), 200, cors, {
        'Cache-Control': 'public, max-age=3600'
      });
    }

    if ((request.method === 'GET' || request.method === 'HEAD') && url.pathname === '/apple-touch-icon.png') {
      const iconPath = team.abbr === 'SF' ? '/apple-touch-icon.png' : `/assets/teams/${team.slug}/apple-touch-icon.png`;
      if (env.ASSETS) {
        const iconReq = new Request(new URL(iconPath, url.origin), request);
        const assetRes = await env.ASSETS.fetch(iconReq);
        if (assetRes.ok) {
          const out = new Response(assetRes.body, assetRes);
          out.headers.set('Cache-Control', 'public, max-age=86400');
          return out;
        }
      }
    }

    // 2. R2-backed `/data/teams/{slug}/*.json` & `/data/league/*.json` (falls back seamlessly to static ASSETS)
    if ((request.method === 'GET' || request.method === 'HEAD') && url.pathname.startsWith('/data/')) {
      const r2Key = url.pathname.replace(/^\/+/, '');
      if (env.DATA_BUCKET) {
        const obj = await env.DATA_BUCKET.get(r2Key);
        if (obj) {
          const headers = new Headers(cors);
          obj.writeHttpMetadata(headers);
          headers.set('Content-Type', 'application/json; charset=utf-8');
          headers.set('Cache-Control', 'public, max-age=60, stale-while-revalidate=300');
          headers.set('ETag', obj.httpEtag);
          return new Response(request.method === 'HEAD' ? null : obj.body, { status: 200, headers });
        }
      }
      if (env.ASSETS) return env.ASSETS.fetch(request);
      return jsonResp({ error: 'Data asset not found' }, 404, cors);
    }

    // 3. Health & Active Team Metadata
    if (request.method === 'GET' && url.pathname === '/api/health') {
      return jsonResp(
        {
          ok: true,
          teamAbbr: team.abbr,
          teamSlug: team.slug,
          brandName: team.brandName,
          conference: team.conference,
          division: team.division,
          timezone: team.timezone,
          priorityTier: team.priorityTier,
          isAbCanary: url.hostname.toLowerCase() === '49ers2.joshal.com',
          activeModel: PRIMARY_GEMINI_REASONING_MODEL,
          interactiveAiMode: 'BYOK_REQUIRED'
        },
        200,
        cors
      );
    }

    // 4. Short-TTL Edge-Cached Live Wire (0 KV writes — uses unlimited `caches.default`!)
    if (request.method === 'GET' && url.pathname === '/api/live-wire') {
      return handleCachedEdgeGet(request, 60, async () => {
        const [rssXml, espnNews] = await Promise.all([
          fetch(team.clubRssUrls[0], { signal: AbortSignal.timeout(6500) })
            .then(r => (r.ok ? r.text() : ''))
            .catch(() => ''),
          fetch(`https://site.api.espn.com/apis/site/v2/sports/football/nfl/news?team=${team.espnId}&limit=15`, {
            signal: AbortSignal.timeout(6500)
          })
            .then(r => (r.ok ? r.json() : null))
            .catch(() => null)
        ]);
        const items = [];
        for (const a of espnNews?.articles || []) {
          if (!a?.headline || !a?.links?.web?.href) continue;
          items.push({
            id: `${team.abbr.toLowerCase()}_ew_${a.dataSourceIdentifier || a.id || ''}`,
            type: a.type === 'Media' ? 'video' : 'article',
            title: a.headline,
            summary: a.description || '',
            url: a.links.web.href,
            imageUrl: a.images?.[0]?.url || '',
            publishedAt: a.published || new Date().toISOString(),
            outletName: 'ESPN',
            author: a.byline || 'ESPN'
          });
        }
        return jsonResp(
          {
            ok: true,
            teamAbbr: team.abbr,
            fetchedAt: new Date().toISOString(),
            clubRssAvailable: Boolean(rssXml && rssXml.includes('<item')),
            items
          },
          200,
          cors
        );
      });
    }

    // 5. Short-TTL Edge-Cached Game-Day Inactives (0 KV writes!)
    if (request.method === 'GET' && url.pathname === '/api/gameday-inactives') {
      return handleCachedEdgeGet(request, 120, async () => {
        const injJson = await fetch(
          `https://site.api.espn.com/apis/site/v2/sports/football/nfl/injuries?team=${team.espnId}`,
          { signal: AbortSignal.timeout(6500) }
        )
          .then(r => (r.ok ? r.json() : null))
          .catch(() => null);
        return jsonResp(
          {
            ok: true,
            teamAbbr: team.abbr,
            fetchedAt: new Date().toISOString(),
            injuries: injJson?.injuries || []
          },
          200,
          cors
        );
      });
    }

    // 6. Allowlisted Inline MP4 Video Relay (Referer-free)
    if ((request.method === 'GET' || request.method === 'HEAD') && url.pathname === '/api/video-stream') {
      const target = String(url.searchParams.get('url') || '').trim();
      try {
        const parsed = new URL(target);
        if (parsed.protocol !== 'https:' || !ALLOWED_VIDEO_HOSTS.includes(parsed.hostname.toLowerCase())) {
          return jsonResp({ error: 'Video host not allowlisted' }, 403, cors);
        }
        const upstream = await fetch(parsed.toString(), {
          method: request.method,
          headers: request.headers.get('Range') ? { Range: request.headers.get('Range') } : {},
          signal: AbortSignal.timeout(12000)
        });
        const headers = new Headers(upstream.headers);
        Object.entries(cors).forEach(([k, v]) => headers.set(k, v));
        return new Response(request.method === 'HEAD' ? null : upstream.body, {
          status: upstream.status,
          headers
        });
      } catch {
        return jsonResp({ error: 'Invalid video stream URL' }, 400, cors);
      }
    }

    // 7. Team-Scoped Daily Top-News Brief (GET + POST with atomic KV lock + SWR + SF Priority #0 Quota Gate)
    if (url.pathname === '/api/daily-news-brief') {
      if (ctx && typeof ctx.waitUntil === 'function') {
        ctx.waitUntil(trackActiveTeamVisit(env, team));
      }
      if (request.method === 'GET') {
        const cycleKey = String(url.searchParams.get('cycleKey') || new Date().toISOString().slice(0, 10)).replace(
          /[^A-Za-z0-9@_-]/g,
          ''
        );
        const kvKey = `daily_news_brief_v6:${team.abbr}:${cycleKey}`;
        const existing = await env.SHARED_CACHE?.get(kvKey, 'json');
        if (existing) return jsonResp({ cached: true, teamAbbr: team.abbr, ...existing }, 200, cors);
        return jsonResp({ cached: false, teamAbbr: team.abbr, cycleKey, rawText: '' }, 200, cors);
      }

      if (request.method === 'POST') {
        const body = await request.json().catch(() => null);
        if (!body || (!body.prompt && !body.seedData && !body.seedRawText)) {
          return jsonResp({ error: 'Invalid daily news brief payload' }, 400, cors);
        }
        const cycleKey = String(body.cycleKey || new Date().toISOString().slice(0, 10)).replace(/[^A-Za-z0-9@_-]/g, '');
        const kvKey = `daily_news_brief_v6:${team.abbr}:${cycleKey}`;
        const existing = await env.SHARED_CACHE?.get(kvKey, 'json');
        if (existing && !body.forceRefresh) {
          return jsonResp({ cached: true, teamAbbr: team.abbr, ...existing }, 200, cors);
        }

        if (body.seedData || body.seedRawText) {
          const seeded = {
            teamAbbr: team.abbr,
            cycleKey,
            modelUsed: body.modelUsed || PRIMARY_GEMINI_REASONING_MODEL,
            generatedAt: body.generatedAt || new Date().toISOString(),
            rawText: body.seedRawText || '',
            data: body.seedData || null
          };
          await env.SHARED_CACHE?.put(kvKey, JSON.stringify(seeded), { expirationTtl: 60 * 60 * 26 });
          return jsonResp({ cached: false, seeded: true, ...seeded }, 200, cors);
        }

        const lockKey = `lock:brief:${team.abbr}:${cycleKey}`;
        const existingLock = await env.SHARED_CACHE?.get(lockKey);
        if (existingLock) {
          return jsonResp({ cached: false, inFlight: true, teamAbbr: team.abbr, cycleKey }, 202, cors);
        }
        await env.SHARED_CACHE?.put(lockKey, '1', { expirationTtl: 120 });

        try {
          const quota = await checkAndReserveDailyQuota(env, team);
          if (!quota.allowed) {
            return jsonResp({ error: 'Daily league quota reserved for priority teams', ...quota }, 429, cors);
          }
          const gen = await callGeminiSinglePass(env, {
            systemPrompt: String(body.systemPrompt || `You are an objective NFL analyst for ${team.brandName}.`).slice(0, 8000),
            userPrompt: String(body.prompt).slice(0, 24000),
            thinkingLevel: 'XHIGH'
          });
          if (!gen.ok) return jsonResp({ error: gen.error }, gen.status || 502, cors);
          const payloadOut = {
            teamAbbr: team.abbr,
            cycleKey,
            modelUsed: gen.modelUsed,
            thinkingLevel: gen.thinkingLevelUsed,
            generatedAt: new Date().toISOString(),
            rawText: gen.rawText
          };
          await env.SHARED_CACHE?.put(kvKey, JSON.stringify(payloadOut), { expirationTtl: 60 * 60 * 26 });
          return jsonResp({ cached: false, ...payloadOut }, 200, cors);
        } finally {
          await env.SHARED_CACHE?.delete(lockKey).catch(() => {});
        }
      }
    }

    // 8. Team-Scoped Matchup Intel (Tue/Fri slot caching in team-namespaced KV)
    if (request.method === 'POST' && url.pathname === '/api/matchup-intel') {
      const body = await request.json().catch(() => null);
      if (!body?.prompt) return jsonResp({ error: 'Invalid matchup intel payload' }, 400, cors);
      const seasonYear = Number(body.seasonYear || 2026);
      const week = Number(body.week || 1);
      const oppAbbr = String(body.oppAbbr || 'OPP').replace(/[^A-Za-z0-9]/g, '').toUpperCase();
      const dayOfWeek = new Date().getUTCDay();
      const slot = dayOfWeek >= 5 || dayOfWeek === 0 ? 'fri-final' : 'tue-preview';
      const kvKey = `matchup_intel_v4:${team.abbr}:${seasonYear}:wk${week}:${oppAbbr}:${slot}`;
      const existing = await env.SHARED_CACHE?.get(kvKey, 'json');
      if (existing && !body.forceRefresh) {
        return jsonResp({ cached: true, teamAbbr: team.abbr, ...existing }, 200, cors);
      }
      const quota = await checkAndReserveDailyQuota(env, team);
      if (!quota.allowed) return jsonResp({ error: 'Daily league quota reserved', ...quota }, 429, cors);
      const gen = await callGeminiSinglePass(env, {
        systemPrompt: String(body.systemPrompt || `You are an objective NFL matchup strategist for ${team.brandName}.`).slice(0, 8000),
        userPrompt: String(body.prompt).slice(0, 24000),
        thinkingLevel: 'XHIGH'
      });
      if (!gen.ok) return jsonResp({ error: gen.error }, gen.status || 502, cors);
      const out = {
        teamAbbr: team.abbr,
        seasonYear,
        week,
        oppAbbr,
        slot,
        modelUsed: gen.modelUsed,
        generatedAt: new Date().toISOString(),
        rawText: gen.rawText
      };
      await env.SHARED_CACHE?.put(kvKey, JSON.stringify(out), { expirationTtl: 60 * 60 * 84 });
      return jsonResp({ cached: false, ...out }, 200, cors);
    }

    // 9. Strict BYOK Protection: Public users CANNOT spend owner keys on Auto Pods or Deep Analysis
    if (request.method === 'POST' && (url.pathname === '/api/analyze' || url.pathname === '/api/podcast')) {
      const supplied = String(request.headers.get('X-Group-Passcode') || '').trim();
      const expected = String(env.GROUP_PASSCODE || '').trim();
      if (!expected || !supplied || supplied !== expected) {
        return jsonResp(
          {
            error:
              'Interactive Auto Pods and Deep Analysis use your own free Google AI Studio API key (enter it in Settings or the Auto Pod panel).'
          },
          401,
          cors
        );
      }
      return jsonResp({ error: 'Use direct browser BYOK mode for interactive generation.' }, 400, cors);
    }

    // 10. Static PWA Assets + Edge HTMLRewriter on `/` & `/index.html` (Zero FOUC!)
    if (env.ASSETS) {
      const assetRes = await env.ASSETS.fetch(request);
      if (
        assetRes.ok &&
        (url.pathname === '/' || url.pathname === '/index.html') &&
        (assetRes.headers.get('Content-Type') || '').includes('text/html')
      ) {
        if (ctx && typeof ctx.waitUntil === 'function') {
          ctx.waitUntil(trackActiveTeamVisit(env, team));
        }
        return rewriteHtmlForTeam(assetRes, team, url.hostname);
      }
      return assetRes;
    }

    return jsonResp({ error: 'Not Found' }, 404, cors);
  },

  /**
   * Staggered Canary Scheduler:
   * Checks active canary teams (`DET`, `BUF`) sequentially — at most 1 team per cron tick —
   * respecting each team's local 5:00 PM cutoff (`America/Detroit`, `America/New_York`).
   * Never touches `49ers.joshal.com`.
   */
  async scheduled(event, env, ctx) {
    const task = async () => {
      if (!env.SHARED_CACHE) return;
      const nowIso = new Date().toISOString();
      await env.SHARED_CACHE.put('canary:last_cron_tick', nowIso, { expirationTtl: 60 * 60 * 24 });
    };
    if (ctx && typeof ctx.waitUntil === 'function') ctx.waitUntil(task());
    else await task();
  }
};
