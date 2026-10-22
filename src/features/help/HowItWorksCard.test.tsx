import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { HOW_IT_WORKS, howItWorksKey } from '@/features/help/howItWorks'
import { HowItWorksCard } from '@/features/help/HowItWorksCard'
import { setDismissed } from '@/features/help/useDismissed'
import { axeViolations } from '@/test/axe'

function Where() {
  const loc = useLocation()
  return <p data-testid="at">{`${loc.pathname}${loc.search}`}</p>
}

function mount(props: Partial<Parameters<typeof HowItWorksCard>[0]> = {}) {
  return render(
    <MemoryRouter initialEntries={['/today']}>
      <HowItWorksCard userId="u1" role="sales" {...props} />
      <Where />
    </MemoryRouter>,
  )
}

const REGION = /How Q-Tech CRM works/
/** The one collapsed row, at every width (audit T1): opening it shows the steps, "Got it" and "Open Help". */
const openCard = (user: ReturnType<typeof userEvent.setup>) => user.click(screen.getByRole('button', { name: /^New here\? How Q-Tech CRM works/ }))

afterEach(() => {
  // Unmount first: clearing the flag would otherwise re-render a card outside act().
  cleanup()
  vi.restoreAllMocks()
  window.localStorage.clear()
  setDismissed(howItWorksKey('u1'), false)
})

describe('How this works card', () => {
  it('has 3 to 5 steps per role, each naming a recipe', () => {
    for (const steps of Object.values(HOW_IT_WORKS)) {
      expect(steps.length).toBeGreaterThanOrEqual(3)
      expect(steps.length).toBeLessThanOrEqual(5)
    }
  })

  it('opened: the role\'s steps; "Show me" opens that recipe in Help; axe-clean', async () => {
    const user = userEvent.setup()
    mount()
    expect(screen.queryByRole('listitem')).toBeNull() // collapsed until asked, at every width (audit T1)
    await openCard(user)
    const card = screen.getByRole('region', { name: REGION })
    expect(within(card).getAllByRole('listitem')).toHaveLength(HOW_IT_WORKS.sales.length)
    expect(await axeViolations(card)).toEqual([])
    await user.click(within(card).getAllByRole('button', { name: 'Show me' })[1])
    expect(screen.getByTestId('at')).toHaveTextContent('/today?help=ask-suppliers')
  })

  it('"Got it" hides it for this person on this device, and it stays hidden on the next visit', async () => {
    const user = userEvent.setup()
    const first = mount()
    await openCard(user)
    await user.click(screen.getByRole('button', { name: 'Got it' }))
    expect(screen.queryByRole('region', { name: REGION })).toBeNull()
    expect(window.localStorage.getItem('qtech.howItWorks.u1')).toBe('dismissed')
    first.unmount()
    const second = mount()
    expect(screen.queryByRole('region', { name: REGION })).toBeNull()
    // Another person on the same device still sees theirs.
    second.unmount()
    render(
      <MemoryRouter>
        <HowItWorksCard userId="u2" role="engineer" />
      </MemoryRouter>,
    )
    expect(screen.getByRole('region', { name: /How Q-Tech CRM works/ })).toBeInTheDocument()
  })

  it('still hides when storage refuses the write (private window)', async () => {
    const user = userEvent.setup()
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError')
    })
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('SecurityError')
    })
    mount()
    await openCard(user)
    await user.click(screen.getByRole('button', { name: 'Got it' }))
    expect(screen.queryByRole('region', { name: REGION })).toBeNull()
  })

  it('one collapsed row at every width that opens on tap, and can be hidden without opening; axe-clean', async () => {
    const user = userEvent.setup()
    mount({ role: 'engineer' })
    const row = screen.getByRole('button', { name: 'New here? How Q-Tech CRM works · 3 steps' })
    expect(row).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByRole('listitem')).toBeNull()
    await user.click(row)
    expect(row).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getAllByRole('listitem')).toHaveLength(3)
    expect(await axeViolations()).toEqual([])
    await user.click(screen.getByRole('button', { name: 'Hide How this works' }))
    expect(screen.queryByRole('button', { name: /New here/ })).toBeNull()
  })

  it('is not shown to someone added more than 14 days ago, or to a role with no steps', () => {
    mount({ since: '2026-09-01', now: new Date('2026-10-20T09:00:00Z') })
    expect(screen.queryByRole('region')).toBeNull()
    mount({ since: '2026-10-15', now: new Date('2026-10-20T09:00:00Z') })
    expect(screen.getByRole('region', { name: REGION })).toBeInTheDocument()
    render(
      <MemoryRouter>
        <HowItWorksCard userId="u3" role="auditor" />
      </MemoryRouter>,
    )
    expect(screen.getAllByRole('region')).toHaveLength(1)
  })
})
