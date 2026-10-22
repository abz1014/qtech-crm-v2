import { useContext, useMemo, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { Building2, Plus, X } from 'lucide-react'
import { PaletteContext } from '@/app/palette/usePalette'
import { businessToday } from '@/lib/dates'
import { formatShortDate } from '@/lib/formatDay'
import { useQueryParamText } from '@/lib/useQueryParamText'
import { useCompanyList } from '@/features/companies/hooks'
import type { CompanyListRow } from '@/features/companies/api'
import { RoleChip } from '@/features/companies/CompanyParts'
import { commonCountry } from '@/features/companies/commonCountry'
import { listPlace } from '@/features/companies/companyMeta'
import { matchCompany } from '@/features/companies/companySearch'
import { Button } from '@/ui/Button'
import { DataTable, type Column } from '@/ui/DataTable'
import { EmptyState } from '@/ui/EmptyState'
import { InfoTip } from '@/ui/InfoTip'
import { PageHeader } from '@/ui/PageHeader'
import { SegmentedControl } from '@/ui/SegmentedControl'
import { TableFilter } from '@/ui/TableFilter'
import { useToast } from '@/ui/useToast'
import { lazyDialog } from '@/lib/lazyDialog'

// Downloaded the first time it opens (perf/lcp, lazyDialog.tsx).
const CreateCompanyDialog = lazyDialog(() => import('@/features/companies/CreateCompanyDialog').then(m => m.CreateCompanyDialog))

/*
 * Companies list (R02). One table of every company, customer or supplier, with the role derived from
 * what has happened (never typed). Search matches the name, the city or country, a contact's name or a
 * contact's phone number (companySearch.ts); the filter narrows by role. A row found through a contact
 * says which one. "New company" opens the one-dialog inline create, and /companies?new=1 (the command
 * palette's "New company") opens it too. The search text lives in `?q=` (consistency spec 3.1), so a reload
 * or a shared link keeps it. "Last activity" (R2-19) is the latest RFQ, enquiry, order or supplier order,
 * from the rows the RFQs and Orders counts already read (listActivity.ts: a supplier counts the RFQs it was asked about).
 */
type Filter = 'all' | 'customers' | 'suppliers' | 'prospects'

type Shown = CompanyListRow & { place: string | null; via: string | null }

const matches: Record<Filter, (r: CompanyListRow) => boolean> = {
  all: () => true,
  customers: r => r.role === 'customer' || r.role === 'both',
  suppliers: r => r.role === 'supplier' || r.role === 'both',
  // a company with no RFQ, order or enquiry yet is a prospect too (it shows the Prospect tag)
  prospects: r => r.role === 'prospect' || r.role === null,
}

export function CompaniesPage() {
  const navigate = useNavigate()
  const { toast } = useToast()
  const [params, setParams] = useSearchParams()
  const list = useCompanyList()
  const [filter, setFilter] = useState<Filter>('all')
  const [text, setText] = useQueryParamText('q')
  const palette = useContext(PaletteContext)
  const today = businessToday()
  const [creating, setCreating] = useState(false)
  // The palette's "New company" lands here with ?new=1 (and ?name=). The address keeps both while the dialog is open, so a
  // reload brings the dialog back with the name; closing it takes them off.
  const linked = params.get('new') !== null
  const linkedName = linked ? (params.get('name') ?? '') : ''
  const closeCreate = () => {
    setCreating(false)
    if (!linked) return
    const next = new URLSearchParams(params)
    next.delete('new')
    next.delete('name')
    setParams(next, { replace: true })
  }

  const rows = list.data
  const counts = useMemo(
    () => ({
      all: rows?.length ?? 0,
      customers: rows?.filter(matches.customers).length ?? 0,
      suppliers: rows?.filter(matches.suppliers).length ?? 0,
      prospects: rows?.filter(matches.prospects).length ?? 0,
    }),
    [rows],
  )
  const shown = useMemo<Shown[]>(() => {
    const common = commonCountry(rows)
    const out: Shown[] = []
    for (const r of rows ?? []) {
      if (!matches[filter](r)) continue
      const hit = matchCompany(r, text)
      if (hit) out.push({ ...r, place: listPlace(r.city, r.country, common), via: hit.contact })
    }
    return out
  }, [rows, filter, text])

  const columns = useMemo<Column<Shown>[]>(
    () => [
      {
        id: 'name',
        header: 'Company',
        value: r => r.name,
        sortable: true,
        cell: r => (
          <div className="grid min-w-0 gap-px">
            <NameLink row={r} />
            <PlaceLine row={r} />
          </div>
        ),
      },
      { id: 'role', header: 'Role', value: r => r.role, sortable: true, width: 216, cell: r => <Role row={r} /> },
      { id: 'rfqs', header: 'RFQs', kind: 'num', value: r => r.rfqCount, sortable: true, width: 96, hideBelowMd: true },
      { id: 'orders', header: 'Orders', kind: 'num', value: r => r.orderCount, sortable: true, width: 96, hideBelowMd: true },
      {
        id: 'activity',
        header: 'Last activity',
        kind: 'date',
        value: r => r.lastActivity,
        sortable: true,
        width: 140,
        hideBelowMd: true,
        cell: r => (r.lastActivity ? <span className="num">{formatShortDate(r.lastActivity, today)}</span> : <span className="text-fg-muted">No activity yet</span>),
      },
    ],
    [today],
  )

  const clearSearch = text.trim() !== '' || filter !== 'all'
  // A typed phone number is not a company name: offer "New company" then, not "Add “0301 5550142”".
  // any script's letters make it a name (an Urdu name gets "Add …" too); a number alone is not offered as a company name
  const typedName = /\p{L}/u.test(text) ? text.trim() : ''

  return (
    <div className="mx-auto grid w-full max-w-table grid-cols-[minmax(0,1fr)] content-start gap-4 px-4 pb-12 pt-6 md:px-8">
      <PageHeader
        title="Companies"
        lede={
          <span className="inline-flex items-center gap-1">
            Customers and suppliers. Roles come from what happens.
            <InfoTip label="About roles">
              Nobody sets a role by hand. An RFQ or an order makes a company a customer (a prospect until it orders); asking it for prices, ordering from it or listing a brand makes it a supplier.
            </InfoTip>
          </span>
        }
        primary={
          <Button variant="primary" icon={Plus} onClick={() => setCreating(true)}>
            New company
          </Button>
        }
      />

      <DataTable
        label="Companies"
        noun="companies"
        total={counts.all}
        columns={columns}
        rows={shown}
        getRowId={r => r.id}
        twoLine
        mobileRow={r => (
          <div className="grid min-w-0 gap-1">
            <NameLink row={r} />
            <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
              <PlaceLine row={r} />
              <Role row={r} />
            </div>
            <span className="num text-sm text-fg-muted">{r.lastActivity ? `Last: ${formatShortDate(r.lastActivity, today)}` : 'No activity yet'}</span>
          </div>
        )}
        defaultSort={{ id: 'name', dir: 'asc' }}
        onRowOpen={r => navigate(`/companies/${r.id}`)}
        loading={list.isPending}
        error={
          list.isError
            ? { title: "Couldn't load the companies", message: 'Nothing was changed. Check your connection and try again.', onRetry: () => void list.refetch() }
            : null
        }
        toolbar={
          // min-w-0: on a phone the filter scrolls inside its own track instead of pushing the search field past the edge.
          <div className="flex min-w-0 max-w-full flex-wrap items-center gap-3">
            <TableFilter label="Search companies or contacts" hint="Finds a company by name, city, or a contact's name or phone." value={text} onChange={v => setText(v)} />
            <SegmentedControl
              aria-label="Show"
              // a 2 by 2 grid on a phone (all four in view, none cut off), one row from sm up
              className="max-sm:grid max-sm:w-full max-sm:grid-cols-2"
              value={filter}
              onValueChange={v => setFilter(v as Filter)}
              options={[
                { value: 'all', label: 'All' },
                { value: 'customers', label: 'Customers' },
                { value: 'suppliers', label: 'Suppliers' },
                { value: 'prospects', label: 'Prospects' },
              ]}
            />
          </div>
        }
        empty={
          clearSearch ? (
            // NoResults' wording, but Companies keeps "Add {name}" as its second action (spec 3.3), so "search everywhere" is a link in the body
            <EmptyState
              mood="neutral"
              title={text.trim() ? `Nothing matches "${text.trim()}"` : 'No company matches'}
              actions={
                <>
                  <Button
                    icon={X}
                    onClick={() => {
                      setText('')
                      setFilter('all')
                    }}
                  >
                    Clear search
                  </Button>
                  <Button variant="primary" icon={Plus} onClick={() => setCreating(true)}>
                    {typedName ? `Add “${typedName}”` : 'New company'}
                  </Button>
                </>
              }
            >
              Searched companies by name, city, contact and phone number. Check the spelling, or add it as a new company.
              {text.trim() && palette ? (
                <>
                  {' Or '}
                  <button type="button" onClick={() => palette.open(text.trim())} className="rounded font-medium text-fg-2 underline underline-offset-2 hover:text-fg">
                    search everywhere for “{text.trim()}”
                  </button>
                  {' (RFQs, orders, contacts and invoices).'}
                </>
              ) : null}
            </EmptyState>
          ) : (
            <EmptyState
              icon={Building2}
              title="No companies yet"
              actions={
                <Button variant="primary" icon={Plus} onClick={() => setCreating(true)}>
                  New company
                </Button>
              }
            >
              Companies are added as you log RFQs, or here. A name is all it needs.
            </EmptyState>
          )
        }
      />

      <CreateCompanyDialog
        open={creating || linked}
        onOpenChange={o => (o ? setCreating(true) : closeCreate())}
        initialName={linkedName || typedName}
        onCreated={c => {
          toast({ title: `Added ${c.name}`, body: 'Open it to add sites, contacts and brands when you have them.', tone: 'success' })
          navigate(`/companies/${c.id}`)
        }}
      />
    </div>
  )
}

function NameLink({ row }: { row: Shown }) {
  return (
    <Link to={`/companies/${row.id}`} className="min-w-0 [overflow-wrap:anywhere] font-medium text-fg hover:underline">
      {row.name}
    </Link>
  )
}

/** The city (or "City, Country" abroad), and the contact a search found it through. */
function PlaceLine({ row }: { row: Shown }) {
  if (!row.place && !row.via) return null
  return <span className="min-w-0 [overflow-wrap:anywhere] text-sm text-fg-muted">{[row.place, row.via ? `Contact: ${row.via}` : null].filter(Boolean).join(' · ')}</span>
}

function Role({ row }: { row: Shown }) {
  return <RoleChip role={row.role ?? 'prospect'} />
}
