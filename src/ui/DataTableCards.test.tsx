import { useState } from 'react'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DataTable, type Column } from '@/ui/DataTable'

/* DataTable phone cards: below 640px a row is one stacked card (mobileRow); keyboard and selection still work. */
interface R { id: string; name: string }
const ROWS: R[] = [{ id: 'a', name: 'Alpha' }, { id: 'b', name: 'Bravo' }, { id: 'c', name: 'Charlie' }]
const cols: Column<R>[] = [{ id: 'name', header: 'Name', value: r => r.name }]

function phone(on: boolean) {
  window.matchMedia = ((q: string) => ({
    matches: on && q.includes('max-width: 639px'),
    media: q,
    addEventListener() {},
    removeEventListener() {},
    addListener() {},
    removeListener() {},
    dispatchEvent: () => false,
    onchange: null,
  })) as typeof window.matchMedia
}
afterEach(() => vi.restoreAllMocks())

function Harness({ opened, withSelection = false }: { opened?: (r: R) => void; withSelection?: boolean }) {
  const [sel, setSel] = useState<Set<string>>(new Set())
  return (
    <DataTable
      label="People"
      columns={cols}
      rows={ROWS}
      getRowId={r => r.id}
      onRowOpen={opened}
      selection={withSelection ? { selected: sel, onChange: setSel, rowLabel: r => r.name } : undefined}
      mobileRow={r => <span data-testid="card">{r.name} card</span>}
    />
  )
}

describe('DataTable mobileRow', () => {
  it('draws cards on a phone, with every row still a row of the table', () => {
    phone(true)
    render(<Harness />)
    expect(screen.getAllByTestId('card')).toHaveLength(3)
    const table = screen.getByRole('table', { name: 'People' })
    expect(within(table).getAllByRole('row').filter(r => r.hasAttribute('data-card'))).toHaveLength(3)
    expect(screen.queryByRole('cell', { name: 'Alpha' })).toBeNull()
  })

  it('keeps the ordinary table on wider screens', () => {
    phone(false)
    render(<Harness />)
    expect(screen.queryAllByTestId('card')).toHaveLength(0)
    expect(screen.getByRole('cell', { name: 'Alpha' })).toBeInTheDocument()
  })

  it('a tap on the card opens the row, and Enter and the arrows work from the keyboard', async () => {
    phone(true)
    const opened = vi.fn()
    const user = userEvent.setup()
    render(<Harness opened={opened} />)
    await user.click(screen.getByText('Bravo card'))
    expect(opened).toHaveBeenLastCalledWith(ROWS[1])
    const rows = screen.getAllByRole('row').filter(r => r.hasAttribute('data-card'))
    rows[0].focus()
    await user.keyboard('{ArrowDown}{Enter}')
    expect(opened).toHaveBeenLastCalledWith(ROWS[1])
  })

  it('keeps selection: the checkbox ticks the card', async () => {
    phone(true)
    const user = userEvent.setup()
    render(<Harness withSelection />)
    await user.click(screen.getByRole('checkbox', { name: 'Select Alpha' }))
    expect(screen.getByRole('checkbox', { name: 'Select Alpha' })).toBeChecked()
    expect(screen.getAllByRole('row').find(r => r.hasAttribute('data-card'))).toHaveAttribute('aria-selected', 'true')
  })
})

describe('DataTable cardsApart, cardsBelow and onCardOpen', () => {
  it('cardsApart: each card is its own Forest card and the frame steps back; onCardOpen is what a tap on a card does', async () => {
    phone(true)
    const opened = vi.fn()
    const card = vi.fn()
    render(
      <DataTable label="People" columns={cols} rows={ROWS} getRowId={r => r.id} onRowOpen={opened} onCardOpen={card} cardsApart mobileRow={r => <span>{r.name} card</span>} />,
    )
    const root = document.querySelector('[data-table-root]')!
    expect(root.hasAttribute('data-cards-apart')).toBe(true)
    const rows = [...document.querySelectorAll('tr[data-card]')]
    expect(rows).toHaveLength(3)
    for (const r of rows) expect(r.className).toMatch(/rounded-card/)
    await userEvent.click(screen.getByText('Bravo card'))
    expect(card).toHaveBeenCalledWith(ROWS[1])
    expect(opened).not.toHaveBeenCalled()
  })

  it('cardsBelow: cards when the table box is narrower than the given rem, the full table when it is wider', () => {
    phone(false)
    const width = vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get')
    width.mockReturnValue(400)
    const { unmount } = render(<DataTable label="People" columns={cols} rows={ROWS} getRowId={r => r.id} cardsBelow={36} mobileRow={r => <span>{r.name} card</span>} />)
    expect(document.querySelectorAll('tr[data-card]')).toHaveLength(3)
    unmount()
    width.mockReturnValue(900)
    render(<DataTable label="People" columns={cols} rows={ROWS} getRowId={r => r.id} cardsBelow={36} mobileRow={r => <span>{r.name} card</span>} />)
    expect(document.querySelectorAll('tr[data-card]')).toHaveLength(0)
    expect(screen.getByRole('cell', { name: 'Alpha' })).toBeInTheDocument()
  })

  it('a fixed width cuts text, never a column of row actions (hidden header) or one marked truncate: false', () => {
    phone(false)
    const c: Column<R>[] = [
      { id: 'name', header: 'Name', value: r => r.name, width: 80 },
      { id: 'note', header: 'Note', value: r => r.name, width: 80, truncate: false },
      { id: 'actions', header: 'Actions', hiddenHeader: true, width: '5rem', cell: r => <button type="button">Edit {r.name}</button> },
    ]
    render(<DataTable label="People" columns={c} rows={ROWS.slice(0, 1)} getRowId={r => r.id} />)
    const [name, note, actions] = [...document.querySelectorAll('tbody tr td')]
    expect(name.className).toMatch(/\btruncate\b/)
    expect(note.className).not.toMatch(/\btruncate\b/)
    expect(actions.className).not.toMatch(/\btruncate\b/)
    expect(actions.className).toMatch(/whitespace-nowrap/)
    expect((actions as HTMLElement).style.maxWidth).toBe('')
  })
})
