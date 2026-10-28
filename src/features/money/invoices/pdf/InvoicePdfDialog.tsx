import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Download, ExternalLink, FileText, Share2 } from 'lucide-react'
import { formatDay } from '@/lib/formatDay'
import { formatPaisa, toPaisa } from '@/lib/money'
import { orderRef } from '@/lib/refs'
import { Banner } from '@/ui/Banner'
import { Button } from '@/ui/Button'
import { Dialog, DialogContent } from '@/ui/Dialog'
import { Skeleton } from '@/ui/Skeleton'
import { Checkbox } from '@/ui/form/Checkbox'
import { NumberInput } from '@/ui/form/NumberInput'
import { Radio, RadioGroup } from '@/ui/form/Radio'
import { useCompanyProfile } from '@/features/settings/hooks'
import { BuyerTaxFields } from '@/features/money/invoices/pdf/BuyerTaxFields'
import { buildInvoiceDoc, type InvoicePdfSource } from '@/features/money/invoices/pdf/doc'
import { canShareFiles, useInvoicePdfActions, useInvoicePdfSource, useOrderInvoices } from '@/features/money/invoices/pdf/hooks'
import {
  COPY_LABEL,
  gapSentence,
  matchLines,
  qtyText,
  type FiguresProblem,
  type InvoiceCopy,
  type LinePick,
  type LineMatch,
} from '@/features/money/invoices/pdf/model'

/*
 * Print the sales-tax invoice (owner decision 2026-10-20, item 2). Opened from an invoice (its id) or from an order (the order's
 * invoices; one is picked when there are several). It reads the invoice, the order's lines, the buyer and the company profile,
 * and makes the PDF in the browser: "Open PDF" shows it, "Share" hands it to the phone's share sheet (a download on a computer).
 * Nothing is stored and nothing is sent.
 *
 * Never a broken PDF: while something section 23 needs is missing, the buttons wait and the dialog lists what to fill in (the
 * buyer's tax details right here, the company's in Settings), and while the lines do not add up to the invoice it says by how much.
 */
export function InvoicePdfDialog({ open, onOpenChange, invoiceId, orderId }: { open: boolean; onOpenChange: (open: boolean) => void; invoiceId?: string; orderId?: string }) {
  const [busy, setBusy] = useState(false)
  return (
    <Dialog open={open} onOpenChange={o => !busy && onOpenChange(o)} busy={busy}>
      <DialogContent title="Sales tax invoice" icon={FileText} size="lg">
        {open ? (
          invoiceId ? (
            <PdfBody invoiceId={invoiceId} onBusy={setBusy} onClose={() => onOpenChange(false)} />
          ) : orderId ? (
            <OrderInvoices orderId={orderId} onBusy={setBusy} onClose={() => onOpenChange(false)} />
          ) : null
        ) : null}
      </DialogContent>
    </Dialog>
  )
}

function Loading() {
  return (
    <div className="grid gap-3" aria-busy="true">
      <Skeleton className="h-8" />
      <Skeleton className="h-[6rem]" />
    </div>
  )
}

/** From an order: its invoices, the latest chosen; the rest of the dialog is the chosen invoice's. */
function OrderInvoices({ orderId, onBusy, onClose }: { orderId: string; onBusy: (b: boolean) => void; onClose: () => void }) {
  const q = useOrderInvoices(orderId)
  const [picked, setPicked] = useState<string | null>(null)
  if (q.isError) return <p role="alert" className="text-sm text-tone-danger-fg">The order’s invoices could not be loaded. Close this and try again.</p>
  if (q.isPending) return <Loading />
  const rows = q.data
  if (rows.length === 0) return <p className="text-sm text-fg-2">This order has no invoice yet. Create the invoice first, then print it here.</p>
  const chosen = picked ?? rows[rows.length - 1].id
  return (
    <div className="grid gap-5">
      {rows.length > 1 ? (
        <fieldset className="grid gap-2">
          <legend className="mb-2 text-sm font-medium">Which invoice</legend>
          <RadioGroup value={chosen} onValueChange={setPicked} className="grid gap-2">
            {rows.map(r => (
              <Radio key={r.id} value={r.id} label={<span className="num">{r.number ?? 'No number'}</span>} help={r.invoiceDate ? formatDay(r.invoiceDate) : undefined} />
            ))}
          </RadioGroup>
        </fieldset>
      ) : null}
      <PdfBody key={chosen} invoiceId={chosen} onBusy={onBusy} onClose={onClose} />
    </div>
  )
}

const pkr = (p: bigint) => `PKR ${formatPaisa(p, 'always')}`

