import { useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { Link } from 'react-router-dom'
import { Ban, ChevronDown, ClipboardPaste, Undo2 } from 'lucide-react'
import { businessToday } from '@/lib/dates'
import { formatDay } from '@/lib/formatDay'
import { formatPaisa } from '@/lib/money'
import { mapPgError } from '@/lib/pgErrors'
import { Button } from '@/ui/Button'
import { classifyDoc, KIND_LABEL, NOT_A_SUPPLIER_QUOTE, type DocKind } from '@/lib/docread/docKind'
import { Dialog, DialogContent } from '@/ui/Dialog'
import { Icon } from '@/ui/Icon'
import { NumberInput } from '@/ui/form/NumberInput'
import { Select } from '@/ui/form/Select'
import { TextField } from '@/ui/form/TextField'
import { MenuItem, Popover, PopoverContent, PopoverTrigger } from '@/ui/Popover'
import { StatusBadge } from '@/ui/StatusBadge'
import { useToast } from '@/ui/useToast'
import { PasteBox, PasteReplyPanel } from '@/features/rfqs/PasteReply'
import { Banner } from '@/ui/Banner'
import { PdfPickButton } from '@/features/rfqs/PdfIntake'
import type { readDocument as ReadDocument } from '@/features/rfqs/lib/readPdf'
import { replyInputId } from '@/features/rfqs/replyFocus'
import type { InquiryRow, RfqHeader, RfqItemRow } from '@/features/rfqs/api'
import { useSaveReply, useSetInquiryNoOffer, useSetItemDecline } from '@/features/rfqs/hooks'
import {
  CANT_QUOTE_REASONS,
  comparePrices,
  currencyForSupplier,
  currencySourceNote,
  draftFromLines,
  draftFromSuggestions,
  isReplyDirty,
  planReplySave,
  qtyText,
  REPLY_CURRENCIES,
  suggestFromReply,
  reasonLabel,
  type RateTable,
  type SuggestionSet,
  type ReplyDraft,
} from '@/features/rfqs/lib'
import { parseReplyPrice, replyPriceProblem } from '@/features/rfqs/lib/replyPrice'

// The file and reply readers (src/lib/docread: PDF text, the on-device picture reader, the quote parser) are downloaded the first
// time a file or a reply is read, not with the RFQ page (perf/lcp).
const readDocument: typeof ReadDocument = (...args) => import('@/features/rfqs/lib/readPdf').then(m => m.readDocument(...args))

/*
 * A supplier's reply (R07; grade-B R2 and R4, 2026-10-22). The suppliers are listed ONCE, in "Suppliers asked" (SuppliersAsked.tsx):
 * one row per supplier with "Enter reply" or "Edit reply". That opens this dialog (a bottom sheet on a phone), and only then the
 * price form: a price per item, the currency already filled in (the supplier's last currency, else the country map: "there is
 * nothing to pick"), lead time and stock once for the whole reply. While a price is typed the row says what it reads as in PKR at
 * today's rate, and whether it would be the lowest; with no rate it says the reply can be saved and the rate added afterwards.
 *
 *   FE-2  supplier reply   Enter reply, one typed price per item, currency never typed, then Save reply
 *         can't quote      Enter reply, Can't quote, the reason (the five reasons sit behind one menu, not five buttons)
 *
 * "Can't quote" records one reason for the whole inquiry (no_offer_on and no_offer_reason, a stored key); a different reason for
 * one item is an option, kept in inquiry_item_declines (see lib/cantQuote.ts). The notes stay free for people.
 * Closing with prices typed and not saved asks first (the Dialog's own discard guard).
 *
 * An engineer (owner decision 2026-10-22: engineers see and write no prices) never gets this dialog: a reply is prices
 * (supplier_quote_lines.unit_price is required), so Suppliers asked shows them no Enter or Edit reply and useReplyDialog never opens
 * it for them (nor from a price row's menu or Capture). Take back on a whole "can't quote" stays in Suppliers asked (no price in it).
 */

/** The status of a supplier's reply, as one chip. */
export function ReplyChip({ inquiry, itemCount }: { inquiry: InquiryRow; itemCount: number }) {
  if (!inquiry.sentOn && !inquiry.noOfferOn && inquiry.lines.length === 0) return <StatusBadge dimension="inquiry" value="shortlisted" />
  if (inquiry.responseState === 'quoted' || inquiry.lines.length > 0) return <StatusBadge dimension="inquiry" value="quoted" detail={`${inquiry.lines.length} of ${itemCount}`} />
  if (inquiry.responseState === 'no_offer' || inquiry.noOfferOn) return <StatusBadge dimension="inquiry" value="no-offer" />
  return <StatusBadge dimension="inquiry" value={inquiry.chaseCount > 0 ? 'chased' : 'awaiting'} detail={inquiry.chaseCount > 0 ? `chased ×${inquiry.chaseCount}` : undefined} />
}

/** What a typed price reads as in PKR at today's rate, and whether it would be the lowest (C-40). */
function PricePreview({ itemId, amount, currency, others, rates }: { itemId: string; amount: number; currency: string; others: InquiryRow[]; rates: RateTable }) {
  if (!currency || currency === 'PKR') return null
  const rate = rates[currency]
  const usable = rate && rate.staleness !== 'unusable' && rate.ageDays <= 30
  if (!usable) {
    return (
      <p className="text-sm text-fg-muted" data-preview="no-rate">
        {`No current ${currency} rate. You can save the reply and add the rate afterwards.`}{' '}
        <Link to="/settings/exchange-rates" className="underline underline-offset-2">
          Exchange rates
        </Link>
      </p>
    )
  }
  const existing = others.flatMap(i => i.lines.filter(l => l.itemId === itemId).map(l => ({ id: l.id, amount: l.unitPrice, currency: l.currency })))
  const cmp = comparePrices([...existing, { id: 'new', amount, currency }], rates)
  const mine = cmp.lines.find(l => l.id === 'new')
  if (!mine || mine.pkrPaisa === null) return null
  const lowest = mine.lowest
  return (
    <p className="text-sm text-fg-muted" data-preview="rate">
      {`Reads as ≈ PKR ${formatPaisa(mine.pkrPaisa)} at today's ${currency} rate.`}
      {lowest ? ` It would be the lowest of ${cmp.comparableCount} comparable prices.` : ''}
    </p>
  )
}

/** "Can't quote ▾": the five reasons behind one menu, one tap each. */
export function CantQuoteMenu({ supplierName, busy, onPick, className }: { supplierName: string; busy?: boolean; onPick: (reason: string) => void; className?: string }) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button icon={Ban} disabled={busy} className={className} aria-label={`Can't quote, ${supplierName}`}>
          {"Can't quote"}
          <Icon icon={ChevronDown} size="sm" />
        </Button>
      </PopoverTrigger>
      <PopoverContent variant="menu" align="start" side="top" aria-label="Reason">
        <p role="none" className="px-2 pb-1 pt-1 text-sm text-fg-muted">
          One tap records the reason
        </p>
        {CANT_QUOTE_REASONS.map(r => (
          <MenuItem key={r.key} onClick={() => onPick(r.key)}>
            {r.label}
          </MenuItem>
        ))}
      </PopoverContent>
    </Popover>
  )
}

