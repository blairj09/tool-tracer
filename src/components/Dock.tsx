// The bottom control dock: four independently-scrolling columns (Outline,
// Tools, Arrange, Export) spanning the width of the window. Capture (paper
// size, print template, upload, sample photo, marker/scale status) lives in
// the Photo pane itself now — see Viewer.tsx — rather than as a separate
// column here, since it's about the photo and belongs next to it.
import { Box } from '../lib/box'
import { IDENTITY } from '../pipeline/types'
import type { CanvasMode, ComponentParams, ExportOptions, OutlineParams, Transform } from '../pipeline/types'
import { CheckboxField, NumberField, RangeField, Segmented, Toggle } from './Fields'
import type { UiMode } from './types'

export interface ComponentRow {
  id: string
  name: string
  source: 'auto' | 'drawn'
  widthMm: number
  heightMm: number
  clearanceMm: number
  hasEdits: boolean
  error?: string
  params: ComponentParams
}

export interface ToolRow {
  id: string
  name: string
  colour: string
  widthMm: number
  heightMm: number
  hasEdits: boolean
  components: ComponentRow[]
}

interface ExportStats {
  toolWidthMm: number
  toolHeightMm: number
  points: number
  areaMm2: number
}

interface DockProps {
  outlineParams: OutlineParams
  onOutlineParamsChange: (params: OutlineParams) => void
  cleanup: number
  onCleanupChange: (v: number) => void
  cleanupIsCustom: boolean
  thresholdUsed: number | null
  detectionError: string | null
  showMask: boolean
  onShowMaskChange: (v: boolean) => void

  tools: Box<ToolRow[]>
  selectedToolId: string | null
  selectedComponentId: string | null
  onSelectTool: (toolId: string) => void
  onSelectComponent: (toolId: string, componentId: string) => void
  onRenameTool: (toolId: string, name: string) => void
  onRemoveTool: (toolId: string) => void
  onAddComponentFromPhoto: () => void
  onAddComponentDraw: () => void
  onRenameComponent: (toolId: string, componentId: string, name: string) => void
  onComponentClearanceChange: (toolId: string, componentId: string, clearanceMm: number) => void
  onComponentParamsChange: (toolId: string, componentId: string, params: ComponentParams) => void
  onRemoveComponent: (toolId: string, componentId: string) => void

  mode: UiMode
  onEditModeChange: (v: boolean) => void
  hasEdits: boolean
  onResetEdits: () => void

  layout: Record<string, Transform>
  onTransformChange: (toolId: string, transform: Transform) => void
  onRotate90: (toolId: string) => void
  onAutoAlign: (toolId: string) => void
  onResetPosition: (toolId: string) => void
  onResetLayout: () => void
  canvasMode: CanvasMode
  onCanvasModeChange: (mode: CanvasMode['mode']) => void
  onFixedSizeChange: (patch: { widthMm?: number; heightMm?: number }) => void
  gridSnap: boolean
  onGridSnapChange: (v: boolean) => void

  exportOpts: ExportOptions
  onExportOptsChange: (opts: ExportOptions) => void
  hasExport: boolean
  exportWidthMm: number | null
  exportHeightMm: number | null
  exportStats: ExportStats | null
  exportError: string | null
  onDownloadAll: () => void
  onDownloadSelected: () => void
  onCopySvg: () => void
  copyStatus: string | null
}

/** Threshold row shared by the Outline section and each auto component:
 * a label, a small Auto toggle, and a slider that stays interactive (just
 * visually dimmed) while Auto is on, so dragging it can adopt the value and
 * switch Auto off in one motion. `otsu` is the value shown in the readout
 * while Auto is on (and the slider's position); pass null where no computed
 * value is available (per-component thresholds don't have one plumbed). */
