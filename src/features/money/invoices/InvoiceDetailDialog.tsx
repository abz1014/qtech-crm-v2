import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useSession } from '@/app/session'
import { InvoicePdfButton } from '@/features/money/invoices/pdf/InvoicePdfButton'
import { Camera, Check, ExternalLink, History as HistoryIcon, Lock, Trash2 } from 'lucide-react'
import { z } from 'zod'
import { businessToday } from '@/lib/dates'
import { intakeFiles, DEFAULT_ACCEPT } from '@/lib/fileIntake'
import { formatDay } from '@/lib/formatDay'
import { MAX_AMOUNT } from '@/lib/formRules'
import { mapPgError } from '@/lib/pgErrors'
import { Banner } from '@/ui/Banner'
import { Button } from '@/ui/Button'
import { Checkbox } from '@/ui/form/Checkbox'
import { Dialog, DialogContent } from '@/ui/Dialog'
import { Money } from '@/ui/Money'
import { Skeleton } from '@/ui/Skeleton'
import { useToast } from '@/ui/useToast'
import { DateInput } from '@/ui/form/DateInput'
import { Form, FormField } from '@/ui/form/Form'
import { NumberInput } from '@/ui/form/NumberInput'
import { TextField } from '@/ui/form/TextField'
import { useSubmitForm } from '@/ui/form/useSubmitForm'
import { signReceipt, type InvoiceRow } from '@/features/money/invoices/api'
import { useDeleteInvoiceReceipt, useGstRegister, useInvoice, useInvoiceReceipts, useUpdateInvoice, useUploadInvoiceReceipt } from '@/features/money/invoices/hooks'
import { GST_FILED_WARNING, gstReturnMayBeFiled, monthHasFbrRecord, round2 } from '@/features/money/invoices/model'
import { useDeleteInvoiceFlow } from '@/features/money/invoices/InvoiceDelete'
import { LazyHistoryPanel } from '@/features/history/LazyHistoryPanel'
import { useClosedMonths } from '@/features/money/monthEnd/hooks'
import { CLOSED_MONTH_LINE } from '@/features/money/expenses/deleteFlow'
import { pkr } from '@/features/money/expenses/model'

/*
 * One invoice's steps (M01): the dates the register's tracks are built from, the TCS consignment number, the PSID, the receipt
 * (uploaded to gst-receipts) and a note. Nothing here is required; the monthly stamps on the register do the usual work and this
 * is where a single step is corrected or filled in ("Client received" is set here, when the customer confirms).
 * W11: the invoice number, date, net and GST are edited here too, in an open month (a closed month shows them as text and the
 * lock line: reopen it on Lock a month first; the database refuses a change there as well). A change, or a delete, of an invoice whose
 * GST return may already be filed (an FBR GST payment or PSID on that month, or past the 18th of the next month) warns with a tick
 * and goes on: never a block. Delete (admin) is permanent; History shows who changed what.
 */
const optionalDate = z.string()
const schema = z
  .object({
  number: z.string().trim().min(1, 'Enter the invoice number').max(40, 'Keep the number under 40 characters'),
  invoiceDate: z.string().min(1, 'Choose a date'),
  net: z.number({ invalid_type_error: 'Enter the net amount', required_error: 'Enter the net amount' }).positive('The net amount must be above zero').max(MAX_AMOUNT, 'That amount is too large. Check it for an extra digit'),
  gst: z.number({ invalid_type_error: 'Enter the GST, or 0', required_error: 'Enter the GST, or 0' }).min(0, 'GST cannot be below zero').max(MAX_AMOUNT, 'That GST is too large'),
  /** Set from what was changed: the GST return of the month may be filed, so the change needs the tick below. */
  ackNeeded: z.boolean(),
  ack: z.boolean(),
  copyReceivedOn: optionalDate,
  tcsSentOn: optionalDate,
  tcsNumber: z.string(),
  clientReceivedOn: optionalDate,
  psid: z.string(),
  receiptOn: optionalDate,
  depositedOn: optionalDate,
  depositAmount: z.number().min(0).nullable(),
  notes: z.string(),
  })
  .refine(v => !v.ackNeeded || v.ack, { path: ['ack'], message: 'Tick the box to go on' })
type Values = z.input<typeof schema>
type DateField = 'copyReceivedOn' | 'tcsSentOn' | 'clientReceivedOn' | 'receiptOn' | 'depositedOn'

