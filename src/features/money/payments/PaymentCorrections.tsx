import { useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { Ban, Check, ChevronDown, ChevronRight, Ellipsis, PencilLine, RotateCcw } from 'lucide-react'
import { useSession } from '@/app/session'
import { businessToday } from '@/lib/dates'
import { formatShortDate } from '@/lib/formatDay'
import { formatAmount } from '@/lib/money'
import { mapPgError } from '@/lib/pgErrors'
import { orderRef } from '@/lib/refs'
import { cn } from '@/lib/utils'
import { Button } from '@/ui/Button'
import { Dialog, DialogContent } from '@/ui/Dialog'
import { MenuItem, Popover, PopoverContent, PopoverTrigger } from '@/ui/Popover'
import { Skeleton } from '@/ui/Skeleton'
import { Tag } from '@/ui/Tag'
import { Tooltip } from '@/ui/Tooltip'
import { useToast } from '@/ui/useToast'
import { DateInput } from '@/ui/form/DateInput'
import { Field } from '@/ui/form/Field'
import { NumberInput } from '@/ui/form/NumberInput'
import { Select } from '@/ui/form/Select'
import { TextArea, TextField } from '@/ui/form/TextField'
import { PAID_VIA_LABEL, type PaidVia } from '@/features/money/expenses/model'
import {
  canUndo,
  changeBlockedBy,
  correctionChanges,
  correctionToastText,
  voidToastText,
  type PaymentFigures,
  type PaymentLine,
} from '@/features/money/payments/correctionApi'
import { useCorrectPayment, useOrderPayments, useRestorePayment, useVoidPayment } from '@/features/money/payments/correctionHooks'

/*
 * Void, correct and Undo a recorded payment (migration 0073; DECISIONS 2026-10-20). ADMIN ONLY: payments_in is admin-only, so
 * the list reads nothing for anyone else and the order page mounts it for an admin. One list serves the order page and the
 * Record payment dialog ("already recorded"): the payments that count, each with ⋯ Correct… / Void… (off, with a tip, while it
 * is ticked against the bank statement), a Corrected tag on a replacement, and the voided ones folded under "Voided (n)" with
 * Undo while the admin who voided may still undo it.
 */
export const VOID_QUICK_REASONS = ['Typed twice', 'Wrong order', 'Cheque bounced'] as const

const BANK_TIP = 'Ticked against the bank statement. Untick it first in Match bank statement, then change it.'

/** The refusal sentence, with a way forward for a closed month or a bank tick. */
export function CorrectionError({ error, line }: { error: unknown; line?: PaymentLine }) {
  const m = mapPgError(error, { entity: 'payment' })
  const month = line?.bankMonth?.slice(0, 7) ?? line?.receivedOn.slice(0, 7)
  let link: ReactNode = null
  if (m.code === 'month_closed') link = <Link to="/money/month-end" className="font-medium text-primary underline">Open Month-end</Link>
  if (m.code === 'bank_ticked')
    link = (
      <Link to={month ? `/money/month-end/bank?month=${month}` : '/money/month-end/bank'} className="font-medium text-primary underline">
        Open Match bank statement
      </Link>
    )
  return (
    <p role="alert" data-testid="correction-error" className="text-sm text-tone-danger-fg">
      {m.message} {link}
    </p>
  )
}

function lineText(l: PaymentLine, today: string) {
  return (
    <>
      <span className="num">PKR {formatAmount(l.amount)}</span> · {formatShortDate(l.receivedOn, today)} · {PAID_VIA_LABEL[l.paidVia]}
      {l.reference ? <span className="text-fg-muted"> · Ref {l.reference}</span> : null}
    </>
  )
}

/** The ⋯ of one payment that counts. */
export function PaymentRowMenu({ line, orderNumber }: { line: PaymentLine; orderNumber: number }) {
  const [dialog, setDialog] = useState<'void' | 'correct' | null>(null)
  const blocked = changeBlockedBy(line)
  if (blocked === 'voided') return null
  const trigger = (
    <Button icon={Ellipsis} size="sm" variant="quiet" aria-label={`Change payment of PKR ${formatAmount(line.amount)}`} disabled={blocked === 'bank_ticked'} />
  )
  if (blocked === 'bank_ticked')
    return (
      <Tooltip content={BANK_TIP} forDisabled>
        {trigger}
      </Tooltip>
    )
  return (
    <>
      <Popover>
        <PopoverTrigger asChild>{trigger}</PopoverTrigger>
        <PopoverContent variant="menu" align="end">
          <MenuItem icon={PencilLine} onClick={() => setDialog('correct')}>
            Correct…
          </MenuItem>
          <MenuItem icon={Ban} danger onClick={() => setDialog('void')}>
            Void…
          </MenuItem>
        </PopoverContent>
      </Popover>
      <VoidPaymentDialog open={dialog === 'void'} onOpenChange={o => setDialog(o ? 'void' : null)} line={line} orderNumber={orderNumber} />
      <CorrectPaymentDialog open={dialog === 'correct'} onOpenChange={o => setDialog(o ? 'correct' : null)} line={line} orderNumber={orderNumber} />
    </>
  )
}

export function VoidPaymentDialog({ open, onOpenChange, line, orderNumber }: { open: boolean; onOpenChange: (o: boolean) => void; line: PaymentLine; orderNumber: number }) {
  const today = businessToday()
  const { toast } = useToast()
  const voidIt = useVoidPayment(line.orderId)
  const restore = useRestorePayment(line.orderId)
  const [reason, setReason] = useState('')
  const [tried, setTried] = useState(false)
  const close = (o: boolean) => {
    onOpenChange(o)
    if (!o) {
      setReason('')
      setTried(false)
      voidIt.reset()
    }
  }
  const submit = () => {
    setTried(true)
    if (!reason.trim()) return
    // mutateAsync, not mutate's onSuccess: the save re-reads the payments before it returns, the voided line moves under "Voided" and
    // this dialog's row unmounts, and a per-call onSuccess is dropped once its component is gone (the Undo toast never showed).
    // A failure stays on voidIt.error for the dialog to show.
    voidIt.mutateAsync({ paymentId: line.id, reason: reason.trim() }).then(
      () => {
        const t = voidToastText(line, orderNumber, today)
        toast({
          title: t.title,
          body: t.body,
          tone: 'success',
          undo: {
            onUndo: async () => {
              await restore.mutateAsync(line.id)
            },
            undoneBody: t.undoneBody,
          },
        })
        close(false)
      },
      () => undefined,
    )
  }
  return (
    <Dialog open={open} onOpenChange={close} busy={voidIt.isPending}>
      <DialogContent
        title="Void payment"
        icon={Ban}
        tone="danger"
        size="sm"
        context={`${orderRef(orderNumber)} · PKR ${formatAmount(line.amount)} · ${formatShortDate(line.receivedOn, today)}`}
        footer={
          <>
            <Button variant="quiet" onClick={() => close(false)} data-cancel>
              Cancel
            </Button>
            <Button variant="danger" icon={Ban} busy={voidIt.isPending} busyLabel="Voiding" onClick={submit}>
              Void payment
            </Button>
          </>
        }
      >
        <div className="grid gap-4">
          <p className="text-sm text-fg-2">It stops counting in the balance and every money figure. The record stays, with your reason. You can undo it for 10 minutes.</p>
          <Field label="Reason" requirement="required" error={tried && !reason.trim() ? 'Say why it is voided' : undefined}>
            <TextArea value={reason} onChange={e => setReason(e.target.value)} rows={2} data-autofocus />
          </Field>
          <div className="flex flex-wrap gap-2" aria-label="Quick reasons">
            {VOID_QUICK_REASONS.map(r => (
              <Button key={r} size="sm" variant="secondary" onClick={() => setReason(r)}>
                {r}
              </Button>
            ))}
          </div>
          {voidIt.isError ? <CorrectionError error={voidIt.error} line={line} /> : null}
        </div>
      </DialogContent>
    </Dialog>
  )
}

export function CorrectPaymentDialog({ open, onOpenChange, line, orderNumber }: { open: boolean; onOpenChange: (o: boolean) => void; line: PaymentLine; orderNumber: number }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {open ? <CorrectForm line={line} orderNumber={orderNumber} onClose={() => onOpenChange(false)} /> : null}
    </Dialog>
  )
}

