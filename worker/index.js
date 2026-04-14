/**
 * FishTracker — Cloudflare Worker Proxy
 * Reenvía peticiones a VesselAPI añadiendo cabeceras CORS.
 */

const VESSEL_API_KEY  = '4f8c8bcb8bfc7ffc5f74e129206eb6a4d0e05cb9dc27748ab13a8819ded31fcb';
const VESSEL_API_BASE = 'https://api.vesselapi.com';

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, API-Key',
};

export default {
  async fetch(request) {

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS });
    }

    const incoming = new URL(request.url);
    const target   = VESSEL_API_BASE + incoming.pathname + incoming.search;

    // Log para depuración (visible en Cloudflare → Workers → Logs)
    console.log('[proxy] →', target);

    let res;
    try {
      res = await fetch(target, {
        headers: {
          // VesselAPI acepta la key de varias formas — probamos la más común
          'Authorization': `Bearer ${VESSEL_API_KEY}`,
          'API-Key':       VESSEL_API_KEY,
          'X-API-Key':     VESSEL_API_KEY,
          'Accept':        'application/json',
        },
      });
    } catch (err) {
      return new Response(
        JSON.stringify({ proxy_error: err.message, target }),
        { status: 502, headers: { ...CORS, 'Content-Type': 'application/json' } }
      );
    }

    const body = await res.text();
    console.log('[proxy] ←', res.status, body.slice(0, 200));

    return new Response(body, {
      status: res.status,
      headers: {
        ...CORS,
        'Content-Type': res.headers.get('Content-Type') || 'application/json',
        'X-Proxy-Status': String(res.status),
      },
    });
  },
};
