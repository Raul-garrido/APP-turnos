// Búsqueda automática de un patrón que libre los máximos fines de semana completos.
//
// Idea: un ciclo de tantas semanas como equipos (7 equipos -> 7 semanas) y cada equipo
// empieza una semana después que el anterior. Así los días libres caen siempre en el mismo
// día de la semana y se pueden colocar en sábado y domingo. Cada semana del ciclo tiene un
// único tipo de turno y unos días de trabajo; la cobertura de cada día de la semana es la
// suma de todas las semanas del ciclo (porque cada semana del calendario hay un equipo en cada
// semana del ciclo).
//
// Se busca por "recocido simulado": se hacen muchos cambios pequeños al azar, se quedan los que
// mejoran y, al principio, también algunos que empeoran para no quedarse atascado.

import { mod } from './dates'
import { requiredOn } from './offsets'
import { findShift } from './shifts'
import { OFF, type BusinessConfig, type EffectiveRules, type PatternItem } from './types'
import { patternStats, validatePattern } from './validation'

export type SearchPriority = 'findes' | 'equilibrio'

export interface PatternSearchOptions {
  /** 'findes': máximos fines de semana libres; 'equilibrio': también ajustarse a la jornada anual. */
  priority: SearchPriority
  seed: number
  /** Número de cambios a probar (más = mejor resultado, más lento). */
  iterations?: number
}

export interface PatternSuggestion {
  pattern: PatternItem[]
  weeks: number
  /** Desfases (en días) que hay que usar: una semana por equipo. */
  offsets: number[]
  /** Fines de semana completos (sábado y domingo) libres por equipo al año. */
  fullWeekendsPerYear: number
  partialWeekendsPerYear: number
  /** Máximo teórico de fines de semana completos con esta cobertura. */
  maxFullWeekendsPerYear: number
  violations: number
  coverageDeficit: number
  netAnnualWorkDays: number
  netAnnualHours: number
  excessDays: number | null
  excessHours: number | null
}

interface Week {
  /** Índice del turno de la semana (en `shiftIds`). */
  shift: number
  /** Días de trabajo de la semana: bit 0 = lunes ... bit 6 = domingo. */
  mask: number
}

const SAT = 5
const SUN = 6
const WEEKS_PER_YEAR = 365.25 / 7

const bit = (mask: number, day: number) => (mask >> day) & 1

function seededRandom(seed: number) {
  let s = seed >>> 0 || 1
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296
    return s / 4294967296
  }
}

