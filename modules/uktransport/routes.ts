// Route-shaped questions: what calls at a stop, what an operator runs, and the
// lines either one draws on the map (as an overlay, so GeoSurface lights it).

import { chunked, cy, orChain, seekNodes } from '@kit/cypher'
import type { Overlay, OverlayEdge } from '@kit/overlay'
import type { TuringClient } from '@kit/tdb-client'
import { modeById, modeColor } from './config'

export interface StopInfo {
  id: number
  name: string
  atco: string
  naptan: string | null
  indicator: string | null
  locality: string | null
  stopType: string | null
  status: string | null
  station: { name: string; crs: string; operator: string | null; changeMinutes: number | null } | null
  transfers: number
}

export interface RouteRow {
  id: number
  routeId: number
  mode: string
  line: string | null
  origin: string | null
  destination: string | null
  services: number | null
  stops: number | null
  operator: string | null
}

export async function loadStop(db: TuringClient, id: number): Promise<{ info: StopInfo; routes: RouteRow[]; termini: Map<string, string>; queries: string[] }> {
  const seek = seekNodes('s', [id])
  const queries = [
    `MATCH (s:Stop) WHERE ${seek} RETURN s.name, s.atco_code, s.naptan_code, s.indicator, s.locality, s.stop_type, s.status`,
    `MATCH (s:Stop)<-[:CALLS_AT]-(r:Route) WHERE ${seek} RETURN r, r.route_id, r.mode, r.line, r.origin, r.destination, r.services, r.stops`,
    `MATCH (s:Stop)<-[:CALLS_AT]-(r:Route)<-[:RUNS]-(o:Operator) WHERE ${seek} RETURN r, o.name`,
    `MATCH (s:Stop)<-[:AT]-(st:Station) WHERE ${seek} RETURN st.name, st.crs, st.operator, st.change_minutes`,
    `MATCH (s:Stop)-[t:TRANSFER]->(u:Stop) WHERE ${seek} RETURN count(t)`,
  ]
  const [stop, routes, operators, station, transfers] = await Promise.all(queries.map((q) => db.query(q)))
  const [row] = stop.tuples()
  if (!row) throw new Error(`no Stop with id ${id}`)
  const str = (v: unknown) => (v == null || v === '' ? null : String(v))
  const [st] = station.tuples()
  const info: StopInfo = {
    id,
    name: String(row[0] ?? ''),
    atco: String(row[1] ?? ''),
    naptan: str(row[2]),
    indicator: str(row[3]),
    locality: str(row[4]),
    stopType: str(row[5]),
    status: str(row[6]),
    station: st ? { name: String(st[0]), crs: String(st[1]), operator: str(st[2]), changeMinutes: st[3] == null ? null : Number(st[3]) } : null,
    transfers: Number(transfers.column(0)[0] ?? 0),
  }
  const operatorOf = new Map(operators.tuples().map((t) => [Number(t[0]), String(t[1])]))
  const rows: RouteRow[] = routes.tuples().map((t) => ({
    id: Number(t[0]),
    routeId: Number(t[1]),
    mode: String(t[2] ?? ''),
    line: str(t[3]),
    origin: str(t[4]),
    destination: str(t[5]),
    services: t[6] == null ? null : Number(t[6]),
    stops: t[7] == null ? null : Number(t[7]),
    operator: operatorOf.get(Number(t[0])) ?? null,
  }))
  rows.sort((x, y) => (modeById.get(y.mode)?.rank ?? 0) - (modeById.get(x.mode)?.rank ?? 0) || (y.services ?? 0) - (x.services ?? 0))

  const codes = [...new Set(rows.flatMap((r) => [r.origin, r.destination]).filter((c): c is string => !!c))]
  const termini = new Map<string, string>()
  for (const chunk of chunked(codes, 200)) {
    const r = await db.query(`MATCH (s:Stop) WHERE ${orChain('s.atco_code', chunk)} RETURN s.atco_code, s.name`)
    r.tuples().forEach(([code, name]) => termini.set(String(code), String(name)))
  }
  return { info, routes: rows, termini, queries }
}

/** Rows of (route, mode, sequence, stop) as one overlay: each route drawn as
 *  its consecutive stop pairs, coloured by mode, a pair shared by several
 *  routes drawn once in the highest-ranked mode. */
