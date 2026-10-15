import { useState } from 'react'
import { Copy, Mail, Phone, Plus } from 'lucide-react'
import { businessToday } from '@/lib/dates'
import { copyToClipboard } from '@/lib/clipboard'
import { mapPgError } from '@/lib/pgErrors'
import { rfqRef } from '@/lib/refs'
import { useSession } from '@/app/session'
import { Button } from '@/ui/Button'
import { Icon } from '@/ui/Icon'
import { SegmentedControl } from '@/ui/SegmentedControl'
import { StatusBadge } from '@/ui/StatusBadge'
import { useToast } from '@/ui/useToast'
import type { InquiryRow, RfqHeader, RfqItemRow } from '@/features/rfqs/api'
import { DetailPanel } from '@/features/rfqs/DetailPanel'
import { useMySignature, useStampSupplierChase } from '@/features/rfqs/hooks'
import { canChaseInquiry, outstandingItems } from '@/features/rfqs/replyFocus'
import { daysSince, generateSupplierChase, sentLine, supplierMemoryLine, type EnquiryVariant, type SupplierFacts } from '@/features/rfqs/lib'

/*
 * "Suppliers asked" (g2-rfq-detail rail): who was asked, what they answered, what we know about them, and the chase.
 * Under each name: the status chips (Chased x1, Quoted 2 of 4), a memory line from v_supplier_stats ("Replied 5 of 7, usually ~2
 * days, now 5 days"; amber when the wait is longer than usual) and when it was sent and answered. The supplier to chase has its
 * chase card open under its entry: WhatsApp or Email, the recipient, the full text, and "Copy and mark chased", which copies the
 * text and stamps the chase together (stamp_supplier_chase, 1 tap). The text lists only the items that supplier has not priced,
 * and never names the customer or our price. From the second chase it asks for a "cannot offer" today.
 */

interface Props {
  rfq: RfqHeader
  items: RfqItemRow[]
  inquiries: InquiryRow[]
  stats: Readonly<Record<string, SupplierFacts | undefined>> | undefined
  onFloat: () => void
}

export function SuppliersAsked({ rfq, items, inquiries, stats, onFloat }: Props) {
  const replied = inquiries.filter(i => i.lines.length > 0).length
  const chaseable = inquiries.filter(i => canChaseInquiry(i, items))
  const [picked, setPicked] = useState<string | null>(null)
  const open = chaseable.find(i => i.id === picked) ?? chaseable[0]
  const today = businessToday()

  return (
    <DetailPanel
      title="Suppliers asked"
      pill={`${inquiries.length} asked · ${replied} replied`}
      dataSlot="suppliers-asked"
    >
      <ul>
        {inquiries.map(i => {
          const awaiting = Boolean(i.sentOn) && !i.noOfferOn && i.lines.length === 0
          const mem = supplierMemoryLine(stats?.[i.supplierId], awaiting && i.sentOn ? daysSince(i.sentOn, today) : null)
          const can = canChaseInquiry(i, items)
          return (
            <li key={i.id} className="grid gap-1 border-t px-5 py-3 first:border-t-0" data-supplier-asked={i.supplierId}>
              <div className="flex flex-wrap items-start gap-x-3 gap-y-1">
                <b className="min-w-0 flex-1 basis-40 break-words text-sm font-semibold">{i.supplierName}</b>
                <span className="flex flex-wrap items-center gap-1">
                  {i.chaseCount > 0 && i.lines.length === 0 ? <StatusBadge dimension="inquiry" value="chased" detail={`×${i.chaseCount}`} /> : null}
                  {i.lines.length > 0 ? (
                    <StatusBadge dimension="inquiry" value="quoted" detail={`${i.lines.length} of ${items.length}`} />
                  ) : i.noOfferOn ? (
                    <StatusBadge dimension="inquiry" value="no-offer" />
                  ) : !i.sentOn ? (
                    <StatusBadge dimension="inquiry" value="shortlisted" />
                  ) : i.chaseCount === 0 ? (
                    <StatusBadge dimension="inquiry" value="awaiting" />
                  ) : null}
                </span>
              </div>
              {mem ? <p className={mem.late ? 'text-xs text-tone-warning-fg' : 'text-xs text-fg-muted'}>{mem.text}</p> : null}
              <p className="text-xs text-fg-muted">{sentLine(i)}</p>
              {can && open?.id !== i.id ? (
                <div>
                  <Button size="sm" variant="quiet" onClick={() => setPicked(i.id)} aria-label={`Chase ${i.supplierName}`}>
                    Chase
                  </Button>
                </div>
              ) : null}
              {open?.id === i.id ? <ChaseCard rfq={rfq} items={items} inquiry={i} /> : null}
            </li>
          )
        })}
      </ul>
      <div className="border-t px-5 py-3">
        <Button icon={Plus} onClick={onFloat}>
          Float to another supplier
        </Button>
      </div>
    </DetailPanel>
  )
}

