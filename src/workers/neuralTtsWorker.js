/**
 * Studio Multi-Speaker Neural TTS & Broadcast Mastering Web Worker
 *
 * Synthesizes 100% real, natural human two-host ("Marcus" & "Elena") or solo podcast audio
 * in a background thread using VITS Neural TTS (ONNX Runtime Web WASM + Piper eSpeak-NG phonemizer)
 * and masters the timeline through `podcastSpeechEngine.js` into a 2-channel Stereo 16-bit WAV file.
 *
 * Producing a real Stereo WAV audio file ensures HTML5 `<audio playsinline>` plays reliably
 * out of both iPhone built-in speakers (even with Silent Mode switch ON via `playback` session)
 * and AirPods/Bluetooth—without ever touching fragile `window.speechSynthesis`.
 */

import {
  humanizeNflTextForTts,
  computeConversationalTurnDynamics,
  trimAndFadeTurnPcm,
  conditionTurnVoicePcm,
  masterPodcastEpisodePcm
} from '../engine/podcastSpeechEngine.js';

const PHONEMIZER_ESM_URL =
  'https://cdn.jsdelivr.net/npm/@mintplex-labs/piper-tts-web@1.0.5/dist/piper-o91UDS6e.js/+esm';
const ORT_ESM_URL = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.20.1/dist/ort.wasm.min.mjs';
const ORT_WASM_DIR = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.20.1/dist/';
const PIPER_WASM_BASE =
  'https://cdn.jsdelivr.net/npm/@diffusionstudio/piper-wasm@1.0.0/build/piper_phonemize';
const VOICE_MODEL_BASE =
  'https://huggingface.co/diffusionstudio/piper-voices/resolve/main/en/en_US/arctic/medium/en_US-arctic-medium';
const MODEL_CACHE_NAME = '49ers-neural-tts-model-v1';

// Arctic Medium 18-speaker studio IDs: 7 = bdl (warm male), 4 = clb (clear warm female)
const SPEAKER_IDS = {
  Marcus: 7,
  Elena: 4
};

let enginePromise = null;

async function fetchCachedBytes(url, onDownloadProgress) {
  let cache = null;
  if (typeof caches !== 'undefined' && typeof caches.open === 'function') {
    try {
      cache = await caches.open(MODEL_CACHE_NAME);
      const hit = await cache.match(url);
      if (hit && hit.ok) {
        return await hit.arrayBuffer();
      }
    } catch {
      cache = null;
    }
  }

  const res = await fetch(url, { mode: 'cors' });
  if (!res.ok) {
    throw new Error(`Failed to fetch neural voice asset (${res.status}): ${url}`);
  }

  const totalBytes = Number(res.headers.get('content-length') || 0);
  if (!res.body || typeof res.body.getReader !== 'function' || !totalBytes) {
    const buf = await res.arrayBuffer();
    if (cache) {
      cache
        .put(url, new Response(buf.slice(0), { headers: { 'Content-Type': 'application/octet-stream' } }))
        .catch(() => {});
    }
    return buf;
  }

  const reader = res.body.getReader();
  const chunks = [];
  let received = 0;
  let lastReportedPct = -1;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      chunks.push(value);
      received += value.byteLength;
      if (typeof onDownloadProgress === 'function' && totalBytes > 0) {
        const pct = Math.min(100, Math.round((received / totalBytes) * 100));
        if (pct - lastReportedPct >= 8 || pct === 100) {
          lastReportedPct = pct;
          onDownloadProgress(pct);
        }
      }
    }
  }

  const merged = new Uint8Array(received);
  let offset = 0;
  for (const c of chunks) {
    merged.set(c, offset);
    offset += c.byteLength;
  }

  if (cache) {
    cache
      .put(
        url,
        new Response(merged.buffer.slice(0), {
          headers: { 'Content-Type': 'application/octet-stream' }
        })
      )
      .catch(() => {});
  }

  return merged.buffer;
}

async function fetchCachedJson(url) {
  let cache = null;
  if (typeof caches !== 'undefined' && typeof caches.open === 'function') {
    try {
      cache = await caches.open(MODEL_CACHE_NAME);
      const hit = await cache.match(url);
      if (hit && hit.ok) {
        return await hit.json();
      }
    } catch {
      cache = null;
    }
  }

  const res = await fetch(url, { mode: 'cors' });
  if (!res.ok) {
    throw new Error(`Failed to load neural voice config (${res.status})`);
  }
  const text = await res.text();
  if (cache) {
    cache
      .put(url, new Response(text, { headers: { 'Content-Type': 'application/json' } }))
      .catch(() => {});
  }
  return JSON.parse(text);
}

