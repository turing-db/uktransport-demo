import { useMemo, useState } from 'react'
import { overlays, type Overlay, type OverlayEdge } from '@kit/overlay'
import type { TuringClient } from '@kit/tdb-client'
import { Button, Chip, CypherBlock, ErrorCard, Field, Honesty, Note, Section } from '@kit/ui'
import { modeColor, modeLabel, SAMPLE_JOURNEYS } from './config'
import type { Station } from './data'
import { formatMinutes, planJourney, type Endpoint, type Journey, type Leg, type LegStop } from './journey'

const STATION_LIST = 'ukt-stations'

export function JourneyPanel(p: { db: TuringClient; stations: Station[]; picked: Endpoint | null; from: Endpoint | null; to: Endpoint | null; onFrom: (e: Endpoint | null) => void; onTo: (e: Endpoint | null) => void }) {
  const [journey, setJourney] = useState<Journey | null>(null)
  const [err, setErr] = useState<unknown>(null)
  const [busy, setBusy] = useState(false)
  const byName = useMemo(() => new Map(p.stations.map((s) => [s.name.toLowerCase(), s])), [p.stations])
  const station = (name: string): Endpoint | null => {
    const s = byName.get(name.trim().toLowerCase())
    return s ? { label: s.name, atco: s.atco } : null
  }

  const go = async (from = p.from, to = p.to) => {
    if (!from || !to) return
    setBusy(true)
    setErr(null)
    try {
      const j = await planJourney(p.db, from, to)
      setJourney(j)
      if (!j.path.found) {
        overlays.clear()
        return
      }
      const [lines, flow] = journeyOverlays(j, `${from.label} → ${to.label} · ${formatMinutes(j.minutes)}`)
      overlays.show(lines)
      overlays.set(flow)
    } catch (e) {
      setErr(e)
      setJourney(null)
      overlays.clear()
    } finally {
      setBusy(false)
    }
  }

  const sample = (a: string, b: string) => {
    const from = station(a), to = station(b)
    p.onFrom(from)
    p.onTo(to)
    go(from, to)
  }

  const rides = journey?.legs.filter((l) => l.kind === 'ride').length ?? 0
  return (
    <>
      <Section title="Plan a journey">
        <datalist id={STATION_LIST}>{p.stations.map((s) => <option key={s.crs} value={s.name} />)}</datalist>
        <EndpointField label="From" value={p.from} picked={p.picked} onChange={p.onFrom} resolve={station} />
        <EndpointField label="To" value={p.to} picked={p.picked} onChange={p.onTo} resolve={station} />
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 4 }}>
          <Button variant="primary" onClick={() => go()} disabled={busy || !p.from || !p.to || p.from.atco === p.to.atco}>{busy ? 'Routing…' : 'Find the fastest route'}</Button>
          <Button variant="ghost" title="Swap" onClick={() => { p.onFrom(p.to); p.onTo(p.from) }}>⇅</Button>
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 10 }}>
          {SAMPLE_JOURNEYS.map(([a, b]) => <Chip key={a + b} onClick={() => sample(a, b)}>{a} → {b}</Chip>)}
        </div>
      </Section>
      {!!err && <ErrorCard error={err} />}
      {journey && !journey.path.found && <div className="tk-error"><b>NO ROUTE</b> {journey.path.diagnosis}</div>}
      {journey?.path.found && (
        <Section title="Fastest route" right={<Honesty kind="measured" />}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
            <span className="tk-stat-value" style={{ fontSize: 26 }}>{formatMinutes(journey.minutes)}</span>
            <span className="tk-note">{rides} service{rides === 1 ? '' : 's'} · {Math.max(0, rides - 1)} change{rides === 2 ? '' : 's'} · shortestPath {journey.path.ms} ms</span>
          </div>
          <div className="ukt-legs">
            {journey.legs.map((l, i) => <LegView key={i} leg={l} />)}
          </div>
          <Note>shortestPath finds the fastest chain of hops ({formatMinutes(journey.path.cost ?? 0)}); each leg then rides one route along it, chosen to need as few changes as possible, with that route's timetable. Waiting for a service is not counted.</Note>
          <details style={{ marginTop: 6 }}><summary className="tk-note" style={{ cursor: 'pointer' }}>query</summary><CypherBlock cypher={journey.path.query} /></details>
        </Section>
      )}
    </>
  )
}

