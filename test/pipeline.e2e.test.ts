// Synthesizes a photographed template page entirely in-memory with OpenCV
// drawing primitives (no real camera/photo needed) and runs it through the
// full pipeline: marker detection -> rectification -> outline extraction ->
// components -> align -> offset -> SVG export. Asserts accuracy against
// known ground truth and prints the measured numbers for visibility.
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readdirSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import type { CV } from '../src/cv/loadCv'
import { alignPolygons, autoAlignAngleDeg, bbox, centroid } from '../src/pipeline/align'
import { extractComponent } from '../src/pipeline/component'
import { makeImageData } from '../src/pipeline/image'
import { manualRectify } from '../src/pipeline/manualScale'
import { detectMarkers, MarkerDetectionError } from '../src/pipeline/markers'
import { offsetPolygon } from '../src/pipeline/offset'
import { detectBlobs, extractOutline } from '../src/pipeline/outline'
import { rectify } from '../src/pipeline/rectify'
import { exportOutline, exportTools } from '../src/pipeline/run'
import { DEFAULT_COMPONENT_PARAMS, DEFAULT_OUTLINE_PARAMS, IDENTITY, PX_PER_MM } from '../src/pipeline/types'
import type { Polygon, ToolExportInput } from '../src/pipeline/types'
import { PAPER, workingArea } from '../src/template/layout'
import { loadCvNode } from './cvNode'

import { BAR_H_MM, BAR_W_MM, buildSyntheticPhoto, CIRCLE_DIAMETER_MM, PAPER_SIZE, RECT_ANGLE_DEG, RECT_H_MM, RECT_W_MM } from './synth'

function squareAt(cx: number, cy: number, size: number): Polygon {
  const h = size / 2
  return [
    { x: cx - h, y: cy - h },
    { x: cx + h, y: cy - h },
    { x: cx + h, y: cy + h },
    { x: cx - h, y: cy + h },
  ]
}

