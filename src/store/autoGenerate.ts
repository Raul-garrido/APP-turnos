// Generación automática del cuadrante: cada vez que cambian los datos que importan
// (equipos, turnos, cobertura, reglas), la app vuelve a diseñar el patrón sola en segundo plano.

import { useEffect, useMemo } from 'react'
import { create } from 'zustand'
import { startOfWeek } from '../engine/dates'
import type { PatternSuggestion } from '../engine/patternSearch'
import type { BusinessConfig, EffectiveRules } from '../engine/types'
import { useRules } from './derived'
import { useStore } from './useStore'

type GenState = 'idle' | 'running' | 'done' | 'error'

interface GenStatus {
  state: GenState
  result: PatternSuggestion | null
  message: string
}

export const useGenStatus = create<GenStatus>(() => ({ state: 'idle', result: null, message: '' }))

/** Huella de todo lo que influye en el patrón generado. */
export function generationKey(config: BusinessConfig, rules: EffectiveRules): string {
  return JSON.stringify([
    config.teams.map((t) => t.employees.length),
    config.shifts.map((s) => [s.id, s.start, s.end, s.isNight, s.maxDaysPerWeek ?? null]),
    config.coverage,
    config.coverageMode,
    rules,
    config.autoPriority,
    config.autoSeed,
  ])
}

let worker: Worker | null = null
let timer: ReturnType<typeof setTimeout> | undefined

/** Se monta una sola vez (en App) y mantiene el patrón automático al día. */
export function useAutoGenerate() {
  const config = useStore((s) => s.config)
  const update = useStore((s) => s.updateConfig)
  const { rules } = useRules()
  const key = useMemo(() => generationKey(config, rules), [config, rules])
  const needed = config.patternMode === 'auto' && key !== config.autoKey

  useEffect(() => {
    if (!needed) return
    clearTimeout(timer)
    worker?.terminate()
    useGenStatus.setState({ state: 'running', message: '' })
    // Esperamos un momento por si el usuario sigue escribiendo.
    timer = setTimeout(() => {
      const w = new Worker(new URL('../engine/patternSearch.worker.ts', import.meta.url), { type: 'module' })
      worker = w
      w.onmessage = (e: MessageEvent<PatternSuggestion | null>) => {
        w.terminate()
        if (worker === w) worker = null
        const result = e.data
        if (!result) {
          useGenStatus.setState({
            state: 'error',
            result: null,
            message: 'Para generar el cuadrante hace falta al menos un equipo y un turno con cobertura mínima.',
          })
          update((c) => void (c.autoKey = key))
          return
        }
        update((c) => {
          c.pattern = result.pattern
          c.startDate = startOfWeek(c.startDate)
          c.offsetMode = 'manual'
          c.teams.forEach((t, i) => (t.offset = result.offsets[i] ?? 0))
          c.autoKey = key
        })
        useGenStatus.setState({
          state: result.violations || result.coverageDeficit ? 'error' : 'done',
          result,
          message:
            result.violations || result.coverageDeficit
              ? 'No se ha encontrado un cuadrante que cumpla todas las reglas y la cobertura. Revisa si son compatibles con el número de equipos o pide otra opción.'
              : '',
        })
      }
      w.postMessage({ config, rules, opts: { priority: config.autoPriority, seed: config.autoSeed } })
    }, 700)
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [needed, key])
}
