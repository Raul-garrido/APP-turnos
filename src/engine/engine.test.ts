import { describe, expect, it } from 'vitest'
import { annualBalance, buildSchedule, effectiveOffsets, vacationDaysUsed } from './calendar'
import { addDays, mod, weekday } from './dates'
import { defaultConfig, defaultRuleSets, makeTeams } from './defaults'
import { computeOffsets, coverageTable, weekendStats } from './offsets'
import { HOLIDAY_TREATMENT, resolveRules, RULE_KEYS, SHIFT_MIX, VACATION_TYPE } from './rules'
import { parsePatternText } from './shifts'
import { OFF, type EffectiveRules, type RuleSet } from './types'
import { checkShiftMixByCalendarWeek, SHIFT_STREAK_RULE, validatePattern } from './validation'

const noRules = Object.fromEntries(RULE_KEYS.map((k) => [k, null])) as EffectiveRules
const base = defaultConfig()
const shifts = base.shifts
const [M, T, N] = shifts
const p = (text: string) => parsePatternText(text, shifts).pattern

describe('patrón', () => {
  it('entiende el texto con y sin espacios', () => {
    expect(p('M M T L')).toEqual([M.id, M.id, T.id, OFF])
    expect(p('MMTL')).toEqual([M.id, M.id, T.id, OFF])
    expect(parsePatternText('M X', shifts).unknown).toEqual(['X'])
  })
})

describe('validación de reglas', () => {
  it('detecta poco descanso entre noche y mañana', () => {
    const r = validatePattern(p('N M L L'), shifts, { ...noRules, minRestBetweenShiftsHours: 12 })
    expect(r.violations.map((v) => v.rule)).toContain('minRestBetweenShiftsHours')
    // N acaba a las 06:00 y M empieza a las 06:00 del mismo día: 0 h
    expect(r.violations[0].message).toContain('0 h')
  })

  it('tiene en cuenta que el ciclo es circular', () => {
    // Último día M, primer día T -> 16 h, correcto. Último N y primero M -> 0 h, incorrecto.
    expect(validatePattern(p('T L M'), shifts, { ...noRules, minRestBetweenShiftsHours: 12 }).violations).toHaveLength(0)
    expect(validatePattern(p('M L N'), shifts, { ...noRules, minRestBetweenShiftsHours: 12 }).violations).toHaveLength(1)
  })

  it('cuenta días seguidos trabajados', () => {
    // Sin límite por turno (aparte, el ejemplo por defecto sí trae uno: se prueba más abajo).
    const noStreakShifts = shifts.map((s) => ({ ...s, maxConsecutiveDays: null }))
    const r = validatePattern(p('M M M M M M M L'), noStreakShifts, { ...noRules, maxConsecutiveWorkDays: 6 })
    expect(r.violations).toHaveLength(1)
    expect(validatePattern(p('M M M M M M L'), noStreakShifts, { ...noRules, maxConsecutiveWorkDays: 6 }).violations).toHaveLength(0)
  })

  it('máximo de días seguidos por turno (aunque cruce de una semana a la siguiente)', () => {
    const limited = shifts.map((s) => (s.id === M.id ? { ...s, maxConsecutiveDays: 5 } : { ...s, maxConsecutiveDays: null }))
    expect(validatePattern(p('M M M M M L L'), limited, noRules).violations).toHaveLength(0)
    expect(validatePattern(p('M M M M M M L'), limited, noRules).violations.map((v) => v.rule)).toEqual([SHIFT_STREAK_RULE])
  })

  it('cambio de turno solo tras descansar', () => {
    const rules = { ...noRules, shiftMixInWeek: SHIFT_MIX.TRAS_DESCANSO, shiftChangeMinDaysOff: 2 }
    expect(validatePattern(p('M M T T L L'), shifts, rules).violations.length).toBeGreaterThan(0)
    expect(validatePattern(p('M M L L T T L L'), shifts, rules).violations).toHaveLength(0)
    // Con "Sí, sin condiciones" no se comprueba.
    expect(
      validatePattern(p('M M T T L L'), shifts, { ...rules, shiftMixInWeek: SHIFT_MIX.SIEMPRE }).violations,
    ).toHaveLength(0)
  })

  it('descanso semanal de 48 h seguidas y 2 días libres por semana', () => {
    const rules = { ...noRules, weeklyRestWindowDays: 7, weeklyRestMinHours: 48, minDaysOffPerWeek: 2 }
    expect(validatePattern(p('M M M M M L L'), shifts, rules).violations).toHaveLength(0)
    const bad = validatePattern(p('M M M M M M L'), shifts, rules).violations.map((v) => v.rule)
    expect(bad).toContain('weeklyRestMinHours')
    expect(bad).toContain('minDaysOffPerWeek')
  })

  it('jornada anual descontando vacaciones naturales', () => {
    const r = validatePattern(p('M M M M L L T T T T L L N N N N L L'), shifts, {
      ...noRules,
      vacationDays: 30,
      vacationDayType: 0,
      maxAnnualWorkDays: 221,
    })
    // 365 * 12/18 = 243,3 días; vacaciones: 30 * 12/18 = 20 -> 223 días
    expect(r.stats.netAnnualWorkDays).toBe(223)
    // El exceso de jornada no es un incumplimiento: se avisa de los días a dar libres.
    expect(r.violations).toHaveLength(0)
    expect(r.notices[0]).toContain('Hay que dar 2 días libres por exceso de jornada')
  })

  it('festivos: si se libran se descuentan los que caen en día de trabajo', () => {
    const rules = { ...noRules, vacationDays: 30, vacationDayType: 0, annualHolidays: 14, maxAnnualWorkDays: 221 }
    const pat = p('M M M M L L T T T T L L N N N N L L')
    expect(validatePattern(pat, shifts, { ...rules, holidayTreatment: 0 }).stats.netAnnualWorkDays).toBe(223)
    // 14 festivos * 12/18 = 9,3 días de trabajo que se libran
    expect(validatePattern(pat, shifts, { ...rules, holidayTreatment: 1 }).stats.netAnnualWorkDays).toBe(214)
  })

  it('máximo de días por semana en cada turno', () => {
    const limited = shifts.map((s) => (s.id === N.id ? { ...s, maxDaysPerWeek: 3 } : s))
    const r = validatePattern(p('N N N N L L L'), limited, noRules)
    expect(r.violations.map((v) => v.rule)).toContain('shiftMaxDaysPerWeek')
    expect(validatePattern(p('N N N L L L L'), limited, noRules).violations).toHaveLength(0)
    // El límite de la noche no afecta a la mañana
    expect(validatePattern(p('M M M M L L L'), limited, noRules).violations).toHaveLength(0)
  })

  it('el ejemplo por defecto cumple todas las reglas del ejemplo', () => {
    const { rules } = resolveRules(defaultRuleSets(), base.activeRuleSetIds, {})
    const r = validatePattern(base.pattern, shifts, rules)
    expect(r.violations).toHaveLength(0)
    expect(r.notices.join(' ')).toContain('Exceso de jornada')
  })
})

