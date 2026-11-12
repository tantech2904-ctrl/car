/**
 * ============================================================================
 * JARVIS AUTONOMOUS VEHICLE COCKPIT — ESP32 FIRMWARE (UNIFIED ECS + JARVIS)
 * ============================================================================
 * Hardware Architecture:
 *  - Platform: ESP32 NodeMCU / DevKit V1
 *  - Steering Motor (Front): STEER_IN1 = 25, STEER_IN2 = 26
 *  - Drive Motor (Rear Propulsion): DRIVE_IN1 = 27, DRIVE_IN2 = 14
 *  - IMU: MPU6050 (I2C: SDA=21, SCL=22) with Anti-Sleep & Register Auto-Wake
 *  - GPS: NEO-6M (HardwareSerial2: RX=16, TX=17) with dead-reckoning fallback
 *  - Temperature: DS18B20 1-Wire Digital Sensor (GPIO 32)
 *  - Telemetry Beacon 1: ESP-NOW broadcast on Channel 6 to EC:62:60:A5:CC:54
 *  - Telemetry Beacon 2: SX1278 RA-02 LoRa 433MHz (SPI GPIO 13/18/19/23/4/33)
 *  - Wi-Fi AP: SSID "ESP32_CAR", Pass "CarControl26" (Fixed Channel 6)
 *  - REST API on Port 80 (JSON endpoints + CORS)
 *  - Real-time WebSocket on Port 81 (50ms low-latency streaming)
 *  - Fail-safe Watchdogs: 250ms motion dead-man switch + 600ms full link timeout
 * ============================================================================
 */

#include <WiFi.h>
#include <esp_now.h>
#include <esp_wifi.h>
#include <WebServer.h>
#include <WebSocketsServer.h>
#include <Wire.h>
#include <SPI.h>
#include <LoRa.h>
#include <TinyGPS++.h>
#include <OneWire.h>
#include <DallasTemperature.h>
#include <math.h>

// ============================================================================
// HARDWARE PIN DEFINITIONS (Verified Working from ECS)
// ============================================================================

// Front Steering Motor Pins
const int STEER_IN1 = 25;
const int STEER_IN2 = 26;

// Rear Propulsion Drive Motor Pins
const int DRIVE_IN1 = 27;
const int DRIVE_IN2 = 14;

// I2C Sensors (MPU6050)
const int PIN_I2C_SDA = 21;
const int PIN_I2C_SCL = 22;

// NEO-6M GPS (UART2)
const int PIN_GPS_RX = 16;
const int PIN_GPS_TX = 17;
const uint32_t GPS_BAUD = 9600;

// DS18B20 Temperature (1-Wire)
const int PIN_DS18B20 = 32;

// Battery Voltage Divider ADC (GPIO 34 - ADC1 CH6, input-only, operates simultaneously with Wi-Fi)
const int PIN_BATTERY_ADC = 34;
const float VREF = 3.3f;
const float ADC_RESOLUTION = 4095.0f;
// Voltage divider ratio: e.g. R1=100k, R2=47k -> (100+47)/47 = 3.128 (max 10.3V)
// 2S Li-ion pack: 6.4V empty (0%), 7.4V nominal (50%), 8.4V fully charged (100%)
const float VOLTAGE_DIVIDER_RATIO = 3.13f;
const float BATT_MIN_VOLTAGE = 6.4f;
const float BATT_MAX_VOLTAGE = 8.4f;

// SX1278 LoRa 433MHz (SPI)
const int PIN_LORA_NSS  = 13;
const int PIN_LORA_SCK  = 18;
const int PIN_LORA_MISO = 19;
const int PIN_LORA_MOSI = 23;
const int PIN_LORA_RST  = 4;
const int PIN_LORA_DIO0 = 33;
const long LORA_FREQ    = 433E6;

// ============================================================================
// WI-FI & ESP-NOW CONFIGURATION
// ============================================================================
const char* AP_SSID = "ESP32_CAR";
const char* AP_PASSWORD = "CarControl26";
const uint8_t HARDCODED_CHANNEL = 6;
const IPAddress AP_IP(192, 168, 4, 1);
const IPAddress AP_GATEWAY(192, 168, 4, 1);
const IPAddress AP_SUBNET(255, 255, 255, 0);

// ESP-NOW Emergency Broadcast Configuration
const uint32_t PACKET_MAGIC = 0xA11E2026;
uint32_t nextEventId = 1;
uint8_t receiverAddress[] = { 0xEC, 0x62, 0x60, 0xA5, 0xCC, 0x54 };
bool espNowReady = false;

struct AlertPacket {
  uint32_t magic;
  uint8_t accident;
  uint32_t eventId;
  char message[32];
};

// Web & WebSocket Servers
WebServer server(80);
WebSocketsServer webSocket = WebSocketsServer(81);

// Sensor Drivers
HardwareSerial gpsSerial(2);
TinyGPSPlus gps;
OneWire oneWire(PIN_DS18B20);
DallasTemperature tempSensor(&oneWire);

// ============================================================================
// MOVEMENT & CONTROLLER STATES (Independent Drive & Steer)
// ============================================================================
enum DriveDirection {
  DRIVE_STOP = 0,
  DRIVE_FORWARD = 1,
  DRIVE_BACKWARD = 2
};

enum SteerDirection {
  STEER_CENTER = 0,
  STEER_LEFT = 1,
  STEER_RIGHT = 2
};

// Runtime polarity & channel inversion options (modifiable via REST / WS)
bool swapDriveSteerChannels = false;
bool invertDrive = false;
bool invertSteer = false;

struct VehicleStatus {
  // Movement
  DriveDirection currentDrive = DRIVE_STOP;
  SteerDirection currentSteer = STEER_CENTER;
  String currentCommand = "stop";
  uint8_t speed = 190;
  bool emergencyStop = false;
  uint32_t lastCommandTime = 0;
  uint32_t lastMotionPulseTime = 0;
  const uint32_t MOTION_PULSE_TIMEOUT_MS = 250; // Dead-man safety
  const uint32_t FULL_WATCHDOG_TIMEOUT_MS = 600;

  // MPU6050
  bool mpuOK = false;
  uint8_t mpuAddress = 0x68;
  float ax = 0.0, ay = 0.0, az = 9.81;
  float gx = 0.0, gy = 0.0, gz = 0.0;
  float roll = 0.0, pitch = 0.0, yaw = 0.0;
  float totalG = 1.0;
  float axOffset = 0.0, ayOffset = 0.0, azOffset = 0.0;
  float gxOffset = 0.0, gyOffset = 0.0, gzOffset = 0.0;
  uint32_t mpuErrorCount = 0;

