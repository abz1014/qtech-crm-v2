import { useId, useRef, useState } from 'react'
import { Copy, Plus } from 'lucide-react'
import { businessToday } from '@/lib/dates'
import { copyToClipboard } from '@/lib/clipboard'
import { mapPgError } from '@/lib/pgErrors'
import { rfqRef } from '@/lib/refs'
import { Button } from '@/ui/Button'
import { StatusBadge } from '@/ui/StatusBadge'
import { useToast } from '@/ui/useToast'
import type { InquiryRow, RfqHeader, RfqItemRow } from '@/features/rfqs/api'
import { DetailPanel } from '@/features/rfqs/DetailPanel'
import { ChannelLink, ChasedByNote, ChaseNote, FormattedMessage, MoreToggle, RecipientRow, ReplyByField, SubjectRow, TickList } from '@/features/rfqs/ChaseParts'
import { useChooseSuppliers } from '@/features/rfqs/escalationLogic'
import { FloatElsewhere } from '@/features/rfqs/FloatElsewhere'
import { useRestoreSupplierChase, useStampSupplierChase } from '@/features/rfqs/hooks'
import { useSignature } from '@/features/rfqs/useSignature'
import { useChannelPreference } from '@/lib/useChannelPreference'
import { canChaseInquiry, outstandingItems } from '@/features/rfqs/replyFocus'
import { daysSince, generateSupplierChase, qtyText, sentLine, supplierMemoryLine, supplierReplyBy, supplierReturnsOn, type EnquiryVariant, type SupplierFacts } from '@/features/rfqs/lib'
import { formatDay } from '@/lib/formatDay'

/*
 * "Suppliers asked" (g2-rfq-detail rail; UX audit 2026-10-19): who was asked and where each one stands, as a list, with the chase.
 * Under each name: one chip (Quoted 2 of 4, Chased x1, ...), a memory line from v_supplier_stats ("Replied 5 of 7, usually ~2 days,
 * now 5 days"; amber when the wait is longer than usual) and when it was sent. The supplier to chase shows a short preview of the
 * message and "Copy and mark chased", which copies the text and stamps the chase together (stamp_supplier_chase, 1 tap); the whole
 * message (the items it asks for, the reply-by date, the recipient, an email's subject) opens under "Show the whole message", so the
 * side column stays shorter than the page beside it. Every other supplier still owing a price has its own 1-tap "Chase". The
 * channel is the person's remembered one, with the other as a link. The text lists only the items that supplier has not priced,
 * and never names the customer or our price. From the second chase it asks for a "cannot offer" today.
 * "Copy and mark chased" is the page's green button only while the RFQ is waiting for prices (lib/nextAction.ts).
 */

interface Props {
  rfq: RfqHeader
  items: RfqItemRow[]
  inquiries: InquiryRow[]
  stats: Readonly<Record<string, SupplierFacts | undefined>> | undefined
  /** The chase is the page's one green action (waiting for prices, nothing else to do). */
  chaseIsMain?: boolean
  onFloat: () => void
}

