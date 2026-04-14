/* ============================================================
   FishTracker — app.js
   Lógica principal: mapa, AISStream WebSocket, filtros, UI
   ============================================================ */

'use strict';

const App = (() => {

  // ──────────────────────────────────────────────
  //  Estado global
  // ──────────────────────────────────────────────
  const state = {
    map:              null,
    tileLayer:        null,
    vesselLayer:      null,
    heatLayer:        null,
    portLayer:        null,
    vesselMap:       new Map(),
    vessels:         [],
    filteredVessels: [],
    selectedVessel:  null,
    trackedVessel:   null,
    activeGears:     new Set(Object.keys(CONFIG.GEAR_TYPES)),
    activePeriod:    'week',
    layers:          { vessels: true, heatmap: true, ports: true },
    isDark:          true,
    isLoading:       false,
    apiAvailable:    false,
    ws:              null,
    wsReconnectTimer:null,
    uiUpdateTimer:   null,
  };

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
    startVesselAPIPolling();   // fuente principal: VesselAPI vía proxy
    connectAISStream();        // complemento: AISStream (cobertura global)
    startPruneTimer();
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
      zoomControl: true,
    });

    state.tileLayer = L.tileLayer(CONFIG.TILE_DARK, {
      attribution: CONFIG.TILE_DARK_ATTR,
      maxZoom: 19,
    }).addTo(state.map);

    state.vesselLayer = L.layerGroup().addTo(state.map);
    state.portLayer   = L.layerGroup().addTo(state.map);

    // Click en el mapa: cerrar panel
    state.map.on('click', () => closeInfoPanel());
  }

  // ──────────────────────────────────────────────
  //  Filtros de tipo de pesca
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
  //  VesselAPI — polling via Cloudflare Worker proxy
  // ──────────────────────────────────────────────

  let _pollTimer = null;

  function startVesselAPIPolling() {
    pollVesselAPI();                          // primera carga inmediata
    _pollTimer = setInterval(pollVesselAPI, CONFIG.POLL_INTERVAL_MS);
  }

  async function pollVesselAPI() {
    const b      = state.map.getBounds();
    const center = state.map.getCenter();
    // Radio aproximado en millas náuticas según zoom
    const zoom   = state.map.getZoom();
    const radius = Math.min(500, Math.max(10, Math.round(800 / Math.pow(2, zoom - 4))));

    // Intentamos dos endpoints comunes de VesselAPI
    const endpoints = [
      `/v1/ais/vessels?latitude=${center.lat.toFixed(4)}&longitude=${center.lng.toFixed(4)}&radius=${radius}`,
      `/v1/vessels?min_lat=${b.getSouth().toFixed(4)}&max_lat=${b.getNorth().toFixed(4)}&min_lon=${b.getWest().toFixed(4)}&max_lon=${b.getEast().toFixed(4)}`,
    ];

    for (const endpoint of endpoints) {
      try {
        const res  = await fetch(CONFIG.PROXY_URL + endpoint);
        if (!res.ok) { console.warn('[VesselAPI] HTTP', res.status, endpoint); continue; }
        const json = await res.json();
        const list = extractVesselList(json);
        if (list === null) { console.warn('[VesselAPI] Formato desconocido:', json); continue; }
        console.log(`[VesselAPI] ${list.length} barcos recibidos vía ${endpoint}`);
        list.forEach(v => ingestVesselAPIVessel(v));
        setApiStatus(true);
        scheduleUIUpdate();
        return;                               // éxito — no probar siguiente endpoint
      } catch (e) {
        console.warn('[VesselAPI] Error en', endpoint, e.message);
      }
    }

    // Si ningún endpoint funcionó, AISStream sigue activo como fallback
    console.warn('[VesselAPI] Ningún endpoint respondió correctamente');
  }

  // Extrae el array de barcos independientemente del envoltorio del JSON
  function extractVesselList(json) {
    if (Array.isArray(json))            return json;
    if (Array.isArray(json?.data))      return json.data;
    if (Array.isArray(json?.vessels))   return json.vessels;
    if (Array.isArray(json?.results))   return json.results;
    if (Array.isArray(json?.ais))       return json.ais;
    return null;
  }

  // Normaliza un objeto de VesselAPI al formato interno
  function ingestVesselAPIVessel(raw) {
    const mmsi = String(raw.mmsi || raw.MMSI || raw.vessel_id || '');
    if (!mmsi) return;

    const lat = parseFloat(raw.lat ?? raw.latitude  ?? raw.Latitude  ?? NaN);
    const lon = parseFloat(raw.lon ?? raw.longitude ?? raw.Longitude ?? NaN);
    if (isNaN(lat) || isNaN(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return;

    const type     = raw.vessel_type ?? raw.type ?? raw.ship_type ?? raw.Type ?? 0;
    const navStat  = raw.nav_status  ?? raw.navigational_status   ?? raw.NavigationalStatus ?? -1;
    const name     = (raw.name || raw.vessel_name || raw.Name || `MMSI ${mmsi}`).trim();
    const speed    = parseFloat(raw.speed ?? raw.sog ?? raw.SOG ?? 0).toFixed(1);
    const course   = Math.round(parseFloat(raw.course ?? raw.cog ?? raw.COG ?? 0));
    const now      = Date.now();

    // Filtrar no-pesqueros confirmados
    if (NON_FISHING_TYPES.has(Number(type))) {
      nonFishingMmsi.add(mmsi);
      state.vesselMap.delete(mmsi);
      return;
    }

    const existing = state.vesselMap.get(mmsi);
    if (existing) {
      existing.lat = lat; existing.lon = lon;
      existing.speed = speed; existing.course = course;
      existing.status  = mapNavStatus(navStat);
      existing.lastSeen = new Date().toLocaleTimeString('es-ES');
      existing.lastTs   = now;
      if (name && !name.startsWith('MMSI')) existing.name = name;
      if (type) { existing.aisType = type; existing.isFishing = (Number(type) === 30); }
    } else {
      state.vesselMap.set(mmsi, {
        id: mmsi, mmsi, name,
        imo:       raw.imo ? `IMO${raw.imo}` : '—',
        flag:      raw.flag ?? raw.country ?? raw.callsign?.slice(0,2) ?? '??',
        gear:      detectGearFromName(name),
        isFishing: (Number(type) === 30),
        aisType:   type,
        status:    mapNavStatus(navStat),
        lat, lon, speed, course,
        lastSeen:  new Date().toLocaleTimeString('es-ES'),
        lastTs:    now,
        source:    'vesselapi',
      });
    }
  }

  // ──────────────────────────────────────────────
  //  AISStream — WebSocket tiempo real (sin CORS)
  // ──────────────────────────────────────────────

  let _msgCount = 0;
  const nonFishingMmsi = new Set(); // MMSIs confirmados como NO pesqueros

  // Tipos AIS definitivamente no pesqueros
  const NON_FISHING_TYPES = new Set([
    60,61,62,63,64,65,66,67,68,69,   // Pasajeros
    70,71,72,73,74,75,76,77,78,79,   // Carga
    80,81,82,83,84,85,86,87,88,89,   // Tanqueros
    31,32,33,34,35,36,37,            // Remolque, militar, vela, recreo
    50,51,52,53,54,55,56,57,58,59,   // Servicios especiales
  ]);

  // Devuelve el bounding box del mapa actual en formato AISStream
  // padding = fracción extra alrededor del área visible (0.5 = 50% más)
  function getMapBBox(padding = 0.5) {
    const b = state.map.getBounds();
    const latPad = (b.getNorth() - b.getSouth()) * padding;
    const lonPad = (b.getEast()  - b.getWest())  * padding;
    return [[[
      Math.max(-90,  b.getSouth() - latPad),
      Math.max(-180, b.getWest()  - lonPad),
    ], [
      Math.min(90,  b.getNorth() + latPad),
      Math.min(180, b.getEast()  + lonPad),
    ]]];
  }

  // Reconecta con los nuevos límites del mapa al mover/zoom
  // NO limpiamos vesselMap: los barcos ya recibidos permanecen visibles
  function setupMapBoundsRefresh() {
    const reconnect = debounce(() => {
      nonFishingMmsi.clear();
      connectAISStream();
    }, 2000);
    state.map.on('moveend', reconnect);
    state.map.on('zoomend', reconnect);
  }

  function connectAISStream() {
    clearTimeout(state.wsReconnectTimer);
    if (state.ws) { state.ws.onclose = null; state.ws.close(); state.ws = null; }

    showLoader('Conectando a AISStream…');
    _msgCount = 0;
    updateMsgCounter(0);
    nonFishingMmsi.clear();

    state.ws = new WebSocket(CONFIG.AISSTREAM_WS);

    state.ws.onopen = () => {
      const bbox = getMapBBox();
      const sub  = {
        APIKey:             CONFIG.AISSTREAM_TOKEN,
        BoundingBoxes:      bbox,
        FilterMessageTypes: ['PositionReport', 'ShipStaticData'],
      };
      console.log('[AIS] Suscripción bbox:', bbox);
      state.ws.send(JSON.stringify(sub));
      setApiStatus(true);
      hideLoader();
      toast('Conectado — cargando barcos del área visible…', 'info');
    };

    state.ws.onmessage = async (evt) => {
      _msgCount++;
      updateMsgCounter(_msgCount);

      // AISStream envía Blobs binarios — convertir a texto primero
      const text = evt.data instanceof Blob ? await evt.data.text() : evt.data;

      if (_msgCount <= 2) console.log(`[AIS] Mensaje #${_msgCount}:`, text.slice(0, 200));
      if (_msgCount === 1)   toast('✅ Datos AIS recibidos — cargando barcos…', 'success');

      try { handleAISMessage(JSON.parse(text)); } catch (e) {
        if (_msgCount <= 3) console.warn('[AIS] Error parse:', e);
      }
    };

    state.ws.onerror = (e) => {
      console.error('[AIS] WebSocket error:', e);
      setApiStatus(false);
      hideLoader();
      toast('Error WebSocket — ver consola (F12)', 'error');
    };

    state.ws.onclose = (e) => {
      console.warn('[AIS] WebSocket cerrado:', e.code, e.reason);
      setApiStatus(false);
      toast(`Conexión cerrada (${e.code}). Reconectando en 5 s…`, 'warning');
      state.wsReconnectTimer = setTimeout(connectAISStream, 5000);
    };
  }

  function updateMsgCounter(n) {
    let el = document.getElementById('msgCounter');
    if (!el) {
      el = document.createElement('div');
      el.id = 'msgCounter';
      el.title = 'Mensajes AIS recibidos';
      el.style.cssText = 'font-size:11px;color:var(--text-muted);padding:0 8px;white-space:nowrap;';
      // Insertar antes del status-dot en la topbar
      const dot = document.getElementById('apiStatus');
      if (dot) dot.parentNode.insertBefore(el, dot);
    }
    el.textContent = `📡 ${n} msgs`;
  }

  function handleAISMessage(msg) {
    const meta = msg.MetaData || {};
    const mmsi = String(meta.MMSI || '');
    if (!mmsi) return;
    const now = Date.now();

    if (msg.MessageType === 'PositionReport') {
      // Ignorar MMSIs confirmados como NO pesqueros vía ShipStaticData
      if (nonFishingMmsi.has(mmsi)) return;

      const pos = msg.Message?.PositionReport || {};
      const lat = pos.Latitude, lon = pos.Longitude;
      if (lat == null || lon == null || Math.abs(lat) > 90 || Math.abs(lon) > 180) return;

      const existing = state.vesselMap.get(mmsi);
      if (existing) {
        existing.lat      = lat;
        existing.lon      = lon;
        existing.speed    = (pos.Sog ?? existing.speed).toFixed(1);
        existing.course   = Math.round(pos.Cog ?? existing.course);
        existing.status   = mapNavStatus(pos.NavigationalStatus ?? -1);
        existing.lastSeen = new Date().toLocaleTimeString('es-ES');
        existing.lastTs   = now;
      } else {
        state.vesselMap.set(mmsi, {
          id: mmsi, mmsi,
          name:      meta.ShipName?.trim() || `MMSI ${mmsi}`,
          imo: '—',  flag: meta.ShipName ? '??' : '??',
          gear:      detectGearFromName(meta.ShipName || ''),
          isFishing: null,   // null = aún sin confirmar por ShipStaticData
          aisType:   null,
          status:    mapNavStatus(pos.NavigationalStatus ?? -1),
          lat, lon,
          speed:    (pos.Sog ?? 0).toFixed(1),
          course:   Math.round(pos.Cog ?? 0),
          lastSeen: new Date().toLocaleTimeString('es-ES'),
          lastTs:   now,
        });
        if (state.vesselMap.size > 5000) {
          const oldest = [...state.vesselMap.entries()].sort((a,b) => a[1].lastTs - b[1].lastTs)[0];
          if (oldest) state.vesselMap.delete(oldest[0]);
        }
      }

    } else if (msg.MessageType === 'ShipStaticData') {
      const ship = msg.Message?.ShipStaticData || {};
      const type = ship.Type ?? 0;

      // Si el tipo está confirmado como NO pesquero, marcarlo y eliminarlo del mapa
      if (NON_FISHING_TYPES.has(type)) {
        nonFishingMmsi.add(mmsi);
        state.vesselMap.delete(mmsi);
        scheduleUIUpdate();
        return;
      }

      const v = state.vesselMap.get(mmsi);
      if (v) {
        if (ship.Name?.trim()) v.name = ship.Name.trim();
        if (ship.Imo)          v.imo  = `IMO${ship.Imo}`;
        v.isFishing = (type === 30); // tipo 30 = pesquero confirmado
        v.aisType   = type;
        v.gear      = detectGearFromName(v.name) || 'trawlers';
        v.lastTs    = now;
      } else if (!nonFishingMmsi.has(mmsi) && !NON_FISHING_TYPES.has(type)) {
        // ShipStaticData llegó antes que PositionReport: pre-registrar
        state.vesselMap.set(mmsi, {
          id: mmsi, mmsi,
          name:      ship.Name?.trim() || `MMSI ${mmsi}`,
          imo:       ship.Imo ? `IMO${ship.Imo}` : '—',
          flag:      '??',
          gear:      detectGearFromName(ship.Name || '') || 'trawlers',
          isFishing: (type === 30),
          aisType:   type,
          status:    'transit',
          lat:       null, lon: null,
          speed:     '0.0', course: 0,
          lastSeen:  new Date().toLocaleTimeString('es-ES'),
          lastTs:    now,
        });
      }
    }

    scheduleUIUpdate();
  }

  function scheduleUIUpdate() {
    if (state.uiUpdateTimer) return;
    state.uiUpdateTimer = setTimeout(() => {
      state.uiUpdateTimer = null;
      applyFilters();
    }, 2000);
  }

  function startPruneTimer() {
    setInterval(() => {
      const { inactiveMs } = CONFIG.PERIODS[state.activePeriod];
      if (!inactiveMs) return;
      const cutoff = Date.now() - inactiveMs;
      let pruned = false;
      state.vesselMap.forEach((v, k) => { if (v.lastTs < cutoff) { state.vesselMap.delete(k); pruned = true; } });
      if (pruned) applyFilters();
    }, 60_000);
  }

  function detectGearFromName(name) {
    const n = (name || '').toLowerCase();
    if (n.includes('trawl')   || n.includes('arrastre'))  return 'trawlers';
    if (n.includes('seine')   || n.includes('cerco'))     return 'purse_seines';
    if (n.includes('longlin') || n.includes('palangre'))  return 'longliners';
    if (n.includes('gillnet') || n.includes('enmalle'))   return 'set_gillnets';
    return 'trawlers';
  }

  function mapNavStatus(n) {
    if (n === 1) return 'anchored';
    if (n === 7) return 'fishing';
    return 'transit';
  }

  // ──────────────────────────────────────────────
  //  Aplicar filtros y renderizar
  // ──────────────────────────────────────────────
  function applyFilters() {
    // Solo barcos con posición conocida
    state.vessels = Array.from(state.vesselMap.values()).filter(v => v.lat != null);

    // Filtro de tipo de arte activo
    state.filteredVessels = state.vessels.filter(v => state.activeGears.has(v.gear));

    // Barcos confirmados como pesqueros (tipo 30) siempre visibles aunque no coincida el arte
    const confirmed = state.vessels.filter(v => v.isFishing === true && !state.activeGears.has(v.gear));
    const merged = [...state.filteredVessels, ...confirmed];

    // Ordenar: pesqueros confirmados primero, luego por última señal
    merged.sort((a, b) => {
      if (a.isFishing && !b.isFishing) return -1;
      if (!a.isFishing && b.isFishing)  return  1;
      return b.lastTs - a.lastTs;
    });

    // Actualizar contadores por tipo de arte
    Object.keys(CONFIG.GEAR_TYPES).forEach(key => {
      const el = document.getElementById(`gearCount_${key}`);
      if (el) el.textContent = state.vessels.filter(v => v.gear === key).length;
    });

    renderVesselList(merged);
    renderVesselMarkers(merged);
    renderHeatmap(merged);
    updateStats(merged);
  }

  // ──────────────────────────────────────────────
  //  Renderizar marcadores en el mapa
  // ──────────────────────────────────────────────
  function renderVesselMarkers(vessels) {
    state.vesselLayer.clearLayers();

    if (!state.layers.vessels) return;

    vessels.forEach(vessel => {
      const gear  = CONFIG.GEAR_TYPES[vessel.gear];
      const color = gear?.color || '#888';

      // Pesqueros confirmados (AIS tipo 30): borde más grueso y badge 🐟
      const isCfm   = vessel.isFishing === true;
      const badge   = isCfm ? '<span style="position:absolute;top:-6px;right:-6px;font-size:10px;">🐟</span>' : '';
      const border  = isCfm ? `border:2px solid ${color};box-shadow:0 0 6px ${color};` : `border:1px solid ${color};`;

      const icon = L.divIcon({
        className: '',
        html: `<div class="vessel-marker-icon" style="position:relative;background:${color}22;${border}">${gear?.icon || '🚢'}${badge}</div>`,
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
    const gear = CONFIG.GEAR_TYPES[v.gear];
    return `
      <div style="line-height:1.6">
        <b>${gear?.icon || '🚢'} ${v.name}</b><br/>
        <span style="color:var(--text-secondary);font-size:11px">
          ${gear?.label || '—'} &bull; ${v.flag} &bull; ${getStatusLabel(v.status)}
        </span><br/>
        <span style="font-size:11px">📡 MMSI: ${v.mmsi}</span><br/>
        <span style="font-size:11px">💨 Velocidad: ${v.speed} kn &bull; Rumbo: ${v.course}°</span>
      </div>`;
  }

  // ──────────────────────────────────────────────
  //  Mapa de calor
  // ──────────────────────────────────────────────
  function renderHeatmap(vessels) {
    if (state.heatLayer) {
      state.map.removeLayer(state.heatLayer);
      state.heatLayer = null;
    }

    if (!state.layers.heatmap || vessels.length === 0) return;
    if (typeof L.heatLayer !== 'function') return; // plugin no disponible

    const points = vessels.map(v => [v.lat, v.lon, v.status === 'fishing' ? 1.0 : 0.3]);

    state.heatLayer = L.heatLayer(points, {
      radius:  28,
      blur:    20,
      maxZoom: 10,
      max:     1.0,
      gradient: { 0.0: '#0000ff', 0.3: '#00ffff', 0.5: '#00ff00', 0.7: '#ffff00', 1.0: '#ff0000' },
    }).addTo(state.map);
  }

  // ──────────────────────────────────────────────
  //  Lista de barcos en sidebar
  // ──────────────────────────────────────────────
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

    // Eventos de clic en tarjetas
    container.querySelectorAll('.vessel-card').forEach(card => {
      card.addEventListener('click', () => {
        const vessel = state.filteredVessels.find(v => v.id === card.dataset.id);
        if (vessel) selectVessel(vessel);
      });
    });
  }

  function buildVesselCardHTML(v) {
    const gear        = CONFIG.GEAR_TYPES[v.gear];
    const fishBadge   = v.isFishing === true
      ? '<span style="font-size:10px;background:#27ae6022;color:#27ae60;border:1px solid #27ae60;border-radius:4px;padding:0 4px;margin-left:4px;">🐟 Pesquero</span>'
      : '';
    return `
      <div class="vessel-card ${state.selectedVessel?.id === v.id ? 'selected' : ''}" data-id="${v.id}">
        <div class="vessel-card-header">
          <span class="vessel-gear-icon">${gear?.icon || '🚢'}</span>
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
  //  Seleccionar barco
  // ──────────────────────────────────────────────
  function selectVessel(vessel) {
    state.selectedVessel = vessel;

    // Resaltar tarjeta
    document.querySelectorAll('.vessel-card').forEach(c => {
      c.classList.toggle('selected', c.dataset.id === vessel.id);
    });

    // Centrar mapa
    state.map.setView([vessel.lat, vessel.lon], Math.max(state.map.getZoom(), 7), { animate: true });

    // Abrir panel de info
    openInfoPanel(vessel);
  }

  // ──────────────────────────────────────────────
  //  Panel de información
  // ──────────────────────────────────────────────
  function openInfoPanel(vessel) {
    const gear = CONFIG.GEAR_TYPES[vessel.gear];

    document.getElementById('infoPanelIcon').textContent = gear?.icon || '🚢';
    document.getElementById('infoPanelName').textContent = vessel.name;
    document.getElementById('infoPanelSub').textContent  = `${gear?.label || '—'} • ${vessel.flag} • ${getStatusLabel(vessel.status)}`;

    document.getElementById('infoPanelBody').innerHTML = `
      <div class="info-row"><span class="info-key">MMSI</span>       <span class="info-val">${vessel.mmsi}</span></div>
      <div class="info-row"><span class="info-key">IMO</span>        <span class="info-val">${vessel.imo || '—'}</span></div>
      <div class="info-row"><span class="info-key">Bandera</span>    <span class="info-val">🏳️ ${vessel.flag}</span></div>
      <div class="info-row"><span class="info-key">Tipo pesca</span> <span class="info-val">${gear?.label || '—'}</span></div>
      <div class="info-row"><span class="info-key">Estado</span>     <span class="info-val">${getStatusLabel(vessel.status)}</span></div>
      <div class="info-row"><span class="info-key">Velocidad</span>  <span class="info-val">${vessel.speed} kn</span></div>
      <div class="info-row"><span class="info-key">Rumbo</span>      <span class="info-val">${vessel.course}°</span></div>
      <div class="info-row"><span class="info-key">Latitud</span>    <span class="info-val">${vessel.lat.toFixed(4)}°</span></div>
      <div class="info-row"><span class="info-key">Longitud</span>   <span class="info-val">${vessel.lon.toFixed(4)}°</span></div>
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
    toast(`Historial de ${state.selectedVessel.name} (requiere API GFW)`, 'info');
  }

  // ──────────────────────────────────────────────
  //  Capas toggle
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
      v.flag.toLowerCase().includes(query) ||
      (v.imo && v.imo.toLowerCase().includes(query))
    ).slice(0, 6);

    const portMatches = CONFIG.DEMO_PORTS.filter(p =>
      p.name.toLowerCase().includes(query) ||
      p.country.toLowerCase().includes(query)
    ).slice(0, 3);

    if (vesselMatches.length === 0 && portMatches.length === 0) {
      container.innerHTML = `<div class="search-result-item"><span class="result-icon">🔍</span><div class="result-info"><div class="result-name">Sin resultados</div><div class="result-sub">Prueba con otro nombre o MMSI</div></div></div>`;
      container.classList.add('open');
      return;
    }

    let html = '';

    vesselMatches.forEach(v => {
      const gear = CONFIG.GEAR_TYPES[v.gear];
      html += `
        <div class="search-result-item" data-type="vessel" data-id="${v.id}">
          <span class="result-icon">${gear?.icon || '🚢'}</span>
          <div class="result-info">
            <div class="result-name">${highlight(v.name, query)}</div>
            <div class="result-sub">MMSI ${v.mmsi} · ${v.flag} · ${gear?.label}</div>
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
          if (v) {
            // Asegurar que el gear está activo
            if (!state.activeGears.has(v.gear)) {
              state.activeGears.add(v.gear);
              applyFilters();
            }
            selectVessel(v);
          }
        } else if (item.dataset.type === 'port') {
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

      // Cambiar tile layer
      state.map.removeLayer(state.tileLayer);
      state.tileLayer = L.tileLayer(
        state.isDark ? CONFIG.TILE_DARK : CONFIG.TILE_LIGHT,
        { attribution: state.isDark ? CONFIG.TILE_DARK_ATTR : CONFIG.TILE_LIGHT_ATTR, maxZoom: 19 }
      ).addTo(state.map);
    });

    document.getElementById('refreshBtn').addEventListener('click', () => {
      state.vesselMap.clear();
      nonFishingMmsi.clear();
      connectAISStream();
    });

    document.getElementById('centerMapBtn').addEventListener('click', () => {
      state.map.setView(CONFIG.MAP_CENTER, CONFIG.MAP_ZOOM, { animate: true });
    });
  }

  // ──────────────────────────────────────────────
  //  Stats
  // ──────────────────────────────────────────────
  function updateStats(vessels) {
    document.getElementById('statTotal').textContent     = vessels.length;
    // "Pescando" = AIS tipo 30 confirmado O estado de navegación 7 (activamente pescando)
    const fishingCount = vessels.filter(v => v.isFishing === true || v.status === 'fishing').length;
    document.getElementById('statFishing').textContent   = fishingCount;
    document.getElementById('statCountries').textContent = new Set(vessels.map(v => v.flag)).size;
  }

  // ──────────────────────────────────────────────
  //  UI helpers
  // ──────────────────────────────────────────────
  function showLoader(text = 'Cargando…') {
    state.isLoading = true;
    document.getElementById('loaderText').textContent = text;
    document.getElementById('loaderOverlay').classList.remove('hidden');
  }

  function hideLoader() {
    state.isLoading = false;
    document.getElementById('loaderOverlay').classList.add('hidden');
  }

  function setLoadingBar(pct) {
    document.getElementById('loadingBar').style.width = `${pct}%`;
  }

  function setApiStatus(ok) {
    const dot = document.getElementById('apiStatus');
    dot.style.background = ok ? 'var(--success)' : 'var(--warning)';
    dot.title = ok ? 'AISStream conectado' : 'Sin conexión';
  }

  function getStatusLabel(status) {
    return { fishing: '🎣 Pescando', transit: '⛵ En tránsito', anchored: '⚓ Fondeado' }[status] || status;
  }

  function toast(message, type = 'info', duration = 4000) {
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
  //  API pública del módulo
  // ──────────────────────────────────────────────
  return {
    init,
    toggleLayer,
    closeInfoPanel,
    trackVessel,
    showHistory,
    toast,
  };

})();

// Arrancar cuando el DOM esté listo
document.addEventListener('DOMContentLoaded', () => {
  try {
    App.init();
  } catch (err) {
    console.error('Error crítico en la inicialización:', err);
    const overlay = document.getElementById('loaderOverlay');
    const text    = document.getElementById('loaderText');
    if (text)    text.textContent = 'Error al cargar. Revisa la consola (F12).';
    if (overlay) overlay.classList.remove('hidden');
  }
});
