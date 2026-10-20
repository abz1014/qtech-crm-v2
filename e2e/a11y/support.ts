import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test as base, expect, type Browser, type Page, type TestInfo } from '@playwright/test'
import { axeViolations, waitForAnimationsToFinish } from '../support/axe'
import { createCompany, createRfq, karachiDay, must, openAs, rest, uniqueName, type Role } from '../support/stack'

/*
 * The cross-cutting accessibility suite (docs/audit a11y recommendations, section 7). The feature suites keep their own axe calls;
 * this suite owns what they cannot see: screens and overlays nobody ran axe on, the owner's zoom bands, a Tab sweep on every main
 * screen, live regions, and single-key shortcuts. It runs as the admin (who can open every screen) from one saved session.
 *
 * Every visible word the suite depends on is in UI below, and every selector is a role or an accessible name, so the label changes
 * landing from the ux/* branches are a one-line edit here. A known failure is a test.fail() naming its BUG id (BUGS below): CI stays
 * green while the bug is open, and turns red the day it is fixed, so the marker is then removed.
 */

/** The words the suite looks for. Loose on purpose: a label that gains or loses a word should not break the suite. */
export const UI = {
  signIn: { email: /^Email/, password: /^Password$/, submit: /^Sign in$/, wrong: /password is incorrect/i, deactivated: /deactivated/i },
  accountMenu: /^Account menu/,
  capture: /^Capture$/,
  palette: /^Search or jump to$/,
  close: /^Close$/,
  rowActions: /^Actions for /,
  moreActions: /^More actions$/,
  addPerson: /^Add person$/,
  addExpense: /^Add expense$/,
  addExpenses: /^Add expenses$/,
  addRecurring: /^Add recurring$/,
  saveExpense: /^Save expense$/,
  amount: /^Amount, PKR$/,
  burstAmount: (n: number) => new RegExp(`^Amount, expense ${n}$`),
  burstRemove: (n: number) => new RegExp(`^Remove expense ${n}$`),
  addRow: /^Add a row$/,
  addItemByHand: /^Add an item by hand$/,
  issue: /Issue/,
  issuePoLegA: /^Issue PO, leg A$/,
  chase: /mark chased/i,
  undo: /Undo/,
  filterRfqs: /^Filter RFQs$/,
  searchCompanies: /^Search companies$/,
  showing: /Showing \d+ of \d+/,
  rate: /^Rate, PKR/,
  saveRate: /^Save rate$/,
  rateSaved: /Rate saved/,
  shortcutsSetting: /shortcut/i,
} as const

export interface Bug {
  id: string
  sc: string
  what: string
  /** The likely cause, file:line on main. */
  where: string
}

