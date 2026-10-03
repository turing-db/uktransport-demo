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
