import { useSyncExternalStore } from 'react'

/** Whether a CSS media query matches right now, and re-renders when it starts or stops matching. False where matchMedia does not exist (tests, server). */
export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    notify => {
      const mq = typeof window !== 'undefined' ? window.matchMedia?.(query) : undefined
      mq?.addEventListener?.('change', notify)
      return () => mq?.removeEventListener?.('change', notify)
    },
    () => (typeof window !== 'undefined' ? !!window.matchMedia?.(query).matches : false),
    () => false,
  )
}
