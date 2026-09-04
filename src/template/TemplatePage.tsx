import { useEffect, useMemo, useState } from 'react'
import { loadCv, type CV } from '../cv/loadCv'
import { markerBits } from './markerBits'
import { templateSvg } from './templateSvg'
import { MARKER_IDS, type PaperSize } from './layout'
import { getMeasuredScaleBarMm, setMeasuredScaleBarMm } from './calibration'

interface TemplatePageProps {
  onBack: () => void
  paper: PaperSize
  onPaperChange: (paper: PaperSize) => void
}

const PAPER_CSS_SIZE: Record<PaperSize, string> = {
  letter: 'letter',
  a4: 'A4',
}

export default function TemplatePage({ onBack, paper, onPaperChange }: TemplatePageProps) {
  const [bits, setBits] = useState<Record<number, boolean[][]> | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [measuredMm, setMeasuredMm] = useState<number>(() => getMeasuredScaleBarMm())

  useEffect(() => {
    let cancelled = false

    loadCv()
      .then(async (loadedCv: CV) => {
        const entries = await Promise.all(MARKER_IDS.map(async (id) => [id, await markerBits(loadedCv, id)] as const))
        if (cancelled) return
        setBits(Object.fromEntries(entries))
      })
      .catch((err: unknown) => {
        if (cancelled) return
        setError(err instanceof Error ? err.message : String(err))
      })

    return () => {
      cancelled = true
    }
  }, [])

  const svg = useMemo(() => {
    if (!bits) return null
    return templateSvg({ paper, bits })
  }, [bits, paper])

  const handleMeasuredChange = (value: number) => {
    setMeasuredMm(value)
    setMeasuredScaleBarMm(value)
  }

  return (
    <div className="template-page">
      <style>{`@page { size: ${PAPER_CSS_SIZE[paper]}; margin: 0; }`}</style>

      <div className="template-controls">
        <button type="button" className="btn" onClick={onBack}>
          &larr; Back
        </button>

        <label className="field">
          Paper size
          <select value={paper} onChange={(e) => onPaperChange(e.target.value as PaperSize)}>
            <option value="letter">Letter</option>
            <option value="a4">A4</option>
          </select>
        </label>

        <label className="field">
          Measured scale bar (mm)
          <input
            type="number"
            min={1}
            step={0.1}
            value={measuredMm}
            onChange={(e) => handleMeasuredChange(Number(e.target.value))}
          />
        </label>

        <button type="button" className="btn primary" onClick={() => window.print()} disabled={!svg}>
          Print
        </button>
      </div>

      <ol className="template-instructions">
        <li>Print at 100% / Actual size (turn off "Fit to page" in your print dialog).</li>
        <li>
          After printing, measure the 100&nbsp;mm scale bar on the page with a ruler and enter what you measured
          above &mdash; this corrects for any printer scaling error.
        </li>
        <li>Place the tool inside the grey rectangle, well away from the four corner markers.</li>
        <li>Photograph the page straight down from above, with even lighting and all four markers visible.</li>
      </ol>

      {error && <p className="template-error">Failed to load OpenCV.js: {error}</p>}
      {!svg && !error && <p className="template-loading">Loading OpenCV.js (about 13 MB, this can take a moment)&hellip;</p>}

      {svg && (
        <div className="template-print" dangerouslySetInnerHTML={{ __html: svg }} />
      )}
    </div>
  )
}
