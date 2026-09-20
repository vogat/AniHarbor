import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isPublicAddress, rewriteManifest, Relay } from '../server/relay.mjs';

test('relay rejects local, mapped, multicast and nonroutable addresses', () => {
  for (const ip of ['127.0.0.1','10.0.0.1','192.168.1.2','169.254.169.254','172.16.3.2','100.64.2.1','::1','::ffff:127.0.0.1','fd00::1','fe80::2','2001:db8::1']) assert.equal(isPublicAddress(ip), false, ip);
  assert.equal(isPublicAddress('8.8.8.8'), true); assert.equal(isPublicAddress('2606:4700:4700::1111'), true);
});
test('HLS relay rewrites child playlists, keys and relative segments', () => {
  const r = rewriteManifest('#EXTM3U\n#EXT-X-KEY:METHOD=AES-128,URI="key.bin"\nsub/720.m3u8\n../seg.ts\n', 'https://video.example/show/master.m3u8', u => 'relay:' + u);
  assert.match(r, /URI="relay:https:\/\/video.example\/show\/key.bin"/);
  assert.match(r, /relay:https:\/\/video.example\/show\/sub\/720.m3u8/);
  assert.match(r, /relay:https:\/\/video.example\/seg.ts/);
});
test('opaque grant expires and strips request secrets', async () => {
  let now = 0;
  const relay = new Relay({now: () => now});
  const path = relay.grant('https://video.example/file.mp4', {Cookie:'secret',Referer:'https://source.example'});
  assert.ok(!path.includes('video.example'));
  const item = [...relay.grants.values()][0]; assert.equal(item.headers.Cookie, undefined); assert.equal(item.headers.Referer, 'https://source.example');
  now = 4 * 3600000;
  await assert.rejects(relay.serve({}, {}, path.slice(7), 'http://localhost'), /expired/);
});
