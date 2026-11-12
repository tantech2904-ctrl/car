/**
 * ============================================================================
 * JARVIS COCKPIT — HARDWARE TESTBENCH & SIMULATION CONTROLLER
 * ============================================================================
 * Provides comprehensive testing tools to validate 3D tilt, accident detection,
 * GPS fix state handling, and motor controls without physical hardware present.
 * ============================================================================
 */

export class TestbenchPanel {
  constructor(containerElement, telemetryService, accidentEngine, centerViewer) {
    this.container = containerElement;
    this.telemetry = telemetryService;
    this.accident = accidentEngine;
    this.viewer = centerViewer;
    this.isOpen = false;

    this.render();
    this.bindEvents();
  }

  render() {
    this.container.innerHTML = `
      <div class="testbench-drawer closed" id="testbench-drawer">
        <div class="drawer-header" id="drawer-toggle-btn">
          <span class="drawer-title">⚙ HARDWARE TESTBENCH & SIMULATOR</span>
          <span class="drawer-arrow">▲</span>
        </div>

        <div class="drawer-body">
          <div class="tb-grid">
            <!-- Mode Switcher -->
            <div class="tb-col">
              <span class="tb-label">CONNECTION PROFILE:</span>
              <div class="tb-btn-group">
                <button class="tb-mode-btn active" id="btn-mode-live">LIVE HARDWARE (AP)</button>
                <button class="tb-mode-btn" id="btn-mode-sim">TESTBENCH SIMULATOR</button>
              </div>
              <div class="tb-ip-input-group">
                <label>ESP32 IP / HOST:</label>
                <input type="text" id="input-host" value="192.168.4.1" class="tb-input">
                <button class="tb-btn-sub" id="btn-connect-host">CONNECT</button>
              </div>
            </div>

            <!-- Crash Simulation Controls -->
            <div class="tb-col">
              <span class="tb-label">ACCIDENT TESTING HARNESS:</span>
              <button class="btn-crash-test" id="btn-sim-crash">
                💥 TRIGGER HIGH-G CRASH IMPACT (4.25g)
              </button>
              <div class="tb-hint">Tests the entire impact state machine, 5s countdown abort, siren & blackbox log.</div>
            </div>

            <!-- Manual MPU Tilt Injectors -->
            <div class="tb-col">
              <span class="tb-label">MANUAL TILT INJECTORS:</span>
              <div class="tb-slider-row">
                <span>PITCH:</span>
                <input type="range" min="-45" max="45" value="0" id="tb-pitch-slider" class="hud-slider">
                <span id="tb-pitch-val">0°</span>
              </div>
              <div class="tb-slider-row">
                <span>ROLL:</span>
                <input type="range" min="-45" max="45" value="0" id="tb-roll-slider" class="hud-slider">
                <span id="tb-roll-val">0°</span>
              </div>
              <div class="tb-slider-row">
                <button class="tb-btn-sub" id="tb-btn-reset-tilt">ZERO TILT</button>
                <button class="tb-btn-sub" id="tb-btn-toggle-gps">TOGGLE GPS FIX</button>
              </div>
            </div>

            <!-- Battery Power Diagnostics & Simulation -->
            <div class="tb-col">
              <span class="tb-label">PROPULSION BATTERY HARNESS:</span>
              <div class="tb-slider-row">
                <span>CHARGE:</span>
                <input type="range" min="0" max="100" value="85" id="tb-battery-slider" class="hud-slider">
                <span id="tb-battery-val">85%</span>
              </div>
              <div class="tb-slider-row">
                <button class="tb-btn-sub" id="tb-btn-toggle-battery">STATUS: CONNECTED (CLICK TO TOGGLE)</button>
              </div>
              <div class="tb-hint">Tests 'NOT CONNECTED' when no voltage divider is installed vs. live 2S 6.4V-8.4V pack telemetry.</div>
            </div>
          </div>
        </div>
      </div>
    `;
  }