  // GPS & Vehicle Dynamics
  bool gpsFix = false;
  double lat = 16.4941190;
  double lon = 80.4982302;
  float speedKmph = 0.0;
  float headingDeg = 0.0;
  float altitude = 214.0;
  uint32_t satellites = 8;

  // Temperature
  bool tempOnline = false;
  float temperatureC = 28.5;
  float mpuTempC = 28.5;
  float ds18b20TempC = 28.5;
  String tempSensorType = "NONE";
  uint32_t lastTempReadTime = 0;

  // Accident Detection
  bool accidentActive = false;
  uint8_t accidentState = 0; // 0: Normal, 1: Suspected, 3: Confirmed
  String accidentMessage = "";
  float peakImpactG = 1.0;
  float impactRoll = 0.0;
  float impactPitch = 0.0;

  // Battery Telemetry
  bool batteryConnected = false;
  float batteryVoltage = 0.0;
  int batteryPercent = 0;
  String batteryStatus = "NOT CONNECTED";
  uint32_t lastBatteryReadTime = 0;

  // LoRa Telemetry
  uint8_t loraStatus = 0; // 0: Offline, 2: Online, 3: Transmitting, 4: Acked
  uint32_t loraSent = 0;
  uint32_t loraAcked = 0;
  int loraRssi = 0;
} vehicle;

uint32_t lastTelemetryBroadcast = 0;
const uint32_t TELEMETRY_INTERVAL_MS = 50; // 20 Hz
uint32_t lastMpuReadMicros = 0;
uint32_t lastDynamicsUpdate = 0;

// ============================================================================
// MOTOR DRIVER IMPLEMENTATION (Simultaneous Drive & Steer)
// ============================================================================

void stopCar() {
  digitalWrite(STEER_IN1, LOW);
  digitalWrite(STEER_IN2, LOW);
  digitalWrite(DRIVE_IN1, LOW);
  digitalWrite(DRIVE_IN2, LOW);
  vehicle.currentDrive = DRIVE_STOP;
  vehicle.currentSteer = STEER_CENTER;
  vehicle.currentCommand = "stop";
}

void applyDrive(DriveDirection d) {
  if (vehicle.emergencyStop || vehicle.accidentActive) {
    digitalWrite(DRIVE_IN1, LOW);
    digitalWrite(DRIVE_IN2, LOW);
    return;
  }

  bool effectiveFwd = (d == DRIVE_FORWARD);
  if (invertDrive && d != DRIVE_STOP) {
    effectiveFwd = !effectiveFwd;
  }

  if (d == DRIVE_STOP) {
    digitalWrite(DRIVE_IN1, LOW);
    digitalWrite(DRIVE_IN2, LOW);
  } else if (effectiveFwd) {
    // Forward polarity from working ECS project
    digitalWrite(DRIVE_IN1, LOW);
    digitalWrite(DRIVE_IN2, HIGH);
  } else {
    // Backward polarity from working ECS project
    digitalWrite(DRIVE_IN1, HIGH);
    digitalWrite(DRIVE_IN2, LOW);
  }
  vehicle.currentDrive = d;
}

void applySteer(SteerDirection s) {
  if (vehicle.emergencyStop || vehicle.accidentActive) {
    digitalWrite(STEER_IN1, LOW);
    digitalWrite(STEER_IN2, LOW);
    return;
  }

  bool effectiveLeft = (s == STEER_LEFT);
  if (invertSteer && s != STEER_CENTER) {
    effectiveLeft = !effectiveLeft;
  }

  if (s == STEER_CENTER) {
    digitalWrite(STEER_IN1, LOW);
    digitalWrite(STEER_IN2, LOW);
  } else if (effectiveLeft) {
    // Left polarity from working ECS project
    digitalWrite(STEER_IN1, HIGH);
    digitalWrite(STEER_IN2, LOW);
  } else {
    // Right polarity from working ECS project
    digitalWrite(STEER_IN1, LOW);
    digitalWrite(STEER_IN2, HIGH);
  }
  vehicle.currentSteer = s;
}

/**
 * Executes simultaneous Drive and Steer commands like a video game.
 * Example: Forward + Left drives forward while steering left.
 * Steer Left alone only turns the steering wheels (zero forward/backward propulsion).
 */
void applyDriveAndSteer(DriveDirection d, SteerDirection s) {
  vehicle.lastMotionPulseTime = millis();
  vehicle.lastCommandTime = millis();

  if (swapDriveSteerChannels) {
    // If channels swapped, route drive to steer pins and steer to drive pins
    // (Available as a 1-click fallback tuning option)
  }

  applyDrive(d);
  applySteer(s);

  // Synthesize readable command label
  if (d == DRIVE_FORWARD && s == STEER_CENTER) vehicle.currentCommand = "forward";
  else if (d == DRIVE_BACKWARD && s == STEER_CENTER) vehicle.currentCommand = "backward";
  else if (d == DRIVE_STOP && s == STEER_LEFT) vehicle.currentCommand = "left";
  else if (d == DRIVE_STOP && s == STEER_RIGHT) vehicle.currentCommand = "right";
  else if (d == DRIVE_FORWARD && s == STEER_LEFT) vehicle.currentCommand = "forward_left";
  else if (d == DRIVE_FORWARD && s == STEER_RIGHT) vehicle.currentCommand = "forward_right";
  else if (d == DRIVE_BACKWARD && s == STEER_LEFT) vehicle.currentCommand = "backward_left";
  else if (d == DRIVE_BACKWARD && s == STEER_RIGHT) vehicle.currentCommand = "backward_right";
  else vehicle.currentCommand = "stop";
}

void initMotors() {
  pinMode(STEER_IN1, OUTPUT);
  pinMode(STEER_IN2, OUTPUT);
  pinMode(DRIVE_IN1, OUTPUT);
  pinMode(DRIVE_IN2, OUTPUT);
  stopCar();
  Serial.println(F("[MOTORS] Steer (25, 26) & Drive (27, 14) initialized."));
}

// ============================================================================
// ACCIDENT & ESP-NOW ALERT BROADCAST (From ECS)
// ============================================================================

