/* ============================================================
   FishTracker — app.js
   Fuente de datos: VesselAPI via Cloudflare Worker proxy
   ============================================================ */

'use strict';

const App = (() => {

  // ──────────────────────────────────────────────
  //  Estado global
  // ──────────────────────────────────────────────
  const state = {
    map:             null,
    tileLayer:       null,
    vesselLayer:     null,
    heatLayer:       null,
    portLayer:       null,
    vesselMap:       new Map(),
    vessels:         [],
    filteredVessels: [],
    selectedVessel:  null,
    trackedVessel:   null,
    activeGears:     new Set(Object.keys(CONFIG.GEAR_TYPES)),
    activePeriod:    'week',
    layers:          { vessels: true, heatmap: true, ports: true },
    isDark:          true,
    uiUpdateTimer:   null,
  };

  const mmsiTypeCache = new Map();  // mmsi → { shipType, flag, rawType }
  const enrichQueue   = new Set();  // MMSIs pendientes de enriquecer tipo

  // ──────────────────────────────────────────────
  //  Init
  // ──────────────────────────────────────────────
  function init() {
    initMap();
    buildGearFilters();
    buildPeriodFilters();
    buildLegend();
    addPortMarkers();
    setupSearch();
    setupButtons();
    setupMapBoundsRefresh();
    startPolling();
    startPruneTimer();
    hideLoader();
  }

  // ──────────────────────────────────────────────
  //  Mapa
  // ──────────────────────────────────────────────
  function initMap() {
    state.map = L.map('map', {
      center:  CONFIG.MAP_CENTER,
      zoom:    CONFIG.MAP_ZOOM,
      minZoom: CONFIG.MAP_MIN_ZOOM,
      maxZoom: CONFIG.MAP_MAX_ZOOM,
    });

    state.tileLayer = L.tileLayer(CONFIG.TILE_DARK, {
      attribution: CONFIG.TILE_DARK_ATTR,
      maxZoom: 19,
    }).addTo(state.map);

    state.vesselLayer = L.layerGroup().addTo(state.map);
    state.portLayer   = L.layerGroup().addTo(state.map);

    state.map.on('click', () => closeInfoPanel());
  }

  // ──────────────────────────────────────────────
  //  Filtros de tipo de barco
  // ──────────────────────────────────────────────
  function buildGearFilters() {
    const container = document.getElementById('gearFilters');
    container.innerHTML = '';
    Object.entries(CONFIG.GEAR_TYPES).forEach(([key, gear]) => {
      const div = document.createElement('div');
      div.className = 'gear-filter-item active';
      div.dataset.gear = key;
      div.innerHTML = `
        <label>
          <div class="custom-check"></div>
          <span style="width:10px;height:10px;border-radius:50%;background:${gear.color};flex-shrink:0;display:inline-block;"></span>
          <span class="gear-filter-label">${gear.icon} ${gear.label}</span>
          <span class="gear-count" id="gearCount_${key}">0</span>
        </label>`;
      div.addEventListener('click', () => toggleGear(key, div));
      container.appendChild(div);
    });
  }

  function toggleGear(key, el) {
    if (state.activeGears.has(key)) {
      state.activeGears.delete(key);
      el.classList.remove('active');
    } else {
      state.activeGears.add(key);
      el.classList.add('active');
    }
    applyFilters();
  }

  // ──────────────────────────────────────────────
  //  Filtros de periodo
  // ──────────────────────────────────────────────
  function buildPeriodFilters() {
    const container = document.getElementById('periodFilters');
    container.innerHTML = '';
    Object.entries(CONFIG.PERIODS).forEach(([key, period]) => {
      const btn = document.createElement('button');
      btn.className = 'period-btn' + (key === state.activePeriod ? ' active' : '');
      btn.textContent = period.label;
      btn.dataset.period = key;
      btn.addEventListener('click', () => {
        document.querySelectorAll('.period-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        state.activePeriod = key;
        applyFilters();
      });
      container.appendChild(btn);
    });
  }

  // ──────────────────────────────────────────────
  //  Leyenda
  // ──────────────────────────────────────────────
  function buildLegend() {
    const container = document.getElementById('legendItems');
    container.innerHTML = '';
    Object.entries(CONFIG.GEAR_TYPES).forEach(([, gear]) => {
      const div = document.createElement('div');
      div.className = 'legend-item';
      div.innerHTML = `<span class="legend-dot" style="background:${gear.color}"></span>${gear.icon} ${gear.label}`;
      container.appendChild(div);
    });
  }

  // ──────────────────────────────────────────────
  //  Puertos
  // ──────────────────────────────────────────────
  function addPortMarkers() {
    CONFIG.DEMO_PORTS.forEach(port => {
      const icon = L.divIcon({
        className: '',
        html: '<div class="port-marker"></div>',
        iconSize: [12, 12],
        iconAnchor: [6, 6],
      });
      const marker = L.marker([port.lat, port.lon], { icon })
        .bindPopup(`<b>⚓ ${port.name}</b><br/>${port.country}`)
        .addTo(state.portLayer);
      marker.on('click', (e) => { e.originalEvent.stopPropagation(); });
    });
    document.getElementById('statPorts').textContent = CONFIG.DEMO_PORTS.length;
  }

  // ──────────────────────────────────────────────
  //  VesselAPI — polling cada 15s
  // ──────────────────────────────────────────────
  let _pollTimer = null;

  function startPolling() {
    fetchVessels();
    _pollTimer = setInterval(fetchVessels, CONFIG.POLL_INTERVAL_MS);
  }

  async function fetchVessels() {
    const b = state.map.getBounds();

    let s = b.getSouth(), n = b.getNorth();
    let w = b.getWest(),  e = b.getEast();

    // VesselAPI: span máximo 4 grados (|dLat|+|dLon| <= 4)
    if ((n - s) + (e - w) > 3.8) {
      const c = state.map.getCenter();
      s = c.lat - 1.0; n = c.lat + 1.0;
      w = c.lng - 1.0; e = c.lng + 1.0;
    }

    let total = 0;
    let nextToken = null;
    showLoadingBar(20);

    try {
      for (let page = 0; page < 2; page++) {
        const params = new URLSearchParams({
          'filter.latBottom': s.toFixed(4),
          'filter.latTop':    n.toFixed(4),
          'filter.lonLeft':   w.toFixed(4),
          'filter.lonRight':  e.toFixed(4),
          'pagination.limit': '50',
        });
        if (nextToken) params.set('pagination.nextToken', nextToken);

        showLoadingBar(40 + page * 20);
        const res = await fetch(`${CONFIG.PROXY_URL}/v1/location/vessels/bounding-box?${params}`);

        if (!res.ok) {
          console.warn('[VesselAPI] HTTP', res.status, await res.text());
          break;
        }

        const json = await res.json();
        const list = json.vessels || json.data || [];
        list.forEach(ingestVessel);
        total     += list.length;
        nextToken  = json.nextToken || null;
        if (!nextToken || list.length < 50) break;
      }

      if (total > 0) {
        setApiStatus(true);
        scheduleUIUpdate();
        enrichVessels();
      }

    } catch (err) {
      console.warn('[VesselAPI] Error:', err.message);
    } finally {
      showLoadingBar(0);
    }
  }

  // Procesa un barco recibido de VesselAPI
  function ingestVessel(raw) {
    const mmsi = String(raw.mmsi || '');
    if (!mmsi) return;

    const lat = parseFloat(raw.latitude  ?? NaN);
    const lon = parseFloat(raw.longitude ?? NaN);
    if (isNaN(lat) || isNaN(lon)) return;
    if (raw.suspected_glitch) return;

    const sigTs   = raw.timestamp ? new Date(raw.timestamp).getTime() : Date.now();
    const name    = (raw.vessel_name || `MMSI ${mmsi}`).trim();
    const speed   = parseFloat(raw.sog ?? 0).toFixed(1);
    const course  = Math.round(parseFloat(raw.cog ?? raw.heading ?? 0));
    const status  = mapNavStatus(raw.nav_status ?? -1);
    const cached  = mmsiTypeCache.get(mmsi);
    const gear    = cached?.shipType || guessTypeFromName(name);
    const flag    = cached?.flag     || '??';

    const existing = state.vesselMap.get(mmsi);
    if (existing) {
      if (sigTs < existing.lastTs) return;
      Object.assign(existing, { lat, lon, speed, course, status, gear, flag,
        lastSeen: new Date().toLocaleTimeString('es-ES'), lastTs: sigTs });
      if (name && !name.startsWith('MMSI')) existing.name = name;
      if (cached) existing.isFishing = (gear === 'fishing');
    } else {
      state.vesselMap.set(mmsi, {
        id: mmsi, mmsi, name, flag, gear,
        imo:       raw.imo ? `IMO${raw.imo}` : '—',
        isFishing: cached ? (gear === 'fishing') : null,
        status, lat, lon, speed, course,
        lastSeen:  new Date().toLocaleTimeString('es-ES'),
        lastTs:    sigTs,
      });
      if (!cached) enrichQueue.add(mmsi);
    }
  }

  // Enriquece barcos nuevos con tipo y bandera (hasta 12 por ciclo)
  async function enrichVessels() {
    const batch = [...enrichQueue].slice(0, 12);
    if (!batch.length) return;
    batch.forEach(m => enrichQueue.delete(m));

    await Promise.allSettled(batch.map(async (mmsi) => {
      try {
        const res  = await fetch(`${CONFIG.PROXY_URL}/v1/search/vessels?filter.mmsi=${mmsi}`);
        if (!res.ok) return;
        const json = await res.json();
        const v    = json.vessels?.[0];
        if (!v) return;

        const info = {
          shipType: normalizeType(v.vessel_type),
          flag:     v.country_code || '??',
          rawType:  v.vessel_type  || '—',
        };
        mmsiTypeCache.set(mmsi, info);

        const vessel = state.vesselMap.get(mmsi);
        if (vessel) {
          vessel.gear      = info.shipType;
          vessel.flag      = info.flag;
          vessel.rawType   = info.rawType;
          vessel.isFishing = (info.shipType === 'fishing');
        }
      } catch (_) {}
    }));

    scheduleUIUpdate();
  }

  // Convierte vessel_type de VesselAPI a clave de CONFIG.GEAR_TYPES
  function normalizeType(raw) {
    if (!raw) return 'other';
    const t = raw.toLowerCase();
    if (t.includes('fishing'))                              return 'fishing';
    if (t.includes('tanker'))                               return 'tanker';
    if (t.includes('passenger') || t.includes('ferry'))    return 'passenger';
    if (t.includes('tug') || t.includes('tow'))            return 'tug';
    if (t.includes('pleasure') || t.includes('yacht') ||
        t.includes('sailing'))                              return 'pleasure';
    if (t.includes('cargo') || t.includes('bulk') ||
        t.includes('container') || t.includes('general'))  return 'cargo';
    return 'other';
  }

  // Adivinanza rápida por nombre hasta que llegue el enriquecimiento
  function guessTypeFromName(name) {
    const n = name.toLowerCase();
    if (n.includes('tanker') || n.includes('petrol'))      return 'tanker';
    if (n.includes('ferry')  || n.includes('passenger'))   return 'passenger';
    if (n.includes('tug')    || n.includes('remolc'))      return 'tug';
    if (n.includes('yacht')  || n.includes('sailing'))     return 'pleasure';
    if (n.includes('msc ')   || n.includes('maersk') ||
        n.includes('cosco')  || n.includes('cargo'))       return 'cargo';
    return 'other';
  }

  function mapNavStatus(n) {
    if (n === 1) return 'anchored';
    if (n === 7) return 'fishing';
    return 'transit';
  }

  // Al mover/zoom: limpiar y recargar zona actual inmediatamente
  function setupMapBoundsRefresh() {
    const refresh = debounce(() => {
      state.vesselMap.clear();
      fetchVessels();
    }, 800);
    state.map.on('moveend', refresh);
    state.map.on('zoomend', refresh);
  }

  function scheduleUIUpdate() {
    if (state.uiUpdateTimer) return;
    state.uiUpdateTimer = setTimeout(() => {
      state.uiUpdateTimer = null;
      applyFilters();
    }, 500);
  }

  function startPruneTimer() {
    setInterval(() => {
      const { inactiveMs } = CONFIG.PERIODS[state.activePeriod];
      if (!inactiveMs) return;
      const cutoff = Date.now() - inactiveMs;
      let pruned = false;
      state.vesselMap.forEach((v, k) => {
        if (v.lastTs < cutoff) { state.vesselMap.delete(k); pruned = true; }
      });
      if (pruned) applyFilters();
    }, 60_000);
  }

  // ──────────────────────────────────────────────
  //  Filtros y renderizado
  // ──────────────────────────────────────────────
  function applyFilters() {
    state.vessels = Array.from(state.vesselMap.values()).filter(v => v.lat != null);
    state.filteredVessels = state.vessels.filter(v => state.activeGears.has(v.gear));

    // Ordenar: pesqueros primero, luego por última señal
    state.filteredVessels.sort((a, b) => {
      if (a.isFishing && !b.isFishing) return -1;
      if (!a.isFishing && b.isFishing)  return  1;
      return b.lastTs - a.lastTs;
    });

    Object.keys(CONFIG.GEAR_TYPES).forEach(key => {
      const el = document.getElementById(`gearCount_${key}`);
      if (el) el.textContent = state.vessels.filter(v => v.gear === key).length;
    });

    renderVesselList(state.filteredVessels);
    renderVesselMarkers(state.filteredVessels);
    renderHeatmap(state.filteredVessels);
    updateStats(state.filteredVessels);
  }

  function renderVesselMarkers(vessels) {
    state.vesselLayer.clearLayers();
    if (!state.layers.vessels) return;

    vessels.forEach(vessel => {
      const gear  = CONFIG.GEAR_TYPES[vessel.gear] || CONFIG.GEAR_TYPES.other;
      const color = gear.color;
      const isCfm = vessel.isFishing === true;
      const badge = isCfm ? '<span style="position:absolute;top:-6px;right:-6px;font-size:10px;">🐟</span>' : '';
      const border = isCfm
        ? `border:2px solid ${color};box-shadow:0 0 6px ${color};`
        : `border:1px solid ${color};`;

      const icon = L.divIcon({
        className: '',
        html: `<div class="vessel-marker-icon" style="position:relative;background:${color}22;${border}">${gear.icon}${badge}</div>`,
        iconSize:   [32, 32],
        iconAnchor: [16, 16],
        popupAnchor:[0, -18],
      });

      const marker = L.marker([vessel.lat, vessel.lon], { icon })
        .bindPopup(buildPopupHTML(vessel), { maxWidth: 240 });

      marker.on('click', (e) => {
        e.originalEvent.stopPropagation();
        selectVessel(vessel);
      });
      marker.addTo(state.vesselLayer);
    });
  }

  function buildPopupHTML(v) {
    const gear = CONFIG.GEAR_TYPES[v.gear] || CONFIG.GEAR_TYPES.other;
    return `
      <div style="line-height:1.6">
        <b>${gear.icon} ${v.name}</b><br/>
        <span style="color:var(--text-secondary);font-size:11px">
          ${gear.label} &bull; ${v.flag} &bull; ${getStatusLabel(v.status)}
        </span><br/>
        <span style="font-size:11px">📡 MMSI: ${v.mmsi}</span><br/>
        <span style="font-size:11px">💨 ${v.speed} kn &bull; Rumbo: ${v.course}°</span>
      </div>`;
  }

  function renderHeatmap(vessels) {
    if (state.heatLayer) { state.map.removeLayer(state.heatLayer); state.heatLayer = null; }
    if (!state.layers.heatmap || vessels.length === 0) return;
    if (typeof L.heatLayer !== 'function') return;

    const points = vessels.map(v => [v.lat, v.lon, v.isFishing ? 1.0 : 0.3]);
    state.heatLayer = L.heatLayer(points, {
      radius: 28, blur: 20, maxZoom: 10, max: 1.0,
      gradient: { 0.0:'#0000ff', 0.3:'#00ffff', 0.5:'#00ff00', 0.7:'#ffff00', 1.0:'#ff0000' },
    }).addTo(state.map);
  }

  function renderVesselList(vessels) {
    const container = document.getElementById('vesselList');
    if (vessels.length === 0) {
      container.innerHTML = `
        <div class="vessel-list-empty">
          <div class="empty-icon">🔍</div>
          <p>No se encontraron barcos<br/>con los filtros actuales.</p>
        </div>`;
      return;
    }

    container.innerHTML = vessels.map(v => buildVesselCardHTML(v)).join('');
    container.querySelectorAll('.vessel-card').forEach(card => {
      card.addEventListener('click', () => {
        const vessel = state.filteredVessels.find(v => v.id === card.dataset.id);
        if (vessel) selectVessel(vessel);
      });
    });
  }

  function buildVesselCardHTML(v) {
    const gear      = CONFIG.GEAR_TYPES[v.gear] || CONFIG.GEAR_TYPES.other;
    const fishBadge = v.isFishing === true
      ? '<span style="font-size:10px;background:#27ae6022;color:#27ae60;border:1px solid #27ae60;border-radius:4px;padding:0 4px;margin-left:4px;">🐟 Pesca</span>'
      : '';
    return `
      <div class="vessel-card ${state.selectedVessel?.id === v.id ? 'selected' : ''}" data-id="${v.id}">
        <div class="vessel-card-header">
          <span class="vessel-gear-icon">${gear.icon}</span>
          <span class="vessel-name">${v.name}${fishBadge}</span>
          <span class="vessel-status-badge ${v.status}">${getStatusLabel(v.status)}</span>
        </div>
        <div class="vessel-card-meta">
          <span class="vessel-meta-item">🏳️ ${v.flag}</span>
          <span class="vessel-meta-item">📡 ${v.mmsi}</span>
          <span class="vessel-meta-item">💨 ${v.speed} kn</span>
          <span class="vessel-meta-item">🕐 ${v.lastSeen}</span>
        </div>
      </div>`;
  }

  // ──────────────────────────────────────────────
  //  Selección y panel de detalle
  // ──────────────────────────────────────────────
  function selectVessel(vessel) {
    state.selectedVessel = vessel;
    document.querySelectorAll('.vessel-card').forEach(c => {
      c.classList.toggle('selected', c.dataset.id === vessel.id);
    });
    state.map.setView([vessel.lat, vessel.lon], Math.max(state.map.getZoom(), 7), { animate: true });
    openInfoPanel(vessel);
  }

  function openInfoPanel(vessel) {
    const gear = CONFIG.GEAR_TYPES[vessel.gear] || CONFIG.GEAR_TYPES.other;
    document.getElementById('infoPanelIcon').textContent = gear.icon;
    document.getElementById('infoPanelName').textContent = vessel.name;
    document.getElementById('infoPanelSub').textContent  = `${gear.label} • ${vessel.flag} • ${getStatusLabel(vessel.status)}`;

    document.getElementById('infoPanelBody').innerHTML = `
      <div class="info-row"><span class="info-key">MMSI</span>        <span class="info-val">${vessel.mmsi}</span></div>
      <div class="info-row"><span class="info-key">IMO</span>         <span class="info-val">${vessel.imo || '—'}</span></div>
      <div class="info-row"><span class="info-key">Bandera</span>     <span class="info-val">🏳️ ${vessel.flag}</span></div>
      <div class="info-row"><span class="info-key">Tipo</span>        <span class="info-val">${vessel.rawType || gear.label}</span></div>
      <div class="info-row"><span class="info-key">Estado</span>      <span class="info-val">${getStatusLabel(vessel.status)}</span></div>
      <div class="info-row"><span class="info-key">Velocidad</span>   <span class="info-val">${vessel.speed} kn</span></div>
      <div class="info-row"><span class="info-key">Rumbo</span>       <span class="info-val">${vessel.course}°</span></div>
      <div class="info-row"><span class="info-key">Latitud</span>     <span class="info-val">${vessel.lat.toFixed(4)}°</span></div>
      <div class="info-row"><span class="info-key">Longitud</span>    <span class="info-val">${vessel.lon.toFixed(4)}°</span></div>
      <div class="info-row"><span class="info-key">Última señal</span><span class="info-val">${vessel.lastSeen}</span></div>
    `;
    document.getElementById('infoPanel').classList.add('open');
  }

  function closeInfoPanel() {
    document.getElementById('infoPanel').classList.remove('open');
    state.selectedVessel = null;
    document.querySelectorAll('.vessel-card').forEach(c => c.classList.remove('selected'));
  }

  function trackVessel() {
    if (!state.selectedVessel) return;
    state.trackedVessel = state.selectedVessel;
    toast(`Siguiendo: ${state.selectedVessel.name}`, 'info');
  }

  function showHistory() {
    if (!state.selectedVessel) return;
    toast(`Historial de ${state.selectedVessel.name}`, 'info');
  }

  // ──────────────────────────────────────────────
  //  Capas
  // ──────────────────────────────────────────────
  function toggleLayer(name) {
    state.layers[name] = !state.layers[name];
    const el = document.getElementById(`layer${name.charAt(0).toUpperCase() + name.slice(1)}`);
    el?.classList.toggle('active', state.layers[name]);
    if (name === 'vessels') renderVesselMarkers(state.filteredVessels);
    if (name === 'heatmap') renderHeatmap(state.filteredVessels);
    if (name === 'ports') {
      if (state.layers.ports) state.portLayer.addTo(state.map);
      else state.map.removeLayer(state.portLayer);
    }
  }

  // ──────────────────────────────────────────────
  //  Búsqueda
  // ──────────────────────────────────────────────
  function setupSearch() {
    const input   = document.getElementById('searchInput');
    const results = document.getElementById('searchResults');

    input.addEventListener('input', debounce(() => {
      const q = input.value.trim().toLowerCase();
      if (q.length < 2) { results.classList.remove('open'); return; }
      showSearchResults(q, results);
    }, 250));

    input.addEventListener('keydown', e => {
      if (e.key === 'Escape') { results.classList.remove('open'); input.blur(); }
    });

    document.addEventListener('click', (e) => {
      if (!e.target.closest('.topbar-search')) results.classList.remove('open');
    });
  }

  function showSearchResults(query, container) {
    const vesselMatches = state.vessels.filter(v =>
      v.name.toLowerCase().includes(query) ||
      v.mmsi.includes(query) ||
      v.flag.toLowerCase().includes(query)
    ).slice(0, 6);

    const portMatches = CONFIG.DEMO_PORTS.filter(p =>
      p.name.toLowerCase().includes(query) || p.country.toLowerCase().includes(query)
    ).slice(0, 3);

    if (!vesselMatches.length && !portMatches.length) {
      container.innerHTML = `<div class="search-result-item"><span class="result-icon">🔍</span><div class="result-info"><div class="result-name">Sin resultados</div></div></div>`;
      container.classList.add('open');
      return;
    }

    let html = '';
    vesselMatches.forEach(v => {
      const gear = CONFIG.GEAR_TYPES[v.gear] || CONFIG.GEAR_TYPES.other;
      html += `
        <div class="search-result-item" data-type="vessel" data-id="${v.id}">
          <span class="result-icon">${gear.icon}</span>
          <div class="result-info">
            <div class="result-name">${highlight(v.name, query)}</div>
            <div class="result-sub">MMSI ${v.mmsi} · ${v.flag} · ${gear.label}</div>
          </div>
          <span class="result-type-badge">Barco</span>
        </div>`;
    });

    portMatches.forEach(p => {
      html += `
        <div class="search-result-item" data-type="port" data-lat="${p.lat}" data-lon="${p.lon}">
          <span class="result-icon">⚓</span>
          <div class="result-info">
            <div class="result-name">${highlight(p.name, query)}</div>
            <div class="result-sub">${p.country}</div>
          </div>
          <span class="result-type-badge">Puerto</span>
        </div>`;
    });

    container.innerHTML = html;
    container.classList.add('open');

    container.querySelectorAll('.search-result-item').forEach(item => {
      item.addEventListener('click', () => {
        container.classList.remove('open');
        document.getElementById('searchInput').value = '';
        if (item.dataset.type === 'vessel') {
          const v = state.vessels.find(v => v.id === item.dataset.id);
          if (v) selectVessel(v);
        } else {
          state.map.setView([+item.dataset.lat, +item.dataset.lon], 10, { animate: true });
        }
      });
    });
  }

  function highlight(text, query) {
    const regex = new RegExp(`(${escapeRegex(query)})`, 'gi');
    return text.replace(regex, '<mark style="background:var(--accent-glow);color:var(--accent);border-radius:2px;padding:0 2px;">$1</mark>');
  }

  function escapeRegex(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

  // ──────────────────────────────────────────────
  //  Botones
  // ──────────────────────────────────────────────
  function setupButtons() {
    document.getElementById('toggleSidebar').addEventListener('click', () => {
      document.getElementById('sidebar').classList.toggle('collapsed');
    });

    document.getElementById('toggleTheme').addEventListener('click', () => {
      state.isDark = !state.isDark;
      document.body.classList.toggle('light-mode', !state.isDark);
      document.getElementById('toggleTheme').textContent = state.isDark ? '🌙' : '☀️';
      state.map.removeLayer(state.tileLayer);
      state.tileLayer = L.tileLayer(
        state.isDark ? CONFIG.TILE_DARK : CONFIG.TILE_LIGHT,
        { attribution: state.isDark ? CONFIG.TILE_DARK_ATTR : CONFIG.TILE_LIGHT_ATTR, maxZoom: 19 }
      ).addTo(state.map);
    });

    document.getElementById('refreshBtn').addEventListener('click', () => {
      state.vesselMap.clear();
      fetchVessels();
      toast('Actualizando datos…', 'info');
    });

    document.getElementById('centerMapBtn').addEventListener('click', () => {
      state.map.setView(CONFIG.MAP_CENTER, CONFIG.MAP_ZOOM, { animate: true });
    });
  }

  // ──────────────────────────────────────────────
  //  Stats y helpers UI
  // ──────────────────────────────────────────────
  function updateStats(vessels) {
    document.getElementById('statTotal').textContent     = vessels.length;
    document.getElementById('statFishing').textContent   = vessels.filter(v => v.isFishing || v.status === 'fishing').length;
    document.getElementById('statCountries').textContent = new Set(vessels.map(v => v.flag)).size;
  }

  function showLoader(text = 'Cargando…') {
    document.getElementById('loaderText').textContent = text;
    document.getElementById('loaderOverlay').classList.remove('hidden');
  }

  function hideLoader() {
    document.getElementById('loaderOverlay').classList.add('hidden');
  }

  function showLoadingBar(pct) {
    const bar = document.getElementById('loadingBar');
    if (!bar) return;
    bar.style.width = pct + '%';
    if (pct === 0) setTimeout(() => { bar.style.width = '0%'; }, 500);
  }

  function setApiStatus(ok) {
    const dot = document.getElementById('apiStatus');
    if (!dot) return;
    dot.style.background = ok ? 'var(--success)' : 'var(--warning)';
    dot.title = ok ? 'VesselAPI conectado' : 'Sin conexión';
  }

  function getStatusLabel(status) {
    return { fishing: '🎣 Pescando', transit: '⛵ En tránsito', anchored: '⚓ Fondeado' }[status] || status;
  }

  function toast(message, type = 'info', duration = 3000) {
    const icons = { info: 'ℹ️', success: '✅', warning: '⚠️', error: '❌' };
    const container = document.getElementById('toastContainer');
    const el = document.createElement('div');
    el.className = `toast ${type}`;
    el.innerHTML = `<span class="toast-icon">${icons[type]}</span><span class="toast-message">${message}</span>`;
    container.appendChild(el);
    setTimeout(() => {
      el.classList.add('removing');
      setTimeout(() => el.remove(), 300);
    }, duration);
  }

  function debounce(fn, ms) {
    let timer;
    return (...args) => { clearTimeout(timer); timer = setTimeout(() => fn(...args), ms); };
  }

  // ──────────────────────────────────────────────
  //  API pública
  // ──────────────────────────────────────────────
  return { init, toggleLayer, closeInfoPanel, trackVessel, showHistory, toast };

})();

document.addEventListener('DOMContentLoaded', () => {
  try {
    App.init();
  } catch (err) {
    console.error('Error crítico:', err);
    const text = document.getElementById('loaderText');
    if (text) text.textContent = 'Error al cargar. Revisa la consola (F12).';
  }
});
