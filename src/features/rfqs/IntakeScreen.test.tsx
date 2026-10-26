import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Link, MemoryRouter, Route, Routes, useNavigate } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SessionContext, type SessionState } from '@/app/session'
import IntakeScreen from '@/features/rfqs/IntakeScreen'
import { saveIntakeDraft, type IntakeDraft } from '@/features/rfqs/lib/intakeDraftStore'
import { installFakeDb, opArgs, type FakeCall, type FakeResult } from '@/test/fakeSupabase'
import { ToastProvider } from '@/ui/Toast'

/*
 * The intake screen's flow with a scripted database (R05): what is called, in what order, and how often. The real
 * queries, the RPC and Row Level Security are proven against the real database by the Playwright `rfq-intake` project.
 */

const EMAIL = ['Dear Sir, please quote:', '1) Hach HQ1110 portable meter - 1 no', '2) 24V actuator for ball valve x 2', 'Regards, K'].join('\n')

let copied: string[] = []

/** Companies read one at a time (a company page's ?company= or a supplier page's ?supplier=). */
const BY_ID: Record<string, { name: string; country: string; city: string }> = {
  'c-acme': { name: 'Acme Plastics', country: 'Pakistan', city: 'Lahore' },
  's-orient': { name: 'Orient Analytical', country: 'Pakistan', city: 'Karachi' },
  's-zeta': { name: 'Zeta Instruments', country: 'Pakistan', city: 'Lahore' },
}

/** Companies, sites and contacts on file (a restored draft is checked against them). */
const ON_FILE = new Set(['c-acme', 's-orient', 'c-old'])
/** RFQs already saved, by id (a kept draft whose RFQ is one of these offers "Open" instead of Continue). */
let savedRfqs: Record<string, number> = {}

function respond(call: FakeCall): FakeResult {
  const ilike = call.ops.some(([n]) => n === 'ilike')
  const has = (op: string) => call.ops.some(([n]) => n === op)
  const eqId = opArgs(call, 'eq')?.[1] as string | undefined
  switch (call.target) {
    case 'brands':
      return { data: [{ id: 'b-hach', name: 'Hach', kind: 'brand' }, { id: 'f-pt', name: 'Pressure transmitters', kind: 'family' }] }
    case 'companies':
      if (has('maybeSingle')) return { data: eqId !== undefined && BY_ID[eqId] ? { id: eqId, ...BY_ID[eqId] } : null }
      if (has('limit') && eqId !== undefined) return { data: ON_FILE.has(eqId) ? [{ id: eqId }] : [] }
      return ilike
        ? { data: [{ id: 'c-acme', name: 'Acme Plastics', country: 'Pakistan' }] }
        : { data: [{ id: 'c-acme', name: 'Acme Plastics', country: 'Pakistan' }, { id: 's-orient', name: 'Orient Analytical', country: 'Pakistan' }] }
    case 'v_company_roles':
      return { data: has('maybeSingle') ? null : [] }
    case 'company_sites':
    case 'contacts':
      return { data: has('limit') && eqId !== undefined ? (ON_FILE.has(eqId) ? [{ id: eqId }] : []) : [] }
    case 'v_supplier_stats':
      return {
        data: [
          { supplier_id: 's-orient', asked: 8, replied: 7, no_offer: 0, median_reply_days: 1, last_contact: '2026-11-03', brand_ids: ['b-hach'], brand_names: ['Hach'] },
        ],
      }
    case 'rpc:supplier_item_memory': {
      const args = (opArgs(call, 'args')?.[0] ?? {}) as { p_description?: string }
      return {
        data: /hach/i.test(args.p_description ?? '')
          ? [
              {
                supplier_id: 's-orient',
                best_tier: 0,
                best_tier_label: 'same model',
                supplied_before: true,
                last_quote_tier: 0,
                last_quote_on: '2026-06-14',
                last_quote_price: 1980,
                last_quote_currency: 'USD',
                last_quote_fx_rate_pkr: 278.3,
                last_quote_fx_rate_on: '2026-06-14',
                last_quote_price_pkr: 551034,
                last_quote_qty: 1,
                last_quote_unit: 'pcs',
                last_quote_lead_time: '6 weeks',
                recent_lead_times: ['6 weeks'],
              },
            ]
          : [],
      }
    }
    case 'rpc:float_rfq':
      return { data: 'rfq-id' }
    case 'rfqs':
      if (has('in')) return { data: [] }
      // findRfqById (the kept draft's check): a list of at most one.
      if (has('limit')) return { data: eqId !== undefined && savedRfqs[eqId] ? [{ id: eqId, number: savedRfqs[eqId] }] : [] }
      return { data: { id: 'rfq-id', number: 185 } }
    case 'rpc:set_rfq_floated':
      return { data: 1 }
    default:
      return { data: [] }
  }
}

