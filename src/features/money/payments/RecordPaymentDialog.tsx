import { useEffect, useRef, useState } from 'react'
import { TriangleAlert, Check, Info } from 'lucide-react'
import { z } from 'zod'
import { businessToday } from '@/lib/dates'
import { amountSchema, businessDateRange, inDateRange, pkr } from '@/lib/formRules'
import { orderRef } from '@/lib/refs'
import { mapPgError } from '@/lib/pgErrors'
import { Banner } from '@/ui/Banner'
import { Button } from '@/ui/Button'
import { Checkbox } from '@/ui/form/Checkbox'
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
import { PAID_VIA_LABEL, type PaidVia } from '@/features/money/expenses/model'
import type { PaymentOrder } from '@/features/money/payments/api'
import { usePaymentOrder, useRecordPayment } from '@/features/money/payments/hooks'
import { OrderPaymentLines } from '@/features/money/payments/PaymentCorrections'
import { defaultPaymentAmount, paymentNote } from '@/features/money/payments/model'

/*
 * Record payment (M02; g2-money "record payment dialog"). Admin only. Opened from the order or from Receivables. The amount is
 * the balance due and the date is today, so a full payment is: open it (1), Save payment (2), nothing typed. A smaller amount
 * records a part payment. Amounts are gross, GST included. There is no bank or deposit field: the optional reference is the
 * transfer or cheque number, and paid via follows the database default (bank).
 *
 *   /money/receivables?pay=1&order=<id>   opens it for that order
 */
interface RecordPaymentDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  orderId: string | null
  onRecorded?: () => void
}

export function RecordPaymentDialog({ open, onOpenChange, orderId, onRecorded }: RecordPaymentDialogProps) {
  const [busy, setBusy] = useState(false)
  return (
    <Dialog open={open} onOpenChange={onOpenChange} busy={busy}>
      <DialogContent title="Record payment" size="md" className="md:w-[520px]">
        {open && orderId ? (
          <PaymentLoader orderId={orderId} onBusy={setBusy} onDone={() => { onOpenChange(false); onRecorded?.() }} onCancel={() => onOpenChange(false)} />
        ) : null}
      </DialogContent>
    </Dialog>
  )
}

function PaymentLoader(props: { orderId: string; onBusy: (b: boolean) => void; onDone: () => void; onCancel: () => void }) {
  const q = usePaymentOrder(props.orderId)
  if (q.isError)
    return (
      <p role="alert" className="text-sm text-tone-danger-fg">
        The balance could not be read. Close this and try again. Nothing was recorded.
      </p>
    )
  // HW-44: the amount opens at the balance due, so it must be today's balance, never a cached one (a page reload restores the
  // cache): an order settled since would open at the old balance and one Save would record that payment twice.
  if (q.isPending || !q.isFetchedAfterMount)
    return (
      <div className="grid gap-4" aria-busy="true">
        <Skeleton className="h-8" />
        <Skeleton className="h-16" />
      </div>
    )
  if (!q.data) return <p role="alert" className="text-sm text-tone-danger-fg">This order is not here any more.</p>
  return <PaymentForm {...props} data={q.data} />
}

const schema = z.object({
  amount: amountSchema('Enter the amount received'),
  receivedOn: z.string().min(1, 'Choose a date').superRefine(inDateRange(() => businessDateRange())),
  reference: z.string(),
  paidVia: z.enum(['bank', 'cash']),
})
type Values = z.input<typeof schema>

