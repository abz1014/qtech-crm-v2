import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it } from 'vitest'
import { SessionProvider } from '@/app/SessionProvider'
import { ReviewImportedPage } from '@/features/money/review/ReviewImportedPage'
import { countProposals, reviewProgress, sortReview, visibleProposals } from '@/features/money/review/model'
import { installFakeDb, opArgs, type FakeCall } from '@/test/fakeSupabase'
import { ToastProvider } from '@/ui/Toast'

describe('review model', () => {
  it('progress counts what is kept open and what was settled here, out of what still needs a decision', () => {
    const items = [{ state: 'to_review' }, { state: 'to_review' }, { state: 'live' }] as const
    expect(reviewProgress(items, 2)).toEqual({ decided: 3, total: 5, left: 2 })
    expect(reviewProgress([], 0)).toEqual({ decided: 0, total: 0, left: 0 })
  })
  it('lists the ones to decide first, the biggest first', () => {
    const list = [
      { state: 'live', amount: 900, title: 'A' },
      { state: 'to_review', amount: 10, title: 'B' },
      { state: 'to_review', amount: 500, title: 'C' },
    ] as const
    expect(sortReview(list).map(x => x.title)).toEqual(['C', 'B', 'A'])
  })
  it('"Not this" hides a proposal; certain and likely are counted', () => {
    const p = (i: string, o: string, confidence: 'certain' | 'likely') => ({ invoiceId: i, orderId: o, confidence, reasons: [] })
    const list = [p('i1', 'o1', 'certain'), p('i2', 'o2', 'likely'), p('i3', 'o3', 'likely')]
    const shown = visibleProposals(list, new Set(['i3|o3']))
    expect(shown).toHaveLength(2)
    expect(countProposals(shown)).toEqual({ certain: 1, likely: 1 })
  })
})

afterEach(() => installFakeDb(() => ({})).uninstall())

function mount() {
  const db = installFakeDb((c: FakeCall) => {
    switch (c.target) {
      case 'orders':
        return c.ops.some(([n, a]) => n === 'in' && Array.isArray(a[1]) && (a[0] as string) === 'id')
          ? { data: [{ id: 'o9', number: 22, ordered_on: '2024-03-01', customer_po_number: '4398', company_id: 'c1' }] }
          : { data: [{ id: 'o1', number: 11, company_id: 'c1', ordered_on: '2024-02-01', cancelled_on: null, customer_po_number: null, legacy_review: 'to_review' }] }
      case 'invoices':
        return c.ops.some(([n, a]) => n === 'in' && (a[0] as string) === 'id')
          ? { data: [{ id: 'i1', number: '138', invoice_date: '2024-03-20', net_amount: 100000, gst_amount: 18000, company_id: 'c1' }] }
          : { data: [{ id: 'i7', number: '145', invoice_date: '2024-08-11', net_amount: 252000, gst_amount: 45360, company_id: 'c1', order_id: null, notes: null, legacy_review: 'to_review' }] }
      case 'rpc:receivables_list':
        return { data: [{ order_id: 'o1', order_number: 11, company_id: 'c1', gross_target: 87303, settled: 73986, balance: 13317, invoice_numbers: ['124'], payment_state: 'part' }] }
      case 'rpc:lookup_labels':
        return { data: { companies: { c1: 'Ibrahim Fibres Limited' }, orders: {}, legs: {} } }
      case 'rpc:link_imported_invoices': {
        const dry = (opArgs(c, 'args')?.[0] as { p_dry_run?: boolean }).p_dry_run
        return {
          data: dry
            ? [
                { invoice_id: 'i1', order_id: 'o9', confidence: 'certain', reasons: ['same customer', 'the PO number matches'] },
                { invoice_id: 'i7', order_id: 'o1', confidence: 'likely', reasons: ['same customer'] },
              ]
            : [{ invoice_id: 'i1', order_id: 'o9', confidence: 'certain', reasons: [] }],
        }
      }
      default:
        return { data: null }
    }
  })
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <SessionProvider value={{ status: 'signed-in', user: { id: 'u', name: 'Ayesha Rana', role: 'admin' } }}>
        <MemoryRouter>
          <ToastProvider>
            <ReviewImportedPage />
          </ToastProvider>
        </MemoryRouter>
      </SessionProvider>
    </QueryClientProvider>,
  )
  return { db, user: userEvent.setup() }
}

