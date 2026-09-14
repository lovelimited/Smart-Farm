# 📖 คู่มือการทำงานและหลักการควบคุมระบบรดน้ำอัตโนมัติ ESP32-S3
**Auto Watering Control System v1.0 — Operation Manual**

---

## 1. ภาพรวมระบบ (System Overview)

ระบบนี้ถูกออกแบบมาเพื่อควบคุมการรดน้ำต้นไม้ในสวนแบบอัตโนมัติจำนวน **4 โซน (Zone 1–4)** โดยใช้ไมโครคอนโทรลเลอร์ **ESP32-S3** ประมวลผลร่วมกับเซนเซอร์วัดสภาพแวดล้อม การไหลของน้ำ และความชื้นในดิน พร้อมหน้าจอ **LCD 20x4**, ปุ่มหมุน **Rotary Encoder**, ระบบบันทึกข้อมูล **Micro SD Card** และ **NVS Flash Memory**

```text
┌─────────────────────────────────────────────────────────────────────────┐
│                        ESP32-S3 CENTRAL CONTROLLER                      │
│                                                                         │
│  [Zone 1] ─── Relay 1 (GPIO 5)  ◄── Soil Sensor 1 (GPIO 1) + Flow Meter │
│  [Zone 2] ─── Relay 2 (GPIO 6)  ◄── Soil Sensor 2 (GPIO 2) + Flow Meter │
│  [Zone 3] ─── Relay 3 (GPIO 7)  ◄── Soil Sensor 3 (GPIO 3) + Flow Meter │
│  [Zone 4] ─── Relay 4 (GPIO 18) ◄── (Timer Only)           + Flow Meter │
│                                                                         │
│  [Sensors]  : DS3231 RTC (I2C) | SHT30 Air Temp/Hum (I2C) | Flow (ISR) │
│  [UI]       : LCD 20x4 I2C (0x27/0x3F) | Rotary Encoder (CLK/DT/SW)     │
│  [Safety]   : Active Buzzer (GPIO 13) | Flow Protection | Safety Timers │
│  [Storage]  : Micro SD Card (SPI) | Preferences (NVS Non-volatile)     │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## 2. การแบ่งโซนและโหมดการทำงาน (Zones & Operating Modes)

ระบบแบ่งออกเป็น 4 โซนอิสระ โดยแต่ละโซนสามารถเลือกโหมดการทำงานได้ดังนี้:

### 2.1 คุณสมบัติของแต่ละโซน
* **Zone 1, Zone 2, Zone 3**: รองรับทั้ง **SMART Mode**, **TIMER Mode** และ **OFF**
* **Zone 4**: ทำงานแบบ **TIMER Mode Only** (เหมาะสำหรับพืชที่ไม่ต้องการเซนเซอร์ดิน หรือระบบพ่นหมอก/รดน้ำสนามหญ้า)

---

### 2.2 รายละเอียดการทำงานของแต่ละโหมด

#### 💧 โหมด 1: โหมดอัจฉริยะ (SMART Mode — เฉพาะ Zone 1-3)
* **หลักการ**: รดน้ำตามตารางเวลา **ร่วมกับ** เงื่อนไขความชื้นดินจริง
* **ลำดับการตัดสินใจ**:
  1. เมื่อถึงวันและเวลาที่ตั้งไว้ใน Schedule ระบบจะอ่านค่าความชื้นดินในโซนนั้น
  2. **ถ้าความชื้นดิน < ค่า Start %** (ดินแห้ง): วาล์วจะเปิดรดน้ำทันที
  3. **ถ้าความชื้นดิน >= ค่า Start %** (ดินยังชื้นพอ): ระบบจะ **Skip (ข้าม)** การรดน้ำในรอบนั้น เพื่อประหยัดน้ำและป้องกันรากเน่า
  4. **การหยุดรดน้ำ**: วาล์วจะปิดเมื่อ **ความชื้นดินแตะถึง Stop %** หรือ **ครบเวลา Duration สูงสุด** ที่ตั้งไว้ (อย่างใดอย่างหนึ่งถึงก่อน)

#### ⏰ โหมด 2: โหมดตั้งเวลา (TIMER Mode — โซน 1-4)
* **หลักการ**: รดน้ำตามเวลาและระยะเวลาที่กำหนด โดยไม่สนใจค่าความชื้นดิน
* **การตั้งตารางเวลา**: แต่ละโซนตั้งได้ **4 สล็อต (Slot 1–4)** โดยแต่ละสล็อตกำหนด:
  * **Enable**: เปิด/ปิด สล็อตนั้น
  * **Time**: ชั่วโมง (0–23) และ นาที (0–59)
  * **Duration**: ระยะเวลารดน้ำ (1–120 นาที)
  * **Days**: เลือกวันในสัปดาห์ (จันทร์–อาทิตย์ หรือ ทุกวัน)

#### 🖐️ โหมด 3: โหมดสั่งงานด้วยตนเอง (MANUAL Mode)
* **หลักการ**: ผู้ใช้สั่งเปิด/ปิดวาล์วผ่านหน้าจอ LCD เมนู `MANUAL` ได้ทันที
* **ระบบความปลอดภัย**: มี **Safety Timeout 30 นาที** หากเปิดวาล์วทิ้งไว้เกิน 30 นาที ระบบจะตัดวาล์วอัตโนมัติพร้อมแจ้งเตือน ป้องกันการลืมปิดน้ำ

#### ⛔ โหมด 4: โหมดปิด (OFF Mode)
* ปิดการทำงานอัตโนมัติของโซนนั้นทั้งหมด

---

## 3. ระบบความปลอดภัยและการแจ้งเตือน (Safety & Alarm Systems)

ระบบมีกลไกป้องกันความเสียหายต่อสวน ปั๊มน้ำ และท่อประปา **4 ชั้น (Quadruple Protection)**:

| ระบบความปลอดภัย | เงื่อนไขการตรวจจับ | ผลการทำงานของระบบ |
| :--- | :--- | :--- |
| **1. Flow Protection (น้ำไม่ไหล / ท่อตัน)** | เปิดวาล์วแล้วหลัง `flowDelay` วินาที อัตราการไหล **< Min Flow** (เช่น < 0.5 L/min) | • สั่งตัดวาล์วทันที<br>• ล็อคโซนนั้น (`alarm = true`) ห้ามรดน้ำซ้ำ<br>• ส่งเสียงเตือน Buzzer และขึ้น `NO FLOW` |
| **2. Flow Protection (ท่อแตก / ท่อรั่ว)** | ขณะรดน้ำ อัตราการไหล **> Max Flow** (เช่น > 30.0 L/min) | • สั่งตัดวาล์วทันที<br>• ล็อคโซนนั้น ป้องกันน้ำท่วม<br>• ส่งเสียงเตือน Buzzer และขึ้น `HIGH FLOW` |
| **3. Soil Sensor Fail-Safe** | เซนเซอร์ดินสายหลุด/ช็อต (ค่า ADC <= 10 หรือ >= 4085) | • ระงับการรดน้ำในโหมด **SMART** ทันที<br>• แจ้งเตือน `SOILx ERR` |
| **4. RTC Clock Protection** | นาฬิกา DS3231 ขัดข้องหรือ I2C หลุด | • ระงับการรดน้ำอัตโนมัติทุกโซนทันที ป้องกันเวลารดน้ำเพี้ยน |

> 🔔 **การปลดล็อค Alarm (Reset Alarm):**
> เข้าเมนู **`ALARM`** บนหน้าจอ LCD แล้วเลือก **`RESET`** ระบบจะเคลียร์สถานะล็อคของทุกโซนให้กลับมาทำงานปกติ

---

## 4. ระบบบันทึกข้อมูล (Storage & Data Logging)

### 4.1 หน่วยความจำไม่ลบเลือน (NVS Flash Preferences)
* บันทึกการตั้งค่าทั้งหมด: ตารางเวลา Schedules, ค่า % ความชื้น Start/Stop, ค่า Calibrate ดิน (Dry/Wet ADC), ค่า K-Factor และปริมาณน้ำสะสม (Total Liters)
* **ไฟดับข้อมูลไม่หาย**: เมื่อเปิดเครื่องใหม่ ระบบจะโหลดค่าเดิมกลับมาทำงานต่อได้ทันที 100%

### 4.2 การบันทึกลง Micro SD Card (`/water_log.csv`)
* บันทึกข้อมูลแบบ **ประหยัดพื้นที่ (Smart Event Logging)**:
  * บันทึก 1 บรรทัดเมื่อ: เริ่มรดน้ำ (`START`), หยุดรดน้ำ (`STOP`), หรือเกิดแจ้งเตือน (`ALARM`)
  * บันทึกทุก 1 นาที **เฉพาะขณะที่วาล์วกำลังเปิดรดน้ำอยู่เท่านั้น (`RUN`)**
* **โครงสร้างไฟล์ CSV**:
  `Date, Time, Zone, Soil%, TempC, Humid%, FlowLpm, WaterL, Relay, Status, Alarm`
* ใช้พื้นที่เพียง **~1.5 MB ต่อปี** การ์ดไม่เต็มแน่นอนตลอดอายุการใช้งาน

---

## 5. คู่มือการใช้งานหน้าจอ LCD 20x4 และปุ่ม Rotary Encoder

### 5.1 การบังคับปุ่ม Rotary Encoder
* **หมุนซ้าย / หมุนขวา**: เลื่อนเคอร์เซอร์ `>` ในเมนู หรือ เพิ่ม/ลด ตัวเลขที่กำลังตั้งค่า
* **กด 1 ครั้ง (Short Press)**: เลือกเมนู / ยืนยันค่า / เลื่อนฟิลด์ถัดไป
* **กดค้าง 1 วินาที (Long Press)**: ยกเลิกการแก้ไข / ย้อนกลับ (BACK) ไปหน้าก่อนหน้าเสมอ

---

### 5.2 แผนผังเมนูทั้งหมด (Menu Sitemap)

```text
[DASHBOARD (หน้าหลัก)] ──(กดปุ่ม)──> [MAIN MENU]
                                       ├── 1. WATERING   : เปิด/ปิด Enable แต่ละโซน (Z1-Z4)
                                       ├── 2. SETTING    : เมนูการตั้งค่าระบบ
                                       │       ├── TIME / DATE     : ตั้งเวลา, วันที่ RTC
                                       │       ├── SCHEDULE        : ตั้งเวลา 4 สล็อต (Hour, Min, Dur, Days)
                                       │       ├── MOISTURE        : ตั้งโหมด (SMART/TIMER) และ Start%/Stop%
                                       │       ├── FLOW SENSOR     : ตั้ง Min/Max Limit, K-Factor, Alarm
                                       │       ├── CALIBRATION     : คาลิเบรตดินสด (Live ADC) & คาลิเบรตน้ำ
                                       │       ├── SENSOR ALARM    : เปิด/ปิดการตรวจจับ Alarm แต่ละตัว
                                       │       └── SYSTEM          : ดู FW Version, Uptime, Factory Reset
                                       ├── 3. SENSOR     : ดูค่าเซนเซอร์สด (Temp, Hum, Soil 1-3 % & Raw ADC)
                                       ├── 4. FLOW       : ดูอัตราการไหล (L/min) และยอดน้ำสะสม (Total L)
                                       ├── 5. MANUAL     : สั่งเปิด-ปิดน้ำแมนนวล 4 โซน (Safety 30 นาที)
                                       ├── 6. ALARM      : ดูประวัติ Alarm ล่าสุด และกด RESET
                                       └── 7. < BACK     : กลับสู่หน้า Dashboard
