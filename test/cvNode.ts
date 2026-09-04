// Loads @techstark/opencv-js in Node for tests. Mirrors the shape-handling
// logic in src/cv/loadCv.ts (there `window.cv` may be a Promise, a ready
// Module, or a booting Module — here the CJS export follows the same three
// shapes since it's the same UMD bundle).
//
// NOTE: this uses `createRequire` (a genuine Node CJS `require`) instead of
// dynamic `import()`. Vitest's SSR module loader mishandles this package's
// UMD bundle (whose CJS `module.exports` is itself a Promise — the
// interop shim ends up calling `.then` on the ES module namespace object
// rather than on the underlying promise, throwing "Method Promise.prototype
// .then called on incompatible receiver [object Module]"). Plain
// `require()` sidesteps Vite's import graph entirely and works correctly.
import { createRequire } from 'node:module'
import type { CV } from '../src/cv/loadCv'

let cvPromise: Promise<CV> | null = null

function isReadyModule(x: unknown): x is CV {
  return !!x && typeof x === 'object' && 'Mat' in (x as Record<string, unknown>)
}

function isPromiseLike(x: unknown): x is Promise<unknown> {
  return !!x && typeof (x as { then?: unknown }).then === 'function'
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
    return new Promise<CV>((resolve) => {
      ;(raw as { onRuntimeInitialized?: () => void }).onRuntimeInitialized = () => resolve(raw as CV)
    })
  }
  throw new Error('@techstark/opencv-js default export is not a Module, Promise, or object')
}

export function loadCvNode(): Promise<CV> {
  if (!cvPromise) {
    const require = createRequire(import.meta.url)
    const raw: unknown = require('@techstark/opencv-js')
    cvPromise = resolveModule(raw)
  }
  return cvPromise
}
