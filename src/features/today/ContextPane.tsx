import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { BellOff, CalendarDays, Check, CircleCheck, Copy, ExternalLink, Phone, TriangleAlert } from 'lucide-react'
import { useSession } from '@/app/session'
import { mapPgError } from '@/lib/pgErrors'
import { copyToClipboard } from '@/lib/clipboard'
import { businessToday } from '@/lib/dates'
import { formatAmount } from '@/lib/money'
import { formatDay } from '@/lib/formatDay'
import { cn } from '@/lib/utils'
import { deadlineValue } from '@/lib/status'
import { Banner } from '@/ui/Banner'
import { Breadcrumb } from '@/ui/Breadcrumb'
import { Button } from '@/ui/Button'
import { DateRail } from '@/ui/DateRail'
import { Dialog, DialogContent } from '@/ui/Dialog'
import { DateInput } from '@/ui/form/DateInput'
import { Icon } from '@/ui/Icon'
import { MenuItem, Popover, PopoverClose, PopoverContent, PopoverTrigger } from '@/ui/Popover'
import { SegmentedControl } from '@/ui/SegmentedControl'
import { Skeleton } from '@/ui/Skeleton'
import { StatusBadge } from '@/ui/StatusBadge'
import { useToast } from '@/ui/useToast'
import { useRfqHeader, useRfqInquiries, useRfqItems, useSetRfqClosed } from '@/features/rfqs/hooks'
import { chaseClipboardText, COMPANY_NAME } from '@/features/rfqs/lib'
import { addDays, nextMonday } from '@/features/rfqs/lib/dateText'
import type { TodayData } from '@/features/today/api'
import { buildCustomerDraft, buildGoodsDraft, buildPaymentDraft, buildSupplierDraft, type Draft } from '@/features/today/chaseDraft'
import { performChase, useLegDraft, usePaymentDraft, useRefreshAfterChase, useSnooze, useUnsnooze, type ChaseSpec } from '@/features/today/hooks'
import { SNOOZE_RULE, type TodayItem } from '@/features/today/types'
import { agoText, distanceText, waitingLine } from '@/features/today/text'

/*
 * The context pane (direction B). Selecting a row shows the facts that explain it and, for a chase, the message already
 * written: "Copy message and mark chased" is ONE tap (copies, stamps, then a 10 s Undo toast; the row moves to Waiting
 * when the window closes). Snooze is optional; Open goes to the record. Nothing is typed.
 */
interface PaneProps {
  item: TodayItem
  data: TodayData
  today: string
  /** Keys of items copied inside the undo window: they stay in place, marked "Copied", until the window closes. */
  copied: ReadonlySet<string>
  onCopied: (key: string) => void
  onReleased: (key: string) => void
}

interface Fact {
  label: string
  value: string
  sub?: string
  tone?: 'warning' | 'danger'
}

