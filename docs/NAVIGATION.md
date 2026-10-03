# Using AniHarbor with the Samsung remote

Use the arrows to move the highlighted selection, **OK** to open it, and **Return** to go back. The coral outline shows what will open when you press OK.

## Discover and search

- **Recommended** contains popular picks, rather than personalized suggestions based on your watch history.
- **Newly Released** helps find recent shows. Release information comes from the metadata feed; a listed show is not a guarantee of playable episodes on a provider.
- Move left and right through each Discover row. Open **View all** for a separate page with more results.
- Search results combine matching provider listings. Open a show to choose its season and provider. Movies remain separate titles.
- Back from a show returns to the card you opened. This also works when returning to a Discover collection page.

## Inside a show

Choose a season, then choose one of the providers that lists that season. Provider and season changes load a fresh episode list. Episode pages keep long-running shows manageable with a remote.

Choose **SUB** or **DUB**, then an episode. Saved playback is associated with the actual provider and season, so an episode ID from a previous selection cannot start a different provider's episode. Resume is offered when it matches the selection.

## While watching

Press an arrow or OK to reveal the controls. The remote's Play/Pause, Stop, Rewind and Fast Forward keys work too. Return closes the player and takes you back to the episode list. The on-screen buttons provide subtitles, seeking, another source and the next episode.

## Keyboard and TV checks

On Samsung, select the search box with OK to open the on-screen keyboard. Done submits the search; Cancel closes the keyboard. For the server address and pairing code, finish entering each field and use **Save & connect**.

The app targets the 2016 TV's Tizen 2.4 engine. Browser keyboard checks and ES5 parsing help catch compatibility problems; the physical TV still needs a check for remote repeat behavior, its on-screen keyboard, visible focus near the screen edges and AVPlay.

Samsung references: [remote keys](https://developer.samsung.com/smarttv/develop/guides/user-interaction/remote-control.html), [keyboard/IME](https://developer.samsung.com/smarttv/develop/guides/user-interaction/keyboardime.html), [navigation design](https://developer.samsung.com/smarttv/design/input-methods.html), [TV web engines](https://developer.samsung.com/smarttv/develop/specifications/web-engine-specifications.html).

## Repeatable development checks

Run `node scripts/ui-fixture.mjs` to open a separate local navigation lab on port 8788. Its clearly identified fixture catalog contains three seasons, three providers, long episode lists and multi-page discovery collections. Search `empty` or `error` to check those states. The lab does not contact anime providers and deliberately does not play video; the production preview remains on port 8787.

## Sports and TV & Movies (1.1.0)

Sports opens public live channels. TV & Movies offers Live channels, Movies on demand and TV on demand. Arrow keys move between tabs, cards and controls; OK opens the selection. Multi-video archive items show 24 episodes/videos per page. Back leaves the player, then returns to the library with the previous channel/card focused. Live playback shows LIVE and disables seeking and next episode. On-demand playback supports resume and seeking; TV collections also offer Next episode.

Discover rows and collection pages refresh every five minutes without moving the focused card or resetting horizontal scroll. Cached content stays visible if a background refresh fails.

## TV & Movies and Sports in 1.2.0

TV & Movies opens **For you**. Left/Right scrolls through Continue Watching or recommendations; Up/Down moves between rows and their View all buttons. Selecting a Continue Watching card resolves the exact saved video and resumes it. View all pages use grids of up to 24 cards with explicit page buttons. Return restores the selected card and scroll position. Movies, TV and Live channels remain in the top collection buttons.

Sports has league, day and status button rows, plus team/matchup search. Previous/Next day avoids keyboard date entry. Left/Right moves across games; Up/Down moves between leagues and filters. View all opens a game grid, and Return goes back through game details → grid → filtered rows. Game cards open source discovery. The separate live channel row still opens the player. Schedule refresh preserves the focused control and row positions.

## Live game playback in 1.3.0

Select a game → Play best available, or choose a named source. Every option is a normal remote-focusable button. Try another source advances to an untried source; failed sources also fall back automatically. Back returns to the game’s source choices, then to the original filtered row/grid and selected card. Finished games and games more than 15 minutes away explain when live sources are unavailable. Live video has no resume history or seeking.
