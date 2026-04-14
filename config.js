// ============================================================
//  FishTracker — Configuración
// ============================================================

const CONFIG = {
  // ---------- AISStream.io — WebSocket real-time, gratis ----------
  AISSTREAM_API_KEY: '80e4d5513c36e34d2ed75ae3f0a5a2b0cafc31f3',
  AISSTREAM_WS_URL:  'wss://stream.aisstream.io/v0/stream',

  // ---------- Mapa ----------
  MAP_CENTER: [41.4, 2.2],   // Costa Catalana (Barcelona)
  MAP_ZOOM: 9,
  MAP_MIN_ZOOM: 2,
  MAP_MAX_ZOOM: 18,

  // Tiles oscuros (CartoDB Dark Matter)
  TILE_DARK: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
  TILE_DARK_ATTR: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>',

  // Tiles claros (CartoDB Positron)
  TILE_LIGHT: 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png',
  TILE_LIGHT_ATTR: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>',

  // ---------- Tipos de barco (como VesselFinder) ----------
  GEAR_TYPES: {
    fishing:   { label: 'Pesca',      icon: '🎣', color: '#27ae60' },
    cargo:     { label: 'Carga',      icon: '📦', color: '#3498db' },
    tanker:    { label: 'Tanquero',   icon: '🛢️', color: '#e74c3c' },
    passenger: { label: 'Pasajeros',  icon: '🚢', color: '#9b59b6' },
    tug:       { label: 'Remolque',   icon: '⚓', color: '#f39c12' },
    pleasure:  { label: 'Recreo',     icon: '🛥️', color: '#e67e22' },
    other:     { label: 'Otros',      icon: '🚤', color: '#95a5a6' },
  },

  // ---------- Periodos (tiempo máximo de inactividad antes de retirar un barco) ----------
  PERIODS: {
    today:   { label: 'Hoy',     inactiveMs: 30  * 60 * 1000 },
    week:    { label: '7 días',  inactiveMs: 180 * 60 * 1000 },
    month:   { label: '30 días', inactiveMs: 720 * 60 * 1000 },
    year:    { label: '1 año',   inactiveMs: 0               },
  },

  // ---------- Puertos principales ----------
  DEMO_PORTS: [
    // Costa Catalana
    { name: 'Barcelona',              country: 'España',  lat: 41.3496, lon:  2.1777 },
    { name: 'Tarragona',              country: 'España',  lat: 41.0935, lon:  1.2628 },
    { name: 'Palamós',                country: 'España',  lat: 41.8486, lon:  3.1313 },
    { name: 'Roses',                  country: 'España',  lat: 42.2638, lon:  3.1791 },
    { name: 'Blanes',                 country: 'España',  lat: 41.6728, lon:  2.7970 },
    { name: 'Vilanova i la Geltrú',   country: 'España',  lat: 41.2194, lon:  1.7250 },
    { name: "Sant Carles de la Ràpita", country: 'España', lat: 40.6094, lon: 0.5897 },
    // Resto Mediterráneo
    { name: 'Valencia',  country: 'España',  lat: 39.4561, lon:  0.3208 },
    { name: 'Marseille', country: 'Francia', lat: 43.2965, lon:  5.3698 },
    { name: 'Génova',    country: 'Italia',  lat: 44.4056, lon:  8.9463 },
    { name: 'Vigo',      country: 'España',  lat: 42.2406, lon: -8.7207 },
  ],
};
