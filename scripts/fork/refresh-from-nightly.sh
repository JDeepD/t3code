#!/bin/sh
# Replaces the fork's chats with a fresh read-only copy of the official app's (~/.t3), then
# reopens the fork app. Chats made in the fork are lost and paired devices must pair again.
# Notes, todos, plans, magic prompts and settings are kept.
set -eu
repo=$(cd "$(dirname "$0")/../.." && pwd)
home="${T3CODE_FORK_HOME:-$HOME/.t3-fork}"
source_db="$HOME/.t3/userdata/statev2.sqlite"
[ -x /opt/homebrew/opt/node/bin/node ] && PATH="/opt/homebrew/opt/node/bin:$PATH"

# The copy skips a chat whose agent is working, has background tasks running, or still has a
# provider session open. A session stays open after a reply until the official app restarts.
busy=$(sqlite3 -readonly "file:$source_db?mode=ro" "
  WITH live(thread_id) AS (
    SELECT thread_id FROM orchestration_v2_projection_provider_threads
    WHERE status = 'active' OR json_array_length(payload_json, '\$.pendingBackgroundTasks') > 0
    UNION
    SELECT COALESCE(b.thread_id, s.thread_id)
    FROM orchestration_v2_projection_provider_sessions s
    LEFT JOIN orchestration_v2_projection_provider_session_bindings b
      ON b.provider_session_id = s.provider_session_id
    WHERE s.status NOT IN ('stopped', 'error')
  )
  SELECT '  - ' || COALESCE(json_extract(t.payload_json, '\$.title'), t.thread_id)
  FROM live JOIN orchestration_v2_projection_threads t ON t.thread_id = live.thread_id
  GROUP BY t.thread_id" 2>/dev/null || true)
if [ -n "$busy" ]; then
  echo "These chats are busy or still have an open session in the official app, and will be skipped:"
  echo "$busy"
  echo "To include them, quit and reopen the official app, then run this before messaging them."
  printf "Press Enter to copy anyway, or Ctrl-C to stop and try again later. "
  read -r _
fi

# Closes the app that owns the fork's port, and only if it is the fork's own app. The port
# belongs to the app's server child; the app restarts that child, so the app itself must quit.
pid=$(lsof -nP -tiTCP:3873 -sTCP:LISTEN 2>/dev/null | head -n 1 || true)
if [ -n "$pid" ]; then
  case "$(ps -p "$pid" -o command=)" in
    "$repo/release/app/"* | "/Applications/T3 Code Plus.app/"*) ;;
    *)
      echo "Port 3873 is used by something other than the fork app (pid $pid). Stop it first." >&2
      exit 1
      ;;
  esac
  while :; do
    parent=$(ps -p "$pid" -o ppid= | tr -d ' ')
    case "$(ps -p "$parent" -o command= 2>/dev/null || true)" in
      "$repo/release/app/"* | "/Applications/T3 Code Plus.app/"*) pid=$parent ;;
      *) break ;;
    esac
  done
  echo "Closing the fork app..."
  kill "$pid"
  waited=0
  while kill -0 "$pid" 2>/dev/null || lsof -nP -iTCP:3873 -sTCP:LISTEN >/dev/null 2>&1; do
    waited=$((waited + 1))
    # A just-opened app finishes starting before it quits, which took about 40 seconds.
    if [ "$waited" -gt 120 ]; then
      echo "The fork app did not close. Quit it yourself, then run this again." >&2
      exit 1
    fi
    sleep 1
  done
fi

cd "$repo"
node apps/server/scripts/migrate-dev-db.ts --base-dir "$home" \
  --projects "${1:-10}" --threads-per-project "${2:-20}"

"$repo/scripts/fork/launch-desktop.sh"
echo
echo "Pair your phone again (Tailscale on):"
echo "  $home/bin/t3 pair --tailscale --tailscale-serve-port 8443 --label iphone --ttl 15m"
