// Configuración del negocio: turnos, equipos, cobertura y festivos.

import { useState } from 'react'
import { Button, Card, Field, NumberInput, inputClass } from '../components/ui'
import { formatDate, WEEKDAY_SHORT } from '../engine/dates'
import { DEFAULT_COLORS, makeTeams, uid } from '../engine/defaults'
import { shiftHours } from '../engine/shifts'
import { OFF } from '../engine/types'
import { useStore } from '../store/useStore'

export function NegocioPage() {
  return (
    <div className="flex flex-col gap-4">
      <DatosGenerales />
      <Turnos />
      <Equipos />
      <Cobertura />
      <Festivos />
    </div>
  )
}

function DatosGenerales() {
  const config = useStore((s) => s.config)
  const update = useStore((s) => s.updateConfig)
  return (
    <Card title="Datos generales">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Nombre del negocio">
          <input className={inputClass} value={config.name} onChange={(e) => update((c) => void (c.name = e.target.value))} />
        </Field>
        <Field
          label="Fecha de inicio del ciclo"
          help="Día en que el primer equipo empieza la posición 1 del patrón. El calendario se calcula hacia delante y hacia atrás desde aquí."
        >
          <input
            type="date"
            className={inputClass}
            value={config.startDate}
            onChange={(e) => e.target.value && update((c) => void (c.startDate = e.target.value))}
          />
        </Field>
      </div>
    </Card>
  )
}

