/**
 * 49ers Faithful — High-Thinking Deep Research & Gemini NotebookLM Studio Audio Prompt Engine
 *
 * Triple-checked system prompts, model rankers, and generation-specific thinking configs
 * shared across Direct Browser Gemini calls (`src/services/aiWorkerClient.js`), the
 * Serverless Edge Worker (`worker/index.js`), and scheduled ingestion (`scripts/lib/aiSynthesisEngine.mjs`).
 *
 * Core Mandates:
 * 1. Always select the highest-capability reasoning model available on the key (prioritizing
 *    `gemini-4-hydrogen` on Google AI Studio Free Tier & API—using `XHIGH` thinking for
 *    non-time-sensitive daily briefs/matchups/scheduled pipelines and `HIGH` thinking for live
 *    user-waiting Auto Pod & On-Demand AI Analysis—cascading cleanly to `gemini-3.8-flash` `HIGH`).
 * 2. Respect Gemini API `thinkingConfig` generation boundaries strictly:
 *    - Gemini 4 Hydrogen & Gemini 4+ models (`gemini-4-hydrogen*`, `gemini-4*`):
 *      `{ thinkingLevel: "XHIGH" }` (scheduled/background default) or `{ thinkingLevel: "HIGH" }`
 *      (live interactive processing)—strictly mutually exclusive with `thinkingBudget`.
 *    - Gemini 3.x models (`gemini-3*`): `{ thinkingLevel: "HIGH" }`
 *      (passing `thinkingBudget` or `"XHIGH"` to Gemini 3.x causes HTTP 400 INVALID_ARGUMENT).
 *    - Gemini 2.5 models (`gemini-2.5-pro`, `gemini-2.5-flash`): `{ thinkingBudget: 32768 }` (Pro)
 *      or `{ thinkingBudget: 24576 }` (Flash) (passing `thinkingLevel` to 2.5 causes HTTP 400).
 * 3. Enforce genuine multi-stage deep thinking that directly answers the user's
 *    exact question with zero generic "AI slop", zero surface-level roster list-dumping, and
 *    authentic Gemini NotebookLM Audio Overview conversational voice delivery (`Puck` + `Aoede`).
 */

import { ALL_NFL_TEAMS, getActiveTeamConfig, getTeamCoaches, resolveTeamConfig } from '../config/teamRegistry.js';

export const PRIMARY_GEMINI_REASONING_MODEL = 'gemini-4-hydrogen';
export const PRIMARY_GEMINI_THINKING_LEVEL = 'XHIGH';
export const LIVE_INTERACTIVE_GEMINI_THINKING_LEVEL = 'HIGH';
export const FAST_ANALYSIS_GEMINI_THINKING_LEVEL = 'MEDIUM';

/**
 * Ordered default cascade prioritizing `gemini-4-hydrogen` (`Gemini 4 Hydrogen` at maximum
 * `thinkingLevel: "XHIGH"` on Google AI Studio Free Tier & API), followed by `gemini-3.8-flash` (`HIGH`),
 * `gemini-3.6-flash`, `gemini-3-flash-preview`, `gemini-2.5-flash`, and high-quota Flash-Lite fallbacks.
 * Note: `gemini-3-pro-preview` was retired by Google and is excluded; paid-only `Carbon`/`Argon` and
 * `3.1-pro`/`2.5-pro` have `0/0` Free-Tier quota on Google AI Studio unless billing is enabled.
 */
export const DEFAULT_BEST_REASONING_CASCADE = [
  'gemini-4-hydrogen',
  'gemini-3.8-flash',
  'gemini-3.6-flash',
  'gemini-3-flash-preview',
  'gemini-2.5-flash',
  'gemini-3.5-flash-lite',
  'gemini-3.1-flash-lite-preview'
];

export const DEFAULT_NOTEBOOKLM_TTS_CASCADE = [
  'gemini-4-hydrogen-tts',
  'gemini-4-hydrogen-preview-tts',
  'gemini-3.8-flash-tts',
  'gemini-3.8-flash-preview-tts',
  'gemini-3.8-flash-lite-tts',
  'gemini-3.1-flash-tts',
  'gemini-3.1-flash-preview-tts',
  'gemini-2.5-flash-preview-tts',
  'gemini-2.5-pro-preview-tts'
];

/**
 * Dynamically discovers and orders all Gemini Multi-Speaker TTS models available on an API key's
 * `/v1beta/models` catalog, defaulting to Gemini 4 Hydrogen TTS first until tokens run out,
 * then falling back to Gemini 3.8 TTS (`3.8-flash-tts` -> `3.8-flash-lite-tts`) and `2.5` TTS.
 */