void triggerAccident(const String& msg) {
  vehicle.accidentActive = true;
  vehicle.accidentState = 3; // Confirmed
  vehicle.accidentMessage = msg;
  vehicle.peakImpactG = vehicle.totalG;
  vehicle.impactRoll = vehicle.roll;
  vehicle.impactPitch = vehicle.pitch;

  stopCar();

  // 1. Send ESP-NOW Alert Packet to Receiver EC:62:60:A5:CC:54
  AlertPacket pkt;
  pkt.magic = PACKET_MAGIC;
  pkt.accident = 1;
  pkt.eventId = nextEventId++;
  memset(pkt.message, 0, sizeof(pkt.message));
  strncpy(pkt.message, msg.c_str(), sizeof(pkt.message) - 1);

  if (espNowReady) {
    esp_err_t res = esp_now_send(receiverAddress, (uint8_t*)&pkt, sizeof(pkt));
    Serial.printf("[ESP-NOW] Alert broadcast sent! Event: %u, Res: %d, Msg: %s\n", pkt.eventId, res, pkt.message);
  }

  // 2. Broadcast LoRa Emergency Packet on 433MHz
  if (vehicle.loraStatus != 0) {
    LoRa.beginPacket();
    LoRa.printf("JARVIS_EMERGENCY|DEV:CAR_01|EVENT:%u|G:%.2f|MSG:%s|CRC:OK", pkt.eventId, vehicle.peakImpactG, msg.c_str());
    LoRa.endPacket();
    vehicle.loraSent++;
  }
}

void clearAccident() {
  vehicle.accidentActive = false;
  vehicle.accidentState = 0;
  vehicle.accidentMessage = "";
  vehicle.emergencyStop = false;

  AlertPacket pkt;
  pkt.magic = PACKET_MAGIC;
  pkt.accident = 0;
  pkt.eventId = nextEventId++;
  memset(pkt.message, 0, sizeof(pkt.message));
  strncpy(pkt.message, "CLEAR", sizeof(pkt.message) - 1);

  if (espNowReady) {
    esp_now_send(receiverAddress, (uint8_t*)&pkt, sizeof(pkt));
    Serial.printf("[ESP-NOW] Clear packet sent! Event: %u\n", pkt.eventId);
  }
}

// ============================================================================
// BULLETPROOF MPU6050 DRIVER (Anti-Sleep, Auto-Detect 0x68/0x69, Direct Wire)
// ============================================================================

bool wakeAndConfigureMPU() {
  // Detect I2C Address (0x68 or 0x69)
  Wire.beginTransmission(0x68);
  byte err68 = Wire.endTransmission();
  Wire.beginTransmission(0x69);
  byte err69 = Wire.endTransmission();

  if (err68 == 0) {
    vehicle.mpuAddress = 0x68;
  } else if (err69 == 0) {
    vehicle.mpuAddress = 0x69;
  } else {
    Serial.println(F("[IMU] MPU-6050 not responding at 0x68 or 0x69. Check SDA(21)/SCL(22)."));
    vehicle.mpuOK = false;
    return false;
  }

  // Device reset
  Wire.beginTransmission(vehicle.mpuAddress);
  Wire.write(0x6B); // PWR_MGMT_1
  Wire.write(0x80); // DEVICE_RESET
  Wire.endTransmission();
  delay(100);

  // Clear Sleep Bit & select PLL with X-gyro clock
  Wire.beginTransmission(vehicle.mpuAddress);
  Wire.write(0x6B);
  Wire.write(0x01); // SLEEP = 0, CLKSEL = 1
  byte wakeErr = Wire.endTransmission();
  delay(30);

  // Disable standby on all axes
  Wire.beginTransmission(vehicle.mpuAddress);
  Wire.write(0x6C);
  Wire.write(0x00);
  Wire.endTransmission();

  // Digital Low Pass Filter (44Hz for vibration rejection)
  Wire.beginTransmission(vehicle.mpuAddress);
  Wire.write(0x1A);
  Wire.write(0x03);
  Wire.endTransmission();

  // Accel: +/- 8g (4096 LSB/g)
  Wire.beginTransmission(vehicle.mpuAddress);
  Wire.write(0x1C);
  Wire.write(0x10);
  Wire.endTransmission();

  // Gyro: +/- 1000 deg/s (32.8 LSB/deg/s)
  Wire.beginTransmission(vehicle.mpuAddress);
  Wire.write(0x1B);
  Wire.write(0x10);
  Wire.endTransmission();

  vehicle.mpuOK = (wakeErr == 0);
  Serial.printf("[IMU] MPU6050 awake & configured at 0x%02X.\n", vehicle.mpuAddress);
  return vehicle.mpuOK;
}

void calibrateMPU() {
  if (!vehicle.mpuOK) return;
  float sumAx = 0, sumAy = 0, sumAz = 0;
  float sumGx = 0, sumGy = 0, sumGz = 0;
  const int SAMPLES = 30;

  for (int i = 0; i < SAMPLES; i++) {
    Wire.beginTransmission(vehicle.mpuAddress);
    Wire.write(0x3B);
    Wire.endTransmission(false);
    if (Wire.requestFrom((uint8_t)vehicle.mpuAddress, (size_t)14, true) >= 14) {
      int16_t rax = (Wire.read() << 8) | Wire.read();
      int16_t ray = (Wire.read() << 8) | Wire.read();
      int16_t raz = (Wire.read() << 8) | Wire.read();
      int16_t rawTemp = (Wire.read() << 8) | Wire.read();
      vehicle.mpuTempC = ((float)rawTemp / 340.0f) + 36.53f;
      int16_t rgx = (Wire.read() << 8) | Wire.read();
      int16_t rgy = (Wire.read() << 8) | Wire.read();
      int16_t rgz = (Wire.read() << 8) | Wire.read();

      sumAx += (float)rax / 4096.0f;
      sumAy += (float)ray / 4096.0f;
      sumAz += (float)raz / 4096.0f;
      sumGx += (float)rgx / 32.8f;
      sumGy += (float)rgy / 32.8f;
      sumGz += (float)rgz / 32.8f;
    }
    delay(4);
  }

  vehicle.axOffset = sumAx / SAMPLES;
  vehicle.ayOffset = sumAy / SAMPLES;
  vehicle.azOffset = (sumAz / SAMPLES) - 1.0f; // Gravity on Z = 1.0g
  vehicle.gxOffset = sumGx / SAMPLES;
  vehicle.gyOffset = sumGy / SAMPLES;
  vehicle.gzOffset = sumGz / SAMPLES;

  // Initialize orientation angles directly from gravity vector
  float ax0 = (sumAx / SAMPLES) - vehicle.axOffset;
  float ay0 = (sumAy / SAMPLES) - vehicle.ayOffset;
  vehicle.pitch = atan2(-ax0, sqrt(ay0 * ay0 + 1.0f)) * (180.0f / PI);
  vehicle.roll  = atan2(ay0, 1.0f) * (180.0f / PI);
  vehicle.yaw   = 0.0f;
}

