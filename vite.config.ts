import { readFileSync } from 'node:fs'
import http from 'node:http'
import { createRequire } from 'node:module'
import path from 'node:path'
import react from '@vitejs/plugin-react-swc'
import { loadEnv, type Plugin } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'
import { defineConfig } from 'vitest/config'

/*
 * P04: with E2E_CSP=1 the preview server sends the production security headers from vercel.json (the real Content-Security-Policy
 * included), with the Supabase project origin swapped for the local CI stack (API_URL). The e2e suites then run under the policy
 * that production enforces, and the perf suite fails on any violation. Off by default: nothing else changes.
 */
function previewHeaders(): Record<string, string> | undefined {
  if (!process.env.E2E_CSP) return undefined
  const json = JSON.parse(readFileSync(path.resolve(__dirname, 'vercel.json'), 'utf8')) as { headers: Array<{ source: string; headers: Array<{ key: string; value: string }> }> }
  // E2E_APP_API_URL: the origin the app build talks to when it is not the stack itself (the perf suite's HTTPS proxy).
  const api = new URL(process.env.E2E_APP_API_URL ?? process.env.API_URL ?? 'http://127.0.0.1:54321').origin
  const all = json.headers.find(h => h.source === '/(.*)')?.headers ?? []
  return Object.fromEntries(
    all.filter(h => h.key !== 'Strict-Transport-Security').map(h => [h.key, h.value.replaceAll('https://yafbphagorydbitfgfmg.supabase.co', api)]),
  )
}

/*
 * The rest of vercel.json's headers on the preview server (E2E_CSP=1 only): the per-path rules, such as the year-long
 * `immutable` cache on /assets/ and `no-cache` on /sw.js, so the e2e suites see the caching production sends. vite preview
 * already compresses (gzip, about the size Vercel's brotli is for these files: 191 KB against 195 KB for the entry chunk).
 */
function vercelPathHeaders(): Plugin {
  return {
    name: 'qtech-vercel-path-headers',
    configurePreviewServer(server) {
      if (!process.env.E2E_CSP) return
      const json = JSON.parse(readFileSync(path.resolve(__dirname, 'vercel.json'), 'utf8')) as { headers: Array<{ source: string; headers: Array<{ key: string; value: string }> }> }
      const rules = json.headers
        .filter(h => h.source !== '/(.*)')
        .map(h => ({ test: new RegExp(`^${h.source.replaceAll('.', '\\.').replaceAll('(\\.*)', '.*')}$`), headers: h.headers }))
      server.middlewares.use((req, res, next) => {
        const url = (req.url ?? '').split('?')[0] ?? ''
        for (const rule of rules) if (rule.test.test(url)) for (const h of rule.headers) res.setHeader(h.key, h.value)
        next()
      })
    },
  }
}

/*
 * perf/lcp: database requests go to the site's own /rest/v1/, which vercel.json rewrites to the Supabase project (src/lib/supabase.ts
 * says why). Built that way on Vercel (VERCEL=1 during its builds) and for the perf suite (E2E_SAME_ORIGIN_REST=1); everywhere else
 * (the other e2e suites, a local dev server, the Cloudflare fallback) the app talks to Supabase directly, as before.
 */
const REST_SAME_ORIGIN = process.env.VERCEL === '1' || process.env.E2E_SAME_ORIGIN_REST === '1'

/*
 * The preview server does what vercel.json's /rest/v1/ rewrite does, for the perf suite: it forwards those requests to the local stack
 * (API_URL), so the suite measures the page the way production serves it. Nothing else is forwarded.
 */
