/**
 * Unified Adaptive Two-Pool Gemini Model Discovery & Quota Manager
 *
 * Shared pure ES module used identically by:
 *   - Node.js 32-Team Data Pipeline (`scripts/lib/aiSynthesisEngine.mjs`, `scripts/fetch-live-data.mjs`)
 *   - Cloudflare Edge Worker (`worker/nfl-teams-worker.js` — all 32 `<team>.joshal.com` + `nfl.joshal.com`)
 *
 * Design Guarantees (Zero Hard-Coded Static Trees, Zero RPM/TPM/RPD/TPD Redlining):
 * 1. Periodic Live Catalog Polling (`GET /v1beta/models`, default every 24h):
 *    Automatically detects newly released models (e.g. `gemini-3.6-flash`, future distilled frontier
 *    models, or `gemini-4-hydrogen-flash-lite`) and prunes deprecated / `HTTP 404` models (e.g. `gemini-2.5-flash`).
 * 2. Two-Pool Architecture:
 *    - Pool 1 (`premier`): High-reasoning editorial models (`gemini-4-hydrogen`, `gemini-3.8-flash`,
 *      `gemini-3.6-flash`, `gemini-3-flash-preview`, etc.) reserved strictly for Daily Top News Briefs
 *      and Daily Matchup Intel.
 *    - Pool 2 (`lite`): High-volume utility models (`gemini-3.5-flash-lite`, `gemini-3.1-flash-lite`, etc.,
 *      500 RPD / 15 RPM each) for lightweight tasks (2-sentence Cap Notes, structured extraction, etc.).
 * 3. SF-First Early-Degradation Reserve (Adaptive, Not Hard-Coded):
 *    49ers (`SF`) runs first and reserves `sfPremierReservedCalls` (default 6 on Pool 1 #1, 3 on Pool 1 #2,
 *    scaled dynamically to each model's RPD cap). Non-SF clubs automatically degrade early to the next
 *    best model once `usedRpd >= safeRpd - reserved`, guaranteeing SF always retains top-tier tokens
 *    for later-day post-game briefs and matchup intel.
 * 4. 4-Gate Rate-Limit Protection:
 *    Enforces sliding 60s RPM staggering (`<=80%` RPM, e.g. `<=4 RPM` on 5-RPM models), sliding 60s TPM
 *    (`<=80%` TPM, e.g. `<=200K / 250K`), daily PT-midnight RPD safety ceilings, and daily TPD soft caps.
 * 5. Automatic Search-Grounding 429 Circuit-Breaker:
 *    Detects when free-tier `tools: [{ google_search: {} }]` returns `HTTP 429` while direct (`search=false`)
 *    succeeds `HTTP 200`, automatically skipping wasted search retries for the rest of the PT day
 *    (eliminating 2x RPM/RPD burn) and re-testing cleanly after midnight PT.
 */

export const DEFAULT_GEMINI_QUOTA_CONFIG = Object.freeze({
  catalogRefreshIntervalHours: 24,
  deprecatedQuarantineDays: 7,
  sfPremierReservedCalls: 6,
  sfSecondaryReservedCalls: 3,
  sfLiteReservedCalls: 20,
  rpmSafetyRatio: 0.8,
  tpmSafetyRatio: 0.8,
  premierRpdBuffer: 1,
  liteRpdBuffer: 10,
  tierLimits: Object.freeze({
    premier: Object.freeze({
      rpmLimit: 5,
      tpmLimit: 250_000,
      rpdLimit: 20,
      tpdLimit: 450_000
    }),
    liteHighQuota: Object.freeze({
      rpmLimit: 15,
      tpmLimit: 250_000,
      rpdLimit: 500,
      tpdLimit: 4_000_000
    }),
    liteLegacy: Object.freeze({
      rpmLimit: 10,
      tpmLimit: 250_000,
      rpdLimit: 20,
      tpdLimit: 450_000
    })
  }),
  modelOverrides: Object.freeze({})
});

export const DEFAULT_PREMIER_FALLBACK_MODELS = Object.freeze([
  'gemini-4-hydrogen',
  'gemini-3.8-flash',
  'gemini-3.6-flash',
  'gemini-3-flash-preview'
]);