/** Known failures on main. Each is a test.fail() somewhere in e2e/a11y; the list is the report. */
export const BUGS = {
  shortcuts: { id: 'A11Y-01', sc: '2.1.4', what: 'single-key shortcuts N, C, G T and / act anywhere outside a text field and cannot be turned off', where: 'src/app/palette/PaletteHost.tsx:74-98, src/ui/DataTable.tsx:274-288, src/features/rfqs/board/BoardPage.tsx:87' },
  busyFocus: { id: 'A11Y-02', sc: '2.4.3', what: 'a busy button is disabled while it has focus, so focus falls to <body>', where: 'src/ui/Button.tsx:86 (disabled={disabled || busy}), src/ui/form/Form.tsx:33' },
  routeFocus: { id: 'A11Y-03', sc: '2.4.3', what: 'opening a row unmounts it and nothing takes focus on the new page', where: 'src/app/shell/AppShell.tsx:56-70 (no focus move on route change)' },
  wideDialogs: { id: 'A11Y-05', sc: '1.4.10', what: 'fixed-width dialogs are wider than the window between 768 and ~1000 px (1366 at 175%), the Close button and footer are clipped; at 320x256 the sheet title starts above the window', where: 'src/features/capture/CaptureSheet.tsx:583 (md:w-[960px]), src/features/quotations/IssueQuotationDialog.tsx:397 (md:w-[900px]), src/features/purchaseOrders/IssuePoDialog.tsx:317 (md:w-[820px]), src/ui/Dialog.tsx:102,126' },
  shortSheets: { id: 'A11Y-06', sc: '1.4.10', what: 'at 256 px tall the command palette is taller than the window', where: 'src/ui/CommandPalette.tsx:233,248' },
  toastLive: { id: 'A11Y-07', sc: '4.1.3', what: 'each toast mounts with its own role=status, so its words are not in a live region that was waiting', where: 'src/ui/Toast.tsx:109-117,183-184' },
  undoCountdown: { id: 'A11Y-08', sc: '4.1.3', what: 'the Undo countdown changes every second inside the atomic status, so it is re-read', where: 'src/ui/Toast.tsx:220' },
  undoKeys: { id: 'A11Y-09', sc: '2.2.1', what: 'the Undo toast never tells a screen-reader user that Ctrl+Z undoes', where: 'src/ui/Toast.tsx:199-221' },
  filterCount: { id: 'A11Y-10', sc: '4.1.3', what: '"Showing n of m" changes silently when a filter is typed', where: 'src/ui/DataTable.tsx:773-775, src/features/rfqs/board/BoardPage.tsx:285' },
  invisibleFocus: { id: 'A11Y-11', sc: '2.4.7', what: 'native controls laid over chips with opacity-0 show no focus ring', where: 'src/features/money/expenses/BurstSheet.tsx:795-821, src/features/rfqs/ItemsEditor.tsx:83-87' },
  obscured: { id: 'A11Y-12', sc: '2.4.11', what: 'sticky and fixed bars cover the focused control', where: 'src/features/rfqs/RfqHeaderBlock.tsx:352 (phone "RFQ actions" bar), src/app/shell/MobileChrome.tsx:78 (tab bar over the Orders tab panel), src/features/rfqs/IntakeScreen.tsx:738 (Next step bar)' },
  filterEsc: { id: 'A11Y-14', sc: '2.4.3', what: 'a second Esc in a table filter blurs it, dropping focus to <body>', where: 'src/ui/TableFilter.tsx:29-32' },
  prohibitedLabel: { id: 'A11Y-15', sc: '1.3.1 / 4.1.2', what: 'aria-label on role-less div/span/p is ignored by screen readers', where: 'src/features/orders/OrderItemsPanel.tsx:173 ("Leg A"), src/features/rfqs/RfqHeaderBlock.tsx:219, src/features/orders/ConvertDialog.tsx:434, src/features/quotations/IssueQuotationDialog.tsx:561, src/features/rfqs/ItemsEditor.tsx:170 (pre), src/features/orders/TapEdit.tsx:62,120' },
  menuDialogFocus: { id: 'A11Y-19', sc: '2.4.3', what: 'a dialog opened from a menu item returns focus to that (gone) item, so focus falls to <body>', where: 'src/ui/Dialog.tsx:111,123, src/features/settings/TeamPage.tsx:280' },
  labelInName: { id: 'A11Y-20', sc: '2.5.3', what: '"Add a rate for X" buttons have an aria-label that does not contain their visible text', where: 'src/features/fx/ExchangeRatesPage.tsx:143' },
  phoneH1: { id: 'A11Y-21', sc: '1.3.1 / 2.4.6', what: 'no h1 on a phone on Settings home and Team', where: 'src/features/settings/TeamPage.tsx:145 (header max-md:hidden), src/features/settings/SettingsLayout.tsx:45-60' },
  phoneTitle: { id: 'A11Y-22', sc: '1.4.10', what: 'the phone bar title is truncated at 320 px ("Companies")', where: 'src/app/shell/MobileChrome.tsx:55 (truncate)' },
} satisfies Record<string, Bug>

/** Marks the running test as a known failure: it must fail until BUG `bug.id` is fixed (then delete the call). */
export function knownBug(bug: Bug): void {
  test.info().annotations.push({ type: 'bug', description: `${bug.id} WCAG ${bug.sc}: ${bug.what} (${bug.where})` })
  test.fail(true, `${bug.id}: ${bug.what}`)
}

export const ADMIN_ID = 'a0000000-0000-4000-8000-000000000001'
const UTILITIES = 'ca7e0000-0000-4000-8000-000000000003'

/** Records every screen needs, made once per worker. Names are long on purpose: a title that only fits at 1440 shows at 200%. */
export interface World {
  tag: string
  customer: { id: string; name: string }
  supplier: { id: string; name: string }
  rfq: { id: string; number: number }
  order: { id: string; number: number }
  invoice: { id: string; number: string }
  recurring: string
}