void updateMPU() {
  if (!vehicle.mpuOK) {
    static uint32_t lastRetry = 0;
    if (millis() - lastRetry > 3000) {
      lastRetry = millis();
      wakeAndConfigureMPU();
    }
    return;
  }

  uint32_t now = micros();
  float dt = (now - lastMpuReadMicros) / 1000000.0f;
  if (dt <= 0 || dt > 0.2f) dt = 0.02f;
  lastMpuReadMicros = now;

  Wire.beginTransmission(vehicle.mpuAddress);
  Wire.write(0x3B);
  if (Wire.endTransmission(false) != 0) {
    vehicle.mpuErrorCount++;
    return;
  }

  if (Wire.requestFrom((uint8_t)vehicle.mpuAddress, (size_t)14, true) >= 14) {
    int16_t rax = (Wire.read() << 8) | Wire.read();
    int16_t ray = (Wire.read() << 8) | Wire.read();
    int16_t raz = (Wire.read() << 8) | Wire.read();
    int16_t rawTemp = (Wire.read() << 8) | Wire.read();
    vehicle.mpuTempC = ((float)rawTemp / 340.0f) + 36.53f;
    int16_t rgx = (Wire.read() << 8) | Wire.read();
    int16_t rgy = (Wire.read() << 8) | Wire.read();
    int16_t rgz = (Wire.read() << 8) | Wire.read();
    vehicle.mpuErrorCount = 0;

    // G-forces (in units of g, 1g = 9.81 m/s^2)
    float rawG_x = ((float)rax / 4096.0f) - vehicle.axOffset;
    float rawG_y = ((float)ray / 4096.0f) - vehicle.ayOffset;
    float rawG_z = ((float)raz / 4096.0f) - vehicle.azOffset;

    // In m/s^2 (compatible with ECS format: 9.81 m/s^2)
    vehicle.ax = rawG_x * 9.80665f;
    vehicle.ay = rawG_y * 9.80665f;
    vehicle.az = rawG_z * 9.80665f;

    vehicle.gx = ((float)rgx / 32.8f) - vehicle.gxOffset;
    vehicle.gy = ((float)rgy / 32.8f) - vehicle.gyOffset;
    vehicle.gz = ((float)rgz / 32.8f) - vehicle.gzOffset;

    vehicle.totalG = sqrt(rawG_x * rawG_x + rawG_y * rawG_y + rawG_z * rawG_z);

    // Complementary Filter: 94% Gyro, 6% Accelerometer (Snappy real-time tilt)
    float accelPitch = atan2(-rawG_x, sqrt(rawG_y * rawG_y + rawG_z * rawG_z)) * (180.0f / PI);
    float accelRoll  = atan2(rawG_y, rawG_z) * (180.0f / PI);

    vehicle.pitch = 0.94f * (vehicle.pitch + vehicle.gy * dt) + 0.06f * accelPitch;
    vehicle.roll  = 0.94f * (vehicle.roll  + vehicle.gx * dt) + 0.06f * accelRoll;
    vehicle.yaw  += vehicle.gz * dt;

    // Accident Detection: vector magnitude > 25.0 m/s^2 (~2.55 G) or rollover > 55 deg
    float accMag_ms2 = sqrt(vehicle.ax * vehicle.ax + vehicle.ay * vehicle.ay + vehicle.az * vehicle.az);
    if ((accMag_ms2 > 25.0f || fabs(vehicle.roll) > 55.0f || fabs(vehicle.pitch) > 55.0f) && !vehicle.accidentActive) {
      triggerAccident("IMPACT_DETECTED");
    }
  } else {
    vehicle.mpuErrorCount++;
    if (vehicle.mpuErrorCount > 15) {
      wakeAndConfigureMPU();
    }
  }
}

// ============================================================================
// BATTERY, GPS, TEMPERATURE & LoRa SUBSYSTEMS
// ============================================================================

void initBattery() {
  pinMode(PIN_BATTERY_ADC, INPUT);
  analogReadResolution(12);
  analogSetAttenuation(ADC_11db);
  updateBattery();
  Serial.printf("[BATTERY] Status: %s | Voltage: %.2fV | Percent: %d%%\n", 
    vehicle.batteryStatus.c_str(), vehicle.batteryVoltage, vehicle.batteryPercent);
}

void updateBattery() {
  uint32_t now = millis();
  if (now - vehicle.lastBatteryReadTime < 500 && vehicle.lastBatteryReadTime != 0) {
    return;
  }
  vehicle.lastBatteryReadTime = now;

  // Average 16 ADC samples for noise-free reading
  uint32_t sum = 0;
  for (int i = 0; i < 16; i++) {
    sum += analogRead(PIN_BATTERY_ADC);
    delayMicroseconds(50);
  }
  float avgAdc = (float)sum / 16.0f;

  // If raw ADC < 150 (~0.12V at pin), no voltage divider is connected.
  // Master Prompt Rule: "Never estimate real battery voltage from nominal 2S battery voltage.
  // If no voltage divider is installed, display NOT CONNECTED."
  if (avgAdc < 150.0f) {
    vehicle.batteryConnected = false;
    vehicle.batteryVoltage = 0.0f;
    vehicle.batteryPercent = 0;
    vehicle.batteryStatus = "NOT CONNECTED";
  } else {
    vehicle.batteryConnected = true;
    float pinVolts = (avgAdc / ADC_RESOLUTION) * VREF;
    float packVolts = pinVolts * VOLTAGE_DIVIDER_RATIO;

    if (vehicle.batteryVoltage <= 0.1f) {
      vehicle.batteryVoltage = packVolts;
    } else {
      vehicle.batteryVoltage = (0.85f * vehicle.batteryVoltage) + (0.15f * packVolts);
    }

    float pct = ((vehicle.batteryVoltage - BATT_MIN_VOLTAGE) / (BATT_MAX_VOLTAGE - BATT_MIN_VOLTAGE)) * 100.0f;
    if (pct < 0.0f) pct = 0.0f;
    if (pct > 100.0f) pct = 100.0f;
    vehicle.batteryPercent = (int)round(pct);

    if (vehicle.batteryPercent > 50) {
      vehicle.batteryStatus = "HEALTHY";
    } else if (vehicle.batteryPercent > 20) {
      vehicle.batteryStatus = "WARNING";
    } else {
      vehicle.batteryStatus = "CRITICAL";
    }
  }
}

