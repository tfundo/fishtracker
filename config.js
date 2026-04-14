// ============================================================
//  FishTracker — Configuración
//  Obtén tu token gratuito en: https://globalfishingwatch.org/our-apis/
// ============================================================

const CONFIG = {
  // ---------- Cloudflare Worker Proxy → VesselAPI ----------
  // El Worker añade cabeceras CORS para que GitHub Pages pueda llamarlo
  PROXY_URL:        'https://fishproxy.jsosa86.workers.dev',
  POLL_INTERVAL_MS: 60000,   // refresco cada 60 segundos (conservar cuota)

  // ---------- Mapa ----------
  MAP_CENTER: [20, 0],
  MAP_ZOOM: 3,
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

  // ---------- Puertos principales (demo sin API) ----------
  DEMO_PORTS: [
    { name: 'Vigo',         country: 'España',    lat: 42.2406, lon: -8.7207 },
    { name: 'Bergen',       country: 'Noruega',   lat: 60.3913, lon:  5.3221 },
    { name: 'Tokyo',        country: 'Japón',     lat: 35.6895, lon: 139.6917 },
    { name: 'Busan',        country: 'Corea',     lat: 35.1796, lon: 129.0756 },
    { name: 'Gloucester',   country: 'EE.UU.',    lat: 42.6159, lon: -70.6620 },
    { name: 'Mar del Plata',country: 'Argentina', lat: -38.0055,lon: -57.5426 },
    { name: 'Dakar',        country: 'Senegal',   lat: 14.6937, lon: -17.4441 },
    { name: 'Mumbai',       country: 'India',     lat: 18.9388, lon: 72.8354  },
    { name: 'Nuuk',         country: 'Groenlandia',lat:64.1814, lon: -51.6941 },
    { name: 'Reykjavik',    country: 'Islandia',  lat: 64.1355, lon: -21.8954 },
  ],
};
