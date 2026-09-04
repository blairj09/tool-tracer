import { useState } from 'react'
import { Box } from '../lib/box'
import type { ExportOptions, OutlineParams, OutlineResult, ExportResult } from '../pipeline/types'
import type { PaperSize } from '../template/layout'
import { CheckboxField, NumberField, RangeField, TextField } from './Fields'
import Uploader from './Uploader'
import type { PhotoResult } from './types'

interface OutlineStats {
  toolWidthMm: number
  toolHeightMm: number
  points: number
  areaMm2: number
  // Null when export failed (e.g. a self-intersecting hand-edited polygon) —
  // the tool measurements above still come from the effective polygon.
  svgWidthMm: number | null
  svgHeightMm: number | null
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
  outline: Box<OutlineResult> | null
  outlineError: string | null
  showMask: boolean
  onShowMaskChange: (v: boolean) => void
  hasPick: boolean
  onClearPick: () => void

  editMode: boolean
  onEditModeChange: (v: boolean) => void
  hasEdits: boolean
  onResetEdits: () => void
  outlineStats: OutlineStats | null

  exportOpts: ExportOptions
  onExportOptsChange: (opts: ExportOptions) => void
  exportResult: Box<ExportResult> | null
  exportError: string | null
  onDownload: () => void
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
    outline,
    outlineError,
    showMask,
    onShowMaskChange,
    hasPick,
    onClearPick,
    editMode,
    onEditModeChange,
    hasEdits,
    onResetEdits,
    outlineStats,
    exportOpts,
    onExportOptsChange,
    exportResult,
    exportError,
    onDownload,
    onCopySvg,
    copyStatus,
  } = props

  const [sampleLoading, setSampleLoading] = useState(false)
  const [sampleError, setSampleError] = useState<string | null>(null)

  const canPickManual = manualActive && !hasRectified

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
        {outline && <p className="hint">Threshold used: {outline.value.thresholdUsed.toFixed(0)}</p>}
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
        {hasPick && (
          <p className="hint">
            Picked a specific blob.{' '}
            <a href="#" onClick={(e) => { e.preventDefault(); onClearPick() }}>
              clear pick
            </a>
          </p>
        )}
        {outlineError && <p className="pill pill-bad">{outlineError}</p>}

        <div className="edit-vertices">
          <CheckboxField
            label="Edit vertices"
            checked={editMode}
            onChange={onEditModeChange}
            disabled={!outline}
          />
          <button type="button" className="btn" disabled={!hasEdits} onClick={onResetEdits}>
            Reset edits
          </button>
          {editMode && (
            <p className="hint">
              Drag a point to move it. Click an edge to add a point. Alt-click (or right-click) a point to
              delete it.
            </p>
          )}
        </div>
      </section>

      <section className="step">
        <h2>
          <StepBadge n={5} /> Clearance &amp; export
        </h2>
        <NumberField
          label="Clearance"
          value={exportOpts.clearanceMm}
          step={0.1}
          suffix="mm"
          onChange={(v) => onExportOptsChange({ ...exportOpts, clearanceMm: v })}
        />
        <CheckboxField
          label="Auto-align (rotate to horizontal)"
          checked={exportOpts.autoAlign}
          onChange={(checked) => onExportOptsChange({ ...exportOpts, autoAlign: checked })}
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
        {outlineStats && (
          <p className="hint">
            Tool: {outlineStats.toolWidthMm.toFixed(1)} &times; {outlineStats.toolHeightMm.toFixed(1)} mm &middot;{' '}
            {outlineStats.points} points &middot; area {outlineStats.areaMm2.toFixed(0)} mm&sup2;
            <br />
            {outlineStats.svgWidthMm !== null && outlineStats.svgHeightMm !== null ? (
              <>
                SVG: {outlineStats.svgWidthMm.toFixed(1)} &times; {outlineStats.svgHeightMm.toFixed(1)} mm
              </>
            ) : (
              'SVG: unavailable (export failed — see below)'
            )}
          </p>
        )}
        <div className="export-actions">
          <button type="button" className="btn primary" disabled={!exportResult} onClick={onDownload}>
            Download SVG
          </button>
          <button type="button" className="btn" disabled={!exportResult} onClick={onCopySvg}>
            Copy SVG
          </button>
        </div>
        {copyStatus && <p className="hint">{copyStatus}</p>}
        {exportError && <p className="pill pill-bad">{exportError}</p>}
      </section>
    </aside>
  )
}
