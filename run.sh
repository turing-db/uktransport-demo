#!/usr/bin/env bash
# Run the UK public transport map app on this machine's tailscale address
# when tailscale is up, else on localhost; --local forces localhost and
# --tailscale fails instead of falling back to localhost. Checks out the
# turingdb-ui-kit submodule at its pinned commit, builds the graph in .turing/
# from the committed CSV files with fetch.py if it is not built yet, and starts
# TuringDB in the background with the graph loaded unless something already
# listens on the API port. The TuringDB server of .turing/ is stopped when
# run.sh exits, including on Ctrl-C.
# The ports come from kit.json; environment overrides:
#   KIT            turingdb-ui-kit checkout to use instead of the submodule
#   UI_PORT        app port (default kit.json ports.ui)
#   API_PORT       TuringDB port (default kit.json ports.api)
#   SYNC=0         skip `kit sync` (app/ must already exist)
#   BUILD=1        rebuild the graph even if it is already built, restarting
#                  TuringDB on it

set -euo pipefail

DEMO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
KIT="${KIT:-$DEMO_DIR/turingdb-ui-kit}"
UI_PORT="${UI_PORT:-$(node -p "require('$DEMO_DIR/kit.json').ports.ui")}"
API_PORT="${API_PORT:-$(node -p "require('$DEMO_DIR/kit.json').ports.api")}"
GRAPH="$(node -p "require('$DEMO_DIR/kit.json').graph")"

MODE="auto"
for arg in "$@"; do
    case "$arg" in
        --tailscale) MODE="tailscale" ;;
        --local) MODE="local" ;;
        *)
            echo "usage: run.sh [--tailscale | --local]" >&2
            exit 1
        ;;
    esac
done

HOST="127.0.0.1"
if [[ "$MODE" != "local" ]]; then
    TAILSCALE_IP="$(tailscale ip -4 2>/dev/null | head -n 1 || true)"
    if [[ -n "$TAILSCALE_IP" ]]; then
        HOST="$TAILSCALE_IP"
    elif [[ "$MODE" == "tailscale" ]]; then
        echo "run.sh: --tailscale: no tailscale IPv4 address (is tailscale up?)" >&2
        exit 1
    fi
fi

if [[ "$KIT" == "$DEMO_DIR/turingdb-ui-kit" ]]; then
    git -C "$DEMO_DIR" submodule update --init --recursive
fi
if [[ ! -f "$KIT/tools/kit.mjs" ]]; then
    echo "run.sh: $KIT is not a turingdb-ui-kit checkout (set KIT)" >&2
    exit 1
fi

cd "$DEMO_DIR"

if [[ "${BUILD:-0}" == "1" || ! -d .turing/graphs/"$GRAPH" ]]; then
    # The build replaces the graph directory under any running server.
    uv run turingdb stop -turing-dir .turing >/dev/null 2>&1 \
        && echo "run.sh: stopped TuringDB to rebuild the graph"
    echo "run.sh: building graph $GRAPH in $DEMO_DIR/.turing"
    uv run fetch.py --skip-fetch --turing-dir .turing --graph "$GRAPH"
fi

stop_turingdb() {
    uv run turingdb stop -turing-dir "$DEMO_DIR/.turing" >/dev/null 2>&1 \
        && echo "run.sh: stopped TuringDB"
    true
}
trap stop_turingdb EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
trap 'exit 129' HUP

if (echo > "/dev/tcp/127.0.0.1/$API_PORT") 2>/dev/null; then
    echo "run.sh: TuringDB already listening on :$API_PORT"
else
    echo "run.sh: starting TuringDB on :$API_PORT with graph $GRAPH"
    if ! log="$(uv run turingdb start -turing-dir .turing -p "$API_PORT" -load "$GRAPH" -demon 2>&1)"; then
        echo "$log" >&2
        exit 1
    fi
fi

if [[ "${SYNC:-1}" != "0" || ! -d "$DEMO_DIR/app" ]]; then
    node "$KIT/tools/kit.mjs" sync "$DEMO_DIR"
fi

echo "run.sh: http://$HOST:$UI_PORT/?m=uktransport  (TuringDB on :$API_PORT)"
cd app
TURING_API_PORT="$API_PORT" TURING_FRONTEND_PORT="$UI_PORT" \
    npx vite --host "$HOST" --port "$UI_PORT" --strictPort
