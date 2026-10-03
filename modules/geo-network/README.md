# `@kit/geo-network` — a country-sized network on the map

`GeoSurface` builds one GeoJSON feature per node and per edge and rebuilds them on every overlay
change, which is right for a mesh of a few thousand nodes. A national network (every bus stop of a
country, every segment between them) needs the opposite: build the layer once, then toggle, dim and
pick without touching the data. `GeoNetwork` is that base layer. Mount `GeoSurface` after it, given
only the nodes the overlays mention, and every overlay is still drawn on top.

```tsx
const network: DenseNetwork = { lng, lat, nodeCategory, src, tgt, edgeCategory, weight }   // typed arrays
const CATEGORIES: NetworkCategory[] = [
  { id: 'local', label: 'Local', color: '#4FD1C5', width: 0.6, opacity: [0.18, 0.6], pointRadius: 2, pointMinzoom: 12 },
  { id: 'trunk', label: 'Trunk', color: '#679CFF', width: 1.4, glow: true, pointRadius: 3.5 },
]
<GeoMap basemap="openfreemap-dark">
  <GeoNetwork network={network} categories={CATEGORIES} visible={shown} keyOf={(i) => ids[i]} yieldTo={['kit-nodes']} onHover={setHover} />
  <GeoSurface nodes={overlayNodes} toKey={String} />
  <GeoPathFlow resolve={(k) => position(k)} />
</GeoMap>
```

**Rules it enforces:** nodes and segments are typed arrays indexed by position; a node whose
category is `NO_CATEGORY` is neither drawn nor picked. Segments become one `MultiLineString` per
category and weight bucket (1, 2, 3–4, 5–8, 9–16, 17+), so width follows weight without a feature
per segment. Toggling `visible` changes layout visibility and an overlay with `dimOthers` changes
opacity; neither re-sends data to MapLibre's worker. A click picks the nearest drawn point within
`pickRadius` px through `PointGrid` and publishes it with `store.pick(key, 'map')`, like `GeoSurface`.
`GeoPathFlow` animates comets along every overlay `paths` entry, coloured by the path's tone.

**Gotchas:** the network sits under the basemap's top labels (`underLabels`); a node is pickable only
at zooms where its category draws points (`pointMinzoom`). Keys passed to `keyOf` follow the demo's
convention: internal ids are fine for a single-commit graph, a stable property otherwise. Large
networks take MapLibre a few seconds to tile on first load and after a basemap switch.