export function ContextPane({ item, data, today, copied, onCopied, onReleased }: PaneProps) {
  const session = useSession()
  const user = session.status === 'signed-in' ? session.user : null
  const navigate = useNavigate()
  const { toast } = useToast()
  const refresh = useRefreshAfterChase()
  const [channel, setChannel] = useState<'whatsapp' | 'email'>('whatsapp')
  const [busy, setBusy] = useState(false)
  const [full, setFull] = useState(false)
  const isRfq = Boolean(item.rfqId)
  const header = useRfqHeader(isRfq ? item.rfqId : undefined)
  const supplierRule = item.rule === 'chase_supplier'
  const items = useRfqItems(supplierRule ? item.rfqId : undefined)
  const inquiries = useRfqInquiries(supplierRule ? item.rfqId : undefined)
  const leg = useLegDraft(item.rule === 'goods_late' ? item.legId : undefined)
  const isMoney = user?.role === 'admin' || user?.role === 'sales'
  const payment = usePaymentDraft(item.rule === 'payment_overdue' ? item.orderId : undefined, Boolean(isMoney))

  const rfq = data.rfqs.find(r => r.id === item.rfqId)
  const questions = useMemo(() => data.clarifications.filter(c => c.rfqId === item.rfqId), [data.clarifications, item.rfqId])
  const inquiryFact = data.inquiries.find(i => i.id === item.inquiryId)
  const legFact = data.legs.find(l => l.id === item.legId)
  const receivable = data.receivables.find(r => r.orderId === item.orderId)
  const signature = { name: user?.name ?? COMPANY_NAME, company: COMPANY_NAME, jobTitle: data.jobTitle }

  const draftReady =
    item.rule === 'chase_customer'
      ? Boolean(rfq) && !header.isPending
      : item.rule === 'chase_supplier'
        ? Boolean(rfq) && Boolean(items.data) && Boolean(inquiries.data)
        : item.rule === 'goods_late'
          ? Boolean(legFact) && Boolean(leg.data)
          : item.rule === 'payment_overdue'
            ? Boolean(receivable) && Boolean(payment.data)
            : false

  const draft: Draft | null = useMemo(() => {
    if (!draftReady) return null
    if (item.rule === 'chase_customer' && rfq) return buildCustomerDraft({ rfq, contact: header.data?.contact ?? null, questions, today, signature })
    if (item.rule === 'chase_supplier' && rfq && items.data && inquiries.data) {
      const inquiry = inquiries.data.find(i => i.id === item.inquiryId)
      return inquiry ? buildSupplierDraft({ rfq, inquiry, items: items.data, today, signature }) : null
    }
    if (item.rule === 'goods_late' && legFact && leg.data) return buildGoodsDraft({ leg: legFact, data: leg.data, today, signature })
    if (item.rule === 'payment_overdue' && receivable && payment.data) return buildPaymentDraft({ receivable, data: payment.data, today, signature })
    return null
    // signature is rebuilt from user and data each render; its parts are the dependencies
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftReady, item.rule, item.inquiryId, rfq, header.data, questions, items.data, inquiries.data, legFact, leg.data, receivable, payment.data, today, user?.name, data.jobTitle])

  const wasCopied = copied.has(item.key)
  const verb = item.rule === 'payment_overdue' ? 'reminded' : 'chased'
  const text = draft ? chaseClipboardText(channel === 'email' ? draft.email : draft.whatsapp) : ''

  const spec = (): ChaseSpec | null => {
    if (item.rule === 'chase_customer') return questions.length ? { kind: 'customer', ids: questions.map(q => q.id) } : null
    if (item.rule === 'chase_supplier' && inquiryFact) return { kind: 'supplier', inquiryId: inquiryFact.id, before: { lastChasedOn: inquiryFact.lastChasedOn, chaseCount: inquiryFact.chaseCount } }
    if (item.rule === 'goods_late' && legFact) return { kind: 'goods', legId: legFact.id, before: { lastChasedOn: legFact.lastChasedOn, chaseCount: legFact.chaseCount } }
    if (item.rule === 'payment_overdue' && payment.data && payment.data.invoices.length > 0) {
      return { kind: 'payment', invoiceIds: payment.data.invoices.map(i => i.id), before: payment.data.invoices }
    }
    return null
  }

  const copyAndMark = async () => {
    if (!draft || busy) return
    setBusy(true)
    try {
      // The copy is the first thing that happens inside the tap (a browser only allows it during the gesture).
      const ok = await copyToClipboard(text)
      if (!ok) {
        toast({ title: 'Could not copy the message', body: 'Select the text in the draft and copy it by hand. Nothing was marked.', tone: 'danger' })
        return
      }
      const s = spec()
      if (!s) {
        toast({ title: 'Copied', body: item.rule === 'payment_overdue' ? 'This order has no invoice to mark as reminded yet.' : 'Nothing to mark.', tone: 'neutral' })
        return
      }
      try {
        const r = await performChase(s)
        onCopied(item.key)
        toast({
          title: `Copied. ${item.ref} marked ${verb}.`,
          body: item.party,
          tone: 'success',
          undo: {
            seconds: 10,
            onUndo: async () => {
              try {
                await r.undo()
              } finally {
                onReleased(item.key)
                void refresh()
              }
            },
            onSettle: () => {
              void refresh().finally(() => onReleased(item.key))
            },
            settledTitle: `${item.ref} marked ${verb}`,
            settledBody: 'It moves to Waiting and comes back on its date.',
            undoneTitle: 'Undone.',
            undoneBody: `${item.ref} is not marked ${verb}.`,
          },
        })
      } catch (err) {
        toast({ title: 'Copied, but it was not marked', body: mapPgError(err).message, tone: 'danger' })
      }
    } finally {
      setBusy(false)
    }
  }

  const facts = factsFor(item, { rfq, questions, inquiryFact, legFact, receivable, today, pricedOf: priced(items.data, inquiries.data, item.inquiryId) })
  const hs = header.data?.state
  const deadline = hs ? deadlineValue(hs.days_to_due, Boolean(hs.is_overdue)) : null

  return (
    <section aria-label={`${item.title}, ${item.ref}`} className="grid content-start gap-4">
      <header className="grid gap-1">
        <Breadcrumb className="mb-1 hidden md:block" items={[{ label: 'Today', to: '/today' }, { label: item.ref, mono: true }]} />
        <h2 className="text-xl font-semibold tracking-snug">{item.waiting ? (item.waitingTitle ?? item.title) : item.title}</h2>
        <p className="text-sm text-fg-2">
          <span className="num">{item.ref}</span> · {item.party}
          {rfq?.customerRef ? <> · customer ref {rfq.customerRef}</> : null}
        </p>
        {hs ? (
          <div className="mt-1 flex flex-wrap gap-2">
            {hs.clarification_state && hs.clarification_state !== 'none' ? <StatusBadge dimension="clarification" value={hs.clarification_state} /> : null}
            {deadline ? <StatusBadge dimension="deadline" value={deadline} /> : null}
            {hs.sourcing_state ? <StatusBadge dimension="sourcing" value={hs.sourcing_state} /> : null}
          </div>
        ) : null}
      </header>

      {item.waiting ? (
        <Banner tone="info" title={waitingLine(item.waiting.chasedOn, item.waiting.nextNudgeOn, today, verb)}>
          It is in Waiting and returns to the list on that day. You can still copy the message again.
        </Banner>
      ) : null}

      {facts.length > 0 ? (
        <dl className="grid grid-cols-2 overflow-hidden rounded border bg-surface lg:grid-cols-4">
          {facts.map(f => (
            <div key={f.label} className="grid content-start gap-0.5 border-b border-r p-3 last:border-r-0 [&:nth-child(2n)]:border-r-0 lg:[&:nth-child(2n)]:border-r lg:[&:nth-child(4n)]:border-r-0">
              <dt className="text-xs text-fg-muted">{f.label}</dt>
              <dd className={cn('num text-base font-medium', f.tone === 'warning' && 'text-tone-warning-fg', f.tone === 'danger' && 'text-tone-danger-fg')}>{f.value}</dd>
              {f.sub ? <dd className="text-xs text-fg-muted">{f.sub}</dd> : null}
            </div>
          ))}
        </dl>
      ) : null}

      <ChaseRail item={item} rfqDue={rfq?.dueOn ?? null} questions={questions} inquirySent={inquiryFact?.sentOn ?? null} today={today} />

      {item.escalation ? <Escalation item={item} today={today} /> : null}

      {draft ? (
        <div className="grid overflow-hidden rounded border bg-surface">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b px-4 py-3">
            <div className="grid gap-px">
              <h3 className="text-base font-semibold">Prepared for you</h3>
              <p className="text-sm text-fg-muted">Written from what is on record. Edit anything before you send.</p>
            </div>
            <SegmentedControl
              aria-label="Message channel"
              value={channel}
              onValueChange={v => setChannel(v as 'whatsapp' | 'email')}
              options={[
                { value: 'whatsapp', label: 'WhatsApp' },
                { value: 'email', label: 'Email' },
              ]}
            />
          </div>
          {wasCopied ? (
            <p role="status" className="flex items-center gap-2 bg-tone-success-bg px-4 py-2 text-sm text-tone-success-fg">
              <Icon icon={CircleCheck} size="sm" /> Copied. Paste it into {channel === 'email' ? 'your email' : 'WhatsApp'}.
            </p>
          ) : null}
          <div className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-2 text-sm text-fg-2">
            <span className="inline-flex items-center gap-2">
              <Icon icon={Phone} size="sm" className="text-fg-muted" />
              {draft.contact ? `To ${draft.contact.name}` : 'No contact on record'}
            </span>
            {draft.contact?.phone ? <span className="num">{draft.contact.phone}</span> : null}
          </div>
          <div className={cn('relative px-4 py-3', !full && 'max-h-52 overflow-hidden md:max-h-none md:overflow-visible')}>
            <pre data-testid="draft-text" className="whitespace-pre-wrap break-words font-sans text-sm text-fg">
              {channel === 'email' && draft.email.subject ? `Subject: ${draft.email.subject}\n\n` : ''}
              {(channel === 'email' ? draft.email : draft.whatsapp).body}
            </pre>
          </div>
          <button type="button" onClick={() => setFull(f => !f)} className="border-t px-4 py-2 text-left text-sm text-primary underline md:hidden">
            {full ? 'Show less' : 'Show full message'}
          </button>
          <div className="flex flex-wrap items-center gap-2 border-t bg-sunken px-4 py-3">
            {wasCopied ? (
              <Button icon={Check} disabled className="min-h-touch md:min-h-0">
                Marked {verb} today
              </Button>
            ) : (
              <Button variant="primary" icon={Copy} busy={busy} busyLabel="Marking" onClick={() => void copyAndMark()} className="min-h-touch md:min-h-0">
                {item.rule === 'payment_overdue' ? 'Copy message and mark reminded' : 'Copy message and mark chased'}
              </Button>
            )}
            <Button icon={ExternalLink} onClick={() => navigate(item.href)} className="min-h-touch md:min-h-0">
              Open {item.ref}
            </Button>
            <div className="ml-auto">
              <SnoozeMenu item={item} today={today} />
            </div>
          </div>
          <p className="px-4 py-2 text-xs text-fg-muted">
            {wasCopied
              ? `${capital(verb)} today. Moves to Waiting when the undo closes.`
              : `Copying records a ${verb === 'reminded' ? 'reminder' : 'chase'} today (${draft.kind === 'customer' ? 'asked' : verb === 'reminded' ? 'reminded' : 'chased'} ×${draft.countAfter}).${draft.answerBy ? ` Asks for a reply by ${formatDay(draft.answerBy)}.` : ''}${draft.firm ? ' Firmer wording, because it is more than 30 days.' : ''}`}
          </p>
        </div>
      ) : draftReady || (isChase(item) && !pending(item, header, items, inquiries, leg, payment)) ? (
        <div className="flex flex-wrap items-center gap-2 rounded border bg-surface p-4">
          <p className="mr-auto text-sm text-fg-muted">{noDraftText(item)}</p>
          <Button icon={ExternalLink} onClick={() => navigate(item.href)}>Open {item.ref}</Button>
          <SnoozeMenu item={item} today={today} />
        </div>
      ) : isChase(item) ? (
        <div className="grid gap-2 rounded border bg-surface p-4" aria-busy="true">
          <Skeleton className="h-4 w-1/3" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-5/6" />
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-2 rounded border bg-surface p-4">
          <p className="mr-auto text-sm text-fg-2">{howTo(item)}</p>
          <Button variant="primary" icon={ExternalLink} onClick={() => navigate(item.href)} className="min-h-touch md:min-h-0">
            Open {item.ref}
          </Button>
          <SnoozeMenu item={item} today={today} />
        </div>
      )}

      {item.rule === 'chase_customer' && questions.length > 0 ? (
        <div className="grid gap-3 md:grid-cols-2">
          <section aria-label="Open questions" className="grid content-start gap-2 rounded border bg-surface p-4">
            <h3 className="text-base font-semibold">Open questions</h3>
            <ol className="grid gap-3">
              {questions.map((q, i) => (
                <li key={q.id} className="grid grid-cols-[1.5rem_1fr] gap-2 text-sm">
                  <span className="num grid size-6 place-items-center rounded-round bg-tone-warning-bg text-xs text-tone-warning-fg">{i + 1}</span>
                  <span className="grid gap-px">
                    {q.question}
                    <span className="text-xs text-fg-muted">asked {formatDay(q.lastAskedOn)} · no reply</span>
                  </span>
                </li>
              ))}
            </ol>
          </section>
          <section aria-label="What happened" className="grid content-start gap-2 rounded border bg-surface p-4">
            <h3 className="text-base font-semibold">What happened</h3>
            <ul className="grid gap-2 text-sm">
              {rfq ? <Event on={rfq.receivedOn} text="RFQ received from customer" /> : null}
              <Event on={questions.map(q => q.firstAskedOn).sort()[0]} text={`${questions.length} ${questions.length === 1 ? 'question' : 'questions'} sent to customer`} />
              {Math.max(...questions.map(q => q.askCount)) > 1 ? <Event on={questions.map(q => q.lastAskedOn).sort().at(-1) as string} text="Customer asked again" /> : null}
              <Event on={today} text={item.waiting ? `Chased ${agoText(item.waiting.chasedOn, today)}` : 'Not chased yet'} warn={!item.waiting} />
            </ul>
          </section>
        </div>
      ) : null}
      {item.rule === 'goods_late' && leg.data && leg.data.items.length > 0 ? (
        <section aria-label="Goods on this order" className="grid gap-2 rounded border bg-surface p-4">
          <h3 className="text-base font-semibold">Goods still to arrive</h3>
          <ol className="grid gap-1 text-sm">
            {leg.data.items.map((it, i) => (
              <li key={i}>{i + 1}. {it.brandName ? `${it.brandName} ` : ''}{it.description}, {it.qty}{it.unit ? ` ${it.unit}` : ''}</li>
            ))}
          </ol>
        </section>
      ) : null}
    </section>
  )
}

