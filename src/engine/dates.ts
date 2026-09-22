// Utilidades de fechas. Trabajamos con "número de día" (días desde 1970-01-01 en UTC)
// para evitar problemas de zonas horarias y cambios de hora.

import type { ISODate } from './types'

const MS_PER_DAY = 86_400_000

export function toDayNumber(date: ISODate): number {
  const [y, m, d] = date.split('-').map(Number)
  return Math.floor(Date.UTC(y, m - 1, d) / MS_PER_DAY)
}

export function fromDayNumber(day: number): ISODate {
  return new Date(day * MS_PER_DAY).toISOString().slice(0, 10)
}

export function addDays(date: ISODate, days: number): ISODate {
  return fromDayNumber(toDayNumber(date) + days)
}

export function diffDays(a: ISODate, b: ISODate): number {
  return toDayNumber(a) - toDayNumber(b)
}

/** Día de la semana: 0 = lunes ... 6 = domingo. */
export function weekday(date: ISODate): number {
  // 1970-01-01 fue jueves (3 si lunes = 0).
  return mod(toDayNumber(date) + 3, 7)
}

export function startOfWeek(date: ISODate): ISODate {
  return addDays(date, -weekday(date))
}

export function startOfMonth(date: ISODate): ISODate {
  return date.slice(0, 8) + '01'
}

export function daysInMonth(year: number, month1to12: number): number {
  return new Date(Date.UTC(year, month1to12, 0)).getUTCDate()
}

export function addMonths(date: ISODate, months: number): ISODate {
  const [y, m] = date.split('-').map(Number)
  const total = y * 12 + (m - 1) + months
  const ny = Math.floor(total / 12)
  const nm = mod(total, 12) + 1
  return `${ny}-${String(nm).padStart(2, '0')}-01`
}

/** Lista de fechas desde `from` hasta `to`, ambas incluidas. */
export function dateRange(from: ISODate, to: ISODate): ISODate[] {
  const out: ISODate[] = []
  for (let d = toDayNumber(from); d <= toDayNumber(to); d++) out.push(fromDayNumber(d))
  return out
}

export function todayISO(): ISODate {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
}

/** Módulo que siempre devuelve un número positivo (en JS, -1 % 10 = -1). */
export function mod(n: number, m: number): number {
  return ((n % m) + m) % m
}

export const WEEKDAY_SHORT = ['L', 'M', 'X', 'J', 'V', 'S', 'D']
export const WEEKDAY_NAMES = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo']
export const MONTH_NAMES = [
  'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre',
]

export function formatDate(date: ISODate): string {
  const [y, m, d] = date.split('-')
  return `${d}/${m}/${y}`
}
