import { Fragment } from 'react'
import { Link } from 'react-router-dom'
import {
  Calendar,
  ChevronDown,
  Copy,
  FileCheck2,
  FilePlus2,
  FileText,
  Flag,
  MapPin,
  MessageCircle,
  Package,
  RotateCcw,
  UserRound,
  Users,
  type LucideIcon,
} from 'lucide-react'
import { businessToday } from '@/lib/dates'
import { formatDay } from '@/lib/formatDay'
import { mapPgError } from '@/lib/pgErrors'
import { orderRef, rfqRef } from '@/lib/refs'
import type { StatusDimension } from '@/lib/status'
import { NextStepBox } from '@/ui/NextStepBox'
import { ROLE_LABEL } from '@/app/session'
import { useMobileBar } from '@/app/shell/MobileBarContext'
import { Avatar } from '@/ui/Avatar'
import { Button } from '@/ui/Button'
import { DetailHeader } from '@/ui/DetailHeader'
import { Icon } from '@/ui/Icon'
import { MoreMenu } from '@/ui/MoreMenu'
import { MenuItem, MenuSeparator, Popover, PopoverContent, PopoverTrigger } from '@/ui/Popover'
import { StatusBadge } from '@/ui/StatusBadge'
import { StickyActionBar } from '@/ui/StickyActionBar'
import { useToast } from '@/ui/useToast'
import type { RfqHeader } from '@/features/rfqs/api'
import { useSetBidSent, useSetRfqClosed } from '@/features/rfqs/hooks'
import { useOrdersForRfq } from '@/features/orders/hooks'
import { useWonDialog } from '@/features/orders/useWonDialog'
import { useIssueDialog } from '@/features/quotations/useIssueDialog'
import {
  CLOSE_REASONS,
  closeReasonLabel,
  defaultCloseReason,
  dueChipLabel,
  dueIsUrgent,
  dueSubLabel,
  nextStepSentence,
  quotationSent,
  refBreaks,
  stageKey,
  type CloseReason,
  type RfqPrimary,
} from '@/features/rfqs/lib'

/*
 * The top of the RFQ page (g2-rfq-detail header, the phone bar and the action bar), reworked by the UX audit of 2026-10-19:
 *   - who it is for first (the company), then the code;
 *   - at most two chips: the stage, in the board's next-step words, and the due date when it is two days or less away or past
 *     (orange, as the Quotation due tile then is; grade-B R7). Once a quotation is out there is no due chip: "Sent Thu 22 Oct ·
 *     valid to Sat 21 Nov" instead, and the Next step is "Follow up with <contact>" with Mark won green and a quiet "Mark lost"
 *     menu of reasons beside it (grade-B R6);
 *   - exactly one green button, chosen by state (lib/nextAction.ts): Ask suppliers, then Issue quotation, then Mark won (and while
 *     waiting for prices, Chase suppliers, which goes to the chase in the side column). It sits in a labelled "Next step" box under
 *     the title, with a sentence saying why (coordinator decision 2026-10-20: every detail page, the pattern ux/orders built; this
 *     mirrors that branch's NextStep markup, which is not merged yet). The header itself has no primary button. Everything else is
 *     in one "More" menu: the other two, Mark quotation sent (no PDF), Quotation sent again, and the reasons to close. Mark won is
 *     never the button before a quotation exists, but stays in More for the odd case (a win by phone).
 *   - closed: the box says when and why, with Reopen and Mark won (a customer may order after it was closed: converting reopens
 *     it); won: the box links to the order.
 *   - Issue quotation is never silently disabled: it opens whenever the RFQ has an item (prices can be typed in the dialog); with no
 *     item the menu says why.
 * Mark quotation sent and closing both have an Undo.
 *
 * Phone (375): a page bar with back and the number; the company on one line; four meta cells; and the shared StickyActionBar at
 * the foot with the same one green action, a Chase menu (suppliers, customer) and More.
 *
 * Round-2 spec 5.3 and 1.5: drawn with src/ui/DetailHeader. The h1 is the company name, a link to the company (so the facts strip has
 * no "Company" cell), with the code beside it; the chip row holds the stage (StatusBadge, `rfq-stage` or the outcome, from
 * lib/nextAction.ts stageKey) and the due date; the meta line holds Top priority and how long they have been a customer.
 */

