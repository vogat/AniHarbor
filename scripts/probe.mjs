import { writeFile, mkdir } from 'node:fs/promises';
import { Catalog } from '../server/catalog.mjs';
import { createProviders } from '../server/providers.mjs';
import { checkStream } from '../server/media-check.mjs';

const query = process.argv[2] || 'Naruto';
const catalog = new Catalog(createProviders(), { timeout: 18000 });
const report = { date: new Date().toISOString(), query, scope: 'Search, first exact title when available, episode 1, nested playlists and initial video-byte check. Not full playback or TV certification.', providers: [] };
await Promise.all(catalog.providers.map(async p => {
  const row = { provider: p.id, family: p.family, stage: 'search', ok: false };
  report.providers.push(row);
  if (p.disabled) { row.stage = 'disabled'; row.error = p.note || 'Disabled after failed live checks.'; return; }
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
    await checkStream(source);
    row.ok = true; row.stage = 'playlist-and-video-bytes';
  } catch (e) { row.error = e.message; }
  console.log(`${row.provider}: ${row.ok ? 'PASS' : 'FAIL'} at ${row.stage}${row.error ? ' — ' + row.error : ''}`);
}));
await mkdir('docs', { recursive: true });
await writeFile('docs/live-probe.json', JSON.stringify(report, null, 2) + '\n');
console.log('Saved docs/live-probe.json (no signed stream URLs stored).');
