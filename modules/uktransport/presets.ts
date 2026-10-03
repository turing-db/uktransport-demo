import type { QueryPreset } from '@kit/presets'

const GOLD = { kind: 'auto', tone: 'path' } as const

export const PRESETS: QueryPreset[] = [
  { id: 'hubs', group: 'Hubs', title: 'The 25 stops served by the most routes', keywords: ['busiest', 'hub', 'most routes', 'biggest'], result: GOLD,
    cypher: 'MATCH (r:Route)-[:CALLS_AT]->(s:Stop) RETURN s, s.name AS stop, s.locality AS locality, count(r) AS routes ORDER BY routes DESC LIMIT 25' },
  { id: 'change', group: 'Hubs', title: 'Stations needing the longest time to change trains', keywords: ['change', 'interchange'], result: GOLD,
    cypher: 'MATCH (st:Station)-[:AT]->(s:Stop) RETURN s, st.name AS station, st.crs AS crs, st.change_minutes AS minutes ORDER BY minutes DESC LIMIT 20' },
  { id: 'reach', group: 'Hubs', title: 'Stops within 4 rail stops of $crs', badge: 'paths', keywords: ['reach', 'within', 'near'], result: GOLD,
    params: { crs: { type: 'string', default: 'BHM', label: 'station CRS' } },
    cypher: 'MATCH (st:Station {crs: $crs})-[:AT]->(s:Stop)-[:NEXT*1..4]->(t:Stop) RETURN DISTINCT t, t.name AS stop' },
  { id: 'ferries', group: 'Networks', title: 'Every ferry crossing', keywords: ['ferry', 'boat', 'island', 'sea'], result: GOLD,
    cypher: "MATCH (a:Stop)-[e:NEXT]->(b:Stop) WHERE e.mode = 'ferry' RETURN a, b, a.name AS from_stop, b.name AS to_stop, count(e) AS routes" },
  { id: 'trams', group: 'Networks', title: 'Tram and light-rail networks', keywords: ['tram', 'light rail'], result: GOLD,
    cypher: "MATCH (a:Stop)-[e:NEXT]->(b:Stop) WHERE e.mode = 'tram' RETURN a, b, count(e) AS routes" },
  { id: 'metro', group: 'Networks', title: 'Metro and underground', keywords: ['metro', 'underground', 'tube', 'subway'], result: GOLD,
    cypher: "MATCH (a:Stop)-[e:NEXT]->(b:Stop) WHERE e.mode = 'metro' RETURN a, b, count(e) AS routes" },
  { id: 'slow', group: 'Networks', title: 'Hops longer than $minutes minutes without a stop', badge: 'param', keywords: ['long', 'nonstop', 'express'], result: GOLD,
    params: { minutes: { type: 'number', default: 120, label: 'minutes' } },
    cypher: 'MATCH (a:Stop)-[e:NEXT]->(b:Stop) WHERE e.minutes > $minutes RETURN a, b, a.name AS from_stop, b.name AS to_stop, e.mode AS mode, max(e.minutes) AS minutes ORDER BY minutes DESC LIMIT 100' },
  { id: 'longest', group: 'Routes', title: 'Routes with the most stops', keywords: ['longest', 'most stops'], result: { kind: 'table' },
    cypher: 'MATCH (o:Operator)-[:RUNS]->(r:Route) RETURN r.route_id AS route, r.mode AS mode, r.line AS line, o.name AS operator, r.stops AS stops ORDER BY stops DESC LIMIT 15' },
  { id: 'modes', group: 'Routes', title: 'Routes and trips per mode', keywords: ['mode', 'share'], result: { kind: 'table' },
    cypher: 'MATCH (r:Route) RETURN r.mode AS mode, count(r) AS routes, sum(r.services) AS trips ORDER BY routes DESC' },
  { id: 'walks', group: 'Walking', title: 'The longest walking transfers', keywords: ['walk', 'transfer', 'on foot'], result: GOLD,
    cypher: "MATCH (a:Stop)-[t:TRANSFER]->(b:Stop) WHERE t.mode = 'walk' RETURN a, t, b, a.name AS from_stop, b.name AS to_stop, t.metres AS metres ORDER BY metres DESC LIMIT 30" },
  { id: 'route', group: 'Paths', title: 'Fastest chain of hops from $from to $to', badge: 'shortestPath', keywords: ['route', 'path', 'fastest', 'shortest'], result: { kind: 'path' },
    params: { from: { type: 'string', default: '9100PENZNCE', label: 'from ATCO' }, to: { type: 'string', default: '9100THURSO', label: 'to ATCO' } },
    cypher: 'MATCH (a:Stop {atco_code: $from}), (b:Stop {atco_code: $to}) shortestPath(a, b, minutes, dist, path) RETURN dist, path' },
]
