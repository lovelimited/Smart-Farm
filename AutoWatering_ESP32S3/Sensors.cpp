#include "Sensors.h"
#include "Globals.h"

// ================================================================
//  SECTION 9: SOIL SENSOR ADC INITIALIZATION
// ================================================================

// --- ตั้งค่า ADC สำหรับ Soil Moisture Sensor ---
void initSoilSensors() {
  // ตั้ง ADC resolution เป็น 12-bit (0-4095)
  analogReadResolution(12);

  // ตั้ง Attenuation 11dB เพื่ออ่านช่วง 0-3.3V ได้เต็ม
  // (default 0dB อ่านได้แค่ ~0-0.95V ทำให้ค่าตัน 4095)
  analogSetPinAttenuation(SOIL_PIN_1, ADC_11db);
  analogSetPinAttenuation(SOIL_PIN_2, ADC_11db);
  analogSetPinAttenuation(SOIL_PIN_3, ADC_11db);

  Serial.println(F("[SOIL] ADC configured: 12-bit, 11dB attenuation"));
}

// ================================================================
//  SECTION 8: INTERRUPT SERVICE ROUTINE
// ================================================================

// ISR สำหรับ Flow Sensor — นับ Pulse ด้วย volatile
void IRAM_ATTR flowISR() {
  flowPulseCount++;
}

// ================================================================
//  SECTION 10: SENSOR HARDWARE INITIALIZATIONS
// ================================================================

// --- เริ่ม I2C Bus ---
void initI2C() {
  pinMode(I2C_SDA, INPUT_PULLUP);
  pinMode(I2C_SCL, INPUT_PULLUP);
  Wire.begin(I2C_SDA, I2C_SCL);
  Wire.setClock(100000);
  Wire.setTimeOut(25);
  Serial.println(F("[I2C] Initialized SDA=8 SCL=9 (Pullups enabled)"));

  // I2C Scanner
  Serial.println(F("[I2C] Scanning..."));
  int foundCount = 0;
  for (uint8_t addr = 1; addr < 127; addr++) {
    Wire.beginTransmission(addr);
    if (Wire.endTransmission() == 0) {
      Serial.print(F("  Found I2C device at: 0x"));
      if (addr < 16) Serial.print("0");
      Serial.println(addr, HEX);
      foundCount++;
    }
  }
  if (foundCount == 0) {
    Serial.println(F("[I2C] No devices found. Check 3.3V/5V power, GND, and SDA/SCL wiring!"));
  }
}

// --- เริ่ม RTC DS3231 ---
void initRTC() {
  if (rtc.begin()) {
    rtcOK = true;
    DateTime now = rtc.now();
    // ปรับเวลาตามคอมไพล์เฉพาะเมื่อถ่านหมดหรือยังไม่เคยตั้งเวลา (ปี < 2024)
    if (rtc.lostPower() || now.year() < 2024) {
      Serial.println(F("[RTC] Lost power or uninitialized. Setting fallback compile time..."));
      rtc.adjust(DateTime(F(__DATE__), F(__TIME__)));
      now = rtc.now();
    }
    rtcHour   = now.hour();
    rtcMinute = now.minute();
    rtcSecond = now.second();
    rtcDay    = now.day();
    rtcMonth  = now.month();
    rtcYear   = now.year();
    rtcDow    = now.dayOfTheWeek();
    Serial.printf("[RTC] Started. Current Time: %02d:%02d:%02d %02d/%02d/%04d\n",
                  rtcHour, rtcMinute, rtcSecond, rtcDay, rtcMonth, rtcYear);
  } else {
    rtcOK = false;
    Serial.println(F("[RTC] ERROR — Automatic watering DISABLED"));
  }
}

// --- เริ่ม SHT30 ---
void initSHT30() {
  if (sht30.begin(0x44)) {
    sht30OK = true;
    Serial.println(F("[SHT30] OK at 0x44"));
  } else {
    sht30OK = false;
    Serial.println(F("[SHT30] ERROR"));
  }
}

// --- เริ่ม Flow Sensor ---
void initFlowSensor() {
  pinMode(FLOW_PIN, INPUT_PULLUP);
  attachInterrupt(digitalPinToInterrupt(FLOW_PIN), flowISR, RISING);
  lastFlowCalcTime = millis();
  Serial.println(F("[FLOW] ISR attached on GPIO4"));
}

// ================================================================
//  SECTION 11: SENSOR READING FUNCTIONS
// ================================================================

