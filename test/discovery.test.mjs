import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Discovery } from '../server/discovery.mjs';
const entry = (id,title='Show '+id,extra={}) => ({mal_id:id,title,type:'TV',year:2020,images:{jpg:{image_url:'https://example.org/'+id+'.jpg'}},...extra});
const response = data => new Response(JSON.stringify(data), {headers:{'content-type':'application/json'}});

test('recommended pages use actual popularity metadata and cache concurrent requests', async () => {
  const urls=[];
  const discovery=new Discovery({fallback:null,spacing:0,fetch:async url=>{urls.push(url);return response({data:[entry(1),entry(2,'Show 1 Season 2')],pagination:{has_next_page:true}});}});
  const [a,b]=await Promise.all([discovery.feed('recommended',2),discovery.feed('recommended',2)]);
  assert.equal(urls.length,1);assert.match(urls[0],/filter=bypopularity.*page=2/);assert.equal(a.page,2);assert.equal(a.hasNextPage,true);assert.equal(a.results.length,1);assert.deepEqual(a,b);assert.match(a.description,/not personalized/);
  await assert.rejects(discovery.feed('recommended',0.5),/page/);await assert.rejects(discovery.feed('unknown',1),/Unknown/);
});
test('new feed is ordered recent episodes, deduplicated and truly paginated',async()=>{
  const data=Array.from({length:51},(_,i)=>({entry:entry(i+1),episodes:[{title:'Episode '+i}]}));
  data.splice(1,0,data[0]);
  const discovery=new Discovery({fallback:null,spacing:0,fetch:async url=>{assert.match(url,/\/watch\/episodes$/);return response({data});}});
  const first=await discovery.feed('new',1), second=await discovery.feed('new',2),last=await discovery.feed('new',3);
  assert.equal(first.results.length,24);assert.equal(second.results[0].malId,25);assert.equal(last.results.length,3);assert.equal(last.hasNextPage,false);assert.equal(first.results[0].latestEpisode,'Episode 0');
});
test('metadata outage never prevents grouped provider search',async()=>{
  const discovery=new Discovery({fallback:null,spacing:0,fetch:async()=>{throw new Error('offline');}});
  const data=await discovery.search({search:async()=>({results:[{id:'a',provider:'a',title:'Example'},{id:'b',provider:'b',title:'Example'}],errors:[]})},'Example');
  assert.equal(data.results.length,1);assert.equal(data.results[0].seasons[0].providers.length,2);
  await assert.rejects(discovery.feed('new'),/temporarily unavailable/);
});
test('verified TV sequels are discovered through but never include films or spinoffs',async()=>{
  const link=(relation,id)=>({relation,entry:[{mal_id:id,type:'anime'}]});
  const all={1:entry(1,'First',{aired:{from:'2020-01-01'},relations:[link('Sequel',2),link('Side story',4)]}),2:entry(2,'Film',{type:'Movie',relations:[link('Sequel',3)]}),3:entry(3,'Return',{aired:{from:'2022-01-01'},relations:[]})};
  const requested=[];
  const discovery=new Discovery({fallback:null,spacing:0,fetch:async url=>{const id=Number(url.match(/anime\/(\d+)/)[1]);requested.push(id);return response({data:all[id]});}});
  const family=await discovery.family(1);assert.deepEqual(family.map(m=>m.mal_id),[1,3]);assert.deepEqual(requested,[1,2,3]);assert.equal(discovery.metadata.get(3)._seriesId,1);
});
test('show lookup preserves source selections and uses metadata aliases without adding unrelated results',async()=>{
  const meta=entry(1,'Japanese',{title_english:'English',relations:[]});
  const discovery=new Discovery({fallback:null,spacing:0,fetch:async()=>response({data:meta})});
  const catalog={search:async()=>({results:[{id:'a',provider:'a',title:'Japanese'},{id:'b',provider:'b',title:'English'},{id:'c',provider:'c',title:'Unrelated'}],errors:[]})};
  const result=await discovery.show(catalog,{title:'English',malId:'1'});
  assert.equal(result.show.title,'English');assert.equal(result.show.seasons.length,1);assert.equal(result.show.seasons[0].providers.length,2);
});
test('metadata outage uses independent provider discovery and cooldown instead of hammering the failed API',async()=>{
  let calls=0;const requests=[];
  const discovery=new Discovery({spacing:0,fetch:async()=>{calls++;throw new Error('upstream failure');},fallback:{feed:async(section,page)=>{requests.push([section,page]);return {results:[{id:'fallback',title:'Real source listing'}],page,hasNextPage:true,source:'hianime'};}}});
  const one=await discovery.feed('recommended',2),two=await discovery.feed('new',1);
  assert.equal(calls,1);assert.equal(one.source,'hianime');assert.equal(two.results[0].id,'fallback');assert.deepEqual(requests,[['recommended',2],['new',1]]);
});
test('fallback pagination keeps its catalog when primary recovers between pages',async()=>{
  let now=0,calls=0;
  const discovery=new Discovery({now:()=>now,spacing:0,fetch:async()=>{calls++;if(calls===1)throw new Error('offline');return response({data:[entry(1)]});},fallback:{feed:async(section,page)=>({results:[],page,hasNextPage:true,source:'hianime'})}});
  assert.equal((await discovery.feed('recommended',1)).source,'hianime');now=60000;
  assert.equal((await discovery.feed('recommended',2)).source,'hianime');assert.equal(calls,1);now=301000;
  assert.equal((await discovery.feed('recommended',1)).source,'jikan');assert.equal(calls,2);
});
