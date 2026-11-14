#!/bin/sh
# Opens the fork's desktop app beside the official one: own data, profile and port, updates off.
set -eu
repo=$(cd "$(dirname "$0")/../.." && pwd)
# The installed copy carries the same settings in its Info.plist; prefer it when present.
app="/Applications/T3 Code Plus.app"
[ -d "$app" ] || app="$repo/release/app/T3 Code (Beta).app"
home="${T3CODE_FORK_HOME:-$HOME/.t3-fork}"

if [ ! -d "$app" ]; then
  echo "No built app at $app. See \"Desktop app\" in FORK.md." >&2
  exit 1
fi
if lsof -nP -iTCP:3873 -sTCP:LISTEN >/dev/null 2>&1; then
  echo "Port 3873 is in use; the fork app or server is already running." >&2
  exit 1
fi
open -n -a "$app" \
  --env "T3CODE_HOME=$home" \
  --env T3CODE_DESKTOP_PROFILE=t3code-fork \
  --env T3CODE_PORT=3873 \
  --env T3CODE_DISABLE_AUTO_UPDATE=1
echo "Opened the fork app on $home."
