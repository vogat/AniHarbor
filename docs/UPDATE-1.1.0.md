# Update to AniHarbor 1.1.0

Update **both the computer server and TV app**. The streaming repair lives in the server; installing only the WGT will not fix an old server.

1. Stop the old server. Extract `AniHarbor-1.1.0-source.zip` into your app folder, replacing the included files. Keep your existing `.data` folder and certificate files; the ZIP contains neither.
2. Run `npm install --ignore-scripts` if dependencies are missing, then `npm start`. With pnpm, use `pnpm install --frozen-lockfile --ignore-scripts`.
3. Refresh the browser preview. Sports and TV & Movies should appear beside Search.
4. Install `AniHarbor.wgt` using the steps in [INSTALL-TV.md](INSTALL-TV.md). This package was signed on the Mac with the existing **Vogat** profile. It can only install on TVs authorized by that profile's distributor certificate. Keep the same author certificate when updating an existing installation.
5. Open Settings on the TV and use the computer's current printed LAN address and pairing code. The Mac's address during this build was `http://192.168.1.155:8787`; use the server's current value if it changes.

The TV was not connected to SDB during this update, so the package is built and signed but has not been installed or physically tested.

## Included

- Restored AnimeParadise segment playback and added video-byte checks before selecting an anime source.
- Updated HiAnime/AniKoto/MegaPlay URL extraction; these share one delivery family. Their delivery host currently fails TLS, so a matching independent source is tried. English dub availability is not currently verified.
- Disabled failing AllAnime, AniNeko, Goyabu and AniZone choices. Their status remains visible in Sources.
- Applied the supplied 1.0.1 fixes: related OVA/special seasons and aliases, richer show information, and five-minute Discover refresh. Background refresh preserves remote focus and row position.
- Sports: beIN SPORTS XTRA, Red Bull TV, CBS Sports Golazo Network, Fubo Sports Network and Billiard TV.
- TV & Movies: FilmRise Classic TV, MovieSphere and RetroCrush live channels, plus searchable Internet Archive classic films and TV. Multi-video items have explicit episode selection and pagination. This is not a complete current-release movie/TV catalog.
- Remote navigation, live-mode controls, on-demand resume, and exact-episode fallback.

See [VALIDATION.md](VALIDATION.md) for what actually played and the remaining provider limitations.
