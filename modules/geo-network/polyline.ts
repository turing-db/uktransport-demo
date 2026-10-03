import type { LngLat } from '@kit/geo-map'

/** Cumulative length (km, equirectangular) at each vertex of a lng/lat polyline. */
export function polylineLengths(coords: LngLat[]): Float64Array {
  const out = new Float64Array(coords.length)
  for (let i = 1; i < coords.length; i++) {
    const [lng0, lat0] = coords[i - 1], [lng1, lat1] = coords[i]
    const x = (lng1 - lng0) * Math.cos(((lat0 + lat1) / 2) * (Math.PI / 180))
    const y = lat1 - lat0
    out[i] = out[i - 1] + Math.sqrt(x * x + y * y) * 111.32
  }
  return out
}

/** The point a fraction f (0..1) of the way along the polyline, by length. */
export function alongPolyline(coords: LngLat[], lengths: Float64Array, f: number): LngLat {
  const total = lengths[lengths.length - 1]
  if (!(total > 0)) return coords[0]
  const d = Math.max(0, Math.min(1, f)) * total
  let lo = 0, hi = lengths.length - 1
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1
    if (lengths[mid] <= d) lo = mid
    else hi = mid
  }
  const span = lengths[hi] - lengths[lo]
  const t = span > 0 ? (d - lengths[lo]) / span : 0
  return [coords[lo][0] + (coords[hi][0] - coords[lo][0]) * t, coords[lo][1] + (coords[hi][1] - coords[lo][1]) * t]
}
