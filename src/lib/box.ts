/** Opaque holder so large objects (ImageData, big arrays) never get enumerated by React's dev profiler when passed as props. Private field ⇒ nothing enumerable. */
export class Box<T> {
  readonly #value: T
  constructor(v: T) {
    this.#value = v
  }
  get value(): T {
    return this.#value
  }
}
