import { useEffect, useMemo, useState } from 'react'
import { overlays } from '@kit/overlay'
import type { TuringClient } from '@kit/tdb-client'
import { BarRow, CypherBlock, ErrorCard, Honesty, Loading, Section, Segmented } from '@kit/ui'
import { MODES, modeColor, modeLabel } from './config'
import { loadOperators, OPERATORS_QUERY, operatorOverlay, type OperatorRow } from './routes'

const SHOWN = 30

export function OperatorsPanel(p: { db: TuringClient }) {
  const [rows, setRows] = useState<OperatorRow[] | null>(null)
  const [err, setErr] = useState<unknown>(null)
  const [mode, setMode] = useState('all')
  const [active, setActive] = useState<number | null>(null)
  const [busy, setBusy] = useState(false)
  const [last, setLast] = useState<{ query: string; stops: number; ms: number } | null>(null)

  useEffect(() => { loadOperators(p.db).then(setRows, setErr) }, [p.db])

  const ranked = useMemo(() => {
    if (!rows) return []
    const routesIn = (r: OperatorRow) => (mode === 'all' ? r.routes : r.modes.get(mode) ?? 0)
    return rows.filter((r) => routesIn(r) > 0).map((r) => ({ row: r, n: routesIn(r) })).sort((a, b) => b.n - a.n).slice(0, SHOWN)
  }, [rows, mode])

  const show = async (r: OperatorRow) => {
    setActive(r.id)
    setBusy(true)
    setErr(null)
    const t0 = performance.now()
    try {
      const x = await operatorOverlay(p.db, r)
      overlays.show(x.overlay)
      setLast({ query: x.query, stops: x.stops, ms: Math.round(performance.now() - t0) })
    } catch (e) {
      setErr(e)
    } finally {
      setBusy(false)
    }
  }

  const present = rows ? MODES.filter((m) => rows.some((r) => r.modes.has(m.id))) : []
  const dominant = (r: OperatorRow) => [...r.modes].sort((a, b) => b[1] - a[1])[0]?.[0]
  return (
    <>
      <Section title="Operators" count={rows?.length} right={<Honesty kind="measured" />}>
        <Segmented value={mode} onChange={setMode} options={[{ value: 'all', label: 'All' }, ...present.map((m) => ({ value: m.id, label: m.label }))]} />
        {!rows && !err && <Loading>Counting routes per operator…</Loading>}
        <div style={{ marginTop: 8 }}>
          {ranked.map(({ row, n }) => (
            <BarRow key={row.id} label={row.name} sub={[...row.modes.keys()].map(modeLabel).join(' · ')} value={n} max={ranked[0].n}
              color={modeColor(mode === 'all' ? dominant(row) : mode)} format={(v) => v.toLocaleString()} active={active === row.id} onClick={() => show(row)} />
          ))}
        </div>
        <div className="tk-note" style={{ marginTop: 6 }}>Routes per operator; click one to draw everything it runs.</div>
      </Section>
      {!!err && <ErrorCard error={err} />}
      {busy && <Loading>Drawing the network…</Loading>}
      {last && !busy && (
        <Section title="On the map">
          <div className="tk-note">{last.stops.toLocaleString()} stops · {last.ms} ms</div>
          <CypherBlock cypher={last.query} />
        </Section>
      )}
      <details><summary className="tk-note" style={{ cursor: 'pointer' }}>ranking query</summary><CypherBlock cypher={OPERATORS_QUERY} /></details>
    </>
  )
}
