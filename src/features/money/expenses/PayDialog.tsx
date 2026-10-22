import { useEffect, useMemo, useRef, useState } from 'react'
import { Check, CircleAlert, Landmark, Wallet } from 'lucide-react'
import { businessToday } from '@/lib/dates'
import { mapPgError } from '@/lib/pgErrors'
import { Button } from '@/ui/Button'
import { Dialog, DialogContent } from '@/ui/Dialog'
import { Icon } from '@/ui/Icon'
import { SegmentedControl } from '@/ui/SegmentedControl'
import { Skeleton } from '@/ui/Skeleton'
import { useToast } from '@/ui/useToast'
import { Checkbox } from '@/ui/form/Checkbox'
import { NumberInput } from '@/ui/form/NumberInput'
import { useInsertPayment, useLegPayState } from '@/features/money/expenses/hooks'
import { pkr, type PaidVia } from '@/features/money/expenses/model'
import { effectiveRate, owedInCurrency, payInserts, payProblem } from '@/features/money/expenses/pay'

/*
 * Pay <supplier> (redesign phase 1: supplier payments have ONE door). Opened from the supplier order's menu on the order page and from
 * Pay on a We owe suppliers row; nowhere else records a supplier payment. For a foreign supplier it asks what was paid in their
 * currency (USD 3,240, pre-filled with what is still owed in it) and the PKR the bank actually debited; for a local one, the PKR
 * (pre-filled with what is still owed). Bank charges are their own line (a Bank charges expense, tagged to the order), never
 * folded into the supplier payment, so We owe suppliers settles in the supplier's own currency (0087). "Has a GST invoice" reveals
 * the input tax. Both rows save in one request: all or nothing.
 */
export interface PayContext {
  orderId: string
  orderLabel?: string
  legId: string
  supplierId: string
  supplierName: string
  /** The supplier order's currency, when the caller knows it (the dialog reads We owe suppliers for the rest). */
  currency?: string | null
  /** A PKR amount to start from (the order page's estimate), used when We owe suppliers has none. */
  amount?: number
  amountNote?: string
}

export function PayDialog({ open, onOpenChange, context }: { open: boolean; onOpenChange: (o: boolean) => void; context: PayContext }) {
  const [busy, setBusy] = useState(false)
  return (
    <Dialog open={open} onOpenChange={onOpenChange} busy={busy}>
      <DialogContent title={`Pay ${context.supplierName}`} context={[context.orderLabel, 'Supplier payment'].filter(Boolean).join(' · ')} size="md" className="md:w-[560px]">
        {open ? <PayForm context={context} onBusy={setBusy} onDone={() => onOpenChange(false)} /> : null}
      </DialogContent>
    </Dialog>
  )
}

function PayForm({ context, onBusy, onDone }: { context: PayContext; onBusy: (b: boolean) => void; onDone: () => void }) {
  const state = useLegPayState(context.legId)
  if (state.isPending)
    return (
      <div className="grid gap-4" aria-busy="true">
        <Skeleton className="h-10" />
        <Skeleton className="h-10" />
      </div>
    )
  const s = state.data
  const currency = (s?.currency ?? context.currency ?? 'PKR').toUpperCase()
  const owedFx = currency !== 'PKR' && s ? owedInCurrency(s.committed, s.paidFx) : null
  const owedPkr = s?.owedPkr ?? context.amount ?? null
  return <PayFormReady context={context} currency={currency} owedFx={owedFx} owedPkr={owedPkr} onBusy={onBusy} onDone={onDone} />
}