async function makeWorld(): Promise<World> {
  const tag = Math.random().toString(36).slice(2, 7)
  // The PDF dialogs read the profile; a complete one keeps their warnings out of the way.
  await must(
    rest('admin', 'company_profile?id=eq.1', {
      method: 'PATCH',
      body: { legal_name: 'Q-Tech Solutions (Pvt) Ltd', address: 'Office 4, Gulberg III, Lahore', phone: '+92 42 555 0138', ntn: '1234567-8' },
      prefer: 'return=minimal',
    }),
  )
  await must(
    rest('admin', 'fx_rates?on_conflict=currency,as_of,source', {
      method: 'POST',
      body: { currency: 'USD', rate_pkr: 280, as_of: karachiDay(0), source: 'manual' },
      prefer: 'resolution=merge-duplicates,return=minimal',
    }),
  )
  const customer = await createCompany(uniqueName('Indus Textile Mills Limited, Korangi Industrial Area'))
  const supplier = await createCompany(uniqueName('Hangzhou Instrumentation Trading Company'), { country: 'China' })
  const rfq = await createRfq(customer.id, { owner_id: ADMIN_ID, due_on: karachiDay(6), customer_ref: `A11Y-${tag}` })
  const items = await must(
    rest<{ id: string; position: number }[]>('admin', 'rfq_items', {
      method: 'POST',
      body: [
        { rfq_id: rfq.id, position: 0, description: 'Electromagnetic flow meter DN50, flanged PN16, with remote transmitter and 10 m cable', qty: 2 },
        { rfq_id: rfq.id, position: 1, description: 'Pressure transmitter 0-10 bar', qty: 1 },
      ],
    }),
  )
  items.sort((a, b) => a.position - b.position)
  const [inq] = await must(rest<{ id: string }[]>('admin', 'supplier_inquiries', { method: 'POST', body: { rfq_id: rfq.id, supplier_id: supplier.id, sent_on: karachiDay(-3) } }))
  await must(
    rest('admin', 'supplier_quote_lines', {
      method: 'POST',
      body: { inquiry_id: inq.id, rfq_item_id: items[0].id, unit_price: 50, currency: 'USD', lead_time: '10 to 14 days' },
      prefer: 'return=minimal',
    }),
  )
  const [order] = await must(
    rest<{ id: string; number: number }[]>('admin', 'orders', { method: 'POST', body: { company_id: customer.id, owner_id: ADMIN_ID, payment_terms_days: 30, ordered_on: karachiDay(-3) } }),
  )
  const [leg] = await must(rest<{ id: string }[]>('admin', 'supplier_orders', { method: 'POST', body: { order_id: order.id, supplier_id: supplier.id, currency: 'USD' } }))
  await must(
    rest('admin', 'order_items', {
      method: 'POST',
      body: [
        { order_id: order.id, position: 0, description: 'Pressure transmitter 0-10 bar, 4-20 mA HART', qty: 3, unit: 'ea', unit_price_net: 100000, gst_rate: 18, supplier_order_id: leg.id, supplier_unit_price: 612, is_service: false },
        { order_id: order.id, position: 1, description: 'Commissioning and loop check', qty: 1, unit: 'job', unit_price_net: 135000, gst_rate: 18, supplier_order_id: null, supplier_unit_price: null, is_service: true },
      ],
      prefer: 'return=minimal',
    }),
  )
  const [invoice] = await must(
    rest<{ id: string; number: string }[]>('admin', 'invoices', {
      method: 'POST',
      body: { order_id: order.id, number: `A11Y-${tag}`, invoice_date: karachiDay(-1), net_amount: 300000, gst_amount: 54000 },
    }),
  )
  const recurring = `Internet ${tag}`
  await must(rest('admin', 'recurring_expenses', { method: 'POST', body: { label: recurring, category_id: UTILITIES, amount: 9500, day_of_month: 1 }, prefer: 'return=minimal' }))
  return { tag, customer, supplier, rfq, order, invoice, recurring }
}

