#!/bin/bash
set -euo pipefail

if [[ $# -ne 1 ]]; then
  printf 'Usage: %s output.dmg\n' "$0" >&2
  exit 2
fi
if [[ -z "${APPLE_SIGNING_IDENTITY:-}" ]]; then
  printf 'Set APPLE_SIGNING_IDENTITY to the Developer ID Application certificate in Keychain.\n' >&2
  exit 2
fi
if [[ "$(uname -m)" != arm64 ]]; then
  printf 'Run this script on Apple silicon.\n' >&2
  exit 2
fi

output="$(cd "$(dirname "$1")" && pwd)/$(basename "$1")"
notary_profile="${PRISM_NOTARY_PROFILE:-prism-notary}"
xcrun notarytool history --keychain-profile "$notary_profile" --output-format json >/dev/null

cd "$(dirname "$0")/.."
export APPLE_SIGNING_IDENTITY
CMAKE_POLICY_VERSION_MINIMUM=3.5 bun run tauri build --bundles app
app=src-tauri/target/release/bundle/macos/Prism.app
codesign --verify --deep --strict "$app"
signature="$(codesign -dv --verbose=4 "$app" 2>&1)"
grep -q '^Authority=Developer ID Application:' <<<"$signature"
grep -q '^Identifier=io\.github\.xylotropic\.prism$' <<<"$signature"

# Stage both the app and the Applications shortcut in a disposable folder.
staging="$(mktemp -d)"
trap 'rm -rf "$staging"' EXIT
mkdir "$staging/contents"
ditto "$app" "$staging/contents/Prism.app"
ln -s /Applications "$staging/contents/Applications"
installer="$staging/Prism-Apple-Silicon.dmg"
hdiutil create -quiet -volname Prism -srcfolder "$staging/contents" -format UDZO "$installer"
codesign --sign "$APPLE_SIGNING_IDENTITY" --timestamp "$installer"
xcrun notarytool submit "$installer" --keychain-profile "$notary_profile" --wait
xcrun stapler staple "$installer"
xcrun stapler validate "$installer"
codesign --verify --strict "$installer"
hdiutil verify -quiet "$installer"
cp "$installer" "$output"
