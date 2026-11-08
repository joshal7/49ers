/**
 * 49ers Faithful — Zero-Cost Serverless Edge Worker (Cloudflare Free Tier)
 *
 * Endpoints & Scheduled Tasks:
 * - GET  /api/shared-feed        -> Returns shared group cache of Deep Analyses & Autopodcasts
 * - GET  /api/model-status       -> Returns active Free-Tier Gemini model & cascade (`?poll=1` forces live `/v1beta/models` poll)
 * - GET  /api/audio/:episodeId   -> Streams cached MP3/WAV from Cloudflare R2 (supports HTTP Range for iOS Safari)
 * - POST /api/analyze            -> Runs best available Free-Tier Gemini model (3.8 Flash HIGH Thinking + Google Search Grounding)
 * - POST /api/podcast            -> Generates verified script + Gemini Multi-Speaker TTS audio, stores in R2 & indexes in KV
 * - CRON scheduled()             -> Periodically polls `/v1beta/models` every 6h and auto-upgrades to the best free Gemini model
 */

import {
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
  chunkTurnsForGeminiTts,
  NOTEBOOKLM_VOICE_PROFILES
} from '../src/engine/geminiStudioPrompts.js';

export const DEFAULT_FREE_MODEL_CASCADE = [
  'gemini-3.8-flash',
  'gemini-3.5-flash',
  'gemini-3-flash-preview',
  'gemini-2.5-flash',
  'gemini-2.5-pro'
];

export const DEFAULT_AUDIO_TTS_CASCADE = [
  'gemini-2.5-pro-preview-tts',
  'gemini-2.5-flash-preview-tts'
];

export const HIGH_THINKING_BUDGET = 24576;

export const EDITORIAL_SYSTEM_PROMPT = `You are the Lead Football Intelligence Analyst for "49ers Faithful", a private briefing platform for 25 high-IQ San Francisco 49ers fans.
UNHURRIED HIGH-THINKING MANDATE — PRIORITIZE ACCURACY & ANALYTICAL QUALITY OVER GENERATION TIME:
0. Take full advantage of your maximum High-Thinking token budget. NEVER rush, truncate verification, approximate CBA contract math, or sacrifice prose/dialogue quality to respond faster. Readers and listeners gladly wait longer for an exhaustive, zero-error, coaching-tape-grade output.
1. NEVER rely on stale pre-trained model weights for roster composition, retired players, trades, free-agent signings, coaching staff, win-loss-tie records, draft pick inventory, or injury designations.
2. Treat the provided AUTHORITATIVE LIVE REAL-TIME DATA SNAPSHOT and live Google Search Grounding as your SOLE source of truth for current-season facts.
3. MANDATORY COACHING, CAP & DRAFT GROUNDING:
   - Head Coach: Kyle Shanahan | Defensive Coordinator: Raheem Morris (Wide-9 4-man rush married to disguised split-safety / Cover-3 Buzz / Quarters rotations).
   - Multi-Year CBA Cap Reality: San Francisco's 2026 Top-51 cap space (~$35.16M) MUST roll over under CBA Article 13 to offset a projected -$31.54M 2027 cap deficit. Never treat 2026 cap space as "free money" detached from 2027 obligations.
   - Midseason Trade Proration Math: Acquiring clubs absorb only the remaining weekly proration (e.g., 9/18ths at Week 9) of a player's 2026 base salary while signing/option bonus proration stays with the seller—meaning $35.16M in 2026 space carries ~$65M+ of annualized base-salary purchasing power WITHOUT requiring sellers to eat salary, though every $1 spent in 2026 directly deepens the 2027 deficit.
   - 2027 Draft Capital: Check the exact pick count in the snapshot (SF owns 6 picks in 2027 after trading its own 2027 4th-rounder to Indianapolis for DT DeForest Buckner; Rd 6 is via BAL and Rd 7 is via KC). Do not recommend reckless Day-2 pick overpays for expiring rentals.
   - Trade Target Rigor: Only recommend real NFL players verified on genuine seller/surplus rosters who upgrade true 49ers weak links (perimeter WR / 12-personnel move TE, LG pass protection, rotational speed EDGE, veteran Dime CB/S). Reject declining age-cliff veterans with zero pass-rush juice (e.g., age-37 Cameron Jordan) or recently extended untouchables (e.g., Michael Mayer).
4. NEVER attribute retired, cut, or departed former 49ers (such as Bryce Huff, Javon Hargrave, Charvarius Ward, Talanoa Hufanga, Aaron Banks, Leonard Floyd, Maliek Collins, Jordan Mason, Elijah Mitchell, Jauan Jennings, Arik Armstead, Chase Young, Randy Gregory) to the current active 49ers rotation unless explicitly marked as Active on the LIVE 49ERS ROSTER snapshot. You MAY discuss departed players strictly in verified historical, 2026 dead-cap, opponent, or external trade-target context (e.g., Javon Hargrave dead cap or Chase Young on the Saints).
5. INTERNAL MULTI-PASS SELF-AUDIT BEFORE OUTPUT: Silently verify every player's current team, contract figure, pick round, scheme mechanic, and probability against the snapshot and Google Search Grounding—and refine phrasing for clarity and precision—before emitting a single word of output.
6. STRICT EDITORIAL CHARTER: ZERO clickbait, sensationalism, tabloid drama, or filler throat-clearing. Separate Verified Facts, Film/Scheme Mechanics (11/21 personnel, Wide-9, T-E stunt geometry, Cover 2/3/4/Quarters, EPA/play, CPOE, RYOE), and CBA Salary Cap Math.`;

