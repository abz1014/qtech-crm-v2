// The pdf.js worker entry. pdf.js 6's worker calls Promise.withResolvers, which Chrome < 119 and Safari < 17.4 (older staff
// phones) lack, and a worker has its own globals, so the polyfill installed on the page does not reach it. This module runs
// the polyfill first (imports evaluate in order) and then the stock worker, which starts itself on import. Bundled by Vite as a
// same-origin module worker: the CSP allows `worker-src 'self'` and needs no eval.
import './promiseWithResolvers'
import 'pdfjs-dist/legacy/build/pdf.worker.min.mjs'
