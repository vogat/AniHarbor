> September 29 update: the original observations below are historical. Current verification is in [VALIDATION.md](VALIDATION.md). HiAnime now shares MegaPlay delivery; the previous claim of independent Zoko delivery no longer describes the live site.

## September 29 references

- [HiAnime](https://hianime.at): live theme API now advertises MegaPlay `s-2` embeds.
- [MegaPlay public client](https://megaplay.buzz/lib/newclient.min.js?v=4.20): public configuration/segment URL serialization inspected as text. No upstream JavaScript is executed by AniHarbor.
- [Kuhi provider implementation](https://github.com/aryaniiil/anime-api/tree/main/src/providers): reference used to identify current provider routes; implementations and candidates were checked against live responses. Claims in its README were not treated as playback proof.
- [IPTV-org API](https://github.com/iptv-org/api): public channel directory for the sports and general-media tabs. Directory entries are not independent video hosts or guarantees of availability. Initial selected feeds passed segment checks; the bundled catalog survives directory outages.
- [Internet Archive metadata API](https://archive.org/developers/md-read.html): on-demand item/files metadata. Public feature-film and classic-TV collections are used; restricted items are rejected.

Additional anime candidates KAA, AnimeGG and AniBD were inspected. KAA metadata and playlists responded but segment requests failed; AnimeGG/AniBD had TLS failures. They are not offered as verified backups.

# Anime provider research

Checked **2026-09-19**, for the Samsung UN60KU630DFXZA / 2016 Tizen app. This is a dated research inventory, not an uptime guarantee. "Documented" means a maintainer describes an integration; "resolved" means a live request returned a stream descriptor; "playlist verified" means a live response contained an HLS playlist. None alone establishes complete episode playback, correct content, subtitle synchronization, or TV compatibility.

## Recommendation

The built app now has eight adapters across seven observed entry-point families. **AnimeParadise** and the new **HiAnime/ZokoAnime** adapter passed playlist/media-header checks. Prefer those for initial testing. AllAnime/AllManga, AniNeko, and AniKoto/MegaPlay remain candidates with failed live checks; Goyabu (Portuguese) and AniZone (failed media CDN) are manual candidates. AniKoto and MegaPlay count as one family. Shared CDNs or ownership can still create correlated outages. See [current machine-readable probe results](live-probe.json) and [HiAnime evidence](hianime-research.md). There are not three independently verified working providers yet.

AnimeParadise was the clearest successful direct API check in this research pass: search, episode metadata, and a master HLS playlist responded. It is not evidence that the other families presently work. Current application probe results should decide which adapters are available, and the UI must not call an adapter healthy merely because its HTTP response is 200.

**Do not depend on a single hosted aggregator URL for all backups.** Self-hosting the API service keeps provider patches outside the TV package. It does not prevent source takedowns, and a single SDK release remains a shared software dependency. Keep adapter replacements possible.

## Candidate sources and independence

Each row is a source candidate or family, not a count of proven independent working APIs. Most projects expose unofficial scraping adapters, not a supported streaming API supplied by a licensed anime distributor. Sub/dub and subtitle claims below come from the linked primary documentation or adapter, unless explicitly live-tested.

| Source / candidate family | Primary implementation or documentation | Formats, language and subtitles | Independence and result |
|---|---|---|---|
| **AnimeParadise** | [Adapter](https://github.com/hexxt-git/anime-sdk/blob/master/src/providers/AnimeParadiseProvider.ts) | Sub; HLS; separate subtitle tracks | `api.animeparadise.moe` and `stream.animeparadise.moe`. Search, episodes, English VTT descriptor and HLS master verified. |
| **AllAnime / AllManga / MKissa** | [AllManga adapter](https://github.com/hexxt-git/anime-sdk/blob/master/src/providers/AllmangaProvider.ts), [MKissa adapter](https://github.com/walterwhite-69/Anivexa-API/blob/main/providers/mkissa.js), [Allanime-api](https://github.com/mdtahseen7/Allanime-api) | Sub/dub; HLS/MP4; source-dependent tracks | AllManga uses AllAnime GraphQL. MKissa has its own API hostname but retains AllAnime clock paths and shared hosts; conservatively group them. Hosted Anivexa AllManga test failed. |
| **AniNeko** | [SDK Gogoanime adapter](https://github.com/hexxt-git/anime-sdk/blob/master/src/providers/GogoanimeProvider.ts), [Anivexa adapter](https://github.com/walterwhite-69/Anivexa-API/blob/main/providers/anineko.js) | SDK documents sub, HLS via VibePlayer; other adapters advertise dub | The SDK name `gogoanime` actually targets `anineko.to`; do not count the two names separately. Hosted Anivexa could not match test title. |
| **AniKoto / MegaPlay** | [AniKoto adapter](https://github.com/hexxt-git/anime-sdk/blob/master/src/providers/AnikotoProvider.ts), [MegaPlay adapter](https://github.com/hexxt-git/anime-sdk/blob/master/src/providers/MegaPlayProvider.ts) | Sub/dub, HLS, separate tracks | AniKoto uses MegaPlay for video. Count once. Hosted test returned MegaPlay/VidWish embeds and English captions, without a direct video URL. |
| **Goyabu** | [Adapter](https://github.com/hexxt-git/anime-sdk/blob/master/src/providers/GoyabuProvider.ts) | Portuguese dub; Google Blogger/GoogleVideo video | Separate language-specific entry point. Not directly probed in this research pass. |
| **AnimeGG** | [Adapter](https://github.com/walterwhite-69/Anivexa-API/blob/main/providers/animegg.js) | Sub/dub; direct MP4 and embeds; no separate captions observed | Hosted route resolved 480p MP4. Direct search/media connection failed TLS locally. Has Mp4Upload backup, overlapping a host used by AllAnime. |
| **Reanime** | [Adapter](https://github.com/walterwhite-69/Anivexa-API/blob/main/providers/reanime.js) | Sub/dub; HLS through FlixCloud | `reanime.to` → `flixcloud.cc`. Distinct candidate; hosted test failed with HTML where JSON was expected. |
| **AniZone** | [Adapter](https://github.com/walterwhite-69/Anivexa-API/blob/main/providers/anizone.js) | HLS and captions; sub | `anizone.to`; distinct entry point. Implementation inspected; no live stream probe. |
| **AnimeOnsen** | [Adapter](https://github.com/walterwhite-69/Anivexa-API/blob/main/providers/animeonsen.js) | DASH and separate captions; sub | `www.animeonsen.xyz`; distinct candidate. DASH needs additional TV validation; no live stream probe. |
| **KickAssAnime** | [Adapter](https://github.com/walterwhite-69/Anivexa-API/blob/main/providers/kickassanime.js) | Sub/dub; HLS | `kaa.lt` / `hls.krussdomi.com`. Separate candidate, but SDK maintainers previously removed it after 403 responses. Not counted operational. |
| **AniBD** | [Adapter](https://github.com/walterwhite-69/Anivexa-API/blob/main/providers/anibd.js) | HLS/embed; availability depends on title | Uses `epeng.animeapps.top`. Distinct API entry point, but downstream independence not verified. No live stream probe. |
| **AniDB App** | [Adapter](https://github.com/walterwhite-69/Anivexa-API/blob/main/providers/anidbapp.js) | Language-aware episode lookup and HLS extraction | `anidb.app`; this is not merely the AniDB metadata database. No live stream probe; media-host independence unverified. |
| **AniWaves** | [Adapter](https://github.com/walterwhite-69/Anivexa-API/blob/main/providers/aniwaves.js) | HLS/MP4/embeds; multiple servers | `aniwaves.ru` uses hosts including Vidplay, MyCloud and DATASV. Some branches share MegaPlay. Count host-specific results, not every server name as independent. |
| **2D Hive** | [Adapter](https://github.com/walterwhite-69/Anivexa-API/blob/main/providers/2dhive.js) | Sub/dub; HLS/embeds | `2dhive.com`; source includes MegaPlay and BabaStream fallbacks. Not automatically independent of AniKoto/MegaPlay. No live probe. |
| **AnimeDunya** | [Adapter](https://github.com/walterwhite-69/Anivexa-API/blob/main/providers/animedunya.js) | Sub, HLS, captions | `anime-dunya.com`; MAL-based mapping. Distinct entry point; video-host independence and live availability unverified. |
| **AnimePahe** | [AnimePahe API](https://github.com/Pal-droid/Animepahe-API) | Kwik HLS; quality selection | Distinct source family, but documented protection/cookie problems. SDK removed it after 403 responses. No live stream probe. |
| **AnimeKai** | [Python API](https://github.com/Sheets-Astrum-BOT/AnimeKai-API-Python) | Sub/dub/softsub groups; HLS and subtitle fields | `anikai.to`; sample streams use MegaUp/tech20hub. Separate candidate; documented API checked, no live stream probe. |
| **AnimeWorld** | [Python library](https://github.com/MainKronos/AnimeWorld-API) | Italian-language anime and episode downloads | Separate language-specific entry point. Not an English fallback; no live stream probe. |
| **Senshi / Suzu** | [Senshi adapter](https://github.com/walterwhite-69/Anivexa-API/blob/main/providers/senshi.js) | Source-dependent video and language availability | `senshi.to` / `s.vidcloud.se`. Source file exists but absent from current supported-provider README list. Research candidate only. |
| **AnimeFire** | [SDK failed-provider report](https://github.com/hexxt-git/anime-sdk/blob/master/tested_providers_failed.md) | Not established in this pass | Listed as removed after 403 responses in June 2026. Do not treat as a working backup. |

## Wrappers do not add independent video sources

- **[anime-sdk](https://github.com/hexxt-git/anime-sdk)** normalizes providers and supports a local HTTP server. Its advertised nine content providers include three manga-only providers. The app uses it as a library; adding another server running the same adapters would not add source independence.
- **[Anivexa](https://github.com/walterwhite-69/Anivexa-API)** currently lists thirteen supported providers. Its catalog and identity layer depend on AniList, and its documentation warns that data-center deployments can be blocked. The public `anivexa-api.vercel.app` instance identified itself as version 2.1 during testing, behind the repository's version 2.2.1. Self-hosted current code and old public deployments must be distinguished.
- **[MiruroAPI](https://github.com/Shineii86/MiruroAPI)** routes several named providers through a shared Miruro pipe. Its README reports streaming failures on protected cloud requests. Direct embed URLs are not interchangeable with HLS/MP4 URLs for a native TV player. The named pipe providers are not counted as independently verified APIs here.
- **[aryaniiil/anime-api](https://github.com/aryaniiil/anime-api)** documents native ports of ten sources, with maintainer test results dated September 2026. It is another implementation route to overlapping sources, not ten new source families. Its test claims were not reproduced in this pass.
- **[FastAnime / Viu](https://github.com/viu-media/viu)** is a cross-platform streaming client and useful integration reference. It is not itself an independent media host.
- **[HACHI-API](https://github.com/Pal-droid/HACHI-API)** is archived and explicitly discontinued. Its planned-provider list must not be mistaken for implemented sources.
- **[animetsu-api](https://github.com/ullamua/animetsu-api)** is archived and the maintainer's heading reports the Animetsu source dead. Excluded from the initial integration.
- **[Consumet](https://github.com/consumet/consumet.ts)** was not accessible through the research browser during this pass. No current uptime or provider-support claim is made.

## Live read-only checks

Requests below were made on September 19, 2026. They fetched JSON, a small HLS master, or attempted tiny byte ranges. No complete episodes were downloaded. No third-party repository script was executed as part of this research.

| Request | Observed result | What it establishes |
|---|---|---|
| `GET https://api.animeparadise.moe/search?q=naruto&limit=2` | JSON `success:true`, two catalog results | Search API reachable. |
| `GET https://api.animeparadise.moe/anime/5ufreSuVbN4inXpo/episode` | JSON episode list with UID | Episode API reachable. Selected catalog item was the first Naruto movie. |
| `GET https://api.animeparadise.moe/ep/07ccaa4d-1302-4aae-ae4a-13d58e01481f?origin=5ufreSuVbN4inXpo` | Stream token and English VTT descriptor | A stream can be resolved; episode title appears inconsistent with the movie title. Correct-content matching still needs review. |
| `GET https://stream.animeparadise.moe/m3u8?url=<fresh streamLink>` with site Referer | Valid `#EXTM3U` master, 1920×1080, H.264/AAC declarations | Master playlist served. Video segments and playback not checked in this research pass. |
| `GET https://anivexa-api.vercel.app/watch/animegg/20/sub/animegg-1` | Direct 480p MP4 candidate plus embed and Mp4Upload backup | Hosted resolver works for this test title. Direct bytes not verified. |
| Direct AnimeGG search and MP4 byte-range probe | TLS errors with macOS curl; search also failed with Node 24 | Direct adapter not established in this environment. This is not proof the site is down everywhere. |
| `GET https://anivexa-api.vercel.app/watch/anineko/20/sub/anineko-1` | JSON error: no title match | This hosted mapping path failed for Naruto. |
| `GET https://anivexa-api.vercel.app/watch/reanime/20/sub/reanime-1` | JSON parse error caused by HTML | Hosted Reanime path failed. |
| `GET https://anivexa-api.vercel.app/watch/allmanga/20/sub/allmanga-1` | Episode-not-found error | Hosted AllManga path failed. |
| `GET https://anivexa-api.vercel.app/watch/anikoto/20/sub/anikoto-1` | Nested `ssub`, two embed URLs, English caption descriptor | Captions/embeds resolved; no direct playable source returned. |
| `GET https://anivexa-api.vercel.app/episodes/animegg/anineko/20` | API 2.1 landing metadata | Newer filtered route unsupported by that hosted deployment. |

Ephemeral stream tokens and signed URLs should be resolved on demand, not checked into the app. A successful stream for one title does not establish complete catalog coverage or dub availability.

### Additional direct-source checks (September 19, US Eastern)

These checks used normal public HTTP requests, including a site's published read-only search token where applicable. No challenge, region block, paywall, or DRM was bypassed. The failures may be specific to this network or date; they do not prove permanent shutdown.

| Candidate | New evidence | Integration decision |
|---|---|---|
| AniZone | Public search returned exact Naruto, Cowboy Bebop, and Frieren entries. Cowboy Bebop episode enumeration returned all 26 episodes using the new adapter, with correct first/last titles. Each sampled episode page returned an HLS descriptor on `seiryuu.vid-cdn.xyz` and subtitle descriptors. The CDN manifest failed TLS under both macOS curl (protocol-version alert) and Node 24 (`ERR_SSL_WRONG_VERSION_NUMBER`). | Added a **manual candidate** adapter in `server/extra-providers.mjs`. Search → episodes → descriptor works. It is explicitly excluded from automatic fallback and from the verified-playable count until the media probe succeeds on the installation network. Sample English subtitles are SRT; descriptor resolution does not prove subtitle playback. |
| AniBD | `epeng.animeapps.top/api2.php?epid=20` returned a Naruto episode list. `apilink.php?data=20abd1remaster` returned two player URLs. Both player routes redirected to the Google Cloud homepage, without a video descriptor. A Cowboy Bebop ID query returned no episodes. | No working-video adapter enabled. |
| AniDB App | The public search route returned an **Under Maintenance** HTML page instead of search results. | Not enabled. |
| AnimeOnsen | Homepage and published search service responded. Public-token search for Naruto returned zero hits. Homepage did not issue the `ao.session` cookie required by the current upstream adapter, and the unauthenticated public catalog call returned 401. | No successful episode/video flow established; not enabled. |
| 2D Hive | Direct request for the Naruto episode page failed during TLS in macOS curl. | Not enabled; underlying MegaPlay overlap still prevents assuming independence. |
| AnimeDunya | The documented `/en/play/20/1` route returned an **Access Blocked** page stating the service is unavailable in this country. | Not enabled; the geographic restriction was not bypassed. |

The AniZone integration uses the application's injected HTTP client; it never runs page JavaScript or a shell command. IDs retain AniZone's own title slug and episode number. Episode pagination raises an explicit error on malformed continuation data rather than silently presenting an incomplete list. Five focused adapter tests cover inert JSON parsing, safe IDs, episode availability, pagination and cancellation, failure propagation, and HLS/subtitle normalization.

## Integration contract

The [SDK server implementation](https://github.com/hexxt-git/anime-sdk/blob/master/src/server/index.ts) and [types](https://github.com/hexxt-git/anime-sdk/blob/master/src/types/index.ts) define a convenient adapter contract:

```text
search(query, { signal })
  -> [{ id, title, providerId, catalogType, thumbnailUrl?, year?, availableLanguages? }]

fetchContentUnits(mediaId, { signal })
  -> [{ id, number, title, availableLanguages }]

resolveStream(unitId, language, { signal })
  -> { type: "video", streams: [{ sourceUrl, isHLS, quality, language,
                                headers?, subtitles? }] }
```

IDs are opaque provider URNs such as `animeparadise:<raw-id>`. Do not strip the provider and substitute another site's numeric ID. Match a replacement title carefully, then use that site's own episode ID. A subtitle field may contain a language label and VTT URL; the player must still validate supported format and accessibility.

If a separate stock SDK server is used, its documented routes are:

```text
GET /search?provider=animeparadise&q=<query>
GET /content?provider=animeparadise&mediaId=<encoded-URN>
GET /stream?provider=animeparadise&unitId=<encoded-URN>&language=sub
GET /tracks?provider=animeparadise&unitId=<encoded-URN>&language=sub
GET /health
GET /openapi.json
```

These are the SDK's upstream routes, not necessarily the application's public API routes. `tracks` can legitimately return 501. An HTTP 200 containing an error object, empty streams, or only iframe embeds must count as failure for TV playback.

Anivexa's [current documented contract](https://github.com/walterwhite-69/Anivexa-API#routes) uses AniList IDs and `GET /episodes/:anilistId`, optional provider filtering, then `GET /watch/:provider/:anilistId/sub|dub/:provider-:episode`. Returned shapes are provider-specific; the observed AniKoto `ssub` envelope differs from AnimeGG's top-level `streams`. A general adapter requires explicit normalization and verified identity mapping, not just a base-URL swap.

## Reliability requirements for this TV app

1. Track provider family separately from adapter name; skip duplicate failed families during automatic fallback.
2. Verify a usable HLS/MP4 descriptor and preserve required Referer headers through the local service. Keep iframe pages out of the native player.
3. Preserve series, episode number, selected audio, and saved playback position when switching. Do not silently switch to a sequel, a similarly named title, or Portuguese audio.
4. Use bounded timeouts and cooldowns; a blocked provider must not stall the remote interface.
5. Re-resolve expired media URLs. Save provider IDs and progress, not long-lived assumptions about signed CDN URLs.
6. Show last probe result and its timestamp; do not claim shutdown detection from a single transient failure.
7. Keep research candidates separate from enabled adapters. Add an adapter only after search → exact series → episode → video has been tested.

Free software/API access does not establish a license to redistribute upstream anime. This pass assesses technical integration and availability, not distribution rights. No paid proxy or anti-bot service is required or purchased by the proposed initial implementation.
