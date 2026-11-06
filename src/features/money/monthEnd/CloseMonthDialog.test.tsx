import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it } from 'vitest'
import { CloseMonthDialog } from '@/features/money/monthEnd/MonthDialogs'
import { closeState } from '@/features/money/monthEnd/model'
import type { MonthEndCtx } from '@/features/money/monthEnd/useMonthEnd'
import { installFakeDb, opArgs } from '@/test/fakeSupabase'
import { ToastProvider } from '@/ui/Toast'

/*
 * Owner decision 2026-10-22 (redesign, decision 5): months lock ONE AT A TIME. With two years of imported history still open,
 * the confirmation names the oldest open month and closes that month only, with close_month; close_months_through is never called.
 */
const history = Array.from({ length: 24 }, (_, i) => `${2024 + Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, '0')}`)

function setup(month: string, moneyMonths: string[]) {
  const db = installFakeDb(() => ({ data: [] }))
  const ctx = {
    month,
    today: '2026-10-22',
    cards: [],
    withItems: 0,
    closed: [],
    state: closeState(month, '2026-10-22', new Set(), moneyMonths),
  } as unknown as MonthEndCtx
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <CloseMonthDialog open onOpenChange={() => {}} ctx={ctx} />
      </ToastProvider>
    </QueryClientProvider>,
  )
  return db
}

afterEach(() => installFakeDb(() => ({})).uninstall())

describe('Close month: one month at a time', () => {
  it('with older months open, the dialog cannot open for the month on screen: nothing is shown and nothing is closed', async () => {
    const db = setup('2026-09', [...history, '2026-09'])
    await new Promise(r => setTimeout(r, 50))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(db.calls.filter(c => c.target.startsWith('rpc:close_'))).toHaveLength(0)
  })

  it('with nothing older open, it closes the month on screen', async () => {
    const db = setup('2026-09', ['2026-09'])
    const dialog = await screen.findByRole('dialog', { name: 'Close September 2026?' })
    await userEvent.click(within(dialog).getByRole('button', { name: 'Close September' }))
    await waitFor(() => expect(db.calls.filter(c => c.target.startsWith('rpc:close_'))).toHaveLength(1))
    const close = db.calls.find(c => c.target.startsWith('rpc:close_'))
    expect(close?.target).toBe('rpc:close_month')
    expect(opArgs(close!, 'args')).toEqual([{ p_month: '2026-09-01' }])
  })
})
