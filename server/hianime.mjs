import { resolveMega } from './megaplay.mjs';
// Public HiAnime theme API. Current delivery is shared with MegaPlay;
// legacy Zoko configuration remains supported when explicitly offered.
const BASE = 'https://hianime.at';
const EMBED = 'https://zokoanime.video';

function entity(text = '') {
  const named = { amp: '&', quot: '"', apos: "'", lt: '<', gt: '>', nbsp: ' ' };
  return text.replace(/&(#x[0-9a-f]+|#\d+|amp|quot|apos|lt|gt|nbsp);/gi, (all, value) => {
    if (value[0] !== '#') return named[value.toLowerCase()] || all;
    const point = value[1].toLowerCase() === 'x' ? parseInt(value.slice(2), 16) : Number(value.slice(1));
    return point > 0 && point <= 0x10ffff ? String.fromCodePoint(point) : '';
  });
}
function attributes(tag) {
  const result = {};
  for (const match of tag.matchAll(/([\w-]+)\s*=\s*(["'])(.*?)\2/gs)) result[match[1].toLowerCase()] = entity(match[3]);
  return result;
}
function safeUrl(raw, base = BASE) {
  if (typeof raw !== 'string' || !raw.trim()) return '';
  try { const u = new URL(raw, base); return u.protocol === 'https:' && !u.username && !u.password && !u.port ? u.href : ''; } catch { return ''; }
}
function seriesSlug(id) {
  const slug = String(id).replace(/^hianime:/, '');
  if (!/^[a-z0-9-]+-\d+$/.test(slug)) throw new Error('Invalid HiAnime series ID.');
  return slug;
}

export function decodePlayerConfig(html) {
  const encoded = html.match(/window\.__P\s*=\s*["']([A-Za-z0-9+/=]+)["']/)?.[1];
  if (!encoded || encoded.length > 2 * 1024 * 1024) throw new Error('ZokoAnime player configuration is unavailable.');
  // The public embed serializes its configuration as base64/XOR; do not run
  // upstream JavaScript, and do not interpret code from the response.
  const bytes = Buffer.from(encoded, 'base64'), key = Buffer.from('otaku-embed-v1');
  for (let i = 0; i < bytes.length; i++) bytes[i] ^= key[i % key.length];
  const config = JSON.parse(bytes.toString('utf8'));
  if (!config || typeof config !== 'object') throw new Error('Invalid ZokoAnime configuration.');
  return config;
}

export class HianimeProvider {
  id = 'hianime';
  constructor(http) { this.http = http; }
  async get(url, options = {}) {
    const response = await this.http.get(url, { signal: options.signal, headers: { Referer: BASE + '/', 'User-Agent': 'Mozilla/5.0' } });
    if (response.status !== 200) throw new Error('HiAnime source is unavailable.');
    return response;
  }
  async search(query, options = {}) {
    const html = await (await this.get(BASE + '/search?keyword=' + encodeURIComponent(query), options)).text();
    // Exclude the unrelated ranking sidebar from search results.
    const body = html.split(/id=["']main-sidebar["']/)[0], seen = new Set(), out = [];
    for (const card of body.split(/class=["']flw-item(?:\s[^"']*)?["']/).slice(1)) {
      const heading = card.match(/<h3\b[^>]*class=["']film-name["'][^>]*>([\s\S]*?)<\/h3>/)?.[1];
      const tag = heading?.match(/<a\b[^>]*>/)?.[0];
      if (!tag) continue;
      const a = attributes(tag), href = safeUrl(a.href);
      if (!href || new URL(href).origin !== BASE) continue;
      const slug = new URL(href).pathname.slice(1);
      if (!/^[a-z0-9-]+-\d+$/.test(slug) || seen.has(slug) || !a.title) continue;
      seen.add(slug);
      const image = attributes(card.match(/<img\b[^>]*>/)?.[0] || '');
      const typeLabel = card.match(/<span\b[^>]*class=["']fdi-item["'][^>]*>\s*(TV|MOVIE|ONA|OVA|SPECIAL|MUSIC)\s*<\/span>/i)?.[1];
      out.push({ id: 'hianime:' + slug, title: a.title, thumbnailUrl: safeUrl(image['data-src'] || image.src), catalogType: 'ANIME', providerId: this.id, availableLanguages: ['sub', 'dub'], ...(typeLabel ? { mediaType: typeLabel.toUpperCase() } : {}), ...(a['data-jname'] ? { aliases: [a['data-jname']] } : {}) });
    }
    return out;
  }
  async fetchContentUnits(mediaId, options = {}) {
    const slug = seriesSlug(mediaId), numericId = slug.split('-').pop();
    const json = await (await this.get(BASE + '/api/theme/episode/list/' + numericId, options)).json();
    if (json.status !== true || typeof json.html !== 'string') throw new Error('HiAnime episode list is unavailable.');
    const episodes = [], seen = new Set();
    for (const match of json.html.matchAll(/<a\b[^>]*>/g)) {
      const a = attributes(match[0]);
      if (!(a.class || '').split(/\s+/).includes('ep-item') || !/^\d+$/.test(a['data-id'] || '') || !/^\d+(?:\.\d+)?$/.test(a['data-number'] || '')) continue;
      const href = safeUrl(a.href);
      if (!href || new URL(href).origin !== BASE || new URL(href).pathname !== '/watch/' + slug || new URL(href).searchParams.get('ep') !== a['data-id'] || seen.has(a['data-id'])) continue;
      seen.add(a['data-id']);
      episodes.push({ id: 'hianime:' + slug + '/' + a['data-id'], number: Number(a['data-number']), title: a.title || 'Episode ' + a['data-number'], availableLanguages: ['sub', 'dub'] });
    }
    return episodes.sort((a, b) => a.number - b.number);
  }
  async resolveStream(unitId, language = 'sub', options = {}) {
    if (!['sub', 'dub'].includes(language)) throw new Error('Unsupported HiAnime audio language.');
    const [slug, episode, extra] = String(unitId).replace(/^hianime:/, '').split('/');
    seriesSlug(slug);
    if (!/^\d+$/.test(episode || '') || extra) throw new Error('Invalid HiAnime episode ID.');
    const json = await (await this.get(BASE + '/api/theme/episode/servers?episodeId=' + episode, options)).json();
    if (json.status !== true || typeof json.html !== 'string') throw new Error('HiAnime server list is unavailable.');
    let embed;
    for (const match of json.html.matchAll(/<div\b[^>]*>/g)) {
      const a = attributes(match[0]);
      if (a['data-type'] !== language) continue;
      const url = safeUrl(Buffer.from(a['data-hash'] || '', 'base64').toString('utf8'));
      if (url && new URL(url).origin === 'https://megaplay.buzz' && /^\/stream\/s-2\/\d+\/(sub|dub)$/.test(new URL(url).pathname) && new URL(url).pathname.endsWith('/' + language)) return resolveMega(this.http, url, language, options);
      if (url && new URL(url).origin === EMBED && /^\/stream\/mal\/\d+\/\d+(?:\.\d+)?\/(sub|dub)$/.test(new URL(url).pathname) && new URL(url).pathname.endsWith('/' + language)) { embed = url; break; }
    }
    if (!embed) throw new Error('ZokoAnime has no source for the requested audio.');
    const config = decodePlayerConfig(await (await this.get(embed, options)).text());
    const sourceUrl = safeUrl(config.src, EMBED);
    if (!sourceUrl || !/\.m3u8(?:[?#]|$)/i.test(sourceUrl)) throw new Error('ZokoAnime returned no HLS stream.');
    const subtitles = (Array.isArray(config.subtitles) ? config.subtitles : []).map(track => ({ url: safeUrl(track.src, EMBED), language: track.lang || 'und', label: track.label || track.lang || 'Subtitles', format: /\.srt(?:[?#]|$)/i.test(track.src || '') ? 'srt' : 'vtt' })).filter(track => track.url);
    return { type: 'video', streams: [{ sourceUrl, isHLS: true, quality: 'auto', language, headers: { Referer: EMBED + '/' }, subtitles }] };
  }
}
