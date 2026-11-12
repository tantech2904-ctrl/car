# JARVIS ESP32 Embedded Systems — Firmware Documentation

## 1. Car ESP32 DevKit V1 Hardware Pinout

| Subsystem | Peripheral | ESP32 GPIO | Description |
|-----------|------------|------------|-------------|
| **Motors** | L298N IN1 | **GPIO 25** | Channel A Motor + (Default: Drive Motor Forward) |
| | L298N IN2 | **GPIO 26** | Channel A Motor - (Default: Drive Motor Reverse) |
| | L298N IN3 | **GPIO 27** | Channel B Motor + (Default: Steering Motor Left) |
| | L298N IN4 | **GPIO 14** | Channel B Motor - (Default: Steering Motor Right) |
| *(Note)* | *Channel Swap* | *Runtime* | *Click "⇄ SWAP DRIVE/STEER" to instantly swap ChA & ChB* |
| **MPU6050** | I2C SDA | **GPIO 21** | 400kHz Fast Mode |
| | I2C SCL | **GPIO 22** | 400kHz Fast Mode |
| **NEO-6M GPS** | GPS TX -> ESP32 RX | **GPIO 16** | HardwareSerial2 (9600 baud) |
| | ESP32 TX -> GPS RX | **GPIO 17** | HardwareSerial2 (9600 baud) |
| **DS18B20** | 1-Wire DATA | **GPIO 32** | Requires 4.7kΩ pull-up resistor to 3.3V |
| **RA-02 LoRa** | NSS / CS | **GPIO 13** | SPI Chip Select |
| | SCK | **GPIO 18** | SPI Clock |
| | MISO | **GPIO 19** | SPI Master In Slave Out |
| | MOSI | **GPIO 23** | SPI Master Out Slave In |
| | RESET | **GPIO 4** | Active Low Reset |
| | DIO0 | **GPIO 33** | RxDone / TxDone Interrupt |

---

## 2. Dedicated Receiver ESP32 DevKit V1 Pinout

| Peripheral | ESP32 GPIO | Description |
|------------|------------|-------------|
| **RA-02 NSS** | **GPIO 27** | SPI Chip Select |
| **RA-02 MOSI** | **GPIO 22** | SPI Master Out Slave In |
| **RA-02 MISO** | **GPIO 18** | SPI Master In Slave Out |
| **RA-02 SCK** | **GPIO 5** | SPI Clock |
| **RA-02 RESET** | **GPIO 14** | Active Low Reset |
| **RA-02 DIO0** | **GPIO 26** | RxDone Interrupt |
| **Push Button** | **GPIO 33** | Active LOW (Internal Pullup) for Alarm Reset / ACK |

---

## 3. Required Arduino Libraries & Board Core

### Board Package Support
- **ESP32 Arduino Core 2.x and 3.x+:** The firmware features universal compatibility for both the legacy ESP32 Core 2.x and the modern Core 3.x+ LEDC PWM API (`ledcAttach` / `ledcWrite(pin, duty)`).

### Libraries:
Install the following libraries via the Arduino IDE Library Manager:

1. **WebSockets** by *Markus Sattler* (`WebSocketsServer.h`)
2. **LoRa** by *Sandeep Mistry* (`LoRa.h`)
3. **TinyGPSPlus** by *Mikal Hart* (`TinyGPS++.h`)
4. **OneWire** by *Paul Stoffregen* (`OneWire.h`)
5. **DallasTemperature** by *Miles Burton* (`DallasTemperature.h`)

---

## 4. Flashing & Network Setup

1. Connect the Car ESP32 to your PC via Micro-USB.
2. Select **Board: ESP32 Dev Module** in Arduino IDE.
3. Flash `firmware/car_esp32_firmware/car_esp32_firmware.ino`.
4. Power on the car:
   - Wi-Fi Access Point will start automatically:
     - **SSID:** `ESP32_CAR`
     - **Password:** `jarvis1234`
     - **Gateway IP:** `192.168.4.1`
5. Connect your laptop/tablet/phone to `ESP32_CAR` Wi-Fi network.
6. Open the JARVIS Cockpit in your browser (`index.html` or `http://localhost:3000`).

---

## 5. Built-in Safety Failsafes & Motor Architecture

- **Dead-Man's Motion Pulse Failsafe (250ms):** Drive and steering commands require active continuous streaming pulses (every 75ms from the cockpit UI). The moment the user releases the key or D-Pad button, or if Wi-Fi packets drop for > 250ms, the ESP32 automatically shuts down all motor channels.
- **Stop Burst Transmission (3x):** Upon button release or keyboard keyup, the cockpit transmits 3 rapid consecutive `CMD:STOP` packets to guarantee arrival over noisy Wi-Fi.
- **Pure LEDC PWM Motor Cut:** Uses 0% PWM duty to stop motors rather than `digitalWrite()`, preventing GPIO detachment and frozen HIGH output states on ESP32 Core 3.0+.
- **Full Connection Watchdog (600ms):** If no packet or heartbeat is received within 600ms, all motors are stopped.
- **Accident Auto-Cut:** Upon impact detection (|a| > 3.2g or rollover > 55°), motors are permanently cut and an SX1278 LoRa emergency packet is broadcast.

