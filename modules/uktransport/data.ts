// Everything the map draws comes from these queries, at page load, against the
// live graph. Stops arrive first (positions only), then every stop-to-stop
// segment grouped by mode with the number of routes sharing it; names follow
// in the background for hover, search and the stop card.

import { NO_CATEGORY, type DenseNetwork } from '@kit/geo-network'
import type { TuringClient } from '@kit/tdb-client'
import { MODES, modeById } from './config'

export interface LoadStep { label: string; rows?: number; ms?: number; done: boolean }

export interface Transport {
  network: DenseNetwork
  /** Network index → internal node id, and back (-1 for a node that is not a Stop). */
  ids: Uint32Array
  indexOf: Int32Array
  segmentsByMode: number[]
  stopsByMode: number[]
  /** Stops with no coordinates in the graph, and the segments that touch them: not drawn. */
  unplacedStops: number
  unplacedSegments: number
}

export interface Names {
  name: string[]
  locality: string[]
  indicator: string[]
  /** Lower-cased "name locality" for search. */
  search: string[]
}

export interface Station { name: string; crs: string; atco: string; id: number }

export interface Counts { labels: Map<string, number>; edgeTypes: Map<string, number> }

export const STOPS_QUERY = 'MATCH (s:Stop) RETURN s, s.longitude, s.latitude'
export const SEGMENTS_QUERY = 'MATCH (a:Stop)-[e:NEXT]->(b:Stop) RETURN a, b, e.mode, count(e) AS routes'
export const NAMES_QUERY = 'MATCH (s:Stop) RETURN s, s.name, s.locality, s.indicator'
export const STATIONS_QUERY = 'MATCH (st:Station)-[:AT]->(s:Stop) RETURN st.name, st.crs, s.atco_code, s'

export async function loadCounts(db: TuringClient): Promise<Counts> {
  const [labels, edges] = await Promise.all([
    db.query('MATCH (n) RETURN labels(n), count(n)'),
    db.query('MATCH ()-[e]->() RETURN type(e), count(e)'),
  ])
  const pairs = (keys: unknown[], values: number[]) => new Map(keys.map((k, i) => [String(Array.isArray(k) ? k.join(':') : k), Number(values[i])]))
  return { labels: pairs(labels.column(0), labels.column<number>(1)), edgeTypes: pairs(edges.column(0), edges.column<number>(1)) }
}

