// Tipos de datos de toda la aplicación.
// Todo lo que el usuario configura vive en `BusinessConfig` y en la lista de `RuleSet`.
// El calendario NO se guarda: se calcula a partir de estos datos.

/** Fecha sin hora, en formato 'AAAA-MM-DD'. */
export type ISODate = string

/** Valor especial del patrón que significa "día libre". */
export const OFF = 'OFF'

/** Un elemento del patrón: el id de un turno o `OFF`. */
export type PatternItem = string

export interface Shift {
  id: string
  /** Letra corta que se ve en el calendario (M, T, N...). */
  code: string
  name: string
  /** Hora de inicio 'HH:MM'. */
  start: string
  /** Hora de fin 'HH:MM'. Si es menor o igual que el inicio, el turno acaba al día siguiente. */
  end: string
  color: string
  /** Marca el turno como nocturno (para la regla de noches seguidas). */
  isNight: boolean
  /** Máximo de días por semana en este turno (vacío = sin límite). */
  maxDaysPerWeek?: number | null
  /** Máximo de días SEGUIDOS en este turno, contando de un día para otro aunque cambie de semana (vacío = sin límite). */
  maxConsecutiveDays?: number | null
}

export interface Employee {
  id: string
  name: string
}

export interface Team {
  id: string
  name: string
  employees: Employee[]
  /** Desfase manual en días (solo se usa si `offsetMode` es 'manual'). */
  offset: number
}

/** Cómo se mide la cobertura mínima: por equipos completos o por número de personas. */
export type CoverageMode = 'equipos' | 'personas'

export interface CoverageRequirement {
  shiftId: string
  /** Mínimo de equipos o personas (según `coverageMode`). 0 = no necesita cobertura. */
  min: number
  /** Días de la semana en que se exige (0 = lunes ... 6 = domingo). */
  weekdays: number[]
}

export interface Holiday {
  date: ISODate
  name: string
}

export type AbsenceKind = 'vacaciones' | 'baja' | 'permiso'
export type ExceptionKind = AbsenceKind | 'intercambio' | 'cambio'

export interface ScheduleException {
  id: string
  kind: ExceptionKind
  employeeId: string
  from: ISODate
  to: ISODate
  /** Solo para 'intercambio': la otra persona con la que se intercambia el turno. */
  otherEmployeeId?: string
  /** Solo para 'cambio': el turno (o `OFF`) que se asigna en esas fechas. */
  shiftId?: PatternItem
  note?: string
}

export type OffsetMode = 'auto' | 'manual'

/** Automático: la app diseña el patrón sola. Manual: el usuario escribe el patrón (modo avanzado). */
export type PatternMode = 'auto' | 'manual'

/** Qué prioriza la generación automática después de la cobertura y las reglas. */
export type SearchPriority = 'findes' | 'equilibrio'

export interface BusinessConfig {
  name: string
  /** Día en que el primer equipo empieza el ciclo (posición 1 del patrón). */
  startDate: ISODate
  shifts: Shift[]
  teams: Team[]
  pattern: PatternItem[]
  coverageMode: CoverageMode
  coverage: CoverageRequirement[]
  offsetMode: OffsetMode
  patternMode: PatternMode
  autoPriority: SearchPriority
  /** Cambia para pedir otra opción distinta del generador automático. */
  autoSeed: number
  /** Huella de los datos con los que se generó el patrón automático (para saber si hay que regenerarlo). */
  autoKey?: string
  /** Marcos normativos activos, en orden: los últimos mandan sobre los primeros. */
  activeRuleSetIds: string[]
  /** Ajustes propios del negocio: se aplican encima de todos los marcos normativos. */
  ruleOverrides: RuleValues
  holidays: Holiday[]
  exceptions: ScheduleException[]
}

// ---------- Reglas ----------

export type RuleKey =
  | 'minRestBetweenShiftsHours'
  | 'maxConsecutiveWorkDays'
  | 'weeklyRestWindowDays'
  | 'weeklyRestMinHours'
  | 'minDaysOffPerWeek'
  | 'shiftMixInWeek'
  | 'shiftChangeMinDaysOff'
  | 'maxShiftHours'
  | 'maxWeeklyAvgHours'
  | 'maxAnnualHours'
  | 'maxAnnualWorkDays'
  | 'vacationDays'
  | 'vacationDayType'
  | 'annualHolidays'
  | 'holidayTreatment'
  | 'maxConsecutiveNights'

/**
 * Valores de reglas de un marco normativo.
 * - Clave ausente: este marco no dice nada (se hereda del anterior).
 * - `null`: sin límite (desactiva la regla aunque otro marco anterior la tuviera).
 * - número: el valor de la regla.
 */
export type RuleValues = Partial<Record<RuleKey, number | null>>

/** Reglas ya combinadas: `null` significa que la regla no se comprueba. */
export type EffectiveRules = Record<RuleKey, number | null>

export type RuleSetKind = 'estatuto' | 'convenio' | 'personalizado'

/** Un "marco normativo": el Estatuto, un convenio concreto, o un conjunto propio de reglas. */
export interface RuleSet {
  id: string
  name: string
  kind: RuleSetKind
  description: string
  values: RuleValues
  /** Viene incluido en la app (se puede duplicar pero no borrar). */
  builtin?: boolean
}
