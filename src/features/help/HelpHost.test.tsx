import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, useLocation, useNavigate } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SessionProvider } from '@/app/SessionProvider'
import { PaletteContext, type PaletteApi } from '@/app/palette/usePalette'
import type { SessionState } from '@/app/session'
import { HelpHost } from '@/features/help/HelpHost'
import { HELP_GROUP, helpPaletteSource } from '@/features/help/helpPalette'
import { allRecipes } from '@/features/help/recipes'
import type { PaletteSource } from '@/ui/paletteSources'

const sales: SessionState = { status: 'signed-in', user: { id: 'u-sales', name: 'Ayesha Rana', role: 'sales' } }
let go: ReturnType<typeof useNavigate>
let registered: PaletteSource[] = []

function Where() {
  go = useNavigate()
  const loc = useLocation()
  return <p data-testid="at">{`${loc.pathname}${loc.search}`}</p>
}
const at = () => screen.getByTestId('at').textContent

function mount(path: string, session: SessionState = sales) {
  registered = []
  const palette: PaletteApi = {
    open: () => {},
    register: s => {
      registered.push(s)
      return () => {
        registered = registered.filter(x => x !== s)
      }
    },
  }
  return render(
    <SessionProvider value={session}>
      <PaletteContext.Provider value={palette}>
        <MemoryRouter initialEntries={['/today', path]} initialIndex={1}>
          <Where />
          <HelpHost />
        </MemoryRouter>
      </PaletteContext.Provider>
    </SessionProvider>,
  )
}

afterEach(() => window.localStorage.clear())

describe('HelpHost: one Help for the whole app', () => {
  it('a ?help=<id> address opens that recipe (deep link); closing removes it and stays on the page', async () => {
    const user = userEvent.setup()
    mount('/rfqs?help=new-rfq')
    const panel = await screen.findByRole('dialog', { name: 'Help' })
    expect(within(panel).getByRole('heading', { name: /Log a new enquiry/ })).toBeInTheDocument()
    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Help' })).toBeNull())
    expect(at()).toBe('/rfqs')
  })

  it('Back closes Help when it was opened in the app', async () => {
    mount('/rfqs')
    await waitFor(() => expect(registered.some(s => s.group === HELP_GROUP)).toBe(true))
    const source = registered.find(s => s.group === HELP_GROUP) as PaletteSource
    const row = (await source.search?.('how quote', new AbortController().signal)) ?? []
    act(() => row.find(r => r.label === 'Send a quotation to the customer')?.onSelect?.({ newTab: false }))
    expect(at()).toBe('/rfqs?help=issue-quotation')
    await screen.findByRole('dialog', { name: 'Help' })
    act(() => go(-1))
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Help' })).toBeNull())
    expect(at()).toBe('/rfqs')
  })

  it('stays open when the person follows a step to another page; Back is not carried', async () => {
    mount('/today?help=new-rfq')
    const before = await screen.findByRole('dialog', { name: 'Help' })
    act(() => go('/rfqs/new'))
    await waitFor(() => expect(at()).toBe('/rfqs/new?help=new-rfq'))
    // The same panel, not a new one: it does not flash or lose its place.
    expect(screen.getByRole('dialog', { name: 'Help' })).toBe(before)
    act(() => go(-1))
    await waitFor(() => expect(at()).toBe('/today?help=new-rfq'))
  })

  it('renders nothing while nobody is signed in', () => {
    mount('/rfqs?help=new-rfq', { status: 'signed-out' })
    expect(screen.queryByRole('dialog')).toBeNull()
  })
})

describe('palette "How do I…" group', () => {
  const open = vi.fn()
  const src = helpPaletteSource(allRecipes(), 'sales', '/money/receivables', open)
  const run = async (q: string) => (await src.search?.(q, new AbortController().signal)) ?? []

  it('with nothing typed: up to 3 recipes for this screen', () => {
    const idle = src.idle?.() ?? []
    expect(idle.length).toBeGreaterThan(0)
    expect(idle.length).toBeLessThanOrEqual(3)
    expect(idle.map(i => i.label)).toContain('Remind a customer to pay')
  })

  it('typed words find recipes for the role (at most 5); "help" alone lists them all with Open Help first', async () => {
    const found = await run('payment')
    expect(found.map(i => i.label)).toContain('Remind a customer to pay')
    expect(found.length).toBeLessThanOrEqual(5)
    expect(found.map(i => i.label)).not.toContain('Record a payment received')
    const all = await run('help')
    expect(all[0].label).toBe('Open Help')
    expect(all.length).toBeGreaterThan(5)
    all[0].onSelect?.({ newTab: false })
    expect(open).toHaveBeenCalledWith(null)
  })
})
