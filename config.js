// ============================================================
//  FishTracker — Configuración
//  Obtén tu token gratuito en: https://globalfishingwatch.org/our-apis/
// ============================================================

const CONFIG = {
  // ---------- VesselAPI (REST) ----------
  // https://vesselapi.com — documentación en vesselapi.com/docs
  VESSELAPI_TOKEN: '4f8c8bcb8bfc7ffc5f74e129206eb6a4d0e05cb9dc27748ab13a8819ded31fcb',
  VESSELAPI_BASE:  'https://api.vesselapi.com/v1',

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

  // ---------- Periodos (ventana temporal de datos a consultar) ----------
  PERIODS: {
    today:   { label: 'Hoy',     hours: 2   },
    week:    { label: '7 días',  hours: 48  },
    month:   { label: '30 días', hours: 336 },
    year:    { label: '1 año',   hours: 720 },
  },

  // ---------- Zonas pesqueras principales (para vista global) ----------
  FISHING_ZONES: [
    { latBottom: 44, latTop: 48, lonLeft: -12, lonRight:  -8 },  // Atlántico NE / Galicia
    { latBottom: 63, latTop: 67, lonLeft:  -4, lonRight:   0 },  // Mar de Noruega
    { latBottom: 33, latTop: 37, lonLeft: 138, lonRight: 142 },  // NW Pacífico / Japón
    { latBottom: -7, latTop: -3, lonLeft: -37, lonRight: -33 },  // Brasil
    { latBottom: 13, latTop: 17, lonLeft: -20, lonRight: -16 },  // África Occidental
    { latBottom:-42, latTop:-38, lonLeft: -62, lonRight: -58 },  // Patagonia
    { latBottom: 53, latTop: 57, lonLeft: 158, lonRight: 162 },  // Mar de Bering
    { latBottom:  3, latTop:  7, lonLeft:  58, lonRight:  62 },  // Océano Índico
    { latBottom: 25, latTop: 29, lonLeft: -83, lonRight: -79 },  // Golfo de México
  ],

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
