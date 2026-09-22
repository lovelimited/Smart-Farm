#ifndef CONFIG_H
#define CONFIG_H

#include <stdint.h>
#include <stdbool.h>
#include <stddef.h>
#include <Arduino.h>

#ifndef IRAM_ATTR
#define IRAM_ATTR
#endif

// ================================================================
//  SECTION 2: GPIO DEFINITIONS — ห้ามเปลี่ยนโดยไม่แจ้ง
// ================================================================

// --- I2C ---
#define I2C_SDA           8
#define I2C_SCL           9

// --- Soil Moisture (Analog) ---
#define SOIL_PIN_1        1
#define SOIL_PIN_2        2
#define SOIL_PIN_3        3

// --- Flow Sensor (Interrupt) ---
#define FLOW_PIN          4

// --- Relay (Active LOW) ---
#define RELAY_1_PIN       5
#define RELAY_2_PIN       6
#define RELAY_3_PIN       7
#define RELAY_4_PIN       18

// --- Rotary Encoder ---
#define ENC_CLK           10
#define ENC_DT            11
#define ENC_SW            12

// --- Buzzer ---
#define BUZZER_PIN        13

// --- Micro SD (SPI) ---
#define SD_SCK            14
#define SD_MISO           15
#define SD_MOSI           16
#define SD_CS             17

// ================================================================
//  SECTION 2.5: WiFi & FIREBASE CONFIGURATION
// ================================================================

// --- WiFi Credentials (เปลี่ยนเป็นค่าจริงก่อน Flash) ---
#define WIFI_SSID           "Signal X"
#define WIFI_PASS           "202540aa"
#define WIFI_CONNECT_TIMEOUT 15000   // ms timeout การเชื่อมต่อ WiFi

// --- Firebase Realtime Database ---
#define FIREBASE_API_KEY    "AIzaSyBMKH9oG2DbhSZtIsN9d7iRfryHRkiUqRE"
#define FIREBASE_DB_URL     "https://smart-farm-esp32-5e482-default-rtdb.asia-southeast1.firebasedatabase.app"
#define FIREBASE_SYNC_INTERVAL  2000  // ms ส่งข้อมูลทุก 2 วินาที
#define FIREBASE_CMD_INTERVAL   1000  // ms รับคำสั่งทุก 1 วินาที

// ================================================================
//  SECTION 3: RELAY LOGIC — เปลี่ยนได้ง่ายตรงนี้
// ================================================================
#define RELAY_ON   HIGH   // Active HIGH relay module
#define RELAY_OFF  LOW

// ================================================================
//  SECTION 4: CONSTANTS
// ================================================================
#define NUM_ZONES           4
#define NUM_SCHEDULES       4
#define NUM_SOIL_SENSORS    3
#define LCD_COLS            20
#define LCD_ROWS            4

// --- โหมดควบคุมความชื้น ---
#define MODE_OFF            0
#define MODE_TIMER          1
#define MODE_SMART          2

// --- Alarm Types ---
#define ALARM_NONE          0
#define ALARM_NO_FLOW       1
#define ALARM_LOW_FLOW      2
#define ALARM_HIGH_FLOW     3
#define ALARM_SOIL_ERROR    4
#define ALARM_SHT30_ERROR   5
#define ALARM_RTC_ERROR     6
#define ALARM_SD_ERROR      7
#define ALARM_OVER_TEMP     8
#define ALARM_LOW_TEMP      9
#define ALARM_HIGH_HUMID    10
#define ALARM_LOW_HUMID     11

// --- Timing Intervals (ms) ---
#define SOIL_READ_INTERVAL  2000
#define SHT_READ_INTERVAL   5000
#define RTC_READ_INTERVAL    1000
#define FLOW_CALC_INTERVAL   1000
#define LCD_UPDATE_INTERVAL  300
#define LOG_INTERVAL         60000   // บันทึกทุก 1 นาที
#define ALARM_CHECK_INTERVAL 2000
#define DEBOUNCE_MS          5
#define LONG_PRESS_MS        1000
#define MANUAL_TIMEOUT_MS    1800000UL  // 30 นาที

