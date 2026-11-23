/**
 * Unified All-32-Team + NFL Hub Edge Worker & Static Assets Middleware
 * (`*.joshal.com` -> `nfl-teams.pages.dev`, `nfl.joshal.com` -> `nfl-joshal.pages.dev`)
 *
 * Design Guarantees:
 * 1. Explicit 32-Team Subdomain Routing (`49ers.joshal.com` .. `vikings.joshal.com`) AND NFL Team Hub
 *    routing (`nfl.joshal.com/` -> 32-team portal, `nfl.joshal.com/?team=<slug>` -> full team app in
 *    same-origin standalone PWA mode, `nfl.joshal.com/key-sync` -> hermetic API key vault).
 *    NEVER intercepts `www.joshal.com`, `workouts.joshal.com`, or arbitrary non-NFL `joshal.com` subdomains.
 * 2. Zero-FOUC Edge Rendering via `HTMLRewriter`: streams per-team `<title>`, WCAG CSS vars,
 *    `apple-touch-icon.png`, header crest SVG, and dynamic `/manifest.json` (`start_url: "/"`, concise
 *    `short_name` nickname for Safari/Chrome Home Screen shortcuts) per subdomain — and identical team
 *    rendering (plus unobtrusive `#nflHubBackBtn`) on `nfl.joshal.com/?team=<slug>`.
 * 3. Dedicated `GEMINI_NFL_API_KEY` (`joshalbox@gmail.com`) — zero tokens drawn from `joshal7@gmail.com` —
 *    with Priority #0 SF Daily Quota Reservation (`SF_RESERVED_DAILY_CALLS = 6`) and transparent KV-miss
 *    upstream relay from `nfl-joshal` to `nfl-teams.pages.dev` when secrets aren't duplicated.
 * 4. 100% Card-Free Cloudflare Pages Free + KV Free (`<150 writes/day` vs. `1,000/day` cap, ZERO R2):
 *    short-TTL `/api/live-wire` (60s) and `/api/gameday-inactives` (120s) cache in unlimited `caches.default`.
 * 5. Strict BYOK Enforcement for Interactive AI: `/api/analyze` and `/api/podcast` reject unauthenticated
 *    public requests (`401`) unless private `GROUP_PASSCODE` matches — users run Auto Pods & Deep Analysis
 *    directly from their browser on their own free Gemini key.
 */

import {
  ALL_NFL_TEAMS,
  TEAM_BY_SLUG,
  TEAM_REGISTRY,
  buildTeamCssVarsStyleBlock,
  getTeamByAbbr,
  hasCrossTeam49ersLeak,
  isNflHubHost,
  normalizeAnyTeamAbbr,
  resolveExplicitQueryTeam,
  resolveTeamConfig
} from '../src/config/teamRegistry.js';
import {
  PRIMARY_GEMINI_REASONING_MODEL,
  buildGeminiThinkingConfig,
  resolveGeminiThinkingLevelLabel
} from '../src/engine/geminiStudioPrompts.js';
import { getAllowedNflTeamOrigins } from '../src/services/sharedApiKeyStore.js';

const SF_RESERVED_DAILY_CALLS = 6;
const DAILY_LEAGUE_SOFT_BUDGET = 48;
const UPSTREAM_AI_PAGES_ORIGIN = 'https://nfl-teams.pages.dev';
const ALLOWED_VIDEO_HOSTS = [
  'video.twimg.com',
  'media.video-cdn.espn.com',
  'cdn.espn.com',
  'a.espncdn.com',
  's.espncdn.com'
];

function getRequestHost(request, url) {
  return String(request.headers.get('Host') || url.hostname || '').toLowerCase().split(':')[0];
}

function resolveTeamForRequest(request, url) {
  const qHit = resolveExplicitQueryTeam(url.search);
  if (qHit) return qHit;
  const host = getRequestHost(request, url);
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
    /^https:\/\/(?:[a-z0-9-]+\.)?nfl-(?:teams|joshal)\.pages\.dev$/i.test(origin) ||
    /^http:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?$/i.test(origin);
  return {
    'Access-Control-Allow-Origin': allowed ? origin : 'https://49ers.joshal.com',
    'Access-Control-Allow-Methods': 'GET, POST, HEAD, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-Group-Passcode, Range',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin, Host'
  };
}

