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
