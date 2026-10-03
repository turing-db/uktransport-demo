// <GeoPathFlow>: comets that travel along every overlay path on a <GeoMap>, so
// a route reads as a direction of travel, not only a highlighted line. It
// draws only what the overlay store holds; with no path it costs nothing.

import type { GeoJSONSource } from 'maplibre-gl'
import type { FeatureCollection } from 'geojson'
import { useEffect, useMemo } from 'react'
import { useGeoMap, whenStyleReady, type LngLat } from '@kit/geo-map'
import { overlays as defaultStore, type NodeKey, type OverlayStore } from '@kit/overlay'
import { toneColor, useTheme } from '@kit/theme'
import { useOverlays } from '@kit/ui'
import { alongPolyline, polylineLengths } from './polyline'

export interface GeoPathFlowProps {
  /** Where a path node is: the same keys the overlays use. */
  resolve: (key: NodeKey) => LngLat | undefined
  store?: OverlayStore
  id?: string
  /** Seconds a comet takes from one end of a path to the other (default 7). */
  seconds?: number
  /** Comets per path (default 4). */
  comets?: number
}

export function GeoPathFlow(p: GeoPathFlowProps) {
  const { map, epoch } = useGeoMap()
  const theme = useTheme()
  const list = useOverlays(p.store ?? defaultStore)
  const P = p.id ?? 'flow'
  const resolve = p.resolve

  const paths = useMemo(() => list.flatMap((o) => (o.paths ?? []).map((path) => {
    const coords = path.nodes.map(resolve).filter((c): c is LngLat => !!c)
    return { coords, lengths: polylineLengths(coords), color: toneColor(path.tone ?? 'path', theme) }
  })).filter((x) => x.coords.length > 1), [list, resolve, theme])

  useEffect(() => {
    if (!map) return
    whenStyleReady(map, () => {
      if (!map.getSource(P)) map.addSource(P, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
      if (!map.getLayer(`${P}-halo`)) map.addLayer({ id: `${P}-halo`, type: 'circle', source: P, paint: { 'circle-color': ['get', 'color'], 'circle-radius': ['*', ['get', 's'], 14], 'circle-blur': 1, 'circle-opacity': ['*', ['get', 's'], 0.55] } })
      if (!map.getLayer(`${P}-core`)) map.addLayer({ id: `${P}-core`, type: 'circle', source: P, paint: { 'circle-color': '#ffffff', 'circle-radius': ['*', ['get', 's'], 3.2], 'circle-stroke-color': ['get', 'color'], 'circle-stroke-width': 1.5 } })
    })
  }, [map, epoch, P])

  useEffect(() => {
    if (!map) return
    const source = () => map.getSource(P) as GeoJSONSource | undefined
    if (!paths.length) {
      whenStyleReady(map, () => source()?.setData({ type: 'FeatureCollection', features: [] }))
      return
    }
    const seconds = p.seconds ?? 7
    const comets = p.comets ?? 4
    const tail = 5
    let frame = 0
    const t0 = performance.now()
    const tick = (now: number) => {
      const t = (now - t0) / 1000 / seconds
      const data: FeatureCollection = { type: 'FeatureCollection', features: [] }
      for (const path of paths) {
        for (let c = 0; c < comets; c++) {
          for (let k = 0; k < tail; k++) {
            const f = (((t + c / comets - k * 0.006) % 1) + 1) % 1
            data.features.push({ type: 'Feature', properties: { color: path.color, s: 1 - k / tail }, geometry: { type: 'Point', coordinates: alongPolyline(path.coords, path.lengths, f) } })
          }
        }
      }
      source()?.setData(data)
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [map, epoch, P, paths, p.seconds, p.comets])

  return null
}
