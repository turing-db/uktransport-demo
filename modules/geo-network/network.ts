// Pure half of @kit/geo-network: a dense network held in typed arrays, turned
// into a handful of GeoJSON features (one MultiLineString per category and
// weight bucket, one MultiPoint per category) and a grid index for picking.
// Hundreds of thousands of segments stay cheap because nothing here creates an
// object per segment beyond its coordinates.

import type { Feature, FeatureCollection, MultiLineString, MultiPoint } from 'geojson'

export interface NetworkCategory {
  id: string
  label: string
  color: string
  /** Line width (px at zoom 12) of a segment of weight 1. */
  width?: number
  /** Line opacity at zoom 4 and at zoom 12. */
  opacity?: [number, number]
  /** A blurred halo under the lines. */
  glow?: boolean
  dash?: 'solid' | 'dashed' | 'dotted'
  /** Lines hidden below this zoom. */
  minzoom?: number
  /** Point radius (px at zoom 12); 0 or absent draws no points. */
  pointRadius?: number
  /** Points hidden below this zoom. */
  pointMinzoom?: number
}

/** Nodes and segments as parallel typed arrays. Categories are indexes into the
 *  `categories` prop; NO_CATEGORY on a node means "never drawn, never picked". */
export interface DenseNetwork {
  lng: Float64Array
  lat: Float64Array
  nodeCategory: Uint8Array
  src: Uint32Array
  tgt: Uint32Array
  edgeCategory: Uint8Array
  /** e.g. how many routes share the segment; widths grow with it in buckets. */
  weight?: Float32Array
}

export const NO_CATEGORY = 255

/** Inclusive upper bounds of the weight buckets: 1, 2, 3–4, 5–8, 9–16, 17+. */
export const WEIGHT_BUCKETS = [1, 2, 4, 8, 16, Infinity]

export function weightBucket(w: number): number {
  for (let b = 0; b < WEIGHT_BUCKETS.length; b++) if (w <= WEIGHT_BUCKETS[b]) return b
  return WEIGHT_BUCKETS.length - 1
}

/** Relative line width of a bucket (1 for a single-route segment). */
export const bucketWidth = (bucket: number) => 1 + 0.45 * bucket

/** One FeatureCollection per category; each holds one MultiLineString per
 *  non-empty weight bucket, with `w` (relative width) as its property. */
export function lineCollections(net: DenseNetwork, categoryCount: number): FeatureCollection<MultiLineString>[] {
  const lines: number[][][][][] = Array.from({ length: categoryCount }, () => WEIGHT_BUCKETS.map(() => []))
  for (let e = 0; e < net.src.length; e++) {
    const c = net.edgeCategory[e]
    if (c >= categoryCount) continue
    const a = net.src[e], b = net.tgt[e]
    lines[c][weightBucket(net.weight ? net.weight[e] : 1)].push([[net.lng[a], net.lat[a]], [net.lng[b], net.lat[b]]])
  }
  return lines.map((buckets) => ({
    type: 'FeatureCollection',
    features: buckets.flatMap((coordinates, bucket): Feature<MultiLineString>[] => coordinates.length
      ? [{ type: 'Feature', properties: { w: bucketWidth(bucket), n: coordinates.length }, geometry: { type: 'MultiLineString', coordinates } }]
      : []),
  }))
}

/** One FeatureCollection per category holding a single MultiPoint of its nodes. */
export function pointCollections(net: DenseNetwork, categoryCount: number): FeatureCollection<MultiPoint>[] {
  const points: number[][][] = Array.from({ length: categoryCount }, () => [])
  for (let i = 0; i < net.lng.length; i++) {
    const c = net.nodeCategory[i]
    if (c < categoryCount) points[c].push([net.lng[i], net.lat[i]])
  }
  return points.map((coordinates) => ({
    type: 'FeatureCollection',
    features: coordinates.length ? [{ type: 'Feature', properties: { n: coordinates.length }, geometry: { type: 'MultiPoint', coordinates } }] : [],
  }))
}

/** Segment counts per category, for legends. */
export function countByCategory(categories: Uint8Array, categoryCount: number): number[] {
  const out = new Array<number>(categoryCount).fill(0)
  for (let i = 0; i < categories.length; i++) if (categories[i] < categoryCount) out[categories[i]]++
  return out
}

/** A uniform lng/lat grid over the segments, each listed in every cell its
 *  line crosses, so a click finds the few segments near it. */
