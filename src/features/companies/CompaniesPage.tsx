import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { Building2, Plus, Search, X } from 'lucide-react'
import { useCompanyList } from '@/features/companies/hooks'
import type { CompanyListRow } from '@/features/companies/api'
import { CreateCompanyDialog } from '@/features/companies/CreateCompanyDialog'
import { Button } from '@/ui/Button'
import { DataTable, type Column } from '@/ui/DataTable'
import { EmptyState } from '@/ui/EmptyState'
import { SegmentedControl } from '@/ui/SegmentedControl'
import { StatusBadge } from '@/ui/StatusBadge'
import { useToast } from '@/ui/useToast'
import { Icon } from '@/ui/Icon'
import { TextField } from '@/ui/form/TextField'

/*
 * Companies list (R02). One table of every company, customer or supplier, with the role derived from
 * what has happened (never typed). Search matches the name and country; the filter narrows by role.
 * "New company" opens the one-dialog inline create, and /companies?new=1 (the command palette's
 * "New company") opens it too.
 */
type Filter = 'all' | 'customers' | 'suppliers' | 'prospects'

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
  const shown = useMemo(() => {
    const words = text.toLowerCase().split(/\s+/).filter(Boolean)
    return (rows ?? []).filter(r => matches[filter](r) && words.every(w => `${r.name} ${r.country ?? ''}`.toLowerCase().includes(w)))
  }, [rows, filter, text])

  const columns = useMemo<Column<CompanyListRow>[]>(
    () => [
      {
        id: 'name',
        header: 'Company',
        value: r => r.name,
        sortable: true,
        cell: r => (
          <div className="grid min-w-0 gap-px">
            <Link to={`/companies/${r.id}`} className="truncate font-medium text-fg hover:underline">
              {r.name}
            </Link>
            {r.country ? <span className="truncate text-xs text-fg-muted">{r.country}</span> : null}
          </div>
        ),
      },
      {
        id: 'role',
        header: 'Role',
        value: r => r.role,
        sortable: true,
        width: 160,
        cell: r => (r.role ? <StatusBadge dimension="company-role" value={r.role} /> : <span className="text-xs text-fg-muted">No activity yet</span>),
      },
      { id: 'rfqs', header: 'RFQs', kind: 'num', value: r => r.rfqCount, sortable: true, width: 96, hideBelowMd: true },
      { id: 'orders', header: 'Orders', kind: 'num', value: r => r.orderCount, sortable: true, width: 96, hideBelowMd: true },
    ],
    [],
  )

  const clearSearch = text.trim() !== '' || filter !== 'all'

  return (
    <div className="mx-auto grid w-full max-w-table content-start gap-4 px-4 pb-12 pt-6 md:px-8">
      <header className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
        <div className="grid gap-1">
          <h1 className="text-2xl font-semibold tracking-tight">Companies</h1>
          <p className="text-sm text-fg-muted">
            {list.isSuccess ? (
              <>
                <span className="num">{counts.all}</span> {counts.all === 1 ? 'company' : 'companies'}. Whether one is a customer or a supplier follows from what you do with it.
              </>
            ) : (
              'Customers and suppliers in one list.'
            )}
          </p>
        </div>
        <Button variant="primary" icon={Plus} onClick={() => setCreating(true)}>
          New company
        </Button>
      </header>

      <DataTable
        label="Companies"
        columns={columns}
        rows={shown}
        getRowId={r => r.id}
        defaultSort={{ id: 'name', dir: 'asc' }}
        onRowOpen={r => navigate(`/companies/${r.id}`)}
        loading={list.isPending}
        error={
          list.isError
            ? { title: "Couldn't load the companies", message: 'Nothing was changed. Check your connection and try again.', onRetry: () => void list.refetch() }
            : null
        }
        summary={list.isSuccess ? `Showing ${shown.length} of ${counts.all} companies` : undefined}
        toolbar={
          <div className="flex flex-wrap items-center gap-3">
            <label className="relative block w-full max-w-[320px] sm:w-[320px]">
              <span className="sr-only">Search companies</span>
              <Icon icon={Search} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-fg-muted" />
              <TextField
                type="search"
                value={text}
                onChange={e => setText(e.target.value)}
                placeholder="Search by name or country"
                autoComplete="off"
                className="pl-8"
              />
            </label>
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
                    {text.trim() ? `Add “${text.trim()}”` : 'New company'}
                  </Button>
                </>
              }
            >
              Check the spelling, or add it as a new company. It takes one field.
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
        initialName={newName || text.trim()}
        onCreated={c => {
          toast({ title: `Added ${c.name}`, body: 'Open it to add sites, contacts and brands when you have them.', tone: 'success' })
          navigate(`/companies/${c.id}`)
        }}
      />
    </div>
  )
}
