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
  /** The screen ids this visit captures, in order (a flow has several). */
  screens: readonly string[]
  run: (page: Page, fx: Fixture, capture: Capture) => Promise<void>
  /**
   * The old RFQ and Orders pages, kept until 2026-11-09 so a before and after can be compared (the e2e sign-in turns them on: e2e/support/stack.ts).
   * They are captured and shown but not scored: they are being removed. The Jobs screens are the ones held to the targets.
   */
  legacy?: boolean
}

/** `?old=1` keeps the old RFQ and Orders pages, `?old=0` opens the Jobs page for the same address (src/app/oldAddresses.tsx). */
const withOld = (path: string, old: '0' | '1'): string => `${path}${path.includes('?') ? '&' : '?'}old=${old}`
const LEGACY = /^(rfqs-open|rfqs-closed|rfq-not-sent|rfq-waiting|rfq-prices-in|rfq-quoted|rfq-won|rfq-compare|orders|order-.+)$/

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
  const legacy = LEGACY.test(id)
  const mode = legacy ? '1' : id.startsWith('job') ? '0' : null
  return {
    id,
    title,
    roles,
    screens: [id],
    legacy,
    run: async (page, fx, capture) => {
      await open(page, mode ? withOld(path(fx), mode) : path(fx))
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
        await open(page, withOld(`/rfqs/${fx.rfq.pricesIn}`, '0'))
        await closeDialogs(page)
        const pressed = await tryPress(page, [/^issue quotation$/i, /^(make|write|send) (a )?quotation$/i, /issue quotation/i], 'Issue quotation')
        const shown =
          pressed &&
          (await dialog.waitFor({ timeout: 10_000 }).then(
            () => true,
            () => false,
          ))
        if (!shown) {
          await open(page, withOld(`/rfqs/${fx.rfq.pricesIn}?issue=1`, '0'))
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
        await open(page, withOld(`/rfqs/${fx.rfq.quoted}?won=1`, '0'))
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
    await open(page, withOld(`/rfqs/${fx.rfq.waiting}`, '0'))
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

export const VISITS: readonly Visit[] = [
  // The Jobs screens (redesign phases 4 to 7). The rfq-* and order-* captures below open the same Job pages through the old addresses and are
  // kept until 2026-11-09, so a before and after can be compared; after that date they can go.
  screen('jobs-list', 'Jobs list, open', ALL, () => '/jobs'),
  screen('jobs-history', 'Jobs list, history', ALL, () => '/jobs?chip=history'),
  screen('job-not-sent', 'Job page: enquiry, not sent to suppliers', ALL, fx => `/rfqs/${fx.rfq.notSent}`),
  screen('job-waiting', 'Job page: enquiry, waiting for prices', ALL, fx => `/rfqs/${fx.rfq.waiting}`),
  screen('job-prices-in', 'Job page: enquiry, prices in', ALL, fx => `/rfqs/${fx.rfq.pricesIn}`),
  screen('job-quoted', 'Job page: quotation sent', ALL, fx => `/rfqs/${fx.rfq.quoted}`),
  screen('job-po-issued', 'Job page: order, PO issued', ALL, fx => `/orders/${fx.order.poIssued}`),
  screen('job-delivered', 'Job page: order, delivered, not invoiced', ALL, fx => `/orders/${fx.order.delivered}`),
  screen('job-paid', 'Job page: order, paid', ALL, fx => `/orders/${fx.order.paid}`),
  screen('job-commissioning', 'Job page: 3 supplier orders, commissioning', ALL, fx => `/orders/${fx.order.multiLeg}`),
  screen('enquiry-new', 'New enquiry', MONEY, () => '/enquiries/new'),
  screen('review-imported', 'Money: Review imported', ADMIN, () => '/money/review-imported'),
  screen('today', 'Today, with items', ALL, () => '/todo'),
  screen('weekly-review', 'To do: weekly review', ADMIN, () => '/todo/review'),
  screen('capture-pick-job', 'Photo or note: which job (the share target with nothing shared)', ALL, () => '/capture'),
  screen('engineer-i-paid', 'I paid: my expense claims', ['engineer'], () => '/my-expenses'),
  screen('rfqs-open', 'RFQ list, open', ALL, () => '/rfqs'),
  screen('rfqs-closed', 'RFQ list, closed', ALL, () => '/rfqs?tab=closed'),
  screen('rfq-not-sent', 'RFQ page: not sent to suppliers', ALL, fx => `/rfqs/${fx.rfq.notSent}`),
  screen('rfq-waiting', 'RFQ page: waiting for prices', ALL, fx => `/rfqs/${fx.rfq.waiting}`),
  screen('rfq-prices-in', 'RFQ page: prices in', ALL, fx => `/rfqs/${fx.rfq.pricesIn}`),
  screen('rfq-quoted', 'RFQ page: quotation sent', ALL, fx => `/rfqs/${fx.rfq.quoted}`),
  {
    id: 'rfq-won',
    legacy: true,
    title: 'RFQ page: won, made into an order',
    roles: ALL,
    screens: ['rfq-won'],
    run: async (page, fx, capture) => {
      // seed.json from before the won RFQ was seeded has no id for it: delete it (and reset the database) to seed again.
      if (!fx.rfq.won) throw new Error('the seed has no won RFQ (an older seed.json); reseed to capture it')
      await open(page, withOld(`/rfqs/${fx.rfq.won}`, '1'))
      await capture('rfq-won')
    },
  },
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
  screen('rfq-compare', 'Supplier comparison (4 suppliers, 3 currencies)', ALL, fx => `/rfqs/${fx.rfq.compare}`, { scrollTo: '[data-compared]' }),
  screen('orders', 'Orders list', ALL, () => '/orders'),
  screen('order-not-placed', 'Order page: supplier order not placed', ALL, fx => `/orders/${fx.order.notPlaced}`),
  screen('order-po-issued', 'Order page: PO issued', ALL, fx => `/orders/${fx.order.poIssued}`),
  screen('order-delivered', 'Order page: delivered, not invoiced', ALL, fx => `/orders/${fx.order.delivered}`),
  screen('order-invoiced', 'Order page: invoiced, not paid', ALL, fx => `/orders/${fx.order.invoiced}`),
  screen('order-paid', 'Order page: paid', ALL, fx => `/orders/${fx.order.paid}`),
  screen('order-multi-supplier', 'Order page: 3 supplier orders, commissioning', ALL, fx => `/orders/${fx.order.multiLeg}`),
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
  screen('reports', 'Reports', MONEY, () => '/reports'),
  screen('settings', 'Settings home', ['sales', 'engineer'], () => '/settings'),
  screen('settings-team', 'Settings: team', ADMIN, () => '/settings/team'),
  screen('settings-targets', 'Settings: targets', ADMIN, () => '/settings/targets'),
  screen('settings-categories', 'Settings: expense categories', ADMIN, () => '/settings/categories'),
  screen('settings-product-categories', 'Settings: product categories', ADMIN, () => '/settings/product-categories'),
  screen('settings-company', 'Settings: company profile', ALL, () => '/settings/company'),
  screen('settings-details', 'Settings: your details', ALL, () => '/settings/details'),
  screen('settings-exchange-rates', 'Settings: exchange rates', MONEY, () => '/settings/exchange-rates'), // engineers: no currency amounts (2026-10-22)
  screen('settings-password', 'Settings: change password', ALL, () => '/settings/password'),
  addToJobPasted,
  issueQuotation,
  markWon,
  // Last: it creates an RFQ, which would otherwise show on the lists above.
  newRfq,
]
