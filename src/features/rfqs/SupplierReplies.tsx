import { useId, useState } from 'react'
import { ClipboardPaste, Copy, Info, Undo2 } from 'lucide-react'
import { businessToday } from '@/lib/dates'
import { daysBetween } from '@/features/rfqs/lib/dateText'
import { copyToClipboard } from '@/lib/clipboard'
import { formatDay } from '@/lib/formatDay'
import { mapPgError } from '@/lib/pgErrors'
import { rfqRef } from '@/lib/refs'
import { Button } from '@/ui/Button'
import { Icon } from '@/ui/Icon'
import { SegmentedControl } from '@/ui/SegmentedControl'
import { NumberInput } from '@/ui/form/NumberInput'
import { Select } from '@/ui/form/Select'
import { TextField } from '@/ui/form/TextField'
import { StatusBadge } from '@/ui/StatusBadge'
import { useToast } from '@/ui/useToast'
import { Panel } from '@/features/companies/CompanyParts'
import { PasteBox, PasteReplyPanel } from '@/features/rfqs/PasteReply'
import type { InquiryRow, RfqHeader, RfqItemRow } from '@/features/rfqs/api'
import { ChaseNote, FormattedMessage, RecipientRow, ReplyByField, SubjectRow, TickList } from '@/features/rfqs/ChaseParts'
import { FloatElsewhere } from '@/features/rfqs/FloatElsewhere'
import { useChooseSuppliers } from '@/features/rfqs/escalationLogic'
import { useRestoreSupplierChase, useSaveReply, useSetInquiryNoOffer, useSetItemDecline, useStampSupplierChase } from '@/features/rfqs/hooks'
import { useSignature } from '@/features/rfqs/useSignature'
import {
  CANT_QUOTE_REASONS,
  currencyForSupplier,
  currencySourceNote,
  draftFromLines,
  draftFromSuggestions,
  generateSupplierChase,
  supplierReplyBy,
  supplierReturnsOn,
  isReplyDirty,
  parseSupplierReply,
  planReplySave,
  qtyText,
  REPLY_CURRENCIES,
  suggestFromReply,
  reasonLabel,
  type EnquiryVariant,
  type RateTable,
  type SuggestionSet,
  type ReplyDraft,
} from '@/features/rfqs/lib'

/*
 * One inline reply row per supplier asked (R07). No modal. A price per item, the currency already filled in (the supplier's
 * last currency, else the country map; the person never types it), lead time and stock once for the whole reply.
 *
 *   FE-2  supplier reply   one typed price per item, currency never typed, then Save reply
 *         can't quote      1 tap: the reason buttons are in the row
 *         chase            1 tap: copies the text and stamps the chase together
 *
 * "Can't quote" records one reason for the whole inquiry (no_offer_on and no_offer_reason, a stored key); a different reason for
 * one item is an option, kept in inquiry_item_declines (see lib/cantQuote.ts). The notes stay free for people.
 */

export function SupplierReplies({ rfq, items, inquiries, rates }: { rfq: RfqHeader; items: RfqItemRow[]; inquiries: InquiryRow[]; rates: RateTable }) {
  const replied = inquiries.filter(i => i.lines.length > 0).length
  const askedIds = new Set(inquiries.map(i => i.supplierId))
  return (
    <Panel
      title="Supplier replies"
      meta={inquiries.length === 0 ? 'Nobody asked yet' : `${replied} of ${inquiries.length} ${inquiries.length === 1 ? 'supplier' : 'suppliers'} replied`}
    >
      {inquiries.length === 0 ? (
        <p className="px-5 py-6 text-sm text-fg-muted">No supplier has been asked about this RFQ yet. Once one is, their reply is typed in here.</p>
      ) : items.length === 0 ? (
        <p className="px-5 py-6 text-sm text-fg-muted">Add an item to the RFQ before entering a reply.</p>
      ) : (
        <ul className="divide-y">
          {inquiries.map(i => (
            <li key={`${i.id}:${i.lines.map(l => `${l.itemId}=${l.unitPrice}${l.currency}${l.leadTime}${l.inStock}`).join('|')}`}>
              <ReplyRow rfq={rfq} items={items} inquiry={i} rates={rates} askedIds={askedIds} />
            </li>
          ))}
        </ul>
      )}
    </Panel>
  )
}

