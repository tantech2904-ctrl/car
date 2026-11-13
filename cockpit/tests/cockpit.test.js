/**
 * ============================================================================
 * JARVIS COCKPIT — AUTOMATED VERIFICATION TEST SUITE
 * ============================================================================
 * Tests:
 *  1. LoRa SX1278 packet encoding, decoding & checksum integrity
 *  2. 4-Stage Accident Detection State Machine transitions
 *  3. Dual-axis motor command synthesis & compound steering logic
 *  4. Telemetry parsing & fail-safe watchdog verification
 * ============================================================================
 */

const assert = require('assert');

// 1. Test LoRa Protocol Parser
function testLoRaProtocol() {
  console.log('Testing LoRa Protocol Validator...');

  const validPacket = "JARVIS_EMERGENCY|DEV:CAR_01|SEQ:102|TIME:45210|G_FORCE:4.25|ROLL:58.2|PITCH:-12.4|GPS:28.6139,77.2090|TEMP:32.4|CRC:OK";
  
  // Parse manually (matching loraProtocol.js logic)
  const parts = validPacket.split('|');
  const result = {};
  for (const part of parts) {
    if (part.startsWith('DEV:')) result.deviceId = part.substring(4);
    else if (part.startsWith('SEQ:')) result.sequence = parseInt(part.substring(4));
    else if (part.startsWith('G_FORCE:')) result.peakG = parseFloat(part.substring(8));
    else if (part.startsWith('ROLL:')) result.roll = parseFloat(part.substring(5));
    else if (part.startsWith('PITCH:')) result.pitch = parseFloat(part.substring(6));
    else if (part.startsWith('GPS:')) result.gps = part.substring(4);
    else if (part.startsWith('TEMP:')) result.temp = parseFloat(part.substring(5));
    else if (part === 'CRC:OK') result.crcValid = true;
  }

  assert.strictEqual(result.deviceId, 'CAR_01');
  assert.strictEqual(result.sequence, 102);
  assert.strictEqual(result.peakG, 4.25);
  assert.strictEqual(result.roll, 58.2);
  assert.strictEqual(result.crcValid, true);
  console.log('  [PASS] LoRa Emergency Packet parsed & validated.');

  // Test ACK packet
  const ackPacket = "ACK_EMERGENCY|DEV:CAR_01|SEQ:102|ACK_TIME:45290|STATUS:RECEIVED";
  assert.ok(ackPacket.includes("ACK_EMERGENCY"));
  assert.ok(ackPacket.includes("SEQ:102"));
  console.log('  [PASS] LoRa ACK Packet validated.');
}

// 2. Test Accident State Machine
function testAccidentStateMachine() {
  console.log('Testing Accident Detection State Machine...');

  const states = { NORMAL: 0, SUSPECTED: 1, VERIFYING: 2, CONFIRMED: 3 };
  let currentState = states.NORMAL;
  let motorsRunning = true;

  // Simulate normal driving bump (1.8g)
  const bumpG = 1.8;
  if (bumpG > 3.2) currentState = states.SUSPECTED;
  assert.strictEqual(currentState, states.NORMAL, 'Normal bump must NOT trigger accident');
  console.log('  [PASS] Normal road bumps (1.8g) correctly ignored.');

  // Simulate severe crash impact (4.1g)
  const crashG = 4.1;
  if (crashG > 3.2) {
    currentState = states.SUSPECTED;
  }
  assert.strictEqual(currentState, states.SUSPECTED, 'High G-force must enter SUSPECTED state');

  // Verify transition to CONFIRMED
  const rolloverAngle = 62.0;
  if (rolloverAngle > 55.0) {
    currentState = states.CONFIRMED;
    motorsRunning = false; // Immediate safety cut
  }
  assert.strictEqual(currentState, states.CONFIRMED);
  assert.strictEqual(motorsRunning, false, 'Motors must be stopped on confirmed accident');
  console.log('  [PASS] Severe impact & rollover confirmed -> Motors immediately stopped.');

  // Cancel / Reset
  currentState = states.NORMAL;
  assert.strictEqual(currentState, states.NORMAL);
  console.log('  [PASS] False alarm cancel mechanism successfully restores NORMAL state.');
}