export const DEFAULT_LITE_FALLBACK_MODELS = Object.freeze([
  'gemini-3.5-flash-lite',
  'gemini-3.1-flash-lite'
]);

export function getQuotaPacificDateKey(nowMs = Date.now()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Los_Angeles',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(new Date(nowMs));
  const get = type => parts.find(p => p.type === type)?.value || '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

export function estimateGeminiCallTokens(promptText = '', systemPrompt = '', maxOutputTokens = 2048) {
  const inputChars = String(promptText || '').length + String(systemPrompt || '').length;
  const estInput = Math.max(64, Math.ceil(inputChars / 3.8));
  const estOutput = Math.max(128, Number(maxOutputTokens) || 2048);
  return estInput + estOutput;
}

const EXCLUDED_NON_TEXT_MODEL_RE =
  /\b(tts|audio|imagen|image|veo|video|embedding|aqa|vision|robotics|computer-use|learnlm|gemma|nano|customtools|thinking|live|omni|transcribe|translate|decision|lyria|genie|antigravity)\b/i;

const ZERO_QUOTA_PAID_ONLY_MODEL_RE =
  /\b(carbon|argon|neon)\b|^gemini-3\.1-pro|^gemini-3-pro|^gemini-2\.5-pro|^gemini-2\.5-flash-preview-\d|^gemini-2\.0-|^gemini-2-flash/i;

export function parseGeminiModelVersion(modelId = '') {
  const id = String(modelId || '').replace(/^models\//i, '').trim().toLowerCase();
  const verMatch = id.match(/^gemini-(\d+(?:\.\d+)?)/);
  if (verMatch) return parseFloat(verMatch[1]);
  if (/\bhydrogen\b/.test(id)) return 4.0;
  return 0;
}

export function isLiteGeminiModel(modelId = '') {
  const id = String(modelId || '').replace(/^models\//i, '').trim().toLowerCase();
  return /\b(?:flash-lite|lite|8b)\b/.test(id);
}

/**
 * Dynamically classifies and scores ANY Gemini catalog entry into Pool 1 (`premier`)
 * or Pool 2 (`lite`) so newly added frontier, distilled, or flash-lite models automatically
 * slot into the right logical tree without hardcoding model names.
 */
export function classifyAndScoreCatalogModel(modelEntryOrId) {
  const rawName =
    typeof modelEntryOrId === 'string'
      ? modelEntryOrId
      : String(modelEntryOrId?.name || modelEntryOrId?.id || '');
  const id = rawName.replace(/^models\//i, '').trim().toLowerCase();
  if (!id.startsWith('gemini-')) return null;
  if (EXCLUDED_NON_TEXT_MODEL_RE.test(id)) return null;
  if (ZERO_QUOTA_PAID_ONLY_MODEL_RE.test(id)) return null;
  if (/-latest$/i.test(id)) return null;

  if (
    typeof modelEntryOrId === 'object' &&
    modelEntryOrId !== null &&
    Array.isArray(modelEntryOrId.supportedGenerationMethods) &&
    !modelEntryOrId.supportedGenerationMethods.includes('generateContent')
  ) {
    return null;
  }

  const versionNum = parseGeminiModelVersion(id);
  if (!Number.isFinite(versionNum) || versionNum < 2.5) return null;

  const isLite = isLiteGeminiModel(id);
  const isHydrogen = /\bhydrogen\b/.test(id);
  const isDistilled = /\bdistill/.test(id);
  const isFlash = /\bflash\b/.test(id);
  const isPro = /\bpro\b/.test(id);
  const isPreviewOrExp = /\b(preview|exp)\b/.test(id);
  const stabilityBonus = id.includes('exp') ? -18 : isPreviewOrExp ? -6 : 10;

  if (isLite) {
    // Pool 2: Flash-Lite models (`gemini-4-hydrogen-flash-lite` > `3.5-flash-lite` > `3.1-flash-lite` > `2.5-flash-lite`)
    const familyBonus = isHydrogen ? 120 : isDistilled ? 80 : 40;
    const score = Math.round(versionNum * 100) + familyBonus + stabilityBonus;
    return { id, pool: 'lite', versionNum, score };
  }

  if (!isHydrogen && !isDistilled && !isFlash && !(isPro && versionNum >= 3.8)) {
    return null;
  }

  // Pool 1: Premier high-reasoning editorial models
  const familyBonus = isHydrogen ? 360 : isDistilled ? 320 : isFlash ? 285 : 270;
  const score = Math.round(versionNum * 100) + familyBonus + stabilityBonus;
  return { id, pool: 'premier', versionNum, score };
}

/**
 * Rebuilds Pool 1 (`premier`) and Pool 2 (`lite`) ranked model lists from a live `/v1beta/models`
 * catalog, automatically pruning quarantined/deprecated (`HTTP 404`) models.
 */
export function buildDynamicGeminiPoolsFromCatalog(
  catalogModels = [],
  { state = null, nowMs = Date.now(), config = DEFAULT_GEMINI_QUOTA_CONFIG } = {}
) {
  const deprecated = state?.deprecatedModels || {};
  const isDeprecated = id => Number(deprecated[id] || 0) > nowMs;

  const premierScored = new Map();
  const liteScored = new Map();

  const ingest = entry => {
    const cls = classifyAndScoreCatalogModel(entry);
    if (!cls || isDeprecated(cls.id)) return;
    const target = cls.pool === 'lite' ? liteScored : premierScored;
    target.set(cls.id, Math.max(target.get(cls.id) || 0, cls.score));
  };

  const hasLiveCatalog = Array.isArray(catalogModels) && catalogModels.length > 0;
  if (hasLiveCatalog) {
    for (const entry of catalogModels) ingest(entry);
  } else {
    for (const id of DEFAULT_PREMIER_FALLBACK_MODELS) ingest(id);
    for (const id of DEFAULT_LITE_FALLBACK_MODELS) ingest(id);
  }

  // Ensure non-empty fallback safety if live catalog returned empty/filtered everything
  if (premierScored.size === 0) {
    for (const id of DEFAULT_PREMIER_FALLBACK_MODELS) {
      if (!isDeprecated(id)) {
        const cls = classifyAndScoreCatalogModel(id);
        if (cls) premierScored.set(cls.id, cls.score);
      }
    }
  }
  if (liteScored.size === 0) {
    for (const id of DEFAULT_LITE_FALLBACK_MODELS) {
      if (!isDeprecated(id)) {
        const cls = classifyAndScoreCatalogModel(id);
        if (cls) liteScored.set(cls.id, cls.score);
      }
    }
  }

  // Exclude models explicitly disabled via config.modelOverrides[id].rpdLimit === 0
  const overrides = config?.modelOverrides || {};
  const sortEntries = map =>
    [...map.entries()]
      .filter(([id]) => overrides[id]?.rpdLimit !== 0)
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([id]) => id);

  return {
    premier: sortEntries(premierScored),
    lite: sortEntries(liteScored),
    fromLiveCatalog: hasLiveCatalog
  };
}

/**
 * Resolves adaptable per-model RPM/TPM/RPD/TPD limits dynamically from tier heuristics,
 * empirical 429-learned caps, and optional config overrides (zero hardcoded model-specific caps).
 */
export function resolveModelLimits(modelId = '', { config = DEFAULT_GEMINI_QUOTA_CONFIG, state = null } = {}) {
  const id = String(modelId || '').replace(/^models\//i, '').trim().toLowerCase();
  const isLite = isLiteGeminiModel(id);
  const ver = parseGeminiModelVersion(id);
  const tierKey = isLite ? (ver >= 3.1 ? 'liteHighQuota' : 'liteLegacy') : 'premier';
  const base = config?.tierLimits?.[tierKey] || DEFAULT_GEMINI_QUOTA_CONFIG.tierLimits[tierKey];
  const override = config?.modelOverrides?.[id] || {};
  const learnedRpd = Number(state?.learnedRpdCaps?.[id] || 0);

  const rpdLimit =
    Number.isFinite(Number(override.rpdLimit)) && Number(override.rpdLimit) >= 0
      ? Number(override.rpdLimit)
      : learnedRpd > 0
        ? Math.min(base.rpdLimit, learnedRpd)
        : base.rpdLimit;
  const rpmLimit = Number(override.rpmLimit) > 0 ? Number(override.rpmLimit) : base.rpmLimit;
  const tpmLimit = Number(override.tpmLimit) > 0 ? Number(override.tpmLimit) : base.tpmLimit;
  const tpdLimit = Number(override.tpdLimit) > 0 ? Number(override.tpdLimit) : base.tpdLimit;

  const rpmRatio = Number(config?.rpmSafetyRatio) || 0.8;
  const tpmRatio = Number(config?.tpmSafetyRatio) || 0.8;
  const rpdBuffer = isLite ? Number(config?.liteRpdBuffer ?? 10) : Number(config?.premierRpdBuffer ?? 1);

  const safeRpm = Math.max(1, Math.floor(rpmLimit * rpmRatio));
  const safeTpm = Math.max(10_000, Math.floor(tpmLimit * tpmRatio));
  const safeRpd = rpdLimit <= 0 ? 0 : Math.max(1, rpdLimit - Math.min(rpdBuffer, Math.max(0, rpdLimit - 1)));
  const minSpacingMs = Math.ceil(60_000 / safeRpm);

  return {
    modelId: id,
    pool: isLite ? 'lite' : 'premier',
    rpmLimit,
    tpmLimit,
    rpdLimit,
    tpdLimit,
    safeRpm,
    safeTpm,
    safeRpd,
    minSpacingMs
  };
}

/**
 * Creates or normalizes a persistent Gemini quota & catalog state object,
 * resetting daily RPD/TPD/exhausted/search counters cleanly at midnight PT.
 */
export function normalizeGeminiQuotaState(rawState = null, nowMs = Date.now()) {
  const datePt = getQuotaPacificDateKey(nowMs);
  const sameDay = String(rawState?.datePt || '') === datePt;

  const prevDep = rawState?.deprecatedModels && typeof rawState.deprecatedModels === 'object'
    ? rawState.deprecatedModels
    : {};
  const deprecatedModels = {};
  for (const [m, untilMs] of Object.entries(prevDep)) {
    if (Number(untilMs) > nowMs) deprecatedModels[m] = Number(untilMs);
  }

  const prevLearned = rawState?.learnedRpdCaps && typeof rawState.learnedRpdCaps === 'object'
    ? rawState.learnedRpdCaps
    : {};

  const prevUsage = sameDay && rawState?.dailyUsage && typeof rawState.dailyUsage === 'object'
    ? rawState.dailyUsage
    : {};
  const dailyUsage = {};
  for (const [m, u] of Object.entries(prevUsage)) {
    if (!u || typeof u !== 'object') continue;
    dailyUsage[m] = {
      requests: Math.max(0, Number(u.requests) || 0),
      tokens: Math.max(0, Number(u.tokens) || 0),
      exhausted: Boolean(u.exhausted),
      sfRequests: Math.max(0, Number(u.sfRequests) || 0)
    };
  }

  const prevRecent = Array.isArray(rawState?.recentWindow) ? rawState.recentWindow : [];
  const windowCutoff = nowMs - 65_000;
  const recentWindow = prevRecent.filter(e => e && Number(e.ts) >= windowCutoff && e.model);

  return {
    version: 2,
    datePt,
    catalogUpdatedAtMs: Number(rawState?.catalogUpdatedAtMs) || 0,
    pools: {
      premier: Array.isArray(rawState?.pools?.premier) && rawState.pools.premier.length > 0
        ? [...rawState.pools.premier]
        : [...DEFAULT_PREMIER_FALLBACK_MODELS],
      lite: Array.isArray(rawState?.pools?.lite) && rawState.pools.lite.length > 0
        ? [...rawState.pools.lite]
        : [...DEFAULT_LITE_FALLBACK_MODELS]
    },
    deprecatedModels,
    learnedRpdCaps: { ...prevLearned },
    searchGroundingDisabledDatePt:
      String(rawState?.searchGroundingDisabledDatePt || '') === datePt ? datePt : '',
    dailyUsage,
    recentWindow
  };
}

export function isSearchGroundingAllowed(state, nowMs = Date.now()) {
  const datePt = getQuotaPacificDateKey(nowMs);
  return String(state?.searchGroundingDisabledDatePt || '') !== datePt;
}

export function markSearchGroundingUnavailableToday(state, nowMs = Date.now()) {
  if (!state) return;
  state.searchGroundingDisabledDatePt = getQuotaPacificDateKey(nowMs);
}

/**
 * Computes the adaptive SF priority reservation for a model at `rankIndex` inside its pool.
 * Never hard-coded: scales dynamically with both `rpdLimit` and configurable `sfPremierReservedCalls`.
 */
export function computePriorityReservationForModel(
  pool = 'premier',
  rankIndex = 0,
  limits = null,
  config = DEFAULT_GEMINI_QUOTA_CONFIG
) {
  if (!limits || limits.safeRpd <= 0) return 0;
  if (pool === 'lite') {
    if (rankIndex !== 0) return 0;
    return Math.min(Math.floor(limits.safeRpd * 0.15), Number(config?.sfLiteReservedCalls) || 20);
  }
  if (rankIndex === 0) {
    return Math.min(Math.floor(limits.rpdLimit * 0.4), Number(config?.sfPremierReservedCalls) || 6);
  }
  if (rankIndex === 1) {
    return Math.min(
      Math.floor(limits.rpdLimit * 0.25),
      Number(config?.sfSecondaryReservedCalls) || Math.ceil((Number(config?.sfPremierReservedCalls) || 6) / 2)
    );
  }
  return 0;
}

/**
 * Selects the best available model from Pool 1 (`premier`) or Pool 2 (`lite`) while strictly enforcing:
 *   1. SF-first early degradation (non-SF teams degrade early so SF retains top-tier tokens)
 *   2. Daily RPD safety ceiling
 *   3. Daily TPD safety ceiling
 *   4. Sliding 60-second RPM & TPM ceilings (with exact `waitMs` staggering if all eligible models need cooldown)
 */
export function selectBestAvailableModel(
  rawState,
  {
    pool = 'premier',
    isPriorityTeam = false,
    estimatedTokens = 10_000,
    nowMs = Date.now(),
    config = DEFAULT_GEMINI_QUOTA_CONFIG,
    allowPoolFallbackToLite = false,
    preferredModels = null
  } = {}
) {
  const state = normalizeGeminiQuotaState(rawState, nowMs);
  const baseList =
    Array.isArray(preferredModels) && preferredModels.length > 0
      ? preferredModels.filter(m => !(Number(state.deprecatedModels[m] || 0) > nowMs))
      : [...(state.pools?.[pool] || (pool === 'lite' ? DEFAULT_LITE_FALLBACK_MODELS : DEFAULT_PREMIER_FALLBACK_MODELS))];

  const candidateSequence =
    allowPoolFallbackToLite && pool === 'premier'
      ? [...baseList, ...(state.pools?.lite || DEFAULT_LITE_FALLBACK_MODELS).filter(m => !baseList.includes(m))]
      : baseList;

  const windowStartMs = nowMs - 60_000;
  let bestWaitOption = null;

  for (let idx = 0; idx < candidateSequence.length; idx += 1) {
    const modelId = candidateSequence[idx];
    if (Number(state.deprecatedModels[modelId] || 0) > nowMs) continue;

    const limits = resolveModelLimits(modelId, { config, state });
    const usage = state.dailyUsage[modelId] || { requests: 0, tokens: 0, exhausted: false, sfRequests: 0 };
    if (usage.exhausted || limits.safeRpd <= 0) continue;

    // 1. Adaptive SF Early-Degradation Reserve check
    const reserveCount = isPriorityTeam
      ? 0
      : computePriorityReservationForModel(limits.pool, idx, limits, config);
    const effectiveRpdCap = Math.max(0, limits.safeRpd - reserveCount);
    if (usage.requests >= effectiveRpdCap) continue;

    // 2. Daily TPD budget check
    if (usage.tokens + estimatedTokens > limits.tpdLimit) continue;

    // 3. Sliding 60s RPM & TPM check
    const recentForModel = state.recentWindow
      .filter(e => e.model === modelId && Number(e.ts) >= windowStartMs)
      .sort((a, b) => a.ts - b.ts);
    const recentCount = recentForModel.length;
    const recentTokens = recentForModel.reduce((s, e) => s + (Number(e.tokens) || 0), 0);
    const lastTs = recentForModel.length > 0 ? recentForModel[recentForModel.length - 1].ts : 0;

    let waitMs = 0;
    if (lastTs > 0 && nowMs - lastTs < limits.minSpacingMs) {
      waitMs = Math.max(waitMs, limits.minSpacingMs - (nowMs - lastTs));
    }
    if (recentCount >= limits.safeRpm && recentForModel.length > 0) {
      const oldestBlocking = recentForModel[recentCount - limits.safeRpm];
      waitMs = Math.max(waitMs, oldestBlocking.ts + 60_500 - nowMs);
    }
    if (recentTokens + estimatedTokens > limits.safeTpm && recentForModel.length > 0) {
      let running = recentTokens;
      for (const entry of recentForModel) {
        running -= Number(entry.tokens) || 0;
        if (running + estimatedTokens <= limits.safeTpm) {
          waitMs = Math.max(waitMs, entry.ts + 60_500 - nowMs);
          break;
        }
      }
      if (running + estimatedTokens > limits.safeTpm) {
        waitMs = Math.max(waitMs, recentForModel[recentForModel.length - 1].ts + 60_500 - nowMs);
      }
    }

    const selection = {
      ok: true,
      modelId,
      pool: limits.pool,
      rankIndex: idx,
      waitMs: Math.max(0, Math.ceil(waitMs)),
      limits,
      usedRpd: usage.requests,
      effectiveRpdCap,
      reservedForPriority: reserveCount,
      usedTpd: usage.tokens,
      recentRpm: recentCount,
      recentTpm: recentTokens
    };

    // Prefer an immediately ready higher-tier model; if this model only needs brief staggering,
    // remember it in case no other model is ready immediately (or for SF priority, prefer waiting
    // on the #1 premier model rather than needlessly downgrading!).
    if (selection.waitMs === 0) {
      return selection;
    }
    if (isPriorityTeam && idx === 0 && selection.waitMs <= 20_000) {
      return selection;
    }
    if (!bestWaitOption || selection.waitMs < bestWaitOption.waitMs) {
      bestWaitOption = selection;
    }
  }

  if (bestWaitOption) return bestWaitOption;
  return {
    ok: false,
    reason: 'all_pool_models_exhausted_or_reserved',
    modelId: null,
    waitMs: 0
  };
}

/**
 * Records the outcome of a Gemini API call onto `state` (mutating in-place for convenience):
 *   - Updates daily RPD, TPD, SF counters, and sliding 60s RPM/TPM window
 *   - Quarantines `HTTP 404` deprecated models for 7 days
 *   - Empirically learns `learnedRpdCaps[model]` and marks model exhausted on `HTTP 429`
 */
export function recordGeminiCallOutcome(
  state,
  {
    modelId,
    status = 200,
    ok = true,
    actualTokens = 0,
    estimatedTokens = 0,
    isPriorityTeam = false,
    usedSearch = false,
    nowMs = Date.now(),
    config = DEFAULT_GEMINI_QUOTA_CONFIG
  } = {}
) {
  if (!state || !modelId) return state;
  const id = String(modelId).replace(/^models\//i, '').trim().toLowerCase();
  const datePt = getQuotaPacificDateKey(nowMs);
  if (state.datePt !== datePt) {
    const fresh = normalizeGeminiQuotaState(state, nowMs);
    Object.assign(state, fresh);
  }
  if (!state.dailyUsage[id]) {
    state.dailyUsage[id] = { requests: 0, tokens: 0, exhausted: false, sfRequests: 0 };
  }
  const tokensUsed = Math.max(0, Number(actualTokens) || Number(estimatedTokens) || 0);

  // Record in sliding 60s window for ALL non-404 requests (even 429s count toward Google's RPM meter!)
  if (status !== 404) {
    state.recentWindow.push({ ts: nowMs, model: id, tokens: tokensUsed });
    const cutoff = nowMs - 65_000;
    state.recentWindow = state.recentWindow.filter(e => Number(e.ts) >= cutoff);
  }

  if (status === 404) {
    const days = Number(config?.deprecatedQuarantineDays) || 7;
    state.deprecatedModels[id] = nowMs + days * 86_400_000;
    state.pools.premier = (state.pools.premier || []).filter(m => m !== id);
    state.pools.lite = (state.pools.lite || []).filter(m => m !== id);
    return state;
  }

  if (ok) {
    state.dailyUsage[id].requests += 1;
    state.dailyUsage[id].tokens += tokensUsed;
    if (isPriorityTeam) state.dailyUsage[id].sfRequests += 1;
    return state;
  }

  if (status === 429) {
    if (usedSearch) {
      // Do NOT immediately mark the model itself exhausted if only `google_search` triggered 429;
      // caller will probe/fall back to direct (`search=false`) and mark search disabled if direct succeeds.
      return state;
    }
    state.dailyUsage[id].exhausted = true;
    const observed = state.dailyUsage[id].requests;
    if (observed >= 1) {
      const prevLearned = Number(state.learnedRpdCaps[id] || 0);
      state.learnedRpdCaps[id] = prevLearned > 0 ? Math.min(prevLearned, observed) : observed;
    }
  }
  return state;
}

/**
 * Periodically polls `GET /v1beta/models` (at most once per `catalogRefreshIntervalHours`, default 24h)
 * to automatically pick up newly launched models and drop deprecated ones across both Pool 1 & Pool 2.
 */
export async function refreshGeminiModelCatalogIfDue(
  rawState,
  apiKey = '',
  {
    nowMs = Date.now(),
    force = false,
    timeoutMs = 8000,
    fetchImpl = globalThis.fetch,
    config = DEFAULT_GEMINI_QUOTA_CONFIG
  } = {}
) {
  const state = normalizeGeminiQuotaState(rawState, nowMs);
  const intervalMs = Math.max(1, Number(config?.catalogRefreshIntervalHours) || 24) * 3_600_000;
  const isDue = force || !state.catalogUpdatedAtMs || nowMs - state.catalogUpdatedAtMs >= intervalMs;
  if (!isDue || !apiKey || typeof fetchImpl !== 'function') {
    return { state, refreshed: false };
  }

  try {
    const res = await fetchImpl(
      `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(String(apiKey).trim())}&pageSize=1000`,
      { signal: AbortSignal.timeout(timeoutMs) }
    );
    if (!res.ok) return { state, refreshed: false, status: res.status };
    const json = await res.json();
    const models = Array.isArray(json?.models) ? json.models : [];
    if (models.length === 0) return { state, refreshed: false };

    const pools = buildDynamicGeminiPoolsFromCatalog(models, { state, nowMs, config });
    state.pools = {
      premier: pools.premier,
      lite: pools.lite
    };
    state.catalogUpdatedAtMs = nowMs;
    return { state, refreshed: true, modelCount: models.length };
  } catch {
    return { state, refreshed: false };
  }
}

/**
 * Produces a concise diagnostic snapshot of remaining daily RPD/TPD headroom across Pool 1 & Pool 2.
 */
export function summarizeGeminiQuotaHeadroom(rawState, { nowMs = Date.now(), config = DEFAULT_GEMINI_QUOTA_CONFIG } = {}) {
  const state = normalizeGeminiQuotaState(rawState, nowMs);
  const summarizePool = poolName => {
    const models = state.pools?.[poolName] || [];
    let totalUsedRpd = 0;
    let totalSafeRpd = 0;
    let totalUsedTpd = 0;
    let totalTpdLimit = 0;
    const perModel = models.map((m, idx) => {
      const limits = resolveModelLimits(m, { config, state });
      const u = state.dailyUsage[m] || { requests: 0, tokens: 0, exhausted: false, sfRequests: 0 };
      const sfReserve = computePriorityReservationForModel(poolName, idx, limits, config);
      totalUsedRpd += u.requests;
      totalSafeRpd += limits.safeRpd;
      totalUsedTpd += u.tokens;
      totalTpdLimit += limits.tpdLimit;
      return {
        modelId: m,
        usedRpd: u.requests,
        safeRpd: limits.safeRpd,
        rpdLimit: limits.rpdLimit,
        sfReserve,
        usedTpd: u.tokens,
        tpdLimit: limits.tpdLimit,
        exhausted: Boolean(u.exhausted)
      };
    });
    return { totalUsedRpd, totalSafeRpd, totalUsedTpd, totalTpdLimit, perModel };
  };

  return {
    datePt: state.datePt,
    searchGroundingAllowed: isSearchGroundingAllowed(state, nowMs),
    deprecatedCount: Object.keys(state.deprecatedModels || {}).length,
    premier: summarizePool('premier'),
    lite: summarizePool('lite')
  };
}
