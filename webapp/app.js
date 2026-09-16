/* ================================================================
   🌿 Verdante Smart Farm — Auto Watering & Monitoring System
   Firebase Realtime Database + Tailwind + Chart.js + SweetAlert2
   ================================================================ */

// ================================================================
//  FIREBASE CONFIGURATION (Verdante Smart Farm)
// ================================================================
const firebaseConfig = {
  apiKey: "AIzaSyBMKH9oG2DbhSZtIsN9d7iRfryHRkiUqRE",
  authDomain: "smart-farm-esp32-5e482.firebaseapp.com",
  databaseURL: "https://smart-farm-esp32-5e482-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "smart-farm-esp32-5e482",
  storageBucket: "smart-farm-esp32-5e482.firebasestorage.app",
  messagingSenderId: "146240176005",
  appId: "1:146240176005:web:b87a79943ec53090a70eec"
};

// Initialize Firebase (Safely check if already initialized)
let app;
if (!firebase.apps.length) {
  app = firebase.initializeApp(firebaseConfig);
} else {
  app = firebase.app();
}

// Anonymous Authentication to satisfy auth rules if enabled
if (firebase.auth) {
  firebase.auth().signInAnonymously()
    .then(() => {
      console.log('[Firebase Auth] Anonymous sign-in successful');
    })
    .catch((err) => {
      console.warn('[Firebase Auth] Anonymous sign-in warning:', err.message);
    });
}

const db = firebase.database();
const statusRef = db.ref('devices/esp32/status');
const commandRef = db.ref('devices/esp32/commands');
const configRef = db.ref('devices/esp32/config');
const alarmHistoryRef = db.ref('devices/esp32/alarmHistory');
const wifiConfigRef = db.ref('devices/esp32/wifi_config');
const historyRef = db.ref('devices/esp32/history');

// ================================================================
//  APPLICATION STATE
// ================================================================
let state = {
  connected: false,
  currentTab: 'pageDashboard',
  selectedZone: 0,
  lastData: null,
  configData: null,
  activeDurations: [10, 10, 10, 10], // default duration in minutes for each zone
  zoneModes: [1, 1, 2, 0], // 0: OFF, 1: MANUAL, 2: AUTO
  zoneSchedules: {
    0: [{ enabled: true, hour: 6, minute: 0, duration: 10, days: 127 }],
    1: [{ enabled: true, hour: 7, minute: 30, duration: 15, days: 127 }],
    2: [{ enabled: true, hour: 17, minute: 0, duration: 12, days: 127 }],
    3: [{ enabled: false, hour: 12, minute: 0, duration: 5, days: 127 }]
  },
  wizardStep: 1,
  chartMetric: 'env', // 'env' | 'soil' | 'water'
  chartRange: '24h',   // '24h' | '7d'
  firebaseHistory: [], // Real historical records from Firebase
  lastHistoryRecordTime: 0
};

const DEFAULT_ZONE_NAMES = [
  'Zone 1 (แปลงผักสลัด)',
  'Zone 2 (แปลงเมลอน)',
  'Zone 3 (แปลงมะเขือเทศ)',
  'Zone 4 (ระบบพ่นหมอก)'
];
const DEFAULT_ZONE_SHORT_NAMES = ['Zone 1', 'Zone 2', 'Zone 3', 'Zone 4'];

// Load customized zone names from localStorage or default
state.customZoneNames = (() => {
  try {
    const saved = localStorage.getItem('verdante_custom_zone_names');
    if (saved) return JSON.parse(saved);
  } catch (e) {}
  return [...DEFAULT_ZONE_NAMES];
})();

function getZoneName(z) {
  return state.customZoneNames?.[z] || DEFAULT_ZONE_NAMES[z] || `Zone ${z + 1}`;
}

function getZoneShortName(z) {
  if (state.customZoneNames?.[z]) {
    const n = state.customZoneNames[z];
    if (n.length <= 16) return n;
    return n.substring(0, 14) + '...';
  }
  return DEFAULT_ZONE_SHORT_NAMES[z] || `Zone ${z + 1}`;
}

// Transparent Backward Compatibility Proxies
const ZONE_NAMES = new Proxy(DEFAULT_ZONE_NAMES, {
  get: (target, prop) => {
    const idx = parseInt(prop);
    if (!isNaN(idx) && idx >= 0 && idx < 4) {
      return getZoneName(idx);
    }
    return target[prop];
  }
});

const ZONE_SHORT_NAMES = new Proxy(DEFAULT_ZONE_SHORT_NAMES, {
  get: (target, prop) => {
    const idx = parseInt(prop);
    if (!isNaN(idx) && idx >= 0 && idx < 4) {
      return getZoneShortName(idx);
    }
    return target[prop];
  }
});

function updateScheduleTabZoneButtons() {
  document.querySelectorAll('#schedZoneSelector button').forEach((btn) => {
    const z = parseInt(btn.dataset.zone);
    if (!isNaN(z)) {
      btn.textContent = getZoneShortName(z);
    }
  });
}

function promptRenameZone(z) {
  Swal.fire({
    title: `แก้ไขชื่อ ${DEFAULT_ZONE_SHORT_NAMES[z]}`,
    text: 'พิมพ์ชื่อแปลงที่ต้องการ (เช่น แปลงผักสลัด, แปลงไฮโดรโปนิกส์):',
    input: 'text',
    inputValue: getZoneName(z),
    showCancelButton: true,
    confirmButtonText: 'บันทึกชื่อแปลง',
    cancelButtonText: 'ยกเลิก',
    confirmButtonColor: '#15803D',
    cancelButtonColor: '#94A3B8',
    preConfirm: (name) => {
      if (!name || !name.trim()) {
        Swal.showValidationMessage('กรุณากรอกชื่อแปลง');
      }
      return name.trim();
    }
  }).then((res) => {
    if (res.isConfirmed && res.value) {
      saveCustomZoneName(z, res.value, true);
    }
  });
}

function saveCustomZoneName(z, newName, showToast = true) {
  if (!state.customZoneNames) state.customZoneNames = [...DEFAULT_ZONE_NAMES];
  state.customZoneNames[z] = newName;
  try {
    localStorage.setItem('verdante_custom_zone_names', JSON.stringify(state.customZoneNames));
  } catch (e) {}

  // Sync to Firebase RTDB
  db.ref(`devices/esp32/customZoneNames/${z}`).set(newName).catch(() => {});

  // Update UI immediately
  renderDashboardZoneCards(state.lastData?.zones || []);
  renderZoneControls(state.lastData);
  updateScheduleTabZoneButtons();
  const nameInput = document.getElementById('cfgZoneName');
  if (nameInput && state.selectedZone === z) {
    nameInput.value = newName;
  }

  if (showToast) {
    Swal.fire({
      toast: true,
      position: 'top',
      icon: 'success',
      title: `เปลี่ยนชื่อเป็น "${newName}" เรียบร้อย 🌿`,
      showConfirmButton: false,
      timer: 2000
    });
  }
}

function syncDeviceTime() {
  const now = new Date();
  const timeFormatted = now.toLocaleTimeString('th-TH');
  const dateFormatted = now.toLocaleDateString('th-TH');
  Swal.fire({
    title: 'ซิงค์เวลากับเครื่องนี้?',
    text: `ต้องการตั้งนาฬิกา RTC DS3231 ของ ESP32 ให้ตรงกับเวลานี้: ${timeFormatted} (${dateFormatted}) หรือไม่?`,
    icon: 'question',
    showCancelButton: true,
    confirmButtonText: 'ยืนยันซิงค์เวลา',
    cancelButtonText: 'ยกเลิก',
    confirmButtonColor: '#15803D',
    cancelButtonColor: '#94A3B8',
  }).then((res) => {
    if (res.isConfirmed) {
      commandRef.set({
        syncTime: true,
        year: now.getFullYear(),
        month: now.getMonth() + 1,
        day: now.getDate(),
        hour: now.getHours(),
        minute: now.getMinutes(),
        second: now.getSeconds(),
        timestamp: Date.now(),
        source: 'web_app_timesync'
      }).then(() => {
        setTimeout(() => commandRef.set(null).catch(() => {}), 2500);
        Swal.fire({
          toast: true,
          position: 'top',
          icon: 'success',
          title: `ส่งคำสั่งซิงค์เวลา ${timeFormatted} สำเร็จ ⏱️`,
          showConfirmButton: false,
          timer: 2500
        });
      }).catch((err) => {
        handleFirebaseError(err, 'syncDeviceTime');
      });
    }
  });
}

// 1-second real-time clock ticker
setInterval(() => {
  if (typeof state.lastRtcSeconds === 'number') {
    state.lastRtcSeconds = (state.lastRtcSeconds + 1) % 86400;
    const h = Math.floor(state.lastRtcSeconds / 3600);
    const m = Math.floor((state.lastRtcSeconds % 3600) / 60);
    const s = state.lastRtcSeconds % 60;
    const timeStr = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    const clockEl = document.getElementById('clockDisplay');
    if (clockEl) clockEl.textContent = timeStr;
    const dashTimeEl = document.getElementById('dashDeviceTime');
    if (dashTimeEl) dashTimeEl.textContent = timeStr;
  }
}, 1000);

const ZONE_COLORS = ['#10b981', '#0d9488', '#16a34a', '#0284c7'];
const MODE_NAMES = ['OFF', 'MANUAL', 'AUTO'];
const DAY_LABELS = ['อา', 'จ', 'อ', 'พ', 'พฤ', 'ศ', 'ส'];


// Simulated / Discovered WiFi networks
const NEARBY_WIFI_NETWORKS = [
  { ssid: 'Farm_Verdante_2.4G', signal: 95, secure: true },
  { ssid: 'Home_Greenhouse_2.4G', signal: 82, secure: true },
  { ssid: 'Smart_Agriculture_AP', signal: 68, secure: true },
  { ssid: 'IoT_Plant_Node', signal: 54, secure: true },
  { ssid: 'Office_WiFi_2.4G', signal: 45, secure: true }
];

let historicalChartInstance = null;

// ================================================================
//  ERROR & PERMISSION DENIED HANDLER
// ================================================================
function handleFirebaseError(err, actionContext) {
  console.error('[Firebase Error]', actionContext, err);
  const isPermDenied = err && (
    err.code === 'PERMISSION_DENIED' ||
    (typeof err.message === 'string' && err.message.toLowerCase().includes('permission denied'))
  );

  if (isPermDenied) {
    Swal.fire({
      icon: 'warning',
      title: 'ต้องเปิดสิทธิ์ใน Firebase Database 🔒',
      html: `
        <div class="text-left space-y-2.5 text-xs text-slate-600 mt-1">
          <p>คำสั่งถูกดำเนินการบนหน้าจอแล้ว แต่ไม่สามารถบันทึกลง Firebase ได้เนื่องจากกฎความปลอดภัยถูกล็อก (Permission Denied)</p>
          <div class="p-3 bg-slate-900 text-slate-100 rounded-xl font-mono text-[11px] leading-relaxed">
            <span class="text-slate-400">// ให้ตั้งค่าที่ Firebase Console &gt; Realtime Database &gt; Rules:</span><br>
            <span class="text-emerald-400">{\n  "rules": {\n    ".read": true,\n    ".write": true\n  }\n}</span>
          </div>
          <p class="text-[11px] text-emerald-700 bg-emerald-50 p-2 rounded-lg border border-emerald-200">
            🌿 <b>ระบบได้อัปเดตสถานะบนหน้าจอแบบจำลอง (Optimistic UI) ให้คุณทดสอบต่อได้ทันที</b>
          </p>
        </div>
      `,
      showCancelButton: true,
      confirmButtonText: 'คัดลอก Rules',
      cancelButtonText: 'เข้าใจแล้ว (ทดสอบต่อ)',
      confirmButtonColor: '#15803D',
      cancelButtonColor: '#64748B'
    }).then((result) => {
      if (result.isConfirmed) {
        const rulesText = '{\n  "rules": {\n    ".read": true,\n    ".write": true\n  }\n}';
        if (navigator.clipboard) {
          navigator.clipboard.writeText(rulesText).then(() => {
            Swal.fire({
              toast: true,
              position: 'top',
              icon: 'success',
              title: 'คัดลอก Rules เรียบร้อยแล้ว นำไปวางใน Firebase Console ได้เลย',
              showConfirmButton: false,
              timer: 2500
            });
          });
        }
      }
    });
  } else {
    Swal.fire({
      icon: 'error',
      title: 'เกิดข้อผิดพลาด',
      text: err?.message || 'ไม่สามารถส่งคำสั่งได้ กรุณาลองใหม่อีกครั้ง',
      confirmButtonColor: '#15803D'
    });
  }
}

