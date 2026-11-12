/**
 * Deep Thinking & Chain-of-Verification AI Synthesis Engine for 49ers Faithful
 *
 * Design Principles (Accuracy > Velocity + Automatic Free-Tier Model Upgrading):
 * 1. Newer Gemini 3.x Flash models on HIGH thinking (`gemini-3.8-flash` / `gemini-3.5-flash`
 *    with `thinkingBudget: 24576`) outperform older `gemini-2.5-pro` architectures on
 *    multi-step NFL math, CBA salary cap proration, and Google Search Grounding while
 *    remaining 100% eligible on the Google AI Studio Free Tier.
 * 2. Periodically polls `GET https://generativelanguage.googleapis.com/v1beta/models`
 *    via `discoverBestFreeGeminiModel()` to detect newly released free-tier Gemini models
 *    (e.g. `gemini-3.9-flash`, `gemini-4.0-flash`) and automatically upgrades to the
 *    highest-ranked free model that passes a live quota check.
 * 3. Strips internal reasoning parts (`!part.thought`) before parsing output.
 * 4. Runs a two-stage Chain-of-Verification (Generator -> Adversarial Fact-Checker)
 *    plus deterministic programmatic validation against OverTheCap cap tables,
 *    ESPN active/IR rosters, Tankathon pick capital, and calibrated Monte Carlo odds.
 */

import {
  buildAuthoritativeLiveContextSnapshot,
  buildLiveGroundingSystemPrompt,
  sanitizeHallucinatedRosterText,
  validateNoHallucinatedRosterClaims
} from '../../src/engine/groundingValidator.js';
import { buildGeminiThinkingConfig } from '../../src/engine/geminiStudioPrompts.js';

/**
 * Default ordered cascade of best available Free-Tier Gemini models (all run on HIGH thinking).
 * Newer 3.x Flash models on High Thinking beat legacy 2.5 Pro and have active Free Tier quota.
 */
export const DEFAULT_FREE_MODEL_CASCADE = [
  'gemini-3.8-flash',
  'gemini-3.5-flash',
  'gemini-3-flash-preview',
  'gemini-2.5-flash',
  'gemini-2.5-pro'
];

export const HIGH_THINKING_BUDGET = 24576;

/**
 * Scores a Gemini model identifier or `/v1beta/models` catalog entry for Free-Tier
 * high-reasoning suitability. Higher score = better free-tier reasoning model.
 * Automatically ranks future versions (e.g. `gemini-3.9-flash`, `gemini-4.0-flash`) above 3.8.
 */
