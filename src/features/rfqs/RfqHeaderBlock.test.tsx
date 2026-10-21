import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { afterEach, describe, expect, it } from 'vitest'
import { SessionContext } from '@/app/session'
import type { RfqHeader } from '@/features/rfqs/api'
import { RfqHeaderBlock, type HeaderFacts } from '@/features/rfqs/RfqHeaderBlock'
import type { RfqPrimary } from '@/features/rfqs/lib'
import { installFakeDb } from '@/test/fakeSupabase'
import { ToastProvider } from '@/ui/Toast'

/*
 * The top of the RFQ page (UX audit 2026-10-19): one green button chosen by state, everything else in More, and at most two chips.
 */

afterEach(() => {
  installFakeDb(() => ({})).uninstall()
})

const state = (over: Record<string, unknown> = {}) =>
  ({
    outcome: 'open',
    sourcing_state: 'covered',
    clarification_state: 'waiting_on_customer',
    bid_state: 'to_bid',
    days_to_due: 2,
    is_overdue: false,
    floated: 3,
    to_ask: 0,
    waiting: 2,
    to_relay: 0,
    ...over,
  }) as unknown as RfqHeader['state']

const rfq = (over: Partial<RfqHeader> = {}): RfqHeader => ({
  id: 'r-1',
  number: 177,
  customerRef: 'ENQ-2211',
  receivedOn: '2026-11-16',
  dueOn: '2026-12-01',
  isPriority: true,
  quotedOn: null,
  closedOn: null,
  closeReason: null,
  closeNote: null,
  notes: null,
  company: { id: 'c-1', name: 'Indus Textile Mills', country: 'Pakistan', createdAt: '2023-01-01' },
  site: null,
  contactId: null,
  contact: null,
  owner: null,
  state: state(),
  ...over,
})

function Where() {
  const l = useLocation()
  return <p data-testid="where">{l.search}</p>
}

function renderHeader(primary: RfqPrimary, r: RfqHeader = rfq(), facts: Partial<HeaderFacts> = {}, role = 'sales') {
  installFakeDb(() => ({ data: [] }))
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  let asked = 0
  render(
    <QueryClientProvider client={client}>
      <SessionContext.Provider value={{ status: 'signed-in', user: { id: 'u1', name: 'Ayesha Rana', role } }}>
        <MemoryRouter initialEntries={['/rfqs/r-1']}>
          <ToastProvider>
            <RfqHeaderBlock rfq={r} facts={{ primary, itemCount: 3, quotationCount: 0, onAsk: () => asked++, ...facts }} />
            <Where />
          </ToastProvider>
        </MemoryRouter>
      </SessionContext.Provider>
    </QueryClientProvider>,
  )
  return { asked: () => asked }
}

const greens = () => screen.queryAllByRole('button').filter(b => b.className.includes('bg-primary'))

