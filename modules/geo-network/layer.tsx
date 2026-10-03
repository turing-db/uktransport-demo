// <GeoNetwork>: the whole network as a base layer of a <GeoMap>, built once.
// Mode toggles are layout visibility, dimming is a paint change, picking is a
// grid lookup — none of them rebuilds the data, which is what keeps a
// country-sized network (400k+ segments) interactive. Overlays stay with
// <GeoSurface>, mounted after this one and drawn above it.

import type { GeoJSONSource, Map as MLMap, MapMouseEvent } from 'maplibre-gl'
import { useEffect, useMemo, useRef } from 'react'
import { useGeoMap, whenStyleReady } from '@kit/geo-map'
import { compose, overlays as defaultStore, type NodeKey, type OverlayStore } from '@kit/overlay'
import { useOverlays } from '@kit/ui'
import { lineCollections, NO_CATEGORY, pointCollections, PointGrid, type DenseNetwork, type NetworkCategory } from './network'

export interface NetworkHover { index: number; key: NodeKey; x: number; y: number }

export interface GeoNetworkProps {
  network: DenseNetwork
  categories: NetworkCategory[]
  /** Category ids to draw (default: all). */
  visible?: readonly string[]
  /** The overlay key of node i (default: i). A click publishes it as the pick. */
  keyOf?: (index: number) => NodeKey
  store?: OverlayStore
  /** Unique prefix if two networks share one map. */
  id?: string
  /** Insert under the basemap's top labels (default true): place names stay readable. */
  underLabels?: boolean
  /** Clicks over these layers are left to them, e.g. GeoSurface's `kit-nodes`. */
  yieldTo?: string[]
  /** Pick radius in px (default 8). */
  pickRadius?: number
  /** Opacity of the network while an overlay dims the rest (default 0.15). */
  dimTo?: number
  onHover?: (hit: NetworkHover | null) => void
}

