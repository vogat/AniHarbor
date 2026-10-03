import { createDecipheriv } from 'node:crypto';
import { AnikotoProvider as SDKAnikoto, MegaPlayProvider as SDKMegaPlay } from 'anime-sdk';
import { ApiError } from './catalog.mjs';
const BASE = 'https://megaplay.buzz';
// Public player URL serialization (newclient v4.20), not media encryption.
export function decodeMegaValue(value) {
  if (typeof value !== 'string' || !/^[\w-]{16,8192}$/.test(value)) throw new Error('Invalid MegaPlay configuration.');
  const key = Buffer.alloc(32); Buffer.from('i?LMTAx0Q6,:}50U').copy(key);
  const decoder = createDecipheriv('aes-256-cbc', key, Buffer.from("W0;27ToaUpl_P%'c"));
  return Buffer.concat([decoder.update(Buffer.from(value, 'base64url')), decoder.final()]).toString('utf8');
}
export function megaSegmentURL(url) {
  const match = new URL(url).pathname.match(/^\/segment\/([\w-]+)$/);
  if (!match) return url;
  const decoded = decodeMegaValue(match[1]);
  const result = new URL(decoded);
  if (result.protocol !== 'https:' || result.username || result.password) throw new Error('Invalid MegaPlay segment.');
  return result.href;
}
export async function resolveMega(http, embed, language, options = {}) {
  const u = new URL(embed);
  if (u.origin !== BASE || !/^\/stream\/(s-2|ani|mal)\/[\d/]+\/(sub|dub)$/.test(u.pathname) || !u.pathname.endsWith('/' + language)) throw new Error('Invalid MegaPlay episode.');
  const page = await http.get(embed, { signal: options.signal, headers: { Referer: 'https://hianime.at/' } });
  const html = await page.text();
  const id = html.match(/\bdata-id=["'](\d+)["']/)?.[1] || html.match(/File\s+(\d+)\s+-/)?.[1];
  // A missing catalog mapping is episode-specific, not a provider outage.
  if (page.status === 404 || (page.ok && /<title>\s*Error - MegaPlay\s*<\/title>/i.test(html))) throw new ApiError('No file is available for this episode/audio.', 404, { code: 'EPISODE_UNAVAILABLE' });
  if (!page.ok || !id) throw new Error('MegaPlay player configuration is unavailable.');
  const response = await http.get(BASE + '/stream/getSources?id=' + id, { signal: options.signal, headers: { Referer: embed, Origin: BASE, 'X-Requested-With': 'XMLHttpRequest' } });
  if (!response.ok) throw new Error('MegaPlay source request failed.');
  const data = await response.json();
  const sourceUrl = data.sources?.file || (data.enc && JSON.parse(decodeMegaValue(data.enc)).file);
  if (typeof sourceUrl !== 'string' || !/^https:\/\/.+\.m3u8(?:[?#]|$)/.test(sourceUrl)) throw new Error('MegaPlay returned no HLS stream.');
  return { type: 'video', streams: [{ sourceUrl, isHLS: true, quality: 'auto', language, headers: { Referer: BASE + '/' }, subtitles: (Array.isArray(data.tracks) ? data.tracks : []).filter(t => t.kind === 'captions' && /^https:\/\//.test(t.file)).map(t => ({ url: t.file, label: t.label || 'Subtitles', language: /english/i.test(t.label) ? 'en' : 'und', format: 'vtt' })) }] };
}
export class AnikotoProvider extends SDKAnikoto {
  resolveStreamRaw(id, language = 'sub', options = {}) {
    if (!/^\d+$/.test(id)) throw new Error('Invalid episode.');
    return resolveMega(this.http, BASE + '/stream/s-2/' + id + '/' + language, language, options);
  }
}
export class MegaPlayProvider extends SDKMegaPlay {
  resolveStreamRaw(id, language = 'sub', options = {}) {
    if (!/^\d+:\d+$/.test(id)) throw new Error('Invalid episode.');
    return resolveMega(this.http, BASE + '/stream/ani/' + id.replace(':', '/') + '/' + language, language, options);
  }
}
