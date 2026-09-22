// Búsqueda automática de un patrón "homogéneo": bloques de varias semanas seguidas
// en el mismo turno (mañana / tarde / noche), sin cambiar de turno cada pocos días,
// librando los máximos fines de semana completos posibles.
//
// Idea de partida: un ciclo de tantas semanas como equipos (7 equipos -> 7 semanas) y cada
// equipo empieza una semana después que el anterior. Así los días libres caen siempre en el
// mismo día de la semana. Cada semana del ciclo tiene un único tipo de turno y unos días de
// trabajo; la cobertura de cada día de la semana es la suma de todas las semanas del ciclo
// (porque cada semana del calendario hay un equipo distinto en cada semana del ciclo).
//
// Dos cosas que pide un horario "de conciliación" y que el buscador fuerza activamente:
// - Bloques largos: cambia de turno lo menos posible de una semana a la siguiente (para un
//   mismo equipo, que pasa por todas las semanas del ciclo en orden, una tras otra).
// - Rotación en el sentido natural (mañana -> tarde -> noche -> mañana..., nunca saltar
//   directamente de un extremo al otro, p. ej. de noche a mañana): entre noche y mañana
//   siempre tiene que haber un turno "puente" (normalmente tarde) o un cambio de semana libre.
//
// Se busca por "recocido simulado": se hacen muchos cambios pequeños al azar, se quedan los que
// mejoran y, al principio, también algunos que empeoran para no quedarse atascado.

import { mod } from './dates'
import { requiredOn } from './offsets'
import { findShift, parseTime } from './shifts'
import { OFF, type BusinessConfig, type EffectiveRules, type PatternItem, type SearchPriority } from './types'
import { patternStats, validatePattern } from './validation'

