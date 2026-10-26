import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { ToastProvider } from '@/ui/Toast'
import { installFakeDb, opArgs, type FakeCall } from '@/test/fakeSupabase'
import { SentConfirm } from '@/features/rfqs/SentConfirm'

/* P3-C2: only "Yes, sent" writes sent_confirmed_at (0097); "Not yet" writes nothing; nothing says Sent before then. */
const inquiry = { id: 'i1', supplierName: 'Rhein Automation', sentOn: '2026-10-26' as string | null, sentConfirmedAt: null as string | null }
let fake: ReturnType<typeof installFakeDb> | null = null
afterEach(() => fake?.uninstall())

function mount(i = inquiry, variant: 'ask' | 'later' = 'ask') {
  fake = installFakeDb((c: FakeCall) => (c.verb === 'update' ? { data: [{ id: 'i1' }] } : { data: [] }))
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <ToastProvider>
        <SentConfirm rfqId="r1" inquiry={i} variant={variant} />
      </ToastProvider>
    </QueryClientProvider>,
  )
}

describe('Did you send it?', () => {
  it('asks, and says nothing is Sent yet', () => {
    mount()
    expect(screen.getByText('Did you send it?')).toBeInTheDocument()
    expect(screen.queryByText('Sent')).toBeNull()
  })

  it('"Yes, sent" stamps sent_confirmed_at on that inquiry only if not stamped before', async () => {
    mount()
    fireEvent.click(screen.getByRole('button', { name: /^Yes, sent/ }))
    await waitFor(() => expect(fake?.calls.some(c => c.target === 'supplier_inquiries' && c.verb === 'update')).toBe(true))
    const call = fake!.calls.find(c => c.target === 'supplier_inquiries' && c.verb === 'update')!
    expect((opArgs(call, 'update')?.[0] as Record<string, unknown>).sent_confirmed_at).toEqual(expect.any(String))
    expect(opArgs(call, 'in')).toEqual(['id', ['i1']])
    expect(call.ops.some(([n, a]) => n === 'is' && a[0] === 'sent_confirmed_at')).toBe(true)
    expect(await screen.findByText(/Sent to Rhein Automation/)).toBeInTheDocument()
  })

  it('"Not yet" writes nothing and leaves it Asked', () => {
    mount()
    fireEvent.click(screen.getByRole('button', { name: /^Not yet/ }))
    expect(fake?.calls.filter(c => c.verb === 'update')).toHaveLength(0)
    expect(screen.getByText('Asked, not sent yet')).toBeInTheDocument()
    expect(screen.queryByText('Sent')).toBeNull()
  })

  it('a confirmed enquiry says Sent and asks nothing; one never asked draws nothing', () => {
    const { unmount } = mount({ ...inquiry, sentConfirmedAt: '2026-10-26T09:00:00Z' })
    expect(screen.getByText('Sent')).toBeInTheDocument()
    expect(screen.queryByText('Did you send it?')).toBeNull()
    unmount()
    mount({ ...inquiry, sentOn: null })
    expect(screen.queryByRole('button')).toBeNull()
    expect(screen.queryByText('Did you send it?')).toBeNull()
  })

  it('the later variant is one quiet Yes, sent', () => {
    mount(inquiry, 'later')
    expect(screen.getByRole('button', { name: /^Yes, sent/ })).toBeInTheDocument()
    expect(screen.queryByText('Did you send it?')).toBeNull()
  })
})
