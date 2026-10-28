import { useEffect, useMemo, useRef, useState } from 'react'
import { Download, Eye, FileCheck, FileText, Info, RotateCcw, Share2, TriangleAlert } from 'lucide-react'
import { useSession } from '@/app/session'
import { businessToday } from '@/lib/dates'
import { formatDay, formatShortDate } from '@/lib/formatDay'
import { formatPaisa } from '@/lib/money'
import { mapPgError } from '@/lib/pgErrors'
import { orderRef, rfqRef } from '@/lib/refs'
import { Banner } from '@/ui/Banner'
import { Button } from '@/ui/Button'
import { Dialog, DialogContent } from '@/ui/Dialog'
import { Icon } from '@/ui/Icon'
import { InfoTip } from '@/ui/InfoTip'
import { Skeleton } from '@/ui/Skeleton'
import { Checkbox } from '@/ui/form/Checkbox'
import { DateInput } from '@/ui/form/DateInput'
import { Field } from '@/ui/form/Field'
import { NumberInput } from '@/ui/form/NumberInput'
import { Select } from '@/ui/form/Select'
import { TextArea, TextField } from '@/ui/form/TextField'
import { useToast } from '@/ui/useToast'
import type { RfqHeader, InquiryRow } from '@/features/rfqs/api'
import { useFxLatest } from '@/features/rfqs/hooks'
import { comparePrices, toRateTable } from '@/features/rfqs/lib'
import { useCompanyProfile } from '@/features/settings/hooks'
import { loadPdfData, loadSignatory, type PdfData, type QuotationRow, type PriceMemory, type QuoteItem } from '@/features/quotations/api'
import { useCompanyContacts, useIssueQuotation, usePriceMemory, useQuoteItems, useQuotations, useStorePdf } from '@/features/quotations/hooks'
import { generateQuotationPdf } from '@/features/quotations/pdf/generate'
import { addDays, quotationRef } from '@/features/quotations/lib/refs'
import { profileGaps } from '@/features/quotations/lib/profileGaps'
import { downloadBlob, sharePdf } from '@/features/quotations/lib/sharePdf'
import { computeTotals } from '@/features/quotations/lib/totals'
import { applyIssueDraft, clearIssueDraft, readIssueDraft, writeIssueDraft, type IssueDraft } from '@/features/quotations/lib/issueDraft'
import { SettingsLink } from '@/features/quotations/SettingsLink'

/*
 * Issue quotation (R19; g2-rfq-detail "Issue quotation" dialog, then the parity pass). Opened from the RFQ page for a first
 * issue or a re-issue. A re-issue is titled with the NEW revision and carries a "Re-issue" chip.
 *
 * FE-2 entry burden, listed for the commit:
 *   required     a net unit price for every INCLUDED item (nothing else), and at least one included item. A price is one tap
 *                on a chip (last sold to this customer, last quoted) or one typed number; a price already on the RFQ from the
 *                last issue is kept.
 *   pre-filled   which items are included (those with a price source: a supplier reply, a chip or a price from the last
 *                issue), GST 18 % (or the item's last rate; 0 % is the exemption), validity (company default, in days from
 *                today), the contact (the RFQ's, or the previous revision's), delivery and payment terms (the previous
 *                revision), the standard terms (the company profile), the issue date (today), the signatory (the signed-in
 *                person).
 *   optional     the lead time we quote per line (the suppliers' lead times are a hint and are never filled in), validity,
 *                contact, delivery, payment terms, terms text.
 *   interactions at most one price per item (0 when a chip is tapped), then Issue (tap 1) and Share (tap 2).
 *
 * Partial quotations (owner decision, 2026-10-15): only ticked items are priced, snapshotted and printed (issue_quotation's
 * p_item_ids). Issue saves the quotation first. The PDF is a separate step that never blocks saving: with the legal name or
 * address missing from the company profile the quotation is still issued, and a plain banner links to Settings, Company.
 */

type Stage =
  | { kind: 'edit' }
  | { kind: 'done'; quotation: QuotationRow; pdf: Blob | null; pdfError: string | null }

const GST_OPTIONS = [
  { value: '18', label: '18%' },
  { value: '0', label: 'Exempt' },
]

const money = (n: number) => formatPaisa(BigInt(Math.round(n * 100)), 'auto')

