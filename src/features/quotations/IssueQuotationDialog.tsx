import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { Download, FileText, Share2, TriangleAlert } from 'lucide-react'
import { businessToday } from '@/lib/dates'
import { formatShortDate } from '@/lib/formatDay'
import { formatPaisa } from '@/lib/money'
import { mapPgError } from '@/lib/pgErrors'
import { rfqRef } from '@/lib/refs'
import { Banner } from '@/ui/Banner'
import { Button } from '@/ui/Button'
import { Dialog, DialogContent } from '@/ui/Dialog'
import { Skeleton } from '@/ui/Skeleton'
import { DateInput } from '@/ui/form/DateInput'
import { Field } from '@/ui/form/Field'
import { NumberInput } from '@/ui/form/NumberInput'
import { Select } from '@/ui/form/Select'
import { TextArea, TextField } from '@/ui/form/TextField'
import { useToast } from '@/ui/useToast'
import type { RfqHeader, InquiryRow } from '@/features/rfqs/api'
import { useCompanyProfile } from '@/features/settings/hooks'
import { loadPdfData, type QuotationRow, type PriceMemory, type QuoteItem } from '@/features/quotations/api'
import { useCompanyContacts, useIssueQuotation, usePriceMemory, useQuoteItems, useQuotations, useStorePdf } from '@/features/quotations/hooks'
import { generateQuotationPdf } from '@/features/quotations/pdf/generate'
import { addDays, quotationRef } from '@/features/quotations/lib/refs'
import { profileGaps } from '@/features/quotations/lib/profileGaps'
import { downloadBlob, sharePdf } from '@/features/quotations/lib/sharePdf'
import { computeTotals } from '@/features/quotations/lib/totals'

/*
 * Issue quotation (R19; g2-rfq-detail "Issue quotation" dialog). Opened from the RFQ page for a first issue or a re-issue.
 *
 * FE-2 entry burden, listed for the commit:
 *   required     a net unit price for every item (nothing else). A price is one tap on a chip (last sold to this customer,
 *                last quoted) or one typed number; a price already on the RFQ from the last issue is kept.
 *   pre-filled   GST 18 % (or the item's last rate; 0 % is the exemption), validity (company default, in days from today),
 *                the contact (the RFQ's, or the previous revision's), delivery and payment terms (the previous revision),
 *                the standard terms (the company profile), the issue date (today), the signatory (the signed-in person).
 *   optional     the lead time we quote per line (the suppliers' lead times are shown as a hint and never filled in),
 *                validity, contact, delivery, payment terms, terms text.
 *   interactions at most one price per item (0 when a chip is tapped), then Issue (tap 1) and Share (tap 2).
 *
 * Issue saves the quotation first. The PDF is a separate step that never blocks saving: with the legal name or address
 * missing from the company profile the quotation is still issued, and a plain banner links to Settings, Company.
 */

type Stage =
  | { kind: 'edit' }
  | { kind: 'done'; quotation: QuotationRow; pdf: Blob | null; pdfError: string | null }

const GST_OPTIONS = [
  { value: '18', label: '18%' },
  { value: '0', label: 'Exempt' },
]

const money = (n: number) => formatPaisa(BigInt(Math.round(n * 100)), 'auto')

function LeadHint({ item, inquiries }: { item: QuoteItem; inquiries: InquiryRow[] }) {
  const said = inquiries.flatMap(i => i.lines.filter(l => l.itemId === item.id && l.leadTime?.trim()).map(l => ({ who: i.supplierName, text: l.leadTime as string })))
  if (said.length === 0) return null
  return (
    <p className="text-xs text-fg-muted" data-testid="lead-hint">
      Suppliers say {said.map(s => `${s.text} (${s.who})`).join(', ')}
    </p>
  )
}

function Chip({ label, value, selected, onPick, testId }: { label: string; value: string; selected: boolean; onPick: () => void; testId: string }) {
  return (
    <button
      type="button"
      data-testid={testId}
      aria-pressed={selected}
      onClick={onPick}
      className={`inline-flex min-h-[28px] max-w-full flex-wrap items-baseline gap-x-1 rounded border px-2 py-1 text-left text-xs transition-colors duration-fast max-md:min-h-touch max-md:items-center ${
        selected ? 'border-primary bg-selected text-fg' : 'border-line-input bg-surface text-fg-2 hover:border-fg-muted hover:bg-sunken'
      }`}
    >
      <span className="text-fg-muted">{label}</span>
      <span className="num font-medium text-fg">{value}</span>
    </button>
  )
}