// ================================================================
//  TAB NAVIGATION
// ================================================================
function switchTab(tabId) {
  state.currentTab = tabId;

  // Update Page Views
  document.querySelectorAll('.page-view').forEach(p => {
    p.classList.add('hidden');
    p.classList.remove('active');
  });

  const activePage = document.getElementById(tabId);
  if (activePage) {
    activePage.classList.remove('hidden');
    activePage.classList.add('active');
  }

  // Update Bottom Nav Items
  document.querySelectorAll('.nav-item').forEach(btn => {
    if (btn.dataset.target === tabId) {
      btn.classList.add('active');
      btn.classList.add('text-forest-700');
      btn.classList.remove('text-slate-400');
    } else {
      btn.classList.remove('active');
      btn.classList.remove('text-forest-700');
      btn.classList.add('text-slate-400');
    }
  });

  // If switched to dashboard, re-render chart to ensure correct canvas sizing
  if (tabId === 'pageDashboard' && historicalChartInstance) {
    setTimeout(() => {
      historicalChartInstance.resize();
    }, 50);
  }

  // Scroll to top
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

// ================================================================
//  FIREBASE REALTIME LISTENERS
// ================================================================

let lastStatusReceivedTime = 0;

// 1. Listen for device status
statusRef.on('value', (snapshot) => {
  const data = snapshot.val();
  if (!data) {
    setConnectionState(false);
    return;
  }
  lastStatusReceivedTime = Date.now();
  setConnectionState(true);
  state.lastData = data;

  // Sync zone modes if available from ESP32 (guard against UI bouncing back while command/config is pending)
  if (data.zones && Array.isArray(data.zones)) {
    data.zones.forEach((z, i) => {
      if (typeof z.mode === 'number') {
        const pending = state.pendingModeChanges?.[i];
        if (pending && (Date.now() - pending.timestamp < 8000)) {
          if (z.mode === pending.mode) {
            delete state.pendingModeChanges[i];
            state.zoneModes[i] = z.mode;
          }
          // Preserve user-selected mode during pending window
        } else {
          state.zoneModes[i] = z.mode;
        }
      }

      // If user recently clicked stop, don't let stale running=true snap back!
      const pendingStop = state.pendingStopActions?.[i];
      if (pendingStop && (Date.now() - pendingStop < 6000)) {
        if (!z.running) {
          delete state.pendingStopActions[i];
        } else {
          z.running = false;
          z.remaining = 0;
        }
      }
    });
  }

  renderDashboard(data);
  renderZoneControls(data);
  renderAlarmPage(data);
  updateHistoricalChartLive(data);
}, (error) => {
  console.warn('[Firebase] Status listen warning:', error);
  setConnectionState(false);
});

// Heartbeat Watchdog: Check every 2.5s if ESP32 hasn't published status in > 10s
setInterval(() => {
  const now = Date.now();
  if (state.connected && lastStatusReceivedTime > 0 && (now - lastStatusReceivedTime > 10000)) {
    console.warn('[Watchdog] No update from ESP32 for >10s. Device is offline/powered off.');
    setConnectionState(false);
    const clockEl = document.getElementById('clockDisplay');
    if (clockEl) clockEl.textContent = '--:--:--';
    const dashTimeEl = document.getElementById('dashDeviceTime');
    if (dashTimeEl) dashTimeEl.textContent = 'ขาดการติดต่อ';
  }
}, 2500);

// 2. Listen for Firebase network connection
db.ref('.info/connected').on('value', (snap) => {
  const isOnline = snap.val() === true;
  if (!isOnline && !state.lastData) {
    setConnectionState(false);
  }
});

// 3. Listen for Custom Zone Names
db.ref('devices/esp32/customZoneNames').on('value', (snapshot) => {
  const names = snapshot.val();
  if (names) {
    for (let i = 0; i < 4; i++) {
      if (names[i]) state.customZoneNames[i] = names[i];
    }
    try {
      localStorage.setItem('verdante_custom_zone_names', JSON.stringify(state.customZoneNames));
    } catch (e) {}
    renderDashboardZoneCards(state.lastData?.zones || []);
    renderZoneControls(state.lastData);
    updateScheduleTabZoneButtons();
    const nameInput = document.getElementById('cfgZoneName');
    if (nameInput && state.selectedZone !== undefined) {
      nameInput.value = getZoneName(state.selectedZone);
    }
  }
});

// 4. Listen for Config changes
configRef.on('value', (snapshot) => {
  const data = snapshot.val();
  if (data) {
    state.configData = data;
    // Extract schedules per zone
    if (data.zones && Array.isArray(data.zones)) {
      data.zones.forEach((z, i) => {
        if (z.schedules && Array.isArray(z.schedules) && z.schedules.length > 0) {
          // Keep only slots that are non-zero/valid
          const valid = z.schedules.filter(s => s.duration > 0 || s.enabled);
          state.zoneSchedules[i] = valid.length > 0 ? valid : z.schedules.slice(0, 1);
        }
        if (typeof z.mode === 'number') {
          state.zoneModes[i] = z.mode;
        }
      });
    }

    // Also check flat keys if present (from ESP32 firmware format)
    for (let z = 0; z < 4; z++) {
      if (typeof data[`z${z}_mode`] === 'number') {
        state.zoneModes[z] = data[`z${z}_mode`];
      }
    }

    renderDashboardZoneCards(state.lastData?.zones || []);
    renderZoneControls(state.lastData);
    if (state.currentTab === 'pageSchedules') {
      renderScheduleSlots(state.selectedZone);
    }

    renderScheduleSettings();
  }
});

// 4. Listen for Alarm history
alarmHistoryRef.orderByKey().limitToLast(15).on('value', (snapshot) => {
  renderAlarmHistory(snapshot.val());
});

// 5. Listen for Historical Telemetry Log (Real data from ESP32)
historyRef.limitToLast(300).on('value', (snapshot) => {
  const val = snapshot.val();
  if (val) {
    state.firebaseHistory = Object.values(val);
    if (state.currentTab === 'pageDashboard') {
      initHistoricalChart();
    }
  } else {
    state.firebaseHistory = [];
    if (state.currentTab === 'pageDashboard') {
      initHistoricalChart();
    }
  }
});

// ================================================================
//  CONNECTION STATE HANDLER
// ================================================================
function setConnectionState(connected) {
  state.connected = connected;
  const dot = document.getElementById('connDot');
  const text = document.getElementById('connText');
  const banner = document.getElementById('offlineBanner');
  const clockEl = document.getElementById('clockDisplay');

  if (connected) {
    if (dot) dot.className = 'w-2 h-2 rounded-full bg-emerald-500 animate-pulse';
    if (text) {
      text.textContent = 'ออนไลน์';
      text.className = 'font-semibold text-emerald-700';
    }
    if (clockEl) {
      clockEl.className = 'font-mono text-[11px] font-semibold text-emerald-800 bg-emerald-50 px-1.5 py-0.5 rounded border border-emerald-200/60';
    }
    if (banner) banner.classList.add('hidden');
  } else {
    if (dot) dot.className = 'w-2 h-2 rounded-full bg-slate-300';
    if (text) {
      text.textContent = 'ออฟไลน์ (ขาดการเชื่อมต่อ)';
      text.className = 'font-medium text-slate-500';
    }
    if (clockEl) {
      clockEl.className = 'font-mono text-[11px] text-slate-400 bg-slate-100 px-1.5 py-0.5 rounded';
      clockEl.textContent = '--:--:--';
    }
    if (banner) banner.classList.remove('hidden');
  }
}

// ================================================================
//  DASHBOARD RENDERING
// ================================================================
function renderDashboard(data) {
  if (!data) return;

  // Auto-record telemetry snapshot for historical charts
  recordTelemetrySnapshot(data);

  // Clock & Date (from RTC DS3231)
  if (data.time) {
    const parts = data.time.split(':').map(Number);
    if (parts.length === 3 && !isNaN(parts[0])) {
      state.lastRtcSeconds = parts[0] * 3600 + parts[1] * 60 + parts[2];
    }
    const clockEl = document.getElementById('clockDisplay');
    if (clockEl) clockEl.textContent = data.time;
    const dashTimeEl = document.getElementById('dashDeviceTime');
    if (dashTimeEl) dashTimeEl.textContent = data.time;
  }
  if (data.date) {
    const dashDateEl = document.getElementById('dashDeviceDate');
    if (dashDateEl) dashDateEl.textContent = `(${data.date})`;
  }

  // FW Badge
  if (data.fw) {
    const fwEl = document.getElementById('fwBadge');
    if (fwEl) fwEl.textContent = 'FW v' + data.fw;
  }

  // Flow rate & totals
  if (data.flow) {
    const flowRateEl = document.getElementById('dashFlowRate');
    const flowTotalEl = document.getElementById('dashFlowTotal');
    if (flowRateEl) flowRateEl.textContent = (data.flow.rate ?? 0).toFixed(2);
    if (flowTotalEl) flowTotalEl.textContent = (data.flow.total ?? 0).toFixed(2);
  }

  // Temperature
  const temp = data.temperature;
  const valTempEl = document.getElementById('valTemp');
  const barTempEl = document.getElementById('barTemp');
  if (typeof temp === 'number') {
    if (valTempEl) valTempEl.textContent = temp.toFixed(1);
    const pct = Math.min(100, Math.max(0, (temp / 45) * 100));
    if (barTempEl) barTempEl.style.width = `${pct}%`;
  } else {
    if (valTempEl) valTempEl.textContent = '--.-';
    if (barTempEl) barTempEl.style.width = '0%';
  }

  // Humidity
  const hum = data.humidity;
  const valHumEl = document.getElementById('valHumid');
  const barHumEl = document.getElementById('barHumid');
  if (typeof hum === 'number') {
    if (valHumEl) valHumEl.textContent = hum.toFixed(1);
    if (barHumEl) barHumEl.style.width = `${Math.min(100, hum)}%`;
  } else {
    if (valHumEl) valHumEl.textContent = '--.-';
    if (barHumEl) barHumEl.style.width = '0%';
  }

  // Soil Moisture Gauges (Zones 0, 1, 2)
  const soils = data.soil || [];
  const soilErrors = data.soilError || [];
  const circumference = 2 * Math.PI * 42; // ~264

  for (let i = 0; i < 3; i++) {
    const val = soils[i];
    const err = soilErrors[i] || val === -1 || val === null || val === undefined;
    const gaugeEl = document.getElementById(`soilGauge${i}`);
    const valEl = document.getElementById(`valSoil${i}`);
    const unitEl = document.getElementById(`unitSoil${i}`);
    const statusEl = document.getElementById(`soilStatus${i}`);

    if (err) {
      if (valEl) valEl.textContent = 'ERR';
      if (unitEl) unitEl.style.display = 'none';
      if (gaugeEl) gaugeEl.setAttribute('stroke-dasharray', `0 ${circumference}`);
      if (statusEl) {
        statusEl.textContent = 'ไม่ได้ต่อเซนเซอร์';
        statusEl.className = 'text-[10px] text-rose-500 font-semibold';
      }
    } else {
      if (unitEl) unitEl.style.display = 'inline';
      const pct = typeof val === 'number' ? Math.max(0, Math.min(100, val)) : 0;
      if (valEl) valEl.textContent = typeof val === 'number' ? val.toFixed(0) : '--';
      const dash = (pct / 100) * circumference;
      if (gaugeEl) gaugeEl.setAttribute('stroke-dasharray', `${dash} ${circumference}`);
      
      if (statusEl) {
        if (pct < 30) {
          statusEl.textContent = 'ดินแห้ง';
          statusEl.className = 'text-[10px] text-amber-600 font-medium';
        } else if (pct > 70) {
          statusEl.textContent = 'ดินชุ่มชื้นสูง';
          statusEl.className = 'text-[10px] text-emerald-700 font-medium';
        } else {
          statusEl.textContent = 'ความชื้นพอเหมาะ';
          statusEl.className = 'text-[10px] text-forest-700 font-medium';
        }
      }
    }
  }

  // Dashboard Zone Mini Cards with 3-Way Mode Control
  renderDashboardZoneCards(data.zones || []);
}

// Render Dashboard Zone Mini Cards with 3-Mode Segmented Control
function renderDashboardZoneCards(zones) {
  const container = document.getElementById('dashZoneCards');
  if (!container) return;

  container.innerHTML = '';

  for (let z = 0; z < 4; z++) {
    const zone = zones[z] || {};
    const isRunning = zone.running;
    const isAlarm = zone.alarm;
    const currentMode = state.zoneModes[z] ?? (zone.mode ?? 1); // 0=OFF, 1=MANUAL, 2=AUTO
    const card = document.createElement('div');
    
    card.className = `p-3.5 rounded-2xl border transition-all duration-300 flex flex-col justify-between ${
      isRunning 
        ? 'bg-emerald-50/80 border-emerald-300 shadow-sm ring-1 ring-emerald-300' 
        : 'bg-white border-slate-200/80 shadow-xs'
    }`;

    let statusBadge = '';
    if (isAlarm) {
      statusBadge = '<span class="text-[10px] font-bold px-2 py-0.5 rounded-full bg-rose-100 text-rose-700">ALARM</span>';
    } else if (isRunning) {
      statusBadge = `<span class="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-200 text-emerald-800 flex items-center gap-1">
        <span class="w-1.5 h-1.5 rounded-full bg-emerald-600 animate-ping"></span> ${currentMode === 1 ? 'MANUAL' : 'AUTO'}
      </span>`;
    } else {
      const modeLabel = currentMode === 0 ? 'OFF' : (currentMode === 1 ? 'MANUAL' : 'AUTO');
      const badgeBg = currentMode === 0 ? 'bg-slate-100 text-slate-500' : (currentMode === 1 ? 'bg-emerald-100 text-emerald-800' : 'bg-sky-100 text-sky-800');
      statusBadge = `<span class="text-[10px] font-semibold px-2 py-0.5 rounded-full ${badgeBg}">${modeLabel}</span>`;
    }

    let timerText = '';
    if (isRunning && zone.remaining !== undefined) {
      const m = Math.floor(zone.remaining / 60);
      const s = zone.remaining % 60;
      timerText = `<div class="mt-1.5 text-xs font-mono font-bold text-emerald-700 flex items-center gap-1">
        <i class="ti ti-clock"></i> เหลือ ${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}
      </div>`;
    }

    card.innerHTML = `
      <div>
        <div class="flex items-center justify-between mb-1.5">
          <div class="flex items-center gap-1 mr-1 min-w-0">
            <span class="text-xs font-bold text-slate-800 truncate" title="${getZoneName(z)}">${getZoneShortName(z)}</span>
            <button type="button" onclick="promptRenameZone(${z})" class="text-slate-300 hover:text-emerald-700 p-0.5 rounded transition shrink-0" title="เปลี่ยนชื่อแปลง">
              <i class="ti ti-edit text-[10px]"></i>
            </button>
          </div>
          ${statusBadge}
        </div>
        <div class="text-[11px] text-slate-500">ใช้น้ำ: <b class="text-slate-700 font-mono">${(zone.waterUsed ?? 0).toFixed(2)}</b> L</div>
        ${timerText}
      </div>

      <!-- 3-Mode Segmented Control [ OFF | MANUAL | AUTO ] -->
      <div class="mt-3 pt-2.5 border-t border-slate-100">
        <div class="mode-segmented">
          <button type="button" onclick="setZoneMode(${z}, 0)" class="mode-btn ${currentMode === 0 ? 'active-off' : ''}" title="ปิดการทำงาน">
            OFF
          </button>
          <button type="button" onclick="setZoneMode(${z}, 1)" class="mode-btn ${currentMode === 1 ? 'active-manual' : ''}" title="ควบคุมด้วยตนเอง">
            MANUAL
          </button>
          <button type="button" onclick="setZoneMode(${z}, 2)" class="mode-btn ${currentMode === 2 ? 'active-auto' : ''}" title="รดน้ำอัตโนมัติ">
            AUTO
          </button>
        </div>

        <!-- Quick Action Trigger -->
        <div class="mt-2 text-center">
          ${isRunning 
            ? `<button onclick="confirmStopZone(${z})" class="w-full py-1 bg-rose-50 text-rose-600 hover:bg-rose-100 rounded-lg text-[10px] font-bold transition flex items-center justify-center gap-1">
                 <i class="ti ti-player-stop text-xs"></i> หยุดรดน้ำ
               </button>`
            : currentMode === 1 
              ? `<button onclick="confirmStartZone(${z})" class="w-full py-1 bg-forest-50 text-forest-700 hover:bg-forest-100 rounded-lg text-[10px] font-bold transition flex items-center justify-center gap-1">
                   <i class="ti ti-player-play text-xs"></i> เปิดน้ำทันที
                 </button>`
              : `<span class="text-[10px] text-slate-400 block py-0.5">${currentMode === 0 ? 'วาล์วปิดสนิท' : 'พร้อมรดตามตาราง'}</span>`
          }
        </div>
      </div>
    `;

    container.appendChild(card);
  }
}

// ================================================================
//  ZONE CONTROLS PAGE (3-Way Mode Control Included)
// ================================================================
function renderZoneControls(data) {
  const container = document.getElementById('zoneControlsList');
  if (!container) return;

  const d = data || state.lastData || {
    zones: [
      { mode: 1, enabled: true, running: false, waterUsed: 0 },
      { mode: 1, enabled: true, running: false, waterUsed: 0 },
      { mode: 2, enabled: true, running: false, waterUsed: 0 },
      { mode: 0, enabled: false, running: false, waterUsed: 0 }
    ],
    soil: [45, 52, 40],
    flow: { rate: 0.0, total: 0.0 }
  };

  const zones = d.zones || [];
  container.innerHTML = '';

  for (let z = 0; z < 4; z++) {
    const zone = zones[z] || {};
    const isRunning = zone.running;
    const isAlarm = zone.alarm;
    const duration = state.activeDurations[z] || 10;
    const currentMode = state.zoneModes[z] ?? (zone.mode ?? 1); // 0=OFF, 1=MANUAL, 2=AUTO

    const card = document.createElement('div');
    card.className = `p-4 rounded-3xl border transition-all duration-300 ${
      isRunning 
        ? 'bg-emerald-50/60 border-emerald-300 shadow-md shadow-emerald-900/5 ring-1 ring-emerald-300' 
        : 'bg-white border-slate-200/80 shadow-xs'
    }`;

    // Timer display
    let timerBadge = '';
    if (isRunning && zone.remaining !== undefined) {
      const m = Math.floor(zone.remaining / 60);
      const s = zone.remaining % 60;
      timerBadge = `
        <div class="mt-3 p-2.5 rounded-2xl bg-emerald-100 text-emerald-900 flex items-center justify-between font-mono">
          <span class="text-xs font-semibold flex items-center gap-1.5"><i class="ti ti-loader animate-spin"></i> กำลังรดน้ำ</span>
          <span class="text-base font-bold">${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')} นาที</span>
        </div>
      `;
    }

    // Soil Moisture for Zone 0-2
    let soilRow = '';
    if (z < 3 && d.soil) {
      const sVal = d.soil[z];
      const sErr = d.soilError?.[z];
      soilRow = `
        <div class="bg-surface-subtle p-2 rounded-xl text-center">
          <span class="text-[10px] text-slate-400 block">ความชื้นดิน</span>
          <span class="text-xs font-bold ${sErr ? 'text-rose-500' : 'text-slate-800'}">
            ${sErr ? 'ยังไม่ต่อ' : (typeof sVal === 'number' ? sVal.toFixed(0) + '%' : '--')}
          </span>
        </div>
      `;
    }

    card.innerHTML = `
      <div class="flex items-center justify-between mb-3">
        <div class="flex items-center gap-2">
          <div class="w-9 h-9 rounded-xl ${isRunning ? 'bg-emerald-600 text-white animate-bounce' : 'bg-forest-100 text-forest-700'} flex items-center justify-center">
            <i class="ti ti-droplet text-xl"></i>
          </div>
          <div class="min-w-0">
            <div class="flex items-center gap-1.5">
              <h4 class="font-bold text-sm text-slate-900 truncate" title="${getZoneName(z)}">${getZoneName(z)}</h4>
              <button type="button" onclick="promptRenameZone(${z})" class="p-1 text-slate-400 hover:text-emerald-700 hover:bg-emerald-50 rounded-lg transition shrink-0" title="เปลี่ยนชื่อแปลงนี้">
                <i class="ti ti-edit text-xs"></i>
              </button>
            </div>
            <span class="text-[11px] text-slate-400 font-medium">โหมดปัจจุบัน: <b>${MODE_NAMES[currentMode]}</b></span>
          </div>
        </div>
        <div>
          ${isAlarm 
            ? '<span class="px-2.5 py-1 text-xs font-bold rounded-full bg-rose-100 text-rose-700">ALARM</span>' 
            : isRunning 
              ? '<span class="px-2.5 py-1 text-xs font-bold rounded-full bg-emerald-100 text-emerald-800 flex items-center gap-1"><span class="w-1.5 h-1.5 rounded-full bg-emerald-600 animate-ping"></span> กำลังรดน้ำ</span>'
              : currentMode === 0
                ? '<span class="px-2.5 py-1 text-xs font-semibold rounded-full bg-slate-100 text-slate-500">ปิด (OFF)</span>'
                : currentMode === 1
                  ? '<span class="px-2.5 py-1 text-xs font-semibold rounded-full bg-emerald-50 text-emerald-800 border border-emerald-200">แมนนวล (MANUAL)</span>'
                  : '<span class="px-2.5 py-1 text-xs font-semibold rounded-full bg-sky-50 text-sky-800 border border-sky-200">อัตโนมัติ (AUTO)</span>'
          }
        </div>
      </div>

      <!-- 3-Way Mode Segmented Selector -->
      <div class="my-2.5">
        <label class="text-[11px] font-semibold text-slate-600 block mb-1">เลือกโหมดการทำงาน:</label>
        <div class="mode-segmented">
          <button type="button" onclick="setZoneMode(${z}, 0)" class="mode-btn ${currentMode === 0 ? 'active-off' : ''}">
            <i class="ti ti-power text-xs mr-0.5"></i> OFF (ปิด)
          </button>
          <button type="button" onclick="setZoneMode(${z}, 1)" class="mode-btn ${currentMode === 1 ? 'active-manual' : ''}">
            <i class="ti ti-hand-click text-xs mr-0.5"></i> MANUAL
          </button>
          <button type="button" onclick="setZoneMode(${z}, 2)" class="mode-btn ${currentMode === 2 ? 'active-auto' : ''}">
            <i class="ti ti-robot text-xs mr-0.5"></i> AUTO (อัตโนมัติ)
          </button>
        </div>
      </div>

      <!-- Quick Metrics -->
      <div class="grid grid-cols-${z < 3 ? '3' : '2'} gap-2 my-3">
        <div class="bg-surface-subtle p-2 rounded-xl text-center">
          <span class="text-[10px] text-slate-400 block">ใช้น้ำทั้งหมด</span>
          <span class="text-xs font-bold text-slate-800 font-mono">${(zone.waterUsed ?? 0).toFixed(2)} L</span>
        </div>
        <div class="bg-surface-subtle p-2 rounded-xl text-center">
          <span class="text-[10px] text-slate-400 block">อัตราการไหล</span>
          <span class="text-xs font-bold text-slate-800 font-mono">${(d.flow?.rate ?? 0).toFixed(2)} L/m</span>
        </div>
        ${soilRow}
      </div>

      ${timerBadge}

      <!-- Dynamic Actions Based on Mode & Running State -->
      ${isRunning ? `
        <div class="mt-3 pt-3 border-t border-slate-100">
          <button onclick="confirmStopZone(${z})" class="w-full h-11 bg-rose-600 hover:bg-rose-700 text-white rounded-2xl font-semibold text-xs flex items-center justify-center gap-2 transition active:scale-[0.98] shadow-md shadow-rose-900/10">
            <i class="ti ti-player-stop text-base"></i>
            <span>หยุดรดน้ำทันที</span>
          </button>
        </div>
      ` : currentMode === 1 ? `
        <div class="mt-3 pt-3 border-t border-slate-100">
          <div class="flex items-center justify-between mb-2">
            <span class="text-xs font-semibold text-slate-600">เลือกระยะเวลารดน้ำ:</span>
            <div class="flex gap-1">
              ${[5, 10, 15, 30].map(m => `
                <button onclick="setZoneDuration(${z}, ${m})" class="px-2.5 py-1 text-xs font-semibold rounded-lg border transition ${
                  duration === m 
                    ? 'bg-forest-700 text-white border-forest-700' 
                    : 'bg-surface-subtle text-slate-600 border-slate-200 hover:bg-slate-200'
                }">${m}น.</button>
              `).join('')}
            </div>
          </div>
          <button onclick="confirmStartZone(${z})" class="w-full h-11 bg-forest-700 hover:bg-forest-800 text-white rounded-2xl font-semibold text-xs flex items-center justify-center gap-2 transition active:scale-[0.98] shadow-md shadow-forest-900/10">
            <i class="ti ti-player-play text-base"></i>
            <span>เริ่มเปิดน้ำ ${ZONE_SHORT_NAMES[z]} (${duration} นาที)</span>
          </button>
        </div>
      ` : currentMode === 2 ? `
        <div class="mt-2.5 p-3 rounded-2xl bg-sky-50 border border-sky-100 flex items-center justify-between text-xs">
          <span class="text-sky-800 font-medium flex items-center gap-1.5">
            <i class="ti ti-clock-check text-sky-600 text-base"></i> ทำงานอัตโนมัติตามตารางเวลา/ความชื้น
          </span>
          <button onclick="switchTab('pageSchedule')" class="text-sky-700 font-bold underline hover:text-sky-900">
            ตั้งเวลา
          </button>
        </div>
      ` : `
        <div class="mt-2.5 p-3 rounded-2xl bg-slate-50 border border-slate-200 text-center text-xs text-slate-500">
          <i class="ti ti-circle-off text-slate-400 mr-1"></i> โซนนี้ปิดการทำงานอยู่ (OFF) แตะ MANUAL หรือ AUTO เพื่อเปิดใช้งาน
        </div>
      `}
    `;

    container.appendChild(card);
  }
}

// 3-Mode Zone Switcher [ OFF=0, MANUAL=1, AUTO=2 ]
function setZoneMode(zoneIndex, mode) {
  state.zoneModes[zoneIndex] = mode;
  state.pendingModeChanges = state.pendingModeChanges || {};
  state.pendingModeChanges[zoneIndex] = { mode: mode, timestamp: Date.now() };

  // Sync with schedule settings page if this zone is currently viewed
  if (state.selectedZone === zoneIndex) {
    const cfgModeEl = document.getElementById('cfgZoneMode');
    if (cfgModeEl) cfgModeEl.value = mode;
    const moistBox = document.getElementById('smartMoistureBox');
    if (moistBox) {
      if (mode === 2) moistBox.classList.remove('hidden');
      else moistBox.classList.add('hidden');
    }
  }

  // Optimistic UI Update across all zone surfaces
  renderDashboardZoneCards(state.lastData?.zones || []);
  renderZoneControls(state.lastData);

  const modeLabel = MODE_NAMES[mode];
  const zoneName = ZONE_SHORT_NAMES[zoneIndex];

  // Send mode update to Firebase config with flat and nested keys + configVersion
  const newConfigVersion = Math.floor(Date.now() / 1000);
  const updates = {
    [`zones/${zoneIndex}/mode`]: mode,
    [`z${zoneIndex}_mode`]: mode,
    configVersion: newConfigVersion
  };

  configRef.update(updates).catch((err) => {
    handleFirebaseError(err, `setZoneMode(${zoneIndex}, ${mode})`);
  });

  // If set to OFF, stop the valve immediately if running and send direct command to ESP32
  if (mode === 0) {
    if (state.lastData?.zones?.[zoneIndex]) {
      state.lastData.zones[zoneIndex].running = false;
      state.lastData.zones[zoneIndex].remaining = 0;
      renderDashboardZoneCards(state.lastData.zones);
      renderZoneControls(state.lastData);
    }
    state.pendingStopActions = state.pendingStopActions || {};
    state.pendingStopActions[zoneIndex] = Date.now();

    commandRef.set({
      manualZone: zoneIndex,
      manualAction: 'stop',
      setMode: 0,
      manualDuration: 0,
      timestamp: Date.now(),
      source: 'web_app_mode_off'
    }).catch((err) => {
      handleFirebaseError(err, 'stop_valve_on_off_mode');
    });
  } else {
    // Send mode change command directly to ESP32 for immediate response
    commandRef.set({
      manualZone: zoneIndex,
      manualAction: 'none',
      setMode: mode,
      manualDuration: 0,
      timestamp: Date.now(),
      source: 'web_app_mode_change'
    }).catch(() => {});
  }

  Swal.fire({
    toast: true,
    position: 'top',
    icon: 'success',
    title: `เปลี่ยนโหมด ${zoneName} เป็น ${modeLabel} แล้ว 🌿`,
    showConfirmButton: false,
    timer: 2000
  });
}

function setZoneDuration(zoneIndex, minutes) {
  state.activeDurations[zoneIndex] = minutes;
  renderZoneControls(state.lastData);
}

// ================================================================
//  SWEETALERT2 INTERACTIVE ACTIONS
// ================================================================

// 1. Confirm Start Watering
function confirmStartZone(zoneIndex) {
  const duration = state.activeDurations[zoneIndex] || 10;
  const zoneName = ZONE_NAMES[zoneIndex];

  Swal.fire({
    title: 'ยืนยันเริ่มรดน้ำ 🌿',
    html: `
      <div class="text-left space-y-2 mt-2">
        <p class="text-xs text-slate-600">ต้องการเปิดวาล์วรดน้ำ <b>${zoneName}</b> หรือไม่?</p>
        <div class="p-3 bg-emerald-50 rounded-xl border border-emerald-200 text-xs text-emerald-800 font-medium">
          ⏱ กำหนดเวลา: <b>${duration} นาที</b>
        </div>
      </div>
    `,
    icon: 'question',
    showCancelButton: true,
    confirmButtonText: 'เปิดน้ำทันที',
    cancelButtonText: 'ยกเลิก',
    confirmButtonColor: '#15803D',
    cancelButtonColor: '#94A3B8',
    reverseButtons: true,
  }).then((result) => {
    if (result.isConfirmed) {
      sendManualCommand(zoneIndex, 'start', duration);
      Swal.fire({
        toast: true,
        position: 'top',
        icon: 'success',
        title: `ส่งคำสั่งเปิดน้ำ ${ZONE_SHORT_NAMES[zoneIndex]} สำเร็จ`,
        showConfirmButton: false,
        timer: 2500
      });
    }
  });
}

// 2. Confirm Stop Watering
function confirmStopZone(zoneIndex) {
  const zoneName = ZONE_SHORT_NAMES[zoneIndex];

  Swal.fire({
    title: 'ต้องการปิดน้ำทันที? 💧',
    text: `ยืนยันการปิดวาล์วรดน้ำ ${zoneName}`,
    icon: 'warning',
    showCancelButton: true,
    confirmButtonText: 'ปิดน้ำเดี๋ยวนี้',
    cancelButtonText: 'ทำงานต่อ',
    confirmButtonColor: '#E11D48',
    cancelButtonColor: '#94A3B8',
    reverseButtons: true,
  }).then((result) => {
    if (result.isConfirmed) {
      sendManualCommand(zoneIndex, 'stop', 0);
      Swal.fire({
        toast: true,
        position: 'top',
        icon: 'success',
        title: `ปิดน้ำ ${zoneName} เรียบร้อยแล้ว`,
        showConfirmButton: false,
        timer: 2000
      });
    }
  });
}

// 3. Send Manual Command to Firebase (with Optimistic UI & graceful permission handling)
function sendManualCommand(zone, action, duration) {
  // Optimistic UI update: update local state immediately
  if (state.lastData && state.lastData.zones && state.lastData.zones[zone]) {
    const zObj = state.lastData.zones[zone];
    if (action === 'start') {
      zObj.running = true;
      zObj.manual = true;
      zObj.remaining = duration * 60;
    } else {
      zObj.running = false;
      zObj.remaining = 0;
    }
    renderDashboardZoneCards(state.lastData.zones);
    renderZoneControls(state.lastData);
  }

  if (action === 'stop') {
    state.pendingStopActions = state.pendingStopActions || {};
    state.pendingStopActions[zone] = Date.now();
  }

  commandRef.set({
    manualZone: zone,
    manualAction: action,
    manualDuration: duration,
    timestamp: Date.now(),
    source: 'web_app'
  }).catch((err) => {
    handleFirebaseError(err, `sendManualCommand(${zone}, ${action})`);
  });
}

// ================================================================
//  SCHEDULE & CONFIGURATION PAGE (Dynamic Slots + Add/Remove Slot)
// ================================================================

// Switch Zone Tabs in Schedule Page
document.querySelectorAll('#schedZoneSelector button').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('#schedZoneSelector button').forEach(b => {
      b.className = 'flex-1 py-1.5 text-xs font-semibold rounded-xl transition-all duration-200 text-slate-600 hover:text-slate-900';
    });
    btn.className = 'flex-1 py-1.5 text-xs font-semibold rounded-xl transition-all duration-200 bg-white text-forest-800 shadow-xs active-pill';
    state.selectedZone = parseInt(btn.dataset.zone);
    renderScheduleSettings();
  });
});

