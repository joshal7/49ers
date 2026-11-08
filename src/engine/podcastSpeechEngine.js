/**
 * Natural Podcast Speech, Prosody & Broadcast Audio Mastering Engine
 *
 * Bridges written NFL analytics / CBA cap notation and natural human spoken English:
 * 1. Converts football records ("6-1" -> "6 and 1"), spreads/totals ("SF -9.5" -> "San Francisco minus 9 and a half"),
 *    fractions ("9/18ths" -> "nine eighteenths"), compact cap figures ("-$31.54M"), schemes ("Wide-9", "21-personnel"),
 *    and difficult NFL names into crisp, natural spoken phrasing while leaving visual UI transcripts clean.
 * 2. Computes context-aware conversational turn timing (quick latches on reactions vs. thoughtful beats after questions)
 *    and subtle per-turn prosody micro-variations to eliminate flat TTS metronome cadence.
 * 3. Ranks browser Web Speech API voices to select Premium / Enhanced / Natural neural voices and block legacy
 *    robotic formant voices (e.g., MacinTalk Fred/Albert).
 * 4. Applies a studio broadcast DSP chain (silence trimming to natural breath cushions, cosine fades,
 *    75 Hz rumble high-pass, 175 Hz broadcast warmth EQ, 3.85 kHz neural de-harshness dip, per-turn loudness
 *    matching, soft-knee studio compression, subtle room tone glue, and -1 dBFS true-peak limiting).
 */

const NFL_ABBR_SPOKEN = {
  SF: 'San Francisco',
  LV: 'Las Vegas',
  KC: 'Kansas City',
  MIN: 'Minnesota',
  CHI: 'Chicago',
  DET: 'Detroit',
  GB: 'Green Bay',
  SEA: 'Seattle',
  LAR: 'the Rams',
  ARI: 'Arizona',
  DAL: 'Dallas',
  PHI: 'Philadelphia',
  WAS: 'Washington',
  NYG: 'the Giants',
  NYJ: 'the Jets',
  BUF: 'Buffalo',
  MIA: 'Miami',
  NE: 'New England',
  BAL: 'Baltimore',
  CIN: 'Cincinnati',
  CLE: 'Cleveland',
  PIT: 'Pittsburgh',
  HOU: 'Houston',
  IND: 'Indianapolis',
  JAX: 'Jacksonville',
  TEN: 'Tennessee',
  DEN: 'Denver',
  LAC: 'the Chargers',
  NO: 'New Orleans',
  TB: 'Tampa Bay',
  ATL: 'Atlanta',
  CAR: 'Carolina'
};

const SMALL_NUMBER_WORDS = {
  0: 'zero',
  1: 'one',
  2: 'two',
  3: 'three',
  4: 'four',
  5: 'five',
  6: 'six',
  7: 'seven',
  8: 'eight',
  9: 'nine',
  10: 'ten',
  11: 'eleven',
  12: 'twelve',
  13: 'thirteen',
  14: 'fourteen',
  15: 'fifteen',
  16: 'sixteen',
  17: 'seventeen',
  18: 'eighteen',
  19: 'nineteen',
  20: 'twenty',
  21: 'twenty-one',
  22: 'twenty-two',
  23: 'twenty-three',
  24: 'twenty-four',
  25: 'twenty-five',
  26: 'twenty-six',
  27: 'twenty-seven',
  28: 'twenty-eight',
  29: 'twenty-nine',
  30: 'thirty',
  31: 'thirty-one',
  32: 'thirty-two',
  33: 'thirty-three',
  34: 'thirty-four',
  35: 'thirty-five',
  40: 'forty',
  45: 'forty-five',
  50: 'fifty',
  51: 'fifty-one',
  52: 'fifty-two',
  53: 'fifty-three'
};

function intToSpoken(n) {
  const num = Number(n);
  if (SMALL_NUMBER_WORDS[num]) return SMALL_NUMBER_WORDS[num];
  if (num > 30 && num < 60) {
    const tens = Math.floor(num / 10) * 10;
    const ones = num % 10;
    if (SMALL_NUMBER_WORDS[tens] && SMALL_NUMBER_WORDS[ones]) {
      return `${SMALL_NUMBER_WORDS[tens]}-${SMALL_NUMBER_WORDS[ones]}`;
    }
  }
  return String(n);
}