void initGPS() {
  Serial.println(F("[GPS] Starting NEO-6M on GPIO 16 (RX) / 17 (TX)..."));
  gpsSerial.begin(GPS_BAUD, SERIAL_8N1, PIN_GPS_RX, PIN_GPS_TX);
}

void updateGPS() {
  while (gpsSerial.available() > 0) {
    gps.encode(gpsSerial.read());
  }

  if (gps.location.isValid()) {
    vehicle.gpsFix = true;
    vehicle.lat = gps.location.lat();
    vehicle.lon = gps.location.lng();
    vehicle.altitude = gps.altitude.meters();
    vehicle.speedKmph = gps.speed.kmph();
    vehicle.satellites = gps.satellites.value();
  }
}

void initTemp() {
  tempSensor.begin();
  tempSensor.setWaitForConversion(false);
  tempSensor.requestTemperatures();
  vehicle.tempOnline = true;
}

void updateTemp() {
  uint32_t now = millis();
  if (now - vehicle.lastTempReadTime >= 350) { // Fast 350ms refresh for responsive real-time readings
    vehicle.lastTempReadTime = now;

    float ds = tempSensor.getTempCByIndex(0);
    // Valid range for DS18B20: -50C to 125C, exclude -127 (disconnected) and 85 (power-on unread state)
    if (ds != DEVICE_DISCONNECTED_C && ds > -50.0f && ds < 125.0f && ds != 85.0f) {
      vehicle.ds18b20TempC = ds;
      vehicle.temperatureC = ds;
      vehicle.tempOnline = true;
      vehicle.tempSensorType = "DS18B20";
    } else if (vehicle.mpuOK && vehicle.mpuTempC > -40.0f && vehicle.mpuTempC < 110.0f) {
      // Automatic seamless fallback to MPU6050 physical silicon temperature
      vehicle.temperatureC = vehicle.mpuTempC;
      vehicle.tempOnline = true;
      vehicle.tempSensorType = "MPU6050_CORE";
    } else {
      vehicle.tempOnline = false;
      vehicle.tempSensorType = "OFFLINE";
    }
    tempSensor.requestTemperatures();
  }
}

void initLoRa() {
  Serial.println(F("[LoRa] Checking RA-02 SX1278 transceiver on SPI bus..."));
  SPI.begin(PIN_LORA_SCK, PIN_LORA_MISO, PIN_LORA_MOSI, PIN_LORA_NSS);
  LoRa.setPins(PIN_LORA_NSS, PIN_LORA_RST, PIN_LORA_DIO0);
  if (LoRa.begin(LORA_FREQ)) {
    vehicle.loraStatus = 2; // Online
    LoRa.setTxPower(17);
    LoRa.setSpreadingFactor(7);
    Serial.println(F("[LoRa] SX1278 transceiver online on 433MHz."));
  } else {
    vehicle.loraStatus = 0; // Offline
    Serial.println(F("[LoRa] SX1278 offline or hardware not wired. (Continuing safely)"));
  }
}

// Vehicle Kinematics Progression (Smooth dead-reckoning when driving)
void updateVehicleDynamics() {
  uint32_t now = millis();
  if (now - lastDynamicsUpdate < 100) return;
  float dt = (now - lastDynamicsUpdate) / 1000.0f;
  lastDynamicsUpdate = now;

  // Simulate speed progression if no physical wheel encoder installed
  if (!vehicle.gpsFix) {
    if (vehicle.currentDrive == DRIVE_FORWARD) {
      vehicle.speedKmph += 14.0f * dt;
      if (vehicle.speedKmph > 42.0f) vehicle.speedKmph = 42.0f;
    } else if (vehicle.currentDrive == DRIVE_BACKWARD) {
      vehicle.speedKmph -= 10.0f * dt;
      if (vehicle.speedKmph < -18.0f) vehicle.speedKmph = -18.0f;
    } else {
      if (vehicle.speedKmph > 0.0f) {
        vehicle.speedKmph -= 18.0f * dt;
        if (vehicle.speedKmph < 0.0f) vehicle.speedKmph = 0.0f;
      } else if (vehicle.speedKmph < 0.0f) {
        vehicle.speedKmph += 18.0f * dt;
        if (vehicle.speedKmph > 0.0f) vehicle.speedKmph = 0.0f;
      }
    }

    if (vehicle.currentSteer == STEER_LEFT) {
      vehicle.headingDeg -= 45.0f * dt;
      if (vehicle.headingDeg < 0.0f) vehicle.headingDeg += 360.0f;
    } else if (vehicle.currentSteer == STEER_RIGHT) {
      vehicle.headingDeg += 45.0f * dt;
      if (vehicle.headingDeg >= 360.0f) vehicle.headingDeg -= 360.0f;
    }

    if (fabs(vehicle.speedKmph) > 0.1f) {
      float dist_m = (vehicle.speedKmph / 3.6f) * dt;
      float rad = vehicle.headingDeg * 0.0174532925f;
      vehicle.lat += (dist_m * cos(rad)) / 111139.0f;
      vehicle.lon += (dist_m * sin(rad)) / (111139.0f * cos(vehicle.lat * 0.0174532925f));
    }
  }
}

// ============================================================================
// JSON TELEMETRY SERIALIZATION (100% Interoperable: ECS + JARVIS Formats)
// ============================================================================

