/**
 * Compact 22 MB StyleTTS2 Expressive Human Neural TTS & Progressive Mastering Web Worker
 *
 * Used whenever an episode's audio needs local on-device human neural synthesis (such as opening
 * a legacy keyless link without a Gemini voice relay token, or if Gemini NotebookLM TTS hits its
 * daily free-tier rate limit).
 *
 * Uses distilled StyleTTS2 (`onnx-community/kitten-tts-nano-0.1-ONNX`, `q8`, ~22.7 MB — 4x smaller
 * and ~5x faster on mobile WASM than 88 MB `Kokoro-82M`) with expressive human podcast voices
 * (`expr-voice-2-m` for Marcus, `expr-voice-2-f` for Elena), emitting a fast-start `lead_ready`
 * Stereo WAV after the opening 3 turns (~12–18s) while mastering the full episode in the background.
 */

import {
  computeConversationalTurnDynamics,
  trimAndFadeTurnPcm,
  conditionTurnVoicePcm,
  masterPodcastEpisodePcm
} from '../engine/podcastSpeechEngine.js';
import { prepareConversationalTextForModernNeuralTts } from '../engine/geminiStudioPrompts.js';

const TRANSFORMERS_ESM_URL = 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.4.0';
const PHONEMIZER_ESM_URL = 'https://cdn.jsdelivr.net/npm/phonemizer@1.2.1/+esm';
const STYLETTS2_MODEL_ID = 'onnx-community/kitten-tts-nano-0.1-ONNX';

const VOICE_FILES = {
  Marcus: 'expr-voice-2-m',
  Elena: 'expr-voice-2-f'
};

let engineBundlePromise = null;
const voiceStyleCache = new Map();

/**
 * Splits spoken dialogue into natural sentence-bounded segments (<= `maxChars`) so every
 * ONNX forward pass stays well inside the 510-phoneme context window with small mobile
 * WASM attention buffers and per-second progress updates.
 */
export function splitTurnIntoSpokenSentences(spokenText = '', maxChars = 195) {
  const clean = String(spokenText || '').replace(/\s+/g, ' ').trim();
  if (!clean) return [];
  if (clean.length <= maxChars) return [clean];

  const rawSentences = clean.split(/(?<=[.!?])\s+/).filter(Boolean);
  const expanded = [];

  for (const sent of rawSentences) {
    if (sent.length <= maxChars + 35) {
      expanded.push(sent);
      continue;
    }
    const parts = sent.split(/(?<=[,;—–])\s+/).filter(Boolean);
    let acc = '';
    for (const part of parts) {
      if (!acc) {
        acc = part;
      } else if (acc.length + 1 + part.length <= maxChars) {
        acc = `${acc} ${part}`;
      } else {
        expanded.push(acc);
        acc = part;
      }
    }
    if (acc) expanded.push(acc);
  }

  const merged = [];
  for (const seg of expanded) {
    if (
      merged.length > 0 &&
      (merged[merged.length - 1].length < 28 ||
        merged[merged.length - 1].length + 1 + seg.length <= maxChars)
    ) {
      merged[merged.length - 1] = `${merged[merged.length - 1]} ${seg}`;
    } else {
      merged.push(seg);
    }
  }

  return merged;
}

async function loadVoiceStyleVector(voiceName) {
  if (voiceStyleCache.has(voiceName)) {
    return voiceStyleCache.get(voiceName);
  }
  const url = `https://huggingface.co/${STYLETTS2_MODEL_ID}/resolve/main/voices/${voiceName}.bin`;
  let arrBuf = null;
  let cache = null;

  if (typeof caches !== 'undefined') {
    try {
      cache = await caches.open('49ers-styletts2-voices-v1');
      const hit = await cache.match(url);
      if (hit) {
        arrBuf = await hit.arrayBuffer();
      }
    } catch {}
  }

  if (!arrBuf) {
    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(`Failed to fetch studio voice profile (${res.status})`);
    }
    arrBuf = await res.arrayBuffer();
    if (cache) {
      try {
        await cache.put(url, new Response(arrBuf, { headers: res.headers }));
      } catch {}
    }
  }

  const vec = new Float32Array(arrBuf);
  voiceStyleCache.set(voiceName, vec);
  return vec;
}

