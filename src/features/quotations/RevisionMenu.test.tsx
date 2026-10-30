import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it } from 'vitest'
import { SessionContext } from '@/app/session'
import { DeletePoRevisionConfirm } from '@/features/purchaseOrders/DeleteRevision'
import { RevisionMenu } from '@/features/quotations/RevisionMenu'
import { requireSupabase, setSupabaseForTests, type Db } from '@/lib/supabase'
import { installFakeDb } from '@/test/fakeSupabase'
import { ToastProvider } from '@/ui/Toast'

/* W12a: only an admin, only the latest revision, the PDF kept 30 days (0120); a PO revision likewise. */

afterEach(() => {
  cleanup()
  setSupabaseForTests(null)
})

function setup(ui: React.ReactNode, role = 'admin') {
  const fake = installFakeDb(c => (c.target.startsWith('rpc:delete_') ? { data: [{ storage_bucket: 'generated-docs', storage_path: 'q/12-1.pdf' }] } : { data: [] }))
  const removed: [string, string[]][] = []
  setSupabaseForTests({
    ...requireSupabase(),
    storage: { from: (b: string) => ({ remove: async (p: string[]) => (removed.push([b, p]), { error: null }) }) },
  } as unknown as Db)
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <SessionContext.Provider value={{ status: 'signed-in', user: { id: 'u1', name: 'Owner', role } }}>
        <ToastProvider>{ui}</ToastProvider>
      </SessionContext.Provider>
    </QueryClientProvider>,
  )
  return { fake, removed }
}

const menu = (over: Partial<React.ComponentProps<typeof RevisionMenu>> = {}) => (
  <RevisionMenu rfqId="r-1" quotationId="q-1" revision={1} hasPdf latest only={false} label="QT-26-0012 revision 1" context="QT-26-0012 R1 · Indus" {...over} />
)

describe('the quotation revision menu', () => {
  it('an admin deletes the latest revision: the rpc runs and its PDF stays in storage for the 30-day purge', async () => {
    const { fake, removed } = setup(menu())
    await userEvent.click(screen.getByRole('button', { name: 'More for QT-26-0012 revision 1' }))
    await userEvent.click(within(screen.getByRole('menu')).getByRole('menuitem', { name: 'Delete revision' }))
    expect(screen.getByText(/goes back to revision 0/)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Delete' }))
    expect(await screen.findByText('QT-26-0012 revision 1 deleted')).toBeInTheDocument()
    expect(fake.calls.find(c => c.target === 'rpc:delete_quotation_revision')?.ops[0]).toEqual(['args', [{ p_quotation_id: 'q-1' }]])
    expect(removed).toEqual([])   // the PDF stays for the 30-day purge (0120)
  })

  it('an older revision, or anyone but an admin, gets History only', async () => {
    for (const [role, latest] of [['admin', false], ['sales', true]] as const) {
      setup(menu({ latest }), role)
      await userEvent.click(screen.getByRole('button', { name: /^More for/ }))
      const items = within(screen.getByRole('menu')).getAllByRole('menuitem').map(i => i.textContent)
      expect(items).toEqual(['History'])
      cleanup()
    }
  })
})

describe('delete the latest PO revision', () => {
  it('names the revision, says the prices it wrote stay, and removes the PDF', async () => {
    const { fake, removed } = setup(
      <DeletePoRevisionConfirm orderId="o-1" po={{ id: 'p-1', number: 17, revision: 2, firstIssuedOn: '2026-10-02' }} supplierName="Keller GmbH" onClose={() => undefined} />,
    )
    expect(screen.getByRole('dialog', { name: 'Delete PO-26-0017 R2?' })).toBeInTheDocument()
    expect(screen.getByText(/stay as they are/)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Delete' }))
    expect(await screen.findByText('PO-26-0017 R2 deleted')).toBeInTheDocument()
    expect(fake.calls.find(c => c.target === 'rpc:delete_po_revision')?.ops[0]).toEqual(['args', [{ p_po_id: 'p-1' }]])
    expect(removed).toEqual([])   // the PDF stays for the 30-day purge (0120)
  })
})
