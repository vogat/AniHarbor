# Validation — September 29, 2026 · version 1.3.2

## Outcome

AnimeParadise anime playback is restored. Browser verification decoded Naruto episode 1, advanced beyond 2:13, displayed a 23:20 duration and English subtitles, and paused correctly. The original defect was valid MPEG-TS segments labelled `text/html`, `text/css`, `application/javascript`, `text/plain` and image types. The relay now validates TS packet sync bytes before normalizing those responses, including bounded removal of image prefixes; actual HTML is rejected.

HiAnime's current servers point to MegaPlay, not the previous ZokoAnime host. The MegaPlay public response is now encoded rather than `sources.file`. Native bounded decoding and segment URL handling were implemented without executing downloaded JavaScript. **HiAnime, AniKoto and MegaPlay are one delivery family, and the currently returned host fails TLS on this network.** An API smoke test selected HiAnime, detected the failed media check and returned the exact Naruto episode through AnimeParadise instead. Master/variant playlists, TS media and captions passed via the relay. English dub playback is not verified.

AllAnime (`AA_CRYPTO_MISSING`), AniNeko (upstream database connection refused), Goyabu (catalog failure) and AniZone (video-host TLS failure) are disabled. KAA returned catalog/master playlists but its segment hosts failed; AnimeGG and AniBD endpoints also failed TLS. These candidates were not labelled working or added as reliable backups. **Three independent working anime providers have not been established.**

## Sports and general media

Initial playlist and real video-byte checks passed for:

- beIN SPORTS XTRA, Red Bull TV, CBS Sports Golazo Network, Fubo Sports Network, Billiard TV.
- FilmRise Classic TV, MovieSphere, RetroCrush.

The Red Bull TV browser test advanced beyond 179 seconds. Live controls disable seeking/next episode, and Back restored focus to the selected channel. These are live channel feeds, including scheduled coverage and replays; specific games/leagues and all regions are not guaranteed.

Internet Archive movie/TV search, metadata, and MP4 range delivery passed. **His Girl Friday** decoded in the browser, advanced beyond 35 seconds with a 1:31:44 duration, and remote-key seeking worked. Sherlock Holmes (1954) exposed 39 explicit episodes across two pages; episode 25 decoded in the browser and advanced beyond 107 seconds. Alternate files are grouped by their original video, never treating another episode as a playback backup.

The on-demand collection contains archive classics, not a complete contemporary movie/TV subscription catalog. Initial channel definitions are bundled so a directory outage does not empty the tabs; direct alternatives refresh from IPTV-org hourly. Channel outages remain possible.

## Version 1.2.0 history and game browsing

Live ESPN scoreboard checks returned 16 NFL, 1 NBA, 2 WNBA, 4 MLB, 5 NHL and 1 MLS events during validation. These are a point-in-time check, not fixed catalog counts. The guarded HTTP client requires a normal identifying User-Agent. The integration uses whitelisted league paths, validated dates, a one-minute cache, per-league partial failures, and explicitly labelled stale data with a six-hour maximum. The source is the [ESPN public scoreboard feed](https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard); it is not a guaranteed stable API or a video service. No game is labelled playable based on a broadcaster name.

At a 1920×1080 browser viewport, D-pad/Enter/Back checks verified league filtering, horizontal scrolling (NFL row advanced 854 pixels), specific game details, focus and row restoration, View all grid navigation, and nested Back behavior. Team search for Chiefs returned only its matchup. NBA date filtering correctly showed no games on September 29; Next day advanced to September 30 while retaining button focus. The displayed start times used the device time zone.

TV & Movies hydrated existing legacy resume records for His Girl Friday and Sherlock Holmes (1954), retaining their positions. Selecting His Girl Friday resumed near 57 seconds and decoded beyond 79 seconds with a 5504-second duration. Returning updated the resume card to the new position. Recommendations displayed actual genre matches and reasons, with unknown/unmatched candidates identified as popular classics. Recommendation View all produced 24-item pages; page 2 and opening a TV detail were checked. Poster images loaded through fresh relay grants.

New tests verify history migration (including filenames containing colons), recent-title deduplication, completion handling, content-based ranking, exclusion of watched/reuploaded titles, metadata enrichment, sports normalization, request coalescing, cache expiry, partial league failure, invalid-date rejection and pairing on both new routes. Existing playback/security/ES5 regression checks remain included.

**No NFL/NBA game playback source has been verified.** In 1.2.0, Sports matchups opened schedule/broadcast details only. This was replaced by game source discovery in 1.3.0. No physical Samsung test occurred in this update.

## Version 1.3.0 live game sources

