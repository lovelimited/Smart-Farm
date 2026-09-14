#ifndef FIREBASE_SYNC_H
#define FIREBASE_SYNC_H

#include <Arduino.h>
#include "Config.h"

// ================================================================
//  FIREBASE SYNC MODULE INTERFACES
//  เชื่อมต่อ ESP32-S3 กับ Firebase Realtime Database
//  สำหรับ Monitor + Control ผ่านมือถือ
// ================================================================

// --- Initialization ---
void initWiFi();            // เชื่อมต่อ WiFi
void initFirebase();        // เชื่อมต่อ Firebase RTDB

// --- Sync Functions (เรียกใน loop) ---
void syncFirebase();        // Wrapper: upload status + check commands

// --- Internal ---
void uploadStatus();        // ส่งข้อมูล Sensor/Zone ขึ้น Firebase
void checkCommands();       // รับคำสั่งจาก Firebase (Manual, Reset Alarm)
void checkConfigSync();     // ซิงค์ Config (Schedule, Moisture, etc.)
void sendAlarmToFirebase(); // ส่ง Alarm notification ขึ้น Firebase
void uploadHistoryLog();    // ส่ง Telemetry Snapshot ขึ้น /devices/esp32/history

// --- WiFi Status ---
bool isWiFiConnected();
void reconnectWiFi();

#endif // FIREBASE_SYNC_H
