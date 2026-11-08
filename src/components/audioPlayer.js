/**
 * Sticky Podcast Audio Player + iOS Safari Lock-Screen MediaSession Controller
 * Supports both studio-mastered neural AAC/M4A/MP3 audio files AND natural multi-voice
 * Web Speech playback (with Premium/Enhanced/Neural voice ranking, spoken-football
 * text humanization, and conversational breath pacing) for instant custom topics!
 */

import {
  humanizeNflTextForTts,
  computeConversationalTurnDynamics,
  selectBestBrowserVoices
} from '../engine/podcastSpeechEngine.js';

const SPEEDS = [1.0, 1.25, 1.5, 2.0];

let _cachedCarrierDataUri = null;

/**
 * Generates a valid 1-second 2-channel Stereo 16-bit PCM WAV data URI with -84 dBFS (±2 LSB)
 * inaudible dither. Playing this in a looping `<audio playsinline>` element while
 * `window.speechSynthesis` is active forces iOS Safari / Home Screen PWA out of the
 * `Ambient` audio session (which mutes the built-in iPhone speaker when Silent Mode is ON
 * unless AirPods are connected) and locks it into `AVAudioSessionCategoryPlayback` so audio
 * always plays out loud through the iPhone speaker.
 */
export function buildSilentPlaybackCarrierWavDataUri(sampleRate = 8000, durationSec = 1) {
  if (_cachedCarrierDataUri && sampleRate === 8000 && durationSec === 1) {
    return _cachedCarrierDataUri;
  }
  const numChannels = 2;
  const numFrames = Math.max(64, Math.floor(sampleRate * durationSec));
  const dataBytes = numFrames * numChannels * 2;
  const totalBytes = 44 + dataBytes;
  const buf = new ArrayBuffer(totalBytes);
  const view = new DataView(buf);
  const writeAscii = (offset, str) => {
    for (let i = 0; i < str.length; i++) {
      view.setUint8(offset + i, str.charCodeAt(i));
    }
  };

  writeAscii(0, 'RIFF');
  view.setUint32(4, 36 + dataBytes, true);
  writeAscii(8, 'WAVE');
  writeAscii(12, 'fmt ');
  view.setUint32(16, 16, true); // PCM chunk size
  view.setUint16(20, 1, true); // PCM format = 1
  view.setUint16(22, numChannels, true); // 2 channels (Stereo L+R)
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * numChannels * 2, true);
  view.setUint16(32, numChannels * 2, true);
  view.setUint16(34, 16, true); // 16-bit
  writeAscii(36, 'data');
  view.setUint32(40, dataBytes, true);

  // Write ±2 LSB (-84 dBFS) alternating dither so iOS CoreAudio never gates the stream as digital zero
  let byteOffset = 44;
  for (let i = 0; i < numFrames; i++) {
    const sample = i % 2 === 0 ? 2 : -2;
    view.setInt16(byteOffset, sample, true);
    view.setInt16(byteOffset + 2, sample, true);
    byteOffset += 4;
  }

  const bytes = new Uint8Array(buf);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  const b64 =
    typeof btoa === 'function'
      ? btoa(binary)
      : Buffer.from(bytes).toString('base64');
  const uri = `data:audio/wav;base64,${b64}`;
  if (sampleRate === 8000 && durationSec === 1) {
    _cachedCarrierDataUri = uri;
  }
  return uri;
}

function configureInlineAudioElement(el) {
  if (!el) return el;
  el.preload = 'auto';
  el.playsInline = true;
  el.muted = false;
  el.volume = 1.0;
  try {
    el.setAttribute('playsinline', '');
    el.setAttribute('webkit-playsinline', '');
  } catch {}
  return el;
}

export class PodcastAudioController {
  constructor(onStateChange) {
    this.onStateChange = onStateChange;
    this.audio = configureInlineAudioElement(new Audio());
    this.carrierAudio = configureInlineAudioElement(new Audio(buildSilentPlaybackCarrierWavDataUri()));
    this.carrierAudio.loop = true;
    this._audioCtx = null;

    this.currentEpisode = null;
    this.isPlaying = false;
    this.currentTimeSec = 0;
    this.durationSec = 0;
    this.speedIdx = 0;
    this.usingSpeechSynthesis = false;
    this._speechTimer = null;
    this._speechGapTimeout = null;
    this._turnWatchdogTimer = null;
    this._speechSessionId = 0;
    this._speechStartRealMs = 0;
    this._speechOffsetSec = 0;
    this._cachedVoices = [];

    this._bindAudioEvents();
    this._preloadBrowserVoices();
  }

