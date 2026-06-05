import { saveRide, getAllRides, deleteRide } from './db.js';
import { RideTracker, formatDuration, formatDate } from './tracker.js';

// ── State ─────────────────────────────────────────
let map = null;
let detailMap = null;
let routeLayer = null;
let posMarker = null;
let tracker = null;
let timerInterval = null;
let currentRidePoints = [];
let rides = [];
let deferredInstallPrompt = null;

const LVIV_CENTER = [49.8397, 24.0297];

// ── Init ──────────────────────────────────────────
window.addEventListener('load', async () => {
  registerSW();
  await loadRides();
  initMap();
  setupNav();
  setupInstallPrompt();
  monitorOnline();
  checkGPS();
  renderHistory();
  renderStats();
});

// ── Service Worker ────────────────────────────────
function registerSW() {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js').catch(console.warn);
  }
}

// ── Map ───────────────────────────────────────────
function initMap() {
  map = L.map('map', {
    center: LVIV_CENTER,
    zoom: 14,
    zoomControl: false,
    attributionControl: false,
    tap: true
  });

  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '© OpenStreetMap'
  }).addTo(map);

  // Custom position marker
  const icon = L.divIcon({
    className: '',
    html: `<div style="width:16px;height:16px;border-radius:50%;background:#7ec850;border:3px solid #fff;box-shadow:0 0 12px rgba(126,200,80,0.6)"></div>`,
    iconSize: [16, 16],
    iconAnchor: [8, 8]
  });

  posMarker = L.marker(LVIV_CENTER, { icon, zIndexOffset: 1000 });
}

// ── GPS + Recording ───────────────────────────────
function checkGPS() {
  if (!navigator.geolocation) {
    setGPSBadge('off');
    return;
  }
  setGPSBadge('searching');
  navigator.geolocation.getCurrentPosition(
    pos => {
      setGPSBadge('on');
      const { latitude: lat, longitude: lng } = pos.coords;
      map.setView([lat, lng], 16);
      posMarker.setLatLng([lat, lng]).addTo(map);
    },
    () => setGPSBadge('off'),
    { enableHighAccuracy: true, timeout: 12000 }
  );
}

function setGPSBadge(state) {
  const el = document.getElementById('gps-badge');
  el.className = 'badge badge-gps';
  if (state === 'on') { el.textContent = 'GPS'; }
  else if (state === 'searching') { el.className += ' searching'; el.textContent = 'GPS...'; }
  else { el.className += ' off'; el.textContent = 'Без GPS'; }
}

document.getElementById('rec-btn').addEventListener('click', () => {
  if (!tracker) startRecording();
  else stopRecording();
});

function startRecording() {
  if (!navigator.geolocation) {
    toast('GPS недоступний на цьому пристрої');
    return;
  }

  tracker = new RideTracker(stats => updateHUD(stats));
  currentRidePoints = [];

  try {
    tracker.start();
  } catch (e) {
    toast('Не вдалось отримати доступ до GPS');
    tracker = null;
    return;
  }

  // UI
  const btn = document.getElementById('rec-btn');
  btn.classList.add('recording');
  btn.innerHTML = '<i class="ti ti-square-filled"></i>';
  document.getElementById('rec-badge').style.display = 'flex';
  setGPSBadge('on');

  // Route layer
  routeLayer = L.polyline([], {
    color: '#7ec850',
    weight: 4,
    opacity: 0.9,
    lineCap: 'round',
    lineJoin: 'round'
  }).addTo(map);

  posMarker.addTo(map);

  // Timer
  timerInterval = setInterval(() => {
    if (tracker) {
      const stats = tracker.getStats();
      updateHUD(stats);
      // Update route
      const pts = tracker.getRoute();
      if (pts.length > 1) {
        routeLayer.setLatLngs(pts);
        const last = pts[pts.length - 1];
        posMarker.setLatLng(last);
        // center map on position
        map.panTo(last, { animate: true, duration: 1 });
      }
    }
  }, 2000);

  toast('Запис розпочато! Їдьте!');
}

async function stopRecording() {
  if (!tracker) return;

  const stats = tracker.stop();
  clearInterval(timerInterval);
  timerInterval = null;

  const btn = document.getElementById('rec-btn');
  btn.classList.remove('recording');
  btn.innerHTML = '<i class="ti ti-player-play"></i>';
  document.getElementById('rec-badge').style.display = 'none';

  if (stats.points.length < 3 || stats.distance < 0.05) {
    toast('Поїздка занадто коротка, не збережено');
    tracker = null;
    if (routeLayer) { map.removeLayer(routeLayer); routeLayer = null; }
    resetHUD();
    return;
  }

  // Save
  const ride = {
    name: generateRideName(),
    date: Date.now(),
    distance: stats.distance,
    duration: stats.duration,
    avgSpeed: stats.avgSpeed,
    maxSpeed: stats.maxSpeed,
    points: stats.points.map(p => ({ lat: p.lat, lng: p.lng, t: p.t }))
  };

  try {
    await saveRide(ride);
    rides = await getAllRides();
    renderHistory();
    renderStats();
    toast(`Збережено! ${stats.distance.toFixed(1)} км`);
  } catch {
    toast('Помилка збереження');
  }

  tracker = null;
  resetHUD();
}

