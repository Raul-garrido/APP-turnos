// Prepara los datos del cuadrante en forma de tabla para exportarlos a Excel o PDF.

import { buildSchedule } from '../engine/calendar'
import { addMonths, daysInMonth, formatDate, MONTH_NAMES, WEEKDAY_SHORT } from '../engine/dates'
import { findShift, shiftHours } from '../engine/shifts'
import type { BusinessConfig, ISODate } from '../engine/types'
import { cellDisplay } from '../store/derived'

export const DISCLAIMER =
  'Aviso: esta herramienta organiza turnos según los parámetros introducidos por el usuario. No es asesoría legal ni garantiza ' +
  'el cumplimiento normativo. La verificación del convenio aplicable es responsabilidad del usuario.'

export interface ExportCell {
  code: string
  color: string
  changed: boolean
}

export interface ExportSheet {
  title: string
  dates: ISODate[]
  headers: string[]
  holidays: boolean[]
  rows: { team: string; name: string; cells: ExportCell[] }[]
  coverage: { label: string; values: number[]; ok: boolean[] }[]
}

export function buildSheet(config: BusinessConfig, from: ISODate, to: ISODate, title: string): ExportSheet {
  const days = buildSchedule(config, from, to)
  const unit = config.coverageMode === 'equipos' ? 'equipos' : 'personas'
  return {
    title,
    dates: days.map((d) => d.date),
    headers: days.map((d) => `${WEEKDAY_SHORT[d.weekday]} ${d.date.slice(8)}`),
    holidays: days.map((d) => !!d.holiday),
    rows: config.teams.flatMap((team) =>
      team.employees.map((e) => ({
        team: team.name,
        name: e.name,
        cells: days.map((d) => ({ ...cellDisplay(config, d.cells[e.id]), changed: d.cells[e.id].changed })),
      })),
    ),
    coverage: config.coverage
      .filter((r) => r.min > 0)
      .map((r) => ({
        label: `${findShift(config.shifts, r.shiftId)?.name ?? ''} (${unit})`,
        values: days.map((d) => {
          const c = d.coverage.find((x) => x.shiftId === r.shiftId)!
          return config.coverageMode === 'equipos' ? c.teams : c.persons
        }),
        ok: days.map((d) => d.coverage.find((x) => x.shiftId === r.shiftId)!.ok),
      })),
  }
}

/** Una hoja por mes si se exporta un año; una sola hoja si es una semana o un mes. */
export function buildSheets(config: BusinessConfig, from: ISODate, to: ISODate, yearly: boolean): ExportSheet[] {
  if (!yearly) return [buildSheet(config, from, to, `${formatDate(from)} – ${formatDate(to)}`)]
  const sheets: ExportSheet[] = []
  for (let m = from; m <= to; m = addMonths(m, 1)) {
    const [y, mo] = m.split('-').map(Number)
    const end = `${m.slice(0, 8)}${String(daysInMonth(y, mo)).padStart(2, '0')}`
    sheets.push(buildSheet(config, m, end, `${MONTH_NAMES[mo - 1]} ${y}`))
  }
  return sheets
}

export function legend(config: BusinessConfig): string {
  return [
    ...config.shifts.map((s) => `${s.code} = ${s.name} (${s.start}–${s.end}, ${shiftHours(s)} h)`),
    'L = Libre',
    'V = Vacaciones',
    'B = Baja',
    'P = Permiso',
  ].join('   ·   ')
}

export function fileName(config: BusinessConfig, from: ISODate, to: ISODate, ext: string) {
  const safe = config.name.replace(/[^\w\-áéíóúñ ]/gi, '').trim() || 'cuadrante'
  return `${safe} ${from} a ${to}.${ext}`
}
