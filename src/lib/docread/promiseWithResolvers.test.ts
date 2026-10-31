import { afterEach, describe, expect, it, vi } from 'vitest'
import workerSource from './pdfWorker.ts?raw'

type P = { withResolvers?: unknown }
const original = (Promise as P).withResolvers

afterEach(() => {
  Object.defineProperty(Promise, 'withResolvers', { configurable: true, writable: true, value: original })
  vi.resetModules()
})

describe('Promise.withResolvers polyfill (older phones)', () => {
  it('installs a working withResolvers when the browser has none', async () => {
    delete (Promise as P).withResolvers
    expect((Promise as P).withResolvers).toBeUndefined()
    vi.resetModules()
    await import('./promiseWithResolvers')
    const { promise, resolve } = (Promise as unknown as { withResolvers: <T>() => { promise: Promise<T>; resolve: (v: T) => void } }).withResolvers<number>()
    resolve(7)
    await expect(promise).resolves.toBe(7)
  })

  it('rejects through the returned reject', async () => {
    delete (Promise as P).withResolvers
    vi.resetModules()
    await import('./promiseWithResolvers')
    const { promise, reject } = (Promise as unknown as { withResolvers: () => { promise: Promise<never>; reject: (e: unknown) => void } }).withResolvers()
    reject(new Error('no'))
    await expect(promise).rejects.toThrow('no')
  })

  it('leaves a native withResolvers alone', async () => {
    const native = function () {}
    Object.defineProperty(Promise, 'withResolvers', { configurable: true, writable: true, value: native })
    vi.resetModules()
    await import('./promiseWithResolvers')
    expect((Promise as P).withResolvers).toBe(native)
  })

  it('the pdf.js worker entry installs the polyfill before the stock worker', () => {
    const imports = [...workerSource.matchAll(/^import '(.+)'$/gm)].map(m => m[1])
    expect(imports).toEqual(['./promiseWithResolvers', 'pdfjs-dist/legacy/build/pdf.worker.min.mjs'])
  })
})
