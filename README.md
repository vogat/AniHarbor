# AniHarbor

A personal anime, sports and media TV app for the Samsung **UN60KU630DFXZA (2016, Tizen 2.4)**. The TV runs a remote-friendly interface and Samsung AVPlay. A Node.js service on your computer handles source APIs, fallback, and media compatibility. The computer must stay awake while watching.

Version **1.3.2**: see [update instructions](docs/UPDATE-1.3.2.md) and [current verification](docs/VALIDATION.md).

## Run on your computer

Install Node.js 22 or newer, then open this folder in a terminal:

```sh
npm install --ignore-scripts
npm start
```

Open `http://localhost:8787`. In **Settings**, enter the pairing code printed in the terminal. Leave the server address blank for the computer browser. On the TV, enter the computer's printed network address as well as the code. The code is generated locally in `.data/pairing-token`; it is excluded from source control and transfer archives.

This repository includes a `pnpm-lock.yaml` for exact reproducible installs with `pnpm install --frozen-lockfile --ignore-scripts`. `npm install` uses pinned direct dependencies but resolves transitive versions afresh.

## What is implemented

- Anime search combines duplicate provider listings into show cards. Season and provider choices are inside each show; movies stay separate.
- Discover has scrolling Recommended and Newly Released rows, each with its own paginated collection page. Popular picks and recent episode metadata come from Jikan/MyAnimeList; they do not guarantee source availability.
- Sports has separate scrolling NFL, NBA, WNBA, MLB, NHL and MLS game rows, league/date/status/team filters, full collection pages, and broadcast details. Schedules come from ESPN’s public scoreboard feed. Game details now discover Matchora and StreamCenter choices through exact-event listings; Play checks real media and falls back between available choices. Short-lived HLS links renew on the server. Coverage varies by game. Five live sports channels remain separately available.
- TV & Movies includes Continue Watching with exact-video resume and local-history recommendations based on shared genres/creators, plus three live channels and searchable Internet Archive classics. Both home rows have full collection pages. Older resume positions are retained.
- Discover refreshes every five minutes, preserves focus, and displays richer show/season metadata when available. Related OVA/special entries participate in franchise grouping.
- Episode paging, sub/dub where available, WebVTT/SRT subtitles.
- Samsung remote D-pad, Return, playback and seek keys; mouse and keyboard preview.
- Saved series and continue watching stored on each device.
- Automatic source fallback with an exact normalized series title, matching year when available, exact episode number, and matching audio type. Ambiguous titles require manual source selection.
- Failover skips providers sharing a source family and checks real video bytes before opening a source. Known failing adapters are disabled.
- Bounded request timeouts, cooldowns, search/episode caching, and uncached stream resolution.
- Media relay for HLS playlists, segments, keys, MP4 ranges, images and subtitles. URLs have opaque, expiring grants; private network destinations are rejected. SDK extraction also uses a guarded HTTP transport rather than the SDK's shell-based curl fallback.
- Tizen manifest and build/signing scripts, plus Windows setup instructions.

See [the remote navigation guide](docs/NAVIGATION.md) for the new browsing and selection controls. Season grouping uses explicit season labels and verified metadata relationships when available. Ambiguous remakes and unrelated titles are kept separate; incomplete provider metadata can still require a separate title search.

## Source reliability

**Configured does not mean working.** AnimeParadise is the currently verified anime playback source. HiAnime, AniKoto and MegaPlay share MegaPlay delivery: extraction has been updated, but their current host fails TLS and playback checks fall back to a matching independent source. AllAnime, AniNeko, Goyabu and AniZone are disabled after failures. Three working independent anime providers have **not** been established. See [current validation](docs/VALIDATION.md), [research](docs/provider-research.md), and [live checks](docs/live-probe.json). No provider has guaranteed availability.

Source status in the app is observational: `untested` means no request yet, `reachable` means a catalog request worked, `resolved` means the provider returned video links, and `cooldown` means a recent request failed. None of those labels certifies full playback. Links and upstream protocols can change. A signed URL may expire; reopen the episode to resolve it again.

## Put it on the Samsung TV

Follow [INSTALL-TV.md](docs/INSTALL-TV.md). [WINDOWS.md](docs/WINDOWS.md) covers the easiest move to your Windows development machine.

```sh
npm run build:tv
npm run package:tv -- YourSamsungCertificateProfile
```

The first command produces an **unsigned app directory** in `dist/tv`. The second requires Samsung's SDK and your Samsung TV certificate profile, and creates a signed `.wgt`. No unsigned archive is presented as an installable app. Samsung account sign-in and the TV's DUID are needed for signing. Actual AVPlay behavior, subtitle sync, remote controls and persistence must be checked on the physical TV.

Samsung documents limitations on development-installed apps persisting after power-off or SDK disconnection. This project does not promise a permanent Smart Hub installation. See the installation guide's official references.

## Developer commands

```sh
npm test
npm run probe -- Naruto
npm run build:tv
```

`probe` performs read-only search, episode, stream and nested-playlist and initial video-byte checks, writing `docs/live-probe.json`. It does not watch entire episodes. Automated tests use fixtures to verify fallback rules and relay behavior; they are distinct from live provider checks.

Server configuration: `PORT` defaults to `8787`, `HOST` to `0.0.0.0`; optional `ANIHARBOR_TOKEN` overrides the generated pairing code (12+ characters). Keep the service on your private home network, allow the Windows firewall only on that network, and do not forward its port from the internet.

## Project layout

| Folder | Purpose |
| --- | --- |
| `tv/` | ES5 frontend, Samsung AVPlay, remote controls, manifest |
| `server/` | Provider adapters, fallback orchestration, media relay, HTTP server |
| `scripts/` | Live provider probe and Samsung build/signing helpers |
| `test/` | Automated logic, compatibility and HTTP checks |
| `docs/` | Research, validation evidence and TV/Windows installation |

Known limits: saved poster URLs expire with the server's media grants and may show placeholders until a new search; playback progress is local to each device, not synced. No automatic transcoding, DRM handling, ASS styling, public app-store distribution, or guaranteed permanent development installation is included. Long provider resolution can show a loading state up to approximately 65 seconds.
