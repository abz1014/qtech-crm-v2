import { useEffect, useId, useRef, useState } from 'react'
import { Check, ChevronDown, Copy, Pencil, Plus, Undo2 } from 'lucide-react'
import { useSeesPrices } from '@/app/session'
import { businessToday } from '@/lib/dates'
import { cn } from '@/lib/utils'
import { useMediaQuery } from '@/lib/useMediaQuery'
import { copyToClipboard } from '@/lib/clipboard'
import { mapPgError } from '@/lib/pgErrors'
import { rfqRef } from '@/lib/refs'
import { Button } from '@/ui/Button'
import { Icon } from '@/ui/Icon'
import { Select } from '@/ui/form/Select'
import { MessageActions } from '@/ui/MessageActions'
import { useToast } from '@/ui/useToast'
import type { InquiryRow, RfqHeader, RfqItemRow } from '@/features/rfqs/api'
import { DetailPanel } from '@/features/rfqs/DetailPanel'
import { ChannelLink } from '@/ui/ChannelLink'
import { ChasedByNote, ChaseNote, FormattedMessage, MoreToggle, RecipientRow, ReplyByField, SubjectRow, TickList } from '@/features/rfqs/ChaseParts'
import { useChooseSuppliers } from '@/features/rfqs/escalationLogic'
import { FloatElsewhere } from '@/features/rfqs/FloatElsewhere'
import { useRestoreSupplierChase, useSetInquiryNoOffer, useStampSupplierChase } from '@/features/rfqs/hooks'
import { useSignature } from '@/features/rfqs/useSignature'
import { useChannelPreference } from '@/lib/useChannelPreference'
import { awaitingReply, canChaseInquiry, jumpToReplyRow, outstandingItems } from '@/features/rfqs/replyFocus'
import { ReplyChip, SupplierReplyDialog } from '@/features/rfqs/SupplierReplies'
import { useReplyDialog } from '@/features/rfqs/useReplyDialog'
import { SentConfirm } from '@/features/rfqs/SentConfirm'
import {
  daysSince,
  generateSupplierChase,
  qtyText,
  reasonLabel,
  sentLine,
  supplierMemoryLine,
  supplierReplyBy,
  supplierReturnsOn,
  type EnquiryVariant,
  type RateTable,
  type SupplierFacts,
} from '@/features/rfqs/lib'
import { formatDay } from '@/lib/formatDay'

/*
 * "Suppliers asked" (g2-rfq-detail rail; UX audit 2026-10-19; grade-B R2, R3, R4 2026-10-22): every supplier asked, listed ONCE on
 * the page, with where each one stands and the one way in to their reply. Under each name: one chip (Priced 2 of 4, Waiting for
 * prices chased ×1, Can't quote, Not asked yet), when it was sent and a memory line from v_supplier_stats ("Replied 5 of 7,
 * usually ~2 days, now 5 days"; amber when the wait is longer than usual). "Enter reply" (or "Edit reply" once there is a price)
 * opens the reply dialog (SupplierReplies.tsx), which holds the prices, Paste reply and "Can't quote". A supplier who can't quote
 * shows the reason and Take back. An engineer (owner decision 2026-10-22: engineers see and write no prices) sees who replied and
 * who is waited on, and can chase, but has no Enter or Edit reply: the dialog is a price form and never opens for them.
 *
 * The chase (`chase`):
 *   card    the RFQ is waiting for prices: the first supplier still owing a price shows a short preview of the message and
 *           "Copy and mark chased", which copies the text and stamps the chase together (stamp_supplier_chase, 1 tap); the whole
 *           message (the items, the reply-by date, the recipient, an email's subject) opens under "Show the whole message". Every
 *           other supplier still owing a price has its own 1-tap "Chase".
 *   button  prices are in but someone still owes one: a 1-tap "Chase" on that supplier; no card unless "Show message" asks for
 *           it (open by itself it would compete with the green Issue quotation).
 *   none    a quotation went out, or the RFQ is won or closed: no chase at all.
 * The channel is the person's remembered one, with the other as a link under "Show the whole message". The text lists only the
 * items that supplier has not priced, and never names the customer or our price. From the second chase it asks for a "cannot
 * offer" today. While the card shows, the other suppliers have Enter reply and Chase only: the card's "Message for" picker
 * switches it to another supplier (one control instead of a "Show message" on every row; grade-A 9, at most ~25 actions).
 *
 * Phone (grade-A 6 fix 2): the page opens at the first supplier still without a reply (`jump`), and a supplier who has answered
 * (priced, or can't quote) is ONE line, the name and its chip, opening on a tap.
 */

