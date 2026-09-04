// Browser-facing image loading + a cross-environment ImageData constructor.
//
// `loadImageData` uses the browser's `createImageBitmap`/`canvas` APIs and
// therefore only runs in a browser (or a DOM-shimmed test environment).
// `makeImageData` is used everywhere else in the pipeline so the same code
// can run in Node (Vitest) where `globalThis.ImageData` does not exist.

/**
 * Decode `file` into an `ImageData`, respecting EXIF orientation and
 * downscaling so the long edge is at most `maxLongEdge` pixels.
 */
export async function loadImageData(file: Blob, maxLongEdge = 2400): Promise<ImageData> {
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
  try {
    const longEdge = Math.max(bitmap.width, bitmap.height)
    const scale = longEdge > maxLongEdge ? maxLongEdge / longEdge : 1
    const outW = Math.max(1, Math.round(bitmap.width * scale))
    const outH = Math.max(1, Math.round(bitmap.height * scale))

    const canvas = document.createElement('canvas')
    canvas.width = outW
    canvas.height = outH
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('Could not create a 2D canvas context')
    ctx.drawImage(bitmap, 0, 0, outW, outH)
    return ctx.getImageData(0, 0, outW, outH)
  } finally {
    bitmap.close()
  }
}

/**
 * Construct an `ImageData`-shaped object. Uses the real `ImageData`
 * constructor when available (browsers), otherwise returns a plain object
 * with the same shape so the pipeline can run headlessly (e.g. in Node
 * under Vitest).
 */
export function makeImageData(width: number, height: number, data?: Uint8ClampedArray): ImageData {
  const buf = data ?? new Uint8ClampedArray(width * height * 4)
  if (typeof globalThis.ImageData !== 'undefined') {
    return new ImageData(buf as Uint8ClampedArray<ArrayBuffer>, width, height)
  }
  return { width, height, data: buf, colorSpace: 'srgb' } as ImageData
}
