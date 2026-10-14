import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SessionContext } from '@/app/session'
import IntakeScreen from '@/features/rfqs/IntakeScreen'
import { installFakeDb, opArgs, type FakeCall } from '@/test/fakeSupabase'
import { ToastProvider } from '@/ui/Toast'

/*
 * The intake screen's flow with a scripted database (R05): what is called, in what order, and how often. The real
 * queries, the RPC and Row Level Security are proven against the real database by the Playwright `rfqs` project.
 */

const EMAIL = ['Dear Sir, please quote:', '1) Hach HQ1110 portable meter - 1 no', '2) 24V actuator for ball valve x 2', 'Regards, K'].join('\n')

let copied: string[] = []

function respond(call: FakeCall) {
  const ilike = call.ops.some(([n]) => n === 'ilike')
  switch (call.target) {
    case 'brands':
      return { data: [{ id: 'b-hach', name: 'Hach', kind: 'brand' }] }
    case 'companies':
      return ilike
        ? { data: [{ id: 'c-acme', name: 'Acme Plastics', country: 'Pakistan' }] }
        : { data: [{ id: 'c-acme', name: 'Acme Plastics', country: 'Pakistan' }, { id: 's-orient', name: 'Orient Analytical', country: 'Pakistan' }] }
    case 'v_company_roles':
    case 'company_sites':
    case 'contacts':
      return { data: [] }
    case 'v_supplier_stats':
      return {
        data: [
          { supplier_id: 's-orient', asked: 8, replied: 7, no_offer: 0, median_reply_days: 1, last_contact: '2026-11-03', brand_ids: ['b-hach'], brand_names: ['Hach'] },
        ],
      }
    case 'rpc:supplier_item_memory': {
      const args = (opArgs(call, 'args')?.[0] ?? {}) as { p_description?: string }
      return { data: /hach/i.test(args.p_description ?? '') ? [{ supplier_id: 's-orient', best_tier: 0, supplied_before: true }] : [] }
    }
    case 'rpc:float_rfq':
      return { data: 'rfq-id' }
    case 'rfqs':
      return { data: { id: 'rfq-id', number: 185 } }
    case 'rpc:set_rfq_floated':
      return { data: 1 }
    default:
      return { data: [] }
  }
}

function renderScreen() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <SessionContext.Provider value={{ status: 'signed-in', user: { id: 'u1', name: 'Ayesha Rana', role: 'sales' } }}>
        <MemoryRouter initialEntries={['/rfqs/new']}>
          <ToastProvider>
            <IntakeScreen />
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
  await user.click(screen.getByRole('button', { name: 'Write the enquiry' }))
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
    expect(screen.getByRole('textbox', { name: 'Quantity of item 2' })).toHaveValue('2')
    // Brand picked from the description.
    await waitFor(() => expect(within(screen.getByRole('combobox', { name: 'Brand of item 1' })).getByRole('option', { selected: true })).toHaveTextContent('Hach'))

    await user.click(screen.getByRole('button', { name: 'Looks right: find suppliers' }))
    expect(await screen.findByRole('checkbox', { name: 'Orient Analytical' })).toBeChecked()
    expect(screen.getByText(/Item 2, .* has no supplier ticked\./)).toBeInTheDocument()
  })

  it('Copy & mark floated copies the text with the real RFQ number and floats once, even on a double tap', async () => {
    const db = installFakeDb(respond)
    const user = setup()
    renderScreen()
    await reachEnquiry(user)

    const button = await screen.findByRole('button', { name: 'Copy & mark floated to 1' })
    await user.dblClick(button)

    expect(await screen.findByText(/is out for prices/)).toBeInTheDocument()
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
    await user.click(await screen.findByRole('button', { name: 'Copy & mark floated to 1' }))
    await screen.findByText(/is out for prices/)

    await user.click(await screen.findByRole('button', { name: /Undo/ }))
    await waitFor(() => expect(db.calls.some(c => c.target === 'rpc:set_rfq_floated')).toBe(true))
    const undo = db.calls.find(c => c.target === 'rpc:set_rfq_floated') as FakeCall
    expect(opArgs(undo, 'args')?.[0]).toEqual({ p_rfq_id: 'rfq-id', p_floated: false })
    expect((await screen.findAllByText('Float undone')).length).toBeGreaterThan(0)
    // Back on the enquiry, ready to copy again: that floats the saved RFQ, it does not create a second one.
    await user.click(screen.getByRole('button', { name: 'Copy & mark floated to 1' }))
    await screen.findByText(/is out for prices/)
    expect(db.calls.filter(c => c.target === 'rpc:float_rfq')).toHaveLength(1)
    expect(db.calls.filter(c => c.target === 'rpc:set_rfq_floated').map(c => (opArgs(c, 'args')?.[0] as { p_floated: boolean }).p_floated)).toEqual([false, true])
  })

  it('Save without floating keeps the supplier shortlisted (p_mark_sent false)', async () => {
    const db = installFakeDb(respond)
    const user = setup()
    renderScreen()
    await user.type(screen.getByRole('combobox', { name: 'Company' }), 'Acme')
    await user.click(await screen.findByRole('option', { name: /Acme Plastics/ }))
    fireEvent.paste(document.body, { clipboardData: { getData: () => EMAIL } })
    await screen.findByText('2 items found')
    await user.click(screen.getByRole('button', { name: 'Looks right: find suppliers' }))
    await waitFor(() => expect(screen.getByRole('checkbox', { name: 'Orient Analytical' })).toBeChecked())
    await user.click(screen.getByRole('button', { name: 'Save without floating' }))
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
    await user.click(await screen.findByRole('button', { name: 'Copy & mark floated to 1' }))
    expect(await screen.findByRole('alert')).toBeInTheDocument()
    expect(screen.queryByText(/is out for prices/)).toBeNull()
  })
})
