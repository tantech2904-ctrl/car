/**
 * ============================================================================
 * JARVIS COCKPIT — TELEMETRY & NETWORK COMMUNICATION SERVICE
 * ============================================================================
 * Handles bidirectional WebSocket and REST telemetry streaming,
 * communication heartbeat watchdog, connection health monitoring,
 * and built-in hardware testbench simulation.
 * ============================================================================
 */

export class TelemetryService {
  constructor() {
    this.ws = null;
    this.host = '192.168.4.1';
    this.wsPort = '81';
    this.isConnected = false;
    this.isSimulated = false;
    this.pingMs = 0;
    this.lastPingSent = 0;

    this.onTelemetryCallback = null;
    this.onStatusChangeCallback = null;

    // Heartbeat timer (150ms interval)
    this.heartbeatTimer = null;
    this.reconnectTimer = null;
    this.httpPollTimer = null;

    // Start background HTTP polling fallback
    this.startHttpPolling();

    // Simulator physics registers
    this.simState = {
      driveDir: 0,
      steerDir: 0,
      speed: 180,
      pitch: 0,
      roll: 0,
      yaw: 0,
      ax: 0,
      ay: 0,
      az: 1.0,
      gx: 0,
      gy: 0,
      gz: 0,
      totalG: 1.0,
      temp: 28.5,
      gpsFix: true,
      lat: 28.613939,
      lng: 77.209021,
      alt: 216.4,
      sats: 8,
      loraStatus: 2, // Online
      loraSent: 0,
      loraAcked: 0,
      accidentState: 0,
      batteryConnected: true,
      batteryPercent: 85,
      batteryVoltage: 7.84,
      batteryStatus: 'HEALTHY'
    };

    this.simInterval = null;
  }

  setCallbacks({ onTelemetry, onStatusChange }) {
    this.onTelemetryCallback = onTelemetry;
    this.onStatusChangeCallback = onStatusChange;
  }

  connect(customHost) {
    if (customHost) this.host = customHost;
    if (this.isSimulated) {
      this.startSimulation();
      return;
    }

    try {
      const url = `ws://${this.host}:${this.wsPort}/`;
      this.ws = new WebSocket(url);

      this.ws.onopen = () => {
        this.isConnected = true;
        if (this.onStatusChangeCallback) {
          this.onStatusChangeCallback({ connected: true, simulated: false });
        }
        this.startHeartbeat();
      };

      this.ws.onmessage = (event) => {
        try {
          const rawData = JSON.parse(event.data);
          const data = this.normalizePacket(rawData);
          this.lastPacketReceived = performance.now();
          this.isConnected = true;
          // Measure latency
          if (this.lastPingSent > 0) {
            this.pingMs = Math.round(performance.now() - this.lastPingSent);
            data.pingMs = this.pingMs;
          }
          if (this.onTelemetryCallback) {
            this.onTelemetryCallback(data);
          }
        } catch (e) {
          // Non-JSON or debug packet
        }
      };

      this.ws.onclose = () => {
        this.handleDisconnect();
      };

      this.ws.onerror = () => {
        this.handleDisconnect();
      };

    } catch (e) {
      this.handleDisconnect();
    }
  }

  handleDisconnect() {
    this.isConnected = false;
    this.stopHeartbeat();
    if (this.onStatusChangeCallback) {
      this.onStatusChangeCallback({ connected: false, simulated: this.isSimulated });
    }

    // Attempt automatic reconnect if not in simulation mode
    if (!this.isSimulated && !this.reconnectTimer) {
      this.reconnectTimer = setTimeout(() => {
        this.reconnectTimer = null;
        this.connect();
      }, 2500);
    }
  }

