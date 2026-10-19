// Bundle budget (P04). Pure helpers: given the files of a built dist/, work out what a first visit downloads.
import { readFileSync, statSync } from 'node:fs'
import { join, posix } from 'node:path'
import { gzipSync } from 'node:zlib'

export const INITIAL_JS_BUDGET_BYTES = 300 * 1024

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

export const kb = n => `${(n / 1024).toFixed(1)} KB`