function PaymentForm({ data, onBusy, onDone, onCancel }: { data: PaymentOrder; onBusy: (b: boolean) => void; onDone: () => void; onCancel: () => void }) {
  const toast = useToast()
  const row = data.row
  const record = useRecordPayment(row.orderId)
  const [showRef, setShowRef] = useState(false)
  const [showVia, setShowVia] = useState(false)
  // 0114: the server says it looks like a payment already recorded; the person ticks to record it anyway and saves again
  const [duplicate, setDuplicate] = useState<string | null>(null)
  const [allowDuplicate, setAllowDuplicate] = useState(false)
  const amountRef = useRef<HTMLInputElement | null>(null)
  const facts = { gross: row.gross, settled: row.settled, balance: row.balance, invoiced: row.invoiceNumbers.length > 0, prior: data.prior }

  const sf = useSubmitForm({
    schema,
    entity: 'payment',
    defaultValues: {
      amount: defaultPaymentAmount(facts) ?? (undefined as unknown as number),
      receivedOn: businessToday(),
      reference: '',
      paidVia: 'bank',
    } satisfies Partial<Values>,
    // the month lock answers about the date, so the sentence sits under it and every entry stays
    routeError: e => (e.kind === 'closed-month' ? { field: 'receivedOn' } : undefined),
    onSubmit: async (v, { requestId }) => {
      try {
        await record.mutateAsync({
          id: requestId,
          orderId: row.orderId,
          receivedOn: v.receivedOn,
          amount: v.amount,
          reference: v.reference.trim() || null,
          paidVia: v.paidVia as PaidVia,
          confirmDuplicate: allowDuplicate,
        })
      } catch (e) {
        const m = mapPgError(e)
        if (m.hint === 'duplicate_payment') setDuplicate(m.message)
        throw e
      }
    },
    onSuccess: v => {
      toast.toast({ title: 'Recorded payment', body: `${orderRef(row.orderNumber)} · ${pkr(v.amount)}`, tone: 'success' })
      onDone()
    },
  })
  useEffect(() => onBusy(sf.pending), [sf.pending, onBusy])
  useEffect(() => {
    amountRef.current?.focus()
  }, [])

  const amount = sf.form.watch('amount')
  const paidVia = sf.form.watch('paidVia')
  const note = paymentNote(facts, typeof amount === 'number' ? amount : null)

  return (
    <>
      <p className="-mt-3 text-sm text-fg-muted">
        <span className="num">{orderRef(row.orderNumber)}</span> · {row.companyName}
      </p>
      <Form sf={sf} labels={{ amount: 'Amount received', receivedOn: 'Date received' }} className="grid gap-4">
        <button type="submit" hidden tabIndex={-1} />
        {duplicate ? (
          <div data-testid="duplicate-payment"><Banner tone="warning" title={duplicate}>
            <Checkbox label="Record it anyway" checked={allowDuplicate} onCheckedChange={c => setAllowDuplicate(c === true)} />
          </Banner></div>
        ) : null}
        <div className="grid gap-4 md:grid-cols-2">
          <FormField<Values, 'amount'> name="amount" label="Amount received, PKR" source={{ label: `Balance due on ${orderRef(row.orderNumber)}` }}>
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
          <FormField<Values, 'receivedOn'> name="receivedOn" label="Date received" source={{ label: 'Today', plain: true }}>
            {f => <DateInput {...f} />}
          </FormField>
        </div>

        <p
          data-testid="payment-note"
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
        {showVia ? (
          <FormField<Values, 'paidVia'> name="paidVia" label="Paid via" help="Bank payments are matched to the bank statement at month end; cash is not.">
            {f => <Select {...f} options={(Object.keys(PAID_VIA_LABEL) as PaidVia[]).map(v => ({ value: v, label: PAID_VIA_LABEL[v] }))} />}
          </FormField>
        ) : null}
        <p className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-fg-muted">
          {!showRef ? (
            <span>
              <LinkButton onClick={() => setShowRef(true)}>Add a reference</LinkButton>, optional: transfer or cheque number.
            </span>
          ) : null}
          {!showVia ? (
            <span>
              Paid via <b className="font-medium text-fg-2">{PAID_VIA_LABEL[paidVia as PaidVia]}</b>. <LinkButton onClick={() => setShowVia(true)}>Change</LinkButton>
            </span>
          ) : null}
        </p>
      </Form>
      {data.prior.length > 0 ? (
        <div className="grid gap-1 border-t pt-3" data-testid="already-recorded">
          <h3 className="text-xs font-medium text-fg-muted">Already recorded</h3>
          <OrderPaymentLines orderId={row.orderId} orderNumber={row.orderNumber} compact />
        </div>
      ) : null}
      <div className="-mx-5 -mb-5 mt-1 flex items-center justify-end gap-2 border-t bg-sunken px-5 py-3 max-md:flex-col-reverse max-md:items-stretch">
        <Button variant="quiet" onClick={onCancel} data-cancel>
          Cancel
        </Button>
        <Button variant="primary" type="submit" form={sf.formId} icon={Check} busy={sf.pending} busyLabel="Saving">
          {sf.failed ? 'Try again' : 'Save payment'}
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