/** An open RFQ owned by the admin with two questions asked 9 days ago: a customer chase that is due today, with its 1-tap chase. */
export async function seedChase(): Promise<{ ref: string; rfqId: string }> {
  const co = await createCompany(uniqueName('Chase Customer'))
  const rfq = await createRfq(co.id, { owner_id: ADMIN_ID, due_on: karachiDay(14), customer_ref: `C${Math.random().toString(36).slice(2, 7)}` })
  await must(rest('admin', 'rfq_items', { method: 'POST', body: { rfq_id: rfq.id, position: 0, description: 'Flow meter DN50', qty: 2 }, prefer: 'return=minimal' }))
  const asked = `${karachiDay(-9)}T09:00:00+05:00`
  await must(
    rest('admin', 'clarifications', {
      method: 'POST',
      body: [
        { rfq_id: rfq.id, question: 'Line size and flange rating on the process line', first_asked_at: asked, last_asked_at: asked, ask_count: 1 },
        { rfq_id: rfq.id, question: 'Fluid temperature range', first_asked_at: asked, last_asked_at: asked, ask_count: 1 },
      ],
      prefer: 'return=minimal',
    }),
  )
  return { ref: `RFQ-${String(rfq.number).padStart(4, '0')}`, rfqId: rfq.id }
}

/** On Today (already open): selects the chase for `ref` and returns its pane and its 1-tap chase button. */
export async function openChase(page: Page, ref: string) {
  await page.locator('li[data-rule="chase_customer"]').filter({ hasText: ref }).getByRole('button').first().click()
  const pane = page.getByRole('region', { name: new RegExp(ref) })
  const button = pane.getByRole('button', { name: UI.chase })
  await expect(button).toBeVisible()
  return { pane, button }
}

/** The main screens, as the admin sees them: a name for the test title and the path, which may need the seeded records. */
export const SCREENS: ReadonlyArray<{ name: string; path: (w: World) => string }> = [
  { name: 'Today', path: () => '/today' },
  { name: 'RFQ board', path: () => '/rfqs' },
  { name: 'New RFQ', path: () => '/rfqs/new' },
  { name: 'RFQ detail', path: w => `/rfqs/${w.rfq.id}` },
  { name: 'Orders', path: () => '/orders' },
  { name: 'Order detail', path: w => `/orders/${w.order.id}` },
  { name: 'Companies', path: () => '/companies' },
  { name: 'Company detail', path: w => `/companies/${w.customer.id}` },
  { name: 'GST register', path: () => '/money/gst-register' },
  { name: 'Receivables', path: () => '/money/receivables' },
  { name: 'Expenses', path: () => '/money/expenses' },
  { name: 'Month-end', path: () => '/money/month-end' },
  { name: 'Reports', path: () => '/reports' },
  { name: 'Settings', path: () => '/settings' },
  { name: 'Team', path: () => '/settings/team' },
]

/** The owner's laptop (1366 wide) at 200%, 175% and 125% zoom, and the WCAG 1.4.10 reflow box. */
export const ZOOM_BANDS = [
  { name: '200% (683x330)', width: 683, height: 330 },
  { name: '175% (780x600)', width: 780, height: 600 },
  { name: '125% (1093x560)', width: 1093, height: 560 },
  { name: 'reflow (320x256)', width: 320, height: 256 },
] as const

/**
 * `test` for this suite: every page starts signed in as the admin (one sign-in per worker, kept as storage state), and `world`
 * holds the records above. A test that needs another role or no session opens its own context with `signedOutContext`.
 */
export const test = base.extend<{ world: World }, { adminState: string; worldOnce: World }>({
  adminState: [
    async ({ browser }, provide, info) => {
      const path = join(tmpdir(), `qtech-a11y-admin-${process.pid}-${info.workerIndex}.json`)
      const context = await browser.newContext({ baseURL: info.project.use.baseURL })
      const page = await context.newPage()
      await openAs(page, 'admin', '/today')
      await context.storageState({ path })
      await context.close()
      await provide(path)
    },
    { scope: 'worker' },
  ],
  // Playwright reads the fixtures a fixture needs from its first argument, so it must be a (here empty) object pattern.
  // eslint-disable-next-line no-empty-pattern
  worldOnce: [async ({}, provide) => provide(await makeWorld()), { scope: 'worker' }],
  world: async ({ worldOnce }, provide) => provide(worldOnce),
  storageState: async ({ adminState }, provide) => provide(adminState),
})
export { expect }

/** Opens `path` and waits until the screen has settled: the shell, the page's heading, no request in flight, no animation. */
export async function open(page: Page, path: string): Promise<void> {
  await page.goto(path)
  await page.locator('#main').waitFor()
  await page.locator('#main h1').first().waitFor({ state: 'attached' })
  await page.waitForLoadState('networkidle')
  await waitForAnimationsToFinish(page)
}

