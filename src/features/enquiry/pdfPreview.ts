/*
 * A picture of the first pages of a PDF, for New enquiry's left side. The browser's own PDF viewer cannot be used: the
 * Content-Security-Policy (default-src 'self', object-src 'none') blocks a blob: frame, so pdf.js (already on the device for reading
 * the PDF, a lazy chunk with a same-origin worker) draws each page onto a canvas, and the picture is shown as a blob: image (img-src
 * allows blob:). Nothing is uploaded.
 */
export interface PdfPreview {
  /** Object URLs, one per page drawn; the caller revokes them. */
  urls: string[]
  /** The PDF has more pages than were drawn. */
  more: number
}

export async function renderPdfPreview(file: File, opts: { pages?: number; width?: number; signal?: AbortSignal } = {}): Promise<PdfPreview | null> {
  if (typeof document === 'undefined') return null
  const limit = opts.pages ?? 2
  const width = opts.width ?? 900
  const urls: string[] = []
  let task: { destroy: () => Promise<void> | void } | null = null
  try {
    const { pdfjs } = await import('@/lib/docread/pdfjsRuntime')
    const data = new Uint8Array(await file.arrayBuffer())
    const loading = pdfjs.getDocument({ data, isEvalSupported: false, disableFontFace: true, useSystemFonts: false, enableXfa: false, verbosity: pdfjs.VerbosityLevel.ERRORS })
    task = loading
    const doc = await loading.promise
    const count = Math.min(doc.numPages, limit)
    for (let n = 1; n <= count; n++) {
      if (opts.signal?.aborted) break
      const page = await doc.getPage(n)
      const base = page.getViewport({ scale: 1 })
      const viewport = page.getViewport({ scale: width / base.width })
      const canvas = document.createElement('canvas')
      canvas.width = Math.ceil(viewport.width)
      canvas.height = Math.ceil(viewport.height)
      const ctx = canvas.getContext('2d')
      if (!ctx) break
      ctx.fillStyle = '#fff'
      ctx.fillRect(0, 0, canvas.width, canvas.height)
      await page.render({ canvasContext: ctx, canvas, viewport }).promise
      const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(b => resolve(b), 'image/png'))
      page.cleanup()
      if (blob) urls.push(URL.createObjectURL(blob))
    }
    void loading.destroy()
    task = null
    return urls.length > 0 ? { urls, more: Math.max(0, doc.numPages - urls.length) } : null
  } catch {
    // A page that fails to draw (page 2 of a damaged PDF) must not leave the pages already drawn, or the parsed document, behind.
    for (const u of urls) URL.revokeObjectURL(u)
    void task?.destroy()
    return null
  }
}
