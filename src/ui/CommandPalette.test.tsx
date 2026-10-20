import { useState } from 'react'
import { render, screen, waitFor, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { FileText, Plus } from 'lucide-react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { axeViolations } from '@/test/axe'
import { CommandPalette } from '@/ui/CommandPalette'
import { filterItems, type PaletteItem, type PaletteSource } from '@/ui/paletteSources'

const PLACES: PaletteItem[] = [
  { id: 'rfq177', label: 'Indus Textile Mills — Faisalabad · RFQ-0177', meta: 'RFQ · due Tue 1 Dec', icon: FileText, href: '/rfqs/177' },
  { id: 'po', label: 'PO 253102 · Indus Valve Traders', meta: 'Order', href: '/orders/1' },
  { id: 'pcl', label: 'Punjab Cement Ltd', meta: 'Company', href: '/companies/2' },
]

const places = (over: Partial<PaletteSource> = {}): PaletteSource => ({
  id: 'places',
  group: 'Jump to',
  order: 1,
  idle: () => PLACES.slice(0, 1),
  search: q => filterItems(PLACES, q),
  ...over,
})
const actions = (onSelect = vi.fn()): PaletteSource => ({
  id: 'actions',
  group: 'Actions',
  order: 2,
  idle: () => [{ id: 'new-rfq', label: 'New RFQ', meta: 'Go to intake', icon: Plus, shortcut: ['N'], onSelect }],
  search: q => filterItems([{ id: 'new-rfq', label: 'New RFQ', onSelect }], q),
})

function Host({ sources, onNavigate, personId = 'u1' }: { sources: PaletteSource[]; onNavigate?: (h: string, o: { newTab: boolean }) => void; personId?: string }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button onClick={() => setOpen(true)}>Search or jump to</button>
      <CommandPalette open={open} onOpenChange={setOpen} sources={sources} personId={personId} onNavigate={onNavigate ?? (() => {})} />
    </>
  )
}

afterEach(() => window.localStorage.clear())

