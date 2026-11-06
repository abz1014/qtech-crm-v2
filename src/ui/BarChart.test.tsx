import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { BarChart } from '@/ui/BarChart'

const months = (n: number) => Array.from({ length: n }, (_, i) => `M${i + 1}`)
const fmt = (n: number) => `PKR ${n.toLocaleString('en-US')}`

describe('BarChart', () => {
  it('is one image for assistive technology, named by its summary', () => {
    render(<BarChart labels={months(12)} series={[{ name: 'Income', values: months(12).map((_, i) => (i + 1) * 100) }]} summary="Income rose every month." format={fmt} tableCaption="Income by month" />)
    expect(screen.getByRole('img', { name: 'Income rose every month.' })).toBeInTheDocument()
  })

  it.each([12, 24])('draws one bar per month and series for %i months', n => {
    const { container } = render(
      <BarChart
        labels={months(n)}
        series={[
          { name: 'Income', values: months(n).map((_, i) => i * 10) },
          { name: 'Cash', values: months(n).map((_, i) => i * 12) },
        ]}
        summary="s"
        format={fmt}
        tableCaption="c"
      />,
    )
    expect(container.querySelectorAll('svg rect')).toHaveLength(n * 2)
  })

  it('keeps the figures in a table that is hidden until asked for, and every month is in it', () => {
    render(<BarChart labels={months(12)} series={[{ name: 'Income', values: months(12).map((_, i) => i * 1000) }]} summary="s" format={fmt} tableCaption="Income by month" />)
    expect(screen.queryByRole('table')).toBeNull()
    const toggle = screen.getByRole('button', { name: 'Show as a table' })
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    fireEvent.click(toggle)
    const table = screen.getByRole('table', { name: 'Income by month' })
    expect(within(table).getAllByRole('row')).toHaveLength(13)
    expect(within(table).getByRole('rowheader', { name: 'M12' })).toBeInTheDocument()
    expect(within(table).getByText('PKR 11,000')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Hide the table' })).toHaveAttribute('aria-expanded', 'true')
  })

  it('names its series in a legend, so colour is not the only cue', () => {
    render(
      <BarChart
        labels={months(3)}
        series={[
          { name: 'Income (invoiced, no GST)', values: [1, 2, 3] },
          { name: 'Cash received (includes GST)', values: [2, 3, 4] },
        ]}
        reference={{ label: 'Average income', value: 2 }}
        summary="s"
        format={fmt}
        tableCaption="c"
      />,
    )
    const legend = screen.getByRole('list', { name: 'Legend' })
    expect(within(legend).getByText('Income (invoiced, no GST)')).toBeInTheDocument()
    expect(within(legend).getByText('Cash received (includes GST)')).toBeInTheDocument()
    expect(within(legend).getByText('Average income')).toBeInTheDocument()
  })

  it('copes with all zeros and with a negative month', () => {
    const { container, rerender } = render(<BarChart labels={months(3)} series={[{ name: 'A', values: [0, 0, 0] }]} summary="s" format={fmt} tableCaption="c" />)
    expect(container.querySelectorAll('svg rect')).toHaveLength(3)
    rerender(<BarChart labels={months(3)} series={[{ name: 'A', values: [100, -50, 0] }]} summary="s" format={fmt} tableCaption="c" />)
    for (const r of Array.from(container.querySelectorAll('svg rect'))) expect(Number(r.getAttribute('height'))).toBeGreaterThanOrEqual(0)
  })

  it('draws the second series in a different colour from the first, in the bars and in the legend', () => {
    const { container } = render(
      <BarChart labels={months(2)} series={[{ name: 'A', values: [1, 2] }, { name: 'B', values: [2, 3] }]} summary="s" format={fmt} tableCaption="c" />,
    )
    const rects = Array.from(container.querySelectorAll('svg rect'))
    expect(rects[0].getAttribute('class')).toBe('fill-fg')
    expect(rects[1].getAttribute('class')).toBe('fill-brand-green')
    const swatches = within(screen.getByRole('list', { name: 'Legend' })).getAllByRole('listitem').map(li => li.querySelector('i')?.className ?? '')
    expect(swatches[0]).toContain('bg-fg')
    expect(swatches[1]).toContain('bg-brand-green')
  })
})
