// Not a real test: writes the synthetic "photo" used by the e2e test to a BMP
// so it can be uploaded through the UI by hand. Run with:
//   OUT=/path/to/photo.bmp npm run synthetic-photo
import { it } from 'vitest'
import { writeFileSync } from 'node:fs'
import { loadCvNode } from '../test/cvNode'
import { buildSyntheticPhoto } from '../test/synth'

function bmp(img: ImageData): Buffer {
  const { width: w, height: h, data } = img
  const rowSize = Math.ceil((w * 3) / 4) * 4
  const buf = Buffer.alloc(54 + rowSize * h)
  buf.write('BM', 0)
  buf.writeUInt32LE(buf.length, 2)
  buf.writeUInt32LE(54, 10)
  buf.writeUInt32LE(40, 14)
  buf.writeInt32LE(w, 18)
  buf.writeInt32LE(h, 22)
  buf.writeUInt16LE(1, 26)
  buf.writeUInt16LE(24, 28)
  buf.writeUInt32LE(rowSize * h, 34)
  for (let y = 0; y < h; y++) {
    const row = 54 + (h - 1 - y) * rowSize
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4
      buf[row + x * 3] = data[i + 2]
      buf[row + x * 3 + 1] = data[i + 1]
      buf[row + x * 3 + 2] = data[i]
    }
  }
  return buf
}

it('writes the synthetic photo', async () => {
  const out = process.env.OUT
  if (!out) throw new Error('set OUT=/path/to/photo.bmp')
  const cv = await loadCvNode()
  writeFileSync(out, bmp(buildSyntheticPhoto(cv).imageData))
}, 60000)
