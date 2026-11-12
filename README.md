# JARVIS AUTONOMOUS VEHICLE CONTROL COCKPIT
### High-End Automotive Digital Cockpit, 3D Digital Twin & Aerospace Telemetry Station

---

## 1. Executive Summary & Architecture Overview

The **JARVIS Autonomous Vehicle Control Cockpit** transforms the ESP32 robotic car into a digital vehicle control station inspired by Iron Man's JARVIS interface, luxury automotive digital cockpits (Audi Virtual Cockpit), and military telemetry systems.

The system is split into two synchronized tiers:
1. **Embedded Firmware Tier (ESP32 DevKit V1):**
   - Non-blocking cooperative multitasking engine (`millis()` loop).
   - Dual-axis independent motor controller supporting simultaneous drive (Forward/Reverse) and differential steering (Left/Right) with PWM speed scaling.
   - Dedicated hardware failsafe watchdog: stops all motors if no command or heartbeat is received within 400ms.
   - MPU6050 6-DOF IMU reading at 400kHz I2C with complementary filtering (96% Gyro, 4% Accel) and auto-zero calibration.
   - NEO-6M GPS integration over UART2 (HardwareSerial2) with TinyGPS++.
   - DS18B20 1-Wire temperature monitoring with sensor offline detection.
   - SX1278 RA-02 LoRa emergency beacon transmitter with structured packet validation and ACK handling.
   - Onboard 4-stage accident detection state machine (`NORMAL` → `IMPACT SUSPECTED` → `VERIFYING` → `CONFIRMED`).
   - Wi-Fi SoftAP (`ESP32_CAR` at `192.168.4.1`) + real-time WebSocket server (`/ws` on port 81) + backward-compatible REST API (`/cmd`, `/status`).

2. **Cockpit Frontend Tier (Modern WebGL & Three.js):**
   - Viewport-locked, true full-screen landscape cockpit (no page scrolling).
   - **Left Region:** Compound directional D-Pad, touch/pointer press-and-hold (auto-stop on release), keyboard navigation (`W`, `A`, `S`, `D`, `Space`), velocity slider, speed presets (Patrol, Cruise, Overdrive), and Emergency STOP.
   - **Center Region:** Meticulously crafted 3D digital twin of the **Audi Q7 2020 SUV** (matching the reference photographs), featuring an octagonal singleframe grille, matrix LED DRL headlights, silver roof rails, panoramic glass, alloy wheels with brake calipers, steerable front wheel knuckles, continuous wheel spin, real-time MPU6050 pitch/roll/yaw response with exponential damping, and 4 camera view presets.
   - **Right Region:** Avionics telemetry HUD featuring 6-DOF MPU readings, 60FPS live canvas G-force oscillograph, NEO-6M tactical radar & GPS coords (honest NO-FIX state without fabricated data), DS18B20 temperature gauge with sparkline, and LoRa SX1278 diagnostic module.
   - **Emergency Alert Overlay:** Pulsing red HUD overlay with 5-second false-alarm countdown abort window, impact G-force reading, rollover orientation, and blackbox incident log.
   - **Web Audio API Synthesizer:** Pure procedural sci-fi tactile clicks, throttle turbine hum, and emergency siren (zero external audio files).
   - **Hardware Testbench Simulator:** Toggle between `LIVE HARDWARE` and `TESTBENCH SIMULATION` with interactive crash generator, tilt sliders, and synthetic GPS.

---

## 2. Hardware Wiring Schematics

### A. Car ESP32 DevKit V1 (Transmitter & Chassis Node)

| Subsystem | Peripheral Pin | ESP32 GPIO | Description / Notes |
|---|---|---|---|
| **Motor Driver (L298N)** | IN1 | **GPIO 25** | Left Motor Forward (PWM Ch 0) |
| | IN2 | **GPIO 26** | Left Motor Reverse (PWM Ch 1) |
| | IN3 | **GPIO 27** | Right Motor Forward (PWM Ch 2) |
| | IN4 | **GPIO 14** | Right Motor Reverse (PWM Ch 3) |
| **MPU6050 6-Axis IMU** | SDA | **GPIO 21** | 400kHz Fast I2C Bus |
| | SCL | **GPIO 22** | 400kHz Fast I2C Bus |
| | VCC / GND | 3.3V / GND | Regulated 3.3V supply |
| **GPS NEO-6M** | TX | **GPIO 16** | GPS TX → ESP32 RX2 (9600 baud) |
| | RX | **GPIO 17** | ESP32 TX2 → GPS RX (9600 baud) |
| | VCC / GND | 5V (or 3.3V) / GND | GPS active antenna powered |
| **DS18B20 Temperature** | DATA | **GPIO 32** | 1-Wire bus (**Requires 4.7kΩ pull-up to 3.3V**) |
| | VCC / GND | 3.3V / GND | Digital thermometer |
| **RA-02 LoRa (SX1278)** | NSS / CS | **GPIO 13** | SPI Chip Select |
| | SCK | **GPIO 18** | SPI Clock |
| | MISO | **GPIO 19** | SPI Master In Slave Out |
| | MOSI | **GPIO 23** | SPI Master Out Slave In |
| | RESET | **GPIO 4** | Active Low Hardware Reset |
| | DIO0 | **GPIO 33** | RxDone / TxDone Interrupt |
| | VCC / GND | 3.3V / GND | **3.3V ONLY** (SX1278 is not 5V tolerant!) |

