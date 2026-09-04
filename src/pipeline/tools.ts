// Pure reconciliation of the UI's `Tool[]` list against a fresh
// `DetectionResult` (new photo, re-run params, or a rectified image that
// changed). No OpenCV dependency — this only touches polygons.
import { pointInPolygon } from './align'
import type { Blob, DetectionResult, Pt, Tool } from './types'

function usedToolNumbers(tools: Tool[]): Set<number> {
  const used = new Set<number>()
  for (const t of tools) {
    const m = /^tool-(\d+)$/.exec(t.name)
    if (m) used.add(Number(m[1]))
  }
  return used
}

function nextNumber(used: Set<number>): number {
  let n = 1
  while (used.has(n)) n++
  used.add(n)
  return n
}

/**
 * Reconcile the previous `Tool[]` against a new detection: re-seat every
 * still-picked "pick" tool on whichever blob now contains its pick point
 * (dropping it if none does), pick up every blob at/above `minAreaMm2`
 * that isn't under a `removed` point as an "auto" tool, and carry over
 * per-tool metadata (id, name, edited, components) from whichever previous
 * tool matches by centroid. Brand new tools get a fresh id and the next
 * unused `tool-N` name. Result is sorted by area, largest first (pick
 * tools included in that ordering, not segregated).
 */
export function reconcileTools(prev: Tool[], detection: DetectionResult, opts: { minAreaMm2: number; removed: Pt[] }): Tool[] {
  const claimed = new Set<Tool>()

  // Pick tools keep their identity; they're re-seated on whichever blob
  // now contains their pick point, regardless of minAreaMm2.
  const pickAssignments = new Map<Blob, Tool>()
  for (const p of prev) {
    if (p.source !== 'pick' || !p.pick) continue
    const blob = detection.blobs.find((b) => pointInPolygon(p.pick as Pt, b.polygon))
    if (blob && !pickAssignments.has(blob)) {
      pickAssignments.set(blob, p)
      claimed.add(p)
    }
  }

  const autoBlobs = detection.blobs.filter((b) => {
    if (pickAssignments.has(b)) return false
    if (b.areaMm2 < opts.minAreaMm2) return false
    if (opts.removed.some((r) => pointInPolygon(r, b.polygon))) return false
    return true
  })

  // Remaining previous tools are candidates for carrying metadata over to
  // an auto blob, matched by centroid (each prev tool claimed at most once).
  const pool = prev.filter((p) => !claimed.has(p))

  function claimMatch(blob: Blob): Tool | undefined {
    let match = pool.find((p) => !claimed.has(p) && pointInPolygon(p.centroid, blob.polygon))
    if (!match) {
      let bestDist = Infinity
      for (const p of pool) {
        if (claimed.has(p)) continue
        const d = Math.hypot(p.centroid.x - blob.centroid.x, p.centroid.y - blob.centroid.y)
        if (d <= 10 && d < bestDist) {
          bestDist = d
          match = p
        }
      }
    }
    if (match) claimed.add(match)
    return match
  }

  const matches = new Map<Blob, Tool | undefined>()
  for (const blob of autoBlobs) matches.set(blob, claimMatch(blob))

  // Reserve tool-N numbers already in use by every tool that survives this
  // pass (pick tools + matched auto tools) so brand-new tools never collide.
  const survivors = [...prev.filter((p) => claimed.has(p))]
  const reserved = usedToolNumbers(survivors)

  const results: Tool[] = []

  for (const [blob, prevTool] of pickAssignments) {
    results.push({
      id: prevTool.id,
      name: prevTool.name,
      source: 'pick',
      pick: prevTool.pick,
      polygon: blob.polygon,
      bbox: blob.bbox,
      areaMm2: blob.areaMm2,
      centroid: blob.centroid,
      edited: prevTool.edited,
      components: prevTool.components,
    })
  }

  for (const blob of autoBlobs) {
    const match = matches.get(blob)
    if (match) {
      results.push({
        id: match.id,
        name: match.name,
        source: 'auto',
        pick: undefined,
        polygon: blob.polygon,
        bbox: blob.bbox,
        areaMm2: blob.areaMm2,
        centroid: blob.centroid,
        edited: match.edited,
        components: match.components,
      })
    } else {
      const n = nextNumber(reserved)
      results.push({
        id: crypto.randomUUID(),
        name: `tool-${n}`,
        source: 'auto',
        pick: undefined,
        polygon: blob.polygon,
        bbox: blob.bbox,
        areaMm2: blob.areaMm2,
        centroid: blob.centroid,
        edited: null,
        components: [],
      })
    }
  }

  results.sort((a, b) => b.areaMm2 - a.areaMm2)
  return results
}

/** Smallest-numbered unused `part-N` name for a new component on `tool`. */
export function defaultComponentName(tool: Tool): string {
  const used = new Set<number>()
  for (const c of tool.components) {
    const m = /^part-(\d+)$/.exec(c.name)
    if (m) used.add(Number(m[1]))
  }
  let n = 1
  while (used.has(n)) n++
  return `part-${n}`
}
