/**
 * FishTracker — Cloudflare Worker
 * Proxy WebSocket entre el navegador y AISStream.io.
 * El Worker conecta a AISStream desde servidor (sin restricción de Origin),
 * gestiona la suscripción y los keepalive pings, y reenvía los mensajes al browser.
 */

// API key guardada como Cloudflare Secret (nunca en el código fuente)
// Para configurarla: wrangler secret put AISSTREAM_API_KEY
const AISSTREAM_WS_URL = 'wss://stream.aisstream.io/v0/stream';

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS });
    }

    if (url.pathname === '/aisstream') {
      const upgrade = request.headers.get('Upgrade');
      if (upgrade !== 'websocket') {
        return new Response('Se requiere WebSocket', { status: 426, headers: CORS });
      }
      return proxyAISStream(request, url, env);
    }

    if (url.pathname === '/status') {
      return new Response(
        JSON.stringify({ status: 'ok', source: 'AISStream.io via Worker proxy' }),
        { status: 200, headers: { ...CORS, 'Content-Type': 'application/json' } }
      );
    }

    return new Response(
      JSON.stringify({ error: 'Not found' }),
      { status: 404, headers: { ...CORS, 'Content-Type': 'application/json' } }
    );
  },
};

async function proxyAISStream(request, url, env) {
  // Bounding box desde query params
  const s = parseFloat(url.searchParams.get('s') || '-90');
  const w = parseFloat(url.searchParams.get('w') || '-180');
  const n = parseFloat(url.searchParams.get('n') || '90');
  const e = parseFloat(url.searchParams.get('e') || '180');

  // Crear el par WebSocket: client (→ browser) + server (lo manejamos aquí)
  const { 0: browserSocket, 1: workerSocket } = new WebSocketPair();
  workerSocket.accept();

  // Conectar a AISStream desde el Worker (sin restricción de Origin)
  let aisResp;
  try {
    aisResp = await fetch(AISSTREAM_WS_URL, {
      headers: { Upgrade: 'websocket' },
    });
  } catch (err) {
    workerSocket.close(1011, 'No se pudo conectar a AISStream');
    return new Response(null, { status: 101, webSocket: browserSocket });
  }

  const aisSocket = aisResp.webSocket;
  if (!aisSocket) {
    workerSocket.close(1011, 'AISStream no devolvió WebSocket');
    return new Response(null, { status: 101, webSocket: browserSocket });
  }

  aisSocket.accept();

  // Suscribir con la API key (desde Cloudflare Secret) y el bounding box
  aisSocket.send(JSON.stringify({
    APIKey: env.AISSTREAM_API_KEY,
    BoundingBoxes: [[[s, w], [n, e]]],
    FilterMessageTypes: [
      'PositionReport',
      'StandardClassBPositionReport',
      'ShipStaticData',
      'StaticDataReport',
    ],
  }));

  console.log(`[Worker] AISStream conectado, zona: ${s},${w} → ${n},${e}`);

  // AISStream → Browser
  aisSocket.addEventListener('message', ({ data }) => {
    if (workerSocket.readyState === 1) workerSocket.send(data);
  });
  aisSocket.addEventListener('close', ({ code, reason }) => {
    console.warn('[Worker] AISStream cerró:', code, reason);
    workerSocket.close(code || 1000);
  });
  aisSocket.addEventListener('error', () => {
    workerSocket.close(1011, 'Error AISStream');
  });

  // Browser → Worker (mensajes de keepalive, los ignoramos)
  workerSocket.addEventListener('message', () => { /* keepalive del browser, ignorar */ });
  workerSocket.addEventListener('close', () => {
    aisSocket.close();
  });

  // Keepalive al AISStream cada 20s (el Worker sí puede hacer pings reales)
  const pingInterval = setInterval(() => {
    try {
      if (aisSocket.readyState === 1) aisSocket.send('');
    } catch (_) {}
  }, 20000);

  workerSocket.addEventListener('close', () => clearInterval(pingInterval));

  return new Response(null, { status: 101, webSocket: browserSocket });
}
