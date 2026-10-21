import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it } from 'vitest'
import { SessionContext } from '@/app/session'
import type { InquiryRow, QuoteLineRow, RfqHeader, RfqItemRow } from '@/features/rfqs/api'
import { ItemsPanel } from '@/features/rfqs/ItemsPanel'
import type { RankRow } from '@/features/rfqs/lib/ranking/reasons'
import { installFakeDb } from '@/test/fakeSupabase'
import { ToastProvider } from '@/ui/Toast'

/*
 * The supplier comparison on the RFQ page (UX audit 2026-10-19): one line per price, one "Recommended" mark per item, a plain
 * "Cheapest" line when the 2% rule put someone else first, and the details (own currency, rate, reasons) only when a row is opened.
 */

afterEach(() => {
  installFakeDb(() => ({})).uninstall()
})

const rfq = { id: 'r-1', number: 177, company: { id: 'c-1', name: 'Indus Textile Mills' } } as unknown as RfqHeader
const item: RfqItemRow = { id: 'it-1', number: 1, description: 'Cerabar PMC71 pressure transmitter', brandId: null, brandName: 'Endress+Hauser', familyId: null, qty: 2, unit: 'pcs' }

const line = (id: string, inquiryId: string, unitPrice: number, currency = 'USD'): QuoteLineRow => ({
  id,
  inquiryId,
  itemId: 'it-1',
  unitPrice,
  currency,
  leadTime: '3 weeks',
  inStock: true,
  fxRatePkr: 280,
  fxRateOn: '2026-11-20',
})

const inquiry = (id: string, name: string, lines: QuoteLineRow[]): InquiryRow => ({
  id,
  supplierId: `s-${id}`,
  supplierName: name,
  supplierCountry: 'UAE',
  supplierCity: 'Dubai',
  sentOn: '2026-11-20',
  lastChasedOn: null,
  lastRelayedAt: null,
  noOfferOn: null,
  noOfferReason: null,
  itemDeclines: {},
  chaseCount: 0,
  notes: null,
  contactName: null,
  contactPhone: null,
  lastCurrency: 'USD',
  responseState: 'quoted',
  contactState: null,
  itemsQuoted: 1,
  lines,
})

const rank = (o: Partial<RankRow>): RankRow =>
  ({
    rfq_item_id: 'it-1',
    quote_line_id: 'x',
    supplier_id: 's',
    item_qty: 2,
    price: 100,
    currency: 'USD',
    pkr_unit_price: 28_000,
    fx_state: 'fresh',
    fx_rate_pkr: 280,
    fx_rate_on: '2026-11-27',
    fx_age_days: 0,
    comparable: true,
    rank: 1,
    within_band: true,
    pct_above_best: 0,
    sell_unit_net: null,
    sell_source: 'none',
    sell_order_number: null,
    sell_on: null,
    spread_unit: null,
    spread_total: null,
    reliability_band: 1,
    deliveries: 4,
    on_time: 4,
    late: 0,
    median_days_late: null,
    orders_count: 2,
    orders_value_pkr: null,
    last_order_number: null,
    last_order_on: null,
    last_order_delivered_after_days: null,
    replied: 3,
    asked: 3,
    lead_time: '3 weeks',
    in_stock: true,
    ...o,
  }) as RankRow

function renderPanel(inquiries: InquiryRow[], ranking?: Map<string, RankRow>) {
  installFakeDb(() => ({ data: [] }))
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <SessionContext.Provider value={{ status: 'signed-in', user: { id: 'u1', name: 'Ayesha Rana', role: 'sales' } }}>
        <MemoryRouter>
          <ToastProvider>
            <ItemsPanel
              rfq={rfq}
              items={[item]}
              inquiries={inquiries}
              rates={{ USD: { rate: 280, ageDays: 0, staleness: 'fresh' } }}
              fxRows={[]}
              ranking={ranking}
              onAddItem={() => undefined}
              onCopyEnquiry={() => undefined}
            />
          </ToastProvider>
        </MemoryRouter>
      </SessionContext.Provider>
    </QueryClientProvider>,
  )
}

