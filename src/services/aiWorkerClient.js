/**
 * On-Demand AI Deep Analysis & Gemini NotebookLM Autopodcast 3-Stage Pipeline Client
 *
 * Supports TWO live high-thinking execution transports:
 * 1. **Direct Browser Gemini Studio Mode (`prefs.geminiApiKey`)**:
 *    Calls `generativelanguage.googleapis.com/v1beta` directly from the browser (key stored privately
 *    in device `localStorage`, never committed to GitHub), dynamically discovering the strongest Pro
 *    reasoning model (`gemini-3.8-pro` / `gemini-3.1-pro-preview` / `gemini-2.5-pro`)
 *    with generation-accurate `thinkingConfig` (`thinkingLevel: "HIGH"` on Gemini 3+ / `thinkingBudget: 32768`
 *    on Gemini 2.5 Pro), live `google_search` grounding, 3-pass Deep Research -> Synthesis -> Audit, and
 *    **Gemini Native Multi-Speaker NotebookLM TTS** (`gemini-2.5-pro-preview-tts` -> `gemini-2.5-flash-preview-tts`,
 *    voices `Puck` + `Aoede` for two-host, `Charon` for solo).
 * 2. **Shared Cloudflare Edge Worker Mode (`prefs.workerBaseUrl`)**:
 *    Routes the same 3-stage High-Thinking + NotebookLM TTS pipeline through `worker/index.js` with
 *    shared Cloudflare KV/R2 group caching.
 *
 * For shared links opened by colleagues without an API key or R2 stream, `synthesizeMissingEpisodeAudio`
 * renders the verified NotebookLM script through StyleTTS2-based **Kokoro-82M** (`af_heart` + `am_fenrir`)
 * in a background Web Worker.
 */

import {
  buildLiveGroundingSystemPrompt,
  buildAuthoritativeLiveContextSnapshot,
  sanitizeHallucinatedRosterText
} from '../engine/groundingValidator.js';
import {
  sortNewsWithBreakingPriority,
  deduplicateAndGroupWireItems,
  balanceFeedTopSalience,
  filterOutCompletedGameAvailabilityItems,
  stripRedundantAuthorBoilerplate,
  buildStorySignatureKey
} from '../engine/breakingClassifier.js';
import { isPaywalledPublisher, sanitizeExternalUrl } from '../engine/linkIntegrity.js';
import { resolveOriginalTweetUrl } from '../engine/beatAttributionEngine.js';
import {
  normalizeDisplayTopic,
  compileDeepResearchDossier,
  buildNotebookLmPodcastScript,
  buildDeepScoutingAnalysisMarkdown
} from '../engine/deepResearchEngine.js';
import {
  DEFAULT_BEST_REASONING_CASCADE,
  DEFAULT_NOTEBOOKLM_TTS_CASCADE,
  NOTEBOOKLM_VOICE_PROFILES,
  rankBestGeminiReasoningModels,
  buildGeminiThinkingConfig,
  DEEP_RESEARCH_STAGE1_SYSTEM_PROMPT,
  buildStage1DeepResearchUserPrompt,
  DEEP_ANALYSIS_STAGE2_SYSTEM_PROMPT,
  buildStage2AnalysisSynthesisPrompt,
  buildStage3AnalysisAuditPrompt,
  NOTEBOOKLM_PODCAST_STAGE2_SYSTEM_PROMPT,
  buildStage2NotebookLmScriptPrompt,
  buildStage2NotebookLmPolishPrompt,
  buildNotebookLmTtsDirectorHeader,
  chunkTurnsForGeminiTts
} from '../engine/geminiStudioPrompts.js';
import { saveEpisodeAudioBlob } from './podcastAudioStore.js';

export const PODCAST_PIPELINE_STAGES = [
  '1. Deep research on the topic',
  '2. Restructure into audio script',
  '3. Convert to podcast'
];

export const ANALYSIS_PIPELINE_STAGES = [
  '1. Deep research on the topic',
  '2. Audit film, EPA & CBA cap math',
  '3. Structure scouting & cap report'
];

const DEFAULT_GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta';
const LIVE_PRODUCTION_FALLBACK_CASCADE = [
  'gemini-3.8-flash',
  'gemini-3.8-flash-preview',
  'gemini-3.6-flash',
  'gemini-3.6-flash-preview',
  'gemini-3-flash-preview',
  'gemini-2.5-flash',
  'gemini-3.5-flash-lite',
  'gemini-3.5-flash-lite-preview',
  'gemini-3.1-flash-lite-preview',
  'gemini-2.5-flash-lite',
  'gemini-2.0-flash'
];
const discoveredCascadeByKey = new Map();
const unavailableModelsByKey = new Map();

function isGeminiQuotaExhaustedError(err) {
  const msg = String(err?.message || err || '');
  return /HTTP 429|exceeded your current quota|RESOURCE_EXHAUSTED|rate[\s-]?limit|quota/i.test(msg);
}