async function getExpressiveNeuralEngine(reportStatus) {
  if (engineBundlePromise) return engineBundlePromise;

  engineBundlePromise = (async () => {
    reportStatus?.({
      subPercent: 10,
      detail: 'Loading compact 23 MB expressive studio voice engine…'
    });

    const [transformersMod, phonemizerMod] = await Promise.all([
      import(TRANSFORMERS_ESM_URL),
      import(PHONEMIZER_ESM_URL)
    ]);

    const { StyleTextToSpeech2Model, AutoTokenizer, Tensor } = transformersMod;
    const { phonemize } = phonemizerMod;

    const fileProgressByKey = new Map();
    let maxDlPct = 0;

    const onDownloadProgress = prog => {
      if (!prog) return;
      const fileKey = String(prog.file || prog.name || 'weights');
      const loaded = Number(prog.loaded || 0);
      const total = Number(prog.total || 0);
      if (total > 0) {
        fileProgressByKey.set(fileKey, { loaded: Math.min(loaded, total), total });
      }

      let onnxEntry = null;
      let sumLoaded = 0;
      let sumTotal = 0;
      for (const [k, v] of fileProgressByKey.entries()) {
        sumLoaded += v.loaded;
        sumTotal += v.total;
        if (/\.onnx$/i.test(k)) {
          onnxEntry = v;
        }
      }

      let dlPct = maxDlPct;
      let mbSuffix = '';
      if (onnxEntry && onnxEntry.total > 0) {
        dlPct = Math.round((onnxEntry.loaded / onnxEntry.total) * 100);
        const loadedMb = Math.round(onnxEntry.loaded / 1_048_576);
        const totalMb = Math.max(1, Math.round(onnxEntry.total / 1_048_576));
        mbSuffix = ` • ${loadedMb} / ${totalMb} MB`;
      } else if (sumTotal > 2_000_000) {
        dlPct = Math.round((sumLoaded / sumTotal) * 100);
      } else if (/\.onnx$/i.test(fileKey) && typeof prog.progress === 'number') {
        dlPct = Math.round(prog.progress);
      } else {
        return;
      }

      dlPct = Math.min(100, Math.max(maxDlPct, dlPct));
      maxDlPct = dlPct;

      reportStatus?.({
        subPercent: Math.min(36, 10 + Math.round(dlPct * 0.26)),
        detail:
          dlPct >= 100
            ? 'Initializing expressive human voice weights…'
            : `Caching compact studio voices (${dlPct}%${mbSuffix} — 1-time download)…`
      });
    };

    const [model, tokenizer] = await Promise.all([
      StyleTextToSpeech2Model.from_pretrained(STYLETTS2_MODEL_ID, {
        device: 'wasm',
        dtype: 'q8',
        progress_callback: onDownloadProgress
      }),
      AutoTokenizer.from_pretrained(STYLETTS2_MODEL_ID, {
        progress_callback: onDownloadProgress
      }),
      loadVoiceStyleVector(VOICE_FILES.Marcus),
      loadVoiceStyleVector(VOICE_FILES.Elena)
    ]);

    return { model, tokenizer, Tensor, phonemize };
  })().catch(err => {
    engineBundlePromise = null;
    throw err;
  });

  return engineBundlePromise;
}

/**
 * Phonemizes English prose while preserving punctuation (`,`, `.`, `?`, `!`, `—`) so
 * StyleTTS2 predicts natural breath pauses and conversational pitch inflection.
 */