export type { SearchPriority }

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
  /** Número de cambios de turno en todo el ciclo (menos = bloques más largos y homogéneos). */
  shiftChanges: number
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
const FULL_WEEK = 0b1111111
const WORKWEEK = 0b0011111 // lunes a viernes

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

  // Orden natural de los turnos por su hora de inicio (mañana, tarde, noche...). Un bloque solo
  // puede pasar al turno "vecino" en este orden: para ir del primero al último (o al revés) hace
  // falta pasar por los de en medio, que hacen de puente y evitan el peor de los saltos.
  const order = shiftIds
    .map((id, i) => ({ i, t: parseTime(findShift(config.shifts, id)!.start) }))
    .sort((a, b) => a.t - b.t)
  const rank = new Array<number>(S)
  order.forEach((o, r) => (rank[o.i] = r))

  // Peso de un equipo en la cobertura (si se cuenta por personas, usamos el tamaño medio).
  const avgSize = config.teams.reduce((a, t) => a + t.employees.length, 0) / N
  const weight = config.coverageMode === 'equipos' ? 1 : avgSize
  // Lo exigido cada día de la semana (0 = lunes) en cada turno.
  const need = active.map((c) => Array.from({ length: 7 }, (_, wd) => requiredOn(c, wd)))

  // Semanas posibles: los días libres siempre forman UN bloque seguido (nunca sueltos), para que
  // cada semana sea un tramo de trabajo homogéneo. Incluye la semana completa de 7 días sin ningún
  // libre, que se usa solo cuando hace falta cubrir el fin de semana (se compensa con el descanso
  // acumulado de la semana siguiente).
  const minOff = Math.ceil(rules.minDaysOffPerWeek ?? 0)
  const maskSet = new Set<number>([FULL_WEEK])
  for (let offLen = minOff; offLen <= 7; offLen++) {
    for (let offStart = 0; offStart <= 7 - offLen; offStart++) {
      let m = FULL_WEEK
      for (let k = 0; k < offLen; k++) m &= ~(1 << (offStart + k))
      maskSet.add(m)
    }
  }
  // Semanas "limpias": de lunes a viernes o la semana completa (para cubrir el fin de semana en
  // algún turno). Se usan casi siempre. El resto de combinaciones (semanas más cortas) solo entran
  // si hacen falta para que la cobertura cuadre exactamente.
  const cleanMasks = [WORKWEEK, FULL_WEEK].filter((m) => maskSet.has(m))
  const masks = [...maskSet]
  const preferredMasks = cleanMasks.length ? cleanMasks : masks

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

  // Coste de los cambios de turno de una semana a la siguiente (para el mismo equipo, que pasa
  // por las semanas del ciclo en orden y vuelve a empezar): 0 si no cambia, un coste moderado si
  // cambia a un turno vecino (bloques más cortos, pero es un cambio "seguro") y muy alto si salta
  // más de un turno de golpe (p. ej. de noche a mañana sin pasar por tarde).
  const transitionCostOf = (weeks: Week[]) => {
    let cost = 0
    let changes = 0
    for (let i = 0; i < weeks.length; i++) {
      const prev = weeks[mod(i - 1, weeks.length)].shift
      const cur = weeks[i].shift
      if (prev === cur) continue
      changes++
      const gap = Math.abs(rank[cur] - rank[prev])
      cost += gap > 1 ? 6_000 : 120
    }
    return { cost, changes }
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
    const { violations } = validatePattern(pattern, config.shifts, rules)
    const stats = patternStats(pattern, config.shifts, rules)
    const dev = target != null ? Math.abs(stats.netAnnualWorkDays - target) : 0
    const { cost: transitionCost, changes } = transitionCostOf(weeks)
    const cost =
      deficit * 10_000 + violations.length * 1_000 - full * prio.weekend - partial * 5 + dev * prio.dev + transitionCost
    return { cost, deficit, violations: violations.length, full, partial, stats, changes }
  }

  const rng = seededRandom(opts.seed)
  const pick = <T,>(arr: T[]) => arr[Math.floor(rng() * arr.length)]
  const randomWeek = (): Week => ({ shift: Math.floor(rng() * S), mask: pick(masks) })

  const mutate = (weeks: Week[]): Week[] => {
    const next = weeks.map((w) => ({ ...w }))
    const r = rng()
    const i = Math.floor(rng() * N)
    if (r < 0.3) {
      // Alargar un bloque: copiar el turno de la semana vecina (junta dos bloques en uno).
      const j = rng() < 0.5 ? mod(i - 1, N) : mod(i + 1, N)
      next[i] = { ...next[j] }
    } else if (r < 0.45) {
      // Cambiar un día de la semana (trabajo <-> libre), si sigue siendo una semana válida.
      const m = next[i].mask ^ (1 << Math.floor(rng() * 7))
      if (masks.includes(m)) next[i].mask = m
    } else if (r < 0.6) {
      // Pasar al turno vecino en el orden natural (mañana/tarde/noche), no a uno cualquiera.
      const r2 = rank[next[i].shift] + (rng() < 0.5 ? 1 : -1)
      const found = order.find((o) => rank[o.i] === r2)
      if (found) next[i].shift = found.i
    } else if (r < 0.75) {
      const j = Math.floor(rng() * N)
      ;[next[i], next[j]] = [next[j], next[i]]
    } else if (r < 0.9) {
      next[i].mask = pick(rng() < 0.85 ? preferredMasks : masks)
    } else {
      next[i] = randomWeek()
    }
    return next
  }

  // Punto de partida: bloques de varias semanas seguidas seguidos del turno siguiente en el
  // orden natural, de lunes a viernes, para que la búsqueda empiece ya con bloques homogéneos.
  const initial = (): Week[] => {
    const weeksPerShift = Math.max(1, Math.floor(N / S))
    return Array.from({ length: N }, (_, i) => ({
      shift: order[Math.min(Math.floor(i / weeksPerShift), S - 1)].i,
      mask: WORKWEEK,
    }))
  }

  const iterations = opts.iterations ?? 24_000
  const restarts = 3
  let best = initial()
  let bestEval = evaluate(best)
  for (let r = 0; r < restarts; r++) {
    let cur = r === 0 ? best : initial()
    let curEval = evaluate(cur)
    const steps = Math.floor(iterations / restarts)
    for (let k = 0; k < steps; k++) {
      const temp = 300 * Math.pow(0.0015, k / steps)
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
    shiftChanges: bestEval.changes,
    violations: bestEval.violations,
    coverageDeficit: bestEval.deficit,
    netAnnualWorkDays: st.netAnnualWorkDays,
    netAnnualHours: st.netAnnualHours,
    excessDays: target != null ? st.netAnnualWorkDays - target : null,
    excessHours: rules.maxAnnualHours != null ? st.netAnnualHours - rules.maxAnnualHours : null,
  }
}

/** Fines de semana completos libres al año que como mucho puede tener cada equipo con esta cobertura. */
export function maxFullWeekendsPerYear(config: BusinessConfig): number {
  const N = config.teams.length
  if (!N) return 0
  const avgSize = config.teams.reduce((a, t) => a + t.employees.length, 0) / N
  const weight = config.coverageMode === 'equipos' ? 1 : avgSize || 1
  const active = config.coverage.filter((c) => c.min > 0 && findShift(config.shifts, c.shiftId))
  const needSat = active.reduce((a, c) => a + requiredOn(c, SAT), 0) / weight
  const needSun = active.reduce((a, c) => a + requiredOn(c, SUN), 0) / weight
  const weeks = Math.max(0, N - Math.ceil(Math.max(needSat, needSun)))
  return Math.round((weeks / N) * WEEKS_PER_YEAR)
}
