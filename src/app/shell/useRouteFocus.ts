import { useEffect, useRef } from 'react'
import { useNavigationType } from 'react-router-dom'

/*
 * Route change (WCAG 2.4.3, 2.4.2, 4.1.3): when the path changes, reset the #main scroll, move focus to the page h1
 * (or #main while it loads) so screen readers hear the new page, and title the tab after the h1:
 * "RFQ-0177 · RFQs · Q-Tech CRM". Search-parameter changes (filters, tabs) keep focus and scroll where they are.
 * The first render does not move focus: the browser's own load already starts at the top. A redirect (REPLACE) does not
 * move focus either, and Back or Forward (POP) keeps the scroll the phone platform restores.
 */
const APP = 'Q-Tech CRM'

export function useRouteFocus(pathname: string, section: string | null) {
  const first = useRef(true)
  const nav = useNavigationType()
  const navRef = useRef(nav)
  navRef.current = nav
  useEffect(() => {
    const main = document.getElementById('main')
    const base = section ? `${section} · ${APP}` : APP
    document.title = base
    const kind = navRef.current
    const moveFocus = !first.current && kind !== 'REPLACE'
    first.current = false
    if (moveFocus && kind === 'PUSH' && main) main.scrollTop = 0

    let done = false
    const settle = () => {
      const h1 = main?.querySelector('h1')
      const text = h1?.textContent?.trim()
      if (!h1 || !text) return false
      document.title = section && text !== section ? `${text} · ${base}` : base
      if (moveFocus) {
        const active = document.activeElement
        // Only take focus from the shell (a link, a tab, <body>), never from something the page already focused.
        if (!active || active === document.body || !main?.contains(active) || active === main) {
          if (!h1.hasAttribute('tabindex')) h1.setAttribute('tabindex', '-1')
          h1.focus({ preventScroll: true })
        }
      }
      return true
    }
    if (settle()) return
    if (moveFocus && main && (!document.activeElement || document.activeElement === document.body)) main.focus({ preventScroll: true })
    if (!main) return
    // The h1 often arrives after the data: watch for it for a few seconds.
    const obs = new MutationObserver(() => {
      if (!done && settle()) {
        done = true
        obs.disconnect()
      }
    })
    obs.observe(main, { childList: true, subtree: true, characterData: true })
    const stop = window.setTimeout(() => obs.disconnect(), 4000)
    return () => {
      obs.disconnect()
      window.clearTimeout(stop)
    }
  }, [pathname, section])
}
