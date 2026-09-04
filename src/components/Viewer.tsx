import { useEffect, useRef, useState } from 'react'
import { Box } from '../lib/box'
import type { ExportResult, OutlineResult, Polygon, Pt, Rectified } from '../pipeline/types'
import type { PhotoResult } from './types'
import OutlineEditor from './OutlineEditor'

interface ViewerProps {
  rectified: Box<Rectified> | null
  photo: Box<PhotoResult> | null
  outline: Box<OutlineResult> | null
  exportResult: Box<ExportResult> | null
  /** `editedPolygon ?? outline.polygon` — boxed because a hand-edited or
   * traced polygon can have hundreds of points (see box.ts). */
  effectivePolygon: Box<Polygon> | null
  showMask: boolean
  manualPoints: Pt[]
  pickMm?: Pt
  editMode: boolean
  onClickMm: (pt: Pt) => void
  onClickPx: (pt: Pt) => void
  onPolygonChange: (polygon: Polygon) => void
  onExitEditMode: () => void
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

export default function Viewer({
  rectified,
  photo,
  outline,
  exportResult,
  effectivePolygon,
  showMask,
  manualPoints,
  pickMm,
  editMode,
  onClickMm,
  onClickPx,
  onPolygonChange,
  onExitEditMode,
}: ViewerProps) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const maskCanvasRef = useRef<HTMLCanvasElement>(null)
  const overlayRef = useRef<SVGSVGElement>(null)
  const [overlayWidthPx, setOverlayWidthPx] = useState(0)

  const rect = rectified?.value ?? null
  const outlineValue = outline?.value ?? null
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
    if (!rect || !outlineValue || !showMask) {
      maskCanvas.width = 0
      maskCanvas.height = 0
      return
    }
    const tinted = tintMask(outlineValue.mask, MASK_TINT)
    maskCanvas.width = tinted.width
    maskCanvas.height = tinted.height
    const ctx = maskCanvas.getContext('2d')
    if (!ctx) return
    ctx.putImageData(tinted, 0, 0)
  }, [rect, outlineValue, showMask])

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

  // Escape exits edit mode.
  useEffect(() => {
    if (!editMode) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onExitEditMode()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [editMode, onExitEditMode])

  const widthMm = rect ? rect.image.width / rect.pxPerMm : 0
  const heightMm = rect ? rect.image.height / rect.pxPerMm : 0
  const mmPerScreenPx = widthMm > 0 && overlayWidthPx > 0 ? widthMm / overlayWidthPx : 0

  const handleClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (editMode) return // OutlineEditor owns interaction while editing.
    const canvas = canvasRef.current
    if (!canvas || !activeImage) return
    const bounds = canvas.getBoundingClientRect()
    if (bounds.width === 0 || bounds.height === 0) return
    const fx = (e.clientX - bounds.left) / bounds.width
    const fy = (e.clientY - bounds.top) / bounds.height
    if (fx < 0 || fx > 1 || fy < 0 || fy > 1) return
    if (rect) {
      onClickMm({ x: fx * widthMm, y: fy * heightMm })
    } else {
      onClickPx({ x: fx * activeImage.width, y: fy * activeImage.height })
    }
  }

  const exportValue = exportResult?.value ?? null
  const effectivePolygonValue = effectivePolygon?.value ?? null

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

      {activeImage && (
        <div
          className={`viewer-canvas-wrap${editMode ? ' viewer-canvas-wrap-editing' : ''}`}
          ref={wrapRef}
          onClick={handleClick}
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
              style={{ pointerEvents: editMode ? 'auto' : 'none' }}
            >
              {editMode && effectivePolygon && mmPerScreenPx > 0 ? (
                <OutlineEditor polygon={effectivePolygon} mmPerScreenPx={mmPerScreenPx} onChange={onPolygonChange} />
              ) : (
                effectivePolygonValue && (
                  <path
                    d={polygonToPathD(effectivePolygonValue)}
                    fill="none"
                    stroke="#d32f2f"
                    strokeWidth={0.4}
                    vectorEffect="non-scaling-stroke"
                  />
                )
              )}
              {!editMode && pickMm && (
                <g stroke="#1258c4" strokeWidth={0.3} vectorEffect="non-scaling-stroke">
                  <line x1={pickMm.x - 3} y1={pickMm.y} x2={pickMm.x + 3} y2={pickMm.y} />
                  <line x1={pickMm.x} y1={pickMm.y - 3} x2={pickMm.x} y2={pickMm.y + 3} />
                </g>
              )}
            </svg>
          )}
        </div>
      )}

      <div className="export-preview">
        <h3 className="export-preview-title">Export preview</h3>
        {exportValue ? (
          <>
            <div
              className="export-preview-canvas"
              dangerouslySetInnerHTML={{ __html: exportValue.svg }}
            />
            <p className="export-preview-caption">
              {exportValue.widthMm.toFixed(1)} &times; {exportValue.heightMm.toFixed(1)} mm
            </p>
          </>
        ) : (
          <p className="export-preview-empty">No outline extracted yet.</p>
        )}
      </div>
    </div>
  )
}
