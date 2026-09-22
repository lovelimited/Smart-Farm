#include "BuzzerAlarm.h"
#include "Globals.h"
#include "Storage.h"
#include "FirebaseSync.h"

// ================================================================
//  SECTION 16: BUZZER FUNCTIONS — ไม่ใช้ delay()
// ================================================================

// --- Beep เดี่ยว ---
void beep(unsigned long durationMs) {
  buzzerActive   = true;
  buzzerStart    = millis();
  buzzerDuration = durationMs;
  buzzerPattern  = 0;
  buzzerRepeat   = 0;
  buzzerState    = true;
  digitalWrite(BUZZER_PIN, HIGH);
}

// --- Alarm Beep (ซ้ำ 3 ครั้ง) ---
void alarmBeep() {
  buzzerActive     = true;
  buzzerStart      = millis();
  buzzerDuration   = 2000;
  buzzerPattern    = 1;
  buzzerRepeat     = 5;
  buzzerLastToggle = millis();
  buzzerState      = true;
  digitalWrite(BUZZER_PIN, HIGH);
}

// --- จัดการ Buzzer (เรียกใน loop) ---
void handleBuzzer() {
  if (!buzzerActive) return;

  unsigned long now = millis();

  if (buzzerPattern == 0) {
    // Single beep
    if (now - buzzerStart >= buzzerDuration) {
      digitalWrite(BUZZER_PIN, LOW);
      buzzerActive = false;
      buzzerState  = false;
    }
  } else {
    // Alarm pattern: เปิด/ปิดสลับทุก 200ms
    if (now - buzzerLastToggle >= 200) {
      buzzerLastToggle = now;
      buzzerState = !buzzerState;
      digitalWrite(BUZZER_PIN, buzzerState ? HIGH : LOW);
      if (!buzzerState) {
        buzzerRepeat--;
        if (buzzerRepeat <= 0) {
          digitalWrite(BUZZER_PIN, LOW);
          buzzerActive = false;
          buzzerState  = false;
        }
      }
    }
  }
}

// ================================================================
//  SECTION 15: ALARM MANAGEMENT
// ================================================================

// --- ตรวจ Alarm ทั้งระบบ ---
void checkAlarms() {
  unsigned long now = millis();
  if (now - lastAlarmCheck < ALARM_CHECK_INTERVAL) return;
  lastAlarmCheck = now;

  // SHT30 Alarm
  if (alarmCfg.sht30Enabled && sht30OK) {
    if (temperature > alarmCfg.tempHigh) {
      triggerAlarm(ALARM_OVER_TEMP, -1, "OVER TEMP");
    }
    if (temperature > 0.0f && temperature < alarmCfg.tempLow) {
      triggerAlarm(ALARM_LOW_TEMP, -1, "LOW TEMP");
    }
    if (humidity > alarmCfg.humHigh) {
      triggerAlarm(ALARM_HIGH_HUMID, -1, "HIGH HUMID");
    }
    if (humidity > 0.0f && humidity < alarmCfg.humLow) {
      triggerAlarm(ALARM_LOW_HUMID, -1, "LOW HUMID");
    }
  }

  // SHT30 ขัดข้อง
  if (alarmCfg.sht30Enabled && !sht30OK) {
    triggerAlarm(ALARM_SHT30_ERROR, -1, "SHT30 ERROR");
  }

  // RTC ขัดข้อง
  if (alarmCfg.rtcEnabled && !rtcOK) {
    triggerAlarm(ALARM_RTC_ERROR, -1, "RTC ERROR");
  }

  // SD ขัดข้อง
  if (alarmCfg.sdEnabled && !sdOK) {
    triggerAlarm(ALARM_SD_ERROR, -1, "SD ERROR");
  }

  // Soil Sensor Error - เตือนเฉพาะโซนที่เปิดใช้งานและอยู่ในโหมด SMART เท่านั้น
  if (alarmCfg.soilEnabled) {
    for (int i = 0; i < NUM_SOIL_SENSORS; i++) {
      if (soilError[i] && zones[i].enabled && zones[i].mode == MODE_SMART) {
        char msg[16];
        snprintf(msg, sizeof(msg), "SOIL%d ERR", i + 1);
        triggerAlarm(ALARM_SOIL_ERROR, i, msg);
      }
    }
  }

  // Auto-Clear Alarm เมื่อทุกอย่างกลับมาเป็นปกติ
  if (alarmActive) {
    bool hasFault = false;
    if (alarmCfg.sht30Enabled && sht30OK) {
      if (temperature > alarmCfg.tempHigh || (temperature > 0.0f && temperature < alarmCfg.tempLow)) hasFault = true;
      if (humidity > alarmCfg.humHigh || (humidity > 0.0f && humidity < alarmCfg.humLow)) hasFault = true;
    }
    if (alarmCfg.sht30Enabled && !sht30OK) hasFault = true;
    if (alarmCfg.rtcEnabled && !rtcOK) hasFault = true;
    if (alarmCfg.sdEnabled && !sdOK) hasFault = true;
    for (int i = 0; i < NUM_SOIL_SENSORS; i++) {
      if (soilError[i] && zones[i].enabled && zones[i].mode == MODE_SMART) hasFault = true;
    }
    for (int z = 0; z < NUM_ZONES; z++) {
      if (zoneState[z].alarm) hasFault = true;
    }

    if (!hasFault) {
      Serial.println(F("[ALARM] All faults resolved -> Auto-cleared!"));
      alarmActive = false;
      lastAlarmType = ALARM_NONE;
      lastAlarmMsg[0] = '\0';
      lcdDirty = true;
      uploadStatus(); // ซิงค์สถานะปกติขึ้น Firebase ทันที เพื่อให้หน้าเว็บหายแดงทันที
    }
  }
}

// --- สร้าง Alarm ---
void triggerAlarm(uint8_t type, int zone, const char* msg) {
  // ป้องกัน alarm ซ้ำซ้อน — ถ้ามี alarm ใดๆ ถูกส่งภายใน 30 วินาที ให้ข้าม
  if (alarmActive && millis() - lastAlarmTime < 30000) return;

  lastAlarmType = type;
  lastAlarmZone = zone;
  lastAlarmTime = millis();
  strncpy(lastAlarmMsg, msg, 20);
  lastAlarmMsg[20] = '\0';
  alarmActive = true;

  Serial.print(F("[ALARM] ")); Serial.print(msg);
  if (zone >= 0) { Serial.print(F(" Z")); Serial.print(zone + 1); }
  Serial.println();

  alarmBeep();

  // บันทึกลง SD
  if (sdOK) {
    File f = SD.open("/water_log.csv", FILE_APPEND);
    if (f) {
      char line[120];
      snprintf(line, sizeof(line), "%04d-%02d-%02d,%02d:%02d:%02d,ALARM,,,,,,,%s",
               rtcYear, rtcMonth, rtcDay, rtcHour, rtcMinute, rtcSecond, msg);
      f.println(line);
      f.close();
    }
  }

  lcdDirty = true;

  // ส่ง Alarm ไปยัง Firebase เพื่อแจ้งเตือนมือถือ
  sendAlarmToFirebase();
}
