// pdf.js, loaded only when a PDF is read (pdfText.ts imports this module dynamically, so it is its own lazy chunk and is
// never part of the first load). The legacy build is used: it runs on the older phone browsers the modern build drops.
//
// The worker is bundled from node_modules as a same-origin file (`?url`): the CSP allows `worker-src 'self'` only, so no CDN.
// It is not precached by the service worker (vite.config.ts), like the PDF renderer: it is fetched the first time a PDF is read.
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs'
import workerUrl from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url'

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl

export { pdfjs }
