import { afterEach, describe, expect, it, vi } from 'vitest'
import { renderPdfPreview } from '@/features/enquiry/pdfPreview'

/* A PDF whose second page fails must not leak the first page's blob URL or keep the parsed document. */
const state = vi.hoisted(() => ({ destroy: vi.fn(), failPage: 2 }))
vi.mock('@/lib/docread/pdfjsRuntime', () => ({
  pdfjs: {
    VerbosityLevel: { ERRORS: 0 },
    getDocument: () => ({
      destroy: state.destroy,
      promise: Promise.resolve({
        numPages: 3,
        getPage: (n: number) => {
          if (n === state.failPage) return Promise.reject(new Error('bad page'))
          return Promise.resolve({
            getViewport: () => ({ width: 100, height: 140 }),
            render: () => ({ promise: Promise.resolve() }),
            cleanup() {},
          })
        },
      }),
    }),
  },
}))

afterEach(() => vi.restoreAllMocks())

describe('renderPdfPreview', () => {
  it('revokes the pages already drawn and destroys the document when a later page fails', async () => {
    let n = 0
    const create = vi.fn(() => `blob:page-${++n}`)
    const revoke = vi.fn()
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: create, revokeObjectURL: revoke }))
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ fillRect() {}, fillStyle: '' } as unknown as CanvasRenderingContext2D)
    vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(cb => cb(new Blob(['x'], { type: 'image/png' })))
    const file = new File([new Uint8Array(4)], 'q.pdf', { type: 'application/pdf' })
    file.arrayBuffer = () => Promise.resolve(new ArrayBuffer(4)) // jsdom's File has none
    const out = await renderPdfPreview(file)
    expect(out).toBeNull()
    expect(create).toHaveBeenCalledTimes(1)
    expect(revoke).toHaveBeenCalledWith('blob:page-1')
    expect(state.destroy).toHaveBeenCalled()
  })
})
