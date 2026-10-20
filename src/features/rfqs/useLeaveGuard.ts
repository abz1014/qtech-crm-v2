import { useContext, useEffect, useRef } from 'react'
import { UNSAFE_NavigationContext, useLocation } from 'react-router-dom'

/*
 * Warn before leaving a screen with work on it (UX audit 2026-10-19, S1: "one tap on a bottom tab throws away the pasted items").
 *
 * Two routes out are covered:
 *   - closing the tab, reloading, typing an address: the browser's own "Leave site?" (beforeunload);
 *   - moving inside the app (a tab, a link, the palette, a shortcut): the router's push and replace are held while `when` is
 *     true and `onBlocked` gets a `proceed` to call if the person chooses to leave.
 * The app uses <BrowserRouter>, not a data router, so react-router's useBlocker is not available; this wraps the router's own
 * navigator instead (the same object every Link and navigate() go through). A move that stays on this path (a search parameter)
 * is never held. The browser's Back button cannot be held without a data router; the New RFQ draft is kept on the device anyway.
 */
type Nav = { push: (...args: unknown[]) => void; replace: (...args: unknown[]) => void }

const pathnameOf = (to: unknown): string | undefined => (typeof to === 'string' ? to.split(/[?#]/)[0] : (to as { pathname?: string } | null)?.pathname)

export function useLeaveGuard(when: boolean, onBlocked: (proceed: () => void) => void): void {
  const { navigator } = useContext(UNSAFE_NavigationContext)
  const { pathname } = useLocation()
  const live = useRef({ when, onBlocked, pathname })
  live.current = { when, onBlocked, pathname }

  useEffect(() => {
    const nav = navigator as unknown as Nav
    const push = nav.push
    const replace = nav.replace
    const hold =
      (go: (...args: unknown[]) => void) =>
      (...args: unknown[]) => {
        const target = pathnameOf(args[0])
        const { when: on, onBlocked: ask, pathname: here } = live.current
        if (!on || target === undefined || target === '' || target === here) return go.apply(nav, args)
        ask(() => go.apply(nav, args))
      }
    nav.push = hold(push)
    nav.replace = hold(replace)
    return () => {
      nav.push = push
      nav.replace = replace
    }
  }, [navigator])

  useEffect(() => {
    if (!when) return
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault()
      e.returnValue = ''
    }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [when])
}
