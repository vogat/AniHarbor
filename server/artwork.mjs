import { createHmac, timingSafeEqual } from 'node:crypto';
import { GuardedTransport } from './relay.mjs';
import { ApiError, titleKey } from './catalog.mjs';

export function imageType(bytes) {
  if (bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) return 'image/png';
  if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return 'image/jpeg';
  if (/^GIF8[79]a$/.test(bytes.subarray(0,6).toString())) return 'image/gif';
  if (bytes.subarray(0,4).toString() === 'RIFF' && bytes.subarray(8,12).toString() === 'WEBP') return 'image/webp';
  throw new ApiError('The poster source did not return an image.',502);
}
// Signed image-only URLs survive restarts. The persistent pairing secret signs them;
// callers cannot turn the route into an arbitrary URL proxy, and DNS remains guarded.
export class Artwork {
  constructor({ secret, transport = new GuardedTransport(), now = () => Date.now(), maxBytes = 32 * 1024 * 1024 } = {}) {
    if (!secret) throw new Error('Artwork requires a signing secret.');
    this.secret = secret; this.transport = transport; this.now = now; this.maxBytes = maxBytes; this.bytes = 0; this.cache = new Map(); this.pending = new Map();
  }
  sign(payload) { return createHmac('sha256',this.secret).update('artwork-v1:' + payload).digest('base64url'); }
  grant(url) {
    const parsed = new URL(url);
    if (!/^https?:$/.test(parsed.protocol) || parsed.username || parsed.password || url.length > 2200) throw new ApiError('Invalid poster address.',400);
    const payload = Buffer.from(url).toString('base64url');
    return '/artwork/' + payload + '.' + this.sign(payload);
  }
  decode(token) {
    const match = /^([A-Za-z0-9_-]{1,3000})\.([A-Za-z0-9_-]{43})$/.exec(token);
    if (!match || !timingSafeEqual(Buffer.from(match[2]),Buffer.from(this.sign(match[1])))) throw new ApiError('Invalid poster link.',403);
    return Buffer.from(match[1],'base64url').toString('utf8');
  }
  async load(token) {
    const url = this.decode(token), cached = this.cache.get(url);
    if (cached && this.now() - cached.at < 6 * 3600000) { this.cache.delete(url); this.cache.set(url,cached); return cached; }
    if (this.pending.has(url)) return this.pending.get(url);
    const task = (async () => {
      try {
        const r = await this.transport.fetch(url,{headers:{'User-Agent':'Mozilla/5.0',Accept:'image/jpeg,image/png,image/webp,image/gif'},signal:AbortSignal.timeout(12000)});
        if (!r.ok) throw new ApiError('Poster source is temporarily unavailable.',502);
        const bytes = Buffer.from(await r.arrayBuffer());
        if (!bytes.length || bytes.length > 3 * 1024 * 1024) throw new ApiError('Poster is too large.',502);
        const entry = { bytes, type: imageType(bytes), at:this.now() };
        if (this.cache.has(url)) { this.bytes -= this.cache.get(url).bytes.length; this.cache.delete(url); }
        while (this.bytes + bytes.length > this.maxBytes && this.cache.size) { const first = this.cache.keys().next().value; this.bytes -= this.cache.get(first).bytes.length; this.cache.delete(first); }
        if (bytes.length <= this.maxBytes) { this.cache.set(url,entry); this.bytes += bytes.length; }
        return entry;
      } catch(e) { if (cached) return cached; throw e; }
    })().finally(()=>this.pending.delete(url));
    this.pending.set(url,task); return task;
  }
  async serve(res, token) {
    const entry = await this.load(token);
    res.writeHead(200,{'Content-Type':entry.type,'Content-Length':entry.bytes.length,'Cache-Control':'private, max-age=86400','Access-Control-Allow-Origin':'*','X-Content-Type-Options':'nosniff'}); res.end(entry.bytes);
  }
}

// Repair pre-1.3.1 saved cards by catalog identity, without resolving episodes or changing history.
export async function findArtwork(catalog, discovery, library, args) {
  const title = String(args.title || '').trim();
  if (!title || title.length > 200) throw new ApiError('Select a title for its artwork.',400);
  if (String(args.id || '').startsWith('archive:')) {
    const result = await library.item(args.id);
    return { image: result.item?.image || result.image || '' };
  }
  let data;
  try { data = await catalog.search(title,args.provider || 'auto'); }
  catch { data = {results:[]}; }
  if (args.provider && !data.results.length) { try { data = await catalog.search(title,'auto'); } catch {} }
  const rows = data.results || [];
  let found = args.provider && args.id && rows.find(r => r.provider === args.provider && r.id === args.id && r.image);
  if (!found) {
    const matches = rows.filter(r => r.image && [r.title,...(r.aliases || [])].some(t=>titleKey(t) === titleKey(title)) && (!args.year || !r.year || String(r.year) === String(args.year)));
    found = matches[0];
  }
  if (found) return {image:found.image};
  const metadata = await discovery.searchMetadata(title);
  const match = metadata.find(m => [m.title,m.title_english,...(m.title_synonyms || [])].some(t=>titleKey(t) === titleKey(title)) && (!args.year || !m.year || String(m.year) === String(args.year)));
  const image = match?.images?.jpg?.large_image_url || match?.images?.jpg?.image_url;
  if (!image) throw new ApiError('Artwork is temporarily unavailable for this title.',503);
  return {image};
}
