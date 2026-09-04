// Renders a single ArUco marker (DICT_4X4_50) to its 6x6 bit grid so the SVG
// template renderer can draw it as vector rectangles instead of embedding a
// raster image.
import type { CV } from '../cv/loadCv'

const GRID_SIZE = 6 // 4x4 data bits + 1-cell black border on each side
const BORDER_BITS = 1

/**
 * Returns a GRID_SIZE x GRID_SIZE boolean grid for the given marker id.
 * `true` = black cell. Uses `cv.getPredefinedDictionary(cv.DICT_4X4_50)` and
 * `dict.generateImageMarker(...)`.
 */
export async function markerBits(cv: CV, id: number): Promise<boolean[][]> {
  const dict = cv.getPredefinedDictionary(cv.DICT_4X4_50)
  const mat = new cv.Mat()
  try {
    dict.generateImageMarker(id, GRID_SIZE, mat, BORDER_BITS)

    const grid: boolean[][] = []
    for (let row = 0; row < GRID_SIZE; row++) {
      const rowBits: boolean[] = []
      for (let col = 0; col < GRID_SIZE; col++) {
        // Single-channel 8U marker image: 0 = black, 255 = white.
        const value = mat.data[row * mat.cols + col]
        rowBits.push(value < 128)
      }
      grid.push(rowBits)
    }
    return grid
  } finally {
    mat.delete()
  }
}