/** Runs `body` with a page in a context of its own, signed in as `role` (or signed out when `role` is null), then closes it. */
export async function asRole(browser: Browser, info: TestInfo, role: Role | null, path: string, body: (page: Page) => Promise<void>): Promise<void> {
  const use = info.project.use
  const context = await browser.newContext({ baseURL: use.baseURL, viewport: use.viewport, reducedMotion: 'reduce', storageState: undefined })
  try {
    const page = await context.newPage()
    if (role) await openAs(page, role, path)
    else await page.goto(path)
    await body(page)
  } finally {
    await context.close()
  }
}

/**
 * This suite runs axe strict: the reliably-real "needs review" results (STRICT_INCOMPLETE in e2e/support/axe.ts) fail too. It sets
 * A11Y_STRICT=1 for its own worker (a worker only ever runs one project), so the feature suites keep their default until the
 * findings are fixed and strict can be on everywhere.
 */
process.env.A11Y_STRICT = '1'

/** axe for this suite (strict, WCAG 2.2 AA plus best practice). */
export function axe(page: Page, opts: { landmarks?: boolean } = {}): Promise<string[]> {
  return axeViolations(page, { landmarks: opts.landmarks ?? true })
}

/* -------------------------------------------------------------------------------------------------------------------------------
 * Layout at the zoom bands: nothing scrolls sideways, open dialogs and menus sit inside the window, and no title is cut off.
 * ----------------------------------------------------------------------------------------------------------------------------- */

/** Sideways scroll of the page or of #main, and headings that run out of the window or are cut off by their own box. */
export async function layoutProblems(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const out: string[] = []
    const vw = window.innerWidth
    const doc = document.documentElement
    const describe = (el: Element) => {
      const id = el.id ? `#${el.id}` : ''
      const slot = el.getAttribute('data-slot') ?? el.getAttribute('data-testid')
      const cls = (el.getAttribute('class') ?? '').split(/\s+/).filter(c => /w-\[|min-w|grid-cols|truncate|whitespace/.test(c)).slice(0, 3).join('.')
      return `<${el.tagName.toLowerCase()}${id}${slot ? ` ${slot}` : ''}${cls ? ` .${cls}` : ''}>`
    }
    // The element that sticks out furthest past the right edge, to name the likely cause. Content inside its own scroller
    // (a table that scrolls sideways, a segmented control's track) is allowed to be wider, so it is not a suspect.
    const ownScroller = (el: Element) => {
      for (let p = el.parentElement; p && p !== document.body && p.id !== 'main'; p = p.parentElement) {
        if (getComputedStyle(p).overflowX !== 'visible') return true
      }
      return false
    }
    const widest = () => {
      let worst: Element | null = null
      let right = vw
      for (const el of Array.from(document.querySelectorAll('body *'))) {
        const r = el.getBoundingClientRect()
        if (r.width === 0 || r.height === 0 || r.right <= right + 1 || ownScroller(el)) continue
        {
          right = r.right
          worst = el
        }
      }
      return worst ? ` (widest: ${describe(worst)} ends at ${Math.round(right)}px)` : ''
    }
    if (doc.scrollWidth > vw + 1) out.push(`the page scrolls sideways: ${doc.scrollWidth}px wide in a ${vw}px window${widest()}`)
    const main = document.querySelector('#main')
    if (main && main.scrollWidth > main.clientWidth + 1) out.push(`#main scrolls sideways: ${main.scrollWidth}px of content in ${main.clientWidth}px${widest()}`)

    const shown = (el: Element) => {
      const r = el.getBoundingClientRect()
      const cs = getComputedStyle(el)
      return r.width > 2 && r.height > 2 && cs.visibility !== 'hidden' && Number(cs.opacity) > 0.1
    }
    // Titles: headings, and the phone bar's screen title (a <p> on purpose, the page has its own h1).
    for (const h of Array.from(document.querySelectorAll('h1, h2, h3, [role="heading"], [data-mobile-bar] p'))) {
      if (!shown(h)) continue
      const text = (h.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 50)
      const r = h.getBoundingClientRect()
      if (r.left < -1 || r.right > vw + 1) out.push(`title "${text}" runs outside the window (${Math.round(r.left)} to ${Math.round(r.right)}px of ${vw}px)`)
      for (const el of [h, ...Array.from(h.querySelectorAll('*'))]) {
        const cs = getComputedStyle(el)
        const clips = cs.overflowX === 'hidden' || cs.overflowX === 'clip' || cs.textOverflow === 'ellipsis'
        if (clips && el.scrollWidth > el.clientWidth + 1 && shown(el)) {
          out.push(`title "${text}" is cut off: ${el.scrollWidth}px of text in a ${el.clientWidth}px box ${describe(el)}`)
          break
        }
      }
    }
    return out
  })
}

