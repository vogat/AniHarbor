export class ApiError extends Error {
  constructor(message, status = 502, details = {}) { super(message); this.status = status; this.details = details; }
}

export function titleKey(title) {
  // Preserve season numbers and meaningful words. A broad fuzzy match can play the wrong show.
  return String(title || '').normalize('NFKC').toLowerCase().replace(/\s*\((?:sub|dub)\)\s*$/i, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

export class Catalog {
  constructor(providers, { timeout = 14000, cooldown = 60000, now = () => Date.now() } = {}) {
    this.providers = providers;
    this.timeout = timeout;
    this.cooldown = cooldown;
    this.now = now;
    this.states = new Map();
    this.cache = new Map();
    this.pending = new Map();
  }
  list() {
    return this.providers.map(({ adapter, ctor, ...p }) => {
      const state = this.states.get(p.id) || {};
      return { ...p, ...state,
        status: !adapter ? 'unavailable' : state.until > this.now() ? 'cooldown' : state.checkedAt ? state.status : 'untested' };
    });
  }
  provider(id) {
    const p = this.providers.find(p => p.id === id);
    if (!p || !p.adapter) throw new ApiError('Source is not installed.', 400);
    return p;
  }
  async call(provider, method, args, budget = this.timeout) {
    const p = this.provider(provider);
    const state = this.states.get(provider);
    if (state?.until > this.now()) throw new ApiError(`${p.name} is cooling down after a failed request.`);
    const key = JSON.stringify([provider, method, args]);
    const cached = this.cache.get(key);
    if (cached?.until > this.now()) return cached.value;
    if (this.pending.has(key)) return this.pending.get(key);
    const work = (async () => {
      const controller = new AbortController();
      let timer;
      try {
        const result = await Promise.race([
          p.adapter[method](...args, { signal: controller.signal }),
          new Promise((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(new ApiError(`${p.name} timed out.`)); }, Math.min(this.timeout, budget)); })
        ]);
        this.states.set(provider, { status: method === 'resolveStream' ? 'resolved' : 'reachable', checkedAt: new Date(this.now()).toISOString(), until: 0, error: '' });
        if (method !== 'resolveStream') {
          if (this.cache.size >= 250) this.cache.delete(this.cache.keys().next().value);
          this.cache.set(key, { value: result, until: this.now() + 300000 });
        }
        return result;
      } catch (e) {
        // Avoid leaking signed upstream URLs or request headers into the client.
        const message = /timed out|abort/i.test(e.message) ? `${p.name} timed out.` : `${p.name} could not complete the request.`;
        this.states.set(provider, { status: 'error', checkedAt: new Date(this.now()).toISOString(), until: this.now() + this.cooldown, error: message });
        throw new ApiError(message);
      } finally { clearTimeout(timer); }
    })();
    this.pending.set(key, work);
    try { return await work; } finally { this.pending.delete(key); }
  }
  async search(q, provider = 'auto', budget = this.timeout) {
    if (!q || q.length > 200) throw new ApiError('Enter a title of up to 200 characters.', 400);
    const selected = provider === 'auto' ? this.providers.filter(p => !p.manual && p.adapter) : [this.provider(provider)];
    const results = [], errors = [];
    await Promise.all(selected.map(async p => {
      try {
        const rows = await this.call(p.id, 'search', [q], budget);
        if (!Array.isArray(rows)) throw new Error('Invalid search response.');
        for (const row of rows.slice(0, 24)) {
          if (!row.id || !row.title || row.catalogType === 'MANGA') continue;
          results.push({ id: row.id, title: row.title, image: /^https?:\/\//.test(row.thumbnailUrl || '') ? row.thumbnailUrl : '', year: row.year || null, provider: p.id, languages: row.availableLanguages || p.languages, ...(row.mediaType || row.type ? { mediaType: row.mediaType || row.type } : {}), ...(row.malId ? { malId: row.malId } : {}), ...(Array.isArray(row.aliases) ? { aliases: row.aliases.filter(a => typeof a === 'string' && a.length <= 300).slice(0, 8) } : {}) });
        }
      } catch (e) { errors.push({ provider: p.id, message: e.message }); }
    }));
    results.sort((a, b) => Number(titleKey(b.title) === titleKey(q)) - Number(titleKey(a.title) === titleKey(q)) || a.title.localeCompare(b.title) || this.providers.findIndex(p => p.id === a.provider) - this.providers.findIndex(p => p.id === b.provider));
    return { results, errors };
  }
  async episodes(provider, id, budget = this.timeout) {
    if (!id || id.length > 1000) throw new ApiError('A valid series is required.', 400);
    const data = await this.call(provider, 'fetchContentUnits', [id], budget);
    if (!Array.isArray(data)) throw new ApiError('Source returned an invalid episode list.');
    return { provider, episodes: data.filter(e => e.id && Number.isFinite(Number(e.number))).map(e => ({ id: e.id, number: Number(e.number), title: e.title || `Episode ${e.number}`, languages: e.availableLanguages || this.provider(provider).languages })).sort((a, b) => a.number - b.number) };
  }
  async resolve(input) {
    const { provider, id, episodeId, title, year, language = 'sub', exclude = '' } = input;
    const number = Number(input.number);
    if (!provider || !id || !episodeId || !title || !Number.isFinite(number) || !['sub', 'dub'].includes(language)) throw new ApiError('Select a series, episode and audio language.', 400);
    const original = this.provider(provider);
    const skip = new Set(exclude.split(',').filter(Boolean));
    // A manual Portuguese provider must not silently change to an English dub.
    const candidates = original.manual ? [original] : [original, ...this.providers.filter(p => p.id !== provider && !p.manual && p.adapter && p.languages.includes(language))];
    const triedFamilies = new Set([...skip].map(s => this.providers.find(p => p.id === s)?.family).filter(Boolean));
    const attempts = [];
    const deadline = Date.now() + 65000;
    const remaining = () => Math.max(1, deadline - Date.now());
    for (const p of candidates) {
      if (Date.now() >= deadline) { attempts.push({ provider: p.id, message: 'Fallback time limit reached. Try this source manually.' }); break; }
      if (skip.has(p.id) || triedFamilies.has(p.family) || !p.languages.includes(language)) continue;
      triedFamilies.add(p.family);
      try {
        let target = episodeId;
        if (p.id !== provider) {
          const { results } = await this.search(title, p.id, remaining());
          const matches = results.filter(r => titleKey(r.title) === titleKey(title) && (!year || !r.year || Number(year) === Number(r.year)));
          if (matches.length !== 1) {
            attempts.push({ provider: p.id, message: 'No unambiguous matching series. Choose this source manually.' });
            continue;
          }
          const { episodes } = await this.episodes(p.id, matches[0].id, remaining());
          const matchingEpisodes = episodes.filter(e => e.number === number && e.languages.includes(language));
          if (matchingEpisodes.length !== 1) { attempts.push({ provider: p.id, message: 'The exact episode/audio was not found.' }); continue; }
          target = matchingEpisodes[0].id;
        } else {
          const { episodes } = await this.episodes(provider, id, remaining());
          if (!episodes.some(e => e.id === episodeId && e.number === number && e.languages.includes(language))) throw new ApiError('The selected episode/audio is unavailable.');
        }
        const data = await this.call(p.id, 'resolveStream', [target, language], remaining());
        const streams = data?.type === 'video' ? data.streams.filter(s => /^https?:\/\//.test(s.sourceUrl || '') && (!s.language || s.language === language)) : [];
        if (!streams.length) throw new ApiError('Source returned no playable stream links.');
        attempts.push({ provider: p.id, message: 'Stream links resolved; playback still needs verification.' });
        return { provider: p.id, streams, attempts };
      } catch (e) { attempts.push({ provider: p.id, message: e.message }); }
    }
    throw new ApiError('No matching source could resolve this episode. Try another source or retry after its cooldown.', 503, { attempts });
  }
}