function PdfBody({ invoiceId, onBusy, onClose }: { invoiceId: string; onBusy: (b: boolean) => void; onClose: () => void }) {
  const src = useInvoicePdfSource(invoiceId)
  const profile = useCompanyProfile()
  if (src.isError || profile.isError) return <p role="alert" className="text-sm text-tone-danger-fg">The invoice could not be loaded. Close this and try again.</p>
  if (src.isPending || profile.isPending) return <Loading />
  if (!src.data) return <p className="text-sm text-fg-muted">This invoice is not here any more.</p>
  return <Ready src={src.data} profileData={profile.data} onBusy={onBusy} onClose={onClose} onRefresh={() => void src.refetch()} />
}

function Ready({
  src,
  profileData,
  onBusy,
  onClose,
  onRefresh,
}: {
  src: InvoicePdfSource
  profileData: ReturnType<typeof useCompanyProfile>['data']
  onBusy: (b: boolean) => void
  onClose: () => void
  onRefresh: () => void
}) {
  const match = useMemo(() => matchLines(src.lines, src.invoice.net), [src.lines, src.invoice.net])
  const [picks, setPicks] = useState<LinePick[] | null>(null)
  const [choosing, setChoosing] = useState(false)
  const [copy, setCopy] = useState<InvoiceCopy>('original')
  const [editBuyer, setEditBuyer] = useState(false)
  const actions = useInvoicePdfActions()
  const share = canShareFiles()

  const current = picks ?? match.picks
  const built = buildInvoiceDoc(src, profileData, current, copy)
  const gaps = built.readiness.gaps
  const sellerGaps = gaps.filter(g => g.where === 'company-profile')
  const buyerGaps = gaps.filter(g => g.where === 'buyer')
  const otherGaps = gaps.filter(g => g.where === 'invoice' || g.where === 'order')
  const showPicker = choosing || picks !== null || match.how === 'ambiguous' || match.how === 'none'
  const ord = src.order ? orderRef(src.order.number) : null

  const run = async (what: 'open' | 'share') => {
    if (!built.ok || !profileData) return
    onBusy(true)
    try {
      await (what === 'open' ? actions.open(built.doc, profileData) : actions.share(built.doc, profileData))
    } finally {
      onBusy(false)
    }
  }

  return (
    <>
      <div className="grid gap-5">
        <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-panel border bg-line text-sm md:grid-cols-4">
          {[
            ['Invoice', <span key="n" className="num font-medium">{src.invoice.number ?? 'No number'}</span>],
            ['Date', src.invoice.invoiceDate ? formatDay(src.invoice.invoiceDate) : 'No date'],
            ['Net', <span key="net" className="num">{pkr(toPaisa(src.invoice.net))}</span>],
            ['GST', <span key="gst" className="num">{pkr(toPaisa(src.invoice.gst))}</span>],
          ].map(([k, v]) => (
            <div key={String(k)} className="grid gap-[2px] bg-surface px-4 py-3">
              <dt className="text-xs text-fg-muted">{k}</dt>
              <dd>{v}</dd>
            </div>
          ))}
        </dl>

        {gaps.length > 0 ? (
          <Banner tone="danger" title="Fill these in before the invoice can be printed">
            {gapSentence(gaps)}.
          </Banner>
        ) : null}
        {sellerGaps.length > 0 ? (
          <p className="text-sm text-fg-2">
            Your company’s details print in the letterhead. An admin fills them in once, in Settings, Company.{' '}
            <Link to="/settings/company" className="font-medium text-fg underline underline-offset-2 hover:text-fg-2">
              Open Settings, Company
            </Link>
          </p>
        ) : null}
        {otherGaps.length > 0 && src.order ? (
          <p className="text-sm text-fg-2">
            <Link to={`/orders/${src.order.id}`} className="font-medium text-fg underline underline-offset-2 hover:text-fg-2">
              Open {ord}
            </Link>
          </p>
        ) : null}

        {src.buyer ? (
          <section aria-label="Buyer" className="grid gap-3 rounded-panel border p-4">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h3 className="text-sm font-semibold">Buyer: {src.buyer.name}</h3>
              {buyerGaps.length === 0 && !editBuyer ? (
                <Button size="sm" variant="quiet" onClick={() => setEditBuyer(true)}>
                  Change tax details
                </Button>
              ) : null}
            </div>
            {buyerGaps.length > 0 || editBuyer ? (
              <BuyerTaxFields
                companyId={src.buyer.id}
                onSaved={() => {
                  setEditBuyer(false)
                  onRefresh()
                }}
                onCancel={editBuyer ? () => setEditBuyer(false) : undefined}
              />
            ) : (
              <BuyerSummary src={src} />
            )}
            {built.readiness.warnings.map(w => (
              <p key={w} className="text-sm text-fg-2">
                {w}
              </p>
            ))}
          </section>
        ) : null}

        {src.order ? (
          <section aria-label="Lines on this invoice" className="grid gap-3">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h3 className="text-sm font-semibold">Lines on this invoice</h3>
              {!showPicker ? (
                <Button size="sm" variant="quiet" onClick={() => setChoosing(true)}>
                  Change lines
                </Button>
              ) : null}
            </div>
            <LinesNote match={match} picks={picks} src={src} orderLabel={ord ?? 'the order'} />
            {showPicker ? <LinePicker src={src} picks={current} onChange={setPicks} /> : null}
            {built.ok ? null : built.problem ? <ProblemNote problem={built.problem} src={src} /> : null}
            {built.ok && built.doc.figures.adjustedLines.length > 0 ? (
              <p className="text-sm text-fg-2" data-testid="gst-adjust-note">
                Sales tax is rounded to whole rupees on each line. To add up to this invoice’s GST of {pkr(built.doc.figures.gst)} (the register figure), line
                {built.doc.figures.adjustedLines.length === 1 ? ' ' : 's '}
                {built.doc.figures.adjustedLines.join(', ')} {built.doc.figures.adjustedLines.length === 1 ? 'carries' : 'carry'} Rs 1{' '}
                {built.doc.figures.adjustment > 0n ? 'more' : 'less'} than {built.doc.figures.adjustedLines.length === 1 ? 'its' : 'their'} own rounding.
              </p>
            ) : null}
          </section>
        ) : null}

        <fieldset className="grid gap-2">
          <legend className="mb-2 text-sm font-medium">Copy</legend>
          <RadioGroup value={copy} onValueChange={v => setCopy(v as InvoiceCopy)} className="grid gap-2 sm:grid-flow-col sm:justify-start sm:gap-6">
            <Radio value="original" label={COPY_LABEL.original} />
            <Radio value="duplicate" label={COPY_LABEL.duplicate} />
          </RadioGroup>
        </fieldset>
      </div>

      <div className="-mx-5 -mb-5 mt-1 flex items-center justify-end gap-2 border-t bg-sunken px-5 py-3 max-md:flex-col-reverse max-md:items-stretch">
        <Button variant="quiet" onClick={onClose} data-cancel>
          Close
        </Button>
        <Button icon={ExternalLink} onClick={() => void run('open')} disabled={!built.ok || actions.busy !== null} busy={actions.busy === 'open'} busyLabel="Making the PDF">
          Open PDF
        </Button>
        <Button variant="primary" icon={share ? Share2 : Download} onClick={() => void run('share')} disabled={!built.ok || actions.busy !== null} busy={actions.busy === 'share'} busyLabel="Making the PDF">
          {share ? 'Share' : 'Download'}
        </Button>
      </div>
    </>
  )
}

