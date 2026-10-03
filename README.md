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
node ~/turingdb-ui-kit/tools/kit.mjs sync samples/uktransport
node ~/turingdb-ui-kit/tools/kit.mjs dev samples/uktransport
# http://127.0.0.1:8099/?m=uktransport
```

`kit.json` names the graph and the ports: `ui` for the app, `api` for TuringDB. `kit sync`
rebuilds `app/` (gitignored) from the pinned visualizer and the modules: the page in
`modules/uktransport/` and `modules/geo-network/`, the dense network layer it draws with.
