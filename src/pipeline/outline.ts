// Threshold/segment the tool(s) from a rectified photo and extract their
// outlines as simplified polygons in millimetres.
import type { Mat } from '@techstark/opencv-js'
import type { CV } from '../cv/loadCv'
import { withMats } from '../cv/mats'
import { markerLayouts, workingArea } from '../template/layout'
import { centroid, pointInPolygon } from './align'
import { makeImageData } from './image'
import type { Blob, DetectionResult, OutlineParams, OutlineResult, PaperSize, Polygon, Pt, Rectified } from './types'

/** Clamp a pixel rect to the bounds of an image; returns null if empty. */
function clampRect(x: number, y: number, w: number, h: number, cols: number, rows: number) {
  const x0 = Math.max(0, x)
  const y0 = Math.max(0, y)
  const x1 = Math.min(cols, x + w)
  const y1 = Math.min(rows, y + h)
  if (x1 <= x0 || y1 <= y0) return null
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 }
}

function maskToWorkingArea(cv: CV, binary: Mat, paper: PaperSize, pxPerMm: number) {
  const area = workingArea(paper)
  const full = new cv.Mat(binary.rows, binary.cols, cv.CV_8UC1, new cv.Scalar(0))
  const rect = clampRect(
    Math.round(area.x * pxPerMm),
    Math.round(area.y * pxPerMm),
    Math.round(area.w * pxPerMm),
    Math.round(area.h * pxPerMm),
    binary.cols,
    binary.rows,
  )
  if (rect) {
    const roi = full.roi(rect)
    roi.setTo(new cv.Scalar(255))
    roi.delete()
  }
  cv.bitwise_and(binary, full, binary)
  full.delete()

  for (const layout of markerLayouts(paper)) {
    const xs = layout.corners.map((c) => c.x)
    const ys = layout.corners.map((c) => c.y)
    const minX = Math.min(...xs) - 2
    const maxX = Math.max(...xs) + 2
    const minY = Math.min(...ys) - 2
    const maxY = Math.max(...ys) + 2
    const markerRect = clampRect(
      Math.round(minX * pxPerMm),
      Math.round(minY * pxPerMm),
      Math.round((maxX - minX) * pxPerMm),
      Math.round((maxY - minY) * pxPerMm),
      binary.cols,
      binary.rows,
    )
    if (markerRect) {
      const roi = binary.roi(markerRect)
      roi.setTo(new cv.Scalar(0))
      roi.delete()
    }
  }
}

function buildMaskImage(binary: Mat): ImageData {
  const w = binary.cols
  const h = binary.rows
  const src = binary.data as Uint8Array
  const out = new Uint8ClampedArray(w * h * 4)
  for (let i = 0; i < w * h; i++) {
    const o = i * 4
    if (src[i]) {
      out[o] = 255
      out[o + 1] = 255
      out[o + 2] = 255
      out[o + 3] = 255
    } else {
      out[o] = 0
      out[o + 1] = 0
      out[o + 2] = 0
      out[o + 3] = 255
    }
  }
  return makeImageData(w, h, out)
}

/**
 * Shared segmentation: grayscale + blur + threshold (fixed or Otsu) +
 * (markers mode only) working-area mask + morphological open/close.
 * Returns the binary Mat (caller owns it — must `.delete()`) and the
 * threshold value used.
 */
function segment(cv: CV, rectified: Rectified, params: OutlineParams): { binary: Mat; thresholdUsed: number } {
  const { image, pxPerMm } = rectified

  return withMats((track) => {
    const rgba = track(cv.matFromImageData(image))
    const gray = track(new cv.Mat())
    cv.cvtColor(rgba, gray, cv.COLOR_RGBA2GRAY)

    let blurred: Mat = gray
    if (params.blurMm > 0) {
      const sigma = params.blurMm * pxPerMm
      blurred = track(new cv.Mat())
      cv.GaussianBlur(gray, blurred, new cv.Size(0, 0), sigma, sigma, cv.BORDER_DEFAULT)
    }

    // Not tracked: ownership transfers to the caller.
    const binary = new cv.Mat()
    const isAuto = params.threshold === 'auto'
    const baseFlag = params.invert ? cv.THRESH_BINARY : cv.THRESH_BINARY_INV
    const flags = baseFlag | (isAuto ? cv.THRESH_OTSU : 0)
    const threshVal = isAuto ? 0 : (params.threshold as number)
    const thresholdUsed = cv.threshold(blurred, binary, threshVal, 255, flags)

    if (rectified.mode === 'markers') {
      maskToWorkingArea(cv, binary, rectified.paper, pxPerMm)
    }

    const openPx = Math.round(params.openMm * pxPerMm)
    if (openPx >= 1) {
      const kernel = track(cv.getStructuringElement(cv.MORPH_ELLIPSE, new cv.Size(openPx, openPx)))
      cv.morphologyEx(binary, binary, cv.MORPH_OPEN, kernel)
    }
    const closePx = Math.round(params.closeMm * pxPerMm)
    if (closePx >= 1) {
      const kernel = track(cv.getStructuringElement(cv.MORPH_ELLIPSE, new cv.Size(closePx, closePx)))
      cv.morphologyEx(binary, binary, cv.MORPH_CLOSE, kernel)
    }

    return { binary, thresholdUsed }
  })
}

/**
 * List every top-level (parent === -1) contour at or above
 * `max(5, minAreaMm2 / 10)` mm², sorted by area descending. `params.pick`
 * is ignored here (selection happens in {@link extractOutline}).
 */
