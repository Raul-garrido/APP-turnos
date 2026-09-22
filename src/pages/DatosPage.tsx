// Copia de seguridad de los datos y restablecer el ejemplo.

import { useRef } from 'react'
import { Alert, Button, Card } from '../components/ui'
import { download } from '../export/download'
import { useStore, type AppData } from '../store/useStore'

export function DatosPage() {
  const config = useStore((s) => s.config)
  const ruleSets = useStore((s) => s.ruleSets)
  const replaceAll = useStore((s) => s.replaceAll)
  const reset = useStore((s) => s.reset)
  const fileRef = useRef<HTMLInputElement>(null)

  const exportAll = () => {
    const data = { tipo: 'copia-cuadrante', version: 1, config, ruleSets }
    download(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }), `copia ${config.name} ${new Date().toISOString().slice(0, 10)}.json`)
  }
  const importAll = async (file: File) => {
    try {
      const data = JSON.parse(await file.text()) as Partial<AppData>
      if (!data.config || !Array.isArray(data.ruleSets) || !Array.isArray(data.config.teams)) throw new Error()
      if (!confirm('Se sustituirán todos los datos actuales por los de la copia. ¿Continuar?')) return
      replaceAll({ config: data.config, ruleSets: data.ruleSets })
    } catch {
      alert('El archivo no es una copia de seguridad válida.')
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <Alert kind="info">
        En esta versión de prueba los datos se guardan <b>solo en este navegador</b>. Si borras los datos del navegador o cambias de
        dispositivo, se pierden: descarga una copia de seguridad de vez en cuando.
      </Alert>
      <Card title="Copia de seguridad">
        <div className="flex flex-wrap gap-2">
          <Button variant="primary" onClick={exportAll}>Descargar copia</Button>
          <Button onClick={() => fileRef.current?.click()}>Restaurar copia</Button>
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0]
              if (f) importAll(f)
              e.target.value = ''
            }}
          />
        </div>
      </Card>
      <Card title="Empezar de nuevo">
        <p className="mb-3 text-sm text-slate-600">Borra todo y vuelve a cargar el ejemplo de 7 equipos de 4 personas.</p>
        <Button
          variant="danger"
          onClick={() => confirm('¿Seguro? Se perderán todos los datos que no hayas guardado en una copia.') && reset()}
        >
          Restablecer ejemplo
        </Button>
      </Card>
    </div>
  )
}
