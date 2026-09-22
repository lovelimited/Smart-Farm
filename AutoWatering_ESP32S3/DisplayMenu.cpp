#include "DisplayMenu.h"
#include "Globals.h"
#include "BuzzerAlarm.h"
#include "WateringControl.h"
#include "Storage.h"

// --- SET_TIME / SET_DATE editing state ---
static uint8_t setTimeH, setTimeM, setTimeS;
static uint8_t setDateD, setDateMo;
static uint16_t setDateY;

// ================================================================
//  SECTION 10: DISPLAY & ENCODER INITIALIZATION
// ================================================================

// --- เริ่ม LCD พร้อม Auto-Detect Address ---
void initLCD() {
  // ลองหา LCD ที่ 0x27
  Wire.beginTransmission(0x27);
  if (Wire.endTransmission() == 0) {
    lcdAddress = 0x27;
    lcdOK = true;
  } else {
    // ลองที่ 0x3F
    Wire.beginTransmission(0x3F);
    if (Wire.endTransmission() == 0) {
      lcdAddress = 0x3F;
      lcdOK = true;
    }
  }

  if (lcdOK) {
    lcd = LiquidCrystal_I2C(lcdAddress, LCD_COLS, LCD_ROWS);
    lcd.init();
    lcd.backlight();
    lcd.clear();
    lcd.setCursor(0, 0);
    lcd.print(F("  AUTO WATERING SYS"));
    lcd.setCursor(0, 1);
    lcd.print(F("   ESP32-S3 v"));
    lcd.print(FW_VERSION);
    lcd.setCursor(0, 2);
    lcd.print(F("   Initializing..."));
    Serial.print(F("[LCD] Found at 0x"));
    Serial.println(lcdAddress, HEX);
  } else {
    Serial.println(F("[LCD] NOT FOUND!"));
  }
}

// --- เริ่ม Rotary Encoder ---
void initEncoder() {
  pinMode(ENC_CLK, INPUT_PULLUP);
  pinMode(ENC_DT,  INPUT_PULLUP);
  pinMode(ENC_SW,  INPUT_PULLUP);
  lastCLK = digitalRead(ENC_CLK);
  lastSW  = HIGH;
  Serial.println(F("[ENCODER] OK"));
}

// ================================================================
//  SECTION 17: ENCODER HANDLING
// ================================================================

void handleEncoder() {
  encoderDelta = 0;
  shortPress   = false;
  longPress    = false;

  // --- อ่าน Rotation พร้อม Debounce ---
  static unsigned long lastRotTime = 0;
  const unsigned long ROT_DEBOUNCE = 2;  // ms debounce สำหรับ rotation

  int newCLK = digitalRead(ENC_CLK);
  if (newCLK != lastCLK && (millis() - lastRotTime >= ROT_DEBOUNCE)) {
    lastRotTime = millis();
    // ตรวจทิศทางเมื่อ CLK เปลี่ยนจาก HIGH→LOW (falling edge)
    if (newCLK == LOW) {
      if (digitalRead(ENC_DT) == HIGH) {
        encoderDelta = 1;   // หมุนขวา (CW)
      } else {
        encoderDelta = -1;  // หมุนซ้าย (CCW)
      }
    }
    lastCLK = newCLK;
  }

  // --- อ่าน Button (SW) พร้อม Debounce ---
  int sw = digitalRead(ENC_SW);

  if (sw == LOW && lastSW == HIGH) {
    // เริ่มกด
    swPressTime = millis();
  }

  if (sw == HIGH && lastSW == LOW) {
    // ปล่อย
    unsigned long dur = millis() - swPressTime;
    if (dur >= LONG_PRESS_MS) {
      longPress = true;
    } else if (dur >= DEBOUNCE_MS) {
      shortPress = true;
    }
  }

  lastSW = sw;
}

// ================================================================
//  SECTION 18: MENU NAVIGATION HELPERS
// ================================================================

void pushMenu(MenuState st) {
  if (menuStackDepth < 10) {
    menuStack[menuStackDepth++] = currentMenu;
  }
  currentMenu = st;
  menuIdx     = 0;
  menuScroll  = 0;
  editing     = false;
  editField   = 0;
  if (lcdOK) lcd.clear();  // เคลียร์หน้าจอเมื่อเปลี่ยนเมนู
  lcdDirty    = true;
}

void popMenu() {
  editing = false;
  if (menuStackDepth > 0) {
    currentMenu = menuStack[--menuStackDepth];
  } else {
    currentMenu = ST_DASHBOARD;
  }
  menuIdx    = 0;
  menuScroll = 0;
  if (lcdOK) lcd.clear();  // เคลียร์หน้าจอเมื่อเปลี่ยนเมนู
  lcdDirty   = true;
}

// จัดการ Scroll ให้ menuIdx อยู่ในขอบเขต
void adjustScroll(int itemCount, int visibleRows) {
  if (menuIdx < 0) menuIdx = itemCount - 1;
  if (menuIdx >= itemCount) menuIdx = 0;
  if (menuIdx < menuScroll) menuScroll = menuIdx;
  if (menuIdx >= menuScroll + visibleRows) menuScroll = menuIdx - visibleRows + 1;
}

// พิมพ์ข้อความเติม Space ให้เต็มความกว้าง
void printPadded(const char* str, int width) {
  int len = strlen(str);
  lcd.print(str);
  for (int i = len; i < width; i++) lcd.print(' ');
}

// Render เมนูแบบ List ทั่วไป (title + items)
void renderListMenu(const char* title, const char** items, int count) {
  lcd.setCursor(0, 0);
  printPadded(title, LCD_COLS);
  for (int i = 0; i < 3; i++) {
    int idx = menuScroll + i;
    lcd.setCursor(0, i + 1);
    if (idx < count) {
      char line[21];
      snprintf(line, 21, "%c%-19s", (idx == menuIdx) ? '>' : ' ', items[idx]);
      lcd.print(line);
    } else {
      printPadded("", LCD_COLS);
    }
  }
}

// ชื่อวันย่อ
static const char* dayNames[] = {"SUN","MON","TUE","WED","THU","FRI","SAT"};
static const char* dayShort[]  = {"Su","Mo","Tu","We","Th","Fr","Sa"};

// สร้าง string วันจาก bitmask
void getDayString(uint8_t days, char* buf, int bufLen) {
  if (days == 0x7F) { strncpy(buf, "EVERYDAY", bufLen); return; }
  if (days == 0x3E) { strncpy(buf, "MON-FRI", bufLen); return; }
  if (days == 0x41) { strncpy(buf, "SAT-SUN", bufLen); return; }
  buf[0] = '\0';
  for (int d = 0; d < 7; d++) {
    if (days & (1 << d)) {
      if (strlen(buf) > 0) strncat(buf, ",", bufLen - strlen(buf) - 1);
      strncat(buf, dayShort[d], bufLen - strlen(buf) - 1);
    }
  }
  if (strlen(buf) == 0) strncpy(buf, "NONE", bufLen);
}

// ================================================================
//  SECTION 19: LCD & MENU RENDERING
// ================================================================

