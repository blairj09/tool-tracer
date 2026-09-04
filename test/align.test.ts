import { describe, expect, it } from 'vitest'
import { alignPolygons, applyTransform, autoAlignAngleDeg, bbox, centroid, pointInPolygon, polygonArea, rotateAbout } from '../src/pipeline/align'
import type { Polygon, Pt } from '../src/pipeline/types'

function rotatedRect(cx: number, cy: number, w: number, h: number, angleDeg: number): Polygon {
  const theta = (angleDeg * Math.PI) / 180
  const c = Math.cos(theta)
  const s = Math.sin(theta)
  const half: Pt[] = [
    { x: -w / 2, y: -h / 2 },
    { x: w / 2, y: -h / 2 },
    { x: w / 2, y: h / 2 },
    { x: -w / 2, y: h / 2 },
  ]
  return half.map((p) => ({ x: cx + p.x * c - p.y * s, y: cy + p.x * s + p.y * c }))
}

/** Smallest angle (deg, in [0, 90)) between any polygon edge and the x-axis. */
function edgeAngleFromHorizontal(poly: Polygon): number {
  let best = 90
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]
    const b = poly[(i + 1) % poly.length]
    const deg = (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI
    // fold into [0, 90)
    let folded = ((deg % 90) + 90) % 90
    if (folded > 45) folded = 90 - folded
    if (folded < best) best = folded
  }
  return best
}

describe('bbox', () => {
  it('computes the combined bounding box of multiple polygons', () => {
    const a: Polygon = [
      { x: 0, y: 0 },
      { x: 5, y: 0 },
      { x: 5, y: 5 },
    ]
    const b: Polygon = [
      { x: -3, y: 2 },
      { x: 10, y: 2 },
      { x: 10, y: 8 },
    ]
    expect(bbox([a, b])).toEqual({ x: -3, y: 0, w: 13, h: 8 })
  })

  it('returns a zero box for no polygons', () => {
    expect(bbox([])).toEqual({ x: 0, y: 0, w: 0, h: 0 })
  })
})

describe('polygonArea', () => {
  it('computes the area of a simple square regardless of winding', () => {
    const cw: Polygon = [
      { x: 0, y: 0 },
      { x: 0, y: 10 },
      { x: 10, y: 10 },
      { x: 10, y: 0 },
    ]
    const ccw: Polygon = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
      { x: 0, y: 10 },
    ]
    expect(polygonArea(cw)).toBeCloseTo(100, 6)
    expect(polygonArea(ccw)).toBeCloseTo(100, 6)
  })
})

describe('alignPolygons', () => {
  it('rotates a tilted rectangle so its long side is horizontal, within 0.01 degrees', () => {
    const poly = rotatedRect(50, 50, 80, 30, 25)
    const [aligned] = alignPolygons([poly], { autoAlign: true, marginMm: 0 })
    expect(edgeAngleFromHorizontal(aligned)).toBeLessThan(0.01)

    const box = bbox([aligned])
    // long side (80) should end up as width, short side (30) as height
    expect(box.w).toBeGreaterThan(box.h)
    expect(box.w).toBeCloseTo(80, 3)
    expect(box.h).toBeCloseTo(30, 3)
  })

  it('leaves polygons unrotated when autoAlign is false', () => {
    const poly = rotatedRect(50, 50, 80, 30, 25)
    const [aligned] = alignPolygons([poly], { autoAlign: false, marginMm: 0 })
    expect(edgeAngleFromHorizontal(aligned)).toBeCloseTo(25, 3)
  })

  it('rotates every polygon passed in by the same angle', () => {
    const outline = rotatedRect(50, 50, 80, 30, 25)
    const clearance = rotatedRect(50, 50, 84, 34, 25)
    const [alignedOutline, alignedClearance] = alignPolygons([outline, clearance], { autoAlign: true, marginMm: 0 })
    expect(edgeAngleFromHorizontal(alignedOutline)).toBeLessThan(0.01)
    expect(edgeAngleFromHorizontal(alignedClearance)).toBeLessThan(0.01)
  })

  it('translates so the combined bbox minimum sits at (marginMm, marginMm)', () => {
    const poly = rotatedRect(50, 50, 80, 30, 25)
    const [aligned] = alignPolygons([poly], { autoAlign: true, marginMm: 5 })
    const box = bbox([aligned])
    expect(box.x).toBeCloseTo(5, 6)
    expect(box.y).toBeCloseTo(5, 6)
  })

  it('preserves polygon area under rotation and translation', () => {
    const poly = rotatedRect(50, 50, 80, 30, 25)
    const [aligned] = alignPolygons([poly], { autoAlign: true, marginMm: 5 })
    expect(polygonArea(aligned)).toBeCloseTo(80 * 30, 3)
  })
})