function renderScheduleSettings() {
  updateScheduleTabZoneButtons();
  const z = state.selectedZone;
  const cfg = state.configData?.zones?.[z] || {
    enabled: true,
    mode: state.zoneModes[z] ?? 1,
    moistureStart: 35,
    moistureStop: 55,
  };

  // Inputs
  const nameInput = document.getElementById('cfgZoneName');
  const enabledInput = document.getElementById('cfgZoneEnabled');
  const modeInput = document.getElementById('cfgZoneMode');
  const moistBox = document.getElementById('smartMoistureBox');
  const moistStartInput = document.getElementById('cfgMoistStart');
  const moistStopInput = document.getElementById('cfgMoistStop');

  if (nameInput) nameInput.value = getZoneName(z);
  if (enabledInput) enabledInput.checked = !!cfg.enabled;
  if (modeInput) modeInput.value = state.zoneModes[z] ?? (cfg.mode ?? 1);
  if (moistStartInput) moistStartInput.value = cfg.moistureStart ?? 35;
  if (moistStopInput) moistStopInput.value = cfg.moistureStop ?? 55;

  if (moistBox) {
    if (parseInt(modeInput.value) === 2) {
      moistBox.classList.remove('hidden');
    } else {
      moistBox.classList.add('hidden');
    }
  }

  // Get active schedules for this zone
  if (!state.zoneSchedules[z]) {
    state.zoneSchedules[z] = [{ enabled: true, hour: 6, minute: 0, duration: 10, days: 127 }];
  }

  renderScheduleSlots(state.zoneSchedules[z]);
}

