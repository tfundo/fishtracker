# 🐟 FishTracker

Aplicación web de seguimiento en tiempo real de barcos pesqueros, construida con HTML, CSS y JavaScript puro. Lista para publicar en **GitHub Pages** sin ningún paso de build.

![FishTracker](https://img.shields.io/badge/FishTracker-v1.0-1a8cff?style=flat-square)
![License](https://img.shields.io/badge/license-MIT-green?style=flat-square)
![GitHub Pages](https://img.shields.io/badge/GitHub%20Pages-Ready-success?style=flat-square)

---

## Características

| Característica | Descripción |
|---|---|
| 🗺️ Mapa interactivo | Leaflet.js con tiles CartoDB Dark Matter |
| 🌙 Modo oscuro | Por defecto; toggle a modo claro |
| 🔥 Mapa de calor | Zonas de pesca con Leaflet.heat |
| 🔍 Buscador | Barcos por nombre, MMSI, bandera; puertos |
| 🎣 Filtros de arte | Arrastre, cerco, palangre, enmalle |
| 📅 Filtros de periodo | Hoy, 7 días, 30 días, 1 año |
| 🌐 API GFW | Integración con Global Fishing Watch (gratuita) |
| 📱 Responsive | Adaptado a móvil y escritorio |
| ⚓ Puertos | 10 puertos pesqueros principales marcados |

---

## Estructura del proyecto

```
fishtracker/
├── index.html   — Interfaz principal
├── style.css    — Estilos (variables CSS, dark/light mode)
├── app.js       — Lógica de la aplicación
├── config.js    — Configuración y constantes
└── README.md    — Este archivo
```

---

## Configuración

### 1. Obtener API key de Global Fishing Watch (gratis)

1. Regístrate en [globalfishingwatch.org](https://globalfishingwatch.org/our-apis/)
2. Solicita acceso a la API (aprobación en 1-2 días hábiles)
3. Copia tu token de acceso

### 2. Configurar el token

Edita `config.js` y reemplaza el placeholder:

```js
GFW_TOKEN: 'TU_TOKEN_AQUI',
```

### 3. Sin API key (modo demo)

Si no configuras el token, la aplicación funciona en **modo demo** con 120 barcos simulados distribuidos en zonas de pesca reales. Perfecta para ver y probar todas las funcionalidades.

---

## Publicar en GitHub Pages

```bash
# 1. Crear repositorio en GitHub (ej: tu-usuario/fishtracker)

# 2. Añadir remote y subir
git remote add origin https://github.com/TU-USUARIO/fishtracker.git
git branch -M main
git push -u origin main

# 3. En GitHub → Settings → Pages → Source: main / (root)
# Tu app estará en: https://TU-USUARIO.github.io/fishtracker/
```

---

## Uso local

No requiere servidor — abre directamente en el navegador:

```bash
# Opción A: abrir directamente
open index.html          # macOS
start index.html         # Windows
xdg-open index.html      # Linux

# Opción B: servidor local (recomendado para la API)
npx serve .
# o
python -m http.server 8080
```

> **Nota:** Para llamadas a la API de GFW desde `file://`, algunos navegadores bloquean CORS. Usa un servidor local si tienes API key configurada.

---

## API de Global Fishing Watch

### Endpoints utilizados

| Endpoint | Uso |
|---|---|
| `GET /v3/vessels/search` | Búsqueda y listado de barcos |
| `GET /v3/events` | Eventos de pesca (con token) |
| Tiles 4wings | Capas de intensidad de pesca |

### Tipos de arte de pesca (GFW)

| FishTracker | GFW gear type |
|---|---|
| Arrastre | `trawlers` |
| Cerco | `purse_seines` |
| Palangre | `longliners` |
| Enmalle | `set_gillnets` |

### Documentación oficial
- API Docs: [globalfishingwatch.org/our-apis/documentation](https://globalfishingwatch.org/our-apis/documentation/)
- API Explorer: [gateway.api.globalfishingwatch.org](https://gateway.api.globalfishingwatch.org/swagger)

---

## Dependencias (CDN, sin instalación)

| Librería | Versión | Uso |
|---|---|---|
| [Leaflet.js](https://leafletjs.com/) | 1.9.4 | Mapa interactivo |
| [Leaflet.heat](https://github.com/Leaflet/Leaflet.heat) | 0.2.0 | Mapa de calor |

No hay bundler, no hay `node_modules`, no hay paso de build.

---

## Personalización

### Cambiar zona inicial del mapa
En `config.js`:
```js
MAP_CENTER: [42.24, -8.72],  // Vigo, España
MAP_ZOOM: 6,
```

### Añadir puertos
En `config.js`, array `DEMO_PORTS`:
```js
{ name: 'Tu Puerto', country: 'País', lat: 00.0000, lon: 00.0000 },
```

### Cambiar colores por tipo de arte
En `config.js`, objeto `GEAR_TYPES`:
```js
trawlers: { label: 'Arrastre', icon: '🔺', color: '#e74c3c', gfw: 'trawlers' },
```

---

## Licencia

MIT © 2024 FishTracker
