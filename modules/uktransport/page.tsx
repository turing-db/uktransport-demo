// The UK public transport network on a map: every stop and every stop-to-stop
// segment read live from TuringDB, coloured by mode, with journeys, operators,
// prewritten queries and the assistant publishing overlays over it.

import type { Map as MLMap } from 'maplibre-gl'
import { useCallback, useEffect, useMemo, useRef, useState, type MutableRefObject } from 'react'
import { kitClientBase } from '@kit-host'
import { AssistantPanel, captureSchema, useAssistantSettings, useGraphAgent, type GraphSchema } from '@kit/assistant'
import type { Capabilities } from '@kit/cypher'
import { BASEMAPS, GeoMap, GeoSurface, type GeoNode, type LngLat } from '@kit/geo-map'
import { GeoNetwork, GeoPathFlow, NO_CATEGORY, type NetworkHover } from '@kit/geo-network'
import { compose, keysOf, overlays, type NodeKey } from '@kit/overlay'
import { PresetPanel } from '@kit/preset-panel'
import { createClient } from '@kit/tdb-client'
import { ThemeScope } from '@kit/theme'
import { CypherBlock, ErrorCard, Panel, Section, Segmented, Stat, StatGrid, TabPanels, Tabs, Toggle, useOverlays, usePicked } from '@kit/ui'
import { CONFIG, MODES } from './config'
import { loadCounts, loadNames, loadStations, loadTransport, searchStops, SEGMENTS_QUERY, STOPS_QUERY, type Counts, type LoadStep, type Names, type Station, type Transport } from './data'
import { JourneyPanel } from './journey-panel'
import type { Endpoint } from './journey'
import { OperatorsPanel } from './operators-panel'
import { PRESETS } from './presets'
import { StopCard } from './stop-card'
import { UKT_CSS } from './styles'

const TABS = [
  { id: 'network', label: 'Network' },
  { id: 'journey', label: 'Journey' },
  { id: 'explore', label: 'Explore' },
  { id: 'operators', label: 'Operators' },
  { id: 'ask', label: 'Ask' },
]

export function TransportPage() {
  return (
    <ThemeScope theme="turing">
      <style>{UKT_CSS}</style>
      <TransportMap />
    </ThemeScope>
  )
}

