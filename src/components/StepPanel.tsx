import { useState } from 'react'
import { Box } from '../lib/box'
import { IDENTITY } from '../pipeline/types'
import type { CanvasMode, ComponentParams, ExportOptions, OutlineParams, Transform } from '../pipeline/types'
import type { PaperSize } from '../template/layout'
import { CheckboxField, NumberField, RangeField, TextField } from './Fields'
import Uploader from './Uploader'
import type { PhotoResult, UiMode } from './types'

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

interface StepPanelProps {
  cvStatus: 'loading' | 'ready' | 'error'
  cvError: string | null

  paper: PaperSize
  onPaperChange: (paper: PaperSize) => void
  onShowTemplate: () => void
  printerScale: number

  file: File | null
  onFile: (file: File) => void
  busy: boolean

  photo: Box<PhotoResult> | null
  processError: string | null
  hasRectified: boolean
  rectifiedMarkersCount: number
  rectifiedReprojErrorPx: number
  rectifiedMode: 'markers' | 'manual' | null
  manualActive: boolean
  onUseManual: () => void
  manualPointsCount: number
  manualDistanceMm: number
  onManualDistanceChange: (mm: number) => void
  onApplyManual: () => void
  manualError: string | null
  usingManualMode: boolean

  outlineParams: OutlineParams
  onOutlineParamsChange: (params: OutlineParams) => void
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

function StepBadge({ n }: { n: number }) {
  return <span className="step-badge">{n}</span>
}

export default function StepPanel(props: StepPanelProps) {
  const {
    cvStatus,
    cvError,
    paper,
    onPaperChange,
    onShowTemplate,
    printerScale,
    file,
    onFile,
    busy,
    photo,
    processError,
    hasRectified,
    rectifiedMarkersCount,
    rectifiedReprojErrorPx,
    rectifiedMode,
    manualActive,
    onUseManual,
    manualPointsCount,
    manualDistanceMm,
    onManualDistanceChange,
    onApplyManual,
    manualError,
    usingManualMode,
    outlineParams,
    onOutlineParamsChange,
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

  const [sampleLoading, setSampleLoading] = useState(false)
  const [sampleError, setSampleError] = useState<string | null>(null)

  const canPickManual = manualActive && !hasRectified
  const toolRows = tools.value
  const selectedTool = selectedToolId ? (toolRows.find((t) => t.id === selectedToolId) ?? null) : null
  const selectedComponent =
    selectedTool && selectedComponentId ? (selectedTool.components.find((c) => c.id === selectedComponentId) ?? null) : null

  async function handleLoadSample() {
    setSampleError(null)
    setSampleLoading(true)
    try {
      const res = await fetch('/samples/synthetic-letter.png')
      if (!res.ok) throw new Error(`Failed to fetch sample photo (${res.status})`)
      const blob = await res.blob()
      const sample = new File([blob], 'synthetic-letter.png', { type: blob.type || 'image/png' })
      onFile(sample)
    } catch (err) {
      setSampleError(err instanceof Error ? err.message : String(err))
    } finally {
      setSampleLoading(false)
    }
  }

  return (
    <aside className="panel">
      <div className="cv-status">
        {cvStatus === 'loading' && <span className="pill pill-neutral">Loading OpenCV (13 MB)&hellip;</span>}
        {cvStatus === 'ready' && <span className="pill pill-good">OpenCV ready</span>}
        {cvStatus === 'error' && <span className="pill pill-bad">OpenCV failed to load{cvError ? `: ${cvError}` : ''}</span>}
      </div>

      <section className="step">
        <h2>
          <StepBadge n={1} /> Template
        </h2>
        <button type="button" className="btn" onClick={onShowTemplate}>
          Print template
        </button>
        <label className="field-row">
          <span className="field-label">Paper size</span>
          <select value={paper} onChange={(e) => onPaperChange(e.target.value as PaperSize)}>
            <option value="letter">Letter</option>
            <option value="a4">A4</option>
          </select>
        </label>
        <div className="field-row">
          <span className="field-label">Printer scale</span>
          <span className="field-readout">{printerScale.toFixed(4)}&times;</span>
        </div>
        <p className="hint">Set on the template page.</p>
      </section>

      <section className="step">
        <h2>
          <StepBadge n={2} /> Photo
        </h2>
        <Uploader file={file} onFile={onFile} disabled={cvStatus !== 'ready' || busy} />
        {busy && <p className="hint">Processing&hellip;</p>}
        {processError && <p className="pill pill-bad">{processError}</p>}
        <button
          type="button"
          className="btn sample-btn"
          onClick={handleLoadSample}
          disabled={cvStatus !== 'ready' || busy || sampleLoading}
        >
          {sampleLoading ? 'Loading sample…' : 'Load sample photo'}
        </button>
        <p className="hint">Synthetic test image: an 80 &times; 30 mm rectangle and a 12 mm circle.</p>
        {sampleError && <p className="pill pill-bad">{sampleError}</p>}
      </section>

      <section className="step">
        <h2>
          <StepBadge n={3} /> Scale
        </h2>
        {!photo && <p className="hint">Upload a photo to detect markers.</p>}
        {photo && !usingManualMode && !photo.value.error && hasRectified && (
          <p className="pill pill-good">
            ✓ {rectifiedMarkersCount} markers found &middot; reprojection error{' '}
            {rectifiedReprojErrorPx.toFixed(2)} px
          </p>
        )}
        {photo && photo.value.error && !usingManualMode && <p className="pill pill-bad">{photo.value.error}</p>}
        {photo && !usingManualMode && (
          <button type="button" className="btn" onClick={onUseManual}>
            Use manual scale instead
          </button>
        )}
        {canPickManual && (
          <div className="manual-scale">
            <p className="hint">Click two points on the photo that are a known distance apart, then enter that distance.</p>
            <p className="hint">{manualPointsCount} / 2 points picked</p>
            <NumberField
              label="Distance (mm)"
              value={manualDistanceMm}
              onChange={onManualDistanceChange}
              min={1}
              step={0.1}
            />
            <button
              type="button"
              className="btn primary"
              disabled={manualPointsCount < 2 || manualDistanceMm <= 0}
              onClick={onApplyManual}
            >
              Apply
            </button>
            {manualError && <p className="pill pill-bad">{manualError}</p>}
          </div>
        )}
        {usingManualMode && rectifiedMode === 'manual' && (
          <p className="pill pill-neutral">Approximate: no perspective correction</p>
        )}
      </section>

      <section className="step">
        <h2>
          <StepBadge n={4} /> Outline
        </h2>
        <CheckboxField
          label="Auto threshold"
          checked={outlineParams.threshold === 'auto'}
          onChange={(checked) =>
            onOutlineParamsChange({ ...outlineParams, threshold: checked ? 'auto' : 128 })
          }
        />
        {outlineParams.threshold !== 'auto' && (
          <RangeField
            label="Threshold"
            value={outlineParams.threshold as number}
            min={0}
            max={255}
            onChange={(v) => onOutlineParamsChange({ ...outlineParams, threshold: v })}
          />
        )}
        {thresholdUsed !== null && <p className="hint">Threshold used: {thresholdUsed.toFixed(0)}</p>}
        <CheckboxField
          label="Invert (tool is lighter than paper)"
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
        <CheckboxField label="Show mask" checked={showMask} onChange={onShowMaskChange} />
        {detectionError && <p className="pill pill-bad">{detectionError}</p>}
      </section>

      <section className="step">
        <h2>
          <StepBadge n={5} /> Tools
        </h2>
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
                  className="btn tool-row-remove"
                  onClick={(e) => {
                    e.stopPropagation()
                    onRemoveTool(row.id)
                  }}
                >
                  Remove
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
                        title="Clearance (mm)"
                        onClick={(e) => e.stopPropagation()}
                        onChange={(e) => onComponentClearanceChange(selectedTool.id, c.id, Number(e.target.value))}
                      />
                      <button
                        type="button"
                        className="btn"
                        onClick={(e) => {
                          e.stopPropagation()
                          onRemoveComponent(selectedTool.id, c.id)
                        }}
                      >
                        Remove
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
                <CheckboxField
                  label="Auto threshold"
                  checked={selectedComponent.params.threshold === 'auto'}
                  onChange={(checked) =>
                    onComponentParamsChange(selectedTool.id, selectedComponent.id, {
                      ...selectedComponent.params,
                      threshold: checked ? 'auto' : 128,
                    })
                  }
                />
                {selectedComponent.params.threshold !== 'auto' && (
                  <RangeField
                    label="Threshold"
                    value={selectedComponent.params.threshold as number}
                    min={0}
                    max={255}
                    onChange={(v) =>
                      onComponentParamsChange(selectedTool.id, selectedComponent.id, {
                        ...selectedComponent.params,
                        threshold: v,
                      })
                    }
                  />
                )}
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

      <section className="step">
        <h2>
          <StepBadge n={6} /> Arrange
        </h2>
        {selectedTool ? (
          <>
            <NumberField
              label="Angle"
              value={layout[selectedTool.id]?.angleDeg ?? 0}
              step={1}
              suffix="deg"
              onChange={(v) =>
                onTransformChange(selectedTool.id, { ...(layout[selectedTool.id] ?? IDENTITY), angleDeg: v })
              }
            />
            <div className="arrange-actions">
              <button type="button" className="btn" onClick={() => onRotate90(selectedTool.id)}>
                Rotate 90&deg;
              </button>
              <button type="button" className="btn" onClick={() => onAutoAlign(selectedTool.id)}>
                Auto-align
              </button>
              <button type="button" className="btn" onClick={() => onResetPosition(selectedTool.id)}>
                Reset position
              </button>
            </div>
          </>
        ) : (
          <p className="hint">Select a tool to move or rotate it.</p>
        )}
        <div className="arrange-global">
          <button type="button" className="btn" onClick={onResetLayout}>
            Reset layout
          </button>
          <label className="field-row">
            <span className="field-label">Canvas</span>
            <select value={canvasMode.mode} onChange={(e) => onCanvasModeChange(e.target.value as CanvasMode['mode'])}>
              <option value="auto">Auto</option>
              <option value="fixed">Fixed</option>
            </select>
          </label>
          {canvasMode.mode === 'fixed' && (
            <>
              <NumberField
                label="Canvas width"
                value={canvasMode.widthMm}
                min={1}
                suffix="mm"
                onChange={(v) => onFixedSizeChange({ widthMm: v })}
              />
              <NumberField
                label="Canvas height"
                value={canvasMode.heightMm}
                min={1}
                suffix="mm"
                onChange={(v) => onFixedSizeChange({ heightMm: v })}
              />
            </>
          )}
          <CheckboxField label="Snap to 1 mm grid" checked={gridSnap} onChange={onGridSnapChange} />
        </div>
      </section>

      <section className="step">
        <h2>
          <StepBadge n={7} /> Clearance &amp; export
        </h2>
        <NumberField
          label="Clearance"
          value={exportOpts.clearanceMm}
          step={0.1}
          suffix="mm"
          onChange={(v) => onExportOptsChange({ ...exportOpts, clearanceMm: v })}
        />
        <NumberField
          label="Margin"
          value={exportOpts.marginMm}
          min={0}
          step={1}
          suffix="mm"
          onChange={(v) => onExportOptsChange({ ...exportOpts, marginMm: v })}
        />
        <TextField
          label="Name"
          value={exportOpts.name}
          onChange={(v) => onExportOptsChange({ ...exportOpts, name: v })}
        />
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
          <button type="button" className="btn" disabled={!hasExport} onClick={onCopySvg}>
            Copy SVG
          </button>
        </div>
        {copyStatus && <p className="hint">{copyStatus}</p>}
        {exportError && <p className="pill pill-bad">{exportError}</p>}
      </section>
    </aside>
  )
}
