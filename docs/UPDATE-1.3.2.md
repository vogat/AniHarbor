# AniHarbor 1.3.2 — Episode availability and fallback repair

The reported Prince of Tennis Nationals OVA episode 1 (SUB, MegaPlay/AniList 995) is still unavailable from the checked sources. MegaPlay returns an error page for its episode mapping. Its episode list is generated from AniList metadata, which does not prove that a stream exists. HiAnime's search returns the separate Finals OVA; AnimeParadise returns U-17. Neither is a safe replacement for this season.

This update fixes the app behavior around that failure:

- An episode-specific missing mapping no longer puts the entire provider on cooldown.
- Independent sources are attempted first, followed by alternate catalog mappings that share a video host. Exact season, episode and audio matching still apply.
- The player displays individual source failure reasons instead of suggesting that waiting out a cooldown will always help.
- Metadata-generated episode lists are labeled as unverified before playback.
- Watch history and saved posters are retained.

## Update

The running Mac server has been updated. Refresh the browser to load the updated player.

For another computer, extract `AniHarbor-1.3.2-source.zip` over the project, retain the existing `.data` directory and certificates, and restart with `npm start`. For the TV, also install the included `dist/AniHarbor.wgt` using [INSTALL-TV.md](INSTALL-TV.md).

This update improves fallback and failure handling; it does not supply a working stream for Nationals episode 1. No new provider is represented as verified without a successful media check.
