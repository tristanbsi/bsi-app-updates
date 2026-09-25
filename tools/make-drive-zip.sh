#!/bin/bash
# Builds the first-install zip that goes in the Google Drive folder (people download it once; after that the app
# updates itself from the feed).
#
#   tools/make-drive-zip.sh <patchmap|standby|loader> /path/to/App.app <out folder>
#
# The zip holds the app, "READ ME FIRST.txt" and any sample files from zip-extras/<app>/ in this repo
# (edit those files there; the READ ME text is the same one that sits in the Drive folder as
# "<App> - how to install.txt"). Output: <out folder>/<App> <version>.zip
#
# PatchMap: the app bundle's own code is old (1.1.0), so the current code from ~/patchmap/code (or BSI_APP_DIR)
# is baked into the copy that goes in the zip, with the gear library as the seed and no rigs. Same as
# File › Share PatchMap with Another Mac…, minus the rigs.
set -euo pipefail

ID="${1:-}"; APP="${2:-}"; OUT="${3:-}"
[ -n "$ID" ] && [ -d "$APP" ] && [ -n "$OUT" ] || { echo "usage: tools/make-drive-zip.sh <patchmap|standby|loader> /path/to/App.app <out folder>"; exit 1; }
case "$ID" in
  patchmap) NAME=PatchMap ;; standby) NAME=StandBy ;; loader) NAME=Loader ;;
  *) echo "unknown app $ID"; exit 1 ;;
esac
HERE="$(cd "$(dirname "$0")/.." && pwd)"
EXTRAS="$HERE/zip-extras/$ID"
STAGE="$(mktemp -d)"; trap 'rm -rf "$STAGE"' EXIT
mkdir -p "$STAGE/$NAME" "$OUT"

echo "Copying $NAME.app…"
ditto "$APP" "$STAGE/$NAME/$NAME.app"
R="$STAGE/$NAME/$NAME.app/Contents/Resources/app"

if [ "$ID" = patchmap ]; then
  SRC="${BSI_APP_DIR:-$HOME/patchmap}"
  [ -d "$SRC/code" ] || { echo "No PatchMap code at $SRC/code (set BSI_APP_DIR)"; exit 1; }
  echo "Baking in the code from $SRC/code…"
  for f in $(ls "$SRC/code"); do rm -rf "$R/$f"; cp -R "$SRC/code/$f" "$R/$f"; done
  rm -rf "$R/seed"; mkdir -p "$R/seed/rigs" "$R/seed/assets"
  LIB="$HOME/Library/Application Support/PatchMap/data/library"
  if [ -d "$LIB" ]; then cp -R "$LIB" "$R/seed/library"; echo "Seed library: $LIB"; else echo "warning: no gear library at $LIB, the zip starts empty"; fi
  # Re-sign after changing the contents (keeps a Developer ID signature if the app had one, else ad-hoc)
  SIGNER="$(codesign -dv "$APP" 2>&1 | sed -n 's/^Authority=\(Developer ID Application:.*\)$/\1/p' | head -1)"
  codesign --force --deep --sign "${SIGNER:--}" "$STAGE/$NAME/$NAME.app"
fi

VER="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "$STAGE/$NAME/$NAME.app/Contents/Info.plist")"
if [ -f "$R/package.json" ]; then VER="$(node -p "require('$R/package.json').version" 2>/dev/null || echo "$VER")"; fi
if [ -f "$R/version.json" ]; then VER="$(node -p "require('$R/version.json').version" 2>/dev/null || echo "$VER")"; fi

if [ -d "$EXTRAS" ]; then
  for f in "$EXTRAS"/*; do [ -e "$f" ] || continue; [ "$(basename "$f")" = "README.md" ] && continue; cp -R "$f" "$STAGE/$NAME/"; done
fi
[ -f "$STAGE/$NAME/READ ME FIRST.txt" ] || echo "warning: no READ ME FIRST.txt in zip-extras/$ID/"

ZIP="$OUT/$NAME $VER.zip"
rm -f "$ZIP"
( cd "$STAGE" && ditto -c -k --sequesterRsrc --keepParent "$NAME" "$ZIP" )
codesign -v "$STAGE/$NAME/$NAME.app" && echo "Signature OK"
echo "Built: $ZIP ($(du -h "$ZIP" | cut -f1))"
echo "Next: upload it to the Drive folder and replace the old zip. If the READ ME changed, replace \"$NAME - how to install.txt\" there too."