function ReplyRow({ rfq, items, inquiry, rates, askedIds }: { rfq: RfqHeader; items: RfqItemRow[]; inquiry: InquiryRow; rates: RateTable; askedIds: ReadonlySet<string> }) {
  const { toast } = useToast()
  const headingId = useId()
  const save = useSaveReply(rfq.id)
  const noOffer = useSetInquiryNoOffer(rfq.id)
  const itemReason = useSetItemDecline(rfq.id)
  const stamp = useStampSupplierChase(rfq.id)
  const restoreChase = useRestoreSupplierChase(rfq.id)

  const prefill = currencyForSupplier(inquiry.lastCurrency, inquiry.supplierCountry)
  const existing = inquiry.lines.map(l => ({ itemId: l.itemId, unitPrice: l.unitPrice, currency: l.currency, leadTime: l.leadTime, inStock: l.inStock }))
  const [draft, setDraft] = useState<ReplyDraft>(() => draftFromLines(existing, prefill.currency))
  const [variant, setVariant] = useState<EnquiryVariant>('whatsapp')
  const [pasteMode, setPasteMode] = useState<null | 'box' | 'suggest'>(null)
  const [suggestions, setSuggestions] = useState<SuggestionSet | null>(null)

  const hasLines = inquiry.lines.length > 0
  const declinedAll = Boolean(inquiry.noOfferOn) && !hasLines
  const dirty = isReplyDirty(existing, draft)
  const typed = Object.values(draft.prices).filter(p => typeof p === 'number' && p > 0).length
  const rate = rates[draft.currency]
  const rateMissing = draft.currency !== 'PKR' && (!rate || rate.staleness === 'unusable' || rate.ageDays > 30)

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
      toast({
        title: 'Reply saved',
        body: `${inquiry.supplierName} · ${n} ${n === 1 ? 'price' : 'prices'}${d.currency !== 'PKR' && (!rates[d.currency] || rates[d.currency]!.staleness === 'unusable' || rates[d.currency]!.ageDays > 30) ? ' · not compared, no rate' : ''}`,
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

  // ---- chase: the items still without a price from this supplier, and not declined for a reason of their own
  const today = businessToday()
  const signature = useSignature()
  const [offItems, setOffItems] = useState<ReadonlySet<string>>(new Set())
  const [replyChosen, setReplyChosen] = useState<string | null>(null)
  const [escalationDismissed, setEscalationDismissed] = useState(false)
  const choose = useChooseSuppliers(rfq.id, rfqRef(rfq.number))
  const pricedItems = items.filter(it => inquiry.lines.some(l => l.itemId === it.id))
  const pricedNumbers = pricedItems.map(it => it.number)
  const outstandingAll = items.filter(it => !inquiry.lines.some(l => l.itemId === it.id) && !inquiry.itemDeclines[it.id])
  const outstanding = outstandingAll.filter(it => !offItems.has(it.id))
  const canChase = Boolean(inquiry.sentOn) && !inquiry.noOfferOn && outstandingAll.length > 0
  const defaultReplyBy = supplierReplyBy(rfq.dueOn, today) ?? today
  const chaseFor = (v: EnquiryVariant) =>
    canChase && outstanding.length > 0
      ? generateSupplierChase({
          rfqRef: rfqRef(rfq.number),
          sentOn: inquiry.sentOn,
          dueOn: rfq.dueOn,
          today,
          chaseCount: inquiry.chaseCount,
          contactName: inquiry.contactName,
          pricedNumbers,
          items: outstanding.map(it => ({ number: it.number, description: it.description, brandName: it.brandName, qty: it.qty, unit: it.unit })),
          signature,
          variant: v,
          ageDays: inquiry.sentOn ? daysBetween(inquiry.sentOn, today) : null,
          replyByOverride: replyChosen,
        })
      : null
  const chase = chaseFor(variant)
  const chaseText = chase ? chase.body : ''
  const returnsOn = supplierReturnsOn(today, rfq.dueOn)

  const doChase = async () => {
    const ok = await copyToClipboard(chaseText)
    if (!ok) {
      toast({ title: 'Could not copy the text', body: 'Select the text in the message and copy it by hand. The chase was not recorded.', tone: 'danger' })
      return
    }
    const before = { lastChasedOn: inquiry.lastChasedOn, chaseCount: inquiry.chaseCount }
    try {
      const n = await stamp.mutateAsync(inquiry.id)
      toast({
        title: 'Chase text copied',
        body: `${inquiry.supplierName} · chased ${n} ${n === 1 ? 'time' : 'times'}`,
        tone: 'success',
        undo: {
          onUndo: async () => {
            try {
              await restoreChase.mutateAsync({ inquiryId: inquiry.id, before })
            } catch (err) {
              toast({ title: 'Could not undo', body: mapPgError(err).message, tone: 'danger' })
            }
          },
          settledTitle: 'Chase text copied',
          settledBody: `${rfqRef(rfq.number)} marked chased`,
          undoneTitle: 'Undone.',
          undoneBody: `${inquiry.supplierName} is not marked chased.`,
        },
      })
    } catch (err) {
      toast({ title: 'Copied, but the chase was not recorded', body: mapPgError(err).message, tone: 'danger' })
    }
  }

  return (
    <section aria-labelledby={headingId} className="grid gap-3 px-5 py-4">
      <header className="flex flex-wrap items-start gap-x-3 gap-y-2">
        <div className="min-w-0 flex-1 basis-56">
          <h3 id={headingId} className="break-words text-base font-semibold">
            {inquiry.supplierName}
          </h3>
          <p className="text-sm text-fg-muted">
            {[inquiry.supplierCountry, inquiry.contactName].filter(Boolean).join(' · ') || 'No country or contact on file'}
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
          <ul className="grid gap-x-6 gap-y-2 md:grid-cols-2">
            {items.map(it => {
              const q = qtyText(it.qty, it.unit)
              const reason = inquiry.itemDeclines[it.id]
              return (
                <li key={it.id} className="grid items-center gap-x-3 gap-y-1 sm:grid-cols-[minmax(0,1fr)_132px]">
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
                      aria-label={`Price for item ${it.number} from ${inquiry.supplierName}`}
                      value={draft.prices[it.id] ?? null}
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
                </li>
              )
            })}
          </ul>

          <div className="grid items-end gap-3 sm:grid-cols-[132px_minmax(0,1fr)_160px_auto]">
            <label className="grid gap-1 text-xs text-fg-muted">
              Currency
              <Select
                aria-label={`Currency for ${inquiry.supplierName}`}
                options={currencyOptions}
                value={draft.currency}
                onChange={e => setDraft(d => ({ ...d, currency: e.target.value }))}
              />
            </label>
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
            <Button variant="primary" onClick={() => void doSave()} disabled={!dirty || (typed === 0 && planReplySave(existing, draft).removeItemIds.length === 0)} busy={save.isPending} busyLabel="Saving">
              Save reply
            </Button>
          </div>
          <p className="flex flex-wrap items-center gap-x-2 text-xs text-fg-muted">
            <span>{`Currency: ${currencyNote}.`}</span>
            {rateMissing ? (
              <span className="inline-flex items-center gap-1">
                <Icon icon={Info} size="chip" />
                {`No usable ${draft.currency} rate today. The price is still saved and shows as not compared.`}
              </span>
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

      {inquiry.sentOn || inquiry.chaseCount > 0 ? (
        <div className="grid gap-3 border-t pt-3">
          <p className="text-xs text-fg-muted">
            {inquiry.sentOn ? `Sent ${formatDay(inquiry.sentOn)}` : 'Not sent yet'}
            {inquiry.lastChasedOn ? ` · chased ${inquiry.chaseCount} ${inquiry.chaseCount === 1 ? 'time' : 'times'}, last ${formatDay(inquiry.lastChasedOn)}` : ' · not chased yet'}
          </p>
          {inquiry.chaseCount >= 2 && canChase && !escalationDismissed ? (
            <FloatElsewhere
              supplierName={inquiry.supplierName}
              items={outstandingAll.map(it => ({ id: it.id, number: it.number, description: it.description, brandId: it.brandId, brandName: it.brandName }))}
              askedIds={askedIds}
              today={today}
              busy={choose.busy}
              onChoose={ids => void choose.choose(ids)}
              onChaseAgain={() => setEscalationDismissed(true)}
            />
          ) : null}
          {canChase ? (
            <section aria-label={`Chase ${inquiry.supplierName}`} className="grid overflow-hidden rounded border bg-surface">
              <TickList
                title="Items still without a price from this supplier"
                rows={items
                  .filter(it => !inquiry.itemDeclines[it.id])
                  .map(it => {
                    const priced = inquiry.lines.some(l => l.itemId === it.id)
                    return {
                      id: it.id,
                      label: `${it.brandName && !it.description.toLowerCase().includes(it.brandName.toLowerCase()) ? `${it.brandName} ` : ''}${it.description}`,
                      sub: `item ${it.number} · ${qtyText(it.qty, it.unit) ?? ''}`,
                      checked: !priced && !offItems.has(it.id),
                      disabled: priced,
                      note: priced ? 'priced' : undefined,
                    }
                  })}
                onToggle={(id, on) =>
                  setOffItems(o => {
                    const n = new Set(o)
                    if (on) n.delete(id)
                    else n.add(id)
                    return n
                  })
                }
              />
              <ReplyByField
                label="Reply by"
                value={replyChosen ?? defaultReplyBy}
                onChange={v => setReplyChosen(v && v !== defaultReplyBy ? v : null)}
                note={`${rfq.dueOn ? 'Two working days before our bid.' : 'Three working days from today.'} You can change it.`}
              />
              <div className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-2">
                <span className="text-sm text-fg-muted">Message</span>
                <SegmentedControl
                  aria-label="Message channel"
                  value={variant}
                  onValueChange={v => setVariant(v as EnquiryVariant)}
                  options={[
                    { value: 'whatsapp', label: 'WhatsApp' },
                    { value: 'email', label: 'Email' },
                  ]}
                />
              </div>
              <RecipientRow
                channel={variant}
                lead={variant === 'email' ? 'Email to' : 'WhatsApp to'}
                contact={inquiry.contactName ? { name: inquiry.contactName, phone: inquiry.contactPhone, email: inquiry.contactEmail } : null}
              />
              {variant === 'email' && chase?.subject ? <SubjectRow subject={chase.subject} /> : null}
              <div className="px-4 py-3">
                {chase ? <FormattedMessage text={chaseText} testId="chase-text" /> : <p className="text-sm text-fg-muted">Tick at least one item to write the message.</p>}
              </div>
              <ChaseNote className="border-t">
                Copying records chase {inquiry.chaseCount + 1} for this supplier. {rfqRef(rfq.number)} moves to Waiting and returns if still silent after {formatDay(returnsOn)}. It lists only the
                items this supplier has not priced, and never names the customer or our price.
              </ChaseNote>
              <div className="flex flex-wrap items-center gap-2 border-t bg-sunken px-4 py-3">
                <Button icon={Copy} disabled={!chase} onClick={() => void doChase()} busy={stamp.isPending} busyLabel="Marking chased" aria-label={`Copy & mark chased, ${inquiry.supplierName}`}>
                  Copy &amp; mark chased
                </Button>
              </div>
            </section>
          ) : null}
        </div>
      ) : null}
    </section>
  )
}