  /**
   * Forces iOS 16.4+ / 17 / 18 Safari & Home Screen PWA into `playback` audio session
   * (`AVAudioSessionCategoryPlayback`) so audio plays through the iPhone's built-in speakers
   * even when the hardware Ring/Silent switch is on Silent Mode (without requiring AirPods).
   */
  _enforcePlaybackSession() {
    if (typeof navigator !== 'undefined' && navigator.audioSession) {
      try {
        navigator.audioSession.type = 'playback';
      } catch {}
    }
    if (typeof window !== 'undefined') {
      try {
        const Ctx = window.AudioContext || window.webkitAudioContext;
        if (Ctx) {
          if (!this._audioCtx) {
            this._audioCtx = new Ctx();
          }
          if (this._audioCtx.state === 'suspended') {
            this._audioCtx.resume().catch(() => {});
          }
        }
      } catch {}
    }
  }

  _startCarrierAudio() {
    this._enforcePlaybackSession();
    if (!this.carrierAudio) return;
    try {
      this.carrierAudio.muted = false;
      this.carrierAudio.volume = 1.0;
      if (!this.carrierAudio.src) {
        this.carrierAudio.src = buildSilentPlaybackCarrierWavDataUri();
      }
      if (this.carrierAudio.paused) {
        const p = this.carrierAudio.play();
        if (p && typeof p.catch === 'function') p.catch(() => {});
      }
    } catch {}
  }

  _stopCarrierAudio() {
    if (!this.carrierAudio) return;
    try {
      if (!this.carrierAudio.paused) {
        this.carrierAudio.pause();
      }
    } catch {}
  }

