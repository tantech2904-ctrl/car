/**
 * ============================================================================
 * JARVIS COCKPIT — RIGHT REGION: TELEMETRY HUD
 * ============================================================================
 * Manages MPU6050 6-DOF readouts, live 60FPS Canvas G-Force oscillograph,
 * NEO-6M tactical GPS radar, DS18B20 thermal sparkline, and LoRa diagnostics.
 * ============================================================================
 */

import { LoRaProtocol } from '../services/loraProtocol.js';

export class RightTelemetry {
  constructor(containerElement, telemetryService) {
    this.container = containerElement;
    this.telemetryService = telemetryService;

    // Canvas oscillograph buffer
    this.gHistory = new Array(60).fill(1.0);
    this.tempHistory = new Array(30).fill(null);
    this.canvas = null;
    this.ctx = null;

    this.render();
    this.initCanvas();
  }

  render() {
    this.container.innerHTML = `
      <div class="hud-panel right-panel">
        <div class="panel-header">
          <div class="panel-title">
            <span class="hud-icon">◈</span> AVIONICS TELEMETRY
          </div>
          <div class="sub-badge" id="hud-telemetry-rate">20 HZ</div>
        </div>

        <div class="telemetry-scroll-wrapper">
          <!-- 1. MPU6050 6-DOF INERTIAL MEASUREMENT -->
          <div class="telemetry-card">
            <div class="card-header">
              <span class="card-title">MPU6050 // INERTIAL 6-DOF</span>
              <div class="card-status-pill" id="pill-mpu">ONLINE</div>
            </div>

            <!-- Orientation Gauges -->
            <div class="orientation-bar-grid">
              <div class="angle-readout">
                <div class="angle-label">ROLL</div>
                <div class="angle-val" id="val-roll">0.0°</div>
                <div class="angle-bar-track">
                  <div class="angle-bar-fill" id="bar-roll" style="width: 50%;"></div>
                </div>
              </div>
              <div class="angle-readout">
                <div class="angle-label">PITCH</div>
                <div class="angle-val" id="val-pitch">0.0°</div>
                <div class="angle-bar-track">
                  <div class="angle-bar-fill" id="bar-pitch" style="width: 50%;"></div>
                </div>
              </div>
              <div class="angle-readout">
                <div class="angle-label">YAW <span class="drift-tag">DRIFT</span></div>
                <div class="angle-val" id="val-yaw">0.0°</div>
                <div class="angle-bar-track">
                  <div class="angle-bar-fill" id="bar-yaw" style="width: 50%;"></div>
                </div>
              </div>
            </div>

            <!-- 6-Axis Numerical Grid -->
            <div class="axis-grid">
              <div class="axis-cell"><span class="lbl">AX:</span> <span class="num" id="val-ax">0.00</span>g</div>
              <div class="axis-cell"><span class="lbl">AY:</span> <span class="num" id="val-ay">0.00</span>g</div>
              <div class="axis-cell"><span class="lbl">AZ:</span> <span class="num" id="val-az">1.00</span>g</div>
              <div class="axis-cell"><span class="lbl">GX:</span> <span class="num" id="val-gx">0.0</span>°/s</div>
              <div class="axis-cell"><span class="lbl">GY:</span> <span class="num" id="val-gy">0.0</span>°/s</div>
              <div class="axis-cell"><span class="lbl">GZ:</span> <span class="num" id="val-gz">0.0</span>°/s</div>
            </div>

            <!-- Live G-Force Vector Oscillograph -->
            <div class="oscillograph-container">
              <div class="osc-header">
                <span>IMPACT VECTOR G-MAGNITUDE:</span>
                <span class="osc-peak" id="val-total-g">1.000 g</span>
              </div>
              <canvas id="canvas-gforce" width="280" height="54"></canvas>
            </div>
          </div>

          <!-- 2. NEO-6M GPS TACTICAL POSITIONING -->
          <div class="telemetry-card">
            <div class="card-header">
              <span class="card-title">NEO-6M // TACTICAL GPS</span>
              <div class="card-status-pill no-fix" id="pill-gps">NO FIX</div>
            </div>

            <div class="gps-tactical-layout">
              <!-- Radar Scanner Placeholder -->
              <div class="radar-scope">
                <div class="radar-sweep"></div>
                <div class="radar-ring r1"></div>
                <div class="radar-ring r2"></div>
                <div class="radar-cross-h"></div>
                <div class="radar-cross-v"></div>
                <div class="radar-blip" id="gps-blip"></div>
              </div>

              <!-- GPS Data Fields -->
              <div class="gps-fields">
                <div class="gps-row">
                  <span class="lbl">LAT:</span>
                  <span class="val cyan-mono" id="val-gps-lat">ACQUIRING...</span>
                </div>
                <div class="gps-row">
                  <span class="lbl">LNG:</span>
                  <span class="val cyan-mono" id="val-gps-lng">ACQUIRING...</span>
                </div>
                <div class="gps-row">
                  <span class="lbl">ALT:</span>
                  <span class="val" id="val-gps-alt">-- m</span>
                </div>
                <div class="gps-row">
                  <span class="lbl">SPEED:</span>
                  <span class="val" id="val-gps-speed">0.0 km/h</span>
                </div>
                <div class="gps-row">
                  <span class="lbl">SATELLITES:</span>
                  <span class="val" id="val-gps-sats">0 TRACKED</span>
                </div>
              </div>
            </div>
          </div>

          <!-- 3. DS18B20 THERMAL MONITOR -->
          <div class="telemetry-card">
            <div class="card-header">
              <span class="card-title">DS18B20 // THERMAL CORE</span>
              <div class="card-status-pill" id="pill-temp">ONLINE</div>
            </div>

            <div class="temp-readout-row">
              <div class="temp-big-val" id="val-temp-big">28.5<span class="unit">°C</span></div>
              <div class="temp-meta">
                <div class="temp-status-text" id="val-temp-status">NOMINAL</div>
                <div class="temp-fahrenheit" id="val-temp-f">83.3°F</div>
              </div>
            </div>
            <!-- Canvas Thermal Sparkline -->
            <canvas id="canvas-temp-spark" width="280" height="32"></canvas>
          </div>

          <!-- 4. LoRa SX1278 TELEMETRY & BEACON -->
          <div class="telemetry-card">
            <div class="card-header">
              <span class="card-title">RA-02 SX1278 // LoRa BEACON</span>
              <div class="card-status-pill" id="pill-lora">ONLINE</div>
            </div>

            <div class="lora-grid">
              <div class="lora-cell">
                <div class="lbl">STATUS</div>
                <div class="val" id="val-lora-status">ONLINE</div>
              </div>
              <div class="lora-cell">
                <div class="lbl">PACKETS TX</div>
                <div class="val" id="val-lora-tx">0</div>
              </div>
              <div class="lora-cell">
                <div class="lbl">ACK'D</div>
                <div class="val" id="val-lora-ack">0</div>
              </div>
              <div class="lora-cell">
                <div class="lbl">RETRIES</div>
                <div class="val" id="val-lora-retries">0</div>
              </div>
            </div>

            <div class="lora-rssi-bar">
              <div class="rssi-labels">
                <span>SIGNAL (RX ACK):</span>
                <span class="cyan-text" id="val-lora-rssi">N/A</span>
              </div>
              <div class="rssi-track">
                <div class="rssi-fill" id="bar-lora-rssi" style="width: 0%;"></div>
              </div>
            </div>
          </div>

          <!-- 5. PROPULSION POWER / 2S BATTERY PACK -->
          <div class="telemetry-card">
            <div class="card-header">
              <span class="card-title">2S LI-ION // POWER PACK</span>
              <div class="card-status-pill" id="pill-battery-hud">ONLINE</div>
            </div>

            <div class="temp-readout-row">
              <div class="temp-big-val" id="val-battery-big">85<span class="unit">%</span></div>
              <div class="temp-meta">
                <div class="temp-status-text" id="val-battery-status">7.84V</div>
                <div class="temp-fahrenheit" id="val-battery-sub">HEALTHY</div>
              </div>
            </div>

            <div class="lora-rssi-bar" style="margin-top: 8px;">
              <div class="rssi-labels">
                <span>REMAINING CAPACITY:</span>
                <span class="cyan-text" id="val-battery-capacity">85%</span>
              </div>
              <div class="rssi-track">
                <div class="rssi-fill" id="bar-battery-fill" style="width: 85%;"></div>
              </div>
            </div>
          </div>
        </div>
      </div>
    `;
  }

