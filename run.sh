#!/usr/bin/env bash
# Run the UK public transport map app on localhost, or with --tailscale on
# this machine's tailscale address. Clones the turingdb-ui-kit if it is
# missing, and builds the graph in .turing/ from the committed CSV files with
# fetch.py if it is not built yet. The ports come from kit.json; environment
# overrides:
#   KIT            turingdb-ui-kit checkout (default ~/turingdb-ui-kit)
#   KIT_REPO       where to clone it from (default the GitHub repo over ssh)
#   UI_PORT        app port (default kit.json ports.ui)
#   API_PORT       TuringDB port (default kit.json ports.api)
#   SYNC=0         skip `kit sync` (app/ must already exist)
#   BUILD=1        rebuild the graph even if it is already built

set -euo pipefail

DEMO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
KIT="${KIT:-$HOME/turingdb-ui-kit}"
KIT_REPO="${KIT_REPO:-git@github.com:turing-db/turingdb-ui-kit.git}"
UI_PORT="${UI_PORT:-$(node -p "require('$DEMO_DIR/kit.json').ports.ui")}"
API_PORT="${API_PORT:-$(node -p "require('$DEMO_DIR/kit.json').ports.api")}"
GRAPH="$(node -p "require('$DEMO_DIR/kit.json').graph")"

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

if [[ ! -e "$KIT" ]]; then
    echo "run.sh: cloning turingdb-ui-kit into $KIT"
    git clone "$KIT_REPO" "$KIT"
fi
if [[ ! -f "$KIT/tools/kit.mjs" ]]; then
    echo "run.sh: $KIT is not a turingdb-ui-kit checkout (set KIT)" >&2
    exit 1
fi

if [[ "${BUILD:-0}" == "1" || ! -d "$DEMO_DIR/.turing/graphs/$GRAPH" ]]; then
    echo "run.sh: building graph $GRAPH in $DEMO_DIR/.turing"
    (cd "$DEMO_DIR" && uv run fetch.py --skip-fetch --turing-dir .turing --graph "$GRAPH")
fi

if [[ "${SYNC:-1}" != "0" || ! -d "$DEMO_DIR/app" ]]; then
    node "$KIT/tools/kit.mjs" sync "$DEMO_DIR"
fi

echo "run.sh: http://$HOST:$UI_PORT/?m=uktransport  (TuringDB on :$API_PORT)"
cd "$DEMO_DIR/app"
TURING_API_PORT="$API_PORT" TURING_FRONTEND_PORT="$UI_PORT" \
    exec npx vite --host "$HOST" --port "$UI_PORT" --strictPort
