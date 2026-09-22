// Piezas de interfaz reutilizables (tarjetas, botones, campos).

import type { ReactNode } from 'react'

export function Card({ title, children, actions }: { title?: ReactNode; children: ReactNode; actions?: ReactNode }) {
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      {(title || actions) && (
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          {title && <h2 className="text-lg font-semibold text-slate-800">{title}</h2>}
          {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
        </div>
      )}
      {children}
    </section>
  )
}

type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' | 'danger' | 'ghost' }

export function Button({ variant = 'secondary', className = '', ...props }: ButtonProps) {
  const styles = {
    primary: 'bg-indigo-600 text-white hover:bg-indigo-700 border-indigo-600',
    secondary: 'bg-white text-slate-700 hover:bg-slate-50 border-slate-300',
    danger: 'bg-white text-red-600 hover:bg-red-50 border-red-300',
    ghost: 'bg-transparent text-slate-600 hover:bg-slate-100 border-transparent',
  }[variant]
  return (
    <button
      type="button"
      className={`rounded-lg border px-3 py-1.5 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-50 ${styles} ${className}`}
      {...props}
    />
  )
}

export const inputClass =
  'rounded-lg border border-slate-300 px-2 py-1.5 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500'

export function Field({ label, help, children }: { label: string; help?: string; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1 text-sm">
      <span className="font-medium text-slate-700">{label}</span>
      {children}
      {help && <span className="text-xs text-slate-500">{help}</span>}
    </label>
  )
}

export function NumberInput({
  value,
  onChange,
  min,
  step,
  className = '',
}: {
  value: number | null | undefined
  onChange: (v: number) => void
  min?: number
  step?: number
  className?: string
}) {
  return (
    <input
      type="number"
      className={`${inputClass} w-24 ${className}`}
      value={value ?? ''}
      min={min}
      step={step}
      onChange={(e) => {
        const v = e.target.valueAsNumber
        if (!Number.isNaN(v)) onChange(v)
      }}
    />
  )
}

export function Alert({ kind, children }: { kind: 'error' | 'warning' | 'ok' | 'info'; children: ReactNode }) {
  const styles = {
    error: 'border-red-200 bg-red-50 text-red-800',
    warning: 'border-amber-200 bg-amber-50 text-amber-900',
    ok: 'border-emerald-200 bg-emerald-50 text-emerald-800',
    info: 'border-sky-200 bg-sky-50 text-sky-900',
  }[kind]
  return <div className={`rounded-lg border px-3 py-2 text-sm ${styles}`}>{children}</div>
}

/** Casilla de color de un turno en el calendario. */
export function ShiftBadge({ code, color, dim, marked }: { code: string; color?: string; dim?: boolean; marked?: boolean }) {
  return (
    <span
      className={`inline-flex h-7 min-w-7 items-center justify-center rounded px-1 text-xs font-semibold text-slate-800 ${
        dim ? 'opacity-60' : ''
      } ${marked ? 'ring-2 ring-offset-1 ring-rose-500' : ''}`}
      style={{ backgroundColor: color ?? '#f1f5f9' }}
    >
      {code}
    </span>
  )
}
