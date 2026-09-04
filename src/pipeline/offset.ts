// Grows or shrinks a polygon by a uniform distance (used for the clearance
// layer) via rasterize -> morphological dilate/erode -> re-vectorize, since
// exact polygon offsetting is fiddly and this raster approach is robust to
// self-intersections / concave shapes.
import type { CV } from '../cv/loadCv'
import { withMats } from '../cv/mats'
import { PX_PER_MM } from './types'
import type { Polygon } from './types'

export function offsetPolygon(cv: CV, polygon: Polygon, offsetMm: number, pxPerMm = PX_PER_MM): Polygon {
  if (offsetMm === 0) return polygon.map((p) => ({ ...p }))
  if (polygon.length < 3) return polygon.map((p) => ({ ...p }))

  const xs = polygon.map((p) => p.x)
  const ys = polygon.map((p) => p.y)
  const minX = Math.min(...xs)
  const minY = Math.min(...ys)
  const maxX = Math.max(...xs)
  const maxY = Math.max(...ys)

  const pad = Math.abs(offsetMm) + 2
  const originX = minX - pad
  const originY = minY - pad
  const width = Math.max(1, Math.round((maxX - minX + 2 * pad) * pxPerMm))
  const height = Math.max(1, Math.round((maxY - minY + 2 * pad) * pxPerMm))

  return withMats((track) => {
    const canvas = track(new cv.Mat(height, width, cv.CV_8UC1, new cv.Scalar(0)))

    const ptsFlat: number[] = []
    for (const p of polygon) {
      ptsFlat.push(Math.round((p.x - originX) * pxPerMm), Math.round((p.y - originY) * pxPerMm))
    }
    const ptsMat = track(cv.matFromArray(polygon.length, 1, cv.CV_32SC2, ptsFlat))
    const mv = track(new cv.MatVector())
    mv.push_back(ptsMat)
    cv.fillPoly(canvas, mv, new cv.Scalar(255))

    const diameter = 2 * Math.round(Math.abs(offsetMm) * pxPerMm) + 1
    const kernel = track(cv.getStructuringElement(cv.MORPH_ELLIPSE, new cv.Size(diameter, diameter)))
    if (offsetMm > 0) {
      cv.dilate(canvas, canvas, kernel)
    } else {
      cv.erode(canvas, canvas, kernel)
    }

    const contours = track(new cv.MatVector())
    const hierarchy = track(new cv.Mat())
    cv.findContours(canvas, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_NONE)

    if (contours.size() === 0) {
      throw new Error('Offset produced an empty polygon')
    }

    let largestIdx = 0
    let largestArea = -Infinity
    for (let i = 0; i < contours.size(); i++) {
      const c = contours.get(i)
      const a = cv.contourArea(c)
      if (a > largestArea) {
        largestArea = a
        largestIdx = i
      }
      c.delete()
    }
    const chosen = track(contours.get(largestIdx))

    const approx = track(new cv.Mat())
    cv.approxPolyDP(chosen, approx, 0.1 * pxPerMm, true)

    const result: Polygon = []
    for (let i = 0; i < approx.rows; i++) {
      result.push({
        x: approx.data32S[i * 2] / pxPerMm + originX,
        y: approx.data32S[i * 2 + 1] / pxPerMm + originY,
      })
    }
    return result
  })
}