export function SuppliersAsked({ rfq, items, inquiries, stats, chaseIsMain = false, onFloat }: Props) {
  const replied = inquiries.filter(i => i.lines.length > 0).length
  const chaseable = inquiries.filter(i => canChaseInquiry(i, items))
  const [picked, setPicked] = useState<string | null>(null)
  const [channel, setChannel] = useChannelPreference()
  const open = chaseable.find(i => i.id === picked) ?? chaseable[0]
  const today = businessToday()

  return (
    <DetailPanel title="Suppliers asked" pill={`${inquiries.length} asked · ${replied} replied`} dataSlot="suppliers-asked">
      <ul>
        {inquiries.map(i => {
          const awaiting = Boolean(i.sentOn) && !i.noOfferOn && i.lines.length === 0
          const mem = supplierMemoryLine(stats?.[i.supplierId], awaiting && i.sentOn ? daysSince(i.sentOn, today) : null)
          const can = canChaseInquiry(i, items)
          return (
            <li key={i.id} className="grid gap-1 border-t px-5 py-3 first:border-t-0" data-supplier-asked={i.supplierId}>
              <div className="flex flex-wrap items-start gap-x-3 gap-y-1">
                <b className="min-w-0 flex-1 basis-[10rem] break-words font-semibold">{i.supplierName}</b>
                {i.lines.length > 0 ? (
                  <StatusBadge dimension="inquiry" value="quoted" detail={`${i.lines.length} of ${items.length}`} />
                ) : i.noOfferOn ? (
                  <StatusBadge dimension="inquiry" value="no-offer" label="Can't quote" />
                ) : !i.sentOn ? (
                  <StatusBadge dimension="inquiry" value="shortlisted" label="Not asked yet" />
                ) : i.chaseCount > 0 ? (
                  <StatusBadge dimension="inquiry" value="chased" detail={`×${i.chaseCount}`} />
                ) : (
                  <StatusBadge dimension="inquiry" value="awaiting" />
                )}
              </div>
              <p className="text-sm text-fg-muted">{sentLine(i)}</p>
              {mem ? <p className={mem.late ? 'text-sm text-tone-warning-fg' : 'text-sm text-fg-muted'}>{mem.text}</p> : null}
              <ChasedByNote byId={i.lastChasedBy} at={i.lastChasedOn} />
              {can && open?.id !== i.id ? (
                <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                  <ChaseNow rfq={rfq} items={items} inquiry={i} variant={channel} />
                  <Button size="sm" variant="quiet" onClick={() => setPicked(i.id)} aria-label={`Show message, ${i.supplierName}`}>
                    Show message
                  </Button>
                </div>
              ) : null}
              {open?.id === i.id ? <ChaseCard rfq={rfq} items={items} inquiry={i} inquiries={inquiries} channel={channel} onChannel={setChannel} main={chaseIsMain} /> : null}
            </li>
          )
        })}
      </ul>
      <div className="border-t px-5 py-3">
        <Button icon={Plus} onClick={onFloat}>
          Ask more suppliers
        </Button>
      </div>
    </DetailPanel>
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
  const chase =
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
          variant,
          ageDays: inquiry.sentOn ? daysSince(inquiry.sentOn, today) : null,
          replyByOverride: opts.replyBy ?? null,
        })
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
  const copyAndStamp = async () => {
    if (!chase) return
    const ok = await copyToClipboard(text)
    if (!ok) {
      toast({ title: 'Could not copy the text', body: 'Show the whole message and copy it by hand. The chase was not recorded.', tone: 'danger' })
      return
    }
    const before = { lastChasedOn: inquiry.lastChasedOn, lastChasedBy: inquiry.lastChasedBy ?? null, chaseCount: inquiry.chaseCount }
    try {
      const n = await stamp.mutateAsync(inquiry.id)
      toast({
        title: 'Chase text copied',
        body: `${inquiry.supplierName} · chased ${n} ${n === 1 ? 'time' : 'times'}`,
        tone: 'success',
        undo: {
          onUndo: async () => {
            await restore.mutateAsync({ inquiryId: inquiry.id, before })
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

  return { chase, text, doChase, busy: copying || stamp.isPending }
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
}: {
  rfq: RfqHeader
  items: RfqItemRow[]
  inquiry: InquiryRow
  inquiries: InquiryRow[]
  channel: EnquiryVariant
  onChannel: (v: EnquiryVariant) => void
  main: boolean
}) {
  const choose = useChooseSuppliers(rfq, inquiries)
  const [off, setOff] = useState<ReadonlySet<string>>(new Set())
  const [chosen, setChosen] = useState<string | null>(null)
  const [dismissed, setDismissed] = useState(false)
  const [whole, setWhole] = useState(false)
  const wholeId = useId()
  const today = businessToday()
  const { chase, doChase, busy, text } = useSupplierChase(rfq, items, inquiry, channel, { off, replyBy: chosen })
  const outstandingAll = outstandingItems(inquiry, items)
  const defaultBy = supplierReplyBy(rfq.dueOn, today) ?? today
  const returnsOn = supplierReturnsOn(today, rfq.dueOn)
  const recipient = inquiry.contactName
    ? { name: inquiry.contactTitle ? `${inquiry.contactName}, ${inquiry.contactTitle}` : inquiry.contactName, phone: inquiry.contactPhone, email: inquiry.contactEmail }
    : null

  return (
    <div className="mt-2 grid gap-3" data-chase-card={inquiry.supplierId}>
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
      <div role="group" aria-label={`Chase ${inquiry.supplierName}`} className="grid overflow-hidden rounded border bg-surface">
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
          <Button variant={main ? 'primary' : 'secondary'} icon={Copy} disabled={!chase} onClick={() => void doChase()} busy={busy} busyLabel="Marking chased" className="w-fit">
            Copy and mark chased
          </Button>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
            <MoreToggle open={whole} onToggle={() => setWhole(w => !w)} controls={wholeId} />
            <ChannelLink value={channel} onChange={onChannel} />
            <span className="text-sm text-fg-muted">{inquiry.chaseCount === 0 ? 'Not chased yet' : `Chased ${inquiry.chaseCount === 1 ? 'once' : `${inquiry.chaseCount} times`} already`}</span>
          </div>
        </div>
      </div>
    </div>
  )
}
