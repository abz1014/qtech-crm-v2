import type { Page } from '@playwright/test'
import { must, rest, type Role } from '../support/stack'
import type { Fixture } from './seed'

/*
 * What the screen audit visits (docs/audit/SCREEN_AUDIT.md). One entry per screen or flow; the runner visits each one for every
 * role listed, at every viewport. Routes and button names change as the UX work lands: this is the one list to adjust.
 *
 * A flow (New RFQ) captures several screens in one pass, because each step needs the one before it.
 */

export interface CaptureOptions {
  /** Scroll this element to the top of the view before measuring (the fold then starts there). */
  scrollTo?: string
  /**
   * Measure inside this element instead of <main>, for a dialog (it is outside <main>); everything outside it counts as covered.
   * The full-page shot then grows the viewport by what the dialog's own scroller hides.
   */
  root?: string
}
export type Capture = (screen: string, opts?: CaptureOptions) => Promise<void>
export interface Visit {
  /** Unique id; also the screen id for a single-screen visit. */
  id: string
  title: string
  roles: readonly Role[]
  /** 'layout': only in the layout set (AUDIT_SET=layout), never in the standard audit. */
  set?: 'layout' | 'opened'
  /** The screen ids this visit captures, in order (a flow has several). */
  screens: readonly string[]
  run: (page: Page, fx: Fixture, capture: Capture) => Promise<void>
}

const ALL = ['admin', 'sales', 'engineer'] as const
const MONEY = ['admin', 'sales'] as const
const ADMIN = ['admin'] as const

/** Waits until the screen has loaded: the shell, no request in flight, no skeleton, fonts in, animations done. */
export async function settle(page: Page): Promise<void> {
  await page.locator('#main').waitFor({ timeout: 20_000 })
  await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => undefined)
  await page
    .waitForFunction(() => !document.querySelector('#main .skeleton, #main [aria-busy="true"]'), undefined, { timeout: 10_000 })
    .catch(() => undefined)
  await page.evaluate(() => document.fonts.ready.then(() => undefined))
}

export async function open(page: Page, path: string): Promise<void> {
  await page.goto(path, { waitUntil: 'domcontentloaded' })
  await settle(page)
}

function screen(id: string, title: string, roles: readonly Role[], path: (fx: Fixture) => string, opts?: CaptureOptions): Visit {
  return {
    id,
    title,
    roles,
    screens: [id],
    run: async (page, fx, capture) => {
      await open(page, path(fx))
      await capture(id, opts)
    },
  }
}

/** Clicks the first visible, enabled button whose name matches one of `names` (old and new wording), or throws. */
async function press(page: Page, names: RegExp[], what: string): Promise<void> {
  for (const name of names) {
    const all = page.getByRole('button', { name })
    const n = await all.count()
    for (let i = 0; i < n; i++) {
      const b = all.nth(i)
      if ((await b.isVisible()) && (await b.isEnabled())) {
        await b.click()
        await settle(page)
        return
      }
    }
  }
  throw new Error(`no visible, enabled button for "${what}" (tried ${names.map(String).join(', ')})`)
}

/** Like press, but answers false instead of throwing when no such button is there. */
async function tryPress(page: Page, names: RegExp[], what: string): Promise<boolean> {
  return press(page, names, what).then(
    () => true,
    () => false,
  )
}

const DIALOG = '[role="dialog"]'

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/**
 * Types the company and chooses it. The list is searched as you type, so a click can land on a result that is about to be replaced
 * (full run 39381813101: the click was lost and the list stayed open); the choice counts once the list has closed, else it is retried.
 */
async function pickCompany(page: Page, name: string): Promise<void> {
  const combo = page.getByRole('combobox', { name: /company/i }).first()
  for (let attempt = 1; attempt <= 3; attempt++) {
    await combo.fill(name)
    await settle(page)
    await page.getByRole('option', { name: new RegExp(escape(name)) }).first().click()
    const closed = await page
      .getByRole('listbox')
      .first()
      .waitFor({ state: 'hidden', timeout: 4_000 })
      .then(() => true)
      .catch(() => false)
    if (closed) return
  }
  throw new Error(`could not choose the company "${name}"`)
}

