# BSI app updates

The public update feed for BSI Production's desktop apps. **PatchMap** and **StandBy** check it from
**Check for Updates…** (and quietly at launch) and install new code without reinstalling the app.

Only built, signed update packages live here. Source code lives in private repos.

```
patchmap/latest.json          newest PatchMap release: version, notes, file, sha256, size, signature
patchmap/PatchMap-X.Y.Z.pmupdate
standby/latest.json
standby/StandBy-X.Y.Z.sbupdate
client/updater.js             the checker built into each app (copied out with tools/sync-client.js)
tools/publish.js              signs a package and adds it as the latest release
```

## How a release is trusted
- Every `latest.json` is signed with an Ed25519 key that only exists on the release Mac
  (`~/.config/bsi-updates/signing-key.pem`). Its public half is built into each app (`client/updater.js`).
- The app refuses a release whose signature, size or SHA-256 doesn't match, or that is for another app.
  So even someone who could change this repo couldn't get code into the apps without that key.
- **If the signing key is lost**, new releases can't be published to installed copies until each Mac gets a
  full reinstall with a new key built in. Keep a backup of `signing-key.pem` somewhere safe (a password manager).

## Releasing
```sh
# PatchMap: bump ~/patchmap/code/version.json (version + notes), then
~/patchmap/tools/build-pmupdate.sh
node tools/publish.js patchmap ~/patchmap/dist/PatchMap-X.Y.Z.pmupdate

# StandBy: bump host/package.json version, then in ~/bsi-showcall-app/host
STANDBY_OUT=dist-release npm run package && npm run update-package -- "What changed, in one or two sentences."
node tools/publish.js standby ~/bsi-showcall-app/host/dist-updates/StandBy-X.Y.Z.sbupdate

git push     # this is the moment the apps can see it
```
Pass `--min-shell X.Y.Z` when a release needs a newer copy of the app itself. Apps older than that are told to
reinstall instead of taking the update.
