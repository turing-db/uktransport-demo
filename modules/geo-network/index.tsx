// @kit/geo-network — a country-sized network as one base layer of a <GeoMap>,
// plus comets that travel along overlay paths. Overlays stay with <GeoSurface>.
export { GeoNetwork } from './layer'
export type { GeoNetworkProps, NetworkHover } from './layer'
export { GeoPathFlow } from './flow'
export type { GeoPathFlowProps } from './flow'
export { PlaceLabels } from './labels'
export type { PlaceLabelsProps } from './labels'
export { NO_CATEGORY, WEIGHT_BUCKETS, PointGrid, SegmentGrid, bucketWidth, countByCategory, distanceToSegment, lineCollections, pointCollections, weightBucket } from './network'
export type { DenseNetwork, NetworkCategory } from './network'
export { alongPolyline, polylineLengths } from './polyline'