/** New RFQ, steps 1 to 4: items read from a pasted enquiry, suppliers, the message, sent. Wording covers the old and the plain-words names. */
const newRfq: Visit = {
  id: 'rfq-new',
  title: 'New RFQ, steps 1 to 4',
  roles: ALL,
  screens: ['rfq-new-1-items', 'rfq-new-2-suppliers', 'rfq-new-3-message', 'rfq-new-4-sent'],
  run: async (page, fx, capture) => {
    await open(page, '/rfqs/new')
    // A saved draft (or any preference) from an earlier visit is cleared; the Supabase session (sb-*) is kept.
    await page.evaluate(() => {
      for (const k of Object.keys(localStorage)) if (!k.startsWith('sb-')) localStorage.removeItem(k)
    })
    await open(page, '/rfqs/new')
    await pickCompany(page, fx.intake.customerName)
    // The screen listens for a paste anywhere; this is what Ctrl+V with nothing focused delivers.
    await page.evaluate(t => {
      const dt = new DataTransfer()
      dt.setData('text/plain', t)
      document.body.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }))
    }, fx.intake.paste)
    await page.getByText(/\d+ items? found/i).first().waitFor({ timeout: 10_000 }).catch(() => undefined)
    await settle(page)
    await capture('rfq-new-1-items')

    await press(page, [/find suppliers/i, /looks right/i, /choose suppliers/i, /^next/i], 'go to suppliers')
    await capture('rfq-new-2-suppliers')

    // At least one supplier must be ticked to write the message.
    const ticked = await page.locator('#main [role="checkbox"][aria-checked="true"], #main input[type="checkbox"]:checked').count()
    if (ticked === 0) await page.locator('#main').getByRole('checkbox').first().check({ force: true })
    await press(page, [/write the (enquiry|message)/i, /write (a )?message/i, /^next/i], 'write the message')
    await capture('rfq-new-3-message')

    await press(page, [/copy (&|and) mark/i, /copy message for/i, /^ask \d+ suppliers?/i, /mark (as )?sent/i, /^copy (the )?message/i], 'copy and mark sent')
    await page
      .getByText(/out for prices|waiting for prices|sent to \d+|asked \d+ supplier|copied\. paste/i)
      .first()
      .waitFor({ timeout: 10_000 })
      .catch(() => undefined)
    await settle(page)
    // The supplier rows load a moment after the page; the green moves from Open RFQ to the first Open in WhatsApp with a colour transition.
    // Wait for the rows and let it finish, or the measure reads a green in between.
    await page.locator('[data-slot="send-to-each"]').waitFor({ timeout: 5_000 }).catch(() => undefined)
    await page.waitForTimeout(700)
    await capture('rfq-new-4-sent')
  },
}