  /**
   * Must be called synchronously inside a user `click` / `touchend` handler before any
   * `await` (such as `await generateOnDemandAutopodcast(...)`). Unlocks:
   * 1. `navigator.audioSession.type = 'playback'`
   * 2. The HTML5 `<audio>` carrier stream (`AVAudioSessionCategoryPlayback` on iPhone speaker)
   * 3. Web Audio `AudioContext`
   * 4. `window.speechSynthesis` user-activation token so speech after a 1.2s+ async wait
   *    is never blocked or muted by iOS WebKit.
   */
  primeForUserGesture() {
    this._enforcePlaybackSession();
    this._startCarrierAudio();
    try {
      if (this._audioCtx) {
        const buf = this._audioCtx.createBuffer(1, 1, 22050);
        const src = this._audioCtx.createBufferSource();
        src.buffer = buf;
        src.connect(this._audioCtx.destination);
        src.start(0);
      }
    } catch {}
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      try {
        window.speechSynthesis.resume();
        if (!window.speechSynthesis.speaking && !window.speechSynthesis.pending) {
          const warm = new SpeechSynthesisUtterance(' ');
          warm.volume = 0.01;
          warm.rate = 2.0;
          warm.lang = 'en-US';
          window.speechSynthesis.speak(warm);
        }
      } catch {}
    }
  }

  _preloadBrowserVoices() {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;
    try {
      const refresh = () => {
        try {
          const list = window.speechSynthesis.getVoices();
          if (Array.isArray(list) && list.length > 0) {
            this._cachedVoices = list;
          }
        } catch {}
      };
      refresh();
      if (typeof window.speechSynthesis.addEventListener === 'function') {
        window.speechSynthesis.addEventListener('voiceschanged', refresh);
      } else {
        window.speechSynthesis.onvoiceschanged = refresh;
      }
    } catch {}
  }

  _bindAudioEvents() {
    this.audio.addEventListener('timeupdate', () => {
      if (this.usingSpeechSynthesis) return;
      this.currentTimeSec = this.audio.currentTime || 0;
      if (this.audio.duration && Number.isFinite(this.audio.duration)) {
        this.durationSec = this.audio.duration;
      }
      this._emit();
    });

    this.audio.addEventListener('loadedmetadata', () => {
      if (this.audio.duration && Number.isFinite(this.audio.duration)) {
        this.durationSec = this.audio.duration;
      }
      this._emit();
    });

    this.audio.addEventListener('play', () => {
      this.isPlaying = true;
      this._updateMediaSessionState('playing');
      this._emit();
    });

    this.audio.addEventListener('pause', () => {
      if (!this.usingSpeechSynthesis) {
        this.isPlaying = false;
        this._updateMediaSessionState('paused');
        this._emit();
      }
    });

    this.audio.addEventListener('ended', () => {
      this.isPlaying = false;
      this.currentTimeSec = 0;
      this._updateMediaSessionState('none');
      this._emit();
    });
  }

  _setupMediaSession(episode) {
    if (!('mediaSession' in navigator) || !episode) return;
    try {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: episode.title || '49ers Faithful Autopodcast',
        artist: episode.format || '49ers Faithful',
        album: 'The Faithful Analytical Briefing',
        artwork: [
          { src: './assets/apple-touch-icon.png', sizes: '512x512', type: 'image/png' }
        ]
      });

      navigator.mediaSession.setActionHandler('play', () => this.play());
      navigator.mediaSession.setActionHandler('pause', () => this.pause());
      navigator.mediaSession.setActionHandler('seekbackward', () => this.skip(-15));
      navigator.mediaSession.setActionHandler('seekforward', () => this.skip(30));
      navigator.mediaSession.setActionHandler('seekto', details => {
        if (details && typeof details.seekTime === 'number') {
          this.seekTo(details.seekTime);
        }
      });
    } catch {
      // Ignore unsupported MediaSession action handlers on older browsers
    }
  }

  _updateMediaSessionState(state) {
    if ('mediaSession' in navigator) {
      try {
        navigator.mediaSession.playbackState = state;
      } catch {}
    }
  }

  get playbackRate() {
    return SPEEDS[this.speedIdx] || 1.0;
  }

  async loadAndPlay(episode, startSec = 0) {
    if (!episode) return;
    this._stopSpeechSynthesis();
    this._enforcePlaybackSession();

    const isSameEpisode = this.currentEpisode && this.currentEpisode.id === episode.id;
    this.currentEpisode = episode;
    this.durationSec = Number(episode.durationSec || 120);
    this._setupMediaSession(episode);

    if (episode.audioUrl) {
      this.usingSpeechSynthesis = false;
      this._stopCarrierAudio();
      this.audio.muted = false;
      this.audio.volume = 1.0;
      if (!isSameEpisode || !this.audio.src.endsWith(episode.audioUrl.replace(/^\.\//, ''))) {
        this.audio.src = episode.audioUrl;
      }
      this.audio.playbackRate = this.playbackRate;
      this.audio.currentTime = Math.max(0, startSec);
      this.currentTimeSec = Math.max(0, startSec);
      // Emit immediately so Mini-Player and Transcript mount without waiting on network buffer
      this._emit();
      try {
        await this.audio.play();
        this.isPlaying = true;
      } catch {
        // Autoplay blocked in headless test or un-interacted context; still mark loaded
        this.isPlaying = false;
      }
      this._emit();
    } else {
      // Browser multi-voice Web Speech synthesis for instant custom client-generated episodes.
      // Keep `this.carrierAudio` looping in Playback mode so iOS does not mute built-in speakers!
      this.audio.pause();
      this.usingSpeechSynthesis = true;
      this._startCarrierAudio();
      this._startSpeechSynthesisFrom(startSec);
    }
  }

  _startSpeechSynthesisFrom(startSec = 0) {
    this._stopSpeechSynthesis();
    if (!this.currentEpisode) return;
    this._enforcePlaybackSession();
    this._startCarrierAudio();

    const sessionId = ++this._speechSessionId;
    this._speechOffsetSec = Math.max(0, Math.min(this.durationSec, startSec));
    this.currentTimeSec = this._speechOffsetSec;
    this.isPlaying = true;
    this._speechStartRealMs = Date.now();
    this._updateMediaSessionState('playing');

    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      try {
        window.speechSynthesis.cancel();
        window.speechSynthesis.resume();
        const allTurns = this.currentEpisode.transcript || [];
        const startIdx = allTurns.findIndex(t => t.endSec > startSec);
        const liveVoices = window.speechSynthesis.getVoices();
        const voices =
          Array.isArray(liveVoices) && liveVoices.length > 0 ? liveVoices : this._cachedVoices;
        const { maleVoice, femaleVoice } = selectBestBrowserVoices(voices);

        const speakTurnAt = (turnIdx, forceDefaultVoice = false) => {
          if (sessionId !== this._speechSessionId || !this.isPlaying) return;
          if (turnIdx < 0 || turnIdx >= allTurns.length) return;

          const turn = allTurns[turnIdx];
          const dyn = computeConversationalTurnDynamics(allTurns, turnIdx);
          const spoken = humanizeNflTextForTts(turn.text);
          const utt = new SpeechSynthesisUtterance(spoken);

          const rateAdj = dyn.rate === '+2%' ? 1.02 : dyn.rate === '-1%' ? 0.98 : 1.0;
          utt.rate = Math.max(0.75, Math.min(2.2, this.playbackRate * rateAdj));
          utt.pitch = turn.speaker === 'Elena' ? 1.03 : 0.97;
          utt.volume = 1.0;

          const chosenVoice = !forceDefaultVoice
            ? turn.speaker === 'Elena'
              ? femaleVoice || maleVoice
              : maleVoice || femaleVoice
            : null;
          if (chosenVoice) {
            try {
              utt.voice = chosenVoice;
            } catch {}
          }
          utt.lang = chosenVoice?.lang || 'en-US';

          let hasStarted = false;
          if (this._turnWatchdogTimer) {
            clearTimeout(this._turnWatchdogTimer);
            this._turnWatchdogTimer = null;
          }

          // iOS speaker watchdog: if a selected voice object fails to fire `onstart` within
          // 900ms (e.g. un-downloaded cloud voice stub on iPhone speaker), retry with system default.
          if (chosenVoice && !forceDefaultVoice) {
            this._turnWatchdogTimer = setTimeout(() => {
              if (sessionId !== this._speechSessionId || !this.isPlaying || hasStarted) return;
              try {
                window.speechSynthesis.cancel();
                window.speechSynthesis.resume();
              } catch {}
              speakTurnAt(turnIdx, true);
            }, 900);
          }

          utt.onstart = () => {
            hasStarted = true;
            if (this._turnWatchdogTimer) {
              clearTimeout(this._turnWatchdogTimer);
              this._turnWatchdogTimer = null;
            }
            if (sessionId !== this._speechSessionId || !this.isPlaying) return;
            this._speechOffsetSec = turn.startSec;
            this._speechStartRealMs = Date.now();
            this.currentTimeSec = turn.startSec;
            this._emit();
          };

          utt.onerror = () => {
            if (this._turnWatchdogTimer) {
              clearTimeout(this._turnWatchdogTimer);
              this._turnWatchdogTimer = null;
            }
            if (sessionId !== this._speechSessionId || !this.isPlaying) return;
            if (!forceDefaultVoice && chosenVoice) {
              speakTurnAt(turnIdx, true);
            }
          };

          utt.onend = () => {
            if (this._turnWatchdogTimer) {
              clearTimeout(this._turnWatchdogTimer);
              this._turnWatchdogTimer = null;
            }
            if (sessionId !== this._speechSessionId || !this.isPlaying) return;
            const nextIdx = turnIdx + 1;
            if (nextIdx >= allTurns.length) return;
            const pauseMs = Math.max(90, Math.round(dyn.gapAfterMs / this.playbackRate));
            this._speechGapTimeout = setTimeout(() => speakTurnAt(nextIdx, forceDefaultVoice), pauseMs);
          };

          window.speechSynthesis.resume();
          window.speechSynthesis.speak(utt);
          window.speechSynthesis.resume();
        };

        if (startIdx >= 0) {
          speakTurnAt(startIdx, false);
        }
      } catch {}
    }

    this._speechTimer = setInterval(() => {
      if (!this.isPlaying) return;
      if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
        try {
          if (window.speechSynthesis.paused) {
            window.speechSynthesis.resume();
          }
        } catch {}
      }
      const elapsed = ((Date.now() - this._speechStartRealMs) / 1000) * this.playbackRate;
      this.currentTimeSec = Math.min(this.durationSec, this._speechOffsetSec + elapsed);
      if (this.currentTimeSec >= this.durationSec) {
        this._stopSpeechSynthesis();
        this._stopCarrierAudio();
        this.isPlaying = false;
        this.currentTimeSec = 0;
        this._updateMediaSessionState('none');
      }
      this._emit();
    }, 250);

    this._emit();
  }

  _stopSpeechSynthesis() {
    this._speechSessionId++;
    if (this._turnWatchdogTimer) {
      clearTimeout(this._turnWatchdogTimer);
      this._turnWatchdogTimer = null;
    }
    if (this._speechGapTimeout) {
      clearTimeout(this._speechGapTimeout);
      this._speechGapTimeout = null;
    }
    if (this._speechTimer) {
      clearInterval(this._speechTimer);
      this._speechTimer = null;
    }
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      try {
        window.speechSynthesis.cancel();
      } catch {}
    }
  }

  async togglePlayPause() {
    if (!this.currentEpisode) return;
    if (this.isPlaying) {
      this.pause();
    } else {
      await this.play();
    }
  }

  async play() {
    if (!this.currentEpisode) return;
    this._enforcePlaybackSession();
    if (this.usingSpeechSynthesis) {
      this._startCarrierAudio();
      this._startSpeechSynthesisFrom(this.currentTimeSec);
      return;
    }
    try {
      this._stopCarrierAudio();
      this.audio.muted = false;
      this.audio.volume = 1.0;
      this.audio.playbackRate = this.playbackRate;
      await this.audio.play();
      this.isPlaying = true;
    } catch {
      this.isPlaying = false;
    }
    this._emit();
  }

  pause() {
    this._stopCarrierAudio();
    if (this.usingSpeechSynthesis) {
      this._stopSpeechSynthesis();
      this.isPlaying = false;
      this._updateMediaSessionState('paused');
      this._emit();
      return;
    }
    this.audio.pause();
    this.isPlaying = false;
    this._emit();
  }

  closePlayer() {
    this.pause();
    this.currentEpisode = null;
    this.currentTimeSec = 0;
    this._emit();
  }

  seekTo(targetSec) {
    if (!this.currentEpisode) return;
    const clamped = Math.max(0, Math.min(this.durationSec || 3600, Number(targetSec || 0)));
    this.currentTimeSec = clamped;
    if (this.usingSpeechSynthesis) {
      if (this.isPlaying) this._startSpeechSynthesisFrom(clamped);
      else this._speechOffsetSec = clamped;
    } else {
      try {
        this.audio.currentTime = clamped;
      } catch {}
    }
    this._emit();
  }

  skip(deltaSec) {
    this.seekTo(this.currentTimeSec + deltaSec);
  }

  cycleSpeed() {
    this.speedIdx = (this.speedIdx + 1) % SPEEDS.length;
    if (!this.usingSpeechSynthesis) {
      this.audio.playbackRate = this.playbackRate;
    } else if (this.isPlaying) {
      this._startSpeechSynthesisFrom(this.currentTimeSec);
    }
    this._emit();
  }

  getActiveTurnIndex() {
    if (!this.currentEpisode?.transcript) return -1;
    const t = this.currentTimeSec;
    return this.currentEpisode.transcript.findIndex(
      seg => t >= seg.startSec && t <= seg.endSec + 0.35
    );
  }

  _emit() {
    if (typeof this.onStateChange === 'function') {
      this.onStateChange({
        episode: this.currentEpisode,
        isPlaying: this.isPlaying,
        currentTimeSec: this.currentTimeSec,
        durationSec: this.durationSec,
        playbackRate: this.playbackRate,
        activeTurnIdx: this.getActiveTurnIndex()
      });
    }
  }
}

export function formatTimeMmSs(seconds = 0) {
  const s = Math.max(0, Math.floor(Number(seconds || 0)));
  const mins = Math.floor(s / 60);
  const rem = s % 60;
  return `${mins}:${String(rem).padStart(2, '0')}`;
}
