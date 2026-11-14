import { expect, test, type Page } from '@playwright/test'
import { openStage } from '../support/job'
import { createCompany, karachiDay, must, openAs, rest, uniqueName } from '../support/stack'
import { axeViolations } from '../support/axe'

/*
 * Profitability (0137) end to end, against the local CI stack, as the fixture users through the real login form, with data set up
 * through the REST API as the admin:
 *   - the order page's Margin panel shows "Cash so far" (received, paid out, left, "includes GST") beside the invoiced margin;
 *   - Money > Margins has the Invoiced / Cash switch;
 *   - Money > Profitability (/money/profit) shows the average monthly income over the last 12 complete months (this month left out,
 *     computed here from the same two monthly views), the 12/24 month chart with its data table, and the monthly profit table;
 *   - sales and engineers get nothing: no page, no row from v_order_profit. Axe (WCAG 2.2 AA) at 1440 and 375.
 */
const SUPPLIER_PAYMENT = 'ca7e0000-0000-4000-8000-000000000011'
const today = () => karachiDay(0)

async function post<T = { id: string }>(table: string, body: unknown): Promise<T> {
  return (await must(rest<T[]>('admin', table, { method: 'POST', body })))[0]
}

/** An order for a new customer: one line, net 1,000 (GST 180, gross 1,180), a payment of 1,180 and one expense of 300. */
async function seedPaidOrder(): Promise<{ id: string; number: number; customer: string }> {
  const customer = uniqueName('Profit Customer')
  const co = await createCompany(customer)
  const order = await post<{ id: string; number: number }>('orders', { company_id: co.id })
  await post('order_items', { order_id: order.id, position: 0, description: 'Profit test item', qty: 1, unit_price_net: 1000 })
  await post('payments_in', { order_id: order.id, amount: 1180, received_on: today() })
  await post('expenses', { order_id: order.id, amount_pkr: 300, category_id: SUPPLIER_PAYMENT, paid_on: today(), description: 'profit test cost' })
  return { id: order.id, number: order.number, customer }
}

const digits = (s: string) => Number(s.replace(/[^0-9.]/g, ''))

/** The 12 complete months before this one, as "YYYY-MM" keys. */
function last12(): string[] {
  const [y, m] = today().slice(0, 7).split('-').map(Number)
  return Array.from({ length: 12 }, (_, i) => {
    const d = new Date(Date.UTC(y, m - 1 - 12 + i, 1))
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
  })
}

async function goto(page: Page, path: string): Promise<void> {
  await openAs(page, 'admin', path)
}

test.describe('Cash so far on the order page', () => {
  test('the Margin panel shows received, paid out and left, and says it includes GST', async ({ page }) => {
    const o = await seedPaidOrder()
    await goto(page, `/orders/${o.id}`)
    await openStage(page, 'Order')
    const cash = page.getByRole('region', { name: 'Margin' }).getByRole('region', { name: 'Cash so far' })
    await expect(cash).toContainText('includes GST')
    await expect(cash.getByText('Received').locator('..')).toContainText('1,180')
    await expect(cash.getByText('Paid out').locator('..')).toContainText('300')
    await expect(cash.getByTestId('margin-cash-left')).toHaveText('880')
    // the database agrees
    const row = await must(rest<{ received: number; paid_out: number; cash_profit: number; net_sale: number }[]>('admin', `v_order_profit?order_id=eq.${o.id}&select=received,paid_out,cash_profit,net_sale`))
    expect(row.map(r => ({ received: Number(r.received), paid_out: Number(r.paid_out), cash_profit: Number(r.cash_profit), net_sale: Number(r.net_sale) }))).toEqual([{ received: 1180, paid_out: 300, cash_profit: 880, net_sale: 1000 }])
  })
})

