// A shortestPath over `minutes` (NEXT hops and TRANSFER walks), cut into legs:
// one per run of hops of the same mode, one per walk. The fastest hop between
// two stops can belong to a different route each time, so a leg lists the
// operators whose routes it uses rather than claiming to be one service.

import { chunked } from '@kit/cypher'
import { findPath, type PathResult } from '@kit/paths'
import type { TuringClient } from '@kit/tdb-client'

export interface Endpoint { label: string; atco: string }

export interface Leg {
  kind: 'ride' | 'walk'
  mode: string
  routeIds: number[]
  lines: string[]
  operators: string[]
  /** Positions in the path's node list. */
  from: number
  to: number
  minutes: number
  metres: number | null
}

export interface Journey { path: PathResult; legs: Leg[] }

export async function planJourney(db: TuringClient, from: Endpoint, to: Endpoint): Promise<Journey> {
  const path = await findPath(db, { from: { label: 'Stop', prop: 'atco_code', value: from.atco }, to: { label: 'Stop', prop: 'atco_code', value: to.atco }, weight: 'minutes' })
  if (!path.found) return { path, legs: [] }

  const edges = await db.edges(path.edgeIds)
  const legs: Leg[] = []
  path.edgeIds.forEach((edgeId, i) => {
    const props = edges.get(edgeId)?.props ?? {}
    const routeId = props.route_id == null ? null : Number(props.route_id)
    const kind = routeId === null ? 'walk' : 'ride'
    const minutes = Number(props.minutes ?? 0)
    const last = legs[legs.length - 1]
    const mode = String(props.mode ?? 'walk')
    const continues = last && last.kind === kind && last.mode === mode
    if (continues) {
      last.to = i + 1
      last.minutes += minutes
      if (props.metres != null) last.metres = (last.metres ?? 0) + Number(props.metres)
      if (routeId !== null && !last.routeIds.includes(routeId)) last.routeIds.push(routeId)
      return
    }
    legs.push({ kind, mode, routeIds: routeId === null ? [] : [routeId], lines: [], operators: [], from: i, to: i + 1, minutes, metres: props.metres == null ? null : Number(props.metres) })
  })

  const routeIds = [...new Set(legs.flatMap((l) => l.routeIds))]
  const line = new Map<number, string>()
  const operator = new Map<number, string>()
  for (const chunk of chunked(routeIds, 200)) {
    const where = chunk.map((r) => `r.route_id = ${r}`).join(' OR ')
    const [routes, operators] = await Promise.all([
      db.query(`MATCH (r:Route) WHERE ${where} RETURN r.route_id, r.line`),
      db.query(`MATCH (o:Operator)-[:RUNS]->(r:Route) WHERE ${where} RETURN r.route_id, o.name`),
    ])
    routes.tuples().forEach((t) => { if (t[1] != null) line.set(Number(t[0]), String(t[1])) })
    operators.tuples().forEach((t) => operator.set(Number(t[0]), String(t[1])))
  }
  for (const l of legs) {
    l.lines = [...new Set(l.routeIds.map((r) => line.get(r)).filter((x): x is string => !!x))]
    l.operators = [...new Set(l.routeIds.map((r) => operator.get(r)).filter((x): x is string => !!x))]
  }
  return { path, legs }
}

export function formatMinutes(m: number): string {
  const total = Math.round(m)
  const h = Math.floor(total / 60)
  return h ? `${h} h ${String(total % 60).padStart(2, '0')} min` : `${total} min`
}
