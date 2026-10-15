import { useMemo, useState } from 'react'
import { CalendarDays, ChevronLeft, ChevronRight, Pencil, Receipt, Trash2 } from 'lucide-react'
import { businessToday } from '@/lib/dates'
import { formatShortDate } from '@/lib/formatDay'
import { mapPgError, type MappedError } from '@/lib/pgErrors'
import { Banner } from '@/ui/Banner'
import { Button } from '@/ui/Button'
import { DataTable, type Column } from '@/ui/DataTable'
import { Dialog, DialogContent } from '@/ui/Dialog'
import { EmptyState } from '@/ui/EmptyState'
import { Icon } from '@/ui/Icon'
import { Money } from '@/ui/Money'
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
 * Money › Expenses (M03, M11; admin only). One month at a time, by payment date, with filters by group, category and paid
 * via, totals under the list, edit and delete per row, the burst sheet ("Add expenses") and the recurring templates.
 * Layout from g2-month-end (the Expenses panel behind the burst sheet) and g2-money.
 */
interface ExpensesTabProps {
  /** Month to open on ("2026-11"); today's by default. */
  initialMonth?: string
}

export function ExpensesTab({ initialMonth }: ExpensesTabProps) {
  const today = businessToday()
  const [month, setMonth] = useState(initialMonth ?? monthKey(today))
  const [filters, setFilters] = useState<ExpenseFilters>(NO_FILTERS)
  const [editing, setEditing] = useState<ListedExpense | null>(null)
  const [deleting, setDeleting] = useState<ListedExpense | null>(null)

  const cats = useCategories()
  const list = useExpenseMonth(month)
  const categories = useMemo(() => cats.data ?? [], [cats.data])
  const rows = useMemo(() => filterExpenses(list.data?.rows ?? [], filters, categories), [list.data, filters, categories])
  const totals = listTotals(rows)
  const filtered = filters.group !== 'all' || filters.categoryId !== 'all' || filters.paidVia !== 'all'

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
                {totals.count} {totals.count === 1 ? 'expense' : 'expenses'} · PKR {totals.total.toLocaleString('en-US')}
                {totals.inputTax > 0 ? ` · input tax PKR ${totals.inputTax.toLocaleString('en-US')} · cost PKR ${totals.cost.toLocaleString('en-US')}` : ''}
              </span>
            ) : undefined
          }
          toolbar={
            <div className="flex flex-wrap items-center gap-3">
              <h2 id="expenses-h" className="text-base font-semibold">
                Expenses
              </h2>
              <span className="inline-flex items-center gap-[6px] text-xs text-fg-muted">
                <Icon icon={CalendarDays} size="chip" />
                By payment date
              </span>
              <div className="inline-flex items-center gap-1" role="group" aria-label="Month">
                <Button variant="quiet" size="sm" icon={ChevronLeft} aria-label="Previous month" onClick={() => setMonth(m => shiftMonth(m, -1))} />
                <span className="num min-w-[84px] text-center text-sm font-medium" aria-live="polite" title={monthKeyLabel(month)}>
                  {monthKeyShort(month)}
                </span>
                <Button variant="quiet" size="sm" icon={ChevronRight} aria-label="Next month" disabled={isCurrent} onClick={() => setMonth(m => shiftMonth(m, 1))} />
              </div>
              <span className="flex-1" />
              <FilterSelects categories={categories} filters={filters} onChange={setFilters} />
              {filtered ? (
                <Button variant="quiet" size="sm" onClick={() => setFilters(NO_FILTERS)}>
                  Clear filters
                </Button>
              ) : null}
            </div>
          }
          empty={
            filtered ? (
              <EmptyState mood="neutral" title="No expenses match these filters">
                <Button size="sm" onClick={() => setFilters(NO_FILTERS)}>
                  Clear filters
                </Button>
              </EmptyState>
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
      <div className="w-[150px]">
        <Select
          aria-label="Group"
          value={filters.group}
          onChange={e => onChange({ ...filters, group: e.target.value as ExpenseFilters['group'] })}
          options={[{ value: 'all', label: 'All groups' }, ...Object.entries(GROUP_LABEL).map(([value, label]) => ({ value, label }))]}
        />
      </div>
      <div className="w-[190px]">
        <Select
          aria-label="Category"
          value={filters.categoryId}
          onChange={e => onChange({ ...filters, categoryId: e.target.value })}
          options={[{ value: 'all', label: 'All categories' }, ...categories.map(c => ({ value: c.id, label: c.name }))]}
        />
      </div>
      <div className="w-[150px]">
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
            <span className="truncate font-medium">{d.name}</span>
            {d.detail ? <span className="truncate text-xs text-fg-muted">{d.detail}</span> : null}
          </div>
        )
      },
    },
    { id: 'via', header: 'Paid via', width: 96, value: r => r.paidVia, sortable: true, cell: r => PAID_VIA_LABEL[r.paidVia], hideBelowMd: true },
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
      <span className="truncate font-medium">{d.name}</span>
      <Money value={row.amount} prefix={false} />
      <span className="truncate text-xs text-fg-muted">{d.detail || ' '}</span>
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
                    toast.toast({ title: 'Deleted expense', body: `${name} · PKR ${expense.amount.toLocaleString('en-US')}`, tone: 'neutral' })
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
