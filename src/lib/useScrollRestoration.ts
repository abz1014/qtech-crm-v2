import { useEffect, useLayoutEffect, useRef } from 'react'
import { useLocation, useNavigationType } from 'react-router-dom'

/*
 * Scroll position for the shell's own scroller (phone audit 3, "Scroll restoration"). The shell scrolls an inner
 * <main id="main">, which stays mounted across routes, and BrowserRouter has no ScrollRestoration (that needs a data
 * router), so a detail page could open part-way down and Back did not return to the list's place.
 *
 *  - A new page (PUSH or REPLACE to another path) starts at the top. A change of the query string alone (a filter,
 *    a tab) keeps the place.
 *  - Back and Forward (POP) return to where that history entry was left, keyed by location.key, even after a reload
 *    (kept in sessionStorage, the last MAX_ENTRIES entries). The content may still be loading: the restore waits for the
 *    page to grow tall enough, for up to RESTORE_WAIT_MS, and gives up at once if the person scrolls or types.
 *  - A history entry that only closes a sheet (useBackToClose) keeps the same key, so it moves nothing.
 */
const STORE_KEY = 'qtech.scroll'
const MAX_ENTRIES = 60
const RESTORE_WAIT_MS = 1500

function load(): Map<string, number> {
  try {
    const raw = window.sessionStorage.getItem(STORE_KEY)
    const pairs = raw ? (JSON.parse(raw) as unknown) : []
    return new Map(Array.isArray(pairs) ? pairs.filter((p): p is [string, number] => Array.isArray(p) && typeof p[0] === 'string' && typeof p[1] === 'number') : [])
  } catch {
    return new Map()
  }
}

function save(positions: Map<string, number>): void {
  try {
    window.sessionStorage.setItem(STORE_KEY, JSON.stringify([...positions].slice(-MAX_ENTRIES)))
  } catch {
    /* storage blocked: places are kept for this page load only */
  }
}

/** Scroll `el` to `y` once the content is tall enough. Returns a cancel function. */
function restore(el: HTMLElement, y: number): () => void {
  let frame = 0
  let done = false
  const deadline = Date.now() + RESTORE_WAIT_MS
  const stop = () => {
    done = true
    cancelAnimationFrame(frame)
    el.removeEventListener('wheel', stop)
    el.removeEventListener('touchstart', stop)
    window.removeEventListener('keydown', stop)
  }
  el.addEventListener('wheel', stop, { passive: true })
  el.addEventListener('touchstart', stop, { passive: true })
  window.addEventListener('keydown', stop)
  const step = () => {
    if (done) return
    const room = el.scrollHeight - el.clientHeight
    if (room >= y || Date.now() >= deadline) {
      el.scrollTop = Math.min(y, Math.max(room, 0))
      stop()
      return
    }
    frame = requestAnimationFrame(step)
  }
  step()
  return stop
}

/** Keep and restore the scroll position of the element with id `scrollerId` across in-app navigation. */
export function useScrollRestoration(scrollerId = 'main', enabled = true): void {
  const location = useLocation()
  const navigationType = useNavigationType()
  const positions = useRef<Map<string, number> | null>(null)
  const current = useRef<{ key: string; path: string } | null>(null)

  useEffect(() => {
    if (!enabled) return
    positions.current ??= load()
    const onScroll = (e: Event) => {
      const el = e.target
      const at = current.current
      if (!(el instanceof HTMLElement) || el.id !== scrollerId || !at || !positions.current) return
      positions.current.delete(at.key)
      positions.current.set(at.key, el.scrollTop)
    }
    const persist = () => positions.current && save(positions.current)
    // Scroll events do not bubble; the capture phase on the document sees the scroller's.
    document.addEventListener('scroll', onScroll, { capture: true, passive: true })
    window.addEventListener('pagehide', persist)
    return () => {
      document.removeEventListener('scroll', onScroll, { capture: true })
      window.removeEventListener('pagehide', persist)
      persist()
    }
  }, [scrollerId, enabled])

  useLayoutEffect(() => {
    if (!enabled) return
    const el = document.getElementById(scrollerId)
    if (!el) return
    positions.current ??= load()
    const prev = current.current
    const next = { key: location.key, path: location.pathname }
    if (prev && prev.key === next.key) return
    current.current = next
    if (prev) save(positions.current)
    if (navigationType === 'POP') {
      const y = positions.current.get(next.key)
      if (y !== undefined) return restore(el, y)
    }
    if (!prev || prev.path !== next.path) el.scrollTop = 0
  }, [location.key, location.pathname, navigationType, scrollerId, enabled])
}