```

---

## 6. ขั้นตอนการ Calibrate เซนเซอร์หน้างาน (Calibration Guide)

### 6.1 การ Calibrate เซนเซอร์ความชื้นดิน (Soil Calibration)
1. เข้าเมนู **`SETTING`** ➔ **`CALIBRATION`** ➔ เลือก **`SOIL Z1 / Z2 / Z3`**
2. **ขั้นตอนที่ 1 (ตั้งค่าดินแห้ง - DRY ADC)**:
   * นำเซนเซอร์เสียบในดินที่แห้งสนิท (หรือถือไว้ในอากาศ)
   * หน้าจอจะแสดง `ADC Now: xxxx` แบบ Real-time
   * เมื่อค่านิ่งแล้ว ให้ **กดปุ่ม 1 ครั้ง** เพื่อบันทึกค่า DRY
3. **ขั้นตอนที่ 2 (ตั้งค่าดินเปียก - WET ADC)**:
   * นำเซนเซอร์เสียบลงในดินที่รดน้ำชุ่ม (หรือจุ่มน้ำ)
   * เมื่อค่า `ADC Now` นิ่งแล้ว ให้ **กดปุ่ม 1 ครั้ง** เพื่อบันทึกค่า WET
4. **ขั้นตอนที่ 3**: เลือก **`SAVE`** แล้วกดปุ่ม ระบบจะคำนวณสเกล 0–100% ใหม่อย่างแม่นยำ

---

### 6.2 การ Calibrate Flow Sensor (Flow K-Factor Calibration)
1. เข้าเมนู **`SETTING`** ➔ **`CALIBRATION`** ➔ **`FLOW`**
2. เลือกโซนวาล์วที่ต้องการเปิดทดสอบ แล้วกด **`START`**
3. ใช้น้ำใส่ภาชนะตวง (เช่น ถัง 10 ลิตร) หน้าจอจะนับ Pulse การไหลจริง
4. เมื่อได้ปริมาณน้ำที่ต้องการ ให้กด **`STOP`**
5. หมุนปุ่มกรอก **ปริมาณลิตรจริง** ที่ตวงได้ (เช่น 10.0 L) แล้วกด **`OK`**
6. ระบบจะคำนวณ **K-Factor ใหม่** ให้โดยอัตโนมัติ จากนั้นเลือก **`SAVE`**

---

## 7. รายละเอียดการเชื่อมต่อขาพิน (Pinout Reference)

| อุปกรณ์ / หน้าที่ | ขา ESP32-S3 | รูปแบบการเชื่อมต่อ / สัญญาณ |
| :--- | :---: | :--- |
| **I2C SDA** (LCD, RTC DS3231, SHT30) | **GPIO 8** | I2C Data (Pull-up) |
| **I2C SCL** (LCD, RTC DS3231, SHT30) | **GPIO 9** | I2C Clock (Pull-up) |
| **Soil Moisture Sensor 1** (Zone 1) | **GPIO 1** | Analog ADC (0–4095) |
| **Soil Moisture Sensor 2** (Zone 2) | **GPIO 2** | Analog ADC (0–4095) |
| **Soil Moisture Sensor 3** (Zone 3) | **GPIO 3** | Analog ADC (0–4095) |
| **Flow Sensor** (YF-S201C) | **GPIO 4** | Digital Input Interrupt (PULLUP) |
| **Relay Valve 1** (Zone 1) | **GPIO 5** | Digital Output (Active LOW) |
| **Relay Valve 2** (Zone 2) | **GPIO 6** | Digital Output (Active LOW) |
| **Relay Valve 3** (Zone 3) | **GPIO 7** | Digital Output (Active LOW) |
| **Relay Valve 4** (Zone 4) | **GPIO 18** | Digital Output (Active LOW) |
| **Rotary Encoder CLK** | **GPIO 10** | Digital Input (PULLUP) |
| **Rotary Encoder DT** | **GPIO 11** | Digital Input (PULLUP) |
| **Rotary Encoder SW (Button)** | **GPIO 12** | Digital Input (PULLUP) |
| **Active Buzzer** | **GPIO 13** | Digital Output (Active HIGH) |
| **Micro SD SCK** | **GPIO 14** | SPI Clock (HSPI) |
| **Micro SD MISO** | **GPIO 15** | SPI MISO (HSPI) |
| **Micro SD MOSI** | **GPIO 16** | SPI MOSI (HSPI) |
| **Micro SD CS** | **GPIO 17** | SPI Chip Select |
