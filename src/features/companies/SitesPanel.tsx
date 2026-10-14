import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { MapPin, Plus } from 'lucide-react'
import type { CompanyHistory, SiteRow } from '@/features/companies/api'
import { Fine, Panel } from '@/features/companies/CompanyParts'
import { businessToday } from '@/lib/dates'
import { formatShortDate } from '@/lib/formatDay'
import { orderRef, rfqRef } from '@/lib/refs'
import { Banner } from '@/ui/Banner'
import { Button } from '@/ui/Button'
import { DataTable, type Column } from '@/ui/DataTable'
import { Icon } from '@/ui/Icon'
import { Skeleton } from '@/ui/Skeleton'
import { StatusBadge } from '@/ui/StatusBadge'
import { Tag } from '@/ui/Tag'

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
  reference: string | null
  state: string | null
  extra: string | null
  invoicing: string | null
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
      reference: r.customerRef,
      state: r.outcome,
      extra: r.orderNumber ? `became ${orderRef(r.orderNumber)}` : r.dueOn ? `bid due ${formatShortDate(r.dueOn)}` : null,
      invoicing: null,
    }))
  const orders: Item[] = history.orders
    .filter(o => o.siteId === siteId)
    .map(o => ({
      key: `ord-${o.id}`,
      kind: 'order',
      number: o.number,
      href: `/orders/${o.id}`,
      date: o.orderedOn,
      reference: null,
      state: o.lifecycle,
      extra: null,
      invoicing: o.invoicing,
    }))
  return [...rfqs, ...orders].sort((a, b) => (b.date ?? '').localeCompare(a.date ?? ''))
}

export function SitesPanel({
  sites,
  history,
  loading,
  error,
  onAddSite,
}: {
  sites: readonly SiteRow[] | undefined
  history: CompanyHistory | undefined
  loading: boolean
  error: boolean
  onAddSite: () => void
}) {
  const today = businessToday()
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
      { id: 'custref', header: 'Their reference', cell: r => (r.reference ? <span className="num">{r.reference}</span> : <span className="text-fg-muted">None</span>), hideBelowMd: true },
      { id: 'date', header: 'Date', kind: 'date', value: r => r.date, cell: r => <span className="num">{r.date ? formatShortDate(r.date, today) : 'No date'}</span>, width: 120 },
      {
        id: 'state',
        header: 'State',
        cell: r =>
          r.state ? (
            <span className="inline-flex flex-wrap items-center gap-2">
              <StatusBadge dimension={r.kind === 'rfq' ? 'rfq-outcome' : 'order'} value={r.state} />
              {r.invoicing ? <StatusBadge dimension="invoicing" value={r.invoicing} /> : null}
              {r.extra ? <span className="text-xs text-fg-muted">{r.extra}</span> : null}
            </span>
          ) : null,
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
            <SiteBlock key={s.id} name={s.name} address={s.address} items={history ? itemsFor(history, s.id) : []} columns={columns} />
          ))}
          {unfiled.length > 0 ? <SiteBlock name="Not filed under a site" items={unfiled} columns={columns} muted /> : null}
        </div>
      )}
    </Panel>
  )
}

function SiteBlock({ name, address, items, columns, muted }: { name: string; address?: string | null; items: Item[]; columns: Column<Item>[]; muted?: boolean }) {
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
      </header>
      {items.length > 0 ? (
        <DataTable label={`RFQs and orders at ${name}`} columns={columns} rows={items} getRowId={r => r.key} density="compact" />
      ) : (
        <p className="px-5 pb-4 pl-[52px] text-xs text-fg-muted">No RFQs or orders for this site yet. Start one and it is filed here.</p>
      )}
    </section>
  )
}