const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)
const isChase = (i: TodayItem) => i.rule === 'chase_customer' || i.rule === 'chase_supplier' || i.rule === 'goods_late' || i.rule === 'payment_overdue'

function pending(item: TodayItem, ...qs: Array<{ isPending: boolean; isFetching?: boolean; fetchStatus?: string }>): boolean {
  void item
  return qs.some(q => q.isPending && q.fetchStatus !== 'idle')
}

function noDraftText(item: TodayItem): string {
  if (item.rule === 'chase_supplier') return 'Every item has a price or a "cannot offer" from this supplier, so there is nothing to ask. Open the RFQ to update it.'
  if (item.rule === 'goods_late') return 'There is no expected date on this order, so there is nothing to chase. Open the order.'
  return 'There is nothing to write for this item yet. Open the record.'
}

function howTo(item: TodayItem): string {
  switch (item.rule) {
    case 'relay_answers':
      return 'The customer has answered what this supplier asked. Open the RFQ to copy the answers back to them.'
    case 'not_floated':
      return 'Nobody has been asked for a price yet. Open the RFQ to pick suppliers and send the enquiry.'
    case 'bid_due':
      return 'The bid is still to send. Open the RFQ to issue the quotation, or mark the bid sent.'
    case 'decision_overdue':
      return 'No decision since the bid went out. Open the RFQ to chase the customer, or close it with a reason.'
    case 'place_po':
      return 'This order has a supplier leg with no purchase order yet. Open the order to place it.'
    case 'plan_commissioning':
      return 'This order needs commissioning and has no planned date. Open the order and set the planned date.'
    case 'delivered_not_invoiced':
      return 'Everything on this order has been delivered and no invoice exists. Open the order to invoice it.'
    case 'close_month':
      return 'Review the month-end checks and close the month. Nothing blocks closing; each check is a warning.'
    default:
      return 'Open the record.'
  }
}

