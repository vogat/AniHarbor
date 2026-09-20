# Validation — September 19, 2026

The app is built and runs locally. It has **not been installed or tested on the physical Samsung TV**. There is no signed WGT yet because no Samsung certificate profile, TV DUID, SDK CLI, or TV connection was supplied.

## Browser integration

Tested in the Codex in-app browser against the real local server:

- Pairing by generated local token; token removed from the bootstrap URL.
- Search Naruto through AnimeParadise, receive real artwork and 16 results.
- Open the exact series and list 220 episodes with episode titles.
- Play episode 1. AnimeParadise eventually failed an HLS fragment request.
- Automatic fallback resolved the exact series and episode through HiAnime/ZokoAnime.
- **Decoded episode video appeared and playback advanced beyond one minute**, with a displayed duration of 23:20 and English subtitles.
- Pause changed the player to Play and preserved position at 1:02.

This was a short playback check, not a full-episode endurance test. It proves the local browser integration and one real fallback path, not all series, languages, sources, codecs or Samsung AVPlay.

## Provider evidence

See `live-probe.json`, `playback-smoke.json`, `hianime-research.md`, and `provider-research.md`.

- HiAnime/ZokoAnime: sub/dub playlist checks; a media segment and WebVTT check; short subbed episode playback in the application.
- AnimeParadise: search, episodes, master and child playlist, transport-stream bytes, and subtitle text verified through the relay. Browser playback hit a fragment error, demonstrating the need for fallback.
- AllAnime/AllManga: search and episodes respond; current episode-stream protocol returns an upstream GraphQL error.
- AniNeko: no results in the SDK smoke check.
- AniKoto and MegaPlay: stream resolution failed; they share a video family.
- Goyabu: search failed; Portuguese-only, manual.
- AniZone: independent search/list/descriptor checks passed with Cowboy Bebop; its media CDN failed TLS locally. The integrated Naruto pagination probe also failed. Manual candidate only.

**Three independent working sources have not been established.** Eight configured adapters represent seven observed entry-point families, with only two passing playlist checks and one completing the short browser playback check. The report lists more candidates and their failure evidence rather than labelling them healthy.

## Automated checks and build

Tests cover partial search outage, exact series/year/episode/audio matching, shared-family exclusion, ambiguous titles, timeouts/cooldowns, request deduplication, manual-language isolation, Tizen ES5 syntax, HTTP pairing/path isolation, private-address rejection, HLS rewriting, expiring media grants, and the custom adapter parsers. Fixture tests are separate from live provider verification.

`npm run build:tv` prepares `dist/tv`, including icon, manifest and player assets. The manifest parses as XML and targets Tizen 2.4. Package signing requires the official Tizen CLI and a user-created Samsung TV certificate. Follow `INSTALL-TV.md` and `WINDOWS.md`.
