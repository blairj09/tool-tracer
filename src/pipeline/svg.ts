// Pure SVG serialization. Coordinates are in millimetres and the SVG
// document uses `width="…mm" height="…mm"` so it opens at true physical
// scale in any viewer that respects CSS units, with a matching `viewBox` in
// mm user units.
import type { ExportedTool, Polygon } from './types'

export function round3(n: number): number {
  return Math.round(n * 1000) / 1000
}

export function escapeXml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;')
}

export function polygonToPath(p: Polygon): string {
  if (p.length === 0) return ''
  const pts = p.map((pt) => `${round3(pt.x)},${round3(pt.y)}`)
  return `M ${pts.join(' L ')} Z`
}

/**
 * Serialize the combined multi-tool export. Each tool becomes a group
 * `<g id="{tool.id}">` containing its outline (`{tool.id}-outline`) and
 * optional clearance (`{tool.id}-clearance`) paths, plus a nested
 * `<g id="{tool.id}-components">` (omitted when the tool has none) holding
 * each component's outline (`{component.id}`) and optional clearance
 * (`{component.id}-clearance`). All paths are `fill="none"
 * stroke-width="0.1"`; ids are assumed already slugified/deduped (see
 * `exportTools` in run.ts).
 */
export function toSvg(opts: { tools: ExportedTool[]; widthMm: number; heightMm: number; title?: string }): string {
  const w = round3(opts.widthMm)
  const h = round3(opts.heightMm)

  const parts: string[] = []
  parts.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}mm" height="${h}mm" viewBox="0 0 ${w} ${h}">`)
  if (opts.title) parts.push(`<title>${escapeXml(opts.title)}</title>`)

  for (const tool of opts.tools) {
    parts.push(`<g id="${tool.id}">`)
    parts.push(
      `<path id="${tool.id}-outline" d="${polygonToPath(tool.outline)}" fill="none" stroke="#000" stroke-width="0.1"/>`,
    )
    if (tool.clearance) {
      parts.push(
        `<path id="${tool.id}-clearance" d="${polygonToPath(tool.clearance)}" fill="none" stroke="#0074d9" stroke-width="0.1"/>`,
      )
    }
    if (tool.components.length > 0) {
      parts.push(`<g id="${tool.id}-components">`)
      for (const comp of tool.components) {
        parts.push(`<path id="${comp.id}" d="${polygonToPath(comp.outline)}" fill="none" stroke="#2e7d32" stroke-width="0.1"/>`)
        if (comp.clearance) {
          parts.push(
            `<path id="${comp.id}-clearance" d="${polygonToPath(comp.clearance)}" fill="none" stroke="#7cb342" stroke-width="0.1"/>`,
          )
        }
      }
      parts.push('</g>')
    }
    parts.push('</g>')
  }

  parts.push('</svg>')
  return parts.join('')
}
