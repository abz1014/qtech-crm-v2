import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useSession } from '@/app/session'
import { Ban, Banknote, Camera, Check, ClipboardList, Ellipsis, ExternalLink, FilePlus2, History as HistoryIcon, Lock, Pencil, Printer, Trash2 } from 'lucide-react'
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
import { FoldRow } from '@/ui/FoldRow'
import { MenuItem, Popover, PopoverContent, PopoverTrigger } from '@/ui/Popover'
import { lazyDialog } from '@/lib/lazyDialog'
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
import { useGstDeadlines } from '@/features/settings/hooks'
import { GST_FILED_WARNING, gstReturnMayBeFiled, monthHasFbrRecord, round2 } from '@/features/money/invoices/model'
import { useCreditNoteFlow, useDeleteInvoiceFlow, useVoidInvoiceFlow } from '@/features/money/invoices/InvoiceVoid'
import { useCreditNotes } from '@/features/money/invoices/creditNotes'
import { CreditNotePdfButton } from '@/features/money/invoices/pdf/CreditNotePdfButton'
import { LazyHistoryPanel } from '@/features/history/LazyHistoryPanel'
import { useClosedMonths, useMonthClosed } from '@/features/money/monthEnd/hooks'
import { CLOSED_MONTH_LINE } from '@/features/money/expenses/deleteFlow'
import { pkr } from '@/features/money/expenses/model'

/*
 * One invoice's steps (M01): the dates the register's tracks are built from, the TCS consignment number, the PSID, the receipt
 * (uploaded to gst-receipts) and a note. Nothing here is required; the monthly stamps on the register do the usual work and this
 * is where a single step is corrected or filled in ("Customer received" is set here, when the customer confirms).
 * W11: the invoice number, date, net and GST are edited here too, in an open month (a closed month shows them as text and the
 * lock line: reopen it on Lock a month first; the database refuses a change there as well). A change, or a delete, of an invoice whose
 * GST return may already be filed (an FBR GST payment or PSID on that month, or past the 18th of the next month) warns with a tick
 * and goes on: never a block. Delete (admin) is permanent; History shows who changed what.
 */
// Downloaded the first time it opens (perf/lcp, lazyDialog.tsx): Print invoice is a line of the More menu here.
const InvoicePdfDialog = lazyDialog(() => import('@/features/money/invoices/pdf/InvoicePdfDialog').then(m => m.InvoicePdfDialog))

