// Deterministic navigation lab. No provider or metadata network requests are made.
// Run: node scripts/ui-fixture.mjs; open the printed URL in a browser.
import { makeServer } from '../server/index.mjs';
import { ApiError } from '../server/catalog.mjs';

const copy = value => JSON.parse(JSON.stringify(value));
const providers = ['harbor', 'beacon', 'island'].map(id => ({
  id, name: id[0].toUpperCase() + id.slice(1) + ' (fixture)', family: id,
  languages: ['sub', 'dub'], status: 'fixture', note: 'Navigation fixture; no video source.',
}));
function makeShow(index = 1, movie = false) {
  const title = movie ? 'Harbor Knights: The Movie' : index === 1 ? 'Harbor Knights' : 'Harbor Story ' + index;
  return {
    id: 'fixture:show:' + index + (movie ? ':movie' : ''), title, image: '', year: 2024,
    kind: movie ? 'movie' : 'series', description: 'Navigation test fixture. No episode video is included.',
    seasons: Array.from({ length: movie ? 1 : 3 }, (_, i) => ({
      id: 'fixture:season:' + index + ':' + i, number: i + 1,
      label: movie ? 'Movie' : 'Season ' + (i + 1), title: title + (i ? ' Season ' + (i + 1) : ''), year: 2024 + i,
      providers: providers.map(p => ({ id: p.id + ':' + index + ':' + (i + 1), title: title + (i ? ' Season ' + (i + 1) : ''),
        provider: p.id, image: '', year: 2024 + i, languages: ['sub', 'dub'] })),
    })),
  };
}
const discovery = {
  async search(catalog, query) {
    if (query.toLowerCase() === 'error') throw new ApiError('Fixture search failure.', 503);
    return { results: query.toLowerCase() === 'empty' ? [] : [makeShow(), makeShow(1, true)], errors: [] };
  },
  async feed(section, page = 1) {
    page = Math.max(1, Number(page) || 1);
    return { results: Array.from({ length: 18 }, (_, i) => {
      const index = (page - 1) * 18 + i + 1;
      return { id: 'fixture:show:' + index, malId: index, title: index === 1 ? 'Harbor Knights' : 'Harbor Story ' + index,
        image: '', kind: 'series', year: 2024, description: 'Navigation fixture.' };
    }), page, hasNextPage: page < 3, description: section === 'recommended' ? 'Popular picks · navigation fixtures' : 'Recent releases · navigation fixtures' };
  },
  async show(catalog, input) { return { show: makeShow(Number(input.malId) || 1), errors: [] }; },
};
const catalog = {
  list: () => providers,
  async episodes(provider, id) {
    console.log('Episodes:', provider, id);
    return { provider, episodes: Array.from({ length: 76 }, (_, i) => ({
      id: id + ':ep:' + (i + 1), number: i + 1, title: 'Episode ' + (i + 1), languages: ['sub', 'dub'],
    })) };
  },
  async resolve(input) {
    console.log('Playback selection:', JSON.stringify(input));
    throw new ApiError('Navigation fixture: no video stream. Press Back to return to episodes.', 503);
  },
};
const isolatedDiscovery = Object.fromEntries(Object.entries(discovery).map(([name, fn]) => [name, async (...args) => copy(await fn(...args))]));
const port = Number(process.env.PORT || 8788);
const server = makeServer({ token: 'navigation-fixture', catalog, discovery: isolatedDiscovery });
server.listen(port, '127.0.0.1', () => console.log('Navigation fixture: http://localhost:' + port + '/#token=navigation-fixture'));