export function suggestPattern(config: BusinessConfig, rules: EffectiveRules, opts: PatternSearchOptions): PatternSuggestion | null {
  const N = config.teams.length
  const active = config.coverage.filter((c) => c.min > 0 && c.weekdays.length > 0 && findShift(config.shifts, c.shiftId))
  const shiftIds = active.map((c) => c.shiftId)
  if (N === 0 || shiftIds.length === 0) return null
  const S = shiftIds.length

  // Peso de un equipo en la cobertura (si se cuenta por personas, usamos el tamaño medio).
  const avgSize = config.teams.reduce((a, t) => a + t.employees.length, 0) / N
  const weight = config.coverageMode === 'equipos' ? 1 : avgSize
  // Lo exigido cada día de la semana (0 = lunes) en cada turno.
  const need = active.map((c) => Array.from({ length: 7 }, (_, wd) => requiredOn(c, wd)))

  // Semanas posibles: todas las combinaciones de días con al menos los días libres exigidos por semana.
  const minOff = Math.ceil(rules.minDaysOffPerWeek ?? 0)
  const masks: number[] = []
  for (let m = 0; m < 128; m++) {
    let work = 0
    for (let d = 0; d < 7; d++) work += bit(m, d)
    if (7 - work >= minOff) masks.push(m)
  }

  const toPattern = (weeks: Week[]): PatternItem[] =>
    weeks.flatMap((w) => Array.from({ length: 7 }, (_, d) => (bit(w.mask, d) ? shiftIds[w.shift] : OFF)))

  const target = rules.maxAnnualWorkDays
  const prio = opts.priority === 'findes' ? { weekend: 100, dev: 1 } : { weekend: 20, dev: 6 }

  // Cobertura por día de la semana: suma de todas las semanas del ciclo. Es barata de calcular.
  const coverageDeficitOf = (weeks: Week[]) => {
    let deficit = 0
    for (let s = 0; s < S; s++) {
      for (let d = 0; d < 7; d++) {
        let have = 0
        for (const w of weeks) if (w.shift === s && bit(w.mask, d)) have += weight
        if (have < need[s][d]) deficit += need[s][d] - have
      }
    }
    return deficit
  }

  const evaluate = (weeks: Week[], deficit = coverageDeficitOf(weeks)) => {
    let full = 0
    let partial = 0
    for (let i = 0; i < weeks.length; i++) {
      const sat = !bit(weeks[i].mask, SAT)
      const sun = !bit(weeks[i].mask, SUN)
      if (sat && sun) full++
      else if (sat || sun) partial++
    }
    const pattern = toPattern(weeks)
    // Preferimos bloques de trabajo seguidos: penalizamos cada vez que se corta el trabajo.
    let blocks = 0
    for (let d = 0; d < pattern.length; d++) if (pattern[d] !== OFF && pattern[mod(d - 1, pattern.length)] === OFF) blocks++
    const { violations } = validatePattern(pattern, config.shifts, rules)
    const stats = patternStats(pattern, config.shifts, rules)
    const dev = target != null ? Math.abs(stats.netAnnualWorkDays - target) : 0
    const cost =
      deficit * 10_000 + violations.length * 1_000 - full * prio.weekend - partial * 5 + dev * prio.dev + blocks * 2
    return { cost, deficit, violations: violations.length, full, partial, stats }
  }

  const rng = seededRandom(opts.seed)
  const pick = <T,>(arr: T[]) => arr[Math.floor(rng() * arr.length)]
  const randomWeek = (): Week => ({ shift: Math.floor(rng() * S), mask: pick(masks) })

  const mutate = (weeks: Week[]): Week[] => {
    const next = weeks.map((w) => ({ ...w }))
    const r = rng()
    const i = Math.floor(rng() * N)
    if (r < 0.35) {
      // Cambiar un día de la semana (trabajo <-> libre), si sigue siendo una semana válida.
      const m = next[i].mask ^ (1 << Math.floor(rng() * 7))
      if (masks.includes(m)) next[i].mask = m
    } else if (r < 0.55) {
      next[i].shift = Math.floor(rng() * S)
    } else if (r < 0.75) {
      const j = Math.floor(rng() * N)
      ;[next[i], next[j]] = [next[j], next[i]]
    } else if (r < 0.9) {
      next[i].mask = pick(masks)
    } else {
      next[i] = randomWeek()
    }
    return next
  }

  // Punto de partida razonable: semanas de lunes a viernes rotando los turnos, alguna con fin de semana.
  const initial = (): Week[] =>
    Array.from({ length: N }, (_, i) => ({ shift: i % S, mask: i % 2 ? 0b0011111 : pick(masks) }))

  const iterations = opts.iterations ?? 12_000
  const restarts = 3
  let best = initial()
  let bestEval = evaluate(best)
  for (let r = 0; r < restarts; r++) {
    let cur = r === 0 ? best : initial()
    let curEval = evaluate(cur)
    const steps = Math.floor(iterations / restarts)
    for (let k = 0; k < steps; k++) {
      const temp = 200 * Math.pow(0.002, k / steps)
      const cand = mutate(cur)
      // Si empeora mucho la cobertura, lo descartamos sin hacer la comprobación completa de reglas (que es lo lento).
      const deficit = coverageDeficitOf(cand)
      if ((deficit - curEval.deficit) * 10_000 > temp * 15) continue
      const e = evaluate(cand, deficit)
      if (e.cost <= curEval.cost || rng() < Math.exp((curEval.cost - e.cost) / temp)) {
        cur = cand
        curEval = e
        if (e.cost < bestEval.cost) {
          best = cand
          bestEval = e
        }
      }
    }
  }

  // Máximo teórico: cada fin de semana tienen que trabajar al menos los equipos que exige la cobertura.
  const needSat = need.reduce((a, row) => a + row[SAT], 0) / weight
  const needSun = need.reduce((a, row) => a + row[SUN], 0) / weight
  const maxFullWeeks = Math.max(0, N - Math.ceil(Math.max(needSat, needSun)))

  const perYear = (weeksCount: number) => Math.round((weeksCount / N) * WEEKS_PER_YEAR)
  const st = bestEval.stats
  return {
    pattern: toPattern(best),
    weeks: N,
    offsets: Array.from({ length: N }, (_, i) => mod(i * 7, N * 7)),
    fullWeekendsPerYear: perYear(bestEval.full),
    partialWeekendsPerYear: perYear(bestEval.partial),
    maxFullWeekendsPerYear: perYear(maxFullWeeks),
    violations: bestEval.violations,
    coverageDeficit: bestEval.deficit,
    netAnnualWorkDays: st.netAnnualWorkDays,
    netAnnualHours: st.netAnnualHours,
    excessDays: target != null ? st.netAnnualWorkDays - target : null,
    excessHours: rules.maxAnnualHours != null ? st.netAnnualHours - rules.maxAnnualHours : null,
  }
}
