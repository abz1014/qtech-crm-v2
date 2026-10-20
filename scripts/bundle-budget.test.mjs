import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { hasSupabaseClient, initialJs, OCR_SIGNATURE, ocrInInitial, ocrReaderFiles, pdfjsInInitial, pdfReaderFiles, PDFJS_SIGNATURE, staticJsRefs } from './bundle-budget.lib.mjs'

describe('bundle budget helpers', () => {
  it('reads script and modulepreload refs from the html', () => {
    const html = '<script type="module" crossorigin src="/assets/index-A.js"></script><link rel="modulepreload" crossorigin href="/assets/vendor-B.js">'
    expect(staticJsRefs(html, { html: true }).sort()).toEqual(['/assets/index-A.js', '/assets/vendor-B.js'])
  })

  it('follows static imports and ignores dynamic ones', () => {
    const js = 'import{a as b}from"./vendor-B.js";import"./side-C.js";const l=()=>import("./lazy-D.js");export{b}'
    expect(staticJsRefs(js).sort()).toEqual(['./side-C.js', './vendor-B.js'])
  })

  it('sums the initial files of a built dist', () => {
    const dist = mkdtempSync(join(tmpdir(), 'budget-'))
    mkdirSync(join(dist, 'assets'))
    writeFileSync(join(dist, 'index.html'), '<script type="module" src="/assets/index-A.js"></script>')
    writeFileSync(join(dist, 'assets', 'index-A.js'), 'import"./vendor-B.js";import("./lazy-D.js");' + 'x'.repeat(1000))
    writeFileSync(join(dist, 'assets', 'vendor-B.js'), 'y'.repeat(500))
    writeFileSync(join(dist, 'assets', 'lazy-D.js'), 'z'.repeat(5000))
    const r = initialJs(dist)
    expect([...r.files.keys()].sort()).toEqual(['assets/index-A.js', 'assets/vendor-B.js'])
  })

  it('refuses a build without the Supabase client (built without VITE_SUPABASE_*, it under-measures production)', () => {
    const build = withClient => {
      const dist = mkdtempSync(join(tmpdir(), 'budget-'))
      mkdirSync(join(dist, 'assets'))
      writeFileSync(join(dist, 'index.html'), '<script type="module" src="/assets/index-A.js"></script>')
      writeFileSync(join(dist, 'assets', 'index-A.js'), 'import"./vendor-B.js";')
      writeFileSync(join(dist, 'assets', 'vendor-B.js'), withClient ? 'const a=new URL("auth/v1",b);' : 'const getSupabase=()=>null;')
      return dist
    }
    const withIt = build(true)
    const without = build(false)
    expect(hasSupabaseClient(withIt, initialJs(withIt))).toBe(true)
    expect(hasSupabaseClient(without, initialJs(without))).toBe(false)
  })

  it('finds the PDF reader files and tells when pdf.js is in the first load', () => {
    const dist = mkdtempSync(join(tmpdir(), 'budget-'))
    mkdirSync(join(dist, 'assets'))
    writeFileSync(join(dist, 'index.html'), '<script type="module" src="/assets/index-A.js"></script>')
    writeFileSync(join(dist, 'assets', 'index-A.js'), 'import("./pdfjsRuntime-x1Y2.js");')
    writeFileSync(join(dist, 'assets', 'pdfjsRuntime-x1Y2.js'), `throw new Error('No "${PDFJS_SIGNATURE}" specified.')`)
    writeFileSync(join(dist, 'assets', 'pdf.worker.min-Ab_9.mjs'), 'w'.repeat(100))
    const listing = ['assets/index-A.js', 'assets/pdfjsRuntime-x1Y2.js', 'assets/pdf.worker.min-Ab_9.mjs']
    expect(pdfReaderFiles(dist, listing).map(f => f.file)).toEqual(['assets/pdfjsRuntime-x1Y2.js', 'assets/pdf.worker.min-Ab_9.mjs'])
    expect(pdfjsInInitial(dist, initialJs(dist))).toEqual([])
    writeFileSync(join(dist, 'assets', 'index-A.js'), 'import"./pdfjsRuntime-x1Y2.js";')
    expect(pdfjsInInitial(dist, initialJs(dist))).toEqual(['assets/pdfjsRuntime-x1Y2.js'])
  })

  it('finds the picture reader files (chunk, worker, engine, language data) and tells when it is in the first load', () => {
    const dist = mkdtempSync(join(tmpdir(), 'budget-'))
    const dir = join(dist, 'assets', 'ocr', 't7.0.0-c7.0.0-e1.0.0')
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dist, 'index.html'), '<script type="module" src="/assets/index-A.js"></script>')
    writeFileSync(join(dist, 'assets', 'index-A.js'), 'import("./ocrRuntime-Q1.js");')
    writeFileSync(join(dist, 'assets', 'ocrRuntime-Q1.js'), `const d="${OCR_SIGNATURE}7.0.0-c7.0.0-e1.0.0/";`)
    for (const f of ['worker.min.js', 'tesseract-core-simd-lstm.wasm', 'eng.traineddata.gz']) writeFileSync(join(dir, f), 'o'.repeat(50))
    const listing = ['assets/index-A.js', 'assets/ocrRuntime-Q1.js', 'assets/ocr']
    expect(ocrReaderFiles(dist, listing).map(f => f.file)).toEqual([
      'assets/ocrRuntime-Q1.js',
      'assets/ocr/t7.0.0-c7.0.0-e1.0.0/eng.traineddata.gz',
      'assets/ocr/t7.0.0-c7.0.0-e1.0.0/tesseract-core-simd-lstm.wasm',
      'assets/ocr/t7.0.0-c7.0.0-e1.0.0/worker.min.js',
    ])
    expect(ocrInInitial(dist, initialJs(dist))).toEqual([])
    writeFileSync(join(dist, 'assets', 'index-A.js'), 'import"./ocrRuntime-Q1.js";')
    expect(ocrInInitial(dist, initialJs(dist))).toEqual(['assets/ocrRuntime-Q1.js'])
  })
})
