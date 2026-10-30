import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SessionContext, type SessionState } from '@/app/session'
import type { ClarificationRow, InquiryRow, RfqItemRow } from '@/features/rfqs/api'
import AddToJob from '@/features/jobs/AddToJob'
import type { JobRow } from '@/features/jobs/api'
import { allowedKinds, guessKind, matchSupplier } from '@/features/jobs/addToJob/model'
import { installFakeDb, opArgs, type FakeCall } from '@/test/fakeSupabase'
import { ToastProvider } from '@/ui/Toast'

const kept = vi.hoisted(() => ({ deleted: [] as string[], items: {} as Record<string, { id: string; text: string; files: never[] }> }))
vi.mock('@/lib/capture/store', async importOriginal => {
  const real = await importOriginal<typeof import('@/lib/capture/store')>()
  return { ...real, getCapture: (id: string) => Promise.resolve(kept.items[id] ?? null), deleteCapture: (id: string) => { kept.deleted.push(id); return Promise.resolve() } }
})

const state = vi.hoisted(() => ({
  inquiries: [] as unknown[],
  items: [] as unknown[],
  clars: [] as unknown[],
}))
vi.mock('@/features/rfqs/hooks', async importOriginal => {
  const real = await importOriginal<typeof import('@/features/rfqs/hooks')>()
  const q = (data: () => unknown) => () => ({ data: data(), isPending: false, isError: false })
  return { ...real, useRfqInquiries: q(() => state.inquiries), useRfqItems: q(() => state.items), useClarifications: q(() => state.clars) }
})

const SUPPLIERS = [
  { id: 'i-rhein', name: 'Rhein Automation GmbH' },
  { id: 'i-shanghai', name: 'Shanghai Flowtech Co.' },
]

describe('Add to this job: the guess', () => {
  const ctx = { money: true, hasRfq: true, suppliers: SUPPLIERS, openQuestions: 0 }
  it('a message with two or more prices is a supplier price; a picture alone is a photo; the rest is a note', () => {
    expect(guessKind({ text: 'Rhein: item 1 EUR 3,610, item 2 EUR 980, 8 weeks', files: [] }, ctx)).toBe('price')
    expect(guessKind({ text: '', files: [{ name: 'site.jpg', type: 'image/jpeg' }] }, ctx)).toBe('photo')
    expect(guessKind({ text: 'Gate pass needed after 3pm', files: [] }, ctx)).toBe('note')
    expect(guessKind({ text: '', files: [{ name: 'po.pdf', type: 'application/pdf' }] }, ctx)).toBe('note')
  })
  it('a message while a question is waiting is the customer answer', () => {
    expect(guessKind({ text: 'Line size is 4 inch, PN16', files: [] }, { ...ctx, openQuestions: 2 })).toBe('answer')
  })
  it('an engineer can add only a photo or a note, never a price, whatever the text says', () => {
    const eng = { money: false, hasRfq: true, suppliers: [], openQuestions: 3 }
    expect(allowedKinds(eng)).toEqual(['photo', 'note'])
    expect(guessKind({ text: 'EUR 3,610 and EUR 980', files: [] }, eng)).toBe('note')
  })
  it('a direct order (no enquiry) has no suppliers or questions to add to', () => {
    expect(allowedKinds({ money: true, hasRfq: false, suppliers: [], openQuestions: 0 })).toEqual(['photo', 'note'])
  })
  it('matches the supplier by a word of its name, the only one asked, or none when it is a tie', () => {
    expect(matchSupplier('Hi, Rhein here. Price EUR 100', SUPPLIERS)?.id).toBe('i-rhein')
    expect(matchSupplier('prices below', SUPPLIERS)).toBeNull()
    expect(matchSupplier('anything', [SUPPLIERS[1]])?.id).toBe('i-shanghai')
    expect(matchSupplier('Rhein and Shanghai both', SUPPLIERS)).toBeNull()
  })
})

