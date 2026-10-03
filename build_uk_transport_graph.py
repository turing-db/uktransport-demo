#!/usr/bin/env python3
"""
Build the UK transport graph in a running TuringDB server from the CSV files
of fetch_uk_transport.py. The CSV files become a nodes.parquet and
edges.parquet pair in the server's data directory, which LOAD PARQUET imports.

Usage:
    python3 build_uk_transport_graph.py [--input data] [--turing-dir ~/.turing]
                                        [--host http://localhost:6666] [--graph uktransport]

TURINGDB_AUTH_TOKEN is sent as a bearer token when it is set.

Graph:
    (:Stop)      NaPTAN and GTFS stops, keyed by atco_code
    (:Station)   National Rail stations, keyed by crs
    (:Operator)  train and bus operators, keyed by operator_id
    (:Route)     one distinct stop sequence of a line, keyed by route_id

    (Route)-[:CALLS_AT {sequence, arrival_minutes, departure_minutes}]->(Stop)
    (Stop)-[:NEXT {route_id, mode, minutes}]->(Stop)   consecutive stops of a route
    (Stop)-[:TRANSFER {mode, minutes, metres}]->(Stop)
    (Operator)-[:RUNS]->(Route)
    (Station)-[:AT]->(Stop)
"""

import argparse
import csv
import json
import os
import sys
import urllib.parse
import urllib.request

import pyarrow
import pyarrow.parquet

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))

STRING = pyarrow.string()
INTEGER = pyarrow.int64()
DOUBLE = pyarrow.float64()

STOP_PROPERTIES = {
    "atco_code": STRING,
    "naptan_code": STRING,
    "name": STRING,
    "indicator": STRING,
    "locality": STRING,
    "stop_type": STRING,
    "latitude": DOUBLE,
    "longitude": DOUBLE,
    "status": STRING,
}
STATION_PROPERTIES = {
    "crs": STRING,
    "name": STRING,
    "atco_code": STRING,
    "tiploc": STRING,
    "nlc": STRING,
    "operator": STRING,
    "latitude": DOUBLE,
    "longitude": DOUBLE,
    "interchange": INTEGER,
    "change_minutes": INTEGER,
}
OPERATOR_PROPERTIES = {
    "operator_id": STRING,
    "name": STRING,
    "noc": STRING,
    "website": STRING,
}
ROUTE_PROPERTIES = {
    "route_id": INTEGER,
    "mode": STRING,
    "operator_id": STRING,
    "line": STRING,
    "origin": STRING,
    "destination": STRING,
    "stops": INTEGER,
    "services": INTEGER,
}
EDGE_PROPERTIES = {
    "sequence": INTEGER,
    "arrival_minutes": DOUBLE,
    "departure_minutes": DOUBLE,
    "route_id": INTEGER,
    "mode": STRING,
    "minutes": DOUBLE,
    "metres": INTEGER,
}


class GraphTable:
    def __init__(self, key_columns, properties):
        self.key_columns = key_columns
        self.properties = properties
        self.columns = {name: [] for name in key_columns + list(properties)}

    def add(self, keys, values):
        for name, key in zip(self.key_columns, keys):
            self.columns[name].append(key)
        for name, value_type in self.properties.items():
            self.columns[name].append(convert(values.get(name, ""), value_type))

    def size(self):
        return len(self.columns[self.key_columns[0]])

    def write(self, path, key_types):
        fields = [pyarrow.field(name, key_types[name], nullable=False) for name in self.key_columns]
        fields += [pyarrow.field(name, value_type) for name, value_type in self.properties.items()]
        table = pyarrow.table(self.columns, schema=pyarrow.schema(fields))
        pyarrow.parquet.write_table(table, path)
        print(f"Wrote {table.num_rows} rows to {path}")


def convert(value, value_type):
    if value == "":
        return None
    if value_type == INTEGER:
        return int(value)
    if value_type == DOUBLE:
        return float(value)
    return value


def read_csv(directory, name):
    with open(os.path.join(directory, name), newline="") as file:
        return list(csv.DictReader(file))


def add_nodes(nodes, ids, label, key, rows, properties):
    for row in rows:
        node_id = nodes.size()
        ids[row[key]] = node_id
        nodes.add([node_id, [label]], {name: row[name] for name in properties})


def add_edge(edges, missing, edge_type, source, target, values):
    if source is None or target is None:
        missing[edge_type] = missing.get(edge_type, 0) + 1
        return
    edges.add([source, target, edge_type], values)


def stop_minutes(row, first, second):
    return row[first] if row[first] != "" else row[second]