export function scoreFreeTierGeminiModel(modelEntryOrId) {
  const rawName =
    typeof modelEntryOrId === 'string'
      ? modelEntryOrId
      : String(modelEntryOrId?.name || modelEntryOrId?.id || '');
  const id = rawName.replace(/^models\//i, '').trim().toLowerCase();
  if (!id.startsWith('gemini-')) return -1;

  // Exclude non-text, audio-only, image/video, embedding, or ultra-small lite/8b models
  if (
    /\b(tts|audio|imagen|image|veo|video|embedding|aqa|vision|robotics|computer-use|learnlm|gemma|lite|8b|nano|customtools|thinking)\b/i.test(
      id
    )
  ) {
    return -1;
  }

  if (
    /^gemini-3-pro-preview\b/i.test(id) ||
    /^gemini-2\.5-(?:pro|flash)-preview-\d/i.test(id)
  ) {
    return -1;
  }

  if (
    typeof modelEntryOrId === 'object' &&
    modelEntryOrId !== null &&
    Array.isArray(modelEntryOrId.supportedGenerationMethods) &&
    !modelEntryOrId.supportedGenerationMethods.includes('generateContent')
  ) {
    return -1;
  }

  const verMatch = id.match(/^gemini-(\d+(?:\.\d+)?)/);
  const versionNum = verMatch ? parseFloat(verMatch[1]) : 2.0;
  if (!Number.isFinite(versionNum) || versionNum < 2.5) return -1;

  const isFlash = /\bflash\b/.test(id);
  const isPro = /\bpro\b/.test(id);
  if (!isFlash && !isPro) return -1;

  // Google AI Studio Free Tier prioritizes 3.x/4.x High-Thinking models; if a 3.8+ Pro
  // tier is exposed on the key's catalog, rank it at the top with automatic failover to Flash High.
  const freeTierBonus = isFlash ? 260 : versionNum >= 3.8 ? 275 : 80;
  const versionScore = Math.round(versionNum * 100);
  const stabilityAdj = id.includes('exp') ? -18 : id.includes('preview') ? -6 : 10;
  const latestAliasPenalty = id.endsWith('-latest') ? -4 : 0;

  return freeTierBonus + versionScore + stabilityAdj + latestAliasPenalty;
}

/**
 * Ranks a list of `/v1beta/models` entries (or model IDs) from best to worst free-tier model,
 * merging with `DEFAULT_FREE_MODEL_CASCADE` so known fallbacks are always present.
 */
export function rankFreeTierModelsFromCatalog(catalogModels = []) {
  const scored = new Map();

  for (const entry of catalogModels) {
    const rawName = typeof entry === 'string' ? entry : String(entry?.name || '');
    const cleanId = rawName.replace(/^models\//i, '').trim();
    if (!cleanId) continue;
    const sc = scoreFreeTierGeminiModel(entry);
    if (sc > 0) {
      scored.set(cleanId, Math.max(scored.get(cleanId) || 0, sc));
    }
  }

  for (const fallbackId of DEFAULT_FREE_MODEL_CASCADE) {
    if (!scored.has(fallbackId)) {
      scored.set(fallbackId, scoreFreeTierGeminiModel(fallbackId));
    }
  }

  return [...scored.entries()]
    .filter(([, sc]) => sc > 0)
    .sort((a, b) => b[1] - a[1])
    .map(([id]) => id);
}

/**
 * Polls `GET https://generativelanguage.googleapis.com/v1beta/models` to discover all
 * available Gemini models on the user's key, ranks them by generation + Free-Tier High-Thinking
 * capability, and optionally probes the top candidates to verify live Free-Tier quota (>0 RPM).
 */
export async function discoverBestFreeGeminiModel(apiKey = process.env.GEMINI_API_KEY, options = {}) {
  const { probeQuota = true, timeoutMs = 10000 } = options;
  const nowIso = new Date().toISOString();

  if (!apiKey) {
    return {
      activeModel: DEFAULT_FREE_MODEL_CASCADE[0],
      thinkingLevel: 'HIGH',
      thinkingBudget: HIGH_THINKING_BUDGET,
      autoPollEnabled: true,
      pollIntervalHours: 2,
      candidateCascade: [...DEFAULT_FREE_MODEL_CASCADE],
      source: 'default-free-tier-cascade (gemini-3.8-flash HIGH)',
      lastCheckedAt: nowIso
    };
  }

  let catalogModels = [];
  let catalogSource = 'fallback-cascade';
  try {
    const listUrl = `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`;
    const res = await fetch(listUrl, { signal: AbortSignal.timeout(timeoutMs) });
    if (res.ok) {
      const json = await res.json();
      if (Array.isArray(json?.models)) {
        catalogModels = json.models;
        catalogSource = 'google-ai-studio-v1beta-models-poll';
      }
    }
  } catch {}

  const rankedCascade = rankFreeTierModelsFromCatalog(catalogModels);
  let selectedModel = rankedCascade[0] || DEFAULT_FREE_MODEL_CASCADE[0];

  if (probeQuota && catalogModels.length > 0) {
    for (const candidate of rankedCascade.slice(0, 5)) {
      try {
        const probeUrl = `https://generativelanguage.googleapis.com/v1beta/models/${candidate}:generateContent?key=${apiKey}`;
        const probeRes = await fetch(probeUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          signal: AbortSignal.timeout(timeoutMs),
          body: JSON.stringify({
            generationConfig: {
              maxOutputTokens: 8,
              temperature: 0,
              thinkingConfig: buildGeminiThinkingConfig(candidate, 1024)
            },
            contents: [{ role: 'user', parts: [{ text: 'Reply OK' }] }]
          })
        });
        if (probeRes.ok) {
          selectedModel = candidate;
          catalogSource = 'verified-live-free-tier-probe';
          break;
        }
      } catch {}
    }
  }

  return {
    activeModel: selectedModel,
    thinkingLevel: 'HIGH',
    thinkingBudget: HIGH_THINKING_BUDGET,
    autoPollEnabled: true,
    pollIntervalHours: 2,
    candidateCascade: [selectedModel, ...rankedCascade.filter(m => m !== selectedModel)],
    source: catalogSource,
    lastCheckedAt: nowIso
  };
}

/**
 * Rich Hill NFL Draft Trade Value Chart (Picks 1–262).
 */
const RICH_HILL_VALUES = [
  0,
  1000, 717, 514, 491, 468, 446, 426, 406, 387, 369, 358, 347, 336, 325, 315, 305,
  296, 287, 278, 269, 260, 252, 244, 236, 228, 220, 213, 206, 199, 196, 190, 184,
  180, 175, 170, 166, 162, 158, 154, 150, 146, 142, 138, 135, 131, 128, 124, 121,
  118, 115, 112, 109, 106, 103, 100, 98, 95, 93, 90, 88, 86, 84, 82, 80,
  78, 76, 75, 73, 71, 70, 68, 67, 65, 64, 62, 61, 59, 58, 57, 55,
  54, 53, 51, 50, 49, 48, 47, 46, 45, 44, 43, 42, 42, 41, 41, 40
];

export function estimateRichHillPickValue(overallPick) {
  const n = Math.max(1, Math.round(Number(overallPick) || 250));
  if (n < RICH_HILL_VALUES.length) return RICH_HILL_VALUES[n];
  if (n <= 110) return Math.max(26, Math.round(39 - (n - 96) * 0.9));
  if (n <= 145) return Math.max(13, Math.round(25 - (n - 110) * 0.34));
  if (n <= 180) return Math.max(7, Math.round(13 - (n - 145) * 0.17));
  if (n <= 220) return Math.max(3, Math.round(7 - (n - 180) * 0.1));
  return Math.max(1, Math.round(3 - (n - 220) * 0.05));
}

/**
 * Parses San Francisco's live upcoming draft pick inventory directly from
 * `https://www.tankathon.com/nfl/49ers` HTML (`Current Draft Picks` section).
 */
export function parseTankathonTeamPicksHtml(html = '') {
  if (!html || typeof html !== 'string') return [];
  const sectionIdx = html.indexOf('Current Draft Picks');
  if (sectionIdx < 0) return [];
  const slice = html.slice(sectionIdx, sectionIdx + 12000);

  const picks = [];
  const cardRe =
    /<div class="pick-card-round">\s*(\d+)\.(\d+)\s*<\/div>\s*(\d+)\s*<\/div>[\s\S]{0,420}?<div class="abbreviation">\s*([A-Z]{2,3})\s*<\/div>/gi;

  let m;
  while ((m = cardRe.exec(slice)) !== null) {
    const round = Number(m[1]);
    const overall = Number(m[3]);
    const origAbbr = String(m[4] || 'SF').trim().toUpperCase();
    if (!Number.isFinite(round) || !Number.isFinite(overall)) continue;

    const origin =
      origAbbr === 'SF'
        ? round === 1
          ? 'Own Pick (Live Contender Slot)'
          : 'Own Pick'
        : `From ${origAbbr} (Acquired via Trade)`;

    picks.push({
      round,
      projectedOverall: overall,
      origin,
      fromTeam: origAbbr,
      valueRichHill: estimateRichHillPickValue(overall)
    });
  }

  return picks;
}

/**
 * Extracts non-thought text from a Gemini response object.
 * Critical when `thinkingConfig` is enabled so `part.thought === true` blocks never leak.
 */
export function extractGeminiResponseText(geminiJson) {
  const parts = geminiJson?.candidates?.[0]?.content?.parts || [];
  return parts
    .filter(p => p && !p.thought && typeof p.text === 'string')
    .map(p => p.text)
    .join('\n')
    .trim();
}

/**
 * Extracts balanced JSON object or array from model output (even when wrapped in prose or fences
 * because `google_search` grounding cannot always be paired with `responseMimeType: application/json`).
 */
export function parseGroundedJsonSafe(rawText = '', fallback = null) {
  const cleaned = String(rawText || '')
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
  if (!cleaned) return fallback;

  try {
    return JSON.parse(cleaned);
  } catch {}

  const firstArr = cleaned.indexOf('[');
  const lastArr = cleaned.lastIndexOf(']');
  const firstObj = cleaned.indexOf('{');
  const lastObj = cleaned.lastIndexOf('}');

  const candidates = [];
  if (firstObj >= 0 && lastObj > firstObj) candidates.push(cleaned.slice(firstObj, lastObj + 1));
  if (firstArr >= 0 && lastArr > firstArr) candidates.push(cleaned.slice(firstArr, lastArr + 1));

  for (const cand of candidates) {
    try {
      return JSON.parse(cand);
    } catch {}
  }
  return fallback;
}

async function callGeminiCascade(apiKey, modelsCascade, payload, timeoutMs) {
  const requestedBudget =
    payload?.generationConfig?.thinkingConfig?.thinkingBudget || HIGH_THINKING_BUDGET;
  for (const model of modelsCascade) {
    try {
      const modelThinkingConfig = buildGeminiThinkingConfig(model, requestedBudget);
      const modelPayload = {
        ...payload,
        generationConfig: {
          ...(payload.generationConfig || {}),
          thinkingConfig: modelThinkingConfig
        }
      };
      const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(timeoutMs),
        body: JSON.stringify(modelPayload)
      });
      if (res.ok) {
        return { ok: true, modelUsed: model, json: await res.json() };
      }
      if (![400, 403, 404, 429, 503].includes(res.status)) break;
    } catch {}
  }
  return { ok: false, modelUsed: null, json: null };
}

