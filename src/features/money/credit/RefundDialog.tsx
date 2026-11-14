import { useEffect, useRef, useState } from 'react'
import { Check, Info, TriangleAlert } from 'lucide-react'
import { z } from 'zod'
import { businessToday } from '@/lib/dates'
import { amountSchema, businessDateRange, inDateRange, pkr } from '@/lib/formRules'
import { mapPgError } from '@/lib/pgErrors'
import { orderRef } from '@/lib/refs'
import { Banner } from '@/ui/Banner'
import { Button } from '@/ui/Button'
import { Checkbox } from '@/ui/form/Checkbox'
import { Dialog, DialogContent } from '@/ui/Dialog'
import { Icon } from '@/ui/Icon'
import { useToast } from '@/ui/useToast'
import { DateInput } from '@/ui/form/DateInput'
import { Form, FormField } from '@/ui/form/Form'
import { NumberInput } from '@/ui/form/NumberInput'
import { Select } from '@/ui/form/Select'
import { TextField } from '@/ui/form/TextField'
import { useSubmitForm } from '@/ui/form/useSubmitForm'
import { PAID_VIA_LABEL, type PaidVia } from '@/features/money/expenses/model'
import { refundDefault, refundNote, type CreditSummary } from '@/features/money/credit/model'
import { useCompanyOrders, useRecordRefund } from '@/features/money/credit/hooks'

/*
 * Refund a customer (0126, 0127). Admin only. Money paid back out of the customer's credit balance: the amount starts at the whole
 * balance and the date is today, so refunding it all is: open it (1), Save refund (2). The optional parts (a reference, a reason,
 * the order it is for, and paid by bank or cash) stay folded away until asked for. The server refuses more than the balance and
 * asks "Record it anyway?" when the same customer already has a refund of that amount that day or with that reference.
 * Forest (55-credit-statement #rf-open): the customer under the title (the dialog's header grid), one column of fields, the folded
 * parts as a column of green links, and Cancel and Save refund in the dialog's own footer.
 */
interface RefundDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  companyId: string
  companyName: string
  credit: CreditSummary
}

export function RefundDialog({ open, onOpenChange, companyId, companyName, credit }: RefundDialogProps) {
  const [busy, setBusy] = useState(false)
  return (
    <Dialog open={open} onOpenChange={onOpenChange} busy={busy}>
      {open ? <RefundForm companyId={companyId} companyName={companyName} credit={credit} onBusy={setBusy} onDone={() => onOpenChange(false)} onCancel={() => onOpenChange(false)} /> : null}
    </Dialog>
  )
}

const schema = z.object({
  amount: amountSchema('Enter the amount refunded'),
  refundedOn: z.string().min(1, 'Choose a date').superRefine(inDateRange(() => businessDateRange())),
  reference: z.string(),
  reason: z.string(),
  orderId: z.string(),
  paidVia: z.enum(['bank', 'cash']),
})
type Values = z.input<typeof schema>

