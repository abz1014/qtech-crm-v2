import { useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  AlarmClock,
  AlarmClockOff,
  CalendarDays,
  Check,
  ChevronRight,
  CircleCheck,
  Clock,
  Copy,
  ExternalLink,
  Hourglass,
  MessageCircleQuestion,
  Users,
  type LucideIcon,
} from 'lucide-react'
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
import { MenuItem, Popover, PopoverContent, PopoverTrigger } from '@/ui/Popover'
import { SegmentedControl } from '@/ui/SegmentedControl'
import { Skeleton } from '@/ui/Skeleton'
import { StatusBadge } from '@/ui/StatusBadge'
import { useToast } from '@/ui/useToast'
import { ChaseNote, FormattedMessage, RecipientRow, SubjectRow } from '@/features/rfqs/ChaseParts'
import { FloatElsewhere } from '@/features/rfqs/FloatElsewhere'
import { useChooseSuppliers } from '@/features/rfqs/escalationLogic'
import { useRfqHeader, useRfqInquiries, useRfqItems, useSetRfqClosed } from '@/features/rfqs/hooks'
import { COMPANY_NAME, customerReturnsOn, supplierReturnsOn } from '@/features/rfqs/lib'
import { addBusinessDays, addDays, nextMonday } from '@/features/rfqs/lib/dateText'
import { isBidClose } from '@/features/rfqs/lib/customerChase'
import { chasedByText } from '@/features/rfqs/lib/collision'
import type { TodayData } from '@/features/today/api'
import { buildCustomerDraft, buildGoodsDraft, buildPaymentDraft, buildSupplierDraft, type Draft } from '@/features/today/chaseDraft'
import { chaseMemo, clockText, excerptOf, forgetChase, rememberChase } from '@/features/today/chaseMemory'
import { performChase, useLegDraft, usePaymentDraft, useRefreshAfterChase, useSnooze, useUnsnooze, type ChaseSpec } from '@/features/today/hooks'
import { SNOOZE_RULE, type TodayItem } from '@/features/today/types'
import { agoText, distanceText } from '@/features/today/text'

/*
 * The context pane (direction B, g2-today-b2). Selecting a row shows what explains it and, for a chase, the message
 * already written. States, as drawn:
 *   draft        facts, date rail, "Prepared for you" with WhatsApp or Email, one tap: "Copy message and mark chased"
 *   copied       the green "Copied. Paste it into WhatsApp." bar replaces the card header; the footer says
 *                "Chased today. Moves to Waiting when the undo closes." while the 10 s Undo is open (the toast)
 *   just chased  after the undo closes the row has joined Waiting: the title stays, a "Moved to Waiting" bar says when it
 *                returns, the cells switch to "Chased ..." and "Next nudge", the rail gains the nudge marker, a compact
 *                "Chased today" card replaces the draft, and "Chase again now" brings the draft back
 * On a phone the pane is the accordion under the row: no breadcrumb, title or chips; a 2 x 2 grid; the actions are 44 px.
 */
interface PaneProps {
  item: TodayItem
  data: TodayData
  today: string
  /** Keys of items copied inside the undo window: they stay in place, marked "Copied", until the window closes. */
  copied: ReadonlySet<string>
  onCopied: (key: string) => void
  onReleased: (key: string) => void
  /** The accordion under a row on a phone. */
  compact?: boolean
  /** The next item to look at, for "Next: RFQ-0184" on the Moved to Waiting bar. */
  nextItem?: TodayItem
  onSelect?: (key: string) => void
}

interface Fact {
  label: string
  /** The label on a phone, where the grid is 2 x 2 (drawn shorter). */
  short?: string
  icon?: LucideIcon
  value: string
  sub?: string
  tone?: 'warning' | 'danger' | 'success'
}

const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)
const NUMBER_WORD = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten']
const isChase = (i: TodayItem) => i.rule === 'chase_customer' || i.rule === 'chase_supplier' || i.rule === 'goods_late' || i.rule === 'payment_overdue'

