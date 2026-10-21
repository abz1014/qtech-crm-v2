import { useState } from 'react'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PaletteContext, type PaletteApi } from '@/app/palette/usePalette'
import { FilterSheet } from '@/ui/FilterSheet'
import { NoResults } from '@/ui/NoResults'
import { SegmentedControl } from '@/ui/SegmentedControl'
import { NeedsCount } from '@/ui/Tag'
import { TableFilter } from '@/ui/TableFilter'

/* The shared list pieces of consistency spec 2 and 3: NeedsCount, TableFilter, FilterSheet, NoResults. */

afterEach(() => vi.restoreAllMocks())

function phoneWidth(phone: boolean) {
  vi.spyOn(window, 'matchMedia').mockImplementation(
    query =>
      ({
        matches: phone && /max-width: 639px/.test(query),
        media: query,
        onchange: null,
        addEventListener() {},
        removeEventListener() {},
        addListener() {},
        removeListener() {},
        dispatchEvent: () => false,
      }) as MediaQueryList,
  )
}

describe('NeedsCount', () => {
  it('draws the number, says ", N need you" to screen readers, and draws nothing for 0 or no count', () => {
    const { container, rerender } = render(<NeedsCount n={4} />)
    expect(container.querySelector('[data-needs-count="warning"]')).toHaveTextContent('4')
    expect(container.querySelector('[data-needs-count]')).toHaveAttribute('aria-hidden', 'true')
    expect(container).toHaveTextContent(', 4 need you')
    rerender(<NeedsCount n={2} variant="danger" sr="2 critical" />)
    expect(container.querySelector('[data-needs-count="danger"]')).toBeInTheDocument()
    expect(container).toHaveTextContent(', 2 critical')
    rerender(<NeedsCount n={140} badge />)
    expect(container.querySelector('[data-needs-count]')).toHaveTextContent('99+')
    expect(container).toHaveTextContent(', 140 need you')
    rerender(<NeedsCount n={0} />)
    expect(container).toBeEmptyDOMElement()
    rerender(<NeedsCount n={undefined} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('a segmented option takes `needs`, never a total', () => {
    render(<SegmentedControl aria-label="Show" value="a" onValueChange={() => undefined} options={[{ value: 'a', label: 'All' }, { value: 'b', label: 'Needs action', needs: 3 }, { value: 'c', label: 'Waiting', needs: 0 }]} />)
    expect(screen.getByRole('radio', { name: 'All' })).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: /^Needs action\s*, 3 need you$/ })).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: 'Waiting' })).toBeInTheDocument()
  })
})

describe('TableFilter', () => {
  function Harness({ hint }: { hint?: string }) {
    const [q, setQ] = useState('')
    return <TableFilter label="Search orders" hint={hint} value={q} onChange={setQ} />
  }

  it('is named and labelled "Search {plural}", announces / and its fields, shows the / key while empty and unfocused', async () => {
    const user = userEvent.setup()
    const { container } = render(<Harness hint="Finds an order by customer or PO." />)
    const box = screen.getByRole('textbox', { name: 'Search orders' })
    expect(box).toHaveAttribute('placeholder', 'Search orders')
    expect(box).toHaveAttribute('aria-keyshortcuts', '/')
    expect(box).toHaveAccessibleDescription('Finds an order by customer or PO.')
    expect(container.querySelector('kbd')).toHaveTextContent('/')
    await user.click(box)
    expect(container.querySelector('kbd')).toBeNull() // focused: the hint goes
    await user.type(box, 'acme')
    expect(container.querySelector('kbd')).toBeNull()
    await user.click(screen.getByRole('button', { name: 'Clear search' }))
    expect(box).toHaveValue('')
    expect(box).toHaveFocus()
    expect(screen.queryByRole('button', { name: 'Clear search' })).toBeNull()
  })

  it('Esc clears the text', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    const box = screen.getByRole('textbox', { name: 'Search orders' })
    await user.type(box, 'acme{Escape}')
    expect(box).toHaveValue('')
    expect(box).not.toHaveAccessibleDescription(/./)
  })
})

describe('FilterSheet', () => {
  function Harness() {
    const [on, setOn] = useState(2)
    return (
      <FilterSheet title="Filter orders" on={on} shown={on ? 1 : 12} noun={['order', 'orders']} onClear={() => setOn(0)} phoneOnly={<p>Owner switch</p>}>
        <p>The selects</p>
      </FilterSheet>
    )
  }

  it('640 and up: a popover with the filters, Clear while something is on, and "Show N orders" that closes it', async () => {
    phoneWidth(false)
    const user = userEvent.setup()
    render(<Harness />)
    await user.click(screen.getByRole('button', { name: 'Filters · 2 on' }))
    const pop = await screen.findByRole('dialog', { name: 'Filter orders' })
    expect(within(pop).getByText('The selects')).toBeInTheDocument()
    expect(within(pop).queryByText('Owner switch')).toBeNull() // the desktop keeps it on the toolbar
    await user.click(within(pop).getByRole('button', { name: 'Clear' }))
    expect(screen.getByRole('button', { name: 'Filters' })).toBeInTheDocument()
    expect(within(pop).queryByRole('button', { name: 'Clear' })).toBeNull()
    await user.click(within(pop).getByRole('button', { name: 'Show 12 orders' }))
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('below 640: a sheet that also holds the phone-only controls', async () => {
    phoneWidth(true)
    const user = userEvent.setup()
    render(<Harness />)
    await user.click(screen.getByRole('button', { name: 'Filters · 2 on' }))
    const sheet = await screen.findByRole('dialog', { name: 'Filter orders' })
    expect(within(sheet).getByText('Owner switch')).toBeInTheDocument()
    expect(within(sheet).getByText('The selects')).toBeInTheDocument()
    await user.click(within(sheet).getByRole('button', { name: 'Show 1 order' }))
    expect(screen.queryByRole('dialog')).toBeNull()
  })
})

describe('NoResults', () => {
  const palette = (open: PaletteApi['open']): PaletteApi => ({ open, register: () => () => undefined })

  it('says what was searched and how, clears, and hands the words to the palette', async () => {
    const user = userEvent.setup()
    const open = vi.fn()
    const clear = vi.fn()
    render(
      <PaletteContext.Provider value={palette(open)}>
        <NoResults query=" belimo " scope="orders" fields="customer, item and PO" onClear={clear} />
      </PaletteContext.Provider>,
    )
    expect(screen.getByText('Nothing matches "belimo"')).toBeInTheDocument()
    expect(screen.getByText('Searched orders by customer, item and PO.')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Clear search' }))
    expect(clear).toHaveBeenCalledTimes(1)
    await user.click(screen.getByRole('button', { name: 'Search everywhere for "belimo"' }))
    expect(open).toHaveBeenCalledWith('belimo')
  })

  it('names the filters that are on, and has no palette action without text or outside the shell', () => {
    const { rerender } = render(<NoResults query="acme" scope="orders" fields="customer" filtersOn={['Goods: Late', 'Waiting']} onClear={() => undefined} />)
    expect(screen.getByText(/Filters on: Goods: Late, Waiting\./)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Clear search and filters' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Search everywhere/ })).toBeNull() // no PaletteHost here
    rerender(
      <PaletteContext.Provider value={palette(vi.fn())}>
        <NoResults query="" scope="orders" fields="customer" filtersOn={['Goods: Late']} onClear={() => undefined} />
      </PaletteContext.Provider>,
    )
    expect(screen.getByText('Nothing matches these filters')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Clear the filters' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Search everywhere/ })).toBeNull()
  })
})