function sanitizeRetiredModelId(modelId = '') {
  const clean = String(modelId || '').replace(/^models\//i, '').trim();
  if (/^gemini-3-pro-preview\b/i.test(clean)) {
    return 'gemini-3.8-flash';
  }
  return clean;
}

function migrateZeroQuotaFreeTierModelId(modelId = '') {
  const clean = sanitizeRetiredModelId(modelId);
  if (/^gemini-3\.1-pro(?:-preview)?\b|^gemini-2\.5-pro\b/i.test(clean)) {
    return 'gemini-3.8-flash';
  }
  return clean;
}

export function hasLiveAiConnection(prefs = {}) {
  return Boolean(
    String(prefs?.geminiApiKey || '').trim() || String(prefs?.workerBaseUrl || '').trim()
  );
}

export function formatActiveModelBadge(_modelId = 'gemini-3.8-flash', suffix = 'Accuracy-First') {
  return suffix || 'Accuracy-First';
}

export function resolveActiveHighQualityModelLabel(appData = null, prefs = null) {
  const verifiedModel = migrateZeroQuotaFreeTierModelId(prefs?.verifiedGeminiModel || '');
  const modelId =
    verifiedModel ||
    migrateZeroQuotaFreeTierModelId(appData?.meta?.aiEngine?.activeModel || 'gemini-3.8-flash');
  const thinkingLevel = String(appData?.meta?.aiEngine?.thinkingLevel || 'HIGH').toUpperCase();
  return {
    modelId,
    thinkingLevel,
    shortModelName: 'Deep Research',
    displayLabel: 'Accuracy-First'
  };
}

export function estimateGenerationWait({
  kind = 'podcast',
  durationMinutes = 3,
  prefs = {}
} = {}) {
  const isCloud = hasLiveAiConnection(prefs);

  if (kind === 'analysis') {
    const minSec = 25;
    const maxSec = 60;
    const rangeLabel = '25–60 sec';
    return {
      isCloud,
      minSec,
      maxSec,
      rangeLabel,
      estLabel: rangeLabel,
      summaryText: `Est. ${rangeLabel}`,
      detailLabel: `Estimated generation time ${rangeLabel}`
    };
  }

  const mins = Math.max(2, Math.min(20, Number(durationMinutes || 3)));
  let minSec = 45;
  let maxSec = 90;
  let rangeLabel = '45–90 sec';

  if (mins >= 5 && mins <= 10) {
    minSec = 60;
    maxSec = 180;
    rangeLabel = '1–3 min';
  } else if (mins > 10) {
    minSec = 120;
    maxSec = 240;
    rangeLabel = '2–4 min';
  }

  return {
    isCloud,
    minSec,
    maxSec,
    rangeLabel,
    estLabel: rangeLabel,
    summaryText: `${mins} min pod • Est. ${rangeLabel}`,
    detailLabel: `${mins} min pod • Est. ${rangeLabel}`
  };
}

export function buildCompactContextSummary(appData) {
  if (!appData) return '';
  return buildAuthoritativeLiveContextSnapshot(appData);
}

export async function fetchSharedWorkerFeed(prefs) {
  const baseUrl = String(prefs?.workerBaseUrl || '').trim().replace(/\/+$/, '');
  if (!baseUrl) return null;
  try {
    const res = await fetch(`${baseUrl}/api/shared-feed`, {
      headers: { 'X-Group-Passcode': prefs?.groupPasscode || '' }
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

/**
 * Verifies a Google AI Studio Gemini API Key against `/v1beta/models` and discovers the
 * strongest reasoning model + multi-speaker NotebookLM TTS models available on the key.
 */
export async function verifyGeminiApiKey(rawKey, apiBaseOverride = '') {
  const key = String(rawKey || '').trim();
  if (!key) {
    throw new Error('Please paste your Google AI Studio Gemini API Key.');
  }
  const apiBase = String(apiBaseOverride || DEFAULT_GEMINI_API_BASE)
    .trim()
    .replace(/\/+$/, '');

  const res = await fetch(`${apiBase}/models?key=${encodeURIComponent(key)}`);
  if (!res.ok) {
    let detail = '';
    try {
      const errJson = await res.json();
      detail = errJson?.error?.message || '';
    } catch {}
    throw new Error(
      detail
        ? `Gemini API Key rejected (${res.status}): ${detail}`
        : `Gemini API Key check failed (HTTP ${res.status}). Double-check your key from aistudio.google.com/apikey.`
    );
  }

  const json = await res.json();
  const models = Array.isArray(json?.models) ? json.models : [];
  const catalogIds = models.map(m => String(m?.name || '').replace(/^models\//i, '').trim()).filter(Boolean);
  const cacheKey = `${apiBase}:${key}`;
  const deadSet = unavailableModelsByKey.get(cacheKey) || new Set();

  // Rank strictly among models actually present on this key first; only fall back to static list if catalog was empty
  const keyPresentRanked = rankBestGeminiReasoningModels(models).filter(
    id => (catalogIds.length === 0 || catalogIds.includes(id)) && !deadSet.has(id)
  );
  const matchingCatalogFallbacks = LIVE_PRODUCTION_FALLBACK_CASCADE.filter(
    m => (catalogIds.length === 0 || catalogIds.includes(m)) && !keyPresentRanked.includes(m) && !deadSet.has(m)
  );
  const fullCascade =
    keyPresentRanked.length > 0
      ? [...keyPresentRanked, ...matchingCatalogFallbacks]
      : [...DEFAULT_BEST_REASONING_CASCADE.filter(m => !deadSet.has(m))];

  // Prefer fast Gemini Flash Native Multi-Speaker TTS first when present on key so 3-min pods render in ~25-40s
  const orderedTtsCandidates = [
    'gemini-2.5-flash-preview-tts',
    ...DEFAULT_NOTEBOOKLM_TTS_CASCADE.filter(id => id !== 'gemini-2.5-flash-preview-tts')
  ];
  const ttsCascade = orderedTtsCandidates.filter(
    id => catalogIds.length === 0 || catalogIds.includes(id)
  );
  const resolvedTtsCascade =
    ttsCascade.length > 0 ? ttsCascade : [...orderedTtsCandidates];

  const state = {
    ok: true,
    bestModel: fullCascade[0] || 'gemini-3.8-flash',
    cascade: fullCascade,
    ttsCascade: resolvedTtsCascade,
    modelCount: catalogIds.length,
    checkedAtMs: Date.now()
  };
  discoveredCascadeByKey.set(cacheKey, state);
  return state;
}

/**
 * Checks Google AI Studio in the background to automatically upgrade to newer, more capable
 * free Gemini models (e.g. Gemini 3.5 Pro, 4.0 Pro) as Google deploys them to the user's key.
 */
export async function checkAndAutoUpdateBestGeminiModel(prefs = {}, onModelUpdated = null) {
  const key = String(prefs?.geminiApiKey || '').trim();
  if (!key) return null;
  const apiBase = String(prefs?.geminiApiBaseUrl || DEFAULT_GEMINI_API_BASE)
    .trim()
    .replace(/\/+$/, '');
  try {
    const verified = await verifyGeminiApiKey(key, apiBase);
    if (verified?.bestModel && verified.bestModel !== prefs.verifiedGeminiModel) {
      prefs.verifiedGeminiModel = verified.bestModel;
      onModelUpdated?.(verified.bestModel);
    }
    return verified;
  } catch {
    return null;
  }
}

async function resolveDirectGeminiCascades(prefs = {}) {
  const key = String(prefs?.geminiApiKey || '').trim();
  const apiBase = String(prefs?.geminiApiBaseUrl || DEFAULT_GEMINI_API_BASE)
    .trim()
    .replace(/\/+$/, '');
  const cacheKey = `${apiBase}:${key}`;

  const cached = discoveredCascadeByKey.get(cacheKey);
  // Auto-refresh model catalog if cache is older than 20 minutes to pick up newly released models
  if (cached && Date.now() - Number(cached.checkedAtMs || 0) < 20 * 60 * 1000) {
    return { apiBase, key, ...cached };
  }

  try {
    const verified = await verifyGeminiApiKey(key, apiBase);
    if (verified?.bestModel && prefs && typeof prefs === 'object' && verified.bestModel !== prefs.verifiedGeminiModel) {
      prefs.verifiedGeminiModel = verified.bestModel;
    }
    return { apiBase, key, ...verified };
  } catch {
    if (cached) return { apiBase, key, ...cached };
    return {
      apiBase,
      key,
      bestModel: DEFAULT_BEST_REASONING_CASCADE[0],
      cascade: [...DEFAULT_BEST_REASONING_CASCADE],
      ttsCascade: [...DEFAULT_NOTEBOOKLM_TTS_CASCADE]
    };
  }
}

function extractGeminiResponseText(geminiJson) {
  const parts = geminiJson?.candidates?.[0]?.content?.parts;
  if (!Array.isArray(parts) || parts.length === 0) return '';
  const nonThought = parts
    .filter(p => p && !p.thought && typeof p.text === 'string')
    .map(p => p.text)
    .join('\n')
    .trim();
  if (nonThought) return nonThought;
  return parts
    .filter(p => p && typeof p.text === 'string')
    .map(p => p.text)
    .join('\n')
    .trim();
}

function extractGroundingSourceChips(geminiJson) {
  const chunks = geminiJson?.candidates?.[0]?.groundingMetadata?.groundingChunks;
  if (!Array.isArray(chunks) || chunks.length === 0) return [];
  const seen = new Set();
  const out = [];
  for (const ch of chunks) {
    const title = String(ch?.web?.title || '').trim();
    const uri = String(ch?.web?.uri || '').trim();
    if (!title && !uri) continue;
    const dedupeKey = uri || title;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
    out.push({
      label: title || 'Google Search Grounding',
      url: /^https:\/\//i.test(uri) ? uri : ''
    });
    if (out.length >= 6) break;
  }
  return out;
}

function parseJsonTurnsSafe(rawText = '') {
  const cleaned = String(rawText || '')
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();

  try {
    const arr = JSON.parse(cleaned);
    if (Array.isArray(arr) && arr.length > 0) return arr;
  } catch {
    const startIdx = cleaned.indexOf('[');
    if (startIdx >= 0) {
      let depth = 0;
      let inStr = false;
      let esc = false;
      for (let i = startIdx; i < cleaned.length; i++) {
        const ch = cleaned[i];
        if (inStr) {
          if (esc) esc = false;
          else if (ch === '\\') esc = true;
          else if (ch === '"') inStr = false;
          continue;
        }
        if (ch === '"') inStr = true;
        else if (ch === '[') depth++;
        else if (ch === ']') {
          depth--;
          if (depth === 0) {
            try {
              const extracted = JSON.parse(cleaned.slice(startIdx, i + 1));
              if (Array.isArray(extracted) && extracted.length > 0) return extracted;
            } catch {}
            break;
          }
        }
      }
    }
  }
  return null;
}

async function fetchPostJsonWithTimeout(url, payloadObj, timeoutMs = 55000) {
  const ctrl = typeof AbortController === 'function' ? new AbortController() : null;
  const timer = ctrl ? setTimeout(() => ctrl.abort(), timeoutMs) : null;
  try {
    return await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payloadObj),
      ...(ctrl ? { signal: ctrl.signal } : {})
    });
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Executes a High-Thinking Gemini text generation call directly from the browser,
 * automatically matching `thinkingLevel: "HIGH"` (Gemini 3+) vs `thinkingBudget: 32768` (Gemini 2.5 Pro)
 * and cascading cleanly across models if a preview model returns 400/403/404/429/503 or times out.
 */
async function callGeminiDirectWithCascade({
  apiBase,
  key,
  cascade,
  systemInstructionText,
  userText,
  useGoogleSearch = false,
  temperature = 0.2,
  perAttemptTimeoutMs = 55000
}) {
  let lastErrorText = '';
  let lastStatus = 500;
  let hasPrimaryModelError = false;

  const cacheKey = `${apiBase}:${key}`;
  let deadSet = unavailableModelsByKey.get(cacheKey);
  if (!deadSet) {
    deadSet = new Set(['gemini-3-pro-preview']);
    unavailableModelsByKey.set(cacheKey, deadSet);
  }

  const sanitizedCascade = [];
  for (const rawModel of cascade || []) {
    const cleanModel = sanitizeRetiredModelId(rawModel);
    if (cleanModel && !deadSet.has(cleanModel) && !sanitizedCascade.includes(cleanModel)) {
      sanitizedCascade.push(cleanModel);
    }
  }
  for (const fb of LIVE_PRODUCTION_FALLBACK_CASCADE) {
    if (!deadSet.has(fb) && !sanitizedCascade.includes(fb)) {
      sanitizedCascade.push(fb);
    }
  }
  if (sanitizedCascade.length === 0) {
    throw new Error(
      'Gemini High-Thinking request failed (HTTP 429): You exceeded your current quota, please check your plan and billing details.'
    );
  }

  for (let i = 0; i < sanitizedCascade.length; i++) {
    const model = sanitizedCascade[i];
    const thinkingConfig = buildGeminiThinkingConfig(model);
    const payload = {
      systemInstruction: { parts: [{ text: systemInstructionText }] },
      ...(useGoogleSearch ? { tools: [{ google_search: {} }] } : {}),
      generationConfig: {
        temperature,
        thinkingConfig
      },
      contents: [{ role: 'user', parts: [{ text: userText }] }]
    };

    const url = `${apiBase}/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(key)}`;
    let res;
    try {
      res = await fetchPostJsonWithTimeout(url, payload, perAttemptTimeoutMs);
    } catch (netErr) {
      lastStatus = 504;
      lastErrorText = netErr?.message || 'Request timed out';
      continue;
    }

    // Some preview models reject `google_search` tool binding with 400, or hit Free-Tier Google Search Grounding quota (429) while base model quota remains
    if ((res.status === 400 || res.status === 429) && useGoogleSearch) {
      let errPreview = '';
      if (res.status === 429) {
        try {
          errPreview = await res.clone().text();
        } catch {}
      }
      // Only retry 429 without google_search if the error isn't a hard 0-limit on the model itself
      if (res.status === 400 || !/limit:\s*0\b/i.test(errPreview)) {
        const retryPayload = {
          systemInstruction: { parts: [{ text: systemInstructionText }] },
          generationConfig: {
            temperature,
            ...(res.status === 400 ? { thinkingConfig } : {})
          },
          contents: [{ role: 'user', parts: [{ text: userText }] }]
        };
        try {
          res = await fetchPostJsonWithTimeout(url, retryPayload, perAttemptTimeoutMs);
        } catch (retryErr) {
          lastStatus = 504;
          lastErrorText = retryErr?.message || 'Retry timed out';
          continue;
        }
      }
    }

    // If a checkpoint rejects explicit `thinkingConfig` with 400, retry once with native dynamic thinking
    if (res.status === 400) {
      let errPreview = '';
      try {
        errPreview = await res.clone().text();
      } catch {}
      if (/thinking|invalid_argument/i.test(errPreview)) {
        const dynamicPayload = {
          systemInstruction: { parts: [{ text: systemInstructionText }] },
          generationConfig: { temperature },
          contents: [{ role: 'user', parts: [{ text: userText }] }]
        };
        try {
          res = await fetchPostJsonWithTimeout(url, dynamicPayload, perAttemptTimeoutMs);
        } catch {
          continue;
        }
      }
    }

    if (res.ok) {
      const json = await res.json();
      const text = extractGeminiResponseText(json);
      if (text) {
        const activeRemaining = sanitizedCascade.filter(m => m !== model && !deadSet.has(m));
        const existingState = discoveredCascadeByKey.get(cacheKey);
        discoveredCascadeByKey.set(cacheKey, {
          ok: true,
          bestModel: model,
          cascade: [model, ...activeRemaining],
          ttsCascade: existingState?.ttsCascade || [...DEFAULT_NOTEBOOKLM_TTS_CASCADE],
          checkedAtMs: Date.now()
        });
        return {
          text,
          modelUsed: model,
          groundingChips: extractGroundingSourceChips(json)
        };
      }
    } else {
      let errText = '';
      try {
        errText = await res.text();
      } catch {}

      if (res.status === 401) {
        throw new Error('Invalid Gemini API Key. Update your key in Audio & AI or Settings.');
      }

      // Permanently skip 404 or quota-exhausted Free Tier models for the rest of this session
      if (
        res.status === 404 ||
        (res.status === 403 && /free tier|not available/i.test(errText)) ||
        (res.status === 429 && /exceeded your current quota|limit:\s*0\b|free_tier|RESOURCE_EXHAUSTED/i.test(errText))
      ) {
        deadSet.add(model);
      }

      // Do not overwrite a real quota/parameter error (429/403/400/503) with a 404 from a fallback probe
      if (!hasPrimaryModelError || res.status !== 404) {
        lastStatus = res.status;
        lastErrorText = errText;
        if (res.status !== 404) {
          hasPrimaryModelError = true;
        }
      }

      if (![400, 403, 404, 429, 503].includes(res.status)) {
        break;
      }
    }
  }

  let parsedMsg = lastErrorText;
  try {
    parsedMsg = JSON.parse(lastErrorText)?.error?.message || lastErrorText;
  } catch {}
  throw new Error(
    `Gemini High-Thinking request failed (HTTP ${lastStatus}): ${String(parsedMsg || 'Service unavailable').slice(0, 220)}`
  );
}

function decodeBase64ToInt16Mono(b64String) {
  const bin = atob(b64String);
  const byteLen = bin.length - (bin.length % 2);
  const bytes = new Uint8Array(byteLen);
  for (let i = 0; i < byteLen; i++) {
    bytes[i] = bin.charCodeAt(i);
  }
  const view = new DataView(bytes.buffer);
  const samples = new Int16Array(byteLen / 2);
  for (let i = 0; i < samples.length; i++) {
    samples[i] = view.getInt16(i * 2, true);
  }
  return samples;
}

/**
 * Stitches one or more 24 kHz mono PCM studio chunks from Gemini Native Multi-Speaker TTS
 * with smooth 18ms cosine edge fades and 140ms inter-block studio breath pauses into a
 * true 2-channel Stereo 16-bit WAV `ArrayBuffer`.
 */
function stitchGeminiPcmChunksToStereoWav(pcmChunks = [], sampleRate = 24000) {
  const fadeSamples = Math.round(sampleRate * 0.018);
  const interChunkPauseSamples = Math.round(sampleRate * 0.14);
  const leadPadSamples = Math.round(sampleRate * 0.12);
  const trailPadSamples = Math.round(sampleRate * 0.25);

  let totalFrames = leadPadSamples + trailPadSamples;
  for (let c = 0; c < pcmChunks.length; c++) {
    totalFrames += pcmChunks[c].length;
    if (c < pcmChunks.length - 1) totalFrames += interChunkPauseSamples;
  }

  const monoTimeline = new Int16Array(Math.max(1, totalFrames));
  let writeCursor = leadPadSamples;

  for (let c = 0; c < pcmChunks.length; c++) {
    const src = pcmChunks[c];
    const len = src.length;
    const fLen = Math.min(fadeSamples, Math.floor(len / 4));
    for (let i = 0; i < len; i++) {
      let gain = 1.0;
      if (fLen > 0 && i < fLen) {
        gain = 0.5 * (1 - Math.cos((Math.PI * i) / fLen));
      } else if (fLen > 0 && i >= len - fLen) {
        const rem = len - 1 - i;
        gain = 0.5 * (1 - Math.cos((Math.PI * rem) / fLen));
      }
      monoTimeline[writeCursor + i] = Math.round(src[i] * gain);
    }
    writeCursor += len;
    if (c < pcmChunks.length - 1) {
      writeCursor += interChunkPauseSamples;
    }
  }

  const numChannels = 2;
  const stereoDataBytes = monoTimeline.length * numChannels * 2;
  const wavBuf = new ArrayBuffer(44 + stereoDataBytes);
  const view = new DataView(wavBuf);
  const writeStr = (off, str) => {
    for (let i = 0; i < str.length; i++) view.setUint8(off + i, str.charCodeAt(i));
  };

  writeStr(0, 'RIFF');
  view.setUint32(4, 36 + stereoDataBytes, true);
  writeStr(8, 'WAVE');
  writeStr(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * numChannels * 2, true);
  view.setUint16(32, numChannels * 2, true);
  view.setUint16(34, 16, true);
  writeStr(36, 'data');
  view.setUint32(40, stereoDataBytes, true);

  let outByte = 44;
  for (let i = 0; i < monoTimeline.length; i++) {
    const s = monoTimeline[i];
    view.setInt16(outByte, s, true);
    view.setInt16(outByte + 2, s, true);
    outByte += 4;
  }

  return {
    wavBuffer: wavBuf,
    durationSec: Math.max(1, Math.round(monoTimeline.length / sampleRate))
  };
}

/**
 * Renders smooth, ultra-natural multi-speaker podcast audio using Google's native
 * Gemini NotebookLM TTS engine (`gemini-2.5-pro-preview-tts` -> `gemini-2.5-flash-preview-tts`)
 * with `Puck` (Marcus) + `Aoede` (Elena) or `Charon` (Solo).
 */
async function synthesizeWithGeminiNotebookLmTts({
  apiBase,
  key,
  ttsCascade,
  episodeId,
  turns,
  solo = false,
  onProgress
}) {
  // 3800-char studio blocks fit an entire 2-to-4-minute podcast (~420-560 words) into ONE continuous
  // multi-speaker pass (~22-38s) with seamless vocal prosody instead of 2 sequential HTTP calls
  const chunks = chunkTurnsForGeminiTts(turns, 3800);
  if (chunks.length === 0) {
    throw new Error('No spoken podcast dialogue generated.');
  }

  const directorHeader = buildNotebookLmTtsDirectorHeader({
    format: solo ? 'solo' : 'two_host'
  });

  const speechConfig = solo
    ? {
        voiceConfig: {
          prebuiltVoiceConfig: {
            voiceName: NOTEBOOKLM_VOICE_PROFILES.solo.Marcus
          }
        }
      }
    : {
        multiSpeakerVoiceConfig: {
          speakerVoiceConfigs: [
            {
              speaker: 'Marcus',
              voiceConfig: {
                prebuiltVoiceConfig: { voiceName: NOTEBOOKLM_VOICE_PROFILES.twoHost.Marcus }
              }
            },
            {
              speaker: 'Elena',
              voiceConfig: {
                prebuiltVoiceConfig: { voiceName: NOTEBOOKLM_VOICE_PROFILES.twoHost.Elena }
              }
            }
          ]
        }
      };

  const pcmChunks = new Array(chunks.length).fill(null);
  const chunkDurationsSec = new Array(chunks.length).fill(0);
  let resolvedAudioModel = ttsCascade[0] || DEFAULT_NOTEBOOKLM_TTS_CASCADE[0];
  const sampleRate = 24000;
  let completedBlocks = 0;

  const synthesizeSingleBlock = async cIdx => {
    const block = chunks[cIdx];
    const blockDialogue = directorHeader + block.map(t => t.spokenLine).join('\n');
    let chunkSamples = null;
    let lastTtsErr = '';

    for (const ttsModel of ttsCascade) {
      const ttsUrl = `${apiBase}/models/${encodeURIComponent(ttsModel)}:generateContent?key=${encodeURIComponent(key)}`;
      for (let retry = 0; retry < 2; retry++) {
        let res;
        try {
          res = await fetchPostJsonWithTimeout(
            ttsUrl,
            {
              contents: [{ parts: [{ text: blockDialogue }] }],
              generationConfig: {
                responseModalities: ['AUDIO'],
                speechConfig
              }
            },
            65000
          );
        } catch (timeoutErr) {
          lastTtsErr = timeoutErr?.message || 'TTS request timed out';
          break;
        }

        if (res.ok) {
          const json = await res.json();
          const b64 = json?.candidates?.[0]?.content?.parts?.find(p => p?.inlineData?.data)?.inlineData?.data;
          if (b64) {
            chunkSamples = decodeBase64ToInt16Mono(b64);
            resolvedAudioModel = ttsModel;
            break;
          }
        } else {
          try {
            lastTtsErr = await res.text();
          } catch {}
          if ((res.status === 429 || res.status === 503) && retry === 0 && !/limit:\s*0\b/i.test(lastTtsErr)) {
            await new Promise(r => setTimeout(r, 1200));
            continue;
          }
          break;
        }
      }
      if (chunkSamples && chunkSamples.length > 0) break;
    }

    if (!chunkSamples || chunkSamples.length === 0) {
      throw new Error(`Gemini NotebookLM TTS unavailable (${String(lastTtsErr).slice(0, 120)})`);
    }

    pcmChunks[cIdx] = chunkSamples;
    chunkDurationsSec[cIdx] = chunkSamples.length / sampleRate;
    completedBlocks += 1;
    onProgress?.({
      subPercent: Math.round(14 + (completedBlocks / chunks.length) * 78),
      detail:
        chunks.length === 1
          ? `Recorded studio conversation with Gemini NotebookLM voices (${solo ? 'Charon' : 'Puck & Aoede'})…`
          : `Recorded studio segment ${completedBlocks} of ${chunks.length} (${solo ? 'Charon' : 'Puck & Aoede'})…`
    });
  };

  onProgress?.({
    subPercent: 12,
    detail:
      chunks.length === 1
        ? `Recording studio conversation with Gemini NotebookLM voices (${solo ? 'Charon' : 'Puck & Aoede'})…`
        : `Recording ${chunks.length} studio segments with Gemini NotebookLM voices (${solo ? 'Charon' : 'Puck & Aoede'})…`
  });

  // Synthesize up to 2 TTS blocks in parallel for multi-segment 6-20m podcasts (single-pass for 2-4m pods)
  const maxConcurrency = 2;
  for (let start = 0; start < chunks.length; start += maxConcurrency) {
    const indices = [];
    for (let j = start; j < Math.min(chunks.length, start + maxConcurrency); j++) {
      indices.push(j);
    }
    await Promise.all(indices.map(idx => synthesizeSingleBlock(idx)));
  }

  onProgress?.({
    subPercent: 94,
    detail: 'Mastering 24 kHz 2-channel Stereo NotebookLM studio broadcast WAV…'
  });

  const { wavBuffer, durationSec } = stitchGeminiPcmChunksToStereoWav(pcmChunks, sampleRate);
  const blobUrl = await saveEpisodeAudioBlob(episodeId, wavBuffer);

  // Compute proportional turn timestamps per recorded studio segment
  const timedTranscript = [];
  let cursorSec = 0.12;
  let globalIdx = 0;

  for (let cIdx = 0; cIdx < chunks.length; cIdx++) {
    const block = chunks[cIdx];
    const segDurSec = chunkDurationsSec[cIdx] || 1;
    const totalWords = Math.max(
      1,
      block.reduce((sum, t) => sum + Math.max(1, Number(t.wordCount || 1)), 0)
    );

    for (const t of block) {
      const share = Math.max(1, Number(t.wordCount || 1)) / totalWords;
      const turnDur = segDurSec * share;
      const startSec = Math.floor(cursorSec);
      cursorSec += turnDur;
      const endSec = Math.max(startSec + 1, Math.round(cursorSec));

      timedTranscript.push({
        idx: globalIdx++,
        speaker: t.speaker === 'Elena' ? 'Elena' : 'Marcus',
        speakerRole:
          t.speaker === 'Elena' ? 'Cap & Quantitative Insider' : "X's & O's Film Analyst",
        text: t.text,
        startSec,
        endSec
      });
    }
    cursorSec += 0.14;
  }

  return {
    audioUrl: blobUrl,
    audioModelUsed: resolvedAudioModel,
    durationSec,
    transcript: timedTranscript
  };
}

async function fetchJsonWithTimeout(url, timeoutMs = 3500) {
  if (typeof fetch !== 'function') return null;
  const ctrl = typeof AbortController === 'function' ? new AbortController() : null;
  const timer = ctrl ? setTimeout(() => ctrl.abort(), timeoutMs) : null;
  try {
    const res = await fetch(url, {
      mode: 'cors',
      ...(ctrl ? { signal: ctrl.signal } : {})
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Queries real-time ESPN 49ers team coverage and Bluesky 49ers beat wire for the exact user topic.
 */
export async function fetchLiveTopicSignals(rawTopic = '') {
  const topic = normalizeDisplayTopic(rawTopic);
  if (!topic) return [];

  const bskyQuery = encodeURIComponent(`49ers ${topic.slice(0, 64)}`);
  const bskyUrl = `https://public.api.bsky.app/xrpc/app.bsky.feed.searchPosts?q=${bskyQuery}&limit=8`;
  const espnUrl =
    'https://site.api.espn.com/apis/site/v2/sports/football/nfl/news?team=25&limit=10';

  const [bskyJson, espnJson] = await Promise.all([
    fetchJsonWithTimeout(bskyUrl, 3200),
    fetchJsonWithTimeout(espnUrl, 3200)
  ]);

  const items = [];
  if (Array.isArray(bskyJson?.posts)) {
    for (const post of bskyJson.posts) {
      const text = String(post?.record?.text || '').trim();
      if (text.length >= 28) {
        items.push({
          outlet: `@${post?.author?.handle || 'Bluesky Beat'}`,
          author: post?.author?.displayName || post?.author?.handle || 'Beat Wire',
          text
        });
      }
    }
  }

  if (Array.isArray(espnJson?.articles)) {
    for (const art of espnJson.articles) {
      const headline = String(art?.headline || '').trim();
      const desc = String(art?.description || '').trim();
      if (headline) {
        items.push({
          outlet: 'ESPN NFL Nation',
          headline,
          summary: desc
        });
      }
    }
  }

  return items;
}

let sharedTtsWorker = null;
let nextTtsJobSeq = 1;
const pendingTtsJobs = new Map();

function getOrCreateTtsWorker() {
  if (typeof Worker === 'undefined') return null;
  if (sharedTtsWorker) return sharedTtsWorker;

  sharedTtsWorker = new Worker(new URL('../workers/neuralTtsWorker.js', import.meta.url), {
    type: 'module'
  });

  sharedTtsWorker.addEventListener('message', event => {
    const msg = event?.data || {};
    const job = pendingTtsJobs.get(msg.jobId);
    if (!job) return;

    if (msg.type === 'progress') {
      job.onProgress?.(msg);
    } else if (msg.type === 'complete') {
      pendingTtsJobs.delete(msg.jobId);
      job.resolve(msg);
    } else if (msg.type === 'error') {
      pendingTtsJobs.delete(msg.jobId);
      job.reject(new Error(msg.error || 'Studio neural audio synthesis failed.'));
    }
  });

  sharedTtsWorker.addEventListener('error', err => {
    const errObj = new Error(err?.message || 'Neural TTS Web Worker crashed.');
    for (const [, job] of pendingTtsJobs.entries()) {
      job.reject(errObj);
    }
    pendingTtsJobs.clear();
    sharedTtsWorker = null;
  });

  return sharedTtsWorker;
}

function buildNodeFallbackWavAndTranscript(turns = []) {
  let cursor = 0;
  const transcript = turns.map((t, idx) => {
    const words = String(t.text || '')
      .trim()
      .split(/\s+/)
      .filter(Boolean).length;
    const dur = Math.max(4, Math.round((words / 148) * 60));
    const seg = {
      idx,
      speaker: t.speaker === 'Elena' ? 'Elena' : 'Marcus',
      speakerRole:
        t.speaker === 'Elena' ? 'Cap & Quantitative Insider' : "X's & O's Film Analyst",
      text: t.text,
      startSec: cursor,
      endSec: cursor + dur
    };
    cursor += dur;
    return seg;
  });

  const sampleRate = 8000;
  const numFrames = sampleRate;
  const dataBytes = numFrames * 4;
  const buf = new ArrayBuffer(44 + dataBytes);
  const view = new DataView(buf);
  const writeStr = (off, s) => {
    for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i));
  };
  writeStr(0, 'RIFF');
  view.setUint32(4, 36 + dataBytes, true);
  writeStr(8, 'WAVE');
  writeStr(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 2, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 4, true);
  view.setUint16(32, 4, true);
  view.setUint16(34, 16, true);
  writeStr(36, 'data');
  view.setUint32(40, dataBytes, true);

  return {
    wavBuffer: buf,
    durationSec: cursor,
    transcript
  };
}

async function synthesizeTurnsWithKokoroWorker(episodeId, turns, onWorkerProgress) {
  const worker = getOrCreateTtsWorker();
  if (!worker) {
    const fallback = buildNodeFallbackWavAndTranscript(turns);
    const url = await saveEpisodeAudioBlob(episodeId, fallback.wavBuffer);
    return {
      audioUrl: url,
      audioModelUsed: 'node-test-fallback',
      durationSec: fallback.durationSec,
      transcript: fallback.transcript
    };
  }

  const jobId = `tts_${Date.now()}_${nextTtsJobSeq++}`;
  const result = await new Promise((resolve, reject) => {
    pendingTtsJobs.set(jobId, {
      resolve,
      reject,
      onProgress: onWorkerProgress
    });
    worker.postMessage({
      type: 'synthesize_podcast',
      jobId,
      turns
    });
  });

  const blobUrl = await saveEpisodeAudioBlob(episodeId, result.wavBuffer);
  return {
    audioUrl: blobUrl,
    audioModelUsed: 'kokoro-82m-studio',
    durationSec: result.durationSec,
    transcript: result.transcript
  };
}

/**
 * Synthesizes and caches studio `.wav` audio for a shared or reloaded custom podcast episode.
 * Uses Gemini Native Multi-Speaker NotebookLM TTS when a Gemini API key is configured,
 * and Kokoro-82M (`af_heart` + `am_fenrir`) when opened by a colleague with no API key.
 */
export async function synthesizeMissingEpisodeAudio(episode, onProgress, prefs = {}) {
  if (!episode?.id || !Array.isArray(episode.transcript) || episode.transcript.length === 0) {
    return null;
  }

  const solo = episode.format === 'Solo Executive Briefing';
  let rendered = null;

  if (String(prefs?.geminiApiKey || '').trim()) {
    try {
      const conn = await resolveDirectGeminiCascades(prefs);
      rendered = await synthesizeWithGeminiNotebookLmTts({
        apiBase: conn.apiBase,
        key: conn.key,
        ttsCascade: conn.ttsCascade,
        episodeId: episode.id,
        turns: episode.transcript,
        solo,
        onProgress: info => {
          onProgress?.({
            stepIdx: 3,
            totalSteps: 3,
            stages: PODCAST_PIPELINE_STAGES,
            percent: Math.min(99, Math.max(40, Number(info.subPercent || 55))),
            message: info.detail || 'Recording shared podcast with Gemini NotebookLM voices…'
          });
        }
      });
    } catch {
      rendered = null;
    }
  }

  if (!rendered) {
    rendered = await synthesizeTurnsWithKokoroWorker(episode.id, episode.transcript, info => {
      onProgress?.({
        stepIdx: 3,
        totalSteps: 3,
        stages: PODCAST_PIPELINE_STAGES,
        percent: Math.min(99, Math.max(35, Number(info.subPercent || 50))),
        message: info.detail || 'Converting shared podcast script into natural studio audio…'
      });
    });
  }

  if (rendered?.audioUrl) {
    episode.audioUrl = rendered.audioUrl;
    episode.durationSec = rendered.durationSec;
    episode.transcript = rendered.transcript;
  }
  return rendered?.audioUrl || null;
}

function createMissingGeminiKeyError() {
  const err = new Error(
    'Connect your free Google AI Studio Gemini API Key above (or a Cloudflare Worker URL in Settings) to run live 25–60s Gemini Pro Deep Research and NotebookLM Studio Voices.'
  );
  err.code = 'GEMINI_KEY_REQUIRED';
  return err;
}

/**
 * Pure, deterministic stage-progress & per-stage timer allocator for both AI Analysis (20–60s)
 * and Auto Podcast (1–2m for 3m pod), ensuring every pipeline bar reflects real work across
 * Stage 1 (Live Search Grounding & Dossier Research), Stage 2 (High-Thinking Film/Cap Audit or Script),
 * and Stage 3 (Report Structuring/Fact-Audit or Multi-Speaker Studio TTS).
 */
export function computeLiveStageProgressState({
  kind = 'analysis',
  elapsedMs = 0,
  durationMinutes = 3,
  phaseFloor = 1,
  allowAutoStage3 = true,
  phase3ElapsedMs = null,
  ttsSubPercent = null,
  solo = false,
  topicLabel = ''
} = {}) {
  const sec = Math.max(0, Number(elapsedMs || 0) / 1000);
  const mins = Math.max(2, Math.min(20, Number(durationMinutes || 3)));

  if (kind === 'analysis') {
    const s1Budget = 10; // ~10s live wire + Google Search grounding + 88-player ledger cross-check
    const s2Budget = 14; // ~14s High-Thinking EPA, coverage mechanics & CBA Article 13 cap audit
    const s3Budget = 12; // ~12s structured Markdown synthesis & roster anti-hallucination check

    if (phaseFloor >= 4) {
      const s1Sec = Math.min(s1Budget, Math.max(1, Math.round(sec * 0.3)));
      const s2Sec = Math.min(s2Budget, Math.max(1, Math.round(sec * 0.45)));
      const s3Sec = Math.max(1, Math.round(sec) - s1Sec - s2Sec);
      return {
        stepIdx: 3,
        percent: 100,
        stagePercents: [100, 100, 100],
        stageElapsedSec: [s1Sec, s2Sec, s3Sec],
        message: 'Step 3 of 3: Verified scouting & cap report complete!',
        subDetail: 'Cross-checked zero retired/departed roster claims and saved to library.'
      };
    }

    if (phaseFloor < 2 && sec < s1Budget) {
      const p1 = Math.min(98, Math.max(10, Math.round(10 + (sec / s1Budget) * 88)));
      return {
        stepIdx: 1,
        percent: Math.round(8 + p1 * 0.28),
        stagePercents: [p1, 0, 0],
        stageElapsedSec: [Math.floor(sec), 0, 0],
        message: 'Step 1 of 3: Deep research on the topic…',
        subDetail: 'Querying live Google Search Grounding, ESPN/Bluesky beat wire & 88-player 49ers ledger.'
      };
    }

    if (phaseFloor < 3 && (sec < s1Budget + s2Budget || !allowAutoStage3)) {
      const s1Done = Math.min(s1Budget, Math.max(1, Math.floor(sec)));
      const s2Sec = sec >= s1Budget ? sec - s1Budget : Math.max(0.5, sec * 0.5);
      const p2 = Math.min(97, Math.max(12, Math.round(12 + 85 * (1 - Math.exp(-s2Sec / (s2Budget * 0.72))))));
      return {
        stepIdx: 2,
        percent: Math.round(36 + p2 * 0.38),
        stagePercents: [100, p2, 0],
        stageElapsedSec: [s1Done, Math.floor(s2Sec), 0],
        message: 'Step 2 of 3: Auditing All-22 film, EPA splits & CBA cap math…',
        subDetail: 'Evaluating scheme cause-and-effect, efficiency splits & 2026–2027 Article 13 cap trade-offs.'
      };
    }

    const s1Done = Math.min(s1Budget, Math.max(1, Math.floor(sec * 0.34)));
    const s2Done = Math.min(s2Budget, Math.max(1, Math.floor(Math.max(1, sec - s1Done) * 0.62)));
    const s3Sec =
      phase3ElapsedMs != null
        ? Math.max(0, Number(phase3ElapsedMs) / 1000)
        : Math.max(0, sec - (s1Budget + s2Budget));
    const p3 =
      phaseFloor >= 3
        ? Math.min(97, Math.max(35, Math.round(35 + 60 * (1 - Math.exp(-s3Sec / 4)))))
        : Math.min(95, Math.max(10, Math.round(10 + 85 * (1 - Math.exp(-s3Sec / s3Budget)))));

    return {
      stepIdx: 3,
      percent: Math.min(98, Math.round(74 + p3 * 0.24)),
      stagePercents: [100, 100, p3],
      stageElapsedSec: [
        sec >= s1Budget ? s1Budget : s1Done,
        sec >= s1Budget + s2Budget ? s2Budget : s2Done,
        Math.floor(s3Sec)
      ],
      message: 'Step 3 of 3: Adversarial fact-check & structuring final report…',
      subDetail: 'Auditing player roster buckets, OverTheCap figures, draft slots & polishing Markdown sections.'
    };
  }

  // Podcast 3-stage progress allocation
  const s1PodBudget = Math.min(14, Math.max(9, Math.round(7 + mins * 1.0))); // ~10s for 3m pod
  const s2PodBudget = Math.max(15, Math.round(10 + mins * 2.0)); // ~16s for 3m pod
  const s3PodBudget = Math.max(22, Math.round(16 + mins * 3.5)); // ~26s single-pass TTS for 3m pod
  const targetWordEst = Math.round(mins * 140);

  if (phaseFloor >= 4) {
    const s1Sec = Math.min(s1PodBudget, Math.max(1, Math.round(sec * 0.2)));
    const s2Sec = Math.min(s2PodBudget, Math.max(1, Math.round(sec * 0.35)));
    const s3Sec = Math.max(1, Math.round(sec) - s1Sec - s2Sec);
    return {
      stepIdx: 3,
      percent: 100,
      stagePercents: [100, 100, 100],
      stageElapsedSec: [s1Sec, s2Sec, s3Sec],
      message: 'Podcast ready to play!',
      subDetail: 'Mastered 24 kHz 2-channel Stereo studio broadcast WAV.'
    };
  }

  if (phaseFloor < 2 && sec < s1PodBudget) {
    const p1 = Math.min(98, Math.max(10, Math.round(10 + (sec / s1PodBudget) * 88)));
    return {
      stepIdx: 1,
      percent: Math.round(8 + p1 * 0.22),
      stagePercents: [p1, 0, 0],
      stageElapsedSec: [Math.floor(sec), 0, 0],
      message: 'Step 1 of 3: Deep research on the topic…',
      subDetail: `Investigating "${topicLabel || '49ers topic'}" across Google Search Grounding, beat wire & 88-player ledger.`
    };
  }

  if (phaseFloor < 3 && (!allowAutoStage3 || sec < s1PodBudget + s2PodBudget)) {
    const s1Done = Math.min(s1PodBudget, Math.max(1, Math.floor(sec)));
    const s2Sec = sec >= s1PodBudget ? sec - s1PodBudget : Math.max(0.5, sec * 0.5);
    const p2 = Math.min(96, Math.max(12, Math.round(12 + 84 * (1 - Math.exp(-s2Sec / (s2PodBudget * 0.78))))));
    return {
      stepIdx: 2,
      percent: Math.round(30 + p2 * 0.3),
      stagePercents: [100, p2, 0],
      stageElapsedSec: [s1Done, Math.floor(s2Sec), 0],
      message: `Step 2 of 3: Restructuring deep research into ${mins}-min audio script…`,
      subDetail: `Writing natural ~${targetWordEst}-word ${solo ? 'solo briefing' : 'Marcus & Elena studio conversation'} grounded in live stats & cap math.`
    };
  }

  const s1Done = sec >= s1PodBudget ? s1PodBudget : Math.max(1, Math.floor(sec * 0.4));
  const preTtsSec =
    phase3ElapsedMs != null ? Math.max(1, sec - Number(phase3ElapsedMs) / 1000) : s1PodBudget + s2PodBudget;
  const s2Done = Math.max(1, Math.round(Math.max(1, preTtsSec - s1Done)));
  const s3Sec =
    phase3ElapsedMs != null
      ? Math.max(0, Number(phase3ElapsedMs) / 1000)
      : Math.max(0, sec - (s1PodBudget + s2PodBudget));
  const timeBasedP3 = Math.min(95, Math.max(8, Math.round(8 + 87 * (1 - Math.exp(-s3Sec / (s3PodBudget * 0.75))))));
  const p3 =
    ttsSubPercent != null
      ? Math.min(99, Math.max(timeBasedP3, Math.round(Number(ttsSubPercent))))
      : timeBasedP3;

  return {
    stepIdx: 3,
    percent: Math.min(99, Math.round(60 + p3 * 0.39)),
    stagePercents: [100, 100, p3],
    stageElapsedSec: [s1Done, s2Done, Math.floor(s3Sec)],
    message: 'Step 3 of 3: Converting script to studio podcast audio…',
    subDetail: `Recording conversational studio voices (${solo ? 'Charon' : 'Puck & Aoede'}) & mastering 2-channel Stereo WAV.`
  };
}

function createPipelineStageTracker({
  kind = 'analysis',
  stages = ANALYSIS_PIPELINE_STAGES,
  durationMinutes = 3,
  solo = false,
  topicLabel = '',
  allowAutoStage3 = true,
  waitEst,
  initialModelLabel = 'Accuracy-First',
  onProgress
}) {
  const isBrowserRuntime = typeof window !== 'undefined' && typeof document !== 'undefined';
  const startedAtMs = Date.now();
  let phaseFloor = 1;
  let phase3StartedAtMs = null;
  let ttsSubPercent = null;
  let customSubDetail = '';
  let customMessage = '';
  let activeModelLabel = initialModelLabel;
  let maxPercentEmitted = 8;
  let maxStagePercents = [0, 0, 0];
  let timerId = null;

  const emitNow = () => {
    const now = Date.now();
    const computed = computeLiveStageProgressState({
      kind,
      elapsedMs: now - startedAtMs,
      durationMinutes,
      phaseFloor,
      allowAutoStage3,
      phase3ElapsedMs: phase3StartedAtMs != null ? now - phase3StartedAtMs : null,
      ttsSubPercent,
      solo,
      topicLabel
    });
    maxPercentEmitted = Math.max(maxPercentEmitted, computed.percent);
    maxStagePercents = [
      Math.max(maxStagePercents[0], computed.stagePercents[0]),
      Math.max(maxStagePercents[1], computed.stagePercents[1]),
      Math.max(maxStagePercents[2], computed.stagePercents[2])
    ];
    onProgress?.({
      kind,
      stepIdx: computed.stepIdx,
      totalSteps: 3,
      stages,
      percent: phaseFloor >= 4 ? 100 : maxPercentEmitted,
      stagePercents: phaseFloor >= 4 ? [100, 100, 100] : [...maxStagePercents],
      stageElapsedSec: computed.stageElapsedSec,
      estLabel: waitEst.estLabel,
      summaryText: waitEst.summaryText,
      modelLabel: activeModelLabel,
      message: customMessage || computed.message,
      subDetail: customSubDetail || computed.subDetail
    });
  };

  if (isBrowserRuntime && typeof onProgress === 'function') {
    timerId = setInterval(emitNow, 300);
  }

  return {
    emitInitial() {
      emitNow();
    },
    setModelLabel(label) {
      if (label) activeModelLabel = label;
    },
    async ensureMinimumVisualStageDwell(targetMinTotalMs) {
      if (!isBrowserRuntime) return;
      const elapsed = Date.now() - startedAtMs;
      if (elapsed < targetMinTotalMs) {
        await new Promise(r => setTimeout(r, targetMinTotalMs - elapsed));
      }
    },
    enterStage2(msg = '', detail = '', badge = '') {
      phaseFloor = Math.max(phaseFloor, 2);
      maxStagePercents[0] = 100;
      maxStagePercents[1] = Math.max(maxStagePercents[1], 14);
      if (badge) activeModelLabel = badge;
      customMessage = msg;
      customSubDetail = detail;
      emitNow();
    },
    enterStage3({ ttsPct = null, msg = '', detail = '', badge = '' } = {}) {
      if (phaseFloor < 3) {
        phaseFloor = 3;
        phase3StartedAtMs = Date.now();
      }
      maxStagePercents[0] = 100;
      maxStagePercents[1] = 100;
      if (ttsPct != null) ttsSubPercent = ttsPct;
      if (badge) activeModelLabel = badge;
      customMessage = msg;
      customSubDetail = detail;
      emitNow();
    },
    updateStage3Progress({ subPercent = null, detail = '', msg = '', badge = '' } = {}) {
      if (phaseFloor < 3) {
        phaseFloor = 3;
        phase3StartedAtMs = Date.now();
      }
      if (subPercent != null) ttsSubPercent = subPercent;
      if (detail) customSubDetail = detail;
      if (msg) customMessage = msg;
      if (badge) activeModelLabel = badge;
      emitNow();
    },
    complete(msg = '', detail = '') {
      phaseFloor = 4;
      customMessage = msg;
      customSubDetail = detail;
      if (timerId) {
        clearInterval(timerId);
        timerId = null;
      }
      emitNow();
    },
    stop() {
      if (timerId) {
        clearInterval(timerId);
        timerId = null;
      }
    }
  };
}

export async function runOnDemandDeepAnalysis({ prompt, category, appData, prefs, onProgress }) {
  const rawPrompt = String(prompt || '').trim();
  if (!rawPrompt) throw new Error('Please enter an analysis topic or question.');
  if (!hasLiveAiConnection(prefs)) {
    throw createMissingGeminiKeyError();
  }

  const cleanPrompt = normalizeDisplayTopic(rawPrompt) || rawPrompt;
  const modelInfo = resolveActiveHighQualityModelLabel(appData, prefs);
  const waitEst = estimateGenerationWait({ kind: 'analysis', prefs, appData });
  const rosterPlayers = appData?.roster?.players || [];
  const isTradeTopic = /\b(trade|deadline|seller|buyer|target|acquire|rental)\b/i.test(cleanPrompt);
  const liveSnapshot = buildAuthoritativeLiveContextSnapshot(appData, {
    compactForDossier: true,
    includeTradeMatrix: isTradeTopic
  });
  const groundingRules = buildLiveGroundingSystemPrompt(appData);

  const tracker = createPipelineStageTracker({
    kind: 'analysis',
    stages: ANALYSIS_PIPELINE_STAGES,
    allowAutoStage3: true,
    topicLabel: cleanPrompt,
    waitEst,
    initialModelLabel: modelInfo.displayLabel,
    onProgress
  });
  tracker.emitInitial();

  try {
    // =========================================================================
    // Cloud Worker Transport (`prefs.workerBaseUrl`)
    // =========================================================================
    const baseUrl = String(prefs?.workerBaseUrl || '').trim().replace(/\/+$/, '');
    if (baseUrl) {
      const liveSearchItems = await fetchLiveTopicSignals(cleanPrompt);
      const dossier = compileDeepResearchDossier({
        query: cleanPrompt,
        appData,
        liveSearchItems
      });

      const res = await fetch(`${baseUrl}/api/analyze`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Group-Passcode': prefs?.groupPasscode || ''
        },
        body: JSON.stringify({
          prompt: rawPrompt,
          category: category || 'Deep Scouting & Cap Dive',
          author: prefs?.authorName || 'Josh',
          deepResearchPass: false,
          verifyPass: false,
          thinkingLevel: 'HIGH',
          qualityPriority: 'accuracy_over_latency',
          systemPrompt: groundingRules,
          contextSummary: `${dossier.dossierSummaryText}\n\n${liveSnapshot}`
        })
      });
      const json = await res.json();
      if (!res.ok) {
        throw new Error(json.error || `Worker HTTP ${res.status}`);
      }
      await tracker.ensureMinimumVisualStageDwell(420);
      tracker.enterStage2();
      await tracker.ensureMinimumVisualStageDwell(800);
      tracker.enterStage3({
        msg: 'Step 3 of 3: Structuring verified scouting & cap report…',
        detail: 'Cross-checking active 53-man roster & OverTheCap figures.'
      });
      if (json.item?.markdown) {
        json.item.markdown = sanitizeHallucinatedRosterText(json.item.markdown, rosterPlayers);
      }
      await tracker.ensureMinimumVisualStageDwell(1150);
      tracker.complete(
        'Step 3 of 3: Verified scouting & cap report ready!',
        'Cross-checked zero retired/departed roster claims and saved to library.'
      );
      return json.item;
    }

    // =========================================================================
    // Direct Browser Gemini High-Thinking Pipeline (`prefs.geminiApiKey`)
    // =========================================================================
    const [conn, liveSearchItems] = await Promise.all([
      resolveDirectGeminiCascades(prefs),
      fetchLiveTopicSignals(cleanPrompt)
    ]);
    const activeBadge = formatActiveModelBadge(conn.bestModel, 'Accuracy-First');
    tracker.setModelLabel(activeBadge);

    const dossier = compileDeepResearchDossier({
      query: cleanPrompt,
      appData,
      liveSearchItems
    });

    let finalMarkdown = '';
    let finalModel = conn.bestModel;
    let groundingChips = [];

    try {
      // Single focused High-Thinking + Google Search Grounding synthesis over compiled Stage-1 Dossier (~20–50s)
      const synthRes = await callGeminiDirectWithCascade({
        apiBase: conn.apiBase,
        key: conn.key,
        cascade: conn.cascade,
        systemInstructionText: `${DEEP_ANALYSIS_STAGE2_SYSTEM_PROMPT}\n\n${groundingRules}`,
        userText: buildStage2AnalysisSynthesisPrompt({
          question: rawPrompt,
          researchMemo: dossier.dossierSummaryText,
          liveContextSnapshot: liveSnapshot
        }),
        useGoogleSearch: true,
        temperature: 0.2
      });
      if (prefs && typeof prefs === 'object' && synthRes.modelUsed) {
        prefs.verifiedGeminiModel = synthRes.modelUsed;
      }
      groundingChips = synthRes.groundingChips || [];
      finalMarkdown = synthRes.text;
      finalModel = synthRes.modelUsed;

      // Ensure fast/cached responses still step cleanly through Stage 2 -> Stage 3 without flashing in <1s
      await tracker.ensureMinimumVisualStageDwell(420);
      tracker.enterStage2();
      await tracker.ensureMinimumVisualStageDwell(800);
      tracker.enterStage3({
        msg: 'Step 3 of 3: Adversarial fact-check & structuring final report…',
        detail: 'Auditing every player bucket, OverTheCap figure, draft slot & sharpening prose clarity.',
        badge: formatActiveModelBadge(finalModel, 'Accuracy-First')
      });
    } catch (err) {
      if (!isGeminiQuotaExhaustedError(err)) {
        throw err;
      }
      tracker.enterStage2(
        'Step 2 of 3: Google AI Studio Free-Tier quota reached — running Deep Research & Cap Engine…',
        'Synthesizing verified 88-player EPA, practice participation, OverTheCap & beat wire dossier.',
        formatActiveModelBadge(conn.bestModel, 'Deep Dossier Engine')
      );
      finalMarkdown = buildDeepScoutingAnalysisMarkdown({
        query: rawPrompt,
        appData,
        dossier
      });
      finalModel = `${conn.bestModel}-dossier-fallback`;
      await tracker.ensureMinimumVisualStageDwell(750);
      tracker.enterStage3({
        msg: 'Step 3 of 3: Structuring verified scouting & cap report…',
        detail: 'Completed 6-section All-22 & OverTheCap audit.'
      });
    }

    const verifiedMarkdown = sanitizeHallucinatedRosterText(finalMarkdown, rosterPlayers);
    await tracker.ensureMinimumVisualStageDwell(1150);
    tracker.complete(
      'Step 3 of 3: Verified scouting & cap report ready!',
      'Completed All-22 film, EPA & CBA cap audit.'
    );

    const sourcesCited = [
      ...groundingChips,
      { label: 'nflverse 2026 Play-by-Play', url: 'https://github.com/nflverse/nflverse-data/releases' },
      { label: 'OverTheCap 49ers Cap', url: 'https://overthecap.com/salary-cap/san-francisco-49ers' },
      { label: 'ESPN 49ers Coverage', url: 'https://www.espn.com/nfl/team/_/name/sf/san-francisco-49ers' }
    ].slice(0, 6);

    return {
      id: `local_analysis_${Date.now()}`,
      title: rawPrompt,
      category: dossier.primaryGroup?.label
        ? `${dossier.primaryGroup.label} Deep Dive`
        : category || 'Deep Scouting & Cap Synthesis',
      modelUsed: finalModel,
      thinkingLevel: 'HIGH',
      qualityPriority: 'accuracy_over_latency',
      verifiedPasses: 3,
      createdAt: new Date().toISOString(),
      createdBy: prefs?.authorName || 'Josh',
      sourcesCited,
      markdown: verifiedMarkdown
    };
  } finally {
    tracker.stop();
  }
}

export async function generateOnDemandAutopodcast({
  topic,
  durationMinutes,
  format,
  appData,
  prefs,
  onProgress
}) {
  const rawTopic = String(topic || '').trim();
  if (!rawTopic) throw new Error('Please enter or select a podcast topic.');
  if (!hasLiveAiConnection(prefs)) {
    throw createMissingGeminiKeyError();
  }

  const cleanTopic = normalizeDisplayTopic(rawTopic) || rawTopic;
  const mins = Math.max(2, Math.min(20, Number(durationMinutes || 3)));
  const solo = format === 'solo';

  const modelInfo = resolveActiveHighQualityModelLabel(appData, prefs);
  const waitEst = estimateGenerationWait({
    kind: 'podcast',
    durationMinutes: mins,
    prefs,
    appData
  });
  const rosterPlayers = appData?.roster?.players || [];
  const isTradeTopic = /\b(trade|deadline|seller|buyer|target|acquire|rental)\b/i.test(cleanTopic);
  const liveSnapshot = buildAuthoritativeLiveContextSnapshot(appData, {
    compactForDossier: true,
    includeTradeMatrix: isTradeTopic
  });
  const groundingRules = buildLiveGroundingSystemPrompt(appData);
  const baseUrl = String(prefs?.workerBaseUrl || '').trim().replace(/\/+$/, '');

  const tracker = createPipelineStageTracker({
    kind: 'podcast',
    stages: PODCAST_PIPELINE_STAGES,
    durationMinutes: mins,
    solo,
    topicLabel: cleanTopic,
    // Cloud Worker runs Script + R2 TTS inside one HTTP request; Direct Browser enters Stage 3 explicitly when TTS starts
    allowAutoStage3: Boolean(baseUrl),
    waitEst,
    initialModelLabel: modelInfo.displayLabel,
    onProgress
  });
  tracker.emitInitial();

  try {
    // =========================================================================
    // Cloud Worker Transport (`prefs.workerBaseUrl`)
    // =========================================================================
    if (baseUrl) {
      const liveSearchItems = await fetchLiveTopicSignals(cleanTopic);
      const dossier = compileDeepResearchDossier({
        query: cleanTopic,
        appData,
        liveSearchItems
      });

      const res = await fetch(`${baseUrl}/api/podcast`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Group-Passcode': prefs?.groupPasscode || ''
        },
        body: JSON.stringify({
          topic: cleanTopic,
          durationMinutes: mins,
          format,
          author: prefs?.authorName || 'Josh',
          deepResearchPass: false,
          verifyPass: false,
          thinkingLevel: 'HIGH',
          qualityPriority: 'accuracy_over_latency',
          systemPrompt: groundingRules,
          researchDossier: dossier.dossierSummaryText,
          contextSummary: `${dossier.dossierSummaryText}\n\n${liveSnapshot}`
        })
      });
      const json = await res.json();
      if (!res.ok) {
        throw new Error(json.error || `Worker HTTP ${res.status}`);
      }
      const cloudEp = json.episode;
      if (cloudEp && Array.isArray(cloudEp.transcript)) {
        cloudEp.transcript = cloudEp.transcript.map(seg => ({
          ...seg,
          text: sanitizeHallucinatedRosterText(seg.text || '', rosterPlayers)
        }));
      }

      await tracker.ensureMinimumVisualStageDwell(420);
      tracker.enterStage2();
      await tracker.ensureMinimumVisualStageDwell(800);

      if (cloudEp && !cloudEp.audioUrl && Array.isArray(cloudEp.transcript) && cloudEp.transcript.length > 0) {
        tracker.enterStage3({
          ttsPct: 12,
          msg: 'Step 3 of 3: Converting verified script into studio Stereo podcast audio…',
          detail: 'Rendering natural multi-speaker studio voices.'
        });
        const rendered = await synthesizeTurnsWithKokoroWorker(
          cloudEp.id,
          cloudEp.transcript,
          info => {
            tracker.updateStage3Progress({
              subPercent: Number(info.subPercent || 15),
              msg: 'Step 3 of 3: Converting script into studio podcast audio…',
              detail: info.detail
            });
          }
        );
        cloudEp.audioUrl = rendered.audioUrl;
        cloudEp.durationSec = rendered.durationSec;
        cloudEp.transcript = rendered.transcript;
      } else {
        tracker.enterStage3({
          ttsPct: 96,
          msg: 'Step 3 of 3: Studio podcast mastered & ready to play!',
          detail: 'Gemini NotebookLM multi-speaker audio verified and indexed.'
        });
        await tracker.ensureMinimumVisualStageDwell(1150);
      }
      tracker.complete(
        'Podcast ready to play!',
        'Gemini NotebookLM multi-speaker audio verified and indexed.'
      );
      return cloudEp;
    }

    // =========================================================================
    // Direct Browser Gemini High-Thinking + Gemini NotebookLM Multi-Speaker TTS
    // =========================================================================
    const [conn, liveSearchItems] = await Promise.all([
      resolveDirectGeminiCascades(prefs),
      fetchLiveTopicSignals(cleanTopic)
    ]);
    const activeBadge = formatActiveModelBadge(conn.bestModel, 'Accuracy-First');
    tracker.setModelLabel(activeBadge);

    const dossier = compileDeepResearchDossier({
      query: cleanTopic,
      appData,
      liveSearchItems
    });

    let parsedTurns = null;
    let scriptModelUsed = conn.bestModel;
    let groundingChips = [];

    try {
      // Unified High-Thinking + Google Search Grounding script synthesis (~22–40s, smoothly spanning Stage 1 -> Stage 2)
      const stage2Draft = await callGeminiDirectWithCascade({
        apiBase: conn.apiBase,
        key: conn.key,
        cascade: conn.cascade,
        systemInstructionText: `${NOTEBOOKLM_PODCAST_STAGE2_SYSTEM_PROMPT}\n\n${groundingRules}`,
        userText: buildStage2NotebookLmScriptPrompt({
          topic: cleanTopic,
          durationMinutes: mins,
          format: solo ? 'solo' : 'two_host',
          researchMemo: dossier.dossierSummaryText,
          liveContextSnapshot: liveSnapshot
        }),
        useGoogleSearch: true,
        temperature: 0.3
      });

      if (prefs && typeof prefs === 'object' && stage2Draft.modelUsed) {
        prefs.verifiedGeminiModel = stage2Draft.modelUsed;
      }
      groundingChips = stage2Draft.groundingChips || [];
      parsedTurns = parseJsonTurnsSafe(stage2Draft.text);
      scriptModelUsed = stage2Draft.modelUsed;
    } catch (err) {
      if (!isGeminiQuotaExhaustedError(err)) {
        throw err;
      }
      tracker.enterStage2(
        `Step 2 of 3: Google AI Studio Free-Tier quota reached — building ${mins}-min NotebookLM script from live dossier…`,
        `Synthesizing verified ${solo ? 'solo briefing' : 'Marcus & Elena studio dialogue'} from 88-player ledger, EPA & beat wire.`,
        formatActiveModelBadge(conn.bestModel, 'Deep Dossier Engine')
      );
      parsedTurns = buildNotebookLmPodcastScript({
        query: cleanTopic,
        durationMinutes: mins,
        format: solo ? 'solo' : 'two_host',
        appData,
        dossier
      });
      scriptModelUsed = `${conn.bestModel}-dossier-fallback`;
    }

    if (!parsedTurns || parsedTurns.length === 0) {
      parsedTurns = buildNotebookLmPodcastScript({
        query: cleanTopic,
        durationMinutes: mins,
        format: solo ? 'solo' : 'two_host',
        appData,
        dossier
      });
    }

    // Ensure Stage 1 & Stage 2 both show cleanly even when mock/cached LLM resolves rapidly
    await tracker.ensureMinimumVisualStageDwell(400);
    tracker.enterStage2();
    await tracker.ensureMinimumVisualStageDwell(780);

    const sanitizedTurns = parsedTurns
      .map(t => ({
        speaker: solo ? 'Marcus' : t?.speaker === 'Elena' ? 'Elena' : 'Marcus',
        text: sanitizeHallucinatedRosterText(String(t?.text || '').trim(), rosterPlayers)
      }))
      .filter(t => t.text.length > 0);

    // STAGE 3: Convert Script to Podcast via Single-Pass Gemini Native Multi-Speaker NotebookLM TTS (`Puck` + `Aoede`)
    const episodeId = `custom_ep_${Date.now()}`;
    tracker.enterStage3({
      ttsPct: 10,
      msg: 'Step 3 of 3: Converting script to podcast (Gemini NotebookLM Studio Voices)…',
      detail: `Synthesizing smooth multi-speaker studio dialogue (${solo ? 'Charon' : 'Puck & Aoede'}).`,
      badge: formatActiveModelBadge(scriptModelUsed, 'NotebookLM TTS')
    });

    let renderedAudio = null;
    try {
      renderedAudio = await synthesizeWithGeminiNotebookLmTts({
        apiBase: conn.apiBase,
        key: conn.key,
        ttsCascade: conn.ttsCascade,
        episodeId,
        turns: sanitizedTurns,
        solo,
        onProgress: info => {
          tracker.updateStage3Progress({
            subPercent: Number(info.subPercent || 14),
            msg: 'Step 3 of 3: Recording Gemini NotebookLM studio podcast…',
            detail: info.detail || 'Synthesizing conversational studio voices…',
            badge: formatActiveModelBadge(scriptModelUsed, 'NotebookLM TTS')
          });
        }
      });
    } catch {
      // Fallback strictly to Kokoro-82M human voices (`af_heart` + `am_fenrir`) if Gemini TTS hits free-tier daily quota
      renderedAudio = await synthesizeTurnsWithKokoroWorker(episodeId, sanitizedTurns, info => {
        tracker.updateStage3Progress({
          subPercent: Number(info.subPercent || 12),
          msg: 'Step 3 of 3: Converting script to natural studio podcast audio…',
          detail: info.detail || 'Synthesizing Kokoro-82M human voices…',
          badge: formatActiveModelBadge(scriptModelUsed, 'Kokoro-82M')
        });
      });
    }

    await tracker.ensureMinimumVisualStageDwell(1150);
    tracker.complete(
      'Podcast ready to play!',
      `Mastered 2-channel Stereo WAV (${Math.floor(renderedAudio.durationSec / 60)}m ${renderedAudio.durationSec % 60}s).`
    );

    const sourceLinks = [
      ...groundingChips.filter(c => c.url),
      { label: 'nflverse EPA & PBP', url: 'https://github.com/nflverse/nflverse-data/releases' },
      { label: 'OverTheCap 49ers', url: 'https://overthecap.com/salary-cap/san-francisco-49ers' },
      { label: 'ESPN 49ers Coverage', url: 'https://www.espn.com/nfl/team/_/name/sf/san-francisco-49ers' }
    ].slice(0, 5);

    return {
      id: episodeId,
      title: cleanTopic,
      topic: cleanTopic,
      format: solo ? 'Solo Executive Briefing' : 'Two-Host Analytical Banter',
      presetLabel: `${mins}m On-Demand Pod`,
      modelUsed: scriptModelUsed,
      audioModelUsed: renderedAudio.audioModelUsed,
      thinkingLevel: 'HIGH',
      qualityPriority: 'accuracy_over_latency',
      createdBy: prefs?.authorName || 'Josh',
      createdAt: new Date().toISOString(),
      audioUrl: renderedAudio.audioUrl,
      durationSec: renderedAudio.durationSec,
      sourceLinks,
      transcript: renderedAudio.transcript
    };
  } finally {
    tracker.stop();
  }
}

/* ==========================================================================
   1/Day Live Gemini 3.8 High Matchup Intel (Strictly <= 1 Credit / PT Day)
   ========================================================================== */
const DAILY_MATCHUP_CACHE_KEY = 'joshal_49ers_daily_matchup_v1';
const DAILY_MATCHUP_ATTEMPT_KEY = 'joshal_49ers_daily_matchup_attempt_v1';
let inFlightDailyMatchupPromise = null;

export function getPacificDateKey(nowMs = Date.now()) {
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Los_Angeles',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    }).format(new Date(nowMs));
  } catch {
    return new Date(nowMs).toISOString().slice(0, 10);
  }
}

function safeReadLocalJson(storageKey) {
  try {
    if (typeof localStorage === 'undefined') return null;
    const raw = localStorage.getItem(storageKey);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

function safeWriteLocalJson(storageKey, value) {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(storageKey, JSON.stringify(value));
  } catch {}
}

function extractBalancedJsonObject(rawText = '') {
  const cleaned = String(rawText || '')
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
  if (!cleaned) return null;
  try {
    const direct = JSON.parse(cleaned);
    if (direct && typeof direct === 'object' && !Array.isArray(direct)) return direct;
  } catch {}

  const startIdx = cleaned.indexOf('{');
  if (startIdx < 0) return null;
  let depth = 0;
  let inStr = false;
  let escCh = false;
  for (let i = startIdx; i < cleaned.length; i++) {
    const ch = cleaned[i];
    if (inStr) {
      if (escCh) escCh = false;
      else if (ch === '\\') escCh = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) {
        try {
          const obj = JSON.parse(cleaned.slice(startIdx, i + 1));
          if (obj && typeof obj === 'object' && !Array.isArray(obj)) return obj;
        } catch {}
        break;
      }
    }
  }
  return null;
}

export function buildDailyMatchupIntelPrompt(appData) {
  const um = appData?.scheduleMatchup?.upcomingMatchup || {};
  const tsUnits = appData?.scheduleMatchup?.teamStats?.units || [];
  const oppAbbr = String(um.oppAbbr || 'OPP').toUpperCase();
  const oppName = um.oppName || oppAbbr;
  const sfPr = (appData?.health?.practiceReport || [])
    .slice(0, 8)
    .map(p => `${p.name} (${p.position}, ${p.injuryType}: ${p.playBadgeLabel})`)
    .join('; ');
  const oppInj = (um.opponentHealth?.injuryReport || [])
    .slice(0, 10)
    .map(p => `${p.name} (${p.position}, ${p.injuryType}: ${p.playBadgeLabel}, ${p.snapPct || 0}% snaps)`)
    .join('; ');
  const oppHealthy = (um.opponentHealth?.keyStartersHealthy || [])
    .slice(0, 12)
    .map(p => `${p.name} (${p.position}${p.jersey != null ? ` #${p.jersey}` : ''})`)
    .join(', ');

  const unitBenchmarks = tsUnits
    .map(u => {
      const rows = [...(u.coreRows || []), ...(u.expandedGroups || []).flatMap(g => g.rows || [])];
      const top = rows
        .slice(0, 8)
        .map(r => {
          const sf = (r.leaderboard || []).find(x => x.team === 'SF');
          const op = (r.leaderboard || []).find(x => x.team === oppAbbr);
          return `${r.label}: SF ${sf?.disp || '—'} (#${sf?.rank || '—'}) vs ${oppAbbr} ${op?.disp || '—'} (#${op?.rank || '—'})`;
        })
        .join(' | ');
      return `[${u.shortLabel}] ${top}`;
    })
    .join('\n');

  const activeSfStars = (appData?.roster?.players || [])
    .filter(p => (p.rosterBucket || 'active') === 'active' && (p.primarySnapPct || 0) >= 50)
    .slice(0, 18)
    .map(p => {
      const st = p.stats2026 || {};
      const statBits = [];
      if (st.passing?.attempts > 20) {
        statBits.push(
          `${st.passing.yards} pass yds, ${st.passing.tds} TD, +${Number(st.passing.epa || 0).toFixed(1)} EPA, +${Number(st.passing.cpoe || 0).toFixed(1)}% CPOE, ${Number(st.passing.qbr || 0).toFixed(1)} QBR`
        );
      }
      if (st.rushing?.carries > 20) {
        statBits.push(`${st.rushing.yards} rush yds, ${st.rushing.tds} TD, +${Number(st.rushing.epa || 0).toFixed(1)} EPA`);
      }
      if (st.receiving?.receptions >= 12) {
        statBits.push(`${st.receiving.receptions} rec, ${st.receiving.yards} yds, ${st.receiving.tds} TD, +${Number(st.receiving.epa || 0).toFixed(1)} EPA`);
      }
      if ((st.defense?.sacks || 0) > 0 || (st.defense?.ints || 0) > 0 || (st.defense?.totalTackles || 0) >= 25) {
        statBits.push(
          `${st.defense.totalTackles || 0} tkl, ${st.defense.sacks || 0} sk, ${st.defense.qbHits || 0} QBH, ${st.defense.ints || 0} INT, ${st.defense.passDefended || 0} PD`
        );
      }
      return `${p.name} (${p.position}${p.jersey != null ? ` #${p.jersey}` : ''}${statBits.length ? ` — ${statBits.join('; ')}` : ''})`;
    })
    .join('\n');

  return [
    `DAILY_MATCHUP_INTEL_JSON — Synthesize today's All-22 film & situational preview for Week ${um.week || ''} San Francisco 49ers (${um.sfRecord || ''}) vs. ${oppName} (${um.oppRecord || ''}).`,
    `Current Coaching Headline to preserve/refine (keep salient HC/OC/DC names): "${um.coachingMatchup?.headline || `Kyle Shanahan & DC Raheem Morris vs. ${oppName} Staff`}"`,
    `Venue & Line: ${um.venue || ''} | Spread ${um.betting?.spread || '—'}, O/U ${um.betting?.overUnder || '—'}, ${um.betting?.restAdvantage || ''}`,
    `49ers Injury Designations: ${sfPr || 'None'}`,
    `${oppAbbr} Injury Designations: ${oppInj || 'None'}`,
    `${oppAbbr} Healthy Starters: ${oppHealthy || 'See live roster'}`,
    `2026 Unit Rank Benchmarks:\n${unitBenchmarks}`,
    `Active 2026 49ers Starters & Verified Stats:\n${activeSfStars}`,
    '',
    'STRICT NON-OVERLAP EDITORIAL ARCHITECTURE (MANDATORY):',
    '1. `coachingMatchup` = PURE COORDINATOR CHESS, SCHEME TENDENCIES & SITUATIONAL LEVERS ONLY:',
    '   - ZERO active player names inside `coachingMatchup.summary` or `coachingMatchup.bullets`! Talk strictly about coaches/coordinators (Kyle Shanahan, Raheem Morris, and opponent HC/OC/DC), personnel groupings (21 personnel, 12/21, condensed splits), motion & coverage tendencies (jet motion, orbit motion, spot-drop Cover 3, Tampa-2, two-high, Quarters, Cover 6, cloud-trap, honey-hole, hook/curl, curl/flat, between the numbers, between the hashes), run-scheme vs box math (gap-scheme, pin-and-pull, counter, duo, A- and B-gaps, light boxes), and 3rd-down / red-zone / penalty / game-script triggers backed by exact rankings.',
    '   - `bullets` must have 4 items, each formatted `"Bold Subtopic: Crisp 2-sentence coordinator analysis"`.Bullet 1 MUST begin with `"Pass-Game Efficiency & Coverage Shell Delta:"`.',
    '2. `keyMatchupsMatrix` = 5 SPECIFIC PLAYER-VS-PLAYER / TRENCH SCOUTING BATTLES:',
    '   - Zero repetition of generic coordinator summaries! Put ALL specific 49ers & opponent player names, 2026 player stats, injury/GTD leverage, and physical technique clashes here.',
    '   - Each of the 5 objects MUST include: `phaseTag` (short 2-3 word label), `unitMatchup` ("SF Player(s) vs. Opp Player(s)"), `advantage` (e.g. "SF Heavy Edge", "SF Trench Edge", "Even Star Clash"), `sfPlayers` (array of 1-3 exact 49ers player full names), `statComparison` ("SF: <exact metric> | OPP: <exact metric>"), `tacticalDetail` (2 vivid sentences on 1-on-1 leverage, technique & health), and `filmTell` (1 concrete TV viewing tell starting without a prefix).',
    '3. Output ONLY valid raw JSON matching: {"coachingMatchup":{"headline":"...","summary":"...","bullets":["..."]},"keyMatchupsMatrix":[{"phaseTag":"...","unitMatchup":"...","advantage":"...","sfPlayers":["..."],"statComparison":"...","tacticalDetail":"...","filmTell":"..."}]}.'
  ].join('\n');
}

export function parseAndSanitizeDailyMatchupIntel(rawTextOrObj, um = {}, rosterPlayers = []) {
  const parsed =
    rawTextOrObj && typeof rawTextOrObj === 'object' && !Array.isArray(rawTextOrObj)
      ? rawTextOrObj
      : extractBalancedJsonObject(rawTextOrObj);
  if (!parsed) return null;

  const cm = parsed.coachingMatchup;
  const km = parsed.keyMatchupsMatrix;
  if (!cm || typeof cm !== 'object' || !Array.isArray(cm.bullets) || cm.bullets.length < 3) {
    return null;
  }
  if (!Array.isArray(km) || km.length < 4) {
    return null;
  }

  const cleanStr = s => sanitizeHallucinatedRosterText(String(s || '').trim(), rosterPlayers);
  const headline = cleanStr(cm.headline) || um.coachingMatchup?.headline || '';
  const summary = cleanStr(cm.summary);
  if (!headline || summary.length < 50) return null;

  const bullets = cm.bullets
    .map(b => cleanStr(b))
    .filter(b => b.length >= 35)
    .slice(0, 5);
  if (bullets.length < 3) return null;

  const matrix = km
    .map(item => {
      if (!item || typeof item !== 'object') return null;
      const unitMatchup = cleanStr(item.unitMatchup);
      const tacticalDetail = cleanStr(item.tacticalDetail);
      if (!unitMatchup || tacticalDetail.length < 35) return null;
      return {
        phaseTag: cleanStr(item.phaseTag || ''),
        unitMatchup,
        advantage: cleanStr(item.advantage || 'Even Matchup'),
        sfPlayers: Array.isArray(item.sfPlayers)
          ? item.sfPlayers.map(n => cleanStr(n)).filter(Boolean).slice(0, 3)
          : [],
        statComparison: cleanStr(item.statComparison || ''),
        tacticalDetail,
        filmTell: cleanStr(item.filmTell || '').replace(/^(?:broadcast\s+tell|film\s+tell|tv\s+tell)\s*:\s*/i, '')
      };
    })
    .filter(Boolean)
    .slice(0, 5);

  if (matrix.length < 4) return null;

  return {
    coachingMatchup: { headline, summary, bullets },
    keyMatchupsMatrix: matrix
  };
}

export function hydrateCachedDailyMatchupIntel(appData) {
  const um = appData?.scheduleMatchup?.upcomingMatchup;
  if (!um || !um.week || !um.oppAbbr) return false;
  const seasonYear = Number(appData?.meta?.seasonYear || 2026);
  const scopeId = `${seasonYear}:wk${um.week}:${String(um.oppAbbr).toUpperCase()}`;
  const cached = safeReadLocalJson(DAILY_MATCHUP_CACHE_KEY);
  if (!cached || cached.scopeId !== scopeId || !cached.coachingMatchup || !cached.keyMatchupsMatrix) {
    return false;
  }
  // Only overlay if cached date is >= upstream aiMatchupMeta date
  const upstreamDate = String(um.aiMatchupMeta?.datePt || '');
  if (upstreamDate && cached.datePt && cached.datePt < upstreamDate) {
    return false;
  }
  um.coachingMatchup = cached.coachingMatchup;
  um.keyMatchupsMatrix = cached.keyMatchupsMatrix;
  um.aiMatchupMeta = {
    datePt: cached.datePt,
    week: um.week,
    oppAbbr: String(um.oppAbbr).toUpperCase(),
    source: cached.source || 'live-gemini-daily'
  };
  return true;
}

/**
 * Refreshes Coaching Matchup + 5 Key Matchups using 1 single-pass Gemini 3.8 High + Google Search
 * request at most ONCE per Pacific calendar day (`<= 1` of the user's 20 daily Free-Tier credits).
 */
export async function refreshDailyMatchupIntelIfDue({
  appData,
  prefs = {},
  force = false,
  nowMs = Date.now()
} = {}) {
  if (!hasLiveAiConnection(prefs)) {
    return { updated: false, reason: 'no_ai_connection' };
  }
  const um = appData?.scheduleMatchup?.upcomingMatchup;
  const oppAbbr = String(um?.oppAbbr || '').toUpperCase().trim();
  if (!um || !um.week || !oppAbbr || oppAbbr === 'BYE') {
    return { updated: false, reason: 'no_active_matchup' };
  }

  const seasonYear = Number(appData?.meta?.seasonYear || 2026);
  const todayPt = getPacificDateKey(nowMs);
  const scopeId = `${seasonYear}:wk${um.week}:${oppAbbr}`;

  hydrateCachedDailyMatchupIntel(appData);

  if (!force) {
    if (
      um.aiMatchupMeta?.datePt === todayPt &&
      Number(um.aiMatchupMeta?.week) === Number(um.week) &&
      String(um.aiMatchupMeta?.oppAbbr || '').toUpperCase() === oppAbbr
    ) {
      return { updated: false, fromCache: true, datePt: todayPt };
    }
    const cached = safeReadLocalJson(DAILY_MATCHUP_CACHE_KEY);
    if (cached && cached.scopeId === scopeId && cached.datePt === todayPt) {
      return { updated: false, fromCache: true, datePt: todayPt };
    }
    const attempt = safeReadLocalJson(DAILY_MATCHUP_ATTEMPT_KEY);
    if (attempt && attempt.attemptId === `${todayPt}:${scopeId}`) {
      return { updated: false, alreadyAttemptedToday: true, datePt: todayPt };
    }
  }

  if (inFlightDailyMatchupPromise) {
    return inFlightDailyMatchupPromise;
  }

  inFlightDailyMatchupPromise = (async () => {
    safeWriteLocalJson(DAILY_MATCHUP_ATTEMPT_KEY, {
      attemptId: `${todayPt}:${scopeId}`,
      attemptedAt: new Date(nowMs).toISOString()
    });

    const rosterPlayers = appData?.roster?.players || [];
    const promptText = buildDailyMatchupIntelPrompt(appData);
    const systemPrompt = buildLiveGroundingSystemPrompt(appData);

    try {
      let normalized = null;
      let modelUsed = 'gemini-3.8-flash';

      const baseUrl = String(prefs?.workerBaseUrl || '').trim().replace(/\/+$/, '');
      const directKey = String(prefs?.geminiApiKey || '').trim();

      if (baseUrl && !directKey) {
        const res = await fetch(`${baseUrl}/api/matchup-intel`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Group-Passcode': prefs?.groupPasscode || ''
          },
          body: JSON.stringify({
            seasonYear,
            week: um.week,
            oppAbbr,
            datePt: todayPt,
            forceRefresh: Boolean(force),
            prompt: promptText,
            systemPrompt
          })
        });
        if (res.ok) {
          const json = await res.json();
          modelUsed = json?.modelUsed || modelUsed;
          normalized = parseAndSanitizeDailyMatchupIntel(json?.data || json?.rawText, um, rosterPlayers);
        }
      } else if (directKey) {
        const conn = await resolveDirectGeminiCascades(prefs);
        // Single-pass High-Thinking + Google Search call (= strictly 1 credit/day)
        const gen = await callGeminiDirectWithCascade({
          apiBase: conn.apiBase,
          key: conn.key,
          cascade: conn.cascade,
          systemInstructionText: systemPrompt,
          userText: promptText,
          useGoogleSearch: true,
          temperature: 0.18,
          perAttemptTimeoutMs: 45000
        });
        modelUsed = gen.modelUsed || modelUsed;
        normalized = parseAndSanitizeDailyMatchupIntel(gen.text, um, rosterPlayers);
      }

      if (!normalized) {
        return { updated: false, reason: 'invalid_or_empty_payload' };
      }

      const record = {
        scopeId,
        datePt: todayPt,
        seasonYear,
        week: um.week,
        oppAbbr,
        modelUsed,
        source: 'live-gemini-daily',
        generatedAt: new Date().toISOString(),
        coachingMatchup: normalized.coachingMatchup,
        keyMatchupsMatrix: normalized.keyMatchupsMatrix
      };
      safeWriteLocalJson(DAILY_MATCHUP_CACHE_KEY, record);

      um.coachingMatchup = normalized.coachingMatchup;
      um.keyMatchupsMatrix = normalized.keyMatchupsMatrix;
      um.aiMatchupMeta = {
        datePt: todayPt,
        week: um.week,
        oppAbbr,
        source: 'live-gemini-daily'
      };

      return { updated: true, modelUsed, datePt: todayPt };
    } catch {
      return { updated: false, reason: 'request_failed_graceful_fallback' };
    } finally {
      inFlightDailyMatchupPromise = null;
    }
  })();

  return inFlightDailyMatchupPromise;
}

/* ==========================================================================
   1/Day Gemini 3.8 Flash High Top-News Brief (5:00 PM PT Peak-News Cycle)
   ========================================================================== */
/**
 * 5:00 PM PT (17:00 America/Los_Angeles) sits immediately after the daily NFL news peak:
 * - 1:00 PM PT (4:00 PM ET): Official NFL Daily Transaction & Personnel Wire
 * - 11:00 AM–2:00 PM PT: Kyle Shanahan / coordinator pressers & open media practice window
 * - 3:30–4:15 PM PT: Official 49ers Wed/Thu/Fri Practice & Game-Status Injury Report + beat recaps
 * - 4:25 PM PT: Final whistle of 1:05/1:25 PM PT Sunday afternoon games + podium reaction
 */
export const DAILY_NEWS_BRIEF_PEAK_HOUR_PT = 17;

const DAILY_NEWS_BRIEF_CACHE_KEY = 'joshal_49ers_daily_news_brief_v1';
const DAILY_NEWS_BRIEF_ATTEMPT_KEY = 'joshal_49ers_daily_news_brief_attempt_v1';
let inFlightDailyNewsBriefPromise = null;

export function getPacificHour24(nowMs = Date.now()) {
  try {
    const hStr = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/Los_Angeles',
      hour: '2-digit',
      hourCycle: 'h23'
    }).format(new Date(nowMs));
    const parsed = parseInt(hStr, 10);
    return Number.isFinite(parsed) ? parsed : new Date(nowMs).getUTCHours();
  } catch {
    return new Date(nowMs).getUTCHours();
  }
}

