import type { ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { FileText, MessageCircle, Phone } from 'lucide-react'
import { businessToday } from '@/lib/dates'
import { formatShortDate } from '@/lib/formatDay'
import { orderRef } from '@/lib/refs'
import { waLink } from '@/lib/messageLinks'
import { isFinalMargin } from '@/lib/money'
import { Money } from '@/ui/Money'
import { Icon } from '@/ui/Icon'
import { qk } from '@/features/queryKeys'
import { signFileUrls, type AttachmentRow } from '@/features/rfqs/api'
import type { JobFacts } from '@/features/jobs/api'
import type { JobData } from '@/features/jobs/useJobData'
import { JobSlot, type JobContext } from '@/features/jobs/slots'

/*
 * The job page's right column: Contact (Call, WhatsApp), Money for this job (admin only), Notes and files (one timeline, newest
 * first), and the orders that were cancelled inside this job. An engineer's page has no Money panel, and the database hides
 * every file that carries prices from them (attachments.has_prices, migration 0100), so no filter is needed here.
 */
function Panel({ title, children, action }: { title: string; children: ReactNode; action?: ReactNode }) {
  return (
    <section aria-label={title} className="rounded-panel border bg-surface">
      <div className="flex items-center justify-between gap-2 border-b px-4 py-3">
        <h2 className="text-base font-semibold">{title}</h2>
        {action}
      </div>
      <div className="px-4 py-3">{children}</div>
    </section>
  )
}

const linkBtn =
  'inline-flex min-h-touch items-center gap-2 rounded border border-line-strong bg-surface px-3 text-base font-semibold text-fg hover:bg-sunken'

export function ContactPanel({ facts }: { facts: JobFacts }) {
  const c = facts.contact
  if (!c) {
    return (
      <Panel title="Contact">
        <p className="text-base text-fg-muted">No contact person is set on this job.</p>
      </Panel>
    )
  }
  const wa = waLink(c.phone, '')
  return (
    <Panel title="Contact">
      <p className="text-base font-semibold">{c.name}</p>
      <p className="text-base text-fg-2">{[c.jobTitle, facts.site?.name].filter(Boolean).join(' · ')}</p>
      {facts.site?.address ? <p className="text-base text-fg-muted">{facts.site.address}</p> : null}
      <div className="mt-3 flex flex-wrap gap-2">
        {c.phone ? (
          <a className={linkBtn} href={`tel:${c.phone.replace(/[^\d+]/g, '')}`} aria-label={`Call ${c.name}, ${c.phone}`}>
            <Icon icon={Phone} />
            Call
          </a>
        ) : null}
        {wa ? (
          <a className={linkBtn} href={wa.url} target="_blank" rel="noopener noreferrer" aria-label={`WhatsApp ${c.name}`}>
            <Icon icon={MessageCircle} />
            WhatsApp
          </a>
        ) : null}
      </div>
    </Panel>
  )
}

/** Admin only. "Costs not entered yet" while the costs are 0; the profit is "Not known yet" until the costs are marked final. */
export function MoneyPanel({ data }: { data: JobData }) {
  const m = data.orderMoney.data
  if (!m) {
    return (
      <Panel title="Money for this job">
        <p className="text-base text-fg-muted">{data.orderMoney.isPending ? 'Loading…' : 'Nothing to show until there is an order.'}</p>
      </Panel>
    )
  }
  const costs = m.actualCost ?? 0
  const final = isFinalMargin(m.marginState as never)
  return (
    <Panel title="Money for this job">
      <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-2 text-base">
        <dt className="text-fg-2">Sale (with GST)</dt>
        <dd className="text-right"><Money value={m.grossTarget} /></dd>
        <dt className="text-fg-2">Received</dt>
        <dd className="text-right"><Money value={m.settled} prefix={false} /></dd>
        <dt className="border-t pt-2 font-semibold">Still to collect</dt>
        <dd className="border-t pt-2 text-right"><Money value={m.balance} prefix={false} strong /></dd>
        <dt className="text-fg-2">Costs so far</dt>
        <dd className="text-right">{costs > 0 ? <Money value={costs} prefix={false} /> : <span className="text-fg-muted">Costs not entered yet</span>}</dd>
        <dt className="text-fg-2">Profit</dt>
        <dd className="text-right">{final && m.margin !== null ? <Money value={m.margin} prefix={false} /> : <span className="text-fg-muted">Not known yet</span>}</dd>
      </dl>
      {!final && costs > 0 ? <p className="mt-3 text-base text-fg-muted">Freight and clearing may still come. Profit shows when the costs are marked final.</p> : null}
    </Panel>
  )
}

interface TimelineEntry {
  at: string
  kind: 'note' | 'file'
  text: string
  file?: AttachmentRow
}

export function NotesFilesPanel({ facts, data, ctx }: { facts: JobFacts; data: JobData; ctx: JobContext }) {
  const today = businessToday()
  const files = [...(data.rfqFiles.data ?? []), ...(data.orderFiles.data ?? [])]
  const paths = files.map(f => f.path).sort()
  const urls = useQuery({ queryKey: qk.jobs.fileUrls(paths.join('|')), queryFn: () => signFileUrls(paths), enabled: paths.length > 0, staleTime: 8 * 60_000 })
  const notes = [facts.notes, data.order.data?.notes && data.order.data.notes !== facts.notes ? data.order.data.notes : null].filter((n): n is string => Boolean(n && n.trim()))
  const entries: TimelineEntry[] = [
    ...notes.map(n => ({ at: facts.receivedOn ?? '', kind: 'note' as const, text: n })),
    ...files.map(f => ({ at: f.createdAt.slice(0, 10), kind: 'file' as const, text: f.fileName, file: f })),
  ].sort((a, b) => b.at.localeCompare(a.at))
  return (
    <Panel title="Notes and files" action={<JobSlot name="files" context={ctx} />}>
      {entries.length === 0 ? (
        <p className="text-base text-fg-muted">No notes or files yet.</p>
      ) : (
        <ul className="grid gap-3">
          {entries.map((e, i) => (
            <li key={`${e.kind}-${i}`} className="grid grid-cols-[4.5rem_1fr] gap-3 text-base">
              <span className="num pt-px text-stamp text-fg-muted">{e.at ? formatShortDate(e.at, today) : ''}</span>
              {e.kind === 'file' && e.file ? (
                urls.data?.[e.file.path] ? (
                  <a href={urls.data[e.file.path]} target="_blank" rel="noopener noreferrer" className="inline-flex min-w-0 items-start gap-2 rounded text-primary hover:underline">
                    <Icon icon={FileText} className="mt-[3px] shrink-0" />
                    <span className="min-w-0 [overflow-wrap:anywhere]">{e.text}</span>
                  </a>
                ) : (
                  <span className="inline-flex min-w-0 items-start gap-2 text-fg-2">
                    <Icon icon={FileText} className="mt-[3px] shrink-0 text-fg-muted" />
                    <span className="min-w-0 [overflow-wrap:anywhere]">{e.text}</span>
                  </span>
                )
              ) : (
                <span className="min-w-0 whitespace-pre-line [overflow-wrap:anywhere]">{e.text}</span>
              )}
            </li>
          ))}
        </ul>
      )}
    </Panel>
  )
}

/** A cancelled order is history inside its job; a cancel followed by a reorder stays one job. */
export function CancelledOrders({ data }: { data: JobData }) {
  const rows = data.cancelled.data ?? []
  if (rows.length === 0) return null
  const today = businessToday()
  return (
    <Panel title="Cancelled orders">
      <ul className="grid gap-2 text-base">
        {rows.map(o => (
          <li key={o.id}>
            <Link to={`/orders/${o.id}`} className="num inline-flex min-h-touch items-center rounded font-medium text-primary hover:underline">
              {orderRef(o.number)}
            </Link>{' '}
            <span className="text-fg-2">cancelled {formatShortDate(o.cancelledOn, today)}</span>
          </li>
        ))}
      </ul>
    </Panel>
  )
}
