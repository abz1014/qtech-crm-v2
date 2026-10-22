import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import { ClosedList } from '@/features/money/monthEnd/ChecklistPage'
import type { MonthEndCtx } from '@/features/money/monthEnd/useMonthEnd'

/* Owner decision 2026-10-22 (0080): months reopen newest first, so only the latest closed month offers Reopen. */

const ctx = {
  month: '2026-10',
  today: '2026-10-22',
  state: null,
  closed: [
    { key: '2026-09', closedAt: '2026-10-02T05:00:00Z', closedBy: 'Ayesha', note: null },
    { key: '2026-08', closedAt: '2026-09-02T05:00:00Z', closedBy: 'Ayesha', note: null },
    { key: '2026-07', closedAt: '2026-08-02T05:00:00Z', closedBy: null, note: null },
  ],
} as unknown as MonthEndCtx

describe('Closed months: reopen newest first', () => {
  it('only the latest closed month has Reopen; the earlier ones say which month to reopen first', async () => {
    const onReopen = vi.fn()
    render(
      <MemoryRouter>
        <ClosedList ctx={ctx} onReopen={onReopen} />
      </MemoryRouter>,
    )
    const list = screen.getByRole('list', { name: 'Closed months' })
    expect(within(list).getAllByRole('button', { name: /^Reopen / })).toHaveLength(1)
    await userEvent.click(within(screen.getByTestId('closed-2026-09')).getByRole('button', { name: /^Reopen / }))
    expect(onReopen).toHaveBeenCalledWith(expect.objectContaining({ key: '2026-09' }))
    expect(within(screen.getByTestId('closed-2026-08')).queryByRole('button')).toBeNull()
    expect(screen.getByTestId('reopen-order-2026-08')).toHaveTextContent(/^Reopen .*2026 first$/)
    expect(screen.getByTestId('reopen-order-2026-07')).toHaveTextContent(/Sep/)
  })
})