export function IssueQuotationDialog({ rfq, inquiries, onClose }: { rfq: RfqHeader; inquiries: InquiryRow[]; onClose: () => void }) {
  const { toast } = useToast()
  const items = useQuoteItems(rfq.id, true)
  const memory = usePriceMemory(rfq.id, true)
  const quotations = useQuotations(rfq.id)
  const contacts = useCompanyContacts(rfq.company.id, true)
  const profileQ = useCompanyProfile()
  const issue = useIssueQuotation(rfq.id)
  const storePdf = useStorePdf(rfq.id)

  const previous = quotations.data?.[0] ?? null
  const firstIssuedOn = quotations.data && quotations.data.length > 0 ? quotations.data[quotations.data.length - 1].issuedOn : null
  const nextRevision = previous ? previous.revision + 1 : 0
  const profile = profileQ.data
  const gaps = profileGaps(profile)

  const [stage, setStage] = useState<Stage>({ kind: 'edit' })
  const [prices, setPrices] = useState<Record<string, number | null>>({})
  const [rates, setRates] = useState<Record<string, string>>({})
  const [leads, setLeads] = useState<Record<string, string>>({})
  const [validUntil, setValidUntil] = useState('')
  const [contactId, setContactId] = useState('')
  const [delivery, setDelivery] = useState('')
  const [payment, setPayment] = useState('')
  const [terms, setTerms] = useState('')
  const [sharing, setSharing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [validEdited, setValidEdited] = useState(false)
  const seeded = useRef(false)
  const claimId = useRef(crypto.randomUUID())

  // Seed once, when everything the defaults come from has arrived. Nothing here overwrites what is later typed.
  useEffect(() => {
    if (seeded.current || !items.data || !quotations.data || !profile || !contacts.data) return
    seeded.current = true
    const p = quotations.data[0] ?? null
    setPrices(Object.fromEntries(items.data.map(i => [i.id, i.quotedUnitPriceNet])))
    setRates(Object.fromEntries(items.data.map(i => [i.id, Number(i.gstRate) === 0 ? '0' : '18'])))
    setLeads(Object.fromEntries(items.data.map(i => [i.id, i.quotedLeadTime ?? ''])))
    setValidUntil(addDays(businessToday(), profile.quotation_validity_days))
    setDelivery(p?.deliveryText ?? '')
    setPayment(p?.paymentTerms ?? '')
    setTerms(p?.notes ?? profile.quotation_terms ?? '')
    const known = new Set(contacts.data.map(c => c.id))
    const wanted = p?.contactId ?? rfq.contactId
    setContactId(wanted && known.has(wanted) ? wanted : '')
  }, [items.data, quotations.data, profile, contacts.data, rfq.contactId])

  const byItem = useMemo(() => new Map((memory.data ?? []).map(m => [m.itemId, m] as const)), [memory.data])
  const firstYear = firstIssuedOn ?? businessToday()
  const refOf = (m: PriceMemory) => (m.quotedNumber !== null && m.quotedOn ? quotationRef(m.quotedNumber, m.quotedOn) : null)

  const list = items.data ?? []
  const totals = computeTotals(list.map(i => ({ qty: i.qty, unitPrice: prices[i.id] ?? null, gstRate: rates[i.id] ?? '18' })))
  const missing = list.filter(i => prices[i.id] === null || prices[i.id] === undefined)
  const ready = seeded.current && list.length > 0 && missing.length === 0 && validUntil !== ''
  const loading = items.isPending || quotations.isPending || profileQ.isPending || contacts.isPending
  const loadFailed = items.isError || quotations.isError || profileQ.isError || contacts.isError
  const busy = issue.isPending || storePdf.isPending

  const makePdf = async (q: QuotationRow): Promise<{ pdf: Blob | null; pdfError: string | null }> => {
    if (!profile || profileGaps(profile).length > 0) return { pdf: null, pdfError: null }
    try {
      const data = await loadPdfData(q.id)
      const blob = await generateQuotationPdf(data, profile)
      await storePdf.mutateAsync({ quotation: q, pdf: blob })
      return { pdf: blob, pdfError: null }
    } catch (err) {
      return { pdf: null, pdfError: mapPgError(err, { entity: 'PDF' }).message }
    }
  }

  const submit = async () => {
    setError(null)
    try {
      const q = await issue.mutateAsync({
        id: claimId.current,
        rfqId: rfq.id,
        items: list.map(i => ({
          id: i.id,
          unitPrice: prices[i.id] as number,
          gstRate: Number(rates[i.id] ?? 18),
          leadTime: leads[i.id]?.trim() ? leads[i.id].trim() : null,
        })),
        validUntil,
        contactId: contactId || null,
        deliveryText: delivery.trim() || null,
        paymentTerms: payment.trim() || null,
        notes: terms.trim() || null,
      })
      const made = await makePdf(q)
      setStage({ kind: 'done', quotation: q, pdf: made.pdf, pdfError: made.pdfError })
    } catch (err) {
      setError(mapPgError(err, { entity: 'quotation' }).message)
    }
  }

  const filename = (q: QuotationRow) => `${quotationRef(q.number, firstYear, q.revision).replace(/ /g, '-')}.pdf`

  const retryPdf = async (q: QuotationRow) => {
    const made = await makePdf(q)
    setStage({ kind: 'done', quotation: q, pdf: made.pdf, pdfError: made.pdfError })
  }

  const share = async (q: QuotationRow, pdf: Blob) => {
    setSharing(true)
    try {
      const result = await sharePdf(pdf, filename(q), `${quotationRef(q.number, firstYear, q.revision)} for ${rfq.company.name}`)
      if (result === 'downloaded') toast({ title: 'PDF downloaded', body: filename(q) })
    } finally {
      setSharing(false)
    }
  }

  const title = `Issue quotation ${previous ? `${quotationRef(previous.number, firstYear)} R${nextRevision}` : ''}`.trim()

  if (stage.kind === 'done') {
    const { quotation: q, pdf, pdfError } = stage
    const ref = quotationRef(q.number, firstYear, q.revision)
    return (
      <Dialog open onOpenChange={o => (o ? null : onClose())} busy={storePdf.isPending}>
        <DialogContent
          title={`${ref} issued`}
          context={`${rfqRef(rfq.number)} · ${rfq.company.name}. The bid is marked sent today.`}
          icon={FileText}
          tone="success"
          size="md"
          footer={
            <>
              <Button data-cancel onClick={onClose}>
                Done
              </Button>
              {pdf ? (
                <>
                  <Button icon={Download} onClick={() => downloadBlob(pdf, filename(q))}>
                    Download PDF
                  </Button>
                  <Button variant="primary" icon={Share2} busy={sharing} busyLabel="Sharing" onClick={() => void share(q, pdf)}>
                    Share
                  </Button>
                </>
              ) : null}
            </>
          }
        >
          {gaps.length > 0 ? (
            <Banner
              tone="warning"
              title="The PDF was not made"
              action={
                <Link to="/settings/company" className="inline-flex h-control items-center rounded border border-line-strong bg-surface px-3 text-sm font-medium text-fg hover:bg-sunken">
                  Open Settings, Company
                </Link>
              }
            >
              Add the {gaps.join(' and ')} in Settings, Company. The quotation itself is saved; make its PDF from the list once that is done.
            </Banner>
          ) : null}
          {pdfError ? (
            <Banner
              tone="danger"
              title="The quotation is saved, but its PDF could not be made"
              action={
                <Button onClick={() => void retryPdf(q)} busy={storePdf.isPending} busyLabel="Making">
                  Make the PDF again
                </Button>
              }
            >
              {pdfError}
            </Banner>
          ) : null}
          {pdf ? <p data-testid="pdf-ready">The PDF is ready. Share it with the customer.</p> : null}
        </DialogContent>
      </Dialog>
    )
  }

  return (
    <Dialog open onOpenChange={o => (o ? null : onClose())} busy={busy}>
      <DialogContent
        title={title}
        context={`${rfqRef(rfq.number)} · ${rfq.company.name}${rfq.customerRef ? ` · customer ref ${rfq.customerRef}` : ''}`}
        icon={FileText}
        size="lg"
        className="md:w-[860px]"
        lead={previous ? `R${previous.revision} stays exactly as it was sent. This creates R${nextRevision} under the same number.` : 'Issuing marks the bid as sent today.'}
        footer={
          <>
            <Button data-cancel onClick={onClose} disabled={busy}>
              Cancel
            </Button>
            <Button variant="primary" icon={FileText} disabled={!ready} busy={busy} busyLabel={storePdf.isPending ? 'Making the PDF' : 'Issuing'} onClick={() => void submit()}>
              {previous ? `Issue R${nextRevision}` : 'Issue quotation'}
            </Button>
          </>
        }
      >
        {loading ? (
          <div className="grid gap-3" aria-busy="true" aria-label="Loading the quotation">
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-24 w-full" />
          </div>
        ) : loadFailed ? (
          <Banner tone="danger" title="Couldn't load the items to quote">
            Nothing was changed. Close this and try again.
          </Banner>
        ) : (
          <>
            {gaps.length > 0 ? (
              <Banner
                tone="warning"
                title={`The PDF needs the company's ${gaps.join(' and ')}`}
                action={
                  <Link to="/settings/company" className="inline-flex h-control items-center rounded border border-line-strong bg-surface px-3 text-sm font-medium text-fg hover:bg-sunken">
                    Open Settings, Company
                  </Link>
                }
              >
                You can still issue the quotation. Its PDF is made once the profile is complete.
              </Banner>
            ) : null}
            {error ? (
              <Banner tone="danger" title="Could not issue the quotation">
                {error}
              </Banner>
            ) : null}

            <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
              <Field label="Addressed to" requirement="optional" source={previous?.contactId === contactId && contactId ? `from ${quotationRef(previous.number, firstYear, previous.revision)}` : undefined}>
                <Select value={contactId} onChange={e => setContactId(e.target.value)} placeholder="No contact" options={(contacts.data ?? []).map(c => ({ value: c.id, label: c.name }))} />
              </Field>
              <Field
                label="Valid until"
                requirement="optional"
                source={validEdited ? undefined : `${profile?.quotation_validity_days ?? 30} days from today, the company default`}
                edited={validEdited}
              >
                <DateInput
                  value={validUntil}
                  defaultToday={false}
                  onChange={v => {
                    setValidUntil(v)
                    setValidEdited(true)
                  }}
                />
              </Field>
            </div>

            <ul className="grid gap-3" aria-label="Items to quote">
              {list.map((it, idx) => {
                const m = byItem.get(it.id)
                const a = totals.lines[idx]
                const price = prices[it.id] ?? null
                const sold = m?.soldPrice ?? null
                const quoted = m?.quotedPrice ?? null
                const n = idx + 1
                return (
                  <li key={it.id} className="grid gap-3 rounded border bg-surface p-3 md:grid-cols-[minmax(0,1.3fr)_minmax(0,1.6fr)_minmax(0,1fr)] md:gap-4" data-testid={`quote-line-${n}`}>
                    <div className="min-w-0">
                      <p className="break-words font-medium text-fg">{it.description}</p>
                      <p className="num text-xs text-fg-muted">
                        {it.qty}
                        {it.unit ? ` ${it.unit}` : ''}
                      </p>
                    </div>
                    <div className="grid min-w-0 content-start gap-2">
                      <div className="grid grid-cols-[minmax(0,1fr)_96px] gap-2">
                        <div className="grid gap-1">
                          <span className="text-xs text-fg-muted" aria-hidden="true">
                            Unit price, net PKR
                          </span>
                          <NumberInput
                            aria-label={`Unit price, net PKR, item ${n}`}
                            value={price}
                            decimals={2}
                            min={0}
                            onChange={v => setPrices(p => ({ ...p, [it.id]: v }))}
                          />
                        </div>
                        <div className="grid gap-1">
                          <span className="text-xs text-fg-muted" aria-hidden="true">
                            GST
                          </span>
                          <Select aria-label={`GST rate, item ${n}`} value={rates[it.id] ?? '18'} onChange={e => setRates(r => ({ ...r, [it.id]: e.target.value }))} options={GST_OPTIONS} />
                        </div>
                      </div>
                      {sold !== null || quoted !== null ? (
                        <div className="flex flex-wrap gap-2">
                          {sold !== null ? (
                            <Chip
                              testId={`chip-sold-${n}`}
                              label="Last sold to this customer"
                              value={`PKR ${money(sold)}${m?.soldOn ? `, ${formatShortDate(m.soldOn, businessToday())}` : ''}`}
                              selected={price === sold}
                              onPick={() => setPrices(p => ({ ...p, [it.id]: sold }))}
                            />
                          ) : null}
                          {quoted !== null ? (
                            <Chip
                              testId={`chip-quoted-${n}`}
                              label="Last quoted"
                              value={`PKR ${money(quoted)}${m && refOf(m) ? `, ${refOf(m)}` : ''}`}
                              selected={price === quoted}
                              onPick={() => setPrices(p => ({ ...p, [it.id]: quoted }))}
                            />
                          ) : null}
                        </div>
                      ) : null}
                    </div>
                    <div className="grid min-w-0 content-start gap-2">
                      <div className="grid gap-1">
                        <span className="text-xs text-fg-muted" aria-hidden="true">
                          Lead time we quote
                        </span>
                        <TextField
                          aria-label={`Lead time we quote, item ${n}`}
                          value={leads[it.id] ?? ''}
                          placeholder="e.g. 8 to 10 weeks from PO"
                          onChange={e => setLeads(l => ({ ...l, [it.id]: e.target.value }))}
                        />
                      </div>
                      <LeadHint item={it} inquiries={inquiries} />
                      <p className="num text-right text-sm font-medium text-fg" aria-label={`Line net, item ${n}`}>
                        {a.priced ? `PKR ${formatPaisa(a.net, 'auto')}` : 'No price yet'}
                      </p>
                    </div>
                  </li>
                )
              })}
            </ul>

            <dl className="ml-auto grid w-full max-w-[320px] gap-1 rounded bg-sunken px-4 py-3 text-sm" aria-label="Totals">
              <div className="flex justify-between">
                <dt className="text-fg-muted">Net</dt>
                <dd className="num" data-testid="total-net">
                  PKR {formatPaisa(totals.net, 'always')}
                </dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-fg-muted">GST</dt>
                <dd className="num" data-testid="total-gst">
                  PKR {formatPaisa(totals.gst, 'always')}
                </dd>
              </div>
              <div className="flex justify-between border-t pt-2 font-medium text-fg">
                <dt>Gross</dt>
                <dd className="num" data-testid="total-gross">
                  PKR {formatPaisa(totals.gross, 'always')}
                </dd>
              </div>
            </dl>
            {missing.length > 0 ? (
              <p className="text-xs text-fg-muted" role="status">
                {missing.length === 1 ? '1 item still needs a price.' : `${missing.length} items still need a price.`}
              </p>
            ) : null}

            <div className="grid gap-4 md:grid-cols-2">
              <Field label="Delivery" requirement="optional" source={previous?.deliveryText && delivery === previous.deliveryText ? `from ${quotationRef(previous.number, firstYear, previous.revision)}` : undefined}>
                <TextField value={delivery} onChange={e => setDelivery(e.target.value)} placeholder="e.g. To your site, within the lead time on each line" />
              </Field>
              <Field label="Payment terms" requirement="optional" source={previous?.paymentTerms && payment === previous.paymentTerms ? `from ${quotationRef(previous.number, firstYear, previous.revision)}` : undefined}>
                <TextField value={payment} onChange={e => setPayment(e.target.value)} placeholder="e.g. 50% advance, balance against delivery" />
              </Field>
            </div>
            <Field label="Standard terms" requirement="optional" help="From the company profile. Change them in Settings, or edit them for this quotation only.">
              <TextArea rows={4} value={terms} onChange={e => setTerms(e.target.value)} />
            </Field>
            <p className="flex items-center gap-2 text-xs text-fg-muted">
              <TriangleAlert className="size-3" aria-hidden="true" />
              An issued quotation cannot be edited. To change it, issue a new revision.
            </p>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