/** numeric(14,2): the largest unit price rfq_items holds and the largest net or GST total a quotation holds. */
const MAX_AMOUNT = 999_999_999_999.99
const MAX_PAISA = 99_999_999_999_999n

function LeadHint({ item, inquiries, className }: { item: QuoteItem; inquiries: InquiryRow[]; className?: string }) {
  const said = inquiries.flatMap(i => i.lines.filter(l => l.itemId === item.id && l.leadTime?.trim()).map(l => ({ who: i.supplierName, text: l.leadTime as string })))
  if (said.length === 0) return null
  return (
    <p className={`flex min-w-0 items-start gap-1 text-xs text-fg-muted ${className ?? ''}`} data-testid="lead-hint">
      <Icon icon={Info} size="chip" className="mt-[1px] shrink-0" />
      <span>Suppliers say {said.map(s => `${s.text} (${s.who})`).join(', ')}</span>
    </p>
  )
}

function Chip({ label, value, selected, onPick, testId, disabled }: { label: string; value: string; selected: boolean; onPick: () => void; testId: string; disabled: boolean }) {
  return (
    <button
      type="button"
      data-testid={testId}
      aria-pressed={selected}
      disabled={disabled}
      onClick={onPick}
      className={`inline-flex min-h-[28px] max-w-full flex-wrap items-baseline gap-x-1 rounded border px-2 py-1 text-left text-xs transition-colors duration-fast max-md:min-h-touch max-md:items-center disabled:cursor-not-allowed ${
        selected ? 'border-primary bg-selected text-fg' : 'border-line-input bg-surface text-fg-2 hover:border-fg-muted hover:bg-sunken'
      }`}
    >
      <span className="text-fg-muted">{label}</span>
      <span className="num font-medium text-fg">{value}</span>
    </button>
  )
}

// Each line is its own grid, so the tracks are fixed to line up; sized for 16px text (a 7-figure price, "Exempt", a 4-digit qty).
const GRID = 'md:grid-cols-[28px_minmax(0,1.5fr)_56px_140px_108px_minmax(0,1fr)_128px]'