function rotatedRect(cx: number, cy: number, w: number, h: number, angleDeg: number): Polygon {
  const theta = (angleDeg * Math.PI) / 180
  const c = Math.cos(theta)
  const s = Math.sin(theta)
  const half = [
    { x: -w / 2, y: -h / 2 },
    { x: w / 2, y: -h / 2 },
    { x: w / 2, y: h / 2 },
    { x: -w / 2, y: h / 2 },
  ]
  return half.map((p) => ({ x: cx + p.x * c - p.y * s, y: cy + p.x * s + p.y * c }))
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
    console.log('[e2e] rectangle areaMm2 (raw, unaligned), thresholdUsed:', outline.areaMm2, outline.thresholdUsed)
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

    // --- full export (v1 wrapper) ---
    const result = exportOutline(cv, outline.polygon, {
      clearanceMm: 0.5,
      autoAlign: true,
      marginMm: 5,
      name: 'Test Tool',
    })
    console.log('[e2e] exported svg size (mm):', result.widthMm, result.heightMm)
    expect(result.svg).toContain('width="')
    expect(result.svg).toContain('mm"')
    expect(result.tools).toHaveLength(1)
    expect(result.svg).toContain(`<g id="${result.tools[0].id}">`)
    expect(result.svg).toContain(`<path id="${result.tools[0].id}-outline"`)
    expect(result.svg).toContain(`<path id="${result.tools[0].id}-clearance"`)
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

  describe('detectBlobs', () => {
    it('finds the rectangle (+bar) and circle as top-level blobs, largest first', () => {
      const { imageData } = buildSyntheticPhoto(cv)
      const markers = detectMarkers(cv, imageData)
      const rectified = rectify(cv, imageData, markers, PAPER_SIZE)
      const detection = detectBlobs(cv, rectified, DEFAULT_OUTLINE_PARAMS)
      console.log(
        '[e2e] detectBlobs: count',
        detection.blobs.length,
        'areas',
        detection.blobs.map((b) => b.areaMm2),
        'thresholdUsed',
        detection.thresholdUsed,
      )

      expect(detection.blobs.length).toBeGreaterThanOrEqual(2)
      const [rect, circle] = detection.blobs
      expect(rect.areaMm2).toBeGreaterThan(circle.areaMm2)
      expect(rect.areaMm2).toBeGreaterThan(2360)
      expect(rect.areaMm2).toBeLessThan(2440)
      expect(circle.areaMm2).toBeGreaterThan(CIRCLE_DIAMETER_MM * CIRCLE_DIAMETER_MM * 0.6)

      // centroid is the pure shoelace centroid of the blob's own polygon
      for (const b of detection.blobs) {
        const c = centroid(b.polygon)
        expect(b.centroid.x).toBeCloseTo(c.x, 6)
        expect(b.centroid.y).toBeCloseTo(c.y, 6)
      }
    })
  })

  describe('extractComponent', () => {
    it('extracts the grey bar inside the rectangle via a seed point, and leaves the v1 outline unchanged', () => {
      const { imageData, barCenterMm } = buildSyntheticPhoto(cv, { bar: true })
      expect(barCenterMm).toBeDefined()

      const markers = detectMarkers(cv, imageData)
      const rectified = rectify(cv, imageData, markers, PAPER_SIZE)

      const outline = extractOutline(cv, rectified, DEFAULT_OUTLINE_PARAMS)
      console.log('[e2e] rectangle+bar thresholdUsed:', outline.thresholdUsed, 'areaMm2:', outline.areaMm2)
      // v1 outline of the rectangle is unchanged with the bar present.
      expect(outline.areaMm2).toBeGreaterThan(2360)
      expect(outline.areaMm2).toBeLessThan(2440)

      // The bar is lighter (~110) than its surroundings inside the tool
      // (the rectangle, ~20) -> invert:true.
      const barPolygon = extractComponent(cv, rectified, outline.polygon, barCenterMm!, {
        ...DEFAULT_COMPONENT_PARAMS,
        invert: true,
      })
      const barBox = bbox([barPolygon])
      console.log('[e2e] extracted bar bbox (mm):', barBox)
      expect(barBox.w).toBeGreaterThan(BAR_W_MM - 0.4)
      expect(barBox.w).toBeLessThan(BAR_W_MM + 0.4)
      expect(barBox.h).toBeGreaterThan(BAR_H_MM - 0.4)
      expect(barBox.h).toBeLessThan(BAR_H_MM + 0.4)
    })
  })

  describe('exportTools', () => {
    const opts = { clearanceMm: 0, marginMm: 5, name: 'export-test', canvas: { mode: 'auto' as const } }

    it('two tools with identity transforms preserve their photographed relative offset', () => {
      const toolA: ToolExportInput = { name: 'a', polygon: squareAt(10, 10, 10), clearanceMm: 0, transform: IDENTITY, components: [] }
      const toolB: ToolExportInput = { name: 'b', polygon: squareAt(60, 45, 10), clearanceMm: 0, transform: IDENTITY, components: [] }

      const result = exportTools(cv, [toolA, toolB], opts)
      const [expA, expB] = result.tools
      const gotDiff = { x: expB.centroid.x - expA.centroid.x, y: expB.centroid.y - expA.centroid.y }
      const wantDiff = {
        x: centroid(toolB.polygon).x - centroid(toolA.polygon).x,
        y: centroid(toolB.polygon).y - centroid(toolA.polygon).y,
      }
      console.log('[e2e] exportTools identity relative offset:', gotDiff, 'expected:', wantDiff)
      expect(gotDiff.x).toBeCloseTo(wantDiff.x, 9)
      expect(gotDiff.y).toBeCloseTo(wantDiff.y, 9)
    })

    it('rotating a tool by autoAlignAngleDeg carries its components with it (component bbox stays inside tool bbox)', () => {
      const toolPolygon = rotatedRect(50, 50, RECT_W_MM, RECT_H_MM, RECT_ANGLE_DEG)
      const componentPolygon = squareAt(50, 50, 10) // axis-aligned, well inside the rotated tool
      const angleDeg = autoAlignAngleDeg(toolPolygon)
      console.log('[e2e] exportTools auto-align angleDeg:', angleDeg)

      const input: ToolExportInput = {
        name: 'knife',
        polygon: toolPolygon,
        clearanceMm: 0,
        transform: { dx: 0, dy: 0, angleDeg },
        components: [{ name: 'clip', polygon: componentPolygon, clearanceMm: 0 }],
      }
      const result = exportTools(cv, [input], opts)
      const tool = result.tools[0]
      const toolBox = bbox([tool.outline])
      const compBox = bbox([tool.components[0].outline])
      console.log('[e2e] exportTools aligned tool bbox:', toolBox, 'component bbox:', compBox)

      expect(toolBox.w).toBeGreaterThan(toolBox.h) // long side horizontal
      expect(toolBox.w).toBeCloseTo(RECT_W_MM, 3)
      expect(toolBox.h).toBeCloseTo(RECT_H_MM, 3)

      const eps = 1e-6
      expect(compBox.x).toBeGreaterThanOrEqual(toolBox.x - eps)
      expect(compBox.y).toBeGreaterThanOrEqual(toolBox.y - eps)
      expect(compBox.x + compBox.w).toBeLessThanOrEqual(toolBox.x + toolBox.w + eps)
      expect(compBox.y + compBox.h).toBeLessThanOrEqual(toolBox.y + toolBox.h + eps)
    })

    it('a translation dx,dy moves the tool exported centroid by exactly that amount relative to the other tool', () => {
      const toolA: ToolExportInput = { name: 'a', polygon: squareAt(10, 10, 10), clearanceMm: 0, transform: IDENTITY, components: [] }
      const toolBBase: ToolExportInput = { name: 'b', polygon: squareAt(60, 10, 10), clearanceMm: 0, transform: IDENTITY, components: [] }

      const base = exportTools(cv, [toolA, toolBBase], opts)
      const baseDiff = {
        x: base.tools[1].centroid.x - base.tools[0].centroid.x,
        y: base.tools[1].centroid.y - base.tools[0].centroid.y,
      }

      const toolBMoved: ToolExportInput = { ...toolBBase, transform: { dx: 30, dy: -12, angleDeg: 0 } }
      const moved = exportTools(cv, [toolA, toolBMoved], opts)
      const movedDiff = {
        x: moved.tools[1].centroid.x - moved.tools[0].centroid.x,
        y: moved.tools[1].centroid.y - moved.tools[0].centroid.y,
      }

      console.log('[e2e] exportTools translation baseDiff:', baseDiff, 'movedDiff:', movedDiff)
      expect(movedDiff.x - baseDiff.x).toBeCloseTo(30, 9)
      expect(movedDiff.y - baseDiff.y).toBeCloseTo(-12, 9)
    })

    it('a fixed canvas makes the SVG width/height equal the requested size', () => {
      const toolA: ToolExportInput = { name: 'a', polygon: squareAt(10, 10, 10), clearanceMm: 0, transform: IDENTITY, components: [] }
      const toolB: ToolExportInput = { name: 'b', polygon: squareAt(60, 45, 10), clearanceMm: 0, transform: IDENTITY, components: [] }

      const result = exportTools(cv, [toolA, toolB], {
        clearanceMm: 0,
        marginMm: 5,
        name: 'fixed-canvas-test',
        canvas: { mode: 'fixed', widthMm: 200, heightMm: 150 },
      })
      expect(result.widthMm).toBe(200)
      expect(result.heightMm).toBe(150)
      expect(result.svg).toContain('width="200mm"')
      expect(result.svg).toContain('height="150mm"')
    })
  })
})

