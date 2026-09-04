// Loads OpenCV.js (~13 MB) at runtime by injecting a <script src="/opencv.js">
// tag (the file is copied into public/ by scripts/copy-opencv.mjs, see
// package.json's "postinstall"). The result is memoized so the script is
// only injected once no matter how many times loadCv() is called.
//
// NOTE on this build's readiness signal: the @techstark/opencv-js 5.0.0
// UMD bundle wraps its Emscripten module factory in an `async function`, so
// `window.cv` is actually assigned a *Promise* that resolves to the real
// module object once the WASM runtime finishes initializing (this differs
// from older opencv.js builds, where `cv` is synchronously the Module object
// and you wait on `cv.onRuntimeInitialized`). We handle both shapes so this
// keeps working if the vendored build ever changes:
//   1. `window.cv` is a Promise -> await it.
//   2. `window.cv` is already a ready Module (has `.Mat`) -> use directly.
//   3. `window.cv` is a Module still booting -> wait for `onRuntimeInitialized`.
import type { CvAruco } from './cv-aruco'

// `typeof import(...)` gives us the module's runtime shape (classes like Mat,
// MatVector, functions like matFromImageData, etc.) without needing the
// package's value export to be usable directly as a type name.
export type CV = typeof import('@techstark/opencv-js') & CvAruco

declare global {
  interface Window {
    cv?: unknown
  }
}

const SCRIPT_ID = 'tooltrace-opencv-script'
const SCRIPT_SRC = '/opencv.js'

let cvPromise: Promise<CV> | null = null

function isReadyModule(x: unknown): x is CV {
  return !!x && typeof x === 'object' && 'Mat' in (x as Record<string, unknown>)
}

function isPromiseLike(x: unknown): x is Promise<unknown> {
  return !!x && typeof (x as any).then === 'function'
}

async function resolveModule(raw: unknown): Promise<CV> {
  if (isPromiseLike(raw)) {
    const resolved = await raw
    return resolveModule(resolved)
  }
  if (isReadyModule(raw)) {
    return raw
  }
  if (raw && typeof raw === 'object') {
    // Module object that hasn't finished booting the WASM runtime yet.
    return new Promise<CV>((resolve) => {
      ;(raw as any).onRuntimeInitialized = () => resolve(raw as CV)
    })
  }
  throw new Error('opencv.js loaded but window.cv is not a Module, Promise, or object')
}

/**
 * Load OpenCV.js (with the ArUco shim types applied) exactly once. Safe to
 * call multiple times; every caller shares the same underlying promise.
 */
export function loadCv(): Promise<CV> {
  if (cvPromise) return cvPromise

  cvPromise = new Promise<CV>((resolve, reject) => {
    const finish = () => resolveModule(window.cv).then(resolve, reject)

    const existing = document.getElementById(SCRIPT_ID) as HTMLScriptElement | null
    if (existing) {
      if (window.cv !== undefined) {
        finish()
      } else {
        existing.addEventListener('load', finish, { once: true })
        existing.addEventListener('error', () => reject(new Error(`Failed to load ${SCRIPT_SRC}`)), { once: true })
      }
      return
    }

    const script = document.createElement('script')
    script.id = SCRIPT_ID
    script.src = SCRIPT_SRC
    script.async = true
    script.addEventListener('load', finish, { once: true })
    script.addEventListener('error', () => reject(new Error(`Failed to load ${SCRIPT_SRC}`)), { once: true })
    document.head.appendChild(script)
  })

  return cvPromise
}
