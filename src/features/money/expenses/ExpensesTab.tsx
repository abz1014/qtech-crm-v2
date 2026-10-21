import { useMemo, useState } from 'react'
import { CalendarDays, ChevronLeft, ChevronRight, Pencil, Receipt, Trash2 } from 'lucide-react'
import { businessToday } from '@/lib/dates'
import { formatShortDate } from '@/lib/formatDay'
import { pkr } from '@/lib/formRules'
import { matchesAllWords, useQueryParamText } from '@/lib/useQueryParamText'
import { mapPgError, type MappedError } from '@/lib/pgErrors'
import { Banner } from '@/ui/Banner'
import { Button } from '@/ui/Button'
import { DataTable, type Column } from '@/ui/DataTable'
import { Dialog, DialogContent } from '@/ui/Dialog'
import { EmptyState } from '@/ui/EmptyState'
import { FilterSheet } from '@/ui/FilterSheet'
import { Icon } from '@/ui/Icon'
import { Money } from '@/ui/Money'
import { NoResults } from '@/ui/NoResults'
import { TableFilter } from '@/ui/TableFilter'
import { Tag } from '@/ui/Tag'
import { useToast } from '@/ui/useToast'
import { Select } from '@/ui/form/Select'
import type { ExpenseListing } from '@/features/money/expenses/api'
import { AddExpenseDialog } from '@/features/money/expenses/ExpenseDialog'
import { useCategories, useDeleteExpense, useExpenseMonth } from '@/features/money/expenses/hooks'
import { RecurringPanel } from '@/features/money/expenses/RecurringPanel'
import {
  GROUP_LABEL,
  NO_FILTERS,
  PAID_VIA_LABEL,
  filterExpenses,
  listTotals,
  monthKey,
  monthKeyLabel,
  monthKeyShort,
  shiftMonth,
  type Category,
  type ExpenseFilters,
  type ListedExpense,
  type PaidVia,
} from '@/features/money/expenses/model'

/*
 * Money › Expenses (M03, M11; admin only). One month at a time, by payment date, with "Search expenses" (payee, detail,
 * category, order number; kept in `?q=`) and the Filters sheet (group, category, paid via), totals under the list, edit and
 * delete per row, the burst sheet ("Add expenses") and the recurring templates.
 * Layout from g2-month-end (the Expenses panel behind the burst sheet) and g2-money; search and Filters per consistency spec 3.2.
 */
interface ExpensesTabProps {
  /** Month to open on ("2026-11"); today's by default. */
  initialMonth?: string
}

