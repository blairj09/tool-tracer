// Builds the printable template as a raw SVG string. The SVG is sized in
// real millimetres (width/height + viewBox in mm units) so that printing at
// 100% scale produces a physically accurate page. Marker geometry comes from
// layout.ts so the rendered page and the detection/rectification pipeline
// always agree on where the markers are.
import { markerLayouts, workingArea, MARKER_SIZE_MM, PAPER, type PaperSize } from './layout'

export interface TemplateSvgOptions {
  paper: PaperSize
  bits: Record<number, boolean[][]>
  scale?: number
}

const MARKER_FOOTER_TEXT =
  'ToolTrace template — print at 100% (Actual size), do not fit to page. Marker IDs 0–3 (DICT_4X4_50)'

export function templateSvg(opts: TemplateSvgOptions): string {
  const { paper, bits, scale = 1 } = opts
  const { w: W, h: H } = PAPER[paper]
  const layouts = markerLayouts(paper, scale)
  const area = workingArea(paper, scale)

  // Each marker's black cells are merged into a single <path> (one filled
  // subpath per cell) rather than adjacent <rect>s: adjacent rects can leave
  // hairline gaps on screen (and faint printed lines) due to sub-pixel
  // rounding, even though the underlying geometry is seamless. Overlapping
  // each cell by a hair (0.01mm per side) and forcing crisp-edge rendering
  // eliminates that without visibly changing the marker's printed size.
  const CELL_OVERLAP_MM = 0.01
  const markerRects = layouts
    .map((layout) => {
      const grid = bits[layout.id]
      if (!grid) return ''
      const gridSize = grid.length
      const markerSizeMm = MARKER_SIZE_MM * scale
      const cell = markerSizeMm / gridSize
      const overlap = CELL_OVERLAP_MM * scale
      const side = cell + 2 * overlap
      const originX = layout.corners[0].x
      const originY = layout.corners[0].y
      const subpaths: string[] = []
      for (let row = 0; row < gridSize; row++) {
        for (let col = 0; col < gridSize; col++) {
          if (!grid[row][col]) continue
          const x = originX + col * cell - overlap
          const y = originY + row * cell - overlap
          subpaths.push(`M${fmt(x)} ${fmt(y)} h${fmt(side)} v${fmt(side)} h${fmt(-side)} z`)
        }
      }
      if (subpaths.length === 0) return ''
      return `<g data-marker-id="${layout.id}" fill="#000" shape-rendering="crispEdges"><path d="${subpaths.join(' ')}"/></g>`
    })
    .join('')

  // 100mm scale bar centered horizontally, sitting near the bottom of the
  // working area so it doesn't overlap wherever the tool gets placed.
  const barLenMm = 100 * scale
  const barY = area.y + area.h - 12 * scale
  const barX0 = area.x + (area.w - barLenMm) / 2
  const barX1 = barX0 + barLenMm
  const tick = 3 * scale
  const scaleBar = `
    <g stroke="#333" stroke-width="${fmt(0.3 * scale)}" fill="none">
      <line x1="${fmt(barX0)}" y1="${fmt(barY)}" x2="${fmt(barX1)}" y2="${fmt(barY)}"/>
      <line x1="${fmt(barX0)}" y1="${fmt(barY - tick / 2)}" x2="${fmt(barX0)}" y2="${fmt(barY + tick / 2)}"/>
      <line x1="${fmt(barX1)}" y1="${fmt(barY - tick / 2)}" x2="${fmt(barX1)}" y2="${fmt(barY + tick / 2)}"/>
    </g>
    <text x="${fmt((barX0 + barX1) / 2)}" y="${fmt(barY - 2 * scale)}" font-size="${fmt(3.2 * scale)}" fill="#333" text-anchor="middle" font-family="sans-serif">100 mm</text>
  `

  const footer = `<text x="${fmt(W / 2)}" y="${fmt(H - 3)}" font-size="2.6" fill="#666" text-anchor="middle" font-family="sans-serif">${escapeXml(MARKER_FOOTER_TEXT)}</text>`

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}mm" height="${H}mm" viewBox="0 0 ${W} ${H}">
    <rect x="0" y="0" width="${W}" height="${H}" fill="#fff"/>
    <rect x="${fmt(area.x)}" y="${fmt(area.y)}" width="${fmt(area.w)}" height="${fmt(area.h)}" fill="none" stroke="#bbb" stroke-width="0.2"/>
    ${markerRects}
    ${scaleBar}
    ${footer}
  </svg>`
}

function fmt(n: number): string {
  return Number(n.toFixed(3)).toString()
}

function escapeXml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}
