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
