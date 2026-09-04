// Shared colour palette for tools, indexed by position in the tools list.
// Imported by App, Viewer, and ArrangeCanvas so all three views agree on
// which colour belongs to which tool.
const PALETTE = [
  '#d32f2f', // red (matches the v1 single-outline colour)
  '#1258c4', // blue
  '#2e7d32', // green
  '#e65100', // orange
  '#6a1b9a', // purple
  '#00838f', // teal
  '#ad1457', // pink
  '#9e9d24', // olive
]

export function colourForIndex(i: number): string {
  return PALETTE[i % PALETTE.length]
}
