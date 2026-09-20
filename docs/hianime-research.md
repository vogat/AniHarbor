# HiAnime / ZokoAnime live check

Checked 2026-09-19 (US Eastern) / 2026-09-20 (UTC).

Current [ani-cli source](https://raw.githubusercontent.com/pystardust/ani-cli/master/ani-cli) identifies `hianime.at` and its ZokoAnime server as a current integration route. Its public search page, JSON episode list, and JSON server list were inspected. The implementation in `server/hianime.mjs` reads those routes and the public player configuration; it does not execute site scripts or require account credentials.

The HiAnime server list also includes HD-1 and Vidstream-2 URLs pointing to **MegaPlay**. Those are **excluded** by this adapter. The `zokoanime` family contains only the `zokoanime.video` player, which resolved to `hls.1embed.buzz` in this check. A separate host does not establish independent ownership; it establishes a distinct observed playback route from the currently configured MegaPlay and AnimeParadise routes.

| Check | Observed result |
|---|---|
| Search `Naruto` | 28 results; exact series `Naruto` selected |
| Episode list | 220 entries, correct series slug checked |
| Episode 1, sub | HLS master HTTP 200; one English subtitle descriptor |
| Episode 1, dub | HLS master HTTP 200; one subtitle descriptor |
| Sub master and variant | HTTP 206, valid `#EXTM3U` signatures |
| Sub first media segment | HTTP 206, 8 KiB sampled, `video/mp2t`, transport stream sync byte `0x47` |
| English caption | HTTP 200, `WEBVTT` signature |

Only limited bytes were fetched; no full episode was downloaded. These checks do not prove full-episode playback, correct audio/content, subtitle synchronization, coverage of other titles, or Samsung TV compatibility. Stream URLs are resolved fresh and not saved in this report.

The four adapter fixture tests cover sidebar exclusion/deduplication, series identity validation, exact audio selection with MegaPlay excluded, and refusal of a non-HLS player URL. Search and episode metadata declare sub/dub as candidate modes; the server list is authoritative and the adapter fails cleanly when the requested audio has no ZokoAnime entry.