document.getElementById('cfgZoneMode')?.addEventListener('change', (e) => {
  const val = parseInt(e.target.value);
  const z = state.selectedZone;
  state.zoneModes[z] = val;
  const moistBox = document.getElementById('smartMoistureBox');
  if (moistBox) {
    if (val === 2) {
      moistBox.classList.remove('hidden');
    } else {
      moistBox.classList.add('hidden');
    }
  }
  // Immediately synchronize zone controls & dashboard cards
  renderDashboardZoneCards(state.lastData?.zones || []);
  renderZoneControls(state.lastData);
});

// Render dynamic schedule slots (Show ONLY active slots, not all 4 hardcoded)
function renderScheduleSlots(schedules) {
  const container = document.getElementById('scheduleSlotsList');
  const countBadge = document.getElementById('schedSlotCountBadge');
  const btnAdd = document.getElementById('btnAddScheduleSlot');
  if (!container) return;

  container.innerHTML = '';
  const count = schedules.length;

  if (countBadge) {
    countBadge.textContent = `${count} / 4 ช่วง`;
  }

  // Hide or disable + Add button if maximum 4 slots reached
  if (btnAdd) {
    if (count >= 4) {
      btnAdd.classList.add('opacity-50', 'pointer-events-none');
    } else {
      btnAdd.classList.remove('opacity-50', 'pointer-events-none');
    }
  }

  if (count === 0) {
    container.innerHTML = `
      <div class="p-6 text-center bg-white rounded-2xl border border-dashed border-slate-300 text-slate-400 text-xs">
        <i class="ti ti-clock-off text-2xl mb-1 block"></i>
        ยังไม่มีช่วงเวลารดน้ำ กดปุ่ม <b>"+ เพิ่มช่วงเวลารดน้ำ"</b> ด้านล่างเพื่อเพิ่ม
      </div>
    `;
    return;
  }

  schedules.forEach((sch, s) => {
    const timeStr = `${String(sch.hour).padStart(2, '0')}:${String(sch.minute).padStart(2, '0')}`;
    const card = document.createElement('div');

    card.className = 'bg-white rounded-3xl p-4 border border-slate-200/90 shadow-xs space-y-3.5 transition-all';
    card.innerHTML = `
      <!-- Slot Header: Title, Delete Button & Enable Switch -->
      <div class="flex items-center justify-between pb-2 border-b border-slate-100">
        <div class="flex items-center gap-2">
          <span class="w-6 h-6 rounded-lg bg-forest-100 text-forest-700 text-xs font-bold flex items-center justify-center">
            ${s + 1}
          </span>
          <span class="text-xs font-bold text-slate-800">
            ช่วงเวลาที่ ${s + 1}
          </span>
        </div>
        <div class="flex items-center gap-3">
          <button type="button" onclick="removeScheduleSlot(${s})" class="text-rose-500 hover:text-rose-700 text-xs font-semibold flex items-center gap-1 transition px-2 py-1 rounded-lg hover:bg-rose-50" title="ลบช่วงเวลานี้">
            <i class="ti ti-trash text-sm"></i> <span>ลบ</span>
          </button>
          <label class="relative inline-flex items-center cursor-pointer">
            <input type="checkbox" id="schEnabled_${s}" ${sch.enabled ? 'checked' : ''} onchange="updateScheduleSlotState(${s})" class="sr-only peer">
            <div class="w-9 h-5 bg-slate-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-forest-600"></div>
          </label>
        </div>
      </div>

      <!-- Time Picker & Duration Stepper (Mobile Touch Friendly) -->
      <div class="grid grid-cols-2 gap-3">
        <!-- Time Picker with Clock Icon -->
        <div>
          <label class="text-[11px] font-semibold text-slate-600 block mb-1">เวลาเริ่มรดน้ำ:</label>
          <div class="relative">
            <input type="time" id="schTime_${s}" value="${timeStr}" onchange="updateScheduleSlotState(${s})" class="w-full bg-surface-subtle border border-slate-200 rounded-xl px-3 py-2 text-xs font-bold text-slate-800 outline-none focus:ring-2 focus:ring-forest-500">
          </div>
        </div>

        <!-- Duration Stepper [-] 10 นาที [+] -->
        <div>
          <label class="text-[11px] font-semibold text-slate-600 block mb-1">ระยะเวลารด:</label>
          <div class="flex items-center gap-1.5">
            <button type="button" onclick="stepScheduleDuration(${s}, -1)" class="stepper-btn" title="ลด 1 นาที">
              -
            </button>
            <div class="flex-1 text-center bg-surface-subtle border border-slate-200 rounded-xl py-1.5">
              <span id="schDurDisplay_${s}" class="font-bold text-xs text-slate-800">${sch.duration || 10}</span>
              <span class="text-[10px] text-slate-500 ml-0.5">น.</span>
              <input type="hidden" id="schDur_${s}" value="${sch.duration || 10}">
            </div>
            <button type="button" onclick="stepScheduleDuration(${s}, 1)" class="stepper-btn" title="เพิ่ม 1 นาที">
              +
            </button>
          </div>
        </div>
      </div>

      <!-- Quick Duration Chips -->
      <div class="flex items-center gap-1.5 pt-0.5">
        <span class="text-[10px] text-slate-400">ด่วน:</span>
        ${[5, 10, 15, 20, 30].map(m => `
          <button type="button" onclick="setScheduleDuration(${s}, ${m})" class="px-2 py-0.5 text-[10px] font-semibold rounded-lg bg-slate-100 hover:bg-emerald-100 hover:text-forest-800 text-slate-600 transition">
            ${m}น.
          </button>
        `).join('')}
      </div>

      <!-- 7 Days of the Week (Touch Friendly Circular Chips) -->
      <div>
        <span class="text-[11px] font-semibold text-slate-600 block mb-1.5">ทำซ้ำในวัน:</span>
        <div class="flex items-center justify-between gap-1">
          ${DAY_LABELS.map((day, dIdx) => {
            const isDayActive = (sch.days & (1 << dIdx)) !== 0;
            return `
              <button type="button" onclick="toggleScheduleDay(${s}, ${dIdx})" id="dayBtn_${s}_${dIdx}" data-active="${isDayActive ? '1' : '0'}" class="day-chip ${isDayActive ? 'active' : 'inactive'}">
                ${day}
              </button>
            `;
          }).join('')}
        </div>
      </div>
    `;

    container.appendChild(card);
  });
}

