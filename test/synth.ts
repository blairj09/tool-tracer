// Synthesizes a photographed template page entirely in-memory with OpenCV
// drawing primitives (no real camera/photo needed). Shared by the e2e test
// and scripts/synthetic-photo.ts.
import type { CV } from '../src/cv/loadCv'
import { makeImageData } from '../src/pipeline/image'
import { markerLayouts, PAPER, workingArea } from '../src/template/layout'
import type { Pt } from '../src/template/layout'

export const PAPER_SIZE = 'letter' as const
export const SYNTH_PX_PER_MM = 6 // resolution of the synthetic "printed page" before photographing
export const RECT_W_MM = 80
export const RECT_H_MM = 30
export const RECT_ANGLE_DEG = 17
export const CIRCLE_DIAMETER_MM = 12

// A grey bar drawn axis-aligned (not rotated with the rectangle) inside the
// dark rectangle, used to exercise `extractComponent`. Intensity ~110 vs the
// rectangle's ~20, so it's lighter than its surroundings.
export const BAR_W_MM = 20
export const BAR_H_MM = 8
export const BAR_INTENSITY = 110

export interface SyntheticPhoto {
  imageData: ImageData
  /** Centre of the grey bar (mm, page/working-area frame), when drawn. */
  barCenterMm?: Pt
}

export interface BuildSyntheticPhotoOptions {
  /** Draw the grey bar inside the rectangle. Default true. */
  bar?: boolean
}

