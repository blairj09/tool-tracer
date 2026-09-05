// Generic viewport-fitting zoom/pan wrapper used by Viewer and ArrangeCanvas.
// Measures its own box, sizes a child "zoom layer" to fit `aspect` inside it
// (object-fit: contain semantics), and lets the user zoom with the wheel
// (about the cursor) and pan by dragging the background. A drag past a
// small threshold is treated as a pan and the resulting click is swallowed
// so it doesn't fall through to the content's own click handlers; a plain
// click (no meaningful movement) passes through untouched.
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'

interface ZoomPaneProps {
  /** width / height of the content to fit. */
  aspect: number
  /** Changing this resets zoom/pan to the fitted view. */
  resetKey: unknown
  /** Called whenever the current zoom factor changes (for consumers whose
   * own mm-per-screen-px depends on it, since it's a transform-only change
   * that a ResizeObserver on the content itself won't pick up). */
  onScaleChange?: (z: number) => void
  children: ReactNode
}

const MIN_Z = 1
const MAX_Z = 10
const ZOOM_STEP = 1.1
const DRAG_THRESHOLD = 4
/** Fraction of the content's own width/height that must stay visible. */
const MIN_VISIBLE_FRACTION = 0.2

interface Transform {
  z: number
  tx: number
  ty: number
}

function clampZ(z: number): number {
  return Math.min(MAX_Z, Math.max(MIN_Z, z))
}