// Add a new dynamic schedule slot (Max 4)
function addNewScheduleSlot() {
  const z = state.selectedZone;
  if (!state.zoneSchedules[z]) state.zoneSchedules[z] = [];
  
  if (state.zoneSchedules[z].length >= 4) {
    Swal.fire({
      icon: 'info',
      title: 'ครบ 4 ช่วงเวลาแล้ว',
      text: 'แต่ละโซนรองรับการตั้งเวลาอัตโนมัติสูงสุด 4 ช่วงเวลาครับ',
      confirmButtonColor: '#15803D'
    });
    return;
  }

  // Suggest intelligent default time based on slot index
  const defaults = [
    { hour: 6, minute: 0 },
    { hour: 11, minute: 30 },
    { hour: 17, minute: 0 },
    { hour: 20, minute: 0 }
  ];
  const nextIdx = state.zoneSchedules[z].length;
  const def = defaults[nextIdx] || { hour: 8, minute: 0 };

  state.zoneSchedules[z].push({
    enabled: true,
    hour: def.hour,
    minute: def.minute,
    duration: 10,
    days: 127 // all 7 days by default
  });

  renderScheduleSlots(state.zoneSchedules[z]);

  Swal.fire({
    toast: true,
    position: 'top',
    icon: 'success',
    title: `เพิ่มช่วงเวลารดน้ำที่ ${state.zoneSchedules[z].length} แล้ว 🌿`,
    showConfirmButton: false,
    timer: 1800
  });
}

// Remove a dynamic schedule slot
function removeScheduleSlot(slotIndex) {
  const z = state.selectedZone;
  if (!state.zoneSchedules[z]) return;

  state.zoneSchedules[z].splice(slotIndex, 1);
  renderScheduleSlots(state.zoneSchedules[z]);

  Swal.fire({
    toast: true,
    position: 'top',
    icon: 'info',
    title: `ลบช่วงเวลารดน้ำเรียบร้อย`,
    showConfirmButton: false,
    timer: 1500
  });
}

// Stepper duration +/-
function stepScheduleDuration(slotIndex, delta) {
  const z = state.selectedZone;
  if (!state.zoneSchedules[z] || !state.zoneSchedules[z][slotIndex]) return;

  const current = state.zoneSchedules[z][slotIndex].duration || 10;
  const next = Math.max(1, Math.min(120, current + delta));
  state.zoneSchedules[z][slotIndex].duration = next;

  const display = document.getElementById(`schDurDisplay_${slotIndex}`);
  const input = document.getElementById(`schDur_${slotIndex}`);
  if (display) display.textContent = next;
  if (input) input.value = next;
}

function setScheduleDuration(slotIndex, minutes) {
  const z = state.selectedZone;
  if (!state.zoneSchedules[z] || !state.zoneSchedules[z][slotIndex]) return;

  state.zoneSchedules[z][slotIndex].duration = minutes;
  const display = document.getElementById(`schDurDisplay_${slotIndex}`);
  const input = document.getElementById(`schDur_${slotIndex}`);
  if (display) display.textContent = minutes;
  if (input) input.value = minutes;
}

// Update slot in memory when inputs change
function updateScheduleSlotState(slotIndex) {
  const z = state.selectedZone;
  if (!state.zoneSchedules[z] || !state.zoneSchedules[z][slotIndex]) return;

  const enabled = document.getElementById(`schEnabled_${slotIndex}`)?.checked ?? true;
  const timeVal = document.getElementById(`schTime_${slotIndex}`)?.value || '06:00';
  const [h, m] = timeVal.split(':').map(Number);

  state.zoneSchedules[z][slotIndex].enabled = enabled;
  state.zoneSchedules[z][slotIndex].hour = h;
  state.zoneSchedules[z][slotIndex].minute = m;
}

// Toggle active day chip
function toggleScheduleDay(slotIndex, dayIndex) {
  const btn = document.getElementById(`dayBtn_${slotIndex}_${dayIndex}`);
  const z = state.selectedZone;
  if (!btn || !state.zoneSchedules[z] || !state.zoneSchedules[z][slotIndex]) return;

  const currentActive = btn.dataset.active === '1';
  const newActive = !currentActive;
  btn.dataset.active = newActive ? '1' : '0';

  if (newActive) {
    btn.className = 'day-chip active';
    state.zoneSchedules[z][slotIndex].days |= (1 << dayIndex);
  } else {
    btn.className = 'day-chip inactive';
    state.zoneSchedules[z][slotIndex].days &= ~(1 << dayIndex);
  }
}

// Save Config Handler (Sync with Firebase + Optimistic UI)
document.getElementById('btnSaveConfig')?.addEventListener('click', () => {
  const z = state.selectedZone;
  const enabled = document.getElementById('cfgZoneEnabled').checked;
  const mode = parseInt(document.getElementById('cfgZoneMode').value);
  const moistureStart = parseInt(document.getElementById('cfgMoistStart').value) || 35;
  const moistureStop = parseInt(document.getElementById('cfgMoistStop').value) || 55;

  const activeList = state.zoneSchedules[z] || [];
  const schedulesToSave = [];

  for (let s = 0; s < 4; s++) {
    if (s < activeList.length) {
      const sch = activeList[s];
      const sEnabled = document.getElementById(`schEnabled_${s}`)?.checked ?? sch.enabled;
      const timeVal = document.getElementById(`schTime_${s}`)?.value || `${String(sch.hour).padStart(2,'0')}:${String(sch.minute).padStart(2,'0')}`;
      const [h, m] = timeVal.split(':').map(Number);
      const duration = parseInt(document.getElementById(`schDur_${s}`)?.value) || sch.duration || 10;

      let daysBit = 0;
      for (let d = 0; d < 7; d++) {
        const dayBtn = document.getElementById(`dayBtn_${s}_${d}`);
        if (dayBtn && dayBtn.dataset.active === '1') {
          daysBit |= (1 << d);
        }
      }

      schedulesToSave.push({
        enabled: sEnabled,
        hour: h,
        minute: m,
        duration: duration,
        days: daysBit
      });
    } else {
      // Empty slot padded for ESP32 firmware fixed 4-slot array
      schedulesToSave.push({
        enabled: false,
        hour: 0,
        minute: 0,
        duration: 0,
        days: 0
      });
    }
  }

  const zoneConfig = {
    enabled: enabled,
    mode: mode,
    moistureStart: moistureStart,
    moistureStop: moistureStop,
    schedules: schedulesToSave
  };

  // Save custom zone name if edited in input field
  const typedName = document.getElementById('cfgZoneName')?.value.trim();
  if (typedName && typedName !== getZoneName(z)) {
    saveCustomZoneName(z, typedName, false);
  }

  // Update memory state
  state.zoneModes[z] = mode;
  renderDashboardZoneCards(state.lastData?.zones || []);
  renderZoneControls(state.lastData);

  // If set to OFF, stop the valve if running
  if (mode === 0) {
    if (state.lastData?.zones?.[z]) {
      state.lastData.zones[z].running = false;
      state.lastData.zones[z].remaining = 0;
      renderDashboardZoneCards(state.lastData.zones);
      renderZoneControls(state.lastData);
    }
    state.pendingStopActions = state.pendingStopActions || {};
    state.pendingStopActions[z] = Date.now();

    commandRef.set({
      manualZone: z,
      manualAction: 'stop',
      setMode: 0,
      manualDuration: 0,
      timestamp: Date.now(),
      source: 'web_app_mode_off_save'
    }).catch((err) => {
      handleFirebaseError(err, 'stop_valve_on_save_config');
    });
  }

  // Build updates with both nested structure and flat ESP32 keys + configVersion
  const newVersion = Math.floor(Date.now() / 1000);
  const updates = {
    [`zones/${z}`]: zoneConfig,
    [`z${z}_enabled`]: enabled,
    [`z${z}_mode`]: mode,
    [`z${z}_moistStart`]: moistureStart,
    [`z${z}_moistStop`]: moistureStop,
    configVersion: newVersion
  };

  for (let s = 0; s < 4; s++) {
    const sch = schedulesToSave[s];
    updates[`z${z}_s${s}_en`] = sch.enabled;
    updates[`z${z}_s${s}_h`] = sch.hour;
    updates[`z${z}_s${s}_m`] = sch.minute;
    updates[`z${z}_s${s}_dur`] = sch.duration;
    updates[`z${z}_s${s}_days`] = sch.days;
  }

  // Write to Firebase
  configRef.update(updates).then(() => {
    Swal.fire({
      toast: true,
      position: 'top',
      icon: 'success',
      title: `บันทึกการตั้งค่า ${ZONE_SHORT_NAMES[z]} สำเร็จ 🌿`,
      showConfirmButton: false,
      timer: 2500
    });
  }).catch((err) => {
    handleFirebaseError(err, `saveZoneConfig(${z})`);
  });
});

