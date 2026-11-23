/**
 * 49ers Faithful — Zero-Cost Serverless Edge Worker (Cloudflare Free Tier)
 *
 * Endpoints & Scheduled Tasks:
 * - GET  /api/health             -> Health probe & active Gemini reasoning/audio model metadata
 * - GET  /api/live-wire          -> 60s KV-cached CORS-proxied beat RSS, harvested X status posts (incl. MP4 clips) & YouTube Atom feeds
 * - GET  /api/gameday-inactives  -> 90-minute pre-kickoff official club RSS + RotoWire inactives + Top-Tier-Minus-1 Gemini Flash fallback
 * - GET  /api/video-stream       -> Referer-free HTTP Range relay for allowlisted `video.twimg.com` & ESPN MP4 highlight clips (`GET` + `HEAD`)
 * - GET  /api/audio/:episodeId   -> Streams cached Stereo WAV/MP3 from Cloudflare R2 with RFC 7233 HTTP `Range` (`206 Partial Content` + `HEAD`)
 * - GET  /api/shared-feed        -> Returns shared group cache of Deep Analyses & Autopodcasts (`X-Group-Passcode` gated when set)
 * - GET  /api/model-status       -> Returns active Free-Tier Gemini model & cascade (`?poll=1` forces live `/v1beta/models` poll)
 * - GET|POST /api/daily-news-brief -> Reads or generates non-time-sensitive 1/day 5:00 PM PT Top-News Brief (Gemini 4 Hydrogen `XHIGH`)
 * - POST /api/matchup-intel      -> Generates non-time-sensitive 1/day Matchup Intel Briefing (Gemini 4 Hydrogen `XHIGH`)
 * - POST /api/analyze            -> Runs live On-Demand Deep Analysis (Gemini 4 Hydrogen `HIGH` Thinking + Google Search Grounding)
 * - POST /api/podcast            -> Generates live Auto Pod script (Gemini 4 Hydrogen `HIGH`) + Multi-Speaker TTS audio, stores in R2 & indexes in KV
 * - CRON scheduled()             -> Polls `/v1beta/models` every 6h and proactively synthesizes & caches the 1/day 5:00 PM PT (and variable game-day post-game) Top-News Brief in KV
 */

import {
  PRIMARY_GEMINI_REASONING_MODEL,
  LIVE_INTERACTIVE_GEMINI_THINKING_LEVEL,
  rankSecondTierGeminiFlashModels,
  buildGeminiThinkingConfig,
  resolveGeminiThinkingLevelLabel,
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
import {
  ESPN_NFL_TEAM_IDS,
  NFL_TEAM_OFFICIAL_RSS_URLS,
  normalizeCanonicalTeamAbbr,
  discoverOfficialClubInactivesRssItem,
  parseOfficialClubInactivesArticle,
  parseRotoWireInactivesHtml,
  parseEspnCoreEventRosterInactives
} from '../src/engine/gameDayRosterEngine.js';
import {
  isAllowedInlineVideoStreamUrl,
  selectBestXSyndicationMp4
} from '../src/engine/linkIntegrity.js';
import {
  resolveNewsBriefCycleState,
  isDailyBriefStaleForLiveState,
  isAppDataAwaitingLivePostGameHydration
} from '../src/engine/breakingClassifier.js';
import { buildLiveGroundingSystemPrompt } from '../src/engine/groundingValidator.js';
import {
  DAILY_NEWS_BRIEF_PEAK_HOUR_PT,
  selectTopNewsBriefSourceCandidates,
  buildDailyTopNewsBriefPrompt,
  parseAndSanitizeDailyTopNewsBrief
} from '../src/services/aiWorkerClient.js';

export const DEFAULT_FREE_MODEL_CASCADE = [
  'gemini-4-hydrogen',
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

export const EDITORIAL_SYSTEM_PROMPT = `You are an independent Lead Football Intelligence Analyst for "49ers Faithful", a private briefing platform for 25 high-IQ San Francisco 49ers fans.
UNHURRIED HIGH-THINKING MANDATE — PRIORITIZE ACCURACY & ANALYTICAL QUALITY OVER GENERATION TIME:
0. Achieve exhaustive factual accuracy, exact CBA contract math, and coaching-tape analytical depth with focused, non-repetitive internal reasoning: consult the AUTHORITATIVE LIVE REAL-TIME DATA SNAPSHOT first, run at most 1–2 targeted Google Search queries ONLY if a brand-new external fact is missing, and avoid redundant internal re-drafting loops.
1. NEVER rely on stale pre-trained model weights for roster composition, retired players, trades, free-agent signings, coaching staff, win-loss-tie records, draft pick inventory, or injury designations.
2. Treat the provided AUTHORITATIVE LIVE REAL-TIME DATA SNAPSHOT and live Google Search Grounding as your SOLE source of truth for current-season facts.
3. MANDATORY COACHING, CAP & DRAFT GROUNDING:
   - Head Coach: Kyle Shanahan | Offensive Coordinator: Klay Kubiak | Defensive Coordinator: Raheem Morris (Wide-9 4-man rush married to disguised split-safety / Cover-3 Buzz / Quarters rotations). Former 49ers coaches Robert Saleh (Titans HC), Nick Sorensen, Steve Wilks, DeMeco Ryans (Texans HC), Mike McDaniel (Dolphins HC), and Klint Kubiak (Raiders HC) are NO LONGER on San Francisco's staff.
   - Multi-Year CBA Cap Reality (When Cap/Contracts Are Relevant): Unused 2026 Top-51 cap space rolls over 1-for-1 under CBA Article 13 to offset San Francisco's projected 2027 cap deficit (never treat 2026 cap space as "free money" detached from 2027 obligations). Cite cap math ONLY when salary cap, contracts, or transactions are genuinely relevant—never shoehorn unprompted cap rollover boilerplate into game recaps, injury updates, or non-cap news summaries.
   - Midseason Trade Proration Math: Acquiring clubs absorb only the remaining weekly proration (e.g., 9/18ths at Week 9) of a player's 2026 base salary while signing/option bonus proration stays with the seller—meaning $35.16M in 2026 space carries ~$65M+ of annualized base-salary purchasing power WITHOUT requiring sellers to eat salary, though every $1 spent in 2026 directly deepens the 2027 deficit.
   - 2027 Draft Capital: Check the exact pick count in the snapshot (SF owns 6 picks in 2027 after trading its own 2027 4th-rounder to Indianapolis for DT DeForest Buckner; Rd 6 is via BAL and Rd 7 is via KC). Do not recommend reckless Day-2 pick overpays for expiring rentals.
   - Trade Target Rigor: Only recommend real NFL players verified on genuine seller/surplus rosters who upgrade true 49ers weak links (perimeter WR / 12-personnel move TE, LG pass protection, rotational speed EDGE, veteran Dime CB/S). Reject declining age-cliff veterans with zero pass-rush juice (e.g., age-37 Cameron Jordan) or recently extended untouchables (e.g., Michael Mayer).
4. NEVER attribute retired, cut, or departed former 49ers (such as Bryce Huff, Javon Hargrave, Charvarius Ward, Talanoa Hufanga, Aaron Banks, Leonard Floyd, Maliek Collins, Jordan Mason, Elijah Mitchell, Jauan Jennings, Arik Armstead, Chase Young, Randy Gregory) to the current active 49ers rotation unless explicitly marked as Active on the LIVE 49ERS ROSTER snapshot. You MAY discuss departed players strictly in verified historical, 2026 dead-cap, opponent, or external trade-target context (e.g., Javon Hargrave dead cap or Chase Young on the Saints).
5. FAIR, BALANCED & NON-HOMER ASSESSMENT MANDATE: Evaluate San Francisco with the exact same sober, league-wide objectivity as an independent national NFL analyst—never as a cheerleader, homer, or team PR voice. Use third-person team references ("San Francisco", "the 49ers", "they"), NOT first-person fan pronouns ("we/us/our"). Always benchmark 49ers units against all 32 teams (pairing strengths with bottom-half NFL vulnerabilities), give full analytical weight to opponent coordinators, top-10 units, and star playmakers, and calibrate matchup confidence strictly to the Vegas spread / implied win probability (treat ±3.5-point spreads as competitive coin-flips giving roughly 50/50 weight to both teams' paths to victory).
6. INTERNAL MULTI-PASS SELF-AUDIT BEFORE OUTPUT: Silently verify every player's current team, 32-team rank, contract figure, pick round, scheme mechanic, and probability against the snapshot and Google Search Grounding—and strip any homer exaggeration or one-sided bias—before emitting a single word of output.
7. STRICT EDITORIAL CHARTER: ZERO clickbait, sensationalism, tabloid drama, blind homer hype, or filler throat-clearing. Separate Verified Facts, Film/Scheme Mechanics (11/21 personnel, Wide-9, T-E stunt geometry, Cover 2/3/4/Quarters, EPA/play, CPOE, RYOE), and CBA Salary Cap Math.`;

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
  const versionNum = verMatch ? parseFloat(verMatch[1]) : /\bhydrogen\b/.test(id) ? 4.0 : 2.0;
  if (!Number.isFinite(versionNum) || versionNum < 2.5) return -1;

  const isHydrogen = /\bhydrogen\b/.test(id);
  const isFlash = /\bflash\b/.test(id);
  const isPro = /\bpro\b/.test(id);
  const isCarbonOrArgon = /\b(carbon|argon)\b/.test(id);
  if (!isHydrogen && !isFlash && !isPro && !isCarbonOrArgon) return -1;

  const freeTierBonus = isHydrogen
    ? 360
    : isFlash
      ? 285
      : isPro && versionNum >= 3.8
        ? 270
        : 80;
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
      const listUrl = `https://generativelanguage.googleapis.com/v1beta/models?key=${env.GEMINI_API_KEY}&pageSize=1000`;
      const res = await fetch(listUrl, { signal: AbortSignal.timeout(6000) });
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
    thinkingLevel: resolveGeminiThinkingLevelLabel(bestModel),
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
    'Access-Control-Allow-Methods': 'GET, HEAD, POST, OPTIONS',
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
  'Trey Lance',
  'Robert Saleh',
  'Nick Sorensen',
  'Steve Wilks'
];
const DEPARTED_COACH_GUARDRAIL_SET = new Set(['Robert Saleh', 'Nick Sorensen', 'Steve Wilks']);

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

    if (DEPARTED_COACH_GUARDRAIL_SET.has(name)) {
      out = out.replace(new RegExp(`\\b${escaped}\\b`, 'gi'), 'Raheem Morris');
      continue;
    }
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

async function callGeminiTextWithFallback(env, payload, options = {}) {
  const cascade = await resolveModelCascade(env);
  let lastRes = null;
  const requestedBudget =
    payload?.generationConfig?.thinkingConfig?.thinkingBudget ||
    Number(env.GEMINI_THINKING_BUDGET || HIGH_THINKING_BUDGET);
  const preferredThinkingLevel =
    options?.preferredThinkingLevel ||
    payload?.generationConfig?.thinkingConfig?.thinkingLevel ||
    null;

  for (let i = 0; i < cascade.length; i++) {
    const model = cascade[i];
    const modelThinkingConfig = buildGeminiThinkingConfig(model, requestedBudget, {
      preferredThinkingLevel
    });
    let thinkingLevelUsed =
      modelThinkingConfig?.thinkingLevel ||
      resolveGeminiThinkingLevelLabel(model, preferredThinkingLevel);
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

    if (res.status === 400 && modelThinkingConfig?.thinkingLevel === 'XHIGH') {
      const { tools: _omitTools2, ...baseFallback } = modelPayload;
      const highFallbackPayload = {
        ...baseFallback,
        generationConfig: {
          ...(modelPayload.generationConfig || {}),
          thinkingConfig: { thinkingLevel: 'HIGH' }
        }
      };
      res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(highFallbackPayload)
      });
      if (res.ok) thinkingLevelUsed = 'HIGH';
    }

    lastRes = res;

    if (res.ok) {
      if (i > 0 && env.SHARED_CACHE) {
        await env.SHARED_CACHE.put(
          'meta:best_free_model',
          JSON.stringify({
            bestModel: model,
            thinkingLevel: resolveGeminiThinkingLevelLabel(model),
            thinkingBudget: Number(env.GEMINI_THINKING_BUDGET || HIGH_THINKING_BUDGET),
            rankedCascade: [model, ...cascade.filter(m => m !== model)],
            source: 'auto-failover-promotion',
            checkedAt: new Date().toISOString()
          }),
          { expirationTtl: 60 * 60 * 6 }
        );
      }
      return { res, modelUsed: model, thinkingLevelUsed };
    }

    // Cascade to the next model if the endpoint returned 400 (unsupported tool/param),
    // 404 (not found), 403/429 (quota/restricted), or 503 (temporarily overloaded).
    if (![400, 403, 404, 429, 503].includes(res.status)) {
      break;
    }
  }

  return {
    res: lastRes,
    modelUsed: cascade[0],
    thinkingLevelUsed: resolveGeminiThinkingLevelLabel(cascade[0], preferredThinkingLevel)
  };
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

