import path from 'node:path'
import react from '@vitejs/plugin-react-swc'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  plugins: [react()],
  resolve: { alias: { '@': path.resolve(__dirname, 'src') } },
  test: {
    environment: 'jsdom',
    // designGuards.test.ts starts ESLint in-process; the first lint takes 2 to 5 s on a cold or busy machine.
    testTimeout: 20_000,
    include: ['src/**/*.test.{ts,tsx}'],
  },
})
