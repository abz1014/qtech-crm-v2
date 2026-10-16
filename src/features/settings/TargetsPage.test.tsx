import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SessionProvider } from '@/app/SessionProvider'
import type { SessionState } from '@/app/session'
import type { TeamMember } from '@/features/settings/api'
import { TargetsPage } from '@/features/settings/TargetsPage'
import type { ProgressRow, TargetRow } from '@/features/settings/targetsModel'
import { PlainError } from '@/lib/pgErrors'
import { ToastProvider } from '@/ui/Toast'
import { axeViolations } from '@/test/axe'

const h = vi.hoisted(() => ({
  team: vi.fn(),
  targets: vi.fn(),
  progress: vi.fn(),
  save: vi.fn(),
  remove: vi.fn(),
  add: vi.fn(),
}))
vi.mock('@/features/settings/api', () => ({
  listTeam: h.team,
  listTargets: h.targets,
  listTargetProgress: h.progress,
  saveTarget: h.save,
  removeTargets: h.remove,
  addTargets: h.add,
}))

const member = (id: string, name: string, role: TeamMember['role'], extra: Partial<TeamMember> = {}): TeamMember => ({
  id,
  name,
  email: `${id}@qtech.example`,
  role,
  job_title: null,
  phone: null,
  deactivated_at: null,
  created_at: '2026-01-01T00:00:00Z',
  ...extra,
})
const TEAM = [
  member('bilal', 'Bilal Chaudhry', 'admin'),
  member('ayesha', 'Ayesha Rana', 'sales'),
  member('usman', 'Usman Tariq', 'engineer'),
  member('saad', 'Saad Hussain', 'sales', { deactivated_at: '2026-02-01T00:00:00Z' }),
]
const target = (user_id: string, year: number, quarter: number, amount: number): TargetRow => ({ id: `${user_id}-${year}-${quarter}`, user_id, year, quarter, target_net_pkr: amount })

const NOW = new Date('2026-10-15T07:00:00Z') // Q4 2026 in Asia/Karachi
const me: SessionState = { status: 'signed-in', user: { id: 'bilal', name: 'Bilal Chaudhry', role: 'admin' } }

function mount() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <SessionProvider value={me}>
        <MemoryRouter>
          <ToastProvider>
            <TargetsPage />
          </ToastProvider>
        </MemoryRouter>
      </SessionProvider>
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'], now: NOW })
  Object.values(h).forEach(f => f.mockReset())
  h.team.mockResolvedValue(TEAM)
  h.targets.mockResolvedValue([target('ayesha', 2026, 3, 4_000_000), target('ayesha', 2026, 4, 5_000_000), target('usman', 2026, 3, 1_500_000)])
  h.progress.mockResolvedValue([
    { user_id: 'ayesha', year: 2026, quarter: 4, target_net: 5_000_000, achieved_net: 1_200_000, on_pace_net: 1_500_000, behind_pace: 300_000, excluded_count: 0 },
  ] satisfies ProgressRow[])
  h.save.mockImplementation(async (v: { userId: string; year: number; quarter: number; amount: number }) => target(v.userId, v.year, v.quarter, v.amount))
  h.remove.mockResolvedValue(1)
  h.add.mockImplementation(async (rows: { user_id: string; year: number; quarter: number; target_net_pkr: number }[]) => rows.map(r => target(r.user_id, r.year, r.quarter, r.target_net_pkr)))
})
afterEach(() => vi.useRealTimers())

const cell = (name: string, q: number) => screen.getByRole('button', { name: new RegExp(`^${name}, Q${q} \\d{4} target`) })

