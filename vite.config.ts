import path from 'node:path'
import react from '@vitejs/plugin-react-swc'
import { VitePWA } from 'vite-plugin-pwa'
import { defineConfig } from 'vitest/config'

export default defineConfig(({ command }) => ({
  plugins: [
    react(),
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
              // App shell only: built JS, CSS, HTML, fonts, and the brand and icon images.
              globPatterns: ['index.html', 'assets/**/*.{js,css,woff2}', '*.{png,ico,webmanifest}', 'brand/*.png'],
              // The PDF renderer (react-pdf, 1.5 MB: the quotation and the supplier PO share it) is a lazy chunk used by few screens; it is
              // fetched on demand, not precached. Its file name follows whichever module the bundler picks to name the shared chunk, so it is
              // recognised by size, not by name: anything over 1 MB is left out of the precache list (the largest shell chunk is about half of that; the renderer is 1.5 MB or more).
              globIgnores: ['**/assets/render-*'],
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
  resolve: { alias: { '@': path.resolve(__dirname, 'src') } },
  test: {
    environment: 'jsdom',
    setupFiles: ['src/test/setup.ts'],
    // designGuards.test.ts starts ESLint in-process; the first lint takes 2 to 10 s on a cold or busy machine.
    testTimeout: 30_000,
    include: ['src/**/*.test.{ts,tsx}', 'scripts/**/*.test.mjs'],
  },
}))