export class SegmentGrid {
  private readonly cells = new Map<number, number[]>()

  constructor(net: DenseNetwork, private readonly cellDegrees = 0.05) {
    for (let e = 0; e < net.src.length; e++) {
      const a = net.src[e], b = net.tgt[e]
      const x0 = net.lng[a], y0 = net.lat[a], x1 = net.lng[b], y1 = net.lat[b]
      const steps = Math.ceil((2 * Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0))) / cellDegrees) + 1
      let previous = -1
      for (let s = 0; s <= steps; s++) {
        const key = this.cellKey(x0 + ((x1 - x0) * s) / steps, y0 + ((y1 - y0) * s) / steps)
        if (key === previous) continue
        previous = key
        const list = this.cells.get(key)
        if (list) {
          if (list[list.length - 1] !== e) list.push(e)
        } else {
          this.cells.set(key, [e])
        }
      }
    }
  }

  /** Segments listed in the cells of a lng/lat box. */
  near(lng0: number, lat0: number, lng1: number, lat1: number): Set<number> {
    const out = new Set<number>()
    const size = this.cellDegrees
    for (let x = Math.floor((lng0 + 180) / size); x <= Math.floor((lng1 + 180) / size); x++) {
      for (let y = Math.floor((lat0 + 90) / size); y <= Math.floor((lat1 + 90) / size); y++) {
        for (const e of this.cells.get(x * 100_000 + y) ?? []) out.add(e)
      }
    }
    return out
  }

  private cellKey(lng: number, lat: number) {
    return Math.floor((lng + 180) / this.cellDegrees) * 100_000 + Math.floor((lat + 90) / this.cellDegrees)
  }
}

/** Distance in px from point p to the segment a-b. */
export function distanceToSegment(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax, dy = by - ay
  const length2 = dx * dx + dy * dy
  const t = length2 > 0 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / length2)) : 0
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy))
}

/** A uniform lng/lat grid over the drawable nodes, for "which node is under the
 *  cursor" without one map feature per node. Cells hold node indexes in CSR form. */
export class PointGrid {
  private readonly cells = new Map<number, [number, number]>()
  private readonly order: Uint32Array

  constructor(private readonly net: DenseNetwork, private readonly cellDegrees = 0.02) {
    const keyed: number[] = []
    for (let i = 0; i < net.lng.length; i++) if (net.nodeCategory[i] !== NO_CATEGORY) keyed.push(i)
    const keys = new Float64Array(net.lng.length)
    for (const i of keyed) keys[i] = this.cellKey(this.cellX(net.lng[i]), this.cellY(net.lat[i]))
    keyed.sort((a, b) => keys[a] - keys[b])
    this.order = Uint32Array.from(keyed)
    let start = 0
    for (let k = 1; k <= keyed.length; k++) {
      if (k === keyed.length || keys[keyed[k]] !== keys[keyed[start]]) {
        this.cells.set(keys[keyed[start]], [start, k])
        start = k
      }
    }
  }

  get size() { return this.order.length }

  /** The accepted node nearest to (lng, lat) within an ellipse of radii
   *  (rLng, rLat) degrees — the cursor's pick radius at the current zoom — or -1. */
  nearest(lng: number, lat: number, rLng: number, rLat: number, accept: (i: number) => boolean = () => true): number {
    let best = -1
    let bestD = 1
    const x0 = this.cellX(lng - rLng), x1 = this.cellX(lng + rLng)
    const y0 = this.cellY(lat - rLat), y1 = this.cellY(lat + rLat)
    for (let x = x0; x <= x1; x++) {
      for (let y = y0; y <= y1; y++) {
        const cell = this.cells.get(this.cellKey(x, y))
        if (!cell) continue
        for (let k = cell[0]; k < cell[1]; k++) {
          const i = this.order[k]
          const dx = (this.net.lng[i] - lng) / rLng, dy = (this.net.lat[i] - lat) / rLat
          const d = dx * dx + dy * dy
          if (d <= bestD && accept(i)) { bestD = d; best = i }
        }
      }
    }
    return best
  }

  private cellX(lng: number) { return Math.floor((lng + 180) / this.cellDegrees) }
  private cellY(lat: number) { return Math.floor((lat + 90) / this.cellDegrees) }
  private cellKey(x: number, y: number) { return x * 100_000 + y }
}
