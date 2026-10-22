import { isImageFile, readImageText, type ImageProgress } from '@/lib/docread/imageText'
import { isPdfFile, readPdfText, type PdfSubject } from '@/lib/docread/pdfText'
import { isSheetFile, readSheetText } from '@/lib/docread/sheetText'

/**
 * Reads one PDF on this device: the text, or the reader's plain sentence to show instead (a locked or damaged file, a scan
 * that could not be read clearly). A scanned PDF is read page by page by the picture reader, with progress and cancel.
 */
export async function readPdf(
  file: File,
  subject: PdfSubject,
  opts: { onProgress?: (p: ImageProgress) => void; signal?: AbortSignal } = {},
): Promise<{ text: string } | { message: string } | { cancelled: true }> {
  const r = await readPdfText(file, { subject, onProgress: opts.onProgress, signal: opts.signal })
  if (r.ok) return { text: r.text }
  if (r.reason === 'aborted') return { cancelled: true }
  return { message: r.message || 'This PDF could not be read.' }
}

/** A file the readers can take: a PDF, a picture (a screenshot, a photo of a screen or of paper) or a spreadsheet. */
export function isReadableFile(file: { type?: string; name?: string }): boolean {
  return isPdfFile(file) || isImageFile(file) || isSheetFile(file)
}

export type DocumentFrom = 'pdf' | 'photo' | 'sheet'
export type DocumentRead = { text: string; from: DocumentFrom } | { message: string } | { cancelled: true }

/**
 * Reads one PDF, one picture or one spreadsheet on this device (src/lib/docread; nothing is uploaded): its text, ready for the
 * same parser a paste goes through, or a plain sentence to show instead. A picture reports its progress ("Reading the image… 40%") and can be
 * cancelled with `signal`.
 */
export async function readDocument(
  file: File,
  subject: PdfSubject,
  opts: { onProgress?: (p: ImageProgress) => void; signal?: AbortSignal } = {},
): Promise<DocumentRead> {
  // A spreadsheet (.xlsx, .xls, .csv): its item table, found by its header row, as the text a paste of it gives.
  if (!isPdfFile(file) && isSheetFile(file)) {
    const r = await readSheetText(file, { subject })
    return r.ok ? { text: r.text, from: 'sheet' } : { message: r.message }
  }
  if (!isPdfFile(file) && isImageFile(file)) {
    const r = await readImageText(file, { subject, onProgress: opts.onProgress, signal: opts.signal })
    if (r.ok) return { text: r.text, from: 'photo' }
    if (r.reason === 'aborted') return { cancelled: true }
    return { message: r.message }
  }
  const r = await readPdf(file, subject, opts)
  return 'text' in r ? { text: r.text, from: 'pdf' } : r
}

/** The pictures on a clipboard paste (a screenshot copied with Win+Shift+S, a photo copied on a phone). */
export function pastedPictures(data: DataTransfer | null): File[] {
  return [...(data?.files ?? [])].filter(f => f.type.startsWith('image/') && f.type !== 'image/svg+xml')
}