describe('applyTransform', () => {
  it('round-trips: rotate +theta then -theta about the same pivot returns the input', () => {
    const poly = rotatedRect(50, 50, 80, 30, 25)
    const pivot = { x: 12, y: -7 }
    const rotated = applyTransform(poly, { dx: 0, dy: 0, angleDeg: 37 }, pivot)
    const back = applyTransform(rotated, { dx: 0, dy: 0, angleDeg: -37 }, pivot)
    for (let i = 0; i < poly.length; i++) {
      expect(back[i].x).toBeCloseTo(poly[i].x, 9)
      expect(back[i].y).toBeCloseTo(poly[i].y, 9)
    }
  })

  it('translates by (dx, dy) after rotating', () => {
    const poly: Polygon = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
      { x: 0, y: 10 },
    ]
    const result = applyTransform(poly, { dx: 5, dy: -3, angleDeg: 0 }, { x: 0, y: 0 })
    expect(result).toEqual([
      { x: 5, y: -3 },
      { x: 15, y: -3 },
      { x: 15, y: 7 },
      { x: 5, y: 7 },
    ])
  })

  it('rotating a point 90 degrees clockwise on screen (y down) about the origin', () => {
    // (1, 0) rotated +90deg about the origin should land at (0, 1) since
    // positive angle is clockwise on screen with y pointing down.
    const p = rotateAbout({ x: 1, y: 0 }, { x: 0, y: 0 }, 90)
    expect(p.x).toBeCloseTo(0, 9)
    expect(p.y).toBeCloseTo(1, 9)
  })
})

describe('autoAlignAngleDeg', () => {
  it('returns approximately -17deg for a rectangle rotated 17deg', () => {
    const poly = rotatedRect(50, 50, 80, 30, 17)
    const angle = autoAlignAngleDeg(poly)
    // Normalised to (-90, 90], so compare mod 180.
    const folded = ((angle + 90) % 180 + 180) % 180 - 90
    expect(folded).toBeCloseTo(-17, 1)
  })

  it('is in (-90, 90]', () => {
    for (const deg of [5, 45, 89, 91, 135, 179, -5, -91, -135]) {
      const poly = rotatedRect(0, 0, 80, 30, deg)
      const angle = autoAlignAngleDeg(poly)
      expect(angle).toBeGreaterThan(-90)
      expect(angle).toBeLessThanOrEqual(90)
    }
  })

  it('applying the angle makes the long side horizontal', () => {
    const poly = rotatedRect(20, 20, 80, 30, 63)
    const angle = autoAlignAngleDeg(poly)
    const aligned = applyTransform(poly, { dx: 0, dy: 0, angleDeg: angle }, { x: 20, y: 20 })
    const box = bbox([aligned])
    expect(box.w).toBeGreaterThan(box.h)
    expect(box.w).toBeCloseTo(80, 2)
    expect(box.h).toBeCloseTo(30, 2)
  })
})

describe('centroid', () => {
  it('is the centre of a square', () => {
    const square: Polygon = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
      { x: 0, y: 10 },
    ]
    const c = centroid(square)
    expect(c.x).toBeCloseTo(5, 9)
    expect(c.y).toBeCloseTo(5, 9)
  })

  it('moves by exactly the applied translation', () => {
    const poly = rotatedRect(50, 50, 80, 30, 40)
    const c0 = centroid(poly)
    const moved = applyTransform(poly, { dx: 12, dy: -4, angleDeg: 0 }, c0)
    const c1 = centroid(moved)
    expect(c1.x - c0.x).toBeCloseTo(12, 9)
    expect(c1.y - c0.y).toBeCloseTo(-4, 9)
  })
})

describe('pointInPolygon', () => {
  const square: Polygon = [
    { x: 0, y: 0 },
    { x: 10, y: 0 },
    { x: 10, y: 10 },
    { x: 0, y: 10 },
  ]

  it('is true for a point inside', () => {
    expect(pointInPolygon({ x: 5, y: 5 }, square)).toBe(true)
  })

  it('is false for a point outside', () => {
    expect(pointInPolygon({ x: 15, y: 5 }, square)).toBe(false)
  })
})
