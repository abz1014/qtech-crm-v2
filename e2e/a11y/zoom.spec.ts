import type { Page } from '@playwright/test'
import { waitForAnimationsToFinish } from '../support/axe'
import { BUGS, SCREENS, UI, ZOOM_BANDS, knownBug, expect, layoutProblems, open, overlayProblems, test, type World } from './support'

/*
 * (b) The owner's zoom bands (WCAG 1.4.10 reflow, 1.4.4 resize text): 1366 at 200%, 175% and 125%, and the 320x256 reflow box.
 * Every main screen: nothing scrolls sideways (the page or #main) and no title runs out of the window or is cut off. Every overlay
 * that matters: it lies inside the window, with its title and Close button on screen.
 *
 * Zooming changes the window size of a page that is already open, so a screen is loaded once and the window is resized through the
 * bands (the layout and the media queries the components read follow the resize, as they do when the owner zooms).
 */

async function atEveryBand(page: Page, check: () => Promise<string[]>): Promise<string[]> {
  const out: string[] = []
  for (const band of ZOOM_BANDS) {
    await page.setViewportSize({ width: band.width, height: band.height })
    await page.waitForLoadState('networkidle')
    await waitForAnimationsToFinish(page)
    for (const p of await check()) out.push(`${band.name}: ${p}`)
  }
  return out
}

for (const s of SCREENS) {
  test(`${s.name}: no sideways scroll and no title cut off at any zoom band`, async ({ page, world }) => {
    await page.setViewportSize({ width: ZOOM_BANDS[0].width, height: ZOOM_BANDS[0].height })
    await open(page, s.path(world))
    expect(await atEveryBand(page, () => layoutProblems(page))).toEqual([])
  })
}

/** Overlays that open on a screen, each with the way to open it at any width. */
const OVERLAYS: ReadonlyArray<{ name: string; bug?: keyof typeof BUGS; open: (page: Page, w: World) => Promise<void> }> = [
  {
    name: 'Capture sheet',
    open: async page => {
      await open(page, '/todo')
      await page.getByRole('button', { name: UI.capture }).filter({ visible: true }).first().click()
      await expect(page.getByRole('dialog', { name: UI.captureSheet })).toBeVisible()
    },
  },
  {
    name: 'Issue quotation dialog',
    open: async (page, w) => {
      await open(page, `/rfqs/${w.rfq.id}`)
      // The header button from 768 up; below it the same action is in the sticky bar at the foot.
      await page.locator('[data-slot="issue-quotation"], [data-action-bar]').getByRole('button', { name: UI.issue }).filter({ visible: true }).first().click()
      await expect(page.getByRole('dialog')).toBeVisible()
    },
  },
  {
    name: 'Issue PO dialog',
    open: async (page, w) => {
      await open(page, `/orders/${w.order.id}`)
      await page.getByRole('button', { name: UI.issuePoLegA }).filter({ visible: true }).first().click()
      await expect(page.getByRole('dialog')).toBeVisible()
    },
  },
  {
    name: 'Invoice detail dialog',
    open: async (page, w) => {
      await open(page, `/money/gst-register?invoice=${w.invoice.id}`)
      await expect(page.getByRole('dialog', { name: new RegExp(w.invoice.number) })).toBeVisible()
    },
  },
  {
    name: 'Add expenses sheet',
    open: async page => {
      await open(page, '/money/expenses')
      await page.getByRole('button', { name: UI.addExpenses }).click()
      await expect(page.getByRole('dialog')).toBeVisible()
    },
  },
  {
    name: 'Command palette',
    open: async page => {
      await open(page, '/todo')
      await page.keyboard.press('Control+k')
      await expect(page.getByRole('dialog', { name: UI.palette })).toBeVisible()
    },
  },
  {
    name: 'Account menu',
    open: async page => {
      await open(page, '/todo')
      await page.getByRole('button', { name: UI.accountMenu }).filter({ visible: true }).first().click()
      await expect(page.getByRole('menu')).toBeVisible()
    },
  },
]

for (const o of OVERLAYS) {
  test(`${o.name}: inside the window at every zoom band`, async ({ page, world }) => {
    if (o.bug) knownBug(BUGS[o.bug])
    const out: string[] = []
    // Opened afresh at each band: a menu does not follow a resize (it closes), and a phone opens a sheet, not a dialog.
    for (const band of ZOOM_BANDS) {
      await page.setViewportSize({ width: band.width, height: band.height })
      await o.open(page, world)
      await waitForAnimationsToFinish(page)
      for (const p of await overlayProblems(page)) out.push(`${band.name}: ${p}`)
    }
    expect(out).toEqual([])
  })
}
