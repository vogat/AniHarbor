import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { Artwork, findArtwork } from '../server/artwork.mjs';
const jpg=Buffer.from([255,216,255,224,0,0,0,0]);
const secret='test-persistent-secret';

test('poster URLs survive restarts and media-grant expiry; forged URLs never reach transport',async()=>{
 let calls=0;const transport={fetch:async()=>{calls++;return new Response(jpg,{headers:{'Content-Type':'image/jpeg'}});}};
 const before=new Artwork({secret,transport}),path=before.grant('https://images.example/naruto.jpg');
 const after=new Artwork({secret,transport,now:()=>Date.now()+30*86400000});
 assert.deepEqual((await after.load(path.slice(9))).bytes,jpg);
 await assert.rejects(after.load(path.slice(9).replace(/.$/,'x')),/Invalid/);
 await assert.rejects(new Artwork({secret:'different-secret',transport}).load(path.slice(9)),/Invalid/);assert.equal(calls,1);
});
test('posters coalesce fetches, serve cached art through an outage, and reject non-image payloads',async()=>{
 let now=0,calls=0,fail=false;const art=new Artwork({secret,now:()=>now,transport:{fetch:async()=>{calls++;if(fail)throw Error('offline');return new Response(jpg);}}});
 const id=art.grant('https://images.example/a.jpg').slice(9);
 await Promise.all([art.load(id),art.load(id)]);assert.equal(calls,1);now+=7*3600000;fail=true;assert.deepEqual((await art.load(id)).bytes,jpg);
 const bad=new Artwork({secret,transport:{fetch:async()=>new Response('<html>not an image</html>',{headers:{'Content-Type':'image/jpeg'}})}});
 await assert.rejects(bad.load(id),/did not return an image/);
});
test('legacy artwork lookup uses exact identity and year instead of another season or remake',async()=>{
 const catalog={search:async()=>({results:[{provider:'p',id:'second',title:'Naruto Season 2',image:'https://img/wrong'},{provider:'p',id:'first',title:'Naruto',year:2002,image:'https://img/right'}]})};
 assert.deepEqual(await findArtwork(catalog,{}, {}, {title:'Naruto',provider:'p',id:'first'}),{image:'https://img/right'});
 await assert.rejects(findArtwork(catalog,{searchMetadata:async()=>[]},{},{title:'Naruto',year:'2030'}),/unavailable/);
});
test('saved artwork repair preserves resume positions and avoids other years/kinds; durable links rebase to current server',async()=>{
 const context={module:{exports:{}}};vm.runInNewContext(await readFile(new URL('../tv/posters.js',import.meta.url),'utf8'),context);const poster=context.module.exports;
 const target={title:'Naruto',year:2002,kind:'series'},store={a:{show:{...target,image:'http://old/media/expired'},series:{title:'Naruto',image:'http://old/media/expired'},position:133,episode:{number:1},updated:123},b:{show:{title:'Naruto',year:2030,kind:'series',image:'keep'},position:22}};
 const path=new Artwork({secret}).grant('https://images.example/naruto.jpg'),url='http://old:8787'+path;
 assert.equal(poster.repair(store,target,url),true);assert.equal(store.a.position,133);assert.equal(store.a.episode.number,1);assert.equal(store.a.updated,123);assert.equal(store.a.show.image,url);assert.equal(store.a.series.image,url);assert.equal(store.b.show.image,'keep');assert.equal(store.b.position,22);
 assert.equal(poster.same(target,{title:'Naruto',year:2002,kind:'movie'}),false);
 assert.equal(poster.rebase(url,'http://new:8787'), 'http://new:8787'+path);assert.equal(poster.durable(url),true);assert.equal(poster.durable('http://old/media/expired'),false);
});
