import { Link } from 'react-router-dom'
import { ArrowLeft, Calendar, Building2, ChevronDown, Ellipsis, FileCheck2, FileText, MapPin, MessageCircle, Package, RotateCcw, UserRound, Users, type LucideIcon } from 'lucide-react'
import { businessToday } from '@/lib/dates'
import { formatDay } from '@/lib/formatDay'
import { mapPgError } from '@/lib/pgErrors'
import { orderRef, rfqRef } from '@/lib/refs'
import { ROLE_LABEL } from '@/app/session'
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
import { IssueQuotationButton } from '@/features/quotations/QuotationsPanel'
import { useIssueDialog } from '@/features/quotations/useIssueDialog'
import { CLOSE_REASONS, closeReasonLabel, defaultCloseReason, dueChipLabel, dueSubLabel, type CloseReason } from '@/features/rfqs/lib'

/*
 * The top of the RFQ page (g2-rfq-detail header, and the phone bar and action bar). Who it is for, where it stands (state chips
 * from v_rfq_state), and the actions that belong to the whole RFQ: Issue quotation, and one "Bid and close" menu holding
 * Mark bid sent ("no PDF"), Sent the offer again ("updates date") and the seven one-tap reasons to close the RFQ; the reason
 * the RFQ's own state points to is marked "suggested". Mark bid sent and closing both have an Undo.
 *
 * Phone (375): a page bar with back, the number and a "..." menu; the company on one line; four meta cells; and a sticky bar at
 * the foot with the primary Issue quotation, a Chase menu (suppliers, customer) and the "..." menu.
 */

// ------------------------------------------------------------------------------------------------ the actions