function TransportMap() {
  const db = useMemo(() => createClient({ base: kitClientBase, graph: CONFIG.graph, timeoutMs: 120_000 }), [])
  const [steps, setSteps] = useState<LoadStep[]>([])
  const [t, setT] = useState<Transport | null>(null)
  const [names, setNames] = useState<Names | null>(null)
  const [stations, setStations] = useState<Station[]>([])
  const [counts, setCounts] = useState<Counts | null>(null)
  const [caps, setCaps] = useState<Capabilities | null>(null)
  const [err, setErr] = useState<unknown>(null)
  const [map, setMap] = useState<MLMap | null>(null)
  const [tab, setTab] = useState('network')
  const [visible, setVisible] = useState<string[]>(MODES.map((m) => m.id))
  const [basemap, setBasemap] = useState('openfreemap-dark')
  const [globe, setGlobe] = useState(true)
  const hover = useRef<(h: NetworkHover | null) => void>(() => {})
  const [pickedStop, setPickedStop] = useState<Endpoint | null>(null)
  const [from, setFrom] = useState<Endpoint | null>(null)
  const [to, setTo] = useState<Endpoint | null>(null)
  const [schema, setSchema] = useState<GraphSchema | null>(null)
  const picked = usePicked()
  const list = useOverlays()

  useEffect(() => {
    let dead = false
    overlays.clear()
    db.ensureLoaded()
      .then(() => Promise.all([loadTransport(db, (s) => !dead && setSteps(s)), loadCounts(db), loadStations(db), db.capabilities()]))
      .then(([transport, c, s, k]) => {
        if (dead) return
        setT(transport)
        setCounts(c)
        setStations(s)
        setCaps(k)
        loadNames(db, transport).then((n) => !dead && setNames(n), (e) => !dead && setErr(e))
        captureSchema(db, { notes: CONFIG.assistantNotes }).then((x) => !dead && setSchema(x), () => !dead && setSchema(null))
      }, (e) => !dead && setErr(e))
    return () => { dead = true }
  }, [db])

  useEffect(() => {
    if (!map || !t) return
    map.flyTo({ center: CONFIG.home.center, zoom: CONFIG.home.zoom, duration: 5200, curve: 1.6, offset: [CONFIG.panelWidth / 2, 0], essential: true })
  }, [map, t])

  const settings = useAssistantSettings()
  const agent = useGraphAgent({
    transport: settings.transport, model: settings.model, db, version: '3.0',
    schema: schema ?? { graph: CONFIG.graph, commit: null, labels: [], edgeTypes: [], properties: [] },
    context: () => `Selected stop: ${pickedStop ? `${pickedStop.label} (atco_code ${pickedStop.atco})` : 'none'}.`,
  })

  const position = useCallback((key: NodeKey): LngLat | undefined => {
    if (!t) return undefined
    const id = Number(key)
    const i = Number.isInteger(id) && id >= 0 && id < t.indexOf.length ? t.indexOf[id] : -1
    return i >= 0 ? [t.network.lng[i], t.network.lat[i]] : undefined
  }, [t])
  const atcoName = useMemo(() => {
    const byAtco = new Map(stations.map((s) => [s.atco, s.name]))
    return (atco: string) => byAtco.get(atco) ?? atco
  }, [stations])
  const idName = useCallback((id: number) => {
    const i = t && id < t.indexOf.length ? t.indexOf[id] : -1
    return i >= 0 && names ? names.name[i] : String(id)
  }, [t, names])

  // GeoSurface draws only what the overlays mention; the network below draws the rest.
  const overlayNodes = useMemo<GeoNode[]>(() => {
    if (!t) return []
    const keys = new Set<string>()
    for (const o of list) for (const k of keysOf(o)) keys.add(String(k))
    const composed = compose([...list])
    const out: GeoNode[] = []
    for (const k of keys) {
      const id = Number(k)
      const i = Number.isInteger(id) && id < t.indexOf.length ? t.indexOf[id] : -1
      if (i < 0 || Number.isNaN(t.network.lng[i])) continue
      const c = t.network.nodeCategory[i]
      const labelled = composed.nodes.get(k)?.label ?? composed.nodes.get(id)?.label
      out.push({ key: k, lng: t.network.lng[i], lat: t.network.lat[i], name: labelled ?? (names?.name[i] || k), color: c === NO_CATEGORY ? '#AAAAAA' : MODES[c].color, radius: 2.6 })
    }
    return out
  }, [list, t, names])

  const pickedId = picked.key !== null && t ? Number(picked.key) : null
  const pickedIsStop = pickedId !== null && Number.isInteger(pickedId) && pickedId < (t?.indexOf.length ?? 0) && t!.indexOf[pickedId] >= 0
  const autoRoutes = (picked.from === 'map' || picked.from === 'search') && list.every((o) => o.id === 'stop-routes' || o.id === 'route')

  const toggle = (id: string) => setVisible((v) => (v.includes(id) ? v.filter((x) => x !== id) : [...v, id]))
  const plan = (which: 'from' | 'to', e: Endpoint) => {
    if (which === 'from') setFrom(e)
    else setTo(e)
    setTab('journey')
  }

  const loading = !t && !err
  return (
    <div className="ukt-root">
      <GeoMap basemap={basemap} projection={globe ? 'globe' : 'mercator'} center={[-25, 38]} zoom={1.5} insets={{ left: CONFIG.panelWidth, right: pickedIsStop ? CONFIG.cardWidth + 24 : 0 }} onReady={setMap}>
        {t && <GeoNetwork network={t.network} categories={MODES} visible={visible} keyOf={(i) => String(t.ids[i])} yieldTo={['kit-nodes']} onHover={(h) => hover.current(h)} />}
        {t && <GeoSurface nodes={overlayNodes} labels="overlay" radius={2.6} maxZoom={14} />}
        {t && <GeoPathFlow resolve={position} />}
      </GeoMap>

      {t && <HoverTip register={hover} transport={t} names={names} />}
      {t && <Ribbon transport={t} steps={steps} />}
      {loading && <LoadingHud steps={steps} />}

      <Panel side="left" width={CONFIG.panelWidth} icon={<span className="ukt-logo">⬡</span>} title={CONFIG.title}
        subtitle={counts ? `${sum(counts.labels).toLocaleString()} nodes · ${sum(counts.edgeTypes).toLocaleString()} edges · ${CONFIG.graph}` : 'connecting to TuringDB…'}
        tabs={<Tabs value={tab} onChange={setTab} tabs={TABS} />}
        footer={<div className="tk-note">Live from TuringDB · NaPTAN, Bus Open Data Service and National Rail open data</div>}>
        {!!err && <ErrorCard error={err} />}
        {t && <StopSearch names={names} transport={t} map={map} />}
        <TabPanels value={tab} panels={[
          { id: 'network', body: <NetworkTab t={t} counts={counts} steps={steps} visible={visible} toggle={toggle} setVisible={setVisible} basemap={basemap} setBasemap={setBasemap} globe={globe} setGlobe={setGlobe} /> },
          { id: 'journey', body: <JourneyPanel db={db} stations={stations} picked={pickedStop} from={from} to={to} onFrom={setFrom} onTo={setTo} /> },
          { id: 'explore', body: <PresetPanel presets={PRESETS} client={db} caps={caps} freeText /> },
          { id: 'operators', body: <OperatorsPanel db={db} /> },
          { id: 'ask', body: <AssistantPanel agent={agent} settings={settings} suggestions={CONFIG.suggestions} /> },
        ]} />
      </Panel>

      {pickedIsStop && pickedId !== null && (
        <StopCard db={db} id={pickedId} autoRoutes={autoRoutes} nameOf={atcoName} nameOfId={idName} onLoaded={setPickedStop}
          onClose={() => { overlays.pick(null); overlays.clear(); setPickedStop(null) }} onPlan={plan} />
      )}
    </div>
  )
}