  initCanvas() {
    this.canvas = this.container.querySelector('#canvas-gforce');
    if (this.canvas) {
      this.ctx = this.canvas.getContext('2d');
    }
    this.tempCanvas = this.container.querySelector('#canvas-temp-spark');
    if (this.tempCanvas) {
      this.tempCtx = this.tempCanvas.getContext('2d');
    }
  }

  update(telemetry) {
    if (!telemetry) return;

    const toNum = (v, def = 0) => {
      if (v === null || v === undefined) return def;
      const n = Number(v);
      return isNaN(n) ? def : n;
    };

    // 1. MPU6050
    if (telemetry.mpu) {
      try {
        const m = telemetry.mpu;
        const mpuOnline = Boolean(m.online);
        const mpuPill = this.container.querySelector('#pill-mpu');
        if (mpuPill) {
          mpuPill.textContent = mpuOnline ? 'ONLINE' : 'DISCONNECTED';
          mpuPill.className = `card-status-pill ${mpuOnline ? 'online' : 'offline'}`;
        }

        const rollVal = toNum(m.roll);
        const pitchVal = toNum(m.pitch);
        const yawVal = toNum(m.yaw);

        this.setText('#val-roll', `${rollVal.toFixed(1)}°`);
        this.setText('#val-pitch', `${pitchVal.toFixed(1)}°`);
        this.setText('#val-yaw', `${yawVal.toFixed(1)}°`);

        // Bars normalized to -90° to +90°
        this.setBarWidth('#bar-roll', ((rollVal + 90) / 180) * 100);
        this.setBarWidth('#bar-pitch', ((pitchVal + 90) / 180) * 100);
        this.setBarWidth('#bar-yaw', ((yawVal % 360 + 360) % 360 / 360) * 100);

        this.setText('#val-ax', toNum(m.ax).toFixed(2));
        this.setText('#val-ay', toNum(m.ay).toFixed(2));
        this.setText('#val-az', toNum(m.az, 1.0).toFixed(2));
        this.setText('#val-gx', toNum(m.gx).toFixed(1));
        this.setText('#val-gy', toNum(m.gy).toFixed(1));
        this.setText('#val-gz', toNum(m.gz).toFixed(1));

        const totalGVal = toNum(m.totalG, 1.0);
        this.setText('#val-total-g', `${totalGVal.toFixed(3)} g`);

        // Push to G-Force history and draw oscillograph
        this.gHistory.push(totalGVal);
        if (this.gHistory.length > 60) this.gHistory.shift();
        this.drawGForceWaveform();
      } catch (err) {
        console.warn('[RightTelemetry] Error updating MPU telemetry:', err);
      }
    }

    // 2. NEO-6M GPS
    if (telemetry.gps) {
      try {
        const g = telemetry.gps;
        const gpsPill = this.container.querySelector('#pill-gps');
        const blip = this.container.querySelector('#gps-blip');

        if (g.fix && g.lat !== null && g.lng !== null) {
          if (gpsPill) {
            gpsPill.textContent = 'LOCKED';
            gpsPill.className = 'card-status-pill online';
          }
          this.setText('#val-gps-lat', `${toNum(g.lat).toFixed(6)}° N`);
          this.setText('#val-gps-lng', `${toNum(g.lng).toFixed(6)}° E`);
          this.setText('#val-gps-alt', `${toNum(g.alt).toFixed(1)} m`);
          this.setText('#val-gps-speed', `${toNum(g.speed).toFixed(1)} km/h`);
          this.setText('#val-gps-sats', `${toNum(g.sats, 8)} SATELLITES`);
          if (blip) blip.style.opacity = '1';
        } else {
          if (gpsPill) {
            gpsPill.textContent = g.online ? 'SEARCHING' : 'OFFLINE';
            gpsPill.className = 'card-status-pill no-fix';
          }
          this.setText('#val-gps-lat', 'NO FIX // SEARCHING');
          this.setText('#val-gps-lng', 'NO FIX // SEARCHING');
          this.setText('#val-gps-alt', '-- m');
          this.setText('#val-gps-speed', '0.0 km/h');
          this.setText('#val-gps-sats', `${g.sats || 0} TRACKED`);
          if (blip) blip.style.opacity = '0.2';
        }
      } catch (err) {
        console.warn('[RightTelemetry] Error updating GPS telemetry:', err);
      }
    }

    // 3. Thermal Core (DS18B20 & MPU6050 Live Physical Sensor)
    if (telemetry.temp) {
      try {
        const t = telemetry.temp;
        const tempPill = this.container.querySelector('#pill-temp');
        const tempOnline = Boolean(t.online && t.celsius !== null && t.celsius !== undefined);

        if (tempOnline) {
          const cVal = toNum(t.celsius);
          if (tempPill) {
            const src = t.source ? `LIVE [${t.source}]` : 'ONLINE';
            tempPill.textContent = src;
            tempPill.className = 'card-status-pill online';
          }
          this.setText('#val-temp-big', `${cVal.toFixed(1)}<span class="unit">°C</span>`, true);
          const f = (cVal * 9/5) + 32;
          this.setText('#val-temp-f', `${f.toFixed(1)}°F`);

          const statusEl = this.container.querySelector('#val-temp-status');
          if (statusEl) {
            if (cVal > 65.0) {
              statusEl.textContent = 'OVERHEAT WARNING';
              statusEl.style.color = '#EF4444';
            } else if (cVal > 45.0) {
              statusEl.textContent = 'ELEVATED';
              statusEl.style.color = '#F59E0B';
            } else {
              statusEl.textContent = 'NOMINAL';
              statusEl.style.color = '#00F0FF';
            }
          }

          this.tempHistory.push(cVal);
          if (this.tempHistory.length > 30) this.tempHistory.shift();
          this.drawTempSparkline();
        } else {
          if (tempPill) {
            tempPill.textContent = 'OFFLINE';
            tempPill.className = 'card-status-pill offline';
          }
          this.setText('#val-temp-big', `--.-<span class="unit">°C</span>`, true);
          this.setText('#val-temp-f', 'CONNECTING...');
          this.setText('#val-temp-status', 'SEARCHING HARDWARE');
        }
      } catch (err) {
        console.warn('[RightTelemetry] Error updating Thermal telemetry:', err);
      }
    }

    // 4. LoRa Diagnostics
    if (telemetry.lora) {
      const l = telemetry.lora;
      const statusLabel = LoRaProtocol.getStatusLabel(l.status);
      this.setText('#val-lora-status', statusLabel);
      this.setText('#val-lora-tx', l.sent);
      this.setText('#val-lora-ack', l.acked);
      this.setText('#val-lora-retries', l.retries);

      const loraPill = this.container.querySelector('#pill-lora');
      if (loraPill) {
        loraPill.textContent = statusLabel;
        loraPill.className = `card-status-pill ${l.status === 2 || l.status === 4 ? 'online' : (l.status === 0 ? 'offline' : 'no-fix')}`;
      }

      if (l.rssi !== 0) {
        const quality = LoRaProtocol.getRssiQuality(l.rssi);
        this.setText('#val-lora-rssi', `${l.rssi} dBm (${quality.label})`);
        this.setBarWidth('#bar-lora-rssi', quality.percent);
      } else {
        this.setText('#val-lora-rssi', 'AWAITING ACK');
        this.setBarWidth('#bar-lora-rssi', 0);
      }
    }

    // 5. Battery & Power Diagnostics
    if (telemetry.battery) {
      const b = telemetry.battery;
      const bConnected = Boolean(b.connected);
      const bPill = this.container.querySelector('#pill-battery-hud');

      if (!bConnected || b.percentage === null || isNaN(b.percentage)) {
        if (bPill) {
          bPill.textContent = 'NOT CONNECTED';
          bPill.className = 'card-status-pill offline';
        }
        this.setText('#val-battery-big', '--<span class="unit">%</span>', true);
        this.setText('#val-battery-status', 'NO DIVIDER');
        this.setText('#val-battery-sub', 'NOT CONNECTED');
        this.setText('#val-battery-capacity', 'OFFLINE');
        this.setBarWidth('#bar-battery-fill', 0);
      } else {
        const pct = Math.min(100, Math.max(0, Math.round(b.percentage)));
        if (bPill) {
          bPill.textContent = `${pct}%`;
          bPill.className = `card-status-pill ${pct > 50 ? 'online' : (pct > 20 ? 'no-fix' : 'offline')}`;
        }
        this.setText('#val-battery-big', `${pct}<span class="unit">%</span>`, true);
        const volts = b.voltage !== null ? `${toNum(b.voltage).toFixed(2)}V` : '--V';
        this.setText('#val-battery-status', volts);
        this.setText('#val-battery-sub', b.status || (pct > 50 ? 'HEALTHY' : 'WARNING'));
        this.setText('#val-battery-capacity', `${pct}% (${volts})`);
        this.setBarWidth('#bar-battery-fill', pct);

        const bar = this.container.querySelector('#bar-battery-fill');
        if (bar) {
          if (pct > 50) bar.style.background = 'var(--cyan-primary)';
          else if (pct > 20) bar.style.background = 'var(--amber-warn)';
          else bar.style.background = 'var(--red-emergency)';
        }
      }
    }
  }

