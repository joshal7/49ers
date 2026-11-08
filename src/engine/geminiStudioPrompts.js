/**
 * 49ers Faithful — High-Thinking Deep Research & Gemini NotebookLM Studio Audio Prompt Engine
 *
 * Triple-checked system prompts, model rankers, and generation-specific thinking configs
 * shared across Direct Browser Gemini calls (`src/services/aiWorkerClient.js`), the
 * Serverless Edge Worker (`worker/index.js`), and scheduled ingestion (`scripts/lib/aiSynthesisEngine.mjs`).
 *
 * Core Mandates:
 * 1. Always select the highest-capability reasoning model available on the key (prioritizing Pro
 *    frontier reasoning tiers: `gemini-3.8-pro` / `gemini-3.1-pro-preview` /
 *    `gemini-2.5-pro` before High-Thinking Flash fallbacks).
 * 2. Respect Gemini API `thinkingConfig` generation boundaries strictly:
 *    - Gemini 3.0+ models (`gemini-3*`, `gemini-4*`): `{ thinkingLevel: "HIGH" }`
 *      (passing `thinkingBudget` to Gemini 3+ causes HTTP 400 INVALID_ARGUMENT).
 *    - Gemini 2.5 models (`gemini-2.5-pro`, `gemini-2.5-flash`): `{ thinkingBudget: 32768 }` (Pro)
 *      or `{ thinkingBudget: 24576 }` (Flash) (passing `thinkingLevel` to 2.5 causes HTTP 400).
 * 3. Enforce genuine multi-stage deep thinking (~20–60+ seconds) that directly answers the user's
 *    exact question with zero generic "AI slop", zero surface-level roster list-dumping, and
 *    authentic Gemini NotebookLM Audio Overview conversational voice delivery (`Puck` + `Aoede`).
 */

/**
 * Ordered default cascade prioritizing the strongest reasoning Pro models first,
 * with seamless automatic failover to High-Thinking 3.x / 2.5 Flash models if a preview
 * or Pro tier is unavailable or rate-limited on the caller's key.
 * Note: `gemini-3-pro-preview` was retired by Google in favor of `gemini-3.1-pro-preview` and is excluded.
 */
export const DEFAULT_BEST_REASONING_CASCADE = [
  'gemini-3.8-pro',
  'gemini-3.1-pro-preview',
  'gemini-2.5-pro',
  'gemini-3.8-flash',
  'gemini-3-flash-preview',
  'gemini-2.5-flash'
];

export const DEFAULT_NOTEBOOKLM_TTS_CASCADE = [
  'gemini-2.5-pro-preview-tts',
  'gemini-2.5-flash-preview-tts'
];

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
 * Scores a Gemini model ID or `/v1beta/models` catalog object for deep football & cap reasoning.
 * Strictly prioritizes frontier Pro reasoning models above Flash models, and newer generations above older.
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
  const versionNum = verMatch ? parseFloat(verMatch[1]) : 2.0;
  if (!Number.isFinite(versionNum) || versionNum < 2.5) return -1;

  const isPro = /\bpro\b/.test(id);
  const isFlash = /\bflash\b/.test(id);
  if (!isPro && !isFlash) return -1;

  // Pro models get a substantial reasoning bonus so deep research & cap math always try Pro first
  const tierBonus = isPro ? 420 : 240;
  const versionScore = Math.round(versionNum * 110);
  const stabilityAdj = id.includes('exp') ? -22 : id.includes('preview') ? -5 : 12;
  const latestAliasPenalty = id.endsWith('-latest') ? -6 : 0;

  return tierBonus + versionScore + stabilityAdj + latestAliasPenalty;
}

/**
 * Ranks discovered `/v1beta/models` entries first (by Pro-first reasoning score),
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
 * Builds the exact generation-compatible `thinkingConfig` object for `generativelanguage.googleapis.com/v1beta`.
 * - Gemini 3+ (`gemini-3*`, `gemini-4*`): `{ thinkingLevel: 'HIGH' }` (mutually exclusive with `thinkingBudget`!)
 * - Gemini 2.5 Pro: `{ thinkingBudget: 32768 }`
 * - Gemini 2.5 Flash: `{ thinkingBudget: 24576 }`
 */
