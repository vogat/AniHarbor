import * as sdk from 'anime-sdk';
import { GuardedTransport } from './relay.mjs';
import { AniZoneProvider, extraDefinitions } from './extra-providers.mjs';
import { AnikotoProvider, MegaPlayProvider } from './megaplay.mjs';
import { HianimeProvider } from './hianime.mjs';

export const definitions = [
  { id: 'hianime', name: 'HiAnime', family: 'megaplay', languages: ['sub', 'dub'], ctor: 'HianimeProvider', url: 'https://hianime.at', note: 'Shares MegaPlay delivery with AniKoto. Its video host failed current checks; playback checks try an independent backup.' },
  { id: 'animeparadise', name: 'AnimeParadise', family: 'animeparadise', languages: ['sub'], ctor: 'AnimeParadiseProvider', url: 'https://animeparadise.moe', note: 'Independent subtitled catalog and video delivery.' },
  { id: 'allmanga', disabled: true, name: 'AllAnime / AllManga', family: 'allanime', languages: ['sub', 'dub'], ctor: 'AllmangaProvider', url: 'https://allmanga.to', note: 'Catalog worked; playback failed live checks after an upstream API protocol change.' },
  { id: 'gogoanime', disabled: true, name: 'AniNeko', family: 'anineko', languages: ['sub'], ctor: 'GogoanimeProvider', url: 'https://anineko.to', note: 'Disabled: upstream catalog database is down (2026-09-29).'  },
  { id: 'anikoto', name: 'AniKoto', family: 'megaplay', languages: ['sub', 'dub'], ctor: 'AnikotoProvider', url: 'https://anikototv.to', note: 'MegaPlay link extraction repaired; video host currently fails TLS. Backup playback may be available.' },
  { id: 'megaplay', name: 'MegaPlay', family: 'megaplay', metadataEpisodes: true, languages: ['sub', 'dub'], ctor: 'MegaPlayProvider', url: 'https://megaplay.buzz', note: 'Episode counts come from AniList metadata; a listed episode or audio option does not confirm a video file exists. Shares video delivery with AniKoto.' },
  { id: 'goyabu', disabled: true, name: 'Goyabu (Portuguese)', family: 'goyabu-blogger', languages: ['dub'], ctor: 'GoyabuProvider', url: 'https://goyabu.io', note: 'Disabled: catalog failed current checks. Portuguese audio only.', manual: true },
  ...extraDefinitions
];

export function createProviders() {
  // The SDK is used only as a library. Its public proxy/download server is not started.
  // Avoid the SDK's shell-based curl fallback. The guarded transport keeps
  // user input out of shells and refuses private-address requests.
  const http = new sdk.HttpClient({ timeoutMs: 10000, transport: new GuardedTransport() });
  const constructors = { ...sdk, AniZoneProvider, HianimeProvider, AnikotoProvider, MegaPlayProvider };
  return [...definitions].sort((a, b) => Number(b.id === 'animeparadise') - Number(a.id === 'animeparadise')).map(d => ({ ...d, adapter: !d.disabled && typeof constructors[d.ctor] === 'function' ? new constructors[d.ctor](http) : null }));
}
