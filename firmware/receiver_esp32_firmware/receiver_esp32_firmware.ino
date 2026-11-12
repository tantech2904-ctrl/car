/**
 * ============================================================================
 * JARVIS AUTONOMOUS VEHICLE COCKPIT — SEPARATE ESP32 LoRa RECEIVER FIRMWARE
 * ============================================================================
 * Hardware: Secondary ESP32 DevKit V1
 * Purpose: Dedicated ground-station / emergency LoRa receiver node
 * 
 * Pinout:
 *  - NSS / CS:     GPIO 27
 *  - MOSI:         GPIO 22
 *  - MISO:         GPIO 18
 *  - SCK:          GPIO 5
 *  - RESET:        GPIO 14
 *  - DIO0:         GPIO 26
 *  - Push Button:  GPIO 33 (Active LOW, internal pull-up)
 * ============================================================================
 */

#include <SPI.h>
#include <LoRa.h>

// Receiver Pin Configuration
#define LORA_NSS       27
#define LORA_MOSI      22
#define LORA_MISO      18
#define LORA_SCK       5
#define LORA_RST       14
#define LORA_DIO0      26
#define PIN_BUTTON     33

#define LORA_FREQUENCY 433E6 // 433 MHz (matching Car transmitter)

struct EmergencyReport {
  String deviceId = "";
  uint32_t sequence = 0;
  float peakG = 0.0;
  float roll = 0.0;
  float pitch = 0.0;
  String gpsData = "";
  float tempC = 0.0;
  int rssi = 0;
  float snr = 0.0;
  uint32_t receivedAt = 0;
  bool activeAlert = false;
} currentAlert;

uint32_t packetsReceived = 0;
uint32_t acksTransmitted = 0;

void setup() {
  Serial.begin(115200);
  delay(1000);
  Serial.println(F("\n========================================================"));
  Serial.println(F(" JARVIS LoRa GROUND RECEIVER STATION — INITIALIZING     "));
  Serial.println(F("========================================================"));

  pinMode(PIN_BUTTON, INPUT_PULLUP);

  // Initialize customized SPI bus for the Receiver pin mapping
  SPI.begin(LORA_SCK, LORA_MISO, LORA_MOSI, LORA_NSS);
  LoRa.setPins(LORA_NSS, LORA_RST, LORA_DIO0);

  if (!LoRa.begin(LORA_FREQUENCY)) {
    Serial.println(F("[ERROR] LoRa receiver initialization failed! Check wiring."));
    while (1) {
      delay(1000);
    }
  }

  LoRa.setSpreadingFactor(7);
  LoRa.setSignalBandwidth(125E3);
  LoRa.setCodingRate4(5);
  LoRa.setTxPower(17);

  Serial.println(F("[LoRa] SX1278 Receiver ONLINE."));
  Serial.printf("[LoRa] Frequency: %.2f MHz | NSS: %d | SCK: %d | MOSI: %d | MISO: %d\n",
                LORA_FREQUENCY / 1E6, LORA_NSS, LORA_SCK, LORA_MOSI, LORA_MISO);
  Serial.println(F("[LoRa] Listening for vehicle emergency beacons..."));
}

