// Generación del calendario: aplica el patrón a cada equipo con su desfase
// y después las excepciones puntuales (vacaciones, bajas, cambios, intercambios).

import { dateRange, diffDays, mod, weekday } from './dates'
import { computeOffsets, requiredOn, type OffsetResult } from './offsets'
import { HOLIDAY_TREATMENT, VACATION_TYPE } from './rules'
import { findShift, shiftDurationMinutes } from './shifts'
import {
  OFF,
  type AbsenceKind,
  type BusinessConfig,
  type EffectiveRules,
  type Holiday,
  type ISODate,
  type PatternItem,
  type ScheduleException,
} from './types'

export const ABSENCE_KINDS: AbsenceKind[] = ['vacaciones', 'baja', 'permiso']

export const EXCEPTION_LABELS: Record<ScheduleException['kind'], string> = {
  vacaciones: 'Vacaciones',
  baja: 'Baja',
  permiso: 'Permiso',
  intercambio: 'Intercambio de turno',
  cambio: 'Cambio de turno',
}

export const ABSENCE_CODES: Record<AbsenceKind, string> = { vacaciones: 'V', baja: 'B', permiso: 'P' }

export interface Cell {
  /** Lo que hace la persona ese día después de aplicar excepciones (turno u OFF). */
  item: PatternItem
  /** Lo que le tocaba según el patrón. */
  base: PatternItem
  absence?: AbsenceKind
  /** La celda ha cambiado respecto al patrón por una excepción. */
  changed: boolean
  exceptionIds: string[]
}

export interface ShiftCoverage {
  shiftId: string
  persons: number
  teams: number
  required: number
  ok: boolean
  /** Equipos que tenían este turno pero les falta alguien. */
  reducedTeams: string[]
}

export interface DaySchedule {
  date: ISODate
  weekday: number
  holiday?: Holiday
  cells: Record<string, Cell>
  coverage: ShiftCoverage[]
}

const offsetCache = new Map<string, OffsetResult>()

/** Resultado del cálculo automático de desfases (se guarda en caché). */
export function autoOffsets(config: BusinessConfig): OffsetResult {
  const input = {
    pattern: config.pattern,
    teams: config.teams,
    coverage: config.coverage,
    coverageMode: config.coverageMode,
    startWeekday: weekday(config.startDate),
  }
  const key = JSON.stringify([
    input.pattern,
    input.teams.map((t) => t.employees.length),
    input.coverage,
    input.coverageMode,
    input.startWeekday,
  ])
  let res = offsetCache.get(key)
  if (!res) {
    res = computeOffsets(input)
    if (offsetCache.size > 50) offsetCache.clear()
    offsetCache.set(key, res)
  }
  return res
}

/** Desfases que se usan de verdad: los automáticos o los que ha escrito el usuario. */
export function effectiveOffsets(config: BusinessConfig): number[] {
  if (config.offsetMode === 'manual') {
    const L = config.pattern.length || 1
    return config.teams.map((t) => mod(Math.round(t.offset || 0), L))
  }
  return autoOffsets(config).offsets
}

/** Lo que le toca a un equipo una fecha según el patrón. */
export function baseItem(config: BusinessConfig, offset: number, date: ISODate): PatternItem {
  const L = config.pattern.length
  if (!L) return OFF
  return config.pattern[mod(diffDays(date, config.startDate) - offset, L)]
}

export function buildSchedule(config: BusinessConfig, from: ISODate, to: ISODate, offsets = effectiveOffsets(config)) {
  const dates = dateRange(from, to)
  const teamOf = new Map<string, number>()
  config.teams.forEach((t, i) => t.employees.forEach((e) => teamOf.set(e.id, i)))

  return dates.map<DaySchedule>((date) => {
    const cells: Record<string, Cell> = {}
    config.teams.forEach((team, t) => {
      const item = baseItem(config, offsets[t], date)
      for (const e of team.employees) cells[e.id] = { item, base: item, changed: false, exceptionIds: [] }
    })

    const active = config.exceptions.filter((x) => x.from <= date && date <= x.to)
    // Orden: intercambios, después cambios, y al final ausencias (una ausencia siempre manda).
    for (const x of active.filter((x) => x.kind === 'intercambio')) {
      const a = cells[x.employeeId]
      const b = x.otherEmployeeId ? cells[x.otherEmployeeId] : undefined
      if (!a || !b) continue
      const tmp = a.item
      a.item = b.item
      b.item = tmp
      for (const c of [a, b]) {
        c.changed = c.item !== c.base
        c.exceptionIds.push(x.id)
      }
    }
    for (const x of active.filter((x) => x.kind === 'cambio')) {
      const c = cells[x.employeeId]
      if (!c || !x.shiftId) continue
      c.item = x.shiftId
      c.changed = c.item !== c.base
      c.exceptionIds.push(x.id)
    }
    for (const x of active.filter((x) => (ABSENCE_KINDS as string[]).includes(x.kind))) {
      const c = cells[x.employeeId]
      if (!c) continue
      c.absence = x.kind as AbsenceKind
      c.item = OFF
      c.changed = true
      c.exceptionIds.push(x.id)
    }

    const wd = weekday(date)
    const coverage = config.coverage.map<ShiftCoverage>((req) => {
      let persons = 0
      let teams = 0
      const reducedTeams: string[] = []
      config.teams.forEach((team, t) => {
        const base = baseItem(config, offsets[t], date)
        const working = team.employees.filter((e) => cells[e.id]?.item === req.shiftId).length
        persons += working
        if (base === req.shiftId) {
          if (working > 0) teams++
          if (working < team.employees.length) reducedTeams.push(team.name)
        } else if (working > 0 && working >= team.employees.length) {
          teams++
        }
      })
      const required = requiredOn(req, wd)
      const have = config.coverageMode === 'equipos' ? teams : persons
      return { shiftId: req.shiftId, persons, teams, required, ok: have >= required, reducedTeams }
    })

    return { date, weekday: wd, holiday: config.holidays.find((h) => h.date === date), cells, coverage }
  })
}

