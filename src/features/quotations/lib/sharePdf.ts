/*
 * Share a PDF: the phone's share sheet with the file attached where the browser supports it (Android Chrome, iOS Safari),
 * and a plain download everywhere else. Must be called from a tap (the share sheet needs a user gesture).
 */
export type ShareResult = 'shared' | 'downloaded' | 'cancelled'

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}

export async function sharePdf(blob: Blob, filename: string, title: string): Promise<ShareResult> {
  const file = new File([blob], filename, { type: 'application/pdf' })
  const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean }
  if (typeof nav.share === 'function' && typeof nav.canShare === 'function' && nav.canShare({ files: [file] })) {
    try {
      await nav.share({ files: [file], title })
      return 'shared'
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return 'cancelled'
      // Any other refusal (a policy, a size limit): fall back to the download rather than failing the tap.
    }
  }
  downloadBlob(blob, filename)
  return 'downloaded'
}