// --- อ่าน Sensor ทั้งหมดตามรอบเวลา ---
void readSensors() {
  unsigned long now = millis();

  if (now - lastSoilRead >= SOIL_READ_INTERVAL) {
    lastSoilRead = now;
    readSoilMoisture();
  }

  if (now - lastSHTRead >= SHT_READ_INTERVAL) {
    lastSHTRead = now;
    readSHT30Data();
  }

  if (now - lastRTCRead >= RTC_READ_INTERVAL) {
    lastRTCRead = now;
    updateRTC();
  }
}

// --- อ่านค่า Soil Moisture 3 ตัว แปลงเป็น % ---
void readSoilMoisture() {
  for (int i = 0; i < NUM_SOIL_SENSORS; i++) {
    uint32_t sum = 0;
    // อ่านเฉลี่ย 8 ครั้ง เพื่อลด noise
    for (int j = 0; j < 8; j++) {
      sum += analogRead(soilPins[i]);
    }
    soilRawADC[i] = sum / 8;

    // สำหรับเซ็นเซอร์ Capacitive: เมื่อดินแห้งมากหรืออยู่ในอากาศ แรงดันจะสูง (ADC 3800 - 4095)
    // ค่า ADC สูงจึงหมายถึง ความชื้น 0% (ดินแห้งมาก) ไม่ใช่ Error
    // จะถือเป็น Error เฉพาะเมื่อสายสัญญาณช็อตกราวด์/ไฟเลี้ยงหลุด (ADC <= 20) เท่านั้น
    if (soilRawADC[i] <= 20) {
      soilError[i] = true;
      soilPercent[i] = -1.0f;
    } else {
      soilError[i] = false;
      // แปลง ADC เป็น % ด้วย Calibration
      // DRY = 0%, WET = 100%
      float pct;
      if (soilCal[i].dryADC == soilCal[i].wetADC) {
        pct = 50.0f; // ป้องกัน divide by zero
      } else {
        pct = (float)(soilCal[i].dryADC - soilRawADC[i]) /
              (float)(soilCal[i].dryADC - soilCal[i].wetADC) * 100.0f;
      }
      if (pct < 0.0f)   pct = 0.0f;
      if (pct > 100.0f) pct = 100.0f;
      soilPercent[i] = pct;
    }
  }
}

// --- อ่าน SHT30 ---
void readSHT30Data() {
  // Auto-Recovery: หากเคย Error ให้พยายามเชื่อมต่อใหม่
  if (!sht30OK) {
    if (sht30.begin(0x44)) {
      sht30OK = true;
      Serial.println(F("[SHT30] Auto-recovered at 0x44"));
    } else {
      return;
    }
  }

  float t = sht30.readTemperature();
  float h = sht30.readHumidity();

  if (isnan(t) || isnan(h)) {
    sht30OK = false;
    Serial.println(F("[SHT30] Read error"));
  } else {
    temperature = t;
    humidity    = h;
    sht30OK     = true;
  }
}

// --- อัพเดทเวลาจาก RTC ---
void updateRTC() {
  if (!rtcOK) return;

  DateTime now = rtc.now();
  rtcHour   = now.hour();
  rtcMinute = now.minute();
  rtcSecond = now.second();
  rtcDay    = now.day();
  rtcMonth  = now.month();
  rtcYear   = now.year();
  rtcDow    = now.dayOfTheWeek();
}

// ================================================================
//  SECTION 12: FLOW SENSOR FUNCTIONS
// ================================================================

// --- คำนวณ Flow Rate และ Total Liters ---
void updateFlow() {
  unsigned long now = millis();
  unsigned long elapsed = now - lastFlowCalcTime;

  if (elapsed >= FLOW_CALC_INTERVAL) {
    noInterrupts();
    unsigned long pulses = flowPulseCount;
    flowPulseCount = 0;
    interrupts();

    float elapsedSec = (float)elapsed / 1000.0f;
    float frequency  = (float)pulses / elapsedSec;
    flowRate = frequency / flowCfg.kFactor;     // L/min

    // ปริมาณน้ำในช่วงนี้
    float volume = (float)pulses / (flowCfg.kFactor * 60.0f);
    totalLiters   += volume;
    sessionLiters += volume;
    totalPulseLogged += pulses;

    // บวกเข้า water used ของ zone ที่กำลังเปิด
    for (int z = 0; z < NUM_ZONES; z++) {
      if (zoneState[z].running) {
        zoneState[z].waterUsed += volume;
      }
    }

    lastFlowCalcTime = now;
  }
}