  drawGForceWaveform() {
    if (!this.ctx || !this.canvas) return;
    const w = this.canvas.width;
    const h = this.canvas.height;

    this.ctx.clearRect(0, 0, w, h);

    // Subtle background grid
    this.ctx.strokeStyle = '#0E1E2E';
    this.ctx.lineWidth = 1;
    this.ctx.beginPath();
    this.ctx.moveTo(0, h * 0.75); // 1.0g baseline line
    this.ctx.lineTo(w, h * 0.75);
    this.ctx.stroke();

    // Draw G-Force trace
    this.ctx.strokeStyle = '#00F0FF';
    this.ctx.lineWidth = 1.8;
    this.ctx.beginPath();

    const maxG = 5.0; // Graph range 0g to 5g
    const step = w / (this.gHistory.length - 1);

    for (let i = 0; i < this.gHistory.length; i++) {
      const val = this.gHistory[i] || 1.0;
      const y = h - (val / maxG) * h;
      if (i === 0) this.ctx.moveTo(0, y);
      else this.ctx.lineTo(i * step, y);
    }
    this.ctx.stroke();

    // Glow effect
    this.ctx.shadowColor = '#00F0FF';
    this.ctx.shadowBlur = 4;
  }

  drawTempSparkline() {
    if (!this.tempCtx || !this.tempCanvas) return;
    const w = this.tempCanvas.width;
    const h = this.tempCanvas.height;

    this.tempCtx.clearRect(0, 0, w, h);

    const validTemps = this.tempHistory.filter(t => t !== null);
    if (validTemps.length < 2) return;

    this.tempCtx.strokeStyle = '#10B981';
    this.tempCtx.lineWidth = 1.5;
    this.tempCtx.beginPath();

    const step = w / (validTemps.length - 1);
    const minT = 20.0;
    const maxT = 60.0;

    for (let i = 0; i < validTemps.length; i++) {
      const t = validTemps[i];
      const y = h - ((t - minT) / (maxT - minT)) * h;
      if (i === 0) this.tempCtx.moveTo(0, y);
      else this.tempCtx.lineTo(i * step, y);
    }
    this.tempCtx.stroke();
  }

  setText(selector, text, isHtml = false) {
    const el = this.container.querySelector(selector);
    if (el) {
      if (isHtml) el.innerHTML = text;
      else el.textContent = text;
    }
  }

  setBarWidth(selector, pct) {
    const el = this.container.querySelector(selector);
    if (el) {
      el.style.width = `${Math.max(0, Math.min(100, pct))}%`;
    }
  }
}

