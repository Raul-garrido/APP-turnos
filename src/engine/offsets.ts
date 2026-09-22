// Cálculo de desfases entre equipos.
//
// Cada equipo sigue el mismo patrón pero con un retraso ("desfase") en días.
// El día D (contando desde la fecha de inicio), el equipo con desfase `o`
// está en la posición (D - o) del ciclo.
//
// Buscamos los desfases que garantizan la cobertura mínima de cada turno todos los días.
// Si hay pocas combinaciones las probamos todas; si hay muchas, usamos una búsqueda
// por mejora sucesiva (muy rápida y casi siempre encuentra la mejor).

import { mod } from './dates'
import { OFF, type CoverageMode, type CoverageRequirement, type PatternItem, type Team } from './types'

export interface OffsetInput {
  pattern: PatternItem[]
  teams: Team[]
  coverage: CoverageRequirement[]
  coverageMode: CoverageMode
  /** Día de la semana de la fecha de inicio (0 = lunes). */
  startWeekday: number
}

export interface ShiftFeasibility {
  shiftId: string
  required: number
  /** Media de equipos/personas que puede haber en ese turno cada día con este patrón. */
  averageAvailable: number
  possible: boolean
}

export interface OffsetResult {
  offsets: number[]
  /** Suma de huecos de cobertura en un periodo completo (0 = cobertura garantizada). */
  deficit: number
  feasibility: ShiftFeasibility[]
  /** Días que se han evaluado (el ciclo, o más si la cobertura depende del día de la semana). */
  periodDays: number
  exhaustive: boolean
}

const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b))

/** Peso de cada equipo en la cobertura: 1 si contamos equipos, nº de personas si contamos personas. */
export function teamWeights(teams: Team[], mode: CoverageMode): number[] {
  return teams.map((t) => (mode === 'equipos' ? 1 : t.employees.length))
}

/** Número de días necesario para que el patrón y la semana vuelvan a coincidir. */
export function coveragePeriod(L: number, coverage: CoverageRequirement[]): number {
  const dependsOnWeekday = coverage.some((c) => c.min > 0 && c.weekdays.length > 0 && c.weekdays.length < 7)
  return dependsOnWeekday ? (L * 7) / gcd(L, 7) : L
}

/** Cobertura (equipos o personas) de cada turno, cada día del periodo. */
export function coverageTable(input: OffsetInput, offsets: number[], days: number): Map<string, number[]> {
  const { pattern, teams, coverageMode } = input
  const L = pattern.length
  const weights = teamWeights(teams, coverageMode)
  const table = new Map<string, number[]>()
  for (const c of input.coverage) table.set(c.shiftId, new Array(days).fill(0))
  for (let d = 0; d < days; d++) {
    for (let t = 0; t < teams.length; t++) {
      const item = pattern[mod(d - offsets[t], L)]
      if (item === OFF) continue
      const row = table.get(item)
      if (row) row[d] += weights[t]
    }
  }
  return table
}

export function requiredOn(req: CoverageRequirement, weekday: number): number {
  return req.weekdays.includes(weekday) ? req.min : 0
}

