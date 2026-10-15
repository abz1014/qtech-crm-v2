import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Ban, Calendar, CalendarCheck, Building2, FileText, MapPin, RotateCcw, User, UserRound, Users } from 'lucide-react'
import { businessToday } from '@/lib/dates'
import { formatDay } from '@/lib/formatDay'
import { mapPgError } from '@/lib/pgErrors'
import { rfqRef } from '@/lib/refs'
import { deadlineValue } from '@/lib/status'
import { Avatar } from '@/ui/Avatar'
import { Breadcrumb } from '@/ui/Breadcrumb'
import { Button } from '@/ui/Button'
import { Dialog, DialogContent } from '@/ui/Dialog'
import { Icon } from '@/ui/Icon'
import { RadioGroup, Radio } from '@/ui/form/Radio'
import { Field } from '@/ui/form/Field'
import { TextField } from '@/ui/form/TextField'
import { StatusBadge } from '@/ui/StatusBadge'
import { useToast } from '@/ui/useToast'
import type { RfqHeader } from '@/features/rfqs/api'
import { useSetBidSent, useSetRfqClosed } from '@/features/rfqs/hooks'
import { IssueQuotationButton } from '@/features/quotations/QuotationsPanel'
import { CLOSE_REASONS, closeReasonLabel, defaultCloseReason, type CloseReason } from '@/features/rfqs/lib'

/*
 * The top of the RFQ page: who it is for, where it stands (state chips from v_rfq_state) and the two one-tap actions that
 * belong to the whole RFQ, Mark bid sent and Close or lose. Both have an Undo.
 */

function Meta({ icon, label, children, sub, tone }: { icon: typeof User; label: string; children: React.ReactNode; sub?: React.ReactNode; tone?: 'warn' }) {
  return (
    <div className="grid min-w-0 content-start gap-[2px] px-4 py-3">
      <dt className={`flex items-center gap-1 text-xs ${tone === 'warn' ? 'text-tone-warning-fg' : 'text-fg-muted'}`}>
        <Icon icon={icon} size="chip" />
        {label}
      </dt>
      <dd className="m-0 min-w-0 break-words text-sm font-medium">{children}</dd>
      {sub ? <dd className="m-0 text-xs text-fg-muted">{sub}</dd> : null}
    </div>
  )
}