export interface HeaderFacts {
  /** The green action (lib/nextAction.ts). */
  primary: RfqPrimary
  itemCount: number
  quotationCount: number
  /** Opens the "Ask suppliers" list. */
  onAsk: () => void
  /** Suppliers asked who have not replied yet, for the Next step sentence. */
  awaiting?: number
  /** When the latest quotation went out (or the RFQ was marked quotation sent), and until when it is valid (grade-B R6). */
  sentOn?: string | null
  validUntil?: string | null
}

// ------------------------------------------------------------------------------------------------ the actions

/** Go to the chase in the side column (Suppliers asked) and put the focus on its copy button. */
function goToChase() {
  window.setTimeout(() => {
    const panel = document.querySelector('[data-slot="suppliers-asked"]')
    panel?.scrollIntoView({ block: 'start' })
    panel?.querySelector<HTMLElement>('[data-chase-copy]')?.focus({ preventScroll: true })
  }, 60)
}

/** Mark quotation sent, Quotation sent again and Close because...: one set of actions, used by the header menu and both phone menus. */
function useQuoteAndClose(rfq: RfqHeader) {
  const { toast } = useToast()
  const bid = useSetBidSent(rfq.id)
  const closeRfq = useSetRfqClosed(rfq.id)
  const ref = rfqRef(rfq.number)
  const s = rfq.state

  const markSent = async (again: boolean) => {
    const before = rfq.quotedOn
    try {
      await bid.mutateAsync(businessToday())
      toast({
        title: again ? 'Quotation date updated' : 'Marked quotation sent',
        body: `${ref} · ${rfq.company.name}`,
        undo: {
          onUndo: async () => {
            await bid.mutateAsync(before)
          },
          settledTitle: again ? 'Quotation date updated' : 'Marked quotation sent',
          undoneTitle: again ? 'Date put back' : 'Quotation sent taken back',
        },
      })
    } catch (err) {
      toast({ title: 'Could not mark the quotation sent', body: mapPgError(err, { entity: 'RFQ' }).message, tone: 'danger' })
    }
  }

  const close = async (reason: CloseReason) => {
    try {
      await closeRfq.mutateAsync({ closedOn: businessToday(), reason, note: null })
      toast({
        title: 'Closed',
        body: `${ref} · ${closeReasonLabel(reason)}`,
        undo: {
          onUndo: async () => {
            await closeRfq.mutateAsync({ closedOn: null, reason: null, note: null })
          },
          settledTitle: 'Closed',
          undoneTitle: 'Reopened',
        },
      })
    } catch (err) {
      toast({ title: 'Could not close the RFQ', body: mapPgError(err, { entity: 'RFQ' }).message, tone: 'danger' })
    }
  }

  const reopen = async () => {
    const before = { closedOn: rfq.closedOn, reason: rfq.closeReason, note: rfq.closeNote }
    try {
      await closeRfq.mutateAsync({ closedOn: null, reason: null, note: null })
      toast({
        title: 'Reopened',
        body: `${ref} is open again`,
        undo: {
          onUndo: async () => {
            await closeRfq.mutateAsync(before)
          },
          settledTitle: 'Reopened',
          undoneTitle: 'Closed again',
        },
      })
    } catch (err) {
      toast({ title: 'Could not reopen', body: mapPgError(err, { entity: 'RFQ' }).message, tone: 'danger' })
    }
  }

  const suggested = s
    ? defaultCloseReason({ sourcingState: s.sourcing_state, clarificationState: s.clarification_state, bidState: s.bid_state, isOverdue: Boolean(s.is_overdue) })
    : 'other'
  return { markSent, close, reopen, suggested, busy: bid.isPending || closeRfq.isPending }
}

type Actions = ReturnType<typeof useQuoteAndClose>

/** The three main actions and what each one does, so the header, the menus and the phone bar say the same thing. */
function useMainActions(rfq: RfqHeader, facts: HeaderFacts) {
  const [, setIssue] = useIssueDialog()
  const [, setWon] = useWonDialog()
  const orders = useOrdersForRfq(rfq.id)
  const liveOrders = (orders.data ?? []).filter(o => !o.cancelledOn)
  const asked = (rfq.state?.floated ?? 0) > 0
  return {
    liveOrders,
    askLabel: asked ? 'Ask more suppliers' : 'Ask suppliers',
    issueLabel: facts.quotationCount > 0 ? 'Revise quotation' : 'Issue quotation',
    ask: facts.onAsk,
    issue: () => setIssue(true),
    won: () => setWon(true),
    canWin: rfq.state?.outcome !== 'won' && liveOrders.length === 0,
  }
}