describe('marcos normativos', () => {
  it('el último marco manda y los ajustes propios van al final', () => {
    const sets = defaultRuleSets()
    const { rules, sources } = resolveRules(sets, base.activeRuleSetIds, { weeklyRestMinHours: 60 })
    expect(rules.maxShiftHours).toBe(9) // del Estatuto
    expect(rules.maxAnnualHours).toBe(1736) // del convenio
    expect(rules.weeklyRestMinHours).toBe(60)
    expect(sources.weeklyRestMinHours.source).toBe('Ajustes propios del negocio')
    // null desactiva una regla heredada
    expect(resolveRules(sets, base.activeRuleSetIds, { maxShiftHours: null }).rules.maxShiftHours).toBeNull()
  })
})

describe('desfases', () => {
  const input = (pattern: string, teams: number) => ({
    pattern: p(pattern),
    teams: makeTeams(teams, 4),
    coverage: shifts.map((s) => ({ shiftId: s.id, min: 1, weekdays: [0, 1, 2, 3, 4, 5, 6] })),
    coverageMode: 'equipos' as const,
    startWeekday: 0,
  })

  it('5 equipos con ciclo de 10 días: desfase de 2 en 2 y cobertura perfecta', () => {
    const r = computeOffsets(input('M M T T N N L L L L', 5))
    expect(r.deficit).toBe(0)
    const table = coverageTable(input('M M T T N N L L L L', 5), r.offsets, 10)
    for (const row of table.values()) expect(row.every((c) => c === 1)).toBe(true)
  })

  it('7 equipos con ciclo de 10 días: encuentra cobertura aunque no sea divisible', () => {
    expect(computeOffsets(input('M M T T N N L L L L', 7)).deficit).toBe(0)
  })

  it('avisa cuando es imposible cubrir', () => {
    const r = computeOffsets(input('M M T T N N L L L L', 4))
    expect(r.feasibility.every((f) => !f.possible)).toBe(true)
    expect(r.deficit).toBeGreaterThan(0)
  })

  it('el ejemplo por defecto (7 equipos, ciclo de 18) tiene cobertura 24/7', () => {
    expect(computeOffsets(input('M M M M L L T T T T L L N N N N L L', 7)).deficit).toBe(0)
  })

  it('libra los máximos fines de semana completos manteniendo la cobertura', () => {
    // Ciclo semanal de 7 equipos, solo turno de mañana con 1 equipo mínimo, empezando en lunes.
    const inp = {
      ...input('M M M M M L L', 7),
      coverage: [{ shiftId: M.id, min: 1, weekdays: [0, 1, 2, 3, 4, 5, 6] }],
    }
    const r = computeOffsets(inp)
    expect(r.deficit).toBe(0)
    const stats = weekendStats(inp.pattern, 0, r.offsets)
    // Alguien tiene que trabajar el fin de semana: lo mejor es que 6 de los 7 equipos libren todos.
    expect(stats.filter((s) => s.fullPerYear >= 52).length).toBe(6)
  })

  it('reparte los fines de semana de forma justa cuando el ciclo no es múltiplo de 7', () => {
    const inp = input('M M M M L L T T T T L L N N N N L L', 7)
    const stats = weekendStats(inp.pattern, 0, computeOffsets(inp).offsets)
    const full = stats.map((s) => s.fullPerYear)
    expect(Math.max(...full) - Math.min(...full)).toBeLessThanOrEqual(1)
    expect(Math.min(...full)).toBeGreaterThan(0)
  })

  it('usa búsqueda por mejora cuando hay demasiadas combinaciones', () => {
    const r = computeOffsets(input('M M M M M L L T T T T T L L N N N N N L L L L L L L L L', 9))
    expect(r.exhaustive).toBe(false)
    expect(r.deficit).toBe(0)
  })
})

