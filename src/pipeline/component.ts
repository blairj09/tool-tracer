// Extract a sub-region (component) inside an already-traced tool outline,
// e.g. a knife's pocket clip: auto-threshold from a clicked seed point,
// restricted to the tool's own mask so the surrounding paper/background
// never leaks in.
import type { Mat } from '@techstark/opencv-js'
import type { CV } from '../cv/loadCv'
import { withMats } from '../cv/mats'
import type { ComponentParams, Polygon, Pt, Rectified } from './types'

export function extractComponent(cv: CV, rectified: Rectified, parent: Polygon, seed: Pt, params: ComponentParams): Polygon {
  const { image, pxPerMm } = rectified

  return withMats((track) => {
    const rgba = track(cv.matFromImageData(image))
    const gray = track(new cv.Mat())
    cv.cvtColor(rgba, gray, cv.COLOR_RGBA2GRAY)

    // Mask = the tool's own outline, eroded by 0.6mm so the tool's own
    // edge (paper/background contrast) never gets picked up as part of a
    // component.
    const mask = track(new cv.Mat(gray.rows, gray.cols, cv.CV_8UC1, new cv.Scalar(0)))
    const ptsFlat: number[] = []
    for (const p of parent) {
      ptsFlat.push(Math.round(p.x * pxPerMm), Math.round(p.y * pxPerMm))
    }
    const ptsMat = track(cv.matFromArray(parent.length, 1, cv.CV_32SC2, ptsFlat))
    const mv = track(new cv.MatVector())
    mv.push_back(ptsMat)
    cv.fillPoly(mask, mv, new cv.Scalar(255))

    const erodeMm = 0.6
    const erodeDiameter = 2 * Math.round(erodeMm * pxPerMm) + 1
    const erodeKernel = track(cv.getStructuringElement(cv.MORPH_ELLIPSE, new cv.Size(erodeDiameter, erodeDiameter)))
    cv.erode(mask, mask, erodeKernel)

    // Small fixed blur (0.2mm) to smooth sensor noise before thresholding.
    const blurred = track(new cv.Mat())
    const blurSigma = 0.2 * pxPerMm
    cv.GaussianBlur(gray, blurred, new cv.Size(0, 0), blurSigma, blurSigma, cv.BORDER_DEFAULT)

    // The invert-aware BINARY flag applied to the full image.
    const baseFlag = params.invert ? cv.THRESH_BINARY : cv.THRESH_BINARY_INV

    let thresholdValue: number
    if (params.threshold === 'auto') {
      // Otsu computed only over pixels inside the mask: gather them into a
      // 1xN row Mat and run threshold(...THRESH_OTSU) on that to read the
      // value (the flag passed here doesn't affect the value returned).
      const maskData = mask.data as Uint8Array
      const grayData = blurred.data as Uint8Array
      const n = maskData.length
      let count = 0
      for (let i = 0; i < n; i++) if (maskData[i]) count++

      if (count === 0) {
        throw new Error('No region found at that point — adjust the component threshold or draw it instead')
      }

      const maskedPixels = new Uint8Array(count)
      let w = 0
      for (let i = 0; i < n; i++) {
        if (maskData[i]) maskedPixels[w++] = grayData[i]
      }
      const rowMat = track(cv.matFromArray(1, count, cv.CV_8UC1, Array.from(maskedPixels)))
      const otsuOut = track(new cv.Mat())
      thresholdValue = cv.threshold(rowMat, otsuOut, 0, 255, cv.THRESH_BINARY | cv.THRESH_OTSU)
    } else {
      thresholdValue = params.threshold
    }

    const binary = track(new cv.Mat())
    cv.threshold(blurred, binary, thresholdValue, 255, baseFlag)
    cv.bitwise_and(binary, mask, binary)

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

    const contours = track(new cv.MatVector())
    const hierarchy = track(new cv.Mat())
    cv.findContours(binary, contours, hierarchy, cv.RETR_CCOMP, cv.CHAIN_APPROX_NONE)

    const seedPx = new cv.Point(seed.x * pxPerMm, seed.y * pxPerMm)
    const candidates: Mat[] = []
    for (let i = 0; i < contours.size(); i++) {
      const c = contours.get(i)
      const isHole = hierarchy.data32S[i * 4 + 3] !== -1
      if (!isHole) {
        candidates.push(c)
      } else {
        c.delete()
      }
    }

    if (candidates.length === 0) {
      throw new Error('No region found at that point — adjust the component threshold or draw it instead')
    }

    let chosen: Mat | null = null
    let nearest: Mat = candidates[0]
    let nearestDist = Infinity
    for (const c of candidates) {
      const d = cv.pointPolygonTest(c, seedPx, true)
      if (d >= 0 && chosen === null) chosen = c
      if (Math.abs(d) < nearestDist) {
        nearestDist = Math.abs(d)
        nearest = c
      }
    }
    const selected = chosen ?? nearest

    const approx = track(new cv.Mat())
    cv.approxPolyDP(selected, approx, params.simplifyMm * pxPerMm, true)

    candidates.forEach((c) => c.delete())

    const polygon: Polygon = []
    for (let i = 0; i < approx.rows; i++) {
      polygon.push({
        x: approx.data32S[i * 2] / pxPerMm,
        y: approx.data32S[i * 2 + 1] / pxPerMm,
      })
    }

    if (polygon.length < 3) {
      throw new Error('No region found at that point — adjust the component threshold or draw it instead')
    }

    return polygon
  })
}