function ChaseCard({ rfq, items, inquiry }: { rfq: RfqHeader; items: RfqItemRow[]; inquiry: InquiryRow }) {
  const { toast } = useToast()
  const session = useSession()
  const user = session.status === 'signed-in' ? session.user : null
  const stamp = useStampSupplierChase(rfq.id)
  const mine = useMySignature(user?.id)
  const [variant, setVariant] = useState<EnquiryVariant>('whatsapp')
  const outstanding = outstandingItems(inquiry, items)
  const pricedNumbers = items.filter(it => inquiry.lines.some(l => l.itemId === it.id)).map(it => it.number)
  const chase = generateSupplierChase({
    rfqRef: rfqRef(rfq.number),
    sentOn: inquiry.sentOn,
    dueOn: rfq.dueOn,
    today: businessToday(),
    chaseCount: inquiry.chaseCount,
    contactName: inquiry.contactName,
    pricedNumbers,
    items: outstanding.map(it => ({ number: it.number, description: it.description, brandName: it.brandName, qty: it.qty, unit: it.unit })),
    signature: { name: user?.name ?? 'Q-Tech Solutions', company: 'Q-Tech Solutions', jobTitle: mine.data?.jobTitle, phone: mine.data?.phone },
    variant,
  })
  const text = chase.subject ? `Subject: ${chase.subject}\n\n${chase.body}` : chase.body

  const doChase = async () => {
    const ok = await copyToClipboard(text)
    if (!ok) {
      toast({ title: 'Could not copy the text', body: 'Copy it by hand from the card. The chase was not recorded.', tone: 'danger' })
      return
    }
    try {
      const n = await stamp.mutateAsync(inquiry.id)
      toast({ title: 'Chase text copied', body: `${inquiry.supplierName} · chased ${n} ${n === 1 ? 'time' : 'times'}`, tone: 'success' })
    } catch (err) {
      toast({ title: 'Copied, but the chase was not recorded', body: mapPgError(err).message, tone: 'danger' })
    }
  }

  const recipient =
    variant === 'whatsapp'
      ? { icon: Phone, text: [inquiry.contactTitle ? `${inquiry.contactName}, ${inquiry.contactTitle}` : inquiry.contactName, inquiry.contactPhone].filter(Boolean).join('  ') }
      : { icon: Mail, text: [inquiry.contactTitle ? `${inquiry.contactName}, ${inquiry.contactTitle}` : inquiry.contactName, inquiry.contactEmail].filter(Boolean).join('  ') }

  return (
    <div className="mt-2 grid gap-3 rounded border bg-surface p-3" data-chase-card={inquiry.supplierId} aria-label={`Chase ${inquiry.supplierName}`} role="group">
      <div className="flex flex-wrap items-center gap-2">
        <b className="min-w-0 flex-1 basis-40 text-sm font-semibold">{`Chase ${inquiry.supplierName}`}</b>
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
      <p className="flex items-center gap-2 text-xs text-fg-muted">
        <Icon icon={recipient.icon} size="sm" />
        <span className="num min-w-0 break-words">{recipient.text || (variant === 'whatsapp' ? 'No phone number on file' : 'No email address on file')}</span>
      </p>
      <pre className="m-0 whitespace-pre-wrap break-words rounded bg-sunken p-3 font-sans text-sm text-fg-2" data-chase-text>
        {text}
      </pre>
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="primary" icon={Copy} onClick={() => void doChase()} busy={stamp.isPending} busyLabel="Marking chased">
          Copy and mark chased
        </Button>
        <span className="text-xs text-fg-muted">
          {inquiry.chaseCount === 0 ? 'Not chased yet' : `Chased ${inquiry.chaseCount === 1 ? 'once' : `${inquiry.chaseCount} times`} already`}
        </span>
      </div>
    </div>
  )
}
