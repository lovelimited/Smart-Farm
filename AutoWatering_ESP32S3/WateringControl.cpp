#include "WateringControl.h"
#include "Globals.h"
#include "Storage.h"
#include "BuzzerAlarm.h"

// ================================================================
//  SECTION 10: RELAY INITIALIZATION
// ================================================================

// --- เริ่ม Relay — ทุกช่องต้อง OFF ก่อนเสมอ ---
void initRelay() {
  for (int i = 0; i < NUM_ZONES; i++) {
    digitalWrite(relayPins[i], RELAY_OFF);  // preload ค่าตัดไฟก่อนเปลี่ยนขาเป็น OUTPUT ป้องกันกระแสกระชาก
    pinMode(relayPins[i], OUTPUT);
    digitalWrite(relayPins[i], RELAY_OFF);
    zoneState[i].running    = false;
    zoneState[i].manual     = false;
    zoneState[i].alarm      = false;
    zoneState[i].startTime  = 0;
    zoneState[i].durationMs = 0;
    zoneState[i].waterUsed  = 0;
  }
  Serial.println(F("[RELAY] All OFF at boot"));
}

// ================================================================
//  SECTION 13: ZONE CONTROL FUNCTIONS
// ================================================================

// --- เปิดโซน ---
void startZone(int z, unsigned long durationMs) {
  if (z < 0 || z >= NUM_ZONES) return;
  if (zoneState[z].alarm) return;  // ห้ามเปิดถ้ามี Alarm

  digitalWrite(relayPins[z], RELAY_ON);
  zoneState[z].running    = true;
  zoneState[z].startTime  = millis();
  zoneState[z].durationMs = durationMs;
  zoneState[z].waterUsed  = 0;
  sessionLiters = 0;

  Serial.print(F("[ZONE] Z")); Serial.print(z + 1);
  Serial.print(F(" ON, duration=")); Serial.print(durationMs / 1000);
  Serial.println(F("s"));

  // บันทึก Log
  logToSD("START", z);

  lcdDirty = true;
}

// --- ปิดโซน ---
void stopZone(int z) {
  if (z < 0 || z >= NUM_ZONES) return;

  digitalWrite(relayPins[z], RELAY_OFF);
  bool wasRunning = zoneState[z].running;
  zoneState[z].running = false;
  zoneState[z].manual  = false;

  if (wasRunning) {
    Serial.print(F("[ZONE] Z")); Serial.print(z + 1);
    Serial.print(F(" OFF, water=")); Serial.print(zoneState[z].waterUsed, 2);
    Serial.println(F("L"));
    logToSD("STOP", z);
  }

  lcdDirty = true;
}

// --- ควบคุมทุกโซน (เรียกใน loop) ---
void controlZones() {
  unsigned long now = millis();

  for (int z = 0; z < NUM_ZONES; z++) {
    if (!zoneState[z].running) continue;

    unsigned long elapsed = now - zoneState[z].startTime;

    // Safety Timeout: Manual เปิดเกิน 30 นาที → ปิด
    if (zoneState[z].manual && elapsed >= MANUAL_TIMEOUT_MS) {
      Serial.print(F("[SAFETY] Manual timeout Z")); Serial.println(z + 1);
      stopZone(z);
      triggerAlarm(ALARM_NONE, z, "MANUAL TIMEOUT");
      continue;
    }

    // หมดเวลาตาม Schedule
    if (!zoneState[z].manual && elapsed >= zoneState[z].durationMs) {
      stopZone(z);
      continue;
    }

    // SMART Mode: ตรวจความชื้น (Zone 0-2 เท่านั้น)
    if (!zoneState[z].manual && z < NUM_SOIL_SENSORS) {
      if (zones[z].mode == MODE_SMART && !soilError[z]) {
        if (soilPercent[z] >= zones[z].moistureStop) {
          Serial.print(F("[SMART] Moisture reached target Z")); Serial.println(z + 1);
          stopZone(z);
          continue;
        }
      }
    }

    // Flow Protection: ตรวจ Flow หลัง Delay
    if (flowCfg.enabled && elapsed > (unsigned long)flowCfg.flowDelay * 1000UL) {
      if (flowRate < flowCfg.minFlow) {
        triggerAlarm(ALARM_NO_FLOW, z, "NO FLOW");
        stopZone(z);
        zoneState[z].alarm = true;   // ล็อค ห้ามเปิดซ้ำ
        continue;
      }
      if (flowRate > flowCfg.maxFlow) {
        triggerAlarm(ALARM_HIGH_FLOW, z, "HIGH FLOW");
        stopZone(z);
        zoneState[z].alarm = true;
        continue;
      }
    }
  }
}

// ================================================================
//  SECTION 14: SCHEDULE & MOISTURE CHECK
// ================================================================

// --- ตรวจ Schedule ทุกนาที ---
void checkSchedule() {
  if (!rtcOK) return;    // ถ้า RTC Error ห้ามรดน้ำอัตโนมัติ

  // ตรวจเฉพาะเมื่อนาทีเปลี่ยน
  if (rtcMinute == lastScheduleMinute) return;
  lastScheduleMinute = rtcMinute;

  for (int z = 0; z < NUM_ZONES; z++) {
    if (!zones[z].enabled) continue;
    if (zoneState[z].running) continue;   // กำลังทำงานอยู่
    if (zoneState[z].alarm) continue;     // มี Alarm
    if (zoneState[z].manual) continue;    // กำลัง Manual

    // Zone 1-3: ตรวจ Mode
    if (z < NUM_SOIL_SENSORS && zones[z].mode == MODE_OFF) continue;

    for (int s = 0; s < NUM_SCHEDULES; s++) {
      Schedule &sch = zones[z].schedules[s];
      if (!sch.enabled) continue;
      if (sch.duration == 0) continue;

      // ตรวจวัน (bitmask)
      if (!(sch.days & (1 << rtcDow))) continue;

      // ตรวจเวลา
      if (rtcHour == sch.hour && rtcMinute == sch.minute) {
        // เงื่อนไขความชื้น (SMART mode เฉพาะ Z1-3)
        if (z < NUM_SOIL_SENSORS && zones[z].mode == MODE_SMART) {
          if (!soilError[z] && soilPercent[z] >= zones[z].moistureStart) {
            // ความชื้นยังพอ ไม่ต้องรดน้ำ
            Serial.print(F("[SCHED] Skip Z")); Serial.print(z + 1);
            Serial.print(F(" moisture=")); Serial.println(soilPercent[z]);
            continue;
          }
          // ถ้า Soil Error อยู่ในโหมด SMART → ข้ามเพื่อความปลอดภัย
          if (soilError[z]) {
            Serial.print(F("[SAFETY] Soil error, skip SMART Z")); Serial.println(z + 1);
            continue;
          }
        }

        // เริ่มรดน้ำ
        unsigned long durMs = (unsigned long)sch.duration * 60UL * 1000UL;
        startZone(z, durMs);
        break;  // หยุดตรวจ Schedule อื่นของ Zone นี้
      }
    }
  }
}