function formatHalfPointSpoken(numStr) {
  const clean = String(numStr).trim();
  const m = clean.match(/^(\d+)\.(0|5)$/);
  if (!m) return clean;
  const whole = intToSpoken(Number(m[1]));
  if (m[2] === '0') return whole;
  return Number(m[1]) === 0 ? 'a half' : `${whole} and a half`;
}

/**
 * Converts written NFL, analytics, and salary-cap prose into natural spoken English
 * tailored for neural TTS and Web Speech synthesis.
 */
export function humanizeNflTextForTts(rawText = '') {
  if (!rawText) return '';
  let text = String(rawText);

  // 1. Clean visual-only parenthetical stat badges like "(1st in NFC West • #1 Seed in NFC)"
  text = text.replace(/\(([^()]*•[^()]*)\)/g, (_, inner) => {
    const cleanedInner = inner.replace(/\s*•\s*/g, ', and ').trim();
    return `, ${cleanedInner}, `;
  });
  text = text.replace(/\s*•\s*/g, ', ');

  // 2. Implied scores & team spreads: "SF 30.5 – LV 21.0", "SF 30.5 to LV 21.0", "SF -9.5"
  text = text.replace(
    /\b([A-Z]{2,3})\s+(\d+(?:\.\d+)?)\s*(?:[–—-]|to)\s*([A-Z]{2,3})\s+(\d+(?:\.\d+)?)\b/g,
    (full, t1, s1, t2, s2) => {
      const name1 = NFL_ABBR_SPOKEN[t1] || t1;
      const name2 = NFL_ABBR_SPOKEN[t2] || t2;
      return `${name1} ${formatHalfPointSpoken(s1)} to ${name2} ${formatHalfPointSpoken(s2)}`;
    }
  );

  text = text.replace(/\b([A-Z]{2,3})\s+-(\d+(?:\.5|\.0)?)\b/g, (full, abbr, line) => {
    const team = NFL_ABBR_SPOKEN[abbr];
    if (!team) return full;
    return `${team} minus ${formatHalfPointSpoken(line)}`;
  });

  text = text.replace(/\bminus\s+(\d+\.5)\b/gi, (_, line) => `minus ${formatHalfPointSpoken(line)}`);
  text = text.replace(/\b(\d+\.5)\s+total\b/gi, (_, tot) => `${formatHalfPointSpoken(tot)} total`);
  text = text.replace(/\bO\/U\s*(\d+(?:\.5|\.0)?)\b/gi, (_, tot) => `over under ${formatHalfPointSpoken(tot)}`);

  // 3. Compact dollar & cap figures: "-$31.54M", "+$3.62M", "$35.16M", "~$0.79M", "$65M+"
  text = text.replace(
    /([~+-]?)\$(\d+(?:\.\d+)?)\s*M(\+?)/gi,
    (_, prefix, numStr, plusSuffix) => {
      const val = parseFloat(numStr);
      const lead =
        prefix === '-'
          ? 'minus '
          : prefix === '+'
            ? 'plus '
            : prefix === '~'
              ? 'roughly '
              : plusSuffix === '+'
                ? 'over '
                : '';
      if (val > 0 && val < 1) {
        const thousands = Math.round(val * 1000);
        return `${lead}${thousands} thousand dollars`;
      }
      const cleanNum = numStr.replace(/\.0+$/, '');
      return `${lead}${cleanNum} million dollars`;
    }
  );

  // 4. CBA Fractions & Post-June-1 notation
  text = text
    .replace(/\b9\/18ths\b/gi, 'nine eighteenths')
    .replace(/\b1\/18th\b/gi, 'one eighteenth')
    .replace(/\b(\d+)\/18ths\b/gi, (_, n) => `${intToSpoken(Number(n))} eighteenths`)
    .replace(/\bPost-June[- ]1\b/gi, 'Post June first')
    .replace(/\bPost-6\/1\b/gi, 'Post June first')
    .replace(/\b50\/50\b/g, 'fifty-fifty');

  // 5. Football scheme & personnel hyphenations (before W-L record matching!)
  text = text
    .replace(/\bWide-9\b/gi, 'Wide nine')
    .replace(/\bCover-(\d)\b/gi, (_, n) => `Cover ${intToSpoken(Number(n))}`)
    .replace(/\bDay-([123])\b/gi, (_, n) => `Day ${intToSpoken(Number(n))}`)
    .replace(/\b([123])-technique\b/gi, (_, n) => `${intToSpoken(Number(n))} technique`)
    .replace(/\b([123])-tech\b/gi, (_, n) => `${intToSpoken(Number(n))} tech`)
    .replace(/\b(11|12|13|21|22)[- ]personnel\b/gi, (_, p) => `${intToSpoken(Number(p))} personnel`)
    .replace(/\bAll-22\b/gi, 'All twenty-two')
    .replace(/\bTop-51\b/gi, 'Top fifty-one')
    .replace(/\b53-man\b/gi, 'fifty-three man')
    .replace(/\b(\d{2})-snap\b/gi, (_, s) => `${intToSpoken(Number(s))} snap`)
    .replace(/\b2i\b/g, 'two-eye')
    .replace(/\bT-E\s+stunt/gi, 'T E stunt');

  // 6. Win-Loss(-Tie) records in football context: "6-1 Niners", "4-4 Las Vegas", "at 6-1", "0-7 Chargers"
  text = text.replace(
    /\b(\d{1,2})-(\d{1,2})(?:-(\d))?\b(?=\s+(?:49ers|Niners|San Francisco|Raiders|Las Vegas|Vikings|Minnesota|Bears|Chicago|Lions|Detroit|Packers|Seahawks|Rams|Cardinals|Cowboys|Eagles|Commanders|Chargers|Chiefs|Ravens|Jets|Colts|Dolphins|Falcons|Saints|record|start|team|club|mark)\b)/gi,
    (_, w, l, t) =>
      t !== undefined
        ? `${intToSpoken(Number(w))}, ${intToSpoken(Number(l))}, and ${intToSpoken(Number(t))}`
        : `${intToSpoken(Number(w))} and ${intToSpoken(Number(l))}`
  );
  text = text.replace(
    /\b(sits at|sitting at|enter at|entering at|currently|improved to|fell to|start|record of)\s+(\d{1,2})-(\d{1,2})\b/gi,
    (_, verb, w, l) => `${verb} ${intToSpoken(Number(w))} and ${intToSpoken(Number(l))}`
  );

  // 7. Hash seeds, draft picks, abbreviations & football initialisms
  text = text
    .replace(/#1\b/g, 'number one')
    .replace(/#(\d{1,3})\b/g, 'number $1')
    .replace(/\bRd\s+(\d)\b/gi, (_, r) => `round ${intToSpoken(Number(r))}`)
    .replace(/\bvs\.\s*/gi, 'versus ')
    .replace(/\be\.g\.,?\s*/gi, 'for example, ')
    .replace(/\bi\.e\.,?\s*/gi, 'that is, ')
    .replace(/\bEPA\/play\b/gi, 'E-P-A per play')
    .replace(/\bEPA\b/g, 'E-P-A')
    .replace(/\bCPOE\b/g, 'C-P-O-E')
    .replace(/\bRYOE\b/g, 'R-Y-O-E')
    .replace(/\bYPRR\b/g, 'yards per route run')
    .replace(/\bPBWR\b/g, 'pass block win rate')
    .replace(/\bRSWR\b/g, 'run stop win rate')
    .replace(/\bWOPR\b/g, 'W-O-P-R')
    .replace(/\bADOT\b/gi, 'average depth of target')
    .replace(/\bSOV\b/g, 'strength of victory')
    .replace(/\bSOS\b/g, 'strength of schedule')
    .replace(/\bYPA\b/g, 'yards per attempt')
    .replace(/\bQB1\b/g, 'Q-B-1')
    .replace(/\bWR1\b/g, 'W-R-1')
    .replace(/\bCB1\b/g, 'C-B-1')
    .replace(/\bH2H\b/gi, 'head-to-head')
    .replace(/\bCBA\b/g, 'C-B-A')
    .replace(/\bNFC\b/g, 'N-F-C')
    .replace(/\bAFC\b/g, 'A-F-C')
    .replace(/\bNFLPA\b/g, 'N-F-L-P-A')
    .replace(/\bNFL\b/g, 'N-F-L')
    .replace(/\bIR\b/g, 'I-R')
    .replace(/\bPUP\b/g, 'P-U-P')
    .replace(/\bUDFA\b/g, 'U-D-F-A')
    .replace(/\bDNP\b/g, 'D-N-P')
    .replace(/\bGTD\b/g, 'game-time decision')
    .replace(/\bSAP\s+Performance/g, 'S-A-P Performance')
    .replace(/\bFOX\b/g, 'Fox');

  // 8. Phonetic NFL player, coach & front-office pronunciations
  text = text
    .replace(/\bRaheem\b/gi, 'Rah-heem')
    .replace(/\bSuamataia\b/gi, 'Soo-ah-mah-tye-ah')
    .replace(/\bDulcich\b/gi, 'Dull-sitch')
    .replace(/\bAdonai\b/gi, 'Ad-oh-nye')
    .replace(/\bOdighizuwa\b/gi, 'Oh-diggy-zoo-wah')
    .replace(/\bJuszczyk\b/gi, 'Yooz-check')
    .replace(/\bAiyuk\b/gi, 'Eye-yook')
    .replace(/\bDe['’]Zhaun\b/gi, 'Day-zhon')
    .replace(/\bDeommodore\b/gi, 'Dee-ah-muh-dor')
    .replace(/\bLenoir\b/gi, 'Luh-nor')
    .replace(/\bHufanga\b/gi, 'Hoo-fahng-guh')
    .replace(/\bParaag Marathe\b/gi, 'Puh-rahg Muh-rah-thee')
    .replace(/\bPuni\b/gi, 'Poo-nee')
    .replace(/\bMustapha\b/gi, 'Moo-stah-fuh')
    .replace(/\bGuerendo\b/gi, 'Guh-ren-doh')
    .replace(/\bGross-Matos\b/gi, 'Groce Mah-tose')
    .replace(/\bOkoronkwo\b/gi, 'Oh-koh-rahnk-woh')
    .replace(/\bJi['’]Ayir\b/gi, 'Jee-eye-ear')
    .replace(/\bKubiak\b/gi, 'Koo-bee-ack')
    .replace(/\bJeanty\b/gi, 'Jen-tee');

  // 9. Turn em-dashes and dense semicolons into natural spoken breath pauses
  text = text
    .replace(/\s*—\s*/g, ', ')
    .replace(/\s*;\s*/g, '. ')
    .replace(/\s{2,}/g, ' ')
    .trim();

  return text;
}

const QUICK_LATCH_OPENERS_RE =
  /^(yeah|right|exactly|spot on|100 percent|hundred percent|totally|not at all|no question|and look|hold on|wait|bingo|that's it|for sure)\b/i;

/**
 * Computes human conversational prosody & inter-turn breath gaps so co-hosts latch
 * naturally onto agreements/interjections and leave realistic beats after questions.
 */
export function computeConversationalTurnDynamics(turns = [], idx = 0) {
  const current = turns[idx] || {};
  const next = turns[idx + 1] || null;
  const text = String(current.text || '').trim();
  const words = text.split(/\s+/).filter(Boolean).length;
  const isElena = current.speaker === 'Elena';

  // Subtle natural variation: short reactive interjections carry slightly livelier energy;
  // dense cap/film breakdowns settle into unhurried, authoritative studio cadence.
  let rate = '+0%';
  let pitch = isElena ? '+0Hz' : '-1Hz';

  if (words <= 22) {
    rate = '+2%';
    pitch = isElena ? '+1Hz' : '+0Hz';
  } else if (words >= 52) {
    rate = '-1%';
  } else if (idx % 3 === 1) {
    rate = '+1%';
  }

  let gapAfterMs = 245;
  if (next) {
    const nextText = String(next.text || '').trim();
    if (QUICK_LATCH_OPENERS_RE.test(nextText)) {
      gapAfterMs = 125; // Fast co-host conversational latch
    } else if (/\?\s*$/.test(text)) {
      gapAfterMs = 215; // Natural question-to-answer beat
    } else if (words >= 45) {
      gapAfterMs = 285; // Relaxed topic-transition breath
    }
  } else {
    gapAfterMs = 0;
  }

  return {
    rate: current.rate || rate,
    pitch: current.pitch || pitch,
    gapAfterMs: typeof current.gapAfterMs === 'number' ? current.gapAfterMs : gapAfterMs
  };
}

const NOVELTY_OR_ROBOTIC_VOICE_RE =
  /\b(fred|albert|bad news|bahh|bells|boing|bubbles|cellos|good news|jester|organ|superstar|trinoids|whisper|wobble|zarvox|junior|ralph|kathy|deranged|hysterical|pipe organ|espeak)\b/i;

function scoreBrowserVoice(voice, targetGender) {
  if (!voice || !voice.lang) return -1000;
  const lang = String(voice.lang);
  if (!/^en(-|_|$)/i.test(lang)) return -1000;

  const name = String(voice.name || '');
  if (NOVELTY_OR_ROBOTIC_VOICE_RE.test(name)) return -900;

  let score = 0;
  if (/^en[-_]US/i.test(lang)) score += 45;
  else if (/^en[-_](GB|CA|AU)/i.test(lang)) score += 20;

  // Strongly prefer neural / natural / premium / enhanced voices on iOS, macOS, Edge & Chrome
  if (/\b(natural|neural|online)\b/i.test(name)) score += 120;
  if (/\b(premium)\b/i.test(name)) score += 105;
  if (/\b(enhanced)\b/i.test(name)) score += 90;
  if (/\bsiri\b/i.test(name)) score += 85;
  if (/\bgoogle\s+us\s+english\b/i.test(name)) score += 70;
  if (voice.localService === false) score += 25;

  const isKnownMale = /\b(andrew|brian|christopher|guy|eric|roger|steffan|evan|nathan|daniel|alex|aaron|tom|oliver|matthew|liam|rishi|male)\b/i.test(
    name
  );
  const isKnownFemale = /\b(ava|emma|aria|jenny|michelle|samantha|allison|zoe|victoria|susan|karen|moira|tessa|serena|nicky|female)\b/i.test(
    name
  );

  if (targetGender === 'male') {
    if (isKnownMale) score += 60;
    if (isKnownFemale) score -= 50;
    if (/\b(andrew|brian|evan|nathan)\b/i.test(name)) score += 25;
  } else {
    if (isKnownFemale) score += 60;
    if (isKnownMale) score -= 50;
    if (/\b(ava|emma|samantha|zoe|allison)\b/i.test(name)) score += 25;
  }

  return score;
}

/**
 * Selects the highest-quality distinct male (Marcus) and female (Elena) voices
 * available in `window.speechSynthesis.getVoices()`, avoiding robotic formant voices.
 */
export function selectBestBrowserVoices(voices = []) {
  if (!Array.isArray(voices) || voices.length === 0) {
    return { maleVoice: null, femaleVoice: null };
  }

  const rankedMale = [...voices]
    .map(v => ({ v, s: scoreBrowserVoice(v, 'male') }))
    .filter(x => x.s > -500)
    .sort((a, b) => b.s - a.s);

  const maleVoice = rankedMale[0]?.v || null;

  const rankedFemale = [...voices]
    .map(v => ({ v, s: scoreBrowserVoice(v, 'female') }))
    .filter(x => x.s > -500 && x.v !== maleVoice)
    .sort((a, b) => b.s - a.s);

  const femaleVoice = rankedFemale[0]?.v || maleVoice;

  return { maleVoice, femaleVoice };
}

/**
 * Trims dead leading/trailing TTS padding while preserving natural breath onsets & decays,
 * and applies smooth half-cosine fades so stitched turns never click or gate abruptly.
 */
export function trimAndFadeTurnPcm(
  int16Samples,
  sampleRate = 24000,
  { threshold = 115, leadPadMs = 26, trailPadMs = 42, fadeMs = 12 } = {}
) {
  const n = int16Samples.length;
  if (n === 0) return new Float64Array(0);

  let firstActive = 0;
  while (firstActive < n && Math.abs(int16Samples[firstActive]) < threshold) {
    firstActive++;
  }
  if (firstActive >= n) {
    return new Float64Array(Math.min(n, Math.round(sampleRate * 0.08)));
  }

  let lastActive = n - 1;
  while (lastActive > firstActive && Math.abs(int16Samples[lastActive]) < threshold) {
    lastActive--;
  }

  const leadSamples = Math.round((leadPadMs / 1000) * sampleRate);
  const trailSamples = Math.round((trailPadMs / 1000) * sampleRate);
  const start = Math.max(0, firstActive - leadSamples);
  const end = Math.min(n, lastActive + 1 + trailSamples);
  const len = Math.max(1, end - start);

  const out = new Float64Array(len);
  for (let i = 0; i < len; i++) {
    out[i] = int16Samples[start + i] / 32768.0;
  }

  const fadeSamples = Math.min(Math.floor(len / 4), Math.round((fadeMs / 1000) * sampleRate));
  for (let i = 0; i < fadeSamples; i++) {
    const g = 0.5 * (1 - Math.cos((Math.PI * i) / fadeSamples));
    out[i] *= g;
    out[len - 1 - i] *= g;
  }

  return out;
}

function applyBiquadInPlace(samples, b0, b1, b2, a1, a2) {
  let x1 = 0;
  let x2 = 0;
  let y1 = 0;
  let y2 = 0;
  for (let i = 0; i < samples.length; i++) {
    const x0 = samples[i];
    const y0 = b0 * x0 + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
    x2 = x1;
    x1 = x0;
    y2 = y1;
    y1 = y0;
    samples[i] = y0;
  }
}

function applyHighPassBiquad(samples, sampleRate, freqHz, q = 0.7071) {
  const w0 = (2 * Math.PI * freqHz) / sampleRate;
  const cosW0 = Math.cos(w0);
  const alpha = Math.sin(w0) / (2 * q);
  const a0 = 1 + alpha;
  applyBiquadInPlace(
    samples,
    (1 + cosW0) / 2 / a0,
    -(1 + cosW0) / a0,
    (1 + cosW0) / 2 / a0,
    (-2 * cosW0) / a0,
    (1 - alpha) / a0
  );
}

function applyPeakingEqBiquad(samples, sampleRate, freqHz, q, gainDb) {
  const A = Math.pow(10, gainDb / 40);
  const w0 = (2 * Math.PI * freqHz) / sampleRate;
  const cosW0 = Math.cos(w0);
  const alpha = Math.sin(w0) / (2 * q);
  const a0 = 1 + alpha / A;
  applyBiquadInPlace(
    samples,
    (1 + alpha * A) / a0,
    (-2 * cosW0) / a0,
    (1 - alpha * A) / a0,
    (-2 * cosW0) / a0,
    (1 - alpha / A) / a0
  );
}

function computeActiveSpeechRms(samples, sampleRate = 24000) {
  let peak = 0;
  for (let i = 0; i < samples.length; i++) {
    const a = Math.abs(samples[i]);
    if (a > peak) peak = a;
  }
  const gate = Math.max(0.004, peak * 0.12);
  const win = Math.max(64, Math.round(sampleRate * 0.02)); // 20ms frames
  const frameEnergies = [];
  for (let i = 0; i + win <= samples.length; i += win) {
    let sumSq = 0;
    for (let j = 0; j < win; j++) {
      const v = samples[i + j];
      sumSq += v * v;
    }
    const rms = Math.sqrt(sumSq / win);
    if (rms > gate) frameEnergies.push(rms);
  }
  if (frameEnergies.length === 0) return 0.05;
  const meanSq = frameEnergies.reduce((acc, r) => acc + r * r, 0) / frameEnergies.length;
  return Math.sqrt(meanSq);
}

/**
 * Studio Broadcast Voice Conditioning per turn:
 * - 75 Hz Butterworth High-Pass (removes plosive thump)
 * - +1.6 dB @ 180 Hz Broadcast Mic Warmth (adds natural chest resonance)
 * - -1.9 dB @ 3850 Hz De-Harshness Dip (removes synthetic upper-mid vocoder sheen)
 * - -1.1 dB @ 6800 Hz Gentle De-Esser
 * - Per-turn active-speech RMS leveling so both hosts sit at identical studio loudness
 */
export function conditionTurnVoicePcm(floatSamples, sampleRate = 24000, targetActiveRms = 0.115) {
  const buf = Float64Array.from(floatSamples);
  if (buf.length === 0) return buf;

  applyHighPassBiquad(buf, sampleRate, 75, 0.7071);
  applyPeakingEqBiquad(buf, sampleRate, 180, 0.85, 1.6);
  applyPeakingEqBiquad(buf, sampleRate, 3850, 1.45, -1.9);
  applyPeakingEqBiquad(buf, sampleRate, 6800, 1.2, -1.1);

  const activeRms = computeActiveSpeechRms(buf, sampleRate);
  const rawGain = targetActiveRms / Math.max(0.015, activeRms);
  const clampedGain = Math.max(0.35, Math.min(2.6, rawGain));
  for (let i = 0; i < buf.length; i++) {
    buf[i] *= clampedGain;
  }

  return buf;
}

/**
 * Final Broadcast Master Bus:
 * - Continuous -58 dBFS low-passed studio room tone (eliminates jarring digital-zero black holes between turns)
 * - Smooth soft-knee studio compressor (2.3:1 above -15.5 dBFS, 8ms attack, 115ms release)
 * - Soft-clip true-peak ceiling at -1.0 dBFS (0.891) -> quantized cleanly with TPDF dither to Int16 PCM
 */
export function masterPodcastEpisodePcm(floatTimeline, sampleRate = 24000) {
  const n = floatTimeline.length;
  const out = new Int16Array(n);
  if (n === 0) return out;

  // Deterministic PRNG so builds are clean & reproducible
  let rng = 0x49e25026;
  const nextRand = () => {
    rng = (Math.imul(rng, 1664525) + 1013904223) >>> 0;
    return rng / 4294967296 - 0.5;
  };

  let brownState = 0;
  const roomToneGain = 0.00115; // ~ -58.8 dBFS warm broadcast room floor
  const fadeInSamples = Math.min(n, Math.round(sampleRate * 0.16));
  const fadeOutSamples = Math.min(n, Math.round(sampleRate * 0.32));

  // Compressor parameters
  const threshDb = -15.5;
  const ratio = 2.3;
  const kneeWidthDb = 5.0;
  const makeupLinear = 1.12;
  const attackCoeff = Math.exp(-1 / (sampleRate * 0.008));
  const releaseCoeff = Math.exp(-1 / (sampleRate * 0.115));
  const ceiling = 0.891; // -1.0 dBFS
  let env = 0;

  for (let i = 0; i < n; i++) {
    // Low-passed warm studio room tone
    brownState = 0.94 * brownState + 0.06 * nextRand();
    let fadeEnv = 1.0;
    if (i < fadeInSamples) fadeEnv = i / fadeInSamples;
    else if (i > n - fadeOutSamples) fadeEnv = (n - 1 - i) / fadeOutSamples;

    let sample = floatTimeline[i] + brownState * roomToneGain * fadeEnv;

    const absVal = Math.abs(sample);
    env = absVal > env ? attackCoeff * env + (1 - attackCoeff) * absVal : releaseCoeff * env + (1 - releaseCoeff) * absVal;

    let gain = makeupLinear;
    if (env > 1e-6) {
      const envDb = 20 * Math.log10(env);
      const overDb = envDb - threshDb;
      let gainRedDb = 0;
      if (overDb > kneeWidthDb / 2) {
        gainRedDb = overDb * (1 - 1 / ratio);
      } else if (overDb > -kneeWidthDb / 2) {
        const x = overDb + kneeWidthDb / 2;
        gainRedDb = ((1 - 1 / ratio) * x * x) / (2 * kneeWidthDb);
      }
      if (gainRedDb > 0) {
        gain *= Math.pow(10, -gainRedDb / 20);
      }
    }

    let mastered = sample * gain;
    // Smooth tanh soft-saturation above 0.78 up to ceiling 0.891
    const absM = Math.abs(mastered);
    if (absM > 0.78) {
      const sign = mastered < 0 ? -1 : 1;
      const excess = (absM - 0.78) / (ceiling - 0.78);
      mastered = sign * (0.78 + (ceiling - 0.78) * Math.tanh(excess));
    }

    // TPDF dither at +/- 0.5 LSB
    const dither = (nextRand() + nextRand()) / 32768.0;
    const clamped = Math.max(-0.9999, Math.min(0.9999, mastered + dither));
    out[i] = Math.round(clamped * 32767);
  }

  return out;
}