function BuyerSummary({ src }: { src: InvoicePdfSource }) {
  const b = src.buyer
  if (!b) return null
  const address = b.invoiceAddress?.trim() || src.site?.address?.trim() || null
  const registered = b.salesTaxRegistered ?? (b.strn ? true : null)
  return (
    <dl className="grid gap-1 text-sm sm:grid-cols-[140px_minmax(0,1fr)]">
      <dt className="text-fg-muted">Address</dt>
      <dd>
        {address ?? '—'}
        {!b.invoiceAddress?.trim() && address ? <span className="text-fg-muted"> (delivery site)</span> : null}
      </dd>
      <dt className="text-fg-muted">NTN or CNIC</dt>
      <dd className="num">{b.ntn ?? '—'}</dd>
      <dt className="text-fg-muted">Sales tax</dt>
      <dd>{registered ? <span className="num">STRN {b.strn}</span> : 'Not registered'}</dd>
    </dl>
  )
}

function LinesNote({ match, picks, src, orderLabel }: { match: LineMatch; picks: LinePick[] | null; src: InvoicePdfSource; orderLabel: string }) {
  const others = src.otherInvoices.length
  const otherText = others > 0 ? ` ${orderLabel} has ${others} other ${others === 1 ? 'invoice' : 'invoices'} (${src.otherInvoices.map(o => o.number ?? 'no number').join(', ')}).` : ''
  if (src.lines.length === 0) return <p className="text-sm text-fg-2">{orderLabel} has no lines to print.</p>
  if (picks !== null) return <p className="text-sm text-fg-2">Tick the lines this invoice covers, with the quantity it covers.{otherText}</p>
  switch (match.how) {
    case 'whole-order':
      return <p className="text-sm text-fg-2">All {src.lines.length === 1 ? 'the one line' : `${src.lines.length} lines`} of {orderLabel}: they add up to this invoice.{otherText}</p>
    case 'matched': {
      const nos = src.lines.map((l, i) => (match.picks.some(p => p.id === l.id) ? i + 1 : null)).filter((n): n is number => n !== null)
      return (
        <p className="text-sm text-fg-2">
          Line{nos.length === 1 ? '' : 's'} {nos.join(', ')} of {orderLabel}: the only lines that add up to this invoice’s net.{otherText}
        </p>
      )
    }
    case 'ambiguous':
      return <p className="text-sm text-fg-2">More than one set of {orderLabel}’s lines adds up to this invoice. Tick the lines it covers.{otherText}</p>
    case 'none':
      return (
        <p className="text-sm text-fg-2">
          This invoice is not the sum of whole lines of {orderLabel}. Tick the lines it covers, with the quantity it covers (a part delivery).{otherText}
        </p>
      )
  }
}

