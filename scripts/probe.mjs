import { writeFile, mkdir } from 'node:fs/promises';
import { Catalog } from '../server/catalog.mjs';
import { createProviders } from '../server/providers.mjs';
import { publicRequest } from '../server/relay.mjs';

const query = process.argv[2] || 'Naruto';
const catalog = new Catalog(createProviders(), { timeout: 18000 });
const report = { date: new Date().toISOString(), query, scope: 'Search, first exact title when available, episode 1 and limited media probe. Not full playback or TV certification.', providers: [] };
await Promise.all(catalog.providers.map(async p => {
  const row = { provider: p.id, family: p.family, stage: 'search', ok: false };
  report.providers.push(row);
  try {
    const { results, errors } = await catalog.search(query, p.id);
    if (!results.length) throw new Error(errors[0]?.message || 'No search results.');
    row.results = results.length;
    const item = results.find(r => r.title.toLowerCase() === query.toLowerCase()) || results[0];
    row.title = item.title; row.stage = 'episodes';
    const { episodes } = await catalog.episodes(p.id, item.id);
    if (!episodes.length) throw new Error('No episodes.');
    row.episodes = episodes.length; row.stage = 'resolve';
    const episode = episodes.find(e => e.number === 1) || episodes[0];
    const language = p.languages.includes('sub') ? 'sub' : 'dub';
    const stream = await catalog.call(p.id, 'resolveStream', [episode.id, language]);
    if (stream.type !== 'video' || !stream.streams?.length) throw new Error('No video links.');
    row.streams = stream.streams.length;
    row.subtitles = stream.streams[0].subtitles?.length || 0;
    row.stage = 'media';
    const source = stream.streams[0];
    const { response } = await publicRequest(source.sourceUrl, { ...source.headers, Range: 'bytes=0-1023' });
    row.http = response.statusCode; row.contentType = response.headers['content-type'];
    let bytes = Buffer.alloc(0);
    for await (const chunk of response) { bytes = Buffer.concat([bytes, chunk]); if (bytes.length >= 1024) break; }
    response.destroy();
    row.signature = bytes.subarray(0, 16).toString('hex');
    row.ok = response.statusCode >= 200 && response.statusCode < 300 && (source.isHLS ? bytes.toString().includes('#EXTM3U') : bytes.subarray(0, 64).includes(Buffer.from('ftyp')));
    if (!row.ok) row.error = 'Response did not pass media signature check.';
  } catch (e) { row.error = e.message; }
  console.log(`${row.provider}: ${row.ok ? 'PASS' : 'FAIL'} at ${row.stage}${row.error ? ' — ' + row.error : ''}`);
}));
await mkdir('docs', { recursive: true });
await writeFile('docs/live-probe.json', JSON.stringify(report, null, 2) + '\n');
console.log('Saved docs/live-probe.json (no signed stream URLs stored).');