function Event({ on, text, warn }: { on: string; text: string; warn?: boolean }) {
  return (
    <li className="grid grid-cols-[4.5rem_1fr] gap-2">
      <span className={cn('num text-xs', warn ? 'text-tone-warning-fg' : 'text-fg-muted')}>{formatDay(on).replace(/^\w+ /, '')}</span>
      <span className={warn ? 'text-tone-warning-fg' : undefined}>{text}</span>
    </li>
  )
}

function priced(items: ReadonlyArray<{ id: string }> | undefined, inquiries: ReadonlyArray<{ id: string; lines: ReadonlyArray<{ itemId: string }> }> | undefined, inquiryId?: string) {
  if (!items || !inquiries) return null
  const inq = inquiries.find(i => i.id === inquiryId)
  if (!inq) return null
  return { priced: items.filter(it => inq.lines.some(l => l.itemId === it.id)).length, total: items.length }
}

function factsFor(
  item: TodayItem,
  c: {
    rfq: TodayData['rfqs'][number] | undefined
    questions: TodayData['clarifications']
    inquiryFact: TodayData['inquiries'][number] | undefined
    legFact: TodayData['legs'][number] | undefined
    receivable: TodayData['receivables'][number] | undefined
    today: string
    pricedOf: { priced: number; total: number } | null
  },
): Fact[] {
  const { rfq, today } = c
  const bid: Fact | null = rfq?.dueOn ? { label: 'Bid due in', value: distanceText(rfq.dueOn, today), sub: formatDay(rfq.dueOn), tone: rfq.dueOn <= today ? 'danger' : undefined } : null
  const out: Array<Fact | null> = []
  switch (item.rule) {
    case 'chase_customer': {
      const last = c.questions.map(q => q.lastAskedOn).sort().at(-1)
      const asks = Math.max(0, ...c.questions.map(q => q.askCount))
      out.push(
        { label: 'Unanswered', value: String(c.questions.length), sub: c.questions.length === 1 ? 'question' : 'questions', tone: 'warning' },
        last ? { label: 'Asked customer', value: agoText(last, today), sub: formatDay(last) } : null,
        bid,
        { label: 'Asked so far', value: `×${asks}`, sub: asks >= 3 ? 'no answer yet' : undefined },
      )
      break
    }
    case 'chase_supplier': {
      const i = c.inquiryFact
      out.push(
        c.pricedOf ? { label: 'Priced', value: `${c.pricedOf.priced} of ${c.pricedOf.total}`, sub: 'items' } : null,
        i?.sentOn ? { label: 'Enquiry sent', value: formatDay(i.sentOn) } : null,
        i ? { label: 'Chased', value: i.chaseCount > 0 ? `×${i.chaseCount}` : 'not yet', sub: i.lastChasedOn ? `last ${formatDay(i.lastChasedOn)}` : undefined } : null,
        bid,
      )
      break
    }
    case 'goods_late': {
      const l = c.legFact
      out.push(
        l?.expectedOn ? { label: 'Late by', value: distanceText(l.expectedOn, today).replace(' late', ''), tone: 'danger' } : null,
        l?.expectedOn ? { label: 'Expected', value: formatDay(l.expectedOn) } : null,
        l ? { label: 'Chased', value: l.chaseCount > 0 ? `×${l.chaseCount}` : 'not yet', sub: l.lastChasedOn ? `last ${formatDay(l.lastChasedOn)}` : undefined } : null,
        l?.reference ? { label: 'Reference', value: l.reference } : null,
      )
      break
    }
    case 'payment_overdue': {
      const r = c.receivable
      out.push(
        r ? { label: 'Balance', value: `PKR ${formatAmount(r.balance)}`, sub: 'GST included' } : null,
        r?.dueOn ? { label: 'Overdue by', value: distanceText(r.dueOn, today).replace(' late', ''), tone: 'danger' } : null,
        r?.dueOn ? { label: 'Was due', value: formatDay(r.dueOn) } : null,
        r ? { label: 'Reminded', value: r.reminderCount > 0 ? `×${r.reminderCount}` : 'not yet', sub: r.lastRemindedOn ? `last ${formatDay(r.lastRemindedOn)}` : undefined } : null,
      )
      break
    }
    case 'relay_answers':
      out.push({ label: 'Supplier', value: item.title.split('relay to ')[1] ?? '' }, rfq ? { label: 'RFQ received', value: formatDay(rfq.receivedOn) } : null, bid)
      break
    case 'not_floated':
    case 'bid_due':
      out.push(rfq ? { label: 'RFQ received', value: formatDay(rfq.receivedOn), sub: agoText(rfq.receivedOn, today) } : null, bid)
      break
    case 'decision_overdue':
      out.push(rfq?.quotedOn ? { label: 'Bid sent', value: formatDay(rfq.quotedOn), sub: agoText(rfq.quotedOn, today) } : null)
      break
    case 'place_po': {
      const l = c.legFact
      out.push(l ? { label: 'Order', value: item.ref } : null, l?.orderedOn ? { label: 'Ordered', value: formatDay(l.orderedOn), sub: agoText(l.orderedOn, today) } : null)
      break
    }
    default:
      break
  }
  return out.filter((f): f is Fact => f !== null)
}

