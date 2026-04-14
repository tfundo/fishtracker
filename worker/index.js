/**
 * FishTracker — Cloudflare Worker
 * Reservado para futuros endpoints (ej. Global Fishing Watch Events API).
 * Los datos AIS van ahora directo desde el frontend via WebSocket a AISStream.io.
 */

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export default {
  async fetch(request) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS });
    }

    const url = new URL(request.url);

    if (url.pathname === '/status') {
      return new Response(
        JSON.stringify({ status: 'ok', note: 'AIS data via AISStream.io WebSocket (frontend direct)' }),
        { status: 200, headers: { ...CORS, 'Content-Type': 'application/json' } }
      );
    }

    return new Response(
      JSON.stringify({ error: 'Not found' }),
      { status: 404, headers: { ...CORS, 'Content-Type': 'application/json' } }
    );
  },
};