/**
 * Días de vacaciones que ha usado una persona en un año.
 * Naturales: todos los días del periodo. Hábiles: solo los días que le tocaba trabajar.
 */
export function vacationDaysUsed(
  config: BusinessConfig,
  employeeId: string,
  year: number,
  habiles: boolean,
  offsets = effectiveOffsets(config),
): number {
  const t = config.teams.findIndex((team) => team.employees.some((e) => e.id === employeeId))
  if (t < 0) return 0
  const days = new Set<ISODate>()
  for (const x of config.exceptions) {
    if (x.kind !== 'vacaciones' || x.employeeId !== employeeId) continue
    for (const d of dateRange(x.from, x.to)) {
      if (!d.startsWith(String(year))) continue
      if (habiles && baseItem(config, offsets[t], d) === OFF) continue
      days.add(d)
    }
  }
  return days.size
}

export interface AnnualBalanceRow {
  teamId: string
  /** Días y horas de trabajo que salen del cuadrante en ese año. */
  workDays: number
  workHours: number
  /** Festivos que caen en día de trabajo del equipo. */
  holidaysOnWork: number
  /** Días de trabajo que se pierden por vacaciones (estimación según el convenio). */
  vacationWorkDays: number
  /** Días y horas efectivos: trabajo − vacaciones − festivos (si se libran). */
  effectiveDays: number
  effectiveHours: number
  /** Diferencia con la jornada anual (positivo = exceso a dar libre; negativo = faltan). */
  excessDays: number | null
  excessHours: number | null
}

export interface AnnualBalance {
  year: number
  rows: AnnualBalanceRow[]
  /** true si se usan las fechas de festivos introducidas; false si se estima con el número de festivos al año. */
  realHolidays: boolean
  holidayCount: number
  holidaysOff: boolean
}

/** Balance de jornada anual de cada equipo para un año concreto del calendario. */
export function annualBalance(
  config: BusinessConfig,
  rules: EffectiveRules,
  year: number,
  offsets = effectiveOffsets(config),
): AnnualBalance {
  const dates = dateRange(`${year}-01-01`, `${year}-12-31`)
  const yearHolidays = config.holidays.filter((h) => h.date.startsWith(String(year)))
  const realHolidays = yearHolidays.length > 0
  const holidayCount = realHolidays ? yearHolidays.length : (rules.annualHolidays ?? 0)
  const holidaysOff = rules.holidayTreatment === HOLIDAY_TREATMENT.SE_LIBRAN
  const holidaySet = new Set(yearHolidays.map((h) => h.date))
  const round1 = (n: number) => Math.round(n * 10) / 10

  const rows = config.teams.map<AnnualBalanceRow>((team, t) => {
    let workDays = 0
    let minutes = 0
    let holidaysOnWork = 0
    for (const d of dates) {
      const s = findShift(config.shifts, baseItem(config, offsets[t], d))
      if (!s) continue
      workDays++
      minutes += shiftDurationMinutes(s)
      if (holidaySet.has(d)) holidaysOnWork++
    }
    const ratio = workDays / dates.length
    if (!realHolidays) holidaysOnWork = Math.round(holidayCount * ratio)
    const vacation = rules.vacationDays ?? 0
    const vacationWorkDays = Math.round(rules.vacationDayType === VACATION_TYPE.HABILES ? vacation : vacation * ratio)
    const hoursPerDay = workDays ? minutes / 60 / workDays : 0
    const effectiveDays = Math.max(workDays - vacationWorkDays - (holidaysOff ? holidaysOnWork : 0), 0)
    const effectiveHours = Math.round(effectiveDays * hoursPerDay)
    return {
      teamId: team.id,
      workDays,
      workHours: round1(minutes / 60),
      holidaysOnWork,
      vacationWorkDays,
      effectiveDays,
      effectiveHours,
      excessDays: rules.maxAnnualWorkDays != null ? effectiveDays - rules.maxAnnualWorkDays : null,
      excessHours: rules.maxAnnualHours != null ? effectiveHours - rules.maxAnnualHours : null,
    }
  })
  return { year, rows, realHolidays, holidayCount, holidaysOff }
}
