// Comprueba un patrón de ciclo contra las reglas efectivas.
// Como todos los equipos siguen el mismo patrón, basta con validar el patrón una vez.
// El ciclo se trata como circular: el último día enlaza con el primero.

import { addDays, diffDays, formatDate, mod, startOfWeek } from './dates'
import { HOLIDAY_TREATMENT, RULE_DEFINITIONS, SHIFT_MIX, VACATION_TYPE } from './rules'
import { findShift, shiftDurationMinutes, parseTime } from './shifts'
import { OFF, type EffectiveRules, type ISODate, type PatternItem, type RuleKey, type Shift, type Team } from './types'

/** Regla propia de cada turno (máximo de días por semana), que no está en el catálogo general. */
export const SHIFT_WEEK_RULE = 'shiftMaxDaysPerWeek'
/** Regla propia de cada turno (días seguidos), tampoco está en el catálogo general. */
export const SHIFT_STREAK_RULE = 'shiftMaxConsecutiveDays'

export interface Violation {
  rule: RuleKey | typeof SHIFT_WEEK_RULE | typeof SHIFT_STREAK_RULE
  /** Día del ciclo (1 = primer día) donde se detecta, o null si afecta a todo el ciclo. */
  cycleDay: number | null
  message: string
}

export interface PatternStats {
  cycleLength: number
  workDays: number
  offDays: number
  hoursPerCycle: number
  avgWeeklyHours: number
  /** Días y horas al año que salen del ciclo, sin descontar nada. */
  grossAnnualWorkDays: number
  grossAnnualHours: number
  /** Días de trabajo que se pierden por vacaciones. */
  vacationWorkDays: number
  /** Festivos que caen en día de trabajo (estimación a partir del número de festivos al año). */
  holidayWorkDays: number
  /** Si los festivos se libran (se descuentan) o se trabajan. */
  holidaysOff: boolean
  /** Días y horas al año descontando vacaciones. */
  netAnnualWorkDays: number
  netAnnualHours: number
}

export interface ValidationResult {
  violations: Violation[]
  /** Información útil que no es un incumplimiento (p. ej. horas que faltan para la jornada anual). */
  notices: string[]
  stats: PatternStats
}

interface WorkInterval {
  day: number
  shift: Shift
  /** Minutos desde el inicio del día 0 de la línea temporal. */
  start: number
  end: number
}

const round1 = (n: number) => Math.round(n * 10) / 10

export function patternStats(pattern: PatternItem[], shifts: Shift[], rules?: EffectiveRules): PatternStats {
  const L = pattern.length
  let workDays = 0
  let minutes = 0
  for (const item of pattern) {
    const s = findShift(shifts, item)
    if (s) {
      workDays++
      minutes += shiftDurationMinutes(s)
    }
  }
  const hoursPerCycle = minutes / 60
  const workRatio = L ? workDays / L : 0
  const hoursPerWorkDay = workDays ? hoursPerCycle / workDays : 0
  const grossAnnualWorkDays = 365 * workRatio
  const vacation = rules?.vacationDays ?? 0
  // Naturales: se pierden los días de trabajo que caen dentro de las vacaciones (proporción del ciclo).
  // Hábiles: cada día de vacaciones es un día de trabajo que no se hace.
  const vacationWorkDays = rules?.vacationDayType === VACATION_TYPE.HABILES ? vacation : vacation * workRatio
  const holidayWorkDays = (rules?.annualHolidays ?? 0) * workRatio
  const holidaysOff = rules?.holidayTreatment === HOLIDAY_TREATMENT.SE_LIBRAN
  const netAnnualWorkDays = Math.max(grossAnnualWorkDays - vacationWorkDays - (holidaysOff ? holidayWorkDays : 0), 0)
  return {
    cycleLength: L,
    workDays,
    offDays: L - workDays,
    hoursPerCycle: round1(hoursPerCycle),
    avgWeeklyHours: L ? round1((hoursPerCycle / L) * 7) : 0,
    grossAnnualWorkDays: Math.round(grossAnnualWorkDays),
    grossAnnualHours: Math.round(grossAnnualWorkDays * hoursPerWorkDay),
    vacationWorkDays: Math.round(vacationWorkDays),
    holidayWorkDays: Math.round(holidayWorkDays),
    holidaysOff,
    netAnnualWorkDays: Math.round(netAnnualWorkDays),
    netAnnualHours: Math.round(netAnnualWorkDays * hoursPerWorkDay),
  }
}