describe('calendario y excepciones', () => {
  const config = { ...base, startDate: '2026-01-05' }
  const offsets = effectiveOffsets(config)
  const ana = config.teams[0].employees[0]
  const luis = config.teams[1].employees[0]

  it('sin excepciones hay cobertura todos los días', () => {
    const days = buildSchedule(config, '2026-01-05', '2026-03-31', offsets)
    expect(days.every((d) => d.coverage.every((c) => c.ok))).toBe(true)
  })

  it('aplica vacaciones, cambios e intercambios sin tocar el patrón', () => {
    const day = '2026-01-05'
    const withEx = {
      ...config,
      exceptions: [
        { id: 'a', kind: 'vacaciones' as const, employeeId: ana.id, from: day, to: addDays(day, 2) },
        { id: 'b', kind: 'intercambio' as const, employeeId: config.teams[0].employees[1].id, otherEmployeeId: luis.id, from: day, to: day },
      ],
    }
    const [d0] = buildSchedule(withEx, day, day, offsets)
    expect(d0.cells[ana.id].absence).toBe('vacaciones')
    expect(d0.cells[ana.id].base).not.toBe(OFF) // el equipo 1 empieza trabajando
    expect(d0.cells[config.teams[0].employees[1].id].item).toBe(d0.cells[luis.id].base)
    expect(d0.coverage.find((c) => c.shiftId === M.id)!.reducedTeams.length).toBeGreaterThan(0)
  })

  it('cuenta vacaciones naturales y hábiles', () => {
    const withEx = {
      ...config,
      exceptions: [{ id: 'a', kind: 'vacaciones' as const, employeeId: ana.id, from: '2026-01-05', to: '2026-01-10' }],
    }
    expect(vacationDaysUsed(withEx, ana.id, 2026, false, offsets)).toBe(6)
    // Equipo 1 (desfase 0): M M M M L L -> 4 días hábiles
    expect(vacationDaysUsed(withEx, ana.id, 2026, true, offsets)).toBe(4)
  })

  it('balance de jornada anual por equipo con festivos reales', () => {
    const { rules } = resolveRules(defaultRuleSets(), base.activeRuleSetIds, {})
    const bal = annualBalance(config, rules, 2026, offsets)
    expect(bal.realHolidays).toBe(false)
    expect(bal.holidayCount).toBe(14)
    for (const r of bal.rows) {
      expect(r.workDays).toBeGreaterThan(240)
      expect(r.excessDays).toBe(r.effectiveDays - 221)
    }
    const withHolidays = { ...config, holidays: [{ date: '2026-01-06', name: 'Reyes' }] }
    const b2 = annualBalance(withHolidays, { ...rules, holidayTreatment: 1 }, 2026, offsets)
    expect(b2.realHolidays).toBe(true)
    const worksThatDay = b2.rows.filter((r) => r.holidaysOnWork === 1).length
    expect(worksThatDay).toBeGreaterThan(0)
  })

  it('regla "no mezclar turnos en la misma semana" sobre el calendario real', () => {
    const v = checkShiftMixByCalendarWeek(p('M M M M M L L T T T T T L L N N N N N L L'), makeTeams(1, 1), [0], '2026-01-05')
    expect(v).toHaveLength(0)
    expect(weekday('2026-01-05')).toBe(0)
    const bad = checkShiftMixByCalendarWeek(p('M M M M L L T T T T L L N N N N L L'), makeTeams(1, 1), [0], '2026-01-05')
    expect(bad[0].mixedWeeks).toBeGreaterThan(0)
    expect(T.id && N.id).toBeTruthy()
  })
})

