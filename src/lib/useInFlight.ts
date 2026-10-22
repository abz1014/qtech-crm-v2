import { useCallback, useRef } from 'react'

/*
 * One write at a time (HW-15). `once(fn)` runs fn unless a previous run is still in flight, so a double click, a double tap or a
 * menu item pressed twice sends ONE write, one toast and one Undo. The guard is a ref, not state: the second click of a double
 * click arrives before React has re-rendered with the mutation's pending flag.
 */
export function useInFlight(): <R>(fn: () => Promise<R>) => Promise<R | undefined> {
  const busy = useRef(false)
  return useCallback(async <R,>(fn: () => Promise<R>) => {
    if (busy.current) return undefined
    busy.current = true
    try {
      return await fn()
    } finally {
      busy.current = false
    }
  }, [])
}
