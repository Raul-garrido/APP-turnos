// Ejecuta la búsqueda de patrón en segundo plano para que la app no se congele.
import { suggestPattern, type PatternSearchOptions } from './patternSearch'
import type { BusinessConfig, EffectiveRules } from './types'

self.onmessage = (e: MessageEvent<{ config: BusinessConfig; rules: EffectiveRules; opts: PatternSearchOptions }>) => {
  const { config, rules, opts } = e.data
  self.postMessage(suggestPattern(config, rules, opts))
}
