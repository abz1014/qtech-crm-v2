import { Font, pdf } from '@react-pdf/renderer'
import sans400 from '@fontsource/geist-sans/files/geist-sans-latin-400-normal.woff?url'
import sans500 from '@fontsource/geist-sans/files/geist-sans-latin-500-normal.woff?url'
import sans600 from '@fontsource/geist-sans/files/geist-sans-latin-600-normal.woff?url'
import mono400 from '@fontsource/geist-mono/files/geist-mono-latin-400-normal.woff?url'
import mono500 from '@fontsource/geist-mono/files/geist-mono-latin-500-normal.woff?url'
import { QuotationDocument } from '@/features/quotations/pdf/QuotationDocument'
import type { PdfData } from '@/features/quotations/api'
import type { CompanyProfile } from '@/features/settings/companyProfile'

/*
 * The lazy chunk's entry. Importing this file pulls in @react-pdf/renderer, the Geist faces and the document, so it is
 * only ever reached through `import('./pdf/render')` in generate.ts. The faces are the same Geist the app uses (the
 * @fontsource files, WOFF: react-pdf reads WOFF and TTF, not WOFF2). They are fetched when the first PDF is made.
 */
// react-pdf calls Buffer.isBuffer() on an image source; a browser has no Buffer, and the call only logs a warning.
if (!('Buffer' in globalThis)) (globalThis as unknown as { Buffer: { isBuffer: () => boolean } }).Buffer = { isBuffer: () => false }

let ready = false
function registerFonts(): void {
  if (ready) return
  Font.register({
    family: 'Geist',
    fonts: [
      { src: sans400, fontWeight: 400 },
      { src: sans500, fontWeight: 500 },
      { src: sans600, fontWeight: 600 },
    ],
  })
  Font.register({
    family: 'Geist Mono',
    fonts: [
      { src: mono400, fontWeight: 400 },
      { src: mono500, fontWeight: 500 },
    ],
  })
  // Never break a word with a hyphen: a model code or an NTN must stay whole.
  Font.registerHyphenationCallback(word => [word])
  ready = true
}

export async function renderQuotationPdf(data: PdfData, profile: CompanyProfile): Promise<Blob> {
  registerFonts()
  const logoSrc = new URL(`${import.meta.env.BASE_URL}brand/logo-wordmark.png`, window.location.origin).href
  return pdf(<QuotationDocument data={data} profile={profile} logoSrc={logoSrc} />).toBlob()
}