function vercelRestRewrite(): Plugin {
  return {
    name: 'qtech-vercel-rest-rewrite',
    configurePreviewServer(server) {
      if (process.env.E2E_SAME_ORIGIN_REST !== '1' || !process.env.API_URL) return
      const target = new URL(process.env.API_URL)
      const hop = new Set(['connection', 'keep-alive', 'proxy-connection', 'transfer-encoding', 'upgrade', 'http2-settings', 'te', 'host'])
      server.middlewares.use((req, res, next) => {
        if (!(req.url ?? '').startsWith('/rest/v1/')) return next()
        const headers: Record<string, string | string[]> = { host: target.host }
        for (const [name, value] of Object.entries(req.headers)) if (value !== undefined && !name.startsWith(':') && !hop.has(name)) headers[name] = value
        const out = http.request({ hostname: target.hostname, port: target.port, method: req.method, path: req.url, headers }, up => {
          for (const [name, value] of Object.entries(up.headers)) if (value !== undefined && !hop.has(name)) res.setHeader(name, value)
          res.statusCode = up.statusCode ?? 502
          up.pipe(res)
        })
        out.on('error', () => {
          res.statusCode = 502
          res.end()
        })
        req.pipe(out)
      })
    },
  }
}

/*
 * perf/lcp: the app's one stylesheet (about 18 KB compressed) goes into index.html as a <style> element instead of a separate
 * render-blocking request. On a phone the page then needs one round trip less before anything can be drawn, and the page's
 * code starts downloading straight after the HTML instead of after the stylesheet. The Content-Security-Policy allows inline
 * styles (style-src 'unsafe-inline'), not inline scripts; the font and image URLs inside are absolute, so they resolve as before.
 */
function inlineStylesheet(): Plugin {
  return {
    name: 'qtech-inline-stylesheet',
    apply: 'build',
    // After every other plugin's generateBundle: the HTML is written and the preload lists are filled in by then.
    generateBundle: {
      order: 'post',
      handler(_options, bundle) {
        const html = bundle['index.html']
        if (!html || html.type !== 'asset' || typeof html.source !== 'string') return
        const entry = Object.values(bundle).find(c => c.type === 'chunk' && c.isEntry)
        if (!entry) return
        const inlined: string[] = []
        html.source = html.source.replace(/<link rel="stylesheet"(?: crossorigin)? href="\/(assets\/[^"]+\.css)">/g, (tag, file: string) => {
          const css = bundle[file]
          if (!css || css.type !== 'asset') return tag
          delete bundle[file]
          inlined.push(file)
          return `<style>${String(css.source).replaceAll('</style', '<\\/style')}</style>`
        })
        // A lazy chunk's preload list names the CSS of the chunks it imports, the entry's included: the preload helper would
        // fetch the file that is now inline. Each such entry points at the entry chunk instead, which is already loaded (a
        // no-op), so the list keeps its length and every other index in it.
        for (const chunk of Object.values(bundle)) {
          if (chunk.type !== 'chunk') continue
          for (const file of inlined) chunk.code = chunk.code.replaceAll(`"${file}"`, `"${entry.fileName}"`)
        }
      },
    },
  }
}

/*
 * Production serves the app over HTTPS and HTTP/2 (Vercel). The perf suite (scripts/ci/e2e-run.sh) passes a throwaway
 * self-signed certificate in E2E_TLS_KEY and E2E_TLS_CERT, and vite preview then serves HTTP/2 over TLS like production:
 * Lighthouse's simulated Slow 4G models HTTP/1.1 as six connections per origin, each with its own handshake, and HTTP/2 as one
 * multiplexed connection, so plain HTTP/1.1 measured a page load production never has. Off by default.
 */
function previewTls(): { key: Buffer; cert: Buffer } | undefined {
  const key = process.env.E2E_TLS_KEY
  const cert = process.env.E2E_TLS_CERT
  return key && cert ? { key: readFileSync(key), cert: readFileSync(cert) } : undefined
}

/*
 * Performance audit 2.1/4: the first request to Supabase pays DNS, TCP and TLS before the session lookup can start. A
 * preconnect (plus dns-prefetch for older browsers) to the build's own Supabase origin starts that while the script
 * loads. Taken from VITE_SUPABASE_URL, so production gets https://yafbphagorydbitfgfmg.supabase.co and the e2e build
 * its local stack (which the e2e Content-Security-Policy allows); nothing is added when the variable is missing.
 */
