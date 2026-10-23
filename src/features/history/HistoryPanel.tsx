import { useMemo } from 'react'
import { History as HistoryIcon } from 'lucide-react'
import { Button } from '@/ui/Button'
import { Dialog, DialogContent } from '@/ui/Dialog'
import { EmptyState } from '@/ui/EmptyState'
import { Skeleton } from '@/ui/Skeleton'
import { useRecordHistory, type HistoryTable } from '@/features/history/api'
import { buildTimeline, type Entry } from '@/features/history/model'

/*
 * The History panel: "was X, now Y, by whom, when" for one record, newest first. A modal on a desktop, a bottom sheet on a phone
 * (the shared Dialog). Opened from a record's More menu; the code is downloaded the first time it opens (LazyHistoryPanel).
 *
 *   <HistoryPanel open={open} onOpenChange={setOpen} table="expenses" id={expense.id} context="Rent · 4 Oct 2026" />
 *
 * The server has already removed what the viewer may not see (an engineer's events carry no money), so this only draws.
 * Text is 16 px; the time of a change is 14 px.
 */
export interface HistoryPanelProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  table: HistoryTable
  id: string
  /** The line under the title: which record this is. */
  context?: string
  /** The record came from the old CRM (legacy_source is set): when nothing says who entered it, the panel says so. */
  imported?: boolean
}

export function HistoryPanel({ open, onOpenChange, table, id, context, imported }: HistoryPanelProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title="History" context={context} icon={HistoryIcon} size="md" className="md:w-[560px]">
        {open ? <HistoryBody table={table} id={id} imported={imported} /> : null}
      </DialogContent>
    </Dialog>
  )
}

function HistoryBody({ table, id, imported }: { table: HistoryTable; id: string; imported?: boolean }) {
  const q = useRecordHistory(table, id)
  const pages = q.data?.pages
  const entries = useMemo(() => (pages ? buildTimeline(pages, { table, imported }) : []), [pages, table, imported])

  if (q.isPending)
    return (
      <div className="grid gap-4" aria-busy="true" aria-label="Loading history">
        <Skeleton className="h-12" />
        <Skeleton className="h-12" />
        <Skeleton className="h-12" />
      </div>
    )
  if (q.isError)
    return (
      <EmptyState mood="error" title="Couldn't load the history" actions={<Button onClick={() => void q.refetch()}>Try again</Button>}>
        Nothing was changed. Check your connection and try again.
      </EmptyState>
    )
  if (entries.length === 0)
    return (
      <EmptyState icon={HistoryIcon} title="No changes yet">
        When this record is edited, each change shows here with who made it and when.
      </EmptyState>
    )

  const hasMore = q.hasNextPage
  const showsStart = entries.some(e => e.kind === 'created' || e.kind === 'imported')
  return (
    <div className="grid gap-4">
      <ol className="grid gap-0" aria-label="Changes, newest first">
        {entries.map(e => (
          <EntryRow key={e.key} entry={e} />
        ))}
      </ol>
      {hasMore ? (
        <Button size="lg" onClick={() => void q.fetchNextPage()} busy={q.isFetchingNextPage} busyLabel="Loading" className="justify-self-start">
          Show older
        </Button>
      ) : null}
      {!hasMore && !showsStart ? <p className="text-base text-fg-muted">Older history archived</p> : null}
    </div>
  )
}

function EntryRow({ entry }: { entry: Entry }) {
  return (
    <li className="grid gap-1 border-b border-line py-3 first:pt-0 last:border-b-0" data-testid="history-entry">
      <p className="text-sm text-fg-muted">
        {entry.when ? <time dateTime={entry.at ?? undefined}>{entry.when}</time> : null}
        {entry.when && entry.by ? ' · ' : null}
        {entry.by ? <span className="font-medium text-fg-2">{entry.by}</span> : null}
      </p>
      {entry.title ? <p className="text-base font-medium text-fg [overflow-wrap:anywhere]">{entry.title}</p> : null}
      {entry.changes.length > 0 ? (
        <ul className="grid gap-1">
          {entry.changes.map((c, i) => (
            <li key={`${c.label}-${i}`} className="text-base text-fg [overflow-wrap:anywhere]">
              {c.text}
            </li>
          ))}
        </ul>
      ) : null}
    </li>
  )
}
