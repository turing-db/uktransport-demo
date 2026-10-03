// A shortestPath over `minutes` (NEXT hops and TRANSFER walks), turned into
// the services a traveller would take. The fastest hop between two stops can
// belong to a different route each time, and can detour through a stop an
// express skips, so the path's stops serve as waypoints: from each boarding
// stop, ride the route that reaches the furthest later waypoint without being
// much slower than the path, then change. Each leg lists that route's own
// stops and timetable.

import { chunked, seekNodes } from '@kit/cypher'
import { findPath, type PathResult } from '@kit/paths'
import type { TuringClient } from '@kit/tdb-client'
import { loadServices, type Service } from './routes'

export interface Endpoint { label: string; atco: string }

export interface LegStop {
  id: number
  name: string
  indicator: string | null
  /** Minutes from departure. */
  at: number
}

export interface Leg {
  kind: 'ride' | 'walk'
  mode: string
  service: Service | null
  /** Other routes making the same ride. */
  alternatives: number
  stops: LegStop[]
  minutes: number
  metres: number | null
}

export interface Journey {
  path: PathResult
  legs: Leg[]
  minutes: number
}

interface Call { route: number; routeId: number; services: number; sequence: number; departure: number | null; arrival: number | null }

interface Ride { from: number; to: number; board: Call | null; alight: Call | null; alternatives: number }

/** A ride may take this much longer than the path between the same two stops. */
const SLACK_FACTOR = 1.3
const SLACK_MINUTES = 5

export async function planJourney(db: TuringClient, from: Endpoint, to: Endpoint): Promise<Journey> {
  const path = await findPath(db, { from: { label: 'Stop', prop: 'atco_code', value: from.atco }, to: { label: 'Stop', prop: 'atco_code', value: to.atco }, weight: 'minutes' })
  if (!path.found) return { path, legs: [], minutes: 0 }

  const ids = path.nodeIds
  const edges = await db.edges(path.edgeIds)
  const hops = path.edgeIds.map((edgeId) => edges.get(edgeId)?.props ?? {})
  const pathAt = [0]
  hops.forEach((props, i) => pathAt.push(pathAt[i] + Number(props.minutes ?? 0)))

  const callsAt = await loadCalls(db, ids)
  const steps: ({ kind: 'walk'; hop: number } | ({ kind: 'ride' } & Ride))[] = []
  let i = 0
  while (i < hops.length) {
    if (hops[i].route_id == null) {
      steps.push({ kind: 'walk', hop: i })
      i++
      continue
    }
    let end = i
    while (end < hops.length && hops[end].route_id != null) end++
    const ride = furthestRide(callsAt, pathAt, i, end)
    steps.push({ kind: 'ride', ...ride })
    i = ride.to
  }

  const rides = steps.filter((s): s is { kind: 'ride' } & Ride => s.kind === 'ride')
  const services = await loadServices(db, [...new Set(rides.flatMap((r) => (r.board ? [r.board.routeId] : [Number(hops[r.from].route_id)])))])
  const routeStops = await loadRouteStops(db, [...new Set(rides.flatMap((r) => (r.board ? [r.board.route] : [])))])
  const pathStop = (position: number, at: number): LegStop => {
    const props = path.nodes[position]?.props ?? {}
    return { id: ids[position], name: String(props.name ?? ids[position]), indicator: props.indicator == null ? null : String(props.indicator), at }
  }

  const legs: Leg[] = []
  let clock = 0
  for (const step of steps) {
    if (step.kind === 'walk') {
      const props = hops[step.hop]
      const minutes = Number(props.minutes ?? 0)
      const metres = props.metres == null ? null : Number(props.metres)
      const last = legs[legs.length - 1]
      if (last && last.kind === 'walk') {
        last.stops.push(pathStop(step.hop + 1, clock + minutes))
        last.minutes += minutes
        last.metres = metres === null ? last.metres : (last.metres ?? 0) + metres
      } else {
        legs.push({ kind: 'walk', mode: String(props.mode ?? 'walk'), service: null, alternatives: 0, stops: [pathStop(step.hop, clock), pathStop(step.hop + 1, clock + minutes)], minutes, metres })
      }
      clock += minutes
      continue
    }

    const { board, alight } = step
    const service = services.get(board ? board.routeId : Number(hops[step.from].route_id)) ?? null
    const start = board ? board.departure ?? board.arrival ?? 0 : 0
    const calls = board && alight ? (routeStops.get(board.route) ?? []).filter((c) => c.sequence >= board.sequence && c.sequence <= alight.sequence) : []
    const stops: LegStop[] = calls.length >= 2
      ? calls.map((c) => ({ id: c.stop, name: c.name, indicator: c.indicator, at: clock + Math.max(0, (c.arrival ?? c.departure ?? start) - start) }))
      : ids.slice(step.from, step.to + 1).map((_, k) => pathStop(step.from + k, clock + pathAt[step.from + k] - pathAt[step.from]))
    const minutes = stops[stops.length - 1].at - clock
    legs.push({ kind: 'ride', mode: service?.mode ?? String(hops[step.from].mode ?? ''), service, alternatives: step.alternatives, stops, minutes, metres: null })
    clock += minutes
  }
  return { path, legs, minutes: clock }
}

