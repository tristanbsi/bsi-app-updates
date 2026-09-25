#!/bin/bash
# Signs a built app with BSI's Developer ID and has Apple notarize it, so the crew never sees Gatekeeper's
# "can't be opened" / "Open Anyway" step and universal (Intel + Apple Silicon) builds install like any other app.
#
#   tools/notarize.sh /path/to/StandBy.app
#
# ONE-TIME SETUP (about 30 minutes, once per year for the fee)
#   1. Enroll in the Apple Developer Program as BSI Production (developer.apple.com/programs, US$99/year).
#      Use the info@bsiproduction.com Apple ID. Approval can take a day or two.
#   2. On this Mac, open Xcode › Settings › Accounts, add that Apple ID, click Manage Certificates,
#      then + › Developer ID Application. (Xcode is free from the App Store; only its Accounts pane is needed.)
#      Find the certificate's name in Keychain Access: it looks like
#        Developer ID Application: BSI Production LLC (ABCDE12345)
#      The letters in brackets are the Team ID.
#   3. Make an app-specific password at appleid.apple.com › Sign-In and Security › App-Specific Passwords.
#      Store it in the keychain once, so this script never needs it typed again:
#        xcrun notarytool store-credentials bsi-notary --apple-id info@bsiproduction.com --team-id ABCDE12345
#      (it asks for the app-specific password)
#   4. Put these in ~/.zshrc (or pass them when running):
#        export BSI_DEVELOPER_ID="Developer ID Application: BSI Production LLC (ABCDE12345)"
#        export BSI_TEAM_ID="ABCDE12345"
#        export BSI_APPLE_ID="info@bsiproduction.com"
#        export BSI_APP_PASSWORD_KEYCHAIN_ITEM="bsi-notary"
#
# After that, `node tools/release.js <app> --notarize --zip <folder>` signs, notarizes, staples and zips in one go.
# Code-only updates (.pmupdate / .sbupdate / .ldupdate) don't need notarizing: they run inside the already-notarized app.
set -euo pipefail

APP="${1:-}"
[ -d "$APP" ] || { echo "usage: tools/notarize.sh /path/to/App.app"; exit 1; }
for v in BSI_DEVELOPER_ID BSI_TEAM_ID BSI_APPLE_ID BSI_APP_PASSWORD_KEYCHAIN_ITEM; do
  [ -n "${!v:-}" ] || { echo "Set $v first (see the setup notes at the top of this script)."; exit 1; }
done
command -v xcrun >/dev/null || { echo "Xcode command line tools are needed: xcode-select --install"; exit 1; }
security find-identity -v -p codesigning | grep -q "$BSI_DEVELOPER_ID" || { echo "The certificate \"$BSI_DEVELOPER_ID\" isn't in this Mac's keychain (step 2 of the setup)."; exit 1; }

ENT="$(cd "$(dirname "$0")" && pwd)/entitlements.plist"
NAME="$(basename "$APP" .app)"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

echo "Signing $NAME with $BSI_DEVELOPER_ID…"
# Inside-out: helpers and frameworks first, then the app. --deep is not enough for Electron's nested helpers.
find "$APP/Contents/Frameworks" -type d \( -name "*.app" -o -name "*.framework" -o -name "*.dylib" \) -print0 2>/dev/null | sort -rz | while IFS= read -r -d '' f; do
  codesign --force --options runtime --timestamp --entitlements "$ENT" --sign "$BSI_DEVELOPER_ID" "$f"
done
find "$APP/Contents" -type f \( -name "*.dylib" -o -name "*.node" -o -name "*.so" \) -print0 | while IFS= read -r -d '' f; do
  codesign --force --options runtime --timestamp --sign "$BSI_DEVELOPER_ID" "$f"
done
codesign --force --options runtime --timestamp --entitlements "$ENT" --sign "$BSI_DEVELOPER_ID" "$APP"
codesign --verify --deep --strict --verbose=2 "$APP"

echo "Sending $NAME to Apple for notarization (usually 2–10 minutes)…"
ZIP="$WORK/$NAME.zip"
ditto -c -k --keepParent "$APP" "$ZIP"
xcrun notarytool submit "$ZIP" --keychain-profile "$BSI_APP_PASSWORD_KEYCHAIN_ITEM" --wait

echo "Stapling the ticket to $NAME…"
xcrun stapler staple "$APP"
spctl --assess --type execute --verbose=2 "$APP"
echo "Done: $APP is signed, notarized and stapled. Gatekeeper will open it without the Open Anyway step."