export default function ZoomPane({ aspect, resetKey, onScaleChange, children }: ZoomPaneProps) {
  const paneRef = useRef<HTMLDivElement>(null)
  const [paneSize, setPaneSize] = useState({ w: 0, h: 0 })
  const [transform, setTransform] = useState<Transform>({ z: 1, tx: 0, ty: 0 })
  const [isPanning, setIsPanning] = useState(false)

  // Both dimensions must be known before we can fit `aspect` inside the
  // pane — if only one has resolved yet (a transient mid-layout frame),
  // stay at 0x0 rather than sizing off the lone known dimension, which
  // would size the layer with no constraint on the other axis and let it
  // overflow the clipped pane body for a frame.
  const paneReady = aspect > 0 && paneSize.w > 0 && paneSize.h > 0
  const fitW = paneReady ? Math.min(paneSize.w, paneSize.h * aspect) : 0
  const fitH = paneReady ? fitW / aspect : 0

  // Baseline (unscaled, flex-centered) top-left offset of the zoom layer
  // within the pane.
  const x0 = (paneSize.w - fitW) / 2
  const y0 = (paneSize.h - fitH) / 2

  function clampTransform(t: Transform): Transform {
    const z = clampZ(t.z)
    const cw = fitW * z
    const ch = fitH * z
    const minVisibleW = cw * MIN_VISIBLE_FRACTION
    const minVisibleH = ch * MIN_VISIBLE_FRACTION
    const minTx = minVisibleW - cw - x0
    const maxTx = paneSize.w - minVisibleW - x0
    const minTy = minVisibleH - ch - y0
    const maxTy = paneSize.h - minVisibleH - y0
    return {
      z,
      tx: minTx <= maxTx ? Math.min(maxTx, Math.max(minTx, t.tx)) : 0,
      ty: minTy <= maxTy ? Math.min(maxTy, Math.max(minTy, t.ty)) : 0,
    }
  }

  // Measure the pane's own box.
  useEffect(() => {
    const el = paneRef.current
    if (!el) return
    const update = () => setPaneSize({ w: el.clientWidth, h: el.clientHeight })
    update()
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // Reset to fit whenever the caller says the content identity changed.
  useEffect(() => {
    setTransform({ z: 1, tx: 0, ty: 0 })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resetKey])

  // Re-clamp (without resetting) whenever the fitted size changes, e.g. a
  // pane resize or the content's aspect ratio changing (rectify landing).
  useLayoutEffect(() => {
    setTransform((prev) => clampTransform(prev))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fitW, fitH, paneSize.w, paneSize.h])

  // Notify the consumer of scale changes from an effect, never from render.
  useEffect(() => {
    onScaleChange?.(transform.z)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [transform.z])

  // Wheel-to-zoom, about the cursor. Non-passive so we can preventDefault
  // and stop the page from scrolling.
  useEffect(() => {
    const el = paneRef.current
    if (!el) return
    function onWheel(e: WheelEvent) {
      e.preventDefault()
      const rect = el!.getBoundingClientRect()
      const px = e.clientX - rect.left
      const py = e.clientY - rect.top
      const factor = e.deltaY < 0 ? ZOOM_STEP : 1 / ZOOM_STEP
      setTransform((prev) => {
        const nz = clampZ(prev.z * factor)
        const scale = nz / prev.z
        const qx = px - x0
        const qy = py - y0
        const ntx = qx * (1 - scale) + prev.tx * scale
        const nty = qy * (1 - scale) + prev.ty * scale
        return clampTransform({ z: nz, tx: ntx, ty: nty })
      })
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fitW, fitH, paneSize.w, paneSize.h, x0, y0])

  const dragRef = useRef<{
    pointerId: number
    startX: number
    startY: number
    /** Last pointer position we applied a step from — deltas accumulate
     * onto the *current* transform via a functional update, not onto a
     * snapshot taken at pointerdown, so a wheel-zoom that lands mid-drag
     * doesn't get clobbered by a pan step computed from a stale baseline. */
    lastX: number
    lastY: number
    moved: boolean
  } | null>(null)

  function swallowNextClick() {
    const swallow = (ev: MouseEvent) => {
      ev.stopPropagation()
      ev.preventDefault()
    }
    window.addEventListener('click', swallow, { capture: true, once: true })
    // A pan that ends outside the pane (or is cut short by pointercancel)
    // may never produce a click at all — don't leave the listener armed to
    // eat the user's *next* unrelated click.
    setTimeout(() => window.removeEventListener('click', swallow, true), 0)
  }

  function handlePointerDown(e: React.PointerEvent<HTMLDivElement>) {
    if (e.button !== 0) return
    dragRef.current = {
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      lastX: e.clientX,
      lastY: e.clientY,
      moved: false,
    }
  }

  function handlePointerMove(e: React.PointerEvent<HTMLDivElement>) {
    const d = dragRef.current
    if (!d || d.pointerId !== e.pointerId) return
    if (!d.moved) {
      if (Math.hypot(e.clientX - d.startX, e.clientY - d.startY) < DRAG_THRESHOLD) return
      d.moved = true
      setIsPanning(true)
      e.currentTarget.setPointerCapture(e.pointerId)
    }
    const stepDx = e.clientX - d.lastX
    const stepDy = e.clientY - d.lastY
    d.lastX = e.clientX
    d.lastY = e.clientY
    e.preventDefault()
    setTransform((prev) => clampTransform({ z: prev.z, tx: prev.tx + stepDx, ty: prev.ty + stepDy }))
  }

  function endDrag(e: React.PointerEvent<HTMLDivElement>) {
    const d = dragRef.current
    if (d && d.pointerId === e.pointerId && d.moved) {
      swallowNextClick()
    }
    dragRef.current = null
    setIsPanning(false)
  }

  function zoomAtCenter(factor: number) {
    setTransform((prev) => {
      const nz = clampZ(prev.z * factor)
      const scale = nz / prev.z
      const qx = paneSize.w / 2 - x0
      const qy = paneSize.h / 2 - y0
      const ntx = qx * (1 - scale) + prev.tx * scale
      const nty = qy * (1 - scale) + prev.ty * scale
      return clampTransform({ z: nz, tx: ntx, ty: nty })
    })
  }

  function resetView() {
    setTransform({ z: 1, tx: 0, ty: 0 })
  }

  return (
    <div
      ref={paneRef}
      className="zoom-pane"
      style={{ cursor: isPanning ? 'grabbing' : undefined }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
    >
      <div
        className="zoom-layer"
        style={{
          width: fitW,
          height: fitH,
          transform: `translate(${transform.tx}px, ${transform.ty}px) scale(${transform.z})`,
          transformOrigin: '0 0',
        }}
      >
        {children}
      </div>
      <div className="zoom-controls">
        <button type="button" className="zoom-btn" onClick={() => zoomAtCenter(1 / ZOOM_STEP)} aria-label="Zoom out">
          &minus;
        </button>
        <button type="button" className="zoom-btn zoom-btn-pct" onClick={resetView}>
          {Math.round(transform.z * 100)}%
        </button>
        <button type="button" className="zoom-btn" onClick={() => zoomAtCenter(ZOOM_STEP)} aria-label="Zoom in">
          +
        </button>
        <button type="button" className="zoom-btn" onClick={resetView}>
          Fit
        </button>
      </div>
    </div>
  )
}
