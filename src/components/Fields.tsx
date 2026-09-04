// Small, compact label+control row helpers used throughout StepPanel.
import type { ReactNode } from 'react'

interface NumberFieldProps {
  label: string
  value: number
  onChange: (value: number) => void
  min?: number
  max?: number
  step?: number
  disabled?: boolean
  suffix?: string
}

export function NumberField({ label, value, onChange, min, max, step, disabled, suffix }: NumberFieldProps) {
  return (
    <label className="field-row">
      <span className="field-label">{label}</span>
      <span className="field-control">
        <input
          type="number"
          className="field-number"
          value={Number.isFinite(value) ? value : ''}
          min={min}
          max={max}
          step={step ?? 1}
          disabled={disabled}
          onChange={(e) => {
            const n = Number(e.target.value)
            if (Number.isFinite(n)) onChange(n)
          }}
        />
        {suffix && <span className="field-suffix">{suffix}</span>}
      </span>
    </label>
  )
}

interface RangeFieldProps {
  label: string
  value: number
  onChange: (value: number) => void
  min: number
  max: number
  step?: number
  disabled?: boolean
  displayValue?: ReactNode
}

export function RangeField({ label, value, onChange, min, max, step, disabled, displayValue }: RangeFieldProps) {
  return (
    <label className="field-row field-row-range">
      <span className="field-label">
        {label}
        <span className="field-value">{displayValue ?? value}</span>
      </span>
      <input
        type="range"
        className="field-range"
        value={value}
        min={min}
        max={max}
        step={step ?? 1}
        disabled={disabled}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </label>
  )
}

interface CheckboxFieldProps {
  label: string
  checked: boolean
  onChange: (checked: boolean) => void
  disabled?: boolean
}

export function CheckboxField({ label, checked, onChange, disabled }: CheckboxFieldProps) {
  return (
    <label className="field-row field-row-checkbox">
      <input type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span className="field-label">{label}</span>
    </label>
  )
}

interface TextFieldProps {
  label: string
  value: string
  onChange: (value: string) => void
  disabled?: boolean
}

export function TextField({ label, value, onChange, disabled }: TextFieldProps) {
  return (
    <label className="field-row">
      <span className="field-label">{label}</span>
      <input
        type="text"
        className="field-text"
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
      />
    </label>
  )
}