function generateRideName() {
  const h = new Date().getHours();
  if (h < 7) return 'Нічна поїздка';
  if (h < 11) return 'Ранкова поїздка';
  if (h < 14) return 'Обідня поїздка';
  if (h < 18) return 'Денна поїздка';
  if (h < 21) return 'Вечірня поїздка';
  return 'Нічна поїздка';
}

function updateHUD(stats) {
  document.getElementById('hud-speed').textContent = Math.round(stats.currentSpeed);
  document.getElementById('hud-dist').textContent = stats.distance.toFixed(1);
  document.getElementById('hud-time').textContent = formatDuration(stats.duration);
  document.getElementById('hud-avg').textContent = stats.avgSpeed.toFixed(1);
}

function resetHUD() {
  document.getElementById('hud-speed').textContent = '0';
  document.getElementById('hud-dist').textContent = '0.0';
  document.getElementById('hud-time').textContent = '0:00';
  document.getElementById('hud-avg').textContent = '0.0';
}

// ── Center on location ────────────────────────────
document.getElementById('center-btn').addEventListener('click', () => {
  navigator.geolocation?.getCurrentPosition(pos => {
    map.setView([pos.coords.latitude, pos.coords.longitude], 16, { animate: true });
    posMarker.setLatLng([pos.coords.latitude, pos.coords.longitude]).addTo(map);
  });
});

// ── Navigation ────────────────────────────────────
function setupNav() {
  document.querySelectorAll('.nav-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const target = btn.dataset.view;
      showView(target);
      document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      if (target === 'map-view') {
        setTimeout(() => map.invalidateSize(), 100);
      }
    });
  });
}

function showView(id) {
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  document.getElementById(id).classList.add('active');
}

// ── History ───────────────────────────────────────
async function loadRides() {
  rides = await getAllRides();
}

function renderHistory() {
  const el = document.getElementById('ride-list');

  if (rides.length === 0) {
    el.innerHTML = `
      <div class="empty-state">
        <i class="ti ti-bike" aria-hidden="true"></i>
        <p>Ще немає поїздок.<br>Натисніть ▶ на карті, щоб почати!</p>
      </div>`;
    document.getElementById('week-total').textContent = '';
    return;
  }

  const weekDist = rides.filter(r => Date.now() - r.date < 7 * 86400000)
    .reduce((s, r) => s + r.distance, 0);
  document.getElementById('week-total').textContent = `${weekDist.toFixed(0)} км цього тижня`;

  el.innerHTML = rides.map(r => `
    <div class="ride-card" onclick="openRide(${r.id})">
      <div class="ride-card-top">
        <div class="ride-card-name">${r.name}</div>
        <div class="ride-card-date">${formatDate(r.date)}</div>
      </div>
      <div class="ride-card-stats">
        <div class="rc-stat"><div class="rc-stat-val">${r.distance.toFixed(1)}</div><div class="rc-stat-lbl">км</div></div>
        <div class="rc-stat"><div class="rc-stat-val">${formatDuration(r.duration)}</div><div class="rc-stat-lbl">час</div></div>
        <div class="rc-stat"><div class="rc-stat-val">${r.avgSpeed.toFixed(1)}</div><div class="rc-stat-lbl">сер км/г</div></div>
        <div class="rc-stat"><div class="rc-stat-val">${(r.maxSpeed || 0).toFixed(0)}</div><div class="rc-stat-lbl">макс км/г</div></div>
      </div>
    </div>`).join('');
}

