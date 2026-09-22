// Estado de la app. De momento se guarda en el navegador (localStorage).
// Más adelante este es el único sitio que habrá que cambiar para guardar en la nube (Supabase).

import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { defaultConfig, defaultRuleSets } from '../engine/defaults'
import { BUILTIN_RULE_SETS } from '../engine/rules'
import type { BusinessConfig, RuleSet } from '../engine/types'

export interface AppData {
  config: BusinessConfig
  ruleSets: RuleSet[]
}

interface AppState extends AppData {
  /** Modifica la configuración: recibe una copia que se puede cambiar directamente. */
  updateConfig: (recipe: (c: BusinessConfig) => void) => void
  updateRuleSets: (recipe: (r: RuleSet[]) => void) => void
  replaceAll: (data: AppData) => void
  reset: () => void
}

export const useStore = create<AppState>()(
  persist(
    (set) => ({
      config: defaultConfig(),
      ruleSets: defaultRuleSets(),
      updateConfig: (recipe) =>
        set((s) => {
          const c = structuredClone(s.config)
          recipe(c)
          return { config: c }
        }),
      updateRuleSets: (recipe) =>
        set((s) => {
          const r = structuredClone(s.ruleSets)
          recipe(r)
          return { ruleSets: r }
        }),
      replaceAll: (data) => set({ config: data.config, ruleSets: withBuiltins(data.ruleSets) }),
      reset: () => set({ config: defaultConfig(), ruleSets: defaultRuleSets() }),
    }),
    {
      name: 'app-turnos',
      version: 1,
      partialize: (s) => ({ config: s.config, ruleSets: s.ruleSets }),
      // Los marcos incluidos en la app se actualizan siempre con la versión del código.
      merge: (persisted, current) => {
        const p = persisted as Partial<AppData> | undefined
        return {
          ...current,
          ...(p?.config ? { config: { ...current.config, ...p.config } } : {}),
          ruleSets: withBuiltins(p?.ruleSets ?? current.ruleSets),
        }
      },
    },
  ),
)

function withBuiltins(sets: RuleSet[]): RuleSet[] {
  const own = sets.filter((r) => !BUILTIN_RULE_SETS.some((b) => b.id === r.id))
  return [...BUILTIN_RULE_SETS.map((b) => structuredClone(b)), ...own]
}
