import { describe, expect, it } from 'vitest'
import { defaultComponentName, reconcileTools } from '../src/pipeline/tools'
import type { Blob, DetectionResult, Polygon, Tool, ToolComponent } from '../src/pipeline/types'
import { DEFAULT_COMPONENT_PARAMS } from '../src/pipeline/types'

function square(cx: number, cy: number, size: number): Polygon {
  const h = size / 2
  return [
    { x: cx - h, y: cy - h },
    { x: cx + h, y: cy - h },
    { x: cx + h, y: cy + h },
    { x: cx - h, y: cy + h },
  ]
}

function blob(cx: number, cy: number, size: number): Blob {
  const polygon = square(cx, cy, size)
  return {
    polygon,
    bbox: { x: cx - size / 2, y: cy - size / 2, w: size, h: size },
    areaMm2: size * size,
    centroid: { x: cx, y: cy },
  }
}

function detection(blobs: Blob[]): DetectionResult {
  return { blobs: [...blobs].sort((a, b) => b.areaMm2 - a.areaMm2), thresholdUsed: 128, mask: { width: 1, height: 1, data: new Uint8ClampedArray(4) } as ImageData }
}

function component(overrides: Partial<ToolComponent> = {}): ToolComponent {
  return {
    id: 'c1',
    name: 'part-1',
    source: 'drawn',
    params: DEFAULT_COMPONENT_PARAMS,
    polygon: square(0, 0, 2),
    edited: null,
    clearanceMm: 0,
    ...overrides,
  }
}