function NetworkTab(p: { t: Transport | null; counts: Counts | null; steps: LoadStep[]; visible: string[]; toggle: (id: string) => void; setVisible: (v: string[]) => void; basemap: string; setBasemap: (b: string) => void; globe: boolean; setGlobe: (g: boolean) => void }) {
  const c = p.counts
  const label = (k: string) => c?.labels.get(k)?.toLocaleString() ?? '…'
  return (
    <>
      <Section title="The graph">
        <StatGrid cols={2}>
          <Stat label="Stops" value={label('Stop')} sub="NaPTAN + GTFS" />
          <Stat label="Rail stations" value={label('Station')} sub="National Rail" />
          <Stat label="Routes" value={label('Route')} sub="distinct stop sequences" />
          <Stat label="Operators" value={label('Operator')} />
        </StatGrid>
        {c && (
          <div className="ukt-edges">
            {[...c.edgeTypes].sort((a, b) => b[1] - a[1]).map(([k, v]) => <span key={k}><span className="tk-mono">{k}</span> {v.toLocaleString()}</span>)}
          </div>
        )}
      </Section>
      <Section title="Modes" right={<span style={{ display: 'flex', gap: 4 }}>
        <button type="button" className="tk-btn" data-variant="ghost" onClick={() => p.setVisible(MODES.map((m) => m.id))}>all</button>
        <button type="button" className="tk-btn" data-variant="ghost" onClick={() => p.setVisible(MODES.filter((m) => m.id !== 'bus').map((m) => m.id))}>no buses</button>
      </span>}>
        {[...MODES].reverse().map((m) => {
          const i = MODES.indexOf(m)
          const on = p.visible.includes(m.id)
          return (
            <button key={m.id} type="button" className="ukt-mode" data-on={on} onClick={() => p.toggle(m.id)}>
              <i style={{ background: m.color, boxShadow: on ? `0 0 10px ${m.color}` : 'none' }} />
              <span className="ukt-mode-label">{m.label}</span>
              <span className="tk-note tk-num">{p.t ? `${p.t.segmentsByMode[i].toLocaleString()} segments · ${p.t.stopsByMode[i].toLocaleString()} stops` : '…'}</span>
            </button>
          )
        })}
        <div className="tk-note" style={{ marginTop: 6 }}>Line width grows with the number of routes sharing a segment.</div>
        {p.t && p.t.unplacedStops > 0 && (
          <div className="tk-note" style={{ marginTop: 4 }}>{p.t.unplacedStops.toLocaleString()} stops have no coordinates in the graph, so {p.t.unplacedSegments.toLocaleString()} segments touching them are not drawn.</div>
        )}
      </Section>
      <Section title="Map">
        <Segmented value={p.basemap} onChange={p.setBasemap} options={[{ value: 'openfreemap-dark', label: 'Dark' }, { value: 'esri-dark-gray', label: 'Dark gray' }, { value: 'esri-imagery', label: 'Imagery' }, { value: 'blank', label: 'None' }]} />
        <div style={{ marginTop: 8 }}><Toggle label="Globe" checked={p.globe} onChange={p.setGlobe} /></div>
        <div className="tk-note" style={{ marginTop: 6 }}>{BASEMAPS[p.basemap].terms}</div>
      </Section>
      <Section title="Loaded from TuringDB" collapsible defaultOpen={false}>
        {p.steps.map((s) => (
          <div key={s.label} className="ukt-step"><span>{s.label}</span><span className="tk-num">{s.rows !== undefined ? `${s.rows.toLocaleString()} rows` : ''}{s.ms !== undefined ? ` · ${s.ms} ms` : ''}</span></div>
        ))}
        <CypherBlock cypher={STOPS_QUERY} />
        <CypherBlock cypher={SEGMENTS_QUERY} />
      </Section>
    </>
  )
}