export async function loadTransport(db: TuringClient, onStep: (steps: LoadStep[]) => void): Promise<Transport> {
  const steps: LoadStep[] = [{ label: 'Stops', done: false }, { label: 'Segments by mode', done: false }, { label: 'Network layers', done: false }]
  const report = () => onStep(steps.map((s) => ({ ...s })))
  report()

  const stops = await db.query(STOPS_QUERY, { timeoutMs: 120_000 })
  steps[0] = { label: 'Stops', rows: stops.rowCount, ms: Math.round(stops.totalTimeMs), done: true }
  report()

  const segments = await db.query(SEGMENTS_QUERY, { timeoutMs: 120_000 })
  steps[1] = { label: 'Segments by mode', rows: segments.rowCount, ms: Math.round(segments.totalTimeMs), done: true }
  report()

  const t0 = performance.now()
  const idColumn = stops.column<number>(0)
  const n = idColumn.length
  const ids = Uint32Array.from(idColumn)
  const maxId = ids.reduce((m, x) => Math.max(m, x), 0)
  const indexOf = new Int32Array(maxId + 1).fill(-1)
  ids.forEach((id, i) => { indexOf[id] = i })

  const network: DenseNetwork = {
    lng: Float64Array.from(stops.column<number>(1), (x) => x ?? NaN),
    lat: Float64Array.from(stops.column<number>(2), (x) => x ?? NaN),
    nodeCategory: new Uint8Array(n).fill(NO_CATEGORY),
    src: new Uint32Array(segments.rowCount),
    tgt: new Uint32Array(segments.rowCount),
    edgeCategory: new Uint8Array(segments.rowCount),
    weight: new Float32Array(segments.rowCount),
  }
  const a = segments.column<number>(0), b = segments.column<number>(1), mode = segments.column<string>(2), routes = segments.column<number>(3)
  const segmentsByMode = new Array<number>(MODES.length).fill(0)
  const nodeRank = new Int8Array(n).fill(-1)
  let kept = 0
  let unplacedSegments = 0
  for (let r = 0; r < segments.rowCount; r++) {
    const m = modeById.get(mode[r])
    const s = a[r] <= maxId ? indexOf[a[r]] : -1
    const t = b[r] <= maxId ? indexOf[b[r]] : -1
    if (!m || s < 0 || t < 0) continue
    if (Number.isNaN(network.lng[s]) || Number.isNaN(network.lng[t])) {
      unplacedSegments++
      continue
    }
    network.src[kept] = s
    network.tgt[kept] = t
    network.edgeCategory[kept] = m.index
    network.weight![kept] = routes[r]
    segmentsByMode[m.index]++
    for (const v of [s, t]) {
      if (m.rank > nodeRank[v]) { nodeRank[v] = m.rank; network.nodeCategory[v] = m.index }
    }
    kept++
  }
  network.src = network.src.subarray(0, kept)
  network.tgt = network.tgt.subarray(0, kept)
  network.edgeCategory = network.edgeCategory.subarray(0, kept)
  network.weight = network.weight!.subarray(0, kept)

  const stopsByMode = new Array<number>(MODES.length).fill(0)
  network.nodeCategory.forEach((c) => { if (c !== NO_CATEGORY) stopsByMode[c]++ })
  steps[2] = { label: 'Network layers', rows: kept, ms: Math.round(performance.now() - t0), done: true }
  report()
  const unplacedStops = network.lng.reduce((n, x) => (Number.isNaN(x) ? n + 1 : n), 0)
  return { network, ids, indexOf, segmentsByMode, stopsByMode, unplacedStops, unplacedSegments }
}

export async function loadNames(db: TuringClient, t: Transport): Promise<Names> {
  const r = await db.query(NAMES_QUERY, { timeoutMs: 120_000 })
  const n = t.ids.length
  const names: Names = { name: new Array(n).fill(''), locality: new Array(n).fill(''), indicator: new Array(n).fill(''), search: new Array(n).fill('') }
  const id = r.column<number>(0), name = r.column<string>(1), locality = r.column<string>(2), indicator = r.column<string>(3)
  for (let k = 0; k < r.rowCount; k++) {
    const i = id[k] < t.indexOf.length ? t.indexOf[id[k]] : -1
    if (i < 0) continue
    names.name[i] = name[k] ?? ''
    names.locality[i] = locality[k] ?? ''
    names.indicator[i] = indicator[k] ?? ''
    names.search[i] = `${names.name[i]} ${names.locality[i]}`.toLowerCase()
  }
  return names
}

export async function loadStations(db: TuringClient): Promise<Station[]> {
  const r = await db.query(STATIONS_QUERY)
  const name = r.column<string>(0), crs = r.column<string>(1), atco = r.column<string>(2), id = r.column<number>(3)
  return name.map((s, i) => ({ name: s, crs: crs[i], atco: atco[i], id: id[i] })).sort((x, y) => x.name.localeCompare(y.name))
}

/** Up to `limit` stops whose name or locality contains every word typed:
 *  stops of the highest-ranked mode first (rail before bus), then names that
 *  start with the text, then shorter names. */
export function searchStops(names: Names, t: Transport, text: string, limit = 8): number[] {
  const words = text.toLowerCase().split(/\s+/).filter(Boolean)
  if (!words.length) return []
  const matches: number[] = []
  for (let i = 0; i < names.search.length && matches.length < 2000; i++) {
    const s = names.search[i]
    if (words.every((w) => s.includes(w))) matches.push(i)
  }
  const first = words[0]
  const rank = (i: number) => {
    const c = t.network.nodeCategory[i]
    return c === NO_CATEGORY ? -1 : MODES[c].rank
  }
  const prefix = (i: number) => (names.search[i].startsWith(first) ? 1 : 0)
  return matches
    .sort((x, y) => rank(y) - rank(x) || prefix(y) - prefix(x) || names.name[x].length - names.name[y].length)
    .slice(0, limit)
}
