# UK public transport

`fetch_uk_transport.py` downloads NaPTAN, the Bus Open Data Service GTFS timetables and the
National Rail feeds into the CSV files under `data/`. `build_uk_transport_graph.py` turns them into
the `uktransport` graph in a running TuringDB server through `LOAD PARQUET`.

The map app is a TypeScript page built from the
[turingdb-ui-kit](https://github.com/turing-db/turingdb-ui-kit) on the turingdb-visualizer. It
draws every stop and stop-to-stop segment read from the graph, coloured by mode, and adds a
journey planner (`shortestPath` over `minutes`), operator networks, prewritten queries and the
graph assistant.

```bash
turingdb start -demon
python3 build_uk_transport_graph.py

git clone https://github.com/turing-db/turingdb-ui-kit ~/turingdb-ui-kit
./run.sh
# http://127.0.0.1:8099/?m=uktransport
```

`kit.json` names the graph and the ports: `ui` for the app, `api` for TuringDB. `run.sh` runs
`kit sync`, which rebuilds `app/` (gitignored) from the pinned visualizer and the modules: the page
in `modules/uktransport/` and `modules/geo-network/`, the dense network layer it draws with. Then
it serves the app on localhost, or with `./run.sh --tailscale` on this machine's tailscale
address; `UI_PORT`, `API_PORT`, `KIT` and `SYNC=0` override the defaults.
