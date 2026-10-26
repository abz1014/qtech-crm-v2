import { useMemo, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  AlarmClock,
  CalendarDays,
  Check,
  CircleCheck,
  Clock,
  ExternalLink,
  Hourglass,
  MessageCircleQuestion,
  Users,
  type LucideIcon,
} from 'lucide-react'
import { useSession } from '@/app/session'
import { mapPgError } from '@/lib/pgErrors'
import { copyToClipboard } from '@/lib/clipboard'
import { formatAmount } from '@/lib/money'
import { formatDay } from '@/lib/formatDay'
import { cn } from '@/lib/utils'
import { useChannelPreference } from '@/lib/useChannelPreference'
import { Banner } from '@/ui/Banner'
import { Breadcrumb } from '@/ui/Breadcrumb'
import { Button } from '@/ui/Button'
import { MessageActions } from '@/ui/MessageActions'
import { Icon } from '@/ui/Icon'
import { ChannelLink } from '@/ui/ChannelLink'
import { Skeleton } from '@/ui/Skeleton'
import { useToast } from '@/ui/useToast'
import { ChaseNote, FormattedMessage, RecipientRow, SubjectRow } from '@/features/rfqs/ChaseParts'
import { FloatElsewhere } from '@/features/rfqs/FloatElsewhere'
import { useChooseSuppliers } from '@/features/rfqs/escalationLogic'
import { useRfqHeader, useRfqInquiries, useRfqItems, useSetRfqClosed } from '@/features/rfqs/hooks'
import { COMPANY_NAME, customerReturnsOn, supplierReturnsOn } from '@/features/rfqs/lib'
import { SUPPLIER_WAIT_DAYS } from '@/features/rfqs/lib/chaseWait'
import { supplierChaseBaseDays } from '@/features/today/rules'
import { addBusinessDays } from '@/features/rfqs/lib/dateText'
import { isBidClose } from '@/features/rfqs/lib/customerChase'
import { closeReasonLabel, type CloseReason } from '@/features/rfqs/lib/closeDefaults'
import { chasedByText } from '@/features/rfqs/lib/collision'
import type { TodayData } from '@/features/today/api'
import { buildCustomerDraft, buildGoodsDraft, buildPaymentDraft, buildSupplierDraft, type Draft } from '@/features/today/chaseDraft'
import { chaseMemo, clockText, excerptOf, forgetChase, rememberChase } from '@/features/today/chaseMemory'
import { performChase, useLegDraft, usePaymentDraft, useRefreshAfterChase, type ChaseSpec } from '@/features/today/hooks'
import { SnoozeMenu } from '@/features/today/SnoozeMenu'
import type { TodayItem } from '@/features/today/types'
import { agoText, distanceText } from '@/features/today/text'
import { COUNT_WORDS_MAX_DAYS, sinceWords } from '@/lib/timeWords'
import { daysBetween } from '@/features/rfqs/lib/dateText'

