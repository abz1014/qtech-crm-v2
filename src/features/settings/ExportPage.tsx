import { useState } from 'react'
import { Download } from 'lucide-react'
import { businessToday } from '@/lib/dates'
import { mapPgError } from '@/lib/pgErrors'
import { Button } from '@/ui/Button'
import { PageHeader } from '@/ui/PageHeader'
import { useToast } from '@/ui/useToast'
import { EXPORTS, downloadExport, type ExportId, type ExportKind } from '@/features/settings/exportData'

/*
 * Settings > Export data (process audit 8). Admin only (the route is behind AdminOnly). One button per kind; the browser makes a
 * CSV file you can open in Excel. Nothing is changed and nothing is sent anywhere.
 */
export function ExportPage() {
  const toast = useToast()
  const [busy, setBusy] = useState<ExportId | null>(null)
  const go = async (kind: ExportKind) => {
    setBusy(kind.id)
    try {
      const n = await downloadExport(kind, businessToday())
      toast.toast({ title: `${kind.label} exported`, body: `${n} ${n === 1 ? 'row' : 'rows'} in the file`, tone: 'success' })
    } catch (err) {
      toast.toast({ title: `Couldn't export ${kind.label.toLowerCase()}`, body: mapPgError(err, { entity: 'export' }).message, tone: 'danger' })
    } finally {
      setBusy(null)
    }
  }
  return (
    <div className="grid gap-4" data-testid="export-page">
      <PageHeader title="Export data" lede={<span className="text-base">Download your records as files you can open in Excel. Nothing is changed.</span>} />
      <ul className="divide-y rounded-panel border bg-surface">
        {EXPORTS.map(k => (
          <li key={k.id} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-3">
            <span className="min-w-0">
              <b className="block font-medium">{k.label}</b>
              <span className="text-sm text-fg-muted">{k.about}</span>
            </span>
            <Button icon={Download} busy={busy === k.id} busyLabel="Making the file" disabled={busy !== null} aria-label={`Export ${k.label}`} onClick={() => void go(k)}>
              Download CSV
            </Button>
          </li>
        ))}
      </ul>
    </div>
  )
}
