# BSI app updates

The public update feed for BSI Production's desktop apps. **PatchMap**, **StandBy** and **Loader** check it from
**Check for Updates…** (and quietly at launch) and install new code without reinstalling the app.

This repo also holds the **shared app kit** (`kit/`, the updater, feedback window and changelog page every app
vendors) and the **release command** (`tools/release.js`) that takes an app from "version bumped" to "on the feed"
in one go.

Only built, signed update packages live here. Source code lives in private repos.

```
patchmap/latest.json          newest PatchMap release: version, notes, file, sha256, size, signature
patchmap/PatchMap-X.Y.Z.pmupdate
standby/latest.json
standby/StandBy-X.Y.Z.sbupdate
loader/latest.json
loader/Loader-X.Y.Z.ldupdate
trusstape/latest.json
trusstape/TrussTape-X.Y.Z.ttupdate
kit/                          the shared app kit: updater, app-updates core, feedback window, changelog page, CI template
tools/release.js              the one release command (checks, tests, builds, signs, publishes, verifies)
tools/sync-kit.js             copies the kit into each app; --check reports drift
tools/publish.js              signs a package and adds it as the latest release (release.js calls it)
tools/notarize.sh             Developer ID signing + Apple notarization for a built app (one-time setup inside)
tools/make-drive-zip.sh       builds the first-install zip for the Drive folder
zip-extras/<app>/             READ ME FIRST.txt and sample files that go in each zip
tests/                        node --test
```

## How a release is trusted
- Every `latest.json` is signed with an Ed25519 key that only exists on the release Mac
  (`~/.config/bsi-updates/signing-key.pem`). Its public half is built into each app (`client/updater.js`).
- The app refuses a release whose signature, size or SHA-256 doesn't match, or that is for another app.
  So even someone who could change this repo couldn't get code into the apps without that key.
- **If the signing key is lost**, new releases can't be published to installed copies until each Mac gets a
  full reinstall with a new key built in. The key is backed up (Tristan, 2026-09-25). If this Mac is ever replaced,
  restore it to `~/.config/bsi-updates/signing-key.pem` before releasing anything.

## Releasing
One command per app. It refuses to go on at the first thing that's wrong and says why in plain words.
```sh
cd ~/bsi-app-updates
node tools/release.js status              # what's here vs what's on the feed
node tools/release.js standby --dry-run   # checks only: committed? version bumped? changelog, manual, README? tests?
node tools/release.js standby             # …then builds the package, signs it, adds it to the feed, re-checks it
git push                                  # this is the moment the apps can see it (or pass --push)
node tools/release.js verify standby      # GitHub has the same, properly signed release
```
Before running it: bump the version (`package.json`, or `code/version.json` for PatchMap), add the changelog entry,
update the manual and README, commit. The command checks all of that. Options:
- `--dir <folder>` when the app isn't in its usual place (Loader's work lives in a worktree for now; `BSI_LOADER_DIR` also works)
- `--notes "…"` release notes for the feed (default: the newest changelog entry, or PatchMap's `version.json` notes)
- `--min-shell X.Y.Z` when a release needs a newer copy of the app itself; older installs are told to reinstall
- `--no-publish` builds but stops before signing; `--allow-same-manual` when a release truly changes nothing a user sees
- `--notarize` signs the built app with the Developer ID and notarizes it (`tools/notarize.sh` explains the one-time Apple setup)
- `--zip <folder>` also builds the first-install zip for Drive (`tools/make-drive-zip.sh`)

`node tools/release.js verify-local` checks every `latest.json` in this repo (the CI workflow runs it).
The old way (`publish.js` by hand) still works underneath.

## The shared kit
See `kit/README.md`. After editing anything in `kit/`, run `node tools/sync-kit.js` and commit each app.
`node tools/sync-kit.js --check` lists app copies that don't match the kit.
