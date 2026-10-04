#!/usr/bin/env bash
# Container entrypoint (see the Dockerfile header): starts TuringDB on
# 127.0.0.1 with the graph loaded, then the app's Express server on $PORT,
# and exits non-zero when either dies so the platform restarts the container.
set -euo pipefail

API_PORT="${TURING_API_PORT:-6666}"
TURING_HOST="http://127.0.0.1:$API_PORT"
export TURING_API_PORT="$API_PORT"
# Railway injects PORT.
export TURING_FRONTEND_PORT="${PORT:-${TURING_FRONTEND_PORT:-8080}}"

tdb_probe() {
    curl -s -o /dev/null -m 5 -X POST "$TURING_HOST/query?graph=$GRAPH" --data 'RETURN 1'
}

echo "[entrypoint] starting TuringDB on 127.0.0.1:$API_PORT with graph $GRAPH"
turingdb start -turing-dir "$TURING_DIR" -p "$API_PORT" -i 127.0.0.1 -load "$GRAPH" -demon
for i in $(seq 1 600); do
    tdb_probe && break
    [[ "$i" == 600 ]] && { echo "[entrypoint] TuringDB not ready after 300 s" >&2; exit 1; }
    sleep 0.5
done
echo "[entrypoint] TuringDB ready"

mkdir -p "$TURING_DIR/logs"
touch "$TURING_DIR/logs/turingdb.log"
tail -n 0 -F "$TURING_DIR/logs/turingdb.log" 2>/dev/null | sed -u 's/^/[turingdb] /' &
TAIL_PID=$!

echo "[entrypoint] starting the app on :$TURING_FRONTEND_PORT"
node /app/server.js &
WEB_PID=$!

shutdown() {
    echo "[entrypoint] shutting down"
    kill -TERM "$WEB_PID" "$TAIL_PID" 2>/dev/null || true
    turingdb stop -turing-dir "$TURING_DIR" >/dev/null 2>&1 || true
    wait "$WEB_PID" 2>/dev/null || true
}
trap 'shutdown; exit 0' TERM INT

fails=0
while kill -0 "$WEB_PID" 2>/dev/null; do
    if tdb_probe; then
        fails=0
    else
        fails=$((fails + 1))
        echo "[entrypoint] TuringDB health probe failed ($fails/6)" >&2
        if [[ "$fails" -ge 6 ]]; then shutdown; exit 1; fi
    fi
    sleep 5 & wait $! || true
done
echo "[entrypoint] the app exited unexpectedly" >&2
shutdown
exit 1
