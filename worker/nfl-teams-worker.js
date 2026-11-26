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
  TEAM_BY_SLUG,
  TEAM_REGISTRY,
  buildNflHubManifest,
  buildTeamCssVarsStyleBlock,
  getTeamByAbbr,
  hasCrossTeam49ersLeak,
  isNflHubHost,
  isOfficialTeamHost,
  normalizeAnyTeamAbbr,
  resolveExplicitQueryTeam
} from '../src/config/teamRegistry.js';
import {
  PRIMARY_GEMINI_REASONING_MODEL,
  buildGeminiThinkingConfig,
  resolveGeminiThinkingLevelLabel
} from '../src/engine/geminiStudioPrompts.js';
import {
  DEFAULT_GEMINI_QUOTA_CONFIG,
  estimateGeminiCallTokens,
  getQuotaPacificDateKey,
  isSearchGroundingAllowed,
  markSearchGroundingUnavailableToday,
  normalizeGeminiQuotaState,
  recordGeminiCallOutcome,
  refreshGeminiModelCatalogIfDue,
  selectBestAvailableModel
} from '../src/engine/geminiQuotaManager.js';
import {
  TEAM_CANONICAL_HASHTAGS,
  decodeHtmlEntities,
  extractXSyndicationMedia,
  isAllowedInlineVideoStreamUrl,
  isLeagueWideFilmAnalyticsTweet,
  isPromotionalAdvertisement,
  normalizeMultilineSocialText,
  stripHtmlAndDecodeEntities
} from '../src/engine/linkIntegrity.js';
import { extractXEntityInlineLinks } from '../src/engine/breakingClassifier.js';
import { formatVideoDurationDisplay } from '../src/engine/digestExperienceEngine.js';
import {
  NFL_TEAM_OFFICIAL_RSS_URLS,
  ESPN_NFL_TEAM_IDS,
  discoverOfficialClubInactivesRssItem,
  parseOfficialClubInactivesArticle,
  parseRotoWireInactivesHtml,
  parseEspnCoreEventRosterInactives
} from '../src/engine/gameDayRosterEngine.js';
import { buildKeySyncCspHeader } from '../src/services/sharedApiKeyStore.js';

const ALLOWED_SHORTENER_HOST_RE =
  /^(?:www\.)?(?:dlvr\.it|bit\.ly|tinyurl\.com|t\.co|ow\.ly|buff\.ly|ift\.tt|trib\.al|goo\.gl|es\.pn|on\.nfl\.com|nbcnews\.to|sbn\.to)$/i;

function stripEdgeTrackingParams(raw) {
  try {
    const u = new URL(raw);
    for (const k of [...u.searchParams.keys()]) {
      if (/^(?:utm_|fbclid$|gclid$|mc_cid$|mc_eid$|ref_src$|ref_url$|_osource$)/i.test(k)) {
        u.searchParams.delete(k);
      }
    }
    return u.toString();
  } catch {
    return raw;
  }
}