/** Every open dialog, alert dialog and menu must lie inside the window, with its title and its close button on screen. */
export async function overlayProblems(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const out: string[] = []
    const vw = window.innerWidth
    const vh = window.innerHeight
    const nameOf = (el: Element) =>
      el.getAttribute('aria-label') ??
      (el.getAttribute('aria-labelledby') ?? '')
        .split(/\s+/)
        .map(id => document.getElementById(id)?.textContent ?? '')
        .join(' ')
        .trim()
    const outside = (r: DOMRect) => r.left < -1 || r.top < -1 || r.right > vw + 1 || r.bottom > vh + 1
    const where = (r: DOMRect) => `${Math.round(r.width)}x${Math.round(r.height)} at (${Math.round(r.left)}, ${Math.round(r.top)})`
    for (const d of Array.from(document.querySelectorAll('[role="dialog"], [role="alertdialog"], [role="menu"]'))) {
      const r = d.getBoundingClientRect()
      if (r.width === 0 || r.height === 0) continue
      const kind = d.getAttribute('role')
      const name = nameOf(d) || '(no name)'
      if (outside(r)) out.push(`${kind} "${name}" is ${where(r)}: not inside the ${vw}x${vh} window`)
      const title = d.querySelector('h1, h2, h3, [role="heading"]')
      if (title) {
        const t = title.getBoundingClientRect()
        if (t.width > 2 && outside(t)) out.push(`${kind} "${name}": its title is off screen, ${where(t)}`)
      }
      const close = Array.from(d.querySelectorAll('button')).find(b => /^close$/i.test(b.getAttribute('aria-label') ?? ''))
      if (close) {
        const c = close.getBoundingClientRect()
        if (c.width > 0 && outside(c)) out.push(`${kind} "${name}": its Close button is off screen, ${where(c)}`)
      }
    }
    return out
  })
}

/* -------------------------------------------------------------------------------------------------------------------------------
 * Keyboard: a Tab sweep that checks every stop (visible, a focus indicator, not under a sticky or fixed bar, never <body>).
 * ----------------------------------------------------------------------------------------------------------------------------- */

interface Stop {
  key: string
  who: string
  problems: string[]
}

/**
 * Looks at the focused element. A focus indicator is either a ring on the element itself (an outline of 1px or more, or a box
 * shadow, on an element that is not clipped or see-through), or a visible change on it or its two nearest ancestors between focused
 * and not focused (border, outline, shadow, underline, or a background that differs by 3:1). The unfocused look is read by blurring
 * the element and focusing it again (still :focus-visible, the last input was a key). Obscured: the point at the element's centre
 * must belong to the element (or the label around a visually hidden control), not to a sticky bar or a fixed toast.
 */