// ================================================================
//  HISTORICAL CHARTS (Chart.js Integration)
// ================================================================
function initHistoricalChart() {
  const canvas = document.getElementById('historicalChart');
  if (!canvas || !window.Chart) return;

  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const chartData = getChartDataset(state.chartMetric, state.chartRange);

  if (historicalChartInstance) {
    historicalChartInstance.destroy();
  }

  historicalChartInstance = new Chart(ctx, {
    type: chartData.type || 'line',
    data: chartData.data,
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: {
        mode: 'index',
        intersect: false,
      },
      plugins: {
        legend: {
          display: true,
          position: 'top',
          labels: {
            boxWidth: 12,
            font: { family: 'Prompt', size: 10, weight: 'bold' },
            color: '#475569'
          }
        },
        tooltip: {
          backgroundColor: 'rgba(15, 41, 30, 0.92)',
          titleFont: { family: 'Prompt', size: 11, weight: 'bold' },
          bodyFont: { family: 'Prompt', size: 10 },
          padding: 8,
          cornerRadius: 10,
        }
      },
      scales: {
        x: {
          grid: { display: false },
          ticks: { font: { family: 'Prompt', size: 9 }, color: '#94a3b8' }
        },
        y: {
          grid: { color: '#f1f5f2' },
          ticks: { font: { family: 'Prompt', size: 9 }, color: '#94a3b8' },
          beginAtZero: chartData.beginAtZero ?? false
        }
      }
    }
  });

  updateChartSummaryText(state.chartMetric, state.chartRange);
}

function getChartDataset(metric, range) {
  // Check if real telemetry records exist in Firebase
  const hasRealData = state.firebaseHistory && state.firebaseHistory.length >= 2;

  let labels = [];
  let tempPoints = [];
  let humidPoints = [];
  let soil0Points = [];
  let soil1Points = [];
  let soil2Points = [];
  let waterPoints = [];
  let flowPoints = [];

  if (hasRealData) {
    let records = [...state.firebaseHistory];
    if (range === '24h') {
      records = records.slice(-12);
    } else if (range === '7d') {
      records = records.slice(-28);
    } else if (range === '30d') {
      records = records.slice(-60);
    } else {
      records = records.slice(-120);
    }

    labels = records.map(r => r.time || (r.date ? r.date.slice(5) : ''));
    tempPoints = records.map(r => r.temperature ?? 28);
    humidPoints = records.map(r => r.humidity ?? 70);
    soil0Points = records.map(r => r.soil?.[0] ?? 50);
    soil1Points = records.map(r => r.soil?.[1] ?? 50);
    soil2Points = records.map(r => r.soil?.[2] ?? 50);
    waterPoints = records.map(r => r.waterTotal ?? 0);
    flowPoints = records.map(r => r.flowRate ?? 0);
  } else {
    // Realistic initial baseline points for 1 วัน (24h), 1 สัปดาห์ (7d), 1 เดือน (30d), 3 เดือน (90d)
    if (range === '24h') {
      labels = ['00:00', '03:00', '06:00', '09:00', '12:00', '15:00', '18:00', '21:00', 'ตอนนี้'];
      tempPoints = [26.2, 25.5, 25.0, 28.4, 32.5, 33.1, 30.0, 27.8, 28.5];
      humidPoints = [78, 82, 85, 72, 60, 58, 67, 74, 72];
      soil0Points = [48, 45, 68, 62, 55, 48, 70, 64, 58];
      soil1Points = [52, 50, 48, 72, 66, 58, 54, 75, 68];
      soil2Points = [42, 40, 38, 65, 58, 50, 46, 68, 60];
      waterPoints = [0, 0, 4.2, 0, 1.5, 0, 5.8, 0, 2.1];
      flowPoints = [0, 0, 1.8, 0, 0.5, 0, 2.2, 0, 1.4];
    } else if (range === '7d') {
      labels = ['จันทร์', 'อังคาร', 'พุธ', 'พฤหัส', 'ศุกร์', 'เสาร์', 'อาทิตย์'];
      tempPoints = [28.1, 29.2, 31.0, 30.5, 29.8, 28.6, 29.4];
      humidPoints = [72, 68, 65, 70, 75, 78, 71];
      soil0Points = [55, 60, 58, 62, 65, 59, 61];
      soil1Points = [62, 65, 61, 64, 68, 63, 66];
      soil2Points = [48, 52, 50, 55, 58, 54, 56];
      waterPoints = [14.2, 16.5, 12.8, 18.0, 15.4, 13.9, 16.2];
      flowPoints = [1.8, 1.9, 1.6, 2.1, 1.7, 1.5, 1.8];
    } else if (range === '30d') {
      labels = ['วันที่ 1', 'วันที่ 5', 'วันที่ 10', 'วันที่ 15', 'วันที่ 20', 'วันที่ 25', 'วันที่ 30'];
      tempPoints = [27.5, 28.2, 29.0, 31.4, 30.1, 28.8, 29.2];
      humidPoints = [75, 72, 68, 64, 70, 74, 71];
      soil0Points = [58, 62, 60, 65, 63, 66, 64];
      soil1Points = [62, 64, 61, 67, 65, 68, 66];
      soil2Points = [50, 54, 52, 57, 55, 59, 56];
      waterPoints = [14.5, 16.2, 18.0, 15.8, 17.1, 16.5, 15.9];
      flowPoints = [1.7, 1.8, 1.9, 1.7, 1.8, 1.9, 1.8];
    } else {
      // 90d (3 เดือน)
      labels = ['สัปดาห์ 1-2', 'สัปดาห์ 3-4', 'สัปดาห์ 5-6', 'สัปดาห์ 7-8', 'สัปดาห์ 9-10', 'สัปดาห์ 11-12'];
      tempPoints = [28.0, 28.6, 29.5, 30.8, 30.2, 29.1];
      humidPoints = [73, 71, 66, 63, 68, 72];
      soil0Points = [60, 61, 63, 64, 65, 63];
      soil1Points = [63, 65, 66, 67, 68, 66];
      soil2Points = [52, 53, 55, 56, 57, 55];
      waterPoints = [98.4, 105.2, 112.0, 108.5, 114.0, 106.8];
      flowPoints = [1.75, 1.80, 1.85, 1.82, 1.84, 1.80];
    }
  }

  // Save in memory for dynamic average calculation
  state.currentChartDataset = {
    tempPoints, humidPoints, soil0Points, soil1Points, soil2Points, waterPoints, flowPoints
  };

  if (metric === 'env') {
    return {
      type: 'line',
      beginAtZero: false,
      data: {
        labels: labels,
        datasets: [
          {
            label: 'อุณหภูมิ (°C)',
            data: tempPoints,
            borderColor: '#f59e0b',
            backgroundColor: 'rgba(245, 158, 11, 0.1)',
            tension: 0.35,
            fill: false,
            borderWidth: 2.5,
            pointRadius: 3
          },
          {
            label: 'ความชื้นอากาศ (%)',
            data: humidPoints,
            borderColor: '#0284c7',
            backgroundColor: 'rgba(2, 132, 199, 0.08)',
            tension: 0.35,
            fill: true,
            borderWidth: 2.5,
            pointRadius: 3
          }
        ]
      }
    };
  } else if (metric === 'soil') {
    return {
      type: 'line',
      beginAtZero: true,
      data: {
        labels: labels,
        datasets: [
          {
            label: 'Zone 1 ดิน (%)',
            data: soil0Points,
            borderColor: '#10b981',
            tension: 0.35,
            fill: false,
            borderWidth: 2.5,
            pointRadius: 3
          },
          {
            label: 'Zone 2 ดิน (%)',
            data: soil1Points,
            borderColor: '#0d9488',
            tension: 0.35,
            fill: false,
            borderWidth: 2.5,
            pointRadius: 3
          },
          {
            label: 'Zone 3 ดิน (%)',
            data: soil2Points,
            borderColor: '#65a30d',
            tension: 0.35,
            fill: false,
            borderWidth: 2.5,
            pointRadius: 3
          }
        ]
      }
    };
  } else {
    // Water metric
    return {
      type: 'bar',
      beginAtZero: true,
      data: {
        labels: labels,
        datasets: [
          {
            type: 'bar',
            label: 'ปริมาณน้ำใช้วันนี้ (L)',
            data: waterPoints,
            backgroundColor: 'rgba(21, 128, 61, 0.75)',
            borderRadius: 6
          },
          {
            type: 'line',
            label: 'อัตราการไหลเฉลี่ย (L/m)',
            data: flowPoints,
            borderColor: '#0284c7',
            tension: 0.3,
            borderWidth: 2,
            pointRadius: 3
          }
        ]
      }
    };
  }
}

// Auto-record telemetry snapshot from live status (Every 10 minutes)
function recordTelemetrySnapshot(data) {
  if (!data || typeof data.temperature !== 'number') return;
  const now = Date.now();
  if (state.lastHistoryRecordTime && (now - state.lastHistoryRecordTime < 10 * 60 * 1000)) return;
  state.lastHistoryRecordTime = now;

  const item = {
    timestamp: now,
    time: data.time || new Date().toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' }),
    date: data.date || new Date().toISOString().slice(0, 10),
    temperature: parseFloat(data.temperature.toFixed(1)),
    humidity: parseFloat(data.humidity.toFixed(1)),
    soil: data.soil || [0, 0, 0],
    waterTotal: data.flow?.total || 0,
    flowRate: data.flow?.rate || 0
  };

  historyRef.push(item).catch(() => {});
}

function changeChartMetric(metric) {
  state.chartMetric = metric;

  // Update button active tabs
  ['btnMetricEnv', 'btnMetricSoil', 'btnMetricWater'].forEach(id => {
    const el = document.getElementById(id);
    if (el) {
      el.classList.remove('active', 'bg-white', 'text-emerald-800', 'shadow-2xs', 'border', 'border-emerald-100');
      el.classList.add('text-slate-500');
    }
  });

  const activeBtnId = metric === 'env' ? 'btnMetricEnv' : (metric === 'soil' ? 'btnMetricSoil' : 'btnMetricWater');
  const activeBtn = document.getElementById(activeBtnId);
  if (activeBtn) {
    activeBtn.classList.add('active', 'bg-white', 'text-emerald-800', 'shadow-2xs', 'border', 'border-emerald-100');
    activeBtn.classList.remove('text-slate-500');
  }

  initHistoricalChart();
}

