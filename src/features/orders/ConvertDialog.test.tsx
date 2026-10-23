import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SessionContext } from '@/app/session'
import type { RfqHeader } from '@/features/rfqs/api'
import { ConvertDialog } from '@/features/orders/ConvertDialog'
import { installFakeDb, type FakeCall, type FakeResult } from '@/test/fakeSupabase'

const RFQ: RfqHeader = {
  id: 'r1',
  number: 12,
  customerRef: null,
  receivedOn: '2026-10-01',
  dueOn: null,
  isPriority: false,
  quotedOn: '2026-10-05',
  closedOn: null,
  closeReason: null,
  closeNote: null,
  notes: null,
  company: { id: 'c1', name: 'Karachi Glassworks', country: 'Pakistan', createdAt: null },
  site: null,
  contactId: null,
  contact: null,
  owner: null,
  state: null,
}

const item = (id: string, position: number, qty = 2) => ({ id, position, description: `Item ${position}`, qty, unit: 'pcs', quoted_unit_price_net: null, gst_rate: 18, quoted_lead_time: null, created_at: 't', brand_id: null, family_id: null })
const rank = (itemId: string, lineId: string, over: Record<string, unknown> = {}) => ({
  rfq_item_id: itemId,
  quote_line_id: lineId,
  supplier_id: 's1',
  item_qty: 2,
  price: 412,
  currency: 'USD',
  pkr_unit_price: 114701,
  fx_state: 'fresh',
  fx_rate_pkr: 278.4,
  fx_rate_on: '2026-10-20',
  fx_age_days: 1,
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
  reliability_band: 2,
  deliveries: 0,
  on_time: 0,
  late: 0,
  median_days_late: null,
  orders_count: 0,
  orders_value_pkr: 0,
  last_order_number: null,
  last_order_on: null,
  last_order_delivered_after_days: null,
  replied: 1,
  asked: 1,
  lead_time: null,
  in_stock: false,
  ...over,
})
const quotation = (revision: number, itemIds: string[]) => ({
  id: `q${revision}`,
  number: 58,
  revision,
  issued_on: '2026-10-05',
  valid_until: '2026-11-05',
  contact_id: null,
  lines: itemIds.map(id => ({ rfq_item_id: id, description: id, qty: 2, unit: 'pcs', unit_price_net: id === 'i1' ? 1500 : 700, gst_rate: 18, lead_time: null })),
  net_total: 0,
  gst_total: 0,
  delivery_text: null,
  payment_terms: null,
  notes: null,
  signatory_id: 'u1',
  pdf_path: null,
})

interface World {
  items?: ReturnType<typeof item>[]
  ranks?: ReturnType<typeof rank>[]
  quotations?: ReturnType<typeof quotation>[]
  flags?: Record<string, string[]>
  /** What convert_rfq_to_order answers (default: the order id). */
  convert?: FakeResult
  /** The order that already won the RFQ, as getOrderBrief reads it. */
  brief?: { number: number; customer_po_number: string | null }
}

function setup(w: World = {}, role = 'sales', onClose = () => {}) {
  const items = w.items ?? [item('i1', 1)]
  const db = installFakeDb((c: FakeCall): FakeResult => {
    switch (c.target) {
      case 'rfq_items':
        return { data: items }
      case 'quotations':
        return { data: w.quotations ?? [] }
      case 'rpc:rank_item_quotes':
        return { data: w.ranks ?? [rank('i1', 'l1')] }
      case 'companies':
        return { data: [{ id: 's1', name: 'Alpenmark' }] }
      case 'supplier_quote_lines':
        return { data: Object.entries(w.flags ?? {}).map(([id, legacy_flags]) => ({ id, legacy_flags })) }
      case 'rpc:convert_rfq_to_order':
        return w.convert ?? { data: 'order-1' }
      case 'orders':
        return { data: w.brief ? [w.brief] : [] }
      case 'company_profile':
        return { data: { id: 1, default_payment_terms_days: 30 } }
      default:
        return { data: [] }
    }
  })
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  render(
    <MemoryRouter>
      <SessionContext.Provider value={{ status: 'signed-in', user: { id: 'u1', name: 'Sana', role } }}>
        <QueryClientProvider client={client}>
          <ConvertDialog rfq={RFQ} onClose={onClose} />
        </QueryClientProvider>
      </SessionContext.Provider>
    </MemoryRouter>,
  )
  return db
}

