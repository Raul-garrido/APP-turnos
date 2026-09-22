// Catálogo de reglas que la app sabe comprobar, marcos normativos incluidos
// y cómo se combinan varios marcos (Estatuto + convenio + ajustes propios).

import type { EffectiveRules, RuleKey, RuleSet, RuleValues } from './types'

export interface RuleOption {
  value: number
  label: string
}

export interface RuleDefinition {
  key: RuleKey
  label: string
  help: string
  unit: string
  /**
   * 'min' = mínimo que hay que alcanzar; 'max' = máximo que no se puede superar;
   * 'param' = dato del convenio que se usa en los cálculos (no es un límite).
   */
  direction: 'min' | 'max' | 'param'
  /** Si existe, la regla se elige de una lista en vez de escribir un número. */
  options?: RuleOption[]
  group: 'descansos' | 'turnos' | 'jornada'
}

/** Valores de la regla "turnos distintos en la misma semana". */
export const SHIFT_MIX = { NUNCA: 0, TRAS_DESCANSO: 1, SIEMPRE: 2 } as const
/** Valores de la regla "tipo de días de vacaciones". */
export const VACATION_TYPE = { NATURALES: 0, HABILES: 1 } as const

export const RULE_GROUPS: { id: RuleDefinition['group']; label: string }[] = [
  { id: 'descansos', label: 'Descansos' },
  { id: 'turnos', label: 'Cambios de turno' },
  { id: 'jornada', label: 'Jornada y vacaciones' },
]

export const RULE_DEFINITIONS: RuleDefinition[] = [
  {
    key: 'minRestBetweenShiftsHours',
    group: 'descansos',
    label: 'Descanso mínimo entre jornadas',
    help: 'Horas que deben pasar desde que acaba un turno hasta que empieza el siguiente.',
    unit: 'horas',
    direction: 'min',
  },
  {
    key: 'weeklyRestWindowDays',
    group: 'descansos',
    label: 'Periodo de cálculo del descanso semanal',
    help: 'Los descansos semanales se comprueban en cualquier bloque de este número de días seguidos (7 = cada semana; 14 = acumulable en dos semanas).',
    unit: 'días',
    direction: 'param',
  },
  {
    key: 'weeklyRestMinHours',
    group: 'descansos',
    label: 'Descanso semanal ininterrumpido mínimo',
    help: 'Cada periodo semanal debe incluir un descanso de al menos estas horas seguidas (36 h = día y medio, 48 h = dos días). El descanso puede empezar o acabar fuera del periodo. Si el periodo es de 14 días, pon el total acumulado.',
    unit: 'horas',
    direction: 'min',
  },
  {
    key: 'minDaysOffPerWeek',
    group: 'descansos',
    label: 'Días libres mínimos por semana',
    help: 'Días completos sin trabajar que debe haber en cada semana. Con un periodo de 14 días se exige el doble dentro de esos 14 días.',
    unit: 'días',
    direction: 'min',
  },
  {
    key: 'maxConsecutiveWorkDays',
    group: 'descansos',
    label: 'Máximo de días seguidos trabajados',
    help: 'Número máximo de días de trabajo consecutivos sin un día libre.',
    unit: 'días',
    direction: 'max',
  },
  {
    key: 'shiftMixInWeek',
    group: 'turnos',
    label: '¿Se puede trabajar en turnos distintos en la misma semana?',
    help: 'Si eliges "Solo tras descansar", el cambio de turno exige los días libres de la regla siguiente. Si eliges "No", se comprueba cada semana de lunes a domingo del calendario real de cada equipo.',
    unit: '',
    direction: 'param',
    options: [
      { value: SHIFT_MIX.SIEMPRE, label: 'Sí, sin condiciones' },
      { value: SHIFT_MIX.TRAS_DESCANSO, label: 'Sí, solo tras descansar' },
      { value: SHIFT_MIX.NUNCA, label: 'No' },
    ],
  },
  {
    key: 'shiftChangeMinDaysOff',
    group: 'turnos',
    label: 'Días libres antes de cambiar de tipo de turno',
    help: 'Para pasar de un turno a otro distinto (p. ej. de mañana a tarde) debe haber al menos estos días libres entre medias. Se aplica cuando la regla anterior es "Solo tras descansar".',
    unit: 'días',
    direction: 'min',
  },
  {
    key: 'maxConsecutiveNights',
    group: 'turnos',
    label: 'Máximo de noches seguidas',
    help: 'Número máximo de días seguidos con turno nocturno (un día libre corta la racha).',
    unit: 'noches',
    direction: 'max',
  },
  {
    key: 'maxShiftHours',
    group: 'jornada',
    label: 'Máximo de horas por jornada',
    help: 'Duración máxima de un turno.',
    unit: 'horas',
    direction: 'max',
  },
  {
    key: 'maxWeeklyAvgHours',
    group: 'jornada',
    label: 'Máximo de horas semanales (media)',
    help: 'Media de horas trabajadas por semana a lo largo del ciclo.',
    unit: 'horas',
    direction: 'max',
  },
  {
    key: 'maxAnnualHours',
    group: 'jornada',
    label: 'Jornada anual en horas',
    help: 'Horas de trabajo al año que fija el convenio. Se compara con la estimación del ciclo descontando vacaciones.',
    unit: 'horas',
    direction: 'max',
  },
  {
    key: 'maxAnnualWorkDays',
    group: 'jornada',
    label: 'Jornada anual en días',
    help: 'Días de trabajo al año que fija el convenio. Se compara con la estimación del ciclo descontando vacaciones.',
    unit: 'días',
    direction: 'max',
  },
  {
    key: 'vacationDays',
    group: 'jornada',
    label: 'Días de vacaciones al año',
    help: 'Se usan para estimar la jornada anual real y para contar las vacaciones de cada persona.',
    unit: 'días',
    direction: 'param',
  },
  {
    key: 'vacationDayType',
    group: 'jornada',
    label: 'Tipo de días de vacaciones',
    help: 'Naturales: cuentan todos los días del periodo. Hábiles: solo cuentan los días en que a la persona le tocaba trabajar según el cuadrante.',
    unit: '',
    direction: 'param',
    options: [
      { value: VACATION_TYPE.NATURALES, label: 'Naturales' },
      { value: VACATION_TYPE.HABILES, label: 'Hábiles (días de trabajo)' },
    ],
  },
]

