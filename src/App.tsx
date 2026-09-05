import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import TemplatePage from './template/TemplatePage'
import Dock from './components/Dock'
import Viewer from './components/Viewer'
import ArrangeCanvas, { type ArrangeItem } from './components/ArrangeCanvas'
import { colourForIndex } from './components/palette'
import type { PhotoResult, UiMode } from './components/types'
import { loadCv, type CV } from './cv/loadCv'
import type { PaperSize } from './template/layout'
import { getPrinterScale } from './template/calibration'
import { Box } from './lib/box'
import { autoAlignAngleDeg, bbox, polygonArea } from './pipeline/align'
import {
  DEFAULT_COMPONENT_PARAMS,
  DEFAULT_OUTLINE_PARAMS,
  IDENTITY,
  type CanvasMode,
  type ComponentParams,
  type DetectionResult,
  type ExportOptions,
  type ExportResult,
  type OutlineParams,
  type Polygon,
  type Pt,
  type Rectified,
  type Tool,
  type ToolComponent,
  type ToolExportInput,
  type Transform,
} from './pipeline/types'
import { processPhoto, exportTools, downloadSvg, copyText } from './pipeline/run'
import { detectBlobs } from './pipeline/outline'
import { extractComponent } from './pipeline/component'
import { reconcileTools, defaultComponentName } from './pipeline/tools'
import { manualRectify } from './pipeline/manualScale'

const PAPER_STORAGE_KEY = 'tooltrace.paper'

function readInitialView(): boolean {
  if (typeof window === 'undefined') return false
  const params = new URLSearchParams(window.location.search)
  return params.get('view') === 'template'
}

function readInitialPaper(): PaperSize {
  if (typeof window === 'undefined') return 'letter'
  try {
    const raw = localStorage.getItem(PAPER_STORAGE_KEY)
    if (raw === 'letter' || raw === 'a4') return raw
  } catch {
    // ignore
  }
  return 'letter'
}

const DEFAULT_EXPORT_OPTS: ExportOptions = {
  clearanceMm: 0.5,
  marginMm: 5,
  name: 'tools',
  canvas: { mode: 'auto' },
}

function nextToolName(tools: Tool[]): string {
  const used = new Set<number>()
  for (const t of tools) {
    const m = /^tool-(\d+)$/.exec(t.name)
    if (m) used.add(Number(m[1]))
  }
  let n = 1
  while (used.has(n)) n++
  return `tool-${n}`
}

function normalizeAngle(deg: number): number {
  const wrapped = deg % 360
  return wrapped < 0 ? wrapped + 360 : wrapped
}

// Cleanup slider <-> outline params mapping. A single slider (0-3, default
// 1.0) drives three independent pipeline params at fixed ratios; the panel
// shows "custom" once the Advanced fields have been edited away from that
// ratio (compared with an epsilon since float multiplication of the stored
// `cleanup` value won't round-trip exactly).
const CLEANUP_RATIOS = { blurMm: 0.3, openMm: 0.5, closeMm: 1.0 } as const

function cleanupToParams(cleanup: number): Pick<OutlineParams, 'blurMm' | 'openMm' | 'closeMm'> {
  return {
    blurMm: CLEANUP_RATIOS.blurMm * cleanup,
    openMm: CLEANUP_RATIOS.openMm * cleanup,
    closeMm: CLEANUP_RATIOS.closeMm * cleanup,
  }
}

function isCleanupCustom(params: OutlineParams, cleanup: number): boolean {
  const expected = cleanupToParams(cleanup)
  const eps = 1e-6
  return (
    Math.abs(params.blurMm - expected.blurMm) > eps ||
    Math.abs(params.openMm - expected.openMm) > eps ||
    Math.abs(params.closeMm - expected.closeMm) > eps
  )
}