// ── Detail View ───────────────────────────────────
window.openRide = function(id) {
  const ride = rides.find(r => r.id === id);
  if (!ride) return;

  showView('detail-view');

  document.getElementById('detail-name').textContent = ride.name + ' · ' + formatDate(ride.date);
  document.getElementById('d-dist').textContent = ride.distance.toFixed(2);
  document.getElementById('d-time').textContent = formatDuration(ride.duration);
  document.getElementById('d-avg').textContent = ride.avgSpeed.toFixed(1);
  document.getElementById('d-max').textContent = (ride.maxSpeed || 0).toFixed(0);

  // Init detail map
  setTimeout(() => {
    if (detailMap) { detailMap.remove(); detailMap = null; }

    const center = ride.points.length > 0
      ? [ride.points[0].lat, ride.points[0].lng]
      : LVIV_CENTER;

    detailMap = L.map('detail-map', {
      center,
      zoom: 15,
      zoomControl: false,
      attributionControl: false
    });

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19
    }).addTo(detailMap);

    if (ride.points.length > 1) {
      const latlngs = ride.points.map(p => [p.lat, p.lng]);
      const poly = L.polyline(latlngs, {
        color: '#7ec850', weight: 4, opacity: 0.9,
        lineCap: 'round', lineJoin: 'round'
      }).addTo(detailMap);

      // Start/end markers
      const startIcon = L.divIcon({
        className: '',
        html: `<div style="width:14px;height:14px;border-radius:50%;background:#7ec850;border:2px solid #fff"></div>`,
        iconSize: [14, 14], iconAnchor: [7, 7]
      });
      const endIcon = L.divIcon({
        className: '',
        html: `<div style="width:14px;height:14px;border-radius:50%;background:#e8a830;border:2px solid #fff"></div>`,
        iconSize: [14, 14], iconAnchor: [7, 7]
      });

      L.marker(latlngs[0], { icon: startIcon }).addTo(detailMap);
      L.marker(latlngs[latlngs.length - 1], { icon: endIcon }).addTo(detailMap);

      detailMap.fitBounds(poly.getBounds(), { padding: [40, 40] });
    }
  }, 100);

  // Delete button
  document.getElementById('del-btn').onclick = async () => {
    if (confirm('Видалити цю поїздку?')) {
      await deleteRide(id);
      rides = await getAllRides();
      renderHistory();
      renderStats();
      backToHistory();
    }
  };
};

document.getElementById('back-btn').addEventListener('click', backToHistory);

function backToHistory() {
  showView('history-view');
  document.querySelectorAll('.nav-btn').forEach(b =>
    b.classList.toggle('active', b.dataset.view === 'history-view'));
  if (detailMap) { detailMap.remove(); detailMap = null; }
}

// ── Stats ─────────────────────────────────────────
function renderStats() {
  const total = rides.length;
  const totalDist = rides.reduce((s, r) => s + r.distance, 0);
  const totalTime = rides.reduce((s, r) => s + r.duration, 0);
  const avgSpd = total > 0 ? rides.reduce((s, r) => s + r.avgSpeed, 0) / total : 0;
  const bestDist = total > 0 ? Math.max(...rides.map(r => r.distance)) : 0;

  document.getElementById('s-rides').textContent = total;
  document.getElementById('s-dist').textContent = totalDist.toFixed(0);
  document.getElementById('s-time').textContent = formatDuration(totalTime);
  document.getElementById('s-avg').textContent = avgSpd.toFixed(1);
  document.getElementById('s-best').textContent = bestDist.toFixed(1);

  // Weekly bar chart (last 7 days)
  renderWeekChart();
}

function renderWeekChart() {
  const days = [];
  const LABELS = ['Нд','Пн','Вт','Ср','Чт','Пт','Сб'];
  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    d.setHours(0, 0, 0, 0);
    const next = new Date(d); next.setDate(d.getDate() + 1);
    const dist = rides
      .filter(r => r.date >= d.getTime() && r.date < next.getTime())
      .reduce((s, r) => s + r.distance, 0);
    days.push({ label: LABELS[d.getDay()], dist, isToday: i === 0 });
  }

  const max = Math.max(...days.map(d => d.dist), 1);
  const chart = document.getElementById('week-chart');
  chart.innerHTML = days.map(d => {
    const h = Math.max((d.dist / max) * 74, d.dist > 0 ? 4 : 2);
    return `<div class="bar-col">
      <div class="bar${d.isToday ? ' today' : ''}" style="height:${h}px"></div>
      <div class="bar-lbl">${d.label}</div>
    </div>`;
  }).join('');
}

// ── Online/offline ────────────────────────────────
function monitorOnline() {
  const badge = document.getElementById('offline-badge');
  const update = () => {
    badge.style.display = navigator.onLine ? 'none' : 'flex';
  };
  update();
  window.addEventListener('online', update);
  window.addEventListener('offline', update);
}

// ── Install prompt ────────────────────────────────
function setupInstallPrompt() {
  window.addEventListener('beforeinstallprompt', e => {
    e.preventDefault();
    deferredInstallPrompt = e;
    document.getElementById('install-prompt').classList.add('show');
  });

  document.getElementById('install-btn').addEventListener('click', async () => {
    if (!deferredInstallPrompt) return;
    deferredInstallPrompt.prompt();
    const { outcome } = await deferredInstallPrompt.userChoice;
    if (outcome === 'accepted') {
      document.getElementById('install-prompt').classList.remove('show');
      toast('VeloTrack встановлено!');
    }
    deferredInstallPrompt = null;
  });

  document.getElementById('dismiss-install').addEventListener('click', () => {
    document.getElementById('install-prompt').classList.remove('show');
  });
}

// ── Toast ─────────────────────────────────────────
window.toast = function(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(el._t);
  el._t = setTimeout(() => el.classList.remove('show'), 3000);
};