- Integrated public game listings from WatchSports, Sports247/Matchora and TSNSports/StreamCenter using guarded requests. Scripts from those sites are not evaluated.
- Direct playlist and MPEG-TS byte checks passed for WNBA Las Vegas/Indiana on both Matchora and StreamCenter, MLB Boston/New York on Matchora, and NHL Montreal/Toronto on Matchora. These are point-in-time source checks; schedules and third-party channel assignments can lag actual play or change to subsequent coverage.
- StreamCenter rotates numbered CDN hosts. Its adapter accepts that exact host family from the public player configuration and retains public-address validation, while rejecting lookalike domains.
- Browser testing exposed HLS sequence errors because the relay regenerated segment URLs on each playlist load. Per-playlist child grants now keep the same segment/key URLs as live playlists slide. A regression test covers overlapping sequence windows.
- After the relay fix, StreamCenter decoded 1280×720 video of Aces/Fever and advanced beyond 109 seconds; the on-screen scoreboard showed the matching teams. Pause/Resume and directional navigation skipped disabled seeking/next-episode controls. Matchora decoded 1920×1080 video; one channel subsequently returned an upstream 502 and automatic fallback selected a different Matchora channel. These sources are intermittent, not guaranteed.
- Tests cover exact team/date matching, constrained source traversal, cold-channel polling limits, media-validation fallback, renewable opaque URLs, simultaneous refresh coalescing, stable live segment URLs and pairing on game source/resolve routes.
- NFL and NBA game playback were not tested because no live games were available in the tested schedule. Coverage is not guaranteed. Discovery currently depends on one event index even though the two video hosts are distinct. Physical Samsung playback remains untested.

## Version 1.3.1 saved poster repair

Reproduced missing Naruto and Attack on Titan artwork in Continue Watching. Stored history contained expired in-memory `/media/` grants. Refreshing Discover did not renew the separate history objects, and the image error handler left permanent placeholders.

Poster images now use deterministic, signed image-only `/artwork/` URLs tied to the persistent pairing secret, without the media grant's three-hour lifetime. Requests retain guarded DNS/address checks and must return supported image signatures; HTML and forged links are rejected. A bounded shared image cache coalesces downloads and can retain cached artwork during an upstream outage. URLs are rebased to the configured server address on the client.

The client repairs older saved/history artwork by exact catalog identity/title, preserves episode/position/timestamps, and retries failed images with bounded delays. Repairs update image nodes without rebuilding the card row or moving focus. It reads the latest stored history before persisting image changes.

Browser verification restored the actual Naruto and Attack on Titan posters (natural widths 230 and 257 pixels), retained episode 1 positions 2:13 and 0:22, and preserved remote-arrow navigation. Automated tests verify that an issued poster URL works on a new server instance with the same secret, wrong-secret/tampered URLs are rejected, non-image payloads cannot be served, and resume data survives legacy repair. Physical TV verification remains outstanding.

## Version 1.3.2 missing-episode diagnosis

Reproduced the reported original Nationals OVA (AniList 995), episode 1, SUB. MegaPlay's `/stream/ani/995/1/sub` and `/stream/mal/995/1/sub` both returned HTTP 200 with an explicit missing-page error instead of a video configuration. An HTTP 200 response and a metadata-derived episode count are not proof of available video. HiAnime returned the separate Finals OVA; AnimeParadise returned U-17. AniKoto did not return the original OVA. These titles were not substituted.

Missing mappings now produce a sanitized episode-specific error without putting the entire provider on cooldown. Fallback prefers independent families, then tries distinct catalogs sharing a host, within the existing deadline and strict title/year/episode/audio checks. Player failure details show each attempted catalog. Metadata-derived lists carry an availability notice.

Browser verification at 1280×720 showed all four source reasons without overlapping controls. Arrow navigation remained usable; Back returned focus to episode 1. Physical Samsung playback remains untested.

Regression tests cover missing mappings versus host failures, cooldown isolation, redaction of upstream text, independent-first alternate mappings, and unverified metadata lists. **A working stream for Nationals episode 1 remains unverified and unavailable from the checked providers.** This update does not claim to restore that episode.

## Automated checks and packaging

83 automated tests pass with the delivered source. Tests cover exact title/year/episode/audio fallback, aliases, metadata OVA grouping, independent-first fallback and alternate shared-host mappings, media checks, URL decoding, bounded segment handling, private-address rejection, pairing, opaque relay links, explicit multi-episode selection, archive collection restrictions, and ES5 parsing for Tizen 2.4.

Samsung CLI build and package succeeded using the existing **Vogat** certificate profile. `dist/AniHarbor.wgt` is signed. No TV was connected in `sdb devices`, so installation, physical remote input, AVPlay codecs, subtitle timing, and persistence on the 2016 Samsung remain unverified. Browser smoke tests are short checks, not full-episode or multi-hour endurance tests.

See `live-probe.json` and `playback-smoke.json` for machine-readable anime checks; no signed upstream URLs or pairing tokens are saved there. Follow [UPDATE-1.3.2.md](UPDATE-1.3.2.md) to update both server and TV app.
