import { Download } from 'lucide-react'
import type { PreviewRow } from '@/features/settings/archive/api'
import { useArchivePreview } from '@/features/settings/archive/hooks'
import { entityLabel, previewCsv } from '@/features/settings/archive/model'
import { downloadCSV } from '@/lib/csvExport'
import { formatDay } from '@/lib/formatDay'
import { cn } from '@/lib/utils'
import { Button } from '@/ui/Button'
import { CARD } from '@/ui/card'
import { DataTable, type Column } from '@/ui/DataTable'

const COLUMNS: Column<PreviewRow>[] = [
  { id: 'entity', header: 'Kind', value: r => entityLabel(r.entity) },
  { id: 'hidden', header: 'Hidden', kind: 'num', value: r => r.wouldHide, total: true },
  { id: 'imported', header: 'Imported', kind: 'num', value: r => r.imported, total: true },
  { id: 'open', header: 'Still open', kind: 'num', value: r => r.open, total: true },
  { id: 'amount', header: 'Open amount (PKR)', kind: 'money', value: r => r.openAmountPkr, total: true },
  { id: 'back', header: 'Brought back', kind: 'num', value: r => r.alreadyUnhidden, total: true },
]

/* What the archive would hide for the date shown above, one line per kind of record, with totals. It works whether archiving is on or off. */
export function PreviewTable({ cutoff }: { cutoff: string | null }) {
  const q = useArchivePreview(cutoff)
  const rows = q.data ?? []
  return (
    <section className={cn(CARD, 'grid gap-3 p-card')} aria-label="What would be archived" data-testid="archive-preview">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-card">What this hides</h2>
          <p className="text-base text-fg-muted">{cutoff ? `Records dated before ${formatDay(cutoff)}, and imported records.` : 'Pick a date to see what it hides.'}</p>
        </div>
        <Button icon={Download} variant="secondary" disabled={rows.length === 0} onClick={() => downloadCSV(previewCsv(rows), `archive-preview-${cutoff ?? 'all'}.csv`)}>
          Download CSV
        </Button>
      </div>
      <DataTable
        flat
        label="What would be archived"
        noun="kinds of record"
        columns={COLUMNS}
        rows={rows}
        getRowId={r => r.entity}
        loading={q.isPending && Boolean(cutoff)}
        error={q.isError ? { title: 'Could not read the preview', message: 'Try again in a moment.', onRetry: () => void q.refetch() } : null}
        footerLabel="Total"
        virtualAfter={100}
      />
      <p className="text-sm text-fg-muted">Still open means money is still owed or work is not finished. Those records are hidden too, so check them before you switch on.</p>
    </section>
  )
}
