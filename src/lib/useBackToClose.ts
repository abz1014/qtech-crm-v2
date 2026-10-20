import { useEffect, useId, useLayoutEffect, useRef } from 'react'

/*
 * Android Back closes the open sheet instead of leaving the page (phone audit 3, "Android Back"; top-12 fix 2).
 *
 * A Radix dialog adds no history entry, so the system Back button (and the browser's) left the page under an open sheet
 * and lost what was typed in it. While a sheet is open this hook adds one same-URL history entry carrying the sheet's id
 * in history.state; Back pops that entry, and the hook calls onClose instead of the page changing.
 *
 *  - Closed any other way (Cancel, Save, Esc, the scrim): its entry is taken back off with history.back(), so the next
 *    Back goes where it would have gone without the sheet. If the sheet closed because the page navigated (a link inside
 *    it, or Save then navigate), the entry is already under the new page and is left alone.
 *  - Nested sheets stack: Back closes the top one only.
 *  - A sheet that refuses to close (a save in flight) gets its entry back, so Back still lands on it.
 *  - The entry copies React Router's state (key, idx, usr), so the router sees the same location when it is popped.
 *  - StrictMode's mount, unmount, mount in development keeps a single entry.
 *
 * Use: `useBackToClose(open, () => onOpenChange(false))`, in the component that owns the open state.
 */
const MARK = '__qtechSheets'

type HistoryState = Record<string, unknown> | null

function sheetsIn(state: unknown): string[] {
  const list = state && typeof state === 'object' ? (state as Record<string, unknown>)[MARK] : undefined
  return Array.isArray(list) ? list.filter((x): x is string => typeof x === 'string') : []
}

/** Sheets whose hook is mounted and open, so a cleanup can tell a StrictMode re-mount from a real close. */
const live = new Set<string>()

function push(id: string): void {
  const state = (window.history.state as HistoryState) ?? {}
  const sheets = sheetsIn(state)
  if (sheets[sheets.length - 1] === id) return
  window.history.pushState({ ...state, [MARK]: [...sheets.filter(s => s !== id), id] }, '')
}

export function useBackToClose(open: boolean, onClose: () => void, { enabled = true }: { enabled?: boolean } = {}): void {
  const id = useId()
  const close = useRef(onClose)
  useLayoutEffect(() => {
    close.current = onClose
  })
  const active = open && enabled && typeof window !== 'undefined'

  useEffect(() => {
    if (!active) return
    live.add(id)
    push(id)
    let reopen: ReturnType<typeof setTimeout> | undefined
    const onPop = (e: PopStateEvent) => {
      if (sheetsIn(e.state).includes(id)) return // our entry is still there (a sheet above ours was closed)
      close.current()
      // Still open a moment later: the sheet refused (busy). Put the entry back so the next Back lands here again.
      reopen = setTimeout(() => {
        if (live.has(id)) push(id)
      }, 50)
    }
    window.addEventListener('popstate', onPop)
    return () => {
      window.removeEventListener('popstate', onPop)
      if (reopen !== undefined) clearTimeout(reopen)
      live.delete(id)
      queueMicrotask(() => {
        if (live.has(id)) return // re-mounted at once (StrictMode): keep the entry
        const sheets = sheetsIn(window.history.state)
        // Only when our entry is still the one on screen: after a navigation it sits under the new page.
        if (sheets[sheets.length - 1] !== id) return
        // Sheets that closed together (a sheet inside a sheet) are taken off in one step.
        let closed = 0
        while (closed < sheets.length && !live.has(sheets[sheets.length - 1 - closed])) closed += 1
        window.history.go(-closed)
      })
    }
  }, [active, id])
}