void loop() {
  // Check for incoming LoRa transmission
  int packetSize = LoRa.parsePacket();
  if (packetSize) {
    packetsReceived++;
    String payload = "";
    while (LoRa.available()) {
      payload += (char)LoRa.read();
    }

    int rssi = LoRa.packetRssi();
    float snr = LoRa.packetSnr();

    Serial.println(F("\n--------------------------------------------------------"));
    Serial.printf("[LoRa RX #%lu] Packet Size: %d bytes | RSSI: %d dBm | SNR: %.1f dB\n",
                  packetsReceived, packetSize, rssi, snr);
    Serial.print(F("[RAW PAYLOAD] "));
    Serial.println(payload);

    // Validate and parse emergency beacon
    if (payload.startsWith("JARVIS_EMERGENCY|")) {
      currentAlert.activeAlert = true;
      currentAlert.rssi = rssi;
      currentAlert.snr = snr;
      currentAlert.receivedAt = millis();

      // Extract tokens
      int idxDev = payload.indexOf("DEV:");
      int idxSeq = payload.indexOf("SEQ:");
      int idxG = payload.indexOf("G_FORCE:");
      int idxRoll = payload.indexOf("ROLL:");
      int idxPitch = payload.indexOf("PITCH:");
      int idxGps = payload.indexOf("GPS:");
      int idxTemp = payload.indexOf("TEMP:");

      if (idxDev >= 0) currentAlert.deviceId = payload.substring(idxDev + 4, payload.indexOf("|", idxDev));
      if (idxSeq >= 0) currentAlert.sequence = payload.substring(idxSeq + 4, payload.indexOf("|", idxSeq)).toInt();
      if (idxG >= 0) currentAlert.peakG = payload.substring(idxG + 8, payload.indexOf("|", idxG)).toFloat();
      if (idxRoll >= 0) currentAlert.roll = payload.substring(idxRoll + 5, payload.indexOf("|", idxRoll)).toFloat();
      if (idxPitch >= 0) currentAlert.pitch = payload.substring(idxPitch + 6, payload.indexOf("|", idxPitch)).toFloat();
      if (idxGps >= 0) currentAlert.gpsData = payload.substring(idxGps + 4, payload.indexOf("|", idxGps));
      if (idxTemp >= 0) currentAlert.tempC = payload.substring(idxTemp + 5, payload.indexOf("|", idxTemp)).toFloat();

      Serial.println(F(">>> [CRITICAL] VEHICLE ACCIDENT CONFIRMED! <<<"));
      Serial.printf("    - Device ID:     %s\n", currentAlert.deviceId.c_str());
      Serial.printf("    - Sequence #:    %lu\n", currentAlert.sequence);
      Serial.printf("    - Impact Peak:   %.2f g\n", currentAlert.peakG);
      Serial.printf("    - Orientation:   Roll %.1f deg | Pitch %.1f deg\n", currentAlert.roll, currentAlert.pitch);
      Serial.printf("    - Coordinates:   %s\n", currentAlert.gpsData.c_str());
      Serial.printf("    - Temp:          %.1f C\n", currentAlert.tempC);

      // Transmit Acknowledgement (ACK) back to the car
      sendAck(currentAlert.deviceId, currentAlert.sequence);
    }
  }

  // Physical Push Button Handling on GPIO 33
  // Short press to silence / reset active alarm
  static uint32_t lastDebounceTime = 0;
  static bool lastBtnState = HIGH;
  bool btnReading = digitalRead(PIN_BUTTON);

  if (btnReading != lastBtnState) {
    lastDebounceTime = millis();
  }

  if ((millis() - lastDebounceTime) > 50) {
    if (btnReading == LOW && currentAlert.activeAlert) {
      currentAlert.activeAlert = false;
      Serial.println(F("\n[BUTTON] Physical ACK / Alarm Reset pressed on GPIO 33. Alert cleared."));
      delay(300); // Debounce delay
    }
  }
  lastBtnState = btnReading;
}

void sendAck(String deviceId, uint32_t seq) {
  delay(50); // Minor turnaround delay before replying
  LoRa.beginPacket();
  LoRa.print("ACK_EMERGENCY|");
  LoRa.print("DEV:" + deviceId + "|");
  LoRa.printf("SEQ:%lu|", seq);
  LoRa.printf("ACK_TIME:%lu|", millis());
  LoRa.print("STATUS:RECEIVED");
  LoRa.endPacket();

  acksTransmitted++;
  Serial.printf("[LoRa TX] ACK sent for SEQ %lu (Total ACKs: %lu)\n", seq, acksTransmitted);
}

