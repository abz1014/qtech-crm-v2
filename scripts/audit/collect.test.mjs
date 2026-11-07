import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { chromium } from '@playwright/test'
import { collect } from '../../e2e/audit/collect'
import { budgetKey, ratchetBudgets, ratchetFailures, ratchetUnbudgeted } from './report.lib.mjs'

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

describe.skipIf(!browser)('clarity metrics', () => {
  const clarity = async body => {
    await page.setContent(SHELL(body))
    return (await page.evaluate(`(${source})({ phone: true, root: null })`)).clarity
  }
  const BOX = 'border:1px solid #888;border-radius:6px;width:300px;height:80px'
  it('reads firstWorkY from the first visible [data-work], and null without one', async () => {
    expect((await clarity(`<div style="height:100px"></div><div data-work style="height:50px">Work</div>`)).firstWorkY).toBe(44 + 100)
    expect((await clarity(`<p>Nothing</p>`)).firstWorkY).toBeNull()
  })
  it('counts nested boxes as a chain and leaves controls and small boxes out', async () => {
    const c = await clarity(`<div style="${BOX};padding:4px"><div style="${BOX.replace('80px', '60px')}"><div style="${BOX.replace('80px', '30px')}"></div></div></div><button style="${BOX}">Go</button><div style="border:1px solid #888;border-radius:6px;width:20px;height:20px"></div>`)
    expect(c.boxDepth).toBe(3)
  })
  it('counts the boxes seen in the first screen (above and across the fold, not below it)', async () => {
    const c = await clarity(`<div style="${BOX}"></div><div style="height:380px"></div><div style="${BOX.replace('80px', '120px')}"></div><div style="height:100px"></div><div style="${BOX}"></div>`)
    expect(c.boxesAtFold).toBe(2)
  })
  it('measures the tallest step row, and ignores a page without steps', async () => {
    const c = await clarity(`<div data-stages><div data-fold-row><button style="height:48px">Quote</button></div><div data-fold-row><button style="height:60px">Order</button></div></div>`)
    expect(c.stepRowMax).toBe(60)
    expect((await clarity(`<p>x</p>`)).stepRowMax).toBeNull()
  })
})

/** A measured capture with the ratchet's numbers. */
const rc = (screen, over = {}) => ({
  role: 'admin',
  screen,
  viewport: '375x812',
  status: 'ok',
  metrics: { contentHeight: 1200, actions: { aboveFold: 8 }, clarity: { firstWorkY: 200, boxDepth: 2, boxesAtFold: 3, stepRowMax: 48 }, ...over },
})

describe('the clarity ratchet', () => {
  const base = [rc('job-paid')]
  const budgets = ratchetBudgets(base)
  const withClarity = patch => rc('job-paid', { clarity: { firstWorkY: 200, boxDepth: 2, boxesAtFold: 3, stepRowMax: 48, ...patch } })

  it('keys budgets by role/screen/viewport and keeps every number', () => {
    expect(budgetKey(base[0])).toBe('admin/job-paid/375x812')
    expect(budgets['admin/job-paid/375x812']).toEqual({ firstWorkY: 200, boxDepth: 2, boxesAtFold: 3, stepRowMax: 48, contentHeight: 1200, aboveFold: 8 })
  })
  it('passes a value equal to its budget', () => {
    expect(ratchetFailures(base, budgets)).toEqual([])
  })
  it('passes a value better than its budget', () => {
    expect(ratchetFailures([withClarity({ boxDepth: 1, firstWorkY: 150 })], budgets)).toEqual([])
  })
  it('fails a count that is worse by one', () => {
    const f = ratchetFailures([withClarity({ boxDepth: 3 })], budgets)
    expect(f).toHaveLength(1)
    expect(f[0]).toMatchObject({ metric: 'boxDepth', value: 3, budget: 2, tolerance: 0 })
    expect(ratchetFailures([rc('job-paid', { actions: { aboveFold: 9 } })], budgets).map(r => r.metric)).toEqual(['aboveFold'])
  })
  it('gives heights and Y values 8 px, no more', () => {
    expect(ratchetFailures([withClarity({ firstWorkY: 208, stepRowMax: 56 })], budgets)).toEqual([])
    expect(ratchetFailures([rc('job-paid', { contentHeight: 1208 })], budgets)).toEqual([])
    const f = ratchetFailures([withClarity({ firstWorkY: 209, stepRowMax: 57 }), rc('job-paid', { contentHeight: 1209 })].slice(0, 1), budgets)
    expect(f.map(r => r.metric).sort()).toEqual(['firstWorkY', 'stepRowMax'])
    expect(ratchetFailures([rc('job-paid', { contentHeight: 1209 })], budgets).map(r => r.metric)).toEqual(['contentHeight'])
  })
  it('reports a capture with no budget and never fails it', () => {
    const other = rc('job-unknown', { clarity: { firstWorkY: 999, boxDepth: 9, boxesAtFold: 9, stepRowMax: 999 } })
    expect(ratchetFailures([other], budgets)).toEqual([])
    expect(ratchetUnbudgeted([other, ...base], budgets)).toEqual(['admin/job-unknown/375x812'])
  })
  it('skips a metric the screen does not have, and captures that did not load', () => {
    const noSteps = rc('job-paid', { clarity: { firstWorkY: null, boxDepth: 2, boxesAtFold: 3, stepRowMax: null } })
    expect(ratchetFailures([noSteps], budgets)).toEqual([])
    expect(ratchetFailures([{ ...rc('job-paid'), status: 'error', metrics: undefined }], budgets)).toEqual([])
    expect(ratchetBudgets([noSteps])['admin/job-paid/375x812']).toEqual({ boxDepth: 2, boxesAtFold: 3, contentHeight: 1200, aboveFold: 8 })
  })
})