export type ChaseMode = 'card' | 'button' | 'none'

interface Props {
  rfq: RfqHeader
  items: RfqItemRow[]
  inquiries: InquiryRow[]
  stats: Readonly<Record<string, SupplierFacts | undefined>> | undefined
  /** Today's rates, for the PKR preview while a price is typed in the reply dialog. */
  rates?: RateTable
  /** How much chase to show, by the RFQ's state (see above). */
  chase?: ChaseMode
  /** The chase is the page's one green action (waiting for prices, nothing else to do). */
  chaseIsMain?: boolean
  /** Phone: scroll to the first supplier still without a reply when the page opens (once). */
  jump?: boolean
  onFloat: () => void
}

export function SuppliersAsked({ rfq, items, inquiries, stats, rates = {}, chase = 'card', chaseIsMain = false, jump = false, onFloat }: Props) {
  const replied = inquiries.filter(i => i.lines.length > 0).length
  const chaseable = chase === 'none' ? [] : inquiries.filter(i => canChaseInquiry(i, items))
  const [picked, setPicked] = useState<string | null>(null)
  const [channel, setChannel] = useChannelPreference()
  // Waiting for prices: the first supplier to chase shows its card. Once prices are in, a card opens only on "Show message".
  const open = chaseable.find(i => i.id === picked) ?? (chase === 'card' ? chaseable[0] : undefined)
  const today = businessToday()
  const reply = useReplyDialog()
  // A reply is prices: an engineer has no Enter or Edit reply and the dialog never opens (owner decision 2026-10-22).
  const prices = useSeesPrices()
  const replying = prices && reply.open ?inquiries.find(i => i.id === reply.open?.inquiryId) : undefined
  const phone = useMediaQuery('(max-width: 767px)')
  // Phone: the answered suppliers opened by a tap (each starts as one line).
  const [unfolded, setUnfolded] = useState<ReadonlySet<string>>(new Set())
  const toggle = (id: string) =>
    setUnfolded(o => {
      const n = new Set(o)
      if (n.has(id)) n.delete(id)
      else n.add(id)
      return n
    })
  const firstAwaiting = inquiries.find(awaitingReply)?.supplierId
  const jumped = useRef<string | null>(null)
  useEffect(() => {
    if (!phone || !jump || !firstAwaiting || jumped.current === rfq.id) return
    jumped.current = rfq.id
    jumpToReplyRow(firstAwaiting)
  }, [phone, jump, firstAwaiting, rfq.id])

  return (
    <DetailPanel title="Suppliers asked" pill={`${inquiries.length} asked · ${replied} replied`} dataSlot="suppliers-asked">
      <ul>
        {inquiries.map(i => {
          const awaiting = Boolean(i.sentOn) && !i.noOfferOn && i.lines.length === 0
          const mem = supplierMemoryLine(stats?.[i.supplierId], awaiting && i.sentOn ? daysSince(i.sentOn, today) : null)
          const can = chase !== 'none' && canChaseInquiry(i, items)
          const declinedAll = Boolean(i.noOfferOn) && i.lines.length === 0
          const label = i.lines.length > 0 ? 'Edit reply' : 'Enter reply'
          // Phone: a supplier who has answered folds to one line (the name and its chip) until tapped.
          const foldable = phone && (i.lines.length > 0 || Boolean(i.noOfferOn)) && open?.id !== i.id
          const folded = foldable && !unfolded.has(i.id)
          const detailId = `supplier-asked-${i.id}`
          return (
            <li
              key={i.id}
              className="grid scroll-mt-20 gap-1 border-t px-5 py-3 first:border-t-0"
              data-supplier-asked={i.supplierId}
              data-reply-row={i.supplierId}
              data-folded={folded ? '' : undefined}
            >
              {foldable ? (
                <button
                  type="button"
                  aria-expanded={!folded}
                  aria-controls={folded ? undefined : detailId}
                  onClick={() => toggle(i.id)}
                  className="-my-2 flex min-h-touch w-full flex-wrap items-center gap-x-3 gap-y-1 rounded text-left"
                >
                  <b className="min-w-0 flex-1 basis-[10rem] break-words font-semibold">{i.supplierName}</b>
                  <ReplyChip inquiry={i} itemCount={items.length} />
                  <Icon icon={ChevronDown} className={cn('shrink-0 text-fg-muted transition-transform', !folded && 'rotate-180')} />
                </button>
              ) : (
                <div className="flex flex-wrap items-start gap-x-3 gap-y-1">
                  <b className="min-w-0 flex-1 basis-[10rem] break-words font-semibold">{i.supplierName}</b>
                  <ReplyChip inquiry={i} itemCount={items.length} />
                </div>
              )}
              {folded ? null : (
                  <div id={detailId} className="contents">
                    <p className="text-sm text-fg-muted">{sentLine(i)}</p>
                    {mem ? <p className={mem.late ? 'text-sm text-tone-warning-fg' : 'text-sm text-fg-muted'}>{mem.text}</p> : null}
                    <ChasedByNote byId={i.lastChasedBy} at={i.lastChasedOn} />
                    <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-2">
                      {declinedAll ? (
                        <TakeBack rfq={rfq} inquiry={i} />
                      ) : !prices ? null : (
                        <Button size="sm" icon={i.lines.length > 0 ? Pencil : Plus} onClick={() => reply.show(i.id)} aria-label={`${label}, ${i.supplierName}`}>
                          {label}
                        </Button>
                      )}
                      {awaiting && !i.sentConfirmedAt ? <SentConfirm rfqId={rfq.id} inquiry={i} variant="later" /> : null}
                      {can && open?.id !== i.id ? <ChaseNow rfq={rfq} items={items} inquiry={i} variant={channel} /> : null}
                      {/* While a card shows, its "Message for" picker reaches the others; with no card (prices in), each row offers it. */}
                      {can && !open ? (
                        <Button size="sm" variant="quiet" onClick={() => setPicked(i.id)} aria-label={`Show message, ${i.supplierName}`}>
                          Show message
                        </Button>
                      ) : null}
                    </div>
                    {open?.id === i.id ? (
                      <ChaseCard
                        rfq={rfq}
                        items={items}
                        inquiry={i}
                        inquiries={inquiries}
                        channel={channel}
                        onChannel={setChannel}
                        main={chaseIsMain}
                        others={chaseable}
                        onPick={setPicked}
                      />
                    ) : null}
                  </div>
              )}
            </li>
          )
        })}
      </ul>
      <div className="border-t px-5 py-3">
        <Button icon={Plus} onClick={onFloat}>
          Ask more suppliers
        </Button>
      </div>
      {replying ? (
        <SupplierReplyDialog
          key={`${replying.id}:${replying.lines.map(l => `${l.itemId}=${l.unitPrice}${l.currency}${l.leadTime}${l.inStock}`).join('|')}`}
          rfq={rfq}
          items={items}
          inquiry={replying}
          inquiries={inquiries}
          rates={rates}
          focusItemId={reply.open?.itemId}
          onClose={reply.close}
        />
      ) : null}
    </DetailPanel>
  )
}