export function validatePattern(pattern: PatternItem[], shifts: Shift[], rules: EffectiveRules): ValidationResult {
  const L = pattern.length
  const stats = patternStats(pattern, shifts, rules)
  const violations: Violation[] = []
  const notices: string[] = []
  if (L === 0) return { violations, notices, stats }

  // Repetimos el patrón varias veces para poder mirar hacia atrás y hacia delante
  // desde cualquier día del ciclo. Los días "ancla" (los que informamos) son la copia central.
  const context = Math.max(L, rules.weeklyRestWindowDays ?? 0, 14) + 1
  const copiesBefore = Math.ceil(context / L)
  const copies = copiesBefore * 2 + 1
  const anchorStart = copiesBefore * L
  const anchorEnd = anchorStart + L // exclusivo
  const total = copies * L
  const itemAt = (d: number) => pattern[mod(d, L)]
  const shiftAt = (d: number) => findShift(shifts, itemAt(d))
  const cycleDay = (d: number) => mod(d, L) + 1

  const intervals: WorkInterval[] = []
  for (let d = 0; d < total; d++) {
    const s = shiftAt(d)
    if (!s) continue
    const start = d * 1440 + parseTime(s.start)
    intervals.push({ day: d, shift: s, start, end: start + shiftDurationMinutes(s) })
  }

  const add = (rule: Violation['rule'], day: number | null, message: string) => violations.push({ rule, cycleDay: day, message })

  // 1. Máximo de horas por jornada
  if (rules.maxShiftHours != null) {
    const seen = new Set<string>()
    for (const item of pattern) {
      const s = findShift(shifts, item)
      if (!s || seen.has(s.id)) continue
      seen.add(s.id)
      const h = shiftDurationMinutes(s) / 60
      if (h > rules.maxShiftHours)
        add('maxShiftHours', null, `El turno ${s.name} dura ${round1(h)} h (máximo ${rules.maxShiftHours} h).`)
    }
  }

  // 2. Descanso mínimo entre jornadas
  if (rules.minRestBetweenShiftsHours != null) {
    for (let i = 1; i < intervals.length; i++) {
      const cur = intervals[i]
      if (cur.day < anchorStart || cur.day >= anchorEnd) continue
      const prev = intervals[i - 1]
      const restH = (cur.start - prev.end) / 60
      if (restH < rules.minRestBetweenShiftsHours) {
        add(
          'minRestBetweenShiftsHours',
          cycleDay(cur.day),
          `Entre ${prev.shift.name} (día ${cycleDay(prev.day)}) y ${cur.shift.name} (día ${cycleDay(cur.day)}) ` +
            `solo hay ${round1(Math.max(restH, 0))} h de descanso (mínimo ${rules.minRestBetweenShiftsHours} h).`,
        )
      }
    }
  }

  // 3. Máximo de días seguidos trabajados y 4. máximo de noches seguidas
  const checkStreak = (rule: RuleKey, max: number | null, counts: (d: number) => boolean, what: string) => {
    if (max == null) return
    if (pattern.every((_, i) => counts(i))) {
      add(rule, null, `El ciclo no tiene ninguna interrupción: los ${what} se encadenan sin fin (máximo ${max}).`)
      return
    }
    let run = 0
    for (let d = 0; d < anchorEnd; d++) {
      run = counts(d) ? run + 1 : 0
      if (d >= anchorStart && run === max + 1) {
        add(rule, cycleDay(d), `Se encadenan más de ${max} ${what} seguidos (se supera en el día ${cycleDay(d)} del ciclo).`)
      }
    }
  }
  // El máximo general de días seguidos NO se aplica a una racha que es enteramente de noche (esa
  // racha ya la limita su propio "máximo de días seguidos" del turno de noche, normalmente más
  // alto a propósito, p. ej. 7 noches seguidas en un único bloque en vez de partirlo en dos tramos
  // o dejar un hueco sin cubrir). En cuanto la racha mezcla la noche con cualquier otro turno (o no
  // tiene ningún turno de noche), sí cuenta como siempre.
  if (rules.maxConsecutiveWorkDays != null) {
    const max = rules.maxConsecutiveWorkDays
    if (pattern.every((_, i) => !!shiftAt(i))) {
      add('maxConsecutiveWorkDays', null, `El ciclo no tiene ninguna interrupción: los días trabajados se encadenan sin fin (máximo ${max}).`)
    } else {
      let run = 0
      let runAllNight = true
      for (let d = 0; d < anchorEnd; d++) {
        const s = shiftAt(d)
        if (s) {
          run++
          runAllNight = runAllNight && !!s.isNight
        } else {
          run = 0
          runAllNight = true
        }
        if (d >= anchorStart && !runAllNight && run === max + 1) {
          add(
            'maxConsecutiveWorkDays',
            cycleDay(d),
            `Se encadenan más de ${max} días trabajados seguidos sin ser todos de noche (se supera en el día ${cycleDay(d)} del ciclo).`,
          )
        }
      }
    }
  }
  checkStreak('maxConsecutiveNights', rules.maxConsecutiveNights, (d) => !!shiftAt(d)?.isNight, 'turnos de noche')

  // 4c. Máximo de bloques de noche por ciclo: los tramos se cuentan día a día (no semana a semana),
  // para que dos bloques separados por un hueco de cobertura (aunque quepan en la misma semana del
  // patrón) sí cuenten como dos tramos distintos.
  if (rules.maxNightBlocksPerCycle != null && pattern.some((_, i) => shiftAt(i)?.isNight)) {
    const max = rules.maxNightBlocksPerCycle
    let blocks = 0
    for (let d = anchorStart; d < anchorEnd; d++) {
      if (shiftAt(d)?.isNight && !shiftAt(d - 1)?.isNight) blocks++
    }
    if (blocks > max) {
      add('maxNightBlocksPerCycle', null, `El turno de noche aparece en ${blocks} tramos distintos del ciclo (máximo ${max}).`)
    }
  }

  // 4b. Máximo de noche al año (para no pasar a considerarse "trabajador nocturno")
  if (rules.maxNightSharePerYear != null && pattern.some((_, i) => shiftAt(i)?.isNight)) {
    const nightDays = pattern.filter((_, i) => shiftAt(i)?.isNight).length
    const share = nightDays / L
    if (share > rules.maxNightSharePerYear + 1e-9) {
      add(
        'maxNightSharePerYear',
        null,
        `El turno de noche ocupa el ${Math.round(share * 1000) / 10}% del ciclo (máximo ${Math.round(rules.maxNightSharePerYear * 1000) / 10}%): se pasaría a considerar trabajador nocturno.`,
      )
    }
  }

  // 5. Cambio de tipo de turno solo tras descansar
  const changeNeedsRest =
    rules.shiftMixInWeek === SHIFT_MIX.TRAS_DESCANSO || (rules.shiftMixInWeek == null && rules.shiftChangeMinDaysOff != null)
  if (changeNeedsRest && rules.shiftChangeMinDaysOff != null && rules.shiftChangeMinDaysOff > 0) {
    for (let d = anchorStart; d < anchorEnd; d++) {
      const cur = shiftAt(d)
      if (!cur) continue
      let p = d - 1
      while (p > d - total && !shiftAt(p)) p--
      const prev = shiftAt(p)
      if (!prev || prev.id === cur.id) continue
      const daysOff = d - p - 1
      if (daysOff < rules.shiftChangeMinDaysOff) {
        add(
          'shiftChangeMinDaysOff',
          cycleDay(d),
          `Día ${cycleDay(d)}: se pasa de ${prev.name} a ${cur.name} con ${daysOff} día(s) libre(s) entre medias ` +
            `(mínimo ${rules.shiftChangeMinDaysOff}).`,
        )
      }
    }
  }

  // 6. Descanso semanal ininterrumpido: cada periodo de W días debe incluir (total o parcialmente)
  //    un descanso seguido de al menos X horas. Medimos cada descanso completo, sin recortarlo
  //    por los bordes del periodo, para no penalizar un descanso que empieza el domingo y acaba el martes.
  if (rules.weeklyRestWindowDays != null && rules.weeklyRestMinHours != null && rules.weeklyRestWindowDays > 0) {
    const W = rules.weeklyRestWindowDays
    const gaps: { start: number; end: number }[] = []
    for (let i = 1; i < intervals.length; i++) gaps.push({ start: intervals[i - 1].end, end: intervals[i].start })
    if (intervals.length === 0) gaps.push({ start: -Infinity, end: Infinity })
    for (let w = anchorStart; w < anchorEnd; w++) {
      const winStart = w * 1440
      const winEnd = (w + W) * 1440
      let longest = 0
      for (const g of gaps) if (g.end > winStart && g.start < winEnd) longest = Math.max(longest, g.end - g.start)
      const h = longest / 60
      if (h < rules.weeklyRestMinHours) {
        add(
          'weeklyRestMinHours',
          cycleDay(w),
          `En los ${W} días que empiezan el día ${cycleDay(w)} del ciclo, el descanso seguido más largo es de ` +
            `${round1(h)} h (mínimo ${rules.weeklyRestMinHours} h).`,
        )
      }
    }
  }

  // 7. Días libres completos por semana
  if (rules.minDaysOffPerWeek != null) {
    const W = rules.weeklyRestWindowDays && rules.weeklyRestWindowDays > 0 ? rules.weeklyRestWindowDays : 7
    const needed = (rules.minDaysOffPerWeek * W) / 7
    for (let w = anchorStart; w < anchorEnd; w++) {
      let off = 0
      for (let d = w; d < w + W; d++) if (!shiftAt(d)) off++
      if (off + 1e-9 < needed) {
        add(
          'minDaysOffPerWeek',
          cycleDay(w),
          `En los ${W} días que empiezan el día ${cycleDay(w)} del ciclo solo hay ${off} día(s) libre(s) ` +
            `(mínimo ${round1(needed)}).`,
        )
      }
    }
  }

  // 7b. Máximo de días por semana en cada turno (mañana, tarde, noche... por separado)
  for (const sh of shifts) {
    if (sh.maxDaysPerWeek == null || !pattern.includes(sh.id)) continue
    for (let w = anchorStart; w < anchorEnd; w++) {
      let n = 0
      for (let d = w; d < w + 7; d++) if (shiftAt(d)?.id === sh.id) n++
      if (n > sh.maxDaysPerWeek) {
        add(
          SHIFT_WEEK_RULE,
          cycleDay(w),
          `Turno ${sh.name}: en los 7 días que empiezan el día ${cycleDay(w)} del ciclo hay ${n} días (máximo ${sh.maxDaysPerWeek}).`,
        )
      }
    }
  }

  // 7c. Máximo de días SEGUIDOS en cada turno (de un día para otro, aunque cruce de una semana a la
  // siguiente): es distinto del máximo por semana de arriba, que solo mira bloques de 7 días fijos.
  for (const sh of shifts) {
    if (sh.maxConsecutiveDays == null || !pattern.includes(sh.id)) continue
    if (pattern.every((p) => p === sh.id)) {
      add(SHIFT_STREAK_RULE, null, `Turno ${sh.name}: el ciclo no tiene ninguna interrupción, se encadena sin fin.`)
      continue
    }
    let run = 0
    for (let d = 0; d < anchorEnd; d++) {
      run = shiftAt(d)?.id === sh.id ? run + 1 : 0
      if (d >= anchorStart && run === sh.maxConsecutiveDays + 1) {
        add(
          SHIFT_STREAK_RULE,
          cycleDay(d),
          `Turno ${sh.name}: se encadenan más de ${sh.maxConsecutiveDays} días seguidos (se supera en el día ${cycleDay(d)} del ciclo).`,
        )
      }
    }
  }

  // 8. Horas semanales medias y jornada anual
  if (rules.maxWeeklyAvgHours != null && stats.avgWeeklyHours > rules.maxWeeklyAvgHours) {
    add(
      'maxWeeklyAvgHours',
      null,
      `La media es de ${stats.avgWeeklyHours} h semanales (máximo ${rules.maxWeeklyAvgHours} h).`,
    )
  }
  const holidayNote = stats.holidayWorkDays
    ? stats.holidaysOff
      ? ` y ${stats.holidayWorkDays} festivos que se libran`
      : ` (incluye unos ${stats.holidayWorkDays} festivos trabajados)`
    : ''
  const annual = (limit: number | null, value: number, unit: string) => {
    if (limit == null) return
    if (value > limit) {
      notices.push(
        `Exceso de jornada: con este cuadrante salen ${value} ${unit} al año descontando vacaciones${holidayNote}; ` +
          `la jornada anual es de ${limit} ${unit}. Hay que dar ${value - limit} ${unit} libres por exceso de jornada.`,
      )
    } else if (value < limit) {
      notices.push(
        `Defecto de jornada: con este cuadrante salen ${value} ${unit} al año descontando vacaciones${holidayNote}; ` +
          `la jornada anual es de ${limit} ${unit}. Faltan ${limit - value} ${unit} (habría que recuperarlas con otro patrón o con jornadas adicionales).`,
      )
    }
  }
  annual(rules.maxAnnualWorkDays, stats.netAnnualWorkDays, 'días')
  annual(rules.maxAnnualHours, stats.netAnnualHours, 'h')

  // Ordenamos por el orden del catálogo de reglas y por día.
  const order = [...RULE_DEFINITIONS.map((r) => r.key), SHIFT_WEEK_RULE, SHIFT_STREAK_RULE]
  violations.sort((a, b) => order.indexOf(a.rule as RuleKey) - order.indexOf(b.rule as RuleKey) || (a.cycleDay ?? 0) - (b.cycleDay ?? 0))
  return { violations, notices, stats }
}


