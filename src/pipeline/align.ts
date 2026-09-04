// Pure geometry helpers: bounding box, polygon area, convex hull, and a
// hand-rolled rotating-calipers minimum-area-rectangle used to auto-rotate
// the outline so its long axis is horizontal before export. Also the
// polygon transform helpers shared by run.ts (exportTools) and the UI's
// arrange canvas.
import type { Polygon, Pt, Transform } from './types'

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
    const angleDeg = autoAlignAngleDeg(result[0])
    if (angleDeg !== 0) {
      result = result.map((poly) => applyTransform(poly, { dx: 0, dy: 0, angleDeg }, { x: 0, y: 0 }))
    }
  }

  const box = bbox(result)
  const dx = opts.marginMm - box.x
  const dy = opts.marginMm - box.y
  result = result.map((poly) => poly.map((p) => ({ x: p.x + dx, y: p.y + dy })))

  return result
}

/** Fold an angle in degrees into (-90, 90], the domain autoAlignAngleDeg reports in. */
function normalizeAngle90(deg: number): number {
  let d = deg % 180
  if (d <= -90) d += 180
  if (d > 90) d -= 180
  return d
}

/**
 * The rotation (deg) to apply — via {@link applyTransform}, same sign
 * convention — so the polygon's min-area-rectangle long side becomes
 * horizontal. Normalised to (-90, 90]. Returns 0 for degenerate polygons
 * (fewer than 3 points, or a hull too small to have a defined long axis).
 */
export function autoAlignAngleDeg(polygon: Polygon): number {
  if (polygon.length < 3) return 0
  const hull = convexHull(polygon)
  if (hull.length < 2) return 0
  const rect = minAreaRect(hull)
  let angle = rect.angle
  if (rect.height > rect.width) angle += Math.PI / 2
  const deg = (-angle * 180) / Math.PI
  return normalizeAngle90(deg)
}

/**
 * Rotate `pt` about `pivot` by `deg` degrees. Y is down (screen/SVG
 * convention), so a positive angle rotates clockwise on screen.
 */
export function rotateAbout(pt: Pt, pivot: Pt, deg: number): Pt {
  const theta = (deg * Math.PI) / 180
  const c = Math.cos(theta)
  const s = Math.sin(theta)
  const dx = pt.x - pivot.x
  const dy = pt.y - pivot.y
  return {
    x: pivot.x + dx * c - dy * s,
    y: pivot.y + dx * s + dy * c,
  }
}

/**
 * Apply `t` to `polygon`: rotate every vertex by `t.angleDeg` about `pivot`
 * (Y down, positive = clockwise on screen — see {@link rotateAbout}), then
 * translate by `(t.dx, t.dy)`.
 */
export function applyTransform(polygon: Polygon, t: Transform, pivot: Pt): Polygon {
  return polygon.map((p) => {
    const r = rotateAbout(p, pivot, t.angleDeg)
    return { x: r.x + t.dx, y: r.y + t.dy }
  })
}

/**
 * Area centroid of a (possibly non-convex, non-self-intersecting) polygon
 * via the shoelace formula. Falls back to the plain vertex mean for
 * degenerate/collinear input (near-zero signed area).
 */
export function centroid(polygon: Polygon): Pt {
  const n = polygon.length
  if (n === 0) return { x: 0, y: 0 }
  if (n === 1) return { ...polygon[0] }

  let signedArea = 0
  let cx = 0
  let cy = 0
  for (let i = 0; i < n; i++) {
    const a = polygon[i]
    const b = polygon[(i + 1) % n]
    const cross = a.x * b.y - b.x * a.y
    signedArea += cross
    cx += (a.x + b.x) * cross
    cy += (a.y + b.y) * cross
  }
  signedArea /= 2

  if (Math.abs(signedArea) < 1e-9) {
    let sx = 0
    let sy = 0
    for (const p of polygon) {
      sx += p.x
      sy += p.y
    }
    return { x: sx / n, y: sy / n }
  }

  return { x: cx / (6 * signedArea), y: cy / (6 * signedArea) }
}

/**
 * Ray-casting point-in-polygon test (even-odd rule). Used for hit-testing
 * clicks against tool/component outlines.
 */
export function pointInPolygon(pt: Pt, polygon: Polygon): boolean {
  let inside = false
  const n = polygon.length
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = polygon[i].x
    const yi = polygon[i].y
    const xj = polygon[j].x
    const yj = polygon[j].y
    const intersects = yi > pt.y !== yj > pt.y && pt.x < ((xj - xi) * (pt.y - yi)) / (yj - yi) + xi
    if (intersects) inside = !inside
  }
  return inside
}
