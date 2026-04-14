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
    vesselMap:       new Map(),   // mmsi/id → vessel object
    vessels:         [],
    filteredVessels: [],
    selectedVessel:  null,
    trackedVessel:   null,
    activeGears:     new Set(Object.keys(CONFIG.GEAR_TYPES)),
    activePeriod:    'today',
    layers:          { vessels: true, heatmap: true, ports: true },
    isDark:          true,
    isLoading:       false,
    apiAvailable:    false,
    refreshTimer:    null,
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
    setupMapRefresh();
    loadVessels();
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
        loadVessels();
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
  //  VesselAPI — REST
  // ──────────────────────────────────────────────

  // Carga barcos: limpia el mapa y consulta las zonas relevantes
  async function loadVessels() {
    if (state.isLoading) return;
    showLoader('Consultando VesselAPI…');
    setLoadingBar(15);

    try {
      const tiles   = getQueryTiles();
      const results = await Promise.allSettled(tiles.map(queryBoundingBox));

      state.vesselMap.clear();
      let count = 0;

      results.forEach(r => {
        if (r.status !== 'fulfilled') return;
        (r.value || []).forEach(v => {
          if (!isFishingVessel(v)) return;
          const parsed = parseVesselAPIVessel(v);
          if (parsed.lat === 0 && parsed.lon === 0) return; // sin posición
          state.vesselMap.set(parsed.id, parsed);
          count++;
        });
      });

      setApiStatus(true);
      setLoadingBar(80);
      applyFilters();
      setLoadingBar(100);
      toast(`${count} barcos pesqueros cargados`, count > 0 ? 'success' : 'info');

    } catch (err) {
      console.error('VesselAPI error:', err);
      setApiStatus(false);
      toast(`Error VesselAPI: ${err.message}`, 'error');
    } finally {
      hideLoader();
      setTimeout(() => setLoadingBar(0), 400);
    }
  }

  // Devuelve los tiles a consultar según el zoom actual
  function getQueryTiles() {
    const zoom = state.map.getZoom();

    // Zoom bajo → usar zonas pesqueras predefinidas (globales)
    if (zoom < 7) return CONFIG.FISHING_ZONES;

    // Zoom alto → tilelar el área visible en celdas de 4° (máx 9 tiles)
    const b = state.map.getBounds();
    return tileBounds(
      b.getSouth(), b.getNorth(),
      b.getWest(),  b.getEast(),
      4, 9
    );
  }

  // Divide un rectángulo en celdas de maxDeg°, devuelve hasta maxTiles celdas
  function tileBounds(south, north, west, east, maxDeg, maxTiles) {
    const tiles = [];
    for (let lat = Math.floor(south / maxDeg) * maxDeg; lat < north; lat += maxDeg) {
      for (let lon = Math.floor(west / maxDeg) * maxDeg; lon < east; lon += maxDeg) {
        tiles.push({
          latBottom: Math.max(-90,  lat),
          latTop:    Math.min( 90,  lat + maxDeg),
          lonLeft:   Math.max(-180, lon),
          lonRight:  Math.min( 180, lon + maxDeg),
        });
        if (tiles.length >= maxTiles) return tiles;
      }
    }
    return tiles.length ? tiles : CONFIG.FISHING_ZONES;
  }

  // Una llamada REST a /location/vessels/bounding-box
  async function queryBoundingBox(tile) {
    const { hours } = CONFIG.PERIODS[state.activePeriod];
    const timeTo   = new Date();
    const timeFrom = new Date(timeTo.getTime() - hours * 3600000);

    const params = new URLSearchParams({
      latBottom:          tile.latBottom.toFixed(4),
      latTop:             tile.latTop.toFixed(4),
      lonLeft:            tile.lonLeft.toFixed(4),
      lonRight:           tile.lonRight.toFixed(4),
      'time.from':        timeFrom.toISOString(),
      'time.to':          timeTo.toISOString(),
      'pagination.limit': '50',
    });

    const res = await fetch(
      `${CONFIG.VESSELAPI_BASE}/location/vessels/bounding-box?${params}`,
      { headers: { 'Authorization': `Bearer ${CONFIG.VESSELAPI_TOKEN}` } }
    );

    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
    const data = await res.json();
    return data.vessels || data.vesselPositions || [];
  }

  // ¿Es este barco un pesquero?
  function isFishingVessel(v) {
    const type      = String(v.type || v.vesselType || v.shipType || '').toLowerCase();
    const navStatus = v.position?.nav_status ?? v.navStatus ?? -1;
    if (type.includes('fish')) return true;
    if (type === '30')         return true;
    if (navStatus === 7)       return true;
    return false;
  }

  // Convierte respuesta VesselAPI → objeto interno
  function parseVesselAPIVessel(v) {
    const pos = v.position || {};
    const id  = String(v.mmsi || v.id || Math.random());
    return {
      id,
      name:     v.name || `MMSI ${id}`,
      mmsi:     v.mmsi || '—',
      imo:      v.imo  ? `IMO${v.imo}` : '—',
      flag:     v.flag || v.countryCode || '??',
      gear:     detectGearFromName(v.name || ''),
      status:   mapNavStatus(pos.nav_status ?? -1),
      lat:      pos.latitude  ?? 0,
      lon:      pos.longitude ?? 0,
      speed:    (pos.sog ?? 0).toFixed(1),
      course:   Math.round(pos.cog ?? 0),
      lastSeen: pos.timestamp
                  ? new Date(pos.timestamp).toLocaleTimeString('es-ES')
                  : new Date().toLocaleTimeString('es-ES'),
      lastTs:   Date.now(),
    };
  }

  // Re-consulta cuando el mapa se mueve (debounced) y auto-refresca cada 5 min
  function setupMapRefresh() {
    const debouncedLoad = debounce(loadVessels, 1500);
    state.map.on('moveend', debouncedLoad);
    state.map.on('zoomend', debouncedLoad);
    state.refreshTimer = setInterval(loadVessels, 5 * 60 * 1000);
  }

  // Detecta arte de pesca por el nombre del barco
  function detectGearFromName(name) {
    const n = (name || '').toLowerCase();
    if (n.includes('trawl')   || n.includes('arrastre'))  return 'trawlers';
    if (n.includes('seine')   || n.includes('cerco'))     return 'purse_seines';
    if (n.includes('longlin') || n.includes('palangre'))  return 'longliners';
    if (n.includes('gillnet') || n.includes('enmalle'))   return 'set_gillnets';
    return 'trawlers';
  }

  // Mapea nav_status AIS → estado interno
  function mapNavStatus(n) {
    if (n === 1) return 'anchored';
    if (n === 7) return 'fishing';
    return 'transit';
  }

  // ──────────────────────────────────────────────
  //  Aplicar filtros y renderizar
  // ──────────────────────────────────────────────
  function applyFilters() {
    // Derivar array desde el mapa vivo
    state.vessels = Array.from(state.vesselMap.values());
    state.filteredVessels = state.vessels.filter(v => state.activeGears.has(v.gear));

    // Actualizar contadores por tipo de arte
    Object.keys(CONFIG.GEAR_TYPES).forEach(key => {
      const el = document.getElementById(`gearCount_${key}`);
      if (el) el.textContent = state.vessels.filter(v => v.gear === key).length;
    });

    renderVesselList(state.filteredVessels);
    renderVesselMarkers(state.filteredVessels);
    renderHeatmap(state.filteredVessels);
    updateStats(state.filteredVessels);
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

      const icon = L.divIcon({
        className: '',
        html: `<div class="vessel-marker-icon" style="background:${color}22;border-color:${color};">${gear?.icon || '🚢'}</div>`,
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
    const gear = CONFIG.GEAR_TYPES[v.gear];
    return `
      <div class="vessel-card ${state.selectedVessel?.id === v.id ? 'selected' : ''}" data-id="${v.id}">
        <div class="vessel-card-header">
          <span class="vessel-gear-icon">${gear?.icon || '🚢'}</span>
          <span class="vessel-name">${v.name}</span>
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
      loadVessels();
    });

    document.getElementById('centerMapBtn').addEventListener('click', () => {
      state.map.setView(CONFIG.MAP_CENTER, CONFIG.MAP_ZOOM, { animate: true });
    });
  }

  // ──────────────────────────────────────────────
  //  Stats
  // ──────────────────────────────────────────────
  function updateStats(vessels) {
    document.getElementById('statTotal').textContent    = vessels.length;
    document.getElementById('statFishing').textContent  = vessels.filter(v => v.status === 'fishing').length;
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
    dot.title = ok ? 'VesselAPI conectada' : 'Sin conexión a VesselAPI';
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
