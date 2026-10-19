import { useEffect, useMemo, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { CircleCheck, Copy, History, Mail, MessageCircle } from 'lucide-react'
import { useSession } from '@/app/session'
import { copyToClipboard } from '@/lib/clipboard'
import { formatDay } from '@/lib/formatDay'
import { mapPgError } from '@/lib/pgErrors'
import { Button } from '@/ui/Button'
import { Icon } from '@/ui/Icon'
import { SegmentedControl } from '@/ui/SegmentedControl'
import { Skeleton } from '@/ui/Skeleton'
import { useToast } from '@/ui/useToast'
import { invalidateAfter } from '@/features/invalidation'
import { chaseClipboardText, COMPANY_NAME } from '@/features/rfqs/lib'
import { daysBetween as daysBetweenText } from '@/features/rfqs/lib/dateText'
import { usePaymentDraft, performChase } from '@/features/today/hooks'
import { buildPaymentDraft } from '@/features/today/chaseDraft'
import { useMyJobTitle } from '@/features/orders/hooks'
import type { ReceivableRow } from '@/features/money/payments/model'

/*
 * The payment-reminder panel beside Receivables (M09; g2-money "receivables with the payment-reminder panel").
 * Pick an order: the message is already written from what is on record (invoice numbers, gross, received, balance, days
 * overdue, the customer's PO, the contact). "Copy and mark reminded" is the one tap: it copies the text, stamps every
 * invoice of the order through stamp_payment_reminder, and for 10 seconds offers Undo. Nothing is typed.
 *
 * Admin and sales only: Money is not routable for an engineer, the payment read refuses one, and stamp_payment_reminder is
 * not callable by one (RLS on invoices; pgTAP 0020 and the access matrix). Bank details are NOT printed: the owner has not
 * answered Q5 (docs/DATA_MODEL company_profile.bank_*: "only if Q5 says so").
 *
 * A reminder is due when the order is overdue and was not reminded in the last 7 days; Today shows the same item and it
 * moves to Waiting after a copy. This panel does not hide an order that was reminded recently: copying again is allowed
 * (a second reminder is a person's choice) and the strip shows how recent the last one was.
 */
const UNDO_SECONDS = 10

export function ReminderPanel({ row, today }: { row: ReceivableRow | null; today: string }) {
  if (!row) {
    return (
      <PanelShell title="Payment reminder">
        <EmptyNote title="Pick an order" body="Choose an overdue order in the table to see its reminder." />
      </PanelShell>
    )
  }
  if (!row.dueOn || row.invoiceNumbers.length === 0) {
    return (
      <PanelShell title="Payment reminder" meta={row.companyName}>
        <EmptyNote title="Not invoiced yet." body="A reminder needs an invoice and a due date. Create the invoice first." />
      </PanelShell>
    )
  }
  if (row.state !== 'overdue' || row.balance <= 0) {
    const d = daysBetweenText(today, row.dueOn)
    return (
      <PanelShell title="Payment reminder" meta={row.companyName}>
        <EmptyNote
          title={row.state === 'settled' ? 'Nothing is owed.' : 'Not overdue yet.'}
          body={row.state === 'settled' ? 'This order is paid in full.' : `Due on ${formatDay(row.dueOn)}, in ${d} ${d === 1 ? 'day' : 'days'}. A reminder becomes available once the invoice is overdue.`}
        />
      </PanelShell>
    )
  }
  return <ReminderBody key={row.orderId} row={row} today={today} />
}

function PanelShell({ title, meta, aside, children }: { title: string; meta?: React.ReactNode; aside?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section aria-label={title} data-testid="reminder-panel" className="grid min-w-0 grid-cols-[minmax(0,1fr)] content-start overflow-hidden rounded border bg-surface xl:sticky xl:top-4">
      <header className="flex flex-wrap items-start justify-between gap-3 border-b px-5 py-4">
        <div className="min-w-[9rem] flex-1">
          <h2 className="text-base font-semibold">{title}</h2>
          {meta ? <span className="block truncate text-sm text-fg-muted">{meta}</span> : null}
        </div>
        {aside}
      </header>
      {children}
    </section>
  )
}

function EmptyNote({ title, body }: { title: string; body: string }) {
  return (
    <div className="grid justify-items-start gap-2 p-5 text-sm text-fg-muted">
      <b className="font-medium text-fg">{title}</b>
      <span>{body}</span>
    </div>
  )
}

function ReminderBody({ row, today }: { row: ReceivableRow; today: string }) {
  const session = useSession()
  const user = session.status === 'signed-in' ? session.user : null
  const { toast } = useToast()
  const client = useQueryClient()
  const jobTitle = useMyJobTitle(user?.id).data
  const draftQ = usePaymentDraft(row.orderId, true)
  const [channel, setChannel] = useState<'whatsapp' | 'email'>('whatsapp')
  const [busy, setBusy] = useState(false)
  // After the tap: what the strip and footer say until the undo window closes and the screen re-reads.
  const [done, setDone] = useState<{ count: number; undo: () => Promise<void>; open: boolean } | null>(null)
  const timer = useRef<number | null>(null)
  useEffect(() => () => { if (timer.current !== null) window.clearTimeout(timer.current) }, [])

  const signature = { name: user?.name ?? COMPANY_NAME, company: COMPANY_NAME, jobTitle: jobTitle ?? null }
  const draft = useMemo(
    () =>
      draftQ.data
        ? buildPaymentDraft({
            receivable: {
              orderId: row.orderId,
              orderNumber: row.orderNumber,
              ownerId: row.ownerId,
              customerName: row.companyName,
              balance: row.balance,
              settled: row.settled,
              dueOn: row.dueOn,
              isOverdue: row.isOverdue,
              lastRemindedOn: row.lastRemindedOn,
              reminderCount: row.reminderCount,
            },
            data: draftQ.data,
            today,
            signature,
            gross: row.gross,
          })
        : null,
    // signature is rebuilt each render; its parts are the dependencies
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [draftQ.data, row, today, user?.name, jobTitle],
  )

  const lead = row.invoiceNumbers[0]
  const meta = (
    <>
      {row.companyName} · <span className="num">{row.invoiceNumbers.length > 1 ? `${lead} +${row.invoiceNumbers.length - 1}` : lead}</span>
    </>
  )
  const channelControl = (
    <SegmentedControl
      aria-label="Channel"
      value={channel}
      onValueChange={v => setChannel(v as 'whatsapp' | 'email')}
      options={[
        { value: 'whatsapp', label: 'WhatsApp' },
        { value: 'email', label: 'Email' },
      ]}
    />
  )

  if (draftQ.isError) {
    return (
      <PanelShell title="Payment reminder" meta={meta}>
        <div className="grid justify-items-start gap-3 p-5 text-sm">
          <b className="font-medium">The message did not load.</b>
          <span className="text-fg-muted">Nothing was marked. Try again, and if it keeps failing, tell the admin.</span>
          <Button onClick={() => void draftQ.refetch()}>Try again</Button>
        </div>
      </PanelShell>
    )
  }
  if (!draft || !draftQ.data) {
    return (
      <PanelShell title="Payment reminder" meta={meta}>
        <div className="grid gap-2 p-5" aria-busy="true">
          <Skeleton className="h-4 w-1/3" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-5/6" />
          <Skeleton className="h-4 w-2/3" />
        </div>
      </PanelShell>
    )
  }

  const t = channel === 'email' ? draft.email : draft.whatsapp
  const text = chaseClipboardText(t)
  const count = done ? done.count : row.reminderCount
  const last = done ? today : row.lastRemindedOn
  const stateText =
    count > 0 && last ? (
      <>
        Reminded <span className="num">{count}×</span> · last <span className="num">{formatDay(last).replace(/^\w+ /, '').replace(/ \d{4}$/, '')}</span> ·{' '}
        {daysBetweenText(last, today) === 0 ? 'today' : `${daysBetweenText(last, today)} days ago`}
      </>
    ) : (
      'Not reminded yet'
    )
  const days = Math.max(0, daysBetweenText(row.dueOn as string, today))
  const toneText = draft.firm ? (
    <>
      Firmer wording, because the invoice is <span className="num">{days}</span> days overdue
    </>
  ) : (
    <>
      Standard wording, <span className="num">{days}</span> days overdue
    </>
  )
  const stamps = draftQ.data.invoices

  const refresh = () => invalidateAfter(client, 'payment.remind', {})

  const copyAndMark = async () => {
    if (busy || done) return
    setBusy(true)
    try {
      // The copy is the first thing in the tap: a browser only allows it during the gesture.
      const ok = await copyToClipboard(text)
      if (!ok) {
        toast({ title: 'Could not copy the message', body: 'Select the text and copy it by hand. Nothing was marked.', tone: 'danger' })
        return
      }
      if (stamps.length === 0) {
        toast({ title: 'Copied', body: 'This order has no invoice to mark as reminded yet.', tone: 'neutral' })
        return
      }
      try {
        const r = await performChase({ kind: 'payment', invoiceIds: stamps.map(i => i.id), before: stamps })
        setDone({ count: r.count, undo: r.undo, open: true })
        timer.current = window.setTimeout(() => {
          setDone(d => (d ? { ...d, open: false } : d))
          void refresh()
        }, UNDO_SECONDS * 1000)
      } catch (err) {
        toast({ title: 'Copied, but it was not marked', body: mapPgError(err).message, tone: 'danger' })
      }
    } finally {
      setBusy(false)
    }
  }

  const undo = async () => {
    if (!done) return
    if (timer.current !== null) window.clearTimeout(timer.current)
    try {
      await done.undo()
      setDone(null)
    } catch (err) {
      toast({ title: 'Could not take the reminder back', body: mapPgError(err).message, tone: 'danger' })
    } finally {
      void refresh()
    }
  }

  const to = draft.contact
    ? [draft.contact.name, draftQ.data.contact?.jobTitle].filter(Boolean).join(', ')
    : 'No contact on record'
  const address = channel === 'whatsapp' ? draft.contact?.phone : draftQ.data.contact?.email

  return (
    <PanelShell title="Payment reminder" meta={meta} aside={channelControl}>
      <p className="flex flex-wrap items-center gap-2 border-b px-5 py-3 text-xs text-fg-2 [&_.num]:text-fg" data-testid="reminder-state">
        <Icon icon={History} size="sm" className="text-fg-muted" />
        <span>{stateText}</span>
      </p>
      <div className="px-5 py-4">
        <div className="mb-3 flex items-center gap-2 border-b pb-3 text-sm text-fg-2">
          <Icon icon={channel === 'whatsapp' ? MessageCircle : Mail} size="sm" className="text-fg-muted" />
          <span>
            To <b className="font-medium">{to}</b>
          </span>
          {address ? <span className="num ml-auto text-right text-xs text-fg-muted">{address}</span> : null}
        </div>
        {t.subject ? (
          <p className="mb-3 text-sm text-fg-2">
            <span className="text-fg-muted">Subject </span>
            <b className="font-medium text-fg">{t.subject}</b>
          </p>
        ) : null}
        <pre data-testid="reminder-text" className="max-w-[62ch] whitespace-pre-wrap break-words font-sans text-sm leading-[21px] text-fg">
          {t.body}
        </pre>
      </div>
      <footer className="flex flex-wrap items-center gap-3 border-t bg-sunken px-5 py-3">
        {done ? (
          <>
            <span role="status" className="inline-flex items-center gap-1.5 text-sm font-medium text-tone-success-fg">
              <Icon icon={CircleCheck} size="sm" /> Copied. Reminder <span className="num">{done.count}</span> recorded today.
            </span>
            <span className="flex-1" />
            {done.open ? (
              <Button size="sm" variant="quiet" onClick={() => void undo()}>
                Undo
              </Button>
            ) : null}
          </>
        ) : (
          <>
            <Button variant="primary" icon={Copy} busy={busy} busyLabel="Marking" onClick={() => void copyAndMark()} className="min-h-touch md:min-h-0">
              Copy and mark reminded
            </Button>
            <span className="min-w-[10rem] flex-1 text-right text-xs text-fg-muted">{toneText}</span>
          </>
        )}
      </footer>
    </PanelShell>
  )
}