function LegView(p: { leg: Leg }) {
  const { leg } = p
  const stops = leg.stops
  const middle = stops.slice(1, -1)
  const [open, setOpen] = useState(middle.length <= 3)
  const color = leg.kind === 'walk' ? 'var(--tk-text-faint)' : modeColor(leg.mode)
  const service = leg.service
  const title = leg.kind === 'walk' ? (leg.mode === 'walk' ? 'Walk' : `Change (${modeLabel(leg.mode)})`) : modeLabel(leg.mode)
  const stop = (s: LegStop, role: 'end' | 'middle') => (
    <button key={`${s.id}-${s.at}`} type="button" className="ukt-stop" data-role={role} onClick={() => overlays.pick(s.id, 'path')}>
      <i style={{ borderColor: color }} />
      <span>{s.name}{s.indicator ? <small> · {s.indicator}</small> : null}</span>
      <span className="tk-num">{formatOffset(s.at)}</span>
    </button>
  )
  return (
    <div className="ukt-leg" style={{ borderColor: color }} data-walk={leg.kind === 'walk'}>
      <div className="ukt-leg-head">
        <span style={{ color: leg.kind === 'walk' ? 'var(--tk-text-dim)' : color }}>{title}</span>
        {service?.line && <span className="tk-chip">{service.line}</span>}
        <span className="tk-note" style={{ marginLeft: 'auto' }}>{formatMinutes(leg.minutes)}</span>
      </div>
      {leg.kind === 'ride' && service && (
        <div className="tk-note ukt-leg-service">
          {[service.operator, service.towards ? `towards ${service.towards}` : null].filter(Boolean).join(' · ')}
          {leg.alternatives > 0 ? ` · or ${leg.alternatives} other route${leg.alternatives === 1 ? '' : 's'}` : ''}
        </div>
      )}
      {leg.kind === 'walk' && leg.metres != null && <div className="tk-note ukt-leg-service">{leg.metres.toLocaleString()} m</div>}
      <div className="ukt-stops">
        {stop(stops[0], 'end')}
        {middle.length > 0 && !open && (
          <button type="button" className="ukt-stop ukt-more" onClick={() => setOpen(true)}><i style={{ borderColor: color }} /><span>{middle.length} stop{middle.length === 1 ? '' : 's'}</span><span /></button>
        )}
        {open && middle.map((s) => stop(s, 'middle'))}
        {stop(stops[stops.length - 1], 'end')}
      </div>
    </div>
  )
}

/** The journey as two overlays: each leg along its own stops in its mode's colour, and the legs as paths for GeoPathFlow. */
function journeyOverlays(j: Journey, title: string): [Overlay, Overlay] {
  const edges: OverlayEdge[] = []
  for (const leg of j.legs) {
    const tone = leg.kind === 'walk' ? 'muted' : (modeColor(leg.mode) as `#${string}`)
    for (let i = 0; i + 1 < leg.stops.length; i++) edges.push({ src: leg.stops[i].id, tgt: leg.stops[i + 1].id, tone, width: leg.kind === 'walk' ? 0.2 : 0.34 })
  }
  const ends = new Map(j.legs.flatMap((l) => [l.stops[0], l.stops[l.stops.length - 1]]).map((s) => [s.id, s.name]))
  return [
    { id: 'journey', title, edges, nodes: [...ends].map(([id, name]) => ({ id, tone: 'focus' as const, label: name })), labels: [...ends.keys()], dimOthers: true, honesty: 'measured', z: 1 },
    { id: 'journey-flow', paths: j.legs.filter((l) => l.kind === 'ride').map((l) => ({ nodes: l.stops.map((s) => s.id), tone: modeColor(l.mode) as `#${string}` })), honesty: 'measured', z: 0 },
  ]
}

function formatOffset(m: number): string {
  const total = Math.round(m)
  return total < 60 ? `+${total} min` : `+${Math.floor(total / 60)} h ${String(total % 60).padStart(2, '0')}`
}

function EndpointField(p: { label: string; value: Endpoint | null; picked: Endpoint | null; onChange: (e: Endpoint | null) => void; resolve: (name: string) => Endpoint | null }) {
  const [text, setText] = useState<string | null>(null)
  const shown = text ?? p.value?.label ?? ''
  return (
    <Field label={p.label}>
      <div style={{ display: 'flex', gap: 6 }}>
        <input className="tk-input" list={STATION_LIST} placeholder="a National Rail station, or pick a stop on the map" value={shown}
          onChange={(e) => {
            setText(e.target.value)
            const hit = p.resolve(e.target.value)
            if (hit) { p.onChange(hit); setText(null) }
          }}
          onBlur={() => setText(null)} style={{ flex: 1, minWidth: 0 }} />
        <Button variant="ghost" disabled={!p.picked} title={p.picked ? `Use ${p.picked.label}` : 'Pick a stop on the map first'} onClick={() => { p.onChange(p.picked); setText(null) }}>◎</Button>
      </div>
    </Field>
  )
}
