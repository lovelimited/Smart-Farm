#include "Storage.h"
#include "Globals.h"

// ================================================================
//  SECTION 10: SD CARD INITIALIZATION
// ================================================================

// --- เริ่ม SD Card ---
void initSD() {
  sdSPI.begin(SD_SCK, SD_MISO, SD_MOSI, SD_CS);
  if (SD.begin(SD_CS, sdSPI)) {
    sdOK = true;
    Serial.println(F("[SD] OK"));
    // สร้างไฟล์ Log ถ้ายังไม่มี
    if (!SD.exists("/water_log.csv")) {
      File f = SD.open("/water_log.csv", FILE_WRITE);
      if (f) {
        f.println(F("Date,Time,Zone,Soil%,TempC,Humid%,FlowLpm,WaterL,Relay,Status,Alarm"));
        f.close();
      }
    }
  } else {
    sdOK = false;
    Serial.println(F("[SD] ERROR — Logging disabled"));
  }
}

// ================================================================
//  SECTION 22: SETTINGS STORAGE (NVS / Preferences)
// ================================================================

void saveSettings() {
  prefs.begin("watering", false);

  // Zone Configs
  for (int z = 0; z < NUM_ZONES; z++) {
    char key[16];
    snprintf(key, 16, "zone%d", z);
    prefs.putBytes(key, &zones[z], sizeof(ZoneConfig));
  }

  // Soil Calibration
  prefs.putBytes("soilCal", soilCal, sizeof(soilCal));

  // Flow Config
  prefs.putBytes("flowCfg", &flowCfg, sizeof(FlowConfig));

  // Alarm Config
  prefs.putBytes("alarmCfg", &alarmCfg, sizeof(AlarmConfig));

  // Total Liters
  prefs.putFloat("totalL", totalLiters);

  prefs.end();

  Serial.println(F("[NVS] Settings saved"));
}

void loadSettings() {
  prefs.begin("watering", true); // read-only

  bool hasData = prefs.isKey("zone0");

  if (hasData) {
    // Zone Configs
    for (int z = 0; z < NUM_ZONES; z++) {
      char key[16];
      snprintf(key, 16, "zone%d", z);
      prefs.getBytes(key, &zones[z], sizeof(ZoneConfig));
    }

    // Soil Calibration
    prefs.getBytes("soilCal", soilCal, sizeof(soilCal));

    // Flow Config
    prefs.getBytes("flowCfg", &flowCfg, sizeof(FlowConfig));
    if (flowCfg.flowDelay < 15) {
      flowCfg.flowDelay = DEFAULT_FLOW_DELAY;
    }

    // Alarm Config
    prefs.getBytes("alarmCfg", &alarmCfg, sizeof(AlarmConfig));

    // Total Liters
    totalLiters = prefs.getFloat("totalL", 0);

    Serial.println(F("[NVS] Settings loaded"));
  } else {
    Serial.println(F("[NVS] No saved data, using defaults"));

    // ค่าเริ่มต้น Zone Config
    for (int z = 0; z < NUM_ZONES; z++) {
      zones[z].enabled = false;
      zones[z].mode    = (z < 3) ? MODE_TIMER : MODE_TIMER;
      zones[z].moistureStart = DEFAULT_MOIST_START;
      zones[z].moistureStop  = DEFAULT_MOIST_STOP;
      for (int s = 0; s < NUM_SCHEDULES; s++) {
        zones[z].schedules[s].enabled  = false;
        zones[z].schedules[s].hour     = 6;
        zones[z].schedules[s].minute   = 0;
        zones[z].schedules[s].duration = 10;
        zones[z].schedules[s].days     = 0x7F; // ทุกวัน
      }
    }

    // ค่าเริ่มต้น Soil Calibration
    for (int i = 0; i < NUM_SOIL_SENSORS; i++) {
      soilCal[i].dryADC = DEFAULT_DRY_ADC;
      soilCal[i].wetADC = DEFAULT_WET_ADC;
    }

    // ค่าเริ่มต้น Flow Config
    flowCfg.kFactor   = DEFAULT_K_FACTOR;
    flowCfg.minFlow   = DEFAULT_MIN_FLOW;
    flowCfg.maxFlow   = DEFAULT_MAX_FLOW;
    flowCfg.flowDelay = DEFAULT_FLOW_DELAY;
    flowCfg.enabled   = false; // ปิดเป็นค่าเริ่มต้น เพื่อให้ทดสอบรดน้ำได้โดยไม่ถูกตัดหากไม่ต่อน้ำจริง

    // ค่าเริ่มต้น Alarm Config
    alarmCfg.soilEnabled  = true;
    alarmCfg.sht30Enabled = true;
    alarmCfg.flowEnabled  = true;
    alarmCfg.rtcEnabled   = true;
    alarmCfg.sdEnabled    = true;
    alarmCfg.tempHigh     = DEFAULT_TEMP_HIGH;
    alarmCfg.tempLow      = DEFAULT_TEMP_LOW;
    alarmCfg.humHigh      = DEFAULT_HUMID_HIGH;
    alarmCfg.humLow       = DEFAULT_HUMID_LOW;

    // บันทึกค่าเริ่มต้น
    prefs.end();
    saveSettings();
    return;
  }

  prefs.end();
}

// ================================================================
//  SECTION 23: SD CARD LOGGING
// ================================================================

void logToSD(const char* status, int zone) {
  if (!sdOK) return;

  File f = SD.open("/water_log.csv", FILE_APPEND);
  if (!f) {
    sdOK = false;
    Serial.println(F("[SD] Write error"));
    return;
  }

  char line[150];
  char tb[8], hb[8], fb[8], wb[8];
  dtostrf(temperature, 4, 1, tb);
  dtostrf(humidity, 3, 0, hb);
  dtostrf(flowRate, 5, 2, fb);

  float waterL = (zone >= 0 && zone < NUM_ZONES) ? zoneState[zone].waterUsed : 0;
  dtostrf(waterL, 5, 2, wb);

  int soilVal = (zone >= 0 && zone < NUM_SOIL_SENSORS) ? (int)soilPercent[zone] : -1;

  snprintf(line, sizeof(line),
           "%04d-%02d-%02d,%02d:%02d:%02d,Z%d,%d,%s,%s,%s,%s,%s,%s,%s",
           rtcYear, rtcMonth, rtcDay,
           rtcHour, rtcMinute, rtcSecond,
           zone + 1,
           soilVal,
           tb, hb, fb, wb,
           (zone >= 0 && zoneState[zone].running) ? "ON" : "OFF",
           status,
           alarmActive ? lastAlarmMsg : "OK");

  f.println(line);
  f.close();
}

// --- Periodic Log (ทุกนาที) ---
void periodicLog() {
  unsigned long now = millis();
  if (now - lastLogTime < LOG_INTERVAL) return;
  lastLogTime = now;

  // บันทึกเฉพาะเมื่อมี Zone กำลังทำงาน
  for (int z = 0; z < NUM_ZONES; z++) {
    if (zoneState[z].running) {
      logToSD("RUN", z);
    }
  }
}