// --- Dashboard หน้าหลัก (จัดระเบียบให้สอดคล้องกับหน้า Web App) ---
void renderDashboard() {
  char line[21];

  // บรรทัด 0: เวลาแบบ 24 ชม. & วันที่ (เติมช่องว่างให้ครบ 20 ช่องเพื่อล้างตัวอักษรเก่าที่ค้าง)
  lcd.setCursor(0, 0);
  snprintf(line, 21, "%02d:%02d:%02d  %02d/%02d/%02d",
           rtcHour, rtcMinute, rtcSecond, rtcDay, rtcMonth, rtcYear % 100);
  printPadded(line, LCD_COLS);

  // บรรทัด 1: อุณหภูมิ & ความชื้นอากาศ (SHT30) และอัตราการไหล (Flow Rate)
  lcd.setCursor(0, 1);
  char tb[8], hb[8], fb[8];
  if (sht30OK) {
    dtostrf(temperature, 4, 1, tb);
    dtostrf(humidity, 2, 0, hb);
  } else {
    strcpy(tb, "--.-");
    strcpy(hb, "--");
  }
  dtostrf(flowRate, 4, 1, fb);
  snprintf(line, 21, "T:%sC H:%s%% F:%s", tb, hb, fb);
  printPadded(line, LCD_COLS);

  // บรรทัด 2: ค่าความชื้นดินแยก 3 โซน (S1, S2, S3) ตรงตาม Web App
  lcd.setCursor(0, 2);
  char s1Str[6], s2Str[6], s3Str[6];
  if (soilError[0] || soilPercent[0] < 0) strcpy(s1Str, "--%");
  else snprintf(s1Str, sizeof(s1Str), "%2.0f%%", soilPercent[0]);

  if (soilError[1] || soilPercent[1] < 0) strcpy(s2Str, "--%");
  else snprintf(s2Str, sizeof(s2Str), "%2.0f%%", soilPercent[1]);

  if (soilError[2] || soilPercent[2] < 0) strcpy(s3Str, "--%");
  else snprintf(s3Str, sizeof(s3Str), "%2.0f%%", soilPercent[2]);

  snprintf(line, 21, "S1:%s S2:%s S3:%s", s1Str, s2Str, s3Str);
  printPadded(line, LCD_COLS);

  // บรรทัด 3: สถานะการรดน้ำ, แจ้งเตือน หรือสถานะโหมดทั้ง 4 โซน
  lcd.setCursor(0, 3);
  int activeZone = -1;
  for (int z = 0; z < NUM_ZONES; z++) {
    if (zoneState[z].running) {
      activeZone = z;
      break;
    }
  }

  if (activeZone >= 0) {
    // มีโซนกำลังรดน้ำ: แสดงเวลานับถอยหลัง
    unsigned long elapsed = millis() - zoneState[activeZone].startTime;
    unsigned long remSec = 0;
    if (elapsed < zoneState[activeZone].durationMs) {
      remSec = (zoneState[activeZone].durationMs - elapsed) / 1000UL;
    }
    if (activeZone == 3) {
      snprintf(line, 21, ">> Z4 DRIP %02lu:%02lu <<", remSec / 60, remSec % 60);
    } else {
      snprintf(line, 21, ">> Z%d RUN  %02lu:%02lu <<", activeZone + 1, remSec / 60, remSec % 60);
    }
    printPadded(line, LCD_COLS);
  } else if (alarmActive) {
    // มี Alarm เตือนแบบกระพริบ
    if ((millis() / 1000) % 2 == 0) {
      snprintf(line, 21, "! %-16s !", lastAlarmMsg);
    } else {
      snprintf(line, 21, "  %-16s  ", lastAlarmMsg);
    }
    printPadded(line, LCD_COLS);
  } else {
    // สถานะปกติ: แสดงโหมดโซน 1-3 และระบุโซน 4 เป็น DRIP (น้ำหยด)
    char mChars[4];
    for (int z = 0; z < 3; z++) {
      if (zones[z].mode == MODE_OFF) mChars[z] = 'O';
      else if (zones[z].mode == MODE_TIMER) mChars[z] = 'T';
      else mChars[z] = 'S';
    }
    const char* z4Status = (zones[3].mode == MODE_OFF) ? "OFF " : "DRIP";
    snprintf(line, 21, "Z:1%c 2%c 3%c  Z4:%s", mChars[0], mChars[1], mChars[2], z4Status);
    printPadded(line, LCD_COLS);
  }
}