export function RfqHeaderBlock({ rfq }: { rfq: RfqHeader }) {
  const { toast } = useToast()
  const bid = useSetBidSent(rfq.id)
  const closeRfq = useSetRfqClosed(rfq.id)
  const [closing, setClosing] = useState(false)
  const s = rfq.state
  const ref = rfqRef(rfq.number)
  const open = (s?.outcome ?? 'open') === 'open'
  const bidSent = s?.bid_state === 'bid_sent' || s?.bid_state === 'quotation_expired'
  const deadline = open ? deadlineValue(s?.days_to_due, Boolean(s?.is_overdue)) : null
  const dueIn = s?.days_to_due

  const markBidSent = async () => {
    try {
      await bid.mutateAsync(businessToday())
      toast({
        title: 'Marked bid sent',
        body: `${ref} · ${rfq.company.name}`,
        undo: {
          onUndo: async () => {
            try {
              await bid.mutateAsync(null)
            } catch (err) {
              toast({ title: 'Could not undo', body: mapPgError(err).message, tone: 'danger' })
            }
          },
          settledTitle: 'Marked bid sent',
          undoneTitle: 'Bid sent taken back',
        },
      })
    } catch (err) {
      toast({ title: 'Could not mark the bid sent', body: mapPgError(err, { entity: 'RFQ' }).message, tone: 'danger' })
    }
  }

  const reopen = async () => {
    const before = { closedOn: rfq.closedOn, reason: rfq.closeReason, note: rfq.closeNote }
    try {
      await closeRfq.mutateAsync({ closedOn: null, reason: null, note: null })
      toast({
        title: 'Reopened',
        body: `${ref} is open again`,
        undo: {
          onUndo: async () => {
            try {
              await closeRfq.mutateAsync(before)
            } catch (err) {
              toast({ title: 'Could not undo', body: mapPgError(err).message, tone: 'danger' })
            }
          },
          settledTitle: 'Reopened',
          undoneTitle: 'Closed again',
        },
      })
    } catch (err) {
      toast({ title: 'Could not reopen', body: mapPgError(err, { entity: 'RFQ' }).message, tone: 'danger' })
    }
  }

  return (
    <header>
      <Breadcrumb items={[{ label: 'RFQs', to: '/rfqs' }, { label: ref, mono: true }]} />
      <div className="mt-2 flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
        <div className="min-w-0">
          <h1 className="flex flex-wrap items-baseline gap-x-3 text-2xl font-semibold tracking-snug">
            <span className="num">{ref}</span>
            <span className="min-w-0 break-words">{rfq.company.name}</span>
          </h1>
          <div className="mt-2 flex flex-wrap items-center gap-2" aria-label="State of this RFQ">
            <StatusBadge dimension="rfq-outcome" value={s?.outcome ?? 'open'} />
            {s && s.sourcing_state ? <StatusBadge dimension="sourcing" value={s.sourcing_state} /> : null}
            {s && s.clarification_state && s.clarification_state !== 'none' ? (
              <StatusBadge
                dimension="clarification"
                value={s.clarification_state}
                detail={s.clarification_state === 'to_ask' ? String(s.to_ask) : s.clarification_state === 'waiting_on_customer' ? String(s.waiting) : String(s.to_relay)}
              />
            ) : null}
            {s && s.bid_state ? (
              <StatusBadge dimension="bid" value={s.bid_state} detail={rfq.quotedOn && bidSent ? formatDay(rfq.quotedOn) : undefined} />
            ) : null}
            {deadline ? <StatusBadge dimension="deadline" value={deadline} detail={deadline === 'due-soon' && dueIn !== null && dueIn !== undefined ? (dueIn <= 0 ? 'today' : `${dueIn} d`) : undefined} /> : null}
            {rfq.isPriority ? (
              <span className="inline-flex h-5 items-center rounded border border-tone-warning-fg/25 bg-tone-warning-bg px-2 text-xs font-medium text-tone-warning-fg">Top priority</span>
            ) : null}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {/* data-slot="issue-quotation" (R19): the Issue quotation action, beside Mark bid sent. */}
          <span data-slot="issue-quotation" className="contents">
            {open ? <IssueQuotationButton rfqId={rfq.id} /> : null}
          </span>
          {open && !bidSent ? (
            <Button variant="primary" icon={CalendarCheck} onClick={() => void markBidSent()} busy={bid.isPending} busyLabel="Marking">
              Mark bid sent
            </Button>
          ) : null}
          {open ? (
            <Button icon={Ban} onClick={() => setClosing(true)}>
              Close or lose
            </Button>
          ) : null}
          {s?.outcome === 'closed' ? (
            <Button icon={RotateCcw} onClick={() => void reopen()} busy={closeRfq.isPending} busyLabel="Reopening">
              Reopen
            </Button>
          ) : null}
        </div>
      </div>

      {s?.outcome === 'closed' ? (
        <p className="mt-3 text-sm text-fg-2">
          Closed {rfq.closedOn ? formatDay(rfq.closedOn) : ''}: {closeReasonLabel(rfq.closeReason)}.{rfq.closeNote ? ` ${rfq.closeNote}` : ''}
        </p>
      ) : null}

      <dl className="mt-4 grid grid-cols-2 divide-x divide-y rounded border bg-surface md:grid-cols-3 xl:grid-cols-6 [&>*]:border-line">
        <Meta icon={FileText} label="Customer ref" sub={`Received ${formatDay(rfq.receivedOn)}`}>
          <span className="num">{rfq.customerRef ?? 'None given'}</span>
        </Meta>
        <Meta icon={Building2} label="Company">
          <Link to={`/companies/${rfq.company.id}`} className="underline underline-offset-2 hover:text-fg-2">
            {rfq.company.name}
          </Link>
        </Meta>
        <Meta icon={MapPin} label="Site" sub={rfq.site?.address ?? undefined}>
          {rfq.site?.name ?? 'Not set'}
        </Meta>
        <Meta icon={UserRound} label="Contact" sub={rfq.contact?.phone ? <span className="num">{rfq.contact.phone}</span> : undefined}>
          {rfq.contact?.name ?? 'Not set'}
        </Meta>
        <Meta
          icon={Calendar}
          label="Bid due"
          tone={deadline ? 'warn' : undefined}
          sub={dueIn !== null && dueIn !== undefined && open ? (dueIn < 0 ? `${-dueIn} days ago` : dueIn === 0 ? 'Today' : `In ${dueIn} days`) : undefined}
        >
          <span className="num">{rfq.dueOn ? formatDay(rfq.dueOn) : 'No date'}</span>
        </Meta>
        <Meta icon={Users} label="Owner">
          {rfq.owner ? (
            <span className="flex items-center gap-2">
              <Avatar name={rfq.owner.name} />
              {rfq.owner.name}
            </span>
          ) : (
            'Not set'
          )}
        </Meta>
      </dl>

      {closing && s ? (
        <CloseDialog
          rfq={rfq}
          busy={closeRfq.isPending}
          defaultReason={defaultCloseReason({
            sourcingState: s.sourcing_state,
            clarificationState: s.clarification_state,
            bidState: s.bid_state,
            isOverdue: Boolean(s.is_overdue),
          })}
          onClose={() => setClosing(false)}
          onConfirm={async (reason, note) => {
            try {
              await closeRfq.mutateAsync({ closedOn: businessToday(), reason, note: note.trim() || null })
              setClosing(false)
              toast({
                title: 'Closed',
                body: `${ref} · ${closeReasonLabel(reason)}`,
                undo: {
                  onUndo: async () => {
                    try {
                      await closeRfq.mutateAsync({ closedOn: null, reason: null, note: null })
                    } catch (err) {
                      toast({ title: 'Could not undo', body: mapPgError(err).message, tone: 'danger' })
                    }
                  },
                  settledTitle: 'Closed',
                  undoneTitle: 'Reopened',
                },
              })
            } catch (err) {
              toast({ title: 'Could not close the RFQ', body: mapPgError(err, { entity: 'RFQ' }).message, tone: 'danger' })
            }
          }}
        />
      ) : null}
    </header>
  )
}

