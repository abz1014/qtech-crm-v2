import { useId, useState } from 'react'
import { Plus } from 'lucide-react'
import { Icon } from '@/ui/Icon'
import { InfoTip } from '@/ui/InfoTip'
import { Money } from '@/ui/Money'
import { NumberInput } from '@/ui/form/NumberInput'

/*
 * Input tax (A6, owner decision 2026-10-14): collapsed and optional, shown on Supplier payment, Freight and Clearing only.
 * "Input tax, optional" opens one field; the lines under it say what is paid (the bank debit), the input tax, and the cost
 * that margin and the P&L use. Left collapsed it is zero, which is the normal case.
 */
interface InputTaxProps {
  amount: number | null
  value: number | null
  onChange: (value: number | null) => void
  /** Start open (an expense that already carries input tax). */
  defaultOpen?: boolean
  label?: string
  className?: string
}

export function InputTax({ amount, value, onChange, defaultOpen = false, label = 'Input tax', className }: InputTaxProps) {
  const id = useId()
  const [open, setOpen] = useState(defaultOpen || (value ?? 0) > 0)
  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={`inline-flex w-fit items-center gap-[6px] rounded text-xs font-medium text-primary ${className ?? ''}`}
      >
        <Icon icon={Plus} size="chip" />
        Input tax, optional
      </button>
    )
  }
  const tax = value ?? 0
  const paid = amount ?? 0
  const tooHigh = amount !== null && tax > paid
  return (
    <div className={`grid gap-3 rounded border bg-canvas px-4 py-3 ${className ?? ''}`}>
      <div className="grid grid-cols-[112px_minmax(0,1fr)] items-center gap-2">
        <label className="text-xs font-medium text-fg-2" htmlFor={id}>
          {label}, PKR
        </label>
        <NumberInput id={id} aria-label={`${label}, PKR`} value={value} onChange={onChange} min={0} aria-invalid={tooHigh || undefined} />
      </div>
      <div className="grid gap-[2px] text-xs text-fg-2">
        <span>
          Paid, the bank debit <Money value={paid} prefix={false} className="text-fg" />
        </span>
        <span>
          Input tax <Money value={tax} prefix={false} className="text-fg" />
          <InfoTip label="About input tax">GST on a bill that we can claim back. Leave 0 if unsure.</InfoTip>
        </span>
        <span>
          <b className="font-medium">Cost in margin and P&amp;L</b> <Money value={Math.max(paid - tax, 0)} prefix={false} className="text-fg" />
        </span>
        {tooHigh ? <span className="font-medium text-tone-danger-fg">Input tax cannot be more than what was paid.</span> : null}
      </div>
    </div>
  )
}
