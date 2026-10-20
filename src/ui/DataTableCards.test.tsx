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
    matches: on && q.includes('max-width: 767px'),
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
