import { useMemo, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { MapPin, Pencil, Plus, RefreshCw, Trash2 } from 'lucide-react'
import type { CompanyHistory, SiteRow } from '@/features/companies/api'
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
              ? `bid due ${formatDay(r.dueOn)}`
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
      {
        id: 'ref',
        header: 'Reference',
        value: r => r.number,
        cell: r => (
          <Link to={r.href} className="rounded hover:underline">
            <Tag>{r.kind === 'rfq' ? rfqRef(r.number) : orderRef(r.number)}</Tag>
          </Link>
        ),
        width: 132,
      },
      {
        id: 'what',
        header: 'What',
        value: r => r.what,
        cell: r =>
          r.what ? (
            <span title={r.what}>
              {r.what}
              {r.moreItems > 0 ? <span className="ml-1 text-fg-muted">{`+ ${r.moreItems} more`}</span> : null}
            </span>
          ) : (
            <span className="text-fg-muted">No items yet</span>
          ),
      },
      { id: 'date', header: 'Date', kind: 'date', value: r => r.date, cell: r => <span className="num">{r.date ? formatShortDate(r.date, today) : 'No date'}</span>, width: 104 },
      {
        id: 'state',
        header: 'State',
        width: 330,
        cell: r =>
          r.kind === 'order' ? (
            <span className="inline-flex flex-wrap items-center gap-[6px]">
              {r.state === 'cancelled' ? <StatusBadge dimension="order" value="cancelled" /> : r.goods ? <StatusBadge dimension="goods" value={r.goods} /> : null}
              {r.paymentOverdue ? (
                <StatusBadge dimension="payment" value="overdue" label="Payment overdue" />
              ) : r.invoicing ? (
                <StatusBadge dimension="invoicing" value={r.invoicing} />
              ) : null}
            </span>
          ) : r.state ? (
            <span className="inline-flex flex-wrap items-center gap-2">
              <StatusBadge dimension="rfq-outcome" value={r.state} />
              {r.extra ? <span className="text-xs text-fg-muted">{r.extra}</span> : null}
            </span>
          ) : null,
      },
      {
        id: 'repeat',
        header: '',
        width: 150,
        cell: r =>
          r.kind === 'order' ? <RepeatOrderSlot orderNumber={r.number} /> : null,
      },
    ],
    [today],
  )

  const unfiled = history ? itemsFor(history, null) : []

  return (
    <Panel
      title="Sites"
      meta="RFQs and orders are filed under the site they are for"
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
          <Fine>Add a site here, or type its name when you log the first RFQ and it is added for you.</Fine>
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
          {unfiled.length > 0 ? <SiteBlock name="Not filed under a site" items={unfiled} columns={columns} muted /> : null}
        </div>
      )}
    </Panel>
  )
}

/**
 * "Repeat order" (g2-company board 4): starts a new order from this one, filed under the same site. The action itself is O02
 * (create_repeat_order, built by another worker): until it lands the slot is drawn as the design has it, but disabled and
 * labelled. Replace the disabled button with the real action when O02 merges. Tracked in docs/design/PARITY_AUDIT.md (D-83).
 */
function RepeatOrderSlot({ orderNumber }: { orderNumber: number }) {
  return (
    <Button variant="quiet" size="sm" icon={RefreshCw} disabled title="Available with the order screens (O02)" aria-label={`Repeat order ${orderRef(orderNumber)}, available with the order screens`}>
      Repeat order
    </Button>
  )
}

function SiteBlock({
  id,
  name,
  address,
  items,
  columns,
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
  muted?: boolean
  onEdit?: () => void
  onRemove?: () => void
  confirm?: ReactNode
}) {
  const rfqs = items.filter(i => i.kind === 'rfq').length
  const orders = items.length - rfqs
  return (
    <section className="border-t first:border-t-0" aria-label={name}>
      <header className="flex items-start gap-3 px-5 py-3">
        <Icon icon={MapPin} className="mt-[2px] text-fg-muted" />
        <div className="min-w-0 flex-1">
          <h3 className={muted ? 'text-sm font-medium text-fg-muted' : 'text-sm font-semibold'}>{name}</h3>
          {address ? <p className="truncate text-xs text-fg-muted">{address}</p> : null}
        </div>
        <span className="num shrink-0 text-xs text-fg-muted">
          {rfqs} {rfqs === 1 ? 'RFQ' : 'RFQs'} · {orders} {orders === 1 ? 'order' : 'orders'}
        </span>
        {onEdit && onRemove ? (
          <div className="-my-1 flex shrink-0 items-center">
            <Button variant="quiet" size="sm" icon={Pencil} aria-label={`Edit ${name}`} onClick={onEdit} />
            <Button variant="quiet" size="sm" icon={Trash2} aria-label={`Remove ${name}`} data-remove-site={id} onClick={onRemove} />
          </div>
        ) : null}
      </header>
      {confirm}
      {items.length > 0 ? (
        <DataTable label={`RFQs and orders at ${name}`} columns={columns} rows={items} getRowId={r => r.key} density="compact" />
      ) : (
        <div className="grid gap-1 px-5 pb-5 pt-4 text-sm">
          <p className="font-medium text-fg">No RFQs or orders for this site yet.</p>
          <p className="text-fg-2">Start one from the button above and it will be filed under this site.</p>
        </div>
      )}
    </section>
  )
}
