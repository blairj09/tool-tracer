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
  /** Visually dims the control (e.g. "overridden by Auto") without actually
   * disabling it — dragging must still fire onChange so the caller can
   * adopt the value and turn Auto off. */
  dimmed?: boolean
  displayValue?: ReactNode
}

export function RangeField({ label, value, onChange, min, max, step, disabled, dimmed, displayValue }: RangeFieldProps) {
  return (
    <label className={`field-row field-row-range${dimmed ? ' field-row-dimmed' : ''}`}>
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

interface ToggleProps {
  label: string
  pressed: boolean
  onChange: (pressed: boolean) => void
  disabled?: boolean
  /** Visually hide the label text but keep it for screen readers. */
  labelHidden?: boolean
}

/** A single-button pill toggle (on/off), styled distinctly from a checkbox. */
export function Toggle({ label, pressed, onChange, disabled, labelHidden }: ToggleProps) {
  return (
    <button
      type="button"
      className={`toggle${pressed ? ' toggle-on' : ''}`}
      aria-pressed={pressed}
      aria-label={labelHidden ? label : undefined}
      disabled={disabled}
      onClick={() => onChange(!pressed)}
    >
      {labelHidden ? null : label}
    </button>
  )
}

interface SegmentedOption<T extends string> {
  value: T
  label: string
}

interface SegmentedProps<T extends string> {
  options: SegmentedOption<T>[]
  value: T
  onChange: (value: T) => void
  ariaLabel: string
  disabled?: boolean
}

/** A two-(or-more)-button segmented control; each option is a real button
 * with `aria-pressed`, grouped for screen readers via `role="group"`. */
export function Segmented<T extends string>({ options, value, onChange, ariaLabel, disabled }: SegmentedProps<T>) {
  return (
    <div className="segmented" role="group" aria-label={ariaLabel}>
      {options.map((opt) => (
        <button
          key={opt.value}
          type="button"
          className={`segmented-option${opt.value === value ? ' segmented-option-active' : ''}`}
          aria-pressed={opt.value === value}
          disabled={disabled}
          onClick={() => onChange(opt.value)}
        >
          {opt.label}
        </button>
      ))}
    </div>
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