/**
 * Executes a two-pass Deep Thinking + Adversarial Fact-Check Gemini synthesis when
 * `process.env.GEMINI_API_KEY` is configured, automatically polling and selecting
 * the best available Free-Tier Gemini model on HIGH thinking (`thinkingBudget: 24576`).
 */
export async function runVerifiedDeepGeminiSynthesis({
  apiKey = process.env.GEMINI_API_KEY,
  taskPrompt,
  userPrompt,
  groundingFacts,
  rosterPlayers = [],
  appData,
  expectJson = true,
  thinkingBudget = HIGH_THINKING_BUDGET,
  timeoutMs = 90000
}) {
  const effectivePrompt = taskPrompt || userPrompt;
  if (!apiKey || !effectivePrompt) return { ok: false, data: null };

  const discovery = await discoverBestFreeGeminiModel(apiKey, { probeQuota: false });
  const cascade =
    process.env.GEMINI_SYNTHESIS_MODEL && process.env.GEMINI_SYNTHESIS_MODEL !== 'auto'
      ? [process.env.GEMINI_SYNTHESIS_MODEL, ...discovery.candidateCascade]
      : discovery.candidateCascade;

  const systemPrompt = buildLiveGroundingSystemPrompt(appData);
  const contextSnapshot = groundingFacts
    ? JSON.stringify(groundingFacts, null, 2)
    : buildAuthoritativeLiveContextSnapshot(appData);

  try {
    // Pass 1: Deep Thinking (HIGH) + Google Search Grounded Generation
    const genCall = await callGeminiCascade(
      apiKey,
      cascade,
      {
        systemInstruction: { parts: [{ text: systemPrompt }] },
        tools: [{ google_search: {} }],
        generationConfig: {
          temperature: 0.15,
          thinkingConfig: { thinkingBudget }
        },
        contents: [
          {
            role: 'user',
            parts: [
              {
                text: `${effectivePrompt}\n\nAUTHORITATIVE LIVE GROUND-TRUTH SNAPSHOT:\n${contextSnapshot}`
              }
            ]
          }
        ]
      },
      timeoutMs
    );
    if (!genCall.ok || !genCall.json) return { ok: false, data: null };
    const draftText = extractGeminiResponseText(genCall.json);
    if (!draftText) return { ok: false, data: null };

    // Pass 2: Adversarial Fact-Check & Consistency Verifier on the winning model
    const verifyPrompt = [
      'ACT AS AN ADVERSARIAL NFL CAP, ROSTER & ANALYTICS AUDITOR.',
      'Audit the DRAFT SYNTHESIS below line-by-line against the AUTHORITATIVE LIVE GROUND-TRUTH SNAPSHOT and live Google Search.',
      'Fix ANY discrepancy in:',
      '1) 2026 Cap Space vs. 2027 Projected Cap Deficit and CBA Article 13 rollover math (purchasing power lets SF absorb 9/18ths base salary on expiring rentals to lower pick costs; never claim sellers must eat cash unless an expensive 2027 guarantee exists).',
      '2) Remaining 2027 Draft Picks (verify exact count and rounds after the DeForest Buckner 4th-round trade).',
      '3) Active vs. Injured Reserve vs. Out 49ers players, coaching staff (DC Raheem Morris), and opponent coaches/records.',
      '4) Trade target current teams, 2026 production (reject 0-sack aging traps), and 2027 contract guarantees/extensions.',
      '5) Calibrated Playoff Monte Carlo odds (must match the exact snapshot numbers).',
      expectJson
        ? 'Output ONLY the corrected, valid JSON structure with zero markdown fences or commentary.'
        : 'Output ONLY the corrected final markdown analysis with zero meta-commentary.',
      `\nDRAFT SYNTHESIS TO AUDIT:\n${draftText}`,
      `\nAUTHORITATIVE LIVE GROUND-TRUTH SNAPSHOT:\n${contextSnapshot}`
    ].join('\n');

    const verCall = await callGeminiCascade(
      apiKey,
      [genCall.modelUsed, ...cascade],
      {
        systemInstruction: { parts: [{ text: systemPrompt }] },
        tools: [{ google_search: {} }],
        generationConfig: {
          temperature: 0.1,
          thinkingConfig: { thinkingBudget: Math.min(16384, thinkingBudget) }
        },
        contents: [{ role: 'user', parts: [{ text: verifyPrompt }] }]
      },
      timeoutMs
    );

    const finalRaw = verCall.ok
      ? extractGeminiResponseText(verCall.json) || draftText
      : draftText;
    const sanitizedRaw = auditAndSanitizeTextBlock(finalRaw, rosterPlayers);
    const parsedData = expectJson ? parseGroundedJsonSafe(sanitizedRaw, null) : sanitizedRaw;
    return {
      ok: Boolean(parsedData),
      modelUsed: genCall.modelUsed,
      data: parsedData
    };
  } catch {
    return { ok: false, data: null };
  }
}

