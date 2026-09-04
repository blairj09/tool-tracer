// Threshold/segment the tool from a rectified photo and extract its outline
// as a simplified polygon in millimetres.
import type { Mat } from '@techstark/opencv-js'
import type { CV } from '../cv/loadCv'
import { withMats } from '../cv/mats'
import { markerLayouts, workingArea } from '../template/layout'
import { makeImageData } from './image'
import type { OutlineParams, OutlineResult, PaperSize, Polygon, Rectified } from './types'

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

export function extractOutline(cv: CV, rectified: Rectified, params: OutlineParams): OutlineResult {
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

    const binary = track(new cv.Mat())
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

    const contourInput = track(binary.clone())
    const contours = track(new cv.MatVector())
    const hierarchy = track(new cv.Mat())
    cv.findContours(contourInput, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_NONE)

    const minAreaPx = params.minAreaMm2 * pxPerMm * pxPerMm
    const candidates: Mat[] = []
    for (let i = 0; i < contours.size(); i++) {
      const c = contours.get(i)
      if (cv.contourArea(c) >= minAreaPx) {
        candidates.push(c)
      } else {
        c.delete()
      }
    }

    if (candidates.length === 0) {
      throw new Error('No tool outline found — try adjusting the threshold')
    }

    let chosen: Mat
    if (params.pick) {
      const pt = new cv.Point(params.pick.x * pxPerMm, params.pick.y * pxPerMm)
      let containing: Mat | null = null
      let nearest: Mat = candidates[0]
      let nearestDist = Infinity
      for (const c of candidates) {
        const d = cv.pointPolygonTest(c, pt, true)
        if (d >= 0 && containing === null) containing = c
        if (Math.abs(d) < nearestDist) {
          nearestDist = Math.abs(d)
          nearest = c
        }
      }
      chosen = containing ?? nearest
    } else {
      chosen = candidates.reduce((best, c) => (cv.contourArea(c) > cv.contourArea(best) ? c : best))
    }

    const approx = track(new cv.Mat())
    cv.approxPolyDP(chosen, approx, params.simplifyMm * pxPerMm, true)

    const areaMm2 = cv.contourArea(approx) / (pxPerMm * pxPerMm)

    candidates.forEach((c) => c.delete())

    const polygon: Polygon = []
    for (let i = 0; i < approx.rows; i++) {
      polygon.push({
        x: approx.data32S[i * 2] / pxPerMm,
        y: approx.data32S[i * 2 + 1] / pxPerMm,
      })
    }

    const xs = polygon.map((p) => p.x)
    const ys = polygon.map((p) => p.y)
    const bbox = {
      x: Math.min(...xs),
      y: Math.min(...ys),
      w: Math.max(...xs) - Math.min(...xs),
      h: Math.max(...ys) - Math.min(...ys),
    }

    const mask = buildMaskImage(binary)

    return { polygon, bbox, areaMm2, thresholdUsed, mask }
  })
}
