import { useMemo, useState } from 'react'
import { overlays } from '@kit/overlay'
import { pathOverlay } from '@kit/paths'
import type { TuringClient } from '@kit/tdb-client'
import { Button, Chip, CypherBlock, ErrorCard, Field, Honesty, Note, Section } from '@kit/ui'
import { modeColor, modeLabel, SAMPLE_JOURNEYS } from './config'
import type { Station } from './data'
import { formatMinutes, planJourney, type Endpoint, type Journey } from './journey'

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
        overlays.clear('path')
        return
      }
      const overlay = pathOverlay(j.path, { keyBy: 'id', title: `${from.label} → ${to.label} · ${formatMinutes(j.path.cost ?? 0)}` })
      const changes = j.legs.slice(1).map((l) => j.path.nodeIds[l.from])
      overlays.show({ ...overlay, labels: [...(overlay.labels ?? []), ...changes] })
    } catch (e) {
      setErr(e)
      setJourney(null)
      overlays.clear('path')
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

  const nameAt = (i: number) => String(journey?.path.nodes[i]?.props.name ?? '?')
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
            <span className="tk-stat-value" style={{ fontSize: 26 }}>{formatMinutes(journey.path.cost ?? 0)}</span>
            <span className="tk-note">{journey.legs.length} leg{journey.legs.length === 1 ? '' : 's'} · {journey.path.nodeIds.length - 1} hops · {journey.path.ms} ms</span>
          </div>
          <div className="ukt-legs">
            {journey.legs.map((l, i) => (
              <div key={i} className="ukt-leg" style={{ borderColor: l.kind === 'walk' ? 'var(--tk-text-faint)' : modeColor(l.mode) }} data-walk={l.kind === 'walk'}>
                <div className="ukt-leg-head">
                  <span style={{ color: l.kind === 'walk' ? 'var(--tk-text-dim)' : modeColor(l.mode) }}>{l.kind === 'walk' ? (l.mode === 'walk' ? 'Walk' : `Change (${modeLabel(l.mode)})`) : modeLabel(l.mode)}</span>
                  {l.lines.slice(0, 3).map((x) => <span key={x} className="tk-chip">{x}</span>)}
                  <span className="tk-note" style={{ marginLeft: 'auto' }}>{formatMinutes(l.minutes)}</span>
                </div>
                <div className="ukt-leg-body">
                  <b>{nameAt(l.from)}</b> → <b>{nameAt(l.to)}</b>
                  <div className="tk-note">
                    {l.kind === 'ride' ? [`${l.to - l.from} stop${l.to - l.from === 1 ? '' : 's'}`, ...l.operators.slice(0, 3), l.operators.length > 3 ? `+${l.operators.length - 3} more` : null].filter(Boolean).join(' · ') : l.metres != null ? `${l.metres.toLocaleString()} m` : ''}
                  </div>
                </div>
              </div>
            ))}
          </div>
          <Note>The sum of the fastest timetabled hop between each pair of stops, plus walks. Waiting for the next service is not counted, and consecutive hops can belong to different services of the same mode.</Note>
          <details style={{ marginTop: 6 }}><summary className="tk-note" style={{ cursor: 'pointer' }}>query</summary><CypherBlock cypher={journey.path.query} /></details>
        </Section>
      )}
    </>
  )
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
