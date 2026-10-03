import { useEffect, useState } from 'react'
import { overlays } from '@kit/overlay'
import type { TuringClient } from '@kit/tdb-client'
import { Button, Chip, CypherBlock, Dot, ErrorCard, KV, Loading, Row } from '@kit/ui'
import { modeColor, modeLabel } from './config'
import type { Endpoint } from './journey'
import { loadStop, routeOverlay, stopRoutesOverlay, type RouteRow, type StopInfo } from './routes'

const ROUTES_SHOWN = 40

const endpointOf = (info: StopInfo): Endpoint => ({ label: info.locality && !info.name.includes(info.locality) ? `${info.name}, ${info.locality}` : info.name, atco: info.atco })

export function StopCard(p: { db: TuringClient; id: number; autoRoutes: boolean; nameOf: (atco: string) => string; nameOfId: (id: number) => string; onClose: () => void; onLoaded: (e: Endpoint | null) => void; onPlan: (which: 'from' | 'to', e: Endpoint) => void }) {
  const [data, setData] = useState<Awaited<ReturnType<typeof loadStop>> | null>(null)
  const [err, setErr] = useState<unknown>(null)
  const [all, setAll] = useState(false)
  const [active, setActive] = useState<number | null>(null)

  useEffect(() => {
    let dead = false
    setData(null)
    setErr(null)
    setAll(false)
    setActive(null)
    loadStop(p.db, p.id).then((d) => {
      if (dead) return
      setData(d)
      p.onLoaded(endpointOf(d.info))
      if (p.autoRoutes && d.routes.length) stopRoutesOverlay(p.db, d.info).then((r) => !dead && overlays.show(r.overlay), (e) => !dead && setErr(e))
    }, (e) => !dead && setErr(e))
    return () => { dead = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.db, p.id])

  const showRoute = (r: RouteRow) => {
    setActive(r.id)
    routeOverlay(p.db, r, p.nameOfId).then((x) => overlays.show(x.overlay), setErr)
  }
  const showAll = () => {
    if (!data) return
    setActive(null)
    stopRoutesOverlay(p.db, data.info).then((x) => overlays.show(x.overlay), setErr)
  }

  const terminus = (code: string | null) => (code ? data?.termini.get(code) ?? p.nameOf(code) : '?')
  const modes = data ? [...new Set(data.routes.map((r) => r.mode))] : []
  const shown = data ? (all ? data.routes : data.routes.slice(0, ROUTES_SHOWN)) : []
  const endpoint = data ? endpointOf(data.info) : null
  return (
    <div className="tk tk-infocard ukt-card">
      <button type="button" className="tk-x" aria-label="Close" onClick={p.onClose}>×</button>
      {!data && !err && <Loading>Reading stop {p.id}…</Loading>}
      {!!err && <ErrorCard error={err} />}
      {data && (
        <>
          <h4>{data.info.name}{data.info.indicator ? <span className="tk-note"> · {data.info.indicator}</span> : null}</h4>
          <div className="tk-note" style={{ marginTop: -4 }}>{data.info.locality ?? ''}</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, margin: '8px 0' }}>
            {modes.map((m) => <Chip key={m} color={modeColor(m)}>{modeLabel(m)}</Chip>)}
            {data.info.station && <Chip>{data.info.station.crs}</Chip>}
          </div>
          <KV rows={[
            ['ATCO code', <span className="tk-mono">{data.info.atco}</span>],
            ['Stop type', data.info.stopType],
            ['Routes calling', data.routes.length.toLocaleString()],
            ['Walks & changes', data.info.transfers.toLocaleString()],
            ...(data.info.station ? [['Station', `${data.info.station.name}${data.info.station.changeMinutes != null ? ` · ${data.info.station.changeMinutes} min to change` : ''}`] as [string, string]] : []),
          ]} />
          <div style={{ display: 'flex', gap: 6, margin: '10px 0 4px' }}>
            <Button onClick={() => endpoint && p.onPlan('from', endpoint)}>Journey from here</Button>
            <Button onClick={() => endpoint && p.onPlan('to', endpoint)}>to here</Button>
          </div>
          {data.routes.length > 0 && (
            <>
              <div className="tk-section-title" style={{ marginTop: 10, display: 'flex' }}>
                Routes <span className="tk-count">{data.routes.length}</span>
                <button type="button" className="tk-btn" data-variant="ghost" style={{ marginLeft: 'auto' }} onClick={showAll}>show all</button>
              </div>
              <div className="ukt-routes">
                {shown.map((r) => (
                  <Row key={r.id} active={active === r.id} onClick={() => showRoute(r)}
                    lead={<Dot color={modeColor(r.mode)} />}
                    title={<>{r.line ? <b>{r.line} </b> : null}{terminus(r.origin)} → {terminus(r.destination)}</>}
                    sub={[r.operator, r.stops != null ? `${r.stops} stops` : null, r.services != null ? `${r.services} trips` : null].filter(Boolean).join(' · ')} />
                ))}
                {!all && data.routes.length > ROUTES_SHOWN && <button type="button" className="tk-btn" data-variant="ghost" onClick={() => setAll(true)}>… {data.routes.length - ROUTES_SHOWN} more</button>}
              </div>
            </>
          )}
          <details style={{ marginTop: 8 }}><summary className="tk-note" style={{ cursor: 'pointer' }}>queries</summary>{data.queries.map((q) => <CypherBlock key={q} cypher={q} />)}</details>
        </>
      )}
    </div>
  )
}