export function ExpensesTab({ initialMonth }: ExpensesTabProps) {
  const today = businessToday()
  const [month, setMonth] = useState(initialMonth ?? monthKey(today))
  const [filters, setFilters] = useState<ExpenseFilters>(NO_FILTERS)
  const [q, setQ] = useQueryParamText()
  const [editing, setEditing] = useState<ListedExpense | null>(null)
  const [deleting, setDeleting] = useState<ListedExpense | null>(null)

  const cats = useCategories()
  const list = useExpenseMonth(month)
  const categories = useMemo(() => cats.data ?? [], [cats.data])
  const rows = useMemo(() => {
    const kept = filterExpenses(list.data?.rows ?? [], filters, categories)
    return q.trim() ? kept.filter(r => matchesAllWords(searchText(r, categories, list.data), q)) : kept
  }, [list.data, filters, categories, q])
  const totals = listTotals(rows)
  const filtersOn = filterLabels(filters, categories)
  const filtered = filtersOn.length > 0 || q.trim() !== ''
  const clearAll = () => {
    setFilters(NO_FILTERS)
    setQ('')
  }

  const columns = useMemo(() => buildColumns(categories, list.data, { onEdit: setEditing, onDelete: setDeleting }), [categories, list.data])

  const isCurrent = month === monthKey(today)

  return (
    <div className="grid gap-4">
      <RecurringPanel categories={categories} today={today} />

      <section aria-labelledby="expenses-h" className="grid gap-3">
        <DataTable
          label="Expenses"
          columns={columns}
          rows={rows}
          getRowId={r => r.id}
          twoLine
          onRowOpen={r => setEditing(r)}
          footerLabel={`All ${totals.count} ${totals.count === 1 ? 'expense' : 'expenses'} shown`}
          loading={list.isPending}
          error={
            list.isError
              ? { title: "Couldn't load the expenses", message: 'Nothing was changed. Check your connection and try again.', onRetry: () => void list.refetch() }
              : null
          }
          summary={
            list.isSuccess ? (
              <span className="num">
                {totals.count} {totals.count === 1 ? 'expense' : 'expenses'} · {pkr(totals.total)}
                {totals.inputTax > 0 ? ` · input tax ${pkr(totals.inputTax)} · cost ${pkr(totals.cost)}` : ''}
              </span>
            ) : undefined
          }
          toolbar={
            <div className="flex flex-wrap items-center gap-3">
              <h2 id="expenses-h" className="sr-only">
                Expenses
              </h2>
              <TableFilter label="Search expenses" hint="Finds an expense by payee, detail, category or order number." value={q} onChange={setQ} />
              <div className="inline-flex items-center gap-1" role="group" aria-label="Month">
                <Button variant="quiet" size="sm" icon={ChevronLeft} aria-label="Previous month" onClick={() => setMonth(m => shiftMonth(m, -1))} />
                <span className="num min-w-[84px] text-center text-sm font-medium" aria-live="polite" title={monthKeyLabel(month)}>
                  {monthKeyShort(month)}
                </span>
                <Button variant="quiet" size="sm" icon={ChevronRight} aria-label="Next month" disabled={isCurrent} onClick={() => setMonth(m => shiftMonth(m, 1))} />
              </div>
              <span className="inline-flex items-center gap-[6px] text-sm text-fg-muted">
                <Icon icon={CalendarDays} size="chip" />
                By payment date
              </span>
              <span className="flex-1" />
              <FilterSheet title="Filter expenses" on={filtersOn.length} shown={rows.length} noun={['expense', 'expenses']} onClear={() => setFilters(NO_FILTERS)}>
                <FilterSelects categories={categories} filters={filters} onChange={setFilters} />
              </FilterSheet>
            </div>
          }
          empty={
            filtered ? (
              <NoResults query={q} scope={`expenses in ${monthKeyLabel(month)}`} fields="payee, detail, category and order number" filtersOn={filtersOn} onClear={clearAll} />
            ) : (
              <EmptyState icon={Receipt} title={`No expenses in ${monthKeyLabel(month)}`}>
                Add what was spent and it appears here. Small spends go in together with Add expenses.
              </EmptyState>
            )
          }
          mobileRow={r => <ExpenseCard row={r} categories={categories} listing={list.data} />}
        />
      </section>

      {editing ? <AddExpenseDialog open expense={editing} onOpenChange={o => !o && setEditing(null)} /> : null}
      {deleting ? <DeleteExpenseDialog expense={deleting} categories={categories} onClose={() => setDeleting(null)} /> : null}
    </div>
  )
}

function FilterSelects({ categories, filters, onChange }: { categories: readonly Category[]; filters: ExpenseFilters; onChange: (f: ExpenseFilters) => void }) {
  return (
    <>
      <div>
        <Select
          aria-label="Group"
          value={filters.group}
          onChange={e => onChange({ ...filters, group: e.target.value as ExpenseFilters['group'] })}
          options={[{ value: 'all', label: 'All groups' }, ...Object.entries(GROUP_LABEL).map(([value, label]) => ({ value, label }))]}
        />
      </div>
      <div>
        <Select
          aria-label="Category"
          value={filters.categoryId}
          onChange={e => onChange({ ...filters, categoryId: e.target.value })}
          options={[{ value: 'all', label: 'All categories' }, ...categories.map(c => ({ value: c.id, label: c.name }))]}
        />
      </div>
      <div>
        <Select
          aria-label="Paid via"
          value={filters.paidVia}
          onChange={e => onChange({ ...filters, paidVia: e.target.value as ExpenseFilters['paidVia'] })}
          options={[{ value: 'all', label: 'Bank and cash' }, ...(Object.keys(PAID_VIA_LABEL) as PaidVia[]).map(v => ({ value: v, label: PAID_VIA_LABEL[v] }))]}
        />
      </div>
    </>
  )
}

/** "Group: Overheads", "Paid via: Bank": the filters that are on, for the Filters sheet and NoResults. */
function filterLabels(f: ExpenseFilters, categories: readonly Category[]): string[] {
  const on: string[] = []
  if (f.group !== 'all') on.push(`Group: ${GROUP_LABEL[f.group]}`)
  if (f.categoryId !== 'all') on.push(`Category: ${categories.find(c => c.id === f.categoryId)?.name ?? 'removed'}`)
  if (f.paidVia !== 'all') on.push(`Paid via: ${PAID_VIA_LABEL[f.paidVia]}`)
  return on
}

/** What "Search expenses" reads: category, payee, order number and the detail. */
function searchText(r: ListedExpense, categories: readonly Category[], l: ExpenseListing | undefined): string {
  const d = describe(r, categories, l)
  return `${d.name} ${d.detail}`
}

/** "Supplier payment" over "Alpenmark Controls GmbH · ORD-0038 · note". */
function describe(r: ListedExpense, categories: readonly Category[], l: ExpenseListing | undefined) {
  const cat = categories.find(c => c.id === r.categoryId)
  const parts = [r.payeeId ? l?.payees[r.payeeId] : null, r.orderId ? l?.orders[r.orderId] : null, r.note].filter(Boolean) as string[]
  return { name: cat?.name ?? 'Category removed', detail: parts.join(' · '), inactive: cat ? !cat.active : false }
}

