/**
 * Sticky Podcast Audio Player + iOS Safari Lock-Screen MediaSession Controller
 *
 * Plays all built-in `.m4a` episodes and on-demand studio-mastered 2-channel Stereo `.wav`
 * episodes through a single inline HTML5 `<audio playsinline>` element under iOS/iPadOS
 * `navigator.audioSession.type = 'playback'` (`AVAudioSessionCategoryPlayback`), ensuring
 * reliable full-duration playback on both built-in phone speakers and AirPods/Bluetooth.
 */

import {
  peekCachedEpisodeAudioUrl,
  getEpisodeAudioUrl
} from '../services/podcastAudioStore.js';

const SPEEDS = [1.0, 1.25, 1.5, 2.0];

let _cachedCarrierDataUri = null;

/**
 * Utility helper returning a valid 2-channel Stereo 16-bit PCM WAV data URI.
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

function getDirectNonStaleUrl(episode) {
  const cachedBlobUrl = peekCachedEpisodeAudioUrl(episode?.id);
  if (cachedBlobUrl) return cachedBlobUrl;
  const raw = String(episode?.audioUrl || '').trim();
  if (!raw) return null;
  // Static relative paths and HTTPS R2 streams are directly playable across reloads;
  // `blob:` URLs from prior sessions must be re-hydrated from IndexedDB unless in `peekCachedEpisodeAudioUrl`.
  if (raw.startsWith('./') || raw.startsWith('/') || /^https?:\/\//i.test(raw)) {
    return raw;
  }
  return null;
}

export class PodcastAudioController {
  constructor(onStateChange, options = {}) {
    this.onStateChange = onStateChange;
    this.onSynthesizeMissingAudio = options.onSynthesizeMissingAudio || null;
    this.audio = configureInlineAudioElement(new Audio());
    this._audioCtx = null;

    this.currentEpisode = null;
    this.isPlaying = false;
    this.isBufferingAudio = false;
    this.currentTimeSec = 0;
    this.durationSec = 0;
    this.speedIdx = 0;
    this._activeSrcUrl = '';

    this._bindAudioEvents();
  }

  /**
   * Forces iOS 16.4+ / 17 / 18 Safari & Home Screen PWA into `playback` audio session
   * (`AVAudioSessionCategoryPlayback`) so `<audio>` plays out loud through the iPhone's
   * built-in speakers even when the hardware Ring/Silent switch is on Silent Mode.
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

  /**
   * Called synchronously inside a user tap/click handler to ensure iOS WebKit switches
   * into `playback` category before starting `<audio>` playback.
   */
  primeForUserGesture() {
    this._enforcePlaybackSession();
  }

  _bindAudioEvents() {
    this.audio.addEventListener('timeupdate', () => {
      this.currentTimeSec = this.audio.currentTime || 0;
      if (this.audio.duration && Number.isFinite(this.audio.duration) && this.audio.duration > 1) {
        this.durationSec = this.audio.duration;
      }
      this._emit();
    });

    this.audio.addEventListener('loadedmetadata', () => {
      if (this.audio.duration && Number.isFinite(this.audio.duration) && this.audio.duration > 1) {
        this.durationSec = this.audio.duration;
      }
      this._emit();
    });

    this.audio.addEventListener('play', () => {
      this.isPlaying = true;
      this.isBufferingAudio = false;
      this._updateMediaSessionState('playing');
      this._emit();
    });

    this.audio.addEventListener('pause', () => {
      if (!this.audio.ended) {
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
    if (typeof navigator === 'undefined' || !('mediaSession' in navigator) || !episode) return;
    try {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: episode.title || '49ers Faithful Autopodcast',
        artist: episode.format || '49ers Faithful',
        album: 'The Faithful Analytical Briefing',
        artwork: [{ src: './assets/apple-touch-icon.png', sizes: '512x512', type: 'image/png' }]
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
    if (typeof navigator !== 'undefined' && 'mediaSession' in navigator) {
      try {
        navigator.mediaSession.playbackState = state;
      } catch {}
    }
  }

  get playbackRate() {
    return SPEEDS[this.speedIdx] || 1.0;
  }

  async _resolveEpisodeAudioSrc(episode) {
    const syncUrl = getDirectNonStaleUrl(episode);
    if (syncUrl) return syncUrl;

    const storedUrl = await getEpisodeAudioUrl(episode?.id);
    if (storedUrl) {
      episode.audioUrl = storedUrl;
      return storedUrl;
    }

    if (typeof this.onSynthesizeMissingAudio === 'function') {
      this.isBufferingAudio = true;
      this._emit();
      try {
        const renderedUrl = await this.onSynthesizeMissingAudio(episode);
        if (renderedUrl) {
          episode.audioUrl = renderedUrl;
          return renderedUrl;
        }
      } finally {
        this.isBufferingAudio = false;
      }
    }

    return episode?.audioUrl || null;
  }

  _assignAudioSrcIfNeeded(srcUrl, startSec = 0) {
    if (!srcUrl) return;
    if (this._activeSrcUrl !== srcUrl) {
      this._activeSrcUrl = srcUrl;
      this.audio.src = srcUrl;
      try {
        this.audio.load();
      } catch {}
    }
    this.audio.muted = false;
    this.audio.volume = 1.0;
    this.audio.playbackRate = this.playbackRate;
    try {
      this.audio.currentTime = Math.max(0, startSec);
    } catch {}
  }

  /**
   * Preloads an episode into the Ready-to-Play state (0:00 / duration) without auto-starting
   * audio, so clicking Play subsequently starts `<audio>` synchronously inside the user's tap!
   */
  async loadEpisodeReady(episode) {
    if (!episode) return;
    if (!this.audio.paused) {
      this.audio.pause();
    }
    this.currentEpisode = episode;
    this.isPlaying = false;
    this.currentTimeSec = 0;
    this.durationSec = Number(episode.durationSec || 180);
    this._setupMediaSession(episode);
    this._updateMediaSessionState('paused');

    const srcUrl = await this._resolveEpisodeAudioSrc(episode);
    if (srcUrl) {
      this._assignAudioSrcIfNeeded(srcUrl, 0);
    }
    this._emit();
  }

  async loadAndPlay(episode, startSec = 0) {
    if (!episode) return;
    this._enforcePlaybackSession();

    this.currentEpisode = episode;
    this.durationSec = Number(episode.durationSec || 180);
    this.currentTimeSec = Math.max(0, startSec);
    this._setupMediaSession(episode);

    // Fast synchronous path inside the user gesture whenever URL is already resolved!
    const syncUrl = getDirectNonStaleUrl(episode);
    if (syncUrl) {
      this._assignAudioSrcIfNeeded(syncUrl, startSec);
      this._emit();
      try {
        await this.audio.play();
        this.isPlaying = true;
      } catch {
        this.isPlaying = false;
      }
      this._emit();
      return;
    }

    // Unlock this exact HTMLAudioElement instance synchronously inside the tap before awaiting IDB/worker
    try {
      this.audio.load();
    } catch {}
    this._emit();

    const asyncUrl = await this._resolveEpisodeAudioSrc(episode);
    if (!asyncUrl) {
      this.isPlaying = false;
      this._emit();
      return;
    }

    this._assignAudioSrcIfNeeded(asyncUrl, startSec);
    try {
      await this.audio.play();
      this.isPlaying = true;
    } catch {
      this.isPlaying = false;
    }
    this._emit();
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

    if (!this._activeSrcUrl) {
      await this.loadAndPlay(this.currentEpisode, this.currentTimeSec);
      return;
    }

    try {
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
    try {
      this.audio.pause();
    } catch {}
    this.isPlaying = false;
    this._updateMediaSessionState('paused');
    this._emit();
  }

  closePlayer() {
    this.pause();
    this.currentEpisode = null;
    this.currentTimeSec = 0;
    this._activeSrcUrl = '';
    this._emit();
  }

  seekTo(targetSec) {
    if (!this.currentEpisode) return;
    const clamped = Math.max(0, Math.min(this.durationSec || 3600, Number(targetSec || 0)));
    this.currentTimeSec = clamped;
    try {
      this.audio.currentTime = clamped;
    } catch {}
    this._emit();
  }

  skip(deltaSec) {
    this.seekTo(this.currentTimeSec + deltaSec);
  }

  cycleSpeed() {
    this.speedIdx = (this.speedIdx + 1) % SPEEDS.length;
    this.audio.playbackRate = this.playbackRate;
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
        isBufferingAudio: this.isBufferingAudio,
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
