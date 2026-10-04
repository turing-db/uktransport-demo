import { useCallback, useMemo, useState } from 'react'
import { seekNodes } from '@kit/cypher'
import { NO_CATEGORY } from '@kit/geo-network'
import { overlays, type Overlay, type OverlayEdge } from '@kit/overlay'
import type { TuringClient } from '@kit/tdb-client'
import { Button, Chip, CypherBlock, ErrorCard, Field, Honesty, Note, Section } from '@kit/ui'
import { MODES, modeColor, modeLabel, SAMPLE_JOURNEYS } from './config'
import { searchStops, type Names, type Station, type Transport } from './data'
import { formatMinutes, planJourney, type Endpoint, type Journey, type Leg, type LegStop } from './journey'

/** A choice offered while typing an endpoint: a National Rail station, or any
 *  stop a route calls at (Underground, tram, bus...), whose ATCO code is only
 *  fetched once chosen. */
interface Suggestion { key: string; name: string; sub: string; color: string; endpoint: () => Promise<Endpoint> }

const SUGGESTIONS = 8
const RAIL_SUGGESTIONS = 3

export function JourneyPanel(p: { db: TuringClient; stations: Station[]; names: Names | null; transport: Transport | null; picked: Endpoint | null; from: Endpoint | null; to: Endpoint | null; onFrom: (e: Endpoint | null) => void; onTo: (e: Endpoint | null) => void }) {
  const [journey, setJourney] = useState<Journey | null>(null)
  const [err, setErr] = useState<unknown>(null)
  const [busy, setBusy] = useState(false)
  const byName = useMemo(() => new Map(p.stations.map((s) => [s.name.toLowerCase(), s])), [p.stations])
  const station = (name: string): Endpoint | null => {
    const s = byName.get(name.trim().toLowerCase())
    return s ? { label: s.name, atco: s.atco } : null
  }
  const suggest = useCallback((text: string): Suggestion[] => {
    const words = text.toLowerCase().split(/\s+/).filter(Boolean)
    if (text.trim().length < 2) return []
    const first = words[0]
    const rail = p.stations
      .filter((s) => words.every((w) => s.name.toLowerCase().includes(w)))
      .sort((x, y) => Number(y.name.toLowerCase().startsWith(first)) - Number(x.name.toLowerCase().startsWith(first)) || x.name.length - y.name.length)
      .slice(0, RAIL_SUGGESTIONS)
    const out: Suggestion[] = rail.map((s) => ({
      key: `crs-${s.crs}`, name: s.name, sub: `National Rail · ${s.crs}`, color: modeColor('rail'),
      endpoint: async () => ({ label: s.name, atco: s.atco }),
    }))
    const { names, transport } = p
    if (!names || !transport) return out
    const taken = new Set(rail.map((s) => s.id))
    // The platforms of a station share its name, locality and mode: offer one,
    // the router walks the TRANSFER links to the others.
    const seen = new Set<string>()
    for (const i of searchStops(names, transport, text, 10 * SUGGESTIONS, true)) {
      const id = transport.ids[i]
      if (taken.has(id) || out.length >= SUGGESTIONS) continue
      const name = names.name[i] || 'Unnamed stop', locality = names.locality[i], indicator = names.indicator[i]
      const c = transport.network.nodeCategory[i]
      const place = `${name}|${indicator}|${locality}|${c}`
      if (seen.has(place)) continue
      seen.add(place)
      out.push({
        key: `stop-${id}`, name: indicator ? `${name} · ${indicator}` : name, sub: locality,
        color: c === NO_CATEGORY ? 'var(--tk-text-faint)' : MODES[c].color,
        endpoint: async () => {
          const r = await p.db.query(`MATCH (s:Stop) WHERE ${seekNodes('s', [id])} RETURN s.atco_code`)
          return { label: locality && !name.includes(locality) ? `${name}, ${locality}` : name, atco: String(r.column<string>(0)[0]) }
        },
      })
    }
    return out
  }, [p.db, p.stations, p.names, p.transport])

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
        <EndpointField label="From" value={p.from} picked={p.picked} onChange={p.onFrom} suggest={suggest} />
        <EndpointField label="To" value={p.to} picked={p.picked} onChange={p.onTo} suggest={suggest} />
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

function EndpointField(p: { label: string; value: Endpoint | null; picked: Endpoint | null; onChange: (e: Endpoint | null) => void; suggest: (text: string) => Suggestion[] }) {
  const [text, setText] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const shown = text ?? p.value?.label ?? ''
  const hits = useMemo(() => (text === null ? [] : p.suggest(text)), [text, p.suggest])
  const choose = async (hit: Suggestion) => {
    setText(null)
    setErr(null)
    try {
      p.onChange(await hit.endpoint())
    } catch (e) {
      setErr(`Could not look up ${hit.name}: ${e instanceof Error ? e.message : String(e)}`)
    }
  }
  return (
    <Field label={p.label}>
      <div style={{ display: 'flex', gap: 6 }}>
        <div style={{ position: 'relative', flex: 1, minWidth: 0 }}>
          <input className="tk-input" placeholder="a station or stop, or pick one on the map" value={shown} style={{ width: '100%' }}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && hits.length) choose(hits[0])
              if (e.key === 'Escape') setText(null)
            }}
            onBlur={() => setText(null)} />
          {hits.length > 0 && (
            // mousedown would blur the input, closing the list before the click lands
            <div className="ukt-hits" onMouseDown={(e) => e.preventDefault()}>
              {hits.map((h) => (
                <button key={h.key} type="button" onClick={() => choose(h)}>
                  <i style={{ background: h.color }} />
                  <span>{h.name}</span>
                  {h.sub && <small>{h.sub}</small>}
                </button>
              ))}
            </div>
          )}
        </div>
        <Button variant="ghost" disabled={!p.picked} title={p.picked ? `Use ${p.picked.label}` : 'Pick a stop on the map first'} onClick={() => { p.onChange(p.picked); setText(null) }}>◎</Button>
      </div>
      {err && <div className="tk-note">{err}</div>}
    </Field>
  )
}
