// Definición del patrón de ciclo, validación contra las reglas y desfases de los equipos.

import { useMemo, useState } from 'react'
import { Alert, Button, Card, NumberInput, ShiftBadge, inputClass } from '../components/ui'
import { annualBalance, autoOffsets, baseItem } from '../engine/calendar'
import { addDays, formatDate, todayISO, WEEKDAY_SHORT, weekday } from '../engine/dates'
import { coverageDeficit, requiredOn, weekendStats } from '../engine/offsets'
import { ruleDefinition, SHIFT_MIX } from '../engine/rules'
import { findShift, itemCode, parsePatternText } from '../engine/shifts'
import { OFF, type RuleKey } from '../engine/types'
import { checkShiftMixByCalendarWeek, describeTeamWeekViolation, SHIFT_WEEK_RULE, type Violation } from '../engine/validation'
import { useOffsets, useRules, useValidation } from '../store/derived'
import { useStore } from '../store/useStore'

export function PatronPage() {
  return (
    <div className="flex flex-col gap-4">
      <PatternEditor />
      <ValidationPanel />
      <OffsetsPanel />
      <AnnualBalancePanel />
      <Preview />
    </div>
  )
}

function PatternEditor() {
  const config = useStore((s) => s.config)
  const update = useStore((s) => s.updateConfig)
  const text = config.pattern.map((p) => itemCode(config.shifts, p)).join(' ')
  const [draft, setDraft] = useState<string | null>(null)
  const parsed = draft != null ? parsePatternText(draft, config.shifts) : null
  const options = [...config.shifts.map((s) => s.id), OFF]

  const cycleItem = (i: number) =>
    update((c) => {
      const idx = options.indexOf(c.pattern[i])
      c.pattern[i] = options[(idx + 1) % options.length]
    })

  return (
    <Card title={`Patrón del ciclo (${config.pattern.length} días)`}>
      <p className="mb-3 text-sm text-slate-600">
        Escribe la secuencia con las letras de los turnos y <b>L</b> para libre (por ejemplo <code>M M T T N N L L L L</code>), o pulsa
        cada casilla para cambiarla. Todos los equipos siguen este mismo patrón con un desfase.
      </p>
      <div className="mb-3 flex flex-wrap gap-2">
        <input
          className={`${inputClass} min-w-64 flex-1 font-mono uppercase`}
          value={draft ?? text}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => {
            if (parsed && parsed.unknown.length === 0 && parsed.pattern.length) update((c) => void (c.pattern = parsed.pattern))
            setDraft(null)
          }}
          onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
        />
      </div>
      {parsed && parsed.unknown.length > 0 && (
        <Alert kind="error">Letras no reconocidas: {parsed.unknown.join(', ')}. Revisa los turnos definidos en «Negocio».</Alert>
      )}
      <div className="flex flex-wrap items-end gap-1">
        {config.pattern.map((item, i) => {
          const s = findShift(config.shifts, item)
          return (
            <button key={i} type="button" className="flex flex-col items-center" onClick={() => cycleItem(i)} title="Pulsa para cambiar">
              <span className="text-[10px] text-slate-400">{i + 1}</span>
              <ShiftBadge code={itemCode(config.shifts, item)} color={s?.color ?? '#fff'} />
            </button>
          )
        })}
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        {options.map((o) => (
          <Button key={o} onClick={() => update((c) => void c.pattern.push(o))}>
            + {itemCode(config.shifts, o)}
          </Button>
        ))}
        <Button disabled={!config.pattern.length} onClick={() => update((c) => void c.pattern.pop())}>
          Quitar último
        </Button>
      </div>
    </Card>
  )
}

