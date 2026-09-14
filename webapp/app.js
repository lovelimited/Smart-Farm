/* ================================================================
   🌿 Verdante Smart Farm — Auto Watering & Monitoring System
   Firebase Realtime Database + Tailwind + SweetAlert2 Logic
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

const db = firebase.database();
const statusRef = db.ref('devices/esp32/status');
const commandRef = db.ref('devices/esp32/commands');
const configRef = db.ref('devices/esp32/config');
const alarmHistoryRef = db.ref('devices/esp32/alarmHistory');
const wifiConfigRef = db.ref('devices/esp32/wifi_config');

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
  wizardStep: 1,
};

const ZONE_NAMES = ['Zone 1 (แปลงผักสลัด)', 'Zone 2 (แปลงเมลอน)', 'Zone 3 (แปลงมะเขือเทศ)', 'Zone 4 (ระบบพ่นหมอก)'];
const ZONE_SHORT_NAMES = ['Zone 1', 'Zone 2', 'Zone 3', 'Zone 4'];
const ZONE_COLORS = ['#10b981', '#0d9488', '#16a34a', '#0284c7'];
const MODE_NAMES = ['OFF', 'TIMER', 'SMART'];
const DAY_LABELS = ['อา', 'จ', 'อ', 'พ', 'พฤ', 'ศ', 'ส'];

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

  // Scroll to top
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

// ================================================================
//  FIREBASE REALTIME LISTENERS
// ================================================================

// 1. Listen for device status
statusRef.on('value', (snapshot) => {
  const data = snapshot.val();
  if (!data) {
    setConnectionState(false);
    return;
  }
  setConnectionState(true);
  state.lastData = data;
  renderDashboard(data);
  renderZoneControls(data);
  renderAlarmPage(data);
}, (error) => {
  console.warn('[Firebase] Status listen error:', error);
  setConnectionState(false);
});

// 2. Listen for Firebase network connection
db.ref('.info/connected').on('value', (snap) => {
  const isOnline = snap.val() === true;
  if (!isOnline && !state.lastData) {
    setConnectionState(false);
  }
});

// 3. Listen for Config changes
configRef.on('value', (snapshot) => {
  const data = snapshot.val();
  if (data) {
    state.configData = data;
    renderScheduleSettings();
  }
});

// 4. Listen for Alarm history
alarmHistoryRef.orderByKey().limitToLast(15).on('value', (snapshot) => {
  renderAlarmHistory(snapshot.val());
});

// ================================================================
//  CONNECTION STATE HANDLER
// ================================================================
function setConnectionState(connected) {
  state.connected = connected;
  const dot = document.getElementById('connDot');
  const text = document.getElementById('connText');
  const banner = document.getElementById('offlineBanner');

  if (connected) {
    dot.className = 'w-2 h-2 rounded-full bg-emerald-500 animate-pulse';
    text.textContent = 'ออนไลน์';
    text.className = 'font-semibold text-emerald-700';
    if (banner) banner.classList.add('hidden');
  } else {
    dot.className = 'w-2 h-2 rounded-full bg-slate-300';
    text.textContent = 'ออฟไลน์';
    text.className = 'font-medium text-slate-500';
    if (banner) banner.classList.remove('hidden');
  }
}

// ================================================================
//  DASHBOARD RENDERING
// ================================================================
function renderDashboard(data) {
  if (!data) return;

  // Clock
  if (data.time) {
    document.getElementById('clockDisplay').textContent = data.time;
  }

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
  if (typeof temp === 'number') {
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
  if (typeof hum === 'number') {
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
    const statusEl = document.getElementById(`soilStatus${i}`);

    if (err) {
      valEl.textContent = 'ERR';
      gaugeEl.setAttribute('stroke-dasharray', `0 ${circumference}`);
      if (statusEl) {
        statusEl.textContent = 'เซนเซอร์ขัดข้อง';
        statusEl.className = 'text-[10px] text-rose-500 font-semibold';
      }
    } else {
      const pct = typeof val === 'number' ? Math.max(0, Math.min(100, val)) : 0;
      valEl.textContent = typeof val === 'number' ? val.toFixed(0) : '--';
      const dash = (pct / 100) * circumference;
      gaugeEl.setAttribute('stroke-dasharray', `${dash} ${circumference}`);
      
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

  // Dashboard Zone Mini Cards
  renderDashboardZoneCards(data.zones || []);
}

function renderDashboardZoneCards(zones) {
  const container = document.getElementById('dashZoneCards');
  if (!container) return;

  container.innerHTML = '';

  for (let z = 0; z < 4; z++) {
    const zone = zones[z] || {};
    const isRunning = zone.running;
    const isAlarm = zone.alarm;
    const card = document.createElement('div');
    
    card.className = `p-3 rounded-2xl border transition-all duration-300 ${
      isRunning 
        ? 'bg-emerald-50/80 border-emerald-300 shadow-sm' 
        : 'bg-white border-slate-200/80 shadow-xs'
    }`;

    let statusBadge = '';
    if (isAlarm) {
      statusBadge = '<span class="text-[10px] font-bold px-2 py-0.5 rounded-full bg-rose-100 text-rose-700">ALARM</span>';
    } else if (isRunning) {
      statusBadge = `<span class="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-200 text-emerald-800 flex items-center gap-1">
        <span class="w-1.5 h-1.5 rounded-full bg-emerald-600 animate-ping"></span> ${zone.manual ? 'MANUAL' : 'AUTO'}
      </span>`;
    } else {
      statusBadge = `<span class="text-[10px] font-medium px-2 py-0.5 rounded-full bg-slate-100 text-slate-600">${zone.enabled ? 'READY' : 'OFF'}</span>`;
    }

    let timerText = '';
    if (isRunning && zone.remaining !== undefined) {
      const m = Math.floor(zone.remaining / 60);
      const s = zone.remaining % 60;
      timerText = `<div class="mt-2 text-xs font-mono font-bold text-emerald-700 flex items-center gap-1">
        <i class="ti ti-clock"></i> เหลือ ${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}
      </div>`;
    }

    card.innerHTML = `
      <div class="flex items-center justify-between mb-1.5">
        <span class="text-xs font-bold text-slate-800">${ZONE_SHORT_NAMES[z]}</span>
        ${statusBadge}
      </div>
      <div class="text-[11px] text-slate-500">ใช้น้ำ: <b class="text-slate-700 font-mono">${(zone.waterUsed ?? 0).toFixed(2)}</b> L</div>
      ${timerText}
      <div class="mt-3 pt-2 border-t border-slate-100 flex items-center justify-between">
        <span class="text-[10px] text-slate-400">โหมด: ${MODE_NAMES[zone.mode] || 'OFF'}</span>
        ${isRunning 
          ? `<button onclick="confirmStopZone(${z})" class="px-2 py-1 bg-rose-50 text-rose-600 hover:bg-rose-100 rounded-lg text-[10px] font-bold transition">ปิดน้ำ</button>`
          : `<button onclick="confirmStartZone(${z})" class="px-2 py-1 bg-forest-50 text-forest-700 hover:bg-forest-100 rounded-lg text-[10px] font-bold transition">รดน้ำ</button>`
        }
      </div>
    `;

    container.appendChild(card);
  }
}

// ================================================================
//  ZONE CONTROLS PAGE
// ================================================================
function renderZoneControls(data) {
  const container = document.getElementById('zoneControlsList');
  if (!container) return;

  const d = data || state.lastData || {
    zones: [
      { mode: 1, enabled: true, running: false, waterUsed: 0 },
      { mode: 1, enabled: true, running: false, waterUsed: 0 },
      { mode: 2, enabled: true, running: false, waterUsed: 0 },
      { mode: 1, enabled: false, running: false, waterUsed: 0 }
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
            ${sErr ? 'ERR' : (typeof sVal === 'number' ? sVal.toFixed(0) + '%' : '--')}
          </span>
        </div>
      `;
    }

    card.innerHTML = `
      <div class="flex items-center justify-between mb-3">
        <div class="flex items-center gap-2">
          <div class="w-8 h-8 rounded-xl ${isRunning ? 'bg-emerald-600 text-white animate-bounce' : 'bg-forest-100 text-forest-700'} flex items-center justify-center">
            <i class="ti ti-droplet text-lg"></i>
          </div>
          <div>
            <h4 class="font-bold text-sm text-slate-900">${ZONE_NAMES[z]}</h4>
            <span class="text-[11px] text-slate-400">โหมด: ${MODE_NAMES[zone.mode] || 'OFF'}</span>
          </div>
        </div>
        <div>
          ${isAlarm 
            ? '<span class="px-2.5 py-1 text-xs font-bold rounded-full bg-rose-100 text-rose-700">ALARM</span>' 
            : isRunning 
              ? '<span class="px-2.5 py-1 text-xs font-bold rounded-full bg-emerald-100 text-emerald-800">กำลังรดน้ำ</span>'
              : `<span class="px-2.5 py-1 text-xs font-semibold rounded-full bg-slate-100 text-slate-600">${zone.enabled ? 'พร้อมใช้งาน' : 'ปิดการทำงาน'}</span>`
          }
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

      <!-- Duration Selector & Action Buttons -->
      ${!isRunning ? `
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
      ` : `
        <div class="mt-3 pt-3 border-t border-slate-100">
          <button onclick="confirmStopZone(${z})" class="w-full h-11 bg-rose-600 hover:bg-rose-700 text-white rounded-2xl font-semibold text-xs flex items-center justify-center gap-2 transition active:scale-[0.98] shadow-md shadow-rose-900/10">
            <i class="ti ti-player-stop text-base"></i>
            <span>หยุดรดน้ำทันที</span>
          </button>
        </div>
      `}
    `;

    container.appendChild(card);
  }
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
        <div class="p-3 bg-emerald-50 rounded-xl border border-emerald-200 text-xs text-emerald-800">
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

// 3. Send Manual Command to Firebase
function sendManualCommand(zone, action, duration) {
  commandRef.set({
    manualZone: zone,
    manualAction: action,
    manualDuration: duration,
    timestamp: Date.now(),
    source: 'web_app'
  }).catch((err) => {
    console.error('Failed to send command:', err);
    Swal.fire({
      icon: 'error',
      title: 'ส่งคำสั่งไม่สำเร็จ',
      text: err.message,
      confirmButtonColor: '#15803D'
    });
  });
}

// ================================================================
//  SCHEDULE & CONFIGURATION PAGE
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
  const cfg = state.configData?.zones?.[z] || {
    enabled: true,
    mode: 1,
    moistureStart: 35,
    moistureStop: 55,
    schedules: [
      { enabled: true, hour: 6, minute: 0, duration: 10, days: 127 },
      { enabled: true, hour: 17, minute: 30, duration: 15, days: 127 },
      { enabled: false, hour: 12, minute: 0, duration: 5, days: 127 },
      { enabled: false, hour: 0, minute: 0, duration: 0, days: 0 }
    ]
  };

  // Inputs
  const enabledInput = document.getElementById('cfgZoneEnabled');
  const modeInput = document.getElementById('cfgZoneMode');
  const moistBox = document.getElementById('smartMoistureBox');
  const moistStartInput = document.getElementById('cfgMoistStart');
  const moistStopInput = document.getElementById('cfgMoistStop');

  if (enabledInput) enabledInput.checked = !!cfg.enabled;
  if (modeInput) modeInput.value = cfg.mode ?? 1;
  if (moistStartInput) moistStartInput.value = cfg.moistureStart ?? 35;
  if (moistStopInput) moistStopInput.value = cfg.moistureStop ?? 55;

  if (moistBox) {
    if (parseInt(modeInput.value) === 2) {
      moistBox.classList.remove('hidden');
    } else {
      moistBox.classList.add('hidden');
    }
  }

  // Schedule Slots
  renderScheduleSlots(cfg.schedules || []);
}

document.getElementById('cfgZoneMode')?.addEventListener('change', (e) => {
  const moistBox = document.getElementById('smartMoistureBox');
  if (moistBox) {
    if (parseInt(e.target.value) === 2) {
      moistBox.classList.remove('hidden');
    } else {
      moistBox.classList.add('hidden');
    }
  }
});

function renderScheduleSlots(schedules) {
  const container = document.getElementById('scheduleSlotsList');
  if (!container) return;

  container.innerHTML = '';

  for (let s = 0; s < 4; s++) {
    const sch = schedules[s] || { enabled: false, hour: 6, minute: 0, duration: 10, days: 127 };
    const timeStr = `${String(sch.hour).padStart(2, '0')}:${String(sch.minute).padStart(2, '0')}`;
    const card = document.createElement('div');

    card.className = 'bg-white rounded-2xl p-3.5 border border-slate-200/80 shadow-xs space-y-3';
    card.innerHTML = `
      <div class="flex items-center justify-between">
        <span class="text-xs font-bold text-slate-800 flex items-center gap-1.5">
          <i class="ti ti-alarm text-forest-700"></i> ช่วงเวลาที่ ${s + 1}
        </span>
        <label class="relative inline-flex items-center cursor-pointer">
          <input type="checkbox" id="schEnabled_${s}" ${sch.enabled ? 'checked' : ''} class="sr-only peer">
          <div class="w-9 h-5 bg-slate-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-forest-600"></div>
        </label>
      </div>

      <div class="grid grid-cols-2 gap-2">
        <div>
          <label class="text-[11px] text-slate-400 block mb-1">เวลาเริ่มรด:</label>
          <input type="time" id="schTime_${s}" value="${timeStr}" class="w-full bg-surface-subtle border border-slate-200 rounded-xl px-2.5 py-1.5 text-xs font-semibold text-slate-800 outline-none focus:ring-1 focus:ring-forest-500">
        </div>
        <div>
          <label class="text-[11px] text-slate-400 block mb-1">ระยะเวลา (นาที):</label>
          <input type="number" id="schDur_${s}" min="1" max="120" value="${sch.duration || 10}" class="w-full bg-surface-subtle border border-slate-200 rounded-xl px-2.5 py-1.5 text-xs font-semibold text-slate-800 outline-none focus:ring-1 focus:ring-forest-500">
        </div>
      </div>

      <!-- Days of week -->
      <div>
        <span class="text-[11px] text-slate-400 block mb-1">วันในสัปดาห์:</span>
        <div class="flex gap-1">
          ${DAY_LABELS.map((day, dIdx) => {
            const isDayActive = (sch.days & (1 << dIdx)) !== 0;
            return `
              <button type="button" onclick="toggleScheduleDay(${s}, ${dIdx})" id="dayBtn_${s}_${dIdx}" data-active="${isDayActive ? '1' : '0'}" class="flex-1 py-1 text-[11px] font-semibold rounded-lg border transition ${
                isDayActive 
                  ? 'bg-forest-100 text-forest-800 border-forest-300' 
                  : 'bg-surface-subtle text-slate-400 border-slate-200'
              }">
                ${day}
              </button>
            `;
          }).join('')}
        </div>
      </div>
    `;

    container.appendChild(card);
  }
}

function toggleScheduleDay(slotIndex, dayIndex) {
  const btn = document.getElementById(`dayBtn_${slotIndex}_${dayIndex}`);
  if (!btn) return;
  const currentActive = btn.dataset.active === '1';
  const newActive = !currentActive;
  btn.dataset.active = newActive ? '1' : '0';

  if (newActive) {
    btn.className = 'flex-1 py-1 text-[11px] font-semibold rounded-lg border transition bg-forest-100 text-forest-800 border-forest-300';
  } else {
    btn.className = 'flex-1 py-1 text-[11px] font-semibold rounded-lg border transition bg-surface-subtle text-slate-400 border-slate-200';
  }
}

// Save Config Handler
document.getElementById('btnSaveConfig')?.addEventListener('click', () => {
  const z = state.selectedZone;
  const enabled = document.getElementById('cfgZoneEnabled').checked;
  const mode = parseInt(document.getElementById('cfgZoneMode').value);
  const moistureStart = parseInt(document.getElementById('cfgMoistStart').value) || 35;
  const moistureStop = parseInt(document.getElementById('cfgMoistStop').value) || 55;

  const schedules = [];
  for (let s = 0; s < 4; s++) {
    const sEnabled = document.getElementById(`schEnabled_${s}`).checked;
    const timeVal = document.getElementById(`schTime_${s}`).value || '06:00';
    const [h, m] = timeVal.split(':').map(Number);
    const duration = parseInt(document.getElementById(`schDur_${s}`).value) || 10;

    let daysBit = 0;
    for (let d = 0; d < 7; d++) {
      const dayBtn = document.getElementById(`dayBtn_${s}_${d}`);
      if (dayBtn && dayBtn.dataset.active === '1') {
        daysBit |= (1 << d);
      }
    }

    schedules.push({
      enabled: sEnabled,
      hour: h,
      minute: m,
      duration: duration,
      days: daysBit
    });
  }

  const zoneConfig = {
    enabled: enabled,
    mode: mode,
    moistureStart: moistureStart,
    moistureStop: moistureStop,
    schedules: schedules
  };

  // Write to Firebase
  configRef.child(`zones/${z}`).set(zoneConfig).then(() => {
    Swal.fire({
      toast: true,
      position: 'top',
      icon: 'success',
      title: `บันทึกการตั้งค่า ${ZONE_SHORT_NAMES[z]} สำเร็จ 🌿`,
      showConfirmButton: false,
      timer: 2500
    });
  }).catch((err) => {
    Swal.fire({
      icon: 'error',
      title: 'บันทึกไม่สำเร็จ',
      text: err.message,
      confirmButtonColor: '#15803D'
    });
  });
});

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

  // Hardware Status
  const hw = data.hw || {};
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
        resetAlarm: true,
        timestamp: Date.now(),
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
//  WIFI SETUP WIZARD (ตรงตามไฟล์แนบของผู้ใช้ .html)
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
  } else if (step === 3) {
    const ssid = document.getElementById('wifiSsidInput').value.trim();
    if (!ssid) {
      Swal.fire({
        icon: 'info',
        title: 'กรุณากรอกชื่อ WiFi',
        text: 'โปรดระบุ SSID ที่ต้องการให้อุปกรณ์เชื่อมต่อ',
        confirmButtonColor: '#15803D'
      });
      goToWizardStep(2);
      return;
    }
    document.getElementById('wizardConfirmSsid').textContent = ssid;
    document.getElementById('wizardStep3').classList.remove('hidden');
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

  // Save to Firebase Realtime Database
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
    Swal.fire({
      icon: 'error',
      title: 'ไม่สามารถบันทึกได้',
      text: err.message,
      confirmButtonColor: '#15803D'
    });
  });
}

// Initial setup on DOM ready
document.addEventListener('DOMContentLoaded', () => {
  renderScheduleSettings();
  renderZoneControls(null);
  renderDashboardZoneCards([
    { mode: 1, enabled: true, running: false, waterUsed: 0 },
    { mode: 1, enabled: true, running: false, waterUsed: 0 },
    { mode: 2, enabled: true, running: false, waterUsed: 0 },
    { mode: 1, enabled: false, running: false, waterUsed: 0 }
  ]);
});

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
    // If on iOS Safari or prompt not ready
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