test.describe('Margins: Invoiced and Cash', () => {
  test('the switch shows cash received, paid out and left for each order', async ({ page }) => {
    const o = await seedPaidOrder()
    await goto(page, '/money/margins')
    await expect(page.getByRole('heading', { name: 'Order margins' })).toBeVisible()
    await page.getByRole('radio', { name: 'Cash' }).click()
    const body = page.getByTestId('margins-cash')
    await expect(body).toContainText('includes GST')
    const row = body.getByTestId('cash-row').filter({ hasText: o.customer })
    await expect(row).toContainText('880')
    await expect(row).toContainText('1,180')
    await expect(row).toContainText('300')
    await expect(body.getByTestId('cash-totals')).toContainText('Total of')
    await page.getByRole('radio', { name: 'Invoiced' }).click()
    await expect(page.getByTestId('margins-cash')).toHaveCount(0)
    await expect(page.getByTestId('margin-totals')).toBeVisible()
  })

  test('?basis=cash opens the cash view', async ({ page }) => {
    await goto(page, '/money/margins?basis=cash')
    await expect(page.getByTestId('margins-cash')).toBeVisible()
  })
})

test.describe('Money > Profitability (admin)', () => {
  test('average monthly income over the last 12 complete months, the chart with its table, and the monthly profit table', async ({ page }) => {
    await seedPaidOrder()
    const months = last12()
    const profit = await must(rest<{ month: string; sales_net: number }[]>('admin', 'v_month_profit?select=month,sales_net'))
    const flows = await must(rest<{ month: string; money_in: number }[]>('admin', 'v_month_cash_flow?select=month,money_in'))
    const inRange = (month: string) => months.includes(month.slice(0, 7))
    const income = profit.filter(r => inRange(r.month)).reduce((a, r) => a + Number(r.sales_net), 0)
    const cash = flows.filter(r => inRange(r.month)).reduce((a, r) => a + Number(r.money_in), 0)

    await goto(page, '/money/profit')
    await expect(page.getByRole('heading', { name: 'Profitability', level: 2 })).toBeVisible()
    const avg = page.getByTestId('profit-average')
    await expect(avg).toContainText('Average monthly income')
    await expect(avg).toContainText('GST left out')
    await expect(avg).toContainText('This month is left out')
    await expect(avg).toContainText(/includes GST/i)
    expect(Math.abs(digits(await page.getByTestId('profit-average-income').innerText()) - income / 12)).toBeLessThanOrEqual(1)
    expect(Math.abs(digits(await page.getByTestId('profit-average-cash').innerText()) - cash / 12)).toBeLessThanOrEqual(1)

    // the chart is one image with a summary; the figures are in a table on request
    const chart = page.getByTestId('bar-chart')
    await expect(chart.getByRole('img')).toHaveAccessibleName(/last 12 complete months/)
    await expect(chart.getByRole('table')).toHaveCount(0)
    await chart.getByRole('button', { name: 'Show as a table' }).click()
    await expect(chart.getByRole('table').getByRole('row')).toHaveCount(13)

    // the profit table lists the 12 complete months, newest first, and not this month
    const label = (key: string) => `${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][Number(key.slice(5)) - 1]} ${key.slice(0, 4)}`
    const table = page.getByRole('table', { name: 'Profit by month, last 12 months' })
    // a run of empty months is one line ("Jan to Sep 2026: nothing recorded"), so a month is either a row or inside such a line
    const short = (key: string) => label(key).slice(0, 3)
    const shown = async (key: string) => {
      const text = await table.innerText()
      return text.includes(label(key)) || (text.includes('nothing recorded') && text.includes(short(key)))
    }
    expect(await shown(months[11])).toBe(true)
    expect(await shown(months[0])).toBe(true)
    await expect(table).not.toContainText(label(today().slice(0, 7)))
    await expect(table).toContainText('Cash received, includes GST')

    // 24 months
    await page.getByRole('radio', { name: '24 months' }).click()
    const table24 = page.getByRole('table', { name: 'Profit by month, last 24 months' })
    const first24 = new Date(Date.UTC(Number(today().slice(0, 4)), Number(today().slice(5, 7)) - 1 - 24, 1))
    await expect(table24).toContainText(label(`${first24.getUTCFullYear()}-${String(first24.getUTCMonth() + 1).padStart(2, '0')}`))
    await expect(page.getByTestId('bar-chart').getByRole('img')).toHaveAccessibleName(/last 24 complete months/)

    // on to Margins
    await page.getByRole('link', { name: /See the profit of each order/ }).click()
    await expect(page.getByRole('heading', { name: 'Order margins' })).toBeVisible()
  })
})