export function InvoiceDetailDialog({ invoiceId, onClose }: { invoiceId: string; onClose: () => void }) {
  const q = useInvoice(invoiceId)
  const [busy, setBusy] = useState(false)
  return (
    <Dialog open onOpenChange={o => !o && !busy && onClose()} busy={busy}>
      <DialogContent title={q.data?.number ? `Invoice ${q.data.number}` : 'Invoice'} context={q.data?.invoice_date ? `Dated ${formatDay(q.data.invoice_date)}` : undefined} size="lg">
        {q.isError ? (
          <p role="alert" className="text-sm text-tone-danger-fg">The invoice could not be loaded. Close this and try again.</p>
        ) : q.isPending ? (
          <div className="grid gap-3" aria-busy="true">
            <Skeleton className="h-8" />
            <Skeleton className="h-24" />
          </div>
        ) : q.data ? (
          <DetailForm invoice={q.data} onBusy={setBusy} onClose={onClose} />
        ) : (
          <p className="text-sm text-fg-muted">This invoice is not here any more.</p>
        )}
      </DialogContent>
    </Dialog>
  )
}

const val = (s: string): string | null => (s.trim() === '' ? null : s)

function DetailForm({ invoice, onBusy, onClose }: { invoice: InvoiceRow; onBusy: (b: boolean) => void; onClose: () => void }) {
  const toast = useToast()
  const session = useSession()
  const isAdmin = session.status === 'signed-in' && session.user.role === 'admin'
  const update = useUpdateInvoice(invoice.id)
  const receipts = useInvoiceReceipts(invoice.id, invoice.psid)
  const upload = useUploadInvoiceReceipt(invoice.id, invoice.psid)
  const remove = useDeleteInvoiceReceipt(invoice.id)
  const fileRef = useRef<HTMLInputElement | null>(null)
  const [fileError, setFileError] = useState<string | null>(null)
  const net = Number(invoice.net_amount)
  const gst = Number(invoice.gst_amount)
  const today = businessToday()
  const closedQ = useClosedMonths()
  const monthClosed = !!invoice.invoice_date && (closedQ.data ?? []).some(c => c.key === invoice.invoice_date?.slice(0, 7))
  const registerQ = useGstRegister()
  const [historyOpen, setHistoryOpen] = useState(false)
  /** The GST return of a month may be in when an FBR payment or PSID is on it, or the 18th of the next month has gone by. */
  const mayBeFiled = (d: string | null | undefined) => gstReturnMayBeFiled(d, today, monthHasFbrRecord(registerQ.data ?? [], d))
  const deleteFlow = useDeleteInvoiceFlow(invoice, { gstMayBeFiled: mayBeFiled(invoice.invoice_date), onDeleted: onClose })

  const sf = useSubmitForm({
    schema,
    entity: 'invoice',
    defaultValues: {
      number: invoice.number ?? '',
      invoiceDate: invoice.invoice_date ?? '',
      net,
      gst,
      ackNeeded: false,
      ack: false,
      copyReceivedOn: invoice.copy_received_on ?? '',
      tcsSentOn: invoice.tcs_sent_on ?? '',
      tcsNumber: invoice.tcs_number ?? '',
      clientReceivedOn: invoice.client_received_on ?? '',
      psid: invoice.psid ?? '',
      receiptOn: invoice.wasif_receipt_on ?? '',
      depositedOn: invoice.tax_deposited_on ?? '',
      depositAmount: invoice.tax_deposit_amount === null ? null : Number(invoice.tax_deposit_amount),
      notes: invoice.notes ?? '',
    } satisfies Partial<Values>,
    // The month lock answers about the date, the unique index about the number: the sentence sits under that field.
    routeError: e => {
      if (e.kind === 'closed-month') return { field: 'invoiceDate' }
      if (e.kind === 'unique' && /invoices_number/.test(e.constraint ?? '')) return { field: 'number', message: 'This invoice number is already in the register. Use another.' }
      return undefined
    },
    onSubmit: async v => {
      onBusy(true)
      try {
        await update.mutateAsync({
          // only what changed is sent: the "whose is it" rule (0092) looks at these four columns and nothing else
          ...(!monthClosed && v.number.trim() !== (invoice.number ?? '') ? { number: v.number.trim() } : {}),
          ...(!monthClosed && v.invoiceDate !== (invoice.invoice_date ?? '') ? { invoice_date: v.invoiceDate } : {}),
          ...(!monthClosed && v.net !== net ? { net_amount: v.net } : {}),
          ...(!monthClosed && v.gst !== gst ? { gst_amount: v.gst } : {}),
          copy_received_on: val(v.copyReceivedOn),
          tcs_sent_on: val(v.tcsSentOn),
          tcs_number: val(v.tcsNumber),
          client_received_on: val(v.clientReceivedOn),
          psid: val(v.psid),
          wasif_receipt_on: val(v.receiptOn),
          tax_deposited_on: val(v.depositedOn),
          tax_deposit_amount: v.depositAmount,
          notes: val(v.notes),
        })
      } finally {
        onBusy(false)
      }
    },
    onSuccess: () => {
      toast.toast({ title: 'Saved invoice', body: invoice.number ?? undefined, tone: 'success' })
      onClose()
    },
  })

  const [wNumber, wDate, wNet, wGst] = sf.form.watch(['number', 'invoiceDate', 'net', 'gst'])
  const changedCore =
    !monthClosed && (wNumber.trim() !== (invoice.number ?? '') || wDate !== (invoice.invoice_date ?? '') || wNet !== net || wGst !== gst)
  const ackNeeded = changedCore && (mayBeFiled(invoice.invoice_date) || mayBeFiled(wDate))
  const ack = sf.form.watch('ack')
  const { setValue } = sf.form
  useEffect(() => {
    setValue('ackNeeded', ackNeeded)
    if (!ackNeeded) setValue('ack', false)
  }, [ackNeeded, setValue])

  const addFile = async (list: FileList | null) => {
    const f = list?.[0]
    if (!f) return
    setFileError(null)
    const [one] = await intakeFiles([f], { accept: DEFAULT_ACCEPT })
    if (one.error) {
      setFileError(one.error)
      return
    }
    try {
      await upload.mutateAsync({ file: one.file, today: businessToday() })
      sf.form.setValue('receiptOn', sf.form.getValues('receiptOn') || businessToday())
    } catch (err) {
      setFileError(mapPgError(err).message)
    }
  }
  const open = async (path: string) => {
    try {
      window.open(await signReceipt(path), '_blank', 'noopener')
    } catch (err) {
      setFileError(mapPgError(err).message)
    }
  }

  const date = (name: DateField, label: string) => (
    <FormField<Values, DateField> name={name} label={label} requirement="optional">
      {f => <DateInput name={f.name} ref={f.ref} onBlur={f.onBlur} value={f.value as string} onChange={f.onChange as (v: string) => void} defaultToday={false} />}
    </FormField>
  )

  return (
    <>
      {monthClosed ? (
      <dl className="grid grid-cols-3 gap-px overflow-hidden rounded-panel border bg-line text-sm">
        {[
          ['Net', net],
          ['GST', gst],
          ['Gross', net + gst],
        ].map(([k, v]) => (
          <div key={String(k)} className="grid gap-[2px] bg-surface px-4 py-3">
            <dt className="text-xs text-fg-muted">{k}</dt>
            <dd>
              <Money value={Number(v)} size="lg" />
            </dd>
          </div>
        ))}
      </dl>
      ) : null}
      <Form sf={sf} labels={{ number: 'Invoice number', invoiceDate: 'Invoice date', net: 'Net amount', gst: 'GST', ack: 'The GST return warning' }} className="grid gap-5">
        <button type="submit" hidden tabIndex={-1} />
        {monthClosed ? (
          <p className="flex items-center gap-2 text-base text-fg-2" data-testid="invoice-closed-line">
            <Lock className="size-5 shrink-0 text-fg-muted" aria-hidden="true" />
            {invoice.number ?? 'This invoice'} is in a closed month. {CLOSED_MONTH_LINE}
          </p>
        ) : (
          <fieldset className="grid gap-4 md:grid-cols-2" data-testid="invoice-edit">
            <legend className="mb-2 text-base font-semibold">Invoice</legend>
            <FormField<Values, 'number'> name="number" label="Invoice number">
              {f => <TextField {...f} autoComplete="off" className="num" />}
            </FormField>
            <FormField<Values, 'invoiceDate'> name="invoiceDate" label="Invoice date">
              {f => <DateInput {...f} defaultToday={false} />}
            </FormField>
            <FormField<Values, 'net'> name="net" label="Net amount, PKR">
              {f => <NumberInput {...f} inputMode="decimal" />}
            </FormField>
            <FormField<Values, 'gst'> name="gst" label="GST, PKR" help="18%, or 0 when exempt. The CRM does not work it out for you here.">
              {f => <NumberInput {...f} inputMode="decimal" />}
            </FormField>
            <p className="num text-base text-fg-2 md:col-span-2">
              Gross {pkr(round2((typeof wNet === 'number' ? wNet : 0) + (typeof wGst === 'number' ? wGst : 0)))}
            </p>
          </fieldset>
        )}
        {ackNeeded ? (
          <div role="group" aria-label="GST return warning" data-testid="gst-filed-warning" className="grid gap-2 rounded-row border border-tone-warning-fg/25 bg-tone-warning-bg px-4 py-3 text-base">
            <p className="font-medium">{GST_FILED_WARNING}</p>
            <Checkbox label="I understand" checked={ack} onCheckedChange={c => sf.form.setValue('ack', c === true, { shouldValidate: true })} />
            {sf.form.formState.errors.ack ? <p role="alert" className="text-tone-danger-fg">{sf.form.formState.errors.ack.message}</p> : null}
          </div>
        ) : null}
        <fieldset className="grid gap-4 md:grid-cols-2">
          <legend className="mb-2 text-sm font-semibold">Courier (TCS)</legend>
          {date('copyReceivedOn', 'Copy received')}
          {date('tcsSentOn', 'Invoice posted')}
          <FormField<Values, 'tcsNumber'> name="tcsNumber" label="Consignment number" requirement="optional">
            {f => <TextField {...f} autoComplete="off" className="num" />}
          </FormField>
          {date('clientReceivedOn', 'Client received')}
        </fieldset>
        <fieldset className="grid gap-4 md:grid-cols-2">
          <legend className="mb-2 text-sm font-semibold">FBR</legend>
          <FormField<Values, 'psid'> name="psid" label="PSID" requirement="optional">
            {f => <TextField {...f} autoComplete="off" spellCheck={false} className="num" />}
          </FormField>
          {date('receiptOn', 'Receipt received')}
          {date('depositedOn', 'GST paid to FBR')}
          <FormField<Values, 'depositAmount'> name="depositAmount" label="Deposit amount, PKR" requirement="optional" help="Defaults to the GST amount when you stamp the month.">
            {f => <NumberInput {...f} />}
          </FormField>
        </fieldset>
        <FormField<Values, 'notes'> name="notes" label="Notes" requirement="optional">
          {f => <TextField {...f} autoComplete="off" />}
        </FormField>
      </Form>

      <section aria-label="Receipts" className="grid gap-2">
        <div className="flex items-center gap-3">
          <h3 className="text-sm font-semibold">FBR receipt</h3>
          <Button size="sm" icon={Camera} onClick={() => fileRef.current?.click()}>
            Add receipt
          </Button>
          <input ref={fileRef} type="file" accept="image/*,application/pdf" tabIndex={-1} aria-label="Receipt file" className="sr-only" onChange={e => { void addFile(e.target.files); e.target.value = '' }} />
        </div>
        {fileError ? <Banner tone="danger" title="That file was not added">{fileError}</Banner> : null}
        {(receipts.data ?? []).length === 0 ? (
          <p className="text-xs text-fg-muted">
            No receipt uploaded yet. A photo or a PDF, up to 5 MB.
            {invoice.psid?.trim() ? ' One receipt covers every invoice with this PSID.' : ''}
          </p>
        ) : (
          <ul className="grid gap-1">
            {(receipts.data ?? []).map(r => (
              <li key={r.id} className="flex items-center justify-between gap-3 rounded-row border px-3 py-2 text-sm">
                <button type="button" onClick={() => void open(r.path)} className="inline-flex min-w-0 items-center gap-2 text-left font-medium text-primary hover:underline">
                  <ExternalLink className="size-4 shrink-0" aria-hidden="true" />
                  <span className="min-w-0 [overflow-wrap:anywhere] break-all">{r.fileName}</span>
                </button>
                {r.invoiceId !== invoice.id ? <span className="shrink-0 text-xs text-fg-muted">same PSID</span> : null}
                <Button size="sm" variant="quiet" aria-label={`Remove ${r.fileName}`} onClick={() => remove.mutate(r)}>
                  Remove
                </Button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <div className="-mx-5 -mb-5 mt-1 flex items-center justify-end gap-2 border-t bg-sunken px-5 py-3 max-md:flex-col-reverse max-md:items-stretch">
        {isAdmin && !monthClosed ? (
          <Button variant="secondary" size="lg" icon={Trash2} className="min-h-[44px] border-tone-danger-fg text-base text-tone-danger-fg" onClick={deleteFlow.ask} disabled={sf.pending}>
            Delete invoice
          </Button>
        ) : null}
        <Button variant="quiet" size="lg" icon={HistoryIcon} onClick={() => setHistoryOpen(true)} className="text-base">
          History
        </Button>
        {isAdmin && invoice.order_id ? (
          <Link to={`/orders/${invoice.order_id}#payments`} onClick={onClose} className="mr-auto text-sm font-medium text-primary underline-offset-2 hover:underline">
            Payments on the order
          </Link>
        ) : null}
        <InvoicePdfButton invoiceId={invoice.id} variant="secondary" />
        <Button variant="quiet" onClick={onClose} data-cancel>
          Close
        </Button>
        <Button variant="primary" type="submit" form={sf.formId} icon={Check} busy={sf.pending} busyLabel="Saving">
          {sf.failed ? 'Try again' : 'Save'}
        </Button>
      </div>
      {deleteFlow.node}
      {historyOpen ? (
        <LazyHistoryPanel
          open
          onOpenChange={o => !o && setHistoryOpen(false)}
          table="invoices"
          id={invoice.id}
          context={`${invoice.number ?? 'Invoice'}${invoice.invoice_date ? ` · ${formatDay(invoice.invoice_date)}` : ''}`}
          imported={invoice.legacy_source !== null}
        />
      ) : null}
    </>
  )
}
