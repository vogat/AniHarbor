import http from 'node:http';
import https from 'node:https';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { randomBytes } from 'node:crypto';
import { pipeline } from 'node:stream/promises';
import { gunzipSync, inflateSync, brotliDecompressSync } from 'node:zlib';
import { ApiError } from './catalog.mjs';

export function isPublicAddress(address) {
  if (isIP(address) === 4) {
    const [a, b, c] = address.split('.').map(Number);
    return !(a === 0 || a === 10 || a === 127 || a >= 224 || a === 169 && b === 254 || a === 172 && b >= 16 && b <= 31 || a === 192 && (b === 168 || b === 0 || b === 2) || a === 100 && b >= 64 && b <= 127 || a === 198 && (b === 18 || b === 19 || b === 51 && c === 100) || a === 203 && b === 0 && c === 113);
  }
  // Only global unicast IPv6, excluding documentation and mapped IPv4 ranges.
  if (isIP(address) === 6) return /^[23][0-9a-f]{3}:/i.test(address) && !/^2001:(?:db8|0):/i.test(address);
  return false;
}

export async function publicRequest(raw, headers = {}, redirects = 0, options = {}) {
  const url = new URL(raw);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.port && !['80', '443'].includes(url.port)) throw new ApiError('Unsupported media address.', 400);
  const host = url.hostname.replace(/^\[|\]$/g, '');
  const addresses = isIP(host) ? [{ address: host, family: isIP(host) }] : await lookup(host, { all: true });
  if (!addresses.length || addresses.some(r => !isPublicAddress(r.address))) throw new ApiError('Private media addresses are not allowed.', 403);
  const chosen = addresses[0];
  const response = await new Promise((resolve, reject) => {
    const request = (url.protocol === 'https:' ? https : http).request(url, {
      headers,
      method: options.method || 'GET',
      signal: options.signal,
      // Pin the checked DNS result to prevent a second lookup changing its destination.
      lookup: (_host, options, cb) => options.all ? cb(null, [chosen]) : cb(null, chosen.address, chosen.family)
    }, resolve);
    request.setTimeout(20000, () => request.destroy(new Error('Media request timed out.')));
    request.on('error', reject);
    if (options.body) request.write(options.body);
    request.end();
  });
  if ([301, 302, 303, 307, 308].includes(response.statusCode)) {
    response.destroy();
    if (!response.headers.location || redirects >= 5) throw new ApiError('Media redirected too many times.');
    const next = new URL(response.headers.location, url);
    const redirectedHeaders = { ...headers };
    if (next.origin !== url.origin) for (const key of Object.keys(redirectedHeaders)) if (/^(authorization|cookie|proxy-authorization)$/i.test(key)) delete redirectedHeaders[key];
    const nextOptions = response.statusCode === 303 || [301, 302].includes(response.statusCode) && options.method === 'POST' ? { ...options, method: 'GET', body: undefined } : options;
    return publicRequest(next.href, redirectedHeaders, redirects + 1, nextOptions);
  }
  return { response, url: url.href };
}

// SDK extraction can also follow URLs supplied by upstreams. Apply the same
// public-address validation there, with a bounded response and no shell fallback.
export class GuardedTransport {
  async fetch(url, options = {}) {
    const headers = Object.fromEntries(new Headers(options.headers || {}));
    headers['accept-encoding'] = 'identity';
    const body = options.body instanceof URLSearchParams ? options.body.toString() : options.body;
    const { response } = await publicRequest(url, headers, 0, { method: options.method || 'GET', body, signal: options.signal });
    const chunks = []; let size = 0;
    for await (const chunk of response) { size += chunk.length; if (size > 8 * 1024 * 1024) { response.destroy(); throw new ApiError('Source response is too large.'); } chunks.push(chunk); }
    let bytes = Buffer.concat(chunks);
    const encoding = response.headers['content-encoding'];
    const bounded = { maxOutputLength: 8 * 1024 * 1024 };
    if (encoding === 'gzip') bytes = gunzipSync(bytes, bounded);
    else if (encoding === 'deflate') bytes = inflateSync(bytes, bounded);
    else if (encoding === 'br') bytes = brotliDecompressSync(bytes, bounded);
    const resultHeaders = new Headers();
    for (const [key, value] of Object.entries(response.headers)) if (value && !['content-encoding', 'content-length'].includes(key)) {
      if (key === 'set-cookie' && Array.isArray(value)) for (const cookie of value) resultHeaders.append(key, cookie);
      else resultHeaders.set(key, Array.isArray(value) ? value.join(', ') : value);
    }
    return new Response([204, 205, 304].includes(response.statusCode) ? null : bytes, { status: response.statusCode, headers: resultHeaders });
  }
}

