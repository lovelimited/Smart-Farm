#include "FirebaseSync.h"
#include "Globals.h"
#include "WateringControl.h"
#include "BuzzerAlarm.h"
#include "Storage.h"

#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <WebServer.h>
#include <DNSServer.h>
#include <Preferences.h>

#define ENABLE_DATABASE
#include <FirebaseClient.h>

// ================================================================
//  FIREBASE SYNC MODULE & AP CAPTIVE PORTAL
//  Two-way sync ระหว่าง ESP32-S3 กับ Firebase Realtime Database
//  พร้อมระบบ Access Point (AP) และ Captive Portal ตั้งค่า Wi-Fi ผ่านมือถือ
// ================================================================

// --- WiFi & Firebase Objects ---
WiFiClientSecure ssl;
AsyncClientClass asyncClient(ssl);

FirebaseApp app;
RealtimeDatabase Database;
AsyncResult syncResult;

// --- AP & Captive Portal Objects ---
WebServer apServer(80);
DNSServer dnsServer;
bool apModeActive = false;
String activeSSID = "";
String activePass = "";

// --- Auth ---
NoAuth noAuth;

// --- Timing ---
unsigned long lastUploadTime    = 0;
unsigned long lastCmdCheckTime  = 0;
unsigned long lastConfigSync    = 0;
unsigned long lastWiFiCheck     = 0;
unsigned long lastHistoryUpload = 0;
#define FIREBASE_HISTORY_INTERVAL 600000UL // บันทึกประวัติลง /devices/esp32/history ทุก 10 นาที

// --- Config version tracking ---
int lastConfigVersion = -1;

// --- Connection status ---
bool firebaseReady = false;
bool wifiConnected = false;
bool needClearCommand = false;

// ================================================================
//  CAPTIVE PORTAL HTML INTERFACE (PROGMEM)
// ================================================================

