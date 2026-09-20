import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { networkInterfaces } from 'node:os';
import { Catalog, ApiError } from './catalog.mjs';
import { createProviders } from './providers.mjs';
import { Relay } from './relay.mjs';
import { Discovery } from './discovery.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png' };
const files = new Map([['/', 'tv/index.html'], ['/index.html', 'tv/index.html'], ['/app.js', 'tv/app.js'], ['/styles.css', 'tv/styles.css'], ['/vendor/hls.min.js', 'node_modules/hls.js/dist/hls.min.js']]);

export function makeServer({ catalog = new Catalog(createProviders()), token, relay = new Relay(), discovery = new Discovery() }) {
  const limits = new Map();
  const json = (res, status, data) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*', 'X-Content-Type-Options': 'nosniff' }); res.end(JSON.stringify(data)); };
  // Clone API results before adding short-lived image grants: cached catalog
  // objects must retain their original upstream URLs for subsequent clients.
  const posters = (data, base) => {
    if (Array.isArray(data)) return data.map(value => posters(value, base));
    if (!data || typeof data !== 'object') return data;
    return Object.fromEntries(Object.entries(data).map(([key, value]) => [key, key === 'image' && /^https?:\/\//.test(value || '') ? base + relay.grant(value, {}, 'image') : posters(value, base)]));
  };
  return http.createServer(async (req, res) => {
    try {
      if (req.url.length > 5000) throw new ApiError('Request too long.', 414);
      const host = req.headers.host;
      if (!host || !/^[a-z0-9.\-\[\]:]+$/i.test(host)) throw new ApiError('Invalid host.', 400);
      const base = `http://${host}`;
      const url = new URL(req.url, base);
      if (req.method === 'OPTIONS') { res.writeHead(204, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, OPTIONS', 'Access-Control-Allow-Headers': 'x-app-token, content-type', 'Access-Control-Max-Age': '600' }); res.end(); return; }
      if (req.method !== 'GET') throw new ApiError('Only GET requests are supported.', 405);
      if (url.pathname.startsWith('/media/')) { await relay.serve(req, res, url.pathname.slice(7), base); return; }
      if (url.pathname === '/api/health') { json(res, 200, { ok: true, app: 'AniHarbor', version: '0.1.0', pairingRequired: true }); return; }
      if (url.pathname.startsWith('/api/')) {
        const supplied = req.headers['x-app-token'] || '';
        if (typeof supplied !== 'string' || supplied.length !== token.length || !timingSafeEqual(Buffer.from(supplied), Buffer.from(token))) throw new ApiError('Enter the pairing code shown by the server in Settings.', 401);
        const ip = req.socket.remoteAddress;
        const limit = limits.get(ip) || { start: Date.now(), count: 0 };
        if (Date.now() - limit.start > 60000) { limit.start = Date.now(); limit.count = 0; }
        if (++limit.count > 90) throw new ApiError('Too many requests. Wait a minute and retry.', 429);
        limits.set(ip, limit);
        const args = Object.fromEntries(url.searchParams);
        if (url.pathname === '/api/providers') json(res, 200, { providers: catalog.list(), note: 'Reachable means an API request succeeded, not verified episode playback.' });
        else if (url.pathname === '/api/search') {
          json(res, 200, posters(await discovery.search(catalog, args.q, args.provider), base));
        } else if (url.pathname === '/api/discover') {
          json(res, 200, posters(await discovery.feed(args.section, args.page), base));
        } else if (url.pathname === '/api/show') {
          json(res, 200, posters(await discovery.show(catalog, args), base));
        } else if (url.pathname === '/api/episodes') json(res, 200, await catalog.episodes(args.provider, args.id));
        else if (url.pathname === '/api/resolve') {
          const data = await catalog.resolve(args);
          json(res, 200, { provider: data.provider, attempts: data.attempts, sources: data.streams.map(s => ({
            url: base + relay.grant(s.sourceUrl, s.headers, s.isHLS ? 'hls' : 'media'), type: s.isHLS ? 'hls' : 'mp4', quality: s.quality || 'auto',
            subtitles: (s.subtitles || []).filter(t => /^https?:\/\//.test(t.url || '')).map(t => ({ url: base + relay.grant(t.url, s.headers, 'subtitle'), language: t.language, label: t.label, format: t.format }))
          })) });
        } else throw new ApiError('Unknown API route.', 404);
        return;
      }
      let file = files.get(url.pathname);
      if (/^\/assets\/[a-z0-9_-]+\.(svg|png)$/i.test(url.pathname)) file = `tv${url.pathname}`;
      if (!file) throw new ApiError('Not found.', 404);
      const body = await readFile(path.join(root, file));
      res.writeHead(200, { 'Content-Type': mime[path.extname(file)] || 'application/octet-stream', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' }); res.end(body);
    } catch (e) {
      if (!res.headersSent) json(res, e.status || 502, { error: e instanceof ApiError ? e.message : 'The request could not be completed. Check the server and source status.', ...(e.details || {}) });
      else res.destroy();
    }
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const folder = path.join(root, '.data'); await mkdir(folder, { recursive: true, mode: 0o700 });
  const tokenFile = path.join(folder, 'pairing-token');
  let token = process.env.ANIHARBOR_TOKEN;
  if (!token) { try { token = (await readFile(tokenFile, 'utf8')).trim(); } catch { token = randomBytes(6).toString('hex'); await writeFile(tokenFile, token, { mode: 0o600 }); } }
  if (token.length < 12) throw new Error('Pairing token must be at least 12 characters.');
  const port = Number(process.env.PORT || 8787);
  const server = makeServer({ token });
  server.on('error', error => { console.error(error.message); process.exitCode = 1; });
  server.listen(port, process.env.HOST || '0.0.0.0', () => {
    console.log(`\nAniHarbor · http://localhost:${port}\nPairing code: ${token}\n`);
    for (const entries of Object.values(networkInterfaces())) for (const entry of entries) if (entry.family === 'IPv4' && !entry.internal) console.log(`TV server address: http://${entry.address}:${port}`);
    console.log('\nKeep this computer awake while watching. Private home network only; no router port forwarding.');
  });
}
