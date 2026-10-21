import { act, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PaletteHost } from '@/app/palette/PaletteHost'
import { usePalette } from '@/app/palette/usePalette'

function Opener() {
  const { open } = usePalette()
  return (
    <>
      <button type="button" onClick={() => open('pump seal')}>
        Search for it
      </button>
      <button type="button" onClick={() => open()}>
        Plain open
      </button>
    </>
  )
}

function host() {
  return render(
    <MemoryRouter>
      <PaletteHost role="sales">
        <Opener />
      </PaletteHost>
    </MemoryRouter>,
  )
}

/** A desktop with a mouse: the shortcuts entries show only there. */
function desktop(matches: boolean) {
  vi.spyOn(window, 'matchMedia').mockImplementation(
    query =>
      ({
        matches,
        media: query,
        onchange: null,
        addEventListener() {},
        removeEventListener() {},
        addListener() {},
        removeListener() {},
        dispatchEvent: () => false,
      }) as unknown as MediaQueryList,
  )
}

afterEach(() => vi.restoreAllMocks())

describe('PaletteHost', () => {
  it('when nothing is found, the hint names everything search covers (contacts, invoices and POs included)', async () => {
    const user = userEvent.setup()
    host()
    await user.click(screen.getByRole('button', { name: 'Plain open' }))
    const dlg = await screen.findByRole('dialog', { name: 'Search or jump to' })
    await user.type(within(dlg).getByRole('combobox'), 'zzqqxx')
    const status = await within(dlg).findByText(/Search covers/)
    expect(status).toHaveTextContent('Search covers RFQs, orders, invoices, purchase orders, companies, contacts and order items.')
  })

  it('open(query) starts the search box with that text; a plain open, after closing, starts empty', async () => {
    const user = userEvent.setup()
    host()
    await user.click(screen.getByRole('button', { name: 'Search for it' }))
    const dlg = await screen.findByRole('dialog', { name: 'Search or jump to' })
    expect(within(dlg).getByRole('combobox')).toHaveValue('pump seal')
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).toBeNull()
    await user.click(screen.getByRole('button', { name: 'Plain open' }))
    expect(within(await screen.findByRole('dialog')).getByRole('combobox')).toHaveValue('')
    await user.keyboard('{Escape}')
    // Again, with the palette already loaded.
    await user.click(screen.getByRole('button', { name: 'Search for it' }))
    expect(within(await screen.findByRole('dialog')).getByRole('combobox')).toHaveValue('pump seal')
  })

  it('on a desktop, the idle Actions offer "Keyboard shortcuts", found by "keys" too, and it opens the sheet', async () => {
    desktop(true)
    const user = userEvent.setup()
    host()
    await user.click(screen.getByRole('button', { name: 'Plain open' }))
    const dlg = await screen.findByRole('dialog', { name: 'Search or jump to' })
    expect(await within(dlg).findByRole('option', { name: /Keyboard shortcuts/ })).toBeInTheDocument()
    expect(within(dlg).getByText('Shortcuts')).toBeInTheDocument() // the footer's "? Shortcuts"
    await user.type(within(dlg).getByRole('combobox'), 'keys')
    await user.click(await within(dlg).findByRole('option', { name: /Keyboard shortcuts/ }))
    expect(await screen.findByRole('dialog', { name: 'Keyboard shortcuts' })).toBeInTheDocument()
  })

  it('on a phone, there is no shortcuts entry', async () => {
    desktop(false)
    const user = userEvent.setup()
    host()
    await user.click(screen.getByRole('button', { name: 'Plain open' }))
    const dlg = await screen.findByRole('dialog', { name: 'Search or jump to' })
    await within(dlg).findByText('Actions')
    expect(within(dlg).queryByRole('option', { name: /Keyboard shortcuts/ })).toBeNull()
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    })
  })
})
