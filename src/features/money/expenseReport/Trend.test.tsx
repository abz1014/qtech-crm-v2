import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { Trend } from '@/features/money/expenseReport/ExpenseReportPage'
import type { TrendBar } from '@/features/money/expenseReport/model'

const bar = (key: string, label: string, amount: string, current = false) =>
  ({ period: { key, kind: 'month' }, label, amount, current }) as unknown as TrendBar

describe('Expense report trend columns', () => {
  it('every column prints its short value, not only the shown one (a phone cannot hover)', () => {
    const bars = [bar('2026-08', 'Aug 2026', '1938050.00'), bar('2026-09', 'Sep 2026', '28800.00'), bar('2026-10', 'Oct 2026', '9500.00', true)]
    render(<Trend bars={bars} kind="month" onPick={vi.fn()} />)
    expect(screen.getByText('1.94M')).toBeVisible()
    expect(screen.getByText('28.8K')).toBeVisible()
    expect(screen.getByText('9.5K')).toBeVisible()
  })
  it('the same figures sit in a folded table under the columns, the shown period marked (F-789)', async () => {
    const bars = [bar('2026-09', 'Sep 2026', '28800.00'), bar('2026-10', 'Oct 2026', '9500.00', true)]
    render(<Trend bars={bars} kind="month" onPick={vi.fn()} />)
    await userEvent.setup().click(screen.getByText('The same figures as a table'))
    const table = screen.getByRole('table', { name: 'Last 6 months, paid out by the day paid, spent (PKR)' })
    expect(within(table).getByRole('row', { name: /Sep 2026 28,800/ })).toBeInTheDocument()
    expect(within(table).getByRole('row', { name: /Oct 2026 \(shown\) 9,500/ })).toBeInTheDocument()
  })
})
