import { describe, expect, it } from 'vitest'
import { polygonToPath, toSvg } from '../src/pipeline/svg'
import type { Polygon } from '../src/pipeline/types'

const square: Polygon = [
  { x: 0, y: 0 },
  { x: 10, y: 0 },
  { x: 10, y: 10 },
  { x: 0, y: 10 },
]

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
    const svg = toSvg({ outline: square, widthMm: 100, heightMm: 50 })
    expect(svg).toContain('width="100mm"')
    expect(svg).toContain('height="50mm"')
    expect(svg).toContain('viewBox="0 0 100 50"')
    expect(svg).toContain('<g id="outline">')
    expect(svg).not.toContain('<g id="clearance">')
  })

  it('includes a clearance group when provided', () => {
    const clearance: Polygon = [
      { x: -1, y: -1 },
      { x: 11, y: -1 },
      { x: 11, y: 11 },
      { x: -1, y: 11 },
    ]
    const svg = toSvg({ outline: square, clearance, widthMm: 20, heightMm: 20 })
    expect(svg).toContain('<g id="outline">')
    expect(svg).toContain('<g id="clearance">')
    expect(svg).toContain('#0074d9')
  })

  it('includes a <title> when a name is given', () => {
    const svg = toSvg({ outline: square, widthMm: 10, heightMm: 10, name: 'My Tool' })
    expect(svg).toContain('<title>My Tool</title>')
  })

  it('escapes XML special characters in the name', () => {
    const svg = toSvg({ outline: square, widthMm: 10, heightMm: 10, name: 'A & B <C>' })
    expect(svg).toContain('<title>A &amp; B &lt;C&gt;</title>')
  })

  it('is well-formed enough to start with <svg and end with </svg>', () => {
    const svg = toSvg({ outline: square, widthMm: 10, heightMm: 10 })
    expect(svg.startsWith('<svg')).toBe(true)
    expect(svg.endsWith('</svg>')).toBe(true)
  })
})