static const char PORTAL_HTML[] PROGMEM = R"rawliteral(
<!DOCTYPE html>
<html lang="th">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
<title>Smart Farm - ตั้งค่า Wi-Fi</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
  body { background: #f0fdf4; color: #1e293b; padding: 16px; display: flex; justify-content: center; min-height: 100vh; align-items: center; }
  .card { background: #ffffff; max-width: 400px; width: 100%; border-radius: 24px; padding: 24px; box-shadow: 0 12px 30px -5px rgba(22,101,52,0.12); border: 1px solid #dcfce7; }
  .header { text-align: center; margin-bottom: 20px; }
  .icon-wrap { width: 56px; height: 56px; background: #dcfce7; color: #15803d; border-radius: 18px; display: inline-flex; align-items: center; justify-content: center; font-size: 28px; margin-bottom: 10px; }
  h1 { font-size: 19px; color: #0f172a; font-weight: 800; letter-spacing: -0.5px; }
  p.sub { font-size: 12px; color: #64748b; margin-top: 4px; }
  .section-title { font-size: 11px; font-weight: 700; text-transform: uppercase; color: #15803d; letter-spacing: 0.5px; margin-bottom: 8px; display: flex; justify-content: space-between; align-items: center; }
  .btn-rescan { background: none; border: none; color: #15803d; font-size: 11px; font-weight: 700; cursor: pointer; text-decoration: underline; }
  .net-list { max-height: 160px; overflow-y: auto; margin-bottom: 16px; border: 1px solid #e2e8f0; border-radius: 14px; background: #f8fafc; }
  .net-item { padding: 10px 14px; border-bottom: 1px solid #edf2f7; display: flex; justify-content: space-between; align-items: center; cursor: pointer; font-size: 13px; transition: background 0.15s; }
  .net-item:last-child { border-bottom: none; }
  .net-item:hover, .net-item:active { background: #dcfce7; }
  .net-name { font-weight: 600; color: #1e293b; }
  .net-sig { font-size: 11px; color: #64748b; }
  .form-group { margin-bottom: 14px; }
  label { display: block; font-size: 12px; font-weight: 700; color: #334155; margin-bottom: 6px; }
  input[type="text"], input[type="password"] { width: 100%; padding: 12px 14px; border: 1.5px solid #cbd5e1; border-radius: 14px; font-size: 14px; color: #0f172a; transition: all 0.2s; }
  input:focus { outline: none; border-color: #16a34a; box-shadow: 0 0 0 3px rgba(22,163,74,0.18); background: #ffffff; }
  .pass-wrapper { position: relative; }
  .toggle-btn { position: absolute; right: 12px; top: 50%; transform: translateY(-50%); background: none; border: none; font-size: 16px; cursor: pointer; color: #64748b; }
  .submit-btn { width: 100%; background: #16a34a; color: #ffffff; border: none; padding: 14px; border-radius: 14px; font-size: 15px; font-weight: 700; cursor: pointer; box-shadow: 0 4px 14px rgba(22,163,74,0.3); transition: all 0.15s; }
  .submit-btn:active { background: #15803d; transform: scale(0.98); }
  .footer { font-size: 11px; color: #64748b; text-align: center; margin-top: 16px; line-height: 1.5; }
</style>
</head>
<body>
<div class="card">
  <div class="header">
    <div class="icon-wrap">🌿</div>
    <h1>Smart Farm ESP32-S3</h1>
    <p class="sub">ตั้งค่า Wi-Fi เพื่อเชื่อมต่อกับระบบคลาวด์</p>
  </div>
  <div class="section-title">
    <span>Wi-Fi ที่ตรวจพบ (2.4 GHz)</span>
    <button type="button" class="btn-rescan" onclick="scanWifi()">🔄 ค้นหาใหม่</button>
  </div>
  <div class="net-list" id="netList">
    <div style="padding: 16px; text-align: center; font-size: 12px; color: #64748b;">กำลังค้นหา Wi-Fi รอบตัว...</div>
  </div>
  <form action="/save" method="POST">
    <div class="form-group">
      <label>ชื่อ Wi-Fi (SSID):</label>
      <input type="text" id="ssid" name="ssid" required placeholder="แตะเลือกจากรายการด้านบน">
    </div>
    <div class="form-group">
      <label>รหัสผ่าน (Password):</label>
      <div class="pass-wrapper">
        <input type="password" id="pass" name="pass" placeholder="ใส่รหัสผ่าน Wi-Fi">
        <button type="button" class="toggle-btn" onclick="togglePass()">👁</button>
      </div>
    </div>
    <button type="submit" class="submit-btn">💾 บันทึกและเชื่อมต่อ (Connect)</button>
  </form>
  <p class="footer">อุปกรณ์จะบันทึกการตั้งค่านี้ลงชิป NVS และเชื่อมต่อไปยัง Firebase อัตโนมัติ</p>
</div>
<script>
function selectNet(name) {
  document.getElementById('ssid').value = name;
  document.getElementById('pass').focus();
}
function togglePass() {
  const p = document.getElementById('pass');
  p.type = (p.type === 'password') ? 'text' : 'password';
}
function scanWifi() {
  const el = document.getElementById('netList');
  el.innerHTML = '<div style="padding:16px;text-align:center;font-size:12px;color:#64748b;">กำลังค้นหา Wi-Fi...</div>';
  fetch('/scan').then(r => r.json()).then(list => {
    if (!list || list.length === 0) {
      el.innerHTML = '<div style="padding:16px;text-align:center;font-size:12px;color:#94a3b8;">ไม่พบ Wi-Fi (สามารถกรอกเองได้)</div>';
      return;
    }
    el.innerHTML = list.map(n => `
      <div class="net-item" onclick="selectNet('${n.ssid}')">
        <span class="net-name">📶 ${n.ssid}</span>
        <span class="net-sig">${n.rssi} dBm</span>
      </div>
    `).join('');
  }).catch(() => {
    el.innerHTML = '<div style="padding:14px;text-align:center;font-size:12px;color:#94a3b8;">แตะด้านล่างเพื่อพิมพ์ชื่อ Wi-Fi เอง</div>';
  });
}
window.onload = scanWifi;
</script>
</body>
</html>
)rawliteral";

// ================================================================
//  PORTAL REQUEST HANDLERS
// ================================================================

void handlePortalScan() {
  int n = WiFi.scanNetworks(false, false);
  String json = "[";
  for (int i = 0; i < n; ++i) {
    if (WiFi.SSID(i).length() == 0) continue;
    if (json.length() > 1) json += ",";
    json += "{\"ssid\":\"" + WiFi.SSID(i) + "\",\"rssi\":" + String(WiFi.RSSI(i)) + "}";
  }
  json += "]";
  WiFi.scanDelete();
  apServer.send(200, "application/json", json);
}

void handlePortalSave() {
  String newSSID = apServer.arg("ssid");
  String newPass = apServer.arg("pass");
  newSSID.trim();
  newPass.trim();

  if (newSSID.length() == 0) {
    apServer.send(400, "text/html; charset=utf-8", "<h3>กรุณาระบุชื่อ Wi-Fi</h3><a href='/'>ย้อนกลับ</a>");
    return;
  }

  // 1. บันทึกลง Preferences (NVS Flash)
  Preferences wifiPrefs;
  wifiPrefs.begin("wifi_cfg", false);
  wifiPrefs.putString("ssid", newSSID);
  wifiPrefs.putString("pass", newPass);
  wifiPrefs.end();

  activeSSID = newSSID;
  activePass = newPass;

  String resp = F("<!DOCTYPE html><html lang='th'><head><meta charset='UTF-8'><meta name='viewport' content='width=device-width, initial-scale=1.0'>"
                  "<title>บันทึกสำเร็จ</title><style>body{font-family:sans-serif;background:#f0fdf4;padding:24px;text-align:center;color:#0f172a;}"
                  ".card{background:#fff;max-width:380px;margin:30px auto;padding:28px 20px;border-radius:20px;box-shadow:0 10px 25px rgba(0,0,0,0.06);}"
                  "h2{color:#16a34a;margin-bottom:8px;font-size:20px;}</style></head><body>"
                  "<div class='card'><h2>✅ บันทึก Wi-Fi สำเร็จ!</h2>"
                  "<p style='font-size:14px;color:#334155;margin-top:8px;'>ESP32 กำลังเชื่อมต่อไปยัง</p>"
                  "<p style='font-size:16px;font-weight:700;color:#16a34a;margin:6px 0;'>");
  resp += newSSID;
  resp += F("</p><p style='font-size:12px;color:#64748b;margin-top:14px;'>เมื่อเชื่อมต่อสำเร็จ Wi-Fi Setup นี้จะปิดตัวลงอัตโนมัติ และระบบจะเริ่มทำงานร่วมกับคลาวด์ Firebase</p></div></body></html>");
  
  apServer.send(200, "text/html; charset=utf-8", resp);

  delay(1200);

  Serial.print(F("[WIFI] Connecting to newly saved WiFi: "));
  Serial.println(activeSSID);

  WiFi.disconnect();
  WiFi.mode(WIFI_STA);
  WiFi.begin(activeSSID.c_str(), activePass.c_str());

  unsigned long startAttempt = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - startAttempt < 15000) {
    delay(250);
    Serial.print(".");
  }
  Serial.println();

  if (WiFi.status() == WL_CONNECTED) {
    wifiConnected = true;
    apModeActive = false;
    dnsServer.stop();
    apServer.stop();
    Serial.print(F("[WIFI] Connected! New IP: "));
    Serial.println(WiFi.localIP());

    beep(100);
    delay(150);
    beep(100);

    initFirebase();

    if (lcdOK) {
      lcdDirty = true;
      currentMenu = ST_DASHBOARD;
    }
  } else {
    Serial.println(F("[WIFI] Connect failed! Reverting to AP Mode..."));
    startWiFiAP();
  }
}

void handlePortalRedirect() {
  apServer.sendHeader("Location", "http://192.168.4.1/", true);
  apServer.send(302, "text/plain", "");
}

// ================================================================
//  START ACCESS POINT & CAPTIVE PORTAL
// ================================================================

void startWiFiAP() {
  apModeActive = true;
  wifiConnected = false;

  Serial.println(F("\n[WIFI] ========================================"));
  Serial.println(F("[WIFI] Starting AP Hotspot: 'SmartFarm-Setup'"));
  Serial.println(F("[WIFI] ========================================"));

  WiFi.mode(WIFI_AP_STA);
  WiFi.softAP("SmartFarm-Setup", ""); // Open network เพื่อให้เชื่อมต่อง่ายที่สุด

  IPAddress apIP = WiFi.softAPIP();
  Serial.print(F("[WIFI] AP Started! IP: "));
  Serial.println(apIP);

  // เริ่ม DNS Server พอร์ต 53 เพื่อดักทุกลิงก์
  dnsServer.start(53, "*", apIP);

  // ตั้งค่า WebServer routes
  apServer.on("/", HTTP_GET, []() {
    apServer.send_P(200, "text/html; charset=utf-8", PORTAL_HTML);
  });
  apServer.on("/save", HTTP_POST, handlePortalSave);
  apServer.on("/scan", HTTP_GET, handlePortalScan);
  // Apple / Android captive detection routes
  apServer.on("/generate_204", HTTP_GET, []() {
    apServer.send_P(200, "text/html; charset=utf-8", PORTAL_HTML);
  });
  apServer.on("/hotspot-detect.html", HTTP_GET, []() {
    apServer.send_P(200, "text/html; charset=utf-8", PORTAL_HTML);
  });
  apServer.onNotFound(handlePortalRedirect);
  apServer.begin();

  Serial.println(F("[WIFI] Captive Portal ready at http://192.168.4.1"));

  // แสดงผลบนหน้าจอ LCD
  if (lcdOK) {
    lcd.clear();
    lcd.setCursor(0, 0);
    lcd.print(F("  WIFI SETUP MODE   "));
    lcd.setCursor(0, 1);
    lcd.print(F("AP:SmartFarm-Setup  "));
    lcd.setCursor(0, 2);
    lcd.print(F("IP: 192.168.4.1     "));
    lcd.setCursor(0, 3);
    lcd.print(F("Connect with phone  "));
  }
}

// ================================================================
//  WiFi INITIALIZATION
// ================================================================

void initWiFi() {
  Serial.println(F("[WIFI] Checking saved credentials..."));

  // 1. อ่านค่าที่บันทึกไว้ใน NVS Preferences
  Preferences wifiPrefs;
  wifiPrefs.begin("wifi_cfg", true);
  activeSSID = wifiPrefs.getString("ssid", "");
  activePass = wifiPrefs.getString("pass", "");
  wifiPrefs.end();

  // 2. ถ้าใน NVS ว่าง ให้ลองใช้ค่าจาก Config.h หากมีการเปลี่ยนจาก "YOUR_WIFI_SSID"
  if (activeSSID.length() == 0 && String(WIFI_SSID) != "YOUR_WIFI_SSID" && String(WIFI_SSID).length() > 0) {
    activeSSID = WIFI_SSID;
    activePass = WIFI_PASS;
  }

  // 3. ถ้ามี SSID ให้ลองเชื่อมต่อ STA ก่อน
  if (activeSSID.length() > 0) {
    Serial.print(F("[WIFI] Connecting to: ")); Serial.println(activeSSID);
    WiFi.mode(WIFI_STA);
    WiFi.setTxPower(WIFI_POWER_17dBm); // ลดกำลังส่งเล็กน้อยเพื่อลดกระแสกระชาก ป้องกันไฟตก
    WiFi.begin(activeSSID.c_str(), activePass.c_str());

    unsigned long startAttempt = millis();
    while (WiFi.status() != WL_CONNECTED && millis() - startAttempt < 10000) {
      delay(250);
      Serial.print(".");
    }
    Serial.println();

    if (WiFi.status() == WL_CONNECTED) {
      wifiConnected = true;
      apModeActive = false;
      Serial.print(F("[WIFI] Connected! IP: "));
      Serial.println(WiFi.localIP());
      return;
    }
    Serial.println(F("[WIFI] Connect failed. Switching to AP Setup Mode..."));
  } else {
    Serial.println(F("[WIFI] No credentials saved. Switching to AP Setup Mode..."));
  }

  // 4. หากต่อไม่ได้หรือยังไม่มีการตั้งค่า Wi-Fi -> ปล่อย Hotspot ให้อัตโนมัติทันที
  startWiFiAP();
}

bool isWiFiConnected() {
  return WiFi.status() == WL_CONNECTED;
}

bool isAPMode() {
  return apModeActive;
}

void reconnectWiFi() {
  if (apModeActive) return;

  unsigned long now = millis();
  if (now - lastWiFiCheck < 30000) return; // ลอง reconnect ทุก 30 วินาที
  lastWiFiCheck = now;

  if (WiFi.status() != WL_CONNECTED) {
    Serial.println(F("[WIFI] Reconnecting..."));
    WiFi.disconnect();
    if (activeSSID.length() > 0) {
      WiFi.begin(activeSSID.c_str(), activePass.c_str());
    } else {
      WiFi.begin(WIFI_SSID, WIFI_PASS);
    }
    
    unsigned long start = millis();
    while (WiFi.status() != WL_CONNECTED && millis() - start < 5000) {
      delay(100);
    }
    
    if (WiFi.status() == WL_CONNECTED) {
      wifiConnected = true;
      Serial.println(F("[WIFI] Reconnected!"));
    } else {
      wifiConnected = false;
    }
  }
}

// ================================================================
//  FIREBASE INITIALIZATION
// ================================================================

void initFirebase() {
  if (!wifiConnected) {
    Serial.println(F("[FIREBASE] Skipped — No WiFi"));
    return;
  }

  Serial.println(F("[FIREBASE] Initializing..."));

  ssl.setInsecure(); // Skip certificate verification (สำหรับ ESP32)

  // Initialize Firebase
  initializeApp(asyncClient, app, getAuth(noAuth));

  // Set Firebase database URL
  app.getApp<RealtimeDatabase>(Database);
  Database.url(FIREBASE_DB_URL);

  firebaseReady = true;
  Serial.println(F("[FIREBASE] Ready!"));
  
  // Upload initial status
  uploadStatus();
}

// ================================================================
//  MAIN SYNC FUNCTION (เรียกใน loop)
// ================================================================

void syncFirebase() {
  // หากอยู่ในโหมด AP Setup ให้ประมวลผล WebServer + DNS
  if (apModeActive) {
    dnsServer.processNextRequest();
    apServer.handleClient();
    return;
  }

  // ถ้าไม่มี WiFi ลอง reconnect
  if (!isWiFiConnected()) {
    reconnectWiFi();
    return;
  }

  // ถ้า Firebase ยังไม่พร้อม
  if (!firebaseReady) return;

  // Process async tasks
  app.loop();
  Database.loop();

  // Round-Robin Task Scheduler: ไม่ยิง Request ชนกันใน loop เดียวกัน ป้องกัน SSL/Memory Crash & Panic
  static uint8_t syncStep = 0;
  static unsigned long lastStepTime = 0;

  if (now - lastStepTime >= 1500) { // ทำงานห่างกันอย่างน้อย 1.5 วินาทีต่อ 1 Request
    lastStepTime = now;

    if (needClearCommand) {
      needClearCommand = false;
      String clearJson = "{\"manualZone\":-1,\"manualAction\":\"none\",\"manualDuration\":10,\"resetAlarm\":false,\"timestamp\":0}";
      Database.set<object_t>(asyncClient, "/devices/esp32/commands", object_t(clearJson), syncResult);
    } else {
      switch (syncStep) {
        case 0:
          uploadStatus();       // วินาทีที่ 0, 4.5, 9 ...
          syncStep = 1;
          break;
        case 1:
          checkCommands();      // วินาทีที่ 1.5, 6, 10.5 ...
          syncStep = 2;
          break;
        case 2:
          if (now - lastConfigSync >= 10000) { // ซิงค์ config ทุก 10 วินาที
            lastConfigSync = now;
            checkConfigSync();
          } else {
            uploadStatus();
          }
          syncStep = 0;
          break;
      }
    }
  }

  // Upload telemetry snapshot ลงประวัติกราฟ ทุก 10 นาที
  if (now - lastHistoryUpload >= FIREBASE_HISTORY_INTERVAL) {
    lastHistoryUpload = now;
    uploadHistoryLog();
  }
}

// ================================================================
//  UPLOAD STATUS → Firebase
//  ส่งข้อมูล Sensor/Zone/Alarm ขึ้น Firebase
// ================================================================

void uploadStatus() {
  if (!firebaseReady) return;

  // Build JSON manually to save memory
  String json = "{";

  // --- Temperature & Humidity ---
  json += "\"temperature\":" + String(temperature, 1);
  json += ",\"humidity\":" + String(humidity, 1);

  // --- Soil Moisture ---
  json += ",\"soil\":[";
  for (int i = 0; i < NUM_SOIL_SENSORS; i++) {
    if (i > 0) json += ",";
    json += String(soilPercent[i], 1);
  }
  json += "]";

  json += ",\"soilRaw\":[";
  for (int i = 0; i < NUM_SOIL_SENSORS; i++) {
    if (i > 0) json += ",";
    json += String(soilRawADC[i]);
  }
  json += "]";

  json += ",\"soilError\":[";
  for (int i = 0; i < NUM_SOIL_SENSORS; i++) {
    if (i > 0) json += ",";
    json += soilError[i] ? "true" : "false";
  }
  json += "]";

  // --- Flow ---
  json += ",\"flow\":{";
  json += "\"rate\":" + String(flowRate, 2);
  json += ",\"total\":" + String(totalLiters, 2);
  json += ",\"session\":" + String(sessionLiters, 2);
  json += "}";

  // --- Zones ---
  json += ",\"zones\":[";
  for (int z = 0; z < NUM_ZONES; z++) {
    if (z > 0) json += ",";
    json += "{";
    json += "\"running\":" + String(zoneState[z].running ? "true" : "false");
    json += ",\"manual\":" + String(zoneState[z].manual ? "true" : "false");
    json += ",\"alarm\":" + String(zoneState[z].alarm ? "true" : "false");
    json += ",\"waterUsed\":" + String(zoneState[z].waterUsed, 2);
    json += ",\"enabled\":" + String(zones[z].enabled ? "true" : "false");
    json += ",\"mode\":" + String(zones[z].mode);
    if (zoneState[z].running) {
      unsigned long elapsed = (millis() - zoneState[z].startTime) / 1000;
      unsigned long remaining = 0;
      if (zoneState[z].durationMs / 1000 > elapsed) {
        remaining = zoneState[z].durationMs / 1000 - elapsed;
      }
      json += ",\"elapsed\":" + String(elapsed);
      json += ",\"remaining\":" + String(remaining);
    }
    json += "}";
  }
  json += "]";

  // --- Time ---
  char timeBuf[20];
  snprintf(timeBuf, sizeof(timeBuf), "%02d:%02d:%02d", rtcHour, rtcMinute, rtcSecond);
  json += ",\"time\":\"" + String(timeBuf) + "\"";

  char dateBuf[12];
  snprintf(dateBuf, sizeof(dateBuf), "%04d-%02d-%02d", rtcYear, rtcMonth, rtcDay);
  json += ",\"date\":\"" + String(dateBuf) + "\"";

  // --- Hardware Status ---
  json += ",\"hardware\":{";
  json += "\"lcd\":" + String(lcdOK ? "true" : "false");
  json += ",\"rtc\":" + String(rtcOK ? "true" : "false");
  json += ",\"sht30\":" + String(sht30OK ? "true" : "false");
  json += ",\"sd\":" + String(sdOK ? "true" : "false");
  json += ",\"wifi\":true";
  json += "}";
  json += ",\"hw\":{";
  json += "\"lcd\":" + String(lcdOK ? "true" : "false");
  json += ",\"rtc\":" + String(rtcOK ? "true" : "false");
  json += ",\"sht30\":" + String(sht30OK ? "true" : "false");
  json += ",\"sd\":" + String(sdOK ? "true" : "false");
  json += ",\"wifi\":true";
  json += "}";

  // --- Alarm ---
  json += ",\"alarm\":{";
  json += "\"active\":" + String(alarmActive ? "true" : "false");
  json += ",\"type\":" + String(lastAlarmType);
  json += ",\"message\":\"" + String(lastAlarmMsg) + "\"";
  json += ",\"zone\":" + String(lastAlarmZone);
  json += "}";

  // --- System Info ---
  json += ",\"heap\":" + String(ESP.getFreeHeap());
  json += ",\"uptime\":" + String(millis() / 1000);
  json += ",\"fw\":\"" + String(FW_VERSION) + "\"";
  json += ",\"lastSync\":" + String(millis());

  json += "}";

  // Send to Firebase
  Database.set<object_t>(asyncClient, "/devices/esp32/status", object_t(json), syncResult);
}

// ================================================================
//  CHECK COMMANDS ← Firebase
//  รับคำสั่ง Manual Control / Reset Alarm จาก Web App
// ================================================================

// Callback for async get
void commandCallback(AsyncResult &result) {
  if (!result.isResult()) return;
  if (result.isError()) return;

  String payload = result.c_str();
  if (payload == "null" || payload.length() < 3) return;

  // Parse manual zone command
  // Expected format: {"manualZone":0,"manualAction":"start","manualDuration":10,"resetAlarm":false,"timestamp":123456}
  
  // Parse manualZone
  int zoneIdx = -1;
  int mzPos = payload.indexOf("\"manualZone\":");
  if (mzPos >= 0) {
    int valStart = mzPos + 13;
    String valStr = "";
    for (int i = valStart; i < (int)payload.length(); i++) {
      char c = payload.charAt(i);
      if (c == ',' || c == '}') break;
      if (c != ' ') valStr += c;
    }
    zoneIdx = valStr.toInt();
  }

  // Parse manualAction
  String action = "none";
  int maPos = payload.indexOf("\"manualAction\":\"");
  if (maPos >= 0) {
    int valStart = maPos + 16;
    int valEnd = payload.indexOf("\"", valStart);
    if (valEnd > valStart) {
      action = payload.substring(valStart, valEnd);
    }
  }

  // Parse manualDuration
  int duration = 10; // default 10 minutes
  int mdPos = payload.indexOf("\"manualDuration\":");
  if (mdPos >= 0) {
    int valStart = mdPos + 17;
    String valStr = "";
    for (int i = valStart; i < (int)payload.length(); i++) {
      char c = payload.charAt(i);
      if (c == ',' || c == '}') break;
      if (c != ' ') valStr += c;
    }
    duration = valStr.toInt();
    if (duration <= 0) duration = 10;
    if (duration > 120) duration = 120;
  }

  // Execute manual command
  if (zoneIdx >= 0 && zoneIdx < NUM_ZONES && action != "none") {
    if (action == "start") {
      Serial.printf("[FIREBASE] Manual START Z%d for %d min\n", zoneIdx + 1, duration);
      unsigned long durMs = (unsigned long)duration * 60UL * 1000UL;
      startZone(zoneIdx, durMs);
      zoneState[zoneIdx].manual = true;
    } else if (action == "stop") {
      Serial.printf("[FIREBASE] Manual STOP Z%d\n", zoneIdx + 1);
      stopZone(zoneIdx);
    }

    // Mark for clearing in next round-robin loop (prevents async re-entrancy crash)
    needClearCommand = true;
  }

  // Parse resetAlarm
  int raPos = payload.indexOf("\"resetAlarm\":true");
  if (raPos >= 0) {
    Serial.println(F("[FIREBASE] Reset Alarm command received"));
    alarmActive = false;
    lastAlarmType = ALARM_NONE;
    lastAlarmZone = -1;
    lastAlarmMsg[0] = '\0';
    for (int z = 0; z < NUM_ZONES; z++) {
      zoneState[z].alarm = false;
    }
    lcdDirty = true;
    beep(100);

    // Mark for clearing in next round-robin loop
    needClearCommand = true;
  }
}

void checkCommands() {
  if (!firebaseReady) return;
  Database.get(asyncClient, "/devices/esp32/commands", commandCallback);
}

// ================================================================
//  CONFIG SYNC ← Firebase
//  ซิงค์ Zone Config (Schedule, Mode, Moisture) จาก Web App
// ================================================================

void configCallback(AsyncResult &result) {
  if (!result.isResult()) return;
  if (result.isError()) return;

  String payload = result.c_str();
  if (payload == "null" || payload.length() < 3) return;

  // Parse configVersion
  int cvPos = payload.indexOf("\"configVersion\":");
  if (cvPos >= 0) {
    int valStart = cvPos + 16;
    String valStr = "";
    for (int i = valStart; i < (int)payload.length(); i++) {
      char c = payload.charAt(i);
      if (c == ',' || c == '}') break;
      if (c != ' ') valStr += c;
    }
    int newVersion = valStr.toInt();
    
    if (newVersion > lastConfigVersion && lastConfigVersion >= 0) {
      Serial.printf("[FIREBASE] Config updated (v%d -> v%d), applying...\n", lastConfigVersion, newVersion);
      
      // Parse zone configs from the JSON
      // We look for zone array data
      for (int z = 0; z < NUM_ZONES; z++) {
        // Parse enabled
        String zKey = "\"z" + String(z) + "_enabled\":";
        int pos = payload.indexOf(zKey);
        if (pos >= 0) {
          int vs = pos + zKey.length();
          zones[z].enabled = (payload.substring(vs, vs + 4) == "true");
        }
        
        // Parse mode
        zKey = "\"z" + String(z) + "_mode\":";
        pos = payload.indexOf(zKey);
        if (pos >= 0) {
          int vs = pos + zKey.length();
          String valStr2 = "";
          for (int i = vs; i < (int)payload.length(); i++) {
            char c = payload.charAt(i);
            if (c == ',' || c == '}') break;
            if (c != ' ') valStr2 += c;
          }
          zones[z].mode = valStr2.toInt();
        }
        
        // Parse moisture thresholds
        zKey = "\"z" + String(z) + "_moistStart\":";
        pos = payload.indexOf(zKey);
        if (pos >= 0) {
          int vs = pos + zKey.length();
          String valStr2 = "";
          for (int i = vs; i < (int)payload.length(); i++) {
            char c = payload.charAt(i);
            if (c == ',' || c == '}') break;
            if (c != ' ') valStr2 += c;
          }
          zones[z].moistureStart = valStr2.toInt();
        }
        
        zKey = "\"z" + String(z) + "_moistStop\":";
        pos = payload.indexOf(zKey);
        if (pos >= 0) {
          int vs = pos + zKey.length();
          String valStr2 = "";
          for (int i = vs; i < (int)payload.length(); i++) {
            char c = payload.charAt(i);
            if (c == ',' || c == '}') break;
            if (c != ' ') valStr2 += c;
          }
          zones[z].moistureStop = valStr2.toInt();
        }

        // Parse schedules
        for (int s = 0; s < NUM_SCHEDULES; s++) {
          String sKey = "\"z" + String(z) + "_s" + String(s) + "_en\":";
          pos = payload.indexOf(sKey);
          if (pos >= 0) {
            int vs = pos + sKey.length();
            zones[z].schedules[s].enabled = (payload.substring(vs, vs + 4) == "true");
          }
          
          sKey = "\"z" + String(z) + "_s" + String(s) + "_h\":";
          pos = payload.indexOf(sKey);
          if (pos >= 0) {
            int vs = pos + sKey.length();
            String valStr2 = "";
            for (int i = vs; i < (int)payload.length(); i++) {
              char c = payload.charAt(i);
              if (c == ',' || c == '}') break;
              if (c != ' ') valStr2 += c;
            }
            zones[z].schedules[s].hour = valStr2.toInt();
          }
          
          sKey = "\"z" + String(z) + "_s" + String(s) + "_m\":";
          pos = payload.indexOf(sKey);
          if (pos >= 0) {
            int vs = pos + sKey.length();
            String valStr2 = "";
            for (int i = vs; i < (int)payload.length(); i++) {
              char c = payload.charAt(i);
              if (c == ',' || c == '}') break;
              if (c != ' ') valStr2 += c;
            }
            zones[z].schedules[s].minute = valStr2.toInt();
          }
          
          sKey = "\"z" + String(z) + "_s" + String(s) + "_dur\":";
          pos = payload.indexOf(sKey);
          if (pos >= 0) {
            int vs = pos + sKey.length();
            String valStr2 = "";
            for (int i = vs; i < (int)payload.length(); i++) {
              char c = payload.charAt(i);
              if (c == ',' || c == '}') break;
              if (c != ' ') valStr2 += c;
            }
            zones[z].schedules[s].duration = valStr2.toInt();
          }
          
          sKey = "\"z" + String(z) + "_s" + String(s) + "_days\":";
          pos = payload.indexOf(sKey);
          if (pos >= 0) {
            int vs = pos + sKey.length();
            String valStr2 = "";
            for (int i = vs; i < (int)payload.length(); i++) {
              char c = payload.charAt(i);
              if (c == ',' || c == '}') break;
              if (c != ' ') valStr2 += c;
            }
            zones[z].schedules[s].days = valStr2.toInt();
          }
        }
      }

      // Save to NVS
      saveSettings();
      lcdDirty = true;
      beep(50);
      Serial.println(F("[FIREBASE] Config applied & saved to NVS"));
    }
    lastConfigVersion = newVersion;
  }
}

void checkConfigSync() {
  if (!firebaseReady) return;
  Database.get(asyncClient, "/devices/esp32/config", configCallback);
}

// ================================================================
//  SEND ALARM TO FIREBASE
// ================================================================

void sendAlarmToFirebase() {
  if (!firebaseReady) return;

  String json = "{";
  json += "\"active\":true";
  json += ",\"type\":" + String(lastAlarmType);
  json += ",\"message\":\"" + String(lastAlarmMsg) + "\"";
  json += ",\"zone\":" + String(lastAlarmZone);
  
  char timeBuf[20];
  snprintf(timeBuf, sizeof(timeBuf), "%04d-%02d-%02d %02d:%02d:%02d",
           rtcYear, rtcMonth, rtcDay, rtcHour, rtcMinute, rtcSecond);
  json += ",\"timestamp\":\"" + String(timeBuf) + "\"";
  json += "}";

  Database.set<object_t>(asyncClient, "/devices/esp32/status/alarm", object_t(json), syncResult);

  // Also push to alarm history
  String histJson = json;
  Database.push<object_t>(asyncClient, "/devices/esp32/alarmHistory", object_t(histJson), syncResult);
}

// ================================================================
//  UPLOAD HISTORY LOG → /devices/esp32/history
//  ส่งข้อมูลประวัติ Sensor/Water/Flow ย้อนหลังสำหรับแสดงผลกราฟบนเว็บ
// ================================================================
void uploadHistoryLog() {
  if (!firebaseReady) return;

  String json = "{";
  char timeBuf[12];
  snprintf(timeBuf, sizeof(timeBuf), "%02d:%02d", rtcHour, rtcMinute);
  json += "\"time\":\"" + String(timeBuf) + "\"";

  char dateBuf[14];
  snprintf(dateBuf, sizeof(dateBuf), "%04d-%02d-%02d", rtcYear, rtcMonth, rtcDay);
  json += ",\"date\":\"" + String(dateBuf) + "\"";

  json += ",\"timestamp\":" + String(millis());
  json += ",\"temperature\":" + String(temperature, 1);
  json += ",\"humidity\":" + String(humidity, 1);

  json += ",\"soil\":[";
  for (int i = 0; i < NUM_SOIL_SENSORS; i++) {
    if (i > 0) json += ",";
    json += String(soilPercent[i], 1);
  }
  json += "]";

  json += ",\"waterTotal\":" + String(totalLiters, 2);
  json += ",\"flowRate\":" + String(flowRate, 2);
  json += "}";

  Database.push<object_t>(asyncClient, "/devices/esp32/history", object_t(json), syncResult);
  Serial.println(F("[FIREBASE] Telemetry log saved to /devices/esp32/history"));
}
