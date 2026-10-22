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
 * is never held.
 *   - the browser's (or Android's) Back button (HW-49): while `when` is true one same-URL history entry is added, carrying a mark
 *     in history.state (the way useBackToClose holds Back for a sheet). Back pops it, the entry is put straight back (so the
 *     person stays) and `onBlocked` is asked; its `proceed` takes that entry off again and goes back for real. When `when` turns
 *     false (saved, emptied) the entry is taken off, so Back means what it always did. A sheet open at the time is left to
 *     useBackToClose: the entry is added once no sheet is open.
 */
type Nav = { push: (...args: unknown[]) => void; replace: (...args: unknown[]) => void }

const pathnameOf = (to: unknown): string | undefined => (typeof to === 'string' ? to.split(/[?#]/)[0] : (to as { pathname?: string } | null)?.pathname)

const MARK = '__qtechLeave'
const SHEETS = '__qtechSheets' // useBackToClose's mark
type State = Record<string, unknown> | null
const current = (): State => window.history.state as State
const ours = (s: State) => s?.[MARK] === true
const sheetOpen = (s: State) => Array.isArray(s?.[SHEETS]) && (s?.[SHEETS] as unknown[]).length > 0

/** The Back-button entry: added while armed, and taken off (waiting for any sheet above it to go first) before leaving. */
function backGuard() {
  let armed = false
  let leaving = false
  const once = (fn: () => void) => {
    const on = () => {
      window.removeEventListener('popstate', on)
      clearTimeout(fallback)
      fn()
    }
    // a traversal that never fires popstate must not leave the person stuck
    const fallback = setTimeout(on, 600)
    window.addEventListener('popstate', on)
  }
  const arm = () => {
    if (armed || leaving || sheetOpen(current())) return
    window.history.pushState({ ...(current() ?? {}), [MARK]: true }, '')
    armed = true
  }
  /** Take our entry off (after any sheet above it), then run `then`. */
  const unwind = (then: () => void) => {
    leaving = true
    let waits = 0
    const step = () => {
      const s = current()
      // the confirm sheet's own entry goes first (useBackToClose takes it off as the sheet closes); not forever
      if (sheetOpen(s) && waits++ < 2) return once(step)
      if (armed && ours(s)) {
        armed = false
        once(then)
        window.history.back()
        return
      }
      armed = false
      then()
    }
    step()
  }
  const drop = () => {
    armed = false
  }
  return { arm, unwind, drop, isArmed: () => armed, isLeaving: () => leaving }
}

export function useLeaveGuard(when: boolean, onBlocked: (proceed: () => void) => void): void {
  const { navigator } = useContext(UNSAFE_NavigationContext)
  const { pathname } = useLocation()
  const live = useRef({ when, onBlocked, pathname })
  live.current = { when, onBlocked, pathname }
  const guard = useRef<ReturnType<typeof backGuard> | null>(null)

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
        // Leaving: our Back entry comes off first, so the page left behind is one entry, not two.
        ask(() => (guard.current ? guard.current.unwind(() => go.apply(nav, args)) : go.apply(nav, args)))
      }
    nav.push = hold(push)
    nav.replace = hold(replace)
    return () => {
      nav.push = push
      nav.replace = replace
    }
  }, [navigator])

  // Back (HW-49).
  useEffect(() => {
    if (!when || typeof window === 'undefined') return
    const g = backGuard()
    guard.current = g
    g.arm()
    const onPop = (e: PopStateEvent) => {
      if (g.isLeaving()) return
      const s = e.state as State
      if (ours(s)) return // a sheet above our entry was closed
      if (!g.isArmed()) return g.arm() // a sheet closed before we could add the entry
      // Back popped our entry: put it back (stay), and ask.
      g.drop()
      g.arm()
      live.current.onBlocked(() => g.unwind(() => window.history.back()))
    }
    window.addEventListener('popstate', onPop)
    return () => {
      window.removeEventListener('popstate', onPop)
      if (guard.current === g) guard.current = null
      // Nothing to protect any more (saved, emptied): take the entry off while it is still the one on screen.
      if (g.isArmed() && !g.isLeaving() && ours(current()) && !sheetOpen(current())) {
        g.drop()
        window.history.back()
      }
    }
  }, [when])

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
