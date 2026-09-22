// Calendario generado (semana, mes, año), excepciones y exportación.

import { useMemo, useState } from 'react'
import { Alert, Button, Card, Field, ShiftBadge, inputClass } from '../components/ui'
import { baseItem, buildSchedule, EXCEPTION_LABELS, vacationDaysUsed, type DaySchedule } from '../engine/calendar'
import {
  addDays,
  addMonths,
  daysInMonth,
  formatDate,
  MONTH_NAMES,
  startOfMonth,
  startOfWeek,
  todayISO,
  WEEKDAY_SHORT,
  weekday,
} from '../engine/dates'
import { uid } from '../engine/defaults'
import { VACATION_TYPE } from '../engine/rules'
import { findShift, itemCode } from '../engine/shifts'
import { OFF, type BusinessConfig, type ExceptionKind, type ISODate, type ScheduleException } from '../engine/types'
import { cellDisplay, useOffsets, useRules } from '../store/derived'
import { useStore } from '../store/useStore'

type View = 'semana' | 'mes' | 'año'

function rangeFor(view: View, anchor: ISODate): [ISODate, ISODate] {
  if (view === 'semana') {
    const s = startOfWeek(anchor)
    return [s, addDays(s, 6)]
  }
  if (view === 'mes') {
    const s = startOfMonth(anchor)
    const [y, m] = s.split('-').map(Number)
    return [s, addDays(s, daysInMonth(y, m) - 1)]
  }
  const y = anchor.slice(0, 4)
  return [`${y}-01-01`, `${y}-12-31`]
}

export function CalendarioPage() {
  const config = useStore((s) => s.config)
  const offsets = useOffsets()
  const [view, setView] = useState<View>('mes')
  const [anchor, setAnchor] = useState(todayISO())
  const [draft, setDraft] = useState<Partial<ScheduleException> | null>(null)
  const [busy, setBusy] = useState(false)
  const [from, to] = rangeFor(view, anchor)
  const days = useMemo(() => buildSchedule(config, from, to, offsets), [config, from, to, offsets])

  const move = (dir: -1 | 1) =>
    setAnchor(view === 'semana' ? addDays(anchor, 7 * dir) : view === 'mes' ? addMonths(anchor, dir) : addMonths(anchor, 12 * dir))

  const title =
    view === 'semana'
      ? `Semana del ${formatDate(from)} al ${formatDate(to)}`
      : view === 'mes'
        ? `${MONTH_NAMES[Number(from.slice(5, 7)) - 1]} ${from.slice(0, 4)}`
        : `Año ${from.slice(0, 4)}`

  const doExport = async (kind: 'excel' | 'pdf') => {
    setBusy(true)
    try {
      const yearly = view === 'año'
      if (kind === 'excel') await (await import('../export/excel')).exportExcel(config, from, to, yearly)
      else (await import('../export/pdf')).exportPdf(config, from, to, yearly)
    } finally {
      setBusy(false)
    }
  }

  const problems = days.filter((d) => d.coverage.some((c) => !c.ok || c.reducedTeams.length > 0))

  return (
    <div className="flex flex-col gap-4">
      <Card
        title={title}
        actions={
          <>
            <div className="flex overflow-hidden rounded-lg border border-slate-300">
              {(['semana', 'mes', 'año'] as View[]).map((v) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => setView(v)}
                  className={`px-3 py-1.5 text-sm capitalize ${view === v ? 'bg-indigo-600 text-white' : 'bg-white text-slate-700'}`}
                >
                  {v}
                </button>
              ))}
            </div>
            <Button onClick={() => move(-1)} aria-label="Anterior">
              ←
            </Button>
            <Button onClick={() => setAnchor(todayISO())}>Hoy</Button>
            <Button onClick={() => move(1)} aria-label="Siguiente">
              →
            </Button>
            <Button disabled={busy} onClick={() => doExport('excel')}>
              Excel
            </Button>
            <Button disabled={busy} onClick={() => doExport('pdf')}>
              PDF
            </Button>
          </>
        }
      >
        <Legend config={config} />
        {view === 'año' ? (
          <YearGrid config={config} offsets={offsets} year={Number(from.slice(0, 4))} />
        ) : (
          <PersonGrid
            config={config}
            days={days}
            onCellClick={(employeeId, date) => setDraft({ kind: 'vacaciones', employeeId, from: date, to: date })}
          />
        )}
        {view !== 'año' && (
          <p className="mt-2 text-xs text-slate-500">Pulsa una casilla para añadir una excepción ese día.</p>
        )}
      </Card>

      {problems.length > 0 && view !== 'año' && <CoverageWarnings config={config} days={problems} />}

      <ExceptionsPanel draft={draft} setDraft={setDraft} />
      <VacationSummary year={Number(anchor.slice(0, 4))} />
    </div>
  )
}