function ValidationPanel() {
  const config = useStore((s) => s.config)
  const { violations, notices, stats } = useValidation()
  const { rules } = useRules()
  const offsets = useOffsets()
  const teamWeek = useMemo(
    () =>
      rules.shiftMixInWeek === SHIFT_MIX.NUNCA
        ? checkShiftMixByCalendarWeek(config.pattern, config.teams, offsets, config.startDate)
        : [],
    [rules.shiftMixInWeek, config.pattern, config.teams, offsets, config.startDate],
  )

  const grouped = new Map<string, Violation[]>()
  for (const v of violations) grouped.set(v.rule, [...(grouped.get(v.rule) ?? []), v])
  const ok = violations.length === 0 && teamWeek.length === 0

  return (
    <Card title="Comprobación de reglas">
      <div className="mb-4 grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
        <Stat label="Días de trabajo / libres" value={`${stats.workDays} / ${stats.offDays}`} />
        <Stat label="Horas por ciclo" value={`${stats.hoursPerCycle} h`} />
        <Stat label="Media semanal" value={`${stats.avgWeeklyHours} h`} />
        <Stat
          label="Al año (descontando vacaciones)"
          value={`${stats.netAnnualWorkDays} días · ${stats.netAnnualHours} h`}
          sub={`Sin descontar: ${stats.grossAnnualWorkDays} días · ${stats.grossAnnualHours} h`}
        />
      </div>
      <div className="flex flex-col gap-2">
        {ok && <Alert kind="ok">El patrón cumple todas las reglas activas.</Alert>}
        {[...grouped.entries()].map(([rule, list]) => (
          <Alert key={rule} kind="error">
            <div className="font-semibold">
              {rule === SHIFT_WEEK_RULE ? 'Máximo de días por semana en un turno' : ruleDefinition(rule as RuleKey).label}
            </div>
            <ul className="ml-4 list-disc">
              {list.slice(0, 3).map((v, i) => (
                <li key={i}>{v.message}</li>
              ))}
              {list.length > 3 && <li>… y {list.length - 3} casos más en el ciclo.</li>}
            </ul>
          </Alert>
        ))}
        {teamWeek.length > 0 && (
          <Alert kind="error">
            <div className="font-semibold">{ruleDefinition('shiftMixInWeek').label} — No</div>
            <ul className="ml-4 list-disc">
              {teamWeek.map((v) => (
                <li key={v.teamId}>
                  {describeTeamWeekViolation(v, config.teams.find((t) => t.id === v.teamId)?.name ?? '')}
                </li>
              ))}
            </ul>
          </Alert>
        )}
        {notices.map((n, i) => (
          <Alert key={i} kind="warning">
            {n}
          </Alert>
        ))}
      </div>
    </Card>
  )
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-lg bg-slate-50 p-2">
      <div className="text-xs text-slate-500">{label}</div>
      <div className="font-semibold text-slate-800">{value}</div>
      {sub && <div className="text-xs text-slate-500">{sub}</div>}
    </div>
  )
}

function OffsetsPanel() {
  const config = useStore((s) => s.config)
  const update = useStore((s) => s.updateConfig)
  const auto = useMemo(() => autoOffsets(config), [config])
  const offsets = useOffsets()
  const unit = config.coverageMode === 'equipos' ? 'equipos' : 'personas'
  const impossible = auto.feasibility.filter((f) => !f.possible)
  const deficit =
    config.offsetMode === 'auto'
      ? auto.deficit
      : coverageDeficit(
          {
            pattern: config.pattern,
            teams: config.teams,
            coverage: config.coverage,
            coverageMode: config.coverageMode,
            startWeekday: weekday(config.startDate),
          },
          offsets,
        )

  return (
    <Card title="Desfase de los equipos">
      <div className="mb-3 flex flex-wrap items-center gap-4 text-sm">
        <label className="flex items-center gap-2">
          <input type="radio" checked={config.offsetMode === 'auto'} onChange={() => update((c) => void (c.offsetMode = 'auto'))} />
          Automático (la app busca el mejor reparto)
        </label>
        <label className="flex items-center gap-2">
          <input
            type="radio"
            checked={config.offsetMode === 'manual'}
            onChange={() =>
              update((c) => {
                c.offsetMode = 'manual'
                c.teams.forEach((t, i) => (t.offset = offsets[i]))
              })
            }
          />
          Manual (escribo yo los días de desfase)
        </label>
      </div>
      <p className="mb-3 text-sm text-slate-600">
        Rotación equitativa: todos los equipos hacen exactamente el mismo patrón, solo que empezando en días distintos. Así, a lo
        largo del ciclo, todos trabajan las mismas horas y los mismos turnos de mañana, tarde y noche.
      </p>
      <div className="mb-3 flex flex-col gap-2">
        {impossible.map((f) => (
          <Alert key={f.shiftId} kind="error">
            Con este patrón es imposible cubrir el turno {findShift(config.shifts, f.shiftId)?.name}: se necesitan {f.required} {unit} y
            de media solo hay {Math.round(f.averageAvailable * 100) / 100}. Añade equipos o más días de ese turno al patrón.
          </Alert>
        ))}
        {deficit === 0 ? (
          <Alert kind="ok">Con estos desfases todos los turnos tienen la cobertura mínima todos los días.</Alert>
        ) : (
          <Alert kind="warning">
            Con estos desfases quedan huecos de cobertura ({deficit} {unit}·día en {auto.periodDays} días). Revisa la vista previa.
          </Alert>
        )}
      </div>
      <div className="flex flex-wrap gap-2">
        {config.teams.map((t, i) => (
          <div key={t.id} className="flex items-center gap-2 rounded-lg border border-slate-200 px-2 py-1 text-sm">
            <span className="font-medium">{t.name}</span>
            {config.offsetMode === 'manual' ? (
              <NumberInput
                className="w-16"
                min={0}
                value={t.offset}
                onChange={(v) => update((c) => void (c.teams[i].offset = v))}
              />
            ) : (
              <b>{offsets[i]}</b>
            )}
            <span className="text-slate-500">días</span>
          </div>
        ))}
      </div>
      <WeekendSummary offsets={offsets} />
    </Card>
  )
}

