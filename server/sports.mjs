import { GuardedTransport } from './relay.mjs';
import { ApiError } from './catalog.mjs';
import { SportsStreams } from './sports-streams.mjs';
export const leagues = [
  { id: 'nfl', name: 'NFL', path: 'football/nfl' },
  { id: 'nba', name: 'NBA', path: 'basketball/nba' },
  { id: 'wnba', name: 'WNBA', path: 'basketball/wnba' },
  { id: 'mlb', name: 'MLB', path: 'baseball/mlb' },
  { id: 'nhl', name: 'NHL', path: 'hockey/nhl' },
  { id: 'mls', name: 'MLS', path: 'soccer/usa.1' }
];
const text = x => String(x || '').slice(0, 300);
export function normalizeEvents(data, league) {
  const seen = new Set(), results = [];
  for (const event of data.events) for (const c of event.competitions || []) {
    const id = league.id + ':' + text(c.id || event.id);
    if (seen.has(id) || !/^\w+:\d+$/.test(id)) continue;
    seen.add(id);
    const status = c.status || event.status || {}, type = status.type || {};
    const teams = (c.competitors || []).map(t => ({ name: text(t.team?.displayName || t.athlete?.displayName), shortName: text(t.team?.abbreviation), score: text(t.score), homeAway: text(t.homeAway) })).sort((a,b) => (a.homeAway === 'away' ? -1 : 1) - (b.homeAway === 'away' ? -1 : 1));
    const broadcasts = [...new Set([...(c.broadcasts || []).flatMap(b => b.names || []), ...(c.geoBroadcasts || []).map(b => b.media?.shortName).filter(Boolean)].map(text))];
    results.push({ id, title: text(event.name) || teams.map(t => t.name).join(' at '), league: league.id, leagueName: league.name,
      date: text(c.date || event.date), status: ['pre','in','post'].includes(type.state) ? type.state : 'pre',
      statusText: text(type.shortDetail || type.description), statusName: text(type.name), teams, broadcasts, venue: text(c.venue?.fullName),
      // A schedule or a broadcaster name is not evidence of an available video stream.
      playable: false, availability: 'Select to check live sources', source: 'ESPN scoreboard' });
  }
  return results;
}
export class Sports {
  constructor({ transport = new GuardedTransport(), now = () => Date.now(), streams = new SportsStreams() } = {}) { this.transport = transport; this.now = now; this.streams = streams; this.cache = new Map(); this.pending = new Map(); }
  async game({ id, date = 'schedule' }) {
    if (!/^(nfl|nba|wnba|mlb|nhl|mls):\d{1,12}$/.test(id || '')) throw new ApiError('Invalid game.',400);
    const data = await this.browse({ league: id.split(':')[0], date });
    const game = data.rows.flatMap(r => r.games).find(g => g.id === id);
    if (!game) throw new ApiError('This game is no longer in the selected schedule. Refresh Sports.',404);
    return game;
  }
  async sources(args) { const data = await this.streams.choices(await this.game(args)); return { ...data, sources: data.sources.map(({id,name,host}) => ({id,name,host})) }; }
  async resolve(args) { return this.streams.resolve(await this.game(args),args); }
  async league(league, date) {
    const key = league.id + ':' + date, cached = this.cache.get(key);
    if (cached && this.now() - cached.at < 60000) return { games: cached.games, stale: false };
    if (this.pending.has(key)) return this.pending.get(key);
    const request = (async () => {
      try {
        const url = 'https://site.api.espn.com/apis/site/v2/sports/' + league.path + '/scoreboard' + (date === 'schedule' ? '' : '?dates=' + date);
        const response = await this.transport.fetch(url, { headers: { 'User-Agent': 'AniHarbor/1.2.0', Accept: 'application/json' }, signal: AbortSignal.timeout(12000) });
        if (!response.ok) throw new Error('Schedule unavailable');
        const data = await response.json(); if (!Array.isArray(data.events)) throw new Error('Invalid schedule');
        const games = normalizeEvents(data, league);
        if (this.cache.size >= 100) this.cache.delete(this.cache.keys().next().value);
        this.cache.set(key, { at: this.now(), games }); return { games, stale: false };
      } catch {
        if (cached && this.now() - cached.at < 21600000) return { games: cached.games, stale: true };
        throw new ApiError(league.name + ' schedule is temporarily unavailable.', 503);
      }
    })().finally(() => this.pending.delete(key));
    this.pending.set(key, request); return request;
  }
  async browse({ league = 'all', date = 'schedule' } = {}) {
    const selected = league === 'all' ? leagues : leagues.filter(l => l.id === league);
    const parsed = /^\d{8}$/.test(date) && new Date(date.slice(0,4) + '-' + date.slice(4,6) + '-' + date.slice(6,8) + 'T12:00Z');
    if (!selected.length || (date !== 'schedule' && (!parsed || !Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0,10).replace(/-/g,'') !== date))) throw new ApiError('Invalid league or schedule date.', 400);
    const rows = await Promise.all(selected.map(async l => { try { return { ...l, ...await this.league(l, date) }; } catch(e) { return { ...l, games: [], error: e.message }; } }));
    return { leagues: leagues.map(({id,name}) => ({id,name})), date, updated: new Date(this.now()).toISOString(), rows: rows.map(({path,...row}) => row), description: 'Game schedules and broadcast listings. Start times use your device time zone; daily schedules follow the US Eastern sports calendar. Listed broadcasters may require a separate subscription.' };
  }
}