const SIGNED_IN: SessionState = { status: 'signed-in', user: { id: 'u1', name: 'Ayesha Rana', role: 'sales' } }
const CAPTURED = 'Pls quote\n1) Rosemount 3051 transmitter - 1 no'

/** Paste or photo's "Start a new RFQ", sent while New RFQ is open: the same address, with the captured message. */
function SendCapture() {
  const navigate = useNavigate()
  return (
    <button type="button" onClick={() => navigate('/rfqs/new?company=c-acme', { state: { capture: { id: 'cap-1', text: CAPTURED, files: [] } } })}>
      Send from Paste or photo
    </button>
  )
}

type InitialEntry = string | { pathname: string; search?: string; state?: unknown }

function renderScreen(entry: InitialEntry = '/rfqs/new', session: SessionState = SIGNED_IN) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <SessionContext.Provider value={session}>
        <MemoryRouter initialEntries={[entry]}>
          <ToastProvider>
            {/* A tab of the shell, to leave the screen by. */}
            <Link to="/today">Today</Link>
            <SendCapture />
            <Routes>
              <Route path="/rfqs/new" element={<IntakeScreen />} />
              <Route path="/today" element={<h1>Today page</h1>} />
            </Routes>
          </ToastProvider>
        </MemoryRouter>
      </SessionContext.Provider>
    </QueryClientProvider>,
  )
}

class FakeClipboardItem {
  constructor(public readonly items: Record<string, Promise<Blob> | Blob>) {}
}

beforeEach(() => {
  copied = []
  savedRfqs = {}
  localStorage.clear() // the New RFQ draft and the channel choice are kept on the device: each test starts with none
  vi.stubGlobal('ClipboardItem', FakeClipboardItem)
})

/** user-event installs its own clipboard when it is set up, so ours goes in after it. */
function setup() {
  const user = userEvent.setup()
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: {
      write: async (items: FakeClipboardItem[]) => {
        const blob = await items[0].items['text/plain']
        copied.push(
          await new Promise<string>(res => {
            const r = new FileReader()
            r.onload = () => res(String(r.result))
            r.readAsText(blob)
          }),
        )
      },
    },
  })
  return user
}
afterEach(() => vi.unstubAllGlobals())

async function reachEnquiry(user: ReturnType<typeof setup>) {
  await user.type(screen.getByRole('combobox', { name: 'Company' }), 'Acme')
  await user.click(await screen.findByRole('option', { name: /Acme Plastics/ }))
  fireEvent.paste(document.body, { clipboardData: { getData: () => EMAIL } })
  expect(await screen.findByText('2 items found')).toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'Looks right: find suppliers' }))
  const orient = await screen.findByRole('checkbox', { name: 'Orient Analytical' })
  await waitFor(() => expect(orient).toBeChecked()) // supplied this item before: ticked
  await user.click(screen.getByRole('button', { name: 'Write the message' }))
}

