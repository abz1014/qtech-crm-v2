import { expect, test, type Page } from '@playwright/test'
import type { Role } from '../../support/stack'
import { as, db, num, rpcAs, USER } from '../support/db'
import { company, invoice, karachiDay, monthBefore, order, payment, quote, quotedRfq, rfq, supplier } from '../support/fixtures'
import { moneyRequests, open, restLog, signedIn } from '../support/session'
import { ROLES, amount } from '../support/text'

/*
 * Who may do what, checked three ways: every route for every role (the page or the no-access page), every forbidden write and read at
 * the database as that role (Row Level Security and the functions' own role checks), and what an engineer's screens show and ask for.
 *
 * The rules (DECISIONS 2026-10-13, 2026-10-19; docs/guides): engineers work the whole CRM but never see payments, expenses, costs,
 * margins, cash, invoices, the Money or Reports pages or the spread (they MAY see selling prices on the quotation screens). Sales see
 * invoices, the GST register and order balances, but never payment rows, expenses, margins or the P&L, and cannot record payments or
 * close months. Admin only: Team, Targets, Expense categories, Expenses, Month-end (checklist, bank tick, reports), Margins, Exceptions.
 */
type Allowed = readonly Role[]
const ALL: Allowed = ['admin', 'sales', 'engineer']
const MONEY: Allowed = ['admin', 'sales']
const ADMIN: Allowed = ['admin']

test('route matrix: every page opens for the roles allowed and shows the no-access page to everyone else', async ({ browser }, info) => {
  const r = await rfq({ items: [{ description: 'Route matrix item', qty: 1 }] })
  const o = await order({ lines: [{ description: 'Route matrix line', qty: 1, price: 1000 }] })
  const routes: [string, Allowed][] = [
    ['/today', ALL],
    ['/rfqs', ALL],
    ['/rfqs/new', ALL],
    [`/rfqs/${r.rfq.id}`, ALL],
    ['/orders', ALL],
    [`/orders/${o.order.id}`, ALL],
    ['/companies', ALL],
    [`/companies/${r.customer.id}`, ALL],
    ['/money/gst-register', MONEY],
    ['/money/receivables', MONEY],
    ['/money/expenses', ADMIN],
    ['/money/month-end', ADMIN],
    ['/money/month-end/bank', ADMIN],
    ['/money/month-end/pnl', ADMIN],
    ['/money/month-end/categories', ADMIN],
    ['/money/month-end/aging', ADMIN],
    ['/money/month-end/owe', ADMIN],
    ['/money/month-end/gst', ADMIN],
    ['/money/month-end/team', ADMIN],
    ['/money/margins', ADMIN],
    ['/money/exceptions', ADMIN],
    ['/reports', MONEY],
    ['/settings/team', ADMIN],
    ['/settings/targets', ADMIN],
    ['/settings/categories', ADMIN],
    ['/settings/company', ALL],
    ['/settings/details', ALL],
    ['/settings/exchange-rates', MONEY], // engineers: no currency amounts (owner decision 2026-10-22)
    ['/settings/password', ALL],
  ]
  for (const role of ALL) {
    const ctx = await signedIn(browser, info, role)
    const page = await open(ctx, '/today')
    // The main navigation offers exactly the role's destinations.
    const nav = page.getByRole('navigation', { name: ROLES.nav.main })
    const links = (await nav.getByRole('link').allInnerTexts()).map(t => t.split(/\n/)[0].replace(/\s+\d+$/, '').trim()).filter(Boolean) // the label line, without the NeedsCount pill or its words
    expect.soft(links, `${role}: the main navigation`).toEqual([...ROLES.navLabels[role]])
    for (const [path, allowed] of routes) {
      await page.goto(path)
      await page.locator('#main').waitFor()
      await expect.soft(page, `${role} ${path}: not sent to sign in`).not.toHaveURL(/\/login/)
      const denied = page.getByRole('heading', { level: 1, name: ROLES.noAccess })
      if (allowed.includes(role)) {
        await expect(page.getByRole('heading', { level: 1 }).first()).toBeAttached({ timeout: 15_000 })
        await expect.soft(denied, `${role} may open ${path}`).toHaveCount(0)
      } else {
        await expect.soft(denied, `${role} must get the no-access page on ${path}`).toHaveCount(1, { timeout: 15_000 })
      }
    }
    await ctx.close()
  }
})