function buildColumns(
  categories: readonly Category[],
  listing: ExpenseListing | undefined,
  act: { onEdit: (r: ListedExpense) => void; onDelete: (r: ListedExpense) => void },
): Column<ListedExpense>[] {
  const today = businessToday()
  return [
    {
      id: 'paid',
      header: 'Paid',
      kind: 'date',
      width: 96,
      sortable: true,
      value: r => r.paidOn,
      cell: r => <span className="num">{formatShortDate(r.paidOn, today)}</span>,
    },
    {
      id: 'what',
      header: 'What',
      value: r => describe(r, categories, listing).name,
      sortable: true,
      cell: r => {
        const d = describe(r, categories, listing)
        return (
          <div className="grid min-w-0 gap-px">
            <span className="min-w-0 font-medium [overflow-wrap:anywhere]">{d.name}</span>
            {d.detail ? <span className="min-w-0 text-xs text-fg-muted [overflow-wrap:anywhere]">{d.detail}</span> : null}
          </div>
        )
      },
    },
    { id: 'via', header: 'Paid via', width: 96, value: r => r.paidVia, sortable: true, cell: r => <Tag>{PAID_VIA_LABEL[r.paidVia]}</Tag>, hideBelowMd: true },
    {
      id: 'tax',
      header: 'Input tax (PKR)',
      kind: 'money',
      width: 132,
      hideBelowMd: true,
      value: r => (r.inputTax > 0 ? r.inputTax : null),
      total: true,
    },
    { id: 'amount', header: 'Amount (PKR)', kind: 'money', width: 140, sortable: true, value: r => r.amount, total: true },
    {
      id: 'actions',
      header: 'Actions',
      width: 84,
      cell: r => (
        <span className="inline-flex gap-1">
          <Button variant="quiet" size="sm" icon={Pencil} aria-label={`Edit ${describe(r, categories, listing).name} of ${r.amount}`} onClick={() => act.onEdit(r)} />
          <Button variant="quiet" size="sm" icon={Trash2} aria-label={`Delete ${describe(r, categories, listing).name} of ${r.amount}`} onClick={() => act.onDelete(r)} />
        </span>
      ),
    },
  ]
}

function ExpenseCard({ row, categories, listing }: { row: ListedExpense; categories: readonly Category[]; listing: ExpenseListing | undefined }) {
  const d = describe(row, categories, listing)
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-[2px] py-1">
      <span className="min-w-0 font-medium [overflow-wrap:anywhere]">{d.name}</span>
      <Money value={row.amount} prefix={false} />
      <span className="min-w-0 text-xs text-fg-muted [overflow-wrap:anywhere]">{d.detail || ' '}</span>
      <span className="num text-xs text-fg-muted">
        {formatShortDate(row.paidOn, businessToday())} · {PAID_VIA_LABEL[row.paidVia]}
      </span>
    </div>
  )
}

function DeleteExpenseDialog({ expense, categories, onClose }: { expense: ListedExpense; categories: readonly Category[]; onClose: () => void }) {
  const del = useDeleteExpense()
  const toast = useToast()
  const [error, setError] = useState<MappedError | null>(null)
  const name = categories.find(c => c.id === expense.categoryId)?.name ?? 'expense'
  return (
    <Dialog open onOpenChange={o => !o && !del.isPending && onClose()} busy={del.isPending}>
      <DialogContent
        title="Delete this expense?"
        context={`${name} · PKR ${expense.amount.toLocaleString('en-US')} · ${formatShortDate(expense.paidOn)}`}
        icon={Trash2}
        tone="danger"
        size="sm"
        footer={
          <>
            <Button data-cancel variant="quiet" disabled={del.isPending} onClick={onClose}>
              Cancel
            </Button>
            <Button
              variant="danger"
              busy={del.isPending}
              busyLabel="Deleting"
              onClick={() =>
                del.mutate(expense.id, {
                  onSuccess: () => {
                    toast.toast({ title: 'Deleted expense', body: `${name} · ${pkr(expense.amount)}`, tone: 'neutral' })
                    onClose()
                  },
                  onError: e => setError(mapPgError(e, { entity: 'expense' })),
                })
              }
            >
              Delete expense
            </Button>
          </>
        }
      >
        <p>It is removed from the books and from the bank tick. Its receipt photo goes with it.</p>
        {error ? (
          <Banner tone="danger" title="Couldn't delete the expense">
            {error.message}
          </Banner>
        ) : null}
      </DialogContent>
    </Dialog>
  )
}