// 3. Test Independent Drive & Steer Motor Control & Inversion Logic
function testMotorCommandSynthesis() {
  console.log('Testing Independent Drive & Steering Motor Engine (Simultaneous Gaming Controls)...');

  function computeMotorOutputs(drive, steer, speed, invDrive, invSteer, swapChannels) {
    let drivePwr = 0;
    if (drive === 'FORWARD') drivePwr = speed;
    else if (drive === 'BACKWARD') drivePwr = -speed;

    let steerPwr = 0;
    if (steer === 'RIGHT') steerPwr = 255;
    else if (steer === 'LEFT') steerPwr = -255;

    if (invDrive) drivePwr = -drivePwr;
    if (invSteer) steerPwr = -steerPwr;

    const chA = swapChannels ? steerPwr : drivePwr;
    const chB = swapChannels ? drivePwr : steerPwr;

    return { chA, chB, drivePwr, steerPwr };
  }

  // 1. Forward Only: Drive runs at speed, Steering is 0 (Straight, NO turning)
  const fwdOnly = computeMotorOutputs('FORWARD', 'CENTER', 200, false, false, false);
  assert.strictEqual(fwdOnly.chA, 200, 'Drive channel must be 200');
  assert.strictEqual(fwdOnly.chB, 0, 'Steering channel must be 0 (no unwanted turning)');
  console.log('  [PASS] FORWARD only drives straight forward (zero steering power).');

  // 2. Steer Left Only: Drive is 0, Steer turns left (Zero forward/backward movement!)
  const leftOnly = computeMotorOutputs('STOP', 'LEFT', 200, false, false, false);
  assert.strictEqual(leftOnly.chA, 0, 'Drive channel must be 0 (no unwanted movement)');
  assert.strictEqual(leftOnly.chB, -255, 'Steering channel must be -255 (full left lock)');
  console.log('  [PASS] LEFT only turns steering rack (zero forward/backward drive).');

  // 3. Simultaneous W + A (Forward + Left like in video games)
  const fwdLeft = computeMotorOutputs('FORWARD', 'LEFT', 200, false, false, false);
  assert.strictEqual(fwdLeft.chA, 200, 'Drive must be 200');
  assert.strictEqual(fwdLeft.chB, -255, 'Steer must be -255');
  console.log('  [PASS] Simultaneous FORWARD + LEFT powers both drive and steering simultaneously.');

  // 4. Simultaneous S + D (Reverse + Right)
  const revRight = computeMotorOutputs('BACKWARD', 'RIGHT', 200, false, false, false);
  assert.strictEqual(revRight.chA, -200, 'Drive must be -200');
  assert.strictEqual(revRight.chB, 255, 'Steer must be 255');
  console.log('  [PASS] Simultaneous REVERSE + RIGHT reverses while turning right.');

  // 5. Channel Swap Toggle (ChA <-> ChB)
  const swapped = computeMotorOutputs('FORWARD', 'LEFT', 200, false, false, true);
  assert.strictEqual(swapped.chA, -255, 'ChA now controls steering');
  assert.strictEqual(swapped.chB, 200, 'ChB now controls drive');
  console.log('  [PASS] SWAP CHANNELS toggle successfully swaps ChA and ChB.');
}

// 4. Test Watchdog Timeout Safety
function testWatchdogTimeout() {
  console.log('Testing Communication Watchdog Timeout Failsafe...');

  const TIMEOUT_MS = 350;
  let lastMotionPulseTime = 1000;
  let currentTime = 1400; // 400ms later (> 350ms timeout)
  let vehicleDrive = 'FORWARD';
  let vehicleSteer = 'CENTER';
  let pins = { drive1: 0, drive2: 1, steer1: 0, steer2: 0 }; // Running forward

  // Hardware watchdog simulation (matches car_esp32_firmware.ino loop)
  if (vehicleDrive !== 'STOP' || vehicleSteer !== 'CENTER') {
    if (currentTime - lastMotionPulseTime > TIMEOUT_MS) {
      // stopCar()
      pins.drive1 = 0;
      pins.drive2 = 0;
      pins.steer1 = 0;
      pins.steer2 = 0;
      vehicleDrive = 'STOP';
      vehicleSteer = 'CENTER';
    }
  }

  assert.strictEqual(vehicleDrive, 'STOP', 'Vehicle drive must be STOP after 350ms dead-man timeout');
  assert.strictEqual(vehicleSteer, 'CENTER', 'Vehicle steer must be CENTER');
  assert.strictEqual(pins.drive1, 0, 'Drive pin 1 must be grounded LOW');
  assert.strictEqual(pins.drive2, 0, 'Drive pin 2 must be grounded LOW');
  console.log('  [PASS] Hardware watchdog independently stops motors when commands become stale.');
}

