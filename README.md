# 🌿 Verdante Smart Farm — ระบบฟาร์มอัจฉริยะ ESP32-S3

ระบบควบคุมการรดน้ำอัตโนมัติ 4 โซนและตรวจสอบสภาพแวดล้อมสำหรับแปลงเกษตรอัจฉริยะ ทำงานร่วมกันระหว่างฮาร์ดแวร์ **ESP32-S3** และเว็บแอปพลิเคชัน **Verdante Smart Farm** (Mobile-first Web App) ผ่าน **Firebase Realtime Database** แบบสองทิศทาง

---

## ✨ คุณสมบัติหลัก (Key Features)

- 🌱 **ควบคุมการรดน้ำ 4 โซนอิสระ**: สั่งเปิด-ปิดวาล์วผ่านมือถือพร้อมตัวเลือกเวลา (5, 10, 15, 30 นาที) และระบบยืนยันผ่าน SweetAlert2
- 📊 **ติดตามเซนเซอร์แบบ Real-time**:
  - ความชื้นในดิน (Soil Moisture Analog 3 จุด) พร้อมเกจแสดงผลแบบวงกลม
  - สภาพอากาศ (อุณหภูมิและความชื้นสัมพัทธ์ SHT30 I2C)
  - อัตราการไหลของน้ำ (Water Flow Sensor Interrupt) และคำนวณปริมาตรน้ำสะสม (Liters)
- ⏰ **ตั้งเวลา & โหมดการทำงานอัจฉริยะ (Smart Schedule)**:
  - รองรับ 3 โหมด: `OFF`, `TIMER` (ตามเวลา), `SMART` (รดน้ำอัตโนมัติตามค่าความชื้นดิน)
  - กำหนดเวลาได้สูงสุด 4 ช่วงเวลาต่อโซน พร้อมเลือกวันในสัปดาห์
- 📶 **ระบบ WiFi Setup Wizard (3 ขั้นตอน)**:
  - ช่วยแนะนำผู้ใช้ในการเชื่อมต่ออุปกรณ์เข้ากับเครือข่าย WiFi บ้าน/ฟาร์มอย่างง่ายดาย
- ⚠️ **ระบบความปลอดภัย & แจ้งเตือน (Alarms)**:
  - ตรวจจับท่อรั่ว/น้ำไม่ไหล (Flow Error), เซนเซอร์ขัดข้อง, อุณหภูมิผิดปกติ
  - บันทึกประวัติลง MicroSD Card (CSV) และส่งการแจ้งเตือนขึ้น Firebase ทันที
  - สามารถสั่ง Reset Alarm ผ่านหน้าเว็บได้

---

## 📁 โครงสร้างโปรเจกต์ (Project Structure)

```text
├── AutoWatering_ESP32S3/     # โค้ดเฟิร์มแวร์ ESP32-S3 (Arduino C++)
│   ├── AutoWatering_ESP32S3.ino # Main Sketch
│   ├── Config.h              # การกำหนดขา GPIO และค่าเชื่อมต่อ WiFi/Firebase
│   ├── FirebaseSync.h/.cpp   # โมดูลรับ-ส่งข้อมูล Realtime กับ Firebase
│   ├── WateringControl.h/.cpp# ตรรกะควบคุมวาล์วและโหมดรดน้ำ
│   ├── DisplayMenu.h/.cpp    # หน้าจอ LCD 2004 และ Rotary Encoder
│   ├── Sensors.h/.cpp        # การอ่านค่า SHT30, Soil Moisture, Flow Sensor
│   ├── BuzzerAlarm.h/.cpp    # เสียงสัญญาณเตือน Buzzer
│   ├── Storage.h/.cpp        # การบันทึกค่าลง NVS และ MicroSD Card
│   └── Globals.h/.cpp        # ตัวแปรสถานะส่วนกลาง
├── webapp/                   # เว็บแอปพลิเคชันสำหรับควบคุมผ่านมือถือ
│   ├── index.html            # โครงสร้าง UI (Verdante Theme + Tailwind + SweetAlert2)
│   ├── index.css             # ระบบสีโทนธรรมชาติและ Animation
│   ├── app.js                # จัดการ Realtime Data, Commands, WiFi Wizard
│   ├── manifest.json         # PWA Manifest สำหรับติดตั้งลงหน้าจอมือถือ
│   └── sw.js                 # Service Worker แคชไฟล์
├── vercel.json               # สำหรับ Deploy ขึ้น Vercel
└── README.md
```

---

## 🛠 ข้อมูลการเชื่อมต่อ Firebase

- **Database URL**: `https://smart-farm-esp32-5e482-default-rtdb.asia-southeast1.firebasedatabase.app`
- **Project ID**: `smart-farm-esp32-5e482`
