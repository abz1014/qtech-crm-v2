import type { Page } from '@playwright/test'
import type { Role } from '../support/stack'
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
    await capture('rfq-new-4-sent')
  },
}

/** A supplier's reply as it arrives on WhatsApp (to the waiting RFQ KRS-MM-0457): what people paste most. */
const SUPPLIER_REPLY = [
  'Dear Sir,',
  'Ref your enquiry KRS-MM-0457, please find our best prices:',
  '1) Rosemount 3051CD DP transmitter - GBP 1,840 each, 4 weeks ex-works',
  '2) Rosemount 644 temperature transmitter - GBP 385 each, ex-stock',
  '3) Danfoss MBS 3000 - regret, cannot quote',
  'Validity 30 days. Payment 100% advance.',
  'Regards, Oliver Grant, Midlands Valves Ltd',
].join('\n')

/** The Paste or photo sheet (the top-bar button, or the phone bar's): empty, then with a supplier's reply pasted in. */
const pasteOrPhoto: Visit = {
  id: 'paste-or-photo',
  title: 'Paste or photo',
  roles: ALL,
  screens: ['paste-or-photo-empty', 'paste-or-photo-pasted'],
  run: async (page, _fx, capture) => {
    await open(page, '/today')
    await press(page, [/^paste or photo$/i, /paste or photo/i, /^capture$/i], 'open Paste or photo')
    await page.locator(DIALOG).first().waitFor({ timeout: 10_000 })
    const box = page.locator(DIALOG).getByRole('textbox', { name: /pasted text/i }).first()
    // A draft kept on the device (IndexedDB) from an earlier, interrupted run is emptied first: the empty state is what is graded.
    if ((await box.count()) && (await box.inputValue()) !== '') {
      await box.fill('')
      await page.waitForTimeout(800)
    }
    await settle(page)
    await capture('paste-or-photo-empty', { root: DIALOG })

    await box.fill(SUPPLIER_REPLY)
    await page.waitForTimeout(500)
    await settle(page)
    await capture('paste-or-photo-pasted', { root: DIALOG })

    // Leave nothing behind: an emptied draft is deleted from the device (debounced 300 ms), then the sheet is closed.
    await box.fill('')
    await page.waitForTimeout(800)
    await page.keyboard.press('Escape')
    await page.locator(DIALOG).first().waitFor({ state: 'hidden', timeout: 5_000 }).catch(() => undefined)
  },
}

/** The Issue quotation dialog, opened from an RFQ with prices in (the green button; its ?issue=1 address if no button is found). */
const issueQuotation: Visit = {
  id: 'issue-quotation',
  title: 'Issue quotation dialog',
  roles: MONEY,
  screens: ['issue-quotation'],
  run: async (page, fx, capture) => {
    await open(page, `/rfqs/${fx.rfq.pricesIn}`)
    const pressed = await tryPress(page, [/^issue quotation$/i, /^(make|write|send) (a )?quotation$/i, /issue quotation/i], 'Issue quotation')
    if (!pressed) await open(page, `/rfqs/${fx.rfq.pricesIn}?issue=1`)
    await page.locator(DIALOG).first().waitFor({ timeout: 10_000 })
    await settle(page)
    await capture('issue-quotation', { root: DIALOG })
    await page.keyboard.press('Escape')
  },
}

export const VISITS: readonly Visit[] = [
  screen('today', 'Today, with items', ALL, () => '/today'),
  screen('rfqs-open', 'RFQ list, open', ALL, () => '/rfqs'),
  screen('rfqs-closed', 'RFQ list, closed', ALL, () => '/rfqs?tab=closed'),
  screen('rfq-not-sent', 'RFQ page: not sent to suppliers', ALL, fx => `/rfqs/${fx.rfq.notSent}`),
  screen('rfq-waiting', 'RFQ page: waiting for prices', ALL, fx => `/rfqs/${fx.rfq.waiting}`),
  screen('rfq-prices-in', 'RFQ page: prices in', ALL, fx => `/rfqs/${fx.rfq.pricesIn}`),
  screen('rfq-quoted', 'RFQ page: quotation sent', ALL, fx => `/rfqs/${fx.rfq.quoted}`),
  {
    id: 'rfq-won',
    title: 'RFQ page: won, made into an order',
    roles: ALL,
    screens: ['rfq-won'],
    run: async (page, fx, capture) => {
      // seed.json from before the won RFQ was seeded has no id for it: delete it (and reset the database) to seed again.
      if (!fx.rfq.won) throw new Error('the seed has no won RFQ (an older seed.json); reseed to capture it')
      await open(page, `/rfqs/${fx.rfq.won}`)
      await capture('rfq-won')
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
  screen('money-categories', 'Money: expenses by category', ADMIN, () => '/money/month-end/categories'),
  screen('money-aging', 'Money: aging', ADMIN, () => '/money/month-end/aging'),
  screen('money-owe', 'Money: we owe suppliers', ADMIN, () => '/money/month-end/owe'),
  screen('money-gst-fbr', 'Money: GST/FBR', ADMIN, () => '/money/month-end/gst'),
  screen('money-team', 'Money: team report', ADMIN, () => '/money/month-end/team'),
  screen('money-margins', 'Money: margins', ADMIN, () => '/money/margins'),
  screen('money-exceptions', 'Money: exceptions (things to check)', ADMIN, () => '/money/exceptions'),
  screen('reports', 'Reports', MONEY, () => '/reports'),
  screen('settings', 'Settings home', ['sales', 'engineer'], () => '/settings'),
  screen('settings-team', 'Settings: team', ADMIN, () => '/settings/team'),
  screen('settings-targets', 'Settings: targets', ADMIN, () => '/settings/targets'),
  screen('settings-categories', 'Settings: expense categories', ADMIN, () => '/settings/categories'),
  screen('settings-company', 'Settings: company profile', ALL, () => '/settings/company'),
  screen('settings-details', 'Settings: your details', ALL, () => '/settings/details'),
  screen('settings-exchange-rates', 'Settings: exchange rates', ALL, () => '/settings/exchange-rates'),
  screen('settings-password', 'Settings: change password', ALL, () => '/settings/password'),
  pasteOrPhoto,
  issueQuotation,
  // Last: it creates an RFQ, which would otherwise show on the lists above.
  newRfq,
]
