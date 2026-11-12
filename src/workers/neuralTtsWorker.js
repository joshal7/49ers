/**
 * Studio Multi-Speaker Kokoro-82M Neural TTS & Broadcast Mastering Web Worker
 *
 * Used whenever an episode's audio needs local on-device synthesis (such as a family member or
 * colleague opening a shared podcast link in Mobile Safari without an API key or R2 stream, or
 * as an automatic fallback if Gemini Native Multi-Speaker TTS hits a daily free-tier rate limit).
 *
 * Uses quantized INT8 (`q8`, ~88 MB cached in browser CacheStorage) WASM SIMD inference exclusively
 * rather than `fp32` WebGPU (~310 MB), preventing iOS/iPadOS Safari WebKit Worker Jetsam OOM
 * terminations and `onnxruntime-web` duplicate `initializeWebAssembly()` faults while splitting
 * long turns into sentence-level passes for low peak RAM and per-second progress feedback.
 */

import {
  computeConversationalTurnDynamics,
  trimAndFadeTurnPcm,
  conditionTurnVoicePcm,
  masterPodcastEpisodePcm
} from '../engine/podcastSpeechEngine.js';
import { prepareConversationalTextForModernNeuralTts } from '../engine/geminiStudioPrompts.js';

const KOKORO_WEB_ESM_URL = 'https://cdn.jsdelivr.net/npm/kokoro-js@1.2.1/dist/kokoro.web.js';
const KOKORO_MODEL_ID = 'onnx-community/Kokoro-82M-v1.0-ONNX';

const KOKORO_VOICES = {
  Marcus: 'am_fenrir',
  Elena: 'af_heart'
};

let kokoroEnginePromise = null;

