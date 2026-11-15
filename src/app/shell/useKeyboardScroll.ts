import { useEffect, type RefObject } from 'react'

/** What a person can Tab to inside a page. */
const TABBABLE = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), summary, [tabindex]:not([tabindex="-1"]), [contenteditable="true"]'

/** Drawn and reachable: not display:none (a phone hides the desktop breadcrumb and sub-nav), not hidden, not inert. */
function reachable(e: Element): boolean {
  if (e.closest('[inert], [aria-hidden="true"]')) return false
  if (typeof (e as HTMLElement).getClientRects === 'function' && e.getClientRects().length === 0 && document.body.getClientRects().length > 0) return false
  return getComputedStyle(e).visibility !== 'hidden'
}

/** True when the scroller scrolls and nothing inside it can be reached with Tab (so the keyboard could not scroll it). */
export function needsTabStop(el: HTMLElement): boolean {
  return el.scrollHeight > el.clientHeight + 1 && !Array.from(el.querySelectorAll(TABBABLE)).some(reachable)
}

/**
 * The shell's <main> scrolls, not the document. A page with nothing to Tab to (a read-only list such as Tax deadlines for
 * sales) could then not be scrolled from the keyboard at all (axe scrollable-region-focusable, WCAG 2.1.1; audit 1 minor 27).
 * While that is so, <main> itself joins the Tab order (tabIndex 0, data-tab-scroll draws its ring); every other page keeps
 * tabIndex -1, so no extra Tab stop appears where the page has its own controls. Checked after each change to the page, at
 * most once a frame.
 */
export function useKeyboardScroll(ref: RefObject<HTMLElement | null>): void {
  useEffect(() => {
    const el = ref.current
    if (!el) return
    let frame = 0
    const check = () => {
      frame = 0
      const stop = needsTabStop(el)
      el.tabIndex = stop ? 0 : -1
      el.toggleAttribute('data-tab-scroll', stop)
    }
    const soon = () => {
      if (!frame) frame = requestAnimationFrame(check)
    }
    check()
    const mo = new MutationObserver(soon)
    mo.observe(el, { childList: true, subtree: true, attributes: true, attributeFilter: ['href', 'disabled', 'tabindex', 'hidden'] })
    const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(soon)
    ro?.observe(el)
    return () => {
      mo.disconnect()
      ro?.disconnect()
      if (frame) cancelAnimationFrame(frame)
    }
  }, [ref])
}
