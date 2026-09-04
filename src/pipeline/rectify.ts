// Homography rectification: warps the photographed page so it matches the
// printed template exactly, using the four detected ArUco markers as
// correspondences.
import type { CV } from '../cv/loadCv'
import { withMats } from '../cv/mats'
import { markerLayouts, PAPER } from '../template/layout'
import { makeImageData } from './image'
import { PX_PER_MM } from './types'
import type { DetectedMarker, PaperSize, Rectified } from './types'

/**
 * Rectify `image` to a metric canvas (`PAPER[paper]` at `PX_PER_MM` pixels
 * per millimetre) using a homography fit from the 4 markers' 16 corners.
 */
export function rectify(
  cv: CV,
  image: ImageData,
  markers: DetectedMarker[],
  paper: PaperSize,
  printerScale = 1,
): Rectified {
  const sorted = [...markers].sort((a, b) => a.id - b.id)
  const layouts = markerLayouts(paper, printerScale)
  const layoutById = new Map(layouts.map((l) => [l.id, l]))

  const srcFlat: number[] = []
  const dstFlat: number[] = []
  for (const marker of sorted) {
    const layout = layoutById.get(marker.id)
    if (!layout) continue
    for (let i = 0; i < 4; i++) {
      srcFlat.push(marker.corners[i].x, marker.corners[i].y)
      dstFlat.push(layout.corners[i].x * PX_PER_MM, layout.corners[i].y * PX_PER_MM)
    }
  }
  const n = srcFlat.length / 2

  const outW = Math.round(PAPER[paper].w * PX_PER_MM)
  const outH = Math.round(PAPER[paper].h * PX_PER_MM)

  return withMats((track) => {
    const srcMat = track(cv.matFromArray(n, 1, cv.CV_32FC2, srcFlat))
    const dstMat = track(cv.matFromArray(n, 1, cv.CV_32FC2, dstFlat))
    const H = track(cv.findHomography(srcMat, dstMat, cv.RANSAC, 3))

    const srcImg = track(cv.matFromImageData(image))
    const warped = track(new cv.Mat())
    cv.warpPerspective(
      srcImg,
      warped,
      H,
      new cv.Size(outW, outH),
      cv.INTER_LINEAR,
      cv.BORDER_CONSTANT,
      new cv.Scalar(255, 255, 255, 255),
    )

    const projected = track(new cv.Mat())
    cv.perspectiveTransform(srcMat, projected, H)
    let sumErr = 0
    for (let i = 0; i < n; i++) {
      const px = projected.data32F[i * 2]
      const py = projected.data32F[i * 2 + 1]
      const dx = px - dstFlat[i * 2]
      const dy = py - dstFlat[i * 2 + 1]
      sumErr += Math.hypot(dx, dy)
    }
    const reprojErrorPx = n > 0 ? sumErr / n : 0

    const outImage = makeImageData(outW, outH, new Uint8ClampedArray(warped.data))

    return {
      image: outImage,
      paper,
      pxPerMm: PX_PER_MM,
      reprojErrorPx,
      markers: sorted,
      mode: 'markers',
    }
  })
}
