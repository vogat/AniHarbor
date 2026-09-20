import { titleKey } from './catalog.mjs';

export function displayTitle(value) {
  let title = String(value || '').trim();
  for (let n = 0; n < 3; n++) title = title.replace(/\s*[\[(](?:(?:english\s+)?(?:subbed|dubbed|sub|dub)|tv)[\])]\s*$/i, '').trim();
  return title;
}

// Only explicit season/part markers are removed. A colon, sequel subtitle,
// year or trailing digit alone is not evidence of a season.
export function seasonTitle(value) {
  const title = displayTitle(value);
  const match = title.match(/^(.*?)[\s:–—-]+(?:(?:season\s*(\d+)|(\d+)(?:st|nd|rd|th)\s+season|s(\d+))|(?:the\s+)?(final\s+season))(?:[\s,:–—-]+(?:part|cour)\s*(\d+))?\s*$/i);
  if (match && match[1]) return { base: match[1].trim(), number: Number(match[2] || match[3] || match[4]) || undefined, label: match[5] ? 'Final season' + (match[6] ? ' · Part ' + match[6] : '') : 'Season ' + Number(match[2] || match[3] || match[4]) + (match[6] ? ' · Part ' + match[6] : ''), part: Number(match[6]) || 0, explicit: true };
  const part = title.match(/^(.*?)[\s,:–—-]+(?:part|cour)\s*(\d+)\s*$/i);
  if (part) return { base: part[1].trim(), label: 'Part ' + Number(part[2]), part: Number(part[2]), explicit: true };
  return { base: title, label: title, explicit: false, part: 0 };
}

export function isMovie(row) {
  return /^(movie|film)$/i.test(row.kind || row.mediaType || row.type || '') || /\b(?:movie|gekijouban|gekijōban|the film)\b/i.test(row.title || '');
}
export function aliases(meta) {
  return [...new Set([meta.title, meta.title_english, ...(meta.titles || []).map(t => t.title), ...(meta.title_synonyms || [])].filter(Boolean))];
}
export function findMetadata(row, metadata) {
  if (row.malId) { const exact = metadata.find(m => Number(m.mal_id) === Number(row.malId)); if (exact) return exact; }
  const key = titleKey(displayTitle(row.title));
  const candidates = metadata.filter(m => aliases(m).some(t => titleKey(t) === key) && (!row.year || !m.year || Number(row.year) === Number(m.year)));
  return candidates.length === 1 ? candidates[0] : null;
}

