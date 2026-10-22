import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it } from 'vitest'
import { SessionContext } from '@/app/session'
import type { InquiryRow, RfqHeader, RfqItemRow } from '@/features/rfqs/api'
import { SuppliersAsked } from '@/features/rfqs/SuppliersAsked'
import { installFakeDb, type FakeCall } from '@/test/fakeSupabase'
import { ToastProvider } from '@/ui/Toast'

/*
 * "Chased twice, no reply" (g2-chase-texts): the next suppliers in line for the items. Never the customer the RFQ is for (a
 * company can be both), and an item known only by its family still finds the suppliers on that family's shortlist.
 */

afterEach(() => {
  installFakeDb(() => ({})).uninstall()
})

const rfq: RfqHeader = {
  id: 'r-1',
  number: 185,
  customerRef: null,
  receivedOn: '2026-10-01',
  dueOn: null,
  isPriority: false,
  quotedOn: null,
  closedOn: null,
  closeReason: null,
  closeNote: null,
  notes: null,
  company: { id: 'c-customer', name: 'Acme Plastics', country: 'Pakistan', createdAt: null },
  site: null,
  contactId: null,
  contact: null,
  owner: null,
  state: null,
}

const inquiry: InquiryRow = {
  id: 'i-1',
  supplierId: 's-silent',
  supplierName: 'Silent Traders',
  supplierCountry: 'Pakistan',
  sentOn: '2026-10-01',
  lastChasedOn: '2026-10-05',
  lastRelayedAt: null,
  noOfferOn: null,
  noOfferReason: null,
  itemDeclines: {},
  chaseCount: 2,
  notes: null,
  contactName: null,
  contactPhone: null,
  lastCurrency: null,
  responseState: 'awaiting',
  contactState: null,
  itemsQuoted: 0,
  lines: [],
}

function stats(id: string, brandIds: string[]) {
  return { supplier_id: id, asked: 3, replied: 3, no_offer: 0, median_reply_days: 1, last_contact: '2026-09-01', reply_days_n: 3, brand_ids: brandIds, brand_names: brandIds.map(() => 'x') }
}

function renderWith(items: RfqItemRow[], inq: InquiryRow = inquiry, onCall: (call: FakeCall) => void = () => undefined, role = 'sales') {
  installFakeDb((call: FakeCall) => {
    onCall(call)
    if (call.target === 'rpc:stamp_supplier_chase') return { data: inq.chaseCount + 1 }
    if (call.target === 'v_supplier_stats') return { data: [stats('c-customer', ['b-hach', 'f-meters']), stats('s-orient', ['b-hach']), stats('s-family', ['f-meters'])] }
    if (call.target === 'companies')
      return {
        data: [
          { id: 'c-customer', name: 'Acme Plastics', country: 'Pakistan', city: 'Lahore' },
          { id: 's-orient', name: 'Orient Analytical', country: 'Pakistan', city: 'Karachi' },
          { id: 's-family', name: 'Meter House', country: 'Pakistan', city: 'Karachi' },
        ],
      }
    return { data: [] }
  })
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <SessionContext.Provider value={{ status: 'signed-in', user: { id: 'u1', name: 'Ayesha Rana', role } }}>
        <MemoryRouter>
          <ToastProvider>
            <SuppliersAsked rfq={rfq} items={items} inquiries={[inq]} stats={undefined} onFloat={() => undefined} />
          </ToastProvider>
        </MemoryRouter>
      </SessionContext.Provider>
    </QueryClientProvider>,
  )
}

describe('SuppliersAsked escalation', () => {
  it('never offers the customer the RFQ is for as the next supplier in line', async () => {
    renderWith([{ id: 'it-1', number: 1, description: 'Hach HQ1110 meter', brandId: 'b-hach', brandName: 'Hach', familyId: null, qty: 1, unit: 'pcs' }])
    const next = await screen.findByRole('list', { name: 'Next in line' })
    expect(within(next).getByText(/Orient Analytical/)).toBeInTheDocument()
    expect(within(next).queryByText(/Acme Plastics/)).toBeNull()
  })

  it('finds the suppliers on the family shortlist for an item known only by its family', async () => {
    renderWith([{ id: 'it-1', number: 1, description: 'Portable pH meter', brandId: null, brandName: null, familyId: 'f-meters', familyName: 'Meters', qty: 1, unit: 'pcs' }])
    const next = await screen.findByRole('list', { name: 'Next in line' })
    expect(within(next).getByText(/Meter House/)).toBeInTheDocument()
  })
})