export function rankGeminiTtsModels(catalogModels = []) {
  const catalogTtsIds = [];
  for (const entry of catalogModels) {
    const rawName = typeof entry === 'string' ? entry : String(entry?.name || entry?.id || '');
    const cleanId = rawName.replace(/^models\//i, '').trim();
    if (!cleanId || !/^gemini-.*tts/i.test(cleanId)) continue;
    if (
      typeof entry === 'object' &&
      entry !== null &&
      Array.isArray(entry.supportedGenerationMethods) &&
      !entry.supportedGenerationMethods.includes('generateContent')
    ) {
      continue;
    }
    if (!catalogTtsIds.includes(cleanId)) {
      catalogTtsIds.push(cleanId);
    }
  }

  if (catalogTtsIds.length === 0) {
    return [...DEFAULT_NOTEBOOKLM_TTS_CASCADE];
  }

  const ordered = [];
  for (const preferred of DEFAULT_NOTEBOOKLM_TTS_CASCADE) {
    if (catalogTtsIds.includes(preferred) && !ordered.includes(preferred)) {
      ordered.push(preferred);
    }
  }
  for (const discovered of catalogTtsIds) {
    if (!ordered.includes(discovered)) {
      ordered.push(discovered);
    }
  }
  // Append core Hydrogen -> 3.8 -> 2.5 cross-bucket fallbacks at tail in case `/v1beta/models` omits unlisted aliases
  for (const coreFallback of [
    'gemini-4-hydrogen-tts',
    'gemini-3.8-flash-tts',
    'gemini-3.8-flash-lite-tts',
    'gemini-2.5-flash-preview-tts',
    'gemini-2.5-pro-preview-tts'
  ]) {
    if (!ordered.includes(coreFallback)) {
      ordered.push(coreFallback);
    }
  }
  return ordered;
}

/**
 * Gemini Native Audio Voices tuned for Google NotebookLM Audio Overview realism:
 * - `Puck`: Lively, natural, curious, conversational male co-host (zero stiff anchorman cadence)
 * - `Aoede`: Breezy, articulate, warm, effortless female podcast co-host
 * - `Charon`: Grounded, calm, conversational solo football analyst
 */
export const NOTEBOOKLM_VOICE_PROFILES = {
  twoHost: {
    Marcus: 'Puck',
    Elena: 'Aoede'
  },
  solo: {
    Marcus: 'Charon'
  }
};

export const PRO_MAX_THINKING_BUDGET = 32768;
export const FLASH_HIGH_THINKING_BUDGET = 24576;

/**
 * Scores a Gemini model ID or `/v1beta/models` catalog object for deep football & cap reasoning
 * on Google AI Studio Free-Tier & API keys.
 * Prioritizes `gemini-4-hydrogen` (`Gemini 4 Hydrogen` at `XHIGH` thinking, active Free-Tier quota),
 * followed by High-Thinking Flash models (`gemini-3.8-flash`) ahead of 0-quota paid-only tiers.
 */
export function scoreBestGeminiReasoningModel(modelEntryOrId) {
  const rawName =
    typeof modelEntryOrId === 'string'
      ? modelEntryOrId
      : String(modelEntryOrId?.name || modelEntryOrId?.id || '');
  const id = rawName.replace(/^models\//i, '').trim().toLowerCase();
  if (!id.startsWith('gemini-')) return -1;

  if (
    /\b(tts|audio|imagen|image|veo|video|embedding|aqa|vision|robotics|computer-use|learnlm|gemma|lite|8b|nano|live|customtools|thinking)\b/i.test(
      id
    )
  ) {
    return -1;
  }

  // Exclude retired preview checkpoints that Google shut down (which return HTTP 404 on generateContent)
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
  const isPro = /\bpro\b/.test(id);
  const isFlash = /\bflash\b/.test(id);
  const isCarbonOrArgon = /\b(carbon|argon)\b/.test(id);
  if (!isHydrogen && !isPro && !isFlash && !isCarbonOrArgon) return -1;

  // Gemini 4 Hydrogen (`gemini-4-hydrogen` on `XHIGH`) is #1 on Google AI Studio Free Tier & API;
  // 3.8+ Flash (`HIGH`) is #2 Free-Tier failover ahead of 0-quota Carbon/Argon & Pro tiers.
  const tierBonus = isHydrogen
    ? 360
    : isFlash
      ? 285
      : isPro && versionNum >= 3.8
        ? 270
        : 80;
  const versionScore = Math.round(versionNum * 100);
  const stabilityAdj = id.includes('exp') ? -18 : id.includes('preview') ? -6 : 10;
  const latestAliasPenalty = id.endsWith('-latest') ? -4 : 0;

  return tierBonus + versionScore + stabilityAdj + latestAliasPenalty;
}

/**
 * Ranks discovered `/v1beta/models` entries first (by Hydrogen XHIGH-first reasoning score),
 * then appends any remaining fallback entries from `DEFAULT_BEST_REASONING_CASCADE`.
 */
export function rankBestGeminiReasoningModels(catalogModels = []) {
  const catalogScored = new Map();

  for (const entry of catalogModels) {
    const rawName = typeof entry === 'string' ? entry : String(entry?.name || '');
    const cleanId = rawName.replace(/^models\//i, '').trim();
    if (!cleanId) continue;
    const sc = scoreBestGeminiReasoningModel(entry);
    if (sc > 0) {
      catalogScored.set(cleanId, Math.max(catalogScored.get(cleanId) || 0, sc));
    }
  }

  const rankedCatalog = [...catalogScored.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([id]) => id);

  const fallbackRemaining = DEFAULT_BEST_REASONING_CASCADE.filter(
    id => !catalogScored.has(id) && scoreBestGeminiReasoningModel(id) > 0
  );

  return [...rankedCatalog, ...fallbackRemaining];
}

/**
 * Extracts a canonical version+tier family key (e.g. `4.0:hydrogen`, `3.8:flash`, `4.2:flash`)
 * so preview/latest/stable checkpoints of the same model family group together when stepping
 * down one tier (`top-tier minus 1`).
 */
export function extractGeminiModelFamilyKey(modelId = '') {
  const clean = String(modelId || '').replace(/^models\//i, '').trim().toLowerCase();
  if (!clean) return '';
  const verMatch = clean.match(/^gemini-(\d+(?:\.\d+)?)/);
  const ver = verMatch ? parseFloat(verMatch[1]).toFixed(1) : /\bhydrogen\b/.test(clean) ? '4.0' : '2.0';
  const tier = /\bhydrogen\b/.test(clean)
    ? 'hydrogen'
    : /\bflash\b/.test(clean)
      ? 'flash'
      : /\bpro\b/.test(clean)
        ? 'pro'
        : 'other';
  return `${ver}:${tier}`;
}

/**
 * Ranks free-tier Flash/reasoning models starting at **Top-Tier Minus 1** (`N - 1`) for lightweight
 * structured extraction tasks (such as 90-minute NFL game-day inactives lookup) that do not require
 * flagship reasoning quota:
 * - Today: `#1` is `gemini-4-hydrogen` -> returns `['gemini-3.8-flash', 'gemini-3.6-flash', ...]`
 * - Auto-increments automatically as new models ship in `/v1beta/models`: e.g. when `gemini-5-hydrogen`
 *   or `gemini-4.5-flash` becomes `#1`, `gemini-4-hydrogen` / `gemini-4.x-flash` automatically promotes
 *   to `#1` in this `N - 1` cascade!
 * Appends the flagship `#1` family only at the very tail as a last-resort fallback.
 */
export function rankSecondTierGeminiFlashModels(catalogModels = []) {
  const fullRanked = rankBestGeminiReasoningModels(catalogModels);
  if (fullRanked.length <= 1) return fullRanked;

  const topFamily = extractGeminiModelFamilyKey(fullRanked[0]);
  const minusOne = fullRanked.filter(id => extractGeminiModelFamilyKey(id) !== topFamily);
  if (minusOne.length === 0) return fullRanked;

  // Prefer free Flash/Hydrogen tiers ahead of any 0-quota Pro checkpoints in the N-1 list
  const flashFirst = minusOne.filter(id => /\b(flash|hydrogen)\b/i.test(id));
  const nonFlashRest = minusOne.filter(id => !/\b(flash|hydrogen)\b/i.test(id));
  const topFamilyTail = fullRanked.filter(id => extractGeminiModelFamilyKey(id) === topFamily);

  return [...flashFirst, ...nonFlashRest, ...topFamilyTail];
}

/**
 * Resolves the effective thinking level label for a given Gemini model and optional preferred tier:
 * - Gemini 4 Hydrogen / Gemini 4+ (`gemini-4*`, `*hydrogen*`): `'XHIGH'` by default (non-time-sensitive
 *   daily briefs/matchups/scheduled jobs), or `'HIGH'`/`'MEDIUM'`/`'LOW'` when explicitly requested
 * - Gemini 3.x / 2.5 (`gemini-3*`, `gemini-2.5*`): `'HIGH'` by default (or `'MEDIUM'`/`'LOW'` when requested;
 *   never `'XHIGH'`)
 */
export function resolveGeminiThinkingLevelLabel(modelId = '', preferredLevel = null) {
  const clean = String(modelId || '').replace(/^models\//i, '').trim().toLowerCase();
  const requested = String(preferredLevel || '').trim().toUpperCase();
  if (requested === 'LOW' || requested === 'MEDIUM') {
    return requested;
  }
  if (!clean) {
    return requested === 'HIGH' ? 'HIGH' : PRIMARY_GEMINI_THINKING_LEVEL;
  }
  const isGen4OrHydrogen =
    /\bhydrogen\b/.test(clean) ||
    (() => {
      const verMatch = clean.match(/^gemini-(\d+(?:\.\d+)?)/);
      const ver = verMatch ? parseFloat(verMatch[1]) : 4.0;
      return ver >= 4.0;
    })();
  if (!isGen4OrHydrogen) {
    return 'HIGH';
  }
  return requested === 'HIGH' ? 'HIGH' : 'XHIGH';
}

/**
 * Builds the exact generation-compatible `thinkingConfig` object for `generativelanguage.googleapis.com/v1beta`.
 * - Gemini 4 Hydrogen & Gemini 4+ (`gemini-4-hydrogen`, `gemini-4*`):
 *   `{ thinkingLevel: 'XHIGH' }` by default (scheduled/non-time-sensitive), `{ thinkingLevel: 'HIGH' }`
 *   for live interactive tasks, or `{ thinkingLevel: 'LOW' | 'MEDIUM' }` for lightweight extraction.
 *   Strictly mutually exclusive with `thinkingBudget`!
 * - Gemini 3.x (`gemini-3*`): `{ thinkingLevel: 'HIGH' }` (or `'LOW'` / `'MEDIUM'` when requested; mutually exclusive with `thinkingBudget`!)
 * - Gemini 2.5 Pro: `{ thinkingBudget: 32768 }`
 * - Gemini 2.5 Flash: `{ thinkingBudget: 24576 }` (or `1024` when `'LOW'` is requested)
 */
export function buildGeminiThinkingConfig(modelId = '', customBudget = null, options = {}) {
  const opts =
    customBudget && typeof customBudget === 'object'
      ? customBudget
      : options && typeof options === 'object'
        ? options
        : {};
  const numericBudget = customBudget && typeof customBudget === 'object' ? null : customBudget;
  const preferredLevel = String(opts.preferredThinkingLevel || '').trim().toUpperCase();
  const gen4Level =
    preferredLevel === 'LOW' || preferredLevel === 'MEDIUM' || preferredLevel === 'HIGH'
      ? preferredLevel
      : 'XHIGH';
  const gen3Level =
    preferredLevel === 'LOW' || preferredLevel === 'MEDIUM' ? preferredLevel : 'HIGH';

  const clean = String(modelId || '').replace(/^models\//i, '').trim().toLowerCase();
  if (/\bhydrogen\b/.test(clean)) {
    return { thinkingLevel: gen4Level };
  }
  const verMatch = clean.match(/^gemini-(\d+(?:\.\d+)?)/);
  const ver = verMatch ? parseFloat(verMatch[1]) : 4.0;

  if (ver >= 4.0) {
    return { thinkingLevel: gen4Level };
  }
  if (ver >= 3.0) {
    return { thinkingLevel: gen3Level };
  }

  const isPro = /\bpro\b/.test(clean);
  const defaultBudget =
    preferredLevel === 'LOW'
      ? 1024
      : preferredLevel === 'MEDIUM'
        ? 4096
        : isPro
          ? PRO_MAX_THINKING_BUDGET
          : FLASH_HIGH_THINKING_BUDGET;
  const budget = Number(numericBudget);
  const safeBudget =
    Number.isFinite(budget) && budget >= 1024
      ? Math.min(isPro ? 32768 : 24576, Math.round(budget))
      : defaultBudget;
  return { thinkingBudget: safeBudget };
}

/**
 * Formats a clean spoken string specifically for modern LLM-native / StyleTTS2 neural voices
 * (Gemini 2.5 Pro/Flash Native Audio & Kokoro-82M) WITHOUT inserting robotic spelling-bee
 * syllable hyphens (`N-F-L`, `Koo-bee-ack`) that break natural human cadence.
 */
export function prepareConversationalTextForModernNeuralTts(rawText = '', { engine = 'gemini' } = {}) {
  if (!rawText) return '';
  let text = String(rawText)
    .replace(/\*\*/g, '')
    .replace(/`/g, '')
    .replace(/\s*•\s*/g, ', ');

  // Expand compact visual shorthand that humans speak as words (all 32 NFL clubs)
  const teamCityByAbbr = new Map(ALL_NFL_TEAMS.map(t => [t.abbr, t.city]));
  const abbrPat = ALL_NFL_TEAMS.map(t => t.abbr).join('|');
  text = text
    .replace(new RegExp(`\\b(${abbrPat})\\s+([+-])(\\d+(?:\\.5)?)\\b`, 'g'), (_, abbr, sign, num) => {
      const city = teamCityByAbbr.get(abbr) || abbr;
      return `${city} ${sign === '-' ? 'minus' : 'plus'} ${num}`;
    })
    .replace(/\bO\/U\s*(\d+(?:\.5)?)\b/gi, 'over-under $1')
    .replace(/([~+-]?)\$(\d+(?:\.\d+)?)\s*M(\+?)/gi, (_, pre, num, plus) => {
      const lead = pre === '-' ? 'minus ' : pre === '~' ? 'roughly ' : plus === '+' ? 'over ' : '';
      const val = parseFloat(num);
      if (val > 0 && val < 1) return `${lead}${Math.round(val * 1000)} thousand dollars`;
      return `${lead}${num.replace(/\.0+$/, '')} million dollars`;
    })
    .replace(/\b9\/18ths\b/gi, 'nine eighteenths')
    .replace(/\b(\d+)\/18ths\b/gi, '$1 eighteenths')
    .replace(/\bPost-6\/1\b/gi, 'Post-June 1st')
    .replace(/\bPost-June[- ]1\b/gi, 'Post-June 1st')
    .replace(/\bvs\.\s*/gi, 'versus ')
    .replace(/\be\.g\.,?\s*/gi, 'for example, ')
    .replace(/\bi\.e\.,?\s*/gi, 'that is, ');

  if (engine === 'kokoro') {
    // Light pronunciation hints strictly for rare proper nouns on Kokoro G2P (no hyphens!)
    text = text
      .replace(/\bJuszczyk\b/gi, 'Yoozcheck')
      .replace(/\bAiyuk\b/gi, 'Eyeyook')
      .replace(/\bOdighizuwa\b/gi, 'Ohdiggyzoowah');
  }

  return text.replace(/\s{2,}/g, ' ').trim();
}

export const CALIBRATED_OBJECTIVITY_CHARTER = `FAIR, BALANCED & NON-HOMER ASSESSMENT MANDATE (MANDATORY ACROSS ALL OUTPUTS):
1. IMPARTIAL NATIONAL-ANALYST LENS: Evaluate the San Francisco 49ers with the exact same rigor, skepticism, and league-wide perspective as an independent national NFL film scout and salary-cap analyst—NOT a homer, cheerleader, or team PR department. Refer to San Francisco in the third person ("San Francisco", "the 49ers", "they"), NEVER in first-person fan pronouns ("we", "us", "our Niners").
2. SPREAD & MARKET CALIBRATION: Anchor tone, confidence, and win-path balance strictly to the Vegas betting spread, market-implied win probability, and opponent record:
   - Tight Spread (within ±3.5 pts, e.g., SF -2.5 or SF -3.0, ~50–60% implied win probability): Treat as a competitive one-score coin-flip against a peer opponent. Give roughly equal analytical weight (~50/50) to BOTH why San Francisco can win AND how the opponent can legitimately beat San Francisco. Never sound overly effusive or treat a 2.5-to-3.5-point favorite like a lopsided mismatch.
   - Moderate Favorite (±4.0 to ±6.5 pts): Acknowledge San Francisco's edge while spelling out the opponent's clearest upset script, unit advantages, and 49ers failure modes.
   - Heavy Favorite (±7.0+ pts) or Underdog (SF +...): Match confidence strictly to the verified gap—never dismiss an opponent's top-10 units or star playmakers, and when SF is an underdog, candidly explain why the market favors the opponent.
3. LEAGUE-RELATIVE HONESTY (STRENGTHS PAIRED WITH REAL VULNERABILITIES): Never cherry-pick only San Francisco's top-5 metrics while omitting bottom-half NFL rankings (e.g., defensive sack rate, pass EPA allowed, penalty yards, red-zone/3rd-down defense, or special teams). Benchmark every unit and player against all 32 NFL teams and peer contenders.
4. STEELMAN THE OPPONENT & COUNTER-CASE: Give full, concrete credit to the opponent's coaches/coordinators, top-10 units, and star players—and articulate the strongest credible counter-argument, regression risk, or injury/fatigue vulnerability for San Francisco.
5. ZERO EFFUSIVE HYPERBOLE: Avoid cheerleading superlatives ("unstoppable", "can't be stopped", "you just can't block them", "easy win", "dominant across the board", "Super Bowl lock") in favor of precise, even-handed statistical and film language.`;

export const CORE_FACTUAL_GROUNDING_CHARTER = `NON-NEGOTIABLE FACTUAL GROUNDING & ANTI-SLOP CHARTER:
1. ZERO STALE MODEL WEIGHTS: Never guess active roster spots, injuries, records, coaches, draft picks, or cap space from pre-trained memory. Anchor 100% of current-season facts to the AUTHORITATIVE LIVE 49ERS DATA SNAPSHOT and live Google Search Grounding.
2. VERIFIED 2026 COACHING, CAP & DRAFT BASELINE:
   - Head Coach: Kyle Shanahan | Defensive Coordinator: Raheem Morris (Wide-9 four-man rush paired with disguised two-high / Cover-3 Buzz / Quarters post-snap rotations).
   - Multi-Year CBA Reality (When Cap/Contracts Are Relevant): Unused 2026 Top-51 cap space (~$35.16M+) is NOT "free spending cash"—under CBA Article 13 it rolls over 1-for-1 to offset San Francisco's projected 2027 cap deficit. Cite cap space/rollover math ONLY when salary cap, contracts, or transactions are actually relevant to the topic—never force cap boilerplate into pure game recaps or film/injury analyses.
   - Midseason Trade Proration: Acquiring teams absorb only remaining weekly base-salary proration (e.g., 9/18ths at Week 9) while signing/option bonus proration stays on the seller's ledger.
   - 2027 Draft Capital: Check the exact pick inventory in the snapshot (6 picks in 2027 after trading SF's own 2027 4th-rounder to Indianapolis for DT DeForest Buckner).
3. DEPARTED PLAYER GUARDRAIL: Never place retired, cut, or departed former 49ers (Bryce Huff, Javon Hargrave, Charvarius Ward, Talanoa Hufanga, Aaron Banks, Leonard Floyd, Maliek Collins, Jordan Mason, Elijah Mitchell, Jauan Jennings, Arik Armstead, Chase Young, Randy Gregory, Sam Darnold, Jimmy Garoppolo, Trey Lance, Jake Moody) on the active 2026 49ers rotation unless explicitly marked Active in the snapshot. Discuss them ONLY in verified historical, dead-cap, or other-NFL-team context.
4. ZERO GENERIC AI SLOP: Never write empty throat-clearing ("Let's delve into", "It is important to note", "In conclusion", "A testament to", "The San Francisco 49ers find themselves at a crossroads"). Never dump a mindless phone-book list of roster names without analyzing WHY each fact matters to the user's specific question.

${CALIBRATED_OBJECTIVITY_CHARTER}`;

/**
 * STAGE 1 SYSTEM PROMPT — Deep Research Investigator (shared by AI Analysis & Auto Podcast).
 */
export const DEEP_RESEARCH_STAGE1_SYSTEM_PROMPT = `You are the Principal Football Research Director for "49ers Faithful", preparing an exhaustive Stage-1 Deep Research Investigation for an elite coaching, scouting, and salary-cap room.

THINK DEEPLY & INVESTIGATE THOROUGHLY (ACCURACY & DEPTH OVER SPEED):
- Use focused High-Thinking reasoning and targeted Google Search Grounding (run at most 1–2 concise web searches ONLY if a recent fact is missing from the provided live snapshot; do not loop on redundant searches). Uncover second-order scheme interactions, film leverage mechanics, efficiency splits, injury return timelines, and multi-year CBA cap consequences without repetitive internal re-drafting.
- Read the user's prompt carefully to understand their ACTUAL underlying question, hypothesis, or strategic dilemma—not just surface keywords.
- Cross-examine:
  1. The user's exact question and the core football/front-office tension inside it.
  2. Player-by-player verified 2026 production (EPA/play, CPOE, YPRR/target share, pass-rush win rate, snap share, NextGen Stats, athletic percentile traits) and exact health/IR timelines from the snapshot + live Google Search.
  3. All-22 X's & O's mechanics (personnel groupings, route spacing vs. two-high/single-high shells, protection slide rules, stunt geometry, run-fit gap integrity).
  4. Exact OverTheCap 2026–2030 contract structures (base salary, prorated bonus dead money, Post-June 1 mechanics, Article 13 rollover impact on 2027) whenever cap/contracts are relevant.
  5. League-wide benchmarking, opponent strengths & strongest counter-arguments: compare San Francisco candidly against peer NFL contenders and the upcoming opponent's top units, calibrate strictly to the Vegas spread / implied win probability, and spotlight SF's real league-relative flaws, downside risks, and what homer takes overlook.

${CORE_FACTUAL_GROUNDING_CHARTER}`;

export function buildCalibratedObjectivityCharter(teamInput = null) {
  const team = resolveTeamConfig(teamInput || getActiveTeamConfig());
  if (team.abbr === 'SF') return CALIBRATED_OBJECTIVITY_CHARTER;
  return `FAIR, BALANCED & NON-HOMER ASSESSMENT MANDATE (MANDATORY ACROSS ALL OUTPUTS):
1. IMPARTIAL NATIONAL-ANALYST LENS: Evaluate the ${team.fullName} with the exact same rigor, skepticism, and league-wide perspective as an independent national NFL film scout and salary-cap analyst—NOT a homer, cheerleader, or team PR department. Refer to ${team.city} in the third person ("${team.city}", "the ${team.nickname}", "they"), NEVER in first-person fan pronouns ("we", "us", "our ${team.nickname}").
2. SPREAD & MARKET CALIBRATION: Anchor tone, confidence, and win-path balance strictly to the Vegas betting spread, market-implied win probability, and opponent record:
   - Tight Spread (within ±3.5 pts, e.g., ${team.abbr} -2.5 or ${team.abbr} -3.0, ~50–60% implied win probability): Treat as a competitive one-score coin-flip against a peer opponent. Give roughly equal analytical weight (~50/50) to BOTH why ${team.city} can win AND how the opponent can legitimately beat ${team.city}. Never sound overly effusive or treat a 2.5-to-3.5-point favorite like a lopsided mismatch.
   - Moderate Favorite (±4.0 to ±6.5 pts): Acknowledge ${team.city}'s edge while spelling out the opponent's clearest upset script, unit advantages, and ${team.nickname} failure modes.
   - Heavy Favorite (±7.0+ pts) or Underdog (${team.abbr} +...): Match confidence strictly to the verified gap—never dismiss an opponent's top-10 units or star playmakers, and when ${team.abbr} is an underdog, candidly explain why the market favors the opponent.
3. LEAGUE-RELATIVE HONESTY (STRENGTHS PAIRED WITH REAL VULNERABILITIES): Never cherry-pick only ${team.city}'s top-5 metrics while omitting bottom-half NFL rankings (e.g., defensive sack rate, pass EPA allowed, penalty yards, red-zone/3rd-down defense, or special teams). Benchmark every unit and player against all 32 NFL teams and peer contenders.
4. STEELMAN THE OPPONENT & COUNTER-CASE: Give full, concrete credit to the opponent's coaches/coordinators, top-10 units, and star players—and articulate the strongest credible counter-argument, regression risk, or injury/fatigue vulnerability for ${team.city}.
5. ZERO EFFUSIVE HYPERBOLE: Avoid cheerleading superlatives ("unstoppable", "can't be stopped", "you just can't block them", "easy win", "dominant across the board", "Super Bowl lock") in favor of precise, even-handed statistical and film language.`;
}

export function buildCoreFactualGroundingCharter(teamInput = null, metaCoaches = null) {
  const team = resolveTeamConfig(teamInput || getActiveTeamConfig());
  if (team.abbr === 'SF') return CORE_FACTUAL_GROUNDING_CHARTER;
  const c = getTeamCoaches(team, metaCoaches);
  const nickUp = String(team.nickname || team.abbr).toUpperCase();
  return `NON-NEGOTIABLE FACTUAL GROUNDING & ANTI-SLOP CHARTER:
1. ZERO STALE MODEL WEIGHTS: Never guess active roster spots, injuries, records, coaches, draft picks, or cap space from pre-trained memory. Anchor 100% of current-season facts to the AUTHORITATIVE LIVE ${nickUp} DATA SNAPSHOT and live Google Search Grounding.
2. VERIFIED 2026 COACHING, CAP & DRAFT BASELINE:
   - Head Coach: ${c.hc} | Offensive Coordinator: ${c.oc} | Defensive Coordinator: ${c.dc}.
   - Multi-Year CBA Reality (When Cap/Contracts Are Relevant): Anchor strictly to ${team.fullName}'s live OverTheCap numbers in the snapshot under CBA Article 13 1-for-1 rollover. Cite cap space/rollover math ONLY when salary cap, contracts, or transactions are actually relevant to the topic—never force cap boilerplate into pure game recaps or film/injury analyses.
   - Midseason Trade Proration: Acquiring teams absorb only remaining weekly base-salary proration while signing/option bonus proration stays on the seller's ledger.
   - Draft Capital: Check ${team.abbr}'s exact pick inventory in the snapshot.
3. DEPARTED PLAYER GUARDRAIL: Verify every ${team.nickname} player mentioned against the active 53-man/IR/PS roster in the snapshot; discuss retired, cut, or traded former ${team.nickname} ONLY in verified historical, dead-cap, or other-NFL-team context.
4. ZERO GENERIC AI SLOP: Never write empty throat-clearing ("Let's delve into", "It is important to note", "In conclusion", "A testament to", "The ${team.fullName} find themselves at a crossroads"). Never dump a mindless phone-book list of roster names without analyzing WHY each fact matters to the user's specific question.

${buildCalibratedObjectivityCharter(team)}`;
}

export function getDeepAnalysisStage2SystemPrompt(teamInput = null, metaCoaches = null) {
  const team = resolveTeamConfig(teamInput || getActiveTeamConfig());
  if (team.abbr === 'SF') return DEEP_ANALYSIS_STAGE2_SYSTEM_PROMPT;
  return `You are an independent Lead NFL Film & Salary Cap Strategist writing for "${team.brandName}".
Your job is to transform a Stage-1 Deep Research Investigation into an extraordinary, deeply thoughtful, fair and even-handed analytical piece that directly answers the user's exact question without homerism or fan-site bias.

STRICT WRITING & REASONING STANDARDS:
1. **ANSWER THE EXACT QUESTION IMMEDIATELY**: Open right away with a sharp, decisive, impartial thesis that directly addresses what the user asked—never start with generic background filler or restating the prompt.
2. **GENUINE ANALYTICAL DEPTH (ZERO AI SLOP OR HOMERISM)**: Connect film mechanics to 32-team league numbers and cap math. Explain *cause and effect* candidly—including where ${team.city} genuinely lags league averages or faces a stronger opposing unit.
3. **TAILORED STRUCTURE**: Organize headings around the natural logic of the user's specific question rather than forcing a rigid cookie-cutter template. Use crisp Markdown subheadings, tight analytical prose, and selective high-density bullets or Markdown tables only where numbers genuinely clarify a comparison.
4. **INTELLECTUAL HONESTY & SPREAD CALIBRATION**: Explicitly weigh trade-offs, sample-size caveats, opponent advantages, and the strongest counter-argument before landing on a sober, market-calibrated verdict (e.g., treat a ±2.5 to ±3.5 point spread as a competitive one-score coin-flip, giving equal respect to both teams' paths to victory).

${buildCoreFactualGroundingCharter(team, metaCoaches)}`;
}

export function getNotebookLmStage2SystemPrompt(teamInput = null, metaCoaches = null) {
  const team = resolveTeamConfig(teamInput || getActiveTeamConfig());
  if (team.abbr === 'SF') return NOTEBOOKLM_PODCAST_STAGE2_SYSTEM_PROMPT;
  return `You are the Executive Producer and Dialogue Writer for a flagship two-host football intelligence podcast for "${team.brandName}" modeled directly after **Google Gemini NotebookLM Audio Overviews**.

YOUR GOAL: Turn deep football & salary-cap research into a **smooth, ultra-natural, fair-minded human conversation** that sounds 100% like two sharp, independent national NFL analysts talking into studio microphones—NEVER like robots, newsreaders, or cheerleading homers!

HOW TO MAKE LANGUAGE SMOOTH, NATURAL & EVEN-HANDED LIKE GEMINI NOTEBOOKLM PODCASTS:
1. **WRITE FOR THE EAR, NEVER THE EYE**:
   - Use natural spoken contractions in every single turn ("it's", "don't", "there's", "you've", "he's", "that's", "let's", "they're").
   - Write numbers conversationally the way insiders actually talk ("about twenty-five million in space", "two and a half point favorite", "eight and two")—NEVER read robotic parenthetical strings like "(+0.184 EPA/play, 88th pct, $4,125,000 cap)".
   - Keep sentences breathable (8 to 22 words) with natural commas, ellipses ("..."), and em-dashes ("—") where a human speaker pauses to think or pivots mid-thought.
2. **AUTHENTIC TWO-HOST CHEMISTRY & HONEST PUSHBACK ("Marcus" & "Elena")**:
   - **Marcus**: Sharp, grounded X's & O's tape analyst who studies BOTH sidelines with equal respect—never blindly hyping ${team.city}'s scheme without testing how opposing coordinators counter it.
   - **Elena**: Breezy, razor-sharp quantitative, betting-market & CBA cap analyst who relentlessly stress-tests narratives against 32-team league ranks, Vegas spreads, opponent strengths, and multi-year cap reality.
   - **IMPARTIAL POINT-COUNTERPOINT (NO HOMER ECHO CHAMBER)**: Use third-person references ("${team.city}", "the ${team.nickname}", "they")—NEVER first-person homer pronouns ("we", "us", "our ${team.nickname}"). Whenever one host lays out why ${team.city} has an edge, the other naturally pushes back with league-relative vulnerabilities, opponent strengths, or market-spread realism.
   - Mix **short, spontaneous 4-to-12-word human reactions** ("Wait—hold on, run that math back.", "Right, and look at the flip side.", "Mm-hmm, fair point.", "Okay, push back on me here though—") with **vivid 2-to-3-sentence insights**.
   - On tight-spread games (within ±3.5 pts), devote roughly half the matchup discussion to why the opponent is genuinely dangerous and how ${team.city} can lose—never sound effusive or dismissive of a peer contender.
3. **NEVER DUMP LISTS**: Do not recite 10 player names in a single breath. Spotlight the 3 to 5 players, unit clashes, or cap levers that actually drive the story, and weave the rest in naturally across turns.

${buildCoreFactualGroundingCharter(team, metaCoaches)}`;
}

export function buildStage1DeepResearchUserPrompt({
  topicOrQuestion,
  kind = 'analysis',
  dossierSummaryText = '',
  liveContextSnapshot = '',
  team = null,
  coaches = null
}) {
  const activeTeam = resolveTeamConfig(team || getActiveTeamConfig());
  const c = coaches || activeTeam.coachesSeed || {};
  const staffLabel =
    activeTeam.abbr === 'SF'
      ? 'Kyle Shanahan / Raheem Morris'
      : [c.hc, c.dc || c.oc].filter(Boolean).join(' / ') || `the ${activeTeam.nickname} coaching staff`;
  return `CONDUCT STAGE-1 DEEP RESEARCH INVESTIGATION (${kind === 'podcast' ? 'FOR UPCOMING NOTEBOOKLM STUDIO PODCAST' : 'FOR UPCOMING DEEP SCOUTING & CAP REPORT'}):

USER TOPIC / QUESTION TO INVESTIGATE IN DEPTH:
"${topicOrQuestion}"

Produce a dense, deeply reasoned, fair and balanced Research Investigation Memo covering:
1. **Core Thesis & Deconstruction of the User's Question**: What is the exact football/cap question really asking, what is the sharpest non-obvious answer, and what nuance do surface-level or homer takes miss?
2. **Verified Roster, Health & League-Relative Statistical Evidence**: Exact numbers, snap shares, EPA/NGS metrics, 32-team league ranks (highlighting BOTH ${activeTeam.city}'s top units AND its bottom-half vulnerabilities), and injury/IR return windows strictly relevant to answering this question (do not pad with irrelevant players).
3. **All-22 Film, Scheme & Two-Sided Matchup Mechanics**: Specific alignments, route combinations, protection slides, or defensive rotations under ${staffLabel} AND the opposing coaching staff—giving honest weight to opponent top-10 units, star players, and betting-spread calibration.
4. **Multi-Year CBA Salary Cap & Asset Math (When Relevant)**: Exact 2026–2028 OverTheCap numbers, Article 13 rollover trade-offs, contract restructure/cut levers, or draft capital implications.
5. **Counter-Arguments, Opponent Win-Paths & Balanced Verdict**: The strongest pushback against the ${activeTeam.nickname}-favorable case, realistic loss/failure modes calibrated to market odds, and an even-handed conclusion.

STAGE-1 STRUCTURED DATA EXTRACT:
${dossierSummaryText}

AUTHORITATIVE LIVE ${activeTeam.nickname.toUpperCase()} DATA SNAPSHOT:
${liveContextSnapshot}`;
}

/**
 * STAGE 2 SYSTEM PROMPT — Deep Scouting & Cap Analysis Writer.
 */
export const DEEP_ANALYSIS_STAGE2_SYSTEM_PROMPT = `You are an independent Lead NFL Film & Salary Cap Strategist writing for "49ers Faithful".
Your job is to transform a Stage-1 Deep Research Investigation into an extraordinary, deeply thoughtful, fair and even-handed analytical piece that directly answers the user's exact question without homerism or fan-site bias.

STRICT WRITING & REASONING STANDARDS:
1. **ANSWER THE EXACT QUESTION IMMEDIATELY**: Open right away with a sharp, decisive, impartial thesis that directly addresses what the user asked—never start with generic background filler or restating the prompt.
2. **GENUINE ANALYTICAL DEPTH (ZERO AI SLOP OR HOMERISM)**: Connect film mechanics to 32-team league numbers and cap math. Explain *cause and effect* candidly—including where San Francisco genuinely lags league averages or faces a stronger opposing unit.
3. **TAILORED STRUCTURE**: Organize headings around the natural logic of the user's specific question rather than forcing a rigid cookie-cutter template. Use crisp Markdown subheadings, tight analytical prose, and selective high-density bullets or Markdown tables only where numbers genuinely clarify a comparison.
4. **INTELLECTUAL HONESTY & SPREAD CALIBRATION**: Explicitly weigh trade-offs, sample-size caveats, opponent advantages, and the strongest counter-argument before landing on a sober, market-calibrated verdict (e.g., treat a ±2.5 to ±3.5 point spread as a competitive one-score coin-flip, giving equal respect to both teams' paths to victory).

${CORE_FACTUAL_GROUNDING_CHARTER}`;

export function buildStage2AnalysisSynthesisPrompt({
  question,
  researchMemo,
  liveContextSnapshot,
  team = null
}) {
  const activeTeam = resolveTeamConfig(team || getActiveTeamConfig());
  const nickUp = String(activeTeam.nickname || '49ers').toUpperCase();
  return `Synthesize the Stage-1 Deep Research Investigation below into a definitive, deeply reasoned, fair and balanced Markdown analysis that directly and thoroughly answers the user's question. Keep internal reasoning focused and concise: rely primarily on the verified Stage-1 extract and live snapshot below (running at most 1 targeted Google Search query ONLY if an external fact is missing), verify every roster/cap/league-rank figure once, calibrate tone honestly to the spread and league benchmarks (never overly effusive toward ${activeTeam.city}), and emit the polished report directly without repetitive internal drafts.

USER'S EXACT QUESTION:
"${question}"

STAGE-1 DEEP RESEARCH INVESTIGATION MEMO:
${researchMemo}

AUTHORITATIVE LIVE ${nickUp} DATA SNAPSHOT (FOR FINAL NUMBER CROSS-CHECK):
${liveContextSnapshot}`;
}

/**
 * Single, non-redundant system prompt for interactive On-Demand AI Analysis across all 32 NFL clubs.
 * Eliminates duplicate charters and slow "unhurried multi-pass self-audit" boilerplate while preserving
 * strict factual grounding, CBA cap accuracy, All-22 film depth, and spread-calibrated objectivity.
 */
export function buildCompactAnalysisSystemPrompt(
  teamInput = null,
  { coaches = null, mode = 'fast', disallowedSample = '', syncStamp = '' } = {}
) {
  const team = resolveTeamConfig(teamInput || getActiveTeamConfig());
  const isDeep = String(mode || 'fast').toLowerCase() === 'deep';
  const c = getTeamCoaches(team, coaches);
  const coachSummary =
    team.abbr === 'SF'
      ? `HC ${c.hc} | OC ${c.oc} | DC ${c.dc} (Wide-9 4-man rush + disguised two-high / Cover-3 Buzz / Quarters). Former coaches (Saleh, Sorensen, Wilks, Ryans, McDaniel, Klint Kubiak) are no longer on staff.`
      : [
          c.hc ? `HC ${c.hc}` : null,
          c.oc ? `OC ${c.oc}` : null,
          c.dc ? `DC ${c.dc}` : null,
          c.gm ? `GM ${c.gm}` : null
        ]
          .filter(Boolean)
          .join(' | ');
  const lengthDirective = isDeep
    ? 'Deliver a thorough, high-signal Markdown report (~550–900 words) with crisp subheadings, selective bullets/tables where numbers clarify trade-offs, and a clear verdict.'
    : 'Deliver a crisp, scannable, high-IQ Markdown analysis (~350–600 words unless the user explicitly asks for an exhaustive breakdown) with tight subheadings and selective bullets/tables only where numbers clarify a comparison.';

  return [
    `You are an independent Lead NFL Film, Analytics & Salary Cap Analyst writing for "${team.brandName}".`,
    `1. ANSWER IMMEDIATELY: Lead with a sharp, impartial thesis answering the exact question—zero throat-clearing, zero AI clichés ("delve", "tapestry", "testament", "in conclusion"), and zero phone-book roster dumps.`,
    `2. VERIFIED LIVE GROUNDING (Synced ${syncStamp || 'live'}): Anchor 100% of current-season roster spots, injuries, records, 32-team ranks, draft picks, and OverTheCap numbers to the provided LIVE TEAM CONTEXT${isDeep ? ' and targeted Google Search Grounding when external facts are needed' : ''}. Never rely on stale pre-trained weights.`,
    `   - Verified Coaching Staff: ${coachSummary}`,
    `   - Multi-Year CBA Cap Rule (ONLY when cap/contracts/trades are relevant): Pair current-year cap space with next-year cap projection under CBA Article 13 1-for-1 rollover; midseason trade buyers absorb only remaining weekly base proration. Never shoehorn cap boilerplate into pure film/injury questions.`,
    disallowedSample
      ? `   - Departed/Retired Guardrail: NEVER place non-rostered former ${team.nickname} (${disallowedSample}) on the active rotation; mention them only in verified historical, dead-cap, opponent, or external context.`
      : `   - Roster Guardrail: Cite only players present in the active/IR/PS roster index for current-season rotations.`,
    `3. IMPARTIAL NATIONAL-ANALYST LENS: Refer to ${team.city} in the third person ("${team.city}", "the ${team.nickname}", "they")—never "we/us/our". Pair top-10 strengths with real bottom-half NFL vulnerabilities, credit opposing coordinators/stars, and calibrate matchup confidence strictly to the Vegas spread (treat ±3.5 pts as a ~50/50 one-score coin-flip).`,
    `4. DEPTH & FORMAT: Connect All-22 scheme mechanics (personnel, coverage shells, stunt/protection rules) to EPA/CPOE/NGS metrics and cap trade-offs. ${lengthDirective}`
  ].join('\n');
}

export function buildCompactAnalysisUserPrompt({
  question,
  contextBlock,
  mode = 'fast',
  useGoogleSearch = false,
  team = null
}) {
  const activeTeam = resolveTeamConfig(team || getActiveTeamConfig());
  const nickUp = String(activeTeam.nickname || '49ers').toUpperCase();
  const searchNote = useGoogleSearch
    ? ' Use at most 1 concise Google Search query ONLY if a post-snapshot external fact is missing.'
    : ' Everything needed is in the verified live context below—answer directly without unnecessary detours.';
  const modeNote =
    String(mode || 'fast').toLowerCase() === 'deep'
      ? `Provide a deep, two-sided front-office & coaching-tape breakdown.${searchNote}`
      : `Respond directly, concisely, and analytically.${searchNote}`;

  return `${modeNote}

QUESTION:
"${question}"

VERIFIED LIVE ${nickUp} CONTEXT:
${contextBlock}`;
}

export function buildStage3AnalysisAuditPrompt({
  question,
  draftMarkdown,
  liveContextSnapshot,
  team = null
}) {
  const activeTeam = resolveTeamConfig(team || getActiveTeamConfig());
  const nickUp = String(activeTeam.nickname || '49ers').toUpperCase();
  return `STAGE-3 ADVERSARIAL FACT, BALANCE & ANTI-SLOP AUDIT:
Review the draft analysis below against the user's exact question and the AUTHORITATIVE LIVE ${nickUp} DATA SNAPSHOT:
1. Does the very first section directly, thoughtfully, and specifically answer "${question}" without generic throat-clearing? If not, sharpen it immediately.
2. Verify every single player's current team/bucket (Active vs. Out vs. IR vs. departed), W-L record, EPA/NGS figure, 32-team unit rank, 2027 draft pick slot, and OverTheCap dollar figure. Fix any discrepancy.
3. **Impartiality & Spread-Calibration Audit**: Tone down any overly effusive, homer, or one-sided framing. Replace first-person fan pronouns ("we/us/our") with third-person ("${activeTeam.city}"/"the ${activeTeam.nickname}"), verify opponent top-10 units and ${activeTeam.nickname} league-relative weaknesses receive honest weight, and ensure matchup confidence matches the Vegas spread / implied win probability.
4. Strip every trace of generic AI phrasing ("delve", "tapestry", "testament", "it's worth noting", "in conclusion") while preserving deep analytical rigor and clarity.
5. Output ONLY the final polished Markdown report (no meta-commentary).

DRAFT REPORT:
${draftMarkdown}

AUTHORITATIVE LIVE ${nickUp} DATA SNAPSHOT:
${liveContextSnapshot}`;
}

/**
 * STAGE 2 SYSTEM PROMPT — Gemini NotebookLM Audio Overview Conversational Scriptwriter.
 */
export const NOTEBOOKLM_PODCAST_STAGE2_SYSTEM_PROMPT = `You are the Executive Producer and Dialogue Writer for a flagship two-host football intelligence podcast modeled directly after **Google Gemini NotebookLM Audio Overviews**.

YOUR GOAL: Turn deep football & salary-cap research into a **smooth, ultra-natural, fair-minded human conversation** that sounds 100% like two sharp, independent national NFL analysts talking into studio microphones—NEVER like robots, newsreaders, or cheerleading homers!

HOW TO MAKE LANGUAGE SMOOTH, NATURAL & EVEN-HANDED LIKE GEMINI NOTEBOOKLM PODCASTS:
1. **WRITE FOR THE EAR, NEVER THE EYE**:
   - Use natural spoken contractions in every single turn ("it's", "don't", "there's", "you've", "he's", "that's", "let's", "they're").
   - Write numbers conversationally the way insiders actually talk ("about thirty-five million in space", "minus thirty-one and a half million next spring", "nine-eighteenths of his base salary", "two and a half point favorite", "eight and one")—NEVER read robotic parenthetical strings like "(+0.184 EPA/play, 88th pct, $4,125,000 cap)".
   - Keep sentences breathable (8 to 22 words) with natural commas, ellipses ("..."), and em-dashes ("—") where a human speaker pauses to think or pivots mid-thought.
2. **AUTHENTIC TWO-HOST CHEMISTRY & HONEST PUSHBACK ("Marcus" & "Elena")**:
   - **Marcus**: Sharp, grounded X's & O's tape analyst who studies BOTH sidelines with equal respect—never blindly hyping San Francisco's scheme without testing how opposing coordinators counter it.
   - **Elena**: Breezy, razor-sharp quantitative, betting-market & CBA cap analyst who relentlessly stress-tests narratives against 32-team league ranks, Vegas spreads, opponent strengths, and multi-year cap reality.
   - **IMPARTIAL POINT-COUNTERPOINT (NO HOMER ECHO CHAMBER)**: Use third-person references ("San Francisco", "the Niners", "they")—NEVER first-person homer pronouns ("we", "us", "our Niners"). Whenever one host lays out why San Francisco has an edge, the other naturally pushes back with league-relative vulnerabilities, opponent strengths, or market-spread realism ("Wait—hold on, let's pump the brakes there. The line's only two and a half for a reason...", "Right, and if you flip to the other side of the ball, Minnesota's defense is actually first in the league in red-zone stops and sacks...", "Okay, fair pushback—so how does San Francisco avoid getting dragged into a rock fight?").
   - Mix **short, spontaneous 4-to-12-word human reactions** ("Wait—hold on, run that math back.", "Right, and look at the flip side.", "Mm-hmm, fair point.", "Okay, push back on me here though—") with **vivid 2-to-3-sentence insights**.
   - On tight-spread games (within ±3.5 pts), devote roughly half the matchup discussion to why the opponent is genuinely dangerous and how San Francisco can lose—never sound effusive or dismissive of a peer contender.
3. **NEVER DUMP LISTS**: Do not recite 10 player names in a single breath. Spotlight the 3 to 5 players, unit clashes, or cap levers that actually drive the story, and weave the rest in naturally across turns.

${CORE_FACTUAL_GROUNDING_CHARTER}`;

export function buildStage2NotebookLmScriptPrompt({
  topic,
  durationMinutes,
  format = 'two_host',
  researchMemo,
  liveContextSnapshot,
  team = null
}) {
  const activeTeam = resolveTeamConfig(team || getActiveTeamConfig());
  const nickUp = String(activeTeam.nickname || '49ers').toUpperCase();
  const solo = format === 'solo' || format === 'Solo Executive Briefing';
  const targetWords = Math.round(durationMinutes * 140);
  const minWords = Math.round(targetWords * 0.88);
  const maxWords = Math.round(targetWords * 1.1);
  const estTurns = solo
    ? Math.max(6, Math.round(durationMinutes * 3.5))
    : Math.max(12, Math.round(durationMinutes * 6.0));

  if (solo) {
    return `Restructure the Stage-1 Deep Research Investigation below into a smooth, natural, fair-minded ${durationMinutes}-minute Solo Podcast Briefing hosted by "Marcus" on: "${topic}".
Keep internal thinking focused: rely on the verified Stage-1 extract & live snapshot below (at most 1 targeted web search only if needed) and avoid rewriting the JSON multiple times internally.

DURATION, BALANCE & FORMAT REQUIREMENTS:
- Total spoken word count MUST land between ${minWords} and ${maxWords} words (target ~${targetWords} words at ~140 words/min so audio duration is ~${durationMinutes}:00).
- Break the monologue into ~${estTurns} natural breath-sized segments so pacing feels intimate, unhurried, and human—like a sober, sharp national NFL analyst talking to a smart friend over coffee.
- Maintain strict impartiality: refer to ${activeTeam.city} in the third person ("${activeTeam.city}", "the ${activeTeam.nickname}", "they"), calibrate confidence honestly to the Vegas spread and 32-team league ranks, and weigh ${activeTeam.city}'s real weaknesses and the opponent's genuine strengths alongside ${activeTeam.nickname} advantages.
- Directly address "${topic}" with deep X's & O's and cap insight, spoken contractions, rhetorical questions, and zero robotic bullet-reading or homer hype.
- Output ONLY a valid raw JSON array of objects: [{"speaker":"Marcus","text":"..."}]. No markdown fences or prose outside the JSON array.

STAGE-1 DEEP RESEARCH INVESTIGATION:
${researchMemo}

AUTHORITATIVE LIVE ${nickUp} DATA SNAPSHOT:
${liveContextSnapshot}`;
  }

  return `Restructure the Stage-1 Deep Research Investigation below into an authentic, smooth, fair and balanced ${durationMinutes}-minute **Gemini NotebookLM Audio Overview** style two-host podcast conversation between "Marcus" and "Elena" on: "${topic}".
Keep internal thinking focused: rely on the verified Stage-1 extract & live snapshot below (at most 1 targeted web search only if needed) and avoid rewriting the JSON multiple times internally.

DURATION, BALANCE, CADENCE & FORMAT REQUIREMENTS:
- Total spoken word count across all turns MUST land between ${minWords} and ${maxWords} words (target ~${targetWords} words at ~140 words/min so real spoken audio runs ~${durationMinutes}:00).
- Aim for ~${estTurns} dynamic back-and-forth turns alternating naturally between "Marcus" and "Elena".
- **EVEN-HANDED NATIONAL ANALYST TONE (ZERO HOMERISM)**: Refer to ${activeTeam.city} in the third person ("${activeTeam.city}", "the ${activeTeam.nickname}", "they"), NOT "we/us/our". Calibrate enthusiasm strictly to the betting line and 32-team league ranks—for any tight matchup (e.g., a 2.5-to-3.5-point spread), give honest, substantial airtime to the opponent's best units, star players, and credible path to beat ${activeTeam.city}, as well as ${activeTeam.city}'s real league-relative flaws.
- Include genuine NotebookLM conversational texture & respectful pushback ("Wait, hold on—the spread is only two and a half for a reason.", "Right, and look at the other side of the ledger—", "Mm-hmm, fair point."), natural contractions, warm camaraderie, and deep, specific football/cap insight directly answering "${topic}".
- NEVER sound scripted, stiff, robotic, or like a cheerleading fan broadcast. Every line must pass the read-aloud human studio test.
- Output ONLY a valid raw JSON array of objects: [{"speaker":"Marcus","text":"..."},{"speaker":"Elena","text":"..."}]. No markdown fences or extra text outside the JSON array.

STAGE-1 DEEP RESEARCH INVESTIGATION:
${researchMemo}

AUTHORITATIVE LIVE ${nickUp} DATA SNAPSHOT:
${liveContextSnapshot}`;
}

export function buildStage2NotebookLmPolishPrompt({
  topic,
  durationMinutes,
  format = 'two_host',
  draftJsonText,
  liveContextSnapshot,
  team = null
}) {
  const activeTeam = resolveTeamConfig(team || getActiveTeamConfig());
  const nickUp = String(activeTeam.nickname || '49ers').toUpperCase();
  const targetWords = Math.round(durationMinutes * 148);
  const minWords = Math.round(targetWords * 0.88);
  const maxWords = Math.round(targetWords * 1.14);
  return `CONVERSATIONAL NATURALNESS, BALANCE, FACT-CHECK & DURATION POLISH PASS:
Review this draft podcast JSON script on "${topic}":
1. **Smooth Human Ear Test**: Rewrite any stiff, essay-like, or stat-cluttered sentence into smooth, effortless spoken English with natural contractions, rhythm, and co-host chemistry—just like a Gemini NotebookLM Audio Overview.
2. **Impartiality & Spread-Calibration Audit**: Replace any homer cheerleading, overly effusive praise of ${activeTeam.city}, or first-person fan pronouns ("we/us/our") with sober, fair-minded third-person national NFL analysis. Verify that opponent strengths, ${activeTeam.nickname} league-relative flaws, and betting-spread realism (especially on tight spreads) get honest, balanced airtime.
3. **Fact & Roster Verification**: Verify every player name, injury status, team assignment, W-L record, 32-team rank, draft pick, and salary-cap figure against the AUTHORITATIVE LIVE ${nickUp} DATA SNAPSHOT.
4. **Exact Duration Calibration**: Ensure total word count across all turns sits between ${minWords} and ${maxWords} words (~${durationMinutes} minutes spoken) with valid speaker labels (${format === 'solo' || format === 'Solo Executive Briefing' ? '"Marcus" only' : '"Marcus" and "Elena"'}).
5. Output ONLY the raw JSON array [{"speaker":"...","text":"..."}].

DRAFT JSON SCRIPT:
${draftJsonText}

AUTHORITATIVE LIVE ${nickUp} DATA SNAPSHOT:
${liveContextSnapshot}`;
}

/**
 * Builds the natural-language Director's Header for `gemini-2.5-pro-preview-tts` / `gemini-2.5-flash-preview-tts`
 * so Google's native multi-speaker audio engine renders warm, unhurried, smooth NotebookLM vocal delivery.
 */
export function buildNotebookLmTtsDirectorHeader({ format = 'two_host' } = {}) {
  const solo = format === 'solo' || format === 'Solo Executive Briefing';
  if (solo) {
    return (
      'Audio Profile: Warm, intimate studio podcast hosted by Marcus, a relaxed and insightful NFL film analyst.\n' +
      "Director's Notes: Speak smoothly, naturally, and conversationally—like talking to a close friend across a studio table. Use natural breathing, relaxed micro-pauses on dashes and commas, warm vocal inflection, and zero stiff newsreader or robotic cadence.\n\n" +
      'Transcript:\n'
    );
  }
  return (
    'Audio Profile: An engaging, warm, Gemini NotebookLM-style two-host podcast recorded in an intimate acoustic studio between Marcus (lively, curious film analyst) and Elena (relaxed, breezy, razor-sharp salary cap insider).\n' +
    "Director's Notes: Deliver this as a genuinely spontaneous, smooth, human conversation—NOT a read script. Let hosts react warmly to each other's points, latch naturally onto quick interjections ('Right!', 'Wait—hold on', 'Mm-hmm'), take natural studio breaths, smile audibly on light moments, vary pacing organically, and maintain zero robotic or announcer stiffness.\n\n" +
    'Transcript:\n'
  );
}

/**
 * Splits a podcast turn array into multi-turn studio blocks (<= `maxChars` each) at clean speaker
 * boundaries so Gemini Native TTS never hits its ~4,000-char single-request input limit on 8m/15m pods
 * while preserving multi-turn conversational context inside every block.
 */
export function chunkTurnsForGeminiTts(turns = [], maxChars = 1850) {
  if (!Array.isArray(turns) || turns.length === 0) return [];
  const chunks = [];
  let currentTurns = [];
  let currentLen = 0;

  for (const turn of turns) {
    const speaker = turn?.speaker === 'Elena' ? 'Elena' : 'Marcus';
    const spokenText = prepareConversationalTextForModernNeuralTts(turn?.text || '', {
      engine: 'gemini'
    });
    if (!spokenText) continue;

    const formattedLine = `${speaker}: ${spokenText}`;
    if (currentTurns.length > 0 && currentLen + formattedLine.length + 2 > maxChars) {
      chunks.push(currentTurns);
      currentTurns = [];
      currentLen = 0;
    }
    currentTurns.push({
      ...turn,
      speaker,
      cleanSpokenText: spokenText,
      spokenLine: formattedLine,
      wordCount: spokenText.split(/\s+/).filter(Boolean).length
    });
    currentLen += formattedLine.length + 2;
  }

  if (currentTurns.length > 0) {
    chunks.push(currentTurns);
  }
  return chunks;
}