function buildKeySyncCspHeader() {
  const fromRegistry = ALL_NFL_TEAMS.map(t => `https://${t.slug}.joshal.com`);
  const allowed = Array.from(new Set([...getAllowedNflTeamOrigins(), ...fromRegistry, 'https://nfl.joshal.com'])).sort();
  return `default-src 'none'; script-src 'unsafe-inline'; frame-ancestors 'self' ${allowed.join(' ')}`;
}

function buildNflHubManifest() {
  return {
    name: 'NFL Team Hub',
    short_name: 'NFL',
    description: 'All 32 NFC and AFC franchise hubs',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    background_color: '#080B10',
    theme_color: '#080B10',
    icons: [
      {
        src: './nfl-apple-touch-icon.png',
        sizes: '180x180',
        type: 'image/png'
      },
      {
        src: './nfl-icon-512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'any maskable'
      },
      {
        src: './nfl-icon.svg',
        sizes: '512x512',
        type: 'image/svg+xml',
        purpose: 'any maskable'
      }
    ]
  };
}

async function fetchStaticAssetNoRedirect(env, pathname, request, fallbackPathname = '') {
  if (!env?.ASSETS) return null;
  const baseUrl = new URL(request.url);
  const tryPath = async targetPath => {
    const assetUrl = new URL(targetPath, baseUrl.origin);
    let res = await env.ASSETS.fetch(new Request(assetUrl.toString(), { method: request.method }));
    if (res && res.status >= 300 && res.status < 400) {
      const loc = res.headers.get('Location');
      if (loc) {
        try {
          const nextUrl = new URL(loc, baseUrl.origin);
          if (nextUrl.origin === baseUrl.origin) {
            res = await env.ASSETS.fetch(new Request(nextUrl.toString(), { method: request.method }));
          }
        } catch {}
      }
    }
    return res;
  };
  let res = await tryPath(pathname);
  if ((!res || !res.ok) && fallbackPathname) {
    res = await tryPath(fallbackPathname);
  }
  return res;
}

async function maybeForwardHubAiPost(request, url, env, rawBodyText, cors) {
  const hasLocalKey = Boolean(String(env?.GEMINI_NFL_API_KEY || env?.GEMINI_API_KEY || '').trim());
  if (hasLocalKey) return null;
  if (request.headers.get('X-NFL-Hub-Forwarded') === '1') return null;
  if (!isNflHubHost(getRequestHost(request, url))) return null;
  try {
    const upstreamUrl = `${UPSTREAM_AI_PAGES_ORIGIN}${url.pathname}${url.search}`;
    const upRes = await fetch(upstreamUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-NFL-Hub-Forwarded': '1'
      },
      body: rawBodyText,
      signal: AbortSignal.timeout(85000)
    });
    const text = await upRes.text();
    return new Response(text, {
      status: upRes.status,
      headers: {
        'Content-Type': upRes.headers.get('Content-Type') || 'application/json; charset=utf-8',
        ...cors
      }
    });
  } catch (err) {
    return jsonResp({ error: `Upstream AI relay failed: ${err?.message || String(err)}` }, 502, cors);
  }
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