async function inspectFocus(page: Page): Promise<Stop> {
  return page.evaluate(async () => {
    const frame = () => new Promise<void>(r => requestAnimationFrame(() => r()))
    await frame()
    const w = window as unknown as { __a11yIds?: WeakMap<Element, number>; __a11yN?: number }
    w.__a11yIds ??= new WeakMap()
    w.__a11yN ??= 0
    const el = document.activeElement as HTMLElement | null
    if (!el || el === document.body || el === document.documentElement) return { key: 'body', who: '<body>', problems: ['focus is on <body>'] }
    if (!w.__a11yIds.has(el)) w.__a11yIds.set(el, ++w.__a11yN)
    const key = String(w.__a11yIds.get(el))
    const label = (el.getAttribute('aria-label') ?? el.textContent ?? el.getAttribute('placeholder') ?? el.getAttribute('title') ?? '').replace(/\s+/g, ' ').trim().slice(0, 40)
    const role = el.getAttribute('role')
    const who = `<${el.tagName.toLowerCase()}${role ? ` role=${role}` : ''}> "${label}"`
    const problems: string[] = []

    const vw = window.innerWidth
    const vh = window.innerHeight
    const rect = el.getBoundingClientRect()
    const cs = getComputedStyle(el)
    const tiny = rect.width <= 2 || rect.height <= 2 || (cs.clip !== 'auto' && cs.clip !== '') || cs.clipPath !== 'none'
    // A visually hidden control (an sr-only radio inside its card) is judged by the box around it.
    const box = tiny ? (el.closest('label') ?? el.parentElement ?? el) : el
    const r = box.getBoundingClientRect()
    if (r.width < 1 || r.height < 1) problems.push('it has no size')
    else if (r.bottom <= 0 || r.top >= vh || r.right <= 0 || r.left >= vw) problems.push(`it is off screen at (${Math.round(r.left)}, ${Math.round(r.top)})`)

    const opacity = (n: Element | null) => {
      let o = 1
      for (let x = n; x; x = x.parentElement) o *= Number(getComputedStyle(x).opacity)
      return o
    }
    const transparent = (c: string) => c === 'transparent' || /rgba\([^)]*,\s*0\)$/.test(c)
    const ring = (n: Element) => {
      const s = getComputedStyle(n)
      const outline = s.outlineStyle !== 'none' && parseFloat(s.outlineWidth) >= 1 && !transparent(s.outlineColor)
      const shadow = s.boxShadow !== 'none' && s.boxShadow !== ''
      return outline || shadow
    }
    const chain = [el, el.parentElement, el.parentElement?.parentElement].filter((n): n is HTMLElement => !!n)
    const look = () =>
      chain.map(n => {
        const s = getComputedStyle(n)
        return {
          edge: [s.outlineStyle, s.outlineWidth, s.outlineColor, s.boxShadow, s.borderTopColor, s.borderRightColor, s.borderBottomColor, s.borderLeftColor, s.textDecorationLine].join('|'),
          bg: s.backgroundColor,
        }
      })
    const lum = (c: string) => {
      const m = c.match(/[\d.]+/g)
      if (!m) return 1
      const [R, G, B] = m.slice(0, 3).map(v => {
        const x = Number(v) / 255
        return x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4
      })
      return 0.2126 * R + 0.7152 * G + 0.0722 * B
    }
    const ratio = (a: string, b: string) => {
      const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p)
      return (x + 0.05) / (y + 0.05)
    }

    const focused = look()
    el.blur()
    await frame()
    const plain = look()
    el.focus({ preventScroll: true })
    await frame()
    if (document.activeElement !== el) problems.push('it could not be focused again (it changes when it loses focus)')

    const own = !tiny && ring(el) && opacity(el) >= 0.5
    const changed = chain.some((n, i) => {
      if (opacity(n) < 0.5 || n.getBoundingClientRect().width <= 2) return false
      const edge = focused[i].edge !== plain[i].edge
      const bg = focused[i].bg !== plain[i].bg && !transparent(focused[i].bg) && ratio(focused[i].bg, transparent(plain[i].bg) ? 'rgb(255, 255, 255)' : plain[i].bg) >= 3
      return edge || bg
    })
    if (!own && !changed) problems.push(opacity(el) < 0.5 ? `no visible focus indicator (it is see-through, opacity ${opacity(el).toFixed(2)})` : 'no visible focus indicator')

    if (r.width >= 1 && r.height >= 1) {
      const cx = Math.min(Math.max(r.left + r.width / 2, 0), vw - 1)
      const cy = Math.min(Math.max(r.top + r.height / 2, 0), vh - 1)
      const hit = document.elementFromPoint(cx, cy)
      const ok = !!hit && (hit === el || el.contains(hit) || hit.contains(el) || box.contains(hit))
      if (!ok) {
        const bar = hit?.closest('[data-action-bar], [role="region"], header, nav, footer, [class*="sticky"], [class*="fixed"]') ?? hit
        const name = bar?.getAttribute('aria-label') ?? bar?.getAttribute('data-slot') ?? ''
        problems.push(`its centre is covered by <${bar?.tagName.toLowerCase() ?? 'nothing'}${name ? ` "${name}"` : ''}>`)
      }
    }
    return { key, who, problems }
  })
}

/**
 * Presses Tab up to `max` times from wherever focus is and checks every stop. Stops when focus comes back round to the first stop.
 * Leaving the last control for the browser's own UI puts focus on <body> for one press: that is the wrap, not a bug.
 */