describe('búsqueda de patrón', () => {
  it('encuentra un patrón con fines de semana libres que cumple reglas y cobertura', async () => {
    const { suggestPattern } = await import('./patternSearch')
    const { rules } = resolveRules(defaultRuleSets(), base.activeRuleSetIds, {})
    // Sin iterations: usa el modo con reintentos internos (varias semillas), más fiable.
    const r = suggestPattern(base, rules, { priority: 'findes', seed: 1 })!
    expect(r.pattern).toHaveLength(49)
    expect(r.coverageDeficit).toBe(0)
    expect(r.violations).toBe(0)
    expect(r.maxFullWeekendsPerYear).toBe(30)
    expect(r.fullWeekendsPerYear).toBeGreaterThanOrEqual(22)
    // No debe haber saltos directos entre el primer y el último turno (p. ej. noche -> mañana):
    // solo se puede pasar por el turno vecino en el orden de horas de inicio.
    const order = [...base.shifts].sort((a, b) => a.start.localeCompare(b.start)).map((s) => s.id)
    for (let w = 0; w < r.weeks; w++) {
      const cur = r.pattern[w * 7]
      const prev = r.pattern[((w - 1 + r.weeks) % r.weeks) * 7]
      if (cur !== prev && cur !== OFF && prev !== OFF) {
        expect(Math.abs(order.indexOf(cur) - order.indexOf(prev))).toBeLessThanOrEqual(1)
      }
    }
    // Aplicado al calendario real, con una semana de desfase por equipo, la cobertura sigue completa.
    const cfg = { ...base, pattern: r.pattern, startDate: '2026-01-05', offsetMode: 'manual' as const,
      teams: base.teams.map((t, i) => ({ ...t, offset: r.offsets[i] })) }
    const days = buildSchedule(cfg, '2026-01-05', '2026-06-30')
    expect(days.every((d) => d.coverage.every((c) => c.ok))).toBe(true)
  }, 90000)

  it('la noche va en un único bloque seguido y no pasa de 1/3 del año', async () => {
    const { suggestPattern } = await import('./patternSearch')
    // Un bloque de noche REALMENTE seguido (sin ningún hueco de un día suelto dentro) solo es
    // posible con el descanso semanal acumulado en 14 días: con periodo de 7, el propio descanso
    // semanal obliga a cortarlo en dos tramos aunque a nivel de "semana" parezcan uno solo.
    const rules = {
      ...resolveRules(defaultRuleSets(), base.activeRuleSetIds, {}).rules,
      maxNightSharePerYear: 1 / 3,
      weeklyRestWindowDays: 14,
      weeklyRestMinHours: 72,
    }
    const r = suggestPattern(base, rules, { priority: 'findes', seed: 2 })!
    expect(r.violations).toBe(0)
    expect(r.coverageDeficit).toBe(0)
    expect(realBlocks(r.pattern, N.id)).toBe(1)
    const nightDays = r.pattern.filter((x) => x === N.id).length
    expect(nightDays / r.pattern.length).toBeLessThanOrEqual(1 / 3 + 1e-9)
  }, 60000)

  it('máximo de días seguidos por turno (5/5/7) con jornada anual casi exacta', async () => {
    const { suggestPattern } = await import('./patternSearch')
    const c = { ...base, teams: makeTeams(7, 4) }
    c.shifts = c.shifts.map((s, i) => ({ ...s, maxConsecutiveDays: [5, 5, 7][i] }))
    const convenio: RuleSet = {
      id: 'test-71', name: '', kind: 'convenio', description: '',
      values: {
        minRestBetweenShiftsHours: 12,
        // Descanso semanal acumulado en periodo de 14 días: día y medio por semana (72 h en 14
        // días), el mínimo que marca el Estatuto para el descanso acumulado (art. 37.1).
        weeklyRestWindowDays: 14,
        weeklyRestMinHours: 72,
        minDaysOffPerWeek: 2,
        vacationDays: 30,
        vacationDayType: VACATION_TYPE.NATURALES,
        maxAnnualWorkDays: 221,
        maxAnnualHours: 1736,
        annualHolidays: 14,
        holidayTreatment: HOLIDAY_TREATMENT.SE_TRABAJAN,
        maxNightSharePerYear: 1 / 3,
        // 5 días seguidos como máximo, salvo el bloque de noche (7 días, un único bloque seguido,
        // para no dejar huecos de cobertura ni tener que hacer dos semanas de noche contrapeadas).
        maxConsecutiveWorkDays: 5,
        // Sin esto, dos tramos de noche separados podían colarse como "0 incumplimientos" (antes
        // esto solo se desanimaba un poco en la búsqueda, nunca se comprobaba de verdad).
        maxNightBlocksPerCycle: 1,
      },
    }
    const { rules } = resolveRules([convenio], ['test-71'], {})
    // La semilla 12 es la que se comprobó a mano: llega a 30 findes Y a 1.750 h a la vez con estas
    // reglas. Con otras semillas el buscador a veces cede algo de findes o de horas para no romper
    // ninguna regla (es un heurístico, no un resolutor exacto: no garantiza el óptimo conjunto en
    // cada intento) — para eso está "generar otra opción" en la app. Esta prueba comprueba que el
    // óptimo conjunto SÍ es alcanzable, no que cualquier semilla lo encuentre a la primera.
    const r = suggestPattern(c, rules, { priority: 'findes', seed: 12 })!
    expect(r.coverageDeficit).toBe(0)
    expect(r.violations).toBe(0)
    expect(realBlocks(r.pattern, N.id)).toBe(1)
    expect(r.fullWeekendsPerYear).toBe(30)
    // El suelo pedido es 1.724 h. Con 30 fines de semana completos y el límite de 5 días seguidos
    // (que obliga a meter un día de descanso en cada cambio de mañana a tarde que no caiga justo en
    // fin de semana) el techo real está en unas 1.750 h — comprobado también con otra implementación
    // independiente del mismo generador, así que no es un límite matemático del problema, era un
    // óptimo local de nuestra búsqueda.
    expect(r.netAnnualHours).toBeGreaterThanOrEqual(1724)

    // Comprobación explícita, día a día y de forma circular (incluye el empalme semana 7 -> semana
    // 1), de que nunca se encadenan más de 5 días trabajados seguidos salvo que sean todos de noche.
    const L = r.pattern.length
    let run = 0
    let runAllNight = true
    let maxMixedRun = 0
    for (let d = 0; d < L * 2; d++) {
      const item = r.pattern[d % L]
      if (item !== OFF) {
        run++
        runAllNight = runAllNight && item === N.id
      } else {
        if (!runAllNight) maxMixedRun = Math.max(maxMixedRun, run)
        run = 0
        runAllNight = true
      }
    }
    expect(maxMixedRun).toBeLessThanOrEqual(5)
  }, 60000)
})

/** Cuenta las rachas seguidas de un turno en el patrón, día a día y de forma circular. */
function realBlocks(pattern: string[], shiftId: string): number {
  let blocks = 0
  for (let d = 0; d < pattern.length; d++) {
    const cur = pattern[d] === shiftId
    const prev = pattern[mod(d - 1, pattern.length)] === shiftId
    if (cur && !prev) blocks++
  }
  return blocks
}
