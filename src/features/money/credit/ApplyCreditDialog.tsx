import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Check, CircleAlert, Info, TriangleAlert } from 'lucide-react'
import { z } from 'zod'
import { businessToday } from '@/lib/dates'
import { amountSchema, businessDateRange, inDateRange, pkr } from '@/lib/formRules'
import { formatAmount } from '@/lib/money'
import { orderRef } from '@/lib/refs'
import { Button } from '@/ui/Button'
import { Dialog, DialogContent } from '@/ui/Dialog'
import { Icon } from '@/ui/Icon'
import { Skeleton } from '@/ui/Skeleton'
import { useToast } from '@/ui/useToast'
import { DateInput } from '@/ui/form/DateInput'
import { Form, FormField } from '@/ui/form/Form'
import { NumberInput } from '@/ui/form/NumberInput'
import { Select } from '@/ui/form/Select'
import { TextField } from '@/ui/form/TextField'
import { useSubmitForm } from '@/ui/form/useSubmitForm'
import { applyDefault, applyNote, type ApplyTarget, type CreditSummary } from '@/features/money/credit/model'
import { useApplyCredit, useApplyTargets } from '@/features/money/credit/hooks'

/*
 * Apply credit to another order of the same customer (0127). Admin only. An allocation record, not a payment: no cash moves, the
 * target order is settled by it (up to what it owes) and the customer's credit balance goes down by the same amount. The order is
 * chosen from the customer's orders that still owe money; the amount starts at the smaller of the credit and what the order owes.
 * Forest (55-credit-statement #ap-open): who and how much credit they hold under the title (the dialog's header grid), one column of
 * fields, and the buttons in the dialog's own footer. While the orders load, on a read error and with no order to put it against,
 * the same header with Close alone.
 */
interface ApplyCreditDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  companyId: string
  companyName: string
  credit: CreditSummary
}

export function ApplyCreditDialog({ open, onOpenChange, companyId, companyName, credit }: ApplyCreditDialogProps) {
  const [busy, setBusy] = useState(false)
  return (
    <Dialog open={open} onOpenChange={onOpenChange} busy={busy}>
      {open ? <ApplyLoader companyId={companyId} companyName={companyName} credit={credit} onBusy={setBusy} onDone={() => onOpenChange(false)} onCancel={() => onOpenChange(false)} /> : null}
    </Dialog>
  )
}

/** The dialog frame every state shares: the title, the customer and their credit under it, the footer the caller gives. */
function ApplyFrame({ companyName, credit, footer, children }: { companyName: string; credit: CreditSummary; footer: ReactNode; children: ReactNode }) {
  return (
    <DialogContent
      title="Apply credit to an order"
      context={
        <>
          {companyName} · holds <span className="num">PKR {formatAmount(credit.balance)}</span> of credit
        </>
      }
      size="md"
      className="md:w-[520px]"
      footer={footer}
    >
      {children}
    </DialogContent>
  )
}

function ApplyLoader(props: { companyId: string; companyName: string; credit: CreditSummary; onBusy: (b: boolean) => void; onDone: () => void; onCancel: () => void }) {
  const q = useApplyTargets(props.companyId, true)
  const close = (
    <Button onClick={props.onCancel} data-cancel>
      Close
    </Button>
  )
  if (q.isError)
    return (
      <ApplyFrame companyName={props.companyName} credit={props.credit} footer={close}>
        <p role="alert" className="flex items-start gap-3 rounded-control bg-tone-danger-bg px-4 py-3 text-sm font-semibold text-tone-danger-fg">
          <Icon icon={CircleAlert} className="mt-[2px]" />
          <span>The orders could not be read. Close this and try again. Nothing was applied.</span>
        </p>
      </ApplyFrame>
    )
  // the balances must be today's, never a cached page
  if (q.isPending || !q.isFetchedAfterMount)
    return (
      <ApplyFrame companyName={props.companyName} credit={props.credit} footer={close}>
        <div className="grid gap-4" role="status" aria-busy="true" aria-label="Loading the orders that owe">
          <Skeleton className="h-control-lg rounded-control" />
          <Skeleton className="h-control-lg rounded-control" />
          <Skeleton className="h-12 rounded-control" />
        </div>
      </ApplyFrame>
    )
  if (q.data.length === 0) {
    return (
      <ApplyFrame companyName={props.companyName} credit={props.credit} footer={close}>
        <p className="text-sm text-fg-2" data-testid="no-targets">
          No order of {props.companyName} has a balance due, so there is nothing to put the credit against. Refund it instead.
        </p>
      </ApplyFrame>
    )
  }
  return <ApplyForm {...props} targets={q.data} />
}

const schema = z.object({
  orderId: z.string().min(1, 'Choose the order'),
  amount: amountSchema('Enter the amount to apply'),
  appliedOn: z.string().min(1, 'Choose a date').superRefine(inDateRange(() => businessDateRange())),
  note: z.string(),
})
type Values = z.input<typeof schema>

