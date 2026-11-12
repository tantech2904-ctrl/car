/**
 * ============================================================================
 * JARVIS AUTONOMOUS VEHICLE COCKPIT — MAIN SYSTEM COORDINATOR
 * ============================================================================
 */

import { AudioService } from './services/audioService.js';
import { TelemetryService } from './services/telemetryService.js';
import { AccidentEngine } from './services/accidentEngine.js';
import { CenterViewer } from './components/centerViewer.js';
import { LeftControls } from './components/leftControls.js';
import { RightTelemetry } from './components/rightTelemetry.js';
import { EmergencyOverlay } from './components/emergencyOverlay.js';
import { TestbenchPanel } from './components/testbench.js';
import { OrientationGuard } from './components/orientationGuard.js';

class JarvisCockpitApp {
  constructor() {
    this.audio = new AudioService();
    this.telemetry = new TelemetryService();
    this.accident = new AccidentEngine(this.audio, this.telemetry);

    this.viewer = null;
    this.controls = null;
    this.telemetryHud = null;
    this.emergencyOverlay = null;
    this.testbench = null;
    this.orientationGuard = null;

    this.init();
  }

  init() {
    // 1. Initialize Subsystems
    const centerContainer = document.getElementById('region-center');
    const leftContainer = document.getElementById('region-left');
    const rightContainer = document.getElementById('region-right');
    const emergencyContainer = document.getElementById('region-emergency');
    const testbenchContainer = document.getElementById('region-testbench');
    const shieldContainer = document.getElementById('region-orientation-shield');

    this.viewer = new CenterViewer(centerContainer);
    this.controls = new LeftControls(leftContainer, this.telemetry, this.audio);
    this.telemetryHud = new RightTelemetry(rightContainer, this.telemetry);
    this.emergencyOverlay = new EmergencyOverlay(emergencyContainer, this.accident);
    this.testbench = new TestbenchPanel(testbenchContainer, this.telemetry, this.accident, this.viewer);
    this.orientationGuard = new OrientationGuard(shieldContainer);

    // 2. Wire Control Panel to 3D Viewer
    this.controls.setStateChangeCallback((state) => {
      this.viewer.setMotionState(state.drive, state.steer, state.speed);
    });

    // 3. Wire Telemetry Stream
    this.telemetry.setCallbacks({
      onTelemetry: (data) => this.handleTelemetryPacket(data),
      onStatusChange: (status) => this.handleConnectionStatus(status)
    });

    // 4. Wire Accident State to 3D Viewer & Visuals
    this.accident.setStateChangeCallback(({ state }) => {
      this.viewer.setEmergency(state === 3);
      if (state === 3) {
        this.controls.fullStop();
      }
    });

    // 5. Setup UI Header, Clock & Toolbars
    this.setupHeaderActions();
    this.startSystemClock();

    // 6. Connect to Telemetry (Strictly Live Hardware Mode by default)
    this.telemetry.connect();
  }

  handleTelemetryPacket(data) {
    // 1. Update 3D Model IMU Orientation
    if (data.mpu) {
      this.viewer.updateOrientation(data.mpu.pitch, data.mpu.roll, data.mpu.yaw);
    }

    // 2. Update Avionics Telemetry HUD
    this.telemetryHud.update(data);

    // 3. Process Accident Engine
    this.accident.processTelemetry(data);

    // 4. Update Header Metrics
    if (data.pingMs !== undefined) {
      const pingEl = document.getElementById('header-ping');
      if (pingEl) pingEl.textContent = `${data.pingMs} MS`;
    }
    if (data.uptime !== undefined) {
      const uptimeSec = Math.floor(data.uptime / 1000);
      const min = Math.floor(uptimeSec / 60);
      const sec = uptimeSec % 60;
      const uptimeEl = document.getElementById('header-uptime');
      if (uptimeEl) uptimeEl.textContent = `${min.toString().padStart(2, '0')}:${sec.toString().padStart(2, '0')}`;
    }
  }

  handleConnectionStatus({ connected, simulated }) {
    const pill = document.getElementById('connection-pill');
    const label = document.getElementById('connection-label');

    if (!pill || !label) return;

    if (simulated) {
      pill.className = 'connection-pill simulated';
      label.textContent = 'TESTBENCH SIMULATOR';
    } else if (connected) {
      pill.className = 'connection-pill';
      label.textContent = 'LIVE // ESP32_CAR';
    } else {
      pill.className = 'connection-pill offline';
      label.textContent = 'HARDWARE DISCONNECTED';
    }
  }

  setupHeaderActions() {
    // Audio Mute Toggle
    const muteBtn = document.getElementById('btn-toggle-mute');
    if (muteBtn) {
      muteBtn.addEventListener('click', () => {
        const isMuted = this.audio.toggleMute();
        muteBtn.innerHTML = isMuted ? '🔇 SOUND: OFF' : '🔊 SOUND: ON';
        muteBtn.classList.toggle('active', !isMuted);
      });
    }

    // IMU Zero Calibration
    const calBtn = document.getElementById('btn-calibrate-imu');
    if (calBtn) {
      calBtn.addEventListener('click', () => {
        this.audio.playChirp(1500, 0.08);
        this.viewer.calibrateZero();
        this.telemetry.sendCommand('CMD:CALIBRATE');
        calBtn.classList.add('cyan-text');
        setTimeout(() => calBtn.classList.remove('cyan-text'), 600);
      });
    }

    // Camera Preset Buttons
    const camBtns = document.querySelectorAll('.cam-btn');
    camBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        if (!btn.dataset.cam) return; // Ignore file upload label button
        this.audio.playChirp(1300, 0.04);
        camBtns.forEach(b => { if (b.dataset.cam) b.classList.remove('active'); });
        btn.classList.add('active');
        this.viewer.setCameraPreset(btn.dataset.cam);
      });
    });

    // Fullscreen Toggle
    const fsBtn = document.getElementById('btn-toggle-fullscreen');
    if (fsBtn) {
      fsBtn.addEventListener('click', () => {
        if (!document.fullscreenElement) {
          document.documentElement.requestFullscreen().catch(() => {});
        } else {
          document.exitFullscreen().catch(() => {});
        }
      });
    }
  }

  startSystemClock() {
    const clockEl = document.getElementById('header-clock');
    const updateTime = () => {
      if (clockEl) {
        const d = new Date();
        clockEl.textContent = d.toTimeString().split(' ')[0];
      }
    };
    updateTime();
    setInterval(updateTime, 1000);
  }
}

// Bootstrap on DOM loaded
window.addEventListener('DOMContentLoaded', () => {
  window.jarvisApp = new JarvisCockpitApp();
});

