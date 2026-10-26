import { useEffect, useState } from 'react'
import { History as HistoryIcon } from 'lucide-react'
import { MenuItem } from '@/ui/Popover'
import { useRecordHistory, type HistoryTable } from '@/features/history/api'
import { lastChangedLine } from '@/features/history/model'

/** The "History" item of a record's More menu. The caller owns the open state and draws <LazyHistoryPanel>. */
export function HistoryMenuItem({ onOpen }: { onOpen: () => void }) {
  return (
    <MenuItem icon={HistoryIcon} onClick={onOpen}>
      History
    </MenuItem>
  )
}

/**
 * "Last changed by Ayesha, 2 days ago": a small line for a detail header. It reads the same cached history as the panel, so
 * opening History straight after costs nothing. Draws nothing until it has an answer, and nothing when there is no history.
 */
export function LastChanged({ table, id, className }: { table: HistoryTable; id: string | null | undefined; className?: string }) {
  // Asked for once the page has drawn, never in the page's first round of reads (perf: the RFQ and order pages' LCP).
  const [ready, setReady] = useState(false)
  useEffect(() => {
    const w = window as Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number; cancelIdleCallback?: (h: number) => void }
    if (w.requestIdleCallback) {
      const h = w.requestIdleCallback(() => setReady(true), { timeout: 1500 })
      return () => w.cancelIdleCallback?.(h)
    }
    const t = window.setTimeout(() => setReady(true), 400)
    return () => window.clearTimeout(t)
  }, [])
  const q = useRecordHistory(table, id, ready)
  const text = lastChangedLine(q.data?.pages[0]?.events[0])
  if (!text) return null
  return (
    <p className={className ?? 'text-base text-fg-2'} data-testid="last-changed">
      {text}
    </p>
  )
}
