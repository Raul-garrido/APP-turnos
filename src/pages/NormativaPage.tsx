// Marcos normativos (Estatuto, convenios, reglas propias) y reglas que se aplican.

import { useRef, useState } from 'react'
import { Alert, Button, Card, Field, NumberInput, inputClass } from '../components/ui'
import { uid } from '../engine/defaults'
import { RULE_DEFINITIONS, RULE_GROUPS, type RuleDefinition } from '../engine/rules'
import type { RuleKey, RuleSet, RuleSetKind, RuleValues } from '../engine/types'
import { useRules } from '../store/derived'
import { useStore } from '../store/useStore'

const KIND_LABELS: Record<RuleSetKind, string> = {
  estatuto: 'Estatuto / ley',
  convenio: 'Convenio',
  personalizado: 'Reglas propias',
}

export function NormativaPage() {
  const [editing, setEditing] = useState<string | null>(null)
  return (
    <div className="flex flex-col gap-4">
      <Alert kind="info">
        Los <b>marcos normativos</b> guardan los valores de las reglas (el Estatuto, tu convenio, acuerdos propios...). Activa los que se
        aplican a tu negocio y ordénalos: <b>los de abajo mandan sobre los de arriba</b>. Al final se aplican los ajustes propios del
        negocio. Los valores incluidos son orientativos: comprueba siempre tu convenio.
      </Alert>
      <MarcosList editing={editing} setEditing={setEditing} />
      {editing && <MarcoEditor id={editing} onClose={() => setEditing(null)} />}
      <AjustesPropios />
      <ReglasEfectivas />
    </div>
  )
}

function MarcosList({ editing, setEditing }: { editing: string | null; setEditing: (id: string | null) => void }) {
  const ruleSets = useStore((s) => s.ruleSets)
  const active = useStore((s) => s.config.activeRuleSetIds)
  const update = useStore((s) => s.updateConfig)
  const updateSets = useStore((s) => s.updateRuleSets)
  const fileRef = useRef<HTMLInputElement>(null)

  const ordered = [
    ...active.map((id) => ruleSets.find((r) => r.id === id)).filter((r): r is RuleSet => !!r),
    ...ruleSets.filter((r) => !active.includes(r.id)),
  ]

  const toggle = (id: string) =>
    update((c) => {
      c.activeRuleSetIds = c.activeRuleSetIds.includes(id) ? c.activeRuleSetIds.filter((x) => x !== id) : [...c.activeRuleSetIds, id]
    })
  const move = (id: string, dir: -1 | 1) =>
    update((c) => {
      const i = c.activeRuleSetIds.indexOf(id)
      const j = i + dir
      if (i < 0 || j < 0 || j >= c.activeRuleSetIds.length) return
      ;[c.activeRuleSetIds[i], c.activeRuleSetIds[j]] = [c.activeRuleSetIds[j], c.activeRuleSetIds[i]]
    })
  const create = (base?: RuleSet) => {
    const id = uid()
    updateSets((r) =>
      void r.push({
        id,
        name: base ? `${base.name} (copia)` : 'Nuevo convenio',
        kind: base ? (base.kind === 'estatuto' ? 'personalizado' : base.kind) : 'convenio',
        description: base?.description ?? '',
        values: structuredClone(base?.values ?? {}),
      }),
    )
    setEditing(id)
  }
  const remove = (r: RuleSet) => {
    if (!confirm(`¿Eliminar "${r.name}"?`)) return
    updateSets((sets) => void sets.splice(sets.findIndex((x) => x.id === r.id), 1))
    update((c) => void (c.activeRuleSetIds = c.activeRuleSetIds.filter((x) => x !== r.id)))
    if (editing === r.id) setEditing(null)
  }
  const exportSet = (r: RuleSet) => {
    const data = { tipo: 'marco-normativo', version: 1, ...r, builtin: undefined }
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `${r.name.replace(/[^\w\- áéíóúñ]/gi, '')}.json`
    a.click()
    URL.revokeObjectURL(a.href)
  }
  const importSet = async (file: File) => {
    try {
      const data = JSON.parse(await file.text())
      if (!data || typeof data.values !== 'object') throw new Error()
      const values: RuleValues = {}
      for (const def of RULE_DEFINITIONS) {
        const v = data.values[def.key]
        if (v === null || typeof v === 'number') values[def.key] = v
      }
      updateSets(
        (r) =>
          void r.push({
            id: uid(),
            name: String(data.name ?? 'Marco importado'),
            kind: (['estatuto', 'convenio', 'personalizado'].includes(data.kind) ? data.kind : 'convenio') as RuleSetKind,
            description: String(data.description ?? ''),
            values,
          }),
      )
    } catch {
      alert('El archivo no es un marco normativo válido.')
    }
  }

  return (
    <Card
      title="Marcos normativos"
      actions={
        <>
          <Button variant="primary" onClick={() => create()}>
            + Nuevo convenio
          </Button>
          <Button onClick={() => fileRef.current?.click()}>Importar</Button>
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0]
              if (f) importSet(f)
              e.target.value = ''
            }}
          />
        </>
      }
    >
      <ul className="flex flex-col gap-2">
        {ordered.map((r) => {
          const isActive = active.includes(r.id)
          const pos = active.indexOf(r.id)
          return (
            <li
              key={r.id}
              className={`flex flex-wrap items-center gap-2 rounded-lg border p-2 ${
                editing === r.id ? 'border-indigo-400 bg-indigo-50' : isActive ? 'border-slate-300' : 'border-dashed border-slate-200 opacity-70'
              }`}
            >
              <input type="checkbox" checked={isActive} onChange={() => toggle(r.id)} title="Aplicar este marco" />
              {isActive && <span className="w-6 text-center text-xs font-semibold text-slate-500">{pos + 1}º</span>}
              <div className="min-w-0 flex-1">
                <div className="font-medium">{r.name}</div>
                <div className="text-xs text-slate-500">
                  {KIND_LABELS[r.kind]} · {Object.keys(r.values).length} reglas definidas
                  {r.builtin && ' · incluido en la app (solo lectura)'}
                </div>
              </div>
              {isActive && (
                <>
                  <Button variant="ghost" className="px-2" disabled={pos === 0} onClick={() => move(r.id, -1)} aria-label="Subir">
                    ↑
                  </Button>
                  <Button variant="ghost" className="px-2" disabled={pos === active.length - 1} onClick={() => move(r.id, 1)} aria-label="Bajar">
                    ↓
                  </Button>
                </>
              )}
              <Button onClick={() => setEditing(editing === r.id ? null : r.id)}>{r.builtin ? 'Ver' : 'Editar'}</Button>
              <Button onClick={() => create(r)}>Duplicar</Button>
              <Button onClick={() => exportSet(r)}>Exportar</Button>
              {!r.builtin && (
                <Button variant="danger" onClick={() => remove(r)}>
                  Eliminar
                </Button>
              )}
            </li>
          )
        })}
      </ul>
    </Card>
  )
}

