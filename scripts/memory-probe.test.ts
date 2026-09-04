// Utility, not a real test: prints WASM heap size after each pipeline step.
// Run: npm run synthetic-photo -- scripts/memory-probe.test.ts
import { it } from 'vitest'
import { loadCvNode } from '../test/cvNode'
import { buildSyntheticPhoto } from '../test/synth'
import { detectMarkers } from '../src/pipeline/markers'
import { rectify } from '../src/pipeline/rectify'
import { extractOutline } from '../src/pipeline/outline'
import { exportOutline } from '../src/pipeline/run'
import { DEFAULT_OUTLINE_PARAMS } from '../src/pipeline/types'

it('probes memory', async () => {
  const cv = await loadCvNode()
  const heap = () => { const m = new cv.Mat(1, 1, cv.CV_8UC1); const b = (m.data as Uint8Array).buffer.byteLength; m.delete(); return Math.round(b / 1e6) + ' MB' }
  console.log('start', heap())
  const { imageData } = buildSyntheticPhoto(cv)
  console.log('after synth', heap())
  for (let i = 0; i < 3; i++) {
    const markers = detectMarkers(cv, imageData)
    console.log('after detectMarkers', heap())
    const rect = rectify(cv, imageData, markers, 'letter', 1)
    console.log('after rectify', heap())
    const outline = extractOutline(cv, rect, DEFAULT_OUTLINE_PARAMS)
    console.log('after extractOutline', heap())
    exportOutline(cv, outline.polygon, { clearanceMm: 0.5, autoAlign: true, marginMm: 5, name: 't' })
    console.log('after exportOutline', heap(), 'rss', Math.round(process.memoryUsage().rss / 1e6), 'MB')
  }
}, 120000)
