import type { NetworkCategory } from '@kit/geo-network'
import { CATEGORICAL } from '@kit/theme'

export const CONFIG = {
  graph: 'uktransport',
  title: 'UK public transport',
  /** Where the map lands after the globe intro. */
  home: { center: [-3.4, 54.4] as [number, number], zoom: 5.25 },
  /** The home zoom on a phone, where the whole of Great Britain must fit in ~390 px. */
  phoneHomeZoom: 4.1,
  panelWidth: 400,
  cardWidth: 340,
  /** On a phone (narrow, or held sideways) the panel becomes a bottom sheet over a full-screen map. */
  phoneQuery: '(max-width: 640px), (max-height: 500px)',
  /** The collapsed sheet shows the panel's header and tabs only. */
  sheetCollapsed: 100,
  /** The open sheet's share of the screen height. */
  sheetOpen: 0.6,
  assistantNotes: 'The public transport network of Great Britain built from NaPTAN, the Bus Open Data Service GTFS timetables and National Rail. ' +
    '(:Stop) is a stop or platform keyed by atco_code with latitude/longitude; (:Station) a National Rail station keyed by crs, (Station)-[:AT]->(Stop); ' +
    '(:Route) one distinct stop sequence of a line with mode (bus, coach, rail, metro, tram, ferry, aerial_lift), line, origin/destination atco codes, stops and services; ' +
    '(Operator)-[:RUNS]->(Route), (Route)-[:CALLS_AT {sequence, arrival_minutes, departure_minutes}]->(Stop); ' +
    '(Stop)-[:NEXT {route_id, mode, minutes}]->(Stop) joins consecutive stops of a route; (Stop)-[:TRANSFER {mode, minutes, metres}]->(Stop) is a walk or interchange, stored once in each direction. ' +
    'Use shortestPath(a, b, minutes, dist, path) between Stop nodes for the fastest chain of hops.',
  suggestions: ['Which stops are served by the most routes?', 'How long is the fastest journey from Penzance to Thurso?', 'Which operators run trams?'],
}

/** Modes in draw order (first at the bottom). `rank` says which mode a stop
 *  served by several takes its colour from: the highest wins. */
export const MODES: (NetworkCategory & { rank: number })[] = [
  { id: 'bus', label: 'Bus', color: CATEGORICAL[4], width: 0.9, opacity: [0.4, 0.65], pointRadius: 2, pointMinzoom: 12.5, rank: 0 },
  { id: 'coach', label: 'Coach', color: CATEGORICAL[2], width: 0.8, opacity: [0.35, 0.7], pointRadius: 2.4, pointMinzoom: 10, rank: 1 },
  { id: 'ferry', label: 'Ferry', color: CATEGORICAL[9], width: 1.2, dash: 'dashed', opacity: [0.75, 0.9], pointRadius: 3, pointMinzoom: 6, rank: 2 },
  { id: 'aerial_lift', label: 'Cable car', color: CATEGORICAL[7], width: 1.4, opacity: [0.9, 1], pointRadius: 3, pointMinzoom: 9, rank: 3 },
  { id: 'tram', label: 'Tram', color: CATEGORICAL[6], width: 1.3, glow: true, opacity: [0.85, 0.95], pointRadius: 2.8, pointMinzoom: 8.5, rank: 4 },
  { id: 'metro', label: 'Metro', color: CATEGORICAL[3], width: 1.3, glow: true, opacity: [0.85, 0.95], pointRadius: 2.8, pointMinzoom: 8.5, rank: 5 },
  { id: 'rail', label: 'Rail', color: CATEGORICAL[0], width: 1.2, glow: true, opacity: [0.7, 1], pointRadius: 3.4, pointMinzoom: 5, rank: 6 },
]

export const modeById = new Map(MODES.map((m, i) => [m.id, { ...m, index: i }]))
export const modeColor = (mode: unknown) => modeById.get(String(mode))?.color ?? CATEGORICAL[9]
export const modeLabel = (mode: unknown) => modeById.get(String(mode))?.label ?? String(mode ?? 'walk')

/** Journeys offered as one click, by National Rail station name. */
export const SAMPLE_JOURNEYS: [string, string][] = [
  ['London Paddington', 'Edinburgh'],
  ['Penzance', 'Thurso'],
  ['Cardiff Central', 'Norwich'],
  ['Holyhead', 'Brighton'],
  ['Aberystwyth', 'Inverness'],
]