test('the database refuses every write the rules forbid, for sales and for the engineer', async () => {
  const o = await order({ lines: [{ description: 'Write matrix line', qty: 2, price: 12345.67 }], owner: 'sales' })
  const inv = await invoice(o.order.id, 24691.34, 4444)
  const lastMonth = monthBefore(karachiDay(0), 1).start
  const refused = (status: number) => status >= 400
  const nothingWritten = async (label: string, check: () => Promise<number>) => expect.soft(await check(), `${label}: nothing may be written`).toBe(0)

  for (const role of ['sales', 'engineer'] as const) {
    const tag = `${role}-${Math.random().toString(36).slice(2, 7)}`
    // Money in, money out, costs.
    const pay = await as(role, 'payments_in', { method: 'POST', body: { order_id: o.order.id, amount: 1, reference: tag } })
    expect.soft(refused(pay.status), `${role}: insert payments_in`).toBe(true)
    await nothingWritten(`${role} payments_in`, () => db.count(`payments_in?reference=eq.${tag}&select=id`))
    const exp = await as(role, 'expenses', { method: 'POST', body: { amount_pkr: 1, category_id: 'ca7e0000-0000-4000-8000-000000000002', paid_via: 'cash', description: tag } })
    expect.soft(refused(exp.status), `${role}: insert expenses`).toBe(true)
    await nothingWritten(`${role} expenses`, () => db.count(`expenses?description=eq.${tag}&select=id`))
    const cost = await as(role, 'order_costs', { method: 'POST', body: { order_id: o.order.id, expected_cost_pkr: 1 } })
    expect.soft(refused(cost.status), `${role}: write order_costs`).toBe(true)
    // Months.
    for (const fn of ['close_month', 'close_months_through', 'reopen_month']) {
      const res = await rpcAs(role, fn, { p_month: lastMonth })
      expect.soft(refused(res.status), `${role}: ${fn}`).toBe(true)
    }
    expect.soft(await db.count(`closed_months?month=eq.${lastMonth}&select=month`), `${role}: no month closed`).toBe(0)
    // Admin-only settings.
    const target = await as(role, 'targets', { method: 'POST', body: { user_id: USER.sales, year: 2031, quarter: 1, target_net_pkr: 1 } })
    expect.soft(refused(target.status), `${role}: insert targets`).toBe(true)
    const cat = await as(role, 'expense_categories', { method: 'POST', body: { name: `Cat ${tag}`, grp: 'overhead', default_paid_via: 'cash', sort: 999 } })
    expect.soft(refused(cat.status), `${role}: insert expense_categories`).toBe(true)
    await nothingWritten(`${role} expense_categories`, () => db.count(`expense_categories?name=eq.${encodeURIComponent(`Cat ${tag}`)}&select=id`))
    const before = await db.one<{ legal_name: string | null }>('company_profile?id=eq.1&select=legal_name')
    await as(role, 'company_profile?id=eq.1', { method: 'PATCH', body: { legal_name: `Hijacked ${tag}` } })
    expect.soft((await db.one<{ legal_name: string | null }>('company_profile?id=eq.1&select=legal_name')).legal_name, `${role}: company profile unchanged`).toBe(before.legal_name)
    const promote = await as(role, `users?id=eq.${USER[role]}`, { method: 'PATCH', body: { role: 'admin' } })
    expect.soft((await db.one<{ role: string }>(`users?id=eq.${USER[role]}&select=role`)).role, `${role}: cannot promote themselves (status ${promote.status})`).toBe(role)
  }

  // The engineer touches no invoice at all; sales may create invoices (the rules) but the engineer may not.
  const engInvoice = await as('engineer', 'invoices', { method: 'POST', body: { order_id: o.order.id, company_id: o.customer.id, number: `ENG-${Date.now()}`, net_amount: 1, gst_amount: 0 } })
  expect.soft(engInvoice.status >= 400, 'engineer: insert invoices').toBe(true)
  await as('engineer', `invoices?id=eq.${inv.id}`, { method: 'PATCH', body: { net_amount: 1 } })
  expect.soft(num((await db.one<{ net_amount: number }>(`invoices?id=eq.${inv.id}&select=net_amount`)).net_amount), 'engineer: invoice unchanged').toBe(24691.34)
})

