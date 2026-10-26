import type { ReactNode } from 'react'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import { FIRST_USE_COPY, NOTHING_YET } from '@/features/help/firstUseCopy'
import { FirstUseState, NothingYetState } from '@/features/help/FirstUseState'
import { axeViolations } from '@/test/axe'

function Where() {
  const loc = useLocation()
  return <p data-testid="at">{`${loc.pathname}${loc.search}`}</p>
}

function mount(ui: ReactNode) {
  return render(
    <MemoryRouter initialEntries={['/today']}>
      {ui}
      <Where />
    </MemoryRouter>,
  )
}

describe('first-use empty states', () => {
  it('every copy is short: a title, at most two lines, one action', () => {
    for (const byRole of Object.values(FIRST_USE_COPY)) {
      for (const copy of Object.values(byRole)) {
        expect(copy?.title.length).toBeLessThanOrEqual(40)
        expect(copy?.body.split(/\s+/).length).toBeLessThanOrEqual(40)
      }
    }
  })

  it('Today, sales: says what Today is for, and the one button starts an RFQ; axe-clean', async () => {
    const user = userEvent.setup()
    const { container } = mount(<FirstUseState screen="today" role="sales" />)
    expect(screen.getByText('Your work shows up here')).toBeInTheDocument()
    expect(screen.queryByText(/Nice|Nothing needs you/)).toBeNull()
    expect(await axeViolations(container)).toEqual([])
    await user.click(screen.getByRole('button', { name: 'New RFQ' }))
    expect(screen.getByTestId('at')).toHaveTextContent('/rfqs/new')
  })

  it('"Show me how" opens the matching recipe in Help', async () => {
    const user = userEvent.setup()
    mount(<FirstUseState screen="orders" role="sales" />)
    await user.click(screen.getByRole('button', { name: 'Show me how' }))
    expect(screen.getByTestId('at')).toHaveTextContent('/today?help=mark-won')
  })

  it('Today, engineer: the one button opens Jobs, where Add to this job takes a photo or a note', async () => {
    const user = userEvent.setup()
    mount(<FirstUseState screen="today" role="engineer" />)
    await user.click(screen.getByRole('button', { name: 'Open Jobs' }))
    expect(screen.getByTestId('at')).toHaveTextContent('/jobs')
  })

  it('Today, admin alone on the team: the one button adds people', async () => {
    const user = userEvent.setup()
    mount(<FirstUseState screen="today" role="admin" alone />)
    expect(screen.getByText('Just you so far')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Add person' }))
    expect(screen.getByTestId('at')).toHaveTextContent('/settings/team')
  })

  it('Orders, engineer: keeps the list\'s own "show everyone\'s" switch, with the count', async () => {
    const user = userEvent.setup()
    const onEveryone = vi.fn()
    const { container } = mount(<FirstUseState screen="orders" role="engineer" onEveryone={onEveryone} everyoneCount={12} />)
    await user.click(within(container).getByRole('button', { name: 'Show everyone’s (12)' }))
    expect(onEveryone).toHaveBeenCalledTimes(1)
  })

  it('renders nothing where it has no words (the screen keeps its own empty state)', () => {
    const { container } = mount(<FirstUseState screen="rfqs" role="engineer" />)
    expect(container.querySelector('[data-mood]')).toBeNull()
  })

  it('nothing-yet lines (a list that never had a record) are neutral and never claim the work is done', () => {
    for (const copy of Object.values(NOTHING_YET)) {
      expect(copy.title.length).toBeLessThanOrEqual(40)
      expect(copy.body.split(/\s+/).length).toBeLessThanOrEqual(40)
      expect(`${copy.title} ${copy.body}`).not.toMatch(/\bevery\b|\bnice\b|paid in full|done or cancelled|out or closed/i)
    }
  })

  it('NothingYetState: neutral mood, its words, and the one button where there is one; axe-clean', async () => {
    const user = userEvent.setup()
    const { container } = mount(<NothingYetState screen="orders" />)
    expect(container.querySelector('[data-mood="neutral"]')).not.toBeNull()
    expect(screen.getByText('No orders yet')).toBeInTheDocument()
    expect(await axeViolations(container)).toEqual([])
    await user.click(screen.getByRole('button', { name: 'Open RFQs' }))
    expect(screen.getByTestId('at')).toHaveTextContent('/rfqs')
  })

  it('NothingYetState for Who owes us has no primary button, only "Show me how"', () => {
    mount(<NothingYetState screen="receivables" />)
    expect(screen.getByText('No balances yet')).toBeInTheDocument()
    expect(screen.getAllByRole('button').map(b => b.textContent)).toEqual(['Show me how'])
  })
})
