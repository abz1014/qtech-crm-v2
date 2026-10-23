import { compressIfImage } from '@/lib/imageCompress'

/*
 * File intake for FileDrop (U07): every file that is dropped, pasted or chosen
 * is shrunk first when it is an image (src/lib/imageCompress), then checked
 * against the size limit and the allowed types. Nothing is rejected silently:
 * a file that cannot be added comes back with a plain `error` the FileRow shows.
 */
export const DEFAULT_MAX_BYTES = 5 * 1024 * 1024
export const DEFAULT_ACCEPT = ['image/png', 'image/jpeg', 'application/pdf']
/** A customer's spreadsheet (.xlsx, .xls, .csv): an RFQ file, read on New RFQ like a PDF (src/lib/docread/sheetText.ts). */
export const SHEET_ACCEPT = [
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel',
  'text/csv',
] as const

const TYPE_LABEL: Record<string, string> = {
  'application/pdf': 'PDF',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'XLSX',
  'application/vnd.ms-excel': 'XLS',
  'text/csv': 'CSV',
}

export interface AddedFile {
  id: string
  /** The file to upload: compressed when it was an image. */
  file: File
  /** Size before compression, for the "3.8 MB → 640 KB" note. */
  originalSize: number
  error?: string
}

export function formatBytes(n: number): string {
  if (n >= 1024 * 1024) return `${Number((n / (1024 * 1024)).toFixed(1))} MB`
  return `${Math.max(1, Math.round(n / 1024))} KB`
}

export const acceptLabel = (accept: readonly string[]) =>
  accept.map(t => TYPE_LABEL[t] ?? t.replace('image/', '').replace('jpeg', 'jpg').toUpperCase()).join(', ')

/**
 * Phones often hand over a HEIC photo with no type (or a generic one), and a spreadsheet comes with no type, a generic one or
 * "application/csv" depending on the device. The extension then says what it is.
 */
function withKnownType(file: File): File {
  const sheet = /\.(xlsx|xlsm|xls|csv)$/i.exec(file.name)
  if (sheet && !(SHEET_ACCEPT as readonly string[]).includes(file.type)) {
    const ext = (sheet[1] as string).toLowerCase()
    const type = ext === 'csv' ? 'text/csv' : ext === 'xls' ? 'application/vnd.ms-excel' : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    return new File([file], file.name, { type, lastModified: file.lastModified })
  }
  if (file.type && file.type !== 'application/octet-stream') return file
  const m = /\.(heic|heif)$/i.exec(file.name)
  return m ? new File([file], file.name, { type: `image/${m[1].toLowerCase()}`, lastModified: file.lastModified }) : file
}

export async function intakeFiles(
  files: readonly File[],
  { maxBytes = DEFAULT_MAX_BYTES, accept = DEFAULT_ACCEPT }: { maxBytes?: number; accept?: readonly string[] } = {},
): Promise<AddedFile[]> {
  return Promise.all(
    files.map(async picked => {
      const original = withKnownType(picked)
      const id = crypto.randomUUID()
      if (!accept.includes(original.type)) {
        return { id, file: original, originalSize: original.size, error: `Only ${acceptLabel(accept)} files can be added.` }
      }
      let file = original
      try {
        file = await compressIfImage(original)
      } catch {
        // a photo that cannot be decoded is kept as it is; the limit below still applies
      }
      const error = file.size > maxBytes ? `${formatBytes(file.size)}. The limit is ${formatBytes(maxBytes)}.` : undefined
      return { id, file, originalSize: original.size, error }
    }),
  )
}
