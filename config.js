// ============================================================
//  FishTracker — Configuración
//  Obtén tu token gratuito en: https://globalfishingwatch.org/our-apis/
// ============================================================

const CONFIG = {
  // ---------- Global Fishing Watch API ----------
  GFW_API_BASE: 'https://gateway.api.globalfishingwatch.org',
  GFW_API_VERSION: 'v3',
  // Reemplaza con tu token de GFW (registro gratuito en globalfishingwatch.org)
  GFW_TOKEN: '80e4d5513c36e34d2ed75ae3f0a5a2b0cafc31f3',

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

  // ---------- Periodos ----------
  PERIODS: {
    today:   { label: 'Hoy',     days: 1   },
    week:    { label: '7 días',  days: 7   },
    month:   { label: '30 días', days: 30  },
    year:    { label: '1 año',   days: 365 },
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