export function IssueQuotationDialog({ rfq, inquiries, onClose }: { rfq: RfqHeader; inquiries: InquiryRow[]; onClose: () => void }) {
  const { toast } = useToast()
  const session = useSession()
  const items = useQuoteItems(rfq.id, true)
  const memory = usePriceMemory(rfq.id, true)
  const quotations = useQuotations(rfq.id)
  const contacts = useCompanyContacts(rfq.company.id, true)
  const profileQ = useCompanyProfile()
  const fx = useFxLatest()
  const issue = useIssueQuotation(rfq.id)
  const storePdf = useStorePdf(rfq.id)
  const rates = useMemo(() => toRateTable(fx.data ?? []), [fx.data])

  const previous = quotations.data?.[0] ?? null
  const firstIssuedOn = quotations.data && quotations.data.length > 0 ? quotations.data[quotations.data.length - 1].issuedOn : null
  const nextRevision = previous ? previous.revision + 1 : 0
  const profile = profileQ.data
  const gaps = profileGaps(profile)

  const [stage, setStage] = useState<Stage>({ kind: 'edit' })
  const [included, setIncluded] = useState<Record<string, boolean>>({})
  const [prices, setPrices] = useState<Record<string, number | null>>({})
  const [rateOf, setRateOf] = useState<Record<string, string>>({})
  const [leads, setLeads] = useState<Record<string, string>>({})
  const [validUntil, setValidUntil] = useState('')
  const [contactId, setContactId] = useState('')
  const [delivery, setDelivery] = useState('')
  const [payment, setPayment] = useState('')
  const [terms, setTerms] = useState('')
  const [sharing, setSharing] = useState(false)
  const [previewing, setPreviewing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [validEdited, setValidEdited] = useState(false)
  const seeded = useRef(false)
  const [hydrated, setHydrated] = useState(false)
  const defaultsSnap = useRef<string | null>(null)
  const claimId = useRef(crypto.randomUUID())
  /** HW-4: the latest quotation id this dialog was built on (null: none yet). Set at seed time; moved on after a warning. */
  const builtOn = useRef<string | null>(null)

  const byItem = useMemo(() => new Map((memory.data ?? []).map(m => [m.itemId, m] as const)), [memory.data])

  /** The lowest supplier reply for an item, in PKR at today's rate (the mockup's "Best reply"), per unit. Null when none can be converted. */
  const bestReply = (itemId: string): bigint | null => {
    const lines = inquiries.flatMap(i => i.lines.filter(l => l.itemId === itemId).map(l => ({ id: l.id, amount: l.unitPrice, currency: l.currency })))
    if (lines.length === 0) return null
    const cmp = comparePrices(lines, rates)
    const pkr = cmp.lines.map(l => l.pkrPaisa).filter((p): p is bigint => p !== null)
    return pkr.length ? pkr.reduce((a, b) => (b < a ? b : a)) : null
  }
  const hasSupplierPrice = (itemId: string) => inquiries.some(i => i.lines.some(l => l.itemId === itemId))

  // Seed once, when everything the defaults come from has arrived. Nothing here overwrites what is later typed.
  // The price chips are a convenience: when their read fails the dialog seeds without them instead of never seeding.
  const memoryRows = memory.data ?? (memory.isError ? [] : undefined)
  useEffect(() => {
    if (seeded.current || !items.data || !quotations.data || !profile || !contacts.data || !memoryRows) return
    seeded.current = true
    const p = quotations.data[0] ?? null
    builtOn.current = p?.id ?? null
    const mem = new Map(memoryRows.map(m => [m.itemId, m] as const))
    const known = new Set(contacts.data.map(c => c.id))
    const wanted = p?.contactId ?? rfq.contactId
    const defaults: IssueDraft = {
      prices: Object.fromEntries(items.data.map(i => [i.id, i.quotedUnitPriceNet])),
      // An item is quotable when something prices it: a supplier reply, a chip, or the price from the last issue. The rest start unticked.
      included: Object.fromEntries(
        items.data.map(i => {
          const m = mem.get(i.id)
          const quotable = i.quotedUnitPriceNet !== null || hasSupplierPrice(i.id) || Boolean(m?.soldPrice !== null && m?.soldPrice !== undefined) || Boolean(m?.quotedPrice !== null && m?.quotedPrice !== undefined)
          return [i.id, quotable]
        }),
      ),
      rateOf: Object.fromEntries(items.data.map(i => [i.id, Number(i.gstRate) === 0 ? '0' : '18'])),
      leads: Object.fromEntries(items.data.map(i => [i.id, i.quotedLeadTime ?? ''])),
      validUntil: addDays(businessToday(), profile.quotation_validity_days),
      contactId: wanted && known.has(wanted) ? wanted : '',
      delivery: p?.deliveryText ?? '',
      payment: p?.paymentTerms ?? '',
      terms: p?.notes ?? profile.quotation_terms ?? '',
    }
    // HW-9: what was typed before Back, a reload or an accidental close comes back.
    const draft = readIssueDraft(rfq.id)
    const start = applyIssueDraft(defaults, draft, items.data.map(i => i.id))
    defaultsSnap.current = JSON.stringify(defaults)
    setPrices(start.prices)
    setIncluded(start.included)
    setRateOf(start.rateOf)
    setLeads(start.leads)
    setValidUntil(start.validUntil)
    if (draft && start.validUntil !== defaults.validUntil) setValidEdited(true)
    setDelivery(start.delivery)
    setPayment(start.payment)
    setTerms(start.terms)
    setContactId(start.contactId && known.has(start.contactId) ? start.contactId : '')
    setHydrated(true)
    // hasSupplierPrice reads inquiries, which are fixed for the life of the dialog
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items.data, quotations.data, profile, contacts.data, memoryRows, rfq.contactId])

  // Keep the draft while it differs from the defaults (HW-9); nothing is stored for a dialog only opened and looked at.
  const draftNow: IssueDraft = { prices, included, rateOf, leads, validUntil, contactId, delivery, payment, terms }
  const draftText = JSON.stringify(draftNow)
  useEffect(() => {
    if (!hydrated || stage.kind !== 'edit' || defaultsSnap.current === null) return
    if (draftText === defaultsSnap.current) clearIssueDraft(rfq.id)
    else writeIssueDraft(rfq.id, JSON.parse(draftText) as IssueDraft)
  }, [draftText, hydrated, rfq.id, stage.kind])

  /** Closed on purpose (Cancel, Esc, the scrim): the draft goes too. Back and a reload keep it. */
  const closeOnPurpose = () => {
    clearIssueDraft(rfq.id)
    onClose()
  }

  /** A chip is the price in one tap, and it ticks the item. */
  const pick = (id: string, value: number) => {
    setPrices(p => ({ ...p, [id]: value }))
    setIncluded(s => ({ ...s, [id]: true }))
  }

  const firstYear = firstIssuedOn ?? businessToday()
  const refOf = (m: PriceMemory) => (m.quotedNumber !== null && m.quotedOn ? quotationRef(m.quotedNumber, m.quotedOn) : null)

  const list = items.data ?? []
  const isIn = (id: string) => included[id] === true
  const totals = computeTotals(list.map(i => ({ qty: i.qty, unitPrice: isIn(i.id) ? (prices[i.id] ?? null) : null, gstRate: rateOf[i.id] ?? '18' })))
  const chosen = list.filter(i => isIn(i.id))
  const missing = chosen.filter(i => prices[i.id] === null || prices[i.id] === undefined)
  // HW-8: a free line cannot go out on a customer quotation. HW-2: a price or total the database cannot hold is refused here,
  // with the reason, instead of failing (or crashing) later.
  const zero = chosen.filter(i => prices[i.id] === 0)
  const tooBig = chosen.filter(i => (prices[i.id] ?? 0) > MAX_AMOUNT)
  const totalTooBig = tooBig.length === 0 && (totals.net > MAX_PAISA || totals.gst > MAX_PAISA)
  const ready = seeded.current && chosen.length > 0 && missing.length === 0 && zero.length === 0 && tooBig.length === 0 && !totalTooBig && validUntil !== ''
  const loading = items.isPending || quotations.isPending || profileQ.isPending || contacts.isPending || memory.isPending
  const loadFailed = items.isError || quotations.isError || profileQ.isError || contacts.isError
  const busy = issue.isPending || storePdf.isPending

  // GST lines of the totals: one per rate, "GST 18% on 3 lines".
  const gstRows = [...totals.gstByRate.keys()]
    .sort((a, b) => Number(b) - Number(a))
    .map(r => ({
      rate: r,
      count: chosen.filter(i => (rateOf[i.id] ?? '18') === r && prices[i.id] !== null && prices[i.id] !== undefined).length,
      gst: totals.gstByRate.get(r) ?? 0n,
    }))

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
      // HW-4: a quotation issued from another tab (or by someone else) since this dialog opened is not silently revised over.
      // Re-read the RFQ's quotations first; when the latest is not the one this dialog was built on, stop and say so. The
      // refreshed list updates this dialog (it now offers the next revision), so a second press is a deliberate revision.
      const fresh = await quotations.refetch()
      if (fresh.isError) throw fresh.error
      const latest = fresh.data?.[0] ?? null
      if ((latest?.id ?? null) !== builtOn.current && latest?.id !== claimId.current) {
        builtOn.current = latest?.id ?? null
        setError(
          `${latest ? quotationRef(latest.number, firstYear, latest.revision) : 'A quotation'} was just issued for this RFQ, from another tab or by someone else. Nothing was issued now. Check it first; press Issue again only to make a revision.`,
        )
        return
      }
      const q = await issue.mutateAsync({
        id: claimId.current,
        rfqId: rfq.id,
        items: chosen.map(i => ({
          id: i.id,
          unitPrice: prices[i.id] as number,
          gstRate: Number(rateOf[i.id] ?? 18),
          leadTime: leads[i.id]?.trim() ? leads[i.id].trim() : null,
          // HW-3: the quantity on screen. If someone changed it meanwhile the server refuses and nothing is issued.
          qty: i.qty,
        })),
        validUntil,
        contactId: contactId || null,
        deliveryText: delivery.trim() || null,
        paymentTerms: payment.trim() || null,
        notes: terms.trim() || null,
      })
      clearIssueDraft(rfq.id)
      const made = await makePdf(q)
      setStage({ kind: 'done', quotation: q, pdf: made.pdf, pdfError: made.pdfError })
    } catch (err) {
      const code = typeof err === 'object' && err !== null && 'code' in err ? (err as { code?: unknown }).code : undefined
      const text = typeof err === 'object' && err !== null && 'message' in err ? String((err as { message?: unknown }).message) : ''
      if (code === '22003') {
        setError('The total is larger than a quotation can hold. Nothing was issued and no price was changed. Check the prices and quantities, then issue again.')
        return
      }
      setError(mapPgError(err, { entity: 'quotation' }).message)
      // HW-3: a quantity changed under the dialog. Show the real quantities and total before the next try.
      if (/^the quantity of .+ changed to /.test(text)) void items.refetch()
    }
  }

  /** Preview PDF: the document as it would be issued now, built from the form, nothing saved. Opens in a tab opened inside the tap. */
  const preview = async () => {
    if (!profile || gaps.length > 0) return
    const tab = window.open('', '_blank')
    setPreviewing(true)
    try {
      const picked = chosen.filter(i => prices[i.id] !== null && prices[i.id] !== undefined)
      const contact = (contacts.data ?? []).find(c => c.id === contactId)
      const sig = session.status === 'signed-in' ? await loadSignatory(session.user.id) : null
      const today = businessToday()
      const data: PdfData = {
        preview: true,
        quotation: {
          id: 'preview',
          number: previous?.number ?? 0,
          revision: nextRevision,
          issuedOn: today,
          validUntil,
          contactId: contactId || null,
          lines: picked.map(i => ({
            rfq_item_id: i.id,
            description: i.description,
            qty: i.qty,
            unit: i.unit,
            unit_price_net: prices[i.id] as number,
            gst_rate: Number(rateOf[i.id] ?? 18),
            lead_time: leads[i.id]?.trim() ? leads[i.id].trim() : null,
          })),
          netTotal: 0,
          gstTotal: 0,
          deliveryText: delivery.trim() || null,
          paymentTerms: payment.trim() || null,
          notes: terms.trim() || null,
          signatoryId: session.status === 'signed-in' ? session.user.id : '',
          pdfPath: null,
        },
        previous: previous ? { revision: previous.revision, issuedOn: previous.issuedOn } : null,
        firstIssuedOn: firstIssuedOn ?? today,
        customer: { name: rfq.company.name, country: rfq.company.country },
        siteName: rfq.site?.name ?? null,
        siteAddress: rfq.site?.address ?? null,
        attention: contact?.name ?? null,
        attentionTitle: contact?.jobTitle ?? null,
        customerRef: rfq.customerRef,
        rfqNumber: rfq.number,
        signatory: sig,
      }
      const blob = await generateQuotationPdf(data, profile)
      const url = URL.createObjectURL(blob)
      if (tab) tab.location.href = url
      else downloadBlob(blob, 'quotation-preview.pdf')
      setTimeout(() => URL.revokeObjectURL(url), 60_000)
    } catch (err) {
      tab?.close()
      toast({ title: 'Could not make the preview', body: mapPgError(err, { entity: 'PDF' }).message, tone: 'danger' })
    } finally {
      setPreviewing(false)
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

  // On screen a re-issue is "Revise quotation QT-26-0042" (plain words, 2026-10-19); the PDF and its file name keep the R number.
  const title = previous ? `Revise quotation ${quotationRef(previous.number, firstYear)}` : 'Issue quotation'

  if (stage.kind === 'done') {
    const { quotation: q, pdf, pdfError } = stage
    const base = quotationRef(q.number, firstYear)
    return (
      <Dialog open onOpenChange={o => (o ? null : onClose())} busy={storePdf.isPending}>
        <DialogContent
          title={q.revision > 0 ? `Revised quotation ${base} issued` : `Quotation ${base} issued`}
          context={`${rfqRef(rfq.number)} · ${rfq.company.name}. It is marked sent today.`}
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
            <Banner tone="warning" title="The PDF was not made">
              Add the {gaps.join(' and ')} in Settings, Company. The quotation itself is saved; make its PDF from the list once that is done. <SettingsLink />
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

  const addressedOptions = (contacts.data ?? []).map(c => ({ value: c.id, label: [c.name, c.jobTitle].filter(Boolean).join(', ') }))

  return (
    <Dialog open onOpenChange={o => (o ? null : closeOnPurpose())} busy={busy}>
      <DialogContent
        title={title}
        titleChip={
          previous ? (
            <span className="inline-flex h-6 items-center gap-1 rounded border border-line-strong bg-surface px-[6px] text-sm font-medium text-fg-2">
              <Icon icon={RotateCcw} size="chip" />
              Revision {nextRevision}
            </span>
          ) : null
        }
        context={
          previous
            ? `The quotation sent ${formatDay(previous.issuedOn)} stays exactly as it was. This makes a revised one under the same number.${rfq.customerRef ? ` Customer ref ${rfq.customerRef}.` : ''}`
            : `${rfqRef(rfq.number)} · ${rfq.company.name}${rfq.customerRef ? ` · customer ref ${rfq.customerRef}` : ''}`
        }
        icon={FileText}
        size="lg"
        className="md:w-[min(900px,calc(100vw-2rem))]"
        lead={
          <>
            Issuing marks the quotation sent today.
            <InfoTip label="What issuing does" side="top" align="start">It gets a number and a PDF and cannot be edited. You can always Revise it; the first one stays on record.</InfoTip>
          </>
        }
        footer={
          <>
            {/* Phone: Cancel and Preview share one row (the footer was a tall stack of three full-width buttons). */}
            <div className="flex items-center gap-2 max-md:[&>button]:h-touch max-md:[&>button]:flex-1 md:contents">
            <Button data-cancel onClick={closeOnPurpose} disabled={busy}>
              Cancel
            </Button>
            <Button icon={Eye} onClick={() => void preview()} busy={previewing} busyLabel="Making the preview" disabled={busy || gaps.length > 0 || chosen.length === 0 || missing.length > 0 || tooBig.length > 0 || totalTooBig}>
              Preview PDF
            </Button>
            </div>
            <Button variant="primary" icon={FileCheck} disabled={!ready} busy={busy} busyLabel={storePdf.isPending ? 'Making the PDF' : 'Issuing'} onClick={() => void submit()}>
              {previous ? 'Issue revised quotation' : 'Issue quotation'}
            </Button>
          </>
        }
      >
        {loading ? (
          <div role="status" className="grid gap-3" aria-busy="true" aria-label="Loading the quotation">
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
              <Banner tone="warning" title={`The PDF needs the company's ${gaps.join(' and ')}`}>
                You can still issue the quotation. Its PDF is made once the profile is complete. <SettingsLink />
              </Banner>
            ) : null}
            {error ? (
              <Banner tone="danger" title="Could not issue the quotation">
                {error}
              </Banner>
            ) : null}

            {/* Two fields; the validity rule is the help under Valid until, not a third column of its own (grade-B Q, minimal fields). */}
            <div className="grid gap-4 md:grid-cols-2">
              <Field label="Addressed to" requirement="optional" source={previous?.contactId === contactId && contactId ? 'from the last quotation' : undefined}>
                <Select value={contactId} onChange={e => setContactId(e.target.value)} placeholder="No contact" options={addressedOptions} />
              </Field>
              <Field
                label="Valid until"
                requirement="optional"
                edited={validEdited}
                help={validEdited ? 'Set by you for this quotation' : `${profile?.quotation_validity_days ?? 30} days from today, the company default`}
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

            <div className="rounded border">
              <div className={`hidden gap-3 border-b bg-sunken px-3 py-2 text-xs font-medium text-fg-muted md:grid ${GRID}`} aria-hidden="true">
                <span />
                <span>Item</span>
                <span className="text-right">Qty</span>
                <span>Unit price, net PKR</span>
                <span>GST</span>
                <span>Lead time we quote</span>
                <span className="text-right">Line net, PKR</span>
              </div>
              <ul aria-label="Items to quote" className="divide-y">
                {list.map((it, idx) => {
                  const m = byItem.get(it.id)
                  const a = totals.lines[idx]
                  const on = isIn(it.id)
                  const price = prices[it.id] ?? null
                  const sold = m?.soldPrice ?? null
                  const quoted = m?.quotedPrice ?? null
                  const best = bestReply(it.id)
                  const n = idx + 1
                  const nothingToQuote = !on && price === null && !hasSupplierPrice(it.id) && sold === null && quoted === null
                  return (
                    <li key={it.id} className={`grid grid-cols-[28px_minmax(0,1fr)] gap-3 px-3 py-3 md:items-start ${GRID} ${on ? '' : 'bg-sunken'}`} data-testid={`quote-line-${n}`}>
                      <div className="pt-[1px]">
                        <Checkbox
                          aria-label={`Include item ${n}`}
                          checked={on}
                          onCheckedChange={v => setIncluded(s => ({ ...s, [it.id]: v === true }))}
                        />
                      </div>
                      <div className={`grid min-w-0 content-start gap-1 ${on ? '' : 'text-fg-muted'}`}>
                        <p className={`break-words font-medium ${on ? 'text-fg' : ''}`}>{it.description}</p>
                        <p className="num text-xs text-fg-muted md:hidden">
                          {it.qty}
                          {it.unit ? ` ${it.unit}` : ''}
                        </p>
                        {best !== null ? <p className="text-xs text-fg-muted">Best reply ≈ PKR {formatPaisa(best, 'auto')} each</p> : null}
                        {nothingToQuote ? <p className="text-xs">No supplier price yet, so there is nothing to quote. Add a reply to include it, or type a price.</p> : null}
                        {sold !== null || quoted !== null ? (
                          <div className="mt-1 grid justify-items-start gap-2">
                            {sold !== null ? (
                              <Chip
                                testId={`chip-sold-${n}`}
                                label="Last sold to this customer"
                                value={`PKR ${money(sold)}${m?.soldOrderNumber ? ` (${orderRef(m.soldOrderNumber)})` : m?.soldOn ? `, ${formatShortDate(m.soldOn, businessToday())}` : ''}`}
                                selected={on && price === sold}
                                disabled={false}
                                onPick={() => pick(it.id, sold)}
                              />
                            ) : null}
                            {quoted !== null ? (
                              <Chip
                                testId={`chip-quoted-${n}`}
                                label="Last quoted"
                                value={`PKR ${money(quoted)}${m && refOf(m) ? ` (${refOf(m)})` : ''}`}
                                selected={on && price === quoted}
                                disabled={false}
                                onPick={() => pick(it.id, quoted)}
                              />
                            ) : null}
                          </div>
                        ) : null}
                      </div>
                      <p className="num hidden text-right text-sm md:block">
                        {it.qty}
                        {it.unit ? <span className="block text-xs text-fg-muted">{it.unit}</span> : null}
                      </p>
                      <div className="grid grid-cols-[minmax(0,1fr)_96px] gap-2 max-md:col-start-2 md:contents">
                        <div className="grid gap-1 md:block">
                          <span className="text-xs text-fg-muted md:hidden" aria-hidden="true">
                            Unit price, net PKR
                          </span>
                          <NumberInput
                            aria-label={`Unit price, net PKR, item ${n}`}
                            value={price}
                            decimals={2}
                            min={0}
                            onChange={v => {
                              setPrices(p => ({ ...p, [it.id]: v }))
                              if (v !== null) setIncluded(s => ({ ...s, [it.id]: true }))
                            }}
                          />
                        </div>
                        <div className="grid gap-1 md:block">
                          <span className="text-xs text-fg-muted md:hidden" aria-hidden="true">
                            GST
                          </span>
                          <Select aria-label={`GST rate, item ${n}`} value={rateOf[it.id] ?? '18'} onChange={e => setRateOf(r => ({ ...r, [it.id]: e.target.value }))} options={GST_OPTIONS} />
                        </div>
                      </div>
                      <div className="grid min-w-0 content-start gap-2 max-md:col-start-2">
                        <div className="grid gap-1">
                          <span className="text-xs text-fg-muted md:hidden" aria-hidden="true">
                            Lead time we quote
                          </span>
                          <TextField
                            aria-label={`Lead time we quote, item ${n}`}
                            value={leads[it.id] ?? ''}
                            placeholder="e.g. 8 to 10 weeks from PO"
                            onChange={e => setLeads(l => ({ ...l, [it.id]: e.target.value }))}
                          />
                        </div>
                      </div>
                      <p className="num whitespace-nowrap text-right text-sm font-medium text-fg max-md:order-2 max-md:col-start-2 md:col-start-7 md:row-start-1 md:pt-2">
                        <span className="sr-only">{`Line net, item ${n}: `}</span>
                        {on && a.priced ? `PKR ${formatPaisa(a.net, 'auto')}` : on ? 'No price yet' : 'Not included'}
                      </p>
                      {/* What suppliers said about lead time: its own full-width line under the row, not a sliver in the narrow column. */}
                      <LeadHint item={it} inquiries={inquiries} className="max-md:col-start-2 md:col-[2/-1]" />
                    </li>
                  )
                })}
              </ul>
              <dl className="ml-auto grid w-full max-w-[380px] gap-1 bg-sunken px-4 py-3 text-sm md:max-w-none md:justify-items-end" aria-label="Totals">
                <div className="flex w-full justify-between md:w-[340px]">
                  <dt className="text-fg-muted">Net</dt>
                  <dd className="num" data-testid="total-net">
                    PKR {formatPaisa(totals.net, 'auto')}
                  </dd>
                </div>
                {gstRows.map(g => (
                  <div key={g.rate} className="flex w-full justify-between md:w-[340px]">
                    <dt className="text-fg-muted">
                      {Number(g.rate) === 0 ? 'GST exempt' : `GST ${g.rate}%`} on {g.count} {g.count === 1 ? 'line' : 'lines'}
                    </dt>
                    <dd className="num" data-testid={Number(g.rate) === 0 ? 'total-gst-exempt' : 'total-gst'}>
                      PKR {formatPaisa(g.gst, 'auto')}
                    </dd>
                  </div>
                ))}
                {gstRows.length === 0 ? (
                  <div className="flex w-full justify-between md:w-[340px]">
                    <dt className="text-fg-muted">GST</dt>
                    <dd className="num" data-testid="total-gst">
                      PKR 0
                    </dd>
                  </div>
                ) : null}
                <div className="flex w-full justify-between border-t pt-2 font-medium text-fg md:w-[340px]">
                  <dt>Gross</dt>
                  <dd className="num" data-testid="total-gross">
                    PKR {formatPaisa(totals.gross, 'auto')}
                  </dd>
                </div>
              </dl>
            </div>
            {chosen.length === 0 ? (
              <p className="text-xs text-fg-muted" role="status">
                Tick at least one item to quote.
              </p>
            ) : missing.length > 0 ? (
              <p className="text-xs text-fg-muted" role="status">
                {missing.length === 1 ? '1 ticked item still needs a price.' : `${missing.length} ticked items still need a price.`}
              </p>
            ) : zero.length > 0 ? (
              <p className="text-xs text-tone-danger-fg" role="status" data-testid="issue-blocked">
                {`A quotation can't carry a price of 0. Enter the price for item ${zero.map(i => list.indexOf(i) + 1).join(', ')}, or untick it.`}
              </p>
            ) : tooBig.length > 0 ? (
              <p className="text-xs text-tone-danger-fg" role="status" data-testid="issue-blocked">
                {`The price of item ${tooBig.map(i => list.indexOf(i) + 1).join(', ')} is too large. A unit price can be at most PKR 999,999,999,999.99.`}
              </p>
            ) : totalTooBig ? (
              <p className="text-xs text-tone-danger-fg" role="status" data-testid="issue-blocked">
                The total is larger than a quotation can hold (PKR 999,999,999,999.99 net or GST). Check the prices and quantities.
              </p>
            ) : null}

            <div className="grid gap-4 md:grid-cols-2">
              <Field label="Delivery" requirement="optional" source={previous?.deliveryText && delivery === previous.deliveryText ? 'from the last quotation' : undefined}>
                <TextField value={delivery} onChange={e => setDelivery(e.target.value)} placeholder="e.g. To your site, within the lead time on each line" />
              </Field>
              <Field label="Payment terms" requirement="optional" source={previous?.paymentTerms && payment === previous.paymentTerms ? 'from the last quotation' : undefined}>
                <TextField value={payment} onChange={e => setPayment(e.target.value)} placeholder="e.g. 50% advance, balance against delivery" />
              </Field>
            </div>
            <Field label="Standard terms" requirement="optional" help="From the company profile. Change them in Settings, or edit them for this quotation only.">
              <TextArea rows={4} value={terms} onChange={e => setTerms(e.target.value)} />
            </Field>
            <p className="flex items-center gap-2 text-xs text-fg-muted">
              <TriangleAlert className="size-3" aria-hidden="true" />
              An issued quotation cannot be edited. To change it, revise it: the new one keeps the same number.
            </p>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
