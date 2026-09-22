// Datos calculados a partir del estado (reglas efectivas, desfases, validación).

import { useMemo } from 'react'
import { ABSENCE_CODES, effectiveOffsets, type Cell } from '../engine/calendar'
import { resolveRules } from '../engine/rules'
import { findShift, itemCode } from '../engine/shifts'
import type { BusinessConfig } from '../engine/types'
import { validatePattern } from '../engine/validation'
import { useStore } from './useStore'

export function useRules() {
  const config = useStore((s) => s.config)
  const ruleSets = useStore((s) => s.ruleSets)
  return useMemo(
    () => resolveRules(ruleSets, config.activeRuleSetIds, config.ruleOverrides),
    [ruleSets, config.activeRuleSetIds, config.ruleOverrides],
  )
}

export function useOffsets() {
  const config = useStore((s) => s.config)
  return useMemo(() => effectiveOffsets(config), [config])
}

export function useValidation() {
  const config = useStore((s) => s.config)
  const { rules } = useRules()
  return useMemo(() => validatePattern(config.pattern, config.shifts, rules), [config.pattern, config.shifts, rules])
}

export const ABSENCE_COLOR = '#e2e8f0'
export const OFF_COLOR = '#ffffff'

/** Letra y color con que se pinta una celda del calendario. */
export function cellDisplay(config: BusinessConfig, cell: Cell): { code: string; color: string } {
  if (cell.absence) return { code: ABSENCE_CODES[cell.absence], color: ABSENCE_COLOR }
  const s = findShift(config.shifts, cell.item)
  return { code: itemCode(config.shifts, cell.item), color: s?.color ?? OFF_COLOR }
}