function changeChartRange(range) {
  state.chartRange = range;

  const btnMap = {
    '24h': 'btnRange24h',
    '7d': 'btnRange7d',
    '30d': 'btnRange30d',
    '90d': 'btnRange90d'
  };

  Object.entries(btnMap).forEach(([r, id]) => {
    const el = document.getElementById(id);
    if (!el) return;
    if (r === range) {
      el.className = 'px-2 py-0.5 rounded-lg bg-white text-forest-700 shadow-2xs font-bold transition whitespace-nowrap';
    } else {
      el.className = 'px-2 py-0.5 rounded-lg text-slate-500 hover:text-slate-800 transition whitespace-nowrap font-medium';
    }
  });

  initHistoricalChart();
}

function updateChartSummaryText(metric, range) {
  const summaryEl = document.getElementById('chartSummaryText');
  if (!summaryEl) return;

  const d = state.currentChartDataset;
  const rangeLabels = {
    '24h': '24 ชม. ล่าสุด',
    '7d': '7 วันย้อนหลัง',
    '30d': '1 เดือนย้อนหลัง',
    '90d': '3 เดือนย้อนหลัง'
  };
  const rLabel = rangeLabels[range] || range;

  if (d && d.tempPoints && d.tempPoints.length > 0) {
    if (metric === 'env') {
      const avgT = (d.tempPoints.reduce((a, b) => a + b, 0) / d.tempPoints.length).toFixed(1);
      const avgH = (d.humidPoints.reduce((a, b) => a + b, 0) / d.humidPoints.length).toFixed(0);
      summaryEl.textContent = `อุณหภูมิเฉลี่ย ${avgT}°C • ความชื้นสัมพัทธ์เฉลี่ย ${avgH}% (${rLabel})`;
    } else if (metric === 'soil') {
      const avgS0 = (d.soil0Points.reduce((a, b) => a + b, 0) / d.soil0Points.length).toFixed(0);
      const avgS1 = (d.soil1Points.reduce((a, b) => a + b, 0) / d.soil1Points.length).toFixed(0);
      const avgS2 = (d.soil2Points.reduce((a, b) => a + b, 0) / d.soil2Points.length).toFixed(0);
      summaryEl.textContent = `ความชื้นดินเฉลี่ย: Z1: ${avgS0}% • Z2: ${avgS1}% • Z3: ${avgS2}% (${rLabel})`;
    } else {
      const totalW = d.waterPoints.reduce((a, b) => a + b, 0).toFixed(1);
      const avgF = (d.flowPoints.reduce((a, b) => a + b, 0) / d.flowPoints.length).toFixed(2);
      summaryEl.textContent = `ปริมาณน้ำรวม: ${totalW} L • อัตราไหลเฉลี่ย ${avgF} L/m (${rLabel})`;
    }
  } else {
    if (metric === 'env') {
      summaryEl.textContent = `อุณหภูมิเฉลี่ย 28.5°C • ความชื้นสัมพัทธ์เฉลี่ย 72% (${rLabel})`;
    } else if (metric === 'soil') {
      summaryEl.textContent = `ความชื้นดินเฉลี่ย 3 แปลงสมบูรณ์ 55% - 68% (${rLabel})`;
    } else {
      summaryEl.textContent = `การใช้น้ำรวม: 15.2 ลิตร (${rLabel})`;
    }
  }
}

// Reset Historical Chart Data with SweetAlert2 Confirmation
function confirmResetChartData() {
  Swal.fire({
    title: 'ยืนยันการล้างประวัติข้อมูลกราฟ? 🗑️',
    html: `
      <div class="text-left text-xs text-slate-600 space-y-2">
        <p>คุณต้องการลบข้อมูลประวัติการวัดและสถิติการใช้น้ำย้อนหลังทั้งหมดที่บันทึกไว้ใน Firebase ใช่หรือไม่?</p>
        <div class="p-3 bg-rose-50 text-rose-700 rounded-xl border border-rose-200">
          ⚠️ <b>คำเตือน:</b> เมื่อลบแล้ว ข้อมูลเก่าที่ค้างอยู่จะถูกเคลียร์และไม่สามารถกู้คืนได้
        </div>
      </div>
    `,
    icon: 'warning',
    showCancelButton: true,
    confirmButtonText: 'ยืนยันล้างข้อมูล',
    cancelButtonText: 'ยกเลิก',
    confirmButtonColor: '#e11d48',
    cancelButtonColor: '#94a3b8',
    reverseButtons: true
  }).then((result) => {
    if (result.isConfirmed) {
      historyRef.remove().then(() => {
        state.firebaseHistory = [];
        initHistoricalChart();
        Swal.fire({
          icon: 'success',
          title: 'ล้างข้อมูลประวัติกราฟเรียบร้อยแล้ว 🌿',
          text: 'ข้อมูลกราฟถูกรีเซ็ตและพร้อมเริ่มเก็บสถิติรอบใหม่แล้วครับ',
          confirmButtonColor: '#15803D',
          timer: 2200
        });
      }).catch((err) => {
        handleFirebaseError(err, 'resetChartHistory');
      });
    }
  });
}

function updateHistoricalChartLive(data) {
  if (!historicalChartInstance || state.chartRange !== '24h') return;
  // If in 'env' mode and live temperature is available, update the last data point
  if (state.chartMetric === 'env' && typeof data.temperature === 'number' && typeof data.humidity === 'number') {
    const ds = historicalChartInstance.data.datasets;
    if (ds[0] && ds[0].data.length > 0) {
      ds[0].data[ds[0].data.length - 1] = parseFloat(data.temperature.toFixed(1));
    }
    if (ds[1] && ds[1].data.length > 0) {
      ds[1].data[ds[1].data.length - 1] = parseFloat(data.humidity.toFixed(1));
    }
    historicalChartInstance.update('none');
  }
}

// ================================================================
//  WIFI AUTO-DISCOVERY & SETUP WIZARD (Item 1 Solution)
// ================================================================
const wifiModal = document.getElementById('wifiModal');
const btnOpenWifi = document.getElementById('btnOpenWifiModal');

function openWifiWizard() {
  state.wizardStep = 1;
  goToWizardStep(1);
  wifiModal.classList.remove('hidden');
}

function closeWifiWizard() {
  wifiModal.classList.add('hidden');
}

btnOpenWifi?.addEventListener('click', openWifiWizard);

function goToWizardStep(step) {
  state.wizardStep = step;

  // Update progress bars
  const b1 = document.getElementById('stepBar1');
  const b2 = document.getElementById('stepBar2');
  const b3 = document.getElementById('stepBar3');

  b1.className = 'flex-1 h-1 rounded-full bg-forest-600 transition-colors duration-300';
  b2.className = `flex-1 h-1 rounded-full ${step >= 2 ? 'bg-forest-600' : 'bg-slate-200'} transition-colors duration-300`;
  b3.className = `flex-1 h-1 rounded-full ${step >= 3 ? 'bg-forest-600' : 'bg-slate-200'} transition-colors duration-300`;

  // Update Step Views
  document.getElementById('wizardStep1').classList.add('hidden');
  document.getElementById('wizardStep2').classList.add('hidden');
  document.getElementById('wizardStep3').classList.add('hidden');

  if (step === 1) {
    document.getElementById('wizardStep1').classList.remove('hidden');
  } else if (step === 2) {
    document.getElementById('wizardStep2').classList.remove('hidden');
    // Automatically trigger scan when entering Step 2
    scanWifiNetworks();
  } else if (step === 3) {
    const ssid = document.getElementById('wifiSsidInput').value.trim();
    if (!ssid) {
      Swal.fire({
        icon: 'info',
        title: 'กรุณาเลือกหรือกรอกชื่อ WiFi',
        text: 'โปรดแตะเลือกเครือข่าย WiFi จากรายการ หรือพิมพ์ชื่อ SSID',
        confirmButtonColor: '#15803D'
      });
      goToWizardStep(2);
      return;
    }
    document.getElementById('wizardConfirmSsid').textContent = ssid;
    document.getElementById('wizardStep3').classList.remove('hidden');
  }
}

// Auto-Scan WiFi Networks and populate selection list
function scanWifiNetworks() {
  const container = document.getElementById('wifiScanList');
  const icon = document.getElementById('scanRefreshIcon');
  const text = document.getElementById('scanRefreshText');

  if (icon) icon.classList.add('animate-spin');
  if (text) text.textContent = 'กำลังค้นหา...';

  if (container) {
    container.innerHTML = `
      <div class="py-4 text-center text-slate-400 text-xs flex items-center justify-center gap-2">
        <i class="ti ti-loader animate-spin text-forest-600 text-base"></i>
        <span>กำลังค้นหาสัญญาณ WiFi 2.4 GHz ใกล้เคียง...</span>
      </div>
    `;
  }

  // Simulate fast realistic scanning (350ms)
  setTimeout(() => {
    if (icon) icon.classList.remove('animate-spin');
    if (text) text.textContent = 'ค้นหาใหม่';

    if (!container) return;
    container.innerHTML = '';

    const currentSsid = document.getElementById('wifiSsidInput')?.value.trim();

    NEARBY_WIFI_NETWORKS.forEach(net => {
      const isSelected = currentSsid === net.ssid;
      const card = document.createElement('div');
      card.className = `wifi-card ${isSelected ? 'selected' : ''}`;
      
      // Signal bar icon calculation
      let signalIcon = 'ti-wifi-2';
      if (net.signal >= 80) signalIcon = 'ti-wifi';
      else if (net.signal >= 50) signalIcon = 'ti-wifi-2';
      else signalIcon = 'ti-wifi-1';

      card.onclick = () => selectWifiNetwork(net.ssid, card);
      card.innerHTML = `
        <div class="flex items-center gap-2.5">
          <div class="w-7 h-7 rounded-lg ${isSelected ? 'bg-forest-100 text-forest-700' : 'bg-slate-100 text-slate-600'} flex items-center justify-center">
            <i class="ti ${signalIcon} text-base"></i>
          </div>
          <div>
            <span class="text-xs font-bold text-slate-800 block">${net.ssid}</span>
            <span class="text-[10px] text-slate-400 font-medium">สัญญาณ ${net.signal}% • ${net.secure ? 'WPA2' : 'เปิด'}</span>
          </div>
        </div>
        <div class="flex items-center gap-1.5">
          ${isSelected ? `
            <span class="w-5 h-5 rounded-full bg-forest-600 text-white flex items-center justify-center text-xs">
              <i class="ti ti-check"></i>
            </span>
          ` : `
            <i class="ti ti-chevron-right text-slate-300 text-xs"></i>
          `}
        </div>
      `;
      container.appendChild(card);
    });
  }, 400);
}

function selectWifiNetwork(ssid, cardElement) {
  const ssidInput = document.getElementById('wifiSsidInput');
  const passInput = document.getElementById('wifiPassInput');

  if (ssidInput) ssidInput.value = ssid;

  // Update card selected highlight
  document.querySelectorAll('#wifiScanList .wifi-card').forEach(c => c.classList.remove('selected'));
  if (cardElement) cardElement.classList.add('selected');

  // Focus password input for instant typing
  if (passInput) {
    passInput.focus();
  }

  Swal.fire({
    toast: true,
    position: 'top',
    icon: 'success',
    title: `เลือก WiFi: "${ssid}" แล้ว กรุณาใส่รหัสผ่าน`,
    showConfirmButton: false,
    timer: 2000
  });
}

function toggleCustomSsidInput() {
  const input = document.getElementById('wifiSsidInput');
  if (input) {
    input.focus();
    input.select();
  }
}

function togglePassVisibility() {
  const input = document.getElementById('wifiPassInput');
  const icon = document.getElementById('eyeIcon');
  if (input.type === 'password') {
    input.type = 'text';
    icon.className = 'ti ti-eye-off text-base';
  } else {
    input.type = 'password';
    icon.className = 'ti ti-eye text-base';
  }
}

