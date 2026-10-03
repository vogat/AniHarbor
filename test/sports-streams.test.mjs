import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { SportsStreams, eventMatches, matchoraChannels } from '../server/sports-streams.mjs';
import { Relay } from '../server/relay.mjs';
const game = { id:'wnba:123',date:'2026-09-29T22:30:00Z',status:'in',teams:[{name:'Las Vegas Aces'},{name:'Indiana Fever'}] };
const listing = (date=game.date,away='Aces',home='Fever') => '<script type="application/ld+json">'+JSON.stringify({'@type':'SportsEvent',startDate:date,awayTeam:{name:away},homeTeam:{name:home}})+'</script>';
const detail = '<button data-embed="https://matchora.to/embed/channel/1917631" data-name="Sky"></button>';
const center = {id:'center:abc60',host:'center',channel:'abc60',name:'Center',referer:'https://streame.center/embed/ch60.php'};
const matchora = {id:'matchora:1917631',host:'matchora',channel:'1917631',name:'Matchora'};

test('matches exact game teams and time; rejects another matchup or stale listing',()=>{
 assert.ok(eventMatches(listing(),game));
 for(const html of [listing('2026-09-28T22:30Z'),listing(game.date,'Aces','Liberty'),listing(game.date,'Aces','Aces'),listing('invalid'),'<script>evil()</script>']) assert.equal(eventMatches(html,game),false);
 assert.deepEqual(matchoraChannels(detail+detail).map(s=>s.id),['matchora:1917631']);
 assert.deepEqual(matchoraChannels(detail.replace('matchora.to','localhost')),[]);
});
test('discovery only follows the known providers and shares concurrent requests',async()=>{
 let calls=[];let now=Date.parse(game.date);
 const streams=new SportsStreams({now:()=>now,transport:{fetch:async url=>{
  calls.push(url);
  if(url.includes('watchsports.su'))return new Response(listing()+'<a href="http://127.0.0.1/admin">bad</a><a href="https://en.sports247.ru/event/game-123">a</a><a href="https://hadcrak.cyou/game-123/">b</a>');
  if(url.includes('sports247'))return new Response(detail);
  if(url.includes('hadcrak'))return new Response('<iframe src="https://streame.center/embed/ch60.php">');
  return new Response('<iframe src="//streame.center/embed/hls.php?stream=abc60">');
 }}});
 const [a,b]=await Promise.all([streams.choices(game),streams.choices(game)]);
 assert.equal(a.sources.length,2);assert.equal(a.sources[0].host,'center');assert.equal(a,b);assert.equal(calls.length,4);assert.ok(!calls.some(u=>u.includes('127.0.0.1')));
 assert.equal((await streams.choices({...game,status:'post'})).sources.length,0);
 assert.equal((await streams.choices({...game,date:'2026-09-30T22:30Z'})).sources.length,0);
 await assert.rejects(streams.choices({...game,id:'../../x'}),/Invalid/);
 now+=91000;await streams.choices(game);assert.equal(calls.length,8);
});
test('automatic fallback validates media and selects the independent backup before more copies',async()=>{
 const tried=[]; const streams=new SportsStreams({validate:async s=>{if(s.sourceUrl.includes('1917631'))throw Error('not video');}});
 streams.choices=async()=>({sources:[matchora,{...matchora,id:'matchora:2',channel:'2'},center]});
 streams.prepare=async c=>{tried.push(c.id);return {sourceUrl:'https://video.example/'+c.channel,isHLS:true,renewAt:Date.now()+10000};};
 const result=await streams.resolve(game);assert.equal(result.sourceId,center.id);assert.deepEqual(tried,[matchora.id,center.id]);assert.equal(result.attempts.length,1);
 await assert.rejects(streams.resolve(game,{source:'http://localhost'}),/No untried/);
});
test('warming polls are bounded; dead or unexpected video hosts never become playable',async()=>{
 let calls=0;const streams=new SportsStreams({pause:async()=>{},transport:{fetch:async()=>{calls++;return Response.json({reason:'warming',ready:false});}}});
 await assert.rejects(streams.prepare(matchora),/offline/);assert.equal(calls,5);
 streams.transport.fetch=async()=>Response.json({ready:true,url:'http://127.0.0.1/private'});
 await assert.rejects(streams.prepare(matchora),/offline/);
 streams.transport.fetch=async()=>new Response('const streamUrl = "https://evil.example/hls/abc60.m3u8";');
 await assert.rejects(streams.prepare(center),/changed/);
});
test('one stable relay URL renews expiring live tokens, coalescing simultaneous requests',async()=>{
 let now=0,prepares=0;const seen=[];
 const streams=new SportsStreams({now:()=>now,validate:async()=>true});streams.choices=async()=>({sources:[matchora]});
 streams.prepare=async()=>({sourceUrl:'https://video.example/live.m3u8?token='+ ++prepares,isHLS:true,renewAt:now+600000});
 const result=await streams.resolve(game);const stream=result.streams[0];
 const relay=new Relay({now:()=>now,request:async url=>{seen.push(url);const response=Readable.from([Buffer.from('#EXTM3U\n#EXTINF:2,\nseg.ts\n')]);response.statusCode=200;response.headers={'content-type':'application/vnd.apple.mpegurl'};return {url,response};}});
 const path=relay.grant(stream.sourceUrl,{},'hls',stream.refresh);
 const serve=()=>relay.serve({headers:{}},{writeHead(){},end(text){assert.ok(text.includes('http://localhost/media/'));}},path.slice(7),'http://localhost');
 await serve();now=600001;await Promise.all([serve(),serve()]);assert.equal(prepares,2);assert.ok(seen[0].endsWith('token=1'));assert.ok(seen[1].endsWith('token=2'));assert.ok(seen[2].endsWith('token=2'));
 assert.ok([...relay.grants.values()].filter(g=>g.kind==='segment').every(g=>!g.refresh));
});
test('sliding live playlists preserve segment and key URLs across sequence updates',async()=>{
 let sequence=20,now=0;
 const relay=new Relay({now:()=>now,request:async url=>{const response=Readable.from([Buffer.from('#EXTM3U\n#EXT-X-MEDIA-SEQUENCE:'+sequence+'\n#EXT-X-KEY:METHOD=AES-128,URI="key.bin"\n#EXTINF:2,\nseg-'+sequence+'.ts\n#EXTINF:2,\nseg-'+(sequence+1)+'.ts\n')]);response.statusCode=200;response.headers={};return {url,response};}});
 const root=relay.grant('https://video.example/live.m3u8',{},'hls');
 async function read(){let body;await relay.serve({headers:{}},{writeHead(){},end(t){body=t;}},root.slice(7),'http://localhost');return body;}
 const first=await read();sequence++;const second=await read();const urls=s=>s.split('\n').filter(l=>l.startsWith('http'));
 assert.equal(urls(first)[1],urls(second)[0]);assert.equal(first.match(/URI="([^"]+)/)[1],second.match(/URI="([^"]+)/)[1]);
 assert.notEqual(urls(first)[0],urls(second)[1]);
});
test('StreamCenter accepts its rotating numbered CDN hosts, not lookalike domains',async()=>{
 const streams=new SportsStreams({transport:{fetch:async()=>new Response('const streamUrl = "https://edgestream4.pro/hls/abc60.m3u8?e=9999999999";')}});
 assert.equal(new URL((await streams.prepare(center)).sourceUrl).hostname,'edgestream4.pro');
 for(const host of ['edgestream4.pro.evil.example','evil-edgestream4.pro','127.0.0.1']){
  streams.transport.fetch=async()=>new Response('const streamUrl = "https://'+host+'/hls/abc60.m3u8";');await assert.rejects(streams.prepare(center),/changed/);
 }
});
