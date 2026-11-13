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

function setup(month: string, moneyMonths: string[], cards: unknown[] = [], mistakes?: number) {
  const db = installFakeDb(() => ({ data: [] }))
  const ctx = {
    month,
    today: '2026-10-22',
    cards,
    withItems: 0,
    closed: [],
    state: closeState(month, '2026-10-22', new Set(), moneyMonths),
  } as unknown as MonthEndCtx
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <CloseMonthDialog open onOpenChange={() => {}} ctx={ctx} mistakes={mistakes} />
      </ToastProvider>
    </QueryClientProvider>,
  )
  return db
}

afterEach(() => installFakeDb(() => ({})).uninstall())

describe('Lock month: one month at a time', () => {
  it('with older months open, the dialog cannot open for the month on screen: nothing is shown and nothing is closed', async () => {
    const db = setup('2026-09', [...history, '2026-09'])
    await new Promise(r => setTimeout(r, 50))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(db.calls.filter(c => c.target.startsWith('rpc:close_'))).toHaveLength(0)
  })

  it('with nothing older open, it closes the month on screen', async () => {
    const db = setup('2026-09', ['2026-09'])
    const dialog = await screen.findByRole('dialog', { name: 'Lock September 2026?' })
    await userEvent.click(within(dialog).getByRole('button', { name: 'Lock September' }))
    await waitFor(() => expect(db.calls.filter(c => c.target.startsWith('rpc:close_'))).toHaveLength(1))
    const close = db.calls.find(c => c.target.startsWith('rpc:close_'))
    expect(close?.target).toBe('rpc:close_month')
    expect(opArgs(close!, 'args')).toEqual([{ p_month: '2026-09-01' }])
  })
})

describe('Lock month: the dialog counts the same checks as the page', () => {
  const card = (key: string, label: string, n: number) => ({ key, label, n, unit: 'items', clear: n === 0, sub: '', parts: [], linkLabel: '', to: '', glyph: 'x' })
  const six = [
    card('bank_unticked', 'Not matched to the bank statement', 3),
    card('uncategorised', 'Expenses without a category', 0),
    card('recurring_missing', 'Recurring expenses not recorded', 1),
    card('margin_not_final', 'Margin not final', 2),
    card('gst_undeposited', 'GST not deposited with FBR', 1),
    card('unsplit', 'Payments not split', 0),
  ]

  it('lists Mistakes to fix as the seventh check and counts it: 5 of 7', async () => {
    setup('2026-09', ['2026-09'], six, 3)
    const dialog = await screen.findByRole('dialog', { name: 'Lock September 2026?' })
    expect(within(dialog).getByText('Mistakes to fix')).toBeInTheDocument()
    expect(within(dialog).getAllByRole('listitem')).toHaveLength(7)
    expect(dialog.textContent).toContain('5 of 7 checks have items')
  })

  it('a clear Mistakes to fix is still the seventh row: 4 of 7', async () => {
    setup('2026-09', ['2026-09'], six, 0)
    const dialog = await screen.findByRole('dialog', { name: 'Lock September 2026?' })
    expect(within(dialog).getAllByRole('listitem')).toHaveLength(7)
    expect(dialog.textContent).toContain('4 of 7 checks have items')
  })
})