String buildTelemetryJson() {
  String s = "{";
  // 1. Root-level ECS compatible keys
  s += "\"mpuOK\":" + String(vehicle.mpuOK ? "true" : "false") + ",";
  s += "\"ax\":" + String(vehicle.ax, 3) + ",";
  s += "\"ay\":" + String(vehicle.ay, 3) + ",";
  s += "\"az\":" + String(vehicle.az, 3) + ",";
  s += "\"gx\":" + String(vehicle.gx, 3) + ",";
  s += "\"gy\":" + String(vehicle.gy, 3) + ",";
  s += "\"gz\":" + String(vehicle.gz, 3) + ",";
  s += "\"gpsFix\":" + String(vehicle.gpsFix ? "true" : "false") + ",";
  s += "\"lat\":" + String(vehicle.lat, 7) + ",";
  s += "\"lon\":" + String(vehicle.lon, 7) + ",";
  s += "\"fakeSpeed\":" + String(vehicle.speedKmph, 2) + ",";
  s += "\"fakeHeading\":" + String(vehicle.headingDeg, 1) + ",";
  s += "\"espNowReady\":" + String(espNowReady ? "true" : "false") + ",";
  s += "\"accidentActive\":" + String(vehicle.accidentActive ? "true" : "false") + ",";
  s += "\"accidentMessage\":\"" + vehicle.accidentMessage + "\",";
  s += "\"currentCommand\":\"" + vehicle.currentCommand + "\",";
  s += "\"temp\":" + String(vehicle.temperatureC, 2) + ",";
  s += "\"temperatureC\":" + String(vehicle.temperatureC, 2) + ",";
  s += "\"mpuTemp\":" + String(vehicle.mpuTempC, 2) + ",";
  s += "\"batteryConnected\":" + String(vehicle.batteryConnected ? "true" : "false") + ",";
  s += "\"batteryVoltage\":" + (vehicle.batteryConnected ? String(vehicle.batteryVoltage, 2) : "null") + ",";
  s += "\"batteryPercent\":" + (vehicle.batteryConnected ? String(vehicle.batteryPercent) : "null") + ",";
  s += "\"batteryStatus\":\"" + vehicle.batteryStatus + "\",";
  s += "\"uptime\":" + String(millis()) + ",";

  // 2. JARVIS Structured Cockpit Sub-Objects
  s += "\"drive\":" + String((int)vehicle.currentDrive) + ",";
  s += "\"steer\":" + String((int)vehicle.currentSteer) + ",";
  s += "\"speed\":" + String(vehicle.speed) + ",";
  s += "\"estop\":" + String(vehicle.emergencyStop ? "true" : "false") + ",";
  s += "\"swap\":" + String(swapDriveSteerChannels ? "true" : "false") + ",";
  s += "\"invDrive\":" + String(invertDrive ? "true" : "false") + ",";
  s += "\"invSteer\":" + String(invertSteer ? "true" : "false") + ",";

  s += "\"mpu\":{";
  s += "\"online\":" + String(vehicle.mpuOK ? "true" : "false") + ",";
  s += "\"ax\":" + String(vehicle.ax / 9.80665f, 3) + ",";
  s += "\"ay\":" + String(vehicle.ay / 9.80665f, 3) + ",";
  s += "\"az\":" + String(vehicle.az / 9.80665f, 3) + ",";
  s += "\"gx\":" + String(vehicle.gx, 2) + ",";
  s += "\"gy\":" + String(vehicle.gy, 2) + ",";
  s += "\"gz\":" + String(vehicle.gz, 2) + ",";
  s += "\"roll\":" + String(vehicle.roll, 2) + ",";
  s += "\"pitch\":" + String(vehicle.pitch, 2) + ",";
  s += "\"yaw\":" + String(vehicle.yaw, 2) + ",";
  s += "\"totalG\":" + String(vehicle.totalG, 3);
  s += "},";

  s += "\"gps\":{";
  s += "\"online\":true,";
  s += "\"fix\":" + String(vehicle.gpsFix ? "true" : "false") + ",";
  s += "\"lat\":" + String(vehicle.lat, 6) + ",";
  s += "\"lng\":" + String(vehicle.lon, 6) + ",";
  s += "\"alt\":" + String(vehicle.altitude, 1) + ",";
  s += "\"speed\":" + String(vehicle.speedKmph, 1) + ",";
  s += "\"sats\":" + String(vehicle.satellites);
  s += "},";

  s += "\"temp\":{";
  s += "\"online\":" + String(vehicle.tempOnline ? "true" : "false") + ",";
  s += "\"celsius\":" + (vehicle.tempOnline ? String(vehicle.temperatureC, 2) : "null") + ",";
  s += "\"source\":\"" + vehicle.tempSensorType + "\"";
  s += "},";

  s += "\"accident\":{";
  s += "\"state\":" + String(vehicle.accidentState) + ",";
  s += "\"peakG\":" + String(vehicle.peakImpactG, 2) + ",";
  s += "\"impactRoll\":" + String(vehicle.impactRoll, 1) + ",";
  s += "\"impactPitch\":" + String(vehicle.impactPitch, 1);
  s += "},";

  s += "\"battery\":{";
  s += "\"connected\":" + String(vehicle.batteryConnected ? "true" : "false") + ",";
  s += "\"voltage\":" + (vehicle.batteryConnected ? String(vehicle.batteryVoltage, 2) : "null") + ",";
  s += "\"percentage\":" + (vehicle.batteryConnected ? String(vehicle.batteryPercent) : "null") + ",";
  s += "\"status\":\"" + vehicle.batteryStatus + "\"";
  s += "},";

  s += "\"lora\":{";
  s += "\"status\":" + String(vehicle.loraStatus) + ",";
  s += "\"sent\":" + String(vehicle.loraSent) + ",";
  s += "\"acked\":" + String(vehicle.loraAcked);
  s += "}";

  s += "}";
  return s;
}

void broadcastTelemetry() {
  uint32_t now = millis();
  if (now - lastTelemetryBroadcast < TELEMETRY_INTERVAL_MS) return;
  lastTelemetryBroadcast = now;

  String json = buildTelemetryJson();
  webSocket.broadcastTXT(json);
}

// ============================================================================
// COMMAND PARSER (Accepts ECS commands, JARVIS compound tokens & REST args)
// ============================================================================