function supabasePreconnect(url: string | undefined): Plugin {
  let origin: string | null = null
  try {
    origin = url ? new URL(url).origin : null
  } catch {
    origin = null
  }
  return {
    name: 'qtech-supabase-preconnect',
    transformIndexHtml: () =>
      origin
        ? [
            { tag: 'link', attrs: { rel: 'preconnect', href: origin, crossorigin: '' }, injectTo: 'head' },
            { tag: 'link', attrs: { rel: 'dns-prefetch', href: origin }, injectTo: 'head' },
          ]
        : [],
  }
}

/*
 * The picture reader (src/lib/docread/imageText.ts, owner priority 2026-10-20): tesseract.js runs on the device, so its worker,
 * its WebAssembly engine and the English language data must be served by this site (the CSP allows `worker-src 'self'`,
 * `connect-src 'self'` and `'wasm-unsafe-eval'`, no CDN). tesseract.js finds them by fixed file name next to each other, so they
 * are not hashed: they go under one directory named after the package versions (assets/ocr/<versions>/), which keeps the
 * `immutable` cache header on /assets/ safe. They are written only when a build contains the reader (src/lib/docread/ocrRuntime.ts),
 * are never precached (globIgnores below), and the dev server serves them straight from node_modules.
 */
const requireFromHere = createRequire(import.meta.url)
const pkgDir = (name: string) => path.dirname(requireFromHere.resolve(`${name}/package.json`))
const pkgVersion = (name: string) => (JSON.parse(readFileSync(path.join(pkgDir(name), 'package.json'), 'utf8')) as { version: string }).version
const OCR_DIR = `assets/ocr/t${pkgVersion('tesseract.js')}-c${pkgVersion('tesseract.js-core')}-e${pkgVersion('@tesseract.js-data/eng')}/`
/** Published name -> source file. The LSTM-only engine in two builds: with WebAssembly SIMD (most devices) and without. */
const OCR_FILES: Record<string, () => string> = {
  'worker.min.js': () => path.join(pkgDir('tesseract.js'), 'dist', 'worker.min.js'),
  'tesseract-core-simd-lstm.js': () => path.join(pkgDir('tesseract.js-core'), 'tesseract-core-simd-lstm.js'),
  'tesseract-core-simd-lstm.wasm': () => path.join(pkgDir('tesseract.js-core'), 'tesseract-core-simd-lstm.wasm'),
  'tesseract-core-lstm.js': () => path.join(pkgDir('tesseract.js-core'), 'tesseract-core-lstm.js'),
  'tesseract-core-lstm.wasm': () => path.join(pkgDir('tesseract.js-core'), 'tesseract-core-lstm.wasm'),
  // The integer "best" English model, LSTM only: about 3 MB gzipped.
  'eng.traineddata.gz': () => path.join(pkgDir('@tesseract.js-data/eng'), '4.0.0_best_int', 'eng.traineddata.gz'),
}

function ocrAssets(): Plugin {
  const mime: Record<string, string> = { '.js': 'text/javascript', '.wasm': 'application/wasm', '.gz': 'application/gzip' }
  return {
    name: 'qtech-ocr-assets',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = (req.url ?? '').split('?')[0] ?? ''
        const prefix = `${server.config.base}${OCR_DIR}`
        const source = url.startsWith(prefix) ? OCR_FILES[url.slice(prefix.length)] : undefined
        if (!source) return next()
        res.setHeader('Content-Type', mime[path.extname(url)] ?? 'application/octet-stream')
        res.end(readFileSync(source()))
      })
    },
    generateBundle() {
      if (![...this.getModuleIds()].some(id => id.replaceAll('\\', '/').endsWith('/src/lib/docread/ocrRuntime.ts'))) return
      for (const [name, source] of Object.entries(OCR_FILES)) this.emitFile({ type: 'asset', fileName: `${OCR_DIR}${name}`, source: readFileSync(source()) })
    },
  }
}