const JOB: JobRow = {
  key: '139',
  kind: 'enquiry',
  rfqId: 'r-1',
  orderId: null,
  companyId: 'c-1',
  companyName: 'Acme Plastics',
  siteName: null,
  ownerId: 'u1',
  ownerName: 'A',
  items: 'x',
  stage: 'enquiry',
  stageDetail: null,
  isHistory: false,
  lastActivityOn: null,
  repeatOf: null,
  cancelledOrders: 0,
  engineerIds: [],
}
const ITEMS: RfqItemRow[] = [
  { id: 'it-1', number: 1, description: 'Ultrasonic flowmeter RST 1158S', brandId: null, brandName: null, familyId: null, qty: 2, unit: 'nos' },
  { id: 'it-2', number: 2, description: 'Clamp-on transducer pair DN50', brandId: null, brandName: null, familyId: null, qty: 2, unit: 'sets' },
]
const inquiry = (id: string, name: string, country = 'Germany'): InquiryRow =>
  ({
    id,
    supplierId: `s-${id}`,
    supplierName: name,
    supplierCountry: country,
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
    lastCurrency: null,
    responseState: 'awaiting',
    contactState: null,
    itemsQuoted: 0,
    lines: [],
  }) as InquiryRow

function mount(role: 'sales' | 'engineer' = 'sales', clars: Partial<ClarificationRow>[] = [], handoff?: unknown, respond?: (c: FakeCall) => { data?: unknown; error?: { message: string } }) {
  state.inquiries = role === 'engineer' ? [] : [inquiry('i-rhein', 'Rhein Automation GmbH'), inquiry('i-shanghai', 'Shanghai Flowtech Co.', 'China')]
  state.items = ITEMS
  state.clars = clars
  if (handoff) {
    const h = handoff as { text: string; captureId: string; gone?: boolean }
    if (!h.gone) kept.items[h.captureId] = { id: h.captureId, text: h.text, files: [] }
  }
  const db = installFakeDb((c: FakeCall) => respond?.(c) ?? (c.target === 'rfqs' && c.verb === 'select' ? { data: { notes: null, updated_at: 'T1' } } : { data: c.verb === 'update' ? [{ id: 'r-1' }] : [] }))
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  const session: SessionState = { status: 'signed-in', user: { id: 'u1', name: 'Ayesha Rana', role } }
  const view = render(
    <QueryClientProvider client={client}>
      <SessionContext.Provider value={session}>
        <MemoryRouter initialEntries={[handoff ? `/jobs/139?shared=${(handoff as { captureId: string }).captureId}` : '/jobs/139']}>
          <ToastProvider>
            <AddToJob job={{ job: JOB, role, money: role !== 'engineer' }} />
          </ToastProvider>
        </MemoryRouter>
      </SessionContext.Provider>
    </QueryClientProvider>,
  )
  return { db, user: userEvent.setup(), unmount: view.unmount }
}

afterEach(() => {
  installFakeDb(() => ({})).uninstall()
  kept.deleted.length = 0
  kept.items = {}
})

const WHATSAPP = ['Rhein Automation: dear Ayesha,', '1) Ultrasonic flowmeter RST 1158S EUR 3610 - 8 weeks', '2) Clamp-on transducer pair DN50 EUR 980 - 8 weeks'].join('\n')

describe('Add to this job: a supplier price', () => {
  it('a pasted WhatsApp price is read, matched to the supplier, and "Accept 2 prices" saves it to that supplier', async () => {
    const { db, user } = mount()
    fireEvent.change(screen.getByRole('textbox', { name: 'Paste here' }), { target: { value: WHATSAPP } })
    expect(await screen.findByTestId('guess-line')).toHaveTextContent('Supplier price from Rhein Automation GmbH')
    const accept = await screen.findByRole('button', { name: /Accept \d+ prices?/ })
    await waitFor(() => expect(accept).toHaveTextContent('Accept 2 prices'))
    await user.click(accept)
    await waitFor(() => expect(db.calls.some(c => c.target === 'supplier_quote_lines' && c.verb === 'upsert')).toBe(true))
    const rows = opArgs(db.calls.find(c => c.target === 'supplier_quote_lines' && c.verb === 'upsert') as FakeCall, 'upsert')?.[0] as { inquiry_id: string; rfq_item_id: string; unit_price: number; currency: string }[]
    expect(rows.map(r => [r.inquiry_id, r.rfq_item_id, r.unit_price, r.currency])).toEqual([
      ['i-rhein', 'it-1', 3610, 'EUR'],
      ['i-rhein', 'it-2', 980, 'EUR'],
    ])
  })

  it('"Change" corrects the guess to a note, and Add note appends it to the RFQ notes with the author', async () => {
    const { db, user } = mount()
    fireEvent.change(screen.getByRole('textbox', { name: 'Paste here' }), { target: { value: WHATSAPP } })
    await screen.findByTestId('guess-line')
    await user.click(screen.getByRole('button', { name: 'Note' }))
    expect(screen.getByTestId('guess-line')).toHaveTextContent('Note')
    await user.click(screen.getByRole('button', { name: 'Add note' }))
    await waitFor(() => expect(db.calls.some(c => c.target === 'rfqs' && c.verb === 'update')).toBe(true))
    const patch = opArgs(db.calls.find(c => c.target === 'rfqs' && c.verb === 'update') as FakeCall, 'update')?.[0] as { notes: string }
    expect(patch.notes).toContain('Ayesha Rana')
    expect(patch.notes).toContain('Rhein Automation: dear Ayesha')
  })
})

