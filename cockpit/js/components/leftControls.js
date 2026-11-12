/**
 * ============================================================================
 * JARVIS COCKPIT — LEFT REGION: VEHICLE CONTROL PANEL
 * ============================================================================
 * Features:
 *  - Independent Propulsion (Drive: FWD/REV/STOP) & Steering (Steer: LEFT/RIGHT/CENTER)
 *  - Simultaneous Drive & Steer support (W+A, W+D, S+A, S+D like video games)
 *  - Full 3x3 Gaming D-Pad (Includes diagonal 1-click FWD-L, FWD-R, REV-L, REV-R)
 *  - Dead-Man's safety streaming (continuous 75ms pulses while held)
 *  - Immediate 3x stop burst on release / blur / tab-switch
 *  - 1-Click Runtime Channel Swapping (Swap Drive & Steer motors ChA <-> ChB)
 *  - 1-Click Runtime Polarity Inversion (Invert Drive, Invert Steer)
 *  - Velocity slider and quick speed presets
 *  - Emergency Cutoff Button
 * ============================================================================
 */

export class LeftControls {
  constructor(containerElement, telemetryService, audioService) {
    this.container = containerElement;
    this.telemetry = telemetryService;
    this.audio = audioService;

    // Independent Drive & Steer States
    this.currentDrive = 'STOP';   // 'STOP', 'FORWARD', 'BACKWARD'
    this.currentSteer = 'CENTER'; // 'CENTER', 'LEFT', 'RIGHT'
    this.speed = 190;
    this.isEstopActive = false;
    this.motionStreamTimer = null;

    // Hardware configuration flags (synced with ESP32 firmware)
    this.swapChannels = false;
    this.invDrive = false;
    this.invSteer = false;

    // Active input sets
    this.pressedKeys = new Set();
    this.activeDpadButtons = new Set();
    this.onStateChangeCallback = null;

    this.render();
    this.bindEvents();
    this.bindKeyboard();
  }

  setStateChangeCallback(cb) {
    this.onStateChangeCallback = cb;
  }

