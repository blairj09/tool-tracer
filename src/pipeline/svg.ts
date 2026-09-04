// Pure SVG serialization. Coordinates are in millimetres and the SVG
// document uses `width="…mm" height="…mm"` so it opens at true physical
// scale in any viewer that respects CSS units, with a matching `viewBox` in
// mm user units.
import type { Polygon } from './types'

function round3(n: number): number {
  return Math.round(n * 1000) / 1000
}

function escapeXml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;')
}

export function polygonToPath(p: Polygon): string {
  if (p.length === 0) return ''
  const pts = p.map((pt) => `${round3(pt.x)},${round3(pt.y)}`)
  return `M ${pts.join(' L ')} Z`
}

export function toSvg(opts: {
  outline: Polygon
  clearance?: Polygon
  widthMm: number
  heightMm: number
  name?: string
}): string {
  const w = round3(opts.widthMm)
  const h = round3(opts.heightMm)

  const parts: string[] = []
  parts.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}mm" height="${h}mm" viewBox="0 0 ${w} ${h}">`)
  if (opts.name) parts.push(`<title>${escapeXml(opts.name)}</title>`)
  parts.push(`<g id="outline"><path d="${polygonToPath(opts.outline)}" fill="none" stroke="#000" stroke-width="0.1"/></g>`)
  if (opts.clearance) {
    parts.push(
      `<g id="clearance"><path d="${polygonToPath(opts.clearance)}" fill="none" stroke="#0074d9" stroke-width="0.1"/></g>`,
    )
  }
  parts.push('</svg>')
  return parts.join('')
}
