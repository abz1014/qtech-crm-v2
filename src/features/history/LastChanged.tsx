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
  const q = useRecordHistory(table, id)
  const text = lastChangedLine(q.data?.pages[0]?.events[0])
  if (!text) return null
  return (
    <p className={className ?? 'text-base text-fg-2'} data-testid="last-changed">
      {text}
    </p>
  )
}
