import { useEffect, useState } from 'react'
import { whenContentDrawn } from '@/lib/afterContent'

export type SuggestLib = typeof import('@/features/rfqs/lib/suggestLib')

/** The suggestion code, or null until it has been downloaded (after the page's content is drawn). The page works without it. */
export function useSuggestLib(): SuggestLib | null {
  const [lib, setLib] = useState<SuggestLib | null>(null)
  useEffect(() => {
    let live = true
    whenContentDrawn(() => {
      void import('@/features/rfqs/lib/suggestLib').then(m => live && setLib(m), () => undefined)
    })
    return () => {
      live = false
    }
  }, [])
  return lib
}
