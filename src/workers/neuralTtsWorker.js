/**
 * Studio Multi-Speaker Kokoro-82M Neural TTS & Broadcast Mastering Web Worker
 *
 * Used whenever an episode's audio needs local on-device synthesis (such as a colleague opening
 * a shared podcast link without a cloud R2 URL or Gemini API key, or as an automatic fallback if
 * Gemini Native Multi-Speaker TTS hits a daily free-tier rate limit).
 *
 * Runs StyleTTS2-based Kokoro-82M (`onnx-community/Kokoro-82M-v1.0-ONNX`) with natural human
 * podcast voices (`am_fenrir` for Marcus, `af_heart` for Elena), accelerating on WebGPU (`fp32`)
 * when available and falling back seamlessly to quantized WASM (`q8`).
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

async function hasUsableWebGpu() {
  try {
    if (!self.navigator?.gpu || typeof self.navigator.gpu.requestAdapter !== 'function') {
      return false;
    }
    const adapter = await self.navigator.gpu.requestAdapter();
    return Boolean(adapter);
  } catch {
    return false;
  }
}

async function getKokoroEngine(reportStatus) {
  if (kokoroEnginePromise) return kokoroEnginePromise;

  kokoroEnginePromise = (async () => {
    reportStatus?.({
      subPercent: 8,
      detail: 'Loading Kokoro-82M expressive studio voice engine…'
    });

    const { KokoroTTS } = await import(KOKORO_WEB_ESM_URL);
    const useWebGpu = await hasUsableWebGpu();

    const loadWithBackend = async (device, dtype) =>
      KokoroTTS.from_pretrained(KOKORO_MODEL_ID, {
        device,
        dtype,
        progress_callback: prog => {
          if (prog && typeof prog.progress === 'number') {
            const dlPct = Math.min(100, Math.max(0, Math.round(prog.progress)));
            reportStatus?.({
              subPercent: Math.min(30, 8 + Math.round(dlPct * 0.22)),
              detail: `Caching Kokoro-82M studio voice weights (${dlPct}%)…`
            });
          }
        }
      });

    if (useWebGpu) {
      try {
        return await loadWithBackend('webgpu', 'fp32');
      } catch {
        // Fall through cleanly to quantized WASM if WebGPU shader compilation is unavailable
      }
    }
    return await loadWithBackend('wasm', 'q8');
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
  const leadRoomSamples = Math.round(sampleRate * 0.16);
  const trailRoomSamples = Math.round(sampleRate * 0.32);

  const conditionedTurns = [];
  const gapSamplesAfterTurn = [];

  for (let idx = 0; idx < cleanTurns.length; idx++) {
    const turn = cleanTurns[idx];
    const speaker = turn.speaker === 'Elena' ? 'Elena' : 'Marcus';
    const voice = KOKORO_VOICES[speaker] || KOKORO_VOICES.Marcus;
    const dyn = computeConversationalTurnDynamics(cleanTurns, idx);
    const speed = dyn.rate === '+2%' ? 1.04 : dyn.rate === '-1%' ? 0.99 : 1.01;

    const spokenText = prepareConversationalTextForModernNeuralTts(turn.text, {
      engine: 'kokoro'
    });

    const audioOut = await tts.generate(spokenText, {
      voice,
      speed
    });
    if (audioOut?.sampling_rate) {
      sampleRate = Number(audioOut.sampling_rate) || 24000;
    }

    const rawFloat = audioOut?.audio ? Float32Array.from(audioOut.audio) : new Float32Array(0);
    const trimmed =
      rawFloat.length > 0
        ? trimAndFadeTurnPcm(float32ToInt16(rawFloat), sampleRate, {
            threshold: 85,
            leadPadMs: 24,
            trailPadMs: 42,
            fadeMs: 12
          })
        : new Float64Array(1);

    const conditioned = conditionTurnVoicePcm(trimmed, sampleRate, 0.12);
    conditionedTurns.push(conditioned);
    gapSamplesAfterTurn.push(Math.round((dyn.gapAfterMs / 1000) * sampleRate));

    const synthPct = 32 + Math.round(((idx + 1) / cleanTurns.length) * 62);
    self.postMessage({
      type: 'progress',
      jobId,
      subPercent: synthPct,
      turnIndex: idx + 1,
      totalTurns: cleanTurns.length,
      detail: `Synthesizing natural voice turn ${idx + 1} of ${cleanTurns.length} (${speaker})…`
    });
  }

  self.postMessage({
    type: 'progress',
    jobId,
    subPercent: 96,
    detail: 'Mastering 2-channel Stereo studio bus…'
  });

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

    const orig = cleanTurns[i];
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
