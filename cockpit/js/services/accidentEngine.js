/**
 * ============================================================================
 * JARVIS COCKPIT — ACCIDENT DETECTION ENGINE & BLACKBOX RECORDER
 * ============================================================================
 * Evaluates acceleration impulses, angular velocities, rollover angles,
 * executes 4-stage accident verification state machine, and logs incidents.
 * ============================================================================
 */

export class AccidentEngine {
  constructor(audioService, telemetryService) {
    this.audio = audioService;
    this.telemetry = telemetryService;

    this.state = 0; // 0: NORMAL, 1: IMPACT_SUSPECTED, 2: VERIFYING, 3: CONFIRMED
    this.cancelCountdown = 5;
    this.countdownTimer = null;
    this.currentIncident = null;
    this.history = [];

    this.onStateChangeCallback = null;
  }

  setStateChangeCallback(cb) {
    this.onStateChangeCallback = cb;
  }

  processTelemetry(telemetry) {
    if (!telemetry) return;

    // Check if firmware has flagged an accident state
    const fwAccState = telemetry.accident ? telemetry.accident.state : 0;

    if (fwAccState === 3 && this.state !== 3 && this.state !== 2) {
      // Confirmed by hardware
      this.triggerAccident(telemetry, true);
    } else if (fwAccState === 1 && this.state === 0) {
      this.triggerSuspected(telemetry);
    }

    // Client-side fallback check (in case sensor spikes before firmware packet)
    if (this.state === 0 && telemetry.mpu) {
      const g = telemetry.mpu.totalG || 1.0;
      const roll = Math.abs(telemetry.mpu.roll || 0);
      const pitch = Math.abs(telemetry.mpu.pitch || 0);

      if (g > 3.4 || roll > 58.0 || pitch > 58.0) {
        this.triggerSuspected(telemetry);
      }
    }
  }

  triggerSuspected(telemetry) {
    if (this.state !== 0) return;
    this.state = 1;
    this.audio.playTone(550, 0.2, 0.15, 'square');

    // Enter countdown verification
    this.startCountdown(telemetry);

    if (this.onStateChangeCallback) {
      this.onStateChangeCallback({
        state: this.state,
        countdown: this.cancelCountdown,
        incident: this.currentIncident
      });
    }
  }

  startCountdown(telemetry) {
    this.cancelCountdown = 5;
    this.currentIncident = {
      timestamp: new Date().toLocaleTimeString(),
      peakG: telemetry.mpu ? telemetry.mpu.totalG : 3.8,
      roll: telemetry.mpu ? telemetry.mpu.roll : 0,
      pitch: telemetry.mpu ? telemetry.mpu.pitch : 0,
      lat: telemetry.gps && telemetry.gps.fix ? telemetry.gps.lat : null,
      lng: telemetry.gps && telemetry.gps.fix ? telemetry.gps.lng : null,
      alt: telemetry.gps ? telemetry.gps.alt : 0,
      temp: telemetry.temp ? telemetry.temp.celsius : null
    };

    if (this.countdownTimer) clearInterval(this.countdownTimer);

    this.countdownTimer = setInterval(() => {
      this.cancelCountdown--;
      this.audio.playTone(700, 0.1, 0.12, 'sawtooth');

      if (this.cancelCountdown <= 0) {
        clearInterval(this.countdownTimer);
        this.countdownTimer = null;
        this.confirmAccident();
      }

      if (this.onStateChangeCallback) {
        this.onStateChangeCallback({
          state: this.state,
          countdown: this.cancelCountdown,
          incident: this.currentIncident
        });
      }
    }, 1000);
  }

  confirmAccident() {
    this.state = 3; // Confirmed
    this.audio.startEmergencySiren();

    if (this.currentIncident) {
      this.history.unshift({ ...this.currentIncident, id: Date.now() });
      if (this.history.length > 20) this.history.pop();
    }

    if (this.onStateChangeCallback) {
      this.onStateChangeCallback({
        state: this.state,
        countdown: 0,
        incident: this.currentIncident,
        history: this.history
      });
    }
  }

  triggerAccident(telemetry, immediate = false) {
    if (immediate) {
      if (this.countdownTimer) clearInterval(this.countdownTimer);
      this.countdownTimer = null;
      this.currentIncident = {
        timestamp: new Date().toLocaleTimeString(),
        peakG: telemetry.accident ? telemetry.accident.peakG : 3.9,
        roll: telemetry.accident ? telemetry.accident.impactRoll : 0,
        pitch: telemetry.accident ? telemetry.accident.impactPitch : 0,
        lat: telemetry.gps && telemetry.gps.fix ? telemetry.gps.lat : null,
        lng: telemetry.gps && telemetry.gps.fix ? telemetry.gps.lng : null,
        alt: telemetry.gps ? telemetry.gps.alt : 0,
        temp: telemetry.temp ? telemetry.temp.celsius : null
      };
      this.confirmAccident();
    }
  }

  cancelAlarm() {
    if (this.countdownTimer) {
      clearInterval(this.countdownTimer);
      this.countdownTimer = null;
    }
    this.audio.stopEmergencySiren();
    this.audio.playChirp(800, 0.15);

    this.state = 0; // Normal
    this.cancelCountdown = 5;
    this.telemetry.sendCommand('CMD:RESET_ACCIDENT');

    if (this.onStateChangeCallback) {
      this.onStateChangeCallback({
        state: this.state,
        countdown: 0,
        incident: null,
        history: this.history
      });
    }
  }
}

