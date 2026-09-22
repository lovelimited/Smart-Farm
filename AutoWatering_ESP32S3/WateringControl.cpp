#include "WateringControl.h"
#include "Globals.h"
#include "Storage.h"
#include "BuzzerAlarm.h"

// --- Smart Moisture Auto-Watering Tracking ---
static unsigned long lastSmartWaterEndTime[NUM_SOIL_SENSORS] = {0, 0, 0};
static unsigned long dryDetectionStartTime[NUM_SOIL_SENSORS] = {0, 0, 0};
static unsigned long lastFlowAlarmTime[NUM_ZONES]            = {0, 0, 0, 0}; // เวลาที่ติด Flow Alarm ล่าสุด
const unsigned long SMART_COOLDOWN_MS = 60000UL;          // 1 นาที cooldown พักให้น้ำซึมลงดิน
const unsigned long SMART_DEBOUNCE_MS = 2000UL;           // ตรวจพบดินแห้งต่อเนื่อง 2 วินาที
const unsigned long SMART_DEFAULT_DURATION_MS = 600000UL; // รดน้ำสูงสุด 10 นาที (ถ้าไม่ถึง Stop%)
const unsigned long FLOW_ALARM_RETRY_MS       = 180000UL; // 3 นาที auto-recovery ปลดล็อคให้ลองใหม่เองเมื่อกลับมาปกติ

// ================================================================
//  SECTION 10: RELAY INITIALIZATION
// ================================================================

// --- เริ่ม Relay — ทุกช่องต้อง OFF ก่อนเสมอ ---
void initRelay() {
  for (int i = 0; i < NUM_ZONES; i++) {
    digitalWrite(relayPins[i], RELAY_OFF);
    pinMode(relayPins[i], OUTPUT);
    digitalWrite(relayPins[i], RELAY_OFF);
    zoneState[i].running    = false;
    zoneState[i].manual     = false;
    zoneState[i].alarm      = false;
    zoneState[i].startTime  = 0;
    zoneState[i].durationMs = 0;
    zoneState[i].waterUsed  = 0;
  }
  Serial.printf("[RELAY] All OFF at boot (Logic: ON=%s, OFF=%s)\n", 
                RELAY_ON == LOW ? "LOW" : "HIGH", RELAY_OFF == LOW ? "LOW" : "HIGH");
}

// ================================================================
//  SECTION 13: ZONE CONTROL FUNCTIONS
// ================================================================

