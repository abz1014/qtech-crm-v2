import { useId, useState } from 'react'
import { Link } from 'react-router-dom'
import { ClipboardPaste, Info, Undo2 } from 'lucide-react'
import { businessToday } from '@/lib/dates'
import { formatDay } from '@/lib/formatDay'
import { formatPaisa } from '@/lib/money'
import { mapPgError } from '@/lib/pgErrors'
import { Button } from '@/ui/Button'
import { Icon } from '@/ui/Icon'
import { NumberInput } from '@/ui/form/NumberInput'
import { Select } from '@/ui/form/Select'
import { TextField } from '@/ui/form/TextField'
import { StatusBadge } from '@/ui/StatusBadge'
import { useToast } from '@/ui/useToast'
import { PasteBox, PasteReplyPanel } from '@/features/rfqs/PasteReply'
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
  parseSupplierReply,
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
 * One inline reply row per supplier asked (R07; the owner kept reply entry per supplier). No modal. A price per item, the
 * currency already filled in (the supplier's last currency, else the country map: "there is nothing to pick"), lead time and
 * stock once for the whole reply. While a price is typed the row says what it reads as in PKR at today's rate, and whether it
 * would be the lowest; with no rate it says the reply can be saved and the rate added afterwards (g2-rfq-detail "Add reply").
 *
 *   FE-2  supplier reply   one typed price per item, currency never typed, then Save reply
 *         can't quote      1 tap: the reason buttons are in the row
 *
 * "Can't quote" records one reason for the whole inquiry (no_offer_on and no_offer_reason, a stored key); a different reason for
 * one item is an option, kept in inquiry_item_declines (see lib/cantQuote.ts). The notes stay free for people.
 * Chasing a supplier lives in the Suppliers asked card (SuppliersAsked.tsx), as in the mockup.
 */

export function SupplierReplies({ rfq, items, inquiries, rates }: { rfq: RfqHeader; items: RfqItemRow[]; inquiries: InquiryRow[]; rates: RateTable }) {
  if (inquiries.length === 0 || items.length === 0) return null
  return (
    <section aria-label="Replies by supplier" className="border-b">
      <div className="px-5 pt-4">
        <h3 className="text-sm font-semibold">Enter a reply</h3>
        <p className="text-sm text-fg-muted">One box per supplier. Type the price for each item they quoted. The currency follows the supplier, so there is nothing to pick.</p>
      </div>
      <ul className="grid gap-3 p-5">
        {inquiries.map(i => (
          <li key={`${i.id}:${i.lines.map(l => `${l.itemId}=${l.unitPrice}${l.currency}${l.leadTime}${l.inStock}`).join('|')}`}>
            <ReplyRow rfq={rfq} items={items} inquiry={i} inquiries={inquiries} rates={rates} />
          </li>
        ))}
      </ul>
    </section>
  )
}

/** What a typed price reads as in PKR at today's rate, and whether it would be the lowest (C-40). */
function PricePreview({ itemId, amount, currency, others, rates }: { itemId: string; amount: number; currency: string; others: InquiryRow[]; rates: RateTable }) {
  if (currency === 'PKR') return null
  const rate = rates[currency]
  const usable = rate && rate.staleness !== 'unusable' && rate.ageDays <= 30
  if (!usable) {
    return (
      <p className="flex flex-wrap items-center gap-1 text-xs text-fg-muted" data-preview="no-rate">
        <Icon icon={Info} size="chip" />
        {`No current ${currency} rate. You can save the reply and add the rate afterwards.`}
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
    <p className="text-xs text-fg-muted" data-preview="rate">
      {`Reads as ≈ PKR ${formatPaisa(mine.pkrPaisa)} at today's ${currency} rate.`}
      {lowest ? ` It would be the lowest of ${cmp.comparableCount} comparable prices.` : ''}
    </p>
  )
}

function ReplyRow({ rfq, items, inquiry, inquiries, rates }: { rfq: RfqHeader; items: RfqItemRow[]; inquiry: InquiryRow; inquiries: InquiryRow[]; rates: RateTable }) {
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
  const others = inquiries.filter(i => i.id !== inquiry.id)

  const currencyNote = hasLines && existing[0].currency === draft.currency ? `${draft.currency}, as saved` : draft.currency === prefill.currency ? currencySourceNote(prefill, inquiry.supplierCountry) : `${draft.currency}, changed by you`
  const currencyOptions = [...new Set([draft.currency, prefill.currency, ...REPLY_CURRENCIES])].map(c => ({ value: c, label: c }))

  const doSave = async (d: ReplyDraft = draft) => {
    const plan = planReplySave(existing, d)
    if (plan.prices.length === 0 && plan.removeItemIds.length === 0) return
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
    } catch (err) {
      toast({ title: 'Could not save the reply', body: mapPgError(err, { entity: 'reply' }).message, tone: 'danger' })
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
            try {
              await noOffer.mutateAsync({ inquiryId: inquiry.id, noOfferOn: before.noOfferOn, reason: before.reason })
            } catch (err) {
              toast({ title: 'Could not undo', body: mapPgError(err).message, tone: 'danger' })
            }
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
  const readText = (text: string) => {
    setSuggestions(suggestFromReply(parseSupplierReply(text, suggestItems, { today: businessToday() }), suggestItems, draft.currency))
    setPasteMode('suggest')
  }
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
      <header className="flex flex-wrap items-start gap-x-3 gap-y-2">
        <div className="min-w-0 flex-1 basis-56">
          <h4 id={headingId} className="break-words text-sm font-semibold">
            {inquiry.supplierName}
          </h4>
          <p className="text-sm text-fg-muted">
            {[[inquiry.supplierCity, inquiry.supplierCountry].filter(Boolean).join(', '), inquiry.contactTitle ? `${inquiry.contactName}, ${inquiry.contactTitle}` : inquiry.contactName].filter(Boolean).join(' · ') || 'No country or contact on file'}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {!inquiry.sentOn && !inquiry.noOfferOn && !hasLines ? (
            <StatusBadge dimension="inquiry" value="shortlisted" />
          ) : inquiry.responseState === 'quoted' ? (
            <StatusBadge dimension="inquiry" value="quoted" detail={`${inquiry.itemsQuoted} of ${items.length}`} />
          ) : inquiry.responseState === 'no_offer' ? (
            <StatusBadge dimension="inquiry" value="no-offer" />
          ) : (
            <StatusBadge dimension="inquiry" value="awaiting" />
          )}
          {inquiry.chaseCount > 0 ? <StatusBadge dimension="inquiry" value="chased" detail={`×${inquiry.chaseCount}`} /> : null}
        </div>
      </header>

      {declinedAll ? (
        <div className="flex flex-wrap items-center gap-3 rounded border border-line bg-sunken px-3 py-2 text-sm">
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
          <ul className="grid gap-x-6 gap-y-3 md:grid-cols-2">
            {items.map(it => {
              const q = qtyText(it.qty, it.unit)
              const reason = inquiry.itemDeclines[it.id]
              const price = draft.prices[it.id]
              return (
                <li key={it.id} className="grid content-start gap-1">
                  <div className="grid items-center gap-x-3 gap-y-1 sm:grid-cols-[minmax(0,1fr)_132px]">
                    <span className="flex min-w-0 items-start gap-2 text-sm" aria-hidden="true">
                      <span className="num mt-[2px] text-xs text-fg-muted">{it.number}</span>
                      <span className="min-w-0">
                        <span className="line-clamp-2 break-words" title={it.description}>
                          {it.description}
                        </span>
                        {q ? <span className="num text-xs text-fg-muted">{q}</span> : null}
                      </span>
                    </span>
                    {reason ? (
                      <span className="text-xs text-fg-muted">{`Can't quote: ${reasonLabel(reason)}`}</span>
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
                          if (e.key === 'Enter' && dirty && typed > 0) {
                            e.preventDefault()
                            void doSave()
                          }
                        }}
                      />
                    )}
                  </div>
                  {!reason && typeof price === 'number' && price > 0 ? (
                    <div className="sm:pr-[144px]">
                      <PricePreview itemId={it.id} amount={price} currency={draft.currency} others={others} rates={rates} />
                    </div>
                  ) : null}
                </li>
              )
            })}
          </ul>

          <div className="grid items-end gap-3 sm:grid-cols-[minmax(0,1fr)_160px_auto]">
            <label className="grid gap-1 text-xs text-fg-muted">
              Lead time
              <TextField
                aria-label={`Lead time from ${inquiry.supplierName}`}
                value={draft.leadTime}
                onChange={e => setDraft(d => ({ ...d, leadTime: e.target.value }))}
                placeholder="2 weeks, ex-stock"
              />
            </label>
            <label className="grid gap-1 text-xs text-fg-muted">
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
            <div className="flex flex-wrap items-center gap-2">
              <Button
                variant="primary"
                onClick={() => void doSave()}
                disabled={!dirty || (typed === 0 && planReplySave(existing, draft).removeItemIds.length === 0)}
                busy={save.isPending}
                busyLabel="Saving"
              >
                Save reply
              </Button>
            </div>
          </div>
          <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-fg-muted">
            <span>{`The currency follows the supplier: ${currencyNote}. There is nothing to pick.`}</span>
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

          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" icon={ClipboardPaste} onClick={() => void startPaste()} disabled={pasteMode !== null}>
              Paste reply
            </Button>
            <span className="text-xs text-fg-muted">Reads the email or message you copied. Nothing is saved until you accept.</span>
          </div>
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
                  <span className="min-w-0 truncate text-sm" title={it.description}>
                    <span className="num mr-2 text-xs text-fg-muted">{it.number}</span>
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