/** The chase rail: asked (or sent) to bid due, on the shared DateRail. Always due-soon (warning), as on the approved Today B. */
function ChaseRail({ item, rfqDue, questions, inquirySent, today }: { item: TodayItem; rfqDue: string | null; questions: TodayData['clarifications']; inquirySent: string | null; today: string }) {
  const start = item.rule === 'chase_customer' ? questions.map(q => q.lastAskedOn).sort().at(-1) : item.rule === 'chase_supplier' ? inquirySent : null
  if (!start || !rfqDue || rfqDue <= start) return null
  return (
    <DateRail
      decorative
      state="due-soon"
      start={start}
      due={rfqDue}
      today={today}
      startLabel={item.rule === 'chase_customer' ? 'Asked' : 'Sent'}
      className="[&_em]:ring-canvas"
    />
  )
}

/** Escalations are suggestions beside the text, never part of it, and never automatic. */
function Escalation({ item, today }: { item: TodayItem; today: string }) {
  const navigate = useNavigate()
  const { toast } = useToast()
  const close = useSetRfqClosed(item.rfqId ?? '')
  const [dismissed, setDismissed] = useState(false)
  if (dismissed || !item.rfqId) return null
  if (item.escalation === 'close_no_reply') {
    return (
      <Banner
        tone="warning"
        title="3 chases, no answer"
        action={
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              busy={close.isPending}
              busyLabel="Closing"
              onClick={() =>
                close.mutate(
                  { closedOn: today, reason: 'no_reply_to_clarification', note: null },
                  {
                    onSuccess: () =>
                      toast({
                        title: `Closed ${item.ref}`,
                        body: 'No reply from customer',
                        tone: 'success',
                        undo: { onUndo: () => close.mutateAsync({ closedOn: null, reason: null, note: null }).then(() => undefined) },
                      }),
                    onError: err => toast({ title: 'Could not close it', body: mapPgError(err).message, tone: 'danger' }),
                  },
                )
              }
            >
              Close as no reply
            </Button>
            <Button size="sm" onClick={() => setDismissed(true)}>Keep waiting</Button>
          </div>
        }
      >
        This is a suggestion. Nothing is closed for you. Closing records the reason "No reply to our questions".
      </Banner>
    )
  }
  return (
    <Banner
      tone="warning"
      title={`Chased twice, no reply from ${item.party}`}
      action={
        <div className="flex flex-wrap gap-2">
          <Button size="sm" icon={TriangleAlert} onClick={() => navigate(item.href)}>Choose another supplier</Button>
          <Button size="sm" onClick={() => setDismissed(true)}>Chase again</Button>
        </div>
      }
    >
      Float these items to someone else? Nothing is changed until you choose.
    </Banner>
  )
}