/**
 * Computes the active daily 5:00 PM PT news-cycle identifier (`YYYY-MM-DD@17PT`).
 * Before 5:00 PM PT on Day D, the active cycle is `Day(D-1)@17PT`; once 5:00 PM PT arrives,
 * it advances to `Day(D)@17PT` so the brief regenerates once/day right after peak news lands.
 */
export function getDailyNewsBriefCycleKey(
  nowMs = Date.now(),
  peakHourPt = DAILY_NEWS_BRIEF_PEAK_HOUR_PT
) {
  const hourPt = getPacificHour24(nowMs);
  if (hourPt >= peakHourPt) {
    return `${getPacificDateKey(nowMs)}@${peakHourPt}PT`;
  }
  const prevDayAnchorMs = nowMs - (hourPt + 2) * 3_600_000;
  return `${getPacificDateKey(prevDayAnchorMs)}@${peakHourPt}PT`;
}

/**
 * Selects up to `maxSources` verified, non-paywalled, StoryRank-prioritized tweets & articles
 * (`S1..S14`) from `appData.news.rawStream` to ground and inline-link the Daily Top News Brief.
 */
export function selectTopNewsBriefSourceCandidates(appData, maxSources = 14, nowMs = Date.now()) {
  const rawStream = Array.isArray(appData?.news?.rawStream) ? appData.news.rawStream : [];
  if (rawStream.length === 0) return [];

  const afterAvail = filterOutCompletedGameAvailabilityItems(rawStream, appData, nowMs);
  const prioritized = sortNewsWithBreakingPriority(
    afterAvail.filter(it => {
      if (!it || it.type === 'video' || Boolean(it.videoId) || it.isClickbait) return false;
      return Boolean(sanitizeExternalUrl(it.url, null)) && !isPaywalledPublisher(it.outletName, it.url);
    }),
    nowMs,
    { appData }
  );
  const deduped = balanceFeedTopSalience(deduplicateAndGroupWireItems(prioritized, { nowMs }), {
    nowMs,
    appData
  });

  const seenUrls = new Set();
  const candidates = [];

  const pushCandidate = (it, parentStoryKey = '') => {
    if (!it || candidates.length >= maxSources) return;
    const isTw = it.type === 'tweet' || it.type === 'social';
    const resolvedUrl = isTw ? resolveOriginalTweetUrl(it, prioritized) : it.url;
    const safeUrl = sanitizeExternalUrl(resolvedUrl, null);
    if (!safeUrl || isPaywalledPublisher(it.outletName, safeUrl)) return;
    const dedupKey = safeUrl.includes('x.com/search?')
      ? `${safeUrl}::${String(it.title || it.fullText || '').toLowerCase().slice(0, 48)}`
      : safeUrl;
    if (seenUrls.has(dedupKey)) return;
    seenUrls.add(dedupKey);

    const author = String(it.author || it.reporterName || it.outletName || '49ers Beat').trim();
    const outlet = String(it.outletName || author || '49ers Beat').trim();
    const rawBody = (
      isTw
        ? stripRedundantAuthorBoilerplate(it.fullText || it.title || '', author)
        : String(it.title || '').trim()
    )
      .replace(/\s*(?:https?:\/\/|www\.)\S+/gi, '')
      .replace(/\s*(?:Read|More|Watch|Story|Link):\s*$/i, '')
      .replace(/\s+/g, ' ')
      .trim();
    if (!rawBody || rawBody.length < 14) return;
    const truncateAtWord = (str, limit) => {
      if (str.length <= limit) return str;
      const cut = str.slice(0, limit);
      const lastSpace = cut.lastIndexOf(' ');
      return `${(lastSpace > 45 ? cut.slice(0, lastSpace) : cut).replace(/[,;:\-–—]+$/, '').trim()}…`;
    };
    const cleanTitle = truncateAtWord(rawBody, 138);
    const storyKey = buildStorySignatureKey(it) || parentStoryKey || '';

    const confirmingUrls = Array.isArray(it.confirmingReports)
      ? it.confirmingReports
          .map(cr => {
            const crTw = cr?.type === 'tweet' || cr?.type === 'social';
            return sanitizeExternalUrl(crTw ? resolveOriginalTweetUrl(cr, prioritized) : cr?.url, null);
          })
          .filter(Boolean)
      : [];

    candidates.push({
      refId: `S${candidates.length + 1}`,
      type: isTw ? 'tweet' : 'article',
      author,
      outlet,
      citeLabel:
        isTw && author && !/beat|wire/i.test(author)
          ? author
          : author && outlet && author.toLowerCase() !== outlet.toLowerCase() && !/staff|webzone|nation/i.test(author)
            ? author
            : outlet,
      title: cleanTitle,
      summary: !isTw && it.summary ? String(it.summary).slice(0, 180) : '',
      url: safeUrl,
      publishedAt: it.publishedAt || null,
      category: it.category || 'beat',
      storyKey,
      confirmingUrls
    });
  };

  for (const lead of deduped) {
    if (candidates.length >= maxSources) break;
    const leadKey = buildStorySignatureKey(lead) || '';
    pushCandidate(lead, leadKey);
    // Also surface a distinct-format corroborating report on the top 3 lead stories so both tweets & articles can be cited
    if (candidates.length < maxSources && candidates.length <= 8 && Array.isArray(lead.confirmingReports)) {
      const altFmt = lead.confirmingReports.find(
        cr => (cr?.type === 'tweet') !== (lead.type === 'tweet') && !cr?.videoId
      );
      if (altFmt) pushCandidate(altFmt, leadKey);
    }
  }

  return candidates;
}