/** Fails with `what` if `step` has not finished within `ms`: a step can never hang a visit (the runner then records an error and moves on). */
export async function bounded<T>(ms: number, what: string, step: () => Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const late = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${what}: not done within ${ms / 1000} s`)), ms)
  })
  try {
    return await Promise.race([step(), late])
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Closes whatever dialog is open (Escape, then its Close or Cancel button), and if one is still there, opens Today afresh: the next
 * visit starts from a page with no dialog. Never throws.
 */
async function closeDialogs(page: Page): Promise<void> {
  const dialog = page.locator(DIALOG).first()
  const gone = (ms: number) =>
    dialog.waitFor({ state: 'hidden', timeout: ms }).then(
      () => true,
      () => false,
    )
  if (!(await dialog.isVisible().catch(() => false))) return
  await page.keyboard.press('Escape').catch(() => undefined)
  if (await gone(3_000)) return
  await page
    .locator(DIALOG)
    .getByRole('button', { name: /^(close|cancel)$/i })
    .filter({ visible: true })
    .first()
    .click({ timeout: 3_000 })
    .catch(() => undefined)
  if (await gone(3_000)) return
  await open(page, '/todo').catch(() => undefined)
}

/** The Issue quotation dialog, opened from an RFQ with prices in (the green button; its ?issue=1 address if no button is found). */
const issueQuotation: Visit = {
  id: 'issue-quotation',
  title: 'Issue quotation dialog',
  roles: MONEY,
  screens: ['issue-quotation'],
  run: async (page, fx, capture) => {
    const dialog = page.locator(DIALOG).first()
    try {
      await bounded(60_000, 'open Issue quotation', async () => {
        await open(page, `/rfqs/${fx.rfq.pricesIn}`)
        await closeDialogs(page)
        const pressed = await tryPress(page, [/^issue quotation$/i, /^(make|write|send) (a )?quotation$/i, /issue quotation/i], 'Issue quotation')
        const shown =
          pressed &&
          (await dialog.waitFor({ timeout: 10_000 }).then(
            () => true,
            () => false,
          ))
        if (!shown) {
          await open(page, `/rfqs/${fx.rfq.pricesIn}?issue=1`)
          await dialog.waitFor({ timeout: 10_000 })
        }
        await settle(page)
        // The dialog opens with no selling price (the CRM never works one out), so its Issue quotation is grey. A person types the prices
        // before issuing: do the same, so the screen is measured in the state where its one green button is live.
        const prices = dialog.getByLabel(/^Unit price, net PKR, item/)
        for (let i = 0, n = await prices.count(); i < n; i++) await prices.nth(i).fill(String(1000 + i * 250))
        // the button wakes up once the prices are read; measure it awake
        await page
          .waitForFunction(() => {
            const b = Array.from(document.querySelectorAll('[role="dialog"] button')).find(x => /^issue quotation$/i.test((x.textContent ?? '').trim()))
            return !!b && !(b as HTMLButtonElement).disabled
          }, undefined, { timeout: 8_000 })
          .catch(() => undefined)
      })
      await capture('issue-quotation', { root: DIALOG })
    } finally {
      await bounded(20_000, 'close Issue quotation', () => closeDialogs(page)).catch(() => undefined)
    }
  },
}

/** The Mark won dialog (Create order, with a price per line), opened from the quoted RFQ by its ?won=1 address. */
const markWon: Visit = {
  id: 'mark-won',
  title: 'Mark won dialog',
  roles: MONEY,
  screens: ['mark-won'],
  run: async (page, fx, capture) => {
    const dialog = page.locator(DIALOG).first()
    try {
      await bounded(60_000, 'open Mark won', async () => {
        await open(page, `/rfqs/${fx.rfq.quoted}?won=1`)
        await dialog.waitFor({ timeout: 15_000 })
        await settle(page)
      })
      await capture('mark-won', { root: DIALOG })
    } finally {
      await bounded(20_000, 'close Mark won', () => closeDialogs(page)).catch(() => undefined)
    }
  },
}

/**
 * The Delete job guide (migration 0132): admin opens More, Delete job on the invoiced order (its next-step button puts More on a phone
 * too). Its numbered invoice is one the books keep, so "These stay for the books" and Mark the job cancelled are measured. Nothing is deleted.
 */
const deleteJobGuide: Visit = {
  id: 'delete-job-guide',
  title: 'Delete job: the guide of what to clear first',
  roles: ADMIN,
  screens: ['delete-job-guide'],
  run: async (page, fx, capture) => {
    const dialog = page.locator(DIALOG).first()
    try {
      await bounded(60_000, 'open Delete job', async () => {
        await open(page, `/orders/${fx.order.invoiced}`)
        await closeDialogs(page)
        await page.getByRole('button', { name: /^More( actions)?$/ }).click()
        await page.getByRole('menuitem', { name: 'Delete job' }).click()
        await dialog.waitFor({ timeout: 15_000 })
        await dialog.getByRole('heading', { name: /^(To do first|These stay for the books)$/ }).first().waitFor({ timeout: 15_000 })
        await settle(page)
      })
      await capture('delete-job-guide', { root: DIALOG })
    } finally {
      await bounded(20_000, 'close Delete job', () => closeDialogs(page)).catch(() => undefined)
    }
  },
}

/**
 * "Add to this job" (the Job page's side card; it replaced the Paste or photo sheet) with a supplier's reply pasted in: the card
 * guesses what it is and shows its choices. Nothing is saved; the box is emptied afterwards. The card is for admin and sales (an
 * engineer's Job page has none: owner decision). The empty card is part of every Job page capture.
 */
const addToJobPasted: Visit = {
  id: 'add-to-job-pasted',
  title: 'Job page: Add to this job with a supplier reply pasted in',
  roles: MONEY,
  screens: ['add-to-job-pasted'],
  run: async (page, fx, capture) => {
    await open(page, `/rfqs/${fx.rfq.waiting}`)
    const box = page.getByRole('textbox', { name: 'Paste here' })
    await box.scrollIntoViewIfNeeded()
    await box.fill('Dear sir, thank you for your enquiry. Our best price is USD 412 per unit, delivery 3 weeks ex works, offer valid 14 days. Regards')
    await page.getByTestId('add-guess').waitFor({ timeout: 10_000 })
    try {
      await capture('add-to-job-pasted', { scrollTo: '[data-testid="add-to-job"]' })
    } finally {
      await box.fill('').catch(() => undefined)
    }
  },
}

/**
 * The layout set (AUDIT_SET=layout, the workflow's `set` input): the screens and dialogs the layout gate is run on at five desktop
 * widths (docs/audit/SCREEN_AUDIT.md). Existing visits by id, plus the dialogs below that the standard audit does not open.
 */
export const LAYOUT_IDS: ReadonlySet<string> = new Set([
  'money-expenses',
  'money-month-end',
  'money-expense-report',
  'jobs-list',
  'job-po-issued',
  'job-delivered',
  'company-customer',
  'today',
  'settings-categories',
  'money-expenses-add',
  'issue-quotation',
  'mark-won',
])

/** A dialog visit of the layout set: `openIt` opens it from a settled page, the capture measures inside `root`, then it is closed. */
function layoutDialog(id: string, title: string, start: (fx: Fixture) => string, openIt: (page: Page, fx: Fixture) => Promise<void>, root = DIALOG, openedByAddress = false): Visit {
  return {
    id,
    title,
    roles: ADMIN,
    set: 'layout',
    screens: [id],
    run: async (page, fx, capture) => {
      try {
        await bounded(60_000, `open ${title}`, async () => {
          await open(page, start(fx))
          // A dialog its address opens must not be closed before it is measured.
          if (!openedByAddress) await closeDialogs(page)
          await openIt(page, fx)
          await page.locator(root).first().waitFor({ timeout: 15_000 })
          await settle(page)
        })
        await capture(id, { root })
      } finally {
        await bounded(20_000, `close ${title}`, () => closeDialogs(page)).catch(() => undefined)
      }
    },
  }
}

/** Opens the row menu of the first supplier line on an order, then `item` in it (or the button itself when it is on the row). */
async function legAction(page: Page, direct: RegExp, item: RegExp): Promise<void> {
  const button = page.getByRole('button', { name: direct }).filter({ visible: true }).first()
  if (await button.isVisible().catch(() => false)) {
    await button.click()
    return
  }
  await page.getByRole('button', { name: /^More for / }).filter({ visible: true }).first().click()
  await page.getByRole('menuitem', { name: item }).filter({ visible: true }).first().click()
}

const LAYOUT_VISITS: readonly Visit[] = [
  layoutDialog('lg-add-expense', 'Layout: Add expense dialog (?add=1)', () => '/money/expenses?add=1', async () => undefined, DIALOG, true),
  layoutDialog('lg-pay', 'Layout: Pay supplier dialog', fx => `/orders/${fx.order.multiLeg}`, (page) => legAction(page, /^Pay /, /^Pay /)),
  layoutDialog('lg-recurring', 'Layout: Recurring template dialog', () => '/money/expenses', async page => {
    await page.getByRole('button', { name: /^Add recurring$/ }).filter({ visible: true }).first().click()
  }),
  layoutDialog('lg-invoice-detail', 'Layout: Invoice detail dialog', () => '/money/gst-register', async page => {
    await page.locator('#main tbody tr, #main [role="row"]').filter({ hasText: /d/ }).first().click()
  }),
  layoutDialog('lg-goods-chase', 'Layout: Chase goods dialog', fx => `/orders/${fx.order.multiLeg}`, async page => {
    // Chase goods sits in the Delivery section's supplier lines, which start folded.
    await page.getByRole('button', { name: /^Delivery/ }).filter({ visible: true }).first().click().catch(() => undefined)
    await legAction(page, /^Chase goods/, /^Chase goods$/)
  }),
  layoutDialog(
    'lg-filter-sheet',
    'Layout: Filter sheet (expenses)',
    () => '/money/expenses',
    async page => {
      await page.getByRole('button', { name: /^Filters/ }).filter({ visible: true }).first().click()
    },
    '[role="dialog"][aria-label="Filter expenses"]',
  ),
]

// ---------------------------------------------------------------- the opened set (AUDIT_SET=opened): panels after a click
/** Runs each step on its own: one that fails does not stop the others; the failures are reported together at the end. */
async function steps(page: Page, list: readonly (readonly [string, () => Promise<void>])[]): Promise<void> {
  const failed: string[] = []
  for (const [id, run] of list) {
    try {
      await bounded(70_000, id, run)
    } catch (e) {
      failed.push(`${id}: ${(e instanceof Error ? e.message : String(e)).split('\n')[0].slice(0, 90)}`)
    } finally {
      await page.keyboard.press('Escape').catch(() => undefined)
      await bounded(20_000, 'close', () => closeDialogs(page)).catch(() => undefined)
    }
  }
  if (failed.length) throw new Error(failed.join(' | ').slice(0, 390))
}

/** Clicks up to `max` folded controls (aria-expanded=false) inside `scope`, one at a time. Throws when there is nothing to open. */
async function expandFolded(page: Page, scope: string, max: number): Promise<number> {
  let n = 0
  for (; n < max; n++) {
    const b = page.locator(`${scope} button[aria-expanded="false"]`).filter({ visible: true }).first()
    if (!(await b.count())) break
    await b.click()
    await page.waitForTimeout(300)
  }
  if (!n) throw new Error(`nothing folded in ${scope}`)
  await settle(page)
  return n
}

async function firstRow(page: Page): Promise<void> {
  const row = page.locator('#main tbody tr, #main [role="row"]').filter({ hasText: /\d/ }).first()
  if (await row.count()) {
    await row.click()
    return
  }
  throw new Error('no row')
}

const STAGE_IDS = ['enquiry', 'quotation', 'order', 'supplier-order', 'delivery', 'invoice', 'payment'] as const
async function openStage(page: Page, path: string, i: number): Promise<void> {
  await open(page, path)
  await closeDialogs(page)
  const head = page.locator(`#stage-${i} button[aria-expanded]`).first()
  await head.waitFor({ timeout: 10_000 })
  if ((await head.getAttribute('aria-expanded')) !== 'true') {
    await head.click()
    await settle(page)
  }
  await page.locator(`#stage-body-${i}`).waitFor({ timeout: 10_000 })
  await page.waitForTimeout(1_200)
  await settle(page)
}