/** "Can't quote: reason · date" and Take back, for a supplier who said no to everything. */
function TakeBack({ rfq, inquiry }: { rfq: RfqHeader; inquiry: InquiryRow }) {
  const { toast } = useToast()
  const noOffer = useSetInquiryNoOffer(rfq.id)
  const takeBack = async () => {
    try {
      await noOffer.mutateAsync({ inquiryId: inquiry.id, noOfferOn: null, reason: null })
    } catch (err) {
      toast({ title: "Could not take back can't quote", body: mapPgError(err).message, tone: 'danger' })
    }
  }
  return (
    <>
      <span className="text-sm text-fg-2">
        {"Can't quote"}
        {inquiry.noOfferReason ? `: ${reasonLabel(inquiry.noOfferReason)}` : ''}
        <span className="text-fg-muted">{` · ${formatDay(inquiry.noOfferOn as string)}`}</span>
      </span>
      <Button size="sm" variant="quiet" icon={Undo2} onClick={() => void takeBack()} busy={noOffer.isPending} aria-label={`Take back can't quote, ${inquiry.supplierName}`}>
        Take back
      </Button>
    </>
  )
}

/**
 * The chase for one supplier: the text for a channel, and the one action that copies it and stamps the chase together
 * (stamp_supplier_chase), with an Undo toast that takes the stamp back. Used by the chase card and by the "Chase" button on
 * every other supplier asked (FE-2: chase = 1 tap). The card can leave items out and change the reply-by date; the button never asks.
 */
