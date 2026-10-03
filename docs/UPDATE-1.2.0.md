# AniHarbor 1.2.0

Update **both the server and TV app**. No Windows switch is needed to build on this Mac.

1. Stop the old server. Extract `AniHarbor-1.2.0-source.zip` over your project files. Keep the existing `.data` directory and Samsung certificates; neither is included in this archive.
2. Start the server with `npm start`. If dependencies are missing, use `npm install --ignore-scripts` or `pnpm install --frozen-lockfile --ignore-scripts` first.
3. Refresh the browser preview. TV & Movies opens to **For you**; Sports opens game rows.
4. Install `dist/AniHarbor.wgt` using [INSTALL-TV.md](INSTALL-TV.md). It is signed with the existing **Vogat** profile. The TV must be authorized by that certificate; retain the same author certificate when updating.
5. Keep your TV Settings pointed at the computer's current LAN address and pairing code. Keep the computer awake while watching.

## TV & Movies

- Continue Watching resumes the exact movie/video, including a video inside a multi-episode item. Recent titles come first. Completed items are omitted, and progress bars appear once duration is known.
- Existing saved positions are retained and enriched with refreshed title/episode metadata. History remains local to each device, so browser viewing does not automatically appear on the TV.
- Recommendations rank unseen archive titles using shared subjects/genres and creators from watched titles, with an explanation on each card. Thirty seconds of viewing, or completion, qualifies a title for recommendations. The server looks up up to 12 recent watched item IDs for metadata and related candidates; the browser computes the ranking from local history. The catalog remains Internet Archive classics.
- Both rows scroll horizontally and have **View all** pages. Back restores the selected card and row position. Live channels have no saved playback position.

## Sports

- Separate NFL, NBA, WNBA, MLB, NHL and MLS rows. Filter by league, schedule day, live/upcoming/finished status, and team/matchup. Previous/Next day moves through dates without a keyboard.
- **League schedule** uses each league's current scoreboard, which can include a completed round or an upcoming game. Daily schedules follow the feed's US Eastern sports calendar; start times display in the device's time zone.
- View all opens a paginated game grid. Select a game to see start time, status, venue and listed broadcasters. Back restores your filters, selected game and horizontal position.
- Schedule data refreshes every minute. A failed league does not hide the others; saved schedules up to six hours old are explicitly marked stale.
- **Game listings do not include game streams.** There is no verified in-app NFL/NBA game playback source. Broadcast names identify a separate service, potentially with subscription or region limits. No CBS game is routed to the unrelated CBS Sports Golazo channel. The existing five live sports channels remain separate.

See [VALIDATION.md](VALIDATION.md) for actual checks. Physical TV installation and remote/AVPlay behavior remain to be tested on the Samsung.