/** From path position `i`, the route reaching the furthest position up to `end`
 *  (the end of this run of rides) without being much slower than the path; among routes
 *  reaching as far, the one with the most trips. */
function furthestRide(callsAt: Call[][], pathAt: number[], i: number, end: number): Ride {
  let best = null as Ride | null
  for (const board of callsAt[i]) {
    for (let k = end; k > i; k--) {
      const alight = callsAt[k].find((c) => c.route === board.route && c.sequence > board.sequence)
      if (!alight) continue
      const ride = minutesBetween(board, alight)
      const fastEnough = ride === null || ride <= SLACK_FACTOR * (pathAt[k] - pathAt[i]) + SLACK_MINUTES
      if (!fastEnough) continue
      if (!best || k > best.to) {
        best = { from: i, to: k, board, alight, alternatives: 0 }
      } else if (k === best.to) {
        const busier = board.services > (best.board?.services ?? 0)
        best = busier ? { from: i, to: k, board, alight, alternatives: best.alternatives + 1 } : { ...best, alternatives: best.alternatives + 1 }
      }
      break
    }
  }
  return best ?? { from: i, to: i + 1, board: null, alight: null, alternatives: 0 }
}

function minutesBetween(board: Call, alight: Call): number | null {
  const departure = board.departure ?? board.arrival
  const arrival = alight.arrival ?? alight.departure
  return departure === null || arrival === null ? null : arrival - departure
}

/** For each stop of the path, the routes calling there. */
async function loadCalls(db: TuringClient, ids: number[]): Promise<Call[][]> {
  const byStop = new Map<number, Call[]>()
  for (const chunk of chunked([...new Set(ids)], 200)) {
    const r = await db.query(`MATCH (s:Stop)<-[c:CALLS_AT]-(r:Route) WHERE ${seekNodes('s', chunk)} RETURN s, r, r.route_id, r.services, c.sequence, c.departure_minutes, c.arrival_minutes`)
    for (const [stop, route, routeId, services, sequence, departure, arrival] of r.tuples()) {
      const calls = byStop.get(Number(stop)) ?? []
      calls.push({ route: Number(route), routeId: Number(routeId), services: Number(services ?? 0), sequence: Number(sequence), departure: departure == null ? null : Number(departure), arrival: arrival == null ? null : Number(arrival) })
      byStop.set(Number(stop), calls)
    }
  }
  return ids.map((id) => byStop.get(id) ?? [])
}

async function loadRouteStops(db: TuringClient, routes: number[]) {
  const out = new Map<number, { stop: number; name: string; indicator: string | null; sequence: number; departure: number | null; arrival: number | null }[]>()
  for (const chunk of chunked(routes, 200)) {
    const r = await db.query(`MATCH (r:Route)-[c:CALLS_AT]->(t:Stop) WHERE ${seekNodes('r', chunk)} RETURN r, t, t.name, t.indicator, c.sequence, c.departure_minutes, c.arrival_minutes`)
    for (const [route, stop, name, indicator, sequence, departure, arrival] of r.tuples()) {
      const calls = out.get(Number(route)) ?? []
      calls.push({ stop: Number(stop), name: String(name ?? stop), indicator: indicator == null ? null : String(indicator), sequence: Number(sequence), departure: departure == null ? null : Number(departure), arrival: arrival == null ? null : Number(arrival) })
      out.set(Number(route), calls)
    }
  }
  for (const calls of out.values()) calls.sort((a, b) => a.sequence - b.sequence)
  return out
}

export function formatMinutes(m: number): string {
  const total = Math.round(m)
  const h = Math.floor(total / 60)
  return h ? `${h} h ${String(total % 60).padStart(2, '0')} min` : `${total} min`
}