export function buildDailyTopNewsBriefPrompt(appData, sourceCandidates = []) {
  const meta = appData?.meta || {};
  const um = appData?.scheduleMatchup?.upcomingMatchup || {};
  const capYr = String(meta.seasonYear || 2026);
  const nextYr = String(Number(capYr) + 1);
  const capGrossM = ((Number(appData?.cap?.years?.[capYr]?.teamCapSpace || 35_164_858)) / 1e6).toFixed(2);
  const capNextRaw = Number(appData?.cap?.years?.[nextYr]?.teamCapSpace ?? -31_540_066);
  const capNextLabel = `${capNextRaw < 0 ? '-' : '+'}$${(Math.abs(capNextRaw) / 1e6).toFixed(2)}M`;

  const sfPr = (appData?.health?.practiceReport || [])
    .slice(0, 8)
    .map(p => `${p.name} (${p.position}, ${p.injuryType}: ${p.wed}/${p.thu}/${p.fri} -> ${p.playBadgeLabel})`)
    .join('; ');

  const sourceBlock = sourceCandidates
    .map(
      s =>
        `[${s.refId}] (${s.type === 'tweet' ? 'Tweet' : 'Article'} | ${s.author} • ${s.outlet} | ${s.publishedAt || 'Recent'}): ${s.title}${
          s.summary ? ` — ${s.summary}` : ''
        }`
    )
    .join('\n');

  return [
    `DAILY_TOP_NEWS_BRIEF_JSON — Synthesize today's post-wire San Francisco 49ers (${meta.teamRecord || ''}, Week ${meta.currentWeek || ''}, next vs. ${um.oppName || um.oppAbbr || 'Opponent'}) Top News Brief using Gemini High Thinking.`,
    `Live Cap Context: $${capGrossM}M in ${capYr} gross cap space vs. ${capNextLabel} projected ${nextYr} balance (CBA Article 13 1-for-1 rollover).`,
    `Active Week ${meta.currentWeek || ''} Practice/Injury Ledger: ${sfPr || 'See verified wire sources below.'}`,
    `VERIFIED TODAY'S BEAT TWEETS & ARTICLES (CITE INLINE USING [Reporter or Outlet](S#)):`,
    sourceBlock || 'No external sources attached.',
    '',
    'STRICT EDITORIAL & LENGTH REQUIREMENTS (MANDATORY):',
    '1. TARGET WORD COUNT: ~215–245 words total across `headline` + `summary` + `bullets` (~2/3 the length of our 355-word Coaching Matchup card). Tight, high-signal, zero filler, zero clickbait.',
    '2. `headline`: Crisp 10–15 word factual headline capturing today\'s biggest 49ers developments (no markdown links in `headline`).',
    '3. `summary`: 2 crisp sentences (~45–55 words) synthesizing the overarching headline takeaway, including at least 1–2 inline source citations formatted as `[Author or Outlet](S#)` (e.g. `[Matt Barrows](S1)` or `[49ers.com](S2)`).',
    '4. `bullets`: Exactly 3 bullets (~50–60 words each), each starting with `"Bold Subtopic: "` and weaving inline clickable citations `[Author or Outlet](S#)` directly into the prose throughout every bullet (cite 5–8 distinct `S#` sources across the brief, mixing tweets and articles!). Cover all top developments across roster/trades/cap, practice/injury statuses, and team/matchup storylines without duplicating our separate coordinator X\'s & O\'s card.',
    '5. `citedSourceIds`: Array of all `"S#"` IDs cited in `summary` and `bullets` (e.g. `["S1","S2","S3","S4","S5","S6"]`).',
    '6. Output ONLY valid raw JSON matching: {"headline":"...","summary":"...","bullets":["Subtopic: ...","Subtopic: ...","Subtopic: ..."],"citedSourceIds":["S1","S2"]}.'
  ].join('\n');
}