export function groupShows(rows, metadata = []) {
  const declaredAliases = new Map();
  for (const row of rows) for (const alias of row.aliases || []) {
    const key = titleKey(displayTitle(alias));
    if (key && key !== titleKey(displayTitle(row.title))) {
      if (!declaredAliases.has(key)) declaredAliases.set(key, []);
      declaredAliases.get(key).push(row);
    }
  }
  const canonicalTitle = row => {
    const candidates = (declaredAliases.get(titleKey(displayTitle(row.title))) || []).filter(other => !row.year || !other.year || Number(row.year) === Number(other.year));
    const titles = new Set(candidates.map(other => titleKey(displayTitle(other.title))));
    if (titles.size !== 1) return displayTitle(row.title);
    const candidate = candidates[0];
    const reciprocal = (row.aliases || []).some(alias => titleKey(displayTitle(alias)) === titleKey(displayTitle(candidate.title)));
    return displayTitle(reciprocal && rows.indexOf(row) < rows.indexOf(candidate) ? row.title : candidate.title);
  };
  const knownKinds = new Map();
  for (const row of rows) if (row.kind || row.type || row.mediaType) {
    const key = titleKey(canonicalTitle(row));
    if (!knownKinds.has(key)) knownKinds.set(key, new Set());
    knownKinds.get(key).add(isMovie(row) ? 'movie' : 'series');
  }
  const records = rows.filter(r => r?.id && r.title && r.provider).map(row => {
    const meta = findMetadata(row, metadata) || findMetadata({ ...row, title: canonicalTitle(row) }, metadata);
    const title = displayTitle(meta?.title_english || meta?.title || canonicalTitle(row));
    const known = knownKinds.get(titleKey(canonicalTitle(row)));
    const movie = meta ? meta.type === 'Movie' : isMovie(row) || (!row.kind && !row.type && !row.mediaType && known?.size === 1 && known.has('movie'));
    const season = movie ? { base: title, label: title, explicit: false, part: 0 } : seasonTitle(title);
    return { row, meta, title, movie, season, year: meta?.year || row.year || null };
  });
  // An upstream may call a season "My Hero Academia 2" in English while its
  // declared Japanese alias explicitly says "Boku no Hero Academia 2nd Season".
  // Trust that season marker only when its base alias identifies one show here.
  const baseAliases = new Map();
  for (const record of records) if (!record.movie && !record.season.explicit) {
    for (const alias of [record.title, ...(record.row.aliases || []), ...(record.meta ? aliases(record.meta) : [])]) {
      if (seasonTitle(alias).explicit) continue;
      const key = titleKey(displayTitle(alias));
      if (!baseAliases.has(key)) baseAliases.set(key, []);
      baseAliases.get(key).push(record);
    }
  }
  const seasonHints = new Map();
  for (const record of records) if (!record.movie && !record.season.explicit) {
    for (const alias of [...(record.row.aliases || []), ...(record.meta ? aliases(record.meta) : [])]) {
      const hint = seasonTitle(alias);
      if (!hint.explicit) continue;
      const candidates = (baseAliases.get(titleKey(hint.base)) || []).filter(base => base !== record);
      const identities = new Set(candidates.map(base => titleKey(base.title) + ':' + (base.year || '')));
      if (identities.size !== 1) continue;
      const key = titleKey(record.title), value = { ...hint, base: candidates[0].season.base };
      if (!seasonHints.has(key)) seasonHints.set(key, []);
      seasonHints.get(key).push(value);
    }
  }
  for (const record of records) if (!record.movie && !record.season.explicit) {
    const hints = seasonHints.get(titleKey(record.title)) || [];
    const identities = new Set(hints.map(h => titleKey(h.base) + ':' + h.label));
    if (identities.size === 1) record.season = hints[0];
  }
  const bases = new Set(records.filter(r => !r.movie).map(r => titleKey(r.season.base)));
  const romanNumbers = { II: 2, III: 3, IV: 4, V: 5, VI: 6, VII: 7, VIII: 8, IX: 9, X: 10 };
  for (const r of records) if (!r.movie && !r.season.explicit) {
    const match = r.title.match(/^(.*?)\s+(II|III|IV|V|VI|VII|VIII|IX|X)$/);
    if (match && bases.has(titleKey(match[1]))) r.season = { base: match[1], label: 'Season ' + romanNumbers[match[2]], number: romanNumbers[match[2]], part: 0, explicit: true };
  }
  // Known different years for the same non-season title are remakes, not duplicate sources.
  const years = new Map();
  for (const r of records) if (!r.season.explicit && r.year) {
    const key = `${r.movie}:${titleKey(r.title)}`;
    if (!years.has(key)) years.set(key, new Set());
    years.get(key).add(Number(r.year));
  }
  const groups = new Map();
  const baseFamilies = new Map();
  for (const r of records) if (!r.movie && r.meta?._seriesId) {
    const base = titleKey(r.season.base);
    if (!baseFamilies.has(base)) baseFamilies.set(base, new Set());
    baseFamilies.get(base).add(r.meta._seriesId);
  }
  for (const r of records) {
    const { row, meta, movie, season } = r;
    const collision = (years.get(`${movie}:${titleKey(r.title)}`)?.size || 0) > 1;
    const possibleFamilies = baseFamilies.get(titleKey(season.base));
    const family = !movie && (meta?._seriesId || (!collision && possibleFamilies?.size === 1 ? [...possibleFamilies][0] : null));
    const key = family ? 'series:mal:' + family : (movie ? 'movie:' : 'series:') + titleKey(season.base) + (collision ? ':' + (r.year || 'unknown') : '');
    let show = groups.get(key);
    if (!show) {
      const familyRoot = family && metadata.find(m => Number(m.mal_id) === Number(family));
      show = { id: key, title: familyRoot ? displayTitle(familyRoot.title_english || familyRoot.title) : season.base, image: row.image || meta?.images?.jpg?.large_image_url || '', year: r.year, kind: movie ? 'movie' : 'series', seasons: [] };
      if (meta) { show.malId = family || meta.mal_id; show.description = (familyRoot || meta).synopsis || ''; }
      groups.set(key, show);
    }
    const rawKey = titleKey(displayTitle(row.title));
    const seasonKey = meta ? 'mal:' + meta.mal_id : titleKey(r.title);
    const signature = season.explicit ? titleKey(season.base) + ':' + (season.number || (/^Final season/.test(season.label) ? 'final' : 1)) + ':' + (season.part || 1) : '';
    let selected = show.seasons.find(s => s.id === seasonKey || (!s.malId && s._rawKeys.includes(rawKey)) || (signature && s._signature === signature && (!s.year || !r.year || Number(s.year) === Number(r.year)) && (!s.malId || !meta || s.malId === meta.mal_id)));
    if (!selected) {
      selected = { id: seasonKey, title: r.title, label: season.explicit ? season.label : r.title, year: r.year, providers: [], _rawKeys: [], _part: season.part, _signature: signature };
      if (season.number) selected.number = season.number;
      if (meta) selected.malId = meta.mal_id;
      show.seasons.push(selected);
    }
    selected._rawKeys.push(rawKey);
    if (!selected.providers.some(p => p.provider === row.provider && p.id === row.id)) selected.providers.push({ ...row, ...(meta ? { malId: meta.mal_id } : {}) });
    if (!show.image && row.image) show.image = row.image;
    if (r.year && (!show.year || Number(r.year) < Number(show.year))) show.year = r.year;
  }
  for (const show of groups.values()) {
    show.seasons.sort((a, b) => (a.year && b.year ? a.year - b.year : 0) || (a.number || (/^Final season/.test(a.label) ? 999 : 1)) - (b.number || (/^Final season/.test(b.label) ? 999 : 1)) || a._part - b._part || a.title.localeCompare(b.title));
    if (show.seasons.length > 1) for (const season of show.seasons) {
      if (titleKey(season.title) === titleKey(show.title) && !season.number) { season.label = 'Season 1'; season.number = 1; }
    }
    for (const season of show.seasons) { delete season._rawKeys; delete season._part; delete season._signature; }
  }
  return [...groups.values()];
}