function CorrectForm({ line, orderNumber, onClose }: { line: PaymentLine; orderNumber: number; onClose: () => void }) {
  const today = businessToday()
  const { toast } = useToast()
  const correct = useCorrectPayment(line.orderId)
  const restore = useRestorePayment(line.orderId)
  // Made once when the dialog opens and kept for retries: a retry returns the same new payment instead of a second one.
  const [newId] = useState(() => crypto.randomUUID())
  const before: PaymentFigures = { amount: line.amount, receivedOn: line.receivedOn, paidVia: line.paidVia, reference: line.reference }
  const [amount, setAmount] = useState<number | null>(line.amount)
  const [receivedOn, setReceivedOn] = useState(line.receivedOn)
  const [paidVia, setPaidVia] = useState<PaidVia>(line.paidVia)
  const [reference, setReference] = useState(line.reference ?? '')
  const [reason, setReason] = useState('')
  const [tried, setTried] = useState(false)
  const after: PaymentFigures = { amount: amount ?? 0, receivedOn, paidVia, reference: reference.trim() || null }
  const changes = amount && amount > 0 && receivedOn ? correctionChanges(before, after, today) : []
  const submit = () => {
    setTried(true)
    if (!reason.trim() || changes.length === 0) return
    // mutateAsync for the same reason as Void: the corrected line moves and this dialog's row can unmount before the save returns.
    correct.mutateAsync({ paymentId: line.id, newId, reason: reason.trim(), ...after }).then(
      () => {
        const t = correctionToastText(before, after, orderNumber, today)
        toast({
          title: t.title,
          body: t.body,
          tone: 'success',
          undo: {
            onUndo: async () => {
              await restore.mutateAsync(line.id)
            },
            undoneBody: t.undoneBody,
          },
        })
        onClose()
      },
      () => undefined,
    )
  }
  return (
    <DialogContent
      title="Correct payment"
      icon={PencilLine}
      size="md"
      context={`${orderRef(orderNumber)} · recorded as PKR ${formatAmount(line.amount)} on ${formatShortDate(line.receivedOn, today)}`}
      lead={<span className="text-xs">Wrong order? Void it here and record it on the right order.</span>}
      footer={
        <>
          <Button variant="quiet" onClick={onClose} data-cancel>
            Cancel
          </Button>
          <Button variant="primary" icon={Check} busy={correct.isPending} busyLabel="Saving" disabled={changes.length === 0} onClick={submit}>
            {correct.isError ? 'Try again' : 'Save correction'}
          </Button>
        </>
      }
    >
      <div className="grid gap-4">
        <div className="grid gap-4 md:grid-cols-2">
          <Field label="Amount received, PKR" error={tried && !(amount && amount > 0) ? 'The amount must be above zero' : undefined}>
            <NumberInput value={amount} onChange={setAmount} inputMode="decimal" />
          </Field>
          <Field label="Date received">
            <DateInput value={receivedOn} onChange={setReceivedOn} />
          </Field>
          <Field label="Paid via">
            <Select value={paidVia} onChange={e => setPaidVia(e.target.value as PaidVia)} options={(Object.keys(PAID_VIA_LABEL) as PaidVia[]).map(v => ({ value: v, label: PAID_VIA_LABEL[v] }))} />
          </Field>
          <Field label="Reference" requirement="optional">
            <TextField value={reference} onChange={e => setReference(e.target.value)} autoComplete="off" />
          </Field>
        </div>
        <Field label="Reason" requirement="required" error={tried && !reason.trim() ? 'Say why it is corrected' : undefined}>
          <TextField value={reason} onChange={e => setReason(e.target.value)} autoComplete="off" />
        </Field>
        <p data-testid="correction-changes" className="rounded bg-sunken px-4 py-3 text-sm text-fg-2">
          {changes.length === 0 ? 'Nothing changed yet.' : <>Changes: {changes.map(c => c.text).join(' · ')}</>}
        </p>
        {correct.isError ? <CorrectionError error={correct.error} line={line} /> : null}
      </div>
    </DialogContent>
  )
}