export async function phonemizeWithPunctuation(text, phonemizeFn) {
  const punctRe = /(\s*[;:,.!?—…]+\s*)+/g;
  const sections = [];
  let lastIdx = 0;
  for (const m of text.matchAll(punctRe)) {
    if (lastIdx < m.index) {
      sections.push({ isPunct: false, str: text.slice(lastIdx, m.index) });
    }
    sections.push({ isPunct: true, str: m[0] });
    lastIdx = m.index + m[0].length;
  }
  if (lastIdx < text.length) {
    sections.push({ isPunct: false, str: text.slice(lastIdx) });
  }

  const parts = [];
  for (const sec of sections) {
    if (sec.isPunct) {
      parts.push(sec.str);
    } else {
      const cleanWordSpan = sec.str.trim();
      if (cleanWordSpan) {
        const phArr = await phonemizeFn(cleanWordSpan, 'en-us');
        parts.push(Array.isArray(phArr) ? phArr.join(' ') : String(phArr || ''));
      }
    }
  }
  return parts.join('').replace(/\s+/g, ' ').trim();
}

function float32ToInt16(floatArr) {
  const out = new Int16Array(floatArr.length);
  for (let i = 0; i < floatArr.length; i++) {
    const raw = floatArr[i];
    const safe = Number.isFinite(raw) ? Math.max(-1, Math.min(1, raw)) : 0;
    out[i] = Math.round(safe * 32767);
  }
  return out;
}

function encodeStereo16BitWavBuffer(monoInt16, sampleRate = 24000) {
  const numFrames = monoInt16.length;
  const numChannels = 2;
  const dataBytes = numFrames * numChannels * 2;
  const buffer = new ArrayBuffer(44 + dataBytes);
  const view = new DataView(buffer);

  const writeAscii = (offset, str) => {
    for (let i = 0; i < str.length; i++) {
      view.setUint8(offset + i, str.charCodeAt(i));
    }
  };

  writeAscii(0, 'RIFF');
  view.setUint32(4, 36 + dataBytes, true);
  writeAscii(8, 'WAVE');
  writeAscii(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * numChannels * 2, true);
  view.setUint16(32, numChannels * 2, true);
  view.setUint16(34, 16, true);
  writeAscii(36, 'data');
  view.setUint32(40, dataBytes, true);

  let byteOffset = 44;
  for (let i = 0; i < numFrames; i++) {
    const s = monoInt16[i];
    view.setInt16(byteOffset, s, true);
    view.setInt16(byteOffset + 2, s, true);
    byteOffset += 4;
  }

  return buffer;
}

function masterSubsetToWav(conditionedSubset, gapsSubset, origTurnsSubset, sampleRate = 24000) {
  const leadRoomSamples = Math.round(sampleRate * 0.14);
  const trailRoomSamples = Math.round(sampleRate * 0.28);
  let totalSamples = leadRoomSamples + trailRoomSamples;
  for (let i = 0; i < conditionedSubset.length; i++) {
    totalSamples += conditionedSubset[i].length + (gapsSubset[i] || 0);
  }

  const timeline = new Float64Array(totalSamples);
  const timedTranscript = [];
  let cursorSamples = leadRoomSamples;

  for (let i = 0; i < conditionedSubset.length; i++) {
    const segAudio = conditionedSubset[i];
    const startSec = +(cursorSamples / sampleRate).toFixed(2);
    timeline.set(segAudio, cursorSamples);
    cursorSamples += segAudio.length;
    const endSec = +(cursorSamples / sampleRate).toFixed(2);

    const orig = origTurnsSubset[i];
    timedTranscript.push({
      idx: i,
      speaker: orig.speaker === 'Elena' ? 'Elena' : 'Marcus',
      speakerRole:
        orig.speaker === 'Elena' ? 'Cap & Quantitative Insider' : "X's & O's Film Analyst",
      text: orig.text,
      startSec: Math.floor(startSec),
      endSec: Math.max(Math.floor(startSec) + 1, Math.round(endSec))
    });

    cursorSamples += gapsSubset[i] || 0;
  }

  const masteredInt16 = masterPodcastEpisodePcm(timeline, sampleRate);
  const wavBuffer = encodeStereo16BitWavBuffer(masteredInt16, sampleRate);
  const exactDurationSec = Math.max(1, Math.round(masteredInt16.length / sampleRate));
  return { wavBuffer, durationSec: exactDurationSec, transcript: timedTranscript };
}

