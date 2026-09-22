import { describe, expect, it } from 'vitest'
import { buildSchedule, effectiveOffsets, vacationDaysUsed } from './calendar'
import { addDays, weekday } from './dates'
import { defaultConfig, defaultRuleSets, makeTeams } from './defaults'
import { computeOffsets, coverageTable } from './offsets'
import { resolveRules, RULE_KEYS, SHIFT_MIX } from './rules'
import { parsePatternText } from './shifts'
import { OFF, type EffectiveRules } from './types'
import { checkShiftMixByCalendarWeek, validatePattern } from './validation'

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
    const r = validatePattern(p('M M M M M M M L'), shifts, { ...noRules, maxConsecutiveWorkDays: 6 })
    expect(r.violations).toHaveLength(1)
    expect(validatePattern(p('M M M M M M L'), shifts, { ...noRules, maxConsecutiveWorkDays: 6 }).violations).toHaveLength(0)
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
    expect(r.violations.map((v) => v.rule)).toEqual(['maxAnnualWorkDays'])
  })

  it('el ejemplo por defecto cumple las reglas del ejemplo salvo la jornada anual', () => {
    const { rules } = resolveRules(defaultRuleSets(), base.activeRuleSetIds, {})
    const r = validatePattern(base.pattern, shifts, rules)
    expect(r.violations.map((v) => v.rule).sort()).toEqual(['maxAnnualHours', 'maxAnnualWorkDays'])
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

  it('regla "no mezclar turnos en la misma semana" sobre el calendario real', () => {
    const v = checkShiftMixByCalendarWeek(p('M M M M M L L T T T T T L L N N N N N L L'), makeTeams(1, 1), [0], '2026-01-05')
    expect(v).toHaveLength(0)
    expect(weekday('2026-01-05')).toBe(0)
    const bad = checkShiftMixByCalendarWeek(p('M M M M L L T T T T L L N N N N L L'), makeTeams(1, 1), [0], '2026-01-05')
    expect(bad[0].mixedWeeks).toBeGreaterThan(0)
    expect(T.id && N.id).toBeTruthy()
  })
})