describe('intake screen', () => {
  it('pastes into rows, ticks only the supplier that supplied it before, and flags the item nobody is asked about', async () => {
    installFakeDb(respond)
    const user = setup()
    renderScreen()
    await user.type(screen.getByRole('combobox', { name: 'Company' }), 'Acme')
    await user.click(await screen.findByRole('option', { name: /Acme Plastics/ }))
    fireEvent.paste(document.body, { clipboardData: { getData: () => EMAIL } })

    expect(await screen.findByRole('textbox', { name: 'Description of item 1' })).toHaveValue('Hach HQ1110 portable meter')
    expect(screen.getByRole('textbox', { name: 'Quantity of item 2' })).toHaveValue('2 nos')
    // Brand picked from the description.
    await waitFor(() => expect(within(screen.getByRole('combobox', { name: 'Brand of item 1' })).getByRole('option', { selected: true })).toHaveTextContent('Hach'))
    // Split: the paste box and the PDF button wait behind one "Paste more"; no "Customer" tag beside the company.
    expect(screen.queryByRole('button', { name: 'Choose PDF or photo' })).toBeNull()
    expect(screen.queryByText('Customer', { selector: 'span' })).toBeNull()
    await user.click(screen.getByRole('button', { name: 'Paste more' }))
    expect(screen.getByRole('button', { name: 'Choose PDF or photo' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Looks right: find suppliers' }))
    expect(await screen.findByRole('checkbox', { name: 'Orient Analytical' })).toBeChecked()
    expect(screen.getByText(/Item 2 \(24V actuator for ball valve\) has no supplier ticked\./)).toBeInTheDocument()
  })

  it('names an item nobody is asked about by its brand and ticks the supplier that carries it in one tap', async () => {
    installFakeDb(call => {
      if (call.target === 'v_supplier_stats')
        return {
          data: [
            { supplier_id: 's-orient', asked: 8, replied: 7, no_offer: 0, median_reply_days: 1, last_contact: '2026-11-03', brand_ids: [], brand_names: [] },
            { supplier_id: 's-zeta', asked: 2, replied: 0, no_offer: 0, median_reply_days: 3, last_contact: '2026-10-03', brand_ids: ['b-hach'], brand_names: ['Hach'] },
          ],
        }
      if (call.target === 'companies' && !call.ops.some(([n]) => n === 'ilike' || n === 'maybeSingle' || n === 'limit'))
        return { data: [{ id: 'c-acme', name: 'Acme Plastics', country: 'Pakistan' }, { id: 's-orient', name: 'Orient Analytical', country: 'Pakistan' }, { id: 's-zeta', name: 'Zeta Instruments', country: 'Pakistan' }] }
      if (call.target === 'rpc:supplier_item_memory') {
        const args = (opArgs(call, 'args')?.[0] ?? {}) as { p_description?: string }
        if (!/HQ1110/.test(args.p_description ?? '')) return { data: [] }
      }
      return respond(call)
    })
    const user = setup()
    renderScreen()
    await user.type(screen.getByRole('combobox', { name: 'Company' }), 'Acme')
    await user.click(await screen.findByRole('option', { name: /Acme Plastics/ }))
    fireEvent.paste(document.body, { clipboardData: { getData: () => '1) Hach HQ1110 portable meter - 1 no\n2) Hach DR3900 spectrophotometer - 1 no' } })
    expect(await screen.findByText('2 items found')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Looks right: find suppliers' }))
    await waitFor(() => expect(screen.getByRole('checkbox', { name: 'Orient Analytical' })).toBeChecked())
    expect(screen.getByRole('checkbox', { name: 'Zeta Instruments' })).not.toBeChecked()
    expect(screen.getByText('Item 2 (Hach): tick Zeta Instruments?')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Tick Zeta Instruments' }))
    expect(screen.getByRole('checkbox', { name: 'Zeta Instruments' })).toBeChecked()
    expect(screen.queryByText(/tick Zeta Instruments\?/)).toBeNull()
  })

  it('shows the Family column only when a row named neither a brand nor a family; the family can always be set', async () => {
    installFakeDb(respond)
    setup()
    renderScreen()
    fireEvent.paste(document.body, { clipboardData: { getData: () => '1) Hach HQ1110 portable meter - 1 no' } })
    expect(await screen.findByRole('textbox', { name: 'Description of item 1' })).toHaveValue('Hach HQ1110 portable meter')
    await waitFor(() => expect(within(screen.getByRole('combobox', { name: 'Brand of item 1' })).getByRole('option', { selected: true })).toHaveTextContent('Hach'))
    // The brand was found: no Family column, but the row still sets its family after the brand.
    expect(screen.getByText('Brand and family')).toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: 'Family of item 1' })).toBeInTheDocument()
    expect(screen.getByText('+ family', { selector: 'span' })).toBeInTheDocument()
    // A row with nothing to go on: the Family column appears.
    fireEvent.paste(document.body, { clipboardData: { getData: () => '1) 24V actuator for ball valve x 2' } })
    expect(await screen.findByRole('textbox', { name: 'Description of item 2' })).toHaveValue('24V actuator for ball valve')
    expect(screen.queryByText('Brand and family')).toBeNull()
    expect(screen.getByText('Family')).toBeInTheDocument()
    expect(screen.getAllByText('no family', { selector: 'span' })).toHaveLength(2)
  })

  it('opens a Memory card per supplier: tier label, last quote at the time, brands, replies; one memory call per item, none per row', async () => {
    const db = installFakeDb(respond)
    const user = setup()
    renderScreen()
    await user.type(screen.getByRole('combobox', { name: 'Company' }), 'Acme')
    await user.click(await screen.findByRole('option', { name: /Acme Plastics/ }))
    fireEvent.paste(document.body, { clipboardData: { getData: () => EMAIL } })
    expect(await screen.findByText('2 items found')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Looks right: find suppliers' }))
    await screen.findByRole('checkbox', { name: 'Orient Analytical' })

    // One supplier_item_memory call per item (two items), each carrying the whole supplier list: nothing per supplier or per row.
    expect(db.calls.filter(c => c.target === 'rpc:supplier_item_memory')).toHaveLength(2)

    expect(screen.queryByLabelText('What we know about Orient Analytical')).not.toBeInTheDocument()
    // R2-10: the pill counts items ("1 item · same model"), and the order behind the reason is in History, not on the row.
    const row = screen.getByRole('checkbox', { name: 'Orient Analytical' }).closest('li') as HTMLElement
    expect(row).toHaveTextContent(/1 item\s*·\s*same model/)
    expect(row.querySelector('[data-evidence]')).toBeNull()
    const button = screen.getByRole('button', { name: 'History, Orient Analytical' })
    expect(button).toHaveAttribute('aria-expanded', 'false')
    await user.click(button)
    expect(button).toHaveAttribute('aria-expanded', 'true')
    const card = screen.getByLabelText('What we know about Orient Analytical')
    expect(within(card).getByText('same model')).toBeInTheDocument()
    expect(within(card).getByText('Matched on model code.', { exact: false })).toBeInTheDocument()
    expect(within(card).getByText('USD 1,980')).toBeInTheDocument()
    expect(within(card).getByText(/≈ PKR 551,034/)).toBeInTheDocument()
    expect(within(card).getByText('at the time')).toBeInTheDocument()
    expect(within(card).getByText('6 weeks')).toBeInTheDocument()
    expect(within(card).getByText('Hach')).toBeInTheDocument()
    expect(within(card).getByText('answered 7 of 8')).toBeInTheDocument()
    expect(card.textContent).not.toMatch(/%|score/i)
    // Opening the card asks for nothing more, and does not tick or untick the supplier.
    expect(db.calls.filter(c => c.target === 'rpc:supplier_item_memory')).toHaveLength(2)
    expect(screen.getByRole('checkbox', { name: 'Orient Analytical' })).toBeChecked()
    await user.click(button)
    expect(screen.queryByLabelText('What we know about Orient Analytical')).not.toBeInTheDocument()
  })

  it('Copy message copies the text with the real RFQ number and marks it sent once, even on a double tap', async () => {
    const db = installFakeDb(respond)
    const user = setup()
    renderScreen()
    await reachEnquiry(user)

    // Before the save there is no number: the preview says so in words, never "RFQ-####"; the spec note is an (i) tip.
    const preview = screen.getByRole('group', { name: 'Message text' })
    expect(within(preview).getByText('RFQ number added when you copy')).toBeInTheDocument()
    expect(preview.textContent).not.toContain('####')
    expect(screen.getByRole('button', { name: 'Why are the spec lines blank?' })).toBeInTheDocument()
    expect(screen.queryByText(/Spec lines are blank on purpose/)).toBeNull()

    const button = await screen.findByRole('button', { name: 'Copy message for 1 supplier' })
    await user.dblClick(button)

    expect(await screen.findByText(/is waiting for prices/)).toBeInTheDocument()
    expect(screen.getByText('Copied. Paste it into each supplier’s chat.')).toBeInTheDocument()
    // No supplier chat is listed to open here, so Open RFQ is the one green button.
    expect(screen.getByRole('link', { name: 'Open RFQ-0185' })).toHaveClass('bg-primary')
    const floats = db.calls.filter(c => c.target === 'rpc:float_rfq')
    expect(floats).toHaveLength(1)
    const args = opArgs(floats[0], 'args')?.[0] as Record<string, unknown>
    expect(args.p_mark_sent).toBe(true)
    expect(args.p_supplier_ids).toEqual(['s-orient'])
    expect(args.p_items).toEqual([
      { description: 'Hach HQ1110 portable meter', qty: 1, unit: 'nos', brand_id: 'b-hach', gst_rate: 18 },
      { description: '24V actuator for ball valve', qty: 2, gst_rate: 18 },
    ])
    await waitFor(() => expect(copied).toHaveLength(1))
    expect(copied[0]).toContain('our ref *RFQ-0185*')
    expect(copied[0]).not.toContain('####')
  })

  it('Undo reverses the float through one RPC and returns to the enquiry', async () => {
    const db = installFakeDb(respond)
    const user = setup()
    renderScreen()
    await reachEnquiry(user)
    await user.click(await screen.findByRole('button', { name: 'Copy message for 1 supplier' }))
    await screen.findByText(/is waiting for prices/)

    await user.click(await screen.findByRole('button', { name: /Undo/ }))
    await waitFor(() => expect(db.calls.some(c => c.target === 'rpc:set_rfq_floated')).toBe(true))
    const undo = db.calls.find(c => c.target === 'rpc:set_rfq_floated') as FakeCall
    expect(opArgs(undo, 'args')?.[0]).toEqual({ p_rfq_id: 'rfq-id', p_floated: false })
    expect((await screen.findAllByText('Undone')).length).toBeGreaterThan(0)
    // Back on the enquiry, ready to copy again: that floats the saved RFQ, it does not create a second one.
    await user.click(screen.getByRole('button', { name: 'Copy message for 1 supplier' }))
    await screen.findByText(/is waiting for prices/)
    expect(db.calls.filter(c => c.target === 'rpc:float_rfq')).toHaveLength(1)
    expect(db.calls.filter(c => c.target === 'rpc:set_rfq_floated').map(c => (opArgs(c, 'args')?.[0] as { p_floated: boolean }).p_floated)).toEqual([false, true])
  })

  it("Save for later (don't ask suppliers yet) keeps the supplier shortlisted (p_mark_sent false)", async () => {
    const db = installFakeDb(respond)
    const user = setup()
    renderScreen()
    await user.type(screen.getByRole('combobox', { name: 'Company' }), 'Acme')
    await user.click(await screen.findByRole('option', { name: /Acme Plastics/ }))
    fireEvent.paste(document.body, { clipboardData: { getData: () => EMAIL } })
    await screen.findByText('2 items found')
    await user.click(screen.getByRole('button', { name: 'Looks right: find suppliers' }))
    await waitFor(() => expect(screen.getByRole('checkbox', { name: 'Orient Analytical' })).toBeChecked())
    await user.click(screen.getByRole('button', { name: "Save for later (don't ask suppliers yet)" }))
    expect(await screen.findByText(/is saved/)).toBeInTheDocument()
    const args = opArgs(db.calls.find(c => c.target === 'rpc:float_rfq') as FakeCall, 'args')?.[0] as Record<string, unknown>
    expect(args.p_mark_sent).toBe(false)
    expect(args.p_supplier_ids).toEqual(['s-orient'])
    expect(copied).toEqual([]) // nothing is copied when nothing is floated
  })

  it('shows a plain sentence when the save fails, and nothing is claimed as floated', async () => {
    installFakeDb(call => (call.target === 'rpc:float_rfq' ? { error: { code: '23514', message: 'check constraint' } } : respond(call)))
    const user = setup()
    renderScreen()
    await reachEnquiry(user)
    await user.click(await screen.findByRole('button', { name: 'Copy message for 1 supplier' }))
    expect(await screen.findByRole('alert')).toBeInTheDocument()
    expect(screen.queryByText(/is waiting for prices/)).toBeNull()
  })
})

describe('New RFQ from a supplier\'s page (?supplier=)', () => {
  async function toSuppliers(user: ReturnType<typeof setup>) {
    await user.type(screen.getByRole('combobox', { name: 'Company' }), 'Acme')
    await user.click(await screen.findByRole('option', { name: /Acme Plastics/ }))
    fireEvent.paste(document.body, { clipboardData: { getData: () => EMAIL } })
    expect(await screen.findByText('2 items found')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Looks right: find suppliers' }))
  }

  it('the supplier is already on the list to ask, ticked, with no extra step', async () => {
    installFakeDb(respond)
    const user = setup()
    renderScreen('/rfqs/new?supplier=s-zeta')
    expect(await screen.findByText(/is ticked as a supplier to ask\./)).toHaveTextContent('Zeta Instruments is ticked as a supplier to ask.')
    await toSuppliers(user)
    const added = await screen.findByRole('region', { name: 'Added by you' })
    expect(within(added).getByRole('checkbox', { name: 'Zeta Instruments' })).toBeChecked()
    await waitFor(() => expect(screen.getByRole('checkbox', { name: 'Orient Analytical' })).toBeChecked())
    await user.click(screen.getByRole('button', { name: 'Write the message' }))
    expect(await screen.findByRole('button', { name: 'Copy message for 2 suppliers' })).toBeInTheDocument()
  })

  it('a supplier that is suggested anyway shows once, ticked in its reason group', async () => {
    installFakeDb(respond)
    const user = setup()
    renderScreen('/rfqs/new?supplier=s-orient')
    expect(await screen.findByText(/is ticked as a supplier to ask\./)).toHaveTextContent('Orient Analytical is ticked as a supplier to ask.')
    await toSuppliers(user)
    await waitFor(() => expect(screen.getByRole('checkbox', { name: 'Orient Analytical' })).toBeChecked())
    expect(screen.getAllByRole('checkbox', { name: 'Orient Analytical' })).toHaveLength(1)
    expect(screen.queryByRole('region', { name: 'Added by you' })).toBeNull()
  })
})

describe('the New RFQ draft (kept on this device)', () => {
  const keptDraft = (over: Partial<IntakeDraft> = {}): IntakeDraft => ({
    v: 1,
    savedAt: Date.now() - 60_000,
    rfqId: 'r-kept',
    company: { id: 'c-old', name: 'Old Mill', country: 'Pakistan', city: 'Multan', role: 'customer' },
    siteId: null,
    contactId: 'k-gone',
    dueOn: '',
    customerRef: '',
    isPriority: false,
    items: [{ key: 'k1', description: 'Belimo LF24 actuator', qty: 1, unit: 'pcs', brandId: null, familyId: null }],
    overrides: {},
    manual: [],
    ...over,
  })

  async function startDraft(user: ReturnType<typeof setup>) {
    await user.type(screen.getByRole('combobox', { name: 'Company' }), 'Acme')
    await user.click(await screen.findByRole('option', { name: /Acme Plastics/ }))
    await user.type(screen.getByRole('textbox', { name: 'Customer reference' }), 'ENQ-2211')
    fireEvent.paste(document.body, { clipboardData: { getData: () => EMAIL } })
    expect(await screen.findByText('2 items found')).toBeInTheDocument()
  }

  it('keeps what was typed and offers it on return: Continue your draft brings the company, the reference and the items back', async () => {
    installFakeDb(respond)
    const user = setup()
    const first = renderScreen()
    await startDraft(user)
    first.unmount()

    renderScreen()
    expect(await screen.findByText(/You have a draft from .* today/)).toBeInTheDocument()
    expect(screen.getByText(/Acme Plastics, 2 items\. It is kept on this device/)).toBeInTheDocument()
    // The form waits for the answer: nothing to type into, so nothing can be kept over the draft.
    expect(screen.queryByRole('region', { name: 'Customer' })).toBeNull()
    await user.click(await screen.findByRole('button', { name: 'Continue your draft' }))
    expect(screen.getByRole('textbox', { name: 'Description of item 1' })).toHaveValue('Hach HQ1110 portable meter')
    expect(screen.getByRole('textbox', { name: 'Customer reference' })).toHaveValue('ENQ-2211')
    expect(screen.getByRole('button', { name: 'Change company, now Acme Plastics' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Continue your draft' })).toBeNull()
  })

  it('Start new forgets it', async () => {
    installFakeDb(respond)
    const user = setup()
    const first = renderScreen()
    await startDraft(user)
    first.unmount()
    const second = renderScreen()
    await user.click(await screen.findByRole('button', { name: 'Start new' }))
    expect(screen.queryByText(/You have a draft/)).toBeNull()
    expect(screen.getByRole('combobox', { name: 'Company' })).toBeInTheDocument()
    second.unmount()
    renderScreen()
    expect(screen.queryByText(/You have a draft/)).toBeNull()
  })

  it('is offered on every way in: from a company page the draft comes first, it is not written over, and the company waits for Start new', async () => {
    installFakeDb(respond)
    const user = setup()
    saveIntakeDraft('u1', keptDraft())
    const before = localStorage.getItem('qtech.rfqs.intakeDraft.u1')
    renderScreen('/rfqs/new?company=c-acme')
    expect(await screen.findByText(/You have a draft from/)).toBeInTheDocument()
    expect(screen.getByText(/Old Mill, 1 item\./)).toBeInTheDocument()
    await screen.findByRole('button', { name: 'Continue your draft' })
    expect(screen.queryByRole('button', { name: /Change company/ })).toBeNull()
    expect(localStorage.getItem('qtech.rfqs.intakeDraft.u1')).toBe(before)

    await user.click(await screen.findByRole('button', { name: 'Start new for Acme Plastics' }))
    expect(await screen.findByRole('button', { name: 'Change company, now Acme Plastics' })).toBeInTheDocument()
    expect(localStorage.getItem('qtech.rfqs.intakeDraft.u1')).not.toContain('Old Mill')
  })

  it('from a company page, Continue your draft keeps the draft\'s company, not the page\'s', async () => {
    installFakeDb(respond)
    const user = setup()
    saveIntakeDraft('u1', keptDraft())
    renderScreen('/rfqs/new?company=c-acme')
    await user.click(await screen.findByRole('button', { name: 'Continue your draft' }))
    expect(await screen.findByRole('button', { name: 'Change company, now Old Mill' })).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: 'Description of item 1' })).toHaveValue('Belimo LF24 actuator')
    // The contact it named is no longer on file: dropped, and said once.
    expect(screen.getByText('The contact in your draft is no longer on file. Pick again if you need one.')).toBeInTheDocument()
    await new Promise(r => setTimeout(r, 30))
    expect(screen.getByRole('button', { name: 'Change company, now Old Mill' })).toBeInTheDocument()
  })

  it('a message from Paste or photo while New RFQ is open starts a new form: it is not merged in, and the open one is offered back', async () => {
    installFakeDb(respond)
    const user = setup()
    renderScreen()
    await startDraft(user)
    await user.click(screen.getByRole('button', { name: 'Send from Paste or photo' }))
    // A new form: the two pasted items are not on it, and the one that was open is the draft on offer.
    expect(await screen.findByText(/Acme Plastics, 2 items\. It is kept on this device/)).toBeInTheDocument()
    expect(screen.getByText(/the message you brought is not added/)).toBeInTheDocument()
    expect(screen.queryByRole('textbox', { name: 'Description of item 1' })).toBeNull()
    await user.click(screen.getByRole('button', { name: 'Start new with the pasted message' }))
    expect(await screen.findByRole('textbox', { name: 'Description of item 1' })).toHaveValue('Rosemount 3051 transmitter')
    expect(screen.queryByRole('textbox', { name: 'Description of item 2' })).toBeNull()
    expect(screen.getByRole('textbox', { name: 'Customer reference' })).toHaveValue('')
  })

  it('a draft whose RFQ is already saved offers Open RFQ-0177 instead of Continue', async () => {
    installFakeDb(respond)
    setup()
    savedRfqs = { 'r-kept': 177 }
    saveIntakeDraft('u1', keptDraft())
    renderScreen()
    expect(await screen.findByRole('heading', { name: 'Your draft is already saved as RFQ-0177' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Open RFQ-0177' })).toHaveAttribute('href', '/rfqs/r-kept')
    expect(screen.queryByRole('button', { name: /Continue your draft/ })).toBeNull()
    expect(screen.getByRole('button', { name: 'Start new' })).toBeInTheDocument()
  })

  it('Continue checks the draft: a company no longer on file is asked for again', async () => {
    installFakeDb(respond)
    const user = setup()
    saveIntakeDraft('u1', keptDraft({ company: { id: 'c-gone', name: 'Gone Ltd', country: 'Pakistan', city: null, role: 'customer' } }))
    renderScreen()
    await user.click(await screen.findByRole('button', { name: 'Continue your draft' }))
    expect(await screen.findByText(/Gone Ltd in your draft is no longer on file/)).toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: 'Company' })).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: 'Description of item 1' })).toHaveValue('Belimo LF24 actuator')
  })

  it('never writes over another RFQ\'s draft (another tab): it says this form is not kept', async () => {
    installFakeDb(respond)
    const user = setup()
    renderScreen()
    await user.type(screen.getByRole('textbox', { name: 'Customer reference' }), 'ENQ-1')
    // Another tab keeps its own draft meanwhile.
    localStorage.setItem('qtech.rfqs.intakeDraft.u1', JSON.stringify(keptDraft({ rfqId: 'r-other', savedAt: Date.now() })))
    await user.type(screen.getByRole('textbox', { name: 'Customer reference' }), '2')
    expect(await screen.findByText('This form is not kept on this device')).toBeInTheDocument()
    expect(localStorage.getItem('qtech.rfqs.intakeDraft.u1')).toContain('r-other')
  })

  it('the save clears its draft even when the screen has already gone', async () => {
    let finish: (r: FakeResult) => void = () => {}
    installFakeDb(call => (call.target === 'rpc:float_rfq' ? new Promise<FakeResult>(res => (finish = res)) : respond(call)))
    const user = setup()
    const view = renderScreen()
    await reachEnquiry(user)
    expect(localStorage.getItem('qtech.rfqs.intakeDraft.u1')).not.toBeNull()
    await user.click(await screen.findByRole('button', { name: 'Copy message for 1 supplier' }))
    view.unmount()
    finish({ data: { id: 'rfq-id', created: true } })
    await waitFor(() => expect(localStorage.getItem('qtech.rfqs.intakeDraft.u1')).toBeNull())
  })

  it('a save that finds the RFQ already saved says so: Open it, nothing claimed as sent', async () => {
    installFakeDb(call => (call.target === 'rpc:float_rfq' ? { data: { id: 'rfq-id', created: false } } : respond(call)))
    const user = setup()
    renderScreen()
    await reachEnquiry(user)
    await user.click(await screen.findByRole('button', { name: 'Copy message for 1 supplier' }))
    expect(await screen.findByText('Already saved as RFQ-0185')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Open RFQ-0185' })).toHaveAttribute('href', '/rfqs/rfq-id')
    expect(screen.queryByText(/is waiting for prices/)).toBeNull()
    expect(localStorage.getItem('qtech.rfqs.intakeDraft.u1')).toBeNull()
  })

  it('keeps nothing on the device with nobody signed in (signing out)', async () => {
    installFakeDb(respond)
    const user = setup()
    renderScreen('/rfqs/new', { status: 'signed-out' })
    await user.type(screen.getByRole('textbox', { name: 'Customer reference' }), 'ENQ-9')
    expect(Object.keys(localStorage).filter(k => k.startsWith('qtech.rfqs.intakeDraft.'))).toEqual([])
  })

  it('asks before leaving with items on the form: Stay here keeps the screen, Leave goes on and keeps the draft', async () => {
    installFakeDb(respond)
    const user = setup()
    renderScreen()
    await startDraft(user)
    await user.click(screen.getByRole('link', { name: 'Today' }))
    const dialog = await screen.findByRole('dialog', { name: 'Leave this new RFQ?' })
    expect(dialog).toHaveTextContent('Acme Plastics, 2 items')
    await user.click(within(dialog).getByRole('button', { name: 'Stay here' }))
    expect(screen.getByRole('heading', { name: 'New RFQ', level: 1 })).toBeInTheDocument()
    await user.click(screen.getByRole('link', { name: 'Today' }))
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Leave, keep the draft' }))
    expect(await screen.findByRole('heading', { name: 'Today page' })).toBeInTheDocument()
    expect(localStorage.getItem('qtech.rfqs.intakeDraft.u1')).toContain('Hach HQ1110 portable meter')
  })

  it('a saved RFQ leaves no draft behind, and the screen no longer asks before leaving', async () => {
    installFakeDb(respond)
    const user = setup()
    renderScreen()
    await reachEnquiry(user)
    expect(localStorage.getItem('qtech.rfqs.intakeDraft.u1')).not.toBeNull()
    await user.click(await screen.findByRole('button', { name: 'Copy message for 1 supplier' }))
    await screen.findByText(/is waiting for prices/)
    await waitFor(() => expect(localStorage.getItem('qtech.rfqs.intakeDraft.u1')).toBeNull())
    await user.click(screen.getByRole('link', { name: 'Today' }))
    expect(await screen.findByRole('heading', { name: 'Today page' })).toBeInTheDocument()
  })

  it('shows the step it is on as one line (for phones), and the customer reference sits with the company', async () => {
    installFakeDb(respond)
    setup()
    renderScreen()
    // R2-09: no "This RFQ" or "Progress" side boxes; the step line is the only progress shown, at every width.
    expect(screen.queryByRole('complementary', { name: 'This RFQ' })).toBeNull()
    expect(screen.queryByRole('heading', { name: 'Progress' })).toBeNull()
    const line = screen.getByRole('list', { name: 'Step 1 of 4' })
    expect(line.className).not.toMatch(/hidden/)
    expect(within(line).getAllByRole('listitem').map(li => li.textContent?.replace(/,.*$/, ''))).toEqual(['Items', 'Suppliers', 'Message', 'Done'])
    const customer = screen.getByRole('region', { name: 'Customer' })
    expect(within(customer).getByRole('textbox', { name: 'Customer reference' })).toBeInTheDocument()
  })

  describe('a document that is not an enquiry', () => {
    const PO = ['Example Mills Ltd', 'PURCHASE ORDER', 'PO No: EM-PO-20114', 'Vendor: Q-Tech Engineering', 'Payment Terms: 30 days', '1) Hach HQ1110 portable meter - 1 no', '2) 24V actuator for ball valve x 2', 'Terms and Conditions: please acknowledge receipt of this order.', 'Authorised Signatory'].join('\n')
    const OWN_QUOTE = ['Q-Tech Engineering', 'Quotation', 'Quotation no. QT-26-0042', '#\tDescription\tQty\tUnit Pr. (PKR)\tTotal (PKR)', '1\tHach HQ1110 portable meter\t1\t4,500.00\t4,500.00', '2\tActuator 24V\t2\t9,000.00\t18,000.00', 'Sub Total\t22,500.00'].join('\n')

    it('warns about a purchase order, adds no items, and reads it as an enquiry when asked', async () => {
      installFakeDb(respond)
      const user = setup()
      renderScreen()
      fireEvent.paste(document.body, { clipboardData: { getData: () => PO } })
      expect(await screen.findByText('This looks like a purchase order, not an enquiry.')).toBeInTheDocument()
      expect(screen.getByText(/No items were added/)).toBeInTheDocument()
      expect(screen.queryByRole('textbox', { name: 'Description of item 1' })).toBeNull()
      expect(screen.queryByText(/items? found/)).toBeNull()
      // Plain text, 16px or larger: the warning and its button use the large text size.
      expect(screen.getByRole('status', { name: '' }).className).toMatch(/text-base/)
      await user.click(screen.getByRole('button', { name: 'Read as an enquiry anyway' }))
      expect(await screen.findByRole('textbox', { name: 'Description of item 1' })).toHaveValue('Hach HQ1110 portable meter')
      expect(screen.queryByText('This looks like a purchase order, not an enquiry.')).toBeNull()
    })

    it('says so when it is our own quotation, not the header cells as items', async () => {
      installFakeDb(respond)
      setup()
      renderScreen()
      fireEvent.paste(document.body, { clipboardData: { getData: () => OWN_QUOTE } })
      expect(await screen.findByText('This looks like your own quotation, not an enquiry.')).toBeInTheDocument()
      expect(screen.queryByRole('textbox', { name: 'Description of item 1' })).toBeNull()
      expect(screen.getByRole('button', { name: 'Read as an enquiry anyway' })).toBeInTheDocument()
    })

    it('a paste it cannot place (unknown) shows no warning and is never held back', async () => {
      installFakeDb(respond)
      setup()
      renderScreen()
      fireEvent.paste(document.body, { clipboardData: { getData: () => 'hello, call me when you are free' } })
      await screen.findByRole('textbox', { name: 'Customer reference' })
      expect(screen.queryByText(/This looks like/)).toBeNull()
      expect(screen.queryByRole('button', { name: 'Read as an enquiry anyway' })).toBeNull()
    })

    it('a real enquiry shows no warning', async () => {
      installFakeDb(respond)
      setup()
      renderScreen()
      fireEvent.paste(document.body, { clipboardData: { getData: () => EMAIL } })
      expect(await screen.findByText('2 items found')).toBeInTheDocument()
      expect(screen.queryByText(/This looks like/)).toBeNull()
      expect(screen.queryByRole('button', { name: 'Read as an enquiry anyway' })).toBeNull()
    })
  })
})