// --- ค่าเริ่มต้น ---
#define DEFAULT_K_FACTOR     7.5f
#define DEFAULT_MIN_FLOW     0.5f
#define DEFAULT_MAX_FLOW     30.0f
#define DEFAULT_FLOW_DELAY   30      // วินาที (หน่วงเวลา 30 วินาทีเพื่อให้น้ำไหลผ่านท่อ)
#define DEFAULT_DRY_ADC      2860
#define DEFAULT_WET_ADC      1240
#define DEFAULT_MOIST_START  35
#define DEFAULT_MOIST_STOP   55
#define DEFAULT_TEMP_HIGH    45.0f
#define DEFAULT_TEMP_LOW     5.0f
#define DEFAULT_HUMID_HIGH   95.0f
#define DEFAULT_HUMID_LOW    20.0f

// --- Firmware ---
extern const char* FW_VERSION;

// ================================================================
//  SECTION 5: DATA STRUCTURES
// ================================================================

// --- ตารางเวลารดน้ำ ---
struct Schedule {
  bool     enabled;
  uint8_t  hour;       // 0-23
  uint8_t  minute;     // 0-59
  uint16_t duration;   // นาที
  uint8_t  days;       // bitmask: bit0=Sun .. bit6=Sat
};

// --- ค่าตั้งโซน ---
struct ZoneConfig {
  bool     enabled;          // เปิด/ปิด Zone
  uint8_t  mode;             // MODE_OFF / MODE_TIMER / MODE_SMART
  uint8_t  moistureStart;    // % เริ่มรดน้ำ
  uint8_t  moistureStop;     // % หยุดรดน้ำ
  Schedule schedules[NUM_SCHEDULES];
};

// --- สถานะ Runtime ของโซน ---
struct ZoneState {
  bool     running;
  bool     manual;
  bool     alarm;           // ถ้า alarm = true ห้ามเปิดอัตโนมัติ
  unsigned long startTime;
  unsigned long durationMs;
  float    waterUsed;       // ลิตร ในรอบนี้
};

// --- Calibration ดินแต่ละ Sensor ---
struct SoilCalibration {
  uint16_t dryADC;
  uint16_t wetADC;
};

// --- ค่าตั้ง Flow Sensor ---
struct FlowConfig {
  float   kFactor;
  float   minFlow;     // L/min
  float   maxFlow;     // L/min
  uint8_t flowDelay;   // วินาที
  bool    enabled;
};

// --- ค่าตั้ง Alarm ---
struct AlarmConfig {
  bool  soilEnabled;
  bool  sht30Enabled;
  bool  flowEnabled;
  bool  rtcEnabled;
  bool  sdEnabled;
  float tempHigh;
  float tempLow;
  float humHigh;
  float humLow;
};

// ================================================================
//  SECTION 6: MENU STATE ENUM
// ================================================================
enum MenuState {
  ST_DASHBOARD,
  ST_MAIN_MENU,
  // -- Main Menu Items --
  ST_WATERING,
  ST_SETTING,
  ST_SENSOR,
  ST_FLOW_VIEW,
  ST_MANUAL,
  ST_ALARM_VIEW,
  // -- Setting Sub --
  ST_TIME_DATE,
  ST_SET_TIME,
  ST_SET_DATE,
  ST_SCHEDULE,
  ST_SCHEDULE_ZONE,
  ST_SCHEDULE_EDIT,
  ST_MOISTURE,
  ST_MOISTURE_ZONE,
  ST_FLOW_MENU,
  ST_FLOW_STATUS,
  ST_FLOW_LIMIT,
  ST_FLOW_CALIB,
  ST_FLOW_CALIB_RUN,
  ST_FLOW_ALARM_SET,
  ST_FLOW_TOTAL,
  ST_CALIBRATION,
  ST_CALIB_SOIL,
  ST_CALIB_SOIL_RUN,
  ST_SENSOR_ALARM,
  ST_SENSOR_ALARM_EDIT,
  ST_SYSTEM,
  // -- Day Select --
  ST_DAY_SELECT,
};

#endif // CONFIG_H