test.describe('Money > Profitability: enquiries we did not win', () => {
  test('a cost on an enquiry closed without an order is listed, an enquiry that was won is not', async ({ page }) => {
    const lostCo = uniqueName('Lost Enquiry Customer')
    const wonCo = uniqueName('Won Enquiry Customer')
    const lostCompany = await createCompany(lostCo)
    const wonCompany = await createCompany(wonCo)
    const lost = await post<{ id: string; number: number }>('rfqs', { company_id: lostCompany.id, closed_on: today(), close_reason: 'price' })
    const won = await post<{ id: string; number: number }>('rfqs', { company_id: wonCompany.id })
    await post('expenses', { rfq_id: lost.id, amount_pkr: 750, category_id: SUPPLIER_PAYMENT, paid_on: today(), description: 'site visit for a lost enquiry' })
    await post('expenses', { rfq_id: won.id, amount_pkr: 300, category_id: SUPPLIER_PAYMENT, paid_on: today(), description: 'cost on an enquiry that became an order' })
    await post('orders', { company_id: wonCompany.id, rfq_id: won.id })

    await goto(page, '/money/profit')
    const section = page.getByRole('table', { name: 'Spent on RFQs not won' })
    await expect(section).toBeVisible()
    const row = section.getByRole('row').filter({ hasText: lostCo })
    await expect(row).toContainText(`RFQ-${String(lost.number).padStart(4, '0')}`)
    await expect(row).toContainText('750')
    await expect(section).not.toContainText(wonCo)
    await expect(page.getByTestId('profit-average')).toBeVisible()
  })
})

test.describe('who sees profitability', () => {
  test('sales and engineers get no page and no row', async ({ browser }) => {
    const o = await seedPaidOrder()
    for (const role of ['sales', 'engineer'] as const) {
      const context = await browser.newContext()
      const page = await context.newPage()
      const seen: string[] = []
      page.on('request', r => {
        if (/\/rest\/v1\/(v_order_profit|v_month_profit|v_month_cash_flow)\b/.test(r.url())) seen.push(r.url())
      })
      await openAs(page, role, '/money/receivables')
      await page.goto('/money/profit')
      await page.waitForLoadState('networkidle')
      // the page's own heading (exact): sales meet "Profitability is for admins", the no-access page
      await expect(page.getByRole('heading', { name: 'Profitability', exact: true })).toHaveCount(0)
      if (role === 'sales') await expect(page.getByRole('heading', { name: 'Profitability is for admins' })).toBeVisible()
      await expect(page.getByTestId('profit-average')).toHaveCount(0)
      expect(seen, `${role}: no profit view is requested`).toEqual([])
      await context.close()
      const r = await rest<unknown[]>(role, `v_order_profit?order_id=eq.${o.id}&select=*`)
      expect(r.status === 200 ? r.body : [], `${role} reads v_order_profit`).toEqual([])
    }
  })
})

for (const width of [1440, 375]) {
  test.describe(`axe at ${width}`, () => {
    test('Profitability and Margins in cash have no violations', async ({ page }) => {
      await seedPaidOrder()
      await page.setViewportSize({ width, height: width > 800 ? 900 : 812 })
      await goto(page, '/money/profit')
      await expect(page.getByTestId('profit-average')).toBeVisible()
      await page.getByTestId('bar-chart').getByRole('button', { name: 'Show as a table' }).click()
      expect(await axeViolations(page), 'profitability').toEqual([])
      await page.goto('/money/margins?basis=cash')
      await expect(page.getByTestId('margins-cash')).toBeVisible()
      expect(await axeViolations(page), 'margins in cash').toEqual([])
    })
  })
}
