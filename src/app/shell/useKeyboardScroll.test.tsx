import { act, render } from '@testing-library/react'
import { useRef, type ReactNode } from 'react'
import { describe, expect, it } from 'vitest'
import { needsTabStop, useKeyboardScroll } from '@/app/shell/useKeyboardScroll'

/** jsdom has no layout: scrollHeight and clientHeight are set by hand. */
function scrolling(el: HTMLElement, scrolls: boolean) {
  Object.defineProperty(el, 'scrollHeight', { configurable: true, value: scrolls ? 2000 : 500 })
  Object.defineProperty(el, 'clientHeight', { configurable: true, value: 500 })
}

function Main({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLElement>(null)
  useKeyboardScroll(ref)
  return (
    <main ref={ref} id="main" tabIndex={-1}>
      {children}
    </main>
  )
}

describe('a scrolling <main> the keyboard can reach (audit 1 minor 27)', () => {
  it('needs a Tab stop only when it scrolls and holds nothing to Tab to', () => {
    const el = document.createElement('main')
    el.innerHTML = '<p>Tax deadlines</p>'
    scrolling(el, true)
    expect(needsTabStop(el)).toBe(true)
    scrolling(el, false)
    expect(needsTabStop(el)).toBe(false)
    el.innerHTML = '<p>Tax deadlines</p><a href="/settings">Settings</a>'
    scrolling(el, true)
    expect(needsTabStop(el)).toBe(false)
    el.innerHTML = '<button disabled>Save</button><h1 tabindex="-1">Title</h1>'
    expect(needsTabStop(el)).toBe(true)
  })

  it('joins the Tab order with its ring marker while that holds; otherwise keeps tabIndex -1', async () => {
    const proto = HTMLElement.prototype
    const sh = Object.getOwnPropertyDescriptor(proto, 'scrollHeight')
    const ch = Object.getOwnPropertyDescriptor(proto, 'clientHeight')
    Object.defineProperty(proto, 'scrollHeight', { configurable: true, get: () => 2000 })
    Object.defineProperty(proto, 'clientHeight', { configurable: true, get: () => 500 })
    try {
      const { container, rerender } = render(<Main><p>Only words</p></Main>)
      const main = container.querySelector('main') as HTMLElement
      expect(main.tabIndex).toBe(0)
      expect(main.hasAttribute('data-tab-scroll')).toBe(true)
      rerender(<Main><button type="button">Add</button></Main>)
      await act(async () => new Promise(r => requestAnimationFrame(() => r(undefined))))
      expect(main.tabIndex).toBe(-1)
      expect(main.hasAttribute('data-tab-scroll')).toBe(false)
    } finally {
      if (sh) Object.defineProperty(proto, 'scrollHeight', sh)
      if (ch) Object.defineProperty(proto, 'clientHeight', ch)
    }
  })
})
