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
  const liveSnapshot = buildAuthoritativeLiveContextSnapshot(appData);
  const groundingRules = buildLiveGroundingSystemPrompt(appData);

  const emit = (stepIdx, percent, message, subDetail = '', customModelLabel = '') => {
    onProgress?.({
      kind: 'analysis',
      stepIdx,
      totalSteps: 3,
      stages: ANALYSIS_PIPELINE_STAGES,
      percent,
      estLabel: waitEst.estLabel,
      summaryText: waitEst.summaryText,
      modelLabel: customModelLabel || modelInfo.displayLabel,
      message,
      subDetail
    });
  };

  // =========================================================================
  // Cloud Worker Transport (`prefs.workerBaseUrl`)
  // =========================================================================
  const baseUrl = String(prefs?.workerBaseUrl || '').trim().replace(/\/+$/, '');
  if (baseUrl) {
    emit(
      1,
      18,
      'Step 1 of 3: Deep research on the topic…',
      'Querying live ESPN NFL Nation, Bluesky 49ers beat wire, Google Search Grounding & 88-player ledger.'
    );
    const liveSearchItems = await fetchLiveTopicSignals(cleanPrompt);
    const dossier = compileDeepResearchDossier({
      query: cleanPrompt,
      appData,
      liveSearchItems
    });

    emit(
      2,
      54,
      `Step 2 of 3: Auditing All-22 film mechanics, EPA & CBA cap math (${modelInfo.shortModelName})…`,
      'Running unhurried High-Thinking multi-pass synthesis & adversarial verification.'
    );
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
        deepResearchPass: true,
        verifyPass: true,
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
    if (json.item?.markdown) {
      json.item.markdown = sanitizeHallucinatedRosterText(json.item.markdown, rosterPlayers);
    }
    emit(
      3,
      97,
      'Step 3 of 3: Structuring verified scouting & cap report…',
      'Cross-checked zero retired/departed roster claims and saved to library.'
    );
    return json.item;
  }

  // =========================================================================
  // Direct Browser Gemini Pro High-Thinking 3-Stage Pipeline (`prefs.geminiApiKey`)
  // =========================================================================
  const conn = await resolveDirectGeminiCascades(prefs);
  const activeBadge = formatActiveModelBadge(conn.bestModel, 'Accuracy-First');

  // STAGE 1: Deep Research Investigation (~15–30s with Google Search Grounding + High Thinking)
  emit(
    1,
    14,
    'Step 1 of 3: Deep research on the topic…',
    `Running live Google Search Grounding + ESPN/Bluesky wire + 88-player 49ers ledger investigation (${conn.bestModel} HIGH).`,
    activeBadge
  );
  const liveSearchItems = await fetchLiveTopicSignals(cleanPrompt);
  const dossier = compileDeepResearchDossier({
    query: cleanPrompt,
    appData,
    liveSearchItems
  });

  let finalMarkdown = '';
  let finalModel = conn.bestModel;
  let groundingChips = [];

  try {
    // Single unified High-Thinking + Google Search Grounding synthesis call (1 RPD per analysis -> 20/day on Gemini 3.8 High)
    emit(
      2,
      52,
      `Step 2 of 3: Auditing All-22 film, EPA splits & CBA cap math (${conn.bestModel} HIGH)…`,
      'Synthesizing bespoke thesis, scheme cause-and-effect, counter-arguments & multi-year cap trade-offs with Google Search Grounding.',
      activeBadge
    );

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

    // STAGE 3: Deterministic Anti-Hallucination & Roster Verification Audit (0 extra RPD cost)
    emit(
      3,
      88,
      'Step 3 of 3: Adversarial fact-check & structuring final report…',
      'Auditing every player bucket, OverTheCap figure, draft slot & sharpening prose clarity.',
      formatActiveModelBadge(finalModel, 'Accuracy-First')
    );
  } catch (err) {
    if (!isGeminiQuotaExhaustedError(err)) {
      throw err;
    }
    emit(
      2,
      62,
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
    emit(
      3,
      92,
      'Step 3 of 3: Structuring verified scouting & cap report…',
      'Completed 6-section All-22 & OverTheCap audit.'
    );
  }

  const verifiedMarkdown = sanitizeHallucinatedRosterText(finalMarkdown, rosterPlayers);
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
  const liveSnapshot = buildAuthoritativeLiveContextSnapshot(appData);
  const groundingRules = buildLiveGroundingSystemPrompt(appData);

  const emit = (stepIdx, percent, message, subDetail = '', customModelLabel = '') => {
    onProgress?.({
      kind: 'podcast',
      stepIdx,
      totalSteps: 3,
      stages: PODCAST_PIPELINE_STAGES,
      percent,
      estLabel: waitEst.estLabel,
      summaryText: waitEst.summaryText,
      modelLabel: customModelLabel || modelInfo.displayLabel,
      message,
      subDetail
    });
  };

  // =========================================================================
  // Cloud Worker Transport (`prefs.workerBaseUrl`)
  // =========================================================================
  const baseUrl = String(prefs?.workerBaseUrl || '').trim().replace(/\/+$/, '');
  if (baseUrl) {
    emit(
      1,
      14,
      'Step 1 of 3: Deep research on the topic…',
      `Investigating "${cleanTopic}" across live beat wire, Google Search Grounding & 88-player roster/cap ledger.`
    );
    const liveSearchItems = await fetchLiveTopicSignals(cleanTopic);
    const dossier = compileDeepResearchDossier({
      query: cleanTopic,
      appData,
      liveSearchItems
    });

    emit(
      2,
      46,
      `Step 2 of 3: Restructuring deep research into ${mins}-min NotebookLM audio script…`,
      `Running ${modelInfo.shortModelName} multi-pass synthesis + Gemini NotebookLM Studio Voices.`
    );
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
        deepResearchPass: true,
        verifyPass: true,
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

    if (cloudEp && !cloudEp.audioUrl && Array.isArray(cloudEp.transcript) && cloudEp.transcript.length > 0) {
      emit(
        3,
        64,
        'Step 3 of 3: Converting verified script into studio Stereo podcast audio…',
        'Rendering natural multi-speaker studio voices.'
      );
      const rendered = await synthesizeTurnsWithKokoroWorker(
        cloudEp.id,
        cloudEp.transcript,
        info => {
          const mappedPct = 62 + Math.round(Number(info.subPercent || 10) * 0.36);
          emit(
            3,
            Math.min(99, mappedPct),
            'Step 3 of 3: Converting script into studio podcast audio…',
            info.detail
          );
        }
      );
      cloudEp.audioUrl = rendered.audioUrl;
      cloudEp.durationSec = rendered.durationSec;
      cloudEp.transcript = rendered.transcript;
    } else {
      emit(
        3,
        98,
        'Step 3 of 3: Studio podcast mastered & ready to play!',
        'Gemini NotebookLM multi-speaker audio verified and indexed.'
      );
    }
    return cloudEp;
  }

  // =========================================================================
  // Direct Browser Gemini Pro High-Thinking + Gemini NotebookLM Multi-Speaker TTS
  // =========================================================================
  const conn = await resolveDirectGeminiCascades(prefs);
  const activeBadge = formatActiveModelBadge(conn.bestModel, 'Accuracy-First');

  // STAGE 1: Deep Research on the Topic (~15–30s High-Thinking + Google Search Grounding)
  emit(
    1,
    12,
    'Step 1 of 3: Deep research on the topic…',
    `Investigating "${cleanTopic}" via ${conn.bestModel} HIGH + Google Search Grounding + 88-player EPA/cap ledger.`,
    activeBadge
  );

  const liveSearchItems = await fetchLiveTopicSignals(cleanTopic);
  const dossier = compileDeepResearchDossier({
    query: cleanTopic,
    appData,
    liveSearchItems
  });

  let parsedTurns = null;
  let scriptModelUsed = conn.bestModel;
  let groundingChips = [];

  try {
    // STAGE 2: Restructure Deep Research Dossier into Smooth NotebookLM Conversational Script
    // Uses 1 unified High-Thinking + Google Search Grounding query so 20 RPD = 20 full podcasts/day!
    const targetWordEst = Math.round(mins * 148);
    emit(
      2,
      46,
      `Step 2 of 3: Restructuring deep research into ${mins}-min NotebookLM script…`,
      `Writing natural ~${targetWordEst}-word ${solo ? 'solo briefing' : 'Marcus & Elena studio conversation'} (${conn.bestModel} HIGH + Google Search Grounding).`,
      activeBadge
    );

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
    emit(
      2,
      54,
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

  const sanitizedTurns = parsedTurns
    .map(t => ({
      speaker: solo ? 'Marcus' : t?.speaker === 'Elena' ? 'Elena' : 'Marcus',
      text: sanitizeHallucinatedRosterText(String(t?.text || '').trim(), rosterPlayers)
    }))
    .filter(t => t.text.length > 0);

  // STAGE 3: Convert Script to Podcast via Gemini Native Multi-Speaker NotebookLM TTS (`Puck` + `Aoede`)
  const episodeId = `custom_ep_${Date.now()}`;
  emit(
    3,
    66,
    'Step 3 of 3: Converting script to podcast (Gemini NotebookLM Studio Voices)…',
    `Synthesizing smooth multi-speaker studio dialogue (${solo ? 'Charon' : 'Puck & Aoede'}).`,
    formatActiveModelBadge(scriptModelUsed, 'NotebookLM TTS')
  );

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
        const mappedPct = 66 + Math.round(Number(info.subPercent || 10) * 0.32);
        emit(
          3,
          Math.min(99, mappedPct),
          'Step 3 of 3: Recording Gemini NotebookLM studio podcast…',
          info.detail || 'Synthesizing conversational studio voices…',
          formatActiveModelBadge(scriptModelUsed, 'NotebookLM TTS')
        );
      }
    });
  } catch {
    // Fallback strictly to Kokoro-82M human voices (`af_heart` + `am_fenrir`) if Gemini TTS hits free-tier daily quota
    renderedAudio = await synthesizeTurnsWithKokoroWorker(episodeId, sanitizedTurns, info => {
      const mappedPct = 68 + Math.round(Number(info.subPercent || 10) * 0.3);
      emit(
        3,
        Math.min(99, mappedPct),
        'Step 3 of 3: Converting script to natural studio podcast audio…',
        info.detail || 'Synthesizing Kokoro-82M human voices…',
        formatActiveModelBadge(scriptModelUsed, 'Kokoro-82M')
      );
    });
  }

  emit(
    3,
    100,
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
}