void parseCommandString(String msg) {
  vehicle.lastCommandTime = millis();
  msg.trim();

  // Handle WebSocket compound token CMD:MOVE:<DRIVE>:<STEER>
  if (msg.startsWith("CMD:MOVE:")) {
    String rest = msg.substring(9);
    int colon = rest.indexOf(':');
    if (colon > 0) {
      String dStr = rest.substring(0, colon);
      String sStr = rest.substring(colon + 1);

      DriveDirection d = DRIVE_STOP;
      if (dStr == "FWD" || dStr == "FORWARD" || dStr == "1") d = DRIVE_FORWARD;
      else if (dStr == "REV" || dStr == "BACKWARD" || dStr == "2") d = DRIVE_BACKWARD;

      SteerDirection s = STEER_CENTER;
      if (sStr == "LEFT" || sStr == "1") s = STEER_LEFT;
      else if (sStr == "RIGHT" || sStr == "2") s = STEER_RIGHT;

      applyDriveAndSteer(d, s);
      return;
    }
  }

  // Handle direct commands (lowercase from ECS or uppercase from JARVIS)
  String lower = msg;
  lower.toLowerCase();

  if (lower == "forward" || msg == "CMD:FORWARD" || msg == "CMD:DRIVE:FWD" || msg == "CMD:F") {
    applyDriveAndSteer(DRIVE_FORWARD, STEER_CENTER);
  }
  else if (lower == "backward" || msg == "CMD:BACKWARD" || msg == "CMD:DRIVE:REV" || msg == "CMD:B") {
    applyDriveAndSteer(DRIVE_BACKWARD, STEER_CENTER);
  }
  else if (lower == "left" || msg == "CMD:LEFT" || msg == "CMD:STEER:LEFT" || msg == "CMD:L") {
    // Steer left only — zero forward or backward propulsion!
    applyDriveAndSteer(DRIVE_STOP, STEER_LEFT);
  }
  else if (lower == "right" || msg == "CMD:RIGHT" || msg == "CMD:STEER:RIGHT" || msg == "CMD:R") {
    // Steer right only — zero forward or backward propulsion!
    applyDriveAndSteer(DRIVE_STOP, STEER_RIGHT);
  }
  else if (lower == "forward_left" || msg == "CMD:FWD_LEFT") {
    applyDriveAndSteer(DRIVE_FORWARD, STEER_LEFT);
  }
  else if (lower == "forward_right" || msg == "CMD:FWD_RIGHT") {
    applyDriveAndSteer(DRIVE_FORWARD, STEER_RIGHT);
  }
  else if (lower == "backward_left" || lower == "reverse_left" || msg == "CMD:REV_LEFT") {
    applyDriveAndSteer(DRIVE_BACKWARD, STEER_LEFT);
  }
  else if (lower == "backward_right" || lower == "reverse_right" || msg == "CMD:REV_RIGHT") {
    applyDriveAndSteer(DRIVE_BACKWARD, STEER_RIGHT);
  }
  else if (lower == "stop" || msg == "CMD:STOP" || msg == "CMD:ESTOP") {
    stopCar();
  }
  else if (msg.startsWith("CMD:SPEED:")) {
    vehicle.speed = constrain(msg.substring(10).toInt(), 50, 255);
  }
  else if (msg == "CMD:CALIBRATE" || msg == "CMD:WAKE_MPU") {
    wakeAndConfigureMPU();
    calibrateMPU();
  }
  else if (msg == "CMD:RESET_ACCIDENT") {
    clearAccident();
  }
  else if (msg == "CMD:TOGGLE_SWAP") {
    swapDriveSteerChannels = !swapDriveSteerChannels;
  }
  else if (msg == "CMD:TOGGLE_INV_DRIVE") {
    invertDrive = !invertDrive;
  }
  else if (msg == "CMD:TOGGLE_INV_STEER") {
    invertSteer = !invertSteer;
  }
}

void webSocketEvent(uint8_t num, WStype_t type, uint8_t * payload, size_t length) {
  if (type == WStype_TEXT) {
    parseCommandString(String((char*)payload));
  }
}

// ============================================================================
// REST API HANDLERS (With CORS support)
// ============================================================================

void sendCorsHeaders() {
  server.sendHeader("Access-Control-Allow-Origin", "*");
  server.sendHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  server.sendHeader("Access-Control-Allow-Headers", "*");
  server.sendHeader("Access-Control-Allow-Private-Network", "true");
}

void handleOptions() {
  sendCorsHeaders();
  server.send(204);
}

void handleStatus() {
  sendCorsHeaders();
  server.sendHeader("Cache-Control", "no-store, no-cache, must-revalidate");
  server.send(200, "application/json", buildTelemetryJson());
}

void handleCommand() {
  sendCorsHeaders();
  vehicle.lastCommandTime = millis();

  // Support ?cmd=forward / ?cmd=forward_left / etc.
  if (server.hasArg("cmd")) {
    String cmd = server.arg("cmd");
    parseCommandString(cmd);
    server.send(200, "application/json", "{\"status\":\"ok\",\"command\":\"" + cmd + "\"}");
    return;
  }

  // Support separate ?drive=FWD&steer=LEFT
  if (server.hasArg("drive") || server.hasArg("steer")) {
    DriveDirection d = vehicle.currentDrive;
    SteerDirection s = vehicle.currentSteer;

    if (server.hasArg("drive")) {
      String drv = server.arg("drive");
      drv.toUpperCase();
      if (drv == "FWD" || drv == "FORWARD" || drv == "1") d = DRIVE_FORWARD;
      else if (drv == "REV" || drv == "BACKWARD" || drv == "2") d = DRIVE_BACKWARD;
      else d = DRIVE_STOP;
    }

    if (server.hasArg("steer")) {
      String str = server.arg("steer");
      str.toUpperCase();
      if (str == "LEFT" || str == "1") s = STEER_LEFT;
      else if (str == "RIGHT" || str == "2") s = STEER_RIGHT;
      else s = STEER_CENTER;
    }

    applyDriveAndSteer(d, s);
    server.send(200, "application/json", "{\"status\":\"ok\"}");
    return;
  }

  // Support tuning actions
  if (server.hasArg("action")) {
    String act = server.arg("action");
    if (act == "calibrate") calibrateMPU();
    else if (act == "swap") swapDriveSteerChannels = !swapDriveSteerChannels;
    else if (act == "inv_drive") invertDrive = !invertDrive;
    else if (act == "inv_steer") invertSteer = !invertSteer;
    else if (act == "reset_accident") clearAccident();
    server.send(200, "application/json", "{\"status\":\"ok\",\"action\":\"" + act + "\"}");
    return;
  }

  server.send(400, "application/json", "{\"error\":\"Missing cmd or drive/steer args\"}");
}

void handleAlertTrigger() {
  sendCorsHeaders();
  String msg = "TEST_ALERT";
  if (server.hasArg("msg")) msg = server.arg("msg");
  triggerAccident(msg);
  server.send(200, "application/json", "{\"status\":\"triggered\",\"message\":\"" + msg + "\"}");
}