function ProblemNote({ problem, src }: { problem: FiguresProblem; src: InvoicePdfSource }) {
  switch (problem.kind) {
    case 'no-lines':
      return src.lines.length > 0 ? <Banner tone="warning" title="Tick at least one line" /> : null
    case 'bad-qty': {
      const line = src.lines.find(l => l.id === problem.lineId)
      return (
        <Banner tone="warning" title="Check a quantity">
          Line “{line?.description.split(/\r?\n/)[0] ?? ''}” can take a quantity above 0 and up to {qtyText(problem.max)}.
        </Banner>
      )
    }
    case 'net-differs': {
      const diff = problem.invoiceNet - problem.linesNet
      return (
        <Banner tone="warning" title="The ticked lines do not add up to this invoice">
          They come to {pkr(problem.linesNet)} before tax; the invoice is {pkr(problem.invoiceNet)}, {pkr(diff < 0n ? -diff : diff)} {diff < 0n ? 'less' : 'more'}. The
          invoice’s amounts are fixed in the GST register, so tick the lines and quantities it covers.
        </Banner>
      )
    }
    case 'gst-differs':
      return (
        <Banner tone="danger" title="The sales tax does not match the invoice">
          The lines’ own sales tax comes to {pkr(problem.linesGst)}; the invoice’s GST is {pkr(problem.invoiceGst)}. That is more than rounding (at most Rs 1 on each of the{' '}
          {problem.taxableLines} taxed {problem.taxableLines === 1 ? 'line' : 'lines'}), so the PDF is not made. Check the lines ticked, or the GST rate on the order’s lines.
        </Banner>
      )
  }
}

function LinePicker({ src, picks, onChange }: { src: InvoicePdfSource; picks: readonly LinePick[]; onChange: (p: LinePick[]) => void }) {
  const byId = new Map(picks.map(p => [p.id, p]))
  const toggle = (id: string, on: boolean, fullQty: LinePick['qty']) => {
    const next = src.lines.filter(l => (l.id === id ? on : byId.has(l.id))).map(l => (l.id === id ? { id, qty: fullQty } : (byId.get(l.id) as LinePick)))
    onChange(next)
  }
  const setQty = (id: string, qty: number | null) => onChange(picks.map(p => (p.id === id ? { id, qty: qty ?? 0 } : p)))
  return (
    <ul className="grid gap-2" aria-label="Order lines">
      {src.lines.map((l, i) => {
        const pick = byId.get(l.id)
        const title = l.description.split(/\r?\n/)[0]
        return (
          <li key={l.id} className="grid gap-2 rounded-row border px-3 py-2 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
            <Checkbox
              checked={Boolean(pick)}
              onCheckedChange={v => toggle(l.id, v === true, l.qty)}
              label={
                <span>
                  <span className="num text-fg-muted">{i + 1}.</span> {title}
                </span>
              }
              help={`${qtyText(Number(l.qty))}${l.unit ? ` ${l.unit}` : ''} at ${pkr(toPaisa(l.unitPriceNet))}, ${Number(l.gstRate) > 0 ? `${qtyText(Number(l.gstRate))}% sales tax` : 'exempt'}`}
            />
            {pick ? (
              <label className="flex items-center gap-2 text-sm text-fg-2">
                Quantity
                <NumberInput
                  value={Number(pick.qty)}
                  onChange={v => setQty(l.id, v)}
                  min={0}
                  className="w-[96px]"
                  aria-label={`Quantity of line ${i + 1} on this invoice`}
                  suffix={`of ${qtyText(Number(l.qty))}`}
                />
              </label>
            ) : null}
          </li>
        )
      })}
    </ul>
  )
}
