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

export class PodcastAudioController {
  constructor(onStateChange) {
    this.onStateChange = onStateChange;
    this.audio = new Audio();
    this.audio.preload = 'metadata';

    this.currentEpisode = null;
    this.isPlaying = false;
    this.currentTimeSec = 0;
    this.durationSec = 0;
    this.speedIdx = 0;
    this.usingSpeechSynthesis = false;
    this._speechTimer = null;
    this._speechGapTimeout = null;
    this._speechSessionId = 0;
    this._speechStartRealMs = 0;
    this._speechOffsetSec = 0;
    this._cachedVoices = [];

    this._bindAudioEvents();
    this._preloadBrowserVoices();
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

    const isSameEpisode = this.currentEpisode && this.currentEpisode.id === episode.id;
    this.currentEpisode = episode;
    this.durationSec = Number(episode.durationSec || 120);
    this._setupMediaSession(episode);

    if (episode.audioUrl) {
      this.usingSpeechSynthesis = false;
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
      // Browser multi-voice Web Speech synthesis for instant custom client-generated episodes
      this.audio.pause();
      this.usingSpeechSynthesis = true;
      this._startSpeechSynthesisFrom(startSec);
    }
  }

  _startSpeechSynthesisFrom(startSec = 0) {
    this._stopSpeechSynthesis();
    if (!this.currentEpisode) return;
    const sessionId = ++this._speechSessionId;
    this._speechOffsetSec = Math.max(0, Math.min(this.durationSec, startSec));
    this.currentTimeSec = this._speechOffsetSec;
    this.isPlaying = true;
    this._speechStartRealMs = Date.now();

    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      try {
        window.speechSynthesis.cancel();
        const allTurns = this.currentEpisode.transcript || [];
        const startIdx = allTurns.findIndex(t => t.endSec > startSec);
        const liveVoices = window.speechSynthesis.getVoices();
        const voices =
          Array.isArray(liveVoices) && liveVoices.length > 0 ? liveVoices : this._cachedVoices;
        const { maleVoice, femaleVoice } = selectBestBrowserVoices(voices);

        const speakTurnAt = turnIdx => {
          if (sessionId !== this._speechSessionId || !this.isPlaying) return;
          if (turnIdx < 0 || turnIdx >= allTurns.length) return;

          const turn = allTurns[turnIdx];
          const dyn = computeConversationalTurnDynamics(allTurns, turnIdx);
          const spoken = humanizeNflTextForTts(turn.text);
          const utt = new SpeechSynthesisUtterance(spoken);

          const rateAdj = dyn.rate === '+2%' ? 1.02 : dyn.rate === '-1%' ? 0.98 : 1.0;
          utt.rate = Math.max(0.75, Math.min(2.2, this.playbackRate * rateAdj));
          utt.pitch = turn.speaker === 'Elena' ? 1.03 : 0.97;

          if (turn.speaker === 'Elena' && femaleVoice) utt.voice = femaleVoice;
          else if (maleVoice) utt.voice = maleVoice;

          utt.onstart = () => {
            if (sessionId !== this._speechSessionId || !this.isPlaying) return;
            this._speechOffsetSec = turn.startSec;
            this._speechStartRealMs = Date.now();
            this.currentTimeSec = turn.startSec;
            this._emit();
          };

          utt.onend = () => {
            if (sessionId !== this._speechSessionId || !this.isPlaying) return;
            const nextIdx = turnIdx + 1;
            if (nextIdx >= allTurns.length) return;
            const pauseMs = Math.max(90, Math.round(dyn.gapAfterMs / this.playbackRate));
            this._speechGapTimeout = setTimeout(() => speakTurnAt(nextIdx), pauseMs);
          };

          window.speechSynthesis.speak(utt);
        };

        if (startIdx >= 0) {
          speakTurnAt(startIdx);
        }
      } catch {}
    }

    this._speechTimer = setInterval(() => {
      if (!this.isPlaying) return;
      const elapsed = ((Date.now() - this._speechStartRealMs) / 1000) * this.playbackRate;
      this.currentTimeSec = Math.min(this.durationSec, this._speechOffsetSec + elapsed);
      if (this.currentTimeSec >= this.durationSec) {
        this._stopSpeechSynthesis();
        this.isPlaying = false;
        this.currentTimeSec = 0;
      }
      this._emit();
    }, 250);

    this._emit();
  }

  _stopSpeechSynthesis() {
    this._speechSessionId++;
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
    if (this.usingSpeechSynthesis) {
      this._startSpeechSynthesisFrom(this.currentTimeSec);
      return;
    }
    try {
      this.audio.playbackRate = this.playbackRate;
      await this.audio.play();
      this.isPlaying = true;
    } catch {
      this.isPlaying = false;
    }
    this._emit();
  }

  pause() {
    if (this.usingSpeechSynthesis) {
      this._stopSpeechSynthesis();
      this.isPlaying = false;
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
