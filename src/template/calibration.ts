// Persists / reads the printer scale calibration derived from the "measured
// scale bar" input on the template page. A printer that doesn't print at
// exactly 100% will make the nominal 100mm scale bar measure slightly off;
// dividing the user's measurement by 100 gives a correction factor that can
// be applied to future template renders (via `markerLayouts(paper, scale)`).
const STORAGE_KEY = 'tooltrace.scaleBarMm'

/**
 * Returns `measuredMm / 100`, i.e. 1 if the user hasn't calibrated (or
 * localStorage is unavailable), the value they measured is 0/invalid.
 */
export function getPrinterScale(): number {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return 1
    const measured = Number(raw)
    if (!Number.isFinite(measured) || measured <= 0) return 1
    return measured / 100
  } catch {
    return 1
  }
}

export function getMeasuredScaleBarMm(): number {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return 100
    const measured = Number(raw)
    return Number.isFinite(measured) && measured > 0 ? measured : 100
  } catch {
    return 100
  }
}

export function setMeasuredScaleBarMm(mm: number): void {
  try {
    localStorage.setItem(STORAGE_KEY, String(mm))
  } catch {
    // ignore (private browsing / storage disabled)
  }
}