const optionalDate = z.string()
const schema = z
  .object({
  number: z.string().trim().min(1, 'Enter the invoice number').max(40, 'Keep the number under 40 characters'),
  invoiceDate: z.string().min(1, 'Choose a date'),
  net: z.number({ error: 'Enter the net amount' }).positive('The net amount must be above zero').max(MAX_AMOUNT, 'That amount is too large. Check it for an extra digit'),
  gst: z.number({ error: 'Enter the GST, or 0' }).min(0, 'GST cannot be below zero').max(MAX_AMOUNT, 'That GST is too large'),
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
  .refine(v => !v.ackNeeded || v.ack, { path: ['ack'], message: 'Tick the box to continue' })
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
            <Skeleton className="h-[6rem]" />
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
  // Admins read the list of closed months; sales cannot (closed_months is admin-only), so they ask about this one month instead.
  const closedQ = useClosedMonths(isAdmin)
  const staffClosedQ = useMonthClosed(invoice.invoice_date, !isAdmin)
  const monthClosed =
    !!invoice.invoice_date && (isAdmin ? (closedQ.data ?? []).some(c => c.key === invoice.invoice_date?.slice(0, 7)) : staffClosedQ.data === true)
  const registerQ = useGstRegister()
  const [historyOpen, setHistoryOpen] = useState(false)
  const [printing, setPrinting] = useState(false)
  const navigate = useNavigate()
  const [detailsOpen, setDetailsOpen] = useState(false)
  /** The GST return of a month may be in when an FBR payment or PSID is on it, or the 18th of the next month has gone by. */
  const gstDl = useGstDeadlines()
  const mayBeFiled = (d: string | null | undefined) => gstReturnMayBeFiled(d, today, monthHasFbrRecord(registerQ.data ?? [], d), gstDl.deadlines)
  const deleteFlow = useDeleteInvoiceFlow(invoice, { gstMayBeFiled: mayBeFiled(invoice.invoice_date), onDeleted: onClose })
  const creditNoteFlow = useCreditNoteFlow(invoice)
  const voidFlow = useVoidInvoiceFlow(invoice, { monthClosed, onDone: onClose, onCreditNote: creditNoteFlow.ask })
  const creditNotes = useCreditNotes(invoice.id, invoice.number !== null)
  /** Filed with FBR (a PSID or a tax deposit), void, or in a closed month: the number, date, net and GST are fixed (0113). A credit note corrects them. */
  const filed = !!invoice.psid?.trim() || !!invoice.tax_deposited_on
  const voided = invoice.voided_at !== null
  const figuresLocked = monthClosed || filed || voided
  // A filed invoice opens as a summary: its numbers are fixed and what is left to change (courier, receipt, notes) is one Edit away.
  const [editing, setEditing] = useState(false)
  const summary = filed && !editing

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
      // 0128: clearing a PSID or a deposit date is the admin's; the sentence sits under the PSID
      if (e.hint === 'admin_only_unfile') return { field: invoice.psid?.trim() ? 'psid' : 'depositedOn' }
      return undefined
    },
    onSubmit: async v => {
      onBusy(true)
      try {
        await update.mutateAsync({
         // M1: the save lands only on the version this screen was opened with; someone else's change in between is not overwritten
         expectedUpdatedAt: invoice.updated_at,
         patch: {
          // only what changed is sent: the "whose is it" rule (0092) looks at these four columns and nothing else
          ...(!figuresLocked && v.number.trim() !== (invoice.number ?? '') ? { number: v.number.trim() } : {}),
          ...(!figuresLocked && v.invoiceDate !== (invoice.invoice_date ?? '') ? { invoice_date: v.invoiceDate } : {}),
          ...(!figuresLocked && v.net !== net ? { net_amount: v.net } : {}),
          ...(!figuresLocked && v.gst !== gst ? { gst_amount: v.gst } : {}),
          copy_received_on: val(v.copyReceivedOn),
          tcs_sent_on: val(v.tcsSentOn),
          tcs_number: val(v.tcsNumber),
          client_received_on: val(v.clientReceivedOn),
          psid: val(v.psid),
          wasif_receipt_on: val(v.receiptOn),
          tax_deposited_on: val(v.depositedOn),
          tax_deposit_amount: v.depositAmount,
          notes: val(v.notes),
         },
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
    !figuresLocked && (wNumber.trim() !== (invoice.number ?? '') || wDate !== (invoice.invoice_date ?? '') || wNet !== net || wGst !== gst)
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
    <FormField<Values, DateField> name={name} label={label}>
      {f => <DateInput name={f.name} ref={f.ref} onBlur={f.onBlur} value={f.value as string} onChange={f.onChange as (v: string) => void} defaultToday={false} />}
    </FormField>
  )

  const watched = sf.form.watch(['copyReceivedOn', 'tcsSentOn', 'clientReceivedOn', 'receiptOn', 'depositedOn', 'tcsNumber', 'psid', 'notes'])
  const dates = watched.slice(0, 5).filter(d => typeof d === 'string' && d !== '').length
  const detailsLine = [
    watched[5] ? `TCS ${watched[5]}` : null,
    watched[6] ? `PSID ${watched[6]}` : null,
    dates > 0 ? `${dates} ${dates === 1 ? 'date' : 'dates'}` : null,
    watched[7] ? '1 note' : 'no notes',
  ]
    .filter(Boolean)
    .join(' · ')

  /** The one menu of the footer: everything that is not the dialog's main button (Save, or Edit on a filed invoice). */
  const more = (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="quiet" size="lg" icon={Ellipsis} className="text-base">
          More
        </Button>
      </PopoverTrigger>
      <PopoverContent variant="menu" align="start">
        <MenuItem icon={HistoryIcon} onClick={() => setHistoryOpen(true)}>
          History
        </MenuItem>
        <MenuItem icon={Printer} onClick={() => setPrinting(true)}>
          Print invoice
        </MenuItem>
        {isAdmin && invoice.order_id ? (
          <MenuItem
            icon={Banknote}
            onClick={() => {
              onClose()
              navigate(`/orders/${invoice.order_id}#payments`)
            }}
          >
            Payments on the order
          </MenuItem>
        ) : null}
        {isAdmin && invoice.number !== null ? (
          <MenuItem icon={FilePlus2} onClick={creditNoteFlow.ask} disabled={sf.pending}>
            Create credit note
          </MenuItem>
        ) : null}
        {isAdmin && invoice.number !== null ? (
          <MenuItem icon={Ban} danger onClick={voidFlow.ask} disabled={sf.pending}>
            Void invoice
          </MenuItem>
        ) : null}
        {isAdmin && invoice.number === null && !monthClosed ? (
          <MenuItem icon={Trash2} danger onClick={deleteFlow.ask} disabled={sf.pending}>
            Delete invoice
          </MenuItem>
        ) : null}
      </PopoverContent>
    </Popover>
  )
  const overlays = (
    <>
      {deleteFlow.node}
      {voidFlow.node}
      {creditNoteFlow.node}
      {printing ? <InvoicePdfDialog open onOpenChange={o => !o && setPrinting(false)} invoiceId={invoice.id} /> : null}
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
  const row = 'flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 border-b py-2 type-body'
  const dash = <span className="text-fg-muted">Not yet</span>
  const day = (iso: string | null) => (iso ? <span className="num">{formatDay(iso)}</span> : dash)
  const fact = (k: string, v: React.ReactNode, testid?: string) => (
    <div className={row} key={k}>
      <dt className="text-fg-2">{k}</dt>
      <dd className="m-0 min-w-0 text-right [overflow-wrap:anywhere]" data-testid={testid}>
        {v}
      </dd>
    </div>
  )

  if (voided) {
    return (
      <>
        <div role="status" className="grid gap-1 rounded-row border border-tone-danger-fg/25 bg-tone-danger-bg px-4 py-3 text-base" data-testid="invoice-void-banner">
          <p className="font-semibold">Void: {invoice.number} is kept in the register but counts for nothing.</p>
          <p>
            {invoice.void_reason}
            {invoice.voided_at ? ` (${formatDay(invoice.voided_at.slice(0, 10))})` : ''}
          </p>
          <p className="num text-fg-2">
            It was {pkr(Number(invoice.voided_net ?? 0))} + GST {pkr(Number(invoice.voided_gst ?? 0))}.
          </p>
        </div>
        <div className="-mx-5 -mb-5 mt-1 flex items-center justify-end gap-2 border-t bg-sunken px-5 py-3">
          <Button variant="quiet" size="lg" icon={HistoryIcon} onClick={() => setHistoryOpen(true)} className="text-base">
            History
          </Button>
          <Button variant="primary" onClick={onClose} data-cancel>
            Close
          </Button>
        </div>
        {historyOpen ? (
          <LazyHistoryPanel open onOpenChange={o => !o && setHistoryOpen(false)} table="invoices" id={invoice.id} context={invoice.number ?? 'Invoice'} imported={invoice.legacy_source !== null} />
        ) : null}
      </>
    )
  }

  const lockLine = figuresLocked ? (
    <p className="flex items-center gap-2 py-2 text-base text-fg-2" data-testid="invoice-closed-line">
      <Lock className="size-5 shrink-0 text-fg-muted" aria-hidden="true" />
      {monthClosed ? (
        <>
          {invoice.number ?? 'This invoice'} is in a locked month. {isAdmin ? CLOSED_MONTH_LINE : 'An admin can reopen it.'}
        </>
      ) : (
        <span data-testid="invoice-filed-line">
          {invoice.number ?? 'This invoice'} has a PSID or a tax deposit recorded, so its number, date and amounts are fixed.{isAdmin ? ' To correct it, issue a credit note.' : ' An admin can issue a credit note to correct it.'}
        </span>
      )}
    </p>
  ) : null

  const receiptsAndNotes = (
    <>
      {(creditNotes.data ?? []).length > 0 ? (
        <section aria-label="Credit notes" className="grid" data-testid="invoice-credit-notes">
          <h3 className="py-2 type-row">Credit notes</h3>
          <ul className="m-0 list-none p-0">
            {(creditNotes.data ?? []).map(n => (
              <li key={n.id} className="flex items-center justify-between gap-3 border-b py-2 type-body">
                <span className="min-w-0">
                  <span className="num font-medium">{n.number}</span> · {formatDay(n.issuedOn)} · <span className="num">{pkr(n.net + n.gst)}</span> · {n.reason}
                </span>
                <CreditNotePdfButton creditNoteId={n.id} />
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section aria-label="Receipts" className="grid">
        <div className="flex items-center gap-3 border-b py-2">
          <h3 className="type-row">FBR receipt</h3>
          <Button size="sm" icon={Camera} className="ml-auto" onClick={() => fileRef.current?.click()}>
            Add receipt
          </Button>
          <input ref={fileRef} type="file" accept="image/*,application/pdf" tabIndex={-1} aria-label="Receipt file" className="sr-only" onChange={e => { void addFile(e.target.files); e.target.value = '' }} />
        </div>
        {fileError ? <Banner tone="danger" title="That file was not added">{fileError}</Banner> : null}
        {(receipts.data ?? []).length === 0 ? (
          <p className="border-b py-2 type-body text-fg-muted">
            No receipt uploaded yet. A photo or a PDF, up to 5 MB.
            {invoice.psid?.trim() ? ' One receipt covers every invoice with this PSID.' : ''}
          </p>
        ) : (
          <ul className="m-0 list-none p-0">
            {(receipts.data ?? []).map(r => (
              <li key={r.id} className="flex items-center justify-between gap-3 border-b py-2 type-body">
                <button type="button" onClick={() => void open(r.path)} className="inline-flex min-w-0 items-center gap-2 text-left font-medium text-primary hover:underline">
                  <ExternalLink className="size-4 shrink-0" aria-hidden="true" />
                  <span className="min-w-0 [overflow-wrap:anywhere] break-all">{r.fileName}</span>
                </button>
                {r.invoiceId !== invoice.id ? <span className="shrink-0 text-fg-muted">same PSID</span> : null}
                <Button size="sm" variant="quiet" aria-label={`Remove ${r.fileName}`} onClick={() => remove.mutate(r)}>
                  Remove
                </Button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  )

  // A filed invoice: a summary of what is on file, with Edit. Nothing is a field until Edit is tapped.
  if (summary) {
    const gross = net + gst
    return (
      <>
        <dl className="m-0" data-testid="invoice-summary">
          {fact('Invoice number', <span className="num">{invoice.number ?? 'No number'}</span>)}
          {fact('Invoice date', day(invoice.invoice_date))}
          {fact('Net', <Money value={net} />)}
          {fact('GST', <Money value={gst} />)}
          {fact('Gross', <Money value={gross} strong />)}
          {fact('PSID', invoice.psid?.trim() ? <span className="num">{invoice.psid}</span> : dash)}
          {fact('GST paid to FBR', invoice.tax_deposited_on ? <span className="num">{`${formatDay(invoice.tax_deposited_on)}${invoice.tax_deposit_amount !== null ? ` · ${pkr(Number(invoice.tax_deposit_amount))}` : ''}`}</span> : dash)}
          {fact('Receipt received', day(invoice.wasif_receipt_on))}
          {fact('Courier (TCS)', invoice.tcs_number || invoice.tcs_sent_on ? <span className="num">{[invoice.tcs_number, invoice.tcs_sent_on ? `posted ${formatDay(invoice.tcs_sent_on)}` : null].filter(Boolean).join(' · ')}</span> : dash)}
          {fact('Customer received', day(invoice.client_received_on))}
          {fact('Notes', invoice.notes ? invoice.notes : <span className="text-fg-muted">None</span>)}
        </dl>
        {lockLine}
        {receiptsAndNotes}
        <div className="-mx-5 -mb-5 mt-1 flex flex-wrap items-center justify-end gap-2 border-t bg-sunken px-5 py-3">
          {more}
          <Button variant="quiet" onClick={onClose} data-cancel>
            Close
          </Button>
          <Button variant="primary" icon={Pencil} onClick={() => setEditing(true)}>
            Edit
          </Button>
        </div>
        {overlays}
      </>
    )
  }

  return (
    <>
      {figuresLocked ? (
        <dl className="m-0">
          {fact('Net', <Money value={net} />)}
          {fact('GST', <Money value={gst} />)}
          {fact('Gross', <Money value={net + gst} strong />)}
        </dl>
      ) : null}
      <Form sf={sf} labels={{ number: 'Invoice number', invoiceDate: 'Invoice date', net: 'Net amount', gst: 'GST', ack: 'The GST return warning' }} className="grid gap-4">
        <button type="submit" hidden tabIndex={-1} />
        {figuresLocked ? (
          lockLine
        ) : (
          <fieldset className="grid min-w-0 gap-4 md:grid-cols-2" data-testid="invoice-edit">
            <legend className="mb-2 type-row">Invoice</legend>
            <FormField<Values, 'number'> name="number" label="Invoice number">
              {f => <TextField {...f} autoComplete="off" className="num" />}
            </FormField>
            <FormField<Values, 'invoiceDate'> name="invoiceDate" label="Invoice date">
              {f => <DateInput {...f} defaultToday={false} />}
            </FormField>
            <FormField<Values, 'net'> name="net" label="Net amount, PKR">
              {f => <NumberInput {...f} inputMode="decimal" />}
            </FormField>
            <FormField<Values, 'gst'> name="gst" label="GST, PKR" help="18%, or 0 when exempt. The CRM does not calculate it here.">
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
        {/* The courier, FBR and note fields: none is required, so they are one closed row whose line says what is in them. */}
        <FoldRow
          state={{ icon: ClipboardList, word: '' }}
          title="Courier, FBR and notes"
          summary={detailsLine}
          open={detailsOpen}
          onToggle={() => setDetailsOpen(o => !o)}
          controlsId="invoice-more-details"
          bodyLabel="Courier, FBR and notes"
        >
          <div className="grid gap-4">
            <fieldset className="grid min-w-0 gap-4 md:grid-cols-2">
              <legend className="mb-2 type-row">Courier (TCS)</legend>
              {date('copyReceivedOn', 'Copy received')}
              {date('tcsSentOn', 'Invoice posted')}
              <FormField<Values, 'tcsNumber'> name="tcsNumber" label="Consignment number">
                {f => <TextField {...f} autoComplete="off" className="num" />}
              </FormField>
              {date('clientReceivedOn', 'Customer received')}
            </fieldset>
            <fieldset className="grid min-w-0 gap-4 md:grid-cols-2">
              <legend className="mb-2 type-row">FBR</legend>
              <FormField<Values, 'psid'> name="psid" label="PSID" help={!isAdmin && invoice.psid?.trim() ? 'Change it if it was typed wrong. Only an admin can clear it.' : undefined}>
                {f => <TextField {...f} autoComplete="off" spellCheck={false} className="num" />}
              </FormField>
              {date('receiptOn', 'Receipt received')}
              {date('depositedOn', 'GST paid to FBR')}
              <FormField<Values, 'depositAmount'> name="depositAmount" label="Deposit amount, PKR" help="Defaults to the GST amount when the month is stamped.">
                {f => <NumberInput {...f} />}
              </FormField>
            </fieldset>
            <FormField<Values, 'notes'> name="notes" label="Notes">
              {f => <TextField {...f} autoComplete="off" />}
            </FormField>
          </div>
        </FoldRow>
      </Form>

      {receiptsAndNotes}

      <div className="-mx-5 -mb-5 mt-1 flex flex-wrap items-center justify-end gap-2 border-t bg-sunken px-5 py-3">
        {more}
        <Button variant="quiet" onClick={onClose} data-cancel>
          Close
        </Button>
        <Button variant="primary" type="submit" form={sf.formId} icon={Check} busy={sf.pending} busyLabel="Saving">
          {sf.failed ? 'Try again' : 'Save'}
        </Button>
      </div>
      {overlays}
    </>
  )
}
