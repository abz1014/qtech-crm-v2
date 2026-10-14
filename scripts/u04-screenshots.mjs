// Playwright screenshots of the U04/U05/U06 review gallery (U-std iii). Needs the dev server:
//   npm run dev -- --port 5198
// Writes one PNG per gallery section, and a side-by-side (reference | build) for each matching D08 screen.
// Usage: node scripts/u04-screenshots.mjs [outDir] [baseUrl]
import { mkdirSync, readFileSync, existsSync } from 'node:fs'
import { chromium } from '@playwright/test'

const out = process.argv[2] ?? 'docs/design/review/u04-u06'
const base = process.argv[3] ?? 'http://localhost:5198'
mkdirSync(out, { recursive: true })

// gallery section id -> reference PNG in docs/design/screens (omit for sections with no reference)
const compare = {
  status: 'components-02-statusbadge.png',
  money: 'components-03-money.png',
  rfq: 'components-06-datatable.png',
  register: 'money-02-admin-gst-register-month-stamping.png',
  cash: 'money-07-admin-cash-month-by-payment-date.png',
  margins: 'money-08-admin-order-margins.png',
}

const browser = await chromium.launch({ channel: 'chrome' })
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 })
const page = await ctx.newPage()
await page.goto(`${base}/gallery-u04.html`)
await page.evaluate(() => document.fonts.ready)
await page.waitForTimeout(300)
await page.addStyleTag({ content: '*{animation:none!important;transition:none!important}' })

const ids = ['status', 'money', 'sumbar', 'rfq', 'register', 'cash', 'margins']
for (const id of ids) {
  await page.locator(`#${id}`).screenshot({ path: `${out}/build-${id}.png` })
}

// side by side: reference left, build right, scaled to the same width
const sbs = await ctx.newPage()
for (const [id, ref] of Object.entries(compare)) {
  const refPath = `docs/design/screens/${ref}`
  if (!existsSync(refPath)) continue
  const a = readFileSync(refPath).toString('base64')
  const b = readFileSync(`${out}/build-${id}.png`).toString('base64')
  await sbs.setContent(
    `<body style="margin:0;background:#fff;font:12px sans-serif"><div style="display:flex;gap:16px;align-items:flex-start;padding:8px">
      <figure style="margin:0;width:700px"><figcaption>Reference: ${ref}</figcaption><img style="width:100%" src="data:image/png;base64,${a}"></figure>
      <figure style="margin:0;width:700px"><figcaption>Build: gallery #${id}</figcaption><img style="width:100%" src="data:image/png;base64,${b}"></figure></div></body>`,
  )
  await sbs.setViewportSize({ width: 1440, height: 800 })
  await sbs.screenshot({ path: `${out}/compare-${id}.png`, fullPage: true })
}
await browser.close()
console.log('wrote screenshots to', out)
