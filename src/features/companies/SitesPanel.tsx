import { useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { MapPin, Pencil, Plus, RefreshCw, Trash2 } from 'lucide-react'
import { useSession } from '@/app/session'
import type { CompanyHistory, SiteRow } from '@/features/companies/api'
import { NewOrderDialog } from '@/features/orders/NewOrderDialog'
import { ConfirmRemove, Fine, Panel } from '@/features/companies/CompanyParts'
import { useRemoveSite } from '@/features/companies/hooks'
import { removeErrorMessage } from '@/features/companies/removeError'
import { businessToday } from '@/lib/dates'
import { formatShortDate } from '@/lib/formatDay'
import { orderRef, rfqRef } from '@/lib/refs'
import { cn } from '@/lib/utils'
import { useMediaQuery } from '@/lib/useMediaQuery'
import { Banner } from '@/ui/Banner'
import { Button } from '@/ui/Button'
import { Icon } from '@/ui/Icon'
import { Skeleton } from '@/ui/Skeleton'
import { StatusText } from '@/ui/StatusText'
import { Tag } from '@/ui/Tag'
import { useToast } from '@/ui/useToast'

/*
 * Sites, with their RFQs and orders filed under the site they were for (g2-company.html board 4), so a
 * repeat order starts from the right plant. Anything not filed under a site is listed last. Money is not
 * shown here: the order totals live on the order, and the company's money panel is admin-only.
 */
interface Item {
  key: string
  kind: 'rfq' | 'order'
  number: number
  href: string
  date: string | null
  what: string | null
  moreItems: number
  state: string | null
  /** Order only: the goods state (Delivered...) and "Payment overdue" (which takes the goods word's place). */
  goods: string | null
  paymentOverdue: boolean
  /** Orders only: the order's id, for "Repeat order" (O02). */
  orderId?: string
  extra: string | null
}

/** Why an RFQ was closed, drawn under "Closed" ("Price too high"). Sentence case, like every state on the page. */
const CLOSED_WHY: Record<string, string> = {
  competitor: 'Chose a competitor',
  price: 'Price too high',
  no_reply_to_clarification: 'No reply from customer',
  customer_cancelled: 'Customer cancelled',
  could_not_source: 'Could not source',
  we_were_late: 'We were too late',
  other: 'Another reason',
}

function itemsFor(history: CompanyHistory, siteId: string | null, today: string): Item[] {
  const rfqs: Item[] = history.rfqs
    .filter(r => r.siteId === siteId)
    .map(r => ({
      key: `rfq-${r.id}`,
      kind: 'rfq',
      number: r.number,
      href: `/rfqs/${r.id}`,
      date: r.receivedOn,
      what: r.what,
      moreItems: r.moreItems,
      state: r.outcome,
      goods: null,
      paymentOverdue: false,
      extra:
        r.outcome === 'won' && r.orderNumber
          ? `Became ${orderRef(r.orderNumber)}`
          : r.outcome === 'closed'
            ? (CLOSED_WHY[r.closeReason ?? ''] ?? null)
            : r.dueOn
              ? `Quotation due ${formatShortDate(r.dueOn, today)}`
              : null,
    }))
  const orders: Item[] = history.orders
    .filter(o => o.siteId === siteId)
    .map(o => ({
      key: `ord-${o.id}`,
      kind: 'order',
      number: o.number,
      href: `/orders/${o.id}`,
      date: o.orderedOn,
      what: o.what,
      moreItems: o.moreItems,
      state: o.lifecycle,
      goods: o.goods,
      paymentOverdue: o.paymentOverdue === true,
      orderId: o.id,
      extra: null,
    }))
  return [...rfqs, ...orders].sort((a, b) => (b.date ?? '').localeCompare(a.date ?? ''))
}

export function SitesPanel({
  companyId,
  sites,
  history,
  loading,
  error,
  onAddSite,
  onEditSite,
}: {
  companyId: string
  sites: readonly SiteRow[] | undefined
  history: CompanyHistory | undefined
  loading: boolean
  error: boolean
  onAddSite: () => void
  onEditSite: (site: SiteRow) => void
}) {
  const today = businessToday()
  const { toast } = useToast()
  const remove = useRemoveSite(companyId)
  const [removing, setRemoving] = useState<SiteRow | null>(null)
  const [removeError, setRemoveError] = useState<string | null>(null)
  const cancelRemove = () => {
    const id = removing?.id
    setRemoving(null)
    setRemoveError(null)
    if (id) requestAnimationFrame(() => document.querySelector<HTMLElement>(`[data-remove-site="${id}"]`)?.focus())
  }
  const confirmRemove = () => {
    if (!removing) return
    remove.mutate(removing.id, {
      onSuccess: () => {
        toast({ title: `Removed ${removing.name}`, tone: 'success' })
        setRemoving(null)
      },
      onError: err => setRemoveError(removeErrorMessage(err, 'site')),
    })
  }
  const unfiled = history ? itemsFor(history, null, today) : []

  return (
    <Panel
      title="Sites"
      actions={
        <Button variant="quiet" size="sm" icon={Plus} onClick={onAddSite}>
          Add site
        </Button>
      }
    >
      {loading ? (
        <div role="status" className="grid gap-3 p-5" aria-busy="true" aria-label="Loading sites">
          <Skeleton className="h-4 w-1/4" />
          <Skeleton className="h-8 w-full" />
        </div>
      ) : error ? (
        <div className="p-4">
          <Banner tone="danger" title="Couldn't load the sites">
            Reload the page to try again. Nothing was changed.
          </Banner>
        </div>
      ) : !sites || (sites.length === 0 && unfiled.length === 0) ? (
        <div className="grid gap-1 px-5 py-6 text-sm">
          <p className="font-medium text-fg">No sites or RFQs yet.</p>
          <Fine>Add a site here, or type one when you log an RFQ.</Fine>
        </div>
      ) : (
        <div>
          {sites.map(s => (
            <SiteBlock
              key={s.id}
              id={s.id}
              name={s.name}
              address={s.address}
              items={history ? itemsFor(history, s.id, today) : []}
              today={today}
              onEdit={() => onEditSite(s)}
              onRemove={() => {
                setRemoveError(null)
                setRemoving(s)
              }}
              confirm={
                removing?.id === s.id ? (
                  <ConfirmRemove
                    title={`Remove ${s.name}?`}
                    detail="Its address is deleted. Contacts at this site stay, with no site set."
                    busy={remove.isPending}
                    error={removeError}
                    onConfirm={confirmRemove}
                    onCancel={cancelRemove}
                    className="mx-5 mb-3"
                  />
                ) : null
              }
            />
          ))}
          {unfiled.length > 0 ? <SiteBlock name="Not filed under a site" items={unfiled} today={today} muted /> : null}
        </div>
      )}
    </Panel>
  )
}

/**
 * "Repeat order" on an order row (O02; D-83): opens the New order dialog with this order already chosen, so a repeat is Create order and
 * nothing else. Engineers are not offered it: a repeat copies prices.
 */
function RepeatOrderSlot({ orderId, orderNumber }: { orderId: string; orderNumber: number }) {
  const session = useSession()
  const [open, setOpen] = useState(false)
  if (session.status !== 'signed-in' || session.user.role === 'engineer') return null
  return (
    <>
      <Button variant="quiet" size="sm" icon={RefreshCw} aria-label={`Repeat order ${orderRef(orderNumber)}`} onClick={() => setOpen(true)}>
        Repeat order
      </Button>
      {open ? <NewOrderDialog sourceId={orderId} onClose={() => setOpen(false)} /> : null}
    </>
  )
}

function SiteBlock({
  id,
  name,
  address,
  items,
  today,
  muted,
  onEdit,
  onRemove,
  confirm,
}: {
  id?: string
  name: string
  address?: string | null
  items: Item[]
  today: string
  muted?: boolean
  onEdit?: () => void
  onRemove?: () => void
  confirm?: ReactNode
}) {
  const rfqs = items.filter(i => i.kind === 'rfq').length
  const orders = items.length - rfqs
  const counts = `${rfqs} ${rfqs === 1 ? 'RFQ' : 'RFQs'} · ${orders} ${orders === 1 ? 'order' : 'orders'}`
  return (
    <section className="border-t first:border-t-0" aria-label={name}>
      <header className="flex items-start gap-3 px-5 py-3">
        <Icon icon={MapPin} className="mt-[3px] text-fg-muted" />
        <div className="min-w-0 flex-1">
          {/* the counts sit on the name's line (wrapping under it only when the name is long) */}
          <div className="flex flex-wrap items-baseline justify-between gap-x-3">
            <h3 className={muted ? 'text-base font-medium text-fg-muted' : 'text-base font-semibold'}>{name}</h3>
            <span className="num text-sm text-fg-muted">{counts}</span>
          </div>
          {address ? <p className="min-w-0 text-sm text-fg-muted [overflow-wrap:anywhere]">{address}</p> : null}
        </div>
        {onEdit && onRemove ? (
          <div className="-my-1 flex shrink-0 items-center" data-row-actions="">
            <Button variant="quiet" size="sm" icon={Pencil} aria-label={`Edit ${name}`} onClick={onEdit} />
            <Button variant="quiet" size="sm" icon={Trash2} aria-label={`Remove ${name}`} data-remove-site={id} onClick={onRemove} />
          </div>
        ) : null}
      </header>
      {confirm}
      {items.length > 0 ? (
        <ItemList label={`RFQs and orders at ${name}`} items={items} today={today} />
      ) : (
        <p className="px-5 pb-4 text-sm text-fg-muted">No RFQs or orders here yet.</p>
      )}
    </section>
  )
}

/*
 * A site's RFQs and orders as a short list, not a table: the item name wraps, so the State and "Repeat order" always fit at 1366
 * with the side column (a table cut "Repeat order" to "Re"). From md: reference · what · date · state · action; a phone stacks it.
 */
const IGRID = 'md:grid md:grid-cols-[112px_minmax(0,1fr)_72px_minmax(0,168px)_auto] md:items-start md:gap-x-4'

function ItemList({ label, items, today }: { label: string; items: Item[]; today: string }) {
  // one layout in the DOM at a time, so every reference, item and button exists once
  const wide = useMediaQuery('(min-width: 768px)')
  return (
    <div className="border-t">
      {wide ? (
        <div className={cn('bg-sunken px-5 py-2 text-sm text-fg-muted', IGRID)} aria-hidden="true">
          <span>Reference</span>
          <span>What</span>
          <span>Date</span>
          <span>State</span>
          <span className="w-[136px]" />
        </div>
      ) : null}
      <ul aria-label={label}>
        {items.map(item => (
          <li key={item.key} className="border-t px-5 py-3 first:border-t-0 md:py-2">
            {wide ? (
              <div className={cn('min-h-touch', IGRID)}>
                <span className="pt-[6px]">
                  <RefTag item={item} />
                </span>
                <span className="pt-[8px] text-sm">
                  <WhatText item={item} />
                </span>
                <span className="num pt-[8px] text-sm">{item.date ? formatShortDate(item.date, today) : 'No date'}</span>
                <span className="pt-[8px] text-sm">
                  <StateText item={item} />
                </span>
                <span className="flex w-[136px] justify-end">
                  {item.kind === 'order' && item.orderId ? <RepeatOrderSlot orderId={item.orderId} orderNumber={item.number} /> : null}
                </span>
              </div>
            ) : (
              <ItemCard item={item} today={today} />
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}

function RefTag({ item }: { item: Item }) {
  return (
    <Link to={item.href} className="rounded hover:underline">
      <Tag>{item.kind === 'rfq' ? rfqRef(item.number) : orderRef(item.number)}</Tag>
    </Link>
  )
}

function WhatText({ item }: { item: Item }) {
  if (!item.what) return <span className="text-fg-muted">No items yet</span>
  return (
    <span title={item.what}>
      {item.what}
      {item.moreItems > 0 ? <span className="ml-1 text-fg-muted">{`+ ${item.moreItems} more`}</span> : null}
    </span>
  )
}

/**
 * One state per row, as status text (consistency spec 1.5, rule 3: history rows show no chips). An order: Cancelled, else
 * "Payment overdue", else its goods word (Delivered, On order...); an order with no goods says Done once it is done, else "—".
 * An RFQ: Won or Closed with why; an open RFQ has no state word, only its quotation due date.
 */
function StateText({ item }: { item: Item }) {
  if (item.kind === 'order') {
    if (item.state === 'cancelled') return <StatusText dimension="order" value="cancelled" />
    if (item.paymentOverdue) return <StatusText dimension="payment" value="overdue" label="Payment overdue" />
    if (item.goods && item.goods !== 'n_a') return <StatusText dimension="goods" value={item.goods} />
    if (item.state === 'done') return <StatusText dimension="order" value="done" />
    return <span className="text-fg-muted">—</span>
  }
  if (item.state === 'won' || item.state === 'closed') return <StatusText dimension="rfq-outcome" value={item.state} detail={item.extra} />
  return item.extra ? <span className="text-sm text-fg-muted">{item.extra}</span> : null
}

/** A phone row (below 640px): the reference and date, what it was, then its state and Repeat order. */
function ItemCard({ item, today }: { item: Item; today: string }) {
  return (
    <div className="grid gap-2">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <RefTag item={item} />
        <span className="num text-sm text-fg-muted">{item.date ? formatShortDate(item.date, today) : 'No date'}</span>
      </div>
      <WhatText item={item} />
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <StateText item={item} />
        {item.kind === 'order' && item.orderId ? <RepeatOrderSlot orderId={item.orderId} orderNumber={item.number} /> : null}
      </div>
    </div>
  )
}
