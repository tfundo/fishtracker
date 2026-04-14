/**
 * FishTracker — Cloudflare Worker Proxy
 * Reenvía peticiones a VesselAPI añadiendo cabeceras CORS
 * para que GitHub Pages pueda consumirla sin bloqueos.
 *
 * Deploy: pega este código en el editor de Cloudflare Workers
 */

// ─── Configura aquí tu API key de VesselAPI ──────────────────────────────────
const VESSEL_API_KEY  = '4f8c8bcb8bfc7ffc5f74e129206eb6a4d0e05cb9dc27748ab13a8819ded31fcb';
const VESSEL_API_BASE = 'https://api.vesselapi.com';
// ─────────────────────────────────────────────────────────────────────────────

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

export default {
  async fetch(request) {

    // Responder al preflight CORS
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS });
    }

    // Solo GET
    if (request.method !== 'GET') {
      return new Response('Method Not Allowed', { status: 405, headers: CORS });
    }

    // Construir URL destino: conservar path y query params
    const incoming = new URL(request.url);
    const target   = VESSEL_API_BASE + incoming.pathname + incoming.search;

    try {
      const res = await fetch(target, {
        headers: {
          'Authorization': `Bearer ${VESSEL_API_KEY}`,
          'Accept':        'application/json',
        },
      });

      const body = await res.text();

      return new Response(body, {
        status: res.status,
        headers: {
          ...CORS,
          'Content-Type': 'application/json; charset=utf-8',
          'Cache-Control': 'no-store',
        },
      });

    } catch (err) {
      return new Response(
        JSON.stringify({ error: 'Proxy error', detail: err.message }),
        { status: 502, headers: { ...CORS, 'Content-Type': 'application/json' } }
      );
    }
  },
};