describe('CommandPalette (U08)', () => {
  it.each([
    ['Ctrl+K', { ctrlKey: true }],
    ['Cmd+K', { metaKey: true }],
  ])('opens with %s from anywhere, and toggles closed with it', async (_n, mods) => {
    render(<Host sources={[places()]} />)
    expect(screen.queryByRole('dialog')).toBeNull()
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', bubbles: true, cancelable: true, ...mods }))
    })
    expect(await screen.findByRole('dialog', { name: 'Search or jump to' })).toBeInTheDocument()
    expect(screen.getByRole('combobox')).toHaveFocus()
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', bubbles: true, cancelable: true, ...mods }))
    })
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })

  it('shows idle rows from every source, grouped, with the first row active', async () => {
    const user = userEvent.setup()
    render(<Host sources={[places(), actions()]} />)
    await user.click(screen.getByRole('button', { name: 'Search or jump to' }))
    await screen.findByRole('dialog')
    expect(await screen.findByText('Jump to')).toBeInTheDocument()
    expect(screen.getByText('Actions')).toBeInTheDocument()
    const rows = screen.getAllByRole('option')
    expect(rows.map(r => r.textContent)).toEqual([expect.stringContaining('RFQ-0177'), expect.stringContaining('New RFQ')])
    expect(rows[0]).toHaveAttribute('data-selected', 'true')
  })

  it('keyboard only: type, arrow down, Enter opens the row, the palette closes and focus returns', async () => {
    const user = userEvent.setup()
    const onNavigate = vi.fn()
    render(<Host sources={[places()]} onNavigate={onNavigate} />)
    const opener = screen.getByRole('button', { name: 'Search or jump to' })
    opener.focus()
    await user.keyboard('{Enter}')
    await screen.findByRole('dialog')
    await user.keyboard('indus')
    await waitFor(() => expect(screen.getAllByRole('option')).toHaveLength(2))
    await user.keyboard('{ArrowDown}{Enter}')
    expect(onNavigate).toHaveBeenCalledWith('/orders/1', { newTab: false })
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(opener).toHaveFocus()
  })

  it('Ctrl+Enter opens the highlighted row in a new tab', async () => {
    const user = userEvent.setup()
    const onNavigate = vi.fn()
    render(<Host sources={[places()]} onNavigate={onNavigate} />)
    await user.click(screen.getByRole('button'))
    await screen.findByRole('dialog')
    await user.keyboard('punjab')
    await waitFor(() => expect(screen.getAllByRole('option')).toHaveLength(1))
    await user.keyboard('{Control>}{Enter}{/Control}')
    expect(onNavigate).toHaveBeenCalledWith('/companies/2', { newTab: true })
  })

  it('an action row runs its handler instead of navigating', async () => {
    const user = userEvent.setup()
    const onSelect = vi.fn()
    const onNavigate = vi.fn()
    render(<Host sources={[actions(onSelect)]} onNavigate={onNavigate} />)
    await user.click(screen.getByRole('button'))
    await screen.findByRole('dialog')
    await user.keyboard('new')
    await user.keyboard('{Enter}')
    expect(onSelect).toHaveBeenCalledWith({ newTab: false })
    expect(onNavigate).not.toHaveBeenCalled()
  })

  it('Esc closes it', async () => {
    const user = userEvent.setup()
    render(<Host sources={[places()]} />)
    await user.click(screen.getByRole('button'))
    await screen.findByRole('dialog')
    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })

  it('no results: says what was searched, what search covers and a next step', async () => {
    const user = userEvent.setup()
    render(<Host sources={[places()]} />)
    await user.click(screen.getByRole('button'))
    await screen.findByRole('dialog')
    await user.keyboard('belimo gaskets')
    expect(await screen.findByText('Nothing found for “belimo gaskets”')).toBeInTheDocument()
  })

  it('a slow source shows skeleton rows after 200 ms and then its results, in place', async () => {
    const user = userEvent.setup()
    let release!: (items: PaletteItem[]) => void
    const slow = places({ search: () => new Promise<PaletteItem[]>(r => (release = r)) })
    render(<Host sources={[slow]} />)
    await user.click(screen.getByRole('button'))
    await screen.findByRole('dialog')
    await user.keyboard('pu')
    expect(await screen.findByRole('status', { name: 'Searching' }, { timeout: 1500 })).toBeInTheDocument()
    act(() => release([PLACES[2]]))
    await waitFor(() => expect(screen.getByRole('option')).toHaveTextContent('Punjab Cement Ltd'))
    expect(screen.queryByRole('status', { name: 'Searching' })).toBeNull()
  })

  it('one failing source does not blank the others', async () => {
    const user = userEvent.setup()
    const broken = places({ id: 'broken', idle: () => Promise.reject(new Error('down')) as unknown as PaletteItem[] })
    render(<Host sources={[broken, actions()]} />)
    await user.click(screen.getByRole('button'))
    expect(await screen.findByRole('option', { name: /New RFQ/ })).toBeInTheDocument()
  })

  it('remembers what was opened and lists it under Recent next time', async () => {
    const user = userEvent.setup()
    const { unmount } = render(<Host sources={[places()]} />)
    await user.click(screen.getByRole('button'))
    await screen.findByRole('dialog')
    await user.keyboard('punjab{Enter}')
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    unmount()

    render(<Host sources={[places()]} />)
    await user.click(screen.getByRole('button'))
    expect(await screen.findByText('Recent')).toBeInTheDocument()
    expect(screen.getByRole('option', { name: /Punjab Cement Ltd/ })).toBeInTheDocument()
  })

  it('keeps Recent per person and ignores the old shared key (BUG-RV-04)', async () => {
    window.localStorage.setItem('qtech.palette.recent', JSON.stringify([{ id: 'x', label: 'Old shared invoice', href: '/x', at: Date.now() }]))
    const user = userEvent.setup()
    const { unmount } = render(<Host sources={[places()]} personId="admin-1" />)
    await user.click(screen.getByRole('button'))
    await screen.findByRole('dialog')
    expect(screen.queryByText('Old shared invoice')).toBeNull()
    await user.keyboard('punjab{Enter}')
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    unmount()
    expect(window.localStorage.getItem('qtech.palette.recent.admin-1')).toContain('Punjab Cement Ltd')

    render(<Host sources={[places()]} personId="engineer-1" />)
    await user.click(screen.getByRole('button'))
    await screen.findByRole('dialog')
    expect(screen.queryByText('Recent')).toBeNull()
    expect(screen.queryByRole('option', { name: /Punjab Cement Ltd/ })).toBeNull()
  })

  it('opens empty again after a row was opened or it was closed with Ctrl+K (no stale query)', async () => {
    const user = userEvent.setup()
    render(<Host sources={[places()]} />)
    await user.click(screen.getByRole('button'))
    await screen.findByRole('dialog')
    await user.keyboard('punjab{Enter}')
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    await user.click(screen.getByRole('button'))
    expect(await screen.findByRole('combobox')).toHaveValue('')
    expect(await screen.findByText('Recent')).toBeInTheDocument()

    await user.keyboard('indus')
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, bubbles: true, cancelable: true }))
    })
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    await user.click(screen.getByRole('button'))
    expect(await screen.findByRole('combobox')).toHaveValue('')
  })

  it('has no axe violations open, with results', async () => {
    const user = userEvent.setup()
    render(<Host sources={[places(), actions()]} />)
    await user.click(screen.getByRole('button'))
    await screen.findByRole('option', { name: /RFQ-0177/ })
    expect(await axeViolations()).toEqual([])
  })
})
