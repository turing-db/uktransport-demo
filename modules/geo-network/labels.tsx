// <PlaceLabels>: the basemap's place names, restyled to stay readable over a
// dense network. Dark vector basemaps paint them in a mid grey with a thin
// halo, which disappears against bright lines. This lifts them above every
// layer and gives them theme colours, a size hierarchy and a solid halo.

import { useEffect } from 'react'
import { useGeoMap, whenStyleReady } from '@kit/geo-map'
import { alpha, useTheme } from '@kit/theme'

export interface PlaceLabelsProps {
  /** Source layer holding place points (OpenMapTiles: 'place'). */
  sourceLayer?: string
  /** Text size multiplier (default 1). */
  scale?: number
}

export function PlaceLabels(p: PlaceLabelsProps) {
  const { map, epoch } = useGeoMap()
  const theme = useTheme()
  const sourceLayer = p.sourceLayer ?? 'place'
  const scale = p.scale ?? 1

  useEffect(() => {
    if (!map) return
    whenStyleReady(map, () => {
      const layers = map.getStyle().layers.filter((l) => l.type === 'symbol' && 'source-layer' in l && l['source-layer'] === sourceLayer)
      const placeClass = ['get', 'class']
      const sizes = (bigCity: number, city: number, town: number, region: number, other: number) => ['*', scale, ['match', placeClass,
        'city', ['case', ['<=', ['coalesce', ['get', 'rank'], 10], 3], bigCity, city],
        'town', town,
        ['country', 'state'], region,
        other]]
      const textSize = ['interpolate', ['linear'], ['zoom'], 4, sizes(13, 11, 10, 10, 9), 10, sizes(22, 17, 14, 13, 12)]
      for (const l of layers) {
        map.moveLayer(l.id)
        map.setPaintProperty(l.id, 'text-color', ['match', placeClass,
          'city', theme.textStrong,
          'town', theme.text,
          ['country', 'state'], theme.textMute,
          theme.textDim])
        map.setPaintProperty(l.id, 'text-halo-color', alpha(theme.bg, 0.92))
        map.setPaintProperty(l.id, 'text-halo-width', 1.8)
        map.setPaintProperty(l.id, 'text-halo-blur', 0.4)
        map.setLayoutProperty(l.id, 'text-size', textSize)
        map.setLayoutProperty(l.id, 'text-font', ['match', placeClass, ['city', 'town'], ['literal', ['Noto Sans Bold']], ['literal', ['Noto Sans Regular']]])
        map.setLayoutProperty(l.id, 'text-letter-spacing', ['match', placeClass, ['country', 'state'], 0.2, 0.02])
        map.setLayoutProperty(l.id, 'text-transform', ['match', placeClass, ['country', 'state'], 'uppercase', 'none'])
      }
    })
  }, [map, epoch, theme, sourceLayer, scale])

  return null
}
