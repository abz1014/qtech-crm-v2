// pdfjs-dist ships no types for its worker module. Tests import it for its side effect only: under Node it sets
// globalThis.pdfjsWorker, which pdf.js then runs in-process instead of starting a worker.
declare module 'pdfjs-dist/legacy/build/pdf.worker.mjs'