export function rewriteManifest(text, base, wrap) {
  return text.split(/\r?\n/).map(line => {
    const s = line.trim();
    if (!s) return line;
    if (s.startsWith('#')) return line.replace(/URI="([^"]+)"/g, (_, uri) => `URI="${wrap(new URL(uri, base).href)}"`);
    return wrap(new URL(s, base).href);
  }).join('\n');
}

export class Relay {
  constructor({ now = () => Date.now(), request = publicRequest } = {}) { this.grants = new Map(); this.now = now; this.request = request; }
  grant(url, headers = {}, kind = 'media') {
    if (!/^https?:\/\//.test(url)) throw new ApiError('Source returned an invalid media link.');
    const token = randomBytes(18).toString('base64url');
    const safeHeaders = { 'User-Agent': 'Mozilla/5.0', 'Accept-Encoding': 'identity' };
    for (const [key, value] of Object.entries(headers)) if (/^(user-agent|referer|origin|accept)$/i.test(key) && typeof value === 'string' && !/[\r\n]/.test(value)) safeHeaders[key] = value;
    if (this.grants.size > 12000) for (const [key, value] of this.grants) if (value.expires < this.now()) this.grants.delete(key);
    if (this.grants.size > 16000) this.grants.delete(this.grants.keys().next().value);
    this.grants.set(token, { url, headers: safeHeaders, kind, expires: this.now() + 3 * 3600000 });
    const suffix = kind === 'hls' ? '.m3u8' : kind === 'subtitle' ? /\.srt(?:\?|$)/i.test(url) ? '.srt' : '.vtt' : '';
    return `/media/${token}${suffix}`;
  }
  async serve(req, res, tokenPath, base) {
    const token = tokenPath.split('.')[0];
    const g = this.grants.get(token);
    if (!g || g.expires < this.now()) throw new ApiError('This media link expired. Reopen the episode.', 410);
    const headers = { ...g.headers };
    if (req.headers.range && /^bytes=\d*-\d*$/.test(req.headers.range)) headers.Range = req.headers.range;
    const { response, url } = await this.request(g.url, headers);
    if (response.statusCode < 200 || response.statusCode >= 300) { response.destroy(); throw new ApiError('The video host is unavailable.', 502); }
    const type = String(response.headers['content-type'] || 'application/octet-stream');
    if (/text\/html|application\/json/i.test(type)) { response.destroy(); throw new ApiError('Source returned a web page instead of media.'); }
    const manifest = g.kind === 'hls' || /mpegurl/i.test(type) || /\.m3u8(?:\?|$)/i.test(url);
    if (manifest) {
      const chunks = []; let bytes = 0;
      for await (const chunk of response) { bytes += chunk.length; if (bytes > 2097152) { response.destroy(); throw new ApiError('Playlist is too large.'); } chunks.push(chunk); }
      const text = Buffer.concat(chunks).toString('utf8');
      if (!text.trimStart().startsWith('#EXTM3U')) throw new ApiError('Invalid HLS playlist.');
      const output = rewriteManifest(text, url, next => base + this.grant(next, g.headers, /\.m3u8(?:\?|$)/i.test(next) ? 'hls' : 'segment'));
      res.writeHead(200, { 'Content-Type': 'application/vnd.apple.mpegurl', 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*' });
      res.end(output); return;
    }
    // Some hosts label raw transport-stream segments as images. Native TV
    // players can reject that MIME type even when the payload is valid MPEG-TS.
    const mediaType = g.kind === 'segment' && /^image\//i.test(type) ? 'video/mp2t' : type;
    const outgoing = { 'Content-Type': mediaType, 'Cache-Control': 'private, max-age=60', 'Access-Control-Allow-Origin': '*', 'X-Content-Type-Options': 'nosniff' };
    for (const key of ['content-length', 'content-range', 'accept-ranges']) if (response.headers[key]) outgoing[key] = response.headers[key];
    res.writeHead(response.statusCode, outgoing);
    res.on('close', () => response.destroy());
    await pipeline(response, res);
  }
}