export function scoreFreeTierGeminiModel(modelEntryOrId) {
  const rawName =
    typeof modelEntryOrId === 'string'
      ? modelEntryOrId
      : String(modelEntryOrId?.name || modelEntryOrId?.id || '');
  const id = rawName.replace(/^models\//i, '').trim().toLowerCase();
  if (!id.startsWith('gemini-')) return -1;

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

  const freeTierBonus = isFlash ? 260 : versionNum >= 3.8 ? 275 : 80;
  const versionScore = Math.round(versionNum * 100);
  const stabilityAdj = id.includes('exp') ? -18 : id.includes('preview') ? -6 : 10;
  const latestAliasPenalty = id.endsWith('-latest') ? -4 : 0;

  return freeTierBonus + versionScore + stabilityAdj + latestAliasPenalty;
}

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

export async function pollAndCacheBestFreeModel(env) {
  const nowIso = new Date().toISOString();
  let catalogModels = [];
  let source = 'default-free-tier-cascade';

  if (env.GEMINI_API_KEY) {
    try {
      const listUrl = `https://generativelanguage.googleapis.com/v1beta/models?key=${env.GEMINI_API_KEY}`;
      const res = await fetch(listUrl);
      if (res.ok) {
        const json = await res.json();
        if (Array.isArray(json?.models)) {
          catalogModels = json.models;
          source = 'google-ai-studio-v1beta-models-poll';
        }
      }
    } catch {}
  }

  const rankedCascade = rankFreeTierModelsFromCatalog(catalogModels);
  const bestModel = rankedCascade[0] || DEFAULT_FREE_MODEL_CASCADE[0];
  const state = {
    bestModel,
    thinkingLevel: 'HIGH',
    thinkingBudget: Number(env.GEMINI_THINKING_BUDGET || HIGH_THINKING_BUDGET),
    rankedCascade,
    source,
    checkedAt: nowIso
  };

  if (env.SHARED_CACHE) {
    await env.SHARED_CACHE.put('meta:best_free_model', JSON.stringify(state), {
      expirationTtl: 60 * 60 * 6
    });
  }
  return state;
}

function corsHeaders(origin, allowedOrigin) {
  const allow =
    !origin || origin.includes('localhost') || origin.includes('127.0.0.1') || origin === allowedOrigin
      ? origin || '*'
      : allowedOrigin || '*';
  return {
    'Access-Control-Allow-Origin': allow,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-Group-Passcode, Range',
    'Access-Control-Expose-Headers': 'Content-Length, Content-Range, Accept-Ranges'
  };
}

function jsonResponse(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...extraHeaders }
  });
}

