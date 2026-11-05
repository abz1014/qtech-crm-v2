import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { SessionProvider } from '@/app/SessionProvider'
import { installFakeDb } from '@/test/fakeSupabase'
import { ToastProvider } from '@/ui/Toast'
import type { JobRow } from '@/features/jobs/api'
import AddFileSlot from '@/features/jobs/AddFileSlot'
import { JOB_SLOTS } from '@/features/jobs/slotRegistry'

/* "Add file" in Notes and files (0134): admin and sales only. An engineer's slot draws nothing, and the PO document has its own button. */
const job = { key: '139', kind: 'enquiry', rfqId: 'r1', orderId: 'o1', companyId: 'c1', companyName: 'Harbour Textiles Limited' } as unknown as JobRow

function mount(role: 'admin' | 'sales' | 'engineer', orderId: string | null = 'o1') {
  installFakeDb(() => ({ data: [] }))
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <SessionProvider value={{ status: 'signed-in', user: { id: 'u', name: 'X', role } }}>
        <ToastProvider>
          <AddFileSlot job={{ job: { ...job, orderId }, role, money: role !== 'engineer' }} />
        </ToastProvider>
      </SessionProvider>
    </QueryClientProvider>,
  )
}
afterEach(() => installFakeDb(() => ({})).uninstall())

describe('Add file in Notes and files', () => {
  it('is registered in the files slot', () => {
    expect(JOB_SLOTS.files.length).toBe(1)
  })

  it('admin and sales get the button', () => {
    for (const role of ['admin', 'sales'] as const) {
      const { unmount } = mount(role)
      expect(screen.getByRole('button', { name: 'Add file' })).toBeInTheDocument()
      unmount()
    }
  })

  it('an engineer gets nothing', () => {
    mount('engineer')
    expect(screen.queryByRole('button', { name: 'Add file' })).toBeNull()
    expect(screen.queryByTestId('job-file-input')).toBeNull()
  })
})
