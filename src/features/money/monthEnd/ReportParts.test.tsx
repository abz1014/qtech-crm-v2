import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { AgeBand, AsOfControl } from '@/features/money/monthEnd/ReportParts'

describe('AgeBand: the age is said in a word and an icon, not by colour alone', () => {
  it('61 to 90 days carries an icon and the words "Over 60 days"', () => {
    const { container } = render(<AgeBand bucket="61-90">1,000</AgeBand>)
    expect(screen.getByText('Over 60 days')).toBeInTheDocument()
    expect(container.querySelector('svg')).not.toBeNull()
    expect(screen.getByText('1,000')).toBeInTheDocument()
  })

  it('90+ carries an icon and the words "Over 90 days"', () => {
    const { container } = render(<AgeBand bucket="90+">2,000</AgeBand>)
    expect(screen.getByText('Over 90 days')).toBeInTheDocument()
    expect(container.querySelector('svg')).not.toBeNull()
  })

  it('the early buckets stay plain: no icon, no word', () => {
    const { container } = render(<AgeBand bucket="0-30">3,000</AgeBand>)
    expect(container.querySelector('svg')).toBeNull()
    expect(screen.queryByText(/Over/)).toBeNull()
  })
})

describe('AsOfControl: the date field fits a narrow screen', () => {
  it('the field wrapper is not a fixed 232 px: full width on narrow screens', () => {
    const { container } = render(<AsOfControl asOf="2026-10-31" chosen onChange={vi.fn()} />)
    expect(container.innerHTML).not.toMatch(/class="([^"]*\s)?w-\[232px\]/)
    const field = screen.getByLabelText('As of date').closest('span.shrink-0, span.w-full, span.min-w-0')
    expect(field?.className).toMatch(/w-full/)
  })
})