describe('SuppliersAsked reply, by role (owner decision 2026-10-22: engineers see and write no prices)', () => {
  const items: RfqItemRow[] = [{ id: 'it-1', number: 1, description: 'Hach HQ1110 meter', brandId: 'b-hach', brandName: 'Hach', familyId: null, qty: 1, unit: 'pcs' }]

  it('sales: Enter reply opens the price form', async () => {
    const user = userEvent.setup()
    renderWith(items)
    await user.click(screen.getByRole('button', { name: /^Enter reply, / }))
    expect(await screen.findByRole('textbox', { name: /^Price for item 1 from / })).toBeInTheDocument()
  })

  it('an engineer has no Enter or Edit reply, and no price form opens even when asked for from elsewhere', async () => {
    renderWith(items, inquiry, () => undefined, 'engineer')
    expect(screen.queryByRole('button', { name: /^(Enter|Edit) reply, / })).toBeNull()
    window.dispatchEvent(new CustomEvent('qtech:open-reply', { detail: { inquiryId: inquiry.id, itemId: 'it-1' } }))
    await new Promise(r => setTimeout(r, 0))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.queryByRole('textbox', { name: /^Price for item/ })).toBeNull()
  })
})

describe('SuppliersAsked chase', () => {
  it('a double tap on Chase records one chase, not two', async () => {
    const stamps: FakeCall[] = []
    const user = userEvent.setup()
    let release: () => void = () => undefined
    const held = new Promise<void>(r => (release = r))
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: () => held } })
    renderWith(
      [{ id: 'it-1', number: 1, description: 'Hach HQ1110 meter', brandId: 'b-hach', brandName: 'Hach', familyId: null, qty: 1, unit: 'pcs' }],
      { ...inquiry, chaseCount: 0, lastChasedOn: null },
      call => {
        if (call.target === 'rpc:stamp_supplier_chase') stamps.push(call)
      },
    )
    // The supplier to chase shows the preview and one "Copy and mark chased" (no second Chase button beside it).
    expect(screen.queryByRole('button', { name: 'Chase Silent Traders' })).toBeNull()
    const chase = screen.getByRole('button', { name: 'Copy and mark chased' })
    await user.dblClick(chase)
    release()
    await waitFor(() => expect(screen.getAllByText('Chase text copied').length).toBeGreaterThan(0))
    expect(stamps).toHaveLength(1)
  })

  it('shows a short preview; the whole message, with its items and reply-by date, opens on request; Email is one link away', async () => {
    const user = userEvent.setup()
    localStorage.removeItem('qtech.channel.u1')
    renderWith([{ id: 'it-1', number: 1, description: 'Hach HQ1110 meter', brandId: 'b-hach', brandName: 'Hach', familyId: null, qty: 1, unit: 'pcs' }], { ...inquiry, chaseCount: 0, lastChasedOn: null })
    const card = screen.getByRole('group', { name: 'Chase Silent Traders' })
    expect(within(card).getByTestId('chase-text')).toHaveClass('line-clamp-3')
    expect(within(card).queryByRole('group', { name: 'Items still without a price from this supplier' })).toBeNull()
    await user.click(within(card).getByRole('button', { name: 'Show the whole message' }))
    expect(within(card).getByRole('group', { name: 'Items still without a price from this supplier' })).toBeInTheDocument()
    expect(within(card).getByTestId('chase-text')).not.toHaveClass('line-clamp-3')
    expect(within(card).getByTestId('chase-text')).not.toHaveTextContent('Subject')
    await user.click(within(card).getByRole('button', { name: 'Email instead' }))
    expect(within(card).getByRole('button', { name: 'WhatsApp instead' })).toBeInTheDocument()
    expect(within(card).getByRole('button', { name: 'Copy subject' })).toBeInTheDocument() // an email has its subject row
    expect(localStorage.getItem('qtech.channel.u1')).toBe('email') // remembered for the next message
    localStorage.removeItem('qtech.channel.u1')
  })
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