// --- เปิดโซน ---
void startZone(int z, unsigned long durationMs) {
  if (z < 0 || z >= NUM_ZONES) return;

  // หากมีการสั่งเปิด ให้ปลดล็อค Alarm เดิมของโซนนั้นเพื่อให้สามารถเปิดวาล์วได้
  if (zoneState[z].alarm) {
    Serial.printf("[ZONE] Z%d was ALARM locked -> Cleared for start\n", z + 1);
    zoneState[z].alarm = false;
  }

  digitalWrite(relayPins[z], RELAY_ON);
  zoneState[z].running    = true;
  zoneState[z].startTime  = millis();
  zoneState[z].durationMs = durationMs;
  zoneState[z].waterUsed  = 0;
  sessionLiters = 0;

  Serial.printf("[ZONE] Z%d ON (Pin %d -> %s), duration=%lu s\n", 
                z + 1, relayPins[z], (RELAY_ON == LOW ? "LOW" : "HIGH"), durationMs / 1000);

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

  Serial.printf("[ZONE] Z%d OFF (Pin %d -> %s)\n", 
                z + 1, relayPins[z], (RELAY_OFF == LOW ? "LOW" : "HIGH"));

  if (wasRunning) {
    Serial.print(F("[ZONE] Z")); Serial.print(z + 1);
    Serial.print(F(" OFF, water=")); Serial.print(zoneState[z].waterUsed, 2);
    Serial.println(F("L"));
    logToSD("STOP", z);
  }

  // หากเป็นโหมด SMART ให้เริ่มนับ Cooldown พักให้น้ำซึม
  if (z < NUM_SOIL_SENSORS && zones[z].mode == MODE_SMART) {
    lastSmartWaterEndTime[z] = millis();
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

    // หมดเวลาตามระยะเวลาที่กำหนด (ทั้ง Schedule และ Manual)
    if (elapsed >= zoneState[z].durationMs) {
      Serial.printf("[ZONE] Duration reached for Z%d\n", z + 1);
      stopZone(z);
      continue;
    }

    // SMART Mode: ตรวจความชื้น (Zone 0-2 เท่านั้น)
    if (!zoneState[z].manual && z < NUM_SOIL_SENSORS) {
      if (zones[z].mode == MODE_SMART && !soilError[z]) {
        if (soilPercent[z] >= (float)zones[z].moistureStop) {
          Serial.printf("[SMART] Target reached for Z%d (Moisture: %.1f%% >= Stop: %d%%) -> STOP WATERING\n", 
                        z + 1, soilPercent[z], zones[z].moistureStop);
          stopZone(z);
          continue;
        }
      }
    }

    // Flow Protection: ตรวจ Flow หลัง Delay (เฉพาะเมื่อเปิดใช้งาน flowCfg.enabled และอยู่นอกโหมด Manual)
    if (flowCfg.enabled && !zoneState[z].manual && elapsed > (unsigned long)flowCfg.flowDelay * 1000UL) {
      if (flowRate < flowCfg.minFlow) {
        Serial.printf("[SAFETY] No flow on Z%d (Rate: %.2f < %.2f) after %ds -> Aborting\n",
                      z + 1, flowRate, flowCfg.minFlow, flowCfg.flowDelay);
        lastFlowAlarmTime[z] = now;
        triggerAlarm(ALARM_NO_FLOW, z, "NO FLOW");
        stopZone(z);
        zoneState[z].alarm = true;   // ล็อคชั่วคราว
        continue;
      }
      if (flowRate > flowCfg.maxFlow) {
        Serial.printf("[SAFETY] High flow on Z%d (Rate: %.2f > %.2f) -> Aborting\n",
                      z + 1, flowRate, flowCfg.maxFlow);
        lastFlowAlarmTime[z] = now;
        triggerAlarm(ALARM_HIGH_FLOW, z, "HIGH FLOW");
        stopZone(z);
        zoneState[z].alarm = true;
        continue;
      }
    }

    // Auto-Recovery: ปลดล็อค zoneState.alarm อัตโนมัติเมื่อปิด Flow Protection หรือผ่านไปเกิน 3 นาที
    if (zoneState[z].alarm) {
      if (!flowCfg.enabled || (lastFlowAlarmTime[z] > 0 && (now - lastFlowAlarmTime[z] >= FLOW_ALARM_RETRY_MS))) {
        Serial.printf("[SAFETY] Auto-clearing flow alarm lock for Z%d (ready to retry)\n", z + 1);
        zoneState[z].alarm = false;
        lastFlowAlarmTime[z] = 0;
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
    if (zoneState[z].manual) continue;    // กำลัง Manual

    // ถ้ามี alarm เก่าค้างอยู่ ให้รีเซ็ตเมื่อถึงรอบเวลารดน้ำใหม่ เพื่อให้โอกาสโซนได้เริ่มทำงาน
    if (zoneState[z].alarm) {
      Serial.printf("[SCHED] Z%d resetting old alarm for new schedule cycle\n", z + 1);
      zoneState[z].alarm = false;
    }

    // ตรวจสอบโหมดและการเปิดใช้งาน (ทั้ง 4 โซน)
    if (zones[z].mode == MODE_OFF || !zones[z].enabled) continue;

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

// ================================================================
//  SECTION 14.5: SMART MOISTURE MONITORING & AUTO WATERING
//  รดน้ำอัตโนมัติตามค่าความชื้นดินจริง (ทำงานตลอดเวลา ไม่ต้องรอ Schedule)
// ================================================================

void checkSmartMoisture() {
  unsigned long now = millis();

  for (int z = 0; z < NUM_SOIL_SENSORS; z++) {
    // 1. ตรวจสอบว่าโซนเปิดใช้งาน และตั้งเป็นโหมด SMART หรือไม่
    if (!zones[z].enabled || zones[z].mode != MODE_SMART) {
      dryDetectionStartTime[z] = 0;
      continue;
    }

    // 2. ถ้าโซนกำลังทำงานอยู่ หรือเป็นโหมด Manual → ข้าม
    if (zoneState[z].running || zoneState[z].manual) {
      dryDetectionStartTime[z] = 0;
      continue;
    }

    // Auto-Recovery: หากติด Alarm เก่า แต่ปิด Flow Protection หรือผ่านไปเกิน 3 นาที ให้ปลดล็อคอัตโนมัติ
    if (zoneState[z].alarm) {
      if (!flowCfg.enabled || (lastFlowAlarmTime[z] > 0 && (now - lastFlowAlarmTime[z] >= FLOW_ALARM_RETRY_MS))) {
        Serial.printf("[SMART] Auto-clearing alarm lock for Z%d\n", z + 1);
        zoneState[z].alarm = false;
        lastFlowAlarmTime[z] = 0;
      } else {
        dryDetectionStartTime[z] = 0;
        continue;
      }
    }

    // 3. ถ้าเซนเซอร์ดินมีปัญหา (Error หรือค่าติดลบ) → ข้ามเพื่อความปลอดภัย ไม่เปิดวาล์วสุ่มสี่สุ่มห้า
    if (soilError[z] || soilPercent[z] < 0.0f) {
      dryDetectionStartTime[z] = 0;
      continue;
    }

    // 4. ตรวจ Cooldown พักดินหลังรดน้ำเสร็จ (ป้องกันการเปิด-ปิดถี่เกินไป)
    if (lastSmartWaterEndTime[z] > 0 && (now - lastSmartWaterEndTime[z] < SMART_COOLDOWN_MS)) {
      dryDetectionStartTime[z] = 0;
      continue;
    }

    // 5. ตรวจสอบเงื่อนไขความชื้นดิน: ดินแห้งกว่าเกณฑ์เริ่มรดน้ำ (moistureStart)
    if (soilPercent[z] < (float)zones[z].moistureStart) {
      if (dryDetectionStartTime[z] == 0) {
        dryDetectionStartTime[z] = now;
      } else if (now - dryDetectionStartTime[z] >= SMART_DEBOUNCE_MS) {
        // ดินแห้งจริงต่อเนื่องเกิน Debounce -> เริ่มรดน้ำอัตโนมัติทันที!
        Serial.printf("[SMART] Zone %d dry detected (Moisture: %.1f%% < Start: %d%%) -> AUTO START WATERING!\n",
                      z + 1, soilPercent[z], zones[z].moistureStart);

        // กำหนดระยะเวลารดน้ำสูงสุดตาม Schedule Slot 1 ถ้ามีกำหนดไว้ มิฉะนั้นใช้ 10 นาที
        unsigned long durMs = SMART_DEFAULT_DURATION_MS;
        if (zones[z].schedules[0].duration > 0) {
          durMs = (unsigned long)zones[z].schedules[0].duration * 60UL * 1000UL;
        }

        startZone(z, durMs);
        dryDetectionStartTime[z] = 0;
      }
    } else {
      dryDetectionStartTime[z] = 0;
    }
  }
}