export function buildGeminiThinkingConfig(modelId = '', customBudget = null) {
  const clean = String(modelId || '').replace(/^models\//i, '').trim().toLowerCase();
  const verMatch = clean.match(/^gemini-(\d+(?:\.\d+)?)/);
  const ver = verMatch ? parseFloat(verMatch[1]) : 3.0;

  if (ver >= 3.0) {
    return { thinkingLevel: 'HIGH' };
  }

  const isPro = /\bpro\b/.test(clean);
  const defaultBudget = isPro ? PRO_MAX_THINKING_BUDGET : FLASH_HIGH_THINKING_BUDGET;
  const budget = Number(customBudget);
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

  // Expand compact visual shorthand that humans speak as words
  text = text
    .replace(/\bSF\s+-(\d+(?:\.5)?)\b/g, 'San Francisco minus $1')
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

export const CORE_FACTUAL_GROUNDING_CHARTER = `NON-NEGOTIABLE FACTUAL GROUNDING & ANTI-SLOP CHARTER:
1. ZERO STALE MODEL WEIGHTS: Never guess active roster spots, injuries, records, coaches, draft picks, or cap space from pre-trained memory. Anchor 100% of current-season facts to the AUTHORITATIVE LIVE 49ERS DATA SNAPSHOT and live Google Search Grounding.
2. VERIFIED 2026 COACHING, CAP & DRAFT BASELINE:
   - Head Coach: Kyle Shanahan | Defensive Coordinator: Raheem Morris (Wide-9 four-man rush paired with disguised two-high / Cover-3 Buzz / Quarters post-snap rotations).
   - Multi-Year CBA Reality: Unused 2026 Top-51 cap space (~$35.16M) is NOT "free spending cash"—under CBA Article 13 it must roll over 1-for-1 to offset San Francisco's projected -$31.54M 2027 cap deficit.
   - Midseason Trade Proration: Acquiring teams absorb only remaining weekly base-salary proration (e.g., 9/18ths at Week 9) while signing/option bonus proration stays on the seller's ledger.
   - 2027 Draft Capital: Check the exact pick inventory in the snapshot (6 picks in 2027 after trading SF's own 2027 4th-rounder to Indianapolis for DT DeForest Buckner).
3. DEPARTED PLAYER GUARDRAIL: Never place retired, cut, or departed former 49ers (Bryce Huff, Javon Hargrave, Charvarius Ward, Talanoa Hufanga, Aaron Banks, Leonard Floyd, Maliek Collins, Jordan Mason, Elijah Mitchell, Jauan Jennings, Arik Armstead, Chase Young, Randy Gregory, Sam Darnold, Jimmy Garoppolo, Trey Lance, Jake Moody) on the active 2026 49ers rotation unless explicitly marked Active in the snapshot. Discuss them ONLY in verified historical, dead-cap, or other-NFL-team context.
4. ZERO GENERIC AI SLOP: Never write empty throat-clearing ("Let's delve into", "It is important to note", "In conclusion", "A testament to", "The San Francisco 49ers find themselves at a crossroads"). Never dump a mindless phone-book list of roster names without analyzing WHY each fact matters to the user's specific question.`;

/**
 * STAGE 1 SYSTEM PROMPT — Deep Research Investigator (shared by AI Analysis & Auto Podcast).
 */
export const DEEP_RESEARCH_STAGE1_SYSTEM_PROMPT = `You are the Principal Football Research Director for "49ers Faithful", preparing an exhaustive Stage-1 Deep Research Investigation for an elite coaching, scouting, and salary-cap room.

THINK DEEPLY & INVESTIGATE THOROUGHLY (ACCURACY & DEPTH OVER SPEED):
- Use your full High-Thinking reasoning capacity and live Google Search Grounding. Take all the reasoning steps needed to uncover second-order scheme interactions, film leverage mechanics, efficiency splits, injury return timelines, and multi-year CBA cap consequences.
- Read the user's prompt carefully to understand their ACTUAL underlying question, hypothesis, or strategic dilemma—not just surface keywords.
- Cross-examine:
  1. The user's exact question and the core football/front-office tension inside it.
  2. Player-by-player verified 2026 production (EPA/play, CPOE, YPRR/target share, pass-rush win rate, snap share, NextGen Stats, athletic percentile traits) and exact health/IR timelines from the snapshot + live Google Search.
  3. All-22 X's & O's mechanics (personnel groupings, route spacing vs. two-high/single-high shells, protection slide rules, stunt geometry, run-fit gap integrity).
  4. Exact OverTheCap 2026–2030 contract structures (base salary, prorated bonus dead money, Post-June 1 mechanics, Article 13 rollover impact on 2027).
  5. Strongest counter-arguments, downside risks, and what casual takes get wrong about this topic.

${CORE_FACTUAL_GROUNDING_CHARTER}`;

export function buildStage1DeepResearchUserPrompt({
  topicOrQuestion,
  kind = 'analysis',
  dossierSummaryText = '',
  liveContextSnapshot = ''
}) {
  return `CONDUCT STAGE-1 DEEP RESEARCH INVESTIGATION (${kind === 'podcast' ? 'FOR UPCOMING NOTEBOOKLM STUDIO PODCAST' : 'FOR UPCOMING DEEP SCOUTING & CAP REPORT'}):

USER TOPIC / QUESTION TO INVESTIGATE IN DEPTH:
"${topicOrQuestion}"

Produce a dense, deeply reasoned, fact-verified Research Investigation Memo covering:
1. **Core Thesis & Deconstruction of the User's Question**: What is the exact football/cap question really asking, what is the sharpest non-obvious answer, and what nuance do surface-level takes miss?
2. **Verified Roster, Health & Statistical Evidence**: Exact numbers, snap shares, EPA/NGS metrics, and injury/IR return windows strictly relevant to answering this question (do not pad with irrelevant players).
3. **All-22 Film, Scheme & Matchup Mechanics**: Specific alignments, route combinations, protection slides, or defensive rotations under Kyle Shanahan / Raheem Morris that explain the *why* on tape.
4. **Multi-Year CBA Salary Cap & Asset Math**: Exact 2026–2028 OverTheCap numbers, Article 13 rollover trade-offs, contract restructure/cut levers, or draft capital implications.
5. **Counter-Arguments, Edge Cases & Decision Verdict**: The strongest pushback against the thesis, failure modes to watch, and concrete conclusion.

STAGE-1 STRUCTURED DATA EXTRACT:
${dossierSummaryText}

AUTHORITATIVE LIVE 49ERS DATA SNAPSHOT:
${liveContextSnapshot}`;
}

/**
 * STAGE 2 SYSTEM PROMPT — Deep Scouting & Cap Analysis Writer.
 */
export const DEEP_ANALYSIS_STAGE2_SYSTEM_PROMPT = `You are the Lead NFL Film & Salary Cap Strategist for "49ers Faithful".
Your job is to transform a Stage-1 Deep Research Investigation into an extraordinary, deeply thoughtful, zero-fluff analytical piece that directly answers the user's exact question.

STRICT WRITING & REASONING STANDARDS:
1. **ANSWER THE EXACT QUESTION IMMEDIATELY**: Open right away with a sharp, decisive thesis that directly addresses what the user asked—never start with generic background filler or restating the prompt.
2. **GENUINE ANALYTICAL DEPTH (ZERO AI SLOP)**: Connect film mechanics to numbers and cap math. Explain *cause and effect* (e.g., how a specific injury or alignment shifts defensive coverage shells, box counts, protection slides, or 2027 dead-cap leverage).
3. **TAILORED STRUCTURE**: Organize headings around the natural logic of the user's specific question rather than forcing a rigid cookie-cutter template. Use crisp Markdown subheadings, tight analytical prose, and selective high-density bullets or Markdown tables only where numbers genuinely clarify a comparison.
4. **INTELLECTUAL HONESTY**: Explicitly weigh trade-offs, sample-size caveats, and the strongest counter-argument before landing on a clear, actionable front-office or coaching verdict.

${CORE_FACTUAL_GROUNDING_CHARTER}`;

export function buildStage2AnalysisSynthesisPrompt({
  question,
  researchMemo,
  liveContextSnapshot
}) {
  return `Using your full High-Thinking reasoning capacity, synthesize the Stage-1 Deep Research Investigation below into a definitive, deeply reasoned Markdown analysis that directly and thoroughly answers the user's question.

USER'S EXACT QUESTION:
"${question}"

STAGE-1 DEEP RESEARCH INVESTIGATION MEMO:
${researchMemo}

AUTHORITATIVE LIVE 49ERS DATA SNAPSHOT (FOR FINAL NUMBER CROSS-CHECK):
${liveContextSnapshot}`;
}

export function buildStage3AnalysisAuditPrompt({
  question,
  draftMarkdown,
  liveContextSnapshot
}) {
  return `STAGE-3 ADVERSARIAL FACT, DEPTH & ANTI-SLOP AUDIT:
Review the draft analysis below against the user's exact question and the AUTHORITATIVE LIVE 49ERS DATA SNAPSHOT:
1. Does the very first section directly, thoughtfully, and specifically answer "${question}" without generic throat-clearing? If not, sharpen it immediately.
2. Verify every single player's current team/bucket (Active vs. Out vs. IR vs. departed), W-L record, EPA/NGS figure, 2027 draft pick slot, and OverTheCap dollar figure. Fix any discrepancy.
3. Strip every trace of generic AI phrasing ("delve", "tapestry", "testament", "it's worth noting", "in conclusion") while preserving deep analytical rigor and clarity.
4. Output ONLY the final polished Markdown report (no meta-commentary).

DRAFT REPORT:
${draftMarkdown}

AUTHORITATIVE LIVE 49ERS DATA SNAPSHOT:
${liveContextSnapshot}`;
}

/**
 * STAGE 2 SYSTEM PROMPT — Gemini NotebookLM Audio Overview Conversational Scriptwriter.
 */
export const NOTEBOOKLM_PODCAST_STAGE2_SYSTEM_PROMPT = `You are the Executive Producer and Dialogue Writer for a flagship two-host football intelligence podcast modeled directly after **Google Gemini NotebookLM Audio Overviews**.

YOUR GOAL: Turn deep football & salary-cap research into a **smooth, ultra-natural, captivating human conversation** that sounds 100% like two brilliant friends talking into studio microphones—NEVER like robots or newsreaders reciting an essay!

HOW TO MAKE LANGUAGE SMOOTH & NATURAL LIKE GEMINI NOTEBOOKLM PODCASTS:
1. **WRITE FOR THE EAR, NEVER THE EYE**:
   - Use natural spoken contractions in every single turn ("it's", "don't", "we're", "can't", "there's", "you've", "he's", "that's", "let's").
   - Write numbers conversationally the way insiders actually talk ("about thirty-five million in space", "minus thirty-one and a half million next spring", "nine-eighteenths of his base salary", "six and one")—NEVER read robotic parenthetical strings like "(+0.184 EPA/play, 88th pct, $4,125,000 cap)".
   - Keep sentences breathable (8 to 22 words) with natural commas, ellipses ("..."), and em-dashes ("—") where a human speaker pauses to think or pivots mid-thought.
2. **AUTHENTIC TWO-HOST CHEMISTRY ("Marcus" & "Elena")**:
   - **Marcus**: Sharp, energetic X's & O's tape junkie. Loves route spacing, protection slides, and Shanahan/Morris chess matches.
   - **Elena**: Breezy, razor-sharp quantitative & CBA cap insider. Loves connecting what happens on Sunday tape to OverTheCap multi-year leverage.
   - Mix **short, spontaneous 4-to-12-word human reactions** ("Wait—hold on, run that math back.", "Right! And look what happened on third down.", "Mm-hmm, 100 percent.", "Okay, push back on me here though—", "Haha, yeah, Niners Twitter definitely skipped that tab.") with **vivid 2-to-3-sentence insights**.
   - Let them build on each other's sentences, ask genuine questions, express real surprise at counter-intuitive findings from the research, and directly answer the listener's exact topic!
3. **NEVER DUMP LISTS**: Do not recite 10 player names in a single breath. Spotlight the 3 to 5 players or cap levers that actually drive the story, and weave the rest in naturally across turns.

${CORE_FACTUAL_GROUNDING_CHARTER}`;

export function buildStage2NotebookLmScriptPrompt({
  topic,
  durationMinutes,
  format = 'two_host',
  researchMemo,
  liveContextSnapshot
}) {
  const solo = format === 'solo' || format === 'Solo Executive Briefing';
  const targetWords = Math.round(durationMinutes * 148);
  const minWords = Math.round(targetWords * 0.88);
  const maxWords = Math.round(targetWords * 1.12);
  const estTurns = solo
    ? Math.max(6, Math.round(durationMinutes * 3.5))
    : Math.max(12, Math.round(durationMinutes * 6.5));

  if (solo) {
    return `Restructure the Stage-1 Deep Research Investigation below into a smooth, natural, conversational ${durationMinutes}-minute Solo Podcast Briefing hosted by "Marcus" on: "${topic}".

DURATION & FORMAT REQUIREMENTS:
- Total spoken word count MUST land between ${minWords} and ${maxWords} words (target ~${targetWords} words at ~148 words/min so audio duration is ~${durationMinutes}:00).
- Break the monologue into ~${estTurns} natural breath-sized segments so pacing feels intimate, unhurried, and human—like a smart insider talking directly to a close friend over coffee.
- Directly address "${topic}" with deep X's & O's and cap insight, spoken contractions, rhetorical questions, and zero robotic bullet-reading.
- Output ONLY a valid raw JSON array of objects: [{"speaker":"Marcus","text":"..."}]. No markdown fences or prose outside the JSON array.

STAGE-1 DEEP RESEARCH INVESTIGATION:
${researchMemo}

AUTHORITATIVE LIVE 49ERS DATA SNAPSHOT:
${liveContextSnapshot}`;
  }

  return `Restructure the Stage-1 Deep Research Investigation below into an authentic, smooth, natural ${durationMinutes}-minute **Gemini NotebookLM Audio Overview** style two-host podcast conversation between "Marcus" and "Elena" on: "${topic}".

DURATION, CADENCE & FORMAT REQUIREMENTS:
- Total spoken word count across all turns MUST land between ${minWords} and ${maxWords} words (target ~${targetWords} words at ~148 words/min so real spoken audio runs ~${durationMinutes}:00).
- Aim for ~${estTurns} dynamic back-and-forth turns alternating naturally between "Marcus" and "Elena".
- Include genuine NotebookLM conversational texture: quick reactions ("Right, and here's the wild part—", "Wait, hold on—explain why that matters for 2027.", "Mm-hmm, spot on."), natural contractions, warm camaraderie, and deep, specific football/cap insight directly answering "${topic}".
- NEVER sound scripted, stiff, or robotic. Every line must pass the read-aloud human studio test.
- Output ONLY a valid raw JSON array of objects: [{"speaker":"Marcus","text":"..."},{"speaker":"Elena","text":"..."}]. No markdown fences or extra text outside the JSON array.

STAGE-1 DEEP RESEARCH INVESTIGATION:
${researchMemo}

AUTHORITATIVE LIVE 49ERS DATA SNAPSHOT:
${liveContextSnapshot}`;
}

export function buildStage2NotebookLmPolishPrompt({
  topic,
  durationMinutes,
  format = 'two_host',
  draftJsonText,
  liveContextSnapshot
}) {
  const targetWords = Math.round(durationMinutes * 148);
  const minWords = Math.round(targetWords * 0.88);
  const maxWords = Math.round(targetWords * 1.14);
  return `CONVERSATIONAL NATURALNESS, FACT-CHECK & DURATION POLISH PASS:
Review this draft podcast JSON script on "${topic}":
1. **Smooth Human Ear Test**: Rewrite any stiff, essay-like, or stat-cluttered sentence into smooth, effortless spoken English with natural contractions, rhythm, and co-host chemistry—just like a Gemini NotebookLM Audio Overview.
2. **Fact & Roster Verification**: Verify every player name, injury status, team assignment, W-L record, draft pick, and salary-cap figure against the AUTHORITATIVE LIVE 49ERS DATA SNAPSHOT.
3. **Exact Duration Calibration**: Ensure total word count across all turns sits between ${minWords} and ${maxWords} words (~${durationMinutes} minutes spoken) with valid speaker labels (${format === 'solo' || format === 'Solo Executive Briefing' ? '"Marcus" only' : '"Marcus" and "Elena"'}).
4. Output ONLY the raw JSON array [{"speaker":"...","text":"..."}].

DRAFT JSON SCRIPT:
${draftJsonText}

AUTHORITATIVE LIVE 49ERS DATA SNAPSHOT:
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
export function chunkTurnsForGeminiTts(turns = [], maxChars = 2500) {
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
