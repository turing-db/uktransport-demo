# UK public transport

`fetch.py` downloads NaPTAN, the Bus Open Data Service GTFS timetables and the National Rail
feeds into the CSV files under `data/`, then builds the `uktransport` graph from them in `.turing/`
with the embedded TuringDB engine and `LOAD PARQUET`. It runs in a uv project pinned to
`turingdb==3.0`; `--skip-fetch` builds the graph from the committed CSV files without downloading.

The map app is a TypeScript page built from the
[turingdb-ui-kit](https://github.com/turing-db/turingdb-ui-kit) on the turingdb-visualizer. It
draws every stop and stop-to-stop segment read from the graph, coloured by mode, and adds a
journey planner (`shortestPath` over `minutes`), operator networks, prewritten queries and the
graph assistant.

```bash
uv run fetch.py
uv run turingdb start -turing-dir .turing -load uktransport -demon

git clone https://github.com/turing-db/turingdb-ui-kit ~/turingdb-ui-kit
./run.sh
# http://127.0.0.1:8099/?m=uktransport
```

`kit.json` names the graph and the ports: `ui` for the app, `api` for TuringDB. `run.sh` runs
`kit sync`, which rebuilds `app/` (gitignored) from the pinned visualizer and the modules: the page
in `modules/uktransport/` and `modules/geo-network/`, the dense network layer it draws with. Then
it serves the app on localhost, or with `./run.sh --tailscale` on this machine's tailscale
address; `UI_PORT`, `API_PORT`, `KIT` and `SYNC=0` override the defaults.
