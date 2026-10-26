// Playwright screenshots of the page shell (U-std iii). Needs the dev server: npm run dev -- --port 5199
// Uses the dev-only ?devRole= session, so no Supabase credentials are involved.
// Usage: node scripts/shell-screenshots.mjs [outDir] [baseUrl]
import { mkdirSync } from 'node:fs'
import { chromium } from '@playwright/test'

const out = process.argv[2] ?? 'docs/design/review/u01-u02'
const base = process.argv[3] ?? 'http://localhost:5199'
mkdirSync(out, { recursive: true })

const browser = await chromium.launch({ channel: 'chrome' })
const shots = [
  { name: 'shell-admin-1440', role: 'admin', path: '/todo', w: 1440, h: 520 },
  { name: 'shell-sales-1440', role: 'sales', path: '/rfqs', w: 1440, h: 520 },
  { name: 'shell-engineer-1440', role: 'engineer', path: '/todo', w: 1440, h: 520 },
  { name: 'shell-engineer-no-money-1440', role: 'engineer', path: '/money', w: 1440, h: 520 },
  { name: 'shell-admin-768', role: 'admin', path: '/money', w: 768, h: 520 },
  { name: 'shell-admin-375', role: 'admin', path: '/todo', w: 375, h: 700, mobile: true },
  { name: 'shell-engineer-375', role: 'engineer', path: '/todo', w: 375, h: 700, mobile: true },
]
for (const s of shots) {
  const ctx = await browser.newContext({
    viewport: { width: s.w, height: s.h },
    deviceScaleFactor: 1,
    hasTouch: !!s.mobile,
    isMobile: !!s.mobile,
  })
  const page = await ctx.newPage()
  await page.goto(`${base}${s.path}?devRole=${s.role}`)
  await page.evaluate(() => document.fonts.ready)
  await page.waitForTimeout(300)
  await page.screenshot({ path: `${out}/${s.name}.png` })
  await ctx.close()
}
await browser.close()
console.log('wrote', shots.length, 'screenshots to', out)
