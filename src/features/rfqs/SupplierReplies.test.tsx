import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SessionContext } from '@/app/session'
import type { InquiryRow, RfqHeader, RfqItemRow } from '@/features/rfqs/api'
import { SupplierReplyDialog } from '@/features/rfqs/SupplierReplies'
import { installFakeDb, opArgs, type FakeCall } from '@/test/fakeSupabase'
import { ToastProvider } from '@/ui/Toast'

/* One supplier's reply, in its dialog (R07; grade-B R2): Enter in a price box saves the reply once; closing with prices typed asks first. */

afterEach(() => {
  installFakeDb(() => ({})).uninstall()
})

const rfq = { id: 'r-1', number: 185, company: { id: 'c-1', name: 'Acme Plastics' } } as unknown as RfqHeader
const items: RfqItemRow[] = [{ id: 'it-1', number: 1, description: 'Hach HQ1110 meter', brandId: null, brandName: null, familyId: null, qty: 1, unit: 'pcs' }]
const inquiry: InquiryRow = {
  id: 'i-1',
  supplierId: 's-1',
  supplierName: 'Orient Analytical',
  supplierCountry: 'Pakistan',
  sentOn: '2026-10-01',
  lastChasedOn: null,
  lastRelayedAt: null,
  noOfferOn: null,
  noOfferReason: null,
  itemDeclines: {},
  chaseCount: 0,
  notes: null,
  contactName: null,
  contactPhone: null,
  lastCurrency: 'PKR',
  responseState: 'awaiting',
  contactState: null,
  itemsQuoted: 0,
  lines: [],
}

function renderDialog(onClose: () => void = () => undefined, list: RfqItemRow[] = items) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <SessionContext.Provider value={{ status: 'signed-in', user: { id: 'u1', name: 'Ayesha Rana', role: 'sales' } }}>
        <MemoryRouter>
          <ToastProvider>
            <SupplierReplyDialog rfq={rfq} items={list} inquiry={inquiry} inquiries={[inquiry]} rates={{}} onClose={onClose} />
          </ToastProvider>
        </MemoryRouter>
      </SessionContext.Provider>
    </QueryClientProvider>,
  )
}