function ApplyForm({ companyId, companyName, credit, targets, onBusy, onDone, onCancel }: { companyId: string; companyName: string; credit: CreditSummary; targets: ApplyTarget[]; onBusy: (b: boolean) => void; onDone: () => void; onCancel: () => void }) {
  const toast = useToast()
  const apply = useApplyCredit(companyId)
  const [showNote, setShowNote] = useState(false)
  const first = targets[0]
  const sf = useSubmitForm({
    schema,
    entity: 'credit application',
    defaultValues: { orderId: first.orderId, amount: applyDefault(credit, first), appliedOn: businessToday(), note: '' } satisfies Partial<Values>,
    routeError: e => (e.kind === 'closed-month' ? { field: 'appliedOn' } : undefined),
    onSubmit: async (v, { requestId }) => {
      await apply.mutateAsync({ id: requestId, toOrderId: v.orderId, amount: v.amount, appliedOn: v.appliedOn, note: v.note.trim() || null })
    },
    onSuccess: v => {
      toast.toast({ title: 'Applied credit', body: `${pkr(v.amount)} to ${orderRef(targets.find(t => t.orderId === v.orderId)?.orderNumber ?? 0)}`, tone: 'success' })
      onDone()
    },
  })
  useEffect(() => onBusy(sf.pending), [sf.pending, onBusy])

  const orderId = sf.form.watch('orderId')
  const amount = sf.form.watch('amount')
  const target = useMemo(() => targets.find(t => t.orderId === orderId) ?? null, [targets, orderId])
  const note = applyNote(credit, target, typeof amount === 'number' ? amount : null)
  const setAmountFor = (id: string) => {
    const t = targets.find(x => x.orderId === id) ?? null
    sf.form.setValue('amount', applyDefault(credit, t))
  }

  return (
    <ApplyFrame
      companyName={companyName}
      credit={credit}
      footer={
        <>
          {/* No data-cancel: Cancel closes at once, as it did when it sat in the body (the footer would ask "Discard unsaved changes?"). */}
          <Button onClick={onCancel} disabled={sf.pending}>
            Cancel
          </Button>
          <Button variant="primary" type="submit" form={sf.formId} icon={Check} busy={sf.pending} busyLabel="Saving">
            {sf.failed ? 'Try again' : 'Apply credit'}
          </Button>
        </>
      }
    >
      <Form sf={sf} labels={{ orderId: 'Order', amount: 'Amount to apply', appliedOn: 'Date' }} className="grid gap-4">
        <button type="submit" hidden tabIndex={-1} />
        <FormField<Values, 'orderId'> name="orderId" label="Put it against" source={{ label: 'Their oldest order with a balance due' }}>
          {f => (
            <Select
              {...f}
              onChange={e => {
                f.onChange(e)
                setAmountFor(e.target.value)
              }}
              options={targets.map(t => ({ value: t.orderId, label: `${orderRef(t.orderNumber)} · due PKR ${formatAmount(t.balance)}` }))}
            />
          )}
        </FormField>
        <div className="grid gap-4">
          <FormField<Values, 'amount'> name="amount" label="Amount to apply, PKR" source={{ label: 'The smaller of the credit and the balance due' }}>
            {f => <NumberInput {...f} inputMode="decimal" />}
          </FormField>
          <FormField<Values, 'appliedOn'> name="appliedOn" label="Date" source={{ label: 'Today', plain: true }}>
            {f => <DateInput {...f} />}
          </FormField>
        </div>
        <p
          data-testid="apply-note"
          data-kind={note.kind}
          role={note.kind === 'over' ? 'alert' : undefined}
          className={
            note.kind === 'over'
              ? 'flex items-start gap-3 rounded-control bg-tone-warning-bg px-4 py-3 text-sm font-semibold text-tone-warning-fg'
              : 'flex items-start gap-3 rounded-control bg-sunken px-4 py-3 text-sm text-fg-2'
          }
        >
          <Icon icon={note.kind === 'over' ? TriangleAlert : Info} className={note.kind === 'over' ? 'mt-[2px] text-tone-warning-fg' : 'mt-[2px] text-fg-muted'} />
          <span>{note.text}</span>
        </p>
        {showNote ? (
          <FormField<Values, 'note'> name="note" label="Note" requirement="optional">
            {f => <TextField {...f} autoComplete="off" />}
          </FormField>
        ) : (
          <p className="text-xs text-fg-muted">
            <button type="button" onClick={() => setShowNote(true)} className="rounded font-semibold text-primary underline-offset-2 hover:underline">
              Add a note
            </button>
            , optional.
          </p>
        )}
      </Form>
    </ApplyFrame>
  )
}
