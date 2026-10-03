import { GuardedTransport, publicRequest } from './relay.mjs';
import { megaSegmentURL } from './megaplay.mjs';
const transport = new GuardedTransport();
export function mediaSignature(bytes) {
  for (let i = 0; i < Math.min(bytes.length - 376, 65536); i++) if (bytes[i] === 71 && bytes[i + 188] === 71 && bytes[i + 376] === 71) return true;
  return ['ftyp', 'styp', 'moof', 'moov'].includes(bytes.subarray(4, 8).toString());
}
// Read only enough to establish media availability; decoding remains the player's job.
export async function checkStream(stream, { signal = AbortSignal.timeout(14000) } = {}) {
  let url = stream.sourceUrl;
  const headers = stream.headers || {};
  for (let level = 0; stream.isHLS && level < 4; level++) {
    const r = await transport.fetch(url, { headers, signal });
    if (!r.ok) throw new Error('Video playlist is unavailable.');
    const text = await r.text();
    if (!text.trimStart().startsWith('#EXTM3U')) throw new Error('Invalid video playlist.');
    const lines = text.split(/\r?\n/).map(x => x.trim());
    const next = lines.find(x => x && !x.startsWith('#'));
    if (!next) throw new Error('Video playlist has no media.');
    url = new URL(next, r.url || url).href;
    if (headers.Referer === 'https://megaplay.buzz/') url = megaSegmentURL(url);
    if (lines.some(x => x.startsWith('#EXTINF:'))) break;
    if (level === 3) throw new Error('Too many nested video playlists.');
  }
  const { response } = await publicRequest(url, { ...headers, Range: 'bytes=0-66559' }, 0, { signal });
  try {
    if (response.statusCode < 200 || response.statusCode >= 300) throw new Error('Video segment is unavailable.');
    let bytes = Buffer.alloc(0);
    for await (const chunk of response) {
      bytes = Buffer.concat([bytes, chunk]);
      if (mediaSignature(bytes)) return true;
      if (bytes.length >= 66560) break;
    }
    throw new Error('Source did not return playable video bytes.');
  } finally { response.destroy(); }
}
