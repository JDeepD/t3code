#!/bin/sh
# Downloads the newest CI build of the fork (the "fork-latest" release) and installs it as
# T3 Code Plus through install-app.sh. Quit T3 Code Plus first. Needs the GitHub CLI.
set -eu
repo=$(cd "$(dirname "$0")/../.." && pwd)
slug=$(git -C "$repo" remote get-url origin | sed -E 's#^(git@github\.com:|https://github\.com/)##; s#\.git$##')
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

gh release view fork-latest -R "$slug" --json name,publishedAt --jq '"\(.name), published \(.publishedAt)"'
gh release download fork-latest -R "$slug" -p '*-arm64.zip' -D "$tmp"
ditto -x -k "$tmp"/*-arm64.zip "$tmp/app"
# Unsigned apps downloaded from the internet are refused by Gatekeeper while quarantined.
xattr -dr com.apple.quarantine "$tmp/app" 2>/dev/null || true
T3CODE_FORK_BUILT_APP="$tmp/app/T3 Code (Beta).app" sh "$repo/scripts/fork/install-app.sh"
