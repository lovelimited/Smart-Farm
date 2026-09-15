#include "FirebaseSync.h"
#include "Globals.h"
#include "WateringControl.h"
#include "BuzzerAlarm.h"
#include "Storage.h"

#include <WiFi.h>
#include <WiFiClientSecure.h>

#define ENABLE_DATABASE
#include <FirebaseClient.h>

// ================================================================
//  FIREBASE SYNC MODULE
//  Two-way sync ระหว่าง ESP32-S3 กับ Firebase Realtime Database
// ================================================================

// --- WiFi & Firebase Objects ---
WiFiClientSecure ssl;
AsyncClientClass asyncClient(ssl);

FirebaseApp app;
RealtimeDatabase Database;
AsyncResult syncResult;

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

// ================================================================
//  WiFi INITIALIZATION
// ================================================================

void initWiFi() {
  Serial.println(F("[WIFI] Connecting..."));
  Serial.print(F("[WIFI] SSID: ")); Serial.println(WIFI_SSID);

  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASS);

  unsigned long startAttempt = millis();
  while (WiFi.status() != WL_CONNECTED && 
         millis() - startAttempt < WIFI_CONNECT_TIMEOUT) {
    delay(250);
    Serial.print(".");
  }
  Serial.println();

  if (WiFi.status() == WL_CONNECTED) {
    wifiConnected = true;
    Serial.print(F("[WIFI] Connected! IP: "));
    Serial.println(WiFi.localIP());
  } else {
    wifiConnected = false;
    Serial.println(F("[WIFI] Connection FAILED — Firebase disabled"));
    Serial.println(F("[WIFI] System continues in offline mode"));
  }
}

bool isWiFiConnected() {
  return WiFi.status() == WL_CONNECTED;
}

void reconnectWiFi() {
  unsigned long now = millis();
  if (now - lastWiFiCheck < 30000) return; // ลอง reconnect ทุก 30 วินาที
  lastWiFiCheck = now;

  if (WiFi.status() != WL_CONNECTED) {
    Serial.println(F("[WIFI] Reconnecting..."));
    WiFi.disconnect();
    WiFi.begin(WIFI_SSID, WIFI_PASS);
    
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

  unsigned long now = millis();

  // Upload sensor status ทุก 2 วินาที
  if (now - lastUploadTime >= FIREBASE_SYNC_INTERVAL) {
    lastUploadTime = now;
    uploadStatus();
  }

  // Check commands ทุก 1 วินาที
  if (now - lastCmdCheckTime >= FIREBASE_CMD_INTERVAL) {
    lastCmdCheckTime = now;
    checkCommands();
  }

  // Sync config ทุก 5 วินาที
  if (now - lastConfigSync >= 5000) {
    lastConfigSync = now;
    checkConfigSync();
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

    // Clear the command after execution
    String clearJson = "{\"manualZone\":-1,\"manualAction\":\"none\",\"manualDuration\":10,\"resetAlarm\":false,\"timestamp\":0}";
    Database.set<object_t>(asyncClient, "/devices/esp32/commands", object_t(clearJson), syncResult);
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

    // Clear the command
    String clearJson = "{\"manualZone\":-1,\"manualAction\":\"none\",\"manualDuration\":10,\"resetAlarm\":false,\"timestamp\":0}";
    Database.set<object_t>(asyncClient, "/devices/esp32/commands", object_t(clearJson), syncResult);
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
