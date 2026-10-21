import { Suspense, useEffect, useState, type ReactNode } from 'react'
import { isContentDrawn, whenContentDrawn } from '@/lib/afterContent'

/**
 * The lower panels of a record page (perf/lcp). On the first page the app opens, their code (a lazy component) is fetched only
 * once the page's top is drawn, so on a slow phone connection the header and the first panel, what the person reads first,
 * do not wait for it; until then, and while it downloads, `fallback` (a skeleton of the same height) holds the place, the same
 * way the panels already show a skeleton while their data loads. Later pages render them at once.
 */
export function BelowTheFold({ fallback, children }: { fallback: ReactNode; children: ReactNode }) {
  const [drawn, setDrawn] = useState(isContentDrawn)
  useEffect(() => {
    if (!drawn) whenContentDrawn(() => setDrawn(true))
  }, [drawn])
  return drawn ? <Suspense fallback={fallback}>{children}</Suspense> : <>{fallback}</>
}