function App() {
  const [showTemplate, setShowTemplate] = useState<boolean>(readInitialView)
  const [paper, setPaper] = useState<PaperSize>(readInitialPaper)

  const [cv, setCv] = useState<CV | null>(null)
  const [cvStatus, setCvStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [cvError, setCvError] = useState<string | null>(null)

  const [file, setFile] = useState<File | null>(null)
  const [busy, setBusy] = useState(false)
  const [photo, setPhoto] = useState<PhotoResult | null>(null)
  const [processError, setProcessError] = useState<string | null>(null)

  const [rectified, setRectified] = useState<Rectified | null>(null)

  const [manualActive, setManualActive] = useState(false)
  const [manualPoints, setManualPoints] = useState<Pt[]>([])
  const [manualDistanceMm, setManualDistanceMm] = useState(100)
  const [manualError, setManualError] = useState<string | null>(null)

  const [outlineParams, setOutlineParams] = useState<OutlineParams>(DEFAULT_OUTLINE_PARAMS)
  const [cleanup, setCleanup] = useState(1.0)
  const [detection, setDetection] = useState<DetectionResult | null>(null)
  const [detectionError, setDetectionError] = useState<string | null>(null)
  const [showMask, setShowMask] = useState(false)

  const [tools, setTools] = useState<Tool[]>([])
  const [removed, setRemoved] = useState<Pt[]>([])
  const [selection, setSelection] = useState<{ toolId: string; componentId?: string } | null>(null)
  const [mode, setMode] = useState<UiMode>('select')
  const [draft, setDraft] = useState<Pt[]>([])
  const [componentErrors, setComponentErrors] = useState<Record<string, string>>({})

  const [layout, setLayout] = useState<Record<string, Transform>>({})
  const [gridSnap, setGridSnap] = useState(false)
  // Bumped whenever the user explicitly resets the arrangement, so the
  // arrange pane's zoom/pan also snaps back to fit.
  const [arrangeResetSignal, setArrangeResetSignal] = useState(0)

  const [exportOpts, setExportOpts] = useState<ExportOptions>(DEFAULT_EXPORT_OPTS)
  const [exportResult, setExportResult] = useState<ExportResult | null>(null)
  const [exportError, setExportError] = useState<string | null>(null)
  const [copyStatus, setCopyStatus] = useState<string | null>(null)

  useEffect(() => {
    try {
      localStorage.setItem(PAPER_STORAGE_KEY, paper)
    } catch {
      // ignore (private browsing / storage disabled)
    }
  }, [paper])

  useEffect(() => {
    let cancelled = false
    loadCv()
      .then((loaded) => {
        if (cancelled) return
        setCv(loaded)
        setCvStatus('ready')
      })
      .catch((err: unknown) => {
        if (cancelled) return
        setCvStatus('error')
        setCvError(err instanceof Error ? err.message : String(err))
      })
    return () => {
      cancelled = true
    }
  }, [])

  const resetDerived = useCallback(() => {
    setRectified(null)
    setManualActive(false)
    setManualPoints([])
    setManualError(null)
    setDetection(null)
    setDetectionError(null)
    setTools([])
    setRemoved([])
    setSelection(null)
    setMode('select')
    setDraft([])
    setComponentErrors({})
    setLayout({})
    setExportResult(null)
    setExportError(null)
  }, [])

  const handleFile = useCallback(
    async (chosen: File) => {
      if (!cv) return
      setFile(chosen)
      setPhoto(null)
      setProcessError(null)
      resetDerived()
      setBusy(true)
      // Yield to the event loop so the busy indicator paints before the
      // synchronous, CPU-heavy OpenCV work runs.
      await new Promise((resolve) => setTimeout(resolve))
      try {
        const result = await processPhoto(cv, chosen, paper, getPrinterScale())
        setPhoto(result)
        if (result.rectified) setRectified(result.rectified)
      } catch (err) {
        setProcessError(err instanceof Error ? err.message : String(err))
      } finally {
        setBusy(false)
      }
    },
    [cv, paper, resetDerived],
  )

  const handleCleanupChange = useCallback((v: number) => {
    setCleanup(v)
    setOutlineParams((prev) => ({ ...prev, ...cleanupToParams(v) }))
  }, [])

  const handleUseManual = useCallback(() => {
    resetDerived()
    setManualActive(true)
  }, [resetDerived])

  const handleClickPx = useCallback(
    (pt: Pt) => {
      if (!manualActive || rectified) return
      setManualPoints((prev) => (prev.length >= 2 ? [pt] : [...prev, pt]))
    },
    [manualActive, rectified],
  )

  const handleApplyManual = useCallback(() => {
    if (!cv || !photo || manualPoints.length < 2) return
    try {
      const result = manualRectify(cv, photo.image, manualPoints[0], manualPoints[1], manualDistanceMm, paper)
      setRectified(result)
      setManualError(null)
    } catch (err) {
      setManualError(err instanceof Error ? err.message : String(err))
    }
  }, [cv, photo, manualPoints, manualDistanceMm, paper])

  // Recompute blob detection whenever the rectified image or outline
  // params change, debounced so dragging a slider doesn't re-run OpenCV on
  // every intermediate value.
  useEffect(() => {
    if (!cv || !rectified) {
      setDetection(null)
      setDetectionError(null)
      return
    }
    const handle = setTimeout(() => {
      try {
        const result = detectBlobs(cv, rectified, outlineParams)
        setDetection(result)
        setDetectionError(null)
      } catch (err) {
        setDetection(null)
        setDetectionError(err instanceof Error ? err.message : String(err))
      }
    }, 150)
    return () => clearTimeout(handle)
  }, [cv, rectified, outlineParams])

  // Reconcile the tools list against the latest detection (new blobs,
  // removed points, or a changed min-area threshold). Tool identity (id,
  // name, edits, components) is preserved across re-detection by
  // reconcileTools itself.
  useEffect(() => {
    if (!detection) {
      setTools([])
      return
    }
    setTools((prev) => reconcileTools(prev, detection, { minAreaMm2: outlineParams.minAreaMm2, removed }))
  }, [detection, removed, outlineParams.minAreaMm2])

  // Keep `selection` pointing at a real tool/component; repair it whenever
  // the tools list changes (removal, re-detection dropping a pick tool,
  // component removal). Functional update + reference equality bail-out
  // keeps this loop-safe.
  useEffect(() => {
    setSelection((prev) => {
      if (tools.length === 0) return prev === null ? prev : null
      const tool = prev ? tools.find((t) => t.id === prev.toolId) : undefined
      if (!tool) return { toolId: tools[0].id }
      if (prev!.componentId && !tool.components.some((c) => c.id === prev!.componentId)) {
        return { toolId: tool.id }
      }
      return prev
    })
  }, [tools])

  // Recompute every 'auto' component whose parent effective polygon, seed,
  // or params changed since the last run. Gated on a per-component
  // signature (ref, not deep-equal) so this settles instead of looping:
  // writing a recomputed polygon back into `tools` changes the `tools`
  // array/tool-object identity but leaves the parent's polygon/edited
  // array references untouched, so the signature is unchanged next pass.
  const autoSignaturesRef = useRef(new Map<string, string>())
  const polyIdsRef = useRef(new WeakMap<object, number>())
  const polyIdCounterRef = useRef(0)
  function polyKey(poly: Polygon): number {
    let id = polyIdsRef.current.get(poly)
    if (id === undefined) {
      id = ++polyIdCounterRef.current
      polyIdsRef.current.set(poly, id)
    }
    return id
  }

  useEffect(() => {
    if (!cv || !rectified) return
    const autoSignatures = autoSignaturesRef.current
    type Update = { toolId: string; componentId: string; polygon?: Polygon; error?: string }
    const updates: Update[] = []
    for (const tool of tools) {
      const parentPolygon = tool.edited ?? tool.polygon
      for (const comp of tool.components) {
        if (comp.source !== 'auto' || !comp.seed) continue
        const key = `${tool.id}:${comp.id}`
        const sig = `${polyKey(parentPolygon)}|${comp.seed.x}:${comp.seed.y}|${JSON.stringify(comp.params)}`
        if (autoSignatures.get(key) === sig) continue
        autoSignatures.set(key, sig)
        try {
          const polygon = extractComponent(cv, rectified, parentPolygon, comp.seed, comp.params)
          updates.push({ toolId: tool.id, componentId: comp.id, polygon })
        } catch (err) {
          updates.push({ toolId: tool.id, componentId: comp.id, error: err instanceof Error ? err.message : String(err) })
        }
      }
    }
    if (updates.length === 0) return

    setTools((prev) =>
      prev.map((t) => {
        const relevant = updates.filter((u) => u.toolId === t.id && u.polygon)
        if (relevant.length === 0) return t
        return {
          ...t,
          components: t.components.map((c) => {
            const u = relevant.find((u) => u.componentId === c.id)
            return u && u.polygon ? { ...c, polygon: u.polygon } : c
          }),
        }
      }),
    )
    setComponentErrors((prev) => {
      let changed = false
      const next = { ...prev }
      for (const u of updates) {
        if (u.error) {
          if (next[u.componentId] !== u.error) {
            next[u.componentId] = u.error
            changed = true
          }
        } else if (next[u.componentId] !== undefined) {
          delete next[u.componentId]
          changed = true
        }
      }
      return changed ? next : prev
    })
    // Deliberately omits `autoSignaturesRef`/`polyIdsRef`/`polyIdCounterRef`
    // (refs; stable identity) and `polyKey` (a plain function of those
    // refs) from the dependency list — including them would just be noise.
  }, [cv, rectified, tools])

  // Recompute the combined export whenever the effective layout or export
  // options change, debounced like the detection effect above.
  useEffect(() => {
    if (!cv || tools.length === 0) {
      setExportResult(null)
      setExportError(null)
      return
    }
    const handle = setTimeout(() => {
      try {
        const inputs: ToolExportInput[] = tools.map((t) => ({
          name: t.name,
          polygon: t.edited ?? t.polygon,
          clearanceMm: exportOpts.clearanceMm,
          transform: layout[t.id] ?? IDENTITY,
          components: t.components.map((c) => ({
            name: c.name,
            polygon: c.edited ?? c.polygon,
            clearanceMm: c.clearanceMm,
          })),
        }))
        const result = exportTools(cv, inputs, exportOpts)
        setExportResult(result)
        setExportError(null)
      } catch (err) {
        setExportResult(null)
        setExportError(err instanceof Error ? err.message : String(err))
      }
    }, 150)
    return () => clearTimeout(handle)
  }, [cv, tools, layout, exportOpts])

  // --- Tools list -------------------------------------------------------

  const handleAddToolAt = useCallback(
    (pt: Pt) => {
      if (!detection) return
      const stub: Tool = {
        id: crypto.randomUUID(),
        name: nextToolName(tools),
        source: 'pick',
        pick: pt,
        polygon: [],
        bbox: { x: 0, y: 0, w: 0, h: 0 },
        areaMm2: 0,
        centroid: pt,
        edited: null,
        components: [],
      }
      const next = reconcileTools([...tools, stub], detection, { minAreaMm2: outlineParams.minAreaMm2, removed })
      setTools(next)
      if (next.some((t) => t.id === stub.id)) {
        setSelection({ toolId: stub.id })
        setMode('select')
      }
    },
    [tools, detection, outlineParams.minAreaMm2, removed],
  )

  const handleSelectTool = useCallback((toolId: string) => {
    setSelection({ toolId })
    setMode('select')
  }, [])

  const handleSelectComponent = useCallback((toolId: string, componentId: string) => {
    setSelection({ toolId, componentId })
  }, [])

  const handleRenameTool = useCallback((toolId: string, name: string) => {
    setTools((prev) => prev.map((t) => (t.id === toolId ? { ...t, name } : t)))
  }, [])

  const handleRemoveTool = useCallback(
    (toolId: string) => {
      const tool = tools.find((t) => t.id === toolId)
      if (!tool) return
      if (tool.source === 'auto') {
        setRemoved((prev) => [...prev, tool.centroid])
      }
      setTools((prev) => prev.filter((t) => t.id !== toolId))
      setLayout((prev) => {
        if (!(toolId in prev)) return prev
        const next = { ...prev }
        delete next[toolId]
        return next
      })
      const dropIds = new Set(tool.components.map((c) => c.id))
      setComponentErrors((prev) => {
        let changed = false
        const next = { ...prev }
        for (const id of Object.keys(next)) {
          if (dropIds.has(id)) {
            delete next[id]
            changed = true
          }
        }
        return changed ? next : prev
      })
    },
    [tools],
  )

  // --- Components ---------------------------------------------------

  const handleAddComponentFromPhoto = useCallback(() => {
    if (!selection) return
    setMode('seed')
  }, [selection])

  const handleAddComponentDraw = useCallback(() => {
    if (!selection) return
    setDraft([])
    setMode('draw')
  }, [selection])

  const handleSeedComponentAt = useCallback(
    (pt: Pt) => {
      if (!selection) return
      const tool = tools.find((t) => t.id === selection.toolId)
      if (!tool) return
      const parentPolygon = tool.edited ?? tool.polygon
      if (parentPolygon.length < 3) return
      const id = crypto.randomUUID()
      const newComponent: ToolComponent = {
        id,
        name: defaultComponentName(tool),
        source: 'auto',
        seed: pt,
        params: DEFAULT_COMPONENT_PARAMS,
        polygon: [],
        edited: null,
        clearanceMm: 0,
      }
      setTools((prev) =>
        prev.map((t) => (t.id === tool.id ? { ...t, components: [...t.components, newComponent] } : t)),
      )
      setSelection({ toolId: tool.id, componentId: id })
      setMode('select')
    },
    [selection, tools],
  )

  const handleDraftPoint = useCallback((pt: Pt) => {
    setDraft((prev) => [...prev, pt])
  }, [])

  const handleDraftCancel = useCallback(() => {
    setDraft([])
    setMode('select')
  }, [])

  const handleDraftComplete = useCallback(() => {
    if (!selection || draft.length < 3) return
    const tool = tools.find((t) => t.id === selection.toolId)
    if (!tool) return
    const newComponent: ToolComponent = {
      id: crypto.randomUUID(),
      name: defaultComponentName(tool),
      source: 'drawn',
      params: DEFAULT_COMPONENT_PARAMS,
      polygon: draft.map((p) => ({ ...p })),
      edited: null,
      clearanceMm: 0,
    }
    setTools((prev) =>
      prev.map((t) => (t.id === tool.id ? { ...t, components: [...t.components, newComponent] } : t)),
    )
    setSelection({ toolId: tool.id, componentId: newComponent.id })
    setDraft([])
    setMode('select')
  }, [selection, draft, tools])

  const handleRenameComponent = useCallback((toolId: string, componentId: string, name: string) => {
    setTools((prev) =>
      prev.map((t) =>
        t.id === toolId
          ? { ...t, components: t.components.map((c) => (c.id === componentId ? { ...c, name } : c)) }
          : t,
      ),
    )
  }, [])

  const handleComponentClearanceChange = useCallback((toolId: string, componentId: string, clearanceMm: number) => {
    setTools((prev) =>
      prev.map((t) =>
        t.id === toolId
          ? { ...t, components: t.components.map((c) => (c.id === componentId ? { ...c, clearanceMm } : c)) }
          : t,
      ),
    )
  }, [])

  const handleComponentParamsChange = useCallback((toolId: string, componentId: string, params: ComponentParams) => {
    setTools((prev) =>
      prev.map((t) =>
        t.id === toolId
          ? { ...t, components: t.components.map((c) => (c.id === componentId ? { ...c, params } : c)) }
          : t,
      ),
    )
  }, [])

  const handleRemoveComponent = useCallback((toolId: string, componentId: string) => {
    setTools((prev) =>
      prev.map((t) =>
        t.id === toolId ? { ...t, components: t.components.filter((c) => c.id !== componentId) } : t,
      ),
    )
    setComponentErrors((prev) => {
      if (!(componentId in prev)) return prev
      const next = { ...prev }
      delete next[componentId]
      return next
    })
  }, [])

  // --- Vertex editing (tool or component, whichever is selected) --------

  const handlePolygonChange = useCallback(
    (polygon: Polygon) => {
      if (!selection) return
      setTools((prev) =>
        prev.map((t) => {
          if (t.id !== selection.toolId) return t
          if (selection.componentId) {
            return {
              ...t,
              components: t.components.map((c) => (c.id === selection.componentId ? { ...c, edited: polygon } : c)),
            }
          }
          return { ...t, edited: polygon }
        }),
      )
    },
    [selection],
  )

  const handleResetEdits = useCallback(() => {
    if (!selection) return
    setTools((prev) =>
      prev.map((t) => {
        if (t.id !== selection.toolId) return t
        if (selection.componentId) {
          return {
            ...t,
            components: t.components.map((c) => (c.id === selection.componentId ? { ...c, edited: null } : c)),
          }
        }
        return { ...t, edited: null }
      }),
    )
  }, [selection])

  const handleEditModeChange = useCallback(
    (v: boolean) => {
      if (!selection) return
      setMode(v ? 'edit' : 'select')
    },
    [selection],
  )

  const handleCancelMode = useCallback(() => {
    setMode('select')
    setDraft([])
  }, [])

  // --- Arrange (per-tool layout transforms) ------------------------------

  const handleTransformChange = useCallback((toolId: string, transform: Transform) => {
    setLayout((prev) => ({ ...prev, [toolId]: transform }))
  }, [])

  const handleRotate90 = useCallback((toolId: string) => {
    setLayout((prev) => {
      const cur = prev[toolId] ?? IDENTITY
      return { ...prev, [toolId]: { ...cur, angleDeg: normalizeAngle(cur.angleDeg + 90) } }
    })
  }, [])

  const handleAutoAlign = useCallback(
    (toolId: string) => {
      const tool = tools.find((t) => t.id === toolId)
      if (!tool) return
      const angleDeg = autoAlignAngleDeg(tool.edited ?? tool.polygon)
      setLayout((prev) => ({ ...prev, [toolId]: { ...(prev[toolId] ?? IDENTITY), angleDeg } }))
    },
    [tools],
  )

  const handleResetPosition = useCallback((toolId: string) => {
    setLayout((prev) => {
      if (!(toolId in prev)) return prev
      const next = { ...prev }
      delete next[toolId]
      return next
    })
  }, [])

  const handleResetLayout = useCallback(() => {
    setLayout({})
    setArrangeResetSignal((n) => n + 1)
  }, [])

  const handleCanvasModeChange = useCallback((mode: CanvasMode['mode']) => {
    setExportOpts((prev) => ({
      ...prev,
      canvas: mode === 'auto' ? { mode: 'auto' } : { mode: 'fixed', widthMm: 200, heightMm: 150 },
    }))
  }, [])

  const handleFixedSizeChange = useCallback((patch: { widthMm?: number; heightMm?: number }) => {
    setExportOpts((prev) => {
      if (prev.canvas.mode !== 'fixed') return prev
      return {
        ...prev,
        canvas: {
          mode: 'fixed',
          widthMm: patch.widthMm ?? prev.canvas.widthMm,
          heightMm: patch.heightMm ?? prev.canvas.heightMm,
        },
      }
    })
  }, [])

  // --- Export -------------------------------------------------------------

  const handleDownloadAll = useCallback(() => {
    if (!exportResult) return
    downloadSvg(exportResult.svg, `${exportOpts.name || 'tools'}.svg`)
  }, [exportResult, exportOpts.name])

  const handleDownloadSelected = useCallback(() => {
    if (!cv || !selection) return
    const tool = tools.find((t) => t.id === selection.toolId)
    if (!tool) return
    try {
      const input: ToolExportInput = {
        name: tool.name,
        polygon: tool.edited ?? tool.polygon,
        clearanceMm: exportOpts.clearanceMm,
        transform: layout[tool.id] ?? IDENTITY,
        components: tool.components.map((c) => ({ name: c.name, polygon: c.edited ?? c.polygon, clearanceMm: c.clearanceMm })),
      }
      const result = exportTools(cv, [input], { ...exportOpts, name: tool.name, canvas: { mode: 'auto' } })
      downloadSvg(result.svg, `${tool.name || 'tool'}.svg`)
    } catch (err) {
      setExportError(err instanceof Error ? err.message : String(err))
    }
  }, [cv, selection, tools, exportOpts, layout])

  const handleCopySvg = useCallback(() => {
    if (!exportResult) return
    copyText(exportResult.svg)
      .then(() => {
        setCopyStatus('Copied to clipboard')
        setTimeout(() => setCopyStatus(null), 2000)
      })
      .catch(() => {
        setCopyStatus('Copy failed')
        setTimeout(() => setCopyStatus(null), 2000)
      })
  }, [exportResult])

  // --- Boxed props ----------------------------------------------------
  //
  // React 19.2's dev-mode "Components" performance track diffs old vs new
  // props on every render and recursively enumerates object values up to 3
  // levels deep (`addObjectDiffToProperties` in react-dom's dev bundle).
  // Viewer and StepPanel receive props containing raw ImageData
  // (rectified.image, detection.mask, photo.image), tool/component lists,
  // and — once vertex editing is involved — polygons with hundreds of
  // points, passed unboxed the profiler walks those pixel buffers and
  // arrays entry-by-entry: 31,279,406 property entries enumerated for a
  // single Viewer render and 15,840,034 for StepPanel in the v1 build,
  // pushing the heap from 84 MB to 2.2 GB on one upload and crashing React
  // with `DataCloneError: Failed to execute 'measure' on 'Performance': out
  // of memory` followed by `Should not already be working`. This only
  // happens under `npm run dev` (the profiler is stripped from production
  // builds), but that's how the app is meant to be run, so it has to be
  // fixed: wrap every large buffer, polygon, or list in an opaque `Box`
  // (private field ⇒ nothing enumerable) before it crosses a component
  // boundary as a prop.
  const photoBox = useMemo(() => (photo ? new Box(photo) : null), [photo])
  const rectifiedBox = useMemo(() => (rectified ? new Box(rectified) : null), [rectified])
  const detectionBox = useMemo(() => (detection ? new Box(detection) : null), [detection])
  const toolsBox = useMemo(() => new Box(tools), [tools])

  const selectedTool = selection ? (tools.find((t) => t.id === selection.toolId) ?? null) : null
  const selectedComponent =
    selectedTool && selection?.componentId
      ? (selectedTool.components.find((c) => c.id === selection.componentId) ?? null)
      : null

  const editTargetPolygon: Polygon | null = selectedComponent
    ? (selectedComponent.edited ?? selectedComponent.polygon)
    : selectedTool
      ? (selectedTool.edited ?? selectedTool.polygon)
      : null
  const editTargetBox = useMemo(() => (editTargetPolygon ? new Box(editTargetPolygon) : null), [editTargetPolygon])

  const hasEdits = selectedComponent ? selectedComponent.edited !== null : selectedTool ? selectedTool.edited !== null : false

  // Zero-polygon summary rows for StepPanel — widths/heights/colours only,
  // no geometry, but boxed anyway per the rule above ("tool lists").
  const toolRows = useMemo(
    () =>
      tools.map((t, i) => {
        const poly = t.edited ?? t.polygon
        const b = bbox([poly])
        return {
          id: t.id,
          name: t.name,
          colour: colourForIndex(i),
          widthMm: b.w,
          heightMm: b.h,
          hasEdits: t.edited !== null,
          components: t.components.map((c) => {
            const cp = c.edited ?? c.polygon
            const cb = bbox([cp])
            return {
              id: c.id,
              name: c.name,
              source: c.source,
              widthMm: cb.w,
              heightMm: cb.h,
              clearanceMm: c.clearanceMm,
              hasEdits: c.edited !== null,
              error: componentErrors[c.id],
              params: c.params,
            }
          }),
        }
      }),
    [tools, componentErrors],
  )
  const toolRowsBox = useMemo(() => new Box(toolRows), [toolRows])

  const selectedIndex = selection ? tools.findIndex((t) => t.id === selection.toolId) : -1
  const selectedExportedTool = exportResult && selectedIndex >= 0 ? (exportResult.tools[selectedIndex] ?? null) : null
  const exportStats = useMemo(() => {
    if (!selectedExportedTool) return null
    const b = bbox([selectedExportedTool.outline])
    return {
      toolWidthMm: b.w,
      toolHeightMm: b.h,
      points: selectedExportedTool.outline.length,
      areaMm2: polygonArea(selectedExportedTool.outline),
    }
  }, [selectedExportedTool])

  // Per-tool layout-frame geometry for the arrange canvas: joined to
  // `exportResult.tools` by array index (both are built from `tools` in
  // the same order), then shifted back from the export frame into the
  // layout frame by undoing `originShift`.
  const arrangeItems: ArrangeItem[] = useMemo(() => {
    if (!exportResult) return []
    const shift = exportResult.originShift
    const shiftPt = (p: Pt): Pt => ({ x: p.x - shift.x, y: p.y - shift.y })
    const shiftPoly = (poly: Polygon): Polygon => poly.map(shiftPt)
    const items: ArrangeItem[] = []
    tools.forEach((t, i) => {
      const exported = exportResult.tools[i]
      if (!exported) return
      items.push({
        toolId: t.id,
        name: t.name,
        colour: colourForIndex(i),
        transform: layout[t.id] ?? IDENTITY,
        anchor: shiftPt(exported.centroid),
        outline: shiftPoly(exported.outline),
        clearance: exported.clearance ? shiftPoly(exported.clearance) : undefined,
        components: exported.components.map((c) => ({
          outline: shiftPoly(c.outline),
          clearance: c.clearance ? shiftPoly(c.clearance) : undefined,
        })),
      })
    })
    return items
  }, [exportResult, tools, layout])
  const arrangeItemsBox = useMemo(() => new Box(arrangeItems), [arrangeItems])

  if (showTemplate) {
    return <TemplatePage onBack={() => setShowTemplate(false)} paper={paper} onPaperChange={setPaper} />
  }

  const cleanupIsCustom = isCleanupCustom(outlineParams, cleanup)

  // Compact header badge summarising marker/rectification status — the
  // Capture column in the dock below still carries the full detail.
  const markerBadge = !photo
    ? { dot: 'status-dot-muted', text: 'No photo' }
    : busy
      ? { dot: 'status-dot-muted', text: 'Processing…' }
      : rectified
        ? { dot: 'status-dot-good', text: rectified.mode === 'markers' ? 'Markers ok' : 'Manual scale' }
        : { dot: 'status-dot-bad', text: 'No markers' }

  return (
    <div className="app-shell">
      <header className="app-header">
        <h1>ToolTrace</h1>
        <div className="app-header-actions">
          <span className="status-line marker-badge">
            <span className={`status-dot ${markerBadge.dot}`} />
            <span className="muted-small">{markerBadge.text}</span>
          </span>
          <button type="button" className="link-btn" onClick={() => setShowTemplate(true)}>
            Print template
          </button>
        </div>
      </header>

      <main className="stage">
        <section className="stage-pane">
          <Viewer
            rectified={rectifiedBox}
            photo={photoBox}
            detection={detectionBox}
            tools={toolsBox}
            selection={selection}
            mode={mode}
            draft={draft}
            editTarget={editTargetBox}
            showMask={showMask}
            manualPoints={manualPoints}
            fileName={file?.name ?? null}
            onClickPx={handleClickPx}
            onSelectTool={handleSelectTool}
            onSelectComponent={handleSelectComponent}
            onAddToolAt={handleAddToolAt}
            onSeedComponentAt={handleSeedComponentAt}
            onDraftPoint={handleDraftPoint}
            onDraftComplete={handleDraftComplete}
            onDraftCancel={handleDraftCancel}
            onPolygonChange={handlePolygonChange}
            onCancelMode={handleCancelMode}
          />
        </section>
        <section className="stage-pane">
          <ArrangeCanvas
            items={arrangeItemsBox}
            originShift={exportResult?.originShift ?? { x: 0, y: 0 }}
            widthMm={exportResult?.widthMm ?? 0}
            heightMm={exportResult?.heightMm ?? 0}
            marginMm={exportOpts.marginMm}
            fixedCanvas={exportOpts.canvas.mode === 'fixed'}
            selectedToolId={selection?.toolId ?? null}
            gridSnap={gridSnap}
            resetSignal={arrangeResetSignal}
            onSelectTool={handleSelectTool}
            onTransformChange={handleTransformChange}
          />
        </section>
      </main>

      <Dock
        cvStatus={cvStatus}
        cvError={cvError}
        paper={paper}
        onPaperChange={setPaper}
        onShowTemplate={() => setShowTemplate(true)}
        printerScale={getPrinterScale()}
        file={file}
        onFile={handleFile}
        busy={busy}
        photo={photoBox}
        processError={processError}
        hasRectified={!!rectified}
        rectifiedMarkersCount={rectified?.markers.length ?? 0}
        rectifiedReprojErrorPx={rectified?.reprojErrorPx ?? 0}
        rectifiedMode={rectified?.mode ?? null}
        manualActive={manualActive}
        onUseManual={handleUseManual}
        manualPointsCount={manualPoints.length}
        manualDistanceMm={manualDistanceMm}
        onManualDistanceChange={setManualDistanceMm}
        onApplyManual={handleApplyManual}
        manualError={manualError}
        outlineParams={outlineParams}
        onOutlineParamsChange={setOutlineParams}
        cleanup={cleanup}
        onCleanupChange={handleCleanupChange}
        cleanupIsCustom={cleanupIsCustom}
        thresholdUsed={detection?.thresholdUsed ?? null}
        detectionError={detectionError}
        showMask={showMask}
        onShowMaskChange={setShowMask}
        tools={toolRowsBox}
        selectedToolId={selection?.toolId ?? null}
        selectedComponentId={selection?.componentId ?? null}
        onSelectTool={handleSelectTool}
        onSelectComponent={handleSelectComponent}
        onRenameTool={handleRenameTool}
        onRemoveTool={handleRemoveTool}
        onAddComponentFromPhoto={handleAddComponentFromPhoto}
        onAddComponentDraw={handleAddComponentDraw}
        onRenameComponent={handleRenameComponent}
        onComponentClearanceChange={handleComponentClearanceChange}
        onComponentParamsChange={handleComponentParamsChange}
        onRemoveComponent={handleRemoveComponent}
        mode={mode}
        onEditModeChange={handleEditModeChange}
        hasEdits={hasEdits}
        onResetEdits={handleResetEdits}
        layout={layout}
        onTransformChange={handleTransformChange}
        onRotate90={handleRotate90}
        onAutoAlign={handleAutoAlign}
        onResetPosition={handleResetPosition}
        onResetLayout={handleResetLayout}
        canvasMode={exportOpts.canvas}
        onCanvasModeChange={handleCanvasModeChange}
        onFixedSizeChange={handleFixedSizeChange}
        gridSnap={gridSnap}
        onGridSnapChange={setGridSnap}
        exportOpts={exportOpts}
        onExportOptsChange={setExportOpts}
        hasExport={!!exportResult}
        exportWidthMm={exportResult?.widthMm ?? null}
        exportHeightMm={exportResult?.heightMm ?? null}
        exportStats={exportStats}
        exportError={exportError}
        onDownloadAll={handleDownloadAll}
        onDownloadSelected={handleDownloadSelected}
        onCopySvg={handleCopySvg}
        copyStatus={copyStatus}
      />
    </div>
  )
}

export default App