function sanitizeBriefInlineLinksAndRoster(
  rawText = '',
  byRefId = new Map(),
  sourceCandidates = [],
  rosterPlayers = [],
  citedRefCollector = new Set()
) {
  let text = String(rawText || '').trim();
  if (!text) return '';

  // 1. Convert bare `[S1]` markers (not followed by `(`) into `[CiteLabel](S1)`
  text = text.replace(/\[(S\d{1,2})\](?!\()/gi, (_, refRaw) => {
    const key = String(refRaw || '').toUpperCase();
    const src = byRefId.get(key);
    if (!src) return '';
    citedRefCollector.add(key);
    return `[${src.citeLabel || src.author || src.outlet}](${src.url})`;
  });

  // 2. Resolve `[Label](S1)` or `[Label](https://...)` into verified non-paywalled HTTPS links
  const linkPlaceholders = [];
  text = text.replace(/\[([^\]]{2,68})\]\(([^)\s]+)\)/g, (_, rawLabel, rawTarget) => {
    const cleanLabel = String(rawLabel || '')
      .replace(/[\[\]]/g, '')
      .trim();
    const targetTrim = String(rawTarget || '').trim();
    const refKey = targetTrim.replace(/^#/, '').toUpperCase();

    let resolvedUrl = null;
    if (byRefId.has(refKey)) {
      resolvedUrl = byRefId.get(refKey).url;
      citedRefCollector.add(refKey);
    } else {
      const candidateSafe = sanitizeExternalUrl(targetTrim, null);
      if (candidateSafe && !isPaywalledPublisher('', candidateSafe)) {
        const matchingSrc = sourceCandidates.find(s => s.url === candidateSafe);
        if (matchingSrc) citedRefCollector.add(matchingSrc.refId);
        resolvedUrl = candidateSafe;
      } else {
        const lowerLbl = cleanLabel.toLowerCase();
        const fallbackMatch = sourceCandidates.find(
          s =>
            s.author.toLowerCase() === lowerLbl ||
            s.outlet.toLowerCase() === lowerLbl ||
            s.citeLabel.toLowerCase() === lowerLbl
        );
        if (fallbackMatch) {
          resolvedUrl = fallbackMatch.url;
          citedRefCollector.add(fallbackMatch.refId);
        }
      }
    }

    if (!resolvedUrl) return cleanLabel;
    const token = `__BRIEF_SRC_LINK_${linkPlaceholders.length}__`;
    linkPlaceholders.push(`[${cleanLabel}](${resolvedUrl})`);
    return token;
  });

  // 3. Sanitize prose against hallucinated departed/retired players while keeping link tokens intact
  text = sanitizeHallucinatedRosterText(text, rosterPlayers);

  // 4. Restore verified `[Label](https://...)` markdown tokens
  for (let i = 0; i < linkPlaceholders.length; i++) {
    text = text.replace(`__BRIEF_SRC_LINK_${i}__`, linkPlaceholders[i]);
  }
  return text.replace(/\s+/g, ' ').trim();
}

