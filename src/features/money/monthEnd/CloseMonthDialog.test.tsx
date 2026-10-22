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
  it('with older months open, it names and closes only the oldest one', async () => {
    const db = setup('2026-09', [...history, '2026-09'])
    const dialog = await screen.findByRole('dialog', { name: 'Close January 2024?' })
    expect(within(dialog).getByText(/This closes January 2024 only/)).toBeInTheDocument()
    expect(dialog).not.toHaveTextContent(/through/i)
    await userEvent.click(within(dialog).getByRole('button', { name: 'Close January 2024' }))
    await waitFor(() => expect(db.calls.some(c => c.verb === 'rpc' && c.target === 'rpc:close_month')).toBe(true))
    const closes = db.calls.filter(c => c.target.startsWith('rpc:close_'))
    expect(closes).toHaveLength(1)
    expect(closes[0].target).toBe('rpc:close_month')
    expect(opArgs(closes[0], 'args')).toEqual([{ p_month: '2024-01-01' }])
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
