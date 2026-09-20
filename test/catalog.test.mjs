import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Catalog, titleKey } from '../server/catalog.mjs';

const video = { type: 'video', streams: [{ sourceUrl: 'https://video.example/one.m3u8', isHLS: true }] };
function provider(id, family = id, overrides = {}) {
  return { id, name: id, family, languages: ['sub', 'dub'], adapter: {
    async search() { return [{ id: id + ':series', title: 'Example Season 2', catalogType: 'ANIME', year: 2020 }]; },
    async fetchContentUnits() { return [{ id: id + ':ep3', number: 3, title: 'Episode 3', availableLanguages: ['sub'] }]; },
    async resolveStream() { return video; }, ...overrides
  } };
}
const input = { provider: 'first', id: 'first:series', episodeId: 'first:ep3', number: 3, title: 'Example Season 2', year: 2020, language: 'sub' };

test('automatic search preserves results when an independent source fails', async () => {
  const c = new Catalog([provider('first', 'first', { search: async () => { throw new Error('down'); } }), provider('backup')]);
  const r = await c.search('Example');
  assert.equal(r.results[0].provider, 'backup'); assert.equal(r.errors.length, 1);
});
test('failure falls back to exact matching episode in an independent family', async () => {
  let duplicateCalls = 0;
  const c = new Catalog([provider('first', 'shared', { resolveStream: async () => { throw new Error('down'); } }), provider('alias', 'shared', { search: async () => { duplicateCalls++; return []; } }), provider('backup')]);
  const r = await c.resolve(input);
  assert.equal(r.provider, 'backup'); assert.equal(duplicateCalls, 0);
});
test('does not silently switch season, year, episode or audio', async () => {
  for (const override of [
    { search: async () => [{ id: 'other:s', title: 'Example Season 3', year: 2020 }] },
    { search: async () => [{ id: 'other:s', title: 'Example Season 2', year: 2019 }] },
    { fetchContentUnits: async () => [{ id: 'other:ep4', number: 4, availableLanguages: ['sub'] }] },
    { fetchContentUnits: async () => [{ id: 'other:ep3', number: 3, availableLanguages: ['dub'] }] }
  ]) {
    const c = new Catalog([provider('first', 'first', { resolveStream: async () => { throw new Error('down'); } }), provider('other', 'other', override)]);
    await assert.rejects(c.resolve(input), /No matching source/);
  }
});
test('ambiguous duplicate title is not automatically selected', async () => {
  const c = new Catalog([provider('first'), provider('other', 'other', { search: async () => [{id:'a',title:input.title}, {id:'b',title:input.title}] })]);
  await assert.rejects(c.resolve({...input, exclude:'first'}), /No matching source/);
});
test('timeout imposes cooldown and prevents repeated upstream calls', async () => {
  let calls = 0, now = 0;
  const c = new Catalog([provider('first', 'f', { search: () => { calls++; return new Promise(() => {}); } })], { timeout: 10, cooldown: 100, now: () => now });
  await c.search('Example', 'first'); await c.search('Example', 'first');
  assert.equal(calls, 1); assert.equal(c.list()[0].status, 'cooldown');
  now = 110; await c.search('Example', 'first'); assert.equal(calls, 2);
});
test('search requests coalesce and cache while stream links are fresh', async () => {
  let calls = 0;
  const c = new Catalog([provider('first', 'f', { search: async () => { calls++; return []; } })]);
  await Promise.all([c.search('Example'), c.search('Example')]); await c.search('Example'); assert.equal(calls, 1);
  assert.notEqual(titleKey('Example Season 2'), titleKey('Example Season 3'));
});
test('Portuguese manual source never falls back to English dub', async () => {
  let calls = 0;
  const manual = provider('first', 'pt', { fetchContentUnits: async () => [{id:'first:ep3',number:3,availableLanguages:['dub']}], resolveStream: async () => { throw new Error('down'); } });
  manual.manual = true;
  const c = new Catalog([manual, provider('other', 'english', { search: async () => { calls++; return []; } })]);
  await assert.rejects(c.resolve({...input,language:'dub'}), /No matching source/); assert.equal(calls, 0);
});
