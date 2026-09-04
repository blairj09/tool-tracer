// Geometry for the printable ArUco marker template.
// All units are millimetres. Pure functions, no OpenCV dependency, so this
// module can be shared between the template renderer and the detection /
// rectification pipeline (both must agree on where the markers are).

export type PaperSize = 'letter' | 'a4'

export const PAPER: Record<PaperSize, { w: number; h: number }> = {
  letter: { w: 215.9, h: 279.4 },
  a4: { w: 210, h: 297 },
}

export const MARKER_SIZE_MM = 20
// Distance from each paper edge to the marker's OUTER corner.
export const MARKER_INSET_MM = 12.7
export const MARKER_IDS = [0, 1, 2, 3] as const // TL, TR, BR, BL

export interface Pt {
  x: number
  y: number
}

export interface MarkerLayout {
  id: number
  /** Corners of the marker itself, in mm, paper origin top-left, y down. Order: TL, TR, BR, BL. */
  corners: [Pt, Pt, Pt, Pt]
}

/**
 * Compute the four marker layouts (ids 0..3, TL/TR/BR/BL) for a given paper
 * size. `scale` multiplies every mm coordinate and is used to compensate for
 * printer scaling error (see src/template/calibration.ts).
 */
export function markerLayouts(paper: PaperSize, scale = 1): MarkerLayout[] {
  const { w, h } = PAPER[paper]
  const inset = MARKER_INSET_MM
  const size = MARKER_SIZE_MM

  // Outer corner (the paper-edge-facing corner) of each marker, before scale.
  const outerCorners: Record<number, Pt> = {
    0: { x: inset, y: inset }, // TL marker: outer corner is its own top-left
    1: { x: w - inset, y: inset }, // TR marker: outer corner is its own top-right
    2: { x: w - inset, y: h - inset }, // BR marker: outer corner is its own bottom-right
    3: { x: inset, y: h - inset }, // BL marker: outer corner is its own bottom-left
  }

  const layouts: MarkerLayout[] = MARKER_IDS.map((id) => {
    const outer = outerCorners[id]
    let tl: Pt
    switch (id) {
      case 0: // TL marker: outer corner is TL of marker itself
        tl = { x: outer.x, y: outer.y }
        break
      case 1: // TR marker: outer corner is TR of marker itself
        tl = { x: outer.x - size, y: outer.y }
        break
      case 2: // BR marker: outer corner is BR of marker itself
        tl = { x: outer.x - size, y: outer.y - size }
        break
      case 3: // BL marker: outer corner is BL of marker itself
        tl = { x: outer.x, y: outer.y - size }
        break
      default:
        throw new Error(`unknown marker id ${id}`)
    }
    const corners: [Pt, Pt, Pt, Pt] = [
      { x: tl.x, y: tl.y }, // TL
      { x: tl.x + size, y: tl.y }, // TR
      { x: tl.x + size, y: tl.y + size }, // BR
      { x: tl.x, y: tl.y + size }, // BL
    ]
    return { id, corners: corners.map((p) => ({ x: p.x * scale, y: p.y * scale })) as [Pt, Pt, Pt, Pt] }
  })

  return layouts
}

/** Rectangle strictly inside the four markers (between their inner edges), in mm. */
export function workingArea(paper: PaperSize, scale = 1): { x: number; y: number; w: number; h: number } {
  const { w, h } = PAPER[paper]
  const inset = MARKER_INSET_MM
  const size = MARKER_SIZE_MM
  const x = inset + size
  const y = inset + size
  return {
    x: x * scale,
    y: y * scale,
    w: (w - 2 * (inset + size)) * scale,
    h: (h - 2 * (inset + size)) * scale,
  }
}
