import { OFF, type PatternItem, type Shift } from './types'

/** Convierte 'HH:MM' en minutos desde medianoche. */
export function parseTime(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number)
  return (h || 0) * 60 + (m || 0)
}

/** Duración del turno en minutos. Si acaba antes (o a la misma hora) que empieza, cruza la medianoche. */
export function shiftDurationMinutes(shift: Shift): number {
  const start = parseTime(shift.start)
  let end = parseTime(shift.end)
  if (end <= start) end += 24 * 60
  return end - start
}

export function shiftHours(shift: Shift): number {
  return shiftDurationMinutes(shift) / 60
}

export function findShift(shifts: Shift[], item: PatternItem): Shift | undefined {
  if (item === OFF) return undefined
  return shifts.find((s) => s.id === item)
}

/** Código corto de un elemento del patrón ('L' para libre). */
export function itemCode(shifts: Shift[], item: PatternItem): string {
  if (item === OFF) return 'L'
  return findShift(shifts, item)?.code ?? '?'
}

/**
 * Convierte un texto como "M M T T N N L L L L" (o "MMTTNNLLLL") en un patrón.
 * Devuelve también los códigos que no se han reconocido.
 */
export function parsePatternText(text: string, shifts: Shift[]): { pattern: PatternItem[]; unknown: string[] } {
  const codes = shifts.map((s) => s.code.toUpperCase())
  const tokens = /[\s,;-]/.test(text.trim())
    ? text.split(/[\s,;-]+/).filter(Boolean)
    : text.trim().split('')
  const pattern: PatternItem[] = []
  const unknown: string[] = []
  for (const raw of tokens) {
    const t = raw.toUpperCase()
    if (t === 'L') pattern.push(OFF)
    else {
      const idx = codes.indexOf(t)
      if (idx >= 0) pattern.push(shifts[idx].id)
      else unknown.push(raw)
    }
  }
  return { pattern, unknown }
}
