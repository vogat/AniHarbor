import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable, Writable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createCipheriv } from 'node:crypto';
import { transportStreamStripper, Relay } from '../server/relay.mjs';
import { decodeMegaValue, megaSegmentURL, resolveMega } from '../server/megaplay.mjs';
import { HianimeProvider } from '../server/hianime.mjs';
const encode = value => { const key = Buffer.alloc(32); Buffer.from('i?LMTAx0Q6,:}50U').copy(key); const c = createCipheriv('aes-256-cbc', key, Buffer.from("W0;27ToaUpl_P%'c")); return Buffer.concat([c.update(value), c.final()]).toString('base64url'); };
const ts = Buffer.alloc(188 * 4); for (let i = 0; i < ts.length; i += 188) ts[i] = 71;
async function strip(parts) { const chunks = []; await pipeline(Readable.from(parts), transportStreamStripper(), new Writable({write(c,e,cb){chunks.push(c);cb();}})); return Buffer.concat(chunks); }
test('relay strips only validated TS prefixes and tolerates arbitrary chunk boundaries', async () => {
  const bytes = Buffer.concat([Buffer.from('image wrapper'), ts]);
  assert.deepEqual(await strip([bytes.subarray(0, 15), bytes.subarray(15, 190), bytes.subarray(190)]), ts);
  assert.deepEqual(await strip([ts]), ts);
  await assert.rejects(strip([Buffer.from('<html>host failure</html>')]), /transport stream/);
  await assert.rejects(strip([Buffer.alloc(70000)]), /transport stream/);
});
test('valid video labelled HTML is relayed as MPEG-TS, not rejected as a web page', async () => {
  const relay = new Relay({request:async()=>({url:'https://media.example/1',response:Object.assign(Readable.from([ts]),{statusCode:200,headers:{'content-type':'text/html','content-length':String(ts.length)}})})});
  const path = relay.grant('https://media.example/1',{},'segment');const chunks=[];
  const res = new Writable({write(c,e,cb){chunks.push(c);cb();}});res.writeHead=(status,headers)=>{assert.equal(status,200);assert.equal(headers['Content-Type'],'video/mp2t');assert.equal(headers['content-length'],undefined);};
  await relay.serve({headers:{}},res,path.slice(7),'http://localhost');assert.deepEqual(Buffer.concat(chunks),ts);
});
test('MegaPlay decodes public URL configuration and rejects executable or malformed segment URLs', () => {
  const url='https://cdn.example/a.ts';assert.equal(megaSegmentURL('https://cdn.example/segment/'+encode(url)),url);
  assert.equal(decodeMegaValue(encode('{"file":"https://cdn.example/master.m3u8"}')), '{"file":"https://cdn.example/master.m3u8"}');
  assert.throws(()=>megaSegmentURL('https://cdn.example/segment/'+encode('javascript:alert(1)')),/Invalid/);
  assert.throws(()=>decodeMegaValue('not valid'),/Invalid/);
});
test('HiAnime selects current MegaPlay server for the requested audio and includes captions', async () => {
  const embed='https://megaplay.buzz/stream/s-2/12352/dub';
  const http={get:async(url,options)=>{
    if(url.includes('servers?'))return Response.json({status:true,html:'<div data-type="dub" data-server-name="Vidstream-2" data-hash="'+Buffer.from(embed).toString('base64')+'">'});
    if(url===embed){assert.ok(options.headers.Referer);return new Response('<div data-id="104103">');}
    assert.equal(url,'https://megaplay.buzz/stream/getSources?id=104103');assert.equal(options.headers.Referer,embed);
    return Response.json({enc:encode(JSON.stringify({file:'https://cdn.example/master.m3u8'})),tracks:[{kind:'captions',file:'https://cdn.example/en.vtt',label:'English'}]});
  }};
  const result=await new HianimeProvider(http).resolveStream('hianime:naruto-1335/22676','dub');assert.equal(result.streams[0].language,'dub');assert.equal(result.streams[0].subtitles[0].language,'en');
  await assert.rejects(resolveMega(http,'https://localhost/stream/s-2/1/sub','sub'),/Invalid/);
});

test('MegaPlay distinguishes a missing mapping from a failed or changed player', async () => {
  const embed = 'https://megaplay.buzz/stream/ani/995/1/sub';
  for (const page of [new Response('<title>Error - MegaPlay</title>'),new Response('Not found',{status:404})]) {
    await assert.rejects(resolveMega({get:async()=>page},embed,'sub'), e => e.details?.code === 'EPISODE_UNAVAILABLE');
  }
  for (const page of [new Response('Unavailable',{status:503}),new Response('<title>New player</title>')]) {
    await assert.rejects(resolveMega({get:async()=>page},embed,'sub'), e => !e.details?.code && /configuration/.test(e.message));
  }
});