export function GeoNetwork(p: GeoNetworkProps) {
  const { map, epoch } = useGeoMap()
  const store = p.store ?? defaultStore
  const P = p.id ?? 'net'
  const cats = p.categories
  const list = useOverlays(store)
  const dimmed = useMemo(() => compose([...list]).dim !== null, [list])
  const factor = dimmed ? p.dimTo ?? 0.15 : 1
  const visibleKey = (p.visible ?? cats.map((c) => c.id)).join('|')

  const data = useMemo(() => ({ lines: lineCollections(p.network, cats.length), points: pointCollections(p.network, cats.length) }), [p.network, cats.length])
  const grid = useMemo(() => new PointGrid(p.network), [p.network])

  useEffect(() => {
    if (!map) return
    whenStyleReady(map, () => {
      const before = p.underLabels === false ? undefined : firstTopLabel(map)
      cats.forEach((c, i) => {
        addSource(map, `${P}-l${i}`)
        if (c.glow) addLayer(map, { id: `${P}-glow-${i}`, type: 'line', source: `${P}-l${i}`, minzoom: c.minzoom ?? 0, layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': c.color, 'line-blur': 4 } }, before)
      })
      cats.forEach((c, i) => {
        const dash = c.dash === 'dashed' ? [2, 1.5] : c.dash === 'dotted' ? [0.5, 1.6] : undefined
        addLayer(map, { id: `${P}-line-${i}`, type: 'line', source: `${P}-l${i}`, minzoom: c.minzoom ?? 0, layout: { 'line-cap': dash ? 'butt' : 'round', 'line-join': 'round' }, paint: { 'line-color': c.color, ...(dash ? { 'line-dasharray': dash } : {}) } }, before)
      })
      cats.forEach((c, i) => {
        if (!c.pointRadius) return
        addSource(map, `${P}-p${i}`)
        addLayer(map, { id: `${P}-pt-${i}`, type: 'circle', source: `${P}-p${i}`, minzoom: c.pointMinzoom ?? 0, paint: { 'circle-color': c.color, 'circle-stroke-color': 'rgba(0,0,0,0.65)' } }, before)
      })
    })
  }, [map, epoch, P, cats, p.underLabels])

  useEffect(() => {
    if (!map) return
    whenStyleReady(map, () => {
      cats.forEach((c, i) => {
        (map.getSource(`${P}-l${i}`) as GeoJSONSource | undefined)?.setData(data.lines[i])
        if (c.pointRadius) (map.getSource(`${P}-p${i}`) as GeoJSONSource | undefined)?.setData(data.points[i])
      })
    })
  }, [map, epoch, P, cats, data])

  useEffect(() => {
    if (!map) return
    const shown = new Set(visibleKey.split('|'))
    whenStyleReady(map, () => {
      cats.forEach((c, i) => {
        const visibility = shown.has(c.id) ? 'visible' : 'none'
        const width = c.width ?? 1
        const [o0, o1] = c.opacity ?? [0.5, 0.85]
        const w = ['get', 'w']
        const lineWidth = ['interpolate', ['exponential', 1.5], ['zoom'], 4, ['*', w, 0.3 * width], 8, ['*', w, 0.6 * width], 12, ['*', w, 1.3 * width], 16, ['*', w, 3.5 * width]]
        const glowWidth = ['interpolate', ['exponential', 1.5], ['zoom'], 4, ['*', w, 0.8 * width], 8, ['*', w, 2 * width], 12, ['*', w, 5 * width], 16, ['*', w, 12 * width]]
        setLayer(map, `${P}-line-${i}`, visibility, { 'line-width': lineWidth, 'line-opacity': ['interpolate', ['linear'], ['zoom'], 4, o0 * factor, 12, o1 * factor] })
        setLayer(map, `${P}-glow-${i}`, visibility, { 'line-width': glowWidth, 'line-opacity': ['interpolate', ['linear'], ['zoom'], 4, 0.08 * factor, 10, 0.2 * factor] })
        if (c.pointRadius) {
          const r = c.pointRadius
          setLayer(map, `${P}-pt-${i}`, visibility, {
            'circle-radius': ['interpolate', ['exponential', 1.5], ['zoom'], 4, 0.35 * r, 8, 0.55 * r, 12, r, 16, 2 * r],
            'circle-opacity': factor, 'circle-stroke-opacity': factor,
            'circle-stroke-width': ['interpolate', ['linear'], ['zoom'], 8, 0, 12, 1],
          })
        }
      })
    })
  }, [map, epoch, P, cats, visibleKey, factor])

  const keyOf = p.keyOf ?? ((i: number) => i)
  const live = useRef({ keyOf, onHover: p.onHover, visibleKey })
  live.current = { keyOf, onHover: p.onHover, visibleKey }

  useEffect(() => {
    if (!map) return
    const radius = p.pickRadius ?? 8
    const yieldTo = p.yieldTo ?? []
    const hit = (e: MapMouseEvent): number => {
      const shown = new Set(live.current.visibleKey.split('|'))
      const zoom = map.getZoom()
      const pickable = cats.map((c) => shown.has(c.id) && !!c.pointRadius && zoom >= (c.pointMinzoom ?? 0))
      if (!pickable.some(Boolean)) return -1
      const a = map.unproject([e.point.x - radius, e.point.y - radius])
      const b = map.unproject([e.point.x + radius, e.point.y + radius])
      return grid.nearest(e.lngLat.lng, e.lngLat.lat, Math.abs(b.lng - a.lng) / 2, Math.abs(b.lat - a.lat) / 2, (i) => {
        const c = p.network.nodeCategory[i]
        return c !== NO_CATEGORY && pickable[c]
      })
    }
    const yielded = (e: MapMouseEvent) => {
      const layers = yieldTo.filter((l) => map.getLayer(l))
      return layers.length > 0 && map.queryRenderedFeatures(e.point, { layers }).length > 0
    }
    const click = (e: MapMouseEvent) => {
      if (yielded(e)) return
      const i = hit(e)
      if (i >= 0) store.pick(live.current.keyOf(i), 'map')
    }
    let frame = 0
    let last: MapMouseEvent | null = null
    const move = (e: MapMouseEvent) => {
      last = e
      if (frame) return
      frame = requestAnimationFrame(() => {
        frame = 0
        if (!last) return
        const i = yielded(last) ? -1 : hit(last)
        map.getCanvas().style.cursor = i >= 0 ? 'pointer' : ''
        live.current.onHover?.(i >= 0 ? { index: i, key: live.current.keyOf(i), x: last.point.x, y: last.point.y } : null)
      })
    }
    const out = () => { last = null; live.current.onHover?.(null) }
    map.on('click', click)
    map.on('mousemove', move)
    map.on('mouseout', out)
    return () => {
      cancelAnimationFrame(frame)
      map.off('click', click)
      map.off('mousemove', move)
      map.off('mouseout', out)
    }
  }, [map, grid, cats, store, p.network, p.pickRadius, p.yieldTo])

  return null
}

function addSource(map: MLMap, id: string) {
  if (!map.getSource(id)) map.addSource(id, { type: 'geojson', data: { type: 'FeatureCollection', features: [] }, maxzoom: 14, buffer: 32, tolerance: 0.5 })
}

function addLayer(map: MLMap, layer: Parameters<MLMap['addLayer']>[0], before?: string) {
  if (!map.getLayer(layer.id)) map.addLayer(layer, before && map.getLayer(before) ? before : undefined)
}

function setLayer(map: MLMap, id: string, visibility: 'visible' | 'none', paint: Record<string, unknown>) {
  if (!map.getLayer(id)) return
  map.setLayoutProperty(id, 'visibility', visibility)
  for (const [k, v] of Object.entries(paint)) map.setPaintProperty(id, k, v)
}

/** The first basemap label drawn above every road, river and fill of the
 *  basemap. Layers on GeoJSON sources are the app's own, not the basemap's. */
function firstTopLabel(map: MLMap): string | undefined {
  const style = map.getStyle()
  const ofBasemap = (l: (typeof style.layers)[number]) => !('source' in l) || style.sources[l.source as string]?.type !== 'geojson'
  const layers = style.layers.filter(ofBasemap)
  let lastShape = -1
  layers.forEach((l, i) => { if (l.type !== 'symbol') lastShape = i })
  return layers.slice(lastShape + 1).find((l) => l.type === 'symbol')?.id
}