/*
 * Which build wrote the saved query cache (src/lib/queryPersist.ts): a cache from another build is dropped, because a
 * deploy may change what a query returns. The commit when the host provides one (so a rebuild of the same commit keeps
 * the cache and the entry chunk's hash), else the build time.
 */
const BUILD_ID = process.env.VERCEL_GIT_COMMIT_SHA || process.env.CF_PAGES_COMMIT_SHA || process.env.GITHUB_SHA || Date.now().toString(36)

export default defineConfig(({ command, mode }) => ({
  define: { __APP_BUILD__: JSON.stringify(BUILD_ID), __OCR_DIR__: JSON.stringify(OCR_DIR), __REST_SAME_ORIGIN__: JSON.stringify(REST_SAME_ORIGIN) },
  plugins: [
    react(),
    ocrAssets(),
    supabasePreconnect(loadEnv(mode, process.cwd(), 'VITE_').VITE_SUPABASE_URL),
    vercelPathHeaders(),
    vercelRestRewrite(),
    inlineStylesheet(),
    // Builds src/sw.ts into dist/sw.js and injects the precache list (R21). Build only: the dev server and Vitest
    // run without a worker. The manifest is the hand-written public/manifest.webmanifest.
    ...(command === 'build'
      ? [
          VitePWA({
            strategies: 'injectManifest',
            srcDir: 'src',
            filename: 'sw.ts',
            injectRegister: false,
            manifest: false,
            registerType: 'prompt',
            injectManifest: {
              // App shell only: built JS, CSS, HTML, fonts, the favicons, the manifest and the two brand images the shell shows.
              // The install icons (192, 512, maskable 512, apple-touch-icon) are left out: the browser fetches them, online,
              // only when the app is installed, and they were a large share of the precache (performance audit 3.1).
              globPatterns: ['index.html', 'assets/**/*.{js,css,woff2}', 'favicon.ico', 'favicon-32.png', 'manifest.webmanifest', 'brand/*.{png,webp,avif}'],
              // The PDF renderer (react-pdf, about 1.5 MB raw / 500 KB brotli: the quotation and the supplier PO share it) is a lazy chunk
              // used by few screens and few people; it is fetched on demand, not precached, so every install and every deploy that changes it
              // does not cost each phone half a megabyte. Its file name follows whichever module the bundler picks to name the shared chunk
              // (it is termLines-* today, render-* before), so it is recognised by size, not by name: anything over 1 MB is left out of the
              // precache list (the largest shell chunk is about half of that). The two small pdf/render chunks (about 10 KB each) ARE
              // precached now (the old `render-*` glob ignore was written for the renderer and had gone stale). A window left on an old build
              // that then misses the renderer after a deploy is moved onto the new build by src/lib/importWithReload.ts.
              // The PDF reader (pdf.js, src/lib/docread/pdfjsRuntime.ts: its lazy chunk and its worker) is fetched the first time a
              // PDF is read, not stored on every phone either.
              // The picture reader (tesseract.js, src/lib/docread/ocrRuntime.ts: its lazy chunk, and its worker, engine and language
              // data under assets/ocr/) is the same: about 6 MB, fetched the first time a picture is read.
              globIgnores: ['**/assets/pdfjsRuntime-*', '**/assets/pdf.worker*', '**/assets/ocrRuntime-*', '**/assets/ocr/**'],
              maximumFileSizeToCacheInBytes: 5_000_000,
              manifestTransforms: [
                async entries => ({
                  manifest: entries.filter(e => e.size <= 1_000_000),
                  warnings: [],
                }),
              ],
            },
          }),
        ]
      : []),
  ],
  preview: { headers: previewHeaders(), https: previewTls() },
  resolve: { alias: { '@': path.resolve(__dirname, 'src') } },
  test: {
    environment: 'jsdom',
    setupFiles: ['src/test/setup.ts'],
    // designGuards.test.ts starts ESLint in-process; the first lint takes 2 to 10 s on a cold or busy machine.
    testTimeout: 30_000,
    include: ['src/**/*.test.{ts,tsx}', 'scripts/**/*.test.mjs'],
  },
}))
