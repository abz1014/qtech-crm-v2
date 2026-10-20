// tesseract.js, loaded only when a picture is read (imageText.ts imports this module dynamically, so it is its own lazy chunk
// and never part of the first load). Everything runs on the device; nothing is uploaded.
//
// Its worker, its WebAssembly engine and the English language data are served by this site from assets/ocr/<versions>/
// (vite.config.ts, ocrAssets): the CSP allows `worker-src 'self'`, `connect-src 'self'` and `'wasm-unsafe-eval'` only, so
// no CDN, and the worker is started from its own URL (a blob: worker would be refused). Like pdf.js they are not precached:
// they are fetched the first time a picture is read, then come from the HTTP cache.
import Tesseract from 'tesseract.js/dist/tesseract.esm.min.js'

declare const __OCR_DIR__: string

export type OcrWorker = import('tesseract.js').Worker
export type OcrPage = import('tesseract.js').Page
export interface OcrLog {
  status: string
  progress: number
}

/** WebAssembly SIMD (a 1-function module that uses it validates): most phones and laptops since 2021. */
const SIMD_PROBE = new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1, 0, 10, 10, 1, 8, 0, 65, 0, 253, 15, 253, 98, 11])

function hasSimd(): boolean {
  try {
    return WebAssembly.validate(SIMD_PROBE)
  } catch {
    return false
  }
}

export function ocrBase(): string {
  return new URL(`${import.meta.env.BASE_URL}${__OCR_DIR__}`, window.location.href).href
}

/** A started worker with English loaded, LSTM engine only (the smaller engine and data). */
export async function createOcrWorker(onLog: (m: OcrLog) => void): Promise<OcrWorker> {
  const base = ocrBase()
  return Tesseract.createWorker('eng', Tesseract.OEM.LSTM_ONLY, {
    workerPath: `${base}worker.min.js`,
    workerBlobURL: false,
    // A file, not a directory: tesseract.js would otherwise probe for the build itself and ask for the larger *.wasm.js files.
    corePath: `${base}${hasSimd() ? 'tesseract-core-simd-lstm.js' : 'tesseract-core-lstm.js'}`,
    langPath: base.replace(/\/$/, ''),
    gzip: true,
    // The browser's HTTP cache keeps the language data; no second copy in IndexedDB.
    cacheMethod: 'none',
    logger: m => onLog({ status: m.status, progress: m.progress }),
  })
}

export const PSM = Tesseract.PSM
