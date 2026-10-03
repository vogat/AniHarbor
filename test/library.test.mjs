import test from 'node:test';import assert from 'node:assert/strict';import { Library } from '../server/library.mjs';
test('live directory outage retains bundled channels and same-channel alternatives',async()=>{
 const lib=new Library({transport:{fetch:async()=>{throw new Error('offline');}},validate:async s=>{if(s.sourceUrl.includes('dai.google'))throw new Error('down');return true;}});
 const data=await lib.browse({section:'sports'});assert.ok(data.results.length>=5);assert.ok(data.results.every(x=>x.kind==='live'&&!x.sources));
 const result=await lib.resolve('live:CBSSportsGolazoNetwork.us');assert.equal(result.live,true);assert.ok(!result.streams[0].sourceUrl.includes('dai.google'));
 await assert.rejects(lib.resolve('live:unknown'),/Unknown/);
});
test('archive playback is limited to allowed public collections and compatible files',async()=>{
 const lib=new Library({transport:{fetch:async()=>Response.json({metadata:{collection:['feature_films']},files:[{name:'film.ia.mp4',format:'h.264',size:'12000000'},{name:'trailer.mp4',format:'h.264',size:'9000000'},{name:'source.mkv',format:'Matroska',size:'20000000'}]})},validate:async()=>true});
 const r=await lib.resolve('archive:example');assert.equal(r.live,false);assert.equal(r.streams.length,1);assert.match(r.streams[0].sourceUrl,/film\.ia\.mp4$/);
 await assert.rejects(lib.resolve('archive:../../secrets'),/Invalid/);
 lib.cache.clear();lib.transport.fetch=async()=>Response.json({metadata:{collection:['private'], 'access-restricted-item':'true'},files:[]});await assert.rejects(lib.resolve('archive:example'),/not available/);
});
test('archive search restricts collection, escapes query operators and validates pagination',async()=>{
 let requested='';const lib=new Library({transport:{fetch:async url=>{requested=url;return Response.json({response:{numFound:1,docs:[{identifier:'safe',title:'A Film',description:'<b>Synopsis</b>',year:1940}]}});}},validate:async()=>true});
 const r=await lib.browse({section:'movies',q:'Friday OR collection:other',page:'1'});assert.equal(r.results[0].description,' Synopsis '.trim());
 const q=new URL(requested).searchParams.get('q');assert.ok(q.startsWith('collection:feature_films'));assert.ok(!q.includes('collection:other'));
 await assert.rejects(lib.browse({section:'movies',page:'-1'}),/Invalid/);
});
test('different TV episodes are explicit choices, never fallback streams for each other',async()=>{
 const files=[{name:'Show 01.mp4',source:'original',format:'MPEG4',size:'9000000'},{name:'Show 02.mp4',source:'original',format:'MPEG4',size:'9000000'},{name:'Show 01.ia.mp4',original:'Show 01.mp4',format:'h.264',size:'8000000'}];
 const lib=new Library({transport:{fetch:async()=>Response.json({metadata:{collection:['classic_tv']},files})},validate:async()=>true});
 const data=await lib.item('archive:show');assert.deepEqual(data.episodes.map(e=>e.id),['Show 01.mp4','Show 02.mp4']);
 await assert.rejects(lib.resolve('archive:show'),/Choose an episode/);
 const r=await lib.resolve('archive:show','Show 01.mp4');assert.equal(r.streams.length,2);assert.ok(r.streams.every(s=>!s.sourceUrl.includes('02')));
 await assert.rejects(lib.resolve('archive:show','missing.mp4'),/Choose an episode/);
});
test('home enriches legacy watched IDs with genre/creator metadata and searches related public collections',async()=>{
 const calls=[];const lib=new Library({transport:{fetch:async url=>{calls.push(url);return Response.json(url.includes('/metadata/')?{metadata:{title:'Mystery Film',collection:['feature_films'],subject:['Mystery','Crime'],creator:'A Director'},files:[]}:{response:{numFound:1,docs:[{identifier:'suggestion',title:'Suggested Film',subject:['Mystery'],creator:'A Director'}]}});}}});
 const result=await lib.home('["archive:old-film"]');assert.equal(result.history[0].item.title,'Mystery Film');assert.deepEqual(result.history[0].item.genres,['Mystery','Crime']);assert.deepEqual(result.history[0].item.creators,['A Director']);assert.ok(calls.some(url=>new URL(url).searchParams.get('q')?.includes('subject:"Mystery"')));assert.ok(result.results.length);
 for(const ids of ['{}','["https://internal/"]','["archive:../bad"]',JSON.stringify(Array(13).fill('archive:ok'))])await assert.rejects(lib.home(ids),/Invalid/);
});
