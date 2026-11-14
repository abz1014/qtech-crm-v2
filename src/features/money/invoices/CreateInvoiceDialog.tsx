import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { FilePlus2, Plus } from 'lucide-react'
import { useCompanyProfile } from '@/features/settings/hooks'
import { effectiveTerms } from '@/features/settings/companyProfile'
import { z } from 'zod'
import { businessToday } from '@/lib/dates'
import { formatDay } from '@/lib/formatDay'
import { formatDateText } from '@/lib/dateInput'
import { MAX_AMOUNT, pkr } from '@/lib/formRules'
import { orderRef } from '@/lib/refs'
import { Banner } from '@/ui/Banner'
import { Button } from '@/ui/Button'
import { Dialog, DialogContent } from '@/ui/Dialog'
import { Icon } from '@/ui/Icon'
import { Money } from '@/ui/Money'
import { SegmentedControl } from '@/ui/SegmentedControl'
import { Skeleton } from '@/ui/Skeleton'
import { useToast } from '@/ui/useToast'
import { Combobox } from '@/ui/form/Combobox'
import { DateInput } from '@/ui/form/DateInput'
import { Form, FormField } from '@/ui/form/Form'
import { NumberInput } from '@/ui/form/NumberInput'
import { TextField } from '@/ui/form/TextField'
import { useSubmitForm } from '@/ui/form/useSubmitForm'
import type { NextNumber, OrderForInvoice } from '@/features/money/invoices/api'
import { useCreateInvoice, useInvoiceableOrders, useNextInvoiceNumber, useOrderForInvoice } from '@/features/money/invoices/hooks'
import { GST_OPTION_LABEL, gstForNet, gstIsShare, gstRowLabel, invoiceStart, invoiceDueOn, overInvoiced, round2, type GstOption, type InvoiceStart } from '@/features/money/invoices/model'
import { formatPaisa, toPaisa } from '@/lib/money'

/*
 * Create invoice (M01; g2-money "create invoice dialog"). Opened from an order (the order page, or a link) or from the register's
 * "Create invoice". The invoice number is the next one in the series and the date is today; net, GST (18% or exempt, never another
 * rate) and the due date come from the order's lines. So: open it (1), Create invoice (2), nothing typed.
 *
 *   /money/gst-register?new=1&order=<id>   opens it for that order
 */
interface CreateInvoiceDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** The order to invoice. Without it the dialog asks for one first. */
  orderId?: string
  onCreated?: (invoiceNumber: string) => void
}

export function CreateInvoiceDialog({ open, onOpenChange, orderId, onCreated }: CreateInvoiceDialogProps) {
  const [busy, setBusy] = useState(false)
  const [picked, setPicked] = useState<string | null>(orderId ?? null)
  useEffect(() => {
    if (open) setPicked(orderId ?? null)
  }, [open, orderId])
  return (
    <Dialog open={open} onOpenChange={onOpenChange} busy={busy}>
      {open ? (
        picked ? (
          <InvoiceLoader orderId={picked} onBusy={setBusy} onDone={n => { onOpenChange(false); onCreated?.(n) }} onCancel={() => onOpenChange(false)} />
        ) : (
          <OrderPicker onPick={setPicked} onCancel={() => onOpenChange(false)} />
        )
      ) : null}
    </Dialog>
  )
}

/** The one frame of every step of Create invoice (54-invoice-dialogs #create): the file tile, the order under the title, the footer band. */
function Frame({ context, footer, children }: { context?: ReactNode; footer?: ReactNode; children: ReactNode }) {
  return (
    <DialogContent title="Create invoice" icon={FilePlus2} size="md" context={context} footer={footer}>
      {children}
    </DialogContent>
  )
}

const cancelButton = (onCancel: () => void) => (
  <Button variant="quiet" onClick={onCancel} data-cancel>
    Cancel
  </Button>
)

function OrderPicker({ onPick, onCancel }: { onPick: (id: string) => void; onCancel: () => void }) {
  const orders = useInvoiceableOrders()
  return (
    <Frame footer={cancelButton(onCancel)}>
      <p>Choose the order this invoice is for. Its lines give the amounts.</p>
      <label className="grid gap-2 text-sm font-medium text-fg">
        Order
        <Combobox
          data-autofocus
          options={(orders.data ?? []).map(o => ({ value: o.id, label: o.ref, meta: o.company }))}
          value={null}
          loading={orders.isPending}
          placeholder="ORD-0038"
          onChange={v => v && onPick(v)}
        />
      </label>
      {orders.isError ? <Banner tone="danger" title="The orders could not be loaded">Close this and try again.</Banner> : null}
    </Frame>
  )
}

