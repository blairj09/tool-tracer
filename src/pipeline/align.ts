// Pure geometry helpers: bounding box, polygon area, convex hull, and a
// hand-rolled rotating-calipers minimum-area-rectangle used to auto-rotate
// the outline so its long axis is horizontal before export.
import type { Polygon, Pt } from './types'

function cross(o: Pt, a: Pt, b: Pt): number {
  return (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x)
}

/** Andrew's monotone chain convex hull. Input need not be sorted or deduped. */
function convexHull(points: Polygon): Polygon {
  const pts = [...points].sort((a, b) => (a.x === b.x ? a.y - b.y : a.x - b.x))
  if (pts.length <= 2) return pts

  const lower: Pt[] = []
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) {
      lower.pop()
    }
    lower.push(p)
  }

  const upper: Pt[] = []
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i]
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) {
      upper.pop()
    }
    upper.push(p)
  }

  lower.pop()
  upper.pop()
  return lower.concat(upper)
}

interface MinRect {
  angle: number // radians; rotating points by -angle aligns this rect's sides with the axes
  width: number
  height: number
}

/** Rotating calipers minimum-area bounding rectangle of a convex hull. */
function minAreaRect(hull: Polygon): MinRect {
  const n = hull.length
  let best: MinRect = { angle: 0, width: Infinity, height: Infinity }
  let bestArea = Infinity

  for (let i = 0; i < n; i++) {
    const p1 = hull[i]
    const p2 = hull[(i + 1) % n]
    const edgeAngle = Math.atan2(p2.y - p1.y, p2.x - p1.x)
    const cosA = Math.cos(-edgeAngle)
    const sinA = Math.sin(-edgeAngle)

    let minX = Infinity
    let maxX = -Infinity
    let minY = Infinity
    let maxY = -Infinity
    for (const p of hull) {
      const rx = p.x * cosA - p.y * sinA
      const ry = p.x * sinA + p.y * cosA
      if (rx < minX) minX = rx
      if (rx > maxX) maxX = rx
      if (ry < minY) minY = ry
      if (ry > maxY) maxY = ry
    }

    const width = maxX - minX
    const height = maxY - minY
    const area = width * height
    if (area < bestArea) {
      bestArea = area
      best = { angle: edgeAngle, width, height }
    }
  }

  return best
}

function rotatePolygon(poly: Polygon, theta: number): Polygon {
  const c = Math.cos(theta)
  const s = Math.sin(theta)
  return poly.map((p) => ({ x: p.x * c - p.y * s, y: p.x * s + p.y * c }))
}

export function bbox(polys: Polygon[]): { x: number; y: number; w: number; h: number } {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const poly of polys) {
    for (const p of poly) {
      if (p.x < minX) minX = p.x
      if (p.x > maxX) maxX = p.x
      if (p.y < minY) minY = p.y
      if (p.y > maxY) maxY = p.y
    }
  }
  if (!Number.isFinite(minX)) return { x: 0, y: 0, w: 0, h: 0 }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY }
}

export function polygonArea(p: Polygon): number {
  let sum = 0
  const n = p.length
  for (let i = 0; i < n; i++) {
    const a = p[i]
    const b = p[(i + 1) % n]
    sum += a.x * b.y - b.x * a.y
  }
  return Math.abs(sum) / 2
}

/**
 * Rotate all polygons together (by the min-area-rect angle of `polys[0]`,
 * chosen so the long axis ends up horizontal, when `autoAlign` is set) and
 * translate so the combined bounding box's minimum corner lands at
 * `(marginMm, marginMm)`.
 */
export function alignPolygons(polys: Polygon[], opts: { autoAlign: boolean; marginMm: number }): Polygon[] {
  let result = polys.map((poly) => poly.map((p) => ({ ...p })))

  if (opts.autoAlign && result[0] && result[0].length >= 3) {
    const hull = convexHull(result[0])
    if (hull.length >= 2) {
      const rect = minAreaRect(hull)
      let angle = rect.angle
      if (rect.height > rect.width) angle += Math.PI / 2
      result = result.map((poly) => rotatePolygon(poly, -angle))
    }
  }

  const box = bbox(result)
  const dx = opts.marginMm - box.x
  const dy = opts.marginMm - box.y
  result = result.map((poly) => poly.map((p) => ({ x: p.x + dx, y: p.y + dy })))

  return result
}
