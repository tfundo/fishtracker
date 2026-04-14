/* ============================================================
   FishTracker — app.js
   Fuente de datos: AISStream.io WebSocket (Class A + Class B)
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
    startAISStream();
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
  //  AISStream.io — WebSocket real-time
  //  Soporta Class A (PositionReport) y Class B (StandardClassBPositionReport)
  //  Class B = barcos pequeños, pesqueros, recreo
  // ──────────────────────────────────────────────
  let _ws               = null;
  let _wsReconnectTimer = null;

  // Mapa MID (3 primeros dígitos MMSI) → bandera
  const MID_TO_FLAG = {
    '211':'DE','212':'CY','215':'MA','219':'DK',
    '224':'ES','225':'ES','226':'ES',
    '227':'FR','228':'FR','229':'FR',
    '232':'GB','235':'GB',
    '239':'GR','240':'GR','241':'GR',
    '247':'IT','248':'MT',
    '255':'PT','263':'PT',
    '258':'NO','265':'SE','266':'SE',
    '271':'TR','273':'RU',
    '338':'US','366':'US','367':'US',
  };

  function mmsiToFlag(mmsi) {
    return MID_TO_FLAG[String(mmsi).slice(0, 3)] || '??';
  }

  // Código de tipo AIS (campo Type / ShipType) → clave de GEAR_TYPES
  function aisTypeToGear(type) {
    if (type === 30)                         return 'fishing';
    if ([31,32,33,52,53].includes(type))     return 'tug';
    if (type === 36 || type === 37)          return 'pleasure';
    if (type >= 60 && type <= 69)            return 'passenger';
    if (type >= 70 && type <= 79)            return 'cargo';
    if (type >= 80 && type <= 89)            return 'tanker';
    return 'other';
  }

  function aisTypeName(type) {
    const names = {
      30:'Barco de pesca', 31:'Remolque', 32:'Remolque (gran)',
      33:'Draga', 34:'Operaciones buceo', 35:'Militar',
      36:'Velero', 37:'Embarcación recreo',
      50:'Práctico', 51:'SAR', 52:'Remolcador', 53:'Avituallamiento',
      60:'Pasajeros', 70:'Carga general', 71:'Granelero',
      72:'Barcaza', 73:'Portacontenedores',
      80:'Tanquero', 81:'Tanquero petróleo', 84:'Tanquero GLP',
    };
    if (names[type]) return names[type];
    if (type >= 60 && type <= 69) return 'Pasajeros';
    if (type >= 70 && type <= 79) return 'Carga';
    if (type >= 80 && type <= 89) return 'Tanquero';
    return 'Otro';
  }

  // NavigationalStatus AIS → estado interno
  function mapNavStatus(n) {
    if (n === 1 || n === 5 || n === 6) return 'anchored';
    if (n === 7)                        return 'fishing';
    return 'transit';
  }

  // Adivinanza por nombre (fallback mientras llega el mensaje estático)
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

  function startAISStream() {
    connectAISStream();
  }

  function connectAISStream() {
    // Cancelar reconexión pendiente si la hay
    if (_wsReconnectTimer) { clearTimeout(_wsReconnectTimer); _wsReconnectTimer = null; }

    // Cerrar conexión anterior limpiamente
    if (_ws) {
      _ws.onclose = null;
      _ws.close();
      _ws = null;
    }

    const b = state.map.getBounds();
    const s = b.getSouth(), n = b.getNorth();
    const w = b.getWest(),  e = b.getEast();

    showLoadingBar(20);
    setApiStatus(false);

    _ws = new WebSocket(CONFIG.AISSTREAM_WS_URL);

    _ws.onopen = () => {
      const subscription = {
        APIKey: CONFIG.AISSTREAM_API_KEY,
        BoundingBoxes: [[[s, w], [n, e]]],
        FilterMessageTypes: [
          'PositionReport',               // Class A (grandes)
          'StandardClassBPositionReport', // Class B (pesqueros pequeños)
          'ShipStaticData',               // Nombre/tipo Class A
          'StaticDataReport',             // Nombre/tipo Class B
        ],
      };
      _ws.send(JSON.stringify(subscription));
      setApiStatus(true);
      showLoadingBar(100);
      setTimeout(() => showLoadingBar(0), 400);
      console.log('[AISStream] conectado, zona:', s.toFixed(2), w.toFixed(2), '→', n.toFixed(2), e.toFixed(2));
    };

    _ws.onmessage = (event) => {
      try { ingestAISMessage(JSON.parse(event.data)); }
      catch (err) { console.warn('[AISStream] parse error', err); }
    };

    _ws.onclose = (ev) => {
      console.warn('[AISStream] desconectado', ev.code);
      setApiStatus(false);
      _wsReconnectTimer = setTimeout(() => {
        toast('Reconectando a AISStream…', 'warning');
        connectAISStream();
      }, 5000);
    };

    _ws.onerror = () => { /* onclose se dispara después */ };
  }

  function ingestAISMessage(msg) {
    const type = msg.MessageType;
    const meta = msg.MetaData || {};
    const mmsi = String(meta.MMSI || meta.MMSI_String || '');
    if (!mmsi) return;

    if (type === 'PositionReport') {
      const pos = msg.Message?.PositionReport;
      if (!pos) return;
      const lat = pos.Latitude  ?? meta.latitude;
      const lon = pos.Longitude ?? meta.longitude;
      if (!lat || !lon || lat === 0 && lon === 0) return;
      upsertVessel(mmsi, {
        lat, lon,
        speed:  parseFloat(pos.Sog ?? 0).toFixed(1),
        course: Math.round(pos.Cog ?? pos.TrueHeading ?? 0),
        status: mapNavStatus(pos.NavigationalStatus ?? -1),
        name:   (meta.ShipName || '').trim(),
      });

    } else if (type === 'StandardClassBPositionReport') {
      const pos = msg.Message?.StandardClassBPositionReport;
      if (!pos) return;
      const lat = pos.Latitude  ?? meta.latitude;
      const lon = pos.Longitude ?? meta.longitude;
      if (!lat || !lon || lat === 0 && lon === 0) return;
      upsertVessel(mmsi, {
        lat, lon,
        speed:  parseFloat(pos.Sog ?? 0).toFixed(1),
        course: Math.round(pos.Cog ?? pos.TrueHeading ?? 0),
        status: 'transit',
        name:   (meta.ShipName || '').trim(),
        isClassB: true,
      });

    } else if (type === 'ShipStaticData') {
      const s = msg.Message?.ShipStaticData;
      if (!s) return;
      const gear = aisTypeToGear(s.Type ?? 0);
      const info = {
        shipType: gear,
        flag:     mmsiToFlag(mmsi),
        rawType:  aisTypeName(s.Type ?? 0),
        imo:      s.ImoNumber ? `IMO${s.ImoNumber}` : '—',
        name:     (s.Name || meta.ShipName || '').trim(),
      };
      mmsiTypeCache.set(mmsi, info);
      applyStaticInfo(mmsi, info);

    } else if (type === 'StaticDataReport') {
      // AIS tipo 24 — datos estáticos Class B (nombre, tipo, callsign)
      const s = msg.Message?.StaticDataReport;
      if (!s) return;
      // Parte A tiene nombre, Parte B tiene tipo
      const name = (s.Name || s.ReportA?.Name || s.ReportB?.Name || meta.ShipName || '').trim();
      const shipTypeCode = s.Type ?? s.ReportB?.ShipType ?? 0;
      const gear = aisTypeToGear(shipTypeCode);
      const info = {
        shipType: gear,
        flag:     mmsiToFlag(mmsi),
        rawType:  aisTypeName(shipTypeCode),
        imo:      '—',
        name,
      };
      mmsiTypeCache.set(mmsi, info);
      applyStaticInfo(mmsi, info);
    }
  }

  function upsertVessel(mmsi, update) {
    const now    = Date.now();
    const cached = mmsiTypeCache.get(mmsi);
    const gear   = cached?.shipType || guessTypeFromName(update.name || '');
    const flag   = cached?.flag     || mmsiToFlag(mmsi);

    const existing = state.vesselMap.get(mmsi);
    if (existing) {
      Object.assign(existing, {
        lat: update.lat, lon: update.lon,
        speed: update.speed, course: update.course,
        status: update.status,
        gear, flag,
        lastSeen: new Date().toLocaleTimeString('es-ES'),
        lastTs: now,
      });
      if (update.name) existing.name = update.name;
      if (cached) {
        existing.isFishing = (gear === 'fishing');
        existing.rawType   = cached.rawType;
        existing.imo       = cached.imo;
      }
    } else {
      state.vesselMap.set(mmsi, {
        id: mmsi, mmsi, gear, flag,
        name:      update.name || `MMSI ${mmsi}`,
        imo:       cached?.imo || '—',
        isFishing: cached ? (gear === 'fishing') : null,
        status:    update.status || 'transit',
        lat:       update.lat,
        lon:       update.lon,
        speed:     update.speed,
        course:    update.course,
        lastSeen:  new Date().toLocaleTimeString('es-ES'),
        lastTs:    now,
      });
    }
    scheduleUIUpdate();
  }

  function applyStaticInfo(mmsi, info) {
    const vessel = state.vesselMap.get(mmsi);
    if (!vessel) return;
    if (info.name)    vessel.name      = info.name;
    vessel.gear      = info.shipType;
    vessel.flag      = info.flag;
    vessel.rawType   = info.rawType;
    vessel.imo       = info.imo;
    vessel.isFishing = (info.shipType === 'fishing');
    scheduleUIUpdate();
  }

  // Al mover/zoom: reconectar WebSocket con los nuevos límites del mapa
  function setupMapBoundsRefresh() {
    const refresh = debounce(() => {
      state.vesselMap.clear();
      connectAISStream();
    }, 1000);
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
      connectAISStream();
      toast('Reconectando a AISStream…', 'info');
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
    dot.title = ok ? 'AISStream conectado' : 'Sin conexión';
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