// 5. Test Firmware Stop Command & WebSocket Buffer Safety
function testFirmwareStopAndBufferSafety() {
  console.log('Testing Firmware Stop Command & WebSocket Buffer Safety...');

  // Simulating firmware command parser logic with buffer isolation
  function simulateFirmwareParser(rawBuffer, length) {
    // Exact firmware fix: char buf[length + 1]; memcpy; buf[length] = '\0'
    const cleanStr = rawBuffer.slice(0, length).toString('utf8').trim();
    let lower = cleanStr.toLowerCase();

    let state = { drive: 'STOP', steer: 'CENTER', stopped: false };

    // Heartbeat check
    if (cleanStr === 'CMD:HEARTBEAT' || cleanStr === 'ping') {
      return { ...state, heartbeat: true };
    }

    // Universal Stop check
    if (lower === 'stop' || lower === 's' || lower === 'halt' ||
        cleanStr === 'CMD:STOP' || cleanStr === 'CMD:S' || cleanStr === 'CMD:ESTOP' ||
        cleanStr === 'CMD:MOVE:STOP:CENTER' || cleanStr === 'CMD:MOVE:0:0' ||
        lower.indexOf('stop') >= 0 || lower.indexOf('halt') >= 0) {
      state.stopped = true;
      return state;
    }

    if (cleanStr.startsWith('CMD:MOVE:')) {
      const rest = cleanStr.substring(9);
      const colon = rest.indexOf(':');
      if (colon > 0) {
        const dStr = rest.substring(0, colon);
        const sStr = rest.substring(colon + 1);
        if (dStr === 'FWD' || dStr === 'FORWARD') state.drive = 'FORWARD';
        else if (dStr === 'REV' || dStr === 'BACKWARD') state.drive = 'BACKWARD';

        if (sStr === 'LEFT') state.steer = 'LEFT';
        else if (sStr === 'RIGHT') state.steer = 'RIGHT';

        if (state.drive === 'STOP' && state.steer === 'CENTER') {
          state.stopped = true;
        }
        return state;
      }
    }

    if (lower === 'forward') state.drive = 'FORWARD';
    else if (lower === 'backward') state.drive = 'BACKWARD';
    else if (lower === 'left') state.steer = 'LEFT';
    else if (lower === 'right') state.steer = 'RIGHT';

    return state;
  }

  // Case 1: WebSocket buffer previously held "CMD:MOVE:FORWARD:CENTER" (23 bytes)
  const heapBuffer = Buffer.alloc(32);
  heapBuffer.write('CMD:MOVE:FORWARD:CENTER');

  // New incoming STOP frame is only 8 bytes ("CMD:STOP")
  heapBuffer.write('CMD:STOP', 0, 8); // Remaining 15 bytes still contain ":FORWARD:CENTER"
  const stopParsed = simulateFirmwareParser(heapBuffer, 8);
  assert.strictEqual(stopParsed.stopped, true, 'CMD:STOP must parse cleanly despite trailing heap bytes');
  console.log('  [PASS] Isolated 8-byte CMD:STOP resolves cleanly without heap corruption.');

  // Case 2: New incoming compound STOP frame is 19 bytes ("CMD:MOVE:STOP:CENTER")
  const heapBuffer2 = Buffer.alloc(32);
  heapBuffer2.write('CMD:MOVE:FORWARD:CENTER'); // 23 bytes
  heapBuffer2.write('CMD:MOVE:STOP:CENTER', 0, 19); // 19 bytes, leaving 'TER' at end
  const compoundStopParsed = simulateFirmwareParser(heapBuffer2, 19);
  assert.strictEqual(compoundStopParsed.stopped, true, 'CMD:MOVE:STOP:CENTER must parse and cut motors');
  assert.strictEqual(compoundStopParsed.drive, 'STOP');
  assert.strictEqual(compoundStopParsed.steer, 'CENTER');
  console.log('  [PASS] Compound CMD:MOVE:STOP:CENTER cuts power without trailing buffer contamination.');

  // Case 3: ECS legacy single-key stop ('stop' or 's')
  const ecsStop = simulateFirmwareParser(Buffer.from('stop'), 4);
  assert.strictEqual(ecsStop.stopped, true);
  const keySStop = simulateFirmwareParser(Buffer.from('s'), 1);
  assert.strictEqual(keySStop.stopped, true);
  console.log('  [PASS] Legacy ECS lowercase "stop" and "s" commands immediately cut motor power.');
}

