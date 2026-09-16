/*
 * ================================================================
 *  ระบบควบคุมรดน้ำอัตโนมัติ ESP32-S3
 *  Auto Watering Control System v1.0
 *  ================================================================
 *  Controller : ESP32-S3
 *  4 Zones    : Zone 1-3 (Soil Moisture) / Zone 4 (Timer Only)
 *  Sensors    : SHT30, Soil Moisture x3, YF-S201C Flow, DS3231 RTC
 *  Output     : Relay 4CH, Active Buzzer, LCD 20x4 I2C
 *  Input      : Rotary Encoder (CLK/DT/SW)
 *  Storage    : Micro SD (SPI), ESP32 Preferences (NVS)
 * ================================================================
 *
 *  Required Libraries (install via Arduino Library Manager):
 *  1. LiquidCrystal_I2C  by Frank de Brabander
 *  2. RTClib              by Adafruit
 *  3. Adafruit SHT31      by Adafruit  (ใช้ได้กับ SHT30)
 *  4. Adafruit BusIO      by Adafruit  (dependency ของ SHT31)
 *  5. SD                  (มาพร้อม ESP32 core)
 *  6. SPI                 (มาพร้อม ESP32 core)
 *  7. Wire                (มาพร้อม ESP32 core)
 *  8. Preferences         (มาพร้อม ESP32 core)
 *
 *  Board Setting:  ESP32S3 Dev Module
 * ================================================================
 */

#include "Config.h"
#include "Globals.h"
#include "BuzzerAlarm.h"
#include "Sensors.h"
#include "Storage.h"
#include "WateringControl.h"
#include "DisplayMenu.h"
#include "FirebaseSync.h"

// ================================================================
//  INITIALIZATION FUNCTIONS
// ================================================================

void initHardware() {
  Serial.begin(115200);
  Serial.println(F("\n=== Auto Watering System ESP32-S3 ==="));
  Serial.print(F("Firmware: ")); Serial.println(FW_VERSION);

  initI2C();
  initSoilSensors();  // ตั้ง ADC attenuation ก่อนอ่าน Soil
  initRelay();      // ต้องทำก่อน เพื่อให้ Relay OFF ตอน Boot
  initLCD();
  initRTC();
  initSHT30();
  initSD();
  initEncoder();
  initFlowSensor();

  // โหลดค่าจาก NVS
  loadSettings();

  // เชื่อมต่อ WiFi + Firebase (ถ้าเชื่อมไม่ได้ระบบยังทำงานปกติ)
  initWiFi();
  initFirebase();

  Serial.println(F("=== Init Complete ==="));
}

#include "soc/soc.h"
#include "soc/rtc_cntl_reg.h"

// ปิด Brownout Detector ตั้งแต่ก่อนเข้า main/setup() ป้องกันรีสตาร์ทจากไฟตกชั่วขณะตอน Boot
__attribute__((constructor)) void earlyDisableBOD() {
  WRITE_PERI_REG(RTC_CNTL_BROWN_OUT_REG, 0);
}

// ================================================================
//  SETUP
// ================================================================

void setup() {
  // ปิด Brownout Detector ป้องกัน ESP32 รีสตาร์ทจากไฟตกชั่วขณะตอนเปิด WiFi / Relay
  WRITE_PERI_REG(RTC_CNTL_BROWN_OUT_REG, 0);

  // ตั้ง Buzzer pin
  pinMode(BUZZER_PIN, OUTPUT);
  digitalWrite(BUZZER_PIN, LOW);

  // เริ่มต้นทุกระบบ
  initHardware();

  // เสียง Boot
  beep(200);

  // แสดงหน้า Dashboard หลังจาก init เสร็จ
  delay(1500);  // แสดง splash screen 1.5 วินาที (ใช้ delay ตรงนี้เท่านั้น)
  lcdDirty = true;
  currentMenu = ST_DASHBOARD;

  Serial.println(F("[SYS] System ready"));
  Serial.print(F("[SYS] Free heap: "));
  Serial.println(ESP.getFreeHeap());
}

// ================================================================
//  SERIAL MONITOR STATUS DASHBOARD
// ================================================================