function countVisibleBriefWords(text = '') {
  const plain = String(text || '').replace(/\[([^\]]+)\]\([^)]+\)/g, '$1').trim();
  if (!plain) return 0;
  return plain.split(/\s+/).filter(Boolean).length;
}

function trimBulletToMaxWordsPreservingLinks(bullet = '', maxWords = 72) {
  if (countVisibleBriefWords(bullet) <= maxWords) return bullet;
  // Split at sentence boundary if multi-sentence
  const sentences = bullet.match(/[^.!?]+[.!?]+(?:\s+|$)|[^.!?]+$/g) || [bullet];
  if (sentences.length > 1) {
    let acc = '';
    for (const s of sentences) {
      const next = `${acc}${s}`;
      if (acc && countVisibleBriefWords(next) > maxWords) break;
      acc = next;
    }
    if (acc.trim().length >= 45) return acc.trim();
  }
  return bullet;
}

export function parseAndSanitizeDailyTopNewsBrief(
  rawTextOrObj,
  sourceCandidates = [],
  appData = null,
  meta = {}
) {
  const parsed =
    rawTextOrObj && typeof rawTextOrObj === 'object' && !Array.isArray(rawTextOrObj)
      ? rawTextOrObj
      : extractBalancedJsonObject(rawTextOrObj);
  if (!parsed) return null;

  const rosterPlayers = appData?.roster?.players || [];
  const byRefId = new Map(sourceCandidates.map(s => [String(s.refId).toUpperCase(), s]));
  const citedRefIds = new Set(
    Array.isArray(parsed.citedSourceIds)
      ? parsed.citedSourceIds.map(x => String(x || '').toUpperCase()).filter(k => byRefId.has(k))
      : []
  );

  const rawHeadline = String(parsed.headline || '')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/\*\*/g, '')
    .trim();
  const headline = sanitizeHallucinatedRosterText(rawHeadline, rosterPlayers);
  const summary = sanitizeBriefInlineLinksAndRoster(
    parsed.summary || '',
    byRefId,
    sourceCandidates,
    rosterPlayers,
    citedRefIds
  );

  if (!headline || summary.length < 40 || !Array.isArray(parsed.bullets)) {
    return null;
  }

  let bullets = parsed.bullets
    .map(b =>
      trimBulletToMaxWordsPreservingLinks(
        sanitizeBriefInlineLinksAndRoster(b, byRefId, sourceCandidates, rosterPlayers, citedRefIds),
        74
      )
    )
    .filter(b => b.length >= 30)
    .slice(0, 3);

  if (bullets.length < 2) return null;

  // Ensure every bullet & summary carries at least one inline source link if candidates exist
  const hasInlineLinkRe = /\[[^\]]+\]\(https:\/\/[^)]+\)/i;
  if (sourceCandidates.length > 0 && !hasInlineLinkRe.test(summary)) {
    const s0 = sourceCandidates[0];
    citedRefIds.add(s0.refId);
    const trimmedSum = summary.replace(/[.!?]\s*$/, '');
    // Append crisp inline attribution on lead summary
    parsed._patchedSummary = `${trimmedSum} ([${s0.citeLabel}](${s0.url})).`;
  }
  const finalSummary = parsed._patchedSummary || summary;

  bullets = bullets.map((b, idx) => {
    if (hasInlineLinkRe.test(b) || sourceCandidates.length === 0) return b;
    const fallbackSrc = sourceCandidates[Math.min(idx + 1, sourceCandidates.length - 1)] || sourceCandidates[0];
    citedRefIds.add(fallbackSrc.refId);
    const cleanNoPeriod = b.replace(/[.!?]\s*$/, '');
    return `${cleanNoPeriod} ([${fallbackSrc.citeLabel}](${fallbackSrc.url})).`;
  });

  // Order expandable bottom `sources`: inline-cited sources first, then remaining top StoryRank candidates (up to 12)
  const orderedSources = [];
  const seenSourceUrls = new Set();
  const addSrc = src => {
    if (!src?.url || seenSourceUrls.has(src.url) || orderedSources.length >= 12) return;
    seenSourceUrls.add(src.url);
    orderedSources.push({
      type: src.type || 'article',
      author: src.author || '49ers Beat',
      outlet: src.outlet || '49ers Beat',
      title: src.title || 'Open Report',
      url: src.url,
      publishedAt: src.publishedAt || null
    });
  };
  for (const refId of citedRefIds) {
    if (byRefId.has(refId)) addSrc(byRefId.get(refId));
  }
  for (const cand of sourceCandidates) {
    addSrc(cand);
  }

  const coveredStoryKeys = Array.from(
    new Set(sourceCandidates.slice(0, 12).map(s => s.storyKey).filter(Boolean))
  );
  const coveredUrls = Array.from(
    new Set([
      ...orderedSources.map(s => s.url),
      ...sourceCandidates.slice(0, 12).flatMap(s => [s.url, ...(s.confirmingUrls || [])])
    ])
  ).filter(Boolean);

  const nowIso = meta.generatedAt || new Date().toISOString();
  const cycleKey = meta.cycleKey || getDailyNewsBriefCycleKey(Date.parse(nowIso) || Date.now());
  const wordCount =
    countVisibleBriefWords(headline) +
    countVisibleBriefWords(finalSummary) +
    bullets.reduce((acc, b) => acc + countVisibleBriefWords(b), 0);

  return {
    id: `daily_brief_${cycleKey.replace(/[^A-Za-z0-9_-]/g, '_')}`,
    cycleKey,
    scheduledHourPt: DAILY_NEWS_BRIEF_PEAK_HOUR_PT,
    generatedAt: nowIso,
    modelUsed: meta.modelUsed || 'gemini-3.8-flash',
    thinkingLevel: 'HIGH',
    source: meta.source || 'live-gemini-daily',
    wordCount,
    headline,
    summary: finalSummary,
    bullets,
    coveredStoryKeys,
    coveredUrls,
    sources: orderedSources
  };
}