### B. Separate Receiver ESP32 DevKit V1 (Ground Station Node)

| Peripheral Pin | ESP32 GPIO | Description / Notes |
|---|---|---|
| **RA-02 NSS** | **GPIO 27** | Dedicated SPI NSS |
| **RA-02 MOSI** | **GPIO 22** | Dedicated SPI MOSI |
| **RA-02 MISO** | **GPIO 18** | Dedicated SPI MISO |
| **RA-02 SCK** | **GPIO 5** | Dedicated SPI SCK |
| **RA-02 RESET** | **GPIO 14** | Active Low Reset |
| **RA-02 DIO0** | **GPIO 26** | Interrupt line |
| **Push Button** | **GPIO 33** | Active LOW (internal pull-up) for manual Alarm Reset / ACK |

---

## 3. Directory Structure

```
Car/
├── firmware/
│   ├── car_esp32_firmware/
│   │   └── car_esp32_firmware.ino       # Complete Car ESP32 firmware
│   ├── receiver_esp32_firmware/
│   │   └── receiver_esp32_firmware.ino   # Ground station LoRa receiver firmware
│   └── README_FIRMWARE.md               # Pinouts, flashing instructions & libraries
├── cockpit/
│   ├── index.html                       # Master full-screen landscape HUD
│   ├── serve.js                         # Zero-dependency local Node static server
│   ├── package.json                     # Project manifest and test runner
│   ├── styles/
│   │   └── hud.css                      # Cyber-hud styling, scanlines & neon grid
│   ├── js/
│   │   ├── app.js                       # Main application coordinator
│   │   ├── three/
│   │   │   └── AudiQ7Model.js           # 3D Audi Q7 SUV procedural model
│   │   ├── components/
│   │   │   ├── leftControls.js          # Direction D-Pad, compound movement, speed
│   │   │   ├── centerViewer.js          # Three.js viewport, camera presets & IMU
│   │   │   ├── rightTelemetry.js        # MPU, 60FPS G-force canvas, GPS radar, temp
│   │   │   ├── emergencyOverlay.js      # Accident alert, countdown & blackbox
│   │   │   ├── testbench.js             # Simulator harness & crash trigger
│   │   │   └── orientationGuard.js      # Landscape orientation lock
│   │   └── services/
│   │       ├── audioService.js          # Web Audio procedural sound synthesizer
│   │       ├── telemetryService.js      # WebSocket/REST client, heartbeat, simulator
│   │       ├── accidentEngine.js        # 4-stage impact detection state machine
│   │       └── loraProtocol.js          # LoRa packet encoder, decoder & validator
│   ├── tests/
│   │   └── cockpit.test.js              # Automated unit tests for protocol & state
│   └── vendor/
│       ├── three.module.js              # Embedded Three.js (100% offline capable)
│       └── OrbitControls.js             # Embedded Three.js OrbitControls
├── images/                              # Audi Q7 2020 reference photographs
└── README.md                            # Master documentation
```

---

## 4. Installation & Setup Instructions

### Step 1: Flashing the ESP32 Car Firmware
1. Open the Arduino IDE.
2. Go to **Sketch → Include Library → Manage Libraries...** and install:
   - `WebSockets` by Markus Sattler
   - `LoRa` by Sandeep Mistry
   - `TinyGPSPlus` by Mikal Hart
   - `OneWire` by Paul Stoffregen
   - `DallasTemperature` by Miles Burton
3. Open `firmware/car_esp32_firmware/car_esp32_firmware.ino`.
4. Connect the Car ESP32 to your PC via USB. Select **Board: ESP32 Dev Module** and the correct COM port.
5. Click **Upload**.
6. When powered on, the ESP32 will broadcast a Wi-Fi Access Point:
   - **SSID:** `ESP32_CAR`
   - **Password:** `jarvis1234`
   - **Cockpit Gateway IP:** `192.168.4.1`

### Step 2: Flashing the Receiver ESP32 (Optional Ground Station)
1. Open `firmware/receiver_esp32_firmware/receiver_esp32_firmware.ino`.
2. Connect your secondary ESP32 board and upload the sketch.
3. Open the Serial Monitor at **115200 baud** to view emergency LoRa packets and transmission ACKs.

