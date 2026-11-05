import { render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { CashBlock } from '@/features/money/costs/CashBlock'

describe('Margin panel: Cash so far', () => {
  it('shows received, paid out and left, and says it includes GST', () => {
    render(<CashBlock cash={{ received: 1350, paidOut: 300, left: 1050 }} loading={false} error={false} />)
    const block = screen.getByRole('region', { name: 'Cash so far' })
    expect(within(block).getByText('includes GST')).toBeInTheDocument()
    expect(within(block).getByText('Received').nextSibling).toHaveTextContent('1,350')
    expect(within(block).getByText('Paid out').nextSibling).toHaveTextContent('300')
    expect(within(block).getByTestId('margin-cash-left')).toHaveTextContent('1,050')
  })

  it('shows a negative left with its minus sign and the danger tone', () => {
    render(<CashBlock cash={{ received: 0, paidOut: 40, left: -40 }} loading={false} error={false} />)
    const left = screen.getByTestId('margin-cash-left')
    expect(left).toHaveTextContent('40')
    expect(left.textContent).toMatch(/^[-−]/)
    expect(left.parentElement?.className).toContain('text-tone-danger-fg')
  })

  it('says so when the figures could not be read, and waits while they load', () => {
    const { rerender } = render(<CashBlock cash={undefined} loading error={false} />)
    expect(screen.getByRole('status', { name: 'Loading cash so far' })).toBeInTheDocument()
    rerender(<CashBlock cash={undefined} loading={false} error />)
    expect(screen.getByText(/could not be read/)).toBeInTheDocument()
  })
})