// --- Render เมนูปัจจุบัน ---
void renderCurrentMenu() {
  char line[21];
  char buf[21];

  switch (currentMenu) {

  // ============================
  //  MAIN MENU
  // ============================
  case ST_MAIN_MENU: {
    const char* items[] = {"WATERING","SETTING","SENSOR","FLOW","MANUAL","ALARM","< BACK"};
    renderListMenu("== MAIN MENU ==", items, 7);
  } break;

  // ============================
  //  WATERING OVERVIEW
  // ============================
  case ST_WATERING: {
    int wCount = NUM_ZONES + 1; // 4 zones + BACK
    lcd.setCursor(0, 0);
    printPadded("== WATERING ==", LCD_COLS);
    for (int i = 0; i < 3; i++) {
      int idx = menuScroll + i;
      lcd.setCursor(0, i + 1);
      if (idx < NUM_ZONES) {
        const char* modeStr;
        if (idx < 3) {
          modeStr = zones[idx].mode == MODE_SMART ? "SMART" :
                    zones[idx].mode == MODE_TIMER ? "TIMER" : "OFF";
        } else {
          modeStr = "TIMER";
        }
        snprintf(line, 21, "%cZ%d:%-3s %-5s %c",
                 idx == menuIdx ? '>' : ' ', idx + 1,
                 zoneState[idx].running ? "ON" : "OFF",
                 modeStr,
                 zones[idx].enabled ? 'E' : 'D');
        lcd.print(line);
      } else if (idx == NUM_ZONES) {
        snprintf(line, 21, "%c< BACK", idx == menuIdx ? '>' : ' ');
        printPadded(line, LCD_COLS);
      } else {
        printPadded("", LCD_COLS);
      }
    }
  } break;

  // ============================
  //  SETTING MENU
  // ============================
  case ST_SETTING: {
    const char* items[] = {"TIME / DATE","SCHEDULE","MOISTURE","FLOW SENSOR","CALIBRATION","SENSOR ALARM","SYSTEM","< BACK"};
    renderListMenu("== SETTING ==", items, 8);
  } break;

  // ============================
  //  SENSOR READINGS
  // ============================
  case ST_SENSOR: {
    lcd.setCursor(0, 0);
    char tb[8], hb[8];
    dtostrf(temperature, 4, 1, tb);
    dtostrf(humidity, 3, 0, hb);
    snprintf(line, 21, "T:%sC RH:%s%%", tb, hb);
    printPadded(line, LCD_COLS);

    lcd.setCursor(0, 1);
    if (soilError[0]) {
      snprintf(line, 21, "S1:ERR  R:%4d", soilRawADC[0]);
    } else {
      char pb[8]; dtostrf(soilPercent[0], 4, 1, pb);
      snprintf(line, 21, "S1:%s%% R:%4d", pb, soilRawADC[0]);
    }
    printPadded(line, LCD_COLS);

    lcd.setCursor(0, 2);
    if (soilError[1]) {
      snprintf(line, 21, "S2:ERR  R:%4d", soilRawADC[1]);
    } else {
      char pb[8]; dtostrf(soilPercent[1], 4, 1, pb);
      snprintf(line, 21, "S2:%s%% R:%4d", pb, soilRawADC[1]);
    }
    printPadded(line, LCD_COLS);

    lcd.setCursor(0, 3);
    if (soilError[2]) {
      snprintf(line, 21, "S3:ERR       [BACK]", soilRawADC[2]);
    } else {
      char pb[8]; dtostrf(soilPercent[2], 4, 1, pb);
      snprintf(line, 21, "S3:%s%%   [BACK]", pb);
    }
    printPadded(line, LCD_COLS);
  } break;

  // ============================
  //  FLOW VIEW
  // ============================
  case ST_FLOW_VIEW: {
    lcd.setCursor(0, 0);
    printPadded("== FLOW STATUS ==", LCD_COLS);

    char fb[8];
    lcd.setCursor(0, 1);
    dtostrf(flowRate, 5, 2, fb);
    snprintf(line, 21, "Rate: %s L/min", fb);
    printPadded(line, LCD_COLS);

    lcd.setCursor(0, 2);
    dtostrf(totalLiters, 7, 1, fb);
    snprintf(line, 21, "Total: %s L", fb);
    printPadded(line, LCD_COLS);

    lcd.setCursor(0, 3);
    printPadded("      Press=[BACK]", LCD_COLS);
  } break;

  // ============================
  //  MANUAL CONTROL
  // ============================
  case ST_MANUAL: {
    int mCount = NUM_ZONES + 1; // 4 zones + BACK
    lcd.setCursor(0, 0);
    printPadded("== MANUAL ==", LCD_COLS);
    for (int i = 0; i < 3; i++) {
      int idx = menuScroll + i;
      lcd.setCursor(0, i + 1);
      if (idx < NUM_ZONES) {
        snprintf(line, 21, "%cZONE %d  %-3s %s",
                 idx == menuIdx ? '>' : ' ', idx + 1,
                 zoneState[idx].running ? "ON" : "OFF",
                 zoneState[idx].manual ? "[M]" : "");
        printPadded(line, LCD_COLS);
      } else if (idx == NUM_ZONES) {
        snprintf(line, 21, "%c< BACK", idx == menuIdx ? '>' : ' ');
        printPadded(line, LCD_COLS);
      } else {
        printPadded("", LCD_COLS);
      }
    }
  } break;

  // ============================
  //  ALARM VIEW
  // ============================
  case ST_ALARM_VIEW: {
    lcd.setCursor(0, 0);
    printPadded("== ALARM LOG ==", LCD_COLS);
    lcd.setCursor(0, 1);
    if (alarmActive) {
      snprintf(line, 21, "Type: %s", lastAlarmMsg);
      printPadded(line, LCD_COLS);
      lcd.setCursor(0, 2);
      snprintf(line, 21, "Zone: %s", lastAlarmZone >= 0 ? (String("Z") + String(lastAlarmZone + 1)).c_str() : "SYS");
      printPadded(line, LCD_COLS);
      lcd.setCursor(0, 3);
      snprintf(line, 21, "%cRESET  %c< BACK",
               menuIdx == 0 ? '>' : ' ', menuIdx == 1 ? '>' : ' ');
      printPadded(line, LCD_COLS);
    } else {
      printPadded("No active alarms", LCD_COLS);
      lcd.setCursor(0, 2);
      printPadded("", LCD_COLS);
      lcd.setCursor(0, 3);
      printPadded("      Press=[BACK]", LCD_COLS);
    }
  } break;

  // ============================
  //  TIME / DATE MENU
  // ============================
  case ST_TIME_DATE: {
    const char* items[] = {"SET TIME","SET DATE","RTC STATUS","< BACK"};
    renderListMenu("== TIME/DATE ==", items, 4);
  } break;

  // ============================
  //  SET TIME
  // ============================
  case ST_SET_TIME: {
    lcd.setCursor(0, 0);
    printPadded("== SET TIME ==", LCD_COLS);

    // แสดงเวลาปัจจุบันของ RTC
    lcd.setCursor(0, 1);
    snprintf(line, 21, "Now: %02d:%02d:%02d", rtcHour, rtcMinute, rtcSecond);
    printPadded(line, LCD_COLS);

    // ฟิลด์แก้ไข: H, M, S (ใช้ file-scope static)
    if (!editing && editField == 0) {
      setTimeH = rtcHour; setTimeM = rtcMinute; setTimeS = rtcSecond;
    }

    lcd.setCursor(0, 2);
    snprintf(line, 21, "Set: %s%02d%s:%s%02d%s:%s%02d%s",
             (editing && editField == 0) ? "[" : " ", setTimeH, (editing && editField == 0) ? "]" : " ",
             (editing && editField == 1) ? "[" : " ", setTimeM, (editing && editField == 1) ? "]" : " ",
             (editing && editField == 2) ? "[" : " ", setTimeS, (editing && editField == 2) ? "]" : " ");
    printPadded(line, LCD_COLS);

    lcd.setCursor(0, 3);
    if (editing) {
      printPadded("Turn=Adj Press=Next", LCD_COLS);
    } else {
      const char* fitems[] = {"HOUR","MINUTE","SECOND","SAVE"};
      snprintf(line, 21, ">%-19s", fitems[editField]);
      printPadded(line, LCD_COLS);
    }
    // (Input ย้ายไป handleMenuInput แล้ว)
  } break;

  // ============================
  //  SET DATE
  // ============================
  case ST_SET_DATE: {
    lcd.setCursor(0, 0);
    printPadded("== SET DATE ==", LCD_COLS);

    lcd.setCursor(0, 1);
    snprintf(line, 21, "Now: %02d/%02d/%04d", rtcDay, rtcMonth, rtcYear);
    printPadded(line, LCD_COLS);

    // ฟิลด์แก้ไข: D, Mo, Y (ใช้ file-scope static)
    if (!editing && editField == 0) {
      setDateD = rtcDay; setDateMo = rtcMonth; setDateY = rtcYear;
    }

    lcd.setCursor(0, 2);
    snprintf(line, 21, "Set: %s%02d%s/%s%02d%s/%s%04d%s",
             (editing && editField == 0) ? "[" : " ", setDateD, (editing && editField == 0) ? "]" : " ",
             (editing && editField == 1) ? "[" : " ", setDateMo, (editing && editField == 1) ? "]" : " ",
             (editing && editField == 2) ? "[" : "",  setDateY,  (editing && editField == 2) ? "]" : "");
    printPadded(line, LCD_COLS);

    lcd.setCursor(0, 3);
    if (editing) {
      printPadded("Turn=Adj Press=Next", LCD_COLS);
    } else {
      const char* fitems[] = {"DAY","MONTH","YEAR","SAVE"};
      snprintf(line, 21, ">%-19s", fitems[editField]);
      printPadded(line, LCD_COLS);
    }
    // (Input ย้ายไป handleMenuInput แล้ว)
  } break;

  // ============================
  //  SCHEDULE MENU (เลือก Zone)
  // ============================
  case ST_SCHEDULE: {
    const char* items[] = {"ZONE 1","ZONE 2","ZONE 3","ZONE 4"};
    renderListMenu("== SCHEDULE ==", items, 4);
  } break;

  // ============================
  //  SCHEDULE ZONE (เลือก Slot)
  // ============================
  case ST_SCHEDULE_ZONE: {
    snprintf(buf, 21, "== ZONE %d SCHED ==", selectedZone + 1);
    lcd.setCursor(0, 0);
    printPadded(buf, LCD_COLS);

    const char* items[6];
    char ibuf[6][21];
    snprintf(ibuf[0], 21, "ENABLE: %s", zones[selectedZone].enabled ? "ON" : "OFF");
    items[0] = ibuf[0];
    for (int s = 0; s < NUM_SCHEDULES; s++) {
      Schedule &sch = zones[selectedZone].schedules[s];
      if (sch.enabled) {
        snprintf(ibuf[s + 1], 21, "S%d %02d:%02d %dmin", s + 1, sch.hour, sch.minute, sch.duration);
      } else {
        snprintf(ibuf[s + 1], 21, "S%d OFF", s + 1);
      }
      items[s + 1] = ibuf[s + 1];
    }
    int count = 5;

    for (int i = 0; i < 3; i++) {
      int idx = menuScroll + i;
      lcd.setCursor(0, i + 1);
      if (idx < count) {
        snprintf(line, 21, "%c%-19s", idx == menuIdx ? '>' : ' ', items[idx]);
        lcd.print(line);
      } else {
        printPadded("", LCD_COLS);
      }
    }
  } break;

  // ============================
  //  SCHEDULE EDIT (แก้ไข Slot)
  // ============================
  case ST_SCHEDULE_EDIT: {
    Schedule &sch = zones[selectedZone].schedules[selectedSched];

    snprintf(buf, 21, "Z%d Sched %d", selectedZone + 1, selectedSched + 1);
    lcd.setCursor(0, 0);
    printPadded(buf, LCD_COLS);

    // Fields: 0=Enable, 1=Hour, 2=Minute, 3=Duration, 4=Days, 5=SAVE
    char dayStr[21];
    getDayString(sch.days, dayStr, 21);

    const int FIELD_COUNT = 6;
    char fbuf[6][21];
    snprintf(fbuf[0], 21, "EN: %s", sch.enabled ? "ON" : "OFF");
    snprintf(fbuf[1], 21, "Hour: %02d", sch.hour);
    snprintf(fbuf[2], 21, "Min:  %02d", sch.minute);
    snprintf(fbuf[3], 21, "Dur:  %d min", sch.duration);
    snprintf(fbuf[4], 21, "Day: %s", dayStr);
    snprintf(fbuf[5], 21, "SAVE & BACK");

    for (int i = 0; i < 3; i++) {
      int idx = menuScroll + i;
      lcd.setCursor(0, i + 1);
      if (idx < FIELD_COUNT) {
        char prefix = (idx == menuIdx) ? '>' : ' ';
        if (editing && idx == menuIdx) prefix = '*';
        snprintf(line, 21, "%c%-19s", prefix, fbuf[idx]);
        lcd.print(line);
      } else {
        printPadded("", LCD_COLS);
      }
    }
  } break;

  // ============================
  //  DAY SELECT (เลือกวัน)
  // ============================
  case ST_DAY_SELECT: {
    lcd.setCursor(0, 0);
    printPadded("== SELECT DAYS ==", LCD_COLS);
    for (int i = 0; i < 3; i++) {
      int idx = menuScroll + i;
      lcd.setCursor(0, i + 1);
      if (idx < 9) {
        if (idx < 7) {
          snprintf(line, 21, "%c%-3s [%c]",
                   idx == menuIdx ? '>' : ' ',
                   dayNames[idx],
                   (daySelectValue & (1 << idx)) ? '*' : ' ');
        } else if (idx == 7) {
          snprintf(line, 21, "%cALL ON", idx == menuIdx ? '>' : ' ');
        } else {
          snprintf(line, 21, "%cSAVE & BACK", idx == menuIdx ? '>' : ' ');
        }
        printPadded(line, LCD_COLS);
      } else {
        printPadded("", LCD_COLS);
      }
    }
  } break;

  // ============================
  //  MOISTURE MENU
  // ============================
  case ST_MOISTURE: {
    const char* items[] = {"ZONE 1","ZONE 2","ZONE 3"};
    renderListMenu("== MOISTURE ==", items, 3);
  } break;

  // ============================
  //  MOISTURE ZONE EDIT
  // ============================
  case ST_MOISTURE_ZONE: {
    snprintf(buf, 21, "== Z%d MOISTURE ==", selectedZone + 1);
    lcd.setCursor(0, 0);
    printPadded(buf, LCD_COLS);

    const char* modeStr = zones[selectedZone].mode == MODE_SMART ? "SMART" :
                          zones[selectedZone].mode == MODE_TIMER ? "TIMER" : "OFF";

    char fbuf[4][21];
    snprintf(fbuf[0], 21, "MODE: %s", modeStr);
    snprintf(fbuf[1], 21, "START: %d%%", zones[selectedZone].moistureStart);
    snprintf(fbuf[2], 21, "STOP:  %d%%", zones[selectedZone].moistureStop);
    snprintf(fbuf[3], 21, "SAVE & BACK");
    const int FIELD_COUNT = 4;

    for (int i = 0; i < 3; i++) {
      int idx = menuScroll + i;
      lcd.setCursor(0, i + 1);
      if (idx < FIELD_COUNT) {
        char prefix = (idx == menuIdx) ? '>' : ' ';
        if (editing && idx == menuIdx) prefix = '*';
        snprintf(line, 21, "%c%-19s", prefix, fbuf[idx]);
        lcd.print(line);
      } else {
        printPadded("", LCD_COLS);
      }
    }
  } break;

  // ============================
  //  FLOW MENU
  // ============================
  case ST_FLOW_MENU: {
    const char* items[] = {"STATUS","SET LIMIT","CALIBRATION","ALARM","TOTAL RESET"};
    renderListMenu("== FLOW SENSOR ==", items, 5);
  } break;

  // ============================
  //  FLOW STATUS
  // ============================
  case ST_FLOW_STATUS: {
    char fb[8];
    lcd.setCursor(0, 0);
    printPadded("== FLOW STATUS ==", LCD_COLS);

    lcd.setCursor(0, 1);
    dtostrf(flowRate, 5, 2, fb);
    snprintf(line, 21, "Flow: %s L/min", fb);
    printPadded(line, LCD_COLS);

    lcd.setCursor(0, 2);
    dtostrf(totalLiters, 7, 1, fb);
    snprintf(line, 21, "Total: %s L", fb);
    printPadded(line, LCD_COLS);

    lcd.setCursor(0, 3);
    dtostrf(flowCfg.kFactor, 5, 2, fb);
    snprintf(line, 21, "K-Factor: %s", fb);
    printPadded(line, LCD_COLS);
  } break;

  // ============================
  //  FLOW LIMIT EDIT
  // ============================
  case ST_FLOW_LIMIT: {
    lcd.setCursor(0, 0);
    printPadded("== FLOW LIMIT ==", LCD_COLS);

    char fb1[8], fb2[8];
    dtostrf(flowCfg.minFlow, 5, 1, fb1);
    dtostrf(flowCfg.maxFlow, 5, 1, fb2);

    char fbuf[4][21];
    snprintf(fbuf[0], 21, "Min: %s L/m", fb1);
    snprintf(fbuf[1], 21, "Max: %s L/m", fb2);
    snprintf(fbuf[2], 21, "Delay: %ds", flowCfg.flowDelay);
    snprintf(fbuf[3], 21, "SAVE & BACK");
    const int FIELD_COUNT = 4;

    for (int i = 0; i < 3; i++) {
      int idx = menuScroll + i;
      lcd.setCursor(0, i + 1);
      if (idx < FIELD_COUNT) {
        char prefix = (idx == menuIdx) ? '>' : ' ';
        if (editing && idx == menuIdx) prefix = '*';
        snprintf(line, 21, "%c%-19s", prefix, fbuf[idx]);
        lcd.print(line);
      } else {
        printPadded("", LCD_COLS);
      }
    }
  } break;

  // ============================
  //  FLOW CALIBRATION
  // ============================
  case ST_FLOW_CALIB: {
    lcd.setCursor(0, 0);
    printPadded("== FLOW CALIB ==", LCD_COLS);

    switch (calibFlowStep) {
      case 0: // Select zone
        lcd.setCursor(0, 1);
        printPadded("Select zone valve:", LCD_COLS);
        lcd.setCursor(0, 2);
        snprintf(line, 21, ">ZONE: %d", calibFlowZone + 1);
        printPadded(line, LCD_COLS);
        lcd.setCursor(0, 3);
        printPadded("Press=START", LCD_COLS);
        break;

      case 1: // Running
        lcd.setCursor(0, 1);
        printPadded("RUNNING... Count:", LCD_COLS);
        lcd.setCursor(0, 2);
        snprintf(line, 21, "Pulse: %lu", calibFlowPulses);
        printPadded(line, LCD_COLS);
        lcd.setCursor(0, 3);
        printPadded("Press=STOP", LCD_COLS);
        break;

      case 2: { // Enter liters
        lcd.setCursor(0, 1);
        printPadded("Enter actual liters:", LCD_COLS);
        char lb[8];
        dtostrf(calibFlowLiters, 5, 1, lb);
        lcd.setCursor(0, 2);
        snprintf(line, 21, "Liters: [%s]", lb);
        printPadded(line, LCD_COLS);
        lcd.setCursor(0, 3);
        printPadded("Turn=Adj Press=OK", LCD_COLS);
      } break;

      case 3: { // Result
        float newK = (float)calibFlowPulses / (calibFlowLiters * 60.0f);
        char ob[8], nb[8];
        dtostrf(flowCfg.kFactor, 5, 2, ob);
        dtostrf(newK, 5, 2, nb);
        lcd.setCursor(0, 1);
        snprintf(line, 21, "Old K: %s", ob);
        printPadded(line, LCD_COLS);
        lcd.setCursor(0, 2);
        snprintf(line, 21, "New K: %s", nb);
        printPadded(line, LCD_COLS);
        lcd.setCursor(0, 3);
        snprintf(line, 21, "%cSAVE  %cCANCEL",
                 menuIdx == 0 ? '>' : ' ', menuIdx == 1 ? '>' : ' ');
        printPadded(line, LCD_COLS);
      } break;
    }
  } break;

  // ============================
  //  FLOW ALARM SETTING
  // ============================
  case ST_FLOW_ALARM_SET: {
    lcd.setCursor(0, 0);
    printPadded("== FLOW ALARM ==", LCD_COLS);

    char fbuf[2][21];
    snprintf(fbuf[0], 21, "Enable: %s", flowCfg.enabled ? "ON" : "OFF");
    snprintf(fbuf[1], 21, "SAVE & BACK");
    const int FIELD_COUNT = 2;

    for (int i = 0; i < 3; i++) {
      int idx = menuScroll + i;
      lcd.setCursor(0, i + 1);
      if (idx < FIELD_COUNT) {
        char prefix = (idx == menuIdx) ? '>' : ' ';
        if (editing && idx == menuIdx) prefix = '*';
        snprintf(line, 21, "%c%-19s", prefix, fbuf[idx]);
        lcd.print(line);
      } else {
        printPadded("", LCD_COLS);
      }
    }
  } break;

  // ============================
  //  FLOW TOTAL (Reset)
  // ============================
  case ST_FLOW_TOTAL: {
    char fb[10];
    lcd.setCursor(0, 0);
    printPadded("== FLOW TOTAL ==", LCD_COLS);
    lcd.setCursor(0, 1);
    dtostrf(totalLiters, 8, 1, fb);
    snprintf(line, 21, "Total: %s L", fb);
    printPadded(line, LCD_COLS);
    lcd.setCursor(0, 2);
    printPadded(">RESET TOTAL", LCD_COLS);
    lcd.setCursor(0, 3);
    printPadded(" Press to reset", LCD_COLS);
  } break;

  // ============================
  //  CALIBRATION MENU
  // ============================
  case ST_CALIBRATION: {
    const char* items[] = {"SOIL Z1","SOIL Z2","SOIL Z3","FLOW","RESET ALL","< BACK"};
    renderListMenu("== CALIBRATION ==", items, 6);
  } break;

  // ============================
  //  SOIL CALIBRATION
  // ============================
  case ST_CALIB_SOIL: {
    snprintf(buf, 21, "CALIB SOIL %d", selectedSensor + 1);
    lcd.setCursor(0, 0);
    printPadded(buf, LCD_COLS);

    switch (calibSoilStep) {
      case 0: // แสดงค่าปัจจุบัน + Live ADC
        lcd.setCursor(0, 1);
        snprintf(line, 21, "ADC Now: %d", soilRawADC[selectedSensor]);
        printPadded(line, LCD_COLS);
        lcd.setCursor(0, 2);
        snprintf(line, 21, "DRY:%d WET:%d", soilCal[selectedSensor].dryADC, soilCal[selectedSensor].wetADC);
        printPadded(line, LCD_COLS);
        lcd.setCursor(0, 3);
        printPadded(">SET DRY  Press=OK", LCD_COLS);
        break;

      case 1: // Set DRY
        lcd.setCursor(0, 1);
        snprintf(line, 21, "ADC Now: %d", soilRawADC[selectedSensor]);
        printPadded(line, LCD_COLS);
        lcd.setCursor(0, 2);
        snprintf(line, 21, "DRY set: %d", calibSoilDry);
        printPadded(line, LCD_COLS);
        lcd.setCursor(0, 3);
        printPadded(">SET WET  Press=OK", LCD_COLS);
        break;

      case 2: // Set WET
        lcd.setCursor(0, 1);
        snprintf(line, 21, "ADC Now: %d", soilRawADC[selectedSensor]);
        printPadded(line, LCD_COLS);
        lcd.setCursor(0, 2);
        snprintf(line, 21, "WET set: %d", calibSoilWet);
        printPadded(line, LCD_COLS);
        lcd.setCursor(0, 3);
        printPadded(">CONFIRM? Press=OK", LCD_COLS);
        break;

      case 3: // Confirm
        lcd.setCursor(0, 1);
        snprintf(line, 21, "DRY: %d", calibSoilDry);
        printPadded(line, LCD_COLS);
        lcd.setCursor(0, 2);
        snprintf(line, 21, "WET: %d", calibSoilWet);
        printPadded(line, LCD_COLS);
        lcd.setCursor(0, 3);
        snprintf(line, 21, "%cSAVE  %cCANCEL",
                 menuIdx == 0 ? '>' : ' ', menuIdx == 1 ? '>' : ' ');
        printPadded(line, LCD_COLS);
        break;
    }
  } break;

  // ============================
  //  SENSOR ALARM MENU
  // ============================
  case ST_SENSOR_ALARM: {
    char ibuf[5][21];
    snprintf(ibuf[0], 21, "SOIL:  %s", alarmCfg.soilEnabled ? "ON" : "OFF");
    snprintf(ibuf[1], 21, "SHT30: %s", alarmCfg.sht30Enabled ? "ON" : "OFF");
    snprintf(ibuf[2], 21, "FLOW:  %s", alarmCfg.flowEnabled ? "ON" : "OFF");
    snprintf(ibuf[3], 21, "RTC:   %s", alarmCfg.rtcEnabled ? "ON" : "OFF");
    snprintf(ibuf[4], 21, "SD:    %s", alarmCfg.sdEnabled ? "ON" : "OFF");
    const char* items[5];
    for (int i = 0; i < 5; i++) items[i] = ibuf[i];
    renderListMenu("== SENSOR ALARM ==", items, 5);
  } break;

  // ============================
  //  SENSOR ALARM EDIT (SHT30 thresholds)
  // ============================
  case ST_SENSOR_ALARM_EDIT: {
    lcd.setCursor(0, 0);
    printPadded("== SHT30 ALARM ==", LCD_COLS);

    char t1[8], t2[8], h1[8], h2[8];
    dtostrf(alarmCfg.tempHigh, 5, 1, t1);
    dtostrf(alarmCfg.tempLow,  5, 1, t2);
    dtostrf(alarmCfg.humHigh,  4, 0, h1);
    dtostrf(alarmCfg.humLow,   4, 0, h2);

    char fbuf[5][21];
    snprintf(fbuf[0], 21, "TempHi: %sC", t1);
    snprintf(fbuf[1], 21, "TempLo: %sC", t2);
    snprintf(fbuf[2], 21, "HumHi:  %s%%", h1);
    snprintf(fbuf[3], 21, "HumLo:  %s%%", h2);
    snprintf(fbuf[4], 21, "SAVE & BACK");
    const int FIELD_COUNT = 5;

    for (int i = 0; i < 3; i++) {
      int idx = menuScroll + i;
      lcd.setCursor(0, i + 1);
      if (idx < FIELD_COUNT) {
        char prefix = (idx == menuIdx) ? '>' : ' ';
        if (editing && idx == menuIdx) prefix = '*';
        snprintf(line, 21, "%c%-19s", prefix, fbuf[idx]);
        lcd.print(line);
      } else {
        printPadded("", LCD_COLS);
      }
    }
  } break;

  // ============================
  //  SYSTEM MENU
  // ============================
  case ST_SYSTEM: {
    lcd.setCursor(0, 0);
    printPadded("== SYSTEM ==", LCD_COLS);

    unsigned long upSec = millis() / 1000;
    int upH = upSec / 3600;
    int upM = (upSec % 3600) / 60;

    char fbuf[4][21];
    snprintf(fbuf[0], 21, "FW: %s", FW_VERSION);
    snprintf(fbuf[1], 21, "Up: %dh %dm", upH, upM);
    snprintf(fbuf[2], 21, "Free: %lu B", (unsigned long)ESP.getFreeHeap());
    snprintf(fbuf[3], 21, ">RESET SETTINGS");
    const char* items[4];
    for (int i = 0; i < 4; i++) items[i] = fbuf[i];

    for (int i = 0; i < 3; i++) {
      int idx = menuScroll + i;
      lcd.setCursor(0, i + 1);
      if (idx < 4) {
        snprintf(line, 21, "%c%-19s", idx == menuIdx ? '>' : ' ', items[idx]);
        lcd.print(line);
      } else {
        printPadded("", LCD_COLS);
      }
    }
  } break;

  default:
    lcd.setCursor(0, 0);
    printPadded("UNKNOWN MENU", LCD_COLS);
    break;
  }
}

