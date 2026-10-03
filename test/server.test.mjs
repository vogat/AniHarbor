import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { makeServer } from '../server/index.mjs';

test('HTTP app requires pairing, serves interface, and never serves project secrets', async t => {
  const server = makeServer({token:'test-token-only',catalog:{list:()=>[{id:'fixture',family:'fixture'}]}});
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}`;
  const publicHealth = await fetch(base + '/api/health'); assert.equal(publicHealth.status,200);
  const refused = await fetch(base + '/api/providers'); assert.equal(refused.status,401);
  const paired = await fetch(base + '/api/providers',{headers:{'x-app-token':'test-token-only'}}); assert.equal(paired.status,200); assert.equal((await paired.json()).providers[0].id,'fixture');
  const page = await fetch(base); assert.match(await page.text(), /AniHarbor/);
  for (const route of ['/.data/pairing-token','/server/index.mjs','/package.json','/assets/../../.data/pairing-token']) assert.equal((await fetch(base+route)).status,404);
  const badMethod = await fetch(base+'/api/providers',{method:'POST'}); assert.equal(badMethod.status,405);
});

test('grouped search, discovery pagination and show details are paired and relay posters without mutating cached selections', async t => {
  const raw={id:'provider:season',provider:'fixture',title:'Example Season 2',image:'https://images.example/poster.jpg',languages:['sub']};
  const show={id:'series:example',title:'Example',kind:'series',image:raw.image,seasons:[{id:'season:2',label:'Season 2',providers:[raw]}]};
  const calls=[];
  const discovery={
    search:async(catalog,q,provider)=>{calls.push(['search',q,provider]);return {results:[show],errors:[]};},
    feed:async(section,page)=>{calls.push(['feed',section,page]);return {results:[{id:'discover:1',title:'Example',image:raw.image}],page:Number(page),hasNextPage:true};},
    show:async(catalog,args)=>{calls.push(['show',args.title,args.malId]);return {show,errors:[]};}
  };
  const relay={grant:(url,headers,kind)=>{assert.equal(url,raw.image);assert.equal(kind,'image');return '/media/fixture-poster';}};
  const server=makeServer({token:'test-token-only',catalog:{},discovery,relay,artwork:{grant:url=>relay.grant(url,{},'image')}});server.listen(0,'127.0.0.1');await once(server,'listening');t.after(()=>server.close());
  const base=`http://127.0.0.1:${server.address().port}`,headers={'x-app-token':'test-token-only'};
  for(const route of ['/api/search?q=Example','/api/discover?section=new&page=2','/api/show?title=Example&malId=1']) assert.equal((await fetch(base+route)).status,401);
  const search=await (await fetch(base+'/api/search?q=Example&provider=auto',{headers})).json();
  assert.equal(search.results.length,1);assert.equal(search.results[0].seasons[0].providers[0].id,'provider:season');assert.equal(search.results[0].seasons[0].providers[0].image,base+'/media/fixture-poster');
  const feed=await (await fetch(base+'/api/discover?section=new&page=2',{headers})).json();assert.equal(feed.page,2);assert.equal(feed.hasNextPage,true);
  const detail=await (await fetch(base+'/api/show?title=Example&malId=1',{headers})).json();assert.equal(detail.show.title,'Example');
  assert.deepEqual(calls,[['search','Example','auto'],['feed','new','2'],['show','Example','1']]);assert.equal(show.image,'https://images.example/poster.jpg');assert.equal(raw.image,'https://images.example/poster.jpg');
});
test('library browsing, file selection and playback require pairing and hide upstream URLs',async t=>{
 const calls=[];const library={browse:async()=>({results:[{id:'live:test',title:'Test',kind:'live'}]}),item:async id=>({episodes:[{id:'part1',number:1,title:'Episode 1'}]}),resolve:async(id,file)=>{calls.push([id,file]);return {provider:'Test',live:true,streams:[{sourceUrl:'https://media.example/master.m3u8',isHLS:true}]};}};
 const server=makeServer({token:'test-token-only',catalog:{},library,relay:{grant:()=>'/media/opaque.m3u8'}});server.listen(0,'127.0.0.1');await once(server,'listening');t.after(()=>server.close());const base=`http://127.0.0.1:${server.address().port}`,headers={'x-app-token':'test-token-only'};
 for(const route of ['/api/library','/api/library/item?id=archive:test','/api/library/resolve?id=live:test'])assert.equal((await fetch(base+route)).status,401);
 const list=await(await fetch(base+'/api/library?section=sports',{headers})).json();assert.equal(list.results[0].title,'Test');
 const result=await(await fetch(base+'/api/library/resolve?id=live:test&file=part1',{headers})).json();assert.equal(result.live,true);assert.equal(result.sources[0].url,base+'/media/opaque.m3u8');assert.deepEqual(calls,[['live:test','part1']]);
});
test('sports and personalized home endpoints require pairing and refresh nested history posters',async t=>{
 const server=makeServer({token:'test-token-only',catalog:{},sports:{browse:async args=>({rows:[],date:args.date})},library:{home:async ids=>({history:[{item:{image:'https://archive.org/services/img/film'}}]})},relay:{grant:()=>'/media/fresh-poster'},artwork:{grant:()=>'/media/fresh-poster'}});
 server.listen(0,'127.0.0.1');await once(server,'listening');t.after(()=>server.close());const base=`http://127.0.0.1:${server.address().port}`,headers={'x-app-token':'test-token-only'};
 for(const route of ['/api/sports','/api/library/home'])assert.equal((await fetch(base+route)).status,401);
 const games=await(await fetch(base+'/api/sports?date=20260929',{headers})).json();assert.equal(games.date,'20260929');
 const home=await(await fetch(base+'/api/library/home',{headers})).json();assert.equal(home.history[0].item.image,base+'/media/fresh-poster');assert.equal((await fetch(base+'/media-history.js')).status,200);
});
test('game source and resolve endpoints require pairing and pass renewable opaque media grants',async t=>{
 const renew=async()=> 'https://video.example/live.m3u8?fresh';const calls=[];
 const sports={sources:async args=>{calls.push(args);return {sources:[{id:'center:1',name:'Center'}]};},resolve:async args=>{calls.push(args);return {provider:'Center',sourceId:'center:1',live:true,streams:[{sourceUrl:'https://video.example/live.m3u8?private',isHLS:true,refresh:renew}]};}};
 const server=makeServer({token:'test-token-only',catalog:{},sports,relay:{grant:(url,headers,kind,refresh)=>{assert.equal(kind,'hls');assert.equal(refresh,renew);return '/media/renewable.m3u8';}}});
 server.listen(0,'127.0.0.1');await once(server,'listening');t.after(()=>server.close());const base=`http://127.0.0.1:${server.address().port}`,headers={'x-app-token':'test-token-only'};
 for(const route of ['/api/sports/sources?id=wnba:1','/api/sports/resolve?id=wnba:1'])assert.equal((await fetch(base+route)).status,401);
 const source=await(await fetch(base+'/api/sports/sources?id=wnba:1&date=20260929',{headers})).json();assert.equal(source.sources[0].id,'center:1');
 const result=await(await fetch(base+'/api/sports/resolve?id=wnba:1&source=auto&exclude=matchora:1',{headers})).json();assert.equal(result.sourceId,'center:1');assert.equal(result.sources[0].url,base+'/media/renewable.m3u8');assert.ok(!JSON.stringify(result).includes('private'));assert.deepEqual(calls[1],{id:'wnba:1',source:'auto',exclude:'matchora:1'});
});
test('paired artwork repair returns a durable image link that works on a new server instance',async t=>{
 const {Artwork}=await import('../server/artwork.mjs');const token='test-token-only';let calls=0;
 const catalog={search:async()=>({results:[{provider:'p',id:'naruto',title:'Naruto',image:'https://images.example/naruto.jpg'}]})};
 const artifact=()=>new Artwork({secret:token,transport:{fetch:async()=>{calls++;return new Response(Buffer.from([255,216,255,224,0,0,0,0]));}}});
 const first=makeServer({token,catalog,artwork:artifact()});first.listen(0,'127.0.0.1');await once(first,'listening');t.after(()=>first.close());const base=`http://127.0.0.1:${first.address().port}`;
 assert.equal((await fetch(base+'/api/artwork?title=Naruto')).status,401);
 const data=await(await fetch(base+'/api/artwork?title=Naruto&provider=p&id=naruto',{headers:{'x-app-token':token}})).json();assert.ok(data.image.includes('/artwork/'));const path=new URL(data.image).pathname;
 const second=makeServer({token,catalog,artwork:artifact()});second.listen(0,'127.0.0.1');await once(second,'listening');t.after(()=>second.close());const next=`http://127.0.0.1:${second.address().port}`;
 const image=await fetch(next+path);assert.equal(image.status,200);assert.equal(image.headers.get('content-type'),'image/jpeg');assert.equal((await image.arrayBuffer()).byteLength,8);
 assert.equal((await fetch(next+path+'x')).status,403);assert.equal(calls,1);assert.equal((await fetch(next+'/posters.js')).status,200);
});