function useSupplierChase(rfq: RfqHeader, items: RfqItemRow[], inquiry: InquiryRow, variant: EnquiryVariant, opts: { off?: ReadonlySet<string>; replyBy?: string | null } = {}) {
  const { toast } = useToast()
  const signature = useSignature()
  const stamp = useStampSupplierChase(rfq.id)
  const restore = useRestoreSupplierChase(rfq.id)
  const today = businessToday()
  const outstanding = outstandingItems(inquiry, items).filter(it => !opts.off?.has(it.id))
  const pricedNumbers = items.filter(it => inquiry.lines.some(l => l.itemId === it.id)).map(it => it.number)
  const make = (v: EnquiryVariant) =>
    outstanding.length === 0
      ? null
      : generateSupplierChase({
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
          ageDays: inquiry.sentOn ? daysSince(inquiry.sentOn, today) : null,
          replyByOverride: opts.replyBy ?? null,
        })
  // Both channels: Open in WhatsApp sends the WhatsApp text and Open in email the email one, whichever is shown.
  const both = { whatsapp: make('whatsapp'), email: make('email') }
  const chase = both[variant]
  // The clipboard gets the body: an email's subject has its own row and its own copy button.
  const text = chase ? chase.body : ''

  // The copy comes before the stamp, so the button is not busy yet while it runs: a double tap must not stamp two chases.
  const inFlight = useRef(false)
  const [copying, setCopying] = useState(false)
  const doChase = async () => {
    if (!chase || inFlight.current) return
    inFlight.current = true
    setCopying(true)
    try {
      await copyAndStamp()
    } finally {
      inFlight.current = false
      setCopying(false)
    }
  }
  /** After a WhatsApp / email link was opened: the separate "Mark chased" tap (opening never marks). */
  const markOnly = async () => {
    if (!chase || inFlight.current) return
    inFlight.current = true
    setCopying(true)
    try {
      await stampChase(false)
    } finally {
      inFlight.current = false
      setCopying(false)
    }
  }
  const copyAndStamp = async () => {
    if (!chase) return
    const ok = await copyToClipboard(text)
    if (!ok) {
      toast({ title: 'Could not copy the text', body: 'Show the whole message and copy it by hand. The chase was not recorded.', tone: 'danger' })
      return
    }
    await stampChase(true)
  }
  const stampChase = async (copied: boolean) => {
    const done = copied ? 'Chase text copied' : 'Marked chased'
    const before = { lastChasedOn: inquiry.lastChasedOn, lastChasedBy: inquiry.lastChasedBy ?? null, chaseCount: inquiry.chaseCount }
    try {
      const n = await stamp.mutateAsync(inquiry.id)
      toast({
        title: done,
        body: `${inquiry.supplierName} · chased ${n} ${n === 1 ? 'time' : 'times'}`,
        tone: 'success',
        undo: {
          onUndo: async () => {
            await restore.mutateAsync({ inquiryId: inquiry.id, before })
          },
          settledTitle: done,
          settledBody: `${rfqRef(rfq.number)} marked chased`,
          undoneTitle: 'Undone.',
          undoneBody: `${inquiry.supplierName} is not marked chased.`,
        },
      })
    } catch (err) {
      toast({ title: copied ? 'Copied, but the chase was not recorded' : 'The chase was not recorded', body: mapPgError(err).message, tone: 'danger' })
    }
  }

  return { chase, both, text, doChase, markOnly, busy: copying || stamp.isPending }
}