export async function focusSweep(page: Page, max = 45): Promise<string[]> {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  const out: string[] = []
  let first: string | null = null
  let body: number | null = null
  for (let i = 1; i <= max; i++) {
    await page.keyboard.press('Tab')
    const s = await inspectFocus(page)
    if (s.key === 'body') {
      if (body !== null) out.push(`Tab ${body}: focus is on <body>`)
      body = i
      continue
    }
    if (first === null) first = s.key
    else if (s.key === first) return out // round once: a <body> just before this was the wrap
    if (body !== null) out.push(`Tab ${body}: focus is on <body>`)
    body = null
    for (const p of s.problems) out.push(`Tab ${i} ${s.who}: ${p}`)
  }
  return out
}

/** Where focus is now: a short description, or '<body>' when it was dropped. */
export async function focusedThing(page: Page): Promise<string> {
  return page.evaluate(() => {
    const el = document.activeElement
    if (!el || el === document.body || el === document.documentElement) return '<body>'
    const label = (el.getAttribute('aria-label') ?? el.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 40)
    return `<${el.tagName.toLowerCase()}${el.getAttribute('role') ? ` role=${el.getAttribute('role')}` : ''}> "${label}"`
  })
}

/** Checks the stop focus is on now (the same rules as the sweep). */
export async function focusProblems(page: Page): Promise<string[]> {
  const s = await inspectFocus(page)
  return s.problems.map(p => `${s.who}: ${p}`)
}

/* -------------------------------------------------------------------------------------------------------------------------------
 * Live regions.
 * ----------------------------------------------------------------------------------------------------------------------------- */

const LIVE = '[aria-live]:not([aria-live="off"]), [role="status"], [role="alert"], [role="log"]'

/** Tags every live region on the page now, so `announcedBy` can tell a region that was waiting from one inserted with its text. */
export async function markLiveRegions(page: Page): Promise<number> {
  return page.evaluate(sel => {
    const all = Array.from(document.querySelectorAll(sel))
    all.forEach(el => el.setAttribute('data-a11y-live-before', ''))
    return all.length
  }, LIVE)
}

/**
 * Where `text` will be heard from: 'waiting' when it is inside a live region that was on the page before it appeared (what screen
 * readers announce reliably), 'inserted' when its live region came with it (often missed, worst for role=status), 'none' when it is
 * in no live region. role=alert inserted with its content is announced by design, so it counts as 'waiting'.
 */
export async function announcedBy(page: Page, text: RegExp): Promise<'waiting' | 'inserted' | 'none'> {
  return page.evaluate(
    ({ sel, source, flags }) => {
      const re = new RegExp(source, flags)
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
      const regions = new Set<Element>()
      for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        const host = n.parentElement
        if (!host || !re.test(host.textContent ?? '')) continue
        const live = host.closest(sel)
        if (live) regions.add(live)
        else regions.add(document.body)
      }
      if (regions.size === 0) return 'none'
      let best: 'waiting' | 'inserted' | 'none' = 'none'
      for (const r of regions) {
        if (r === document.body) continue
        let x: Element | null = r
        let waiting = false
        for (; x; x = x.parentElement?.closest(sel) ?? null) if (x.hasAttribute('data-a11y-live-before') || x.getAttribute('role') === 'alert') waiting = true
        if (waiting) return 'waiting'
        best = 'inserted'
      }
      return best
    },
    { sel: LIVE, source: text.source, flags: text.flags },
  )
}

/** What a screen reader would read out of the live region holding `text` (aria-hidden parts left out). */
export async function liveText(page: Page, text: RegExp): Promise<string | null> {
  return page.evaluate(
    ({ sel, source, flags }) => {
      const re = new RegExp(source, flags)
      const region = Array.from(document.querySelectorAll(sel)).find(r => re.test(r.textContent ?? ''))
      if (!region) return null
      const read = (n: Node): string => {
        if (n.nodeType === Node.TEXT_NODE) return n.textContent ?? ''
        if (!(n instanceof Element)) return ''
        if (n.getAttribute('aria-hidden') === 'true') return ''
        const s = getComputedStyle(n)
        if (s.display === 'none' || s.visibility === 'hidden') return ''
        const label = n.getAttribute('aria-label')
        if (label && n !== region) return ` ${label} `
        return Array.from(n.childNodes).map(read).join('')
      }
      return read(region).replace(/\s+/g, ' ').trim()
    },
    { sel: LIVE, source: text.source, flags: text.flags },
  )
}