function RefundForm({ companyId, companyName, credit, onBusy, onDone, onCancel }: { companyId: string; companyName: string; credit: CreditSummary; onBusy: (b: boolean) => void; onDone: () => void; onCancel: () => void }) {
  const toast = useToast()
  const record = useRecordRefund(companyId)
  const [showRef, setShowRef] = useState(false)
  const [showReason, setShowReason] = useState(false)
  const [showOrder, setShowOrder] = useState(false)
  const [showVia, setShowVia] = useState(false)
  const [duplicate, setDuplicate] = useState<string | null>(null)
  const [allowDuplicate, setAllowDuplicate] = useState(false)
  const orders = useCompanyOrders(companyId, showOrder)
  const amountRef = useRef<HTMLInputElement | null>(null)

  const sf = useSubmitForm({
    schema,
    entity: 'refund',
    defaultValues: { amount: refundDefault(credit) || (undefined as unknown as number), refundedOn: businessToday(), reference: '', reason: '', orderId: '', paidVia: 'bank' } satisfies Partial<Values>,
    routeError: e => (e.kind === 'closed-month' ? { field: 'refundedOn' } : undefined),
    onSubmit: async (v, { requestId }) => {
      try {
        await record.mutateAsync({
          id: requestId,
          companyId,
          orderId: v.orderId || null,
          refundedOn: v.refundedOn,
          amount: v.amount,
          paidVia: v.paidVia as PaidVia,
          reference: v.reference.trim() || null,
          reason: v.reason.trim() || null,
          confirmDuplicate: allowDuplicate,
        })
      } catch (e) {
        const m = mapPgError(e)
        if (m.hint === 'duplicate_refund') setDuplicate(m.message)
        throw e
      }
    },
    onSuccess: v => {
      toast.toast({ title: 'Recorded refund', body: `${companyName} · ${pkr(v.amount)}`, tone: 'success' })
      onDone()
    },
  })
  useEffect(() => onBusy(sf.pending), [sf.pending, onBusy])
  useEffect(() => {
    amountRef.current?.focus()
  }, [])

  const amount = sf.form.watch('amount')
  const paidVia = sf.form.watch('paidVia')
  const note = refundNote(credit, typeof amount === 'number' ? amount : null)

  return (
    <DialogContent
      title="Refund customer"
      context={companyName}
      size="md"
      className="md:w-[520px]"
      footer={
        <>
          {/* No data-cancel: Cancel closes at once, as it did when it sat in the body (the footer would ask "Discard unsaved changes?"). */}
          <Button onClick={onCancel} disabled={sf.pending}>
            Cancel
          </Button>
          <Button variant="primary" type="submit" form={sf.formId} icon={Check} busy={sf.pending} busyLabel="Saving">
            {sf.failed ? 'Try again' : 'Save refund'}
          </Button>
        </>
      }
    >
      <Form sf={sf} labels={{ amount: 'Amount refunded', refundedOn: 'Date refunded' }} className="grid gap-4">
        <button type="submit" hidden tabIndex={-1} />
        {duplicate ? (
          <div data-testid="duplicate-refund">
            <Banner tone="warning" title={duplicate}>
              <Checkbox label="Record it anyway" checked={allowDuplicate} onCheckedChange={c => setAllowDuplicate(c === true)} />
            </Banner>
          </div>
        ) : null}
        <div className="grid gap-4">
          <FormField<Values, 'amount'> name="amount" label="Amount refunded, PKR" source={{ label: 'Their whole credit balance' }}>
            {f => (
              <NumberInput
                {...f}
                ref={r => {
                  f.ref(r)
                  amountRef.current = r
                }}
                inputMode="decimal"
              />
            )}
          </FormField>
          <FormField<Values, 'refundedOn'> name="refundedOn" label="Date refunded" source={{ label: 'Today', plain: true }}>
            {f => <DateInput {...f} />}
          </FormField>
        </div>

        <p
          data-testid="refund-note"
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

        {showRef ? (
          <FormField<Values, 'reference'> name="reference" label="Reference" requirement="optional" help="Transfer or cheque number.">
            {f => <TextField {...f} autoComplete="off" />}
          </FormField>
        ) : null}
        {showReason ? (
          <FormField<Values, 'reason'> name="reason" label="Reason" requirement="optional">
            {f => <TextField {...f} autoComplete="off" />}
          </FormField>
        ) : null}
        {showOrder ? (
          <FormField<Values, 'orderId'> name="orderId" label="Paid back from order" requirement="optional" help="Which order's overpayment is refunded. Left empty, the oldest order that holds enough is used.">
            {f => (
              <Select {...f} options={[{ value: '', label: 'Oldest order that holds enough' }, ...(orders.data ?? []).map(o => ({ value: o.orderId, label: orderRef(o.orderNumber) }))]} />
            )}
          </FormField>
        ) : null}
        {showVia ? (
          <FormField<Values, 'paidVia'> name="paidVia" label="Paid via" help="Bank refunds are matched to the bank statement at month end. Cash comes out of cash in hand.">
            {f => <Select {...f} options={(Object.keys(PAID_VIA_LABEL) as PaidVia[]).map(v => ({ value: v, label: PAID_VIA_LABEL[v] }))} />}
          </FormField>
        ) : null}
        <div className="grid justify-items-start gap-3 text-sm text-fg-2">
          {!showRef ? <LinkButton onClick={() => setShowRef(true)}>Add a reference</LinkButton> : null}
          {!showReason ? <LinkButton onClick={() => setShowReason(true)}>Add a reason</LinkButton> : null}
          {!showOrder ? <LinkButton onClick={() => setShowOrder(true)}>Choose the order</LinkButton> : null}
          {!showVia ? (
            <span>
              Paid via <b className="font-semibold text-fg">{PAID_VIA_LABEL[paidVia as PaidVia]}</b>. <LinkButton onClick={() => setShowVia(true)}>Change</LinkButton>
            </span>
          ) : null}
        </div>
      </Form>
    </DialogContent>
  )
}

function LinkButton({ children, onClick }: { children: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="rounded font-semibold text-primary underline-offset-2 hover:underline">
      {children}
    </button>
  )
}
