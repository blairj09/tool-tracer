import { useEffect, useRef, useState } from 'react'
import { Box } from '../lib/box'
import { pointInPolygon } from '../pipeline/align'
import type { DetectionResult, Polygon, Pt, Rectified, Tool } from '../pipeline/types'
import type { PhotoResult, UiMode } from './types'
import { colourForIndex } from './palette'
import OutlineEditor from './OutlineEditor'

interface ViewerProps {
  rectified: Box<Rectified> | null
  photo: Box<PhotoResult> | null
  detection: Box<DetectionResult> | null
  /** Every tool, in list order (colour = index into the shared palette). */
  tools: Box<Tool[]>
  selection: { toolId: string; componentId?: string } | null
  mode: UiMode
  /** In-progress polygon for `mode === 'draw'`, in image-frame mm. */
  draft: Pt[]
  /** Effective polygon (edited ?? polygon) of the current selection (tool
   * or component), bound to `OutlineEditor` while `mode === 'edit'`. */
  editTarget: Box<Polygon> | null
  showMask: boolean
  manualPoints: Pt[]
  /** Manual-scale two-point picking, active only before `rectified` exists. */
  onClickPx: (pt: Pt) => void
  onSelectTool: (toolId: string) => void
  onSelectComponent: (toolId: string, componentId: string) => void
  onAddToolAt: (pt: Pt) => void
  onSeedComponentAt: (pt: Pt) => void
  onDraftPoint: (pt: Pt) => void
  onDraftComplete: () => void
  onDraftCancel: () => void
  onPolygonChange: (polygon: Polygon) => void
  onCancelMode: () => void
}

const MASK_TINT: [number, number, number] = [220, 45, 45]

function tintMask(mask: ImageData, rgb: [number, number, number]): ImageData {
  const { width, height, data } = mask
  const out = new Uint8ClampedArray(width * height * 4)
  for (let i = 0; i < width * height; i++) {
    const alpha = data[i * 4] // mask is white(255)=tool, black(0)=background
    out[i * 4] = rgb[0]
    out[i * 4 + 1] = rgb[1]
    out[i * 4 + 2] = rgb[2]
    out[i * 4 + 3] = alpha
  }
  return new ImageData(out, width, height)
}

function polygonToPathD(polygon: Pt[]): string {
  if (polygon.length === 0) return ''
  const [first, ...rest] = polygon
  return `M ${first.x} ${first.y} ` + rest.map((p) => `L ${p.x} ${p.y}`).join(' ') + ' Z'
}

/** Component hit-test first (against the selected tool only), then every
 * tool's own effective polygon. */
function hitTest(
  tools: Tool[],
  selection: { toolId: string; componentId?: string } | null,
  pt: Pt,
): { toolId: string; componentId?: string } | null {
  if (selection) {
    const selTool = tools.find((t) => t.id === selection.toolId)
    if (selTool) {
      for (const c of selTool.components) {
        const poly = c.edited ?? c.polygon
        if (poly.length >= 3 && pointInPolygon(pt, poly)) {
          return { toolId: selTool.id, componentId: c.id }
        }
      }
    }
  }
  for (const t of tools) {
    const poly = t.edited ?? t.polygon
    if (poly.length >= 3 && pointInPolygon(pt, poly)) {
      return { toolId: t.id }
    }
  }
  return null
}

function modeLabel(mode: UiMode): string {
  switch (mode) {
    case 'select':
      return 'Select'
    case 'seed':
      return 'Add component'
    case 'draw':
      return 'Draw component'
    case 'edit':
      return 'Edit vertices'
  }
}

function modeHint(mode: UiMode): string {
  switch (mode) {
    case 'select':
      return 'Click a tool to select it, or an untraced blob to add it.'
    case 'seed':
      return 'Click the part inside the selected tool.'
    case 'draw':
      return 'Click to add points; click the first point or double-click to close. Esc to cancel.'
    case 'edit':
      return 'Drag a point to move it. Click an edge to add a point. Alt-click (or right-click) a point to delete it. Esc to finish.'
  }
}

