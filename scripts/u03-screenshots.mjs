// Playwright screenshots for U03, U07 and U08 (U-std iii): each primitive state is photographed from the
// dev preview page (/dev/primitives?scene=...) and from the live shell, then set beside the matching
// D08 reference crop. Needs the dev server: npm run dev -- --port 5199
// Usage: node scripts/u03-screenshots.mjs [outDir] [baseUrl]
import { mkdirSync, readFileSync } from 'node:fs'
import { chromium } from '@playwright/test'

const out = process.argv[2] ?? 'docs/design/review/u03-u07-u08'
const base = process.argv[3] ?? 'http://localhost:5199'
mkdirSync(out, { recursive: true })
const refDir = 'docs/design/screens'

const browser = await chromium.launch({ channel: 'chrome' })

/** Each shot: name, viewport, url, optional steps, optional clip selector, and the reference crop [file, x, y, w, h]. */
const shots = [
  { name: 'dialog-default', w: 652, h: 342, scene: 'dialog-default', ref: ['components-05-dialog.png', 16, 197, 652, 342] },
  { name: 'dialog-busy', w: 652, h: 342, scene: 'dialog-busy', ref: ['components-05-dialog.png', 692, 197, 652, 342] },
  { name: 'dialog-error', w: 652, h: 382, scene: 'dialog-error', ref: ['components-05-dialog.png', 16, 617, 652, 382] },
  { name: 'dialog-confirm', w: 652, h: 342, scene: 'dialog-confirm', ref: ['components-05-dialog.png', 692, 617, 652, 342] },
  { name: 'dialog-long', w: 652, h: 422, scene: 'dialog-long', ref: ['components-05-dialog.png', 16, 1099, 652, 422] },
  { name: 'dialog-sheet-375', w: 375, h: 430, scene: 'dialog-default', mobile: true, ref: ['components-05-dialog.png', 692, 1077, 377, 430] },
  { name: 'money-record-payment', w: 900, h: 460, scene: 'money-dialog', ref: ['money-03-admin-record-payment-dialog.png', 0, 0, 0, 0] },
  { name: 'form-validation', w: 460, h: 440, scene: 'form-validation', clip: 'form', ref: ['components-04-form.png', 16, 175, 427, 433] },
  { name: 'form-unique', w: 460, h: 360, scene: 'form-unique', ref: ['components-04-form.png', 467, 197, 427, 343] },
  { name: 'form-submitting', w: 460, h: 320, scene: 'form-submitting', ref: ['components-04-form.png', 917, 175, 427, 305] },
  { name: 'form-failure', w: 700, h: 360, scene: 'form-failure', ref: ['components-04-form.png', 125, 1166, 1198, 68] },
  { name: 'controls', w: 1260, h: 520, scene: 'controls', focus: '[data-preview-focus]', ref: ['components-01-controls.png', 16, 607, 1328, 380] },
  {
    name: 'combobox-open',
    w: 520,
    h: 340,
    scene: 'combobox',
    steps: async p => {
      await p.locator('[data-preview-combo]').click()
      await p.keyboard.type('Ind')
    },
    clip: '[data-preview-combo-wrap]',
    ref: ['components-01-controls.png', 16, 1009, 427, 290],
  },
  { name: 'segmented-tabs-breadcrumb', w: 1260, h: 520, scene: 'misc', ref: ['components-11-segmented-control.png', 16, 100, 1328, 300] },
  {
    name: 'tooltip-focus',
    w: 520,
    h: 200,
    scene: 'overlays',
    steps: async p => {
      await p.keyboard.press('Tab')
    },
    ref: ['components-10-tooltip.png', 16, 175, 427, 120],
  },
  {
    name: 'popover-menu',
    w: 520,
    h: 360,
    scene: 'overlays',
    steps: async p => {
      await p.locator('[data-preview-menu]').click()
    },
    ref: ['components-13-more-primitives.png', 467, 197, 427, 196],
  },
  {
    name: 'popover-information',
    w: 520,
    h: 360,
    scene: 'overlays',
    steps: async p => {
      await p.locator('[data-preview-info]').click()
    },
    ref: ['components-13-more-primitives.png', 917, 197, 427, 196],
  },
  { name: 'palette-idle', w: 652, h: 562, scene: 'palette-idle', ref: ['components-07-command-palette.png', 16, 175, 652, 562] },
  { name: 'palette-typing', w: 652, h: 562, scene: 'palette-typing', type: 'indus', ref: ['components-07-command-palette.png', 692, 197, 652, 562] },
  { name: 'palette-empty', w: 652, h: 362, scene: 'palette-empty', type: 'belimo gaskets', ref: ['components-07-command-palette.png', 16, 837, 652, 362] },
  { name: 'toast-undo', w: 420, h: 88, scene: 'toast-undo', wait: 3000, ref: ['components-08-toast-with-undo.png', 37, 229, 380, 56] },
  { name: 'toast-settled', w: 420, h: 88, scene: 'toast-settled', wait: 1800, ref: ['components-08-toast-with-undo.png', 37, 478, 380, 56] },
  { name: 'toast-error', w: 420, h: 88, scene: 'toast-error', ref: ['components-08-toast-with-undo.png', 713, 472, 380, 56] },
  { name: 'toast-plain', w: 420, h: 88, scene: 'toast-plain', ref: ['components-08-toast-with-undo.png', 37, 828, 380, 56] },
  { name: 'toast-undo-today-b2', w: 1000, h: 140, scene: 'toast-undo', wait: 3000, ref: ['today-b2-03-2-copied.png', 514, 875, 380, 56] },
  { name: 'feedback-toggle-callout-inline', w: 940, h: 220, scene: 'feedback', ref: ['components-13-more-primitives.png', 16, 197, 880, 400] },
  { name: 'files-resting', w: 427, h: 210, scene: 'files-resting', ref: ['components-01-controls.png', 16, 1401, 427, 206] },
  {
    name: 'files-drag-over',
    w: 427,
    h: 210,
    scene: 'files-resting',
    steps: async p => {
      await p.evaluate(() => {
        const zone = document.querySelector('[aria-label="Add files"]')
        const dt = new DataTransfer()
        dt.items.add(new File(['a'], 'a.png', { type: 'image/png' }))
        dt.items.add(new File(['b'], 'b.png', { type: 'image/png' }))
        zone.dispatchEvent(new DragEvent('dragenter', { bubbles: true, cancelable: true, dataTransfer: dt }))
      })
    },
    ref: ['components-01-controls.png', 467, 1447, 427, 180],
  },
  { name: 'files-rows', w: 427, h: 150, scene: 'files-rows', ref: ['components-01-controls.png', 917, 1401, 427, 132] },
  {
    name: 'shell-account-menu-1440',
    w: 1440,
    h: 300,
    url: `${base}/today?devRole=sales`,
    steps: async p => {
      await p.getByRole('button', { name: /Account menu/ }).first().click()
    },
    ref: null,
  },
  {
    name: 'shell-palette-ctrl-k-1440',
    w: 1440,
    h: 560,
    url: `${base}/today?devRole=admin`,
    steps: async p => {
      await p.keyboard.press('Control+K')
    },
    ref: null,
  },
]

