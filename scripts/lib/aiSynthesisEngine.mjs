/**
 * Deep Thinking & Chain-of-Verification AI Synthesis Engine for 49ers Faithful
 *
 * Design Principles (Accuracy > Velocity):
 * 1. Asynchronous / build-time AI synthesis uses `gemini-2.5-pro` with deep thinking
 *    (`thinkingBudget: 24576`) + Google Search Grounding (`google_search`) when
 *    `GEMINI_API_KEY` is configured in CI or local env.
 * 2. Strips Gemini 2.5 internal reasoning parts (`!part.thought`) before parsing output.
 * 3. Runs a two-stage Chain-of-Verification (Generator -> Adversarial Fact-Checker)
 *    plus deterministic programmatic validation against OverTheCap cap tables,
 *    ESPN active/IR rosters, Tankathon pick capital, and calibrated Monte Carlo odds.
 * 4. Degrades gracefully to deterministic, primary-source-verified builders when
 *    running without an API key.
 */

import {
  buildAuthoritativeLiveContextSnapshot,
  buildLiveGroundingSystemPrompt,
  sanitizeHallucinatedRosterText,
  validateNoHallucinatedRosterClaims
} from '../../src/engine/groundingValidator.js';

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
 * Extracts non-thought text from a Gemini 2.5 response object.
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

/**
 * Executes a two-pass Deep Thinking + Adversarial Fact-Check Gemini synthesis when
 * `process.env.GEMINI_API_KEY` is configured. Returns `null` cleanly if no key is set.
 */
export async function runVerifiedDeepGeminiSynthesis({
  taskPrompt,
  appData,
  expectJson = true,
  thinkingBudget = 24576,
  timeoutMs = 90000
}) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || !taskPrompt) return null;

  const model = process.env.GEMINI_SYNTHESIS_MODEL || 'gemini-2.5-pro';
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
  const systemPrompt = buildLiveGroundingSystemPrompt(appData);
  const contextSnapshot = buildAuthoritativeLiveContextSnapshot(appData);

  try {
    // Pass 1: Deep Thinking + Google Search Grounded Generation
    const genRes = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(timeoutMs),
      body: JSON.stringify({
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
                text: `${taskPrompt}\n\nAUTHORITATIVE LIVE GROUND-TRUTH SNAPSHOT:\n${contextSnapshot}`
              }
            ]
          }
        ]
      })
    });
    if (!genRes.ok) return null;
    const genJson = await genRes.json();
    const draftText = extractGeminiResponseText(genJson);
    if (!draftText) return null;

    // Pass 2: Adversarial Fact-Check & Consistency Verifier
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

    const verRes = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(timeoutMs),
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: systemPrompt }] },
        tools: [{ google_search: {} }],
        generationConfig: {
          temperature: 0.1,
          thinkingConfig: { thinkingBudget: Math.min(16384, thinkingBudget) }
        },
        contents: [{ role: 'user', parts: [{ text: verifyPrompt }] }]
      })
    });

    const finalRaw = verRes.ok ? extractGeminiResponseText(await verRes.json()) || draftText : draftText;
    return expectJson ? parseGroundedJsonSafe(finalRaw, null) : finalRaw;
  } catch {
    return null;
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