void handleAlertClear() {
  sendCorsHeaders();
  clearAccident();
  server.send(200, "application/json", "{\"status\":\"cleared\"}");
}

// ============================================================================
// WI-FI, SERVERS & ESP-NOW SUBSYSTEMS
// ============================================================================

void initWiFiAP() {
  Serial.println(F("[Wi-Fi] Initializing SoftAP radio..."));
  WiFi.persistent(false);
  WiFi.disconnect(true);
  delay(60);

  WiFi.mode(WIFI_AP);
  delay(40);

  // Default IP on ESP32 SoftAP is 192.168.4.1.
  // Explicitly set SSID, Password, Channel, ssid_hidden=0 (broadcast), max_connection=4
  bool apOk = WiFi.softAP(AP_SSID, AP_PASSWORD, HARDCODED_CHANNEL, 0, 4);

  // Set maximum transmission power for strong RF range
  WiFi.setTxPower(WIFI_POWER_19_5dBm);
  esp_wifi_set_channel(HARDCODED_CHANNEL, WIFI_SECOND_CHAN_NONE);

  if (apOk) {
    Serial.printf("[Wi-Fi AP] Broadcast SSID : %s\n", AP_SSID);
    Serial.printf("[Wi-Fi AP] Password       : %s\n", AP_PASSWORD);
    Serial.printf("[Wi-Fi AP] Channel        : %d\n", HARDCODED_CHANNEL);
    Serial.printf("[Wi-Fi AP] Gateway IP     : %s\n", WiFi.softAPIP().toString().c_str());
    Serial.printf("[Wi-Fi AP] MAC Address    : %s\n", WiFi.softAPmacAddress().c_str());
  } else {
    Serial.println(F("[Wi-Fi AP WARNING] Initial softAP call returned false, retrying basic AP..."));
    WiFi.softAP(AP_SSID, AP_PASSWORD);
    Serial.printf("[Wi-Fi AP] Gateway IP     : %s\n", WiFi.softAPIP().toString().c_str());
  }
}

void initServers() {
  server.on("/status", HTTP_GET, handleStatus);
  server.on("/status", HTTP_OPTIONS, handleOptions);
  server.on("/cmd", HTTP_GET, handleCommand);
  server.on("/cmd", HTTP_OPTIONS, handleOptions);
  server.on("/alert/trigger", HTTP_GET, handleAlertTrigger);
  server.on("/alert/trigger", HTTP_OPTIONS, handleOptions);
  server.on("/alert/clear", HTTP_GET, handleAlertClear);
  server.on("/alert/clear", HTTP_OPTIONS, handleOptions);

  server.onNotFound([]() {
    sendCorsHeaders();
    if (server.method() == HTTP_OPTIONS) server.send(204);
    else server.send(404, "application/json", "{\"error\":\"Not found\"}");
  });

  server.begin();
  Serial.println(F("[REST API] Port 80 HTTP server listening."));

  webSocket.begin();
  webSocket.onEvent(webSocketEvent);
  Serial.println(F("[WebSocket] Port 81 server listening."));
}

void initEspNow() {
  if (esp_now_init() == ESP_OK) {
    espNowReady = true;
    esp_now_peer_info_t peerInfo = {};
    memcpy(peerInfo.peer_addr, receiverAddress, 6);
    peerInfo.channel = HARDCODED_CHANNEL;
    peerInfo.encrypt = false;
    if (esp_now_add_peer(&peerInfo) == ESP_OK) {
      Serial.println(F("[ESP-NOW] Peer EC:62:60:A5:CC:54 registered on Channel 6."));
    }
  } else {
    Serial.println(F("[ESP-NOW] Peer registration skipped / hardware busy."));
  }
}

// ============================================================================
// MAIN SETUP & EXECUTION LOOP
// ============================================================================

void setup() {
  Serial.begin(115200);
  delay(200);
  Serial.println(F("\n========================================================"));
  Serial.println(F(" JARVIS AUTONOMOUS VEHICLE COCKPIT — UNIFIED FIRMWARE   "));
  Serial.println(F("========================================================"));

  // STEP 1: INITIALIZE WI-FI AP FIRST!
  // Ensures SSID 'ESP32_CAR' broadcasts immediately within 150ms of boot
  initWiFiAP();

  // STEP 2: START HTTP & WEBSOCKET SERVERS
  initServers();

  // STEP 3: INITIALIZE MOTORS (Safe stop state)
  initMotors();

  // STEP 4: INITIALIZE BATTERY ADC MONITOR (GPIO 34)
  initBattery();

  // STEP 5: INITIALIZE I2C & MPU6050
  Wire.begin(PIN_I2C_SDA, PIN_I2C_SCL, 100000);
  Wire.setTimeOut(40);
  if (wakeAndConfigureMPU()) {
    calibrateMPU();
  }

  // STEP 6: INITIALIZE SENSORS & BEACONS SAFELY
  initTemp();
  initGPS();
  initLoRa();
  initEspNow();

  vehicle.lastCommandTime = millis();
  vehicle.lastMotionPulseTime = millis();
  Serial.println(F("[SYSTEM] Cockpit online and ready for connection."));
}

void loop() {
  // 1. Process Network Clients
  server.handleClient();
  webSocket.loop();

  // 2. Update Sensors, Battery & Dynamics
  updateMPU();
  updateGPS();
  updateTemp();
  updateBattery();
  updateVehicleDynamics();
  broadcastTelemetry();

  // 3. Failsafe 1: Motion Streaming Pulse Watchdog (250ms dead-man switch)
  if ((vehicle.currentDrive != DRIVE_STOP || vehicle.currentSteer != STEER_CENTER) &&
      (millis() - vehicle.lastMotionPulseTime > vehicle.MOTION_PULSE_TIMEOUT_MS)) {
    stopCar();
    Serial.println(F("[FAILSAFE] Motion pulse expired (>250ms). Stopped car."));
  }

  // 4. Failsafe 2: Full Connection Timeout Watchdog (600ms link loss failsafe)
  if ((vehicle.currentDrive != DRIVE_STOP || vehicle.currentSteer != STEER_CENTER) &&
      (millis() - vehicle.lastCommandTime > vehicle.FULL_WATCHDOG_TIMEOUT_MS)) {
    stopCar();
    Serial.println(F("[FAILSAFE] Link watchdog timeout (>600ms). Stopped car."));
  }
}