describe('SupplierReplyDialog', () => {
  it('opens with the cursor in the first price box; pressing Enter again while saving does not save a second time', async () => {
    const writes: FakeCall[] = []
    let release: () => void = () => undefined
    const held = new Promise<void>(r => (release = r))
    installFakeDb(async call => {
      if (call.target === 'supplier_quote_lines' && call.verb === 'upsert') {
        writes.push(call)
        await held
      }
      return { data: [] }
    })
    const user = userEvent.setup()
    const onClose = vi.fn()
    renderDialog(onClose)
    const box = screen.getByRole('textbox', { name: 'Price for item 1 from Orient Analytical' })
    expect(box).toHaveFocus()
    await user.type(box, '1500')
    await user.type(screen.getByRole('textbox', { name: 'Lead time, item 1 from Orient Analytical' }), '2 weeks')
    await user.type(screen.getByRole('textbox', { name: 'Weight of one unit, item 1 from Orient Analytical' }), '1.5')
    await user.click(box)
    await user.keyboard('{Enter}')
    await waitFor(() => expect(writes).toHaveLength(1))
    await user.keyboard('{Enter}')
    await user.keyboard('{Enter}')
    release()
    await waitFor(() => expect(screen.getAllByText('Reply saved').length).toBeGreaterThan(0))
    expect(writes).toHaveLength(1)
    expect(onClose).toHaveBeenCalled() // saved: the dialog closes
  })

  it('refuses to save a priced item without its lead time and weight, says which under each box, and puts the cursor in the first', async () => {
    const writes: FakeCall[] = []
    installFakeDb(call => {
      if (call.target === 'supplier_quote_lines' && call.verb === 'upsert') writes.push(call)
      return { data: [] }
    })
    const user = userEvent.setup()
    const onClose = vi.fn()
    renderDialog(onClose)
    await user.type(screen.getByRole('textbox', { name: 'Price for item 1 from Orient Analytical' }), '1500')
    await user.click(screen.getByRole('button', { name: 'Save reply' }))
    const lead = screen.getByRole('textbox', { name: 'Lead time, item 1 from Orient Analytical' })
    const weight = screen.getByRole('textbox', { name: 'Weight of one unit, item 1 from Orient Analytical' })
    await waitFor(() => expect(lead).toHaveFocus())
    expect(lead).toHaveAttribute('aria-invalid', 'true')
    expect(lead).toHaveAccessibleDescription('Add the lead time, for example 2 weeks or ex-stock.')
    expect(weight).toHaveAttribute('aria-invalid', 'true')
    expect(weight).toHaveAccessibleDescription('Add the weight of one unit, above zero.')
    expect(screen.getByText('One priced item still needs a lead time or a weight. Add it, then save the reply.')).toBeInTheDocument()
    expect(writes).toHaveLength(0)
    expect(onClose).not.toHaveBeenCalled()

    // The lead time alone is not enough: the cursor goes on to the weight.
    await user.type(lead, 'Ex-stock')
    expect(lead).not.toHaveAttribute('aria-invalid')
    await user.click(screen.getByRole('button', { name: 'Save reply' }))
    await waitFor(() => expect(weight).toHaveFocus())
    expect(writes).toHaveLength(0)

    await user.type(weight, '0.75')
    await user.selectOptions(screen.getByRole('combobox', { name: 'Weight unit, item 1 from Orient Analytical' }), 'lb')
    await user.click(screen.getByRole('button', { name: 'Save reply' }))
    await waitFor(() => expect(writes).toHaveLength(1))
    const rows = opArgs(writes[0], 'upsert')?.[0] as Record<string, unknown>[]
    expect(rows).toEqual([expect.objectContaining({ rfq_item_id: 'it-1', unit_price: 1500, lead_time: 'Ex-stock', weight: 0.75, weight_unit: 'lb' })])
    expect(onClose).toHaveBeenCalled()
  })

  it('a weight typed after a refused save is not left marked invalid while another item still misses one (review shot, 16 Nov)', async () => {
    installFakeDb(() => ({ data: [] }))
    const user = userEvent.setup()
    const two: RfqItemRow[] = [...items, { id: 'it-2', number: 2, description: 'Pressure transmitter 0-10 bar', brandId: null, brandName: null, familyId: null, qty: 2, unit: 'nos' }]
    renderDialog(undefined, two)
    const box = (label: string) => screen.getByRole('textbox', { name: `${label} from Orient Analytical` })
    await user.type(box('Price for item 1'), '1250')
    await user.type(box('Lead time, item 1'), '6 weeks')
    await user.type(box('Price for item 2'), '480')
    await user.click(screen.getByRole('button', { name: 'Save reply' }))
    const w1 = box('Weight of one unit, item 1')
    await waitFor(() => expect(w1).toHaveFocus())
    expect(w1).toHaveAttribute('aria-invalid', 'true')
    await user.click(screen.getByRole('button', { name: 'Same for all items' }))
    await user.type(w1, '3.4')
    await user.click(box('Lead time, item 1')) // the box loses the cursor, as in the review shot
    expect(w1).toHaveValue('3.4')
    expect(w1).not.toHaveAttribute('aria-invalid')
    expect(w1).not.toHaveAttribute('aria-describedby')
    expect(screen.queryAllByText('Add the weight of one unit, above zero.')).toHaveLength(1) // item 2 only
    expect(box('Weight of one unit, item 2')).toHaveAttribute('aria-invalid', 'true')
    expect(box('Lead time, item 2')).not.toHaveAttribute('aria-invalid')
    expect(screen.getByText('One priced item still needs a lead time or a weight. Add it, then save the reply.')).toBeInTheDocument()
  })

  it('asks nothing of an item with no price: only the priced items need a lead time and weight', async () => {
    installFakeDb(() => ({ data: [] }))
    const user = userEvent.setup()
    renderDialog()
    // Nothing typed: no problem is shown under the lead time or the weight.
    expect(screen.getByRole('textbox', { name: 'Lead time, item 1 from Orient Analytical' })).not.toHaveAttribute('aria-invalid')
    expect(screen.queryByText(/Add the lead time/)).toBeNull()
    expect(screen.getByRole('button', { name: 'Save reply' })).toBeDisabled()
    await user.type(screen.getByRole('textbox', { name: 'Lead time, item 1 from Orient Analytical' }), '2 weeks')
    expect(screen.queryByText(/Add the weight/)).toBeNull()
  })

  it("the five Cannot quote reasons sit behind one menu, not five buttons", async () => {
    installFakeDb(() => ({ data: [] }))
    const user = userEvent.setup()
    renderDialog()
    expect(screen.queryByRole('button', { name: "Does not carry this brand" })).toBeNull()
    await user.click(screen.getByRole('button', { name: "Cannot quote, Orient Analytical" }))
    expect(await screen.findByRole('menuitem', { name: "Does not carry this brand" })).toBeInTheDocument()
  })

  it('closing with prices typed and not saved asks first; Keep editing keeps them', async () => {
    installFakeDb(() => ({ data: [] }))
    const user = userEvent.setup()
    const onClose = vi.fn()
    renderDialog(onClose)
    await user.type(screen.getByRole('textbox', { name: 'Price for item 1 from Orient Analytical' }), '1500')
    await user.click(within(screen.getByRole('dialog', { name: 'Orient Analytical' })).getByRole('button', { name: 'Close' }))
    await user.click(await screen.findByRole('button', { name: 'Keep editing' }))
    expect(screen.getByRole('textbox', { name: 'Price for item 1 from Orient Analytical' })).toHaveValue('1,500')
    expect(onClose).not.toHaveBeenCalled()
    await user.click(within(screen.getByRole('dialog', { name: 'Orient Analytical' })).getByRole('button', { name: 'Close' }))
    await user.click(await screen.findByRole('button', { name: 'Discard' }))
    expect(onClose).toHaveBeenCalled()
  })

  it('closing with nothing typed closes at once', async () => {
    installFakeDb(() => ({ data: [] }))
    const user = userEvent.setup()
    const onClose = vi.fn()
    renderDialog(onClose)
    await user.click(within(screen.getByRole('dialog', { name: 'Orient Analytical' })).getByRole('button', { name: 'Close' }))
    expect(onClose).toHaveBeenCalled()
  })

  it('HW-48: a price that is not a number says why next to the box; "PKR 1,200/-" is read as 1200', async () => {
    installFakeDb(() => ({ data: [] }))
    const user = userEvent.setup()
    renderDialog()
    const box = screen.getByRole('textbox', { name: 'Price for item 1 from Orient Analytical' })
    await user.type(box, '-5')
    expect(screen.getByText("A price cannot be below zero.")).toBeInTheDocument()
    expect(box).toHaveAttribute('aria-invalid', 'true')
    // The typed text is replaced in one go (selected, then typed over), as a person does; the box is never left empty between.
    await user.type(box, 'about 12', { initialSelectionStart: 0, initialSelectionEnd: 2 })
    expect(screen.getByText('Type the price as a number, like 1200.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Save reply' })).toBeDisabled()
    await user.type(box, 'PKR 1,200/-', { initialSelectionStart: 0, initialSelectionEnd: 8 })
    expect(screen.queryByText(/Type the price as a number/)).toBeNull()
    expect(screen.getByRole('button', { name: 'Save reply' })).toBeEnabled()
    await user.tab()
    expect(box).toHaveValue('1,200')
  })

  it('warns when the pasted document is an enquiry or our own quotation, takes no prices, and reads it anyway when asked', async () => {
    installFakeDb(() => ({ data: [] }))
    const user = userEvent.setup()
    renderDialog()
    await user.click(screen.getByRole('button', { name: 'Paste reply' }))
    const enquiry = ['Dear Sir, please quote:', '1) Hach HQ1110 meter - 1 no', 'Regards, K'].join('\n')
    fireEvent.paste(await screen.findByRole('textbox', { name: 'Paste what they sent' }), { clipboardData: { getData: () => enquiry } })
    const title = await screen.findByText('This looks like an enquiry, not a quotation from Orient Analytical.')
    expect(title.closest('[role="status"]')?.className).toMatch(/text-base/)
    expect(screen.getByText(/No prices were taken from it/)).toBeInTheDocument()
    expect(screen.queryByRole('textbox', { name: 'Paste what they sent' })).toBeNull()
    await user.click(screen.getByRole('button', { name: 'Read as a quotation anyway' }))
    await waitFor(() => expect(screen.queryByText(/This looks like an enquiry/)).toBeNull())
    expect(screen.queryByRole('button', { name: 'Read as a quotation anyway' })).toBeNull()
  })

  it('does not warn about a paste it cannot place (unknown)', async () => {
    installFakeDb(() => ({ data: [] }))
    const user = userEvent.setup()
    renderDialog()
    await user.click(screen.getByRole('button', { name: 'Paste reply' }))
    fireEvent.paste(await screen.findByRole('textbox', { name: 'Paste what they sent' }), { clipboardData: { getData: () => 'ok, noted' } })
    await waitFor(() => expect(screen.queryByRole('textbox', { name: 'Paste what they sent' })).toBeNull())
    expect(screen.queryByText(/This looks like/)).toBeNull()
    expect(screen.queryByRole('button', { name: 'Read as a quotation anyway' })).toBeNull()
  })

  it("does not warn about a supplier's quotation", async () => {
    installFakeDb(() => ({ data: [] }))
    const user = userEvent.setup()
    renderDialog()
    await user.click(screen.getByRole('button', { name: 'Paste reply' }))
    const quote = ['Dear Wasif,', 'Our offer as below:', '1. Hach HQ1110 meter USD 95 /pc', 'Delivery: 3-5 days', 'Offer valid for 15 days'].join('\n')
    fireEvent.paste(await screen.findByRole('textbox', { name: 'Paste what they sent' }), { clipboardData: { getData: () => quote } })
    await waitFor(() => expect(screen.queryByRole('textbox', { name: 'Paste what they sent' })).toBeNull())
    expect(screen.queryByText(/This looks like/)).toBeNull()
  })

  it("each item has a visible Cannot offer toggle; a reason is saved as that item's decline", async () => {
    const writes: FakeCall[] = []
    installFakeDb(call => {
      if (call.target === 'inquiry_item_declines') writes.push(call)
      return { data: [] }
    })
    const user = userEvent.setup()
    renderDialog()
    expect(screen.queryByText('A different reason for one item')).toBeNull()
    await user.click(screen.getByRole('button', { name: 'Cannot offer item 1 from Orient Analytical' }))
    await user.click(await screen.findByRole('menuitem', { name: 'Item discontinued' }))
    await waitFor(() => expect(writes).toHaveLength(1))
    expect(writes[0].verb).toBe('upsert')
  })
})
