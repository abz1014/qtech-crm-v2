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
 * Refund a customer (0117, 0118). Admin only. Money paid back out of the customer's credit balance: the amount starts at the whole
 * balance and the date is today, so refunding it all is: open it (1), Save refund (2). The optional parts (a reference, a reason,
 * the order it is for, and paid by bank or cash) stay folded away until asked for. The server refuses more than the balance and
 * asks "Record it anyway?" when the same customer already has a refund of that amount that day or with that reference.
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
      <DialogContent title="Refund customer" size="md" className="md:w-[520px]">
        {open ? <RefundForm companyId={companyId} companyName={companyName} credit={credit} onBusy={setBusy} onDone={() => onOpenChange(false)} onCancel={() => onOpenChange(false)} /> : null}
      </DialogContent>
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
    <>
      <p className="-mt-3 text-sm text-fg-muted">{companyName}</p>
      <Form sf={sf} labels={{ amount: 'Amount refunded', refundedOn: 'Date refunded' }} className="grid gap-4">
        <button type="submit" hidden tabIndex={-1} />
        {duplicate ? (
          <div data-testid="duplicate-refund">
            <Banner tone="warning" title={duplicate}>
              <Checkbox label="Record it anyway" checked={allowDuplicate} onCheckedChange={c => setAllowDuplicate(c === true)} />
            </Banner>
          </div>
        ) : null}
        <div className="grid gap-4 md:grid-cols-2">
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
              ? 'flex items-start gap-3 rounded border border-tone-warning-fg/40 bg-tone-warning-bg px-4 py-3 text-sm font-medium text-fg'
              : 'flex items-start gap-3 rounded bg-sunken px-4 py-3 text-sm text-fg-2'
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
          <FormField<Values, 'orderId'> name="orderId" label="For order" requirement="optional" help="Only to remember which order it was for. It changes no balance.">
            {f => (
              <Select {...f} options={[{ value: '', label: 'No particular order' }, ...(orders.data ?? []).map(o => ({ value: o.orderId, label: orderRef(o.orderNumber) }))]} />
            )}
          </FormField>
        ) : null}
        {showVia ? (
          <FormField<Values, 'paidVia'> name="paidVia" label="Paid via" help="Bank refunds are matched to the bank statement at month end; cash comes out of the cash box.">
            {f => <Select {...f} options={(Object.keys(PAID_VIA_LABEL) as PaidVia[]).map(v => ({ value: v, label: PAID_VIA_LABEL[v] }))} />}
          </FormField>
        ) : null}
        <p className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-fg-muted">
          {!showRef ? <LinkButton onClick={() => setShowRef(true)}>Add a reference</LinkButton> : null}
          {!showReason ? <LinkButton onClick={() => setShowReason(true)}>Add a reason</LinkButton> : null}
          {!showOrder ? <LinkButton onClick={() => setShowOrder(true)}>Link to an order</LinkButton> : null}
          {!showVia ? (
            <span>
              Paid via <b className="font-medium text-fg-2">{PAID_VIA_LABEL[paidVia as PaidVia]}</b>. <LinkButton onClick={() => setShowVia(true)}>Change</LinkButton>
            </span>
          ) : null}
        </p>
      </Form>
      <div className="-mx-5 -mb-5 mt-1 flex items-center justify-end gap-2 border-t bg-sunken px-5 py-3 max-md:flex-col-reverse max-md:items-stretch">
        <Button variant="quiet" onClick={onCancel} data-cancel>
          Cancel
        </Button>
        <Button variant="primary" type="submit" form={sf.formId} icon={Check} busy={sf.pending} busyLabel="Saving">
          {sf.failed ? 'Try again' : 'Save refund'}
        </Button>
      </div>
    </>
  )
}

function LinkButton({ children, onClick }: { children: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="rounded font-medium text-primary underline-offset-2 hover:underline">
      {children}
    </button>
  )
}