test('the database gives each role only the money it may read', async () => {
  const o = await order({ lines: [{ description: 'Read matrix line', qty: 1, price: 54321.09 }], owner: 'sales' })
  await invoice(o.order.id, 54321.09, 9778)
  await payment(o.order.id, 10000)
  await db.insert('expenses', { amount_pkr: 4321, category_id: 'ca7e0000-0000-4000-8000-000000000011', paid_via: 'bank', order_id: o.order.id, description: 'read matrix' })
  const rows = async (role: Role, path: string) => {
    const r = await as<unknown[]>(role, path)
    return r.status >= 400 ? 'refused' : Array.isArray(r.body) ? r.body.length : 'odd'
  }
  // Engineer: no invoices, payments, expenses, costs, margins or balances.
  for (const path of [`invoices?order_id=eq.${o.order.id}&select=id`, `payments_in?order_id=eq.${o.order.id}&select=id`, `expenses?order_id=eq.${o.order.id}&select=id`, `v_order_money?order_id=eq.${o.order.id}&select=order_id`, `v_gst_register?order_id=eq.${o.order.id}&select=invoice_id`]) {
    expect.soft([0, 'refused'], `engineer reads ${path.split('?')[0]}`).toContain(await rows('engineer', path))
  }
  const recv = await rpcAs('engineer', 'order_receivables', { p_order_id: o.order.id })
  expect.soft(recv.status >= 400 || (Array.isArray(recv.body) && recv.body.length === 0), 'engineer: order_receivables').toBe(true)
  // Sales: invoices and balances yes; payment rows, expenses, margins and the P&L no.
  expect.soft(await rows('sales', `invoices?order_id=eq.${o.order.id}&select=id`), 'sales reads invoices').toBe(1)
  const sb = await rpcAs<{ balance: number }[]>('sales', 'order_receivables', { p_order_id: o.order.id })
  // 54,321.09 + 9,778 = 64,099.09 gross, less 10,000 paid = 54,099.09
  expect.soft(sb.status < 300 && num(sb.body[0]?.balance), 'sales reads the balance').toBe(54099.09)
  for (const path of [`payments_in?order_id=eq.${o.order.id}&select=id`, `expenses?order_id=eq.${o.order.id}&select=id`, `v_order_money?order_id=eq.${o.order.id}&select=order_id`, 'v_month_pnl?select=month', `order_costs?order_id=eq.${o.order.id}&select=order_id`]) {
    expect.soft([0, 'refused'], `sales reads ${path.split('?')[0]}`).toContain(await rows('sales', path))
  }
})

test('order page by role: sales see no payment action or margin; the engineer sees no price, total or money panel', async ({ browser }, info) => {
  // Distinctive figures: 3 x 98,765.43 = 296,296.29 net.
  const sup = await supplier('Verify Roles Supplier', 'Pakistan')
  const o = await order({ suppliers: [{ supplier: sup }], lines: [{ description: 'Roles check gas detector', qty: 3, price: 98765.43, leg: 0, supplierPrice: 71234.56 }], owner: 'sales' })
  await db.insert('order_engineers', { order_id: o.order.id, user_id: USER.engineer })

  const sales = await signedIn(browser, info, 'sales')
  const sp = await open(sales, `/orders/${o.order.id}`)
  await expect(sp.getByRole('region', { name: ROLES.order.items })).toContainText(amount(296296.29))
  await expect(sp.getByTestId(ROLES.order.invoicedTestId)).toBeVisible()
  await expect(sp.getByRole('button', { name: ROLES.order.recordPayment })).toHaveCount(0)
  await expect(sp.getByRole('region', { name: ROLES.order.marginPanel, exact: true })).toHaveCount(0)
  await sales.close()

  const eng = await signedIn(browser, info, 'engineer')
  const ep = await eng.newPage()
  const log = restLog(ep)
  await ep.goto(`/orders/${o.order.id}`)
  await ep.locator('#main').waitFor()
  await expect(ep.getByRole('region', { name: ROLES.order.items })).toContainText('Roles check gas detector')
  await ep.waitForLoadState('networkidle')
  const text = await ep.locator('#main').innerText()
  for (const f of [amount(98765.43), amount(296296.29), amount(71234.56), amount(213703.68)]) expect.soft(text, `the engineer's order page must not show ${f}`).not.toContain(f)
  await expect(ep.getByTestId(ROLES.order.invoicedTestId)).toHaveCount(0)
  await expect(ep.getByRole('region', { name: ROLES.order.marginPanel, exact: true })).toHaveCount(0)
  await expect(ep.getByRole('button', { name: ROLES.order.issuePo })).toHaveCount(0)
  await expect(ep.getByRole('button', { name: ROLES.order.createInvoice })).toHaveCount(0)
  expect(moneyRequests(log.urls), 'no money request from the engineer').toEqual([])
  expect(log.urls.filter(u => /unit_price_net|supplier_unit_price|net_amount/.test(u)), 'no price column asked for').toEqual([])
  await eng.close()
})