const stageVisit = (stage: number, label: string, path: (fx: Fixture) => string, roles: readonly Role[]): Visit => ({
  id: `op-step-${STAGE_IDS[stage]}${label}`,
  title: `Opened: job step card ${STAGE_IDS[stage]}${label}`,
  roles,
  set: 'opened',
  screens: [`op-step-${STAGE_IDS[stage]}${label}`],
  run: async (page, fx, capture) => {
    await openStage(page, path(fx), stage)
    await capture(`op-step-${STAGE_IDS[stage]}${label}`, { scrollTo: `#stage-${stage}` })
  },
})

async function openRecordPayment(page: Page): Promise<void> {
  const b = page.getByRole('button', { name: /record payment/i }).filter({ visible: true }).first()
  if (await b.count()) return b.click()
  await page.locator('#main').getByRole('button', { name: /^More/ }).filter({ visible: true }).first().click()
  await page.getByRole('menuitem', { name: /record payment/i }).first().click()
}

const REPORTS: readonly (readonly [string, string])[] = [
  ['op-report-expense', '/money/reports/expenses?by=month'],
  ['op-report-aging', '/money/month-end/aging'],
  ['op-report-owe', '/money/month-end/owe'],
  ['op-report-categories', '/money/month-end/categories'],
]

const OPENED_VISITS: readonly Visit[] = [
  stageVisit(0, '', fx => `/rfqs/${fx.rfq.compare}`, ALL),
  stageVisit(1, '', fx => `/rfqs/${fx.rfq.compare}`, ALL),
  stageVisit(1, '-prices-in', fx => `/rfqs/${fx.rfq.pricesIn}`, ALL),
  stageVisit(2, '', fx => `/orders/${fx.order.multiLeg}`, ALL),
  stageVisit(3, '', fx => `/orders/${fx.order.multiLeg}`, ALL),
  stageVisit(4, '', fx => `/orders/${fx.order.multiLeg}`, ALL),
  stageVisit(5, '', fx => `/orders/${fx.order.invoiced}`, ALL),
  stageVisit(6, '', fx => `/orders/${fx.order.invoiced}`, ALL),
  {
    id: 'op-money',
    title: 'Opened: Money dialogs, GST register, receivables, reports',
    roles: ADMIN,
    set: 'opened',
    screens: ['op-invoice-detail', 'op-gst-export', 'op-record-payment', 'op-receivables-row', ...REPORTS.map(r => r[0])],
    run: async (page, fx, capture) => {
      const list: (readonly [string, () => Promise<void>])[] = [
        ['op-invoice-detail', async () => {
          await open(page, '/money/gst-register')
          await closeDialogs(page)
          await page.locator('#main tbody tr, #main [role="row"], #main li').filter({ hasText: /INV-?\d/ }).first().click()
          await page.locator(DIALOG).first().waitFor({ timeout: 15_000 })
          await settle(page)
          await capture('op-invoice-detail', { root: DIALOG })
        }],
        ['op-gst-export', async () => {
          await open(page, '/money/gst-register')
          await page.locator('#main').getByRole('button', { name: /^More/ }).filter({ visible: true }).first().click()
          await page.getByRole('menuitem', { name: /export/i }).first().waitFor({ timeout: 8_000 })
          await capture('op-gst-export')
        }],
        ['op-record-payment', async () => {
          await openStage(page, `/orders/${fx.order.invoiced}`, 5)
          await openRecordPayment(page)
          await page.locator(DIALOG).first().waitFor({ timeout: 15_000 })
          await settle(page)
          await capture('op-record-payment', { root: DIALOG })
        }],
        ['op-receivables-row', async () => {
          await open(page, '/money/receivables')
          await firstRow(page)
          await settle(page)
          await capture('op-receivables-row')
        }],
      ]
      for (const [id, path] of REPORTS) {
        list.push([id, async () => {
          await open(page, path)
          await expandFolded(page, '#main', 2).catch(async () => firstRow(page))
          await settle(page)
          await capture(id)
        }])
      }
      await steps(page, list)
    },
  },
  {
    id: 'op-expenses',
    title: 'Opened: expenses (Add expenses sheet, add dialog, row details, History, claims)',
    roles: ADMIN,
    set: 'opened',
    screens: ['op-add-expenses', 'op-add-expense', 'op-expense-edit', 'op-expense-history', 'op-claims'],
    run: async (page, fx, capture) => {
      // two pending claims from the engineer (synthetic), so the admin's "To approve" list has something to open
      const spent = new Date().toISOString().slice(0, 10)
      let seeded = 'claims seeded'
      await must(rest('engineer', 'expense_claims', { method: 'POST', body: [{ spent_on: spent, amount_pkr: 4200, note: 'Taxi to the site, Jhang', order_id: fx.order.multiLeg }, { spent_on: spent, amount_pkr: 950, note: 'Sealant and tape', order_id: null }] })).catch(e => { seeded = `claims NOT seeded ${e instanceof Error ? e.message.slice(0, 120) : ''}` })
      await steps(page, [
        ['op-add-expenses', async () => {
          await open(page, '/money/expenses?burst=1')
          await page.locator(DIALOG).first().waitFor({ timeout: 15_000 })
          await page.locator(DIALOG).getByRole('textbox').first().fill('4500').catch(() => undefined)
          await settle(page)
          await capture('op-add-expenses', { root: DIALOG })
        }],
        ['op-add-expense', async () => {
          await open(page, '/money/expenses?add=1')
          await page.locator(DIALOG).first().waitFor({ timeout: 15_000 })
          await capture('op-add-expense', { root: DIALOG })
        }],
        ['op-expense-edit', async () => {
          await open(page, '/money/expenses')
          await page.getByRole('button', { name: /^More for/ }).filter({ visible: true }).first().click()
          await page.getByRole('menuitem', { name: /edit/i }).first().click()
          await page.locator(DIALOG).first().waitFor({ timeout: 15_000 })
          await settle(page)
          await capture('op-expense-edit', { root: DIALOG })
        }],
        ['op-expense-history', async () => {
          await open(page, '/money/expenses')
          const more = page.getByRole('button', { name: /^More for/ }).filter({ visible: true }).first()
          if (await more.count()) {
            await more.click()
            await page.getByRole('menuitem', { name: /history/i }).first().click()
          } else {
            await page.getByRole('button', { name: /^Edit/ }).filter({ visible: true }).first().click()
            await page.locator(DIALOG).getByRole('button', { name: /history/i }).first().click()
          }
          await page.locator(DIALOG).last().waitFor({ timeout: 15_000 })
          await page.waitForTimeout(1_500)
          await settle(page)
          await capture('op-expense-history', { root: DIALOG })
        }],
        ['op-claims', async () => {
          await open(page, '/money/expenses')
          const found = await page.evaluate(() => {
            const h = Array.from(document.querySelectorAll('#main h2, #main h3, #main summary, #main legend')).find(x => /approve|claim|i paid/i.test(x.textContent ?? ''))
            h?.setAttribute('data-audit-target', '1')
            return !!h
          })
          if (!found) throw new Error(`no claims section on the page (${seeded})`)
          await capture('op-claims', { scrollTo: '[data-audit-target]' })
        }],
      ])
    },
  },
  {
    id: 'op-rfq',
    title: 'Opened: supplier prices, quotation dialog, convert dialog',
    roles: ADMIN,
    set: 'opened',
    screens: ['op-supplier-prices', 'op-quotation-dialog', 'op-convert-dialog'],
    run: async (page, fx, capture) => {
      await steps(page, [
        ['op-supplier-prices', async () => {
          await openStage(page, `/rfqs/${fx.rfq.compare}`, 1)
          await expandFolded(page, '#stage-body-1', 6)
          await capture('op-supplier-prices', { scrollTo: '#stage-1' })
        }],
        ['op-quotation-dialog', async () => {
          await open(page, `/rfqs/${fx.rfq.pricesIn}?issue=1`)
          const dialog = page.locator(DIALOG).first()
          await dialog.waitFor({ timeout: 15_000 })
          const prices = dialog.getByLabel(/^Unit price, net PKR, item/)
          for (let i = 0, n = await prices.count(); i < n; i++) await prices.nth(i).fill(String(1000 + i * 250))
          await settle(page)
          await capture('op-quotation-dialog', { root: DIALOG })
        }],
        ['op-convert-dialog', async () => {
          await open(page, `/rfqs/${fx.rfq.quoted}?won=1`)
          await page.locator(DIALOG).first().waitFor({ timeout: 15_000 })
          await settle(page)
          await capture('op-convert-dialog', { root: DIALOG })
        }],
      ])
    },
  },
  {
    id: 'op-company',
    title: 'Opened: company site, contact and supplier panels',
    roles: ADMIN,
    set: 'opened',
    screens: ['op-company-panels', 'op-company-site', 'op-company-contact', 'op-company-supplier'],
    run: async (page, fx, capture) => {
      await steps(page, [
        ['op-company-panels', async () => {
          await open(page, `/companies/${fx.company.customer}`)
          await expandFolded(page, '#main', 4).catch(() => undefined)
          await capture('op-company-panels')
        }],
        ['op-company-site', async () => {
          await open(page, `/companies/${fx.company.customer}`)
          await page.getByRole('button', { name: /^Add site$/ }).filter({ visible: true }).first().click()
          await page.locator(DIALOG).first().waitFor({ timeout: 15_000 })
          await capture('op-company-site', { root: DIALOG })
        }],
        ['op-company-contact', async () => {
          await open(page, `/companies/${fx.company.customer}`)
          await page.getByRole('button', { name: 'Add', exact: true }).filter({ visible: true }).first().click()
          await page.locator(DIALOG).first().waitFor({ timeout: 15_000 })
          await capture('op-company-contact', { root: DIALOG })
        }],
        ['op-company-supplier', async () => {
          await open(page, `/companies/${fx.company.supplier}`)
          await expandFolded(page, '#main', 4)
          await capture('op-company-supplier')
        }],
      ])
    },
  },
]

