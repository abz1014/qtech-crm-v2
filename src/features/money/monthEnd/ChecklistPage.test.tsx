import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { SessionProvider } from '@/app/SessionProvider'
import { buildChecklist, closeState, type ClosedMonth } from '@/features/money/monthEnd/model'
import { clearList } from '@/features/money/monthEnd/lockChecks'
import type { MonthEndCtx } from '@/features/money/monthEnd/useMonthEnd'
import { ToastProvider } from '@/ui/Toast'

/*
 * Lock a month (screen review 2026-11-24, item 16): the clear checks are named as results, "Every check is clear" never sits under
 * a cash in hand warning, and a locked month whose checklist failed still shows who locked it and Reopen, not only Try again.
 */
const h = vi.hoisted(() => ({ ctx: null as unknown as MonthEndCtx, cash: { kind: 'opening', expected: 1000 } as { kind: string; expected: number | null } }))

vi.mock('@/features/money/monthEnd/useMonthEnd', () => ({ useMonthEnd: () => h.ctx }))
vi.mock('@/features/money/hooks', () => ({ useReconciliationInput: () => ({ data: {} }) }))
vi.mock('@/lib/reconciliation', () => ({ computeReconciliationExceptions: () => [] }))
vi.mock('@/features/money/exceptions/checked', () => ({ useCheckedSet: () => new Set<string>(), openFindings: () => [] }))
vi.mock('@/features/money/expenses/hooks', () => ({ useCashInHand: () => ({ data: h.cash }) }))
vi.mock('@/features/money/expenses/CashInHand', () => ({ CashInHandLine: () => null }))

const { ChecklistPage } = await import('@/features/money/monthEnd/ChecklistPage')

const TODAY = '2026-11-03'
const locked: ClosedMonth = { key: '2026-10', closedAt: '2026-11-02T05:00:00Z', closedBy: 'Ayesha', note: null }

function ctxFor({ closed = false, statusError = false, status = [] as { check_key: string; n: number }[] } = {}): MonthEndCtx {
  const month = '2026-10'
  const closedList = closed ? [locked] : []
  return {
    today: TODAY,
    month,
    thisMonth: '2026-11',
    search: `?month=${month}`,
    setMonth: () => {},
    go: () => {},
    statusReady: !statusError,
    statusError,
    cards: buildChecklist(status, month, undefined),
    withItems: 0,
    closed: closedList,
    closedEntry: closedList[0],
    state: closeState(month, TODAY, new Set(closedList.map(c => c.key)), [month]),
    hasMoney: true,
    refetch: () => {},
  }
}

function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <SessionProvider value={{ status: 'signed-in', user: { id: 'u', name: 'Ayesha', role: 'admin' } }}>
        <MemoryRouter initialEntries={['/money/month-end?month=2026-10']}>
          <ToastProvider>
            <ChecklistPage />
          </ToastProvider>
        </MemoryRouter>
      </SessionProvider>
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  h.cash = { kind: 'opening', expected: 1000 }
})

describe('Lock a month: what the checks say', () => {
  it('names the clear checks as results, not as the problems', () => {
    h.ctx = ctxFor()
    mount()
    const line = screen.getByTestId('checks-clear')
    expect(line).toHaveTextContent('7 checks are clear: Bank statement matched, every expense has a category, recurring expenses recorded, margins final, GST deposited with FBR, payments split into net and GST and no mistakes to fix. Bank check')
    expect(line).not.toHaveTextContent('Not matched to the bank statement')
    expect(screen.getByTestId('checks-summary')).toHaveTextContent('Every check is clear.')
  })

  it('does not say "Every check is clear" while cash in hand is not set up', () => {
    h.ctx = ctxFor()
    h.cash = { kind: 'none', expected: null }
    mount()
    const summary = screen.getByTestId('checks-summary')
    expect(summary).not.toHaveTextContent('Every check is clear')
    expect(summary).toHaveTextContent('All 7 checks are clear, but cash in hand is not set up. It does not stop the lock.')
  })

  it('with items and no cash in hand set up, it says both', () => {
    h.ctx = ctxFor({ status: [{ check_key: 'fbr_pending', n: 2 }] })
    h.cash = { kind: 'none', expected: null }
    mount()
    expect(screen.getByTestId('checks-summary')).toHaveTextContent('1 check has something to look at, and cash in hand is not set up. None of them stops the lock.')
  })

  it('a locked month whose checklist failed shows who locked it and Reopen, not only Try again', () => {
    h.ctx = ctxFor({ closed: true, statusError: true })
    mount()
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument()
    expect(screen.getByTestId('lock-bar')).toHaveTextContent('October 2026 is locked.')
    expect(screen.getByTestId('lock-bar-who')).toHaveTextContent(/^Locked .* by Ayesha\. Reopen it from Locked months below\.$/)
    expect(within(screen.getByTestId('closed-2026-10')).getByRole('button', { name: 'Reopen October 2026' })).toBeInTheDocument()
  })

  it('a locked month that loads says who locked it once, in the hero', () => {
    h.ctx = ctxFor({ closed: true })
    mount()
    expect(screen.queryByTestId('lock-bar-who')).toBeNull()
    expect(screen.getAllByText(/Locked .*Reopen it from the list below/)).toHaveLength(1)
  })
})

describe('clearList', () => {
  it('one sentence, first word kept, GST kept in capitals', () => {
    expect(clearList(['Bank statement matched'])).toBe('Bank statement matched')
    expect(clearList(['Margins final', 'GST deposited with FBR', 'No mistakes to fix'])).toBe('Margins final, GST deposited with FBR and no mistakes to fix')
    expect(clearList([])).toBe('')
  })
})