const rows = () => [...within(screen.getByRole('article', { name: 'Item 1' })).getAllByRole('listitem')].filter(li => li.hasAttribute('data-compared'))

describe('the supplier comparison', () => {
  it('marks one supplier Recommended and, when the 2% rule put a dearer one first, names the cheapest in a plain line', () => {
    // B is 1% dearer but has the better record: the database ranks it first.
    const a = inquiry('a', 'Lahore Flow Systems', [line('la', 'a', 100)])
    const b = inquiry('b', 'ABC Traders', [line('lb', 'b', 101)])
    renderPanel(
      [a, b],
      new Map([
        ['lb', rank({ quote_line_id: 'lb', rank: 1, pct_above_best: 1.28 })],
        ['la', rank({ quote_line_id: 'la', rank: 2, pct_above_best: 0, deliveries: 1, on_time: 0, late: 1, reliability_band: 3 })],
      ]),
    )
    // Rows are cheapest first (UX audit C1); the Recommended mark stays on ABC Traders, now the second row.
    const [first, second] = rows()
    expect(first).toHaveTextContent('Lahore Flow Systems')
    expect(within(first).queryByText('Recommended')).toBeNull()
    expect(within(first).getByText('Cheapest')).toBeInTheDocument() // the tag beside the cheapest price
    expect(second).toHaveTextContent('ABC Traders')
    expect(within(second).getByText('Recommended')).toBeInTheDocument()
    expect(within(second).queryByText('Cheapest')).toBeNull()
    expect(screen.getAllByText('Recommended')).toHaveLength(1) // one mark per item
    expect(screen.queryByText('Lowest price')).toBeNull()
    const cheapest = screen.getByText(/^Cheapest:/).closest('[data-cheapest]') as HTMLElement
    expect(cheapest).toHaveTextContent('Cheapest: Lahore Flow Systems. ABC Traders is only 1.3% dearer and has the better delivery record.')
    // The reason sits directly under the Recommended row, not below the list.
    expect(second.nextElementSibling).toBe(cheapest)
  })

  it('with the same delivery record, the Cheapest line gives the reason the database used: more orders with us', () => {
    const a = inquiry('a', 'Lahore Flow Systems', [line('la', 'a', 100)])
    const b = inquiry('b', 'ABC Traders', [line('lb', 'b', 101)])
    renderPanel(
      [a, b],
      new Map([
        ['lb', rank({ quote_line_id: 'lb', rank: 1, pct_above_best: 1.0, reliability_band: 2, orders_count: 5 })],
        ['la', rank({ quote_line_id: 'la', rank: 2, pct_above_best: 0, reliability_band: 2, orders_count: 1 })],
      ]),
    )
    const cheapest = screen.getByText(/^Cheapest:/).closest('[data-cheapest]') as HTMLElement
    expect(cheapest).toHaveTextContent('Cheapest: Lahore Flow Systems. ABC Traders is only 1.0% dearer and has the same delivery record and more orders with us (5 to 1).')
    expect(cheapest).not.toHaveTextContent('better delivery record')
  })

  it('shows no Cheapest line when the recommended supplier is the cheapest', () => {
    const a = inquiry('a', 'Lahore Flow Systems', [line('la', 'a', 100)])
    const b = inquiry('b', 'ABC Traders', [line('lb', 'b', 120)])
    renderPanel(
      [a, b],
      new Map([
        ['la', rank({ quote_line_id: 'la', rank: 1 })],
        ['lb', rank({ quote_line_id: 'lb', rank: 2, within_band: false, pct_above_best: 20 })],
      ]),
    )
    expect(within(rows()[0]).getByText('Recommended')).toBeInTheDocument()
    expect(screen.queryByText(/^Cheapest:/)).toBeNull()
    expect(screen.queryByText('Cheapest')).toBeNull() // no tag either
  })

  it('without the ranking, the lowest of two comparable prices is the one mark', () => {
    renderPanel([inquiry('a', 'Lahore Flow Systems', [line('la', 'a', 100)]), inquiry('b', 'ABC Traders', [line('lb', 'b', 120)])])
    expect(within(rows()[0]).getByText('Lowest price')).toBeInTheDocument()
    expect(screen.getAllByText('Lowest price')).toHaveLength(1)
  })

  it('each price is one line in PKR at today’s rate; the supplier’s own figure, the rate and the reasons open on request', async () => {
    const user = userEvent.setup()
    renderPanel(
      [inquiry('a', 'Lahore Flow Systems', [line('la', 'a', 100)]), inquiry('b', 'ABC Traders', [line('lb', 'b', 120)])],
      new Map([
        ['la', rank({ quote_line_id: 'la', rank: 1 })],
        ['lb', rank({ quote_line_id: 'lb', rank: 2, within_band: false, pct_above_best: 20 })],
      ]),
    )
    const first = rows()[0]
    expect(first).toHaveTextContent('≈ PKR 28,000')
    expect(first.querySelector('[data-own-price]')).toHaveTextContent('USD 100') // the supplier's own figure, in grey under the PKR
    expect(first).toHaveTextContent('3 weeks')
    expect(first).toHaveTextContent('In stock')
    // closed by default: no own-currency figure, no reasons
    expect(within(first).queryByText(/Quoted USD/)).toBeNull()
    expect(first.querySelector('[data-reasons-for]')).toBeNull()
    await user.click(within(first).getByRole('button', { name: 'Show details for Lahore Flow Systems' }))
    expect(within(first).getByText('Quoted USD 100.00')).toBeInTheDocument()
    expect(within(first).getByText("USD 280.00, today's rate")).toBeInTheDocument()
    expect(within(first).getByText('Dubai, UAE')).toBeInTheDocument()
    expect(first.querySelector('[data-reasons-for="Lahore Flow Systems"]')).not.toBeNull()
  })

  it('has no reply or Can\'t quote buttons on an item: the suppliers still to answer are one "Waiting on" line (grade-B R1)', () => {
    const waiting: InquiryRow = { ...inquiry('w', 'Keller GmbH', []), responseState: 'awaiting', itemsQuoted: 0 }
    const other: InquiryRow = { ...inquiry('x', 'Midlands Valves', []), responseState: 'awaiting', itemsQuoted: 0 }
    renderPanel([inquiry('a', 'Lahore Flow Systems', [line('la', 'a', 100)]), waiting])
    expect(screen.queryByRole('button', { name: /Add reply|Enter reply|Can't quote/ })).toBeNull()
    const art = screen.getByRole('article', { name: 'Item 1' })
    expect(within(art).getByText('Keller GmbH')).toBeInTheDocument() // one supplier: named
    expect(within(art).getByText('1 price so far')).toBeInTheDocument()
    cleanup()
    renderPanel([inquiry('a', 'Lahore Flow Systems', [line('la', 'a', 100)]), waiting, other])
    const two = screen.getByRole('article', { name: 'Item 1' })
    expect(two.querySelectorAll('[data-waiting]')).toHaveLength(1)
    expect(two.querySelector('[data-waiting]')).toHaveTextContent('Waiting on 2 suppliers')
  })

  it('explains the order once, in a tip in the panel header', async () => {
    const user = userEvent.setup()
    renderPanel([inquiry('a', 'Lahore Flow Systems', [line('la', 'a', 100)])])
    // The tip sits beside the heading, not in it: the heading's name is the title alone.
    expect(screen.getByRole('heading', { level: 2, name: 'Items and supplier prices' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'How are prices compared?' }))
    expect(await screen.findByText(/unless other suppliers are within 2% of it\. Among those, the better delivery record wins; if the records are the same, the supplier we have ordered from more often/)).toBeInTheDocument()
  })
})