// ================================================================
//  SECTION 20: MENU INPUT HANDLING
// ================================================================

void handleMenuInput() {
  // ไม่มี Input → ไม่ต้องทำอะไร
  if (encoderDelta == 0 && !shortPress && !longPress) return;

  // Long Press = กลับไปเมนูก่อนหน้า (ทุกสถานะ)
  if (longPress) {
    // ยกเลิก Editing ถ้ากำลังแก้ไข
    if (editing) {
      editing = false;
      editField = 0;
      lcdDirty = true;
      beep(50);
      return;
    }
    // ถ้ากำลัง Calibrate Flow Running → หยุด
    if (currentMenu == ST_FLOW_CALIB && calibFlowStep == 1) {
      stopZone(calibFlowZone);
      calibFlowStep = 0;
      lcdDirty = true;
      return;
    }
    popMenu();
    beep(50);
    return;
  }

  switch (currentMenu) {

  // ============================
  //  DASHBOARD
  // ============================
  case ST_DASHBOARD: {
    if (shortPress || encoderDelta != 0) {
      pushMenu(ST_MAIN_MENU);
      beep(30);
    }
  } break;

  // ============================
  //  MAIN MENU
  // ============================
  case ST_MAIN_MENU: {
    if (encoderDelta != 0) {
      menuIdx += encoderDelta;
      adjustScroll(7, 3);
      lcdDirty = true;
    }
    if (shortPress) {
      beep(30);
      switch (menuIdx) {
        case 0: pushMenu(ST_WATERING); break;
        case 1: pushMenu(ST_SETTING); break;
        case 2: pushMenu(ST_SENSOR); break;
        case 3: pushMenu(ST_FLOW_VIEW); break;
        case 4: pushMenu(ST_MANUAL); break;
        case 5: pushMenu(ST_ALARM_VIEW); break;
        case 6: popMenu(); break;  // < BACK → Dashboard
      }
    }
  } break;

  // ============================
  //  WATERING
  // ============================
  case ST_WATERING: {
    int wCount = NUM_ZONES + 1;
    if (encoderDelta != 0) {
      menuIdx += encoderDelta;
      adjustScroll(wCount, 3);
      lcdDirty = true;
    }
    if (shortPress) {
      beep(30);
      if (menuIdx < NUM_ZONES) {
        zones[menuIdx].enabled = !zones[menuIdx].enabled;
        saveSettings();
      } else {
        popMenu();  // < BACK
      }
      lcdDirty = true;
    }
  } break;

  // ============================
  //  SETTING
  // ============================
  case ST_SETTING: {
    if (encoderDelta != 0) {
      menuIdx += encoderDelta;
      adjustScroll(8, 3);
      lcdDirty = true;
    }
    if (shortPress) {
      beep(30);
      switch (menuIdx) {
        case 0: pushMenu(ST_TIME_DATE); break;
        case 1: pushMenu(ST_SCHEDULE); break;
        case 2: pushMenu(ST_MOISTURE); break;
        case 3: pushMenu(ST_FLOW_MENU); break;
        case 4: pushMenu(ST_CALIBRATION); break;
        case 5: pushMenu(ST_SENSOR_ALARM); break;
        case 6: pushMenu(ST_SYSTEM); break;
        case 7: popMenu(); break;  // < BACK
      }
    }
  } break;

  // ============================
  //  SENSOR (read-only)
  // ============================
  case ST_SENSOR: {
    lcdDirty = true; // อัพเดทค่า sensor ตลอด
    if (shortPress) {
      popMenu();  // กดปุ่ม = กลับ
      beep(30);
    }
  } break;

  // ============================
  //  FLOW VIEW (read-only)
  // ============================
  case ST_FLOW_VIEW: {
    lcdDirty = true;
    if (shortPress) {
      popMenu();  // กดปุ่ม = กลับ
      beep(30);
    }
  } break;

  // ============================
  //  MANUAL CONTROL
  // ============================
  case ST_MANUAL: {
    int mCount = NUM_ZONES + 1;
    if (encoderDelta != 0) {
      menuIdx += encoderDelta;
      adjustScroll(mCount, 3);
      lcdDirty = true;
    }
    if (shortPress) {
      beep(30);
      if (menuIdx < NUM_ZONES) {
        int z = menuIdx;
        if (zoneState[z].running) {
          stopZone(z);
        } else {
          zoneState[z].manual = true;
          zoneState[z].alarm  = false;
          startZone(z, MANUAL_TIMEOUT_MS);
          zoneState[z].manual = true;
        }
      } else {
        popMenu();  // < BACK
      }
      lcdDirty = true;
    }
  } break;

  // ============================
  //  ALARM VIEW
  // ============================
  case ST_ALARM_VIEW: {
    if (encoderDelta != 0 && alarmActive) {
      menuIdx = constrain(menuIdx + encoderDelta, 0, 1);
      lcdDirty = true;
    }
    if (shortPress) {
      beep(30);
      if (alarmActive && menuIdx == 0) {
        // Reset Alarm
        alarmActive     = false;
        lastAlarmType   = ALARM_NONE;
        lastAlarmZone   = -1;
        lastAlarmMsg[0] = '\0';
        for (int z = 0; z < NUM_ZONES; z++) {
          zoneState[z].alarm = false;
        }
        beep(100);
      } else {
        popMenu();  // < BACK (ทั้งกรณี no alarm และเลือก BACK)
      }
      lcdDirty = true;
    }
  } break;

  // ============================
  //  TIME / DATE
  // ============================
  case ST_TIME_DATE: {
    if (encoderDelta != 0) {
      menuIdx += encoderDelta;
      adjustScroll(4, 3);
      lcdDirty = true;
    }
    if (shortPress) {
      beep(30);
      switch (menuIdx) {
        case 0: pushMenu(ST_SET_TIME); editField = 0; editing = false; break;
        case 1: pushMenu(ST_SET_DATE); editField = 0; editing = false; break;
        case 2: break; // RTC Status (read-only)
        case 3: popMenu(); break;  // < BACK
      }
    }
  } break;

  // ============================
  //  SET TIME
  // ============================
  case ST_SET_TIME: {
    if (!editing) {
      if (encoderDelta != 0) {
        editField += encoderDelta;
        if (editField < 0) editField = 3;
        if (editField > 3) editField = 0;
        lcdDirty = true;
      }
      if (shortPress) {
        beep(30);
        if (editField < 3) {
          editing = true;
        } else {
          // SAVE — ไม่ต้องทำอะไรเพิ่ม (ค่าถูก adjust ไปแล้วทีละ field)
        }
        lcdDirty = true;
      }
    } else {
      // === Editing mode: หมุนปรับค่า H/M/S ===
      if (encoderDelta != 0) {
        if (editField == 0) setTimeH = (setTimeH + encoderDelta + 24) % 24;
        if (editField == 1) setTimeM = (setTimeM + encoderDelta + 60) % 60;
        if (editField == 2) setTimeS = (setTimeS + encoderDelta + 60) % 60;
        lcdDirty = true;
      }
      if (shortPress) {
        editField++;
        if (editField > 2) {
          // บันทึกเวลาใหม่
          editing = false;
          editField = 0;
          if (rtcOK) {
            rtc.adjust(DateTime(rtcYear, rtcMonth, rtcDay, setTimeH, setTimeM, setTimeS));
            beep(100);
          }
        }
        lcdDirty = true;
      }
    }
  } break;

  // ============================
  //  SET DATE
  // ============================
  case ST_SET_DATE: {
    if (!editing) {
      if (encoderDelta != 0) {
        editField += encoderDelta;
        if (editField < 0) editField = 3;
        if (editField > 3) editField = 0;
        lcdDirty = true;
      }
      if (shortPress) {
        beep(30);
        if (editField < 3) {
          editing = true;
        }
        lcdDirty = true;
      }
    } else {
      // === Editing mode: หมุนปรับค่า D/Mo/Y ===
      if (encoderDelta != 0) {
        if (editField == 0) setDateD = ((int)setDateD - 1 + encoderDelta + 31) % 31 + 1;
        if (editField == 1) setDateMo = ((int)setDateMo - 1 + encoderDelta + 12) % 12 + 1;
        if (editField == 2) setDateY = constrain((int)setDateY + encoderDelta, 2020, 2099);
        lcdDirty = true;
      }
      if (shortPress) {
        editField++;
        if (editField > 2) {
          editing = false;
          editField = 0;
          if (rtcOK) {
            rtc.adjust(DateTime(setDateY, setDateMo, setDateD, rtcHour, rtcMinute, rtcSecond));
            beep(100);
          }
        }
        lcdDirty = true;
      }
    }
  } break;

  // ============================
  //  SCHEDULE
  // ============================
  case ST_SCHEDULE: {
    if (encoderDelta != 0) {
      menuIdx += encoderDelta;
      adjustScroll(5, 3); // 4 zones + BACK
      lcdDirty = true;
    }
    if (shortPress) {
      beep(30);
      if (menuIdx < 4) {
        selectedZone = menuIdx;
        pushMenu(ST_SCHEDULE_ZONE);
      } else {
        popMenu();  // < BACK
      }
    }
  } break;

  // ============================
  //  SCHEDULE ZONE (Slot list)
  // ============================
  case ST_SCHEDULE_ZONE: {
    int count = 5; // ENABLE + 4 slots
    if (encoderDelta != 0) {
      menuIdx += encoderDelta;
      adjustScroll(count, 3);
      lcdDirty = true;
    }
    if (shortPress) {
      beep(30);
      if (menuIdx == 0) {
        // Toggle Zone Enable
        zones[selectedZone].enabled = !zones[selectedZone].enabled;
        saveSettings();
        lcdDirty = true;
      } else {
        selectedSched = menuIdx - 1;
        pushMenu(ST_SCHEDULE_EDIT);
      }
    }
  } break;

  // ============================
  //  SCHEDULE EDIT
  // ============================
  case ST_SCHEDULE_EDIT: {
    Schedule &sch = zones[selectedZone].schedules[selectedSched];
    const int FIELD_COUNT = 6;

    if (!editing) {
      if (encoderDelta != 0) {
        menuIdx += encoderDelta;
        adjustScroll(FIELD_COUNT, 3);
        lcdDirty = true;
      }
      if (shortPress) {
        beep(30);
        switch (menuIdx) {
          case 0: sch.enabled = !sch.enabled; lcdDirty = true; break; // Toggle enable
          case 1: editing = true; editValue = sch.hour; lcdDirty = true; break;
          case 2: editing = true; editValue = sch.minute; lcdDirty = true; break;
          case 3: editing = true; editValue = sch.duration; lcdDirty = true; break;
          case 4: // Day select
            daySelectValue = sch.days;
            pushMenu(ST_DAY_SELECT);
            break;
          case 5: // SAVE & BACK
            saveSettings();
            popMenu();
            break;
        }
      }
    } else {
      if (encoderDelta != 0) {
        editValue += encoderDelta;
        if (menuIdx == 1) editValue = (editValue + 24) % 24;       // Hour
        if (menuIdx == 2) editValue = (editValue + 60) % 60;       // Minute
        if (menuIdx == 3) editValue = constrain(editValue, 1, 120); // Duration
        lcdDirty = true;
      }
      if (shortPress) {
        // บันทึกค่า
        if (menuIdx == 1) sch.hour     = editValue;
        if (menuIdx == 2) sch.minute   = editValue;
        if (menuIdx == 3) sch.duration = editValue;
        editing = false;
        lcdDirty = true;
        beep(30);
      }
    }
  } break;

  // ============================
  //  DAY SELECT
  // ============================
  case ST_DAY_SELECT: {
    int count = 9; // 7 days + ALL ON + SAVE
    if (encoderDelta != 0) {
      menuIdx += encoderDelta;
      adjustScroll(count, 3);
      lcdDirty = true;
    }
    if (shortPress) {
      beep(30);
      if (menuIdx < 7) {
        // Toggle day
        daySelectValue ^= (1 << menuIdx);
        lcdDirty = true;
      } else if (menuIdx == 7) {
        // ALL ON
        daySelectValue = 0x7F;
        lcdDirty = true;
      } else {
        // SAVE & BACK
        zones[selectedZone].schedules[selectedSched].days = daySelectValue;
        popMenu();
      }
    }
  } break;

  // ============================
  //  MOISTURE
  // ============================
  case ST_MOISTURE: {
    if (encoderDelta != 0) {
      menuIdx += encoderDelta;
      adjustScroll(4, 3); // 3 zones + BACK
      lcdDirty = true;
    }
    if (shortPress) {
      beep(30);
      if (menuIdx < 3) {
        selectedZone = menuIdx;
        pushMenu(ST_MOISTURE_ZONE);
      } else {
        popMenu();  // < BACK
      }
    }
  } break;

  // ============================
  //  MOISTURE ZONE EDIT
  // ============================
  case ST_MOISTURE_ZONE: {
    const int FIELD_COUNT = 4;
    if (!editing) {
      if (encoderDelta != 0) {
        menuIdx += encoderDelta;
        adjustScroll(FIELD_COUNT, 3);
        lcdDirty = true;
      }
      if (shortPress) {
        beep(30);
        switch (menuIdx) {
          case 0: // MODE toggle
            zones[selectedZone].mode = (zones[selectedZone].mode + 1) % 3;
            lcdDirty = true;
            break;
          case 1: // START
            editing = true;
            editValue = zones[selectedZone].moistureStart;
            break;
          case 2: // STOP
            editing = true;
            editValue = zones[selectedZone].moistureStop;
            break;
          case 3: // SAVE
            saveSettings();
            popMenu();
            break;
        }
        lcdDirty = true;
      }
    } else {
      if (encoderDelta != 0) {
        editValue = constrain(editValue + encoderDelta, 0, 100);
        lcdDirty = true;
      }
      if (shortPress) {
        if (menuIdx == 1) zones[selectedZone].moistureStart = editValue;
        if (menuIdx == 2) zones[selectedZone].moistureStop  = editValue;
        editing = false;
        lcdDirty = true;
        beep(30);
      }
    }
  } break;

  // ============================
  //  FLOW MENU
  // ============================
  case ST_FLOW_MENU: {
    if (encoderDelta != 0) {
      menuIdx += encoderDelta;
      adjustScroll(6, 3); // 5 items + BACK
      lcdDirty = true;
    }
    if (shortPress) {
      beep(30);
      switch (menuIdx) {
        case 0: pushMenu(ST_FLOW_STATUS); break;
        case 1: pushMenu(ST_FLOW_LIMIT); break;
        case 2: pushMenu(ST_FLOW_CALIB); calibFlowStep = 0; calibFlowZone = 0; break;
        case 3: pushMenu(ST_FLOW_ALARM_SET); break;
        case 4: pushMenu(ST_FLOW_TOTAL); break;
        case 5: popMenu(); break;  // < BACK
      }
    }
  } break;

  // ============================
  //  FLOW STATUS (read-only)
  // ============================
  case ST_FLOW_STATUS: {
    lcdDirty = true;
    if (shortPress) {
      popMenu();  // กดปุ่ม = กลับ
      beep(30);
    }
  } break;

  // ============================
  //  FLOW LIMIT
  // ============================
  case ST_FLOW_LIMIT: {
    const int FIELD_COUNT = 4;
    if (!editing) {
      if (encoderDelta != 0) {
        menuIdx += encoderDelta;
        adjustScroll(FIELD_COUNT, 3);
        lcdDirty = true;
      }
      if (shortPress) {
        beep(30);
        switch (menuIdx) {
          case 0: editing = true; editValue = (int)(flowCfg.minFlow * 10); break;
          case 1: editing = true; editValue = (int)(flowCfg.maxFlow * 10); break;
          case 2: editing = true; editValue = flowCfg.flowDelay; break;
          case 3: saveSettings(); popMenu(); break;
        }
        lcdDirty = true;
      }
    } else {
      if (encoderDelta != 0) {
        editValue += encoderDelta;
        if (menuIdx == 0) editValue = constrain(editValue, 0, 200);    // 0.0-20.0
        if (menuIdx == 1) editValue = constrain(editValue, 10, 500);   // 1.0-50.0
        if (menuIdx == 2) editValue = constrain(editValue, 1, 30);     // 1-30 sec
        lcdDirty = true;
      }
      if (shortPress) {
        if (menuIdx == 0) flowCfg.minFlow   = (float)editValue / 10.0f;
        if (menuIdx == 1) flowCfg.maxFlow   = (float)editValue / 10.0f;
        if (menuIdx == 2) flowCfg.flowDelay = editValue;
        editing = false;
        lcdDirty = true;
        beep(30);
      }
    }
  } break;

  // ============================
  //  FLOW CALIBRATION
  // ============================
  case ST_FLOW_CALIB: {
    switch (calibFlowStep) {
      case 0: // Select zone
        if (encoderDelta != 0) {
          calibFlowZone = constrain(calibFlowZone + encoderDelta, 0, 3);
          lcdDirty = true;
        }
        if (shortPress) {
          // START calibration
          calibFlowStep = 1;
          noInterrupts();
          flowPulseCount = 0;
          interrupts();
          calibFlowPulses = 0;
          startZone(calibFlowZone, 600000); // 10 นาที max
          zoneState[calibFlowZone].manual = true;
          beep(100);
          lcdDirty = true;
        }
        break;

      case 1: // Running
        // อัพเดท pulse count
        noInterrupts();
        calibFlowPulses += flowPulseCount;
        flowPulseCount = 0;
        interrupts();
        lcdDirty = true;

        if (shortPress) {
          // STOP
          stopZone(calibFlowZone);
          if (calibFlowPulses > 0) {
            calibFlowStep = 2;
            calibFlowLiters = 1.0f;
          } else {
            calibFlowStep = 0; // ไม่มี pulse ให้กลับ
          }
          beep(100);
          lcdDirty = true;
        }
        break;

      case 2: // Enter liters
        if (encoderDelta != 0) {
          calibFlowLiters += encoderDelta * 0.1f;
          if (calibFlowLiters < 0.1f) calibFlowLiters = 0.1f;
          if (calibFlowLiters > 99.9f) calibFlowLiters = 99.9f;
          lcdDirty = true;
        }
        if (shortPress) {
          calibFlowStep = 3;
          menuIdx = 0;
          lcdDirty = true;
          beep(30);
        }
        break;

      case 3: // Result - SAVE/CANCEL
        if (encoderDelta != 0) {
          menuIdx = constrain(menuIdx + encoderDelta, 0, 1);
          lcdDirty = true;
        }
        if (shortPress) {
          if (menuIdx == 0) {
            // SAVE
            float newK = (float)calibFlowPulses / (calibFlowLiters * 60.0f);
            if (newK > 0.1f && newK < 100.0f) {
              flowCfg.kFactor = newK;
              saveSettings();
              beep(200);
            }
          }
          calibFlowStep = 0;
          popMenu();
        }
        break;
    }
  } break;

  // ============================
  //  FLOW ALARM SET
  // ============================
  case ST_FLOW_ALARM_SET: {
    const int FIELD_COUNT = 2;
    if (encoderDelta != 0) {
      menuIdx += encoderDelta;
      adjustScroll(FIELD_COUNT, 3);
      lcdDirty = true;
    }
    if (shortPress) {
      beep(30);
      if (menuIdx == 0) {
        flowCfg.enabled = !flowCfg.enabled;
        lcdDirty = true;
      } else {
        saveSettings();
        popMenu();
      }
    }
  } break;

  // ============================
  //  FLOW TOTAL (Reset)
  // ============================
  case ST_FLOW_TOTAL: {
    if (shortPress) {
      totalLiters = 0;
      totalPulseLogged = 0;
      beep(200);
      lcdDirty = true;
    }
  } break;

  // ============================
  //  CALIBRATION
  // ============================
  case ST_CALIBRATION: {
    if (encoderDelta != 0) {
      menuIdx += encoderDelta;
      adjustScroll(6, 3); // 5 items + BACK
      lcdDirty = true;
    }
    if (shortPress) {
      beep(30);
      switch (menuIdx) {
        case 0: case 1: case 2:
          selectedSensor = menuIdx;
          calibSoilStep = 0;
          pushMenu(ST_CALIB_SOIL);
          break;
        case 3:
          calibFlowStep = 0;
          calibFlowZone = 0;
          pushMenu(ST_FLOW_CALIB);
          break;
        case 4: // Reset all calibration to defaults
          for (int i = 0; i < NUM_SOIL_SENSORS; i++) {
            soilCal[i].dryADC = DEFAULT_DRY_ADC;
            soilCal[i].wetADC = DEFAULT_WET_ADC;
          }
          flowCfg.kFactor = DEFAULT_K_FACTOR;
          saveSettings();
          beep(200);
          lcdDirty = true;
          break;
        case 5: popMenu(); break;  // < BACK
      }
    }
  } break;

  // ============================
  //  SOIL CALIBRATION
  // ============================
  case ST_CALIB_SOIL: {
    lcdDirty = true; // อัพเดท ADC สด

    switch (calibSoilStep) {
      case 0: // กดเพื่อ SET DRY
        if (shortPress) {
          calibSoilDry = soilRawADC[selectedSensor];
          calibSoilStep = 1;
          beep(100);
        }
        break;

      case 1: // กดเพื่อ SET WET
        if (shortPress) {
          calibSoilWet = soilRawADC[selectedSensor];
          calibSoilStep = 2;
          beep(100);
        }
        break;

      case 2: // Confirm
        if (shortPress) {
          calibSoilStep = 3;
          menuIdx = 0;
          beep(30);
        }
        break;

      case 3: // SAVE / CANCEL
        if (encoderDelta != 0) {
          menuIdx = constrain(menuIdx + encoderDelta, 0, 1);
          lcdDirty = true;
        }
        if (shortPress) {
          if (menuIdx == 0) {
            // SAVE
            soilCal[selectedSensor].dryADC = calibSoilDry;
            soilCal[selectedSensor].wetADC = calibSoilWet;
            saveSettings();
            beep(200);
          }
          calibSoilStep = 0;
          popMenu();
        }
        break;
    }
  } break;

  // ============================
  //  SENSOR ALARM
  // ============================
  case ST_SENSOR_ALARM: {
    if (encoderDelta != 0) {
      menuIdx += encoderDelta;
      adjustScroll(6, 3); // 5 items + BACK
      lcdDirty = true;
    }
    if (shortPress) {
      beep(30);
      switch (menuIdx) {
        case 0: alarmCfg.soilEnabled  = !alarmCfg.soilEnabled; break;
        case 1:
          pushMenu(ST_SENSOR_ALARM_EDIT);
          break;
        case 2: alarmCfg.flowEnabled  = !alarmCfg.flowEnabled; break;
        case 3: alarmCfg.rtcEnabled   = !alarmCfg.rtcEnabled; break;
        case 4: alarmCfg.sdEnabled    = !alarmCfg.sdEnabled; break;
        case 5: popMenu(); break;  // < BACK
      }
      saveSettings();
      lcdDirty = true;
    }
  } break;

  // ============================
  //  SENSOR ALARM EDIT (SHT30 thresholds)
  // ============================
  case ST_SENSOR_ALARM_EDIT: {
    const int FIELD_COUNT = 5;
    if (!editing) {
      if (encoderDelta != 0) {
        menuIdx += encoderDelta;
        adjustScroll(FIELD_COUNT, 3);
        lcdDirty = true;
      }
      if (shortPress) {
        beep(30);
        switch (menuIdx) {
          case 0: editing = true; editValue = (int)(alarmCfg.tempHigh * 10); break;
          case 1: editing = true; editValue = (int)(alarmCfg.tempLow * 10); break;
          case 2: editing = true; editValue = (int)alarmCfg.humHigh; break;
          case 3: editing = true; editValue = (int)alarmCfg.humLow; break;
          case 4: saveSettings(); popMenu(); break;
        }
        lcdDirty = true;
      }
    } else {
      if (encoderDelta != 0) {
        editValue += encoderDelta;
        if (menuIdx <= 1) editValue = constrain(editValue, -200, 800); // -20.0 ~ 80.0
        if (menuIdx >= 2) editValue = constrain(editValue, 0, 100);
        lcdDirty = true;
      }
      if (shortPress) {
        if (menuIdx == 0) alarmCfg.tempHigh = (float)editValue / 10.0f;
        if (menuIdx == 1) alarmCfg.tempLow  = (float)editValue / 10.0f;
        if (menuIdx == 2) alarmCfg.humHigh  = (float)editValue;
        if (menuIdx == 3) alarmCfg.humLow   = (float)editValue;
        editing = false;
        lcdDirty = true;
        beep(30);
      }
    }
  } break;

  // ============================
  //  SYSTEM
  // ============================
  case ST_SYSTEM: {
    if (encoderDelta != 0) {
      menuIdx += encoderDelta;
      adjustScroll(5, 3); // 4 items + BACK
      lcdDirty = true;
    }
    if (shortPress) {
      beep(30);
      if (menuIdx == 3) {
        // RESET SETTINGS
        prefs.begin("watering", false);
        prefs.clear();
        prefs.end();
        beep(500);
        ESP.restart();
      } else if (menuIdx == 4) {
        popMenu();  // < BACK
      }
    }
  } break;

  default:
    break;
  }
}

// ================================================================
//  SECTION 21: LCD UPDATE (เรียกใน loop)
// ================================================================

void updateLCD() {
  if (!lcdOK) return;

  unsigned long now = millis();
  if (now - lastLcdUpdate < LCD_UPDATE_INTERVAL) return;
  lastLcdUpdate = now;

  if (currentMenu == ST_DASHBOARD) {
    if (lcdDirty) {
      if (lcdOK) lcd.clear(); // เคลียร์หน้าจอทั้งหมดเมื่อกลับสู่หน้าแรก
      lcdDirty = false;
    }
    renderDashboard();
  } else if (currentMenu == ST_SENSOR || currentMenu == ST_FLOW_VIEW ||
             currentMenu == ST_FLOW_STATUS || currentMenu == ST_CALIB_SOIL ||
             currentMenu == ST_FLOW_CALIB) {
    // หน้าจอ real-time ต้อง update ตลอด
    renderCurrentMenu();
  } else if (lcdDirty) {
    // ไม่ใช้ lcd.clear() เพราะทำให้จอกระพริบ
    // ใช้ printPadded เติมช่องว่างเต็มบรรทัดแทน
    renderCurrentMenu();
    lcdDirty = false;
  }
}
