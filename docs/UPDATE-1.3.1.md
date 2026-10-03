# AniHarbor 1.3.1 — Saved poster repair

This fixes the missing Continue Watching artwork shown for Naruto and Attack on Titan. Their old image links expired independently of the refreshed Discover feed. The old failure handler then left placeholders indefinitely.

- Poster links now survive server restarts and the old three-hour media expiration, provided the existing pairing secret is retained.
- Previously saved cards repair their artwork automatically. Watch history, selected episodes and resume positions remain intact.
- Failed images retry with bounded delays. Working posters share a bounded server cache, and image downloads remain restricted to validated public addresses and image content.
- The repair applies to saved anime, Continue Watching and on-demand media artwork. No history reset or clearing browser storage is required.

## Update

1. Stop the old server and extract `AniHarbor-1.3.1-source.zip` over the project. Retain the existing `.data` directory and Samsung certificates.
2. Start with `npm start` and refresh the browser. Older saved artwork may take a few seconds to recover on the first visit.
3. For the Samsung TV, update both the computer's server files and `dist/AniHarbor.wgt` using [INSTALL-TV.md](INSTALL-TV.md). The package uses the existing Vogat certificate profile.
4. Keep the existing pairing code/server configuration and the computer awake while watching.

The running Mac server has already been updated. This archive includes the signed TV package, but no pairing code, private certificate or viewing history. See [VALIDATION.md](VALIDATION.md) for the checks.
