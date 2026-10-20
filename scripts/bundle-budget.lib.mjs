// Bundle budget (P04). Pure helpers: given the files of a built dist/, work out what a first visit downloads.
import { readFileSync, statSync } from 'node:fs'
import { join, posix } from 'node:path'
import { gzipSync } from 'node:zlib'

/*
 * The limit on what a first visit downloads and runs, gzipped. Measured on a production-equivalent build (ci.yml sets dummy
 * VITE_SUPABASE_* so the Supabase client is bundled as in production; `hasSupabaseClient` refuses a build without it).
 * Audit 2 (performance §1.6): the old 300 KB gate measured a build without the client (about 220 KB) while production was
 * 278 KB. Set about 5% above the real entry (257.5 KB on perf/client), so a regression fails instead of eating hidden
 * headroom. Lower it when the entry shrinks. Round 2 (r2/fast-reads): the lazy sign-in page took the entry to 221.8 KB; limit 240 KB.
 */
// 2026-10-20: temporarily 245 KB (main reached 239.9 after the round-2 merges); perf/trim brings it back under 230 and lowers this to 235.
export const INITIAL_JS_BUDGET_BYTES = 245 * 1024

/** Local asset paths a JS or HTML source points at: <script src>, <link rel=modulepreload href>, and static `import ... from "./x.js"`. */
export function staticJsRefs(source, { html = false } = {}) {
  const refs = new Set()
  if (html) {
    for (const m of source.matchAll(/<script[^>]*\ssrc="([^"]+\.js)"/g)) refs.add(m[1])
    for (const m of source.matchAll(/<link[^>]*rel="modulepreload"[^>]*href="([^"]+\.js)"/g)) refs.add(m[1])
    for (const m of source.matchAll(/<link[^>]*href="([^"]+\.js)"[^>]*rel="modulepreload"/g)) refs.add(m[1])
  } else {
    // `from"./x.js"` and bare `import"./x.js"`; a dynamic `import("./x.js")` has a parenthesis and is not matched.
    for (const m of source.matchAll(/(?:\bfrom|\bimport)\s*["'](\.{1,2}\/[^"']+\.js)["']/g)) refs.add(m[1])
  }
  return [...refs]
}

const gz = buf => gzipSync(buf, { level: 9 }).length

/** Walks index.html and its static JS imports. Returns every file a first visit must run, with raw and gzip sizes. */
export function initialJs(distDir) {
  const files = new Map()
  const queue = staticJsRefs(readFileSync(join(distDir, 'index.html'), 'utf8'), { html: true }).map(r => r.replace(/^\//, ''))
  while (queue.length > 0) {
    const rel = queue.shift()
    if (files.has(rel)) continue
    const buf = readFileSync(join(distDir, rel))
    files.set(rel, { raw: buf.length, gzip: gz(buf) })
    for (const ref of staticJsRefs(buf.toString('utf8'))) {
      const next = posix.join(rel, '..', ref)
      if (!files.has(next)) queue.push(next)
    }
  }
  const total = { raw: 0, gzip: 0 }
  for (const f of files.values()) {
    total.raw += f.raw
    total.gzip += f.gzip
  }
  return { files, total }
}

/**
 * True when the initial JS contains the Supabase client (its `auth/v1` endpoint literal). Without VITE_SUPABASE_URL and
 * VITE_SUPABASE_ANON_KEY at build time `getSupabase()` folds to null and the client is tree-shaken away, so the entry
 * measures about 40 KB gzip lighter than production.
 */
export function hasSupabaseClient(distDir, initial) {
  for (const rel of initial.files.keys()) if (/["'`]auth\/v1["'`]/.test(readFileSync(join(distDir, rel), 'utf8'))) return true
  return false
}

/** The largest JS chunk that is not part of the initial load: in this app, the lazy PDF renderer (react-pdf). */
export function largestLazyChunk(distDir, initial, listing) {
  let best = null
  for (const rel of listing.filter(f => f.endsWith('.js') && f.startsWith('assets/'))) {
    if (initial.files.has(rel)) continue
    const buf = readFileSync(join(distDir, rel))
    if (!best || buf.length > best.raw) best = { file: rel, raw: buf.length, gzip: gz(buf) }
  }
  return best
}

/** The service worker's precache list, read back from the built dist/sw.js (workbox injects `{"revision":..,"url":..}` entries, key order not fixed). */
export function precacheSize(distDir) {
  const sw = readFileSync(join(distDir, 'sw.js'), 'utf8')
  const urls = [...sw.matchAll(/"url":"([^"]+)"/g)].map(m => m[1])
  let raw = 0
  let gzip = 0
  for (const u of urls) {
    const buf = readFileSync(join(distDir, u.split('?')[0]))
    raw += buf.length
    gzip += gz(buf)
  }
  return { urls, entries: urls.length, raw, gzip, swRaw: statSync(join(distDir, 'sw.js')).size, swGzip: gz(readFileSync(join(distDir, 'sw.js'))) }
}

/** A string only pdf.js's main module carries: if it is in the first load, the PDF reader is no longer lazy. */
export const PDFJS_SIGNATURE = 'GlobalWorkerOptions.workerSrc'

/**
 * The PDF reader (pdf.js, src/lib/docread): its lazy chunk (named after pdfjsRuntime.ts) and its worker (copied as
 * assets/pdf.worker.min-<hash>.mjs). Empty until a screen imports src/lib/docread/pdfText.ts.
 */
export function pdfReaderFiles(distDir, listing) {
  return listing
    .filter(f => /^assets\/pdfjsRuntime-[\w-]+\.js$/.test(f) || /^assets\/pdf\.worker(?:\.min)?-[\w-]+\.m?js$/.test(f))
    .map(f => {
      const buf = readFileSync(join(distDir, f))
      return { file: f, raw: buf.length, gzip: gz(buf) }
    })
}

/** Initial files that carry pdf.js. */
export function pdfjsInInitial(distDir, initial) {
  return [...initial.files.keys()].filter(f => readFileSync(join(distDir, f), 'utf8').includes(PDFJS_SIGNATURE))
}

export const kb = n => `${(n / 1024).toFixed(1)} KB`