const payload = (db: ReturnType<typeof setup>) => {
  const call = db.calls.find(c => c.target === 'rpc:convert_rfq_to_order')
  return call ? (call.ops[0][1][0] as { p_items: Array<Record<string, unknown>> }).p_items : null
}

afterEach(() => {
  installFakeDb(() => ({})).uninstall()
  window.sessionStorage.clear()
})

describe('Mark won, the owner shape: marked sent, no quotation, one supplier reply', () => {
  it('ticks the line, leaves the price empty and asks for it instead of sticking', async () => {
    const db = setup()
    const create = await screen.findByRole('button', { name: 'Create order' })
    const price = await screen.findByLabelText('Selling price, line 1')
    await waitFor(() => expect(screen.getByRole('checkbox', { name: 'Include line 1' })).toBeChecked())
    expect(price).toHaveValue('')
    expect(screen.getByText('Type the selling price from your costing sheet')).toBeInTheDocument()
    // no price is invented from the supplier's
    expect(screen.queryByText(/suggested/)).toBeNull()
    expect(create).toBeEnabled()

    fireEvent.click(create)
    expect(await screen.findByText('Type a selling price for line 1.')).toBeInTheDocument()
    expect(payload(db)).toBeNull()
    await waitFor(() => expect(price).toHaveFocus())

    fireEvent.change(price, { target: { value: '120,000' } })
    fireEvent.click(create)
    await waitFor(() => expect(payload(db)).not.toBeNull())
    expect(payload(db)).toEqual([{ rfq_item_id: 'i1', quote_line_id: 'l1', unit_price_net: 120000, expected_qty: 2 }])
  })

  it('a price of 0 is not a price', async () => {
    const db = setup()
    const price = await screen.findByLabelText('Selling price, line 1')
    fireEvent.change(price, { target: { value: '0' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create order' }))
    expect(await screen.findByText('Type a selling price for line 1.')).toBeInTheDocument()
    expect(payload(db)).toBeNull()
  })

  it('nothing ticked: says so', async () => {
    const db = setup()
    const box = await screen.findByRole('checkbox', { name: 'Include line 1' })
    await waitFor(() => expect(box).toBeChecked())
    fireEvent.click(box)
    fireEvent.click(screen.getByRole('button', { name: 'Create order' }))
    expect(await screen.findByText('Tick at least one line to create the order.')).toBeInTheDocument()
    expect(payload(db)).toBeNull()
  })

  it('warns, without blocking, when the typed price is below the supplier cost', async () => {
    const db = setup()
    const price = await screen.findByLabelText('Selling price, line 1')
    fireEvent.change(price, { target: { value: '100,000' } })
    expect(await screen.findByText(/Below the supplier's cost of PKR 114,701/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Create order' }))
    await waitFor(() => expect(payload(db)).not.toBeNull())
  })
})

describe('Mark won with an issued quotation', () => {
  it('prices the line from the latest revision and sends it', async () => {
    const db = setup({ quotations: [quotation(0, ['i1'])] })
    const price = await screen.findByLabelText('Selling price, line 1')
    await waitFor(() => expect(price).toHaveValue('1,500'))
    expect(screen.getAllByText(/from QT-26-0058 R0/).length).toBeGreaterThan(0)
    fireEvent.click(screen.getByRole('button', { name: 'Create order' }))
    await waitFor(() => expect(payload(db)).toEqual([{ rfq_item_id: 'i1', quote_line_id: 'l1', unit_price_net: 1500, expected_qty: 2 }]))
  })

  it('partial revision: the item R1 dropped starts unticked and is not ordered', async () => {
    const db = setup({
      items: [item('i1', 1), item('i2', 2)],
      ranks: [rank('i1', 'l1'), rank('i2', 'l2')],
      quotations: [quotation(1, ['i1']), quotation(0, ['i1', 'i2'])],
    })
    await screen.findByLabelText('Selling price, line 2')
    await waitFor(() => expect(screen.getByRole('checkbox', { name: 'Include line 2' })).not.toBeChecked())
    expect(screen.getByTestId('convert-item-2-not-in')).toHaveTextContent('Not in QT-26-0058 R1')
    // R0's 700 for item 2 is not sent
    fireEvent.click(screen.getByRole('button', { name: 'Create order' }))
    await waitFor(() => expect(payload(db)).toEqual([{ rfq_item_id: 'i1', quote_line_id: 'l1', unit_price_net: 1500, expected_qty: 2 }]))
  })

  it('ticking a dropped item without a price asks for one', async () => {
    const db = setup({ items: [item('i1', 1), item('i2', 2)], ranks: [rank('i1', 'l1'), rank('i2', 'l2')], quotations: [quotation(1, ['i1'])] })
    const box = await screen.findByRole('checkbox', { name: 'Include line 2' })
    fireEvent.click(box)
    fireEvent.click(screen.getByRole('button', { name: 'Create order' }))
    expect(await screen.findByText('Type a selling price for line 2.')).toBeInTheDocument()
    expect(payload(db)).toBeNull()
  })

  it('a changed price is the one sent', async () => {
    const db = setup({ quotations: [quotation(0, ['i1'])] })
    const price = await screen.findByLabelText('Selling price, line 1')
    await waitFor(() => expect(price).toHaveValue('1,500'))
    fireEvent.change(price, { target: { value: '1,650' } })
    expect(screen.getByText('Typed by you', { selector: '[data-source]' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Create order' }))
    await waitFor(() => expect(payload(db)?.[0].unit_price_net).toBe(1650))
  })
})

describe('imported and stale quotes', () => {
  it('warns on an item_guessed quote and on a stale rate, and still lets the price be typed', async () => {
    const db = setup({ ranks: [rank('i1', 'l1', { pkr_unit_price: null, fx_state: 'unusable', comparable: false, rank: null })], flags: { l1: ['item_guessed', 'currency_unverified'] } })
    await screen.findByLabelText('Selling price, line 1')
    await waitFor(() => expect(screen.getAllByTestId('convert-item-1-warning').length).toBeGreaterThanOrEqual(3))
    const text = screen.getAllByTestId('convert-item-1-warning').map(e => e.textContent).join(' ')
    expect(text).toMatch(/may belong to another item/)
    expect(text).toMatch(/No current USD rate: pick the supplier/)
    fireEvent.change(screen.getByLabelText('Selling price, line 1'), { target: { value: '90,000' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create order' }))
    await waitFor(() => expect(payload(db)).not.toBeNull())
  })
})

describe('Mark won, the conversion fixes (0094)', () => {
  const alreadyWon = (other: string): FakeResult => ({ data: null, error: { code: 'P0001', message: 'This RFQ is already order ORD-0038.', hint: `rfq_has_order:${other}` } }) as unknown as FakeResult

  it('HW-47: Not sourced yet is sent as an explicit marker, not left to the database to infer', async () => {
    const db = setup({ ranks: [rank('i1', 'l1'), rank('i1', 'l2', { supplier_id: 's2', rank: 2, price: 450 })] })
    await screen.findByLabelText('Selling price, line 1')
    fireEvent.click(await screen.findByRole('button', { name: /Supplier for line 1/ }))
    fireEvent.click(await screen.findByRole('option', { name: /^Not sourced yet/ }))
    fireEvent.change(screen.getByLabelText('Selling price, line 1'), { target: { value: '90,000' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create order' }))
    await waitFor(() => expect(payload(db)).not.toBeNull())
    expect(payload(db)).toEqual([{ rfq_item_id: 'i1', not_sourced: true, unit_price_net: 90000, expected_qty: 2 }])
  })

  it('HW-49: a commissioning line nobody quoted starts as Service, no supplier', async () => {
    const db = setup({ items: [{ ...item('i1', 1), description: 'Commissioning and loop check' }], ranks: [] })
    await screen.findByLabelText('Selling price, line 1')
    expect(await screen.findByRole('button', { name: /Supplier for line 1/ })).toHaveTextContent('Service, no supplier')
    fireEvent.change(screen.getByLabelText('Selling price, line 1'), { target: { value: '85,000' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create order' }))
    await waitFor(() => expect(payload(db)).not.toBeNull())
    expect(payload(db)).toEqual([{ rfq_item_id: 'i1', is_service: true, unit_price_net: 85000, expected_qty: 2 }])
  })

  it('HW-50: an imported quote shows its warning in the supplier picker and beside the price, as the default too', async () => {
    setup({ flags: { l1: ['currency_unverified', 'item_guessed'] } })
    const picker = await screen.findByRole('button', { name: /Supplier for line 1/ })
    await waitFor(() => expect(picker).toHaveTextContent('Imported quote: the currency was not confirmed and it may belong to another item. Check it.'))
    fireEvent.click(picker)
    expect((await screen.findAllByTestId('imported-quote-note')).length).toBeGreaterThan(0)
  })

  it('HW-60: a refused stale order says so, reloads the lines and sent the revision and quantity the dialog showed', async () => {
    const db = setup({
      quotations: [quotation(0, ['i1'])],
      convert: { data: null, error: { code: 'P0001', message: 'The quotation changed since you opened this. Review again.', hint: 'convert_stale' } } as unknown as FakeResult,
    })
    await screen.findByLabelText('Selling price, line 1')
    await waitFor(() => expect(screen.getByLabelText('Selling price, line 1')).toHaveValue('1,500'))
    fireEvent.click(screen.getByRole('button', { name: 'Create order' }))
    expect(await screen.findByText(/The quotation changed since you opened this\. Review again\./)).toBeInTheDocument()
    const args = db.calls.find(c => c.target === 'rpc:convert_rfq_to_order')?.ops[0][1][0] as Record<string, unknown>
    expect(args.p_expected_revision).toBe(0)
    expect((args.p_items as Array<Record<string, unknown>>)[0].expected_qty).toBe(2)
    expect(screen.getByRole('button', { name: 'Create order' })).toBeEnabled()
  })

  it('HW-56: an RFQ won in another tab says Already converted, keeps the typed PO, and offers to add it', async () => {
    const db = setup({ brief: { number: 38, customer_po_number: null }, convert: alreadyWon('0b6c1f2e-1111-4222-8333-444455556666') })
    fireEvent.change(await screen.findByLabelText(/^Customer PO number/), { target: { value: 'PO-777' } })
    fireEvent.change(screen.getByLabelText('Selling price, line 1'), { target: { value: '90,000' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create order' }))
    expect(await screen.findByText('Already converted to ORD-0038')).toBeInTheDocument()
    const add = await screen.findByRole('button', { name: 'Add PO PO-777 to ORD-0038' })
    expect(screen.getByRole('button', { name: 'Open ORD-0038' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Create order' })).toBeDisabled()
    fireEvent.click(add)
    await waitFor(() => expect(db.calls.some(c => c.target === 'orders' && JSON.stringify(c.ops).includes('PO-777'))).toBe(true))
  })

  it('HW-56: when that order has a different PO, it is shown and the typed one is not offered', async () => {
    setup({ brief: { number: 38, customer_po_number: 'TAB-ONE' }, convert: alreadyWon('0b6c1f2e-1111-4222-8333-444455556666') })
    fireEvent.change(await screen.findByLabelText(/^Customer PO number/), { target: { value: 'TAB-TWO' } })
    fireEvent.change(screen.getByLabelText('Selling price, line 1'), { target: { value: '90,000' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create order' }))
    expect(await screen.findByText(/already has the customer PO TAB-ONE/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Add PO/ })).toBeNull()
  })
})

describe('roles', () => {
  it('an engineer who reaches ?won=1 sees nothing and the dialog closes', async () => {
    const onClose = vi.fn()
    const db = setup({}, 'engineer', onClose)
    await waitFor(() => expect(onClose).toHaveBeenCalled())
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(db.calls).toHaveLength(0)
  })
})
