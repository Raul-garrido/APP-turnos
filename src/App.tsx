import { useState } from 'react'
import { CalendarioPage } from './pages/CalendarioPage'
import { DatosPage } from './pages/DatosPage'
import { NegocioPage } from './pages/NegocioPage'
import { NormativaPage } from './pages/NormativaPage'
import { PatronPage } from './pages/PatronPage'
import { DISCLAIMER } from './export/table'
import { useStore } from './store/useStore'

const TABS = [
  { id: 'negocio', label: '1. Negocio', Page: NegocioPage },
  { id: 'normativa', label: '2. Normativa', Page: NormativaPage },
  { id: 'patron', label: '3. Patrón y equipos', Page: PatronPage },
  { id: 'calendario', label: '4. Calendario', Page: CalendarioPage },
  { id: 'datos', label: 'Datos', Page: DatosPage },
] as const

type TabId = (typeof TABS)[number]['id']

export default function App() {
  const [tab, setTab] = useState<TabId>(() => {
    try {
      return (localStorage.getItem('app-turnos-tab') as TabId) || 'negocio'
    } catch {
      return 'negocio'
    }
  })
  const name = useStore((s) => s.config.name)
  const current = TABS.find((t) => t.id === tab) ?? TABS[0]
  const select = (id: TabId) => {
    setTab(id)
    try {
      localStorage.setItem('app-turnos-tab', id)
    } catch {
      /* sin almacenamiento: no pasa nada */
    }
  }

  return (
    <div className="min-h-screen bg-slate-100 pb-28 text-slate-900">
      <header className="sticky top-0 z-10 border-b border-slate-200 bg-white/95 backdrop-blur">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3">
          <div>
            <div className="text-lg font-bold text-indigo-700">Cuadrante de turnos</div>
            <div className="text-xs text-slate-500">{name}</div>
          </div>
          <nav className="-mx-1 flex gap-1 overflow-x-auto">
            {TABS.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => select(t.id)}
                className={`rounded-lg px-3 py-1.5 text-sm font-medium whitespace-nowrap ${
                  tab === t.id ? 'bg-indigo-600 text-white' : 'text-slate-600 hover:bg-slate-100'
                }`}
              >
                {t.label}
              </button>
            ))}
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-7xl px-4 py-4">
        <current.Page />
      </main>
      <footer className="fixed right-0 bottom-0 left-0 z-10 border-t border-amber-200 bg-amber-50 px-4 py-2 text-center text-xs text-amber-900">
        {DISCLAIMER}
      </footer>
    </div>
  )
}
