import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { QuickAdd } from '@/features/money/expenses/QuickAdd'
import type { Category } from '@/features/money/expenses/model'
import { installFakeDb, type FakeCall } from '@/test/fakeSupabase'
import { ToastProvider } from '@/ui/Toast'

/* Quick add keeps its keyboard: after Save the amount box is empty AND focused, so the next expense is typed at once. */
const CATEGORIES = [{ id: 'c-water', name: 'Water', grp: 'overhead', groupId: 'g1', defaultPaidVia: 'cash', sort: 10, active: true, monthlyBudgetPkr: null }] as unknown as Category[]

afterEach(() => {
  vi.restoreAllMocks()
  installFakeDb(() => ({})).uninstall()
})

describe('Quick add focus', () => {
  it('returns the focus to the empty amount box after Save, again for the next one, and a toast does not take it', async () => {
    installFakeDb((c: FakeCall) => {
      if (c.target === 'expenses' && c.verb !== 'select') return { data: [] }
      return { data: [] }
    })
    const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
    render(
      <QueryClientProvider client={client}>
        <ToastProvider>
          <QuickAdd categories={CATEGORIES} />
        </ToastProvider>
      </QueryClientProvider>,
    )
    // A frame that comes before React has rendered the fresh box (what the CI browser did): the old code focused the old box.
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation(cb => {
      cb(0)
      return 1
    })
    const user = userEvent.setup()
    for (const amt of ['500', '750']) {
      const amount = screen.getByRole('textbox', { name: 'Amount (PKR)' })
      await user.click(amount)
      await user.keyboard(amt)
      await user.click(screen.getByRole('button', { name: 'Water' }))
      await user.click(screen.getByRole('button', { name: 'Save this expense' }))
      await waitFor(() => expect(screen.getByRole('textbox', { name: 'Amount (PKR)' })).toHaveValue(''))
      await waitFor(() => expect(screen.getByRole('textbox', { name: 'Amount (PKR)' })).toHaveFocus())
      // past the toast's focus-rescue window (100 ms ticks) and a few frames
      await new Promise(r => setTimeout(r, 350))
      expect(screen.getByRole('textbox', { name: 'Amount (PKR)' })).toHaveFocus()
    }
  })
})