  render() {
    this.container.innerHTML = `
      <div class="hud-panel left-panel">
        <div class="panel-header">
          <div class="panel-title">
            <span class="hud-icon">⬢</span> PROPULSION & STEERING
          </div>
          <div class="sub-badge" id="hud-drive-status">STOPPED</div>
        </div>

        <!-- Direction Vector Visualizer -->
        <div class="vector-hud">
          <div class="vector-crosshair">
            <div class="cross-line-h"></div>
            <div class="cross-line-v"></div>
            <div class="vector-dot" id="vector-dot"></div>
          </div>
          <div class="vector-readouts">
            <div>DRIVE: <span class="cyan-text" id="readout-drive">STOPPED</span></div>
            <div>STEER: <span class="cyan-text" id="readout-steer">CENTER</span></div>
            <div>PWM: <span class="cyan-text" id="readout-pwm">${this.speed}</span> / 255</div>
          </div>
        </div>

        <!-- 3x3 Gaming Directional Controller D-Pad (Includes Diagonals) -->
        <div class="dpad-container">
          <div class="dpad-grid">
            <button class="dpad-btn btn-diag" id="btn-fwd-left" data-drive="FORWARD" data-steer="LEFT" title="Forward + Left [W+A]">
              <span class="btn-arrow">↖</span>
              <span class="btn-label">FWD-L</span>
            </button>
            <button class="dpad-btn btn-fwd" id="btn-fwd" data-drive="FORWARD" data-steer="CENTER" title="Straight Forward [W]">
              <span class="btn-arrow">▲</span>
              <span class="btn-label">FWD [W]</span>
            </button>
            <button class="dpad-btn btn-diag" id="btn-fwd-right" data-drive="FORWARD" data-steer="RIGHT" title="Forward + Right [W+D]">
              <span class="btn-arrow">↗</span>
              <span class="btn-label">FWD-R</span>
            </button>

            <button class="dpad-btn btn-left" id="btn-left" data-drive="KEEP" data-steer="LEFT" title="Steer Left [A]">
              <span class="btn-arrow">◀</span>
              <span class="btn-label">LEFT [A]</span>
            </button>
            <button class="dpad-btn btn-stop" id="btn-stop" title="Emergency Stop [SPACE]">
              <span class="stop-core">■</span>
              <span class="btn-label">STOP</span>
            </button>
            <button class="dpad-btn btn-right" id="btn-right" data-drive="KEEP" data-steer="RIGHT" title="Steer Right [D]">
              <span class="btn-arrow">▶</span>
              <span class="btn-label">RIGHT [D]</span>
            </button>

            <button class="dpad-btn btn-diag" id="btn-rev-left" data-drive="BACKWARD" data-steer="LEFT" title="Reverse + Left [S+A]">
              <span class="btn-arrow">↙</span>
              <span class="btn-label">REV-L</span>
            </button>
            <button class="dpad-btn btn-rev" id="btn-rev" data-drive="BACKWARD" data-steer="CENTER" title="Straight Reverse [S]">
              <span class="btn-arrow">▼</span>
              <span class="btn-label">REV [S]</span>
            </button>
            <button class="dpad-btn btn-diag" id="btn-rev-right" data-drive="BACKWARD" data-steer="RIGHT" title="Reverse + Right [S+D]">
              <span class="btn-arrow">↘</span>
              <span class="btn-label">REV-R</span>
            </button>
          </div>
        </div>

        <!-- Motor Channel & Wiring Correction (1-Click Runtime Tuning) -->
        <div class="motor-tuning-box">
          <div class="tuning-title">MOTOR CHANNELS & POLARITY CORRECTION:</div>
          <div class="tuning-btns">
            <button class="btn-tune" id="btn-swap-channels" title="Swap Drive and Steer Motors (ChA <-> ChB)">
              ⇄ SWAP DRIVE/STEER: <span id="lbl-swap-channels">OFF</span>
            </button>
            <button class="btn-tune" id="btn-inv-drive" title="Invert Drive Motor (Forward <-> Reverse)">
              ⟲ INV DRIVE: <span id="lbl-inv-drive">OFF</span>
            </button>
            <button class="btn-tune" id="btn-inv-steer" title="Invert Steering Direction (Left <-> Right)">
              ⟲ INV STEER: <span id="lbl-inv-steer">OFF</span>
            </button>
          </div>
        </div>

        <!-- Speed Modulation & Presets -->
        <div class="speed-control-box">
          <div class="control-row">
            <span class="control-label">DRIVE VELOCITY:</span>
            <span class="control-value" id="speed-display">${Math.round((this.speed / 255) * 100)}%</span>
          </div>
          <input type="range" class="hud-slider" id="speed-slider" min="60" max="255" value="${this.speed}">
          
          <div class="speed-presets">
            <button class="preset-btn" data-speed="110">PATROL</button>
            <button class="preset-btn active" data-speed="190">CRUISE</button>
            <button class="preset-btn" data-speed="255">OVERDRIVE</button>
          </div>
        </div>

        <!-- Emergency Cutoff Button -->
        <div class="estop-wrapper">
          <button class="btn-emergency-stop" id="btn-estop">
            <span class="estop-glow"></span>
            <span class="estop-icon">⚠</span> EMERGENCY STOP [SPACE]
          </button>
        </div>
      </div>
    `;
  }

