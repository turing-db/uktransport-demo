import { useEffect, useState } from 'react'
import { overlays } from '@kit/overlay'
import type { TuringClient } from '@kit/tdb-client'
import { Chip, CypherBlock, Dot, ErrorCard, KV, Loading, Row } from '@kit/ui'
import { modeColor, modeLabel } from './config'
import { formatMinutes } from './journey'
import { loadSegment, serviceOverlay, type SegmentInfo } from './routes'

export interface SegmentPick { from: number; to: number; mode: string; km: number }

export function SegmentCard(p: { db: TuringClient; segment: SegmentPick; nameOfId: (id: number) => string; onClose: () => void }) {
  const [data, setData] = useState<SegmentInfo | null>(null)
  const [err, setErr] = useState<unknown>(null)
  const [active, setActive] = useState<number | null>(null)
  const { from, to } = p.segment

  useEffect(() => {
    let dead = false
    setData(null)
    setErr(null)
    setActive(null)
    const ends = [String(from), String(to)]
    overlays.show({ id: 'segment', edges: [{ src: ends[0], tgt: ends[1], tone: 'path', width: 0.5 }], nodes: ends.map((id) => ({ id, tone: 'focus' as const })), labels: ends, focus: [], dimOthers: true, honesty: 'measured' })
    loadSegment(p.db, from, to).then((d) => !dead && setData(d), (e) => !dead && setErr(e))
    return () => { dead = true }
  }, [p.db, from, to])

  const showRoute = (routeId: number) => {
    const route = data?.routes.find((r) => r.routeId === routeId)
    if (!route?.service) return
    setActive(routeId)
    serviceOverlay(p.db, route.service, p.nameOfId).then((x) => overlays.show(x.overlay), setErr)
  }

  const minutes = data ? data.routes.map((r) => r.minutes).filter((m): m is number => m !== null) : []
  const trips = data ? data.routes.reduce((n, r) => n + (r.service?.services ?? 0), 0) : 0
  const modes = data ? [...new Set(data.routes.map((r) => r.service?.mode ?? p.segment.mode))] : [p.segment.mode]
  return (
    <div className="tk tk-infocard ukt-card">
      <button type="button" className="tk-x" aria-label="Close" onClick={p.onClose}>×</button>
      {!!err && <ErrorCard error={err} />}
      <h4>{data ? data.from.name : p.nameOfId(from)} → {data ? data.to.name : p.nameOfId(to)}</h4>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, margin: '8px 0' }}>
        {modes.map((m) => <Chip key={m} color={modeColor(m)}>{modeLabel(m)}</Chip>)}
        <Chip>segment</Chip>
      </div>
      {!data && !err && <Loading>Reading the routes on this segment…</Loading>}
      {data && (
        <>
          <KV rows={[
            ['Routes', data.routes.length.toLocaleString()],
            ['Fastest hop', minutes.length ? formatMinutes(Math.min(...minutes)) : '—'],
            ['Slowest hop', minutes.length ? formatMinutes(Math.max(...minutes)) : '—'],
            ['Trips in the timetable', trips.toLocaleString()],
            ['Straight-line distance', `${p.segment.km.toFixed(p.segment.km < 10 ? 2 : 1)} km`],
          ]} />
          <div className="tk-section-title" style={{ marginTop: 10 }}>Routes <span className="tk-count">{data.routes.length}</span></div>
          <div className="ukt-routes">
            {data.routes.map((r) => (
              <Row key={r.routeId} active={active === r.routeId} onClick={() => showRoute(r.routeId)}
                lead={<Dot color={modeColor(r.service?.mode ?? p.segment.mode)} />}
                title={<>{r.service?.line ? <b>{r.service.line} </b> : null}{r.service?.towards ? `towards ${r.service.towards}` : `route ${r.routeId}`}</>}
                sub={[r.service?.operator, r.minutes !== null ? formatMinutes(r.minutes) : null, r.service?.services != null ? `${r.service.services} trips` : null].filter(Boolean).join(' · ')} />
            ))}
          </div>
          <details style={{ marginTop: 8 }}><summary className="tk-note" style={{ cursor: 'pointer' }}>query</summary><CypherBlock cypher={data.query} /></details>
        </>
      )}
    </div>
  )
}