/** The "More" menu: everything that is not the green button. */
function MoreItems({ rfq, facts, actions }: { rfq: RfqHeader; facts: HeaderFacts; actions: Actions }) {
  const main = useMainActions(rfq, facts)
  const sent = quotationSent({ bidState: rfq.state?.bid_state, quotationCount: facts.quotationCount })
  const noItems = facts.itemCount === 0
  return (
    <>
      {facts.primary !== 'ask' ? (
        <MenuItem icon={Copy} disabled={noItems} hint={noItems ? 'add an item first' : undefined} onClick={main.ask}>
          {main.askLabel}
        </MenuItem>
      ) : null}
      {facts.primary !== 'issue' ? (
        <MenuItem icon={FilePlus2} disabled={noItems} hint={noItems ? 'add an item first' : undefined} onClick={main.issue}>
          {main.issueLabel}
        </MenuItem>
      ) : null}
      {facts.primary !== 'won' && main.canWin ? (
        <MenuItem icon={FileCheck2} hint={sent ? undefined : 'no quotation yet'} onClick={main.won}>
          Mark won
        </MenuItem>
      ) : null}
      {sent ? (
        <MenuItem hint="updates the date" onClick={() => void actions.markSent(true)}>
          Quotation sent again
        </MenuItem>
      ) : (
        <MenuItem hint="no PDF" onClick={() => void actions.markSent(false)}>
          Mark quotation sent
        </MenuItem>
      )}
      <MenuSeparator />
      <p role="none" className="px-2 pb-1 pt-1 text-sm text-fg-muted">
        Close the RFQ because
      </p>
      {CLOSE_REASONS.map(r => (
        <MenuItem key={r.value} hint={r.value === actions.suggested ? 'suggested' : undefined} onClick={() => void actions.close(r.value)}>
          {r.label}
        </MenuItem>
      ))}
    </>
  )
}

/** The page's More menu (src/ui/MoreMenu): the "More" text button on desktop, the Ellipsis in the phone bar. */
function RfqMoreMenu({ rfq, facts, actions, touch = false }: { rfq: RfqHeader; facts: HeaderFacts; actions: Actions; touch?: boolean }) {
  return (
    <MoreMenu touch={touch} side={touch ? 'top' : undefined} label={touch ? 'More actions' : 'More'} menuClassName="min-w-[300px]">
      <MoreItems rfq={rfq} facts={facts} actions={actions} />
    </MoreMenu>
  )
}

/**
 * The green button for the state. `size` is md in the header and touch in the phone bar. Both carry the data-slot (issue-quotation
 * R19, mark-won O01, ask-suppliers): only one of the two is ever displayed (md:hidden / max-md:hidden), so a slot names one visible button.
 */
function PrimaryButton({ rfq, facts, size = 'md', className }: { rfq: RfqHeader; facts: HeaderFacts; size?: 'md' | 'touch'; className?: string }) {
  const main = useMainActions(rfq, facts)
  const wrap = (name: string, button: React.ReactNode) => (
    <span data-slot={name} className="contents">
      {button}
    </span>
  )
  switch (facts.primary) {
    case 'ask':
      return wrap(
        'ask-suppliers',
        <Button variant="primary" size={size} icon={Copy} className={className} onClick={main.ask}>
          {main.askLabel}
        </Button>,
      )
    case 'issue':
      return wrap(
        'issue-quotation',
        <Button variant="primary" size={size} icon={FilePlus2} className={className} onClick={main.issue}>
          {main.issueLabel}
        </Button>,
      )
    case 'won':
      return main.canWin
        ? wrap(
            'mark-won',
            <Button variant="primary" size={size} icon={FileCheck2} className={className} onClick={main.won}>
              Mark won
            </Button>,
          )
        : null
    case 'chase':
      return wrap(
        'chase-suppliers',
        <Button variant="primary" size={size} icon={MessageCircle} className={className} onClick={goToChase}>
          Chase suppliers
        </Button>,
      )
    default:
      return null
  }
}

