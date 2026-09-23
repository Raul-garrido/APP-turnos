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
import { findShift, parseTime, shiftDurationMinutes } from './shifts'
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
const popcount = (mask: number) => { let n=0; for(let d=0;d<7;d++) n+=bit(mask,d); return n }

function seededRandom(seed: number) {
  let s = seed >>> 0 || 1
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296
    return s / 4294967296
  }
}

function suggestOnce(config: BusinessConfig, rules: EffectiveRules, opts: PatternSearchOptions): PatternSuggestion | null {
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

  // Semanas posibles: por defecto los días libres forman UN bloque seguido (nunca sueltos), para
  // que cada semana sea un tramo de trabajo homogéneo. Incluye la semana completa de 7 días sin
  // ningún libre, que se usa solo cuando hace falta cubrir el fin de semana (se compensa con el
  // descanso acumulado de la semana siguiente).
  // El límite superior es 6, no 7: una semana con offLen=7 no trabajaría ningún día, desperdicia
  // por completo esa semana del ciclo (7 equipos ya son pocos como para regalar uno entero parado)
  // y nunca hace falta, porque el mismo descanso se puede repartir en un par de semanas parciales.
  const minOff = Math.ceil(rules.minDaysOffPerWeek ?? 0)
  const maskSet = new Set<number>([FULL_WEEK])
  for (let offLen = minOff; offLen <= 6; offLen++) {
    for (let offStart = 0; offStart <= 7 - offLen; offStart++) {
      let m = FULL_WEEK
      for (let k = 0; k < offLen; k++) m &= ~(1 << (offStart + k))
      maskSet.add(m)
    }
  }
  // Excepción: un bloque más un único día suelto aparte (nunca dos sueltos, y nunca más de uno).
  // Hace falta a veces para llegar al descanso semanal acumulado en 14 días ("día y medio") sin
  // sacrificar un día entero de trabajo; el coste de "semana fragmentada" de más abajo hace que el
  // buscador solo la use cuando de verdad compensa, nunca porque sí.
  for (let offLen = minOff + 1; offLen <= 6; offLen++) {
    const blockLen = offLen - 1
    for (let offStart = 0; offStart <= 7 - blockLen; offStart++) {
      let block = FULL_WEEK
      for (let k = 0; k < blockLen; k++) block &= ~(1 << (offStart + k))
      for (let extra = 0; extra < 7; extra++) {
        if (extra >= offStart - 1 && extra <= offStart + blockLen) continue // pegado al bloque: ya es un bloque más largo
        maskSet.add(block & ~(1 << extra))
      }
    }
  }
  // Semanas "limpias": de lunes a viernes o la semana completa (para cubrir el fin de semana en
  // algún turno). Se usan casi siempre. El resto de combinaciones (semanas más cortas, o con un día
  // suelto aparte) solo entran si hacen falta para que la cobertura o el descanso acumulado cuadren.
  const cleanMasks = [WORKWEEK, FULL_WEEK].filter((m) => maskSet.has(m))
  const masks = [...maskSet]
  const preferredMasks = cleanMasks.length ? cleanMasks : masks
  // Número de bloques de días libres de una máscara (para penalizar semanas fragmentadas).
  const offBlockCount = (mask: number) => {
    let blocks = 0
    let prevOff = false
    for (let d = 0; d < 7; d++) {
      const off = !bit(mask, d)
      if (off && !prevOff) blocks++
      prevOff = off
    }
    return blocks
  }

  const toPattern = (weeks: Week[]): PatternItem[] =>
    weeks.flatMap((w) => Array.from({ length: 7 }, (_, d) => (bit(w.mask, d) ? shiftIds[w.shift] : OFF)))

  const target = rules.maxAnnualWorkDays
  // La prioridad ya solo decide cuánto se prima el fin de semana frente al reparto fino; la
  // jornada anual (días y horas) se exige siempre, no depende de la prioridad elegida.
  const prio = opts.priority === 'findes' ? { weekend: 100 } : { weekend: 20 }

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

  // Duración de cada turno en minutos, y el descanso mínimo exigido (12 h si no hay regla).
  const durationMin = shiftIds.map((id) => shiftDurationMinutes(findShift(config.shifts, id)!))
  const minRestMin = (rules.minRestBetweenShiftsHours ?? 12) * 60

  // Último día trabajado dentro de una semana (según su máscara) y minutos desde el lunes 00:00
  // en que termina ese turno; y primer día trabajado y minutos en que empieza. undefined si la
  // semana no tiene ningún día de trabajo.
  const weekEdges = (w: Week) => {
    let first = -1
    let last = -1
    for (let d = 0; d < 7; d++) if (bit(w.mask, d)) {
      if (first < 0) first = d
      last = d
    }
    if (first < 0) return null
    return { startMin: first * 1440 + parseTime(findShift(config.shifts, shiftIds[w.shift])!.start), endMin: last * 1440 + parseTime(findShift(config.shifts, shiftIds[w.shift])!.start) + durationMin[w.shift] }
  }

  // Coste de pasar de una semana a la siguiente (para el mismo equipo, que pasa por las semanas
  // del ciclo en orden y vuelve a empezar, semana tras semana, para siempre):
  // - Si el turno no cambia, nada.
  // - Si cambia, un coste moderado si es al turno vecino (mañana<->tarde, tarde<->noche) y muy
  //   alto si salta directamente entre los dos extremos (p. ej. mañana<->noche).
  // - Además, el descanso REAL entre el último turno trabajado de la semana anterior y el primero
  //   de la siguiente (en horas, no solo "qué turno es") tiene que llegar al mínimo: una noche que
  //   acaba el domingo por la mañana dificilmente llega a las 12 h si el lunes se empieza de tarde.
  // Turnos marcados como nocturnos (para "no más de 1/3 del año de noche" y "la noche siempre en
  // un único bloque seguido"). Si no hay ninguno marcado, estas dos reglas no hacen nada.
  const nightIdx = new Set(shiftIds.map((id, i) => (findShift(config.shifts, id)!.isNight ? i : -1)).filter((i) => i >= 0))
  const nightShare = rules.maxNightSharePerYear ?? (nightIdx.size ? 1 / 3 : null)

  const transitionCostOf = (weeks: Week[]) => {
    let cost = 0
    let changes = 0
    for (let i = 0; i < weeks.length; i++) {
      const prevW = weeks[mod(i - 1, weeks.length)]
      const curW = weeks[i]
      if (prevW.shift !== curW.shift) {
        changes++
        const gap = Math.abs(rank[curW.shift] - rank[prevW.shift])
        cost += gap > 1 ? 6_000 : 120
      }
      const pe = weekEdges(prevW)
      const ce = weekEdges(curW)
      if (pe && ce) {
        const restMin = ce.startMin + 10080 - pe.endMin // 10080 = minutos de una semana
        if (restMin < minRestMin) cost += (minRestMin - restMin) * 8
      }
    }
    // La noche tiene que ser un único bloque seguido (no dos o más tramos sueltos en el ciclo).
    // Contamos los bloques por DÍA real (no por semana): dos semanas de noche con algún día
    // libre entre medias (por cómo caen sus máscaras) son dos bloques distintos, no uno.
    const totalDays = weeks.length * 7
    let nightBlocks = 0
    for (let d = 0; d < totalDays; d++) {
      const isNight = nightIdx.has(weeks[Math.floor(d / 7)].shift) && bit(weeks[Math.floor(d / 7)].mask, d % 7)
      const prevD = mod(d - 1, totalDays)
      const wasNight = nightIdx.has(weeks[Math.floor(prevD / 7)].shift) && bit(weeks[Math.floor(prevD / 7)].mask, prevD % 7)
      if (isNight && !wasNight) nightBlocks++
    }
    // Menos que el peso de una regla incumplida (50 000): nunca merece la pena romper una regla
    // solo por mantener la noche en un único bloque; pero sigue siendo una preferencia fuerte.
    if (nightBlocks > 1) cost += (nightBlocks - 1) * 8_000
    // No más de 1/3 del año en turno de noche (para no ser "trabajador nocturno" por ley).
    if (nightShare != null && nightIdx.size) {
      const nightDays = weeks.reduce((a, w) => a + (nightIdx.has(w.shift) ? popcount(w.mask) : 0), 0)
      const totalDays = weeks.length * 7
      const over = nightDays / totalDays - nightShare
      if (over > 0) cost += over * totalDays * 20_000
    }
    // Repartir los fines de semana trabajados a lo largo del ciclo, no dejar que se junten varios
    // seguidos (aunque el total de fines de semana libres ya sea el máximo posible). Cuenta, para
    // cada semana que toca fin de semana, cuántas semanas seguidas antes también lo tocan: eso
    // penaliza mucho más una racha de 3 seguidas que dos rachas de una.
    // Semana con más de un bloque de libranza (p. ej. un lunes suelto y luego un viernes suelto):
    // se acepta si de verdad hace falta, pero cuesta más que un cambio de turno normal, así el
    // buscador prefiere un único bloque salvo que fragmentar sea la única forma de llegar al
    // descanso acumulado o a la cobertura exacta.
    for (const w of weeks) {
      const extraBlocks = offBlockCount(w.mask) - 1
      if (extraBlocks > 0) cost += extraBlocks * 500
    }
    let weekendRun = 0
    for (let i = 0; i < weeks.length * 2; i++) {
      const w = weeks[i % weeks.length]
      const touchesWeekend = bit(w.mask, SAT) === 1 || bit(w.mask, SUN) === 1
      if (touchesWeekend) {
        weekendRun++
        if (i >= weeks.length) cost += (weekendRun - 1) * (weekendRun - 1) * 900
      } else {
        weekendRun = 0
      }
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
    // La jornada anual no es una preferencia, es un requisito: los días no se pueden pasar del
    // máximo (si se pasan, cuenta casi como un incumplimiento) y las horas tienen que quedar lo
    // más cerca posible del objetivo (por debajo o por encima), casi siempre a menos de una
    // jornada (8 h) de diferencia.
    const daysExcess = target != null ? Math.max(0, stats.netAnnualWorkDays - target) : 0
    const hoursTarget = rules.maxAnnualHours
    const hoursDev = hoursTarget != null ? Math.abs(stats.netAnnualHours - hoursTarget) : 0
    const { cost: transitionCost, changes } = transitionCostOf(weeks)
    // Los pesos están escalonados a propósito: nada de lo que viene después de "violations" puede
    // llegar nunca a compensar una sola regla incumplida (por eso su peso es tan alto). Dentro de
    // "ya sin incumplimientos", primero cuenta el fin de semana y después, mucho más fino, las
    // horas exactas y los cambios de turno.
    const cost =
      deficit * 10_000_000 +
      violations.length * 50_000 +
      daysExcess * 400 +
      hoursDev * 20 -
      full * prio.weekend -
      partial * 5 +
      transitionCost
    return { cost, deficit, violations: violations.length, full, partial, stats, changes, hoursDev }
  }

  const rng = seededRandom(opts.seed)
  const pick = <T,>(arr: T[]) => arr[Math.floor(rng() * arr.length)]
  const randomWeek = (): Week => ({ shift: Math.floor(rng() * S), mask: pick(masks) })

  const maxConsecutive = shiftIds.map((id) => findShift(config.shifts, id)!.maxConsecutiveDays ?? Infinity)

  const mutate = (weeks: Week[]): Week[] => {
    const next = weeks.map((w) => ({ ...w }))
    const r = rng()
    const i = Math.floor(rng() * N)
    if (r < 0.3) {
      // Alargar un bloque: copiar el turno de la semana vecina (junta dos bloques en uno), pero
      // no si ese turno tiene un máximo de días seguidos (una sola semana ya puede llegar a 7 días).
      const j = rng() < 0.5 ? mod(i - 1, N) : mod(i + 1, N)
      if (!Number.isFinite(maxConsecutive[next[j].shift])) next[i] = { ...next[j] }
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

  // Variante del punto de partida: una semana de cada turno cubre ya el fin de semana (trabaja de
  // miércoles a domingo en vez de lunes a viernes). Cubrir el fin de semana exige que al menos una
  // semana de cada turno lo trabaje sí o sí (si no, no hay cobertura ahí); partir ya con eso resuelto
  // le ahorra a la búsqueda tener que "descubrirlo" enlazando varias mutaciones sueltas a la vez,
  // que es justo el tipo de salto que al recocido simulado le cuesta encontrar por sí solo.
  const initialWeekendAware = (): Week[] => {
    const base = initial()
    const midWeek = FULL_WEEK & ~(1 << 0) & ~(1 << 1) // libra lunes y martes, trabaja miércoles-domingo
    if (!masks.includes(midWeek)) return base
    for (let s = 0; s < S; s++) {
      const idx = base.findIndex((w, i) => w.shift === s && (i === base.length - 1 || base[i + 1].shift !== s))
      if (idx >= 0) base[idx] = { ...base[idx], mask: midWeek }
    }
    return base
  }

  const iterations = opts.iterations ?? 36_000
  const restarts = 3
  let best = initial()
  let bestEval = evaluate(best)
  for (let r = 0; r < restarts; r++) {
    let cur = r === 0 ? best : r === 1 ? initialWeekendAware() : initial()
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

  // Segunda pasada, solo si ya hay una solución válida (sin huecos ni incumplimientos): afinar las
  // horas anuales sin arriesgar esa validez. Es una subida por colina normal (no recocido: aquí ya
  // no interesa aceptar nada peor), que solo se queda con cambios que sigan sin dar ningún hueco ni
  // incumplimiento y se acerquen más a la jornada anual. Con la prioridad "findes" no toca los
  // fines de semana ya conseguidos; con "equilibrio" puede ceder algún fin de semana si así se
  // acerca de verdad a las horas exactas.
  if (bestEval.deficit === 0 && bestEval.violations === 0) {
    let cur = best
    let curEval = bestEval
    const steps = Math.floor(iterations / 2)
    const keepWeekends = opts.priority === 'findes'
    for (let k = 0; k < steps && curEval.hoursDev > 4; k++) {
      const cand = mutate(cur)
      const deficit = coverageDeficitOf(cand)
      if (deficit !== 0) continue
      const e = evaluate(cand, deficit)
      const better =
        e.violations === 0 &&
        (keepWeekends ? e.full >= curEval.full && e.hoursDev < curEval.hoursDev : e.hoursDev < curEval.hoursDev)
      if (better) {
        cur = cand
        curEval = e
      }
    }
    best = cur
    bestEval = curEval
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

/**
 * Igual que una sola búsqueda, pero prueba varias semillas internamente (partiendo de la que se
 * le pasa) y se queda con la mejor: primero la que tenga menos huecos de cobertura, luego menos
 * incumplimientos de reglas, luego más fines de semana y más cerca de la jornada anual. Con
 * restricciones muy ajustadas (por ejemplo, pocos días seguidos permitidos por turno) una sola
 * búsqueda no siempre encuentra la mejor solución posible; probar varias sube mucho las
 * probabilidades sin que el usuario tenga que pulsar "generar otra opción" a mano.
 */
export function suggestPattern(config: BusinessConfig, rules: EffectiveRules, opts: PatternSearchOptions): PatternSuggestion | null {
  const attempts = opts.iterations != null ? 1 : 3
  const perAttempt = opts.iterations ?? 13_000
  // Cuanto más bajo, mejor: primero sin huecos de cobertura, luego sin incumplimientos, luego
  // más fines de semana, luego lo más cerca posible de la jornada anual en horas.
  const rank = (r: PatternSuggestion) => [r.coverageDeficit, r.violations, -r.fullWeekendsPerYear, Math.abs(r.excessHours ?? 0)]
  const better = (a: number[], b: number[]) => {
    for (let i = 0; i < a.length; i++) {
      if (a[i] < b[i]) return true
      if (a[i] > b[i]) return false
    }
    return false
  }
  let best: PatternSuggestion | null = null
  let bestRank: number[] = []
  for (let a = 0; a < attempts; a++) {
    const r = suggestOnce(config, rules, { ...opts, seed: opts.seed + a * 104_729, iterations: perAttempt })
    if (!r) continue
    const rk = rank(r)
    if (!best || better(rk, bestRank)) {
      best = r
      bestRank = rk
    }
    if (best.violations === 0 && best.coverageDeficit === 0) break
  }
  return best
}
