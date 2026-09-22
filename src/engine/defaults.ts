// Configuración de ejemplo con la que arranca la app (todo es editable).

import { todayISO, startOfWeek } from './dates'
import { BUILTIN_RULE_SETS, ESTATUTO_ID, HOLIDAY_TREATMENT, SHIFT_MIX, VACATION_TYPE } from './rules'
import { parsePatternText } from './shifts'
import type { BusinessConfig, RuleSet, Shift, Team } from './types'

export const uid = () => Math.random().toString(36).slice(2, 10)

export const DEFAULT_COLORS = ['#fde68a', '#bfdbfe', '#c4b5fd', '#fecaca', '#bbf7d0', '#fbcfe8', '#fed7aa']

export function makeTeams(count: number, perTeam: number, startNumber = 1): Team[] {
  let n = startNumber
  return Array.from({ length: count }, (_, i) => ({
    id: uid(),
    name: `Equipo ${i + 1}`,
    offset: 0,
    employees: Array.from({ length: perTeam }, () => ({ id: uid(), name: `Persona ${n++}` })),
  }))
}

export const EXAMPLE_CONVENIO_ID = 'ejemplo-convenio'

export function exampleConvenio(): RuleSet {
  return {
    id: EXAMPLE_CONVENIO_ID,
    name: 'Mi convenio (ejemplo, edítalo)',
    kind: 'convenio',
    description:
      'Ejemplo: 2 días de descanso semanal con 48 h seguidas, 12 h entre jornadas, 30 días naturales de vacaciones, ' +
      'jornada anual de 221 días y 1.736 h, 14 festivos que se trabajan según el cuadrante, y cambio de turno en la semana solo tras 2 días libres.',
    values: {
      minRestBetweenShiftsHours: 12,
      weeklyRestWindowDays: 7,
      weeklyRestMinHours: 48,
      minDaysOffPerWeek: 2,
      shiftMixInWeek: SHIFT_MIX.TRAS_DESCANSO,
      shiftChangeMinDaysOff: 2,
      vacationDays: 30,
      vacationDayType: VACATION_TYPE.NATURALES,
      maxAnnualWorkDays: 221,
      maxAnnualHours: 1736,
      annualHolidays: 14,
      holidayTreatment: HOLIDAY_TREATMENT.SE_TRABAJAN,
    },
  }
}

export function defaultRuleSets(): RuleSet[] {
  return [...BUILTIN_RULE_SETS.map((r) => structuredClone(r)), exampleConvenio()]
}

export function defaultConfig(): BusinessConfig {
  const shifts: Shift[] = [
    { id: uid(), code: 'M', name: 'Mañana', start: '06:00', end: '14:00', color: DEFAULT_COLORS[0], isNight: false },
    { id: uid(), code: 'T', name: 'Tarde', start: '14:00', end: '22:00', color: DEFAULT_COLORS[1], isNight: false },
    { id: uid(), code: 'N', name: 'Noche', start: '22:00', end: '06:00', color: DEFAULT_COLORS[2], isNight: true },
  ]
  return {
    name: 'Mi negocio',
    startDate: startOfWeek(todayISO()),
    shifts,
    teams: makeTeams(7, 4),
    pattern: parsePatternText('M M M M L L T T T T L L N N N N L L', shifts).pattern,
    coverageMode: 'equipos',
    coverage: shifts.map((s) => ({ shiftId: s.id, min: 1, weekdays: [0, 1, 2, 3, 4, 5, 6] })),
    offsetMode: 'auto',
    activeRuleSetIds: [ESTATUTO_ID, EXAMPLE_CONVENIO_ID],
    ruleOverrides: {},
    holidays: [],
    exceptions: [],
  }
}