export const RULE_KEYS: RuleKey[] = RULE_DEFINITIONS.map((r) => r.key)

export function ruleDefinition(key: RuleKey): RuleDefinition {
  return RULE_DEFINITIONS.find((r) => r.key === key)!
}

export const ESTATUTO_ID = 'builtin-estatuto'

/** Marcos normativos que vienen con la app. Son valores de referencia: el usuario debe verificarlos. */
export const BUILTIN_RULE_SETS: RuleSet[] = [
  {
    id: ESTATUTO_ID,
    name: 'Estatuto de los Trabajadores (referencia)',
    kind: 'estatuto',
    builtin: true,
    description:
      'Valores orientativos tomados del Estatuto de los Trabajadores (arts. 34 y 37): 12 h entre jornadas, ' +
      'máximo 9 h ordinarias diarias, 40 h semanales de media, día y medio de descanso semanal (el Estatuto permite acumularlo en 14 días: ' +
      'cambia el periodo a 14 y el descanso a 72 h si te interesa) ' +
      'y 30 días naturales de vacaciones. ' +
      'Existen excepciones (RD 1561/1995) y el convenio puede cambiar estos valores: verifícalos.',
    values: {
      minRestBetweenShiftsHours: 12,
      maxShiftHours: 9,
      maxWeeklyAvgHours: 40,
      weeklyRestWindowDays: 7,
      weeklyRestMinHours: 36,
      vacationDays: 30,
      vacationDayType: 0,
    },
  },
]

export interface EffectiveRuleSource {
  value: number | null
  /** Nombre del marco que fija el valor ('' si ninguno lo regula). */
  source: string
}

/**
 * Combina los marcos activos en orden. Cada marco sobrescribe los valores de los anteriores
 * y los ajustes propios del negocio se aplican al final.
 */
export function resolveRules(
  ruleSets: RuleSet[],
  activeIds: string[],
  overrides: RuleValues,
): { rules: EffectiveRules; sources: Record<RuleKey, EffectiveRuleSource> } {
  const sources = Object.fromEntries(RULE_KEYS.map((k) => [k, { value: null, source: '' }])) as Record<
    RuleKey,
    EffectiveRuleSource
  >
  const layers: { name: string; values: RuleValues }[] = [
    ...activeIds
      .map((id) => ruleSets.find((r) => r.id === id))
      .filter((r): r is RuleSet => !!r)
      .map((r) => ({ name: r.name, values: r.values })),
    { name: 'Ajustes propios del negocio', values: overrides },
  ]
  for (const layer of layers) {
    for (const key of RULE_KEYS) {
      if (key in layer.values && layer.values[key] !== undefined) {
        sources[key] = { value: layer.values[key] ?? null, source: layer.name }
      }
    }
  }
  const rules = Object.fromEntries(RULE_KEYS.map((k) => [k, sources[k].value])) as EffectiveRules
  return { rules, sources }
}
