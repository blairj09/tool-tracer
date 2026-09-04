// Interactive vertex editor for the traced outline, rendered as SVG children
// inside Viewer's mm-unit overlay (`<svg viewBox="0 0 widthMm heightMm">`).
// All geometry here is in millimetres, in the same image-frame coordinate
// space as `outline.polygon` — alignment/rotation for export still happens
// separately in `exportOutline`.
import { useState } from 'react'
import { Box } from '../lib/box'
import type { Polygon, Pt } from '../pipeline/types'

interface OutlineEditorProps {
  polygon: Box<Polygon>
  mmPerScreenPx: number
  onChange: (polygon: Polygon) => void
}

function polygonToPathD(polygon: Pt[]): string {
  if (polygon.length === 0) return ''
  const [first, ...rest] = polygon
  return `M ${first.x} ${first.y} ` + rest.map((p) => `L ${p.x} ${p.y}`).join(' ') + ' Z'
}

/** Convert a client-space point to the mm coordinates of `svg`'s viewBox. */
function clientToMm(svg: SVGSVGElement, clientX: number, clientY: number): Pt {
  const rect = svg.getBoundingClientRect()
  const vb = svg.viewBox.baseVal
  const fx = rect.width > 0 ? (clientX - rect.left) / rect.width : 0
  const fy = rect.height > 0 ? (clientY - rect.top) / rect.height : 0
  return { x: vb.x + fx * vb.width, y: vb.y + fy * vb.height }
}

/** Closest point to `p` on segment a-b, plus the squared distance to it. */
function projectPointToSegment(p: Pt, a: Pt, b: Pt): { point: Pt; distSq: number } {
  const abx = b.x - a.x
  const aby = b.y - a.y
  const lenSq = abx * abx + aby * aby
  let t = lenSq > 0 ? ((p.x - a.x) * abx + (p.y - a.y) * aby) / lenSq : 0
  t = Math.max(0, Math.min(1, t))
  const point = { x: a.x + t * abx, y: a.y + t * aby }
  const dx = p.x - point.x
  const dy = p.y - point.y
  return { point, distSq: dx * dx + dy * dy }
}

export default function OutlineEditor({ polygon, mmPerScreenPx, onChange }: OutlineEditorProps) {
  const pts = polygon.value
  // In-flight drag position, kept local (not committed to `onChange`) until
  // pointerup — `outline`/`editedPolygon` must not be re-derived on every
  // intermediate move.
  const [drag, setDrag] = useState<{ index: number; pt: Pt } | null>(null)

  const displayPts = drag ? pts.map((p, i) => (i === drag.index ? drag.pt : p)) : pts

  const vertexR = 4 * mmPerScreenPx
  const hitR = 8 * mmPerScreenPx
  const edgeHitWidth = 8 * mmPerScreenPx
  const vertexStroke = Math.max(0.05, 1 * mmPerScreenPx)

  function deleteVertex(index: number) {
    if (pts.length <= 3) return
    onChange(pts.filter((_, i) => i !== index))
  }

  function insertAtNearestEdge(mm: Pt) {
    const n = pts.length
    if (n < 2) return
    let bestIndex = 0
    let bestDistSq = Infinity
    let bestPoint: Pt = mm
    for (let i = 0; i < n; i++) {
      const a = pts[i]
      const b = pts[(i + 1) % n]
      const { point, distSq } = projectPointToSegment(mm, a, b)
      if (distSq < bestDistSq) {
        bestDistSq = distSq
        bestIndex = i
        bestPoint = point
      }
    }
    const next = [...pts.slice(0, bestIndex + 1), bestPoint, ...pts.slice(bestIndex + 1)]
    onChange(next)
  }

  function handleVertexPointerDown(e: React.PointerEvent<SVGCircleElement>, index: number) {
    e.stopPropagation()
    if (e.altKey) {
      e.preventDefault()
      deleteVertex(index)
      return
    }
    e.currentTarget.setPointerCapture(e.pointerId)
    setDrag({ index, pt: pts[index] })
  }

  function handleVertexPointerMove(e: React.PointerEvent<SVGCircleElement>) {
    if (!drag) return
    const svg = e.currentTarget.ownerSVGElement
    if (!svg) return
    const mm = clientToMm(svg, e.clientX, e.clientY)
    setDrag((d) => (d ? { ...d, pt: mm } : d))
  }

  function handleVertexPointerUp(e: React.PointerEvent<SVGCircleElement>) {
    e.stopPropagation()
    if (!drag) return
    const next = pts.map((p, i) => (i === drag.index ? drag.pt : p))
    setDrag(null)
    onChange(next)
  }

  function handleVertexContextMenu(e: React.MouseEvent<SVGCircleElement>, index: number) {
    e.preventDefault()
    e.stopPropagation()
    deleteVertex(index)
  }

  function handleEdgeClick(e: React.MouseEvent<SVGPathElement>) {
    e.stopPropagation()
    const svg = e.currentTarget.ownerSVGElement
    if (!svg) return
    const mm = clientToMm(svg, e.clientX, e.clientY)
    insertAtNearestEdge(mm)
  }

  const pathD = polygonToPathD(displayPts)

  return (
    <g className="outline-editor">
      {/* Wide invisible stroke for click-to-insert edge hit-testing. */}
      <path
        d={pathD}
        fill="none"
        stroke="transparent"
        strokeWidth={edgeHitWidth}
        pointerEvents="stroke"
        style={{ cursor: 'copy' }}
        onClick={handleEdgeClick}
      />
      {/* Visible thin outline. */}
      <path
        d={pathD}
        fill="none"
        stroke="#d32f2f"
        strokeWidth={0.4}
        vectorEffect="non-scaling-stroke"
        pointerEvents="none"
      />
      {displayPts.map((p, i) => (
        <g key={i}>
          <circle
            cx={p.x}
            cy={p.y}
            r={hitR}
            fill="transparent"
            pointerEvents="auto"
            style={{ cursor: 'grab', touchAction: 'none' }}
            onPointerDown={(e) => handleVertexPointerDown(e, i)}
            onPointerMove={handleVertexPointerMove}
            onPointerUp={handleVertexPointerUp}
            onContextMenu={(e) => handleVertexContextMenu(e, i)}
          />
          <circle
            cx={p.x}
            cy={p.y}
            r={vertexR}
            fill="#fff"
            stroke="#d32f2f"
            strokeWidth={vertexStroke}
            pointerEvents="none"
          />
        </g>
      ))}
    </g>
  )
}
