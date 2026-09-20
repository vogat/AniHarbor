import { test } from 'node:test';
import assert from 'node:assert/strict';
import { groupShows, seasonTitle } from '../server/grouping.mjs';
const row = (provider, title, extra = {}) => ({ id: provider + ':' + title, provider, title, image: '', year: null, languages: ['sub'], ...extra });

test('one show contains seasons and duplicate source choices without losing raw playback IDs', () => {
  const rows = [row('first', 'Example'), row('backup', 'Example (Dub)'), row('first', 'Example Season 2'), row('backup', 'Example 2nd Season')];
  const grouped = groupShows([...rows, rows[0]]);
  assert.equal(grouped.length, 1); assert.equal(grouped[0].seasons.length, 2);
  assert.deepEqual(grouped[0].seasons.map(s => s.label), ['Season 1', 'Season 2']);
  assert.equal(grouped[0].seasons[0].providers.length, 2);
  assert.equal(grouped[0].seasons[1].providers[1].title, 'Example 2nd Season');
  assert.equal(grouped[0].seasons[1].providers[1].id, 'backup:Example 2nd Season');
});
test('final-season punctuation and first-part naming do not make duplicate seasons', () => {
  const shows = groupShows([row('a', 'Example Final Season'), row('b', 'Example: Final Season, Part 1'), row('a', 'Example Final Season Part 2'), row('b', 'Example: Final Season, Part 2')]);
  assert.equal(shows.length, 1); assert.equal(shows[0].seasons.length, 2);
  assert.deepEqual(shows[0].seasons.map(s => s.providers.length), [2, 2]);
  assert.equal(seasonTitle('Example Season 3 Part 2').number, 3);
});
test('movies, spinoffs, numbers and known remakes are never folded into a season', () => {
  const shows = groupShows([row('a', 'Example'), row('a', 'Example Season 2'), row('a', 'Example: Origins'), row('a', 'Example 2'), row('a', 'Example', { mediaType: 'Movie' }), row('a', 'Remake', {year:1990}), row('b', 'Remake', {year:2020})]);
  assert.equal(shows.length, 6);
  assert.equal(shows.filter(s => s.kind === 'movie').length, 1);
  assert.equal(shows.filter(s => s.title === 'Remake').length, 2);
});
test('unique metadata aliases group translations and verified subtitle seasons; movies stay separate', () => {
  const metadata = [
    {mal_id:1,title:'Japanese Title',title_english:'English Title',type:'TV',year:2020,_seriesId:1},
    {mal_id:2,title:'Japanese Title: Return',title_english:'English Title: Return',type:'TV',year:2022,_seriesId:1},
    {mal_id:3,title:'Japanese Title: Story',title_english:'English Title: Story',type:'Movie',year:2021}
  ];
  const shows = groupShows([row('a','Japanese Title'),row('b','English Title'),row('a','English Title: Return'),row('a','Japanese Title: Story')],metadata);
  assert.equal(shows.length, 2); assert.equal(shows[0].seasons.length, 2); assert.equal(shows[0].seasons[0].providers.length, 2);
  assert.equal(shows[1].kind, 'movie');
});
test('partial metadata does not split explicit seasons into separate cards', () => {
  const metadata = [{mal_id:1,title:'Example',type:'TV',year:2020,_seriesId:1},{mal_id:2,title:'Example Final Season',type:'TV',year:2022,_seriesId:1}];
  const shows = groupShows([row('a','Example'),row('a','Example Final Season'),row('b','Example: Final Season, Part 1'),row('a','Example Final Season Part 2')],metadata);
  assert.equal(shows.length,1); assert.equal(shows[0].seasons.length,3); assert.equal(shows[0].seasons[1].providers.length,2);
});
test('provider type and TV suffix reconcile duplicate movie and show cards without metadata', () => {
  const movies=groupShows([row('a','Film Title',{mediaType:'Movie'}),row('b','Film Title')]);
  assert.equal(movies.length,1);assert.equal(movies[0].kind,'movie');assert.equal(movies[0].seasons[0].providers.length,2);
  const shows=groupShows([row('a','Example (TV)'),row('b','Example'),row('a','Example II')]);
  assert.equal(shows.length,1);assert.equal(shows[0].seasons.length,2);assert.equal(shows[0].seasons[0].providers.length,2);
});
test('provider-declared Japanese aliases unify duplicates and movie classification during metadata outage', () => {
  const shows=groupShows([row('a','English Movie',{mediaType:'MOVIE',aliases:['Japanese Eiga']}),row('b','Japanese Eiga'),row('c','English Movie')]);
  assert.equal(shows.length,1);assert.equal(shows[0].kind,'movie');assert.equal(shows[0].seasons[0].providers.length,3);
  const ambiguous=groupShows([row('a','First',{aliases:['Same alias']}),row('b','Different',{aliases:['Same alias']}),row('c','Same alias')]);
  assert.equal(ambiguous.length,3);
});
test('reciprocal exact aliases choose one canonical card', () => {
  const shows=groupShows([row('a','First Title',{aliases:['Second Title']}),row('b','Second Title',{aliases:['First Title']})]);
  assert.equal(shows.length,1);assert.equal(shows[0].seasons[0].providers.length,2);
});
test('an explicit season in an exact base alias groups a bare-number English title without guessing other numbers', () => {
  const shows=groupShows([
    row('a','My Hero Academia',{aliases:['Boku no Hero Academia']}),
    row('a','My Hero Academia 2',{aliases:['Boku no Hero Academia 2nd Season']}),
    row('b','My Hero Academia 2'),
    row('c','My Hero Academia Season 2'),
    row('a','Unrelated'),row('a','Unrelated 2')
  ]);
  assert.equal(shows.length,3);assert.equal(shows[0].title,'My Hero Academia');
  assert.deepEqual(shows[0].seasons.map(s=>s.label),['Season 1','Season 2']);
  assert.equal(shows[0].seasons[1].providers.length,3);
  assert.deepEqual(shows.slice(1).map(s=>s.title),['Unrelated','Unrelated 2']);
});
test('ambiguous season base aliases do not link different shows or movies', () => {
  const shows=groupShows([row('a','First',{aliases:['Base']}),row('b','Other',{aliases:['Base']}),row('c','First 2',{aliases:['Base 2nd Season']}),row('a','Movie 2',{mediaType:'MOVIE',aliases:['Base 2nd Season']})]);
  assert.equal(shows.length,4);assert.equal(shows[3].kind,'movie');
});