/**
 * The "Next step" box under the title: one sentence (what to do, or what the RFQ waits for) and the one green button. On a phone the
 * button is in the sticky bar at the foot instead, so the box keeps the sentence. Closed: when and why, with Reopen and Mark won
 * (neither green). Won: the way to the order.
 */
function RfqNextStep({ rfq, facts, actions }: { rfq: RfqHeader; facts: HeaderFacts; actions: Actions }) {
  const main = useMainActions(rfq, facts)
  const s = rfq.state
  const outcome = s?.outcome ?? 'open'
  let text: string
  let action: React.ReactNode = null
  let quiet = false
  if (main.liveOrders.length > 0) {
    text = main.liveOrders.length === 1 ? `Won. Order ${orderRef(main.liveOrders[0].number)} carries it from here.` : `Won. ${main.liveOrders.length} orders carry it from here.`
    // data-slot="mark-won" (O01): once there is an order, the way to it.
    action = (
      <span data-slot="mark-won" className="flex flex-wrap gap-2">
        {main.liveOrders.map(o => (
          <Link key={o.id} to={`/orders/${o.id}`} className="inline-flex h-control items-center gap-2 rounded border border-primary bg-primary px-3 text-sm font-medium text-primary-foreground hover:bg-primary-hover">
            <Icon icon={Package} />
            Open {orderRef(o.number)}
          </Link>
        ))}
      </span>
    )
  } else if (outcome === 'closed') {
    quiet = true
    text = `Closed ${rfq.closedOn ? formatDay(rfq.closedOn) : ''}: ${closeReasonLabel(rfq.closeReason)}.${rfq.closeNote ? ` ${rfq.closeNote}` : ''}`
    action = (
      <div className="flex flex-wrap gap-2">
        <Button icon={RotateCcw} onClick={() => void actions.reopen()} busy={actions.busy} busyLabel="Reopening">
          Reopen
        </Button>
        {main.canWin ? (
          <span data-slot="mark-won" className="contents">
            <Button icon={FileCheck2} onClick={main.won}>
              Mark won
            </Button>
          </span>
        ) : null}
      </div>
    )
  } else if (outcome !== 'open') {
    quiet = true
    text = 'Won.'
  } else {
    quiet = facts.primary === 'none'
    text = nextStepSentence({
      primary: facts.primary,
      sourcingState: s?.sourcing_state,
      bidState: s?.bid_state,
      itemCount: facts.itemCount,
      awaiting: facts.awaiting ?? 0,
      contactName: rfq.contact?.name,
    })
    action = quiet ? null : <PrimaryButton rfq={rfq} facts={facts} className="max-md:hidden" />
    // Quotation sent (grade-B R6): Mark won is the green button, "Mark lost" a quiet menu of reasons beside it.
    if (facts.primary === 'won') {
      action = (
        <div className="flex flex-wrap items-center gap-2">
          <MarkLost actions={actions} />
          {action}
        </div>
      )
    }
  }
  return <NextStepBox text={text} tone={quiet ? 'quiet' : 'action'} action={action} />
}

/** "Mark lost": a quiet button with the reasons to close (the same list as More), one tap each. */
function MarkLost({ actions }: { actions: Actions }) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="quiet" className="underline underline-offset-2" disabled={actions.busy}>
          Mark lost
          <Icon icon={ChevronDown} size="sm" />
        </Button>
      </PopoverTrigger>
      <PopoverContent variant="menu" align="end" className="min-w-[280px]" aria-label="Lost because">
        <p role="none" className="px-2 pb-1 pt-1 text-sm text-fg-muted">
          Lost because
        </p>
        {CLOSE_REASONS.map(r => (
          <MenuItem key={r.value} hint={r.value === actions.suggested ? 'suggested' : undefined} onClick={() => void actions.close(r.value)}>
            {r.label}
          </MenuItem>
        ))}
      </PopoverContent>
    </Popover>
  )
}

// ------------------------------------------------------------------------------------------------ the meta strip