function StopSearch(p: { names: Names | null; transport: Transport; map: MLMap | null }) {
  const [text, setText] = useState('')
  const hits = useMemo(() => (p.names && text.trim().length >= 2 ? searchStops(p.names, p.transport, text) : []), [p.names, p.transport, text])
  const go = (i: number) => {
    const id = p.transport.ids[i]
    setText('')
    p.map?.flyTo({ center: [p.transport.network.lng[i], p.transport.network.lat[i]], zoom: Math.max(p.map.getZoom(), 13), duration: 1600 })
    overlays.pick(String(id), 'search')
  }
  return (
    <div className="ukt-search">
      <input className="tk-input" placeholder={p.names ? `Search ${p.names.name.length.toLocaleString()} stops…` : 'Loading stop names…'} disabled={!p.names} value={text}
        onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && hits.length) go(hits[0]) }} />
      {hits.length > 0 && (
        <div className="ukt-hits">
          {hits.map((i) => {
            const c = p.transport.network.nodeCategory[i]
            return (
              <button key={i} type="button" onClick={() => go(i)}>
                <i style={{ background: c === NO_CATEGORY ? 'var(--tk-text-faint)' : MODES[c].color }} />
                <span>{p.names!.name[i]}{p.names!.indicator[i] ? ` · ${p.names!.indicator[i]}` : ''}</span>
                <small>{p.names!.locality[i]}</small>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

function HoverTip(p: { register: MutableRefObject<(h: NetworkHover | null) => void>; transport: Transport; names: Names | null }) {
  const [hit, setHit] = useState<NetworkHover | null>(null)
  p.register.current = setHit
  if (!hit) return null
  const { names } = p
  const mode = MODES[p.transport.network.nodeCategory[hit.index]]
  return (
    <div className="ukt-tip" style={{ left: hit.x + 14, top: hit.y + 14 }}>
      <b>{names ? names.name[hit.index] || 'Unnamed stop' : 'Stop'}</b>
      {names?.indicator[hit.index] ? <span className="tk-note"> · {names.indicator[hit.index]}</span> : null}
      <div className="tk-note">{[names?.locality[hit.index], mode?.label].filter(Boolean).join(' · ')}</div>
    </div>
  )
}

function Ribbon(p: { transport: Transport; steps: LoadStep[] }) {
  const ms = p.steps.reduce((a, s) => a + (s.ms ?? 0), 0)
  return (
    <div className="ukt-ribbon">
      <span><b>{p.transport.ids.length.toLocaleString()}</b> stops</span>
      <span><b>{p.transport.network.src.length.toLocaleString()}</b> segments drawn</span>
      <span>read live from TuringDB in <b>{(ms / 1000).toFixed(1)} s</b></span>
    </div>
  )
}

function LoadingHud(p: { steps: LoadStep[] }) {
  return (
    <div className="ukt-hud">
      <div className="ukt-hud-title">Reading the UK transport graph from TuringDB</div>
      {p.steps.map((s) => (
        <div key={s.label} className="ukt-step" data-done={s.done}>
          <span>{s.done ? '✓' : <span className="tk-spin" />} {s.label}</span>
          <span className="tk-num">{s.rows !== undefined ? `${s.rows.toLocaleString()}` : ''}{s.ms !== undefined ? ` · ${s.ms} ms` : ''}</span>
        </div>
      ))}
    </div>
  )
}

const sum = (m: Map<string, number>) => [...m.values()].reduce((a, b) => a + b, 0)
