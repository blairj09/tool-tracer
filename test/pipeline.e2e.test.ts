// Synthesizes a photographed template page entirely in-memory with OpenCV
// drawing primitives (no real camera/photo needed) and runs it through the
// full pipeline: marker detection -> rectification -> outline extraction ->
// align -> offset -> SVG export. Asserts accuracy against known ground
// truth and prints the measured numbers for visibility.
import { beforeAll, describe, expect, it } from 'vitest'
import type { CV } from '../src/cv/loadCv'
import { alignPolygons, bbox } from '../src/pipeline/align'
import { makeImageData } from '../src/pipeline/image'
import { detectMarkers, MarkerDetectionError } from '../src/pipeline/markers'
import { offsetPolygon } from '../src/pipeline/offset'
import { extractOutline } from '../src/pipeline/outline'
import { rectify } from '../src/pipeline/rectify'
import { exportOutline } from '../src/pipeline/run'
import { DEFAULT_OUTLINE_PARAMS, PX_PER_MM } from '../src/pipeline/types'
import { markerLayouts, PAPER, workingArea } from '../src/template/layout'
import { loadCvNode } from './cvNode'

const PAPER_SIZE = 'letter' as const
const SYNTH_PX_PER_MM = 6 // resolution of the synthetic "printed page" before photographing
const RECT_W_MM = 80
const RECT_H_MM = 30
const RECT_ANGLE_DEG = 17
const CIRCLE_DIAMETER_MM = 12

interface SyntheticPhoto {
  imageData: ImageData
}

function buildSyntheticPhoto(cv: CV): SyntheticPhoto {
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

  return { imageData }
}

describe('pipeline end-to-end (synthetic photo)', () => {
  let cv: CV

  beforeAll(async () => {
    cv = await loadCvNode()
  }, 60000)

  it('throws MarkerDetectionError with the spec-exact message when no markers are present', () => {
    const blank = makeImageData(400, 400, new Uint8ClampedArray(400 * 400 * 4).fill(255))
    let caught: unknown
    try {
      detectMarkers(cv, blank)
    } catch (e) {
      caught = e
    }
    expect(caught).toBeInstanceOf(MarkerDetectionError)
    const err = caught as MarkerDetectionError
    expect(err.foundIds).toEqual([])
    expect(err.message).toBe(
      'Found 0 of 4 markers (ids: none). Retake the photo with all four corner markers visible and in focus.',
    )
  })

  it('detects markers, rectifies, extracts the outline, and aligns/offsets/exports within tolerance', () => {
    const { imageData } = buildSyntheticPhoto(cv)

    // --- marker detection ---
    const markers = detectMarkers(cv, imageData)
    const foundIds = markers.map((m) => m.id)
    console.log('[e2e] marker ids found:', foundIds)
    expect(foundIds).toEqual([0, 1, 2, 3])

    // --- rectification ---
    const rectified = rectify(cv, imageData, markers, PAPER_SIZE)
    console.log('[e2e] reprojErrorPx:', rectified.reprojErrorPx)
    expect(rectified.reprojErrorPx).toBeLessThan(1.0)
    expect(rectified.image.width).toBe(Math.round(PAPER[PAPER_SIZE].w * PX_PER_MM))
    expect(rectified.image.height).toBe(Math.round(PAPER[PAPER_SIZE].h * PX_PER_MM))

    // --- outline extraction: default params -> largest contour is the rectangle ---
    const outline = extractOutline(cv, rectified, DEFAULT_OUTLINE_PARAMS)
    console.log('[e2e] rectangle areaMm2 (raw, unaligned):', outline.areaMm2)
    expect(outline.areaMm2).toBeGreaterThan(2360)
    expect(outline.areaMm2).toBeLessThan(2440)

    const [alignedRect] = alignPolygons([outline.polygon], { autoAlign: true, marginMm: 0 })
    const rectBox = bbox([alignedRect])
    console.log('[e2e] rectangle aligned bbox (mm):', rectBox)
    expect(rectBox.w).toBeGreaterThan(RECT_W_MM - 0.4)
    expect(rectBox.w).toBeLessThan(RECT_W_MM + 0.4)
    expect(rectBox.h).toBeGreaterThan(RECT_H_MM - 0.4)
    expect(rectBox.h).toBeLessThan(RECT_H_MM + 0.4)

    // --- outline extraction with a pick point at the circle's centre ---
    const area = workingArea(PAPER_SIZE)
    const circleCenterMm = { x: area.x + area.w * 0.25, y: area.y + area.h * 0.75 }
    // minAreaMm2 lowered from the 100 mm2 default: the 12mm-diameter circle
    // is ~113 mm2 in theory (and measures ~109 here), leaving only ~10%
    // headroom above the default floor — pin it well clear of that edge so
    // this test isn't coupled to the exact area-filter default.
    const circleOutline = extractOutline(cv, rectified, { ...DEFAULT_OUTLINE_PARAMS, minAreaMm2: 20, pick: circleCenterMm })
    const circleBox = circleOutline.bbox
    console.log('[e2e] circle bbox (mm):', circleBox, 'areaMm2:', circleOutline.areaMm2)
    expect(circleBox.w).toBeGreaterThan(CIRCLE_DIAMETER_MM - 0.4)
    expect(circleBox.w).toBeLessThan(CIRCLE_DIAMETER_MM + 0.4)
    expect(circleBox.h).toBeGreaterThan(CIRCLE_DIAMETER_MM - 0.4)
    expect(circleBox.h).toBeLessThan(CIRCLE_DIAMETER_MM + 0.4)

    // --- clearance offset ---
    const offset = offsetPolygon(cv, outline.polygon, 0.5, rectified.pxPerMm)
    const [alignedOffset] = alignPolygons([offset], { autoAlign: true, marginMm: 0 })
    const offsetBox = bbox([alignedOffset])
    console.log('[e2e] offset(+0.5mm) aligned bbox (mm):', offsetBox)
    expect(offsetBox.w).toBeGreaterThan(RECT_W_MM + 1 - 0.4)
    expect(offsetBox.w).toBeLessThan(RECT_W_MM + 1 + 0.4)
    expect(offsetBox.h).toBeGreaterThan(RECT_H_MM + 1 - 0.4)
    expect(offsetBox.h).toBeLessThan(RECT_H_MM + 1 + 0.4)

    // --- full export ---
    const result = exportOutline(cv, outline.polygon, {
      clearanceMm: 0.5,
      autoAlign: true,
      marginMm: 5,
      name: 'Test Tool',
    })
    console.log('[e2e] exported svg size (mm):', result.widthMm, result.heightMm)
    expect(result.svg).toContain('width="')
    expect(result.svg).toContain('mm"')
    expect(result.svg).toContain('<g id="outline">')
    expect(result.svg).toContain('<g id="clearance">')
  })
})