describe('reconcileTools', () => {
  it('creates tool-1..N for brand new blobs, largest first', () => {
    const d = detection([blob(50, 50, 80), blob(150, 50, 10), blob(50, 150, 30)])
    const tools = reconcileTools([], d, { minAreaMm2: 5, removed: [] })
    expect(tools.map((t) => t.name)).toEqual(['tool-1', 'tool-2', 'tool-3'])
    // sorted by area desc
    expect(tools.map((t) => t.areaMm2)).toEqual([6400, 900, 100])
    for (const t of tools) {
      expect(t.source).toBe('auto')
      expect(t.edited).toBeNull()
      expect(t.components).toEqual([])
      expect(t.id).toBeTruthy()
    }
  })

  it('filters blobs below minAreaMm2', () => {
    const d = detection([blob(50, 50, 80), blob(150, 50, 2)])
    const tools = reconcileTools([], d, { minAreaMm2: 25, removed: [] })
    expect(tools.map((t) => t.name)).toEqual(['tool-1'])
  })

  it('keeps name/edited/components across re-detection when the blob centroid moves slightly', () => {
    const first = detection([blob(50, 50, 80)])
    const initial = reconcileTools([], first, { minAreaMm2: 5, removed: [] })
    expect(initial).toHaveLength(1)

    const renamed: Tool = {
      ...initial[0],
      name: 'my-knife',
      edited: square(50, 50, 82),
      components: [component()],
    }

    // Slightly shifted blob on re-detection (still contains the old centroid).
    const second = detection([blob(52, 51, 80)])
    const after = reconcileTools([renamed], second, { minAreaMm2: 5, removed: [] })

    expect(after).toHaveLength(1)
    expect(after[0].id).toBe(renamed.id)
    expect(after[0].name).toBe('my-knife')
    expect(after[0].edited).toEqual(square(50, 50, 82))
    expect(after[0].components).toEqual([component()])
    // polygon/bbox/centroid/areaMm2 come from the *new* blob, not stale data
    expect(after[0].centroid).toEqual({ x: 52, y: 51 })
  })

  it('drops a tool whose blob polygon contains a removed point', () => {
    const d = detection([blob(50, 50, 80), blob(150, 50, 30)])
    const first = reconcileTools([], d, { minAreaMm2: 5, removed: [] })
    expect(first).toHaveLength(2)

    const removedPoint = { x: 150, y: 50 } // inside the second blob
    const after = reconcileTools(first, d, { minAreaMm2: 5, removed: [removedPoint] })
    expect(after).toHaveLength(1)
    expect(after[0].areaMm2).toBe(6400)
  })

  it('keeps pick tools seated on whichever blob now contains the pick point, bypassing minAreaMm2', () => {
    const pickTool: Tool = {
      id: 'pick-1',
      name: 'tiny-part',
      source: 'pick',
      pick: { x: 150, y: 50 },
      polygon: square(150, 50, 5),
      bbox: { x: 147.5, y: 47.5, w: 5, h: 5 },
      areaMm2: 25,
      centroid: { x: 150, y: 50 },
      edited: null,
      components: [],
    }

    // The tiny blob under the pick point is far below the min area, and
    // there's one large auto-detected blob too.
    const d = detection([blob(50, 50, 80), blob(150, 50, 5)])
    const after = reconcileTools([pickTool], d, { minAreaMm2: 100, removed: [] })

    expect(after).toHaveLength(2)
    const pick = after.find((t) => t.source === 'pick')
    expect(pick).toBeDefined()
    expect(pick?.id).toBe('pick-1')
    expect(pick?.name).toBe('tiny-part')
    expect(pick?.pick).toEqual({ x: 150, y: 50 })

    const auto = after.find((t) => t.source === 'auto')
    expect(auto).toBeDefined()
    expect(auto?.name).toBe('tool-1')
  })

  it('drops a pick tool when no blob contains its pick point any more', () => {
    const pickTool: Tool = {
      id: 'pick-1',
      name: 'tiny-part',
      source: 'pick',
      pick: { x: 150, y: 50 },
      polygon: square(150, 50, 5),
      bbox: { x: 147.5, y: 47.5, w: 5, h: 5 },
      areaMm2: 25,
      centroid: { x: 150, y: 50 },
      edited: null,
      components: [],
    }
    const d = detection([blob(50, 50, 80)]) // no blob near (150, 50) any more
    const after = reconcileTools([pickTool], d, { minAreaMm2: 5, removed: [] })
    expect(after).toHaveLength(1)
    expect(after[0].source).toBe('auto')
  })

  it('does not reuse a tool-N number already taken by a carried-over tool', () => {
    const first = detection([blob(50, 50, 80), blob(150, 50, 30)])
    const initial = reconcileTools([], first, { minAreaMm2: 5, removed: [] })
    expect(initial.map((t) => t.name)).toEqual(['tool-1', 'tool-2'])

    // Remove the first tool's metadata carry-over by shifting its blob far
    // away (so it becomes "new" again) while keeping tool-2 in place, plus
    // adding a third blob.
    const second = detection([blob(500, 500, 80), blob(150, 50, 30), blob(50, 150, 40)])
    const after = reconcileTools(initial, second, { minAreaMm2: 5, removed: [] })

    // tool-2 (area 900) survives by centroid match; the other two are new
    // and must not reuse "tool-2".
    const names = after.map((t) => t.name)
    expect(names).toContain('tool-2')
    expect(new Set(names).size).toBe(names.length)
  })
})

describe('defaultComponentName', () => {
  it('returns part-1 for a tool with no components', () => {
    const tool: Tool = {
      id: 't1',
      name: 'tool-1',
      source: 'auto',
      polygon: square(0, 0, 10),
      bbox: { x: -5, y: -5, w: 10, h: 10 },
      areaMm2: 100,
      centroid: { x: 0, y: 0 },
      edited: null,
      components: [],
    }
    expect(defaultComponentName(tool)).toBe('part-1')
  })

  it('skips numbers already used by existing components', () => {
    const tool: Tool = {
      id: 't1',
      name: 'tool-1',
      source: 'auto',
      polygon: square(0, 0, 10),
      bbox: { x: -5, y: -5, w: 10, h: 10 },
      areaMm2: 100,
      centroid: { x: 0, y: 0 },
      edited: null,
      components: [component({ name: 'part-1' }), component({ name: 'part-2' })],
    }
    expect(defaultComponentName(tool)).toBe('part-3')
  })
})
