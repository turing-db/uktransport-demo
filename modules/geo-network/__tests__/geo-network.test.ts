import { describe, expect, it } from 'vitest'
import { alongPolyline, countByCategory, distanceToSegment, lineCollections, NO_CATEGORY, pointCollections, PointGrid, polylineLengths, SegmentGrid, weightBucket, type DenseNetwork } from '../index'

// Four nodes on a line of longitude-spaced points, two categories of segments.
const net: DenseNetwork = {
  lng: Float64Array.from([0, 0.01, 0.02, 1]),
  lat: Float64Array.from([51, 51, 51, 52]),
  nodeCategory: Uint8Array.from([0, 0, 1, NO_CATEGORY]),
  src: Uint32Array.from([0, 1, 2]),
  tgt: Uint32Array.from([1, 2, 3]),
  edgeCategory: Uint8Array.from([0, 0, 1]),
  weight: Float32Array.from([1, 3, 20]),
}

describe('geo-network', () => {
  it('buckets weights 1, 2, 3-4, 5-8, 9-16, 17+', () => {
    expect([1, 2, 3, 4, 5, 8, 9, 16, 17, 400].map(weightBucket)).toEqual([0, 1, 2, 2, 3, 3, 4, 4, 5, 5])
  })

  it('merges segments into one MultiLineString per category and bucket', () => {
    const [local, trunk] = lineCollections(net, 2)
    expect(local.features.map((f) => [f.properties?.n, f.geometry.coordinates.length])).toEqual([[1, 1], [1, 1]])
    expect(trunk.features).toHaveLength(1)
    expect(trunk.features[0].geometry.coordinates[0]).toEqual([[0.02, 51], [1, 52]])
  })

  it('draws no point for NO_CATEGORY and counts per category', () => {
    const [a, b] = pointCollections(net, 2)
    expect(a.features[0].geometry.coordinates).toHaveLength(2)
    expect(b.features[0].geometry.coordinates).toEqual([[0.02, 51]])
    expect(countByCategory(net.edgeCategory, 2)).toEqual([2, 1])
  })

  it('picks the nearest accepted node within the radius, never an undrawn one', () => {
    const grid = new PointGrid(net)
    expect(grid.size).toBe(3)
    expect(grid.nearest(0.012, 51, 0.005, 0.005)).toBe(1)
    expect(grid.nearest(0.012, 51, 0.005, 0.005, (i) => i !== 1)).toBe(-1)
    expect(grid.nearest(1, 52, 0.01, 0.01)).toBe(-1)
  })

  it('lists a segment in every cell its line crosses', () => {
    const grid = new SegmentGrid(net)
    expect([...grid.near(0.5, 51.5, 0.5, 51.5)]).toEqual([2])
    expect([...grid.near(0.005, 51, 0.006, 51)].sort()).toEqual([0, 1, 2])
    expect(grid.near(5, 55, 6, 56).size).toBe(0)
  })

  it('measures the distance to a segment, clamped to its ends', () => {
    expect(distanceToSegment(5, 3, 0, 0, 10, 0)).toBe(3)
    expect(distanceToSegment(-4, 3, 0, 0, 10, 0)).toBe(5)
    expect(distanceToSegment(1, 1, 2, 2, 2, 2)).toBeCloseTo(Math.SQRT2)
  })

  it('interpolates along a polyline by length', () => {
    const coords: [number, number][] = [[0, 0], [0, 1], [0, 3]]
    const lengths = polylineLengths(coords)
    expect(lengths[2]).toBeCloseTo(3 * 111.32, 6)
    expect(alongPolyline(coords, lengths, 0.5)).toEqual([0, 1.5])
    expect(alongPolyline(coords, lengths, 1)).toEqual([0, 3])
  })
})