export function buildSyntheticPhoto(cv: CV, opts: BuildSyntheticPhotoOptions = {}): SyntheticPhoto {
  const withBar = opts.bar ?? true
  const pageW = Math.round(PAPER[PAPER_SIZE].w * SYNTH_PX_PER_MM)
  const pageH = Math.round(PAPER[PAPER_SIZE].h * SYNTH_PX_PER_MM)

  const page = new cv.Mat(pageH, pageW, cv.CV_8UC1, new cv.Scalar(255))

  // Render the four ArUco markers at their template positions.
  const dict = cv.getPredefinedDictionary(cv.DICT_4X4_50)
  for (const layout of markerLayouts(PAPER_SIZE)) {
    const markerPx = Math.round(20 * SYNTH_PX_PER_MM) // MARKER_SIZE_MM
    const markerMat = new cv.Mat()
    dict.generateImageMarker(layout.id, markerPx, markerMat, 1)
    const tl = layout.corners[0]
    const roi = page.roi(
      new cv.Rect(Math.round(tl.x * SYNTH_PX_PER_MM), Math.round(tl.y * SYNTH_PX_PER_MM), markerPx, markerPx),
    )
    markerMat.copyTo(roi)
    roi.delete()
    markerMat.delete()
  }

  const area = workingArea(PAPER_SIZE)

  // A filled, rotated dark rectangle: exactly 80.0 x 30.0 mm, rotated 17deg.
  const rectCenter = { x: area.x + area.w / 2, y: area.y + area.h * 0.32 }
  const theta = (RECT_ANGLE_DEG * Math.PI) / 180
  const cosT = Math.cos(theta)
  const sinT = Math.sin(theta)
  const localCorners = [
    { x: -RECT_W_MM / 2, y: -RECT_H_MM / 2 },
    { x: RECT_W_MM / 2, y: -RECT_H_MM / 2 },
    { x: RECT_W_MM / 2, y: RECT_H_MM / 2 },
    { x: -RECT_W_MM / 2, y: RECT_H_MM / 2 },
  ]
  const rectPxFlat: number[] = []
  for (const p of localCorners) {
    const mx = rectCenter.x + p.x * cosT - p.y * sinT
    const my = rectCenter.y + p.x * sinT + p.y * cosT
    rectPxFlat.push(Math.round(mx * SYNTH_PX_PER_MM), Math.round(my * SYNTH_PX_PER_MM))
  }
  const rectPts = cv.matFromArray(4, 1, cv.CV_32SC2, rectPxFlat)
  const rectMv = new cv.MatVector()
  rectMv.push_back(rectPts)
  cv.fillPoly(page, rectMv, new cv.Scalar(20))
  rectPts.delete()
  rectMv.delete()

  // A grey bar, axis-aligned (not rotated with the rectangle), centred
  // inside it: exactly 20.0 x 8.0 mm, intensity ~110 (lighter than the
  // rectangle's ~20). Drawn after the rectangle so it overwrites part of it.
  let barCenterMm: Pt | undefined
  if (withBar) {
    barCenterMm = { x: rectCenter.x, y: rectCenter.y }
    const barRect = new cv.Rect(
      Math.round((barCenterMm.x - BAR_W_MM / 2) * SYNTH_PX_PER_MM),
      Math.round((barCenterMm.y - BAR_H_MM / 2) * SYNTH_PX_PER_MM),
      Math.round(BAR_W_MM * SYNTH_PX_PER_MM),
      Math.round(BAR_H_MM * SYNTH_PX_PER_MM),
    )
    const barRoi = page.roi(barRect)
    barRoi.setTo(new cv.Scalar(BAR_INTENSITY))
    barRoi.delete()
  }

  // A small dark circle elsewhere in the working area: 12.0 mm diameter.
  const circleCenterMm = { x: area.x + area.w * 0.25, y: area.y + area.h * 0.75 }
  const circleRadiusPx = Math.round((CIRCLE_DIAMETER_MM / 2) * SYNTH_PX_PER_MM)
  cv.circle(
    page,
    new cv.Point(Math.round(circleCenterMm.x * SYNTH_PX_PER_MM), Math.round(circleCenterMm.y * SYNTH_PX_PER_MM)),
    circleRadiusPx,
    new cv.Scalar(20),
    -1,
  )

  const pageRgba = new cv.Mat()
  cv.cvtColor(page, pageRgba, cv.COLOR_GRAY2RGBA)
  page.delete()

  // Synthetic perspective: warp the page into a larger canvas via a
  // moderately skewed quad (corners displaced up to ~6% of the canvas size)
  // on a mid-grey background, plus a touch of blur to mimic a real photo.
  const canvasW = 1800
  const canvasH = 2200
  const srcQuad = cv.matFromArray(4, 1, cv.CV_32FC2, [0, 0, pageW, 0, pageW, pageH, 0, pageH])
  const marginX = canvasW * 0.08
  const marginY = canvasH * 0.08
  const dstQuad = cv.matFromArray(4, 1, cv.CV_32FC2, [
    marginX + 0.02 * canvasW,
    marginY - 0.03 * canvasH,
    canvasW - marginX - 0.03 * canvasW,
    marginY + 0.02 * canvasH,
    canvasW - marginX + 0.01 * canvasW,
    canvasH - marginY - 0.02 * canvasH,
    marginX - 0.02 * canvasW,
    canvasH - marginY + 0.03 * canvasH,
  ])
  const Hsynth = cv.getPerspectiveTransform(srcQuad, dstQuad)

  const canvas = new cv.Mat()
  cv.warpPerspective(
    pageRgba,
    canvas,
    Hsynth,
    new cv.Size(canvasW, canvasH),
    cv.INTER_LINEAR,
    cv.BORDER_CONSTANT,
    new cv.Scalar(128, 128, 128, 255),
  )
  pageRgba.delete()
  srcQuad.delete()
  dstQuad.delete()
  Hsynth.delete()

  const blurred = new cv.Mat()
  cv.GaussianBlur(canvas, blurred, new cv.Size(0, 0), 1.0, 1.0, cv.BORDER_DEFAULT)
  canvas.delete()

  const imageData = makeImageData(blurred.cols, blurred.rows, new Uint8ClampedArray(blurred.data))
  blurred.delete()

  return { imageData, barCenterMm }
}
