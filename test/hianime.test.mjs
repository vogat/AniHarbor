import test from 'node:test';
import assert from 'node:assert/strict';
import { HianimeProvider } from '../server/hianime.mjs';

function encodeConfig(config) {
  const bytes = Buffer.from(JSON.stringify(config)), key = Buffer.from('otaku-embed-v1');
  for (let i = 0; i < bytes.length; i++) bytes[i] ^= key[i % key.length];
  return 'window.__P="' + bytes.toString('base64') + '";';
}
function fakeHttp(routes) {
  return { async get(url) { assert.ok(url in routes, 'Unexpected request: ' + url); const body = routes[url]; return new Response(typeof body === 'string' ? body : JSON.stringify(body)); } };
}
const card = (slug, title) => `<div class="flw-item flw-item-big"><img src="https://img.example/a.jpg"><h3 class="film-name"><a href="/${slug}" title="${title}">${title}</a></h3></div>`;

test('HiAnime excludes sidebar results and deduplicates matching series', async () => {
  const p = new HianimeProvider(fakeHttp({ 'https://hianime.at/search?keyword=A%26B': card('a-1', 'A &amp; B') + card('a-1', 'duplicate') + '<div id="main-sidebar">' + card('other-2', 'Other') }));
  assert.deepEqual((await p.search('A&B')).map(x => [x.id, x.title]), [['hianime:a-1', 'A & B']]);
});

test('HiAnime retains explicit movie classification and Japanese alias', async () => {
  const html = '<div class="flw-item"><h3 class="film-name"><a href="/harbor-film-2" title="Harbor: The Finale" data-jname="港の映画">Harbor: The Finale</a></h3><div class="fd-infor"><span class="fdi-item">MOVIE</span><span class="fdi-item fdi-duration">120m</span></div></div>';
  const p = new HianimeProvider(fakeHttp({ 'https://hianime.at/search?keyword=Harbor': html }));
  const [movie] = await p.search('Harbor');
  assert.equal(movie.mediaType, 'MOVIE');
  assert.deepEqual(movie.aliases, ['港の映画']);
});

test('HiAnime rejects unrelated episode slugs and malformed IDs', async () => {
  const item = (slug, id, number) => `<a class="ssl-item ep-item" data-number="${number}" data-id="${id}" href="/watch/${slug}?ep=${id}" title="Episode ${number}">`;
  const p = new HianimeProvider(fakeHttp({ 'https://hianime.at/api/theme/episode/list/1': { status: true, html: item('a-1', '11', '1') + item('a-1', '11', '1') + item('other-2', '22', '2') } }));
  assert.deepEqual((await p.fetchContentUnits('hianime:a-1')).map(x => x.id), ['hianime:a-1/11']);
  await assert.rejects(() => p.fetchContentUnits('https://localhost/1'), /Invalid/);
});

test('HiAnime selects only requested ZokoAnime audio, excluding MegaPlay', async () => {
  const server = (name, language, url) => `<div class="server-item" data-type="${language}" data-server-name="${name}" data-hash="${Buffer.from(url).toString('base64')}">`;
  const p = new HianimeProvider(fakeHttp({
    'https://hianime.at/api/theme/episode/servers?episodeId=11': { status: true, html: server('HD-1', 'dub', 'https://megaplay.buzz/stream/11/dub') + server('ZokoAnime', 'dub', 'https://zokoanime.video/stream/mal/20/1/dub') },
    'https://zokoanime.video/stream/mal/20/1/dub': encodeConfig({ src: 'https://media.example/master.m3u8', subtitles: [{ src: 'https://media.example/en.vtt', lang: 'en', label: 'English' }] })
  }));
  const result = await p.resolveStream('hianime:a-1/11', 'dub');
  assert.equal(result.streams[0].language, 'dub');
  assert.equal(result.streams[0].headers.Referer, 'https://zokoanime.video/');
  assert.equal(result.streams[0].subtitles[0].format, 'vtt');
  await assert.rejects(() => p.resolveStream('hianime:a-1/11', 'sub'), /no source/);
});

test('HiAnime rejects player configuration without HLS', async () => {
  const url = 'https://zokoanime.video/stream/mal/20/1/sub';
  const p = new HianimeProvider(fakeHttp({
    'https://hianime.at/api/theme/episode/servers?episodeId=11': { status: true, html: `<div data-type="sub" data-server-name="ZokoAnime" data-hash="${Buffer.from(url).toString('base64')}">` },
    [url]: encodeConfig({ src: 'javascript:alert(1)' })
  }));
  await assert.rejects(() => p.resolveStream('hianime:a-1/11', 'sub'), /no HLS/);
});
