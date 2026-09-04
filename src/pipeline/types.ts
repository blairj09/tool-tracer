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

// --- v2 contract: multiple tools per photo + components -------------------
// The UI agent codes against everything below verbatim (names, fields,
// defaults). Do not rename or remove; extra exports are fine.

export interface Blob {
  // one thresholded region, image-frame mm
  polygon: Polygon
  bbox: { x: number; y: number; w: number; h: number }
  areaMm2: number
  centroid: Pt
}

export interface DetectionResult {
  blobs: Blob[] // all regions with area >= max(5, minAreaMm2 / 10), sorted by area desc
  thresholdUsed: number
  mask: ImageData // binary mask for the debug overlay (as today)
}

export interface ComponentParams {
  threshold: number | 'auto'
  invert: boolean
  openMm: number
  closeMm: number
  simplifyMm: number
}

export const DEFAULT_COMPONENT_PARAMS: ComponentParams = {
  threshold: 'auto',
  invert: false,
  openMm: 0.3,
  closeMm: 0.5,
  simplifyMm: 0.15,
}

export interface ToolComponent {
  id: string
  name: string
  source: 'auto' | 'drawn'
  seed?: Pt // auto: clicked point (mm, image frame)
  params: ComponentParams // auto only (ignored for drawn)
  polygon: Polygon // auto result or drawn polygon, image-frame mm
  edited: Polygon | null
  clearanceMm: number // default 0
}

export interface Tool {
  id: string
  name: string
  source: 'auto' | 'pick'
  pick?: Pt // 'pick' tools: the clicked point; kept through re-detection
  polygon: Polygon
  bbox: { x: number; y: number; w: number; h: number }
  areaMm2: number
  centroid: Pt
  edited: Polygon | null
  components: ToolComponent[]
}

export interface Transform {
  dx: number
  dy: number
  angleDeg: number
} // rotation about the tool's centroid (image-frame mm), then translation

export const IDENTITY: Transform = { dx: 0, dy: 0, angleDeg: 0 }

export interface ToolExportInput {
  name: string
  polygon: Polygon
  clearanceMm: number
  transform: Transform
  components: { name: string; polygon: Polygon; clearanceMm: number }[]
}

export interface ExportedTool {
  name: string
  id: string
  outline: Polygon
  clearance?: Polygon
  centroid: Pt
  components: { name: string; id: string; outline: Polygon; clearance?: Polygon }[]
}

export interface ExportResult {
  svg: string
  widthMm: number
  heightMm: number
  tools: ExportedTool[]
  originShift: Pt
} // replaces the v1 shape; originShift = layout-frame → export-frame translation

export type CanvasMode = { mode: 'auto' } | { mode: 'fixed'; widthMm: number; heightMm: number }

export interface ExportOptions {
  clearanceMm: number
  marginMm: number
  name: string
  canvas: CanvasMode
} // `autoAlign` removed (now a per-tool action)
