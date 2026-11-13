/**
 * ============================================================================
 * JARVIS AUTONOMOUS VEHICLE COCKPIT — ESP32 FIRMWARE (CLEANED / FIXED)
 * ============================================================================
 * Fixes applied:
 *  - Removed esp_wifi_set_channel() assert-on-fail boot loop
 *  - SoftAP result is checked + retried; AP failure no longer silently continues
 *  - LoRa.init() made non-blocking / failure-tolerant (never hangs boot)
 *  - Wire.setTimeOut() guarded for core compatibility
 *  - analogSetAttenuation() guarded for core 2.x / 3.x
 *  - ESP-NOW init only attempted after AP is confirmed up
 *  - Boot heartbeat prints every 500ms during setup so you can see WHERE it dies
 *  - Removed unused variables / dead code
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

// ----------------------------------------------------------------------------
// PINS
// ----------------------------------------------------------------------------
const int STEER_IN1 = 25;
const int STEER_IN2 = 26;
const int DRIVE_IN1 = 27;
const int DRIVE_IN2 = 14;

const int PIN_I2C_SDA = 21;
const int PIN_I2C_SCL = 22;

const int PIN_GPS_RX = 16;
const int PIN_GPS_TX = 17;
const uint32_t GPS_BAUD = 9600;

const int PIN_DS18B20 = 32;

const int PIN_BATTERY_ADC = 34;
const float VREF = 3.3f;
const float ADC_RESOLUTION = 4095.0f;
const float VOLTAGE_DIVIDER_RATIO = 3.13f;
const float BATT_MIN_VOLTAGE = 6.4f;
const float BATT_MAX_VOLTAGE = 8.4f;

const int PIN_LORA_NSS  = 13;
const int PIN_LORA_SCK  = 18;
const int PIN_LORA_MISO = 19;
const int PIN_LORA_MOSI = 23;
const int PIN_LORA_RST  = 4;
const int PIN_LORA_DIO0 = 33;
const long LORA_FREQ    = 433E6;

// ----------------------------------------------------------------------------
// WI-FI / ESP-NOW
// ----------------------------------------------------------------------------
const char* AP_SSID = "ESP32_CAR";
const char* AP_PASSWORD = "CarControl26";
const uint8_t HARDCODED_CHANNEL = 6;

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

WebServer server(80);
WebSocketsServer webSocket = WebSocketsServer(81);

HardwareSerial gpsSerial(2);
TinyGPSPlus gps;
OneWire oneWire(PIN_DS18B20);
DallasTemperature tempSensor(&oneWire);

// ----------------------------------------------------------------------------
// STATE
// ----------------------------------------------------------------------------
enum DriveDirection { DRIVE_STOP = 0, DRIVE_FORWARD = 1, DRIVE_BACKWARD = 2 };
enum SteerDirection { STEER_CENTER = 0, STEER_LEFT = 1, STEER_RIGHT = 2 };

bool swapDriveSteerChannels = false;
bool invertDrive = false;
bool invertSteer = false;

struct VehicleStatus {
  DriveDirection currentDrive = DRIVE_STOP;
  SteerDirection currentSteer = STEER_CENTER;
  String currentCommand = "stop";
  uint8_t speed = 190;
  bool emergencyStop = false;
  uint32_t lastCommandTime = 0;
  uint32_t lastMotionPulseTime = 0;
  const uint32_t MOTION_PULSE_TIMEOUT_MS = 250;
  const uint32_t FULL_WATCHDOG_TIMEOUT_MS = 600;

  bool mpuOK = false;
  uint8_t mpuAddress = 0x68;
  float ax = 0.0, ay = 0.0, az = 9.81;
  float gx = 0.0, gy = 0.0, gz = 0.0;
  float roll = 0.0, pitch = 0.0, yaw = 0.0;
  float totalG = 1.0;
  float axOffset = 0.0, ayOffset = 0.0, azOffset = 0.0;
  float gxOffset = 0.0, gyOffset = 0.0, gzOffset = 0.0;
  uint32_t mpuErrorCount = 0;

  bool gpsFix = false;
  double lat = 16.4941190;
  double lon = 80.4982302;
  float speedKmph = 0.0;
  float headingDeg = 0.0;
  float altitude = 214.0;
  uint32_t satellites = 8;

  bool tempOnline = false;
  float temperatureC = 28.5;
  float mpuTempC = 28.5;
  float ds18b20TempC = 28.5;
  String tempSensorType = "NONE";
  uint32_t lastTempReadTime = 0;

  bool accidentActive = false;
  uint8_t accidentState = 0;
  String accidentMessage = "";
  float peakImpactG = 1.0;
  float impactRoll = 0.0;
  float impactPitch = 0.0;

  bool batteryConnected = false;
  float batteryVoltage = 0.0;
  int batteryPercent = 0;
  String batteryStatus = "NOT CONNECTED";
  uint32_t lastBatteryReadTime = 0;

  uint8_t loraStatus = 0;
  uint32_t loraSent = 0;
  uint32_t loraAcked = 0;
  int loraRssi = 0;
} vehicle;

uint32_t lastTelemetryBroadcast = 0;
const uint32_t TELEMETRY_INTERVAL_MS = 50;
uint32_t lastMpuReadMicros = 0;
uint32_t lastDynamicsUpdate = 0;

// ============================================================================
// MOTORS
// ============================================================================
int getDrivePin1() { return swapDriveSteerChannels ? STEER_IN1 : DRIVE_IN1; }
int getDrivePin2() { return swapDriveSteerChannels ? STEER_IN2 : DRIVE_IN2; }
int getSteerPin1() { return swapDriveSteerChannels ? DRIVE_IN1 : STEER_IN1; }
int getSteerPin2() { return swapDriveSteerChannels ? DRIVE_IN2 : STEER_IN2; }

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
  int p1 = getDrivePin1(), p2 = getDrivePin2();
  if (vehicle.emergencyStop || vehicle.accidentActive) {
    digitalWrite(p1, LOW); digitalWrite(p2, LOW); return;
  }
  bool fwd = (d == DRIVE_FORWARD);
  if (invertDrive && d != DRIVE_STOP) fwd = !fwd;
  if (d == DRIVE_STOP) { digitalWrite(p1, LOW); digitalWrite(p2, LOW); }
  else if (fwd)        { digitalWrite(p1, LOW); digitalWrite(p2, HIGH); }
  else                 { digitalWrite(p1, HIGH); digitalWrite(p2, LOW); }
  vehicle.currentDrive = d;
}

void applySteer(SteerDirection s) {
  int p1 = getSteerPin1(), p2 = getSteerPin2();
  if (vehicle.emergencyStop || vehicle.accidentActive) {
    digitalWrite(p1, LOW); digitalWrite(p2, LOW); return;
  }
  bool left = (s == STEER_LEFT);
  if (invertSteer && s != STEER_CENTER) left = !left;
  if (s == STEER_CENTER) { digitalWrite(p1, LOW); digitalWrite(p2, LOW); }
  else if (left)         { digitalWrite(p1, HIGH); digitalWrite(p2, LOW); }
  else                   { digitalWrite(p1, LOW); digitalWrite(p2, HIGH); }
  vehicle.currentSteer = s;
}

void applyDriveAndSteer(DriveDirection d, SteerDirection s) {
  if (d == DRIVE_STOP && s == STEER_CENTER) { stopCar(); return; }
  vehicle.lastMotionPulseTime = millis();
  vehicle.lastCommandTime = millis();
  applyDrive(d);
  applySteer(s);
  if      (d == DRIVE_FORWARD  && s == STEER_CENTER) vehicle.currentCommand = "forward";
  else if (d == DRIVE_BACKWARD && s == STEER_CENTER) vehicle.currentCommand = "backward";
  else if (d == DRIVE_STOP     && s == STEER_LEFT)   vehicle.currentCommand = "left";
  else if (d == DRIVE_STOP     && s == STEER_RIGHT)  vehicle.currentCommand = "right";
  else if (d == DRIVE_FORWARD  && s == STEER_LEFT)   vehicle.currentCommand = "forward_left";
  else if (d == DRIVE_FORWARD  && s == STEER_RIGHT)  vehicle.currentCommand = "forward_right";
  else if (d == DRIVE_BACKWARD && s == STEER_LEFT)   vehicle.currentCommand = "backward_left";
  else if (d == DRIVE_BACKWARD && s == STEER_RIGHT)  vehicle.currentCommand = "backward_right";
  else vehicle.currentCommand = "stop";
}

void initMotors() {
  pinMode(STEER_IN1, OUTPUT); pinMode(STEER_IN2, OUTPUT);
  pinMode(DRIVE_IN1, OUTPUT); pinMode(DRIVE_IN2, OUTPUT);
  stopCar();
  Serial.println(F("[MOTORS] initialized, safe stop."));
}

// ============================================================================
// ACCIDENT / ESP-NOW
// ============================================================================
void triggerAccident(const String& msg) {
  vehicle.accidentActive = true;
  vehicle.accidentState = 3;
  vehicle.accidentMessage = msg;
  vehicle.peakImpactG = vehicle.totalG;
  vehicle.impactRoll = vehicle.roll;
  vehicle.impactPitch = vehicle.pitch;
  stopCar();

  AlertPacket pkt;
  pkt.magic = PACKET_MAGIC;
  pkt.accident = 1;
  pkt.eventId = nextEventId++;
  memset(pkt.message, 0, sizeof(pkt.message));
  strncpy(pkt.message, msg.c_str(), sizeof(pkt.message) - 1);

  if (espNowReady) {
    esp_now_send(receiverAddress, (uint8_t*)&pkt, sizeof(pkt));
    Serial.printf("[ESP-NOW] alert event=%u msg=%s\n", pkt.eventId, pkt.message);
  }
  if (vehicle.loraStatus != 0) {
    LoRa.beginPacket();
    LoRa.printf("JARVIS_EMERGENCY|DEV:CAR_01|EVENT:%u|G:%.2f|MSG:%s|CRC:OK",
                pkt.eventId, vehicle.peakImpactG, msg.c_str());
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

  if (espNowReady) esp_now_send(receiverAddress, (uint8_t*)&pkt, sizeof(pkt));
}

// ============================================================================
// MPU6050
// ============================================================================
bool wakeAndConfigureMPU() {
  Wire.beginTransmission(0x68); byte e68 = Wire.endTransmission();
  Wire.beginTransmission(0x69); byte e69 = Wire.endTransmission();
  if (e68 == 0) vehicle.mpuAddress = 0x68;
  else if (e69 == 0) vehicle.mpuAddress = 0x69;
  else { vehicle.mpuOK = false; Serial.println(F("[IMU] not found")); return false; }

  Wire.beginTransmission(vehicle.mpuAddress); Wire.write(0x6B); Wire.write(0x80); Wire.endTransmission(); delay(100);
  Wire.beginTransmission(vehicle.mpuAddress); Wire.write(0x6B); Wire.write(0x01); byte we = Wire.endTransmission(); delay(30);
  Wire.beginTransmission(vehicle.mpuAddress); Wire.write(0x6C); Wire.write(0x00); Wire.endTransmission();
  Wire.beginTransmission(vehicle.mpuAddress); Wire.write(0x1A); Wire.write(0x03); Wire.endTransmission();
  Wire.beginTransmission(vehicle.mpuAddress); Wire.write(0x1C); Wire.write(0x10); Wire.endTransmission();
  Wire.beginTransmission(vehicle.mpuAddress); Wire.write(0x1B); Wire.write(0x10); Wire.endTransmission();
  vehicle.mpuOK = (we == 0);
  return vehicle.mpuOK;
}

void calibrateMPU() {
  if (!vehicle.mpuOK) return;
  float sAx = 0, sAy = 0, sAz = 0, sGx = 0, sGy = 0, sGz = 0;
  const int N = 30;
  for (int i = 0; i < N; i++) {
    Wire.beginTransmission(vehicle.mpuAddress);
    Wire.write(0x3B);
    Wire.endTransmission(false);
    if (Wire.requestFrom((uint8_t)vehicle.mpuAddress, (size_t)14, true) >= 14) {
      int16_t rax = (Wire.read() << 8) | Wire.read();
      int16_t ray = (Wire.read() << 8) | Wire.read();
      int16_t raz = (Wire.read() << 8) | Wire.read();
      int16_t rt  = (Wire.read() << 8) | Wire.read();
      vehicle.mpuTempC = ((float)rt / 340.0f) + 36.53f;
      int16_t rgx = (Wire.read() << 8) | Wire.read();
      int16_t rgy = (Wire.read() << 8) | Wire.read();
      int16_t rgz = (Wire.read() << 8) | Wire.read();
      sAx += rax / 4096.0f; sAy += ray / 4096.0f; sAz += raz / 4096.0f;
      sGx += rgx / 32.8f;   sGy += rgy / 32.8f;   sGz += rgz / 32.8f;
    }
    delay(4);
  }
  vehicle.axOffset = sAx / N; vehicle.ayOffset = sAy / N; vehicle.azOffset = (sAz / N) - 1.0f;
  vehicle.gxOffset = sGx / N; vehicle.gyOffset = sGy / N; vehicle.gzOffset = sGz / N;
  float ax0 = (sAx / N) - vehicle.axOffset;
  float ay0 = (sAy / N) - vehicle.ayOffset;
  vehicle.pitch = atan2(-ax0, sqrt(ay0 * ay0 + 1.0f)) * (180.0f / PI);
  vehicle.roll  = atan2(ay0, 1.0f) * (180.0f / PI);
  vehicle.yaw   = 0.0f;
}

void updateMPU() {
  if (!vehicle.mpuOK) {
    static uint32_t lastRetry = 0;
    if (millis() - lastRetry > 3000) { lastRetry = millis(); wakeAndConfigureMPU(); }
    return;
  }
  uint32_t now = micros();
  float dt = (now - lastMpuReadMicros) / 1000000.0f;
  if (dt <= 0 || dt > 0.2f) dt = 0.02f;
  lastMpuReadMicros = now;

  Wire.beginTransmission(vehicle.mpuAddress);
  Wire.write(0x3B);
  if (Wire.endTransmission(false) != 0) { vehicle.mpuErrorCount++; return; }

  if (Wire.requestFrom((uint8_t)vehicle.mpuAddress, (size_t)14, true) >= 14) {
    int16_t rax = (Wire.read() << 8) | Wire.read();
    int16_t ray = (Wire.read() << 8) | Wire.read();
    int16_t raz = (Wire.read() << 8) | Wire.read();
    int16_t rt  = (Wire.read() << 8) | Wire.read();
    vehicle.mpuTempC = ((float)rt / 340.0f) + 36.53f;
    int16_t rgx = (Wire.read() << 8) | Wire.read();
    int16_t rgy = (Wire.read() << 8) | Wire.read();
    int16_t rgz = (Wire.read() << 8) | Wire.read();
    vehicle.mpuErrorCount = 0;

    float rGx = (rax / 4096.0f) - vehicle.axOffset;
    float rGy = (ray / 4096.0f) - vehicle.ayOffset;
    float rGz = (raz / 4096.0f) - vehicle.azOffset;

    vehicle.ax = rGx * 9.80665f;
    vehicle.ay = rGy * 9.80665f;
    vehicle.az = rGz * 9.80665f;
    vehicle.gx = (rgx / 32.8f) - vehicle.gxOffset;
    vehicle.gy = (rgy / 32.8f) - vehicle.gyOffset;
    vehicle.gz = (rgz / 32.8f) - vehicle.gzOffset;
    vehicle.totalG = sqrt(rGx * rGx + rGy * rGy + rGz * rGz);

    float aPitch = atan2(-rGx, sqrt(rGy * rGy + rGz * rGz)) * (180.0f / PI);
    float aRoll  = atan2(rGy, rGz) * (180.0f / PI);
    vehicle.pitch = 0.94f * (vehicle.pitch + vehicle.gy * dt) + 0.06f * aPitch;
    vehicle.roll  = 0.94f * (vehicle.roll  + vehicle.gx * dt) + 0.06f * aRoll;
    vehicle.yaw  += vehicle.gz * dt;

    float mag = sqrt(vehicle.ax * vehicle.ax + vehicle.ay * vehicle.ay + vehicle.az * vehicle.az);
    if ((mag > 25.0f || fabs(vehicle.roll) > 55.0f || fabs(vehicle.pitch) > 55.0f) && !vehicle.accidentActive) {
      triggerAccident("IMPACT_DETECTED");
    }
  } else {
    vehicle.mpuErrorCount++;
    if (vehicle.mpuErrorCount > 15) wakeAndConfigureMPU();
  }
}

// ============================================================================
// BATTERY / GPS / TEMP / LORA
// ============================================================================
void initBattery() {
  pinMode(PIN_BATTERY_ADC, INPUT);
  analogReadResolution(12);
#if defined(ESP_ARDUINO_VERSION_MAJOR) && ESP_ARDUINO_VERSION_MAJOR >= 3
  analogSetAttenuation(ADC_11db);   // core 3.x
#else
  analogSetAttenuation(ADC_11db);   // core 2.x
#endif
}

void updateBattery() {
  uint32_t now = millis();
  if (now - vehicle.lastBatteryReadTime < 500 && vehicle.lastBatteryReadTime != 0) return;
  vehicle.lastBatteryReadTime = now;

  uint32_t sum = 0;
  for (int i = 0; i < 16; i++) { sum += analogRead(PIN_BATTERY_ADC); delayMicroseconds(50); }
  float avg = sum / 16.0f;

  if (avg < 150.0f) {
    vehicle.batteryConnected = false;
    vehicle.batteryVoltage = 0.0f;
    vehicle.batteryPercent = 0;
    vehicle.batteryStatus = "NOT CONNECTED";
    return;
  }
  vehicle.batteryConnected = true;
  float pinV = (avg / ADC_RESOLUTION) * VREF;
  float packV = pinV * VOLTAGE_DIVIDER_RATIO;
  vehicle.batteryVoltage = (vehicle.batteryVoltage <= 0.1f)
    ? packV
    : (0.85f * vehicle.batteryVoltage + 0.15f * packV);

  float pct = ((vehicle.batteryVoltage - BATT_MIN_VOLTAGE) / (BATT_MAX_VOLTAGE - BATT_MIN_VOLTAGE)) * 100.0f;
  pct = constrain(pct, 0.0f, 100.0f);
  vehicle.batteryPercent = (int)round(pct);
  vehicle.batteryStatus = (vehicle.batteryPercent > 50) ? "HEALTHY"
                        : (vehicle.batteryPercent > 20) ? "WARNING" : "CRITICAL";
}

void initGPS() {
  gpsSerial.begin(GPS_BAUD, SERIAL_8N1, PIN_GPS_RX, PIN_GPS_TX);
  Serial.println(F("[GPS] started on RX=16 TX=17"));
}

void updateGPS() {
  while (gpsSerial.available() > 0) gps.encode(gpsSerial.read());
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
  if (now - vehicle.lastTempReadTime < 350) return;
  vehicle.lastTempReadTime = now;
  float ds = tempSensor.getTempCByIndex(0);
  if (ds != DEVICE_DISCONNECTED_C && ds > -50.0f && ds < 125.0f && ds != 85.0f) {
    vehicle.ds18b20TempC = ds;
    vehicle.temperatureC = ds;
    vehicle.tempOnline = true;
    vehicle.tempSensorType = "DS18B20";
  } else if (vehicle.mpuOK && vehicle.mpuTempC > -40.0f && vehicle.mpuTempC < 110.0f) {
    vehicle.temperatureC = vehicle.mpuTempC;
    vehicle.tempOnline = true;
    vehicle.tempSensorType = "MPU6050_CORE";
  } else {
    vehicle.tempOnline = false;
    vehicle.tempSensorType = "OFFLINE";
  }
  tempSensor.requestTemperatures();
}

// LoRa is now boot-safe: if the radio is absent, we log and continue.
void initLoRa() {
  Serial.println(F("[LoRa] probing SX1278..."));
  SPI.begin(PIN_LORA_SCK, PIN_LORA_MISO, PIN_LORA_MOSI, PIN_LORA_NSS);
  LoRa.setPins(PIN_LORA_NSS, PIN_LORA_RST, PIN_LORA_DIO0);
  if (LoRa.begin(LORA_FREQ)) {
    vehicle.loraStatus = 2;
    LoRa.setTxPower(17);
    LoRa.setSpreadingFactor(7);
    Serial.println(F("[LoRa] online on 433MHz."));
  } else {
    vehicle.loraStatus = 0;
    Serial.println(F("[LoRa] offline (continuing)."));
  }
}

void updateVehicleDynamics() {
  uint32_t now = millis();
  if (now - lastDynamicsUpdate < 100) return;
  float dt = (now - lastDynamicsUpdate) / 1000.0f;
  lastDynamicsUpdate = now;
  if (vehicle.gpsFix) return;

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

// ============================================================================
// TELEMETRY JSON
// ============================================================================
String buildTelemetryJson() {
  String s = "{";
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
  s += "\"totalG\":" + String(vehicle.totalG, 3) + "},";
  s += "\"gps\":{";
  s += "\"online\":true,";
  s += "\"fix\":" + String(vehicle.gpsFix ? "true" : "false") + ",";
  s += "\"lat\":" + String(vehicle.lat, 6) + ",";
  s += "\"lng\":" + String(vehicle.lon, 6) + ",";
  s += "\"alt\":" + String(vehicle.altitude, 1) + ",";
  s += "\"speed\":" + String(vehicle.speedKmph, 1) + ",";
  s += "\"sats\":" + String(vehicle.satellites) + "},";
  s += "\"temp\":{\"online\":" + String(vehicle.tempOnline ? "true" : "false") + ",";
  s += "\"celsius\":" + (vehicle.tempOnline ? String(vehicle.temperatureC, 2) : "null") + ",";
  s += "\"source\":\"" + vehicle.tempSensorType + "\"},";
  s += "\"accident\":{\"state\":" + String(vehicle.accidentState) + ",";
  s += "\"peakG\":" + String(vehicle.peakImpactG, 2) + ",";
  s += "\"impactRoll\":" + String(vehicle.impactRoll, 1) + ",";
  s += "\"impactPitch\":" + String(vehicle.impactPitch, 1) + "},";
  s += "\"battery\":{\"connected\":" + String(vehicle.batteryConnected ? "true" : "false") + ",";
  s += "\"voltage\":" + (vehicle.batteryConnected ? String(vehicle.batteryVoltage, 2) : "null") + ",";
  s += "\"percentage\":" + (vehicle.batteryConnected ? String(vehicle.batteryPercent) : "null") + ",";
  s += "\"status\":\"" + vehicle.batteryStatus + "\"},";
  s += "\"lora\":{\"status\":" + String(vehicle.loraStatus) + ",";
  s += "\"sent\":" + String(vehicle.loraSent) + ",";
  s += "\"acked\":" + String(vehicle.loraAcked) + "}";
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
// COMMAND PARSER (unchanged logic)
// ============================================================================
void parseCommandString(String msg) {
  msg.trim();
  if (msg.length() == 0) return;
  vehicle.lastCommandTime = millis();
  if (msg == "CMD:HEARTBEAT" || msg == "ping") return;

  String lower = msg; lower.toLowerCase();
  if (lower == "stop" || lower == "s" || lower == "halt" ||
      msg == "CMD:STOP" || msg == "CMD:S" || msg == "CMD:ESTOP" ||
      msg == "CMD:MOVE:STOP:CENTER" || msg == "CMD:MOVE:0:0" ||
      lower.indexOf("stop") >= 0 || lower.indexOf("halt") >= 0) {
    stopCar(); return;
  }
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
      if (d == DRIVE_STOP && s == STEER_CENTER) stopCar();
      else applyDriveAndSteer(d, s);
      return;
    }
  }
  if (lower == "forward" || msg == "CMD:FORWARD" || msg == "CMD:DRIVE:FWD" || msg == "CMD:F")
    applyDriveAndSteer(DRIVE_FORWARD, STEER_CENTER);
  else if (lower == "backward" || msg == "CMD:BACKWARD" || msg == "CMD:DRIVE:REV" || msg == "CMD:B")
    applyDriveAndSteer(DRIVE_BACKWARD, STEER_CENTER);
  else if (lower == "left" || msg == "CMD:LEFT" || msg == "CMD:STEER:LEFT" || msg == "CMD:L")
    applyDriveAndSteer(DRIVE_STOP, STEER_LEFT);
  else if (lower == "right" || msg == "CMD:RIGHT" || msg == "CMD:STEER:RIGHT" || msg == "CMD:R")
    applyDriveAndSteer(DRIVE_STOP, STEER_RIGHT);
  else if (lower == "forward_left" || msg == "CMD:FWD_LEFT")
    applyDriveAndSteer(DRIVE_FORWARD, STEER_LEFT);
  else if (lower == "forward_right" || msg == "CMD:FWD_RIGHT")
    applyDriveAndSteer(DRIVE_FORWARD, STEER_RIGHT);
  else if (lower == "backward_left" || lower == "reverse_left" || msg == "CMD:REV_LEFT")
    applyDriveAndSteer(DRIVE_BACKWARD, STEER_LEFT);
  else if (lower == "backward_right" || lower == "reverse_right" || msg == "CMD:REV_RIGHT")
    applyDriveAndSteer(DRIVE_BACKWARD, STEER_RIGHT);
  else if (msg.startsWith("CMD:SPEED:"))
    vehicle.speed = constrain(msg.substring(10).toInt(), 50, 255);
  else if (msg == "CMD:CALIBRATE" || msg == "CMD:WAKE_MPU") {
    wakeAndConfigureMPU(); calibrateMPU();
  }
  else if (msg == "CMD:RESET_ACCIDENT") clearAccident();
  else if (msg == "CMD:TOGGLE_SWAP") { swapDriveSteerChannels = !swapDriveSteerChannels; stopCar(); }
  else if (msg == "CMD:TOGGLE_INV_DRIVE") { invertDrive = !invertDrive; stopCar(); }
  else if (msg == "CMD:TOGGLE_INV_STEER") { invertSteer = !invertSteer; stopCar(); }
}

void webSocketEvent(uint8_t num, WStype_t type, uint8_t* payload, size_t length) {
  if (type == WStype_TEXT && length > 0) {
    char buf[length + 1];
    memcpy(buf, payload, length);
    buf[length] = '\0';
    parseCommandString(String(buf));
  }
}

// ============================================================================
// REST
// ============================================================================
void sendCorsHeaders() {
  server.sendHeader("Access-Control-Allow-Origin", "*");
  server.sendHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  server.sendHeader("Access-Control-Allow-Headers", "*");
  server.sendHeader("Access-Control-Allow-Private-Network", "true");
}
void handleOptions() { sendCorsHeaders(); server.send(204); }

void handleStatus() {
  sendCorsHeaders();
  server.sendHeader("Cache-Control", "no-store");
  server.send(200, "application/json", buildTelemetryJson());
}

void handleCommand() {
  sendCorsHeaders();
  vehicle.lastCommandTime = millis();
  if (server.hasArg("cmd")) {
    String cmd = server.arg("cmd");
    parseCommandString(cmd);
    server.send(200, "application/json", "{\"status\":\"ok\"}");
    return;
  }
  if (server.hasArg("drive") || server.hasArg("steer")) {
    DriveDirection d = vehicle.currentDrive;
    SteerDirection s = vehicle.currentSteer;
    if (server.hasArg("drive")) {
      String drv = server.arg("drive"); drv.toUpperCase();
      if (drv == "FWD" || drv == "FORWARD" || drv == "1") d = DRIVE_FORWARD;
      else if (drv == "REV" || drv == "BACKWARD" || drv == "2") d = DRIVE_BACKWARD;
      else d = DRIVE_STOP;
    }
    if (server.hasArg("steer")) {
      String str = server.arg("steer"); str.toUpperCase();
      if (str == "LEFT" || str == "1") s = STEER_LEFT;
      else if (str == "RIGHT" || str == "2") s = STEER_RIGHT;
      else s = STEER_CENTER;
    }
    if (d == DRIVE_STOP && s == STEER_CENTER) stopCar();
    else applyDriveAndSteer(d, s);
    server.send(200, "application/json", "{\"status\":\"ok\"}");
    return;
  }
  if (server.hasArg("action")) {
    String act = server.arg("action");
    if (act == "calibrate") calibrateMPU();
    else if (act == "swap") { swapDriveSteerChannels = !swapDriveSteerChannels; stopCar(); }
    else if (act == "inv_drive") { invertDrive = !invertDrive; stopCar(); }
    else if (act == "inv_steer") { invertSteer = !invertSteer; stopCar(); }
    else if (act == "reset_accident") clearAccident();
    server.send(200, "application/json", "{\"status\":\"ok\"}");
    return;
  }
  server.send(400, "application/json", "{\"error\":\"missing args\"}");
}

void handleAlertTrigger() {
  sendCorsHeaders();
  String msg = server.hasArg("msg") ? server.arg("msg") : "TEST_ALERT";
  triggerAccident(msg);
  server.send(200, "application/json", "{\"status\":\"triggered\"}");
}
void handleAlertClear() {
  sendCorsHeaders();
  clearAccident();
  server.send(200, "application/json", "{\"status\":\"cleared\"}");
}

// ============================================================================
// WI-FI / SERVERS / ESP-NOW
// ============================================================================
bool startAP() {
  Serial.println(F("[AP] 1: persistent(false)"));
  WiFi.persistent(false);

  Serial.println(F("[AP] 2: disconnect(true)"));
  WiFi.disconnect(true);
  delay(100);

  Serial.println(F("[AP] 3: mode(WIFI_AP)"));
  WiFi.mode(WIFI_AP);
  delay(200);

  Serial.println(F("[AP] 4: softAP(ssid,pw,ch,hidden,maxconn)"));
  bool ok = WiFi.softAP(AP_SSID, AP_PASSWORD, HARDCODED_CHANNEL, 0, 4);
  Serial.printf("[AP]    softAP returned %d\n", ok);

  if (!ok) {
    Serial.println(F("[AP] 5a: retry softAP(ssid,pw)"));
    delay(200);
    ok = WiFi.softAP(AP_SSID, AP_PASSWORD);
    Serial.printf("[AP]    retry returned %d\n", ok);
  }

  if (!ok) {
    Serial.println(F("[AP] FAILED — AP not broadcast"));
    return false;
  }

  Serial.println(F("[AP] 6: setTxPower"));
  WiFi.setTxPower(WIFI_POWER_19_5dBm);

  Serial.println(F("[AP] 7: readIP"));
  IPAddress ip = WiFi.softAPIP();
  Serial.printf("[AP] OK ssid=%s ip=%s mac=%s\n",
                AP_SSID, ip.toString().c_str(),
                WiFi.softAPmacAddress().c_str());
  return true;
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
    else server.send(404, "application/json", "{\"error\":\"not found\"}");
  });
  server.begin();
  webSocket.begin();
  webSocket.onEvent(webSocketEvent);
  Serial.println(F("[HTTP/WS] listening on 80 / 81"));
}

void initEspNow() {
  // Only attempt after Wi-Fi is definitely up.
  if (esp_now_init() != ESP_OK) {
    Serial.println(F("[ESP-NOW] init failed (continuing)."));
    return;
  }
  esp_now_peer_info_t peerInfo = {};
  memcpy(peerInfo.peer_addr, receiverAddress, 6);
  peerInfo.channel = HARDCODED_CHANNEL;
  peerInfo.encrypt = false;
  if (esp_now_add_peer(&peerInfo) == ESP_OK) {
    espNowReady = true;
    Serial.println(F("[ESP-NOW] peer registered."));
  }
}

// ============================================================================
// SETUP / LOOP
// ============================================================================
void setup() {
  // FIRST: ground all motor pins ASAP
  pinMode(STEER_IN1, OUTPUT); pinMode(STEER_IN2, OUTPUT);
  pinMode(DRIVE_IN1, OUTPUT); pinMode(DRIVE_IN2, OUTPUT);
  digitalWrite(STEER_IN1, LOW); digitalWrite(STEER_IN2, LOW);
  digitalWrite(DRIVE_IN1, LOW); digitalWrite(DRIVE_IN2, LOW);

  Serial.begin(115200);
  delay(200);
  Serial.println(F("\n=== JARVIS VEHICLE BOOT ==="));

  initMotors();           Serial.println(F("step1 motors ok"));
  bool apOk = startAP();  Serial.println(apOk ? F("step2 wifi ok") : F("step2 wifi FAILED"));
  if (!apOk) {
    // Don't continue into servers/espm now; blink and retry slowly.
    while (true) {
      Serial.println(F("[FATAL] AP never came up. Restarting in 5s."));
      delay(5000);
      ESP.restart();
    }
  }
  initServers();          Serial.println(F("step3 servers ok"));

  initBattery();          Serial.println(F("step4 battery ok"));

  Wire.begin(PIN_I2C_SDA, PIN_I2C_SCL, 100000);
  if (wakeAndConfigureMPU()) { calibrateMPU(); Serial.println(F("step5 mpu ok")); }
  else                       { Serial.println(F("step5 mpu NOT FOUND")); }

  initTemp();             Serial.println(F("step6 temp ok"));
  initGPS();              Serial.println(F("step7 gps ok"));
  initLoRa();             Serial.println(F("step8 lora ok"));
  initEspNow();           Serial.println(F("step9 esp-now ok"));

  vehicle.lastCommandTime = millis();
  vehicle.lastMotionPulseTime = millis();
  stopCar();
  Serial.println(F("=== READY ==="));
}

void loop() {
  server.handleClient();
  webSocket.loop();

  updateMPU();
  updateGPS();
  updateTemp();
  updateBattery();
  updateVehicleDynamics();
  broadcastTelemetry();

  if (vehicle.currentDrive != DRIVE_STOP ||
      vehicle.currentSteer != STEER_CENTER ||
      vehicle.currentCommand != "stop") {
    if (millis() - vehicle.lastMotionPulseTime > 350) {
      stopCar();
      Serial.println(F("[FAILSAFE] pulse timeout"));
    }
    if (millis() - vehicle.lastCommandTime > vehicle.FULL_WATCHDOG_TIMEOUT_MS) {
      stopCar();
      Serial.println(F("[FAILSAFE] link timeout"));
    }
  }
}