  disconnect() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.stopHeartbeat();
    this.stopSimulation();
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.isConnected = false;
  }

  startHeartbeat() {
    this.stopHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      if (this.isConnected && this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.lastPingSent = performance.now();
        this.ws.send('CMD:HEARTBEAT');
      }
    }, 150);
  }

  stopHeartbeat() {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  sendCommand(cmdString) {
    if (this.isSimulated) {
      this.processSimCommand(cmdString);
      return;
    }

    if (this.isConnected && this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(cmdString);
    } else {
      // Fallback to HTTP REST endpoint
      this.sendHttpCommand(cmdString);
    }
  }

  sendBurst(cmdString, count = 3, intervalMs = 25) {
    this.sendCommand(cmdString);
    if (count <= 1) return;
    let sent = 1;
    const burstTimer = setInterval(() => {
      this.sendCommand(cmdString);
      sent++;
      if (sent >= count) {
        clearInterval(burstTimer);
      }
    }, intervalMs);
  }

  sendHttpCommand(cmdString) {
    let driveParam = 'STOP';
    let steerParam = 'CENTER';
    let ecsCmd = 'stop';

    if (cmdString.startsWith('CMD:MOVE:')) {
      const parts = cmdString.substring(9).split(':');
      driveParam = parts[0] || 'STOP';
      steerParam = parts[1] || 'CENTER';

      if (driveParam === 'FWD' && steerParam === 'CENTER') ecsCmd = 'forward';
      else if (driveParam === 'REV' && steerParam === 'CENTER') ecsCmd = 'backward';
      else if (driveParam === 'STOP' && steerParam === 'LEFT') ecsCmd = 'left';
      else if (driveParam === 'STOP' && steerParam === 'RIGHT') ecsCmd = 'right';
      else if (driveParam === 'FWD' && steerParam === 'LEFT') ecsCmd = 'forward_left';
      else if (driveParam === 'FWD' && steerParam === 'RIGHT') ecsCmd = 'forward_right';
      else if (driveParam === 'REV' && steerParam === 'LEFT') ecsCmd = 'backward_left';
      else if (driveParam === 'REV' && steerParam === 'RIGHT') ecsCmd = 'backward_right';
      else if (driveParam === 'STOP' && steerParam === 'CENTER') ecsCmd = 'stop';
    } else if (cmdString === 'CMD:FORWARD' || cmdString === 'CMD:DRIVE:FWD') {
      driveParam = 'FWD'; ecsCmd = 'forward';
    } else if (cmdString === 'CMD:BACKWARD' || cmdString === 'CMD:DRIVE:REV') {
      driveParam = 'REV'; ecsCmd = 'backward';
    } else if (cmdString === 'CMD:LEFT' || cmdString === 'CMD:STEER:LEFT') {
      steerParam = 'LEFT'; ecsCmd = 'left';
    } else if (cmdString === 'CMD:RIGHT' || cmdString === 'CMD:STEER:RIGHT') {
      steerParam = 'RIGHT'; ecsCmd = 'right';
    } else if (cmdString === 'CMD:FWD_LEFT') {
      driveParam = 'FWD'; steerParam = 'LEFT'; ecsCmd = 'forward_left';
    } else if (cmdString === 'CMD:FWD_RIGHT') {
      driveParam = 'FWD'; steerParam = 'RIGHT'; ecsCmd = 'forward_right';
    } else if (cmdString === 'CMD:REV_LEFT') {
      driveParam = 'REV'; steerParam = 'LEFT'; ecsCmd = 'backward_left';
    } else if (cmdString === 'CMD:REV_RIGHT') {
      driveParam = 'REV'; steerParam = 'RIGHT'; ecsCmd = 'backward_right';
    } else if (cmdString === 'CMD:STOP' || cmdString === 'CMD:ESTOP') {
      driveParam = 'STOP'; steerParam = 'CENTER'; ecsCmd = 'stop';
    }

    let query = `cmd=${ecsCmd}&drive=${driveParam}&steer=${steerParam}`;

    if (cmdString.startsWith('CMD:SPEED:')) {
      query += `&speed=${cmdString.substring(10)}`;
    } else if (cmdString === 'CMD:CALIBRATE') {
      query += `&action=calibrate`;
    } else if (cmdString === 'CMD:TOGGLE_SWAP') {
      query += `&action=swap`;
    } else if (cmdString === 'CMD:TOGGLE_INV_DRIVE') {
      query += `&action=inv_drive`;
    } else if (cmdString === 'CMD:TOGGLE_INV_STEER') {
      query += `&action=inv_steer`;
    }

    const directUrl = `http://${this.host}/cmd?${query}`;
    const proxyUrl = `/api/esp32/cmd?cmd=${ecsCmd}`;

    fetch(directUrl, { method: 'GET', mode: 'no-cors' }).catch(() => {
      fetch(proxyUrl, { method: 'GET' }).catch(() => {});
    });
  }

  startHttpPolling() {
    if (this.httpPollTimer) return;
    this.httpPollTimer = setInterval(async () => {
      // If WebSocket is active and receiving fresh frames within 250ms, let WS stream
      const timeSinceLastPacket = performance.now() - (this.lastPacketReceived || 0);
      if (this.isConnected && this.ws && this.ws.readyState === WebSocket.OPEN && timeSinceLastPacket < 250) {
        return;
      }
      if (this.isSimulated) return;

      const endpoints = [
        `http://${this.host}/status`,
        '/status',
        '/api/esp32/status'
      ];

      for (const ep of endpoints) {
        try {
          const controller = new AbortController();
          const tid = setTimeout(() => controller.abort(), 350);
          const res = await fetch(ep, { signal: controller.signal });
          clearTimeout(tid);

          if (res.ok) {
            const rawData = await res.json();
            const data = this.normalizePacket(rawData);
            this.lastPacketReceived = performance.now();
            this.isConnected = true;
            if (this.onStatusChangeCallback) {
              this.onStatusChangeCallback({ connected: true, simulated: false });
            }
            if (this.onTelemetryCallback) {
              this.onTelemetryCallback(data);
            }
            break;
          }
        } catch (e) {
          // Fall through to next endpoint
        }
      }
    }, 70);
  }

  normalizePacket(data) {
    if (!data) return data;

    const toNum = (v, def = 0) => {
      if (v === null || v === undefined) return def;
      const n = Number(v);
      return isNaN(n) ? def : n;
    };

    // 1. Check if packet is in ECS flat format (ax, ay, az in m/s^2)
    if (data.ax !== undefined && (!data.mpu || !data.mpu.online)) {
      const ax = toNum(data.ax);
      const ay = toNum(data.ay);
      const az = toNum(data.az, 9.80665);
      const totalG = Math.sqrt(ax * ax + ay * ay + az * az) / 9.80665;

      // Calculate tilt angles in degrees
      const pitch = Math.atan2(-ax, Math.sqrt(ay * ay + az * az)) * (180.0 / Math.PI);
      const roll  = Math.atan2(ay, az) * (180.0 / Math.PI);

      data.mpu = {
        online: data.mpuOK !== undefined ? Boolean(data.mpuOK) : true,
        addr: '0x68',
        ax: toNum(ax / 9.80665),
        ay: toNum(ay / 9.80665),
        az: toNum(az / 9.80665),
        gx: toNum(data.gx),
        gy: toNum(data.gy),
        gz: toNum(data.gz),
        roll: toNum(roll),
        pitch: toNum(pitch),
        yaw: toNum(data.fakeHeading),
        totalG: toNum(totalG)
      };
    } else if (data.mpu) {
      // Sanitize existing data.mpu properties as real Numbers
      data.mpu.online = Boolean(data.mpu.online !== undefined ? data.mpu.online : data.mpuOK);
      data.mpu.ax = toNum(data.mpu.ax);
      data.mpu.ay = toNum(data.mpu.ay);
      data.mpu.az = toNum(data.mpu.az, 1.0);
      data.mpu.gx = toNum(data.mpu.gx);
      data.mpu.gy = toNum(data.mpu.gy);
      data.mpu.gz = toNum(data.mpu.gz);
      data.mpu.roll = toNum(data.mpu.roll);
      data.mpu.pitch = toNum(data.mpu.pitch);
      data.mpu.yaw = toNum(data.mpu.yaw);
      data.mpu.totalG = toNum(data.mpu.totalG, 1.0);
    }

    // 2. Temperature Normalization (Ensures live updates regardless of sensor or backend format)
    let tempC = null;
    let tempOnline = false;
    let tempSource = 'HARDWARE';

    if (data.temp && typeof data.temp === 'object') {
      tempOnline = data.temp.online !== undefined ? Boolean(data.temp.online) : (data.temp.celsius !== null && data.temp.celsius !== undefined);
      tempC = data.temp.celsius !== null && data.temp.celsius !== undefined ? toNum(data.temp.celsius) : null;
      tempSource = data.temp.source || data.temp.sensor || 'HARDWARE';
    } else if (data.temperatureC !== undefined && data.temperatureC !== null) {
      tempC = toNum(data.temperatureC);
      tempOnline = !isNaN(tempC) && tempC > -50 && tempC < 130;
      tempSource = data.tempSensorType || 'DS18B20';
    } else if (data.celsius !== undefined && data.celsius !== null) {
      tempC = toNum(data.celsius);
      tempOnline = !isNaN(tempC) && tempC > -50 && tempC < 130;
      tempSource = 'DS18B20';
    } else if (data.mpuTemp !== undefined && data.mpuTemp !== null) {
      tempC = toNum(data.mpuTemp);
      tempOnline = !isNaN(tempC) && tempC > -50 && tempC < 130;
      tempSource = 'MPU6050_CORE';
    } else if (data.temp !== undefined && typeof data.temp === 'number') {
      tempC = toNum(data.temp);
      tempOnline = !isNaN(tempC) && tempC > -50 && tempC < 130;
      tempSource = 'HARDWARE';
    }

    data.temp = {
      online: tempOnline && tempC !== null && !isNaN(tempC),
      celsius: tempC,
      source: tempSource
    };

    // 3. Check if GPS is flat (ECS format)
    if (data.lat !== undefined && !data.gps) {
      data.gps = {
        online: true,
        fix: data.gpsFix !== undefined ? Boolean(data.gpsFix) : true,
        lat: toNum(data.lat),
        lng: toNum(data.lon !== undefined ? data.lon : data.lng),
        alt: toNum(data.alt, 214.0),
        speed: toNum(data.fakeSpeed !== undefined ? data.fakeSpeed : data.speed),
        sats: toNum(data.sats, 9)
      };
    } else if (data.gps) {
      data.gps.lat = toNum(data.gps.lat);
      data.gps.lng = toNum(data.gps.lng);
      data.gps.alt = toNum(data.gps.alt);
      data.gps.speed = toNum(data.gps.speed);
      data.gps.sats = toNum(data.gps.sats);
    }

    // 4. Check if Accident is flat (ECS format)
    if (data.accidentActive !== undefined && !data.accident) {
      data.accident = {
        state: data.accidentActive ? 3 : 0,
        peakG: 2.8,
        impactRoll: 0,
        impactPitch: 0,
        message: data.accidentMessage || ''
      };
    }

    // 5. Battery Telemetry Normalization
    let battConnected = false;
    let battVoltage = null;
    let battPercent = null;
    let battStatus = 'NOT CONNECTED';

    if (data.battery && typeof data.battery === 'object') {
      battConnected = Boolean(data.battery.connected);
      battVoltage = (data.battery.voltage !== null && data.battery.voltage !== undefined) ? toNum(data.battery.voltage) : null;
      battPercent = (data.battery.percentage !== null && data.battery.percentage !== undefined) ? toNum(data.battery.percentage) : null;
      battStatus = data.battery.status || (battConnected ? 'OK' : 'NOT CONNECTED');
    } else if (data.batteryConnected !== undefined) {
      battConnected = Boolean(data.batteryConnected);
      battVoltage = (data.batteryVoltage !== null && data.batteryVoltage !== undefined) ? toNum(data.batteryVoltage) : null;
      battPercent = (data.batteryPercent !== null && data.batteryPercent !== undefined) ? toNum(data.batteryPercent) : null;
      battStatus = data.batteryStatus || (battConnected ? 'OK' : 'NOT CONNECTED');
    }

    data.battery = {
      connected: battConnected,
      voltage: battVoltage,
      percentage: battPercent,
      status: battStatus
    };

    return data;
  }

  // --------------------------------------------------------------------------
  // HARDWARE TESTBENCH & SIMULATOR ENGINE
  // --------------------------------------------------------------------------
  enableSimulation(enable) {
    this.isSimulated = enable;
    if (this.isSimulated) {
      if (this.ws) this.ws.close();
      this.startSimulation();
    } else {
      this.stopSimulation();
      this.connect();
    }
  }

  startSimulation() {
    this.stopSimulation();
    this.isConnected = true;
    if (this.onStatusChangeCallback) {
      this.onStatusChangeCallback({ connected: true, simulated: true });
    }

    let lastSimTime = performance.now();
    this.simInterval = setInterval(() => {
      const now = performance.now();
      const dt = (now - lastSimTime) / 1000;
      lastSimTime = now;

      // Update virtual vehicle physics
      const speedNorm = this.simState.speed / 255.0;
      let targetPitch = 0;
      let targetRoll = 0;

      // Pitch up on reverse, down on forward
      if (this.simState.driveDir === 1) targetPitch = -4.5 * speedNorm; // Nose down
      else if (this.simState.driveDir === 2) targetPitch = 3.5 * speedNorm; // Nose up

      // Roll into corners
      if (this.simState.steerDir === 1) targetRoll = -5.0 * speedNorm; // Tilt left
      else if (this.simState.steerDir === 2) targetRoll = 5.0 * speedNorm; // Tilt right

      // Turn heading
      if (this.simState.steerDir === 1) this.simState.yaw -= 45 * speedNorm * dt;
      else if (this.simState.steerDir === 2) this.simState.yaw += 45 * speedNorm * dt;

      this.simState.pitch += (targetPitch - this.simState.pitch) * dt * 4.0;
      this.simState.roll += (targetRoll - this.simState.roll) * dt * 4.0;

      // Accelerometer simulation
      this.simState.ax = (targetPitch * 0.05) + (Math.random() - 0.5) * 0.04;
      this.simState.ay = (targetRoll * 0.05) + (Math.random() - 0.5) * 0.04;
      this.simState.az = 1.0 + (Math.random() - 0.5) * 0.03;
      this.simState.totalG = Math.sqrt(this.simState.ax**2 + this.simState.ay**2 + this.simState.az**2);

      // Temperature fluctuation
      if (this.simState.driveDir !== 0) {
        this.simState.temp = Math.min(52.0, this.simState.temp + dt * 0.2);
      } else {
        this.simState.temp = Math.max(28.0, this.simState.temp - dt * 0.1);
      }

      // Simulated GPS movement
      if (this.simState.driveDir === 1) {
        const rad = (this.simState.yaw * Math.PI) / 180;
        this.simState.lat += Math.cos(rad) * 0.00001 * speedNorm;
        this.simState.lng += Math.sin(rad) * 0.00001 * speedNorm;
      }

      // Build simulated telemetry payload
      const telemetry = {
        uptime: Math.round(now),
        pingMs: 14 + Math.round(Math.random() * 8),
        driveDir: this.simState.driveDir,
        steerDir: this.simState.steerDir,
        speed: this.simState.speed,
        estop: this.simState.driveDir === 0 && this.simState.accidentState === 3,
        mpu: {
          online: true,
          ax: parseFloat(this.simState.ax.toFixed(3)),
          ay: parseFloat(this.simState.ay.toFixed(3)),
          az: parseFloat(this.simState.az.toFixed(3)),
          gx: (Math.random() - 0.5) * 1.5,
          gy: (Math.random() - 0.5) * 1.5,
          gz: this.simState.steerDir !== 0 ? (this.simState.steerDir === 1 ? -35 : 35) : 0,
          roll: parseFloat(this.simState.roll.toFixed(1)),
          pitch: parseFloat(this.simState.pitch.toFixed(1)),
          yaw: parseFloat((this.simState.yaw % 360).toFixed(1)),
          totalG: parseFloat(this.simState.totalG.toFixed(3))
        },
        gps: {
          online: true,
          fix: this.simState.gpsFix,
          lat: this.simState.gpsFix ? parseFloat(this.simState.lat.toFixed(6)) : null,
          lng: this.simState.gpsFix ? parseFloat(this.simState.lng.toFixed(6)) : null,
          alt: parseFloat(this.simState.alt.toFixed(1)),
          speed: this.simState.driveDir !== 0 ? parseFloat((speedNorm * 24.5).toFixed(1)) : 0.0,
          sats: this.simState.sats
        },
        temp: {
          online: true,
          celsius: parseFloat(this.simState.temp.toFixed(1))
        },
        accident: {
          state: this.simState.accidentState,
          peakG: this.simState.accidentState > 0 ? 4.15 : 1.02,
          impactRoll: this.simState.accidentState > 0 ? 62.4 : 0.0,
          impactPitch: this.simState.accidentState > 0 ? -18.2 : 0.0,
          seq: 1
        },
        lora: {
          status: this.simState.loraStatus,
          sent: this.simState.loraSent,
          acked: this.simState.loraAcked,
          retries: 0,
          rssi: -68
        },
        battery: {
          connected: this.simState.batteryConnected,
          voltage: this.simState.batteryConnected ? parseFloat(this.simState.batteryVoltage.toFixed(2)) : null,
          percentage: this.simState.batteryConnected ? this.simState.batteryPercent : null,
          status: this.simState.batteryConnected ? (this.simState.batteryPercent > 50 ? 'HEALTHY' : (this.simState.batteryPercent > 20 ? 'WARNING' : 'CRITICAL')) : 'NOT CONNECTED'
        }
      };

      if (this.onTelemetryCallback) {
        this.onTelemetryCallback(telemetry);
      }
    }, 50); // 20 Hz
  }

  stopSimulation() {
    if (this.simInterval) {
      clearInterval(this.simInterval);
      this.simInterval = null;
    }
  }

  processSimCommand(cmd) {
    if (cmd.startsWith('CMD:MOVE:')) {
      const parts = cmd.substring(9).split(':');
      const dStr = parts[0];
      const sStr = parts[1] || 'CENTER';

      if (dStr === 'FWD') this.simState.driveDir = 1;
      else if (dStr === 'REV') this.simState.driveDir = 2;
      else this.simState.driveDir = 0;

      if (sStr === 'LEFT') this.simState.steerDir = 1;
      else if (sStr === 'RIGHT') this.simState.steerDir = 2;
      else this.simState.steerDir = 0;
    }
    else if (cmd === 'CMD:FWD_LEFT') {
      this.simState.driveDir = 1;
      this.simState.steerDir = 1;
    }
    else if (cmd === 'CMD:FWD_RIGHT') {
      this.simState.driveDir = 1;
      this.simState.steerDir = 2;
    }
    else if (cmd === 'CMD:REV_LEFT') {
      this.simState.driveDir = 2;
      this.simState.steerDir = 1;
    }
    else if (cmd === 'CMD:REV_RIGHT') {
      this.simState.driveDir = 2;
      this.simState.steerDir = 2;
    }
    else if (cmd === 'CMD:FORWARD' || cmd === 'CMD:DRIVE:FWD') {
      this.simState.driveDir = 1;
      this.simState.steerDir = 0;
    }
    else if (cmd === 'CMD:BACKWARD' || cmd === 'CMD:DRIVE:REV') {
      this.simState.driveDir = 2;
      this.simState.steerDir = 0;
    }
    else if (cmd === 'CMD:LEFT' || cmd === 'CMD:STEER:LEFT') {
      this.simState.driveDir = 0;
      this.simState.steerDir = 1;
    }
    else if (cmd === 'CMD:RIGHT' || cmd === 'CMD:STEER:RIGHT') {
      this.simState.driveDir = 0;
      this.simState.steerDir = 2;
    }
    else if (cmd === 'CMD:STOP' || cmd === 'CMD:DRIVE:STOP' || cmd === 'CMD:STEER:CENTER') {
      this.simState.driveDir = 0;
      this.simState.steerDir = 0;
    }
    else if (cmd.startsWith('CMD:SPEED:')) this.simState.speed = parseInt(cmd.substring(10));
    else if (cmd === 'CMD:ESTOP') {
      this.simState.driveDir = 0;
      this.simState.steerDir = 0;
    }
    else if (cmd === 'CMD:RESET_ACCIDENT') {
      this.simState.accidentState = 0;
    }
  }

  triggerSimCrash() {
    if (!this.isSimulated) return;
    this.simState.accidentState = 1; // Impact suspected
    this.simState.totalG = 4.25;
    this.simState.roll = 65.0; // Rollover
    this.simState.loraSent++;

    setTimeout(() => {
      this.simState.accidentState = 3; // Confirmed
      this.simState.driveDir = 0;
      this.simState.loraAcked++;
    }, 350);
  }
}