function WeekendSummary({ offsets }: { offsets: number[] }) {
  const config = useStore((s) => s.config)
  const L = config.pattern.length
  const stats = useMemo(
    () => weekendStats(config.pattern, weekday(config.startDate), offsets),
    [config.pattern, config.startDate, offsets],
  )
  if (!L) return null
  const fixedDays = L % 7 === 0
  return (
    <div className="mt-4">
      <h3 className="mb-1 text-sm font-semibold text-slate-700">Fines de semana libres al año</h3>
      <p className="mb-2 text-xs text-slate-500">
        Requisito fijo del cálculo: los desfases se eligen para librar los máximos fines de semana completos (sábado y domingo
        seguidos) y repartirlos de forma justa entre los equipos, siempre que se mantenga la cobertura.{' '}
        {fixedDays
          ? `Como el ciclo (${L} días) es múltiplo de 7, cada equipo libra siempre los mismos días de la semana.`
          : `Como el ciclo (${L} días) no es múltiplo de 7, los días libres van cambiando de día de la semana y, con el tiempo, todos los equipos libran los mismos fines de semana.`}{' '}
        Para librar más fines de semana hay que cambiar el patrón (por ejemplo, un ciclo de 7, 14, 21 o 28 días con los libres en sábado y domingo).
      </p>
      <div className="flex flex-wrap gap-2 text-sm">
        {config.teams.map((t, i) => (
          <div key={t.id} className="rounded-lg bg-slate-50 px-2 py-1">
            <span className="font-medium">{t.name}:</span> {stats[i]?.fullPerYear ?? 0} completos
            <span className="text-slate-500"> · {stats[i]?.partialPerYear ?? 0} medios</span>
          </div>
        ))}
      </div>
    </div>
  )
}