export default function Viewer({
  rectified,
  photo,
  detection,
  tools,
  selection,
  mode,
  draft,
  editTarget,
  showMask,
  manualPoints,
  onClickPx,
  onSelectTool,
  onSelectComponent,
  onAddToolAt,
  onSeedComponentAt,
  onDraftPoint,
  onDraftComplete,
  onDraftCancel,
  onPolygonChange,
  onCancelMode,
}: ViewerProps) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const maskCanvasRef = useRef<HTMLCanvasElement>(null)
  const overlayRef = useRef<SVGSVGElement>(null)
  const [overlayWidthPx, setOverlayWidthPx] = useState(0)

  const rect = rectified?.value ?? null
  const detectionValue = detection?.value ?? null
  const toolsValue = tools.value
  const rawImage = photo?.value.image ?? null
  const activeImage = rect ? rect.image : rawImage

  // Draw the base image (+ manual-mode crosshairs, drawn directly in the
  // canvas's own pixel space so they always line up with the image).
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !activeImage) return
    canvas.width = activeImage.width
    canvas.height = activeImage.height
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.putImageData(activeImage, 0, 0)

    if (!rect && manualPoints.length > 0) {
      ctx.strokeStyle = '#1258c4'
      ctx.fillStyle = '#1258c4'
      ctx.lineWidth = Math.max(2, activeImage.width / 400)
      const r = Math.max(6, activeImage.width / 150)
      if (manualPoints.length === 2) {
        ctx.beginPath()
        ctx.moveTo(manualPoints[0].x, manualPoints[0].y)
        ctx.lineTo(manualPoints[1].x, manualPoints[1].y)
        ctx.stroke()
      }
      for (const p of manualPoints) {
        ctx.beginPath()
        ctx.moveTo(p.x - r, p.y)
        ctx.lineTo(p.x + r, p.y)
        ctx.moveTo(p.x, p.y - r)
        ctx.lineTo(p.x, p.y + r)
        ctx.stroke()
        ctx.beginPath()
        ctx.arc(p.x, p.y, r * 0.3, 0, Math.PI * 2)
        ctx.fill()
      }
    }
  }, [activeImage, rect, manualPoints])

  // Draw the mask overlay (only meaningful once we have a rectified image).
  useEffect(() => {
    const maskCanvas = maskCanvasRef.current
    if (!maskCanvas) return
    if (!rect || !detectionValue || !showMask) {
      maskCanvas.width = 0
      maskCanvas.height = 0
      return
    }
    const tinted = tintMask(detectionValue.mask, MASK_TINT)
    maskCanvas.width = tinted.width
    maskCanvas.height = tinted.height
    const ctx = maskCanvas.getContext('2d')
    if (!ctx) return
    ctx.putImageData(tinted, 0, 0)
  }, [rect, detectionValue, showMask])

  // Track the overlay SVG's on-screen width so edit-mode handles stay a
  // roughly constant screen size (~8px) regardless of zoom/layout. Re-runs
  // when `rect` toggles because the overlay <svg> only exists while there's
  // a rectified image.
  useEffect(() => {
    const el = overlayRef.current
    if (!el) {
      setOverlayWidthPx(0)
      return
    }
    const update = () => setOverlayWidthPx(el.getBoundingClientRect().width)
    update()
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => ro.disconnect()
  }, [rect])

  // Escape always returns to select mode (and drops any in-progress draft);
  // Enter closes an in-progress draw with >= 3 points.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (mode === 'draw') onDraftCancel()
        else onCancelMode()
      } else if (e.key === 'Enter' && mode === 'draw' && draft.length >= 3) {
        onDraftComplete()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [mode, draft, onCancelMode, onDraftCancel, onDraftComplete])

  const widthMm = rect ? rect.image.width / rect.pxPerMm : 0
  const heightMm = rect ? rect.image.height / rect.pxPerMm : 0
  const mmPerScreenPx = widthMm > 0 && overlayWidthPx > 0 ? widthMm / overlayWidthPx : 0

  const handleClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (mode === 'edit') return // OutlineEditor owns interaction while editing.
    const canvas = canvasRef.current
    if (!canvas || !activeImage) return
    const bounds = canvas.getBoundingClientRect()
    if (bounds.width === 0 || bounds.height === 0) return
    const fx = (e.clientX - bounds.left) / bounds.width
    const fy = (e.clientY - bounds.top) / bounds.height
    if (fx < 0 || fx > 1 || fy < 0 || fy > 1) return

    if (!rect) {
      onClickPx({ x: fx * activeImage.width, y: fy * activeImage.height })
      return
    }

    const mm = { x: fx * widthMm, y: fy * heightMm }
    if (mode === 'select') {
      const hit = hitTest(toolsValue, selection, mm)
      if (hit) {
        if (hit.componentId) onSelectComponent(hit.toolId, hit.componentId)
        else onSelectTool(hit.toolId)
      } else {
        onAddToolAt(mm)
      }
    } else if (mode === 'seed') {
      const selTool = selection ? toolsValue.find((t) => t.id === selection.toolId) : undefined
      const parentPolygon = selTool ? (selTool.edited ?? selTool.polygon) : []
      if (parentPolygon.length >= 3 && pointInPolygon(mm, parentPolygon)) {
        onSeedComponentAt(mm)
      }
      // else: outside the selected tool — ignore (mode-bar hint explains where to click).
    } else if (mode === 'draw') {
      if (draft.length >= 3) {
        const first = draft[0]
        if (Math.hypot(mm.x - first.x, mm.y - first.y) <= 8 * mmPerScreenPx) {
          onDraftComplete()
          return
        }
      }
      onDraftPoint(mm)
    }
  }

  const handleDoubleClick = () => {
    if (mode === 'draw' && draft.length >= 3) onDraftComplete()
  }

  return (
    <div className="viewer">
      {!activeImage && (
        <div className="viewer-empty">
          <p className="viewer-empty-title">Upload a photo to begin</p>
          <ol className="viewer-empty-steps">
            <li>Print the template and place your tool inside the grey rectangle.</li>
            <li>Photograph it straight down, all four markers visible.</li>
            <li>Upload the photo — ToolTrace rectifies it and traces the outline.</li>
          </ol>
        </div>
      )}

      {rect && (
        <div className="mode-bar">
          <div className="mode-bar-text">
            <span className="mode-bar-label">{modeLabel(mode)}</span>
            <span className="mode-bar-hint">{modeHint(mode)}</span>
          </div>
          <div className="mode-bar-actions">
            {mode !== 'select' && (
              <button type="button" className="btn" onClick={mode === 'draw' ? onDraftCancel : onCancelMode}>
                Cancel
              </button>
            )}
            {mode === 'draw' && draft.length >= 3 && (
              <button type="button" className="btn primary" onClick={onDraftComplete}>
                Done
              </button>
            )}
          </div>
        </div>
      )}

      {activeImage && (
        <div
          className={`viewer-canvas-wrap${mode === 'edit' ? ' viewer-canvas-wrap-editing' : ''}`}
          ref={wrapRef}
          onClick={handleClick}
          onDoubleClick={handleDoubleClick}
          style={{ aspectRatio: `${activeImage.width} / ${activeImage.height}` }}
        >
          <canvas ref={canvasRef} className="viewer-canvas" />
          <canvas ref={maskCanvasRef} className="viewer-mask-canvas" />
          {rect && (
            <svg
              ref={overlayRef}
              className="viewer-overlay"
              viewBox={`0 0 ${widthMm} ${heightMm}`}
              preserveAspectRatio="none"
              style={{ pointerEvents: mode === 'edit' ? 'auto' : 'none' }}
            >
              {mode === 'edit' && editTarget && mmPerScreenPx > 0 ? (
                <OutlineEditor polygon={editTarget} mmPerScreenPx={mmPerScreenPx} onChange={onPolygonChange} />
              ) : (
                <>
                  {toolsValue.map((t, i) => {
                    const poly = t.edited ?? t.polygon
                    if (poly.length < 3) return null
                    const isSelectedTool = selection?.toolId === t.id
                    const colour = colourForIndex(i)
                    return (
                      <g key={t.id}>
                        <path
                          d={polygonToPathD(poly)}
                          fill={isSelectedTool ? colour : 'none'}
                          fillOpacity={isSelectedTool ? 0.12 : 0}
                          stroke={colour}
                          strokeWidth={isSelectedTool ? 0.6 : 0.35}
                          vectorEffect="non-scaling-stroke"
                        />
                        {t.components.map((c) => {
                          const cpoly = c.edited ?? c.polygon
                          if (cpoly.length < 3) return null
                          const isSelectedComp = isSelectedTool && selection?.componentId === c.id
                          return (
                            <path
                              key={c.id}
                              d={polygonToPathD(cpoly)}
                              fill={isSelectedComp ? '#2e7d32' : 'none'}
                              fillOpacity={isSelectedComp ? 0.18 : 0}
                              stroke="#2e7d32"
                              strokeWidth={isSelectedComp ? 0.5 : 0.3}
                              vectorEffect="non-scaling-stroke"
                            />
                          )
                        })}
                      </g>
                    )
                  })}
                  {mode === 'draw' && draft.length > 0 && (
                    <g stroke="#1258c4" strokeWidth={0.3} fill="none" vectorEffect="non-scaling-stroke">
                      {draft.length > 1 && (
                        <polyline points={draft.map((p) => `${p.x},${p.y}`).join(' ')} strokeDasharray="1.2,0.8" />
                      )}
                      {draft.map((p, i) => (
                        <circle
                          key={i}
                          cx={p.x}
                          cy={p.y}
                          r={i === 0 ? 8 * mmPerScreenPx : 3 * mmPerScreenPx}
                          fill={i === 0 ? 'rgba(18,88,196,0.25)' : '#1258c4'}
                          stroke="#1258c4"
                          strokeWidth={0.2}
                          vectorEffect="non-scaling-stroke"
                        />
                      ))}
                    </g>
                  )}
                </>
              )}
            </svg>
          )}
        </div>
      )}
    </div>
  )
}