async function expandAllowedShortenerUrlEdge(env, rawInput) {
  const clean = String(rawInput || '').trim();
  if (!clean) return '';
  let parsed;
  try {
    parsed = new URL(clean.startsWith('http://') ? `https://${clean.slice(7)}` : clean);
  } catch {
    return '';
  }
  if (parsed.protocol !== 'https:' || !ALLOWED_SHORTENER_HOST_RE.test(parsed.hostname.toLowerCase())) {
    return '';
  }
  const normalizedShort = parsed.toString();
  const kvKey = `expand_v1:${normalizedShort}`;
  const cached = await env.SHARED_CACHE?.get(kvKey);
  if (cached !== null && cached !== undefined) {
    return cached;
  }
  let resolved = '';
  for (const method of ['HEAD', 'GET']) {
    try {
      const r = await fetch(normalizedShort, {
        method,
        redirect: 'follow',
        headers: {
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36'
        },
        signal: AbortSignal.timeout(3500)
      });
      if (r?.url) {
        const dest = new URL(r.url.startsWith('http://') ? `https://${r.url.slice(7)}` : r.url);
        if (dest.protocol === 'https:' && !ALLOWED_SHORTENER_HOST_RE.test(dest.hostname.toLowerCase())) {
          resolved = stripEdgeTrackingParams(dest.toString());
          break;
        }
      }
    } catch {}
  }
  if (env.SHARED_CACHE) {
    await env.SHARED_CACHE.put(kvKey, resolved, { expirationTtl: resolved ? 86400 : 1800 });
  }
  return resolved;
}