function Turnos() {
  const shifts = useStore((s) => s.config.shifts)
  const update = useStore((s) => s.updateConfig)

  const addShift = () =>
    update((c) => {
      const id = uid()
      c.shifts.push({
        id,
        code: String.fromCharCode(65 + c.shifts.length),
        name: 'Nuevo turno',
        start: '08:00',
        end: '16:00',
        color: DEFAULT_COLORS[c.shifts.length % DEFAULT_COLORS.length],
        isNight: false,
      })
      c.coverage.push({ shiftId: id, min: 1, weekdays: [0, 1, 2, 3, 4, 5, 6] })
    })

  const removeShift = (id: string) => {
    if (!confirm('¿Eliminar este turno? Los días del patrón con este turno pasarán a ser libres.')) return
    update((c) => {
      c.shifts = c.shifts.filter((s) => s.id !== id)
      c.pattern = c.pattern.map((p) => (p === id ? OFF : p))
      c.coverage = c.coverage.filter((r) => r.shiftId !== id)
      c.exceptions = c.exceptions.filter((x) => x.shiftId !== id)
    })
  }

  return (
    <Card title="Turnos" actions={<Button onClick={addShift}>+ Añadir turno</Button>}>
      <p className="mb-3 text-sm text-slate-600">
        La letra <b>L</b> está reservada para los días libres. Si la hora de fin es anterior a la de inicio, el turno acaba al día
        siguiente. «Máx. días/semana» mira bloques fijos de 7 días; «Máx. días seguidos» cuenta de un día para otro aunque cambie de
        semana (evita, por ejemplo, que dos semanas de mañana consecutivas se junten en un bloque más largo de lo que quieres). Vacío
        en cualquiera de los dos = sin límite.
      </p>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-left text-slate-500">
            <tr>
              <th className="p-1">Letra</th>
              <th className="p-1">Nombre</th>
              <th className="p-1">Inicio</th>
              <th className="p-1">Fin</th>
              <th className="p-1">Horas</th>
              <th className="p-1">Nocturno</th>
              <th className="p-1" title="Máximo de días por semana en este turno (mira bloques fijos de 7 días)">Máx. días/semana</th>
              <th className="p-1" title="Máximo de días SEGUIDOS en este turno, aunque pase de una semana a la siguiente">Máx. días seguidos</th>
              <th className="p-1">Color</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {shifts.map((s, i) => {
              const set = (fn: (sh: (typeof shifts)[number]) => void) => update((c) => fn(c.shifts[i]))
              const duplicated = shifts.some((o) => o.id !== s.id && o.code.toUpperCase() === s.code.toUpperCase())
              const reserved = s.code.toUpperCase() === 'L'
              return (
                <tr key={s.id} className="border-t border-slate-100">
                  <td className="p-1">
                    <input
                      className={`${inputClass} w-14 text-center uppercase ${duplicated || reserved ? 'border-red-500' : ''}`}
                      maxLength={3}
                      value={s.code}
                      title={reserved ? 'L está reservada para libre' : duplicated ? 'Letra repetida' : ''}
                      onChange={(e) => set((sh) => void (sh.code = e.target.value.toUpperCase()))}
                    />
                  </td>
                  <td className="p-1">
                    <input className={`${inputClass} w-32`} value={s.name} onChange={(e) => set((sh) => void (sh.name = e.target.value))} />
                  </td>
                  <td className="p-1">
                    <input type="time" className={inputClass} value={s.start} onChange={(e) => set((sh) => void (sh.start = e.target.value))} />
                  </td>
                  <td className="p-1">
                    <input type="time" className={inputClass} value={s.end} onChange={(e) => set((sh) => void (sh.end = e.target.value))} />
                  </td>
                  <td className="p-1 text-slate-600">{shiftHours(s)} h</td>
                  <td className="p-1 text-center">
                    <input type="checkbox" checked={s.isNight} onChange={(e) => set((sh) => void (sh.isNight = e.target.checked))} />
                  </td>
                  <td className="p-1">
                    <input
                      type="number"
                      min={0}
                      max={7}
                      className={`${inputClass} w-20`}
                      placeholder="Sin límite"
                      value={s.maxDaysPerWeek ?? ''}
                      onChange={(e) =>
                        set((sh) => void (sh.maxDaysPerWeek = e.target.value === '' ? null : Math.max(0, e.target.valueAsNumber || 0)))
                      }
                    />
                  </td>
                  <td className="p-1">
                    <input
                      type="number"
                      min={1}
                      className={`${inputClass} w-20`}
                      placeholder="Sin límite"
                      value={s.maxConsecutiveDays ?? ''}
                      onChange={(e) =>
                        set(
                          (sh) => void (sh.maxConsecutiveDays = e.target.value === '' ? null : Math.max(1, e.target.valueAsNumber || 1)),
                        )
                      }
                    />
                  </td>
                  <td className="p-1">
                    <input type="color" value={s.color} onChange={(e) => set((sh) => void (sh.color = e.target.value))} />
                  </td>
                  <td className="p-1 text-right">
                    <Button variant="ghost" onClick={() => removeShift(s.id)} aria-label={`Eliminar ${s.name}`}>
                      ✕
                    </Button>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </Card>
  )
}

function Equipos() {
  const teams = useStore((s) => s.config.teams)
  const update = useStore((s) => s.updateConfig)
  const [count, setCount] = useState(teams.length || 7)
  const [perTeam, setPerTeam] = useState(teams[0]?.employees.length || 4)
  const total = teams.reduce((a, t) => a + t.employees.length, 0)

  const generate = () => {
    if (!confirm(`Se sustituirán los equipos actuales por ${count} equipos de ${perTeam} personas. ¿Continuar?`)) return
    update((c) => {
      c.teams = makeTeams(count, perTeam)
      c.exceptions = []
    })
  }

  const removeEmployee = (teamIdx: number, empId: string) =>
    update((c) => {
      c.teams[teamIdx].employees = c.teams[teamIdx].employees.filter((e) => e.id !== empId)
      c.exceptions = c.exceptions.filter((x) => x.employeeId !== empId && x.otherEmployeeId !== empId)
    })

  const moveEmployee = (fromIdx: number, empId: string, toIdx: number) =>
    update((c) => {
      const emp = c.teams[fromIdx].employees.find((e) => e.id === empId)
      if (!emp) return
      c.teams[fromIdx].employees = c.teams[fromIdx].employees.filter((e) => e.id !== empId)
      c.teams[toIdx].employees.push(emp)
    })

  return (
    <Card
      title={`Equipos (${teams.length} equipos, ${total} personas)`}
      actions={
        <Button
          onClick={() =>
            update((c) => void c.teams.push({ id: uid(), name: `Equipo ${c.teams.length + 1}`, offset: 0, employees: [] }))
          }
        >
          + Añadir equipo
        </Button>
      }
    >
      <div className="mb-4 flex flex-wrap items-end gap-3 rounded-lg bg-slate-50 p-3">
        <Field label="Nº de equipos">
          <NumberInput value={count} min={1} onChange={setCount} />
        </Field>
        <Field label="Personas por equipo">
          <NumberInput value={perTeam} min={1} onChange={setPerTeam} />
        </Field>
        <Button onClick={generate}>Crear equipos</Button>
        <span className="text-xs text-slate-500">Los equipos pueden tener tamaños distintos: añade o quita personas abajo.</span>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {teams.map((team, t) => (
          <div key={team.id} className="rounded-lg border border-slate-200 p-3">
            <div className="mb-2 flex items-center gap-2">
              <input
                className={`${inputClass} flex-1 font-semibold`}
                value={team.name}
                onChange={(e) => update((c) => void (c.teams[t].name = e.target.value))}
              />
              <Button
                variant="ghost"
                aria-label={`Eliminar ${team.name}`}
                onClick={() => {
                  if (!confirm(`¿Eliminar ${team.name} y sus ${team.employees.length} personas?`)) return
                  update((c) => {
                    const ids = new Set(c.teams[t].employees.map((e) => e.id))
                    c.teams.splice(t, 1)
                    c.exceptions = c.exceptions.filter((x) => !ids.has(x.employeeId) && !ids.has(x.otherEmployeeId ?? ''))
                  })
                }}
              >
                ✕
              </Button>
            </div>
            <ul className="flex flex-col gap-1">
              {team.employees.map((e, i) => (
                <li key={e.id} className="flex items-center gap-1">
                  <input
                    className={`${inputClass} min-w-0 flex-1`}
                    value={e.name}
                    onChange={(ev) => update((c) => void (c.teams[t].employees[i].name = ev.target.value))}
                  />
                  <select
                    className={`${inputClass} w-10 px-1`}
                    title="Mover a otro equipo"
                    value=""
                    onChange={(ev) => ev.target.value && moveEmployee(t, e.id, Number(ev.target.value))}
                  >
                    <option value="">⇄</option>
                    {teams.map((o, oi) =>
                      oi === t ? null : (
                        <option key={o.id} value={oi}>
                          Mover a {o.name}
                        </option>
                      ),
                    )}
                  </select>
                  <Button variant="ghost" className="px-2" onClick={() => removeEmployee(t, e.id)} aria-label={`Quitar ${e.name}`}>
                    ✕
                  </Button>
                </li>
              ))}
            </ul>
            <Button
              variant="ghost"
              className="mt-2"
              onClick={() => update((c) => void c.teams[t].employees.push({ id: uid(), name: `Persona ${total + 1}` }))}
            >
              + Añadir persona
            </Button>
          </div>
        ))}
      </div>
    </Card>
  )
}

function Cobertura() {
  const config = useStore((s) => s.config)
  const update = useStore((s) => s.updateConfig)
  const unit = config.coverageMode === 'equipos' ? 'equipos' : 'personas'
  return (
    <Card title="Cobertura mínima">
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <Field label="¿Cómo se mide la cobertura?">
          <select
            className={inputClass}
            value={config.coverageMode}
            onChange={(e) => update((c) => void (c.coverageMode = e.target.value as typeof c.coverageMode))}
          >
            <option value="equipos">Por equipos (nº de equipos en cada turno)</option>
            <option value="personas">Por personas (nº de personas en cada turno)</option>
          </select>
        </Field>
      </div>
      <p className="mb-2 text-sm text-slate-600">
        Indica cuántos {unit} necesita como mínimo cada turno y qué días. Todos los días marcados = abierto 24/7, 365 días.
        Pon 0 si un turno no necesita cobertura.
      </p>
      <div className="overflow-x-auto">
        <table className="text-sm">
          <tbody>
            {config.shifts.map((s) => {
              const idx = config.coverage.findIndex((r) => r.shiftId === s.id)
              const req = config.coverage[idx] ?? { shiftId: s.id, min: 0, weekdays: [] }
              const set = (fn: (r: typeof req) => void) =>
                update((c) => {
                  let r = c.coverage.find((x) => x.shiftId === s.id)
                  if (!r) c.coverage.push((r = { shiftId: s.id, min: 0, weekdays: [0, 1, 2, 3, 4, 5, 6] }))
                  fn(r)
                })
              return (
                <tr key={s.id} className="border-t border-slate-100">
                  <td className="p-1 pr-3 font-medium">{s.name}</td>
                  <td className="p-1 pr-3">
                    <span className="flex items-center gap-1">
                      mín. <NumberInput className="w-16" min={0} value={req.min} onChange={(v) => set((r) => void (r.min = v))} /> {unit}
                    </span>
                  </td>
                  <td className="p-1">
                    <span className="flex gap-1">
                      {WEEKDAY_SHORT.map((d, wd) => {
                        const on = req.weekdays.includes(wd)
                        return (
                          <button
                            key={wd}
                            type="button"
                            className={`h-7 w-7 rounded text-xs font-semibold ${on ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-500'}`}
                            onClick={() =>
                              set((r) => void (r.weekdays = on ? r.weekdays.filter((x) => x !== wd) : [...r.weekdays, wd].sort()))
                            }
                          >
                            {d}
                          </button>
                        )
                      })}
                    </span>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </Card>
  )
}

function Festivos() {
  const holidays = useStore((s) => s.config.holidays)
  const update = useStore((s) => s.updateConfig)
  const [date, setDate] = useState('')
  const [name, setName] = useState('')
  return (
    <Card title="Festivos">
      <p className="mb-3 text-sm text-slate-600">
        De momento los festivos se marcan en el calendario y en las exportaciones; la rotación no cambia.
      </p>
      <div className="mb-3 flex flex-wrap items-end gap-2">
        <Field label="Fecha">
          <input type="date" className={inputClass} value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>
        <Field label="Nombre">
          <input className={inputClass} value={name} placeholder="Ej.: Navidad" onChange={(e) => setName(e.target.value)} />
        </Field>
        <Button
          disabled={!date}
          onClick={() => {
            update((c) => {
              c.holidays = [...c.holidays.filter((h) => h.date !== date), { date, name: name || 'Festivo' }].sort((a, b) =>
                a.date.localeCompare(b.date),
              )
            })
            setDate('')
            setName('')
          }}
        >
          + Añadir festivo
        </Button>
      </div>
      {holidays.length > 0 && (
        <ul className="flex flex-wrap gap-2 text-sm">
          {holidays.map((h) => (
            <li key={h.date} className="flex items-center gap-1 rounded-full bg-rose-50 px-3 py-1 text-rose-800">
              {formatDate(h.date)} · {h.name}
              <button
                type="button"
                className="ml-1 text-rose-500"
                aria-label="Quitar festivo"
                onClick={() => update((c) => void (c.holidays = c.holidays.filter((x) => x.date !== h.date)))}
              >
                ✕
              </button>
            </li>
          ))}
        </ul>
      )}
    </Card>
  )
}
