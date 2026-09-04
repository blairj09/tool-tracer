// Shared contract between the detection/rectification, outline-extraction,
// and export stages of the pipeline. This file defines TYPES ONLY — the
// functions that produce/consume these types are implemented elsewhere
// (phases 3+).
import type { Pt, PaperSize } from '../template/layout'

export type { Pt, PaperSize }

export type Polygon = Pt[] // closed ring, mm, no duplicate last point

export const PX_PER_MM = 8

export interface DetectedMarker {
  id: number
  corners: [Pt, Pt, Pt, Pt] // image px, order TL,TR,BR,BL as reported by ArUco
}

export interface Rectified {
  /** RGBA pixels of the metric canvas: width = paperW*PX_PER_MM, height = paperH*PX_PER_MM */
  image: ImageData
  paper: PaperSize
  pxPerMm: number
  reprojErrorPx: number // mean reprojection error of the 16 marker corners (0 in manual mode)
  markers: DetectedMarker[] // empty in manual mode
  /** 'markers' = homography from the template; 'manual' = uniform scale from two user points, no perspective correction */
  mode: 'markers' | 'manual'
}

export interface OutlineParams {
  threshold: number | 'auto' // 0–255 on grayscale; 'auto' = Otsu
  invert: boolean // true if the tool is lighter than the paper
  blurMm: number // gaussian sigma-ish, default 0.3
  openMm: number // morphological open kernel, default 0.5
  closeMm: number // morphological close kernel, default 1.0
  simplifyMm: number // approxPolyDP epsilon, default 0.15
  minAreaMm2: number // ignore blobs smaller than this, default 100
  pick?: Pt // optional mm point; choose the contour containing/nearest it instead of the largest
}

export const DEFAULT_OUTLINE_PARAMS: OutlineParams = {
  threshold: 'auto',
  invert: false,
  blurMm: 0.3,
  openMm: 0.5,
  closeMm: 1.0,
  simplifyMm: 0.15,
  minAreaMm2: 100,
}

export interface OutlineResult {
  polygon: Polygon // mm, in rectified-paper coordinates
  bbox: { x: number; y: number; w: number; h: number }
  areaMm2: number
  thresholdUsed: number
  mask: ImageData // binary mask (same size as rectified image) for debug overlay
}

export interface ExportOptions {
  clearanceMm: number // default 0.5; 0 = no clearance layer
  autoAlign: boolean // rotate so the long axis is horizontal
  marginMm: number // default 5
  name: string
}

export interface ExportResult {
  svg: string
  outline: Polygon
  clearance?: Polygon
  widthMm: number
  heightMm: number
}
