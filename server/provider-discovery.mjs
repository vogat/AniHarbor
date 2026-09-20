import { ApiError } from './catalog.mjs';
import { GuardedTransport } from './relay.mjs';
import { displayTitle, groupShows } from './grouping.mjs';

const BASE = 'https://hianime.at';
const routes = { recommended: '/most-popular', new: '/recently-updated' };

function entity(value = '') {
  const named = { amp: '&', quot: '"', apos: "'", lt: '<', gt: '>', nbsp: ' ' };
  return String(value).replace(/&(#x[0-9a-f]+|#\d+|amp|quot|apos|lt|gt|nbsp);/gi, (whole, part) => {
    if (part[0] !== '#') return named[part.toLowerCase()] || whole;
    const point = part[1].toLowerCase() === 'x' ? parseInt(part.slice(2), 16) : Number(part.slice(1));
    return point > 0 && point <= 0x10ffff ? String.fromCodePoint(point) : '';
  });
}
function plain(value) { return entity(String(value || '').replace(/<[^>]*>/g, '')).replace(/\s+/g, ' ').trim(); }
function attrs(tag = '') {
  return Object.fromEntries([...tag.matchAll(/([\w-]+)\s*=\s*(["'])(.*?)\2/gs)].map(match => [match[1].toLowerCase(), entity(match[3])]));
}
function publicUrl(value) {
  if (!value) return '';
  try { const url = new URL(value, BASE); return url.protocol === 'https:' && !url.username && !url.password && !url.port ? url.href : ''; } catch { return ''; }
}

// Parse only inert public catalog markup. Neither page scripts nor embeds run.
export function parseProviderFeed(html, section, page) {
  const route = routes[section];
  const body = String(html).split(/id=["']main-sidebar["']/)[0];
  const heading = section === 'recommended' ? 'Most Popular' : 'Recently Updated';
  if (!route || !new RegExp('<h2\\b[^>]*>\\s*' + heading + '\\s*</h2>', 'i').test(body)) throw new ApiError('Backup discovery is temporarily unavailable.', 503);
  const seen = new Set(), rows = [];
  for (const card of body.split(/class=["']flw-item(?:\s[^"']*)?["']/).slice(1)) {
    const heading = card.match(/<h3\b[^>]*class=["']film-name["'][^>]*>([\s\S]*?)<\/h3>/)?.[1];
    const a = attrs(heading?.match(/<a\b[^>]*>/)?.[0]);
    const href = publicUrl(a.href);
    if (!href || new URL(href).origin !== BASE) continue;
    const slug = new URL(href).pathname.slice(1);
    if (!/^[a-z0-9-]+-\d+$/.test(slug) || !a.title) continue;
    const mediaType = plain(card.match(/<span\b[^>]*class=["']fdi-item["'][^>]*>([\s\S]*?)<\/span>/)?.[1]).toUpperCase();
    // Discovery presents episodic shows. Movies remain separate search results.
    if (!['TV', 'ONA', 'OVA', 'SPECIAL'].includes(mediaType)) continue;
    const title = displayTitle(a.title);
    if (!title || seen.has(slug)) continue;
    seen.add(slug);
    const image = attrs(card.match(/<img\b[^>]*>/)?.[0]);
    const lookupTitles = [...new Set([title, a['data-jname']].filter(Boolean))];
    rows.push({
      id: 'discover:hianime:' + slug,
      provider: 'hianime', mediaType, aliases: lookupTitles.slice(1),
      title,
      image: publicUrl(image['data-src'] || image.src),
      kind: 'series',
      lookupTitles,
      description: plain(card.match(/<div\b[^>]*class=["']description["'][^>]*>([\s\S]*?)<\/div>/)?.[1])
    });
  }
  const results = groupShows(rows).map(show => {
    const ids = new Set(show.seasons.flatMap(season => season.providers.map(provider => provider.id)));
    const first = rows.find(row => ids.has(row.id));
    return { id: first.id, title: show.title, image: show.image, kind: show.kind, lookupTitles: first.lookupTitles, description: first.description };
  });
  const next = [...body.matchAll(/<a\b[^>]*>/g)].some(match => {
    const a = attrs(match[0]);
    if (!(a.class || '').split(/\s+/).includes('page-link') || !a.href) return false;
    try { const url = new URL(a.href, BASE); return url.origin === BASE && url.pathname === route && Number(url.searchParams.get('page')) === page + 1; } catch { return false; }
  });
  if (!results.length && page === 1) throw new ApiError('Backup discovery returned no shows. Try again shortly.', 503);
  return {
    results, page, hasNextPage: next && page < 100, source: 'hianime',
    description: section === 'recommended'
      ? 'Popular series on HiAnime. Suggestions are not personalized; all configured sources are searched when you open a show.'
      : 'Latest episode additions on HiAnime, including updates to older series. This reflects source updates rather than original broadcast dates.'
  };
}

export class ProviderDiscovery {
  constructor({ fetch = (...args) => new GuardedTransport().fetch(...args), now = () => Date.now(), timeout = 10000, ttl = 5 * 60000 } = {}) {
    this.fetch = fetch; this.now = now; this.timeout = timeout; this.ttl = ttl;
    this.cache = new Map(); this.pending = new Map();
  }
  async feed(section, value = 1) {
    if (!Object.hasOwn(routes, section)) throw new ApiError('Unknown discovery section.', 400);
    const page = Number(value);
    if (!Number.isSafeInteger(page) || page < 1 || page > 100) throw new ApiError('Select a page from 1 to 100.', 400);
    const key = section + ':' + page, cached = this.cache.get(key);
    if (cached?.until > this.now()) return cached.value;
    if (this.pending.has(key)) return this.pending.get(key);
    const work = (async () => {
      try {
        const response = await this.fetch(BASE + routes[section] + '?page=' + page, {
          signal: AbortSignal.timeout(this.timeout),
          headers: { Accept: 'text/html', Referer: BASE + '/', 'User-Agent': 'Mozilla/5.0' }
        });
        if (!response.ok) throw new Error('Backup unavailable');
        const value = parseProviderFeed(await response.text(), section, page);
        if (this.cache.size >= 50) this.cache.delete(this.cache.keys().next().value);
        this.cache.set(key, { value, until: this.now() + this.ttl });
        return value;
      } catch {
        if (cached) return { ...cached.value, stale: true };
        throw new ApiError('Discovery sources are temporarily unavailable. Search still works; try this section again shortly.', 503);
      }
    })();
    this.pending.set(key, work);
    try { return await work; } finally { this.pending.delete(key); }
  }
}
