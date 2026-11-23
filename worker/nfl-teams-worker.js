/**
 * All-32-Team NFL Edge Worker & Static Assets Middleware (`*.joshal.com` -> `nfl-teams.pages.dev`)
 *
 * Design Guarantees:
 * 1. Explicit 32-Team Subdomain Routing ONLY (`49ers.joshal.com`, `bills.joshal.com`, `lions.joshal.com`, ...
 *    through `vikings.joshal.com`) — NEVER intercepts `www.joshal.com`, `workouts.joshal.com`, `nfl.joshal.com`,
 *    or arbitrary non-NFL `joshal.com` subdomains.
 * 2. Zero-FOUC Edge Rendering via `HTMLRewriter`: streams per-team `<title>`, WCAG CSS vars,
 *    `apple-touch-icon.png`, header crest SVG, and dynamic `/manifest.json` (`start_url: "/"`, concise
 *    `short_name` nickname for Safari/Chrome Home Screen shortcuts) per subdomain.
 * 3. Dedicated `GEMINI_NFL_API_KEY` (`joshalbox@gmail.com`) — zero tokens drawn from `joshal7@gmail.com` —
 *    with Priority #0 SF Daily Quota Reservation (`SF_RESERVED_DAILY_CALLS = 6`).
 * 4. 100% Card-Free Cloudflare Pages Free + KV Free (`<150 writes/day` vs. `1,000/day` cap, ZERO R2):
 *    short-TTL `/api/live-wire` (60s) and `/api/gameday-inactives` (120s) cache in unlimited `caches.default`.
 * 5. Strict BYOK Enforcement for Interactive AI: `/api/analyze` and `/api/podcast` reject unauthenticated
 *    public requests (`401`) unless private `GROUP_PASSCODE` matches — users run Auto Pods & Deep Analysis
 *    directly from their browser on their own free Gemini key.
 */

import {
  TEAM_BY_SLUG,
  TEAM_REGISTRY,
  buildTeamCssVarsStyleBlock,
  hasCrossTeam49ersLeak,
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
  if (m && TEAM_BY_SLUG[m[1]]) {
    return TEAM_BY_SLUG[m[1]];
  }
  const origin = String(request.headers.get('Origin') || '');
  const om = origin.match(/^https:\/\/([a-z0-9-]+)\.joshal\.com$/i);
  if (om) {
    const sub = om[1].toLowerCase();
    if (TEAM_BY_SLUG[sub]) return TEAM_BY_SLUG[sub];
  }
  return TEAM_REGISTRY.SF;
}

