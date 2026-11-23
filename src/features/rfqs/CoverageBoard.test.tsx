import { useState } from 'react'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { SessionContext } from '@/app/session'
import type { InquiryRow, QuoteLineRow, RfqItemRow } from '@/features/rfqs/api'
import { CoverageBoard, GapBar } from '@/features/rfqs/CoverageBoard'
import type { BoardFilter } from '@/features/rfqs/lib/coverage'

/*
 * The coverage board (owner's lean cut of supplier-replies-mockup.html): one status icon per supplier and item, the No price and
 * Quoting later filters, a side panel with every answer A to Z, the price there only for admin and sales, and no board at all for a
 * small RFQ.
 */

const item = (n: number, brandName: string): RfqItemRow => ({ id: `it${n}`, number: n, description: `Part ${n}`, brandId: null, brandName, familyId: null, qty: 1, unit: 'nos' })
const items = [item(1, 'Siemens'), item(2, 'Siemens'), item(3, 'Siemens'), item(4, 'WIKA'), item(5, 'WIKA')]

const line = (inquiryId: string, itemId: string, unitPrice: number, currency = 'USD'): QuoteLineRow => ({
  id: `${inquiryId}-${itemId}`,
  inquiryId,
  itemId,
  unitPrice,
  currency,
  leadTime: '2 weeks',
  inStock: true,
  fxRatePkr: null,
  fxRateOn: null,
})

function inq(id: string, name: string, country: string | null, over: Partial<InquiryRow> = {}): InquiryRow {
  return {
    id,
    supplierId: `s-${id}`,
    supplierName: name,
    supplierCountry: country,
    sentOn: '2026-11-17',
    lastChasedOn: null,
    lastRelayedAt: null,
    noOfferOn: null,
    noOfferReason: null,
    itemDeclines: {},
    itemWaits: {},
    askedItemIds: null,
    chaseCount: 0,
    notes: null,
    contactName: null,
    contactPhone: null,
    lastCurrency: null,
    responseState: 'awaiting',
    contactState: null,
    itemsQuoted: 0,
    lines: [],
    ...over,
  }
}

const inquiries = [
  inq('a', 'Achievers Automation', 'China', { responseState: 'quoted', lines: [line('a', 'it1', 120), line('a', 'it2', 80)], itemWaits: { it4: true } }),
  inq('b', 'Karachi Controls', 'Pakistan'),
  inq('c', 'Bilal Electric', 'Pakistan', { askedItemIds: ['it1'], responseState: 'quoted', lines: [line('c', 'it1', 30000, 'PKR')] }),
]

function Board({ list = items, inq: inquiryList = inquiries }: { list?: RfqItemRow[]; inq?: InquiryRow[] }) {
  const [filter, setFilter] = useState<BoardFilter>('all')
  return <CoverageBoard items={list} inquiries={inquiryList} filter={filter} onFilter={setFilter} />
}

function renderAs(role: string, ui = <Board />) {
  return render(<SessionContext.Provider value={{ status: 'signed-in', user: { id: 'u1', name: 'Ayesha', role } }}>{ui}</SessionContext.Provider>)
}

