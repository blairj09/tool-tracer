import { useEffect, useRef } from 'react'
import type { ExportResult, OutlineResult, Pt, Rectified } from '../pipeline/types'

interface ViewerProps {
  rectified: Rectified | null
  rawImage: ImageData | null
  outline: OutlineResult | null
  exportResult: ExportResult | null
  showMask: boolean
  manualPoints: Pt[]
  pickMm?: Pt
  onClickMm: (pt: Pt) => void
  onClickPx: (pt: Pt) => void
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
  rawImage,
  outline,
  exportResult,
  showMask,
  manualPoints,
  pickMm,
  onClickMm,
  onClickPx,
}: ViewerProps) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const maskCanvasRef = useRef<HTMLCanvasElement>(null)

  const activeImage = rectified ? rectified.image : rawImage

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

    if (!rectified && manualPoints.length > 0) {
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
  }, [activeImage, rectified, manualPoints])

  // Draw the mask overlay (only meaningful once we have a rectified image).
  useEffect(() => {
    const maskCanvas = maskCanvasRef.current
    if (!maskCanvas) return
    if (!rectified || !outline || !showMask) {
      maskCanvas.width = 0
      maskCanvas.height = 0
      return
    }
    const tinted = tintMask(outline.mask, MASK_TINT)
    maskCanvas.width = tinted.width
    maskCanvas.height = tinted.height
    const ctx = maskCanvas.getContext('2d')
    if (!ctx) return
    ctx.putImageData(tinted, 0, 0)
  }, [rectified, outline, showMask])

  const widthMm = rectified ? rectified.image.width / rectified.pxPerMm : 0
  const heightMm = rectified ? rectified.image.height / rectified.pxPerMm : 0

  const handleClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const canvas = canvasRef.current
    if (!canvas || !activeImage) return
    const rect = canvas.getBoundingClientRect()
    if (rect.width === 0 || rect.height === 0) return
    const fx = (e.clientX - rect.left) / rect.width
    const fy = (e.clientY - rect.top) / rect.height
    if (fx < 0 || fx > 1 || fy < 0 || fy > 1) return
    if (rectified) {
      onClickMm({ x: fx * widthMm, y: fy * heightMm })
    } else {
      onClickPx({ x: fx * activeImage.width, y: fy * activeImage.height })
    }
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

      {activeImage && (
        <div
          className="viewer-canvas-wrap"
          ref={wrapRef}
          onClick={handleClick}
          style={{ aspectRatio: `${activeImage.width} / ${activeImage.height}` }}
        >
          <canvas ref={canvasRef} className="viewer-canvas" />
          <canvas ref={maskCanvasRef} className="viewer-mask-canvas" />
          {rectified && (
            <svg
              className="viewer-overlay"
              viewBox={`0 0 ${widthMm} ${heightMm}`}
              preserveAspectRatio="none"
            >
              {outline && (
                <path
                  d={polygonToPathD(outline.polygon)}
                  fill="none"
                  stroke="#d32f2f"
                  strokeWidth={0.4}
                  vectorEffect="non-scaling-stroke"
                />
              )}
              {pickMm && (
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
        {exportResult ? (
          <>
            <div
              className="export-preview-canvas"
              dangerouslySetInnerHTML={{ __html: exportResult.svg }}
            />
            <p className="export-preview-caption">
              {exportResult.widthMm.toFixed(1)} &times; {exportResult.heightMm.toFixed(1)} mm
            </p>
          </>
        ) : (
          <p className="export-preview-empty">No outline extracted yet.</p>
        )}
      </div>
    </div>
  )
}