### Step 3: Launching the Cockpit
The cockpit is completely self-contained. You can launch it using either method:

**Method A (Direct Node.js Server):**
```bash
cd cockpit
node serve.js
# Or: npm start
```
Open `http://localhost:3000` in any web browser (Chrome, Edge, Firefox, Safari).

**Method B (Direct File Opening):**
You can open `cockpit/index.html` directly in your browser. All Three.js dependencies are embedded inside `cockpit/vendor/`, ensuring 100% functionality even when disconnected from the internet!

---

## 5. Control Interfaces & Keybindings

| Key / Control | Function | Description |
|---|---|---|
| **W / Arrow Up** | Drive Forward | Continuous forward thrust while held; stops on release |
| **S / Arrow Down** | Drive Reverse | Continuous reverse thrust while held; stops on release |
| **A / Arrow Left** | Steer Left | Differential left steer while driving, or stationary pivot left |
| **D / Arrow Right** | Steer Right | Differential right steer while driving, or stationary pivot right |
| **W + A** | Forward + Left | Simultaneous forward arc turn left |
| **W + D** | Forward + Right | Simultaneous forward arc turn right |
| **S + A** | Reverse + Left | Simultaneous reverse arc turn left |
| **S + D** | Reverse + Right | Simultaneous reverse arc turn right |
| **Spacebar** | Emergency STOP | Instant emergency motor cut |
| **Velocity Slider** | Speed Scaling | Modulates motor PWM (60 to 255) |
| **Patrol / Cruise / Overdrive** | Speed Presets | Quick speed presets (110 / 180 / 255) |

---

## 6. Verification & Automated Testing

To run the automated verification test suite:
```bash
node cockpit/tests/cockpit.test.js
```

### Verified Test Results:
1. **LoRa Protocol Validator:** Structured packet generation, delimiter token parsing (`DEV`, `SEQ`, `TIME`, `G_FORCE`, `ROLL`, `PITCH`, `GPS`, `TEMP`, `CRC`), and ACK verification pass cleanly.
2. **Accident State Machine:** Normal driving bumps (1.8g) are ignored; severe collision spikes (>3.2g) enter `IMPACT SUSPECTED`; rollover angles (>55°) confirm accident; motors are immediately stopped; false-alarm cancel restores `NORMAL`.
3. **Dual-Axis Simultaneous Motor Control:** Simultaneous Forward + Left yields differential PWM (Left: 70, Right: 200); stationary spot pivots correctly turn the vehicle.
4. **Hardware Watchdog Failsafe:** Stale commands exceeding 400ms automatically stop all motors.

---

## 7. Status of Project Features

### Working & Validated Features
- [x] Full-screen landscape cockpit architecture (zero scrolling, portrait orientation guard).
- [x] Dual-axis simultaneous propulsion & steering (Forward+Left, Forward+Right, Reverse+Left, Reverse+Right, Spot Pivot).
- [x] Pointer and touch press-and-hold with immediate release-to-stop.
- [x] Full keyboard mapping (`W`, `A`, `S`, `D`, `Space`) with browser scroll suppression.
- [x] Hardware watchdog timer (400ms auto-cut failsafe in firmware).
- [x] Procedural 3D digital twin of the Audi Q7 2020 SUV based on user photographs.
- [x] Three.js steerable front wheels (±28° pivot) and 4-wheel rotation synced to drive speed.
- [x] Real-time MPU6050 pitch/roll/yaw response with exponential smoothing filter.
- [x] 4 camera perspective presets (3/4 Isometric, Front, Top-Down, Profile) + OrbitControls.
- [x] 6-DOF MPU6050 telemetry readouts and live 60FPS canvas G-force oscillograph.
- [x] NEO-6M GPS radar & telemetry with honest NO-FIX state handling (no fake coordinates).
- [x] DS18B20 temperature gauge with history sparkline and offline status detection.
- [x] LoRa SX1278 diagnostic panel (packet count, sequence, ACK status, RSSI).
- [x] 4-stage accident detection state machine with 5-second false-alarm countdown abort.
- [x] Critical accident emergency HUD overlay with telemetry freeze and blackbox log.
- [x] Pure Web Audio API procedural sound synthesizer (tactile chirps, turbine hum, emergency klaxon, mute toggle).
- [x] Interactive hardware testbench mode with crash impact generator and tilt sliders.

### Hardware Features Awaiting Physical Field Validation
- Physical calibration of the car's magnetic heading / gyro yaw drift against a magnetometer (HMC5883L/QMC5883L) if true north compass alignment is required in outdoor navigation.
- Outdoor satellite lock acquisition verification for the NEO-6M GPS antenna under open sky.
- Verification of physical SPI trace connections on the RA-02 LoRa module (specifically verifying whether the module's interrupt pin is labeled `DIO0` or `D100` on the physical breakout board).