function rewriteHtmlForTeam(response, team, { isHubMode = false } = {}) {
  const cssVars = buildTeamCssVarsStyleBlock(team);
  const hubBootFlag = isHubMode ? 'window.__NFL_HUB_MODE__=true;' : '';
  const bootScript = `<script>window.__ACTIVE_TEAM_SLUG__=${JSON.stringify(team.slug)};window.__PLATFORM_API_ENABLED__=true;${hubBootFlag}</script><style id="teamThemeOverrides">${cssVars}</style>`;

  return new HTMLRewriter()
    .on('html', {
      element(el) {
        if (isHubMode) {
          el.setAttribute('data-nfl-hub', 'true');
        }
      }
    })
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
        el.setAttribute('content', isHubMode ? 'NFL' : team.shortTitle);
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
        if (isHubMode) {
          el.setAttribute('href', './nfl-apple-touch-icon.png');
          return;
        }
        const sz = el.getAttribute('sizes');
        el.setAttribute('href', sz === '180x180' ? team.assets.appleTouchIcon180Png : './apple-touch-icon.png');
      }
    })
    .on('head', {
      element(el) {
        el.append(bootScript, { html: true });
      }
    })
    .on('#nflHubBackBtn', {
      element(el) {
        if (isHubMode) {
          el.removeAttribute('hidden');
        }
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
    .on('#sheetEyebrow', {
      element(el) {
        el.setInnerContent(`${team.nickname} Dossier`);
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

async function handleCachedEdgeGet(request, teamAbbr, cacheTtlSec, fetcherFn) {
  const cache = typeof caches !== 'undefined' ? caches.default : null;
  const scopedUrl = new URL(request.url);
  if (teamAbbr) scopedUrl.searchParams.set('__team', String(teamAbbr).toUpperCase());
  const cacheKey = new Request(scopedUrl.toString(), { method: 'GET' });
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

function decodeWorkerXml(str = '') {
  return String(str || '')
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;|&#x27;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function parseWorkerRotoWireTeamInactives(html = '', teamCfg = null) {
  if (!html || !teamCfg) return { officialPosted: false, inactives: [], sourceUrl: 'https://www.rotowire.com/football/inactives.php', sourceLabel: 'RotoWire NFL Inactives' };
  const nickEsc = String(teamCfg.nickname || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const fullEsc = String(teamCfg.fullName || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const secRe = new RegExp(`(?:${fullEsc}|${nickEsc})[\\s\\S]{0,4500}`, 'i');
  const m = html.match(secRe);
  if (!m) return { officialPosted: false, inactives: [], sourceUrl: 'https://www.rotowire.com/football/inactives.php', sourceLabel: 'RotoWire NFL Inactives' };
  const names = [];
  const seen = new Set();
  for (const pm of m[0].matchAll(/\/football\/player\/[^"]+"[^>]*>([^<]{4,40})<\/a>/gi)) {
    const nm = decodeWorkerXml(pm[1]);
    if (!nm || seen.has(nm.toLowerCase())) continue;
    seen.add(nm.toLowerCase());
    names.push(nm);
    if (names.length >= 10) break;
  }
  return {
    officialPosted: names.length >= 3,
    inactives: names,
    sourceUrl: 'https://www.rotowire.com/football/inactives.php',
    sourceLabel: 'RotoWire NFL Inactives'
  };
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const cors = buildCorsHeaders(request);

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: cors });
    }

    const host = getRequestHost(request, url);
    const hubHost = isNflHubHost(host);
    const explicitQueryTeam = resolveExplicitQueryTeam(url.search);
    const team = resolveTeamForRequest(request, url);

    // 0. Hermetically sealed Same-Site Gemini API Key Sync Vault (`nfl.joshal.com/key-sync` ONLY)
    if ((request.method === 'GET' || request.method === 'HEAD') && (url.pathname === '/key-sync' || url.pathname === '/key-sync.html')) {
      if (!hubHost && host !== 'localhost' && host !== '127.0.0.1') {
        return jsonResp({ error: 'Not Found' }, 404, cors);
      }
      const vaultRes = await fetchStaticAssetNoRedirect(env, '/key-sync', request, '/key-sync.html');
      if (vaultRes && vaultRes.ok) {
        const headers = new Headers(vaultRes.headers);
        headers.set('Content-Type', 'text/html; charset=utf-8');
        headers.set('Content-Security-Policy', buildKeySyncCspHeader());
        headers.set('X-Content-Type-Options', 'nosniff');
        headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
        headers.set('Cache-Control', 'public, max-age=300, stale-while-revalidate=3600');
        return new Response(request.method === 'HEAD' ? null : vaultRes.body, {
          status: 200,
          headers
        });
      }
      return jsonResp({ error: 'Key sync vault not found' }, 404, cors);
    }

    // 1. Dynamic per-team PWA manifest & iOS apple-touch-icon.png (or NFL Team Hub manifest/icon on nfl.joshal.com)
    if (request.method === 'GET' && url.pathname === '/manifest.json') {
      return jsonResp(hubHost ? buildNflHubManifest() : buildDynamicManifest(team), 200, cors, {
        'Cache-Control': 'public, max-age=300'
      });
    }

    if ((request.method === 'GET' || request.method === 'HEAD') && url.pathname === '/apple-touch-icon.png') {
      const iconPath = hubHost
        ? '/nfl-apple-touch-icon.png'
        : team.abbr === 'SF'
          ? '/apple-touch-icon.png'
          : `/assets/teams/${team.slug}/apple-touch-icon.png`;
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
          hubHost,
          entryMode: hubHost ? (explicitQueryTeam ? 'hub-team' : 'hub-portal') : 'team-subdomain',
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
      return handleCachedEdgeGet(request, team.abbr, 60, async () => {
        const [rssXml, pfrXml, espnNews] = await Promise.all([
          fetch(team.clubRssUrls[0], { signal: AbortSignal.timeout(6500) })
            .then(r => (r.ok ? r.text() : ''))
            .catch(() => ''),
          fetch(`https://www.profootballrumors.com/${team.otcSlug}/feed`, { signal: AbortSignal.timeout(5500) })
            .then(r => (r.ok ? r.text() : ''))
            .catch(() => ''),
          fetch(`https://site.api.espn.com/apis/site/v2/sports/football/nfl/news?team=${team.espnId}&limit=15`, {
            signal: AbortSignal.timeout(6500)
          })
            .then(r => (r.ok ? r.json() : null))
            .catch(() => null)
        ]);
        const items = [];
        const seenUrls = new Set();
        const teamTerms = [team.nickname, ...(team.keywordRules?.excludeGenericCity ? [] : [team.city]), ...(team.keywordRules?.requiredNicknames || []), ...(team.aliases || [])]
          .filter(Boolean)
          .map(s => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
        const teamMentionRe = teamTerms.length ? new RegExp(`\\b(?:${teamTerms.join('|')})\\b`, 'i') : null;
        const pickBestWorkerImg = imgs => {
          const list = Array.isArray(imgs) ? imgs : [];
          let bestUrl = '';
          let bestScore = -Infinity;
          for (let i = 0; i < list.length; i += 1) {
            const im = list[i];
            let u = String(im?.url || '').trim();
            if (u.startsWith('http://')) u = `https://${u.slice(7)}`;
            if (!u.startsWith('https://')) continue;
            if (String(im?.type || '').toLowerCase() === 'stitcher') continue;
            if (/stitcher\/sports|applewatch|\/teamlogos\/|\/i\/headshots\//i.test(u)) continue;
            const w = Number(im?.width || 0);
            const h = Number(im?.height || 0);
            const ratio = w > 0 && h > 0 ? w / h : 0;
            let sc = i === 0 ? 4 : 0;
            if (ratio >= 1.35 && ratio <= 2.1) sc += 28;
            else if (ratio >= 0.9 && ratio <= 1.1) sc -= 14;
            if (/\/photo\/\d{4}\/\d{4}\/r\d+/i.test(u) || /\b(?:getty|ap\b|associated press|usa today|imagn|reuters)\b/i.test(String(im?.credit || ''))) sc += 26;
            if (String(im?.type || '').toLowerCase() === 'header') sc += 10;
            if (/(?:data[_-]?viz|power[_-]?rankings|playoff[_-]?tiers|mock[_-]?draft|graphic|collage)/i.test(u)) sc -= 26;
            if (sc > bestScore) {
              bestScore = sc;
              bestUrl = u;
            }
          }
          return bestUrl;
        };
        for (const a of espnNews?.articles || []) {
          if (!a?.headline || !a?.links?.web?.href || a.premium) continue;
          const teamCats = Array.isArray(a.categories) ? a.categories.filter(c => c?.type === 'team') : [];
          if (teamCats.length >= 6 && teamMentionRe && !teamMentionRe.test(`${a.headline} ${a.description || ''}`)) {
            continue;
          }
          seenUrls.add(a.links.web.href);
          items.push({
            id: `${team.abbr.toLowerCase()}_ew_${a.dataSourceIdentifier || a.id || ''}`,
            type: a.type === 'Media' ? 'video' : 'article',
            title: a.headline,
            summary: a.description || '',
            url: a.links.web.href,
            imageUrl: pickBestWorkerImg(a.images),
            publishedAt: a.published || new Date().toISOString(),
            outletName: 'ESPN',
            author: a.byline || 'ESPN'
          });
        }
        // Parse Official Club News RSS into live wire
        for (const m of (rssXml || '').matchAll(/<item\b[\s\S]*?<\/item>/gi)) {
          if (items.length >= 35) break;
          const b = m[0];
          const title = decodeWorkerXml((b.match(/<title>([\s\S]*?)<\/title>/i) || [])[1] || '');
          const link = decodeWorkerXml((b.match(/<link>([\s\S]*?)<\/link>/i) || [])[1] || '');
          if (!title || !link || !/^https:\/\//i.test(link) || seenUrls.has(link)) continue;
          seenUrls.add(link);
          const summary = decodeWorkerXml((b.match(/<description>([\s\S]*?)<\/description>/i) || [])[1] || '').slice(0, 220);
          const pubRaw = decodeWorkerXml((b.match(/<pubDate>([\s\S]*?)<\/pubDate>/i) || [])[1] || '');
          const img = ((b.match(/<media:content[^>]*url="([^"]+)"/i) || b.match(/<enclosure[^>]*url="([^"]+)"/i) || [])[1] || '').replace(/&amp;/g, '&');
          const pubMs = pubRaw ? Date.parse(pubRaw) : Date.now();
          items.push({
            id: `${team.abbr.toLowerCase()}_clubrss_${items.length}`,
            type: 'article',
            title,
            summary,
            url: link,
            imageUrl: /^https:\/\//i.test(img) ? img : '',
            publishedAt: Number.isFinite(pubMs) ? new Date(pubMs).toISOString() : new Date().toISOString(),
            outletId: `${team.slug}_official`,
            outletName: `${team.clubDomain} Official`,
            author: `${team.clubDomain} Official`,
            trustTier: 1
          });
        }
        // Parse Pro Football Rumors team feed into live wire
        for (const m of (pfrXml || '').matchAll(/<item\b[\s\S]*?<\/item>/gi)) {
          if (items.length >= 45) break;
          const b = m[0];
          const title = decodeWorkerXml((b.match(/<title>([\s\S]*?)<\/title>/i) || [])[1] || '');
          const link = decodeWorkerXml((b.match(/<link>([\s\S]*?)<\/link>/i) || [])[1] || '');
          if (!title || !link || !/^https:\/\//i.test(link) || seenUrls.has(link)) continue;
          seenUrls.add(link);
          const summary = decodeWorkerXml((b.match(/<description>([\s\S]*?)<\/description>/i) || [])[1] || '').slice(0, 220);
          const pubRaw = decodeWorkerXml((b.match(/<pubDate>([\s\S]*?)<\/pubDate>/i) || [])[1] || '');
          const pubMs = pubRaw ? Date.parse(pubRaw) : Date.now();
          items.push({
            id: `${team.abbr.toLowerCase()}_pfrlive_${items.length}`,
            type: 'article',
            title,
            summary,
            url: link,
            imageUrl: '',
            publishedAt: Number.isFinite(pubMs) ? new Date(pubMs).toISOString() : new Date().toISOString(),
            outletId: 'pro_football_rumors',
            outletName: 'Pro Football Rumors',
            author: 'Pro Football Rumors',
            trustTier: 2
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

    // 4b. Shortened URL Expander (0 KV writes — uses unlimited `caches.default`)
    if (request.method === 'POST' && url.pathname === '/api/expand-urls') {
      const body = await request.json().catch(() => null);
      const rawUrls = Array.isArray(body?.urls) ? body.urls.slice(0, 12) : [];
      const expanded = {};
      await Promise.all(
        rawUrls.map(async u => {
          const clean = String(u || '').trim();
          if (!/^https:\/\/(?:t\.co|dlvr\.it|bit\.ly|tinyurl\.com|ow\.ly|buff\.ly)\//i.test(clean)) return;
          try {
            const res = await fetch(clean, { method: 'HEAD', redirect: 'follow', signal: AbortSignal.timeout(4500) });
            if (res?.url && /^https:\/\//i.test(res.url)) {
              expanded[clean] = res.url;
            }
          } catch {}
        })
      );
      return jsonResp({ ok: true, expanded }, 200, cors);
    }

    // 5. Short-TTL Edge-Cached Game-Day Inactives (0 KV writes! Resolves BOTH active team & opponent)
    if (request.method === 'GET' && url.pathname === '/api/gameday-inactives') {
      return handleCachedEdgeGet(request, team.abbr, 120, async () => {
        const teamsParam = String(url.searchParams.get('teams') || team.abbr)
          .split(',')
          .map(s => normalizeAnyTeamAbbr(s.trim()))
          .filter(Boolean);
        const primaryAbbr = teamsParam[0] || team.abbr;
        const oppAbbr = teamsParam[1] && teamsParam[1] !== primaryAbbr ? teamsParam[1] : '';
        const primaryTeam = getTeamByAbbr(primaryAbbr) || team;
        const oppTeam = oppAbbr ? getTeamByAbbr(oppAbbr) : null;

        const [injJson, rotoHtml] = await Promise.all([
          fetch(`https://site.api.espn.com/apis/site/v2/sports/football/nfl/injuries?team=${primaryTeam.espnId}`, {
            signal: AbortSignal.timeout(6500)
          })
            .then(r => (r.ok ? r.json() : null))
            .catch(() => null),
          fetch('https://www.rotowire.com/football/inactives.php', {
            signal: AbortSignal.timeout(6500),
            headers: { 'User-Agent': 'Mozilla/5.0 (compatible; NFLFaithfulBot/1.0)' }
          })
            .then(r => (r.ok ? r.text() : ''))
            .catch(() => '')
        ]);

        const sfInactives = parseWorkerRotoWireTeamInactives(rotoHtml, primaryTeam);
        const oppInactives = oppTeam ? parseWorkerRotoWireTeamInactives(rotoHtml, oppTeam) : null;

        return jsonResp(
          {
            ok: true,
            teamAbbr: primaryTeam.abbr,
            oppAbbr: oppTeam?.abbr || '',
            fetchedAt: new Date().toISOString(),
            sf: sfInactives,
            opp: oppInactives,
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
        const rawBodyText = await request.text().catch(() => '');
        let body = null;
        try {
          body = rawBodyText ? JSON.parse(rawBodyText) : null;
        } catch {}
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
          const seedCheckText = `${body.seedRawText || ''} ${JSON.stringify(body.seedData || '')}`;
          if (hasCrossTeam49ersLeak(seedCheckText, team)) {
            return jsonResp({ error: 'Rejected cross-team contamination in daily brief seed' }, 422, cors);
          }
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

        const forwarded = await maybeForwardHubAiPost(request, url, env, rawBodyText, cors);
        if (forwarded) return forwarded;

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
      const rawBodyText = await request.text().catch(() => '');
      let body = null;
      try {
        body = rawBodyText ? JSON.parse(rawBodyText) : null;
      } catch {}
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

      const forwarded = await maybeForwardHubAiPost(request, url, env, rawBodyText, cors);
      if (forwarded) return forwarded;

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

      // On `nfl.joshal.com` WITHOUT `?team=<valid-slug>`, serve the 32-team NFL Team Hub portal (`nfl-portal.html`)
      if (hubHost && isHtmlShellPath && !explicitQueryTeam) {
        const portalRes = await fetchStaticAssetNoRedirect(env, '/nfl-portal', request, '/nfl-portal.html');
        if (portalRes && portalRes.ok) {
          const headers = new Headers(portalRes.headers);
          headers.set('Content-Type', 'text/html; charset=utf-8');
          headers.set('Cache-Control', 'public, max-age=300, stale-while-revalidate=3600');
          headers.set('X-Content-Type-Options', 'nosniff');
          headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
          return new Response(request.method === 'HEAD' ? null : portalRes.body, {
            status: 200,
            headers
          });
        }
      }

      const assetRes = isHtmlShellPath
        ? await fetchStaticAssetNoRedirect(env, `/${url.search}`, request, '/index.html')
        : await env.ASSETS.fetch(request);
      if (
        assetRes &&
        assetRes.ok &&
        isHtmlShellPath &&
        (assetRes.headers.get('Content-Type') || '').includes('text/html')
      ) {
        if (ctx && typeof ctx.waitUntil === 'function') {
          ctx.waitUntil(trackActiveTeamVisit(env, team));
        }
        return rewriteHtmlForTeam(assetRes, team, { isHubMode: hubHost });
      }
      if (assetRes) return assetRes;
    }

    return jsonResp({ error: 'Not Found' }, 404, cors);
  }
};
