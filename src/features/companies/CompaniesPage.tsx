import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { Building2, Plus, X } from 'lucide-react'
import { useCompanyList } from '@/features/companies/hooks'
import type { CompanyListRow } from '@/features/companies/api'
import { RoleChip } from '@/features/companies/CompanyParts'
import { commonCountry } from '@/features/companies/commonCountry'
import { listPlace } from '@/features/companies/companyMeta'
import { matchCompany } from '@/features/companies/companySearch'
import { CreateCompanyDialog } from '@/features/companies/CreateCompanyDialog'
import { Button } from '@/ui/Button'
import { DataTable, type Column } from '@/ui/DataTable'
import { EmptyState } from '@/ui/EmptyState'
import { InfoTip } from '@/ui/InfoTip'
import { SegmentedControl } from '@/ui/SegmentedControl'
import { TableFilter } from '@/ui/TableFilter'
import { useToast } from '@/ui/useToast'

/*
 * Companies list (R02). One table of every company, customer or supplier, with the role derived from
 * what has happened (never typed). Search matches the name, the city or country, a contact's name or a
 * contact's phone number (companySearch.ts); the filter narrows by role. A row found through a contact
 * says which one. "New company" opens the one-dialog inline create, and /companies?new=1 (the command
 * palette's "New company") opens it too.
 */
type Filter = 'all' | 'customers' | 'suppliers' | 'prospects'

type Shown = CompanyListRow & { place: string | null; via: string | null }

const matches: Record<Filter, (r: CompanyListRow) => boolean> = {
  all: () => true,
  customers: r => r.role === 'customer' || r.role === 'both',
  suppliers: r => r.role === 'supplier' || r.role === 'both',
  prospects: r => r.role === 'prospect',
}

export function CompaniesPage() {
  const navigate = useNavigate()
  const { toast } = useToast()
  const [params, setParams] = useSearchParams()
  const list = useCompanyList()
  const [filter, setFilter] = useState<Filter>('all')
  const [text, setText] = useState('')
  const [creating, setCreating] = useState(false)
  const [newName, setNewName] = useState('')

  // The palette's "New company" lands here with ?new=1: open the dialog once, then tidy the address.
  useEffect(() => {
    if (params.get('new')) {
      setNewName(params.get('name') ?? '')
      setCreating(true)
      const next = new URLSearchParams(params)
      next.delete('new')
      setParams(next, { replace: true })
    }
  }, [params, setParams])

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
    ],
    [],
  )

  const clearSearch = text.trim() !== '' || filter !== 'all'
  // A typed phone number is not a company name: offer "New company" then, not "Add “0301 5550142”".
  const typedName = /[a-z]/i.test(text) ? text.trim() : ''

  return (
    <div className="mx-auto grid w-full max-w-table content-start gap-4 px-4 pb-12 pt-6 md:px-8">
      <header className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
        <div className="flex items-center gap-1">
          <h1 className="text-2xl font-semibold tracking-tight">Companies</h1>
          <InfoTip label="About roles">
            Nobody sets a role by hand. An RFQ or an order makes a company a customer (a prospect until it orders); asking it for prices, ordering from it or listing a brand makes it a supplier.
          </InfoTip>
        </div>
        <Button variant="primary" icon={Plus} onClick={() => setCreating(true)}>
          New company
        </Button>
      </header>

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
            <TableFilter label="Search companies" placeholder="Name, contact, phone or city" value={text} onChange={setText} className="sm:w-[320px]" />
            <SegmentedControl
              aria-label="Show"
              value={filter}
              onValueChange={v => setFilter(v as Filter)}
              options={[
                { value: 'all', label: 'All', count: counts.all },
                { value: 'customers', label: 'Customers', count: counts.customers },
                { value: 'suppliers', label: 'Suppliers', count: counts.suppliers },
                { value: 'prospects', label: 'Prospects', count: counts.prospects },
              ]}
            />
          </div>
        }
        empty={
          clearSearch ? (
            <EmptyState
              title="No company matches"
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
              No name, city, contact or phone number matches. Check the spelling, or add it as a new company.
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
        open={creating}
        onOpenChange={o => {
          setCreating(o)
          if (!o) setNewName('')
        }}
        initialName={newName || typedName}
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
    <Link to={`/companies/${row.id}`} className="truncate font-medium text-fg hover:underline">
      {row.name}
    </Link>
  )
}

/** The city (or "City, Country" abroad), and the contact a search found it through. */
function PlaceLine({ row }: { row: Shown }) {
  if (!row.place && !row.via) return null
  return <span className="min-w-0 truncate text-sm text-fg-muted">{[row.place, row.via ? `Contact: ${row.via}` : null].filter(Boolean).join(' · ')}</span>
}

function Role({ row }: { row: Shown }) {
  return row.role ? <RoleChip role={row.role} /> : <span className="text-sm text-fg-muted">No activity yet</span>
}
