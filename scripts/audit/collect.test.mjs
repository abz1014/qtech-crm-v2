import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { chromium } from '@playwright/test'
import { collect } from '../../e2e/audit/collect'

/*
 * labelTouchesControl in a real browser (e2e/audit/collect.ts runs inside a page, so jsdom has no layout to test it on).
 * The shell is not fixed: <main> scrolls between the top bar and the bottom tabs, so text under the tabs and a control scrolled
 * below the fold are never drawn on each other. A label that really sits on a field, or text inside an (i) button's footprint, still counts.
 */
let browser = null
let page
let source = ''
// The CI unit-test step runs before Chromium is installed: without a browser these tests skip (they run wherever one is installed).
try {
  browser = await chromium.launch()
} catch {
  browser = null
}

const SHELL = body => `<!doctype html><meta name="viewport" content="width=375"><style>
  body{margin:0;font:16px/20px sans-serif} .shell{display:grid;height:100vh;grid-template-rows:auto minmax(0,1fr) auto}
  main{overflow-y:auto;position:relative} .bar{height:44px} .tabs{height:44px;display:flex;gap:16px}
  .tip{position:relative;display:inline-grid;width:24px;height:24px;place-items:center;vertical-align:middle}
  .tip.touch{width:44px;height:44px;margin:-10px}
</style><div class="shell"><header class="bar"><button>Back</button></header><main id="main">${body}</main><nav class="tabs"><span>To do</span><span>Jobs</span></nav></div>`

async function count(body) {
  await page.setContent(SHELL(body))
  const m = await page.evaluate(`(${source})({ phone: true, root: null })`)
  return m.layout.labelTouchesControl.count
}

beforeAll(async () => {
  source = collect.toString()
  if (browser) page = await browser.newPage({ viewport: { width: 375, height: 600 } })
}, 60_000)
afterAll(async () => {
  await browser?.close()
})

describe.skipIf(!browser)('labelTouchesControl', () => {
  it('still catches a label drawn on a field in the same page area', async () => {
    const n = await count(`<p style="margin:0;height:20px">Quantity</p><input style="margin-top:-10px;width:200px;height:40px"><div style="height:200px"></div>`)
    expect(n).toBe(1)
  })
  it('ignores a control scrolled below the fold that shares screen coordinates with the bottom tabs', async () => {
    const n = await count(`<div style="height:520px">Top</div><textarea style="width:300px;height:80px"></textarea>`)
    expect(n).toBe(0)
  })
  it('ignores a heading next to the 44px touch (i) button, whose padding overlaps by design', async () => {
    const n = await count(`<h2 style="margin:20px 0"><span>Items and prices</span><span class="tip touch"><button data-infotip style="width:100%;height:100%">i</button></span></h2>`)
    expect(n).toBe(0)
  })
  it('still catches text inside the (i) footprint', async () => {
    const n = await count(`<div style="position:relative;margin:20px 0;height:30px"><button data-infotip style="position:absolute;left:20px;top:0;width:44px;height:44px">i</button><span style="display:block;padding-left:30px;line-height:20px">Overlap text</span></div>`)
    expect(n).toBe(1)
  })
})