/** Snooze: tomorrow, Monday or a date. One snooze per rule and subject; Undo puts back what was there. */
export function SnoozeMenu({ item, today }: { item: TodayItem; today: string }) {
  const snooze = useSnooze()
  const unsnooze = useUnsnooze()
  const { toast } = useToast()
  const [picking, setPicking] = useState(false)
  const [date, setDate] = useState<string>(addDays(businessToday(), 2) ?? '')
  const rule = SNOOZE_RULE[item.rule]

  const apply = (untilOn: string) => {
    snooze.mutate(
      { rule, subjectId: item.subjectId, untilOn },
      {
        onSuccess: () =>
          toast({
            title: `Snoozed until ${formatDay(untilOn)}`,
            body: `${item.ref} · ${item.party}`,
            tone: 'neutral',
            undo: { onUndo: () => unsnooze.mutateAsync({ rule, subjectId: item.subjectId }).then(() => undefined) },
          }),
        onError: err => toast({ title: 'Could not snooze', body: mapPgError(err).message, tone: 'danger' }),
      },
    )
  }
  const tomorrow = addDays(today, 1) as string
  const monday = nextMonday(today)
  return (
    <>
      <Popover>
        <PopoverTrigger asChild>
          <Button variant="quiet" icon={BellOff} className="min-h-touch md:min-h-0">
            Snooze
          </Button>
        </PopoverTrigger>
        <PopoverContent variant="menu" align="end" aria-label="Snooze until">
          <PopoverClose asChild>
            <MenuItem onClick={() => apply(tomorrow)}>Tomorrow, {formatDay(tomorrow)}</MenuItem>
          </PopoverClose>
          <PopoverClose asChild>
            <MenuItem onClick={() => apply(monday)}>Monday, {formatDay(monday)}</MenuItem>
          </PopoverClose>
          <PopoverClose asChild>
            <MenuItem icon={CalendarDays} onClick={() => setPicking(true)}>Pick a date</MenuItem>
          </PopoverClose>
        </PopoverContent>
      </Popover>
      <Dialog open={picking} onOpenChange={setPicking}>
        <DialogContent
          title="Snooze until"
          context={`${item.ref} · ${item.party}`}
          icon={BellOff}
          footer={
            <>
              <Button data-cancel onClick={() => setPicking(false)}>Cancel</Button>
              <Button
                variant="primary"
                disabled={!date || date <= today}
                onClick={() => {
                  setPicking(false)
                  apply(date)
                }}
              >
                Snooze
              </Button>
            </>
          }
        >
          <label className="grid gap-1 text-sm">
            <span className="font-medium">Come back on</span>
            <DateInput value={date} onChange={setDate} defaultToday={false} aria-label="Snooze until" />
          </label>
          <p className="mt-2 text-xs text-fg-muted">It disappears from Today until that day.</p>
        </DialogContent>
      </Dialog>
    </>
  )
}
