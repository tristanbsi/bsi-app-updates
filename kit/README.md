# The shared app kit

The pieces every BSI desktop app (PatchMap, StandBy, Loader) has in common live here once, and
`node tools/sync-kit.js` copies them into each app. `node tools/sync-kit.js --check` says which app copies
have drifted (the feed's CI does not run it, since the app repos are private; run it before a release).

| File | What it is | Goes to |
| --- | --- | --- |
| `updater.js` | checks the feed, verifies the signature, downloads a release | PatchMap `code/`, StandBy `host/lib/`, Loader `lib/` |
| `app-updates-core.js` | installs an update into its own folder, picks which folder starts, Go Back, pruning | same `lib/` folders |
| `feedback.js`, `feedback-preload.js`, `feedback.html` | Help › Send Feedback… window and the POST to the collector | same `lib/` folders |
| `changelog-page.js` | renders `CHANGELOG.md` or `changelog.json` into the manual's What's new | next to each app's `manual.html` |
| `ci/test.yml` | a GitHub Actions workflow that runs `npm test` | copy to `.github/workflows/test.yml` |

## How an app uses each piece

**updater.js** — drop-in, unchanged from before.

**app-updates-core.js** — the app keeps a tiny `lib/app-updates.js` (its `boot.js` still requires that name):
```js
module.exports = require('./app-updates-core').createAppUpdates({
  appId: 'loader', appName: 'Loader', dataFolder: 'Loader', devEnv: 'LOADER_DEV_CODE_ROOT',
  writeFileDurably: require('./store').writeFileDurably,   // optional; the core has its own
});
```
StandBy passes `dataFolder: 'ShowCall'` (its data folder kept the old name on purpose) and `devEnv: 'STANDBY_DEV_CODE_ROOT'`.
The API is the same as before: `codeRoot, pickCodeDir, installUnpacked, goBack, readCurrent, versionOf`.

**feedback.js** — `setupFeedback(opts)` once, `openFeedback()` from a menu item, as PatchMap and StandBy already do.
New: `opts.palette` / `opts.paletteDark` give the window the app's own colours
(`{ bg, panel, ink, muted, line, accent, accentInk, danger, ok }`, any subset). Loader can use the one-call form
`openFeedback({ app: 'loader', appName: 'Loader', version: '0.4.0', configPath: '/…/feedback.json' })`.
`feedback.json` (`{ "url", "key" }`) stays gitignored in each app; PatchMap's copy is the reference.

**changelog-page.js** — in the main process:
```js
const { renderChangelog } = require('./web/changelog-page');
const html = renderChangelog(fs.readFileSync('CHANGELOG.md', 'utf8'), { current: CODE_VERSION });
```
or in the manual page itself (`<script src="changelog-page.js">` then `window.renderChangelog(text, { current })`).
It takes markdown (`## 0.3.1 · 2026-09-24` + `- items`) or the JSON list form. `latestNotes(text)` gives the
newest entry as one plain line, which `tools/release.js` uses for the feed's release notes.

## Changing the kit
Edit here, run the tests (`npm test` in this repo), then `node tools/sync-kit.js` and commit each app.
Never edit the copies inside the apps; the next sync would undo it.