async function collectEdgeLiveWire(
  env,
  { maxXHydrate = 14, includeYouTube = true, useCache = true, writeCache = true } = {}
) {
  if (useCache) {
    const cachedWire = await env.SHARED_CACHE?.get('wire:rss_live_v6', 'json');
    if (cachedWire && Array.isArray(cachedWire.items)) {
      return { cached: true, ...cachedWire };
    }
  }

  const rssSources = [
    { outletId: 'nbcsba', outletName: 'NBC Sports Bay Area', url: 'https://www.nbcsportsbayarea.com/nfl/san-francisco-49ers/?rss=1', sfOnly: false },
    { outletId: '49ers_official', outletName: '49ers.com Official', url: 'https://www.49ers.com/rss/news', sfOnly: false },
    { outletId: 'niners_nation', outletName: 'Niners Nation', url: 'https://www.ninersnation.com/rss/current.xml', sfOnly: false },
    { outletId: '49ers_webzone', outletName: '49ers Webzone', url: 'https://feeds.feedburner.com/49erswebzone', sfOnly: false },
    { outletId: 'pfrumors', outletName: 'Pro Football Rumors', url: 'https://www.profootballrumors.com/san-francisco-49ers/feed', sfOnly: false },
    { outletId: 'nfl_trade_rumors', outletName: 'NFL Trade Rumors', url: 'https://nfltraderumors.co/feed/', sfOnly: true },
    { outletId: 'nfl_network', outletName: 'ProFootballTalk', url: 'https://profootballtalk.nbcsports.com/feed/', sfOnly: true },
    { outletId: 'sf_standard', outletName: 'The SF Standard', url: 'https://www.sfstandard.com/sports/feed/', sfOnly: true }
  ];

  const ytChannels = includeYouTube
    ? [
        { channelId: 'UCeIOarQkwmGhimim9cDUTng', channel: 'San Francisco 49ers', sfOnly: false, embeddable: false },
        { channelId: 'UCDVYQ4Zhbm3S2dlz7P1GBDg', channel: 'NFL', sfOnly: true, embeddable: false },
        { channelId: 'UCGfxHp2yuimtLsFaq1r7aIQ', channel: 'The QB School', sfOnly: true, embeddable: true },
        { channelId: 'UCt1LfHRE5eGiacPVtiaC10w', channel: "Jonnydel's Football Academy", sfOnly: true, embeddable: true }
      ]
    : [];

  const decodeBasic = str =>
    String(str || '')
      .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&quot;/g, '"')
      .replace(/&#39;|&apos;/g, "'")
      .replace(/\s+/g, ' ')
      .trim();

  const sfExplicitRe =
    /(?:\b(?:49er|49ers|niners|san francisco|santa clara|levi['’]?s(?:\s+stadium)?|kyle shanahan|shanahan|john lynch|raheem morris|klay kubiak|kris kocurek|chris foerster|paraag marathe|jed york)\b|(?:^|[\s([{"',|/-])#(?:49ers|fttb)\b)/i;
  const sfPlayerRe =
    /\b(brock purdy|purdy|nick bosa|christian mccaffrey|mccaffrey|george kittle|kittle|fred warner|deebo samuel|deebo|brandon aiyuk|aiyuk|ricky pearsall|pearsall|deommodore lenoir|lenoir|dre greenlaw|greenlaw|renardo green|malik mustapha|mustapha|ji['’]?ayir brown|upton stout|trent williams|mykel williams|deforest buckner|buckner|osa odighizuwa|odighizuwa|keion white|keenan allen|mike evans|kyle juszczyk|juszczyk|isaac guerendo|guerendo|jordan watkins|jaden dugger|ephesians prysock|prysock|mac jones|christian kirk|brandin cooks|demarcus robinson|nate hobbs|romello height|gracen halton|c\.?j\.? west|eddy pineiro|colton mckivitz|dominick puni|jake brendel)\b/i;
  const sfRe = new RegExp(`(?:${sfExplicitRe.source}|${sfPlayerRe.source})`, 'i');
  const otherTeamLeadRe = /\b(rams|seahawks|cardinals|cowboys|eagles|giants|commanders|bears|lions|packers|vikings|falcons|panthers|saints|buccaneers|bucs|bills|dolphins|patriots|jets|ravens|bengals|browns|steelers|texans|colts|jaguars|jags|titans|broncos|chiefs|raiders|chargers)\b/i;
  const otherTeamOrCityPat =
    '(?:rams|seahawks|cardinals|cowboys|eagles|giants|commanders|bears|lions|packers|vikings|falcons|panthers|saints|buccaneers|bucs|bills|dolphins|patriots|pats|jets|ravens|bengals|browns|steelers|texans|colts|jaguars|jags|titans|broncos|chiefs|raiders|chargers|arizona|atlanta|baltimore|buffalo|carolina|chicago|cincinnati|cleveland|dallas|denver|detroit|green\\s+bay|houston|indianapolis|jacksonville|kansas\\s+city|las\\s+vegas|los\\s+angeles|miami|minnesota|new\\s+england|new\\s+orleans|new\\s+york|philadelphia|pittsburgh|seattle|tampa\\s+bay|tennessee|washington)';
  const staffRolePat =
    '(?:head\\s+coach|interim\\s+(?:head\\s+)?coach|coach|hc|offensive\\s+coordinator|oc|defensive\\s+coordinator|dc|special\\s+teams\\s+coordinator|stc|general\\s+manager|gm|assistant(?:\\s+coach)?|coordinator|quarterbacks?\\s+coach|linebackers?\\s+coach|defensive\\s+line\\s+coach|offensive\\s+line\\s+coach|pass\\s+game\\s+coordinator|run\\s+game\\s+coordinator)';
  const otherTeamStaffAttrRe = new RegExp(
    `\\b${otherTeamOrCityPat}(?:['’]s?)?\\s+${staffRolePat}\\s+([A-Za-z][A-Za-z'.-]+(?:\\s+[A-Za-z][A-Za-z'.-]+)?)\\b`,
    'gi'
  );
  const personOtherTeamApposRe = new RegExp(
    `\\b([A-Za-z][A-Za-z'.-]+(?:\\s+[A-Za-z][A-Za-z'.-]+)?),\\s+(?:the\\s+)?${otherTeamOrCityPat}(?:['’]s?)?\\s+${staffRolePat}\\b`,
    'gi'
  );
  const formerSfRe =
    /\b(?:former|ex[-\s])\s*(?:san\s+francisco\s+)?(?:49ers|niners)(?:\s+(?:hc|oc|dc|gm|head\s+coach|assistant|coach|coordinator|qb|rb|fb|wr|te|ol|dl|lb|cb|db|de|dt|s|k|p|ls|exec|executive|scout))?\b/gi;
  const conflictingLeadershipRe =
    /\b(?:mike\s+shanahan|klint\s+kubiak|gary\s+kubiak|marshawn\s+lynch|paxton\s+lynch|joey\s+bosa|kurt\s+warner|kyle\s+dugger|alvin\s+kamara|josh\s+allen)\b/gi;
  const histSfBioRe = /\b(originally signed (?:on )?with (?:the )?(?:49ers|san francisco|niners)|(?:was )?(?:selected|drafted|taken) [\s\S]{0,55}by (?:the )?(?:49ers|san francisco|niners)|began (?:his|their) (?:nfl )?career with (?:the )?(?:49ers|san francisco|niners)|spent (?:time|his rookie|the \d{4} season|\d+ seasons?) with (?:the )?(?:49ers|san francisco|niners)|played (?:for|with) (?:the )?(?:49ers|san francisco|niners) (?:from|in) 20(?:0\d|1\d|2[0-4])|stint with (?:the )?(?:49ers|san francisco|niners)|undrafted free agent [\s\S]{0,50}(?:49ers|san francisco|niners))\b/i;
  const stripWpFooter = s =>
    String(s || '')
      .replace(/\s*The post [\s\S]*? appeared first on [^\n.]+(?:\.[a-z]{2,4})?\.?/gi, '')
      .replace(/\s*appeared first on (?:NFLTradeRumors\.co|Pro Football Rumors|ProFootballRumors\.com)[^.\n]*\.?/gi, '')
      .trim();
  const stripNonSfContextsEdge = s =>
    String(s || '')
      .replace(formerSfRe, ' ')
      .replace(conflictingLeadershipRe, ' ')
      .replace(otherTeamStaffAttrRe, (m, namePart) =>
        /^[A-Z]/.test(String(namePart || '').trim()) && !/\b(?:49er|49ers|niners|san\s+francisco)\b/i.test(namePart) ? ' ' : m
      )
      .replace(personOtherTeamApposRe, (m, namePart) =>
        /^[A-Z]/.test(String(namePart || '').trim()) && !/\b(?:49er|49ers|niners|san\s+francisco)\b/i.test(namePart) ? ' ' : m
      )
      .replace(/\s+/g, ' ')
      .trim();
  const stripHistBio = s =>
    stripWpFooter(s)
      .split(/(?<=[.!?])\s+/)
      .filter(sent => sent && !histSfBioRe.test(sent))
      .join(' ')
      .trim();
  const isEdgeItem49ersRelevant = (titleText, summaryText) => {
    const cleanTitle = stripWpFooter(titleText);
    const titleClean = stripNonSfContextsEdge(cleanTitle);
    if (sfRe.test(titleClean)) return true;
    if (otherTeamLeadRe.test(cleanTitle)) return false;
    const cleanBody = stripHistBio(summaryText);
    const bodyClean = stripNonSfContextsEdge(cleanBody);
    if (sfExplicitRe.test(bodyClean)) return true;
    if (otherTeamLeadRe.test(cleanBody)) return false;
    return sfPlayerRe.test(bodyClean);
  };
  const trustedSfBeatHandleRe = /^(49ers|maiocconbcs|mattbarrows|jenniferleechan|lombardihimself|nwagoner|caminman|eric_branch|timkawakami|victafur|harrisonrich_|mattblively|chrisbiderman|dieter|brianajeannel|graham_sfn|thesfNiners|49erswebzone|nbcs49ers|ninersnation)$/i;
  const xStatusRe = /https?:\/\/(?:www\.|mobile\.)?(?:x|twitter)\.com\/([A-Za-z0-9_]{2,25})\/status\/(\d{15,22})/gi;
  const discoveredStatusMap = new Map();
  const seenEdgeUrls = new Set();
  const items = [];
  const nowEdgeMs = Date.now();

  await Promise.all([
    ...rssSources.map(async src => {
      try {
        const r = await fetch(src.url, {
          headers: { 'User-Agent': '49ersFaithfulEdge/2.0' },
          signal: AbortSignal.timeout(4500)
        });
        if (!r.ok) return;
        const xml = await r.text();
        for (const xm of xml.replace(/\\\//g, '/').matchAll(xStatusRe)) {
          const h = xm[1];
          const sid = xm[2];
          if (!/^(i|intent|share|hashtag|search)$/i.test(h) && !discoveredStatusMap.has(sid)) {
            discoveredStatusMap.set(sid, h);
          }
        }
        const blocks = xml.match(/<(?:item|entry)\b[\s\S]*?<\/(?:item|entry)>/gi) || [];
        for (const block of blocks.slice(0, src.sfOnly ? 30 : 12)) {
          const title = stripWpFooter(decodeBasic((block.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || ''));
          const summary = stripWpFooter(
            decodeBasic(
              ((block.match(/<(?:description|summary|content)[^>]*>([\s\S]*?)<\/(?:description|summary|content)>/i) || [])[1] || '')
            )
          ).slice(0, 260);
          const link = decodeBasic(
            (block.match(/<link[^>]*href="([^"]+)"/i) || [])[1] ||
              (block.match(/<link>([\s\S]*?)<\/link>/i) || [])[1] ||
              ''
          );
          const pubRaw = decodeBasic(
            (block.match(/<(?:pubDate|published|updated)>([\s\S]*?)<\/(?:pubDate|published|updated)>/i) || [])[1] || ''
          );
          if (!title || !/^https:\/\//i.test(link) || seenEdgeUrls.has(link)) continue;
          if (src.sfOnly && !isEdgeItem49ersRelevant(title, summary)) continue;
          seenEdgeUrls.add(link);
          const pubMs = pubRaw ? Date.parse(pubRaw) : nowEdgeMs;
          items.push({
            type: 'article',
            title,
            summary,
            url: link,
            outletId: src.outletId,
            outletName: src.outletName,
            publishedAt: Number.isFinite(pubMs) ? new Date(Math.min(nowEdgeMs, pubMs)).toISOString() : new Date().toISOString()
          });
        }
      } catch {}
    }),
    (async () => {
      try {
        const wzRes = await fetch('https://www.49erswebzone.com/articles/', {
          headers: { 'User-Agent': '49ersFaithfulEdge/2.0' },
          signal: AbortSignal.timeout(4500)
        });
        if (!wzRes.ok) return;
        const wzHtml = await wzRes.text();
        for (const liMatch of wzHtml.matchAll(/<li\s+id="item-\d+"[^>]*>([\s\S]*?)<\/li>/gi)) {
          const li = liMatch[1];
          const tm = li.match(
            /<div[^>]*class="[^"]*content-news-title[^"]*"[^>]*>\s*<a[^>]*href="(https:\/\/www\.49erswebzone\.com\/articles\/[^"]+)"[^>]*>([\s\S]*?)<\/a>/i
          );
          if (!tm) continue;
          const link = tm[1].trim();
          const title = decodeBasic(tm[2]);
          if (!title || !/^https:\/\//i.test(link) || seenEdgeUrls.has(link)) continue;
          const summary = decodeBasic((li.match(/<span\s+class="description"[^>]*>([\s\S]*?)<\/span>/i) || [])[1] || '').slice(0, 260);
          const writer = decodeBasic((li.match(/<a\s+href="https:\/\/www\.49erswebzone\.com\/articles\/writer\/[^"]+"[^>]*>([\s\S]*?)<\/a>/i) || [])[1] || '');
          const relM = li.match(/&bull;\s*(\d+)\s*(mins?|minutes?|hrs?|hours?|days?)\b/i);
          const absM = li.match(
            /&bull;\s*([A-Z][a-z]{2,8}\s+\d{1,2},\s*\d{4})(?:\s+at\s+(\d{1,2}:\d{2}\s*[AP]M))?/i
          );
          let pubMs = nowEdgeMs - 3_600_000;
          if (relM) {
            const n = Number(relM[1]);
            const u = relM[2].toLowerCase();
            if (u.startsWith('m')) pubMs = nowEdgeMs - n * 60_000;
            else if (u.startsWith('h')) pubMs = nowEdgeMs - n * 3_600_000;
            else if (u.startsWith('d')) pubMs = nowEdgeMs - n * 86_400_000;
          } else if (absM) {
            const parsedAbs = Date.parse(`${absM[1]} ${absM[2] || '12:00 PM'} PST`);
            if (Number.isFinite(parsedAbs)) pubMs = Math.min(nowEdgeMs, parsedAbs);
          }
          seenEdgeUrls.add(link);
          items.push({
            type: 'article',
            title,
            summary,
            url: link,
            author: writer || '49ers Webzone',
            outletId: '49ers_webzone',
            outletName: '49ers Webzone',
            publishedAt: new Date(Math.min(nowEdgeMs, pubMs)).toISOString()
          });
        }
      } catch {}
    })(),
    ...ytChannels.map(async ch => {
      try {
        const r = await fetch(`https://www.youtube.com/feeds/videos.xml?channel_id=${ch.channelId}`, {
          headers: { 'User-Agent': '49ersFaithfulEdge/2.0' },
          signal: AbortSignal.timeout(4500)
        });
        if (!r.ok) return;
        const xml = await r.text();
        const entries = xml.match(/<entry\b[\s\S]*?<\/entry>/gi) || [];
        let emitted = 0;
        for (const entry of entries.slice(0, 15)) {
          if (emitted >= 6) break;
          const videoId = ((entry.match(/<yt:videoId>([^<]+)<\/yt:videoId>/i) || [])[1] || '').trim();
          const title = decodeBasic((entry.match(/<title>([\s\S]*?)<\/title>/i) || [])[1] || '');
          const pubRaw = ((entry.match(/<published>([^<]+)<\/published>/i) || [])[1] || '').trim();
          if (!videoId || !title || /#shorts\b/i.test(title) || /youtube\.com\/shorts\//i.test(entry)) continue;
          if (ch.sfOnly && !sfRe.test(stripNonSfContextsEdge(title))) continue;
          const pubMs = pubRaw ? Date.parse(pubRaw) : nowEdgeMs;
          if (Number.isFinite(pubMs) && nowEdgeMs - pubMs > 10 * 86_400_000) continue;
          emitted++;
          items.push({
            id: `edge_yt_${videoId}`,
            type: 'video',
            videoId,
            embeddable: ch.embeddable,
            title,
            summary: '',
            imageUrl: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
            url: `https://www.youtube.com/watch?v=${videoId}`,
            outletId: 'youtube',
            outletName: ch.channel,
            author: ch.channel,
            publishedAt: Number.isFinite(pubMs) ? new Date(Math.min(nowEdgeMs, pubMs)).toISOString() : new Date().toISOString()
          });
        }
      } catch {}
    })
  ]);

  if (maxXHydrate > 0) {
    const newestXIds = [...discoveredStatusMap.entries()]
      .sort((a, b) => (BigInt(b[0]) > BigInt(a[0]) ? 1 : -1))
      .slice(0, maxXHydrate);
    await Promise.all(
      newestXIds.map(async ([sid, fallbackHandle]) => {
        try {
          const sr = await fetch(`https://cdn.syndication.twimg.com/tweet-result?id=${sid}&token=x`, {
            signal: AbortSignal.timeout(3500)
          });
          if (!sr.ok) return;
          const syn = await sr.json();
          const txt = typeof syn?.text === 'string' ? syn.text.replace(/\s+/g, ' ').trim() : '';
          if (!txt || txt.length < 16) return;
          const handle = syn.user?.screen_name || fallbackHandle;
          if (!trustedSfBeatHandleRe.test(handle) && !sfRe.test(stripNonSfContextsEdge(txt))) return;
          const bestMp4 = selectBestXSyndicationMp4(syn);
          const durMs = Number(syn.video?.durationMs || syn.mediaDetails?.[0]?.video_info?.duration_millis || 0);
          const durFmt =
            durMs >= 5000
              ? `${Math.floor(durMs / 60000)}:${String(Math.round((durMs % 60000) / 1000)).padStart(2, '0')}`
              : '';
          const synCardBv = syn.card?.binding_values || {};
          const synCardThumb =
            synCardBv.summary_photo_image_large?.image_value?.url ||
            synCardBv.summary_photo_image?.image_value?.url ||
            synCardBv.photo_image_full_size_large?.image_value?.url ||
            synCardBv.thumbnail_image_large?.image_value?.url ||
            synCardBv.thumbnail_image?.image_value?.url ||
            '';
          const thumb =
            syn.photos?.[0]?.url ||
            syn.mediaDetails?.[0]?.media_url_https ||
            syn.video?.poster ||
            synCardThumb ||
            '';
          const snowMs = Number((BigInt(sid) >> 22n) + 1288834974657n);
          const synUrls = Array.isArray(syn.entities?.urls) ? syn.entities.urls : [];
          const rawExtU =
            synUrls.find(u => u?.expanded_url && !/^https?:\/\/(?:www\.)?(?:x|twitter)\.com\//i.test(u.expanded_url))
              ?.expanded_url ||
            syn.card?.binding_values?.card_url?.string_value ||
            '';
          let resolvedExtU = rawExtU;
          if (resolvedExtU) {
            try {
              const parsedExt = new URL(resolvedExtU.startsWith('http://') ? `https://${resolvedExtU.slice(7)}` : resolvedExtU);
              if (ALLOWED_SHORTENER_HOST_RE.test(parsedExt.hostname.toLowerCase())) {
                resolvedExtU = await expandAllowedShortenerUrlEdge(env, parsedExt.toString());
              } else {
                resolvedExtU = stripEdgeTrackingParams(parsedExt.toString());
              }
            } catch {
              resolvedExtU = '';
            }
          }
          const synCardTitle = syn.card?.binding_values?.title?.string_value || null;
          const synCardDesc = syn.card?.binding_values?.description?.string_value || null;
          items.push({
            id: `x_edge_${sid}`,
            type: 'tweet',
            title: txt.slice(0, 320),
            fullText: txt,
            url: `https://x.com/${handle}/status/${sid}`,
            externalUrl: resolvedExtU || null,
            externalTitle: resolvedExtU ? synCardTitle : null,
            externalDescription: resolvedExtU ? synCardDesc : null,
            imageUrl: thumb.startsWith('https://') ? thumb : '',
            videoStreamUrl: bestMp4 || undefined,
            isHighlightClip: Boolean(bestMp4 && durMs >= 8000),
            duration: durFmt || undefined,
            embeddable: true,
            outletId: 'x_beat',
            outletName: 'X Beat',
            author: syn.user?.name || `@${handle}`,
            authorHandle: `@${handle}`,
            authorProfileUrl: `https://x.com/${handle}`,
            publishedAt: new Date(Math.min(nowEdgeMs, snowMs)).toISOString()
          });
        } catch {}
      })
    );
  }

  const payload = { updatedAt: new Date().toISOString(), items };
  if (writeCache && env.SHARED_CACHE && items.length > 0 && includeYouTube && maxXHydrate >= 10) {
    await env.SHARED_CACHE.put('wire:rss_live_v6', JSON.stringify(payload), { expirationTtl: 60 });
  }
  return { cached: false, ...payload };
}

function parseEspnScoreNum(rawScore) {
  if (rawScore === null || rawScore === undefined) return null;
  if (typeof rawScore === 'object') {
    const v = rawScore.value ?? rawScore.displayValue;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  const n = Number(rawScore);
  return Number.isFinite(n) ? n : null;
}

export async function overlayLiveEspnScheduleForBrief(
  scheduleMatchup,
  meta,
  espnScheduleJson,
  { nowMs = Date.now(), env = null } = {}
) {
  const sched = Array.isArray(scheduleMatchup?.schedule) ? scheduleMatchup.schedule : [];
  const events = Array.isArray(espnScheduleJson?.events) ? espnScheduleJson.events : [];
  if (sched.length === 0 || events.length === 0) return;

  const byId = new Map();
  const byWeekType = new Map();
  for (const g of sched) {
    if (g?.id) byId.set(String(g.id), g);
    const st = String(g?.seasonType || 'REG').toUpperCase();
    if (g?.week != null) byWeekType.set(`${st}:${Number(g.week)}`, g);
  }

  let regWins = 0;
  let regLosses = 0;
  let regTies = 0;
  let countedReg = 0;

  for (const ev of events) {
    const comp = Array.isArray(ev?.competitions) ? ev.competitions[0] : null;
    if (!comp) continue;
    const statusType = comp.status?.type || {};
    const stNum = Number(ev?.seasonType?.type || ev?.season?.type || 2);
    const seasonType = stNum === 1 ? 'PRE' : stNum === 3 ? 'POST' : 'REG';
    const wk = Number(ev?.week?.number || 0);
    const target = byId.get(String(ev.id || '')) || byWeekType.get(`${seasonType}:${wk}`);
    if (!target) continue;

    const competitors = Array.isArray(comp.competitors) ? comp.competitors : [];
    const sfComp = competitors.find(
      c => String(c?.team?.abbreviation || '').toUpperCase() === 'SF' || String(c?.id || '') === '25'
    );
    const oppComp = competitors.find(c => c !== sfComp);
    const sfScore = parseEspnScoreNum(sfComp?.score);
    const oppScore = parseEspnScoreNum(oppComp?.score);
    const isCompleted = Boolean(statusType.completed) || String(statusType.state || '').toLowerCase() === 'post';
    const stateStr = String(statusType.state || '').toLowerCase();

    if (ev.date) {
      const liveEvMs = Date.parse(ev.date);
      const prevMs = target.dateIso ? Date.parse(target.dateIso) : NaN;
      if (Number.isFinite(liveEvMs) && (!Number.isFinite(prevMs) || Math.abs(liveEvMs - prevMs) >= 60_000)) {
        target.dateIso = ev.date;
      }
    }
    if (stateStr) target.statusState = stateStr;
    if (statusType.shortDetail || statusType.description) {
      target.statusDetail = statusType.shortDetail || statusType.description;
    }
    if (sfScore !== null && oppScore !== null && (isCompleted || stateStr === 'in')) {
      target.sfScore = sfScore;
      target.oppScore = oppScore;
    }
    if (isCompleted) {
      const wasCompletedBefore = Boolean(target.completed);
      target.completed = true;
      if (sfScore !== null && oppScore !== null) {
        target.result = sfScore > oppScore ? 'W' : sfScore < oppScore ? 'L' : 'T';
      } else if (sfComp?.winner === true) {
        target.result = 'W';
      } else if (oppComp?.winner === true) {
        target.result = 'L';
      }
      if (!target.completedAt && ev.id) {
        const compKvKey = `game_completed_at:${String(ev.id)}`;
        let seenCompletedIso = null;
        if (env?.SHARED_CACHE) {
          seenCompletedIso = await env.SHARED_CACHE.get(compKvKey);
          if (!seenCompletedIso && !wasCompletedBefore) {
            seenCompletedIso = new Date(nowMs).toISOString();
            await env.SHARED_CACHE.put(compKvKey, seenCompletedIso, { expirationTtl: 60 * 60 * 48 });
          }
        }
        if (seenCompletedIso) target.completedAt = seenCompletedIso;
      }
    }
  }

  for (const g of sched) {
    if (String(g?.seasonType || 'REG').toUpperCase() === 'REG' && g.completed && g.result) {
      countedReg += 1;
      if (g.result === 'W') regWins += 1;
      else if (g.result === 'L') regLosses += 1;
      else if (g.result === 'T') regTies += 1;
    }
  }
  if (meta && countedReg > 0) {
    meta.teamRecord = regTies > 0 ? `${regWins}-${regLosses}-${regTies}` : `${regWins}-${regLosses}`;
  }
}

function buildLightweightRosterFromFeeds(cap, depthChart, health) {
  const seen = new Map();
  const addPlayer = (name, position, status = 'Active') => {
    const cleanName = String(name || '').trim();
    if (!cleanName || cleanName.length < 3) return;
    const key = cleanName.toLowerCase();
    if (!seen.has(key)) {
      seen.set(key, { name: cleanName, position: String(position || ''), status });
    }
  };
  for (const p of Array.isArray(cap?.players) ? cap.players : []) {
    addPlayer(p?.name, p?.position, p?.status || 'Active');
  }
  for (const unit of Array.isArray(depthChart?.units) ? depthChart.units : []) {
    for (const grp of Array.isArray(unit?.groups) ? unit.groups : []) {
      for (const p of Array.isArray(grp?.players) ? grp.players : []) {
        addPlayer(p?.name, p?.position || grp?.position, p?.status || 'Active');
      }
    }
  }
  for (const p of Array.isArray(health?.practiceReport) ? health.practiceReport : []) {
    addPlayer(p?.name, p?.position, p?.rosterBucket === 'ir' ? 'IR' : 'Active');
  }
  return { players: [...seen.values()] };
}

async function fetchJsonSafeEdge(url, timeoutMs = 6000) {
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': '49ersFaithfulEdge/2.0', Accept: 'application/json' },
      signal: AbortSignal.timeout(timeoutMs)
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

/**
 * Proactively checks whether the active Daily Top-News Brief cycle (5:00 PM PT on non-game days;
 * variable post-game completion + podium buffer on game days) is due and synthesizes/caches it
 * in Shared Cloudflare KV (`daily_news_brief_v5:<cycleKey>-v5`) with 0 credits spent on cache hits.
 */
export async function runScheduledDailyNewsBrief(
  env,
  { nowMs = Date.now(), cron = '', force = false } = {}
) {
  const newsKey = env?.GEMINI_NEWS_API_KEY || env?.GEMINI_API_KEY;
  if (!newsKey) {
    return { ok: false, skipped: true, reason: 'no_gemini_api_key' };
  }
  if (!env?.SHARED_CACHE) {
    return { ok: false, skipped: true, reason: 'no_shared_cache' };
  }

  const siteOrigin = String(env.DATA_SITE_ORIGIN || env.ALLOWED_ORIGIN || 'https://49ers.joshal.com')
    .trim()
    .replace(/\/+$/, '');

  // 1. Lightweight schedule + live ESPN status check (2 subrequests) before doing any heavy work
  const [scheduleMatchup, espnScheduleJson] = await Promise.all([
    fetchJsonSafeEdge(`${siteOrigin}/data/schedule-matchup.json`, 6000),
    fetchJsonSafeEdge('https://site.api.espn.com/apis/site/v2/sports/football/nfl/teams/sf/schedule', 5000)
  ]);

  if (!scheduleMatchup) {
    return { ok: false, skipped: true, reason: 'schedule_fetch_failed' };
  }

  await overlayLiveEspnScheduleForBrief(scheduleMatchup, null, espnScheduleJson, { nowMs, env });

  const preCycleState = resolveNewsBriefCycleState(
    nowMs,
    { scheduleMatchup, news: { rawStream: [] } },
    DAILY_NEWS_BRIEF_PEAK_HOUR_PT
  );
  if (preCycleState.isGameDayHold && !force) {
    return {
      ok: true,
      skipped: true,
      reason: 'gameday_hold',
      cycleKey: preCycleState.activeCycleKey,
      cron
    };
  }

  const preCycleKey = preCycleState.activeCycleKey;
  const preWorkerCycleKey = `${preCycleKey}-v5`;
  const preCacheKey = `daily_news_brief_v5:${preWorkerCycleKey}`;

  // 2. Fast-exit on KV cache hit (0 Gemini credits spent!) unless stale relative to live health/game state
  let prefetchedHealth = null;
  if (!force) {
    const existing = await env.SHARED_CACHE.get(preCacheKey, 'json');
    if (existing && (existing.data || existing.rawText)) {
      prefetchedHealth = await fetchJsonSafeEdge(`${siteOrigin}/data/health.json`, 5000);
      const existingBriefObj = existing.data || null;
      const stale = existingBriefObj
        ? isDailyBriefStaleForLiveState(existingBriefObj, { scheduleMatchup, health: prefetchedHealth }, nowMs)
        : false;
      if (!stale) {
        return {
          ok: true,
          skipped: true,
          reason: 'already_cached',
          cycleKey: preCycleKey,
          generatedAt: existing.generatedAt || null,
          cron
        };
      }
    }
  }

  // 3. Distributed KV lock prevents concurrent double-spend if a browser POST lands at the exact same second
  const lockKey = `daily_news_brief_lock:${preWorkerCycleKey}`;
  if (!force) {
    const existingLock = await env.SHARED_CACHE.get(lockKey);
    if (existingLock) {
      return { ok: true, skipped: true, reason: 'in_flight_lock', cycleKey: preCycleKey, cron };
    }
  }
  await env.SHARED_CACHE.put(lockKey, new Date(nowMs).toISOString(), { expirationTtl: 120 });

  try {
    // 4. Hydrate remaining lightweight canonical data + fresh ESPN/RSS wire (stays well under 50 subrequests)
    const [meta, news, healthFresh, cap, depthChart, seasonal, espnNewsJson, edgeWire] = await Promise.all([
      fetchJsonSafeEdge(`${siteOrigin}/data/meta.json`, 5500),
      fetchJsonSafeEdge(`${siteOrigin}/data/news.json`, 6500),
      prefetchedHealth ? Promise.resolve(prefetchedHealth) : fetchJsonSafeEdge(`${siteOrigin}/data/health.json`, 5500),
      fetchJsonSafeEdge(`${siteOrigin}/data/cap.json`, 6000),
      fetchJsonSafeEdge(`${siteOrigin}/data/depth-chart.json`, 5500),
      fetchJsonSafeEdge(`${siteOrigin}/data/seasonal.json`, 6000),
      fetchJsonSafeEdge('https://site.api.espn.com/apis/site/v2/sports/football/nfl/news?team=25&limit=25', 5000),
      collectEdgeLiveWire(env, { maxXHydrate: 4, includeYouTube: false, useCache: true, writeCache: false }).catch(
        () => ({ items: [] })
      )
    ]);

    const appMeta = meta && typeof meta === 'object' ? meta : { seasonYear: 2026, teamRecord: '' };
    await overlayLiveEspnScheduleForBrief(scheduleMatchup, appMeta, espnScheduleJson, { nowMs, env });

    const baseStream = Array.isArray(news?.rawStream) ? [...news.rawStream] : [];
    const seenUrls = new Set(
      baseStream.map(it => String(it?.url || '').trim().toLowerCase()).filter(Boolean)
    );
    const pushFreshItem = it => {
      const u = String(it?.url || '').trim();
      const key = u.toLowerCase();
      if (!u || !it?.title || seenUrls.has(key)) return;
      seenUrls.add(key);
      baseStream.unshift(it);
    };

    for (const art of Array.isArray(espnNewsJson?.articles) ? espnNewsJson.articles : []) {
      const link = art?.links?.web?.href || art?.links?.mobile?.href || '';
      if (!link || !art?.headline) continue;
      pushFreshItem({
        id: `espn_cron_${art.id || art.dataSourceIdentifier || Math.random().toString(36).slice(2, 8)}`,
        type: 'article',
        title: String(art.headline).trim(),
        summary: String(art.description || '').trim().slice(0, 260),
        url: link.replace(/^http:\/\//i, 'https://'),
        author: art.byline || 'ESPN',
        outletId: 'espn',
        outletName: 'ESPN',
        publishedAt: art.published || art.lastModified || new Date(nowMs).toISOString()
      });
    }
    for (const wireIt of Array.isArray(edgeWire?.items) ? edgeWire.items : []) {
      pushFreshItem(wireIt);
    }

    const appData = {
      meta: appMeta,
      scheduleMatchup,
      health: healthFresh || { practiceReport: [], irAndReserveTracker: [] },
      cap: cap || { years: {}, players: [] },
      depthChart: depthChart || { units: [] },
      seasonal: seasonal || {},
      roster: buildLightweightRosterFromFeeds(cap, depthChart, healthFresh),
      news: {
        ...(news || {}),
        rawStream: baseStream
      }
    };

    // Re-evaluate cycle state & post-game hydration readiness with live wire merged
    const cycleState = resolveNewsBriefCycleState(nowMs, appData, DAILY_NEWS_BRIEF_PEAK_HOUR_PT);
    if (cycleState.isGameDayHold && !force) {
      return { ok: true, skipped: true, reason: 'gameday_hold', cycleKey: cycleState.activeCycleKey, cron };
    }
    if (isAppDataAwaitingLivePostGameHydration(appData, nowMs) && !force) {
      return {
        ok: true,
        skipped: true,
        reason: 'awaiting_postgame_hydration',
        cycleKey: cycleState.activeCycleKey,
        cron
      };
    }

    const activeCycle = cycleState.activeCycleKey;
    const workerCycleKey = `${activeCycle}-v5`;
    const cacheKey = `daily_news_brief_v5:${workerCycleKey}`;

    if (cacheKey !== preCacheKey && !force) {
      const existingAlt = await env.SHARED_CACHE.get(cacheKey, 'json');
      if (
        existingAlt &&
        (existingAlt.data || existingAlt.rawText) &&
        !(existingAlt.data && isDailyBriefStaleForLiveState(existingAlt.data, appData, nowMs))
      ) {
        return {
          ok: true,
          skipped: true,
          reason: 'already_cached',
          cycleKey: activeCycle,
          generatedAt: existingAlt.generatedAt || null,
          cron
        };
      }
    }

    const sourceCandidates = selectTopNewsBriefSourceCandidates(appData, 18, nowMs);
    if (sourceCandidates.length === 0) {
      return { ok: false, skipped: true, reason: 'no_source_candidates', cycleKey: activeCycle, cron };
    }

    const prevBrief =
      news?.dailyTopNewsBrief && news.dailyTopNewsBrief.cycleKey !== activeCycle
        ? news.dailyTopNewsBrief
        : null;
    const promptText = buildDailyTopNewsBriefPrompt(appData, sourceCandidates, nowMs, {
      previousBrief: prevBrief
    });
    const effectiveSystem = `${EDITORIAL_SYSTEM_PROMPT}\n\n${buildLiveGroundingSystemPrompt(appData)}`;

    const thinkingBudget = Number(env.GEMINI_THINKING_BUDGET || HIGH_THINKING_BUDGET);
    const scopedEnv = {
      ...env,
      GEMINI_API_KEY: newsKey,
      GEMINI_DEFAULT_FREE_MODEL: PRIMARY_GEMINI_REASONING_MODEL
    };
    const {
      res: geminiRes,
      modelUsed,
      thinkingLevelUsed
    } = await callGeminiTextWithFallback(
      scopedEnv,
      {
        systemInstruction: { parts: [{ text: effectiveSystem }] },
        tools: [{ google_search: {} }],
        generationConfig: {
          temperature: 0.16,
          thinkingConfig: { thinkingBudget }
        },
        contents: [{ role: 'user', parts: [{ text: String(promptText).slice(0, 24000) }] }]
      },
      { preferredThinkingLevel: 'XHIGH' }
    );

    if (!geminiRes || !geminiRes.ok) {
      return {
        ok: false,
        skipped: false,
        reason: 'gemini_api_error',
        status: geminiRes?.status || 0,
        cycleKey: activeCycle,
        cron
      };
    }

    const rawJson = await geminiRes.json();
    const rawText = scrubStaleWeightHallucinations(extractNonThoughtText(rawJson), String(promptText));
    const resolvedModel = modelUsed || PRIMARY_GEMINI_REASONING_MODEL;
    const generatedAt = new Date(nowMs).toISOString();

    const normalized = parseAndSanitizeDailyTopNewsBrief(rawText, sourceCandidates, appData, {
      cycleKey: activeCycle,
      isPostGame: cycleState.isPostGameCycle,
      gameWeek: cycleState.targetGame ? Number(cycleState.targetGame.week) : Number(appMeta.currentWeek) || null,
      generatedAt,
      modelUsed: resolvedModel,
      source: 'live-gemini-daily'
    });

    if (!normalized) {
      return { ok: false, skipped: false, reason: 'invalid_gemini_payload', cycleKey: activeCycle, cron };
    }

    const payloadOut = {
      cycleKey: workerCycleKey,
      modelUsed: resolvedModel,
      thinkingLevel: thinkingLevelUsed || resolveGeminiThinkingLevelLabel(resolvedModel, 'XHIGH'),
      generatedAt,
      rawText,
      data: normalized,
      scheduled: true
    };

    await env.SHARED_CACHE.put(cacheKey, JSON.stringify(payloadOut), {
      expirationTtl: 60 * 60 * 26
    });

    return {
      ok: true,
      generated: true,
      cycleKey: activeCycle,
      modelUsed: resolvedModel,
      generatedAt,
      wordCount: normalized.wordCount,
      cron
    };
  } finally {
    if (typeof env.SHARED_CACHE.delete === 'function') {
      await env.SHARED_CACHE.delete(lockKey).catch(() => {});
    }
  }
}

export default {
  async scheduled(event, env, ctx) {
    const cron = String(event?.cron || '');
    const nowMs = Number.isFinite(event?.scheduledTime) ? event.scheduledTime : Date.now();
    const runTasks = async () => {
      const shouldPollModels =
        !cron ||
        cron === '15 */6 * * *' ||
        !(await env.SHARED_CACHE?.get('meta:best_free_model'));
      if (shouldPollModels) {
        await pollAndCacheBestFreeModel(env).catch(() => {});
      }
      await runScheduledDailyNewsBrief(env, { nowMs, cron }).catch(() => {});
    };
    const task = runTasks();
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

    // Public audio stream route (supports iOS Safari HTTP Range 206 Partial Content + HEAD)
    if ((request.method === 'GET' || request.method === 'HEAD') && url.pathname.startsWith('/api/audio/')) {
      const episodeId = url.pathname.replace('/api/audio/', '').replace(/[^a-zA-Z0-9_-]/g, '');
      if (!env.PODCAST_BUCKET) {
        return jsonResponse({ error: 'R2 bucket not bound' }, 501, cors);
      }
      const r2Key = `episodes/${episodeId}.wav`;
      const rangeHeader = request.method === 'GET' ? request.headers.get('Range') || '' : '';
      const rangeMatch = rangeHeader.match(/^bytes=(\d*)-(\d*)$/i);

      if (request.method === 'HEAD') {
        const metaObj =
          typeof env.PODCAST_BUCKET.head === 'function'
            ? await env.PODCAST_BUCKET.head(r2Key)
            : await env.PODCAST_BUCKET.get(r2Key);
        if (!metaObj) {
          return jsonResponse({ error: 'Episode audio not found' }, 404, cors);
        }
        const totalSize = Number(metaObj.size ?? metaObj.body?.byteLength ?? 0);
        const headHeaders = {
          ...cors,
          'Content-Type': metaObj.httpMetadata?.contentType || 'audio/wav',
          'Accept-Ranges': 'bytes',
          'Cache-Control': 'public, max-age=31536000, immutable'
        };
        if (totalSize > 0) headHeaders['Content-Length'] = String(totalSize);
        return new Response(null, { status: 200, headers: headHeaders });
      }

      if (rangeMatch) {
        const metaForRange =
          typeof env.PODCAST_BUCKET.head === 'function' ? await env.PODCAST_BUCKET.head(r2Key) : null;
        if (typeof env.PODCAST_BUCKET.head === 'function' && !metaForRange) {
          return jsonResponse({ error: 'Episode audio not found' }, 404, cors);
        }
        const rawStart = rangeMatch[1] !== '' ? Number(rangeMatch[1]) : null;
        const rawEnd = rangeMatch[2] !== '' ? Number(rangeMatch[2]) : null;

        let r2RangeOpt = undefined;
        if (rawStart !== null && rawEnd !== null && rawEnd >= rawStart) {
          r2RangeOpt = { offset: rawStart, length: rawEnd - rawStart + 1 };
        } else if (rawStart !== null && rawEnd === null) {
          r2RangeOpt = { offset: rawStart };
        } else if (rawStart === null && rawEnd !== null && rawEnd > 0) {
          r2RangeOpt = { suffix: rawEnd };
        }

        const obj = await env.PODCAST_BUCKET.get(r2Key, r2RangeOpt ? { range: r2RangeOpt } : undefined);
        if (!obj) {
          return jsonResponse({ error: 'Episode audio not found' }, 404, cors);
        }
        const totalSize = Number(obj.size ?? metaForRange?.size ?? obj.body?.byteLength ?? 0);
        if (totalSize > 0) {
          let start = rawStart !== null ? rawStart : Math.max(0, totalSize - (rawEnd || totalSize));
          let end = rawStart !== null && rawEnd !== null ? Math.min(rawEnd, totalSize - 1) : totalSize - 1;
          if (start < 0 || start >= totalSize || end < start) {
            return new Response(null, {
              status: 416,
              headers: {
                ...cors,
                'Content-Range': `bytes */${totalSize}`
              }
            });
          }
          const expectedLen = end - start + 1;
          let responseBody = obj.body;
          // If in-memory mock returned full un-sliced buffer without `obj.range`, slice cleanly to `[start, end + 1)`
          if (!obj.range && (obj.body instanceof Uint8Array || obj.body instanceof ArrayBuffer)) {
            const fullView = obj.body instanceof Uint8Array ? obj.body : new Uint8Array(obj.body);
            if (fullView.byteLength === totalSize && expectedLen < totalSize) {
              responseBody = fullView.subarray(start, end + 1);
            }
          }
          return new Response(responseBody, {
            status: 206,
            headers: {
              ...cors,
              'Content-Type': obj.httpMetadata?.contentType || 'audio/wav',
              'Accept-Ranges': 'bytes',
              'Content-Range': `bytes ${start}-${end}/${totalSize}`,
              'Content-Length': String(expectedLen),
              'Cache-Control': 'public, max-age=31536000, immutable'
            }
          });
        }
      }

      const obj = await env.PODCAST_BUCKET.get(r2Key);
      if (!obj) {
        return jsonResponse({ error: 'Episode audio not found' }, 404, cors);
      }
      const fullSize = Number(obj.size ?? obj.body?.byteLength ?? 0);
      const fullHeaders = {
        ...cors,
        'Content-Type': obj.httpMetadata?.contentType || 'audio/wav',
        'Accept-Ranges': 'bytes',
        'Cache-Control': 'public, max-age=31536000, immutable'
      };
      if (fullSize > 0) fullHeaders['Content-Length'] = String(fullSize);
      return new Response(obj.body, {
        status: 200,
        headers: fullHeaders
      });
    }

    // Referer-free Edge Range relay for inline X (`video.twimg.com`) & ESPN MP4 highlight clips
    if ((request.method === 'GET' || request.method === 'HEAD') && url.pathname === '/api/video-stream') {
      const targetRaw = String(url.searchParams.get('url') || '').trim();
      if (!isAllowedInlineVideoStreamUrl(targetRaw)) {
        return jsonResponse({ error: 'Disallowed or invalid video stream URL' }, 400, cors);
      }
      const upstreamHeaders = { Accept: 'video/mp4,video/*;q=0.9,*/*;q=0.5' };
      const reqRange = request.headers.get('Range');
      if (reqRange) {
        upstreamHeaders.Range = reqRange;
      }
      try {
        const upstreamRes = await fetch(targetRaw, {
          method: request.method,
          headers: upstreamHeaders,
          redirect: 'follow',
          signal: AbortSignal.timeout(10000)
        });
        if (upstreamRes.url && !isAllowedInlineVideoStreamUrl(upstreamRes.url)) {
          return jsonResponse({ error: 'Disallowed redirect target on video stream' }, 403, cors);
        }
        const respHeaders = new Headers(cors);
        respHeaders.set('Content-Type', upstreamRes.headers.get('Content-Type') || 'video/mp4');
        respHeaders.set('Accept-Ranges', upstreamRes.headers.get('Accept-Ranges') || 'bytes');
        respHeaders.set('Cross-Origin-Resource-Policy', 'cross-origin');
        respHeaders.set('Cache-Control', 'public, max-age=86400');
        const cLen = upstreamRes.headers.get('Content-Length');
        if (cLen) respHeaders.set('Content-Length', cLen);
        const cRange = upstreamRes.headers.get('Content-Range');
        if (cRange) respHeaders.set('Content-Range', cRange);
        return new Response(request.method === 'HEAD' ? null : upstreamRes.body, {
          status: upstreamRes.status,
          headers: respHeaders
        });
      } catch {
        return jsonResponse({ error: 'Upstream video stream unreachable' }, 502, cors);
      }
    }

    if (request.method === 'GET' && url.pathname === '/api/health') {
      const defaultFreeModel = env.GEMINI_DEFAULT_FREE_MODEL || DEFAULT_FREE_MODEL_CASCADE[0];
      return jsonResponse(
        {
          ok: true,
          service: '49ers-worker',
          defaultFreeModel,
          defaultAudioModel: DEFAULT_AUDIO_TTS_CASCADE[0],
          thinkingLevel: resolveGeminiThinkingLevelLabel(defaultFreeModel),
          liveInteractiveThinkingLevel: LIVE_INTERACTIVE_GEMINI_THINKING_LEVEL,
          thinkingBudget: HIGH_THINKING_BUDGET,
          qualityPriority: 'accuracy_over_latency'
        },
        200,
        cors
      );
    }

    if (request.method === 'POST' && url.pathname === '/api/expand-urls') {
      let body = null;
      try {
        body = await request.json();
      } catch {
        return jsonResponse({ error: 'Invalid JSON body' }, 400, cors);
      }
      const inputUrls = Array.isArray(body?.urls) ? body.urls.slice(0, 12) : [];
      const expanded = {};
      await Promise.all(
        inputUrls.map(async rawU => {
          const key = String(rawU || '').trim();
          if (!key) return;
          const dest = await expandAllowedShortenerUrlEdge(env, key);
          if (dest) expanded[key] = dest;
        })
      );
      return jsonResponse({ expanded }, 200, cors);
    }

    if (request.method === 'GET' && url.pathname === '/api/live-wire') {
      const wirePayload = await collectEdgeLiveWire(env, {
        maxXHydrate: 14,
        includeYouTube: true,
        useCache: true,
        writeCache: true
      });
      return jsonResponse(wirePayload, 200, cors);
    }

    if (request.method === 'GET' && url.pathname === '/api/gameday-inactives') {
      const teamsParam = String(url.searchParams.get('teams') || 'SF').toUpperCase();
      const teams = [...new Set(teamsParam.split(',').map(t => normalizeCanonicalTeamAbbr(t)).filter(Boolean))].slice(0, 4);
      const seasonYear = Number(url.searchParams.get('seasonYear') || 2026);
      const week = Number(url.searchParams.get('week') || 0) || null;
      const oppName = String(url.searchParams.get('oppName') || '').slice(0, 48);
      const gameId = String(url.searchParams.get('gameId') || '').trim();
      const kickoffMsParam = Number(url.searchParams.get('kickoffMs') || 0) || 0;
      const allowAiFallback = url.searchParams.get('aiFallback') === '1';
      const oppAbbr = teams.find(t => t !== 'SF') || '';

      const kvKey = `gameday_inact_v2:${seasonYear}:wk${week || 'cur'}:${teams.join('-')}`;
      const cachedInact = await env.SHARED_CACHE?.get(kvKey, 'json');
      if (
        cachedInact &&
        cachedInact.sf?.inactives?.length >= 3 &&
        (!oppAbbr || cachedInact.opp?.inactives?.length >= 3)
      ) {
        return jsonResponse({ cached: true, ...cachedInact }, 200, cors);
      }

      const [rwHtml, ...clubRssXmls] = await Promise.all([
        fetch('https://www.rotowire.com/football/inactives.php', {
          headers: { 'User-Agent': 'Mozilla/5.0 (compatible; 49ersFaithfulEdge/1.0)' },
          signal: AbortSignal.timeout(5000)
        })
          .then(r => (r.ok ? r.text() : ''))
          .catch(() => ''),
        ...teams.map(abbr => {
          const rssUrl = NFL_TEAM_OFFICIAL_RSS_URLS[abbr];
          if (!rssUrl) return Promise.resolve('');
          return fetch(rssUrl, {
            headers: { 'User-Agent': '49ersFaithfulEdge/1.0' },
            signal: AbortSignal.timeout(5000)
          })
            .then(r => (r.ok ? r.text() : ''))
            .catch(() => '');
        })
      ]);

      const rwByTeam = parseRotoWireInactivesHtml(rwHtml, teams);
      const discoveredByTeam = {};
      const sourceUrlByTeam = {};
      teams.forEach((abbr, idx) => {
        const discovered = discoverOfficialClubInactivesRssItem(clubRssXmls[idx] || '', {
          kickoffMs: kickoffMsParam,
          week
        });
        if (discovered?.url) {
          discoveredByTeam[abbr] = discovered;
          sourceUrlByTeam[abbr] = discovered.url;
        }
      });

      // Server-side (zero-CORS) fetch & parse of discovered official club inactives articles (`49ers.com` + opponent `<club>.com`)
      const clubParsedByTeam = {};
      await Promise.all(
        teams.map(async abbr => {
          const disc = discoveredByTeam[abbr];
          if (!disc?.url) return;
          let artHtml = '';
          try {
            const artRes = await fetch(disc.url, {
              headers: { 'User-Agent': 'Mozilla/5.0 (compatible; 49ersFaithfulEdge/1.0)' },
              signal: AbortSignal.timeout(5500)
            });
            if (artRes.ok) artHtml = await artRes.text();
          } catch {}
          const parseSource = artHtml || disc.inlineHtml || disc.description || '';
          if (!parseSource) return;
          const parsed = parseOfficialClubInactivesArticle(parseSource, [], {
            week,
            teamAbbr: abbr,
            teamName: abbr === 'SF' ? 'San Francisco 49ers' : abbr === oppAbbr ? oppName : ''
          });
          if (parsed.officialPosted) {
            clubParsedByTeam[abbr] = parsed;
          }
        })
      );

      let sfList = [];
      let sfEmergencyQbNames = [];
      let sfSourceRank = 0;
      let sfSourceLabel = 'RotoWire NFL Inactives';
      if (clubParsedByTeam.SF?.inactives?.length >= 3) {
        sfList = clubParsedByTeam.SF.inactives;
        sfEmergencyQbNames = clubParsedByTeam.SF.inactives
          .filter(p => clubParsedByTeam.SF.emergencyQbKeys?.has(String(p.name || '').toLowerCase().replace(/[^a-z0-9]/g, '')))
          .map(p => p.name);
        sfSourceRank = 4;
        sfSourceLabel = '49ers.com Official';
      } else if ((rwByTeam.SF || []).length >= 3) {
        sfList = rwByTeam.SF;
        sfSourceRank = 3;
        sfSourceLabel = sourceUrlByTeam.SF ? '49ers.com Official' : 'RotoWire NFL Inactives';
      }

      let oppList = [];
      let oppEmergencyQbNames = [];
      let oppSourceRank = 0;
      let oppSourceLabel = 'RotoWire NFL Inactives';
      if (oppAbbr) {
        if (clubParsedByTeam[oppAbbr]?.inactives?.length >= 3) {
          oppList = clubParsedByTeam[oppAbbr].inactives;
          oppEmergencyQbNames = clubParsedByTeam[oppAbbr].inactives
            .filter(p =>
              clubParsedByTeam[oppAbbr].emergencyQbKeys?.has(String(p.name || '').toLowerCase().replace(/[^a-z0-9]/g, ''))
            )
            .map(p => p.name);
          oppSourceRank = 4;
          oppSourceLabel = `${oppAbbr} Official`;
        } else if ((rwByTeam[oppAbbr] || []).length >= 3) {
          oppList = rwByTeam[oppAbbr];
          oppSourceRank = 3;
          oppSourceLabel = sourceUrlByTeam[oppAbbr] ? `${oppAbbr} Official` : 'RotoWire NFL Inactives';
        }
      }

      // ESPN Core Event Competitor Roster fallback if gameId is known and club/RotoWire haven't posted yet
      if (/^\d{6,12}$/.test(gameId) && (sfList.length < 3 || (oppAbbr && oppList.length < 3))) {
        const espnTargets = [];
        if (sfList.length < 3) espnTargets.push('SF');
        if (oppAbbr && oppList.length < 3) espnTargets.push(oppAbbr);
        await Promise.all(
          espnTargets.map(async abbr => {
            const tid = ESPN_NFL_TEAM_IDS[abbr];
            if (!tid) return;
            try {
              const eUrl = `https://sports.core.api.espn.com/v2/sports/football/leagues/nfl/events/${encodeURIComponent(gameId)}/competitions/${encodeURIComponent(gameId)}/competitors/${tid}/roster`;
              const eRes = await fetch(eUrl, {
                headers: { 'User-Agent': '49ersFaithfulEdge/1.0' },
                signal: AbortSignal.timeout(5000)
              });
              if (!eRes.ok) return;
              const eJson = await eRes.json();
              const parsed = parseEspnCoreEventRosterInactives(eJson, []);
              if (parsed.officialPosted) {
                if (abbr === 'SF' && sfList.length < 3) {
                  sfList = parsed.inactives;
                  sfSourceRank = 3;
                  sfSourceLabel = 'ESPN Official Game Roster';
                } else if (abbr === oppAbbr && oppList.length < 3) {
                  oppList = parsed.inactives;
                  oppSourceRank = 3;
                  oppSourceLabel = 'ESPN Official Game Roster';
                }
              }
            } catch {}
          })
        );
      }

      let modelUsed = null;

      // Top-Tier-Minus-1 Free Flash Fallback (`gemini-3.8-flash` today, auto-incrementing via `/v1beta/models`)
      if (
        allowAiFallback &&
        (sfList.length < 3 || (oppAbbr && oppList.length < 3)) &&
        (env.GEMINI_NEWS_API_KEY || env.GEMINI_API_KEY)
      ) {
        const cooldownKey = `${kvKey}:ai_cooldown`;
        const recentAttempt = await env.SHARED_CACHE?.get(cooldownKey);
        if (!recentAttempt) {
          if (env.SHARED_CACHE) {
            await env.SHARED_CACHE.put(cooldownKey, '1', { expirationTtl: 300 });
          }
          const modelState =
            (await env.SHARED_CACHE?.get('meta:best_free_model', 'json')) ||
            (await pollAndCacheBestFreeModel(env));
          const minusOneCascade = rankSecondTierGeminiFlashModels(modelState?.rankedCascade || DEFAULT_FREE_MODEL_CASCADE);
          const targetModel = minusOneCascade[0] || 'gemini-3.8-flash';
          const apiKey = env.GEMINI_NEWS_API_KEY || env.GEMINI_API_KEY;
          const thinkCfg = buildGeminiThinkingConfig(targetModel, null, { preferredThinkingLevel: 'LOW' });
          const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${targetModel}:generateContent?key=${apiKey}`;

          try {
            const gRes = await fetch(geminiUrl, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              signal: AbortSignal.timeout(12000),
              body: JSON.stringify({
                systemInstruction: {
                  parts: [
                    {
                      text: 'Extract verified official 90-minute NFL game-day INACTIVES using Google Search. Return STRICT JSON only with zero markdown.'
                    }
                  ]
                },
                tools: [{ google_search: {} }],
                generationConfig: { temperature: 0.05, thinkingConfig: thinkCfg },
                contents: [
                  {
                    role: 'user',
                    parts: [
                      {
                        text: `Find official ${seasonYear} NFL Week ${week || ''} game-day inactives for San Francisco 49ers vs ${oppName || oppAbbr}. Return JSON: {"sf":[{"name":"Full Name","position":"POS","reason":""}],"opp":[{"name":"Full Name","position":"POS","reason":""}]}`
                      }
                    ]
                  }
                ]
              })
            });
            if (gRes.ok) {
              const gJson = await gRes.json();
              const rawTxt = extractNonThoughtText(gJson);
              const jm = rawTxt.match(/\{[\s\S]*\}/);
              if (jm) {
                const parsed = JSON.parse(jm[0]);
                if (sfList.length < 3 && Array.isArray(parsed.sf) && parsed.sf.length >= 3) {
                  sfList = parsed.sf;
                  sfSourceRank = 1;
                  sfSourceLabel = 'Grounded NFL Wire';
                }
                if (oppAbbr && oppList.length < 3 && Array.isArray(parsed.opp) && parsed.opp.length >= 3) {
                  oppList = parsed.opp;
                  oppSourceRank = 1;
                  oppSourceLabel = 'Grounded NFL Wire';
                }
                modelUsed = targetModel;
              }
            }
          } catch {}
        }
      }

      const outPayload = {
        updatedAt: new Date().toISOString(),
        seasonYear,
        week,
        modelUsed,
        sf: {
          officialPosted: sfList.length >= 3,
          sourceRank: sfSourceRank,
          inactives: sfList,
          emergencyQbNames: sfEmergencyQbNames,
          sourceUrl: sourceUrlByTeam.SF || 'https://www.rotowire.com/football/inactives.php',
          sourceLabel: sfSourceLabel
        },
        opp: oppAbbr
          ? {
              teamAbbr: oppAbbr,
              officialPosted: oppList.length >= 3,
              sourceRank: oppSourceRank,
              inactives: oppList,
              emergencyQbNames: oppEmergencyQbNames,
              sourceUrl: sourceUrlByTeam[oppAbbr] || 'https://www.rotowire.com/football/inactives.php',
              sourceLabel: oppSourceLabel
            }
          : null
      };

      if (env.SHARED_CACHE && (sfList.length >= 3 || oppList.length >= 3)) {
        const allResolved = sfList.length >= 3 && (!oppAbbr || oppList.length >= 3);
        await env.SHARED_CACHE.put(kvKey, JSON.stringify(outPayload), {
          expirationTtl: allResolved ? 6 * 3600 : 45
        });
      }
      return jsonResponse({ cached: false, ...outPayload }, 200, cors);
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

    // Quiet Opt-In Web Push Alerts (Zero Clickbait, Zero Score Spam)
    if (request.method === 'GET' && url.pathname === '/api/push-config') {
      const vapidPublicKey = String(env.VAPID_PUBLIC_KEY || '').trim();
      return jsonResponse(
        {
          supported: Boolean(vapidPublicKey),
          vapidPublicKey: vapidPublicKey || null,
          channels: ['tier1Breaking', 'dailyBriefReady', 'practiceDowngrades']
        },
        200,
        cors
      );
    }

    if (request.method === 'POST' && url.pathname === '/api/push-subscribe') {
      const body = await parseJsonBodySafe(request);
      const endpoint = String(body?.subscription?.endpoint || '').trim();
      if (!endpoint || !/^https:\/\//i.test(endpoint)) {
        return jsonResponse({ error: 'Valid HTTPS push subscription endpoint required' }, 400, cors);
      }
      const channels = {
        tier1Breaking: body?.channels?.tier1Breaking !== false,
        dailyBriefReady: body?.channels?.dailyBriefReady !== false,
        practiceDowngrades: Boolean(body?.channels?.practiceDowngrades)
      };
      const subHash = await hashKey(endpoint);
      const record = {
        id: subHash,
        endpoint,
        keys: body?.subscription?.keys || {},
        channels,
        author: String(body?.author || 'Faithful').slice(0, 40),
        updatedAt: new Date().toISOString()
      };
      if (env.SHARED_CACHE) {
        await env.SHARED_CACHE.put(`push:sub:${subHash}`, JSON.stringify(record), {
          expirationTtl: 60 * 60 * 24 * 90
        });
        const idx = (await env.SHARED_CACHE.get('index:push_subs', 'json')) || [];
        const nextIdx = [subHash, ...idx.filter(x => x !== subHash)].slice(0, 100);
        await env.SHARED_CACHE.put('index:push_subs', JSON.stringify(nextIdx));
      }
      return jsonResponse({ subscribed: true, id: subHash, channels }, 200, cors);
    }

    if (request.method === 'POST' && url.pathname === '/api/push-unsubscribe') {
      const body = await parseJsonBodySafe(request);
      const endpoint = String(body?.endpoint || body?.subscription?.endpoint || '').trim();
      if (endpoint && env.SHARED_CACHE) {
        const subHash = await hashKey(endpoint);
        await env.SHARED_CACHE.delete(`push:sub:${subHash}`);
        const idx = (await env.SHARED_CACHE.get('index:push_subs', 'json')) || [];
        await env.SHARED_CACHE.put(
          'index:push_subs',
          JSON.stringify(idx.filter(x => x !== subHash))
        );
      }
      return jsonResponse({ subscribed: false }, 200, cors);
    }

    if (request.method === 'POST' && url.pathname === '/api/matchup-intel') {
      const body = await parseJsonBodySafe(request);
      if (!body || !body.prompt) {
        return jsonResponse({ error: 'Invalid matchup intel request' }, 400, cors);
      }
      const seasonYear = Number(body.seasonYear || 2026);
      const week = Number(body.week || 1);
      const oppAbbr = String(body.oppAbbr || 'OPP').replace(/[^A-Za-z0-9]/g, '').toUpperCase();
      const datePt = String(body.datePt || new Date().toISOString().slice(0, 10)).replace(/[^0-9-]/g, '');
      const cacheKey = `matchup_intel_v3:${seasonYear}:wk${week}:${oppAbbr}:${datePt}`;

      const existing = await env.SHARED_CACHE?.get(cacheKey, 'json');
      if (existing && !body.forceRefresh) {
        return jsonResponse({ cached: true, ...existing }, 200, cors);
      }

      if (!env.GEMINI_API_KEY) {
        return jsonResponse({ error: 'GEMINI_API_KEY secret is not configured on this Worker.' }, 503, cors);
      }

      const thinkingBudget = Number(env.GEMINI_THINKING_BUDGET || HIGH_THINKING_BUDGET);
      const clientSystem = String(body.systemPrompt || '').slice(0, 8000);
      const effectiveSystem = clientSystem
        ? `${EDITORIAL_SYSTEM_PROMPT}\n\n${clientSystem}`
        : EDITORIAL_SYSTEM_PROMPT;

      const { res: geminiRes, modelUsed } = await callGeminiTextWithFallback(
        env,
        {
          systemInstruction: { parts: [{ text: effectiveSystem }] },
          tools: [{ google_search: {} }],
          generationConfig: {
            temperature: 0.18,
            thinkingConfig: { thinkingBudget }
          },
          contents: [{ role: 'user', parts: [{ text: String(body.prompt).slice(0, 24000) }] }]
        },
        { preferredThinkingLevel: 'XHIGH' }
      );

      if (!geminiRes || !geminiRes.ok) {
        const errText = geminiRes ? await geminiRes.text() : 'No response';
        return jsonResponse({ error: `Gemini API error: ${errText.slice(0, 240)}` }, 502, cors);
      }

      const rawJson = await geminiRes.json();
      const rawText = scrubStaleWeightHallucinations(extractNonThoughtText(rawJson), String(body.prompt));
      const payloadOut = {
        datePt,
        seasonYear,
        week,
        oppAbbr,
        modelUsed,
        generatedAt: new Date().toISOString(),
        rawText
      };

      if (env.SHARED_CACHE && rawText) {
        await env.SHARED_CACHE.put(cacheKey, JSON.stringify(payloadOut), {
          expirationTtl: 60 * 60 * 26
        });
      }
      return jsonResponse({ cached: false, ...payloadOut }, 200, cors);
    }

    if (request.method === 'GET' && url.pathname === '/api/daily-news-brief') {
      const cycleKey = String(
        url.searchParams.get('cycleKey') || new Date().toISOString().slice(0, 10)
      ).replace(/[^A-Za-z0-9@_-]/g, '');
      const cacheKey = `daily_news_brief_v5:${cycleKey}`;
      const existing = await env.SHARED_CACHE?.get(cacheKey, 'json');
      if (existing) {
        return jsonResponse({ cached: true, ...existing }, 200, cors);
      }
      return jsonResponse({ cached: false, cycleKey, rawText: '' }, 200, cors);
    }

    if (request.method === 'POST' && url.pathname === '/api/daily-news-brief') {
      const body = await parseJsonBodySafe(request);
      if (!body || (!body.prompt && !body.seedRawText && !body.seedData)) {
        return jsonResponse({ error: 'Invalid daily news brief request' }, 400, cors);
      }
      const cycleKey = String(body.cycleKey || new Date().toISOString().slice(0, 10)).replace(/[^A-Za-z0-9@_-]/g, '');
      const cacheKey = `daily_news_brief_v5:${cycleKey}`;

      const existing = await env.SHARED_CACHE?.get(cacheKey, 'json');
      if (existing && !body.forceRefresh) {
        return jsonResponse({ cached: true, ...existing }, 200, cors);
      }

      if ((body.seedRawText || body.seedData) && !body.prompt) {
        const seedModel = String(body.modelUsed || PRIMARY_GEMINI_REASONING_MODEL).slice(0, 64);
        const validSeedData =
          body.seedData &&
          typeof body.seedData === 'object' &&
          !Array.isArray(body.seedData) &&
          typeof body.seedData.headline === 'string' &&
          Array.isArray(body.seedData.bullets) &&
          body.seedData.bullets.length >= 2
            ? body.seedData
            : undefined;
        const seededPayload = {
          cycleKey,
          modelUsed: seedModel,
          thinkingLevel: resolveGeminiThinkingLevelLabel(seedModel, 'XHIGH'),
          generatedAt: String(body.generatedAt || new Date().toISOString()).slice(0, 40),
          rawText: typeof body.seedRawText === 'string' ? body.seedRawText.slice(0, 16000) : '',
          ...(validSeedData ? { data: validSeedData } : {})
        };
        if (env.SHARED_CACHE) {
          await env.SHARED_CACHE.put(cacheKey, JSON.stringify(seededPayload), {
            expirationTtl: 60 * 60 * 26
          });
        }
        return jsonResponse({ cached: false, seeded: true, ...seededPayload }, 200, cors);
      }

      const newsKey = env.GEMINI_NEWS_API_KEY || env.GEMINI_API_KEY;
      if (!newsKey) {
        return jsonResponse({ error: 'GEMINI_API_KEY secret is not configured on this Worker.' }, 503, cors);
      }

      const thinkingBudget = Number(env.GEMINI_THINKING_BUDGET || HIGH_THINKING_BUDGET);
      const clientSystem = String(body.systemPrompt || '').slice(0, 8000);
      const effectiveSystem = clientSystem
        ? `${EDITORIAL_SYSTEM_PROMPT}\n\n${clientSystem}`
        : EDITORIAL_SYSTEM_PROMPT;

      const scopedEnv = {
        ...env,
        GEMINI_API_KEY: newsKey,
        GEMINI_DEFAULT_FREE_MODEL: PRIMARY_GEMINI_REASONING_MODEL
      };
      const {
        res: geminiRes,
        modelUsed,
        thinkingLevelUsed: newsThinkingLevelUsed
      } = await callGeminiTextWithFallback(
        scopedEnv,
        {
          systemInstruction: { parts: [{ text: effectiveSystem }] },
          tools: [{ google_search: {} }],
          generationConfig: {
            temperature: 0.16,
            thinkingConfig: { thinkingBudget }
          },
          contents: [{ role: 'user', parts: [{ text: String(body.prompt).slice(0, 24000) }] }]
        },
        { preferredThinkingLevel: 'XHIGH' }
      );

      if (!geminiRes || !geminiRes.ok) {
        const errText = geminiRes ? await geminiRes.text() : 'No response';
        return jsonResponse({ error: `Gemini API error: ${errText.slice(0, 240)}` }, 502, cors);
      }

      const rawJson = await geminiRes.json();
      const rawText = scrubStaleWeightHallucinations(extractNonThoughtText(rawJson), String(body.prompt));
      const resolvedNewsModel = modelUsed || PRIMARY_GEMINI_REASONING_MODEL;
      const payloadOut = {
        cycleKey,
        modelUsed: resolvedNewsModel,
        thinkingLevel:
          newsThinkingLevelUsed || resolveGeminiThinkingLevelLabel(resolvedNewsModel, 'XHIGH'),
        generatedAt: new Date().toISOString(),
        rawText
      };

      if (env.SHARED_CACHE && rawText) {
        await env.SHARED_CACHE.put(cacheKey, JSON.stringify(payloadOut), {
          expirationTtl: 60 * 60 * 26
        });
      }
      return jsonResponse({ cached: false, ...payloadOut }, 200, cors);
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
      const requestedThinkingLevel =
        String(body.thinkingLevel || LIVE_INTERACTIVE_GEMINI_THINKING_LEVEL).trim().toUpperCase() === 'XHIGH'
          ? 'XHIGH'
          : 'HIGH';
      let modelUsed = DEFAULT_FREE_MODEL_CASCADE[0];
      let resolvedThinkingLevel = null;
      let verifiedPasses = 1;
      let rawMarkdown = '';
      let primaryGroundingJson = null;

      if (body.deepResearchPass === true) {
        // Stage 1: Exhaustive Deep Research Investigation + Live Google Search Grounding
        const {
          res: researchRes,
          modelUsed: researchModel,
          thinkingLevelUsed: researchThinking
        } = await callGeminiTextWithFallback(
          env,
          {
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
          },
          { preferredThinkingLevel: requestedThinkingLevel }
        );

        if (!researchRes.ok) {
          const errText = await researchRes.text();
          return jsonResponse({ error: `Gemini API error: ${errText.slice(0, 300)}` }, 502, cors);
        }
        primaryGroundingJson = await researchRes.json();
        const researchMemo = extractNonThoughtText(primaryGroundingJson) || '';

        // Stage 2: Bespoke Thesis-First Film & Cap Synthesis
        const {
          res: synthRes,
          modelUsed: synthModel,
          thinkingLevelUsed: synthThinking
        } = await callGeminiTextWithFallback(
          env,
          {
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
          },
          { preferredThinkingLevel: requestedThinkingLevel }
        );

        if (!synthRes.ok) {
          const errText = await synthRes.text();
          return jsonResponse({ error: `Gemini API error: ${errText.slice(0, 300)}` }, 502, cors);
        }
        const synthJson = await synthRes.json();
        modelUsed = synthModel || researchModel;
        resolvedThinkingLevel = synthThinking || researchThinking;
        verifiedPasses = 2;
        rawMarkdown = extractNonThoughtText(synthJson) || researchMemo || 'No synthesis generated.';

        if (body.verifyPass === true && rawMarkdown && rawMarkdown !== 'No synthesis generated.') {
          const { res: auditRes, modelUsed: auditModel } = await callGeminiTextWithFallback(
            env,
            {
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
            },
            { preferredThinkingLevel: 'HIGH' }
          );
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
        const {
          res: geminiRes,
          modelUsed: initialModelUsed,
          thinkingLevelUsed: initialThinking
        } = await callGeminiTextWithFallback(
          env,
          {
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
                    text: `Take your full unhurried High-Thinking reasoning budget—prioritize 100% factual accuracy, impartial league-wide balance, CBA contract precision, and All-22 coaching-tape depth over generation speed.\n\nDirectly, thoughtfully, and even-handedly answer this exact 49ers question with zero generic AI throat-clearing or homer bias, using ONLY verified live real-time roster/injury/trade/standings/32-team-rank/cap/draft facts, All-22 film mechanics, EPA/NGS metrics, opponent strengths & spread calibration, and multi-year CBA salary cap math (when cap/contracts are relevant).\n\nQUESTION / TOPIC: ${prompt}\n\nAUTHORITATIVE LIVE REAL-TIME DATA SNAPSHOT:\n${sectionContext}`
                  }
                ]
              }
            ]
          },
          { preferredThinkingLevel: requestedThinkingLevel }
        );

        if (!geminiRes.ok) {
          const errText = await geminiRes.text();
          return jsonResponse({ error: `Gemini API error: ${errText.slice(0, 300)}` }, 502, cors);
        }

        primaryGroundingJson = await geminiRes.json();
        modelUsed = initialModelUsed;
        resolvedThinkingLevel = initialThinking;
        verifiedPasses = 1;
        rawMarkdown = extractNonThoughtText(primaryGroundingJson) || 'No synthesis generated.';

        if (body.verifyPass === true && rawMarkdown && rawMarkdown !== 'No synthesis generated.') {
          const { res: verifyRes, modelUsed: verifyModel } = await callGeminiTextWithFallback(
            env,
            {
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
            },
            { preferredThinkingLevel: 'HIGH' }
          );
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
        thinkingLevel:
          resolvedThinkingLevel ||
          resolveGeminiThinkingLevelLabel(modelUsed, requestedThinkingLevel),
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
      const requestedPodThinkingLevel =
        String(body.thinkingLevel || LIVE_INTERACTIVE_GEMINI_THINKING_LEVEL).trim().toUpperCase() === 'XHIGH'
          ? 'XHIGH'
          : 'HIGH';
      const researchDossier = String(body.researchDossier || '').slice(0, 14000);
      const solo = body.format === 'solo';
      let modelUsed = DEFAULT_FREE_MODEL_CASCADE[0];
      let resolvedPodThinkingLevel = null;
      let verifiedPasses = 1;
      let rawScriptText = '[]';

      if (body.deepResearchPass === true) {
        // Stage 1: Exhaustive Deep Research Investigation on the Podcast Topic
        const {
          res: researchRes,
          modelUsed: researchModel,
          thinkingLevelUsed: researchThinking
        } = await callGeminiTextWithFallback(
          env,
          {
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
          },
          { preferredThinkingLevel: requestedPodThinkingLevel }
        );

        if (!researchRes.ok) {
          return jsonResponse({ error: 'Failed Stage-1 Deep Research for podcast' }, 502, cors);
        }
        const researchJson = await researchRes.json();
        const researchMemo = extractNonThoughtText(researchJson) || researchDossier;

        // Stage 2: Restructure into Smooth Gemini NotebookLM Audio Overview Script
        const {
          res: scriptRes,
          modelUsed: stage2Model,
          thinkingLevelUsed: stage2Thinking
        } = await callGeminiTextWithFallback(
          env,
          {
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
          },
          { preferredThinkingLevel: requestedPodThinkingLevel }
        );

        if (!scriptRes.ok) {
          return jsonResponse({ error: 'Failed to synthesize podcast script' }, 502, cors);
        }
        const scriptJson = await scriptRes.json();
        modelUsed = stage2Model || researchModel;
        resolvedPodThinkingLevel = stage2Thinking || researchThinking;
        verifiedPasses = 2;
        rawScriptText = extractNonThoughtText(scriptJson) || '[]';

        if (body.verifyPass === true) {
          const { res: polishRes, modelUsed: polishModel } = await callGeminiTextWithFallback(
            env,
            {
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
            },
            { preferredThinkingLevel: 'HIGH' }
          );
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

        const {
          res: scriptRes,
          modelUsed: initialScriptModel,
          thinkingLevelUsed: initialScriptThinking
        } = await callGeminiTextWithFallback(
          env,
          {
            systemInstruction: {
              parts: [{ text: `${NOTEBOOKLM_PODCAST_STAGE2_SYSTEM_PROMPT}\n\n${effectiveSystemPrompt}` }]
            },
            tools: [{ google_search: {} }],
            generationConfig: {
              temperature: 0.25,
              thinkingConfig: { thinkingBudget }
            },
            contents: [{ role: 'user', parts: [{ text: scriptPrompt }] }]
          },
          { preferredThinkingLevel: requestedPodThinkingLevel }
        );

        if (!scriptRes.ok) {
          return jsonResponse({ error: 'Failed to synthesize podcast script' }, 502, cors);
        }

        const scriptJson = await scriptRes.json();
        modelUsed = initialScriptModel;
        resolvedPodThinkingLevel = initialScriptThinking;
        verifiedPasses = 1;
        rawScriptText = extractNonThoughtText(scriptJson) || '[]';

        if (body.verifyPass === true) {
          const { res: verifyScriptRes, modelUsed: verifyScriptModel } = await callGeminiTextWithFallback(
            env,
            {
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
            },
            { preferredThinkingLevel: 'HIGH' }
          );
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
        const ttsBlocks = chunkTurnsForGeminiTts(turns, 3800);
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

        const pcmBuffers = new Array(ttsBlocks.length).fill(null);
        let ttsAllOk = ttsBlocks.length > 0;
        const maxConcurrency = 2;
        for (let bStart = 0; bStart < ttsBlocks.length && ttsAllOk; bStart += maxConcurrency) {
          const batch = ttsBlocks.slice(bStart, bStart + maxConcurrency);
          const batchResults = await Promise.all(
            batch.map(async (block, relIdx) => {
              const ttsDialogue = directorHeader + block.map(t => t.spokenLine).join('\n');
              const { res: ttsRes, audioModelUsed: resolvedAudioModel } = await callGeminiAudioTtsWithFallback(env, {
                contents: [{ parts: [{ text: ttsDialogue }] }],
                generationConfig: {
                  responseModalities: ['AUDIO'],
                  speechConfig
                }
              });
              if (!ttsRes || !ttsRes.ok) return null;
              const ttsJson = await ttsRes.json();
              const b64 = ttsJson.candidates?.[0]?.content?.parts?.find(p => p?.inlineData?.data)?.inlineData?.data;
              if (!b64) return null;
              const binaryStr = atob(b64);
              const pcm = new Uint8Array(binaryStr.length - (binaryStr.length % 2));
              for (let i = 0; i < pcm.length; i++) pcm[i] = binaryStr.charCodeAt(i);
              return { idx: bStart + relIdx, pcm, resolvedAudioModel };
            })
          );
          for (const item of batchResults) {
            if (!item) {
              ttsAllOk = false;
              break;
            }
            pcmBuffers[item.idx] = item.pcm;
            audioModelUsed = item.resolvedAudioModel;
          }
        }

        if (ttsAllOk && pcmBuffers.every(Boolean)) {
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
        thinkingLevel:
          resolvedPodThinkingLevel ||
          resolveGeminiThinkingLevelLabel(modelUsed, requestedPodThinkingLevel),
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
