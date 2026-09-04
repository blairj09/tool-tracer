// Fallback scale-only rectification: used when marker detection fails. No
// perspective correction is applied — the whole photo is uniformly scaled so
// that a user-picked reference segment (of known real-world length) matches
// PX_PER_MM.
import type { CV } from '../cv/loadCv'
import { withMats } from '../cv/mats'
import { makeImageData } from './image'
import { PX_PER_MM } from './types'
import type { PaperSize, Pt, Rectified } from './types'

export function manualRectify(cv: CV, image: ImageData, p1: Pt, p2: Pt, distanceMm: number, paper: PaperSize): Rectified {
  const pxDist = Math.hypot(p2.x - p1.x, p2.y - p1.y)
  const targetPx = distanceMm * PX_PER_MM
  const factor = pxDist > 0 ? targetPx / pxDist : 1

  const outW = Math.max(1, Math.round(image.width * factor))
  const outH = Math.max(1, Math.round(image.height * factor))

  return withMats((track) => {
    const src = track(cv.matFromImageData(image))
    const dst = track(new cv.Mat())
    cv.resize(src, dst, new cv.Size(outW, outH), 0, 0, cv.INTER_LINEAR)
    const outImage = makeImageData(outW, outH, new Uint8ClampedArray(dst.data))

    return {
      image: outImage,
      paper,
      pxPerMm: PX_PER_MM,
      reprojErrorPx: 0,
      markers: [],
      mode: 'manual',
    }
  })
}