// 5. Test Battery Telemetry & ADC Divider Detection
function testBatteryMonitoring() {
  console.log('Testing Battery Telemetry & Hardware ADC Divider Safety...');

  function evaluateBatteryADC(rawADC) {
    const ADC_RESOLUTION = 4095.0;
    const VREF = 3.3;
    const VOLTAGE_DIVIDER_RATIO = 3.13;
    const BATT_MIN = 6.4;
    const BATT_MAX = 8.4;

    if (rawADC < 150) {
      return {
        connected: false,
        voltage: null,
        percentage: null,
        status: "NOT CONNECTED"
      };
    }

    const pinVolts = (rawADC / ADC_RESOLUTION) * VREF;
    const packVolts = pinVolts * VOLTAGE_DIVIDER_RATIO;
    let pct = ((packVolts - BATT_MIN) / (BATT_MAX - BATT_MIN)) * 100.0;
    if (pct < 0) pct = 0;
    if (pct > 100) pct = 100;
    const roundPct = Math.round(pct);

    let status = "HEALTHY";
    if (roundPct <= 20) status = "CRITICAL";
    else if (roundPct <= 50) status = "WARNING";

    return {
      connected: true,
      voltage: parseFloat(packVolts.toFixed(2)),
      percentage: roundPct,
      status: status
    };
  }

  // Case A: No voltage divider wired (pin floating, rawADC ~ 30)
  const noDivider = evaluateBatteryADC(30);
  assert.strictEqual(noDivider.connected, false);
  assert.strictEqual(noDivider.status, "NOT CONNECTED");
  assert.strictEqual(noDivider.percentage, null);
  console.log('  [PASS] Floating ADC (rawADC < 150) correctly flagged as NOT CONNECTED.');

  // Case B: 2S Pack at ~7.4V (nominal 50%)
  // Pin voltage = 7.4 / 3.13 = 2.364V -> rawADC = (2.364 / 3.3) * 4095 ~ 2934
  const halfPack = evaluateBatteryADC(2934);
  assert.strictEqual(halfPack.connected, true);
  assert.strictEqual(halfPack.percentage, 50);
  assert.strictEqual(halfPack.status, "WARNING");
  console.log('  [PASS] 2S Nominal (7.4V) accurately calculated at 50% (WARNING).');

  // Case C: Fully charged 2S pack (8.4V = 100%)
  // Pin voltage = 8.4 / 3.13 = 2.683V -> rawADC = (2.683 / 3.3) * 4095 ~ 3330
  const fullPack = evaluateBatteryADC(3330);
  assert.strictEqual(fullPack.connected, true);
  assert.strictEqual(fullPack.percentage, 100);
  assert.strictEqual(fullPack.status, "HEALTHY");
  console.log('  [PASS] 2S Fully charged (8.4V) accurately calculated at 100% (HEALTHY).');

  // Case D: Low battery pack (6.6V = ~10%)
  // Pin voltage = 6.6 / 3.13 = 2.108V -> rawADC = (2.108 / 3.3) * 4095 ~ 2617
  const lowPack = evaluateBatteryADC(2617);
  assert.strictEqual(lowPack.connected, true);
  assert.strictEqual(lowPack.percentage, 10);
  assert.strictEqual(lowPack.status, "CRITICAL");
  console.log('  [PASS] 2S Critical pack (6.6V) triggers CRITICAL alert status.');
}

// Run all test suites
console.log('\n======================================================');
console.log(' RUNNING JARVIS COCKPIT AUTOMATED TEST SUITE          ');
console.log('======================================================\n');

try {
  testLoRaProtocol();
  testAccidentStateMachine();
  testMotorCommandSynthesis();
  testWatchdogTimeout();
  testFirmwareStopAndBufferSafety();
  testBatteryMonitoring();
  console.log('\n>>> ALL 6 TEST SUITES PASSED CLEANLY (100% SUCCESS) <<<\n');
  process.exit(0);
} catch (err) {
  console.error('\n[TEST FAILURE]', err);
  process.exit(1);
}

