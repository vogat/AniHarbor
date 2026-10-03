// Direct AniZone adapter. The public page schema was checked 2026-09-19.
// Video descriptors resolve, but the CDN failed TLS locally; keep this manual
// until a real playback probe passes on the installation network.
const SITE = 'https://anizone.to';
const cleanURL = value => String(value || '').replace(/\\+\//g, '/');
const title = item => item.title_list?.['1'] || item.main_title || item.title_list?.['5'] || '';

export const extraDefinitions = [{
  id: 'anizone', disabled: true, name: 'AniZone (candidate)', family: 'anizone-vidcdn', ctor: 'AniZoneProvider',
  languages: ['sub'], url: SITE, manual: true,
  note: 'Search and episodes verified. Video CDN TLS failed locally on 2026-09-19; manual candidate, not a verified working backup. English SRT subtitles may require conversion.'
}];

// Parse the inert JSON inside the site's single-quoted JSON.parse argument.
// No evaluation of page JavaScript. Protect escaped Unicode before decoding
// the outer string so non-Latin titles remain valid inner JSON.
export function parsePageJSON(html, name = 'items') {
  const pattern = name === 'player'
    ? /vidstackPlayer\s*\(\s*JSON\.parse\('((?:[^'\\]|\\.)*)'\)/i
    : /items\s*:\s*JSON\.parse\('((?:[^'\\]|\\.)*)'\)/i;
  const raw = String(html).match(pattern)?.[1];
  if (!raw) throw new Error(`AniZone ${name} payload missing`);
  const decoded = raw.replace(/\\\\u([\da-f]{4})/gi, '\u0001$1\u0001')
    .replace(/\\u([\da-f]{4})/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/\u0001([\da-f]{4})\u0001/gi, '\\u$1');
  try { return JSON.parse(decoded); }
  catch { throw new Error(`AniZone ${name} payload is invalid JSON`); }
}

function unescapeAttribute(value) {
  return value.replace(/&quot;/g, '"').replace(/&#039;|&#39;/g, "'")
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
}

function parseID(value, episode = false) {
  const pattern = episode ? /^anizone:([a-z0-9-]+):(\d+(?:\.\d+)?)$/i : /^anizone:([a-z0-9-]+)$/i;
  const match = String(value).match(pattern);
  if (!match) throw new Error('Invalid AniZone ID');
  return match.slice(1);
}

export class AniZoneProvider {
  constructor(http) {
    if (!http?.get || !http?.post) throw new Error('AniZone requires the guarded HTTP client');
    this.http = http;
  }
  async page(path, options = {}) {
    const response = await this.http.get(SITE + path, {
      ...options, headers: { Accept: 'text/html', Referer: SITE + '/', ...options.headers }
    });
    if (!response.ok) throw new Error(`AniZone HTTP ${response.status}`);
    return { html: await response.text(), response };
  }
  async search(query, { signal } = {}) {
    const { html } = await this.page('/anime?search=' + encodeURIComponent(query), { signal });
    const items = parsePageJSON(html);
    if (!Array.isArray(items)) throw new Error('AniZone search payload must be an array');
    return items.filter(item => /^[a-z0-9-]+$/i.test(item.slug) && title(item)).map(item => ({
      id: 'anizone:' + item.slug, title: title(item), catalogType: 'ANIME',
      thumbnailUrl: cleanURL(item.cover), year: Number(item.start_year) || undefined,
      availableLanguages: ['sub']
    }));
  }
  async fetchContentUnits(id, { signal } = {}) {
    const [slug] = parseID(id);
    const { html, response } = await this.page('/anime/' + slug, { signal });
    let items = parsePageJSON(html);
    if (!Array.isArray(items)) throw new Error('AniZone episodes payload must be an array');
    const cookies = new Map();
    const rememberCookies = headers => {
      for (const cookie of headers.getSetCookie?.() || []) {
        const pair = cookie.match(/^([^=;\s]+)=([^;]*)/);
        if (pair) cookies.set(pair[1], pair[2]);
      }
    };
    rememberCookies(response.headers);
    let more = /hasMore:\s*true/i.test(html);
    let cursor = html.match(/nextCursor:\s*'([^']+)'/i)?.[1];
    let snapshot = [...html.matchAll(/wire:snapshot="([^"]*)"/gi)]
      .map(match => unescapeAttribute(match[1])).find(value => value.includes('pages.anime-detail'));
    const csrf = html.match(/csrf-token"\s+content="([^"]+)"/i)?.[1];
    for (let page = 1; more; page++) {
      if (page >= 30) throw new Error('AniZone episode list exceeds pagination limit');
      if (!cursor || !snapshot || !csrf) throw new Error('AniZone episode continuation metadata missing');
      const result = await this.http.post(SITE + '/livewire/update', {
        components: [{ snapshot, updates: {}, calls: [{ path: '', method: 'loadPage', params: [cursor] }] }]
      }, { signal, headers: {
        'Content-Type': 'application/json', Accept: 'application/json', 'X-Livewire': '',
        'X-CSRF-TOKEN': csrf, 'X-Requested-With': 'XMLHttpRequest', Origin: SITE,
        Referer: SITE + '/anime/' + slug, Cookie: [...cookies].map(([key, value]) => key + '=' + value).join('; ')
      } });
      if (!result.ok) throw new Error(`AniZone episodes HTTP ${result.status}`);
      rememberCookies(result.headers);
      const payload = await result.json();
      const component = payload?.components?.[0];
      const event = component?.effects?.dispatches?.find(event => event.name === 'items-loaded')?.params;
      if (!Array.isArray(event?.items)) throw new Error('AniZone episode continuation payload invalid');
      items = items.concat(event.items);
      snapshot = component.snapshot;
      if (event.hasMore && event.nextCursor === cursor) throw new Error('AniZone repeated pagination cursor');
      cursor = event.nextCursor;
      more = Boolean(event.hasMore);
    }
    const units = new Map();
    for (const item of items) {
      const number = Number(item.slug);
      if (!Number.isFinite(number) || number <= 0 || Number(item.videos_count) <= 0) continue;
      units.set(number, { id: `anizone:${slug}:${number}`, number, title: title(item) || `Episode ${number}`, availableLanguages: ['sub'] });
    }
    if (!units.size) throw new Error('AniZone has no playable episodes for this title');
    return [...units.values()].sort((left, right) => left.number - right.number);
  }
  async resolveStream(id, language, { signal } = {}) {
    if (language !== 'sub') throw new Error('AniZone only supports subtitled episodes');
    const [slug, episode] = parseID(id, true);
    const { html } = await this.page(`/anime/${slug}/${episode}`, { signal });
    const player = parsePageJSON(html, 'player');
    const sourceUrl = cleanURL(player.src);
    if (!/^https:\/\/.+\.m3u8(?:\?|$)/i.test(sourceUrl)) throw new Error('AniZone did not return an HLS stream');
    return { type: 'video', streams: [{
      sourceUrl, isHLS: true, quality: 'auto', language: 'sub', headers: { Referer: SITE + '/' },
      subtitles: (Array.isArray(player.subtitles) ? player.subtitles : []).filter(track => track.file).map(track => ({
        url: cleanURL(track.file), label: track.title || track.language || 'Subtitles',
        language: track.language || 'und', format: track.format || 'vtt'
      }))
    }] };
  }
}