describe('CoverageBoard', () => {
  it('draws one cell per supplier and item, with the not asked cell, brand groups and the prices column', () => {
    renderAs('sales')
    const table = screen.getByRole('table', { name: 'Items by supplier' })
    expect(within(table).getByRole('button', { name: 'Achievers Automation, item 1: priced' })).toBeInTheDocument()
    expect(within(table).getByRole('button', { name: 'Achievers Automation, item 4: quoting later' })).toBeInTheDocument()
    expect(within(table).getByRole('button', { name: 'Achievers Automation, item 3: replied, left this item out' })).toBeInTheDocument()
    expect(within(table).getByRole('button', { name: 'Karachi Controls, item 1: no reply yet' })).toBeInTheDocument()
    expect(within(table).getByRole('button', { name: 'Bilal Electric, item 2: not asked' })).toBeInTheDocument()
    expect(table.querySelectorAll('[data-cell="not-asked"]')).toHaveLength(4)
    expect(screen.getByText('Siemens · 3 items')).toBeInTheDocument()
    expect(screen.getByText('WIKA · 2 items')).toBeInTheDocument()
    const row1 = table.querySelector('[data-board-item="it1"] [data-prices]') as HTMLElement
    expect(row1).toHaveTextContent('2 prices')
    const row4 = table.querySelector('[data-board-item="it4"] [data-prices]') as HTMLElement
    expect(row4).toHaveTextContent('No price')
    expect(row4).toHaveTextContent('1 later · 1 no reply')
    // never a cheapest or lowest mark
    expect(document.body.textContent).not.toMatch(/cheap|lowest|best/i)
  })

  it('filters to No price and Quoting later, and searches', async () => {
    const user = userEvent.setup()
    renderAs('sales')
    await user.click(screen.getByRole('radio', { name: 'No price · 3' }))
    const rows = () => [...document.querySelectorAll('[data-board-item]')].map(r => r.getAttribute('data-board-item'))
    expect(rows()).toEqual(['it3', 'it4', 'it5'])
    await user.click(screen.getByRole('radio', { name: 'Quoting later · 1' }))
    expect(rows()).toEqual(['it4'])
    await user.click(screen.getByRole('radio', { name: 'All · 5' }))
    await user.type(screen.getByRole('searchbox', { name: 'Search item, brand, part' }), 'wika')
    expect(rows()).toEqual(['it4', 'it5'])
  })

  it('a cell opens every answer A to Z, with the price for sales', async () => {
    const user = userEvent.setup()
    renderAs('sales')
    await user.click(screen.getByRole('button', { name: 'Karachi Controls, item 1: no reply yet' }))
    const dialog = await screen.findByRole('dialog')
    const names = [...dialog.querySelectorAll('[data-answer] b')].map(b => b.textContent)
    expect(names).toEqual(['Achievers Automation', 'Bilal Electric', 'Karachi Controls'])
    expect(within(dialog).getByText('Prices are not ranked.', { exact: false })).toBeInTheDocument()
    const prices = [...dialog.querySelectorAll('[data-answer-price]')].map(p => p.textContent)
    expect(prices).toEqual(['USD 120.00', 'PKR 30,000'])
    expect(dialog.textContent).not.toMatch(/\bRs\b/)
  })

  it('an engineer sees the answers but never a price', async () => {
    const user = userEvent.setup()
    renderAs('engineer')
    await user.click(screen.getByRole('button', { name: 'Achievers Automation, item 1: priced' }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getAllByText(/Priced/).length).toBeGreaterThan(0)
    expect(dialog.querySelectorAll('[data-answer-price]')).toHaveLength(0)
    expect(dialog.textContent).not.toMatch(/USD|PKR|120|30,000/)
  })

  it('is not drawn under 5 items and 3 suppliers asked', () => {
    const { container } = renderAs('sales', <Board list={items.slice(0, 4)} inq={inquiries.slice(0, 2)} />)
    expect(container.querySelector('[data-slot="coverage-board"]')).toBeNull()
  })
})

describe('GapBar', () => {
  it('names the items with no price and asks for exactly those', async () => {
    const user = userEvent.setup()
    const onAsk = vi.fn()
    const onShow = vi.fn()
    renderAs('engineer', <GapBar items={items} inquiries={inquiries} onShow={onShow} onAsk={onAsk} />)
    const bar = screen.getByRole('status')
    expect(bar).toHaveTextContent('3 items have no price yet: item 3 (Siemens), item 4 (WIKA), item 5 (WIKA). 3 of them still have a supplier to answer.')
    await user.click(screen.getByRole('button', { name: 'Show them' }))
    expect(onShow).toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'Ask another supplier for these 3' }))
    expect(onAsk).toHaveBeenCalledWith(['it3', 'it4', 'it5'])
  })

  it('says nothing when every item has a price', () => {
    const all = [inq('a', 'A', null, { responseState: 'quoted', lines: items.map(it => line('a', it.id, 1)) })]
    const { container } = renderAs('sales', <GapBar items={items} inquiries={all} onShow={() => undefined} onAsk={() => undefined} />)
    expect(container).toBeEmptyDOMElement()
  })
})