  bindEvents() {
    const btnStop = this.container.querySelector('#btn-stop');
    const btnEstop = this.container.querySelector('#btn-estop');
    const speedSlider = this.container.querySelector('#speed-slider');

    // Motor Inversion & Channel Swap Buttons
    const btnSwap = this.container.querySelector('#btn-swap-channels');
    const btnInvD = this.container.querySelector('#btn-inv-drive');
    const btnInvS = this.container.querySelector('#btn-inv-steer');

    // Bind all 8 directional D-Pad buttons with pointer capture
    const dpadBtns = this.container.querySelectorAll('.dpad-btn[data-drive]');
    dpadBtns.forEach(btn => {
      this.bindDpadButton(btn);
    });

    // Emergency Stop Buttons
    btnStop.addEventListener('click', () => {
      this.audio.playChirp(600, 0.08);
      this.fullStop();
    });

    btnEstop.addEventListener('click', () => {
      this.toggleEmergencyStop();
    });

    // Tuning Toggles
    btnSwap.addEventListener('click', () => {
      this.audio.playChirp(1200, 0.05);
      this.telemetry.sendCommand('CMD:TOGGLE_SWAP');
      this.swapChannels = !this.swapChannels;
      this.updateTuningLabels();
    });

    btnInvD.addEventListener('click', () => {
      this.audio.playChirp(1200, 0.05);
      this.telemetry.sendCommand('CMD:TOGGLE_INV_DRIVE');
      this.invDrive = !this.invDrive;
      this.updateTuningLabels();
    });

    btnInvS.addEventListener('click', () => {
      this.audio.playChirp(1200, 0.05);
      this.telemetry.sendCommand('CMD:TOGGLE_INV_STEER');
      this.invSteer = !this.invSteer;
      this.updateTuningLabels();
    });

    // Speed Slider
    speedSlider.addEventListener('input', (e) => {
      this.speed = parseInt(e.target.value);
      this.container.querySelector('#speed-display').textContent = `${Math.round((this.speed / 255) * 100)}%`;
      this.container.querySelector('#readout-pwm').textContent = this.speed;
      this.telemetry.sendCommand(`CMD:SPEED:${this.speed}`);
    });

    // Speed Presets
    const presetBtns = this.container.querySelectorAll('.preset-btn');
    presetBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        this.audio.playChirp(1400, 0.05);
        presetBtns.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this.speed = parseInt(btn.dataset.speed);
        speedSlider.value = this.speed;
        this.container.querySelector('#speed-display').textContent = `${Math.round((this.speed / 255) * 100)}%`;
        this.container.querySelector('#readout-pwm').textContent = this.speed;
        this.telemetry.sendCommand(`CMD:SPEED:${this.speed}`);
      });
    });
  }

  updateTuningLabels() {
    const lblSwap = this.container.querySelector('#lbl-swap-channels');
    const lblD = this.container.querySelector('#lbl-inv-drive');
    const lblS = this.container.querySelector('#lbl-inv-steer');

    if (lblSwap) {
      lblSwap.textContent = this.swapChannels ? 'ON' : 'OFF';
      lblSwap.style.color = this.swapChannels ? '#00F0FF' : '#5A6E85';
    }
    if (lblD) {
      lblD.textContent = this.invDrive ? 'ON' : 'OFF';
      lblD.style.color = this.invDrive ? '#00F0FF' : '#5A6E85';
    }
    if (lblS) {
      lblS.textContent = this.invSteer ? 'ON' : 'OFF';
      lblS.style.color = this.invSteer ? '#00F0FF' : '#5A6E85';
    }
  }

  bindDpadButton(element) {
    const start = (e) => {
      e.preventDefault();
      try {
        if (element.setPointerCapture && e.pointerId !== undefined) {
          element.setPointerCapture(e.pointerId);
        }
      } catch (err) {}
      this.activeDpadButtons.add(element.id);
      this.audio.playChirp(1200, 0.04);
      this.evaluateControlState();
    };

    const stop = (e) => {
      try {
        if (element.releasePointerCapture && e.pointerId !== undefined) {
          element.releasePointerCapture(e.pointerId);
        }
      } catch (err) {}
      this.activeDpadButtons.delete(element.id);
      this.evaluateControlState();
    };

    element.addEventListener('pointerdown', start);
    element.addEventListener('pointerup', stop);
    element.addEventListener('pointerleave', stop);
    element.addEventListener('pointercancel', stop);
    element.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  bindKeyboard() {
    window.addEventListener('keydown', (e) => {
      if (['KeyW', 'KeyS', 'KeyA', 'KeyD', 'Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) {
        e.preventDefault();
      }

      if (e.repeat) return;
      this.pressedKeys.add(e.code);
      this.evaluateControlState();
    });

    window.addEventListener('keyup', (e) => {
      this.pressedKeys.delete(e.code);
      this.evaluateControlState();
    });

    window.addEventListener('blur', () => {
      this.fullStop();
    });

    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        this.fullStop();
      }
    });

    // Global safety pointerup listener: if user clicked and dragged pointer off window
    window.addEventListener('pointerup', () => {
      if (this.activeDpadButtons.size > 0) {
        this.activeDpadButtons.clear();
        this.evaluateControlState();
      }
    });
  }

  /**
   * Evaluates simultaneous inputs from BOTH keyboard keys and on-screen D-Pad.
   * Produces authentic gaming mechanics (e.g. W+A = Forward + Left, A alone = Steer Left only).
   */
  evaluateControlState() {
    if (this.pressedKeys.has('Space')) {
      this.toggleEmergencyStop();
      return;
    }

    // 1. Determine Target Drive State (FORWARD, BACKWARD, STOP)
    let targetDrive = 'STOP';
    if (this.pressedKeys.has('KeyW') || this.pressedKeys.has('ArrowUp') ||
        this.activeDpadButtons.has('btn-fwd') || this.activeDpadButtons.has('btn-fwd-left') || this.activeDpadButtons.has('btn-fwd-right')) {
      targetDrive = 'FORWARD';
    } else if (this.pressedKeys.has('KeyS') || this.pressedKeys.has('ArrowDown') ||
               this.activeDpadButtons.has('btn-rev') || this.activeDpadButtons.has('btn-rev-left') || this.activeDpadButtons.has('btn-rev-right')) {
      targetDrive = 'BACKWARD';
    }

    // 2. Determine Target Steering State (LEFT, RIGHT, CENTER)
    let targetSteer = 'CENTER';
    if (this.pressedKeys.has('KeyA') || this.pressedKeys.has('ArrowLeft') ||
        this.activeDpadButtons.has('btn-left') || this.activeDpadButtons.has('btn-fwd-left') || this.activeDpadButtons.has('btn-rev-left')) {
      targetSteer = 'LEFT';
    } else if (this.pressedKeys.has('KeyD') || this.pressedKeys.has('ArrowRight') ||
               this.activeDpadButtons.has('btn-right') || this.activeDpadButtons.has('btn-fwd-right') || this.activeDpadButtons.has('btn-rev-right')) {
      targetSteer = 'RIGHT';
    }

    this.setDriveAndSteer(targetDrive, targetSteer);
  }

  updateDpadHighlights() {
    const isFwd = this.currentDrive === 'FORWARD';
    const isRev = this.currentDrive === 'BACKWARD';
    const isLeft = this.currentSteer === 'LEFT';
    const isRight = this.currentSteer === 'RIGHT';

    const setPressed = (id, condition) => {
      const el = this.container.querySelector(`#${id}`);
      if (el) el.classList.toggle('pressed', condition);
    };

    setPressed('btn-fwd-left', isFwd && isLeft);
    setPressed('btn-fwd', isFwd && !isLeft && !isRight);
    setPressed('btn-fwd-right', isFwd && isRight);

    setPressed('btn-left', !isFwd && !isRev && isLeft);
    setPressed('btn-right', !isFwd && !isRev && isRight);

    setPressed('btn-rev-left', isRev && isLeft);
    setPressed('btn-rev', isRev && !isLeft && !isRight);
    setPressed('btn-rev-right', isRev && isRight);
  }

  /**
   * Applies simultaneous Drive and Steer commands to the vehicle
   */
  setDriveAndSteer(drive, steer) {
    if (this.isEstopActive && drive !== 'STOP') return;

    const stateChanged = (this.currentDrive !== drive || this.currentSteer !== steer);
    this.currentDrive = drive;
    this.currentSteer = steer;

    if (stateChanged) {
      // Clear any existing streaming loop
      if (this.motionStreamTimer) {
        clearInterval(this.motionStreamTimer);
        this.motionStreamTimer = null;
      }

      if (drive === 'STOP' && steer === 'CENTER') {
        // Send 3x burst to guarantee stop delivery over Wi-Fi
        this.telemetry.sendBurst('CMD:MOVE:STOP:CENTER', 3, 20);
      } else {
        const cmd = `CMD:MOVE:${drive === 'FORWARD' ? 'FWD' : drive === 'BACKWARD' ? 'REV' : 'STOP'}:${steer}`;
        // Send immediate initial packet
        this.telemetry.sendCommand(cmd);
        // Stream continuous pulses every 75ms to satisfy 250ms hardware watchdog
        this.motionStreamTimer = setInterval(() => {
          if ((this.currentDrive !== 'STOP' || this.currentSteer !== 'CENTER') && !this.isEstopActive) {
            this.telemetry.sendCommand(cmd);
          } else {
            clearInterval(this.motionStreamTimer);
            this.motionStreamTimer = null;
          }
        }, 75);
      }
    }

    this.updateReadouts();
    this.updateDpadHighlights();
  }

  fullStop() {
    this.pressedKeys.clear();
    this.activeDpadButtons.clear();
    if (this.motionStreamTimer) {
      clearInterval(this.motionStreamTimer);
      this.motionStreamTimer = null;
    }
    this.currentDrive = 'STOP';
    this.currentSteer = 'CENTER';
    this.telemetry.sendBurst('CMD:MOVE:STOP:CENTER', 3, 20);
    this.updateReadouts();
    this.updateDpadHighlights();
  }

  toggleEmergencyStop() {
    this.isEstopActive = !this.isEstopActive;
    const btnEstop = this.container.querySelector('#btn-estop');

    if (this.isEstopActive) {
      this.fullStop();
      this.telemetry.sendCommand('CMD:ESTOP');
      this.audio.playTone(300, 0.4, 0.2, 'sawtooth');
      btnEstop.classList.add('active-estop');
      btnEstop.innerHTML = '<span class="estop-glow"></span><span class="estop-icon">🛑</span> RESUME VEHICLE';
    } else {
      this.telemetry.sendCommand('CMD:RESUME');
      this.audio.playChirp(1600, 0.08);
      btnEstop.classList.remove('active-estop');
      btnEstop.innerHTML = '<span class="estop-glow"></span><span class="estop-icon">⚠</span> EMERGENCY STOP [SPACE]';
    }
    this.updateReadouts();
  }

  updateReadouts() {
    const statusBadge = this.container.querySelector('#hud-drive-status');
    const readoutDrive = this.container.querySelector('#readout-drive');
    const readoutSteer = this.container.querySelector('#readout-steer');
    const vectorDot = this.container.querySelector('#vector-dot');

    const isDriving = this.currentDrive !== 'STOP';
    const isSteering = this.currentSteer !== 'CENTER';

    // Dot offset calculation
    let yOffset = 0;
    if (this.currentDrive === 'FORWARD') yOffset = -30;
    else if (this.currentDrive === 'BACKWARD') yOffset = 30;

    let xOffset = 0;
    if (this.currentSteer === 'LEFT') xOffset = -30;
    else if (this.currentSteer === 'RIGHT') xOffset = 30;

    if (vectorDot) {
      vectorDot.style.transform = `translate(${xOffset}px, ${yOffset}px)`;
      vectorDot.classList.toggle('active', isDriving || isSteering);
    }

    if (readoutDrive) readoutDrive.textContent = this.currentDrive;
    if (readoutSteer) readoutSteer.textContent = this.currentSteer;

    if (statusBadge) {
      if (this.isEstopActive) {
        statusBadge.textContent = 'E-STOP';
        statusBadge.className = 'sub-badge estop-badge';
      } else if (isDriving && isSteering) {
        statusBadge.textContent = `${this.currentDrive} + ${this.currentSteer}`;
        statusBadge.className = 'sub-badge active-badge';
      } else if (isDriving) {
        statusBadge.textContent = this.currentDrive;
        statusBadge.className = 'sub-badge active-badge';
      } else if (isSteering) {
        statusBadge.textContent = `STEER ${this.currentSteer}`;
        statusBadge.className = 'sub-badge active-badge';
      } else {
        statusBadge.textContent = 'STOPPED';
        statusBadge.className = 'sub-badge';
      }
    }

    this.audio.updateEngineHum(this.speed, isDriving);

    if (this.onStateChangeCallback) {
      this.onStateChangeCallback({
        drive: this.currentDrive,
        steer: this.currentSteer,
        speed: this.speed,
        isMoving: isDriving
      });
    }
  }
}
