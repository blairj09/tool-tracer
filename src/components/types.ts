// Local UI-side mirror of processPhoto()'s return shape (src/pipeline/run.ts).
// Kept here (rather than imported from pipeline/run.ts) so this file can be
// authored independently of the pipeline module's existence/timing; the
// shape matches the fixed signature agreed for processPhoto().
import type { DetectedMarker, Rectified } from '../pipeline/types'

export interface PhotoResult {
  image: ImageData
  markers?: DetectedMarker[]
  rectified?: Rectified
  error?: string
}

/** Viewer/canvas interaction mode. 'edit' = vertex-editing the current
 * selection (tool or component); 'draw' = freehand a new component
 * polygon; 'seed' = click a point inside the selected tool to auto-trace
 * a component from it; 'select' = pick a tool/component, or click an
 * untraced blob to add it as a tool. */
export type UiMode = 'select' | 'edit' | 'draw' | 'seed'
