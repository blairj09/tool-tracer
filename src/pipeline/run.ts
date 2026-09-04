// Orchestration entry points used by the UI: full photo -> rectified-image
// pipeline, outline -> SVG export, and small browser download/copy helpers.
import type { CV } from '../cv/loadCv'
import { alignPolygons, bbox } from './align'
import { loadImageData } from './image'
import { detectMarkers, MarkerDetectionError } from './markers'
import { offsetPolygon } from './offset'
import { rectify } from './rectify'
import { toSvg } from './svg'
import type { DetectedMarker, ExportOptions, ExportResult, PaperSize, Polygon, Rectified } from './types'

export function exportOutline(cv: CV, outline: Polygon, opts: ExportOptions): ExportResult {
  const clearance = opts.clearanceMm !== 0 ? offsetPolygon(cv, outline, opts.clearanceMm) : undefined
  const polys: Polygon[] = clearance ? [outline, clearance] : [outline]
  const aligned = alignPolygons(polys, { autoAlign: opts.autoAlign, marginMm: opts.marginMm })
  const alignedOutline = aligned[0]
  const alignedClearance = clearance ? aligned[1] : undefined

  const box = bbox(aligned)
  const widthMm = box.w + 2 * opts.marginMm
  const heightMm = box.h + 2 * opts.marginMm

  const svg = toSvg({
    outline: alignedOutline,
    clearance: alignedClearance,
    widthMm,
    heightMm,
    name: opts.name,
  })

  return { svg, outline: alignedOutline, clearance: alignedClearance, widthMm, heightMm }
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