/** Mark bid sent, Sent the offer again and Close RFQ because...: one set of actions, used by the header menu and both phone menus. */
function useBidAndClose(rfq: RfqHeader) {
  const { toast } = useToast()
  const bid = useSetBidSent(rfq.id)
  const closeRfq = useSetRfqClosed(rfq.id)
  const ref = rfqRef(rfq.number)
  const s = rfq.state

  const markBidSent = async (again: boolean) => {
    const before = rfq.quotedOn
    try {
      await bid.mutateAsync(businessToday())
      toast({
        title: again ? 'Offer sent again' : 'Marked bid sent',
        body: `${ref} · ${rfq.company.name}`,
        undo: {
          onUndo: async () => {
            try {
              await bid.mutateAsync(before)
            } catch (err) {
              toast({ title: 'Could not undo', body: mapPgError(err).message, tone: 'danger' })
            }
          },
          settledTitle: again ? 'Offer sent again' : 'Marked bid sent',
          undoneTitle: again ? 'Date put back' : 'Bid sent taken back',
        },
      })
    } catch (err) {
      toast({ title: 'Could not mark the bid sent', body: mapPgError(err, { entity: 'RFQ' }).message, tone: 'danger' })
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
            try {
              await closeRfq.mutateAsync({ closedOn: null, reason: null, note: null })
            } catch (err) {
              toast({ title: 'Could not undo', body: mapPgError(err).message, tone: 'danger' })
            }
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
            try {
              await closeRfq.mutateAsync(before)
            } catch (err) {
              toast({ title: 'Could not undo', body: mapPgError(err).message, tone: 'danger' })
            }
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
  return { markBidSent, close, reopen, suggested, busy: bid.isPending || closeRfq.isPending }
}

/** The menu items of "Bid and close". */
function BidAndCloseItems({ rfq, actions }: { rfq: RfqHeader; actions: ReturnType<typeof useBidAndClose> }) {
  const bidSent = rfq.state?.bid_state === 'bid_sent' || rfq.state?.bid_state === 'quotation_expired'
  return (
    <>
      <MenuItem hint="no PDF" disabled={bidSent} onClick={() => void actions.markBidSent(false)}>
        Mark bid sent
      </MenuItem>
      <MenuItem hint="updates date" onClick={() => void actions.markBidSent(true)}>
        Sent the offer again
      </MenuItem>
      <MenuSeparator />
      <p role="none" className="px-2 pb-1 pt-1 text-xs text-fg-muted">
        Close RFQ because
      </p>
      {CLOSE_REASONS.map(r => (
        <MenuItem key={r.value} hint={r.value === actions.suggested ? 'suggested' : undefined} onClick={() => void actions.close(r.value)}>
          {r.label}
        </MenuItem>
      ))}
    </>
  )
}

function BidAndCloseMenu({ rfq, actions, trigger, label }: { rfq: RfqHeader; actions: ReturnType<typeof useBidAndClose>; trigger: React.ReactNode; label: string }) {
  return (
    <Popover>
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent variant="menu" align="end" className="min-w-[280px]" aria-label={label}>
        <BidAndCloseItems rfq={rfq} actions={actions} />
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
      <dt className={`flex items-center gap-1 text-xs ${tone === 'warn' ? 'text-tone-warning-fg' : 'text-fg-muted'}`}>
        <span className="max-md:hidden">
          <Icon icon={icon} size="chip" />
        </span>
        {label}
      </dt>
      <dd className="m-0 min-w-0 break-words text-sm font-medium">{children}</dd>
      {sub ? <dd className="m-0 text-xs text-fg-muted">{sub}</dd> : null}
    </div>
  )
}

// ------------------------------------------------------------------------------------------------ the header

export function RfqHeaderBlock({ rfq, hasPrices }: { rfq: RfqHeader; hasPrices: boolean }) {
  const actions = useBidAndClose(rfq)
  const [, setWon] = useWonDialog()
  const orders = useOrdersForRfq(rfq.id)
  const liveOrders = (orders.data ?? []).filter(o => !o.cancelledOn)
  const s = rfq.state
  const ref = rfqRef(rfq.number)
  const open = (s?.outcome ?? 'open') === 'open'
  const bidSent = s?.bid_state === 'bid_sent' || s?.bid_state === 'quotation_expired'
  const dueIn = s?.days_to_due
  const due = open ? dueChipLabel(dueIn, Boolean(s?.is_overdue)) : null
  const since = rfq.company.createdAt ? rfq.company.createdAt.slice(0, 4) : null

  return (
    <header>
      {/* Phone: the page bar (back, the number, more). */}
      <div className="-mx-4 mb-3 flex h-11 items-center border-b px-2 md:hidden" data-page-bar>
        <Link to="/rfqs" aria-label="Back to RFQs" className="inline-grid size-touch place-items-center rounded hover:bg-sunken">
          <Icon icon={ArrowLeft} size="lg" />
        </Link>
        <span className="num flex-1 text-center text-sm font-semibold">{ref}</span>
        <BidAndCloseMenu
          rfq={rfq}
          actions={actions}
          label="More"
          trigger={<Button variant="quiet" size="touch" icon={Ellipsis} aria-label="More" disabled={!open} />}
        />
      </div>
      <Breadcrumb className="max-md:hidden" items={[{ label: 'RFQs', to: '/rfqs' }, { label: ref, mono: true }]} />
      <div className="mt-2 flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
        <div className="min-w-0">
          <h1 className="flex flex-wrap items-baseline gap-x-3 text-2xl font-semibold tracking-snug max-md:flex-col max-md:gap-0">
            <span className="num">{ref}</span>
            <span className="min-w-0 break-words max-md:text-base max-md:font-medium">{rfq.company.name}</span>
          </h1>
          <div className="mt-2 flex flex-wrap items-center gap-2" aria-label="State of this RFQ">
            <StatusBadge dimension="rfq-outcome" value={s?.outcome ?? 'open'} />
            {s && s.sourcing_state ? <StatusBadge dimension="sourcing" value={s.sourcing_state} /> : null}
            {s && s.clarification_state && s.clarification_state !== 'none' ? (
              <StatusBadge
                dimension="clarification"
                value={s.clarification_state}
                detail={s.clarification_state === 'to_ask' ? String(s.to_ask) : s.clarification_state === 'waiting_on_customer' ? String(s.waiting) : String(s.to_relay)}
              />
            ) : null}
            {s && s.bid_state ? (
              <StatusBadge dimension="bid" value={s.bid_state} detail={rfq.quotedOn && bidSent ? formatDay(rfq.quotedOn) : undefined} />
            ) : null}
            {due ? <StatusBadge dimension="deadline" value={s?.is_overdue ? 'overdue' : 'due-soon'} label={due} /> : null}
            {rfq.isPriority ? (
              <span className="inline-flex h-5 items-center rounded border border-tone-warning-fg/25 bg-tone-warning-bg px-2 text-xs font-medium text-tone-warning-fg">Top priority</span>
            ) : null}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {/* data-slot="issue-quotation" (R19): the Issue quotation action. */}
          <span data-slot="issue-quotation" className="contents">
            {open ? <IssueQuotationButton rfqId={rfq.id} disabled={!hasPrices} className="max-md:hidden" /> : null}
          </span>
          {/* data-slot="mark-won" (O01): Mark won opens the Create order dialog; once there is an order, the way to it. */}
          <span data-slot="mark-won" className="contents">
            {s?.outcome !== 'won' && liveOrders.length === 0 ? (
              <Button variant={bidSent ? 'primary' : 'secondary'} icon={FileCheck2} onClick={() => setWon(true)}>
                Mark won
              </Button>
            ) : null}
            {liveOrders.map(o => (
              <Link key={o.id} to={`/orders/${o.id}`} className="inline-flex h-control items-center gap-2 rounded border border-primary bg-primary px-3 text-sm font-medium text-primary-foreground hover:bg-primary-hover">
                <Icon icon={Package} />
                Open {orderRef(o.number)}
              </Link>
            ))}
          </span>
          {open ? (
            <BidAndCloseMenu
              rfq={rfq}
              actions={actions}
              label="Bid and close"
              trigger={
                <Button aria-haspopup="menu" className="max-md:hidden">
                  Bid and close
                  <Icon icon={ChevronDown} size="sm" />
                </Button>
              }
            />
          ) : null}
          {s?.outcome === 'closed' ? (
            <Button icon={RotateCcw} className="max-md:hidden" onClick={() => void actions.reopen()} busy={actions.busy} busyLabel="Reopening">
              Reopen
            </Button>
          ) : null}
        </div>
      </div>

      {s?.outcome === 'closed' ? (
        <p className="mt-3 text-sm text-fg-2">
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
        <Meta icon={Calendar} label="Bid due" phone tone={due ? 'warn' : undefined} sub={open ? (dueSubLabel(dueIn) ?? undefined) : undefined}>
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

/** Phone: the sticky bar at the foot of the page. The primary Issue quotation, a Chase menu (suppliers, customer) and the same "..." menu as the page bar. */
export function RfqActionBar({ rfq, hasPrices, chaseSuppliers, chaseCustomer }: { rfq: RfqHeader; hasPrices: boolean; chaseSuppliers: number; chaseCustomer: number }) {
  const actions = useBidAndClose(rfq)
  const [, setIssue] = useIssueDialog()
  if ((rfq.state?.outcome ?? 'open') !== 'open') return null
  return (
    <div
      data-action-bar
      className="sticky bottom-0 z-20 -mx-4 mt-6 flex items-center gap-2 border-t bg-surface px-4 py-2 md:hidden"
      role="toolbar"
      aria-label="RFQ actions"
    >
      <Button variant="primary" size="touch" className="flex-1" onClick={() => setIssue(true)} disabled={!hasPrices}>
        Issue quotation
      </Button>
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
      <Popover>
        <PopoverTrigger asChild>
          <Button size="touch" icon={Ellipsis} aria-label="More actions" />
        </PopoverTrigger>
        <PopoverContent variant="menu" align="end" side="top" className="min-w-[280px]" aria-label="More actions">
          <BidAndCloseItems rfq={rfq} actions={actions} />
        </PopoverContent>
      </Popover>
    </div>
  )
}