describe('Add to this job: the customer answer and the engineer', () => {
  it('a message while a question waits is guessed as the answer and saved on the ticked question', async () => {
    const { db, user } = mount('sales', [{ id: 'q-1', question: 'What is the line size?', answeredAt: null, withdrawnAt: null }])
    fireEvent.change(screen.getByRole('textbox', { name: 'Paste here' }), { target: { value: 'Line size is 4 inch' } })
    expect(await screen.findByTestId('guess-line')).toHaveTextContent('Customer answer')
    await user.click(screen.getByRole('button', { name: 'Save answer' }))
    await waitFor(() => expect(db.calls.some(c => c.target === 'clarifications' && c.verb === 'update')).toBe(true))
    const patch = opArgs(db.calls.find(c => c.target === 'clarifications' && c.verb === 'update') as FakeCall, 'update')?.[0] as { answer: string }
    expect(patch.answer).toBe('Line size is 4 inch')
  })

  it('an engineer does not see the card at all', () => {
    mount('engineer')
    expect(screen.queryByRole('textbox', { name: 'Paste here' })).toBeNull()
    expect(screen.queryByText(/Add to this job/i)).toBeNull()
  })
})

describe('Add to this job: a kept share is deleted only after the save', () => {
  it('arriving with a shared note does not delete the kept copy; a failed save keeps it; the successful save deletes it', async () => {
    let fail = true
    const { user } = mount('sales', [], { text: 'Gate pass needed after 3pm', files: [], captureId: 'cap-1' }, c => {
      if (c.target === 'rfqs' && c.verb === 'update' && fail) return { error: { message: 'network down' } }
      return c.target === 'rfqs' && c.verb === 'select' ? { data: { notes: null, updated_at: 'T1' } } : { data: [{ id: 'r-1' }] }
    })
    await user.click(await screen.findByRole('button', { name: 'Add note' }))
    await screen.findByText('Could not add it')
    expect(kept.deleted).toEqual([])
    expect(screen.getByRole('textbox', { name: 'Paste here' })).toHaveValue('Gate pass needed after 3pm')
    fail = false
    await user.click(screen.getByRole('button', { name: 'Add note' }))
    await waitFor(() => expect(kept.deleted).toEqual(['cap-1']))
  })

  it('a reload brings the shared item back (read again by its id from the address) and keeps it; Discard deletes it', async () => {
    const first = mount('sales', [], { text: 'Gate pass needed after 3pm', files: [], captureId: 'cap-2' })
    // the box exists before the shared text is put in it: wait for the text, not just the box (slow machines raced here)
    await waitFor(() => expect(screen.getByRole('textbox', { name: 'Paste here' })).toHaveValue('Gate pass needed after 3pm'))
    first.unmount()
    expect(kept.deleted).toEqual([])
    // the same address, a fresh page: the item is read again
    const second = mount('sales', [], { text: 'Gate pass needed after 3pm', files: [], captureId: 'cap-2' })
    await waitFor(() => expect(screen.getByRole('textbox', { name: 'Paste here' })).toHaveValue('Gate pass needed after 3pm'))
    expect(kept.deleted).toEqual([])
    await second.user.click(screen.getByRole('button', { name: 'Discard what was shared' }))
    await waitFor(() => expect(kept.deleted).toEqual(['cap-2']))
    expect(screen.getByRole('textbox', { name: 'Paste here' })).toHaveValue('')
  })

  it('an item that has expired says so in plain words and can be dismissed', async () => {
    const { user } = mount('sales', [], { text: '', files: [], captureId: 'cap-gone', gone: true })
    expect(await screen.findByTestId('shared-gone')).toHaveTextContent('no longer on this device')
    await user.click(screen.getByRole('button', { name: 'Dismiss' }))
    await waitFor(() => expect(screen.queryByTestId('shared-gone')).toBeNull())
  })
})
