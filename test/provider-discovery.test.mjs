import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseProviderFeed, ProviderDiscovery } from '../server/provider-discovery.mjs';

function card(slug, title, type = 'TV', extra = '') {
  return `<div class="flw-item flw-item-big"><img src="https://cdn.example/poster.jpg"><h3 class="film-name"><a href="https://hianime.at/${slug}" title="${title}" data-jname="Japanese title">${title}</a></h3><div class="description">A &amp; B &lt;literal&gt; adventure.</div><span class="fdi-item">${type}</span>${extra}</div>`;
}
function page(section, cards, pagination = '') {
  return `<h2 class="cat-heading">${section === 'new' ? 'Recently Updated' : 'Most Popular'}</h2>${cards}${pagination}<div id="main-sidebar">${card('sidebar-9', 'Sidebar show')}</div>`;
}

test('backup feed isolates catalog, deduplicates explicit seasons and excludes movies', () => {
  const data = parseProviderFeed(page('recommended', card('one-1', 'One &amp; Two') + card('one-1', 'One &amp; Two') + card('season-2', 'One &amp; Two Season 2') + card('film-3', 'Separate film', 'MOVIE')), 'recommended', 1);
  assert.equal(data.results.length, 1);
  assert.equal(data.results[0].title, 'One & Two');
  assert.equal(data.results[0].description, 'A & B <literal> adventure.');
  assert.deepEqual(data.results[0].lookupTitles, ['One & Two', 'Japanese title']);
  assert.equal(data.results[0].seasons, undefined);
  assert.equal(data.results[0].provider, undefined);
  assert.equal(data.hasNextPage, false);
});

test('backup feed honors next-page links only from matching public catalog route', () => {
  const cards = card('one-1', 'One');
  assert.equal(parseProviderFeed(page('new', cards, '<a class="page-link" href="https://evil.example/recently-updated?page=2">Next</a>'), 'new', 1).hasNextPage, false);
  assert.equal(parseProviderFeed(page('new', cards, '<a class="page-link" href="/most-popular?page=2">Next</a>'), 'new', 1).hasNextPage, false);
  assert.equal(parseProviderFeed(page('new', cards, '<a class="page-link" href="/recently-updated?page=2">Next</a>'), 'new', 1).hasNextPage, true);
  assert.throws(() => parseProviderFeed('<h2>Access check</h2>', 'new', 1), /unavailable/);
});

test('backup feeds use distinct verified routes, coalesce requests and cache results', async () => {
  const urls = [], discovery = new ProviderDiscovery({ fetch: async url => { urls.push(url); await new Promise(resolve => setTimeout(resolve, 5)); return new Response(page(url.includes('recently-updated') ? 'new' : 'recommended', card('one-1', 'One'))); } });
  const [first, second] = await Promise.all([discovery.feed('new', 1), discovery.feed('new', 1)]);
  assert.deepEqual(first, second);
  await discovery.feed('new', 1); await discovery.feed('recommended', 2);
  assert.deepEqual(urls, ['https://hianime.at/recently-updated?page=1', 'https://hianime.at/most-popular?page=2']);
  assert.match(first.description, /source updates rather than original broadcast dates/);
  await assert.rejects(() => discovery.feed('invalid', 1), error => error.status === 400);
  await assert.rejects(() => discovery.feed('new', -1), error => error.status === 400);
});

test('stale backup feed is explicit and cold failures do not manufacture results', async () => {
  let now = 0, broken = false;
  const discovery = new ProviderDiscovery({ now: () => now, ttl: 10, fetch: async () => { if (broken) throw new Error('offline'); return new Response(page('new', card('one-1', 'One'))); } });
  await discovery.feed('new', 1); now = 20; broken = true;
  assert.equal((await discovery.feed('new', 1)).stale, true);
  await assert.rejects(() => discovery.feed('new', 2), error => error.status === 503);
});
test('feed shares alias-aware season grouping and does not strip bare-number titles blindly', () => {
  const base=card('hero-1','My Hero Academia').replace('data-jname="Japanese title"','data-jname="Boku no Hero Academia"');
  const season=card('hero-season-2','My Hero Academia 2').replace('data-jname="Japanese title"','data-jname="Boku no Hero Academia 2nd Season"');
  const data=parseProviderFeed(page('recommended',base+season+card('other-3','Other')+card('other-two-4','Other 2')),'recommended',1);
  assert.deepEqual(data.results.map(row=>row.title),['My Hero Academia','Other','Other 2']);
  assert.equal(data.results[0].seasons,undefined);assert.equal(data.results[0].provider,undefined);
});