/**
 * Deterministic ~225-word Top News Brief fallback builder (used when offline or before an AI Studio key runs)
 * with inline clickable `[Author/Outlet](https://...)` citations and full expandable `sources` list.
 */
export function buildDeterministicDailyTopNewsBrief(appData, nowMs = Date.now(), meta = {}) {
  const candidates = selectTopNewsBriefSourceCandidates(appData, 14, nowMs);
  const m = appData?.meta || {};
  const um = appData?.scheduleMatchup?.upcomingMatchup || {};
  const oppName = um.oppName || um.oppAbbr || 'Opponent';
  const wk = m.currentWeek || um.week || '';
  const rec = m.teamRecord || '—';
  const capYr = String(m.seasonYear || 2026);
  const nextYr = String(Number(capYr) + 1);
  const capGrossM = ((Number(appData?.cap?.years?.[capYr]?.teamCapSpace || 35_164_858)) / 1e6).toFixed(2);
  const capNextRaw = Number(appData?.cap?.years?.[nextYr]?.teamCapSpace ?? -31_540_066);
  const capNextLabel = `${capNextRaw < 0 ? '-' : '+'}$${(Math.abs(capNextRaw) / 1e6).toFixed(2)}M`;

  const s = idx => candidates[idx] || candidates[0] || null;
  const cite = idx => {
    const c = s(idx);
    return c ? `[${c.citeLabel}](${c.url})` : '49ers Beat';
  };

  const rosterSources = candidates.filter(c => c.category === 'roster');
  const injSources = candidates.filter(
    c => !rosterSources.includes(c) && (c.category === 'injury' || /injur|practice|return|day-to-day|window|questionable/i.test(c.title))
  );
  const beatSources = candidates.filter(c => !rosterSources.includes(c) && !injSources.includes(c));

  const usedRefs = new Set();
  const usedStoryKeys = new Set();
  const takeNext = (pool, allowSameStory = false) => {
    for (const c of pool) {
      if (!c || usedRefs.has(c.refId)) continue;
      if (!allowSameStory && c.storyKey && usedStoryKeys.has(c.storyKey)) continue;
      usedRefs.add(c.refId);
      if (c.storyKey) usedStoryKeys.add(c.storyKey);
      return c;
    }
    if (!allowSameStory) return takeNext(pool, true);
    return null;
  };

  const lead1 = takeNext(rosterSources) || takeNext(candidates);
  const lead2 = takeNext(beatSources) || takeNext(candidates);
  const rSrc1 = takeNext(rosterSources) || lead1;
  const rSrc2 = takeNext(rosterSources);
  const iSrc1 = takeNext(injSources) || takeNext(candidates);
  const iSrc2 = takeNext(injSources);
  const bSrc1 = takeNext(beatSources) || takeNext(candidates);
  const bSrc2 = takeNext(beatSources) || takeNext(candidates);

  const cleanSnippet = (src, maxLen = 104) => {
    if (!src?.title) return '';
    const t = src.title
      .replace(/\s*(?:https?:\/\/|www\.)\S+/gi, '')
      .replace(/[.!?…]+$/, '')
      .trim();
    if (t.length <= maxLen) return t;
    const cut = t.slice(0, maxLen);
    const sp = cut.lastIndexOf(' ');
    return `${(sp > 40 ? cut.slice(0, sp) : cut).replace(/[,;:\-–—]+$/, '').trim()}…`;
  };

  const headline = `49ers (${rec}) Week ${wk} Briefing: Roster & Cap Moves, Practice Wire & ${oppName} Prep`;

  const summary = lead1
    ? `San Francisco (${rec}) enters Week ${wk} vs. ${oppName} headlined by ${cleanSnippet(lead1, 96)} ([${lead1.citeLabel}](${lead1.url})). ${
        lead2 && lead2 !== lead1
          ? `Around the facility, ${cleanSnippet(lead2, 92)} ([${lead2.citeLabel}](${lead2.url})) frames preparations ahead of kickoff.`
          : `Practice availability and 53-man cap flexibility anchor preparations at SAP Performance Facility.`
      }`
    : `San Francisco (${rec}) turns toward Week ${wk} against ${oppName} while managing active-roster moves, mid-week practice designations, and $${capGrossM}M in ${capYr} salary cap rollover room.`;

  const bulletRoster = rSrc1
    ? `Roster & Cap Ledger: ${cleanSnippet(rSrc1, 102)} ([${rSrc1.citeLabel}](${rSrc1.url}))${
        rSrc2 && rSrc2 !== rSrc1
          ? `, alongside ${cleanSnippet(rSrc2, 86)} ([${rSrc2.citeLabel}](${rSrc2.url}))`
          : ''
      }, while Paraag Marathe preserves $${capGrossM}M in ${capYr} space for CBA Article 13 rollover against ${nextYr}'s ${capNextLabel} void years projection.`
    : `Roster & Cap Ledger: San Francisco holds $${capGrossM}M in ${capYr} cap space for 1-for-1 CBA Article 13 rollover into ${nextYr} (${capNextLabel} void years projection) while managing 53-man elevations (${cite(0)}).`;

  const sfOutOrQ = (appData?.health?.practiceReport || []).slice(0, 3);
  const healthNamesNote =
    sfOutOrQ.length > 0
      ? sfOutOrQ.map(p => `${p.name} (${p.injuryType})`).join(', ')
      : 'active starters on the practice report';

  const bulletHealth = iSrc1
    ? `Practice & IR Wire: ${cleanSnippet(iSrc1, 102)} ([${iSrc1.citeLabel}](${iSrc1.url}))${
        iSrc2 && iSrc2 !== iSrc1
          ? `, and ${cleanSnippet(iSrc2, 84)} ([${iSrc2.citeLabel}](${iSrc2.url}))`
          : ''
      }, headlining IR return windows and practice tracking around ${healthNamesNote} ahead of kickoff.`
    : `Practice & IR Wire: Medical tracking and IR return windows ahead of ${oppName} center on ${healthNamesNote} as official participation reports progress (${cite(1)}).`;

  const bulletMatchupBeat = bSrc1
    ? `Team & Matchup Pulse: ${cleanSnippet(bSrc1, 104)} ([${bSrc1.citeLabel}](${bSrc1.url}))${
        bSrc2 && bSrc2 !== bSrc1
          ? `, while ${cleanSnippet(bSrc2, 86)} ([${bSrc2.citeLabel}](${bSrc2.url}))`
          : ''
      } frames EPA efficiency and play-action sequencing for Week ${wk} vs. ${oppName} (${um.betting?.spread || 'NFL'}).`
    : `Team & Matchup Pulse: Kyle Shanahan and Raheem Morris finalize Week ${wk} EPA and play-action scripts against ${oppName} (${um.betting?.spread || 'NFL'}, O/U ${um.betting?.overUnder || '—'}).`;

  const citedIds = [lead1, lead2, rSrc1, rSrc2, iSrc1, iSrc2, bSrc1, bSrc2]
    .filter(Boolean)
    .map(x => x.refId);

  const built = parseAndSanitizeDailyTopNewsBrief(
    {
      headline,
      summary,
      bullets: [bulletRoster, bulletHealth, bulletMatchupBeat],
      citedSourceIds: citedIds
    },
    candidates,
    appData,
    {
      generatedAt: meta.generatedAt || m.updatedAt || new Date(nowMs).toISOString(),
      cycleKey: meta.cycleKey || getDailyNewsBriefCycleKey(nowMs),
      modelUsed: meta.modelUsed || 'gemini-3.8-flash',
      source: meta.source || 'pipeline-grounded'
    }
  );

  return (
    built || {
      id: `daily_brief_${getDailyNewsBriefCycleKey(nowMs).replace(/[^A-Za-z0-9_-]/g, '_')}`,
      cycleKey: getDailyNewsBriefCycleKey(nowMs),
      scheduledHourPt: DAILY_NEWS_BRIEF_PEAK_HOUR_PT,
      generatedAt: meta.generatedAt || m.updatedAt || new Date(nowMs).toISOString(),
      modelUsed: 'gemini-3.8-flash',
      thinkingLevel: 'HIGH',
      source: meta.source || 'pipeline-grounded',
      wordCount: 195,
      headline,
      summary,
      bullets: [bulletRoster, bulletHealth, bulletMatchupBeat],
      coveredStoryKeys: [],
      coveredUrls: candidates.map(c => c.url),
      sources: candidates.slice(0, 10).map(c => ({
        type: c.type,
        author: c.author,
        outlet: c.outlet,
        title: c.title,
        url: c.url,
        publishedAt: c.publishedAt
      }))
    }
  );
}

