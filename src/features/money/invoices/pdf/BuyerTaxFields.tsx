import { useState, type FormEvent } from 'react'
import { Check } from 'lucide-react'
import { mapPgError } from '@/lib/pgErrors'
import { Banner } from '@/ui/Banner'
import { Button } from '@/ui/Button'
import { Skeleton } from '@/ui/Skeleton'
import { useToast } from '@/ui/useToast'
import { Field } from '@/ui/form/Field'
import { Radio, RadioGroup } from '@/ui/form/Radio'
import { TextArea, TextField } from '@/ui/form/TextField'
import type { BuyerTax } from '@/features/money/invoices/pdf/model'
import { NTN_HELP, STRN_HELP, toValues, validateBuyerTax, type BuyerTaxErrors, type BuyerTaxValues, type Registered } from '@/features/money/invoices/pdf/buyerTax'
import { useBuyerTax, useSaveBuyerTax } from '@/features/money/invoices/pdf/hooks'

/*
 * A company's tax details as a buyer (migration 0072): registered for sales tax or not, NTN or CNIC, STRN, and the address
 * printed on its invoices. Self-contained: give it the company id and it reads, validates and saves on its own, so a company
 * screen adopts it as one line (`<BuyerTaxFields companyId={company.id} />`), and the invoice PDF dialog shows it in place when
 * something the invoice needs is missing. Every active role may change these, as with the company name.
 */
export function BuyerTaxFields({ companyId, onSaved, onCancel }: { companyId: string; onSaved?: () => void; onCancel?: () => void }) {
  const q = useBuyerTax(companyId)
  if (q.isError) return <p role="alert" className="text-sm text-tone-danger-fg">The company’s tax details could not be loaded. Close this and try again.</p>
  if (q.isPending)
    return (
      <div className="grid gap-3" aria-busy="true">
        <Skeleton className="h-8" />
        <Skeleton className="h-16" />
      </div>
    )
  if (!q.data) return <p className="text-sm text-fg-muted">This company is not here any more.</p>
  return <BuyerTaxForm key={q.dataUpdatedAt} companyId={companyId} buyer={q.data} onSaved={onSaved} onCancel={onCancel} />
}

function BuyerTaxForm({ companyId, buyer, onSaved, onCancel }: { companyId: string; buyer: BuyerTax; onSaved?: () => void; onCancel?: () => void }) {
  const { toast } = useToast()
  const save = useSaveBuyerTax(companyId)
  const [values, setValues] = useState<BuyerTaxValues>(() => toValues(buyer))
  const [errors, setErrors] = useState<BuyerTaxErrors>({})
  const [failed, setFailed] = useState<string | null>(null)
  const set = <K extends keyof BuyerTaxValues>(k: K, v: BuyerTaxValues[K]) => {
    setValues(prev => ({ ...prev, [k]: v }))
    setErrors(prev => ({ ...prev, [k]: undefined }))
  }

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    e.stopPropagation()
    const checked = validateBuyerTax(values)
    if (!checked.ok) {
      setErrors(checked.errors)
      return
    }
    setFailed(null)
    try {
      await save.mutateAsync(checked.patch)
      toast({ title: 'Saved tax details', body: buyer.name, tone: 'success' })
      onSaved?.()
    } catch (err) {
      setFailed(mapPgError(err, { entity: 'company' }).message)
    }
  }

  return (
    <form onSubmit={e => void submit(e)} className="grid gap-4" aria-label={`Tax details of ${buyer.name}`} noValidate>
      <fieldset className="grid gap-2">
        <legend className="mb-2 text-sm font-medium">Sales tax</legend>
        <RadioGroup value={values.registered} onValueChange={v => set('registered', v as Registered)} className="grid gap-2 sm:grid-flow-col sm:justify-start sm:gap-6">
          <Radio value="yes" label="Registered (has an STRN)" />
          <Radio value="no" label="Not registered" />
        </RadioGroup>
      </fieldset>
      <div className="grid gap-4 md:grid-cols-2">
        <Field label="NTN or CNIC" requirement="optional" help={NTN_HELP} error={errors.ntn}>
          <TextField value={values.ntn} onChange={e => set('ntn', e.target.value)} autoComplete="off" spellCheck={false} inputMode="numeric" className="num" />
        </Field>
        {values.registered === 'yes' ? (
          <Field label="STRN" requirement="required" help={STRN_HELP} error={errors.strn}>
            <TextField value={values.strn} onChange={e => set('strn', e.target.value)} autoComplete="off" spellCheck={false} inputMode="numeric" className="num" />
          </Field>
        ) : null}
      </div>
      <Field label="Address on invoices" requirement="optional" help="Leave it empty to print the order’s delivery address." error={errors.invoiceAddress}>
        <TextArea value={values.invoiceAddress} onChange={e => set('invoiceAddress', e.target.value)} rows={2} />
      </Field>
      {failed ? <Banner tone="danger" title="The tax details were not saved">{failed}</Banner> : null}
      <div className="flex flex-wrap justify-end gap-2">
        {onCancel ? (
          <Button variant="quiet" onClick={onCancel}>
            Cancel
          </Button>
        ) : null}
        <Button type="submit" icon={Check} busy={save.isPending} busyLabel="Saving">
          Save tax details
        </Button>
      </div>
    </form>
  )
}
