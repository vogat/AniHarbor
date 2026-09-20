import * as sdk from 'anime-sdk';
import { GuardedTransport } from './relay.mjs';
import { AniZoneProvider, extraDefinitions } from './extra-providers.mjs';
import { HianimeProvider } from './hianime.mjs';

export const definitions = [
  { id: 'hianime', name: 'HiAnime / ZokoAnime', family: 'zokoanime', languages: ['sub', 'dub'], ctor: 'HianimeProvider', url: 'https://hianime.at', note: 'Uses the ZokoAnime video source only. Sub/dub playlists passed live checks; physical TV playback is untested.' },
  { id: 'animeparadise', name: 'AnimeParadise', family: 'animeparadise', languages: ['sub'], ctor: 'AnimeParadiseProvider', url: 'https://animeparadise.moe', note: 'Catalog and playlists verified. A browser test hit a segment failure and successfully switched to HiAnime/ZokoAnime.' },
  { id: 'allmanga', name: 'AllAnime / AllManga', family: 'allanime', languages: ['sub', 'dub'], ctor: 'AllmangaProvider', url: 'https://allmanga.to', note: 'Catalog worked; playback failed live checks after an upstream API protocol change.' },
  { id: 'gogoanime', name: 'AniNeko', family: 'anineko', languages: ['sub'], ctor: 'GogoanimeProvider', url: 'https://anineko.to' },
  { id: 'anikoto', name: 'AniKoto', family: 'megaplay', languages: ['sub', 'dub'], ctor: 'AnikotoProvider', url: 'https://anikototv.to' },
  { id: 'megaplay', name: 'MegaPlay', family: 'megaplay', languages: ['sub', 'dub'], ctor: 'MegaPlayProvider', url: 'https://megaplay.buzz', note: 'Shares the AniKoto video family; not an independent backup.' },
  { id: 'goyabu', name: 'Goyabu (Portuguese)', family: 'goyabu-blogger', languages: ['dub'], ctor: 'GoyabuProvider', url: 'https://goyabu.io', note: 'Portuguese audio only. Manual selection; excluded from English fallback.', manual: true },
  ...extraDefinitions
];

export function createProviders() {
  // The SDK is used only as a library. Its public proxy/download server is not started.
  // Avoid the SDK's shell-based curl fallback. The guarded transport keeps
  // user input out of shells and refuses private-address requests.
  const http = new sdk.HttpClient({ timeoutMs: 10000, transport: new GuardedTransport() });
  const constructors = { ...sdk, AniZoneProvider, HianimeProvider };
  return definitions.map(d => ({ ...d, adapter: typeof constructors[d.ctor] === 'function' ? new constructors[d.ctor](http) : null }));
}
