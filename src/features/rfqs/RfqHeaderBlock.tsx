import { Link } from 'react-router-dom'
import {
  Calendar,
  Building2,
  ChevronDown,
  Copy,
  Ellipsis,
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
import { cn } from '@/lib/utils'
import { ROLE_LABEL } from '@/app/session'
import { useMobileBar } from '@/app/shell/MobileBarContext'
import { Avatar } from '@/ui/Avatar'
import { Breadcrumb } from '@/ui/Breadcrumb'
import { Button } from '@/ui/Button'
import { Icon } from '@/ui/Icon'
import { MenuItem, MenuSeparator, Popover, PopoverContent, PopoverTrigger } from '@/ui/Popover'
import { StatusBadge } from '@/ui/StatusBadge'
import { useToast } from '@/ui/useToast'
import type { RfqHeader } from '@/features/rfqs/api'
import { useSetBidSent, useSetRfqClosed } from '@/features/rfqs/hooks'
import { useOrdersForRfq } from '@/features/orders/hooks'
import { useWonDialog } from '@/features/orders/useWonDialog'
import { useIssueDialog } from '@/features/quotations/useIssueDialog'
import { CLOSE_REASONS, closeReasonLabel, defaultCloseReason, dueChipLabel, dueSubLabel, quotationSent, stageChip, type CloseReason, type RfqPrimary } from '@/features/rfqs/lib'

/*
 * The top of the RFQ page (g2-rfq-detail header, the phone bar and the action bar), reworked by the UX audit of 2026-10-19:
 *   - who it is for first (the company), then the code;
 *   - at most two chips: the stage, in the board's next-step words, and the due date when it is close or past;
 *   - exactly one green button, chosen by state (lib/nextAction.ts): Ask suppliers, then Issue quotation, then Mark won. Everything
 *     else is in one "More" menu: the other two, Mark quotation sent (no PDF), Quotation sent again, and the reasons to close.
 *     Mark won is never the button before a quotation exists, but stays in More for the odd case (a win by phone).
 *   - Issue quotation is never silently disabled: it opens whenever the RFQ has an item (prices can be typed in the dialog); with no
 *     item the menu says why.
 * Mark quotation sent and closing both have an Undo.
 *
 * Phone (375): a page bar with back, the number and More; the company on one line; four meta cells; and a sticky bar at the foot
 * with the same one green action, a Chase menu (suppliers, customer) and More.
 */

export interface HeaderFacts {
  /** The green action (lib/nextAction.ts). */
  primary: RfqPrimary
  itemCount: number
  quotationCount: number
  /** Opens the "Ask suppliers" list. */
  onAsk: () => void
}

// ------------------------------------------------------------------------------------------------ the actions

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

function MoreMenu({ rfq, facts, actions, trigger, label, side }: { rfq: RfqHeader; facts: HeaderFacts; actions: Actions; trigger: React.ReactNode; label: string; side?: 'top' | 'bottom' }) {
  return (
    <Popover>
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent variant="menu" align="end" side={side} className="min-w-[300px]" aria-label={label}>
        <MoreItems rfq={rfq} facts={facts} actions={actions} />
      </PopoverContent>
    </Popover>
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
    default:
      return null
  }
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

const CHIP_TONE = {
  warning: 'border-tone-warning-fg/25 bg-tone-warning-bg text-tone-warning-fg',
  info: 'border-tone-info-fg/25 bg-tone-info-bg text-tone-info-fg',
  success: 'border-tone-success-fg/25 bg-tone-success-bg text-tone-success-fg',
  neutral: 'border-line-strong bg-surface text-fg-2',
} as const

// ------------------------------------------------------------------------------------------------ the header

export function RfqHeaderBlock({ rfq, facts }: { rfq: RfqHeader; facts: HeaderFacts }) {
  const actions = useQuoteAndClose(rfq)
  const main = useMainActions(rfq, facts)
  const s = rfq.state
  const ref = rfqRef(rfq.number)
  const open = (s?.outcome ?? 'open') === 'open'
  const dueIn = s?.days_to_due
  const due = open ? dueChipLabel(dueIn, Boolean(s?.is_overdue)) : null
  const since = rfq.company.createdAt ? rfq.company.createdAt.slice(0, 4) : null
  const stage = stageChip({ outcome: s?.outcome ?? 'open', hasOrder: main.liveOrders.length > 0, sourcingState: s?.sourcing_state, bidState: s?.bid_state, quotationCount: facts.quotationCount })

  // Phone: ONE bar (UX audit rec. 17): back to where the person came from (Today, an order, a company; the RFQ list when there is
  // no earlier screen) and the number. While the RFQ is open its sticky action bar at the foot carries the green action, Chase and
  // More (in thumb reach, so More is not repeated up here), and the bottom tabs step aside.
  useMobileBar({ title: ref, back: 'history', fallback: '/rfqs', hideTabs: open })

  return (
    <header>
      <Breadcrumb className="max-md:hidden" items={[{ label: 'RFQs', to: '/rfqs' }, { label: ref, mono: true }]} />
      <div className="mt-2 flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
        <div className="min-w-0">
          <h1 className="flex flex-wrap items-baseline gap-x-3 text-2xl font-semibold tracking-snug max-md:text-xl">
            <span className="min-w-0 break-words">{rfq.company.name}</span>
            <span className="num text-lg font-medium text-fg-muted max-md:hidden">{ref}</span>
            {rfq.isPriority ? (
              <span className="inline-flex items-center gap-1 self-center text-sm font-medium text-tone-warning-fg">
                <Icon icon={Flag} size="sm" />
                Top priority
              </span>
            ) : null}
          </h1>
          <div className="mt-2 flex flex-wrap items-center gap-2" aria-label="Where this RFQ stands">
            {s?.outcome === 'open' || !s ? (
              <span data-stage className={cn('inline-flex h-6 items-center rounded border px-2 text-sm font-medium', CHIP_TONE[stage.tone])}>
                {stage.label}
              </span>
            ) : (
              <StatusBadge dimension="rfq-outcome" value={s.outcome as string} />
            )}
            {due ? <StatusBadge dimension="deadline" value={s?.is_overdue ? 'overdue' : 'due-soon'} label={due} /> : null}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {open ? (
            <>
              <PrimaryButton rfq={rfq} facts={facts} className="max-md:hidden" />
              <MoreMenu
                rfq={rfq}
                facts={facts}
                actions={actions}
                label="More"
                trigger={
                  <Button aria-haspopup="menu" className="max-md:hidden">
                    More
                    <Icon icon={ChevronDown} size="sm" />
                  </Button>
                }
              />
            </>
          ) : null}
          {/* data-slot="mark-won" (O01): once there is an order, the way to it. */}
          {main.liveOrders.length > 0 ? (
            <span data-slot="mark-won" className="contents">
              {main.liveOrders.map(o => (
                <Link key={o.id} to={`/orders/${o.id}`} className="inline-flex h-control items-center gap-2 rounded border border-primary bg-primary px-3 text-sm font-medium text-primary-foreground hover:bg-primary-hover">
                  <Icon icon={Package} />
                  Open {orderRef(o.number)}
                </Link>
              ))}
            </span>
          ) : null}
          {s?.outcome === 'closed' ? (
            <Button icon={RotateCcw} onClick={() => void actions.reopen()} busy={actions.busy} busyLabel="Reopening">
              Reopen
            </Button>
          ) : null}
        </div>
      </div>

      {s?.outcome === 'closed' ? (
        <p className="mt-3 text-fg-2">
          Closed {rfq.closedOn ? formatDay(rfq.closedOn) : ''}: {closeReasonLabel(rfq.closeReason)}.{rfq.closeNote ? ` ${rfq.closeNote}` : ''}
        </p>
      ) : null}

      <dl className="mt-4 grid grid-cols-2 divide-x divide-y rounded border bg-surface md:grid-cols-3 xl:grid-cols-6 [&>*]:border-line">
        <Meta icon={FileText} label="Customer ref" phone sub={`Received ${formatDay(rfq.receivedOn)}`}>
          <span className="num">{rfq.customerRef ?? 'None given'}</span>
        </Meta>
        <Meta icon={Building2} label="Company" sub={since ? `Customer since ${since}` : 'New customer'}>
          <Link to={`/companies/${rfq.company.id}`} className="underline underline-offset-2 hover:text-fg-2">
            {rfq.company.name}
          </Link>
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
        <Meta icon={Calendar} label="Quotation due" phone tone={due ? 'warn' : undefined} sub={open ? (dueSubLabel(dueIn) ?? undefined) : undefined}>
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
    </header>
  )
}

/** Go to a panel on the page. A beat after the menu has closed, so closing it (which returns focus) cannot cancel the scroll. */
function scrollTo(slot: string) {
  window.setTimeout(() => document.querySelector(`[data-slot="${slot}"]`)?.scrollIntoView({ block: 'start' }), 60)
}

/**
 * Phone: the sticky bar at the foot of the page. The same one green action as the header (while waiting for prices it is the supplier
 * chase), a Chase menu (suppliers, customer) and the same More menu.
 */
export function RfqActionBar({ rfq, facts, chaseSuppliers, chaseCustomer }: { rfq: RfqHeader; facts: HeaderFacts; chaseSuppliers: number; chaseCustomer: number }) {
  const actions = useQuoteAndClose(rfq)
  if ((rfq.state?.outcome ?? 'open') !== 'open') return null
  return (
    <div
      data-action-bar
      className="sticky bottom-0 z-20 -mx-4 mt-6 flex items-center gap-2 border-t bg-surface px-4 pb-[calc(0.5rem+env(safe-area-inset-bottom))] pt-2 md:hidden"
      role="toolbar"
      aria-label="RFQ actions"
    >
      {facts.primary === 'chase' ? (
        <Button variant="primary" size="touch" icon={MessageCircle} className="flex-1" onClick={() => scrollTo('suppliers-asked')}>
          Chase suppliers
        </Button>
      ) : facts.primary === 'none' ? (
        <span className="flex-1" />
      ) : (
        <PrimaryButton rfq={rfq} facts={facts} size="touch" className="flex-1" />
      )}
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
      <MoreMenu rfq={rfq} facts={facts} actions={actions} label="More actions" side="top" trigger={<Button size="touch" icon={Ellipsis} aria-label="More actions" />} />
    </div>
  )
}
