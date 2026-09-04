// ArUco marker detection. Locates the four DICT_4X4_50 markers (ids 0-3,
// TL/TR/BR/BL) printed on the template page within an arbitrary photo.
import type { CV } from '../cv/loadCv'
import { withMats } from '../cv/mats'
import type { DetectedMarker, Pt } from './types'

export class MarkerDetectionError extends Error {
  foundIds: number[]

  constructor(foundIds: number[]) {
    const idsStr = foundIds.length ? foundIds.join(', ') : 'none'
    super(
      `Found ${foundIds.length} of 4 markers (ids: ${idsStr}). Retake the photo with all four corner markers visible and in focus.`,
    )
    this.name = 'MarkerDetectionError'
    this.foundIds = foundIds
  }
}

/**
 * Detect the four corner ArUco markers (ids 0-3) in `image`. Returns markers
 * sorted by id. Throws {@link MarkerDetectionError} if any of ids 0-3 is
 * missing.
 */
export function detectMarkers(cv: CV, image: ImageData): DetectedMarker[] {
  return withMats((track) => {
    const rgba = track(cv.matFromImageData(image))
    const gray = track(new cv.Mat())
    cv.cvtColor(rgba, gray, cv.COLOR_RGBA2GRAY)

    const dict = track(cv.getPredefinedDictionary(cv.DICT_4X4_50))
    const params = track(new cv.aruco_DetectorParameters())
    params.cornerRefinementMethod = cv.CORNER_REFINE_SUBPIX
    const refineParams = track(new cv.aruco_RefineParameters(10, 3, true))
    const detector = track(new cv.aruco_ArucoDetector(dict, params, refineParams))

    const corners = track(new cv.MatVector())
    const ids = track(new cv.Mat())
    const rejected = track(new cv.MatVector())
    detector.detectMarkers(gray, corners, ids, rejected)

    // The `rejected` candidates aren't used, but their Mats were allocated
    // by detectMarkers and need to be freed individually before the vector
    // itself is deleted.
    for (let i = 0; i < rejected.size(); i++) {
      rejected.get(i).delete()
    }

    const found = new Map<number, DetectedMarker>()
    for (let i = 0; i < corners.size(); i++) {
      const id = ids.data32S[i]
      const cornerMat = corners.get(i)
      const d = cornerMat.data32F
      const pts: [Pt, Pt, Pt, Pt] = [
        { x: d[0], y: d[1] },
        { x: d[2], y: d[3] },
        { x: d[4], y: d[5] },
        { x: d[6], y: d[7] },
      ]
      cornerMat.delete()
      if (id >= 0 && id <= 3 && !found.has(id)) {
        found.set(id, { id, corners: pts })
      }
    }

    const result: DetectedMarker[] = []
    for (const id of [0, 1, 2, 3]) {
      const m = found.get(id)
      if (m) result.push(m)
    }
    if (result.length < 4) {
      throw new MarkerDetectionError(result.map((m) => m.id))
    }
    return result
  })
}
