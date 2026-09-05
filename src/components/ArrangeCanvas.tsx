// Interactive arrange canvas: shows every traced tool (+ components) in the
// "layout frame" — the combined export, shifted back by `originShift` so it
// lines up with the polygons the rest of the UI already works in — and lets
// the user drag each tool to move it and use a rotation handle to spin it.
// Dragging only updates local state; the parent's `layout` (and therefore
// the OpenCV-backed re-export) is only touched on pointerup.
import { useEffect, useMemo, useRef, useState } from 'react'
import { Box } from '../lib/box'
import { bbox } from '../pipeline/align'
import type { Polygon, Pt, Transform } from '../pipeline/types'
import ZoomPane from './ZoomPane'

export interface ArrangeItem {
  toolId: string
  name: string
  colour: string
  transform: Transform // committed
  anchor: Pt // rotation pivot (tool centroid), layout frame
  outline: Polygon // layout frame (export outline shifted back by originShift)
  clearance?: Polygon
  components: { outline: Polygon; clearance?: Polygon }[]
}

interface ArrangeCanvasProps {
  items: Box<ArrangeItem[]>
  /** Export-frame -> layout-frame translation (layout = export - originShift). */
  originShift: Pt
  widthMm: number
  heightMm: number
  marginMm: number
  fixedCanvas: boolean
  selectedToolId: string | null
  gridSnap: boolean
  /** Bump to reset the zoom/pan view to fit (e.g. on "Reset layout"). */
  resetSignal?: number
  onSelectTool: (toolId: string) => void
  onTransformChange: (toolId: string, transform: Transform) => void
}

type DragState =
  | { kind: 'translate'; toolId: string; base: Transform; startMm: Pt; dx: number; dy: number }
  | { kind: 'rotate'; toolId: string; base: Transform; anchor: Pt; startAngle: number; dAngle: number }

function polygonToPathD(polygon: Polygon): string {
  if (polygon.length === 0) return ''
  const [first, ...rest] = polygon
  return `M ${first.x} ${first.y} ` + rest.map((p) => `L ${p.x} ${p.y}`).join(' ') + ' Z'
}

function clientToMm(svg: SVGSVGElement, clientX: number, clientY: number): Pt {
  const rect = svg.getBoundingClientRect()
  const vb = svg.viewBox.baseVal
  const fx = rect.width > 0 ? (clientX - rect.left) / rect.width : 0
  const fy = rect.height > 0 ? (clientY - rect.top) / rect.height : 0
  return { x: vb.x + fx * vb.width, y: vb.y + fy * vb.height }
}

function angleBetween(from: Pt, to: Pt): number {
  return (Math.atan2(to.y - from.y, to.x - from.x) * 180) / Math.PI
}

