import { readFile } from 'node:fs/promises';
import { GuardedTransport } from './relay.mjs';
import { ApiError } from './catalog.mjs';
import { checkStream } from './media-check.mjs';
const seed = JSON.parse(await readFile(new URL('./data/channels.json', import.meta.url), 'utf8'));
const clean = value => String(Array.isArray(value) ? value[0] || '' : value || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 3000);
const values = value => [].concat(value || []).flatMap(v => String(v).split(';')).map(clean).filter(Boolean).slice(0, 20);
const profile = (r, section) => ({ id: 'archive:' + r.identifier, title: clean(r.title) || r.identifier, year: clean(r.year || r.date).slice(0,4), kind: section === 'movies' ? 'movie' : 'episode', image: 'https://archive.org/services/img/' + encodeURIComponent(r.identifier), description: clean(r.description), provider: 'Internet Archive', genres: values(r.subject), creators: values(r.creator) });
const idOK = id => /^[a-zA-Z0-9_.-]{1,200}$/.test(id);
const moviePicks = ['His Girl Friday', 'The General', 'The Little Shop of Horrors', 'Sherlock Holmes', 'The Last Man on Earth', 'The Stranger', 'D.O.A.'];
const tvPicks = ['The Adventures of Ozzie and Harriet', 'The Beverly Hillbillies', 'The Adventures of Robin Hood', 'Sherlock Holmes'];
export class Library {
  constructor({ transport = new GuardedTransport(), validate = checkStream, now = () => Date.now() } = {}) {
    this.transport = transport; this.validate = validate; this.now = now; this.cache = new Map(); this.channels = seed.map(c => ({ ...c, sources: [...c.sources] })); this.channelsAt = 0; this.refreshing = null;
  }
  async json(url) { const r = await this.transport.fetch(url, { signal: AbortSignal.timeout(15000) }); if (!r.ok) throw new ApiError('The media catalog is temporarily unavailable.'); return r.json(); }
  async refreshChannels() {
    if (this.now() - this.channelsAt < 3600000) return;
    if (this.refreshing) return this.refreshing;
    this.refreshing = (async () => {
      try {
        const rows = await this.json('https://iptv-org.github.io/api/streams.json');
        if (!Array.isArray(rows)) throw new Error('Invalid channel directory.');
        for (const c of this.channels) {
          // Keep the tested URL first; refresh direct alternatives from the same channel.
          const more = rows.filter(r => r.channel === c.id && ['SD', 'US', 'International'].includes(r.feed) && /^https:\/\//.test(r.url) && !r.url.includes('jmp2.uk') && !r.referrer && !r.user_agent).map(r => r.url);
          c.sources = [...new Set([...seed.find(s => s.id === c.id).sources, ...more])].slice(0, 5);
        }
      } catch { /* Bundled tested catalog remains available when the directory is down. */ }
      this.channelsAt = this.now();
    })().finally(() => { this.refreshing = null; });
    return this.refreshing;
  }
  async browse({ section = 'sports', q = '', page = '1', topics = [] } = {}) {
    if (!['sports', 'channels', 'movies', 'tv'].includes(section) || q.length > 160 || !/^\d{1,3}$/.test(String(page)) || Number(page) < 1) throw new ApiError('Invalid library search.', 400);
    if (section === 'sports' || section === 'channels') {
      // Refresh in the background so opening a tab is instant, even during an outage.
      this.refreshChannels().catch(() => {});
      return { section, page: 1, hasNextPage: false, description: section === 'sports' ? 'Live sports channels. Events, replays and studio coverage follow each channel’s schedule; availability varies by region.' : 'Live movie and television channels. Pick a channel to watch what is on now.', results: this.channels.filter(c => c.section === section && c.title.toLowerCase().includes(q.toLowerCase())).map(c => ({ id: 'live:' + c.id, title: c.title, country: c.country, kind: 'live', image: '', description: 'Live channel · ' + c.country, provider: 'Live channels' })) };
    }
    const key = JSON.stringify([section, q, page, topics]);
    const cached = this.cache.get(key); if (cached && cached.until > this.now()) return cached.data;
    const collection = section === 'movies' ? 'feature_films' : 'classic_tv';
    const term = q.replace(/[+\-!(){}\[\]^"~*?:\\/|&]/g, ' ').trim();
    const picks = section === 'movies' ? moviePicks : tvPicks;
    const related = Array.isArray(topics) ? topics.slice(0,6).map(t => clean(t).replace(/[^a-zA-Z0-9 ]/g, '').slice(0,60)).filter(Boolean) : [];
    const query = 'collection:' + collection + ' AND mediatype:movies AND -access-restricted-item:true AND ' + (term ? 'title:(' + term.split(/\s+/).map(s => '"' + s + '"').join(' AND ') + ')' : related.length ? '(' + related.map(t => 'subject:"' + t + '"').join(' OR ') + ')' : '(' + picks.map(t => 'title:"' + t + '"').join(' OR ') + ')');
    const params = new URLSearchParams({ q: query, output: 'json', rows: '24', page: String(page) });
    for (const f of ['identifier', 'title', 'year', 'description', 'subject', 'creator']) params.append('fl[]', f);
    params.append('sort[]', 'downloads desc');
    const response = await this.json('https://archive.org/advancedsearch.php?' + params);
    if (!Array.isArray(response.response?.docs)) throw new ApiError('The on-demand catalog returned an invalid response.');
    const seen = new Set();
    const results = response.response.docs.filter(r => idOK(r.identifier)).map(r => profile(r, section)).filter(r => { const k = r.title.toLowerCase().replace(/[^a-z0-9]+/g, '') + r.year; if (seen.has(k)) return false; seen.add(k); return true; });
    const data = { section, page: Number(page), hasNextPage: Number(page) * 24 < response.response.numFound, results, description: 'On-demand classics from Internet Archive. Search this collection by title. Availability and picture quality vary by item.' };
    if (this.cache.size > 100) this.cache.delete(this.cache.keys().next().value);
    this.cache.set(key, { until: this.now() + 300000, data }); return data;
  }
  async archiveGroups(item) {
    const key = 'item:' + item, cached = this.cache.get(key);
    if (cached && cached.until > this.now() && this.cache.has('profile:' + item)) return cached.data;
    const data = await this.json('https://archive.org/metadata/' + encodeURIComponent(item));
    const collections = [].concat(data.metadata?.collection || []);
    if (!collections.some(c => ['feature_films', 'classic_tv'].includes(c)) || data.is_dark || ['true', true, '1'].includes(data.metadata?.['access-restricted-item'])) throw new ApiError('This item is not available for direct playback.', 404);
    this.cache.set('profile:' + item, { until: this.now() + 300000, data: profile({ ...data.metadata, identifier: item }, collections.includes('feature_films') ? 'movies' : 'tv') });
    const files = (data.files || []).filter(f => /\.mp4$/i.test(f.name || '') && /h\.264|mpeg4|mpeg-4/i.test(f.format || '') && !f.private && Number(f.size) > 5000000 && !/sample|trailer/i.test(f.name));
    const byName = new Map((data.files || []).map(f => [f.name, f]));
    const groups = new Map();
    for (const f of files) {
      let root = f;
      for (let n = 0; n < 8 && root.original && byName.has(root.original); n++) root = byName.get(root.original);
      const name = root.original || root.name;
      if (!groups.has(name)) groups.set(name, { id: name, title: name.replace(/\.[^.]+$/, '').replace(/_/g, ' '), files: [] });
      groups.get(name).files.push(f);
    }
    const result = [...groups.values()].sort((a, b) => a.title.localeCompare(b.title, 'en', { numeric: true }));
    for (const g of result) g.files.sort((a, b) => Number(/512kb|ia\.mp4/i.test(b.name)) - Number(/512kb|ia\.mp4/i.test(a.name)) || Number(a.size) - Number(b.size));
    if (this.cache.size > 100) this.cache.delete(this.cache.keys().next().value);
    this.cache.set(key, { until: this.now() + 300000, data: result }); return result;
  }
  async item(id) {
    const item = String(id || '').replace(/^archive:/, '');
    if (!String(id).startsWith('archive:') || !idOK(item)) throw new ApiError('Invalid media item.', 400);
    const episodes = (await this.archiveGroups(item)).map((g, i) => ({ id: g.id, number: i + 1, title: g.title }));
    return { item: this.cache.get('profile:' + item)?.data, episodes }; 
  }
  async home(rawIds = '[]') {
    let ids; try { ids = JSON.parse(rawIds); } catch { throw new ApiError('Invalid viewing history.', 400); }
    if (!Array.isArray(ids) || ids.length > 12 || ids.some(id => typeof id !== 'string' || !/^archive:[a-zA-Z0-9_.-]{1,200}$/.test(id))) throw new ApiError('Invalid viewing history.', 400);
    const history = [], errors = [];
    const queue = [...new Set(ids)];
    await Promise.all(Array.from({ length: Math.min(4, queue.length) }, async () => {
      while (queue.length) { const id = queue.shift(); try { history.push({ id, ...await this.item(id) }); } catch { errors.push('Some watched titles could not be refreshed.'); } }
    }));
    history.sort((a,b) => ids.indexOf(a.id) - ids.indexOf(b.id));
    const genrePattern = /^(comedy|drama|romance|romantic comedy|action|adventure|mystery|crime|thriller|horror|science fiction|sci-fi|fantasy|western|musical|animation|documentary|family|sitcom)$/i;
    const topics = [...new Set(history.flatMap(h => h.item?.genres || []).filter(t => genrePattern.test(t)))].slice(0,6);
    const results = await Promise.all(['movies','tv'].map(async section => {
      try { const base = await this.browse({section}); if (!topics.length) return base.results; try { return [...(await this.browse({section, topics})).results, ...base.results]; } catch { return base.results; } }
      catch { errors.push(section === 'movies' ? 'Movie recommendations are temporarily unavailable.' : 'TV recommendations are temporarily unavailable.'); return []; }
    }));
    return { history, results: results.flat(), errors: [...new Set(errors)] };
  }
  async resolve(id, file) {
    let streams, live = false;
    if (typeof id !== 'string') throw new ApiError('Choose a media item.', 400);
    if (id.startsWith('live:')) {
      const channel = this.channels.find(c => 'live:' + c.id === id);
      if (!channel) throw new ApiError('Unknown channel.', 404);
      live = true; streams = channel.sources.map(sourceUrl => ({ sourceUrl, isHLS: true, quality: 'auto', subtitles: [] }));
    } else {
      const item = id.replace(/^archive:/, '');
      if (!id.startsWith('archive:') || !idOK(item)) throw new ApiError('Invalid media item.', 400);
      const groups = await this.archiveGroups(item);
      const selected = file ? groups.find(g => g.id === file) : groups.length === 1 ? groups[0] : null;
      if (!selected) throw new ApiError('Choose an episode or video from this item.', 400);
      streams = selected.files.slice(0, 3).map(f => ({ sourceUrl: 'https://archive.org/download/' + encodeURIComponent(item) + '/' + f.name.split('/').map(encodeURIComponent).join('/'), isHLS: false, quality: f.format, subtitles: [] }));
    }
    if (!streams?.length) throw new ApiError('No compatible video file is available for this item.', 404);
    for (let i = 0; i < Math.min(streams.length, 3); i++) {
      try { await this.validate(streams[i]); return { provider: live ? 'Live channels' : 'Internet Archive', live, streams: [streams[i], ...streams.slice(i + 1)] }; } catch { /* Try another declared source for this exact item. */ }
    }
    throw new ApiError(live ? 'This channel is unavailable from your network right now. Try another channel.' : 'This video is temporarily unavailable. Try another item.', 503);
  }
}
