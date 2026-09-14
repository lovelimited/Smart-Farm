#ifndef GLOBALS_H
#define GLOBALS_H

#include <Arduino.h>
#include <Wire.h>
#include <SPI.h>
#include <SD.h>
#include <LiquidCrystal_I2C.h>
#include <RTClib.h>
#include <Adafruit_SHT31.h>
#include <Preferences.h>
#include "Config.h"

// ================================================================
//  GLOBAL HARDWARE OBJECTS & VARIABLES (EXTERN DECLARATIONS)
// ================================================================

// --- Hardware Objects ---
extern RTC_DS3231      rtc;
extern Adafruit_SHT31  sht30;
extern Preferences     prefs;
extern SPIClass        sdSPI;
extern LiquidCrystal_I2C lcd;

extern uint8_t  lcdAddress;
extern bool     lcdOK;
extern bool     rtcOK;
extern bool     sht30OK;
extern bool     sdOK;

// --- RTC Data ---
extern uint8_t  rtcHour, rtcMinute, rtcSecond;
extern uint8_t  rtcDay, rtcMonth;
extern uint16_t rtcYear;
extern uint8_t  rtcDow;          // 0=Sun

// --- SHT30 Data ---
extern float    temperature;
extern float    humidity;

// --- Soil Moisture ---
extern uint16_t soilRawADC[NUM_SOIL_SENSORS];
extern float    soilPercent[NUM_SOIL_SENSORS];
extern bool     soilError[NUM_SOIL_SENSORS];
extern const uint8_t soilPins[NUM_SOIL_SENSORS];

// --- Flow Sensor ---
extern volatile unsigned long flowPulseCount;
extern unsigned long lastFlowCalcTime;
extern float    flowRate;        // L/min
extern float    totalLiters;
extern float    sessionLiters;   // ลิตรต่อ session
extern unsigned long totalPulseLogged;

// --- Zone Config & State ---
extern ZoneConfig     zones[NUM_ZONES];
extern ZoneState      zoneState[NUM_ZONES];
extern SoilCalibration soilCal[NUM_SOIL_SENSORS];
extern FlowConfig     flowCfg;
extern AlarmConfig    alarmCfg;
extern const uint8_t  relayPins[NUM_ZONES];

// --- Encoder ---
extern int      lastCLK;
extern int      lastSW;
extern unsigned long swPressTime;
extern bool     shortPress;
extern bool     longPress;
extern int      encoderDelta;     // +1 / -1 / 0

// --- Menu ---
extern MenuState  currentMenu;
extern MenuState  menuStack[10];
extern int        menuStackDepth;
extern int        menuIdx;
extern int        menuScroll;
extern bool       editing;
extern int        editValue;
extern int        editMin;
extern int        editMax;
extern int        editStep;
extern int        editField;      // ฟิลด์ที่กำลังแก้ไข
extern int        selectedZone;   // 0-3
extern int        selectedSched;  // 0-3
extern int        selectedSensor; // 0-2
extern bool       lcdDirty;
extern unsigned long lastLcdUpdate;

// --- Calibration Flow Sub-state ---
extern uint8_t  calibFlowStep;
extern unsigned long calibFlowPulses;
extern float    calibFlowLiters;
extern int      calibFlowZone;

// --- Calibration Soil Sub-state ---
extern uint8_t  calibSoilStep;
extern uint16_t calibSoilDry;
extern uint16_t calibSoilWet;

// --- Day Select ---
extern uint8_t  daySelectValue;   // ค่า bitmask ที่กำลังแก้ไข
extern int      daySelectCursor;

// --- Buzzer ---
extern bool     buzzerActive;
extern unsigned long buzzerStart;
extern unsigned long buzzerDuration;
extern uint8_t  buzzerPattern;    // 0=single, 1=alarm
extern unsigned long buzzerLastToggle;
extern bool     buzzerState;
extern int      buzzerRepeat;

// --- Alarm ---
extern uint8_t  lastAlarmType;
extern int      lastAlarmZone;
extern char     lastAlarmMsg[21];
extern unsigned long lastAlarmTime;
extern bool     alarmActive;

// --- Timing ---
extern unsigned long lastSoilRead;
extern unsigned long lastSHTRead;
extern unsigned long lastRTCRead;
extern unsigned long lastLogTime;
extern unsigned long lastAlarmCheck;
extern uint8_t  lastScheduleMinute;

#endif // GLOBALS_H