export function computeOffsets(input: OffsetInput): OffsetResult {
  const { pattern, teams, coverage, coverageMode, startWeekday } = input
  const L = pattern.length
  const N = teams.length
  const weights = teamWeights(teams, coverageMode)
  const active = coverage.filter((c) => c.min > 0 && c.weekdays.length > 0)
  const periodDays = L ? coveragePeriod(L, active) : 0

  // Comprobación rápida de viabilidad: media disponible frente a lo requerido.
  const totalWeight = weights.reduce((a, b) => a + b, 0)
  const feasibility: ShiftFeasibility[] = active.map((c) => {
    const count = pattern.filter((p) => p === c.shiftId).length
    const averageAvailable = L ? (totalWeight * count) / L : 0
    return { shiftId: c.shiftId, required: c.min, averageAvailable, possible: averageAvailable + 1e-9 >= c.min }
  })

  if (L === 0 || N === 0) {
    return { offsets: teams.map(() => 0), deficit: 0, feasibility, periodDays, exhaustive: true }
  }

  // Precalculamos, para cada turno requerido y cada desfase posible, en qué días del periodo trabaja un equipo.
  const reqIdx = active.map((c) => c.shiftId)
  const required: number[][] = active.map((c) =>
    Array.from({ length: periodDays }, (_, d) => requiredOn(c, mod(startWeekday + d, 7))),
  )
  // onShift[o][d] = índice del turno requerido que hace un equipo con desfase o el día d (-1 si ninguno).
  const onShift: Int16Array[] = Array.from({ length: L }, (_, o) => {
    const arr = new Int16Array(periodDays)
    for (let d = 0; d < periodDays; d++) arr[d] = reqIdx.indexOf(pattern[mod(d - o, L)])
    return arr
  })

  const S = active.length
  const counts = new Float64Array(S * periodDays)
  // Puntuación: primero minimizar huecos; después repartir lo que sobra de forma equilibrada.
  const score = (offs: number[]): [number, number] => {
    counts.fill(0)
    for (let t = 0; t < N; t++) {
      const row = onShift[offs[t]]
      const w = weights[t]
      for (let d = 0; d < periodDays; d++) {
        const s = row[d]
        if (s >= 0) counts[s * periodDays + d] += w
      }
    }
    let deficit = 0
    let balance = 0
    for (let s = 0; s < S; s++) {
      for (let d = 0; d < periodDays; d++) {
        const have = counts[s * periodDays + d]
        const need = required[s][d]
        if (have < need) deficit += need - have
        balance += have * have
      }
    }
    return [deficit, balance]
  }
  const better = (a: [number, number], b: [number, number]) => a[0] < b[0] || (a[0] === b[0] && a[1] < b[1] - 1e-9)

  // El primer equipo siempre empieza en 0: desplazar todos a la vez no cambia nada.
  const equalWeights = weights.every((w) => w === weights[0])
  const combos = equalWeights ? binomial(L - 1 + N - 1, N - 1) : Math.pow(L, N - 1)
  const LIMIT = 150_000

  let best = teams.map((_, t) => Math.floor((t * L) / N))
  let bestScore = score(best)
  let exhaustive = false

  if (combos <= LIMIT) {
    exhaustive = true
    const offs = new Array(N).fill(0)
    const rec = (t: number, minVal: number) => {
      if (t === N) {
        const sc = score(offs)
        if (better(sc, bestScore)) {
          bestScore = sc
          best = offs.slice()
        }
        return
      }
      for (let o = equalWeights ? minVal : 0; o < L; o++) {
        offs[t] = o
        rec(t + 1, o)
      }
    }
    rec(1, 0)
  } else {
    // Búsqueda por mejora: probamos a mover cada equipo a cada desfase y nos quedamos con la mejora.
    const rng = seededRandom(12345)
    const starts = [best.slice()]
    for (let i = 0; i < 30; i++) starts.push([0, ...Array.from({ length: N - 1 }, () => Math.floor(rng() * L))])
    for (const start of starts) {
      const cur = start.slice()
      let curScore = score(cur)
      let improved = true
      while (improved) {
        improved = false
        for (let t = 1; t < N; t++) {
          const original = cur[t]
          for (let o = 0; o < L; o++) {
            if (o === original) continue
            cur[t] = o
            const sc = score(cur)
            if (better(sc, curScore)) {
              curScore = sc
              improved = true
              break
            }
          }
          if (!improved) cur[t] = original
          else break
        }
      }
      if (better(curScore, bestScore)) {
        bestScore = curScore
        best = cur.slice()
      }
    }
  }

  return { offsets: best, deficit: bestScore[0], feasibility, periodDays, exhaustive }
}

function binomial(n: number, k: number): number {
  let r = 1
  for (let i = 1; i <= k; i++) {
    r = (r * (n - k + i)) / i
    if (r > 1e12) return Infinity
  }
  return Math.round(r)
}

function seededRandom(seed: number) {
  let s = seed
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296
    return s / 4294967296
  }
}

/** Huecos de cobertura con unos desfases concretos (p. ej. los escritos a mano). */
export function coverageDeficit(input: OffsetInput, offsets: number[]): number {
  const L = input.pattern.length
  if (!L) return 0
  const days = coveragePeriod(L, input.coverage)
  const table = coverageTable(input, offsets, days)
  let deficit = 0
  for (const req of input.coverage) {
    const row = table.get(req.shiftId) ?? []
    row.forEach((have, d) => {
      const need = requiredOn(req, mod(input.startWeekday + d, 7))
      if (have < need) deficit += need - have
    })
  }
  return deficit
}
