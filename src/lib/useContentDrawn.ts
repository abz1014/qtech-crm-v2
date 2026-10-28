import { useEffect, useState } from 'react'
import { isContentDrawn, whenContentDrawn } from '@/lib/afterContent'

/**
 * False on the first page the app opens until that page's content is on screen, true at once on every later page (perf/lcp).
 * What is not part of the first paint (a page's panel reads, its lazy slots) waits for it, so on a slow phone connection
 * it does not compete with the content the person is waiting for.
 */
export function useContentDrawn(): boolean {
  const [drawn, setDrawn] = useState(isContentDrawn)
  useEffect(() => {
    if (!drawn) whenContentDrawn(() => setDrawn(true))
  }, [drawn])
  return drawn
}