export interface TeamWeekViolation {
  teamId: string
  /** Número de semanas (lunes a domingo) con turnos distintos en un periodo completo de rotación. */
  mixedWeeks: number
  periodWeeks: number
  /** Primera semana afectada a partir de la fecha de inicio. */
  firstWeek: ISODate | null
}

/**
 * Regla "No se puede trabajar en turnos distintos en la misma semana":
 * depende del día de la semana en que cae cada equipo, así que se comprueba
 * sobre el calendario real (con los desfases y la fecha de inicio).
 */
export function checkShiftMixByCalendarWeek(
  pattern: PatternItem[],
  teams: Team[],
  offsets: number[],
  startDate: ISODate,
): TeamWeekViolation[] {
  const L = pattern.length
  if (!L) return []
  // Periodo tras el que patrón y semana vuelven a coincidir: mcm(L, 7) días.
  const g = (a: number, b: number): number => (b ? g(b, a % b) : a)
  const periodWeeks = L / g(L, 7)
  const firstMonday = startOfWeek(startDate)
  const out: TeamWeekViolation[] = []
  teams.forEach((team, t) => {
    let mixed = 0
    let firstWeek: ISODate | null = null
    for (let w = 0; w < periodWeeks; w++) {
      const monday = addDays(firstMonday, w * 7)
      const kinds = new Set<string>()
      for (let i = 0; i < 7; i++) {
        const d = diffDays(addDays(monday, i), startDate)
        const item = pattern[mod(d - offsets[t], L)]
        if (item !== OFF) kinds.add(item)
      }
      if (kinds.size > 1) {
        mixed++
        if (!firstWeek) firstWeek = monday
      }
    }
    if (mixed) out.push({ teamId: team.id, mixedWeeks: mixed, periodWeeks, firstWeek })
  })
  return out
}

export function describeTeamWeekViolation(v: TeamWeekViolation, teamName: string): string {
  return (
    `${teamName}: ${v.mixedWeeks} de cada ${v.periodWeeks} semanas mezcla turnos distintos` +
    (v.firstWeek ? ` (la primera, la semana del ${formatDate(v.firstWeek)}).` : '.')
  )
}