function ThresholdControl({
  value,
  otsu,
  onChange,
}: {
  value: number | 'auto'
  otsu: number | null
  onChange: (v: number | 'auto') => void
}) {
  const isAuto = value === 'auto'
  const sliderValue = isAuto ? (otsu ?? 128) : value
  const readout = isAuto ? `Auto${otsu !== null ? ` · ${otsu.toFixed(0)}` : ''}` : `${sliderValue}`
  return (
    <div className={`field-row field-row-range${isAuto ? ' field-row-dimmed' : ''}`}>
      <span className="field-label">
        <span>Threshold</span>
        <span className="threshold-controls">
          <Toggle label="Auto" pressed={isAuto} onChange={(on) => onChange(on ? 'auto' : (otsu ?? 128))} />
          <span className="field-value">{readout}</span>
        </span>
      </span>
      <input
        type="range"
        className="field-range"
        min={0}
        max={255}
        value={sliderValue}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </div>
  )
}

function parseNum(v: string): number | null {
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

const CANVAS_MODE_OPTIONS: { value: CanvasMode['mode']; label: string }[] = [
  { value: 'auto', label: 'Auto' },
  { value: 'fixed', label: 'Fixed' },
]

export default function Dock(props: DockProps) {
  const {
    outlineParams,
    onOutlineParamsChange,
    cleanup,
    onCleanupChange,
    cleanupIsCustom,
    thresholdUsed,
    detectionError,
    showMask,
    onShowMaskChange,
    tools,
    selectedToolId,
    selectedComponentId,
    onSelectTool,
    onSelectComponent,
    onRenameTool,
    onRemoveTool,
    onAddComponentFromPhoto,
    onAddComponentDraw,
    onRenameComponent,
    onComponentClearanceChange,
    onComponentParamsChange,
    onRemoveComponent,
    mode,
    onEditModeChange,
    hasEdits,
    onResetEdits,
    layout,
    onTransformChange,
    onRotate90,
    onAutoAlign,
    onResetPosition,
    onResetLayout,
    canvasMode,
    onCanvasModeChange,
    onFixedSizeChange,
    gridSnap,
    onGridSnapChange,
    exportOpts,
    onExportOptsChange,
    hasExport,
    exportWidthMm,
    exportHeightMm,
    exportStats,
    exportError,
    onDownloadAll,
    onDownloadSelected,
    onCopySvg,
    copyStatus,
  } = props

  const toolRows = tools.value
  const selectedTool = selectedToolId ? (toolRows.find((t) => t.id === selectedToolId) ?? null) : null
  const selectedComponent =
    selectedTool && selectedComponentId ? (selectedTool.components.find((c) => c.id === selectedComponentId) ?? null) : null

  return (
    <div className="dock">
      {/* --- Outline --------------------------------------------------- */}
      <section className="dock-col">
        <h2 className="section-label">Outline</h2>

        <ThresholdControl
          value={outlineParams.threshold}
          otsu={thresholdUsed}
          onChange={(v) => onOutlineParamsChange({ ...outlineParams, threshold: v })}
        />

        <RangeField
          label="Cleanup"
          value={cleanup}
          min={0}
          max={3}
          step={0.1}
          displayValue={cleanupIsCustom ? 'custom' : `${cleanup.toFixed(1)}×`}
          onChange={onCleanupChange}
        />

        <div className="field-row mask-row">
          <span className="hint mask-hint">Red = traced area</span>
          <Toggle label="Show mask" pressed={showMask} onChange={onShowMaskChange} />
        </div>
        {detectionError && <p className="pill pill-bad">{detectionError}</p>}

        <details className="advanced">
          <summary>Advanced</summary>
          <div className="advanced-body">
            <CheckboxField
              label="Invert (tool lighter than paper)"
              checked={outlineParams.invert}
              onChange={(checked) => onOutlineParamsChange({ ...outlineParams, invert: checked })}
            />
            <RangeField
              label="Blur"
              value={outlineParams.blurMm}
              min={0}
              max={2}
              step={0.1}
              displayValue={`${outlineParams.blurMm.toFixed(1)} mm`}
              onChange={(v) => onOutlineParamsChange({ ...outlineParams, blurMm: v })}
            />
            <RangeField
              label="Open"
              value={outlineParams.openMm}
              min={0}
              max={5}
              step={0.1}
              displayValue={`${outlineParams.openMm.toFixed(1)} mm`}
              onChange={(v) => onOutlineParamsChange({ ...outlineParams, openMm: v })}
            />
            <RangeField
              label="Close"
              value={outlineParams.closeMm}
              min={0}
              max={5}
              step={0.1}
              displayValue={`${outlineParams.closeMm.toFixed(1)} mm`}
              onChange={(v) => onOutlineParamsChange({ ...outlineParams, closeMm: v })}
            />
            <RangeField
              label="Simplify"
              value={outlineParams.simplifyMm}
              min={0.05}
              max={1}
              step={0.05}
              displayValue={`${outlineParams.simplifyMm.toFixed(2)} mm`}
              onChange={(v) => onOutlineParamsChange({ ...outlineParams, simplifyMm: v })}
            />
            <NumberField
              label="Min area"
              value={outlineParams.minAreaMm2}
              min={0}
              step={10}
              suffix="mm&sup2;"
              onChange={(v) => onOutlineParamsChange({ ...outlineParams, minAreaMm2: v })}
            />
          </div>
        </details>
      </section>

      {/* --- Tools ------------------------------------------------------ */}
      <section className="dock-col">
        <h2 className="section-label">Tools</h2>
        {toolRows.length === 0 && <p className="hint">No tools traced yet. Click a blob in the photo to add one.</p>}
        {toolRows.length > 0 && (
          <div className="tools-list">
            {toolRows.map((row) => (
              <div
                key={row.id}
                className={`tool-row${row.id === selectedToolId ? ' tool-row-selected' : ''}`}
                onClick={() => onSelectTool(row.id)}
              >
                <span className="tool-color-dot" style={{ background: row.colour }} />
                <input
                  className="tool-row-name"
                  value={row.name}
                  onClick={(e) => e.stopPropagation()}
                  onChange={(e) => onRenameTool(row.id, e.target.value)}
                />
                <span className="tool-row-meta">
                  {row.widthMm.toFixed(1)} &times; {row.heightMm.toFixed(1)} mm
                </span>
                <button
                  type="button"
                  className="row-remove-btn"
                  aria-label={`Remove ${row.name}`}
                  onClick={(e) => {
                    e.stopPropagation()
                    onRemoveTool(row.id)
                  }}
                >
                  &times;
                </button>
              </div>
            ))}
          </div>
        )}
        <p className="hint">Click an untraced blob in the photo to add it.</p>

        {selectedTool && (
          <div className="components-section">
            <h3 className="components-title">Components</h3>
            {selectedTool.components.length === 0 && <p className="hint">No components yet.</p>}
            {selectedTool.components.length > 0 && (
              <div className="components-list">
                {selectedTool.components.map((c) => (
                  <div key={c.id}>
                    <div
                      className={`component-row${c.id === selectedComponentId ? ' component-row-selected' : ''}`}
                      onClick={() => onSelectComponent(selectedTool.id, c.id)}
                    >
                      <input
                        className="component-row-name"
                        value={c.name}
                        onClick={(e) => e.stopPropagation()}
                        onChange={(e) => onRenameComponent(selectedTool.id, c.id, e.target.value)}
                      />
                      <span className="component-row-meta">
                        {c.widthMm.toFixed(1)} &times; {c.heightMm.toFixed(1)} mm
                      </span>
                      <input
                        type="number"
                        className="component-row-clearance"
                        step={0.1}
                        value={c.clearanceMm}
                        aria-label={`Clearance for ${c.name} (mm)`}
                        title="Clearance (mm)"
                        onClick={(e) => e.stopPropagation()}
                        onChange={(e) => onComponentClearanceChange(selectedTool.id, c.id, Number(e.target.value))}
                      />
                      <button
                        type="button"
                        className="row-remove-btn"
                        aria-label={`Remove ${c.name}`}
                        onClick={(e) => {
                          e.stopPropagation()
                          onRemoveComponent(selectedTool.id, c.id)
                        }}
                      >
                        &times;
                      </button>
                    </div>
                    {c.error && <p className="pill pill-bad component-row-error">{c.error}</p>}
                  </div>
                ))}
              </div>
            )}
            <div className="component-actions">
              <button type="button" className="btn" onClick={onAddComponentFromPhoto}>
                From photo
              </button>
              <button type="button" className="btn" onClick={onAddComponentDraw}>
                Draw
              </button>
            </div>

            {selectedComponent && selectedComponent.source === 'auto' && (
              <div className="component-params">
                <ThresholdControl
                  value={selectedComponent.params.threshold}
                  otsu={null}
                  onChange={(v) =>
                    onComponentParamsChange(selectedTool.id, selectedComponent.id, {
                      ...selectedComponent.params,
                      threshold: v,
                    })
                  }
                />
                <CheckboxField
                  label="Invert"
                  checked={selectedComponent.params.invert}
                  onChange={(checked) =>
                    onComponentParamsChange(selectedTool.id, selectedComponent.id, {
                      ...selectedComponent.params,
                      invert: checked,
                    })
                  }
                />
                <details className="advanced advanced-compact">
                  <summary>Advanced</summary>
                  <div className="advanced-body">
                    <RangeField
                      label="Open"
                      value={selectedComponent.params.openMm}
                      min={0}
                      max={3}
                      step={0.1}
                      displayValue={`${selectedComponent.params.openMm.toFixed(1)} mm`}
                      onChange={(v) =>
                        onComponentParamsChange(selectedTool.id, selectedComponent.id, {
                          ...selectedComponent.params,
                          openMm: v,
                        })
                      }
                    />
                    <RangeField
                      label="Close"
                      value={selectedComponent.params.closeMm}
                      min={0}
                      max={3}
                      step={0.1}
                      displayValue={`${selectedComponent.params.closeMm.toFixed(1)} mm`}
                      onChange={(v) =>
                        onComponentParamsChange(selectedTool.id, selectedComponent.id, {
                          ...selectedComponent.params,
                          closeMm: v,
                        })
                      }
                    />
                    <RangeField
                      label="Simplify"
                      value={selectedComponent.params.simplifyMm}
                      min={0.05}
                      max={1}
                      step={0.05}
                      displayValue={`${selectedComponent.params.simplifyMm.toFixed(2)} mm`}
                      onChange={(v) =>
                        onComponentParamsChange(selectedTool.id, selectedComponent.id, {
                          ...selectedComponent.params,
                          simplifyMm: v,
                        })
                      }
                    />
                  </div>
                </details>
              </div>
            )}

            <div className="edit-vertices">
              <CheckboxField label="Edit vertices" checked={mode === 'edit'} onChange={onEditModeChange} />
              <button type="button" className="btn" disabled={!hasEdits} onClick={onResetEdits}>
                Reset edits
              </button>
            </div>
          </div>
        )}
      </section>

      {/* --- Arrange ----------------------------------------------------- */}
      <section className="dock-col">
        <h2 className="section-label">Arrange</h2>
        <div className="arrange-row1">
          <NumberField
            label="Angle"
            value={selectedTool ? (layout[selectedTool.id]?.angleDeg ?? 0) : 0}
            step={1}
            suffix="deg"
            disabled={!selectedTool}
            onChange={(v) =>
              selectedTool && onTransformChange(selectedTool.id, { ...(layout[selectedTool.id] ?? IDENTITY), angleDeg: v })
            }
          />
        </div>
        <div className="arrange-btns">
          <button type="button" className="btn" disabled={!selectedTool} onClick={() => selectedTool && onRotate90(selectedTool.id)}>
            90&deg;
          </button>
          <button type="button" className="btn" disabled={!selectedTool} onClick={() => selectedTool && onAutoAlign(selectedTool.id)}>
            Auto-align
          </button>
          <button
            type="button"
            className="btn"
            disabled={!selectedTool}
            onClick={() => selectedTool && onResetPosition(selectedTool.id)}
          >
            Reset
          </button>
        </div>
        {!selectedTool && <p className="hint">Select a tool to move or rotate it.</p>}

        <div className="arrange-row2">
          <Segmented options={CANVAS_MODE_OPTIONS} value={canvasMode.mode} onChange={onCanvasModeChange} ariaLabel="Canvas size" />
          {canvasMode.mode === 'fixed' && (
            <div className="canvas-size-fields">
              <input
                type="number"
                className="field-number field-number-sm"
                aria-label="Canvas width (mm)"
                min={1}
                value={canvasMode.widthMm}
                onChange={(e) => {
                  const n = parseNum(e.target.value)
                  if (n !== null) onFixedSizeChange({ widthMm: n })
                }}
              />
              <span className="canvas-size-x">&times;</span>
              <input
                type="number"
                className="field-number field-number-sm"
                aria-label="Canvas height (mm)"
                min={1}
                value={canvasMode.heightMm}
                onChange={(e) => {
                  const n = parseNum(e.target.value)
                  if (n !== null) onFixedSizeChange({ heightMm: n })
                }}
              />
              <span className="field-suffix">mm</span>
            </div>
          )}
          <Toggle label="Snap 1 mm" pressed={gridSnap} onChange={onGridSnapChange} />
          <button type="button" className="link-btn" onClick={onResetLayout}>
            Reset layout
          </button>
        </div>
      </section>

      {/* --- Export ------------------------------------------------------ */}
      <section className="dock-col">
        <h2 className="section-label">Export</h2>
        <div className="export-grid">
          <label className="grid-field">
            <span className="grid-field-label">Clearance</span>
            <span className="field-control">
              <input
                type="number"
                className="field-number"
                step={0.1}
                value={exportOpts.clearanceMm}
                onChange={(e) => {
                  const n = parseNum(e.target.value)
                  if (n !== null) onExportOptsChange({ ...exportOpts, clearanceMm: n })
                }}
              />
              <span className="field-suffix">mm</span>
            </span>
          </label>
          <label className="grid-field">
            <span className="grid-field-label">Margin</span>
            <span className="field-control">
              <input
                type="number"
                className="field-number"
                min={0}
                step={1}
                value={exportOpts.marginMm}
                onChange={(e) => {
                  const n = parseNum(e.target.value)
                  if (n !== null) onExportOptsChange({ ...exportOpts, marginMm: n })
                }}
              />
              <span className="field-suffix">mm</span>
            </span>
          </label>
          <label className="grid-field">
            <span className="grid-field-label">Name</span>
            <input
              type="text"
              className="field-text field-text-full"
              value={exportOpts.name}
              onChange={(e) => onExportOptsChange({ ...exportOpts, name: e.target.value })}
            />
          </label>
        </div>
        {exportStats && (
          <p className="hint">
            Tool: {exportStats.toolWidthMm.toFixed(1)} &times; {exportStats.toolHeightMm.toFixed(1)} mm &middot;{' '}
            {exportStats.points} points &middot; area {exportStats.areaMm2.toFixed(0)} mm&sup2;
          </p>
        )}
        {exportWidthMm !== null && exportHeightMm !== null && (
          <p className="hint">
            SVG: {exportWidthMm.toFixed(1)} &times; {exportHeightMm.toFixed(1)} mm &middot; {toolRows.length} tool
            {toolRows.length === 1 ? '' : 's'}
          </p>
        )}
        <div className="export-actions">
          <button type="button" className="btn primary" disabled={!hasExport} onClick={onDownloadAll}>
            Download SVG
          </button>
          {toolRows.length > 1 && (
            <button type="button" className="btn" disabled={!selectedTool} onClick={onDownloadSelected}>
              Download selected tool
            </button>
          )}
          <button type="button" className="link-btn" disabled={!hasExport} onClick={onCopySvg}>
            Copy SVG
          </button>
        </div>
        {copyStatus && <p className="hint">{copyStatus}</p>}
        {exportError && <p className="pill pill-bad">{exportError}</p>}
      </section>
    </div>
  )
}