/** The one-tap chips for a supplier with no currency on file: the usual four first, then the rest. */
const CURRENCY_CHIPS = ['USD', 'EUR', 'CNY', 'PKR', ...REPLY_CURRENCIES.filter(c => !['USD', 'EUR', 'CNY', 'PKR'].includes(c))]

export function SupplierReplyDialog({
  rfq,
  items,
  inquiry,
  inquiries,
  rates,
  focusItemId,
  onClose,
}: {
  rfq: RfqHeader
  items: RfqItemRow[]
  inquiry: InquiryRow
  inquiries: InquiryRow[]
  rates: RateTable
  /** The item whose price box gets the cursor ("Edit reply" on a price row); else the first price box. */
  focusItemId?: string
  /** Closed, or saved. */
  onClose: () => void
}) {
  const { toast } = useToast()
  const save = useSaveReply(rfq.id)
  const noOffer = useSetInquiryNoOffer(rfq.id)
  const itemReason = useSetItemDecline(rfq.id)

  const prefill = currencyForSupplier(inquiry.lastCurrency, inquiry.supplierCountry)
  const existing = inquiry.lines.map(l => ({ itemId: l.itemId, unitPrice: l.unitPrice, currency: l.currency, leadTime: l.leadTime, inStock: l.inStock }))
  const [draft, setDraft] = useState<ReplyDraft>(() => draftFromLines(existing, prefill.currency))
  const [changeCurrency, setChangeCurrency] = useState(false)
  const [pasteMode, setPasteMode] = useState<null | 'box' | 'suggest'>(null)
  const [suggestions, setSuggestions] = useState<SuggestionSet | null>(null)
  /** What was typed in each price box, for the reason shown when it is not a price (HW-48). */
  const [priceText, setPriceText] = useState<Record<string, string>>({})

  const hasLines = inquiry.lines.length > 0
  const declinedAll = Boolean(inquiry.noOfferOn) && !hasLines
  const dirty = isReplyDirty(existing, draft)
  // Text in a price box that is not a price yet ("about 12", or "PKR 1," half typed) is typed work too: closing asks first, and
  // the guard does not switch off and on again between keystrokes (HW-48).
  const unread = items.some(it => !inquiry.itemDeclines[it.id] && typeof draft.prices[it.id] !== 'number' && replyPriceProblem(priceText[it.id] ?? '') !== null)
  const typed = Object.values(draft.prices).filter(p => typeof p === 'number' && p > 0).length
  const others = inquiries.filter(i => i.id !== inquiry.id)

  const currencyNote = hasLines && existing[0].currency === draft.currency ? `${draft.currency}, as saved` : draft.currency === prefill.currency ? currencySourceNote(prefill, inquiry.supplierCountry) : prefill.source === 'none' ? `${draft.currency}, picked by you` : `${draft.currency}, changed by you`
  const currencyOptions = [...new Set([draft.currency, prefill.currency, ...REPLY_CURRENCIES].filter(Boolean))].map(c => ({ value: c, label: c }))

  // Enter in a price box saves too: a second Enter while the save is in flight must not send it again.
  const saving = useRef(false)
  const doSave = async (d: ReplyDraft = draft) => {
    if (!d.currency) return // no currency picked yet: nothing is saved (audit R1)
    const plan = planReplySave(existing, d)
    if (plan.prices.length === 0 && plan.removeItemIds.length === 0) return
    if (saving.current) return
    saving.current = true
    try {
      const n = await save.mutateAsync({
        inquiryId: inquiry.id,
        currency: d.currency,
        leadTime: plan.leadTime,
        inStock: plan.inStock,
        prices: plan.prices,
        removeItemIds: plan.removeItemIds,
      })
      const r = rates[d.currency]
      const noRate = d.currency !== 'PKR' && (!r || r.staleness === 'unusable' || r.ageDays > 30)
      toast({
        title: 'Reply saved',
        body: `${inquiry.supplierName} · ${n} ${n === 1 ? 'price' : 'prices'}${noRate ? ' · not compared, no rate' : ''}`,
        tone: 'success',
      })
      onClose()
    } catch (err) {
      toast({ title: 'Could not save the reply', body: mapPgError(err, { entity: 'reply' }).message, tone: 'danger' })
    } finally {
      saving.current = false
    }
  }

  const cantQuote = async (reason: string) => {
    const before = { noOfferOn: inquiry.noOfferOn, reason: inquiry.noOfferReason }
    try {
      await noOffer.mutateAsync({ inquiryId: inquiry.id, noOfferOn: businessToday(), reason })
      toast({
        title: "Marked can't quote",
        body: `${inquiry.supplierName} · ${reasonLabel(reason)}`,
        undo: {
          onUndo: async () => {
            await noOffer.mutateAsync({ inquiryId: inquiry.id, noOfferOn: before.noOfferOn, reason: before.reason })
          },
          settledTitle: "Marked can't quote",
          undoneTitle: "Can't quote taken back",
        },
      })
      onClose()
    } catch (err) {
      toast({ title: "Could not mark can't quote", body: mapPgError(err, { entity: 'reply' }).message, tone: 'danger' })
    }
  }

  const takeBack = async () => {
    try {
      await noOffer.mutateAsync({ inquiryId: inquiry.id, noOfferOn: null, reason: null })
    } catch (err) {
      toast({ title: "Could not take back can't quote", body: mapPgError(err).message, tone: 'danger' })
    }
  }

  const setItem = async (itemId: string, reason: string | null) => {
    try {
      await itemReason.mutateAsync({ inquiryId: inquiry.id, itemId, reason })
    } catch (err) {
      toast({ title: 'Could not save the reason', body: mapPgError(err).message, tone: 'danger' })
    }
  }

  // ---- paste reply (R08): read the clipboard, offer what was found, save nothing until Accept
  const suggestItems = items.map(it => ({ id: it.id, number: it.number, description: it.description, qty: it.qty, unit: it.unit }))
  // A whole quotation (an email, or the text of a PDF) is read with its totals, bank and header lines left out (docread).
  // A paste or PDF that is an enquiry, an order or our own quotation is held here, not read for prices; it can still be read anyway.
  const [heldReply, setHeldReply] = useState<{ text: string; kind: DocKind; reasons: string[] } | null>(null)
  const readText = (text: string, anyway = false) => {
    setPdfNote(null)
    const kind = classifyDoc(text)
    if (!anyway && NOT_A_SUPPLIER_QUOTE.includes(kind.kind)) {
      setHeldReply({ text, kind: kind.kind, reasons: kind.reasons })
      setPasteMode(null)
      return
    }
    setHeldReply(null)
    void import('@/lib/docread/supplierQuoteParse').then(({ parseSupplierQuote }) => {
      setSuggestions(suggestFromReply(parseSupplierQuote(text, suggestItems, { today: businessToday() }), suggestItems, draft.currency))
      setPasteMode('suggest')
    })
  }
  const [pdfNote, setPdfNote] = useState<string | null>(null)
  // Capture's "This is a supplier's reply" opens this RFQ with the text and the supplier chosen: read it out as if it had been pasted here.
  const location = useLocation()
  const navigate = useNavigate()
  const handedOver = useRef(false)
  useEffect(() => {
    const reply = (location.state as { reply?: { inquiryId: string; text: string; pdf?: File } } | null)?.reply
    if (!reply || reply.inquiryId !== inquiry.id || handedOver.current) return
    handedOver.current = true
    if (!reply.text.trim() && reply.pdf) {
      // A PDF quote, or a screenshot or photo of one, handed over with no text: its prices are read here.
      setPdfNote('Reading the file…')
      void readDocument(reply.pdf, 'prices', { onProgress: p => setPdfNote(p.message) }).then(r =>
        'text' in r ? readText(r.text) : setPdfNote('message' in r ? r.message : null),
      )
    } else readText(reply.text)
    navigate(location.pathname, { replace: true, state: null })
    // readText only reads props and state set above
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.state, inquiry.id])
  const startPaste = async () => {
    let text = ''
    try {
      text = await navigator.clipboard.readText()
    } catch {
      text = ''
    }
    if (text.trim()) readText(text)
    else setPasteMode('box') // the browser would not give the clipboard up, or it is empty: paste into a box instead
  }
  const acceptSuggestions = async (selected: ReadonlySet<string>) => {
    if (!suggestions) return
    try {
      for (const d of suggestions.declined) {
        if (inquiry.itemDeclines[d.itemId] !== d.reason) await itemReason.mutateAsync({ inquiryId: inquiry.id, itemId: d.itemId, reason: d.reason })
      }
    } catch (err) {
      toast({ title: 'Could not save the reasons', body: mapPgError(err).message, tone: 'danger' })
      return
    }
    const next = draftFromSuggestions(draft, suggestions, selected)
    setPasteMode(null)
    setSuggestions(null)
    if (next !== draft) {
      setDraft(next)
      await doSave(next)
    }
  }

  const where = [[inquiry.supplierCity, inquiry.supplierCountry].filter(Boolean).join(', '), inquiry.contactTitle ? `${inquiry.contactName}, ${inquiry.contactTitle}` : inquiry.contactName].filter(Boolean).join(' · ')
  const canSave = Boolean(draft.currency) && dirty && (typed > 0 || planReplySave(existing, draft).removeItemIds.length > 0)
  // The price box that gets the cursor when the dialog opens: the one asked for, else the first item still open.
  const autofocusId = focusItemId ?? items.find(it => !inquiry.itemDeclines[it.id])?.id

  return (
    <Dialog open onOpenChange={o => (o ? null : onClose())} dirty={dirty || unread} busy={save.isPending}>
      <DialogContent
        size="lg"
        title={inquiry.supplierName}
        context={where || undefined}
        titleChip={<ReplyChip inquiry={inquiry} itemCount={items.length} />}
        footer={
          declinedAll ? undefined : (
            <>
              {!hasLines ? <CantQuoteMenu supplierName={inquiry.supplierName} busy={noOffer.isPending} onPick={r => void cantQuote(r)} className="mr-auto max-md:mr-0" /> : null}
              <Button variant="primary" onClick={() => void doSave()} disabled={!canSave} busy={save.isPending} busyLabel="Saving">
                Save reply
              </Button>
            </>
          )
        }
      >
        <div className="grid gap-4 text-base text-fg" data-reply-form={inquiry.supplierId}>
          {declinedAll ? (
            <div className="flex flex-wrap items-center gap-3 rounded-row border border-line bg-sunken px-3 py-2">
              <span>
                <span className="font-medium">{"Can't quote"}</span>
                {inquiry.noOfferReason ? `: ${reasonLabel(inquiry.noOfferReason)}` : ''}
                <span className="text-fg-muted">{` · ${formatDay(inquiry.noOfferOn as string)}`}</span>
              </span>
              <Button size="sm" icon={Undo2} className="ml-auto" onClick={() => void takeBack()} busy={noOffer.isPending}>
                Take back
              </Button>
            </div>
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <Button size="sm" icon={ClipboardPaste} onClick={() => void startPaste()} disabled={pasteMode !== null}>
                  Paste reply
                </Button>
                {pasteMode === null ? <PdfPickButton size="sm" label="Read a PDF or photo" subject="prices" onText={t => readText(t)} onMessage={setPdfNote} /> : null}
                <span className="text-sm text-fg-muted">or type the prices below.</span>
              </div>
              {pdfNote ? <Banner tone="warning" title={pdfNote} /> : null}
              {heldReply ? (
                <Banner
                  tone="warning"
                  className="text-base"
                  title={`This looks like ${KIND_LABEL[heldReply.kind]}, not a quotation from ${inquiry.supplierName}.`}
                  action={
                    <Button size="lg" onClick={() => readText(heldReply.text, true)}>
                      Read as a quotation anyway
                    </Button>
                  }
                >
                  No prices were taken from it. It looked like this because: {heldReply.reasons.join('; ')}.
                </Banner>
              ) : null}
              {pasteMode === 'box' ? <PasteBox onRead={readText} onCancel={() => setPasteMode(null)} /> : null}
              {pasteMode === 'suggest' && suggestions ? (
                <PasteReplyPanel
                  set={suggestions}
                  items={items}
                  supplierName={inquiry.supplierName}
                  busy={save.isPending || itemReason.isPending || noOffer.isPending}
                  onAccept={sel => void acceptSuggestions(sel)}
                  onCantQuote={reason => {
                    setPasteMode(null)
                    setSuggestions(null)
                    void cantQuote(reason)
                  }}
                  onCancel={() => {
                    setPasteMode(null)
                    setSuggestions(null)
                  }}
                />
              ) : null}
              {!draft.currency ? (
                <div role="group" aria-label={`Currency for ${inquiry.supplierName}`} className="flex flex-wrap items-center gap-2 rounded-row border border-line bg-sunken px-3 py-2">
                  <span className="text-fg-2">Which currency are they quoting in? Asked once, then remembered.</span>
                  {CURRENCY_CHIPS.map(c => (
                    <button
                      key={c}
                      type="button"
                      aria-pressed={false}
                      onClick={() => setDraft(d => ({ ...d, currency: c }))}
                      className="inline-flex h-control items-center rounded border border-line-strong bg-surface px-3 text-sm font-medium hover:bg-sunken"
                    >
                      {c}
                    </button>
                  ))}
                </div>
              ) : null}
              <ul className="grid gap-3">
                {items.map(it => {
                  const q = qtyText(it.qty, it.unit)
                  const reason = inquiry.itemDeclines[it.id]
                  const price = draft.prices[it.id]
                  // A number in the draft is fine as it is (a pasted reply or a saved price may have replaced the text typed).
                  const problem = reason || (typeof price === 'number' && price > 0) ? null : replyPriceProblem(priceText[it.id] ?? '')
                  return (
                    <li key={it.id} className="grid content-start gap-1">
                      <div className="grid items-center gap-x-3 gap-y-1 sm:grid-cols-[minmax(0,1fr)_170px]">
                        <span className="flex min-w-0 items-start gap-2" aria-hidden="true">
                          <span className="num mt-[2px] text-sm text-fg-muted">{it.number}</span>
                          <span className="min-w-0">
                            <span className="min-w-0 [overflow-wrap:anywhere]" title={it.description}>
                              {it.description}
                            </span>
                            {q ? <span className="num ml-2 text-sm text-fg-muted">{q}</span> : null}
                          </span>
                        </span>
                        {reason ? (
                          <span className="text-sm text-fg-muted">{`Can't quote: ${reasonLabel(reason)}`}</span>
                        ) : (
                          <NumberInput
                            id={replyInputId(inquiry.id, it.id)}
                            data-autofocus={it.id === autofocusId ? '' : undefined}
                            aria-label={`Price for item ${it.number} from ${inquiry.supplierName}`}
                            aria-invalid={problem ? true : undefined}
                            aria-describedby={problem ? `${replyInputId(inquiry.id, it.id)}-problem` : undefined}
                            value={price ?? null}
                            // HW-48: the typed text is read here (onInput), so "PKR 1,200/-" counts as 1200 and text that is
                            // not a price gets a reason below the box; NumberInput's own reading would only say null.
                            onChange={() => undefined}
                            onInput={e => {
                              const text = e.currentTarget.value
                              const n = parseReplyPrice(text)
                              setPriceText(t => ({ ...t, [it.id]: text }))
                              setDraft(d => ({ ...d, prices: { ...d.prices, [it.id]: n !== null && n >= 0 ? n : null } }))
                            }}
                            prefix={draft.currency}
                            placeholder="Price"
                            min={0}
                            onKeyDown={e => {
                              if (e.key === 'Enter' && dirty && typed > 0 && draft.currency) {
                                e.preventDefault()
                                void doSave()
                              }
                            }}
                          />
                        )}
                      </div>
                      {problem ? (
                        <p id={`${replyInputId(inquiry.id, it.id)}-problem`} className="text-sm font-medium text-tone-danger-fg sm:text-right">
                          {problem}
                        </p>
                      ) : null}
                      {!reason && typeof price === 'number' && price > 0 ? <PricePreview itemId={it.id} amount={price} currency={draft.currency} others={others} rates={rates} /> : null}
                    </li>
                  )
                })}
              </ul>

              <div className="grid items-end gap-3 sm:grid-cols-[minmax(0,1fr)_200px]">
                <label className="grid gap-1 text-sm text-fg-muted">
                  Lead time
                  <TextField
                    aria-label={`Lead time from ${inquiry.supplierName}`}
                    value={draft.leadTime}
                    onChange={e => setDraft(d => ({ ...d, leadTime: e.target.value }))}
                    placeholder="2 weeks, ex-stock"
                  />
                </label>
                <label className="grid gap-1 text-sm text-fg-muted">
                  Stock
                  <Select
                    aria-label={`Stock at ${inquiry.supplierName}`}
                    options={[
                      { value: 'yes', label: 'In stock' },
                      { value: 'no', label: 'Not in stock' },
                    ]}
                    placeholder="Not stated"
                    value={draft.inStock === null ? '' : draft.inStock ? 'yes' : 'no'}
                    onChange={e => setDraft(d => ({ ...d, inStock: e.target.value === '' ? null : e.target.value === 'yes' }))}
                  />
                </label>
              </div>
              {draft.currency ? (
                <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-fg-muted">
                  <span>{`Prices in ${currencyNote}.`}</span>
                  <button type="button" onClick={() => setChangeCurrency(c => !c)} aria-expanded={changeCurrency} className="rounded font-medium underline underline-offset-2 hover:text-fg">
                    {changeCurrency ? 'Keep it' : 'Change currency'}
                  </button>
                  {changeCurrency ? (
                    <Select
                      aria-label={`Currency for ${inquiry.supplierName}`}
                      className="w-[96px]"
                      options={currencyOptions}
                      value={draft.currency}
                      onChange={e => setDraft(d => ({ ...d, currency: e.target.value }))}
                    />
                  ) : null}
                </p>
              ) : null}

              {items.length > 1 ? (
                <details className="text-sm">
                  <summary className="w-fit cursor-pointer text-fg-muted hover:text-fg">A different reason for one item</summary>
                  <ul className="mt-2 grid gap-2">
                    {items.map(it => (
                      <li key={it.id} className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] items-center gap-3">
                        <span className="min-w-0 [overflow-wrap:anywhere]" title={it.description}>
                          <span className="num mr-2 text-fg-muted">{it.number}</span>
                          {it.description}
                        </span>
                        <Select
                          aria-label={`Can't quote reason for item ${it.number} from ${inquiry.supplierName}`}
                          placeholder="Can quote"
                          options={CANT_QUOTE_REASONS.map(r => ({ value: r.key, label: r.label }))}
                          value={inquiry.itemDeclines[it.id] ?? ''}
                          onChange={e => void setItem(it.id, e.target.value || null)}
                          disabled={itemReason.isPending || inquiry.lines.some(l => l.itemId === it.id)}
                        />
                      </li>
                    ))}
                  </ul>
                </details>
              ) : null}
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