function PayFormReady({
  context,
  currency,
  owedFx,
  owedPkr,
  onBusy,
  onDone,
}: {
  context: PayContext
  currency: string
  owedFx: number | null
  owedPkr: number | null
  onBusy: (b: boolean) => void
  onDone: () => void
}) {
  const toast = useToast()
  const insert = useInsertPayment()
  const today = businessToday()
  const foreign = currency !== 'PKR'
  const [ids] = useState(() => ({ payment: crypto.randomUUID(), charges: crypto.randomUUID() }))
  const [fxAmount, setFxAmount] = useState<number | null>(foreign && owedFx ? owedFx : null)
  const [pkrAmount, setPkrAmount] = useState<number | null>(!foreign && owedPkr ? owedPkr : null)
  const [charges, setCharges] = useState<number | null>(null)
  const [paidOn, setPaidOn] = useState(today)
  const [paidVia, setPaidVia] = useState<PaidVia>('bank')
  const [hasGst, setHasGst] = useState(false)
  const [tax, setTax] = useState<number | null>(null)
  const [detail, setDetail] = useState('')
  const [error, setError] = useState<string | null>(null)
  const firstRef = useRef<HTMLInputElement | null>(null)
  useEffect(() => onBusy(insert.isPending), [insert.isPending, onBusy])
  useEffect(() => {
    firstRef.current?.focus()
  }, [])
  const rate = useMemo(() => (foreign ? effectiveRate(pkrAmount, fxAmount) : null), [foreign, pkrAmount, fxAmount])

  const submit = () => {
    const input = {
      paymentId: ids.payment,
      chargesId: ids.charges,
      orderId: context.orderId,
      legId: context.legId,
      supplierId: context.supplierId,
      supplierName: context.supplierName,
      currency,
      fxAmount,
      pkr: pkrAmount ?? 0,
      charges,
      paidOn,
      paidVia,
      inputTax: hasGst ? tax : null,
      detail,
    }
    const p = payProblem(input)
    if (p) {
      setError(
        p === 'fx'
          ? `Type what was paid in ${currency}.`
          : p === 'pkr'
            ? foreign
              ? 'Type the PKR the bank debited for it.'
              : 'Type the amount paid.'
            : p === 'charges'
              ? 'Bank charges cannot be below zero.'
              : 'The GST cannot be more than the amount paid.',
      )
      return
    }
    setError(null)
    insert.mutate(payInserts(input), {
      onSuccess: () => {
        toast.toast({
          title: `Paid ${context.supplierName}`,
          body: [foreign && fxAmount ? `${currency} ${fxAmount.toLocaleString('en-US', { maximumFractionDigits: 2 })}` : null, pkr(input.pkr), charges ? `bank charges ${pkr(charges)}` : null]
            .filter(Boolean)
            .join(' · '),
          tone: 'success',
        })
        onDone()
      },
      onError: e => {
        const m = mapPgError(e, { entity: 'expense' })
        if (m.kind === 'already-saved') onDone()
        else setError(`${m.message} Nothing was saved.`)
      },
    })
  }

  const field = 'num h-12 text-lg'
  return (
    <form
      className="grid gap-4 text-base"
      autoComplete="off"
      onSubmit={e => {
        e.preventDefault()
        submit()
      }}
    >
      {foreign ? (
        <label className="grid gap-2">
          <span className="font-medium">Paid in {currency}</span>
          <NumberInput ref={firstRef} value={fxAmount} onChange={setFxAmount} min={0.01} inputMode="decimal" className={field} aria-label={`Paid in ${currency}`} />
          {owedFx !== null ? <span className="text-fg-2">Still owed: {currency} {owedFx.toLocaleString('en-US', { maximumFractionDigits: 2 })}</span> : null}
        </label>
      ) : null}
      <label className="grid gap-2">
        <span className="font-medium">{foreign ? 'PKR debited from the bank' : 'Amount, PKR'}</span>
        <NumberInput
          ref={foreign ? undefined : firstRef}
          value={pkrAmount}
          onChange={setPkrAmount}
          min={0.01}
          inputMode="decimal"
          className={field}
          aria-label={foreign ? 'PKR debited from the bank' : 'Amount, PKR'}
        />
        <span className="text-fg-2">
          {foreign
            ? rate
              ? `That is PKR ${rate.toLocaleString('en-US', { maximumFractionDigits: 2 })} per ${currency}. Charges go in the next box.`
              : 'What reached the supplier, from your bank statement. Charges go in the next box.'
            : !foreign && owedPkr
              ? `Still owed: ${pkr(owedPkr)}${context.amountNote ? ` (${context.amountNote})` : ''}`
              : 'What reached the supplier. Charges go in the next box.'}
        </span>
      </label>
      <label className="grid gap-2">
        <span className="font-medium">
          Bank charges, PKR <span className="font-regular text-fg-muted">optional</span>
        </span>
        <NumberInput value={charges} onChange={setCharges} min={0} inputMode="decimal" className={field} aria-label="Bank charges, PKR" />
        <span className="text-fg-2">Saved as its own line (Bank charges), not as part of the supplier payment.</span>
      </label>
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="grid gap-2">
          <span className="font-medium">Date paid</span>
          <input type="date" value={paidOn} max={today} onChange={e => e.target.value && setPaidOn(e.target.value)} className="num min-h-touch rounded border border-line-input bg-surface px-3 text-base" />
        </label>
        <div className="grid gap-2">
          <span className="font-medium" aria-hidden="true">
            Paid by
          </span>
          <SegmentedControl
            aria-label="Paid by"
            value={paidVia}
            onValueChange={v => setPaidVia(v as PaidVia)}
            large
            options={[
              { value: 'bank', label: 'Bank', icon: Landmark },
              { value: 'cash', label: 'Cash', icon: Wallet },
            ]}
          />
        </div>
      </div>
      <label className="grid gap-2">
        <span className="font-medium">
          Reference <span className="font-regular text-fg-muted">optional</span>
        </span>
        <input value={detail} maxLength={200} onChange={e => setDetail(e.target.value)} placeholder="e.g. TT ref, cheque no." className="min-h-touch rounded border border-line-input bg-surface px-3 text-base placeholder:text-fg-muted" />
      </label>
      <Checkbox label={<span className="text-base">More: has a GST invoice</span>} checked={hasGst} onCheckedChange={c => setHasGst(c === true)} className="w-fit" />
      {hasGst ? (
        <label className="grid gap-2">
          <span className="font-medium">GST on this bill (input tax), PKR</span>
          <NumberInput value={tax} onChange={setTax} min={0} inputMode="decimal" className="num h-11 text-base" aria-label="GST on this bill (input tax), PKR" />
        </label>
      ) : null}
      {error ? (
        <p role="alert" className="flex items-center gap-2 text-tone-danger-fg">
          <Icon icon={CircleAlert} />
          {error}
        </p>
      ) : null}
      <div className="-mx-5 -mb-5 mt-1 flex items-center justify-end gap-2 border-t bg-sunken px-5 py-3 max-md:flex-col-reverse max-md:items-stretch">
        <Button variant="quiet" onClick={onDone} data-cancel className="text-base">
          Cancel
        </Button>
        <Button variant="primary" type="submit" icon={Check} busy={insert.isPending} busyLabel="Saving" className="text-base">
          Save payment
        </Button>
      </div>
    </form>
  )
}
