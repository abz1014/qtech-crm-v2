import '@testing-library/jest-dom/vitest'
import { afterEach } from 'vitest'
import { cleanup, configure } from '@testing-library/react'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

afterEach(() => cleanup())

// The Radix half of Popover is a lazy chunk in the app (src/ui/Popover.tsx); here it is loaded up front, so a popover is the real one from the first render.
const { preloadPopover } = await import('@/ui/popoverStore')
await preloadPopover()

/*
 * findBy*, waitFor and waitForElementToBeRemoved give up after 1000 ms by default. Vitest runs ~200 jsdom files in parallel
 * workers, and the first render of a whole screen (Today, the palette, Help) plus the first transform of a lazy chunk is
 * CPU-bound: on a contended machine (a busy laptop, a shared CI runner) it passes 1 s and the lookup fails although the app
 * is fine. The failures were always "Unable to find role=..." on a screen still mid-render, never a wrong result. This only
 * raises the ceiling of a lookup that is still failing: a lookup that succeeds returns at once, and a real regression still
 * fails (after 10 s, well inside the 30 s testTimeout). 5 s was still not enough when three full runs shared one machine (NavCounts).
 */
configure({ asyncUtilTimeout: 10_000 })

// jsdom lacks these; Radix and cmdk call them.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.ResizeObserver ??= ResizeObserverStub as unknown as typeof ResizeObserver
Element.prototype.scrollIntoView ??= function scrollIntoView() {}
Element.prototype.hasPointerCapture ??= () => false
Element.prototype.setPointerCapture ??= () => {}
Element.prototype.releasePointerCapture ??= () => {}
window.matchMedia ??= ((query: string) => ({
  matches: false,
  media: query,
  onchange: null,
  addEventListener() {},
  removeEventListener() {},
  addListener() {},
  removeListener() {},
  dispatchEvent: () => false,
})) as typeof window.matchMedia
