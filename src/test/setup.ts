import '@testing-library/jest-dom/vitest'
import { afterEach } from 'vitest'
import { cleanup } from '@testing-library/react'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

afterEach(() => cleanup())

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