describe('SuppliersAsked: each supplier once, with its reply (grade-B R2, R3, R4)', () => {
  const meter: RfqItemRow[] = [{ id: 'it-1', number: 1, description: 'Hach HQ1110 meter', brandId: 'b-hach', brandName: 'Hach', familyId: null, qty: 1, unit: 'pcs' }]
  function renderMode(chase: 'card' | 'button' | 'none', inq: InquiryRow | InquiryRow[] = { ...inquiry, chaseCount: 0, lastChasedOn: null }, jump = false) {
    installFakeDb(() => ({ data: [] }))
    const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
    render(
      <QueryClientProvider client={client}>
        <SessionContext.Provider value={{ status: 'signed-in', user: { id: 'u1', name: 'Ayesha Rana', role: 'sales' } }}>
          <MemoryRouter>
            <ToastProvider>
              <SuppliersAsked rfq={rfq} items={meter} inquiries={Array.isArray(inq) ? inq : [inq]} stats={undefined} chase={chase} jump={jump} onFloat={() => undefined} />
            </ToastProvider>
          </MemoryRouter>
        </SessionContext.Provider>
      </QueryClientProvider>,
    )
  }

  it('Enter reply opens the price form for that supplier only when tapped', async () => {
    const user = userEvent.setup()
    renderMode('card')
    expect(screen.queryByRole('textbox', { name: 'Price for item 1 from Silent Traders' })).toBeNull()
    await user.click(screen.getByRole('button', { name: 'Enter reply, Silent Traders' }))
    const dialog = await screen.findByRole('dialog', { name: 'Silent Traders' })
    expect(within(dialog).getByRole('textbox', { name: 'Price for item 1 from Silent Traders' })).toBeInTheDocument()
  })

  it('prices in: a 1-tap Chase, and the card only on Show message', async () => {
    const user = userEvent.setup()
    renderMode('button')
    expect(screen.getByRole('button', { name: 'Chase Silent Traders' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Copy and mark chased' })).toBeNull()
    await user.click(screen.getByRole('button', { name: 'Show message, Silent Traders' }))
    expect(screen.getByRole('button', { name: 'Copy and mark chased' })).toBeInTheDocument()
  })

  it('quotation sent: no chase at all', () => {
    renderMode('none')
    expect(screen.queryByRole('button', { name: 'Chase Silent Traders' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Copy and mark chased' })).toBeNull()
  })

  const second: InquiryRow = { ...inquiry, id: 'i-2', supplierId: 's-second', supplierName: 'Second Source', chaseCount: 0, lastChasedOn: null }
  const priced: InquiryRow = {
    ...inquiry,
    id: 'i-3',
    supplierId: 's-priced',
    supplierName: 'Priced Ltd',
    chaseCount: 0,
    lastChasedOn: null,
    responseState: 'quoted',
    itemsQuoted: 1,
    lines: [{ id: 'l-1', inquiryId: 'i-3', itemId: 'it-1', unitPrice: 100, currency: 'PKR', leadTime: null, inStock: null, fxRatePkr: null, fxRateOn: null }],
  }

  it('waiting for prices: the others get Enter reply and Chase only; the card picker "Message for" switches it (grade-A 9)', async () => {
    const user = userEvent.setup()
    renderMode('card', [{ ...inquiry, chaseCount: 0, lastChasedOn: null }, second])
    expect(screen.queryByRole('button', { name: /^Show message/ })).toBeNull()
    expect(screen.getByRole('button', { name: 'Chase Second Source' })).toBeInTheDocument()
    // The other channel waits with the whole message.
    expect(screen.queryByRole('button', { name: 'Email instead' })).toBeNull()
    await user.selectOptions(screen.getByRole('combobox', { name: /^Message for/ }), 'i-2')
    expect(screen.getByRole('group', { name: 'Chase Second Source' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Chase Silent Traders' })).toBeInTheDocument()
  })

  it('phone: an answered supplier is one line until tapped; the page opens at the first supplier without a reply', async () => {
    const undo = asPhone()
    const seen: string[] = []
    const scroll = Element.prototype.scrollIntoView
    Element.prototype.scrollIntoView = function (this: Element) {
      seen.push(this.getAttribute('data-reply-row') ?? '')
    }
    try {
      const user = userEvent.setup()
      renderMode('button', [priced, { ...inquiry, chaseCount: 0, lastChasedOn: null }], true)
      const toggle = screen.getByRole('button', { name: /Priced Ltd/ })
      expect(toggle).toHaveAttribute('aria-expanded', 'false')
      expect(screen.queryByRole('button', { name: 'Edit reply, Priced Ltd' })).toBeNull()
      await user.click(toggle)
      expect(toggle).toHaveAttribute('aria-expanded', 'true')
      expect(screen.getByRole('button', { name: 'Edit reply, Priced Ltd' })).toBeInTheDocument()
      // Still waiting: in full, and where the page opened.
      expect(screen.getByRole('button', { name: 'Enter reply, Silent Traders' })).toBeInTheDocument()
      expect(seen).toEqual(['s-silent'])
    } finally {
      Element.prototype.scrollIntoView = scroll
      undo()
    }
  })

  it("a supplier who can't quote shows Take back instead of Enter reply", () => {
    renderMode('card', { ...inquiry, noOfferOn: '2026-10-03', noOfferReason: 'other' })
    expect(screen.getByRole('button', { name: "Take back can't quote, Silent Traders" })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Enter reply/ })).toBeNull()
  })
})