export function ContextPane({ item, data, today, copied, onCopied, onReleased, compact = false, nextItem, onSelect }: PaneProps) {
  const session = useSession()
  const user = session.status === 'signed-in' ? session.user : null
  const navigate = useNavigate()
  const { toast } = useToast()
  const refresh = useRefreshAfterChase()
  const [channel, setChannel] = useState<'whatsapp' | 'email'>('whatsapp')
  const [busy, setBusy] = useState(false)
  const [full, setFull] = useState(false)
  const [again, setAgain] = useState(false)
  const isRfq = Boolean(item.rfqId)
  const header = useRfqHeader(isRfq ? item.rfqId : undefined)
  const customerRule = item.rule === 'chase_customer'
  const supplierRule = item.rule === 'chase_supplier'
  const items = useRfqItems(supplierRule || customerRule ? item.rfqId : undefined)
  const inquiries = useRfqInquiries(supplierRule || customerRule ? item.rfqId : undefined)
  const leg = useLegDraft(item.rule === 'goods_late' ? item.legId : undefined)
  const isMoney = user?.role === 'admin' || user?.role === 'sales'
  const payment = usePaymentDraft(item.rule === 'payment_overdue' ? item.orderId : undefined, Boolean(isMoney))
  const choose = useChooseSuppliers(header.data ?? undefined, inquiries.data ?? [])

  const rfq = data.rfqs.find(r => r.id === item.rfqId)
  const questions = useMemo(() => data.clarifications.filter(c => c.rfqId === item.rfqId), [data.clarifications, item.rfqId])
  const inquiryFact = data.inquiries.find(i => i.id === item.inquiryId)
  const legFact = data.legs.find(l => l.id === item.legId)
  const receivable = data.receivables.find(r => r.orderId === item.orderId)
  const signature = { name: user?.name ?? COMPANY_NAME, company: COMPANY_NAME, jobTitle: data.jobTitle, phone: data.phone }

  const draftReady = customerRule
    ? Boolean(rfq) && !header.isPending
    : supplierRule
      ? Boolean(rfq) && Boolean(items.data) && Boolean(inquiries.data)
      : item.rule === 'goods_late'
        ? Boolean(legFact) && Boolean(leg.data)
        : item.rule === 'payment_overdue'
          ? Boolean(receivable) && Boolean(payment.data)
          : false

  const draft: Draft | null = useMemo(() => {
    if (!draftReady) return null
    if (customerRule && rfq) return buildCustomerDraft({ rfq, contact: header.data?.contact ?? null, questions, items: items.data, today, signature })
    if (supplierRule && rfq && items.data && inquiries.data) {
      const inquiry = inquiries.data.find(i => i.id === item.inquiryId)
      return inquiry ? buildSupplierDraft({ rfq, inquiry, items: items.data, today, signature }) : null
    }
    if (item.rule === 'goods_late' && legFact && leg.data) return buildGoodsDraft({ leg: legFact, data: leg.data, today, signature })
    if (item.rule === 'payment_overdue' && receivable && payment.data) return buildPaymentDraft({ receivable, data: payment.data, today, signature })
    return null
    // signature is rebuilt from user and data each render; its parts are the dependencies
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftReady, item.rule, item.inquiryId, rfq, header.data, questions, items.data, inquiries.data, legFact, leg.data, receivable, payment.data, today, user?.name, data.jobTitle, data.phone])

  const wasCopied = copied.has(item.key)
  const verb = item.rule === 'payment_overdue' ? 'reminded' : 'chased'
  const memo = chaseMemo(item.key)
  const shownMessage = draft ? (channel === 'email' ? draft.email : draft.whatsapp) : null
  // The clipboard gets the body: an email's subject has its own row and its own copy button.
  const text = shownMessage ? shownMessage.body : ''
  const justChased = Boolean(item.waiting) && !again && isChase(item)

  const spec = (): ChaseSpec | null => {
    if (customerRule) return questions.length ? { kind: 'customer', ids: questions.map(q => q.id) } : null
    if (supplierRule && inquiryFact) return { kind: 'supplier', inquiryId: inquiryFact.id, before: { lastChasedOn: inquiryFact.lastChasedOn, lastChasedBy: inquiryFact.lastChasedBy ?? null, chaseCount: inquiryFact.chaseCount } }
    if (item.rule === 'goods_late' && legFact) return { kind: 'goods', legId: legFact.id, before: { lastChasedOn: legFact.lastChasedOn, lastChasedBy: legFact.lastChasedBy ?? null, chaseCount: legFact.chaseCount } }
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
        rememberChase(item.key, { channel, at: Date.now(), text })
        setAgain(false)
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
                forgetChase(item.key)
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

  const nudge = nudgeInfo(item, rfq?.dueOn ?? null, today)
  const facts = factsFor(item, { rfq, questions, inquiryFact, legFact, receivable, today, pricedOf: priced(items.data, inquiries.data, item.inquiryId), justChased, nudge })
  const hs = header.data?.state
  const deadline = hs ? deadlineValue(hs.days_to_due, Boolean(hs.is_overdue), 5) : null
  const askedTimes = customerRule ? Math.max(0, ...questions.map(q => q.askCount)) : 0
  const floated = inquiries.data ? inquiries.data.filter(i => i.sentOn).length : 0
  const firstFloat = inquiries.data ? inquiries.data.map(i => i.sentOn).filter((d): d is string => Boolean(d)).sort()[0] : undefined

  const copyLabel = compact
    ? item.rule === 'payment_overdue'
      ? 'Copy and mark reminded'
      : 'Copy and mark chased'
    : item.rule === 'payment_overdue'
      ? 'Copy message and mark reminded'
      : 'Copy message and mark chased'
  const touch = compact ? 'min-h-touch' : ''

  return (
    <section aria-label={`${item.title}, ${item.ref}`} className="grid content-start gap-4">
      {compact ? null : (
        <header className="grid gap-1">
          <Breadcrumb className="mb-1" items={[{ label: 'Today', to: '/today' }, { label: item.ref, mono: true }]} />
          <h2 className="text-xl font-semibold tracking-snug">{item.title}</h2>
          <p className="text-sm text-fg-2">
            {customerRule ? (
              <>
                {item.party}
                {rfq?.customerRef ? <> · customer ref {rfq.customerRef}</> : null}
              </>
            ) : (
              <>
                <span className="num">{item.ref}</span> · {item.party}
                {rfq?.customerRef ? <> · customer ref {rfq.customerRef}</> : null}
              </>
            )}
          </p>
          {hs ? (
            <div className="mt-1 flex flex-wrap gap-2">
              {hs.clarification_state && hs.clarification_state !== 'none' ? (
                <StatusBadge dimension="clarification" value={hs.clarification_state} detail={customerRule && askedTimes >= 2 ? `asked ×${askedTimes}` : undefined} />
              ) : null}
              {deadline ? <StatusBadge dimension="deadline" value={deadline} /> : null}
              {hs.sourcing_state ? <StatusBadge dimension="sourcing" value={hs.sourcing_state} /> : null}
            </div>
          ) : null}
        </header>
      )}

      {item.collision && data.names[item.collision.by] ? (
        <p data-collision className="flex items-center gap-2 rounded border border-tone-warning-fg/25 bg-tone-warning-bg px-3 py-2 text-sm text-tone-warning-fg">
          <Icon icon={Users} size="sm" /> {chasedByText(data.names[item.collision.by], item.collision.at, Date.now())}. Check with them before you chase it again.
        </p>
      ) : null}

      {justChased && item.waiting ? (
        <div role="status" className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded border border-tone-success-fg/25 bg-tone-success-bg px-4 py-3 text-sm text-tone-success-fg">
          <Icon icon={Hourglass} />
          <span className="min-w-0 flex-1 basis-60">
            <b className="font-semibold">Moved to Waiting.</b> It comes back to your list on {formatDay(item.waiting.nextNudgeOn)}, or sooner if {replyWho(item)}.
          </span>
          {nextItem && onSelect ? (
            <button type="button" onClick={() => onSelect(nextItem.key)} className="num font-medium underline-offset-2 hover:underline">
              Next: {nextItem.ref}
            </button>
          ) : null}
        </div>
      ) : item.waiting ? (
        <Banner tone="info" title={`Waiting until ${formatDay(item.waiting.nextNudgeOn)}`}>
          It returns to the list on that day. You are looking at the message again; copying it chases once more.
        </Banner>
      ) : null}

      {facts.length > 0 ? (
        <dl className={cn('grid grid-cols-2 overflow-hidden rounded border bg-surface', !compact && 'lg:grid-cols-4')}>
          {facts.map(f => (
            <div
              key={f.label}
              className={cn('grid content-start gap-1 border-b border-r p-3', compact ? '[&:nth-child(2n)]:border-r-0' : '[&:nth-child(2n)]:border-r-0 lg:[&:nth-child(2n)]:border-r lg:[&:nth-child(4n)]:border-r-0')}
            >
              <dt className={cn('flex items-center gap-2 text-xs', f.tone === 'warning' ? 'text-tone-warning-fg' : f.tone === 'success' ? 'text-tone-success-fg' : 'text-fg-muted')}>
                {f.icon && !compact ? <Icon icon={f.icon} size="sm" /> : null}
                {compact ? (f.short ?? f.label) : f.label}
              </dt>
              <dd className={cn('num text-base font-medium', f.tone === 'danger' && 'text-tone-danger-fg')}>{f.value}</dd>
              {f.sub ? <dd className="text-xs text-fg-muted">{f.sub}</dd> : null}
            </div>
          ))}
        </dl>
      ) : null}

      {justChased ? (
        <NudgeRail item={item} rfqDue={rfq?.dueOn ?? null} questions={questions} inquirySent={inquiryFact?.sentOn ?? null} today={today} nudgeOn={item.waiting?.nextNudgeOn ?? null} />
      ) : (
        <ChaseRail item={item} rfqDue={rfq?.dueOn ?? null} questions={questions} inquirySent={inquiryFact?.sentOn ?? null} today={today} />
      )}

      {item.escalation === 'close_no_reply' && !justChased ? <CloseNoReply item={item} today={today} /> : null}
      {item.escalation === 'float_elsewhere' && !justChased && supplierRule && items.data && inquiries.data ? (
        <FloatElsewhere
          supplierName={item.party}
          items={items.data.filter(it => !inquiries.data?.find(i => i.id === item.inquiryId)?.lines.some(l => l.itemId === it.id))}
          askedIds={new Set(inquiries.data.map(i => i.supplierId))}
          today={today}
          busy={choose.busy}
          onChoose={input => void choose.choose(input)}
          onChaseAgain={() => setAgain(true)}
        />
      ) : null}

      {justChased && item.waiting ? (
        <ChasedCard
          item={item}
          today={today}
          verb={verb}
          memo={memo}
          contact={draft?.contact ?? null}
          askedNow={askedTimes}
          lastAskedAt={questions.map(q => q.lastAskedAt).sort().at(-1)}
          onOpen={() => navigate(item.href)}
          onAgain={() => setAgain(true)}
        />
      ) : draft ? (
        <div className="grid overflow-hidden rounded border bg-surface">
          {wasCopied ? (
            <p role="status" className="flex items-center gap-2 bg-tone-success-bg px-4 py-3 text-sm text-tone-success-fg">
              <Icon icon={CircleCheck} size="sm" /> Copied. Paste it into {channel === 'email' ? 'your email' : 'WhatsApp'}.
            </p>
          ) : (
            <div className="flex flex-wrap items-center justify-between gap-3 border-b px-4 py-3">
              <div className="grid gap-px">
                <h3 className="text-base font-semibold">Prepared for you</h3>
                {compact ? null : <p className="text-sm text-fg-muted">{preparedFrom(item, questions.length)} Edit anything before you send.</p>}
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
          )}
          {compact ? null : <RecipientRow channel={channel} contact={draft.contact} />}
          {channel === 'email' && draft.email.subject ? <SubjectRow subject={draft.email.subject} /> : null}
          <div className={cn('relative px-4 py-3', compact && !full && 'max-h-40 overflow-hidden')}>
            <FormattedMessage text={shownMessage?.body ?? ''} testId="draft-text" />
          </div>
          {compact ? (
            <button type="button" onClick={() => setFull(f => !f)} className="border-t px-4 py-2 text-left text-sm text-primary underline">
              {full ? 'Show less' : 'Show full message'}
            </button>
          ) : null}
          {!wasCopied && !compact ? <ChaseNote className="border-t">{copyingNote(item, draft, nudge.returnsOn, inquiryFact?.chaseCount ?? 0)}</ChaseNote> : null}
          {wasCopied ? (
            compact ? (
              <div className="flex items-center gap-2 border-t bg-sunken px-4 py-3">
                <Button icon={Check} disabled className={cn('flex-1', touch)}>
                  Marked {verb} today
                </Button>
                <SnoozeMenu item={item} today={today} iconOnly />
              </div>
            ) : (
              <div className="flex flex-wrap items-center justify-between gap-2 border-t bg-sunken px-4 py-3">
                <p className="flex items-center gap-2 text-sm text-tone-success-fg">
                  <Icon icon={CircleCheck} size="sm" /> {capital(verb)} today. Moves to Waiting when the undo closes.
                </p>
                <Button icon={ExternalLink} onClick={() => navigate(item.href)}>
                  Open {item.ref}
                </Button>
              </div>
            )
          ) : compact ? (
            <div className="flex items-center gap-2 border-t bg-sunken px-4 py-3">
              <Button variant="primary" icon={Copy} busy={busy} busyLabel="Marking" onClick={() => void copyAndMark()} className={cn('flex-1', touch)}>
                {copyLabel}
              </Button>
              <SnoozeMenu item={item} today={today} iconOnly />
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-2 border-t bg-sunken px-4 py-3">
              <Button variant="primary" icon={Copy} busy={busy} busyLabel="Marking" onClick={() => void copyAndMark()}>
                {copyLabel}
              </Button>
              <Button icon={ExternalLink} onClick={() => navigate(item.href)}>
                Open {item.ref}
              </Button>
              <div className="ml-auto">
                <SnoozeMenu item={item} today={today} />
              </div>
            </div>
          )}
        </div>
      ) : isChase(item) && (draftReady || !pending(header, items, inquiries, leg, payment)) ? (
        <div className="flex flex-wrap items-center gap-2 rounded border bg-surface p-4">
          <p className="mr-auto text-sm text-fg-muted">{noDraftText(item)}</p>
          <Button icon={ExternalLink} onClick={() => navigate(item.href)}>
            Open {item.ref}
          </Button>
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
          <Button variant="primary" icon={ExternalLink} onClick={() => navigate(item.href)} className={touch}>
            Open {item.ref}
          </Button>
          <SnoozeMenu item={item} today={today} iconOnly={compact} />
        </div>
      )}

      {compact && draft ? (
        <button type="button" onClick={() => navigate(item.href)} className="inline-flex min-h-touch items-center gap-2 justify-self-start px-1 text-sm text-fg-2 underline-offset-2 hover:underline">
          <Icon icon={ExternalLink} size="sm" /> Open {item.ref}
        </button>
      ) : null}

      {customerRule && questions.length > 0 && !compact ? (
        <div className="grid gap-3 md:grid-cols-2">
          <section aria-label="Open questions" className="grid content-start gap-2 rounded border bg-surface p-4">
            <h3 className="text-base font-semibold">Open questions</h3>
            <ol className="grid gap-3">
              {questions.map((q, i) => (
                <li key={q.id} className="grid grid-cols-[1.5rem_1fr] gap-2 text-sm">
                  <span className="num grid size-6 place-items-center rounded-round bg-tone-warning-bg text-xs text-tone-warning-fg">{i + 1}</span>
                  <span className="grid gap-px">
                    {q.question}
                    <span className="text-xs text-fg-muted">
                      asked {formatDay(q.firstAskedOn).replace(/^\w+ /, '')}
                      {q.askCount > 1 ? ` · chased ${formatDay(q.lastAskedOn).replace(/^\w+ /, '')}` : ''} · no reply
                    </span>
                  </span>
                </li>
              ))}
            </ol>
          </section>
          <section aria-label="What happened" className="grid content-start gap-2 rounded border bg-surface p-4">
            <h3 className="text-base font-semibold">What happened</h3>
            <ul className="grid gap-2 text-sm">
              {rfq ? <Event on={rfq.receivedOn} text="RFQ received from customer" /> : null}
              {firstFloat ? <Event on={firstFloat} text={`Floated to ${floated} ${floated === 1 ? 'supplier' : 'suppliers'}`} /> : null}
              <Event on={questions.map(q => q.firstAskedOn).sort()[0]} text={`${questions.length} ${questions.length === 1 ? 'question' : 'questions'} sent to customer`} />
              {item.waiting ? (
                <>
                  <Event on={item.waiting.chasedOn} text={`Chased customer, asked ×${askedTimes}`} warn />
                  <Event on={item.waiting.nextNudgeOn} text="Next nudge if no reply" />
                </>
              ) : (
                <Event on={today} text="Not chased yet" warn />
              )}
            </ul>
          </section>
        </div>
      ) : null}
      {item.rule === 'goods_late' && leg.data && leg.data.items.length > 0 && !compact ? (
        <section aria-label="Goods on this order" className="grid gap-2 rounded border bg-surface p-4">
          <h3 className="text-base font-semibold">Goods still to arrive</h3>
          <ol className="grid gap-1 text-sm">
            {leg.data.items.map((it, i) => (
              <li key={i}>
                {i + 1}. {it.brandName ? `${it.brandName} ` : ''}
                {it.description}, {it.qty}
                {it.unit ? ` ${it.unit}` : ''}
              </li>
            ))}
          </ol>
        </section>
      ) : null}
    </section>
  )
}

function pending(...qs: Array<{ isPending: boolean; fetchStatus?: string }>): boolean {
  return qs.some(q => q.isPending && q.fetchStatus !== 'idle')
}

/** Who the item is waiting for, for "or sooner if the customer replies". */
function replyWho(item: TodayItem): string {
  switch (item.rule) {
    case 'chase_customer':
      return 'the customer replies'
    case 'chase_supplier':
      return 'the supplier replies'
    case 'goods_late':
      return 'the goods are delivered'
    default:
      return 'they pay'
  }
}

function preparedFrom(item: TodayItem, nQuestions: number): string {
  switch (item.rule) {
    case 'chase_customer':
      return `Written from the ${NUMBER_WORD[nQuestions] ?? nQuestions} open ${nQuestions === 1 ? 'question' : 'questions'}.`
    case 'chase_supplier':
      return 'Written from the items still without a price.'
    case 'goods_late':
      return 'Written from the goods still to arrive.'
    default:
      return 'Written from the invoice and what has been paid.'
  }
}

/** The line under the message, with where the item goes and when it returns (g2-chase-texts wording). */
function copyingNote(item: TodayItem, draft: Draft, returnsOn: string, chaseCount: number): string {
  const when = formatDay(returnsOn)
  switch (item.rule) {
    case 'chase_customer':
      return `Copying records a chase today (asked ×${draft.countAfter}). ${item.ref} moves to Waiting and returns on ${when}.${draft.firm ? ' Firmer wording, because it is more than 30 days.' : ''}`
    case 'chase_supplier':
      return `Copying records chase ${chaseCount + 1} for this supplier. ${item.ref} moves to Waiting and returns if still silent after ${when}.${draft.firm ? ' Firmer wording, because it is more than 30 days.' : ''}`
    case 'goods_late':
      return `Copying records chase ${draft.countAfter} for this supplier. ${item.ref} moves to Waiting and returns if still silent after ${when}.${draft.firm ? ' Firmer wording, because it is more than 30 days late.' : ''}`
    default:
      return `Copying records a reminder today (×${draft.countAfter}). ${item.ref} moves to Waiting and returns on ${when}.${draft.firm ? ' Firmer wording, because it is more than 30 days overdue.' : ''}`
  }
}

function nudgeInfo(item: TodayItem, dueOn: string | null, today: string): { returnsOn: string; why: string } {
  const close = isBidClose(dueOn, today)
  switch (item.rule) {
    case 'chase_customer':
      return { returnsOn: customerReturnsOn(today, dueOn), why: close ? 'short wait: bid is close' : '3 working days' }
    case 'chase_supplier':
      return { returnsOn: supplierReturnsOn(today, dueOn), why: close ? 'short wait: bid is close' : '2 working days' }
    case 'goods_late':
      return { returnsOn: addBusinessDays(today, 3), why: '3 working days' }
    default:
      return { returnsOn: addBusinessDays(today, 7), why: '7 working days' }
  }
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
    case 'to_source':
      return 'Some goods on this won order have no supplier yet. Open the order and give each line a supplier, or mark it a service.'
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
    justChased: boolean
    nudge: { returnsOn: string; why: string }
  },
): Fact[] {
  const { rfq, today } = c
  const bid: Fact | null = rfq?.dueOn ? { label: 'Bid due in', icon: CalendarDays, value: distanceText(rfq.dueOn, today), sub: formatDay(rfq.dueOn), tone: rfq.dueOn <= today ? 'danger' : undefined } : null
  /** The two cells that change once it has been chased: "Chased ..." and "Next nudge". */
  const chased = (who: string, count: number, on: string): Fact => ({
    label: `Chased ${who}`,
    short: 'Chased',
    icon: Check,
    tone: 'success',
    value: on === today ? 'Today' : agoText(on, today).replace(/^\w/, ch => ch.toUpperCase()),
    sub: `${formatDay(on)} · ${count > 0 ? `${who === 'customer' ? 'asked' : 'chase'} ×${count}` : 'once'}`,
  })
  const nextNudge = (on: string): Fact => ({ label: 'Next nudge', short: 'Next nudge', icon: Hourglass, value: formatDay(on), sub: c.nudge.why })
  const out: Array<Fact | null> = []
  switch (item.rule) {
    case 'chase_customer': {
      const last = c.questions.map(q => q.lastAskedOn).sort().at(-1)
      const asks = Math.max(0, ...c.questions.map(q => q.askCount))
      const unanswered: Fact = { label: 'Unanswered', icon: MessageCircleQuestion, value: String(c.questions.length), sub: c.questions.length === 1 ? 'question' : 'questions', tone: 'warning' }
      if (c.justChased && item.waiting) {
        out.push(unanswered, chased('customer', asks, item.waiting.chasedOn), bid, nextNudge(item.waiting.nextNudgeOn))
        break
      }
      out.push(
        unanswered,
        last ? { label: 'Asked customer', short: 'Asked', icon: Clock, value: agoText(last, today), sub: formatDay(last) } : null,
        bid,
        { label: 'Asked so far', short: 'Waiting', icon: Hourglass, value: `×${asks}`, sub: asks >= 3 ? 'no answer yet' : undefined },
      )
      break
    }
    case 'chase_supplier': {
      const i = c.inquiryFact
      const pricedFact: Fact | null = c.pricedOf ? { label: 'Priced', icon: Check, value: `${c.pricedOf.priced} of ${c.pricedOf.total}`, sub: 'items' } : null
      const sent: Fact | null = i?.sentOn ? { label: 'Enquiry sent', icon: Clock, value: formatDay(i.sentOn) } : null
      if (c.justChased && item.waiting) {
        out.push(pricedFact, sent, chased('supplier', i?.chaseCount ?? 1, item.waiting.chasedOn), nextNudge(item.waiting.nextNudgeOn))
        break
      }
      out.push(pricedFact, sent, i ? { label: 'Chased', icon: Hourglass, value: i.chaseCount > 0 ? `×${i.chaseCount}` : 'not yet', sub: i.lastChasedOn ? `last ${formatDay(i.lastChasedOn)}` : undefined } : null, bid)
      break
    }
    case 'goods_late': {
      const l = c.legFact
      const late: Fact | null = l?.expectedOn ? { label: 'Late by', icon: Clock, value: distanceText(l.expectedOn, today).replace(' late', ''), tone: 'danger' } : null
      const expected: Fact | null = l?.expectedOn ? { label: 'Expected', icon: CalendarDays, value: formatDay(l.expectedOn) } : null
      if (c.justChased && item.waiting) {
        out.push(late, expected, chased('supplier', l?.chaseCount ?? 1, item.waiting.chasedOn), nextNudge(item.waiting.nextNudgeOn))
        break
      }
      out.push(
        late,
        expected,
        l ? { label: 'Chased', icon: Hourglass, value: l.chaseCount > 0 ? `×${l.chaseCount}` : 'not yet', sub: l.lastChasedOn ? `last ${formatDay(l.lastChasedOn)}` : undefined } : null,
        l?.reference ? { label: 'Reference', value: l.reference } : null,
      )
      break
    }
    case 'payment_overdue': {
      const r = c.receivable
      const balance: Fact | null = r ? { label: 'Balance', value: `PKR ${formatAmount(r.balance)}`, sub: 'GST included' } : null
      const over: Fact | null = r?.dueOn ? { label: 'Overdue by', icon: Clock, value: distanceText(r.dueOn, today).replace(' late', ''), tone: 'danger' } : null
      if (c.justChased && item.waiting) {
        out.push(balance, over, chased('customer', r?.reminderCount ?? 1, item.waiting.chasedOn), nextNudge(item.waiting.nextNudgeOn))
        break
      }
      out.push(
        balance,
        over,
        r?.dueOn ? { label: 'Was due', icon: CalendarDays, value: formatDay(r.dueOn) } : null,
        r ? { label: 'Reminded', icon: Hourglass, value: r.reminderCount > 0 ? `×${r.reminderCount}` : 'not yet', sub: r.lastRemindedOn ? `last ${formatDay(r.lastRemindedOn)}` : undefined } : null,
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

/** The rail once chased: asked or sent, today, and the "Next nudge" ring, up to the bid date. */
function NudgeRail({
  item,
  rfqDue,
  questions,
  inquirySent,
  today,
  nudgeOn,
}: {
  item: TodayItem
  rfqDue: string | null
  questions: TodayData['clarifications']
  inquirySent: string | null
  today: string
  nudgeOn: string | null
}) {
  const start = item.rule === 'chase_customer' ? questions.map(q => q.firstAskedOn).sort()[0] : item.rule === 'chase_supplier' ? inquirySent : null
  if (!start || !rfqDue || rfqDue <= start) return null
  const total = Math.max(1, daysSpan(start, rfqDue))
  const at = (d: string) => Math.min(100, Math.max(0, (daysSpan(start, d) / total) * 100))
  const pos = at(today)
  const nudgePos = nudgeOn ? at(nudgeOn) : null
  return (
    <div className="grid gap-1" aria-hidden="true">
      <RailLabels pos={pos} today={today} nudgeOn={nudgePos !== null ? nudgeOn : null} />
      <div className="relative h-1 rounded bg-selected">
        <span className="absolute inset-y-0 left-0 rounded bg-fg-muted" style={{ width: `${pos}%` }} />
        <span className="absolute -top-1 size-3 -translate-x-1/2 rounded-round bg-tone-warning-fg" style={{ left: `${pos}%` }} />
        {nudgePos !== null ? <span className="absolute -top-1 size-3 -translate-x-1/2 rounded-round border-2 border-fg-muted bg-surface" style={{ left: `${nudgePos}%` }} /> : null}
      </div>
      <div className="num flex justify-between text-xs text-fg-muted">
        <span>
          {item.rule === 'chase_customer' ? 'Asked' : 'Sent'} {formatDay(start)}
        </span>
        <span>Bid due {formatDay(rfqDue)}</span>
      </div>
    </div>
  )
}

/**
 * The two labels above the rail: "Today · day" at the marker and "Next nudge · day" at the right end. When the two would print on top of each
 * other (the nudge is a few days away on a narrow rail, a phone), the nudge label drops to a second line instead of overlapping.
 */
function RailLabels({ pos, today, nudgeOn }: { pos: number; today: string; nudgeOn: string | null }) {
  const wrap = useRef<HTMLDivElement>(null)
  const a = useRef<HTMLSpanElement>(null)
  const b = useRef<HTMLSpanElement>(null)
  const [stacked, setStacked] = useState(false)
  const [aw, setAw] = useState(0)
  useLayoutEffect(() => {
    const el = wrap.current
    if (!el || !nudgeOn) return
    const measure = () => {
      const w = el.clientWidth
      const wa = a.current?.offsetWidth ?? 0
      const wb = b.current?.offsetWidth ?? 0
      if (!w) return
      const left = Math.min((pos / 100) * w, w - wa)
      setAw(wa)
      setStacked(left + wa + 12 > w - wb)
    }
    measure()
    if (typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [pos, nudgeOn, today])
  return (
    <div ref={wrap} className={cn('relative', stacked ? 'h-9' : 'h-4')}>
      <span ref={a} className="num absolute top-0 whitespace-nowrap text-xs text-tone-warning-fg" style={{ left: `min(${pos}%, calc(100% - ${aw ? `${aw}px` : '7rem'}))` }}>
        Today · {formatDay(today)}
      </span>
      {nudgeOn ? (
        <span ref={b} className={cn('num absolute right-0 whitespace-nowrap text-xs text-fg-muted', stacked ? 'top-[18px]' : 'top-0')}>
          Next nudge · {formatDay(nudgeOn)}
        </span>
      ) : null}
    </div>
  )
}

const daysSpan = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000)

/** The compact "Chased today" card that replaces the draft once the item is in Waiting. */
function ChasedCard({
  item,
  today,
  verb,
  memo,
  contact,
  askedNow,
  lastAskedAt,
  onOpen,
  onAgain,
}: {
  item: TodayItem
  today: string
  verb: string
  memo: ReturnType<typeof chaseMemo>
  contact: { name: string } | null
  askedNow: number
  lastAskedAt: string | undefined
  onOpen: () => void
  onAgain: () => void
}) {
  const w = item.waiting
  if (!w) return null
  const days = Math.max(0, daysSpan(w.chasedOn, today))
  const title = days === 0 ? `${capital(verb)} today` : days === 1 ? `${capital(verb)} yesterday` : `${capital(verb)} ${days} days ago`
  const at = memo ? clockText(memo.at) : item.rule === 'chase_customer' && lastAskedAt && days === 0 ? clockText(lastAskedAt) : null
  const via = memo ? (memo.channel === 'email' ? 'Email' : 'WhatsApp') : null
  const who = contact?.name ?? null
  const counted = item.rule === 'chase_customer' && askedNow > 0 ? ` Asked ×${askedNow} now.` : ''
  const lead = via ? `${via} to ${who ?? 'them'}` : who ? `To ${who}` : capital(verb)
  const sentence = `${lead}${at ? `, copied at ${at}` : days === 0 ? ', copied today' : ''}.${counted}`
  const next =
    item.rule === 'chase_customer' && askedNow === 2
      ? 'A third ask suggests closing as no reply.'
      : item.rule === 'chase_supplier'
        ? 'Chased twice with no reply suggests floating to someone else.'
        : null
  const excerpt = memo ? excerptOf(memo.text) : null
  return (
    <section aria-label={title} className="grid overflow-hidden rounded border bg-surface">
      <div className="flex items-start justify-between gap-3 px-4 py-3">
        <div className="grid gap-px">
          <h3 className="text-base font-semibold">{title}</h3>
          <p className="text-sm text-fg-muted">{sentence}</p>
        </div>
        <span className="inline-flex shrink-0 items-center gap-1 text-sm text-tone-success-fg">
          <Icon icon={CircleCheck} size="sm" /> In Waiting
        </span>
      </div>
      {excerpt ? (
        <p className="line-clamp-2 border-t px-4 py-3 text-sm text-fg-2" data-testid="chased-excerpt">
          {excerpt}
        </p>
      ) : null}
      <div className="flex flex-wrap items-center gap-2 border-t bg-sunken px-4 py-3">
        <Button icon={ExternalLink} onClick={onOpen}>
          Open {item.ref}
        </Button>
        <Button variant="quiet" icon={AlarmClock} onClick={onAgain}>
          Chase again now
        </Button>
        {next ? <span className="ml-auto text-xs text-fg-muted">{next}</span> : null}
      </div>
    </section>
  )
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

/** Escalation for a customer: a suggestion, never automatic. */
function CloseNoReply({ item, today }: { item: TodayItem; today: string }) {

  const { toast } = useToast()
  const close = useSetRfqClosed(item.rfqId ?? '')
  const [dismissed, setDismissed] = useState(false)
  if (dismissed || !item.rfqId) return null
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
          <Button size="sm" onClick={() => setDismissed(true)}>
            Keep waiting
          </Button>
        </div>
      }
    >
      This is a suggestion. Nothing is closed for you. Closing records the reason “No reply to our questions”.
    </Banner>
  )
}

/** Snooze: tomorrow, Monday or a date. One snooze per rule and subject; Undo puts back what was there. */
export function SnoozeMenu({ item, today, iconOnly = false }: { item: TodayItem; today: string; iconOnly?: boolean }) {
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
  const short = (iso: string) => formatDay(iso).split(' ').slice(0, 2).join(' ')
  return (
    <>
      <Popover>
        <PopoverTrigger asChild>
          {iconOnly ? (
            <Button variant="secondary" icon={AlarmClockOff} aria-label="Snooze" size="touch" />
          ) : (
            <Button variant="quiet" icon={AlarmClockOff}>
              Snooze
            </Button>
          )}
        </PopoverTrigger>
        <PopoverContent variant="menu" align="end" aria-label="Snooze until">
          <MenuItem onClick={() => apply(tomorrow)} hint={short(tomorrow)}>
            Tomorrow morning
          </MenuItem>
          <MenuItem onClick={() => apply(monday)} hint={formatDay(monday)}>
            Monday
          </MenuItem>
          <MenuItem icon={CalendarDays} onClick={() => setPicking(true)} hint={<Icon icon={ChevronRight} size="sm" />}>
            Pick a date
          </MenuItem>
        </PopoverContent>
      </Popover>
      <Dialog open={picking} onOpenChange={setPicking}>
        <DialogContent
          title="Snooze until"
          context={`${item.ref} · ${item.party}`}
          icon={AlarmClockOff}
          footer={
            <>
              <Button data-cancel onClick={() => setPicking(false)}>
                Cancel
              </Button>
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