function MarcoEditor({ id, onClose }: { id: string; onClose: () => void }) {
  const ruleSet = useStore((s) => s.ruleSets.find((r) => r.id === id))
  const updateSets = useStore((s) => s.updateRuleSets)
  if (!ruleSet) return null
  const readOnly = !!ruleSet.builtin
  const set = (fn: (r: RuleSet) => void) =>
    updateSets((sets) => {
      const r = sets.find((x) => x.id === id)
      if (r) fn(r)
    })
  return (
    <Card title={readOnly ? ruleSet.name : `Editar: ${ruleSet.name}`} actions={<Button onClick={onClose}>Cerrar</Button>}>
      {readOnly && (
        <Alert kind="info">Este marco viene con la app y no se puede modificar. Pulsa «Duplicar» para crear tu propia versión.</Alert>
      )}
      <div className="my-3 grid gap-3 sm:grid-cols-3">
        <Field label="Nombre">
          <input className={inputClass} disabled={readOnly} value={ruleSet.name} onChange={(e) => set((r) => void (r.name = e.target.value))} />
        </Field>
        <Field label="Tipo">
          <select
            className={inputClass}
            disabled={readOnly}
            value={ruleSet.kind}
            onChange={(e) => set((r) => void (r.kind = e.target.value as RuleSetKind))}
          >
            {Object.entries(KIND_LABELS).map(([k, l]) => (
              <option key={k} value={k}>
                {l}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Descripción / referencia">
          <textarea
            className={inputClass}
            rows={2}
            disabled={readOnly}
            value={ruleSet.description}
            placeholder="Ej.: Convenio de ... (BOE/BOP, artículo ...)"
            onChange={(e) => set((r) => void (r.description = e.target.value))}
          />
        </Field>
      </div>
      <RuleValuesEditor
        values={ruleSet.values}
        readOnly={readOnly}
        onChange={(key, v) =>
          set((r) => {
            if (v === undefined) delete r.values[key]
            else r.values[key] = v
          })
        }
      />
    </Card>
  )
}

function AjustesPropios() {
  const overrides = useStore((s) => s.config.ruleOverrides)
  const update = useStore((s) => s.updateConfig)
  return (
    <Card title="Ajustes propios del negocio">
      <p className="mb-3 text-sm text-slate-600">
        Se aplican por encima de todos los marcos. Úsalos para cambios puntuales sin tocar el convenio.
      </p>
      <RuleValuesEditor
        values={overrides}
        onChange={(key, v) =>
          update((c) => {
            if (v === undefined) delete c.ruleOverrides[key]
            else c.ruleOverrides[key] = v
          })
        }
      />
    </Card>
  )
}

/** Editor de los valores de reglas: cada regla puede no estar regulada, no tener límite o tener un valor. */
function RuleValuesEditor({
  values,
  onChange,
  readOnly,
}: {
  values: RuleValues
  onChange: (key: RuleKey, value: number | null | undefined) => void
  readOnly?: boolean
}) {
  return (
    <div className="flex flex-col gap-4">
      {RULE_GROUPS.map((g) => (
        <div key={g.id}>
          <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-500">{g.label}</h3>
          <div className="flex flex-col divide-y divide-slate-100">
            {RULE_DEFINITIONS.filter((d) => d.group === g.id).map((def) => (
              <RuleRow key={def.key} def={def} value={values[def.key]} defined={def.key in values} onChange={onChange} readOnly={readOnly} />
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

function RuleRow({
  def,
  value,
  defined,
  onChange,
  readOnly,
}: {
  def: RuleDefinition
  value: number | null | undefined
  defined: boolean
  onChange: (key: RuleKey, value: number | null | undefined) => void
  readOnly?: boolean
}) {
  const state = !defined || value === undefined ? 'hereda' : value === null ? 'sinlimite' : 'valor'
  const offLabel = def.direction === 'param' ? 'No se aplica' : 'Sin límite'
  return (
    <div className="flex flex-wrap items-center gap-2 py-2">
      <div className="min-w-56 flex-1">
        <div className="text-sm font-medium text-slate-800">{def.label}</div>
        <div className="text-xs text-slate-500">{def.help}</div>
      </div>
      <select
        className={inputClass}
        disabled={readOnly}
        value={state}
        onChange={(e) => {
          const s = e.target.value
          if (s === 'hereda') onChange(def.key, undefined)
          else if (s === 'sinlimite') onChange(def.key, null)
          else onChange(def.key, def.options ? def.options[0].value : 0)
        }}
      >
        <option value="hereda">No lo regula</option>
        <option value="sinlimite">{offLabel}</option>
        <option value="valor">{def.options ? 'Elegir' : 'Valor'}</option>
      </select>
      {state === 'valor' &&
        (def.options ? (
          <select className={inputClass} disabled={readOnly} value={value ?? ''} onChange={(e) => onChange(def.key, Number(e.target.value))}>
            {def.options.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        ) : (
          <span className="flex items-center gap-1 text-sm">
            {readOnly ? <b>{value}</b> : <NumberInput value={value} min={0} step={0.5} onChange={(v) => onChange(def.key, v)} />}
            {def.unit}
          </span>
        ))}
    </div>
  )
}

function ReglasEfectivas() {
  const { sources } = useRules()
  return (
    <Card title="Reglas que se aplican ahora">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-left text-slate-500">
            <tr>
              <th className="p-1">Regla</th>
              <th className="p-1">Valor</th>
              <th className="p-1">Viene de</th>
            </tr>
          </thead>
          <tbody>
            {RULE_DEFINITIONS.map((def) => {
              const src = sources[def.key]
              const shown =
                src.value == null
                  ? def.direction === 'param'
                    ? '—'
                    : 'Sin límite'
                  : def.options
                    ? def.options.find((o) => o.value === src.value)?.label
                    : `${src.value} ${def.unit}`
              return (
                <tr key={def.key} className="border-t border-slate-100">
                  <td className="p-1">{def.label}</td>
                  <td className="p-1 font-medium">{shown}</td>
                  <td className="p-1 text-slate-500">{src.source || 'Ningún marco'}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </Card>
  )
}
