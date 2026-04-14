// ============================================================
//  FishTracker — Configuración
//  Obtén tu token gratuito en: https://globalfishingwatch.org/our-apis/
// ============================================================

const CONFIG = {
  // ---------- Cloudflare Worker Proxy → VesselAPI ----------
  // El Worker añade cabeceras CORS para que GitHub Pages pueda llamarlo
  PROXY_URL:        'https://fishtracker-proxy.jsosa86.workers.dev',
  POLL_INTERVAL_MS: 30000,   // refresco cada 30 segundos

  // ---------- AISStream WebSocket (fallback global) ----------
  AISSTREAM_TOKEN: '80e4d5513c36e34d2ed75ae3f0a5a2b0cafc31f3',
  AISSTREAM_WS:    'wss://stream.aisstream.io/v0/stream',

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

  // ---------- Tipos de pesca ----------
  GEAR_TYPES: {
    trawlers:      { label: 'Arrastre',   icon: '🔺', color: '#e74c3c', gfw: 'trawlers' },
    purse_seines:  { label: 'Cerco',      icon: '⭕', color: '#f39c12', gfw: 'purse_seines' },
    longliners:    { label: 'Palangre',   icon: '〰️', color: '#3498db', gfw: 'longliners' },
    set_gillnets:  { label: 'Enmalle',    icon: '🟦', color: '#2ecc71', gfw: 'set_gillnets' },
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
