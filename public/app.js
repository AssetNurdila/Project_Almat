/* ── State ── */
const POLL_MS = 5000;
const OFFLINE_MS = 5 * 60 * 1000;

let bins = {};          // id → {data, marker, listEl}
let addMode = false;
let histChart = null;
let hasFitBins = false;
let activeFilter = 'all';
let searchTerm = '';
let currentPopupId = null;
let selectedBinId = null;
let toastTimer;

/* ── Map init ── */
const map = L.map('map', { zoomControl: true, minZoom: 1, maxZoom: 19 }).setView([43.238, 76.945], 13);
const cartoKey = localStorage.getItem('carto_basemap_api_key');
if (cartoKey) {
  L.tileLayer(`https://basemaps.cartocdn.com/rastertiles/light_all/{z}/{x}/{y}{r}.png?key=${encodeURIComponent(cartoKey)}`, {
    attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> © <a href="https://carto.com/attributions">CARTO</a>', maxZoom: 19
  }).addTo(map);
} else {
  L.maplibreGL({ style: 'https://tiles.openfreemap.org/styles/positron' }).addTo(map);
  map.attributionControl.addAttribution('© <a href="https://openfreemap.org">OpenFreeMap</a> · © <a href="https://openmaptiles.org">OpenMapTiles</a> · © <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>');
}
const markerCluster = L.markerClusterGroup({
  showCoverageOnHover: false, spiderfyOnMaxZoom: true,
  iconCreateFunction: cluster => L.divIcon({
    html: `<span class="cluster-icon">${cluster.getChildCount()}</span>`,
    className: '', iconSize: [44, 44]
  })
}).addTo(map);

/* ── Helpers ── */
function color(pct, lastUpdate) {
  if (!lastUpdate) return '#95a5a6';
  const age = Date.now() - new Date(lastUpdate + 'Z').getTime();   // server stores UTC naive
  if (age > OFFLINE_MS) return '#95a5a6';
  if (pct == null) return '#95a5a6';
  if (pct > 80) return '#e74c3c';
  if (pct >= 50) return '#f39c12';
  return '#27ae60';
}

function isOffline(lastUpdate) {
  if (!lastUpdate) return true;
  return Date.now() - new Date(lastUpdate + 'Z').getTime() > OFFLINE_MS;
}

function fmtDate(ts) {
  if (!ts) return 'нет данных';
  return new Date(ts + 'Z').toLocaleString('ru-RU');
}

