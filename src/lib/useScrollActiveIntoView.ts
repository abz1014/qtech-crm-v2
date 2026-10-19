import { useLayoutEffect, useRef } from 'react'

/**
 * A row of tabs that scrolls sideways on a phone must show the tab you are on. After every render the active tab
 * (`aria-current="page"`, `aria-selected="true"` or a checked or active Radix state) is brought inside the strip by moving the strip only; the page is never
 * scrolled, which `scrollIntoView` would do.
 */
export function useScrollActiveIntoView<T extends HTMLElement>() {
  const ref = useRef<T>(null)
  useLayoutEffect(() => {
    const strip = ref.current
    const tab = strip?.querySelector<HTMLElement>('[aria-current="page"], [aria-selected="true"], [data-state="checked"], [data-state="active"]')
    if (!strip || !tab || strip.scrollWidth <= strip.clientWidth) return
    const stripBox = strip.getBoundingClientRect()
    const tabBox = tab.getBoundingClientRect()
    const margin = 12
    if (tabBox.left < stripBox.left + margin) strip.scrollLeft -= stripBox.left + margin - tabBox.left
    else if (tabBox.right > stripBox.right - margin) strip.scrollLeft += tabBox.right - (stripBox.right - margin)
  })
  return ref
}