function Meta({
  icon,
  label,
  children,
  sub,
  tone,
  phone,
}: {
  icon: LucideIcon
  label: string
  children: React.ReactNode
  sub?: React.ReactNode
  tone?: 'warn'
  /** Shown on the phone (the four cells of the 375 layout); the others are tablet and up. */
  phone?: boolean
}) {
  return (
    <div className={`min-w-0 content-start gap-[2px] px-4 py-3 ${phone ? 'grid' : 'hidden md:grid'}`}>
      <dt className={`flex items-center gap-1 text-sm ${tone === 'warn' ? 'text-tone-warning-fg' : 'text-fg-muted'}`}>
        <span className="max-md:hidden">
          <Icon icon={icon} size="chip" />
        </span>
        {label}
      </dt>
      <dd className="m-0 min-w-0 break-words font-medium">{children}</dd>
      {sub ? <dd className="m-0 text-sm text-fg-muted">{sub}</dd> : null}
    </div>
  )
}

// ------------------------------------------------------------------------------------------------ the header

export function RfqHeaderBlock({ rfq, facts }: { rfq: RfqHeader; facts: HeaderFacts }) {
  const actions = useQuoteAndClose(rfq)
  const main = useMainActions(rfq, facts)
  const s = rfq.state
  const ref = rfqRef(rfq.number)
  const open = (s?.outcome ?? 'open') === 'open'
  const dueIn = s?.days_to_due
  // Once a quotation is out the due date is history: no red "overdue" chip, the chip says when it was sent instead (grade-B R6).
  const sent = quotationSent({ bidState: s?.bid_state, quotationCount: facts.quotationCount })
  // Orange (the chip and the tile) only when the due date is two days or less away, or past (grade-B R7).
  const urgent = open && !sent && dueIsUrgent(dueIn, Boolean(s?.is_overdue))
  const due = urgent ? dueChipLabel(dueIn, Boolean(s?.is_overdue)) : null
  const sentText = open && sent && facts.sentOn ? `Sent ${formatDay(facts.sentOn)}${facts.validUntil ? ` · valid to ${formatDay(facts.validUntil)}` : ''}` : null
  const since = rfq.company.createdAt ? rfq.company.createdAt.slice(0, 4) : null
  // The stage chip is a registry key (rfq-stage while open, else the outcome): the same words and tone as the board's Next step.
  const [stageDim, stageValue] = stageKey({
    outcome: s?.outcome ?? 'open',
    hasOrder: main.liveOrders.length > 0,
    sourcingState: s?.sourcing_state,
    bidState: s?.bid_state,
    quotationCount: facts.quotationCount,
  }).split(':') as [StatusDimension, string]

  // Phone: ONE bar (UX audit rec. 17): back to where the person came from (Today, an order, a company; the RFQ list when there is
  // no earlier screen) and the number. While the RFQ is open its sticky action bar at the foot carries the green action, Chase and
  // More (in thumb reach, so More is not repeated up here), and the bottom tabs step aside.
  useMobileBar({ title: ref, back: 'history', fallback: '/rfqs', hideTabs: open })

  return (
    <DetailHeader
      name={rfq.company.name}
      nameHref={`/companies/${rfq.company.id}`}
      code={ref}
      breadcrumb={[{ label: 'RFQs', to: '/rfqs' }, { label: ref, mono: true }]}
      more={open ? <RfqMoreMenu rfq={rfq} facts={facts} actions={actions} /> : undefined}
      chips={
        <>
          <span data-stage className="contents">
            <StatusBadge dimension={stageDim} value={stageValue} />
          </span>
          {due ? <StatusBadge dimension="deadline" value={s?.is_overdue ? 'overdue' : 'due-soon'} label={due} /> : null}
          {sentText ? (
            <span data-sent className="num text-sm text-fg-2">
              {sentText}
            </span>
          ) : null}
        </>
      }
      meta={[
        rfq.isPriority ? (
          <span className="inline-flex items-center gap-1 font-medium text-tone-warning-fg">
            <Icon icon={Flag} size="sm" />
            Top priority
          </span>
        ) : null,
        since ? `Customer since ${since}` : 'New customer',
      ]}
    >
      <RfqNextStep rfq={rfq} facts={facts} actions={actions} />

      <dl className="mt-4 grid grid-cols-2 divide-x divide-y rounded border bg-surface md:grid-cols-3 xl:grid-cols-5 [&>*]:border-line">
        <Meta icon={FileText} label="Customer ref" phone sub={`Received ${formatDay(rfq.receivedOn)}`}>
          {/* A long ref ("RFF/PUR/261/1") breaks after its separators on a 320 phone, never mid-number (grade-B R8). */}
          <span className="num [overflow-wrap:anywhere]">
            {rfq.customerRef
              ? refBreaks(rfq.customerRef).map((part, n) => (
                  <Fragment key={n}>
                    {part}
                    <wbr />
                  </Fragment>
                ))
              : 'None given'}
          </span>
        </Meta>
        <Meta icon={MapPin} label="Site" sub={rfq.company.city ?? rfq.site?.address ?? undefined}>
          {rfq.site?.name ?? 'Not set'}
        </Meta>
        <Meta
          icon={UserRound}
          label="Contact"
          phone
          sub={
            rfq.contact?.phone || rfq.contact?.jobTitle ? (
              <>
                {rfq.contact.jobTitle ? <span className="block">{rfq.contact.jobTitle}</span> : null}
                {rfq.contact.phone ? <span className="num">{rfq.contact.phone}</span> : null}
              </>
            ) : undefined
          }
        >
          {rfq.contact?.name ?? 'Not set'}
        </Meta>
        <Meta
          icon={Calendar}
          label="Quotation due"
          phone
          tone={urgent ? 'warn' : undefined}
          sub={open && sent && facts.sentOn ? `Sent ${formatDay(facts.sentOn)}` : open ? (dueSubLabel(dueIn) ?? undefined) : undefined}
        >
          <span className="num">{rfq.dueOn ? `${formatDay(rfq.dueOn)}${rfq.dueTime ? `, ${rfq.dueTime}` : ''}` : 'No date'}</span>
        </Meta>
        <Meta icon={Users} label="Owner" phone sub={rfq.owner ? [ROLE_LABEL[rfq.owner.role] ?? rfq.owner.role, rfq.owner.phone].filter(Boolean).join(' · ') : undefined}>
          {rfq.owner ? (
            <span className="flex items-center gap-2">
              <Avatar name={rfq.owner.name} />
              {rfq.owner.name}
            </span>
          ) : (
            'Not set'
          )}
        </Meta>
      </dl>
    </DetailHeader>
  )
}

