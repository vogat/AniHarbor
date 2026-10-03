# AniHarbor 1.3.0 — Live game playback

Update **both the server and TV app**. The Mac can build and run this version; switching to Windows is unnecessary.

1. Stop the old server and extract `AniHarbor-1.3.0-source.zip` over the project. Keep your existing `.data` directory and Samsung certificates; neither is in the archive.
2. Run `npm start` (install dependencies first if this is a fresh extraction).
3. Refresh the browser. Open Sports → a live game → **Play best available**, or select a named source.
4. Install `dist/AniHarbor.wgt` using [INSTALL-TV.md](INSTALL-TV.md). The package uses the existing Vogat certificate profile. The TV must be authorized by that certificate.
5. Keep the computer awake and the TV pointed at the computer’s current LAN address and pairing code.

## What changed

- Game details now discover game-specific Matchora and StreamCenter video choices. These use two distinct video hosts, although discovery shares a WatchSports event index and third-party listings.
- Exact ESPN game ID, both teams and start time are checked before source discovery. A broadcaster name alone never counts as a video source.
- The server checks the live playlist and actual video bytes before handing playback to the Samsung AVPlay/browser player. Embedded web pages and their scripts are not loaded into the TV app.
- Failed options fall back; **Try another source** also advances manually. Back returns to the source chooser and then the original filtered game row.
- Expiring video links renew server-side behind a stable local playlist address. Segment URLs remain stable across sliding playlist updates, fixing live HLS sequence errors.
- Finished games explain that replay is unavailable. Future games prompt you to return within 15 minutes of their start. Not every listed game has working coverage.

## Source research

[WatchSports](https://watchsports.su/) supplies event-specific links; [Sports247](https://en.sports247.ru/) exposes Matchora channel choices; TSNSports links lead to [StreamCenter](https://streame.center/) game players. Availability is checked anew when playing.

[Streamed](https://streamed.st/docs) has a working match API, but tested sources depend on an embedded-player system. Current PPV catalog discovery worked while its tested embed endpoint failed TLS checks. Tested StreamEast domains also failed TLS checks. Those candidates are not presented as working TV sources.

See [VALIDATION.md](VALIDATION.md) for test evidence and limits. No promise of universal NFL/NBA coverage or uninterrupted upstream availability is made. Physical playback on the Samsung still needs checking.
