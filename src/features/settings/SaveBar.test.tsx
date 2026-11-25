import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SaveBar } from '@/features/settings/settingsParts'

/*
 * Screen review 24 Nov 2026: the sticky "2 unsaved changes" bar covered a field and its error. A field that takes focus under the
 * bar is scrolled above it, its error included. jsdom has no layout, so the boxes are set here.
 */
function box(top: number, bottom: number): DOMRect {
  return { top, bottom, left: 0, right: 100, width: 100, height: bottom - top, x: 0, y: top, toJSON: () => ({}) } as DOMRect
}

function page(dirty: boolean) {
  return render(
    <main id="main">
      <input aria-label="Phone" aria-describedby="phone-error" />
      <p id="phone-error">Enter a phone number</p>
      <SaveBar dirty={dirty} message={dirty ? '1 unsaved change: Phone' : 'Nothing to save yet'}>
        <button type="button">Save changes</button>
      </SaveBar>
    </main>,
  )
}

describe('SaveBar keeps a focused field above it', () => {
  afterEach(() => vi.restoreAllMocks())

  function layout() {
    const main = document.getElementById('main') as HTMLElement
    const scrollBy = vi.fn()
    main.scrollBy = scrollBy as unknown as typeof main.scrollBy
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      if (this.hasAttribute('data-save-bar')) return box(700, 780)
      if (this.id === 'phone-error') return box(730, 750)
      if (this.getAttribute('aria-label') === 'Phone') return box(690, 728)
      return box(0, 0)
    })
    return scrollBy
  }

  it('scrolls the field and its error up above the bar when it takes focus under it', () => {
    page(true)
    const scrollBy = layout()
    fireEvent.focusIn(screen.getByRole('textbox', { name: 'Phone' }))
    // the error ends at 750, the bar starts at 700: 50 px, and an 8 px gap
    expect(scrollBy).toHaveBeenCalledWith({ top: 58 })
  })

  it('does nothing while nothing is unsaved (the bar is not sticky then)', () => {
    page(false)
    const scrollBy = layout()
    fireEvent.focusIn(screen.getByRole('textbox', { name: 'Phone' }))
    expect(scrollBy).not.toHaveBeenCalled()
  })

  it('does nothing for the bar own buttons', () => {
    page(true)
    const scrollBy = layout()
    fireEvent.focusIn(screen.getByRole('button', { name: 'Save changes' }))
    expect(scrollBy).not.toHaveBeenCalled()
  })
})