function InvoiceLoader(props: { orderId: string; onBusy: (b: boolean) => void; onDone: (n: string) => void; onCancel: () => void }) {
  const order = useOrderForInvoice(props.orderId)
  const next = useNextInvoiceNumber()
  if (order.isError || next.isError)
    return (
      <Frame footer={cancelButton(props.onCancel)}>
        <Banner tone="danger" title="The order could not be loaded">Close this and try again. Nothing was created.</Banner>
      </Frame>
    )
  if (order.isPending || next.isPending)
    return (
      // Shaped like the form: the two fields side by side, then the four figure lines.
      <Frame footer={cancelButton(props.onCancel)}>
        <div className="grid gap-5" aria-busy="true">
          <div className="grid gap-4 md:grid-cols-2">
            {[0, 1].map(i => (
              <div key={i} className="grid gap-2">
                <Skeleton className="h-4 w-[7rem]" />
                <Skeleton className="h-control" />
              </div>
            ))}
          </div>
          <div className="grid gap-3">
            {[0, 1, 2, 3].map(i => (
              <div key={i} className="flex items-center justify-between gap-4 border-b pb-3 last:border-b-0">
                <Skeleton className="h-4 w-16" />
                <Skeleton className="h-4 w-[7rem]" />
              </div>
            ))}
          </div>
        </div>
      </Frame>
    )
  if (!order.data)
    return (
      <Frame footer={cancelButton(props.onCancel)}>
        <Banner tone="danger" title="This order is not here any more">It may have been deleted. Close this and choose another.</Banner>
      </Frame>
    )
  return <InvoiceForm {...props} order={order.data} next={next.data} />
}

const baseSchema = z.object({
  number: z.string().trim().min(1, 'Enter the invoice number').max(40, 'Keep the number under 40 characters'),
  invoiceDate: z.string().min(1, 'Choose a date'),
  net: z.number({ error: 'Enter the net amount' }).positive('The net amount must be above zero').max(MAX_AMOUNT, 'That amount is too large. Check it for an extra digit'),
  gst: z.number().min(0, 'GST cannot be below zero').max(MAX_AMOUNT, 'That GST is too large'),
  option: z.enum(['18', 'exempt', 'mixed']),
})
type Values = z.input<typeof baseSchema>

/** HW-13: the net may not be more than is left to invoice on the order's lines (Rs 1 allowance, as v_order_state). */
function schemaFor(start: InvoiceStart, itemsNet: number) {
  return baseSchema.superRefine((v, ctx) => {
    const left = overInvoiced(v.net, start, itemsNet)
    if (left === null) return
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['net'],
      message:
        left > 0
          ? `Only PKR ${formatPaisa(toPaisa(left), 'always')} is left to invoice on this order. To invoice more, add the extra to the lines of the order first.`
          : 'Everything on this order is already invoiced. To invoice more, add the extra to the lines of the order first.',
    })
  })
}