describe('the RFQ header', () => {
  it('leads with the company, and shows at most two chips: the stage and the due date', () => {
    renderHeader('issue')
    const h1 = screen.getByRole('heading', { level: 1 })
    expect(h1).toHaveTextContent('Indus Textile Mills')
    expect(h1).toHaveTextContent('RFQ-0177')
    expect(h1).toHaveClass('tracking-tight')
    // the company name is the link to the company; no chip inside the h1
    expect(within(h1).getByRole('link', { name: 'Indus Textile Mills' })).toHaveAttribute('href', '/companies/c-1')
    expect(h1.querySelector('[data-status]')).toBeNull()
    const chips = Array.from(document.querySelectorAll('header [data-status]'))
    expect(chips).toHaveLength(2)
    expect(chips[0]).toHaveTextContent('Ready to quote')
    expect(chips[0]).toHaveAttribute('data-status', 'rfq-stage:ready')
    expect(chips[1]).toHaveTextContent('Due in 2 days')
    expect(document.querySelector('header')).not.toHaveTextContent('Waiting on customer') // the questions show in their own panel
    // Top priority sits in the meta line, not in the title
    expect(h1).not.toHaveTextContent('Top priority')
    expect(screen.getByText('Top priority')).toBeInTheDocument()
  })

  it('the facts strip has no Company cell (the title is the company)', () => {
    renderHeader('issue')
    expect(screen.queryByText('Company', { selector: 'dt' })).toBeNull()
    expect(screen.getByText('Customer ref', { selector: 'dt' })).toBeInTheDocument()
  })

  it('prices in: Issue quotation is the one green button; Mark won is in More, marked as having no quotation yet', async () => {
    const user = userEvent.setup()
    renderHeader('issue')
    expect(greens().map(b => b.textContent)).toEqual(['Issue quotation'])
    await user.click(screen.getByRole('button', { name: /^More/ }))
    const menu = screen.getByRole('menu', { name: 'More' })
    expect(within(menu).getByRole('menuitem', { name: /Mark won/ })).toHaveTextContent('no quotation yet')
    expect(within(menu).getByRole('menuitem', { name: /Ask more suppliers/ })).toBeInTheDocument()
    expect(within(menu).getByRole('menuitem', { name: /Mark quotation sent/ })).toHaveTextContent('no PDF')
    expect(within(menu).queryByRole('menuitem', { name: /Issue quotation/ })).toBeNull()
    expect(within(menu).getByRole('menuitem', { name: /The customer chose a competitor/ })).toBeInTheDocument()
  })

  it('nobody asked: Ask suppliers is the green button, and it opens the list', async () => {
    const user = userEvent.setup()
    const h = renderHeader('ask', rfq({ state: state({ sourcing_state: 'not_floated', floated: 0 }) }))
    expect(greens().map(b => b.textContent)).toEqual(['Ask suppliers'])
    await user.click(screen.getByRole('button', { name: 'Ask suppliers' }))
    expect(h.asked()).toBe(1)
  })

  it('quotation sent: Mark won is the green button; revising and sending again are in More', async () => {
    const user = userEvent.setup()
    renderHeader('won', rfq({ state: state({ bid_state: 'bid_sent' }), quotedOn: '2026-11-26' }), { quotationCount: 1 })
    expect(greens().map(b => b.textContent)).toEqual(['Mark won'])
    expect(document.querySelector('[data-status="rfq-stage:sent"]')).toHaveTextContent('Quotation sent')
    await user.click(screen.getByRole('button', { name: /^More/ }))
    const menu = screen.getByRole('menu', { name: 'More' })
    expect(within(menu).getByRole('menuitem', { name: 'Revise quotation' })).toBeInTheDocument()
    expect(within(menu).getByRole('menuitem', { name: /Quotation sent again/ })).toBeInTheDocument()
    expect(within(menu).queryByRole('menuitem', { name: /Mark won/ })).toBeNull()
    await user.click(screen.getByRole('button', { name: 'Mark won' }))
    expect(screen.getByTestId('where')).toHaveTextContent('won=1')
  })

  it('quotation sent: no overdue chip but when it was sent; the next step names the contact, with a quiet Mark lost menu', async () => {
    const user = userEvent.setup()
    renderHeader(
      'won',
      rfq({ state: state({ bid_state: 'bid_sent', days_to_due: -1, is_overdue: true }), contact: { name: 'Kamran Zafar' } as RfqHeader['contact'] }),
      { quotationCount: 1, sentOn: '2026-10-22', validUntil: '2026-11-21' },
    )
    expect(document.querySelector('header [data-status^="deadline"]')).toBeNull()
    expect(screen.queryByText(/overdue/)).toBeNull()
    expect(document.querySelector('[data-sent]')).toHaveTextContent(/^Sent .*22 Oct · valid to .*21 Nov$/)
    expect(screen.getByText('Quotation due', { selector: 'dt' })).not.toHaveClass('text-tone-warning-fg')
    const box = screen.getByRole('region', { name: 'Next step' })
    expect(box).toHaveTextContent('Follow up with Kamran Zafar.')
    expect(greens().map(b => b.textContent)).toEqual(['Mark won'])
    await user.click(within(box).getByRole('button', { name: 'Mark lost' }))
    expect(within(screen.getByRole('menu', { name: 'Lost because' })).getByRole('menuitem', { name: /Price too high/ })).toBeInTheDocument()
  })

  it('the Quotation due tile is orange only when two days or less away', () => {
    renderHeader('issue', rfq({ state: state({ days_to_due: 6 }) }))
    expect(screen.getByText('Quotation due', { selector: 'dt' })).not.toHaveClass('text-tone-warning-fg')
    expect(document.querySelector('header [data-status^="deadline"]')).toBeNull()
  })

  it('a long customer ref can break after each "/" on a narrow phone', () => {
    renderHeader('issue', rfq({ customerRef: 'RFF/PUR/261/1' }))
    const ref = screen.getByText('Customer ref', { selector: 'dt' }).parentElement?.querySelector('dd span.num')
    expect(ref).toHaveTextContent('RFF/PUR/261/1')
    expect(ref?.querySelectorAll('wbr')).toHaveLength(4)
  })

  it('Issue quotation is never silently disabled: it opens from More, and with no item the menu says why', async () => {
    const user = userEvent.setup()
    renderHeader('none', rfq({ state: state({ sourcing_state: 'floated_awaiting' }) }), { itemCount: 0 })
    expect(greens()).toHaveLength(0)
    await user.click(screen.getByRole('button', { name: /^More/ }))
    const issue = within(screen.getByRole('menu', { name: 'More' })).getByRole('menuitem', { name: /Issue quotation/ })
    expect(issue).toBeDisabled()
    expect(issue).toHaveTextContent('add an item first')
  })

  it('a closed RFQ says when and why in the Next step box, with Reopen and Mark won beside it, and no green button', async () => {
    const user = userEvent.setup()
    renderHeader('none', rfq({ state: state({ outcome: 'closed' }), closedOn: '2026-11-30', closeReason: 'price' }))
    expect(greens()).toHaveLength(0)
    const box = screen.getByRole('region', { name: 'Next step' })
    expect(box).toHaveTextContent(/Closed .*: Price too high\./)
    expect(within(box).getByRole('button', { name: 'Reopen' })).toBeInTheDocument()
    // A customer may order after it was closed: Mark won is right there (converting reopens it).
    await user.click(within(box).getByRole('button', { name: 'Mark won' }))
    expect(screen.getByTestId('where')).toHaveTextContent('won=1')
  })

  it('the green button sits in the Next step box under the title, with the reason; the header itself has none', () => {
    renderHeader('issue')
    const box = screen.getByRole('region', { name: 'Next step' })
    expect(box).toHaveTextContent('Next stepSupplier prices are in. Send the customer a quotation.')
    expect(within(box).getByRole('button', { name: 'Issue quotation' })).toHaveClass('bg-primary')
    expect(greens()).toHaveLength(1)
    // The title comes first, then the box.
    const h1 = screen.getByRole('heading', { level: 1 })
    expect(h1.compareDocumentPosition(box) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('waiting for prices: the green button is Chase suppliers, and the sentence says how many owe a price', () => {
    renderHeader('chase', rfq({ state: state({ sourcing_state: 'floated_awaiting' }) }), { awaiting: 2 })
    const box = screen.getByRole('region', { name: 'Next step' })
    expect(box).toHaveTextContent('Waiting for prices from 2 suppliers. Chase them.')
    expect(greens().map(b => b.textContent)).toEqual(['Chase suppliers'])
  })

  it('an engineer has no Issue quotation and no Mark won, in More or beside a closed RFQ (owner decision 2026-10-22)', async () => {
    const user = userEvent.setup()
    renderHeader('none', rfq({ state: state({ outcome: 'closed' }), closedOn: '2026-11-30', closeReason: 'price' }), {}, 'engineer')
    const box = screen.getByRole('region', { name: 'Next step' })
    expect(within(box).getByRole('button', { name: 'Reopen' })).toBeInTheDocument()
    expect(within(box).queryByRole('button', { name: 'Mark won' })).toBeNull()
    cleanup()
    renderHeader('none', rfq({ state: state({ bid_state: 'bid_sent' }), quotedOn: '2026-11-26' }), { quotationCount: 1 }, 'engineer')
    expect(greens()).toHaveLength(0)
    await user.click(screen.getByRole('button', { name: /^More/ }))
    const menu = screen.getByRole('menu', { name: 'More' })
    expect(within(menu).queryByRole('menuitem', { name: /Issue quotation|Revise quotation/ })).toBeNull()
    expect(within(menu).queryByRole('menuitem', { name: /Mark won/ })).toBeNull()
    expect(within(menu).getByRole('menuitem', { name: /Quotation sent again/ })).toBeInTheDocument()
  })

  it('nothing to do: the box is a quiet sentence with no button', () => {
    renderHeader('none', rfq({ state: state({ sourcing_state: 'floated_awaiting' }) }), { awaiting: 1 })
    const box = screen.getByRole('region', { name: 'Next step' })
    expect(box).toHaveTextContent('Waiting for prices from 1 supplier. Chased recently: nothing to do until they reply.')
    expect(within(box).queryByRole('button')).toBeNull()
  })
})