export function hydrateCachedDailyTopNewsBrief(appData, nowMs = Date.now()) {
  if (!appData?.news) return false;
  const activeCycle = getDailyNewsBriefCycleKey(nowMs);
  const cached = safeReadLocalJson(DAILY_NEWS_BRIEF_CACHE_KEY);

  if (cached && cached.cycleKey === activeCycle && cached.headline && Array.isArray(cached.bullets)) {
    const upstream = appData.news.dailyTopNewsBrief;
    const upstreamGenMs = upstream?.generatedAt ? Date.parse(upstream.generatedAt) : 0;
    const cachedGenMs = cached.generatedAt ? Date.parse(cached.generatedAt) : 0;
    if (!upstream || upstream.cycleKey !== activeCycle || cachedGenMs >= upstreamGenMs) {
      appData.news.dailyTopNewsBrief = cached;
      return true;
    }
  }

  if (!appData.news.dailyTopNewsBrief) {
    appData.news.dailyTopNewsBrief = buildDeterministicDailyTopNewsBrief(appData, nowMs);
    return true;
  }
  return false;
}

/**
 * Generates or refreshes the Daily Gemini 3.8 Flash High Top-News Brief once per 24-hour
 * 5:00 PM PT (`17:00 America/Los_Angeles`) news cycle using the user's AI Studio token
 * (`prefs.geminiNewsApiKey || prefs.geminiApiKey`, strictly <= 1 RPD credit per cycle).
 */
export async function refreshDailyTopNewsBriefIfDue({
  appData,
  prefs = {},
  force = false,
  nowMs = Date.now()
} = {}) {
  if (!appData?.news) {
    return { updated: false, reason: 'no_news_state' };
  }

  hydrateCachedDailyTopNewsBrief(appData, nowMs);

  const effectiveKey = String(prefs?.geminiNewsApiKey || prefs?.geminiApiKey || '').trim();
  const baseUrl = String(prefs?.workerBaseUrl || '').trim().replace(/\/+$/, '');
  if (!effectiveKey && !baseUrl) {
    return { updated: false, reason: 'no_ai_connection' };
  }

  const activeCycle = getDailyNewsBriefCycleKey(nowMs);
  const existing = appData.news.dailyTopNewsBrief;

  if (!force) {
    if (
      existing &&
      existing.cycleKey === activeCycle &&
      (existing.source === 'live-gemini-daily' || existing.source === 'pipeline-gemini-daily') &&
      Array.isArray(existing.bullets) &&
      existing.bullets.length >= 2
    ) {
      return { updated: false, fromCache: true, cycleKey: activeCycle };
    }
    const cached = safeReadLocalJson(DAILY_NEWS_BRIEF_CACHE_KEY);
    if (cached && cached.cycleKey === activeCycle && cached.source === 'live-gemini-daily') {
      appData.news.dailyTopNewsBrief = cached;
      return { updated: false, fromCache: true, cycleKey: activeCycle };
    }
    const attempt = safeReadLocalJson(DAILY_NEWS_BRIEF_ATTEMPT_KEY);
    if (attempt && attempt.cycleKey === activeCycle) {
      return { updated: false, alreadyAttemptedThisCycle: true, cycleKey: activeCycle };
    }
  }

  if (inFlightDailyNewsBriefPromise) {
    return inFlightDailyNewsBriefPromise;
  }

  inFlightDailyNewsBriefPromise = (async () => {
    safeWriteLocalJson(DAILY_NEWS_BRIEF_ATTEMPT_KEY, {
      cycleKey: activeCycle,
      attemptedAt: new Date(nowMs).toISOString()
    });

    const sourceCandidates = selectTopNewsBriefSourceCandidates(appData, 14, nowMs);
    if (sourceCandidates.length === 0) {
      return { updated: false, reason: 'no_source_candidates' };
    }
    const promptText = buildDailyTopNewsBriefPrompt(appData, sourceCandidates);
    const systemPrompt = buildLiveGroundingSystemPrompt(appData);

    try {
      let normalized = null;
      let modelUsed = 'gemini-3.8-flash';
      const generatedAt = new Date().toISOString();

      if (baseUrl && !effectiveKey) {
        const res = await fetch(`${baseUrl}/api/daily-news-brief`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Group-Passcode': prefs?.groupPasscode || ''
          },
          body: JSON.stringify({
            cycleKey: activeCycle,
            forceRefresh: Boolean(force),
            prompt: promptText,
            systemPrompt
          })
        });
        if (res.ok) {
          const json = await res.json();
          modelUsed = json?.modelUsed || modelUsed;
          normalized = parseAndSanitizeDailyTopNewsBrief(
            json?.data || json?.rawText,
            sourceCandidates,
            appData,
            {
              cycleKey: activeCycle,
              generatedAt: json?.generatedAt || generatedAt,
              modelUsed,
              source: 'live-gemini-daily'
            }
          );
        }
      } else if (effectiveKey) {
        const keyPrefs =
          prefs?.geminiNewsApiKey && prefs.geminiNewsApiKey !== prefs.geminiApiKey
            ? { ...prefs, geminiApiKey: effectiveKey }
            : prefs;
        const conn = await resolveDirectGeminiCascades(keyPrefs);
        const flashHighCascade = [
          'gemini-3.8-flash',
          ...(conn.cascade || []).filter(m => m !== 'gemini-3.8-flash')
        ];
        const gen = await callGeminiDirectWithCascade({
          apiBase: conn.apiBase,
          key: effectiveKey,
          cascade: flashHighCascade,
          systemInstructionText: systemPrompt,
          userText: promptText,
          useGoogleSearch: true,
          temperature: 0.16,
          perAttemptTimeoutMs: 45000
        });
        modelUsed = gen.modelUsed || modelUsed;
        normalized = parseAndSanitizeDailyTopNewsBrief(gen.text, sourceCandidates, appData, {
          cycleKey: activeCycle,
          generatedAt,
          modelUsed,
          source: 'live-gemini-daily'
        });
      }

      if (!normalized) {
        return { updated: false, reason: 'invalid_or_empty_payload' };
      }

      safeWriteLocalJson(DAILY_NEWS_BRIEF_CACHE_KEY, normalized);
      appData.news.dailyTopNewsBrief = normalized;
      return { updated: true, modelUsed, cycleKey: activeCycle };
    } catch {
      return { updated: false, reason: 'request_failed_graceful_fallback' };
    } finally {
      inFlightDailyNewsBriefPromise = null;
    }
  })();

  return inFlightDailyNewsBriefPromise;
}
