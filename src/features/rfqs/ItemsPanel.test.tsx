import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it } from 'vitest'
import { SessionContext } from '@/app/session'
import type { InquiryRow, QuoteLineRow, RfqHeader, RfqItemRow } from '@/features/rfqs/api'
import { ItemsPanel } from '@/features/rfqs/ItemsPanel'
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

/** A phone's media queries (useMediaQuery reads '(max-width: 767px)'); returns the undo. */
function asPhone(): () => void {
  const orig = window.matchMedia
  window.matchMedia = ((q: string) => ({
    matches: q === '(max-width: 767px)',
    media: q,
    onchange: null,
    addEventListener() {},
    removeEventListener() {},
    addListener() {},
    removeListener() {},
    dispatchEvent: () => false,
  })) as typeof window.matchMedia
  return () => {
    window.matchMedia = orig
  }
}

function renderPanel(inquiries: InquiryRow[], items: RfqItemRow[] = [item], role = 'sales') {
  installFakeDb(() => ({ data: [] }))
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <SessionContext.Provider value={{ status: 'signed-in', user: { id: 'u1', name: 'Ayesha Rana', role } }}>
        <MemoryRouter>
          <ToastProvider>
            <ItemsPanel
              rfq={rfq}
              items={items}
              inquiries={inquiries}
              rates={{ USD: { rate: 280, ageDays: 0, staleness: 'fresh' } }}
              fxRows={[]}
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
  it('singles out no supplier: no Recommended, Lowest price or Cheapest mark, whatever the prices, and no reasons', () => {
    renderPanel([inquiry('a', 'Lahore Flow Systems', [line('la', 'a', 100)]), inquiry('b', 'ABC Traders', [line('lb', 'b', 101)]), inquiry('c', 'Zed Co', [line('lc', 'c', 60)])])
    const art = screen.getByRole('article', { name: 'Item 1' })
    expect(art).not.toHaveTextContent(/Recommended|Lowest price|Cheapest|Best price/i)
    expect(art.querySelector('[data-lowest], [data-recommended], [data-ranked], [data-cheapest], [data-cheapest-tag], [data-reasons-for]')).toBeNull()
  })

  it('lists the suppliers by name, not by price', () => {
    renderPanel([inquiry('a', 'Lahore Flow Systems', [line('la', 'a', 100)]), inquiry('b', 'ABC Traders', [line('lb', 'b', 120)]), inquiry('c', 'Zed Co', [line('lc', 'c', 60)])])
    expect(rows().map(r => /ABC Traders|Lahore Flow Systems|Zed Co/.exec(r.textContent ?? '')?.[0])).toEqual(['ABC Traders', 'Lahore Flow Systems', 'Zed Co'])
  })

  it('each price is one line in PKR at today’s rate; the supplier’s own figure and the rate open on request', async () => {
    const user = userEvent.setup()
    renderPanel(
      [inquiry('a', 'Lahore Flow Systems', [line('la', 'a', 100)]), inquiry('b', 'ABC Traders', [line('lb', 'b', 120)])],
    )
    const first = rows()[1] // listed by name: ABC Traders first, then Lahore Flow Systems
    expect(first).toHaveTextContent('≈ PKR 28,000')
    expect(first.querySelector('[data-own-price]')).toHaveTextContent('USD 100') // the supplier's own figure, in grey under the PKR
    expect(first).toHaveTextContent('3 weeks')
    expect(first).toHaveTextContent('In stock')
    // closed by default: no own-currency figure
    expect(within(first).queryByText(/Quoted USD/)).toBeNull()
    await user.click(within(first).getByRole('button', { name: 'Show details for Lahore Flow Systems' }))
    expect(within(first).getByText('Quoted USD 100.00')).toBeInTheDocument()
    expect(within(first).getByText("USD 280.00, today's rate")).toBeInTheDocument()
    expect(within(first).getByText('Dubai, UAE')).toBeInTheDocument()
    expect(first.querySelector('[data-reasons-for]')).toBeNull()
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

  it('a price line shows one control, its chevron; the "..." menu waits until the line is open (grade-A 9)', async () => {
    const user = userEvent.setup()
    renderPanel([inquiry('a', 'Lahore Flow Systems', [line('la', 'a', 100)])])
    const first = rows()[0]
    expect(within(first).queryByRole('button', { name: 'More for Lahore Flow Systems' })).toBeNull()
    await user.click(within(first).getByRole('button', { name: 'Show details for Lahore Flow Systems' }))
    await user.click(within(first).getByRole('button', { name: 'More for Lahore Flow Systems' }))
    expect(await screen.findByRole('menuitem', { name: 'Edit reply' })).toBeInTheDocument()
  })

  it('phone: the items are an accordion, the first priced item open, one at a time; an item only waiting is its header', async () => {
    const undo = asPhone()
    try {
      const user = userEvent.setup()
      const second: RfqItemRow = { ...item, id: 'it-2', number: 2, description: 'Promag 10W flow meter' }
      const third: RfqItemRow = { ...item, id: 'it-3', number: 3, description: 'VEGAPULS 21 radar' }
      const waiting: InquiryRow = { ...inquiry('w', 'Keller GmbH', []), responseState: 'awaiting', itemsQuoted: 0 }
      renderPanel(
        [inquiry('a', 'Lahore Flow Systems', [line('la', 'a', 100), { ...line('lb', 'a', 50), itemId: 'it-2' }]), waiting],
        [item, second, third],
      )
      const one = screen.getByRole('article', { name: 'Item 1' })
      const two = screen.getByRole('article', { name: 'Item 2' })
      const three = screen.getByRole('article', { name: 'Item 3' })
      expect(within(one).getByRole('button', { name: item.description })).toHaveAttribute('aria-expanded', 'true')
      expect(within(one).getAllByRole('button', { name: /^Show details for/ })).toHaveLength(1)
      expect(within(two).getByRole('button', { name: second.description })).toHaveAttribute('aria-expanded', 'false')
      expect(within(two).queryByRole('button', { name: /^Show details for/ })).toBeNull()
      // Nobody who replied quoted item 3: it folds too, its warning inside.
      expect(within(three).getByRole('button', { name: third.description })).toHaveAttribute('aria-expanded', 'false')
      await user.click(within(two).getByRole('button', { name: second.description }))
      expect(within(two).getAllByRole('button', { name: /^Show details for/ })).toHaveLength(1)
      expect(within(one).queryByRole('button', { name: /^Show details for/ })).toBeNull()
      await user.click(within(two).getByRole('button', { name: second.description }))
      expect(within(two).queryByRole('button', { name: /^Show details for/ })).toBeNull()
    } finally {
      undo()
    }
  })

  it('phone, waiting for prices: an item is its header and chip, with no toggle and no "Waiting on" line', () => {
    const undo = asPhone()
    try {
      renderPanel([{ ...inquiry('w', 'Keller GmbH', []), responseState: 'awaiting', itemsQuoted: 0 }])
      const one = screen.getByRole('article', { name: 'Item 1' })
      expect(within(one).queryByRole('button', { name: /^(?!More for item|Category of item)/ })).toBeNull()
      expect(one.querySelector('[data-waiting]')).toBeNull()
    } finally {
      undo()
    }
  })

  it('an engineer sees who quoted, lead time and stock, and no price, rate, mark, detail or row menu (owner decision 2026-10-22)', () => {
    // The engineer's lines come without a price (listInquiries reads none): unitPrice 0 and no rate.
    const bare = (id: string, inquiryId: string): QuoteLineRow => ({ ...line(id, inquiryId, 0), fxRatePkr: null, fxRateOn: null })
    renderPanel(
      [inquiry('b', 'Lahore Flow Systems', [bare('lb', 'b')]), inquiry('a', 'ABC Traders', [bare('la', 'a')])],
      [item],
      'engineer',
    )
    expect(screen.getByRole('heading', { level: 2, name: 'Items and supplier replies' })).toBeInTheDocument()
    const art = screen.getByRole('article', { name: 'Item 1' })
    expect(art).toHaveTextContent('ABC Traders')
    expect(art).toHaveTextContent('3 weeks')
    expect(art).toHaveTextContent('In stock')
    // listed by name, not by price
    const names = [...art.querySelectorAll('li')].map(li => li.textContent ?? '').filter(t => /Traders|Systems/.test(t))
    expect(names[0]).toMatch(/^ABC Traders/)
    expect(document.body.textContent).not.toMatch(/PKR|USD\s*\d|Rs\.?\s*\d/)
    expect(screen.queryByText('Recommended')).toBeNull()
    expect(screen.queryByText('Lowest price')).toBeNull()
    expect(screen.queryByText(/Cheapest/)).toBeNull()
    expect(document.querySelector('[data-own-price], [data-cheapest-tag], [data-cheapest], [data-price-detail]')).toBeNull()
    expect(screen.queryByRole('button', { name: /Show details for/ })).toBeNull()
    expect(screen.queryByRole('button', { name: /More for (?!item)/ })).toBeNull()
    expect(screen.queryByRole('button', { name: 'How are prices shown?' })).toBeNull()
  })

  it('explains the figures once, in a tip in the panel header, and says nothing about a better supplier', async () => {
    const user = userEvent.setup()
    renderPanel([inquiry('a', 'Lahore Flow Systems', [line('la', 'a', 100)])])
    // The tip sits beside the heading, not in it: the heading's name is the title alone.
    expect(screen.getByRole('heading', { level: 2, name: 'Items and supplier prices' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'How are prices shown?' }))
    expect(await screen.findByText(/Suppliers are listed by name/)).toBeInTheDocument()
    expect(screen.queryByText(/cheapest|recommended|best/i)).toBeNull()
  })
})