describe('real fixture (optional)', () => {
  let cv: CV

  beforeAll(async () => {
    cv = await loadCvNode()
  }, 60000)

  const samplesDir = path.resolve(__dirname, '../public/samples')
  const fixtures = existsSync(samplesDir)
    ? readdirSync(samplesDir).filter((f) => /\.(jpe?g|png)$/i.test(f) && f !== 'synthetic-letter.png')
    : []

  if (fixtures.length === 0) {
    it.skip('no real photo found in public/samples/ (other than synthetic-letter.png) — skipping', () => {})
  } else {
    it('detects markers and traces the largest blob in the real fixture', () => {
      const file = fixtures[0]
      const src = path.join(samplesDir, file)
      const tmpDir = mkdtempSync(path.join(tmpdir(), 'tooltrace-fixture-'))
      const bmpPath = path.join(tmpDir, 'fixture.bmp')

      let imageData: ImageData
      try {
        execFileSync('sips', ['-s', 'format', 'bmp', src, '--out', bmpPath])
        imageData = readBmp(bmpPath)
      } catch (e) {
        console.log('[e2e] `sips` unavailable or failed — skipping real fixture test:', e)
        return
      }

      const markers = detectMarkers(cv, imageData)
      console.log('[e2e] real fixture marker ids found:', markers.map((m) => m.id))
      expect(markers).toHaveLength(4)

      const rectified = rectify(cv, imageData, markers, PAPER_SIZE)
      console.log('[e2e] real fixture reprojErrorPx:', rectified.reprojErrorPx)

      const detection = detectBlobs(cv, rectified, DEFAULT_OUTLINE_PARAMS)
      const largest = detection.blobs[0]
      console.log('[e2e] real fixture largest blob bbox (mm):', largest?.bbox, 'areaMm2:', largest?.areaMm2)
      expect(detection.blobs.length).toBeGreaterThan(0)
    })
  }
})

/**
 * Minimal 24-bit BMP reader (bottom-up rows, 4-byte row padding), used only
 * to decode the `sips`-converted real-photo fixture in Node (which has no
 * built-in image decoder).
 */
function readBmp(filePath: string): ImageData {
  const buf = readFileSync(filePath)
  const dataOffset = buf.readUInt32LE(10)
  const width = buf.readInt32LE(18)
  const heightRaw = buf.readInt32LE(22)
  const height = Math.abs(heightRaw)
  const topDown = heightRaw < 0
  const bitCount = buf.readUInt16LE(28)
  if (bitCount !== 24) throw new Error(`unsupported BMP bit depth: ${bitCount}`)

  const rowSize = Math.ceil((width * 3) / 4) * 4
  const data = new Uint8ClampedArray(width * height * 4)
  for (let y = 0; y < height; y++) {
    const srcY = topDown ? y : height - 1 - y
    const rowStart = dataOffset + srcY * rowSize
    for (let x = 0; x < width; x++) {
      const si = rowStart + x * 3
      const di = (y * width + x) * 4
      data[di] = buf[si + 2]
      data[di + 1] = buf[si + 1]
      data[di + 2] = buf[si]
      data[di + 3] = 255
    }
  }
  return makeImageData(width, height, data)
}