/** "Chase": 1 tap on any other supplier asked. Copies the text in the person's channel and marks the chase. */
function ChaseNow({ rfq, items, inquiry, variant }: { rfq: RfqHeader; items: RfqItemRow[]; inquiry: InquiryRow; variant: EnquiryVariant }) {
  const c = useSupplierChase(rfq, items, inquiry, variant)
  return (
    <Button size="sm" icon={Copy} onClick={() => void c.doChase()} busy={c.busy} busyLabel="Marking chased" aria-label={`Chase ${inquiry.supplierName}`}>
      Chase
    </Button>
  )
}

function ChaseCard({
  rfq,
  items,
  inquiry,
  inquiries,
  channel,
  onChannel,
  main,
  others = [],
  onPick,
}: {
  rfq: RfqHeader
  items: RfqItemRow[]
  inquiry: InquiryRow
  inquiries: InquiryRow[]
  channel: EnquiryVariant
  onChannel: (v: EnquiryVariant) => void
  main: boolean
  /** Every supplier who can be chased (this one among them): the "Message for" picker, when there are two or more. */
  others?: readonly InquiryRow[]
  onPick?: (inquiryId: string) => void
}) {
  const choose = useChooseSuppliers(rfq, inquiries)
  const [off, setOff] = useState<ReadonlySet<string>>(new Set())
  const [chosen, setChosen] = useState<string | null>(null)
  const [dismissed, setDismissed] = useState(false)
  const [whole, setWhole] = useState(false)
  const [opened, setOpened] = useState(false)
  const wholeId = useId()
  const today = businessToday()
  // The header's "Chase" jump focuses [data-chase-copy]: that stays on the card's first action (the remembered channel's Open, or Copy).
  const actionsRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = actionsRef.current
    if (!el) return
    el.querySelectorAll('[data-chase-copy]').forEach(b => b.removeAttribute('data-chase-copy'))
    el.querySelector('button:not([disabled])')?.setAttribute('data-chase-copy', '')
  })
  const { chase, both, doChase, markOnly, busy, text } = useSupplierChase(rfq, items, inquiry, channel, { off, replyBy: chosen })
  const outstandingAll = outstandingItems(inquiry, items)
  const defaultBy = supplierReplyBy(rfq.dueOn, today) ?? today
  const returnsOn = supplierReturnsOn(today, rfq.dueOn)
  const recipient = inquiry.contactName
    ? { name: inquiry.contactTitle ? `${inquiry.contactName}, ${inquiry.contactTitle}` : inquiry.contactName, phone: inquiry.contactPhone, email: inquiry.contactEmail }
    : null

  return (
    <div className="mt-2 grid grid-cols-[minmax(0,1fr)] gap-3" data-chase-card={inquiry.supplierId}>
      {inquiry.chaseCount >= 2 && !dismissed ? (
        <FloatElsewhere
          supplierName={inquiry.supplierName}
          items={outstandingAll}
          // Everyone already asked, and the customer the RFQ is for (a company can be both): neither is someone else to ask.
          askedIds={new Set([...inquiries.map(i => i.supplierId), rfq.company.id])}
          today={today}
          busy={choose.busy}
          onChoose={input => void choose.choose(input)}
          onChaseAgain={() => setDismissed(true)}
        />
      ) : null}
      <div role="group" aria-label={`Chase ${inquiry.supplierName}`} className="grid grid-cols-[minmax(0,1fr)] overflow-hidden rounded-panel border bg-surface">
        <RecipientRow channel={channel} lead={channel === 'email' ? 'Email to' : 'WhatsApp to'} contact={recipient} />
        {whole ? (
          <div id={wholeId} className="grid">
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
                    checked: !priced && !off.has(it.id),
                    disabled: priced,
                    note: priced ? 'priced' : undefined,
                  }
                })}
              onToggle={(id, on) =>
                setOff(o => {
                  const n = new Set(o)
                  if (on) n.delete(id)
                  else n.add(id)
                  return n
                })
              }
            />
            <ReplyByField
              label="Reply by"
              value={chosen ?? defaultBy}
              onChange={v => setChosen(v && v !== defaultBy ? v : null)}
              note={`${rfq.dueOn ? 'Two working days before our quotation is due.' : 'Three working days from today.'} You can change it.`}
            />
            {channel === 'email' && chase?.subject ? <SubjectRow subject={chase.subject} /> : null}
          </div>
        ) : null}
        <div className="px-4 py-3">
          {chase ? (
            <FormattedMessage text={text} testId="chase-text" chaseText className={whole ? undefined : 'line-clamp-3'} />
          ) : (
            <p className="text-sm text-fg-muted">Tick at least one item to write the message.</p>
          )}
        </div>
        {whole ? (
          <ChaseNote className="border-t">
            Copying records chase {inquiry.chaseCount + 1} for this supplier. {rfqRef(rfq.number)} moves to Waiting and returns if still silent after {formatDay(returnsOn)}. It lists only the
            items this supplier has not priced, and never names the customer or our price.
          </ChaseNote>
        ) : null}
        <div className="grid gap-2 border-t bg-sunken px-4 py-3">
          <div ref={actionsRef} className="flex flex-wrap items-start gap-2">
            {both.whatsapp && both.email ? (
              <MessageActions
                to={recipient ?? { name: inquiry.supplierName }}
                text={both.whatsapp.body}
                email={{ subject: both.email.subject, body: both.email.body }}
                variant={main && !opened ? 'primary' : 'secondary'}
                copy={{ label: 'Copy and mark chased', onCopy: doChase, busy, busyLabel: 'Marking chased' }}
                onOpen={() => setOpened(true)}
                channel={channel}
                onChannelChange={onChannel}
              />
            ) : (
              <Button variant={main ? 'primary' : 'secondary'} icon={Copy} disabled className="w-fit">
                Copy and mark chased
              </Button>
            )}
            {opened && chase ? (
              <Button
                variant="primary"
                icon={Check}
                busy={busy}
                busyLabel="Marking chased"
                onClick={() => {
                  setOpened(false)
                  void markOnly()
                }}
              >
                Mark chased
              </Button>
            ) : null}
          </div>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
            <MoreToggle open={whole} onToggle={() => setWhole(w => !w)} controls={wholeId} />
            {/* The other channel is a rare switch: it waits with the whole message (both Open buttons already show). */}
            {whole ? <ChannelLink value={channel} onChange={onChannel} /> : null}
            <span className="text-sm text-fg-muted">{inquiry.chaseCount === 0 ? 'Not chased yet' : `Chased ${inquiry.chaseCount === 1 ? 'once' : `${inquiry.chaseCount} times`} already`}</span>
          </div>
          {others.length > 1 && onPick ? (
            <label className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-fg-2">
              <span>Message for</span>
              <Select
                className="w-auto min-w-[12rem]"
                value={inquiry.id}
                onChange={e => onPick(e.target.value)}
                options={others.map(o => ({ value: o.id, label: o.supplierName }))}
              />
            </label>
          ) : null}
        </div>
      </div>
    </div>
  )
}
