#!/usr/bin/env bash
# Run the UK public transport map app on localhost, or with --tailscale on
# this machine's tailscale address. The ports come from kit.json; environment
# overrides:
#   KIT            turingdb-ui-kit checkout (default ~/turingdb-ui-kit)
#   UI_PORT        app port (default kit.json ports.ui)
#   API_PORT       TuringDB port (default kit.json ports.api)
#   SYNC=0         skip `kit sync` (app/ must already exist)

set -euo pipefail

DEMO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
KIT="${KIT:-$HOME/turingdb-ui-kit}"
UI_PORT="${UI_PORT:-$(node -p "require('$DEMO_DIR/kit.json').ports.ui")}"
API_PORT="${API_PORT:-$(node -p "require('$DEMO_DIR/kit.json').ports.api")}"

HOST="127.0.0.1"
for arg in "$@"; do
    case "$arg" in
        --tailscale)
            HOST="$(tailscale ip -4 2>/dev/null | head -n 1 || true)"
            if [[ -z "$HOST" ]]; then
                echo "run.sh: --tailscale: no tailscale IPv4 address (is tailscale up?)" >&2
                exit 1
            fi
        ;;
        *)
            echo "usage: run.sh [--tailscale]" >&2
            exit 1
        ;;
    esac
done

if [[ ! -f "$KIT/tools/kit.mjs" ]]; then
    echo "run.sh: no turingdb-ui-kit at $KIT (git clone https://github.com/turing-db/turingdb-ui-kit $KIT, or set KIT)" >&2
    exit 1
fi

if [[ "${SYNC:-1}" != "0" || ! -d "$DEMO_DIR/app" ]]; then
    node "$KIT/tools/kit.mjs" sync "$DEMO_DIR"
fi

echo "run.sh: http://$HOST:$UI_PORT/?m=uktransport  (TuringDB on :$API_PORT)"
cd "$DEMO_DIR/app"
TURING_API_PORT="$API_PORT" TURING_FRONTEND_PORT="$UI_PORT" \
    exec npx vite --host "$HOST" --port "$UI_PORT" --strictPort