function buildCorsHeaders(request) {
  const origin = String(request.headers.get('Origin') || '');
  const allowed =
    /^https:\/\/[a-z0-9-]+\.joshal\.com$/i.test(origin) ||
    /^https:\/\/(?:[a-z0-9-]+\.)?nfl-teams\.pages\.dev$/i.test(origin) ||
    /^http:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?$/i.test(origin);
  return {
    'Access-Control-Allow-Origin': allowed ? origin : 'https://49ers.joshal.com',
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
    start_url: '/',
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

function rewriteHtmlForTeam(response, team) {
  const cssVars = buildTeamCssVarsStyleBlock(team);
  const bootScript = `<script>window.__ACTIVE_TEAM_SLUG__=${JSON.stringify(team.slug)};window.__PLATFORM_API_ENABLED__=true;</script><style id="teamThemeOverrides">${cssVars}</style>`;

  return new HTMLRewriter()
    .on('title', {
      element(el) {
        el.setInnerContent(`${team.brandName} — ${team.domain}`);
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
    .on('meta[name="apple-mobile-web-app-title"], meta[name="application-name"]', {
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
    if (existing === todayUtc) return;
    await env.SHARED_CACHE.put(key, todayUtc, { expirationTtl: 60 * 60 * 24 * 14 });
  } catch {}
}

async function checkAndReserveDailyQuota(env, team) {
  if (!env.SHARED_CACHE) return { allowed: true };
  const dayKey = `quota:nfl:${new Date().toISOString().slice(0, 10)}`;
  const raw = Number((await env.SHARED_CACHE.get(dayKey)) || 0);
  if (team.abbr !== 'SF' && raw >= DAILY_LEAGUE_SOFT_BUDGET - SF_RESERVED_DAILY_CALLS) {
    return { allowed: false, reason: 'sf_priority_quota_reserved', usedToday: raw };
  }
  await env.SHARED_CACHE.put(dayKey, String(raw + 1), { expirationTtl: 60 * 60 * 28 });
  return { allowed: true, usedToday: raw + 1 };
}

function buildTeamEditorialSystemPrompt(team) {
  const isSf = team?.abbr === 'SF';
  const clubGuardrail = isSf
    ? "SF GROUNDING: HC Kyle Shanahan, OC Klay Kubiak, DC Raheem Morris. Former 49ers coaches Robert Saleh, Nick Sorensen, Steve Wilks, DeMeco Ryans, Mike McDaniel, and Klint Kubiak are NO LONGER on San Francisco's staff. Never attribute retired/departed players (Bryce Huff, Javon Hargrave, Charvarius Ward, Talanoa Hufanga, Aaron Banks, Leonard Floyd, Maliek Collins, Jordan Mason, Elijah Mitchell, Jauan Jennings, Arik Armstead, Chase Young, Randy Gregory) to the active 49ers roster unless explicitly active in the live snapshot."
    : `CLUB GROUNDING: Treat the provided live ${team.fullName} snapshot and live Google Search Grounding as your sole source of truth for current coaches, active roster, injuries, records, and stats.`;

  return `You are an independent Lead Football Intelligence Analyst for "${team.brandName}" (${team.fullName}).
UNHURRIED HIGH-THINKING MANDATE — PRIORITIZE ACCURACY & ANALYTICAL QUALITY OVER GENERATION TIME:
1. Never rely on stale pre-trained model weights for rosters, coaches, injuries, records, trades, or stats. Use the provided AUTHORITATIVE LIVE DATA SNAPSHOT first, supplemented with targeted Google Search Grounding only for brand-new external facts.
2. ${clubGuardrail}
3. FAIR, BALANCED & NON-HOMER ASSESSMENT: Evaluate ${team.fullName} with sober, league-wide objectivity using third-person team references ("${team.city}", "the ${team.nickname}", "they") — never first-person fan pronouns ("we/us/our"). Benchmark strengths against bottom-half NFL vulnerabilities, give full analytical weight to opponent coordinators and top units, and calibrate confidence strictly to the Vegas spread.
4. STRICT EDITORIAL CHARTER: Zero clickbait, zero sensationalism, zero fluff. Ground every point in verified stats, All-22 scheme mechanics (personnel groupings, coverage shells, pass-rush fronts, EPA/play, CPOE, RYOE), and CBA salary cap math when relevant.`;
}

function isCacheableStructuredIntel(rawText = '', team = null, oppAbbr = '') {
  const s = String(rawText || '').trim();
  if (s.length < 80) return false;
  if (team && hasCrossTeam49ersLeak(s, team, oppAbbr)) return false;
  const start = s.indexOf('{');
  const end = s.lastIndexOf('}');
  if (start < 0 || end <= start) return false;
  try {
    const parsed = JSON.parse(s.slice(start, end + 1));
    return Boolean(parsed && typeof parsed === 'object' && !Array.isArray(parsed));
  } catch {
    return false;
  }
}

async function callGeminiSinglePass(
  env,
  { systemPrompt, userPrompt, thinkingLevel = 'XHIGH', jsonMode = false, useGoogleSearch = true }
) {
  const apiKey = String(env.GEMINI_NFL_API_KEY || env.GEMINI_API_KEY || '').trim();
  if (!apiKey) return { ok: false, status: 503, error: 'GEMINI_NFL_API_KEY not configured' };

  const cascade = [
    PRIMARY_GEMINI_REASONING_MODEL,
    'gemini-3.8-flash',
    'gemini-3.5-flash',
    'gemini-3-flash-preview',
    'gemini-2.5-flash'
  ];
  let lastError = 'All Gemini cascade tiers failed';

  for (const model of cascade) {
    const primaryThinking = buildGeminiThinkingConfig(model, { preferredThinkingLevel: thinkingLevel });
    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`;

    const attempts = [];
    if (useGoogleSearch && !jsonMode) {
      attempts.push({ withSearch: true, thinkingConfig: primaryThinking });
      attempts.push({ withSearch: false, thinkingConfig: primaryThinking });
    } else {
      attempts.push({ withSearch: false, thinkingConfig: primaryThinking });
    }
    if (primaryThinking?.thinkingLevel === 'XHIGH') {
      attempts.push({ withSearch: false, thinkingConfig: { thinkingLevel: 'HIGH' } });
    }

    for (let idx = 0; idx < attempts.length; idx++) {
      const { withSearch, thinkingConfig } = attempts[idx];
      const attemptTimeoutMs = withSearch
        ? 18000
        : thinkingConfig?.thinkingLevel === 'XHIGH'
          ? 58000
          : 28000;
      try {
        const res = await fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            systemInstruction: { parts: [{ text: systemPrompt }] },
            ...(withSearch ? { tools: [{ google_search: {} }] } : {}),
            generationConfig: {
              temperature: 0.18,
              ...(jsonMode && !withSearch ? { responseMimeType: 'application/json' } : {}),
              ...(thinkingConfig ? { thinkingConfig } : {})
            },
            contents: [{ role: 'user', parts: [{ text: String(userPrompt).slice(0, 24000) }] }]
          }),
          signal: AbortSignal.timeout(attemptTimeoutMs)
        });
        if (!res.ok) {
          const errSnippet = (await res.text().catch(() => '')).slice(0, 180);
          lastError = `${model} (${withSearch ? 'search' : 'direct'}, HTTP ${res.status}): ${errSnippet || res.statusText}`;
          if (withSearch && (res.status === 400 || res.status === 403 || res.status === 429 || res.status >= 500)) continue;
          if (!withSearch && res.status === 400 && thinkingConfig?.thinkingLevel === 'XHIGH') continue;
          break;
        }
        const json = await res.json();
        const parts = json?.candidates?.[0]?.content?.parts || [];
        const text = parts.filter(p => !p.thought && typeof p.text === 'string').map(p => p.text).join('').trim();
        if (!text) continue;
        return {
          ok: true,
          modelUsed: model,
          thinkingLevelUsed:
            thinkingConfig?.thinkingLevel || resolveGeminiThinkingLevelLabel(model, thinkingLevel),
          grounded: withSearch,
          rawText: text
        };
      } catch (err) {
        lastError = `${model} (${withSearch ? 'search' : 'direct'}): ${err?.message || String(err)}`;
        if (withSearch || thinkingConfig?.thinkingLevel === 'XHIGH') continue;
        break;
      }
    }
  }
  return { ok: false, status: 502, error: lastError };
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
        'Cache-Control': 'public, max-age=300'
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

    // 2. Static `/data/*` fallback (static Pages CDN normally serves directly via `_routes.json`)
    if ((request.method === 'GET' || request.method === 'HEAD') && url.pathname.startsWith('/data/')) {
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
          shortTitle: team.shortTitle,
          conference: team.conference,
          division: team.division,
          timezone: team.timezone,
          priorityTier: team.priorityTier,
          activeModel: PRIMARY_GEMINI_REASONING_MODEL,
          interactiveAiMode: 'BYOK_REQUIRED',
          fleet: 'all-32-nfl-teams'
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

    // 7. Team-Scoped Daily Top-News Brief (GET + POST with atomic KV lock + SF Priority #0 Quota Gate)
    if (url.pathname === '/api/daily-news-brief') {
      if (ctx && typeof ctx.waitUntil === 'function') {
        ctx.waitUntil(trackActiveTeamVisit(env, team));
      }
      if (request.method === 'GET') {
        const cycleKey = String(url.searchParams.get('cycleKey') || new Date().toISOString().slice(0, 10)).replace(
          /[^A-Za-z0-9@_-]/g,
          ''
        );
        const kvKey = `daily_news_brief_v7:${team.abbr}:${cycleKey}`;
        const existing = await env.SHARED_CACHE?.get(kvKey, 'json');
        if (existing && !hasCrossTeam49ersLeak(existing.rawText || JSON.stringify(existing.data || ''), team)) {
          return jsonResp({ cached: true, teamAbbr: team.abbr, ...existing }, 200, cors);
        }
        return jsonResp({ cached: false, teamAbbr: team.abbr, cycleKey, rawText: '' }, 200, cors);
      }

      if (request.method === 'POST') {
        const body = await request.json().catch(() => null);
        if (!body || (!body.prompt && !body.seedData && !body.seedRawText)) {
          return jsonResp({ error: 'Invalid daily news brief payload' }, 400, cors);
        }
        const cycleKey = String(body.cycleKey || new Date().toISOString().slice(0, 10)).replace(/[^A-Za-z0-9@_-]/g, '');
        const kvKey = `daily_news_brief_v7:${team.abbr}:${cycleKey}`;
        const existing = await env.SHARED_CACHE?.get(kvKey, 'json');
        if (
          existing &&
          !body.forceRefresh &&
          !hasCrossTeam49ersLeak(existing.rawText || JSON.stringify(existing.data || ''), team)
        ) {
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
          const editorialSystem = buildTeamEditorialSystemPrompt(team);
          const clientSystem = String(body.systemPrompt || '').slice(0, 8000);
          const effectiveSystem = clientSystem ? `${editorialSystem}\n\n${clientSystem}` : editorialSystem;
          const gen = await callGeminiSinglePass(env, {
            systemPrompt: effectiveSystem,
            userPrompt: String(body.prompt).slice(0, 24000),
            thinkingLevel: 'XHIGH',
            useGoogleSearch: true
          });
          if (!gen.ok) return jsonResp({ error: gen.error }, gen.status || 502, cors);
          const payloadOut = {
            teamAbbr: team.abbr,
            cycleKey,
            modelUsed: gen.modelUsed,
            thinkingLevel: gen.thinkingLevelUsed,
            grounded: Boolean(gen.grounded),
            generatedAt: new Date().toISOString(),
            rawText: gen.rawText
          };
          if (isCacheableStructuredIntel(gen.rawText, team)) {
            await env.SHARED_CACHE?.put(kvKey, JSON.stringify(payloadOut), { expirationTtl: 60 * 60 * 26 });
          }
          return jsonResp({ cached: false, ...payloadOut }, 200, cors);
        } finally {
          await env.SHARED_CACHE?.delete(lockKey).catch(() => {});
        }
      }
    }

    // 8. Team-Scoped Matchup Intel (1/day for SF VIP parity; Tue/Fri slots for non-SF clubs; XHIGH + Google Search)
    if (request.method === 'POST' && url.pathname === '/api/matchup-intel') {
      const body = await request.json().catch(() => null);
      if (!body?.prompt) return jsonResp({ error: 'Invalid matchup intel payload' }, 400, cors);
      const seasonYear = Number(body.seasonYear || 2026);
      const week = Number(body.week || 1);
      const oppAbbr = String(body.oppAbbr || 'OPP').replace(/[^A-Za-z0-9]/g, '').toUpperCase();
      const datePt = String(body.datePt || new Date().toISOString().slice(0, 10)).replace(/[^0-9-]/g, '');
      const dayOfWeek = new Date().getUTCDay();
      const slot = team.abbr === 'SF' ? datePt : dayOfWeek >= 5 || dayOfWeek === 0 ? 'fri-final' : 'tue-preview';
      const cacheTtlSec = team.abbr === 'SF' ? 60 * 60 * 26 : 60 * 60 * 84;
      const kvKey = `matchup_intel_v6:${team.abbr}:${seasonYear}:wk${week}:${oppAbbr}:${slot}`;
      const existing = await env.SHARED_CACHE?.get(kvKey, 'json');
      if (
        existing &&
        !body.forceRefresh &&
        !hasCrossTeam49ersLeak(existing.rawText || JSON.stringify(existing.data || ''), team, oppAbbr)
      ) {
        return jsonResp({ cached: true, teamAbbr: team.abbr, ...existing }, 200, cors);
      }

      const lockKey = `lock:matchup:${team.abbr}:${seasonYear}:wk${week}:${oppAbbr}:${slot}`;
      const existingLock = await env.SHARED_CACHE?.get(lockKey);
      if (existingLock) {
        return jsonResp({ cached: false, inFlight: true, teamAbbr: team.abbr, slot }, 202, cors);
      }
      await env.SHARED_CACHE?.put(lockKey, '1', { expirationTtl: 120 });

      try {
        const quota = await checkAndReserveDailyQuota(env, team);
        if (!quota.allowed) return jsonResp({ error: 'Daily league quota reserved', ...quota }, 429, cors);
        const editorialSystem = buildTeamEditorialSystemPrompt(team);
        const clientSystem = String(body.systemPrompt || '').slice(0, 8000);
        const effectiveSystem = clientSystem ? `${editorialSystem}\n\n${clientSystem}` : editorialSystem;
        const gen = await callGeminiSinglePass(env, {
          systemPrompt: effectiveSystem,
          userPrompt: String(body.prompt).slice(0, 24000),
          thinkingLevel: 'XHIGH',
          useGoogleSearch: true
        });
        if (!gen.ok) return jsonResp({ error: gen.error }, gen.status || 502, cors);
        const out = {
          teamAbbr: team.abbr,
          datePt,
          seasonYear,
          week,
          oppAbbr,
          slot,
          modelUsed: gen.modelUsed,
          thinkingLevel: gen.thinkingLevelUsed,
          grounded: Boolean(gen.grounded),
          generatedAt: new Date().toISOString(),
          rawText: gen.rawText
        };
        if (isCacheableStructuredIntel(gen.rawText, team, oppAbbr)) {
          await env.SHARED_CACHE?.put(kvKey, JSON.stringify(out), { expirationTtl: cacheTtlSec });
        }
        return jsonResp({ cached: false, ...out }, 200, cors);
      } finally {
        await env.SHARED_CACHE?.delete(lockKey).catch(() => {});
      }
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

    // 10. Static PWA Assets + Edge HTMLRewriter on `/` & `/index.html` (Zero FOUC + Zero Safari Redirect!)
    if (env.ASSETS) {
      const isHtmlShellPath = url.pathname === '/' || url.pathname === '/index.html';
      const assetReq =
        url.pathname === '/index.html'
          ? new Request(new URL(`/${url.search}`, url.origin), request)
          : request;
      const assetRes = await env.ASSETS.fetch(assetReq);
      if (
        assetRes.ok &&
        isHtmlShellPath &&
        (assetRes.headers.get('Content-Type') || '').includes('text/html')
      ) {
        if (ctx && typeof ctx.waitUntil === 'function') {
          ctx.waitUntil(trackActiveTeamVisit(env, team));
        }
        return rewriteHtmlForTeam(assetRes, team);
      }
      return assetRes;
    }

    return jsonResp({ error: 'Not Found' }, 404, cors);
  }
};
