#include "Globals.h"

// --- Firmware Version ---
const char* FW_VERSION = "1.0.0";

// --- Hardware Objects ---
RTC_DS3231      rtc;
Adafruit_SHT31  sht30 = Adafruit_SHT31();
Preferences     prefs;
SPIClass        sdSPI(HSPI);
LiquidCrystal_I2C lcd(0x27, LCD_COLS, LCD_ROWS);

uint8_t  lcdAddress   = 0x27;
bool     lcdOK        = false;
bool     rtcOK        = false;
bool     sht30OK      = false;
bool     sdOK         = false;

// --- RTC Data ---
uint8_t  rtcHour   = 0;
uint8_t  rtcMinute = 0;
uint8_t  rtcSecond = 0;
uint8_t  rtcDay    = 1;
uint8_t  rtcMonth  = 1;
uint16_t rtcYear   = 2024;
uint8_t  rtcDow    = 0;          // 0=Sun

// --- SHT30 Data ---
float    temperature = 0;
float    humidity    = 0;

// --- Soil Moisture ---
uint16_t soilRawADC[NUM_SOIL_SENSORS] = {0};
float    soilPercent[NUM_SOIL_SENSORS] = {0};
bool     soilError[NUM_SOIL_SENSORS] = {false};
const uint8_t soilPins[NUM_SOIL_SENSORS] = { SOIL_PIN_1, SOIL_PIN_2, SOIL_PIN_3 };

// --- Flow Sensor ---
volatile unsigned long flowPulseCount = 0;
unsigned long lastFlowCalcTime = 0;
float    flowRate       = 0;     // L/min
float    totalLiters    = 0;
float    sessionLiters  = 0;     // ลิตรต่อ session
unsigned long totalPulseLogged = 0;

// --- Zone Config & State ---
ZoneConfig     zones[NUM_ZONES];
ZoneState      zoneState[NUM_ZONES];
SoilCalibration soilCal[NUM_SOIL_SENSORS];
FlowConfig     flowCfg;
AlarmConfig    alarmCfg;
const uint8_t  relayPins[NUM_ZONES] = { RELAY_1_PIN, RELAY_2_PIN, RELAY_3_PIN, RELAY_4_PIN };

// --- Encoder ---
int      lastCLK       = HIGH;
int      lastSW        = HIGH;
unsigned long swPressTime  = 0;
bool     shortPress    = false;
bool     longPress     = false;
int      encoderDelta  = 0;      // +1 / -1 / 0

// --- Menu ---
MenuState  currentMenu    = ST_DASHBOARD;
MenuState  menuStack[10];
int        menuStackDepth = 0;
int        menuIdx        = 0;
int        menuScroll     = 0;
bool       editing        = false;
int        editValue      = 0;
int        editMin        = 0;
int        editMax        = 0;
int        editStep       = 1;
int        editField      = 0;   // ฟิลด์ที่กำลังแก้ไข
int        selectedZone   = 0;   // 0-3
int        selectedSched  = 0;   // 0-3
int        selectedSensor = 0;   // 0-2
bool       lcdDirty       = true;
unsigned long lastLcdUpdate = 0;

// --- Calibration Flow Sub-state ---
uint8_t  calibFlowStep   = 0;
unsigned long calibFlowPulses = 0;
float    calibFlowLiters  = 1.0f;
int      calibFlowZone    = 0;

// --- Calibration Soil Sub-state ---
uint8_t  calibSoilStep   = 0;
uint16_t calibSoilDry    = 0;
uint16_t calibSoilWet    = 0;

// --- Day Select ---
uint8_t  daySelectValue  = 0x7F; // ค่า bitmask ที่กำลังแก้ไข
int      daySelectCursor = 0;

// --- Buzzer ---
bool     buzzerActive    = false;
unsigned long buzzerStart = 0;
unsigned long buzzerDuration = 0;
uint8_t  buzzerPattern   = 0;    // 0=single, 1=alarm
unsigned long buzzerLastToggle = 0;
bool     buzzerState     = false;
int      buzzerRepeat    = 0;

// --- Alarm ---
uint8_t  lastAlarmType   = ALARM_NONE;
int      lastAlarmZone   = -1;
char     lastAlarmMsg[21] = "";
unsigned long lastAlarmTime = 0;
bool     alarmActive     = false;

// --- Timing ---
unsigned long lastSoilRead    = 0;
unsigned long lastSHTRead     = 0;
unsigned long lastRTCRead     = 0;
unsigned long lastLogTime     = 0;
unsigned long lastAlarmCheck  = 0;
uint8_t  lastScheduleMinute  = 255;