for (const s of shots) {
  const VW = s.w < 768 && !s.mobile ? 800 : s.w
  const ctx = await browser.newContext({ viewport: { width: VW, height: s.h }, deviceScaleFactor: 1, hasTouch: !!s.mobile, isMobile: !!s.mobile })
  const page = await ctx.newPage()
  await page.goto(s.url ?? `${base}/dev/primitives?scene=${s.scene}`)
  await page.evaluate(() => document.fonts.ready)
  await page.waitForTimeout(450)
  if (s.focus) {
    await page.locator(s.focus).focus()
    await page.keyboard.press('Shift+Tab')
    await page.keyboard.press('Tab')
  }
  if (s.type) await page.keyboard.type(s.type)
  if (s.steps) await s.steps(page)
  await page.waitForTimeout(s.wait ?? 350)
  const clip = s.w < 768 && !s.mobile ? { x: /^(dialog|palette)/.test(s.name) ? (VW - s.w) / 2 : /^toast/.test(s.name) ? VW - s.w : /^files/.test(s.name) ? 24 : 0, y: /^files/.test(s.name) ? 24 : 0, width: s.w, height: s.h } : undefined
  await page.screenshot({ path: `${out}/${s.name}.png`, clip })
  await ctx.close()
}

// Side by side: reference crop on the left, the build on the right.
const ctx = await browser.newContext({ viewport: { width: 1400, height: 800 }, deviceScaleFactor: 1 })
const page = await ctx.newPage()
const b64 = path => readFileSync(path).toString('base64')
let made = 0
for (const s of shots) {
  if (!s.ref) continue
  const [file, x, y, w, h] = s.ref
  const mine = b64(`${out}/${s.name}.png`)
  const ref = b64(`${refDir}/${file}`)
  const crop = w && h ? `width:${w}px;height:${h}px;background:url(data:image/png;base64,${ref}) -${x}px -${y}px no-repeat` : `width:600px;height:${Math.round(s.h)}px;background:url(data:image/png;base64,${ref}) 0 0/100% auto no-repeat`
  await page.setContent(`<body style="margin:0;padding:16px;background:#fff;font:12px/16px system-ui;color:#333">
    <div style="display:flex;gap:24px;align-items:flex-start">
      <div><div style="margin-bottom:6px">Reference: ${file}</div><div style="${crop};outline:1px solid #ccc"></div></div>
      <div><div style="margin-bottom:6px">Build: ${s.name}</div><img style="display:block;outline:1px solid #ccc" src="data:image/png;base64,${mine}"></div>
    </div></body>`)
  await page.screenshot({ path: `${out}/compare-${s.name}.png`, fullPage: true })
  made++
}
await ctx.close()
await browser.close()
console.log('wrote', shots.length, 'screenshots and', made, 'comparisons to', out)
