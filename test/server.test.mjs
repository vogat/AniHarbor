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
  const server=makeServer({token:'test-token-only',catalog:{},discovery,relay});server.listen(0,'127.0.0.1');await once(server,'listening');t.after(()=>server.close());
  const base=`http://127.0.0.1:${server.address().port}`,headers={'x-app-token':'test-token-only'};
  for(const route of ['/api/search?q=Example','/api/discover?section=new&page=2','/api/show?title=Example&malId=1']) assert.equal((await fetch(base+route)).status,401);
  const search=await (await fetch(base+'/api/search?q=Example&provider=auto',{headers})).json();
  assert.equal(search.results.length,1);assert.equal(search.results[0].seasons[0].providers[0].id,'provider:season');assert.equal(search.results[0].seasons[0].providers[0].image,base+'/media/fixture-poster');
  const feed=await (await fetch(base+'/api/discover?section=new&page=2',{headers})).json();assert.equal(feed.page,2);assert.equal(feed.hasNextPage,true);
  const detail=await (await fetch(base+'/api/show?title=Example&malId=1',{headers})).json();assert.equal(detail.show.title,'Example');
  assert.deepEqual(calls,[['search','Example','auto'],['feed','new','2'],['show','Example','1']]);assert.equal(show.image,'https://images.example/poster.jpg');assert.equal(raw.image,'https://images.example/poster.jpg');
});
