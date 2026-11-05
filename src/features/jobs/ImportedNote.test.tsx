import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { qk } from '@/features/queryKeys'
import * as api from '@/features/jobs/api'
import { ImportedNote } from '@/features/jobs/ImportedNote'

/*
 * "Imported note" (migration 0135): the old system's free text behind an imported job. Closed until opened, admin and sales only, and
 * an engineer's page neither draws it nor asks for it (the database would refuse: imported_notes has no grant for them).
 * Fictional suppliers and items only.
 */
const rows: api.ImportedNoteRow[] = [
  { kind: 'orders', rowId: 'o1', note: 'Supplier breakdown: • ITEM#1: Alpha gauge ×1 — Acme Components Ltd @ Rs 5/unit' },
  { kind: 'rfqs', rowId: 'r1', note: 'Called the customer on Monday' },
  { kind: 'order_items', rowId: 'i1', note: 'Supplier breakdown: • ITEM#1: Alpha gauge ×1 — Acme Components Ltd @ Rs 5/unit' },
]

function view(role: 'admin' | 'sales' | 'engineer', seeded = true) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  if (seeded) client.setQueryData(qk.jobs.importedNotes('r1|o1'), rows)
  return render(
    <QueryClientProvider client={client}>
      <ImportedNote rfqId="r1" orderId="o1" role={role} />
    </QueryClientProvider>,
  )
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('ImportedNote', () => {
  it('is closed by default: the heading is there, the text is not', () => {
    view('admin')
    expect(screen.getByRole('button', { name: /Imported note/ })).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByText(/Acme Components/)).toBeNull()
    expect(screen.queryByText(/Called the customer/)).toBeNull()
  })

  it('opens on a click and shows the notes and the items as imported, then closes again', async () => {
    view('sales')
    const button = screen.getByRole('button', { name: /Imported note/ })
    await userEvent.click(button)
    expect(button).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByText('Called the customer on Monday')).toBeInTheDocument()
    expect(screen.getAllByText(/Acme Components Ltd @ Rs 5\/unit/)).toHaveLength(2)
    expect(screen.getByText('Order items, as imported')).toBeInTheDocument()
    await userEvent.click(button)
    expect(screen.queryByText('Called the customer on Monday')).toBeNull()
  })

  it('an engineer gets nothing and the page does not ask for it', () => {
    const ask = vi.spyOn(api, 'listImportedNotes')
    view('engineer', false)
    expect(screen.queryByRole('region', { name: 'Imported note' })).toBeNull()
    expect(screen.queryByRole('button', { name: /Imported note/ })).toBeNull()
    expect(ask).not.toHaveBeenCalled()
  })

  it('draws nothing when the job has no imported text', () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    client.setQueryData(qk.jobs.importedNotes('r1|o1'), [])
    render(
      <QueryClientProvider client={client}>
        <ImportedNote rfqId="r1" orderId="o1" role="admin" />
      </QueryClientProvider>,
    )
    expect(screen.queryByRole('button', { name: /Imported note/ })).toBeNull()
  })
})