/**
 * Splits spoken dialogue into natural sentence-bounded segments (<= `maxChars`) so every
 * ONNX forward pass stays well inside Kokoro's 510-phoneme context window with small
 * mobile WASM attention buffers and frequent progress updates.
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
    // Split extra-long run-on clauses on natural pause punctuation (, ; —)
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

  // Merge very short interjections ("Right!", "Exactly.") into the following sentence for natural prosody
  const merged = [];
  for (const seg of expanded) {
    if (
      merged.length > 0 &&
      (merged[merged.length - 1].length < 28 || merged[merged.length - 1].length + 1 + seg.length <= maxChars)
    ) {
      merged[merged.length - 1] = `${merged[merged.length - 1]} ${seg}`;
    } else {
      merged.push(seg);
    }
  }

  return merged;
}

async function getKokoroEngine(reportStatus) {
  if (kokoroEnginePromise) return kokoroEnginePromise;

  kokoroEnginePromise = (async () => {
    reportStatus?.({
      subPercent: 8,
      detail: 'Loading studio voice engine…'
    });

    const { KokoroTTS } = await import(KOKORO_WEB_ESM_URL);

    const fileProgressByKey = new Map();
    let maxDlPct = 0;

    // Quantized INT8 (`q8`, ~88 MB) on WASM SIMD avoids the 310 MB `fp32` WebGPU bundle that
    // triggers silent iOS Safari WebKit Worker Jetsam memory kills on iPhone/iPad.
    return await KokoroTTS.from_pretrained(KOKORO_MODEL_ID, {
      device: 'wasm',
      dtype: 'q8',
      progress_callback: prog => {
        if (!prog) return;
        const fileKey = String(prog.file || prog.name || 'weights');
        const loaded = Number(prog.loaded || 0);
        const total = Number(prog.total || 0);
        if (total > 0) {
          fileProgressByKey.set(fileKey, { loaded: Math.min(loaded, total), total });
        }

        // Prioritize `.onnx` weight download bytes so small 2 KB JSON configs never jump progress to 100%
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
        } else if (sumTotal > 5_000_000) {
          dlPct = Math.round((sumLoaded / sumTotal) * 100);
        } else if (/\.onnx$/i.test(fileKey) && typeof prog.progress === 'number') {
          dlPct = Math.round(prog.progress);
        } else {
          return;
        }

        dlPct = Math.min(100, Math.max(maxDlPct, dlPct));
        maxDlPct = dlPct;

        reportStatus?.({
          subPercent: Math.min(38, 8 + Math.round(dlPct * 0.3)),
          detail:
            dlPct >= 100
              ? 'Initializing studio voice weights…'
              : `Caching studio voice weights (${dlPct}%${mbSuffix} — 1-time download)…`
        });
      }
    });
  })().catch(err => {
    kokoroEnginePromise = null;
    throw err;
  });

  return kokoroEnginePromise;
}

function float32ToInt16(floatArr) {
  const out = new Int16Array(floatArr.length);
  for (let i = 0; i < floatArr.length; i++) {
    const clamped = Math.max(-1, Math.min(1, floatArr[i]));
    out[i] = Math.round(clamped * 32767);
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

async function synthesizeFullPodcastMaster({ jobId, turns = [] }) {
  const cleanTurns = Array.isArray(turns) ? turns.filter(t => String(t?.text || '').trim()) : [];
  if (cleanTurns.length === 0) {
    throw new Error('Podcast script has no spoken turns to synthesize.');
  }

  const tts = await getKokoroEngine(info => {
    self.postMessage({
      type: 'progress',
      jobId,
      subPercent: info.subPercent,
      detail: info.detail
    });
  });

  let sampleRate = 24000;
  const preparedTurnPlans = cleanTurns.map((turn, idx) => {
    const speaker = turn.speaker === 'Elena' ? 'Elena' : 'Marcus';
    const voice = KOKORO_VOICES[speaker] || KOKORO_VOICES.Marcus;
    const dyn = computeConversationalTurnDynamics(cleanTurns, idx);
    const speed = dyn.rate === '+2%' ? 1.04 : dyn.rate === '-1%' ? 0.99 : 1.01;
    const spokenText = prepareConversationalTextForModernNeuralTts(turn.text, {
      engine: 'kokoro'
    });
    const sentences = splitTurnIntoSpokenSentences(spokenText, 195);
    return {
      orig: turn,
      speaker,
      voice,
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
    subPercent: 40,
    turnIndex: 1,
    totalTurns: preparedTurnPlans.length,
    detail: `Synthesizing voice turn 1 of ${preparedTurnPlans.length} (${preparedTurnPlans[0].speaker})…`
  });

  const conditionedTurns = [];
  const gapSamplesAfterTurn = [];

  for (let idx = 0; idx < preparedTurnPlans.length; idx++) {
    const plan = preparedTurnPlans[idx];
    const sentenceChunksInt16 = [];

    for (let sIdx = 0; sIdx < plan.sentences.length; sIdx++) {
      const sentenceText = plan.sentences[sIdx];
      const audioOut = await tts.generate(sentenceText, {
        voice: plan.voice,
        speed: plan.speed
      });
      if (audioOut?.sampling_rate) {
        sampleRate = Number(audioOut.sampling_rate) || 24000;
      }
      if (audioOut?.audio && audioOut.audio.length > 0) {
        sentenceChunksInt16.push(float32ToInt16(audioOut.audio));
      }

      completedSentenceUnits += 1;
      const synthPct = Math.min(
        95,
        40 + Math.round((completedSentenceUnits / totalSentenceUnits) * 55)
      );
      self.postMessage({
        type: 'progress',
        jobId,
        subPercent: synthPct,
        turnIndex: idx + 1,
        totalTurns: preparedTurnPlans.length,
        detail: `Synthesizing studio voices — Turn ${idx + 1} of ${preparedTurnPlans.length} (${plan.speaker})…`
      });

      // Yield briefly to allow mobile WebKit Worker GC to reclaim temporary ONNX tensors
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
  }

  self.postMessage({
    type: 'progress',
    jobId,
    subPercent: 97,
    detail: 'Mastering 2-channel Stereo studio bus…'
  });

  const leadRoomSamples = Math.round(sampleRate * 0.16);
  const trailRoomSamples = Math.round(sampleRate * 0.32);
  let totalSamples = leadRoomSamples + trailRoomSamples;
  for (let i = 0; i < conditionedTurns.length; i++) {
    totalSamples += conditionedTurns[i].length + (gapSamplesAfterTurn[i] || 0);
  }

  const masterTimeline = new Float64Array(totalSamples);
  const timedTranscript = [];
  let cursorSamples = leadRoomSamples;

  for (let i = 0; i < conditionedTurns.length; i++) {
    const segAudio = conditionedTurns[i];
    const startSec = +(cursorSamples / sampleRate).toFixed(2);
    masterTimeline.set(segAudio, cursorSamples);
    cursorSamples += segAudio.length;
    const endSec = +(cursorSamples / sampleRate).toFixed(2);

    const orig = preparedTurnPlans[i].orig;
    timedTranscript.push({
      idx: i,
      speaker: orig.speaker === 'Elena' ? 'Elena' : 'Marcus',
      speakerRole:
        orig.speaker === 'Elena'
          ? 'Cap & Quantitative Insider'
          : "X's & O's Film Analyst",
      text: orig.text,
      startSec: Math.floor(startSec),
      endSec: Math.max(Math.floor(startSec) + 1, Math.round(endSec))
    });

    cursorSamples += gapSamplesAfterTurn[i] || 0;
  }

  const masteredInt16 = masterPodcastEpisodePcm(masterTimeline, sampleRate);
  const wavBuffer = encodeStereo16BitWavBuffer(masteredInt16, sampleRate);
  const exactDurationSec = Math.max(1, Math.round(masteredInt16.length / sampleRate));

  return {
    wavBuffer,
    durationSec: exactDurationSec,
    sampleRate,
    transcript: timedTranscript
  };
}

if (typeof self !== 'undefined' && typeof self.addEventListener === 'function') {
  self.addEventListener('message', async event => {
    const data = event?.data || {};
    if (data.type !== 'synthesize_podcast') return;

    const { jobId, turns } = data;
    try {
      const result = await synthesizeFullPodcastMaster({ jobId, turns });
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
