import { useState } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { Icon } from '@/ui/Icon'
import { useImportedNotes } from '@/features/jobs/hooks'
import type { ImportedNoteRow } from '@/features/jobs/api'

/*
 * "Imported note": the old system's free text behind an imported job (migration 0135). It can hold supplier names and prices, so only
 * admin and sales see it, and the database refuses an engineer anyway (public.imported_notes has no grant for them). Closed until
 * someone opens it; it draws nothing at all when the job has no imported text.
 */
function Block({ title, rows }: { title: string; rows: ImportedNoteRow[] }) {
  if (rows.length === 0) return null
  return (
    <div className="grid gap-2">
      <h3 className="text-base font-semibold">{title}</h3>
      {rows.map(r => (
        <p key={`${r.kind}-${r.rowId}`} className="whitespace-pre-line text-base text-fg-2 [overflow-wrap:anywhere]">
          {r.note}
        </p>
      ))}
    </div>
  )
}

export function ImportedNote({ rfqId, orderId, role }: { rfqId: string | null; orderId: string | null; role: 'admin' | 'sales' | 'engineer' }) {
  const [open, setOpen] = useState(false)
  const ids = [rfqId, orderId].filter((x): x is string => Boolean(x))
  const allowed = role === 'admin' || role === 'sales'
  const q = useImportedNotes(ids, allowed)
  const rows = q.data ?? []
  if (!allowed || rows.length === 0) return null
  const of = (k: ImportedNoteRow['kind']) => rows.filter(r => r.kind === k)
  const bodyId = 'imported-note-body'
  return (
    <section aria-label="Imported note" className="rounded-panel border bg-surface">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={bodyId}
        onClick={() => setOpen(o => !o)}
        className="flex min-h-touch w-full items-center justify-between gap-2 px-4 py-3 text-left"
      >
        <span className="text-base font-semibold">Imported note</span>
        <span className="inline-flex items-center gap-2 text-base text-fg-muted">
          {open ? 'Hide' : 'Show'}
          <Icon icon={open ? ChevronDown : ChevronRight} />
        </span>
      </button>
      {open ? (
        <div id={bodyId} className="grid gap-4 border-t px-4 py-3">
          <p className="text-base text-fg-muted">Text from the old system. It may name suppliers and prices. Admin and sales only.</p>
          <Block title="Enquiry notes" rows={of('rfqs')} />
          <Block title="Order notes" rows={of('orders')} />
          <Block title="Enquiry items, as imported" rows={of('rfq_items')} />
          <Block title="Order items, as imported" rows={of('order_items')} />
        </div>
      ) : null}
    </section>
  )
}
