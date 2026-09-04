import { useCallback, useEffect, useState } from 'react'
import TemplatePage from './template/TemplatePage'
import StepPanel from './components/StepPanel'
import Viewer from './components/Viewer'
import type { PhotoResult } from './components/types'
import { loadCv, type CV } from './cv/loadCv'
import type { PaperSize } from './template/layout'
import { getPrinterScale } from './template/calibration'
import {
  DEFAULT_OUTLINE_PARAMS,
  type ExportOptions,
  type ExportResult,
  type OutlineParams,
  type OutlineResult,
  type Pt,
  type Rectified,
} from './pipeline/types'
import { processPhoto, exportOutline, downloadSvg, copyText } from './pipeline/run'
import { extractOutline } from './pipeline/outline'
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
  autoAlign: true,
  marginMm: 5,
  name: 'tool',
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
  const [outline, setOutline] = useState<OutlineResult | null>(null)
  const [outlineError, setOutlineError] = useState<string | null>(null)
  const [showMask, setShowMask] = useState(false)

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
    setOutline(null)
    setOutlineError(null)
    setOutlineParams((prev) => {
      if (!('pick' in prev)) return prev
      const { pick: _pick, ...rest } = prev
      return rest
    })
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

  const handleUseManual = useCallback(() => {
    setManualActive(true)
    setRectified(null)
    setManualPoints([])
    setManualError(null)
    setOutline(null)
    setOutlineError(null)
    setOutlineParams((prev) => {
      if (!('pick' in prev)) return prev
      const { pick: _pick, ...rest } = prev
      return rest
    })
    setExportResult(null)
    setExportError(null)
  }, [])

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

  const handleClickMm = useCallback(
    (pt: Pt) => {
      if (!outline) return
      setOutlineParams((prev) => ({ ...prev, pick: pt }))
    },
    [outline],
  )

  const handleClearPick = useCallback(() => {
    setOutlineParams((prev) => {
      if (!('pick' in prev)) return prev
      const { pick: _pick, ...rest } = prev
      return rest
    })
  }, [])

  // Recompute the outline whenever the rectified image or the outline
  // params change, debounced so dragging a slider doesn't re-run OpenCV on
  // every intermediate value.
  useEffect(() => {
    if (!cv || !rectified) {
      setOutline(null)
      setOutlineError(null)
      return
    }
    const handle = setTimeout(() => {
      try {
        const result = extractOutline(cv, rectified, outlineParams)
        setOutline(result)
        setOutlineError(null)
      } catch (err) {
        setOutline(null)
        setOutlineError(err instanceof Error ? err.message : String(err))
      }
    }, 150)
    return () => clearTimeout(handle)
  }, [cv, rectified, outlineParams])

  // Recompute the export (and preview) immediately whenever the outline or
  // export options change.
  useEffect(() => {
    if (!cv || !outline) {
      setExportResult(null)
      setExportError(null)
      return
    }
    try {
      const result = exportOutline(cv, outline.polygon, exportOpts)
      setExportResult(result)
      setExportError(null)
    } catch (err) {
      setExportResult(null)
      setExportError(err instanceof Error ? err.message : String(err))
    }
  }, [cv, outline, exportOpts])

  const handleDownload = useCallback(() => {
    if (!exportResult) return
    downloadSvg(exportResult.svg, `${exportOpts.name || 'tool'}.svg`)
  }, [exportResult, exportOpts.name])

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

  if (showTemplate) {
    return <TemplatePage onBack={() => setShowTemplate(false)} paper={paper} onPaperChange={setPaper} />
  }

  const usingManualMode = manualActive || rectified?.mode === 'manual'

  return (
    <>
      <header className="app-header">
        <h1>ToolTrace</h1>
        <div className="actions">
          <button type="button" className="btn" onClick={() => setShowTemplate(true)}>
            Print template
          </button>
        </div>
      </header>

      <main className="app-main">
        <Viewer
          rectified={rectified}
          rawImage={photo?.image ?? null}
          outline={outline}
          exportResult={exportResult}
          showMask={showMask}
          manualPoints={manualPoints}
          pickMm={outlineParams.pick}
          onClickMm={handleClickMm}
          onClickPx={handleClickPx}
        />
        <StepPanel
          cvStatus={cvStatus}
          cvError={cvError}
          paper={paper}
          onPaperChange={setPaper}
          onShowTemplate={() => setShowTemplate(true)}
          printerScale={getPrinterScale()}
          file={file}
          onFile={handleFile}
          busy={busy}
          photo={photo}
          processError={processError}
          manualActive={manualActive}
          onUseManual={handleUseManual}
          manualPointsCount={manualPoints.length}
          manualDistanceMm={manualDistanceMm}
          onManualDistanceChange={setManualDistanceMm}
          onApplyManual={handleApplyManual}
          manualError={manualError}
          usingManualMode={usingManualMode}
          outlineParams={outlineParams}
          onOutlineParamsChange={setOutlineParams}
          outline={outline}
          outlineError={outlineError}
          showMask={showMask}
          onShowMaskChange={setShowMask}
          hasPick={!!outlineParams.pick}
          onClearPick={handleClearPick}
          exportOpts={exportOpts}
          onExportOptsChange={setExportOpts}
          exportResult={exportResult}
          exportError={exportError}
          onDownload={handleDownload}
          onCopySvg={handleCopySvg}
          copyStatus={copyStatus}
        />
      </main>
    </>
  )
}

export default App
