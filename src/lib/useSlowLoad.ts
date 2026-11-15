import { useEffect, useState } from 'react'

/** How long a load may take before the screen says it is slow (audit 1 major 5). */
export const SLOW_LOAD_MS = 5_000

/** The words a loading line changes to once a load has taken SLOW_LOAD_MS. */
export const SLOW_LOAD_TEXT = 'Still loading. Check your connection.'

/**
 * True once `loading` has stayed true for `ms` without a break; false again as soon as it stops. A skeleton that sits for
 * seconds reads as a hang, so a loading line says it is still working and what the person can check.
 */
export function useSlowLoad(loading: boolean, ms: number = SLOW_LOAD_MS): boolean {
  const [slow, setSlow] = useState(false)
  useEffect(() => {
    if (!loading) {
      setSlow(false)
      return
    }
    const t = window.setTimeout(() => setSlow(true), ms)
    return () => window.clearTimeout(t)
  }, [loading, ms])
  return loading && slow
}