  bindEvents() {
    const toggleBtn = this.container.querySelector('#drawer-toggle-btn');
    const drawer = this.container.querySelector('#testbench-drawer');
    const btnLive = this.container.querySelector('#btn-mode-live');
    const btnSim = this.container.querySelector('#btn-mode-sim');
    const btnConnect = this.container.querySelector('#btn-connect-host');
    const inputHost = this.container.querySelector('#input-host');
    const btnSimCrash = this.container.querySelector('#btn-sim-crash');
    const pitchSlider = this.container.querySelector('#tb-pitch-slider');
    const rollSlider = this.container.querySelector('#tb-roll-slider');
    const btnResetTilt = this.container.querySelector('#tb-btn-reset-tilt');
    const btnToggleGps = this.container.querySelector('#tb-btn-toggle-gps');
    const batterySlider = this.container.querySelector('#tb-battery-slider');
    const btnToggleBattery = this.container.querySelector('#tb-btn-toggle-battery');

    toggleBtn.addEventListener('click', () => {
      this.isOpen = !this.isOpen;
      drawer.classList.toggle('closed', !this.isOpen);
      this.container.querySelector('.drawer-arrow').textContent = this.isOpen ? '▼' : '▲';
    });

    btnLive.addEventListener('click', () => {
      btnLive.classList.add('active');
      btnSim.classList.remove('active');
      this.telemetry.enableSimulation(false);
    });

    btnSim.addEventListener('click', () => {
      btnSim.classList.add('active');
      btnLive.classList.remove('active');
      this.telemetry.enableSimulation(true);
    });

    btnConnect.addEventListener('click', () => {
      const host = inputHost.value.trim();
      this.telemetry.disconnect();
      this.telemetry.connect(host);
    });

    btnSimCrash.addEventListener('click', () => {
      this.telemetry.triggerSimCrash();
    });

    // Tilt sliders
    pitchSlider.addEventListener('input', (e) => {
      const val = parseFloat(e.target.value);
      this.container.querySelector('#tb-pitch-val').textContent = `${val}°`;
      this.telemetry.simState.pitch = val;
    });

    rollSlider.addEventListener('input', (e) => {
      const val = parseFloat(e.target.value);
      this.container.querySelector('#tb-roll-val').textContent = `${val}°`;
      this.telemetry.simState.roll = val;
    });

    btnResetTilt.addEventListener('click', () => {
      pitchSlider.value = 0;
      rollSlider.value = 0;
      this.container.querySelector('#tb-pitch-val').textContent = '0°';
      this.container.querySelector('#tb-roll-val').textContent = '0°';
      this.telemetry.simState.pitch = 0;
      this.telemetry.simState.roll = 0;
    });

    btnToggleGps.addEventListener('click', () => {
      this.telemetry.simState.gpsFix = !this.telemetry.simState.gpsFix;
    });

    if (batterySlider) {
      batterySlider.addEventListener('input', (e) => {
        const val = parseInt(e.target.value, 10);
        const valEl = this.container.querySelector('#tb-battery-val');
        if (valEl) valEl.textContent = `${val}%`;
        this.telemetry.simState.batteryPercent = val;
        // 2S curve: 6.4V (0%) to 8.4V (100%)
        this.telemetry.simState.batteryVoltage = 6.4 + (val / 100.0) * 2.0;
        this.telemetry.simState.batteryConnected = true;
        if (btnToggleBattery) {
          btnToggleBattery.textContent = 'STATUS: CONNECTED (CLICK TO TOGGLE)';
        }
      });
    }

    if (btnToggleBattery) {
      btnToggleBattery.addEventListener('click', () => {
        this.telemetry.simState.batteryConnected = !this.telemetry.simState.batteryConnected;
        if (this.telemetry.simState.batteryConnected) {
          btnToggleBattery.textContent = 'STATUS: CONNECTED (CLICK TO TOGGLE)';
          const val = parseInt(batterySlider.value, 10);
          this.telemetry.simState.batteryPercent = val;
          this.telemetry.simState.batteryVoltage = 6.4 + (val / 100.0) * 2.0;
        } else {
          btnToggleBattery.textContent = 'STATUS: NOT CONNECTED (DIVIDER ABSENT)';
          this.telemetry.simState.batteryPercent = null;
          this.telemetry.simState.batteryVoltage = null;
        }
      });
    }
  }
}

