import test from 'node:test';import assert from 'node:assert/strict';import { Sports, normalizeEvents, leagues } from '../server/sports.mjs';
const event=(id='1',broadcast='CBS')=>({id,name:'Away at Home',date:'2026-09-29T20:00Z',competitions:[{id,competitors:[{team:{displayName:'Home'},homeAway:'home',score:'14'},{team:{displayName:'Away'},homeAway:'away',score:'10'}],status:{type:{state:'in',shortDetail:'3rd quarter'}},broadcasts:[{names:[broadcast]}]}]});
test('game listing deduplicates, orders away/home, and never mistakes CBS for a Golazo game stream',()=>{
 const games=normalizeEvents({events:[event(),event()]},leagues[0]);assert.equal(games.length,1);assert.equal(games[0].teams[0].name,'Away');assert.equal(games[0].status,'in');assert.deepEqual(games[0].broadcasts,['CBS']);assert.equal(games[0].playable,false);assert.equal(games[0].source,'ESPN scoreboard');
});
test('sports handles partial league failure, validated filters, dates, and short cache',async()=>{
 let calls=0,now=100000,fail=false;const sports=new Sports({now:()=>now,transport:{fetch:async url=>{calls++;if(fail||url.includes('/nba/'))throw new Error('offline');return Response.json({events:[event()]});}}});
 const result=await sports.browse();assert.equal(result.rows.length,6);assert.match(result.rows.find(r=>r.id==='nba').error,/unavailable/);assert.equal(result.rows[0].games.length,1);
 await sports.browse({league:'nfl'});assert.equal(calls,6);now+=61000;fail=true;const stale=await sports.browse({league:'nfl'});assert.equal(stale.rows[0].stale,true);
 now+=21600000;const expired=await sports.browse({league:'nfl'});assert.ok(expired.rows[0].error);assert.equal(expired.rows[0].games.length,0);
 for(const args of [{league:'../../x'},{date:'20260230'},{date:'20269901'},{date:'garbage'}])await assert.rejects(sports.browse(args),/Invalid/);
});
test('sports filters only call the selected league, and concurrent refreshes share one request',async()=>{
 let urls=[];const sports=new Sports({transport:{fetch:async url=>{urls.push(url);return Response.json({events:[]});}}});await Promise.all([sports.browse({league:'nba',date:'20260929'}),sports.browse({league:'nba',date:'20260929'})]);assert.equal(urls.length,1);assert.ok(urls[0].endsWith('/basketball/nba/scoreboard?dates=20260929'));
});