/*
 * The context pane (direction B, g2-today-b2). Selecting a row shows what explains it and, for a chase, the message
 * already written. Owner decision 2026-10-19: each fact is said once (the four cells; no chip row and no date rail repeating
 * them), and the one job, "Copy and mark chased", sits right under the card's header, above the message, so it is
 * on the first screen of a 1366 x 768 laptop at the larger text size. States:
 *   draft        facts, "Prepared for you" with WhatsApp or Email, one tap: "Copy and mark chased"
 *   copied       the green "Copied. Paste it into WhatsApp." bar replaces the card header; the footer says
 *                "Chased today. Moves to Waiting when the undo closes." while the 10 s Undo is open (the toast)
 *   just chased  after the undo closes the row has joined Waiting: the title stays, a "Moved to Waiting" bar says when it
 *                returns, the cells switch to "Chased ..." and "Next nudge", the rail gains the nudge marker, a compact
 *                "Chased today" card replaces the draft, and "Chase again" brings the draft back
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
  // the person's last WhatsApp / Email choice, remembered on this device
  const [channel, setChannel] = useChannelPreference()
  const [busy, setBusy] = useState(false)
  // A WhatsApp / email link was opened for this item: offer the separate "Mark chased" tap (opening never marks).
  const [openedKey, setOpenedKey] = useState<string | null>(null)
  const opened = openedKey === item.key
  const [sentKey, setSentKey] = useState<string | null>(null)
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

  /** Stamps the chase with Undo. `copied`: the message was just copied (the copy button), else a link was opened. */
  const mark = async (copied: boolean) => {
    const lead = copied ? 'Copied. ' : ''
    const s = spec()
    if (!s) {
      toast({ title: copied ? 'Copied' : 'Nothing to mark', body: item.rule === 'payment_overdue' ? 'This order has no invoice to mark as reminded yet.' : copied ? 'Nothing to mark.' : 'There is nothing on this item to mark.', tone: 'neutral' })
      return
    }
    try {
      const r = await performChase(s)
      rememberChase(item.key, { channel, at: Date.now(), text })
      setAgain(false)
      setOpenedKey(null)
      setSentKey(copied ? null : item.key)
      onCopied(item.key)
      toast({
        title: `${lead}${item.ref} marked ${verb}.`,
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
      toast({ title: copied ? 'Copied, but it was not marked' : 'It was not marked', body: mapPgError(err).message, tone: 'danger' })
    }
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
      await mark(true)
    } finally {
      setBusy(false)
    }
  }

  const markOnly = async () => {
    if (!draft || busy) return
    setBusy(true)
    try {
      await mark(false)
    } finally {
      setBusy(false)
    }
  }

  const nudge = nudgeInfo(item, rfq?.dueOn ?? null, today, inquiryFact)
  const facts = factsFor(item, { rfq, questions, inquiryFact, legFact, receivable, today, pricedOf: priced(items.data, inquiries.data, item.inquiryId), justChased, nudge })
  const askedTimes = customerRule ? Math.max(0, ...questions.map(q => q.askCount)) : 0
  const floated = inquiries.data ? inquiries.data.filter(i => i.sentOn).length : 0
  const firstFloat = inquiries.data ? inquiries.data.map(i => i.sentOn).filter((d): d is string => Boolean(d)).sort()[0] : undefined

  // One label per action at every width (the glossary's short form), so help, toasts and the phone all name the same button.
  const copyLabel = item.rule === 'payment_overdue' ? 'Copy and mark reminded' : 'Copy and mark chased'
  const touch = compact ? 'min-h-touch' : ''

  return (
    <section aria-label={`${item.title}, ${item.ref}`} className="grid content-start gap-4">
      {compact ? null : (
        <header className="grid gap-1">
          <Breadcrumb className="mb-1" items={[{ label: 'To do', to: '/todo' }, { label: item.ref, mono: true }]} />
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
        </header>
      )}

      {item.collision && data.names[item.collision.by] ? (
        <p data-collision className="flex items-center gap-2 rounded-row border border-tone-warning-fg/25 bg-tone-warning-bg px-3 py-2 text-sm text-tone-warning-fg">
          <Icon icon={Users} size="sm" /> {chasedByText(data.names[item.collision.by], item.collision.at, Date.now())}. Check with them before you chase it again.
        </p>
      ) : null}

      {justChased && item.waiting ? (
        <div role="status" className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-row border border-tone-success-fg/25 bg-tone-success-bg px-4 py-3 text-sm text-tone-success-fg">
          <Icon icon={Hourglass} />
          <span className="min-w-0 flex-1 basis-[15rem]">
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
        <dl className={cn('grid grid-cols-2 overflow-hidden rounded-panel border bg-surface', !compact && 'lg:grid-cols-4')}>
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

      {item.escalation === 'close_no_reply' && !justChased ? <CloseNoReply item={item} today={today} /> : null}
      {item.rule === 'decision_overdue' && item.escalation !== 'close_no_reply' && !justChased ? <CloseLost item={item} today={today} /> : null}
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
        <div className="grid overflow-hidden rounded-panel border bg-surface">
          {wasCopied ? (
            <p role="status" className="flex items-center gap-2 bg-tone-success-bg px-4 py-3 text-sm text-tone-success-fg">
              <Icon icon={CircleCheck} size="sm" /> {sentKey === item.key ? `Marked ${verb}.` : `Copied. Paste it into ${channel === 'email' ? 'your email' : 'WhatsApp'}.`}
            </p>
          ) : (
            <div className="flex flex-wrap items-center justify-between gap-3 border-b px-4 py-3">
              <div className="grid gap-px">
                <h3 className="text-base font-semibold">Prepared for you</h3>
                {compact ? null : <p className="text-sm text-fg-muted">{preparedFrom(item, questions.length)} Edit anything before you send.</p>}
              </div>
              {/* The remembered channel as a link (R2-07); Open in WhatsApp / Open in email is MessageActions, in the row below. */}
              <ChannelLink value={channel} onChange={setChannel} />
            </div>
          )}
          {!compact && !wasCopied ? (
            <div className="flex flex-wrap items-center gap-2 border-b bg-sunken px-4 py-3" data-testid="pane-actions">
              <MessageActions
                to={draft.contact}
                text={draft.whatsapp.body}
                email={{ subject: draft.email.subject, body: draft.email.body }}
                variant={opened ? 'secondary' : 'primary'}
                copy={{ label: copyLabel, onCopy: copyAndMark, busy, busyLabel: 'Marking' }}
                onOpen={() => setOpenedKey(item.key)}
                channel={channel}
                onChannelChange={setChannel}
              />
              {opened ? (
                <Button variant="primary" icon={Check} busy={busy} busyLabel="Marking" onClick={() => void markOnly()}>
                  Mark {verb}
                </Button>
              ) : null}
              <Button icon={ExternalLink} onClick={() => navigate(item.href)}>
                Open {item.ref}
              </Button>
              <div className="ml-auto">
                <SnoozeMenu item={item} today={today} />
              </div>
            </div>
          ) : null}
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
            <div className="grid gap-2 border-t bg-sunken px-4 py-3">
              <MessageActions
                to={draft.contact}
                text={draft.whatsapp.body}
                email={{ subject: draft.email.subject, body: draft.email.body }}
                variant={opened ? 'secondary' : 'primary'}
                size="touch"
                fill
                copy={{ label: copyLabel, onCopy: copyAndMark, busy, busyLabel: 'Marking' }}
                onOpen={() => setOpenedKey(item.key)}
                channel={channel}
                onChannelChange={setChannel}
              />
              <div className="flex items-center gap-2">
                {opened ? (
                  <Button variant="primary" icon={Check} busy={busy} busyLabel="Marking" onClick={() => void markOnly()} className={cn('flex-1', touch)}>
                    Mark {verb}
                  </Button>
                ) : null}
                <SnoozeMenu item={item} today={today} iconOnly />
              </div>
            </div>
          ) : null}
        </div>
      ) : isChase(item) && (draftReady || !pending(header, items, inquiries, leg, payment)) ? (
        <div className="flex flex-wrap items-center gap-2 rounded-panel border bg-surface p-4">
          <p className="mr-auto text-sm text-fg-muted">{noDraftText(item)}</p>
          <Button icon={ExternalLink} onClick={() => navigate(item.href)}>
            Open {item.ref}
          </Button>
          <SnoozeMenu item={item} today={today} />
        </div>
      ) : isChase(item) ? (
        <div className="grid gap-2 rounded-panel border bg-surface p-4" aria-busy="true">
          <Skeleton className="h-4 w-1/3" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-5/6" />
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-2 rounded-panel border bg-surface p-4">
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
          <section aria-label="Open questions" className="grid content-start gap-2 rounded-panel border bg-surface p-4">
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
          <section aria-label="What happened" className="grid content-start gap-2 rounded-panel border bg-surface p-4">
            <h3 className="text-base font-semibold">What happened</h3>
            <ul className="grid gap-2 text-sm">
              {rfq ? <Event on={rfq.receivedOn} text="RFQ received from customer" /> : null}
              {firstFloat ? <Event on={firstFloat} text={`Asked ${floated} ${floated === 1 ? 'supplier' : 'suppliers'} for prices`} /> : null}
              <Event on={questions.map(q => q.firstAskedOn).sort()[0]} text={`${questions.length} ${questions.length === 1 ? 'question' : 'questions'} sent to customer`} />
              {item.waiting ? (
                <>
                  <Event on={item.waiting.chasedOn} text={`Chased customer, asked ×${askedTimes}`} warn />
                  <Event on={item.waiting.nextNudgeOn} text="Chase again if no reply" />
                </>
              ) : (
                <Event on={today} text="Not chased yet" warn />
              )}
            </ul>
          </section>
        </div>
      ) : null}
      {item.rule === 'goods_late' && leg.data && leg.data.items.length > 0 && !compact ? (
        <section aria-label="Goods on this order" className="grid gap-2 rounded-panel border bg-surface p-4">
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

/** "3 days" for "Late by" / "Overdue by"; past 30 days a count says nothing, so "since 5 Jan 2025" (redesign phase 0). */
function lateBy(dueOn: string, today: string): string {
  return daysBetween(dueOn, today) > COUNT_WORDS_MAX_DAYS ? sinceWords(dueOn) : distanceText(dueOn, today).replace(' late', '')
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

// Exported for its unit test (nudgeInfo.test.ts); it is a pure helper beside the pane that uses it.
// eslint-disable-next-line react-refresh/only-export-components
export function nudgeInfo(item: TodayItem, dueOn: string | null, today: string, inquiry?: Pick<TodayData['inquiries'][number], 'replied' | 'medianReplyDays'>): { returnsOn: string; why: string } {
  const close = isBidClose(dueOn, today)
  switch (item.rule) {
    case 'chase_customer':
      return { returnsOn: customerReturnsOn(today, dueOn), why: close ? 'short wait: quotation due soon' : '3 working days' }
    case 'chase_supplier': {
      // The same wait the rule uses: a slow supplier's own median plus one, not always 2.
      const base = inquiry ? supplierChaseBaseDays(inquiry) : SUPPLIER_WAIT_DAYS
      return { returnsOn: supplierReturnsOn(today, dueOn, base), why: close ? 'short wait: quotation due soon' : `${base} working days` }
    }
    case 'goods_late':
      return { returnsOn: addBusinessDays(today, 3), why: '3 working days' }
    default:
      return { returnsOn: addBusinessDays(today, 7), why: '7 working days' }
  }
}

function noDraftText(item: TodayItem): string {
  if (item.rule === 'chase_supplier') return 'Every item has a price or a "Can’t quote" from this supplier. Nothing to ask.'
  if (item.rule === 'goods_late') return 'There is no expected date on this order, so there is nothing to chase. Open the order.'
  return 'There is nothing to write for this item yet. Open the record.'
}

function howTo(item: TodayItem): string {
  switch (item.rule) {
    case 'relay_answers':
      return 'The customer has answered what this supplier asked. Open the RFQ to send the answers back to them.'
    case 'not_floated':
      return 'Nobody has been asked for a price yet. Open the RFQ to pick suppliers and send the enquiry.'
    case 'bid_due':
      return 'The quotation is still to send. Open the RFQ to issue it.'
    case 'decision_overdue':
      return 'No decision since the quotation went out. Chase the customer, or close it here if they said no.'
    case 'place_po':
      return 'A supplier on this order has no PO yet. Open the order and send the PO.'
    case 'to_source':
      return 'Some goods on this won order have no supplier yet. Open the order and give each line a supplier, or mark it a service.'
    case 'plan_commissioning':
      return 'This order needs commissioning and has no planned date. Open the order and set the planned date.'
    case 'delivered_not_invoiced':
      return 'Everything on this order has been delivered and no invoice exists. Open the order to invoice it.'
    case 'close_month':
      return 'Open the month-end checklist, look at what it lists and close the month. Nothing blocks closing; each check is a warning.'
    case 'costs_incomplete':
      return 'These orders are paid in full but their costs are not marked complete, so their margin is not final. Open Margins, check the costs and mark each order complete.'
    case 'fbr_attention':
      return 'The GST on these invoices is not deposited with FBR and the month is over, or an FBR step was recorded out of order. Open Invoices & GST, which is filtered to them.'
    case 'tcs_not_sent':
      return 'These invoices have no courier (TCS) date three working days after the invoice. Open Invoices & GST, tick them and press "Sent to customer today" once.'
    case 'job_commissioning':
      return 'You are an engineer on this order. Open it to see the site contact and the notes, then "Mark done today" when the commissioning is finished, or change the planned date.'
    case 'job_on_site':
      return 'The goods have reached the site and the commissioning has no date yet. Open the order and set the planned date.'
    case 'weekly_review':
      return 'Quotations nobody decided, enquiries nobody asked suppliers about, goods and payments far past their date. Decide each one: still live, chase, or close as lost.'
    case 'recurring_due':
      return 'These recurring expenses have no entry for this month yet. Open Expenses and record each one; it is one tap.'
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
  const bid: Fact | null = rfq?.dueOn ? { label: 'Quotation due in', short: 'Quotation due', icon: CalendarDays, value: distanceText(rfq.dueOn, today), sub: formatDay(rfq.dueOn), tone: rfq.dueOn <= today ? 'danger' : undefined } : null
  /** The two cells that change once it has been chased: "Chased ..." and "Next nudge". */
  const chased = (who: string, count: number, on: string): Fact => ({
    label: `Chased ${who}`,
    short: 'Chased',
    icon: Check,
    tone: 'success',
    value: on === today ? 'Today' : agoText(on, today).replace(/^\w/, ch => ch.toUpperCase()),
    sub: `${formatDay(on)} · ${count > 0 ? `${who === 'customer' ? 'asked' : 'chase'} ×${count}` : 'once'}`,
  })
  const nextNudge = (on: string): Fact => ({ label: 'Chase again on', short: 'Chase again', icon: Hourglass, value: formatDay(on), sub: c.nudge.why })
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
      const sent: Fact | null = i?.sentOn ? { label: 'Asked suppliers', icon: Clock, value: formatDay(i.sentOn) } : null
      if (c.justChased && item.waiting) {
        out.push(pricedFact, sent, chased('supplier', i?.chaseCount ?? 1, item.waiting.chasedOn), nextNudge(item.waiting.nextNudgeOn))
        break
      }
      out.push(pricedFact, sent, i ? { label: 'Chased', icon: Hourglass, value: i.chaseCount > 0 ? `×${i.chaseCount}` : 'not yet', sub: i.lastChasedOn ? `last ${formatDay(i.lastChasedOn)}` : undefined } : null, bid)
      break
    }
    case 'goods_late': {
      const l = c.legFact
      const late: Fact | null = l?.expectedOn ? { label: 'Late by', icon: Clock, value: lateBy(l.expectedOn, today), tone: 'danger' } : null
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
      const over: Fact | null = r?.dueOn ? { label: 'Overdue by', icon: Clock, value: lateBy(r.dueOn, today), tone: 'danger' } : null
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
      out.push({ label: 'Supplier', value: item.title.split('send it to ')[1] ?? '' }, rfq ? { label: 'RFQ received', value: formatDay(rfq.receivedOn) } : null, bid)
      break
    case 'not_floated':
    case 'bid_due':
      out.push(rfq ? { label: 'RFQ received', value: formatDay(rfq.receivedOn), sub: agoText(rfq.receivedOn, today) } : null, bid)
      break
    case 'decision_overdue':
      out.push(rfq?.quotedOn ? { label: 'Quotation sent', value: formatDay(rfq.quotedOn), sub: agoText(rfq.quotedOn, today) } : null)
      break
    case 'place_po': {
      const l = c.legFact
      out.push(l ? { label: 'Order', value: item.ref } : null, l?.orderedOn ? { label: 'Ordered', value: formatDay(l.orderedOn), sub: agoText(l.orderedOn, today) } : null)
      break
    }
    case 'job_commissioning':
    case 'job_on_site':
      out.push({ label: 'Order', value: item.ref }, { label: 'Customer and site', value: item.party })
      break
    default:
      break
  }
  return out.filter((f): f is Fact => f !== null)
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
        ? 'Chased twice with no reply: ask another supplier.'
        : null
  const excerpt = memo ? excerptOf(memo.text) : null
  return (
    <section aria-label={title} className="grid overflow-hidden rounded-panel border bg-surface">
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
          Chase again
        </Button>
        {next ? <span className="ml-auto text-xs text-fg-muted">{next}</span> : null}
      </div>
    </section>
  )
}

/** Escalation for a customer: a suggestion, never automatic. */
function CloseNoReply({ item, today }: { item: TodayItem; today: string }) {
  return (
    <CloseRfqBanner item={item} today={today} title="3 chases, no answer" reasons={['no_reply_to_clarification']} buttonLabel={() => 'Close as no reply'}>
      This is a suggestion. Nothing is closed for you. Closing records the reason “No reply to our questions”.
    </CloseRfqBanner>
  )
}

/** "Decision overdue": lose it here, without opening the RFQ (entry-burden J6). Secondary buttons; Undo in the toast. */
function CloseLost({ item, today }: { item: TodayItem; today: string }) {
  return (
    <CloseRfqBanner item={item} today={today} title="No decision yet" reasons={['price', 'competitor']} buttonLabel={r => (r === 'price' ? 'Lost on price' : 'Lost to a competitor')}>
      If the customer has said no, close it here. Nothing is closed for you.
    </CloseRfqBanner>
  )
}

function CloseRfqBanner({
  item,
  today,
  title,
  reasons,
  buttonLabel,
  children,
}: {
  item: TodayItem
  today: string
  title: string
  reasons: CloseReason[]
  buttonLabel: (r: CloseReason) => string
  children: ReactNode
}) {
  const { toast } = useToast()
  const close = useSetRfqClosed(item.rfqId ?? '')
  const [dismissed, setDismissed] = useState(false)
  if (dismissed || !item.rfqId) return null
  return (
    <Banner
      tone="warning"
      title={title}
      action={
        <div className="flex flex-wrap gap-2">
          {reasons.map(reason => (
            <Button
              key={reason}
              size="sm"
              busy={close.isPending && close.variables?.reason === reason}
              busyLabel="Closing"
              disabled={close.isPending}
              onClick={() =>
                close.mutate(
                  { closedOn: today, reason, note: null },
                  {
                    onSuccess: () =>
                      toast({
                        title: `Closed ${item.ref}`,
                        body: closeReasonLabel(reason),
                        tone: 'success',
                        undo: { onUndo: () => close.mutateAsync({ closedOn: null, reason: null, note: null }).then(() => undefined) },
                      }),
                    onError: err => toast({ title: 'Could not close it', body: mapPgError(err).message, tone: 'danger' }),
                  },
                )
              }
            >
              {buttonLabel(reason)}
            </Button>
          ))}
          <Button size="sm" onClick={() => setDismissed(true)}>
            Keep waiting
          </Button>
        </div>
      }
    >
      {children}
    </Banner>
  )
}