async function parseJsonBodySafe(request) {
  try {
    const parsed = await request.json();
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function extractNonThoughtText(geminiJson) {
  const parts = geminiJson?.candidates?.[0]?.content?.parts;
  if (!Array.isArray(parts) || parts.length === 0) return '';
  return parts
    .filter(p => p && !p.thought && typeof p.text === 'string')
    .map(p => p.text)
    .join('\n')
    .trim();
}

function parseScriptTurnsSafe(rawText) {
  const cleaned = String(rawText || '')
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
  try {
    const arr = JSON.parse(cleaned);
    if (Array.isArray(arr) && arr.length > 0) return arr;
  } catch {
    // Extract balanced JSON array if model included surrounding prose with Google Search grounding
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
  return [{ speaker: 'Marcus', text: cleaned || 'Briefing generated.' }];
}

const RETIRED_OR_DEPARTED_GUARDRAIL_NAMES = [
  'Bryce Huff',
  'Javon Hargrave',
  'Charvarius Ward',
  'Talanoa Hufanga',
  'Aaron Banks',
  'Leonard Floyd',
  'Maliek Collins',
  'Jordan Mason',
  'Elijah Mitchell',
  'Jauan Jennings',
  'Arik Armstead',
  'Chase Young',
  'Randy Gregory',
  'Jake Moody',
  'Sam Darnold',
  'Jimmy Garoppolo',
  'Trey Lance'
];

function scrubStaleWeightHallucinations(text = '', contextSummary = '') {
  let out = String(text || '');
  if (!out) return out;
  const ctxLower = String(contextSummary || '').toLowerCase();
  const nonActiveContextRe =
    /\b(retired|former|departed|no longer|not on the active|not currently on|dead\s*cap|dead\s*money|post-june|void\s*year|trade\s*target|trade\s*candidate|trade\s*fit|seller|acquire|saints|new\s*orleans|colts|indianapolis|vikings|minnesota|texans|houston|falcons|atlanta|bears|chicago|titans|tennessee|jaguars|jacksonville|seahawks|seattle|packers|green\s*bay)\b/i;

  const activeRosterSection = (ctxLower.split('do not cite')[0] || '')
    .split('trade window')[0]
    .split('dead cap')[0];

  for (const name of RETIRED_OR_DEPARTED_GUARDRAIL_NAMES) {
    if (name !== 'Bryce Huff' && activeRosterSection.includes(name.toLowerCase())) continue;

    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/['’]/g, "['’]?");
    const re = new RegExp(`\\b${escaped}\\b`, 'gi');
    if (!re.test(out)) continue;

    re.lastIndex = 0;
    let hasActiveHallucination = false;
    let match;
    while ((match = re.exec(out)) !== null) {
      if (name === 'Bryce Huff') {
        hasActiveHallucination = true;
        break;
      }
      const winStart = Math.max(0, match.index - 140);
      const winEnd = Math.min(out.length, match.index + match[0].length + 140);
      const localWindow = out.slice(winStart, winEnd);
      if (!nonActiveContextRe.test(localWindow)) {
        hasActiveHallucination = true;
        break;
      }
    }

    if (!hasActiveHallucination) continue;

    const listCommaRe = new RegExp(`\\b${escaped},\\s*`, 'gi');
    out = out.replace(listCommaRe, '');
    out = out.replace(new RegExp(`\\b${escaped}\\b`, 'gi'), 'Mykel Williams');
  }
  return out;
}

async function sha256Short(input) {
  const bytes = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest))
    .slice(0, 8)
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

function pcm16ToWav(pcmBytes, sampleRate = 24000) {
  // Duplicate mono 16-bit PCM frames into 2-channel Stereo (L+R in-phase) so iOS/Android
  // hardware speakers always receive a standard Stereo (L R) channel layout.
  const numFrames = Math.floor(pcmBytes.byteLength / 2);
  const numChannels = 2;
  const stereoDataBytes = numFrames * numChannels * 2;
  const wav = new Uint8Array(44 + stereoDataBytes);
  const view = new DataView(wav.buffer);
  const srcView = new DataView(pcmBytes.buffer, pcmBytes.byteOffset, pcmBytes.byteLength);
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

  let outOff = 44;
  for (let i = 0; i < numFrames; i++) {
    const sample = srcView.getInt16(i * 2, true);
    view.setInt16(outOff, sample, true);
    view.setInt16(outOff + 2, sample, true);
    outOff += 4;
  }
  return wav;
}

async function resolveModelCascade(env) {
  const explicitModel =
    env.GEMINI_TEXT_MODEL && env.GEMINI_TEXT_MODEL !== 'auto' ? env.GEMINI_TEXT_MODEL : null;
  const cachedState = (await env.SHARED_CACHE?.get('meta:best_free_model', 'json')) || null;
  const baseCascade = Array.isArray(cachedState?.rankedCascade) && cachedState.rankedCascade.length > 0
    ? cachedState.rankedCascade
    : DEFAULT_FREE_MODEL_CASCADE;
  const primary =
    explicitModel ||
    cachedState?.bestModel ||
    env.GEMINI_DEFAULT_FREE_MODEL ||
    DEFAULT_FREE_MODEL_CASCADE[0];
  return [primary, ...baseCascade.filter(m => m !== primary)];
}

async function callGeminiTextWithFallback(env, payload) {
  const cascade = await resolveModelCascade(env);
  let lastRes = null;
  const requestedBudget =
    payload?.generationConfig?.thinkingConfig?.thinkingBudget ||
    Number(env.GEMINI_THINKING_BUDGET || HIGH_THINKING_BUDGET);

  for (let i = 0; i < cascade.length; i++) {
    const model = cascade[i];
    const modelThinkingConfig = buildGeminiThinkingConfig(model, requestedBudget);
    const modelPayload = {
      ...payload,
      generationConfig: {
        ...(payload.generationConfig || {}),
        thinkingConfig: modelThinkingConfig
      }
    };
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${env.GEMINI_API_KEY}`;
    let res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(modelPayload)
    });

    if (res.status === 400 && Array.isArray(modelPayload.tools) && modelPayload.tools.length > 0) {
      const { tools: _omitTools, ...withoutToolsPayload } = modelPayload;
      res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(withoutToolsPayload)
      });
    }

    lastRes = res;

    if (res.ok) {
      if (i > 0 && env.SHARED_CACHE) {
        await env.SHARED_CACHE.put(
          'meta:best_free_model',
          JSON.stringify({
            bestModel: model,
            thinkingLevel: 'HIGH',
            thinkingBudget: Number(env.GEMINI_THINKING_BUDGET || HIGH_THINKING_BUDGET),
            rankedCascade: [model, ...cascade.filter(m => m !== model)],
            source: 'auto-failover-promotion',
            checkedAt: new Date().toISOString()
          }),
          { expirationTtl: 60 * 60 * 6 }
        );
      }
      return { res, modelUsed: model };
    }

    // Cascade to the next model if the endpoint returned 400 (unsupported tool/param),
    // 404 (not found), 403/429 (quota/restricted), or 503 (temporarily overloaded).
    if (![400, 403, 404, 429, 503].includes(res.status)) {
      break;
    }
  }

  return { res: lastRes, modelUsed: cascade[0] };
}

async function callGeminiAudioTtsWithFallback(env, payload) {
  const configured = String(env.GEMINI_AUDIO_MODEL || '').trim();
  const cascade =
    configured && configured !== 'auto'
      ? [configured, ...DEFAULT_AUDIO_TTS_CASCADE.filter(m => m !== configured)]
      : [...DEFAULT_AUDIO_TTS_CASCADE];

  let lastRes = null;
  for (let i = 0; i < cascade.length; i++) {
    const audioModel = cascade[i];
    const ttsUrl = `https://generativelanguage.googleapis.com/v1beta/models/${audioModel}:generateContent?key=${env.GEMINI_API_KEY}`;
    const res = await fetch(ttsUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    lastRes = res;
    if (res.ok) {
      return { res, audioModelUsed: audioModel };
    }
    if (![400, 403, 404, 429, 503].includes(res.status)) {
      break;
    }
  }
  return { res: lastRes, audioModelUsed: cascade[0] };
}

export default {
  async scheduled(_event, env, ctx) {
    const task = pollAndCacheBestFreeModel(env);
    if (ctx && typeof ctx.waitUntil === 'function') {
      ctx.waitUntil(task);
    } else {
      await task;
    }
  },

  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '';
    const cors = corsHeaders(origin, env.ALLOWED_ORIGIN);

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: cors });
    }

    const url = new URL(request.url);

    // Public audio stream route (supports iOS Safari byte-range requests)
    if (request.method === 'GET' && url.pathname.startsWith('/api/audio/')) {
      const episodeId = url.pathname.replace('/api/audio/', '').replace(/[^a-zA-Z0-9_-]/g, '');
      if (!env.PODCAST_BUCKET) {
        return jsonResponse({ error: 'R2 bucket not bound' }, 501, cors);
      }
      const obj = await env.PODCAST_BUCKET.get(`episodes/${episodeId}.wav`);
      if (!obj) {
        return jsonResponse({ error: 'Episode audio not found' }, 404, cors);
      }
      return new Response(obj.body, {
        status: 200,
        headers: {
          ...cors,
          'Content-Type': obj.httpMetadata?.contentType || 'audio/wav',
          'Accept-Ranges': 'bytes',
          'Cache-Control': 'public, max-age=31536000, immutable'
        }
      });
    }

    if (request.method === 'GET' && url.pathname === '/api/health') {
      return jsonResponse(
        {
          ok: true,
          service: '49ers-worker',
          defaultFreeModel: env.GEMINI_DEFAULT_FREE_MODEL || DEFAULT_FREE_MODEL_CASCADE[0],
          defaultAudioModel: DEFAULT_AUDIO_TTS_CASCADE[0],
          thinkingLevel: 'HIGH',
          thinkingBudget: HIGH_THINKING_BUDGET,
          qualityPriority: 'accuracy_over_latency'
        },
        200,
        cors
      );
    }

    // Authenticate sync passcode on API endpoints
    const providedPasscode = request.headers.get('X-Group-Passcode') || '';
    if (env.GROUP_PASSCODE && providedPasscode !== env.GROUP_PASSCODE) {
      return jsonResponse(
        { error: 'Invalid or missing sync passcode. Enter your passcode in Settings.' },
        401,
        cors
      );
    }

    if (request.method === 'GET' && url.pathname === '/api/model-status') {
      const forcePoll = url.searchParams.get('poll') === '1';
      let state = !forcePoll ? await env.SHARED_CACHE?.get('meta:best_free_model', 'json') : null;
      if (!state) {
        state = await pollAndCacheBestFreeModel(env);
      }
      return jsonResponse(state, 200, cors);
    }

    if (request.method === 'GET' && url.pathname === '/api/shared-feed') {
      const analyses = (await env.SHARED_CACHE?.get('index:analyses', 'json')) || [];
      const episodes = (await env.SHARED_CACHE?.get('index:episodes', 'json')) || [];
      return jsonResponse({ analyses, episodes }, 200, cors);
    }

    if (request.method === 'POST' && url.pathname === '/api/analyze') {
      const body = await parseJsonBodySafe(request);
      if (!body) {
        return jsonResponse({ error: 'Invalid JSON request body' }, 400, cors);
      }
      const prompt = String(body.prompt || '').trim();
      const sectionContext = String(body.contextSummary || '').slice(0, 28000);
      const clientSystemPrompt = String(body.systemPrompt || '').slice(0, 6000);
      const effectiveSystemPrompt = clientSystemPrompt
        ? `${EDITORIAL_SYSTEM_PROMPT}\n\n${clientSystemPrompt}`
        : EDITORIAL_SYSTEM_PROMPT;
      const author = String(body.author || 'Friend Group').slice(0, 40);

      if (!prompt) {
        return jsonResponse({ error: 'Prompt is required' }, 400, cors);
      }

      const contextHash = await sha256Short(sectionContext);
      const cacheKey = `analysis:${await sha256Short(`${prompt.toLowerCase()}:${contextHash}`)}`;
      const existing = await env.SHARED_CACHE?.get(cacheKey, 'json');
      if (existing && !body.forceRefresh) {
        return jsonResponse({ cached: true, item: existing }, 200, cors);
      }

      if (!env.GEMINI_API_KEY) {
        return jsonResponse(
          { error: 'GEMINI_API_KEY secret is not configured on this Worker yet.' },
          503,
          cors
        );
      }

      const thinkingBudget = Number(env.GEMINI_THINKING_BUDGET || HIGH_THINKING_BUDGET);
      let modelUsed = DEFAULT_FREE_MODEL_CASCADE[0];
      let verifiedPasses = 1;
      let rawMarkdown = '';
      let primaryGroundingJson = null;

      if (body.deepResearchPass === true) {
        // Stage 1: Exhaustive Deep Research Investigation + Live Google Search Grounding
        const { res: researchRes, modelUsed: researchModel } = await callGeminiTextWithFallback(env, {
          systemInstruction: {
            parts: [{ text: `${DEEP_RESEARCH_STAGE1_SYSTEM_PROMPT}\n\n${effectiveSystemPrompt}` }]
          },
          tools: [{ google_search: {} }],
          generationConfig: {
            temperature: 0.18,
            thinkingConfig: { thinkingBudget }
          },
          contents: [
            {
              role: 'user',
              parts: [
                {
                  text: buildStage1DeepResearchUserPrompt({
                    topicOrQuestion: prompt,
                    kind: 'analysis',
                    dossierSummaryText: '',
                    liveContextSnapshot: sectionContext
                  })
                }
              ]
            }
          ]
        });

        if (!researchRes.ok) {
          const errText = await researchRes.text();
          return jsonResponse({ error: `Gemini API error: ${errText.slice(0, 300)}` }, 502, cors);
        }
        primaryGroundingJson = await researchRes.json();
        const researchMemo = extractNonThoughtText(primaryGroundingJson) || '';

        // Stage 2: Bespoke Thesis-First Film & Cap Synthesis
        const { res: synthRes, modelUsed: synthModel } = await callGeminiTextWithFallback(env, {
          systemInstruction: {
            parts: [{ text: `${DEEP_ANALYSIS_STAGE2_SYSTEM_PROMPT}\n\n${effectiveSystemPrompt}` }]
          },
          generationConfig: {
            temperature: 0.2,
            thinkingConfig: { thinkingBudget }
          },
          contents: [
            {
              role: 'user',
              parts: [
                {
                  text: buildStage2AnalysisSynthesisPrompt({
                    question: prompt,
                    researchMemo,
                    liveContextSnapshot: sectionContext
                  })
                }
              ]
            }
          ]
        });

        if (!synthRes.ok) {
          const errText = await synthRes.text();
          return jsonResponse({ error: `Gemini API error: ${errText.slice(0, 300)}` }, 502, cors);
        }
        const synthJson = await synthRes.json();
        modelUsed = synthModel || researchModel;
        verifiedPasses = 2;
        rawMarkdown = extractNonThoughtText(synthJson) || researchMemo || 'No synthesis generated.';

        if (body.verifyPass === true && rawMarkdown && rawMarkdown !== 'No synthesis generated.') {
          const { res: auditRes, modelUsed: auditModel } = await callGeminiTextWithFallback(env, {
            systemInstruction: {
              parts: [{ text: `${DEEP_ANALYSIS_STAGE2_SYSTEM_PROMPT}\n\n${effectiveSystemPrompt}` }]
            },
            generationConfig: {
              temperature: 0.1,
              thinkingConfig: { thinkingBudget }
            },
            contents: [
              {
                role: 'user',
                parts: [
                  {
                    text: buildStage3AnalysisAuditPrompt({
                      question: prompt,
                      draftMarkdown: rawMarkdown,
                      liveContextSnapshot: sectionContext
                    })
                  }
                ]
              }
            ]
          });
          if (auditRes && auditRes.ok) {
            const auditJson = await auditRes.json();
            const auditedText = extractNonThoughtText(auditJson);
            if (auditedText && auditedText.trim().length >= 80) {
              rawMarkdown = auditedText;
              modelUsed = auditModel || modelUsed;
              verifiedPasses = 3;
            }
          }
        }
      } else {
        const { res: geminiRes, modelUsed: initialModelUsed } = await callGeminiTextWithFallback(env, {
          systemInstruction: {
            parts: [{ text: `${DEEP_ANALYSIS_STAGE2_SYSTEM_PROMPT}\n\n${effectiveSystemPrompt}` }]
          },
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
                  text: `Take your full unhurried High-Thinking reasoning budget—prioritize 100% factual accuracy, CBA contract precision, and All-22 coaching-tape depth over generation speed.\n\nDirectly and thoughtfully answer this exact 49ers question with zero generic AI throat-clearing, using ONLY verified live real-time roster/injury/trade/standings/cap/draft facts, All-22 film mechanics, EPA/NGS metrics, and multi-year CBA salary cap math (including 2026 Article 13 rollover into the 2027 cap horizon).\n\nQUESTION / TOPIC: ${prompt}\n\nAUTHORITATIVE LIVE REAL-TIME DATA SNAPSHOT:\n${sectionContext}`
                }
              ]
            }
          ]
        });

        if (!geminiRes.ok) {
          const errText = await geminiRes.text();
          return jsonResponse({ error: `Gemini API error: ${errText.slice(0, 300)}` }, 502, cors);
        }

        primaryGroundingJson = await geminiRes.json();
        modelUsed = initialModelUsed;
        verifiedPasses = 1;
        rawMarkdown = extractNonThoughtText(primaryGroundingJson) || 'No synthesis generated.';

        if (body.verifyPass === true && rawMarkdown && rawMarkdown !== 'No synthesis generated.') {
          const { res: verifyRes, modelUsed: verifyModel } = await callGeminiTextWithFallback(env, {
            systemInstruction: {
              parts: [{ text: `${DEEP_ANALYSIS_STAGE2_SYSTEM_PROMPT}\n\n${effectiveSystemPrompt}` }]
            },
            generationConfig: {
              temperature: 0.1,
              thinkingConfig: { thinkingBudget }
            },
            contents: [
              {
                role: 'user',
                parts: [
                  {
                    text: buildStage3AnalysisAuditPrompt({
                      question: prompt,
                      draftMarkdown: rawMarkdown,
                      liveContextSnapshot: sectionContext
                    })
                  }
                ]
              }
            ]
          });
          if (verifyRes && verifyRes.ok) {
            const verifyJson = await verifyRes.json();
            const auditedText = extractNonThoughtText(verifyJson);
            if (auditedText && auditedText.trim().length >= 80) {
              rawMarkdown = auditedText;
              modelUsed = verifyModel || modelUsed;
              verifiedPasses = 2;
            }
          }
        }
      }

      const markdown = scrubStaleWeightHallucinations(rawMarkdown, sectionContext);
      const groundingChunks =
        primaryGroundingJson?.candidates?.[0]?.groundingMetadata?.groundingChunks
          ?.map(c => c.web?.title)
          .filter(Boolean)
          .slice(0, 6) || ['Google Search Grounding', 'nflverse / OverTheCap'];

      const item = {
        id: cacheKey.replace(':', '_'),
        title: prompt.length > 88 ? `${prompt.slice(0, 85)}...` : prompt,
        category: body.category || 'On-Demand Deep Dive',
        modelUsed,
        thinkingLevel: 'HIGH',
        qualityPriority: 'accuracy_over_latency',
        verifiedPasses,
        createdAt: new Date().toISOString(),
        createdBy: author,
        sourcesCited: groundingChunks,
        markdown
      };

      if (env.SHARED_CACHE) {
        await env.SHARED_CACHE.put(cacheKey, JSON.stringify(item), { expirationTtl: 60 * 60 * 6 });
        const list = (await env.SHARED_CACHE.get('index:analyses', 'json')) || [];
        const updated = [item, ...list.filter(x => x.id !== item.id)].slice(0, 50);
        await env.SHARED_CACHE.put('index:analyses', JSON.stringify(updated));
      }

      return jsonResponse({ cached: false, item }, 200, cors);
    }

    if (request.method === 'POST' && url.pathname === '/api/podcast') {
      const body = await parseJsonBodySafe(request);
      if (!body) {
        return jsonResponse({ error: 'Invalid JSON request body' }, 400, cors);
      }
      const topic = String(body.topic || '').trim();
      const durationMinutes = Math.max(2, Math.min(20, Number(body.durationMinutes || 5)));
      const format = body.format === 'solo' ? 'Solo Executive Briefing' : 'Two-Host Analytical Banter';
      const contextSummary = String(body.contextSummary || '').slice(0, 28000);
      const clientSystemPrompt = String(body.systemPrompt || '').slice(0, 6000);
      const effectiveSystemPrompt = clientSystemPrompt
        ? `${EDITORIAL_SYSTEM_PROMPT}\n\n${clientSystemPrompt}`
        : EDITORIAL_SYSTEM_PROMPT;
      const targetWords = Math.round(durationMinutes * 145);

      if (!topic) {
        return jsonResponse({ error: 'Topic is required' }, 400, cors);
      }

      const contextHash = await sha256Short(contextSummary);
      const epId = `live_${await sha256Short(`${topic}:${durationMinutes}:${format}:${contextHash}`)}`;
      const existing = await env.SHARED_CACHE?.get(`episode:${epId}`, 'json');
      if (existing && !body.forceRefresh) {
        return jsonResponse({ cached: true, episode: existing }, 200, cors);
      }

      if (!env.GEMINI_API_KEY) {
        return jsonResponse(
          { error: 'GEMINI_API_KEY secret is not configured on this Worker yet.' },
          503,
          cors
        );
      }

      const thinkingBudget = Number(env.GEMINI_THINKING_BUDGET || HIGH_THINKING_BUDGET);
      const researchDossier = String(body.researchDossier || '').slice(0, 14000);
      const solo = body.format === 'solo';
      let modelUsed = DEFAULT_FREE_MODEL_CASCADE[0];
      let verifiedPasses = 1;
      let rawScriptText = '[]';

      if (body.deepResearchPass === true) {
        // Stage 1: Exhaustive Deep Research Investigation on the Podcast Topic
        const { res: researchRes, modelUsed: researchModel } = await callGeminiTextWithFallback(env, {
          systemInstruction: {
            parts: [{ text: `${DEEP_RESEARCH_STAGE1_SYSTEM_PROMPT}\n\n${effectiveSystemPrompt}` }]
          },
          tools: [{ google_search: {} }],
          generationConfig: {
            temperature: 0.2,
            thinkingConfig: { thinkingBudget }
          },
          contents: [
            {
              role: 'user',
              parts: [
                {
                  text: buildStage1DeepResearchUserPrompt({
                    topicOrQuestion: topic,
                    kind: 'podcast',
                    dossierSummaryText: researchDossier,
                    liveContextSnapshot: contextSummary
                  })
                }
              ]
            }
          ]
        });

        if (!researchRes.ok) {
          return jsonResponse({ error: 'Failed Stage-1 Deep Research for podcast' }, 502, cors);
        }
        const researchJson = await researchRes.json();
        const researchMemo = extractNonThoughtText(researchJson) || researchDossier;

        // Stage 2: Restructure into Smooth Gemini NotebookLM Audio Overview Script
        const { res: scriptRes, modelUsed: stage2Model } = await callGeminiTextWithFallback(env, {
          systemInstruction: {
            parts: [{ text: `${NOTEBOOKLM_PODCAST_STAGE2_SYSTEM_PROMPT}\n\n${effectiveSystemPrompt}` }]
          },
          generationConfig: {
            temperature: 0.3,
            thinkingConfig: { thinkingBudget }
          },
          contents: [
            {
              role: 'user',
              parts: [
                {
                  text: buildStage2NotebookLmScriptPrompt({
                    topic,
                    durationMinutes,
                    format: solo ? 'solo' : 'two_host',
                    researchMemo,
                    liveContextSnapshot: contextSummary
                  })
                }
              ]
            }
          ]
        });

        if (!scriptRes.ok) {
          return jsonResponse({ error: 'Failed to synthesize podcast script' }, 502, cors);
        }
        const scriptJson = await scriptRes.json();
        modelUsed = stage2Model || researchModel;
        verifiedPasses = 2;
        rawScriptText = extractNonThoughtText(scriptJson) || '[]';

        if (body.verifyPass === true) {
          const { res: polishRes, modelUsed: polishModel } = await callGeminiTextWithFallback(env, {
            systemInstruction: {
              parts: [{ text: `${NOTEBOOKLM_PODCAST_STAGE2_SYSTEM_PROMPT}\n\n${effectiveSystemPrompt}` }]
            },
            generationConfig: {
              temperature: 0.22,
              thinkingConfig: { thinkingBudget }
            },
            contents: [
              {
                role: 'user',
                parts: [
                  {
                    text: buildStage2NotebookLmPolishPrompt({
                      topic,
                      durationMinutes,
                      format: solo ? 'solo' : 'two_host',
                      draftJsonText: rawScriptText,
                      liveContextSnapshot: contextSummary
                    })
                  }
                ]
              }
            ]
          });
          if (polishRes && polishRes.ok) {
            const polishJson = await polishRes.json();
            const auditedScriptText = extractNonThoughtText(polishJson);
            const candidateTurns = parseScriptTurnsSafe(auditedScriptText || '');
            if (
              candidateTurns.length > 0 &&
              !(candidateTurns.length === 1 && candidateTurns[0].text === 'Briefing generated.')
            ) {
              rawScriptText = auditedScriptText;
              modelUsed = polishModel || modelUsed;
              verifiedPasses = 3;
            }
          }
        }
      } else {
        const scriptPrompt = buildStage2NotebookLmScriptPrompt({
          topic,
          durationMinutes,
          format: solo ? 'solo' : 'two_host',
          researchMemo: researchDossier || `Investigate "${topic}" across active/injured roster, All-22 film, and CBA cap math.`,
          liveContextSnapshot: contextSummary
        });

        const { res: scriptRes, modelUsed: initialScriptModel } = await callGeminiTextWithFallback(env, {
          systemInstruction: {
            parts: [{ text: `${NOTEBOOKLM_PODCAST_STAGE2_SYSTEM_PROMPT}\n\n${effectiveSystemPrompt}` }]
          },
          tools: [{ google_search: {} }],
          generationConfig: {
            temperature: 0.25,
            thinkingConfig: { thinkingBudget }
          },
          contents: [{ role: 'user', parts: [{ text: scriptPrompt }] }]
        });

        if (!scriptRes.ok) {
          return jsonResponse({ error: 'Failed to synthesize podcast script' }, 502, cors);
        }

        const scriptJson = await scriptRes.json();
        modelUsed = initialScriptModel;
        verifiedPasses = 1;
        rawScriptText = extractNonThoughtText(scriptJson) || '[]';

        if (body.verifyPass === true) {
          const { res: verifyScriptRes, modelUsed: verifyScriptModel } = await callGeminiTextWithFallback(env, {
            systemInstruction: {
              parts: [{ text: `${NOTEBOOKLM_PODCAST_STAGE2_SYSTEM_PROMPT}\n\n${effectiveSystemPrompt}` }]
            },
            generationConfig: {
              temperature: 0.2,
              thinkingConfig: { thinkingBudget }
            },
            contents: [
              {
                role: 'user',
                parts: [
                  {
                    text: buildStage2NotebookLmPolishPrompt({
                      topic,
                      durationMinutes,
                      format: solo ? 'solo' : 'two_host',
                      draftJsonText: rawScriptText,
                      liveContextSnapshot: contextSummary
                    })
                  }
                ]
              }
            ]
          });
          if (verifyScriptRes && verifyScriptRes.ok) {
            const verifyScriptJson = await verifyScriptRes.json();
            const auditedScriptText = extractNonThoughtText(verifyScriptJson);
            const candidateTurns = parseScriptTurnsSafe(auditedScriptText || '');
            if (
              candidateTurns.length > 0 &&
              !(candidateTurns.length === 1 && candidateTurns[0].text === 'Briefing generated.')
            ) {
              rawScriptText = auditedScriptText;
              modelUsed = verifyScriptModel || modelUsed;
              verifiedPasses = 2;
            }
          }
        }
      }

      const turns = parseScriptTurnsSafe(rawScriptText).map(t => ({
        ...t,
        speaker: solo ? 'Marcus' : t.speaker === 'Elena' ? 'Elena' : 'Marcus',
        text: scrubStaleWeightHallucinations(t.text || '', contextSummary)
      }));

      // Step 3: Render Multi-Speaker Native Audio via Gemini NotebookLM Studio Voices (`Puck` + `Aoede` / `Charon`)
      let audioUrl = null;
      let audioModelUsed = null;
      let measuredAudioSec = 0;
      if (env.PODCAST_BUCKET) {
        const ttsBlocks = chunkTurnsForGeminiTts(turns, 2400);
        const directorHeader = buildNotebookLmTtsDirectorHeader({
          format: solo ? 'solo' : 'two_host'
        });
        const speechConfig = solo
          ? {
              voiceConfig: {
                prebuiltVoiceConfig: { voiceName: NOTEBOOKLM_VOICE_PROFILES.solo.Marcus }
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

        const pcmBuffers = [];
        for (const block of ttsBlocks) {
          const ttsDialogue = directorHeader + block.map(t => t.spokenLine).join('\n');
          const { res: ttsRes, audioModelUsed: resolvedAudioModel } = await callGeminiAudioTtsWithFallback(env, {
            contents: [{ parts: [{ text: ttsDialogue }] }],
            generationConfig: {
              responseModalities: ['AUDIO'],
              speechConfig
            }
          });

          if (ttsRes && ttsRes.ok) {
            audioModelUsed = resolvedAudioModel;
            const ttsJson = await ttsRes.json();
            const b64 = ttsJson.candidates?.[0]?.content?.parts?.find(p => p?.inlineData?.data)?.inlineData?.data;
            if (b64) {
              const binaryStr = atob(b64);
              const pcm = new Uint8Array(binaryStr.length - (binaryStr.length % 2));
              for (let i = 0; i < pcm.length; i++) pcm[i] = binaryStr.charCodeAt(i);
              pcmBuffers.push(pcm);
            } else {
              break;
            }
          } else {
            break;
          }
        }

        if (pcmBuffers.length > 0 && pcmBuffers.length === ttsBlocks.length) {
          const pauseBytes = pcmBuffers.length > 1 ? Math.round(24000 * 0.14) * 2 : 0;
          const totalBytes =
            pcmBuffers.reduce((s, b) => s + b.byteLength, 0) +
            Math.max(0, pcmBuffers.length - 1) * pauseBytes;
          const combinedPcm = new Uint8Array(totalBytes);
          let writeOff = 0;
          for (let i = 0; i < pcmBuffers.length; i++) {
            combinedPcm.set(pcmBuffers[i], writeOff);
            writeOff += pcmBuffers[i].byteLength;
            if (i < pcmBuffers.length - 1) writeOff += pauseBytes;
          }
          const pcmSec = Math.floor(combinedPcm.byteLength / 2 / 24000);
          if (pcmSec >= 5) measuredAudioSec = pcmSec;
          const wavBytes = pcm16ToWav(combinedPcm, 24000);
          await env.PODCAST_BUCKET.put(`episodes/${epId}.wav`, wavBytes, {
            httpMetadata: { contentType: 'audio/wav' }
          });
          audioUrl = `${url.origin}/api/audio/${epId}`;
        }
      }

      let cursor = 0;
      const rawTimedTranscript = turns.map((t, idx) => {
        const words = String(t.text || '').split(/\s+/).length;
        const dur = Math.max(3, Math.round((words / 146) * 60));
        const seg = {
          idx,
          speaker: t.speaker || 'Marcus',
          speakerRole: t.speaker === 'Elena' ? 'Cap & Quantitative Insider' : "X's & O's Film Analyst",
          text: t.text,
          startSec: cursor,
          endSec: cursor + dur
        };
        cursor += dur;
        return seg;
      });

      const finalDurationSec = measuredAudioSec >= 5 ? measuredAudioSec : cursor;
      const scaleFactor = cursor > 0 && measuredAudioSec >= 5 ? measuredAudioSec / cursor : 1;
      const timedTranscript = rawTimedTranscript.map(seg => ({
        ...seg,
        startSec: Math.round(seg.startSec * scaleFactor),
        endSec: Math.max(Math.round(seg.startSec * scaleFactor) + 1, Math.round(seg.endSec * scaleFactor))
      }));

      const episode = {
        id: epId,
        title: topic,
        topic,
        format,
        presetLabel: `${durationMinutes}m Custom Pod`,
        modelUsed,
        audioModelUsed,
        thinkingLevel: 'HIGH',
        qualityPriority: 'accuracy_over_latency',
        verifiedPasses,
        createdBy: String(body.author || 'Friend Group'),
        createdAt: new Date().toISOString(),
        audioUrl,
        durationSec: finalDurationSec,
        transcript: timedTranscript
      };

      if (env.SHARED_CACHE) {
        await env.SHARED_CACHE.put(`episode:${epId}`, JSON.stringify(episode), { expirationTtl: 60 * 60 * 12 });
        const list = (await env.SHARED_CACHE.get('index:episodes', 'json')) || [];
        const updated = [episode, ...list.filter(x => x.id !== episode.id)].slice(0, 40);
        await env.SHARED_CACHE.put('index:episodes', JSON.stringify(updated));
      }

      return jsonResponse({ cached: false, episode }, 200, cors);
    }

    return jsonResponse({ status: 'ok', service: '49ers-worker' }, 200, cors);
  }
};