export const VISITS: readonly Visit[] = [
  ...OPENED_VISITS,
  // The Jobs screens (redesign phases 4 to 7). The Job pages are opened through the old /rfqs/<id> and /orders/<id> addresses, which also
  // keeps the redirect under the audit. (The old RFQ and Order pages themselves were removed on 2026-10-30.)
  screen('jobs-list', 'Jobs list, open', ALL, () => '/jobs'),
  screen('jobs-list-phone-imported', 'Jobs list: an imported job (Imported tag, no prefix), phone card', ALL, () => '/jobs?q=Importex'),
  screen('jobs-history', 'Jobs list, history', ALL, () => '/jobs?chip=history'),
  screen('jobs-orders', 'Jobs list, open orders (stage filter)', ALL, () => '/jobs?chip=open&stage=orders'),
  screen('jobs-to-invoice', 'Jobs list, open jobs to invoice (stage filter)', MONEY, () => '/jobs?chip=open&stage=invoice'),
  screen('job-not-sent', 'Job page: enquiry, not sent to suppliers', ALL, fx => `/rfqs/${fx.rfq.notSent}`),
  screen('job-waiting', 'Job page: enquiry, waiting for prices', ALL, fx => `/rfqs/${fx.rfq.waiting}`),
  screen('job-prices-in', 'Job page: enquiry, prices in', ALL, fx => `/rfqs/${fx.rfq.pricesIn}`),
  screen('job-quoted', 'Job page: quotation sent', ALL, fx => `/rfqs/${fx.rfq.quoted}`),
  screen('job-po-issued', 'Job page: order, PO issued', ALL, fx => `/orders/${fx.order.poIssued}`),
  screen('job-delivered', 'Job page: order, delivered, not invoiced', ALL, fx => `/orders/${fx.order.delivered}`),
  screen('job-paid', 'Job page: order, paid', ALL, fx => `/orders/${fx.order.paid}`),
  // The delivery challans of an order, for the engineer too (migration 0131; the engineer's On site card carries the panel): scrolled to it.
  screen('job-challans', 'Job page: delivery challans (every role, no price)', ALL, fx => `/orders/${fx.order.delivered}`, { scrollTo: '[data-testid="challans"]' }),
  screen('job-commissioning', 'Job page: 3 supplier orders, commissioning', ALL, fx => `/orders/${fx.order.multiLeg}`),
  // The header's key facts (Customer PO for admin and sales only, Supplier, Delivery), at every viewport the audit runs.
  screen('job-key-facts', 'Job page: header key facts (PO, supplier, delivery)', ALL, fx => `/orders/${fx.order.multiLeg}`, { scrollTo: '[aria-label="Key facts"]' }),
  screen('enquiry-new', 'New enquiry', MONEY, () => '/enquiries/new'),
  screen('review-imported', 'Money: Review imported', ADMIN, () => '/money/review-imported'),
  screen('today', 'Today, with items', ALL, () => '/todo'),
  screen('weekly-review', 'To do: weekly review', ADMIN, () => '/todo/review'),
  screen('capture-pick-job', 'Photo or note: which job (the share target with nothing shared)', ALL, () => '/capture'),
  screen('engineer-i-paid', 'I paid: my expense claims', ['sales', 'engineer'], () => '/my-expenses'),
  screen('job-order-not-placed', 'Job page: order, supplier order not placed', ALL, fx => `/orders/${fx.order.notPlaced}`),
  screen('job-invoiced', 'Job page: order, invoiced, not paid', ALL, fx => `/orders/${fx.order.invoiced}`),
  screen('job-compare', 'Job page: supplier comparison (4 suppliers, 3 currencies)', ALL, fx => `/rfqs/${fx.rfq.compare}`, { scrollTo: '[data-compared]' }),
  {
    // The Comparative Statement of the compare job (4 suppliers, 3 currencies), with the "did not reply" rows on. Admin and sales only.
    id: 'job-statement',
    title: 'Job page: Comparative statement (4 suppliers, 3 currencies)',
    roles: MONEY,
    screens: ['job-statement'],
    run: async (page, fx, capture) => {
      const [rfq] = await must(rest<{ number: number }[]>('admin', `rfqs?id=eq.${fx.rfq.compare}&select=number`))
      await open(page, `/jobs/${rfq.number}/statement`)
      await page.getByTestId('statement').waitFor()
      await capture('job-statement')
    },
  },
  screen('companies', 'Companies list', ALL, () => '/companies'),
  screen('company-customer', 'Company page: customer', ALL, fx => `/companies/${fx.company.customer}`),
  screen('company-supplier', 'Company page: supplier', ALL, fx => `/companies/${fx.company.supplier}`),
  screen('money-gst-register', 'Money: GST register (invoices)', MONEY, () => '/money/gst-register'),
  screen('money-receivables', 'Money: receivables (who owes us)', MONEY, () => '/money/receivables'),
  screen('money-expenses', 'Money: expenses', ADMIN, () => '/money/expenses'),
  screen('money-month-end', 'Money: month-end checklist', ADMIN, () => '/money/month-end'),
  screen('money-bank', 'Money: bank tick', ADMIN, () => '/money/month-end/bank'),
  screen('money-pnl', 'Money: P&L', ADMIN, () => '/money/month-end/pnl'),
  screen('money-expenses-add', 'Money: Add expenses sheet', ADMIN, () => '/money/expenses?burst=1'),
  screen('money-expense-report', 'Money: Expenses report, month', ADMIN, () => '/money/reports/expenses?by=month'),
  screen('money-expense-report-quarter', 'Money: Expenses report, quarter', ADMIN, () => '/money/reports/expenses?by=quarter'),
  screen('money-aging', 'Money: aging', ADMIN, () => '/money/month-end/aging'),
  screen('money-owe', 'Money: we owe suppliers', ADMIN, () => '/money/month-end/owe'),
  screen('money-gst-fbr', 'Money: GST/FBR', ADMIN, () => '/money/month-end/gst'),
  screen('money-team', 'Money: team report', ADMIN, () => '/money/month-end/team'),
  screen('money-margins', 'Money: margins', ADMIN, () => '/money/margins'),
  screen('money-exceptions', 'Money: exceptions (mistakes to fix)', ADMIN, () => '/money/exceptions'),
  // round 3: the two Money screens the audit could not grade from a capture
  screen('money-in-out', 'Money: money in and out (In vs out)', ADMIN, () => '/money/reports/in-out'),
  screen('money-profit', 'Money: profitability (average income, chart, lost-enquiry costs)', ADMIN, () => '/money/profit'),
  screen('reports', 'Reports', MONEY, () => '/reports'),
  screen('settings', 'Settings home', ['sales', 'engineer'], () => '/settings'),
  screen('settings-team', 'Settings: team', ADMIN, () => '/settings/team'),
  screen('settings-targets', 'Settings: targets', ADMIN, () => '/settings/targets'),
  screen('settings-export', 'Settings: export data', ADMIN, () => '/settings/export'),
  screen('settings-categories', 'Settings: expense categories', ADMIN, () => '/settings/categories'),
  screen('settings-product-categories', 'Settings: product categories', ADMIN, () => '/settings/product-categories'),
  screen('settings-company', 'Settings: company profile', ALL, () => '/settings/company'),
  screen('settings-details', 'Settings: your details', ALL, () => '/settings/details'),
  screen('settings-exchange-rates', 'Settings: exchange rates', MONEY, () => '/settings/exchange-rates'), // engineers: no currency amounts (2026-10-22)
  screen('settings-backups', 'Settings: backups and usage', ADMIN, () => '/settings/backups'),
  screen('settings-password', 'Settings: change password', ALL, () => '/settings/password'),
  addToJobPasted,
  issueQuotation,
  markWon,
  deleteJobGuide,
  ...LAYOUT_VISITS,
  // Last: it creates an RFQ, which would otherwise show on the lists above.
  newRfq,
]
