@echo off
setlocal
title JARVIS // Autonomous Vehicle Control Cockpit
echo ======================================================================
echo       JARVIS AUTONOMOUS VEHICLE CONTROL COCKPIT // AV-01
echo ======================================================================
echo.
echo [1/3] Verifying network connection...
echo   Ensure your device is connected to the ESP32 Wi-Fi Access Point:
echo     SSID:     ESP32_CAR
echo     Password: CarControl26
echo     AP IP:    http://192.168.4.1
echo.
echo [2/3] Starting Local Cockpit Server on Port 3000...
echo   Model: Official Audi Q7 2020 3D GLB Twin
echo   Kinematics: 1:1 Real-time MPU6050 Orientation Tilt & Roll
echo.
echo [3/3] Opening your browser to http://localhost:3000 in 2 seconds...
start "" powershell -NoProfile -Command "Start-Sleep -Seconds 2; Start-Process 'http://localhost:3000'"
echo.
node cockpit/serve.js
pause
