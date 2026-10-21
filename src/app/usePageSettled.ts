import { useEffect, useState } from 'react'
import { useIsFetching } from '@tanstack/react-query'
import { firstPageSettled } from '@/app/firstPage'

/** How long no read may be in flight before the page counts as drawn. */
const QUIET_MS = 150

/**
 * True once the page has its data: the page the app opened on has settled (routeChunks.ts) and no read has been in flight for a
 * moment. The extras around a page (the top bar's "needs you" counts, Money's tab counts) wait for it, so on a slow connection
 * the page's own reads go first and the extras follow (perf/lcp). Once true it stays true for the component's life.
 */
export function usePageSettled(): boolean {
  const fetching = useIsFetching()
  const [startDone, setStartDone] = useState(false)
  const [settled, setSettled] = useState(false)
  useEffect(() => {
    let live = true
    void firstPageSettled().then(() => {
      if (live) setStartDone(true)
    })
    return () => {
      live = false
    }
  }, [])
  useEffect(() => {
    if (settled || !startDone || fetching > 0) return
    const t = window.setTimeout(() => setSettled(true), QUIET_MS)
    return () => window.clearTimeout(t)
  }, [settled, startDone, fetching])
  return settled
}
