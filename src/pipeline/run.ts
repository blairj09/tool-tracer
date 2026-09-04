// Orchestration entry points used by the UI: full photo -> rectified-image
// pipeline, tool/component -> combined SVG export, and small browser
// download/copy helpers.
import type { CV } from '../cv/loadCv'
import { applyTransform, autoAlignAngleDeg, bbox, centroid } from './align'
import { loadImageData } from './image'
import { detectMarkers, MarkerDetectionError } from './markers'
import { offsetPolygon } from './offset'
import { rectify } from './rectify'
import { toSvg } from './svg'
import type {
  DetectedMarker,
  ExportedTool,
  ExportOptions,
  ExportResult,
  PaperSize,
  Polygon,
  Pt,
  Rectified,
  ToolExportInput,
  Transform,
} from './types'

function slugify(name: string, fallback: string): string {
  const base = name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return base || fallback
}

/** Dedupe `base` against `used`, appending `-2`, `-3`, … as needed. */
function dedupeId(base: string, used: Set<string>): string {
  if (!used.has(base)) {
    used.add(base)
    return base
  }
  let n = 2
  while (used.has(`${base}-${n}`)) n++
  const id = `${base}-${n}`
  used.add(id)
  return id
}

function translate(poly: Polygon, shift: Pt): Polygon {
  return poly.map((p) => ({ x: p.x + shift.x, y: p.y + shift.y }))
}

interface PreparedComponent {
  id: string
  name: string
  outline: Polygon
  clearance?: Polygon
}

interface PreparedTool {
  id: string
  name: string
  outline: Polygon
  clearance?: Polygon
  components: PreparedComponent[]
}

/**
 * Build the combined multi-tool SVG export. Each tool's outline/clearance
 * and its components' outlines/clearances are offset (in the tool's own
 * untransformed frame) and then transformed together (same pivot = the
 * centroid of the *untransformed* tool polygon, same `transform`) into the
 * shared layout frame. The layout frame is then shifted by `originShift`
 * so everything's bounding box (auto canvas) or the fixed canvas's
 * requested top-left starts at `(marginMm, marginMm)`.
 */
export function exportTools(cv: CV, tools: ToolExportInput[], opts: ExportOptions): ExportResult {
  const usedToolIds = new Set<string>()

  const prepared: PreparedTool[] = tools.map((tool) => {
    const pivot = centroid(tool.polygon)
    const toolId = dedupeId(slugify(tool.name, 'tool'), usedToolIds)

    const outlineClearance = tool.clearanceMm !== 0 ? offsetPolygon(cv, tool.polygon, tool.clearanceMm) : undefined
    const outline = applyTransform(tool.polygon, tool.transform, pivot)
    const clearance = outlineClearance ? applyTransform(outlineClearance, tool.transform, pivot) : undefined

    const usedComponentIds = new Set<string>()
    const components: PreparedComponent[] = tool.components.map((c) => {
      const compClearance = c.clearanceMm !== 0 ? offsetPolygon(cv, c.polygon, c.clearanceMm) : undefined
      return {
        id: `${toolId}-${dedupeId(slugify(c.name, 'part'), usedComponentIds)}`,
        name: c.name,
        outline: applyTransform(c.polygon, tool.transform, pivot),
        clearance: compClearance ? applyTransform(compClearance, tool.transform, pivot) : undefined,
      }
    })

    return { id: toolId, name: tool.name, outline, clearance, components }
  })

  const allLayoutPolys: Polygon[] = []
  for (const t of prepared) {
    allLayoutPolys.push(t.outline)
    if (t.clearance) allLayoutPolys.push(t.clearance)
    for (const c of t.components) {
      allLayoutPolys.push(c.outline)
      if (c.clearance) allLayoutPolys.push(c.clearance)
    }
  }
  const layoutBox = bbox(allLayoutPolys)

  const originShift: Pt = { x: opts.marginMm - layoutBox.x, y: opts.marginMm - layoutBox.y }

  const widthMm = opts.canvas.mode === 'fixed' ? opts.canvas.widthMm : layoutBox.w + 2 * opts.marginMm
  const heightMm = opts.canvas.mode === 'fixed' ? opts.canvas.heightMm : layoutBox.h + 2 * opts.marginMm

  const exportedTools: ExportedTool[] = prepared.map((t) => {
    const outline = translate(t.outline, originShift)
    const clearance = t.clearance ? translate(t.clearance, originShift) : undefined
    const components = t.components.map((c) => ({
      id: c.id,
      name: c.name,
      outline: translate(c.outline, originShift),
      clearance: c.clearance ? translate(c.clearance, originShift) : undefined,
    }))
    return { id: t.id, name: t.name, outline, clearance, centroid: centroid(outline), components }
  })

  const svg = toSvg({ tools: exportedTools, widthMm, heightMm, title: opts.name })

  return { svg, widthMm, heightMm, tools: exportedTools, originShift }
}

export interface ExportOutlineOptions {
  clearanceMm: number // default 0.5; 0 = no clearance layer
  autoAlign: boolean // rotate so the long axis is horizontal
  marginMm: number // default 5
  name: string
}

/**
 * v1 compatibility wrapper: exports a single polygon (no components) using
 * {@link exportTools}, mapping `autoAlign` onto a rotation transform about
 * the polygon's own centroid.
 */
export function exportOutline(cv: CV, outline: Polygon, opts: ExportOutlineOptions): ExportResult {
  const angleDeg = opts.autoAlign ? autoAlignAngleDeg(outline) : 0
  const transform: Transform = { dx: 0, dy: 0, angleDeg }
  const toolInput: ToolExportInput = {
    name: opts.name,
    polygon: outline,
    clearanceMm: opts.clearanceMm,
    transform,
    components: [],
  }
  return exportTools(cv, [toolInput], {
    clearanceMm: opts.clearanceMm,
    marginMm: opts.marginMm,
    name: opts.name,
    canvas: { mode: 'auto' },
  })
}

/**
 * Load a photo, detect the corner markers, and rectify. If marker detection
 * fails, resolves with `{ image, error }` (instead of throwing) so the UI
 * can fall back to the manual two-point scale flow.
 */
export async function processPhoto(
  cv: CV,
  file: Blob,
  paper: PaperSize,
  printerScale: number,
): Promise<{ image: ImageData; markers?: DetectedMarker[]; rectified?: Rectified; error?: string }> {
  const image = await loadImageData(file)
  try {
    const markers = detectMarkers(cv, image)
    const rectified = rectify(cv, image, markers, paper, printerScale)
    return { image, markers, rectified }
  } catch (e) {
    if (e instanceof MarkerDetectionError) {
      return { image, error: e.message }
    }
    throw e
  }
}

export function downloadSvg(svg: string, filename: string): void {
  const blob = new Blob([svg], { type: 'image/svg+xml' })
  const url = URL.createObjectURL(blob)
  try {
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
  } finally {
    URL.revokeObjectURL(url)
  }
}

export async function copyText(text: string): Promise<void> {
  if (navigator.clipboard && navigator.clipboard.writeText) {
    await navigator.clipboard.writeText(text)
    return
  }
  const ta = document.createElement('textarea')
  ta.value = text
  ta.style.position = 'fixed'
  ta.style.opacity = '0'
  document.body.appendChild(ta)
  ta.focus()
  ta.select()
  try {
    document.execCommand('copy')
  } finally {
    document.body.removeChild(ta)
  }
}