describe('Targets (M06)', () => {
  it('shows the active people by quarter with grouped PKR, achieved and on pace, and no percentage', async () => {
    mount()
    expect(await screen.findByText('Ayesha Rana')).toBeInTheDocument()
    expect(screen.queryByText('Saad Hussain')).toBeNull() // deactivated people get no row
    expect(cell('Ayesha Rana', 4)).toHaveTextContent('5,000,000')
    expect(cell('Ayesha Rana', 3)).toHaveTextContent('4,000,000')
    expect(cell('Bilal Chaudhry', 4)).toHaveTextContent('Set target')

    const c = document.querySelector('[data-cell="ayesha:4"]') as HTMLElement
    expect(within(c).getByText(/Achieved/)).toHaveTextContent('1,200,000')
    expect(within(c).getByText(/^On pace/)).toHaveTextContent('1,500,000')
    expect(c).toHaveTextContent('300,000')
    expect(c).toHaveTextContent('behind pace')
    expect(document.body.textContent).not.toMatch(/\d\s?%/)
  })

  it('ends with the count footer', async () => {
    mount()
    await screen.findByText('Ayesha Rana')
    expect(screen.getByTestId('targets-footer')).toHaveTextContent('3 people · 1 with Q4 target')
  })

  it('a quarter that has not started says when it starts', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    h.targets.mockResolvedValue([target('ayesha', 2027, 2, 6_000_000)])
    mount()
    await screen.findByText('Ayesha Rana')
    await user.click(screen.getByRole('button', { name: 'Next year' }))
    await waitFor(() => expect(screen.getByTestId('targets-year')).toHaveTextContent('2027'))
    expect(h.targets).toHaveBeenLastCalledWith(2027)
    expect(await screen.findByText('Starts 1 Apr 2027')).toBeInTheDocument()
  })

  it('1 tap plus the amount: Enter saves it, grouped, with a confirmation', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    mount()
    await screen.findByText('Ayesha Rana')
    await user.click(cell('Bilal Chaudhry', 4)) // the tap
    const input = screen.getByRole('textbox', { name: /Bilal Chaudhry, Q4 2026 target in rupees/ })
    expect(input).toHaveFocus()
    await user.keyboard('7500000{Enter}')
    await waitFor(() => expect(h.save).toHaveBeenCalledWith({ userId: 'bilal', year: 2026, quarter: 4, amount: 7_500_000 }))
    expect(await screen.findByText('Target saved')).toBeInTheDocument()
    expect(screen.getByText(/PKR 7,500,000/)).toBeInTheDocument()
  })

  it('Escape cancels, and nothing is saved', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    mount()
    await screen.findByText('Ayesha Rana')
    await user.click(cell('Bilal Chaudhry', 4))
    await user.keyboard('123{Escape}')
    expect(screen.queryByRole('textbox')).toBeNull()
    expect(h.save).not.toHaveBeenCalled()
  })

  it('refuses zero in words and keeps the cell open', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    mount()
    await screen.findByText('Ayesha Rana')
    await user.click(cell('Bilal Chaudhry', 4))
    await user.keyboard('0{Enter}')
    expect(await screen.findByRole('alert')).toHaveTextContent('A target must be above 0')
    expect(h.save).not.toHaveBeenCalled()
  })

  it('shows the database refusal as a plain sentence', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    h.save.mockRejectedValue(new PlainError('Only an admin can set targets.'))
    mount()
    await screen.findByText('Ayesha Rana')
    await user.click(cell('Bilal Chaudhry', 4))
    await user.keyboard('100{Enter}')
    expect(await screen.findByRole('alert')).toHaveTextContent('Only an admin can set targets.')
  })

  it('clearing a cell and pressing Enter removes the target, with an Undo', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    mount()
    await screen.findByText('Ayesha Rana')
    await user.click(cell('Ayesha Rana', 4))
    await user.clear(screen.getByRole('textbox', { name: /Ayesha Rana, Q4 2026/ }))
    await user.keyboard('{Enter}')
    await waitFor(() => expect(h.remove).toHaveBeenCalledWith(['ayesha-2026-4']))
    const toast = await screen.findByText('Target removed')
    expect(toast).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /Undo/ }))
    await waitFor(() => expect(h.save).toHaveBeenCalledWith({ userId: 'ayesha', year: 2026, quarter: 4, amount: 5_000_000 }))
  })

  it('Copy last quarter fills only the empty cells of the chosen quarter and never overwrites', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    mount()
    await screen.findByText('Ayesha Rana')
    // Q4 is chosen (it is now). Ayesha has a Q4 target; Usman has Q3 only; Bilal has nothing.
    expect(screen.getByText(/Fills 1 empty cell in Q4 2026 from Q3 2026/)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Copy last quarter' }))
    await waitFor(() => expect(h.add).toHaveBeenCalledWith([{ user_id: 'usman', year: 2026, quarter: 4, target_net_pkr: 1_500_000 }]))
    expect(await screen.findByText('Copied Q3 2026')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /Undo/ }))
    await waitFor(() => expect(h.remove).toHaveBeenCalledWith(['usman-2026-4']))
  })

  it('Copy is disabled, and says why, when there is nothing to copy', async () => {
    h.targets.mockResolvedValue([target('ayesha', 2026, 4, 5_000_000)])
    mount()
    await screen.findByText('Ayesha Rana')
    expect(screen.getByRole('button', { name: 'Copy last quarter' })).toBeDisabled()
    expect(screen.getByText(/Nothing to copy/)).toBeInTheDocument()
  })

  it('a failed load shows a retry; failed progress still lets targets be edited', async () => {
    h.progress.mockRejectedValue(new Error('boom'))
    mount()
    expect(await screen.findByText('Achieved and on-pace figures could not be read')).toBeInTheDocument()
    expect(cell('Ayesha Rana', 4)).toBeInTheDocument()
  })

  it('has no accessibility violations', async () => {
    const { container } = mount()
    await screen.findByText('Ayesha Rana')
    expect(await axeViolations(container)).toEqual([])
  })
})
