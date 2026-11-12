/**
 * ============================================================================
 * JARVIS COCKPIT — EMERGENCY ACCIDENT OVERLAY COMPONENT
 * ============================================================================
 * High-priority emergency HUD overlay featuring false-alarm abort countdown,
 * impact telemetry freeze, LoRa beacon tracking, and blackbox incident history.
 * ============================================================================
 */

export class EmergencyOverlay {
  constructor(containerElement, accidentEngine) {
    this.container = containerElement;
    this.accidentEngine = accidentEngine;

    this.render();
    this.bindEvents();

    this.accidentEngine.setStateChangeCallback((state) => this.onStateChange(state));
  }

  render() {
    this.container.innerHTML = `
      <div class="emergency-overlay hidden" id="emergency-overlay">
        <div class="emergency-backdrop"></div>
        <div class="emergency-scanlines"></div>

        <div class="emergency-card">
          <!-- Verification / Abort Countdown Screen -->
          <div class="accident-verifying-box hidden" id="box-verifying">
            <div class="emergency-badge pulse-amber">⚠ IMPACT SUSPECTED // VERIFYING</div>
            <div class="countdown-circle">
              <span class="countdown-number" id="abort-countdown-num">5</span>
              <span class="countdown-unit">SEC</span>
            </div>
            <p class="abort-instruction">SUDDEN G-IMPULSE DETECTED. SYSTEM CONFIRMING CRASH EVENT.</p>
            <button class="btn-cancel-alarm" id="btn-cancel-alarm">
              CANCEL / FALSE ALARM (ABORT)
            </button>
          </div>

          <!-- Confirmed Emergency HUD Screen -->
          <div class="accident-confirmed-box hidden" id="box-confirmed">
            <div class="emergency-header">
              <span class="emergency-pulse-dot"></span>
              <h2 class="emergency-title">CRITICAL ACCIDENT CONFIRMED</h2>
              <span class="emergency-pulse-dot"></span>
            </div>

            <div class="emergency-telemetry-banner">
              <div class="em-stat">
                <span class="lbl">IMPACT FORCE</span>
                <span class="val red-glow" id="em-peak-g">4.20 g</span>
              </div>
              <div class="em-stat">
                <span class="lbl">ROLLOVER TILT</span>
                <span class="val" id="em-orientation">R: 62.4° / P: -18.2°</span>
              </div>
              <div class="em-stat">
                <span class="lbl">GPS POSITION</span>
                <span class="val" id="em-gps">SEARCHING / NO FIX</span>
              </div>
              <div class="em-stat">
                <span class="lbl">LoRa BEACON</span>
                <span class="val cyan-text" id="em-lora">TRANSMITTING (433MHz)</span>
              </div>
            </div>

            <div class="emergency-actions">
              <button class="btn-reset-safety" id="btn-reset-safety">
                RESET SYSTEM & RESUME NORMAL FLIGHT CONTROLS
              </button>
            </div>

            <!-- Incident Blackbox History -->
            <div class="blackbox-history">
              <div class="history-title">BLACKBOX TELEMETRY LOG</div>
              <div class="history-list" id="blackbox-list">
                <div class="history-empty">No prior incident logs recorded.</div>
              </div>
            </div>
          </div>
        </div>
      </div>
    `;
  }

  bindEvents() {
    const btnCancel = this.container.querySelector('#btn-cancel-alarm');
    const btnReset = this.container.querySelector('#btn-reset-safety');

    if (btnCancel) {
      btnCancel.addEventListener('click', () => {
        this.accidentEngine.cancelAlarm();
      });
    }

    if (btnReset) {
      btnReset.addEventListener('click', () => {
        this.accidentEngine.cancelAlarm();
      });
    }
  }

  onStateChange({ state, countdown, incident, history }) {
    const overlay = this.container.querySelector('#emergency-overlay');
    const boxVerifying = this.container.querySelector('#box-verifying');
    const boxConfirmed = this.container.querySelector('#box-confirmed');
    const countdownNum = this.container.querySelector('#abort-countdown-num');

    if (state === 0) {
      // Normal state: hide overlay
      if (overlay) overlay.classList.add('hidden');
      if (boxVerifying) boxVerifying.classList.add('hidden');
      if (boxConfirmed) boxConfirmed.classList.add('hidden');
      return;
    }

    if (overlay) overlay.classList.remove('hidden');

    if (state === 1 || state === 2) {
      // Impact Suspected / Verifying
      if (boxVerifying) boxVerifying.classList.remove('hidden');
      if (boxConfirmed) boxConfirmed.classList.add('hidden');
      if (countdownNum) countdownNum.textContent = countdown;
    } else if (state === 3) {
      // Confirmed Accident
      if (boxVerifying) boxVerifying.classList.add('hidden');
      if (boxConfirmed) boxConfirmed.classList.remove('hidden');

      if (incident) {
        this.setText('#em-peak-g', `${incident.peakG.toFixed(2)} g`);
        this.setText('#em-orientation', `R: ${incident.roll.toFixed(1)}° | P: ${incident.pitch.toFixed(1)}°`);
        if (incident.lat && incident.lng) {
          this.setText('#em-gps', `${incident.lat.toFixed(5)}°N, ${incident.lng.toFixed(5)}°E`);
        } else {
          this.setText('#em-gps', 'GPS UNAVAILABLE (NO FIX)');
        }
      }

      this.updateHistoryList(history);
    }
  }

  updateHistoryList(history) {
    const listEl = this.container.querySelector('#blackbox-list');
    if (!listEl || !history || history.length === 0) return;

    listEl.innerHTML = history.map(item => `
      <div class="history-item">
        <span class="hist-time">[${item.timestamp}]</span>
        <span class="hist-impact">IMPACT: ${item.peakG.toFixed(2)}g</span>
        <span class="hist-tilt">ROLL: ${item.roll.toFixed(1)}°</span>
        <span class="hist-gps">${item.lat ? `${item.lat.toFixed(4)}, ${item.lng.toFixed(4)}` : 'NO_GPS'}</span>
      </div>
    `).join('');
  }

  setText(selector, text) {
    const el = this.container.querySelector(selector);
    if (el) el.textContent = text;
  }
}