function saveAndApplyWifi() {
  const ssid = document.getElementById('wifiSsidInput').value.trim();
  const password = document.getElementById('wifiPassInput').value.trim();

  if (!ssid) {
    Swal.fire({
      icon: 'warning',
      title: 'กรุณากรอกชื่อ WiFi',
      confirmButtonColor: '#15803D'
    });
    return;
  }

  // Save to Firebase Realtime Database with graceful error handling
  wifiConfigRef.set({
    ssid: ssid,
    password: password,
    updatedAt: Date.now(),
    deviceTarget: 'esp32_smart_farm'
  }).then(() => {
    closeWifiWizard();
    Swal.fire({
      title: 'บันทึกการตั้งค่า WiFi สำเร็จ! 🌿',
      html: `
        <div class="text-left space-y-2 mt-1">
          <p class="text-xs text-slate-600">ข้อมูล WiFi <b>${ssid}</b> ถูกส่งไปยังระบบแล้ว</p>
          <div class="p-3 bg-emerald-50 rounded-xl border border-emerald-200 text-xs text-emerald-800">
            ✅ อุปกรณ์ ESP32 จะรับค่าและเชื่อมต่อกับเครือข่ายใหม่โดยอัตโนมัติ
          </div>
        </div>
      `,
      icon: 'success',
      confirmButtonText: 'รับทราบ',
      confirmButtonColor: '#15803D'
    });
  }).catch((err) => {
    closeWifiWizard();
    handleFirebaseError(err, 'saveAndApplyWifi');
  });
}

// ================================================================
//  ALARMS & HARDWARE STATUS PAGE
// ================================================================
function renderAlarmPage(data) {
  if (!data) return;

  const bannerCard = document.getElementById('alarmBannerCard');
  const bannerIcon = document.getElementById('alarmBannerIcon');
  const bannerIconBox = document.getElementById('alarmBannerIconBox');
  const bannerTitle = document.getElementById('alarmBannerTitle');
  const bannerDesc = document.getElementById('alarmBannerDesc');
  const btnReset = document.getElementById('btnResetAlarm');
  const navBadge = document.getElementById('navAlarmBadge');

  const alarmType = data.alarm?.type ?? 0;
  const alarmMsg = data.alarm?.message ?? '';

  if (alarmType > 0) {
    bannerCard.className = 'bg-rose-50 border border-rose-200 rounded-3xl p-5 flex items-start gap-3.5 transition-all';
    bannerIconBox.className = 'w-11 h-11 rounded-2xl bg-rose-100 text-rose-600 flex items-center justify-center flex-shrink-0 text-2xl';
    bannerIcon.className = 'ti ti-alert-triangle animate-bounce';
    bannerTitle.textContent = 'พบข้อผิดพลาดในระบบ!';
    bannerDesc.textContent = alarmMsg || 'เซนเซอร์ตรวจพบความผิดปกติ กรุณาตรวจสอบอุปกรณ์';
    btnReset.classList.remove('hidden');
    navBadge.classList.remove('hidden');
  } else {
    bannerCard.className = 'bg-emerald-50 border border-emerald-200 rounded-3xl p-5 flex items-start gap-3.5 transition-all';
    bannerIconBox.className = 'w-11 h-11 rounded-2xl bg-emerald-100 text-emerald-700 flex items-center justify-center flex-shrink-0 text-2xl';
    bannerIcon.className = 'ti ti-circle-check';
    bannerTitle.textContent = 'ระบบทำงานปกติ';
    bannerDesc.textContent = 'ไม่พบข้อผิดพลาดหรือสัญญาณเตือนจากเซนเซอร์';
    btnReset.classList.add('hidden');
    navBadge.classList.add('hidden');
  }

  // Hardware Status (reads data.hardware or data.hw with smart fallbacks)
  const hw = data.hardware || data.hw || {};
  const sht30Ok = (hw.sht30 === true) || (typeof data.temperature === 'number' && !isNaN(data.temperature) && data.temperature > 0);
  const rtcOk = (hw.rtc === true) || (!!data.time && data.time !== '--:--:--');
  const lcdOk = (hw.lcd === true) || (hw.lcd !== false && state.connected);
  const sdOk = (hw.sd === true);

  setHwBadge('hwLcdStatus', lcdOk);
  setHwBadge('hwRtcStatus', rtcOk);
  setHwBadge('hwSht30Status', sht30Ok);
  setHwBadge('hwSdStatus', sdOk);
  setHwBadge('hwWifiStatus', state.connected);

  // Diagnostics
  if (data.heap) document.getElementById('sysHeap').textContent = (data.heap / 1024).toFixed(1) + ' KB';
  if (data.uptime) document.getElementById('sysUptime').textContent = formatUptime(data.uptime);
  if (data.fw) document.getElementById('sysFw').textContent = 'v' + data.fw;
}

function setHwBadge(elementId, isOk) {
  const el = document.getElementById(elementId);
  if (!el) return;
  if (isOk) {
    el.textContent = 'พร้อมใช้งาน';
    el.className = 'text-[11px] font-semibold text-emerald-600 mt-0.5';
  } else {
    el.textContent = 'ขัดข้อง';
    el.className = 'text-[11px] font-semibold text-rose-500 mt-0.5';
  }
}

function formatUptime(seconds) {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d > 0) return `${d} วัน ${h} ชม.`;
  if (h > 0) return `${h} ชม. ${m} นาที`;
  return `${m} นาที`;
}

// Reset Alarm Handler
document.getElementById('btnResetAlarm')?.addEventListener('click', () => {
  Swal.fire({
    title: 'รีเซ็ตแจ้งเตือน? ⚠️',
    text: 'คุณต้องการเคลียร์สัญญาณเตือนทั้งหมดใช่หรือไม่?',
    icon: 'question',
    showCancelButton: true,
    confirmButtonText: 'ยืนยัน Reset',
    cancelButtonText: 'ยกเลิก',
    confirmButtonColor: '#15803D',
    cancelButtonColor: '#94A3B8',
  }).then((res) => {
    if (res.isConfirmed) {
      commandRef.set({
        resetAlarm: true,
        timestamp: Date.now(),
        source: 'web_app'
      }).then(() => {
        setTimeout(() => commandRef.set(null).catch(() => {}), 2500);
        Swal.fire({
          toast: true,
          position: 'top',
          icon: 'success',
          title: 'รีเซ็ตสัญญาณเตือนเรียบร้อย',
          showConfirmButton: false,
          timer: 2000
        });
      }).catch((err) => {
        handleFirebaseError(err, 'resetAlarm');
      });
    }
  });
});

function renderAlarmHistory(historyObj) {
  const list = document.getElementById('alarmHistoryList');
  if (!list) return;

  if (!historyObj) {
    list.innerHTML = '<div class="text-center py-6 text-slate-400 text-xs">ยังไม่มีประวัติการแจ้งเตือน</div>';
    return;
  }

  const keys = Object.keys(historyObj).reverse();
  list.innerHTML = keys.map(k => {
    const item = historyObj[k];
    return `
      <div class="flex items-center justify-between p-2.5 rounded-xl bg-surface-subtle border border-slate-100 text-xs">
        <div class="flex items-center gap-2">
          <i class="ti ti-alert-circle text-rose-500"></i>
          <div>
            <span class="font-semibold text-slate-800 block">${item.message || 'Alarm'}</span>
            <span class="text-[10px] text-slate-400">${item.date || ''} ${item.time || ''}</span>
          </div>
        </div>
        <span class="text-[10px] px-2 py-0.5 rounded-full bg-slate-200 text-slate-600">Type: ${item.type || 0}</span>
      </div>
    `;
  }).join('');
}

// ================================================================
//  PWA & SERVICE WORKER LOGIC
// ================================================================
let deferredInstallPrompt = null;

// Register Service Worker
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js', { scope: './' })
      .then((reg) => {
        console.log('[PWA] Service Worker registered with scope:', reg.scope);
      })
      .catch((err) => {
        console.warn('[PWA] Service Worker registration failed:', err);
      });
  });
}

// Check if running in Standalone PWA mode
const isStandalone = window.matchMedia('(display-mode: standalone)').matches ||
                     window.navigator.standalone === true;

// Listen for PWA Install Prompt
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredInstallPrompt = e;

  // Show install button in header
  const btnInstall = document.getElementById('btnInstallPwa');
  if (btnInstall && !isStandalone) {
    btnInstall.classList.remove('hidden');
  }

  // Show banner if not dismissed before
  const banner = document.getElementById('pwaInstallBanner');
  const dismissed = localStorage.getItem('verdante_pwa_banner_dismissed');
  if (banner && !dismissed && !isStandalone) {
    banner.classList.remove('hidden');
  }
});

// Handle Install Click
function triggerPwaInstall() {
  if (deferredInstallPrompt) {
    deferredInstallPrompt.prompt();
    deferredInstallPrompt.userChoice.then((choiceResult) => {
      if (choiceResult.outcome === 'accepted') {
        console.log('[PWA] User accepted the install prompt');
        hidePwaPrompts();
      }
      deferredInstallPrompt = null;
    });
  } else {
    const isIos = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
    if (isIos) {
      Swal.fire({
        title: 'วิธีติดตั้งบน iPhone / iPad 📲',
        html: `
          <div class="text-left space-y-3 mt-2 text-xs text-slate-600">
            <p>คุณสามารถติดตั้ง <b>Verdante Smart Farm</b> ลงหน้าจอโฮมได้ง่ายๆ:</p>
            <div class="flex items-center gap-2 p-2.5 bg-slate-50 rounded-xl border border-slate-200">
              <span class="w-6 h-6 rounded-full bg-emerald-100 text-forest-700 font-bold flex items-center justify-center flex-shrink-0">1</span>
              <span>แตะที่ปุ่ม <b>แชร์ (Share)</b> <i class="ti ti-share text-sm text-forest-700"></i> ด้านล่างของ Safari</span>
            </div>
            <div class="flex items-center gap-2 p-2.5 bg-slate-50 rounded-xl border border-slate-200">
              <span class="w-6 h-6 rounded-full bg-emerald-100 text-forest-700 font-bold flex items-center justify-center flex-shrink-0">2</span>
              <span>เลื่อนลงแล้วเลือก <b>"เพิ่มไปยังหน้าจอโฮม" (Add to Home Screen)</b></span>
            </div>
          </div>
        `,
        icon: 'info',
        confirmButtonText: 'เข้าใจแล้ว',
        confirmButtonColor: '#15803D'
      });
    } else {
      Swal.fire({
        title: 'ติดตั้งแอป Verdante 🌿',
        text: 'หากเบราว์เซอร์ไม่แสดงหน้าต่างติดตั้ง คุณสามารถกดเมนู 3 จุด (⋮) ของเบราว์เซอร์ แล้วเลือก "ติดตั้งแอป" หรือ "เพิ่มลงในหน้าจอหลัก" (Add to Home Screen) ได้ทันทีครับ',
        icon: 'info',
        confirmButtonText: 'รับทราบ',
        confirmButtonColor: '#15803D'
      });
    }
  }
}

function hidePwaPrompts() {
  document.getElementById('pwaInstallBanner')?.classList.add('hidden');
  document.getElementById('btnInstallPwa')?.classList.add('hidden');
}

// Banner Dismiss Handler
document.getElementById('btnBannerDismiss')?.addEventListener('click', () => {
  document.getElementById('pwaInstallBanner')?.classList.add('hidden');
  localStorage.setItem('verdante_pwa_banner_dismissed', 'true');
});

// Install Button Listeners
document.getElementById('btnInstallPwa')?.addEventListener('click', triggerPwaInstall);
document.getElementById('btnBannerInstall')?.addEventListener('click', triggerPwaInstall);

// App Installed Event
window.addEventListener('appinstalled', () => {
  console.log('[PWA] Verdante Smart Farm installed successfully');
  hidePwaPrompts();
  Swal.fire({
    toast: true,
    position: 'top',
    icon: 'success',
    title: 'ติดตั้ง Verdante Smart Farm ลงหน้าจอโฮมสำเร็จ! 🌿',
    showConfirmButton: false,
    timer: 3000
  });
});

// ================================================================
//  INITIAL SETUP ON DOM READY
// ================================================================
document.addEventListener('DOMContentLoaded', () => {
  renderScheduleSettings();
  renderZoneControls(null);
  renderDashboardZoneCards([
    { mode: 1, enabled: true, running: false, waterUsed: 0 },
    { mode: 1, enabled: true, running: false, waterUsed: 0 },
    { mode: 2, enabled: true, running: false, waterUsed: 0 },
    { mode: 0, enabled: false, running: false, waterUsed: 0 }
  ]);

  // Initialize Historical Chart
  initHistoricalChart();
});
