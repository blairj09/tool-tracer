import { describe, expect, it } from 'vitest'
import { polygonToPath, toSvg } from '../src/pipeline/svg'
import type { ExportedTool, Polygon } from '../src/pipeline/types'

const square: Polygon = [
  { x: 0, y: 0 },
  { x: 10, y: 0 },
  { x: 10, y: 10 },
  { x: 0, y: 10 },
]

function tool(overrides: Partial<ExportedTool> = {}): ExportedTool {
  return {
    id: 'knife',
    name: 'Knife',
    outline: square,
    centroid: { x: 5, y: 5 },
    components: [],
    ...overrides,
  }
}

describe('polygonToPath', () => {
  it('builds a closed M...L...Z path', () => {
    expect(polygonToPath(square)).toBe('M 0,0 L 10,0 L 10,10 L 0,10 Z')
  })

  it('rounds to 3 decimals', () => {
    const p: Polygon = [
      { x: 1.23456, y: 2.98765 },
      { x: 3, y: 4 },
      { x: 5, y: 6 },
    ]
    expect(polygonToPath(p)).toBe('M 1.235,2.988 L 3,4 L 5,6 Z')
  })

  it('returns empty string for an empty polygon', () => {
    expect(polygonToPath([])).toBe('')
  })
})

describe('toSvg', () => {
  it('sets width/height in mm and a matching viewBox', () => {
    const svg = toSvg({ tools: [tool()], widthMm: 100, heightMm: 50 })
    expect(svg).toContain('width="100mm"')
    expect(svg).toContain('height="50mm"')
    expect(svg).toContain('viewBox="0 0 100 50"')
    expect(svg).toContain('<g id="knife">')
    expect(svg).toContain('<path id="knife-outline"')
    expect(svg).not.toContain('knife-clearance')
  })

  it('includes a clearance path when provided', () => {
    const clearance: Polygon = [
      { x: -1, y: -1 },
      { x: 11, y: -1 },
      { x: 11, y: 11 },
      { x: -1, y: 11 },
    ]
    const svg = toSvg({ tools: [tool({ clearance })], widthMm: 20, heightMm: 20 })
    expect(svg).toContain('<path id="knife-outline"')
    expect(svg).toContain('<path id="knife-clearance"')
    expect(svg).toContain('#0074d9')
  })

  it('includes a <title> when a title is given', () => {
    const svg = toSvg({ tools: [tool()], widthMm: 10, heightMm: 10, title: 'My Tool' })
    expect(svg).toContain('<title>My Tool</title>')
  })

  it('escapes XML special characters in the title', () => {
    const svg = toSvg({ tools: [tool()], widthMm: 10, heightMm: 10, title: 'A & B <C>' })
    expect(svg).toContain('<title>A &amp; B &lt;C&gt;</title>')
  })

  it('is well-formed enough to start with <svg and end with </svg>', () => {
    const svg = toSvg({ tools: [tool()], widthMm: 10, heightMm: 10 })
    expect(svg.startsWith('<svg')).toBe(true)
    expect(svg.endsWith('</svg>')).toBe(true)
  })

  it('nests components inside their tool group, and omits an empty components group', () => {
    const svgNoComponents = toSvg({ tools: [tool()], widthMm: 10, heightMm: 10 })
    expect(svgNoComponents).not.toContain('knife-components')

    const withComponents = toSvg({
      tools: [
        tool({
          components: [
            { id: 'knife-clip', name: 'clip', outline: square },
            {
              id: 'knife-clip2',
              name: 'clip2',
              outline: square,
              clearance: square,
            },
          ],
        }),
      ],
      widthMm: 10,
      heightMm: 10,
    })
    expect(withComponents).toContain('<g id="knife-components">')
    expect(withComponents).toContain('<path id="knife-clip"')
    expect(withComponents).toContain('<path id="knife-clip2"')
    expect(withComponents).toContain('<path id="knife-clip2-clearance"')
    expect(withComponents).toContain('#2e7d32')
    expect(withComponents).toContain('#7cb342')
    // component group must be nested inside the tool's own group
    const toolGroupStart = withComponents.indexOf('<g id="knife">')
    const componentsGroupStart = withComponents.indexOf('<g id="knife-components">')
    const toolGroupEnd = withComponents.lastIndexOf('</g></g>')
    expect(componentsGroupStart).toBeGreaterThan(toolGroupStart)
    expect(componentsGroupStart).toBeLessThan(toolGroupEnd + 8)
  })

  it('renders multiple tool groups and dedupes duplicate ids', () => {
    const svg = toSvg({
      tools: [tool({ id: 'tool-1', name: 'a' }), tool({ id: 'tool-1-2', name: 'a' })],
      widthMm: 10,
      heightMm: 10,
    })
    expect(svg).toContain('<g id="tool-1">')
    expect(svg).toContain('<g id="tool-1-2">')
  })
})