function InvoiceForm({ order, next, onBusy, onDone, onCancel }: { order: OrderForInvoice; next: NextNumber; onBusy: (b: boolean) => void; onDone: (n: string) => void; onCancel: () => void }) {
  const toast = useToast()
  const create = useCreateInvoice()
  const start = invoiceStart(order.amounts)
  const schema = useMemo(() => schemaFor(start, order.amounts.itemsNet), [order]) // eslint-disable-line react-hooks/exhaustive-deps
  const [editing, setEditing] = useState(false)
  const numberRef = useRef<HTMLInputElement | null>(null)

  const sf = useSubmitForm({
    schema,
    entity: 'invoice',
    defaultValues: {
      number: next.nextNumber,
      invoiceDate: businessToday(),
      net: start.net > 0 ? start.net : (undefined as unknown as number),
      gst: start.gst,
      option: start.option,
    } satisfies Partial<Values>,
    routeError: e => {
      if (e.kind === 'closed-month') return { field: 'invoiceDate' }
      if (e.kind === 'unique' && /invoices_number/.test(e.constraint ?? '')) {
        return { field: 'number', message: 'This invoice number is already in the register. Use the next one.' }
      }
      return undefined
    },
    onSubmit: (v, { requestId }) =>
      create.mutateAsync({ id: requestId, orderId: order.id, number: v.number, invoiceDate: v.invoiceDate, net: v.net, gst: v.gst }),
    onSuccess: v => {
      toast.toast({ title: `Created invoice ${v.number}`, body: `${orderRef(order.number)} · ${pkr(round2(v.net + v.gst))}`, tone: 'success' })
      onDone(v.number)
    },
  })
  useEffect(() => onBusy(sf.pending), [sf.pending, onBusy])

  const { form } = sf
  const net = form.watch('net')
  const gst = form.watch('gst')
  const option = form.watch('option')
  const date = form.watch('invoiceDate')
  const gross = round2((typeof net === 'number' ? net : 0) + (gst ?? 0))
  const over = typeof net === 'number' ? overInvoiced(net, start, order.amounts.itemsNet) : null
  const profileQ = useCompanyProfile()
  const terms = effectiveTerms(order.amounts.paymentTermsDays, profileQ.data?.default_payment_terms_days)
  const due = invoiceDueOn(date, terms.days)

  const setNet = (v: number | null) => {
    form.setValue('net', v as number, { shouldDirty: true })
    form.setValue('gst', gstForNet(v ?? 0, option, start), { shouldDirty: true })
  }
  const setOption = (o: GstOption) => {
    form.setValue('option', o, { shouldDirty: true })
    form.setValue('gst', gstForNet(typeof net === 'number' ? net : 0, o, start), { shouldDirty: true })
  }

  const lines = order.amounts.lineCount
  const context = `${orderRef(order.number)} · ${order.companyName}${start.wholeOrder ? ` · all ${lines} ${lines === 1 ? 'line' : 'lines'}` : ' · what is left to invoice'}`

  return (
    <Frame
      context={<span className="num">{context}</span>}
      footer={
        <>
          {cancelButton(onCancel)}
          <Button variant="primary" type="submit" form={sf.formId} icon={FilePlus2} busy={sf.pending} busyLabel="Creating">
            {sf.failed ? 'Try again' : 'Create invoice'}
          </Button>
        </>
      }
    >
      <Form sf={sf} labels={{ number: 'Invoice number', invoiceDate: 'Invoice date', net: 'Net amount', gst: 'GST', option: 'GST rate' }} className="grid gap-4">
        <button type="submit" hidden tabIndex={-1} />
        {order.cancelled ? <Banner tone="warning" title="This order is cancelled">An invoice can still be created, for example to record what was already supplied.</Banner> : null}
        {start.fullyInvoiced ? (
          <Banner tone="info" title="Every line of this order is already invoiced">
            To invoice more, add the extra to the lines of the order first. An invoice cannot carry more than the lines.
          </Banner>
        ) : null}
        <div className="grid gap-4 md:grid-cols-2">
          <FormField<Values, 'number'>
            name="number"
            label="Invoice number"
            source={next.lastNumber ? { label: `Next after ${next.lastNumber}${next.lastDate ? `, ${formatDay(next.lastDate).replace(/^\w+ /, '')}` : ''}` } : { label: 'First in the series' }}
          >
            {f => (
              <TextField
                {...f}
                ref={r => {
                  f.ref(r)
                  numberRef.current = r
                }}
                className="num text-right"
                autoComplete="off"
              />
            )}
          </FormField>
          <FormField<Values, 'invoiceDate'> name="invoiceDate" label="Invoice date" source={{ label: 'Today', plain: true }}>
            {f => <DateInput {...f} />}
          </FormField>
        </div>

        <dl className="grid">
          <Line label="Net">
            <Money value={typeof net === 'number' ? net : 0} />
          </Line>
          <Line label={gstRowLabel(option)}>
            <Money value={gst ?? 0} />
          </Line>
          <Line label="Gross" strong>
            <Money value={gross} strong />
          </Line>
          <Line label="Due" last={!editing}>
            {due ? (
              <span className="num text-fg">
                {formatDateText(due)} <span className="text-sm text-fg-2">· {terms.days} days from {order.amounts.earliestInvoiceDate && order.amounts.earliestInvoiceDate < date ? 'the first invoice' : 'invoice'}{terms.isDefault ? ' (default terms)' : ''}</span>
              </span>
            ) : (
              <span className="text-sm text-fg-muted">No payment terms on the order</span>
            )}
          </Line>
        </dl>

        {editing ? (
          <div className="grid gap-4 rounded-card border bg-canvas p-4 motion-safe:animate-fade-in">
            <FormField<Values, 'net'> name="net" label="Net amount, PKR" help="Change it to invoice part of the order.">
              {f => <NumberInput {...f} onChange={setNet} />}
            </FormField>
            {over !== null ? (
              <p className="text-sm font-medium text-tone-danger-fg" data-testid="over-invoice">
                This is PKR {formatPaisa(toPaisa(round2((net as number) - over)), 'always')} more than is left to invoice on this order
                (PKR {formatPaisa(toPaisa(over), 'always')}). Create invoice will refuse it.
              </p>
            ) : null}
            {gstIsShare(typeof net === 'number' ? net : 0, option, start) ? (
              <p className="text-sm text-tone-warning-fg">
                This amount is not a set of whole lines, so its GST is a share of the GST left. To print this invoice, tick
                its lines. Invoicing whole lines keeps the GST exact.
              </p>
            ) : null}
            <div className="grid gap-2">
              <span className="text-sm font-medium text-fg">GST</span>
              <SegmentedControl
                aria-label="GST"
                value={option === 'mixed' ? '' : option}
                onValueChange={v => setOption(v as GstOption)}
                options={(Object.keys(GST_OPTION_LABEL) as GstOption[]).map(o => ({ value: o, label: GST_OPTION_LABEL[o] }))}
              />
            </div>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="inline-flex min-h-control w-fit items-center gap-2 justify-self-center rounded-control px-2 text-sm font-medium text-primary underline-offset-4 transition-colors duration-fast hover:bg-sunken hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-green"
          >
            <Icon icon={Plus} size="sm" />
            Edit the amounts, optional
          </button>
        )}
      </Form>
    </Frame>
  )
}

function Line({ label, children, strong, last }: { label: string; children: ReactNode; strong?: boolean; last?: boolean }) {
  return (
    <div className={`flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 py-3 ${last ? '' : 'border-b'}`}>
      <dt className={strong ? 'font-semibold text-fg' : 'text-fg-2'}>{label}</dt>
      <dd className="ml-auto text-right text-fg">{children}</dd>
    </div>
  )
}
