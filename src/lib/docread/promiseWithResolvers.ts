// pdf.js 6 (legacy build too) calls Promise.withResolvers, which Node 20 (CI unit tests) and older phone browsers lack. This is the
// standard behaviour, installed only when it is missing. pdfjsRuntime.ts imports it before pdf.js.
if (typeof (Promise as { withResolvers?: unknown }).withResolvers !== 'function') {
  Object.defineProperty(Promise, 'withResolvers', {
    configurable: true,
    writable: true,
    value: function withResolvers<T>() {
      let resolve!: (value: T | PromiseLike<T>) => void
      let reject!: (reason?: unknown) => void
      const promise = new Promise<T>((res, rej) => {
        resolve = res
        reject = rej
      })
      return { promise, resolve, reject }
    },
  })
}

export {}
