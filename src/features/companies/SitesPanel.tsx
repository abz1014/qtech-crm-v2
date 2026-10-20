import { useMemo, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { MapPin, Pencil, Plus, RefreshCw, Trash2 } from 'lucide-react'
import { useSession } from '@/app/session'
import type { CompanyHistory, SiteRow } from '@/features/companies/api'
import { NewOrderDialog } from '@/features/orders/NewOrderDialog'
import { ConfirmRemove, Fine, Panel } from '@/features/companies/CompanyParts'
import { useRemoveSite } from '@/features/companies/hooks'
import { removeErrorMessage } from '@/features/companies/removeError'
import { businessToday } from '@/lib/dates'
import { formatDay, formatShortDate } from '@/lib/formatDay'
import { orderRef, rfqRef } from '@/lib/refs'
import { Banner } from '@/ui/Banner'
import { Button } from '@/ui/Button'
import { DataTable, type Column } from '@/ui/DataTable'
import { Icon } from '@/ui/Icon'
import { Skeleton } from '@/ui/Skeleton'
import { StatusBadge } from '@/ui/StatusBadge'
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
  /** Order only: the goods state (Delivered...), the invoicing chip, and "Payment overdue" (which takes the invoicing chip's place). */
  goods: string | null
  invoicing: string | null
  paymentOverdue: boolean
  /** Orders only: the order's id, for "Repeat order" (O02). */
  orderId?: string
  extra: string | null
}

/** Short words for why an RFQ was closed, as drawn beside the Closed chip ("no reply from customer"). */
const CLOSED_WHY: Record<string, string> = {
  competitor: 'chose a competitor',
  price: 'price too high',
  no_reply_to_clarification: 'no reply from customer',
  customer_cancelled: 'customer cancelled',
  could_not_source: 'could not source',
  we_were_late: 'we were too late',
  other: 'closed, another reason',
}

function itemsFor(history: CompanyHistory, siteId: string | null): Item[] {
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
      invoicing: null,
      paymentOverdue: false,
      extra:
        r.outcome === 'won' && r.orderNumber
          ? `became ${orderRef(r.orderNumber)}`
          : r.outcome === 'closed'
            ? (CLOSED_WHY[r.closeReason ?? ''] ?? null)
            : r.dueOn
              ? `quotation due ${formatDay(r.dueOn)}`
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
      invoicing: o.invoicing,
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
  const columns = useMemo<Column<Item>[]>(
    () => [
      { id: 'ref', header: 'Reference', value: r => r.number, cell: r => <RefTag item={r} />, width: 132 },
      { id: 'what', header: 'What', value: r => r.what, cell: r => <WhatText item={r} /> },
      { id: 'date', header: 'Date', kind: 'date', value: r => r.date, cell: r => <span className="num">{r.date ? formatShortDate(r.date, today) : 'No date'}</span>, width: 104 },
      { id: 'state', header: 'State', width: 330, cell: r => <StateChips item={r} /> },
      {
        id: 'repeat',
        header: 'Row actions',
        hiddenHeader: true,
        width: 164,
        cell: r => (r.kind === 'order' && r.orderId ? <RepeatOrderSlot orderId={r.orderId} orderNumber={r.number} /> : null),
      },
    ],
    [today],
  )

  const unfiled = history ? itemsFor(history, null) : []

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
        <div className="grid gap-3 p-5" aria-busy="true" aria-label="Loading sites">
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
              items={history ? itemsFor(history, s.id) : []}
              columns={columns}
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
          {unfiled.length > 0 ? <SiteBlock name="Not filed under a site" items={unfiled} columns={columns} today={today} muted /> : null}
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
  columns,
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
  columns: Column<Item>[]
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
          <h3 className={muted ? 'text-sm font-medium text-fg-muted' : 'text-sm font-semibold'}>{name}</h3>
          {address ? <p className="truncate text-sm text-fg-muted">{address}</p> : null}
          <p className="num text-sm text-fg-muted sm:hidden">{counts}</p>
        </div>
        <span className="num hidden shrink-0 pt-[2px] text-sm text-fg-muted sm:inline">{counts}</span>
        {onEdit && onRemove ? (
          <div className="-my-1 flex shrink-0 items-center">
            <Button variant="quiet" size="sm" icon={Pencil} aria-label={`Edit ${name}`} onClick={onEdit} />
            <Button variant="quiet" size="sm" icon={Trash2} aria-label={`Remove ${name}`} data-remove-site={id} onClick={onRemove} />
          </div>
        ) : null}
      </header>
      {confirm}
      {items.length > 0 ? (
        <DataTable label={`RFQs and orders at ${name}`} columns={columns} rows={items} getRowId={r => r.key} mobileRow={r => <ItemCard item={r} today={today} />} />
      ) : (
        <p className="px-5 pb-4 text-sm text-fg-muted">No RFQs or orders here yet.</p>
      )}
    </section>
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

/** An order: its goods chip and its invoicing chip ("Payment overdue" takes the invoicing chip's place). An RFQ: its outcome and why. */
function StateChips({ item }: { item: Item }) {
  if (item.kind === 'order') {
    return (
      <span className="inline-flex flex-wrap items-center gap-[6px]">
        {item.state === 'cancelled' ? <StatusBadge dimension="order" value="cancelled" /> : item.goods ? <StatusBadge dimension="goods" value={item.goods} /> : null}
        {item.paymentOverdue ? (
          <StatusBadge dimension="payment" value="overdue" label="Payment overdue" />
        ) : item.invoicing ? (
          <StatusBadge dimension="invoicing" value={item.invoicing} />
        ) : null}
      </span>
    )
  }
  if (!item.state) return null
  return (
    <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-1">
      <StatusBadge dimension="rfq-outcome" value={item.state} />
      {item.extra ? <span className="text-sm text-fg-muted">{item.extra}</span> : null}
    </span>
  )
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
        <StateChips item={item} />
        {item.kind === 'order' && item.orderId ? <RepeatOrderSlot orderId={item.orderId} orderNumber={item.number} /> : null}
      </div>
    </div>
  )
}