const SF_RESERVED_DAILY_CALLS = 8;
const DAILY_LEAGUE_SOFT_BUDGET = 48;
const UPSTREAM_AI_PAGES_ORIGIN = 'https://nfl-teams.pages.dev';
const ALLOWED_VIDEO_HOSTS = [
  'video.twimg.com',
  'media.video-cdn.espn.com',
  'cdn.espn.com',
  'a.espncdn.com',
  's.espncdn.com',
  'media.tenor.com',
  'c.tenor.com',
  'video.bsky.app'
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

function buildCorsHeaders(request, team = null) {
  const origin = String(request.headers.get('Origin') || '');
  const allowed =
    /^https:\/\/[a-z0-9-]+\.joshal\.com$/i.test(origin) ||
    /^https:\/\/(?:[a-z0-9-]+\.)?nfl-(?:teams|joshal)\.pages\.dev$/i.test(origin) ||
    /^http:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?$/i.test(origin);
  const fallbackOrigin = team?.domain ? `https://${team.domain}` : 'https://49ers.joshal.com';
  return {
    'Access-Control-Allow-Origin': allowed ? origin : fallbackOrigin,
    'Access-Control-Allow-Methods': 'GET, POST, HEAD, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-Group-Passcode, Range',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin, Host'
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
    scope: '/',
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
  const themeColors = {
    light: team.themes?.light?.themeColor || '#F7F5F0',
    dark: team.themes?.dark?.themeColor || '#0B0D10'
  };
  const prefsKey = team.storageKeys?.prefs || 'joshal_49ers_hq_prefs_v1';
  const bootScript = `<script>window.__ACTIVE_TEAM_SLUG__=${JSON.stringify(team.slug)};window.__PLATFORM_API_ENABLED__=true;window.__TEAM_PREFS_KEY__=${JSON.stringify(prefsKey)};window.__TEAM_THEME_COLORS__=${JSON.stringify(themeColors)};${hubBootFlag}</script><style id="teamThemeOverrides">${cssVars}</style>`;

  const headers = new Headers(response.headers);
  headers.set('Content-Type', 'text/html; charset=utf-8');
  headers.set('Cache-Control', 'public, max-age=0, must-revalidate');
  headers.set('Vary', 'Host');
  const baseResponse = new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers
  });

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
    .transform(baseResponse);
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

async function loadAndRefreshWorkerQuotaState(env, apiKey) {
  const nowMs = Date.now();
  const ptDate = getQuotaPacificDateKey(nowMs);
  const kvKey = `gemini:quota:v2:${ptDate}`;
  const catalogKvKey = 'gemini:catalog:v2';
  let stored = null;
  let storedCatalog = null;
  if (env?.SHARED_CACHE) {
    try {
      [stored, storedCatalog] = await Promise.all([
        env.SHARED_CACHE.get(kvKey, 'json'),
        env.SHARED_CACHE.get(catalogKvKey, 'json')
      ]);
    } catch {}
  }
  const merged = normalizeGeminiQuotaState(
    {
      ...(stored || {}),
      ...(storedCatalog?.pools ? { pools: storedCatalog.pools } : {}),
      ...(storedCatalog?.catalogUpdatedAtMs ? { catalogUpdatedAtMs: storedCatalog.catalogUpdatedAtMs } : {}),
      deprecatedModels: {
        ...(storedCatalog?.deprecatedModels || {}),
        ...(stored?.deprecatedModels || {})
      },
      learnedRpdCaps: {
        ...(storedCatalog?.learnedRpdCaps || {}),
        ...(stored?.learnedRpdCaps || {})
      }
    },
    nowMs
  );
  const refreshed = await refreshGeminiModelCatalogIfDue(merged, apiKey, {
    nowMs,
    timeoutMs: 6000
  });
  if (refreshed.refreshed && env?.SHARED_CACHE) {
    await env.SHARED_CACHE.put(
      catalogKvKey,
      JSON.stringify({
        pools: refreshed.state.pools,
        catalogUpdatedAtMs: refreshed.state.catalogUpdatedAtMs,
        deprecatedModels: refreshed.state.deprecatedModels,
        learnedRpdCaps: refreshed.state.learnedRpdCaps
      }),
      { expirationTtl: 60 * 60 * 24 * 8 }
    ).catch(() => {});
  }
  return { state: refreshed.state, kvKey, catalogKvKey };
}

async function saveWorkerQuotaState(env, kvKey, catalogKvKey, state) {
  if (!env?.SHARED_CACHE || !state) return;
  try {
    await Promise.all([
      env.SHARED_CACHE.put(kvKey, JSON.stringify(state), { expirationTtl: 60 * 60 * 28 }),
      env.SHARED_CACHE.put(
        catalogKvKey,
        JSON.stringify({
          pools: state.pools,
          catalogUpdatedAtMs: state.catalogUpdatedAtMs,
          deprecatedModels: state.deprecatedModels,
          learnedRpdCaps: state.learnedRpdCaps
        }),
        { expirationTtl: 60 * 60 * 24 * 8 }
      )
    ]);
  } catch {}
}

async function callGeminiSinglePass(
  env,
  {
    systemPrompt,
    userPrompt,
    thinkingLevel = 'XHIGH',
    jsonMode = false,
    useGoogleSearch = true,
    pool = 'premier',
    team = null,
    maxOutputTokens = 2048
  }
) {
  const apiKey = String(env.GEMINI_NFL_API_KEY || env.GEMINI_API_KEY || '').trim();
  if (!apiKey) return { ok: false, status: 503, error: 'GEMINI_NFL_API_KEY not configured' };

  const isPriorityTeam = team?.abbr === 'SF';
  const estTokens = estimateGeminiCallTokens(userPrompt, systemPrompt, maxOutputTokens);
  const { state: quotaState, kvKey, catalogKvKey } = await loadAndRefreshWorkerQuotaState(env, apiKey);

  const attempted = new Set();
  let lastError = 'All Gemini cascade tiers exhausted or reserved';
  let stateDirty = false;

  try {
    for (let step = 0; step < 6; step += 1) {
      const poolList = (quotaState.pools?.[pool] || [PRIMARY_GEMINI_REASONING_MODEL]).filter(
        m => !attempted.has(m)
      );
      if (poolList.length === 0) break;

      const picked = selectBestAvailableModel(quotaState, {
        pool,
        isPriorityTeam,
        estimatedTokens: estTokens,
        nowMs: Date.now(),
        config: DEFAULT_GEMINI_QUOTA_CONFIG,
        preferredModels: poolList
      });
      if (!picked.ok || !picked.modelId) {
        lastError = picked.reason || lastError;
        break;
      }
      if (picked.waitMs > 0 && picked.waitMs <= 16_000) {
        await new Promise(r => setTimeout(r, picked.waitMs));
      } else if (picked.waitMs > 16_000) {
        // Worker request timeout safety: skip overly long cooldowns and try next ready model in pool
        attempted.add(picked.modelId);
        continue;
      }

      const model = picked.modelId;
      attempted.add(model);

      const primaryThinking = buildGeminiThinkingConfig(model, { preferredThinkingLevel: thinkingLevel });
      const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`;
      const trySearchFirst = Boolean(
        useGoogleSearch && !jsonMode && isSearchGroundingAllowed(quotaState, Date.now())
      );

      const attempts = [];
      if (trySearchFirst) {
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
          ? 15000
          : thinkingConfig?.thinkingLevel === 'XHIGH'
            ? 55000
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
                maxOutputTokens,
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
            recordGeminiCallOutcome(quotaState, {
              modelId: model,
              status: res.status,
              ok: false,
              estimatedTokens: estTokens,
              isPriorityTeam,
              usedSearch: withSearch,
              nowMs: Date.now()
            });
            stateDirty = true;
            if (withSearch && (res.status === 400 || res.status === 403 || res.status === 429 || res.status >= 500)) continue;
            if (!withSearch && res.status === 400 && thinkingConfig?.thinkingLevel === 'XHIGH') continue;
            break;
          }
          const json = await res.json();
          const parts = json?.candidates?.[0]?.content?.parts || [];
          const text = parts.filter(p => !p.thought && typeof p.text === 'string').map(p => p.text).join('').trim();
          if (!text) continue;
          const actualTokens = Number(json?.usageMetadata?.totalTokenCount) || estTokens;
          recordGeminiCallOutcome(quotaState, {
            modelId: model,
            status: 200,
            ok: true,
            actualTokens,
            estimatedTokens: estTokens,
            isPriorityTeam,
            usedSearch: withSearch,
            nowMs: Date.now()
          });
          if (trySearchFirst && !withSearch) {
            // Search failed 429 while direct succeeded 200 -> disable search for rest of PT day (zero wasted 2x retries!)
            markSearchGroundingUnavailableToday(quotaState, Date.now());
          }
          stateDirty = true;
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
  } finally {
    if (stateDirty) {
      await saveWorkerQuotaState(env, kvKey, catalogKvKey, quotaState);
    }
  }
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
  return stripHtmlAndDecodeEntities(str);
}

export const OFFICIAL_TEAM_X_HANDLES = Object.freeze({
  SF: '49ers',
  SEA: 'Seahawks',
  LAR: 'RamsNFL',
  ARI: 'AZCardinals',
  MIN: 'Vikings',
  DET: 'Lions',
  GB: 'packers',
  CHI: 'ChicagoBears',
  PHI: 'Eagles',
  DAL: 'dallascowboys',
  NYG: 'Giants',
  WAS: 'Commanders',
  TB: 'Buccaneers',
  NO: 'Saints',
  ATL: 'AtlantaFalcons',
  CAR: 'Panthers',
  BUF: 'BuffaloBills',
  NE: 'Patriots',
  MIA: 'MiamiDolphins',
  NYJ: 'nyjets',
  BAL: 'Ravens',
  CIN: 'Bengals',
  CLE: 'Browns',
  PIT: 'steelers',
  HOU: 'HoustonTexans',
  IND: 'Colts',
  JAX: 'Jaguars',
  TEN: 'Titans',
  KC: 'Chiefs',
  LAC: 'chargers',
  DEN: 'Broncos',
  LV: 'Raiders'
});

const AMBIGUOUS_NFL_SURNAMES = new Set([
  'allen', 'bell', 'brown', 'campbell', 'clark', 'cole', 'cook', 'davis', 'ford', 'gray',
  'green', 'hall', 'harris', 'hill', 'jackson', 'johnson', 'jones', 'king', 'lee', 'lewis',
  'long', 'martin', 'miller', 'moore', 'morris', 'reed', 'ross', 'smith', 'taylor', 'thomas',
  'walker', 'ward', 'west', 'white', 'williams', 'wilson', 'wood', 'wright', 'young'
]);

/**
 * Extracts active team player names, unique surnames, AND dynamic roster-derived player @handle tokens
 * from the active club's live `roster.json` + optional ESPN live `summary?event=` payload
 * so `@NFL` and national film/analytics clips match ANY of the 32 clubs dynamically as rosters change.
 */
export function buildActiveTeamGameDayMatchers(liveSummaryJson = null, team = null, rosterPlayers = []) {
  const fullNames = new Set();
  const uniqueSurnames = new Set();
  const handleProfiles = [];
  const seenProfileKeys = new Set();
  const teamAbbrUpper = String(team?.abbr || '').toUpperCase();
  const teamEspnIdStr = String(team?.espnId || '');
  const oppAbbrs = new Set();

  const addName = (rawName, jerseyRaw = '') => {
    const clean = String(rawName || '').trim().replace(/\s+/g, ' ');
    if (clean.length < 5) return;
    const fullLow = clean.toLowerCase();
    fullNames.add(fullLow);
    const stripped = clean.replace(/\s+(?:Jr\.?|Sr\.?|II|III|IV|V)$/i, '').trim();
    const parts = stripped.split(/\s+/).filter(Boolean);
    const first = (parts[0] || '').replace(/[^a-zA-Z]/g, '').toLowerCase();
    const last = (parts[parts.length - 1] || '').toLowerCase().replace(/[^a-z'-]/g, '');
    const compactLast = last.replace(/[^a-z]/g, '');
    const compoundTail =
      parts.length >= 3 && /^(st\.?|de|la|le|van|von|mc|mac)$/i.test(parts[parts.length - 2])
        ? `${parts[parts.length - 2]}${parts[parts.length - 1]}`.replace(/[^a-z]/gi, '').toLowerCase()
        : '';
    const hyphenParts = last.includes('-')
      ? last.split('-').map(s => s.replace(/[^a-z]/g, '')).filter(s => s.length >= 5)
      : [];
    if (last.length >= 4 && !AMBIGUOUS_NFL_SURNAMES.has(last)) {
      uniqueSurnames.add(last);
    }
    const key = `${first}|${compactLast}`;
    if (compactLast.length >= 4 && !seenProfileKeys.has(key)) {
      seenProfileKeys.add(key);
      handleProfiles.push({
        first,
        last,
        compactLast,
        compoundTail,
        hyphenParts,
        compactFull: `${first}${compoundTail || compactLast}`,
        jersey: String(jerseyRaw || '').replace(/[^0-9]/g, ''),
        isAmbiguous: AMBIGUOUS_NFL_SURNAMES.has(last)
      });
    }
  };

  for (const p of Array.isArray(rosterPlayers) ? rosterPlayers : []) {
    if (p?.name) addName(p.name, p.jersey || '');
  }

  if (liveSummaryJson && typeof liveSummaryJson === 'object') {
    const comps = liveSummaryJson?.header?.competitions?.[0]?.competitors || [];
    for (const c of comps) {
      const ab = String(c?.team?.abbreviation || '').toUpperCase();
      if (ab && ab !== teamAbbrUpper) oppAbbrs.add(ab);
    }
    for (const tb of Array.isArray(liveSummaryJson?.boxscore?.players) ? liveSummaryJson.boxscore.players : []) {
      const ab = String(tb?.team?.abbreviation || '').toUpperCase();
      const id = String(tb?.team?.id || '');
      if ((teamAbbrUpper && ab === teamAbbrUpper) || (teamEspnIdStr && id === teamEspnIdStr)) {
        for (const statGrp of Array.isArray(tb.statistics) ? tb.statistics : []) {
          for (const ath of Array.isArray(statGrp?.athletes) ? statGrp.athletes : []) {
            addName(ath?.athlete?.displayName || ath?.athlete?.fullName || '', ath?.athlete?.jersey || '');
          }
        }
      }
    }
    for (const sp of Array.isArray(liveSummaryJson?.scoringPlays) ? liveSummaryJson.scoringPlays : []) {
      const ab = String(sp?.team?.abbreviation || '').toUpperCase();
      const id = String(sp?.team?.id || '');
      if ((teamAbbrUpper && ab === teamAbbrUpper) || (teamEspnIdStr && id === teamEspnIdStr)) {
        const txt = String(sp?.text || '');
        for (const m of txt.matchAll(/\b([A-Z][a-z'’-]{1,16}\s+[A-Z][A-Za-z'’-]{2,20})\b/g)) {
          addName(m[1]);
        }
      }
    }
  }

  return { fullNames, uniqueSurnames, handleProfiles, oppAbbrs };
}

function matchesDynamicPlayerHandle(relevanceBlob = '', handleProfiles = []) {
  if (!relevanceBlob || !Array.isArray(handleProfiles) || handleProfiles.length === 0) return false;
  const atHandles = [...String(relevanceBlob).toLowerCase().matchAll(/@([a-z0-9_]{3,25})\b/g)].map(m => m[1]);
  if (atHandles.length === 0) return false;
  for (const h of atHandles) {
    const hAlpha = h.replace(/[^a-z]/g, '');
    for (const prof of handleProfiles) {
      if (prof.compactFull.length >= 7 && hAlpha.includes(prof.compactFull)) return true;
      if (
        (prof.compoundTail && prof.compoundTail.length >= 6 && hAlpha.includes(prof.compoundTail)) ||
        prof.hyphenParts.some(hp => hp.length >= 6 && hAlpha.includes(hp))
      ) {
        return true;
      }
      if (prof.compactLast.length >= 5 && hAlpha.includes(prof.compactLast)) {
        if (
          !prof.isAmbiguous ||
          (prof.first && (hAlpha.startsWith(prof.first[0]) || h.includes(`_${prof.first[0]}`) || (prof.jersey && h.endsWith(prof.jersey))))
        ) {
          return true;
        }
      }
      if (prof.compactLast.length === 4 && hAlpha.includes(prof.compactLast)) {
        const hasFirstInit = Boolean(
          prof.first && new RegExp(`^[a-z]{0,2}${prof.first[0]}[a-z_]*${prof.compactLast}`).test(h)
        );
        const hasJersey = Boolean(prof.jersey && h.endsWith(prof.jersey));
        if (hasFirstInit || (hasJersey && !prof.isAmbiguous)) return true;
      }
    }
  }
  return false;
}

const WORKER_NATIONAL_FILM_X_SPECS = Object.freeze([
  { handle: 'BaldyNFL', isLeagueAccount: true, isBeatOrFilmAccount: true, allowLeagueWideFilmCharts: false },
  { handle: 'FB_FilmAnalysis', isLeagueAccount: true, isBeatOrFilmAccount: true, allowLeagueWideFilmCharts: false },
  { handle: 'BrandonThornNFL', isLeagueAccount: true, isBeatOrFilmAccount: true, allowLeagueWideFilmCharts: false },
  { handle: 'throwthedamball', isLeagueAccount: true, isBeatOrFilmAccount: true, allowLeagueWideFilmCharts: true },
  { handle: 'ghatz_28', isLeagueAccount: true, isBeatOrFilmAccount: true, allowLeagueWideFilmCharts: true }
]);

const WORKER_NATIONAL_OUTLET_IDS = new Set(['espn_national', 'nfl_network', 'national_film', 'overthecap']);
const WORKER_NATIONAL_HANDLE_SET = new Set([
  'adamschefter', 'rapsheet', 'tompelissero', 'mikegarafolo', 'dmrussini', 'jfowlerespn',
  'albertbreer', 'fieldyates', 'schultz_report', 'dangrazianoespn', 'jason_otc', 'stephania_espn',
  'dpbrugler', 'movethesticks', 'baldynfl', 'brandonthornnfl', 'fb_filmanalysis', 'qbklass',
  'kurt13warner', 'danorlovsky7', 'collinsworthpff', 'throwthedamball', 'ghatz_28', 'tejfbanalytics',
  'sumersports', 'pff_moo', 'nate_tice', 'benjaminsolak', 'minakimes', 'brettkollmann',
  'theqbschool', 'pff', 'nextgenstats', 'fball_insights', 'benbbaldwin', 'sethwalder', 'nfl', 'espnnfl', 'nflnetwork'
]);

/**
 * Unified 32-team Edge X-timeline selector: selects up to `maxLocal` local club film/clip/beat X handles
 * from the active team's own `reporters.json` + the 5 shared national film/analytics accounts identically for ALL 32 clubs.
 */
export function selectEdgeLiveWireXSpecs(team, reportersJson = null, maxLocal = 4) {
  const officialLow = String(OFFICIAL_TEAM_X_HANDLES[team?.abbr] || '').toLowerCase();
  const seen = new Set(officialLow ? [officialLow] : []);
  for (const ns of WORKER_NATIONAL_FILM_X_SPECS) seen.add(ns.handle.toLowerCase());

  const localSpecs = [];
  const reps = Array.isArray(reportersJson?.reporters) ? reportersJson.reporters : [];
  const localReps = reps.filter(r => {
    if (!r || r.isPodiumSubject || r.scope === 'national') return false;
    if (WORKER_NATIONAL_OUTLET_IDS.has(String(r.outletId || ''))) return false;
    if (['national_insider', 'draft', 'injury_analyst', 'official'].includes(String(r.category || '').toLowerCase())) return false;
    const h = String(r.handle || '').replace(/^@/, '').trim().toLowerCase();
    return Boolean(h && !WORKER_NATIONAL_HANDLE_SET.has(h));
  });

  const isFilm = r =>
    ['film', 'film_analyst', 'analytics'].includes(String(r.category || '').toLowerCase()) ||
    /all[- ]?22|film|tape|scheme|analytics|trench/i.test(`${r.role || ''} ${r.styleTag || ''}`);
  const isClip = r =>
    ['video_pod', 'audio_beat'].includes(String(r.category || '').toLowerCase()) ||
    /clip|video|pod|highlight/i.test(`${r.role || ''} ${r.styleTag || ''}`);
  const scoreDesc = (a, b) => (Number(b.baseScore) || 85) - (Number(a.baseScore) || 85);

  const prioritized = [
    ...localReps.filter(isFilm).sort(scoreDesc).slice(0, 2),
    ...localReps.filter(r => !isFilm(r) && isClip(r)).sort(scoreDesc).slice(0, 1),
    ...localReps.filter(r => !isFilm(r) && !isClip(r)).sort((a, b) => (Number(a.trustTier) || 2) - (Number(b.trustTier) || 2) || scoreDesc(a, b)),
    ...localReps.filter(isFilm).sort(scoreDesc).slice(2)
  ];

  for (const r of prioritized) {
    if (localSpecs.length >= maxLocal) break;
    const rawH =
      r.id === 'jonnydel'
        ? 'SulligentHUB'
        : String(r.handle || '').replace(/^@/, '').trim();
    if (!rawH || !/^[A-Za-z0-9_]{2,25}$/.test(rawH)) continue;
    const low = rawH.toLowerCase();
    if (seen.has(low)) continue;
    seen.add(low);
    localSpecs.push({
      handle: rawH,
      isLeagueAccount: false,
      isBeatOrFilmAccount: true,
      allowLeagueWideFilmCharts: false
    });
  }

  return [...localSpecs, ...WORKER_NATIONAL_FILM_X_SPECS];
}

/**
 * Parses official X syndication profile HTML (`syndication.twitter.com/srv/timeline-profile/screen-name/<handle>`)
 * into normalized live feed items with direct `video.twimg.com` HD MP4 streams, thumbnails, and durations.
 */
export function parseOfficialXSyndicationTimelineHtml(
  html = '',
  {
    handle = '49ers',
    team = null,
    isLeagueAccount = false,
    isBeatOrFilmAccount = false,
    allowLeagueWideFilmCharts = false,
    liveMode = false,
    teamMentionRe = null,
    gameDayMatchers = null,
    nowMs = Date.now(),
    maxAgeHours = 72,
    maxItems = 14
  } = {}
) {
  if (!html || typeof html !== 'string') return [];
  const nextDataMatch = html.match(/<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/);
  if (!nextDataMatch) return [];
  let parsed = null;
  try {
    parsed = JSON.parse(nextDataMatch[1]);
  } catch {
    return [];
  }
  const entries = parsed?.props?.pageProps?.timeline?.entries || [];
  if (!Array.isArray(entries) || entries.length === 0) return [];

  const maxAgeMs = maxAgeHours * 3_600_000;
  const teamAbbrUpper = String(team?.abbr || '').toUpperCase();
  const teamXHandle = OFFICIAL_TEAM_X_HANDLES[teamAbbrUpper] || handle;
  const teamHashtags = (TEAM_CANONICAL_HASHTAGS[teamAbbrUpper] || [])
    .map(h => String(h).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .filter(Boolean);
  const teamHandleRe = new RegExp(
    `(?:[@#]${String(teamXHandle).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b${teamHashtags.length ? `|#(?:${teamHashtags.join('|')})\\b` : ''})`,
    'i'
  );
  const abbrEsc = String(team?.abbr || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const oppMatchupHashtagRe =
    abbrEsc && gameDayMatchers?.oppAbbrs?.size
      ? new RegExp(
          `#(?:${[...gameDayMatchers.oppAbbrs]
            .map(o => {
              const oe = o.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
              return `${oe}vs${abbrEsc}|${abbrEsc}vs${oe}`;
            })
            .join('|')})\\b`,
          'i'
        )
      : null;

  const pickBestMp4FromTweet = tw => {
    const ownMedia = [
      ...(Array.isArray(tw?.extended_entities?.media) ? tw.extended_entities.media : []),
      ...(Array.isArray(tw?.entities?.media) ? tw.entities.media : [])
    ];
    const mediaSources =
      ownMedia.length > 0
        ? ownMedia
        : [
            ...(Array.isArray(tw?.quoted_status?.extended_entities?.media) ? tw.quoted_status.extended_entities.media : []),
            ...(Array.isArray(tw?.retweeted_status?.extended_entities?.media) ? tw.retweeted_status.extended_entities.media : [])
          ];
    const vidMedia = mediaSources.find(m => m && (m.type === 'video' || m.type === 'animated_gif') && m.video_info?.variants);
    const photoUrls = [];
    const seenPhotos = new Set();
    for (const m of mediaSources) {
      if (photoUrls.length >= 4) break;
      if (!m || m.type !== 'photo') continue;
      const u = String(m.media_url_https || '').trim();
      if (!u || !u.startsWith('https://') || seenPhotos.has(u)) continue;
      seenPhotos.add(u);
      photoUrls.push(u);
    }
    const photoMedia = mediaSources.find(m => m && m.media_url_https);
    if (!vidMedia) {
      const thumbUrl = photoUrls[0] || String(photoMedia?.media_url_https || '');
      return {
        mp4Url: '',
        isAnimatedGif: false,
        durationMs: 0,
        thumbUrl,
        imageUrls: photoUrls,
        isPhoto: Boolean(thumbUrl)
      };
    }
    const mp4Variants = (Array.isArray(vidMedia.video_info.variants) ? vidMedia.video_info.variants : [])
      .filter(
        v =>
          (v?.content_type === 'video/mp4' || v?.type === 'video/mp4') &&
          /^https:\/\/video\.twimg\.com\//i.test(String(v?.url || v?.src || ''))
      )
      .sort((a, b) => (Number(b.bitrate) || 0) - (Number(a.bitrate) || 0));
    const crispMobile = mp4Variants.find(v => (Number(v.bitrate) || 0) > 0 && Number(v.bitrate) <= 2_400_000) || mp4Variants[0];
    const mp4Url = String(crispMobile?.url || crispMobile?.src || '');
    const isAnimatedGif = Boolean(mp4Url && (vidMedia.type === 'animated_gif' || /\/tweet_video\//i.test(mp4Url)));
    const thumbUrl = String(vidMedia.media_url_https || photoUrls[0] || photoMedia?.media_url_https || '');
    return {
      mp4Url,
      isAnimatedGif,
      durationMs: Number(vidMedia.video_info?.duration_millis || 0),
      thumbUrl,
      imageUrls: photoUrls.filter(u => u !== thumbUrl),
      isPhoto: false
    };
  };

  const tweets = entries
    .filter(e => e?.type === 'tweet' && e?.content?.tweet)
    .map(e => e.content.tweet)
    .sort((a, b) => (Date.parse(b.created_at || '') || 0) - (Date.parse(a.created_at || '') || 0));

  const results = [];
  const seenIds = new Set();
  for (const tw of tweets) {
    if (results.length >= maxItems) break;
    const idStr = String(tw.id_str || tw.id || '').trim();
    if (!idStr || seenIds.has(idStr)) continue;
    const pubMs = Date.parse(tw.created_at || '');
    if (!Number.isFinite(pubMs) || nowMs - pubMs > maxAgeMs) continue;

    const rawText = normalizeMultilineSocialText(
      decodeHtmlEntities(String(tw.full_text || tw.text || '')).replace(/https?:\/\/t\.co\/[A-Za-z0-9]+/gi, '')
    );
    const quotedText = normalizeMultilineSocialText(
      decodeHtmlEntities(String(tw.quoted_status?.full_text || tw.quoted_status?.text || '')).replace(
        /https?:\/\/t\.co\/[A-Za-z0-9]+/gi,
        ''
      )
    );
    const { mp4Url, isAnimatedGif, durationMs, thumbUrl, imageUrls, isPhoto } = pickBestMp4FromTweet(tw);
    const caption = rawText || quotedText;
    if (!caption || (caption.length < (mp4Url || thumbUrl ? 6 : 12) && !mp4Url)) continue;
    const expandedTweetUrls = [
      ...(Array.isArray(tw?.entities?.urls) ? tw.entities.urls.map(u => u?.expanded_url || u?.unwound_url || '') : []),
      ...(Array.isArray(tw?.quoted_status?.entities?.urls)
        ? tw.quoted_status.entities.urls.map(u => u?.expanded_url || u?.unwound_url || '')
        : [])
    ].filter(Boolean);
    if (
      isPromotionalAdvertisement({
        type: mp4Url ? 'video' : 'tweet',
        title: caption,
        fullText: caption,
        summary: quotedText && quotedText !== caption ? quotedText : '',
        expandedUrls: expandedTweetUrls
      })
    ) {
      continue;
    }

    const relevanceBlob = `${caption} ${quotedText}`;
    let isLeagueWideFilmChart = false;
    let filmOnlyScope = false;
    if (isLeagueAccount) {
      // Strictly gate national/league accounts to active team, fan hashtag, matchup hashtag, game-day players,
      // OR verified league-wide analytics charts (strictly scoped to Film & Trench via filmOnlyScope: true)!
      const relLower = relevanceBlob.toLowerCase();
      let matchesTeam =
        (teamMentionRe && teamMentionRe.test(relevanceBlob)) ||
        teamHandleRe.test(relevanceBlob) ||
        Boolean(oppMatchupHashtagRe && oppMatchupHashtagRe.test(relevanceBlob));
      if (!matchesTeam && gameDayMatchers) {
        for (const fn of gameDayMatchers.fullNames) {
          if (relLower.includes(fn)) {
            matchesTeam = true;
            break;
          }
        }
        if (!matchesTeam && gameDayMatchers.handleProfiles?.length) {
          matchesTeam = matchesDynamicPlayerHandle(relevanceBlob, gameDayMatchers.handleProfiles);
        }
        if (!matchesTeam) {
          for (const sn of gameDayMatchers.uniqueSurnames) {
            if (new RegExp(`\\b${sn.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(relevanceBlob)) {
              matchesTeam = true;
              break;
            }
          }
        }
      }
      if (!matchesTeam) {
        if (
          allowLeagueWideFilmCharts &&
          isLeagueWideFilmAnalyticsTweet(
            {
              title: caption,
              fullText: caption,
              summary: quotedText,
              authorHandle: `@${tw.user?.screen_name || handle}`,
              imageUrl: thumbUrl,
              videoStreamUrl: mp4Url
            },
            team
          )
        ) {
          isLeagueWideFilmChart = true;
          filmOnlyScope = true;
        } else {
          continue;
        }
      }
    }

    const screenName = String(tw.user?.screen_name || handle).trim();
    const postUrl = `https://x.com/${screenName}/status/${idStr}`;
    const hasVideo = Boolean(mp4Url && (isAnimatedGif || durationMs === 0 || durationMs >= 3500));
    const durFmt =
      !isAnimatedGif && durationMs >= 4000
        ? `${Math.floor(durationMs / 60000)}:${String(Math.round((durationMs % 60000) / 1000)).padStart(2, '0')}`
        : '';
    const isHighlightVideo = hasVideo && (isAnimatedGif || durationMs >= 4000 || durationMs === 0 || isLeagueAccount || liveMode);

    seenIds.add(idStr);
    results.push({
      id: `x_tl_${screenName.toLowerCase()}_${idStr}`,
      type: hasVideo && !isBeatOrFilmAccount ? 'video' : 'tweet',
      title: caption.slice(0, 320),
      fullText: caption,
      summary: quotedText && quotedText !== caption ? quotedText.slice(0, 220) : '',
      url: postUrl,
      imageUrl: /^https:\/\//i.test(thumbUrl) ? thumbUrl : '',
      ...(Array.isArray(imageUrls) && imageUrls.length > (hasVideo ? 0 : 1) ? { imageUrls } : {}),
      videoStreamUrl: hasVideo ? mp4Url : undefined,
      isAnimatedGif: isAnimatedGif || undefined,
      isHighlightClip: isHighlightVideo,
      isLiveGameHighlight: Boolean(hasVideo && liveMode),
      hasInlineChartImage:
        Boolean(
          (Array.isArray(imageUrls) && imageUrls.length > 1) ||
            (isPhoto && (isLeagueWideFilmChart || allowLeagueWideFilmCharts || isBeatOrFilmAccount))
        ) || undefined,
      isLeagueWideFilmChart: isLeagueWideFilmChart || undefined,
      filmOnlyScope: filmOnlyScope || undefined,
      duration: durFmt || undefined,
      embeddable: true,
      outletId: isBeatOrFilmAccount
        ? 'x_beat'
        : isLeagueAccount
          ? 'nfl_official'
          : `${team?.slug || 'team'}_official`,
      outletName: isBeatOrFilmAccount
        ? 'X Beat'
        : isLeagueAccount
          ? 'NFL Official'
          : `@${screenName} Official`,
      author:
        isLeagueAccount && !isBeatOrFilmAccount
          ? 'NFL'
          : decodeHtmlEntities(tw.user?.name || team?.fullName || `@${screenName}`),
      authorHandle: `@${screenName}`,
      authorProfileUrl: `https://x.com/${screenName}`,
      trustTier: isBeatOrFilmAccount ? 2 : 1,
      publishedAt: new Date(Math.min(nowMs, pubMs)).toISOString()
    });
  }

  return results;
}

const KEY_VAULT_RATE_LIMIT = new Map();

function checkKeyVaultRateLimit(request) {
  const ip =
    String(request.headers.get('CF-Connecting-IP') || request.headers.get('X-Forwarded-For') || 'local')
      .split(',')[0]
      .trim() || 'local';
  const now = Date.now();
  const windowMs = 60_000;
  const maxReq = 30;
  const prev = KEY_VAULT_RATE_LIMIT.get(ip);
  if (!prev || now - prev.startMs >= windowMs) {
    if (KEY_VAULT_RATE_LIMIT.size > 500) {
      KEY_VAULT_RATE_LIMIT.clear();
    }
    KEY_VAULT_RATE_LIMIT.set(ip, { startMs: now, count: 1 });
    return true;
  }
  if (prev.count >= maxReq) return false;
  prev.count += 1;
  return true;
}

function isAllowedKeyVaultRequest(request, host) {
  const cleanHost = String(host || '').toLowerCase();
  const hostOk =
    cleanHost === 'localhost' ||
    cleanHost === '127.0.0.1' ||
    isNflHubHost(cleanHost) ||
    isOfficialTeamHost(cleanHost) ||
    /^(?:[a-z0-9-]+\.)?nfl-teams\.pages\.dev$/.test(cleanHost);
  if (!hostOk) return false;
  const origin = String(request.headers.get('Origin') || '').trim();
  if (!origin) return true;
  try {
    const parsed = new URL(origin);
    const oHost = parsed.hostname.toLowerCase();
    if (parsed.protocol === 'http:') return oHost === 'localhost' || oHost === '127.0.0.1';
    if (parsed.protocol !== 'https:') return false;
    return (
      isNflHubHost(oHost) ||
      isOfficialTeamHost(oHost) ||
      /^(?:[a-z0-9-]+\.)?nfl-teams\.pages\.dev$/.test(oHost)
    );
  } catch {
    return false;
  }
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const host = getRequestHost(request, url);
    const hubHost = isNflHubHost(host);
    const explicitQueryTeam = resolveExplicitQueryTeam(url.search);
    const team = resolveTeamForRequest(request, url);
    const cors = buildCorsHeaders(request, team);

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: cors });
    }

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

    // 0b. Zero-Knowledge Client-Side Encrypted Key Sync Vault (`/api/key-vault`)
    //     Stores ONLY opaque client-encrypted AES-256-GCM ciphertext (`iv` + `ct`) keyed by a
    //     PBKDF2-derived 64-hex `vaultId` so separate iOS Home Screen PWAs & devices can sync safely.
    if (url.pathname === '/api/key-vault') {
      if (!isAllowedKeyVaultRequest(request, host)) {
        return jsonResp({ error: 'Forbidden origin' }, 403, cors, { 'Cache-Control': 'no-store' });
      }
      if (!checkKeyVaultRateLimit(request)) {
        return jsonResp({ error: 'Rate limit exceeded' }, 429, cors, { 'Cache-Control': 'no-store' });
      }
      if (!env.SHARED_CACHE) {
        return jsonResp({ error: 'Vault storage unavailable' }, 503, cors, { 'Cache-Control': 'no-store' });
      }

      if (request.method === 'GET') {
        const vaultId = String(url.searchParams.get('id') || '').trim().toLowerCase();
        if (!/^[a-f0-9]{64}$/.test(vaultId)) {
          return jsonResp({ error: 'Invalid vault id' }, 400, cors, { 'Cache-Control': 'no-store' });
        }
        const stored = await env.SHARED_CACHE.get(`key_vault_v1:${vaultId}`, 'json').catch(() => null);
        if (!stored || typeof stored !== 'object' || !stored.iv || !stored.ct) {
          return jsonResp({ ok: true, found: false, payload: null }, 200, cors, { 'Cache-Control': 'no-store' });
        }
        return jsonResp(
          {
            ok: true,
            found: true,
            payload: { v: 1, iv: stored.iv, ct: stored.ct, t: Number(stored.t) || 0 }
          },
          200,
          cors,
          { 'Cache-Control': 'no-store' }
        );
      }

      if (request.method === 'POST') {
        let body = null;
        try {
          body = await request.json();
        } catch {
          return jsonResp({ error: 'Invalid JSON body' }, 400, cors, { 'Cache-Control': 'no-store' });
        }
        const vaultId = String(body?.id || '').trim().toLowerCase();
        const iv = String(body?.iv || '').trim();
        const ct = String(body?.ct || '').trim();
        const t = Number(body?.t || 0);
        if (
          !/^[a-f0-9]{64}$/.test(vaultId) ||
          !/^[A-Za-z0-9_-]{16}$/.test(iv) ||
          !/^[A-Za-z0-9_-]{24,1024}$/.test(ct) ||
          !Number.isFinite(t) ||
          t <= 0
        ) {
          return jsonResp({ error: 'Invalid encrypted vault payload' }, 400, cors, { 'Cache-Control': 'no-store' });
        }

        const kvKey = `key_vault_v1:${vaultId}`;
        const existing = await env.SHARED_CACHE.get(kvKey, 'json').catch(() => null);
        const existingTs = Number(existing?.t || 0);
        if (existing && Number.isFinite(existingTs) && existingTs > Math.floor(t)) {
          return jsonResp(
            { ok: true, preservedNewer: true, t: existingTs },
            200,
            cors,
            { 'Cache-Control': 'no-store' }
          );
        }

        const nextRecord = { v: 1, iv, ct, t: Math.floor(t) };
        await env.SHARED_CACHE.put(kvKey, JSON.stringify(nextRecord), {
          expirationTtl: 365 * 86400
        });
        return jsonResp({ ok: true, preservedNewer: false, t: nextRecord.t }, 200, cors, {
          'Cache-Control': 'no-store'
        });
      }

      return jsonResp({ error: 'Method not allowed' }, 405, cors, { 'Cache-Control': 'no-store' });
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

    // 3b. Ultra-Low-Latency Edge-Cached Gamecast Proxy (2s live situation / 3s live summary / 1h final summary; 0 KV writes!)
    // Uses `site.api.espn.com` (Worker-safe; `site.web.api.espn.com` & `sports.core` WAF-block Worker IPs).
    if (request.method === 'GET' && url.pathname === '/api/gamecast') {
      const eventId = String(url.searchParams.get('event') || '').trim();
      const mode = String(url.searchParams.get('mode') || 'summary').trim().toLowerCase();
      if (!/^\d{6,12}$/.test(eventId)) {
        return jsonResp({ error: 'Invalid numeric ESPN event ID' }, 400, cors);
      }
      if (mode !== 'summary' && mode !== 'situation') {
        return jsonResp({ error: 'Invalid gamecast mode (use summary or situation)' }, 400, cors);
      }

      const upstreamUrl = `https://site.api.espn.com/apis/site/v2/sports/football/nfl/summary?event=${encodeURIComponent(eventId)}`;
      const edgeCache = typeof caches !== 'undefined' && caches?.default ? caches.default : null;
      const cacheKeyUrl = new URL(request.url);
      cacheKeyUrl.search = `?event=${encodeURIComponent(eventId)}&mode=${encodeURIComponent(mode)}`;
      const cacheKeyReq = new Request(cacheKeyUrl.toString(), { method: 'GET' });
      const summaryKeyUrl = new URL(request.url);
      summaryKeyUrl.search = `?event=${encodeURIComponent(eventId)}&mode=summary`;
      const summaryKeyReq = new Request(summaryKeyUrl.toString(), { method: 'GET' });

      if (edgeCache) {
        try {
          const hit = await edgeCache.match(cacheKeyReq);
          if (hit) {
            const hitHeaders = new Headers(hit.headers);
            for (const [k, v] of Object.entries(cors)) hitHeaders.set(k, v);
            hitHeaders.set('X-Gamecast-Cache', 'HIT');
            return new Response(hit.body, { status: hit.status, headers: hitHeaders });
          }
        } catch {}
      }

      try {
        // Reuse cached upstream `summary` when `mode=situation` misses so we never double-fetch 400KB ESPN JSON!
        let rawText = '';
        let summaryCacheReused = false;
        if (mode === 'situation' && edgeCache) {
          try {
            const sumHit = await edgeCache.match(summaryKeyReq);
            if (sumHit && sumHit.ok) {
              rawText = await sumHit.text();
              summaryCacheReused = Boolean(rawText);
            }
          } catch {}
        }
        if (!rawText) {
          const upRes = await fetch(upstreamUrl, {
            headers: { Accept: 'application/json' },
            signal: AbortSignal.timeout(5000)
          });
          if (!upRes.ok) {
            return jsonResp(
              { error: `Upstream ESPN returned ${upRes.status}` },
              upRes.status >= 400 && upRes.status < 500 ? upRes.status : 502,
              cors
            );
          }
          rawText = await upRes.text();
        }
        let parsed = null;
        try {
          parsed = JSON.parse(rawText);
        } catch {}
        const comp = parsed?.header?.competitions?.[0] || {};
        const st = String(comp?.status?.type?.state || '').toLowerCase();
        const kickoffMs = Date.parse(comp?.date || '');
        const isImminentPreKickoff =
          st === 'pre' && Number.isFinite(kickoffMs) && Date.now() >= kickoffMs - 15 * 60_000;
        const summaryTtlSec = st === 'post' ? 3600 : st === 'pre' ? (isImminentPreKickoff ? 3 : 30) : 3;

        // Populate shared `summary` edge cache when fetched on behalf of `mode=situation`
        if (mode === 'situation' && !summaryCacheReused && edgeCache && rawText) {
          const sumPut = edgeCache
            .put(
              summaryKeyReq,
              new Response(rawText, {
                status: 200,
                headers: {
                  'Content-Type': 'application/json; charset=utf-8',
                  'Cache-Control': `public, max-age=${summaryTtlSec}, s-maxage=${summaryTtlSec}`
                }
              })
            )
            .catch(() => {});
          if (ctx && typeof ctx.waitUntil === 'function') ctx.waitUntil(sumPut);
          else await sumPut;
        }

        let bodyOut = rawText;
        let ttlSec = summaryTtlSec;
        if (mode === 'situation') {
          ttlSec = st === 'post' ? 60 : 2;
          const sit = parsed?.situation || comp?.situation || {};
          const curDrv = parsed?.drives?.current;
          const prevDrvs = Array.isArray(parsed?.drives?.previous) ? parsed.drives.previous : [];
          const lastDrv = curDrv?.plays?.length ? curDrv : prevDrvs[prevDrvs.length - 1];
          const lastPl = lastDrv?.plays?.[lastDrv.plays.length - 1] || null;
          const totalPlays =
            prevDrvs.reduce((acc, d) => acc + (Array.isArray(d?.plays) ? d.plays.length : 0), 0) +
            (Array.isArray(curDrv?.plays) ? curDrv.plays.length : 0);
          const sitPlayId = String(sit?.lastPlay?.id || '');
          const lastPlId = String(lastPl?.id || '');
          const useLastPlEnd = Boolean(lastPl && (!sitPlayId || (lastPlId && sitPlayId !== lastPlId)));
          const compactSit = {
            state: st || 'pre',
            clock: comp?.status?.displayClock || '',
            period: comp?.status?.period || 0,
            totalPlays,
            lastPlay: { id: lastPlId || sitPlayId },
            down: useLastPlEnd ? (lastPl?.end?.down ?? sit?.down ?? -1) : (sit?.down ?? lastPl?.end?.down ?? -1),
            distance: useLastPlEnd
              ? (lastPl?.end?.distance ?? sit?.distance ?? -1)
              : (sit?.distance ?? lastPl?.end?.distance ?? -1),
            yardLine: useLastPlEnd
              ? (lastPl?.end?.yardLine ?? sit?.yardLine ?? -1)
              : (sit?.yardLine ?? lastPl?.end?.yardLine ?? -1),
            possession: sit?.possession || lastPl?.end?.team?.id || '',
            homeTimeouts: sit?.homeTimeouts ?? -1,
            awayTimeouts: sit?.awayTimeouts ?? -1,
            isRedZone: Boolean(sit?.isRedZone),
            downDistanceText: String(
              useLastPlEnd
                ? lastPl?.end?.shortDownDistanceText || lastPl?.end?.downDistanceText || sit?.downDistanceText || ''
                : sit?.downDistanceText || sit?.shortDownDistanceText || lastPl?.end?.shortDownDistanceText || ''
            ).trim()
          };
          bodyOut = JSON.stringify(compactSit);
        }

        const outHeaders = new Headers({
          ...cors,
          'Content-Type': 'application/json; charset=utf-8',
          'Cache-Control': `public, max-age=${ttlSec}, s-maxage=${ttlSec}`,
          'X-Gamecast-Cache': 'MISS',
          'X-Gamecast-TTL': String(ttlSec)
        });
        const responseToReturn = new Response(bodyOut, { status: 200, headers: outHeaders });
        if (edgeCache) {
          const toCache = responseToReturn.clone();
          const putPromise = edgeCache.put(cacheKeyReq, toCache).catch(() => {});
          if (ctx && typeof ctx.waitUntil === 'function') ctx.waitUntil(putPromise);
          else await putPromise;
        }
        return responseToReturn;
      } catch {
        return jsonResp({ error: 'Upstream ESPN gamecast unreachable' }, 502, cors);
      }
    }

    // 4. Ultra-Fast Edge-Cached Live Wire (10s live-game / 25s standard TTL; 0 KV writes via `caches.default`!)
    if (request.method === 'GET' && url.pathname === '/api/live-wire') {
      const liveMode = url.searchParams.get('live') === '1';
      const liveEventId = String(url.searchParams.get('event') || '').replace(/[^0-9]/g, '');
      const edgeTtlSec = liveMode ? 10 : 25;
      return handleCachedEdgeGet(request, team.abbr, edgeTtlSec, async () => {
        const isSfTeam = team.abbr === 'SF';
        const teamOfficialXHandle = OFFICIAL_TEAM_X_HANDLES[team.abbr] || '';
        const sfExtraRssFeeds = isSfTeam
          ? [
              { outletId: 'nbcsba', outletName: 'NBC Sports Bay Area', url: 'https://www.nbcsportsbayarea.com/nfl/san-francisco-49ers/?rss=1', trustTier: 1, sfOnly: false },
              { outletId: 'niners_nation', outletName: 'Niners Nation', url: 'https://www.ninersnation.com/rss/current.xml', trustTier: 2, sfOnly: false },
              { outletId: '49ers_webzone', outletName: '49ers Webzone', url: 'https://feeds.feedburner.com/49erswebzone', trustTier: 2, sfOnly: false },
              { outletId: 'sf_standard', outletName: 'The SF Standard', url: 'https://www.sfstandard.com/sports/feed/', trustTier: 2, sfOnly: true },
              { outletId: 'niners_wire', outletName: 'Niners Wire', url: 'https://ninerswire.usatoday.com/feed/', trustTier: 2, sfOnly: false },
              { outletId: 'knbr_radio', outletName: 'KNBR', url: 'https://www.knbr.com/category/49ers/feed/', trustTier: 2, sfOnly: false }
            ]
          : [];
        const clubVideosUrl = team.clubRssUrls?.[1] || `https://www.${team.clubDomain}/rss/videos`;
        const clubVideosSitemapUrl = `https://www.${team.clubDomain}/sitemap-video-fast-changing.xml`;
        const xSyndicationHeaders = {
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
          Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.9'
        };

        // Load the active club's own static `reporters.json` & `roster.json` directly from local Pages ASSETS (0ms!)
        // so ALL 32 clubs get identical data-driven local beat/film X polling, dynamic player @handle matching,
        // and embedded X allowlisting with zero SF-only hardcoding.
        const teamDataBasePath = `/data/teams/${team.slug}`;
        const readLocalTeamJson = async fileName => {
          if (!env?.ASSETS) return null;
          try {
            const res = await env.ASSETS.fetch(new Request(`${url.origin}${teamDataBasePath}/${fileName}`));
            return res.ok ? await res.json() : null;
          } catch {
            return null;
          }
        };
        const [teamReportersJson, teamRosterJson] = await Promise.all([
          readLocalTeamJson('reporters.json'),
          readLocalTeamJson('roster.json')
        ]);
        const edgeFilmAndBeatXSpecs = selectEdgeLiveWireXSpecs(team, teamReportersJson, 4);

        let teamXStatus = 0;
        let nflXStatus = 0;
        const [
          rssXml,
          clubVideosXml,
          clubVideosSitemapXml,
          pfrXml,
          espnNews,
          liveSummaryJson,
          teamXTimelineHtml,
          nflXTimelineHtml,
          nflYtRssXml,
          extraFilmXHtmls,
          ...sfFeedXmls
        ] = await Promise.all([
          fetch(team.clubRssUrls[0], { signal: AbortSignal.timeout(4500) })
            .then(r => (r.ok ? r.text() : ''))
            .catch(() => ''),
          fetch(clubVideosUrl, { signal: AbortSignal.timeout(4000) })
            .then(r => (r.ok ? r.text() : ''))
            .catch(() => ''),
          fetch(clubVideosSitemapUrl, { signal: AbortSignal.timeout(3500) })
            .then(r => (r.ok ? r.text() : ''))
            .catch(() => ''),
          fetch(`https://www.profootballrumors.com/${team.otcSlug}/feed`, { signal: AbortSignal.timeout(4500) })
            .then(r => (r.ok ? r.text() : ''))
            .catch(() => ''),
          // Server-side Worker MUST use `site.api.espn.com` (no CORS needed; `site.web.api.espn.com` WAF blocks Worker IPs)
          fetch(`https://site.api.espn.com/apis/site/v2/sports/football/nfl/news?team=${team.espnId}&limit=25`, {
            signal: AbortSignal.timeout(4500)
          })
            .then(r => (r.ok ? r.json() : null))
            .catch(() => null),
          liveEventId
            ? fetch(`https://site.api.espn.com/apis/site/v2/sports/football/nfl/summary?event=${liveEventId}`, {
                signal: AbortSignal.timeout(4000)
              })
                .then(r => (r.ok ? r.json() : null))
                .catch(() => null)
            : Promise.resolve(null),
          teamOfficialXHandle
            ? fetch(`https://syndication.twitter.com/srv/timeline-profile/screen-name/${encodeURIComponent(teamOfficialXHandle)}`, {
                headers: xSyndicationHeaders,
                signal: AbortSignal.timeout(3500)
              })
                .then(r => {
                  teamXStatus = r.status;
                  return r.ok ? r.text() : '';
                })
                .catch(() => '')
            : Promise.resolve(''),
          liveMode
            ? fetch('https://syndication.twitter.com/srv/timeline-profile/screen-name/NFL', {
                headers: xSyndicationHeaders,
                signal: AbortSignal.timeout(3500)
              })
                .then(r => {
                  nflXStatus = r.status;
                  return r.ok ? r.text() : '';
                })
                .catch(() => '')
            : Promise.resolve(''),
          liveMode
            ? fetch('https://www.youtube.com/feeds/videos.xml?channel_id=UCDVYQ4Zhbm3S2dlz7P1GBDg', {
                signal: AbortSignal.timeout(3500)
              })
                .then(r => (r.ok ? r.text() : ''))
                .catch(() => '')
            : Promise.resolve(''),
          Promise.all(
            edgeFilmAndBeatXSpecs.map(spec =>
              fetch(`https://syndication.twitter.com/srv/timeline-profile/screen-name/${encodeURIComponent(spec.handle)}`, {
                headers: xSyndicationHeaders,
                signal: AbortSignal.timeout(2800)
              })
                .then(r => (r.ok ? r.text() : ''))
                .catch(() => '')
            )
          ),
          ...sfExtraRssFeeds.map(src =>
            fetch(src.url, {
              headers: { 'User-Agent': '49ersFaithfulEdge/2.1' },
              signal: AbortSignal.timeout(3800)
            })
              .then(r => (r.ok ? r.text() : ''))
              .catch(() => '')
          )
        ]);

        const items = [];
        const seenUrls = new Set();
        const nowEdgeMs = Date.now();
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

        // 4a-0. Direct Official @<teamXHandle>, Local Club Beat/Film & National Film/Analytics X Live Timelines
        const gameDayMatchers = buildActiveTeamGameDayMatchers(
          liveSummaryJson,
          team,
          Array.isArray(teamRosterJson?.players) ? teamRosterJson.players : []
        );
        const officialTeamXItems = parseOfficialXSyndicationTimelineHtml(teamXTimelineHtml, {
          handle: teamOfficialXHandle,
          team,
          isLeagueAccount: false,
          liveMode,
          teamMentionRe,
          gameDayMatchers,
          nowMs: nowEdgeMs,
          maxAgeHours: 72,
          maxItems: 14
        });
        const officialNflXItems = liveMode
          ? parseOfficialXSyndicationTimelineHtml(nflXTimelineHtml, {
              handle: 'NFL',
              team,
              isLeagueAccount: true,
              liveMode,
              teamMentionRe,
              gameDayMatchers,
              nowMs: nowEdgeMs,
              maxAgeHours: 36,
              maxItems: 10
            })
          : [];
        const extraFilmAndBeatXItems = [];
        edgeFilmAndBeatXSpecs.forEach((spec, idx) => {
          const html = Array.isArray(extraFilmXHtmls) ? extraFilmXHtmls[idx] : '';
          if (!html) return;
          const parsedList = parseOfficialXSyndicationTimelineHtml(html, {
            handle: spec.handle,
            team,
            isLeagueAccount: spec.isLeagueAccount,
            isBeatOrFilmAccount: spec.isBeatOrFilmAccount,
            allowLeagueWideFilmCharts: spec.allowLeagueWideFilmCharts,
            liveMode,
            teamMentionRe,
            gameDayMatchers,
            nowMs: nowEdgeMs,
            maxAgeHours: 96,
            maxItems: 8
          });
          extraFilmAndBeatXItems.push(...parsedList);
        });
        for (const xIt of [...officialTeamXItems, ...officialNflXItems, ...extraFilmAndBeatXItems]) {
          if (!xIt?.url || seenUrls.has(xIt.url)) continue;
          seenUrls.add(xIt.url);
          items.push(xIt);
        }

        // 4a-1. Official NFL YouTube Channel Live Highlights RSS (game highlights, Every Throw, in-game plays)
        if (nflYtRssXml && nflYtRssXml.includes('<entry>')) {
          for (const em of nflYtRssXml.matchAll(/<entry\b[\s\S]*?<\/entry>/gi)) {
            const eb = em[0];
            const vidId = (eb.match(/<yt:videoId>([A-Za-z0-9_-]{11})<\/yt:videoId>/i) || [])[1] || '';
            const title = decodeWorkerXml((eb.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || '');
            const desc = decodeWorkerXml((eb.match(/<media:description[^>]*>([\s\S]*?)<\/media:description>/i) || [])[1] || '');
            const linkHref = (eb.match(/<link[^>]*href="([^"]+)"/i) || [])[1] || (vidId ? `https://www.youtube.com/watch?v=${vidId}` : '');
            if (!vidId || !title || /\/shorts\//i.test(linkHref)) continue;
            const blob = `${title} ${desc}`;
            const blobLower = blob.toLowerCase();
            let matchesActiveTeam = Boolean(teamMentionRe && teamMentionRe.test(blob));
            if (!matchesActiveTeam && gameDayMatchers) {
              for (const fn of gameDayMatchers.fullNames) {
                if (blobLower.includes(fn)) {
                  matchesActiveTeam = true;
                  break;
                }
              }
            }
            if (!matchesActiveTeam) continue;
            const ytUrl = `https://www.youtube.com/watch?v=${vidId}`;
            if (seenUrls.has(ytUrl)) continue;
            seenUrls.add(ytUrl);
            const pubRaw = (eb.match(/<published>([\s\S]*?)<\/published>/i) || [])[1] || '';
            const pubMs = pubRaw ? Date.parse(pubRaw) : nowEdgeMs;
            if (Number.isFinite(pubMs) && nowEdgeMs - pubMs > 72 * 3_600_000) continue;
            items.push({
              id: `yt_nfl_live_${vidId}`,
              type: 'video',
              videoId: vidId,
              title,
              summary: desc.slice(0, 220),
              url: ytUrl,
              externalVideoUrl: ytUrl,
              imageUrl: `https://i.ytimg.com/vi/${vidId}/hqdefault.jpg`,
              embeddable: false,
              isHighlightClip: true,
              isLiveGameHighlight: liveMode,
              outletId: 'nfl_official',
              outletName: 'NFL',
              reporterName: 'NFL',
              author: 'NFL',
              authorHandle: '@NFL',
              authorProfileUrl: 'https://www.youtube.com/@NFL',
              trustTier: 1,
              publishedAt: Number.isFinite(pubMs) ? new Date(Math.min(nowEdgeMs, pubMs)).toISOString() : new Date(nowEdgeMs).toISOString()
            });
          }
        }

        // 4a. Instant Live Game ESPN HD MP4 Highlight Clips (`summary.videos`) when `?event=<id>` is active
        if (Array.isArray(liveSummaryJson?.videos)) {
          for (const vid of liveSummaryJson.videos.slice(0, 12)) {
            const headline = decodeWorkerXml(vid?.headline || '');
            const mp4Raw = vid?.links?.source?.HD?.href || vid?.links?.source?.full?.href || vid?.links?.source?.href || '';
            const mp4Https = mp4Raw.startsWith('http://') ? `https://${mp4Raw.slice(7)}` : mp4Raw;
            const webRaw = vid?.links?.web?.href || mp4Https;
            const webHttps = webRaw.startsWith('http://') ? `https://${webRaw.slice(7)}` : webRaw;
            if (!headline || !mp4Https.startsWith('https://') || seenUrls.has(webHttps)) continue;
            seenUrls.add(webHttps);
            const durNum = Number(vid?.duration || 0);
            const durFmt = durNum > 0 ? `${Math.floor(durNum / 60)}:${String(Math.round(durNum % 60)).padStart(2, '0')}` : '';
            const thumbRaw = String(vid?.thumbnail || '');
            const thumbHttps = thumbRaw.startsWith('http://') ? `https://${thumbRaw.slice(7)}` : thumbRaw;
            items.push({
              id: `espn_hl_vid_${vid.id || items.length}`,
              type: 'video',
              title: headline,
              summary: decodeWorkerXml(vid?.description || '').slice(0, 220),
              url: webHttps,
              videoStreamUrl: mp4Https,
              isHighlightClip: true,
              isLiveGameHighlight: true,
              duration: durFmt || undefined,
              embeddable: true,
              imageUrl: thumbHttps.startsWith('https://') ? thumbHttps : '',
              publishedAt: vid?.lastModified || vid?.originalPublishDate || new Date(nowEdgeMs).toISOString(),
              outletId: 'espn',
              outletName: 'ESPN',
              author: 'ESPN',
              authorHandle: '@ESPNNFL',
              trustTier: 1
            });
          }
        }

        for (const a of espnNews?.articles || []) {
          if (!a?.headline || !a?.links?.web?.href || a.premium) continue;
          const teamCats = Array.isArray(a.categories) ? a.categories.filter(c => c?.type === 'team') : [];
          if (teamCats.length >= 6 && teamMentionRe && !teamMentionRe.test(`${a.headline} ${a.description || ''}`)) {
            continue;
          }
          if (seenUrls.has(a.links.web.href)) continue;
          seenUrls.add(a.links.web.href);
          items.push({
            id: `${team.abbr.toLowerCase()}_ew_${a.dataSourceIdentifier || a.id || ''}`,
            type: a.type === 'Media' ? 'video' : 'article',
            title: decodeWorkerXml(a.headline),
            summary: decodeWorkerXml(a.description || ''),
            url: a.links.web.href,
            imageUrl: pickBestWorkerImg(a.images),
            publishedAt: a.published || new Date().toISOString(),
            outletName: 'ESPN',
            author: decodeWorkerXml(a.byline || 'ESPN') || 'ESPN'
          });
        }

        // Parse Official Club News RSS into live wire
        for (const m of (rssXml || '').matchAll(/<item\b[\s\S]*?<\/item>/gi)) {
          if (items.length >= 45) break;
          const b = m[0];
          const title = decodeWorkerXml((b.match(/<title>([\s\S]*?)<\/title>/i) || [])[1] || '');
          const link = decodeWorkerXml((b.match(/<link>([\s\S]*?)<\/link>/i) || [])[1] || '');
          if (!title || !link || !/^https:\/\//i.test(link) || seenUrls.has(link)) continue;
          const summary = decodeWorkerXml((b.match(/<description>([\s\S]*?)<\/description>/i) || [])[1] || '').slice(0, 220);
          if (isPromotionalAdvertisement({ type: 'article', title, summary, url: link })) continue;
          seenUrls.add(link);
          const pubRaw = decodeWorkerXml((b.match(/<pubDate>([\s\S]*?)<\/pubDate>/i) || [])[1] || '');
          const img = ((b.match(/<media:content[^>]*url="([^"]+)"/i) || b.match(/<enclosure[^>]*url="([^"]+)"/i) || [])[1] || '').replace(/&amp;/g, '&');
          const pubMs = pubRaw ? Date.parse(pubRaw) : nowEdgeMs;
          items.push({
            id: `${team.abbr.toLowerCase()}_clubrss_${items.length}`,
            type: 'article',
            title,
            summary,
            url: link,
            imageUrl: /^https:\/\//i.test(img) ? img : '',
            publishedAt: Number.isFinite(pubMs) ? new Date(Math.min(nowEdgeMs, pubMs)).toISOString() : new Date().toISOString(),
            outletId: `${team.slug}_official`,
            outletName: `${team.clubDomain} Official`,
            author: `${team.clubDomain} Official`,
            trustTier: 1
          });
        }

        // Build exact club video duration map from official club video sitemap
        const clubVideoDurMap = new Map();
        for (const sm of (clubVideosSitemapXml || '').matchAll(/<url>([\s\S]*?)<\/url>/gi)) {
          const loc = (sm[1].match(/<loc>([^<]+)<\/loc>/i) || [])[1]?.trim();
          const sec = Number((sm[1].match(/<video:duration>(\d+)<\/video:duration>/i) || [])[1] || 0);
          const durStr = formatVideoDurationDisplay(sec);
          if (loc && durStr) clubVideoDurMap.set(loc.replace(/\/+$/, '').toLowerCase(), durStr);
        }

        // Parse Official Club Videos RSS into live wire (instant official TD & locker-room clips)
        for (const m of (clubVideosXml || '').matchAll(/<item\b[\s\S]*?<\/item>/gi)) {
          if (items.length >= 58) break;
          const b = m[0];
          const title = decodeWorkerXml((b.match(/<title>([\s\S]*?)<\/title>/i) || [])[1] || '');
          const link = decodeWorkerXml((b.match(/<link>([\s\S]*?)<\/link>/i) || [])[1] || '');
          if (!title || !link || !/^https:\/\//i.test(link) || seenUrls.has(link)) continue;
          const summary = decodeWorkerXml((b.match(/<description>([\s\S]*?)<\/description>/i) || [])[1] || '').slice(0, 220);
          if (isPromotionalAdvertisement({ type: 'video', title, summary, url: link })) continue;
          seenUrls.add(link);
          const pubRaw = decodeWorkerXml((b.match(/<pubDate>([\s\S]*?)<\/pubDate>/i) || [])[1] || '');
          const img = ((b.match(/<media:content[^>]*url="([^"]+)"/i) || b.match(/<media:thumbnail[^>]*url="([^"]+)"/i) || b.match(/<enclosure[^>]*url="([^"]+\.(?:jpg|jpeg|png|webp)[^"]*)"/i) || [])[1] || '').replace(/&amp;/g, '&');
          const pubMs = pubRaw ? Date.parse(pubRaw) : nowEdgeMs;
          const clubVidDur = clubVideoDurMap.get(link.replace(/\/+$/, '').toLowerCase()) || undefined;
          items.push({
            id: `${team.abbr.toLowerCase()}_clubvid_${items.length}`,
            type: 'video',
            title,
            summary,
            url: link,
            externalVideoUrl: link,
            duration: clubVidDur,
            embeddable: false,
            isHighlightClip: true,
            isLiveGameHighlight: liveMode,
            imageUrl: /^https:\/\//i.test(img) ? img : '',
            publishedAt: Number.isFinite(pubMs) ? new Date(Math.min(nowEdgeMs, pubMs)).toISOString() : new Date().toISOString(),
            outletId: `${team.slug}_official`,
            outletName: `${team.clubDomain} Official`,
            author: `${team.clubDomain} Video`,
            trustTier: 1
          });
        }

        // Parse Pro Football Rumors team feed into live wire
        for (const m of (pfrXml || '').matchAll(/<item\b[\s\S]*?<\/item>/gi)) {
          if (items.length >= 68) break;
          const b = m[0];
          const title = decodeWorkerXml((b.match(/<title>([\s\S]*?)<\/title>/i) || [])[1] || '');
          const link = decodeWorkerXml((b.match(/<link>([\s\S]*?)<\/link>/i) || [])[1] || '');
          if (!title || !link || !/^https:\/\//i.test(link) || seenUrls.has(link)) continue;
          const summary = decodeWorkerXml((b.match(/<description>([\s\S]*?)<\/description>/i) || [])[1] || '').slice(0, 220);
          if (isPromotionalAdvertisement({ type: 'article', title, summary, url: link })) continue;
          seenUrls.add(link);
          const pubRaw = decodeWorkerXml((b.match(/<pubDate>([\s\S]*?)<\/pubDate>/i) || [])[1] || '');
          const pubMs = pubRaw ? Date.parse(pubRaw) : nowEdgeMs;
          items.push({
            id: `${team.abbr.toLowerCase()}_pfrlive_${items.length}`,
            type: 'article',
            title,
            summary,
            url: link,
            imageUrl: '',
            publishedAt: Number.isFinite(pubMs) ? new Date(Math.min(nowEdgeMs, pubMs)).toISOString() : new Date().toISOString(),
            outletId: 'pfrumors',
            outletName: 'Pro Football Rumors',
            author: 'Pro Football Rumors',
            trustTier: 2
          });
        }

        // Harvest embedded X status URLs across ALL 32 clubs using the active club's own reporters + national insiders/film analysts
        const discoveredXStatusMap = new Map();
        const xStatusRe = /https?:\/\/(?:www\.|mobile\.)?(?:x|twitter)\.com\/([A-Za-z0-9_]{2,25})\/status\/(\d{15,22})/gi;
        const allowedTeamEmbeddedXHandles = new Set(WORKER_NATIONAL_HANDLE_SET);
        if (teamOfficialXHandle) allowedTeamEmbeddedXHandles.add(teamOfficialXHandle.toLowerCase());
        for (const spec of edgeFilmAndBeatXSpecs) {
          if (spec?.handle) allowedTeamEmbeddedXHandles.add(spec.handle.toLowerCase());
        }
        for (const r of Array.isArray(teamReportersJson?.reporters) ? teamReportersJson.reporters : []) {
          const rh = String(r?.handle || '').replace(/^@/, '').trim().toLowerCase();
          if (rh) allowedTeamEmbeddedXHandles.add(rh);
          for (const ha of Array.isArray(r?.handleAliases) ? r.handleAliases : []) {
            const ah = String(ha || '').replace(/^@/, '').trim().toLowerCase();
            if (ah) allowedTeamEmbeddedXHandles.add(ah);
          }
        }
        const scanXmlForX = rawXml => {
          if (!rawXml) return;
          for (const xm of String(rawXml).replace(/\\\//g, '/').matchAll(xStatusRe)) {
            const h = xm[1];
            const sid = xm[2];
            if (
              !/^(i|intent|share|hashtag|search)$/i.test(h) &&
              allowedTeamEmbeddedXHandles.has(h.toLowerCase()) &&
              !discoveredXStatusMap.has(sid)
            ) {
              discoveredXStatusMap.set(sid, h);
            }
          }
        };
        scanXmlForX(pfrXml);
        scanXmlForX(rssXml);

        sfExtraRssFeeds.forEach((src, sIdx) => {
          const xml = sfFeedXmls[sIdx] || '';
          if (!xml) return;
          scanXmlForX(xml);
          const blocks = xml.match(/<(?:item|entry)\b[\s\S]*?<\/(?:item|entry)>/gi) || [];
          for (const block of blocks.slice(0, 12)) {
            const title = decodeWorkerXml((block.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || '');
            const summary = decodeWorkerXml(
              (block.match(/<(?:description|summary|content)[^>]*>([\s\S]*?)<\/(?:description|summary|content)>/i) || [])[1] || ''
            ).slice(0, 240);
            const link = decodeWorkerXml(
              (block.match(/<link[^>]*href="([^"]+)"/i) || [])[1] ||
                (block.match(/<link>([\s\S]*?)<\/link>/i) || [])[1] ||
                ''
            );
            const pubRaw = decodeWorkerXml(
              (block.match(/<(?:pubDate|published|updated)>([\s\S]*?)<\/(?:pubDate|published|updated)>/i) || [])[1] || ''
            );
            const creator = decodeWorkerXml(
              (block.match(/<dc:creator[^>]*>([\s\S]*?)<\/dc:creator>/i) || [])[1] ||
                (block.match(/<author>[\s\S]*?<name>([^<]+)<\/name>/i) || [])[1] ||
                ''
            );
            const img = (
              (block.match(/<media:content[^>]*url="([^"]+)"/i) ||
                block.match(/<media:thumbnail[^>]*url="([^"]+)"/i) ||
                block.match(/<enclosure[^>]*url="([^"]+\.(?:jpg|jpeg|png|webp)[^"]*)"/i) ||
                [])[1] || ''
            ).replace(/&amp;/g, '&');
            if (!title || !/^https:\/\//i.test(link) || seenUrls.has(link)) continue;
            if (isPromotionalAdvertisement({ type: 'article', title, summary, url: link })) continue;
            if (src.sfOnly && teamMentionRe && !teamMentionRe.test(`${title} ${summary}`)) continue;
            seenUrls.add(link);
            const pubMs = pubRaw ? Date.parse(pubRaw) : nowEdgeMs;
            items.push({
              id: `sf_edge_${src.outletId}_${items.length}`,
              type: 'article',
              title,
              summary,
              url: link,
              imageUrl: /^https:\/\//i.test(img) && !/pixel|tracker|1x1|fb-og-image/i.test(img) ? img : '',
              publishedAt: Number.isFinite(pubMs) ? new Date(Math.min(nowEdgeMs, pubMs)).toISOString() : new Date().toISOString(),
              outletId: src.outletId,
              outletName: src.outletName,
              author: creator || src.outletName,
              trustTier: src.trustTier
            });
          }
        });

        // Hydrate up to 16 diverse newest X status tweets (max 3 per handle across ALL 32 teams!)
        if (discoveredXStatusMap.size > 0) {
          const sortedAllX = [...discoveredXStatusMap.entries()].sort((a, b) => (BigInt(b[0]) > BigInt(a[0]) ? 1 : -1));
          const handleCounts = new Map();
          const diverseXBatch = [];
          for (const entry of sortedAllX) {
            if (diverseXBatch.length >= 16) break;
            const hk = entry[1].toLowerCase();
            if ((handleCounts.get(hk) || 0) >= 3) continue;
            handleCounts.set(hk, (handleCounts.get(hk) || 0) + 1);
            diverseXBatch.push(entry);
          }
          await Promise.all(
            diverseXBatch.map(async ([sid, fallbackHandle]) => {
              try {
                const sr = await fetch(`https://cdn.syndication.twimg.com/tweet-result?id=${sid}&token=x`, {
                  signal: AbortSignal.timeout(3000)
                });
                if (!sr.ok) return;
                const syn = await sr.json();
                const txt = typeof syn?.text === 'string' ? normalizeMultilineSocialText(decodeHtmlEntities(syn.text)) : '';
                const synMedia = extractXSyndicationMedia(syn);
                if (!txt || txt.length < (synMedia.mp4Url || synMedia.imageUrl ? 6 : 16)) return;
                const synExpandedUrls = Array.isArray(syn?.entities?.urls)
                  ? syn.entities.urls.map(u => u?.expanded_url || '').filter(Boolean)
                  : [];
                if (isPromotionalAdvertisement({ type: 'tweet', title: txt, fullText: txt, expandedUrls: synExpandedUrls })) {
                  return;
                }
                const handle = syn.user?.screen_name || fallbackHandle;
                const bestMp4 = synMedia.mp4Url;
                const durMs = synMedia.durationMs;
                const durFmt =
                  !synMedia.isAnimatedGif && durMs >= 4000
                    ? `${Math.floor(durMs / 60000)}:${String(Math.round((durMs % 60000) / 1000)).padStart(2, '0')}`
                    : '';
                const thumb = synMedia.imageUrl || '';
                const snowMs = Number((BigInt(sid) >> 22n) + 1288834974657n);
                const postUrl = `https://x.com/${handle}/status/${sid}`;
                if (seenUrls.has(postUrl)) return;
                seenUrls.add(postUrl);
                const synInlineLinks = extractXEntityInlineLinks(syn?.entities, syn?.card);
                items.push({
                  id: `x_edge_${sid}`,
                  type: 'tweet',
                  title: txt.slice(0, 320),
                  fullText: txt,
                  url: postUrl,
                  ...(synInlineLinks.length > 0 ? { inlineLinks: synInlineLinks } : {}),
                  imageUrl: thumb.startsWith('https://') ? thumb : '',
                  ...(Array.isArray(synMedia.imageUrls) && synMedia.imageUrls.length > (bestMp4 ? 0 : 1)
                    ? { imageUrls: synMedia.imageUrls }
                    : {}),
                  videoStreamUrl: bestMp4 || undefined,
                  isAnimatedGif: synMedia.isAnimatedGif || undefined,
                  isHighlightClip: Boolean(bestMp4 && (synMedia.isAnimatedGif || durMs >= 4000 || durMs === 0)),
                  isLiveGameHighlight: Boolean(liveMode && bestMp4 && (synMedia.isAnimatedGif || durMs >= 4000 || durMs === 0)),
                  hasInlineChartImage: Boolean(synMedia.isPhoto || (synMedia.imageUrls && synMedia.imageUrls.length > 1)) || undefined,
                  duration: durFmt || undefined,
                  embeddable: true,
                  outletId: 'x_beat',
                  outletName: 'X Beat',
                  author: syn.user?.name ? decodeHtmlEntities(syn.user.name) : `@${handle}`,
                  authorHandle: `@${handle}`,
                  authorProfileUrl: `https://x.com/${handle}`,
                  publishedAt: new Date(Math.min(nowEdgeMs, snowMs)).toISOString()
                });
              } catch {}
            })
          );
        }

        return jsonResp(
          {
            ok: true,
            teamAbbr: team.abbr,
            liveMode,
            cacheTtlSec: edgeTtlSec,
            fetchedAt: new Date().toISOString(),
            clubRssAvailable: Boolean(rssXml && rssXml.includes('<item')),
            sourceDiag: {
              teamXStatus,
              nflXStatus,
              espnSummaryVideos: Array.isArray(liveSummaryJson?.videos) ? liveSummaryJson.videos.length : 0
            },
            items
          },
          200,
          cors
        );
      });
    }

    // 4b. Shortened URL Expander (0 KV writes — uses unlimited `caches.default` + 13-host allowlist + UTM strip)
    if (request.method === 'POST' && url.pathname === '/api/expand-urls') {
      const body = await request.json().catch(() => null);
      const rawUrls = Array.isArray(body?.urls) ? body.urls.slice(0, 12) : [];
      const expanded = {};
      const cache = typeof caches !== 'undefined' ? caches.default : null;
      await Promise.all(
        rawUrls.map(async u => {
          const clean = String(u || '').trim();
          let parsed = null;
          try {
            parsed = new URL(clean);
          } catch {
            return;
          }
          if (parsed.protocol !== 'https:' || !ALLOWED_SHORTENER_HOST_RE.test(parsed.hostname)) return;
          const cacheKey = cache
            ? new Request(`https://cache.internal/expand-url?u=${encodeURIComponent(clean)}`, { method: 'GET' })
            : null;
          if (cache && cacheKey) {
            try {
              const hit = await cache.match(cacheKey);
              if (hit) {
                const cachedUrl = await hit.text();
                if (cachedUrl && /^https:\/\//i.test(cachedUrl)) {
                  expanded[clean] = cachedUrl;
                  return;
                }
              }
            } catch {}
          }
          for (const method of ['HEAD', 'GET']) {
            try {
              const res = await fetch(clean, {
                method,
                redirect: 'follow',
                headers: { 'User-Agent': 'Mozilla/5.0 (compatible; NFLFaithfulBot/1.0)' },
                signal: AbortSignal.timeout(4000)
              });
              if (res?.url) {
                const dest = new URL(res.url.startsWith('http://') ? `https://${res.url.slice(7)}` : res.url);
                if (dest.protocol === 'https:' && !ALLOWED_SHORTENER_HOST_RE.test(dest.hostname.toLowerCase())) {
                  const resolved = stripEdgeTrackingParams(dest.toString());
                  expanded[clean] = resolved;
                  if (cache && cacheKey) {
                    await cache
                      .put(
                        cacheKey,
                        new Response(resolved, {
                          status: 200,
                          headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'public, max-age=86400' }
                        })
                      )
                      .catch(() => {});
                  }
                  break;
                }
              }
            } catch {}
          }
        })
      );
      return jsonResp({ ok: true, expanded }, 200, cors);
    }

    // 5. Short-TTL Edge-Cached Game-Day Inactives (0 KV writes! Canonical Club RSS + RotoWire + ESPN Core Roster)
    if (request.method === 'GET' && url.pathname === '/api/gameday-inactives') {
      return handleCachedEdgeGet(request, team.abbr, 120, async () => {
        const teamsParam = String(url.searchParams.get('teams') || team.abbr)
          .split(',')
          .map(s => normalizeAnyTeamAbbr(s.trim()))
          .filter(Boolean);
        const primaryAbbr = teamsParam[0] || team.abbr;
        const oppAbbr = teamsParam[1] && teamsParam[1] !== primaryAbbr ? teamsParam[1] : '';
        const targetTeams = [primaryAbbr, oppAbbr].filter(Boolean);
        const primaryTeam = getTeamByAbbr(primaryAbbr) || team;
        const oppTeam = oppAbbr ? getTeamByAbbr(oppAbbr) : null;
        const week = Number(url.searchParams.get('week') || 0) || null;
        const oppName = String(url.searchParams.get('oppName') || oppTeam?.fullName || '').slice(0, 48);
        const gameId = String(url.searchParams.get('gameId') || '').trim();
        const kickoffMsParam = Number(url.searchParams.get('kickoffMs') || 0) || 0;

        const [injJson, rotoHtml, ...clubRssXmls] = await Promise.all([
          fetch(`https://site.api.espn.com/apis/site/v2/sports/football/nfl/injuries?team=${primaryTeam.espnId}`, {
            signal: AbortSignal.timeout(5500)
          })
            .then(r => (r.ok ? r.json() : null))
            .catch(() => null),
          fetch('https://www.rotowire.com/football/inactives.php', {
            signal: AbortSignal.timeout(5500),
            headers: { 'User-Agent': 'Mozilla/5.0 (compatible; NFLFaithfulBot/1.0)' }
          })
            .then(r => (r.ok ? r.text() : ''))
            .catch(() => ''),
          ...targetTeams.map(abbr => {
            const rssUrl = NFL_TEAM_OFFICIAL_RSS_URLS[abbr];
            if (!rssUrl) return Promise.resolve('');
            return fetch(rssUrl, {
              headers: { 'User-Agent': 'NFLFaithfulEdge/1.0' },
              signal: AbortSignal.timeout(5000)
            })
              .then(r => (r.ok ? r.text() : ''))
              .catch(() => '');
          })
        ]);

        const rwByTeam = parseRotoWireInactivesHtml(rotoHtml, targetTeams);
        const discoveredByTeam = {};
        const sourceUrlByTeam = {};
        targetTeams.forEach((abbr, idx) => {
          const discovered = discoverOfficialClubInactivesRssItem(clubRssXmls[idx] || '', {
            kickoffMs: kickoffMsParam,
            week
          });
          if (discovered?.url) {
            discoveredByTeam[abbr] = discovered;
            sourceUrlByTeam[abbr] = discovered.url;
          }
        });

        const clubParsedByTeam = {};
        await Promise.all(
          targetTeams.map(async abbr => {
            const disc = discoveredByTeam[abbr];
            if (!disc?.url) return;
            let artHtml = '';
            try {
              const artRes = await fetch(disc.url, {
                headers: { 'User-Agent': 'Mozilla/5.0 (compatible; NFLFaithfulEdge/1.0)' },
                signal: AbortSignal.timeout(5000)
              });
              if (artRes.ok) artHtml = await artRes.text();
            } catch {}
            const parseSource = artHtml || disc.inlineHtml || disc.description || '';
            if (!parseSource) return;
            const tCfg = abbr === primaryAbbr ? primaryTeam : oppTeam;
            const parsed = parseOfficialClubInactivesArticle(parseSource, [], {
              week,
              teamAbbr: abbr,
              teamName: tCfg?.fullName || (abbr === oppAbbr ? oppName : '')
            });
            if (parsed.officialPosted) {
              clubParsedByTeam[abbr] = parsed;
            }
          })
        );

        const buildTeamInactivesPayload = abbr => {
          const tCfg = abbr === primaryAbbr ? primaryTeam : oppTeam;
          const clubLabel = abbr === 'SF' ? '49ers.com Official' : `${abbr} Official`;
          let list = [];
          let activeNames = [];
          let emergencyQbNames = [];
          let sourceRank = 0;
          let sourceLabel = 'RotoWire NFL Inactives';
          if (clubParsedByTeam[abbr]?.inactives?.length >= 3) {
            list = clubParsedByTeam[abbr].inactives;
            emergencyQbNames = list
              .filter(p =>
                clubParsedByTeam[abbr].emergencyQbKeys?.has(
                  String(p.name || '').toLowerCase().replace(/[^a-z0-9]/g, '')
                )
              )
              .map(p => p.name);
            sourceRank = 4;
            sourceLabel = clubLabel;
          } else if ((rwByTeam[abbr] || []).length >= 3) {
            list = rwByTeam[abbr];
            sourceRank = 3;
            sourceLabel = sourceUrlByTeam[abbr] ? clubLabel : 'RotoWire NFL Inactives';
          }
          return {
            teamAbbr: abbr,
            teamName: tCfg?.fullName || '',
            officialPosted: list.length >= 3,
            sourceRank,
            inactives: list,
            activeNames,
            emergencyQbNames,
            sourceUrl: sourceUrlByTeam[abbr] || 'https://www.rotowire.com/football/inactives.php',
            sourceLabel
          };
        };

        const primaryOut = buildTeamInactivesPayload(primaryAbbr);
        const oppOut = oppAbbr ? buildTeamInactivesPayload(oppAbbr) : null;

        // Authoritative ESPN Core Event Competitor Roster enrichment (47/48 active list + inactives fallback)
        if (/^\d{6,12}$/.test(gameId)) {
          await Promise.all(
            targetTeams.map(async abbr => {
              const tid = ESPN_NFL_TEAM_IDS[abbr];
              if (!tid) return;
              try {
                const eUrl = `https://sports.core.api.espn.com/v2/sports/football/leagues/nfl/events/${encodeURIComponent(gameId)}/competitions/${encodeURIComponent(gameId)}/competitors/${tid}/roster`;
                const eRes = await fetch(eUrl, {
                  headers: { 'User-Agent': 'NFLFaithfulEdge/1.0' },
                  signal: AbortSignal.timeout(2200)
                });
                if (!eRes.ok) return;
                const eJson = await eRes.json();
                const parsed = parseEspnCoreEventRosterInactives(eJson, []);
                if (!parsed.officialPosted) return;
                const slot = abbr === primaryAbbr ? primaryOut : oppOut;
                if (!slot) return;
                if (parsed.activeNames?.length >= 44) {
                  slot.activeNames = parsed.activeNames;
                }
                if (slot.inactives.length < 3) {
                  slot.inactives = parsed.inactives;
                  slot.officialPosted = parsed.inactives.length >= 3;
                  slot.sourceRank = 3;
                  slot.sourceLabel = 'ESPN Official Game Roster';
                }
              } catch {}
            })
          );
        }

        return jsonResp(
          {
            ok: true,
            teamAbbr: primaryTeam.abbr,
            oppAbbr: oppTeam?.abbr || '',
            fetchedAt: new Date().toISOString(),
            sf: primaryOut,
            opp: oppOut,
            injuries: injJson?.injuries || []
          },
          200,
          cors
        );
      });
    }

    // 6. Allowlisted Inline MP4 Video Relay (Referer-free + post-redirect SSRF guard + explicit headers)
    if ((request.method === 'GET' || request.method === 'HEAD') && url.pathname === '/api/video-stream') {
      const target = String(url.searchParams.get('url') || '').trim();
      if (!isAllowedInlineVideoStreamUrl(target)) {
        return jsonResp({ error: 'Video host not allowlisted' }, 403, cors);
      }
      try {
        const upstream = await fetch(target, {
          method: request.method,
          headers: request.headers.get('Range') ? { Range: request.headers.get('Range') } : {},
          redirect: 'follow',
          signal: AbortSignal.timeout(12000)
        });
        if (upstream.url && !isAllowedInlineVideoStreamUrl(upstream.url)) {
          return jsonResp({ error: 'Redirected video host not allowlisted' }, 403, cors);
        }
        const headers = new Headers(cors);
        headers.set('Content-Type', upstream.headers.get('Content-Type') || 'video/mp4');
        headers.set('Accept-Ranges', upstream.headers.get('Accept-Ranges') || 'bytes');
        headers.set('Cross-Origin-Resource-Policy', 'cross-origin');
        headers.set('Cache-Control', 'public, max-age=86400');
        for (const h of ['Content-Length', 'Content-Range', 'ETag', 'Last-Modified']) {
          const val = upstream.headers.get(h);
          if (val) headers.set(h, val);
        }
        return new Response(request.method === 'HEAD' ? null : upstream.body, {
          status: upstream.status,
          headers
        });
      } catch {
        return jsonResp({ error: 'Video stream upstream unreachable' }, 502, cors);
      }
    }

    // 7. Team-Scoped Daily Top-News Brief (GET + POST with atomic KV lock, 72h TTL, latest fallback & SF Priority #0 Quota Gate)
    if (url.pathname === '/api/daily-news-brief') {
      if (ctx && typeof ctx.waitUntil === 'function') {
        ctx.waitUntil(trackActiveTeamVisit(env, team));
      }
      const noStoreHeaders = { 'Cache-Control': 'no-store' };
      const latestKvKey = `daily_news_brief_latest_v7:${team.abbr}`;
      const briefTtlSec = 60 * 60 * 72; // 72h survives full SNF/MNF game-day hold without expiring mid-game
      if (request.method === 'GET') {
        const cycleKey = String(url.searchParams.get('cycleKey') || new Date().toISOString().slice(0, 10)).replace(
          /[^A-Za-z0-9@_-]/g,
          ''
        );
        const allowLatest = url.searchParams.get('allowLatest') === '1';
        const kvKey = `daily_news_brief_v7:${team.abbr}:${cycleKey}`;
        const existing = await env.SHARED_CACHE?.get(kvKey, 'json');
        if (existing && !hasCrossTeam49ersLeak(existing.rawText || JSON.stringify(existing.data || ''), team)) {
          return jsonResp({ cached: true, teamAbbr: team.abbr, ...existing }, 200, cors, noStoreHeaders);
        }
        if (allowLatest) {
          const latest = await env.SHARED_CACHE?.get(latestKvKey, 'json');
          if (latest && !hasCrossTeam49ersLeak(latest.rawText || JSON.stringify(latest.data || ''), team)) {
            return jsonResp(
              { cached: true, latestFallback: true, teamAbbr: team.abbr, ...latest },
              200,
              cors,
              noStoreHeaders
            );
          }
        }
        return jsonResp({ cached: false, teamAbbr: team.abbr, cycleKey, rawText: '' }, 200, cors, noStoreHeaders);
      }

      if (request.method === 'POST') {
        const rawBodyText = await request.text().catch(() => '');
        if (rawBodyText.length > 64_000) {
          return jsonResp({ error: 'Daily news brief payload too large' }, 413, cors, noStoreHeaders);
        }
        let body = null;
        try {
          body = rawBodyText ? JSON.parse(rawBodyText) : null;
        } catch {}
        if (!body || (!body.prompt && !body.seedData && !body.seedRawText)) {
          return jsonResp({ error: 'Invalid daily news brief payload' }, 400, cors, noStoreHeaders);
        }
        const cycleKey = String(body.cycleKey || new Date().toISOString().slice(0, 10)).replace(/[^A-Za-z0-9@_-]/g, '');
        const kvKey = `daily_news_brief_v7:${team.abbr}:${cycleKey}`;
        const existing = await env.SHARED_CACHE?.get(kvKey, 'json');
        if (
          existing &&
          !body.forceRefresh &&
          !hasCrossTeam49ersLeak(existing.rawText || JSON.stringify(existing.data || ''), team)
        ) {
          return jsonResp({ cached: true, teamAbbr: team.abbr, ...existing }, 200, cors, noStoreHeaders);
        }

        if ((body.seedData || body.seedRawText) && !body.prompt) {
          const validSeedData =
            body.seedData &&
            typeof body.seedData === 'object' &&
            !Array.isArray(body.seedData) &&
            typeof body.seedData.headline === 'string' &&
            body.seedData.headline.trim().length > 0 &&
            Array.isArray(body.seedData.bullets) &&
            body.seedData.bullets.length >= 2
              ? body.seedData
              : null;
          const cleanSeedRawText =
            typeof body.seedRawText === 'string' ? body.seedRawText.trim().slice(0, 16000) : '';
          if (!validSeedData && !cleanSeedRawText) {
            return jsonResp({ error: 'Invalid daily news brief seed payload' }, 400, cors, noStoreHeaders);
          }
          const seedCheckText = `${cleanSeedRawText} ${JSON.stringify(validSeedData || '')}`;
          if (hasCrossTeam49ersLeak(seedCheckText, team)) {
            return jsonResp({ error: 'Rejected cross-team contamination in daily brief seed' }, 422, cors, noStoreHeaders);
          }
          const seeded = {
            teamAbbr: team.abbr,
            cycleKey,
            modelUsed: String(body.modelUsed || PRIMARY_GEMINI_REASONING_MODEL).slice(0, 64),
            generatedAt: String(body.generatedAt || new Date().toISOString()).slice(0, 40),
            rawText: cleanSeedRawText,
            data: validSeedData
          };
          const serializedSeed = JSON.stringify(seeded);
          if (serializedSeed.length > 32_000) {
            return jsonResp({ error: 'Daily news brief seed exceeds size cap' }, 413, cors, noStoreHeaders);
          }
          await Promise.all([
            env.SHARED_CACHE?.put(kvKey, serializedSeed, { expirationTtl: briefTtlSec }),
            env.SHARED_CACHE?.put(latestKvKey, serializedSeed, { expirationTtl: briefTtlSec })
          ]);
          return jsonResp({ cached: false, seeded: true, ...seeded }, 200, cors, noStoreHeaders);
        }

        const forwarded = await maybeForwardHubAiPost(request, url, env, rawBodyText, cors);
        if (forwarded) return forwarded;

        const lockKey = `lock:brief:${team.abbr}:${cycleKey}`;
        const existingLock = await env.SHARED_CACHE?.get(lockKey);
        if (existingLock) {
          return jsonResp({ cached: false, inFlight: true, teamAbbr: team.abbr, cycleKey }, 202, cors, noStoreHeaders);
        }
        await env.SHARED_CACHE?.put(lockKey, '1', { expirationTtl: 120 });

        try {
          const quota = await checkAndReserveDailyQuota(env, team);
          if (!quota.allowed) {
            return jsonResp({ error: 'Daily league quota reserved for priority teams', ...quota }, 429, cors, noStoreHeaders);
          }
          const editorialSystem = buildTeamEditorialSystemPrompt(team);
          const clientSystem = String(body.systemPrompt || '').slice(0, 8000);
          const effectiveSystem = clientSystem ? `${editorialSystem}\n\n${clientSystem}` : editorialSystem;
          const gen = await callGeminiSinglePass(env, {
            systemPrompt: effectiveSystem,
            userPrompt: String(body.prompt).slice(0, 24000),
            thinkingLevel: 'XHIGH',
            useGoogleSearch: true,
            pool: 'premier',
            team
          });
          if (!gen.ok) return jsonResp({ error: gen.error }, gen.status || 502, cors, noStoreHeaders);
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
            const serializedOut = JSON.stringify(payloadOut);
            await Promise.all([
              env.SHARED_CACHE?.put(kvKey, serializedOut, { expirationTtl: briefTtlSec }),
              env.SHARED_CACHE?.put(latestKvKey, serializedOut, { expirationTtl: briefTtlSec })
            ]);
          }
          return jsonResp({ cached: false, ...payloadOut }, 200, cors, noStoreHeaders);
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
          useGoogleSearch: true,
          pool: 'premier',
          team
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

    // Never let unmatched `/api/*` paths fall through to static SPA HTML (`200 OK` HTML breaks JSON callers)
    if (url.pathname.startsWith('/api/')) {
      return jsonResp({ error: 'Not Found' }, 404, cors);
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
          headers.set('Cache-Control', 'public, max-age=0, must-revalidate');
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
