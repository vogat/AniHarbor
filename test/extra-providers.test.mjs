import test from 'node:test';
import assert from 'node:assert/strict';
import { AniZoneProvider, parsePageJSON } from '../server/extra-providers.mjs';

function embedded(value, player = false) {
  const json = JSON.stringify(value).replace(/"/g, '\\u0022');
  return player ? `vidstackPlayer(JSON.parse('${json}'))` : `items: JSON.parse('${json}')`;
}

test('AniZone parses inert Unicode JSON and rejects executable or missing data', () => {
  assert.deepEqual(parsePageJSON(embedded([{ title: '火影忍者' }])), [{ title: '火影忍者' }]);
  const escaped = String.raw`items: JSON.parse('[{\u0022title\u0022:\u0022\\u706b\\u5f71\u0022}]')`;
  assert.deepEqual(parsePageJSON(escaped), [{ title: '火影' }]);
  assert.throws(() => parsePageJSON("items: JSON.parse(alert('bad'))"), /payload missing/);
});

test('AniZone preserves provider IDs and excludes episodes without video', async () => {
  const http = { post() {}, async get(url) {
    if (url.includes('?search=')) return new Response(embedded([{ slug: 'naruto', main_title: 'Naruto', start_year: 2002 }]));
    return new Response(embedded([{ slug: '2', title_list: { 1: 'Second' }, videos_count: 1 }, { slug: '1', videos_count: 0 }]));
  } };
  const adapter = new AniZoneProvider(http);
  const results = await adapter.search('Naruto');
  assert.equal(results[0].id, 'anizone:naruto');
  assert.equal(results[0].year, 2002);
  assert.deepEqual(await adapter.fetchContentUnits(results[0].id), [{ id: 'anizone:naruto:2', number: 2, title: 'Second', availableLanguages: ['sub'] }]);
  await assert.rejects(adapter.fetchContentUnits('anizone:../../admin'), /Invalid/);
});

test('AniZone errors on incomplete episode pagination instead of hiding the failure', async () => {
  const adapter = new AniZoneProvider({ post() {}, async get() { return new Response(embedded([]) + 'hasMore: true'); } });
  await assert.rejects(adapter.fetchContentUnits('anizone:series'), /continuation metadata/);
});

test('AniZone follows episode continuation and passes cancellation to HTTP requests', async () => {
  const signal = new AbortController().signal;
  let posts = 0;
  const adapter = new AniZoneProvider({
    async get(url, options) {
      assert.equal(options.signal, signal);
      return new Response(embedded([{ slug: '1', videos_count: 1 }]) +
        `hasMore: true, nextCursor: 'cursor-1', <meta name="csrf-token" content="csrf"><div wire:snapshot="{&quot;name&quot;:&quot;pages.anime-detail&quot;}">`);
    },
    async post(url, body, options) {
      posts++;
      assert.equal(options.signal, signal);
      assert.equal(body.components[0].calls[0].params[0], 'cursor-1');
      return Response.json({ components: [{ snapshot: '{}', effects: { dispatches: [{ name: 'items-loaded', params: { items: [{ slug: '2', videos_count: 1 }], hasMore: false } }] } }] });
    }
  });
  const episodes = await adapter.fetchContentUnits('anizone:series', { signal });
  assert.equal(posts, 1);
  assert.deepEqual(episodes.map(item => item.number), [1, 2]);
});

test('AniZone normalizes HLS/SRT descriptors and rejects dub or iframe responses', async () => {
  const adapter = new AniZoneProvider({ post() {}, async get() { return new Response(embedded({ src: 'https://video.example/master.m3u8', subtitles: [{ file: 'https://video.example/en.srt', title: 'English', language: 'en', format: 'srt' }] }, true)); } });
  const result = await adapter.resolveStream('anizone:series:1', 'sub');
  assert.equal(result.streams[0].isHLS, true);
  assert.equal(result.streams[0].subtitles[0].format, 'srt');
  await assert.rejects(adapter.resolveStream('anizone:series:1', 'dub'), /only supports/);
  adapter.http.get = async () => new Response(embedded({ src: 'https://video.example/embed/1' }, true));
  await assert.rejects(adapter.resolveStream('anizone:series:1', 'sub'), /HLS/);
});