def add_route_edges(edges, missing, route_ids, route_modes, stop_ids, route_stops):
    previous = None
    for row in route_stops:
        route = route_ids.get(row["route_id"])
        stop = stop_ids.get(row["atco_code"])
        add_edge(edges,
                 missing,
                 "CALLS_AT",
                 route,
                 stop,
                 {name: row[name] for name in ("sequence", "arrival_minutes", "departure_minutes")})

        is_same_route = previous is not None and previous["route_id"] == row["route_id"]
        if is_same_route:
            departure = stop_minutes(previous, "departure_minutes", "arrival_minutes")
            arrival = stop_minutes(row, "arrival_minutes", "departure_minutes")
            has_times = departure != "" and arrival != ""
            minutes = f"{float(arrival) - float(departure):g}" if has_times else ""
            add_edge(edges,
                     missing,
                     "NEXT",
                     stop_ids.get(previous["atco_code"]),
                     stop,
                     {"route_id": row["route_id"],
                      "mode": route_modes.get(row["route_id"], ""),
                      "minutes": minutes})
        previous = row


def query(host, graph, cypher):
    headers = {"Content-Type": "text/plain"}
    token = os.environ.get("TURINGDB_AUTH_TOKEN")
    if token:
        headers["Authorization"] = f"Bearer {token}"

    url = f"{host}/query?{urllib.parse.urlencode({'graph': graph})}"
    request = urllib.request.Request(url, data=cypher.encode(), headers=headers)
    with urllib.request.urlopen(request, timeout=3600) as response:
        result = json.load(response)

    if "error" in result:
        details = result.get("error_details")
        sys.exit(f"{cypher}: {result['error']}" + (f": {details}" if details else ""))
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__,
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--input", default=os.path.join(SCRIPT_DIR, "data"))
    parser.add_argument("--turing-dir", default=os.path.expanduser("~/.turing"))
    parser.add_argument("--host", default="http://localhost:6666")
    parser.add_argument("--graph", default="uktransport")
    args = parser.parse_args()
    output = os.path.join(args.turing_dir, "data", args.graph)

    node_properties = {**STOP_PROPERTIES, **STATION_PROPERTIES,
                       **OPERATOR_PROPERTIES, **ROUTE_PROPERTIES}
    nodes = GraphTable(["__id", "__labels"], node_properties)
    stop_ids = {}
    station_ids = {}
    operator_ids = {}
    route_ids = {}

    stations = read_csv(args.input, "stations.csv")
    routes = read_csv(args.input, "routes.csv")
    add_nodes(nodes, stop_ids, "Stop", "atco_code",
              read_csv(args.input, "stops.csv"), STOP_PROPERTIES)
    add_nodes(nodes, station_ids, "Station", "crs", stations, STATION_PROPERTIES)
    add_nodes(nodes, operator_ids, "Operator", "operator_id",
              read_csv(args.input, "operators.csv"), OPERATOR_PROPERTIES)
    add_nodes(nodes, route_ids, "Route", "route_id", routes, ROUTE_PROPERTIES)

    edges = GraphTable(["__source", "__target", "__type"], EDGE_PROPERTIES)
    missing = {}
    route_modes = {row["route_id"]: row["mode"] for row in routes}
    add_route_edges(edges,
                    missing,
                    route_ids,
                    route_modes,
                    stop_ids,
                    read_csv(args.input, "route_stops.csv"))

    for row in read_csv(args.input, "transfers.csv"):
        add_edge(edges, missing, "TRANSFER",
                 stop_ids.get(row["atco_code1"]),
                 stop_ids.get(row["atco_code2"]),
                 row)

    for row in routes:
        add_edge(edges, missing, "RUNS",
                 operator_ids.get(row["operator_id"]),
                 route_ids[row["route_id"]],
                 {})

    for row in stations:
        if row["atco_code"]:
            add_edge(edges, missing, "AT",
                     station_ids[row["crs"]],
                     stop_ids.get(row["atco_code"]),
                     {})

    for edge_type, count in sorted(missing.items()):
        print(f"Skipped {count} {edge_type} edges with an end missing from the CSV files")

    os.makedirs(output, exist_ok=True)
    nodes.write(os.path.join(output, "nodes.parquet"),
                {"__id": INTEGER, "__labels": pyarrow.list_(STRING)})
    edges.write(os.path.join(output, "edges.parquet"),
                {"__source": INTEGER, "__target": INTEGER, "__type": STRING})

    print(f"Loading graph {args.graph} into {args.host}")
    query(args.host, "default", f"LOAD PARQUET '{args.graph}' AS {args.graph}")
    node_count = query(args.host, args.graph, "MATCH (n) RETURN count(n)")["data"][0][0][0]
    edge_count = query(args.host, args.graph, "MATCH ()-[r]->() RETURN count(r)")["data"][0][0][0]
    print(f"Graph {args.graph}: {node_count} nodes, {edge_count} edges")


if __name__ == "__main__":
    main()
