import { ApiError, titleKey } from './catalog.mjs';
import { GuardedTransport } from './relay.mjs';
import { aliases, displayTitle, findMetadata, groupShows, metadataDetails, seasonTitle } from './grouping.mjs';
import { ProviderDiscovery } from './provider-discovery.mjs';

const BASE = 'https://api.jikan.moe/v4';
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const episodic = m => ['TV', 'ONA', 'OVA', 'Special', 'TV Special'].includes(m?.type);
const safePage = value => { const page = Number(value || 1); if (!Number.isSafeInteger(page) || page < 1 || page > 100) throw new ApiError('Select a page from 1 to 100.', 400); return page; };

export class Discovery {
  constructor({ fetch = (...args) => new GuardedTransport().fetch(...args), now = () => Date.now(), spacing = 1050, timeout = 6500, fallback = new ProviderDiscovery() } = {}) {
    this.fetch = fetch; this.now = now; this.spacing = spacing; this.timeout = timeout;
    this.fallback = fallback;
    this.feedSources = new Map();
    this.cache = new Map(); this.pending = new Map(); this.metadata = new Map(); this.queue = Promise.resolve(); this.nextRequest = 0;
    this.failedUntil = 0;
  }
  async request(route) {
    const cached = this.cache.get(route);
    if (cached?.until > this.now()) return cached.value;
    if (this.failedUntil > this.now()) {
      if (cached) return { ...cached.value, stale: true };
      throw new ApiError('Discovery is temporarily unavailable. Search still works; try this section again shortly.', 503);
    }
    if (this.pending.has(route)) return this.pending.get(route);
    const work = (async () => {
      // Jikan permits 3/sec and 60/min. A shared queue also covers simultaneous TV requests.
      const slot = this.queue.then(async () => { await sleep(Math.max(0, this.nextRequest - this.now())); this.nextRequest = this.now() + this.spacing; });
      this.queue = slot.catch(() => {}); await slot;
      try {
        const response = await this.fetch(BASE + route, { signal: AbortSignal.timeout(this.timeout), headers: { Accept: 'application/json' } });
        if (!response.ok) throw new Error('Metadata source unavailable');
        const value = await response.json();
        if (!value || !Object.hasOwn(value, 'data')) throw new Error('Invalid metadata response');
        if (this.cache.size >= 250) this.cache.delete(this.cache.keys().next().value);
        this.cache.set(route, { value, until: this.now() + 15 * 60000 });
        return value;
      } catch (error) {
        this.failedUntil = this.now() + 45000;
        if (cached) return { ...cached.value, stale: true };
        throw new ApiError('Discovery is temporarily unavailable. Search still works; try this section again shortly.', 503);
      }
    })();
    this.pending.set(route, work);
    try { return await work; } finally { this.pending.delete(route); }
  }
  remember(entries) {
    for (const entry of entries) if (Number.isSafeInteger(entry?.mal_id)) {
      this.metadata.set(entry.mal_id, { ...this.metadata.get(entry.mal_id), ...entry });
      if (this.metadata.size > 1500) this.metadata.delete(this.metadata.keys().next().value);
    }
    return entries;
  }
  async searchMetadata(title) {
    const result = await this.request('/anime?q=' + encodeURIComponent(title) + '&sfw=true&limit=25');
    return this.remember(Array.isArray(result.data) ? result.data : []);
  }
  async family(id, deadline = this.now() + 11000) {
    const pending = [Number(id)], seen = new Set(), family = [];
    // Only verified prequel/sequel relationships connect seasons. Films are never
    // shown as seasons; following their links can reach a subsequent TV season.
    while (pending.length && seen.size < 10 && this.now() < deadline) {
      const next = pending.shift();
      if (seen.has(next) || !Number.isSafeInteger(next) || next <= 0) continue;
      seen.add(next);
      let data;
      try { data = (await this.request('/anime/' + next + '/full')).data; } catch { break; }
      if (!data?.mal_id) continue;
      this.remember([data]);
      if (episodic(data)) family.push(data);
      if (!episodic(data) && data.type !== 'Movie') continue;
      for (const relation of data.relations || []) if (['Prequel', 'Sequel'].includes(relation.relation)) {
        for (const entry of relation.entry || []) if (entry.type === 'anime' && !seen.has(entry.mal_id)) pending.push(entry.mal_id);
      }
    }
    family.sort((a, b) => String(a.aired?.from || '9999').localeCompare(String(b.aired?.from || '9999')) || a.mal_id - b.mal_id);
    if (family.length) {
      const root = family[0].mal_id;
      for (const entry of family) { entry._seriesId = root; this.remember([entry]); }
    }
    return family;
  }
  async search(catalog, q, provider = 'auto') {
    // Provider search is independent of metadata availability.
    const [raw, metadata] = await Promise.all([
      catalog.search(q, provider),
      this.searchMetadata(String(q || '')).then(async entries => {
        const exact = entries.filter(m => aliases(m).some(title => titleKey(title) === titleKey(q)));
        if (exact.length === 1 && episodic(exact[0])) await this.family(exact[0].mal_id);
        return [...this.metadata.values()];
      }).catch(() => [...this.metadata.values()])
    ]);
    return { results: groupShows(raw.results, metadata), errors: raw.errors };
  }
  tile(entry) {
    const title = entry.title_english || entry.title || '';
    return { id: 'mal:' + entry.mal_id, malId: entry.mal_id, title, image: entry.images?.jpg?.large_image_url || entry.images?.jpg?.image_url || '', year: entry.year || entry.aired?.prop?.from?.year || null, kind: entry.type === 'Movie' ? 'movie' : 'series', lookupTitles: aliases(entry).slice(0, 8), description: entry.synopsis || '', ...metadataDetails(entry) };
  }
  async feed(section, value = 1) {
    const page = safePage(value);
    if (!['recommended', 'new'].includes(section)) throw new ApiError('Unknown discovery section.', 400);
    if (this.fallback && this.feedSources.get(section) > this.now()) return this.fallback.feed(section, page);
    try { return { ...await this.metadataFeed(section, page), source: 'jikan' }; }
    catch (error) {
      if (!this.fallback) throw error;
      // Keep pagination on one catalog if the primary recovers between pages.
      this.feedSources.set(section, this.now() + 300000);
      return this.fallback.feed(section, page);
    }
  }
  async metadataFeed(section, page) {
    if (section === 'recommended') {
      const data = await this.request('/top/anime?type=tv&filter=bypopularity&sfw=true&limit=24&page=' + page);
      const rows = this.remember((data.data || []).filter(episodic));
      return { results: this.uniqueTiles(rows), page, hasNextPage: !!data.pagination?.has_next_page, description: 'Popular series from MyAnimeList. Suggestions are not personalized; source availability is checked when you open a show.', ...(data.stale ? { stale: true } : {}) };
    }
    // This endpoint is a finite, ordered feed of recently listed episodes,
    // not a current-season ranking. Pagination is over that cached feed.
    const data = await this.request('/watch/episodes');
    const seen = new Set(), entries = [];
    for (const item of data.data || []) if (item.entry?.mal_id && !seen.has(item.entry.mal_id)) {
      seen.add(item.entry.mal_id); entries.push({ ...item.entry, _latestEpisode: item.episodes?.[0]?.title || '' });
    }
    const all = this.uniqueTiles(entries);
    return { results: all.slice((page - 1) * 24, page * 24), page, hasNextPage: all.length > page * 24, description: 'Series with recently listed episodes on MyAnimeList. The feed can lag broadcasts; playback depends on the selected source.', ...(data.stale ? { stale: true } : {}) };
  }
  uniqueTiles(entries) {
    const seen = new Set(), result = [];
    for (const entry of entries) {
      const known = this.metadata.get(entry.mal_id), tile = this.tile({ ...known, ...entry });
      const key = known?._seriesId ? 'family:' + known._seriesId : (tile.kind === 'movie' ? 'movie:' : 'series:') + titleKey(seasonTitle(tile.title).base);
      if (!tile.title || seen.has(key)) continue;
      seen.add(key); if (entry._latestEpisode) tile.latestEpisode = entry._latestEpisode;
      result.push(tile);
    }
    return result;
  }
  async show(catalog, input) {
    const title = String(input.title || '').trim();
    if (!title || title.length > 200) throw new ApiError('Select a title to open.', 400);
    let meta = null, family = [], errors = [];
    const malId = Number(input.malId);
    if (input.malId && (!Number.isSafeInteger(malId) || malId < 1)) throw new ApiError('Invalid catalog ID.', 400);
    try {
      if (malId) {
        meta = (await this.request('/anime/' + malId + '/full')).data;
        this.remember([meta]);
      } else {
        const found = await this.searchMetadata(title);
        meta = findMetadata({ title }, found);
      }
      if (meta && episodic(meta)) family = await this.family(meta.mal_id);
    } catch { errors.push({ provider: 'metadata', message: 'Season metadata is unavailable. Matching source results are still shown.' }); }
    const known = [...this.metadata.values()];
    const related = family.length ? family : meta ? [meta] : [];
    const root = family[0] || meta;
    let lookups = [];
    try { lookups = input.lookupTitles ? JSON.parse(input.lookupTitles) : []; } catch { /* Optional hints only. */ }
    if (!Array.isArray(lookups)) lookups = [];
    // Search the exact titles of related entries as well as the franchise root.
    // This matters for OVAs/specials that providers catalogue separately (for
    // example a national-tournament OVA rather than under the original TV title).
    const queryCandidates = [root?.title_english || root?.title || title, root?.title, title, ...lookups.filter(x => typeof x === 'string' && x.length <= 200)];
    for (const entry of related) {
      queryCandidates.push(entry.title_english, entry.title, ...aliases(entry).slice(0, 3));
    }
    const queries = [];
    for (const value of queryCandidates.filter(Boolean)) {
      const full = displayTitle(value);
      const base = seasonTitle(full).base;
      for (const candidate of [full, base]) if (candidate && !queries.some(q => titleKey(q) === titleKey(candidate))) queries.push(candidate);
      if (queries.length >= 10) break;
    }
    const batches = [];
    for (let i = 0; i < queries.length; i += 3) batches.push(...await Promise.all(queries.slice(i, i + 3).map(q => catalog.search(q).catch(e => ({ results: [], errors: [{ provider: 'sources', message: e.message }] })))));
    const rows = batches.flatMap(b => b.results), allowed = new Set(related.map(m => m.mal_id));
    for (const batch of batches) errors.push(...batch.errors);
    const grouped = groupShows(rows, known);
    let show;
    if (meta) show = grouped.find(g => g.seasons.some(s => allowed.has(s.malId)));
    if (!show) show = grouped.find(g => titleKey(g.title) === titleKey(seasonTitle(title).base) || g.seasons.some(s => titleKey(s.title) === titleKey(title)));
    if (!show) {
      if (rows.length && !meta) throw new ApiError('No unambiguous matching show was found. Search by the original title.', 404);
      show = { ...(meta ? this.tile(meta) : { id: 'series:' + titleKey(title), title, image: '', year: null, kind: 'series' }), seasons: [] };
    }
    if (meta) {
      show.description = root?.synopsis || meta.synopsis || show.description;
      show.malId = root?.mal_id || meta.mal_id;
      Object.assign(show, metadataDetails(root || meta));
    }
    show.expanded = true;
    return { show, errors: [...new Map(errors.map(e => [e.provider + ':' + e.message, e])).values()] };
  }
}
