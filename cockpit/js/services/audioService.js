/**
 * ============================================================================
 * JARVIS COCKPIT — WEB AUDIO PROCEDURAL SOUND SYNTHESIZER
 * ============================================================================
 * Generates futuristic sci-fi sound effects directly in the browser
 * using the Web Audio API. Zero external audio files required.
 * ============================================================================
 */

export class AudioService {
  constructor() {
    this.ctx = null;
    this.isMuted = false;
    this.engineOsc = null;
    this.engineGain = null;
    this.emergencyOsc = null;
    this.emergencyGain = null;
    this.emergencyInterval = null;

    // Initialize on first user gesture to comply with browser autoplay policies
    this.initAudioContext();
  }

  initAudioContext() {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (AudioContext && !this.ctx) {
      this.ctx = new AudioContext();
    }
  }

  ensureContext() {
    if (!this.ctx) {
      this.initAudioContext();
    }
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume();
    }
  }

  setMute(mute) {
    this.isMuted = mute;
    if (this.isMuted) {
      this.stopEngineHum();
      this.stopEmergencySiren();
    }
  }

  toggleMute() {
    this.setMute(!this.isMuted);
    return this.isMuted;
  }

  /**
   * Crisp high-tech tactile HUD chirp
   */
  playChirp(freq = 1200, duration = 0.04) {
    if (this.isMuted) return;
    this.ensureContext();
    if (!this.ctx) return;

    try {
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();

      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, this.ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(freq * 1.5, this.ctx.currentTime + duration);

      gain.gain.setValueAtTime(0.08, this.ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + duration);

      osc.connect(gain);
      gain.connect(this.ctx.destination);

      osc.start();
      osc.stop(this.ctx.currentTime + duration);
    } catch (e) {
      // AudioContext policy suppression
    }
  }

  /**
   * Continuous turbine/electric motor hum modulated by vehicle speed
   */
  updateEngineHum(speed, isMoving) {
    if (this.isMuted || !isMoving || speed === 0) {
      this.stopEngineHum();
      return;
    }
    this.ensureContext();
    if (!this.ctx) return;

    try {
      if (!this.engineOsc) {
        this.engineOsc = this.ctx.createOscillator();
        this.engineGain = this.ctx.createGain();

        this.engineOsc.type = 'sawtooth';
        this.engineGain.gain.setValueAtTime(0.001, this.ctx.currentTime);

        // Low-pass filter to give a deep cockpit turbine hum
        const filter = this.ctx.createBiquadFilter();
        filter.type = 'lowpass';
        filter.frequency.setValueAtTime(320, this.ctx.currentTime);

        this.engineOsc.connect(filter);
        filter.connect(this.engineGain);
        this.engineGain.connect(this.ctx.destination);

        this.engineOsc.start();
      }

      // Modulate frequency from 60Hz to 240Hz based on speed (0-255)
      const targetFreq = 65 + (speed / 255) * 175;
      this.engineOsc.frequency.setTargetAtTime(targetFreq, this.ctx.currentTime, 0.08);
      this.engineGain.gain.setTargetAtTime(0.05, this.ctx.currentTime, 0.05);

    } catch (e) {}
  }

  stopEngineHum() {
    if (this.engineGain && this.ctx) {
      try {
        this.engineGain.gain.setTargetAtTime(0.001, this.ctx.currentTime, 0.05);
        setTimeout(() => {
          if (this.engineOsc) {
            this.engineOsc.stop();
            this.engineOsc.disconnect();
            this.engineOsc = null;
          }
        }, 80);
      } catch (e) {}
    }
  }

  /**
   * High-priority pulsing red emergency klaxon
   */
  startEmergencySiren() {
    if (this.isMuted) return;
    this.ensureContext();
    if (!this.ctx) return;

    this.stopEmergencySiren();

    let toggle = false;
    this.emergencyInterval = setInterval(() => {
      if (this.isMuted) return;
      toggle = !toggle;
      const freq = toggle ? 880 : 660; // Dual tone siren
      this.playTone(freq, 0.28, 0.14, 'triangle');
    }, 320);
  }

  stopEmergencySiren() {
    if (this.emergencyInterval) {
      clearInterval(this.emergencyInterval);
      this.emergencyInterval = null;
    }
  }

  playTone(freq, duration, volume = 0.1, type = 'sine') {
    if (this.isMuted) return;
    this.ensureContext();
    if (!this.ctx) return;

    try {
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();

      osc.type = type;
      osc.frequency.setValueAtTime(freq, this.ctx.currentTime);

      gain.gain.setValueAtTime(volume, this.ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + duration);

      osc.connect(gain);
      gain.connect(this.ctx.destination);

      osc.start();
      osc.stop(this.ctx.currentTime + duration);
    } catch (e) {}
  }
}