describe('Review imported page', () => {
  it('lists the records to decide, with progress', async () => {
    mount()
    const list = await screen.findByTestId('review-list')
    expect(within(list).getByTestId('review-order-o1')).toHaveTextContent('ORD-0011')
    expect(within(list).getByTestId('review-order-o1')).toHaveTextContent('Received PKR 73,986 of PKR 87,303')
    expect(within(list).getByTestId('review-invoice-i7')).toHaveTextContent('Invoice 145')
    expect(screen.getByTestId('review-progress')).toHaveTextContent('0 of 2 decided')
  })

  it('"Still open" and "Settled, keep as history" call set_legacy_review with the kind, id and state', async () => {
    const { db, user } = mount()
    const row = await screen.findByTestId('review-invoice-i7')
    await user.click(within(row).getByRole('button', { name: 'Still open' }))
    await waitFor(() => expect(db.calls.some(c => c.target === 'rpc:set_legacy_review')).toBe(true))
    expect(opArgs(db.calls.find(c => c.target === 'rpc:set_legacy_review') as FakeCall, 'args')?.[0]).toEqual({ kind: 'invoice', id: 'i7', state: 'live' })
    await user.click(within(screen.getByTestId('review-order-o1')).getByRole('button', { name: 'Settled, keep as history' }))
    await waitFor(() => expect(db.calls.filter(c => c.target === 'rpc:set_legacy_review')).toHaveLength(2))
    expect(opArgs(db.calls.filter(c => c.target === 'rpc:set_legacy_review')[1], 'args')?.[0]).toEqual({ kind: 'order', id: 'o1', state: 'settled' })
  })

  it('Find matches is a dry run; Not this hides a proposal; Link all certain links only the certain ones', async () => {
    const { db, user } = mount()
    await screen.findByTestId('review-list')
    await user.click(screen.getByRole('button', { name: 'Find matches' }))
    const list = await screen.findByTestId('match-list')
    expect(screen.getByTestId('match-counts')).toHaveTextContent('1 certain, 1 likely')
    expect(opArgs(db.calls.find(c => c.target === 'rpc:link_imported_invoices') as FakeCall, 'args')?.[0]).toEqual({ p_dry_run: true })
    expect(within(list).getByText('the PO number matches', { exact: false })).toBeInTheDocument()
    const likely = list.querySelector('[data-confidence="likely"]') as HTMLElement
    await user.click(within(likely).getByRole('button', { name: 'Not this' }))
    expect(screen.getByTestId('match-counts')).toHaveTextContent('1 certain, 0 likely')
    await user.click(screen.getByRole('button', { name: /Link all certain/ }))
    await waitFor(() => expect(db.calls.some(c => c.target === 'rpc:link_imported_invoice')).toBe(true))
    // the bulk RPC links everything certain, rejected or not: it must not be used
    expect(db.calls.some(c => c.target === 'rpc:link_imported_invoices' && (opArgs(c, 'args')?.[0] as { p_dry_run?: boolean }).p_dry_run === false)).toBe(false)
    expect(db.calls.filter(c => c.target === 'rpc:link_imported_invoice').map(c => opArgs(c, 'args')?.[0])).toEqual([{ p_invoice_id: 'i1', p_order_id: 'o9' }])
  })

  it('"Link all certain" does not link a certain proposal the owner turned down with Not this', async () => {
    const { db, user } = mount()
    await screen.findByTestId('review-list')
    await user.click(screen.getByRole('button', { name: 'Find matches' }))
    const list = await screen.findByTestId('match-list')
    const certain = list.querySelector('[data-confidence="certain"]') as HTMLElement
    await user.click(within(certain).getByRole('button', { name: 'Not this' }))
    expect(screen.queryByRole('button', { name: /Link all certain/ })).toBeNull()
    expect(db.calls.some(c => c.target === 'rpc:link_imported_invoice')).toBe(false)
  })

  it('Accept links one invoice to one order', async () => {
    const { db, user } = mount()
    await screen.findByTestId('review-list')
    await user.click(screen.getByRole('button', { name: 'Find matches' }))
    const list = await screen.findByTestId('match-list')
    const likely = list.querySelector('[data-confidence="likely"]') as HTMLElement
    await user.click(within(likely).getByRole('button', { name: 'Accept' }))
    await waitFor(() => expect(db.calls.some(c => c.target === 'rpc:link_imported_invoice')).toBe(true))
    expect(opArgs(db.calls.find(c => c.target === 'rpc:link_imported_invoice') as FakeCall, 'args')?.[0]).toEqual({ p_invoice_id: 'i7', p_order_id: 'o1' })
  })

  it('two rows decided back to back each keep their own result (one mutation per row)', async () => {
    const { db, user } = mount()
    const order = await screen.findByTestId('review-order-o1')
    const invoice = screen.getByTestId('review-invoice-i7')
    await user.click(within(order).getByRole('button', { name: 'Settled, keep as history' }))
    await user.click(within(invoice).getByRole('button', { name: 'Settled, keep as history' }))
    await waitFor(() => expect(db.calls.filter(c => c.target === 'rpc:set_legacy_review')).toHaveLength(2))
    await waitFor(() => expect(screen.getAllByTestId('review-settled-here')).toHaveLength(2))
  })
})
