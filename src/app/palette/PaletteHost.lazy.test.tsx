import { act, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import { PaletteHost } from '@/app/palette/PaletteHost'

// Its own file, so the palette chunk is cold: the shortcut is pressed before the lazy palette has mounted (perf/trim).
describe('PaletteHost with the lazy palette', () => {
  it('Ctrl+K pressed before the palette chunk has loaded still opens it, and never reaches the browser', async () => {
    render(
      <MemoryRouter>
        <PaletteHost role="sales">
          <p>Page</p>
        </PaletteHost>
      </MemoryRouter>,
    )
    expect(screen.queryByRole('dialog')).toBeNull()
    const e = new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, bubbles: true, cancelable: true })
    act(() => {
      window.dispatchEvent(e)
    })
    expect(e.defaultPrevented).toBe(true)
    expect(await screen.findByRole('dialog', { name: 'Search or jump to' })).toBeInTheDocument()

    // Once mounted, the palette's own listener answers alone: Ctrl+K closes it (one toggle, not two).
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, bubbles: true, cancelable: true }))
    })
    expect(screen.queryByRole('dialog', { name: 'Search or jump to' })).toBeNull()
  })
})