unsigned long lastSerialPrint = 0;
const unsigned long SERIAL_PRINT_INTERVAL = 5000; // แสดงผลทุก 5 วินาที

void printSerialStatus() {
  unsigned long now = millis();
  if (now - lastSerialPrint < SERIAL_PRINT_INTERVAL) return;
  lastSerialPrint = now;

  Serial.println(F("\n=================[ SYSTEM STATUS ]================="));
  Serial.printf(" TIME      : %02d:%02d:%02d  %02d/%02d/%04d (Dow:%d)\n", 
                rtcHour, rtcMinute, rtcSecond, rtcDay, rtcMonth, rtcYear, rtcDow);
  
  if (sht30OK) {
    Serial.printf(" AIR SHT30 : Temp=%.1f C | Humidity=%.1f %%\n", temperature, humidity);
  } else {
    Serial.println(F(" AIR SHT30 : [DISCONNECTED / ERROR]"));
  }

  Serial.print(F(" SOIL (ADC): "));
  for (int i = 0; i < NUM_SOIL_SENSORS; i++) {
    if (soilError[i]) {
      Serial.printf("Z%d=[ERR (RAW:%u)] ", i + 1, soilRawADC[i]);
    } else {
      Serial.printf("Z%d=%.1f%% (RAW:%u) ", i + 1, soilPercent[i], soilRawADC[i]);
    }
  }
  Serial.println();

  Serial.printf(" FLOW METER: Rate=%.2f L/min | Total=%.2f L | Session=%.2f L\n", 
                flowRate, totalLiters, sessionLiters);

  Serial.println(F(" ZONES     :"));
  for (int z = 0; z < NUM_ZONES; z++) {
    const char* modeStr = (z < 3) ? (zones[z].mode == MODE_SMART ? "SMART" : zones[z].mode == MODE_TIMER ? "TIMER" : "OFF") : "TIMER";
    const char* stateStr = zoneState[z].running ? (zoneState[z].manual ? "RUNNING [MANUAL]" : "RUNNING [AUTO]") : "OFF";
    Serial.printf("   [Z%d] %-17s | Mode: %-5s | Enable: %s | Used: %.2f L\n",
                  z + 1, stateStr, modeStr, zones[z].enabled ? "ON" : "OFF", zoneState[z].waterUsed);
  }

  if (alarmActive) {
    Serial.printf(" ALARM     : ACTIVE! -> %s (Zone: %s)\n", 
                  lastAlarmMsg, lastAlarmZone >= 0 ? (String("Z") + String(lastAlarmZone + 1)).c_str() : "SYS");
  } else {
    Serial.println(F(" ALARM     : Normal (OK)"));
  }
  Serial.printf(" HARDWARE  : LCD:%s | RTC:%s | SHT30:%s | SD:%s | FreeHeap:%lu B\n",
                lcdOK ? "OK" : "ERR", rtcOK ? "OK" : "ERR", 
                sht30OK ? "OK" : "ERR", sdOK ? "OK" : "ERR",
                (unsigned long)ESP.getFreeHeap());
  Serial.println(F("==================================================="));
}

// ================================================================
//  MAIN LOOP — ไม่ใช้ delay()
// ================================================================

void loop() {
  // 1. อ่าน Encoder Input
  handleEncoder();

  // 2. จัดการ Input เมนู
  handleMenuInput();

  // 3. อ่าน Sensors
  readSensors();

  // 4. คำนวณ Flow
  updateFlow();

  // 5. ตรวจ Schedule
  checkSchedule();

  // 6. ควบคุม Zone (timeout, moisture, flow protection)
  controlZones();

  // 7. ตรวจ Alarm
  checkAlarms();

  // 8. จัดการ Buzzer
  handleBuzzer();

  // 9. อัพเดท LCD
  updateLCD();

  // 10. บันทึก Log SD Card
  periodicLog();

  // 11. แสดงสถานะออก Serial Monitor ทุก 5 วินาที
  printSerialStatus();

  // 12. Firebase Sync (ส่งข้อมูล + รับคำสั่ง)
  syncFirebase();
}