/** One order's payments with their actions (admin). `compact` drops the heading spacing for the Record payment dialog. */
export function OrderPaymentLines({ orderId, orderNumber, compact = false }: { orderId: string; orderNumber: number; compact?: boolean }) {
  const session = useSession()
  const user = session.status === 'signed-in' ? session.user : null
  const isAdmin = user?.role === 'admin'
  const q = useOrderPayments(orderId, isAdmin)
  const restore = useRestorePayment(orderId)
  const { toast } = useToast()
  const [showVoided, setShowVoided] = useState(false)
  if (!isAdmin) return null
  if (q.isPending) return <Skeleton className="h-8" />
  if (q.isError) return <p className="text-sm text-fg-muted">The payments did not load. Reload to try again.</p>
  const today = businessToday()
  const counting = q.data.filter(l => l.status === 'counts')
  const voided = q.data.filter(l => l.status !== 'counts')
  if (q.data.length === 0) return compact ? null : <p className="text-sm text-fg-muted">No payments recorded yet.</p>
  return (
    <div className={cn('grid gap-1', compact && 'text-sm')} data-testid="order-payment-lines">
      <ul className="grid gap-1">
        {counting.map(l => (
          <li key={l.id} data-testid="payment-line" className="flex items-center justify-between gap-2 text-sm text-fg-2">
            <span className="min-w-0">
              {lineText(l, today)} {l.correctsPaymentId ? <Tag className="ml-1">Corrected</Tag> : null}
            </span>
            <PaymentRowMenu line={l} orderNumber={orderNumber} />
          </li>
        ))}
      </ul>
      {voided.length > 0 ? (
        <div className="grid gap-1">
          <button type="button" className="flex items-center gap-1 text-left text-xs font-medium text-fg-muted" aria-expanded={showVoided} onClick={() => setShowVoided(v => !v)}>
            {showVoided ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
            Voided ({voided.length})
          </button>
          {showVoided ? (
            <ul className="grid gap-1">
              {voided.map(l => (
                <li key={l.id} data-testid="voided-line" className="flex items-center justify-between gap-2 text-sm text-fg-muted">
                  <span className="min-w-0">
                    <s>{lineText(l, today)}</s>
                    {l.voidReason ? <span> · {l.status === 'corrected' ? 'Corrected' : 'Voided'}: {l.voidReason}</span> : null}
                  </span>
                  {canUndo(l, user?.id) ? (
                    <Button
                      size="sm"
                      variant="quiet"
                      icon={RotateCcw}
                      busy={restore.isPending}
                      onClick={() =>
                        restore.mutate(l.id, {
                          onSuccess: () => toast({ title: 'Undone', body: l.status === 'corrected' ? 'The original payment counts again.' : 'The payment counts again.', tone: 'success' }),
                          onError: e => toast({ title: 'Could not undo', body: mapPgError(e).message, tone: 'danger' }),
                        })
                      }
                    >
                      Undo
                    </Button>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