function AnnualBalancePanel() {
  const config = useStore((s) => s.config)
  const offsets = useOffsets()
  const { rules } = useRules()
  const [year, setYear] = useState(Number(todayISO().slice(0, 4)))
  const bal = useMemo(() => annualBalance(config, rules, year, offsets), [config, rules, year, offsets])
  const fmt = (n: number | null, unit: string) =>
    n == null ? '—' : n > 0 ? `+${n} ${unit}` : n < 0 ? `${n} ${unit}` : `0 ${unit}`
  const tone = (n: number | null) => (n == null || n === 0 ? 'text-slate-700' : n > 0 ? 'text-amber-700' : 'text-red-600')
  return (
    <Card
      title={`Balance de jornada anual ${year}`}
      actions={
        <>
          <Button onClick={() => setYear(year - 1)} aria-label="Año anterior">
            ←
          </Button>
          <Button onClick={() => setYear(year + 1)} aria-label="Año siguiente">
            →
          </Button>
        </>
      }
    >
      <div className="mb-3 grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
        <Stat label="Jornada anual (convenio)" value={`${rules.maxAnnualWorkDays ?? '—'} días · ${rules.maxAnnualHours ?? '—'} h`} />
        <Stat label="Vacaciones" value={`${rules.vacationDays ?? 0} días ${rules.vacationDayType === 1 ? 'hábiles' : 'naturales'}`} />
        <Stat
          label="Festivos"
          value={`${bal.holidayCount} · ${bal.holidaysOff ? 'se libran' : 'se trabajan'}`}
          sub={bal.realHolidays ? 'Fechas reales de «Negocio»' : 'Estimación: aún no has puesto las fechas de este año'}
        />
        <Stat label="Exceso positivo" value="Días a dar libres" sub="Negativo: días que faltan" />
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm tabular-nums">
          <thead className="text-left text-slate-500">
            <tr>
              <th className="p-1">Equipo</th>
              <th className="p-1">Días en cuadrante</th>
              <th className="p-1">Festivos en día de trabajo</th>
              <th className="p-1">− Vacaciones</th>
              <th className="p-1">Días efectivos</th>
              <th className="p-1">Horas efectivas</th>
              <th className="p-1">Exceso (días)</th>
              <th className="p-1">Exceso (horas)</th>
            </tr>
          </thead>
          <tbody>
            {bal.rows.map((r) => (
              <tr key={r.teamId} className="border-t border-slate-100">
                <td className="p-1 font-medium">{config.teams.find((t) => t.id === r.teamId)?.name}</td>
                <td className="p-1">{r.workDays}</td>
                <td className="p-1">
                  {r.holidaysOnWork}
                  <span className="text-slate-400">{bal.holidaysOff ? ' (se restan)' : ' (se trabajan)'}</span>
                </td>
                <td className="p-1">{r.vacationWorkDays}</td>
                <td className="p-1 font-semibold">{r.effectiveDays}</td>
                <td className="p-1 font-semibold">{r.effectiveHours} h</td>
                <td className={`p-1 font-semibold ${tone(r.excessDays)}`}>{fmt(r.excessDays, 'días')}</td>
                <td className={`p-1 font-semibold ${tone(r.excessHours)}`}>{fmt(r.excessHours, 'h')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-xs text-slate-500">
        Días efectivos = días de trabajo del cuadrante en el año − días de trabajo que caen en vacaciones
        {bal.holidaysOff ? ' − festivos que caen en día de trabajo' : ''}. El exceso es lo que hay que compensar con días libres por
        exceso de jornada. Cambia los festivos, las vacaciones y la jornada anual en «Normativa».
      </p>
    </Card>
  )
}

function Preview() {
  const config = useStore((s) => s.config)
  const offsets = useOffsets()
  const days = Math.min(Math.max(config.pattern.length, 14), 56)
  const dates = Array.from({ length: days }, (_, i) => addDays(config.startDate, i))
  const unit = config.coverageMode === 'equipos' ? 'equipos' : 'personas'
  return (
    <Card title={`Vista previa: ${days} días desde el ${formatDate(config.startDate)}`}>
      <div className="overflow-x-auto">
        <table className="border-separate border-spacing-0.5 text-xs">
          <thead>
            <tr>
              <th />
              {dates.map((d) => (
                <th key={d} className="min-w-7 text-center font-normal text-slate-500">
                  {WEEKDAY_SHORT[weekday(d)]}
                  <br />
                  {d.slice(8)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {config.teams.map((t, i) => (
              <tr key={t.id}>
                <td className="pr-2 whitespace-nowrap font-medium">
                  {t.name} <span className="text-slate-400">(+{offsets[i]})</span>
                </td>
                {dates.map((d) => {
                  const item = baseItem(config, offsets[i], d)
                  return (
                    <td key={d}>
                      <ShiftBadge code={itemCode(config.shifts, item)} color={findShift(config.shifts, item)?.color ?? '#fff'} />
                    </td>
                  )
                })}
              </tr>
            ))}
            {config.coverage
              .filter((r) => r.min > 0)
              .map((req) => {
                const s = findShift(config.shifts, req.shiftId)
                return (
                  <tr key={req.shiftId}>
                    <td className="pt-2 pr-2 whitespace-nowrap text-slate-500">
                      {s?.name} ({unit})
                    </td>
                    {dates.map((d) => {
                      let have = 0
                      config.teams.forEach((t, i) => {
                        if (baseItem(config, offsets[i], d) === req.shiftId)
                          have += config.coverageMode === 'equipos' ? 1 : t.employees.length
                      })
                      const need = requiredOn(req, weekday(d))
                      return (
                        <td
                          key={d}
                          className={`pt-2 text-center font-semibold ${have < need ? 'text-red-600' : 'text-emerald-700'}`}
                        >
                          {have}
                        </td>
                      )
                    })}
                  </tr>
                )
              })}
          </tbody>
        </table>
      </div>
    </Card>
  )
}
