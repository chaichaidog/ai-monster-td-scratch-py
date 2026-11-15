/**
 * Lightweight Web Audio synthesizer for 2D Tower Defense feedback.
 */
class SoundEngine {
  constructor() {
    this.ctx = null;
    this.muted = false;
  }

  ensureContext() {
    if (this.muted) return null;
    if (!this.ctx && typeof window !== 'undefined') {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (AudioCtx) {
        this.ctx = new AudioCtx();
      }
    }
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {});
    }
    return this.ctx;
  }

  toggleMute() {
    this.muted = !this.muted;
    return this.muted;
  }

  playTone(freq, duration, type = 'sine', volume = 0.06, slideTo = null) {
    const ctx = this.ensureContext();
    if (!ctx) return;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = type;
    osc.frequency.setValueAtTime(freq, now);
    if (slideTo) {
      osc.frequency.exponentialRampToValueAtTime(slideTo, now + duration);
    }

    gain.gain.setValueAtTime(volume, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + duration);

    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + duration);
  }

  playShot(isLoop = false, weapon = 'laser') {
    if (weapon === 'chain') {
      this.playTone(840, 0.08, 'sawtooth', 0.03, 320);
    } else if (weapon === 'plasma') {
      this.playTone(260, 0.11, 'square', 0.035, 110);
    } else if (weapon === 'frost') {
      this.playTone(720, 0.08, 'sine', 0.03, 480);
    } else {
      this.playTone(isLoop ? 640 : 520, 0.07, 'triangle', 0.035, 240);
    }
  }

  playShieldBreak() {
    this.playTone(920, 0.14, 'sawtooth', 0.05, 300);
  }

  playKill(isBoss = false) {
    if (isBoss) {
      this.playTone(330, 0.18, 'square', 0.07, 660);
      setTimeout(() => this.playTone(550, 0.25, 'triangle', 0.07, 880), 90);
    } else {
      this.playTone(380, 0.1, 'sine', 0.045, 720);
    }
  }

  playSkill(kind) {
    if (kind === 'orbital') {
      this.playTone(220, 0.35, 'sawtooth', 0.08, 80);
    } else if (kind === 'emp') {
      this.playTone(980, 0.3, 'sine', 0.07, 260);
    } else {
      this.playTone(523.25, 0.15, 'triangle', 0.06, 783.99);
    }
  }

  playBlockSnap() {
    this.playTone(580, 0.05, 'triangle', 0.04, 720);
  }

  playTurnSwitch() {
    this.playTone(523.25, 0.1, 'sine', 0.06);
    setTimeout(() => this.playTone(659.25, 0.14, 'sine', 0.06), 90);
  }

  playWaveAlert() {
    this.playTone(440, 0.12, 'triangle', 0.06);
    setTimeout(() => this.playTone(587.33, 0.18, 'triangle', 0.06), 120);
  }

  playVictory() {
    [523.25, 659.25, 783.99, 1046.5].forEach((note, i) => {
      setTimeout(() => this.playTone(note, 0.22, 'triangle', 0.07), i * 110);
    });
  }

  playDefeat() {
    [392, 349.23, 293.66].forEach((note, i) => {
      setTimeout(() => this.playTone(note, 0.25, 'sawtooth', 0.055), i * 150);
    });
  }
}

window.SoundEngine = SoundEngine;