function Legend({ config }: { config: BusinessConfig }) {
  return (
    <div className="mb-3 flex flex-wrap gap-3 text-xs text-slate-600">
      {config.shifts.map((s) => (
        <span key={s.id} className="flex items-center gap-1">
          <ShiftBadge code={s.code} color={s.color} /> {s.name} {s.start}–{s.end}
        </span>
      ))}
      <span className="flex items-center gap-1">
        <ShiftBadge code="L" color="#fff" /> Libre
      </span>
      <span className="flex items-center gap-1">
        <ShiftBadge code="V" color="#e2e8f0" /> Vacaciones · B Baja · P Permiso
      </span>
      <span className="flex items-center gap-1">
        <ShiftBadge code="·" color="#fff" marked /> Cambio sobre el patrón
      </span>
    </div>
  )
}

function PersonGrid({
  config,
  days,
  onCellClick,
}: {
  config: BusinessConfig
  days: DaySchedule[]
  onCellClick: (employeeId: string, date: ISODate) => void
}) {
  const unit = config.coverageMode === 'equipos' ? 'eq.' : 'pers.'
  const today = todayISO()
  return (
    <div className="overflow-x-auto">
      <table className="border-separate border-spacing-0.5 text-xs">
        <thead>
          <tr>
            <th className="sticky left-0 bg-white" />
            {days.map((d) => (
              <th
                key={d.date}
                title={d.holiday?.name}
                className={`min-w-8 rounded text-center font-normal ${d.holiday ? 'bg-rose-100 text-rose-800' : 'text-slate-500'} ${
                  d.date === today ? 'outline-2 outline-indigo-500' : ''
                }`}
              >
                {WEEKDAY_SHORT[d.weekday]}
                <br />
                {d.date.slice(8)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {config.teams.map((team) => (
            <TeamRows key={team.id} team={team} config={config} days={days} onCellClick={onCellClick} />
          ))}
          {config.coverage
            .filter((r) => r.min > 0)
            .map((req) => (
              <tr key={req.shiftId}>
                <td className="sticky left-0 bg-white pt-2 pr-2 whitespace-nowrap text-slate-500">
                  {findShift(config.shifts, req.shiftId)?.name} ({unit})
                </td>
                {days.map((d) => {
                  const c = d.coverage.find((x) => x.shiftId === req.shiftId)!
                  return (
                    <td key={d.date} className={`pt-2 text-center font-semibold ${c.ok ? 'text-emerald-700' : 'text-red-600'}`}>
                      {config.coverageMode === 'equipos' ? c.teams : c.persons}
                    </td>
                  )
                })}
              </tr>
            ))}
        </tbody>
      </table>
    </div>
  )
}

function TeamRows({
  team,
  config,
  days,
  onCellClick,
}: {
  team: BusinessConfig['teams'][number]
  config: BusinessConfig
  days: DaySchedule[]
  onCellClick: (employeeId: string, date: ISODate) => void
}) {
  return (
    <>
      <tr>
        <td colSpan={days.length + 1} className="sticky left-0 bg-white pt-2 text-xs font-semibold text-slate-700">
          {team.name}
        </td>
      </tr>
      {team.employees.map((e) => (
        <tr key={e.id}>
          <td className="sticky left-0 max-w-40 truncate bg-white pr-2 whitespace-nowrap">{e.name}</td>
          {days.map((d) => {
            const cell = d.cells[e.id]
            const { code, color } = cellDisplay(config, cell)
            const tip = cell.changed ? `Según patrón: ${itemCode(config.shifts, cell.base)}` : undefined
            return (
              <td key={d.date} title={tip}>
                <button type="button" onClick={() => onCellClick(e.id, d.date)} className="block">
                  <ShiftBadge code={code} color={color} marked={cell.changed} />
                </button>
              </td>
            )
          })}
        </tr>
      ))}
    </>
  )
}

function YearGrid({ config, offsets, year }: { config: BusinessConfig; offsets: number[]; year: number }) {
  const hasException = (teamIdx: number, date: ISODate) => {
    const ids = new Set(config.teams[teamIdx].employees.map((e) => e.id))
    return config.exceptions.some((x) => x.from <= date && date <= x.to && (ids.has(x.employeeId) || ids.has(x.otherEmployeeId ?? '')))
  }
  return (
    <div className="flex flex-col gap-4 overflow-x-auto">
      {MONTH_NAMES.map((mName, m) => {
        const n = daysInMonth(year, m + 1)
        const dates = Array.from({ length: n }, (_, i) => `${year}-${String(m + 1).padStart(2, '0')}-${String(i + 1).padStart(2, '0')}`)
        return (
          <div key={m}>
            <div className="mb-1 text-sm font-semibold text-slate-700">{mName}</div>
            <table className="border-separate border-spacing-px text-[10px]">
              <thead>
                <tr>
                  <th />
                  {dates.map((d) => {
                    const hol = config.holidays.some((h) => h.date === d)
                    return (
                      <th key={d} className={`w-5 font-normal ${hol ? 'bg-rose-100 text-rose-800' : weekday(d) >= 5 ? 'text-slate-700' : 'text-slate-400'}`}>
                        {Number(d.slice(8))}
                      </th>
                    )
                  })}
                </tr>
              </thead>
              <tbody>
                {config.teams.map((t, i) => (
                  <tr key={t.id}>
                    <td className="pr-2 whitespace-nowrap">{t.name}</td>
                    {dates.map((d) => {
                      const item = baseItem(config, offsets[i], d)
                      const s = findShift(config.shifts, item)
                      const ex = hasException(i, d)
                      return (
                        <td
                          key={d}
                          className={`h-5 w-5 text-center font-semibold ${ex ? 'ring-1 ring-rose-500' : ''}`}
                          style={{ backgroundColor: s?.color ?? '#f8fafc' }}
                          title={ex ? 'Hay excepciones este día en el equipo' : undefined}
                        >
                          {item === OFF ? '' : s?.code}
                        </td>
                      )
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      })}
    </div>
  )
}

function CoverageWarnings({ config, days }: { config: BusinessConfig; days: DaySchedule[] }) {
  const lines: string[] = []
  for (const d of days) {
    for (const c of d.coverage) {
      const name = findShift(config.shifts, c.shiftId)?.name
      if (!c.ok) lines.push(`${formatDate(d.date)} · ${name}: cobertura por debajo del mínimo (${c.required}).`)
      else if (c.reducedTeams.length) lines.push(`${formatDate(d.date)} · ${name}: ${c.reducedTeams.join(', ')} con personas ausentes.`)
    }
  }
  return (
    <Card title="Avisos de cobertura en este periodo">
      <Alert kind="warning">
        <ul className="ml-4 list-disc">
          {lines.slice(0, 20).map((l, i) => (
            <li key={i}>{l}</li>
          ))}
          {lines.length > 20 && <li>… y {lines.length - 20} avisos más.</li>}
        </ul>
      </Alert>
    </Card>
  )
}

function ExceptionsPanel({
  draft,
  setDraft,
}: {
  draft: Partial<ScheduleException> | null
  setDraft: (d: Partial<ScheduleException> | null) => void
}) {
  const config = useStore((s) => s.config)
  const update = useStore((s) => s.updateConfig)
  const employees = config.teams.flatMap((t) => t.employees.map((e) => ({ ...e, team: t.name })))
  const nameOf = (id?: string) => employees.find((e) => e.id === id)?.name ?? '—'
  const d = draft ?? {}
  const set = (patch: Partial<ScheduleException>) => setDraft({ ...d, ...patch })
  const valid =
    d.kind && d.employeeId && d.from && d.to && d.from <= d.to && (d.kind !== 'intercambio' || (d.otherEmployeeId && d.otherEmployeeId !== d.employeeId)) &&
    (d.kind !== 'cambio' || d.shiftId)

  const save = () => {
    if (!valid) return
    update((c) => void c.exceptions.push({ ...(d as ScheduleException), id: uid() }))
    setDraft(null)
  }

  const sorted = [...config.exceptions].sort((a, b) => a.from.localeCompare(b.from))

  return (
    <Card
      title="Excepciones (vacaciones, bajas, cambios)"
      actions={!draft && <Button onClick={() => setDraft({ kind: 'vacaciones', from: todayISO(), to: todayISO() })}>+ Nueva excepción</Button>}
    >
      <p className="mb-3 text-sm text-slate-600">
        Las excepciones se aplican encima del patrón sin cambiarlo. La app avisa si dejan algún turno sin la cobertura mínima.
      </p>
      {draft && (
        <div className="mb-4 grid gap-3 rounded-lg bg-slate-50 p-3 sm:grid-cols-3">
          <Field label="Tipo">
            <select className={inputClass} value={d.kind} onChange={(e) => set({ kind: e.target.value as ExceptionKind })}>
              {Object.entries(EXCEPTION_LABELS).map(([k, l]) => (
                <option key={k} value={k}>
                  {l}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Persona">
            <select className={inputClass} value={d.employeeId ?? ''} onChange={(e) => set({ employeeId: e.target.value })}>
              <option value="">Elegir…</option>
              {employees.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.name} ({e.team})
                </option>
              ))}
            </select>
          </Field>
          {d.kind === 'intercambio' && (
            <Field label="Intercambia con">
              <select className={inputClass} value={d.otherEmployeeId ?? ''} onChange={(e) => set({ otherEmployeeId: e.target.value })}>
                <option value="">Elegir…</option>
                {employees
                  .filter((e) => e.id !== d.employeeId)
                  .map((e) => (
                    <option key={e.id} value={e.id}>
                      {e.name} ({e.team})
                    </option>
                  ))}
              </select>
            </Field>
          )}
          {d.kind === 'cambio' && (
            <Field label="Turno que hará">
              <select className={inputClass} value={d.shiftId ?? ''} onChange={(e) => set({ shiftId: e.target.value })}>
                <option value="">Elegir…</option>
                {config.shifts.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
                <option value={OFF}>Libre</option>
              </select>
            </Field>
          )}
          <Field label="Desde">
            <input type="date" className={inputClass} value={d.from ?? ''} onChange={(e) => set({ from: e.target.value, to: d.to && d.to < e.target.value ? e.target.value : d.to })} />
          </Field>
          <Field label="Hasta (incluido)">
            <input type="date" className={inputClass} value={d.to ?? ''} onChange={(e) => set({ to: e.target.value })} />
          </Field>
          <Field label="Nota">
            <input className={inputClass} value={d.note ?? ''} onChange={(e) => set({ note: e.target.value })} />
          </Field>
          <div className="flex items-end gap-2 sm:col-span-3">
            <Button variant="primary" disabled={!valid} onClick={save}>
              Guardar excepción
            </Button>
            <Button onClick={() => setDraft(null)}>Cancelar</Button>
          </div>
        </div>
      )}
      {sorted.length === 0 ? (
        <p className="text-sm text-slate-500">No hay excepciones.</p>
      ) : (
        <ul className="divide-y divide-slate-100 text-sm">
          {sorted.map((x) => (
            <li key={x.id} className="flex flex-wrap items-center gap-2 py-2">
              <span className="rounded bg-slate-100 px-2 py-0.5 text-xs font-medium">{EXCEPTION_LABELS[x.kind]}</span>
              <span className="font-medium">{nameOf(x.employeeId)}</span>
              {x.kind === 'intercambio' && <span>⇄ {nameOf(x.otherEmployeeId)}</span>}
              {x.kind === 'cambio' && <span>→ {x.shiftId === OFF ? 'Libre' : findShift(config.shifts, x.shiftId ?? '')?.name}</span>}
              <span className="text-slate-600">
                {formatDate(x.from)}
                {x.to !== x.from && ` – ${formatDate(x.to)}`}
              </span>
              {x.note && <span className="text-slate-500">· {x.note}</span>}
              <Button
                variant="ghost"
                className="ml-auto"
                onClick={() => update((c) => void (c.exceptions = c.exceptions.filter((e) => e.id !== x.id)))}
              >
                Eliminar
              </Button>
            </li>
          ))}
        </ul>
      )}
    </Card>
  )
}

function VacationSummary({ year }: { year: number }) {
  const config = useStore((s) => s.config)
  const offsets = useOffsets()
  const { rules } = useRules()
  if (rules.vacationDays == null) return null
  const habiles = rules.vacationDayType === VACATION_TYPE.HABILES
  return (
    <Card title={`Vacaciones ${year} (${rules.vacationDays} días ${habiles ? 'hábiles' : 'naturales'})`}>
      <div className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2 lg:grid-cols-3">
        {config.teams.flatMap((t) =>
          t.employees.map((e) => {
            const used = vacationDaysUsed(config, e.id, year, habiles, offsets)
            const left = rules.vacationDays! - used
            return (
              <div key={e.id} className="flex justify-between border-b border-slate-100 py-1">
                <span>
                  {e.name} <span className="text-slate-400">· {t.name}</span>
                </span>
                <span className={left < 0 ? 'font-semibold text-red-600' : 'text-slate-700'}>
                  {used} usados · {left} pendientes
                </span>
              </div>
            )
          }),
        )}
      </div>
    </Card>
  )
}
