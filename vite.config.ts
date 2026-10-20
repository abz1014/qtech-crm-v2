import { readFileSync } from 'node:fs'
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
  const api = new URL(process.env.API_URL ?? 'http://127.0.0.1:54321').origin
  const all = json.headers.find(h => h.source === '/(.*)')?.headers ?? []
  return Object.fromEntries(
    all.filter(h => h.key !== 'Strict-Transport-Security').map(h => [h.key, h.value.replaceAll('https://yafbphagorydbitfgfmg.supabase.co', api)]),
  )
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
 * Which build wrote the saved query cache (src/lib/queryPersist.ts): a cache from another build is dropped, because a
 * deploy may change what a query returns. The commit when the host provides one (so a rebuild of the same commit keeps
 * the cache and the entry chunk's hash), else the build time.
 */
const BUILD_ID = process.env.VERCEL_GIT_COMMIT_SHA || process.env.CF_PAGES_COMMIT_SHA || process.env.GITHUB_SHA || Date.now().toString(36)

export default defineConfig(({ command, mode }) => ({
  define: { __APP_BUILD__: JSON.stringify(BUILD_ID) },
  plugins: [
    react(),
    supabasePreconnect(loadEnv(mode, process.cwd(), 'VITE_').VITE_SUPABASE_URL),
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
              globPatterns: ['index.html', 'assets/**/*.{js,css,woff2}', 'favicon.ico', 'favicon-32.png', 'manifest.webmanifest', 'brand/*.png'],
              // The PDF renderer (react-pdf, about 1.5 MB raw / 500 KB brotli: the quotation and the supplier PO share it) is a lazy chunk
              // used by few screens and few people; it is fetched on demand, not precached, so every install and every deploy that changes it
              // does not cost each phone half a megabyte. Its file name follows whichever module the bundler picks to name the shared chunk
              // (it is termLines-* today, render-* before), so it is recognised by size, not by name: anything over 1 MB is left out of the
              // precache list (the largest shell chunk is about half of that). The two small pdf/render chunks (about 10 KB each) ARE
              // precached now (the old `render-*` glob ignore was written for the renderer and had gone stale). A window left on an old build
              // that then misses the renderer after a deploy is moved onto the new build by src/lib/importWithReload.ts.
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
  preview: { headers: previewHeaders() },
  resolve: { alias: { '@': path.resolve(__dirname, 'src') } },
  test: {
    environment: 'jsdom',
    setupFiles: ['src/test/setup.ts'],
    // designGuards.test.ts starts ESLint in-process; the first lint takes 2 to 10 s on a cold or busy machine.
    testTimeout: 30_000,
    include: ['src/**/*.test.{ts,tsx}', 'scripts/**/*.test.mjs'],
  },
}))