async function getNeuralEngine(reportStatus) {
  if (enginePromise) return enginePromise;

  enginePromise = (async () => {
    reportStatus?.({
      phase: 'engine_init',
      subPercent: 5,
      detail: 'Loading ONNX Runtime WASM & Piper studio phonemizer…'
    });

    const [{ createPiperPhonemize }, ortModule, piperWasmBuf, piperDataBuf, modelConfig] =
      await Promise.all([
        import(PHONEMIZER_ESM_URL),
        import(ORT_ESM_URL),
        fetchCachedBytes(`${PIPER_WASM_BASE}.wasm`),
        fetchCachedBytes(`${PIPER_WASM_BASE}.data`),
        fetchCachedJson(`${VOICE_MODEL_BASE}.onnx.json`)
      ]);

    const ort = ortModule.default || ortModule;
    ort.env.logLevel = 'error';
    ort.env.allowLocalModels = false;
    ort.env.wasm.numThreads = self.crossOriginIsolated
      ? Math.min(4, Number(self.navigator?.hardwareConcurrency || 1))
      : 1;
    ort.env.wasm.wasmPaths = ORT_WASM_DIR;

    const modelBytes = await fetchCachedBytes(`${VOICE_MODEL_BASE}.onnx`, dlPct => {
      reportStatus?.({
        phase: 'model_download',
        subPercent: Math.min(28, 6 + Math.round(dlPct * 0.22)),
        detail: `Caching multi-speaker neural voice model (${dlPct}%)…`
      });
    });

    reportStatus?.({
      phase: 'session_compile',
      subPercent: 30,
      detail: 'Compiling VITS multi-speaker studio inference graph…'
    });

    const session = await ort.InferenceSession.create(modelBytes, {
      executionProviders: ['wasm'],
      graphOptimizationLevel: 'all'
    });

    return {
      createPiperPhonemize,
      ort,
      session,
      modelConfig,
      piperWasmBuf,
      piperDataBuf
    };
  })().catch(err => {
    enginePromise = null;
    throw err;
  });

  return enginePromise;
}

function splitTurnIntoSentences(spokenText = '') {
  const clean = String(spokenText || '').replace(/\s+/g, ' ').trim();
  if (!clean) return [];

  // Split on sentence-ending punctuation while keeping clauses conversational and <= ~230 chars
  const rawSentences = clean
    .split(/(?<=[.!?])\s+/)
    .map(s => s.trim())
    .filter(Boolean);

  const chunks = [];
  for (const s of rawSentences) {
    if (s.length <= 235) {
      chunks.push(s);
    } else {
      // Split very long sentences on comma/clause boundaries
      const parts = s.split(/(?<=,)\s+/);
      let acc = '';
      for (const p of parts) {
        if (acc && acc.length + p.length + 1 > 220) {
          chunks.push(acc.trim());
          acc = p;
        } else {
          acc = acc ? `${acc} ${p}` : p;
        }
      }
      if (acc.trim()) chunks.push(acc.trim());
    }
  }
  return chunks.length > 0 ? chunks : [clean];
}

async function phonemizeSentence(engine, text) {
  const { createPiperPhonemize, modelConfig, piperWasmBuf, piperDataBuf } = engine;
  const espeakVoice = modelConfig?.espeak?.voice || 'en-us';

  return new Promise((resolve, reject) => {
    let settled = false;
    createPiperPhonemize({
      wasmBinary: piperWasmBuf.slice(0),
      getPreloadedPackage: () => piperDataBuf.slice(0),
      print: output => {
        if (settled) return;
        try {
          const parsed = JSON.parse(output);
          if (Array.isArray(parsed?.phoneme_ids)) {
            settled = true;
            resolve(parsed.phoneme_ids);
          }
        } catch (err) {
          settled = true;
          reject(err);
        }
      },
      printErr: errMsg => {
        // Ignore benign Emscripten warnings unless fatal
        if (!settled && /abort|fatal|exception/i.test(String(errMsg))) {
          settled = true;
          reject(new Error(String(errMsg)));
        }
      },
      locateFile: file => {
        if (file.endsWith('.wasm')) return `${PIPER_WASM_BASE}.wasm`;
        if (file.endsWith('.data')) return `${PIPER_WASM_BASE}.data`;
        return file;
      }
    })
      .then(mod => {
        mod.callMain([
          '-l',
          espeakVoice,
          '--input',
          JSON.stringify([{ text }]),
          '--espeak_data',
          '/espeak-ng-data'
        ]);
        if (!settled) {
          settled = true;
          resolve([]);
        }
      })
      .catch(err => {
        if (!settled) {
          settled = true;
          reject(err);
        }
      });
  });
}