/** Go to a panel on the page. A beat after the menu has closed, so closing it (which returns focus) cannot cancel the scroll. */
function scrollTo(slot: string) {
  window.setTimeout(() => document.querySelector(`[data-slot="${slot}"]`)?.scrollIntoView({ block: 'start' }), 60)
}

/**
 * Phone: the sticky bar at the foot of the page (src/ui/StickyActionBar). The same one green action as the Next step box (while
 * waiting for prices it is the supplier chase), a Chase menu (suppliers, customer) and the same More menu. Drawn while the RFQ is
 * open; the page pads its foot for it (RfqDetailScreen).
 */
export function RfqActionBar({ rfq, facts, chaseSuppliers, chaseCustomer }: { rfq: RfqHeader; facts: HeaderFacts; chaseSuppliers: number; chaseCustomer: number }) {
  const actions = useQuoteAndClose(rfq)
  if ((rfq.state?.outcome ?? 'open') !== 'open') return null
  return (
    <StickyActionBar
      label="RFQ actions"
      primary={facts.primary === 'none' ? undefined : <PrimaryButton rfq={rfq} facts={facts} size="touch" className="flex-1" />}
      secondary={
        <Popover>
          <PopoverTrigger asChild>
            <Button size="touch" icon={MessageCircle} aria-label="Chase" />
          </PopoverTrigger>
          <PopoverContent variant="menu" align="end" side="top" className="min-w-[240px]" aria-label="Chase">
            <MenuItem hint={String(chaseSuppliers)} disabled={chaseSuppliers === 0} onClick={() => scrollTo('suppliers-asked')}>
              Chase suppliers
            </MenuItem>
            <MenuItem hint={String(chaseCustomer)} disabled={chaseCustomer === 0} onClick={() => scrollTo('clarifications')}>
              Chase customer
            </MenuItem>
          </PopoverContent>
        </Popover>
      }
      more={<RfqMoreMenu rfq={rfq} facts={facts} actions={actions} touch />}
    />
  )
}
