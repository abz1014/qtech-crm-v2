import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SessionContext } from '@/app/session'
import type { InquiryRow, RfqHeader, RfqItemRow } from '@/features/rfqs/api'
import { SupplierReplyDialog } from '@/features/rfqs/SupplierReplies'
import { installFakeDb, type FakeCall } from '@/test/fakeSupabase'
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

function renderDialog(onClose: () => void = () => undefined) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <SessionContext.Provider value={{ status: 'signed-in', user: { id: 'u1', name: 'Ayesha Rana', role: 'sales' } }}>
        <MemoryRouter>
          <ToastProvider>
            <SupplierReplyDialog rfq={rfq} items={items} inquiry={inquiry} inquiries={[inquiry]} rates={{}} onClose={onClose} />
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
    await user.keyboard('{Enter}')
    await waitFor(() => expect(writes).toHaveLength(1))
    await user.keyboard('{Enter}')
    await user.keyboard('{Enter}')
    release()
    await waitFor(() => expect(screen.getAllByText('Reply saved').length).toBeGreaterThan(0))
    expect(writes).toHaveLength(1)
    expect(onClose).toHaveBeenCalled() // saved: the dialog closes
  })

  it("the five Can't quote reasons sit behind one menu, not five buttons", async () => {
    installFakeDb(() => ({ data: [] }))
    const user = userEvent.setup()
    renderDialog()
    expect(screen.queryByRole('button', { name: "Doesn't carry this brand" })).toBeNull()
    await user.click(screen.getByRole('button', { name: "Can't quote, Orient Analytical" }))
    expect(await screen.findByRole('menuitem', { name: "Doesn't carry this brand" })).toBeInTheDocument()
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
    expect(screen.getByText("A price can't be below zero.")).toBeInTheDocument()
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
})