async function synthesizeSentenceFloat32(engine, sentenceText, speakerId, lengthScaleAdj = 1.0) {
  const phonemeIds = await phonemizeSentence(engine, sentenceText);
  if (!phonemeIds || phonemeIds.length === 0) {
    return new Float32Array(0);
  }

  const { ort, session, modelConfig } = engine;
  const baseNoiseScale = Number(modelConfig?.inference?.noise_scale ?? 0.667);
  const baseLengthScale = Number(modelConfig?.inference?.length_scale ?? 1.0) * lengthScaleAdj;
  const baseNoiseW = Number(modelConfig?.inference?.noise_w ?? 0.8);

  const inputIds = new BigInt64Array(phonemeIds.length);
  for (let i = 0; i < phonemeIds.length; i++) {
    inputIds[i] = BigInt(phonemeIds[i]);
  }

  const feeds = {
    input: new ort.Tensor('int64', inputIds, [1, inputIds.length]),
    input_lengths: new ort.Tensor('int64', BigInt64Array.from([BigInt(inputIds.length)]), [1]),
    scales: new ort.Tensor(
      'float32',
      new Float32Array([baseNoiseScale, baseLengthScale, baseNoiseW]),
      [3]
    ),
    sid: new ort.Tensor('int64', BigInt64Array.from([BigInt(speakerId)]), [1])
  };

  const results = await session.run(feeds);
  const outputTensor = results.output || Object.values(results)[0];
  return outputTensor?.data ? Float32Array.from(outputTensor.data) : new Float32Array(0);
}

function float32ToInt16(floatArr) {
  const out = new Int16Array(floatArr.length);
  for (let i = 0; i < floatArr.length; i++) {
    const clamped = Math.max(-1, Math.min(1, floatArr[i]));
    out[i] = Math.round(clamped * 32767);
  }
  return out;
}

function encodeStereo16BitWavBuffer(monoInt16, sampleRate = 22050) {
  const numFrames = monoInt16.length;
  const numChannels = 2; // True 2-channel Stereo (L+R) for iPhone speaker + AirPods compatibility
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
  view.setUint32(16, 16, true); // PCM chunk
  view.setUint16(20, 1, true); // Linear PCM = 1
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * numChannels * 2, true);
  view.setUint16(32, numChannels * 2, true);
  view.setUint16(34, 16, true); // 16-bit
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

  const engine = await getNeuralEngine(info => {
    self.postMessage({
      type: 'progress',
      jobId,
      subPercent: info.subPercent,
      detail: info.detail
    });
  });

  const sampleRate = Number(engine.modelConfig?.audio?.sample_rate || 22050);
  const intraSentenceGapSamples = Math.round(sampleRate * 0.095); // 95ms natural clause breath
  const leadRoomSamples = Math.round(sampleRate * 0.18);
  const trailRoomSamples = Math.round(sampleRate * 0.35);

  const conditionedTurns = [];
  const gapSamplesAfterTurn = [];

  for (let idx = 0; idx < cleanTurns.length; idx++) {
    const turn = cleanTurns[idx];
    const speaker = turn.speaker === 'Elena' ? 'Elena' : 'Marcus';
    const speakerId = SPEAKER_IDS[speaker] ?? SPEAKER_IDS.Marcus;
    const dyn = computeConversationalTurnDynamics(cleanTurns, idx);
    const lengthScaleAdj = dyn.rate === '+2%' ? 0.96 : dyn.rate === '-1%' ? 1.01 : 0.985;

    const spokenText = humanizeNflTextForTts(turn.text);
    const sentences = splitTurnIntoSentences(spokenText);
    const sentenceFloatParts = [];

    for (let sIdx = 0; sIdx < sentences.length; sIdx++) {
      const rawF32 = await synthesizeSentenceFloat32(
        engine,
        sentences[sIdx],
        speakerId,
        lengthScaleAdj
      );
      if (rawF32.length > 0) {
        const trimmed = trimAndFadeTurnPcm(float32ToInt16(rawF32), sampleRate, {
          threshold: 95,
          leadPadMs: 22,
          trailPadMs: 38,
          fadeMs: 10
        });
        if (trimmed.length > 0) {
          sentenceFloatParts.push(trimmed);
        }
      }
    }

    // Concatenate sentences inside the turn with natural 95ms breath pauses
    const totalTurnSamples =
      sentenceFloatParts.reduce((acc, arr) => acc + arr.length, 0) +
      Math.max(0, sentenceFloatParts.length - 1) * intraSentenceGapSamples;

    const mergedTurn = new Float64Array(Math.max(1, totalTurnSamples));
    let writePos = 0;
    for (let p = 0; p < sentenceFloatParts.length; p++) {
      mergedTurn.set(sentenceFloatParts[p], writePos);
      writePos += sentenceFloatParts[p].length;
      if (p < sentenceFloatParts.length - 1) {
        writePos += intraSentenceGapSamples;
      }
    }

    const conditioned = conditionTurnVoicePcm(mergedTurn, sampleRate, 0.122);
    conditionedTurns.push(conditioned);
    gapSamplesAfterTurn.push(Math.round((dyn.gapAfterMs / 1000) * sampleRate));

    const synthPct = 32 + Math.round(((idx + 1) / cleanTurns.length) * 60);
    self.postMessage({
      type: 'progress',
      jobId,
      subPercent: synthPct,
      turnIndex: idx + 1,
      totalTurns: cleanTurns.length,
      detail: `Synthesizing studio audio turn ${idx + 1} of ${cleanTurns.length} (${speaker})…`
    });
  }

  self.postMessage({
    type: 'progress',
    jobId,
    subPercent: 95,
    detail: 'Mastering 2-channel Stereo broadcast bus (-14 LUFS warmth EQ & true-peak limiter)…'
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
