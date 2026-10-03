import { readFile, writeFile } from 'node:fs/promises';
const token = (await readFile('.data/pairing-token', 'utf8')).trim();
const base = 'http://127.0.0.1:8787';
const report = { date: new Date().toISOString(), checks: [] };
async function api(route, params) {
  const r = await fetch(base + route + '?' + new URLSearchParams(params), { headers: { 'x-app-token': token }, signal: AbortSignal.timeout(90000) });
  const json = await r.json(); if (!r.ok) throw new Error(JSON.stringify(json)); return json;
}
try {
  const results = await api('/api/search', {q:'Naruto', provider:process.argv[2] || 'animeparadise'});
  const show = results.results.find(r => r.title === 'Naruto');
  const series = show?.seasons?.flatMap(s => s.providers).find(p => p.provider === (process.argv[2] || 'animeparadise') && p.title === 'Naruto'); if (!series) throw new Error('No exact source selection found.');
  const {episodes} = await api('/api/episodes', {provider:series.provider,id:series.id});
  const e = episodes.find(e => e.number === 1); if (!e) throw new Error('Episode 1 missing.');
  const stream = await api('/api/resolve', {provider:series.provider,id:series.id,episodeId:e.id,title:series.title,number:e.number,language:'sub'});
  report.provider = stream.provider; report.attempts = stream.attempts;
  const source = stream.sources[0];
  let url = source.url;
  for (let i=0;i<4;i++) {
    const r = await fetch(url,{signal:AbortSignal.timeout(30000)});
    const mime = r.headers.get('content-type');
    if (mime?.includes('mpegurl')) {
      const text = await r.text(); report.checks.push({kind:'playlist',status:r.status,valid:text.startsWith('#EXTM3U')});
      const next = text.split(/\r?\n/).find(l=>l.trim()&&!l.startsWith('#')); if (!next) throw new Error('No playlist media.'); url = new URL(next,url).href;
    } else {
      const reader = r.body.getReader(); const {value} = await reader.read(); await reader.cancel();
      report.checks.push({kind:'segment',status:r.status,mime,bytes:value?.length,signature:Buffer.from(value || []).subarray(0,16).toString('hex'),error:!r.ok ? Buffer.from(value || []).toString().slice(0,300) : undefined}); break;
    }
  }
  if(source.subtitles?.length) { const r=await fetch(source.subtitles[0].url,{signal:AbortSignal.timeout(30000)}); const text=await r.text(); report.checks.push({kind:'subtitle',status:r.status,valid:/-->/g.test(text)}); }
} catch(e) { report.error = e.message; }
console.log(JSON.stringify(report,null,2)); await writeFile('docs/playback-smoke.json',JSON.stringify(report,null,2)+'\n');
