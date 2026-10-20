import { readPdfText, type PdfSubject } from '@/lib/docread/pdfText'

/** Reads one PDF on this device: the text, or the reader's plain sentence to show instead (a scan, a locked or damaged file). */
export async function readPdf(file: File, subject: PdfSubject): Promise<{ text: string } | { message: string }> {
  const r = await readPdfText(file, { subject })
  if (r.ok) return { text: r.text }
  return { message: r.message || 'This PDF could not be read.' }
}