export function routesOverlay(id: string, title: string, rows: { route: number[]; mode: string[]; sequence: number[]; stop: number[] }, extra: Partial<Overlay> = {}): Overlay {
  const byRoute = new Map<number, number[]>()
  rows.route.forEach((r, k) => {
    const list = byRoute.get(r)
    if (list) list.push(k)
    else byRoute.set(r, [k])
  })
  const edges = new Map<string, OverlayEdge & { rank: number }>()
  for (const ks of byRoute.values()) {
    ks.sort((x, y) => rows.sequence[x] - rows.sequence[y])
    for (let j = 0; j + 1 < ks.length; j++) {
      const a = rows.stop[ks[j]], b = rows.stop[ks[j + 1]]
      const mode = modeById.get(rows.mode[ks[j]])
      const rank = mode?.rank ?? 0
      const key = a < b ? `${a}|${b}` : `${b}|${a}`
      const prev = edges.get(key)
      if (!prev || prev.rank < rank) edges.set(key, { src: String(a), tgt: String(b), tone: modeColor(mode?.id) as `#${string}`, width: rank >= 4 ? 0.26 : 0.17, rank })
    }
  }
  return {
    id,
    title,
    edges: [...edges.values()].map(({ rank, ...e }) => e),
    dimOthers: true,
    honesty: 'measured',
    ...extra,
  }
}

export async function stopRoutesOverlay(db: TuringClient, stop: StopInfo): Promise<{ overlay: Overlay; query: string }> {
  const query = `MATCH (s:Stop)<-[:CALLS_AT]-(r:Route)-[c:CALLS_AT]->(t:Stop) WHERE ${seekNodes('s', [stop.id])} RETURN r, r.mode, c.sequence, t`
  const r = await db.query(query)
  const key = String(stop.id)
  const overlay = routesOverlay('stop-routes', `Routes calling at ${stop.name}`, {
    route: r.column<number>(0), mode: r.column<string>(1), sequence: r.column<number>(2), stop: r.column<number>(3),
  }, { nodes: [{ id: key, tone: 'focus', label: stop.name }], labels: [key] })
  const neighbours = (overlay.edges ?? []).flatMap((e) => (e.src === key ? [e.tgt] : e.tgt === key ? [e.src] : []))
  overlay.focus = [key, ...neighbours]
  return { overlay, query }
}

export async function routeOverlay(db: TuringClient, route: RouteRow, names: (id: number) => string): Promise<{ overlay: Overlay; query: string }> {
  const query = `MATCH (r:Route)-[c:CALLS_AT]->(t:Stop) WHERE ${seekNodes('r', [route.id])} RETURN r, r.mode, c.sequence, t ORDER BY c.sequence`
  const r = await db.query(query)
  const stops = r.column<number>(3)
  const ends = [stops[0], stops[stops.length - 1]].filter((x) => x !== undefined).map(String)
  const overlay = routesOverlay('route', `${route.line ?? route.mode} · ${names(stops[0])} → ${names(stops[stops.length - 1])}`, {
    route: r.column<number>(0), mode: r.column<string>(1), sequence: r.column<number>(2), stop: stops,
  }, { nodes: ends.map((id) => ({ id, tone: 'focus' as const, label: names(Number(id)) })), labels: ends })
  overlay.edges = overlay.edges?.map((e) => ({ ...e, width: 0.3 }))
  return { overlay, query }
}

export interface OperatorRow { id: number; name: string; code: string; routes: number; modes: Map<string, number> }

export const OPERATORS_QUERY = 'MATCH (o:Operator)-[:RUNS]->(r:Route) RETURN o, o.name, o.operator_id, r.mode, count(r) AS routes'

export async function loadOperators(db: TuringClient): Promise<OperatorRow[]> {
  const r = await db.query(OPERATORS_QUERY)
  const out = new Map<number, OperatorRow>()
  r.tuples().forEach(([id, name, code, mode, n]) => {
    const k = Number(id)
    const row = out.get(k) ?? { id: k, name: String(name ?? code), code: String(code ?? ''), routes: 0, modes: new Map<string, number>() }
    row.routes += Number(n)
    row.modes.set(String(mode), (row.modes.get(String(mode)) ?? 0) + Number(n))
    out.set(k, row)
  })
  return [...out.values()].sort((a, b) => b.routes - a.routes)
}

export async function operatorOverlay(db: TuringClient, op: OperatorRow): Promise<{ overlay: Overlay; query: string; stops: number }> {
  const query = cy`MATCH (o:Operator)-[:RUNS]->(r:Route)-[c:CALLS_AT]->(t:Stop) WHERE o.operator_id = ${op.code} RETURN r, r.mode, c.sequence, t`
  const r = await db.query(query, { timeoutMs: 120_000 })
  const stops = new Set(r.column<number>(3)).size
  const overlay = routesOverlay('operator', `${op.name} · ${op.routes.toLocaleString()} routes`, {
    route: r.column<number>(0), mode: r.column<string>(1), sequence: r.column<number>(2), stop: r.column<number>(3),
  })
  return { overlay, query, stops }
}
