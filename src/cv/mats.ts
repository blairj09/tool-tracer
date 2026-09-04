// Helpers for deterministic cleanup of OpenCV.js Mat-like objects. OpenCV.js
// allocates memory in a WASM heap that is not garbage collected, so every Mat
// (and MatVector, etc.) must have `.delete()` called on it explicitly. These
// helpers track everything created inside a callback and delete it all in a
// `finally` block, even if the callback throws.

interface Deletable {
  delete(): void
}

/**
 * Run `fn` with a `track` function. Every object passed through `track` is
 * deleted (in reverse creation order) once `fn` returns or throws.
 *
 * @example
 * const area = withMats((track) => {
 *   const gray = track(new cv.Mat())
 *   cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY)
 *   return cv.countNonZero(gray)
 * })
 */
export function withMats<T>(fn: (track: <M extends Deletable>(m: M) => M) => T): T {
  const tracked: Deletable[] = []
  const track = <M extends Deletable>(m: M): M => {
    tracked.push(m)
    return m
  }
  try {
    return fn(track)
  } finally {
    for (let i = tracked.length - 1; i >= 0; i--) {
      tracked[i].delete()
    }
  }
}

/** Async variant of {@link withMats}, for callbacks that need to `await`. */
export async function withMatsAsync<T>(fn: (track: <M extends Deletable>(m: M) => M) => Promise<T>): Promise<T> {
  const tracked: Deletable[] = []
  const track = <M extends Deletable>(m: M): M => {
    tracked.push(m)
    return m
  }
  try {
    return await fn(track)
  } finally {
    for (let i = tracked.length - 1; i >= 0; i--) {
      tracked[i].delete()
    }
  }
}
