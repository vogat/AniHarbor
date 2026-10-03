import { GuardedTransport } from './relay.mjs';
import { ApiError } from './catalog.mjs';
import { checkStream } from './media-check.mjs';

const ua = { 'User-Agent': 'Mozilla/5.0' };
const decode = value => value.replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&quot;/g, '"');
const words = value => String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const links = html => [...html.matchAll(/\bhref=["']([^"']+)["']/gi)].map(m => decode(m[1]));
const validURL = (value, host, path) => { try { const u = new URL(value); return u.protocol === 'https:' && (typeof host === 'string' ? u.hostname === host : host.test(u.hostname)) && !u.port && !u.username && !u.password && path.test(u.pathname); } catch { return false; } };

// Exact ESPN event IDs identify the page; date and BOTH teams protect against stale/reused listings.
export function eventMatches(html, game) {
  for (const match of html.matchAll(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const event = JSON.parse(match[1]);
      if (event['@type'] !== 'SportsEvent' || Math.abs(Date.parse(event.startDate) - Date.parse(game.date)) > 3 * 3600000 || !Number.isFinite(Date.parse(event.startDate))) continue;
      const names = [event.homeTeam?.name, event.awayTeam?.name].map(words);
      if (names.some(n => n.length < 3) || names[0] === names[1] || game.teams.length !== 2) continue;
      const matches = (team, name) => (' ' + words(team.name) + ' ').includes(' ' + name + ' ');
      if ((matches(game.teams[0], names[0]) && matches(game.teams[1], names[1])) || (matches(game.teams[0], names[1]) && matches(game.teams[1], names[0]))) return true;
    } catch {}
  }
  return false;
}
export function matchoraChannels(html) {
  const results = [], seen = new Set();
  for (const m of html.matchAll(/data-embed=["']https:\/\/matchora\.to\/embed\/channel\/(\d{1,12})["'][\s\S]{0,150}?data-name=["']([^"']+)["']/g)) {
    if (!seen.has(m[1])) { seen.add(m[1]); results.push({ id: 'matchora:' + m[1], host: 'matchora', channel: m[1], name: 'Matchora · ' + decode(m[2]).slice(0,80) }); }
  }
  return results.slice(0,6);
}
export class SportsStreams {
  constructor({ transport = new GuardedTransport(), validate = checkStream, now = () => Date.now(), pause = ms => new Promise(r => setTimeout(r,ms)) } = {}) {
    this.transport = transport; this.validate = validate; this.now = now; this.pause = pause; this.cache = new Map(); this.pending = new Map();
  }
  async get(url, referer, json = false, signal = AbortSignal.timeout(12000)) {
    const response = await this.transport.fetch(url, { headers: { ...ua, ...(referer ? { Referer: referer } : {}) }, signal });
    if (!response.ok) throw new Error('Source is temporarily unavailable.');
    return json ? response.json() : response.text();
  }
  async choices(game) {
    if (!/^(nfl|nba|wnba|mlb|nhl|mls):\d{1,12}$/.test(game.id)) throw new ApiError('Invalid game.',400);
    if (game.status === 'post') return { sources: [], message: 'This game has finished. These sources provide live coverage, not replays.' };
    if (Date.parse(game.date) > this.now() + 15 * 60000) return { sources: [], message: 'Check again shortly before the game starts. Live sources usually appear near tip-off or kickoff.' };
    const cached = this.cache.get(game.id);
    if (cached && this.now() - cached.at < 90000) return cached.data;
    if (this.pending.has(game.id)) return this.pending.get(game.id);
    const work = this.discover(game).then(data => { if (this.cache.size >= 150) this.cache.delete(this.cache.keys().next().value); this.cache.set(game.id, { at: this.now(), data }); return data; }).finally(() => this.pending.delete(game.id));
    this.pending.set(game.id, work); return work;
  }
  async discover(game) {
    const page = 'https://watchsports.su/' + game.id.replace(':','/');
    const html = await this.get(page);
    if (!eventMatches(html, game)) throw new ApiError('The source listing could not be matched to this game. Try again later.',503);
    const urls = links(html);
    const matchora = urls.find(u => validURL(u,'en.sports247.ru',/^\/event\/[a-z0-9-]+$/));
    const center = urls.find(u => validURL(u,'hadcrak.cyou',/^\/[a-z0-9-]+\/$/));
    const groups = await Promise.allSettled([
      matchora ? this.get(matchora,page).then(matchoraChannels) : Promise.resolve([]),
      center ? (async () => {
        const detail = await this.get(center,page);
        const iframe = detail.match(/\bsrc=["'](https:\/\/streame\.center\/embed\/ch\d{1,5}\.php)["']/);
        if (!iframe) return [];
        const player = await this.get(iframe[1],center);
        const channel = player.match(/\/embed\/hls\.php\?stream=([a-zA-Z0-9_-]{1,60})/);
        return channel ? [{ id: 'center:' + channel[1], host: 'center', channel: channel[1], name: 'StreamCenter · Live game', referer: iframe[1] }] : [];
      })() : Promise.resolve([])
    ]);
    // Prefer the event-specific feed; channel listings can roll into later programming.
    const sources = groups.flatMap(r => r.status === 'fulfilled' ? r.value : []).sort((a,b) => (a.host === 'center' ? 0 : 1) - (b.host === 'center' ? 0 : 1));
    return { sources, message: sources.length ? 'Choose a source. Video availability is checked when you select Play.' : 'No compatible live source is listed for this game right now. Check again near the start time.', checkedAt: new Date(this.now()).toISOString() };
  }
  async prepare(choice, signal) {
    if (choice.host === 'matchora') {
      for (let attempt = 0; attempt < 5; attempt++) {
        const data = await this.get('https://matchora.to/api/play/' + choice.channel, 'https://matchora.to/embed/channel/' + choice.channel, true, signal);
        if (data.ready && validURL(data.url,'edge.matchora.pro',new RegExp('^/hls/' + choice.channel + '/index\\.m3u8$'))) {
          return { sourceUrl: data.url, headers: { Referer: 'https://matchora.to/' }, isHLS: true, renewAt: this.now() + Math.max(15,Math.min(Number(data.expires_in) || 600,600) - 45) * 1000 };
        }
        if (data.reason !== 'warming' || attempt === 4) throw new Error('This channel is offline or busy.');
        await this.pause(3000); signal?.throwIfAborted();
      }
    }
    if (choice.host === 'center') {
      const page = await this.get('https://streame.center/embed/hls.php?stream=' + choice.channel,choice.referer,false,signal);
      const value = page.match(/\bconst\s+streamUrl\s*=\s*("[^"\n]{1,3000}")\s*;/);
      const url = value && JSON.parse(value[1]);
      if (!validURL(url,/^edgestream[1-9][0-9]?\.pro$/,new RegExp('^/hls/' + choice.channel + '\\.m3u8$'))) throw new Error('The source changed its video format.');
      const expires = Number(new URL(url).searchParams.get('e')) * 1000;
      return { sourceUrl: url, headers: { Referer: 'https://streame.center/' }, isHLS: true, renewAt: Math.min(this.now() + 15 * 60000, Number.isFinite(expires) && expires > this.now() ? expires - 60000 : this.now() + 60000) };
    }
    throw new Error('Unknown sports video host.');
  }
  async resolve(game, { source = 'auto', exclude = '' } = {}) {
    const data = await this.choices(game), excluded = String(exclude).split(',');
    const choices = data.sources.filter(s => !excluded.includes(s.id));
    const selected = source === 'auto' ? choices : choices.filter(s => s.id === source);
    if (!selected.length) throw new ApiError(data.sources.length ? 'No untried sources remain. Go back to the game to retry.' : data.message,503);
    // Interleave hosts: an offline first host should not delay the independent backup behind six copies.
    if (source === 'auto') { const rank = c => c === choices[0] ? 0 : c.host !== choices[0].host ? 1 : 2; selected.sort((a,b) => rank(a) - rank(b)); }
    const attempts = [], signal = AbortSignal.timeout(80000);
    for (const choice of selected) {
      try {
        let current = await this.prepare(choice,signal), pending;
        await this.validate(current,{signal});
        // Only this root manifest renews. Segment grants remain bound to their original URLs.
        const refresh = async () => {
          if (this.now() >= current.renewAt) {
            if (!pending) pending = this.prepare(choice,AbortSignal.timeout(18000)).then(next => { current = next; }).finally(() => { pending = null; });
            await pending;
          }
          return current.sourceUrl;
        };
        return { provider: choice.name, sourceId: choice.id, live: true, attempts, streams: [{ ...current, refresh, quality: 'Live', subtitles: [] }] };
      } catch { attempts.push({ source: choice.id, error: 'Video unavailable' }); if (signal.aborted) break; }
    }
    throw new ApiError('The listed sources are offline or cannot play right now. Try another source or check again shortly.',503,{attempts});
  }
}
