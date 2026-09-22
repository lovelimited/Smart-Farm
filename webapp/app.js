/* ================================================================
   Verdante Smart Farm — Auto Watering & Monitoring System
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
  zoneModes: [1, 1, 2, 1], // 0: OFF, 1: TIMER, 2: SMART (Zone 4 is TIMER only)
  zoneSchedules: {
    0: [{ enabled: true, hour: 6, minute: 0, duration: 10, days: 127 }],
    1: [{ enabled: true, hour: 7, minute: 30, duration: 15, days: 127 }],
    2: [{ enabled: true, hour: 17, minute: 0, duration: 12, days: 127 }],
    3: [{ enabled: false, hour: 12, minute: 0, duration: 5, days: 127 }]
  },
  wizardStep: 1,
  chartMetric: 'env', // 'env' | 'soil' | 'water'
  chartRange: '1d',   // '1d' | '1w' | '1m' | '3m'
  firebaseHistory: [], // Real historical records from Firebase
  lastHistoryRecordTime: 0,
  lastReceivedAt: 0,
  receivedCount: 0
};

const ZONE_NAMES = [
  'Zone 1 (แปลงผักสลัด)',
  'Zone 2 (แปลงเมลอน)',
  'Zone 3 (แปลงมะเขือเทศ)',
  'Zone 4 (ระบบน้ำหยด)'
];
const ZONE_SHORT_NAMES = ['Zone 1', 'Zone 2', 'Zone 3', 'Zone 4 (น้ำหยด)'];
const ZONE_COLORS = ['#10b981', '#0d9488', '#16a34a', '#0284c7'];
const MODE_NAMES = ['OFF', 'TIMER', 'SMART'];
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

  // If switched to schedule, immediately render settings from memory without waiting
  if (tabId === 'pageSchedule') {
    renderScheduleSettings();
  }

  // If switched to dashboard, re-render chart to ensure correct canvas sizing
  if (tabId === 'pageDashboard' && historicalChartInstance) {
    setTimeout(() => {
      historicalChartInstance.resize();
    }, 30);
  }

  // Instant scroll (no smooth animation delay)
  window.scrollTo(0, 0);
}

// ================================================================
//  FIREBASE REALTIME LISTENERS
// ================================================================

// Track server time offset from Firebase for accurate real-time clock and age calculations
let serverTimeOffset = 0;
db.ref('.info/serverTimeOffset').on('value', (snap) => {
  serverTimeOffset = snap.val() || 0;
});

// Maximum allowed silence from ESP32 before declaring it offline (ESP32 transmits every 2000ms)
const HEARTBEAT_TIMEOUT_MS = 5000;

// 1. Listen for device status with Stale & Live Detection
statusRef.on('value', (snapshot) => {
  const data = snapshot.val();
  if (!data) {
    setConnectionState(false);
    clearDashboardLiveValues();
    return;
  }

  state.receivedCount = (state.receivedCount || 0) + 1;
  const now = Date.now();
  const currentServerTime = now + serverTimeOffset;

  // Determine age of data in snapshot
  let dataAgeMs = null;
  if (typeof data.ts === 'number') {
    dataAgeMs = currentServerTime - data.ts;
  } else if (data.date && data.time) {
    const timeStr = data.time.length === 5 ? data.time + ':00' : data.time;
    const espTime = Date.parse(`${data.date}T${timeStr}+07:00`) || Date.parse(`${data.date} ${data.time}`);
    if (!isNaN(espTime) && espTime > 1704067200000) { // after 2024-01-01
      dataAgeMs = currentServerTime - espTime;
    }
  }

  // Check if this initial snapshot is stale (e.g. from an ESP32 turned off earlier)
  if (state.receivedCount === 1) {
    const isStale = (dataAgeMs !== null && dataAgeMs > 6000);
    if (isStale) {
      console.warn(`[Stale Detection] Initial snapshot is ${Math.round(dataAgeMs / 1000)}s old. ESP32 is OFFLINE.`);
      state.lastData = data;
      setConnectionState(false);
      clearDashboardLiveValues();
      renderDashboard(data);
      renderZoneControls(data);
      renderAlarmPage(data);
      return;
    }

    // If age cannot be determined, wait 3.5s for a second heartbeat before confirming offline
    if (dataAgeMs === null) {
      setTimeout(() => {
        if (state.receivedCount <= 1 && state.connected) {
          console.warn('[Stale Detection] No second heartbeat within 3.5s. Marking OFFLINE.');
          setConnectionState(false);
          clearDashboardLiveValues();
        }
      }, 3500);
    }
  }

  // Active fresh packet from ESP32
  state.lastReceivedAt = now;
  state.lastHeartbeatAt = now;
  state.lastData = data;
  setConnectionState(true);

  // Stale check and RTC drift monitoring from ESP32
  if (data.date && data.time) {
    const timeStr = data.time.length === 5 ? data.time + ':00' : data.time;
    const espTime = Date.parse(`${data.date}T${timeStr}+07:00`) || Date.parse(`${data.date} ${data.time}`);
    if (!isNaN(espTime)) {
      const timeDiff = Math.abs(currentServerTime - espTime);
      state.rtcDate = data.date;

      // Auto-sync time if ESP32 clock drifted by more than 15 seconds (cooldown 60s)
      const nowMs = Date.now();
      if (timeDiff > 15000 && state.connected && state.receivedCount >= 2 && (nowMs - (state.lastAutoSyncAt || 0) > 60000)) {
        state.lastAutoSyncAt = nowMs;
        console.log(`[Time Sync] ESP32 clock drifted by ${(timeDiff / 1000).toFixed(0)}s. Auto-syncing with Thailand time...`);
        syncTimeToEsp32(true);
      }
    }
  }

  // Sync zone modes if available from ESP32
  if (data.zones && Array.isArray(data.zones)) {
    data.zones.forEach((z, i) => {
      if (typeof z.mode === 'number') {
        state.zoneModes[i] = z.mode;
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
  clearDashboardLiveValues();
});

// Periodic Heartbeat Watchdog (Checks every 1s if ESP32 stopped uploading for > 5s)
setInterval(() => {
  if (state.connected) {
    const lastActive = state.lastHeartbeatAt || state.lastReceivedAt || 0;
    const elapsed = Date.now() - lastActive;
    if (elapsed > HEARTBEAT_TIMEOUT_MS) {
      console.warn(`[Watchdog] No updates received from ESP32 for ${(elapsed / 1000).toFixed(1)}s. Marking OFFLINE.`);
      setConnectionState(false);
      clearDashboardLiveValues();
    }
  }
}, 1000);

// Helper to clear dashboard metrics when ESP32 is powered off or disconnected
function clearDashboardLiveValues() {
  const valTempEl = document.getElementById('valTemp');
  const valHumEl = document.getElementById('valHumid');
  const barTempEl = document.getElementById('barTemp');
  const barHumEl = document.getElementById('barHumid');
  const flowEl = document.getElementById('dashFlowRate');

  if (valTempEl) valTempEl.textContent = '--';
  if (valHumEl) valHumEl.textContent = '--';
  if (barTempEl) barTempEl.style.width = '0%';
  if (barHumEl) barHumEl.style.width = '0%';
  if (flowEl) flowEl.textContent = '0.00';

  for (let i = 0; i < 3; i++) {
    const valEl = document.getElementById(`valSoil${i}`);
    const unitEl = document.getElementById(`unitSoil${i}`);
    const gaugeEl = document.getElementById(`soilGauge${i}`);
    const statusEl = document.getElementById(`soilStatus${i}`);
    if (valEl) valEl.textContent = '--';
    if (unitEl) unitEl.style.display = 'inline';
    if (gaugeEl) gaugeEl.setAttribute('stroke-dasharray', '0 264');
    if (statusEl) {
      statusEl.textContent = 'ออฟไลน์';
      statusEl.className = 'text-[10px] text-slate-400 font-medium';
    }
  }
}

// 2. Listen for Firebase network connection
db.ref('.info/connected').on('value', (snap) => {
  const isOnline = snap.val() === true;
  if (!isOnline && !state.lastData) {
    setConnectionState(false);
  }
});

// 3. Robust Config Parser and Firebase Listener (Parses both flat and nested keys for all 4 zones)
function parseFirebaseConfig(data) {
  if (!data || typeof data !== 'object') return;
  state.configData = data;
  if (!state.configData.zones) state.configData.zones = [];

  for (let i = 0; i < 4; i++) {
    const zoneObj = (Array.isArray(data.zones) ? data.zones[i] : null) || {};
    const enabled = data[`z${i}_enabled`] ?? zoneObj.enabled ?? true;
    const mode = data[`z${i}_mode`] ?? zoneObj.mode ?? 1;
    const moistStart = data[`z${i}_moistStart`] ?? zoneObj.moistureStart ?? 35;
    const moistStop = data[`z${i}_moistStop`] ?? zoneObj.moistureStop ?? 55;

    state.zoneModes[i] = mode;

    let scheds = [];
    if (zoneObj.schedules && Array.isArray(zoneObj.schedules)) {
      scheds = zoneObj.schedules.filter(s => (s.duration > 0 || s.enabled) && (s.hour !== undefined || s.minute !== undefined));
    }
    if (scheds.length === 0) {
      // Parse from flat keys: zX_sY_en, zX_sY_h, zX_sY_m, zX_sY_dur, zX_sY_days
      for (let s = 0; s < 4; s++) {
        const en = data[`z${i}_s${s}_en`];
        const h = data[`z${i}_s${s}_h`];
        const m = data[`z${i}_s${s}_m`];
        const dur = data[`z${i}_s${s}_dur`];
        const days = data[`z${i}_s${s}_days`];
        if (en !== undefined || h !== undefined || dur !== undefined) {
          if (dur > 0 || en) {
            scheds.push({
              enabled: !!en,
              hour: h ?? 6,
              minute: m ?? 0,
              duration: dur ?? 10,
              days: days ?? 127
            });
          }
        }
      }
    }

    if (scheds.length === 0) {
      scheds = [{ enabled: true, hour: 6, minute: 0, duration: 10, days: 127 }];
    }

    state.zoneSchedules[i] = scheds;
    state.configData.zones[i] = {
      enabled,
      mode,
      moistureStart: moistStart,
      moistureStop: moistStop,
      schedules: scheds
    };
  }
}

configRef.on('value', (snapshot) => {
  const data = snapshot.val();
  if (data) {
    parseFirebaseConfig(data);
    // Re-render schedule settings only if not currently focused in an input on schedule page
    const isUserEditingSchedule = document.activeElement && 
      document.getElementById('pageSchedule')?.contains(document.activeElement) && 
      ['INPUT', 'SELECT'].includes(document.activeElement.tagName);

    if (!isUserEditingSchedule) {
      renderScheduleSettings();
    }
    renderDashboardZoneCards(state.lastData?.zones || []);
    renderZoneControls(state.lastData);
  }
});

// 4. Listen for Alarm history
alarmHistoryRef.orderByKey().limitToLast(15).on('value', (snapshot) => {
  renderAlarmHistory(snapshot.val());
});

// 5. Listen for Historical Telemetry Log from Firebase (up to 500 records for 3-month support)
historyRef.orderByChild('timestamp').limitToLast(500).on('value', (snapshot) => {
  const val = snapshot.val();
  if (val) {
    state.firebaseHistory = Object.values(val);
    if (historicalChartInstance && state.currentTab === 'pageDashboard') {
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
  const bannerText = document.getElementById('offlineBannerText');

  if (connected) {
    dot.className = 'w-2 h-2 rounded-full bg-emerald-500 animate-pulse';
    text.textContent = 'ออนไลน์';
    text.className = 'font-semibold text-emerald-700';
    if (banner) banner.classList.add('hidden');
  } else {
    dot.className = 'w-2 h-2 rounded-full bg-slate-300';
    text.textContent = 'ออฟไลน์';
    text.className = 'font-medium text-slate-500';
    if (banner) {
      banner.classList.remove('hidden');
      if (bannerText) {
        bannerText.textContent = state.lastData ? 'อุปกรณ์ ESP32 ออฟไลน์ (ปิดเครื่องหรือสัญญาณขาดหาย)' : 'ยังไม่พบการเชื่อมต่อกับอุปกรณ์ ESP32';
      }
    }
  }
}

// ================================================================
//  DASHBOARD RENDERING
// ================================================================
function renderDashboard(data) {
  if (!data) return;

  // Auto-record telemetry snapshot for historical charts
  recordTelemetrySnapshot(data);



  // FW Badge
  if (data.fw) {
    document.getElementById('fwBadge').textContent = 'FW v' + data.fw;
  }

  // Flow rate & totals
  if (data.flow) {
    document.getElementById('dashFlowRate').textContent = (data.flow.rate ?? 0).toFixed(2);
    document.getElementById('dashFlowTotal').textContent = (data.flow.total ?? 0).toFixed(2);
  }

  // Temperature
  const temp = data.temperature;
  const valTempEl = document.getElementById('valTemp');
  const barTempEl = document.getElementById('barTemp');
  if (typeof temp === 'number' && !isNaN(temp)) {
    valTempEl.textContent = temp.toFixed(1);
    const pct = Math.min(100, Math.max(0, (temp / 45) * 100));
    barTempEl.style.width = `${pct}%`;
  } else {
    valTempEl.textContent = '--';
    barTempEl.style.width = '0%';
  }

  // Humidity
  const hum = data.humidity;
  const valHumEl = document.getElementById('valHumid');
  const barHumEl = document.getElementById('barHumid');
  if (typeof hum === 'number' && !isNaN(hum)) {
    valHumEl.textContent = hum.toFixed(1);
    barHumEl.style.width = `${Math.min(100, hum)}%`;
  } else {
    valHumEl.textContent = '--';
    barHumEl.style.width = '0%';
  }

  // Soil Moisture Gauges (Zones 0, 1, 2)
  const soils = data.soil || [];
  const soilErrors = data.soilError || [];
  const circumference = 2 * Math.PI * 42; // ~264

  for (let i = 0; i < 3; i++) {
    const val = soils[i];
    const err = soilErrors[i];
    const gaugeEl = document.getElementById(`soilGauge${i}`);
    const valEl = document.getElementById(`valSoil${i}`);
    const unitEl = document.getElementById(`unitSoil${i}`);
    const statusEl = document.getElementById(`soilStatus${i}`);

    const isErr = err || val === null || val === undefined || isNaN(val) || val < 0;

    if (isErr) {
      valEl.textContent = '-';
      if (unitEl) unitEl.style.display = 'none';
      if (gaugeEl) gaugeEl.setAttribute('stroke-dasharray', `0 ${circumference}`);
      if (statusEl) {
        statusEl.textContent = 'ไม่ได้เชื่อมต่อ';
        statusEl.className = 'text-[10px] text-slate-400 font-medium';
      }
    } else {
      if (unitEl) unitEl.style.display = 'inline';
      const pct = typeof val === 'number' ? Math.max(0, Math.min(100, val)) : 0;
      valEl.textContent = typeof val === 'number' ? val.toFixed(0) : '--';
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

// Render Dashboard Zone Mini Cards with Mode Control (Zone 1-3 have Soil Moisture & Smart mode; Zone 4 is Drip with Timer only)
function renderDashboardZoneCards(zones) {
  const container = document.getElementById('dashZoneCards');
  if (!container) return;

  container.innerHTML = '';
  const soils = state.lastData?.soil || [];
  const soilErrors = state.lastData?.soilError || [];

  for (let z = 0; z < 4; z++) {
    const zone = zones[z] || {};
    const isRunning = zone.running;
    const isAlarm = zone.alarm;
    let currentMode = state.zoneModes[z] ?? (zone.mode ?? 1); // 0=OFF, 1=TIMER, 2=SMART
    if (z === 3 && currentMode === 2) {
      currentMode = 1; // Zone 4 cannot be SMART
      state.zoneModes[z] = 1;
    }

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
        <span class="w-1.5 h-1.5 rounded-full bg-emerald-600 animate-ping"></span> ${MODE_NAMES[currentMode] || 'RUN'}
      </span>`;
    } else {
      const modeLabel = MODE_NAMES[currentMode] || 'OFF';
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

    // Soil Moisture or Drip Irrigation row (แสดงความชื้นดิน % ให้ดูแต่ละช่อง)
    let soilBadge = '';
    if (z < 3) {
      const sVal = soils[z];
      const sErr = soilErrors[z] || sVal === null || sVal === undefined || isNaN(sVal) || sVal < 0;
      if (!sErr && typeof sVal === 'number') {
        const pct = Math.max(0, Math.min(100, sVal));
        soilBadge = `
          <div class="flex items-center justify-between text-[11px] mt-1.5 py-1 px-2 rounded-xl bg-forest-50/80 border border-forest-100 text-forest-900">
            <span class="flex items-center gap-1 font-semibold text-slate-700">
              <i class="ti ti-seeding text-emerald-600"></i> ความชื้นดิน:
            </span>
            <span class="font-mono font-bold text-xs text-forest-800">${pct.toFixed(0)}%</span>
          </div>
        `;
      } else {
        soilBadge = `
          <div class="flex items-center justify-between text-[11px] mt-1.5 py-1 px-2 rounded-xl bg-slate-50 border border-slate-200/70 text-slate-500">
            <span class="flex items-center gap-1 font-medium text-slate-500">
              <i class="ti ti-seeding text-slate-400"></i> ความชื้นดิน:
            </span>
            <span class="text-[10px] font-semibold text-slate-400 bg-white px-1.5 py-0.5 rounded border border-slate-200">
              ไม่ได้เชื่อมต่อ
            </span>
          </div>
        `;
      }
    } else {
      // Zone 4 is Drip Irrigation (Timer only, no soil sensor)
      soilBadge = `
        <div class="flex items-center justify-between text-[11px] mt-1.5 py-1 px-2 rounded-xl bg-sky-50 border border-sky-100 text-sky-800">
          <span class="flex items-center gap-1 font-semibold text-sky-900">
            <i class="ti ti-droplet-half-2 text-sky-600"></i> ระบบน้ำหยด:
          </span>
          <span class="text-[10px] font-bold text-sky-700 bg-white px-1.5 py-0.5 rounded border border-sky-200">
            รดตามเวลา (ไม่มีเซ็นเซอร์)
          </span>
        </div>
      `;
    }

    // Mode Selector HTML (Zone 1-3 have OFF|TIMER|SMART, Zone 4 has OFF|TIMER only)
    const modeSegmentedHtml = z < 3 ? `
      <div class="mode-segmented">
        <button type="button" onclick="setZoneMode(${z}, 0)" class="mode-btn ${currentMode === 0 ? 'active-off' : ''}" title="ปิดการทำงาน">
          OFF
        </button>
        <button type="button" onclick="setZoneMode(${z}, 1)" class="mode-btn ${currentMode === 1 ? 'active-manual' : ''}" title="รดน้ำตามตารางเวลา">
          TIMER
        </button>
        <button type="button" onclick="setZoneMode(${z}, 2)" class="mode-btn ${currentMode === 2 ? 'active-auto' : ''}" title="รดน้ำอัตโนมัติตามความชื้นดิน">
          SMART
        </button>
      </div>
    ` : `
      <div class="mode-segmented grid-cols-2">
        <button type="button" onclick="setZoneMode(${z}, 0)" class="mode-btn ${currentMode === 0 ? 'active-off' : ''}" title="ปิดการทำงาน">
          OFF (ปิด)
        </button>
        <button type="button" onclick="setZoneMode(${z}, 1)" class="mode-btn ${currentMode === 1 ? 'active-manual' : ''}" title="รดน้ำตามตารางเวลา">
          TIMER (ตามเวลา)
        </button>
      </div>
    `;

    card.innerHTML = `
      <div>
        <div class="flex items-center justify-between mb-1">
          <span class="text-xs font-bold text-slate-800">${ZONE_SHORT_NAMES[z]}</span>
          ${statusBadge}
        </div>
        ${soilBadge}
        <div class="text-[11px] text-slate-500 mt-1 flex items-center justify-between">
          <span class="text-slate-400">ใช้น้ำ:</span>
          <b class="text-slate-700 font-mono">${(zone.waterUsed ?? 0).toFixed(2)} L</b>
        </div>
        ${timerText}
      </div>

      <!-- Mode Segmented Control -->
      <div class="mt-2.5 pt-2 border-t border-slate-100">
        ${modeSegmentedHtml}

        <!-- Quick Action Trigger -->
        <div class="mt-2 text-center">
          ${isRunning 
            ? `<button onclick="confirmStopZone(${z})" class="w-full py-1 bg-rose-50 text-rose-600 hover:bg-rose-100 rounded-lg text-[10px] font-bold transition flex items-center justify-center gap-1">
                 <i class="ti ti-player-stop text-xs"></i> หยุดรดน้ำ
               </button>`
            : `<button onclick="confirmStartZone(${z})" class="w-full py-1 bg-forest-50 text-forest-700 hover:bg-forest-100 rounded-lg text-[10px] font-bold transition flex items-center justify-center gap-1">
                 <i class="ti ti-player-play text-xs"></i> สั่งรดน้ำทันที
               </button>`
          }
        </div>
      </div>
    `;

    container.appendChild(card);
  }
}

// ================================================================
//  ZONE CONTROLS PAGE (Mode Control & Soil Details)
// ================================================================
function renderZoneControls(data) {
  const container = document.getElementById('zoneControlsList');
  if (!container) return;

  const d = data || state.lastData || {
    zones: [
      { mode: 1, enabled: true, running: false, waterUsed: 0 },
      { mode: 1, enabled: true, running: false, waterUsed: 0 },
      { mode: 2, enabled: true, running: false, waterUsed: 0 },
      { mode: 1, enabled: true, running: false, waterUsed: 0 }
    ],
    soil: [-1, -1, -1],
    flow: { rate: 0.0, total: 0.0 }
  };

  const zones = d.zones || [];
  container.innerHTML = '';

  for (let z = 0; z < 4; z++) {
    const zone = zones[z] || {};
    const isRunning = zone.running;
    const isAlarm = zone.alarm;
    const duration = state.activeDurations[z] || 10;
    let currentMode = state.zoneModes[z] ?? (zone.mode ?? 1); // 0=OFF, 1=TIMER, 2=SMART
    if (z === 3 && currentMode === 2) {
      currentMode = 1;
      state.zoneModes[z] = 1;
    }

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

    // Soil Moisture for Zone 0-2, Drip badge for Zone 3
    let soilRow = '';
    if (z < 3) {
      const sVal = d.soil ? d.soil[z] : null;
      const sErr = d.soilError?.[z] || sVal === null || sVal === undefined || isNaN(sVal) || sVal < 0;
      soilRow = `
        <div class="bg-surface-subtle p-2 rounded-xl text-center">
          <span class="text-[10px] text-slate-400 block font-medium">ความชื้นดิน</span>
          <span class="text-xs font-bold ${sErr ? 'text-slate-400 text-[10px]' : 'text-emerald-700 font-mono'}">
            ${sErr ? 'ไม่ได้เชื่อมต่อ' : (typeof sVal === 'number' && !isNaN(sVal) ? sVal.toFixed(0) + '%' : '--')}
          </span>
        </div>
      `;
    } else {
      soilRow = `
        <div class="bg-sky-50/80 border border-sky-100 p-2 rounded-xl text-center">
          <span class="text-[10px] text-sky-600 block font-medium">ระบบน้ำหยด</span>
          <span class="text-[11px] font-bold text-sky-800 flex items-center justify-center gap-0.5">
            <i class="ti ti-droplet-half-2 text-sky-500 text-xs"></i> ตามเวลา
          </span>
        </div>
      `;
    }

    // Mode segmented selector
    const modeSegmentedControls = z < 3 ? `
      <div class="mode-segmented">
        <button type="button" onclick="setZoneMode(${z}, 0)" class="mode-btn ${currentMode === 0 ? 'active-off' : ''}">
          <i class="ti ti-power text-xs mr-0.5"></i> OFF (ปิด)
        </button>
        <button type="button" onclick="setZoneMode(${z}, 1)" class="mode-btn ${currentMode === 1 ? 'active-manual' : ''}">
          <i class="ti ti-clock text-xs mr-0.5"></i> TIMER (ตามเวลา)
        </button>
        <button type="button" onclick="setZoneMode(${z}, 2)" class="mode-btn ${currentMode === 2 ? 'active-auto' : ''}">
          <i class="ti ti-sparkles text-xs mr-0.5"></i> SMART (ความชื้นดิน)
        </button>
      </div>
    ` : `
      <div class="mode-segmented grid-cols-2">
        <button type="button" onclick="setZoneMode(${z}, 0)" class="mode-btn ${currentMode === 0 ? 'active-off' : ''}">
          <i class="ti ti-power text-xs mr-0.5"></i> OFF (ปิด)
        </button>
        <button type="button" onclick="setZoneMode(${z}, 1)" class="mode-btn ${currentMode === 1 ? 'active-manual' : ''}">
          <i class="ti ti-clock text-xs mr-0.5"></i> TIMER (ตามเวลา)
        </button>
      </div>
    `;

    card.innerHTML = `
      <div class="flex items-center justify-between mb-3">
        <div class="flex items-center gap-2">
          <div class="w-9 h-9 rounded-xl ${isRunning ? 'bg-emerald-600 text-white animate-bounce' : (z === 3 ? 'bg-sky-100 text-sky-700' : 'bg-forest-100 text-forest-700')} flex items-center justify-center">
            <i class="${z === 3 ? 'ti ti-droplet-half-2' : 'ti ti-droplet'} text-xl"></i>
          </div>
          <div>
            <h4 class="font-bold text-sm text-slate-900">${ZONE_NAMES[z]}</h4>
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
                  ? '<span class="px-2.5 py-1 text-xs font-semibold rounded-full bg-emerald-50 text-emerald-800 border border-emerald-200">ตามเวลา (TIMER)</span>'
                  : '<span class="px-2.5 py-1 text-xs font-semibold rounded-full bg-sky-50 text-sky-800 border border-sky-200">ความชื้นดิน (SMART)</span>'
          }
        </div>
      </div>

      <!-- Mode Segmented Selector -->
      <div class="my-2.5">
        <label class="text-[11px] font-semibold text-slate-600 block mb-1">เลือกโหมดการทำงาน:</label>
        ${modeSegmentedControls}
      </div>

      <!-- Quick Metrics -->
      <div class="grid grid-cols-3 gap-2 my-3">
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
          <i class="ti ti-circle-off text-slate-400 mr-1"></i> โซนนี้ปิดการทำงานอยู่ (OFF) แตะ TIMER เพื่อเปิดใช้งาน
        </div>
      `}
    `;

    container.appendChild(card);
  }
}

// 3-Mode Zone Switcher [ OFF=0, TIMER=1, SMART=2 ]
function setZoneMode(zoneIndex, mode) {
  // Zone 4 is drip irrigation (Timer only, no soil sensor) -> cannot be SMART (mode 2)
  if (zoneIndex === 3 && mode === 2) {
    mode = 1;
  }
  state.zoneModes[zoneIndex] = mode;
  const isEnabled = (mode !== 0);

  // Sync with state.configData as well
  if (!state.configData) state.configData = { zones: [] };
  if (!state.configData.zones) state.configData.zones = [];
  if (!state.configData.zones[zoneIndex]) state.configData.zones[zoneIndex] = {};
  state.configData.zones[zoneIndex].mode = mode;
  state.configData.zones[zoneIndex].enabled = isEnabled;

  // Optimistic UI Update across all views (Dashboard, Controls, Schedule)
  renderDashboardZoneCards(state.lastData?.zones || []);
  renderZoneControls(state.lastData);
  renderScheduleSettings();

  const modeLabel = MODE_NAMES[mode];
  const zoneName = ZONE_SHORT_NAMES[zoneIndex];

  // Send mode & enabled update to Firebase config (write both flat and nested keys + configVersion)
  const tsSec = Math.floor(Date.now() / 1000);
  const updates = {};
  updates[`devices/esp32/config/z${zoneIndex}_mode`] = mode;
  updates[`devices/esp32/config/z${zoneIndex}_enabled`] = isEnabled;
  updates[`devices/esp32/config/zones/${zoneIndex}/mode`] = mode;
  updates[`devices/esp32/config/zones/${zoneIndex}/enabled`] = isEnabled;
  updates[`devices/esp32/config/configVersion`] = tsSec;
  db.ref().update(updates).catch((err) => {
    handleFirebaseError(err, `setZoneMode(${zoneIndex}, ${mode})`);
  });

  // If set to OFF, stop the valve if it was running
  if (mode === 0) {
    commandRef.set({
      manualZone: zoneIndex,
      manualAction: 'stop',
      manualDuration: 0,
      timestamp: tsSec,
      source: 'web_app_mode_off'
    }).catch((err) => {
      handleFirebaseError(err, 'stop_valve_on_off_mode');
    });
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

  commandRef.set({
    manualZone: zone,
    manualAction: action,
    manualDuration: duration,
    timestamp: Math.floor(Date.now() / 1000),
    source: 'web_app'
  }).catch((err) => {
    handleFirebaseError(err, `sendManualCommand(${zone}, ${action})`);
  });
}

// 4. Send Time Sync Command to ESP32 (Synchronizes RTC with exact Thailand Standard Time UTC+7)
function syncTimeToEsp32(silent = false) {
  const atomicUtc = Date.now() + (typeof serverTimeOffset === 'number' ? serverTimeOffset : 0);
  const thDate = new Date(atomicUtc + (7 * 3600 * 1000));
  const yr = thDate.getUTCFullYear();
  const mo = thDate.getUTCMonth() + 1;
  const dy = thDate.getUTCDate();
  const hr = thDate.getUTCHours();
  const mn = thDate.getUTCMinutes();
  const sc = thDate.getUTCSeconds();

  const payload = {
    setTime: true,
    year: yr,
    month: mo,
    day: dy,
    hour: hr,
    minute: mn,
    second: sc,
    timestamp: Math.floor(atomicUtc / 1000),
    source: 'time_sync'
  };

  return commandRef.set(payload).then(() => {
    state.lastAutoSyncAt = Date.now();
    if (!silent && window.Swal) {
      Swal.fire({
        toast: true,
        position: 'top-end',
        icon: 'success',
        title: 'ซิงค์เวลามาตรฐานประเทศไทยสำเร็จ',
        text: `เวลา ${String(hr).padStart(2, '0')}:${String(mn).padStart(2, '0')}:${String(sc).padStart(2, '0')} (UTC+7) ถูกส่งไปยัง ESP32 แล้ว`,
        timer: 2500,
        showConfirmButton: false
      });
    }
  }).catch((err) => {
    handleFirebaseError(err, 'syncTimeToEsp32');
  });
}
window.syncTimeToEsp32 = syncTimeToEsp32;

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
  const z = state.selectedZone;
  let currentMode = state.zoneModes[z] ?? 1;
  if (z === 3 && currentMode === 2) {
    currentMode = 1;
    state.zoneModes[z] = 1;
  }

  const cfg = state.configData?.zones?.[z] || {
    enabled: true,
    mode: currentMode,
    moistureStart: 35,
    moistureStop: 55,
  };

  // Inputs
  const enabledInput = document.getElementById('cfgZoneEnabled');
  const modeInput = document.getElementById('cfgZoneMode');
  const moistBox = document.getElementById('smartMoistureBox');
  const moistStartInput = document.getElementById('cfgMoistStart');
  const moistStopInput = document.getElementById('cfgMoistStop');

  if (enabledInput) enabledInput.checked = (currentMode !== 0);
  if (modeInput) modeInput.value = currentMode;

  // Badge & Segmented Controls in Schedule Page
  const modeBadgeEl = document.getElementById('cfgZoneModeBadge');
  if (modeBadgeEl) {
    if (currentMode === 0) {
      modeBadgeEl.className = 'text-xs font-semibold px-2.5 py-1 rounded-full bg-slate-100 text-slate-500';
      modeBadgeEl.textContent = 'ปิด (OFF)';
    } else if (currentMode === 1) {
      modeBadgeEl.className = 'text-xs font-semibold px-2.5 py-1 rounded-full bg-emerald-50 text-emerald-800 border border-emerald-200';
      modeBadgeEl.textContent = 'ตามเวลา (TIMER)';
    } else {
      modeBadgeEl.className = 'text-xs font-semibold px-2.5 py-1 rounded-full bg-sky-50 text-sky-800 border border-sky-200';
      modeBadgeEl.textContent = 'ความชื้นดิน (SMART)';
    }
  }

  const segmentedContainer = document.getElementById('cfgZoneModeSegmented');
  if (segmentedContainer) {
    if (z < 3) {
      segmentedContainer.innerHTML = `
        <div class="mode-segmented">
          <button type="button" onclick="setZoneMode(${z}, 0)" class="mode-btn ${currentMode === 0 ? 'active-off' : ''}">
            <i class="ti ti-power text-xs mr-0.5"></i> OFF (ปิด)
          </button>
          <button type="button" onclick="setZoneMode(${z}, 1)" class="mode-btn ${currentMode === 1 ? 'active-manual' : ''}">
            <i class="ti ti-clock text-xs mr-0.5"></i> TIMER (ตามเวลา)
          </button>
          <button type="button" onclick="setZoneMode(${z}, 2)" class="mode-btn ${currentMode === 2 ? 'active-auto' : ''}">
            <i class="ti ti-sparkles text-xs mr-0.5"></i> SMART (ความชื้นดิน)
          </button>
        </div>
      `;
    } else {
      segmentedContainer.innerHTML = `
        <div class="mode-segmented grid-cols-2">
          <button type="button" onclick="setZoneMode(${z}, 0)" class="mode-btn ${currentMode === 0 ? 'active-off' : ''}">
            <i class="ti ti-power text-xs mr-0.5"></i> OFF (ปิด)
          </button>
          <button type="button" onclick="setZoneMode(${z}, 1)" class="mode-btn ${currentMode === 1 ? 'active-manual' : ''}">
            <i class="ti ti-clock text-xs mr-0.5"></i> TIMER (ตามเวลา)
          </button>
        </div>
      `;
    }
  }

  if (moistStartInput) moistStartInput.value = cfg.moistureStart ?? 35;
  if (moistStopInput) moistStopInput.value = cfg.moistureStop ?? 55;

  if (moistBox) {
    if (z < 3 && currentMode === 2) {
      moistBox.classList.remove('hidden');
    } else {
      moistBox.classList.add('hidden');
    }
  }

  // Selected Zone Status / Soil Moisture Banner
  const bannerEl = document.getElementById('schedZoneBanner');
  if (bannerEl) {
    if (z === 3) {
      bannerEl.innerHTML = `
        <div class="p-3 bg-sky-50 border border-sky-200/90 rounded-2xl text-xs text-sky-900 flex items-start gap-2.5 shadow-2xs">
          <i class="ti ti-droplet-half-2 text-sky-600 text-lg flex-shrink-0 mt-0.5"></i>
          <div>
            <span class="font-bold block text-sky-950">Zone 4 (ระบบน้ำหยด) — ตั้งเวลาเท่านั้น</span>
            <p class="text-[11px] text-sky-700 mt-0.5 leading-relaxed">
              โซนนี้เป็นระบบน้ำหยด ไม่มีเซ็นเซอร์วัดความชื้นดิน การทำงานจะเปิด-ปิดตาม<b>ตารางเวลา (TIMER)</b> ที่กำหนดไว้ด้านล่างนี้
            </p>
          </div>
        </div>
      `;
    } else {
      const sVal = state.lastData?.soil?.[z];
      const sErr = state.lastData?.soilError?.[z] || sVal === null || sVal === undefined || isNaN(sVal) || sVal < 0;
      const isConnected = !sErr && typeof sVal === 'number' && sVal >= 0;
      bannerEl.innerHTML = `
        <div class="p-2.5 bg-forest-50/70 border border-forest-100 rounded-2xl text-xs text-forest-900 flex items-center justify-between shadow-2xs">
          <span class="flex items-center gap-1.5 font-semibold text-slate-700">
            <i class="ti ti-seeding text-forest-700 text-base"></i> ความชื้นดิน ${ZONE_SHORT_NAMES[z]} ปัจจุบัน:
          </span>
          <span class="font-mono font-bold ${isConnected ? 'text-forest-800 text-sm' : 'text-slate-400 text-xs'}">
            ${isConnected ? sVal.toFixed(0) + '%' : 'ไม่ได้เชื่อมต่อเซ็นเซอร์'}
          </span>
        </div>
      `;
    }
  }

  // Flow Protection setting
  const fpEl = document.getElementById('cfgFlowProtection');
  if (fpEl) {
    fpEl.checked = !!state.configData?.flowProtection;
  }

  // Get active schedules for this zone
  if (!state.zoneSchedules[z]) {
    state.zoneSchedules[z] = [{ enabled: true, hour: 6, minute: 0, duration: 10, days: 127 }];
  }

  renderScheduleSlots(state.zoneSchedules[z]);
}

document.getElementById('cfgZoneMode')?.addEventListener('change', (e) => {
  let val = parseInt(e.target.value);
  if (state.selectedZone === 3 && val === 2) {
    val = 1;
  }
  state.zoneModes[state.selectedZone] = val;

  // Update in memory config
  if (!state.configData) state.configData = { zones: [] };
  if (!state.configData.zones) state.configData.zones = [];
  if (!state.configData.zones[state.selectedZone]) state.configData.zones[state.selectedZone] = {};
  state.configData.zones[state.selectedZone].mode = val;

  const moistBox = document.getElementById('smartMoistureBox');
  if (moistBox) {
    if (val === 2 && state.selectedZone < 3) {
      moistBox.classList.remove('hidden');
    } else {
      moistBox.classList.add('hidden');
    }
  }

  // Update dashboard and control cards simultaneously
  renderDashboardZoneCards(state.lastData?.zones || []);
  renderZoneControls(state.lastData);
});

// Auto-sync moisture threshold inputs to Firebase when changed
['cfgMoistStart', 'cfgMoistStop'].forEach(id => {
  document.getElementById(id)?.addEventListener('change', () => {
    const z = state.selectedZone;
    const startVal = parseInt(document.getElementById('cfgMoistStart')?.value) || 35;
    const stopVal = parseInt(document.getElementById('cfgMoistStop')?.value) || 55;
    if (!state.configData) state.configData = { zones: [] };
    if (!state.configData.zones) state.configData.zones = [];
    if (!state.configData.zones[z]) state.configData.zones[z] = {};
    state.configData.zones[z].moistureStart = startVal;
    state.configData.zones[z].moistureStop = stopVal;

    const updates = {};
    updates[`devices/esp32/config/z${z}_moistStart`] = startVal;
    updates[`devices/esp32/config/z${z}_moistStop`] = stopVal;
    updates[`devices/esp32/config/zones/${z}/moistureStart`] = startVal;
    updates[`devices/esp32/config/zones/${z}/moistureStop`] = stopVal;
    updates[`devices/esp32/config/configVersion`] = Math.floor(Date.now() / 1000);
    db.ref().update(updates).catch(err => handleFirebaseError(err, 'updateMoistureThresholds'));
  });
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
        <!-- 24-Hour Time Picker (No AM/PM) -->
        <div>
          <label class="text-[11px] font-semibold text-slate-600 block mb-1">
            <i class="ti ti-clock text-xs text-forest-600 mr-0.5"></i> เวลาเริ่ม (ระบบ 24 ชม.):
          </label>
          <div class="flex items-center gap-1 bg-surface-subtle border border-slate-200 rounded-xl p-1 focus-within:ring-2 focus-within:ring-forest-500">
            <!-- Hour Select (00-23) -->
            <select id="schHour_${s}" onchange="updateScheduleSlotState(${s})" class="flex-1 bg-white border border-slate-200 rounded-lg py-1.5 px-1 text-center text-xs font-bold text-slate-800 outline-none cursor-pointer focus:border-forest-500">
              ${Array.from({length: 24}, (_, i) => {
                const hStr = String(i).padStart(2, '0');
                return `<option value="${i}" ${sch.hour === i ? 'selected' : ''}>${hStr}</option>`;
              }).join('')}
            </select>
            <span class="font-bold text-slate-400 text-xs">:</span>
            <!-- Minute Select (00-59) -->
            <select id="schMin_${s}" onchange="updateScheduleSlotState(${s})" class="flex-1 bg-white border border-slate-200 rounded-lg py-1.5 px-1 text-center text-xs font-bold text-slate-800 outline-none cursor-pointer focus:border-forest-500">
              ${Array.from({length: 60}, (_, i) => {
                const mStr = String(i).padStart(2, '0');
                return `<option value="${i}" ${sch.minute === i ? 'selected' : ''}>${mStr}</option>`;
              }).join('')}
            </select>
            <span class="text-[10px] font-bold text-slate-500 pr-1 select-none">น.</span>
          </div>
          <input type="hidden" id="schTime_${s}" value="${timeStr}">
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
              <span class="text-[10px] text-slate-500 ml-0.5 font-bold">นาที</span>
              <input type="hidden" id="schDur_${s}" value="${sch.duration || 10}">
            </div>
            <button type="button" onclick="stepScheduleDuration(${s}, 1)" class="stepper-btn" title="เพิ่ม 1 นาที">
              +
            </button>
          </div>
        </div>
      </div>

      <!-- Quick Preset Chips: Time & Duration -->
      <div class="flex flex-wrap items-center justify-between gap-y-1 gap-x-2 pt-0.5">
        <div class="flex items-center gap-1">
          <span class="text-[10px] text-slate-400">เวลาด่วน:</span>
          ${[
            { label: '06:00', h: 6, m: 0 },
            { label: '12:00', h: 12, m: 0 },
            { label: '17:00', h: 17, m: 0 },
            { label: '20:00', h: 20, m: 0 }
          ].map(p => `
            <button type="button" onclick="setScheduleTimePreset(${s}, ${p.h}, ${p.m})" class="px-1.5 py-0.5 text-[10px] font-semibold rounded-md bg-slate-100 hover:bg-forest-100 hover:text-forest-800 text-slate-600 transition">
              ${p.label}
            </button>
          `).join('')}
        </div>
        <div class="flex items-center gap-1">
          <span class="text-[10px] text-slate-400">ระยะเวลา:</span>
          ${[5, 10, 15, 20, 30].map(m => `
            <button type="button" onclick="setScheduleDuration(${s}, ${m})" class="px-1.5 py-0.5 text-[10px] font-semibold rounded-md bg-slate-100 hover:bg-emerald-100 hover:text-forest-800 text-slate-600 transition">
              ${m} นาที
            </button>
          `).join('')}
        </div>
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

// Quick 24h Time Preset (e.g. 06:00, 12:00, 17:00, 20:00)
function setScheduleTimePreset(slotIndex, hour, minute) {
  const hEl = document.getElementById(`schHour_${slotIndex}`);
  const mEl = document.getElementById(`schMin_${slotIndex}`);
  if (hEl) hEl.value = hour;
  if (mEl) mEl.value = minute;
  updateScheduleSlotState(slotIndex);
}

// Update slot in memory when inputs change
function updateScheduleSlotState(slotIndex) {
  const z = state.selectedZone;
  if (!state.zoneSchedules[z] || !state.zoneSchedules[z][slotIndex]) return;

  const enabled = document.getElementById(`schEnabled_${slotIndex}`)?.checked ?? true;
  const hEl = document.getElementById(`schHour_${slotIndex}`);
  const mEl = document.getElementById(`schMin_${slotIndex}`);

  let h = 6;
  let m = 0;
  if (hEl && mEl) {
    h = parseInt(hEl.value, 10);
    m = parseInt(mEl.value, 10);
  } else {
    const timeVal = document.getElementById(`schTime_${slotIndex}`)?.value || '06:00';
    const parts = timeVal.split(':').map(Number);
    h = parts[0] || 0;
    m = parts[1] || 0;
  }

  state.zoneSchedules[z][slotIndex].enabled = enabled;
  state.zoneSchedules[z][slotIndex].hour = isNaN(h) ? 0 : h;
  state.zoneSchedules[z][slotIndex].minute = isNaN(m) ? 0 : m;

  const hidden = document.getElementById(`schTime_${slotIndex}`);
  if (hidden) {
    hidden.value = `${String(state.zoneSchedules[z][slotIndex].hour).padStart(2, '0')}:${String(state.zoneSchedules[z][slotIndex].minute).padStart(2, '0')}`;
  }
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
  const mode = state.zoneModes[z] ?? 1;
  const enabled = (mode !== 0);
  const moistureStart = parseInt(document.getElementById('cfgMoistStart').value) || 35;
  const moistureStop = parseInt(document.getElementById('cfgMoistStop').value) || 55;

  const activeList = state.zoneSchedules[z] || [];
  const schedulesToSave = [];

  for (let s = 0; s < 4; s++) {
    if (s < activeList.length) {
      const sch = activeList[s];
      const sEnabled = document.getElementById(`schEnabled_${s}`)?.checked ?? sch.enabled;
      
      let h = sch.hour;
      let m = sch.minute;
      const hEl = document.getElementById(`schHour_${s}`);
      const mEl = document.getElementById(`schMin_${s}`);
      if (hEl && mEl) {
        h = parseInt(hEl.value, 10);
        m = parseInt(mEl.value, 10);
      } else {
        const timeVal = document.getElementById(`schTime_${s}`)?.value;
        if (timeVal) {
          const parts = timeVal.split(':').map(Number);
          h = parts[0];
          m = parts[1];
        }
      }

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

  // Update memory state
  state.zoneModes[z] = mode;
  if (!state.configData) state.configData = { zones: [] };
  if (!state.configData.zones) state.configData.zones = [];
  state.configData.zones[z] = zoneConfig;

  // Immediately reflect across all views
  renderDashboardZoneCards(state.lastData?.zones || []);
  renderZoneControls(state.lastData);

  // Write to Firebase (Write both nested object and flat keys for ESP32)
  const tsSec = Math.floor(Date.now() / 1000);
  const updates = {};
  updates[`devices/esp32/config/zones/${z}`] = zoneConfig;
  updates[`devices/esp32/config/z${z}_enabled`] = enabled;
  updates[`devices/esp32/config/z${z}_mode`] = mode;
  updates[`devices/esp32/config/z${z}_moistStart`] = moistureStart;
  updates[`devices/esp32/config/z${z}_moistStop`] = moistureStop;
  for (let s = 0; s < 4; s++) {
    const sc = schedulesToSave[s] || { enabled: false, hour: 0, minute: 0, duration: 0, days: 0 };
    updates[`devices/esp32/config/z${z}_s${s}_en`] = sc.enabled ?? false;
    updates[`devices/esp32/config/z${z}_s${s}_h`] = sc.hour ?? 0;
    updates[`devices/esp32/config/z${z}_s${s}_m`] = sc.minute ?? 0;
    updates[`devices/esp32/config/z${z}_s${s}_dur`] = sc.duration ?? 0;
    updates[`devices/esp32/config/z${z}_s${s}_days`] = sc.days ?? 0;
  }
  const flowProtection = document.getElementById('cfgFlowProtection')?.checked ?? false;
  updates[`devices/esp32/config/flowProtection`] = flowProtection;
  if (!state.configData) state.configData = {};
  state.configData.flowProtection = flowProtection;

  updates[`devices/esp32/config/configVersion`] = tsSec;

  // Button instant visual feedback (0ms latency!)
  const btn = document.getElementById('btnSaveConfig');
  const origHtml = btn ? btn.innerHTML : '';
  if (btn) {
    btn.innerHTML = '<i class="ti ti-check text-lg"></i> บันทึกแล้ว กำลังซิงค์...';
    btn.classList.add('bg-emerald-600');
    btn.classList.remove('bg-forest-700');
  }

  // Toast feedback instantly without waiting on network
  Swal.fire({
    toast: true,
    position: 'top',
    icon: 'success',
    title: `บันทึกการตั้งค่า ${ZONE_SHORT_NAMES[z]} สำเร็จ 🌿`,
    text: 'การตั้งค่ามีผลทันที และส่งไปยังบอร์ดแล้ว',
    showConfirmButton: false,
    timer: 1800
  });

  db.ref().update(updates).then(() => {
    if (btn) {
      setTimeout(() => {
        btn.innerHTML = origHtml;
        btn.classList.remove('bg-emerald-600');
        btn.classList.add('bg-forest-700');
      }, 700);
    }
  }).catch((err) => {
    if (btn) {
      btn.innerHTML = origHtml;
      btn.classList.remove('bg-emerald-600');
      btn.classList.add('bg-forest-700');
    }
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

// Helper to parse true epoch timestamp from record
function getRecordTimestamp(r) {
  if (r && r.date && r.time) {
    const timePart = r.time.length === 5 ? r.time + ':00' : r.time;
    const parsed = Date.parse(`${r.date}T${timePart}+07:00`);
    if (!isNaN(parsed) && parsed > 1700000000000) {
      return parsed;
    }
  }
  if (r && typeof r.timestamp === 'number' && r.timestamp > 1700000000000) {
    return r.timestamp;
  }
  return 0;
}

const THAI_MONTH_SHORT = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];

function formatRecordLabel(r, isMultiDay) {
  const timeStr = r.time ? r.time.slice(0, 5) : '';
  if (!isMultiDay) {
    return timeStr || '--:--';
  }
  if (r.date) {
    const parts = r.date.split('-');
    if (parts.length === 3) {
      const day = parseInt(parts[2], 10);
      const mIdx = parseInt(parts[1], 10) - 1;
      const mName = THAI_MONTH_SHORT[mIdx] || '';
      return `${day} ${mName} ${timeStr}`;
    }
  }
  return `${r.date} ${timeStr}`;
}

function getFilteredHistory(range) {
  const raw = state.firebaseHistory || [];
  // 1. Filter out corrupt / placeholder records (0000, 2000, 2024, temp <= 0)
  const valid = raw.filter(r => {
    if (!r || typeof r !== 'object') return false;
    if (!r.date || r.date.startsWith('0000') || r.date.startsWith('2000') || r.date.startsWith('2024')) return false;
    if (typeof r.temperature !== 'number' || isNaN(r.temperature) || r.temperature <= 0 || r.temperature > 80) return false;
    return true;
  });

  if (valid.length === 0) return [];

  // 2. Sort chronologically
  valid.sort((a, b) => getRecordTimestamp(a) - getRecordTimestamp(b));

  // 3. Filter by range
  const latestTs = getRecordTimestamp(valid[valid.length - 1]);
  const now = Math.max(Date.now(), latestTs);

  let cutoff = 0;
  if (range === '1d') {
    cutoff = latestTs - (24 * 3600 * 1000);
  } else if (range === '1w') {
    cutoff = now - (7 * 86400 * 1000);
  } else if (range === '1m') {
    cutoff = now - (30 * 86400 * 1000);
  } else {
    cutoff = now - (90 * 86400 * 1000);
  }

  let filtered = valid.filter(r => getRecordTimestamp(r) >= cutoff);
  if (filtered.length === 0 && range === '1d' && valid.length > 0) {
    const latestDate = valid[valid.length - 1].date;
    filtered = valid.filter(r => r.date === latestDate);
  }

  return filtered;
}

function getChartDataset(metric, range) {
  const records = getFilteredHistory(range);
  const isMultiDay = range !== '1d';

  if (records.length === 0) {
    return {
      type: 'line',
      beginAtZero: false,
      data: {
        labels: ['ยังไม่มีข้อมูลประวัติ'],
        datasets: [
          {
            label: 'ไม่มีข้อมูลประวัติบันทึกจริง',
            data: [null],
            borderColor: '#cbd5e1',
            borderDash: [5, 5],
            fill: false
          }
        ]
      }
    };
  }

  // Downsample if more than 50 points to prevent label crowding
  let displayRecords = records;
  if (records.length > 50) {
    const step = Math.ceil(records.length / 40);
    displayRecords = records.filter((_, idx) => idx % step === 0 || idx === records.length - 1);
  }

  const labels = displayRecords.map(r => formatRecordLabel(r, isMultiDay));
  const tempPoints = displayRecords.map(r => typeof r.temperature === 'number' ? parseFloat(r.temperature.toFixed(1)) : null);
  const humidPoints = displayRecords.map(r => typeof r.humidity === 'number' ? parseFloat(r.humidity.toFixed(1)) : null);

  // Real soil data: null if disconnected (< 0), never fake numbers
  const soil0Points = displayRecords.map(r => (r.soil && typeof r.soil[0] === 'number' && r.soil[0] >= 0) ? r.soil[0] : null);
  const soil1Points = displayRecords.map(r => (r.soil && typeof r.soil[1] === 'number' && r.soil[1] >= 0) ? r.soil[1] : null);
  const soil2Points = displayRecords.map(r => (r.soil && typeof r.soil[2] === 'number' && r.soil[2] >= 0) ? r.soil[2] : null);

  const waterPoints = displayRecords.map(r => typeof r.waterTotal === 'number' ? parseFloat(r.waterTotal.toFixed(2)) : 0);
  const flowPoints = displayRecords.map(r => typeof r.flowRate === 'number' ? parseFloat(r.flowRate.toFixed(2)) : 0);

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
            pointRadius: displayRecords.length > 25 ? 2 : 3.5,
            spanGaps: true
          },
          {
            label: 'ความชื้นอากาศ (%)',
            data: humidPoints,
            borderColor: '#0284c7',
            backgroundColor: 'rgba(2, 132, 199, 0.08)',
            tension: 0.35,
            fill: true,
            borderWidth: 2.5,
            pointRadius: displayRecords.length > 25 ? 2 : 3.5,
            spanGaps: true
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
            label: 'Zone 1 ความชื้นดิน (%)',
            data: soil0Points,
            borderColor: '#10b981',
            tension: 0.35,
            fill: false,
            borderWidth: 2.5,
            pointRadius: 3,
            spanGaps: false
          },
          {
            label: 'Zone 2 ความชื้นดิน (%)',
            data: soil1Points,
            borderColor: '#0d9488',
            tension: 0.35,
            fill: false,
            borderWidth: 2.5,
            pointRadius: 3,
            spanGaps: false
          },
          {
            label: 'Zone 3 ความชื้นดิน (%)',
            data: soil2Points,
            borderColor: '#65a30d',
            tension: 0.35,
            fill: false,
            borderWidth: 2.5,
            pointRadius: 3,
            spanGaps: false
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
            label: 'ปริมาณน้ำสะสม (L)',
            data: waterPoints,
            backgroundColor: 'rgba(21, 128, 61, 0.75)',
            borderRadius: 6
          },
          {
            type: 'line',
            label: 'อัตราการไหล (L/m)',
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
  if (!data || typeof data.temperature !== 'number' || isNaN(data.temperature) || data.temperature <= 0) return;
  const now = Date.now();
  if (state.lastHistoryRecordTime && (now - state.lastHistoryRecordTime < 10 * 60 * 1000)) return;
  state.lastHistoryRecordTime = now;

  const item = {
    timestamp: now,
    time: data.time || new Date().toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit', hour12: false }),
    date: data.date || new Date().toISOString().slice(0, 10),
    temperature: parseFloat(data.temperature.toFixed(1)),
    humidity: parseFloat(data.humidity.toFixed(1)),
    soil: data.soil || [-1, -1, -1],
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

  ['1d', '1w', '1m', '3m'].forEach(r => {
    const btn = document.getElementById(`btnRange${r}`);
    if (btn) {
      if (r === range) {
        btn.className = 'px-2 py-0.5 rounded-lg bg-white text-forest-700 shadow-2xs font-bold transition';
      } else {
        btn.className = 'px-2 py-0.5 rounded-lg text-slate-500 hover:text-slate-800 transition font-medium';
      }
    }
  });

  initHistoricalChart();
}

function updateChartSummaryText(metric, range) {
  const summaryEl = document.getElementById('chartSummaryText');
  if (!summaryEl) return;

  const rangeLabels = {
    '1d': '24 ชม. ล่าสุด',
    '1w': '7 วันที่ผ่านมา',
    '1m': '1 เดือนที่ผ่านมา',
    '3m': '3 เดือนย้อนหลัง'
  };
  const rangeText = rangeLabels[range] || '24 ชม. ล่าสุด';

  const records = getFilteredHistory(range);
  if (records.length === 0) {
    summaryEl.textContent = `ยังไม่มีข้อมูลประวัติบันทึกจริงในช่วงเวลานี้ (${rangeText})`;
    return;
  }

  if (metric === 'env') {
    const temps = records.map(r => r.temperature).filter(t => typeof t === 'number' && !isNaN(t));
    const humids = records.map(r => r.humidity).filter(h => typeof h === 'number' && !isNaN(h));
    
    const avgT = (temps.reduce((a, b) => a + b, 0) / temps.length).toFixed(1);
    const minT = Math.min(...temps).toFixed(1);
    const maxT = Math.max(...temps).toFixed(1);
    const avgH = Math.round(humids.reduce((a, b) => a + b, 0) / humids.length);

    summaryEl.textContent = `อุณหภูมิเฉลี่ย ${avgT}°C (${minT} - ${maxT}°C) • ความชื้นเฉลี่ย ${avgH}% (${rangeText})`;
  } else if (metric === 'soil') {
    const valid0 = records.filter(r => r.soil && typeof r.soil[0] === 'number' && r.soil[0] >= 0).map(r => r.soil[0]);
    const valid1 = records.filter(r => r.soil && typeof r.soil[1] === 'number' && r.soil[1] >= 0).map(r => r.soil[1]);
    const valid2 = records.filter(r => r.soil && typeof r.soil[2] === 'number' && r.soil[2] >= 0).map(r => r.soil[2]);

    if (valid0.length === 0 && valid1.length === 0 && valid2.length === 0) {
      summaryEl.textContent = `เซ็นเซอร์ความชื้นดินยังไม่ได้เชื่อมต่อ (สถานะ: Disconnected) • ${rangeText}`;
    } else {
      const p0 = valid0.length ? `${(valid0.reduce((a, b) => a + b, 0) / valid0.length).toFixed(0)}%` : 'ไม่ต่อ';
      const p1 = valid1.length ? `${(valid1.reduce((a, b) => a + b, 0) / valid1.length).toFixed(0)}%` : 'ไม่ต่อ';
      const p2 = valid2.length ? `${(valid2.reduce((a, b) => a + b, 0) / valid2.length).toFixed(0)}%` : 'ไม่ต่อ';
      summaryEl.textContent = `ความชื้นดินเฉลี่ย: แปลง 1: ${p0} • แปลง 2: ${p1} • แปลง 3: ${p2} (${rangeText})`;
    }
  } else {
    // Water metric
    const maxWater = records.reduce((max, r) => Math.max(max, r.waterTotal ?? 0), 0);
    const avgFlow = (records.reduce((sum, r) => sum + (r.flowRate ?? 0), 0) / records.length).toFixed(2);
    summaryEl.textContent = `การใช้น้ำสะสม: ${maxWater.toFixed(1)} ลิตร • อัตราไหลเฉลี่ย ${avgFlow} L/m (${rangeText})`;
  }
}

// Clear Chart History Function with SweetAlert2 2-Step Confirmation
function confirmClearHistory() {
  Swal.fire({
    title: 'ล้างข้อมูลกราฟย้อนหลัง? 🗑️',
    text: 'ต้องการลบข้อมูลสถิติและกราฟย้อนหลังทั้งหมดใช่หรือไม่? เมื่อลบแล้วข้อมูลเดิมจะไม่สามารถกู้คืนได้',
    icon: 'warning',
    input: 'text',
    inputPlaceholder: 'พิมพ์คำว่า "ยืนยัน" เพื่อลบ',
    showCancelButton: true,
    confirmButtonText: 'ลบประวัติกราฟ',
    cancelButtonText: 'ยกเลิก',
    confirmButtonColor: '#E11D48',
    cancelButtonColor: '#64748B',
    inputValidator: (value) => {
      if (value !== 'ยืนยัน') {
        return 'กรุณาพิมพ์คำว่า "ยืนยัน" ให้ถูกต้องเพื่อความปลอดภัย';
      }
    }
  }).then((result) => {
    if (result.isConfirmed) {
      historyRef.remove().then(() => {
        state.firebaseHistory = [];
        initHistoricalChart();
        Swal.fire({
          toast: true,
          position: 'top',
          icon: 'success',
          title: 'ล้างประวัติกราฟย้อนหลังเรียบร้อยแล้ว',
          showConfirmButton: false,
          timer: 2000
        });
      }).catch((err) => {
        handleFirebaseError(err, 'clearHistory');
      });
    }
  });
}

function updateHistoricalChartLive(data) {
  if (!historicalChartInstance || state.chartRange !== '1d') return;
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

  // Hardware Status (Support both data.hardware from ESP32 and legacy data.hw)
  const hw = data.hardware || data.hw || {};
  setHwBadge('hwLcdStatus', hw.lcd);
  setHwBadge('hwRtcStatus', hw.rtc);
  setHwBadge('hwSht30Status', hw.sht30);
  setHwBadge('hwSdStatus', hw.sd);
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
        manualZone: -1,
        manualAction: 'none',
        manualDuration: 10,
        resetAlarm: true,
        timestamp: Math.floor(Date.now() / 1000),
        source: 'web_app'
      }).then(() => {
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
        reg.update();
      })
      .catch((err) => {
        console.warn('[PWA] Service Worker registration failed:', err);
      });
  });

  // Ensure PWA updates when brought back to foreground
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      navigator.serviceWorker.getRegistration().then((reg) => {
        if (reg) reg.update();
      });
    }
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

  // Live Clock & Date Ticker (Smoothly ticks synchronized with Thailand Standard Time UTC+7)
  function getThailandDateTime() {
    const atomicUtc = Date.now() + (typeof serverTimeOffset === 'number' ? serverTimeOffset : 0);
    const thDate = new Date(atomicUtc + (7 * 3600 * 1000));
    return {
      year: thDate.getUTCFullYear(),
      month: String(thDate.getUTCMonth() + 1).padStart(2, '0'),
      day: String(thDate.getUTCDate()).padStart(2, '0'),
      hour: String(thDate.getUTCHours()).padStart(2, '0'),
      minute: String(thDate.getUTCMinutes()).padStart(2, '0'),
      second: String(thDate.getUTCSeconds()).padStart(2, '0')
    };
  }

  let lastClockStr = '';
  let lastDateStr = '';
  function updateLiveDateTime() {
    const clockEl = document.getElementById('clockDisplay');
    const dateEl = document.getElementById('dateDisplay');
    const th = getThailandDateTime();
    const timeStr = `${th.hour}:${th.minute}:${th.second}`;
    const dateStr = `${th.year}-${th.month}-${th.day}`;

    if (clockEl && timeStr !== lastClockStr) {
      clockEl.textContent = timeStr;
      lastClockStr = timeStr;
    }

    if (dateEl && dateStr !== lastDateStr) {
      dateEl.textContent = dateStr;
      lastDateStr = dateStr;
    }
  }
  setInterval(updateLiveDateTime, 200);
  updateLiveDateTime();

  // Initialize Historical Chart
  initHistoricalChart();
});
