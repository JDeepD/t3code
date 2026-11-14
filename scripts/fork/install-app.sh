#!/bin/sh
# Installs the built fork app as "/Applications/T3 Code Plus.app" with its launch settings
# baked into Info.plist (LSEnvironment), so opening it needs no terminal. Run it after each
# desktop build. Open only this copy by double-click: the one in release/ has no settings
# and would use the official app's data.
set -eu
repo=$(cd "$(dirname "$0")/../.." && pwd)
built="$repo/release/app/T3 Code (Beta).app"
installed="/Applications/T3 Code Plus.app"
home="${T3CODE_FORK_HOME:-$HOME/.t3-fork}"
plist="$installed/Contents/Info.plist"

if [ ! -d "$built" ]; then
  echo "No built app at $built. See \"Desktop app\" in FORK.md." >&2
  exit 1
fi
if ps -axo command= | grep -F "$installed/Contents/MacOS/" | grep -v grep >/dev/null; then
  echo "Quit T3 Code Plus first, then run this again." >&2
  exit 1
fi

rm -rf "$installed" "/Applications/T3 Code Fork.app"
ditto "$built" "$installed"
/usr/libexec/PlistBuddy -c "Set :CFBundleName T3 Code Plus" \
  -c "Set :CFBundleDisplayName T3 Code Plus" "$plist"
set_env() {
  /usr/libexec/PlistBuddy -c "Delete :LSEnvironment:$1" "$plist" 2>/dev/null || true
  /usr/libexec/PlistBuddy -c "Add :LSEnvironment:$1 string $2" "$plist"
}
set_env T3CODE_HOME "$home"
set_env T3CODE_DESKTOP_PROFILE t3code-fork
set_env T3CODE_PORT 3873
set_env T3CODE_DISABLE_AUTO_UPDATE 1
echo "Installed $installed (data in $home)."
