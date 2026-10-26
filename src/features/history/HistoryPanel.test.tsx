import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it } from 'vitest'
import { HistoryPanel } from '@/features/history/HistoryPanel'
import { LastChanged } from '@/features/history/LastChanged'
import { CATEGORY_FUEL, CATEGORY_RENT, ev, page } from '@/features/history/fixtures'
import { installFakeDb, opArgs, type FakeCall } from '@/test/fakeSupabase'

const T = (hhmm: string, day = '2026-10-12') => `${day}T${hhmm}:00+05:00`

function setup(pages: ReturnType<typeof page>[], opts: { imported?: boolean; error?: boolean } = {}) {
  const asked: unknown[] = []
  const db = installFakeDb((c: FakeCall) => {
    if (c.target !== 'rpc:record_history') return {}
    const args = (opArgs(c, 'args')?.[0] ?? {}) as { p_before?: string }
    asked.push(args)
    if (opts.error) return { error: { message: 'down' } }
    return { data: args.p_before ? pages[1] : pages[0] }
  })
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <HistoryPanel open onOpenChange={() => {}} table="expenses" id="e1" context="Rent · 4 Oct 2026" imported={opts.imported} />
    </QueryClientProvider>,
  )
  return { db, asked }
}

afterEach(() => {
  cleanup()
  installFakeDb(() => ({})).uninstall()
})

describe('HistoryPanel', () => {
  it('is titled History and lists the newest change first, as "when · who" then "Amount: was → now"', async () => {
    setup([
      page(
        [
          ev({ at: T('15:40'), action: 'update', was: { amount_pkr: 5000, category_id: CATEGORY_RENT }, now: { amount_pkr: 500, category_id: CATEGORY_FUEL } }),
          ev({ at: T('09:00', '2026-10-04'), action: 'insert', now: { amount_pkr: 5000 }, by_name: 'Bilal' }),
        ],
        { [CATEGORY_RENT]: 'Rent', [CATEGORY_FUEL]: 'Fuel & travel' },
      ),
    ])
    expect(await screen.findByRole('dialog', { name: 'History' })).toBeInTheDocument()
    const rows = await screen.findAllByTestId('history-entry')
    expect(rows).toHaveLength(2)
    expect(rows[0]).toHaveTextContent('12 Oct 2026, 3:40 pm · Ayesha')
    expect(rows[0]).toHaveTextContent('Amount: PKR 5,000 → PKR 500')
    expect(rows[0]).toHaveTextContent('Category: Rent → Fuel & travel')
    expect(rows[1]).toHaveTextContent('Entered by Bilal')
    expect(screen.queryByText('Older history archived')).not.toBeInTheDocument()
  })

  it('pages with "Show older", asking for events before the last one shown', async () => {
    const { asked } = setup([
      page([ev({ at: T('15:40'), action: 'update', was: { amount_pkr: 2 }, now: { amount_pkr: 3 } })], {}, true),
      page([ev({ at: T('10:00', '2026-10-05'), action: 'update', was: { amount_pkr: 1 }, now: { amount_pkr: 2 }, by_name: 'Bilal' })]),
    ])
    await userEvent.click(await screen.findByRole('button', { name: 'Show older' }))
    await waitFor(() => expect(screen.getAllByTestId('history-entry')).toHaveLength(2))
    expect(asked[1]).toMatchObject({ p_before: T('15:40') })
    expect(screen.queryByRole('button', { name: 'Show older' })).not.toBeInTheDocument()
    expect(screen.getByText('Older history archived')).toBeInTheDocument()
  })

  it('shows an empty state when there are no events', async () => {
    setup([page([])])
    expect(await screen.findByText('No changes yet')).toBeInTheDocument()
  })

  it('says an imported record was imported', async () => {
    setup([page([ev({ at: T('15:40'), action: 'update', was: { amount_pkr: 2 }, now: { amount_pkr: 3 } })])], { imported: true })
    expect(await screen.findByText('Imported from old CRM')).toBeInTheDocument()
    expect(screen.queryByText('Older history archived')).not.toBeInTheDocument()
  })

  it('offers Try again when the history cannot be loaded', async () => {
    setup([page([])], { error: true })
    expect(await screen.findByText("Couldn't load the history")).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument()
  })

  it('keeps its text at 16 px (timestamps 14 px) and the button at 44 px', async () => {
    setup([page([ev({ at: T('15:40'), action: 'update', was: { amount_pkr: 2 }, now: { amount_pkr: 3 } })], {}, true)])
    const row = (await screen.findAllByTestId('history-entry'))[0]
    expect(row.querySelector('li')).toHaveClass('text-base')
    expect(row.querySelector('time')?.parentElement).toHaveClass('text-sm')
    expect(screen.getByRole('button', { name: 'Show older' })).toHaveClass('h-control-lg')
  })
})

describe('LastChanged', () => {
  it('reads "Last changed by X, when" from the newest event', async () => {
    installFakeDb(c =>
      c.target === 'rpc:record_history' ? { data: page([ev({ at: new Date(Date.now() - 3 * 86_400_000).toISOString(), action: 'update', was: { amount_pkr: 1 }, now: { amount_pkr: 2 }, by_name: 'Ayesha' })]) } : {},
    )
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(
      <QueryClientProvider client={client}>
        <LastChanged table="expenses" id="e1" />
      </QueryClientProvider>,
    )
    expect(await screen.findByTestId('last-changed')).toHaveTextContent(/^Last changed by Ayesha, 3 days ago$/)
  })
})