export function detectBlobs(cv: CV, rectified: Rectified, params: OutlineParams): DetectionResult {
  const { pxPerMm } = rectified
  const { binary, thresholdUsed } = segment(cv, rectified, params)

  return withMats((track) => {
    track(binary)

    const contourInput = track(binary.clone())
    const contours = track(new cv.MatVector())
    const hierarchy = track(new cv.Mat())
    // RETR_CCOMP (not RETR_EXTERNAL): in manual mode the background can be
    // darker than the paper, which makes the tool an "island" nested two
    // levels deep (background -> paper hole -> tool). RETR_EXTERNAL only
    // ever returns the outermost contour (the background) and would never
    // surface the tool at all. Under CCOMP, any contour nested inside a
    // hole is reported back at the top level (parent -1), alongside true
    // top-level contours and unlike hole boundaries (parent >= 0) — so we
    // filter to parent === -1 below to keep tool/background shapes and drop
    // hole outlines (e.g. the paper's own boundary).
    cv.findContours(contourInput, contours, hierarchy, cv.RETR_CCOMP, cv.CHAIN_APPROX_NONE)

    const minAreaMm2 = Math.max(5, params.minAreaMm2 / 10)
    const minAreaPx = minAreaMm2 * pxPerMm * pxPerMm

    const blobs: Blob[] = []
    for (let i = 0; i < contours.size(); i++) {
      const c = contours.get(i)
      const isHole = hierarchy.data32S[i * 4 + 3] !== -1
      if (!isHole && cv.contourArea(c) >= minAreaPx) {
        const approx = track(new cv.Mat())
        cv.approxPolyDP(c, approx, params.simplifyMm * pxPerMm, true)
        const areaMm2 = cv.contourArea(approx) / (pxPerMm * pxPerMm)

        const polygon: Polygon = []
        for (let r = 0; r < approx.rows; r++) {
          polygon.push({
            x: approx.data32S[r * 2] / pxPerMm,
            y: approx.data32S[r * 2 + 1] / pxPerMm,
          })
        }

        const xs = polygon.map((p) => p.x)
        const ys = polygon.map((p) => p.y)
        const bboxOut = {
          x: Math.min(...xs),
          y: Math.min(...ys),
          w: Math.max(...xs) - Math.min(...xs),
          h: Math.max(...ys) - Math.min(...ys),
        }

        blobs.push({ polygon, bbox: bboxOut, areaMm2, centroid: centroid(polygon) })
      }
      c.delete()
    }

    blobs.sort((a, b) => b.areaMm2 - a.areaMm2)

    const mask = buildMaskImage(binary)

    return { blobs, thresholdUsed, mask }
  })
}

function pointToSegmentDist(p: Pt, a: Pt, b: Pt): number {
  const abx = b.x - a.x
  const aby = b.y - a.y
  const apx = p.x - a.x
  const apy = p.y - a.y
  const lenSq = abx * abx + aby * aby
  let t = lenSq > 0 ? (apx * abx + apy * aby) / lenSq : 0
  t = Math.max(0, Math.min(1, t))
  const cx = a.x + t * abx
  const cy = a.y + t * aby
  return Math.hypot(p.x - cx, p.y - cy)
}

/** Distance (mm) from `pt` to the nearest edge of `polygon`. */
function distanceToPolygonBoundary(pt: Pt, polygon: Polygon): number {
  let best = Infinity
  const n = polygon.length
  for (let i = 0; i < n; i++) {
    const d = pointToSegmentDist(pt, polygon[i], polygon[(i + 1) % n])
    if (d < best) best = d
  }
  return best
}

/**
 * v1 wrapper over {@link detectBlobs}: selects a single blob — the one
 * containing/nearest `params.pick` if set, else the largest (in manual
 * mode, preferring interior blobs over ones touching the image border).
 */
export function extractOutline(cv: CV, rectified: Rectified, params: OutlineParams): OutlineResult {
  const detection = detectBlobs(cv, rectified, params)
  const candidates = detection.blobs.filter((b) => b.areaMm2 >= params.minAreaMm2)

  if (candidates.length === 0) {
    throw new Error('No tool outline found — try adjusting the threshold')
  }

  let chosen: Blob
  if (params.pick) {
    const pt = params.pick
    let containing: Blob | null = null
    let nearest: Blob = candidates[0]
    let nearestDist = Infinity
    for (const b of candidates) {
      if (containing === null && pointInPolygon(pt, b.polygon)) containing = b
      const d = distanceToPolygonBoundary(pt, b.polygon)
      if (d < nearestDist) {
        nearestDist = d
        nearest = b
      }
    }
    chosen = containing ?? nearest
  } else {
    let pool = candidates
    if (rectified.mode === 'manual') {
      // No perspective mask is applied in manual mode, so on photos whose
      // background is darker than the paper, the largest contour can be
      // the background region touching the image border. Prefer interior
      // contours; fall back to the full set if none qualify.
      const canvasWMm = rectified.image.width / rectified.pxPerMm
      const canvasHMm = rectified.image.height / rectified.pxPerMm
      const eps = 1e-6
      const interior = candidates.filter((b) => {
        const touchesBorder =
          b.bbox.x <= eps || b.bbox.y <= eps || b.bbox.x + b.bbox.w >= canvasWMm - eps || b.bbox.y + b.bbox.h >= canvasHMm - eps
        return !touchesBorder
      })
      if (interior.length > 0) pool = interior
    }
    chosen = pool.reduce((best, b) => (b.areaMm2 > best.areaMm2 ? b : best))
  }

  return {
    polygon: chosen.polygon,
    bbox: chosen.bbox,
    areaMm2: chosen.areaMm2,
    thresholdUsed: detection.thresholdUsed,
    mask: detection.mask,
  }
}