test('an engineer walking every screen asks for no money and never sees a price or a spread', async ({ browser }, info) => {
  const won = await quotedRfq({ items: [{ description: 'Engineer walk radar gauge', qty: 2, price: 87654.32, supplierPrice: 61000 }] })
  const second = await supplier('Verify Walk Second Supplier', 'Pakistan')
  await quote(won.rfq.id, second, [{ itemId: won.items[0].id, price: 63500 }], 'PKR')
  const o = await order({ lines: [{ description: 'Engineer walk order line', qty: 1, price: 45000 }] })
  const other = await company('Verify Walk Customer')

  const eng = await signedIn(browser, info, 'engineer')
  const page: Page = await eng.newPage()
  const log = restLog(page)
  for (const path of ['/today', '/rfqs', `/rfqs/${won.rfq.id}`, '/orders', `/orders/${o.order.id}`, '/companies', `/companies/${other.id}`, `/companies/${won.supplier.id}`]) {
    await page.goto(path)
    await page.locator('#main').waitFor()
    await page.waitForLoadState('networkidle')
  }
  // The RFQ page (owner decision 2026-10-22: engineers see no prices): who quoted is there, no price, no rank, no spread.
  await page.goto(`/rfqs/${won.rfq.id}`)
  await page.locator('#main').waitFor()
  await page.waitForLoadState('networkidle')
  const item = page.getByRole('article', { name: 'Item 1' })
  await expect(item).toContainText('Verify Lahore Stockist')
  await expect(item).toContainText('Verify Walk Second Supplier')
  await expect(page.locator('li[data-ranked]')).toHaveCount(0)
  await expect(page.getByText(ROLES.rfq.spread)).toHaveCount(0)
  const rfqText = await page.locator('#main').innerText()
  expect.soft(rfqText, 'the engineer RFQ page shows no PKR amount').not.toMatch(/PKR\s*[\d≈]|≈\s*PKR/)
  for (const f of ['87,654', '61,000', '63,500']) expect.soft(rfqText, `the engineer RFQ page must not show ${f}`).not.toContain(f)
  expect(log.urls.filter(u => /unit_price|fx_rate_pkr|net_total|gst_total|quoted_unit_price_net/.test(u)), 'no price column asked for on the RFQ page').toEqual([])
  // The search palette, typed with the order number.
  await page.keyboard.press('Control+k')
  await page.getByRole('combobox').fill(`ORD-${String(o.order.number).padStart(4, '0')}`)
  await page.waitForTimeout(800)
  await page.keyboard.press('Escape')
  expect(moneyRequests(log.urls), 'the engineer must make no money request on any screen').toEqual([])
  // 0081 (owner decision 2026-10-22): the database refuses the ranking (supplier prices) to an engineer outright.
  const ranked = await rpcAs('engineer', 'rank_item_quotes', { p_rfq_id: won.rfq.id })
  expect(ranked.status).toBe(403)
  await eng.close()
})