function relativeTime(ts) {
  if (!ts) return 'Нет данных';
  const minutes = Math.max(0, Math.floor((Date.now() - new Date(ts + 'Z').getTime()) / 60000));
  if (minutes < 1) return 'Только что';
  if (minutes < 60) return `${minutes} мин. назад`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} ч. назад`;
  return `${Math.floor(hours / 24)} дн. назад`;
}

function statusInfo(data) {
  const offline = isOffline(data.last_update);
  const pct = Number(data.fill_percent) || 0;
  return {
    offline, full: !offline && pct >= 80,
    label: offline ? 'Офлайн' : pct >= 80 ? 'Полный' : 'Норма',
    className: offline ? 'offline' : pct >= 80 ? 'full' : 'normal'
  };
}

function markerClass(data) {
  if (isOffline(data.last_update)) return 'bin-marker offline';
  const pct = Number(data.fill_percent) || 0;
  return `bin-marker level-${pct > 80 ? 'red' : pct >= 50 ? 'yellow' : 'green'}`;
}

function makeIcon(pct, lastUpdate) {
  const label = pct != null ? Math.round(pct) + '%' : '—';
  return L.divIcon({
    html: label, className: markerClass({ fill_percent: pct, last_update: lastUpdate }),
    iconSize: [36, 36], iconAnchor: [18, 18], popupAnchor: [0, -18]
  });
}

/* ── Side panel ── */
const binList = document.getElementById('bin-list');

function sortedBins() {
  return Object.values(bins).sort((a, b) => (b.data.fill_percent ?? -1) - (a.data.fill_percent ?? -1));
}

function matchesFilter(data) {
  const state = statusInfo(data);
  return (activeFilter === 'all' || (activeFilter === 'full' && state.full) ||
    (activeFilter === 'online' && !state.offline) || (activeFilter === 'offline' && state.offline)) &&
    data.name.toLowerCase().includes(searchTerm);
}

function renderList() {
  binList.innerHTML = '';
  const visible = sortedBins().filter(({ data }) => matchesFilter(data));
  document.getElementById('panel-count').textContent = `${visible.length} из ${Object.keys(bins).length} контейнеров`;
  visible.forEach(({ data }) => {
    const col = color(data.fill_percent, data.last_update);
    const pct = data.fill_percent != null ? Math.round(data.fill_percent) + '%' : '—';
    const state = statusInfo(data);
    const li = document.createElement('li');
    li.className = `bin-card${Number(selectedBinId) === Number(data.id) ? ' active' : ''}`; li.dataset.id = data.id; li.tabIndex = 0; li.setAttribute('role', 'button');
    li.setAttribute('aria-label', `${data.name}, ${pct}, ${state.label}`);
    const top = document.createElement('div'); top.className = 'card-top';
    const title = document.createElement('span'); title.className = 'card-title'; title.textContent = data.name;
    const status = document.createElement('span'); status.className = `status-label ${state.className}`; status.textContent = state.label;
    top.append(title, status);
    const track = document.createElement('div'); track.className = 'card-progress';
    const fill = document.createElement('span'); fill.style.width = `${Math.max(0, Math.min(100, Number(data.fill_percent) || 0))}%`; fill.style.background = col; track.appendChild(fill);
    const bottom = document.createElement('div'); bottom.className = 'card-bottom';
    const percent = document.createElement('b'); percent.textContent = pct;
    const updated = document.createElement('span'); updated.textContent = relativeTime(data.last_update);
    bottom.append(percent, updated); li.append(top, track, bottom);
    const activate = () => focusBin(data.id, true);
    li.addEventListener('click', activate);
    li.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); activate(); } });
    binList.appendChild(li);
    bins[data.id].listEl = li;
  });
  if (!visible.length) {
    const empty = document.createElement('li'); empty.className = 'empty-state';
    empty.textContent = Object.keys(bins).length ? 'Ничего не найдено. Измените поиск или фильтр.' : 'Контейнеров пока нет. Добавьте первый на карте.';
    binList.appendChild(empty);
  }
}

/* ── Stats bar ── */
function updateStats() {
  const all = Object.values(bins);
  const full = all.filter(b => statusInfo(b.data).full).length;
  const off = all.filter(b => statusInfo(b.data).offline).length;
  document.querySelector('#stat-total b').textContent = all.length;
  document.querySelector('#stat-full b').textContent = full;
  document.querySelector('#stat-off b').textContent = off;
}

/* ── Fetch & update ── */
async function fetchBins() {
  try {
    const response = await fetch('/api/bins');
    console.log('GET /api/bins status:', response.status);
    if (!response.ok) throw new Error(`GET /api/bins failed: ${response.status}`);
    const data = await response.json();
    data.forEach(d => {
      if (bins[d.id]) {
        // update existing
        bins[d.id].data = d;
        const col = color(d.fill_percent, d.last_update);
        bins[d.id].marker.setIcon(makeIcon(d.fill_percent, d.last_update));
        bins[d.id].marker.setLatLng([d.lat, d.lng]);
      } else {
        // new marker
        const marker = L.marker([d.lat, d.lng], { icon: makeIcon(d.fill_percent, d.last_update) })
          .on('click', () => focusBin(d.id, true));
        markerCluster.addLayer(marker);
        bins[d.id] = { data: d, marker, listEl: null };
      }
      bins[d.id].data = d;
      bins[d.id].marker.setIcon(makeIcon(d.fill_percent, d.last_update));
    });
    renderList();
    updateStats();
    document.getElementById('list-status').classList.add('hidden');
    if (!hasFitBins && data.length) {
      map.fitBounds(L.latLngBounds(data.map(d => [d.lat, d.lng])), { padding: [40, 40], maxZoom: 15 });
      hasFitBins = true;
    }
  } catch (e) {
    console.error('Ошибка загрузки контейнеров:', e);
    document.getElementById('list-status').classList.add('hidden');
    if (!Object.keys(bins).length) {
      binList.innerHTML = '<li class="empty-state">Не удалось загрузить контейнеры.<br>Проверьте соединение с сервером.</li>';
      document.getElementById('panel-count').textContent = 'Нет соединения';
    }
    showToast('Не удалось связаться с сервером. Повторяем попытку…');
  }
}

map.whenReady(() => setTimeout(() => map.invalidateSize(), 0));
fetchBins();
setInterval(fetchBins, POLL_MS);

/* ── Popup ── */
const overlay  = document.getElementById('popup-overlay');
const popName  = document.getElementById('popup-name');
const popMeta  = document.getElementById('popup-meta');
const chartCtx = document.getElementById('history-chart');

document.getElementById('popup-close').addEventListener('click', closePopup);
overlay.addEventListener('click', e => { if (e.target === overlay) closePopup(); });

function closePopup() {
  currentPopupId = null;
  overlay.classList.add('hidden');
  if (histChart) { histChart.destroy(); histChart = null; }
  document.querySelectorAll('#bin-list li').forEach(l => l.classList.remove('active'));
}

async function openPopup(id) {
  currentPopupId = id;
  const { data } = bins[id];
  const col = color(data.fill_percent, data.last_update);
  const pct = data.fill_percent != null ? Math.round(data.fill_percent) + '%' : '—';

  popName.textContent = data.name;
  const state = statusInfo(data);
  popMeta.innerHTML = `<span class="status-label ${state.className}">${state.label}</span><div class="popup-reading"><strong style="color:${col}">${pct}</strong><span>заполненность</span></div><div>Обновлено: ${relativeTime(data.last_update)} · ${fmtDate(data.last_update)}</div>`;
  const popupFill = document.querySelector('#popup-progress span');
  popupFill.style.width = `${Math.max(0, Math.min(100, Number(data.fill_percent) || 0))}%`;
  popupFill.style.background = col;
  document.getElementById('route-link').href = `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(`${data.lat},${data.lng}`)}&travelmode=driving`;

  // highlight list
  document.querySelectorAll('#bin-list li').forEach(l => l.classList.remove('active'));
  if (bins[id].listEl) bins[id].listEl.classList.add('active');

  overlay.classList.remove('hidden');

  // chart
  if (histChart) { histChart.destroy(); histChart = null; }
  try {
    const history = await fetch(`/api/bins/${id}/history`).then(r => r.json());
    const pts = history.slice().reverse();
    histChart = new Chart(chartCtx, {
      type: 'line',
      data: {
        labels: pts.map(p => new Date(p.created_at + 'Z').toLocaleTimeString('ru-RU', {hour:'2-digit',minute:'2-digit'})),
        datasets: [{
          label: 'Заполненность, %',
          data: pts.map(p => Math.round(p.fill_percent)),
          borderColor: col,
          backgroundColor: col + '22',
          tension: 0.3, fill: true,
          pointRadius: pts.length > 20 ? 0 : 3
        }]
      },
      options: {
        responsive: true, animation: false,
        plugins: { legend: { display: false } },
        scales: {
          y: { min: 0, max: 100, ticks: { callback: v => v + '%' } },
          x: { ticks: { maxTicksLimit: 6, maxRotation: 0 } }
        }
      }
    });
  } catch(e) {
    chartCtx.getContext('2d').clearRect(0, 0, chartCtx.width, chartCtx.height);
  }

  // pan map to marker
  map.flyTo([data.lat, data.lng], Math.max(15, map.getZoom()), { duration: .55 });
}

function focusBin(id, showDetails = false) {
  const bin = bins[id];
  if (!bin) return;
  selectedBinId = id;
  document.querySelectorAll('.bin-card').forEach(card => card.classList.toggle('active', Number(card.dataset.id) === Number(id)));
  if (bin.listEl) bin.listEl.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  map.flyTo([bin.data.lat, bin.data.lng], Math.max(15, map.getZoom()), { duration: .55 });
  if (showDetails) openPopup(id);
}

function showToast(message) {
  const toast = document.getElementById('toast');
  toast.textContent = message; toast.classList.remove('hidden');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => toast.classList.add('hidden'), 5000);
}

function setFilter(filter) {
  activeFilter = filter;
  document.querySelectorAll('.filter-chip').forEach(chip => {
    const active = chip.dataset.filter === filter;
    chip.classList.toggle('active', active); chip.setAttribute('aria-pressed', String(active));
  });
  renderList();
}

document.getElementById('bin-search').addEventListener('input', e => { searchTerm = e.target.value.trim().toLocaleLowerCase('ru'); renderList(); });
document.querySelectorAll('.filter-chip').forEach(chip => chip.addEventListener('click', () => setFilter(chip.dataset.filter)));
document.getElementById('stat-total').addEventListener('click', () => setFilter('all'));
document.getElementById('stat-full').addEventListener('click', () => setFilter('full'));
document.getElementById('stat-off').addEventListener('click', () => setFilter('offline'));
document.addEventListener('keydown', e => {
  if (e.key === '/' && !['INPUT', 'TEXTAREA'].includes(document.activeElement.tagName)) { e.preventDefault(); document.getElementById('bin-search').focus(); }
});

const panel = document.getElementById('panel');
const isMobile = () => window.matchMedia('(max-width: 760px)').matches;
document.getElementById('toggle-panel').addEventListener('click', () => {
  panel.classList.toggle('hidden');
  setTimeout(() => map.invalidateSize(), 260);
});
function toggleSheet(expand) {
  const expanded = expand ?? !panel.classList.contains('expanded');
  panel.classList.toggle('expanded', expanded); document.body.classList.toggle('sheet-expanded', expanded);
  document.getElementById('panel-expand').textContent = expanded ? '⌄' : '⌃';
  document.getElementById('panel-expand').setAttribute('aria-label', expanded ? 'Свернуть список' : 'Развернуть список');
  setTimeout(() => map.invalidateSize(), 260);
}
document.getElementById('panel-expand').addEventListener('click', () => toggleSheet());
let swipeStartY = null;
panel.addEventListener('touchstart', e => { swipeStartY = e.touches[0].clientY; }, { passive: true });
panel.addEventListener('touchend', e => {
  if (swipeStartY == null) return;
  const delta = e.changedTouches[0].clientY - swipeStartY;
  if (Math.abs(delta) > 40) toggleSheet(delta < 0);
  swipeStartY = null;
}, { passive: true });

const themeKey = 'binmap-theme';
document.documentElement.dataset.theme = localStorage.getItem(themeKey) || 'light';
document.getElementById('theme-toggle').addEventListener('click', () => {
  const theme = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
  document.documentElement.dataset.theme = theme; localStorage.setItem(themeKey, theme);
});

/* ── Add bin ── */
const btnAdd = document.getElementById('btn-add');

btnAdd.addEventListener('click', () => {
  if (addMode) return cancelAdd();
  addMode = true;
  btnAdd.textContent = '✕ Отмена';
  btnAdd.classList.add('active');
  document.getElementById('add-banner').classList.remove('hidden');
  map.getContainer().style.cursor = 'crosshair';
  map.once('click', onAddMapClick);
});

let selectedLocation = null;
function onAddMapClick(e) {
  selectedLocation = e.latlng;
  cancelAdd();
  document.getElementById('add-modal-overlay').classList.remove('hidden');
  document.querySelector('#add-form [name="name"]').focus();
}

document.getElementById('add-form').addEventListener('submit', async e => {
  e.preventDefault();
  const form = new FormData(e.currentTarget);
  const name = String(form.get('name') || '').trim();
  const height_cm = Number(form.get('height_cm'));
  if (!name || !Number.isFinite(height_cm) || height_cm <= 0) return alert('Проверьте название и высоту');
  try {
    const response = await fetch('/api/bins', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, lat: selectedLocation.lat, lng: selectedLocation.lng, height_cm })
    });
    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(err.error || `HTTP ${response.status}`);
    }
    document.getElementById('add-modal-overlay').classList.add('hidden');
    e.currentTarget.reset();
    e.currentTarget.elements.height_cm.value = 80;
    selectedLocation = null;
    await fetchBins();
    showToast('Контейнер добавлен');
  } catch(err) { showToast('Не удалось добавить контейнер: ' + err.message); }
});

document.getElementById('add-cancel').addEventListener('click', () => {
  document.getElementById('add-modal-overlay').classList.add('hidden');
  selectedLocation = null;
});
document.getElementById('add-modal-close').addEventListener('click', () => document.getElementById('add-cancel').click());
document.getElementById('banner-cancel').addEventListener('click', cancelAdd);
document.getElementById('add-modal-overlay').addEventListener('click', e => {
  if (e.target === e.currentTarget) document.getElementById('add-cancel').click();
});
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    if (!document.getElementById('add-modal-overlay').classList.contains('hidden')) document.getElementById('add-cancel').click();
    else if (addMode) cancelAdd();
  }
});

function cancelAdd() {
  map.off('click', onAddMapClick);
  addMode = false;
  btnAdd.textContent = '＋ Добавить контейнер';
  btnAdd.classList.remove('active');
  document.getElementById('add-banner').classList.add('hidden');
  map.getContainer().style.cursor = '';
}

window.addEventListener('resize', () => setTimeout(() => map.invalidateSize(), 150));