function CloseDialog({
  rfq,
  defaultReason,
  busy,
  onClose,
  onConfirm,
}: {
  rfq: RfqHeader
  defaultReason: CloseReason
  busy: boolean
  onClose: () => void
  onConfirm: (reason: CloseReason, note: string) => void | Promise<void>
}) {
  const [reason, setReason] = useState<CloseReason>(defaultReason)
  const [note, setNote] = useState('')
  return (
    <Dialog open busy={busy} onOpenChange={o => (o ? null : onClose())}>
      <DialogContent
        title="Close or lose this RFQ"
        context={`${rfqRef(rfq.number)} · ${rfq.company.name}`}
        icon={Ban}
        footer={
          <>
            <Button data-cancel onClick={onClose} disabled={busy}>
              Cancel
            </Button>
            <Button variant="primary" busy={busy} busyLabel="Closing" onClick={() => void onConfirm(reason, note)}>
              Close RFQ
            </Button>
          </>
        }
      >
        <div className="grid gap-4">
          <p className="text-sm text-fg-muted">The reason is filled in from where this RFQ stands. Change it if it is not right.</p>
          <RadioGroup aria-label="Reason" value={reason} onValueChange={v => setReason(v as CloseReason)} className="gap-2">
            {CLOSE_REASONS.map(r => (
              <Radio key={r.value} value={r.value} label={r.label} />
            ))}
          </RadioGroup>
          <Field label="Note" requirement="optional">
            <TextField value={note} onChange={e => setNote(e.target.value)} placeholder="Anything worth remembering" />
          </Field>
        </div>
      </DialogContent>
    </Dialog>
  )
}