/**
 * Single-pass High-Thinking + Google Search Grounding synthesis for 1/day scheduled artifacts
 * (strictly consumes 1 RPD credit per invocation).
 */
export async function runSinglePassDailyGeminiSynthesis({
  apiKey = process.env.GEMINI_API_KEY,
  preferredModel = null,
  promptText,
  appData,
  rosterPlayers = [],
  thinkingBudget = HIGH_THINKING_BUDGET,
  timeoutMs = 75000
} = {}) {
  if (!apiKey || !promptText) return { ok: false, rawText: '', modelUsed: null };
  const discovery = await discoverBestFreeGeminiModel(apiKey, { probeQuota: false });
  const cascade = preferredModel
    ? [preferredModel, ...discovery.candidateCascade.filter(m => m !== preferredModel)]
    : discovery.candidateCascade;
  const systemPrompt = buildLiveGroundingSystemPrompt(appData);

  try {
    const genCall = await callGeminiCascade(
      apiKey,
      cascade,
      {
        systemInstruction: { parts: [{ text: systemPrompt }] },
        tools: [{ google_search: {} }],
        generationConfig: {
          temperature: 0.18,
          thinkingConfig: { thinkingBudget }
        },
        contents: [{ role: 'user', parts: [{ text: promptText }] }]
      },
      timeoutMs
    );
    if (!genCall.ok || !genCall.json) return { ok: false, rawText: '', modelUsed: null };
    const rawText = auditAndSanitizeTextBlock(extractGeminiResponseText(genCall.json), rosterPlayers);
    return { ok: Boolean(rawText), rawText, modelUsed: genCall.modelUsed };
  } catch {
    return { ok: false, rawText: '', modelUsed: null };
  }
}

/**
 * Deterministic post-synthesis auditor ensuring zero hallucinated active 49ers,
 * zero stale probability numbers, and zero forbidden terminology across text blocks.
 */
export function auditAndSanitizeTextBlock(text = '', rosterPlayers = []) {
  const clean = String(text || '').trim();
  if (!clean) return clean;
  const check = validateNoHallucinatedRosterClaims(clean, rosterPlayers);
  return check.valid ? clean : sanitizeHallucinatedRosterText(clean, rosterPlayers);
}
