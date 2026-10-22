import { useEffect, useId, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { Link } from 'react-router-dom'
import { ClipboardPaste, Pencil, Plus, TriangleAlert, Undo2, X } from 'lucide-react'
import { businessToday } from '@/lib/dates'
import { formatDay } from '@/lib/formatDay'
import { formatPaisa } from '@/lib/money'
import { mapPgError } from '@/lib/pgErrors'
import { Button } from '@/ui/Button'
import { Dialog, DialogContent } from '@/ui/Dialog'
import { NumberInput } from '@/ui/form/NumberInput'
import { Select } from '@/ui/form/Select'
import { TextField } from '@/ui/form/TextField'
import { StatusBadge } from '@/ui/StatusBadge'
import { useToast } from '@/ui/useToast'
import { useSeesPrices } from '@/app/session'
import { DetailPanel } from '@/features/rfqs/DetailPanel'
import { PasteBox, PasteReplyPanel } from '@/features/rfqs/PasteReply'
import { InfoTip } from '@/ui/InfoTip'
import { Banner } from '@/ui/Banner'
import { parseSupplierQuote } from '@/lib/docread/supplierQuoteParse'
import { PdfPickButton } from '@/features/rfqs/PdfIntake'
import { readDocument } from '@/features/rfqs/lib/readPdf'
import { awaitingReply, focusReplyInput, OPEN_REPLY_EVENT, replyInputId, type OpenReplyDetail } from '@/features/rfqs/replyFocus'
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

/*
 * "Replies from suppliers" (R07; reworked by the UX audit of 2026-10-19): one row per supplier asked, with ONE way in on that row.
 * A supplier we are still waiting on has its reply open, ready to type into (no tap first, FE-2). A supplier who has replied shows
 * one line ("Priced 2 of 4", Edit reply); one who cannot quote shows the reason and Take back. Opening a row shows the inline reply,
 * no modal: a price per item, the currency already filled in (the supplier's last currency, else the country map: "there is nothing
 * to pick"), lead time and stock once for the whole reply. While a price is typed the row says what it reads as in PKR at today's
 * rate, and whether it would be the lowest; with no rate it says the reply can be saved and the rate added afterwards.
 *
 *   FE-2  supplier reply   one typed price per item, currency never typed, then Save reply
 *         can't quote      1 tap: the reason buttons are in the row
 *
 * "Can't quote" records one reason for the whole inquiry (no_offer_on and no_offer_reason, a stored key); a different reason for
 * one item is an option, kept in inquiry_item_declines (see lib/cantQuote.ts). The notes stay free for people.
 * Chasing a supplier lives in the Suppliers asked card (SuppliersAsked.tsx), as in the mockup.
 *
 * An engineer (owner decision 2026-10-22: no prices anywhere) sees who replied, who is waited on and who cannot quote, read-only:
 * a reply is prices (supplier_quote_lines.unit_price is required), so no reply opens, and there is no Add or Edit reply, no Paste
 * reply and no PDF reading for them. Take back on a whole "can't quote" stays (no price in it).
 */

export function SupplierReplies({ rfq, items, inquiries, rates }: { rfq: RfqHeader; items: RfqItemRow[]; inquiries: InquiryRow[]; rates: RateTable }) {
  // Open by default while a reply is expected; a person's own open or close wins until the reply is saved.
  const [toggled, setToggled] = useState<Readonly<Record<string, boolean>>>({})
  const [focus, setFocus] = useState<OpenReplyDetail | null>(null)
  const prices = useSeesPrices()
  const isOpen = (i: InquiryRow) => prices && (toggled[i.id] ?? awaitingReply(i))
  /** `undefined` forgets the person's choice: the row goes back to its default (open only while a reply is expected). */
  const setOpen = (id: string, open: boolean | undefined) =>
    setToggled(t => {
      const next = { ...t }
      if (open === undefined) delete next[id]
      else next[id] = open
      return next
    })

  // "Edit reply" in a price row's menu: open the supplier's row, then put the cursor in the price box once it is drawn.
  useEffect(() => {
    const on = (e: Event) => {
      const d = (e as CustomEvent<OpenReplyDetail>).detail
      setToggled(t => ({ ...t, [d.inquiryId]: true }))
      setFocus(d)
    }
    window.addEventListener(OPEN_REPLY_EVENT, on)
    return () => window.removeEventListener(OPEN_REPLY_EVENT, on)
  }, [])
  useEffect(() => {
    if (focus && document.getElementById(replyInputId(focus.inquiryId, focus.itemId))) {
      focusReplyInput(focus.inquiryId, focus.itemId)
      setFocus(null)
    }
  }, [focus, toggled])

  // Capture's "This is a supplier's reply" arrives with the supplier chosen: open that row so it can read the text.
  const location = useLocation()
  const handed = (location.state as { reply?: { inquiryId: string } } | null)?.reply?.inquiryId
  useEffect(() => {
    if (handed) setToggled(t => (t[handed] ? t : { ...t, [handed]: true }))
  }, [handed])

  if (inquiries.length === 0 || items.length === 0) return null
  const replied = inquiries.filter(i => i.lines.length > 0).length
  return (
    <DetailPanel
      title="Replies from suppliers"
      tip={
        prices ? (
          <InfoTip label="How to enter a reply">
            Type the price for each item the supplier quoted, or tap Paste reply to read the message they sent. The currency follows the supplier, so there is nothing to pick. Nothing
            is compared until it is saved.
          </InfoTip>
        ) : null
      }
      meta={`${replied} of ${inquiries.length} replied`}
      dataSlot="replies"
    >
      <ul className="divide-y">
        {inquiries.map(i =>
          isOpen(i) ? (
            <li key={`${i.id}:${i.lines.map(l => `${l.itemId}=${l.unitPrice}${l.currency}${l.leadTime}${l.inStock}`).join('|')}`} className="p-4">
              <ReplyRow
                rfq={rfq}
                items={items}
                inquiry={i}
                inquiries={inquiries}
                rates={rates}
                onClose={() => setOpen(i.id, false)}
                onSaved={() => setOpen(i.id, undefined)}
              />
            </li>
          ) : (
            <ClosedRow key={i.id} rfq={rfq} inquiry={i} items={items} onOpen={prices ? () => setOpen(i.id, true) : null} />
          ),
        )}
      </ul>
    </DetailPanel>
  )
}

/** The status of a supplier's reply, as one chip. */
function ReplyChip({ inquiry, itemCount }: { inquiry: InquiryRow; itemCount: number }) {
  if (!inquiry.sentOn && !inquiry.noOfferOn && inquiry.lines.length === 0) return <StatusBadge dimension="inquiry" value="shortlisted" />
  if (inquiry.responseState === 'quoted' || inquiry.lines.length > 0) return <StatusBadge dimension="inquiry" value="quoted" detail={`${inquiry.itemsQuoted} of ${itemCount}`} />
  if (inquiry.responseState === 'no_offer' || inquiry.noOfferOn) return <StatusBadge dimension="inquiry" value="no-offer" />
  return <StatusBadge dimension="inquiry" value={inquiry.chaseCount > 0 ? 'chased' : 'awaiting'} detail={inquiry.chaseCount > 0 ? `chased ×${inquiry.chaseCount}` : undefined} />
}

/** One line for a supplier whose reply is not open: who, where it stands, and the one way in. */
function ClosedRow({ rfq, inquiry, items, onOpen }: { rfq: RfqHeader; inquiry: InquiryRow; items: RfqItemRow[]; onOpen: (() => void) | null }) {
  const { toast } = useToast()
  const noOffer = useSetInquiryNoOffer(rfq.id)
  const declinedAll = Boolean(inquiry.noOfferOn) && inquiry.lines.length === 0
  const takeBack = async () => {
    try {
      await noOffer.mutateAsync({ inquiryId: inquiry.id, noOfferOn: null, reason: null })
    } catch (err) {
      toast({ title: "Could not take back can't quote", body: mapPgError(err).message, tone: 'danger' })
    }
  }
  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3" data-reply-row={inquiry.supplierId}>
      <span className="min-w-0 flex-1 basis-[12rem] break-words font-medium">{inquiry.supplierName}</span>
      {declinedAll ? (
        <span className="text-sm text-fg-2">
          {"Can't quote"}
          {inquiry.noOfferReason ? `: ${reasonLabel(inquiry.noOfferReason)}` : ''}
          <span className="text-fg-muted">{` · ${formatDay(inquiry.noOfferOn as string)}`}</span>
        </span>
      ) : (
        <ReplyChip inquiry={inquiry} itemCount={items.length} />
      )}
      {declinedAll ? (
        <Button size="sm" icon={Undo2} onClick={() => void takeBack()} busy={noOffer.isPending}>
          Take back
        </Button>
      ) : onOpen === null ? null : (
        <Button size="sm" icon={inquiry.lines.length > 0 ? Pencil : Plus} onClick={onOpen} aria-label={`${inquiry.lines.length > 0 ? 'Edit reply' : 'Add reply'}, ${inquiry.supplierName}`}>
          {inquiry.lines.length > 0 ? 'Edit reply' : 'Add reply'}
        </Button>
      )}
    </li>
  )
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

/** The one-tap chips for a supplier with no currency on file: the usual four first, then the rest. */
const CURRENCY_CHIPS = ['USD', 'EUR', 'CNY', 'PKR', ...REPLY_CURRENCIES.filter(c => !['USD', 'EUR', 'CNY', 'PKR'].includes(c))]

function ReplyRow({
  rfq,
  items,
  inquiry,
  inquiries,
  rates,
  onClose,
  onSaved,
}: {
  rfq: RfqHeader
  items: RfqItemRow[]
  inquiry: InquiryRow
  inquiries: InquiryRow[]
  rates: RateTable
  /** Close the row again. */
  onClose: () => void
  onSaved: () => void
}) {
  const { toast } = useToast()
  const headingId = useId()
  const save = useSaveReply(rfq.id)
  const noOffer = useSetInquiryNoOffer(rfq.id)
  const itemReason = useSetItemDecline(rfq.id)

  const prefill = currencyForSupplier(inquiry.lastCurrency, inquiry.supplierCountry)
  const existing = inquiry.lines.map(l => ({ itemId: l.itemId, unitPrice: l.unitPrice, currency: l.currency, leadTime: l.leadTime, inStock: l.inStock }))
  const [draft, setDraft] = useState<ReplyDraft>(() => draftFromLines(existing, prefill.currency))
  const [changeCurrency, setChangeCurrency] = useState(false)
  const [pasteMode, setPasteMode] = useState<null | 'box' | 'suggest'>(null)
  const [suggestions, setSuggestions] = useState<SuggestionSet | null>(null)

  const hasLines = inquiry.lines.length > 0
  const declinedAll = Boolean(inquiry.noOfferOn) && !hasLines
  const dirty = isReplyDirty(existing, draft)
  const typed = Object.values(draft.prices).filter(p => typeof p === 'number' && p > 0).length
  // Closing with prices typed and not saved asks first (review of ux/rfqs, item 9): one tap on X must not throw them away.
  const [askClose, setAskClose] = useState(false)
  const requestClose = () => (dirty ? setAskClose(true) : onClose())
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
      onSaved()
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
  const readText = (text: string) => {
    setPdfNote(null)
    setSuggestions(suggestFromReply(parseSupplierQuote(text, suggestItems, { today: businessToday() }), suggestItems, draft.currency))
    setPasteMode('suggest')
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
    if (next !== draft) {
      setDraft(next)
      await doSave(next)
    }
    setPasteMode(null)
    setSuggestions(null)
  }

  return (
    <section aria-labelledby={headingId} className="grid gap-3 rounded border border-line-strong bg-surface p-4">
      <header className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <div className="min-w-0 flex-1 basis-[14rem]">
          <h3 id={headingId} className="break-words font-semibold">
            {inquiry.supplierName}
          </h3>
          <p className="text-sm text-fg-muted">
            {[[inquiry.supplierCity, inquiry.supplierCountry].filter(Boolean).join(', '), inquiry.contactTitle ? `${inquiry.contactName}, ${inquiry.contactTitle}` : inquiry.contactName].filter(Boolean).join(' · ') || 'No country or contact on file'}
          </p>
        </div>
        <ReplyChip inquiry={inquiry} itemCount={items.length} />
        {!declinedAll ? (
          <Button size="sm" icon={ClipboardPaste} onClick={() => void startPaste()} disabled={pasteMode !== null}>
            Paste reply
          </Button>
        ) : null}
        {!declinedAll && pasteMode === null ? <PdfPickButton size="sm" label="Read a PDF or photo" subject="prices" onText={t => readText(t)} onMessage={setPdfNote} /> : null}
        <Button size="sm" variant="quiet" icon={X} aria-label={`Close the reply, ${inquiry.supplierName}`} onClick={requestClose} />
      </header>
      {askClose ? (
        <Dialog open onOpenChange={o => (o ? null : setAskClose(false))}>
          <DialogContent
            title="Close without saving the prices?"
            context={inquiry.supplierName}
            icon={TriangleAlert}
            footer={
              <>
                <Button data-cancel onClick={() => setAskClose(false)}>
                  Keep editing
                </Button>
                <Button
                  variant="danger"
                  onClick={() => {
                    setAskClose(false)
                    onClose()
                  }}
                >
                  Close without saving
                </Button>
              </>
            }
          >
            <p>The prices you typed for {inquiry.supplierName} are not saved yet. Closing throws them away.</p>
          </DialogContent>
        </Dialog>
      ) : null}

      {declinedAll ? (
        <div className="flex flex-wrap items-center gap-3 rounded border border-line bg-sunken px-3 py-2">
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
          {pdfNote ? <Banner tone="warning" title={pdfNote} /> : null}
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
            <div role="group" aria-label={`Currency for ${inquiry.supplierName}`} className="flex flex-wrap items-center gap-2 rounded border border-line bg-sunken px-3 py-2">
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
          <ul className="grid gap-x-6 gap-y-3 md:grid-cols-2">
            {items.map(it => {
              const q = qtyText(it.qty, it.unit)
              const reason = inquiry.itemDeclines[it.id]
              const price = draft.prices[it.id]
              return (
                <li key={it.id} className="grid content-start gap-1">
                  <div className="grid items-center gap-x-3 gap-y-1 sm:grid-cols-[minmax(0,1fr)_140px]">
                    <span className="flex min-w-0 items-start gap-2" aria-hidden="true">
                      <span className="num mt-[2px] text-sm text-fg-muted">{it.number}</span>
                      <span className="min-w-0">
                        <span className="min-w-0 [overflow-wrap:anywhere]" title={it.description}>
                          {it.description}
                        </span>
                        {q ? <span className="num text-sm text-fg-muted">{q}</span> : null}
                      </span>
                    </span>
                    {reason ? (
                      <span className="text-sm text-fg-muted">{`Can't quote: ${reasonLabel(reason)}`}</span>
                    ) : (
                      <NumberInput
                        id={replyInputId(inquiry.id, it.id)}
                        aria-label={`Price for item ${it.number} from ${inquiry.supplierName}`}
                        value={price ?? null}
                        onChange={v => setDraft(d => ({ ...d, prices: { ...d.prices, [it.id]: v } }))}
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
                  {!reason && typeof price === 'number' && price > 0 ? (
                    <div className="sm:pr-[152px]">
                      <PricePreview itemId={it.id} amount={price} currency={draft.currency} others={others} rates={rates} />
                    </div>
                  ) : null}
                </li>
              )
            })}
          </ul>

          <div className="grid items-end gap-3 sm:grid-cols-[minmax(0,1fr)_170px_auto]">
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
            <Button
              variant="primary"
              onClick={() => void doSave()}
              disabled={!draft.currency || !dirty || (typed === 0 && planReplySave(existing, draft).removeItemIds.length === 0)}
              busy={save.isPending}
              busyLabel="Saving"
            >
              Save reply
            </Button>
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

          {!hasLines ? (
            <div role="group" aria-label={`Can't quote, ${inquiry.supplierName}`} className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-medium">{"Can't quote:"}</span>
              {CANT_QUOTE_REASONS.map(r => (
                <Button key={r.key} size="sm" onClick={() => void cantQuote(r.key)} disabled={noOffer.isPending}>
                  {r.label}
                </Button>
              ))}
            </div>
          ) : null}

          <details className="text-sm">
            <summary className="w-fit cursor-pointer text-fg-muted hover:text-fg">A different reason for one item</summary>
            <ul className="mt-2 grid gap-2 md:grid-cols-2">
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
        </>
      )}
    </section>
  )
}
