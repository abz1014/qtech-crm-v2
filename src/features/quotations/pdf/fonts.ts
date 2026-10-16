import { Font } from '@react-pdf/renderer'
import sans400 from '@fontsource/geist-sans/files/geist-sans-latin-400-normal.woff?url'
import sans500 from '@fontsource/geist-sans/files/geist-sans-latin-500-normal.woff?url'
import sans600 from '@fontsource/geist-sans/files/geist-sans-latin-600-normal.woff?url'
import mono400 from '@fontsource/geist-mono/files/geist-mono-latin-400-normal.woff?url'
import mono500 from '@fontsource/geist-mono/files/geist-mono-latin-500-normal.woff?url'

/*
 * The PDF fonts, shared by every generated document (the quotation, the supplier PO). Importing this file pulls in @react-pdf/renderer,
 * so it is only ever reached through a lazy import of a document's render module. The faces are the same Geist the app uses
 * (the @fontsource files, WOFF: react-pdf reads WOFF and TTF, not WOFF2). They are fetched when the first PDF is made.
 */
// react-pdf calls Buffer.isBuffer() on an image source; a browser has no Buffer, and the call only logs a warning.
if (!('Buffer' in globalThis)) (globalThis as unknown as { Buffer: { isBuffer: () => boolean } }).Buffer = { isBuffer: () => false }

let ready = false
export function registerFonts(): void {
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