export default function ArrangeCanvas({
  items,
  originShift,
  widthMm,
  heightMm,
  marginMm,
  fixedCanvas,
  selectedToolId,
  gridSnap,
  resetSignal = 0,
  onSelectTool,
  onTransformChange,
}: ArrangeCanvasProps) {
  const svgRef = useRef<SVGSVGElement>(null)
  const [overlayWidthPx, setOverlayWidthPx] = useState(0)
  const [zoom, setZoom] = useState(1)
  const [drag, setDrag] = useState<DragState | null>(null)

  const hasItems = items.value.length > 0

  // Re-runs when the <svg> mounts/unmounts (it only exists once there's at
  // least one item — see the empty-state branch below), matching Viewer's
  // equivalent effect keyed on `rect`.
  useEffect(() => {
    const el = svgRef.current
    if (!el) {
      setOverlayWidthPx(0)
      return
    }
    const update = () => setOverlayWidthPx(el.getBoundingClientRect().width)
    update()
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => ro.disconnect()
  }, [hasItems])

  // See Viewer's equivalent effect: ZoomPane's zoom is an ancestor
  // transform, invisible to a ResizeObserver on this element, so re-measure
  // explicitly whenever it changes (keeps the rotate handle a constant
  // screen size under zoom).
  useEffect(() => {
    const el = svgRef.current
    if (el) setOverlayWidthPx(el.getBoundingClientRect().width)
  }, [zoom])

  // Viewbox in the layout frame: bbox of every exported polygon (+ the
  // fixed-canvas rectangle, so it's visible even before anything is placed
  // inside it) padded by marginMm. Recomputed only when `items` (or the
  // canvas/margin config) changes — never on an in-flight drag frame, since
  // dragging only touches local `drag` state.
  const canvasRectLayout = useMemo(
    () => ({ x: -originShift.x, y: -originShift.y, w: widthMm, h: heightMm }),
    [originShift, widthMm, heightMm],
  )

  const viewBox = useMemo(() => {
    const list = items.value
    const polys: Polygon[] = []
    for (const it of list) {
      polys.push(it.outline)
      if (it.clearance) polys.push(it.clearance)
      for (const c of it.components) {
        polys.push(c.outline)
        if (c.clearance) polys.push(c.clearance)
      }
    }
    const { x: cx, y: cy, w: cw, h: ch } = canvasRectLayout
    if (cw > 0 && ch > 0) {
      polys.push([
        { x: cx, y: cy },
        { x: cx + cw, y: cy },
        { x: cx + cw, y: cy + ch },
        { x: cx, y: cy + ch },
      ])
    }
    const box = bbox(polys)
    const pad = marginMm
    return {
      x: box.x - pad,
      y: box.y - pad,
      w: Math.max(1, box.w + 2 * pad),
      h: Math.max(1, box.h + 2 * pad),
    }
  }, [items, canvasRectLayout, marginMm])

  const mmPerScreenPx = viewBox.w > 0 && overlayWidthPx > 0 ? viewBox.w / overlayWidthPx : 0

  const overflow = useMemo(() => {
    if (!fixedCanvas) return false
    const eps = 1e-6
    const { x: cx, y: cy, w: cw, h: ch } = canvasRectLayout
    for (const item of items.value) {
      const polys: Polygon[] = [item.outline, ...(item.clearance ? [item.clearance] : [])]
      for (const c of item.components) {
        polys.push(c.outline)
        if (c.clearance) polys.push(c.clearance)
      }
      for (const poly of polys) {
        for (const p of poly) {
          if (p.x < cx - eps || p.y < cy - eps || p.x > cx + cw + eps || p.y > cy + ch + eps) return true
        }
      }
    }
    return false
  }, [items, fixedCanvas, canvasRectLayout])

  function handleBodyPointerDown(e: React.PointerEvent<SVGPathElement>, item: ArrangeItem) {
    e.stopPropagation()
    onSelectTool(item.toolId)
    const svg = svgRef.current
    if (!svg) return
    e.currentTarget.setPointerCapture(e.pointerId)
    const startMm = clientToMm(svg, e.clientX, e.clientY)
    setDrag({ kind: 'translate', toolId: item.toolId, base: item.transform, startMm, dx: 0, dy: 0 })
  }

  function handleBodyPointerMove(e: React.PointerEvent<SVGPathElement>) {
    if (!drag || drag.kind !== 'translate') return
    const svg = svgRef.current
    if (!svg) return
    const mm = clientToMm(svg, e.clientX, e.clientY)
    let dx = mm.x - drag.startMm.x
    let dy = mm.y - drag.startMm.y
    if (gridSnap) {
      dx = Math.round(drag.base.dx + dx) - drag.base.dx
      dy = Math.round(drag.base.dy + dy) - drag.base.dy
    }
    setDrag({ ...drag, dx, dy })
  }

  function handleBodyPointerUp() {
    if (!drag || drag.kind !== 'translate') return
    if (drag.dx !== 0 || drag.dy !== 0) {
      onTransformChange(drag.toolId, {
        dx: drag.base.dx + drag.dx,
        dy: drag.base.dy + drag.dy,
        angleDeg: drag.base.angleDeg,
      })
    }
    setDrag(null)
  }

  function handleRotatePointerDown(e: React.PointerEvent<SVGCircleElement>, item: ArrangeItem) {
    e.stopPropagation()
    onSelectTool(item.toolId)
    const svg = svgRef.current
    if (!svg) return
    e.currentTarget.setPointerCapture(e.pointerId)
    const mm = clientToMm(svg, e.clientX, e.clientY)
    const startAngle = angleBetween(item.anchor, mm)
    setDrag({ kind: 'rotate', toolId: item.toolId, base: item.transform, anchor: item.anchor, startAngle, dAngle: 0 })
  }

  function handleRotatePointerMove(e: React.PointerEvent<SVGCircleElement>) {
    if (!drag || drag.kind !== 'rotate') return
    const svg = svgRef.current
    if (!svg) return
    const mm = clientToMm(svg, e.clientX, e.clientY)
    const current = angleBetween(drag.anchor, mm)
    let dAngle = current - drag.startAngle
    if (e.shiftKey) {
      const total = drag.base.angleDeg + dAngle
      const snapped = Math.round(total / 15) * 15
      dAngle = snapped - drag.base.angleDeg
    }
    setDrag({ ...drag, dAngle })
  }

  function handleRotatePointerUp() {
    if (!drag || drag.kind !== 'rotate') return
    if (drag.dAngle !== 0) {
      onTransformChange(drag.toolId, { dx: drag.base.dx, dy: drag.base.dy, angleDeg: drag.base.angleDeg + drag.dAngle })
    }
    setDrag(null)
  }

  const list = items.value
  const resetKey = useMemo(() => ({ resetSignal, count: list.length }), [resetSignal, list.length])

  return (
    <>
      <div className="pane-title">
        <span className="pane-title-text">
          {widthMm > 0 && heightMm > 0 ? (
            <>
              Arrange · {widthMm.toFixed(0)} &times; {heightMm.toFixed(0)} mm
            </>
          ) : (
            'Arrange'
          )}
        </span>
      </div>
      <div className="pane-body">
        {list.length === 0 ? (
          <p className="arrange-canvas-empty">Trace a tool to arrange it here.</p>
        ) : (
          <ZoomPane aspect={viewBox.w / viewBox.h} resetKey={resetKey} onScaleChange={setZoom}>
            <div className="arrange-canvas-surface">
              <svg
                ref={svgRef}
                viewBox={`${viewBox.x} ${viewBox.y} ${viewBox.w} ${viewBox.h}`}
                preserveAspectRatio="none"
                className="arrange-canvas-svg"
              >
              {canvasRectLayout.w > 0 && canvasRectLayout.h > 0 && (
                <rect
                  x={canvasRectLayout.x}
                  y={canvasRectLayout.y}
                  width={canvasRectLayout.w}
                  height={canvasRectLayout.h}
                  fill="none"
                  stroke={overflow ? '#b3261e' : '#999'}
                  strokeDasharray="2,1.5"
                  strokeWidth={0.3}
                  vectorEffect="non-scaling-stroke"
                />
              )}
              {list.map((item) => {
                const isSelected = item.toolId === selectedToolId
                const isDraggingThis = drag?.toolId === item.toolId
                const dx = isDraggingThis && drag.kind === 'translate' ? drag.dx : 0
                const dy = isDraggingThis && drag.kind === 'translate' ? drag.dy : 0
                const dAngle = isDraggingThis && drag.kind === 'rotate' ? drag.dAngle : 0
                const groupTransform = `translate(${dx} ${dy}) rotate(${dAngle} ${item.anchor.x} ${item.anchor.y})`
                const displayAngle = item.transform.angleDeg + dAngle
                const theta = (displayAngle * Math.PI) / 180
                const handleLen = 12 * mmPerScreenPx
                const handlePos = {
                  x: item.anchor.x + Math.sin(theta) * handleLen,
                  y: item.anchor.y - Math.cos(theta) * handleLen,
                }
                return (
                  <g key={item.toolId} transform={groupTransform}>
                    <path
                      d={polygonToPathD(item.outline)}
                      fill={isSelected ? item.colour : 'none'}
                      fillOpacity={isSelected ? 0.12 : 0}
                      stroke={item.colour}
                      strokeWidth={isSelected ? 0.6 : 0.35}
                      vectorEffect="non-scaling-stroke"
                      pointerEvents="none"
                    />
                    {item.clearance && (
                      <path
                        d={polygonToPathD(item.clearance)}
                        fill="none"
                        stroke={item.colour}
                        strokeOpacity={0.5}
                        strokeDasharray="1,0.6"
                        strokeWidth={0.3}
                        vectorEffect="non-scaling-stroke"
                        pointerEvents="none"
                      />
                    )}
                    {item.components.map((c, i) => (
                      <g key={i}>
                        <path
                          d={polygonToPathD(c.outline)}
                          fill="none"
                          stroke="#2e7d32"
                          strokeWidth={0.3}
                          vectorEffect="non-scaling-stroke"
                          pointerEvents="none"
                        />
                        {c.clearance && (
                          <path
                            d={polygonToPathD(c.clearance)}
                            fill="none"
                            stroke="#2e7d32"
                            strokeOpacity={0.5}
                            strokeDasharray="1,0.6"
                            strokeWidth={0.25}
                            vectorEffect="non-scaling-stroke"
                            pointerEvents="none"
                          />
                        )}
                      </g>
                    ))}
                    <path
                      d={polygonToPathD(item.outline)}
                      fill="transparent"
                      stroke="none"
                      pointerEvents="all"
                      style={{ cursor: 'grab', touchAction: 'none' }}
                      onPointerDown={(e) => handleBodyPointerDown(e, item)}
                      onPointerMove={handleBodyPointerMove}
                      onPointerUp={handleBodyPointerUp}
                    />
                    {isSelected && (
                      <g>
                        <line
                          x1={item.anchor.x}
                          y1={item.anchor.y}
                          x2={handlePos.x}
                          y2={handlePos.y}
                          stroke={item.colour}
                          strokeWidth={0.25}
                          vectorEffect="non-scaling-stroke"
                        />
                        <circle
                          cx={handlePos.x}
                          cy={handlePos.y}
                          r={5 * mmPerScreenPx}
                          fill="#fff"
                          stroke={item.colour}
                          strokeWidth={Math.max(0.05, 1 * mmPerScreenPx)}
                          style={{ cursor: 'grab', touchAction: 'none' }}
                          onPointerDown={(e) => handleRotatePointerDown(e, item)}
                          onPointerMove={handleRotatePointerMove}
                          onPointerUp={handleRotatePointerUp}
                        />
                      </g>
                    )}
                  </g>
                )
              })}
            </svg>
            </div>
          </ZoomPane>
        )}
        {overflow && <p className="arrange-canvas-warning">One or more tools overflow the fixed canvas.</p>}
      </div>
    </>
  )
}
