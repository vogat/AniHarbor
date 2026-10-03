import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
const context = vm.createContext({});
vm.runInContext(await readFile(new URL('../tv/media-history.js',import.meta.url),'utf8'),context);
const { MediaHistory: history } = context;
const item = (id,title,genres = [],creators = []) => ({id:'archive:'+id,title,genres,creators,kind:'movie'});
test('legacy media resume times survive metadata migration and colon-containing file names',()=>{
 const old={'archive:old:Movie:Part1.mp4':{position:32,complete:false}};
 const [entry]=history.continuing(old); assert.equal(entry.item.id,'archive:old');assert.equal(entry.part.id,'Movie:Part1.mp4');assert.equal(entry.position,32);
 old[entry.key].item=item('old','Full title',['Comedy']);old[entry.key].part={id:entry.part.id,title:'Part 1'};
 assert.equal(history.continuing(old)[0].item.title,'Full title');assert.equal(history.continuing(old)[0].position,32);
});
test('continue watching keeps latest part per title, omits finished/latest and live channels',()=>{
 const h={'archive:a:first':{item:item('a','Show'),position:20,updated:1},'archive:a:second':{item:item('a','Show'),position:60,updated:2,complete:true},'archive:b:film':{item:item('b','Film'),position:50,updated:3,duration:100},'live:test:':{position:20}};
 assert.equal(history.continuing(h).length,1);assert.equal(history.continuing(h)[0].item.id,'archive:b');
 h['archive:a:third']={item:item('a','Show'),position:15,updated:4};assert.equal(history.continuing(h)[0].part.id,'third');
});
test('recommendations use watched genres/creators, exclude watched and duplicate titles, and explain matches',()=>{
 const h={'archive:watched:film':{item:item('watched','Watched',['Mystery'],['Jane Doe']),position:100,updated:2}};
 const candidates=[item('popular','Popular',['Comedy']),item('related','Detective',['Mystery']),item('creator','Another',['Drama'],['Jane Doe']),item('duplicate','Detective',['Mystery']),item('watched','Watched',['Mystery']),item('reupload','Watched',['Mystery']),item('mobile','Watched iPod',['Mystery'])];
 const ranked=history.recommend(candidates,h);assert.equal(ranked.length,3);assert.equal(ranked[0].item.id,'archive:creator');assert.match(ranked[0].reason,/Same creator as Watched/);assert.match(ranked[1].reason,/mystery like Watched/);
 const cold=history.recommend(candidates,{});assert.equal(cold[0].score,0);assert.match(cold[0].reason,/Popular/);
});
