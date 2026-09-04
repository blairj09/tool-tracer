// Synthesizes a photographed template page entirely in-memory with OpenCV
// drawing primitives (no real camera/photo needed) and runs it through the
// full pipeline: marker detection -> rectification -> outline extraction ->
// align -> offset -> SVG export. Asserts accuracy against known ground
// truth and prints the measured numbers for visibility.
import { beforeAll, describe, expect, it } from 'vitest'
import type { CV } from '../src/cv/loadCv'
import { alignPolygons, bbox } from '../src/pipeline/align'
import { makeImageData } from '../src/pipeline/image'
import { manualRectify } from '../src/pipeline/manualScale'
import { detectMarkers, MarkerDetectionError } from '../src/pipeline/markers'
import { offsetPolygon } from '../src/pipeline/offset'
import { extractOutline } from '../src/pipeline/outline'
import { rectify } from '../src/pipeline/rectify'
import { exportOutline } from '../src/pipeline/run'
import { DEFAULT_OUTLINE_PARAMS, PX_PER_MM } from '../src/pipeline/types'
import { PAPER, workingArea } from '../src/template/layout'
import { loadCvNode } from './cvNode'

import { buildSyntheticPhoto, CIRCLE_DIAMETER_MM, PAPER_SIZE, RECT_H_MM, RECT_W_MM } from './synth'

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

  it('manual mode: ignores a border-touching background contour and picks the tool instead', () => {
    const { imageData } = buildSyntheticPhoto(cv)

    // Manual (marker-less) fallback: scale the whole photo so that two
    // user-picked points 400px apart on the raw image correspond to a
    // made-up 100mm reference distance. No perspective correction and no
    // working-area mask is applied in this mode.
    const rectified = manualRectify(cv, imageData, { x: 0, y: 0 }, { x: 400, y: 0 }, 100, PAPER_SIZE)
    console.log('[e2e] manual mode canvas size (px):', rectified.image.width, rectified.image.height)

    const outline = extractOutline(cv, rectified, DEFAULT_OUTLINE_PARAMS)
    console.log('[e2e] manual mode chosen outline bbox (mm):', outline.bbox, 'areaMm2:', outline.areaMm2)

    const canvasWMm = rectified.image.width / rectified.pxPerMm
    const canvasHMm = rectified.image.height / rectified.pxPerMm
    const imageAreaMm2 = canvasWMm * canvasHMm

    // The chosen contour must be an interior blob (the rectangle or the
    // circle), not the background region that touches the image border.
    expect(outline.bbox.x).toBeGreaterThan(0)
    expect(outline.bbox.y).toBeGreaterThan(0)
    expect(outline.bbox.x + outline.bbox.w).toBeLessThan(canvasWMm)
    expect(outline.bbox.y + outline.bbox.h).toBeLessThan(canvasHMm)
    expect(outline.areaMm2).toBeLessThan(imageAreaMm2 * 0.1)
  })
})