async function synthesizeFullPodcastMaster({ jobId, turns = [], emitLeadAtTurn = 3 }) {
  const cleanTurns = Array.isArray(turns) ? turns.filter(t => String(t?.text || '').trim()) : [];
  if (cleanTurns.length === 0) {
    throw new Error('Podcast script has no spoken turns to synthesize.');
  }

  const engine = await getExpressiveNeuralEngine(info => {
    self.postMessage({
      type: 'progress',
      jobId,
      subPercent: info.subPercent,
      detail: info.detail
    });
  });

  const { model, tokenizer, Tensor, phonemize } = engine;
  const sampleRate = 24000;

  const preparedTurnPlans = cleanTurns.map((turn, idx) => {
    const speaker = turn.speaker === 'Elena' ? 'Elena' : 'Marcus';
    const voiceKey = VOICE_FILES[speaker] || VOICE_FILES.Marcus;
    const dyn = computeConversationalTurnDynamics(cleanTurns, idx);
    const speed = dyn.rate === '+2%' ? 1.03 : dyn.rate === '-1%' ? 0.98 : 1.0;
    const spokenText = prepareConversationalTextForModernNeuralTts(turn.text, {
      engine: 'kokoro'
    });
    const sentences = splitTurnIntoSpokenSentences(spokenText, 195);
    return {
      orig: turn,
      speaker,
      voiceKey,
      dyn,
      speed,
      sentences: sentences.length > 0 ? sentences : [spokenText]
    };
  });

  const totalSentenceUnits = Math.max(
    1,
    preparedTurnPlans.reduce((sum, p) => sum + p.sentences.length, 0)
  );
  let completedSentenceUnits = 0;

  self.postMessage({
    type: 'progress',
    jobId,
    subPercent: 38,
    turnIndex: 1,
    totalTurns: preparedTurnPlans.length,
    detail: `Synthesizing expressive studio voices — Turn 1 of ${preparedTurnPlans.length} (${preparedTurnPlans[0].speaker})…`
  });

  const conditionedTurns = [];
  const gapSamplesAfterTurn = [];
  let emittedLead = false;

  for (let idx = 0; idx < preparedTurnPlans.length; idx++) {
    const plan = preparedTurnPlans[idx];
    const stylePool = await loadVoiceStyleVector(plan.voiceKey);
    const maxStyleRows = Math.max(1, Math.floor(stylePool.length / 256));
    const sentenceChunksInt16 = [];

    for (let sIdx = 0; sIdx < plan.sentences.length; sIdx++) {
      const sentenceText = plan.sentences[sIdx];
      const phonemes = await phonemizeWithPunctuation(sentenceText, phonemize);
      if (phonemes) {
        const { input_ids } = tokenizer(phonemes, { truncation: true });
        const seqLen = Number(input_ids?.dims?.at(-1) || 1);
        const styleRow = Math.min(Math.max(seqLen - 2, 0), maxStyleRows - 1);
        const styleSlice = stylePool.slice(styleRow * 256, (styleRow + 1) * 256);

        const { waveform } = await model({
          input_ids,
          style: new Tensor('float32', styleSlice, [1, 256]),
          speed: new Tensor('float32', [plan.speed], [1])
        });

        if (waveform?.data && waveform.data.length > 0) {
          // Trim tiny StyleTTS2 trailing synthesis tail (>1s clips)
          const rawWave =
            waveform.data.length > 26000
              ? waveform.data.subarray(0, waveform.data.length - 3600)
              : waveform.data;
          sentenceChunksInt16.push(float32ToInt16(rawWave));
        }
      }

      completedSentenceUnits += 1;
      const synthPct = Math.min(
        96,
        38 + Math.round((completedSentenceUnits / totalSentenceUnits) * 58)
      );
      self.postMessage({
        type: 'progress',
        jobId,
        subPercent: synthPct,
        turnIndex: idx + 1,
        totalTurns: preparedTurnPlans.length,
        detail: `Synthesizing expressive studio voices — Turn ${idx + 1} of ${preparedTurnPlans.length} (${plan.speaker})…`
      });

      await new Promise(resolve => setTimeout(resolve, 0));
    }

    const intraPauseSamples = Math.round(sampleRate * 0.065);
    let turnTotalSamples = 0;
    for (let c = 0; c < sentenceChunksInt16.length; c++) {
      turnTotalSamples += sentenceChunksInt16[c].length;
      if (c < sentenceChunksInt16.length - 1) turnTotalSamples += intraPauseSamples;
    }

    const mergedTurnInt16 = new Int16Array(Math.max(1, turnTotalSamples));
    let writeOff = 0;
    for (let c = 0; c < sentenceChunksInt16.length; c++) {
      const seg = sentenceChunksInt16[c];
      mergedTurnInt16.set(seg, writeOff);
      writeOff += seg.length;
      if (c < sentenceChunksInt16.length - 1) writeOff += intraPauseSamples;
    }

    const trimmed =
      turnTotalSamples > 0
        ? trimAndFadeTurnPcm(mergedTurnInt16, sampleRate, {
            threshold: 85,
            leadPadMs: 24,
            trailPadMs: 42,
            fadeMs: 12
          })
        : new Float64Array(1);

    const conditioned = conditionTurnVoicePcm(trimmed, sampleRate, 0.12);
    conditionedTurns.push(conditioned);
    gapSamplesAfterTurn.push(Math.round((plan.dyn.gapAfterMs / 1000) * sampleRate));

    // Emit fast-start playable lead WAV after opening 3 turns (~12–16s) when episode has >= 6 turns!
    if (
      !emittedLead &&
      emitLeadAtTurn > 0 &&
      preparedTurnPlans.length >= emitLeadAtTurn + 3 &&
      conditionedTurns.length === emitLeadAtTurn
    ) {
      emittedLead = true;
      const leadMaster = masterSubsetToWav(
        conditionedTurns,
        gapSamplesAfterTurn,
        preparedTurnPlans.slice(0, emitLeadAtTurn).map(p => p.orig),
        sampleRate
      );
      self.postMessage(
        {
          type: 'lead_ready',
          jobId,
          wavBuffer: leadMaster.wavBuffer,
          durationSec: leadMaster.durationSec
        },
        [leadMaster.wavBuffer]
      );
    }
  }

  self.postMessage({
    type: 'progress',
    jobId,
    subPercent: 98,
    detail: 'Mastering 2-channel Stereo studio bus…'
  });

  const fullMaster = masterSubsetToWav(
    conditionedTurns,
    gapSamplesAfterTurn,
    preparedTurnPlans.map(p => p.orig),
    sampleRate
  );

  return {
    wavBuffer: fullMaster.wavBuffer,
    durationSec: fullMaster.durationSec,
    sampleRate,
    transcript: fullMaster.transcript
  };
}

if (typeof self !== 'undefined' && typeof self.addEventListener === 'function') {
  self.addEventListener('message', async event => {
    const data = event?.data || {};
    if (data.type !== 'synthesize_podcast') return;

    const { jobId, turns, emitLeadAtTurn = 3 } = data;
    try {
      const result = await synthesizeFullPodcastMaster({ jobId, turns, emitLeadAtTurn });
      self.postMessage(
        {
          type: 'complete',
          jobId,
          wavBuffer: result.wavBuffer,
          durationSec: result.durationSec,
          sampleRate: result.sampleRate,
          transcript: result.transcript
        },
        [result.wavBuffer]
      );
    } catch (err) {
      self.postMessage({
        type: 'error',
        jobId,
        error: err?.message || String(err)
      });
    }
  });
}
